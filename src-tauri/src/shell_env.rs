//! ログインシェルの環境変数を取り込む。
//!
//! macOS や Linux のデスクトップから起動したアプリは、シェルの設定ファイル
//! (.zshrc など)で追加した PATH を持たない。Claude Code は ~/.local/bin や
//! Homebrew・npm のグローバルに入っていることが多いため、起動時に一度だけ
//! ログインシェルから環境変数を読み込み、子プロセスへ渡す。

use std::collections::HashMap;
use std::sync::OnceLock;

static SHELL_ENV: OnceLock<HashMap<String, String>> = OnceLock::new();

/// 子プロセスに渡す環境変数(現在の環境にシェルの環境を重ねたもの)
pub fn get() -> &'static HashMap<String, String> {
    SHELL_ENV.get_or_init(read)
}

/// 起動時に裏で読み込んでおく(初回のメッセージ送信を待たせないため)
pub fn load() {
    let _ = get();
}

fn read() -> HashMap<String, String> {
    let mut env: HashMap<String, String> = std::env::vars().collect();
    #[cfg(unix)]
    if let Some(shell_env) = read_login_shell_env() {
        for (key, value) in shell_env {
            // シェル固有で、引き継ぐと挙動が変わるものは除く
            if matches!(key.as_str(), "PWD" | "OLDPWD" | "SHLVL" | "_") {
                continue;
            }
            env.insert(key, value);
        }
    }
    env
}

#[cfg(unix)]
fn read_login_shell_env() -> Option<HashMap<String, String>> {
    use std::io::Read;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    const MARKER: &str = "__STORIFT_ENV_START__";
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
    let mut child = Command::new(&shell)
        .args(["-ilc", &format!("printf '{MARKER}'; env -0")])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    // 設定ファイルが重いシェルで固まらないよう、待つのは数秒まで
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(50)),
            _ => {
                let _ = child.kill();
                return None;
            }
        }
    }

    let mut out = Vec::new();
    child.stdout.take()?.read_to_end(&mut out).ok()?;
    let out = String::from_utf8_lossy(&out);
    let body = &out[out.find(MARKER)? + MARKER.len()..];
    Some(
        body.split('\0')
            .filter_map(|entry| entry.split_once('='))
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect(),
    )
}

/// 子プロセス用の PATH
pub fn path() -> Option<String> {
    get().get("PATH").or_else(|| get().get("Path")).cloned()
}
