import { create } from 'zustand';
import { uid } from './utils';

export type ThemeName = 'light' | 'dark';
export type WorkMode = 'code' | 'git';
export type LeftTab = 'files' | 'search';
export type ModalKind = 'extensions' | 'settings' | 'shortcuts' | null;
export type ToastTone = 'info' | 'success' | 'warning' | 'error';
export type MarkdownViewMode = 'edit' | 'split' | 'read';

export interface EditorPrefs {
  editorFontSize: number; // 12..18, default 13
  wordWrap: 'off' | 'on'; // default 'off'
  tabSize: 2 | 4; // default 2
  autoSave: boolean; // default false
  trimTrailingWhitespace: boolean; // default false
  terminalFontSize: number; // 11..16, default 12.5
  markdownDefaultView: MarkdownViewMode; // default 'edit'
}

export interface ToastItem {
  id: string;
  tone: ToastTone;
  message: string;
}

interface UiState {
  theme: ThemeName;
  mode: WorkMode;
  leftVisible: boolean;
  cliVisible: boolean;
  consoleVisible: boolean;
  leftTab: LeftTab;
  quickOpen: { open: boolean; initial: string; nonce: number };
  modal: ModalKind;
  toasts: ToastItem[];
  searchFocusNonce: number;
  cliFocusNonce: number;
  leftWidth: number;
  cliWidth: number;
  consoleHeight: number;
  prefs: EditorPrefs;
  markdownViews: Record<string, MarkdownViewMode>;
  markdownOutlineVisible: boolean;
  markdownSplitRatio: number;

  setPref: <K extends keyof EditorPrefs>(key: K, value: EditorPrefs[K]) => void;
  toggleWordWrap: () => void;
  zoomEditor: (delta: -1 | 1 | 0) => void;
  getMarkdownView: (path: string | null) => MarkdownViewMode;
  setMarkdownView: (path: string, view: MarkdownViewMode) => void;
  toggleMarkdownReadMode: (path: string) => void;
  toggleMarkdownSplitMode: (path: string) => void;
  clearMarkdownViews: (paths: string[]) => void;
  remapMarkdownViews: (oldPrefix: string, newPrefix: string) => void;
  resetMarkdownViews: () => void;
  toggleMarkdownOutline: () => void;
  setMarkdownSplitRatio: (ratio: number) => void;
  resetMarkdownSplitRatio: () => void;
  setLeftWidth: (v: number) => void;
  setCliWidth: (v: number) => void;
  setConsoleHeight: (v: number) => void;
  resetLeftWidth: () => void;
  resetCliWidth: () => void;
  resetConsoleHeight: () => void;
  setTheme: (theme: ThemeName) => void;
  toggleTheme: () => void;
  setMode: (mode: WorkMode) => void;
  toggleLeft: () => void;
  setLeftVisible: (v: boolean) => void;
  toggleCli: () => void;
  setCliVisible: (v: boolean) => void;
  toggleConsole: () => void;
  setConsoleVisible: (v: boolean) => void;
  setLeftTab: (tab: LeftTab) => void;
  openQuickOpen: (initial?: string) => void;
  closeQuickOpen: () => void;
  setModal: (modal: ModalKind) => void;
  pushToast: (tone: ToastTone, message: string) => void;
  dismissToast: (id: string) => void;
  focusSearch: () => void;
  focusCli: () => void;
}

const THEME_KEY = 'ke.theme';

function readInitialTheme(): ThemeName {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'dark' || v === 'light') return v;
  } catch {
    // 忽略存储不可用
  }
  return 'light';
}

const LAYOUT_KEY = 'ke.layout';

/** 三栏布局尺寸的默认值与静态夹取范围；动态保护（中间画布与编辑器最小尺寸）由拖拽分隔条按容器实际尺寸计算 */
export const LAYOUT_LIMITS = {
  leftWidth: { def: 248, min: 180, max: 480 },
  cliWidth: { def: 400, min: 280, max: 720 },
  consoleHeight: { def: 220, min: 120, max: 560 },
} as const;

export const CENTER_MIN_WIDTH = 340;
export const EDITOR_MIN_HEIGHT = 180;

type LayoutKey = keyof typeof LAYOUT_LIMITS;
type LayoutSnapshot = Record<LayoutKey, number>;

export function clampLayout(key: LayoutKey, v: number): number {
  const { min, max, def } = LAYOUT_LIMITS[key];
  if (!Number.isFinite(v)) return def;
  return Math.round(Math.min(max, Math.max(min, v)));
}

function readInitialLayout(): LayoutSnapshot {
  const out: LayoutSnapshot = {
    leftWidth: LAYOUT_LIMITS.leftWidth.def,
    cliWidth: LAYOUT_LIMITS.cliWidth.def,
    consoleHeight: LAYOUT_LIMITS.consoleHeight.def,
  };
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Record<LayoutKey, unknown>>;
      (Object.keys(out) as LayoutKey[]).forEach((k) => {
        const v = parsed[k];
        if (typeof v === 'number') out[k] = clampLayout(k, v);
      });
    }
  } catch {
    // 忽略存储不可用或数据损坏
  }
  return out;
}

let layoutPersistTimer: ReturnType<typeof setTimeout> | null = null;

function persistLayout(snapshot: LayoutSnapshot) {
  if (layoutPersistTimer) clearTimeout(layoutPersistTimer);
  layoutPersistTimer = setTimeout(() => {
    layoutPersistTimer = null;
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(snapshot));
    } catch {
      // 忽略存储不可用
    }
  }, 160);
}

const initialLayout = readInitialLayout();

const PREFS_KEY = 'ke.prefs';
const MD_OUTLINE_KEY = 'ke.mdOutline';
const MD_SPLIT_RATIO_KEY = 'ke.mdSplitRatio';
const DEFAULT_MD_SPLIT_RATIO = 0.5;

export const DEFAULT_PREFS: EditorPrefs = {
  editorFontSize: 13,
  wordWrap: 'off',
  tabSize: 2,
  autoSave: false,
  trimTrailingWhitespace: false,
  terminalFontSize: 12.5,
  markdownDefaultView: 'edit',
};

function normalizeMarkdownView(v: unknown): MarkdownViewMode {
  return v === 'read' || v === 'split' ? v : 'edit';
}

function clampMarkdownSplitRatio(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return DEFAULT_MD_SPLIT_RATIO;
  return Math.round(Math.min(0.75, Math.max(0.25, v)) * 1000) / 1000;
}

function readInitialMarkdownOutline(): boolean {
  try {
    const raw = localStorage.getItem(MD_OUTLINE_KEY);
    if (raw === 'false') return false;
  } catch {
    // 忽略存储不可用
  }
  return true;
}

function readInitialMarkdownSplitRatio(): number {
  try {
    const raw = localStorage.getItem(MD_SPLIT_RATIO_KEY);
    if (raw !== null) return clampMarkdownSplitRatio(Number(raw));
  } catch {
    // 忽略存储不可用
  }
  return DEFAULT_MD_SPLIT_RATIO;
}

function clampEditorFontSize(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return DEFAULT_PREFS.editorFontSize;
  return Math.round(Math.min(18, Math.max(12, v)));
}

function clampTerminalFontSize(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return DEFAULT_PREFS.terminalFontSize;
  return Math.round(Math.min(16, Math.max(11, v)) * 2) / 2;
}

function readInitialPrefs(): EditorPrefs {
  const out: EditorPrefs = { ...DEFAULT_PREFS };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Record<keyof EditorPrefs, unknown>>;
      out.editorFontSize = clampEditorFontSize(p.editorFontSize);
      out.wordWrap = p.wordWrap === 'on' ? 'on' : 'off';
      out.tabSize = p.tabSize === 4 ? 4 : 2;
      out.autoSave = Boolean(p.autoSave);
      out.trimTrailingWhitespace = Boolean(p.trimTrailingWhitespace);
      out.terminalFontSize = clampTerminalFontSize(p.terminalFontSize);
      out.markdownDefaultView = normalizeMarkdownView(p.markdownDefaultView);
    }
  } catch {
    // 忽略存储不可用或数据损坏
  }
  return out;
}

function persistPrefs(prefs: EditorPrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // 忽略存储不可用
  }
}

const initialPrefs = readInitialPrefs();

const toastTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const useUiStore = create<UiState>()((set, get) => {
  const setLayout = (key: LayoutKey, v: number) => {
    const next = clampLayout(key, v);
    if (get()[key] === next) return;
    set({ [key]: next } as Pick<UiState, LayoutKey>);
    const { leftWidth, cliWidth, consoleHeight } = get();
    persistLayout({ leftWidth, cliWidth, consoleHeight });
  };

  return {
    theme: readInitialTheme(),
    mode: 'code',
    leftVisible: true,
    cliVisible: true,
    consoleVisible: false,
    leftTab: 'files',
    quickOpen: { open: false, initial: '', nonce: 0 },
    modal: null,
    toasts: [],
    searchFocusNonce: 0,
    cliFocusNonce: 0,
    leftWidth: initialLayout.leftWidth,
    cliWidth: initialLayout.cliWidth,
    consoleHeight: initialLayout.consoleHeight,
    prefs: initialPrefs,
    markdownViews: {},
    markdownOutlineVisible: readInitialMarkdownOutline(),
    markdownSplitRatio: readInitialMarkdownSplitRatio(),

    setPref: (key, value) => {
      const cur = get().prefs;
      let normalized = value;
      if (key === 'editorFontSize') normalized = clampEditorFontSize(value) as EditorPrefs[typeof key];
      else if (key === 'terminalFontSize') normalized = clampTerminalFontSize(value) as EditorPrefs[typeof key];
      else if (key === 'markdownDefaultView') normalized = normalizeMarkdownView(value) as EditorPrefs[typeof key];
      if (cur[key] === normalized) return;
      const next = { ...cur, [key]: normalized };
      persistPrefs(next);
      set({ prefs: next });
    },
    toggleWordWrap: () => {
      const next = get().prefs.wordWrap === 'on' ? 'off' : 'on';
      get().setPref('wordWrap', next);
    },
    zoomEditor: (delta) => {
      const size = delta === 0 ? DEFAULT_PREFS.editorFontSize : get().prefs.editorFontSize + delta;
      get().setPref('editorFontSize', size);
    },
    getMarkdownView: (path) => {
      if (!path) return 'edit';
      return get().markdownViews[path] ?? get().prefs.markdownDefaultView;
    },
    setMarkdownView: (path, view) => {
      if (!path) return;
      const normalized = normalizeMarkdownView(view);
      set((s) => {
        if (s.markdownViews[path] === normalized) return s;
        return { markdownViews: { ...s.markdownViews, [path]: normalized } };
      });
    },
    toggleMarkdownReadMode: (path) => {
      if (!path) return;
      const cur = get().getMarkdownView(path);
      get().setMarkdownView(path, cur === 'read' ? 'edit' : 'read');
    },
    toggleMarkdownSplitMode: (path) => {
      if (!path) return;
      const cur = get().getMarkdownView(path);
      get().setMarkdownView(path, cur === 'split' ? 'edit' : 'split');
    },
    clearMarkdownViews: (paths) => {
      if (paths.length === 0) return;
      const drop = new Set(paths);
      set((s) => {
        let changed = false;
        const next: Record<string, MarkdownViewMode> = {};
        for (const [k, v] of Object.entries(s.markdownViews)) {
          if (drop.has(k)) changed = true;
          else next[k] = v;
        }
        return changed ? { markdownViews: next } : s;
      });
    },
    remapMarkdownViews: (oldPrefix, newPrefix) => {
      if (!oldPrefix || oldPrefix === newPrefix) return;
      set((s) => {
        let changed = false;
        const next: Record<string, MarkdownViewMode> = {};
        for (const [k, v] of Object.entries(s.markdownViews)) {
          if (k === oldPrefix) {
            next[newPrefix] = v;
            changed = true;
          } else if (k.startsWith(`${oldPrefix}/`)) {
            next[`${newPrefix}${k.slice(oldPrefix.length)}`] = v;
            changed = true;
          } else {
            next[k] = v;
          }
        }
        return changed ? { markdownViews: next } : s;
      });
    },
    resetMarkdownViews: () => set({ markdownViews: {} }),
    toggleMarkdownOutline: () =>
      set((s) => {
        const next = !s.markdownOutlineVisible;
        try {
          localStorage.setItem(MD_OUTLINE_KEY, String(next));
        } catch {
          // 忽略存储不可用
        }
        return { markdownOutlineVisible: next };
      }),
    setMarkdownSplitRatio: (ratio) => {
      const next = clampMarkdownSplitRatio(ratio);
      if (get().markdownSplitRatio === next) return;
      try {
        localStorage.setItem(MD_SPLIT_RATIO_KEY, String(next));
      } catch {
        // 忽略存储不可用
      }
      set({ markdownSplitRatio: next });
    },
    resetMarkdownSplitRatio: () => get().setMarkdownSplitRatio(DEFAULT_MD_SPLIT_RATIO),

    setLeftWidth: (v) => setLayout('leftWidth', v),
    setCliWidth: (v) => setLayout('cliWidth', v),
    setConsoleHeight: (v) => setLayout('consoleHeight', v),
    resetLeftWidth: () => setLayout('leftWidth', LAYOUT_LIMITS.leftWidth.def),
    resetCliWidth: () => setLayout('cliWidth', LAYOUT_LIMITS.cliWidth.def),
    resetConsoleHeight: () => setLayout('consoleHeight', LAYOUT_LIMITS.consoleHeight.def),

    setTheme: (theme) => {
      try {
        localStorage.setItem(THEME_KEY, theme);
      } catch {
        // 忽略存储不可用
      }
      set({ theme });
    },
    toggleTheme: () => get().setTheme(get().theme === 'light' ? 'dark' : 'light'),
    setMode: (mode) => set({ mode }),
    toggleLeft: () => set((s) => ({ leftVisible: !s.leftVisible })),
    setLeftVisible: (leftVisible) => set({ leftVisible }),
    toggleCli: () => set((s) => ({ cliVisible: !s.cliVisible })),
    setCliVisible: (cliVisible) => set({ cliVisible }),
    toggleConsole: () => set((s) => ({ consoleVisible: !s.consoleVisible })),
    setConsoleVisible: (consoleVisible) => set({ consoleVisible }),
    setLeftTab: (leftTab) => set({ leftTab }),
    openQuickOpen: (initial = '') =>
      set((s) => ({ quickOpen: { open: true, initial, nonce: s.quickOpen.nonce + 1 } })),
    closeQuickOpen: () => set((s) => ({ quickOpen: { ...s.quickOpen, open: false } })),
    setModal: (modal) => set({ modal }),
    pushToast: (tone, message) => {
      const id = uid('toast');
      set((s) => ({ toasts: [...s.toasts.slice(-4), { id, tone, message }] }));
      const timer = setTimeout(() => get().dismissToast(id), tone === 'error' ? 6000 : 3200);
      toastTimers.set(id, timer);
    },
    dismissToast: (id) => {
      const timer = toastTimers.get(id);
      if (timer) clearTimeout(timer);
      toastTimers.delete(id);
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    },
    focusSearch: () =>
      set((s) => ({
        mode: 'code',
        leftVisible: true,
        leftTab: 'search',
        searchFocusNonce: s.searchFocusNonce + 1,
      })),
    focusCli: () => set((s) => ({ cliVisible: true, cliFocusNonce: s.cliFocusNonce + 1 })),
  };
});

export function toast(tone: ToastTone, message: string) {
  useUiStore.getState().pushToast(tone, message);
}
