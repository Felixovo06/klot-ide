import { useEffect, useState, type ReactNode } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { lspStatus } from '../lib/ipcClient';
import type { LspServerStatus } from '../types/ipc';
import { usePluginStore } from '../stores/pluginStore';
import { useUiStore } from '../stores/uiStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { BUILTIN_SHORTCUTS, formatShortcut } from './shortcuts';
import { ICON_STROKE, Kbd, Segmented } from './ui';

function Modal({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  const setModal = useUiStore((s) => s.setModal);
  return (
    <div className="onyx-scrim" onMouseDown={() => setModal(null)}>
      <div className="onyx-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="onyx-modal-head">
          <span className="onyx-modal-title">{title}</span>
          <div className="onyx-modal-actions">
            {actions}
            <button type="button" className="onyx-mini-btn" title="关闭 (Esc)" onClick={() => setModal(null)}>
              <X size={14} strokeWidth={ICON_STROKE} />
            </button>
          </div>
        </div>
        <div className="onyx-modal-body">{children}</div>
      </div>
    </div>
  );
}

function ExtensionsModal() {
  const plugins = usePluginStore((s) => s.plugins);
  const reload = usePluginStore((s) => s.reload);
  const runPlugin = usePluginStore((s) => s.runPlugin);
  const ctx = useWorkspaceStore((s) => s.ctx);
  return (
    <Modal
      title="Extensions"
      actions={
        <button type="button" className="onyx-mini-btn" title="重新加载插件" onClick={() => void reload()}>
          <RefreshCw size={13} strokeWidth={ICON_STROKE} />
        </button>
      }
    >
      <div className="onyx-modal-note">
        自生长插件目录：<code>{ctx?.onyxPluginsDir || '~/.ke/plugins'}</code> 与 <code>&lt;workspace&gt;/.ke/plugins</code>
        ，保存 plugin.json 后自动热加载。
      </div>
      {plugins.length === 0 && <div className="onyx-empty-hint is-inline">尚未加载任何插件</div>}
      <div className="onyx-ext-list">
        {plugins.map((p) => (
          <div key={p.id} className="onyx-ext-row">
            <div className="onyx-ext-main">
              <div className="onyx-ext-name">
                {p.name}
                <span className="onyx-ext-version">v{p.version}</span>
              </div>
              {p.description && <div className="onyx-ext-desc">{p.description}</div>}
              <div className="onyx-ext-meta">
                <span className="onyx-tag">{p.slot}</span>
                <span className="onyx-tag">{p.scope}</span>
                <span className="onyx-tag">{p.runtime}</span>
                {p.triggers?.shortcut && <Kbd>{formatShortcut(p.triggers.shortcut)}</Kbd>}
                {p.triggers?.intervalMs ? <span className="onyx-tag">every {p.triggers.intervalMs} ms</span> : null}
              </div>
              <div className="onyx-ext-path">{p.sourceDir}</div>
            </div>
            <button type="button" className="onyx-ghost-btn" onClick={() => void runPlugin(p.id)}>
              Run
            </button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function SettingsModal() {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const ctx = useWorkspaceStore((s) => s.ctx);
  const root = useWorkspaceStore((s) => s.root);
  const [lsp, setLsp] = useState<LspServerStatus[] | null>(null);

  useEffect(() => {
    if (!root) return;
    lspStatus(root)
      .then(setLsp)
      .catch(() => setLsp([]));
  }, [root]);

  return (
    <Modal title="Settings">
      <div className="onyx-setting-row">
        <span className="onyx-setting-label">Application</span>
        <span className="onyx-setting-value">Klot IDE (KE)</span>
      </div>
      <div className="onyx-setting-row">
        <span className="onyx-setting-label">Theme</span>
        <Segmented
          size="sm"
          value={theme}
          onChange={setTheme}
          options={[
            { value: 'light', label: 'Onyx Light' },
            { value: 'dark', label: 'Onyx Dark' },
          ]}
        />
      </div>
      <div className="onyx-setting-row">
        <span className="onyx-setting-label">Workspace</span>
        <code className="onyx-setting-value">{root || '-'}</code>
      </div>
      <div className="onyx-setting-row">
        <span className="onyx-setting-label">Platform</span>
        <span className="onyx-setting-value">{ctx?.platform ?? '-'}</span>
      </div>
      <div className="onyx-setting-row">
        <span className="onyx-setting-label">Available CLIs</span>
        <span className="onyx-setting-value">{ctx?.availableClis.join(', ') || '-'}</span>
      </div>
      <div className="onyx-setting-row is-block">
        <span className="onyx-setting-label">Language Servers</span>
        <div className="onyx-lsp-list">
          {lsp === null && <span className="onyx-dim">Loading...</span>}
          {lsp?.map((s) => (
            <div key={s.lang} className="onyx-lsp-row">
              <span className={`onyx-run-dot ${s.running ? 'is-success' : s.available ? 'is-warning' : 'is-idle'}`} />
              <span className="onyx-lsp-lang">{s.lang}</span>
              <code className="onyx-dim">{s.command}</code>
              <span className="onyx-lsp-state">{s.running ? 'running' : s.available ? 'available' : 'not installed'}</span>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function ShortcutsModal() {
  const plugins = usePluginStore((s) => s.plugins);
  const pluginKeys = plugins.filter((p) => p.triggers?.shortcut);
  return (
    <Modal title="Keyboard Shortcuts">
      <div className="onyx-keys">
        {BUILTIN_SHORTCUTS.map((s) => (
          <div key={s.keys} className="onyx-keys-row">
            <span>{s.label}</span>
            <Kbd>{formatShortcut(s.keys)}</Kbd>
          </div>
        ))}
        {pluginKeys.length > 0 && <div className="onyx-menu-section">Plugins</div>}
        {pluginKeys.map((p) => (
          <div key={p.id} className="onyx-keys-row">
            <span>{p.name}</span>
            <Kbd>{formatShortcut(p.triggers!.shortcut!)}</Kbd>
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function InfoModals() {
  const modal = useUiStore((s) => s.modal);
  if (modal === 'extensions') return <ExtensionsModal />;
  if (modal === 'settings') return <SettingsModal />;
  if (modal === 'shortcuts') return <ShortcutsModal />;
  return null;
}
