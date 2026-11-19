import { create } from 'zustand';
import { taskDiscover, taskRestart, taskRun, taskStop } from '../lib/ipcClient';
import type { TaskDefinition, TaskOutputEvent } from '../types/ipc';
import { toast, useUiStore } from './uiStore';
import { errorMessage, stripAnsi } from './utils';
import { useWorkspaceStore } from './workspaceStore';

export type LogTone = 'out' | 'err' | 'info' | 'error';

export interface LogLine {
  id: number;
  text: string;
  tone: LogTone;
  ts: number;
}

export type RunStatus = 'starting' | 'running' | 'exited' | 'stopped' | 'failed';

export interface RunInfo {
  runId: string | null;
  taskId: string;
  name: string;
  command: string;
  status: RunStatus;
  exitCode: number | null;
  url: string | null;
}

export interface DrawerTab {
  id: string;
  title: string;
  format: 'markdown' | 'table';
  content?: string;
  columns?: string[];
  rows?: Array<Array<string | number>>;
  updatedAt: number;
}

interface RunState {
  tasks: TaskDefinition[];
  selectedTaskId: string | null;
  run: RunInfo | null;
  logs: LogLine[];
  drawerTabs: DrawerTab[];
  activeDrawerTab: string;

  discover: () => Promise<void>;
  selectTask: (id: string) => void;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  restart: () => Promise<void>;
  clear: () => void;
  appendLog: (text: string, tone: LogTone) => void;
  upsertDrawerTab: (tab: Omit<DrawerTab, 'updatedAt'>) => void;
  closeDrawerTab: (id: string) => void;
  setActiveDrawerTab: (id: string) => void;
}

const MAX_LOG_LINES = 4000;
const URL_PATTERN = /https?:\/\/[^\s'"<>)]+/;
let logId = 0;
let runToken = 0;

function makeLines(text: string, tone: LogTone): LogLine[] {
  const now = Date.now();
  return text.split('\n').map((line) => {
    logId += 1;
    return { id: logId, text: line, tone, ts: now };
  });
}

export const useRunStore = create<RunState>()((set, get) => {
  // 每次运行生成一个事件处理闭包，按换行缓冲 stdout/stderr 片段
  const makeHandler = (token: number) => {
    const buffers: Record<'stdout' | 'stderr', string> = { stdout: '', stderr: '' };
    const flush = (stream: 'stdout' | 'stderr') => {
      if (buffers[stream]) {
        get().appendLog(buffers[stream], stream === 'stderr' ? 'err' : 'out');
        buffers[stream] = '';
      }
    };
    return (ev: TaskOutputEvent) => {
      if (token !== runToken) return;
      if (ev.event === 'exit') {
        flush('stdout');
        flush('stderr');
        const run = get().run;
        if (run && run.status !== 'stopped') {
          const code = ev.data.code;
          set({
            run: {
              ...run,
              runId: ev.data.runId,
              status: code === 0 ? 'exited' : 'failed',
              exitCode: code,
            },
          });
          get().appendLog(
            `Process exited with ${code === null ? `signal ${ev.data.signal ?? 'unknown'}` : `code ${code}`}`,
            code === 0 ? 'info' : 'error',
          );
        }
        return;
      }
      const stream = ev.event;
      const text = buffers[stream] + stripAnsi(ev.data.chunk).replace(/\r\n/g, '\n').replace(/\r/g, '');
      const lastNl = text.lastIndexOf('\n');
      if (lastNl < 0) {
        buffers[stream] = text;
        return;
      }
      buffers[stream] = text.slice(lastNl + 1);
      const complete = text.slice(0, lastNl);
      get().appendLog(complete, stream === 'stderr' ? 'err' : 'out');
      const run = get().run;
      if (run && !run.url) {
        const m = complete.match(URL_PATTERN);
        if (m) set({ run: { ...run, url: m[0].replace(/[.,;]+$/, '') } });
      }
    };
  };

  const currentTask = (): TaskDefinition | null => {
    const { tasks, selectedTaskId } = get();
    return tasks.find((t) => t.id === selectedTaskId) ?? tasks[0] ?? null;
  };

  return {
    tasks: [],
    selectedTaskId: null,
    run: null,
    logs: [],
    drawerTabs: [],
    activeDrawerTab: 'run',

    discover: async () => {
      const root = useWorkspaceStore.getState().root;
      if (!root) return;
      try {
        const tasks = await taskDiscover(root);
        set((s) => ({
          tasks,
          selectedTaskId:
            s.selectedTaskId && tasks.some((t) => t.id === s.selectedTaskId)
              ? s.selectedTaskId
              : (tasks.find((t) => /dev/.test(t.name)) ?? tasks[0])?.id ?? null,
        }));
      } catch {
        set({ tasks: [] });
      }
    },

    selectTask: (id) => set({ selectedTaskId: id }),

    start: async () => {
      const task = currentTask();
      if (!task) {
        toast('info', '当前工作区没有可运行的任务');
        return;
      }
      const prev = get().run;
      if (prev && prev.runId && isRunActive(prev)) {
        await get().restart();
        return;
      }
      const root = useWorkspaceStore.getState().root;
      const token = ++runToken;
      set({
        run: {
          runId: null,
          taskId: task.id,
          name: task.name,
          command: task.command,
          status: 'starting',
          exitCode: null,
          url: null,
        },
        activeDrawerTab: 'run',
      });
      useUiStore.getState().setConsoleVisible(true);
      get().appendLog(`$ ${task.command}`, 'info');
      try {
        const handle = await taskRun(root, task.id, task.command, makeHandler(token));
        if (token !== runToken) return;
        const run = get().run;
        if (run && run.status === 'starting') {
          set({ run: { ...run, runId: handle.runId, status: 'running' } });
        } else if (run) {
          set({ run: { ...run, runId: handle.runId } });
        }
      } catch (e) {
        if (token !== runToken) return;
        const run = get().run;
        if (run) set({ run: { ...run, status: 'failed' } });
        get().appendLog(`启动失败：${errorMessage(e)}`, 'error');
      }
    },

    stop: async () => {
      const run = get().run;
      if (!run) return;
      if (run.runId) {
        try {
          await taskStop(run.runId);
        } catch (e) {
          toast('error', `停止任务失败：${errorMessage(e)}`);
          return;
        }
      }
      runToken += 1;
      const latest = get().run;
      if (latest) set({ run: { ...latest, status: 'stopped' } });
      get().appendLog('Stopped', 'info');
    },

    restart: async () => {
      const run = get().run;
      const task = currentTask();
      if (!run || !run.runId || !isRunActive(run)) {
        runToken += 1;
        if (run && isRunActive(run)) set({ run: { ...run, status: 'stopped' } });
        await get().start();
        return;
      }
      const root = useWorkspaceStore.getState().root;
      const target = task ?? null;
      const taskId = target?.id ?? run.taskId;
      const command = target?.command ?? run.command;
      const token = ++runToken;
      set({
        run: {
          runId: run.runId,
          taskId,
          name: target?.name ?? run.name,
          command,
          status: 'starting',
          exitCode: null,
          url: null,
        },
        activeDrawerTab: 'run',
      });
      useUiStore.getState().setConsoleVisible(true);
      get().appendLog(`Restarting: ${command}`, 'info');
      try {
        const handle = await taskRestart(root, run.runId, taskId, command, makeHandler(token));
        if (token !== runToken) return;
        const latest = get().run;
        if (latest) set({ run: { ...latest, runId: handle.runId, status: 'running' } });
      } catch (e) {
        if (token !== runToken) return;
        const latest = get().run;
        if (latest) set({ run: { ...latest, status: 'failed' } });
        get().appendLog(`重启失败：${errorMessage(e)}`, 'error');
      }
    },

    clear: () => set({ logs: [] }),

    appendLog: (text, tone) =>
      set((s) => {
        const next = s.logs.concat(makeLines(text, tone));
        return { logs: next.length > MAX_LOG_LINES ? next.slice(next.length - MAX_LOG_LINES) : next };
      }),

    upsertDrawerTab: (tab) =>
      set((s) => {
        const entry: DrawerTab = { ...tab, updatedAt: Date.now() };
        const exists = s.drawerTabs.some((t) => t.id === tab.id);
        return {
          drawerTabs: exists
            ? s.drawerTabs.map((t) => (t.id === tab.id ? entry : t))
            : [...s.drawerTabs, entry],
          activeDrawerTab: tab.id,
        };
      }),

    closeDrawerTab: (id) =>
      set((s) => ({
        drawerTabs: s.drawerTabs.filter((t) => t.id !== id),
        activeDrawerTab: s.activeDrawerTab === id ? 'run' : s.activeDrawerTab,
      })),

    setActiveDrawerTab: (activeDrawerTab) => set({ activeDrawerTab }),
  };
});

export function isRunActive(run: RunInfo | null): boolean {
  return !!run && (run.status === 'running' || run.status === 'starting');
}
