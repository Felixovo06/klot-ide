use crate::env_path::AppEnv;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::{mpsc, oneshot, Mutex};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspServerStatus {
    pub lang: String,
    pub command: String,
    pub available: bool,
    pub running: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspDiagnosticsEvent {
    pub lang: String,
    pub uri: String,
    pub path: String,
    pub diagnostics: Value,
}

#[derive(Clone)]
struct LspClientHandle {
    tx: mpsc::UnboundedSender<String>,
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>,
    next_id: Arc<AtomicU64>,
}

pub struct LspState {
    clients: Arc<Mutex<HashMap<(String, String), LspClientHandle>>>,
}

impl LspState {
    pub fn new() -> Self {
        Self {
            clients: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

fn lang_server_spec(lang: &str) -> Option<(&'static str, &'static [&'static str])> {
    match lang {
        "typescript" | "javascript" | "typescriptreact" | "javascriptreact" => {
            Some(("typescript-language-server", &["--stdio"]))
        }
        "rust" => Some(("rust-analyzer", &[])),
        "python" => Some(("pyright-langserver", &["--stdio"])),
        "go" => Some(("gopls", &[])),
        _ => None,
    }
}

fn canonical_lang(lang: &str) -> String {
    match lang {
        "typescriptreact" | "javascript" | "javascriptreact" => "typescript".to_string(),
        other => other.to_string(),
    }
}

pub fn encode_jsonrpc_frame(payload: &Value) -> String {
    let body = payload.to_string();
    format!("Content-Length: {}\r\n\r\n{}", body.len(), body)
}

#[cfg(test)]
pub fn decode_jsonrpc_frames(buffer: &[u8]) -> (Vec<Value>, usize) {
    let mut frames = Vec::new();
    let mut cursor = 0usize;

    while cursor < buffer.len() {
        let rest = &buffer[cursor..];
        let header_end = rest
            .windows(4)
            .position(|w| w == b"\r\n\r\n")
            .map(|pos| pos + 4);
        let Some(hend) = header_end else {
            break;
        };
        let header_str = String::from_utf8_lossy(&rest[..hend]);
        let mut content_length: Option<usize> = None;
        for line in header_str.lines() {
            let trimmed = line.trim();
            if let Some(len_str) = trimmed
                .strip_prefix("Content-Length:")
                .or_else(|| trimmed.strip_prefix("content-length:"))
            {
                content_length = len_str.trim().parse::<usize>().ok();
            }
        }
        let Some(len) = content_length else {
            cursor += hend;
            continue;
        };
        if rest.len() < hend + len {
            break;
        }
        if let Ok(val) = serde_json::from_slice::<Value>(&rest[hend..hend + len]) {
            frames.push(val);
        }
        cursor += hend + len;
    }

    (frames, cursor)
}

fn uri_to_rel_path(root: &str, uri: &str) -> String {
    let stripped = uri.strip_prefix("file://").unwrap_or(uri);
    let root_path = Path::new(root);
    if let Ok(rel) = Path::new(stripped).strip_prefix(root_path) {
        return rel.to_string_lossy().replace('\\', "/");
    }
    stripped.to_string()
}

async fn get_or_spawn_client(
    app: &AppHandle,
    env: &AppEnv,
    state: &LspState,
    root: &str,
    lang: &str,
) -> Option<LspClientHandle> {
    let norm_lang = canonical_lang(lang);
    let key = (root.to_string(), norm_lang.clone());

    {
        let guard = state.clients.lock().await;
        if let Some(existing) = guard.get(&key) {
            return Some(existing.clone());
        }
    }

    let (bin_name, args) = lang_server_spec(&norm_lang)?;
    let bin_path = env.resolve_binary(bin_name)?;

    let mut child = Command::new(bin_path)
        .args(args)
        .current_dir(root)
        .envs(&env.vars)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    let mut stdin = child.stdin.take()?;
    let stdout = child.stdout.take()?;

    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    let pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>> =
        Arc::new(Mutex::new(HashMap::new()));
    let next_id = Arc::new(AtomicU64::new(1));

    tokio::spawn(async move {
        while let Some(frame) = rx.recv().await {
            if stdin.write_all(frame.as_bytes()).await.is_err() {
                break;
            }
            let _ = stdin.flush().await;
        }
    });

    let pending_reader = Arc::clone(&pending);
    let app_handle = app.clone();
    let root_clone = root.to_string();
    let lang_clone = norm_lang.clone();
    let clients_ref = Arc::clone(&state.clients);
    let key_clone = key.clone();

    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout);
        let mut header_line = String::new();
        loop {
            let mut content_length: Option<usize> = None;
            loop {
                header_line.clear();
                match reader.read_line(&mut header_line).await {
                    Ok(0) | Err(_) => {
                        let mut guard = clients_ref.lock().await;
                        guard.remove(&key_clone);
                        return;
                    }
                    Ok(_) => {
                        let trimmed = header_line.trim();
                        if trimmed.is_empty() {
                            break;
                        }
                        if let Some(len_str) = trimmed
                            .strip_prefix("Content-Length:")
                            .or_else(|| trimmed.strip_prefix("content-length:"))
                        {
                            content_length = len_str.trim().parse::<usize>().ok();
                        }
                    }
                }
            }

            let Some(len) = content_length else {
                continue;
            };
            let mut body_buf = vec![0u8; len];
            if reader.read_exact(&mut body_buf).await.is_err() {
                break;
            }
            let Ok(msg) = serde_json::from_slice::<Value>(&body_buf) else {
                continue;
            };

            if let Some(id_val) = msg.get("id").and_then(|v| v.as_u64()) {
                let sender = {
                    let mut guard = pending_reader.lock().await;
                    guard.remove(&id_val)
                };
                if let Some(tx_res) = sender {
                    if let Some(err) = msg.get("error") {
                        let _ = tx_res.send(Err(err.to_string()));
                    } else {
                        let res = msg.get("result").cloned().unwrap_or(Value::Null);
                        let _ = tx_res.send(Ok(res));
                    }
                }
            } else if msg.get("method").and_then(|m| m.as_str())
                == Some("textDocument/publishDiagnostics")
            {
                if let Some(params) = msg.get("params") {
                    let uri = params
                        .get("uri")
                        .and_then(|u| u.as_str())
                        .unwrap_or("")
                        .to_string();
                    let diagnostics = params
                        .get("diagnostics")
                        .cloned()
                        .unwrap_or_else(|| json!([]));
                    let path = uri_to_rel_path(&root_clone, &uri);
                    let _ = app_handle.emit(
                        "lsp:diagnostics",
                        LspDiagnosticsEvent {
                            lang: lang_clone.clone(),
                            uri,
                            path,
                            diagnostics,
                        },
                    );
                }
            }
        }
        let mut guard = clients_ref.lock().await;
        guard.remove(&key_clone);
    });

    let handle = LspClientHandle {
        tx,
        pending,
        next_id,
    };

    // 发送 initialize 握手
    let init_id = handle.next_id.fetch_add(1, Ordering::Relaxed);
    let (init_tx, init_rx) = oneshot::channel();
    {
        let mut guard = handle.pending.lock().await;
        guard.insert(init_id, init_tx);
    }
    let root_uri = format!("file://{}", root);
    let init_req = json!({
        "jsonrpc": "2.0",
        "id": init_id,
        "method": "initialize",
        "params": {
            "processId": std::process::id(),
            "rootUri": root_uri,
            "capabilities": {
                "textDocument": {
                    "definition": { "dynamicRegistration": false },
                    "hover": { "contentFormat": ["markdown", "plaintext"] },
                    "publishDiagnostics": {}
                }
            }
        }
    });
    let _ = handle.tx.send(encode_jsonrpc_frame(&init_req));
    let _ = tokio::time::timeout(Duration::from_secs(5), init_rx).await;

    let initialized_note = json!({
        "jsonrpc": "2.0",
        "method": "initialized",
        "params": {}
    });
    let _ = handle.tx.send(encode_jsonrpc_frame(&initialized_note));

    let mut guard = state.clients.lock().await;
    guard.insert(key, handle.clone());
    Some(handle)
}

#[tauri::command]
pub async fn lsp_notify(
    app: AppHandle,
    env: State<'_, AppEnv>,
    state: State<'_, LspState>,
    root: String,
    lang: String,
    method: String,
    params: Value,
) -> Result<(), String> {
    let Some(client) = get_or_spawn_client(&app, &env, &state, &root, &lang).await else {
        return Ok(());
    };
    let payload = json!({
        "jsonrpc": "2.0",
        "method": method,
        "params": params
    });
    let _ = client.tx.send(encode_jsonrpc_frame(&payload));
    Ok(())
}

#[tauri::command]
pub async fn lsp_request(
    app: AppHandle,
    env: State<'_, AppEnv>,
    state: State<'_, LspState>,
    root: String,
    lang: String,
    method: String,
    params: Value,
) -> Result<Value, String> {
    let Some(client) = get_or_spawn_client(&app, &env, &state, &root, &lang).await else {
        return Ok(Value::Null);
    };

    let req_id = client.next_id.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = oneshot::channel();
    {
        let mut guard = client.pending.lock().await;
        guard.insert(req_id, tx);
    }

    let payload = json!({
        "jsonrpc": "2.0",
        "id": req_id,
        "method": method,
        "params": params
    });
    if client.tx.send(encode_jsonrpc_frame(&payload)).is_err() {
        return Ok(Value::Null);
    }

    match tokio::time::timeout(Duration::from_secs(5), rx).await {
        Ok(Ok(Ok(val))) => Ok(val),
        _ => Ok(Value::Null),
    }
}

#[tauri::command]
pub async fn lsp_status(
    env: State<'_, AppEnv>,
    state: State<'_, LspState>,
    root: String,
) -> Result<Vec<LspServerStatus>, String> {
    lsp_status_core(&env, &state, &root).await
}

pub async fn lsp_status_core(
    env: &AppEnv,
    state: &LspState,
    root: &str,
) -> Result<Vec<LspServerStatus>, String> {
    let guard = state.clients.lock().await;
    let langs = [
        ("typescript", "typescript-language-server"),
        ("rust", "rust-analyzer"),
        ("python", "pyright-langserver"),
        ("go", "gopls"),
    ];
    let list = langs
        .into_iter()
        .map(|(lang, command)| LspServerStatus {
            lang: lang.to_string(),
            command: command.to_string(),
            available: env.resolve_binary(command).is_some(),
            running: guard.contains_key(&(root.to_string(), lang.to_string())),
        })
        .collect();
    Ok(list)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encode_and_decode_jsonrpc_frames() {
        let v1 = json!({"jsonrpc": "2.0", "method": "initialized", "params": {}});
        let v2 = json!({"jsonrpc": "2.0", "id": 7, "result": {"capabilities": {"hoverProvider": true}}});
        let combined = format!("{}{}", encode_jsonrpc_frame(&v1), encode_jsonrpc_frame(&v2));
        assert!(combined.starts_with("Content-Length: "));

        let (decoded, consumed) = decode_jsonrpc_frames(combined.as_bytes());
        assert_eq!(consumed, combined.len());
        assert_eq!(decoded.len(), 2);
        assert_eq!(decoded[0]["method"], "initialized");
        assert_eq!(decoded[1]["id"], 7);

        // 半包截断场景应保留未消费字节等待后续数据
        let partial = &combined.as_bytes()[..combined.len() - 5];
        let (partial_decoded, partial_consumed) = decode_jsonrpc_frames(partial);
        assert_eq!(partial_decoded.len(), 1);
        assert!(partial_consumed < partial.len());
    }

    #[tokio::test]
    async fn test_lsp_graceful_degradation_when_missing_binary() {
        let mut vars = HashMap::new();
        vars.insert("PATH".to_string(), "/nonexistent/ke/lsp/bin".to_string());
        let empty_env = AppEnv {
            vars,
            path: "/nonexistent/ke/lsp/bin".to_string(),
            home_dir: "/tmp".to_string(),
            default_workspace: "/tmp".to_string(),
            ke_plugins_dir: "/tmp/.ke/plugins".to_string(),
        };
        let state = LspState::new();

        // 缺少语言服务二进制时不报错、所有语言 available/running 为 false
        assert!(empty_env.resolve_binary("typescript-language-server").is_none());
        let statuses = lsp_status_core(&empty_env, &state, "/tmp").await.unwrap();
        assert_eq!(statuses.len(), 4);
        assert!(statuses.iter().all(|s| !s.available && !s.running));
        // 不支持或未安装的语言应返回 None
        assert!(lang_server_spec("unknown-lang").is_none());
    }
}
