import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, File, FolderSearch, X } from 'lucide-react';
import { fsRevealInFinder } from '../lib/ipcClient';
import { basename, dirname } from '../stores/utils';
import { type OpenFile, useWorkspaceStore } from '../stores/workspaceStore';
import { ContextMenu, type ContextMenuEntry, copyToClipboard, ICON_STROKE } from './ui';

export function EditorTabs() {
  const openFiles = useWorkspaceStore((s) => s.openFiles);
  const activePath = useWorkspaceStore((s) => s.activePath);
  const setActive = useWorkspaceStore((s) => s.setActive);
  const closeFile = useWorkspaceStore((s) => s.closeFile);
  const closeOtherFiles = useWorkspaceStore((s) => s.closeOtherFiles);
  const closeFilesToRight = useWorkspaceStore((s) => s.closeFilesToRight);
  const closeSavedFiles = useWorkspaceStore((s) => s.closeSavedFiles);
  const closeAllFiles = useWorkspaceStore((s) => s.closeAllFiles);
  const stripRef = useRef<HTMLDivElement>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; file: OpenFile; index: number } | null>(null);

  const dupNames = useMemo(() => {
    const count = new Map<string, number>();
    openFiles.forEach((f) => count.set(basename(f.path), (count.get(basename(f.path)) ?? 0) + 1));
    return count;
  }, [openFiles]);

  useEffect(() => {
    const el = stripRef.current?.querySelector<HTMLElement>('.onyx-tab.is-active');
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activePath]);

  const menuItems = useMemo<ContextMenuEntry[]>(() => {
    if (!ctx) return [];
    const { file, index } = ctx;
    const hasOthers = openFiles.length > 1;
    const hasRight = index < openFiles.length - 1;
    const hasSaved = openFiles.some((f) => !f.dirty);
    return [
      { key: 'close', label: '关闭', icon: X, onSelect: () => closeFile(file.path) },
      {
        key: 'close-others',
        label: '关闭其他标签',
        disabled: !hasOthers,
        onSelect: () => closeOtherFiles(file.path),
      },
      {
        key: 'close-right',
        label: '关闭右侧标签',
        disabled: !hasRight,
        onSelect: () => closeFilesToRight(file.path),
      },
      {
        key: 'close-saved',
        label: '关闭已保存标签',
        disabled: !hasSaved,
        onSelect: () => closeSavedFiles(),
      },
      { key: 'close-all', label: '全部关闭', onSelect: () => closeAllFiles() },
      { kind: 'divider', key: 'div-1' },
      {
        key: 'copy-rel',
        label: '复制相对路径',
        icon: Copy,
        onSelect: () => copyToClipboard(file.path, '相对路径'),
      },
      {
        key: 'copy-abs',
        label: '复制绝对路径',
        icon: Copy,
        onSelect: () => copyToClipboard(file.fullPath, '绝对路径'),
      },
      {
        key: 'reveal',
        label: '在 Finder 中显示',
        icon: FolderSearch,
        onSelect: () => void fsRevealInFinder(file.fullPath),
      },
    ];
  }, [ctx, openFiles, closeFile, closeOtherFiles, closeFilesToRight, closeSavedFiles, closeAllFiles]);

  return (
    <div
      className="onyx-tabs"
      ref={stripRef}
      onWheel={(e) => {
        if (stripRef.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          stripRef.current.scrollLeft += e.deltaY;
        }
      }}
    >
      {openFiles.map((f, index) => {
        const name = basename(f.path);
        const active = f.path === activePath;
        return (
          <div
            key={f.path}
            className={`onyx-tab${active ? ' is-active' : ''}${f.dirty ? ' is-dirty' : ''}`}
            title={f.path}
            onClick={() => setActive(f.path)}
            onContextMenu={(e) => {
              e.preventDefault();
              setCtx({ x: e.clientX, y: e.clientY, file: f, index });
            }}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                closeFile(f.path);
              }
            }}
          >
            <File size={14} strokeWidth={ICON_STROKE} className="onyx-tab-icon" />
            <span className="onyx-tab-name">{name}</span>
            {(dupNames.get(name) ?? 0) > 1 && <span className="onyx-tab-dir">{dirname(f.path)}</span>}
            <button
              type="button"
              className="onyx-tab-close"
              title="关闭"
              onClick={(e) => {
                e.stopPropagation();
                closeFile(f.path);
              }}
            >
              <span className="onyx-tab-dirty-dot" />
              <X size={13} strokeWidth={ICON_STROKE} className="onyx-tab-x" />
            </button>
          </div>
        );
      })}
      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={menuItems} onClose={() => setCtx(null)} />}
    </div>
  );
}
