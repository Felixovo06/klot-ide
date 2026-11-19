// 只读 Diff 面板：用于 Git 树中的提交文件 Diff 与分支对比 Diff（与工作区 DiffView 相互独立）
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ExternalLink, FileText, GitCompare } from 'lucide-react';
import type { GitDiffResult, GitFileChange } from '../types/ipc';
import { useUiStore } from '../stores/uiStore';
import { languageForPath } from '../stores/utils';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { EDITOR_BASE_OPTIONS, monaco } from './monacoSetup';
import { ICON_STROKE, Segmented } from './ui';

let paneSeq = 0;

export function ReadonlyDiffPane({
  file,
  diff,
  loading,
  emptyText,
  tag,
  canOpenFile = true,
}: {
  file: GitFileChange | null;
  diff: GitDiffResult | null;
  loading: boolean;
  emptyText: string;
  /** 头部右侧的上下文标签，例如提交短 Hash 或 base..head */
  tag?: ReactNode;
  canOpenFile?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const prefs = useUiStore((s) => s.prefs);
  const [layout, setLayout] = useState<'inline' | 'split'>('split');

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const initPrefs = useUiStore.getState().prefs;
    const editor = monaco.editor.createDiffEditor(host, {
      ...EDITOR_BASE_OPTIONS,
      fontSize: initPrefs.editorFontSize,
      lineHeight: Math.round(initPrefs.editorFontSize * 1.6),
      wordWrap: initPrefs.wordWrap,
      theme: useUiStore.getState().theme === 'dark' ? 'onyx-dark' : 'onyx-light',
      renderSideBySide: true,
      useInlineViewWhenSpaceIsLimited: false,
      originalEditable: false,
      readOnly: true,
      renderOverviewRuler: false,
      renderIndicators: true,
      renderMarginRevertIcon: false,
      ignoreTrimWhitespace: false,
      enableSplitViewResizing: true,
      lineNumbersMinChars: 3,
      lineDecorationsWidth: 14,
    });
    editorRef.current = editor;
    return () => {
      editor.setModel(null);
      editor.dispose();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    editorRef.current?.updateOptions({ renderSideBySide: layout === 'split' });
  }, [layout]);

  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    const opts = {
      fontSize: prefs.editorFontSize,
      lineHeight: Math.round(prefs.editorFontSize * 1.6),
      wordWrap: prefs.wordWrap,
      tabSize: prefs.tabSize,
    };
    ed.getOriginalEditor().updateOptions(opts);
    ed.getModifiedEditor().updateOptions(opts);
  }, [prefs.editorFontSize, prefs.wordWrap, prefs.tabSize]);

  const hasDiff = !!diff && !!file && diff.path === file.path;
  const showEditor = hasDiff && !diff.isBinary;

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (!showEditor || !diff) {
      editor.setModel(null);
      return;
    }
    paneSeq += 1;
    const lang = languageForPath(diff.path);
    const original = monaco.editor.createModel(
      diff.originalText,
      lang,
      monaco.Uri.from({ scheme: 'ke-history', path: `/${diff.path}`, query: `base-${paneSeq}` }),
    );
    const modified = monaco.editor.createModel(
      diff.modifiedText,
      lang,
      monaco.Uri.from({ scheme: 'ke-history', path: `/${diff.path}`, query: `head-${paneSeq}` }),
    );
    editor.setModel({ original, modified });
    return () => {
      editor.setModel(null);
      original.dispose();
      modified.dispose();
    };
  }, [diff, showEditor]);

  const openFile = () => {
    if (!file || file.status === 'D') return;
    useUiStore.getState().setMode('code');
    void useWorkspaceStore.getState().openFile(file.path);
  };

  return (
    <div className="onyx-diff">
      <div className="onyx-diff-head">
        {file ? (
          <>
            <FileText size={15} strokeWidth={ICON_STROKE} className="onyx-dim" />
            <span className="onyx-diff-path" title={file.oldPath ? `${file.oldPath} -> ${file.path}` : file.path}>
              {file.path}
            </span>
            {hasDiff && (
              <span className="onyx-diff-stats">
                <span className="onyx-stat-add">+{diff.additions}</span>
                <span className="onyx-stat-del">-{diff.deletions}</span>
              </span>
            )}
            {file.oldPath && <span className="onyx-diff-tag">Renamed</span>}
            {hasDiff && diff.isNewFile && <span className="onyx-diff-tag">New</span>}
            {file.status === 'D' && <span className="onyx-diff-tag">Deleted</span>}
          </>
        ) : (
          <span className="onyx-dim">{emptyText}</span>
        )}
        <div className="onyx-diff-head-right">
          {tag && <span className="onyx-diff-ref-tag">{tag}</span>}
          {hasDiff && !diff.isBinary && (
            <Segmented
              size="sm"
              value={layout}
              onChange={setLayout}
              options={[
                { value: 'inline', label: 'Inline' },
                { value: 'split', label: 'Split' },
              ]}
            />
          )}
          {hasDiff && canOpenFile && (
            <button type="button" className="onyx-ghost-btn" disabled={file?.status === 'D'} onClick={openFile}>
              Open File
              <ExternalLink size={13} strokeWidth={ICON_STROKE} />
            </button>
          )}
        </div>
      </div>
      <div className="onyx-diff-body">
        <div ref={hostRef} className={`onyx-editor-host${showEditor ? '' : ' is-hidden'}`} />
        {!file && !loading && (
          <div className="onyx-editor-empty">
            <div className="onyx-empty-icon">
              <GitCompare size={20} strokeWidth={ICON_STROKE} />
            </div>
            <div className="onyx-editor-empty-sub">{emptyText}</div>
          </div>
        )}
        {file && hasDiff && diff.isBinary && (
          <div className="onyx-editor-empty">
            <div className="onyx-editor-empty-sub">二进制文件，无法显示文本 Diff</div>
          </div>
        )}
        {loading && !hasDiff && (
          <div className="onyx-editor-empty">
            <div className="onyx-editor-empty-sub">Loading diff...</div>
          </div>
        )}
      </div>
    </div>
  );
}
