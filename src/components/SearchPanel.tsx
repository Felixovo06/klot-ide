import { useEffect, useMemo, useRef, useState } from 'react';
import { CaseSensitive, ChevronDown, ChevronRight, Regex, ReplaceAll, Search } from 'lucide-react';
import { searchReplace, searchWorkspace } from '../lib/ipcClient';
import type { SearchFileResult, SearchMatchLine, SearchSummary } from '../types/ipc';
import { useGitStore } from '../stores/gitStore';
import { toast, useUiStore } from '../stores/uiStore';
import { errorMessage } from '../stores/utils';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { ICON_STROKE } from './ui';

function Snippet({ match }: { match: SearchMatchLine }) {
  const raw = match.lineText;
  const lead = raw.length - raw.trimStart().length;
  let offset = lead;
  const firstStart = match.ranges[0]?.start ?? lead;
  let prefix = '';
  if (firstStart - offset > 48) {
    const from = firstStart - 28;
    const space = raw.indexOf(' ', from);
    offset = space >= 0 && space < firstStart ? space + 1 : from;
    prefix = '...';
  }
  const text = raw.slice(offset, offset + 220);
  const parts: Array<{ text: string; hit: boolean }> = [];
  let cursor = 0;
  for (const r of match.ranges) {
    const s = Math.max(0, r.start - offset);
    const e = Math.min(text.length, r.end - offset);
    if (e <= s || s < cursor) continue;
    if (s > cursor) parts.push({ text: text.slice(cursor, s), hit: false });
    parts.push({ text: text.slice(s, e), hit: true });
    cursor = e;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), hit: false });
  return (
    <span className="onyx-search-snippet">
      {prefix}
      {parts.map((p, i) =>
        p.hit ? (
          <mark key={i} className="onyx-search-hit">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </span>
  );
}

export function SearchPanel() {
  const root = useWorkspaceStore((s) => s.root);
  const openFile = useWorkspaceStore((s) => s.openFile);
  const focusNonce = useUiStore((s) => s.searchFocusNonce);
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const [results, setResults] = useState<SearchFileResult[]>([]);
  const [summary, setSummary] = useState<SearchSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [refreshNonce, setRefreshNonce] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const tokenRef = useRef(0);

  useEffect(() => {
    if (focusNonce > 0) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [focusNonce]);

  useEffect(() => {
    const token = ++tokenRef.current;
    if (!query || !root) {
      setResults([]);
      setSummary(null);
      setLoading(false);
      setError(null);
      return;
    }
    if (regex) {
      try {
        new RegExp(query);
      } catch {
        setError('正则表达式无效');
        setResults([]);
        setSummary(null);
        return;
      }
    }
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      const acc: SearchFileResult[] = [];
      setResults([]);
      searchWorkspace(root, query, { regex, caseSensitive }, (ev) => {
        if (token !== tokenRef.current) return;
        if (ev.event === 'match') {
          acc.push(ev.data);
          setResults([...acc]);
        } else {
          setSummary(ev.data);
        }
      })
        .then((s) => {
          if (token !== tokenRef.current) return;
          setSummary(s);
          setLoading(false);
        })
        .catch((e) => {
          if (token !== tokenRef.current) return;
          setError(errorMessage(e));
          setLoading(false);
        });
    }, 220);
    return () => clearTimeout(timer);
  }, [query, regex, caseSensitive, root, refreshNonce]);

  const totals = useMemo(() => {
    const files = results.length;
    const matches = results.reduce(
      (n, r) => n + r.matches.reduce((m, l) => m + Math.max(1, l.ranges.length), 0),
      0,
    );
    return { files, matches };
  }, [results]);

  const doReplace = async () => {
    if (!query || results.length === 0) return;
    if (!window.confirm(`将 ${totals.matches} 处 "${query}" 替换为 "${replacement}"？`)) return;
    try {
      const res = await searchReplace(root, query, replacement, { regex, caseSensitive });
      toast('success', `已替换 ${res.replacementsCount} 处，涉及 ${res.filesModified} 个文件`);
      await useWorkspaceStore.getState().reloadFromDisk(res.modifiedPaths);
      void useGitStore.getState().refresh();
      setRefreshNonce((n) => n + 1);
    } catch (e) {
      toast('error', `替换失败：${errorMessage(e)}`);
    }
  };

  return (
    <div className="onyx-search-panel">
      <div className="onyx-input-wrap">
        <Search size={13} strokeWidth={ICON_STROKE} className="onyx-input-icon" />
        <input
          ref={inputRef}
          className="onyx-input has-icon has-actions"
          placeholder="Search"
          value={query}
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="onyx-input-actions">
          <button
            type="button"
            className={`onyx-toggle${caseSensitive ? ' is-on' : ''}`}
            title="区分大小写"
            onClick={() => setCaseSensitive((v) => !v)}
          >
            <CaseSensitive size={15} strokeWidth={ICON_STROKE} />
          </button>
          <button
            type="button"
            className={`onyx-toggle${regex ? ' is-on' : ''}`}
            title="正则表达式"
            onClick={() => setRegex((v) => !v)}
          >
            <Regex size={14} strokeWidth={ICON_STROKE} />
          </button>
        </div>
      </div>
      <div className="onyx-input-wrap">
        <input
          className="onyx-input has-actions"
          placeholder="Replace with..."
          value={replacement}
          spellCheck={false}
          onChange={(e) => setReplacement(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void doReplace();
          }}
        />
        <div className="onyx-input-actions">
          <button
            type="button"
            className="onyx-toggle"
            title="全部替换 (Cmd+Enter)"
            disabled={results.length === 0}
            onClick={() => void doReplace()}
          >
            <ReplaceAll size={14} strokeWidth={ICON_STROKE} />
          </button>
        </div>
      </div>

      {error && <div className="onyx-search-summary is-error">{error}</div>}
      {!error && query && (
        <div className="onyx-search-summary">
          {loading && results.length === 0
            ? 'Searching...'
            : `${totals.matches} results in ${totals.files} files`}
          {summary?.truncated ? ' (truncated)' : ''}
        </div>
      )}

      <div className="onyx-search-results">
        {results.map((file) => {
          const isCollapsed = !!collapsed[file.path];
          return (
            <div key={file.path} className="onyx-search-group">
              <button
                type="button"
                className="onyx-search-file"
                onClick={() => setCollapsed((c) => ({ ...c, [file.path]: !isCollapsed }))}
                title={file.path}
              >
                {isCollapsed ? (
                  <ChevronRight size={13} strokeWidth={ICON_STROKE} />
                ) : (
                  <ChevronDown size={13} strokeWidth={ICON_STROKE} />
                )}
                <span className="onyx-search-file-path">{file.path}</span>
                <span className="onyx-search-count">
                  {file.matches.reduce((n, l) => n + Math.max(1, l.ranges.length), 0)}
                </span>
              </button>
              {!isCollapsed &&
                file.matches.map((m) => (
                  <button
                    key={`${file.path}:${m.lineNumber}`}
                    type="button"
                    className="onyx-search-line"
                    onClick={() => {
                      const r = m.ranges[0];
                      void openFile(file.path, {
                        line: m.lineNumber,
                        column: r ? r.start + 1 : undefined,
                        endColumn: r ? r.end + 1 : undefined,
                      });
                    }}
                  >
                    <span className="onyx-search-lineno">{m.lineNumber}</span>
                    <Snippet match={m} />
                  </button>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
