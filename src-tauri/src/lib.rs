mod claude;
mod discord;
mod mcp;
mod ollama;
mod secrets;
mod shell_env;
mod workspace;

use tauri::Manager;
use tauri_plugin_window_state::StateFlags;

pub fn run() {
    let builder = tauri::Builder::default();

    // 単一インスタンス。Windows / Linux では storift:// の deep link が新しいプロセスとして起動するため、
    // その URL を実行中のプロセスへ渡して(deep-link 機能)、自分は終了する。他のプラグインより先に登録する
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }));

    builder
        // storift://(Monolog. 連携の認可の戻りなど)
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        // 更新の確認・ダウンロード・再起動(署名付きの配布物だけを受け付ける)
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // AI プロバイダの HTTP 通信(Rust 側から送るので CORS の影響を受けない)。送れる先は capabilities のスコープで制限する
        .plugin(tauri_plugin_http::init())
        // 枠(装飾)の有無は保存しない。前回の状態が復元されると、Windows で外したはずの OS のタイトルバーが戻ってしまう
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() & !StateFlags::DECORATIONS)
                .build(),
        )
        .manage(claude::ClaudeState::default())
        .manage(std::sync::Arc::new(ollama::OllamaState::default()))
        // Discord Rich Presence(拡張機能)。IPC は専用のスレッドで行う
        .manage(discord::DiscordState::default())
        .setup(|app| {
            // GUI から起動すると PATH がログインシェルと異なるため、先に読み込んでおく
            std::thread::spawn(shell_env::load);
            let dir = workspace::workspace_dir(app.handle())?;
            std::fs::create_dir_all(&dir)?;
            // Claude Code に見せる MCP サーバー。前回の異常終了で残った設定ファイルも掃除する
            claude::remove_stale_mcp_configs(app.handle());
            let mcp_state = mcp::start(app.handle())?;
            app.manage(mcp_state);

            // 開発中(未インストール)でも storift:// を受け取れるよう、実行時にスキームを登録する。
            // インストール版は、インストーラーが tauri.conf.json の設定で登録する
            #[cfg(all(debug_assertions, any(target_os = "linux", windows)))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().register_all()?;
            }

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
            ollama::ollama_status,
            mcp::mcp_respond,
            mcp::ai_tool_definitions,
            secrets::secret_set,
            secrets::secret_get,
            secrets::secret_delete,
            workspace::workspace_sync,
            workspace::workspace_info,
            workspace::workspace_open,
            discord::discord_set_activity,
            discord::discord_clear_activity,
        ])
        .build(tauri::generate_context!())
        .expect("Storift の起動に失敗しました")
        .run(|app, event| {
            // アプリの終了時に、Discord の表示を消す(接続していなければ何もしない)
            if let tauri::RunEvent::Exit = event {
                app.state::<discord::DiscordState>().clear_on_exit();
            }
        });
}

/// アプリが使うディレクトリを取得する(コマンドから共通で使う)
pub(crate) fn app_data_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}
