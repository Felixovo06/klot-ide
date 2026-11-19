import { useCallback, useRef, useState } from 'react';
import {
  AtSign,
  Braces,
  ChevronRight,
  Orbit,
  Pi,
  Plus,
  Sparkles,
  SquareTerminal,
  X,
  type LucideIcon,
} from 'lucide-react';
import { cliDisplayName, orderedCliOptions, useCliStore } from '../stores/cliStore';
import { useUiStore } from '../stores/uiStore';
import { chipRef } from '../stores/utils';
import { CliInput } from './CliInput';
import { TerminalView } from './TerminalView';
import { ICON_STROKE, useDismiss } from './ui';

function NewSessionMenu() {
  const availableClis = useCliStore((s) => s.availableClis);
  const addSession = useCliStore((s) => s.addSession);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);
  const options = orderedCliOptions(availableClis);
  return (
    <div className="onyx-popover-anchor" ref={ref}>
      <button
        type="button"
        className={`onyx-cli-plus${open ? ' is-open' : ''}`}
        title="新建会话"
        onClick={() => setOpen((v) => !v)}
      >
        <Plus size={15} strokeWidth={ICON_STROKE} />
      </button>
      {open && (
        <div className="onyx-menu onyx-cli-menu">
          <div className="onyx-menu-section">New Session</div>
          {options.map((cmd) => (
            <button
              key={cmd}
              type="button"
              className="onyx-menu-item is-two-line"
              title={`${cliDisplayName(cmd)} (${cmd})`}
              onClick={() => {
                setOpen(false);
                addSession(cmd);
              }}
            >
              <SquareTerminal size={14} strokeWidth={ICON_STROKE} />
              <span className="onyx-menu-label">
                <span>{cliDisplayName(cmd)}</span>
                <span className="onyx-menu-sub">{cmd}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const CLI_ICONS: Record<string, LucideIcon> = {
  claude: Sparkles,
  agy: Orbit,
  pi: Pi,
  codex: Braces,
  zsh: SquareTerminal,
};

/** 无会话时的 CLI 启动器首页：按优先顺序卡片化展示本机可用 CLI，点击即在当前工作区拉起对应 PTY */
function CliLauncher({ options, onPick }: { options: string[]; onPick: (cmd: string) => void }) {
  const chips = useCliStore((s) => s.chips);
  const removeChip = useCliStore((s) => s.removeChip);
  return (
    <div className="onyx-cli-launcher">
      <div className="onyx-cli-launcher-head">
        <div className="onyx-cli-launcher-title">选择 CLI 开启会话</div>
        <div className="onyx-cli-launcher-sub">点击任一本机 CLI 在当前工作区启动交互式终端</div>
      </div>
      {chips.length > 0 && (
        <div className="onyx-cli-launcher-chips">
          <div className="onyx-cli-launcher-chips-label">
            <AtSign size={12} strokeWidth={ICON_STROKE} />
            已暂存 {chips.length} 处代码引用，开启会话后自动带入输入框
          </div>
          <div className="onyx-cli-launcher-chips-row">
            {chips.map((c) => (
              <span key={c.id} className="onyx-chip">
                <span className="onyx-chip-label">{chipRef(c.path, c.startLine, c.endLine)}</span>
                <button type="button" className="onyx-chip-x" title="移除引用" onClick={() => removeChip(c.id)}>
                  <X size={11} strokeWidth={ICON_STROKE} />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="onyx-cli-launcher-list">
        {options.map((cmd) => {
          const Icon = CLI_ICONS[cmd] ?? SquareTerminal;
          return (
            <button
              key={cmd}
              type="button"
              className="onyx-cli-launcher-item"
              title={`在当前工作区启动 ${cliDisplayName(cmd)}`}
              onClick={() => onPick(cmd)}
            >
              <span className="onyx-cli-launcher-icon">
                <Icon size={16} strokeWidth={ICON_STROKE} />
              </span>
              <span className="onyx-cli-launcher-text">
                <span className="onyx-cli-launcher-name">{cliDisplayName(cmd)}</span>
                <span className="onyx-cli-launcher-cmd">{cmd}</span>
              </span>
              <ChevronRight size={14} strokeWidth={ICON_STROKE} className="onyx-cli-launcher-arrow" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function RightCliDock() {
  const sessions = useCliStore((s) => s.sessions);
  const activeId = useCliStore((s) => s.activeId);
  const activate = useCliStore((s) => s.activate);
  const closeSession = useCliStore((s) => s.closeSession);
  const availableClis = useCliStore((s) => s.availableClis);
  const addSession = useCliStore((s) => s.addSession);
  const cliVisible = useUiStore((s) => s.cliVisible);
  const cliWidth = useUiStore((s) => s.cliWidth);

  return (
    <aside className="onyx-card onyx-cli" style={{ display: cliVisible ? 'flex' : 'none', width: cliWidth }}>
      {sessions.length === 0 ? (
        <div className="onyx-cli-tabs is-launcher">
          <div className="onyx-cli-heading">
            <SquareTerminal size={14} strokeWidth={ICON_STROKE} />
            <span>Coding CLI</span>
          </div>
          <span className="onyx-cli-heading-meta">
            {availableClis.length > 0 ? `${orderedCliOptions(availableClis).length} 个可用` : '探测中'}
          </span>
        </div>
      ) : (
      <div className="onyx-cli-tabs">
        {sessions.map((s) => (
          <div
            key={s.id}
            className={`onyx-cli-tab${s.id === activeId ? ' is-active' : ''}`}
            onClick={() => activate(s.id)}
            title={`${cliDisplayName(s.cmd)} (${s.cmd})${s.pid ? ` - pid ${s.pid}` : ''}`}
          >
            {s.status === 'running' && <span className="onyx-live-dot" />}
            {s.status === 'starting' && <span className="onyx-live-dot is-starting" />}
            {s.status === 'error' && <span className="onyx-live-dot is-error" />}
            <span>{s.title}</span>
            <button
              type="button"
              className="onyx-cli-tab-close"
              title="结束会话"
              onClick={(e) => {
                e.stopPropagation();
                closeSession(s.id);
              }}
            >
              <X size={12} strokeWidth={ICON_STROKE} />
            </button>
          </div>
        ))}
        <NewSessionMenu />
      </div>
      )}
      <div className="onyx-cli-body">
        {sessions.map((s) => (
          <TerminalView key={s.id} sessionId={s.id} active={s.id === activeId} />
        ))}
        {sessions.length === 0 && <CliLauncher options={orderedCliOptions(availableClis)} onPick={addSession} />}
      </div>
      {sessions.length > 0 && <CliInput />}
    </aside>
  );
}
