import { useEffect, useState, type ReactNode } from 'react';
import { Minus, Plus, RefreshCw, X } from 'lucide-react';
import { lspStatus } from '../lib/ipcClient';
import type { LspServerStatus } from '../types/ipc';
import { usePluginStore } from '../stores/pluginStore';
import { type MarkdownViewMode, useUiStore } from '../stores/uiStore';
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
  const prefs = useUiStore((s) => s.prefs);
  const setPref = useUiStore((s) => s.setPref);
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

      <div className="onyx-setting-section">Editor &amp; Terminal</div>
      <div className="onyx-setting-row">
        <span className="onyx-setting-label">Editor Font Size</span>
        <div className="onyx-stepper">
          <button
            type="button"
            className="onyx-stepper-btn"
            disabled={prefs.editorFontSize <= 12}
            onClick={() => setPref('editorFontSize', prefs.editorFontSize - 1)}
            title="减小字号"
          >
            <Minus size={12} strokeWidth={ICON_STROKE} />
          </button>
          <span className="onyx-stepper-val">{prefs.editorFontSize} px</span>
          <button
            type="button"
            className="onyx-stepper-btn"
            disabled={prefs.editorFontSize >= 18}
            onClick={() => setPref('editorFontSize', prefs.editorFontSize + 1)}
            title="增大字号"
          >
            <Plus size={12} strokeWidth={ICON_STROKE} />
          </button>
        </div>
      </div>
      <div className="onyx-setting-row">
        <span className="onyx-setting-label">Word Wrap</span>
        <Segmented
          size="sm"
          value={prefs.wordWrap}
          onChange={(v) => setPref('wordWrap', v)}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'on', label: 'On' },
          ]}
        />
      </div>
      <div className="onyx-setting-row">
        <span className="onyx-setting-label">Tab Size</span>
        <Segmented
          size="sm"
          value={String(prefs.tabSize) as '2' | '4'}
          onChange={(v) => setPref('tabSize', Number(v) as 2 | 4)}
          options={[
            { value: '2', label: '2 spaces' },
            { value: '4', label: '4 spaces' },
          ]}
        />
      </div>
      <div className="onyx-setting-row">
        <span className="onyx-setting-label">Markdown Default View</span>
        <Segmented<MarkdownViewMode>
          size="sm"
          value={prefs.markdownDefaultView}
          onChange={(v) => setPref('markdownDefaultView', v)}
          options={[
            { value: 'edit', label: 'Edit' },
            { value: 'split', label: 'Split' },
            { value: 'read', label: 'Read' },
          ]}
        />
      </div>
      <div className="onyx-setting-row">
        <span className="onyx-setting-label">Auto Save (1s)</span>
        <button
          type="button"
          role="switch"
          aria-checked={prefs.autoSave}
          className={`onyx-switch${prefs.autoSave ? ' is-on' : ''}`}
          onClick={() => setPref('autoSave', !prefs.autoSave)}
        >
          <span className="onyx-switch-thumb" />
        </button>
      </div>
      <div className="onyx-setting-row">
        <span className="onyx-setting-label">Trim Trailing Whitespace</span>
        <button
          type="button"
          role="switch"
          aria-checked={prefs.trimTrailingWhitespace}
          className={`onyx-switch${prefs.trimTrailingWhitespace ? ' is-on' : ''}`}
          onClick={() => setPref('trimTrailingWhitespace', !prefs.trimTrailingWhitespace)}
        >
          <span className="onyx-switch-thumb" />
        </button>
      </div>
      <div className="onyx-setting-row">
        <span className="onyx-setting-label">Terminal Font Size</span>
        <div className="onyx-stepper">
          <button
            type="button"
            className="onyx-stepper-btn"
            disabled={prefs.terminalFontSize <= 11}
            onClick={() => setPref('terminalFontSize', prefs.terminalFontSize - 0.5)}
            title="减小终端字号"
          >
            <Minus size={12} strokeWidth={ICON_STROKE} />
          </button>
          <span className="onyx-stepper-val">{prefs.terminalFontSize} px</span>
          <button
            type="button"
            className="onyx-stepper-btn"
            disabled={prefs.terminalFontSize >= 16}
            onClick={() => setPref('terminalFontSize', prefs.terminalFontSize + 0.5)}
            title="增大终端字号"
          >
            <Plus size={12} strokeWidth={ICON_STROKE} />
          </button>
        </div>
      </div>

      <div className="onyx-setting-section">Environment</div>
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
