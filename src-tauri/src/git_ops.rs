use crate::env_path::AppEnv;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use tokio::process::Command;
use tauri::State;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileChange {
    pub path: String,
    pub old_path: Option<String>,
    pub status: String,
    pub staged: bool,
    pub additions: Option<u32>,
    pub deletions: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusResult {
    pub is_repo: bool,
    pub branch: String,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub staged: Vec<GitFileChange>,
    pub changes: Vec<GitFileChange>,
    pub total_changes: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffResult {
    pub path: String,
    pub original_text: String,
    pub modified_text: String,
    pub additions: u32,
    pub deletions: u32,
    pub is_binary: bool,
    pub is_new_file: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitInfo {
    pub hash: String,
    pub short_hash: String,
    pub message: String,
    pub author: String,
    pub relative_time: String,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchInfo {
    pub name: String,
    pub is_current: bool,
    pub is_remote: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRefBadge {
    pub name: String,
    pub kind: String,
    pub is_current_head: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitGraphNode {
    pub hash: String,
    pub short_hash: String,
    pub parents: Vec<String>,
    pub refs: Vec<GitRefBadge>,
    pub message: String,
    pub author: String,
    pub author_email: String,
    pub relative_time: String,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitDetail {
    pub hash: String,
    pub short_hash: String,
    pub parents: Vec<String>,
    pub author: String,
    pub author_email: String,
    pub timestamp: i64,
    pub relative_time: String,
    pub subject: String,
    pub body: String,
    pub files: Vec<GitFileChange>,
    pub total_additions: u32,
    pub total_deletions: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCompareResult {
    pub base_ref: String,
    pub head_ref: String,
    pub three_dot: bool,
    pub ahead: u32,
    pub behind: u32,
    pub files: Vec<GitFileChange>,
    pub commits: Vec<GitCommitInfo>,
    pub total_additions: u32,
    pub total_deletions: u32,
}

async fn run_git_with_env(
    env: &AppEnv,
    root: &str,
    args: &[&str],
    extra_env: &[(&str, &str)],
) -> Result<Vec<u8>, String> {
    let git_bin = env
        .resolve_binary("git")
        .unwrap_or_else(|| "git".into());

    let mut cmd = Command::new(git_bin);
    cmd.arg("-C")
        .arg(root)
        .arg("-c")
        .arg("gc.auto=0")
        .arg("--no-optional-locks")
        .args(args)
        .envs(&env.vars);

    for (k, v) in extra_env {
        cmd.env(k, v);
    }

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("执行 git 失败: {}", e))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if err.is_empty() {
            format!("git 命令失败: {:?}", args)
        } else {
            err
        });
    }

    Ok(output.stdout)
}

async fn run_git(env: &AppEnv, root: &str, args: &[&str]) -> Result<Vec<u8>, String> {
    run_git_with_env(env, root, args, &[]).await
}

async fn collect_numstat(env: &AppEnv, root: &str, cached: bool) -> HashMap<String, (u32, u32)> {
    let args: &[&str] = if cached {
        &["diff", "--cached", "--numstat", "-z"]
    } else {
        &["diff", "--numstat", "-z"]
    };
    let Ok(bytes) = run_git(env, root, args).await else {
        return HashMap::new();
    };
    parse_numstat_z(&bytes)
}

fn parse_numstat_z(bytes: &[u8]) -> HashMap<String, (u32, u32)> {
    let mut map = HashMap::new();
    let tokens: Vec<&[u8]> = bytes.split(|&b| b == 0).filter(|s| !s.is_empty()).collect();
    for tok in tokens {
        let line = String::from_utf8_lossy(tok);
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() >= 3 {
            let add = parts[0].parse::<u32>().unwrap_or(0);
            let del = parts[1].parse::<u32>().unwrap_or(0);
            let path = parts[parts.len() - 1].to_string();
            map.insert(path, (add, del));
        }
    }
    map
}

fn map_status_char(c: char) -> &'static str {
    match c {
        'M' => "M",
        'A' => "A",
        'D' => "D",
        'R' => "R",
        'C' => "C",
        'U' => "U",
        _ => "M",
    }
}

pub fn parse_porcelain_v2_z(
    bytes: &[u8],
    staged_stats: &HashMap<String, (u32, u32)>,
    unstaged_stats: &HashMap<String, (u32, u32)>,
) -> GitStatusResult {
    let mut branch = "HEAD".to_string();
    let mut upstream: Option<String> = None;
    let mut ahead = 0u32;
    let mut behind = 0u32;
    let mut staged = Vec::new();
    let mut changes = Vec::new();

    let records: Vec<&[u8]> = bytes.split(|&b| b == 0).collect();
    let mut i = 0;
    while i < records.len() {
        let rec = records[i];
        i += 1;
        if rec.is_empty() {
            continue;
        }
        let line = String::from_utf8_lossy(rec);
        if let Some(rest) = line.strip_prefix("# branch.head ") {
            branch = rest.trim().to_string();
        } else if let Some(rest) = line.strip_prefix("# branch.upstream ") {
            upstream = Some(rest.trim().to_string());
        } else if let Some(rest) = line.strip_prefix("# branch.ab ") {
            for part in rest.split_whitespace() {
                if let Some(a) = part.strip_prefix('+') {
                    ahead = a.parse::<u32>().unwrap_or(0);
                } else if let Some(b) = part.strip_prefix('-') {
                    behind = b.parse::<u32>().unwrap_or(0);
                }
            }
        } else if line.starts_with("1 ") {
            let fields: Vec<&str> = line.splitn(9, ' ').collect();
            if fields.len() == 9 {
                let xy: Vec<char> = fields[1].chars().collect();
                let path = fields[8].to_string();
                if xy.len() == 2 {
                    if xy[0] != '.' {
                        let stats = staged_stats.get(&path).copied();
                        staged.push(GitFileChange {
                            path: path.clone(),
                            old_path: None,
                            status: map_status_char(xy[0]).to_string(),
                            staged: true,
                            additions: stats.map(|s| s.0),
                            deletions: stats.map(|s| s.1),
                        });
                    }
                    if xy[1] != '.' {
                        let stats = unstaged_stats.get(&path).copied();
                        changes.push(GitFileChange {
                            path,
                            old_path: None,
                            status: map_status_char(xy[1]).to_string(),
                            staged: false,
                            additions: stats.map(|s| s.0),
                            deletions: stats.map(|s| s.1),
                        });
                    }
                }
            }
        } else if line.starts_with("2 ") {
            let fields: Vec<&str> = line.splitn(10, ' ').collect();
            let old_path = if i < records.len() {
                let orig = String::from_utf8_lossy(records[i]).into_owned();
                i += 1;
                Some(orig)
            } else {
                None
            };
            if fields.len() == 10 {
                let xy: Vec<char> = fields[1].chars().collect();
                let path = fields[9].to_string();
                if xy.len() == 2 {
                    if xy[0] != '.' {
                        let stats = staged_stats.get(&path).copied();
                        staged.push(GitFileChange {
                            path: path.clone(),
                            old_path: old_path.clone(),
                            status: map_status_char(xy[0]).to_string(),
                            staged: true,
                            additions: stats.map(|s| s.0),
                            deletions: stats.map(|s| s.1),
                        });
                    }
                    if xy[1] != '.' {
                        let stats = unstaged_stats.get(&path).copied();
                        changes.push(GitFileChange {
                            path,
                            old_path,
                            status: map_status_char(xy[1]).to_string(),
                            staged: false,
                            additions: stats.map(|s| s.0),
                            deletions: stats.map(|s| s.1),
                        });
                    }
                }
            }
        } else if line.starts_with("u ") {
            let fields: Vec<&str> = line.splitn(11, ' ').collect();
            if fields.len() == 11 {
                changes.push(GitFileChange {
                    path: fields[10].to_string(),
                    old_path: None,
                    status: "U".to_string(),
                    staged: false,
                    additions: None,
                    deletions: None,
                });
            }
        } else if let Some(path) = line.strip_prefix("? ") {
            changes.push(GitFileChange {
                path: path.to_string(),
                old_path: None,
                status: "?".to_string(),
                staged: false,
                additions: None,
                deletions: None,
            });
        }
    }

    let total_changes = staged.len() + changes.len();
    GitStatusResult {
        is_repo: true,
        branch,
        upstream,
        ahead,
        behind,
        staged,
        changes,
        total_changes,
    }
}

pub async fn git_init_core(env: &AppEnv, root: &str) -> Result<(), String> {
    if run_git(env, root, &["init", "-b", "main"]).await.is_ok() {
        return Ok(());
    }
    run_git(env, root, &["init"]).await?;
    Ok(())
}

#[tauri::command]
pub async fn git_init(env: State<'_, AppEnv>, root: String) -> Result<(), String> {
    git_init_core(&env, &root).await
}

pub async fn git_status_core(env: &AppEnv, root: &str) -> Result<GitStatusResult, String> {
    let status_out = run_git(env, root, &["status", "--porcelain=v2", "--branch", "-uall", "-z"]).await;
    let Ok(bytes) = status_out else {
        return Ok(GitStatusResult {
            is_repo: false,
            branch: "no-git".to_string(),
            upstream: None,
            ahead: 0,
            behind: 0,
            staged: Vec::new(),
            changes: Vec::new(),
            total_changes: 0,
        });
    };

    let (staged_stats, unstaged_stats) = tokio::join!(
        collect_numstat(env, root, true),
        collect_numstat(env, root, false)
    );

    Ok(parse_porcelain_v2_z(&bytes, &staged_stats, &unstaged_stats))
}

#[tauri::command]
pub async fn git_status(env: State<'_, AppEnv>, root: String) -> Result<GitStatusResult, String> {
    git_status_core(&env, &root).await
}

pub async fn git_diff_file_core(
    env: &AppEnv,
    root: &str,
    path: &str,
    staged: Option<bool>,
) -> Result<GitDiffResult, String> {
    let is_staged = staged.unwrap_or(false);
    let head_spec = format!("HEAD:{}", path);
    let head_bytes = run_git(env, root, &["show", &head_spec]).await.ok();

    let modified_bytes = if is_staged {
        let index_spec = format!(":{}", path);
        run_git(env, root, &["show", &index_spec])
            .await
            .unwrap_or_default()
    } else {
        let full_path = Path::new(root).join(path);
        tokio::fs::read(&full_path).await.unwrap_or_default()
    };

    let is_new_file = head_bytes.is_none();
    let orig_bytes = head_bytes.unwrap_or_default();
    let is_binary = orig_bytes.iter().take(8192).any(|&b| b == 0)
        || modified_bytes.iter().take(8192).any(|&b| b == 0);

    let (original_text, modified_text) = if is_binary {
        ("[二进制文件]".to_string(), "[二进制文件]".to_string())
    } else {
        (
            String::from_utf8_lossy(&orig_bytes).into_owned(),
            String::from_utf8_lossy(&modified_bytes).into_owned(),
        )
    };

    let numstat_args: Vec<&str> = if is_staged {
        vec!["diff", "--cached", "--numstat", "--", path]
    } else {
        vec!["diff", "--numstat", "--", path]
    };

    let mut additions = 0u32;
    let mut deletions = 0u32;
    if let Ok(stat_bytes) = run_git(env, root, &numstat_args).await {
        let stat_str = String::from_utf8_lossy(&stat_bytes);
        if let Some(first_line) = stat_str.lines().next() {
            let parts: Vec<&str> = first_line.split('\t').collect();
            if parts.len() >= 2 {
                additions = parts[0].parse::<u32>().unwrap_or(0);
                deletions = parts[1].parse::<u32>().unwrap_or(0);
            }
        }
    }
    if additions == 0 && deletions == 0 && is_new_file && !is_binary {
        additions = modified_text.lines().count() as u32;
    }

    Ok(GitDiffResult {
        path: path.to_string(),
        original_text,
        modified_text,
        additions,
        deletions,
        is_binary,
        is_new_file,
    })
}

#[tauri::command]
pub async fn git_diff_file(
    env: State<'_, AppEnv>,
    root: String,
    path: String,
    staged: Option<bool>,
) -> Result<GitDiffResult, String> {
    git_diff_file_core(&env, &root, &path, staged).await
}

pub async fn git_stage_core(env: &AppEnv, root: &str, paths: &[String]) -> Result<(), String> {
    if paths.is_empty() {
        run_git(env, root, &["add", "-A"]).await?;
    } else {
        let mut args = vec!["add", "--"];
        let refs: Vec<&str> = paths.iter().map(String::as_str).collect();
        args.extend(refs);
        run_git(env, root, &args).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn git_stage(
    env: State<'_, AppEnv>,
    root: String,
    paths: Vec<String>,
) -> Result<(), String> {
    git_stage_core(&env, &root, &paths).await
}

pub async fn git_unstage_core(env: &AppEnv, root: &str, paths: &[String]) -> Result<(), String> {
    let has_head = run_git(env, root, &["rev-parse", "--verify", "HEAD"])
        .await
        .is_ok();
    if has_head {
        if paths.is_empty() {
            run_git(env, root, &["reset", "HEAD"]).await?;
        } else {
            let mut args = vec!["reset", "HEAD", "--"];
            let refs: Vec<&str> = paths.iter().map(String::as_str).collect();
            args.extend(refs);
            run_git(env, root, &args).await?;
        }
    } else if paths.is_empty() {
        run_git(env, root, &["rm", "-r", "--cached", "."]).await?;
    } else {
        let mut args = vec!["rm", "--cached", "--"];
        let refs: Vec<&str> = paths.iter().map(String::as_str).collect();
        args.extend(refs);
        run_git(env, root, &args).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn git_unstage(
    env: State<'_, AppEnv>,
    root: String,
    paths: Vec<String>,
) -> Result<(), String> {
    git_unstage_core(&env, &root, &paths).await
}

#[tauri::command]
pub async fn git_discard(
    env: State<'_, AppEnv>,
    root: String,
    paths: Vec<String>,
) -> Result<(), String> {
    for p in paths {
        let tracked = run_git(&env, &root, &["ls-files", "--error-unmatch", "--", &p])
            .await
            .is_ok();
        if tracked {
            run_git(&env, &root, &["checkout", "--", &p]).await?;
        } else {
            let full = Path::new(&root).join(&p);
            if full.is_dir() {
                let _ = tokio::fs::remove_dir_all(&full).await;
            } else if full.exists() {
                let _ = tokio::fs::remove_file(&full).await;
            }
        }
    }
    Ok(())
}

pub async fn git_commit_core(
    env: &AppEnv,
    root: &str,
    message: &str,
) -> Result<GitCommitInfo, String> {
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return Err("提交说明不能为空".to_string());
    }
    run_git(env, root, &["commit", "-m", trimmed]).await?;
    let mut logs = git_log_core(env, root, Some(1)).await?;
    logs.pop()
        .ok_or_else(|| "提交成功但读取最新提交信息失败".to_string())
}

#[tauri::command]
pub async fn git_commit(
    env: State<'_, AppEnv>,
    root: String,
    message: String,
) -> Result<GitCommitInfo, String> {
    git_commit_core(&env, &root, &message).await
}

pub async fn git_log_core(
    env: &AppEnv,
    root: &str,
    limit: Option<u32>,
) -> Result<Vec<GitCommitInfo>, String> {
    let lim = limit.unwrap_or(30).to_string();
    let bytes = run_git(
        env,
        root,
        &[
            "log",
            "-n",
            &lim,
            "--format=%H%x1f%h%x1f%s%x1f%an%x1f%ar%x1f%at%x1e",
        ],
    )
    .await
    .unwrap_or_default();

    let text = String::from_utf8_lossy(&bytes);
    let mut list = Vec::new();
    for rec in text.split('\x1e') {
        let rec = rec.trim();
        if rec.is_empty() {
            continue;
        }
        let fields: Vec<&str> = rec.split('\x1f').collect();
        if fields.len() >= 6 {
            list.push(GitCommitInfo {
                hash: fields[0].to_string(),
                short_hash: fields[1].to_string(),
                message: fields[2].to_string(),
                author: fields[3].to_string(),
                relative_time: fields[4].to_string(),
                timestamp: fields[5].parse::<i64>().unwrap_or(0) * 1000,
            });
        }
    }
    Ok(list)
}

#[tauri::command]
pub async fn git_log(
    env: State<'_, AppEnv>,
    root: String,
    limit: Option<u32>,
) -> Result<Vec<GitCommitInfo>, String> {
    git_log_core(&env, &root, limit).await
}

pub async fn git_branches_core(env: &AppEnv, root: &str) -> Result<Vec<GitBranchInfo>, String> {
    let bytes = run_git(
        env,
        root,
        &["branch", "-a", "--format=%(HEAD)\t%(refname)\t%(refname:short)"],
    )
    .await
    .unwrap_or_default();

    let text = String::from_utf8_lossy(&bytes);
    let mut branches = Vec::new();
    for line in text.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() >= 3 {
            let head_col = parts[0].trim();
            let refname = parts[1].trim();
            let short = parts[2].trim().to_string();
            if short.is_empty() || refname.ends_with("/HEAD") || short.ends_with("/HEAD") {
                continue;
            }
            branches.push(GitBranchInfo {
                is_current: head_col == "*",
                is_remote: refname.starts_with("refs/remotes/"),
                name: short,
            });
        }
    }
    if branches.is_empty() {
        if let Ok(head_bytes) = run_git(env, root, &["symbolic-ref", "--short", "HEAD"]).await {
            let name = String::from_utf8_lossy(&head_bytes).trim().to_string();
            if !name.is_empty() {
                branches.push(GitBranchInfo {
                    name,
                    is_current: true,
                    is_remote: false,
                });
            }
        }
    }
    Ok(branches)
}

#[tauri::command]
pub async fn git_branches(
    env: State<'_, AppEnv>,
    root: String,
) -> Result<Vec<GitBranchInfo>, String> {
    git_branches_core(&env, &root).await
}

#[tauri::command]
pub async fn git_checkout(
    env: State<'_, AppEnv>,
    root: String,
    branch: String,
    create: Option<bool>,
) -> Result<(), String> {
    if create.unwrap_or(false) {
        run_git(&env, &root, &["checkout", "-b", &branch]).await?;
    } else {
        run_git(&env, &root, &["checkout", &branch]).await?;
    }
    Ok(())
}

pub async fn git_fetch_core(env: &AppEnv, root: &str) -> Result<(), String> {
    let remotes_bytes = run_git(env, root, &["remote"]).await?;
    let remotes_str = String::from_utf8_lossy(&remotes_bytes);
    if remotes_str.trim().is_empty() {
        return Err("当前仓库尚未配置远端仓库 (remote)".to_string());
    }
    run_git_with_env(
        env,
        root,
        &["fetch", "--all", "--prune"],
        &[("GIT_TERMINAL_PROMPT", "0")],
    )
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn git_fetch(env: State<'_, AppEnv>, root: String) -> Result<(), String> {
    git_fetch_core(&env, &root).await
}

fn parse_ref_badges(raw_refs: &str, remote_branches: &HashSet<String>) -> Vec<GitRefBadge> {
    let mut badges = Vec::new();
    for item_raw in raw_refs.split(", ") {
        let item = item_raw.trim();
        if item.is_empty() || item.ends_with("/HEAD") {
            continue;
        }
        if let Some(target) = item.strip_prefix("HEAD -> ") {
            let clean = target.trim().to_string();
            badges.push(GitRefBadge {
                name: clean,
                kind: "head".to_string(),
                is_current_head: Some(true),
            });
        } else if item == "HEAD" {
            badges.push(GitRefBadge {
                name: "HEAD".to_string(),
                kind: "head".to_string(),
                is_current_head: Some(true),
            });
        } else if let Some(tag_name) = item.strip_prefix("tag: ") {
            badges.push(GitRefBadge {
                name: tag_name.trim().to_string(),
                kind: "tag".to_string(),
                is_current_head: None,
            });
        } else if remote_branches.contains(item) {
            badges.push(GitRefBadge {
                name: item.to_string(),
                kind: "remote".to_string(),
                is_current_head: None,
            });
        } else {
            badges.push(GitRefBadge {
                name: item.to_string(),
                kind: "local".to_string(),
                is_current_head: None,
            });
        }
    }
    badges
}

pub async fn git_graph_core(
    env: &AppEnv,
    root: &str,
    limit: Option<u32>,
    all: Option<bool>,
) -> Result<Vec<GitGraphNode>, String> {
    let lim = limit.unwrap_or(150).to_string();
    let include_all = all.unwrap_or(true);

    let remote_bytes = run_git(env, root, &["branch", "-r", "--format=%(refname:short)"])
        .await
        .unwrap_or_default();
    let remote_branches: HashSet<String> = String::from_utf8_lossy(&remote_bytes)
        .lines()
        .map(str::trim)
        .filter(|s| !s.is_empty() && !s.ends_with("/HEAD"))
        .map(ToString::to_string)
        .collect();

    let mut args = vec!["log", "--topo-order", "-n", &lim];
    if include_all {
        args.push("--all");
    }
    args.push("--format=%H%x1f%h%x1f%P%x1f%D%x1f%s%x1f%an%x1f%ae%x1f%ar%x1f%at%x1e");

    let Ok(bytes) = run_git(env, root, &args).await else {
        return Ok(Vec::new());
    };

    let text = String::from_utf8_lossy(&bytes);
    let mut nodes = Vec::new();
    for rec in text.split('\x1e') {
        let rec = rec.trim();
        if rec.is_empty() {
            continue;
        }
        let fields: Vec<&str> = rec.split('\x1f').collect();
        if fields.len() >= 9 {
            let parents = fields[2]
                .split_whitespace()
                .filter(|s| !s.is_empty())
                .map(ToString::to_string)
                .collect();
            let refs = parse_ref_badges(fields[3], &remote_branches);
            nodes.push(GitGraphNode {
                hash: fields[0].to_string(),
                short_hash: fields[1].to_string(),
                parents,
                refs,
                message: fields[4].to_string(),
                author: fields[5].to_string(),
                author_email: fields[6].to_string(),
                relative_time: fields[7].to_string(),
                timestamp: fields[8].parse::<i64>().unwrap_or(0) * 1000,
            });
        }
    }
    Ok(nodes)
}

#[tauri::command]
pub async fn git_graph(
    env: State<'_, AppEnv>,
    root: String,
    limit: Option<u32>,
    all: Option<bool>,
) -> Result<Vec<GitGraphNode>, String> {
    git_graph_core(&env, &root, limit, all).await
}

fn parse_numstat_m_z(bytes: &[u8]) -> HashMap<String, (u32, u32)> {
    let mut map = HashMap::new();
    let tokens: Vec<&[u8]> = bytes.split(|&b| b == 0).collect();
    let mut i = 0;
    while i < tokens.len() {
        let tok = tokens[i];
        i += 1;
        if tok.is_empty() {
            continue;
        }
        let line = String::from_utf8_lossy(tok);
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() >= 3 {
            let add = parts[0].parse::<u32>().unwrap_or(0);
            let del = parts[1].parse::<u32>().unwrap_or(0);
            if parts[2].is_empty() {
                // -M -z 重命名格式: "add\tdel\t\0oldPath\0newPath\0"
                if i + 1 < tokens.len() {
                    let _old_path = String::from_utf8_lossy(tokens[i]);
                    let new_path = String::from_utf8_lossy(tokens[i + 1]).into_owned();
                    i += 2;
                    if !new_path.is_empty() {
                        map.insert(new_path, (add, del));
                    }
                }
            } else {
                map.insert(parts[2].to_string(), (add, del));
            }
        }
    }
    map
}

fn parse_name_status_m_z(
    name_status_bytes: &[u8],
    numstat_bytes: &[u8],
) -> (Vec<GitFileChange>, u32, u32) {
    let stats = parse_numstat_m_z(numstat_bytes);
    let tokens: Vec<&[u8]> = name_status_bytes
        .split(|&b| b == 0)
        .filter(|s| !s.is_empty())
        .collect();

    let mut files = Vec::new();
    let mut total_add = 0u32;
    let mut total_del = 0u32;
    let mut i = 0;

    while i < tokens.len() {
        let status_raw = String::from_utf8_lossy(tokens[i]).into_owned();
        i += 1;
        let status_ch = status_raw.chars().next().unwrap_or('M');
        if matches!(status_ch, 'R' | 'C') {
            if i + 1 >= tokens.len() {
                break;
            }
            let old_path = String::from_utf8_lossy(tokens[i]).into_owned();
            let new_path = String::from_utf8_lossy(tokens[i + 1]).into_owned();
            i += 2;
            let (add, del) = stats.get(&new_path).copied().unwrap_or((0, 0));
            total_add += add;
            total_del += del;
            files.push(GitFileChange {
                path: new_path,
                old_path: Some(old_path),
                status: status_ch.to_string(),
                staged: false,
                additions: Some(add),
                deletions: Some(del),
            });
        } else {
            if i >= tokens.len() {
                break;
            }
            let path = String::from_utf8_lossy(tokens[i]).into_owned();
            i += 1;
            let (add, del) = stats.get(&path).copied().unwrap_or((0, 0));
            total_add += add;
            total_del += del;
            files.push(GitFileChange {
                path,
                old_path: None,
                status: map_status_char(status_ch).to_string(),
                staged: false,
                additions: Some(add),
                deletions: Some(del),
            });
        }
    }

    (files, total_add, total_del)
}

pub async fn git_commit_detail_core(
    env: &AppEnv,
    root: &str,
    commit: &str,
) -> Result<GitCommitDetail, String> {
    let show_bytes = run_git(
        env,
        root,
        &[
            "show",
            "-s",
            "--format=%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%ar%x1f%s%x1f%b",
            commit,
        ],
    )
    .await?;

    let show_text = String::from_utf8_lossy(&show_bytes);
    let fields: Vec<&str> = show_text.splitn(9, '\x1f').collect();
    if fields.len() < 9 {
        return Err(format!("解析提交详情失败: {}", commit));
    }

    let hash = fields[0].trim().to_string();
    let short_hash = fields[1].trim().to_string();
    let parents = fields[2]
        .split_whitespace()
        .filter(|s| !s.is_empty())
        .map(ToString::to_string)
        .collect();
    let author = fields[3].trim().to_string();
    let author_email = fields[4].trim().to_string();
    let timestamp = fields[5].trim().parse::<i64>().unwrap_or(0) * 1000;
    let relative_time = fields[6].trim().to_string();
    let subject = fields[7].trim().to_string();
    let body = fields[8].trim().to_string();

    let ns_args = [
        "diff-tree",
        "--root",
        "-m",
        "--first-parent",
        "--no-commit-id",
        "-r",
        "--name-status",
        "-M",
        "-z",
        &hash,
    ];
    let num_args = [
        "diff-tree",
        "--root",
        "-m",
        "--first-parent",
        "--no-commit-id",
        "-r",
        "--numstat",
        "-M",
        "-z",
        &hash,
    ];
    let (ns_bytes, num_bytes) = tokio::join!(
        run_git(env, root, &ns_args),
        run_git(env, root, &num_args),
    );

    let (files, total_additions, total_deletions) = parse_name_status_m_z(
        &ns_bytes.unwrap_or_default(),
        &num_bytes.unwrap_or_default(),
    );

    Ok(GitCommitDetail {
        hash,
        short_hash,
        parents,
        author,
        author_email,
        timestamp,
        relative_time,
        subject,
        body,
        files,
        total_additions,
        total_deletions,
    })
}

#[tauri::command]
pub async fn git_commit_detail(
    env: State<'_, AppEnv>,
    root: String,
    commit: String,
) -> Result<GitCommitDetail, String> {
    git_commit_detail_core(&env, &root, &commit).await
}

fn build_diff_result(
    path: String,
    orig_bytes: Option<Vec<u8>>,
    mod_bytes: Option<Vec<u8>>,
    stats: Option<(u32, u32)>,
) -> GitDiffResult {
    let is_new_file = orig_bytes.is_none();
    let orig = orig_bytes.unwrap_or_default();
    let modified = mod_bytes.unwrap_or_default();
    let is_binary = orig.iter().take(8192).any(|&b| b == 0)
        || modified.iter().take(8192).any(|&b| b == 0);

    let (original_text, modified_text) = if is_binary {
        ("[二进制文件]".to_string(), "[二进制文件]".to_string())
    } else {
        (
            String::from_utf8_lossy(&orig).into_owned(),
            String::from_utf8_lossy(&modified).into_owned(),
        )
    };

    let (mut additions, deletions) = stats.unwrap_or((0, 0));
    if additions == 0 && deletions == 0 && is_new_file && !is_binary {
        additions = modified_text.lines().count() as u32;
    }

    GitDiffResult {
        path,
        original_text,
        modified_text,
        additions,
        deletions,
        is_binary,
        is_new_file,
    }
}

pub async fn git_diff_commit_file_core(
    env: &AppEnv,
    root: &str,
    commit: &str,
    path: &str,
    old_path: Option<&str>,
) -> Result<GitDiffResult, String> {
    let parent_ref = format!("{}^1", commit);
    let has_parent = run_git(env, root, &["rev-parse", "--verify", &parent_ref])
        .await
        .is_ok();

    let orig_path = old_path.filter(|s| !s.is_empty()).unwrap_or(path);
    let orig_bytes = if has_parent {
        let spec = format!("{}:{}", parent_ref, orig_path);
        run_git(env, root, &["show", &spec]).await.ok()
    } else {
        None
    };

    let mod_spec = format!("{}:{}", commit, path);
    let mod_bytes = run_git(env, root, &["show", &mod_spec]).await.ok();

    let num_bytes = run_git(
        env,
        root,
        &[
            "diff-tree",
            "--root",
            "-m",
            "--first-parent",
            "--no-commit-id",
            "-r",
            "--numstat",
            "-M",
            "-z",
            commit,
            "--",
            path,
        ],
    )
    .await
    .unwrap_or_default();
    let stats_map = parse_numstat_m_z(&num_bytes);
    let stats = stats_map.get(path).copied().or_else(|| stats_map.values().next().copied());

    Ok(build_diff_result(path.to_string(), orig_bytes, mod_bytes, stats))
}

#[tauri::command]
pub async fn git_diff_commit_file(
    env: State<'_, AppEnv>,
    root: String,
    commit: String,
    path: String,
    old_path: Option<String>,
) -> Result<GitDiffResult, String> {
    git_diff_commit_file_core(&env, &root, &commit, &path, old_path.as_deref()).await
}

async fn parse_commits_range(env: &AppEnv, root: &str, range: &str) -> Vec<GitCommitInfo> {
    let bytes = run_git(
        env,
        root,
        &[
            "log",
            "-n",
            "100",
            "--format=%H%x1f%h%x1f%s%x1f%an%x1f%ar%x1f%at%x1e",
            range,
        ],
    )
    .await
    .unwrap_or_default();

    let text = String::from_utf8_lossy(&bytes);
    let mut list = Vec::new();
    for rec in text.split('\x1e') {
        let rec = rec.trim();
        if rec.is_empty() {
            continue;
        }
        let fields: Vec<&str> = rec.split('\x1f').collect();
        if fields.len() >= 6 {
            list.push(GitCommitInfo {
                hash: fields[0].to_string(),
                short_hash: fields[1].to_string(),
                message: fields[2].to_string(),
                author: fields[3].to_string(),
                relative_time: fields[4].to_string(),
                timestamp: fields[5].parse::<i64>().unwrap_or(0) * 1000,
            });
        }
    }
    list
}

pub async fn git_compare_refs_core(
    env: &AppEnv,
    root: &str,
    base_ref: &str,
    head_ref: &str,
    three_dot: Option<bool>,
) -> Result<GitCompareResult, String> {
    let is_three_dot = three_dot.unwrap_or(true);

    if head_ref == "WORKTREE" {
        let ns_args = ["diff", "--name-status", "-M", "-z", base_ref];
        let num_args = ["diff", "--numstat", "-M", "-z", base_ref];
        let (ns_bytes, num_bytes, status_res) = tokio::join!(
            run_git(env, root, &ns_args),
            run_git(env, root, &num_args),
            git_status_core(env, root),
        );

        let (mut files, mut total_additions, total_deletions) = parse_name_status_m_z(
            &ns_bytes.unwrap_or_default(),
            &num_bytes.unwrap_or_default(),
        );

        if let Ok(st) = status_res {
            let existing: HashSet<String> = files.iter().map(|f| f.path.clone()).collect();
            for ch in st.changes {
                if ch.status == "?" && !existing.contains(&ch.path) {
                    let full = Path::new(root).join(&ch.path);
                    let line_count = tokio::fs::read(&full)
                        .await
                        .ok()
                        .filter(|b| !b.iter().take(8192).any(|&byte| byte == 0))
                        .map(|b| String::from_utf8_lossy(&b).lines().count() as u32)
                        .unwrap_or(0);
                    total_additions += line_count;
                    files.push(GitFileChange {
                        path: ch.path,
                        old_path: None,
                        status: "?".to_string(),
                        staged: false,
                        additions: Some(line_count),
                        deletions: Some(0),
                    });
                }
            }
        }

        let range = format!("{}..HEAD", base_ref);
        let commits = parse_commits_range(env, root, &range).await;
        let ahead = run_git(env, root, &["rev-list", "--count", &range])
            .await
            .ok()
            .and_then(|b| String::from_utf8_lossy(&b).trim().parse::<u32>().ok())
            .unwrap_or(commits.len() as u32);
        let behind_range = format!("HEAD..{}", base_ref);
        let behind = run_git(env, root, &["rev-list", "--count", &behind_range])
            .await
            .ok()
            .and_then(|b| String::from_utf8_lossy(&b).trim().parse::<u32>().ok())
            .unwrap_or(0);

        return Ok(GitCompareResult {
            base_ref: base_ref.to_string(),
            head_ref: head_ref.to_string(),
            three_dot: is_three_dot,
            ahead,
            behind,
            files,
            commits,
            total_additions,
            total_deletions,
        });
    }

    let diff_range = if is_three_dot {
        format!("{}...{}", base_ref, head_ref)
    } else {
        format!("{}..{}", base_ref, head_ref)
    };
    let commit_range = format!("{}..{}", base_ref, head_ref);
    let lr_range = format!("{}...{}", base_ref, head_ref);

    let ns_args = ["diff", "--name-status", "-M", "-z", &diff_range];
    let num_args = ["diff", "--numstat", "-M", "-z", &diff_range];
    let lr_args = ["rev-list", "--left-right", "--count", &lr_range];
    let (ns_bytes, num_bytes, commits, lr_bytes) = tokio::join!(
        run_git(env, root, &ns_args),
        run_git(env, root, &num_args),
        parse_commits_range(env, root, &commit_range),
        run_git(env, root, &lr_args),
    );

    let (files, total_additions, total_deletions) = parse_name_status_m_z(
        &ns_bytes.unwrap_or_default(),
        &num_bytes.unwrap_or_default(),
    );

    let mut behind = 0u32;
    let mut ahead = 0u32;
    if let Ok(lr) = lr_bytes {
        let s = String::from_utf8_lossy(&lr);
        let parts: Vec<&str> = s.split_whitespace().collect();
        if parts.len() >= 2 {
            behind = parts[0].parse::<u32>().unwrap_or(0);
            ahead = parts[1].parse::<u32>().unwrap_or(0);
        }
    }

    Ok(GitCompareResult {
        base_ref: base_ref.to_string(),
        head_ref: head_ref.to_string(),
        three_dot: is_three_dot,
        ahead,
        behind,
        files,
        commits,
        total_additions,
        total_deletions,
    })
}

#[tauri::command]
pub async fn git_compare_refs(
    env: State<'_, AppEnv>,
    root: String,
    base_ref: String,
    head_ref: String,
    three_dot: Option<bool>,
) -> Result<GitCompareResult, String> {
    git_compare_refs_core(&env, &root, &base_ref, &head_ref, three_dot).await
}

pub async fn git_diff_refs_file_core(
    env: &AppEnv,
    root: &str,
    base_ref: &str,
    head_ref: &str,
    path: &str,
    old_path: Option<&str>,
    three_dot: Option<bool>,
) -> Result<GitDiffResult, String> {
    let is_three_dot = three_dot.unwrap_or(true);
    let effective_base = if head_ref != "WORKTREE" && is_three_dot {
        match run_git(env, root, &["merge-base", base_ref, head_ref]).await {
            Ok(bytes) => {
                let mb = String::from_utf8_lossy(&bytes).trim().to_string();
                if mb.is_empty() {
                    base_ref.to_string()
                } else {
                    mb
                }
            }
            Err(_) => base_ref.to_string(),
        }
    } else {
        base_ref.to_string()
    };

    let orig_path = old_path.filter(|s| !s.is_empty()).unwrap_or(path);
    let orig_spec = format!("{}:{}", effective_base, orig_path);
    let orig_bytes = run_git(env, root, &["show", &orig_spec]).await.ok();

    let (mod_bytes, num_bytes) = if head_ref == "WORKTREE" {
        let full = Path::new(root).join(path);
        let mod_b = tokio::fs::read(&full).await.ok();
        let num_b = run_git(
            env,
            root,
            &["diff", "--numstat", "-M", "-z", &effective_base, "--", path],
        )
        .await
        .unwrap_or_default();
        (mod_b, num_b)
    } else {
        let mod_spec = format!("{}:{}", head_ref, path);
        let mod_b = run_git(env, root, &["show", &mod_spec]).await.ok();
        let num_b = run_git(
            env,
            root,
            &[
                "diff",
                "--numstat",
                "-M",
                "-z",
                &effective_base,
                head_ref,
                "--",
                path,
            ],
        )
        .await
        .unwrap_or_default();
        (mod_b, num_b)
    };

    let stats_map = parse_numstat_m_z(&num_bytes);
    let stats = stats_map.get(path).copied().or_else(|| stats_map.values().next().copied());

    Ok(build_diff_result(path.to_string(), orig_bytes, mod_bytes, stats))
}

#[tauri::command]
pub async fn git_diff_refs_file(
    env: State<'_, AppEnv>,
    root: String,
    base_ref: String,
    head_ref: String,
    path: String,
    old_path: Option<String>,
    three_dot: Option<bool>,
) -> Result<GitDiffResult, String> {
    git_diff_refs_file_core(
        &env,
        &root,
        &base_ref,
        &head_ref,
        &path,
        old_path.as_deref(),
        three_dot,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_porcelain_v2_z() {
        let raw = b"# branch.head feat/idempotent-refund\0# branch.upstream origin/feat/idempotent-refund\0# branch.ab +2 -1\01 .M N... 100644 100644 100644 a b src/core/refund.service.ts\01 M. N... 100644 100644 100644 a b src/core/idempotency.ts\0? tests/new.test.ts\0";
        let mut staged_stats = HashMap::new();
        staged_stats.insert("src/core/idempotency.ts".to_string(), (18, 0));
        let mut unstaged_stats = HashMap::new();
        unstaged_stats.insert("src/core/refund.service.ts".to_string(), (22, 6));

        let res = parse_porcelain_v2_z(raw, &staged_stats, &unstaged_stats);
        assert_eq!(res.branch, "feat/idempotent-refund");
        assert_eq!(res.ahead, 2);
        assert_eq!(res.behind, 1);
        assert_eq!(res.staged.len(), 1);
        assert_eq!(res.staged[0].path, "src/core/idempotency.ts");
        assert_eq!(res.staged[0].additions, Some(18));
        assert_eq!(res.changes.len(), 2);
        assert_eq!(res.changes[0].path, "src/core/refund.service.ts");
        assert_eq!(res.changes[0].deletions, Some(6));
        assert_eq!(res.changes[1].status, "?");
    }

    #[tokio::test]
    async fn test_git_temp_repo_lifecycle() {
        let tmp = std::env::temp_dir().join(format!(
            "ke_git_repo_test_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&tmp).unwrap();
        let root = tmp.to_string_lossy().into_owned();
        let env = AppEnv::init();

        run_git(&env, &root, &["init", "-b", "main"]).await.unwrap();
        run_git(&env, &root, &["config", "user.email", "tester@klot.dev"])
            .await
            .unwrap();
        run_git(&env, &root, &["config", "user.name", "Klot Tester"])
            .await
            .unwrap();

        std::fs::write(tmp.join("hello.ts"), "export const v = 1;\n").unwrap();
        git_stage_core(&env, &root, &[String::from("hello.ts")])
            .await
            .unwrap();
        let first_commit = git_commit_core(&env, &root, "chore: initial commit")
            .await
            .unwrap();
        assert_eq!(first_commit.message, "chore: initial commit");

        // 修改已跟踪文件 + 新建未跟踪文件
        std::fs::write(tmp.join("hello.ts"), "export const v = 2;\nexport const w = 3;\n")
            .unwrap();
        std::fs::write(tmp.join("extra.ts"), "export const extra = true;\n").unwrap();

        let status = git_status_core(&env, &root).await.unwrap();
        assert!(status.is_repo);
        assert_eq!(status.branch, "main");
        assert_eq!(status.total_changes, 2);

        let diff = git_diff_file_core(&env, &root, "hello.ts", Some(false))
            .await
            .unwrap();
        assert!(diff.original_text.contains("v = 1"));
        assert!(diff.modified_text.contains("w = 3"));
        assert!(diff.additions >= 1);

        git_stage_core(&env, &root, &[]).await.unwrap();
        let staged_status = git_status_core(&env, &root).await.unwrap();
        assert_eq!(staged_status.staged.len(), 2);

        let second_commit = git_commit_core(&env, &root, "feat: update hello")
            .await
            .unwrap();
        assert_eq!(second_commit.message, "feat: update hello");

        let logs = git_log_core(&env, &root, Some(10)).await.unwrap();
        assert_eq!(logs.len(), 2);
        assert_eq!(logs[0].message, "feat: update hello");

        let branches = git_branches_core(&env, &root).await.unwrap();
        assert!(branches.iter().any(|b| b.name == "main" && b.is_current));

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn test_git_unborn_repo_lifecycle() {
        let tmp = std::env::temp_dir().join(format!(
            "ke_git_unborn_test_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(tmp.join("src/nested")).unwrap();
        let root = tmp.to_string_lossy().into_owned();
        let env = AppEnv::init();

        git_init_core(&env, &root).await.unwrap();
        std::fs::write(tmp.join("src/nested/app.ts"), "export const x = 1;\nexport const y = 2;\n")
            .unwrap();
        std::fs::write(tmp.join("README.md"), "# Demo\n").unwrap();

        let status = git_status_core(&env, &root).await.unwrap();
        assert!(status.is_repo);
        assert_eq!(status.branch, "main");
        assert!(status.changes.iter().any(|c| c.path == "src/nested/app.ts"));
        assert!(!status.changes.iter().any(|c| c.path == "src/"));

        let branches = git_branches_core(&env, &root).await.unwrap();
        assert_eq!(branches.len(), 1);
        assert_eq!(branches[0].name, "main");
        assert!(branches[0].is_current);

        let diff = git_diff_file_core(&env, &root, "src/nested/app.ts", Some(false))
            .await
            .unwrap();
        assert!(diff.is_new_file);
        assert_eq!(diff.additions, 2);

        git_stage_core(&env, &root, &[String::from("src/nested/app.ts")])
            .await
            .unwrap();
        let after_stage = git_status_core(&env, &root).await.unwrap();
        assert_eq!(after_stage.staged.len(), 1);

        git_unstage_core(&env, &root, &[String::from("src/nested/app.ts")])
            .await
            .unwrap();
        let after_unstage_one = git_status_core(&env, &root).await.unwrap();
        assert_eq!(after_unstage_one.staged.len(), 0);

        git_stage_core(&env, &root, &[]).await.unwrap();
        git_unstage_core(&env, &root, &[]).await.unwrap();
        let after_unstage_all = git_status_core(&env, &root).await.unwrap();
        assert_eq!(after_unstage_all.staged.len(), 0);
        assert_eq!(after_unstage_all.changes.len(), 2);

        let logs = git_log_core(&env, &root, Some(10)).await.unwrap();
        assert!(logs.is_empty());

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn test_git_graph_commit_detail_and_compare_refs() {
        let tmp = std::env::temp_dir().join(format!(
            "ke_git_graph_test_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&tmp).unwrap();
        let root = tmp.to_string_lossy().into_owned();
        let env = AppEnv::init();

        run_git(&env, &root, &["init", "-b", "main"]).await.unwrap();
        run_git(&env, &root, &["config", "user.email", "tester@klot.dev"])
            .await
            .unwrap();
        run_git(&env, &root, &["config", "user.name", "Klot Tester"])
            .await
            .unwrap();

        // 无 remote 时 git_fetch_core 应返回明确错误
        let fetch_err = git_fetch_core(&env, &root).await.unwrap_err();
        assert!(fetch_err.contains("尚未配置远端仓库"));

        // 根提交 c0
        std::fs::write(tmp.join("base.ts"), "export const a = 1;\n").unwrap();
        git_stage_core(&env, &root, &[]).await.unwrap();
        let c0 = git_commit_core(&env, &root, "chore: root").await.unwrap();
        run_git(&env, &root, &["tag", "v1.0.0"]).await.unwrap();

        // 分叉 feat/x 提交 c1
        run_git(&env, &root, &["checkout", "-b", "feat/x"]).await.unwrap();
        std::fs::write(tmp.join("feat.ts"), "export const feat = true;\n").unwrap();
        git_stage_core(&env, &root, &[]).await.unwrap();
        let c1 = git_commit_core(&env, &root, "feat: add feat.ts").await.unwrap();

        // 切回 main 提交 c2，并设置非 origin 远端引用 refs/remotes/upstream/main
        run_git(&env, &root, &["checkout", "main"]).await.unwrap();
        std::fs::write(tmp.join("base.ts"), "export const a = 2;\nexport const b = 3;\n")
            .unwrap();
        git_stage_core(&env, &root, &[]).await.unwrap();
        let c2 = git_commit_core(&env, &root, "fix: update base").await.unwrap();
        run_git(&env, &root, &["update-ref", "refs/remotes/upstream/main", &c2.hash])
            .await
            .unwrap();

        // 切回 feat/x 合并 main 生成 merge commit c3
        run_git(&env, &root, &["checkout", "feat/x"]).await.unwrap();
        run_git(&env, &root, &["merge", "--no-ff", "main", "-m", "merge main into feat/x"])
            .await
            .unwrap();

        // 验证非 origin 远端分支识别
        let branches = git_branches_core(&env, &root).await.unwrap();
        assert!(branches
            .iter()
            .any(|b| b.name == "upstream/main" && b.is_remote));
        assert!(branches
            .iter()
            .any(|b| b.name == "feat/x" && b.is_current && !b.is_remote));

        // 验证 git_graph_core 拓扑与 RefBadge
        let graph = git_graph_core(&env, &root, Some(50), Some(true)).await.unwrap();
        assert_eq!(graph.len(), 4);
        assert_eq!(graph[0].parents.len(), 2);
        assert!(graph[0]
            .refs
            .iter()
            .any(|r| r.kind == "head" && r.name == "feat/x"));
        assert!(graph
            .iter()
            .any(|n| n.hash == c2.hash && n.refs.iter().any(|r| r.kind == "remote" && r.name == "upstream/main")));
        assert!(graph
            .iter()
            .any(|n| n.hash == c0.hash && n.refs.iter().any(|r| r.kind == "tag" && r.name == "v1.0.0")));

        // 验证根提交详情与 Diff (originalText 为空)
        let root_detail = git_commit_detail_core(&env, &root, &c0.hash).await.unwrap();
        assert_eq!(root_detail.files.len(), 1);
        assert_eq!(root_detail.files[0].path, "base.ts");
        let root_diff = git_diff_commit_file_core(&env, &root, &c0.hash, "base.ts", None)
            .await
            .unwrap();
        assert_eq!(root_diff.original_text, "");
        assert!(root_diff.modified_text.contains("a = 1"));

        // 验证普通提交详情与 Diff
        let c1_detail = git_commit_detail_core(&env, &root, &c1.hash).await.unwrap();
        assert_eq!(c1_detail.subject, "feat: add feat.ts");
        assert_eq!(c1_detail.files[0].path, "feat.ts");
        let c2_diff = git_diff_commit_file_core(&env, &root, &c2.hash, "base.ts", None)
            .await
            .unwrap();
        assert!(c2_diff.original_text.contains("a = 1"));
        assert!(c2_diff.modified_text.contains("a = 2"));

        // 验证分支对比 (upstream/main vs feat/x)
        let cmp = git_compare_refs_core(&env, &root, "upstream/main", "feat/x", Some(true))
            .await
            .unwrap();
        assert!(cmp.ahead >= 2);
        assert!(cmp.files.iter().any(|f| f.path == "feat.ts"));

        let cmp_diff =
            git_diff_refs_file_core(&env, &root, "upstream/main", "feat/x", "feat.ts", None, Some(true))
                .await
                .unwrap();
        assert!(cmp_diff.modified_text.contains("feat = true"));

        // 验证 WORKTREE 对比
        std::fs::write(tmp.join("dirty.ts"), "export const dirty = 1;\n").unwrap();
        let wt_cmp = git_compare_refs_core(&env, &root, "main", "WORKTREE", Some(true))
            .await
            .unwrap();
        assert!(wt_cmp.files.iter().any(|f| f.path == "dirty.ts"));
        let wt_diff =
            git_diff_refs_file_core(&env, &root, "main", "WORKTREE", "dirty.ts", None, Some(true))
                .await
                .unwrap();
        assert!(wt_diff.modified_text.contains("dirty = 1"));

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
