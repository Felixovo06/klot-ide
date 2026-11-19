// 插件 drawer_view 输出的原生渲染：Markdown 子集与表格
import { Fragment, type ReactNode } from 'react';
import { appOpenExternal } from '../lib/ipcClient';
import type { DrawerTab } from '../stores/runStore';

function renderInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-${i}`;
    if (m[1]) out.push(<code key={key}>{tok.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    else if (m[3]) out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    else if (m[4]) {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok);
      const href = lm?.[2] ?? '';
      const safe = /^https?:\/\//.test(href) ? href : undefined;
      out.push(
        <a
          key={key}
          href={safe}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => {
            if (!safe) return;
            e.preventDefault();
            void appOpenExternal(safe);
          }}
        >
          {lm?.[1] ?? tok}
        </a>,
      );
    }
    last = m.index + tok.length;
    i += 1;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

export function MarkdownView({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;
  const nextKey = () => `b${key++}`;

  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1;
      blocks.push(
        <pre key={nextKey()}>
          <code>{body.join('\n')}</code>
        </pre>,
      );
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const k = nextKey();
      const level = h[1].length;
      const content = renderInline(h[2], k);
      blocks.push(
        level === 1 ? <h1 key={k}>{content}</h1> : level === 2 ? <h2 key={k}>{content}</h2> : <h3 key={k}>{content}</h3>,
      );
      i += 1;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      const k = nextKey();
      blocks.push(
        <table key={k} className="onyx-table">
          <thead>
            <tr>
              {header.map((c, ci) => (
                <th key={ci}>{renderInline(c, `${k}h${ci}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>
                {r.map((c, ci) => (
                  <td key={ci}>{renderInline(c, `${k}r${ri}c${ci}`)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, ''));
        i += 1;
      }
      const k = nextKey();
      const children = items.map((it, ii) => <li key={ii}>{renderInline(it, `${k}-${ii}`)}</li>);
      blocks.push(ordered ? <ol key={k}>{children}</ol> : <ul key={k}>{children}</ul>);
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      const k = nextKey();
      blocks.push(<blockquote key={k}>{renderInline(quote.join(' '), k)}</blockquote>);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push(<hr key={nextKey()} />);
      i += 1;
      continue;
    }
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*(```|#{1,4}\s|[-*+]\s|\d+\.\s|>|\|)/.test(lines[i])
    ) {
      para.push(lines[i]);
      i += 1;
    }
    if (para.length === 0) {
      para.push(line);
      i += 1;
    }
    const k = nextKey();
    blocks.push(
      <p key={k}>
        {para.map((p, pi) => (
          <Fragment key={pi}>
            {pi > 0 && ' '}
            {renderInline(p, `${k}-${pi}`)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return <div className="onyx-markdown">{blocks}</div>;
}

export function DrawerContent({ tab }: { tab: DrawerTab }) {
  if (tab.format === 'table') {
    const columns = tab.columns ?? [];
    const rows = tab.rows ?? [];
    return (
      <div className="onyx-drawer-doc">
        {tab.content && <MarkdownView source={tab.content} />}
        <table className="onyx-table">
          {columns.length > 0 && (
            <thead>
              <tr>
                {columns.map((c, i) => (
                  <th key={i}>{c}</th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>
                {r.map((c, ci) => (
                  <td key={ci} className={typeof c === 'number' ? 'is-num' : undefined}>
                    {String(c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="onyx-empty-hint is-inline">No rows</div>}
      </div>
    );
  }
  return (
    <div className="onyx-drawer-doc">
      <MarkdownView source={tab.content ?? ''} />
    </div>
  );
}
