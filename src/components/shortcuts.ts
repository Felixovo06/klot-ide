// 快捷键解析与全局分发
import { useEffect } from 'react';
import { editorBridge } from '../stores/editorBridge';
import { useGitStore } from '../stores/gitStore';
import { usePluginStore } from '../stores/pluginStore';
import { useUiStore } from '../stores/uiStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { fullPathFromUri } from './monacoSetup';
import { isMarkdownPath, toRelPath } from '../stores/utils';

export interface ParsedShortcut {
  mod: boolean; // Cmd（macOS）或 Ctrl（其他平台）
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

export const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);

export function parseShortcut(spec: string): ParsedShortcut | null {
  const parts = spec
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const out: ParsedShortcut = { mod: false, ctrl: false, shift: false, alt: false, key: '' };
  for (const raw of parts) {
    const p = raw.toLowerCase();
    if (p === 'cmd' || p === 'command' || p === 'meta' || p === 'cmdorctrl' || p === 'mod') out.mod = true;
    else if (p === 'ctrl' || p === 'control') {
      if (IS_MAC) out.ctrl = true;
      else out.mod = true;
    } else if (p === 'shift') out.shift = true;
    else if (p === 'alt' || p === 'option' || p === 'opt') out.alt = true;
    else out.key = p === 'space' ? ' ' : p === 'esc' ? 'escape' : p;
  }
  return out.key ? out : null;
}

export function eventKey(e: KeyboardEvent): string {
  const code = e.code;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  switch (code) {
    case 'Backquote':
      return '`';
    case 'Comma':
      return ',';
    case 'Period':
      return '.';
    case 'Slash':
      return '/';
    case 'Backslash':
      return '\\';
    case 'BracketLeft':
      return '[';
    case 'BracketRight':
      return ']';
    case 'Semicolon':
      return ';';
    case 'Quote':
      return "'";
    case 'Minus':
      return '-';
    case 'Equal':
      return '=';
    case 'Enter':
    case 'NumpadEnter':
      return 'enter';
    case 'Escape':
      return 'escape';
    case 'Space':
      return ' ';
    default:
      return e.key.toLowerCase();
  }
}

export function matchShortcut(e: KeyboardEvent, spec: ParsedShortcut | string | null | undefined): boolean {
  const s = typeof spec === 'string' ? parseShortcut(spec) : spec;
  if (!s) return false;
  const modPressed = IS_MAC ? e.metaKey : e.ctrlKey;
  const ctrlPressed = IS_MAC ? e.ctrlKey : false;
  return (
    modPressed === s.mod &&
    ctrlPressed === s.ctrl &&
    e.shiftKey === s.shift &&
    e.altKey === s.alt &&
    eventKey(e) === s.key
  );
}

/** 将 "Cmd+Shift+C" 规范化为平台显示文本 */
export function formatShortcut(spec: string): string {
  if (IS_MAC) return spec;
  return spec.replace(/\bCmd\b/gi, 'Ctrl');
}

export const BUILTIN_SHORTCUTS: Array<{ keys: string; label: string }> = [
  { keys: 'Cmd+O', label: '打开项目文件夹' },
  { keys: 'Cmd+Shift+O', label: '在新窗口中打开项目' },
  { keys: 'Cmd+P', label: '快速跳转文件 / @ 符号 / > 命令' },
  { keys: 'Cmd+Shift+P', label: '命令面板' },
  { keys: 'Cmd+G', label: '跳转到指定行 (:line)' },
  { keys: 'Cmd+1', label: '切换到 Code 模式' },
  { keys: 'Cmd+2', label: '切换到 Git 模式' },
  { keys: 'Cmd+B', label: '显示 / 隐藏左侧栏' },
  { keys: 'Cmd+J', label: '显示 / 隐藏 CLI 舱' },
  { keys: 'Cmd+`', label: '显示 / 隐藏运行控制台' },
  { keys: 'Cmd+Shift+F', label: '全局搜索' },
  { keys: 'Cmd+S', label: '保存当前文件' },
  { keys: 'Cmd+Alt+S', label: '保存全部文件' },
  { keys: 'Cmd+W', label: '关闭当前标签' },
  { keys: 'Cmd+Shift+T', label: '恢复最近关闭标签' },
  { keys: 'Cmd+Shift+[', label: '切换到上一个标签' },
  { keys: 'Cmd+Shift+]', label: '切换到下一个标签' },
  { keys: 'Alt+Z', label: '切换自动换行' },
  { keys: 'Cmd+=', label: '放大编辑器字号' },
  { keys: 'Cmd+-', label: '缩小编辑器字号' },
  { keys: 'Cmd+0', label: '重置编辑器字号' },
  { keys: 'Cmd+Shift+V', label: '切换 Markdown 阅读模式' },
  { keys: 'Cmd+Alt+V', label: '切换 Markdown 分屏预览' },
  { keys: 'Cmd+L', label: '将选区作为上下文芯片发送到 CLI' },
  { keys: 'Cmd+,', label: '设置' },
  { keys: 'Cmd+Shift+X', label: '扩展' },
  { keys: 'Esc', label: '关闭弹窗' },
];

const BUILTIN: Array<{ spec: ParsedShortcut; run: () => void; when?: () => boolean }> = [];

function registerBuiltin(spec: string, run: () => void, when?: () => boolean) {
  const parsed = parseShortcut(spec);
  if (parsed) BUILTIN.push({ spec: parsed, run, when });
}

function isPlainInputFocused(): boolean {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return false;
  if (el.closest('.monaco-editor') && el.classList.contains('inputarea')) {
    return false;
  }
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function canToggleMarkdownView(): boolean {
  const ui = useUiStore.getState();
  const ws = useWorkspaceStore.getState();
  if (ui.mode !== 'code' || ui.modal || ui.quickOpen.open) return false;
  if (!isMarkdownPath(ws.activePath)) return false;
  return !isPlainInputFocused();
}

function saveCurrent() {
  const ui = useUiStore.getState();
  const ws = useWorkspaceStore.getState();
  if (ui.mode === 'git') {
    const model = editorBridge.diffEditor?.getModifiedEditor().getModel();
    const full = model ? fullPathFromUri(model.uri) : null;
    if (full && model?.uri.scheme === 'file') {
      const git = useGitStore.getState();
      const repoRoot = git.activeRepoRoot || ws.root;
      const wsRel =
        repoRoot && full.startsWith(repoRoot)
          ? git.toWorkspaceRel(toRelPath(repoRoot, full))
          : toRelPath(ws.root, full);
      void ws.saveFile(wsRel);
    }
    return;
  }
  void ws.saveFile();
}

registerBuiltin('Cmd+O', () => void useWorkspaceStore.getState().promptOpenWorkspace());
registerBuiltin('Cmd+Shift+O', () => void useWorkspaceStore.getState().promptOpenWorkspaceInNewWindow());
registerBuiltin('Cmd+P', () => {
  const ui = useUiStore.getState();
  if (ui.quickOpen.open) ui.closeQuickOpen();
  else ui.openQuickOpen('');
});
registerBuiltin('Cmd+Shift+P', () => useUiStore.getState().openQuickOpen('>'));
registerBuiltin('Cmd+1', () => useUiStore.getState().setMode('code'));
registerBuiltin('Cmd+2', () => useUiStore.getState().setMode('git'));
registerBuiltin('Cmd+B', () => useUiStore.getState().toggleLeft());
registerBuiltin('Cmd+J', () => useUiStore.getState().toggleCli());
registerBuiltin('Cmd+`', () => useUiStore.getState().toggleConsole());
registerBuiltin('Cmd+Shift+F', () => useUiStore.getState().focusSearch());
registerBuiltin('Cmd+S', saveCurrent);
registerBuiltin('Cmd+Alt+S', () => void useWorkspaceStore.getState().saveAllFiles());
registerBuiltin('Cmd+W', () => {
  const ws = useWorkspaceStore.getState();
  if (ws.activePath) ws.closeFile(ws.activePath);
});
registerBuiltin('Cmd+Shift+T', () => void useWorkspaceStore.getState().reopenClosedFile());
registerBuiltin('Cmd+Shift+[', () => useWorkspaceStore.getState().cycleTab(-1));
registerBuiltin('Cmd+Shift+]', () => useWorkspaceStore.getState().cycleTab(1));
registerBuiltin('Cmd+G', () => useUiStore.getState().openQuickOpen(':'));
registerBuiltin('Alt+Z', () => useUiStore.getState().toggleWordWrap());
registerBuiltin('Cmd+=', () => useUiStore.getState().zoomEditor(1));
registerBuiltin('Cmd+-', () => useUiStore.getState().zoomEditor(-1));
registerBuiltin('Cmd+0', () => useUiStore.getState().zoomEditor(0));
registerBuiltin(
  'Cmd+Shift+V',
  () => {
    const active = useWorkspaceStore.getState().activePath;
    if (active) useUiStore.getState().toggleMarkdownReadMode(active);
  },
  canToggleMarkdownView,
);
registerBuiltin(
  'Cmd+Alt+V',
  () => {
    const active = useWorkspaceStore.getState().activePath;
    if (active) useUiStore.getState().toggleMarkdownSplitMode(active);
  },
  canToggleMarkdownView,
);
registerBuiltin('Cmd+,', () => useUiStore.getState().setModal('settings'));
registerBuiltin('Cmd+Shift+X', () => useUiStore.getState().setModal('extensions'));

export function useGlobalShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Escape') {
        const ui = useUiStore.getState();
        if (ui.quickOpen.open) return; // 由弹窗自行处理
        if (ui.modal) {
          e.preventDefault();
          ui.setModal(null);
        }
        return;
      }
      if (!(e.metaKey || e.ctrlKey || e.altKey)) return;
      for (const item of BUILTIN) {
        if (matchShortcut(e, item.spec) && (!item.when || item.when())) {
          e.preventDefault();
          e.stopPropagation();
          item.run();
          return;
        }
      }
      for (const plugin of usePluginStore.getState().plugins) {
        const sc = plugin.triggers?.shortcut;
        if (sc && matchShortcut(e, sc)) {
          e.preventDefault();
          e.stopPropagation();
          void usePluginStore.getState().runPlugin(plugin.id);
          return;
        }
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);
}
