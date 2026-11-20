import { create } from 'zustand';
import {
  gitBranches,
  gitCheckout,
  gitCommit,
  gitCommitDetail,
  gitCompareRefs,
  gitDiffCommitFile,
  gitDiffFile,
  gitDiffRefsFile,
  gitDiscard,
  gitFetch,
  gitGraph,
  gitInit,
  gitListRepos,
  gitLog,
  gitPull,
  gitPush,
  gitStage,
  gitStashList,
  gitStashPop,
  gitStashPush,
  gitStatus,
  gitUnstage,
} from '../lib/ipcClient';
import type {
  GitBranchInfo,
  GitCommitDetail,
  GitCommitInfo,
  GitCompareResult,
  GitDiffResult,
  GitFileChange,
  GitGraphNode,
  GitRepoSummary,
  GitStashEntry,
  GitStatusResult,
} from '../types/ipc';
import { toast } from './uiStore';
import { errorMessage, normalizeSlashes } from './utils';
import { useWorkspaceStore } from './workspaceStore';

export interface GitSelection {
  path: string;
  staged: boolean;
}

export type GitTab = 'changes' | 'graph' | 'compare';

/** Compare 视图中代表当前工作区（未提交改动）的特殊引用 */
export const WORKTREE_REF = 'WORKTREE';

interface GitState {
  status: GitStatusResult | null;
  log: GitCommitInfo[];
  branches: GitBranchInfo[];
  selected: GitSelection | null;
  diff: GitDiffResult | null;
  diffLoading: boolean;
  busy: boolean;
  statusVersion: number;
  initializing: boolean;

  // 多仓库支持
  repos: GitRepoSummary[];
  activeRepoRoot: string;
  activeRepoRel: string;

  // 三视图工作台
  gitTab: GitTab;
  fetching: boolean;
  remoteBusy: 'push' | 'pull' | 'stash' | null;
  stashes: GitStashEntry[];

  // Graph（Git 树）
  graphNodes: GitGraphNode[];
  graphAllBranches: boolean;
  graphLoading: boolean;
  graphLoaded: boolean;
  selectedCommitHash: string | null;
  commitDetail: GitCommitDetail | null;
  commitDetailLoading: boolean;
  commitFileSelected: GitFileChange | null;
  commitDiff: GitDiffResult | null;
  commitDiffLoading: boolean;

  // Compare（分支对比）
  compareBase: string;
  compareHead: string;
  compareThreeDot: boolean;
  compareResult: GitCompareResult | null;
  compareLoading: boolean;
  compareError: string | null;
  compareFileSelected: GitFileChange | null;
  compareDiff: GitDiffResult | null;
  compareDiffLoading: boolean;

  /** silent: 静默同步（失败不弹 toast），用于 CLI 输出静止、窗口聚焦等自动触发点 */
  refreshRepos: (opts?: { silent?: boolean }) => Promise<void>;
  selectRepo: (repoRootPath: string) => void;
  syncRepoByFilePath: (workspaceFileRel: string) => void;
  repoForFile: (workspaceFileRel: string) => GitRepoSummary | null;
  toWorkspaceRel: (repoRelPath: string) => string;
  refresh: (opts?: { silent?: boolean }) => Promise<void>;
  refreshBranches: () => Promise<void>;
  initRepo: () => Promise<boolean>;
  select: (sel: GitSelection | null) => void;
  loadDiff: (opts?: { silent?: boolean }) => Promise<void>;
  stage: (paths: string[]) => Promise<void>;
  unstage: (paths: string[]) => Promise<void>;
  discard: (paths: string[]) => Promise<void>;
  commit: (message: string) => Promise<boolean>;
  checkout: (branch: string, create?: boolean) => Promise<boolean>;

  setGitTab: (tab: GitTab) => void;
  fetchRemotes: () => Promise<void>;
  push: () => Promise<void>;
  pull: () => Promise<void>;
  stashPush: (message?: string) => Promise<boolean>;
  stashPop: (index?: number) => Promise<boolean>;

  loadGraph: (opts?: { silent?: boolean }) => Promise<void>;
  setGraphAllBranches: (all: boolean) => void;
  selectCommit: (hash: string | null) => Promise<void>;
  selectCommitFile: (file: GitFileChange | null) => Promise<void>;
  revealCommit: (hash: string) => void;

  ensureCompareDefaults: () => void;
  setCompareRefs: (base: string, head: string) => void;
  swapCompareRefs: () => void;
  setCompareThreeDot: (threeDot: boolean) => void;
  loadCompare: (opts?: { silent?: boolean }) => Promise<void>;
  selectCompareFile: (file: GitFileChange | null) => Promise<void>;
  resetForWorkspace: () => void;
}

let reposToken = 0;
let statusToken = 0;
let diffToken = 0;
let graphToken = 0;
let detailToken = 0;
let commitDiffToken = 0;
let compareToken = 0;
let compareDiffToken = 0;

function resetRepoTokens() {
  statusToken += 1;
  diffToken += 1;
  graphToken += 1;
  detailToken += 1;
  commitDiffToken += 1;
  compareToken += 1;
  compareDiffToken += 1;
}

function repoRootOf(): string {
  return useGitStore.getState().activeRepoRoot || useWorkspaceStore.getState().root;
}

export function joinRepoRel(repoRel: string, path: string): string {
  const clean = normalizeSlashes(path).replace(/^\.\//, '');
  if (!repoRel) return clean;
  if (!clean) return repoRel;
  return clean === repoRel || clean.startsWith(`${repoRel}/`) ? clean : `${repoRel}/${clean}`;
}

export function findRepoForFile(repos: GitRepoSummary[], workspaceFileRel: string): GitRepoSummary | null {
  if (repos.length === 0) return null;
  const rel = normalizeSlashes(workspaceFileRel).replace(/^\.\//, '');
  let best: GitRepoSummary | null = null;
  let bestLen = -1;
  for (const r of repos) {
    if (!r.relPath) {
      if (0 > bestLen) {
        best = r;
        bestLen = 0;
      }
      continue;
    }
    if (rel === r.relPath || rel.startsWith(`${r.relPath}/`)) {
      if (r.relPath.length > bestLen) {
        best = r;
        bestLen = r.relPath.length;
      }
    }
  }
  return best;
}

/** 按约定规则推导默认对比引用：优先 main / origin/main 对比当前分支，否则当前分支对比工作区 */
export function defaultCompareRefs(
  branches: GitBranchInfo[],
  current: string,
): { base: string; head: string } {
  const names = new Set(branches.map((b) => b.name));
  const candidates = ['origin/main', 'main', 'origin/master', 'master', current ? `origin/${current}` : ''];
  const base = candidates.find((c) => c && c !== current && names.has(c));
  if (base && current) return { base, head: current };
  return { base: current || 'HEAD', head: WORKTREE_REF };
}

function sameDiff(a: GitDiffResult | null, b: GitDiffResult): boolean {
  return (
    !!a &&
    a.path === b.path &&
    a.originalText === b.originalText &&
    a.modifiedText === b.modifiedText &&
    a.isBinary === b.isBinary &&
    a.isNewFile === b.isNewFile &&
    a.additions === b.additions &&
    a.deletions === b.deletions
  );
}

export const useGitStore = create<GitState>()((set, get) => ({
  repos: [],
  activeRepoRoot: '',
  activeRepoRel: '',

  status: null,
  log: [],
  branches: [],
  selected: null,
  diff: null,
  diffLoading: false,
  busy: false,
  statusVersion: 0,
  initializing: false,

  gitTab: 'changes',
  fetching: false,
  remoteBusy: null,
  stashes: [],

  graphNodes: [],
  graphAllBranches: true,
  graphLoading: false,
  graphLoaded: false,
  selectedCommitHash: null,
  commitDetail: null,
  commitDetailLoading: false,
  commitFileSelected: null,
  commitDiff: null,
  commitDiffLoading: false,

  compareBase: '',
  compareHead: '',
  compareThreeDot: true,
  compareResult: null,
  compareLoading: false,
  compareError: null,
  compareFileSelected: null,
  compareDiff: null,
  compareDiffLoading: false,

  refreshRepos: async (opts) => {
    const wsRoot = useWorkspaceStore.getState().root;
    if (!wsRoot) return;
    const token = ++reposToken;
    let repos: GitRepoSummary[] = [];
    try {
      repos = await gitListRepos(wsRoot);
    } catch {
      repos = [];
    }
    if (token !== reposToken) return;

    const prevActive = get().activeRepoRoot;
    const existing = prevActive ? repos.find((r) => r.rootPath === prevActive) : null;
    let target: GitRepoSummary | null = existing ?? null;
    if (!target && repos.length > 0) {
      const rootRepo = repos.find((r) => r.isRoot);
      const changedRepo = repos.find((r) => r.changedCount > 0);
      target =
        (rootRepo && (rootRepo.changedCount > 0 || !changedRepo) ? rootRepo : changedRepo) ??
        rootRepo ??
        repos[0] ??
        null;
    }

    const nextRoot = target?.rootPath ?? '';
    const nextRel = target?.relPath ?? '';
    const repoChanged = nextRoot !== prevActive;

    if (repoChanged) {
      resetRepoTokens();
      set({
        repos,
        activeRepoRoot: nextRoot,
        activeRepoRel: nextRel,
        selected: null,
        diff: null,
        diffLoading: false,
        graphNodes: [],
        graphLoading: false,
        graphLoaded: false,
        selectedCommitHash: null,
        commitDetail: null,
        commitDetailLoading: false,
        commitFileSelected: null,
        commitDiff: null,
        commitDiffLoading: false,
        compareBase: '',
        compareHead: '',
        compareResult: null,
        compareLoading: false,
        compareError: null,
        compareFileSelected: null,
        compareDiff: null,
        compareDiffLoading: false,
      });
    } else {
      set({ repos, activeRepoRel: nextRel });
    }

    if (repoChanged || !get().status) {
      await Promise.all([get().refresh(opts), get().refreshBranches()]);
      const { gitTab } = get();
      if (gitTab === 'graph') void get().loadGraph({ silent: true });
      if (gitTab === 'compare') {
        get().ensureCompareDefaults();
        void get().loadCompare({ silent: true });
      }
    }
  },

  selectRepo: (repoRootPath) => {
    const target = get().repos.find((r) => r.rootPath === repoRootPath);
    if (!target) return;
    if (target.rootPath === get().activeRepoRoot && get().status) return;
    resetRepoTokens();
    set({
      activeRepoRoot: target.rootPath,
      activeRepoRel: target.relPath,
      selected: null,
      diff: null,
      diffLoading: false,
      graphNodes: [],
      graphLoading: false,
      graphLoaded: false,
      selectedCommitHash: null,
      commitDetail: null,
      commitDetailLoading: false,
      commitFileSelected: null,
      commitDiff: null,
      commitDiffLoading: false,
      compareBase: '',
      compareHead: '',
      compareResult: null,
      compareLoading: false,
      compareError: null,
      compareFileSelected: null,
      compareDiff: null,
      compareDiffLoading: false,
    });
    void get().refresh({ silent: true });
    void get().refreshBranches();
    const { gitTab } = get();
    if (gitTab === 'graph') void get().loadGraph({ silent: true });
    if (gitTab === 'compare') {
      get().ensureCompareDefaults();
      void get().loadCompare({ silent: true });
    }
  },

  repoForFile: (workspaceFileRel) => findRepoForFile(get().repos, workspaceFileRel),

  syncRepoByFilePath: (workspaceFileRel) => {
    const hit = get().repoForFile(workspaceFileRel);
    if (hit && hit.rootPath !== get().activeRepoRoot) {
      get().selectRepo(hit.rootPath);
    }
  },

  toWorkspaceRel: (repoRelPath) => joinRepoRel(get().activeRepoRel, repoRelPath),

  setGitTab: (gitTab) => {
    set({ gitTab });
    if (gitTab === 'graph' && !get().graphLoaded) void get().loadGraph();
    if (gitTab === 'compare') {
      get().ensureCompareDefaults();
      if (!get().compareResult) void get().loadCompare();
    }
  },

  fetchRemotes: async () => {
    const root = repoRootOf();
    if (!root || get().fetching) return;
    set({ fetching: true });
    try {
      await gitFetch(root);
      toast('success', '已从远端抓取最新引用');
    } catch (e) {
      toast('warning', `抓取远端失败：${errorMessage(e)}`);
    } finally {
      set({ fetching: false });
      await Promise.all([get().refresh({ silent: true }), get().refreshBranches()]);
      const { gitTab, graphLoaded, compareResult } = get();
      if (gitTab === 'graph' || graphLoaded) await get().loadGraph({ silent: true });
      if (gitTab === 'compare' || compareResult) await get().loadCompare({ silent: true });
    }
  },

  push: async () => {
    const root = repoRootOf();
    if (!root || get().remoteBusy) return;
    set({ remoteBusy: 'push' });
    try {
      const msg = await gitPush(root);
      toast('success', msg || '已推送到远端');
    } catch (e) {
      toast('error', `推送失败：${errorMessage(e)}`);
    } finally {
      set({ remoteBusy: null });
      await Promise.all([get().refresh({ silent: true }), get().refreshBranches()]);
      if (get().graphLoaded) void get().loadGraph({ silent: true });
    }
  },

  pull: async () => {
    const root = repoRootOf();
    if (!root || get().remoteBusy) return;
    set({ remoteBusy: 'pull' });
    try {
      const msg = await gitPull(root);
      toast('success', msg || '已从远端拉取最新提交');
      await Promise.all([
        useWorkspaceStore.getState().refreshTree({ silent: true }),
        useWorkspaceStore.getState().reloadFromDisk(),
      ]);
    } catch (e) {
      toast('error', `拉取失败：${errorMessage(e)}`);
    } finally {
      set({ remoteBusy: null });
      await Promise.all([get().refresh({ silent: true }), get().refreshBranches()]);
      if (get().graphLoaded) void get().loadGraph({ silent: true });
    }
  },

  stashPush: async (message) => {
    const root = repoRootOf();
    if (!root || get().remoteBusy) return false;
    set({ remoteBusy: 'stash' });
    try {
      await gitStashPush(root, message?.trim() || null);
      toast('success', '已将当前改动暂存到 Stash');
      await Promise.all([
        useWorkspaceStore.getState().refreshTree({ silent: true }),
        useWorkspaceStore.getState().reloadFromDisk(),
      ]);
      return true;
    } catch (e) {
      toast('error', `Stash 失败：${errorMessage(e)}`);
      return false;
    } finally {
      set({ remoteBusy: null });
      await get().refresh({ silent: true });
    }
  },

  stashPop: async (index) => {
    const root = repoRootOf();
    if (!root || get().remoteBusy) return false;
    set({ remoteBusy: 'stash' });
    try {
      await gitStashPop(root, index ?? 0);
      toast('success', '已恢复 Stash 改动');
      await Promise.all([
        useWorkspaceStore.getState().refreshTree({ silent: true }),
        useWorkspaceStore.getState().reloadFromDisk(),
      ]);
      return true;
    } catch (e) {
      toast('error', `恢复 Stash 失败：${errorMessage(e)}`);
      return false;
    } finally {
      set({ remoteBusy: null });
      await get().refresh({ silent: true });
    }
  },

  loadGraph: async (opts) => {
    const root = repoRootOf();
    if (!root) return;
    const { status } = get();
    if (status && !status.isRepo) {
      set({ graphNodes: [], graphLoaded: true, graphLoading: false });
      return;
    }
    const token = ++graphToken;
    set({ graphLoading: true });
    try {
      const nodes = await gitGraph(root, 150, get().graphAllBranches);
      if (token !== graphToken) return;
      set({ graphNodes: nodes, graphLoaded: true, graphLoading: false });
      const { selectedCommitHash } = get();
      const stillThere = selectedCommitHash && nodes.some((n) => n.hash === selectedCommitHash);
      if (!stillThere) void get().selectCommit(nodes[0]?.hash ?? null);
    } catch (e) {
      if (token !== graphToken) return;
      set({ graphNodes: [], graphLoaded: true, graphLoading: false });
      if (!opts?.silent) toast('error', `读取提交历史失败：${errorMessage(e)}`);
    }
  },

  setGraphAllBranches: (graphAllBranches) => {
    set({ graphAllBranches });
    void get().loadGraph();
  },

  selectCommit: async (hash) => {
    const root = repoRootOf();
    const token = ++detailToken;
    commitDiffToken += 1;
    set({
      selectedCommitHash: hash,
      commitFileSelected: null,
      commitDiff: null,
      commitDiffLoading: false,
    });
    if (!hash || !root) {
      set({ commitDetail: null, commitDetailLoading: false });
      return;
    }
    if (get().commitDetail?.hash !== hash) set({ commitDetailLoading: true });
    try {
      const detail = await gitCommitDetail(root, hash);
      if (token !== detailToken) return;
      set({ commitDetail: detail, commitDetailLoading: false });
      if (detail.files[0]) void get().selectCommitFile(detail.files[0]);
    } catch (e) {
      if (token !== detailToken) return;
      set({ commitDetail: null, commitDetailLoading: false });
      toast('error', `读取提交详情失败：${errorMessage(e)}`);
    }
  },

  selectCommitFile: async (file) => {
    const root = repoRootOf();
    const hash = get().selectedCommitHash;
    const token = ++commitDiffToken;
    set({ commitFileSelected: file });
    if (!file || !hash || !root) {
      set({ commitDiff: null, commitDiffLoading: false });
      return;
    }
    set({ commitDiffLoading: true });
    try {
      const diff = await gitDiffCommitFile(root, hash, file.path, file.oldPath ?? null);
      if (token !== commitDiffToken) return;
      set({ commitDiff: diff, commitDiffLoading: false });
    } catch (e) {
      if (token !== commitDiffToken) return;
      set({ commitDiff: null, commitDiffLoading: false });
      toast('error', `读取提交 Diff 失败：${errorMessage(e)}`);
    }
  },

  revealCommit: (hash) => {
    set({ gitTab: 'graph' });
    void (async () => {
      if (!get().graphLoaded) await get().loadGraph({ silent: true });
      await get().selectCommit(hash);
    })();
  },

  ensureCompareDefaults: () => {
    const { compareBase, compareHead, branches, status } = get();
    if (compareBase && compareHead) return;
    const { base, head } = defaultCompareRefs(branches, status?.branch ?? '');
    set({ compareBase: base, compareHead: head });
  },

  setCompareRefs: (compareBase, compareHead) => {
    set({ compareBase, compareHead, compareFileSelected: null, compareDiff: null });
    void get().loadCompare();
  },

  swapCompareRefs: () => {
    const { compareBase, compareHead } = get();
    // 工作区只能作为对比目标；对调时若基准会变成工作区则保持原样并提示
    if (compareHead === WORKTREE_REF) {
      toast('info', '工作区只能作为对比目标，无法对调');
      return;
    }
    get().setCompareRefs(compareHead, compareBase);
  },

  setCompareThreeDot: (compareThreeDot) => {
    set({ compareThreeDot, compareFileSelected: null, compareDiff: null });
    void get().loadCompare();
  },

  loadCompare: async (opts) => {
    const root = repoRootOf();
    get().ensureCompareDefaults();
    const { compareBase, compareHead, compareThreeDot, status } = get();
    if (!root || !compareBase || !compareHead) return;
    if (status && !status.isRepo) return;
    const token = ++compareToken;
    set({ compareLoading: true, compareError: null });
    try {
      const result = await gitCompareRefs(root, compareBase, compareHead, compareThreeDot);
      if (token !== compareToken) return;
      set({ compareResult: result, compareLoading: false });
      const { compareFileSelected } = get();
      const keep = compareFileSelected && result.files.find((f) => f.path === compareFileSelected.path);
      void get().selectCompareFile(keep ?? result.files[0] ?? null);
    } catch (e) {
      if (token !== compareToken) return;
      const msg = errorMessage(e);
      set({ compareResult: null, compareLoading: false, compareError: msg, compareFileSelected: null, compareDiff: null });
      if (!opts?.silent) toast('warning', `分支对比失败：${msg}`);
    }
  },

  selectCompareFile: async (file) => {
    const root = repoRootOf();
    const { compareBase, compareHead, compareThreeDot } = get();
    const token = ++compareDiffToken;
    set({ compareFileSelected: file });
    if (!file || !root) {
      set({ compareDiff: null, compareDiffLoading: false });
      return;
    }
    set({ compareDiffLoading: true });
    try {
      const diff = await gitDiffRefsFile(root, compareBase, compareHead, file.path, file.oldPath ?? null, compareThreeDot);
      if (token !== compareDiffToken) return;
      set({ compareDiff: diff, compareDiffLoading: false });
    } catch (e) {
      if (token !== compareDiffToken) return;
      set({ compareDiff: null, compareDiffLoading: false });
      toast('error', `读取对比 Diff 失败：${errorMessage(e)}`);
    }
  },

  refresh: async (opts) => {
    const root = repoRootOf();
    if (!root) return;
    const token = ++statusToken;
    const prevTop = get().log[0]?.hash ?? '';
    try {
      const [status, log, stashes] = await Promise.all([
        gitStatus(root),
        gitLog(root, 20).catch(() => [] as GitCommitInfo[]),
        gitStashList(root).catch(() => [] as GitStashEntry[]),
      ]);
      if (token !== statusToken || repoRootOf() !== root) return;
      set((s) => ({
        status,
        log: status.isRepo ? log : [],
        stashes: status.isRepo ? stashes : [],
        repos: s.repos.map((r) =>
          r.rootPath === root
            ? {
                ...r,
                branch: status.branch || r.branch,
                ahead: status.ahead,
                behind: status.behind,
                changedCount: status.totalChanges,
              }
            : r,
        ),
        statusVersion: s.statusVersion + 1,
      }));
    } catch {
      if (token !== statusToken || repoRootOf() !== root) return;
      set((s) => ({
        status: {
          isRepo: false,
          branch: '',
          ahead: 0,
          behind: 0,
          staged: [],
          changes: [],
          totalChanges: 0,
        },
        log: [],
        stashes: [],
        statusVersion: s.statusVersion + 1,
      }));
    }

    const { status, selected } = get();
    if (!status) return;
    // 提交历史顶部变化（新提交 / 切分支 / 抓取）时同步 Git 树；对比目标为工作区时同步差异
    const topNow = get().log[0]?.hash ?? '';
    if (topNow !== prevTop && get().graphLoaded) void get().loadGraph({ silent: true });
    if (get().gitTab === 'compare' && get().compareHead === WORKTREE_REF) void get().loadCompare({ silent: true });
    const exists =
      selected &&
      (selected.staged ? status.staged : status.changes).some((c) => c.path === selected.path);
    if (!exists) {
      const first = status.changes[0] ?? status.staged[0];
      get().select(first ? { path: first.path, staged: first.staged } : null);
    } else {
      void get().loadDiff(opts);
    }
  },

  initRepo: async () => {
    const root = repoRootOf();
    if (!root || get().initializing) return false;
    set({ initializing: true });
    try {
      await gitInit(root);
      toast('success', '已初始化 Git 仓库');
      return true;
    } catch (e) {
      toast('error', `初始化 Git 仓库失败：${errorMessage(e)}`);
      return false;
    } finally {
      set({ initializing: false });
      await get().refreshRepos();
      await useWorkspaceStore.getState().refreshTree();
    }
  },

  refreshBranches: async () => {
    const root = repoRootOf();
    if (!root) return;
    try {
      set({ branches: await gitBranches(root) });
    } catch {
      set({ branches: [] });
    }
  },

  select: (selected) => {
    set({ selected });
    if (!selected) {
      diffToken += 1;
      set({ diff: null, diffLoading: false });
      return;
    }
    void get().loadDiff();
  },

  loadDiff: async (opts) => {
    const root = repoRootOf();
    const { selected } = get();
    if (!root || !selected) return;
    const token = ++diffToken;
    set({ diffLoading: true });
    try {
      const diff = await gitDiffFile(root, selected.path, selected.staged);
      if (token !== diffToken) return;
      // 内容未变化时保留原对象，避免 Diff 编辑器重建模型导致闪烁与滚动位置丢失
      if (sameDiff(get().diff, diff)) set({ diffLoading: false });
      else set({ diff, diffLoading: false });
    } catch (e) {
      if (token !== diffToken) return;
      set({ diff: null, diffLoading: false });
      if (!opts?.silent) toast('error', `读取 Diff 失败：${errorMessage(e)}`);
    }
  },

  stage: async (paths) => {
    if (paths.length === 0) return;
    try {
      await gitStage(repoRootOf(), paths);
      const { selected } = get();
      if (selected && paths.includes(selected.path)) set({ selected: { ...selected, staged: true } });
    } catch (e) {
      toast('error', `暂存失败：${errorMessage(e)}`);
    }
    await get().refresh();
  },

  unstage: async (paths) => {
    if (paths.length === 0) return;
    try {
      await gitUnstage(repoRootOf(), paths);
      const { selected } = get();
      if (selected && paths.includes(selected.path)) set({ selected: { ...selected, staged: false } });
    } catch (e) {
      toast('error', `取消暂存失败：${errorMessage(e)}`);
    }
    await get().refresh();
  },

  discard: async (paths) => {
    if (paths.length === 0) return;
    const label = paths.length === 1 ? paths[0] : `${paths.length} 个文件`;
    if (!window.confirm(`确定丢弃 ${label} 的全部未暂存修改吗？此操作不可撤销。`)) return;
    try {
      await gitDiscard(repoRootOf(), paths);
      await useWorkspaceStore.getState().reloadFromDisk(paths.map((p) => get().toWorkspaceRel(p)));
    } catch (e) {
      toast('error', `丢弃修改失败：${errorMessage(e)}`);
    }
    await get().refresh();
  },

  commit: async (message) => {
    const msg = message.trim();
    if (!msg) {
      toast('warning', '请先填写提交信息');
      return false;
    }
    const { status } = get();
    if (!status || !status.isRepo) return false;
    set({ busy: true });
    try {
      if (status.staged.length === 0) {
        if (status.changes.length === 0) {
          toast('info', '没有可提交的改动');
          return false;
        }
        await gitStage(
          repoRootOf(),
          status.changes.map((c) => c.path),
        );
      }
      const info = await gitCommit(repoRootOf(), msg);
      toast('success', `已提交 ${info.shortHash} ${info.message}`);
      return true;
    } catch (e) {
      toast('error', `提交失败：${errorMessage(e)}`);
      return false;
    } finally {
      set({ busy: false });
      await get().refresh();
      void get().refreshRepos({ silent: true });
    }
  },

  checkout: async (branch, create = false) => {
    try {
      await gitCheckout(repoRootOf(), branch, create);
      toast('success', create ? `已创建并切换到 ${branch}` : `已切换到 ${branch}`);
      await Promise.all([get().refresh(), get().refreshBranches()]);
      void get().refreshRepos({ silent: true });
      await useWorkspaceStore.getState().refreshTree();
      await useWorkspaceStore.getState().reloadFromDisk();
      return true;
    } catch (e) {
      toast('error', `切换分支失败：${errorMessage(e)}`);
      return false;
    }
  },

  resetForWorkspace: () => {
    reposToken += 1;
    resetRepoTokens();
    set((s) => ({
      repos: [],
      activeRepoRoot: '',
      activeRepoRel: '',
      status: null,
      log: [],
      branches: [],
      selected: null,
      diff: null,
      diffLoading: false,
      busy: false,
      statusVersion: s.statusVersion + 1,
      initializing: false,
      gitTab: 'changes',
      fetching: false,
      remoteBusy: null,
      stashes: [],
      graphNodes: [],
      graphLoading: false,
      graphLoaded: false,
      selectedCommitHash: null,
      commitDetail: null,
      commitDetailLoading: false,
      commitFileSelected: null,
      commitDiff: null,
      commitDiffLoading: false,
      compareBase: '',
      compareHead: '',
      compareResult: null,
      compareLoading: false,
      compareError: null,
      compareFileSelected: null,
      compareDiff: null,
      compareDiffLoading: false,
    }));
  },
}));

export function changedFilePaths(status: GitStatusResult | null): string[] {
  if (!status) return [];
  const set = new Set<string>();
  for (const c of status.staged) set.add(c.path);
  for (const c of status.changes) set.add(c.path);
  return Array.from(set);
}

export function findChange(status: GitStatusResult | null, path: string): GitFileChange | null {
  if (!status) return null;
  return status.changes.find((c) => c.path === path) ?? status.staged.find((c) => c.path === path) ?? null;
}

export function statusSignature(status: GitStatusResult | null): string {
  if (!status) return '';
  return [
    status.branch,
    ...status.staged.map((c) => `s:${c.status}:${c.path}`),
    ...status.changes.map((c) => `c:${c.status}:${c.path}`),
  ].join('|');
}
