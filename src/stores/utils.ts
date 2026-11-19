// 通用工具函数：路径换算、语言推断、去抖与 ANSI 清洗

export function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, '/');
}

export function isAbsolutePath(p: string): boolean {
  return p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p);
}

export function trimTrailingSlash(p: string): string {
  return p.length > 1 ? p.replace(/\/+$/, '') : p;
}

export function joinPath(root: string, rel: string): string {
  const n = normalizeSlashes(rel);
  if (isAbsolutePath(n)) return n;
  const r = trimTrailingSlash(normalizeSlashes(root));
  const clean = n.replace(/^\.\//, '');
  return clean ? `${r}/${clean}` : r;
}

export function toRelPath(root: string, p: string): string {
  const n = normalizeSlashes(p);
  const r = trimTrailingSlash(normalizeSlashes(root));
  if (r && n === r) return '';
  if (r && n.startsWith(`${r}/`)) return n.slice(r.length + 1);
  return n.replace(/^\.\//, '');
}

export function basename(p: string): string {
  const n = trimTrailingSlash(normalizeSlashes(p));
  const i = n.lastIndexOf('/');
  return i >= 0 ? n.slice(i + 1) : n;
}

export function dirname(p: string): string {
  const n = trimTrailingSlash(normalizeSlashes(p));
  const i = n.lastIndexOf('/');
  return i > 0 ? n.slice(0, i) : '';
}

export function extname(p: string): string {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i > 0 ? b.slice(i + 1).toLowerCase() : '';
}

const LANGUAGE_BY_EXT: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonc: 'json',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  htm: 'html',
  vue: 'html',
  md: 'markdown',
  markdown: 'markdown',
  rs: 'rust',
  py: 'python',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  php: 'php',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  sql: 'sql',
  xml: 'xml',
  svg: 'xml',
  graphql: 'graphql',
  dockerfile: 'dockerfile',
};

export function languageForPath(p: string): string {
  const b = basename(p).toLowerCase();
  if (b === 'dockerfile') return 'dockerfile';
  if (b === 'makefile') return 'plaintext';
  return LANGUAGE_BY_EXT[extname(p)] ?? 'plaintext';
}

export function lspLangForPath(p: string): string | null {
  const ext = extname(p);
  if (['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs'].includes(ext)) return 'typescript';
  if (ext === 'rs') return 'rust';
  if (ext === 'py') return 'python';
  if (ext === 'go') return 'go';
  return null;
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, wait: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const wrapped = (...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, wait);
  };
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return wrapped;
}

let uidCounter = 0;
export function uid(prefix = 'id'): string {
  uidCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${uidCounter.toString(36)}`;
}

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*(?:\u0007|\u001b\\)|\u001b[()][A-Za-z0-9]/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_PATTERN, '');
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

export function chipRef(path: string, startLine: number, endLine: number): string {
  return startLine === endLine ? `@${path}#L${startLine}` : `@${path}#L${startLine}-${endLine}`;
}
