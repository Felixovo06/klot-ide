// 应用启动编排：取上下文 -> 文件树/监听 -> Git -> 任务 -> 插件 -> CLI 会话
import {
  appGetContext,
  fsWatchWorkspace,
  isTauriRuntime,
  onFsChanged,
  onLspDiagnostics,
} from '../lib/ipcClient';
import type { AppContextInfo, FsChangedEvent } from '../types/ipc';
import {
  applyLspDiagnostics,
  setMonacoHooks,
  setMonacoWorkspaceRoot,
} from '../components/monacoSetup';
import { invalidateAssetPaths } from '../components/markdownAssets';
import { setTerminalLinkHandler } from '../components/terminalRegistry';
import { useCliStore } from './cliStore';
import { useGitStore } from './gitStore';
import { usePluginStore } from './pluginStore';
import { useRunStore } from './runStore';
import { toast, useUiStore } from './uiStore';
import { debounce, errorMessage, joinPath, normalizeSlashes, trimTrailingSlash } from './utils';
import {
  normalizeWorkspacePath,
  readLastWorkspace,
  repoNameOf,
  useWorkspaceStore,
} from './workspaceStore';

let started = false;

/** 判断变更路径是否位于 .git 目录内部（相对或绝对路径均可） */
export function isGitInternalPath(path: string): boolean {
  const p = normalizeSlashes(path);
  return p === '.git' || p.startsWith('.git/') || p.includes('/.git/') || p.endsWith('/.git');
}

/** 静默同步 Git 多仓库汇总、状态与分支列表（失败不弹 toast） */
function syncGitSilently() {
  const git = useGitStore.getState();
  void git.refreshRepos({ silent: true });
  void git.refresh({ silent: true });
  void git.refreshBranches();
}

const FALLBACK_CONTEXT: AppContextInfo = {
  defaultWorkspace: '',
  homeDir: '',
  platform: 'unknown',
  availableClis: [],
  onyxPluginsDir: '',
};

export async function bootstrapApp() {
  if (started) return;
  started = true;

  setMonacoHooks({
    onDirtyChange: (fullPath, dirty) => useWorkspaceStore.getState().setDirtyByFull(fullPath, dirty),
    onContentChange: (fullPath) => useWorkspaceStore.getState().scheduleAutoSave(fullPath),
    onOpenFile: (fullPath, line, column) => {
      useUiStore.getState().setMode('code');
      void useWorkspaceStore.getState().openFile(fullPath, { line, column });
    },
  });

  setTerminalLinkHandler((path, line, endLine) => {
    useUiStore.getState().setMode('code');
    void useWorkspaceStore.getState().openFile(path, { line, endLine });
  });

  let ctx: AppContextInfo;
  try {
    ctx = await appGetContext();
  } catch (e) {
    toast('error', `读取应用上下文失败：${errorMessage(e)}`);
    ctx = FALLBACK_CONTEXT;
  }

  const ws = useWorkspaceStore.getState();
  ws.setContext(ctx);
  const defaultRoot = normalizeWorkspacePath(ctx.defaultWorkspace);
  let root = defaultRoot;
  const last = !ctx.fromCliArg ? readLastWorkspace() : null;
  if (last && last !== defaultRoot) {
    ws.setActiveRoot(last);
    setMonacoWorkspaceRoot(last);
    const ok = await ws.refreshTree({ silent: true });
    if (ok) {
      root = last;
    } else {
      toast('warning', `上次打开的目录已不存在，已回退到 ${repoNameOf(defaultRoot) || defaultRoot}`);
      root = defaultRoot;
      ws.setActiveRoot(defaultRoot);
      setMonacoWorkspaceRoot(defaultRoot);
      if (defaultRoot) await ws.refreshTree();
    }
  } else {
    if (root) {
      ws.setActiveRoot(root);
      setMonacoWorkspaceRoot(root);
      await ws.refreshTree();
    }
  }
  if (!root) return;
  ws.recordRecent(root, { asLast: true });
  fsWatchWorkspace(root).catch(() => {});

  const git = useGitStore.getState();
  await git.refreshRepos();
  void useRunStore.getState().discover();
  void usePluginStore.getState().init(root);
  useCliStore.getState().initSessions(ctx.availableClis);

  // 打开初始文件：优先展示有改动的文件
  const status = useGitStore.getState().status;
  if (status?.isRepo) {
    const seen = new Set<string>();
    const changed = [...status.changes, ...status.staged]
      .filter((c) => c.status !== 'D' && !seen.has(c.path) && seen.add(c.path))
      .map((c) => useGitStore.getState().toWorkspaceRel(c.path))
      .sort((a, b) => Number(a.startsWith('tests/')) - Number(b.startsWith('tests/')));
    const initial = isTauriRuntime() ? changed.slice(0, 1) : changed.slice(0, 4);
    for (let i = 0; i < initial.length; i += 1) {
      await useWorkspaceStore.getState().openFile(initial[i], { activate: i === 0 });
    }
  }

  // 文件系统变更：动态对比当前激活工作区 root（支持 switchWorkspace 后持续联动）；
  // 任何变更都同步 Git 状态与分支；仅工作树（非 .git 内部）变更才刷新文件树并热重载无未保存修改的已打开文件
  const pendingPaths = new Set<string>();
  let pendingEventRoot = '';
  const flush = debounce(() => {
    const currentRoot = trimTrailingSlash(normalizeSlashes(useWorkspaceStore.getState().root));
    if (pendingEventRoot && pendingEventRoot !== currentRoot) {
      pendingPaths.clear();
      return;
    }
    const paths = Array.from(pendingPaths);
    pendingPaths.clear();
    syncGitSilently();
    const workPaths = paths.filter((p) => !isGitInternalPath(p));
    if (paths.length > 0 && workPaths.length === 0) return;
    if (workPaths.length > 0 && currentRoot) {
      invalidateAssetPaths(workPaths.map((p) => joinPath(currentRoot, p)));
    }
    const state = useWorkspaceStore.getState();
    void state.refreshTree();
    void state.reloadFromDisk(workPaths.length > 0 ? workPaths : undefined);
  }, 180);

  // 切换到 Git 模式、窗口重新获得焦点时自动同步
  useUiStore.subscribe((s, prev) => {
    if (s.mode === 'git' && prev.mode !== 'git') syncGitSilently();
  });
  window.addEventListener('focus', () => syncGitSilently());

  await onFsChanged((ev: FsChangedEvent) => {
    const activeRoot = trimTrailingSlash(normalizeSlashes(useWorkspaceStore.getState().root));
    const eventRoot = ev.root ? trimTrailingSlash(normalizeSlashes(ev.root)) : activeRoot;
    if (!activeRoot || eventRoot !== activeRoot) return;
    pendingEventRoot = eventRoot;
    ev.paths.forEach((p) => pendingPaths.add(p));
    flush();
  });

  await onLspDiagnostics((ev) => applyLspDiagnostics(ev));
}
