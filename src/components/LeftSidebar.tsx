import {
  ChevronsDownUp,
  FilePlus,
  Filter,
  FolderOpen,
  FolderPlus,
  RefreshCw,
} from 'lucide-react';
import { useUiStore } from '../stores/uiStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { FileTree } from './FileTree';
import { GitPanel } from './GitPanel';
import { SearchPanel } from './SearchPanel';
import { formatShortcut } from './shortcuts';
import { ICON_STROKE, IconButton, Segmented } from './ui';

export function LeftSidebar() {
  const mode = useUiStore((s) => s.mode);
  const leftTab = useUiStore((s) => s.leftTab);
  const setLeftTab = useUiStore((s) => s.setLeftTab);
  const filter = useWorkspaceStore((s) => s.filter);
  const setFilter = useWorkspaceStore((s) => s.setFilter);
  const refreshTree = useWorkspaceStore((s) => s.refreshTree);
  const collapseAll = useWorkspaceStore((s) => s.collapseAll);
  const promptOpenWorkspace = useWorkspaceStore((s) => s.promptOpenWorkspace);
  const startTreeCreate = useWorkspaceStore((s) => s.startTreeCreate);

  return (
    <aside className="onyx-sidebar">
      <div className="onyx-sidebar-code" style={{ display: mode === 'code' ? 'flex' : 'none' }}>
        <div className="onyx-sidebar-head">
          <Segmented
            size="sm"
            value={leftTab}
            onChange={setLeftTab}
            options={[
              { value: 'files', label: 'Files' },
              { value: 'search', label: 'Search' },
            ]}
          />
          {leftTab === 'files' && (
            <div className="onyx-sidebar-head-actions">
              <IconButton
                icon={FilePlus}
                size={14}
                title="新建文件"
                onClick={() => startTreeCreate('file')}
              />
              <IconButton
                icon={FolderPlus}
                size={14}
                title="新建文件夹"
                onClick={() => startTreeCreate('dir')}
              />
              <IconButton
                icon={FolderOpen}
                size={14}
                title={`打开项目文件夹 (${formatShortcut('Cmd+O')})`}
                onClick={() => void promptOpenWorkspace()}
              />
              <IconButton icon={RefreshCw} size={13} title="刷新" onClick={() => void refreshTree()} />
              <IconButton icon={ChevronsDownUp} size={14} title="全部折叠" onClick={collapseAll} />
            </div>
          )}
        </div>
        <div className="onyx-sidebar-files" style={{ display: leftTab === 'files' ? 'flex' : 'none' }}>
          <div className="onyx-input-wrap">
            <Filter size={13} strokeWidth={ICON_STROKE} className="onyx-input-icon" />
            <input
              className="onyx-input has-icon"
              placeholder="Filter files..."
              value={filter}
              spellCheck={false}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setFilter('');
              }}
            />
          </div>
          <div className="onyx-sidebar-scroll">
            <FileTree />
          </div>
        </div>
        <div className="onyx-sidebar-search" style={{ display: leftTab === 'search' ? 'flex' : 'none' }}>
          <SearchPanel />
        </div>
      </div>
      <div className="onyx-sidebar-git" style={{ display: mode === 'git' ? 'flex' : 'none' }}>
        <GitPanel />
      </div>
    </aside>
  );
}
