// Git 树：拓扑轨道 SVG + 引用徽章 + 提交列表，支持全部分支 / 当前分支切换、过滤与上下键导航
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { GitBranch, GitCommitHorizontal, Loader2, Search, Tag } from 'lucide-react';
import type { GitGraphNode, GitRefBadge } from '../types/ipc';
import { useGitStore } from '../stores/gitStore';
import { ICON_STROKE, Segmented } from './ui';

const ROW_H = 30;
const LANE_W = 14;
const GRAPH_PAD = 10;
const NODE_R = 3.5;
/** 6 色柔和轨道（亮暗主题通过 CSS 变量各自取值） */
const LANE_COLORS = 6;

interface GraphRow {
  node: GitGraphNode;
  col: number;
  before: Array<string | null>;
  after: Array<string | null>;
  /** 本节点新开或汇入的父提交所在轨道（不含首父延续轨道） */
  mergeTargets: number[];
}

/** 经典轨道分配：每条轨道记录其"期待出现"的下一个提交哈希 */
export function layoutGraph(nodes: GitGraphNode[]): { rows: GraphRow[]; laneCount: number } {
  const lanes: Array<string | null> = [];
  const rows: GraphRow[] = [];
  let laneCount = 1;
  const known = new Set(nodes.map((n) => n.hash));

  for (const node of nodes) {
    let col = lanes.indexOf(node.hash);
    if (col < 0) {
      col = lanes.indexOf(null);
      if (col < 0) {
        col = lanes.length;
        lanes.push(null);
      }
      lanes[col] = node.hash;
    }
    const before = lanes.slice();

    // 其余期待同一提交的轨道在此汇合并结束
    for (let i = 0; i < lanes.length; i += 1) {
      if (i !== col && lanes[i] === node.hash) lanes[i] = null;
    }

    // 只追踪列表内可见的父提交，避免截断处留下悬空轨道
    const parents = node.parents.filter((p) => known.has(p));
    lanes[col] = parents[0] ?? null;

    const mergeTargets: number[] = [];
    for (const p of parents.slice(1)) {
      let k = lanes.indexOf(p);
      if (k < 0) {
        k = lanes.indexOf(null);
        if (k < 0 || k === col) {
          k = lanes.length;
          lanes.push(null);
        }
        lanes[k] = p;
      }
      mergeTargets.push(k);
    }

    // 收缩末尾空轨道
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();

    const after = lanes.slice();
    laneCount = Math.max(laneCount, before.length, after.length, col + 1);
    rows.push({ node, col, before, after, mergeTargets });
  }
  return { rows, laneCount };
}

const laneX = (i: number) => GRAPH_PAD + i * LANE_W;
const laneClass = (i: number) => `onyx-lane-${i % LANE_COLORS}`;

function GraphCell({ row, width, isHead }: { row: GraphRow; width: number; isHead: boolean }) {
  const mid = ROW_H / 2;
  const cx = laneX(row.col);
  const paths: Array<{ d: string; cls: string }> = [];

  // 上半段：所有进入本行的轨道
  row.before.forEach((h, i) => {
    if (!h) return;
    const x = laneX(i);
    if (h === row.node.hash) {
      paths.push({
        d: i === row.col ? `M${x} 0 L${x} ${mid}` : `M${x} 0 C${x} ${mid * 0.9} ${cx} ${mid * 0.4} ${cx} ${mid}`,
        cls: laneClass(i),
      });
    } else {
      paths.push({ d: `M${x} 0 L${x} ${mid}`, cls: laneClass(i) });
    }
  });

  // 下半段：延续轨道与分叉 / 合并连线
  row.after.forEach((h, k) => {
    if (!h) return;
    const x = laneX(k);
    if (k === row.col) {
      paths.push({ d: `M${cx} ${mid} L${cx} ${ROW_H}`, cls: laneClass(k) });
    } else if (row.mergeTargets.includes(k) && row.before[k] !== h) {
      paths.push({ d: `M${cx} ${mid} C${cx} ${mid + mid * 0.6} ${x} ${mid + mid * 0.1} ${x} ${ROW_H}`, cls: laneClass(k) });
    } else {
      paths.push({ d: `M${x} ${mid} L${x} ${ROW_H}`, cls: laneClass(k) });
      if (row.mergeTargets.includes(k)) {
        paths.push({ d: `M${cx} ${mid} C${cx} ${mid + mid * 0.6} ${x} ${mid + mid * 0.1} ${x} ${ROW_H}`, cls: laneClass(k) });
      }
    }
  });

  return (
    <svg className="onyx-graph-svg" width={width} height={ROW_H} aria-hidden="true">
      {paths.map((p, i) => (
        <path key={i} d={p.d} className={`onyx-graph-edge ${p.cls}`} />
      ))}
      {isHead && <circle cx={cx} cy={mid} r={NODE_R + 3} className={`onyx-graph-halo ${laneClass(row.col)}`} />}
      <circle
        cx={cx}
        cy={mid}
        r={NODE_R}
        className={`onyx-graph-node ${laneClass(row.col)}${row.node.parents.length > 1 ? ' is-merge' : ''}`}
      />
    </svg>
  );
}

function RefBadge({ badge }: { badge: GitRefBadge }) {
  const Icon = badge.kind === 'tag' ? Tag : badge.kind === 'head' ? GitCommitHorizontal : GitBranch;
  return (
    <span
      className={`onyx-ref-badge is-${badge.kind}${badge.isCurrentHead ? ' is-current' : ''}`}
      title={`${badge.kind === 'remote' ? 'Remote' : badge.kind === 'tag' ? 'Tag' : badge.kind === 'head' ? 'HEAD' : 'Branch'}: ${badge.name}`}
    >
      <Icon size={10} strokeWidth={ICON_STROKE} />
      <span>{badge.name}</span>
    </span>
  );
}

export function GitGraphView() {
  const nodes = useGitStore((s) => s.graphNodes);
  const loading = useGitStore((s) => s.graphLoading);
  const loaded = useGitStore((s) => s.graphLoaded);
  const all = useGitStore((s) => s.graphAllBranches);
  const setAll = useGitStore((s) => s.setGraphAllBranches);
  const selectedHash = useGitStore((s) => s.selectedCommitHash);
  const selectCommit = useGitStore((s) => s.selectCommit);
  const status = useGitStore((s) => s.status);
  const [filter, setFilter] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  const { rows, laneCount } = useMemo(() => layoutGraph(nodes), [nodes]);
  const q = filter.trim().toLowerCase();
  const visible = useMemo(
    () =>
      q
        ? rows.filter(
            (r) =>
              r.node.message.toLowerCase().includes(q) ||
              r.node.hash.startsWith(q) ||
              r.node.author.toLowerCase().includes(q) ||
              r.node.refs.some((b) => b.name.toLowerCase().includes(q)),
          )
        : rows,
    [rows, q],
  );
  // 过滤时轨道不再连续，只保留节点圆点
  const graphWidth = q ? GRAPH_PAD * 2 : GRAPH_PAD * 2 + (laneCount - 1) * LANE_W;
  const headHash = nodes.find((n) => n.refs.some((b) => b.kind === 'head' || b.isCurrentHead))?.hash ?? nodes[0]?.hash;

  useEffect(() => {
    if (!selectedHash || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-hash="${selectedHash}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedHash, visible.length]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const idx = visible.findIndex((r) => r.node.hash === selectedHash);
    const next = e.key === 'ArrowDown' ? Math.min(visible.length - 1, idx + 1) : Math.max(0, idx - 1);
    const target = visible[next];
    if (target && target.node.hash !== selectedHash) void selectCommit(target.node.hash);
  };

  return (
    <div className="onyx-graph">
      <div className="onyx-graph-head">
        <Segmented
          size="sm"
          value={all ? 'all' : 'current'}
          onChange={(v) => setAll(v === 'all')}
          options={[
            { value: 'all', label: 'All Branches' },
            { value: 'current', label: 'Current', title: status?.branch ? `仅 ${status.branch}` : undefined },
          ]}
        />
        <label className="onyx-graph-filter">
          <Search size={13} strokeWidth={ICON_STROKE} />
          <input
            value={filter}
            spellCheck={false}
            placeholder="过滤提交信息、Hash 或作者"
            onChange={(e) => setFilter(e.target.value)}
          />
        </label>
        <span className="onyx-graph-count">
          {loading && <Loader2 size={12} strokeWidth={ICON_STROKE} className="onyx-spin" />}
          {q ? `${visible.length} / ${rows.length}` : `${rows.length} commits`}
        </span>
      </div>
      <div className="onyx-graph-list" ref={listRef} tabIndex={0} onKeyDown={onKeyDown}>
        {loaded && rows.length === 0 && !loading && (
          <div className="onyx-editor-empty">
            <div className="onyx-empty-icon">
              <GitCommitHorizontal size={20} strokeWidth={ICON_STROKE} />
            </div>
            <div className="onyx-editor-empty-sub">仓库还没有任何提交，完成首次提交后这里会显示 Git 树</div>
          </div>
        )}
        {visible.map((row) => {
          const n = row.node;
          const isSel = n.hash === selectedHash;
          return (
            <div
              key={n.hash}
              data-hash={n.hash}
              className={`onyx-graph-row${isSel ? ' is-selected' : ''}`}
              onClick={() => void selectCommit(n.hash)}
              title={`${n.hash}\n${n.author} <${n.authorEmail}>\n${n.message}`}
            >
              {q ? (
                <svg className="onyx-graph-svg" width={graphWidth} height={ROW_H} aria-hidden="true">
                  <circle cx={GRAPH_PAD} cy={ROW_H / 2} r={NODE_R} className={`onyx-graph-node ${laneClass(row.col)}`} />
                </svg>
              ) : (
                <GraphCell row={row} width={graphWidth} isHead={n.hash === headHash} />
              )}
              <span className="onyx-graph-main">
                {n.refs.length > 0 && (
                  <span className="onyx-graph-refs">
                    {n.refs.map((b) => (
                      <RefBadge key={`${b.kind}:${b.name}`} badge={b} />
                    ))}
                  </span>
                )}
                <span className="onyx-graph-msg">{n.message}</span>
              </span>
              <span className="onyx-graph-author">{n.author}</span>
              <span className="onyx-graph-hash">{n.shortHash}</span>
              <span className="onyx-graph-time">{n.relativeTime}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
