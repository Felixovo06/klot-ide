// Code 模式主编辑舞台：统筹源码编辑器（永不卸载）、Split 实时预览分屏与 Markdown 阅读模式
import { useCallback, useEffect, useRef, useState } from 'react';
import { editorBridge, relayoutEditors } from '../stores/editorBridge';
import { type MarkdownViewMode, useUiStore } from '../stores/uiStore';
import { isMarkdownPath, joinPath } from '../stores/utils';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { CodeEditor } from './CodeEditor';
import { MarkdownReader, type MarkdownReaderHandle } from './MarkdownPreview';
import { monaco } from './monacoSetup';
import { ResizeHandle } from './ResizeHandle';

export function EditorStage() {
  const activePath = useWorkspaceStore((s) => s.activePath);
  const root = useWorkspaceStore((s) => s.root);
  const markdownViews = useUiStore((s) => s.markdownViews);
  const markdownDefaultView = useUiStore((s) => s.prefs.markdownDefaultView);
  const splitRatio = useUiStore((s) => s.markdownSplitRatio);
  const setSplitRatio = useUiStore((s) => s.setMarkdownSplitRatio);
  const resetSplitRatio = useUiStore((s) => s.resetMarkdownSplitRatio);

  const isMd = isMarkdownPath(activePath);
  const effectiveView: MarkdownViewMode =
    isMd && activePath ? (markdownViews[activePath] ?? markdownDefaultView) : 'edit';

  const stageRef = useRef<HTMLDivElement>(null);
  const readerRef = useRef<MarkdownReaderHandle>(null);
  const [stageWidth, setStageWidth] = useState(0);

  const handoffLineRef = useRef<number | null>(null);
  const lastReaderLineRef = useRef<number>(1);
  const prevStateRef = useRef<{ path: string | null; view: MarkdownViewMode }>({
    path: activePath,
    view: effectiveView,
  });

  // 在渲染前记录 edit -> read/split 衔接行号，确保 MarkdownReader 挂载首帧即可定位
  if (
    prevStateRef.current.path === activePath &&
    prevStateRef.current.view === 'edit' &&
    (effectiveView === 'read' || effectiveView === 'split')
  ) {
    handoffLineRef.current = editorBridge.codeEditor?.getVisibleRanges()[0]?.startLineNumber ?? 1;
  } else if (prevStateRef.current.path !== activePath) {
    handoffLineRef.current = null;
    lastReaderLineRef.current = 1;
  }

  // 监测舞台宽度用于 Split 像素比例换算
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStageWidth(el.getBoundingClientRect().width);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 处理视图模式切换后的 Monaco 重排、位置衔接与焦点恢复
  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = { path: activePath, view: effectiveView };

    if (prev.view === effectiveView) return;

    if (effectiveView === 'edit' || effectiveView === 'split') {
      const targetLine = prev.view === 'read' && prev.path === activePath ? lastReaderLineRef.current : 0;
      const raf = requestAnimationFrame(() => {
        relayoutEditors();
        const ed = editorBridge.codeEditor;
        if (!ed) return;
        if (targetLine > 1) {
          ed.revealLineNearTop(targetLine, monaco.editor.ScrollType.Immediate);
        }
        if (effectiveView === 'edit' && prev.path === activePath) {
          ed.focus();
        }
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [activePath, effectiveView]);

  // Split 模式：双向滚动同步（140ms 回环锁 + rAF 节流）
  const syncFromEditorUntilRef = useRef(0);
  const syncFromPreviewUntilRef = useRef(0);
  const previewRafRef = useRef(0);

  useEffect(() => {
    if (!isMd || !activePath || effectiveView !== 'split') return;
    const ed = editorBridge.codeEditor;
    if (!ed) return;
    let editorRaf = 0;

    const sub = ed.onDidScrollChange((e) => {
      if (!e.scrollTopChanged) return;
      if (performance.now() < syncFromPreviewUntilRef.current) return;
      if (editorRaf) return;
      editorRaf = requestAnimationFrame(() => {
        editorRaf = 0;
        syncFromEditorUntilRef.current = performance.now() + 140;
        const topLine = ed.getVisibleRanges()[0]?.startLineNumber ?? 1;
        readerRef.current?.scrollToLine(topLine, false);
      });
    });

    return () => {
      sub.dispose();
      if (editorRaf) cancelAnimationFrame(editorRaf);
    };
  }, [isMd, activePath, effectiveView]);

  useEffect(() => {
    return () => {
      if (previewRafRef.current) cancelAnimationFrame(previewRafRef.current);
    };
  }, []);

  const handlePreviewScroll = useCallback(() => {
    if (effectiveView !== 'split') return;
    if (performance.now() < syncFromEditorUntilRef.current) return;
    if (previewRafRef.current) return;
    previewRafRef.current = requestAnimationFrame(() => {
      previewRafRef.current = 0;
      const ed = editorBridge.codeEditor;
      const reader = readerRef.current;
      if (!ed || !reader) return;
      syncFromPreviewUntilRef.current = performance.now() + 140;
      const topLine = reader.getTopVisibleLine();
      ed.setScrollTop(ed.getTopForLineNumber(topLine));
    });
  }, [effectiveView]);

  const handleVisibleLineChange = useCallback((line: number) => {
    lastReaderLineRef.current = line;
  }, []);

  const fullPath = activePath ? joinPath(root, activePath) : '';
  const showReader = isMd && Boolean(activePath) && (effectiveView === 'read' || effectiveView === 'split');
  const minSplitPx = stageWidth > 0 ? Math.round(stageWidth * 0.25) : 200;
  const maxSplitPx = stageWidth > 0 ? Math.round(stageWidth * 0.75) : 600;
  const editorSplitPx = stageWidth > 0 ? Math.round(stageWidth * splitRatio) : 0;

  const editorPaneStyle =
    effectiveView === 'read'
      ? { display: 'none' }
      : effectiveView === 'split'
        ? { width: editorSplitPx > 0 ? editorSplitPx : '50%', flex: 'none' }
        : undefined;

  return (
    <div ref={stageRef} className={`onyx-editor-stage is-${effectiveView}`}>
      <div className="onyx-editor-pane" style={editorPaneStyle}>
        <CodeEditor hidden={effectiveView === 'read'} />
      </div>
      {effectiveView === 'split' && isMd && activePath && (
        <ResizeHandle
          axis="col"
          value={editorSplitPx > 0 ? editorSplitPx : 400}
          min={minSplitPx}
          max={maxSplitPx}
          onChange={(px) => {
            const w = stageRef.current?.getBoundingClientRect().width || stageWidth;
            if (w > 0) setSplitRatio(px / w);
          }}
          onReset={resetSplitRatio}
          className="onyx-md-split-handle"
          title="拖拽调整编辑与预览分栏比例，双击恢复默认"
        />
      )}
      {showReader && activePath && (
        <div className="onyx-md-pane">
          <MarkdownReader
            ref={readerRef}
            path={activePath}
            fullPath={fullPath}
            variant={effectiveView === 'split' ? 'split' : 'read'}
            initialScrollLine={handoffLineRef.current}
            onScroll={handlePreviewScroll}
            onVisibleLineChange={handleVisibleLineChange}
          />
        </div>
      )}
    </div>
  );
}
