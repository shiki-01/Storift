//! Claude Code に見せる MCP サーバー(Streamable HTTP の最小実装)。
//!
//! 127.0.0.1 のランダムなポートで待ち受け、JSON-RPC(`initialize` / `tools/list` /
//! `tools/call`)に単発の JSON で答える。データの正本はフロントエンド(Dexie)にあるので、
//! ここは中継だけを行う: `tools/call` を受けたら `mcp://request` イベントでフロントへ渡し、
//! フロントが `mcp_respond` で返した結果を JSON-RPC の応答にする。
//!
//! 認証は起動ごとのランダムなトークン(`Authorization: Bearer`)と Host / Origin の検証。
//! 実行ごとの情報(`X-Storift-Run` / `X-Storift-Mode`)は claude に渡す設定ファイルのヘッダーで運ぶ。

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;

pub const SERVER_NAME: &str = "storift";
/// フロントエンドの応答を待つ上限
const RELAY_TIMEOUT: Duration = Duration::from_secs(30);
/// リクエスト 1 件の読み込み上限
const MAX_HEADER: usize = 16 * 1024;
const MAX_BODY: usize = 1024 * 1024;
const READ_TIMEOUT: Duration = Duration::from_secs(10);
const SUPPORTED_VERSIONS: &[&str] = &["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

/// 書き込みを伴うツール。`edit_mode` が suggest のときは公開しない
const EDIT_TOOL: &str = "propose_edit";

/// 公開するツール名(propose_edit を除く読み取り系)
const READ_TOOL_NAMES: &[&str] = &[
    "list_projects",
    "get_outline",
    "list_items",
    "get_scene",
    "get_item",
    "search",
    "get_history",
];

/// 編集モードで propose_edit を公開するか(suggest・未指定・不明な値では公開しない)
pub fn edit_enabled(mode: Option<&str>) -> bool {
    matches!(mode, Some("confirm") | Some("auto"))
}

/// `--allowedTools` に渡す名前(`mcp__storift__<tool>`)
pub fn allowed_tool_names(mode: Option<&str>) -> Vec<String> {
    let mut names: Vec<&str> = READ_TOOL_NAMES.to_vec();
    if edit_enabled(mode) {
        names.push(EDIT_TOOL);
    }
    names.into_iter().map(|n| format!("mcp__{SERVER_NAME}__{n}")).collect()
}

fn tool_definitions(mode: Option<&str>) -> Vec<Value> {
    let project = json!({"type": "string", "description": "省略時は開いている作品"});
    let kind_list = json!({
        "type": "string",
        "enum": ["characters", "plots", "worldbuilding", "memos", "progressLogs", "relationMaps", "history"]
    });
    let kind_item = json!({
        "type": "string",
        "enum": ["chapters", "characters", "plots", "worldbuilding", "memos", "progressLogs", "relationMaps", "history"]
    });
    let mut tools = vec![
        json!({
            "name": "list_projects",
            "description": "作品の一覧(id, title)を返す",
            "inputSchema": {"type": "object", "properties": {}}
        }),
        json!({
            "name": "get_outline",
            "description": "作品の章とシーンの構成を返す",
            "inputSchema": {"type": "object", "properties": {"projectId": project}}
        }),
        json!({
            "name": "list_items",
            "description": "項目の軽量な一覧(id, title, sub)を返す。本文は get_item で取る",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "kind": kind_list,
                    "projectId": project,
                    "limit": {"type": "integer", "minimum": 1},
                    "cursor": {"type": "string", "description": "前回の nextCursor"}
                },
                "required": ["kind"]
            }
        }),
        json!({
            "name": "get_scene",
            "description": "シーン本文を返す。長いときは offset(文字位置)と limit で分割",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "sceneId": {"type": "string"},
                    "offset": {"type": "integer", "minimum": 0},
                    "limit": {"type": "integer", "minimum": 1}
                },
                "required": ["sceneId"]
            }
        }),
        json!({
            "name": "get_item",
            "description": "項目 1 件の全文を返す(章の概要は kind=chapters)",
            "inputSchema": {
                "type": "object",
                "properties": {"kind": kind_item, "id": {"type": "string"}},
                "required": ["kind", "id"]
            }
        }),
        json!({
            "name": "search",
            "description": "シーン本文と各項目を全文検索する",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "kinds": {"type": "array", "items": {"type": "string"}},
                    "projectId": project,
                    "limit": {"type": "integer", "minimum": 1}
                },
                "required": ["query"]
            }
        }),
        json!({
            "name": "get_history",
            "description": "変更履歴の一覧を返す。id を指定するとその 1 件の詳細",
            "inputSchema": {"type": "object", "properties": {"id": {"type": "string"}}}
        }),
    ];
    if edit_enabled(mode) {
        tools.push(json!({
            "name": EDIT_TOOL,
            "description": "シーンや項目の本文を old から new へ置換する編集を提案する(old は一意に一致すること)",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "kind": {
                        "type": "string",
                        "enum": ["scene", "characters", "plots", "worldbuilding", "memos", "progressLogs", "relationMaps", "chapters"]
                    },
                    "id": {"type": "string"},
                    "old": {"type": "string", "description": "置換前の文。対象内で 1 か所だけ一致すること"},
                    "new": {"type": "string"}
                },
                "required": ["kind", "id", "old", "new"]
            }
        }));
    }
    tools
}

/// フロントエンドへ渡す `mcp://request` のペイロード
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RequestEvent {
    pub req_id: String,
    pub run_id: String,
    pub tool: String,
    pub args: Value,
}

/// `mcp_respond` で返される結果
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct McpResult {
    pub text: String,
    #[serde(default)]
    pub is_error: bool,
}

type Emit = Box<dyn Fn(RequestEvent) + Send + Sync>;

pub struct McpState {
    port: u16,
    token: String,
    emit: Emit,
    timeout: Duration,
    counter: AtomicU64,
    pending: Mutex<HashMap<String, oneshot::Sender<McpResult>>>,
}

/// HTTP 層の結果(ステータスと JSON 本文)
#[derive(Debug)]
pub struct Reply {
    pub status: u16,
    pub body: Option<Value>,
}

impl Reply {
    fn status(status: u16) -> Self {
        Reply { status, body: None }
    }
}

fn rpc_ok(id: &Value, result: Value) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "result": result})
}

fn rpc_err(id: &Value, code: i64, message: &str) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}})
}

fn tool_result(text: &str, is_error: bool) -> Value {
    json!({"content": [{"type": "text", "text": text}], "isError": is_error})
}

/// 時間を一定にして比べる(トークンの先頭一致を探られないように)
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

impl McpState {
    pub fn new(port: u16, token: String, emit: Emit, timeout: Duration) -> Self {
        McpState { port, token, emit, timeout, counter: AtomicU64::new(0), pending: Mutex::new(HashMap::new()) }
    }

    pub fn token(&self) -> &str {
        &self.token
    }

    pub fn url(&self) -> String {
        format!("http://127.0.0.1:{}/mcp", self.port)
    }

    /// 認証・Host/Origin の検証をして JSON-RPC を処理する。`headers` のキーは小文字
    pub async fn process(&self, method: &str, path: &str, headers: &HashMap<String, String>, body: &[u8]) -> Reply {
        let host_ok = headers.get("host").is_some_and(|h| {
            *h == format!("127.0.0.1:{}", self.port) || *h == format!("localhost:{}", self.port)
        });
        // ブラウザ(Origin 付き)からの要求は受けない。claude CLI は Origin を付けない
        if !host_ok || headers.contains_key("origin") {
            return Reply::status(403);
        }
        let bearer_ok = headers
            .get("authorization")
            .and_then(|v| v.strip_prefix("Bearer "))
            .is_some_and(|t| constant_time_eq(t.as_bytes(), self.token.as_bytes()));
        if !bearer_ok {
            return Reply::status(401);
        }
        if path != "/mcp" {
            return Reply::status(404);
        }
        if method != "POST" {
            return Reply::status(405);
        }
        let run_id = headers.get("x-storift-run").map(String::as_str).unwrap_or("");
        let mode = headers.get("x-storift-mode").map(String::as_str);
        let Ok(msg) = serde_json::from_slice::<Value>(body) else {
            return Reply { status: 400, body: Some(rpc_err(&Value::Null, -32700, "Parse error")) };
        };
        match self.dispatch(&msg, run_id, mode).await {
            Some(v) => Reply { status: 200, body: Some(v) },
            None => Reply::status(202),
        }
    }

    /// JSON-RPC 1 件の振り分け。id の無い通知には None(202 を返す)
    async fn dispatch(&self, msg: &Value, run_id: &str, mode: Option<&str>) -> Option<Value> {
        let method = msg.get("method").and_then(Value::as_str);
        let id = msg.get("id").cloned()?;
        let Some(method) = method else {
            // 応答メッセージなどは無視する
            return None;
        };
        let params = msg.get("params").cloned().unwrap_or(Value::Null);
        Some(match method {
            "initialize" => {
                let requested = params.get("protocolVersion").and_then(Value::as_str).unwrap_or("");
                let version = SUPPORTED_VERSIONS.iter().find(|v| **v == requested).unwrap_or(&SUPPORTED_VERSIONS[1]);
                rpc_ok(
                    &id,
                    json!({
                        "protocolVersion": version,
                        "capabilities": {"tools": {"listChanged": false}},
                        "serverInfo": {"name": SERVER_NAME, "version": env!("CARGO_PKG_VERSION")}
                    }),
                )
            }
            "ping" => rpc_ok(&id, json!({})),
            "tools/list" => rpc_ok(&id, json!({"tools": tool_definitions(mode)})),
            "tools/call" => {
                let Some(name) = params.get("name").and_then(Value::as_str) else {
                    return Some(rpc_err(&id, -32602, "name が必要です"));
                };
                let known = READ_TOOL_NAMES.contains(&name) || (name == EDIT_TOOL && edit_enabled(mode));
                if !known {
                    return Some(rpc_err(&id, -32602, &format!("不明なツール: {name}")));
                }
                let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
                if !args.is_object() {
                    return Some(rpc_err(&id, -32602, "arguments はオブジェクトで渡してください"));
                }
                // 履歴は編集の対象外(フロントに渡す前にここでも断る)
                if name == EDIT_TOOL && args.get("kind").and_then(Value::as_str) == Some("history") {
                    return Some(rpc_ok(&id, tool_result("history は編集できません", true)));
                }
                let res = self.relay(run_id, name, args).await;
                rpc_ok(&id, tool_result(&res.text, res.is_error))
            }
            _ => rpc_err(&id, -32601, "Method not found"),
        })
    }

    /// フロントへ中継して結果を待つ
    async fn relay(&self, run_id: &str, tool: &str, args: Value) -> McpResult {
        let req_id = format!("mcp-{}", self.counter.fetch_add(1, Ordering::Relaxed) + 1);
        let (tx, rx) = oneshot::channel();
        // 先に登録する(emit 直後に返ってきても取りこぼさない)
        match self.pending.lock() {
            Ok(mut p) => p.insert(req_id.clone(), tx),
            Err(_) => return McpResult { text: "内部エラー".into(), is_error: true },
        };
        (self.emit)(RequestEvent { req_id: req_id.clone(), run_id: run_id.into(), tool: tool.into(), args });
        match tokio::time::timeout(self.timeout, rx).await {
            Ok(Ok(res)) => res,
            Ok(Err(_)) => McpResult { text: "アプリ側で処理できませんでした".into(), is_error: true },
            Err(_) => {
                if let Ok(mut p) = self.pending.lock() {
                    p.remove(&req_id);
                }
                McpResult { text: "アプリからの応答がタイムアウトしました".into(), is_error: true }
            }
        }
    }

    /// `mcp_respond` の本体。待っている要求が無ければ false(タイムアウト後など)
    pub fn respond(&self, req_id: &str, result: McpResult) -> bool {
        let tx = self.pending.lock().ok().and_then(|mut p| p.remove(req_id));
        tx.is_some_and(|tx| tx.send(result).is_ok())
    }
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        202 => "Accepted",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Error",
    }
}

/// 1 接続ぶんの HTTP/1.1 要求を読んで答える(Connection: close)
async fn serve_connection(state: Arc<McpState>, mut stream: TcpStream) {
    let reply = match tokio::time::timeout(READ_TIMEOUT, read_request(&mut stream)).await {
        Ok(Ok((method, path, headers, body))) => state.process(&method, &path, &headers, &body).await,
        Ok(Err(status)) => Reply::status(status),
        Err(_) => Reply::status(400),
    };
    let body = reply.body.map(|v| v.to_string()).unwrap_or_default();
    let mut head = format!("HTTP/1.1 {} {}\r\nConnection: close\r\nContent-Length: {}\r\n", reply.status, reason(reply.status), body.len());
    if reply.status == 405 {
        head.push_str("Allow: POST\r\n");
    }
    if !body.is_empty() {
        head.push_str("Content-Type: application/json\r\n");
    }
    head.push_str("\r\n");
    let _ = stream.write_all(head.as_bytes()).await;
    let _ = stream.write_all(body.as_bytes()).await;
    let _ = stream.shutdown().await;
}

type ParsedRequest = (String, String, HashMap<String, String>, Vec<u8>);

/// 失敗時は返すステータス
async fn read_request(stream: &mut TcpStream) -> Result<ParsedRequest, u16> {
    let mut buf: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 4096];
    let header_end = loop {
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break pos;
        }
        if buf.len() > MAX_HEADER {
            return Err(400);
        }
        let n = stream.read(&mut chunk).await.map_err(|_| 400u16)?;
        if n == 0 {
            return Err(400);
        }
        buf.extend_from_slice(&chunk[..n]);
    };
    let head = std::str::from_utf8(&buf[..header_end]).map_err(|_| 400u16)?;
    let mut lines = head.split("\r\n");
    let mut first = lines.next().unwrap_or("").split(' ');
    let method = first.next().unwrap_or("").to_string();
    let path = first.next().unwrap_or("").to_string();
    let mut headers = HashMap::new();
    for line in lines {
        if let Some((k, v)) = line.split_once(':') {
            headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
        }
    }
    let len: usize = match headers.get("content-length") {
        Some(v) => v.parse().map_err(|_| 400u16)?,
        None => 0,
    };
    if len > MAX_BODY {
        return Err(400);
    }
    let mut body = buf[header_end + 4..].to_vec();
    while body.len() < len {
        let n = stream.read(&mut chunk).await.map_err(|_| 400u16)?;
        if n == 0 {
            return Err(400);
        }
        body.extend_from_slice(&chunk[..n]);
    }
    body.truncate(len);
    Ok((method, path, headers, body))
}

fn random_token() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| e.to_string())?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// 待ち受けを始める。ポートは OS に選ばせ、アプリが終わるまで動かし続ける
pub fn start(app: &AppHandle) -> Result<Arc<McpState>, String> {
    let std_listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| format!("MCP サーバーを開始できません: {e}"))?;
    std_listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let port = std_listener.local_addr().map_err(|e| e.to_string())?.port();
    let app = app.clone();
    let emit: Emit = Box::new(move |ev| {
        let _ = app.emit("mcp://request", ev);
    });
    let state = Arc::new(McpState::new(port, random_token()?, emit, RELAY_TIMEOUT));
    let serving = state.clone();
    tauri::async_runtime::spawn(async move {
        let Ok(listener) = TcpListener::from_std(std_listener) else { return };
        loop {
            let Ok((stream, _)) = listener.accept().await else { continue };
            tokio::spawn(serve_connection(serving.clone(), stream));
        }
    });
    Ok(state)
}

/// フロントエンドからの結果を、待っている `tools/call` に返す
#[tauri::command]
pub fn mcp_respond(state: State<'_, Arc<McpState>>, req_id: String, result: McpResult) -> Result<(), String> {
    if state.respond(&req_id, result) {
        Ok(())
    } else {
        Err("待っている要求がありません(タイムアウト済みか不明な reqId)".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    const TOKEN: &str = "secret-token";

    /// emit した要求を溜めておく状態を作る
    fn state(timeout: Duration) -> (Arc<McpState>, Arc<StdMutex<Vec<RequestEvent>>>) {
        let seen = Arc::new(StdMutex::new(Vec::new()));
        let sink = seen.clone();
        let st = McpState::new(5555, TOKEN.into(), Box::new(move |e| sink.lock().unwrap().push(e)), timeout);
        (Arc::new(st), seen)
    }

    fn headers(mode: &str) -> HashMap<String, String> {
        [
            ("host", "127.0.0.1:5555"),
            ("authorization", "Bearer secret-token"),
            ("x-storift-run", "run1"),
            ("x-storift-mode", mode),
        ]
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
    }

    async fn rpc(st: &McpState, mode: &str, msg: Value) -> Reply {
        st.process("POST", "/mcp", &headers(mode), msg.to_string().as_bytes()).await
    }

    fn result_of(r: &Reply) -> &Value {
        &r.body.as_ref().unwrap()["result"]
    }

    fn tool_names(r: &Reply) -> Vec<String> {
        result_of(r)["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap().to_string()).collect()
    }

    #[tokio::test]
    async fn initialize_and_notification() {
        let (st, _) = state(Duration::from_secs(1));
        let r = rpc(&st, "confirm", json!({"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-11-25"}})).await;
        assert_eq!(r.status, 200);
        assert_eq!(result_of(&r)["protocolVersion"], "2025-11-25");
        assert_eq!(result_of(&r)["serverInfo"]["name"], "storift");
        let r = rpc(&st, "confirm", json!({"jsonrpc":"2.0","method":"notifications/initialized"})).await;
        assert_eq!(r.status, 202);
        assert!(r.body.is_none());
    }

    #[tokio::test]
    async fn unknown_method_is_jsonrpc_error() {
        let (st, _) = state(Duration::from_secs(1));
        let r = rpc(&st, "confirm", json!({"jsonrpc":"2.0","id":"server-discover-probe-1","method":"server/discover"})).await;
        assert_eq!(r.status, 200);
        let body = r.body.unwrap();
        assert_eq!(body["id"], "server-discover-probe-1");
        assert_eq!(body["error"]["code"], -32601);
    }

    #[tokio::test]
    async fn invalid_json_is_parse_error() {
        let (st, _) = state(Duration::from_secs(1));
        let r = st.process("POST", "/mcp", &headers("auto"), b"{oops").await;
        assert_eq!(r.status, 400);
        assert_eq!(r.body.unwrap()["error"]["code"], -32700);
    }

    #[tokio::test]
    async fn tools_list_depends_on_edit_mode() {
        let (st, _) = state(Duration::from_secs(1));
        let msg = json!({"jsonrpc":"2.0","id":1,"method":"tools/list"});
        for mode in ["confirm", "auto"] {
            let names = tool_names(&rpc(&st, mode, msg.clone()).await);
            assert_eq!(names.len(), 8);
            assert!(names.contains(&"propose_edit".to_string()));
        }
        for mode in ["suggest", "", "weird"] {
            let names = tool_names(&rpc(&st, mode, msg.clone()).await);
            assert_eq!(names.len(), 7);
            assert!(!names.contains(&"propose_edit".to_string()));
        }
        // 各ツールは object の inputSchema と 1 行の説明を持つ
        let r = rpc(&st, "confirm", msg).await;
        for t in result_of(&r)["tools"].as_array().unwrap() {
            assert_eq!(t["inputSchema"]["type"], "object");
            assert!(!t["description"].as_str().unwrap().contains('\n'));
        }
    }

    #[tokio::test]
    async fn propose_edit_rejected_in_suggest_and_history() {
        let (st, seen) = state(Duration::from_secs(1));
        let call = |kind: &str| json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"propose_edit","arguments":{"kind":kind,"id":"x","old":"a","new":"b"}}});
        let r = rpc(&st, "suggest", call("scene")).await;
        assert_eq!(r.body.unwrap()["error"]["code"], -32602);
        let r = rpc(&st, "confirm", call("history")).await;
        assert_eq!(result_of(&r)["isError"], true);
        assert!(seen.lock().unwrap().is_empty(), "フロントへは渡さない");
    }

    #[tokio::test]
    async fn unknown_tool_and_bad_arguments() {
        let (st, _) = state(Duration::from_secs(1));
        let r = rpc(&st, "auto", json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"rm_rf","arguments":{}}})).await;
        assert_eq!(r.body.unwrap()["error"]["code"], -32602);
        let r = rpc(&st, "auto", json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search","arguments":"x"}})).await;
        assert_eq!(r.body.unwrap()["error"]["code"], -32602);
    }

    #[tokio::test]
    async fn auth_host_origin_and_method_checks() {
        let (st, _) = state(Duration::from_secs(1));
        let body = br#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#;
        let mut h = headers("auto");
        assert_eq!(st.process("POST", "/mcp", &h, body).await.status, 200);

        h.insert("authorization".into(), "Bearer wrong-token!".into());
        assert_eq!(st.process("POST", "/mcp", &h, body).await.status, 401);
        h.remove("authorization");
        assert_eq!(st.process("POST", "/mcp", &h, body).await.status, 401);

        let mut h = headers("auto");
        h.insert("host".into(), "evil.example:5555".into());
        assert_eq!(st.process("POST", "/mcp", &h, body).await.status, 403);

        let mut h = headers("auto");
        h.insert("origin".into(), "http://evil.example".into());
        assert_eq!(st.process("POST", "/mcp", &h, body).await.status, 403);

        let h = headers("auto");
        assert_eq!(st.process("GET", "/mcp", &h, b"").await.status, 405);
        assert_eq!(st.process("POST", "/other", &h, body).await.status, 404);
    }

    #[tokio::test]
    async fn tools_call_is_relayed_and_answered() {
        let (st, seen) = state(Duration::from_secs(5));
        let st2 = st.clone();
        let call = tokio::spawn(async move {
            rpc(&st2, "confirm", json!({"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"get_scene","arguments":{"sceneId":"s1"}}})).await
        });
        // emit されるまで待つ
        let ev = loop {
            if let Some(e) = seen.lock().unwrap().first().cloned() {
                break e;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        };
        assert_eq!(ev.run_id, "run1");
        assert_eq!(ev.tool, "get_scene");
        assert_eq!(ev.args, json!({"sceneId":"s1"}));
        assert!(st.respond(&ev.req_id, McpResult { text: "本文".into(), is_error: false }));
        let r = call.await.unwrap();
        let body = r.body.unwrap();
        assert_eq!(body["id"], 9);
        assert_eq!(body["result"]["content"][0], json!({"type":"text","text":"本文"}));
        assert_eq!(body["result"]["isError"], false);
        // 二重の応答は受け付けない
        assert!(!st.respond(&ev.req_id, McpResult { text: "x".into(), is_error: false }));
    }

    #[tokio::test]
    async fn tools_call_times_out() {
        let (st, seen) = state(Duration::from_millis(50));
        let r = rpc(&st, "auto", json!({"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"list_projects"}})).await;
        assert_eq!(result_of(&r)["isError"], true);
        let ev = seen.lock().unwrap()[0].clone();
        assert!(!st.respond(&ev.req_id, McpResult { text: "遅れた".into(), is_error: false }));
    }

    #[tokio::test]
    async fn serves_over_tcp() {
        let std_listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        std_listener.set_nonblocking(true).unwrap();
        let port = std_listener.local_addr().unwrap().port();
        let st = Arc::new(McpState::new(port, TOKEN.into(), Box::new(|_| {}), Duration::from_secs(1)));
        let listener = TcpListener::from_std(std_listener).unwrap();
        let serving = st.clone();
        tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            serve_connection(serving, stream).await;
        });
        let body = r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#;
        let req = format!(
            "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {TOKEN}\r\nX-Storift-Mode: auto\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
            body.len()
        );
        let mut s = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        s.write_all(req.as_bytes()).await.unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).await.unwrap();
        assert!(out.starts_with("HTTP/1.1 200 OK"), "{out}");
        assert!(out.contains("\"propose_edit\""));
    }

    #[test]
    fn allowed_names_follow_mode() {
        let confirm = allowed_tool_names(Some("confirm"));
        assert_eq!(confirm.len(), 8);
        assert!(confirm.contains(&"mcp__storift__propose_edit".to_string()));
        let suggest = allowed_tool_names(Some("suggest"));
        assert_eq!(suggest.len(), 7);
        assert!(suggest.iter().all(|n| n.starts_with("mcp__storift__") && !n.ends_with("propose_edit")));
        assert_eq!(allowed_tool_names(None), suggest);
    }

    #[test]
    fn token_is_random_hex() {
        let (a, b) = (random_token().unwrap(), random_token().unwrap());
        assert_eq!(a.len(), 64);
        assert_ne!(a, b);
    }
}
