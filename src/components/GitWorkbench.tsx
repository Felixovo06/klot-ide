// Git 模式中间画布：Changes（工作区 Diff）| Graph（Git 树 + 提交 Diff 上下分栏）| Compare（分支对比 Diff）
import { useEffect, useRef, useState } from 'react';
import { useGitStore, WORKTREE_REF } from '../stores/gitStore';
import { DiffView } from './DiffView';
import { GitGraphView } from './GitGraphView';
import { ReadonlyDiffPane } from './ReadonlyDiffPane';
import { ResizeHandle } from './ResizeHandle';

const SPLIT_KEY = 'ke.graphSplit';
const SPLIT_DEFAULT = 300;
const SPLIT_MIN = 140;
const DIFF_MIN = 160;

function loadSplit(): number {
  try {
    const v = Number(localStorage.getItem(SPLIT_KEY));
    return Number.isFinite(v) && v >= SPLIT_MIN ? v : SPLIT_DEFAULT;
  } catch {
    return SPLIT_DEFAULT;
  }
}

function GraphWorkbench() {
  const [graphH, setGraphH] = useState(loadSplit);
  const rootRef = useRef<HTMLDivElement>(null);
  const commitFile = useGitStore((s) => s.commitFileSelected);
  const commitDiff = useGitStore((s) => s.commitDiff);
  const commitDiffLoading = useGitStore((s) => s.commitDiffLoading);
  const detail = useGitStore((s) => s.commitDetail);

  useEffect(() => {
    try {
      localStorage.setItem(SPLIT_KEY, String(graphH));
    } catch {
      // 忽略隐私模式下的存储失败
    }
  }, [graphH]);

  return (
    <div className="onyx-graph-workbench" ref={rootRef}>
      <div className="onyx-graph-top" style={{ height: graphH }}>
        <GitGraphView />
      </div>
      <div className="onyx-graph-bottom">
        <ResizeHandle
          axis="row"
          value={graphH}
          min={SPLIT_MIN}
          max={2000}
          getMax={() => {
            const h = rootRef.current?.getBoundingClientRect().height ?? 600;
            return Math.max(SPLIT_MIN, h - DIFF_MIN);
          }}
          onChange={setGraphH}
          onReset={() => setGraphH(SPLIT_DEFAULT)}
          title="拖拽调整 Git 树与 Diff 的高度，双击恢复默认"
        />
        <ReadonlyDiffPane
          file={commitFile}
          diff={commitDiff}
          loading={commitDiffLoading}
          emptyText={detail && detail.files.length === 0 ? '该提交没有文件改动' : '选择左侧提交中的文件查看 Diff'}
          tag={detail ? detail.shortHash : undefined}
        />
      </div>
    </div>
  );
}

function CompareWorkbench() {
  const file = useGitStore((s) => s.compareFileSelected);
  const diff = useGitStore((s) => s.compareDiff);
  const loading = useGitStore((s) => s.compareDiffLoading);
  const base = useGitStore((s) => s.compareBase);
  const head = useGitStore((s) => s.compareHead);
  const threeDot = useGitStore((s) => s.compareThreeDot);
  const result = useGitStore((s) => s.compareResult);
  const headLabel = head === WORKTREE_REF ? 'Working Tree' : head;
  return (
    <ReadonlyDiffPane
      file={file}
      diff={diff}
      loading={loading}
      canOpenFile={head === WORKTREE_REF}
      emptyText={result && result.files.length === 0 ? '两个引用之间没有文件差异' : '选择左侧对比结果中的文件查看 Diff'}
      tag={base && head ? `${base}${threeDot ? '...' : '..'}${headLabel}` : undefined}
    />
  );
}

export function GitCenter() {
  const tab = useGitStore((s) => s.gitTab);
  const notRepo = useGitStore((s) => s.status?.isRepo === false);
  // 非仓库时统一回到 Changes 视图展示初始化引导
  const effective = notRepo ? 'changes' : tab;
  return (
    <>
      <div className="onyx-git-center-pane" style={{ display: effective === 'changes' ? 'flex' : 'none' }}>
        <DiffView />
      </div>
      {effective === 'graph' && (
        <div className="onyx-git-center-pane">
          <GraphWorkbench />
        </div>
      )}
      {effective === 'compare' && (
        <div className="onyx-git-center-pane">
          <CompareWorkbench />
        </div>
      )}
    </>
  );
}
