import { useEffect, useRef } from 'react';
import { gitDiffFile } from '../lib/ipcClient';
import { useCliStore } from '../stores/cliStore';
import { editorBridge } from '../stores/editorBridge';
import { findChange, useGitStore } from '../stores/gitStore';
import { useUiStore } from '../stores/uiStore';
import { debounce, joinPath, toRelPath } from '../stores/utils';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { computeLineChanges } from './lineDiff';
import { EDITOR_BASE_OPTIONS, fullPathFromUri, getFileModel, monaco } from './monacoSetup';
import { formatShortcut } from './shortcuts';
import { enclosingSymbols, scanSymbols, type SymbolEntry } from './symbols';
import { Kbd } from './ui';

const symbolCache = new WeakMap<monaco.editor.ITextModel, { version: number; symbols: SymbolEntry[] }>();

export function symbolsForModel(model: monaco.editor.ITextModel): SymbolEntry[] {
  const version = model.getVersionId();
  const cached = symbolCache.get(model);
  if (cached && cached.version === version) return cached.symbols;
  const symbols = scanSymbols(model.getValue());
  symbolCache.set(model, { version, symbols });
  return symbols;
}

function EmptyState() {
  const rows: Array<[string, string]> = [
    ['Go to File', 'Cmd+P'],
    ['Search in Files', 'Cmd+Shift+F'],
    ['Switch Code / Git', 'Cmd+1 / Cmd+2'],
    ['Toggle CLI', 'Cmd+J'],
    ['Toggle Console', 'Cmd+`'],
  ];
  return (
    <div className="onyx-editor-empty">
      <div className="onyx-editor-empty-title">Klot IDE</div>
      <div className="onyx-editor-empty-list">
        {rows.map(([label, keys]) => (
          <div key={label} className="onyx-editor-empty-row">
            <span>{label}</span>
            <Kbd>{formatShortcut(keys)}</Kbd>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CodeEditor() {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const decorationsRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const viewStates = useRef(new Map<string, monaco.editor.ICodeEditorViewState | null>());
  const currentPathRef = useRef<string | null>(null);
  const activePath = useWorkspaceStore((s) => s.activePath);
  const root = useWorkspaceStore((s) => s.root);
  const reveal = useWorkspaceStore((s) => s.reveal);
  const statusVersion = useGitStore((s) => s.statusVersion);

  // 创建编辑器实例
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const editor = monaco.editor.create(host, {
      ...EDITOR_BASE_OPTIONS,
      model: null,
      theme: useUiStore.getState().theme === 'dark' ? 'onyx-dark' : 'onyx-light',
    });
    editorRef.current = editor;
    editorBridge.codeEditor = editor;
    decorationsRef.current = editor.createDecorationsCollection();

    editor.addAction({
      id: 'onyx.sendSelectionToCli',
      label: 'Send Selection to CLI',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyL],
      contextMenuGroupId: '9_onyx',
      contextMenuOrder: 1,
      run: (ed) => {
        const model = ed.getModel();
        const sel = ed.getSelection();
        if (!model || !sel) return;
        const full = fullPathFromUri(model.uri);
        if (!full) return;
        const rel = toRelPath(useWorkspaceStore.getState().root, full);
        const start = sel.startLineNumber;
        let end = sel.endLineNumber;
        if (end > start && sel.endColumn === 1) end -= 1;
        useCliStore.getState().addChip({ path: rel, startLine: start, endLine: end });
        useUiStore.getState().focusCli();
      },
    });

    const updateCursorInfo = debounce(() => {
      const model = editor.getModel();
      const sel = editor.getSelection();
      const ws = useWorkspaceStore.getState();
      if (!model || !sel) {
        ws.setSelection(null);
        ws.setCursorSymbols([]);
        return;
      }
      const text = model.getValueInRange(sel);
      ws.setSelection(
        text ? { startLine: sel.startLineNumber, endLine: sel.endLineNumber, text } : null,
      );
      const symbols = symbolsForModel(model);
      ws.setCursorSymbols(enclosingSymbols(model.getValue(), symbols, sel.positionLineNumber).slice(-2));
    }, 120);
    const d1 = editor.onDidChangeCursorSelection(() => updateCursorInfo());
    const d2 = editor.onDidChangeModel(() => updateCursorInfo());

    return () => {
      updateCursorInfo.cancel();
      d1.dispose();
      d2.dispose();
      if (editorBridge.codeEditor === editor) editorBridge.codeEditor = null;
      editor.setModel(null);
      editor.dispose();
      editorRef.current = null;
      decorationsRef.current = null;
    };
  }, []);

  // 切换激活文件模型，并保存/恢复视图状态
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const prev = currentPathRef.current;
    if (prev && prev !== activePath && editor.getModel()) {
      viewStates.current.set(prev, editor.saveViewState());
    }
    if (!activePath) {
      editor.setModel(null);
      currentPathRef.current = null;
      return;
    }
    const model = getFileModel(joinPath(root, activePath));
    if (!model) return;
    if (editor.getModel() !== model) {
      editor.setModel(model);
      const vs = viewStates.current.get(activePath);
      if (vs) editor.restoreViewState(vs);
    }
    currentPathRef.current = activePath;
    if (useUiStore.getState().mode === 'code') editor.focus();
  }, [activePath, root]);

  // 定位到指定行
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !reveal || reveal.path !== activePath) return;
    const model = editor.getModel();
    if (!model) return;
    const line = Math.min(Math.max(1, reveal.line), model.getLineCount());
    const endLine = Math.min(Math.max(line, reveal.endLine ?? line), model.getLineCount());
    if (reveal.endLine && reveal.endLine > reveal.line) {
      editor.setSelection(new monaco.Range(line, 1, endLine, model.getLineMaxColumn(endLine)));
    } else if (reveal.column && reveal.endColumn) {
      editor.setSelection(new monaco.Range(line, reveal.column, line, reveal.endColumn));
    } else {
      editor.setPosition({ lineNumber: line, column: reveal.column ?? 1 });
    }
    editor.revealLinesInCenterIfOutsideViewport(line, endLine, monaco.editor.ScrollType.Smooth);
    editor.focus();
  }, [reveal, activePath]);

  // 2px Git Gutter：基于 gitDiffFile 原始文本与当前模型做行级比对
  useEffect(() => {
    const decorations = decorationsRef.current;
    if (!decorations) return;
    if (!activePath || !root) {
      decorations.clear();
      return;
    }
    const model = getFileModel(joinPath(root, activePath));
    if (!model) {
      decorations.clear();
      return;
    }
    let disposed = false;
    let base: string | null = null;

    const apply = () => {
      if (disposed) return;
      if (base === null) {
        decorations.clear();
        return;
      }
      const changes = computeLineChanges(base, model.getValue());
      const lineCount = model.getLineCount();
      const mk = (line: number, cls: string): monaco.editor.IModelDeltaDecoration => ({
        range: new monaco.Range(Math.min(line, lineCount), 1, Math.min(line, lineCount), 1),
        options: { isWholeLine: true, linesDecorationsClassName: `onyx-gutter ${cls}` },
      });
      decorations.set([
        ...changes.added.map((l) => mk(l, 'is-added')),
        ...changes.modified.map((l) => mk(l, 'is-modified')),
        ...changes.deleted.map((l) => mk(l, 'is-deleted')),
      ]);
    };

    const status = useGitStore.getState().status;
    const change = findChange(status, activePath);
    const load = async () => {
      if (!change || !status?.isRepo) {
        base = null;
      } else if (change.status === '?' || change.status === 'A') {
        base = '';
      } else {
        try {
          const inStaged = status.staged.some((c) => c.path === activePath);
          const diff = await gitDiffFile(root, activePath, inStaged);
          base = diff.isBinary ? null : diff.originalText;
        } catch {
          base = null;
        }
      }
      apply();
    };
    void load();

    const reapply = debounce(apply, 250);
    const sub = model.onDidChangeContent(() => reapply());
    return () => {
      disposed = true;
      reapply.cancel();
      sub.dispose();
    };
  }, [activePath, root, statusVersion]);

  return (
    <div className="onyx-editor-wrap">
      <div ref={hostRef} className={`onyx-editor-host${activePath ? '' : ' is-hidden'}`} />
      {!activePath && <EmptyState />}
    </div>
  );
}
