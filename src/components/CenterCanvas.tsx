import { useUiStore } from '../stores/uiStore';
import { Breadcrumb } from './Breadcrumb';
import { EditorStage } from './EditorStage';
import { EditorTabs } from './EditorTabs';
import { GitCenter } from './GitWorkbench';
import { RunDrawer } from './RunDrawer';

export function CenterCanvas() {
  const mode = useUiStore((s) => s.mode);
  const consoleVisible = useUiStore((s) => s.consoleVisible);
  return (
    <main className="onyx-card onyx-center">
      <div className="onyx-center-main">
        <div className="onyx-center-pane" style={{ display: mode === 'code' ? 'flex' : 'none' }}>
          <EditorTabs />
          <Breadcrumb />
          <EditorStage />
        </div>
        <div className="onyx-center-pane" style={{ display: mode === 'git' ? 'flex' : 'none' }}>
          <GitCenter />
        </div>
      </div>
      {consoleVisible && <RunDrawer />}
    </main>
  );
}
