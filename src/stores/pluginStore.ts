import { create } from 'zustand';
import { onPluginsUpdated, pluginExecute, pluginList, pluginWatch } from '../lib/ipcClient';
import type {
  OnyxPluginManifest,
  PluginAction,
  PluginExecutionContext,
  TopbarStatusOutput,
} from '../types/ipc';
import { useCliStore } from './cliStore';
import { getCodeSelection, replaceCodeSelection } from './editorBridge';
import { fileSavedEvent } from './events';
import { changedFilePaths, statusSignature, useGitStore } from './gitStore';
import { useRunStore } from './runStore';
import { toast, useUiStore } from './uiStore';
import { debounce, errorMessage } from './utils';
import { useWorkspaceStore } from './workspaceStore';

interface PluginState {
  plugins: OnyxPluginManifest[];
  statuses: Record<string, TopbarStatusOutput>;
  running: Record<string, boolean>;

  init: (root: string) => Promise<void>;
  reload: () => Promise<void>;
  setPlugins: (plugins: OnyxPluginManifest[]) => void;
  runPlugin: (id: string) => Promise<void>;
}

const intervalTimers = new Map<string, ReturnType<typeof setInterval>>();
let initializedRoot = '';

export function buildPluginContext(): PluginExecutionContext {
  const ws = useWorkspaceStore.getState();
  const git = useGitStore.getState();
  const sel = ws.activePath ? getCodeSelection() : null;
  return {
    workspaceRoot: ws.root,
    branch: git.status?.branch ?? '',
    activeFile: ws.activePath,
    selection: sel,
    changedFiles: changedFilePaths(git.status),
  };
}

/** 插件动作统一调度器 */
export async function dispatchPluginActions(actions: PluginAction[], plugin?: OnyxPluginManifest) {
  for (const action of actions) {
    try {
      switch (action.type) {
        case 'toast':
          toast(action.tone, action.message);
          break;
        case 'open_file':
          useUiStore.getState().setMode('code');
          await useWorkspaceStore.getState().openFile(action.path, { line: action.line });
          break;
        case 'replace_selection':
          if (!replaceCodeSelection(action.text)) toast('warning', '当前没有可替换的编辑器选区');
          break;
        case 'run_console': {
          const run = useRunStore.getState();
          run.appendLog(action.text, action.tone === 'error' ? 'error' : 'info');
          run.setActiveDrawerTab('run');
          useUiStore.getState().setConsoleVisible(true);
          break;
        }
        case 'send_to_cli':
          await useCliStore.getState().sendPrompt(action.prompt);
          break;
        case 'render_drawer':
          useRunStore.getState().upsertDrawerTab({
            id: plugin ? `plugin:${plugin.id}` : `plugin:${action.title}`,
            title: action.title,
            format: action.format,
            content: action.content,
            columns: action.columns,
            rows: action.rows,
          });
          useUiStore.getState().setConsoleVisible(true);
          break;
        default:
          break;
      }
    } catch (e) {
      toast('error', `插件动作执行失败：${errorMessage(e)}`);
    }
  }
}

function clearTimers() {
  intervalTimers.forEach((t) => clearInterval(t));
  intervalTimers.clear();
}

export const usePluginStore = create<PluginState>()((set, get) => {
  const schedule = (plugins: OnyxPluginManifest[]) => {
    clearTimers();
    for (const p of plugins) {
      if (p.slot !== 'topbar_status') continue;
      void get().runPlugin(p.id);
      const interval = p.triggers?.intervalMs;
      if (interval && interval > 0) {
        intervalTimers.set(
          p.id,
          setInterval(() => void get().runPlugin(p.id), Math.max(1000, interval)),
        );
      }
    }
  };

  return {
    plugins: [],
    statuses: {},
    running: {},

    init: async (root) => {
      if (initializedRoot === root) return;
      initializedRoot = root;
      await get().reload();
      pluginWatch(root).catch(() => {});
      await onPluginsUpdated((payload) => {
        if (payload.root && payload.root !== useWorkspaceStore.getState().root) return;
        get().setPlugins(payload.plugins);
      });

      fileSavedEvent.on(() => {
        for (const p of get().plugins) if (p.triggers?.onSave) void get().runPlugin(p.id);
      });

      let lastSig = statusSignature(useGitStore.getState().status);
      const fireGitChange = debounce(() => {
        for (const p of get().plugins) if (p.triggers?.onGitChange) void get().runPlugin(p.id);
      }, 400);
      useGitStore.subscribe((state) => {
        const sig = statusSignature(state.status);
        if (sig !== lastSig) {
          lastSig = sig;
          fireGitChange();
        }
      });
    },

    reload: async () => {
      const root = useWorkspaceStore.getState().root;
      if (!root) return;
      try {
        get().setPlugins(await pluginList(root));
      } catch (e) {
        toast('error', `加载插件失败：${errorMessage(e)}`);
      }
    },

    setPlugins: (plugins) => {
      const ids = new Set(plugins.map((p) => p.id));
      set((s) => ({
        plugins,
        statuses: Object.fromEntries(Object.entries(s.statuses).filter(([id]) => ids.has(id))),
      }));
      schedule(plugins);
    },

    runPlugin: async (id) => {
      const plugin = get().plugins.find((p) => p.id === id);
      if (!plugin) return;
      if (get().running[id]) return;
      set((s) => ({ running: { ...s.running, [id]: true } }));
      try {
        const root = useWorkspaceStore.getState().root;
        const result = await pluginExecute(id, root, buildPluginContext());
        if (result.status) {
          set((s) => ({ statuses: { ...s.statuses, [id]: result.status! } }));
        }
        const actions = result.actions ?? [];
        if (result.exitCode !== 0 && actions.length === 0) {
          const detail = (result.stderr ?? '').trim().split('\n')[0];
          if (plugin.slot === 'topbar_status') {
            set((s) => ({
              statuses: {
                ...s.statuses,
                [id]: { label: plugin.name, tone: 'error', tooltip: detail || `exit ${result.exitCode}` },
              },
            }));
          } else {
            toast('error', `插件 ${plugin.name} 执行失败${detail ? `：${detail}` : ''}`);
          }
        }
        if (actions.length > 0) await dispatchPluginActions(actions, plugin);
      } catch (e) {
        if (plugin.slot === 'topbar_status') {
          set((s) => ({
            statuses: {
              ...s.statuses,
              [id]: { label: plugin.name, tone: 'error', tooltip: errorMessage(e) },
            },
          }));
        } else {
          toast('error', `插件 ${plugin.name} 执行失败：${errorMessage(e)}`);
        }
      } finally {
        set((s) => {
          const running = { ...s.running };
          delete running[id];
          return { running };
        });
      }
    },
  };
});
