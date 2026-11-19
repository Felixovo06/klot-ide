import { useEffect, useRef, type ReactNode } from 'react';
import { Eraser, X } from 'lucide-react';
import { type LogLine, type RunInfo, useRunStore } from '../stores/runStore';
import { EDITOR_MIN_HEIGHT, LAYOUT_LIMITS, useUiStore } from '../stores/uiStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { DrawerContent } from './DrawerContent';
import { ResizeHandle } from './ResizeHandle';
import { ICON_STROKE } from './ui';

const TOKEN_RE =
  /(https?:\/\/[^\s'"<>)]+)|((?:\.{0,2}\/)?(?:[\w.@-]+\/)+[\w.@-]+\.[A-Za-z0-9]{1,8})(?::(\d+)(?::(\d+))?)?/g;
const ERROR_RE = /\b(error|failed|failure|exception|panic|fatal)\b|ERR!|\bE\d{3,}\b/i;

function renderLine(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  let i = 0;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) {
      const url = m[1].replace(/[.,;]+$/, '');
      out.push(
        <a key={i} className="onyx-log-link" href={url} target="_blank" rel="noreferrer">
          {url}
        </a>,
      );
      out.push(m[1].slice(url.length));
    } else if (m[2]) {
      const path = m[2];
      const line = m[3] ? Number(m[3]) : undefined;
      const column = m[4] ? Number(m[4]) : undefined;
      out.push(
        <button
          key={i}
          type="button"
          className="onyx-log-link"
          onClick={() => {
            useUiStore.getState().setMode('code');
            void useWorkspaceStore.getState().openFile(path, { line, column });
          }}
        >
          {m[0]}
        </button>,
      );
    }
    last = m.index + m[0].length;
    i += 1;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function lineClass(l: LogLine): string {
  if (l.tone === 'error') return 'is-error';
  if (l.tone === 'info') return 'is-info';
  if (ERROR_RE.test(l.text)) return 'is-error';
  return l.tone === 'err' ? 'is-err' : '';
}

function RunStatusLabel({ run }: { run: RunInfo | null }) {
  if (!run) {
    return (
      <span className="onyx-run-status">
        <span className="onyx-run-dot is-idle" />
        <span className="onyx-run-label">Run Console</span>
      </span>
    );
  }
  const map: Record<RunInfo['status'], { label: string; tone: string }> = {
    starting: { label: 'Starting', tone: 'warning' },
    running: { label: 'Running', tone: 'success' },
    exited: { label: 'Exited', tone: 'idle' },
    stopped: { label: 'Stopped', tone: 'idle' },
    failed: { label: 'Failed', tone: 'error' },
  };
  const s = map[run.status];
  return (
    <span className="onyx-run-status">
      <span className={`onyx-run-dot is-${s.tone}`} />
      <span className="onyx-run-label">
        <strong>{s.label}:</strong> {run.name}
        {run.url && run.status === 'running' && <span className="onyx-dim"><span className="onyx-sep-dot" />{run.url}</span>}
        {run.exitCode !== null && run.status !== 'running' && (
          <span className="onyx-dim"> (code {run.exitCode})</span>
        )}
      </span>
    </span>
  );
}

export function RunDrawer() {
  const logs = useRunStore((s) => s.logs);
  const run = useRunStore((s) => s.run);
  const clear = useRunStore((s) => s.clear);
  const drawerTabs = useRunStore((s) => s.drawerTabs);
  const activeTab = useRunStore((s) => s.activeDrawerTab);
  const setActiveTab = useRunStore((s) => s.setActiveDrawerTab);
  const closeTab = useRunStore((s) => s.closeDrawerTab);
  const setConsoleVisible = useUiStore((s) => s.setConsoleVisible);
  const consoleHeight = useUiStore((s) => s.consoleHeight);
  const setConsoleHeight = useUiStore((s) => s.setConsoleHeight);
  const resetConsoleHeight = useUiStore((s) => s.resetConsoleHeight);
  const sectionRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  const pluginTab = drawerTabs.find((t) => t.id === activeTab) ?? null;
  const showRun = !pluginTab;

  useEffect(() => {
    const el = bodyRef.current;
    if (el && showRun && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [logs, showRun]);

  return (
    <section className="onyx-drawer" ref={sectionRef} style={{ height: consoleHeight }}>
      <ResizeHandle
        axis="row"
        direction={-1}
        value={consoleHeight}
        min={LAYOUT_LIMITS.consoleHeight.min}
        max={LAYOUT_LIMITS.consoleHeight.max}
        getMax={() => {
          // 保证上方编辑器区域高度 >= 180px
          const main = sectionRef.current?.parentElement?.querySelector<HTMLElement>('.onyx-center-main');
          const editorH = main ? main.getBoundingClientRect().height : EDITOR_MIN_HEIGHT;
          return consoleHeight + editorH - EDITOR_MIN_HEIGHT;
        }}
        onChange={setConsoleHeight}
        onReset={resetConsoleHeight}
        title="拖拽调整控制台高度，双击恢复默认"
      />
      <div className="onyx-drawer-head">
        <div className="onyx-drawer-tabs">
          {drawerTabs.length === 0 ? (
            <RunStatusLabel run={run} />
          ) : (
            <>
              <button
                type="button"
                className={`onyx-drawer-tab${showRun ? ' is-active' : ''}`}
                onClick={() => setActiveTab('run')}
              >
                <RunStatusLabel run={run} />
              </button>
              {drawerTabs.map((t) => (
                <div
                  key={t.id}
                  className={`onyx-drawer-tab${t.id === activeTab ? ' is-active' : ''}`}
                  onClick={() => setActiveTab(t.id)}
                >
                  <span className="onyx-drawer-tab-title">{t.title}</span>
                  <button
                    type="button"
                    className="onyx-mini-btn"
                    title="关闭标签"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(t.id);
                    }}
                  >
                    <X size={12} strokeWidth={ICON_STROKE} />
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
        <div className="onyx-drawer-actions">
          {showRun && (
            <button type="button" className="onyx-text-btn" onClick={clear} title="清空输出">
              <Eraser size={13} strokeWidth={ICON_STROKE} />
              Clear
            </button>
          )}
          <button type="button" className="onyx-mini-btn" title="Close" onClick={() => setConsoleVisible(false)}>
            <X size={14} strokeWidth={ICON_STROKE} />
          </button>
        </div>
      </div>
      {showRun ? (
        <div
          className="onyx-drawer-body onyx-log"
          ref={bodyRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
        >
          {logs.length === 0 && (
            <div className="onyx-log-empty">
              {run ? 'Waiting for output...' : '点击右上角运行按钮启动任务，输出会显示在这里。'}
            </div>
          )}
          {logs.map((l) => (
            <div key={l.id} className={`onyx-log-line ${lineClass(l)}`}>
              {l.text ? renderLine(l.text) : '\u00a0'}
            </div>
          ))}
        </div>
      ) : (
        <div className="onyx-drawer-body">{pluginTab && <DrawerContent tab={pluginTab} />}</div>
      )}
    </section>
  );
}
