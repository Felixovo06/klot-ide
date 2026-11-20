import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Code, Columns2, Copy, File, FolderSearch, ListTree, X } from 'lucide-react';
import { fsRevealInFinder } from '../lib/ipcClient';
import { type MarkdownViewMode, useUiStore } from '../stores/uiStore';
import { basename, dirname, isMarkdownPath } from '../stores/utils';
import { type OpenFile, useWorkspaceStore } from '../stores/workspaceStore';
import { formatShortcut } from './shortcuts';
import { ContextMenu, type ContextMenuEntry, copyToClipboard, ICON_STROKE, IconButton, Segmented } from './ui';

export function EditorTabs() {
  const openFiles = useWorkspaceStore((s) => s.openFiles);
  const activePath = useWorkspaceStore((s) => s.activePath);
  const setActive = useWorkspaceStore((s) => s.setActive);
  const closeFile = useWorkspaceStore((s) => s.closeFile);
  const closeOtherFiles = useWorkspaceStore((s) => s.closeOtherFiles);
  const closeFilesToRight = useWorkspaceStore((s) => s.closeFilesToRight);
  const closeSavedFiles = useWorkspaceStore((s) => s.closeSavedFiles);
  const closeAllFiles = useWorkspaceStore((s) => s.closeAllFiles);
  const openFile = useWorkspaceStore((s) => s.openFile);
  const markdownViews = useUiStore((s) => s.markdownViews);
  const markdownDefaultView = useUiStore((s) => s.prefs.markdownDefaultView);
  const setMarkdownView = useUiStore((s) => s.setMarkdownView);
  const markdownOutlineVisible = useUiStore((s) => s.markdownOutlineVisible);
  const toggleMarkdownOutline = useUiStore((s) => s.toggleMarkdownOutline);
  const stripRef = useRef<HTMLDivElement>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; file: OpenFile; index: number } | null>(null);

  const activeMd = isMarkdownPath(activePath);
  const activeMdView: MarkdownViewMode =
    activePath && activeMd ? (markdownViews[activePath] ?? markdownDefaultView) : 'edit';

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
    const mdItems: ContextMenuEntry[] = isMarkdownPath(file.path)
      ? [
          {
            key: 'md-read',
            label: '阅读模式 (Read)',
            icon: BookOpen,
            hint: formatShortcut('Cmd+Shift+V'),
            onSelect: () => void openFile(file.path, { markdownView: 'read' }),
          },
          {
            key: 'md-split',
            label: '分屏预览 (Split)',
            icon: Columns2,
            hint: formatShortcut('Cmd+Alt+V'),
            onSelect: () => void openFile(file.path, { markdownView: 'split' }),
          },
          {
            key: 'md-edit',
            label: '源码编辑 (Edit)',
            icon: Code,
            onSelect: () => void openFile(file.path, { markdownView: 'edit' }),
          },
          { kind: 'divider', key: 'div-md' },
        ]
      : [];
    return [
      ...mdItems,
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
  }, [ctx, openFiles, openFile, closeFile, closeOtherFiles, closeFilesToRight, closeSavedFiles, closeAllFiles]);

  return (
    <div className="onyx-tabs-bar">
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
      </div>
      {activePath && activeMd && (
        <div className="onyx-tabs-actions">
          <Segmented<MarkdownViewMode>
            size="sm"
            value={activeMdView}
            onChange={(v) => setMarkdownView(activePath, v)}
            options={[
              { value: 'edit', label: 'Edit', title: '源码编辑模式' },
              { value: 'split', label: 'Split', title: `分屏实时预览 (${formatShortcut('Cmd+Alt+V')})` },
              { value: 'read', label: 'Read', title: `阅读模式 (${formatShortcut('Cmd+Shift+V')})` },
            ]}
          />
          {activeMdView === 'read' && (
            <IconButton
              icon={ListTree}
              size={14}
              active={markdownOutlineVisible}
              title="显示 / 隐藏文档目录"
              onClick={toggleMarkdownOutline}
            />
          )}
        </div>
      )}
      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={menuItems} onClose={() => setCtx(null)} />}
    </div>
  );
}
