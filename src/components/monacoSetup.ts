// Monaco 初始化：本地 Worker、Onyx 主题、文件模型注册表、LSP 桥接（didOpen/didChange/definition/diagnostics）
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import { ONYX_MONACO_DARK, ONYX_MONACO_LIGHT } from '../styles/onyx-generated-themes';
import { fsReadFile, lspNotify, lspRequest } from '../lib/ipcClient';
import type { LspDiagnosticsEvent, LspRange } from '../types/ipc';
import { joinPath, languageForPath, lspLangForPath, normalizeSlashes, toRelPath } from '../stores/utils';

export { monaco };

export const MONO_FONT =
  '"SF Mono", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

export const EDITOR_BASE_OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
  fontFamily: MONO_FONT,
  fontSize: 13,
  lineHeight: 21,
  letterSpacing: 0,
  minimap: { enabled: false },
  lightbulb: { enabled: monaco.editor.ShowLightbulbIconMode.Off },
  glyphMargin: false,
  folding: false,
  lineNumbersMinChars: 4,
  lineDecorationsWidth: 10,
  renderLineHighlight: 'line',
  scrollBeyondLastLine: false,
  overviewRulerLanes: 0,
  overviewRulerBorder: false,
  hideCursorInOverviewRuler: true,
  automaticLayout: true,
  fixedOverflowWidgets: true,
  smoothScrolling: true,
  cursorSmoothCaretAnimation: 'on',
  cursorBlinking: 'smooth',
  stickyScroll: { enabled: false },
  bracketPairColorization: { enabled: false },
  guides: { indentation: true, bracketPairs: false },
  occurrencesHighlight: 'off',
  matchBrackets: 'never',
  padding: { top: 10, bottom: 10 },
  scrollbar: {
    verticalScrollbarSize: 8,
    horizontalScrollbarSize: 8,
    useShadows: false,
  },
  tabSize: 2,
  contextmenu: true,
  links: true,
};

// ==================== 外部钩子 ====================

interface MonacoHooks {
  onDirtyChange: (fullPath: string, dirty: boolean) => void;
  onOpenFile: (fullPath: string, line?: number, column?: number) => void;
}

const hooks: MonacoHooks = {
  onDirtyChange: () => {},
  onOpenFile: () => {},
};

let workspaceRoot = '';

export function setMonacoHooks(next: Partial<MonacoHooks>) {
  Object.assign(hooks, next);
}

export function setMonacoWorkspaceRoot(root: string) {
  workspaceRoot = root;
}

// ==================== 初始化 ====================

let initialized = false;

export function setupMonaco() {
  if (initialized) return;
  initialized = true;

  self.MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      switch (label) {
        case 'json':
          return new JsonWorker();
        case 'css':
        case 'scss':
        case 'less':
          return new CssWorker();
        case 'html':
        case 'handlebars':
        case 'razor':
          return new HtmlWorker();
        case 'typescript':
        case 'javascript':
          return new TsWorker();
        default:
          return new EditorWorker();
      }
    },
  };

  monaco.editor.defineTheme('onyx-light', ONYX_MONACO_LIGHT);
  monaco.editor.defineTheme('onyx-dark', ONYX_MONACO_DARK);
  // 独立版 Monaco 的括号配色挂在模型级选项上，编辑器级开关无法关闭，这里对每个新模型统一关闭以保持定稿图的单色括号
  monaco.editor.onDidCreateModel((model) => {
    model.updateOptions({
      bracketColorizationOptions: { enabled: false, independentColorPoolPerBracketType: false },
    });
  });

  const tsDefaults = monaco.languages.typescript.typescriptDefaults;
  const jsDefaults = monaco.languages.typescript.javascriptDefaults;
  const compilerOptions: monaco.languages.typescript.CompilerOptions = {
    target: monaco.languages.typescript.ScriptTarget.ESNext,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
    allowJs: true,
    allowNonTsExtensions: true,
    esModuleInterop: true,
    strict: true,
  };
  for (const d of [tsDefaults, jsDefaults]) {
    d.setCompilerOptions(compilerOptions);
    // 工作区未完整加载进 Worker，关闭语义校验避免误报；真实诊断交由本机 LSP
    d.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false });
    d.setEagerModelSync(true);
  }

  for (const lang of ['typescript', 'javascript', 'rust', 'python', 'go']) {
    monaco.languages.registerDefinitionProvider(lang, { provideDefinition });
  }

  monaco.editor.registerEditorOpener({
    openCodeEditor(_source, resource, selectionOrPosition) {
      const full = fullPathFromUri(resource);
      if (!full) return false;
      let line: number | undefined;
      let column: number | undefined;
      if (selectionOrPosition) {
        if ('startLineNumber' in selectionOrPosition) {
          line = selectionOrPosition.startLineNumber;
          column = selectionOrPosition.startColumn;
        } else {
          line = selectionOrPosition.lineNumber;
          column = selectionOrPosition.column;
        }
      }
      hooks.onOpenFile(full, line, column);
      return true;
    },
  });
}

export function setMonacoTheme(theme: 'light' | 'dark') {
  monaco.editor.setTheme(theme === 'dark' ? 'onyx-dark' : 'onyx-light');
}

// ==================== 文件模型注册表 ====================

interface FileModelEntry {
  fullPath: string;
  model: monaco.editor.ITextModel;
  savedVersion: number;
  dirty: boolean;
  lspLang: string | null;
  lspVersion: number;
  changeTimer: ReturnType<typeof setTimeout> | null;
  disposable: monaco.IDisposable;
}

const fileModels = new Map<string, FileModelEntry>();
const uriToFull = new Map<string, string>();

export function fileUri(fullPath: string): monaco.Uri {
  return monaco.Uri.file(fullPath);
}

export function fullPathFromUri(uri: monaco.Uri): string | null {
  const known = uriToFull.get(uri.toString());
  if (known) return known;
  if (uri.scheme === 'file') return normalizeSlashes(uri.path);
  return null;
}

export function getFileModel(fullPath: string): monaco.editor.ITextModel | null {
  return fileModels.get(fullPath)?.model ?? null;
}

export function listFileModelPaths(): string[] {
  return Array.from(fileModels.keys());
}

export function isFileModelDirty(fullPath: string): boolean {
  return fileModels.get(fullPath)?.dirty ?? false;
}

function updateDirty(entry: FileModelEntry) {
  const dirty = entry.model.getAlternativeVersionId() !== entry.savedVersion;
  if (dirty !== entry.dirty) {
    entry.dirty = dirty;
    hooks.onDirtyChange(entry.fullPath, dirty);
  }
}

function safeLspNotify(lang: string, method: string, params: unknown) {
  if (!workspaceRoot) return;
  lspNotify(workspaceRoot, lang, method, params).catch(() => {
    // 本机未安装对应 LSP 时静默降级
  });
}

export function ensureFileModel(fullPath: string, content: string): monaco.editor.ITextModel {
  const existing = fileModels.get(fullPath);
  if (existing) return existing.model;

  const uri = fileUri(fullPath);
  const language = languageForPath(fullPath);
  let model = monaco.editor.getModel(uri);
  if (model) {
    if (model.getValue() !== content) model.setValue(content);
  } else {
    model = monaco.editor.createModel(content, language, uri);
  }
  uriToFull.set(uri.toString(), fullPath);

  const lspLang = lspLangForPath(fullPath);
  const entry: FileModelEntry = {
    fullPath,
    model,
    savedVersion: model.getAlternativeVersionId(),
    dirty: false,
    lspLang,
    lspVersion: 1,
    changeTimer: null,
    disposable: { dispose: () => {} },
  };

  entry.disposable = model.onDidChangeContent(() => {
    updateDirty(entry);
    if (entry.lspLang) {
      if (entry.changeTimer) clearTimeout(entry.changeTimer);
      entry.changeTimer = setTimeout(() => {
        entry.changeTimer = null;
        entry.lspVersion += 1;
        safeLspNotify(entry.lspLang!, 'textDocument/didChange', {
          textDocument: { uri: uri.toString(), version: entry.lspVersion },
          contentChanges: [{ text: entry.model.getValue() }],
        });
      }, 300);
    }
  });

  fileModels.set(fullPath, entry);

  if (lspLang) {
    safeLspNotify(lspLang, 'textDocument/didOpen', {
      textDocument: {
        uri: uri.toString(),
        languageId: language === 'plaintext' ? lspLang : language,
        version: entry.lspVersion,
        text: content,
      },
    });
  }
  return model;
}

/** 磁盘内容热重载：替换模型文本并视为已保存 */
export function reloadFileModel(fullPath: string, content: string): boolean {
  const entry = fileModels.get(fullPath);
  if (!entry || entry.dirty) return false;
  if (entry.model.getValue() === content) return false;
  entry.model.pushEditOperations(
    [],
    [{ range: entry.model.getFullModelRange(), text: content }],
    () => null,
  );
  entry.savedVersion = entry.model.getAlternativeVersionId();
  updateDirty(entry);
  return true;
}

export function markFileModelSaved(fullPath: string) {
  const entry = fileModels.get(fullPath);
  if (!entry) return;
  entry.savedVersion = entry.model.getAlternativeVersionId();
  updateDirty(entry);
  if (entry.lspLang) {
    safeLspNotify(entry.lspLang, 'textDocument/didSave', {
      textDocument: { uri: entry.model.uri.toString() },
    });
  }
}

export function disposeFileModel(fullPath: string) {
  const entry = fileModels.get(fullPath);
  if (!entry) return;
  if (entry.changeTimer) clearTimeout(entry.changeTimer);
  entry.disposable.dispose();
  if (entry.lspLang) {
    safeLspNotify(entry.lspLang, 'textDocument/didClose', {
      textDocument: { uri: entry.model.uri.toString() },
    });
  }
  uriToFull.delete(entry.model.uri.toString());
  fileModels.delete(fullPath);
  entry.model.dispose();
}

// ==================== LSP 定义跳转 ====================

interface NormalizedLocation {
  uri: monaco.Uri;
  range: LspRange;
}

function isRange(v: unknown): v is LspRange {
  const r = v as LspRange | undefined;
  return !!r && typeof r === 'object' && !!r.start && typeof r.start.line === 'number';
}

function normalizeLocations(result: unknown): NormalizedLocation[] {
  if (!result) return [];
  const list = Array.isArray(result) ? result : [result];
  const out: NormalizedLocation[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const uriStr =
      typeof rec.uri === 'string' ? rec.uri : typeof rec.targetUri === 'string' ? rec.targetUri : null;
    const range = isRange(rec.targetSelectionRange)
      ? rec.targetSelectionRange
      : isRange(rec.range)
        ? rec.range
        : isRange(rec.targetRange)
          ? rec.targetRange
          : null;
    if (!uriStr || !range) continue;
    try {
      out.push({ uri: monaco.Uri.parse(uriStr), range });
    } catch {
      // 忽略无法解析的 URI
    }
  }
  return out;
}

async function ensureModelForUri(uri: monaco.Uri): Promise<monaco.Uri> {
  if (monaco.editor.getModel(uri)) return uri;
  if (uri.scheme !== 'file') return uri;
  const full = normalizeSlashes(uri.path);
  const file = await fsReadFile(full);
  const model = ensureFileModel(full, file.content);
  return model.uri;
}

async function provideDefinition(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
): Promise<monaco.languages.Definition | null> {
  const full = fullPathFromUri(model.uri);
  if (!full || !workspaceRoot) return null;
  const lang = lspLangForPath(full);
  if (!lang) return null;
  try {
    const result = await lspRequest<unknown>(workspaceRoot, lang, 'textDocument/definition', {
      textDocument: { uri: model.uri.toString() },
      position: { line: position.lineNumber - 1, character: position.column - 1 },
    });
    const locations = normalizeLocations(result);
    if (locations.length === 0) return null;
    const out: monaco.languages.Location[] = [];
    for (const loc of locations) {
      let uri = loc.uri;
      try {
        uri = await ensureModelForUri(loc.uri);
      } catch {
        // 读取失败时仍返回原 URI，交给 opener 处理
      }
      out.push({
        uri,
        range: new monaco.Range(
          loc.range.start.line + 1,
          loc.range.start.character + 1,
          loc.range.end.line + 1,
          loc.range.end.character + 1,
        ),
      });
    }
    return out;
  } catch {
    // 无 LSP 时静默降级，交给 Monaco 内置能力
    return null;
  }
}

// ==================== LSP 诊断 ====================

function lspSeverity(sev: number | undefined): monaco.MarkerSeverity {
  switch (sev) {
    case 1:
      return monaco.MarkerSeverity.Error;
    case 2:
      return monaco.MarkerSeverity.Warning;
    case 3:
      return monaco.MarkerSeverity.Info;
    default:
      return monaco.MarkerSeverity.Hint;
  }
}

export function applyLspDiagnostics(ev: LspDiagnosticsEvent) {
  let model: monaco.editor.ITextModel | null = null;
  if (ev.uri) {
    try {
      model = monaco.editor.getModel(monaco.Uri.parse(ev.uri));
    } catch {
      model = null;
    }
  }
  if (!model && ev.path) {
    const full = joinPath(workspaceRoot, toRelPath(workspaceRoot, ev.path));
    model = getFileModel(full);
  }
  if (!model) return;
  monaco.editor.setModelMarkers(
    model,
    'lsp',
    ev.diagnostics.map((d) => ({
      startLineNumber: d.range.start.line + 1,
      startColumn: d.range.start.character + 1,
      endLineNumber: d.range.end.line + 1,
      endColumn: d.range.end.character + 1,
      message: d.message,
      severity: lspSeverity(d.severity),
      source: d.source,
      code: d.code === undefined ? undefined : String(d.code),
    })),
  );
}
