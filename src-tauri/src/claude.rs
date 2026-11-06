//! Claude Code(CLI)の呼び出し。
//!
//! メッセージ 1 件ごとに `claude -p` をヘッドレスで起動し、`stream-json` の出力を
//! 1 行ずつフロントエンドへイベントで流す。会話の継続は Claude Code の
//! セッション ID(`--resume`)で行う。原稿の読み書きはアプリ内の MCP サーバー(`mcp.rs`)の
//! ツールだけで行い、Claude Code 組み込みのファイル系ツールは使わせない(原稿の正本はアプリ側)。
//! 作業ディレクトリは何も置かない空のディレクトリ。
//!
//! 出力は実行ごとにネイティブ側でも溜めておく。画面を再読み込みしてもプロセスは止めず、
//! 戻ってきたフロントエンドが `claude_attach` でそこまでの出力を受け取り、続きを購読できる。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use crate::mcp::{self, McpState};
use crate::ollama::{self, OllamaState};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::oneshot;

const WEB_TOOLS: &[&str] = &["WebSearch", "WebFetch"];
const DENIED_TOOLS: &[&str] = &["Bash", "Edit", "MultiEdit", "Write", "NotebookEdit"];

/// エラー表示用に残す標準エラー出力の上限
const STDERR_LIMIT: usize = 16 * 1024;

/// 終わった実行の出力を残しておく時間(この間に再読み込みから戻れば結果を受け取れる)
const FINISHED_RETENTION: Duration = Duration::from_secs(30 * 60);

#[derive(Default)]
pub struct ClaudeState {
    running: Mutex<HashMap<String, oneshot::Sender<()>>>,
    /// 実行ごとの出力(再読み込み後に受け取り直すため)
    runs: Mutex<HashMap<String, Arc<Mutex<RunLog>>>>,
}

/// 実行の出力を溜めてフロントエンドへ流す(受け取り直しと購読が重なっても index で重複を除ける)
fn push_line(app: &AppHandle, log: &Mutex<RunLog>, request_id: &str, line: &str) {
    let index = match log.lock() {
        Ok(mut l) => {
            l.lines.push(line.to_string());
            l.lines.len() - 1
        }
        Err(_) => return,
    };
    let _ = app.emit("claude://line", LineEvent { request_id, index, line });
}

#[derive(Default)]
struct RunLog {
    lines: Vec<String>,
    exit: Option<ExitEvent>,
    finished_at: Option<Instant>,
}

impl ClaudeState {
    /// 終わってから時間が経った実行の記録を捨てる
    fn prune(&self) {
        if let Ok(mut runs) = self.runs.lock() {
            runs.retain(|_, log| {
                log.lock()
                    .map(|l| l.finished_at.is_none_or(|t| t.elapsed() < FINISHED_RETENTION))
                    .unwrap_or(false)
            });
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendRequest {
    request_id: String,
    prompt: String,
    /// 続きの会話にするときの Claude Code のセッション ID
    session_id: Option<String>,
    model: Option<String>,
    allow_web: bool,
    /// 設定で指定された claude の実行ファイル(空なら自動で探す)
    claude_path: Option<String>,
    append_system_prompt: Option<String>,
    /// 編集モード: suggest / confirm / auto。suggest(未指定を含む)では propose_edit を使わせない
    #[serde(alias = "edit_mode")]
    edit_mode: Option<String>,
    /// "ollama" なら Claude Code ではなく Ollama で動かす(未指定は claude)
    provider: Option<String>,
    /// Ollama の接続先(空なら http://localhost:11434)
    ollama_url: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LineEvent<'a> {
    request_id: &'a str,
    /// その実行の何行目か(0 から)。受け取り直した分と重ならないようにする
    index: usize,
    line: &'a str,
}

/// `claude_attach` の結果: それまでの出力と、終わっていれば終了の情報
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachResult {
    lines: Vec<String>,
    exit: Option<ExitEvent>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ExitEvent {
    request_id: String,
    code: Option<i32>,
    cancelled: bool,
    stderr: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeStatus {
    found: bool,
    path: Option<String>,
    version: Option<String>,
    error: Option<String>,
    /// `claude auth status` の結果。確かめられなかったときは None
    logged_in: Option<bool>,
}

/// claude の実行ファイルを探す。PATH に無ければよくあるインストール先を順に見る
fn find_claude(custom: Option<&str>) -> Option<PathBuf> {
    if let Some(custom) = custom.map(str::trim).filter(|s| !s.is_empty()) {
        let path = PathBuf::from(custom);
        return path.is_file().then_some(path);
    }

    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    if let Some(found) = crate::shell_env::path()
        .and_then(|path| which::which_in("claude", Some(path), &cwd).ok())
    {
        return Some(found);
    }

    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)?;
    let mut candidates = vec![
        home.join(".claude/local/claude"),
        home.join(".local/bin/claude"),
        home.join(".npm-global/bin/claude"),
        home.join(".bun/bin/claude"),
        PathBuf::from("/opt/homebrew/bin/claude"),
        PathBuf::from("/usr/local/bin/claude"),
    ];
    if cfg!(windows) {
        candidates = vec![home.join(".local\\bin\\claude.exe"), home.join(".claude\\local\\claude.exe")];
        if let Some(appdata) = std::env::var_os("APPDATA") {
            candidates.push(PathBuf::from(appdata).join("npm\\claude.cmd"));
        }
    }
    candidates.into_iter().find(|p| p.is_file())
}

/// 実行ファイルからコマンドを組み立てる。Windows の npm の .cmd は cmd 経由で起動する
fn command_for(program: &Path) -> Command {
    let is_script = program
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("cmd") || e.eq_ignore_ascii_case("bat"));
    let mut cmd = if is_script {
        let mut cmd = Command::new("cmd");
        cmd.arg("/C").arg(program);
        cmd
    } else {
        Command::new(program)
    };
    cmd.env_clear().envs(crate::shell_env::get());
    #[cfg(windows)]
    {
        // コンソールウィンドウを出さない
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

#[tauri::command]
pub async fn claude_status(claude_path: Option<String>) -> ClaudeStatus {
    let Some(path) = find_claude(claude_path.as_deref()) else {
        return ClaudeStatus {
            found: false,
            path: None,
            version: None,
            error: Some("claude コマンドが見つかりません".into()),
            logged_in: None,
        };
    };
    let output = command_for(&path)
        .arg("--version")
        .stdin(Stdio::null())
        .kill_on_drop(true)
        .output();
    let output = tokio::time::timeout(std::time::Duration::from_secs(15), output).await;
    let path_str = Some(path.to_string_lossy().into_owned());
    match output {
        Ok(Ok(out)) if out.status.success() => ClaudeStatus {
            found: true,
            path: path_str,
            version: Some(String::from_utf8_lossy(&out.stdout).trim().to_string()),
            error: None,
            logged_in: auth_status(&path).await,
        },
        Ok(Ok(out)) => ClaudeStatus {
            found: false,
            path: path_str,
            version: None,
            error: Some(String::from_utf8_lossy(&out.stderr).trim().to_string()),
            logged_in: None,
        },
        Ok(Err(e)) => ClaudeStatus {
            found: false,
            path: path_str,
            version: None,
            error: Some(e.to_string()),
            logged_in: None,
        },
        Err(_) => ClaudeStatus {
            found: false,
            path: path_str,
            version: None,
            error: Some("claude --version が応答しません".into()),
            logged_in: None,
        },
    }
}

/// `claude auth status --json` でログインしているか確かめる。
/// トークンの期限切れまでは分からないので、送信時のエラーでも判定する(フロントエンド側)
async fn auth_status(program: &Path) -> Option<bool> {
    let output = command_for(program)
        .args(["auth", "status", "--json"])
        .stdin(Stdio::null())
        .kill_on_drop(true)
        .output();
    let out = tokio::time::timeout(std::time::Duration::from_secs(15), output).await.ok()?.ok()?;
    let json: serde_json::Value = serde_json::from_slice(&out.stdout).ok()?;
    json.get("loggedIn")?.as_bool()
}

/// ログインはブラウザとのやり取りが要るので、OS のターミナルで `claude auth login` を開く。
/// ログイン情報はユーザー単位(~/.claude、macOS はキーチェーン)で共有されるため、
/// どのディレクトリで行ってもアプリから使える
#[tauri::command]
pub fn claude_open_login(app: AppHandle, claude_path: Option<String>) -> Result<(), String> {
    let program = find_claude(claude_path.as_deref())
        .ok_or("claude コマンドが見つかりません")?
        .to_string_lossy()
        .into_owned();
    let dir = crate::app_data_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    open_login_terminal(&program, &dir)
}

#[cfg(target_os = "macos")]
fn open_login_terminal(program: &str, dir: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    // .command ファイルは Finder から開くとターミナルで実行される
    let script = dir.join("claude-login.command");
    let body = format!(
        "#!/bin/zsh -l\n'{}' auth login\necho\necho 'ログインが終わったら、このウィンドウを閉じて Storift に戻ってください。'\n",
        program.replace('\'', "'\\''")
    );
    std::fs::write(&script, body).map_err(|e| e.to_string())?;
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    std::process::Command::new("open")
        .arg(&script)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("ターミナルを開けません: {e}"))
}

#[cfg(windows)]
fn open_login_terminal(program: &str, _dir: &Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    // start で新しいコンソールを開き、終わっても閉じないよう /K で実行する
    std::process::Command::new("cmd")
        .raw_arg(format!(r#"/C start "Claude Code login" cmd /K ""{program}" auth login""#))
        .envs(crate::shell_env::get())
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("コマンドプロンプトを開けません: {e}"))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_login_terminal(program: &str, _dir: &Path) -> Result<(), String> {
    let quoted = format!("'{}'", program.replace('\'', "'\\''"));
    let script = format!(
        "{quoted} auth login; echo; echo 'ログインが終わったら Enter で閉じてください。'; read _"
    );
    // よくある端末を順に試す(引数の渡し方が端末ごとに違う)
    let candidates: [(&str, &[&str]); 7] = [
        ("x-terminal-emulator", &["-e"]),
        ("gnome-terminal", &["--"]),
        ("konsole", &["-e"]),
        ("xfce4-terminal", &["-x"]),
        ("kitty", &[]),
        ("alacritty", &["-e"]),
        ("xterm", &["-e"]),
    ];
    let env = crate::shell_env::get();
    for (terminal, prefix) in candidates {
        let spawned = std::process::Command::new(terminal)
            .args(prefix)
            .args(["sh", "-c", &script])
            .envs(env)
            .spawn();
        if spawned.is_ok() {
            return Ok(());
        }
    }
    Err("ターミナルを開けませんでした。端末で `claude auth login` を実行してください。".into())
}

/// 実行ごとに作る MCP 設定ファイルの名前(app_data_dir 直下)
const MCP_CONFIG_PREFIX: &str = "mcp-";

fn mcp_config_path(dir: &Path, request_id: &str) -> PathBuf {
    dir.join(format!("{MCP_CONFIG_PREFIX}{request_id}.json"))
}

/// `--mcp-config` に渡す設定。トークンと実行 ID・編集モードをヘッダーで運ぶ
fn mcp_config_json(url: &str, token: &str, request_id: &str, edit_mode: Option<&str>) -> String {
    serde_json::json!({
        "mcpServers": {
            mcp::SERVER_NAME: {
                "type": "http",
                "url": url,
                "headers": {
                    "Authorization": format!("Bearer {token}"),
                    "X-Storift-Run": request_id,
                    "X-Storift-Mode": edit_mode.unwrap_or("suggest"),
                }
            }
        }
    })
    .to_string()
}

/// トークンを含むので所有者だけが読める権限(0600)で書く
fn write_private(path: &Path, body: &str) -> std::io::Result<()> {
    use std::io::Write;
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    opts.open(path)?.write_all(body.as_bytes())
}

/// 前回の異常終了などで残った設定ファイルを消す(起動時)
pub fn remove_stale_mcp_configs(app: &AppHandle) {
    let Ok(dir) = crate::app_data_dir(app) else { return };
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with(MCP_CONFIG_PREFIX) && name.ends_with(".json") {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

fn build_args(req: &SendRequest, mcp_config: &Path) -> Vec<String> {
    let mcp_tools = mcp::allowed_tool_names(req.edit_mode.as_deref());
    // 組み込みのツールは Web 系だけ。ファイルの読み書きは MCP のツールで行う
    let builtin: Vec<&str> = if req.allow_web { WEB_TOOLS.to_vec() } else { Vec::new() };
    let mut allowed: Vec<String> = mcp_tools;
    allowed.extend(builtin.iter().map(|s| s.to_string()));
    let mut args: Vec<String> = [
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--permission-mode",
        "default",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    // 使えるツールそのものを絞る。ツール定義・スキルの説明は毎回のプロンプトに載るので、
    // 執筆の相談に要らないものを外すと 1 回あたりのトークンが大きく減る
    args.push("--tools".into());
    args.push(builtin.join(","));
    args.push("--strict-mcp-config".into());
    args.push("--mcp-config".into());
    args.push(mcp_config.to_string_lossy().into_owned());
    args.push("--disable-slash-commands".into());
    args.push("--allowedTools".into());
    args.push(allowed.join(","));
    args.push("--disallowedTools".into());
    args.push(DENIED_TOOLS.join(","));
    if let Some(id) = req.session_id.as_deref().filter(|s| !s.is_empty()) {
        args.push("--resume".into());
        args.push(id.into());
    }
    if let Some(model) = req.model.as_deref().filter(|s| !s.is_empty()) {
        args.push("--model".into());
        args.push(model.into());
    }
    if let Some(prompt) = req.append_system_prompt.as_deref().filter(|s| !s.is_empty()) {
        args.push("--append-system-prompt".into());
        args.push(prompt.into());
    }
    args
}

#[tauri::command]
pub async fn claude_send(
    app: AppHandle,
    state: State<'_, ClaudeState>,
    mcp_state: State<'_, Arc<McpState>>,
    ollama_state: State<'_, Arc<OllamaState>>,
    request: SendRequest,
) -> Result<(), String> {
    if request.provider.as_deref() == Some("ollama") {
        return send_ollama(app, state, mcp_state.inner().clone(), ollama_state.inner().clone(), request);
    }
    let program = find_claude(request.claude_path.as_deref()).ok_or_else(|| {
        "claude コマンドが見つかりません。Claude Code をインストールするか、設定で実行ファイルを指定してください。"
            .to_string()
    })?;
    // 設定ファイル名に使うので、パスとして危険な文字を含む ID は受け付けない
    if request.request_id.is_empty()
        || !request.request_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("requestId に使えない文字が含まれています".into());
    }
    let data_dir = crate::app_data_dir(&app)?;
    let cwd = data_dir.join("claude-cwd");
    std::fs::create_dir_all(&cwd).map_err(|e| e.to_string())?;
    let config_path = mcp_config_path(&data_dir, &request.request_id);
    write_private(
        &config_path,
        &mcp_config_json(&mcp_state.url(), mcp_state.token(), &request.request_id, request.edit_mode.as_deref()),
    )
    .map_err(|e| format!("MCP 設定ファイルを書けません: {e}"))?;

    let spawned = command_for(&program)
        .args(build_args(&request, &config_path))
        .current_dir(&cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn();
    let mut child = match spawned {
        Ok(child) => child,
        Err(e) => {
            let _ = std::fs::remove_file(&config_path);
            return Err(format!("claude を起動できません: {e}"));
        }
    };

    // プロンプトは長くなり、Windows ではコマンドラインの引用も厄介なので標準入力で渡す
    let mut stdin = child.stdin.take().ok_or("標準入力を開けません")?;
    let prompt = request.prompt;
    tokio::spawn(async move {
        let _ = stdin.write_all(prompt.as_bytes()).await;
        let _ = stdin.shutdown().await;
    });

    let stdout = child.stdout.take().ok_or("標準出力を開けません")?;
    let mut stderr = child.stderr.take().ok_or("標準エラー出力を開けません")?;
    let (cancel_tx, cancel_rx) = oneshot::channel();
    let request_id = request.request_id;
    state
        .running
        .lock()
        .map_err(|e| e.to_string())?
        .insert(request_id.clone(), cancel_tx);
    state.prune();
    let log = Arc::new(Mutex::new(RunLog::default()));
    state
        .runs
        .lock()
        .map_err(|e| e.to_string())?
        .insert(request_id.clone(), log.clone());

    let stderr_task = tokio::spawn(async move {
        let mut buf = Vec::new();
        let _ = stderr.read_to_end(&mut buf).await;
        let text = String::from_utf8_lossy(&buf).into_owned();
        // 長いときは末尾(直近のエラー)を残す
        match text.char_indices().rev().nth(STDERR_LIMIT) {
            Some((i, _)) => text[i..].to_string(),
            None => text,
        }
    });

    let app_for_lines = app.clone();
    let id_for_lines = request_id.clone();
    let log_for_lines = log.clone();
    let stdout_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            push_line(&app_for_lines, &log_for_lines, &id_for_lines, &line);
        }
    });

    tokio::spawn(async move {
        let mut cancelled = false;
        let status = tokio::select! {
            status = child.wait() => status.ok(),
            _ = cancel_rx => {
                cancelled = true;
                kill_tree(&mut child).await;
                child.wait().await.ok()
            }
        };
        let _ = stdout_task.await;
        let stderr = stderr_task.await.unwrap_or_default();
        let _ = std::fs::remove_file(&config_path);
        if let Some(state) = app.try_state::<ClaudeState>() {
            if let Ok(mut running) = state.running.lock() {
                running.remove(&request_id);
            }
        }
        let exit = ExitEvent { request_id, code: status.and_then(|s| s.code()), cancelled, stderr };
        if let Ok(mut l) = log.lock() {
            l.exit = Some(exit.clone());
            l.finished_at = Some(Instant::now());
        }
        let _ = app.emit("claude://exit", exit);
    });

    Ok(())
}

/// Ollama での実行。claude の起動と同じく、出力を溜めて流し、終了を知らせる
fn send_ollama(
    app: AppHandle,
    state: State<'_, ClaudeState>,
    mcp_state: Arc<McpState>,
    ollama_state: Arc<OllamaState>,
    request: SendRequest,
) -> Result<(), String> {
    let (cancel_tx, cancel_rx) = oneshot::channel();
    let request_id = request.request_id.clone();
    state.running.lock().map_err(|e| e.to_string())?.insert(request_id.clone(), cancel_tx);
    state.prune();
    let log = Arc::new(Mutex::new(RunLog::default()));
    state.runs.lock().map_err(|e| e.to_string())?.insert(request_id.clone(), log.clone());

    let params = ollama::Params {
        run_id: request_id.clone(),
        prompt: request.prompt,
        session_id: request.session_id,
        model: request.model,
        url: request.ollama_url,
        edit_mode: request.edit_mode,
        append_system_prompt: request.append_system_prompt,
    };
    tauri::async_runtime::spawn(async move {
        let emit_app = app.clone();
        let emit_log = log.clone();
        let emit_id = request_id.clone();
        let emit = move |event: serde_json::Value| push_line(&emit_app, &emit_log, &emit_id, &event.to_string());
        let mut cancelled = false;
        let result = tokio::select! {
            r = ollama::run(&mcp_state, &ollama_state, params, &emit) => Some(r),
            _ = cancel_rx => { cancelled = true; None }
        };
        let (code, stderr) = match result {
            Some(Ok(())) => (Some(0), String::new()),
            Some(Err(message)) => (Some(1), message),
            None => (None, String::new()),
        };
        if let Some(state) = app.try_state::<ClaudeState>() {
            if let Ok(mut running) = state.running.lock() {
                running.remove(&request_id);
            }
        }
        let exit = ExitEvent { request_id, code, cancelled, stderr };
        if let Ok(mut l) = log.lock() {
            l.exit = Some(exit.clone());
            l.finished_at = Some(Instant::now());
        }
        let _ = app.emit("claude://exit", exit);
    });
    Ok(())
}

/// 子プロセスを止める。Windows では cmd 経由で起動した node まで止めるため木ごと終了する
async fn kill_tree(child: &mut tokio::process::Child) {
    #[cfg(windows)]
    if let Some(pid) = child.id() {
        let mut cmd = Command::new("taskkill");
        cmd.args(["/PID", &pid.to_string(), "/T", "/F"]);
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
        let _ = cmd.status().await;
    }
    let _ = child.kill().await;
}

#[tauri::command]
pub fn claude_cancel(state: State<'_, ClaudeState>, request_id: String) -> Result<(), String> {
    if let Some(tx) = state.running.lock().map_err(|e| e.to_string())?.remove(&request_id) {
        let _ = tx.send(());
    }
    Ok(())
}

/// 再読み込みなどで画面が入れ替わった後に、実行中(または直前に終わった)の出力を受け取り直す。
/// 記録が無ければ(アプリの再起動など) None
#[tauri::command]
pub fn claude_attach(state: State<'_, ClaudeState>, request_id: String) -> Option<AttachResult> {
    let log = state.runs.lock().ok()?.get(&request_id)?.clone();
    let log = log.lock().ok()?;
    Some(AttachResult { lines: log.lines.clone(), exit: log.exit.clone() })
}

/// 結果を受け取り終えた実行の記録を捨てる
#[tauri::command]
pub fn claude_release(state: State<'_, ClaudeState>, request_id: String) {
    if let Ok(mut runs) = state.runs.lock() {
        runs.remove(&request_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(session: Option<&str>, web: bool, mode: Option<&str>) -> SendRequest {
        SendRequest {
            request_id: "r".into(),
            prompt: "p".into(),
            session_id: session.map(Into::into),
            model: None,
            allow_web: web,
            claude_path: None,
            append_system_prompt: None,
            edit_mode: mode.map(Into::into),
            provider: None,
            ollama_url: None,
        }
    }

    fn value_of<'a>(args: &'a [String], flag: &str) -> &'a str {
        &args[args.iter().position(|a| a == flag).unwrap() + 1]
    }

    #[test]
    fn args_limit_tools_and_resume() {
        let cfg = Path::new("/tmp/mcp-r.json");
        let args = build_args(&request(Some("abc"), false, Some("confirm")), cfg);
        let allowed = value_of(&args, "--allowedTools");
        assert_eq!(value_of(&args, "--tools"), "", "組み込みツールは出さない");
        assert!(args.iter().any(|a| a == "--strict-mcp-config"));
        assert_eq!(value_of(&args, "--mcp-config"), "/tmp/mcp-r.json");
        assert!(!allowed.contains("WebSearch"));
        for tool in ["Read", "Glob", "Grep", "Edit", "Write", "Bash"] {
            assert!(!allowed.split(',').any(|t| t == tool), "{tool} は許可しない");
        }
        let resume = args.iter().position(|a| a == "--resume").unwrap();
        assert_eq!(args[resume + 1], "abc");

        let args = build_args(&request(None, true, Some("confirm")), cfg);
        assert_eq!(value_of(&args, "--tools"), "WebSearch,WebFetch");
        assert!(value_of(&args, "--allowedTools").contains("WebSearch"));
        assert!(!args.iter().any(|a| a == "--resume"));
    }

    #[test]
    fn args_list_storift_tools_by_edit_mode() {
        let cfg = Path::new("/tmp/mcp-r.json");
        for mode in [Some("confirm"), Some("auto")] {
            let allowed = value_of(&build_args(&request(None, false, mode), cfg), "--allowedTools").to_string();
            assert!(allowed.split(',').all(|t| t.starts_with("mcp__storift__")));
            assert!(allowed.contains("mcp__storift__propose_edit"));
            assert!(allowed.contains("mcp__storift__propose_create"));
            assert!(allowed.contains("mcp__storift__propose_delete"));
            assert!(allowed.contains("mcp__storift__get_scene"));
        }
        for mode in [Some("suggest"), None] {
            let allowed = value_of(&build_args(&request(None, false, mode), cfg), "--allowedTools").to_string();
            assert!(!allowed.contains("propose_"));
            assert!(allowed.contains("mcp__storift__list_items"));
        }
    }

    #[test]
    fn args_deny_file_and_shell_tools() {
        let args = build_args(&request(None, true, Some("auto")), Path::new("c.json"));
        let denied: Vec<&str> = value_of(&args, "--disallowedTools").split(',').collect();
        for tool in ["Bash", "Edit", "MultiEdit", "Write", "NotebookEdit"] {
            assert!(denied.contains(&tool));
        }
    }

    #[test]
    fn mcp_config_carries_token_and_run_headers() {
        let json: serde_json::Value =
            serde_json::from_str(&mcp_config_json("http://127.0.0.1:1/mcp", "tok", "run-1", Some("auto"))).unwrap();
        let server = &json["mcpServers"]["storift"];
        assert_eq!(server["type"], "http");
        assert_eq!(server["url"], "http://127.0.0.1:1/mcp");
        assert_eq!(server["headers"]["Authorization"], "Bearer tok");
        assert_eq!(server["headers"]["X-Storift-Run"], "run-1");
        assert_eq!(server["headers"]["X-Storift-Mode"], "auto");
        let json: serde_json::Value = serde_json::from_str(&mcp_config_json("u", "t", "r", None)).unwrap();
        assert_eq!(json["mcpServers"]["storift"]["headers"]["X-Storift-Mode"], "suggest");
    }

    #[cfg(unix)]
    #[test]
    fn config_file_is_private() {
        use std::os::unix::fs::PermissionsExt;
        let path = std::env::temp_dir().join(format!("storift-test-mcp-{}.json", std::process::id()));
        write_private(&path, "{}").unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        std::fs::remove_file(&path).unwrap();
        assert_eq!(mode, 0o600);
    }
}
