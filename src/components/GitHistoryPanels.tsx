// Git 左栏的 Graph（提交详情）与 Compare（分支对比）视图
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ArrowUpDown,
  Check,
  ChevronDown,
  Cloud,
  Copy,
  FolderGit2,
  GitBranch,
  GitCommitHorizontal,
  Search,
} from 'lucide-react';
import type { GitFileChange } from '../types/ipc';
import { useGitStore, WORKTREE_REF } from '../stores/gitStore';
import { toast } from '../stores/uiStore';
import { basename, dirname } from '../stores/utils';
import { GitStatusLetter, ICON_STROKE, Segmented, useDismiss } from './ui';

/** 只读文件行：用于提交详情与对比结果的文件列表 */
function HistoryFileRow({
  file,
  selected,
  onSelect,
}: {
  file: GitFileChange;
  selected: boolean;
  onSelect: () => void;
}) {
  const add = file.additions ?? 0;
  const del = file.deletions ?? 0;
  return (
    <div
      className={`onyx-change-row is-history${selected ? ' is-selected' : ''}${file.status === 'D' ? ' is-deleted' : ''}`}
      title={file.oldPath ? `${file.oldPath} -> ${file.path}` : file.path}
      onClick={onSelect}
    >
      <GitStatusLetter status={file.status} />
      <span className="onyx-change-path">
        {dirname(file.path) && <span className="onyx-change-dir">{dirname(file.path)}/</span>}
        <span className="onyx-change-name">{basename(file.path)}</span>
      </span>
      <span className="onyx-change-stats">
        <span className="onyx-stat-add">+{add}</span>
        <span className="onyx-stat-del">-{del}</span>
      </span>
    </div>
  );
}

function copyText(text: string, label: string) {
  void navigator.clipboard
    ?.writeText(text)
    .then(() => toast('success', `已复制${label}`))
    .catch(() => toast('warning', '复制失败'));
}

// ==================== Graph：提交详情 ====================

export function CommitDetailPanel() {
  const detail = useGitStore((s) => s.commitDetail);
  const loading = useGitStore((s) => s.commitDetailLoading);
  const graphLoaded = useGitStore((s) => s.graphLoaded);
  const nodes = useGitStore((s) => s.graphNodes);
  const fileSel = useGitStore((s) => s.commitFileSelected);
  const selectFile = useGitStore((s) => s.selectCommitFile);
  const selectCommit = useGitStore((s) => s.selectCommit);

  if (graphLoaded && nodes.length === 0) {
    return (
      <div className="onyx-git-side-empty">
        <GitCommitHorizontal size={18} strokeWidth={ICON_STROKE} />
        <span>还没有提交记录</span>
        <span className="onyx-dim">在 Changes 中完成首次提交后，这里会显示提交详情</span>
      </div>
    );
  }
  if (!detail) {
    return <div className="onyx-empty-hint">{loading || !graphLoaded ? 'Loading...' : '在右侧 Git 树中选择一个提交'}</div>;
  }

  const parents = detail.parents;
  return (
    <div className="onyx-git-scroll">
      <div className="onyx-commit-card">
        <div className="onyx-commit-card-subject">{detail.subject}</div>
        {detail.body.trim() && <div className="onyx-commit-card-body">{detail.body.trim()}</div>}
        <div className="onyx-commit-card-meta">
          <div className="onyx-commit-card-row">
            <span className="onyx-commit-card-key">Commit</span>
            <button
              type="button"
              className="onyx-commit-card-hash"
              title={`${detail.hash}\n点击复制完整 Hash`}
              onClick={() => copyText(detail.hash, '提交 Hash')}
            >
              {detail.shortHash}
              <Copy size={11} strokeWidth={ICON_STROKE} />
            </button>
          </div>
          <div className="onyx-commit-card-row">
            <span className="onyx-commit-card-key">Author</span>
            <span className="onyx-commit-card-val" title={detail.authorEmail}>
              {detail.author}
            </span>
          </div>
          <div className="onyx-commit-card-row">
            <span className="onyx-commit-card-key">Date</span>
            <span className="onyx-commit-card-val" title={new Date(detail.timestamp * 1000).toLocaleString()}>
              {detail.relativeTime}
            </span>
          </div>
          <div className="onyx-commit-card-row">
            <span className="onyx-commit-card-key">{parents.length > 1 ? 'Parents' : 'Parent'}</span>
            <span className="onyx-commit-card-val">
              {parents.length === 0 && <span className="onyx-dim">根提交</span>}
              {parents.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="onyx-commit-card-parent"
                  title={`跳转到 ${p}`}
                  onClick={() => void selectCommit(p)}
                >
                  {p.slice(0, 7)}
                </button>
              ))}
            </span>
          </div>
        </div>
      </div>
      <div className="onyx-git-section">
        <div className="onyx-git-section-head is-static">
          <span className="onyx-git-section-title">Changed Files</span>
          <span className="onyx-git-section-actions">
            <span className="onyx-stat-add">+{detail.totalAdditions}</span>
            <span className="onyx-stat-del">-{detail.totalDeletions}</span>
          </span>
          <span className="onyx-git-section-count">({detail.files.length})</span>
        </div>
        <div className="onyx-git-section-body">
          {detail.files.length === 0 && <div className="onyx-empty-hint is-inline">该提交没有文件改动</div>}
          {detail.files.map((f) => (
            <HistoryFileRow
              key={`${f.oldPath ?? ''}:${f.path}`}
              file={f}
              selected={fileSel?.path === f.path}
              onSelect={() => void selectFile(f)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ==================== Compare：分支对比 ====================

function refLabel(ref: string): string {
  return ref === WORKTREE_REF ? 'Working Tree' : ref;
}

function RefPicker({
  label,
  value,
  allowWorktree,
  onChange,
}: {
  label: string;
  value: string;
  allowWorktree: boolean;
  onChange: (ref: string) => void;
}) {
  const branches = useGitStore((s) => s.branches);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
  }, []);
  useDismiss(ref, open, close);

  const q = query.trim().toLowerCase();
  const groups = useMemo(() => {
    const match = (n: string) => !q || n.toLowerCase().includes(q);
    const local = branches.filter((b) => !b.isRemote && match(b.name));
    const remote = branches.filter((b) => b.isRemote && !b.name.endsWith('/HEAD') && match(b.name));
    return { local, remote, worktree: allowWorktree && (!q || 'working tree worktree 工作区'.includes(q)) };
  }, [branches, q, allowWorktree]);

  const pick = (r: string) => {
    close();
    if (r !== value) onChange(r);
  };

  // 允许直接输入任意引用（Tag、提交 Hash 等）
  const custom = query.trim();
  const showCustom =
    custom.length > 0 && !branches.some((b) => b.name === custom) && custom !== WORKTREE_REF;

  return (
    <div className="onyx-ref-picker" ref={ref}>
      <span className="onyx-ref-picker-label">{label}</span>
      <button
        type="button"
        className={`onyx-ref-picker-btn${open ? ' is-open' : ''}`}
        title={refLabel(value)}
        onClick={() => setOpen((v) => !v)}
      >
        {value === WORKTREE_REF ? (
          <FolderGit2 size={13} strokeWidth={ICON_STROKE} />
        ) : branches.find((b) => b.name === value)?.isRemote ? (
          <Cloud size={13} strokeWidth={ICON_STROKE} />
        ) : (
          <GitBranch size={13} strokeWidth={ICON_STROKE} />
        )}
        <span className="onyx-ref-picker-value">{refLabel(value) || '选择引用'}</span>
        <ChevronDown size={12} strokeWidth={ICON_STROKE} className="onyx-dim" />
      </button>
      {open && (
        <div className="onyx-menu onyx-ref-menu">
          <label className="onyx-ref-search">
            <Search size={13} strokeWidth={ICON_STROKE} />
            <input
              autoFocus
              value={query}
              spellCheck={false}
              placeholder="搜索分支，或输入 Tag / Hash"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && custom) {
                  e.preventDefault();
                  const exact = branches.find((b) => b.name.toLowerCase() === custom.toLowerCase());
                  pick(exact ? exact.name : custom);
                }
              }}
            />
          </label>
          <div className="onyx-ref-menu-scroll">
            {groups.worktree && (
              <>
                <div className="onyx-menu-section">Working Tree</div>
                <RefItem icon="worktree" name="Working Tree" sub="当前工作区（含未提交改动）" active={value === WORKTREE_REF} onClick={() => pick(WORKTREE_REF)} />
              </>
            )}
            {groups.local.length > 0 && <div className="onyx-menu-section">Local Branches</div>}
            {groups.local.map((b) => (
              <RefItem
                key={`l:${b.name}`}
                icon="local"
                name={b.name}
                sub={b.isCurrent ? '当前分支' : undefined}
                active={value === b.name}
                onClick={() => pick(b.name)}
              />
            ))}
            {groups.remote.length > 0 && <div className="onyx-menu-section">Remote Branches</div>}
            {groups.remote.map((b) => (
              <RefItem key={`r:${b.name}`} icon="remote" name={b.name} active={value === b.name} onClick={() => pick(b.name)} />
            ))}
            {showCustom && (
              <>
                <div className="onyx-menu-section">Custom Ref</div>
                <RefItem icon="local" name={custom} sub="按回车使用该引用" active={false} onClick={() => pick(custom)} />
              </>
            )}
            {!groups.worktree && groups.local.length === 0 && groups.remote.length === 0 && !showCustom && (
              <div className="onyx-menu-empty">没有匹配的分支</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RefItem({
  icon,
  name,
  sub,
  active,
  onClick,
}: {
  icon: 'worktree' | 'local' | 'remote';
  name: string;
  sub?: string;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = icon === 'worktree' ? FolderGit2 : icon === 'remote' ? Cloud : GitBranch;
  return (
    <button type="button" className={`onyx-menu-item${sub ? ' is-two-line' : ''}`} onClick={onClick} title={name}>
      <Icon size={14} strokeWidth={ICON_STROKE} />
      <span className="onyx-menu-label">
        <span>{name}</span>
        {sub && <span className="onyx-menu-sub">{sub}</span>}
      </span>
      {active && <Check size={14} strokeWidth={ICON_STROKE} className="onyx-accent" />}
    </button>
  );
}

export function ComparePanel() {
  const base = useGitStore((s) => s.compareBase);
  const head = useGitStore((s) => s.compareHead);
  const threeDot = useGitStore((s) => s.compareThreeDot);
  const result = useGitStore((s) => s.compareResult);
  const loading = useGitStore((s) => s.compareLoading);
  const error = useGitStore((s) => s.compareError);
  const fileSel = useGitStore((s) => s.compareFileSelected);
  const setRefs = useGitStore((s) => s.setCompareRefs);
  const swap = useGitStore((s) => s.swapCompareRefs);
  const setThreeDot = useGitStore((s) => s.setCompareThreeDot);
  const selectFile = useGitStore((s) => s.selectCompareFile);
  const revealCommit = useGitStore((s) => s.revealCommit);

  return (
    <>
      <div className="onyx-compare-box">
        <div className="onyx-compare-refs">
          <div className="onyx-compare-pickers">
            <RefPicker label="Base" value={base} allowWorktree={false} onChange={(r) => setRefs(r, head)} />
            <RefPicker label="Compare" value={head} allowWorktree onChange={(r) => setRefs(base, r)} />
          </div>
          <button
            type="button"
            className="onyx-mini-btn onyx-compare-swap"
            title="对调 Base 与 Compare"
            disabled={head === WORKTREE_REF}
            onClick={swap}
          >
            <ArrowUpDown size={13} strokeWidth={ICON_STROKE} />
          </button>
        </div>
        <div className="onyx-compare-mode">
          <Segmented
            size="sm"
            value={threeDot ? 'three' : 'two'}
            onChange={(v) => setThreeDot(v === 'three')}
            options={[
              { value: 'three', label: '...', title: '共同祖先分叉差异（base...compare）' },
              { value: 'two', label: '..', title: '直接树差异（base..compare）' },
            ]}
          />
          <span className="onyx-compare-mode-hint">{threeDot ? '自分叉点起的改动' : '两端快照直接对比'}</span>
        </div>
        {result && (
          <div className="onyx-compare-summary">
            <span className="onyx-compare-pill is-ahead" title={`${refLabel(head)} 领先 ${refLabel(base)} 的提交数`}>
              Ahead +{result.ahead}
            </span>
            <span className="onyx-compare-pill is-behind" title={`${refLabel(head)} 落后 ${refLabel(base)} 的提交数`}>
              Behind -{result.behind}
            </span>
            <span className="onyx-compare-total">
              <span className="onyx-stat-add">+{result.totalAdditions}</span>
              <span className="onyx-stat-del">-{result.totalDeletions}</span>
            </span>
          </div>
        )}
      </div>
      <div className="onyx-git-scroll">
        {loading && !result && <div className="onyx-empty-hint">正在对比...</div>}
        {error && !loading && <div className="onyx-empty-hint is-error">{error}</div>}
        {result && (
          <>
            <div className="onyx-git-section">
              <div className="onyx-git-section-head is-static">
                <span className="onyx-git-section-title">Changed Files</span>
                <span className="onyx-git-section-count">({result.files.length})</span>
              </div>
              <div className="onyx-git-section-body">
                {result.files.length === 0 && <div className="onyx-empty-hint is-inline">没有文件差异</div>}
                {result.files.map((f) => (
                  <HistoryFileRow
                    key={`${f.oldPath ?? ''}:${f.path}`}
                    file={f}
                    selected={fileSel?.path === f.path}
                    onSelect={() => void selectFile(f)}
                  />
                ))}
              </div>
            </div>
            <div className="onyx-git-section">
              <div className="onyx-git-section-head is-static">
                <span className="onyx-git-section-title">Commits</span>
                <span className="onyx-git-section-count">({result.commits.length})</span>
              </div>
              <div className="onyx-git-section-body">
                {result.commits.length === 0 && (
                  <div className="onyx-empty-hint is-inline">
                    {head === WORKTREE_REF ? '工作区差异不包含新提交' : '没有领先的提交'}
                  </div>
                )}
                {result.commits.map((c) => (
                  <div
                    key={c.hash}
                    className="onyx-commit-row is-clickable"
                    title={`${c.hash}\n${c.author}\n${c.message}\n\n点击在 Git 树中查看`}
                    onClick={() => revealCommit(c.hash)}
                  >
                    <span className="onyx-commit-hash">{c.shortHash}</span>
                    <span className="onyx-commit-body">
                      <span className="onyx-commit-msg">{c.message.split('\n')[0]}</span>
                      <span className="onyx-commit-time">
                        {c.author} · {c.relativeTime}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
