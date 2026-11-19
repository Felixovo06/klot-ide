import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const tokensPath = path.join(ROOT_DIR, 'antigravity-design-system', 'tokens.json');
const outputPath = path.join(ROOT_DIR, 'src', 'styles', 'onyx-generated-themes.ts');

const rawTokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
const light = rawTokens.color.light;
const dark = rawTokens.color.dark;

function stripHash(hex) {
  return String(hex).replace(/^#/, '').toUpperCase();
}

function buildMonacoLightTheme() {
  return {
    base: 'vs',
    inherit: true,
    rules: [
      { token: '', foreground: stripHash(light.content.primary.$value), background: stripHash(light.surface.canvas.$value) },
      { token: 'comment', foreground: stripHash(light.content.placeholder.$value), fontStyle: 'italic' },
      { token: 'keyword', foreground: stripHash(light.chart['1'].$value) },
      { token: 'keyword.control', foreground: stripHash(light.chart['1'].$value) },
      { token: 'storage', foreground: stripHash(light.chart['1'].$value) },
      { token: 'string', foreground: stripHash(light.chart['3'].$value) },
      { token: 'number', foreground: stripHash(light.chart['2'].$value) },
      { token: 'constant', foreground: stripHash(light.chart['2'].$value) },
      { token: 'type', foreground: stripHash(light.chart['6'].$value) },
      { token: 'type.identifier', foreground: stripHash(light.chart['6'].$value) },
      { token: 'class', foreground: stripHash(light.chart['6'].$value) },
      { token: 'interface', foreground: stripHash(light.chart['6'].$value) },
      { token: 'function', foreground: stripHash(light.chart['4'].$value) },
      { token: 'identifier.function', foreground: stripHash(light.chart['4'].$value) },
      { token: 'variable', foreground: stripHash(light.content.primary.$value) },
      { token: 'operator', foreground: stripHash(light.content.secondary.$value) },
      { token: 'delimiter', foreground: stripHash(light.content.tertiary.$value) },
      { token: 'tag', foreground: stripHash(light.chart['5'].$value) },
      { token: 'attribute.name', foreground: stripHash(light.chart['4'].$value) },
      { token: 'attribute.value', foreground: stripHash(light.chart['3'].$value) },
      { token: 'regexp', foreground: stripHash(light.status.code.$value) },
    ],
    colors: {
      'editor.background': light.surface.canvas.$value,
      'editor.foreground': light.content.primary.$value,
      'editorLineNumber.foreground': '#9CA3AF',
      'editorLineNumber.activeForeground': '#4B5563',
      'editorCursor.foreground': light.accent.default.$value,
      'editor.selectionBackground': '#2F75C31A',
      'editor.inactiveSelectionBackground': '#2F75C30F',
      'editor.lineHighlightBackground': '#0F172A05',
      'editor.lineHighlightBorder': '#00000000',
      'editorIndentGuide.background1': '#0F172A0B',
      'editorIndentGuide.activeBackground1': '#0F172A1E',
      'editorWhitespace.foreground': '#0A0A0C1A',
      'editorGutter.background': light.surface.canvas.$value,
      'editorGutter.addedBackground': light.status.success.$value,
      'editorGutter.modifiedBackground': light.status.warning.$value,
      'editorGutter.deletedBackground': light.status.error.$value,
      'diffEditor.insertedTextBackground': '#EEF6EBCC',
      'diffEditor.insertedLineBackground': '#EEF6EB99',
      'diffEditor.removedTextBackground': '#FDEEEECC',
      'diffEditor.removedLineBackground': '#FDEEEE99',
      'diffEditor.diagonalFill': '#0A0A0C0A',
      'editorWidget.background': light.onyx.raised.$value,
      'editorWidget.border': '#E8E8EA',
      'editorSuggestWidget.background': light.onyx.raised.$value,
      'editorSuggestWidget.border': '#E8E8EA',
      'editorSuggestWidget.selectedBackground': '#2F75C314',
      'scrollbarSlider.background': '#0A0A0C14',
      'scrollbarSlider.hoverBackground': '#0A0A0C26',
      'scrollbarSlider.activeBackground': '#0A0A0C38',
    },
  };
}

function buildMonacoDarkTheme() {
  return {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: stripHash(dark.content.primary.$value), background: stripHash(dark.surface.canvas.$value) },
      { token: 'comment', foreground: stripHash(dark.content.placeholder.$value), fontStyle: 'italic' },
      { token: 'keyword', foreground: stripHash(dark.chart['1'].$value) },
      { token: 'keyword.control', foreground: stripHash(dark.chart['1'].$value) },
      { token: 'storage', foreground: stripHash(dark.chart['1'].$value) },
      { token: 'string', foreground: stripHash(dark.chart['3'].$value) },
      { token: 'number', foreground: stripHash(dark.chart['2'].$value) },
      { token: 'constant', foreground: stripHash(dark.chart['2'].$value) },
      { token: 'type', foreground: stripHash(dark.chart['6'].$value) },
      { token: 'type.identifier', foreground: stripHash(dark.chart['6'].$value) },
      { token: 'class', foreground: stripHash(dark.chart['6'].$value) },
      { token: 'interface', foreground: stripHash(dark.chart['6'].$value) },
      { token: 'function', foreground: stripHash(dark.chart['4'].$value) },
      { token: 'identifier.function', foreground: stripHash(dark.chart['4'].$value) },
      { token: 'variable', foreground: stripHash(dark.content.primary.$value) },
      { token: 'operator', foreground: stripHash(dark.content.secondary.$value) },
      { token: 'delimiter', foreground: stripHash(dark.content.tertiary.$value) },
      { token: 'tag', foreground: stripHash(dark.chart['5'].$value) },
      { token: 'attribute.name', foreground: stripHash(dark.chart['4'].$value) },
      { token: 'attribute.value', foreground: stripHash(dark.chart['3'].$value) },
      { token: 'regexp', foreground: stripHash(dark.status.code.$value) },
    ],
    colors: {
      'editor.background': dark.surface.canvas.$value,
      'editor.foreground': dark.content.primary.$value,
      'editorLineNumber.foreground': dark.content.placeholder.$value,
      'editorLineNumber.activeForeground': dark.content.secondary.$value,
      'editorCursor.foreground': dark.accent.default.$value,
      'editor.selectionBackground': '#2F71E338',
      'editor.inactiveSelectionBackground': '#2F71E320',
      'editor.lineHighlightBackground': '#FFFFFF08',
      'editor.lineHighlightBorder': '#00000000',
      'editorIndentGuide.background1': '#FFFFFF10',
      'editorIndentGuide.activeBackground1': '#FFFFFF26',
      'editorWhitespace.foreground': '#FFFFFF1A',
      'editorGutter.background': dark.surface.canvas.$value,
      'editorGutter.addedBackground': dark.status.success.$value,
      'editorGutter.modifiedBackground': dark.status.warning.$value,
      'editorGutter.deletedBackground': dark.status.error.$value,
      'diffEditor.insertedTextBackground': '#7AAE6624',
      'diffEditor.insertedLineBackground': '#7AAE661C',
      'diffEditor.removedTextBackground': '#DE555526',
      'diffEditor.removedLineBackground': '#DE55551E',
      'diffEditor.diagonalFill': '#FFFFFF0A',
      'editorWidget.background': dark.onyx.raised.$value,
      'editorWidget.border': '#27272E',
      'editorSuggestWidget.background': dark.onyx.raised.$value,
      'editorSuggestWidget.border': '#27272E',
      'editorSuggestWidget.selectedBackground': '#2F71E32A',
      'scrollbarSlider.background': '#FFFFFF16',
      'scrollbarSlider.hoverBackground': '#FFFFFF28',
      'scrollbarSlider.activeBackground': '#FFFFFF3C',
    },
  };
}

function buildXtermLightTheme() {
  return {
    background: light.surface.card.$value,
    foreground: '#24292F',
    cursor: light.accent.default.$value,
    cursorAccent: light.surface.card.$value,
    selectionBackground: '#2F75C31F',
    selectionForeground: '#24292F',
    selectionInactiveBackground: '#2F75C310',
    black: '#3F3F46',
    red: '#C94A4A',
    green: '#3D7A47',
    yellow: '#9A6B16',
    blue: '#2B6CB0',
    magenta: '#7C3AED',
    cyan: '#0E7490',
    white: '#F4F4F5',
    brightBlack: '#71717A',
    brightRed: '#DC5252',
    brightGreen: '#2F855A',
    brightYellow: '#B47B14',
    brightBlue: '#3B82C4',
    brightMagenta: '#8B5CF6',
    brightCyan: '#0284C7',
    brightWhite: light.surface.card.$value,
  };
}

function buildXtermDarkTheme() {
  return {
    background: dark.surface.card.$value,
    foreground: dark.content.primary.$value,
    cursor: dark.accent.default.$value,
    cursorAccent: dark.surface.card.$value,
    selectionBackground: '#2F71E340',
    selectionForeground: dark.content.primary.$value,
    selectionInactiveBackground: '#2F71E324',
    black: '#18181B',
    red: dark.status.error.$value,
    green: dark.status.success.$value,
    yellow: dark.status.warning.$value,
    blue: dark.accent.default.$value,
    magenta: dark.chart['4'].$value,
    cyan: dark.chart['6'].$value,
    white: dark.content.secondary.$value,
    brightBlack: dark.content.placeholder.$value,
    brightRed: '#F87171',
    brightGreen: '#4ADE80',
    brightYellow: '#FBBF24',
    brightBlue: dark.status.link.$value,
    brightMagenta: '#D8B4FE',
    brightCyan: '#38BDF8',
    brightWhite: dark.content.primary.$value,
  };
}

const monacoLight = buildMonacoLightTheme();
const monacoDark = buildMonacoDarkTheme();
const xtermLight = buildXtermLightTheme();
const xtermDark = buildXtermDarkTheme();

const content = `// 由 scripts/generate-onyx-theme.mjs 根据 antigravity-design-system/tokens.json 自动生成，请勿手动编辑
import type { ITheme } from '@xterm/xterm';
import type * as monaco from 'monaco-editor';

export const ONYX_MONACO_LIGHT: monaco.editor.IStandaloneThemeData = ${JSON.stringify(monacoLight, null, 2)};

export const ONYX_MONACO_DARK: monaco.editor.IStandaloneThemeData = ${JSON.stringify(monacoDark, null, 2)};

export const ONYX_XTERM_LIGHT: ITheme = ${JSON.stringify(xtermLight, null, 2)};

export const ONYX_XTERM_DARK: ITheme = ${JSON.stringify(xtermDark, null, 2)};
`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, content, 'utf8');
console.log('Generated:', path.relative(ROOT_DIR, outputPath));
