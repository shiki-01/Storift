mod claude;
mod shell_env;
mod workspace;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(claude::ClaudeState::default())
        .setup(|app| {
            // GUI から起動すると PATH がログインシェルと異なるため、先に読み込んでおく
            std::thread::spawn(shell_env::load);
            let dir = workspace::workspace_dir(app.handle())?;
            std::fs::create_dir_all(&dir)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            claude::claude_status,
            claude::claude_send,
            claude::claude_cancel,
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
