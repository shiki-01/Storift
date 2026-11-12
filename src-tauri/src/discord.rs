//! Discord Rich Presence(拡張機能「Discord Rich Presence」)。
//!
//! 利用者の端末で動いている Discord クライアントへ、ローカルの IPC(Unix ソケット / 名前付きパイプ)で
//! 「執筆中」の表示を渡す。Discord が起動していない・つながらないときは何もしない(エラーも出さない)。
//!
//! IPC の読み書きは止まることがあるので、専用のスレッドで行う。コマンドは依頼をチャネルで渡して結果を待つだけで、
//! UI のスレッドは止めない。表示する内容は、フロントエンド(`src/lib/extensions/builtin/discord/`)が決める。

use std::sync::mpsc::{self, Sender};
use std::sync::Mutex;
use std::time::Duration;

use discord_rich_presence::activity::{Activity, Assets, Timestamps};
use discord_rich_presence::{DiscordIpc, DiscordIpcClient};
use serde::Deserialize;
use tokio::sync::oneshot;

/// 依頼の結果を待つ上限。Discord が応答しないときに、呼び出しを待たせ続けない
const REPLY_TIMEOUT: Duration = Duration::from_secs(5);

/// 表示する内容。空の項目は送らない
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresencePayload {
    details: Option<String>,
    state: Option<String>,
    /// 経過時間の起点(Unix 秒)
    start_timestamp: Option<i64>,
    large_image: Option<String>,
    large_text: Option<String>,
    small_image: Option<String>,
    small_text: Option<String>,
}

enum Request {
    /// 表示を設定する。つながっていなければ、ここで接続を試みる
    Set {
        application_id: String,
        payload: PresencePayload,
        reply: oneshot::Sender<bool>,
    },
    /// 表示を消して、接続を閉じる
    Clear {
        reply: Option<oneshot::Sender<bool>>,
    },
}

/// IPC を担当するスレッドへの送り口。スレッドは最初の依頼で起動する
#[derive(Default)]
pub struct DiscordState {
    sender: Mutex<Option<Sender<Request>>>,
}

impl DiscordState {
    fn send(&self, request: Request) -> Result<(), String> {
        let mut guard = self.sender.lock().map_err(|e| e.to_string())?;
        let request = match guard.as_ref() {
            Some(sender) => match sender.send(request) {
                Ok(()) => return Ok(()),
                // スレッドが終了していた: 作り直して送り直す
                Err(mpsc::SendError(request)) => request,
            },
            None => request,
        };
        let (sender, receiver) = mpsc::channel::<Request>();
        std::thread::Builder::new()
            .name("discord-presence".into())
            .spawn(move || worker(receiver))
            .map_err(|e| e.to_string())?;
        sender.send(request).map_err(|e| e.to_string())?;
        *guard = Some(sender);
        Ok(())
    }

    /// アプリの終了時に呼ぶ。表示を消す(結果は待たない)
    pub fn clear_on_exit(&self) {
        if let Ok(guard) = self.sender.lock() {
            if let Some(sender) = guard.as_ref() {
                let _ = sender.send(Request::Clear { reply: None });
            }
        }
    }
}

/// Application ID は数字だけ(Discord の ID)
fn valid_application_id(id: &str) -> bool {
    (15..=25).contains(&id.len()) && id.chars().all(|c| c.is_ascii_digit())
}

fn non_empty(value: &Option<String>) -> Option<&str> {
    value.as_deref().map(str::trim).filter(|s| !s.is_empty())
}

fn build_activity(payload: &PresencePayload) -> Activity<'_> {
    let mut activity = Activity::new();
    if let Some(details) = non_empty(&payload.details) {
        activity = activity.details(details);
    }
    if let Some(state) = non_empty(&payload.state) {
        activity = activity.state(state);
    }
    if let Some(start) = payload.start_timestamp {
        activity = activity.timestamps(Timestamps::new().start(start));
    }
    let mut assets = Assets::new();
    let mut has_assets = false;
    if let Some(key) = non_empty(&payload.large_image) {
        assets = assets.large_image(key);
        has_assets = true;
    }
    if let Some(text) = non_empty(&payload.large_text) {
        assets = assets.large_text(text);
        has_assets = true;
    }
    if let Some(key) = non_empty(&payload.small_image) {
        assets = assets.small_image(key);
        has_assets = true;
    }
    if let Some(text) = non_empty(&payload.small_text) {
        assets = assets.small_text(text);
        has_assets = true;
    }
    if has_assets {
        activity = activity.assets(assets);
    }
    activity
}

/// つながっている接続(Application ID ごと。ID が変わったらつなぎ直す)
struct Connection {
    application_id: String,
    client: DiscordIpcClient,
}

fn set_presence(
    connection: &mut Option<Connection>,
    application_id: &str,
    payload: &PresencePayload,
) -> bool {
    // Application ID が変わったら、前の接続を閉じる
    if connection
        .as_ref()
        .is_some_and(|c| c.application_id != application_id)
    {
        close(connection);
    }
    if connection.is_none() {
        let mut client = DiscordIpcClient::new(application_id);
        // Discord が起動していない・ソケットが無いときは、ここで失敗する(何もしない)
        if client.connect().is_err() {
            return false;
        }
        *connection = Some(Connection {
            application_id: application_id.to_string(),
            client,
        });
    }
    let Some(current) = connection.as_mut() else {
        return false;
    };
    if current
        .client
        .set_activity(build_activity(payload))
        .is_err()
    {
        // 途中で Discord が終了したなど。接続を捨てる(次の依頼でつなぎ直す)
        close(connection);
        return false;
    }
    true
}

fn close(connection: &mut Option<Connection>) {
    if let Some(mut current) = connection.take() {
        let _ = current.client.clear_activity();
        let _ = current.client.close();
    }
}

fn worker(receiver: mpsc::Receiver<Request>) {
    let mut connection: Option<Connection> = None;
    while let Ok(request) = receiver.recv() {
        match request {
            Request::Set {
                application_id,
                payload,
                reply,
            } => {
                let ok = set_presence(&mut connection, &application_id, &payload);
                let _ = reply.send(ok);
            }
            Request::Clear { reply } => {
                let had_connection = connection.is_some();
                close(&mut connection);
                if let Some(reply) = reply {
                    let _ = reply.send(had_connection);
                }
            }
        }
    }
    close(&mut connection);
}

async fn wait_reply(receiver: oneshot::Receiver<bool>) -> bool {
    matches!(
        tokio::time::timeout(REPLY_TIMEOUT, receiver).await,
        Ok(Ok(true))
    )
}

/// Rich Presence を設定する。Discord に渡せたら `true`、Discord が起動していないなどで渡せなければ `false`
#[tauri::command]
pub async fn discord_set_activity(
    state: tauri::State<'_, DiscordState>,
    application_id: String,
    activity: PresencePayload,
) -> Result<bool, String> {
    let application_id = application_id.trim().to_string();
    if !valid_application_id(&application_id) {
        return Err("Application ID が正しくありません".into());
    }
    let (reply, receiver) = oneshot::channel();
    state.send(Request::Set {
        application_id,
        payload: activity,
        reply,
    })?;
    Ok(wait_reply(receiver).await)
}

/// Rich Presence を消して、Discord との接続を閉じる。接続していなければ何もしない(`false`)
#[tauri::command]
pub async fn discord_clear_activity(state: tauri::State<'_, DiscordState>) -> Result<bool, String> {
    let (reply, receiver) = oneshot::channel();
    state.send(Request::Clear { reply: Some(reply) })?;
    Ok(wait_reply(receiver).await)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn application_id_は数字だけを受け付ける() {
        assert!(valid_application_id("1570411903996661791"));
        assert!(!valid_application_id(""));
        assert!(!valid_application_id("123"));
        assert!(!valid_application_id("15704119039966617a1"));
        assert!(!valid_application_id("1570411903996661791 "));
    }

    #[test]
    fn 空の項目は送らない() {
        let payload = PresencePayload {
            details: Some("執筆中".into()),
            state: Some("  ".into()),
            start_timestamp: Some(1_700_000_000),
            large_image: Some("logo".into()),
            large_text: None,
            small_image: None,
            small_text: None,
        };
        let json = serde_json::to_value(build_activity(&payload)).unwrap();
        assert_eq!(json["details"], "執筆中");
        assert!(json.get("state").is_none());
        assert_eq!(json["timestamps"]["start"], 1_700_000_000i64);
        assert_eq!(json["assets"]["large_image"], "logo");
        assert!(json["assets"].get("small_image").is_none());
    }
}
