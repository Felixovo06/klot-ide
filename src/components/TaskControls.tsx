import { useCallback, useRef, useState } from 'react';
import { Check, ChevronDown, Play, RotateCw, Square, SquareTerminal } from 'lucide-react';
import { isRunActive, useRunStore } from '../stores/runStore';
import { ICON_STROKE, IconButton, useDismiss } from './ui';

export function TaskControls() {
  const tasks = useRunStore((s) => s.tasks);
  const selectedTaskId = useRunStore((s) => s.selectedTaskId);
  const selectTask = useRunStore((s) => s.selectTask);
  const run = useRunStore((s) => s.run);
  const start = useRunStore((s) => s.start);
  const stop = useRunStore((s) => s.stop);
  const restart = useRunStore((s) => s.restart);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);

  const selected = tasks.find((t) => t.id === selectedTaskId) ?? tasks[0] ?? null;
  const active = isRunActive(run);

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
            {tasks.map((t) => (
              <button
                key={t.id}
                type="button"
                className="onyx-menu-item is-two-line"
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
                {t.id === selected?.id && <Check size={14} strokeWidth={ICON_STROKE} className="onyx-accent" />}
              </button>
            ))}
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
