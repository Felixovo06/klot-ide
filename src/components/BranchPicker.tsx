import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppWindow,
  Check,
  ChevronDown,
  Folder,
  FolderOpen,
  GitBranch,
  Plus,
  Search,
} from 'lucide-react';
import { useGitStore } from '../stores/gitStore';
import { abbreviateHome, basename } from '../stores/utils';
import { normalizeWorkspacePath, useWorkspaceStore } from '../stores/workspaceStore';
import { formatShortcut } from './shortcuts';
import { ICON_STROKE, useDismiss } from './ui';

export function BranchPicker() {
  const root = useWorkspaceStore((s) => s.root);
  const repoName = useWorkspaceStore((s) => s.repoName);
  const homeDir = useWorkspaceStore((s) => s.ctx?.homeDir);
  const recentWorkspaces = useWorkspaceStore((s) => s.recentWorkspaces);
  const switchWorkspace = useWorkspaceStore((s) => s.switchWorkspace);
  const promptOpenWorkspace = useWorkspaceStore((s) => s.promptOpenWorkspace);
  const promptOpenWorkspaceInNewWindow = useWorkspaceStore((s) => s.promptOpenWorkspaceInNewWindow);
  const status = useGitStore((s) => s.status);
  const branches = useGitStore((s) => s.branches);
  const refreshBranches = useGitStore((s) => s.refreshBranches);
  const checkout = useGitStore((s) => s.checkout);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);

  const isRepo = !!status?.isRepo;

  useEffect(() => {
    if (open) {
      setQuery('');
      if (isRepo) void refreshBranches();
    }
  }, [open, isRepo, refreshBranches]);

  const branch = isRepo ? status.branch : '';
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

  const normRoot = normalizeWorkspacePath(root);
  const showRecent =
    recentWorkspaces.length > 1 || recentWorkspaces.some((p) => normalizeWorkspacePath(p) !== normRoot);

  const pickBranch = async (name: string, create = false) => {
    setOpen(false);
    await checkout(name, create);
  };

  return (
    <div className="onyx-popover-anchor" ref={ref}>
      <button
        type="button"
        className={`onyx-branch-pill${open ? ' is-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={isRepo ? '切换项目或分支' : '打开项目文件夹或切换最近项目'}
      >
        {isRepo ? <GitBranch size={13} strokeWidth={ICON_STROKE} /> : <Folder size={13} strokeWidth={ICON_STROKE} />}
        <span className="onyx-branch-repo">{repoName || 'workspace'}</span>
        {branch && (
          <>
            <span className="onyx-branch-sep">/</span>
            <span className="onyx-branch-name">{branch}</span>
          </>
        )}
        {isRepo && (status.ahead > 0 || status.behind > 0) && (
          <span className="onyx-branch-sync">
            {status.ahead > 0 ? `+${status.ahead}` : ''}
            {status.behind > 0 ? ` -${status.behind}` : ''}
          </span>
        )}
        <ChevronDown size={12} strokeWidth={ICON_STROKE} className="onyx-dim" />
      </button>
      {open && (
        <div className="onyx-menu onyx-branch-menu">
          <button
            type="button"
            className="onyx-menu-item"
            onClick={() => {
              setOpen(false);
              void promptOpenWorkspace();
            }}
          >
            <FolderOpen size={14} strokeWidth={ICON_STROKE} />
            <span className="onyx-menu-label">打开项目文件夹...</span>
            <span className="onyx-menu-hint">{formatShortcut('Cmd+O')}</span>
          </button>
          <button
            type="button"
            className="onyx-menu-item"
            onClick={() => {
              setOpen(false);
              void promptOpenWorkspaceInNewWindow();
            }}
          >
            <AppWindow size={14} strokeWidth={ICON_STROKE} />
            <span className="onyx-menu-label">在新窗口中打开...</span>
            <span className="onyx-menu-hint">{formatShortcut('Cmd+Shift+O')}</span>
          </button>

          {showRecent && (
            <>
              <div className="onyx-menu-divider" />
              <div className="onyx-menu-section">Recent Projects</div>
              <div className="onyx-recent-projects-scroll">
                {recentWorkspaces.map((p) => {
                  const isCurrent = normalizeWorkspacePath(p) === normRoot;
                  return (
                    <button
                      key={p}
                      type="button"
                      className="onyx-menu-item is-two-line"
                      title={p}
                      onClick={() => {
                        setOpen(false);
                        if (!isCurrent) void switchWorkspace(p);
                      }}
                    >
                      <Folder size={14} strokeWidth={ICON_STROKE} />
                      <span className="onyx-menu-label">
                        <span>{basename(p) || p}</span>
                        <span className="onyx-menu-sub">{abbreviateHome(p, homeDir)}</span>
                      </span>
                      {isCurrent && <Check size={14} strokeWidth={ICON_STROKE} className="onyx-accent" />}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {isRepo && (
            <>
              <div className="onyx-menu-divider" />
              <div className="onyx-menu-search">
                <Search size={13} strokeWidth={ICON_STROKE} />
                <input
                  autoFocus
                  value={query}
                  placeholder="Switch or create branch..."
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      if (local[0] && local[0].name.toLowerCase() === q) void pickBranch(local[0].name);
                      else if (canCreate) void pickBranch(query.trim(), true);
                      else if (local[0]) void pickBranch(local[0].name);
                    }
                  }}
                />
              </div>
              <div className="onyx-menu-scroll">
                {canCreate && (
                  <button type="button" className="onyx-menu-item" onClick={() => void pickBranch(query.trim(), true)}>
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
                    onClick={() => !b.isCurrent && void pickBranch(b.name)}
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
                    onClick={() =>
                      void pickBranch(
                        b.name.replace(/^[^/]+\//, ''),
                        !branches.some((x) => !x.isRemote && x.name === b.name.replace(/^[^/]+\//, '')),
                      )
                    }
                  >
                    <GitBranch size={14} strokeWidth={ICON_STROKE} className="onyx-dim" />
                    <span className="onyx-menu-label onyx-dim">{b.name}</span>
                  </button>
                ))}
                {local.length === 0 && remote.length === 0 && !canCreate && (
                  <div className="onyx-menu-empty">没有匹配的分支</div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
