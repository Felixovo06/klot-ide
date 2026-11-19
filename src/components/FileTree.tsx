import { useMemo } from 'react';
import { ChevronDown, ChevronRight, File, Folder, FolderOpen } from 'lucide-react';
import type { FsTreeNode, GitFileStatusCode } from '../types/ipc';
import { useGitStore } from '../stores/gitStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { GitStatusLetter, ICON_STROKE } from './ui';

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

export function FileTree() {
  const tree = useWorkspaceStore((s) => s.tree);
  const treeLoaded = useWorkspaceStore((s) => s.treeLoaded);
  const expanded = useWorkspaceStore((s) => s.expanded);
  const filter = useWorkspaceStore((s) => s.filter);
  const activePath = useWorkspaceStore((s) => s.activePath);
  const openFiles = useWorkspaceStore((s) => s.openFiles);
  const toggleDir = useWorkspaceStore((s) => s.toggleDir);
  const openFile = useWorkspaceStore((s) => s.openFile);
  const status = useGitStore((s) => s.status);

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

  if (!treeLoaded) return <div className="onyx-empty-hint">Loading...</div>;
  if (rows.length === 0) {
    return <div className="onyx-empty-hint">{filter ? '没有匹配的文件' : '工作区为空'}</div>;
  }

  return (
    <div className="onyx-tree" role="tree">
      {rows.map(({ node, depth, expanded: isOpen }) => {
        const mark = marks.get(node.path);
        const selected = !node.isDir && node.path === activePath;
        return (
          <div
            key={node.path}
            role="treeitem"
            aria-selected={selected}
            className={`onyx-tree-row${selected ? ' is-selected' : ''}`}
            style={{ paddingLeft: 6 + depth * 14 }}
            title={node.path}
            onClick={() => (node.isDir ? toggleDir(node.path) : void openFile(node.path))}
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
            <span className="onyx-tree-name">{node.name}</span>
            {dirtySet.has(node.path) && <span className="onyx-dirty-dot" />}
            {mark && !node.isDir && <GitStatusLetter status={mark} />}
          </div>
        );
      })}
    </div>
  );
}
