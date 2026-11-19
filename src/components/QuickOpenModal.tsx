import { useEffect, useMemo, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Box,
  Braces,
  Code,
  File,
  FunctionSquare,
  GitBranch,
  Hash,
  Keyboard,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Play,
  Puzzle,
  RefreshCw,
  RotateCw,
  Save,
  Search,
  Settings,
  Square,
  SquareTerminal,
  SunMoon,
  Zap,
} from 'lucide-react';
import { useCliStore } from '../stores/cliStore';
import { useGitStore } from '../stores/gitStore';
import { usePluginStore } from '../stores/pluginStore';
import { useRunStore } from '../stores/runStore';
import { useUiStore } from '../stores/uiStore';
import { basename, dirname, joinPath } from '../stores/utils';
import { flattenFiles, useWorkspaceStore } from '../stores/workspaceStore';
import { symbolsForModel } from './CodeEditor';
import { fuzzyMatch } from './fuzzy';
import { getFileModel } from './monacoSetup';
import { formatShortcut } from './shortcuts';
import type { SymbolKind } from './symbols';
import { ICON_STROKE } from './ui';

interface QuickItem {
  key: string;
  icon: LucideIcon;
  label: string;
  positions?: number[];
  detail?: string;
  hint?: string;
  run: () => void;
}

const SYMBOL_ICONS: Record<SymbolKind, LucideIcon> = {
  function: FunctionSquare,
  method: FunctionSquare,
  class: Box,
  interface: Braces,
  type: Braces,
  enum: Hash,
  variable: Code,
  struct: Box,
  module: Box,
};

function Highlighted({ text, positions }: { text: string; positions?: number[] }) {
  if (!positions || positions.length === 0) return <>{text}</>;
  const set = new Set(positions);
  return (
    <>
      {Array.from(text).map((ch, i) =>
        set.has(i) ? (
          <span key={i} className="onyx-qo-hit">
            {ch}
          </span>
        ) : (
          <span key={i}>{ch}</span>
        ),
      )}
    </>
  );
}

function buildCommands(close: () => void): QuickItem[] {
  const ui = useUiStore.getState();
  const run = useRunStore.getState();
  const cli = useCliStore.getState();
  const plugins = usePluginStore.getState();
  const wrap = (fn: () => void) => () => {
    close();
    fn();
  };
  const items: QuickItem[] = [
    {
      key: 'theme',
      icon: SunMoon,
      label: `Theme: Switch to ${ui.theme === 'light' ? 'Onyx Dark' : 'Onyx Light'}`,
      run: wrap(ui.toggleTheme),
    },
    { key: 'code', icon: Code, label: 'View: Code Mode', hint: 'Cmd+1', run: wrap(() => ui.setMode('code')) },
    { key: 'git', icon: GitBranch, label: 'View: Git Mode', hint: 'Cmd+2', run: wrap(() => ui.setMode('git')) },
    { key: 'left', icon: PanelLeft, label: 'View: Toggle Sidebar', hint: 'Cmd+B', run: wrap(ui.toggleLeft) },
    { key: 'cli', icon: PanelRight, label: 'View: Toggle CLI Dock', hint: 'Cmd+J', run: wrap(ui.toggleCli) },
    { key: 'console', icon: PanelBottom, label: 'View: Toggle Run Console', hint: 'Cmd+`', run: wrap(ui.toggleConsole) },
    { key: 'search', icon: Search, label: 'Search: Find in Files', hint: 'Cmd+Shift+F', run: wrap(ui.focusSearch) },
    { key: 'save', icon: Save, label: 'File: Save', hint: 'Cmd+S', run: wrap(() => void useWorkspaceStore.getState().saveFile()) },
    { key: 'run', icon: Play, label: 'Task: Run Selected Task', run: wrap(() => void run.start()) },
    { key: 'stop', icon: Square, label: 'Task: Stop', run: wrap(() => void run.stop()) },
    { key: 'restart', icon: RotateCw, label: 'Task: Restart', run: wrap(() => void run.restart()) },
    ...run.tasks.map<QuickItem>((t) => ({
      key: `task:${t.id}`,
      icon: SquareTerminal,
      label: `Task: Run ${t.name}`,
      detail: t.command,
      run: wrap(() => {
        useRunStore.getState().selectTask(t.id);
        void useRunStore.getState().start();
      }),
    })),
    ...(cli.availableClis.length > 0 ? cli.availableClis : ['zsh']).map<QuickItem>((c) => ({
      key: `cli:${c}`,
      icon: SquareTerminal,
      label: `CLI: New ${c} Session`,
      run: wrap(() => {
        ui.setCliVisible(true);
        useCliStore.getState().addSession(c);
      }),
    })),
    { key: 'git-refresh', icon: RefreshCw, label: 'Git: Refresh Status', run: wrap(() => void useGitStore.getState().refresh()) },
    { key: 'plugins-reload', icon: RefreshCw, label: 'Plugins: Reload', run: wrap(() => void plugins.reload()) },
    { key: 'ext', icon: Puzzle, label: 'Preferences: Extensions', hint: 'Cmd+Shift+X', run: wrap(() => ui.setModal('extensions')) },
    { key: 'settings', icon: Settings, label: 'Preferences: Settings', hint: 'Cmd+,', run: wrap(() => ui.setModal('settings')) },
    { key: 'keys', icon: Keyboard, label: 'Preferences: Keyboard Shortcuts', run: wrap(() => ui.setModal('shortcuts')) },
  ];
  const pluginItems = plugins.plugins
    .filter((p) => (p.slot === 'command' || p.slot === 'drawer_view') && p.triggers?.palette !== false)
    .map<QuickItem>((p) => ({
      key: `plugin:${p.id}`,
      icon: Zap,
      label: `Plugin: ${p.name}`,
      detail: p.description,
      hint: p.triggers?.shortcut,
      run: wrap(() => void usePluginStore.getState().runPlugin(p.id)),
    }));
  return [...pluginItems, ...items];
}

export function QuickOpenModal() {
  const open = useUiStore((s) => s.quickOpen.open);
  const initial = useUiStore((s) => s.quickOpen.initial);
  const nonce = useUiStore((s) => s.quickOpen.nonce);
  const close = useUiStore((s) => s.closeQuickOpen);
  const tree = useWorkspaceStore((s) => s.tree);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery(initial);
    setIndex(0);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  }, [open, nonce, initial]);

  const files = useMemo(() => flattenFiles(tree), [tree]);

  const items = useMemo<QuickItem[]>(() => {
    if (!open) return [];
    const ws = useWorkspaceStore.getState();
    const openAt = (path: string, line?: number) => {
      close();
      useUiStore.getState().setMode('code');
      void useWorkspaceStore.getState().openFile(path, line ? { line } : undefined);
    };

    if (query.startsWith('>')) {
      const q = query.slice(1).trim();
      const all = buildCommands(close);
      if (!q) return all;
      return all
        .map((it) => ({ it, m: fuzzyMatch(q, it.label) }))
        .filter((x) => x.m)
        .sort((a, b) => b.m!.score - a.m!.score)
        .map((x) => ({ ...x.it, positions: x.m!.positions }));
    }

    if (query.startsWith('@') || query.startsWith('#')) {
      const q = query.slice(1).trim();
      if (!ws.activePath) return [];
      const model = getFileModel(joinPath(ws.root, ws.activePath));
      if (!model) return [];
      const activePath = ws.activePath;
      const symbols = symbolsForModel(model);
      const scored = symbols
        .map((s) => ({ s, m: fuzzyMatch(q, s.name) }))
        .filter((x) => x.m);
      if (q) scored.sort((a, b) => b.m!.score - a.m!.score);
      return scored.slice(0, 200).map(({ s, m }) => ({
        key: `sym:${s.line}:${s.name}`,
        icon: SYMBOL_ICONS[s.kind],
        label: s.name,
        positions: m!.positions,
        detail: s.kind,
        hint: `L${s.line}`,
        run: () => openAt(activePath, s.line),
      }));
    }

    // 文件搜索，支持 path:line
    const lineMatch = /^(.*?):(\d+)$/.exec(query.trim());
    const q = (lineMatch ? lineMatch[1] : query).trim();
    const line = lineMatch ? Number(lineMatch[2]) : undefined;
    if (!q) {
      const recent = [...ws.openFiles].reverse().map((f) => f.path);
      const rest = files.map((f) => f.path).filter((p) => !recent.includes(p));
      return [...recent, ...rest].slice(0, 60).map((p) => ({
        key: `file:${p}`,
        icon: File,
        label: basename(p),
        detail: dirname(p),
        hint: recent.includes(p) ? 'open' : undefined,
        run: () => openAt(p, line),
      }));
    }
    return files
      .map((f) => ({ f, m: fuzzyMatch(q, f.path) }))
      .filter((x) => x.m)
      .sort((a, b) => b.m!.score - a.m!.score)
      .slice(0, 60)
      .map(({ f, m }) => {
        const baseStart = f.path.length - f.name.length;
        return {
          key: `file:${f.path}`,
          icon: File,
          label: f.name,
          positions: m!.positions.filter((p) => p >= baseStart).map((p) => p - baseStart),
          detail: dirname(f.path),
          run: () => openAt(f.path, line),
        };
      });
  }, [open, query, files, close]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  if (!open) return null;

  const mode = query.startsWith('>') ? 'commands' : query.startsWith('@') || query.startsWith('#') ? 'symbols' : 'files';
  const placeholder =
    mode === 'commands' ? 'Run a command...' : mode === 'symbols' ? 'Go to symbol in file...' : 'Search files by name (@ symbols, > commands)';

  return (
    <div className="onyx-scrim is-light" onMouseDown={close}>
      <div className="onyx-quickopen" onMouseDown={(e) => e.stopPropagation()}>
        <div className="onyx-qo-input">
          <Search size={15} strokeWidth={ICON_STROKE} className="onyx-dim" />
          <input
            ref={inputRef}
            value={query}
            placeholder={placeholder}
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                close();
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIndex((i) => Math.min(items.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                items[index]?.run();
              }
            }}
          />
        </div>
        <div className="onyx-qo-list" ref={listRef}>
          {items.length === 0 && (
            <div className="onyx-qo-empty">
              {mode === 'symbols' ? '当前文件没有可识别的符号' : '没有匹配结果'}
            </div>
          )}
          {items.map((it, i) => {
            const Icon = it.icon;
            return (
              <div
                key={it.key}
                data-index={i}
                className={`onyx-qo-item${i === index ? ' is-active' : ''}`}
                onMouseMove={() => i !== index && setIndex(i)}
                onClick={() => it.run()}
              >
                <Icon size={15} strokeWidth={ICON_STROKE} className="onyx-qo-icon" />
                <span className="onyx-qo-label">
                  <Highlighted text={it.label} positions={it.positions} />
                </span>
                {it.detail && <span className="onyx-qo-detail">{it.detail}</span>}
                {it.hint && <span className="onyx-qo-hint">{formatShortcut(it.hint)}</span>}
              </div>
            );
          })}
        </div>
        <div className="onyx-qo-foot">
          <span>
            <b>@</b> symbols
          </span>
          <span>
            <b>&gt;</b> commands
          </span>
          <span>
            <b>:</b> line
          </span>
        </div>
      </div>
    </div>
  );
}
