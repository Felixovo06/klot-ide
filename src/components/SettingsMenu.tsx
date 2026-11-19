import { useCallback, useRef, useState } from 'react';
import { AppWindow, FolderOpen, Keyboard, Moon, Puzzle, Settings, Sun, Zap } from 'lucide-react';
import { usePluginStore } from '../stores/pluginStore';
import { useUiStore } from '../stores/uiStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { formatShortcut } from './shortcuts';
import { ICON_STROKE, IconButton, useDismiss } from './ui';

export function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);
  const theme = useUiStore((s) => s.theme);
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const setModal = useUiStore((s) => s.setModal);
  const plugins = usePluginStore((s) => s.plugins);
  const runPlugin = usePluginStore((s) => s.runPlugin);
  const commands = plugins.filter((p) => p.slot === 'command' || p.slot === 'drawer_view');

  const item = (
    key: string,
    icon: React.ReactNode,
    label: string,
    hint: string | null,
    onClick: () => void,
  ) => (
    <button
      key={key}
      type="button"
      className="onyx-menu-item"
      onClick={() => {
        setOpen(false);
        onClick();
      }}
    >
      {icon}
      <span className="onyx-menu-label">{label}</span>
      {hint && <span className="onyx-menu-hint">{hint}</span>}
    </button>
  );

  return (
    <div className="onyx-popover-anchor" ref={ref}>
      <IconButton icon={Settings} title="设置菜单" active={open} onClick={() => setOpen((v) => !v)} />
      {open && (
        <div className="onyx-menu onyx-menu-right onyx-settings-menu">
          {item('open-folder', <FolderOpen size={15} strokeWidth={ICON_STROKE} />, 'Open Folder...', formatShortcut('Cmd+O'), () =>
            void useWorkspaceStore.getState().promptOpenWorkspace(),
          )}
          {item(
            'open-window',
            <AppWindow size={15} strokeWidth={ICON_STROKE} />,
            'Open in New Window...',
            formatShortcut('Cmd+Shift+O'),
            () => void useWorkspaceStore.getState().promptOpenWorkspaceInNewWindow(),
          )}
          <div className="onyx-menu-divider" />
          {item('ext', <Puzzle size={15} strokeWidth={ICON_STROKE} />, 'Extensions', formatShortcut('Cmd+Shift+X'), () =>
            setModal('extensions'),
          )}
          {item('settings', <Settings size={15} strokeWidth={ICON_STROKE} />, 'Settings', formatShortcut('Cmd+,'), () =>
            setModal('settings'),
          )}
          {item('keys', <Keyboard size={15} strokeWidth={ICON_STROKE} />, 'Keyboard Shortcuts', null, () =>
            setModal('shortcuts'),
          )}
          {item(
            'theme',
            theme === 'light' ? (
              <Sun size={15} strokeWidth={ICON_STROKE} />
            ) : (
              <Moon size={15} strokeWidth={ICON_STROKE} />
            ),
            `Theme: ${theme === 'light' ? 'Onyx Light' : 'Onyx Dark'}`,
            null,
            toggleTheme,
          )}
          {commands.length > 0 && <div className="onyx-menu-divider" />}
          {commands.length > 0 && <div className="onyx-menu-section">Plugins</div>}
          {commands.map((p) =>
            item(
              p.id,
              <Zap size={15} strokeWidth={ICON_STROKE} />,
              p.name,
              p.triggers?.shortcut ? formatShortcut(p.triggers.shortcut) : null,
              () => void runPlugin(p.id),
            ),
          )}
        </div>
      )}
    </div>
  );
}
