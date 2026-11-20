import { useEffect, useRef, useState } from 'react';
import { ExternalLink, FileText, GitCompare } from 'lucide-react';
import { editorBridge } from '../stores/editorBridge';
import { findChange, useGitStore } from '../stores/gitStore';
import { useUiStore } from '../stores/uiStore';
import { joinPath, languageForPath } from '../stores/utils';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { GitInitEmpty } from './GitInitEmpty';
import { EDITOR_BASE_OPTIONS, ensureFileModel, getFileModel, monaco } from './monacoSetup';
import { ICON_STROKE, Segmented } from './ui';

let diffSeq = 0;

export function DiffView() {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const viewStateRef = useRef<{ path: string; state: monaco.editor.IDiffEditorViewState | null } | null>(null);
  const diff = useGitStore((s) => s.diff);
  const selected = useGitStore((s) => s.selected);
  const status = useGitStore((s) => s.status);
  const diffLoading = useGitStore((s) => s.diffLoading);
  const activeRepoRoot = useGitStore((s) => s.activeRepoRoot);
  const root = useWorkspaceStore((s) => s.root);
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
      readOnly: false,
      renderOverviewRuler: false,
      renderIndicators: true,
      renderMarginRevertIcon: false,
      ignoreTrimWhitespace: false,
      enableSplitViewResizing: true,
      lineNumbersMinChars: 3,
      lineDecorationsWidth: 14,
    });
    editorRef.current = editor;
    editorBridge.diffEditor = editor;
    return () => {
      if (editorBridge.diffEditor === editor) editorBridge.diffEditor = null;
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

  const change = selected ? findChange(status, selected.path) : null;
  const isDeleted = change?.status === 'D';

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (!diff || !selected || diff.path !== selected.path || diff.isBinary) {
      editor.setModel(null);
      return;
    }
    const lang = languageForPath(diff.path);
    diffSeq += 1;
    const original = monaco.editor.createModel(
      diff.originalText,
      lang,
      monaco.Uri.from({ scheme: 'onyx-git', path: `/${diff.path}`, query: `base-${diffSeq}` }),
    );
    let modified: monaco.editor.ITextModel;
    let ownsModified = false;
    const editable = !selected.staged && !isDeleted;
    if (editable) {
      const full = joinPath(activeRepoRoot || root, diff.path);
      modified = getFileModel(full) ?? ensureFileModel(full, diff.modifiedText);
    } else {
      ownsModified = true;
      modified = monaco.editor.createModel(
        diff.modifiedText,
        lang,
        monaco.Uri.from({ scheme: 'onyx-git', path: `/${diff.path}`, query: `staged-${diffSeq}` }),
      );
    }
    editor.setModel({ original, modified });
    editor.getModifiedEditor().updateOptions({ readOnly: !editable });
    const saved = viewStateRef.current;
    if (saved && saved.path === diff.path && saved.state) editor.restoreViewState(saved.state);

    return () => {
      viewStateRef.current = { path: diff.path, state: editor.saveViewState() };
      editor.setModel(null);
      original.dispose();
      if (ownsModified) modified.dispose();
    };
  }, [diff, selected, root, activeRepoRoot, isDeleted]);

  const openFile = () => {
    if (!selected || isDeleted) return;
    const wsPath = useGitStore.getState().toWorkspaceRel(selected.path);
    useUiStore.getState().setMode('code');
    void useWorkspaceStore.getState().openFile(wsPath);
  };

  const hasDiff = !!diff && !!selected && diff.path === selected.path;
  const notRepo = status?.isRepo === false;
  const showEditor = !notRepo && hasDiff && !diff.isBinary;
  const showHeadActions = !notRepo && !!selected && !!diff;

  return (
    <div className="onyx-diff">
      <div className="onyx-diff-head">
        {selected && !notRepo ? (
          <>
            <FileText size={15} strokeWidth={ICON_STROKE} className="onyx-dim" />
            <span className="onyx-diff-path" title={selected.path}>
              {selected.path}
            </span>
            {hasDiff && (
              <span className="onyx-diff-stats">
                <span className="onyx-stat-add">+{diff.additions}</span>
                <span className="onyx-stat-del">-{diff.deletions}</span>
              </span>
            )}
            {selected.staged && <span className="onyx-diff-tag">Staged</span>}
            {hasDiff && diff.isNewFile && <span className="onyx-diff-tag">New</span>}
          </>
        ) : (
          <span className="onyx-dim">Git Review</span>
        )}
        {showHeadActions && (
          <div className="onyx-diff-head-right">
            {!diff.isBinary && (
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
            <button type="button" className="onyx-ghost-btn" disabled={isDeleted} onClick={openFile}>
              Open File
              <ExternalLink size={13} strokeWidth={ICON_STROKE} />
            </button>
          </div>
        )}
      </div>
      <div className="onyx-diff-body">
        <div ref={hostRef} className={`onyx-editor-host${showEditor ? '' : ' is-hidden'}`} />
        {notRepo && (
          <div className="onyx-editor-empty">
            <GitInitEmpty variant="canvas" />
          </div>
        )}
        {!notRepo && !selected && status && (
          <div className="onyx-editor-empty">
            <div className="onyx-empty-icon">
              <GitCompare size={20} strokeWidth={ICON_STROKE} />
            </div>
            <div className="onyx-editor-empty-sub">工作区很干净，没有待审查的改动</div>
          </div>
        )}
        {!notRepo && selected && hasDiff && diff.isBinary && (
          <div className="onyx-editor-empty">
            <div className="onyx-editor-empty-sub">二进制文件，无法显示文本 Diff</div>
          </div>
        )}
        {!notRepo && selected && !hasDiff && diffLoading && (
          <div className="onyx-editor-empty">
            <div className="onyx-editor-empty-sub">Loading diff...</div>
          </div>
        )}
      </div>
    </div>
  );
}
