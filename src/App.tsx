import { useEffect } from 'react';
import { CenterCanvas } from './components/CenterCanvas';
import { InfoModals } from './components/InfoModals';
import { LeftSidebar } from './components/LeftSidebar';
import { applyMonacoPrefs, setMonacoTheme } from './components/monacoSetup';
import { QuickOpenModal } from './components/QuickOpenModal';
import { ResizeHandle } from './components/ResizeHandle';
import { RightCliDock } from './components/RightCliDock';
import { useGlobalShortcuts } from './components/shortcuts';
import { applyTerminalFontSize, applyTerminalTheme } from './components/terminalRegistry';
import { ToastHost } from './components/ToastHost';
import { TopBar } from './components/TopBar';
import { bootstrapApp } from './stores/bootstrap';
import { CENTER_MIN_WIDTH, LAYOUT_LIMITS, useUiStore } from './stores/uiStore';

/** 拖拽开始时测量中间画布实际宽度，返回侧栏在保证中间画布 >= 340px 时可达到的最大宽度 */
function centerSlack(): number {
  const center = document.querySelector<HTMLElement>('.onyx-center');
  return center ? center.getBoundingClientRect().width - CENTER_MIN_WIDTH : 0;
}

export function App() {
  const theme = useUiStore((s) => s.theme);
  const leftVisible = useUiStore((s) => s.leftVisible);
  const cliVisible = useUiStore((s) => s.cliVisible);
  const leftWidth = useUiStore((s) => s.leftWidth);
  const cliWidth = useUiStore((s) => s.cliWidth);
  const setLeftWidth = useUiStore((s) => s.setLeftWidth);
  const setCliWidth = useUiStore((s) => s.setCliWidth);
  const resetLeftWidth = useUiStore((s) => s.resetLeftWidth);
  const resetCliWidth = useUiStore((s) => s.resetCliWidth);
  const prefs = useUiStore((s) => s.prefs);

  useGlobalShortcuts();

  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute('data-theme', theme);
    html.style.colorScheme = theme;
    setMonacoTheme(theme);
    applyTerminalTheme(theme);
  }, [theme]);

  useEffect(() => {
    applyMonacoPrefs({ tabSize: prefs.tabSize });
    applyTerminalFontSize(prefs.terminalFontSize);
  }, [prefs.tabSize, prefs.terminalFontSize]);

  useEffect(() => {
    void bootstrapApp();
  }, []);

  return (
    <div className="onyx-app">
      <TopBar />
      <div className={`onyx-body${leftVisible ? '' : ' is-left-hidden'}${cliVisible ? '' : ' is-cli-hidden'}`}>
        <div className="onyx-sidebar-slot" style={{ display: leftVisible ? 'flex' : 'none', width: leftWidth }}>
          <LeftSidebar />
        </div>
        {leftVisible && (
          <ResizeHandle
            axis="col"
            value={leftWidth}
            min={LAYOUT_LIMITS.leftWidth.min}
            max={LAYOUT_LIMITS.leftWidth.max}
            getMax={() => leftWidth + centerSlack()}
            onChange={setLeftWidth}
            onReset={resetLeftWidth}
            title="拖拽调整左侧栏宽度，双击恢复默认"
          />
        )}
        <CenterCanvas />
        {cliVisible && (
          <ResizeHandle
            axis="col"
            direction={-1}
            value={cliWidth}
            min={LAYOUT_LIMITS.cliWidth.min}
            max={LAYOUT_LIMITS.cliWidth.max}
            getMax={() => cliWidth + centerSlack()}
            onChange={setCliWidth}
            onReset={resetCliWidth}
            title="拖拽调整 CLI 舱宽度，双击恢复默认"
          />
        )}
        <RightCliDock />
      </div>
      <QuickOpenModal />
      <InfoModals />
      <ToastHost />
    </div>
  );
}
