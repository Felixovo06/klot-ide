import { create } from 'zustand';
import { isTauriRuntime, ptyKill, ptySpawn, ptyWrite } from '../lib/ipcClient';
import {
  createTerminalEntry,
  disposeTerminal,
  fitTerminal,
  getTerminalEntry,
} from '../components/terminalRegistry';
import { useGitStore } from './gitStore';
import { toast, useUiStore } from './uiStore';
import { chipRef, debounce, errorMessage, uid } from './utils';
import { useWorkspaceStore } from './workspaceStore';

/** 内置 CLI 的完整显示名；Tab 上展示命令短名，新建菜单与 tooltip 展示完整名称与命令 */
export const CLI_DISPLAY_NAMES: Record<string, string> = {
  claude: 'Claude Code',
  agy: 'Antigravity',
  pi: 'Pi',
  codex: 'Codex',
  zsh: 'Terminal',
};

/** 初始标签与新建菜单的优先顺序 */
export const PREFERRED_CLIS = ['claude', 'agy', 'pi', 'codex'] as const;

export function cliDisplayName(cmd: string): string {
  return CLI_DISPLAY_NAMES[cmd] ?? cmd;
}

/** 新建菜单候选：按优先顺序排列可用 CLI，并始终附带系统终端 */
export function orderedCliOptions(available: string[]): string[] {
  const preferred = PREFERRED_CLIS.filter((c) => available.includes(c));
  const rest = available.filter((c) => !(PREFERRED_CLIS as readonly string[]).includes(c));
  const out = [...preferred, ...rest];
  if (!out.includes('zsh')) out.push('zsh');
  return out;
}

// 右侧终端输出静止 1 秒后静默同步 Git 状态与分支（CLI 代理改动文件或提交后自动联动左侧改动列表）
const silentGitSync = debounce(() => {
  const git = useGitStore.getState();
  void git.refresh({ silent: true });
  void git.refreshBranches();
}, 1000);

export type CliSessionStatus = 'idle' | 'starting' | 'running' | 'error';

// 仅在浏览器预览（非 Tauri 宿主）下回放的演示会话，对齐定稿图右侧 claude 终端输出；路径可被 LinkProvider 点击跳转
const DEMO_LINK = '\x1b[38;2;62;142;209m';
const DEMO_DIM = '\x1b[38;2;113;113;122m';
const DEMO_OK = '\x1b[38;2;88;152;63m';
const DEMO_ERR = '\x1b[38;2;240;81;81m';
const DEMO_BOLD = '\x1b[1m';
const DEMO_RESET = '\x1b[0m';
const BROWSER_DEMO_TRANSCRIPT = [
  `${DEMO_BOLD}$ claude${DEMO_RESET}`,
  '',
  `> Read: ${DEMO_LINK}src/core/refund.service.ts${DEMO_RESET}`,
  `${DEMO_DIM}  \u2514 Read 84 lines (1-84)${DEMO_RESET}`,
  '',
  `> Read: ${DEMO_LINK}src/core/idempotency.ts${DEMO_RESET}`,
  `${DEMO_DIM}  \u2514 Read 16 lines (1-16)${DEMO_RESET}`,
  '',
  `> Edit: ${DEMO_LINK}src/core/refund.service.ts${DEMO_RESET}`,
  `${DEMO_DIM}  \u2514 Updated lines 18-32 (${DEMO_OK}+22${DEMO_DIM} ${DEMO_ERR}-6${DEMO_DIM})${DEMO_RESET}`,
  '',
  `> Run: pnpm test -t refund`,
  '',
  `  Test Files  ${DEMO_OK}1 passed${DEMO_RESET} (1)`,
  `       Tests  ${DEMO_OK}4 passed${DEMO_RESET} (4)`,
  `${DEMO_DIM}    Duration  412ms${DEMO_RESET}`,
  '',
  `> Done. Refund service updated with`,
  `  idempotent refund logic (L18-32).`,
  `  see ${DEMO_LINK}src/core/refund.service.ts#L18-32${DEMO_RESET}`,
  '',
  '',
].join('\r\n');

export interface CliSession {
  id: string;
  cmd: string;
  title: string;
  status: CliSessionStatus;
  pid: number | null;
}

export interface ContextChip {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
}

interface CliState {
  sessions: CliSession[];
  activeId: string | null;
  chips: ContextChip[];
  availableClis: string[];

  initSessions: (clis: string[]) => void;
  addSession: (cmd: string) => string;
  activate: (id: string) => void;
  closeSession: (id: string) => void;
  addChip: (chip: Omit<ContextChip, 'id'>) => void;
  removeChip: (id: string) => void;
  clearChips: () => void;
  submit: (draft: string) => Promise<boolean>;
  sendPrompt: (prompt: string) => Promise<boolean>;
}

const spawnPromises = new Map<string, Promise<boolean>>();

export const useCliStore = create<CliState>()((set, get) => {
  const patchSession = (id: string, patch: Partial<CliSession>) =>
    set((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));

  const ensureSpawned = (id: string): Promise<boolean> => {
    const pending = spawnPromises.get(id);
    if (pending) return pending;
    const session = get().sessions.find((x) => x.id === id);
    if (!session) return Promise.resolve(false);
    const entry = createTerminalEntry(id);
    const ws = useWorkspaceStore.getState();
    patchSession(id, { status: 'starting' });
    fitTerminal(id);
    if (!isTauriRuntime() && session.cmd === 'claude') {
      entry.term.write(BROWSER_DEMO_TRANSCRIPT);
    }
    const promise = ptySpawn(
      {
        id,
        cmd: session.cmd,
        args: [],
        cwd: ws.root,
        cols: entry.term.cols,
        rows: entry.term.rows,
        activeFile: ws.activePath,
        theme: useUiStore.getState().theme,
      },
      (bytes) => {
        getTerminalEntry(id)?.term.write(bytes);
        silentGitSync();
      },
    )
      .then((info) => {
        entry.spawned = true;
        entry.lastCols = entry.term.cols;
        entry.lastRows = entry.term.rows;
        patchSession(id, { status: 'running', pid: info.pid });
        requestAnimationFrame(() => fitTerminal(id));
        return true;
      })
      .catch((e) => {
        entry.term.write(`\r\n\x1b[31m无法启动 ${session.cmd}：${errorMessage(e)}\x1b[0m\r\n`);
        patchSession(id, { status: 'error' });
        spawnPromises.delete(id);
        return false;
      });
    spawnPromises.set(id, promise);
    return promise;
  };

  const writeToActive = async (payload: string): Promise<boolean> => {
    let { activeId } = get();
    if (!activeId) {
      const cmd = orderedCliOptions(get().availableClis)[0] ?? 'zsh';
      activeId = get().addSession(cmd);
    }
    const ok = await ensureSpawned(activeId);
    if (!ok) return false;
    const entry = getTerminalEntry(activeId);
    const multiline = payload.includes('\n');
    const body =
      multiline && entry?.term.modes.bracketedPasteMode ? `\x1b[200~${payload}\x1b[201~` : payload;
    try {
      await ptyWrite(activeId, `${body}\r`);
      return true;
    } catch (e) {
      toast('error', `发送到 CLI 失败：${errorMessage(e)}`);
      return false;
    }
  };

  return {
    sessions: [],
    activeId: null,
    chips: [],
    availableClis: [],

    initSessions: (clis) => {
      // 启动时只记录本机可用 CLI，不预建标签、不拉起任何进程；右侧舱显示 CLI 启动器首页，由用户选择后再开启会话
      set({ availableClis: clis });
    },

    addSession: (cmd) => {
      const sameCount = get().sessions.filter((x) => x.cmd === cmd).length;
      const session: CliSession = {
        id: uid(`pty-${cmd}`),
        cmd,
        title: sameCount > 0 ? `${cmd} ${sameCount + 1}` : cmd,
        status: 'idle',
        pid: null,
      };
      createTerminalEntry(session.id);
      set((s) => ({ sessions: [...s.sessions, session], activeId: session.id }));
      void ensureSpawned(session.id);
      return session.id;
    },

    activate: (id) => {
      set({ activeId: id });
      void ensureSpawned(id);
    },

    closeSession: (id) => {
      const { sessions, activeId } = get();
      const idx = sessions.findIndex((x) => x.id === id);
      if (idx < 0) return;
      const entry = getTerminalEntry(id);
      if (entry?.spawned) ptyKill(id).catch(() => {});
      spawnPromises.delete(id);
      disposeTerminal(id);
      const next = sessions.filter((x) => x.id !== id);
      let nextActive = activeId;
      if (activeId === id) nextActive = (next[idx] ?? next[idx - 1])?.id ?? null;
      set({ sessions: next, activeId: nextActive });
      if (nextActive) void ensureSpawned(nextActive);
    },

    addChip: (chip) =>
      set((s) => {
        if (
          s.chips.some(
            (c) => c.path === chip.path && c.startLine === chip.startLine && c.endLine === chip.endLine,
          )
        ) {
          return s;
        }
        return { chips: [...s.chips, { ...chip, id: uid('chip') }] };
      }),

    removeChip: (id) => set((s) => ({ chips: s.chips.filter((c) => c.id !== id) })),
    clearChips: () => set({ chips: [] }),

    submit: async (draft) => {
      const refs = get().chips.map((c) => chipRef(c.path, c.startLine, c.endLine));
      const text = draft.trim();
      const payload = [...refs, text].filter(Boolean).join(' ');
      if (!payload) return false;
      const ok = await writeToActive(payload);
      if (ok) set({ chips: [] });
      return ok;
    },

    sendPrompt: async (prompt) => {
      useUiStore.getState().setCliVisible(true);
      return writeToActive(prompt);
    },
  };
});
