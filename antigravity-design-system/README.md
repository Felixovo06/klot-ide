# Antigravity Design System — 逆向提取包

从本机 **Antigravity 2.32.2**（`com.google.antigravity`）的静态产物中提取的完整设计 token 集。

提取方式为只读：Electron 外壳 asar 解包 + 对本地 language_server（`127.0.0.1:49165`）的只读 GET。
未启动新实例、未附加调试器、未改动运行中进程。

## 包内结构

```
antigravity-design-system/
├── tokens.json            # 权威数据源，DTCG 形状，含 light/dark × normal/highContrast
├── tokens.css             # 由 tokens.json 生成的 CSS 变量（:root + [data-theme] + 高对比）
├── tailwind.config.js     # Tailwind 主题，颜色走 var()，切模式不需要重建
├── contrast.json          # 9 组前景/背景对的 WCAG 比值实测
├── palette.html           # 可视化色板 + 字阶/字重/间距/圆角样张，可切明暗
├── DESIGN-SYSTEM.md       # 完整逆向报告：取料路径、三层结构、命名体系、结论
├── scripts/
│   ├── build.mjs          # theme.json → tokens.json + 报告 + palette.html
│   └── emit.mjs           # tokens.json → tokens.css + tailwind.config.js
└── harvest/               # 原始素材（重新生成所需的全部输入）
    ├── index.html
    ├── jetbox.css         # 组件层 --sdk-* token
    ├── compiled_tailwind.css
    └── theme.json         # 从 main.js 解析出的 onyx 主题表
```

`main.js`（12 MB）未打包，需要时按下方命令重新抓取并解析。

## 直接使用

**纯 CSS**

```html
<link rel="stylesheet" href="tokens.css">
<html data-theme="dark">          <!-- 或去掉，跟随系统 -->
```

**Tailwind**

```js
module.exports = { presets: [require('./tailwind.config.js')] };
```

```html
<div class="bg-surface-canvas text-content-primary border border-border-default rounded-lg">
```

**拿 JSON 自己做**

`tokens.json` 是 DTCG 形状，每个 token 形如：

```json
"canvas": { "$value": "#070708", "highContrast": "#050507" }
```

## 重新生成

```bash
node scripts/build.mjs    # 需要 harvest/theme.json
node scripts/emit.mjs     # 需要 out/tokens.json（build.mjs 产出）
```

`build.mjs` 默认读写 `ui/` 与 `out/`，在本包内运行前把 `harvest/` 放成 `ui/`：

```bash
cp -r harvest ui && mkdir -p out && node scripts/build.mjs && node scripts/emit.mjs
```

## 重新抓取（应用升级后）

```bash
# 1. 找 language_server 的实际端口
lsof -nP -iTCP -sTCP:LISTEN | grep language_

# 2. 取样式与 bundle（只读 GET，与渲染器自身请求同一种）
P=49165
curl -sk "https://127.0.0.1:$P/index.html"  -o ui/index.html
curl -sk "https://127.0.0.1:$P/jetbox.css"  -o ui/jetbox.css
curl -sk "https://127.0.0.1:$P/compiled_tailwind.css" -o ui/compiled_tailwind.css
curl -sk "https://127.0.0.1:$P/main.js"     -o ui/main.js

# 3. 从 main.js 里抠主题表：搜 `$6b=new Map([["onyx"`
#    取到 `]]);` 为止，转成 theme.json（见 DESIGN-SYSTEM.md 第 2 节）
```

## 已知注意点

- **只读 CSS 会拿到过期值。** `:root` 里的 `#101010` 系列只是首帧兜底，真值由 JS 主题表按模式注入。例如 CSS 写 `--warning: #e8975f`，运行时是 `#f3c949`。本包以 JS 主题表为准。
- **暗色 accent 对画布 4.40:1**，正文级 WCAG AA（4.5）差一点，只适合大字号或非文本元素。
- **字重是非标准档位**（250/350/450/550/650/850），对应 Google Sans Flex 的光学校正；用 Inter 或系统字体时不会有完全一致的效果。
- 主题表里每个 token 都存两档 `[normal, highContrast]`，高对比是并列的第二套色值，不是滤镜。

## 来源

- 应用：`/Applications/Antigravity.app` — 2.32.2
- UI：`Contents/Resources/bin/language_server` 下发的 Web 应用
- 主题名：`onyx`
