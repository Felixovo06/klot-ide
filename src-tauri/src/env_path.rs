use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tauri::State;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppContextInfo {
    pub default_workspace: String,
    pub home_dir: String,
    pub platform: String,
    pub available_clis: Vec<String>,
    pub onyx_plugins_dir: String,
    pub from_cli_arg: bool,
}

#[derive(Debug, Clone)]
pub struct AppEnv {
    pub vars: HashMap<String, String>,
    pub path: String,
    pub home_dir: String,
    pub default_workspace: String,
    pub ke_plugins_dir: String,
    pub from_cli_arg: bool,
}

impl AppEnv {
    pub fn init() -> Self {
        let mut vars: HashMap<String, String> = std::env::vars().collect();

        if let Some(shell_vars) = capture_login_shell_env(Duration::from_millis(2000)) {
            for (k, v) in shell_vars {
                vars.insert(k, v);
            }
        }

        let home_dir = vars
            .get("HOME")
            .cloned()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "/Users".to_string());

        let existing_path = vars.get("PATH").cloned().unwrap_or_default();
        let merged_path = merge_standard_paths(&existing_path, &home_dir);
        vars.insert("PATH".to_string(), merged_path.clone());

        let (default_workspace, from_cli_arg) = detect_default_workspace(&home_dir);
        let ke_plugins_dir = Path::new(&home_dir)
            .join(".ke")
            .join("plugins")
            .to_string_lossy()
            .into_owned();

        Self {
            vars,
            path: merged_path,
            home_dir,
            default_workspace,
            ke_plugins_dir,
            from_cli_arg,
        }
    }

    pub fn resolve_binary(&self, name: &str) -> Option<PathBuf> {
        let candidate = Path::new(name);
        if candidate.is_absolute() {
            return if is_executable_file(candidate) {
                Some(candidate.to_path_buf())
            } else {
                None
            };
        }

        for dir in std::env::split_paths(&self.path) {
            let full = dir.join(name);
            if is_executable_file(&full) {
                return Some(full);
            }
        }
        None
    }

    pub fn available_clis(&self) -> Vec<String> {
        let mut found = Vec::new();
        for cli in ["claude", "agy", "pi", "codex", "zsh"] {
            if self.resolve_binary(cli).is_some() || (cli == "zsh" && Path::new("/bin/zsh").exists()) {
                found.push(cli.to_string());
            }
        }
        if found.is_empty() {
            found.push("zsh".to_string());
        }
        found
    }
}

fn is_executable_file(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(path) {
            return (meta.permissions().mode() & 0o111) != 0;
        }
        false
    }
    #[cfg(not(unix))]
    {
        true
    }
}

pub fn resolve_workspace_from_arg(arg: Option<&str>, cwd: Option<&Path>) -> Option<String> {
    let raw = arg?.trim();
    if raw.is_empty() || raw.starts_with('-') {
        return None;
    }
    let p = Path::new(raw);
    let abs = if p.is_absolute() {
        p.to_path_buf()
    } else if let Some(base) = cwd {
        base.join(p)
    } else {
        p.to_path_buf()
    };

    let target = if abs.is_file() {
        abs.parent().map(|parent| parent.to_path_buf())?
    } else if abs.is_dir() {
        abs
    } else {
        return None;
    };

    std::fs::canonicalize(&target)
        .ok()
        .map(|canon| canon.to_string_lossy().into_owned())
}

pub fn detect_workspace_fallback(
    arg: Option<&str>,
    cwd: Option<&Path>,
    home_dir: &str,
) -> (String, bool) {
    if let Some(from_arg) = resolve_workspace_from_arg(arg, cwd) {
        return (from_arg, true);
    }
    if let Some(cwd_path) = cwd {
        // macOS Finder/Dock 双击启动 .app 时 cwd 通常为根目录 "/"，此时回落至用户主目录
        if cwd_path == Path::new("/") {
            return (home_dir.to_string(), false);
        }
        let resolved = if cwd_path.file_name().and_then(|n| n.to_str()) == Some("src-tauri") {
            cwd_path.parent().map(|p| p.to_path_buf()).unwrap_or(cwd_path.to_path_buf())
        } else {
            cwd_path.to_path_buf()
        };
        if resolved.exists() && resolved != Path::new("/") {
            return (resolved.to_string_lossy().into_owned(), false);
        }
    }
    (home_dir.to_string(), false)
}

fn detect_default_workspace(home_dir: &str) -> (String, bool) {
    let cwd = std::env::current_dir().ok();
    let arg = std::env::args().nth(1);
    detect_workspace_fallback(arg.as_deref(), cwd.as_deref(), home_dir)
}

fn capture_login_shell_env(timeout: Duration) -> Option<HashMap<String, String>> {
    let shell = if Path::new("/bin/zsh").exists() {
        "/bin/zsh"
    } else {
        "/bin/sh"
    };

    let mut child = Command::new(shell)
        .args(["-lic", "env -0"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    let mut stdout = child.stdout.take()?;
    let deadline = Instant::now() + timeout;

    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return None;
                }
                let mut buf = Vec::new();
                use std::io::Read;
                stdout.read_to_end(&mut buf).ok()?;
                return Some(parse_env_null_separated(&buf));
            }
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            Err(_) => return None,
        }
    }
}

pub fn parse_env_null_separated(bytes: &[u8]) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for entry in bytes.split(|&b| b == 0) {
        if entry.is_empty() {
            continue;
        }
        let s = String::from_utf8_lossy(entry);
        if let Some((k, v)) = s.split_once('=') {
            if !k.is_empty() {
                map.insert(k.to_string(), v.to_string());
            }
        }
    }
    map
}

pub fn merge_standard_paths(existing: &str, home_dir: &str) -> String {
    let mut seen = HashSet::new();
    let mut ordered = Vec::new();

    let extra_candidates = [
        "/opt/homebrew/bin".to_string(),
        "/opt/homebrew/sbin".to_string(),
        "/usr/local/bin".to_string(),
        format!("{}/.local/bin", home_dir),
        format!("{}/.cargo/bin", home_dir),
        "/usr/bin".to_string(),
        "/bin".to_string(),
        "/usr/sbin".to_string(),
        "/sbin".to_string(),
    ];

    for p in existing.split(':').filter(|s| !s.is_empty()) {
        if seen.insert(p.to_string()) {
            ordered.push(p.to_string());
        }
    }

    for candidate in extra_candidates {
        if seen.insert(candidate.clone()) {
            ordered.push(candidate);
        }
    }

    ordered.join(":")
}

#[tauri::command]
pub fn app_get_context(env: State<'_, AppEnv>) -> AppContextInfo {
    AppContextInfo {
        default_workspace: env.default_workspace.clone(),
        home_dir: env.home_dir.clone(),
        platform: std::env::consts::OS.to_string(),
        available_clis: env.available_clis(),
        onyx_plugins_dir: env.ke_plugins_dir.clone(),
        from_cli_arg: env.from_cli_arg,
    }
}

fn resolve_picker_start_dir(default_path: Option<&str>, home_dir: &str) -> PathBuf {
    if let Some(raw) = default_path.map(str::trim).filter(|s| !s.is_empty()) {
        let p = Path::new(raw);
        if p.is_dir() {
            return p.to_path_buf();
        }
        if p.is_file() {
            if let Some(parent) = p.parent() {
                if parent.is_dir() {
                    return parent.to_path_buf();
                }
            }
        }
    }
    PathBuf::from(home_dir)
}

#[tauri::command]
pub async fn app_pick_workspace(
    env: State<'_, AppEnv>,
    default_path: Option<String>,
) -> Result<Option<String>, String> {
    let start_dir = resolve_picker_start_dir(default_path.as_deref(), &env.home_dir);
    let picked = rfd::AsyncFileDialog::new()
        .set_title("打开项目文件夹")
        .set_directory(&start_dir)
        .pick_folder()
        .await;

    let Some(handle) = picked else {
        return Ok(None);
    };
    let path = handle.path();
    let canon = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    Ok(Some(canon.to_string_lossy().into_owned()))
}

pub fn open_workspace_window_args(root: &str) -> Result<(PathBuf, String), String> {
    let trimmed = root.trim();
    let p = Path::new(trimmed);
    if !p.is_dir() {
        return Err(format!("目标工作区目录不存在: {}", root));
    }
    let canon = std::fs::canonicalize(p)
        .map_err(|e| format!("解析工作区路径失败 {}: {}", root, e))?;
    let exe = std::env::current_exe()
        .map_err(|e| format!("获取当前应用可执行路径失败: {}", e))?;
    Ok((exe, canon.to_string_lossy().into_owned()))
}

#[tauri::command]
pub fn app_open_workspace_window(root: String) -> Result<(), String> {
    let (exe, canon_root) = open_workspace_window_args(&root)?;
    Command::new(exe)
        .arg(&canon_root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("启动新窗口失败: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn app_open_external(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        return Err("仅允许打开 http:// 或 https:// 外部链接".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        let status = tokio::process::Command::new("/usr/bin/open")
            .arg(trimmed)
            .status()
            .await
            .map_err(|e| format!("打开外部链接失败: {}", e))?;
        if !status.success() {
            return Err(format!("无法打开外部链接: {}", trimmed));
        }
        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("当前操作系统暂不支持打开外部浏览器".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_env_null_separated() {
        let raw = b"PATH=/usr/bin:/bin\0HOME=/Users/tester\0EMPTY=\0INVALID\0";
        let map = parse_env_null_separated(raw);
        assert_eq!(map.get("PATH").map(String::as_str), Some("/usr/bin:/bin"));
        assert_eq!(map.get("HOME").map(String::as_str), Some("/Users/tester"));
        assert_eq!(map.get("EMPTY").map(String::as_str), Some(""));
        assert!(!map.contains_key("INVALID"));
    }

    #[test]
    fn test_merge_standard_paths_preserves_order_and_dedups() {
        let merged = merge_standard_paths("/custom/bin:/opt/homebrew/bin", "/Users/tester");
        let parts: Vec<&str> = merged.split(':').collect();
        assert_eq!(parts[0], "/custom/bin");
        assert_eq!(parts[1], "/opt/homebrew/bin");
        assert!(parts.contains(&"/Users/tester/.cargo/bin"));
        assert!(parts.contains(&"/Users/tester/.local/bin"));
        assert_eq!(
            parts.iter().filter(|&&p| p == "/opt/homebrew/bin").count(),
            1
        );
    }

    #[test]
    fn test_resolve_workspace_from_arg() {
        let tmp = std::env::temp_dir().join(format!(
            "ke_arg_test_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(tmp.join("repo")).unwrap();
        let file_path = tmp.join("repo/main.rs");
        std::fs::write(&file_path, "fn main() {}\n").unwrap();

        let canon_repo = std::fs::canonicalize(tmp.join("repo"))
            .unwrap()
            .to_string_lossy()
            .into_owned();

        // 目录参数
        assert_eq!(
            resolve_workspace_from_arg(Some("repo"), Some(&tmp)).as_deref(),
            Some(canon_repo.as_str())
        );
        // 文件参数自动取父目录
        assert_eq!(
            resolve_workspace_from_arg(Some(file_path.to_str().unwrap()), None).as_deref(),
            Some(canon_repo.as_str())
        );
        // 忽略 macOS Finder -psn_* 参数与不存在路径
        assert_eq!(resolve_workspace_from_arg(Some("-psn_0_12345"), None), None);
        assert_eq!(resolve_workspace_from_arg(Some("/nonexistent/ke/path"), None), None);

        // 根目录 "/" (Finder 启动默认 cwd) 应回退到 home_dir 且 from_cli_arg == false
        let (ws_root, from_arg_root) =
            detect_workspace_fallback(None, Some(Path::new("/")), "/Users/tester");
        assert_eq!(ws_root, "/Users/tester");
        assert!(!from_arg_root);

        // 显式传参目录时 from_cli_arg == true
        let (ws_cli, from_arg_cli) =
            detect_workspace_fallback(Some(canon_repo.as_str()), Some(Path::new("/")), "/Users/tester");
        assert_eq!(ws_cli, canon_repo);
        assert!(from_arg_cli);

        // 新窗口参数准备校验
        let (exe, win_root) = open_workspace_window_args(&canon_repo).unwrap();
        assert!(exe.exists());
        assert_eq!(win_root, canon_repo);
        assert!(open_workspace_window_args("/nonexistent/ke/window/path").is_err());

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
