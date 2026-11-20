import { PanelBottom, PanelLeft, PanelRight, Search } from 'lucide-react';
import { useGitStore } from '../stores/gitStore';
import { usePluginStore } from '../stores/pluginStore';
import { useUiStore } from '../stores/uiStore';
import { BranchPicker } from './BranchPicker';
import { SettingsMenu } from './SettingsMenu';
import { TaskControls } from './TaskControls';
import { formatShortcut } from './shortcuts';
import { ICON_STROKE, IconButton, Segmented } from './ui';

function PluginStatusPills() {
  const plugins = usePluginStore((s) => s.plugins);
  const statuses = usePluginStore((s) => s.statuses);
  const running = usePluginStore((s) => s.running);
  const runPlugin = usePluginStore((s) => s.runPlugin);
  // 仅在插件给出明确结论（成功 / 警告 / 错误）时展示胶囊，隐藏中性态与尚无状态时的常驻文案
  const items = plugins.filter((p) => {
    if (p.slot !== 'topbar_status') return false;
    const tone = statuses[p.id]?.tone;
    return tone === 'success' || tone === 'warning' || tone === 'error';
  });
  if (items.length === 0) return null;
  return (
    <div className="onyx-status-pills">
      {items.map((p) => {
        const st = statuses[p.id];
        const tone = st?.tone ?? 'neutral';
        return (
          <button
            key={p.id}
            type="button"
            className={`onyx-status-pill is-${tone}${running[p.id] ? ' is-busy' : ''}`}
            title={st?.tooltip ?? p.description ?? p.name}
            onClick={() => void runPlugin(p.id)}
          >
            <span className="onyx-status-dot" />
            <span className="onyx-status-label">{st?.label ?? p.name}</span>
          </button>
        );
      })}
    </div>
  );
}

export function TopBar() {
  const mode = useUiStore((s) => s.mode);
  const setMode = useUiStore((s) => s.setMode);
  const leftVisible = useUiStore((s) => s.leftVisible);
  const toggleLeft = useUiStore((s) => s.toggleLeft);
  const cliVisible = useUiStore((s) => s.cliVisible);
  const toggleCli = useUiStore((s) => s.toggleCli);
  const consoleVisible = useUiStore((s) => s.consoleVisible);
  const toggleConsole = useUiStore((s) => s.toggleConsole);
  const openQuickOpen = useUiStore((s) => s.openQuickOpen);
  const gitCount = useGitStore((s) =>
    s.repos.length > 0
      ? s.repos.reduce((acc, r) => acc + r.changedCount, 0)
      : s.status?.isRepo
        ? s.status.totalChanges
        : 0
  );

  return (
    <header className="onyx-topbar" data-tauri-drag-region>
      <div className="onyx-topbar-left" data-tauri-drag-region>
        <IconButton
          icon={PanelLeft}
          title={`切换左侧栏 (${formatShortcut('Cmd+B')})`}
          active={!leftVisible}
          onClick={toggleLeft}
        />
        <BranchPicker />
      </div>

      <div className="onyx-topbar-center" data-tauri-drag-region>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'code', label: 'Code', title: `Code (${formatShortcut('Cmd+1')})` },
            {
              value: 'git',
              title: `Git (${formatShortcut('Cmd+2')})`,
              label: (
                <>
                  Git
                  {gitCount > 0 && <span className="onyx-count-badge">{gitCount}</span>}
                </>
              ),
            },
          ]}
        />
        <button type="button" className="onyx-search-trigger" onClick={() => openQuickOpen('')}>
          <Search size={14} strokeWidth={ICON_STROKE} />
          <span className="onyx-search-trigger-text">Search files or symbols...</span>
          <span className="onyx-search-trigger-key">{formatShortcut('Cmd+P')}</span>
        </button>
      </div>

      <div className="onyx-topbar-right" data-tauri-drag-region>
        <PluginStatusPills />
        <TaskControls />
        <IconButton
          icon={PanelBottom}
          title={`运行控制台 (${formatShortcut('Cmd+`')})`}
          active={consoleVisible}
          onClick={toggleConsole}
        />
        <IconButton
          icon={PanelRight}
          title={`CLI 舱 (${formatShortcut('Cmd+J')})`}
          active={cliVisible}
          onClick={toggleCli}
        />
        <SettingsMenu />
      </div>
    </header>
  );
}
