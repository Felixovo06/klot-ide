use crate::env_path::AppEnv;
use nix::sys::signal::{killpg, Signal};
use nix::unistd::Pid;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::ipc::Channel;
use tauri::State;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::sync::Mutex;

static NEXT_RUN_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDefinition {
    pub id: String,
    pub name: String,
    pub command: String,
    pub cwd: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRunHandle {
    pub run_id: String,
    pub task_id: String,
    pub pid: u32,
    pub command: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskChunkData {
    pub run_id: String,
    pub chunk: String,
    pub timestamp_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskExitData {
    pub run_id: String,
    pub code: Option<i32>,
    pub signal: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
pub enum TaskOutputEvent {
    Stdout(TaskChunkData),
    Stderr(TaskChunkData),
    Exit(TaskExitData),
}

struct RunningTask {
    pgid: i32,
}

pub struct TaskState {
    running: Arc<Mutex<HashMap<String, RunningTask>>>,
}

impl TaskState {
    pub fn new() -> Self {
        Self {
            running: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[derive(Debug, Deserialize)]
struct CustomTaskItem {
    id: Option<String>,
    name: String,
    command: String,
    cwd: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum CustomTasksFile {
    List(Vec<CustomTaskItem>),
    Wrapped { tasks: Vec<CustomTaskItem> },
}

pub fn discover_tasks_in_dir(root: &Path) -> Vec<TaskDefinition> {
    let mut tasks = Vec::new();
    let root_str = root.to_string_lossy().into_owned();

    // 1. package.json scripts
    let pkg_path = root.join("package.json");
    if let Ok(raw) = fs::read_to_string(&pkg_path) {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let Some(scripts) = val.get("scripts").and_then(|s| s.as_object()) {
                for (name, _) in scripts {
                    tasks.push(TaskDefinition {
                        id: format!("npm:{}", name),
                        name: name.clone(),
                        command: format!("npm run {}", name),
                        cwd: root_str.clone(),
                        source: "package.json".to_string(),
                    });
                }
            }
        }
    }

    // 2. Cargo.toml
    let cargo_path = root.join("Cargo.toml");
    if cargo_path.is_file() {
        tasks.push(TaskDefinition {
            id: "cargo:check".to_string(),
            name: "cargo check".to_string(),
            command: "cargo check".to_string(),
            cwd: root_str.clone(),
            source: "Cargo.toml".to_string(),
        });
        tasks.push(TaskDefinition {
            id: "cargo:test".to_string(),
            name: "cargo test".to_string(),
            command: "cargo test".to_string(),
            cwd: root_str.clone(),
            source: "Cargo.toml".to_string(),
        });
        tasks.push(TaskDefinition {
            id: "cargo:run".to_string(),
            name: "cargo run".to_string(),
            command: "cargo run".to_string(),
            cwd: root_str.clone(),
            source: "Cargo.toml".to_string(),
        });
    }

    // 3. Makefile targets
    let makefile_path = root.join("Makefile");
    if let Ok(raw) = fs::read_to_string(&makefile_path) {
        let mut seen_targets = HashSet::new();
        for line in raw.lines() {
            if line.starts_with('\t') || line.starts_with('#') || line.starts_with('.') {
                continue;
            }
            if let Some((left, _)) = line.split_once(':') {
                let target = left.trim();
                if !target.is_empty()
                    && !target.contains(' ')
                    && !target.contains('$')
                    && !target.contains('=')
                    && seen_targets.insert(target.to_string())
                {
                    tasks.push(TaskDefinition {
                        id: format!("make:{}", target),
                        name: format!("make {}", target),
                        command: format!("make {}", target),
                        cwd: root_str.clone(),
                        source: "Makefile".to_string(),
                    });
                }
            }
        }
    }

    // 4. .ke/tasks.json (and fallback .onyx/tasks.json)
    for rel in [".ke/tasks.json", ".onyx/tasks.json"] {
        let custom_path = root.join(rel);
        if let Ok(raw) = fs::read_to_string(&custom_path) {
            if let Ok(parsed) = serde_json::from_str::<CustomTasksFile>(&raw) {
                let items = match parsed {
                    CustomTasksFile::List(list) => list,
                    CustomTasksFile::Wrapped { tasks } => tasks,
                };
                for item in items {
                    let cwd = item
                        .cwd
                        .map(|c| {
                            let p = Path::new(&c);
                            if p.is_absolute() {
                                c
                            } else {
                                root.join(c).to_string_lossy().into_owned()
                            }
                        })
                        .unwrap_or_else(|| root_str.clone());
                    tasks.push(TaskDefinition {
                        id: item.id.unwrap_or_else(|| format!("custom:{}", item.name)),
                        name: item.name,
                        command: item.command,
                        cwd,
                        source: rel.to_string(),
                    });
                }
            }
        }
    }

    tasks
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

async fn spawn_task_internal(
    env: &AppEnv,
    state: &TaskState,
    root: String,
    task_id: String,
    command: String,
    channel: Channel<TaskOutputEvent>,
) -> Result<TaskRunHandle, String> {
    spawn_task_with_sink(env, state, root, task_id, command, move |ev| {
        let _ = channel.send(ev);
    })
    .await
}

async fn spawn_task_with_sink<F>(
    env: &AppEnv,
    state: &TaskState,
    root: String,
    task_id: String,
    command: String,
    sink: F,
) -> Result<TaskRunHandle, String>
where
    F: Fn(TaskOutputEvent) + Send + Sync + Clone + 'static,
{
    let run_id = format!("run-{}", NEXT_RUN_ID.fetch_add(1, Ordering::Relaxed));

    let shell = if Path::new("/bin/zsh").exists() {
        "/bin/zsh"
    } else {
        "/bin/sh"
    };

    let mut cmd = Command::new(shell);
    cmd.args(["-lc", &command])
        .current_dir(&root)
        .envs(&env.vars)
        .env("KE_WORKSPACE", &root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(unix)]
    {
        cmd.process_group(0);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("启动任务失败 ({}): {}", command, e))?;

    let pid = child.id().unwrap_or(0);
    let pgid = pid as i32;

    {
        let mut guard = state.running.lock().await;
        guard.insert(run_id.clone(), RunningTask { pgid });
    }

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let sink_out = sink.clone();
    let run_id_out = run_id.clone();
    let out_task = tokio::spawn(async move {
        if let Some(mut reader) = stdout {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let chunk = String::from_utf8_lossy(&buf[..n]).into_owned();
                        sink_out(TaskOutputEvent::Stdout(TaskChunkData {
                            run_id: run_id_out.clone(),
                            chunk,
                            timestamp_ms: now_ms(),
                        }));
                    }
                }
            }
        }
    });

    let sink_err = sink.clone();
    let run_id_err = run_id.clone();
    let err_task = tokio::spawn(async move {
        if let Some(mut reader) = stderr {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let chunk = String::from_utf8_lossy(&buf[..n]).into_owned();
                        sink_err(TaskOutputEvent::Stderr(TaskChunkData {
                            run_id: run_id_err.clone(),
                            chunk,
                            timestamp_ms: now_ms(),
                        }));
                    }
                }
            }
        }
    });

    let running_map = Arc::clone(&state.running);
    let run_id_wait = run_id.clone();
    let sink_exit = sink;

    tokio::spawn(async move {
        let status = child.wait().await;
        let _ = out_task.await;
        let _ = err_task.await;

        {
            let mut guard = running_map.lock().await;
            guard.remove(&run_id_wait);
        }

        let (code, signal) = match status {
            Ok(st) => {
                #[cfg(unix)]
                let sig = {
                    use std::os::unix::process::ExitStatusExt;
                    st.signal().map(|s| format!("SIG{}", s))
                };
                #[cfg(not(unix))]
                let sig: Option<String> = None;
                (st.code(), sig)
            }
            Err(_) => (None, None),
        };

        sink_exit(TaskOutputEvent::Exit(TaskExitData {
            run_id: run_id_wait,
            code,
            signal,
        }));
    });

    Ok(TaskRunHandle {
        run_id,
        task_id,
        pid,
        command,
    })
}

async fn stop_task_internal(state: &TaskState, run_id: &str) -> Result<(), String> {
    let pgid = {
        let guard = state.running.lock().await;
        guard.get(run_id).map(|t| t.pgid)
    };

    let Some(pgid) = pgid else {
        return Ok(());
    };

    if pgid > 0 {
        let pid = Pid::from_raw(pgid);
        let _ = killpg(pid, Signal::SIGTERM);

        for _ in 0..16 {
            tokio::time::sleep(Duration::from_millis(50)).await;
            let still_tracked = {
                let guard = state.running.lock().await;
                guard.contains_key(run_id)
            };
            if !still_tracked {
                return Ok(());
            }
        }

        let _ = killpg(pid, Signal::SIGKILL);
    }

    let mut guard = state.running.lock().await;
    guard.remove(run_id);
    Ok(())
}

#[tauri::command]
pub async fn task_discover(root: String) -> Result<Vec<TaskDefinition>, String> {
    tokio::task::spawn_blocking(move || discover_tasks_in_dir(Path::new(&root)))
        .await
        .map_err(|e| format!("扫描任务异常: {}", e))
}

#[tauri::command]
pub async fn task_run(
    env: State<'_, AppEnv>,
    state: State<'_, TaskState>,
    root: String,
    task_id: String,
    command: String,
    channel: Channel<TaskOutputEvent>,
) -> Result<TaskRunHandle, String> {
    spawn_task_internal(&env, &state, root, task_id, command, channel).await
}

#[tauri::command]
pub async fn task_run_custom(
    env: State<'_, AppEnv>,
    state: State<'_, TaskState>,
    root: String,
    name: String,
    command: String,
    channel: Channel<TaskOutputEvent>,
) -> Result<TaskRunHandle, String> {
    let task_id = format!("custom:{}", name);
    spawn_task_internal(&env, &state, root, task_id, command, channel).await
}

#[tauri::command]
pub async fn task_stop(state: State<'_, TaskState>, run_id: String) -> Result<(), String> {
    stop_task_internal(&state, &run_id).await
}

#[tauri::command]
pub async fn task_restart(
    env: State<'_, AppEnv>,
    state: State<'_, TaskState>,
    root: String,
    run_id: String,
    task_id: String,
    command: String,
    channel: Channel<TaskOutputEvent>,
) -> Result<TaskRunHandle, String> {
    stop_task_internal(&state, &run_id).await?;
    spawn_task_internal(&env, &state, root, task_id, command, channel).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_discover_tasks() {
        let tmp = std::env::temp_dir().join(format!(
            "ke_task_test_{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(tmp.join(".ke")).unwrap();
        fs::write(
            tmp.join("package.json"),
            r#"{"scripts":{"dev":"vite","build":"vite build"}}"#,
        )
        .unwrap();
        fs::write(tmp.join("Makefile"), "all:\n\techo ok\ntest:\n\techo test\n").unwrap();
        fs::write(
            tmp.join(".ke/tasks.json"),
            r#"[{"name":"smoke","command":"echo smoke"}]"#,
        )
        .unwrap();

        let tasks = discover_tasks_in_dir(&tmp);
        assert!(tasks.iter().any(|t| t.name == "dev" && t.source == "package.json"));
        assert!(tasks.iter().any(|t| t.name == "make test" && t.source == "Makefile"));
        assert!(tasks.iter().any(|t| t.name == "smoke" && t.source == ".ke/tasks.json"));

        let _ = fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn test_killpg_terminates_entire_process_group() {
        let env = AppEnv::init();
        let state = TaskState::new();
        let tmp = std::env::temp_dir().to_string_lossy().into_owned();

        let handle = spawn_task_with_sink(
            &env,
            &state,
            tmp,
            "test:pg".to_string(),
            "sleep 30 & sleep 30 & wait".to_string(),
            |_| {},
        )
        .await
        .unwrap();

        let pgid = handle.pid as i32;
        assert!(pgid > 0);
        tokio::time::sleep(Duration::from_millis(120)).await;

        stop_task_internal(&state, &handle.run_id).await.unwrap();
        tokio::time::sleep(Duration::from_millis(100)).await;

        let alive = killpg(Pid::from_raw(pgid), None);
        assert!(
            alive.is_err(),
            "预期整个进程组已被 killpg 彻底清理，但仍检测到存活进程"
        );
    }
}
