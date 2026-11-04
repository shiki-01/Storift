//! Ollama(ローカル LLM)で AI 機能を動かす。
//!
//! Claude Code のように「ツールを使う側」を持たないので、アプリの中で会話のループを回す:
//! `/api/chat` にツール定義つきで送り、返ってきたツール呼び出しを MCP と同じ経路
//! (`McpState::call_tool` → フロントエンド)で実行し、結果を渡して続きを書かせる。
//! フロントエンドは Claude Code と同じ `stream-json` の行を受け取るだけでよいので、
//! ここで同じ形のイベントを作って流す。
//!
//! HTTP は依存を増やさないよう最小限を自前で話す(接続先は主にローカルの `http://`)。
//! 会話の継続は、メモリ上の履歴(セッション ID ごと)で行う。アプリを再起動すると履歴は失われ、
//! 新しい会話として始まる。

use crate::mcp::{self, McpState};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

const DEFAULT_URL: &str = "http://localhost:11434";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// モデルの読み込みで最初の応答が遅いことがあるので長めにとる
const READ_TIMEOUT: Duration = Duration::from_secs(600);
/// 1 回の送信で回すツール呼び出しの往復の上限
const MAX_STEPS: usize = 12;
/// 保持する会話の数の上限
const MAX_SESSIONS: usize = 20;
/// 文脈の長さ(Ollama の既定は小さく、原稿を読むとすぐ溢れて黙って切り捨てられる)
const NUM_CTX: u32 = 16384;
const ERROR_BODY_LIMIT: usize = 4096;

const BASE_SYSTEM_PROMPT: &str = "あなたは小説の執筆を支える日本語のアシスタントです。\
作品の原稿・キャラクター・プロット・設定資料は、用意されたツールで読み取ってから答えてください。\
ツールで確かめていないことを事実として述べず、推測のときはそう伝えてください。\
回答は日本語で、簡潔に書いてください。";

#[derive(Default)]
pub struct OllamaState {
    sessions: Mutex<HashMap<String, Vec<Value>>>,
}

/// 接続先(http のみ)
struct Endpoint {
    host: String,
    port: u16,
    /// 末尾のスラッシュを除いた基準パス(通常は空)
    base: String,
}

fn parse_endpoint(url: Option<&str>) -> Result<Endpoint, String> {
    let url = url.map(str::trim).filter(|s| !s.is_empty()).unwrap_or(DEFAULT_URL);
    if url.starts_with("https://") {
        return Err("https:// の接続先には対応していません。http:// で指定してください。".into());
    }
    let rest = url.strip_prefix("http://").unwrap_or(url);
    let (authority, path) = match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, ""),
    };
    let (host, port) = match authority.rsplit_once(':') {
        // IPv6 の [::1] 形式は host 側にコロンが残るため、ポートは ']' の後ろだけを見る
        Some((h, p)) if !p.contains(']') => {
            (h, p.parse::<u16>().map_err(|_| format!("ポート番号が正しくありません: {p}"))?)
        }
        _ => (authority, 11434),
    };
    let host = host.trim_start_matches('[').trim_end_matches(']');
    if host.is_empty() {
        return Err("接続先のホスト名が空です".into());
    }
    Ok(Endpoint { host: host.to_string(), port, base: path.trim_end_matches('/').to_string() })
}

/// HTTP の chunked 転送を復号する
#[derive(Default)]
struct Chunked {
    buf: Vec<u8>,
    state: ChunkState,
}

#[derive(Default, Clone, Copy)]
enum ChunkState {
    #[default]
    Size,
    Data(usize),
    DataEnd,
    Done,
}

impl Chunked {
    fn push(&mut self, input: &[u8]) -> Vec<u8> {
        self.buf.extend_from_slice(input);
        let mut out = Vec::new();
        loop {
            match self.state {
                ChunkState::Size => {
                    let Some(pos) = self.buf.windows(2).position(|w| w == b"\r\n") else { break };
                    let line = String::from_utf8_lossy(&self.buf[..pos]).into_owned();
                    self.buf.drain(..pos + 2);
                    let size = line.split(';').next().unwrap_or("").trim();
                    let n = usize::from_str_radix(size, 16).unwrap_or(0);
                    self.state = if n == 0 { ChunkState::Done } else { ChunkState::Data(n) };
                }
                ChunkState::Data(n) => {
                    if self.buf.is_empty() {
                        break;
                    }
                    let take = n.min(self.buf.len());
                    out.extend(self.buf.drain(..take));
                    self.state = if n == take { ChunkState::DataEnd } else { ChunkState::Data(n - take) };
                }
                ChunkState::DataEnd => {
                    if self.buf.len() < 2 {
                        break;
                    }
                    self.buf.drain(..2);
                    self.state = ChunkState::Size;
                }
                ChunkState::Done => {
                    self.buf.clear();
                    break;
                }
            }
        }
        out
    }
}

/// 1 回の要求を送り、成功(200)した本文を復号しながら `on_data` へ流す。
/// 200 以外はその本文を添えたエラーにする
async fn http_stream(
    ep: &Endpoint,
    method: &str,
    path: &str,
    body: Option<&[u8]>,
    mut on_data: impl FnMut(&[u8]) -> Result<(), String>,
) -> Result<(), String> {
    let addr = (ep.host.as_str(), ep.port);
    let mut stream = tokio::time::timeout(CONNECT_TIMEOUT, TcpStream::connect(addr))
        .await
        .map_err(|_| format!("Ollama({}:{})に接続できません(タイムアウト)", ep.host, ep.port))?
        .map_err(|e| format!("Ollama({}:{})に接続できません: {e}。Ollama を起動してください。", ep.host, ep.port))?;
    let body = body.unwrap_or(&[]);
    let head = format!(
        "{method} {}{path} HTTP/1.1\r\nHost: {}:{}\r\nConnection: close\r\nAccept: application/json\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n",
        ep.base,
        ep.host,
        ep.port,
        body.len()
    );
    stream.write_all(head.as_bytes()).await.map_err(|e| e.to_string())?;
    stream.write_all(body).await.map_err(|e| e.to_string())?;

    let mut buf: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 8192];
    let header_end = loop {
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break pos;
        }
        let n = read_some(&mut stream, &mut chunk).await?;
        if n == 0 {
            return Err("Ollama からの応答が途中で切れました".into());
        }
        buf.extend_from_slice(&chunk[..n]);
        if buf.len() > 64 * 1024 {
            return Err("Ollama の応答ヘッダーが大きすぎます".into());
        }
    };
    let head = String::from_utf8_lossy(&buf[..header_end]).to_ascii_lowercase();
    let status: u16 = head
        .lines()
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        .and_then(|s| s.parse().ok())
        .ok_or("Ollama の応答を解釈できません")?;
    let chunked = head.lines().any(|l| l.starts_with("transfer-encoding:") && l.contains("chunked"));
    let mut decoder = Chunked::default();
    let mut feed = |data: &[u8]| -> Vec<u8> { if chunked { decoder.push(data) } else { data.to_vec() } };

    let mut pending = feed(&buf[header_end + 4..]);
    let mut error_body: Vec<u8> = Vec::new();
    loop {
        if !pending.is_empty() {
            if status == 200 {
                on_data(&pending)?;
            } else if error_body.len() < ERROR_BODY_LIMIT {
                error_body.extend_from_slice(&pending);
            }
        }
        let n = read_some(&mut stream, &mut chunk).await?;
        if n == 0 {
            break;
        }
        pending = feed(&chunk[..n]);
    }
    if status != 200 {
        let text = String::from_utf8_lossy(&error_body);
        // {"error": "..."} の形ならその理由だけを見せる
        let reason = serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|v| v.get("error").and_then(Value::as_str).map(str::to_string))
            .unwrap_or_else(|| text.trim().to_string());
        return Err(format!("Ollama がエラー({status})を返しました: {reason}"));
    }
    Ok(())
}

async fn read_some(stream: &mut TcpStream, chunk: &mut [u8]) -> Result<usize, String> {
    tokio::time::timeout(READ_TIMEOUT, stream.read(chunk))
        .await
        .map_err(|_| "Ollama からの応答が途絶えました(タイムアウト)".to_string())?
        .map_err(|e| format!("Ollama との通信に失敗しました: {e}"))
}

async fn get_json(ep: &Endpoint, path: &str) -> Result<Value, String> {
    let mut body: Vec<u8> = Vec::new();
    http_stream(ep, "GET", path, None, |d| {
        body.extend_from_slice(d);
        Ok(())
    })
    .await?;
    serde_json::from_slice(&body).map_err(|e| format!("Ollama の応答を解釈できません: {e}"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaStatus {
    found: bool,
    version: Option<String>,
    models: Vec<String>,
    error: Option<String>,
}

/// 接続の確認と、入れてあるモデルの一覧
#[tauri::command]
pub async fn ollama_status(url: Option<String>) -> OllamaStatus {
    let fail = |error: String| OllamaStatus { found: false, version: None, models: Vec::new(), error: Some(error) };
    let ep = match parse_endpoint(url.as_deref()) {
        Ok(ep) => ep,
        Err(e) => return fail(e),
    };
    let version = match get_json(&ep, "/api/version").await {
        Ok(v) => v.get("version").and_then(Value::as_str).unwrap_or("").to_string(),
        Err(e) => return fail(e),
    };
    let models = match get_json(&ep, "/api/tags").await {
        Ok(v) => v
            .get("models")
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(|m| m.get("name").and_then(Value::as_str).map(str::to_string)).collect())
            .unwrap_or_default(),
        Err(e) => return fail(e),
    };
    OllamaStatus { found: true, version: Some(format!("Ollama {version}")), models, error: None }
}

/// 実行の入力
pub struct Params {
    pub run_id: String,
    pub prompt: String,
    pub session_id: Option<String>,
    pub model: Option<String>,
    pub url: Option<String>,
    pub edit_mode: Option<String>,
    pub append_system_prompt: Option<String>,
}

/// MCP のツール定義を Ollama(OpenAI 互換)の形へ
fn ollama_tools(mode: Option<&str>) -> Vec<Value> {
    mcp::tool_definitions(mode)
        .into_iter()
        .map(|t| {
            json!({
                "type": "function",
                "function": {
                    "name": t["name"],
                    "description": t["description"],
                    "parameters": t["inputSchema"],
                }
            })
        })
        .collect()
}

/// 画面に出すツール名(Claude Code と同じ接頭辞を付けると、同じ表示になる)
fn display_tool_name(name: &str) -> String {
    format!("mcp__{}__{name}", mcp::SERVER_NAME)
}

/// ツール呼び出しの引数を JSON オブジェクトにする(文字列で来るモデルもある)
fn tool_arguments(raw: Option<&Value>) -> Value {
    match raw {
        Some(Value::String(s)) => serde_json::from_str(s).unwrap_or_else(|_| json!({})),
        Some(v @ Value::Object(_)) => v.clone(),
        _ => json!({}),
    }
}

fn stream_event(event: Value) -> Value {
    json!({"type": "stream_event", "event": event})
}

/// 会話を 1 回ぶん進める。出力は Claude Code の stream-json と同じ形で `emit` に流す
pub async fn run(
    mcp: &McpState,
    state: &OllamaState,
    p: Params,
    emit: &(dyn Fn(Value) + Send + Sync),
) -> Result<(), String> {
    let started = Instant::now();
    let model = p
        .model
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or("Ollama のモデルが選ばれていません。設定でモデルを選んでください。")?
        .to_string();
    let ep = parse_endpoint(p.url.as_deref())?;
    let mode = p.edit_mode.as_deref();
    let tools = ollama_tools(mode);

    // 続きの会話ならメモリ上の履歴を引き継ぎ、無ければ新しく始める
    let existing = p
        .session_id
        .as_deref()
        .filter(|s| !s.is_empty())
        .and_then(|id| state.sessions.lock().ok()?.get(id).cloned().map(|h| (id.to_string(), h)));
    let (session_id, mut history) = match existing {
        Some(found) => found,
        None => {
            let mut system = BASE_SYSTEM_PROMPT.to_string();
            if let Some(extra) = p.append_system_prompt.as_deref().filter(|s| !s.is_empty()) {
                system.push_str("\n\n");
                system.push_str(extra);
            }
            (format!("ollama-{}", p.run_id), vec![json!({"role": "system", "content": system})])
        }
    };
    history.push(json!({"role": "user", "content": p.prompt}));

    emit(json!({"type": "system", "subtype": "init", "session_id": session_id, "model": model}));

    let mut final_text = String::new();
    let mut finished = false;
    for step in 0..MAX_STEPS {
        let msg_id = format!("msg_{}_{step}", p.run_id);
        emit(stream_event(json!({"type": "message_start", "message": {"id": msg_id}})));
        emit(stream_event(json!({
            "type": "content_block_start",
            "index": 0,
            "content_block": {"type": "text", "text": ""}
        })));

        let request = json!({
            "model": model,
            "messages": history,
            "tools": tools,
            "stream": true,
            "options": {"num_ctx": NUM_CTX},
        });
        let mut text = String::new();
        let mut calls: Vec<Value> = Vec::new();
        let mut line_buf: Vec<u8> = Vec::new();
        let mut stream_error: Option<String> = None;
        http_stream(&ep, "POST", "/api/chat", Some(request.to_string().as_bytes()), |data| {
            line_buf.extend_from_slice(data);
            while let Some(pos) = line_buf.iter().position(|b| *b == b'\n') {
                let line: Vec<u8> = line_buf.drain(..=pos).collect();
                let Ok(v) = serde_json::from_slice::<Value>(&line) else { continue };
                if let Some(err) = v.get("error").and_then(Value::as_str) {
                    stream_error = Some(err.to_string());
                    continue;
                }
                let message = &v["message"];
                if let Some(delta) = message.get("content").and_then(Value::as_str).filter(|s| !s.is_empty()) {
                    text.push_str(delta);
                    emit(stream_event(json!({
                        "type": "content_block_delta",
                        "index": 0,
                        "delta": {"type": "text_delta", "text": delta}
                    })));
                }
                if let Some(arr) = message.get("tool_calls").and_then(Value::as_array) {
                    calls.extend(arr.iter().cloned());
                }
            }
            Ok(())
        })
        .await?;
        if let Some(err) = stream_error {
            return Err(format!("Ollama がエラーを返しました: {err}"));
        }

        // 完成したメッセージ(画面側はこれで逐次表示の内容を置き換える)
        let mut content: Vec<Value> = Vec::new();
        if !text.is_empty() {
            content.push(json!({"type": "text", "text": text}));
        }
        let parsed: Vec<(String, Value)> = calls
            .iter()
            .map(|c| {
                let f = &c["function"];
                (f.get("name").and_then(Value::as_str).unwrap_or("").to_string(), tool_arguments(f.get("arguments")))
            })
            .collect();
        for (i, (name, args)) in parsed.iter().enumerate() {
            content.push(json!({
                "type": "tool_use",
                "id": format!("toolu_{step}_{i}"),
                "name": display_tool_name(name),
                "input": args,
            }));
        }
        emit(json!({"type": "assistant", "message": {"id": msg_id, "content": content}}));

        let mut assistant = json!({"role": "assistant", "content": text});
        if !calls.is_empty() {
            assistant["tool_calls"] = Value::Array(calls.clone());
        }
        history.push(assistant);

        if parsed.is_empty() {
            final_text = text;
            finished = true;
            break;
        }
        for (name, args) in parsed {
            let result = match mcp.call_tool(&p.run_id, &name, args, mode).await {
                Ok(res) if res.is_error => format!("エラー: {}", res.text),
                Ok(res) => res.text,
                Err((_, message)) => format!("エラー: {message}"),
            };
            history.push(json!({"role": "tool", "tool_name": name, "content": result}));
        }
    }
    if !finished {
        return Err(format!("ツールの呼び出しが {MAX_STEPS} 回に達したため、途中で打ち切りました。"));
    }

    if let Ok(mut sessions) = state.sessions.lock() {
        if sessions.len() >= MAX_SESSIONS && !sessions.contains_key(&session_id) {
            if let Some(oldest) = sessions.keys().next().cloned() {
                sessions.remove(&oldest);
            }
        }
        sessions.insert(session_id.clone(), history);
    }
    emit(json!({
        "type": "result",
        "subtype": "success",
        "is_error": false,
        "session_id": session_id,
        "duration_ms": started.elapsed().as_millis() as u64,
        "result": final_text,
    }));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_defaults_and_parsing() {
        let ep = parse_endpoint(None).unwrap();
        assert_eq!((ep.host.as_str(), ep.port, ep.base.as_str()), ("localhost", 11434, ""));
        let ep = parse_endpoint(Some("http://192.168.0.5:8080/ollama/")).unwrap();
        assert_eq!((ep.host.as_str(), ep.port, ep.base.as_str()), ("192.168.0.5", 8080, "/ollama"));
        let ep = parse_endpoint(Some("127.0.0.1")).unwrap();
        assert_eq!((ep.host.as_str(), ep.port), ("127.0.0.1", 11434));
        let ep = parse_endpoint(Some("http://[::1]:11434")).unwrap();
        assert_eq!((ep.host.as_str(), ep.port), ("::1", 11434));
        assert!(parse_endpoint(Some("https://example.com")).is_err());
        assert!(parse_endpoint(Some("http://localhost:abc")).is_err());
    }

    #[test]
    fn chunked_decoding_across_splits() {
        let wire = b"5\r\nhello\r\n6;ext=1\r\n world\r\n0\r\n\r\n";
        // どこで区切って届いても同じ結果になる
        for split in 0..wire.len() {
            let mut d = Chunked::default();
            let mut out = d.push(&wire[..split]);
            out.extend(d.push(&wire[split..]));
            assert_eq!(out, b"hello world", "split at {split}");
        }
    }

    #[test]
    fn tools_are_converted_for_ollama() {
        let read = ollama_tools(Some("suggest"));
        assert!(read.iter().all(|t| t["type"] == "function"));
        assert!(read.iter().any(|t| t["function"]["name"] == "get_scene"));
        assert!(!read.iter().any(|t| t["function"]["name"] == "propose_edit"));
        assert!(read[0]["function"]["parameters"].is_object());
        let edit = ollama_tools(Some("confirm"));
        assert!(edit.iter().any(|t| t["function"]["name"] == "propose_edit"));
    }

    #[test]
    fn tool_arguments_accept_object_or_string() {
        assert_eq!(tool_arguments(Some(&json!({"a": 1}))), json!({"a": 1}));
        assert_eq!(tool_arguments(Some(&json!("{\"a\":2}"))), json!({"a": 2}));
        assert_eq!(tool_arguments(Some(&json!("broken"))), json!({}));
        assert_eq!(tool_arguments(None), json!({}));
    }
}
