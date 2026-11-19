// 编辑器实例桥：让 store 与插件调度器在不直接持有 React 引用的情况下访问 Monaco 实例
import type * as monaco from 'monaco-editor';

export interface EditorSelectionSnapshot {
  startLine: number;
  endLine: number;
  text: string;
}

export const editorBridge: {
  codeEditor: monaco.editor.IStandaloneCodeEditor | null;
  diffEditor: monaco.editor.IStandaloneDiffEditor | null;
} = {
  codeEditor: null,
  diffEditor: null,
};

export function getCodeSelection(): EditorSelectionSnapshot | null {
  const editor = editorBridge.codeEditor;
  const model = editor?.getModel();
  const sel = editor?.getSelection();
  if (!editor || !model || !sel) return null;
  const text = model.getValueInRange(sel);
  if (!text) return null;
  return { startLine: sel.startLineNumber, endLine: sel.endLineNumber, text };
}

export function replaceCodeSelection(text: string): boolean {
  const editor = editorBridge.codeEditor;
  const sel = editor?.getSelection();
  if (!editor || !sel || !editor.getModel()) return false;
  editor.pushUndoStop();
  editor.executeEdits('onyx-plugin', [{ range: sel, text, forceMoveMarkers: true }]);
  editor.pushUndoStop();
  editor.focus();
  return true;
}

/** 立即按容器实际尺寸重新布局代码编辑器与 Diff 编辑器（拖拽分隔条时调用） */
export function relayoutEditors() {
  try {
    editorBridge.codeEditor?.layout();
  } catch {
    // 编辑器可能已销毁
  }
  try {
    editorBridge.diffEditor?.layout();
  } catch {
    // 编辑器可能已销毁
  }
}
