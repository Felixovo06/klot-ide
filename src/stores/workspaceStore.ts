import { create } from 'zustand';
import {
  appOpenWorkspaceWindow,
  appPickWorkspace,
  fsCreateFile,
  fsDelete,
  fsListTree,
  fsReadFile,
  fsRename,
  fsWatchWorkspace,
  fsWriteFile,
  isTauriRuntime,
} from '../lib/ipcClient';
import type { AppContextInfo, FsTreeNode } from '../types/ipc';
import {
  disposeFileModel,
  ensureFileModel,
  getFileModel,
  isFileModelDirty,
  listFileModelPaths,
  markFileModelSaved,
  migrateFileModel,
  monaco,
  reloadFileModel,
  setMonacoWorkspaceRoot,
} from '../components/monacoSetup';
import { useCliStore } from './cliStore';
import { fileSavedEvent } from './events';
import { useGitStore } from './gitStore';
import { usePluginStore } from './pluginStore';
import { useRunStore } from './runStore';
import { toast, useUiStore } from './uiStore';
import {
  dirname,
  errorMessage,
  joinPath,
  languageForPath,
  normalizeSlashes,
  toRelPath,
  trimTrailingSlash,
} from './utils';

export interface OpenFile {
  path: string; // 相对工作区路径
  fullPath: string;
  dirty: boolean;
  language: string;
}

export interface RevealRequest {
  path: string;
  line: number;
  endLine?: number;
  column?: number;
  endColumn?: number;
  nonce: number;
}

export interface EditorSelectionInfo {
  startLine: number;
  endLine: number;
  text: string;
}

export interface OpenFileOptions {
  line?: number;
  endLine?: number;
  column?: number;
  endColumn?: number;
  activate?: boolean;
}

export interface TreeDraft {
  mode: 'file' | 'dir';
  parentDir: string;
}

interface WorkspaceState {
  ctx: AppContextInfo | null;
  root: string;
  repoName: string;
  recentWorkspaces: string[];
  tree: FsTreeNode[];
  treeLoaded: boolean;
  expanded: Record<string, boolean>;
  filter: string;
  selectedTreePath: string | null;
  treeDraft: TreeDraft | null;
  openFiles: OpenFile[];
  activePath: string | null;
  recentlyClosed: string[];
  reveal: RevealRequest | null;
  selection: EditorSelectionInfo | null;
  cursorSymbols: string[];

  setContext: (ctx: AppContextInfo) => void;
  setActiveRoot: (root: string, opts?: { recordRecent?: boolean }) => void;
  recordRecent: (root: string, opts?: { asLast?: boolean }) => void;
  refreshTree: (opts?: { silent?: boolean }) => Promise<boolean>;
  switchWorkspace: (nextRoot: string) => Promise<boolean>;
  promptOpenWorkspace: () => Promise<void>;
  promptOpenWorkspaceInNewWindow: () => Promise<void>;
  toggleDir: (path: string) => void;
  expandTo: (path: string) => void;
  collapseAll: () => void;
  setFilter: (filter: string) => void;
  setSelectedTreePath: (path: string | null) => void;
  startTreeCreate: (mode: 'file' | 'dir', parentDir?: string) => void;
  cancelTreeCreate: () => void;
  createEntry: (parentDir: string, name: string, isDir: boolean) => Promise<boolean>;
  renameEntry: (oldRel: string, newName: string) => Promise<boolean>;
  deleteEntry: (rel: string, isDir: boolean) => Promise<boolean>;
  openFile: (pathOrFull: string, opts?: OpenFileOptions) => Promise<boolean>;
  closeFile: (path: string) => void;
  closeOtherFiles: (keepPath: string) => void;
  closeFilesToRight: (path: string) => void;
  closeSavedFiles: () => void;
  closeAllFiles: () => void;
  reopenClosedFile: () => Promise<void>;
  cycleTab: (delta: -1 | 1) => void;
  setActive: (path: string) => void;
  setDirtyByFull: (fullPath: string, dirty: boolean) => void;
  scheduleAutoSave: (fullPath: string) => void;
  saveFile: (path?: string) => Promise<boolean>;
  saveAllFiles: () => Promise<void>;
  reloadFromDisk: (paths?: string[]) => Promise<void>;
  setSelection: (sel: EditorSelectionInfo | null) => void;
  setCursorSymbols: (symbols: string[]) => void;
}

const RECENT_KEY = 'ke.recentWorkspaces';
const LAST_KEY = 'ke.lastWorkspace';
const MAX_RECENT_WORKSPACES = 10;
const MAX_RECENTLY_CLOSED = 20;

let revealNonce = 0;
const autoSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearAutoSaveTimer(fullPath: string) {
  const timer = autoSaveTimers.get(fullPath);
  if (timer) {
    clearTimeout(timer);
    autoSaveTimers.delete(fullPath);
  }
}

function clearAllAutoSaveTimers() {
  autoSaveTimers.forEach((t) => clearTimeout(t));
  autoSaveTimers.clear();
}

function findTreeNode(nodes: FsTreeNode[], path: string): FsTreeNode | null {
  for (const n of nodes) {
    if (n.path === path) return n;
    if (n.isDir && n.children) {
      const hit = findTreeNode(n.children, path);
      if (hit) return hit;
    }
  }
  return null;
}

function validateEntryName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed || trimmed === '.' || trimmed === '..' || trimmed.includes('/') || trimmed.includes('\\')) {
    return null;
  }
  return trimmed;
}

function remapPathPrefix(p: string, oldPrefix: string, newPrefix: string): string {
  if (p === oldPrefix) return newPrefix;
  if (p.startsWith(`${oldPrefix}/`)) return `${newPrefix}${p.slice(oldPrefix.length)}`;
  return p;
}

export function normalizeWorkspacePath(p: string): string {
  const trimmed = p.trim();
  if (!trimmed) return '';
  return trimTrailingSlash(normalizeSlashes(trimmed));
}

export function repoNameOf(root: string): string {
  const parts = root.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] ?? root;
}

export function applyWorkspaceTitle(repoName: string) {
  if (typeof document === 'undefined') return;
  document.title = repoName ? `${repoName} - Klot IDE` : 'Klot IDE';
}

function mergeRecent(list: string[], target: string): string[] {
  const norm = normalizeWorkspacePath(target);
  if (!norm) return list;
  return [norm, ...list.filter((p) => normalizeWorkspacePath(p) !== norm)].slice(0, MAX_RECENT_WORKSPACES);
}

function readRecentWorkspaces(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      if (typeof item !== 'string') continue;
      const norm = normalizeWorkspacePath(item);
      if (!norm || norm === '/' || seen.has(norm)) continue;
      seen.add(norm);
      out.push(norm);
      if (out.length >= MAX_RECENT_WORKSPACES) break;
    }
    return out;
  } catch {
    return [];
  }
}

export function readLastWorkspace(): string | null {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    if (!raw) return null;
    const norm = normalizeWorkspacePath(raw);
    return norm && norm !== '/' ? norm : null;
  } catch {
    return null;
  }
}

function writeRecentWorkspaces(list: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // 忽略存储不可用
  }
}

function writeLastWorkspace(root: string) {
  try {
    localStorage.setItem(LAST_KEY, root);
  } catch {
    // 忽略存储不可用
  }
}

export const useWorkspaceStore = create<WorkspaceState>()((set, get) => ({
  ctx: null,
  root: '',
  repoName: '',
  recentWorkspaces: readRecentWorkspaces(),
  tree: [],
  treeLoaded: false,
  expanded: {},
  filter: '',
  selectedTreePath: null,
  treeDraft: null,
  openFiles: [],
  activePath: null,
  recentlyClosed: [],
  reveal: null,
  selection: null,
  cursorSymbols: [],

  setContext: (ctx) => {
    const root = normalizeWorkspacePath(ctx.defaultWorkspace);
    set({ ctx, root, repoName: repoNameOf(root) });
  },

  setActiveRoot: (nextRoot, opts) => {
    const norm = normalizeWorkspacePath(nextRoot);
    const repoName = repoNameOf(norm);
    set({ root: norm, repoName });
    applyWorkspaceTitle(repoName);
    if (opts?.recordRecent) get().recordRecent(norm, { asLast: true });
  },

  recordRecent: (target, opts) => {
    const norm = normalizeWorkspacePath(target);
    if (!norm) return;
    const next = mergeRecent(get().recentWorkspaces, norm);
    writeRecentWorkspaces(next);
    if (opts?.asLast) writeLastWorkspace(norm);
    set({ recentWorkspaces: next });
  },

  refreshTree: async (opts) => {
    const { root } = get();
    if (!root) return false;
    try {
      const tree = await fsListTree(root);
      set((s) => {
        const expanded = { ...s.expanded };
        if (!s.treeLoaded) {
          const topDirs = tree.filter((n) => n.isDir);
          if (topDirs.length <= 6) {
            for (const n of topDirs) {
              if (!n.isGitRepo) expanded[n.path] = true;
            }
          }
        }
        return { tree, treeLoaded: true, expanded };
      });
      return true;
    } catch (e) {
      if (!opts?.silent) toast('error', `读取文件树失败：${errorMessage(e)}`);
      return false;
    }
  },

  switchWorkspace: async (nextRoot) => {
    const target = normalizeWorkspacePath(nextRoot);
    if (!target) return false;
    const prevRoot = normalizeWorkspacePath(get().root);
    if (target === prevRoot) {
      get().recordRecent(target, { asLast: true });
      return true;
    }
    const { openFiles } = get();
    if (
      openFiles.some((f) => f.dirty) &&
      !window.confirm('当前项目存在未保存的修改，切换项目将丢弃未保存内容，确定继续吗？')
    ) {
      return false;
    }

    // 清理旧工作区全部文件模型与编辑器状态
    clearAllAutoSaveTimers();
    for (const f of openFiles) disposeFileModel(f.fullPath);
    for (const full of listFileModelPaths()) disposeFileModel(full);
    set({
      openFiles: [],
      activePath: null,
      recentlyClosed: [],
      selectedTreePath: null,
      treeDraft: null,
      reveal: null,
      selection: null,
      cursorSymbols: [],
      tree: [],
      expanded: {},
      filter: '',
      treeLoaded: false,
    });

    // 停止旧任务、结束旧 CLI PTY 会话、清空 Git 缓存
    await useRunStore.getState().resetForWorkspace();
    useCliStore.getState().resetForWorkspace();
    useGitStore.getState().resetForWorkspace();

    const nextRepoName = repoNameOf(target);
    const nextRecent = mergeRecent(get().recentWorkspaces, target);
    writeRecentWorkspaces(nextRecent);
    writeLastWorkspace(target);
    set({
      root: target,
      repoName: nextRepoName,
      recentWorkspaces: nextRecent,
    });
    applyWorkspaceTitle(nextRepoName);
    setMonacoWorkspaceRoot(target);
    fsWatchWorkspace(target).catch(() => {});

    const git = useGitStore.getState();
    await Promise.all([
      get().refreshTree(),
      git.refreshRepos({ silent: true }),
      useRunStore.getState().discover(),
      usePluginStore.getState().init(target),
    ]);
    return true;
  },

  promptOpenWorkspace: async () => {
    const { root, ctx } = get();
    try {
      const picked = await appPickWorkspace(root || ctx?.homeDir || null);
      if (picked) await get().switchWorkspace(picked);
    } catch (e) {
      toast('error', `打开项目文件夹失败：${errorMessage(e)}`);
    }
  },

  promptOpenWorkspaceInNewWindow: async () => {
    const { root, ctx } = get();
    try {
      const picked = await appPickWorkspace(root || ctx?.homeDir || null);
      if (!picked) return;
      const norm = normalizeWorkspacePath(picked);
      if (!norm) return;
      get().recordRecent(norm);
      if (!isTauriRuntime()) {
        toast('info', '浏览器演示模式暂不支持新建独立窗口，已添加到最近项目');
        return;
      }
      await appOpenWorkspaceWindow(norm);
    } catch (e) {
      toast('error', `在新窗口中打开失败：${errorMessage(e)}`);
    }
  },

  toggleDir: (path) => set((s) => ({ expanded: { ...s.expanded, [path]: !s.expanded[path] } })),

  expandTo: (path) => {
    const next = { ...get().expanded };
    let dir = dirname(path);
    let changed = false;
    while (dir) {
      if (!next[dir]) {
        next[dir] = true;
        changed = true;
      }
      dir = dirname(dir);
    }
    if (changed) set({ expanded: next });
  },

  collapseAll: () => set({ expanded: {} }),

  setFilter: (filter) => set({ filter }),

  setSelectedTreePath: (selectedTreePath) => set({ selectedTreePath }),

  startTreeCreate: (mode, explicitParent) => {
    const { selectedTreePath, activePath, tree, expanded } = get();
    let parentDir = explicitParent;
    if (parentDir === undefined) {
      const refPath = selectedTreePath ?? activePath;
      if (!refPath) {
        parentDir = '';
      } else {
        const node = findTreeNode(tree, refPath);
        parentDir = node ? (node.isDir ? node.path : dirname(node.path)) : dirname(refPath);
      }
    }
    const nextExpanded = { ...expanded };
    let cursor = parentDir;
    while (cursor) {
      nextExpanded[cursor] = true;
      cursor = dirname(cursor);
    }
    useUiStore.getState().setMode('code');
    useUiStore.getState().setLeftVisible(true);
    useUiStore.getState().setLeftTab('files');
    set({ expanded: nextExpanded, filter: '', treeDraft: { mode, parentDir } });
  },

  cancelTreeCreate: () => set({ treeDraft: null }),

  createEntry: async (parentDir, rawName, isDir) => {
    const name = validateEntryName(rawName);
    if (!name) {
      toast('warning', '名称不能为空且不能包含路径分隔符');
      return false;
    }
    const { root } = get();
    const rel = parentDir ? `${parentDir}/${name}` : name;
    const full = joinPath(root, rel);
    try {
      await fsCreateFile(full, isDir);
    } catch (e) {
      toast('error', `创建失败：${errorMessage(e)}`);
      return false;
    }
    set((s) => ({
      treeDraft: null,
      selectedTreePath: rel,
      expanded: isDir ? { ...s.expanded, [rel]: true } : s.expanded,
    }));
    await get().refreshTree();
    void useGitStore.getState().refresh({ silent: true });
    if (!isDir) await get().openFile(rel);
    return true;
  },

  renameEntry: async (oldRel, rawName) => {
    const newName = validateEntryName(rawName);
    if (!newName) {
      toast('warning', '名称不能为空且不能包含路径分隔符');
      return false;
    }
    const parent = dirname(oldRel);
    const newRel = parent ? `${parent}/${newName}` : newName;
    if (newRel === oldRel) return true;
    const { root, openFiles, activePath, expanded, recentlyClosed, selectedTreePath } = get();
    const oldFull = joinPath(root, oldRel);
    const newFull = joinPath(root, newRel);
    try {
      await fsRename(oldFull, newFull);
    } catch (e) {
      toast('error', `重命名失败：${errorMessage(e)}`);
      return false;
    }

    const nextOpenFiles = openFiles.map((f) => {
      const nextRel = remapPathPrefix(f.path, oldRel, newRel);
      if (nextRel === f.path) return f;
      const nextFull = joinPath(root, nextRel);
      clearAutoSaveTimer(f.fullPath);
      migrateFileModel(f.fullPath, nextFull);
      return {
        ...f,
        path: nextRel,
        fullPath: nextFull,
        language: languageForPath(nextRel),
      };
    });

    const nextExpanded: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(expanded)) {
      nextExpanded[remapPathPrefix(k, oldRel, newRel)] = v;
    }

    set({
      openFiles: nextOpenFiles,
      activePath: activePath ? remapPathPrefix(activePath, oldRel, newRel) : null,
      selectedTreePath: selectedTreePath ? remapPathPrefix(selectedTreePath, oldRel, newRel) : null,
      expanded: nextExpanded,
      recentlyClosed: recentlyClosed.map((p) => remapPathPrefix(p, oldRel, newRel)),
    });
    await get().refreshTree();
    void useGitStore.getState().refresh({ silent: true });
    return true;
  },

  deleteEntry: async (rel, isDir) => {
    const prompt = isDir
      ? `确定删除文件夹 "${rel}" 及其全部内容吗？此操作不可撤销。`
      : `确定删除文件 "${rel}" 吗？此操作不可撤销。`;
    if (!window.confirm(prompt)) return false;
    const { root, openFiles, activePath, recentlyClosed, selectedTreePath } = get();
    try {
      await fsDelete(joinPath(root, rel));
    } catch (e) {
      toast('error', `删除失败：${errorMessage(e)}`);
      return false;
    }
    const affected = openFiles.filter((f) => f.path === rel || f.path.startsWith(`${rel}/`));
    for (const f of affected) {
      clearAutoSaveTimer(f.fullPath);
      disposeFileModel(f.fullPath);
    }
    const nextOpen = openFiles.filter((f) => f.path !== rel && !f.path.startsWith(`${rel}/`));
    let nextActive = activePath;
    if (activePath && (activePath === rel || activePath.startsWith(`${rel}/`))) {
      nextActive = nextOpen[0]?.path ?? null;
    }
    set({
      openFiles: nextOpen,
      activePath: nextActive,
      selectedTreePath:
        selectedTreePath && (selectedTreePath === rel || selectedTreePath.startsWith(`${rel}/`)) ? null : selectedTreePath,
      recentlyClosed: recentlyClosed.filter((p) => p !== rel && !p.startsWith(`${rel}/`)),
      reveal: null,
    });
    await get().refreshTree();
    void useGitStore.getState().refresh({ silent: true });
    return true;
  },

  openFile: async (pathOrFull, opts = {}) => {
    const { root } = get();
    const rel = toRelPath(root, pathOrFull);
    if (!rel) return false;
    const fullPath = joinPath(root, rel);

    if (!get().openFiles.some((f) => f.path === rel)) {
      if (!getFileModel(fullPath)) {
        try {
          const file = await fsReadFile(fullPath);
          ensureFileModel(fullPath, file.content);
        } catch (e) {
          toast('error', `无法打开 ${rel}：${errorMessage(e)}`);
          return false;
        }
      }
      if (!get().openFiles.some((f) => f.path === rel)) {
        set((s) => ({
          openFiles: [
            ...s.openFiles,
            {
              path: rel,
              fullPath,
              dirty: isFileModelDirty(fullPath),
              language: languageForPath(rel),
            },
          ],
        }));
      }
    }

    if (opts.activate !== false) {
      revealNonce += 1;
      set({
        activePath: rel,
        reveal: opts.line
          ? {
              path: rel,
              line: opts.line,
              endLine: opts.endLine,
              column: opts.column,
              endColumn: opts.endColumn,
              nonce: revealNonce,
            }
          : null,
      });
      useGitStore.getState().syncRepoByFilePath(rel);
    }
    get().expandTo(rel);
    return true;
  },

  closeFile: (path) => {
    const file = get().openFiles.find((f) => f.path === path);
    if (!file) return;
    if (file.dirty && !window.confirm(`${path} 有未保存的修改，确定关闭吗？`)) return;
    const { openFiles, activePath, recentlyClosed } = get();
    const idx = openFiles.findIndex((f) => f.path === path);
    const next = openFiles.filter((f) => f.path !== path);
    let nextActive = activePath;
    if (activePath === path) {
      const neighbor = next[idx] ?? next[idx - 1] ?? null;
      nextActive = neighbor ? neighbor.path : null;
    }
    clearAutoSaveTimer(file.fullPath);
    const closed = [...recentlyClosed.filter((p) => p !== path), path].slice(-MAX_RECENTLY_CLOSED);
    set({ openFiles: next, activePath: nextActive, recentlyClosed: closed, reveal: null });
    disposeFileModel(file.fullPath);
  },

  closeOtherFiles: (keepPath) => {
    const targets = get().openFiles.filter((f) => f.path !== keepPath);
    if (targets.length === 0) return;
    const dirtyCount = targets.filter((f) => f.dirty).length;
    if (dirtyCount > 0 && !window.confirm(`有 ${dirtyCount} 个其他标签包含未保存修改，确定关闭吗？`)) return;
    const closed = [...get().recentlyClosed];
    for (const f of targets) {
      clearAutoSaveTimer(f.fullPath);
      disposeFileModel(f.fullPath);
      const idx = closed.indexOf(f.path);
      if (idx >= 0) closed.splice(idx, 1);
      closed.push(f.path);
    }
    const kept = get().openFiles.filter((f) => f.path === keepPath);
    set({
      openFiles: kept,
      activePath: kept[0]?.path ?? null,
      recentlyClosed: closed.slice(-MAX_RECENTLY_CLOSED),
      reveal: null,
    });
  },

  closeFilesToRight: (path) => {
    const { openFiles, activePath, recentlyClosed } = get();
    const anchor = openFiles.findIndex((f) => f.path === path);
    if (anchor < 0 || anchor >= openFiles.length - 1) return;
    const targets = openFiles.slice(anchor + 1);
    const dirtyCount = targets.filter((f) => f.dirty).length;
    if (dirtyCount > 0 && !window.confirm(`右侧有 ${dirtyCount} 个标签包含未保存修改，确定关闭吗？`)) return;
    const removeSet = new Set(targets.map((f) => f.path));
    const closed = [...recentlyClosed];
    for (const f of targets) {
      clearAutoSaveTimer(f.fullPath);
      disposeFileModel(f.fullPath);
      const idx = closed.indexOf(f.path);
      if (idx >= 0) closed.splice(idx, 1);
      closed.push(f.path);
    }
    const next = openFiles.slice(0, anchor + 1);
    set({
      openFiles: next,
      activePath: activePath && removeSet.has(activePath) ? path : activePath,
      recentlyClosed: closed.slice(-MAX_RECENTLY_CLOSED),
      reveal: null,
    });
  },

  closeSavedFiles: () => {
    const { openFiles, activePath, recentlyClosed } = get();
    const targets = openFiles.filter((f) => !f.dirty);
    if (targets.length === 0) return;
    const closed = [...recentlyClosed];
    for (const f of targets) {
      clearAutoSaveTimer(f.fullPath);
      disposeFileModel(f.fullPath);
      const idx = closed.indexOf(f.path);
      if (idx >= 0) closed.splice(idx, 1);
      closed.push(f.path);
    }
    const next = openFiles.filter((f) => f.dirty);
    const nextActive = next.some((f) => f.path === activePath) ? activePath : (next[0]?.path ?? null);
    set({
      openFiles: next,
      activePath: nextActive,
      recentlyClosed: closed.slice(-MAX_RECENTLY_CLOSED),
      reveal: null,
    });
  },

  closeAllFiles: () => {
    const { openFiles, recentlyClosed } = get();
    if (openFiles.length === 0) return;
    const dirtyCount = openFiles.filter((f) => f.dirty).length;
    if (dirtyCount > 0 && !window.confirm(`有 ${dirtyCount} 个文件包含未保存修改，确定全部关闭吗？`)) return;
    const closed = [...recentlyClosed];
    for (const f of openFiles) {
      clearAutoSaveTimer(f.fullPath);
      disposeFileModel(f.fullPath);
      const idx = closed.indexOf(f.path);
      if (idx >= 0) closed.splice(idx, 1);
      closed.push(f.path);
    }
    set({
      openFiles: [],
      activePath: null,
      recentlyClosed: closed.slice(-MAX_RECENTLY_CLOSED),
      reveal: null,
    });
  },

  reopenClosedFile: async () => {
    const closed = [...get().recentlyClosed];
    const opened = new Set(get().openFiles.map((f) => f.path));
    while (closed.length > 0) {
      const candidate = closed.pop()!;
      if (opened.has(candidate)) continue;
      set({ recentlyClosed: closed });
      useUiStore.getState().setMode('code');
      const ok = await get().openFile(candidate);
      if (ok) return;
    }
    set({ recentlyClosed: closed });
  },

  cycleTab: (delta) => {
    const { openFiles, activePath } = get();
    if (openFiles.length <= 1) return;
    const idx = openFiles.findIndex((f) => f.path === activePath);
    const cur = idx < 0 ? 0 : idx;
    const next = (cur + delta + openFiles.length) % openFiles.length;
    get().setActive(openFiles[next].path);
  },

  setActive: (path) => {
    set({ activePath: path, reveal: null });
    get().expandTo(path);
    useGitStore.getState().syncRepoByFilePath(path);
  },

  setDirtyByFull: (fullPath, dirty) =>
    set((s) => {
      if (!s.openFiles.some((f) => f.fullPath === fullPath && f.dirty !== dirty)) return s;
      return {
        openFiles: s.openFiles.map((f) => (f.fullPath === fullPath ? { ...f, dirty } : f)),
      };
    }),

  scheduleAutoSave: (fullPath) => {
    clearAutoSaveTimer(fullPath);
    if (!useUiStore.getState().prefs.autoSave) return;
    const timer = setTimeout(() => {
      autoSaveTimers.delete(fullPath);
      if (!useUiStore.getState().prefs.autoSave) return;
      const target = get().openFiles.find((f) => f.fullPath === fullPath && f.dirty);
      if (target) void get().saveFile(target.path);
    }, 1000);
    autoSaveTimers.set(fullPath, timer);
  },

  saveFile: async (path) => {
    const { root, activePath } = get();
    const rel = path ?? activePath;
    if (!rel) return false;
    const fullPath = joinPath(root, rel);
    const model = getFileModel(fullPath);
    if (!model) return false;
    clearAutoSaveTimer(fullPath);
    if (useUiStore.getState().prefs.trimTrailingWhitespace) {
      const edits: monaco.editor.IIdentifiedSingleEditOperation[] = [];
      for (let ln = 1; ln <= model.getLineCount(); ln += 1) {
        const line = model.getLineContent(ln);
        const stripped = line.replace(/[ \t]+$/, '');
        if (stripped.length !== line.length) {
          edits.push({
            range: new monaco.Range(ln, stripped.length + 1, ln, line.length + 1),
            text: '',
          });
        }
      }
      if (edits.length > 0) model.pushEditOperations([], edits, () => null);
    }
    try {
      await fsWriteFile(fullPath, model.getValue());
      markFileModelSaved(fullPath);
      fileSavedEvent.emit({ path: rel });
      return true;
    } catch (e) {
      toast('error', `保存失败：${errorMessage(e)}`);
      return false;
    }
  },

  saveAllFiles: async () => {
    const dirty = get().openFiles.filter((f) => f.dirty);
    if (dirty.length === 0) return;
    for (const f of dirty) {
      await get().saveFile(f.path);
    }
  },

  reloadFromDisk: async (paths) => {
    const { root } = get();
    const targets = paths
      ? new Set(paths.map((p) => joinPath(root, toRelPath(root, p))))
      : null;
    const candidates = listFileModelPaths().filter(
      (full) => (!targets || targets.has(full)) && !isFileModelDirty(full),
    );
    await Promise.all(
      candidates.map(async (full) => {
        try {
          const file = await fsReadFile(full);
          reloadFileModel(full, file.content);
        } catch {
          // 文件可能已被删除，保持现状
        }
      }),
    );
  },

  setSelection: (selection) => set({ selection }),
  setCursorSymbols: (cursorSymbols) => {
    const prev = get().cursorSymbols;
    if (prev.length === cursorSymbols.length && prev.every((v, i) => v === cursorSymbols[i])) return;
    set({ cursorSymbols });
  },
}));

export function flattenFiles(nodes: FsTreeNode[], out: FsTreeNode[] = []): FsTreeNode[] {
  for (const n of nodes) {
    if (n.isDir) {
      if (n.children) flattenFiles(n.children, out);
    } else {
      out.push(n);
    }
  }
  return out;
}
