mod claude;
mod shell_env;
mod workspace;

use tauri::Manager;
use tauri_plugin_window_state::StateFlags;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // 枠(装飾)の有無は保存しない。前回の状態が復元されると、Windows で外したはずの OS のタイトルバーが戻ってしまう
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() & !StateFlags::DECORATIONS)
                .build(),
        )
        .manage(claude::ClaudeState::default())
        .setup(|app| {
            // GUI から起動すると PATH がログインシェルと異なるため、先に読み込んでおく
            std::thread::spawn(shell_env::load);
            let dir = workspace::workspace_dir(app.handle())?;
            std::fs::create_dir_all(&dir)?;

            // Windows / Linux は OS の枠を外し、アプリ側のタイトルバー(TitleBar.svelte)を使う。
            // 設定ファイル(tauri.windows.conf.json など)でも外しているが、念のため起動時にも外す
            #[cfg(not(target_os = "macos"))]
            if let Some(window) = app.get_webview_window("main") {
                window.set_decorations(false)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            claude::claude_status,
            claude::claude_send,
            claude::claude_cancel,
            claude::claude_attach,
            claude::claude_release,
            claude::claude_open_login,
            workspace::workspace_sync,
            workspace::workspace_info,
            workspace::workspace_open,
        ])
        .run(tauri::generate_context!())
        .expect("Storift の起動に失敗しました");
}

/// アプリが使うディレクトリを取得する(コマンドから共通で使う)
pub(crate) fn app_data_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}
