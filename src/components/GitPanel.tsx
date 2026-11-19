import { useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Minus, Plus, RefreshCw, Undo2 } from 'lucide-react';
import type { GitFileChange } from '../types/ipc';
import { useGitStore } from '../stores/gitStore';
import { useUiStore } from '../stores/uiStore';
import { basename, dirname } from '../stores/utils';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { GitInitEmpty } from './GitInitEmpty';
import { CommitDetailPanel, ComparePanel } from './GitHistoryPanels';
import { formatShortcut } from './shortcuts';
import { ICON_STROKE, Segmented } from './ui';

function ChangeRow({ change }: { change: GitFileChange }) {
  const selected = useGitStore((s) => s.selected);
  const select = useGitStore((s) => s.select);
  const stage = useGitStore((s) => s.stage);
  const unstage = useGitStore((s) => s.unstage);
  const discard = useGitStore((s) => s.discard);
  const isSelected = selected?.path === change.path && selected.staged === change.staged;
  const add = change.additions ?? 0;
  const del = change.deletions ?? 0;

  const openInEditor = () => {
    if (change.status === 'D') return;
    useUiStore.getState().setMode('code');
    void useWorkspaceStore.getState().openFile(change.path);
  };

  return (
    <div
      className={`onyx-change-row${isSelected ? ' is-selected' : ''}${change.status === 'D' ? ' is-deleted' : ''}`}
      title={`${change.path}${change.oldPath ? ` (from ${change.oldPath})` : ''}`}
      onClick={() => select({ path: change.path, staged: change.staged })}
      onDoubleClick={openInEditor}
    >
      <span className="onyx-change-path">
        {dirname(change.path) && <span className="onyx-change-dir">{dirname(change.path)}/</span>}
        <span className="onyx-change-name">{basename(change.path)}</span>
      </span>
      <span className="onyx-change-stats">
        {change.status === '?' && add === 0 && del === 0 ? (
          <span className="onyx-stat-add">new</span>
        ) : (
          <>
            <span className="onyx-stat-add">+{add}</span>
            <span className="onyx-stat-del">-{del}</span>
          </>
        )}
      </span>
      <span className="onyx-change-actions" onClick={(e) => e.stopPropagation()}>
        {change.status !== 'D' && (
          <button type="button" className="onyx-mini-btn" title="Open File" onClick={openInEditor}>
            <FileText size={13} strokeWidth={ICON_STROKE} />
          </button>
        )}
        {change.staged ? (
          <button type="button" className="onyx-mini-btn" title="Unstage" onClick={() => void unstage([change.path])}>
            <Minus size={14} strokeWidth={ICON_STROKE} />
          </button>
        ) : (
          <>
            <button type="button" className="onyx-mini-btn" title="Discard" onClick={() => void discard([change.path])}>
              <Undo2 size={13} strokeWidth={ICON_STROKE} />
            </button>
            <button type="button" className="onyx-mini-btn" title="Stage" onClick={() => void stage([change.path])}>
              <Plus size={14} strokeWidth={ICON_STROKE} />
            </button>
          </>
        )}
      </span>
    </div>
  );
}

function Section({
  title,
  count,
  children,
  actions,
  defaultOpen = true,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
  actions?: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="onyx-git-section">
      <div className="onyx-git-section-head" onClick={() => setOpen((v) => !v)}>
        {open ? (
          <ChevronDown size={13} strokeWidth={ICON_STROKE} />
        ) : (
          <ChevronRight size={13} strokeWidth={ICON_STROKE} />
        )}
        <span className="onyx-git-section-title">{title}</span>
        <span className="onyx-git-section-actions" onClick={(e) => e.stopPropagation()}>
          {actions}
        </span>
        <span className="onyx-git-section-count">({count})</span>
      </div>
      {open && <div className="onyx-git-section-body">{children}</div>}
    </div>
  );
}

export function GitPanel() {
  const status = useGitStore((s) => s.status);
  const tab = useGitStore((s) => s.gitTab);
  const setTab = useGitStore((s) => s.setGitTab);
  const fetching = useGitStore((s) => s.fetching);
  const fetchRemotes = useGitStore((s) => s.fetchRemotes);

  if (!status) return <div className="onyx-empty-hint">Loading...</div>;
  if (!status.isRepo) return <GitInitEmpty variant="sidebar" />;

  return (
    <div className="onyx-git-panel">
      <div className="onyx-git-nav">
        <Segmented
          size="sm"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'changes', label: 'Changes', title: '工作区改动与提交' },
            { value: 'graph', label: 'Graph', title: 'Git 树与提交详情' },
            { value: 'compare', label: 'Compare', title: '本地 / 远端分支对比' },
          ]}
        />
        <button
          type="button"
          className={`onyx-mini-btn${fetching ? ' is-busy' : ''}`}
          title="Fetch Remotes（git fetch --all --prune）"
          disabled={fetching}
          onClick={() => void fetchRemotes()}
        >
          <RefreshCw size={13} strokeWidth={ICON_STROKE} className={fetching ? 'onyx-spin' : undefined} />
        </button>
      </div>
      {tab === 'changes' && <ChangesView />}
      {tab === 'graph' && <CommitDetailPanel />}
      {tab === 'compare' && <ComparePanel />}
    </div>
  );
}

function ChangesView() {
  const status = useGitStore((s) => s.status);
  const log = useGitStore((s) => s.log);
  const busy = useGitStore((s) => s.busy);
  const commit = useGitStore((s) => s.commit);
  const stage = useGitStore((s) => s.stage);
  const unstage = useGitStore((s) => s.unstage);
  const discard = useGitStore((s) => s.discard);
  const revealCommit = useGitStore((s) => s.revealCommit);
  const [message, setMessage] = useState('');

  if (!status) return null;

  const doCommit = async () => {
    if (await commit(message)) setMessage('');
  };
  const nothing = status.staged.length === 0 && status.changes.length === 0;

  return (
    <>
      <div className="onyx-commit-box">
        <textarea
          className="onyx-commit-input"
          placeholder="Commit message..."
          value={message}
          spellCheck={false}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void doCommit();
            }
          }}
        />
        <button
          type="button"
          className="onyx-primary-btn"
          disabled={busy || nothing || !message.trim()}
          title={`Commit (${formatShortcut('Cmd+Enter')})`}
          onClick={() => void doCommit()}
        >
          {busy ? 'Committing...' : 'Commit'}
        </button>
      </div>

      <div className="onyx-git-scroll">
        <Section
          title="Staged Changes"
          count={status.staged.length}
          actions={
            status.staged.length > 0 && (
              <button
                type="button"
                className="onyx-mini-btn"
                title="Unstage All"
                onClick={() => void unstage(status.staged.map((c) => c.path))}
              >
                <Minus size={14} strokeWidth={ICON_STROKE} />
              </button>
            )
          }
        >
          {status.staged.map((c) => (
            <ChangeRow key={`s:${c.path}`} change={c} />
          ))}
        </Section>

        <Section
          title="Changes"
          count={status.changes.length}
          actions={
            status.changes.length > 0 && (
              <>
                <button
                  type="button"
                  className="onyx-mini-btn"
                  title="Discard All"
                  onClick={() => void discard(status.changes.map((c) => c.path))}
                >
                  <Undo2 size={13} strokeWidth={ICON_STROKE} />
                </button>
                <button
                  type="button"
                  className="onyx-mini-btn"
                  title="Stage All"
                  onClick={() => void stage(status.changes.map((c) => c.path))}
                >
                  <Plus size={14} strokeWidth={ICON_STROKE} />
                </button>
              </>
            )
          }
        >
          {status.changes.map((c) => (
            <ChangeRow key={`c:${c.path}`} change={c} />
          ))}
        </Section>

        <div className="onyx-recent">
          <Section title="Recent Commits" count={log.length}>
            {log.length === 0 && <div className="onyx-empty-hint is-inline">暂无提交记录</div>}
            {log.map((c) => (
              <div
                key={c.hash}
                className="onyx-commit-row is-clickable"
                title={`${c.hash}\n${c.author}\n${c.message}\n\n点击在 Git 树中查看`}
                onClick={() => revealCommit(c.hash)}
              >
                <span className="onyx-commit-hash">{c.shortHash}</span>
                <span className="onyx-commit-body">
                  <span className="onyx-commit-msg">{c.message.split('\n')[0]}</span>
                  <span className="onyx-commit-time">{c.relativeTime}</span>
                </span>
              </div>
            ))}
          </Section>
        </div>
      </div>
    </>
  );
}
