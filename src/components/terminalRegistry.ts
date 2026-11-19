// xterm 实例注册表：每个 PTY 会话一个常驻 Terminal，切换视图只做 DOM 迁移，不销毁
import { Terminal, type ILink, type ILinkProvider } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { appOpenExternal, ptyResize, ptyWrite } from '../lib/ipcClient';
import { ONYX_XTERM_DARK, ONYX_XTERM_LIGHT } from '../styles/onyx-generated-themes';
import { MONO_FONT } from './monacoSetup';

export interface TerminalEntry {
  id: string;
  term: Terminal;
  fit: FitAddon;
  opened: boolean;
  spawned: boolean;
  host: HTMLElement | null;
  lastCols: number;
  lastRows: number;
}

export type TerminalLinkHandler = (path: string, line?: number, endLine?: number) => void;

const entries = new Map<string, TerminalEntry>();
let linkHandler: TerminalLinkHandler = () => {};
let currentTheme: 'light' | 'dark' = 'light';
let currentFontSize = 12.5;

export function setTerminalLinkHandler(handler: TerminalLinkHandler) {
  linkHandler = handler;
}

// 匹配 src/xx/yy.ts:18、src/xx/yy.ts:18:4、path#L18-32、@path#L18 等形式
const PATH_LINK = /(?:^|[\s'"`(\[<@])((?:\.{0,2}\/)?(?:[\w.@-]+\/)+[\w.@-]+\.[A-Za-z0-9]{1,8})(?::(\d+)(?::\d+)?|#L(\d+)(?:-L?(\d+))?)?/g;

function createPathLinkProvider(term: Terminal): ILinkProvider {
  return {
    provideLinks(bufferLineNumber, callback) {
      const line = term.buffer.active.getLine(bufferLineNumber - 1);
      if (!line) {
        callback(undefined);
        return;
      }
      const text = line.translateToString(true);
      const links: ILink[] = [];
      PATH_LINK.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = PATH_LINK.exec(text)) !== null) {
        const path = m[1];
        const fullMatch = m[0];
        const offset = fullMatch.indexOf(path);
        const start = m.index + offset;
        const suffixLen = fullMatch.length - offset - path.length;
        const lineNo = m[2] ? Number(m[2]) : m[3] ? Number(m[3]) : undefined;
        const endLine = m[4] ? Number(m[4]) : undefined;
        links.push({
          range: {
            start: { x: start + 1, y: bufferLineNumber },
            end: { x: start + path.length + suffixLen, y: bufferLineNumber },
          },
          text: text.slice(start, start + path.length + suffixLen),
          decorations: { underline: true, pointerCursor: true },
          activate: () => linkHandler(path, lineNo, endLine),
        });
      }
      callback(links.length > 0 ? links : undefined);
    },
  };
}

export function createTerminalEntry(id: string): TerminalEntry {
  const existing = entries.get(id);
  if (existing) return existing;
  const term = new Terminal({
    fontFamily: MONO_FONT,
    fontSize: currentFontSize,
    lineHeight: 1.55,
    minimumContrastRatio: 4.5,
    letterSpacing: 0,
    cursorBlink: true,
    cursorStyle: 'bar',
    cursorWidth: 2,
    scrollback: 5000,
    allowProposedApi: false,
    macOptionIsMeta: true,
    theme: currentTheme === 'dark' ? ONYX_XTERM_DARK : ONYX_XTERM_LIGHT,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(
    new WebLinksAddon((_event, uri) => {
      void appOpenExternal(uri);
    }),
  );
  term.registerLinkProvider(createPathLinkProvider(term));
  const entry: TerminalEntry = {
    id,
    term,
    fit,
    opened: false,
    spawned: false,
    host: null,
    lastCols: term.cols,
    lastRows: term.rows,
  };
  term.onData((data) => {
    if (entry.spawned) {
      ptyWrite(id, data).catch(() => {});
    }
  });
  entries.set(id, entry);
  return entry;
}

export function getTerminalEntry(id: string): TerminalEntry | null {
  return entries.get(id) ?? null;
}

export function attachTerminal(id: string, host: HTMLElement) {
  const entry = entries.get(id);
  if (!entry) return;
  entry.host = host;
  if (!entry.opened) {
    entry.term.open(host);
    entry.opened = true;
  } else if (entry.term.element && entry.term.element.parentElement !== host) {
    host.appendChild(entry.term.element);
  }
}

/** 根据容器尺寸自适应并同步 PTY 行列 */
export function fitTerminal(id: string) {
  const entry = entries.get(id);
  if (!entry || !entry.opened || !entry.host) return;
  if (entry.host.offsetWidth === 0 || entry.host.offsetHeight === 0) return;
  try {
    entry.fit.fit();
  } catch {
    return;
  }
  const { cols, rows } = entry.term;
  if (entry.spawned && (cols !== entry.lastCols || rows !== entry.lastRows)) {
    ptyResize(id, cols, rows).catch(() => {});
  }
  entry.lastCols = cols;
  entry.lastRows = rows;
}

export function disposeTerminal(id: string) {
  const entry = entries.get(id);
  if (!entry) return;
  entry.term.dispose();
  entries.delete(id);
}

export function applyTerminalTheme(theme: 'light' | 'dark') {
  currentTheme = theme;
  for (const entry of entries.values()) {
    entry.term.options.theme = theme === 'dark' ? ONYX_XTERM_DARK : ONYX_XTERM_LIGHT;
  }
}

export function applyTerminalFontSize(fontSize: number) {
  currentFontSize = fontSize;
  for (const entry of entries.values()) {
    entry.term.options.fontSize = fontSize;
    fitTerminal(entry.id);
  }
}
