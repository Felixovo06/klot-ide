use grep_matcher::Matcher;
use grep_regex::RegexMatcherBuilder;
use grep_searcher::{BinaryDetection, SearcherBuilder, Sink, SinkMatch};
use ignore::WalkBuilder;
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::Instant;
use tauri::ipc::Channel;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatchRange {
    pub start: usize,
    pub end: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatchLine {
    pub line_number: u64,
    pub line_text: String,
    pub ranges: Vec<SearchMatchRange>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchFileResult {
    pub path: String,
    pub full_path: String,
    pub matches: Vec<SearchMatchLine>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSummary {
    pub total_files: usize,
    pub total_matches: usize,
    pub duration_ms: u64,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
pub enum SearchStreamEvent {
    Match(SearchFileResult),
    Done(SearchSummary),
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchReplaceResult {
    pub files_modified: usize,
    pub replacements_count: usize,
    pub modified_paths: Vec<String>,
}

struct FileMatchSink<'a, M: Matcher> {
    matcher: &'a M,
    matches: Vec<SearchMatchLine>,
    total_count: usize,
    max_remaining: usize,
}

impl<'a, M: Matcher> Sink for FileMatchSink<'a, M> {
    type Error = io::Error;

    fn matched(&mut self, _searcher: &grep_searcher::Searcher, mat: &SinkMatch<'_>) -> Result<bool, io::Error> {
        if self.total_count >= self.max_remaining {
            return Ok(false);
        }

        let line_bytes = mat.bytes();
        let trimmed_bytes = match line_bytes.last() {
            Some(b'\n') => {
                let without_lf = &line_bytes[..line_bytes.len() - 1];
                if without_lf.last() == Some(&b'\r') {
                    &without_lf[..without_lf.len() - 1]
                } else {
                    without_lf
                }
            }
            _ => line_bytes,
        };

        let line_text = String::from_utf8_lossy(trimmed_bytes).into_owned();
        let mut ranges = Vec::new();
        let _ = self.matcher.find_iter(line_text.as_bytes(), |m| {
            let start = byte_offset_to_utf16(&line_text, m.start());
            let end = byte_offset_to_utf16(&line_text, m.end());
            ranges.push(SearchMatchRange { start, end });
            true
        });

        if !ranges.is_empty() {
            self.total_count += ranges.len();
            self.matches.push(SearchMatchLine {
                line_number: mat.line_number().unwrap_or(1),
                line_text,
                ranges,
            });
        }

        Ok(self.total_count < self.max_remaining)
    }
}

fn byte_offset_to_utf16(text: &str, byte_idx: usize) -> usize {
    let clamped = byte_idx.min(text.len());
    text[..clamped].encode_utf16().count()
}

fn should_skip_entry(name: &str) -> bool {
    matches!(
        name,
        ".git" | "node_modules" | "target" | "dist" | ".next" | ".turbo"
    )
}

pub fn execute_search<F>(
    root: &Path,
    query: &str,
    regex: bool,
    case_sensitive: bool,
    mut emit: F,
) -> Result<SearchSummary, String>
where
    F: FnMut(SearchStreamEvent),
{
    let start = Instant::now();
    if query.is_empty() {
        let summary = SearchSummary {
            total_files: 0,
            total_matches: 0,
            duration_ms: 0,
            truncated: false,
        };
        emit(SearchStreamEvent::Done(summary.clone()));
        return Ok(summary);
    }

    let matcher = RegexMatcherBuilder::new()
        .case_insensitive(!case_sensitive)
        .fixed_strings(!regex)
        .build(query)
        .map_err(|e| format!("无效的搜索表达式: {}", e))?;

    let mut searcher = SearcherBuilder::new()
        .binary_detection(BinaryDetection::quit(b'\x00'))
        .line_number(true)
        .build();

    let nested_repos = crate::fs_tree::discover_nested_git_repos(root);
    let nested_abs_set: HashSet<PathBuf> = nested_repos.iter().map(|rel| root.join(rel)).collect();
    let mut walk_roots = Vec::with_capacity(1 + nested_repos.len());
    walk_roots.push(root.to_path_buf());
    for sub_rel in nested_repos {
        walk_roots.push(root.join(sub_rel));
    }

    const MAX_TOTAL_MATCHES: usize = 5000;
    let mut total_files = 0;
    let mut total_matches = 0;
    let mut truncated = false;

    'outer: for walk_root in walk_roots {
        let skip_set = nested_abs_set.clone();
        let walk_root_buf = walk_root.clone();

        let walker = WalkBuilder::new(&walk_root)
            .hidden(false)
            .git_ignore(true)
            .git_global(true)
            .git_exclude(true)
            .filter_entry(move |entry| {
                if entry.depth() == 0 {
                    return true;
                }
                if let Some(name) = entry.file_name().to_str() {
                    if should_skip_entry(name) {
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
            let Ok(entry) = entry_res else {
                continue;
            };
            if !entry.file_type().map(|ft| ft.is_file()).unwrap_or(false) {
                continue;
            }
            let abs_path = entry.path();
            let rel_path = match abs_path.strip_prefix(root) {
                Ok(r) => r.to_string_lossy().replace('\\', "/"),
                Err(_) => continue,
            };

            let mut sink = FileMatchSink {
                matcher: &matcher,
                matches: Vec::new(),
                total_count: 0,
                max_remaining: MAX_TOTAL_MATCHES.saturating_sub(total_matches),
            };

            if searcher.search_path(&matcher, abs_path, &mut sink).is_err() {
                continue;
            }

            if !sink.matches.is_empty() {
                total_files += 1;
                total_matches += sink.total_count;
                emit(SearchStreamEvent::Match(SearchFileResult {
                    path: rel_path,
                    full_path: abs_path.to_string_lossy().into_owned(),
                    matches: sink.matches,
                }));
            }

            if total_matches >= MAX_TOTAL_MATCHES {
                truncated = true;
                break 'outer;
            }
        }
    }

    let summary = SearchSummary {
        total_files,
        total_matches,
        duration_ms: start.elapsed().as_millis() as u64,
        truncated,
    };
    emit(SearchStreamEvent::Done(summary.clone()));
    Ok(summary)
}

pub fn execute_replace(
    root: &Path,
    query: &str,
    replacement: &str,
    regex: bool,
    case_sensitive: bool,
    paths: Option<Vec<String>>,
) -> Result<SearchReplaceResult, String> {
    if query.is_empty() {
        return Ok(SearchReplaceResult {
            files_modified: 0,
            replacements_count: 0,
            modified_paths: Vec::new(),
        });
    }

    let matcher = RegexMatcherBuilder::new()
        .case_insensitive(!case_sensitive)
        .fixed_strings(!regex)
        .build(query)
        .map_err(|e| format!("无效的替换表达式: {}", e))?;

    let target_paths: Vec<String> = if let Some(list) = paths.filter(|p| !p.is_empty()) {
        list
    } else {
        let mut matched_paths = Vec::new();
        execute_search(root, query, regex, case_sensitive, |ev| {
            if let SearchStreamEvent::Match(file_res) = ev {
                matched_paths.push(file_res.path);
            }
        })?;
        matched_paths
    };

    let mut files_modified = 0;
    let mut replacements_count = 0;
    let mut modified_paths = Vec::new();

    for rel in target_paths {
        let abs = root.join(&rel);
        let Ok(bytes) = fs::read(&abs) else {
            continue;
        };
        if bytes.iter().take(8192).any(|&b| b == 0) {
            continue;
        }
        let Ok(content) = String::from_utf8(bytes) else {
            continue;
        };

        let mut spans = Vec::new();
        let _ = matcher.find_iter(content.as_bytes(), |m| {
            spans.push((m.start(), m.end()));
            true
        });
        if spans.is_empty() {
            continue;
        }

        let mut updated = String::with_capacity(content.len());
        let mut last = 0;
        for (s, e) in &spans {
            updated.push_str(&content[last..*s]);
            updated.push_str(replacement);
            last = *e;
        }
        updated.push_str(&content[last..]);

        if fs::write(&abs, updated.as_bytes()).is_ok() {
            files_modified += 1;
            replacements_count += spans.len();
            modified_paths.push(rel);
        }
    }

    Ok(SearchReplaceResult {
        files_modified,
        replacements_count,
        modified_paths,
    })
}

#[tauri::command]
pub async fn search_workspace(
    root: String,
    query: String,
    regex: bool,
    case_sensitive: bool,
    channel: Channel<SearchStreamEvent>,
) -> Result<SearchSummary, String> {
    tokio::task::spawn_blocking(move || {
        execute_search(Path::new(&root), &query, regex, case_sensitive, |ev| {
            let _ = channel.send(ev);
        })
    })
    .await
    .map_err(|e| format!("搜索任务异常: {}", e))?
}

#[tauri::command]
pub async fn search_replace(
    root: String,
    query: String,
    replacement: String,
    regex: bool,
    case_sensitive: bool,
    paths: Option<Vec<String>>,
) -> Result<SearchReplaceResult, String> {
    tokio::task::spawn_blocking(move || {
        execute_replace(
            Path::new(&root),
            &query,
            &replacement,
            regex,
            case_sensitive,
            paths,
        )
    })
    .await
    .map_err(|e| format!("替换任务异常: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn test_search_and_replace() {
        let tmp = std::env::temp_dir().join(format!(
            "ke_search_test_{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(tmp.join("src")).unwrap();
        fs::write(
            tmp.join("src/demo.ts"),
            "const refundId = 1;\nconst RefundCount = 2;\n",
        )
        .unwrap();

        let mut events = Vec::new();
        let summary = execute_search(&tmp, "refund", false, false, |ev| {
            events.push(ev);
        })
        .unwrap();
        assert_eq!(summary.total_files, 1);
        assert_eq!(summary.total_matches, 2);

        let replaced = execute_replace(&tmp, "refund", "payout", false, true, None).unwrap();
        assert_eq!(replaced.files_modified, 1);
        assert_eq!(replaced.replacements_count, 1);

        let after = fs::read_to_string(tmp.join("src/demo.ts")).unwrap();
        assert!(after.contains("const payoutId = 1;"));
        assert!(after.contains("const RefundCount = 2;"));

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_regex_and_case_sensitive_and_utf16_offsets() {
        let tmp = std::env::temp_dir().join(format!(
            "ke_search_regex_test_{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(tmp.join("src")).unwrap();
        fs::write(
            tmp.join("src/api.ts"),
            "// 中文注释 prefix_123 suffix\nexport function handleRefund() {}\nexport function handlePayout() {}\n",
        )
        .unwrap();

        let mut matched_lines = Vec::new();
        let summary_re = execute_search(&tmp, r"handle[A-Z]\w+", true, true, |ev| {
            if let SearchStreamEvent::Match(file_res) = ev {
                matched_lines.extend(file_res.matches);
            }
        })
        .unwrap();
        assert_eq!(summary_re.total_matches, 2);
        assert_eq!(matched_lines[0].line_number, 2);

        let summary_ci = execute_search(&tmp, "handlerefund", true, false, |_| {}).unwrap();
        assert_eq!(summary_ci.total_matches, 1);

        let summary_cs = execute_search(&tmp, "handlerefund", true, true, |_| {}).unwrap();
        assert_eq!(summary_cs.total_matches, 0);

        let mut utf16_lines = Vec::new();
        execute_search(&tmp, "prefix_123", false, true, |ev| {
            if let SearchStreamEvent::Match(file_res) = ev {
                utf16_lines.extend(file_res.matches);
            }
        })
        .unwrap();
        assert_eq!(utf16_lines.len(), 1);
        let r = &utf16_lines[0].ranges[0];
        let u16_units: Vec<u16> = utf16_lines[0].line_text.encode_utf16().collect();
        let slice = String::from_utf16(&u16_units[r.start..r.end]).unwrap();
        assert_eq!(slice, "prefix_123");

        let _ = fs::remove_dir_all(&tmp);
    }
}
