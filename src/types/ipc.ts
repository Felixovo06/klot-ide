// Onyx IDE 前后端 Tauri IPC 契约定义（唯一真相来源）
// 所有命令名、参数字段与返回值结构均与 src-tauri/src/*.rs 1:1 严格对齐

export const IPC_EVENTS = {
  FS_CHANGED: 'fs:changed',
  PLUGINS_UPDATED: 'plugins:updated',
  LSP_DIAGNOSTICS: 'lsp:diagnostics',
} as const;

// ==================== 应用上下文 ====================

export interface AppContextInfo {
  defaultWorkspace: string;
  homeDir: string;
  platform: string;
  availableClis: string[];
  onyxPluginsDir: string;
}

// ==================== 文件系统 (fs_tree.rs) ====================

export interface FsTreeNode {
  name: string;
  path: string; // 相对工作区路径，POSIX 分隔符
  fullPath: string; // 磁盘绝对路径
  isDir: boolean;
  size?: number;
  children?: FsTreeNode[];
}

export interface FsFileContent {
  path: string;
  content: string;
  encoding: string;
  size: number;
  modifiedMs: number;
}

export interface FsChangedEvent {
  root: string;
  paths: string[];
  kind: 'create' | 'modify' | 'remove' | 'any';
  timestampMs: number;
}

// ==================== 全库搜索 (search.rs) ====================

export interface SearchMatchRange {
  start: number;
  end: number;
}

export interface SearchMatchLine {
  lineNumber: number;
  lineText: string;
  ranges: SearchMatchRange[];
}

export interface SearchFileResult {
  path: string;
  fullPath: string;
  matches: SearchMatchLine[];
}

export interface SearchSummary {
  totalFiles: number;
  totalMatches: number;
  durationMs: number;
  truncated: boolean;
}

export type SearchStreamEvent =
  | { event: 'match'; data: SearchFileResult }
  | { event: 'done'; data: SearchSummary };

export interface SearchReplaceResult {
  filesModified: number;
  replacementsCount: number;
  modifiedPaths: string[];
}

// ==================== Git 操作 (git_ops.rs) ====================

export type GitFileStatusCode = 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | '?';

export interface GitFileChange {
  path: string;
  oldPath?: string | null;
  status: GitFileStatusCode;
  staged: boolean;
  additions?: number;
  deletions?: number;
}

export interface GitStatusResult {
  isRepo: boolean;
  branch: string;
  upstream?: string | null;
  ahead: number;
  behind: number;
  staged: GitFileChange[];
  changes: GitFileChange[];
  totalChanges: number;
}

export interface GitDiffResult {
  path: string;
  originalText: string;
  modifiedText: string;
  additions: number;
  deletions: number;
  isBinary: boolean;
  isNewFile: boolean;
}

export interface GitCommitInfo {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  relativeTime: string;
  timestamp: number;
}

export interface GitBranchInfo {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
}

export interface GitRefBadge {
  name: string;
  kind: 'head' | 'local' | 'remote' | 'tag';
  isCurrentHead?: boolean;
}

export interface GitGraphNode {
  hash: string;
  shortHash: string;
  parents: string[];
  refs: GitRefBadge[];
  message: string;
  author: string;
  authorEmail: string;
  relativeTime: string;
  timestamp: number;
}

export interface GitCommitDetail {
  hash: string;
  shortHash: string;
  parents: string[];
  author: string;
  authorEmail: string;
  timestamp: number;
  relativeTime: string;
  subject: string;
  body: string;
  files: GitFileChange[];
  totalAdditions: number;
  totalDeletions: number;
}

export interface GitCompareResult {
  baseRef: string;
  headRef: string;
  threeDot: boolean;
  ahead: number;
  behind: number;
  files: GitFileChange[];
  commits: GitCommitInfo[];
  totalAdditions: number;
  totalDeletions: number;
}

// ==================== 任务运行器 (task_runner.rs) ====================

export type TaskSource =
  | 'package.json'
  | 'Cargo.toml'
  | 'Makefile'
  | '.ke/tasks.json'
  | '.onyx/tasks.json'
  | 'custom';

export interface TaskDefinition {
  id: string;
  name: string;
  command: string;
  cwd: string;
  source: TaskSource;
}

export interface TaskRunHandle {
  runId: string;
  taskId: string;
  pid: number;
  command: string;
}

export type TaskOutputEvent =
  | { event: 'stdout'; data: { runId: string; chunk: string; timestampMs: number } }
  | { event: 'stderr'; data: { runId: string; chunk: string; timestampMs: number } }
  | { event: 'exit'; data: { runId: string; code: number | null; signal: string | null } };

// ==================== PTY 终端舱 (pty_dock.rs) ====================

export interface PtySpawnOptions {
  id: string;
  cmd: string;
  args: string[];
  cwd: string;
  cols: number;
  rows: number;
  activeFile: string | null;
  theme?: 'light' | 'dark';
}

export interface PtySessionInfo {
  id: string;
  cmd: string;
  cwd: string;
  pid: number | null;
}

// ==================== LSP 桥接 (lsp_bridge.rs) ====================

export interface LspServerStatus {
  lang: string;
  command: string;
  available: boolean;
  running: boolean;
}

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspDiagnosticItem {
  range: LspRange;
  severity?: number;
  code?: string | number;
  source?: string;
  message: string;
}

export interface LspDiagnosticsEvent {
  lang: string;
  uri: string;
  path: string;
  diagnostics: LspDiagnosticItem[];
}

// ==================== 自生长插件 (plugin_host.rs) ====================

export type PluginSlot = 'command' | 'topbar_status' | 'drawer_view';

export interface PluginTriggers {
  menu?: string;
  shortcut?: string;
  palette?: boolean;
  intervalMs?: number;
  onSave?: boolean;
  onGitChange?: boolean;
}

export interface OnyxPluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  slot: PluginSlot;
  entry: string;
  runtime: string;
  triggers?: PluginTriggers;
  sourceDir: string;
  scope: 'global' | 'workspace';
}

export interface PluginExecutionContext {
  workspaceRoot: string;
  branch: string;
  activeFile: string | null;
  selection: {
    startLine: number;
    endLine: number;
    text: string;
  } | null;
  changedFiles: string[];
}

export type PluginAction =
  | { type: 'toast'; tone: 'info' | 'success' | 'warning' | 'error'; message: string }
  | { type: 'open_file'; path: string; line?: number }
  | { type: 'replace_selection'; text: string }
  | { type: 'run_console'; text: string; tone?: 'info' | 'error' }
  | { type: 'send_to_cli'; prompt: string }
  | {
      type: 'render_drawer';
      title: string;
      format: 'markdown' | 'table';
      content?: string;
      columns?: string[];
      rows?: Array<Array<string | number>>;
    };

export interface TopbarStatusOutput {
  label: string;
  tone: 'neutral' | 'success' | 'warning' | 'error';
  tooltip?: string;
}

export interface PluginExecutionResult {
  pluginId: string;
  actions?: PluginAction[];
  status?: TopbarStatusOutput;
  rawStdout?: string;
  stderr?: string;
  exitCode: number;
}

export interface PluginsUpdatedEvent {
  root: string;
  plugins: OnyxPluginManifest[];
}
