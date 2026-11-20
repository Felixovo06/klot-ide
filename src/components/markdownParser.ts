// 零依赖 GFM + README 安全 HTML Markdown 解析器（保留 1-based 源码行号与标题锚点）

export type TableAlign = 'left' | 'center' | 'right' | null;
export type CalloutKind = 'note' | 'tip' | 'important' | 'warning' | 'caution';
export type TextAlign = 'left' | 'center' | 'right';

export interface MarkdownHeadingInfo {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  id: string;
  line: number;
}

export interface MarkdownFootnote {
  id: string;
  index: number;
  blocks: MarkdownBlock[];
}

export type MarkdownInline =
  | { type: 'text'; text: string }
  | { type: 'softbreak' }
  | { type: 'hardbreak' }
  | { type: 'code'; text: string }
  | { type: 'strong'; children: MarkdownInline[] }
  | { type: 'em'; children: MarkdownInline[] }
  | { type: 'del'; children: MarkdownInline[] }
  | { type: 'kbd'; text: string }
  | { type: 'mark'; children: MarkdownInline[] }
  | { type: 'sub'; children: MarkdownInline[] }
  | { type: 'sup'; children: MarkdownInline[] }
  | { type: 'link'; href: string; title?: string; children: MarkdownInline[] }
  | { type: 'image'; src: string; alt: string; title?: string; width?: string; height?: string }
  | { type: 'footnote_ref'; id: string; index: number };

export interface MarkdownListItem {
  checked: boolean | null;
  line: number;
  blocks: MarkdownBlock[];
}

export type MarkdownBlock =
  | {
      type: 'heading';
      level: 1 | 2 | 3 | 4 | 5 | 6;
      id: string;
      children: MarkdownInline[];
      startLine: number;
      endLine: number;
    }
  | {
      type: 'paragraph';
      align?: TextAlign;
      children: MarkdownInline[];
      startLine: number;
      endLine: number;
    }
  | {
      type: 'code_block';
      lang: string;
      code: string;
      startLine: number;
      endLine: number;
    }
  | {
      type: 'blockquote';
      callout?: CalloutKind;
      blocks: MarkdownBlock[];
      startLine: number;
      endLine: number;
    }
  | {
      type: 'list';
      ordered: boolean;
      start: number;
      tight: boolean;
      items: MarkdownListItem[];
      startLine: number;
      endLine: number;
    }
  | {
      type: 'table';
      alignments: TableAlign[];
      headers: MarkdownInline[][];
      rows: MarkdownInline[][][];
      startLine: number;
      endLine: number;
    }
  | {
      type: 'hr';
      startLine: number;
      endLine: number;
    }
  | {
      type: 'html_container';
      align?: TextAlign;
      blocks: MarkdownBlock[];
      startLine: number;
      endLine: number;
    }
  | {
      type: 'details';
      summary: MarkdownInline[];
      open: boolean;
      blocks: MarkdownBlock[];
      startLine: number;
      endLine: number;
    }
  | {
      type: 'image_block';
      src: string;
      alt: string;
      title?: string;
      width?: string;
      height?: string;
      align?: TextAlign;
      startLine: number;
      endLine: number;
    };

export interface MarkdownDocument {
  frontmatter: Array<{ key: string; value: string }> | null;
  blocks: MarkdownBlock[];
  headings: MarkdownHeadingInfo[];
  footnotes: MarkdownFootnote[];
}

export type HrefClassification =
  | { kind: 'anchor'; href: string; anchor: string }
  | { kind: 'external'; href: string }
  | { kind: 'workspace'; href: string }
  | { kind: 'unsafe'; href: string };

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  mdash: '\u2014',
  ndash: '\u2013',
  hellip: '\u2026',
  copy: '\u00a9',
  reg: '\u00ae',
  trade: '\u2122',
  middot: '\u00b7',
  laquo: '\u00ab',
  raquo: '\u00bb',
};

export function decodeHtmlEntities(input: string): string {
  return input.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (full, ent: string) => {
    if (ent.startsWith('#x') || ent.startsWith('#X')) {
      const cp = Number.parseInt(ent.slice(2), 16);
      if (Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff) return String.fromCodePoint(cp);
      return full;
    }
    if (ent.startsWith('#')) {
      const cp = Number.parseInt(ent.slice(1), 10);
      if (Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff) return String.fromCodePoint(cp);
      return full;
    }
    return NAMED_ENTITIES[ent.toLowerCase()] ?? full;
  });
}

export function slugifyHeading(text: string): string {
  const base = text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .replace(/\s/g, '-');
  return base;
}

export function classifyHref(rawHref: string): HrefClassification {
  const href = decodeHtmlEntities(rawHref).trim();
  if (!href) return { kind: 'unsafe', href: '' };
  if (href.startsWith('#')) {
    let anchor = href.slice(1);
    try {
      anchor = decodeURIComponent(anchor);
    } catch {
      // 保留原始锚点
    }
    return { kind: 'anchor', href, anchor };
  }
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(href);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme === 'http' || scheme === 'https' || scheme === 'mailto') {
      return { kind: 'external', href };
    }
    return { kind: 'unsafe', href };
  }
  if (href.startsWith('//')) {
    return { kind: 'external', href: `https:${href}` };
  }
  return { kind: 'workspace', href };
}

export function isSafeImageDataUrl(src: string): boolean {
  return /^data:image\/(?:png|jpeg|jpg|gif|webp|bmp|x-icon|avif);base64,[a-zA-Z0-9+/=]+$/i.test(src.trim());
}

export function inlineToPlainText(nodes: MarkdownInline[]): string {
  let out = '';
  for (const n of nodes) {
    switch (n.type) {
      case 'text':
      case 'code':
      case 'kbd':
        out += n.text;
        break;
      case 'softbreak':
      case 'hardbreak':
        out += ' ';
        break;
      case 'image':
        out += n.alt;
        break;
      case 'footnote_ref':
        out += `[${n.index}]`;
        break;
      default:
        out += inlineToPlainText(n.children);
        break;
    }
  }
  return out;
}

interface RefDef {
  href: string;
  title?: string;
}

interface ParseContext {
  refs: Map<string, RefDef>;
  footnoteOrder: Map<string, number>;
  footnoteRawLines: Map<string, { lines: string[]; baseLine: number }>;
  headings: MarkdownHeadingInfo[];
  slugCounts: Map<string, number>;
  skipLines: Set<number>;
}

function registerHeading(ctx: ParseContext, level: 1 | 2 | 3 | 4 | 5 | 6, children: MarkdownInline[], line: number): string {
  const text = inlineToPlainText(children).trim();
  const base = slugifyHeading(text) || `section-${ctx.headings.length + 1}`;
  const count = ctx.slugCounts.get(base) ?? 0;
  ctx.slugCounts.set(base, count + 1);
  const id = count === 0 ? base : `${base}-${count}`;
  ctx.headings.push({ level, text: text || id, id, line });
  return id;
}

function getFootnoteIndex(ctx: ParseContext, rawId: string): number | null {
  const key = rawId.trim();
  if (!ctx.footnoteRawLines.has(key)) return null;
  const existing = ctx.footnoteOrder.get(key);
  if (existing !== undefined) return existing;
  const next = ctx.footnoteOrder.size + 1;
  ctx.footnoteOrder.set(key, next);
  return next;
}

// ==================== HTML 属性解析 ====================

function parseHtmlAttributes(attrText: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrText)) !== null) {
    const name = m[1].toLowerCase();
    const val = m[2] ?? m[3] ?? m[4] ?? '';
    attrs[name] = decodeHtmlEntities(val);
  }
  return attrs;
}

function normalizeAlign(raw?: string): TextAlign | undefined {
  const v = raw?.trim().toLowerCase();
  if (v === 'left' || v === 'center' || v === 'right') return v;
  return undefined;
}

function sanitizeDimension(raw?: string): string | undefined {
  if (!raw) return undefined;
  const t = raw.trim();
  if (/^\d+(?:px|%)?$/i.test(t)) return /^\d+$/.test(t) ? `${t}px` : t;
  return undefined;
}

// ==================== 行内解析 ====================

const ESCAPABLE = new Set('\\`*_{}[]()#+-.!|>~');

function findBalancedParenEnd(src: string, openParenIdx: number): number {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = openParenIdx; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '\\' && i + 1 < src.length) {
      i += 1;
      continue;
    }
    if (!inSingle && ch === '"') {
      inDouble = !inDouble;
      continue;
    }
    if (!inDouble && ch === "'") {
      inSingle = !inSingle;
      continue;
    }
    if (inSingle || inDouble) continue;
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function parseLinkDestinationAndTitle(raw: string): { href: string; title?: string } | null {
  const s = raw.trim();
  if (!s) return { href: '' };
  let href = '';
  let rest = '';
  if (s.startsWith('<')) {
    const close = s.indexOf('>');
    if (close < 0) return null;
    href = s.slice(1, close).trim();
    rest = s.slice(close + 1).trim();
  } else {
    const sp = /\s/.exec(s);
    if (sp) {
      href = s.slice(0, sp.index);
      rest = s.slice(sp.index).trim();
    } else {
      href = s;
    }
  }
  let title: string | undefined;
  if (rest) {
    const tm = /^(?:"([^"]*)"|'([^']*)'|\(([^)]*)\))$/.exec(rest);
    if (tm) title = decodeHtmlEntities(tm[1] ?? tm[2] ?? tm[3] ?? '');
  }
  href = href.replace(/\\([\\()[\]])/g, '$1');
  return { href: decodeHtmlEntities(href), title };
}

function findClosingBracket(src: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '\\' && i + 1 < src.length) {
      i += 1;
      continue;
    }
    if (ch === '`') {
      let tickLen = 1;
      while (i + tickLen < src.length && src[i + tickLen] === '`') tickLen += 1;
      const closeTick = findClosingBackticks(src, i + tickLen, tickLen);
      if (closeTick >= 0) {
        i = closeTick + tickLen - 1;
        continue;
      }
      i += tickLen - 1;
      continue;
    }
    if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findClosingBackticks(src: string, from: number, count: number): number {
  let i = from;
  while (i < src.length) {
    if (src[i] === '`') {
      let len = 1;
      while (i + len < src.length && src[i + len] === '`') len += 1;
      if (len === count) return i;
      i += len;
    } else {
      i += 1;
    }
  }
  return -1;
}

function isWordChar(ch: string | undefined): boolean {
  return Boolean(ch && /[\p{L}\p{N}_]/u.test(ch));
}

function findClosingDelimiter(
  src: string,
  from: number,
  marker: string,
  wordBoundaryUnderscore: boolean,
): number {
  const len = marker.length;
  for (let i = from; i <= src.length - len; i += 1) {
    if (src[i] === '\\' && i + 1 < src.length) {
      i += 1;
      continue;
    }
    if (src[i] === '`') {
      let tickLen = 1;
      while (i + tickLen < src.length && src[i + tickLen] === '`') tickLen += 1;
      const closeTick = findClosingBackticks(src, i + tickLen, tickLen);
      if (closeTick >= 0) {
        i = closeTick + tickLen - 1;
        continue;
      }
      i += tickLen - 1;
      continue;
    }
    if (src.startsWith(marker, i)) {
      const prev = src[i - 1];
      const next = src[i + len];
      if (prev && /\s/.test(prev)) continue;
      if (marker === '*' && len === 1 && src[i + 1] === '*') {
        // 遇到 ** 时跳过，避免在 *a **b** c* 中提前关闭
        i += 1;
        continue;
      }
      if (wordBoundaryUnderscore && isWordChar(next)) continue;
      return i;
    }
  }
  return -1;
}

const ALLOWED_INLINE_TAGS = new Set([
  'a',
  'img',
  'br',
  'code',
  'strong',
  'b',
  'em',
  'i',
  'del',
  's',
  'kbd',
  'sub',
  'sup',
  'mark',
]);

const SKIPPED_HTML_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed']);

function pushText(out: MarkdownInline[], text: string) {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.type === 'text') last.text += text;
  else out.push({ type: 'text', text });
}

export function parseInline(src: string, ctx: ParseContext): MarkdownInline[] {
  const out: MarkdownInline[] = [];
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

    // 1. 换行符（尾随两空格或 \ 为硬换行）
    if (ch === '\n') {
      const prev = out[out.length - 1];
      if (prev && prev.type === 'text' && /(?: {2,}|\\)$/.test(prev.text)) {
        prev.text = prev.text.replace(/(?: {2,}|\\)$/, '');
        if (!prev.text) out.pop();
        out.push({ type: 'hardbreak' });
      } else {
        out.push({ type: 'softbreak' });
      }
      i += 1;
      continue;
    }

    // 2. 反斜杠转义
    if (ch === '\\' && i + 1 < src.length) {
      const next = src[i + 1];
      if (next === '\n') {
        out.push({ type: 'hardbreak' });
        i += 2;
        continue;
      }
      if (ESCAPABLE.has(next)) {
        pushText(out, next);
        i += 2;
        continue;
      }
    }

    // 3. 行内代码（支持多反引号）
    if (ch === '`') {
      let len = 1;
      while (i + len < src.length && src[i + len] === '`') len += 1;
      const close = findClosingBackticks(src, i + len, len);
      if (close >= 0) {
        let code = src.slice(i + len, close).replace(/\n/g, ' ');
        if (code.length >= 2 && code.startsWith(' ') && code.endsWith(' ') && /[^ ]/.test(code)) {
          code = code.slice(1, -1);
        }
        out.push({ type: 'code', text: code });
        i = close + len;
        continue;
      }
      pushText(out, '`'.repeat(len));
      i += len;
      continue;
    }

    // 4. 图片 ![alt](src "title") 或 ![alt][ref]
    if (ch === '!' && src[i + 1] === '[') {
      const closeBracket = findClosingBracket(src, i + 1);
      if (closeBracket >= 0) {
        const alt = src.slice(i + 2, closeBracket);
        if (src[closeBracket + 1] === '(') {
          const closeParen = findBalancedParenEnd(src, closeBracket + 1);
          if (closeParen >= 0) {
            const parsed = parseLinkDestinationAndTitle(src.slice(closeBracket + 2, closeParen));
            if (parsed) {
              out.push({ type: 'image', src: parsed.href, alt: decodeHtmlEntities(alt), title: parsed.title });
              i = closeParen + 1;
              continue;
            }
          }
        } else if (src[closeBracket + 1] === '[') {
          const refClose = src.indexOf(']', closeBracket + 2);
          if (refClose >= 0) {
            const refKey = (src.slice(closeBracket + 2, refClose) || alt).trim().toLowerCase();
            const def = ctx.refs.get(refKey);
            if (def) {
              out.push({ type: 'image', src: def.href, alt: decodeHtmlEntities(alt), title: def.title });
              i = refClose + 1;
              continue;
            }
          }
        }
      }
    }

    // 5. 脚注引用 [^id] 与链接 [text](href) / [text][ref]
    if (ch === '[') {
      if (src[i + 1] === '^') {
        const fnEnd = /^\[\^([^\s\]]+)\]/.exec(src.slice(i));
        if (fnEnd) {
          const idx = getFootnoteIndex(ctx, fnEnd[1]);
          if (idx !== null) {
            out.push({ type: 'footnote_ref', id: fnEnd[1], index: idx });
            i += fnEnd[0].length;
            continue;
          }
        }
      }
      const closeBracket = findClosingBracket(src, i);
      if (closeBracket >= 0) {
        const inner = src.slice(i + 1, closeBracket);
        if (src[closeBracket + 1] === '(') {
          const closeParen = findBalancedParenEnd(src, closeBracket + 1);
          if (closeParen >= 0) {
            const parsed = parseLinkDestinationAndTitle(src.slice(closeBracket + 2, closeParen));
            if (parsed) {
              out.push({
                type: 'link',
                href: parsed.href,
                title: parsed.title,
                children: parseInline(inner, ctx),
              });
              i = closeParen + 1;
              continue;
            }
          }
        } else if (src[closeBracket + 1] === '[') {
          const refClose = src.indexOf(']', closeBracket + 2);
          if (refClose >= 0) {
            const refKey = (src.slice(closeBracket + 2, refClose) || inner).trim().toLowerCase();
            const def = ctx.refs.get(refKey);
            if (def) {
              out.push({
                type: 'link',
                href: def.href,
                title: def.title,
                children: parseInline(inner, ctx),
              });
              i = refClose + 1;
              continue;
            }
          }
        } else {
          // 简写引用链接 [ref]
          const refKey = inner.trim().toLowerCase();
          const def = ctx.refs.get(refKey);
          if (def && !inner.includes('\n')) {
            out.push({
              type: 'link',
              href: def.href,
              title: def.title,
              children: parseInline(inner, ctx),
            });
            i = closeBracket + 1;
            continue;
          }
        }
      }
    }

    // 6. HTML 注释 / 自动链接 <https://...> / 安全行内 HTML
    if (ch === '<') {
      if (src.startsWith('<!--', i)) {
        const endComment = src.indexOf('-->', i + 4);
        if (endComment >= 0) {
          i = endComment + 3;
          continue;
        }
      }
      const autoLink = /^<(https?:\/\/[^\s<>]+|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>/.exec(
        src.slice(i),
      );
      if (autoLink) {
        const target = autoLink[1];
        const href = target.includes('@') && !target.startsWith('http') ? `mailto:${target}` : target;
        out.push({ type: 'link', href, children: [{ type: 'text', text: target }] });
        i += autoLink[0].length;
        continue;
      }

      const tagMatch = /^<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*?)(\/?)>/.exec(src.slice(i));
      if (tagMatch) {
        const tag = tagMatch[1].toLowerCase();
        const attrRaw = tagMatch[2] ?? '';
        const selfClosing = tagMatch[3] === '/' || tag === 'br' || tag === 'img';
        const tagEnd = i + tagMatch[0].length;

        if (SKIPPED_HTML_TAGS.has(tag)) {
          if (!selfClosing) {
            const closeRe = new RegExp(`</${tag}\\s*>`, 'i');
            const cm = closeRe.exec(src.slice(tagEnd));
            i = cm ? tagEnd + cm.index + cm[0].length : tagEnd;
          } else {
            i = tagEnd;
          }
          continue;
        }

        if (ALLOWED_INLINE_TAGS.has(tag)) {
          const attrs = parseHtmlAttributes(attrRaw);
          if (tag === 'br') {
            out.push({ type: 'hardbreak' });
            i = tagEnd;
            continue;
          }
          if (tag === 'img') {
            if (attrs.src) {
              out.push({
                type: 'image',
                src: attrs.src,
                alt: attrs.alt ?? '',
                title: attrs.title,
                width: sanitizeDimension(attrs.width),
                height: sanitizeDimension(attrs.height),
              });
            }
            i = tagEnd;
            continue;
          }
          if (!selfClosing) {
            const closeRe = new RegExp(`</${tag}\\s*>`, 'i');
            const cm = closeRe.exec(src.slice(tagEnd));
            if (cm) {
              const innerHtml = src.slice(tagEnd, tagEnd + cm.index);
              const nextIdx = tagEnd + cm.index + cm[0].length;
              if (tag === 'a') {
                out.push({
                  type: 'link',
                  href: attrs.href ?? '',
                  title: attrs.title,
                  children: parseInline(innerHtml, ctx),
                });
              } else if (tag === 'code') {
                out.push({ type: 'code', text: decodeHtmlEntities(innerHtml) });
              } else if (tag === 'kbd') {
                out.push({ type: 'kbd', text: decodeHtmlEntities(innerHtml.replace(/<[^>]+>/g, '')) });
              } else if (tag === 'strong' || tag === 'b') {
                out.push({ type: 'strong', children: parseInline(innerHtml, ctx) });
              } else if (tag === 'em' || tag === 'i') {
                out.push({ type: 'em', children: parseInline(innerHtml, ctx) });
              } else if (tag === 'del' || tag === 's') {
                out.push({ type: 'del', children: parseInline(innerHtml, ctx) });
              } else if (tag === 'mark') {
                out.push({ type: 'mark', children: parseInline(innerHtml, ctx) });
              } else if (tag === 'sub') {
                out.push({ type: 'sub', children: parseInline(innerHtml, ctx) });
              } else if (tag === 'sup') {
                out.push({ type: 'sup', children: parseInline(innerHtml, ctx) });
              }
              i = nextIdx;
              continue;
            }
          }
        }
      }
    }

    // 7. 加粗 ** / __、删除线 ~~、斜体 * / _
    if ((ch === '*' && src[i + 1] === '*') || (ch === '_' && src[i + 1] === '_')) {
      const marker = src.slice(i, i + 2);
      const isUnderscore = ch === '_';
      const prev = src[i - 1];
      const next = src[i + 2];
      if (next && !/\s/.test(next) && (!isUnderscore || !isWordChar(prev))) {
        const close = findClosingDelimiter(src, i + 2, marker, isUnderscore);
        if (close > i + 2) {
          out.push({ type: 'strong', children: parseInline(src.slice(i + 2, close), ctx) });
          i = close + 2;
          continue;
        }
      }
    }

    if (ch === '~' && src[i + 1] === '~') {
      const next = src[i + 2];
      if (next && !/\s/.test(next)) {
        const close = findClosingDelimiter(src, i + 2, '~~', false);
        if (close > i + 2) {
          out.push({ type: 'del', children: parseInline(src.slice(i + 2, close), ctx) });
          i = close + 2;
          continue;
        }
      }
    }

    if (ch === '*' || ch === '_') {
      const isUnderscore = ch === '_';
      const prev = src[i - 1];
      const next = src[i + 1];
      if (next && !/\s/.test(next) && next !== ch && (!isUnderscore || !isWordChar(prev))) {
        const close = findClosingDelimiter(src, i + 1, ch, isUnderscore);
        if (close > i + 1) {
          out.push({ type: 'em', children: parseInline(src.slice(i + 1, close), ctx) });
          i = close + 1;
          continue;
        }
      }
    }

    // 8. 裸 URL 自动链接（GFM autolink）
    if (ch === 'h' && (src.startsWith('https://', i) || src.startsWith('http://', i))) {
      const prev = src[i - 1];
      if (!prev || /[\s([{'":,，。（]/.test(prev)) {
        const urlMatch = /^https?:\/\/[^\s<>)\]"']+/.exec(src.slice(i));
        if (urlMatch) {
          let url = urlMatch[0];
          while (/[.,;:!?'"）]。，；：！？]$/.test(url)) {
            url = url.slice(0, -1);
          }
          if (url.length > 8) {
            out.push({ type: 'link', href: url, children: [{ type: 'text', text: url }] });
            i += url.length;
            continue;
          }
        }
      }
    }

    // 9. 普通文本直到下一个特殊字符
    let nextSpecial = i + 1;
    while (nextSpecial < src.length) {
      const c = src[nextSpecial];
      if (
        c === '\n' ||
        c === '\\' ||
        c === '`' ||
        c === '!' ||
        c === '[' ||
        c === '<' ||
        c === '*' ||
        c === '_' ||
        c === '~' ||
        (c === 'h' && (src.startsWith('https://', nextSpecial) || src.startsWith('http://', nextSpecial)))
      ) {
        break;
      }
      nextSpecial += 1;
    }
    pushText(out, decodeHtmlEntities(src.slice(i, nextSpecial)));
    i = nextSpecial;
  }

  return out;
}

// ==================== 表格单元拆分 ====================

function hasClosingTicksAhead(line: string, startAfterOpen: number, len: number): boolean {
  return findClosingBackticks(line, startAfterOpen, len) >= 0;
}

export function splitTableCells(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|') && !trimmed.endsWith('\\|')) trimmed = trimmed.slice(0, -1);

  const cells: string[] = [];
  let buf = '';
  let inCodeTicks = 0;

  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (ch === '\\' && trimmed[i + 1] === '|') {
      buf += '|';
      i += 1;
      continue;
    }
    if (ch === '`') {
      let tickLen = 1;
      while (i + tickLen < trimmed.length && trimmed[i + tickLen] === '`') tickLen += 1;
      if (inCodeTicks === 0 && hasClosingTicksAhead(trimmed, i + tickLen, tickLen)) {
        inCodeTicks = tickLen;
      } else if (inCodeTicks === tickLen) {
        inCodeTicks = 0;
      }
      buf += '`'.repeat(tickLen);
      i += tickLen - 1;
      continue;
    }
    if (ch === '|' && inCodeTicks === 0) {
      cells.push(buf.trim());
      buf = '';
      continue;
    }
    buf += ch;
  }
  cells.push(buf.trim());
  return cells;
}

function parseTableAlignments(line: string): TableAlign[] | null {
  if (!line.includes('|') && !/^\s*:?-{1,}:?\s*$/.test(line)) return null;
  const cells = splitTableCells(line);
  if (cells.length === 0) return null;
  const aligns: TableAlign[] = [];
  for (const c of cells) {
    if (!/^:?-{1,}:?$/.test(c)) return null;
    const left = c.startsWith(':');
    const right = c.endsWith(':');
    aligns.push(left && right ? 'center' : right ? 'right' : left ? 'left' : null);
  }
  return aligns;
}

// ==================== 块级识别辅助 ====================

function isFenceOpen(line: string): { char: '`' | '~'; len: number; lang: string } | null {
  const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (!m) return null;
  const char = m[1][0] as '`' | '~';
  const rest = m[2];
  if (char === '`' && rest.includes('`')) return null;
  return { char, len: m[1].length, lang: rest.trim() };
}

function isFenceClose(line: string, char: '`' | '~', minLen: number): boolean {
  const m = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
  return Boolean(m && m[1][0] === char && m[1].length >= minLen);
}

function isHrLine(line: string): boolean {
  return /^ {0,3}(?:(\*[ \t]*){3,}|(-[ \t]*){3,}|(_[ \t]*){3,})$/.test(line);
}

function parseListStart(line: string): {
  ordered: boolean;
  start: number;
  markerIndent: number;
  contentIndent: number;
  text: string;
} | null {
  const m = /^( *)([-*+]|(\d{1,9})[.)])( +|\t)(.*)$/.exec(line);
  if (!m) return null;
  const markerIndent = m[1].length;
  if (markerIndent > 3) return null;
  const ordered = Boolean(m[3]);
  const start = ordered ? Number.parseInt(m[3], 10) : 1;
  const spaceLen = m[4].replace(/\t/g, '    ').length;
  const contentIndent = markerIndent + m[2].length + Math.min(spaceLen, 4);
  return { ordered, start, markerIndent, contentIndent, text: m[5] };
}

function isBlockStarter(lines: string[], idx: number): boolean {
  const line = lines[idx];
  if (!line.trim()) return true;
  if (isFenceOpen(line)) return true;
  if (/^ {0,3}(#{1,6})(?:[ \t]+|$)/.test(line)) return true;
  if (/^ {0,3}>/.test(line)) return true;
  if (isHrLine(line)) return true;
  if (parseListStart(line)) return true;
  if (line.includes('|') && idx + 1 < lines.length && parseTableAlignments(lines[idx + 1])) return true;
  if (/^ {0,3}<(?:div|details|h[1-6]|p|img|hr|!--)\b/i.test(line)) return true;
  return false;
}

// ==================== 预扫描 Frontmatter / 引用 / 脚注 ====================

function parseFrontmatter(lines: string[]): {
  entries: Array<{ key: string; value: string }>;
  nextIdx: number;
} | null {
  if (lines.length < 3 || lines[0].trim() !== '---') return null;
  const limit = Math.min(lines.length, 100);
  let closeIdx = -1;
  for (let i = 1; i < limit; i += 1) {
    const t = lines[i].trim();
    if (t === '---' || t === '...') {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx <= 1) return null;

  const entries: Array<{ key: string; value: string }> = [];
  for (let i = 1; i < closeIdx; i += 1) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const kv = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) {
      if (/^\s+/.test(line) && entries.length > 0) {
        const last = entries[entries.length - 1];
        const extra = line.trim().replace(/^-\s*/, '');
        last.value = last.value ? `${last.value}, ${extra}` : extra;
        continue;
      }
      return null;
    }
    entries.push({ key: kv[1], value: kv[2].trim().replace(/^['"]|['"]$/g, '') });
  }
  return entries.length > 0 ? { entries, nextIdx: closeIdx + 1 } : null;
}

function prescanDefinitions(lines: string[], startIdx: number, ctx: ParseContext) {
  let i = startIdx;
  let fence: { char: '`' | '~'; len: number } | null = null;

  while (i < lines.length) {
    const line = lines[i];
    if (fence) {
      if (isFenceClose(line, fence.char, fence.len)) fence = null;
      i += 1;
      continue;
    }
    const open = isFenceOpen(line);
    if (open) {
      fence = { char: open.char, len: open.len };
      i += 1;
      continue;
    }

    const fnMatch = /^ {0,3}\[\^([^\s\]]+)\]:[ \t]*(.*)$/.exec(line);
    if (fnMatch) {
      const id = fnMatch[1];
      const baseLine = i + 1;
      const bodyLines = [fnMatch[2]];
      ctx.skipLines.add(i);
      i += 1;
      while (i < lines.length) {
        const next = lines[i];
        if (!next.trim()) {
          if (i + 1 < lines.length && /^(?: {2,}|\t)/.test(lines[i + 1])) {
            bodyLines.push('');
            ctx.skipLines.add(i);
            i += 1;
            continue;
          }
          break;
        }
        if (/^(?: {2,}|\t)/.test(next)) {
          bodyLines.push(next.replace(/^(?: {1,4}|\t)/, ''));
          ctx.skipLines.add(i);
          i += 1;
          continue;
        }
        break;
      }
      ctx.footnoteRawLines.set(id, { lines: bodyLines, baseLine });
      continue;
    }

    const refMatch = /^ {0,3}\[([^\]]+)\]:[ \t]*(.+)$/.exec(line);
    if (refMatch) {
      const parsed = parseLinkDestinationAndTitle(refMatch[2]);
      if (parsed && parsed.href) {
        ctx.refs.set(refMatch[1].trim().toLowerCase(), parsed);
        ctx.skipLines.add(i);
      }
    }
    i += 1;
  }
}

// ==================== 安全 HTML 块解析 ====================

function collectHtmlBlockUntil(
  lines: string[],
  startIdx: number,
  tagName: string,
): { innerLines: string[]; baseLine: number; endIdx: number } | null {
  const openRe = new RegExp(`<${tagName}\\b[^>]*>`, 'gi');
  const closeRe = new RegExp(`</${tagName}\\s*>`, 'gi');

  let depth = 0;
  let firstOpenEnd = -1;
  let lastCloseStart = -1;
  let endIdx = -1;

  for (let i = startIdx; i < lines.length; i += 1) {
    const line = lines[i];
    const events: Array<{ pos: number; end: number; delta: number }> = [];
    openRe.lastIndex = 0;
    let om: RegExpExecArray | null;
    while ((om = openRe.exec(line)) !== null) {
      if (!om[0].endsWith('/>')) {
        events.push({ pos: om.index, end: om.index + om[0].length, delta: 1 });
      }
    }
    closeRe.lastIndex = 0;
    let cm: RegExpExecArray | null;
    while ((cm = closeRe.exec(line)) !== null) {
      events.push({ pos: cm.index, end: cm.index + cm[0].length, delta: -1 });
    }
    events.sort((a, b) => a.pos - b.pos);

    for (const ev of events) {
      if (depth === 0 && ev.delta > 0 && firstOpenEnd < 0 && i === startIdx) {
        firstOpenEnd = ev.end;
      }
      depth += ev.delta;
      if (depth === 0 && ev.delta < 0) {
        lastCloseStart = ev.pos;
        endIdx = i;
        break;
      }
    }
    if (endIdx >= 0) break;
  }

  if (endIdx < 0 || firstOpenEnd < 0) return null;

  const innerLines: string[] = [];
  if (endIdx === startIdx) {
    const inside = lines[startIdx].slice(firstOpenEnd, lastCloseStart);
    if (inside.trim()) innerLines.push(inside);
    return { innerLines, baseLine: startIdx + 1, endIdx };
  }

  const headTail = lines[startIdx].slice(firstOpenEnd);
  if (headTail.trim()) innerLines.push(headTail);
  for (let i = startIdx + 1; i < endIdx; i += 1) {
    innerLines.push(lines[i]);
  }
  const footHead = lines[endIdx].slice(0, lastCloseStart);
  if (footHead.trim()) innerLines.push(footHead);

  return {
    innerLines,
    baseLine: headTail.trim() ? startIdx + 1 : startIdx + 2,
    endIdx,
  };
}

function tryParseSafeHtmlBlock(
  lines: string[],
  idx: number,
  baseLine: number,
  ctx: ParseContext,
): { block: MarkdownBlock | null; nextIdx: number } | null {
  const line = lines[idx];
  const trimmed = line.trim();

  // HTML 注释 <!-- ... -->
  if (trimmed.startsWith('<!--')) {
    let j = idx;
    while (j < lines.length && !lines[j].includes('-->')) j += 1;
    return { block: null, nextIdx: Math.min(j + 1, lines.length) };
  }

  // <hr /> / <hr>
  if (/^<hr\s*\/?>$/i.test(trimmed)) {
    return {
      block: { type: 'hr', startLine: baseLine + idx, endLine: baseLine + idx },
      nextIdx: idx + 1,
    };
  }

  // <div ...>...</div>
  const divOpen = /^<div\b([^>]*)>/i.exec(trimmed);
  if (divOpen) {
    const collected = collectHtmlBlockUntil(lines, idx, 'div');
    if (collected) {
      const attrs = parseHtmlAttributes(divOpen[1]);
      const innerBlocks = parseBlocks(collected.innerLines, baseLine + collected.baseLine - 1, ctx);
      return {
        block: {
          type: 'html_container',
          align: normalizeAlign(attrs.align),
          blocks: innerBlocks,
          startLine: baseLine + idx,
          endLine: baseLine + collected.endIdx,
        },
        nextIdx: collected.endIdx + 1,
      };
    }
  }

  // <details [open]>...</details>
  const detailsOpen = /^<details\b([^>]*)>/i.exec(trimmed);
  if (detailsOpen) {
    const collected = collectHtmlBlockUntil(lines, idx, 'details');
    if (collected) {
      const attrs = parseHtmlAttributes(detailsOpen[1]);
      const joined = collected.innerLines.join('\n');
      const sumMatch = /<summary\b[^>]*>([\s\S]*?)<\/summary>/i.exec(joined);
      const summaryText = sumMatch ? sumMatch[1].trim() : 'Details';
      const bodyStr = sumMatch
        ? `${joined.slice(0, sumMatch.index)}\n${joined.slice(sumMatch.index + sumMatch[0].length)}`
        : joined;
      const bodyLines = bodyStr.split('\n');
      const innerBlocks = parseBlocks(bodyLines, baseLine + collected.baseLine - 1, ctx);
      return {
        block: {
          type: 'details',
          summary: parseInline(summaryText, ctx),
          open: 'open' in attrs,
          blocks: innerBlocks,
          startLine: baseLine + idx,
          endLine: baseLine + collected.endIdx,
        },
        nextIdx: collected.endIdx + 1,
      };
    }
  }

  // <h1>...</h1> ~ <h6>...</h6>
  const headingMatch = /^<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>$/i.exec(trimmed);
  if (headingMatch) {
    const level = Number(headingMatch[1]) as 1 | 2 | 3 | 4 | 5 | 6;
    const children = parseInline(headingMatch[3].trim(), ctx);
    const id = registerHeading(ctx, level, children, baseLine + idx);
    return {
      block: { type: 'heading', level, id, children, startLine: baseLine + idx, endLine: baseLine + idx },
      nextIdx: idx + 1,
    };
  }

  // 单独块级 <img ... />
  const imgMatch = /^<img\b([^>]*?)\/?>$/i.exec(trimmed);
  if (imgMatch) {
    const attrs = parseHtmlAttributes(imgMatch[1]);
    if (attrs.src) {
      return {
        block: {
          type: 'image_block',
          src: attrs.src,
          alt: attrs.alt ?? '',
          title: attrs.title,
          width: sanitizeDimension(attrs.width),
          height: sanitizeDimension(attrs.height),
          align: normalizeAlign(attrs.align),
          startLine: baseLine + idx,
          endLine: baseLine + idx,
        },
        nextIdx: idx + 1,
      };
    }
  }

  // <p ...>...</p>（支持多行段落）
  const pOpen = /^<p\b([^>]*)>/i.exec(trimmed);
  if (pOpen) {
    const collected = collectHtmlBlockUntil(lines, idx, 'p');
    if (collected) {
      const attrs = parseHtmlAttributes(pOpen[1]);
      const content = collected.innerLines.map((l) => l.trim()).join('\n');
      return {
        block: {
          type: 'paragraph',
          align: normalizeAlign(attrs.align),
          children: parseInline(content, ctx),
          startLine: baseLine + idx,
          endLine: baseLine + collected.endIdx,
        },
        nextIdx: collected.endIdx + 1,
      };
    }
  }

  return null;
}

// ==================== 块级解析主循环 ====================

const CALLOUT_MAP: Record<string, CalloutKind> = {
  NOTE: 'note',
  TIP: 'tip',
  IMPORTANT: 'important',
  WARNING: 'warning',
  CAUTION: 'caution',
};

function extractBlockquoteCallout(blocks: MarkdownBlock[]): { callout?: CalloutKind; blocks: MarkdownBlock[] } {
  if (blocks.length === 0) return { blocks };
  const first = blocks[0];
  if (first.type !== 'paragraph' || first.children.length === 0) return { blocks };
  const firstInline = first.children[0];
  if (firstInline.type !== 'text') return { blocks };
  const m = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(.*)$/.exec(firstInline.text);
  if (!m) return { blocks };

  const callout = CALLOUT_MAP[m[1]];
  const restFirstText = m[2];
  const nextChildren = [...first.children];
  if (restFirstText) {
    nextChildren[0] = { type: 'text', text: restFirstText };
  } else {
    nextChildren.shift();
    if (nextChildren[0]?.type === 'softbreak' || nextChildren[0]?.type === 'hardbreak') {
      nextChildren.shift();
    }
  }

  if (nextChildren.length === 0) {
    return { callout, blocks: blocks.slice(1) };
  }
  return {
    callout,
    blocks: [{ ...first, children: nextChildren }, ...blocks.slice(1)],
  };
}

function parseBlocks(lines: string[], baseLine: number, ctx: ParseContext, skipGlobal = false): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    if (skipGlobal && ctx.skipLines.has(i)) {
      i += 1;
      continue;
    }

    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }

    // 1. 围栏代码块
    const fence = isFenceOpen(line);
    if (fence) {
      const startLine = baseLine + i;
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !isFenceClose(lines[i], fence.char, fence.len)) {
        body.push(lines[i]);
        i += 1;
      }
      const endLine = i < lines.length ? baseLine + i : baseLine + lines.length - 1;
      if (i < lines.length) i += 1;
      blocks.push({
        type: 'code_block',
        lang: fence.lang,
        code: body.join('\n'),
        startLine,
        endLine,
      });
      continue;
    }

    // 2. ATX 标题
    const atx = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+[ \t]*)?$/.exec(line);
    if (atx && (!line.startsWith('#') || /^#{1,6}(?:[ \t]|$)/.test(line.trimStart()))) {
      const level = atx[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      const children = parseInline((atx[2] ?? '').trim(), ctx);
      const lineNum = baseLine + i;
      const id = registerHeading(ctx, level, children, lineNum);
      blocks.push({ type: 'heading', level, id, children, startLine: lineNum, endLine: lineNum });
      i += 1;
      continue;
    }

    // 3. 安全 HTML 块（含 <!-- 注释 -->、<div>、<details>、<h1..6>、<p>、<img>、<hr>）
    if (/^ {0,3}</.test(line)) {
      const htmlRes = tryParseSafeHtmlBlock(lines, i, baseLine, ctx);
      if (htmlRes) {
        if (htmlRes.block) blocks.push(htmlRes.block);
        i = htmlRes.nextIdx;
        continue;
      }
    }

    // 4. 分隔线（需在 Setext 检测前先判断，注意紧跟在段落后的 --- 会被段落分支处理为 Setext H2）
    if (isHrLine(line)) {
      const ln = baseLine + i;
      blocks.push({ type: 'hr', startLine: ln, endLine: ln });
      i += 1;
      continue;
    }

    // 5. GFM 表格
    if (line.includes('|') && i + 1 < lines.length) {
      const aligns = parseTableAlignments(lines[i + 1]);
      const headerCells = aligns ? splitTableCells(line) : null;
      if (aligns && headerCells && headerCells.length === aligns.length) {
        const startLine = baseLine + i;
        const headers = headerCells.map((c) => parseInline(c, ctx));
        i += 2;
        const rows: MarkdownInline[][][] = [];
        while (i < lines.length) {
          if (skipGlobal && ctx.skipLines.has(i)) break;
          const rowLine = lines[i];
          if (!rowLine.trim() || !rowLine.includes('|') || isBlockStarter(lines, i)) break;
          const rawCells = splitTableCells(rowLine);
          const normalized: MarkdownInline[][] = [];
          for (let col = 0; col < aligns.length; col += 1) {
            normalized.push(parseInline(rawCells[col] ?? '', ctx));
          }
          rows.push(normalized);
          i += 1;
        }
        blocks.push({
          type: 'table',
          alignments: aligns,
          headers,
          rows,
          startLine,
          endLine: baseLine + i - 1,
        });
        continue;
      }
    }

    // 6. 引用块 / GitHub Callouts
    if (/^ {0,3}>/.test(line)) {
      const startLine = baseLine + i;
      const innerLines: string[] = [];
      while (i < lines.length) {
        if (skipGlobal && ctx.skipLines.has(i)) break;
        const cur = lines[i];
        if (/^ {0,3}>/.test(cur)) {
          innerLines.push(cur.replace(/^ {0,3}> ?/, ''));
          i += 1;
        } else if (cur.trim() && innerLines.length > 0 && innerLines[innerLines.length - 1].trim() && !isBlockStarter(lines, i)) {
          innerLines.push(cur);
          i += 1;
        } else {
          break;
        }
      }
      const rawBlocks = parseBlocks(innerLines, startLine, ctx);
      const { callout, blocks: quoteBlocks } = extractBlockquoteCallout(rawBlocks);
      blocks.push({
        type: 'blockquote',
        callout,
        blocks: quoteBlocks,
        startLine,
        endLine: baseLine + i - 1,
      });
      continue;
    }

    // 7. 有序 / 无序列表与任务清单
    const listFirst = parseListStart(line);
    if (listFirst) {
      const startLine = baseLine + i;
      const ordered = listFirst.ordered;
      const startNum = listFirst.start;
      const listMarkerIndent = listFirst.markerIndent;
      const items: MarkdownListItem[] = [];
      let hasBlankBetweenItems = false;

      while (i < lines.length) {
        if (skipGlobal && ctx.skipLines.has(i)) break;
        const itemHeader = parseListStart(lines[i]);
        if (!itemHeader || itemHeader.ordered !== ordered || itemHeader.markerIndent > listMarkerIndent + 1) {
          break;
        }
        const itemStartLine = baseLine + i;
        let firstText = itemHeader.text;
        let checked: boolean | null = null;
        const taskMatch = /^\[([ xX])\](?:\s+(.*))?$/.exec(firstText);
        if (taskMatch) {
          checked = taskMatch[1].toLowerCase() === 'x';
          firstText = taskMatch[2] ?? '';
        }

        const itemLines: string[] = [firstText];
        const minChildIndent = Math.max(itemHeader.markerIndent + 2, 2);
        const stripIndent = itemHeader.contentIndent;
        i += 1;
        let endedWithBlank = false;

        while (i < lines.length) {
          if (skipGlobal && ctx.skipLines.has(i)) break;
          const next = lines[i];
          if (!next.trim()) {
            // 向前查看空行后是否仍属于当前列表项或下一个同级列表项
            let look = i + 1;
            while (look < lines.length && !lines[look].trim()) look += 1;
            if (look >= lines.length) {
              i = look;
              break;
            }
            const after = lines[look];
            const afterIndent = after.length - after.trimStart().length;
            if (afterIndent >= minChildIndent) {
              itemLines.push('');
              i += 1;
              continue;
            }
            const nextSibling = parseListStart(after);
            if (nextSibling && nextSibling.ordered === ordered && nextSibling.markerIndent <= listMarkerIndent + 1) {
              hasBlankBetweenItems = true;
              endedWithBlank = true;
              i = look;
              break;
            }
            i = look;
            break;
          }

          const nextIndent = next.length - next.trimStart().length;
          if (nextIndent >= minChildIndent) {
            const cut = Math.min(nextIndent, stripIndent);
            itemLines.push(next.slice(cut));
            i += 1;
            continue;
          }

          const sibling = parseListStart(next);
          if (sibling) {
            if (sibling.ordered === ordered && sibling.markerIndent <= listMarkerIndent + 1) {
              break;
            }
            break;
          }

          if (isBlockStarter(lines, i)) break;
          // 懒惰续行：仅当上一行非空且属于段落续行
          if (itemLines[itemLines.length - 1]?.trim()) {
            itemLines.push(next.trimStart());
            i += 1;
            continue;
          }
          break;
        }

        const itemBlocks = parseBlocks(itemLines, itemStartLine, ctx);
        items.push({ checked, line: itemStartLine, blocks: itemBlocks });
        if (endedWithBlank) continue;
      }

      blocks.push({
        type: 'list',
        ordered,
        start: startNum,
        tight: !hasBlankBetweenItems,
        items,
        startLine,
        endLine: baseLine + i - 1,
      });
      continue;
    }

    // 8. 段落与 Setext 标题（=== / ---）
    const startLine = baseLine + i;
    const paraLines: string[] = [line];
    i += 1;
    let setextLevel: 1 | 2 | null = null;
    while (i < lines.length) {
      if (skipGlobal && ctx.skipLines.has(i)) break;
      const cur = lines[i];
      if (!cur.trim()) break;
      if (/^ {0,3}=+[ \t]*$/.test(cur)) {
        setextLevel = 1;
        i += 1;
        break;
      }
      if (/^ {0,3}-+[ \t]*$/.test(cur) && paraLines.length === 1) {
        setextLevel = 2;
        i += 1;
        break;
      }
      if (isBlockStarter(lines, i)) break;
      paraLines.push(cur);
      i += 1;
    }

    if (setextLevel) {
      const children = parseInline(paraLines.join('\n').trim(), ctx);
      const id = registerHeading(ctx, setextLevel, children, startLine);
      blocks.push({
        type: 'heading',
        level: setextLevel,
        id,
        children,
        startLine,
        endLine: baseLine + i - 1,
      });
    } else {
      blocks.push({
        type: 'paragraph',
        children: parseInline(paraLines.join('\n'), ctx),
        startLine,
        endLine: baseLine + i - 1,
      });
    }
  }

  return blocks;
}

export function parseMarkdown(source: string): MarkdownDocument {
  const lines = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const fm = parseFrontmatter(lines);
  const startIdx = fm ? fm.nextIdx : 0;

  const ctx: ParseContext = {
    refs: new Map(),
    footnoteOrder: new Map(),
    footnoteRawLines: new Map(),
    headings: [],
    slugCounts: new Map(),
    skipLines: new Set(),
  };

  prescanDefinitions(lines, startIdx, ctx);
  const bodyLines = lines.slice(startIdx);
  // 将 skipLines 索引平移到 bodyLines 坐标
  if (startIdx > 0 && ctx.skipLines.size > 0) {
    const shifted = new Set<number>();
    for (const idx of ctx.skipLines) {
      if (idx >= startIdx) shifted.add(idx - startIdx);
    }
    ctx.skipLines = shifted;
  }

  const blocks = parseBlocks(bodyLines, startIdx + 1, ctx, true);

  const footnotes: MarkdownFootnote[] = [];
  for (const [id, index] of Array.from(ctx.footnoteOrder.entries()).sort((a, b) => a[1] - b[1])) {
    const raw = ctx.footnoteRawLines.get(id);
    if (!raw) continue;
    footnotes.push({
      id,
      index,
      blocks: parseBlocks(raw.lines, raw.baseLine, ctx),
    });
  }

  return {
    frontmatter: fm ? fm.entries : null,
    blocks,
    headings: ctx.headings,
    footnotes,
  };
}
