use ignore::WalkBuilder;
use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use serde::Serialize;
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, State};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsTreeNode {
    pub name: String,
    pub path: String,
    pub full_path: String,
    pub is_dir: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_git_repo: Option<bool>,
    pub size: Option<u64>,
    pub children: Option<Vec<FsTreeNode>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsFileContent {
    pub path: String,
    pub content: String,
    pub encoding: String,
    pub size: u64,
    pub modified_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsAssetDataUrl {
    pub path: String,
    pub mime_type: String,
    pub data_url: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsChangedEvent {
    pub root: String,
    pub paths: Vec<String>,
    pub kind: String,
    pub timestamp_ms: u64,
}

pub struct FsWatcherState {
    inner: Mutex<Option<(PathBuf, Debouncer<notify::RecommendedWatcher>)>>,
}

impl FsWatcherState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }
}

fn should_skip_dir(name: &str) -> bool {
    matches!(
        name,
        ".git" | "node_modules" | "target" | "dist" | ".DS_Store" | ".next" | ".turbo"
    )
}

fn should_skip_probe_dir(name: &str) -> bool {
    matches!(
        name,
        ".git"
            | "node_modules"
            | "target"
            | "dist"
            | "build"
            | ".next"
            | ".turbo"
            | ".venv"
            | "venv"
            | "vendor"
            | ".ke"
            | ".idea"
            | ".vscode"
            | ".DS_Store"
    )
}

fn walk_nested_git_repos(
    root: &Path,
    cur: &Path,
    depth: usize,
    max_depth: usize,
    out: &mut Vec<PathBuf>,
) {
    if depth >= max_depth {
        return;
    }
    let Ok(entries) = fs::read_dir(cur) else {
        return;
    };
    for entry_res in entries {
        let Ok(entry) = entry_res else {
            continue;
        };
        let Ok(ft) = entry.file_type() else {
            continue;
        };
        if ft.is_symlink() || !ft.is_dir() {
            continue;
        }
        let name = entry.file_name();
        let Some(name_str) = name.to_str() else {
            continue;
        };
        if should_skip_probe_dir(name_str) {
            continue;
        }

        let child_path = entry.path();
        let child_depth = depth + 1;
        if child_path.join(".git").exists() {
            if let Ok(rel) = child_path.strip_prefix(root) {
                out.push(rel.to_path_buf());
            }
            // 仅当存在 .gitmodules 时允许继续向下探测直接 submodule
            if child_path.join(".gitmodules").exists() {
                walk_nested_git_repos(root, &child_path, child_depth, child_depth + 1, out);
            }
        } else if child_depth < max_depth {
            walk_nested_git_repos(root, &child_path, child_depth, max_depth, out);
        }
    }
}

pub fn discover_nested_git_repos(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    walk_nested_git_repos(root, root, 0, 3, &mut out);
    out.sort_by(|a, b| {
        a.to_string_lossy()
            .replace('\\', "/")
            .cmp(&b.to_string_lossy().replace('\\', "/"))
    });
    out.dedup();
    out
}

pub fn should_ignore_watch_path(rel: &Path) -> bool {
    let rel_str = rel.to_string_lossy().replace('\\', "/");
    if rel_str.is_empty() {
        return true;
    }

    let comps: Vec<&str> = rel
        .components()
        .filter_map(|c| c.as_os_str().to_str())
        .collect();

    if comps.iter().any(|&name| {
        matches!(
            name,
            "node_modules" | "target" | "dist" | ".DS_Store" | ".next" | ".turbo"
        )
    }) {
        return true;
    }

    if let Some(git_pos) = comps.iter().position(|&c| c == ".git") {
        let after = &comps[git_pos + 1..];
        if after.is_empty() {
            return false;
        }
        let sub = after.join("/");
        if sub.ends_with(".lock") {
            return true;
        }
        if matches!(
            sub.as_str(),
            "HEAD" | "index" | "packed-refs" | "config" | "MERGE_HEAD" | "REBASE_HEAD"
        ) {
            return false;
        }
        if sub == "refs" || sub.starts_with("refs/") {
            return false;
        }
        return true;
    }

    if rel_str.ends_with(".lock") {
        return true;
    }

    false
}

#[derive(Default)]
struct DirBuilder {
    name: String,
    rel_path: String,
    full_path: String,
    is_git_repo: bool,
    dirs: BTreeMap<String, DirBuilder>,
    files: Vec<FsTreeNode>,
}

impl DirBuilder {
    fn into_nodes(self) -> Vec<FsTreeNode> {
        let mut result = Vec::with_capacity(self.dirs.len() + self.files.len());
        let mut dir_nodes: Vec<FsTreeNode> = self
            .dirs
            .into_values()
            .map(|d| {
                let name = d.name.clone();
                let rel_path = d.rel_path.clone();
                let full_path = d.full_path.clone();
                let is_git_repo = if d.is_git_repo { Some(true) } else { None };
                let children = d.into_nodes();
                FsTreeNode {
                    name,
                    path: rel_path,
                    full_path,
                    is_dir: true,
                    is_git_repo,
                    size: None,
                    children: Some(children),
                }
            })
            .collect();
        dir_nodes.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

        let mut file_nodes = self.files;
        file_nodes.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

        result.extend(dir_nodes);
        result.extend(file_nodes);
        result
    }
}

fn ensure_dir_chain<'a>(
    tree: &'a mut DirBuilder,
    root: &Path,
    components: &[String],
    mark_last_git_repo: bool,
) -> &'a mut DirBuilder {
    let mut cursor = tree;
    let mut accum_rel = String::new();
    let mut accum_full = root.to_path_buf();

    for (idx, part) in components.iter().enumerate() {
        if !accum_rel.is_empty() {
            accum_rel.push('/');
        }
        accum_rel.push_str(part);
        accum_full.push(part);

        let key = part.clone();
        let rel_clone = accum_rel.clone();
        let full_clone = accum_full.to_string_lossy().into_owned();
        cursor = cursor.dirs.entry(key).or_insert_with(|| DirBuilder {
            name: part.clone(),
            rel_path: rel_clone,
            full_path: full_clone,
            is_git_repo: false,
            dirs: BTreeMap::new(),
            files: Vec::new(),
        });
        if mark_last_git_repo && idx == components.len() - 1 {
            cursor.is_git_repo = true;
        }
    }
    cursor
}

fn walk_and_insert_into_tree(
    tree: &mut DirBuilder,
    workspace_root: &Path,
    walk_root: &Path,
    nested_abs_set: &HashSet<PathBuf>,
) {
    let skip_set = nested_abs_set.clone();
    let walk_root_buf = walk_root.to_path_buf();

    let walker = WalkBuilder::new(walk_root)
        .hidden(false)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .filter_entry(move |entry| {
            if entry.depth() == 0 {
                return true;
            }
            if let Some(name) = entry.file_name().to_str() {
                if should_skip_dir(name) {
                    return false;
                }
            }
            let p = entry.path();
            if p != walk_root_buf && skip_set.contains(p) {
                return false;
            }
            true
        })
        .build();

    for entry_res in walker {
        let entry = match entry_res {
            Ok(e) => e,
            Err(_) => continue,
        };
        if entry.depth() == 0 {
            continue;
        }
        let abs_path = entry.path();
        let rel = match abs_path.strip_prefix(workspace_root) {
            Ok(r) => r,
            Err(_) => continue,
        };
        let components: Vec<String> = rel
            .iter()
            .filter_map(|c| c.to_str().map(|s| s.to_string()))
            .collect();
        if components.is_empty() {
            continue;
        }

        let is_dir = entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false);
        if is_dir {
            ensure_dir_chain(tree, workspace_root, &components, false);
        } else {
            let parent_comps = &components[..components.len() - 1];
            let dir_builder = ensure_dir_chain(tree, workspace_root, parent_comps, false);
            let file_name = components[components.len() - 1].clone();
            let rel_str = components.join("/");
            let size = entry.metadata().ok().map(|m| m.len());
            dir_builder.files.push(FsTreeNode {
                name: file_name,
                path: rel_str,
                full_path: abs_path.to_string_lossy().into_owned(),
                is_dir: false,
                is_git_repo: None,
                size,
                children: None,
            });
        }
    }
}

pub fn build_fs_tree(root: &Path) -> Result<Vec<FsTreeNode>, String> {
    if !root.exists() {
        return Err(format!("工作区目录不存在: {}", root.display()));
    }

    let mut tree = DirBuilder::default();
    let nested_repos = discover_nested_git_repos(root);
    let nested_abs_set: HashSet<PathBuf> = nested_repos.iter().map(|rel| root.join(rel)).collect();

    // 1. 扫描外层目录（跳过已探测的子仓库，使其不受外层 .gitignore 通配屏蔽）
    walk_and_insert_into_tree(&mut tree, root, root, &nested_abs_set);

    // 2. 分别挂载并扫描各嵌套 Git 子仓库（确保空子仓库也显示并标记 isGitRepo）
    for sub_rel in &nested_repos {
        let comps: Vec<String> = sub_rel
            .iter()
            .filter_map(|c| c.to_str().map(|s| s.to_string()))
            .collect();
        if !comps.is_empty() {
            ensure_dir_chain(&mut tree, root, &comps, true);
        }
        let sub_root = root.join(sub_rel);
        walk_and_insert_into_tree(&mut tree, root, &sub_root, &nested_abs_set);
    }

    Ok(tree.into_nodes())
}

#[tauri::command]
pub async fn fs_list_tree(root: String) -> Result<Vec<FsTreeNode>, String> {
    tokio::task::spawn_blocking(move || build_fs_tree(Path::new(&root)))
        .await
        .map_err(|e| format!("目录扫描任务异常: {}", e))?
}

#[tauri::command]
pub async fn fs_read_file(path: String) -> Result<FsFileContent, String> {
    tokio::task::spawn_blocking(move || {
        let p = Path::new(&path);
        let meta = fs::metadata(p).map_err(|e| format!("读取文件元信息失败 {}: {}", path, e))?;
        let bytes = fs::read(p).map_err(|e| format!("读取文件失败 {}: {}", path, e))?;
        let is_binary = bytes.iter().take(8192).any(|&b| b == 0);
        let (content, encoding) = if is_binary {
            (
                format!("[二进制文件，大小 {} 字节]", bytes.len()),
                "binary".to_string(),
            )
        } else {
            (
                String::from_utf8_lossy(&bytes).into_owned(),
                "utf-8".to_string(),
            )
        };
        let modified_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        Ok(FsFileContent {
            path,
            content,
            encoding,
            size: meta.len(),
            modified_ms,
        })
    })
    .await
    .map_err(|e| format!("读取文件任务异常: {}", e))?
}

#[tauri::command]
pub async fn fs_write_file(path: String, text: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let p = Path::new(&path);
        if let Some(parent) = p.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("创建父目录失败 {}: {}", parent.display(), e))?;
            }
        }
        fs::write(p, text.as_bytes()).map_err(|e| format!("写入文件失败 {}: {}", path, e))
    })
    .await
    .map_err(|e| format!("写入文件任务异常: {}", e))?
}

#[tauri::command]
pub async fn fs_create_file(path: String, is_dir: Option<bool>) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let p = Path::new(&path);
        if is_dir.unwrap_or(false) {
            fs::create_dir_all(p).map_err(|e| format!("创建目录失败 {}: {}", path, e))?;
        } else {
            if let Some(parent) = p.parent() {
                if !parent.exists() {
                    fs::create_dir_all(parent)
                        .map_err(|e| format!("创建父目录失败 {}: {}", parent.display(), e))?;
                }
            }
            if !p.exists() {
                fs::write(p, b"").map_err(|e| format!("创建文件失败 {}: {}", path, e))?;
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("创建文件任务异常: {}", e))?
}

#[tauri::command]
pub async fn fs_rename(old_path: String, new_path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let new_p = Path::new(&new_path);
        if let Some(parent) = new_p.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("创建目标目录失败 {}: {}", parent.display(), e))?;
            }
        }
        fs::rename(&old_path, &new_path)
            .map_err(|e| format!("重命名失败 {} -> {}: {}", old_path, new_path, e))
    })
    .await
    .map_err(|e| format!("重命名任务异常: {}", e))?
}

#[tauri::command]
pub async fn fs_delete(path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let p = Path::new(&path);
        if !p.exists() {
            return Ok(());
        }
        if p.is_dir() {
            fs::remove_dir_all(p).map_err(|e| format!("删除目录失败 {}: {}", path, e))
        } else {
            fs::remove_file(p).map_err(|e| format!("删除文件失败 {}: {}", path, e))
        }
    })
    .await
    .map_err(|e| format!("删除任务异常: {}", e))?
}

#[tauri::command]
pub fn fs_watch_workspace(
    app: AppHandle,
    state: State<'_, FsWatcherState>,
    root: String,
) -> Result<(), String> {
    let root_path = PathBuf::from(&root);
    if !root_path.exists() {
        return Err(format!("监听目录不存在: {}", root));
    }

    let mut guard = state.inner.lock().map_err(|e| format!("锁异常: {}", e))?;
    if let Some((existing_root, _)) = guard.as_ref() {
        if existing_root == &root_path {
            return Ok(());
        }
    }

    let root_str = root.clone();
    let root_for_cb = root_path.clone();

    let mut debouncer = new_debouncer(
        Duration::from_millis(120),
        move |res: DebounceEventResult| {
            let Ok(events) = res else {
                return;
            };
            let mut changed_paths = Vec::new();
            for ev in events {
                if let Ok(rel) = ev.path.strip_prefix(&root_for_cb) {
                    if should_ignore_watch_path(rel) {
                        continue;
                    }
                    let rel_str = rel.to_string_lossy().replace('\\', "/");
                    if !rel_str.is_empty() && !changed_paths.contains(&rel_str) {
                        changed_paths.push(rel_str);
                    }
                }
            }
            if changed_paths.is_empty() {
                return;
            }
            let timestamp_ms = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);

            let _ = app.emit(
                "fs:changed",
                FsChangedEvent {
                    root: root_str.clone(),
                    paths: changed_paths,
                    kind: "any".to_string(),
                    timestamp_ms,
                },
            );
        },
    )
    .map_err(|e| format!("初始化文件监听器失败: {}", e))?;

    debouncer
        .watcher()
        .watch(&root_path, RecursiveMode::Recursive)
        .map_err(|e| format!("监听工作区失败 {}: {}", root, e))?;

    *guard = Some((root_path, debouncer));
    Ok(())
}

#[tauri::command]
pub async fn fs_reveal_in_finder(path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if !target.exists() {
        return Err(format!("目标路径不存在: {}", path));
    }

    #[cfg(target_os = "macos")]
    {
        let status = tokio::process::Command::new("/usr/bin/open")
            .arg("-R")
            .arg(&target)
            .status()
            .await
            .map_err(|e| format!("打开 Finder 失败: {}", e))?;
        if !status.success() {
            return Err("无法在 Finder 中显示该路径".to_string());
        }
        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = target;
        Err("当前操作系统暂不支持 Finder 定位".to_string())
    }
}

const MAX_ASSET_BYTES: u64 = 16 * 1024 * 1024;
const BASE64_TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn encode_base64(input: &[u8]) -> String {
    if input.is_empty() {
        return String::new();
    }
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as usize;
        let b1 = if chunk.len() > 1 { chunk[1] as usize } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as usize } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;

        out.push(BASE64_TABLE[(triple >> 18) & 0x3f] as char);
        out.push(BASE64_TABLE[(triple >> 12) & 0x3f] as char);
        out.push(if chunk.len() > 1 {
            BASE64_TABLE[(triple >> 6) & 0x3f] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            BASE64_TABLE[triple & 0x3f] as char
        } else {
            '='
        });
    }
    out
}

fn image_mime_for_path(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "svg" => Some("image/svg+xml"),
        "bmp" => Some("image/bmp"),
        "ico" => Some("image/x-icon"),
        "avif" => Some("image/avif"),
        _ => None,
    }
}

fn read_asset_data_url_sync(path: &Path) -> Result<FsAssetDataUrl, String> {
    let mime = image_mime_for_path(path)
        .ok_or_else(|| format!("不支持的图片资源类型: {}", path.display()))?;
    let meta = fs::metadata(path)
        .map_err(|e| format!("读取资源元信息失败 {}: {}", path.display(), e))?;
    if !meta.is_file() {
        return Err(format!("资源路径不是文件: {}", path.display()));
    }
    if meta.len() > MAX_ASSET_BYTES {
        return Err(format!(
            "图片资源超过 16 MB 上限 ({} 字节): {}",
            meta.len(),
            path.display()
        ));
    }
    let bytes = fs::read(path).map_err(|e| format!("读取资源失败 {}: {}", path.display(), e))?;
    let data_url = format!("data:{};base64,{}", mime, encode_base64(&bytes));
    Ok(FsAssetDataUrl {
        path: path.to_string_lossy().into_owned(),
        mime_type: mime.to_string(),
        data_url,
        size: bytes.len() as u64,
    })
}

#[tauri::command]
pub async fn fs_read_asset_data_url(path: String) -> Result<FsAssetDataUrl, String> {
    tokio::task::spawn_blocking(move || read_asset_data_url_sync(Path::new(&path)))
        .await
        .map_err(|e| format!("读取资源任务异常: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_fs_tree_skips_ignored_and_sorts() {
        let tmp = std::env::temp_dir().join(format!(
            "ke_fs_tree_test_{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(tmp.join("src/core")).unwrap();
        fs::create_dir_all(tmp.join("node_modules/pkg")).unwrap();
        fs::write(tmp.join("src/core/service.ts"), "export const ok = 1;\n").unwrap();
        fs::write(tmp.join("README.md"), "# Test\n").unwrap();
        fs::write(tmp.join("node_modules/pkg/index.js"), "ignored").unwrap();

        let nodes = build_fs_tree(&tmp).unwrap();
        assert_eq!(nodes.len(), 2);
        assert!(nodes[0].is_dir);
        assert_eq!(nodes[0].name, "src");
        assert!(!nodes[1].is_dir);
        assert_eq!(nodes[1].name, "README.md");

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_build_fs_tree_filters_git_target_dist_and_gitignore() {
        let tmp = std::env::temp_dir().join(format!(
            "ke_fs_filter_test_{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(tmp.join(".git/objects")).unwrap();
        fs::create_dir_all(tmp.join("target/debug")).unwrap();
        fs::create_dir_all(tmp.join("dist")).unwrap();
        fs::create_dir_all(tmp.join("logs")).unwrap();
        fs::create_dir_all(tmp.join("app")).unwrap();

        fs::write(tmp.join(".git/HEAD"), "ref: refs/heads/main\n").unwrap();
        fs::write(tmp.join("target/debug/bin"), "bin").unwrap();
        fs::write(tmp.join("dist/bundle.js"), "js").unwrap();
        fs::write(tmp.join("logs/dev.log"), "log").unwrap();
        fs::write(tmp.join(".gitignore"), "logs/\n*.secret\n").unwrap();
        fs::write(tmp.join("app/main.ts"), "console.log(1);\n").unwrap();
        fs::write(tmp.join("app/key.secret"), "secret").unwrap();

        let nodes = build_fs_tree(&tmp).unwrap();
        let names: Vec<&str> = nodes.iter().map(|n| n.name.as_str()).collect();
        assert!(!names.contains(&".git"));
        assert!(!names.contains(&"target"));
        assert!(!names.contains(&"dist"));
        assert!(!names.contains(&"logs"));
        assert!(names.contains(&"app"));

        let app_node = nodes.iter().find(|n| n.name == "app").unwrap();
        let app_children: Vec<&str> = app_node
            .children
            .as_ref()
            .unwrap()
            .iter()
            .map(|n| n.name.as_str())
            .collect();
        assert_eq!(app_children, vec!["main.ts"]);

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_should_ignore_watch_path() {
        // 放行 .git 关键元数据与 refs
        assert!(!should_ignore_watch_path(Path::new(".git")));
        assert!(!should_ignore_watch_path(Path::new(".git/HEAD")));
        assert!(!should_ignore_watch_path(Path::new(".git/index")));
        assert!(!should_ignore_watch_path(Path::new(".git/packed-refs")));
        assert!(!should_ignore_watch_path(Path::new(".git/config")));
        assert!(!should_ignore_watch_path(Path::new(".git/MERGE_HEAD")));
        assert!(!should_ignore_watch_path(Path::new(".git/REBASE_HEAD")));
        assert!(!should_ignore_watch_path(Path::new(".git/refs")));
        assert!(!should_ignore_watch_path(Path::new(".git/refs/heads/main")));

        // 屏蔽 .git 内部噪音与 lock 文件
        assert!(should_ignore_watch_path(Path::new(".git/index.lock")));
        assert!(should_ignore_watch_path(Path::new(".git/refs/heads/main.lock")));
        assert!(should_ignore_watch_path(Path::new(".git/objects/12/3456")));
        assert!(should_ignore_watch_path(Path::new(".git/logs/HEAD")));
        assert!(should_ignore_watch_path(Path::new(".git/FETCH_HEAD")));
        assert!(should_ignore_watch_path(Path::new(".git/COMMIT_EDITMSG")));

        // 屏蔽构建/依赖目录及 .lock，放行普通源码
        assert!(should_ignore_watch_path(Path::new("node_modules/pkg/index.js")));
        assert!(should_ignore_watch_path(Path::new("target/debug/klot-ide")));
        assert!(should_ignore_watch_path(Path::new("dist/index.html")));
        assert!(should_ignore_watch_path(Path::new(".DS_Store")));
        assert!(should_ignore_watch_path(Path::new(".next/static/chunk.js")));
        assert!(should_ignore_watch_path(Path::new(".turbo/cache")));
        assert!(should_ignore_watch_path(Path::new("Cargo.lock")));
        assert!(!should_ignore_watch_path(Path::new("src/App.tsx")));
    }

    #[test]
    fn test_encode_base64_vectors() {
        assert_eq!(encode_base64(b""), "");
        assert_eq!(encode_base64(b"f"), "Zg==");
        assert_eq!(encode_base64(b"fo"), "Zm8=");
        assert_eq!(encode_base64(b"foo"), "Zm9v");
        assert_eq!(encode_base64(b"foob"), "Zm9vYg==");
        assert_eq!(encode_base64(b"fooba"), "Zm9vYmE=");
        assert_eq!(encode_base64(b"foobar"), "Zm9vYmFy");
        assert_eq!(encode_base64(&[0u8, 255u8, 128u8]), "AP+A");
    }

    #[test]
    fn test_read_asset_data_url_sync() {
        let tmp = std::env::temp_dir().join(format!(
            "ke_fs_asset_test_{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&tmp).unwrap();

        let png_path = tmp.join("pixel.png");
        let bytes = [137u8, 80, 78, 71, 13, 10, 26, 10];
        fs::write(&png_path, bytes).unwrap();
        let asset = read_asset_data_url_sync(&png_path).unwrap();
        assert_eq!(asset.mime_type, "image/png");
        assert_eq!(asset.size, bytes.len() as u64);
        assert!(asset.data_url.starts_with("data:image/png;base64,"));
        assert_eq!(
            asset.data_url,
            format!("data:image/png;base64,{}", encode_base64(&bytes))
        );

        let txt_path = tmp.join("note.txt");
        fs::write(&txt_path, b"hello").unwrap();
        assert!(read_asset_data_url_sync(&txt_path).is_err());

        let missing_path = tmp.join("missing.png");
        assert!(read_asset_data_url_sync(&missing_path).is_err());

        let _ = fs::remove_dir_all(&tmp);
    }
}
