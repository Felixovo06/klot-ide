use crate::env_path::AppEnv;
use crate::plugin_host;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::State;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtySessionInfo {
    pub id: String,
    pub cmd: String,
    pub cwd: String,
    pub pid: Option<u32>,
}

struct PtySessionEntry {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

pub struct PtyState {
    sessions: Arc<Mutex<HashMap<String, PtySessionEntry>>>,
}

impl PtyState {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[tauri::command]
pub fn pty_spawn(
    env: State<'_, AppEnv>,
    state: State<'_, PtyState>,
    id: String,
    cmd: String,
    args: Vec<String>,
    cwd: String,
    cols: u16,
    rows: u16,
    active_file: Option<String>,
    theme: Option<String>,
    channel: Channel<Vec<u8>>,
) -> Result<PtySessionInfo, String> {
    let _ = plugin_host::ensure_spec_file(&env.ke_plugins_dir);

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.max(4),
            cols: cols.max(20),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("打开 PTY 失败: {}", e))?;

    let resolved_cmd = if cmd.trim().is_empty() || cmd == "zsh" {
        "/bin/zsh".to_string()
    } else if let Some(bin_path) = env.resolve_binary(&cmd) {
        bin_path.to_string_lossy().into_owned()
    } else {
        cmd.clone()
    };

    let mut builder = CommandBuilder::new(&resolved_cmd);
    if cmd == "zsh" && args.is_empty() {
        builder.arg("-l");
    } else {
        for arg in &args {
            builder.arg(arg);
        }
    }
    builder.cwd(&cwd);

    for (k, v) in &env.vars {
        builder.env(k, v);
    }
    builder.env("TERM", "xterm-256color");
    builder.env("COLORTERM", "truecolor");
    let colorfgbg = if theme.as_deref() == Some("dark") {
        "15;0"
    } else {
        "0;15"
    };
    builder.env("COLORFGBG", colorfgbg);
    builder.env("KE_PLUGINS_DIR", &env.ke_plugins_dir);
    builder.env("KE_WORKSPACE", &cwd);
    builder.env("KE_ACTIVE_FILE", active_file.unwrap_or_default());

    let child = pair
        .slave
        .spawn_command(builder)
        .map_err(|e| format!("启动 PTY 命令失败 ({}): {}", resolved_cmd, e))?;

    let pid = child.process_id();

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("克隆 PTY 读取端失败: {}", e))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("获取 PTY 写入端失败: {}", e))?;

    let sessions_ref = Arc::clone(&state.sessions);
    let session_id = id.clone();

    {
        let mut guard = state.sessions.lock().map_err(|e| format!("PTY 锁异常: {}", e))?;
        if let Some(mut old) = guard.remove(&id) {
            let _ = old.child.kill();
        }
        guard.insert(
            id.clone(),
            PtySessionEntry {
                master: pair.master,
                writer,
                child,
            },
        );
    }

    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if channel.send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
        if let Ok(mut guard) = sessions_ref.lock() {
            guard.remove(&session_id);
        }
    });

    Ok(PtySessionInfo {
        id,
        cmd,
        cwd,
        pid,
    })
}

#[tauri::command]
pub fn pty_write(state: State<'_, PtyState>, id: String, data: String) -> Result<(), String> {
    let mut guard = state.sessions.lock().map_err(|e| format!("PTY 锁异常: {}", e))?;
    if let Some(entry) = guard.get_mut(&id) {
        entry
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| format!("写入 PTY 失败: {}", e))?;
        entry
            .writer
            .flush()
            .map_err(|e| format!("刷新 PTY 失败: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub fn pty_resize(
    state: State<'_, PtyState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let guard = state.sessions.lock().map_err(|e| format!("PTY 锁异常: {}", e))?;
    if let Some(entry) = guard.get(&id) {
        entry
            .master
            .resize(PtySize {
                rows: rows.max(4),
                cols: cols.max(20),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("调整 PTY 尺寸失败: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub fn pty_kill(state: State<'_, PtyState>, id: String) -> Result<(), String> {
    let mut guard = state.sessions.lock().map_err(|e| format!("PTY 锁异常: {}", e))?;
    if let Some(mut entry) = guard.remove(&id) {
        let _ = entry.child.kill();
    }
    Ok(())
}
