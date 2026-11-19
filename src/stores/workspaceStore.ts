import { create } from 'zustand';
import { fsListTree, fsReadFile, fsWriteFile } from '../lib/ipcClient';
import type { AppContextInfo, FsTreeNode } from '../types/ipc';
import {
  disposeFileModel,
  ensureFileModel,
  getFileModel,
  isFileModelDirty,
  listFileModelPaths,
  markFileModelSaved,
  reloadFileModel,
} from '../components/monacoSetup';
import { fileSavedEvent } from './events';
import { toast } from './uiStore';
import { dirname, errorMessage, joinPath, languageForPath, toRelPath } from './utils';

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

interface WorkspaceState {
  ctx: AppContextInfo | null;
  root: string;
  repoName: string;
  tree: FsTreeNode[];
  treeLoaded: boolean;
  expanded: Record<string, boolean>;
  filter: string;
  openFiles: OpenFile[];
  activePath: string | null;
  reveal: RevealRequest | null;
  selection: EditorSelectionInfo | null;
  cursorSymbols: string[];

  setContext: (ctx: AppContextInfo) => void;
  refreshTree: () => Promise<void>;
  toggleDir: (path: string) => void;
  expandTo: (path: string) => void;
  collapseAll: () => void;
  setFilter: (filter: string) => void;
  openFile: (pathOrFull: string, opts?: OpenFileOptions) => Promise<boolean>;
  closeFile: (path: string) => void;
  setActive: (path: string) => void;
  setDirtyByFull: (fullPath: string, dirty: boolean) => void;
  saveFile: (path?: string) => Promise<boolean>;
  reloadFromDisk: (paths?: string[]) => Promise<void>;
  setSelection: (sel: EditorSelectionInfo | null) => void;
  setCursorSymbols: (symbols: string[]) => void;
}

let revealNonce = 0;

function repoNameOf(root: string): string {
  const parts = root.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] ?? root;
}

export const useWorkspaceStore = create<WorkspaceState>()((set, get) => ({
  ctx: null,
  root: '',
  repoName: '',
  tree: [],
  treeLoaded: false,
  expanded: {},
  filter: '',
  openFiles: [],
  activePath: null,
  reveal: null,
  selection: null,
  cursorSymbols: [],

  setContext: (ctx) =>
    set({ ctx, root: ctx.defaultWorkspace, repoName: repoNameOf(ctx.defaultWorkspace) }),

  refreshTree: async () => {
    const { root } = get();
    if (!root) return;
    try {
      const tree = await fsListTree(root);
      set((s) => {
        const expanded = { ...s.expanded };
        if (!s.treeLoaded) {
          for (const n of tree) if (n.isDir) expanded[n.path] = true;
        }
        return { tree, treeLoaded: true, expanded };
      });
    } catch (e) {
      toast('error', `读取文件树失败：${errorMessage(e)}`);
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
    }
    get().expandTo(rel);
    return true;
  },

  closeFile: (path) => {
    const { openFiles, activePath } = get();
    const idx = openFiles.findIndex((f) => f.path === path);
    if (idx < 0) return;
    const file = openFiles[idx];
    if (file.dirty && !window.confirm(`${path} 有未保存的修改，确定关闭吗？`)) return;
    const next = openFiles.filter((f) => f.path !== path);
    let nextActive = activePath;
    if (activePath === path) {
      const neighbor = next[idx] ?? next[idx - 1] ?? null;
      nextActive = neighbor ? neighbor.path : null;
    }
    set({ openFiles: next, activePath: nextActive, reveal: null });
    disposeFileModel(file.fullPath);
  },

  setActive: (path) => {
    set({ activePath: path, reveal: null });
    get().expandTo(path);
  },

  setDirtyByFull: (fullPath, dirty) =>
    set((s) => {
      if (!s.openFiles.some((f) => f.fullPath === fullPath && f.dirty !== dirty)) return s;
      return {
        openFiles: s.openFiles.map((f) => (f.fullPath === fullPath ? { ...f, dirty } : f)),
      };
    }),

  saveFile: async (path) => {
    const { root, activePath } = get();
    const rel = path ?? activePath;
    if (!rel) return false;
    const fullPath = joinPath(root, rel);
    const model = getFileModel(fullPath);
    if (!model) return false;
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
