//! Claude Code(CLI)の呼び出し。
//!
//! メッセージ 1 件ごとに `claude -p` をヘッドレスで起動し、`stream-json` の出力を
//! 1 行ずつフロントエンドへイベントで流す。会話の継続は Claude Code の
//! セッション ID(`--resume`)で行う。作業ディレクトリは原稿を書き出した
//! ワークスペースで、使えるツールは読み取り系に限る(原稿の正本はアプリ側)。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::oneshot;

/// 読み取り専用のツール。原稿の書き換えはアプリ側で人が行う
const READ_TOOLS: &[&str] = &["Read", "Glob", "Grep"];
const WEB_TOOLS: &[&str] = &["WebSearch", "WebFetch"];
const DENIED_TOOLS: &[&str] = &["Bash", "Edit", "MultiEdit", "Write", "NotebookEdit"];

/// エラー表示用に残す標準エラー出力の上限
const STDERR_LIMIT: usize = 16 * 1024;

#[derive(Default)]
pub struct ClaudeState {
    running: Mutex<HashMap<String, oneshot::Sender<()>>>,
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
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LineEvent<'a> {
    request_id: &'a str,
    line: &'a str,
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

fn build_args(req: &SendRequest) -> Vec<String> {
    let mut allowed: Vec<&str> = READ_TOOLS.to_vec();
    if req.allow_web {
        allowed.extend_from_slice(WEB_TOOLS);
    }
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
    // 使えるツールそのものを絞る。ツール定義・MCP・スキルの説明は毎回のプロンプトに載るので、
    // 執筆の相談に要らないものを外すと 1 回あたりのトークンが大きく減る
    args.push("--tools".into());
    args.push(allowed.join(","));
    args.push("--strict-mcp-config".into());
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
    request: SendRequest,
) -> Result<(), String> {
    let program = find_claude(request.claude_path.as_deref()).ok_or_else(|| {
        "claude コマンドが見つかりません。Claude Code をインストールするか、設定で実行ファイルを指定してください。"
            .to_string()
    })?;
    let cwd = crate::workspace::workspace_dir(&app)?;
    std::fs::create_dir_all(&cwd).map_err(|e| e.to_string())?;

    let mut child = command_for(&program)
        .args(build_args(&request))
        .current_dir(&cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("claude を起動できません: {e}"))?;

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
    let stdout_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            let _ = app_for_lines.emit(
                "claude://line",
                LineEvent { request_id: &id_for_lines, line: &line },
            );
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
        if let Some(state) = app.try_state::<ClaudeState>() {
            if let Ok(mut running) = state.running.lock() {
                running.remove(&request_id);
            }
        }
        let _ = app.emit(
            "claude://exit",
            ExitEvent { request_id, code: status.and_then(|s| s.code()), cancelled, stderr },
        );
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

#[cfg(test)]
mod tests {
    use super::*;

    fn request(session: Option<&str>, web: bool) -> SendRequest {
        SendRequest {
            request_id: "r".into(),
            prompt: "p".into(),
            session_id: session.map(Into::into),
            model: None,
            allow_web: web,
            claude_path: None,
            append_system_prompt: None,
        }
    }

    #[test]
    fn args_limit_tools_and_resume() {
        let args = build_args(&request(Some("abc"), false));
        let allowed = &args[args.iter().position(|a| a == "--allowedTools").unwrap() + 1];
        let tools = &args[args.iter().position(|a| a == "--tools").unwrap() + 1];
        assert_eq!(allowed, tools);
        assert!(args.iter().any(|a| a == "--strict-mcp-config"));
        assert!(!allowed.contains("WebSearch"));
        assert!(!allowed.contains("Edit"));
        let resume = args.iter().position(|a| a == "--resume").unwrap();
        assert_eq!(args[resume + 1], "abc");

        let args = build_args(&request(None, true));
        assert!(args.iter().any(|a| a.contains("WebSearch")));
        assert!(!args.iter().any(|a| a == "--resume"));
    }
}
