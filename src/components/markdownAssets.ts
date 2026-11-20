// Markdown 阅读模式资源缓存（本地图片 Data URL 加载）与 Monaco 代码块语法高亮缓存
import { fsReadAssetDataUrl } from '../lib/ipcClient';
import type { ThemeName } from '../stores/uiStore';
import { normalizeSlashes } from '../stores/utils';
import { monaco } from './monacoSetup';

const MAX_ASSET_CACHE = 100;
const assetCache = new Map<string, string | null>();
const assetInFlight = new Map<string, Promise<string | null>>();
const assetListeners = new Set<() => void>();

export function subscribeAssetInvalidation(cb: () => void): () => void {
  assetListeners.add(cb);
  return () => {
    assetListeners.delete(cb);
  };
}

function notifyAssetInvalidation() {
  for (const cb of assetListeners) cb();
}

function cacheAsset(key: string, value: string | null) {
  if (assetCache.has(key)) assetCache.delete(key);
  assetCache.set(key, value);
  if (assetCache.size > MAX_ASSET_CACHE) {
    const oldest = assetCache.keys().next().value;
    if (oldest !== undefined) assetCache.delete(oldest);
  }
}

export async function loadLocalAssetDataUrl(absPath: string): Promise<string | null> {
  const key = normalizeSlashes(absPath);
  if (assetCache.has(key)) {
    const hit = assetCache.get(key) ?? null;
    // 刷新 LRU 顺序
    assetCache.delete(key);
    assetCache.set(key, hit);
    return hit;
  }
  const existing = assetInFlight.get(key);
  if (existing) return existing;

  const task = fsReadAssetDataUrl(absPath)
    .then((res) => {
      const url = res?.dataUrl ?? null;
      cacheAsset(key, url);
      return url;
    })
    .catch(() => null)
    .finally(() => {
      assetInFlight.delete(key);
    });

  assetInFlight.set(key, task);
  return task;
}

export function invalidateAssetPaths(absPaths: string[]) {
  let changed = false;
  for (const p of absPaths) {
    const key = normalizeSlashes(p);
    if (assetCache.delete(key)) changed = true;
    if (assetInFlight.delete(key)) changed = true;
  }
  if (changed) notifyAssetInvalidation();
}

export function clearAssetCache() {
  assetCache.clear();
  assetInFlight.clear();
}

// ==================== Monaco 代码块语法高亮 ====================

const CODE_LANG_ALIAS: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  typescript: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  javascript: 'javascript',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  shell: 'shell',
  py: 'python',
  python: 'python',
  rs: 'rust',
  rust: 'rust',
  yml: 'yaml',
  yaml: 'yaml',
  md: 'markdown',
  markdown: 'markdown',
  jsonc: 'json',
  json: 'json',
  toml: 'ini',
  ini: 'ini',
  'c++': 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  cpp: 'cpp',
  c: 'c',
  h: 'c',
  cs: 'csharp',
  csharp: 'csharp',
  rb: 'ruby',
  ruby: 'ruby',
  go: 'go',
  golang: 'go',
  java: 'java',
  kt: 'kotlin',
  kotlin: 'kotlin',
  swift: 'swift',
  php: 'php',
  sql: 'sql',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  svg: 'xml',
  graphql: 'graphql',
  dockerfile: 'dockerfile',
  docker: 'dockerfile',
  text: 'plaintext',
  txt: 'plaintext',
  plaintext: 'plaintext',
};

export function normalizeCodeLang(raw: string): string {
  const token = raw.trim().toLowerCase().split(/\s+/)[0] ?? '';
  if (!token) return 'plaintext';
  return CODE_LANG_ALIAS[token] ?? token;
}

let registeredMonacoLangs: Set<string> | null = null;
function getRegisteredMonacoLangs(): Set<string> {
  if (!registeredMonacoLangs) {
    registeredMonacoLangs = new Set(monaco.languages.getLanguages().map((l) => l.id));
  }
  return registeredMonacoLangs;
}

const MAX_COLORIZE_CACHE = 200;
const colorizeCache = new Map<string, string>();

function cacheColorized(key: string, html: string) {
  if (colorizeCache.has(key)) colorizeCache.delete(key);
  colorizeCache.set(key, html);
  if (colorizeCache.size > MAX_COLORIZE_CACHE) {
    const oldest = colorizeCache.keys().next().value;
    if (oldest !== undefined) colorizeCache.delete(oldest);
  }
}

export async function colorizeCodeBlock(
  code: string,
  rawLang: string,
  theme: ThemeName,
  tabSize: number,
): Promise<string | null> {
  const lang = normalizeCodeLang(rawLang);
  if (lang === 'plaintext' || !getRegisteredMonacoLangs().has(lang)) {
    return null;
  }
  const cacheKey = `${theme}:${lang}:${tabSize}:${code}`;
  const cached = colorizeCache.get(cacheKey);
  if (cached !== undefined) {
    colorizeCache.delete(cacheKey);
    colorizeCache.set(cacheKey, cached);
    return cached;
  }
  try {
    const rawHtml = await monaco.editor.colorize(code, lang, { tabSize });
    const trimmed = rawHtml.replace(/(?:<br\s*\/?>)+$/i, '');
    cacheColorized(cacheKey, trimmed);
    return trimmed;
  } catch {
    return null;
  }
}
