use crate::env_path::AppEnv;
use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

const SPEC_MD_CONTENT: &str = r#"# Klot IDE (KE) 自生长插件协议规范

本文件由 Klot IDE 自动生成并维护，供本地 Coding CLI（如 `claude`、`codex`）在编写扩展插件时直接读取。

## 1. 插件发现目录与热加载

Klot IDE 会实时监听以下两个目录（保存后约 50ms 自动热加载，无需重启应用）：

- 全局插件目录（跨项目复用）：`~/.ke/plugins/<plugin-id>/`
- 项目专属插件目录（随仓库生效）：`<workspace>/.ke/plugins/<plugin-id>/`

当在右侧终端会话中启动 CLI 时，Klot IDE 会自动注入环境变量：
- `KE_PLUGINS_DIR`：指向全局插件根目录（`~/.ke/plugins`）
- `KE_WORKSPACE`：指向当前打开的工作区根目录
- `KE_ACTIVE_FILE`：指向当前激活的编辑器文件路径

## 2. 目录结构与 `plugin.json` 声明规范

每个插件目录包含一个 `plugin.json` 清单文件和一个可执行入口脚本（支持 `node`、`python3`、`sh`、`bash` 或二进制文件 `binary`）：

```json
{
  "id": "check-console-logs",
  "name": "检查调试日志",
  "version": "0.1.0",
  "description": "检查当前分支待提交改动是否遗留 console.log",
  "slot": "command",
  "entry": "run.mjs",
  "runtime": "node",
  "triggers": {
    "menu": "gear",
    "shortcut": "Cmd+Shift+C",
    "palette": true
  }
}
```

### 支持的三种扩展槽位（`slot`）

1. `command`：挂载到右上角齿轮菜单、`Cmd+P` 命令面板以及指定快捷键。执行后返回 `actions` 指令数组。
2. `topbar_status`：挂载到顶栏右侧运行控制组旁的状态微胶囊，返回 `{ "label": "3000 up", "tone": "success" }`（`tone` 可选 `neutral` / `success` / `warning` / `error`）。
3. `drawer_view`：在中间主画布底部控制台区域渲染结构化报告，通过 `render_drawer` 动作返回 `markdown` 或 `table` 数据。

## 3. 标准输入输出 JSON 协议

触发插件时，Klot IDE 通过标准输入（`stdin`）向插件脚本传入上下文 JSON：

```json
{
  "workspaceRoot": "/path/to/workspace",
  "branch": "feat/example",
  "activeFile": "src/main.ts",
  "selection": {
    "startLine": 10,
    "endLine": 25,
    "text": "selected code..."
  },
  "changedFiles": ["src/main.ts"]
}
```

脚本执行完成后，向标准输出（`stdout`）输出一行 JSON 对象，包含 `actions` 或 `status` 字段：

```json
{
  "actions": [
    { "type": "toast", "tone": "warning", "message": "发现 2 处未清理的调试日志" },
    { "type": "open_file", "path": "src/main.ts", "line": 12 },
    { "type": "send_to_cli", "prompt": "请清理 src/main.ts 中的调试日志" }
  ]
}
```

### 可用原子动作（`actions`）

- `toast`：`{ "type": "toast", "tone": "info|success|warning|error", "message": "..." }`
- `open_file`：`{ "type": "open_file", "path": "...", "line": 12 }`
- `replace_selection`：`{ "type": "replace_selection", "text": "..." }`
- `run_console`：`{ "type": "run_console", "text": "...", "tone": "info|error" }`
- `send_to_cli`：`{ "type": "send_to_cli", "prompt": "..." }`
- `render_drawer`：`{ "type": "render_drawer", "title": "...", "format": "markdown|table", "content": "...", "columns": [...], "rows": [[...]] }`

## 4. 视觉与字符约束

- 所有插件标题、提示文案与输出内容严禁包含 Emoji 或特殊图形符号。
- 请保持提示文本简洁克制，遵循 Onyx Light 极简界面风格。
"#;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginTriggers {
    pub menu: Option<String>,
    pub shortcut: Option<String>,
    pub palette: Option<bool>,
    pub interval_ms: Option<u64>,
    pub on_save: Option<bool>,
    pub on_git_change: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawPluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub slot: String,
    pub entry: String,
    pub runtime: String,
    pub triggers: Option<PluginTriggers>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OnyxPluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub slot: String,
    pub entry: String,
    pub runtime: String,
    pub triggers: Option<PluginTriggers>,
    pub source_dir: String,
    pub scope: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginSelection {
    pub start_line: u32,
    pub end_line: u32,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginExecutionContext {
    pub workspace_root: String,
    pub branch: String,
    pub active_file: Option<String>,
    pub selection: Option<PluginSelection>,
    pub changed_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopbarStatusOutput {
    pub label: String,
    pub tone: String,
    pub tooltip: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginExecutionResult {
    pub plugin_id: String,
    pub actions: Option<Vec<Value>>,
    pub status: Option<TopbarStatusOutput>,
    pub raw_stdout: Option<String>,
    pub stderr: Option<String>,
    pub exit_code: i32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginsUpdatedEvent {
    pub root: String,
    pub plugins: Vec<OnyxPluginManifest>,
}

pub struct PluginWatcherState {
    inner: Mutex<Option<(PathBuf, Debouncer<notify::RecommendedWatcher>)>>,
}

impl PluginWatcherState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }
}

pub fn ensure_spec_file(plugins_dir: &str) -> Result<(), String> {
    let dir = Path::new(plugins_dir);
    if !dir.exists() {
        fs::create_dir_all(dir)
            .map_err(|e| format!("创建插件目录失败 {}: {}", dir.display(), e))?;
    }
    let spec_path = dir.join("SPEC.md");
    let needs_write = match fs::read_to_string(&spec_path) {
        Ok(existing) => existing != SPEC_MD_CONTENT,
        Err(_) => true,
    };
    if needs_write {
        fs::write(&spec_path, SPEC_MD_CONTENT.as_bytes())
            .map_err(|e| format!("写入插件协议规范失败 {}: {}", spec_path.display(), e))?;
    }
    Ok(())
}

fn scan_plugin_dir(dir: &Path, scope: &str) -> Vec<OnyxPluginManifest> {
    let mut found = Vec::new();
    let Ok(entries) = fs::read_dir(dir) else {
        return found;
    };
    for entry_res in entries {
        let Ok(entry) = entry_res else {
            continue;
        };
        let plugin_dir = entry.path();
        if !plugin_dir.is_dir() {
            continue;
        }
        let manifest_path = plugin_dir.join("plugin.json");
        if !manifest_path.is_file() {
            continue;
        }
        let Ok(raw) = fs::read_to_string(&manifest_path) else {
            continue;
        };
        if let Ok(parsed) = serde_json::from_str::<RawPluginManifest>(&raw) {
            found.push(OnyxPluginManifest {
                id: parsed.id,
                name: parsed.name,
                version: parsed.version,
                description: parsed.description,
                slot: parsed.slot,
                entry: parsed.entry,
                runtime: parsed.runtime,
                triggers: parsed.triggers,
                source_dir: plugin_dir.to_string_lossy().into_owned(),
                scope: scope.to_string(),
            });
        }
    }
    found
}

pub fn list_plugins_merged(global_dir: &str, workspace_root: &str) -> Vec<OnyxPluginManifest> {
    let mut map: HashMap<String, OnyxPluginManifest> = HashMap::new();
    for item in scan_plugin_dir(Path::new(global_dir), "global") {
        map.insert(item.id.clone(), item);
    }
    let ws_plugins = Path::new(workspace_root).join(".ke").join("plugins");
    for item in scan_plugin_dir(&ws_plugins, "workspace") {
        map.insert(item.id.clone(), item);
    }
    let mut list: Vec<OnyxPluginManifest> = map.into_values().collect();
    list.sort_by(|a, b| a.name.cmp(&b.name));
    list
}

#[tauri::command]
pub fn plugin_list(env: State<'_, AppEnv>, root: String) -> Result<Vec<OnyxPluginManifest>, String> {
    let _ = ensure_spec_file(&env.ke_plugins_dir);
    Ok(list_plugins_merged(&env.ke_plugins_dir, &root))
}

#[tauri::command]
pub fn plugin_watch(
    app: AppHandle,
    env: State<'_, AppEnv>,
    watcher_state: State<'_, PluginWatcherState>,
    root: String,
) -> Result<(), String> {
    let _ = ensure_spec_file(&env.ke_plugins_dir);

    let root_path = PathBuf::from(&root);
    let mut guard = watcher_state
        .inner
        .lock()
        .map_err(|e| format!("插件监听锁异常: {}", e))?;

    if let Some((existing_root, _)) = guard.as_ref() {
        if existing_root == &root_path {
            return Ok(());
        }
    }

    let global_dir = env.ke_plugins_dir.clone();
    let root_for_cb = root.clone();

    let mut debouncer = new_debouncer(
        Duration::from_millis(50),
        move |res: DebounceEventResult| {
            if res.is_err() {
                return;
            }
            let plugins = list_plugins_merged(&global_dir, &root_for_cb);
            let _ = app.emit(
                "plugins:updated",
                PluginsUpdatedEvent {
                    root: root_for_cb.clone(),
                    plugins,
                },
            );
        },
    )
    .map_err(|e| format!("创建插件监听器失败: {}", e))?;

    let global_path = Path::new(&env.ke_plugins_dir);
    if global_path.exists() {
        let _ = debouncer
            .watcher()
            .watch(global_path, RecursiveMode::Recursive);
    }

    let ws_plugins_path = root_path.join(".ke").join("plugins");
    if ws_plugins_path.exists() {
        let _ = debouncer
            .watcher()
            .watch(&ws_plugins_path, RecursiveMode::Recursive);
    }

    *guard = Some((root_path, debouncer));
    Ok(())
}

#[tauri::command]
pub async fn plugin_execute(
    env: State<'_, AppEnv>,
    id: String,
    root: String,
    ctx: PluginExecutionContext,
) -> Result<PluginExecutionResult, String> {
    execute_plugin_core(&env, &id, &root, &ctx).await
}

pub async fn execute_plugin_core(
    env: &AppEnv,
    id: &str,
    root: &str,
    ctx: &PluginExecutionContext,
) -> Result<PluginExecutionResult, String> {
    let plugins = list_plugins_merged(&env.ke_plugins_dir, root);
    let manifest = plugins
        .into_iter()
        .find(|p| p.id == id)
        .ok_or_else(|| format!("未找到插件: {}", id))?;

    let entry_path = Path::new(&manifest.source_dir).join(&manifest.entry);
    if !entry_path.exists() {
        return Err(format!("插件入口文件不存在: {}", entry_path.display()));
    }

    let mut cmd = match manifest.runtime.as_str() {
        "binary" => Command::new(&entry_path),
        rt => {
            let bin = env.resolve_binary(rt).unwrap_or_else(|| PathBuf::from(rt));
            let mut c = Command::new(bin);
            c.arg(&entry_path);
            c
        }
    };

    cmd.current_dir(&manifest.source_dir)
        .envs(&env.vars)
        .env("KE_PLUGINS_DIR", &env.ke_plugins_dir)
        .env("KE_WORKSPACE", root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("执行插件 {} 失败: {}", id, e))?;

    if let Some(mut stdin) = child.stdin.take() {
        let input_json = serde_json::to_string(ctx)
            .map_err(|e| format!("序列化插件上下文失败: {}", e))?;
        let _ = stdin.write_all(input_json.as_bytes()).await;
        drop(stdin);
    }

    let output = tokio::time::timeout(Duration::from_secs(15), child.wait_with_output())
        .await
        .map_err(|_| format!("插件 {} 执行超时", id))?
        .map_err(|e| format!("等待插件 {} 退出失败: {}", id, e))?;

    let exit_code = output.status.code().unwrap_or(-1);
    let stdout_str = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr_str = String::from_utf8_lossy(&output.stderr).trim().to_string();

    let parsed_val: Option<Value> = stdout_str
        .lines()
        .rev()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .and_then(|line| serde_json::from_str::<Value>(line).ok())
        .or_else(|| serde_json::from_str::<Value>(stdout_str.trim()).ok());

    let mut actions: Option<Vec<Value>> = None;
    let mut status: Option<TopbarStatusOutput> = None;

    if let Some(val) = parsed_val {
        if let Some(arr) = val.get("actions").and_then(|a| a.as_array()) {
            actions = Some(arr.clone());
        }
        if let Some(st_val) = val.get("status") {
            if let Ok(st) = serde_json::from_value::<TopbarStatusOutput>(st_val.clone()) {
                status = Some(st);
            }
        } else if val.get("label").is_some() && val.get("tone").is_some() {
            if let Ok(st) = serde_json::from_value::<TopbarStatusOutput>(val.clone()) {
                status = Some(st);
            }
        }
    }

    Ok(PluginExecutionResult {
        plugin_id: id.to_string(),
        actions,
        status,
        raw_stdout: if stdout_str.trim().is_empty() {
            None
        } else {
            Some(stdout_str)
        },
        stderr: if stderr_str.is_empty() {
            None
        } else {
            Some(stderr_str)
        },
        exit_code,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn test_ensure_spec_and_scan_plugins() {
        let tmp = std::env::temp_dir().join(format!(
            "ke_plugin_test_{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let global_dir = tmp.join("global_plugins");
        let ws_dir = tmp.join("ws");
        let plugin_dir = ws_dir.join(".ke/plugins/sample-check");
        fs::create_dir_all(&plugin_dir).unwrap();

        ensure_spec_file(global_dir.to_str().unwrap()).unwrap();
        assert!(global_dir.join("SPEC.md").is_file());
        let spec = fs::read_to_string(global_dir.join("SPEC.md")).unwrap();
        assert!(spec.contains("Klot IDE"));
        assert!(spec.contains("~/.ke/plugins"));

        fs::write(
            plugin_dir.join("plugin.json"),
            r#"{"id":"sample-check","name":"Sample Check","version":"0.1.0","slot":"command","entry":"run.sh","runtime":"sh"}"#,
        )
        .unwrap();

        let list = list_plugins_merged(global_dir.to_str().unwrap(), ws_dir.to_str().unwrap());
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "sample-check");
        assert_eq!(list[0].scope, "workspace");

        let _ = fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn test_execute_workspace_ke_plugins() {
        let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
        let workspace_root = manifest_dir.parent().unwrap().to_str().unwrap().to_string();
        let env = AppEnv::init();

        let plugins = list_plugins_merged(&env.ke_plugins_dir, &workspace_root);
        assert!(plugins.iter().any(|p| p.id == "git-review-to-cli"));
        assert!(plugins.iter().any(|p| p.id == "todo-audit"));

        if env.resolve_binary("node").is_some() {
            let ctx = PluginExecutionContext {
                workspace_root: workspace_root.clone(),
                branch: "main".to_string(),
                active_file: Some("src-tauri/src/plugin_host.rs".to_string()),
                selection: None,
                changed_files: vec![],
            };

            let res_todo = execute_plugin_core(&env, "todo-audit", &workspace_root, &ctx)
                .await
                .unwrap();
            assert_eq!(res_todo.exit_code, 0);
            let actions = res_todo.actions.unwrap_or_default();
            assert!(actions
                .iter()
                .any(|a| a.get("type").and_then(|v| v.as_str()) == Some("render_drawer")));

            let res_git = execute_plugin_core(&env, "git-review-to-cli", &workspace_root, &ctx)
                .await
                .unwrap();
            assert_eq!(res_git.exit_code, 0);
            assert!(res_git.actions.is_some());
        }
    }
}
