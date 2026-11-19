// build.mjs — assemble Antigravity design tokens from harvested artifacts
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd(); // run from package root
const OUT = path.join(ROOT, 'out');

const theme = JSON.parse(fs.readFileSync(path.join(ROOT, 'ui', 'theme.json'), 'utf8'));
const onyx = theme.onyx;

// semantic rename: CSS var -> design token path
const SEMANTIC = {
  '--background': 'surface/canvas',
  '--foreground': 'content/primary',
  '--primary': 'accent/default',
  '--primary-foreground': 'accent/on-accent',
  '--secondary': 'surface/muted',
  '--secondary-foreground': 'content/secondary',
  '--muted': 'surface/subtle',
  '--muted-foreground': 'content/tertiary',
  '--placeholder': 'content/placeholder',
  '--sidebar': 'surface/sidebar',
  '--sidebar-secondary': 'surface/sidebar-raised',
  '--sidebar-muted': 'surface/sidebar-sunken',
  '--card': 'surface/card',
  '--card-border': 'border/card',
  '--border': 'border/default',
  '--glass': 'surface/glass',
  '--glass-border': 'border/glass',
  '--glass-highlight': 'border/glass-highlight',
  '--scrim': 'overlay/scrim',
  '--shell': 'surface/shell',
};

// status + viz palettes extracted from main.js (light / dark)
const STATUS = {
  dark:  { error: '#de5555', warning: '#f3c949', link: '#6a9fcb', success: '#7aae66', code: '#d7ba7d' },
  light: { error: '#f05151', warning: '#ac830b', link: '#3e8ed1', success: '#58983f', code: '#a31515' },
};
const CHART = {
  dark:  ['#60a5fa', '#fbbf24', '#34d399', '#c084fc', '#fb7185', '#38bdf8'],
  light: ['#1d4ed8', '#b45309', '#15803d', '#7e22ce', '#be123c', '#0369a1'],
};

// onyx depth ramp (hard-coded in bundle, not theme-derived)
const ONYX = {
  light: { frame: '#F9F9F9', well: 'rgb(10 10 12 / 0.055)', raised: '#FFFFFF', selected: '#FFFFFF', key: '#FFFFFF' },
  dark:  { frame: '#0D0D11', well: '#111115', raised: '#15151A', selected: '#1F1F24', key: '#24252A' },
};

const TYPE = [
  { name: 'xs',      rem: 0.6875, px: 11, lhPx: 16 },
  { name: 'sm',      rem: 0.75,   px: 12, lhPx: 16 },
  { name: 'compact', rem: 0.8125, px: 13, lhPx: 20 },
  { name: 'base',    rem: 0.875,  px: 14, lhPx: 20 },
  { name: 'lg',      rem: 1.0,    px: 16, lhPx: 24 },
  { name: 'xl',      rem: 1.125,  px: 18, lhPx: 28 },
  { name: '2xl',     rem: 1.25,   px: 20, lhPx: 28 },
  { name: '3xl',     rem: 1.5,    px: 24, lhPx: 32 },
];

const SPACE_SDK = { xs: 4, sm: 6, md: 8, lg: 12, xl: 16, '2xl': 24, '3xl': 32 };
const RADIUS = { xs: 2, sm: 4, md: 6, lg: 8, xl: 12, '2xl': 16, full: 9999 };
const RADIUS_SDK = { xs: 3, sm: 4, md: 6, lg: 8, xl: 10, full: 9999 };
const Z_SDK = { base: 1, dropdown: 1000, sticky: 1020, fixed: 1030, 'modal-backdrop': 1040, modal: 1050, popover: 1060, tooltip: 1070 };
const MOTION = {
  ease: {
    expoOut: 'cubic-bezier(0.16, 1, 0.3, 1)',
    cubicOut: 'cubic-bezier(0.23, 1, 0.32, 1)',
    standard: 'cubic-bezier(0.4, 0, 0.2, 1)',
    out: 'cubic-bezier(0, 0, 0.2, 1)',
    in: 'cubic-bezier(0.4, 0, 1, 1)',
  },
  duration: { peekEnter: 200, peekExit: 160, fast: 150, normal: 150, slow: 250, splitter: 80 },
};

// ---------- contrast ----------
const parseColor = (s) => {
  if (!s) return null;
  s = s.trim();
  let m;
  if ((m = s.match(/^#([0-9a-f]{6})$/i))) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  if ((m = s.match(/^#([0-9a-f]{3})$/i))) {
    const [r, g, b] = m[1].split('').map((c) => parseInt(c + c, 16));
    return [r, g, b, 1];
  }
  if ((m = s.match(/^rgba?\(([^)]+)\)$/i))) {
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p[3] ?? 1];
  }
  return null;
};
const lum = ([r, g, b]) => {
  const f = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const over = (fg, bg) => {
  const a = fg[3] ?? 1;
  return [0, 1, 2].map((i) => Math.round(fg[i] * a + bg[i] * (1 - a))).concat(1);
};
const ratio = (fg, bg) => {
  const F = parseColor(fg), B = parseColor(bg);
  if (!F || !B) return null;
  const f = F[3] < 1 ? over(F, B) : F;
  const l1 = lum(f), l2 = lum(B);
  return +(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05))).toFixed(2);
};

// ---------- tokens.json ----------
const tokens = {
  $description: 'Antigravity design system - static harvest from app.asar shell + language_server UI bundle (app 2.32.2)',
  $meta: {
    product: 'Antigravity',
    version: '2.32.2',
    bundleId: 'com.google.antigravity',
    themeName: 'onyx',
    source: ['compiled_tailwind.css', 'jetbox.css', 'main.js (theme map $6b)'],
    layers: ['tailwind-theme-vars', 'app-semantic-vars', 'component-tokens'],
  },
  color: {
    light: {},
    dark: {},
  },
  typography: {
    family: {
      sans: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      sansGoogle: '"Google Sans Flex", "Google Sans", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    },
    weight: {
      hint: 'AXES: sans uses non-standard weights (Google Sans Flex); mono/editor blocks fall back to 300-900',
      light: 250, normal: 350, medium: 450, semibold: 550, bold: 650, black: 850,
      monoLight: 300, monoNormal: 400, monoMedium: 500, monoSemibold: 600, monoBold: 700, monoBlack: 900,
    },
    scale: Object.fromEntries(TYPE.map((t) => [t.name, {
      $value: `${t.px}px`, rem: `${t.rem}rem`, lineHeight: `${t.lhPx}px`,
      lineHeightRatio: +(t.lhPx / t.px).toFixed(4),
    }])),
    tracking: { h1h2: '-0.015em', h3: '-0.008em' },
    features: { googleSansRond: 20, googleSansWidth: 92, headingWidth: 100, boldAxis: 490, italicSlant: -10 },
  },
  space: {
    base: '4px (0.25rem)',
    scale: Object.fromEntries(Object.entries(SPACE_SDK).map(([k, v]) => [k, `${v}px`])),
    layout: { cardGap: '8px', splitCardTop: '40px', peekEnter: '200ms', peekExit: '160ms' },
  },
  radius: {
    app: Object.fromEntries(Object.entries(RADIUS).map(([k, v]) => [k, `${v}px`])),
    sdk: Object.fromEntries(Object.entries(RADIUS_SDK).map(([k, v]) => [k, `${v}px`])),
    semantic: { card: '12px', glass: '12px', toolbar: '8px', sidebar: '8px', actionButton: '6px' },
  },
  shadow: {
    glass: {
      light: '0 12px 32px -12px rgb(16 32 80 / 0.18), 0 2px 6px -2px rgb(16 32 80 / 0.06)',
      dark: '0 16px 40px -12px rgb(0 0 0 / 0.6), 0 2px 8px -2px rgb(0 0 0 / 0.4)',
    },
    peek: {
      light: '8px 0 24px -8px rgb(0 0 0 / 0.16)',
      dark: '8px 0 28px -6px rgb(0 0 0 / 0.55)',
    },
    sdk: {
      xs: '0 1px 2px rgba(0, 0, 0, 0.04)',
      sm: '0 1px 3px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04)',
      md: '0 4px 8px -2px rgba(0, 0, 0, 0.08), 0 2px 4px -2px rgba(0, 0, 0, 0.04)',
      lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.05)',
      xl: '0 20px 25px -5px rgba(0, 0, 0, 0.12), 0 8px 10px -6px rgba(0, 0, 0, 0.05)',
    },
    ring: { light: 'rgb(0 0 0 / 0.10)', dark: 'rgb(255 255 255 / 0.10)' },
  },
  motion: MOTION,
  zIndex: Z_SDK,
  breakpoints: {
    app: { md: '639px (max-width, only responsive query in shell CSS)' },
    container: { hideComments: 600, hidePanels: 800, minViewport: 420 },
  },
  border: { width: '1px', widthThick: '1.5px', hairline: '0.5px' },
};

for (const mode of ['light', 'dark']) {
  const bucket = tokens.color[mode];
  for (const [cssVar, tokenPath] of Object.entries(SEMANTIC)) {
    const entry = onyx[mode][cssVar];
    if (!entry) continue;
    const [group, name] = tokenPath.split('/');
    bucket[group] ||= {};
    bucket[group][name] = { $value: entry.normal, highContrast: entry.highContrast };
  }
  bucket.status = Object.fromEntries(
    Object.entries(STATUS[mode]).map(([k, v]) => [k, { $value: v }])
  );
  bucket.chart = Object.fromEntries(CHART[mode].map((v, i) => [`${i + 1}`, { $value: v }]));
  bucket.onyx = Object.fromEntries(Object.entries(ONYX[mode]).map(([k, v]) => [k, { $value: v }]));
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'tokens.json'), JSON.stringify(tokens, null, 2));

// ---------- contrast pairs ----------
const pairs = [
  ['content/primary', 'surface/canvas'],
  ['content/primary', 'surface/card'],
  ['content/secondary', 'surface/canvas'],
  ['content/tertiary', 'surface/canvas'],
  ['content/placeholder', 'surface/canvas'],
  ['accent/default', 'surface/canvas'],
  ['accent/on-accent', 'accent/default'],
  ['content/primary', 'surface/sidebar'],
  ['content/primary', 'surface/shell'],
];
const contrast = {};
for (const mode of ['light', 'dark']) {
  contrast[mode] = {};
  for (const [fgPath, bgPath] of pairs) {
    const [fgGroup, fgName] = fgPath.split('/');
    const [bgGroup, bgName] = bgPath.split('/');
    const fg = tokens.color[mode][fgGroup]?.[fgName]?.$value;
    const bg = tokens.color[mode][bgGroup]?.[bgName]?.$value;
    contrast[mode][`${fgPath} on ${bgPath}`] = { fg, bg, ratio: ratio(fg, bg) };
  }
}
fs.writeFileSync(path.join(OUT, 'contrast.json'), JSON.stringify(contrast, null, 2));

// ---------- markdown ----------
const tbl = (rows, head) =>
  [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');

const semRows = [];
for (const [cssVar, tokenPath] of Object.entries(SEMANTIC)) {
  const l = onyx.light[cssVar], d = onyx.dark[cssVar];
  if (!l || !d) continue;
  semRows.push([`\`${tokenPath}\``, `\`${cssVar}\``, l.normal, d.normal]);
}

const md = `# Antigravity — 设计系统逆向报告

应用 **Antigravity 2.32.2**（\`com.google.antigravity\`，Electron 外壳 + Go language_server 提供 Web UI）。
全部数据来自静态产物与对本地服务的一次性 GET，未启动新实例、未附加调试器、未改动运行中进程。

## 1. 取料路径

| 步骤 | 位置 | 拿到什么 |
| --- | --- | --- |
| 外壳 | \`/Applications/Antigravity.app/Contents/Resources/app.asar\` | Electron 主进程、窗口、协议、更新 |
| UI 来源 | \`bin/language_server\` 监听 \`127.0.0.1:49165\` | 渲染层是 Go 服务下发的 Web 应用 |
| 样式入口 | \`GET /index.html\` | \`/jetbox.css\` + \`/compiled_tailwind.css\` |
| 主题表 | \`GET /main.js\`（12 MB） | \`$6b = new Map([["onyx", {light, dark}]]) \`——完整语义色板 |
| 组件层 | \`/jetbox.css\` | \`--sdk-*\` 一整套组件 token（间距/圆角/字阶/z-index） |

## 2. 三层结构

\`\`\`
① Tailwind theme vars      --color-*, --text-*, --radius-*, --ease-*
        ↓ 编译期生成
② App semantic vars        --background / --foreground / --card / --sidebar / --onyx-*
        ↓ 运行时按 light|dark|high-contrast 注入（JS 主题表 "onyx"）
③ Component tokens         --sdk-*（jetbox 组件库）+ --glass-shadow / --card-edge / --peek-*
\`\`\`

关键点：**语义层不是写在 CSS 里的**。\`:root\` 中的深色默认值只是首帧兜底，真正的调色板由 \`main.js\` 里的主题表按模式写入 \`document.documentElement\`。所以只读 CSS 会拿到过时值——比如 CSS 里 \`--warning: #e8975f\`，运行时实际是 \`#f3c949\`。

每个 token 都带**两档**：\`[normal, highContrast]\`。

## 3. 色板（语义层，onyx 主题）

${tbl(semRows, ['token', 'CSS 变量', 'light', 'dark'])}

状态色与数据可视化色（两套模式不同）：

${tbl([
  ['error', STATUS.light.error, STATUS.dark.error],
  ['warning', STATUS.light.warning, STATUS.dark.warning],
  ['link', STATUS.light.link, STATUS.dark.link],
  ['success', STATUS.light.success, STATUS.dark.success],
  ['code', STATUS.light.code, STATUS.dark.code],
], ['status', 'light', 'dark'])}

${tbl([
  ['chart 1-6', CHART.light.join(' / '), CHART.dark.join(' / ')],
], ['viz', 'light', 'dark'])}

Onyx 深度梯度（独立于主题，硬编码）：

${tbl([
  ['frame', ONYX.light.frame, ONYX.dark.frame],
  ['well', ONYX.light.well, ONYX.dark.well],
  ['raised', ONYX.light.raised, ONYX.dark.raised],
  ['selected', ONYX.light.selected, ONYX.dark.selected],
  ['key', ONYX.light.key, ONYX.dark.key],
], ['onyx', 'light', 'dark'])}

### 透明度策略

边框与次级表面**大量用 alpha 而不是实色**：\`--border: rgb(255 255 255 / 0.06)\`、\`--secondary: rgb(10 10 12 / 0.06)\`。这样做换背景色时层级关系自动保持，不需要为每种底色准备一套边框。这是整套系统里最值得抄的一条。

## 4. 字体

- **默认**：Inter
- **可选**：Google Sans Flex（\`body[data-agy-font="google-sans"]\`）
- **等宽**：\`ui-monospace → SF Mono → Menlo → Consolas\`

字阶用 \`calc(var(--app-font-scale) * Xrem + var(--app-mobile-font-offset))\`，支持全局缩放与移动端补偿。行高写成 \`calc(1.25 / 0.875)\` 这种比值——好处是最终行盒正好落在整数像素：

${tbl(TYPE.map((t) => [t.name, `${t.rem}rem`, `${t.px}px`, `${t.lhPx}px`, (t.lhPx / t.px).toFixed(3)]), ['档位', 'rem', 'px', '行高', '比值'])}

字重是**非标准的**：250 / 350 / 450 / 550 / 650 / 850。这不是随意值，是 Google Sans Flex 的光学校正档位；等宽块内退回 300–900 标准档。标题字距收紧 \`-0.015em\`（h1/h2）、\`-0.008em\`（h3）。

可变字体轴：\`ROND 20\`（圆度）、\`wdth 92\`（正文）/ \`100\`（标题）、斜体 \`slnt -10\`。

## 5. 间距 / 圆角 / 阴影 / 动效

- **间距基准 4px**（\`--spacing: 0.25rem\`），组件层另有一套命名刻度：4 / 6 / 8 / 12 / 16 / 24 / 32
- **圆角**：app 层 2 / 4 / 6 / 8 / 12 / 16；组件层 3 / 4 / 6 / 8 / 10；语义值 card 12、toolbar 8、action button 6
- **阴影**：只有三档真正用得上——glass（浮层）、peek（侧栏滑出）、sdk 的 sm/md
- **动效曲线**：\`expo-out (0.16,1,0.3,1)\` 用于入场，\`cubic-out (0.23,1,0.32,1)\` 用于位移，标准曲线 \`(0.4,0,0.2,1)\`
- **时长**：80ms（分隔条）/ 150ms（通用）/ 160ms（peek 退出）/ 200ms（peek 进入）/ 250ms（慢）
- **z-index**：组件层 1000–1070 连续段，app 层用 10/45 这种小值——两套不冲突，因为组件都活在容器内

## 6. 布局

- 卡片式外壳：\`--card-gap: 8px\`、\`--card-radius: 12px\`，\`box-shadow\` 反向撑出 gap（\`0 0 0 calc(gap + radius) var(--shell-canvas)\`），避免真的用 margin
- 只有一条响应式媒体查询（\`max-width: 639px\`），其余靠**容器查询** 600 / 800
- 桌面应用优先，不追求网页级断点体系

## 7. 命名体系与结论

命名是**角色制**而非色相制：\`--background\` / \`--foreground\` / \`--muted-foreground\` / \`--card-border\`。没有 \`--blue-500\` 出现在语义层，色相刻度被压在 Tailwind 层（\`--color-*\`），语义层只谈角色。这正是能换主题的原因。

三层各管一件事：Tailwind 层管**可用刻度**，语义层管**角色与模式**，组件层管**具体部件的尺寸**。抄这套结构，别抄数值。

## 8. 产出

- \`tokens.json\` — DTCG 形状，含 light/dark、highContrast 两档
- \`contrast.json\` — 关键前景/背景对的 WCAG 比值
- \`palette.html\` — 可视化色板 + 字体与刻度样张，可切明暗
`;

fs.writeFileSync(path.join(OUT, 'DESIGN-SYSTEM.md'), md);

// ---------- palette.html ----------
const chip = (name, value, note = '') =>
  `<div class="chip"><div class="sw" style="background:${value}"></div>
   <div class="meta"><b>${name}</b><span>${value}</span>${note ? `<i>${note}</i>` : ''}</div></div>`;

const modeBlock = (mode) => {
  const c = tokens.color[mode];
  const sec = (title, obj) => `
    <h3>${title}</h3>
    <div class="grid">${Object.entries(obj).map(([k, v]) =>
      chip(k, v.$value, v.highContrast ? `HC ${v.highContrast}` : '')).join('')}</div>`;
  return `
  <section class="mode ${mode}" data-mode="${mode}">
    <h2>${mode}</h2>
    ${sec('surface', c.surface || {})}
    ${sec('content', c.content || {})}
    ${sec('border', c.border || {})}
    ${sec('accent', c.accent || {})}
    ${sec('status', c.status || {})}
    ${sec('chart', c.chart || {})}
    ${sec('onyx', c.onyx || {})}
  </section>`;
};

const html = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8">
<title>Antigravity · Design Tokens</title>
<style>
  :root { --bg:#111114; --fg:#ffffff; --muted:#87888f; --line:rgba(255,255,255,.08); }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg);
    font-family:"Inter",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    font-size:14px; line-height:20px; padding:40px 32px 80px; }
  header { max-width:1080px; margin:0 auto 40px; }
  h1 { font-size:24px; line-height:32px; letter-spacing:-.015em; margin:0 0 8px; font-weight:650; }
  .sub { color:var(--muted); font-size:12px; }
  .toolbar { display:flex; gap:8px; margin-top:20px; }
  button { font:inherit; font-size:12px; padding:6px 12px; border-radius:6px; cursor:pointer;
    border:1px solid var(--line); background:transparent; color:inherit; }
  button.on { background:#2f71e3; border-color:#2f71e3; color:#fff; }
  main { max-width:1080px; margin:0 auto; }
  section.mode { display:none; }
  section.mode.show { display:block; }
  h2 { font-size:18px; line-height:28px; margin:32px 0 12px; font-weight:550; text-transform:capitalize; }
  h3 { font-size:12px; line-height:16px; letter-spacing:.02em; text-transform:uppercase;
       color:var(--muted); margin:24px 0 8px; font-weight:550; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:8px; }
  .chip { display:flex; gap:10px; align-items:center; padding:8px; border-radius:8px;
    border:1px solid var(--line); background:rgba(255,255,255,.02); }
  .sw { width:36px; height:36px; border-radius:6px; flex:none; box-shadow:inset 0 0 0 1px rgba(255,255,255,.12); }
  .meta { display:flex; flex-direction:column; min-width:0; }
  .meta b { font-weight:550; font-size:12px; }
  .meta span { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:11px;
    color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .meta i { font-style:normal; font-size:10px; color:var(--muted); opacity:.7; }
  .type-row { display:flex; align-items:baseline; gap:16px; padding:6px 0; border-bottom:1px solid var(--line); }
  .type-row .tag { width:80px; font-size:11px; color:var(--muted);
    font-family:ui-monospace,Menlo,monospace; flex:none; }
  .bar { height:12px; border-radius:3px; background:#2f71e3; display:inline-block; vertical-align:middle; }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  td,th { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); }
  th { color:var(--muted); font-weight:550; }
  code { font-family:ui-monospace,Menlo,monospace; font-size:11px; color:#9cb8e0; }
</style></head>
<body>
<header>
  <h1>Antigravity 2.32.2 — 设计系统</h1>
  <div class="sub">静态提取自 app.asar 外壳与 language_server Web bundle · 主题 onyx · 每个 token 含 normal / high-contrast 两档</div>
  <div class="toolbar">
    <button id="t-dark" class="on">dark</button>
    <button id="t-light">light</button>
  </div>
</header>
<main>
  ${modeBlock('light')}
  ${modeBlock('dark')}

  <section class="mode show" data-mode="all">
    <h2 style="margin-top:48px">type scale</h2>
    ${TYPE.map((t) => `<div class="type-row"><span class="tag">${t.name} · ${t.px}px/${t.lhPx}px</span>
      <span style="font-size:${t.px}px;line-height:${t.lhPx}px;font-weight:350">The quick brown fox 中文排版</span></div>`).join('')}
    <h3 style="margin-top:32px">weights</h3>
    <div class="grid">
      ${[['light',250],['normal',350],['medium',450],['semibold',550],['bold',650],['black',850]].map(([n,w]) =>
        `<div class="chip"><div class="meta"><b style="font-weight:${w};font-size:${w > 500 ? 16 : 14}px">${n}</b>
         <span>weight ${w}</span></div></div>`).join('')}
    </div>
    <h3 style="margin-top:32px">spacing</h3>
    <div class="grid">
      ${Object.entries(SPACE_SDK).map(([k, v]) =>
        `<div class="chip"><span class="bar" style="width:${v}px"></span>
         <div class="meta"><b>${k}</b><span>${v}px</span></div></div>`).join('')}
    </div>
    <h3 style="margin-top:32px">radius</h3>
    <div class="grid">
      ${Object.entries(RADIUS).map(([k, v]) =>
        `<div class="chip"><span style="width:36px;height:36px;background:#2f71e3;border-radius:${Math.min(v,18)}px;flex:none"></span>
         <div class="meta"><b>${k}</b><span>${v}px</span></div></div>`).join('')}
    </div>
    <h3 style="margin-top:32px">contrast</h3>
    <table><tr><th>pair</th><th>light</th><th>dark</th></tr>
      ${Object.keys(contrast.light).map((k) => `<tr><td><code>${k}</code></td>
        <td>${contrast.light[k].ratio ?? '—'}</td><td>${contrast.dark[k].ratio ?? '—'}</td></tr>`).join('')}
    </table>
  </section>
</main>
<script>
  const set = (m) => {
    document.querySelectorAll('section.mode').forEach((s) => {
      s.classList.toggle('show', s.dataset.mode === m || s.dataset.mode === 'all');
    });
    document.documentElement.style.setProperty('--bg', m === 'light' ? '#fff' : '#111114');
    document.documentElement.style.setProperty('--fg', m === 'light' ? '#0a0a0c' : '#fff');
    document.documentElement.style.setProperty('--muted', m === 'light' ? '#71717a' : '#87888f');
    document.documentElement.style.setProperty('--line', m === 'light' ? 'rgba(10,10,12,.09)' : 'rgba(255,255,255,.08)');
    for (const id of ['dark', 'light']) document.getElementById('t-' + id).classList.toggle('on', id === m);
  };
  document.getElementById('t-dark').onclick = () => set('dark');
  document.getElementById('t-light').onclick = () => set('light');
  set('dark');
</script>
</body></html>`;

fs.writeFileSync(path.join(OUT, 'palette.html'), html);

console.log('wrote:', fs.readdirSync(OUT).join(', '));
console.log('semantic tokens:', semRows.length, '| type steps:', TYPE.length);
console.log('contrast dark primary:', contrast.dark['content/primary on surface/canvas'].ratio);
console.log('contrast light primary:', contrast.light['content/primary on surface/canvas'].ratio);
