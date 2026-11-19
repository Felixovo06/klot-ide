import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, GitBranch, Plus, Search } from 'lucide-react';
import { useGitStore } from '../stores/gitStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { ICON_STROKE, useDismiss } from './ui';

export function BranchPicker() {
  const repoName = useWorkspaceStore((s) => s.repoName);
  const status = useGitStore((s) => s.status);
  const branches = useGitStore((s) => s.branches);
  const refreshBranches = useGitStore((s) => s.refreshBranches);
  const checkout = useGitStore((s) => s.checkout);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);

  useEffect(() => {
    if (open) {
      setQuery('');
      void refreshBranches();
    }
  }, [open, refreshBranches]);

  const branch = status?.isRepo ? status.branch : '';
  const q = query.trim().toLowerCase();
  const local = useMemo(
    () => branches.filter((b) => !b.isRemote && b.name.toLowerCase().includes(q)),
    [branches, q],
  );
  const remote = useMemo(
    () => branches.filter((b) => b.isRemote && b.name.toLowerCase().includes(q)),
    [branches, q],
  );
  const canCreate =
    query.trim().length > 0 && !branches.some((b) => b.name === query.trim()) && /^[\w./-]+$/.test(query.trim());

  const pick = async (name: string, create = false) => {
    setOpen(false);
    await checkout(name, create);
  };

  return (
    <div className="onyx-popover-anchor" ref={ref}>
      <button
        type="button"
        className="onyx-branch-pill"
        onClick={() => status?.isRepo && setOpen((v) => !v)}
        title={status?.isRepo ? '切换分支' : '当前工作区不是 Git 仓库'}
      >
        <GitBranch size={13} strokeWidth={ICON_STROKE} />
        <span className="onyx-branch-repo">{repoName || 'workspace'}</span>
        {branch && (
          <>
            <span className="onyx-branch-sep">/</span>
            <span className="onyx-branch-name">{branch}</span>
          </>
        )}
        {status?.isRepo && (status.ahead > 0 || status.behind > 0) && (
          <span className="onyx-branch-sync">
            {status.ahead > 0 ? `+${status.ahead}` : ''}
            {status.behind > 0 ? ` -${status.behind}` : ''}
          </span>
        )}
        {status?.isRepo && <ChevronDown size={12} strokeWidth={ICON_STROKE} className="onyx-dim" />}
      </button>
      {open && (
        <div className="onyx-menu onyx-branch-menu">
          <div className="onyx-menu-search">
            <Search size={13} strokeWidth={ICON_STROKE} />
            <input
              autoFocus
              value={query}
              placeholder="Switch or create branch..."
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (local[0] && local[0].name.toLowerCase() === q) void pick(local[0].name);
                  else if (canCreate) void pick(query.trim(), true);
                  else if (local[0]) void pick(local[0].name);
                }
              }}
            />
          </div>
          <div className="onyx-menu-scroll">
            {canCreate && (
              <button type="button" className="onyx-menu-item" onClick={() => void pick(query.trim(), true)}>
                <Plus size={14} strokeWidth={ICON_STROKE} />
                <span className="onyx-menu-label">Create branch {query.trim()}</span>
              </button>
            )}
            {local.length > 0 && <div className="onyx-menu-section">Local</div>}
            {local.map((b) => (
              <button
                key={b.name}
                type="button"
                className="onyx-menu-item"
                onClick={() => !b.isCurrent && void pick(b.name)}
              >
                <GitBranch size={14} strokeWidth={ICON_STROKE} />
                <span className="onyx-menu-label">{b.name}</span>
                {b.isCurrent && <Check size={14} strokeWidth={ICON_STROKE} className="onyx-accent" />}
              </button>
            ))}
            {remote.length > 0 && <div className="onyx-menu-section">Remote</div>}
            {remote.map((b) => (
              <button
                key={b.name}
                type="button"
                className="onyx-menu-item"
                onClick={() => void pick(b.name.replace(/^[^/]+\//, ''), !branches.some((x) => !x.isRemote && x.name === b.name.replace(/^[^/]+\//, '')))}
              >
                <GitBranch size={14} strokeWidth={ICON_STROKE} className="onyx-dim" />
                <span className="onyx-menu-label onyx-dim">{b.name}</span>
              </button>
            ))}
            {local.length === 0 && remote.length === 0 && !canCreate && (
              <div className="onyx-menu-empty">没有匹配的分支</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
