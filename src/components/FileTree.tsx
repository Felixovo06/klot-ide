import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AtSign,
  ChevronDown,
  ChevronRight,
  Copy,
  File,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderSearch,
  Pencil,
  SquareTerminal,
  Trash2,
} from 'lucide-react';
import { fsRevealInFinder } from '../lib/ipcClient';
import type { FsTreeNode, GitFileStatusCode } from '../types/ipc';
import { useCliStore } from '../stores/cliStore';
import { useGitStore } from '../stores/gitStore';
import { useUiStore } from '../stores/uiStore';
import { dirname, joinPath } from '../stores/utils';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { ContextMenu, type ContextMenuEntry, copyToClipboard, GitStatusLetter, ICON_STROKE } from './ui';

interface Row {
  node: FsTreeNode;
  depth: number;
  expanded: boolean;
}

function filterTree(nodes: FsTreeNode[], q: string): FsTreeNode[] {
  const out: FsTreeNode[] = [];
  for (const n of nodes) {
    if (n.isDir) {
      const children = filterTree(n.children ?? [], q);
      if (children.length > 0 || n.name.toLowerCase().includes(q)) out.push({ ...n, children });
    } else if (n.path.toLowerCase().includes(q)) {
      out.push(n);
    }
  }
  return out;
}

function buildRows(
  nodes: FsTreeNode[],
  expanded: Record<string, boolean>,
  forceExpand: boolean,
  depth = 0,
  out: Row[] = [],
): Row[] {
  for (const node of nodes) {
    const isOpen = node.isDir && (forceExpand || !!expanded[node.path]);
    out.push({ node, depth, expanded: isOpen });
    if (isOpen && node.children) buildRows(node.children, expanded, forceExpand, depth + 1, out);
  }
  return out;
}

function InlineNameInput({
  initial,
  isDir,
  placeholder,
  onCommit,
  onCancel,
}: {
  initial: string;
  isDir: boolean;
  placeholder?: string;
  onCommit: (value: string) => Promise<boolean> | boolean;
  onCancel: () => void;
}) {
  const [val, setVal] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    if (initial) {
      const dot = initial.lastIndexOf('.');
      el.setSelectionRange(0, dot > 0 && !isDir ? dot : initial.length);
    }
  }, [initial, isDir]);

  const finishCommit = async () => {
    if (doneRef.current) return;
    doneRef.current = true;
    const trimmed = val.trim();
    if (!trimmed) {
      onCancel();
      return;
    }
    const ok = await onCommit(trimmed);
    if (!ok) {
      doneRef.current = false;
      inputRef.current?.focus();
    }
  };

  const finishCancel = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onCancel();
  };

  return (
    <input
      ref={inputRef}
      className="onyx-tree-inline-input"
      value={val}
      placeholder={placeholder}
      spellCheck={false}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => void finishCommit()}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          void finishCommit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          finishCancel();
        }
      }}
    />
  );
}

function DraftRow({
  mode,
  parentDir,
  depth,
}: {
  mode: 'file' | 'dir';
  parentDir: string;
  depth: number;
}) {
  const createEntry = useWorkspaceStore((s) => s.createEntry);
  const cancelTreeCreate = useWorkspaceStore((s) => s.cancelTreeCreate);
  return (
    <div className="onyx-tree-row is-editing" style={{ paddingLeft: 6 + depth * 14 }}>
      <span className="onyx-tree-chevron" />
      {mode === 'dir' ? (
        <Folder size={15} strokeWidth={ICON_STROKE} className="onyx-tree-icon" />
      ) : (
        <File size={15} strokeWidth={ICON_STROKE} className="onyx-tree-icon" />
      )}
      <InlineNameInput
        initial=""
        isDir={mode === 'dir'}
        placeholder={mode === 'dir' ? '文件夹名称...' : '文件名称...'}
        onCommit={(name) => createEntry(parentDir, name, mode === 'dir')}
        onCancel={cancelTreeCreate}
      />
    </div>
  );
}

interface CtxTarget {
  x: number;
  y: number;
  node: FsTreeNode | null;
}

export function FileTree() {
  const root = useWorkspaceStore((s) => s.root);
  const tree = useWorkspaceStore((s) => s.tree);
  const treeLoaded = useWorkspaceStore((s) => s.treeLoaded);
  const expanded = useWorkspaceStore((s) => s.expanded);
  const filter = useWorkspaceStore((s) => s.filter);
  const activePath = useWorkspaceStore((s) => s.activePath);
  const selectedTreePath = useWorkspaceStore((s) => s.selectedTreePath);
  const treeDraft = useWorkspaceStore((s) => s.treeDraft);
  const openFiles = useWorkspaceStore((s) => s.openFiles);
  const toggleDir = useWorkspaceStore((s) => s.toggleDir);
  const openFile = useWorkspaceStore((s) => s.openFile);
  const setSelectedTreePath = useWorkspaceStore((s) => s.setSelectedTreePath);
  const startTreeCreate = useWorkspaceStore((s) => s.startTreeCreate);
  const renameEntry = useWorkspaceStore((s) => s.renameEntry);
  const deleteEntry = useWorkspaceStore((s) => s.deleteEntry);
  const status = useGitStore((s) => s.status);

  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<CtxTarget | null>(null);

  const marks = useMemo(() => {
    const map = new Map<string, GitFileStatusCode>();
    if (!status?.isRepo) return map;
    for (const c of status.staged) map.set(c.path, c.status);
    for (const c of status.changes) map.set(c.path, c.status);
    return map;
  }, [status]);

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? buildRows(filterTree(tree, q), expanded, true) : buildRows(tree, expanded, false);
  }, [tree, expanded, filter]);

  const dirtySet = useMemo(() => new Set(openFiles.filter((f) => f.dirty).map((f) => f.path)), [openFiles]);

  const menuItems = useMemo<ContextMenuEntry[]>(() => {
    if (!ctxMenu) return [];
    const node = ctxMenu.node;
    const targetDir = node ? (node.isDir ? node.path : dirname(node.path)) : '';
    const fullTarget = node ? node.fullPath : root;
    const termCwd = node ? (node.isDir ? node.fullPath : joinPath(root, dirname(node.path))) : root;

    const items: ContextMenuEntry[] = [
      {
        key: 'new-file',
        label: '新建文件...',
        icon: FilePlus,
        onSelect: () => startTreeCreate('file', targetDir),
      },
      {
        key: 'new-dir',
        label: '新建文件夹...',
        icon: FolderPlus,
        onSelect: () => startTreeCreate('dir', targetDir),
      },
    ];

    if (node) {
      items.push(
        {
          key: 'rename',
          label: '重命名',
          icon: Pencil,
          onSelect: () => setRenamingPath(node.path),
        },
        {
          key: 'delete',
          label: '删除',
          icon: Trash2,
          danger: true,
          onSelect: () => void deleteEntry(node.path, node.isDir),
        },
      );
    }

    items.push({ kind: 'divider', key: 'div-cli' });

    if (node && !node.isDir) {
      items.push({
        key: 'cite-cli',
        label: '引用到 CLI (@path)',
        icon: AtSign,
        onSelect: () => {
          useCliStore.getState().addChip({ path: node.path, startLine: 1, endLine: 1 });
          useUiStore.getState().focusCli();
        },
      });
    }

    items.push({
      key: 'open-terminal',
      label: '在此目录打开终端',
      icon: SquareTerminal,
      onSelect: () => {
        useCliStore.getState().addSession('zsh', { cwd: termCwd });
        useUiStore.getState().setCliVisible(true);
      },
    });

    items.push({ kind: 'divider', key: 'div-path' });

    if (node) {
      items.push({
        key: 'copy-rel',
        label: '复制相对路径',
        icon: Copy,
        onSelect: () => copyToClipboard(node.path, '相对路径'),
      });
    }

    items.push(
      {
        key: 'copy-abs',
        label: '复制绝对路径',
        icon: Copy,
        onSelect: () => copyToClipboard(fullTarget, '绝对路径'),
      },
      {
        key: 'reveal',
        label: '在 Finder 中显示',
        icon: FolderSearch,
        onSelect: () => void fsRevealInFinder(fullTarget),
      },
    );
    return items;
  }, [ctxMenu, root, startTreeCreate, deleteEntry]);

  if (!treeLoaded) return <div className="onyx-empty-hint">Loading...</div>;

  const showEmpty = rows.length === 0 && !treeDraft;
  const showRootDraft = !!treeDraft && treeDraft.parentDir === '';

  return (
    <div
      className="onyx-tree"
      role="tree"
      onContextMenu={(e) => {
        e.preventDefault();
        setCtxMenu({ x: e.clientX, y: e.clientY, node: null });
      }}
    >
      {showEmpty && (
        <div className="onyx-empty-hint">{filter ? '没有匹配的文件' : '工作区为空（右键新建文件）'}</div>
      )}
      {showRootDraft && <DraftRow mode={treeDraft.mode} parentDir="" depth={0} />}
      {rows.map(({ node, depth, expanded: isOpen }) => {
        const mark = marks.get(node.path);
        const selected = (!node.isDir && node.path === activePath) || node.path === selectedTreePath;
        const isRenaming = renamingPath === node.path;
        const showChildDraft = !!treeDraft && treeDraft.parentDir === node.path;

        return (
          <div key={node.path}>
            <div
              role="treeitem"
              aria-selected={selected}
              className={`onyx-tree-row${selected ? ' is-selected' : ''}${isRenaming ? ' is-editing' : ''}`}
              style={{ paddingLeft: 6 + depth * 14 }}
              title={node.path}
              onClick={() => {
                setSelectedTreePath(node.path);
                if (node.isDir) toggleDir(node.path);
                else void openFile(node.path);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setSelectedTreePath(node.path);
                setCtxMenu({ x: e.clientX, y: e.clientY, node });
              }}
            >
              {node.isDir ? (
                <>
                  <span className="onyx-tree-chevron">
                    {isOpen ? (
                      <ChevronDown size={13} strokeWidth={ICON_STROKE} />
                    ) : (
                      <ChevronRight size={13} strokeWidth={ICON_STROKE} />
                    )}
                  </span>
                  {isOpen ? (
                    <FolderOpen size={15} strokeWidth={ICON_STROKE} className="onyx-tree-icon" />
                  ) : (
                    <Folder size={15} strokeWidth={ICON_STROKE} className="onyx-tree-icon" />
                  )}
                </>
              ) : (
                <>
                  <span className="onyx-tree-chevron" />
                  <File size={15} strokeWidth={ICON_STROKE} className="onyx-tree-icon" />
                </>
              )}
              {isRenaming ? (
                <InlineNameInput
                  initial={node.name}
                  isDir={node.isDir}
                  onCommit={async (nextName) => {
                    const ok = await renameEntry(node.path, nextName);
                    if (ok) setRenamingPath(null);
                    return ok;
                  }}
                  onCancel={() => setRenamingPath(null)}
                />
              ) : (
                <>
                  <span className="onyx-tree-name">{node.name}</span>
                  {dirtySet.has(node.path) && <span className="onyx-dirty-dot" />}
                  {mark && !node.isDir && <GitStatusLetter status={mark} />}
                </>
              )}
            </div>
            {showChildDraft && (
              <DraftRow mode={treeDraft.mode} parentDir={node.path} depth={depth + 1} />
            )}
          </div>
        );
      })}
      {ctxMenu && <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={menuItems} onClose={() => setCtxMenu(null)} />}
    </div>
  );
}
