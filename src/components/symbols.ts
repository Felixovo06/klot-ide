// 轻量符号扫描：用于 Cmd+P 的 @ 符号跳转与面包屑当前符号
export type SymbolKind =
  | 'function'
  | 'method'
  | 'class'
  | 'interface'
  | 'type'
  | 'enum'
  | 'variable'
  | 'struct'
  | 'module'
  | 'heading';

export interface SymbolEntry {
  name: string;
  kind: SymbolKind;
  line: number;
  indent: number;
}

const KEYWORDS = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'return',
  'function',
  'else',
  'do',
  'try',
  'with',
  'new',
  'await',
  'typeof',
  'super',
  'import',
  'export',
]);

const PATTERNS: Array<{ re: RegExp; kind: SymbolKind; topLevelOnly?: boolean }> = [
  { re: /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, kind: 'function' },
  { re: /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: 'class' },
  { re: /^\s*(?:export\s+)?(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: 'interface' },
  { re: /^\s*(?:export\s+)?(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)\s*(?:<[^=]*>)?\s*=/, kind: 'type' },
  { re: /^\s*(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/, kind: 'enum' },
  {
    re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>/,
    kind: 'function',
  },
  { re: /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/, kind: 'variable', topLevelOnly: true },
  { re: /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/, kind: 'function' },
  { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+([A-Za-z_]\w*)/, kind: 'function' },
  { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?struct\s+([A-Za-z_]\w*)/, kind: 'struct' },
  { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?trait\s+([A-Za-z_]\w*)/, kind: 'interface' },
  { re: /^\s*impl(?:<[^>]*>)?\s+(?:[\w:<>]+\s+for\s+)?([A-Za-z_][\w:]*)/, kind: 'class' },
  { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_]\w*)/, kind: 'module' },
  { re: /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/, kind: 'function' },
  { re: /^type\s+([A-Za-z_]\w*)\s+(?:struct|interface)/, kind: 'struct' },
  {
    re: /^\s+(?:(?:public|private|protected|static|readonly|async|override|get|set)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\([^;]*\)\s*(?::\s*[^{;=]+)?\{\s*$/,
    kind: 'method',
  },
];

function stripHeadingInlineSyntax(raw: string): string {
  return raw
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/(^|\s)_([^_]+)_(\s|$)/g, '$1$2$3')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\\([\\`*_{}[\]()#+\-.!|>])/g, '$1')
    .trim();
}

function scanMarkdownHeadings(text: string): SymbolEntry[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: SymbolEntry[] = [];
  const limit = Math.min(lines.length, 20000);
  let fenceChar = '';
  let fenceLen = 0;

  for (let i = 0; i < limit; i += 1) {
    const line = lines[i];
    if (!line || line.length > 600) continue;

    if (fenceChar) {
      const closeMatch = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (closeMatch && closeMatch[1][0] === fenceChar && closeMatch[1].length >= fenceLen) {
        fenceChar = '';
        fenceLen = 0;
      }
      continue;
    }

    const openMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (openMatch) {
      const marker = openMatch[1];
      const rest = line.slice(openMatch[0].length);
      if (marker[0] !== '`' || !rest.includes('`')) {
        fenceChar = marker[0];
        fenceLen = marker.length;
        continue;
      }
    }

    const headingMatch = /^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$/.exec(line);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const name = stripHeadingInlineSyntax(headingMatch[2]);
      if (name) {
        out.push({ name, kind: 'heading', line: i + 1, indent: level - 1 });
      }
    }
  }
  return out;
}

export function scanSymbols(text: string, language?: string): SymbolEntry[] {
  if (language === 'markdown') {
    return scanMarkdownHeadings(text);
  }
  const lines = text.split('\n');
  const out: SymbolEntry[] = [];
  const limit = Math.min(lines.length, 20000);
  for (let i = 0; i < limit; i += 1) {
    const line = lines[i];
    if (!line || line.length > 400) continue;
    const trimmed = line.trimStart();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('#')) continue;
    for (const p of PATTERNS) {
      if (p.topLevelOnly && /^\s/.test(line)) continue;
      const m = p.re.exec(line);
      if (m && m[1] && !KEYWORDS.has(m[1])) {
        out.push({ name: m[1], kind: p.kind, line: i + 1, indent: line.length - trimmed.length });
        break;
      }
    }
  }
  return out;
}

/** 计算光标所在位置的符号链（外层到内层） */
export function enclosingSymbols(text: string, symbols: SymbolEntry[], cursorLine: number): string[] {
  const lines = text.split('\n');
  const chain: SymbolEntry[] = [];
  let minIndent = Number.POSITIVE_INFINITY;
  let symIdx = symbols.length - 1;
  while (symIdx >= 0 && symbols[symIdx].line > cursorLine) symIdx -= 1;
  if (symIdx >= 0 && symbols[symIdx].kind === 'heading') {
    for (let i = symIdx; i >= 0; i -= 1) {
      const sym = symbols[i];
      if (sym.kind !== 'heading') continue;
      if (sym.indent < minIndent) {
        chain.unshift(sym);
        minIndent = sym.indent;
        if (minIndent === 0) break;
      }
    }
    return chain.map((s) => s.name);
  }
  for (let ln = cursorLine; ln >= 1 && symIdx >= 0; ln -= 1) {
    const sym = symbols[symIdx];
    if (sym.line === ln) {
      if (ln === cursorLine || sym.indent < minIndent) {
        if (sym.kind !== 'variable' && sym.kind !== 'type') chain.unshift(sym);
        minIndent = Math.min(minIndent, sym.indent);
      }
      symIdx -= 1;
      while (symIdx >= 0 && symbols[symIdx].line === ln) symIdx -= 1;
      if (minIndent === 0) break;
      continue;
    }
    const raw = lines[ln - 1] ?? '';
    if (ln !== cursorLine && raw.trim() && !/^\s*[}\])]/.test(raw)) {
      const indent = raw.length - raw.trimStart().length;
      if (indent < minIndent) minIndent = indent;
    } else if (ln === cursorLine && raw.trim()) {
      const indent = raw.length - raw.trimStart().length;
      if (indent < minIndent) minIndent = indent + 1;
    }
  }
  return chain.map((s) => s.name);
}
