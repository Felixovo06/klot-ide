// Markdown 原生阅读模式渲染器：支持 GFM、代码块 Monaco 高亮、本地图片加载、大纲导航、交互复选框与 Lightbox
import {
  forwardRef,
  Fragment,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronRight,
  Copy,
  FileText,
  Flame,
  ImageOff,
  Info,
  Lightbulb,
  X,
  type LucideIcon,
} from 'lucide-react';
import { appOpenExternal } from '../lib/ipcClient';
import { useUiStore } from '../stores/uiStore';
import { debounce, isMarkdownPath, joinPath, resolveRelativePath } from '../stores/utils';
import { type OpenFileOptions, useWorkspaceStore } from '../stores/workspaceStore';
import {
  colorizeCodeBlock,
  loadLocalAssetDataUrl,
  subscribeAssetInvalidation,
} from './markdownAssets';
import {
  classifyHref,
  isSafeImageDataUrl,
  parseMarkdown,
  slugifyHeading,
  type CalloutKind,
  type MarkdownBlock,
  type MarkdownHeadingInfo,
  type MarkdownInline,
  type MarkdownListItem,
} from './markdownParser';
import { getFileModel, monaco } from './monacoSetup';
import { copyToClipboard, ICON_STROKE } from './ui';

export interface MarkdownReaderHandle {
  scrollToLine: (line: number, highlight?: boolean) => void;
  getTopVisibleLine: () => number;
  getScrollElement: () => HTMLDivElement | null;
}

export interface MarkdownReaderProps {
  path: string;
  fullPath: string;
  variant: 'read' | 'split';
  initialScrollLine?: number | null;
  onScroll?: () => void;
  onVisibleLineChange?: (line: number) => void;
}

const scrollCache = new Map<string, number>();

export function clearMarkdownScrollCache() {
  scrollCache.clear();
}

const CALLOUT_META: Record<CalloutKind, { label: string; icon: LucideIcon }> = {
  note: { label: 'Note', icon: Info },
  tip: { label: 'Tip', icon: Lightbulb },
  important: { label: 'Important', icon: AlertCircle },
  warning: { label: 'Warning', icon: AlertTriangle },
  caution: { label: 'Caution', icon: Flame },
};

function flashElement(el: HTMLElement) {
  el.classList.remove('is-flash');
  // 强制触发一次重排以重放高亮过渡
  void el.offsetWidth;
  el.classList.add('is-flash');
  window.setTimeout(() => {
    el.classList.remove('is-flash');
  }, 1300);
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const theme = useUiStore((s) => s.theme);
  const tabSize = useUiStore((s) => s.prefs.tabSize);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setHighlighted(null);
    void colorizeCodeBlock(code, lang, theme, tabSize).then((html) => {
      if (!cancelled) setHighlighted(html);
    });
    return () => {
      cancelled = true;
    };
  }, [code, lang, theme, tabSize]);

  const handleCopy = () => {
    copyToClipboard(code, '代码');
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="onyx-md-codeblock">
      <div className="onyx-md-code-head">
        <span className="onyx-md-code-lang">{lang || 'text'}</span>
        <button type="button" className="onyx-md-code-copy" title="复制代码" onClick={handleCopy}>
          {copied ? <Check size={12} strokeWidth={ICON_STROKE} /> : <Copy size={12} strokeWidth={ICON_STROKE} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre className="onyx-md-code-pre">
        {highlighted !== null ? (
          <code dangerouslySetInnerHTML={{ __html: highlighted }} />
        ) : (
          <code>{code}</code>
        )}
      </pre>
    </div>
  );
}

function MarkdownImage({
  src,
  alt,
  title,
  width,
  height,
  docPath,
  root,
  block,
  insideLink,
  onPreview,
}: {
  src: string;
  alt: string;
  title?: string;
  width?: string;
  height?: string;
  docPath: string;
  root: string;
  block?: boolean;
  insideLink?: boolean;
  onPreview: (img: { src: string; alt: string }) => void;
}) {
  const trimmed = src.trim();
  const isRemote = /^https?:\/\//i.test(trimmed);
  const isSafeData = isSafeImageDataUrl(trimmed);
  const rel = useMemo(
    () => (isRemote || isSafeData ? null : resolveRelativePath(docPath, trimmed)),
    [isRemote, isSafeData, docPath, trimmed],
  );
  const absPath = useMemo(() => (rel && root ? joinPath(root, rel) : null), [rel, root]);

  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [assetEpoch, setAssetEpoch] = useState(0);

  useEffect(() => subscribeAssetInvalidation(() => setAssetEpoch((n) => n + 1)), []);

  useEffect(() => {
    if (isRemote || isSafeData) {
      setFailed(false);
      return;
    }
    if (!absPath) {
      setLocalUrl(null);
      setFailed(true);
      return;
    }
    let cancelled = false;
    setFailed(false);
    void loadLocalAssetDataUrl(absPath).then((url) => {
      if (cancelled) return;
      if (url) {
        setLocalUrl(url);
      } else {
        setLocalUrl(null);
        setFailed(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isRemote, isSafeData, absPath, assetEpoch]);

  const resolvedSrc = isRemote || isSafeData ? trimmed : localUrl;
  const sizeStyle: CSSProperties = {};
  if (width) sizeStyle.width = width;
  if (height) sizeStyle.height = height;

  if (failed || (!isRemote && !isSafeData && !resolvedSrc)) {
    return (
      <span className={`onyx-md-img-fallback${block ? ' is-block' : ''}`} title={trimmed}>
        <ImageOff size={14} strokeWidth={ICON_STROKE} />
        <span>{alt || trimmed || '图片加载失败'}</span>
      </span>
    );
  }

  return (
    <img
      src={resolvedSrc ?? undefined}
      alt={alt}
      title={title}
      style={sizeStyle}
      className={block ? 'onyx-md-block-img' : 'onyx-md-inline-img'}
      onError={() => setFailed(true)}
      onClick={(e) => {
        if (insideLink || !resolvedSrc) return;
        e.stopPropagation();
        onPreview({ src: resolvedSrc, alt });
      }}
    />
  );
}

function headingChainAt(headings: MarkdownHeadingInfo[], activeId: string | null): string[] {
  if (!activeId || headings.length === 0) return [];
  const idx = headings.findIndex((h) => h.id === activeId);
  if (idx < 0) return [];
  const chain: string[] = [];
  let minLevel = Number.POSITIVE_INFINITY;
  for (let i = idx; i >= 0; i -= 1) {
    const h = headings[i];
    if (h.level < minLevel) {
      chain.unshift(h.text);
      minLevel = h.level;
      if (minLevel === 1) break;
    }
  }
  return chain;
}

function MarkdownOutline({
  headings,
  activeId,
  onSelect,
}: {
  headings: MarkdownHeadingInfo[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const minLevel = useMemo(
    () => headings.reduce((acc, h) => Math.min(acc, h.level), 6),
    [headings],
  );
  return (
    <aside className="onyx-md-outline" aria-label="文档目录">
      <div className="onyx-md-outline-title">Outline</div>
      <nav className="onyx-md-outline-list">
        {headings.map((h) => {
          const depth = Math.max(0, h.level - minLevel);
          const active = h.id === activeId;
          return (
            <button
              key={h.id}
              type="button"
              className={`onyx-md-outline-item${active ? ' is-active' : ''}`}
              style={{ paddingLeft: 10 + depth * 12 }}
              title={h.text}
              onClick={() => onSelect(h.id)}
            >
              <span className="onyx-md-outline-text">{h.text}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

export const MarkdownReader = forwardRef<MarkdownReaderHandle, MarkdownReaderProps>(function MarkdownReader(
  { path, fullPath, variant, initialScrollLine, onScroll, onVisibleLineChange },
  ref,
) {
  const root = useWorkspaceStore((s) => s.root);
  const reveal = useWorkspaceStore((s) => s.reveal);
  const prefs = useUiStore((s) => s.prefs);
  const outlineVisible = useUiStore((s) => s.markdownOutlineVisible);

  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [source, setSource] = useState<string>(() => getFileModel(fullPath)?.getValue() ?? '');
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const [wideEnough, setWideEnough] = useState(true);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);
  const initialLineRef = useRef(initialScrollLine);
  initialLineRef.current = initialScrollLine;

  // 订阅 Monaco TextModel 实时变更
  useEffect(() => {
    const model = getFileModel(fullPath);
    setSource(model?.getValue() ?? '');
    if (!model) return;
    const sync = debounce(() => {
      setSource(model.getValue());
    }, 100);
    const sub = model.onDidChangeContent(() => sync());
    return () => {
      sync.cancel();
      sub.dispose();
    };
  }, [fullPath]);

  const doc = useMemo(() => parseMarkdown(source), [source]);
  const headingsRef = useRef<MarkdownHeadingInfo[]>(doc.headings);
  headingsRef.current = doc.headings;

  // 监测阅读容器宽度决定是否显示右侧目录栏
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const check = () => setWideEnough(el.getBoundingClientRect().width >= 740);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 关闭 Lightbox 的 Esc 捕获
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setLightbox(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [lightbox]);

  const scrollToAnchor = useCallback(
    (rawAnchor: string) => {
      const container = scrollRef.current;
      if (!container || !rawAnchor) return;
      let target = rawAnchor;
      try {
        target = decodeURIComponent(rawAnchor);
      } catch {
        // 保持原始锚点
      }
      const slugFallback = slugifyHeading(target);
      const lower = target.toLowerCase();
      const headingEls = Array.from(container.querySelectorAll<HTMLElement>('[data-heading-id]'));
      const matched =
        headingEls.find((el) => el.dataset.headingId === target) ??
        headingEls.find((el) => el.dataset.headingId?.toLowerCase() === lower) ??
        (slugFallback
          ? headingEls.find((el) => el.dataset.headingId === slugFallback)
          : undefined);
      if (!matched) return;
      const cRect = container.getBoundingClientRect();
      const mRect = matched.getBoundingClientRect();
      const top = container.scrollTop + (mRect.top - cRect.top) - 18;
      container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      flashElement(matched);
    },
    [],
  );

  const scrollToLine = useCallback((line: number, highlight = false) => {
    const container = scrollRef.current;
    if (!container) return;
    const els = Array.from(container.querySelectorAll<HTMLElement>('[data-source-line]'));
    if (els.length === 0) return;
    let best: HTMLElement = els[0];
    let bestLine = -1;
    for (const el of els) {
      const elLine = Number(el.dataset.sourceLine);
      if (!Number.isFinite(elLine)) continue;
      if (elLine <= line && elLine >= bestLine) {
        best = el;
        bestLine = elLine;
      }
    }
    const cRect = container.getBoundingClientRect();
    const bRect = best.getBoundingClientRect();
    const nextTop = Math.max(0, container.scrollTop + (bRect.top - cRect.top) - 16);
    if (highlight) {
      container.scrollTo({ top: nextTop, behavior: 'smooth' });
      flashElement(best);
    } else {
      container.scrollTop = nextTop;
    }
  }, []);

  const getTopVisibleLine = useCallback((): number => {
    const container = scrollRef.current;
    if (!container) return 1;
    const cRect = container.getBoundingClientRect();
    const els = Array.from(container.querySelectorAll<HTMLElement>('[data-source-line]'));
    for (const el of els) {
      const rect = el.getBoundingClientRect();
      if (rect.bottom > cRect.top + 8) {
        const ln = Number(el.dataset.sourceLine);
        if (Number.isFinite(ln) && ln >= 1) return ln;
      }
    }
    return 1;
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      scrollToLine,
      getTopVisibleLine,
      getScrollElement: () => scrollRef.current,
    }),
    [scrollToLine, getTopVisibleLine],
  );

  const updateActiveHeading = useCallback(() => {
    const container = scrollRef.current;
    const headings = headingsRef.current;
    if (!container) return;
    if (headings.length === 0) {
      setActiveHeadingId(null);
      if (variant === 'read') useWorkspaceStore.getState().setCursorSymbols([]);
      return;
    }
    const cRect = container.getBoundingClientRect();
    const headingEls = Array.from(container.querySelectorAll<HTMLElement>('[data-heading-id]'));
    let currentId: string | null = headingEls[0]?.dataset.headingId ?? null;
    for (const el of headingEls) {
      const top = el.getBoundingClientRect().top - cRect.top;
      if (top <= 56) {
        currentId = el.dataset.headingId ?? currentId;
      } else {
        break;
      }
    }
    setActiveHeadingId((prev) => (prev === currentId ? prev : currentId));
    if (variant === 'read') {
      const chain = headingChainAt(headings, currentId).slice(-2);
      useWorkspaceStore.getState().setCursorSymbols(chain);
    }
  }, [variant]);

  // 标题列表或视图变体变化时刷新当前章节高亮
  useEffect(() => {
    updateActiveHeading();
  }, [doc.headings, updateActiveHeading]);

  // 切换文件或工作区时恢复滚动位置或衔接源码编辑行号
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const cacheKey = `${root}::${path}`;
    const curReveal = useWorkspaceStore.getState().reveal;
    const hasPendingReveal = curReveal && curReveal.path === path;
    if (!hasPendingReveal) {
      const initLine = initialLineRef.current;
      if (initLine && initLine > 1) {
        scrollToLine(initLine, false);
      } else {
        const saved = scrollCache.get(cacheKey);
        container.scrollTop = saved ?? 0;
      }
    }
    const raf = requestAnimationFrame(() => {
      updateActiveHeading();
      onVisibleLineChange?.(getTopVisibleLine());
    });
    return () => cancelAnimationFrame(raf);
  }, [root, path, scrollToLine, updateActiveHeading, getTopVisibleLine, onVisibleLineChange]);

  // 响应全局 reveal（Cmd+P @标题、搜索跳转、文件链接锚点等）
  useEffect(() => {
    if (!reveal || reveal.path !== path) return;
    const raf = requestAnimationFrame(() => {
      if (reveal.anchor) {
        scrollToAnchor(reveal.anchor);
      } else if (reveal.line) {
        scrollToLine(reveal.line, true);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [reveal, path, scrollToAnchor, scrollToLine]);

  const handleLinkClick = useCallback(
    (rawHref: string) => {
      const classified = classifyHref(rawHref);
      if (classified.kind === 'unsafe') return;
      if (classified.kind === 'external') {
        void appOpenExternal(classified.href);
        return;
      }
      if (classified.kind === 'anchor') {
        scrollToAnchor(classified.anchor);
        return;
      }
      // 工作区相对路径链接
      const hashIdx = classified.href.indexOf('#');
      const frag = hashIdx >= 0 ? classified.href.slice(hashIdx + 1) : '';
      const rel = resolveRelativePath(path, classified.href);
      if (!rel) return;

      let line: number | undefined;
      let endLine: number | undefined;
      let anchor: string | undefined;
      if (frag) {
        const lm = /^L(\d+)(?:-L?(\d+))?$/i.exec(frag);
        if (lm) {
          line = Math.max(1, Number(lm[1]));
          if (lm[2]) endLine = Math.max(line, Number(lm[2]));
        } else {
          anchor = frag;
        }
      }

      if (rel === path && anchor) {
        scrollToAnchor(anchor);
        return;
      }

      const opts: OpenFileOptions = {};
      if (line) {
        opts.line = line;
        opts.endLine = endLine;
      }
      if (anchor) opts.anchor = anchor;
      if (isMarkdownPath(rel) && variant === 'read') {
        opts.markdownView = 'read';
      }
      useUiStore.getState().setMode('code');
      void useWorkspaceStore.getState().openFile(rel, opts);
    },
    [path, variant, scrollToAnchor],
  );

  const toggleTaskCheckbox = useCallback(
    (item: MarkdownListItem) => {
      const model = getFileModel(fullPath);
      if (!model || item.line < 1 || item.line > model.getLineCount()) return;
      const lineText = model.getLineContent(item.line);
      const m = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/.exec(lineText);
      if (!m) return;
      const nextChar = m[2] === ' ' ? 'x' : ' ';
      const col = m[1].length + 1;
      model.pushEditOperations(
        [],
        [{ range: new monaco.Range(item.line, col, item.line, col + 1), text: nextChar }],
        () => null,
      );
    },
    [fullPath],
  );

  const renderInlines = useCallback(
    (nodes: MarkdownInline[], keyBase: string, insideLink = false): ReactNode[] =>
      nodes.map((node, i) => {
        const k = `${keyBase}-${i}`;
        switch (node.type) {
          case 'text':
            return <Fragment key={k}>{node.text}</Fragment>;
          case 'softbreak':
            return <Fragment key={k}>{'\n'}</Fragment>;
          case 'hardbreak':
            return <br key={k} />;
          case 'code':
            return <code key={k}>{node.text}</code>;
          case 'strong':
            return <strong key={k}>{renderInlines(node.children, k, insideLink)}</strong>;
          case 'em':
            return <em key={k}>{renderInlines(node.children, k, insideLink)}</em>;
          case 'del':
            return <del key={k}>{renderInlines(node.children, k, insideLink)}</del>;
          case 'kbd':
            return (
              <kbd key={k} className="onyx-md-kbd">
                {node.text}
              </kbd>
            );
          case 'mark':
            return <mark key={k}>{renderInlines(node.children, k, insideLink)}</mark>;
          case 'sub':
            return <sub key={k}>{renderInlines(node.children, k, insideLink)}</sub>;
          case 'sup':
            return <sup key={k}>{renderInlines(node.children, k, insideLink)}</sup>;
          case 'footnote_ref':
            return (
              <sup key={k} className="onyx-md-fn-ref">
                <a
                  href={`#fn-${node.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-fn-id="${node.id}"]`);
                    if (el) {
                      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      flashElement(el);
                    }
                  }}
                >
                  [{node.index}]
                </a>
              </sup>
            );
          case 'image':
            return (
              <MarkdownImage
                key={k}
                src={node.src}
                alt={node.alt}
                title={node.title}
                width={node.width}
                height={node.height}
                docPath={path}
                root={root}
                insideLink={insideLink}
                onPreview={setLightbox}
              />
            );
          case 'link': {
            const cls = classifyHref(node.href);
            if (cls.kind === 'unsafe') {
              return <span key={k}>{renderInlines(node.children, k, true)}</span>;
            }
            return (
              <a
                key={k}
                href={cls.href}
                title={node.title ?? cls.href}
                onClick={(e) => {
                  e.preventDefault();
                  handleLinkClick(node.href);
                }}
              >
                {renderInlines(node.children, k, true)}
              </a>
            );
          }
        }
      }),
    [path, root, handleLinkClick],
  );

  const renderBlocks = useCallback(
    (blocks: MarkdownBlock[], keyBase: string): ReactNode[] =>
      blocks.map((block, i) => {
        const k = `${keyBase}-${i}`;
        switch (block.type) {
          case 'heading': {
            const Tag = `h${block.level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
            return (
              <Tag
                key={k}
                data-heading-id={block.id}
                data-source-line={block.startLine}
                className="onyx-md-heading"
              >
                {renderInlines(block.children, k)}
              </Tag>
            );
          }
          case 'paragraph':
            return (
              <p
                key={k}
                data-source-line={block.startLine}
                style={block.align ? { textAlign: block.align } : undefined}
              >
                {renderInlines(block.children, k)}
              </p>
            );
          case 'code_block':
            return (
              <div key={k} data-source-line={block.startLine}>
                <CodeBlock lang={block.lang} code={block.code} />
              </div>
            );
          case 'hr':
            return <hr key={k} data-source-line={block.startLine} />;
          case 'blockquote': {
            if (block.callout) {
              const meta = CALLOUT_META[block.callout];
              const CalloutIcon = meta.icon;
              return (
                <blockquote
                  key={k}
                  data-source-line={block.startLine}
                  className={`onyx-md-callout is-${block.callout}`}
                >
                  <div className="onyx-md-callout-title">
                    <CalloutIcon size={15} strokeWidth={ICON_STROKE} />
                    <span>{meta.label}</span>
                  </div>
                  <div className="onyx-md-callout-body">{renderBlocks(block.blocks, k)}</div>
                </blockquote>
              );
            }
            return (
              <blockquote key={k} data-source-line={block.startLine}>
                {renderBlocks(block.blocks, k)}
              </blockquote>
            );
          }
          case 'list': {
            const ListTag = block.ordered ? 'ol' : 'ul';
            return (
              <ListTag
                key={k}
                data-source-line={block.startLine}
                start={block.ordered && block.start !== 1 ? block.start : undefined}
                className={block.tight ? 'is-tight' : undefined}
              >
                {block.items.map((item, idx) => (
                  <li
                    key={`${k}-li-${idx}`}
                    data-source-line={item.line}
                    className={item.checked !== null ? 'onyx-md-task-item' : undefined}
                  >
                    {item.checked !== null && (
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={item.checked}
                        title={item.checked ? '标记为未完成' : '标记为已完成'}
                        className={`onyx-md-checkbox${item.checked ? ' is-checked' : ''}`}
                        onClick={() => toggleTaskCheckbox(item)}
                      >
                        {item.checked && <Check size={11} strokeWidth={2.2} />}
                      </button>
                    )}
                    <div className="onyx-md-li-body">{renderBlocks(item.blocks, `${k}-li-${idx}`)}</div>
                  </li>
                ))}
              </ListTag>
            );
          }
          case 'table':
            return (
              <div key={k} data-source-line={block.startLine} className="onyx-md-table-wrap">
                <table className="onyx-md-table">
                  <thead>
                    <tr>
                      {block.headers.map((h, ci) => (
                        <th key={ci} style={block.alignments[ci] ? { textAlign: block.alignments[ci]! } : undefined}>
                          {renderInlines(h, `${k}-h-${ci}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, ri) => (
                      <tr key={ri}>
                        {row.map((cell, ci) => (
                          <td
                            key={ci}
                            style={block.alignments[ci] ? { textAlign: block.alignments[ci]! } : undefined}
                          >
                            {renderInlines(cell, `${k}-r-${ri}-${ci}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'html_container':
            return (
              <div
                key={k}
                data-source-line={block.startLine}
                className="onyx-md-html-box"
                style={block.align ? { textAlign: block.align } : undefined}
              >
                {renderBlocks(block.blocks, k)}
              </div>
            );
          case 'details':
            return (
              <details key={k} data-source-line={block.startLine} open={block.open} className="onyx-md-details">
                <summary className="onyx-md-summary">
                  <ChevronRight size={14} strokeWidth={ICON_STROKE} className="onyx-md-summary-chevron" />
                  <span>{renderInlines(block.summary, `${k}-sum`)}</span>
                </summary>
                <div className="onyx-md-details-body">{renderBlocks(block.blocks, k)}</div>
              </details>
            );
          case 'image_block':
            return (
              <div
                key={k}
                data-source-line={block.startLine}
                className="onyx-md-img-block"
                style={block.align ? { textAlign: block.align } : undefined}
              >
                <MarkdownImage
                  src={block.src}
                  alt={block.alt}
                  title={block.title}
                  width={block.width}
                  height={block.height}
                  docPath={path}
                  root={root}
                  block
                  onPreview={setLightbox}
                />
              </div>
            );
        }
      }),
    [path, root, renderInlines, toggleTaskCheckbox],
  );

  const showOutline = variant === 'read' && outlineVisible && doc.headings.length >= 2 && wideEnough;
  const isEmpty = !source.trim();

  return (
    <div
      ref={rootRef}
      className={`onyx-md-reader is-${variant}`}
      style={{ '--onyx-md-font-size': `${prefs.editorFontSize + 2}px` } as CSSProperties}
    >
      <div
        ref={scrollRef}
        className="onyx-md-scroll"
        onScroll={(e) => {
          scrollCache.set(`${root}::${path}`, e.currentTarget.scrollTop);
          updateActiveHeading();
          onVisibleLineChange?.(getTopVisibleLine());
          onScroll?.();
        }}
      >
        {isEmpty ? (
          <div className="onyx-md-empty">
            <FileText size={20} strokeWidth={ICON_STROKE} />
            <span>文档内容为空，切换到 Edit 模式开始编写</span>
          </div>
        ) : (
          <article className="onyx-md-article">
            {doc.frontmatter && doc.frontmatter.length > 0 && (
              <div className="onyx-md-frontmatter" data-source-line={1}>
                {doc.frontmatter.map((entry) => (
                  <div key={entry.key} className="onyx-md-fm-row">
                    <span className="onyx-md-fm-key">{entry.key}</span>
                    <span className="onyx-md-fm-val">{entry.value || '-'}</span>
                  </div>
                ))}
              </div>
            )}
            {renderBlocks(doc.blocks, 'b')}
            {doc.footnotes.length > 0 && (
              <section className="onyx-md-footnotes" aria-label="脚注">
                <hr />
                <ol>
                  {doc.footnotes.map((fn) => (
                    <li key={fn.id} data-fn-id={fn.id}>
                      {renderBlocks(fn.blocks, `fn-${fn.id}`)}
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </article>
        )}
      </div>

      {showOutline && (
        <MarkdownOutline headings={doc.headings} activeId={activeHeadingId} onSelect={scrollToAnchor} />
      )}

      {lightbox && (
        <div
          className="onyx-md-lightbox"
          role="dialog"
          aria-modal="true"
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            className="onyx-md-lightbox-close"
            title="关闭预览 (Esc)"
            onClick={() => setLightbox(null)}
          >
            <X size={16} strokeWidth={ICON_STROKE} />
          </button>
          <img
            src={lightbox.src}
            alt={lightbox.alt}
            className="onyx-md-lightbox-img"
            onClick={(e) => e.stopPropagation()}
          />
          {lightbox.alt && <div className="onyx-md-lightbox-caption">{lightbox.alt}</div>}
        </div>
      )}
    </div>
  );
});
