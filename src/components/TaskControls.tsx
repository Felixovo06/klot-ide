import { useCallback, useRef, useState } from 'react';
import { Check, ChevronDown, Play, Plus, RotateCw, Square, SquareTerminal, Trash2 } from 'lucide-react';
import { isRunActive, useRunStore } from '../stores/runStore';
import { ICON_STROKE, IconButton, useDismiss } from './ui';

export function TaskControls() {
  const tasks = useRunStore((s) => s.tasks);
  const selectedTaskId = useRunStore((s) => s.selectedTaskId);
  const selectTask = useRunStore((s) => s.selectTask);
  const addCustomTask = useRunStore((s) => s.addCustomTask);
  const removeCustomTask = useRunStore((s) => s.removeCustomTask);
  const run = useRunStore((s) => s.run);
  const start = useRunStore((s) => s.start);
  const stop = useRunStore((s) => s.stop);
  const restart = useRunStore((s) => s.restart);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [cmd, setCmd] = useState('');
  const [label, setLabel] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    setAdding(false);
  }, []);
  useDismiss(ref, open, close);

  const selected = tasks.find((t) => t.id === selectedTaskId) ?? tasks[0] ?? null;
  const active = isRunActive(run);

  const submitCustom = async () => {
    if (!cmd.trim()) return;
    const nextCmd = cmd;
    const nextLabel = label;
    setCmd('');
    setLabel('');
    setAdding(false);
    setOpen(false);
    await addCustomTask(nextCmd, nextLabel);
  };

  return (
    <div className="onyx-task-controls">
      <div className="onyx-popover-anchor" ref={ref}>
        <button
          type="button"
          className="onyx-task-select"
          onClick={() => setOpen((v) => !v)}
          title={selected ? selected.command : '没有发现可运行任务'}
        >
          <SquareTerminal size={14} strokeWidth={ICON_STROKE} className="onyx-dim" />
          <span className="onyx-task-name">{selected ? selected.name : 'No tasks'}</span>
          <ChevronDown size={13} strokeWidth={ICON_STROKE} className="onyx-dim" />
        </button>
        {open && (
          <div className="onyx-menu onyx-menu-right onyx-task-menu">
            {tasks.length === 0 && <div className="onyx-menu-empty">未发现 package.json / Cargo.toml / Makefile 任务</div>}
            <div className="onyx-task-menu-list">
              {tasks.map((t) => (
                <div
                  key={t.id}
                  className="onyx-menu-item is-two-line onyx-task-row"
                  onClick={() => {
                    selectTask(t.id);
                    setOpen(false);
                  }}
                >
                  <SquareTerminal size={14} strokeWidth={ICON_STROKE} />
                  <span className="onyx-menu-label">
                    <span>{t.name}</span>
                    <span className="onyx-menu-sub">{t.command}</span>
                  </span>
                  <span className="onyx-menu-hint">{t.source}</span>
                  {t.source === 'custom' && (
                    <button
                      type="button"
                      className="onyx-mini-btn onyx-task-del"
                      title="删除自定义命令"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeCustomTask(t.id);
                      }}
                    >
                      <Trash2 size={12} strokeWidth={ICON_STROKE} />
                    </button>
                  )}
                  {t.id === selected?.id && <Check size={14} strokeWidth={ICON_STROKE} className="onyx-accent" />}
                </div>
              ))}
            </div>
            <div className="onyx-menu-divider" />
            {adding ? (
              <div className="onyx-task-custom-form" onClick={(e) => e.stopPropagation()}>
                <input
                  autoFocus
                  className="onyx-input"
                  placeholder="命令，例如 pnpm test:watch"
                  value={cmd}
                  spellCheck={false}
                  onChange={(e) => setCmd(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing) return;
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void submitCustom();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setAdding(false);
                    }
                  }}
                />
                <div className="onyx-task-custom-row">
                  <input
                    className="onyx-input"
                    placeholder="名称（可选）"
                    value={label}
                    spellCheck={false}
                    onChange={(e) => setLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.nativeEvent.isComposing) return;
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void submitCustom();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="onyx-ghost-btn"
                    disabled={!cmd.trim()}
                    onClick={() => void submitCustom()}
                  >
                    Run
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="onyx-menu-item"
                onClick={() => setAdding(true)}
              >
                <Plus size={14} strokeWidth={ICON_STROKE} />
                <span className="onyx-menu-label">添加 / 运行自定义命令...</span>
              </button>
            )}
          </div>
        )}
      </div>
      {active ? (
        <>
          <IconButton icon={Square} title="Stop" tone="danger" filled size={12} onClick={() => void stop()} />
          <IconButton icon={RotateCw} title="Restart" onClick={() => void restart()} />
        </>
      ) : (
        <IconButton
          icon={Play}
          title={selected ? `Run ${selected.name}` : 'Run'}
          filled
          size={13}
          disabled={!selected}
          onClick={() => void start()}
        />
      )}
    </div>
  );
}
