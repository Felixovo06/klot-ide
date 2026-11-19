// 由 scripts/generate-onyx-theme.mjs 根据 antigravity-design-system/tokens.json 自动生成，请勿手动编辑
import type { ITheme } from '@xterm/xterm';
import type * as monaco from 'monaco-editor';

export const ONYX_MONACO_LIGHT: monaco.editor.IStandaloneThemeData = {
  "base": "vs",
  "inherit": true,
  "rules": [
    {
      "token": "",
      "foreground": "0A0A0C",
      "background": "FFFFFF"
    },
    {
      "token": "comment",
      "foreground": "8E8E95",
      "fontStyle": "italic"
    },
    {
      "token": "keyword",
      "foreground": "1D4ED8"
    },
    {
      "token": "keyword.control",
      "foreground": "1D4ED8"
    },
    {
      "token": "storage",
      "foreground": "1D4ED8"
    },
    {
      "token": "string",
      "foreground": "15803D"
    },
    {
      "token": "number",
      "foreground": "B45309"
    },
    {
      "token": "constant",
      "foreground": "B45309"
    },
    {
      "token": "type",
      "foreground": "0369A1"
    },
    {
      "token": "type.identifier",
      "foreground": "0369A1"
    },
    {
      "token": "class",
      "foreground": "0369A1"
    },
    {
      "token": "interface",
      "foreground": "0369A1"
    },
    {
      "token": "function",
      "foreground": "7E22CE"
    },
    {
      "token": "identifier.function",
      "foreground": "7E22CE"
    },
    {
      "token": "variable",
      "foreground": "0A0A0C"
    },
    {
      "token": "operator",
      "foreground": "3F3F46"
    },
    {
      "token": "delimiter",
      "foreground": "71717A"
    },
    {
      "token": "tag",
      "foreground": "BE123C"
    },
    {
      "token": "attribute.name",
      "foreground": "7E22CE"
    },
    {
      "token": "attribute.value",
      "foreground": "15803D"
    },
    {
      "token": "regexp",
      "foreground": "A31515"
    }
  ],
  "colors": {
    "editor.background": "#FFFFFF",
    "editor.foreground": "#0A0A0C",
    "editorLineNumber.foreground": "#9CA3AF",
    "editorLineNumber.activeForeground": "#4B5563",
    "editorCursor.foreground": "#2F75C3",
    "editor.selectionBackground": "#2F75C31A",
    "editor.inactiveSelectionBackground": "#2F75C30F",
    "editor.lineHighlightBackground": "#0F172A05",
    "editor.lineHighlightBorder": "#00000000",
    "editorIndentGuide.background1": "#0F172A0B",
    "editorIndentGuide.activeBackground1": "#0F172A1E",
    "editorWhitespace.foreground": "#0A0A0C1A",
    "editorGutter.background": "#FFFFFF",
    "editorGutter.addedBackground": "#58983f",
    "editorGutter.modifiedBackground": "#ac830b",
    "editorGutter.deletedBackground": "#f05151",
    "diffEditor.insertedTextBackground": "#EEF6EBCC",
    "diffEditor.insertedLineBackground": "#EEF6EB99",
    "diffEditor.removedTextBackground": "#FDEEEECC",
    "diffEditor.removedLineBackground": "#FDEEEE99",
    "diffEditor.diagonalFill": "#0A0A0C0A",
    "editorWidget.background": "#FFFFFF",
    "editorWidget.border": "#E8E8EA",
    "editorSuggestWidget.background": "#FFFFFF",
    "editorSuggestWidget.border": "#E8E8EA",
    "editorSuggestWidget.selectedBackground": "#2F75C314",
    "scrollbarSlider.background": "#0A0A0C14",
    "scrollbarSlider.hoverBackground": "#0A0A0C26",
    "scrollbarSlider.activeBackground": "#0A0A0C38"
  }
};

export const ONYX_MONACO_DARK: monaco.editor.IStandaloneThemeData = {
  "base": "vs-dark",
  "inherit": true,
  "rules": [
    {
      "token": "",
      "foreground": "FFFFFF",
      "background": "070708"
    },
    {
      "token": "comment",
      "foreground": "636470",
      "fontStyle": "italic"
    },
    {
      "token": "keyword",
      "foreground": "60A5FA"
    },
    {
      "token": "keyword.control",
      "foreground": "60A5FA"
    },
    {
      "token": "storage",
      "foreground": "60A5FA"
    },
    {
      "token": "string",
      "foreground": "34D399"
    },
    {
      "token": "number",
      "foreground": "FBBF24"
    },
    {
      "token": "constant",
      "foreground": "FBBF24"
    },
    {
      "token": "type",
      "foreground": "38BDF8"
    },
    {
      "token": "type.identifier",
      "foreground": "38BDF8"
    },
    {
      "token": "class",
      "foreground": "38BDF8"
    },
    {
      "token": "interface",
      "foreground": "38BDF8"
    },
    {
      "token": "function",
      "foreground": "C084FC"
    },
    {
      "token": "identifier.function",
      "foreground": "C084FC"
    },
    {
      "token": "variable",
      "foreground": "FFFFFF"
    },
    {
      "token": "operator",
      "foreground": "BCBDC6"
    },
    {
      "token": "delimiter",
      "foreground": "87888F"
    },
    {
      "token": "tag",
      "foreground": "FB7185"
    },
    {
      "token": "attribute.name",
      "foreground": "C084FC"
    },
    {
      "token": "attribute.value",
      "foreground": "34D399"
    },
    {
      "token": "regexp",
      "foreground": "D7BA7D"
    }
  ],
  "colors": {
    "editor.background": "#070708",
    "editor.foreground": "#FFFFFF",
    "editorLineNumber.foreground": "#636470",
    "editorLineNumber.activeForeground": "#BCBDC6",
    "editorCursor.foreground": "#2F71E3",
    "editor.selectionBackground": "#2F71E338",
    "editor.inactiveSelectionBackground": "#2F71E320",
    "editor.lineHighlightBackground": "#FFFFFF08",
    "editor.lineHighlightBorder": "#00000000",
    "editorIndentGuide.background1": "#FFFFFF10",
    "editorIndentGuide.activeBackground1": "#FFFFFF26",
    "editorWhitespace.foreground": "#FFFFFF1A",
    "editorGutter.background": "#070708",
    "editorGutter.addedBackground": "#7aae66",
    "editorGutter.modifiedBackground": "#f3c949",
    "editorGutter.deletedBackground": "#de5555",
    "diffEditor.insertedTextBackground": "#7AAE6624",
    "diffEditor.insertedLineBackground": "#7AAE661C",
    "diffEditor.removedTextBackground": "#DE555526",
    "diffEditor.removedLineBackground": "#DE55551E",
    "diffEditor.diagonalFill": "#FFFFFF0A",
    "editorWidget.background": "#15151A",
    "editorWidget.border": "#27272E",
    "editorSuggestWidget.background": "#15151A",
    "editorSuggestWidget.border": "#27272E",
    "editorSuggestWidget.selectedBackground": "#2F71E32A",
    "scrollbarSlider.background": "#FFFFFF16",
    "scrollbarSlider.hoverBackground": "#FFFFFF28",
    "scrollbarSlider.activeBackground": "#FFFFFF3C"
  }
};

export const ONYX_XTERM_LIGHT: ITheme = {
  "background": "#FFFFFF",
  "foreground": "#24292F",
  "cursor": "#2F75C3",
  "cursorAccent": "#FFFFFF",
  "selectionBackground": "#2F75C31F",
  "selectionForeground": "#24292F",
  "selectionInactiveBackground": "#2F75C310",
  "black": "#3F3F46",
  "red": "#C94A4A",
  "green": "#3D7A47",
  "yellow": "#9A6B16",
  "blue": "#2B6CB0",
  "magenta": "#7C3AED",
  "cyan": "#0E7490",
  "white": "#F4F4F5",
  "brightBlack": "#71717A",
  "brightRed": "#DC5252",
  "brightGreen": "#2F855A",
  "brightYellow": "#B47B14",
  "brightBlue": "#3B82C4",
  "brightMagenta": "#8B5CF6",
  "brightCyan": "#0284C7",
  "brightWhite": "#FFFFFF"
};

export const ONYX_XTERM_DARK: ITheme = {
  "background": "#131317",
  "foreground": "#FFFFFF",
  "cursor": "#2F71E3",
  "cursorAccent": "#131317",
  "selectionBackground": "#2F71E340",
  "selectionForeground": "#FFFFFF",
  "selectionInactiveBackground": "#2F71E324",
  "black": "#18181B",
  "red": "#de5555",
  "green": "#7aae66",
  "yellow": "#f3c949",
  "blue": "#2F71E3",
  "magenta": "#c084fc",
  "cyan": "#38bdf8",
  "white": "#BCBDC6",
  "brightBlack": "#636470",
  "brightRed": "#F87171",
  "brightGreen": "#4ADE80",
  "brightYellow": "#FBBF24",
  "brightBlue": "#6a9fcb",
  "brightMagenta": "#D8B4FE",
  "brightCyan": "#38BDF8",
  "brightWhite": "#FFFFFF"
};
