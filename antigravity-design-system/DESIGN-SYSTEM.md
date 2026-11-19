# Antigravity — 设计系统逆向报告

应用 **Antigravity 2.32.2**（`com.google.antigravity`，Electron 外壳 + Go language_server 提供 Web UI）。
全部数据来自静态产物与对本地服务的一次性 GET，未启动新实例、未附加调试器、未改动运行中进程。

## 1. 取料路径

| 步骤 | 位置 | 拿到什么 |
| --- | --- | --- |
| 外壳 | `/Applications/Antigravity.app/Contents/Resources/app.asar` | Electron 主进程、窗口、协议、更新 |
| UI 来源 | `bin/language_server` 监听 `127.0.0.1:49165` | 渲染层是 Go 服务下发的 Web 应用 |
| 样式入口 | `GET /index.html` | `/jetbox.css` + `/compiled_tailwind.css` |
| 主题表 | `GET /main.js`（12 MB） | `$6b = new Map([["onyx", {light, dark}]]) `——完整语义色板 |
| 组件层 | `/jetbox.css` | `--sdk-*` 一整套组件 token（间距/圆角/字阶/z-index） |

## 2. 三层结构

```
① Tailwind theme vars      --color-*, --text-*, --radius-*, --ease-*
        ↓ 编译期生成
② App semantic vars        --background / --foreground / --card / --sidebar / --onyx-*
        ↓ 运行时按 light|dark|high-contrast 注入（JS 主题表 "onyx"）
③ Component tokens         --sdk-*（jetbox 组件库）+ --glass-shadow / --card-edge / --peek-*
```

关键点：**语义层不是写在 CSS 里的**。`:root` 中的深色默认值只是首帧兜底，真正的调色板由 `main.js` 里的主题表按模式写入 `document.documentElement`。所以只读 CSS 会拿到过时值——比如 CSS 里 `--warning: #e8975f`，运行时实际是 `#f3c949`。

每个 token 都带**两档**：`[normal, highContrast]`。

## 3. 色板（语义层，onyx 主题）

| token | CSS 变量 | light | dark |
| --- | --- | --- | --- |
| `surface/canvas` | `--background` | #FFFFFF | #070708 |
| `content/primary` | `--foreground` | #0A0A0C | #FFFFFF |
| `accent/default` | `--primary` | #2F75C3 | #2F71E3 |
| `accent/on-accent` | `--primary-foreground` | #FFFFFF | #FFFFFF |
| `surface/muted` | `--secondary` | rgb(10 10 12 / 0.06) | rgb(255 255 255 / 0.075) |
| `content/secondary` | `--secondary-foreground` | #3F3F46 | #BCBDC6 |
| `surface/subtle` | `--muted` | rgb(10 10 12 / 0.038) | rgb(255 255 255 / 0.042) |
| `content/tertiary` | `--muted-foreground` | #71717A | #87888F |
| `content/placeholder` | `--placeholder` | #8E8E95 | #636470 |
| `surface/sidebar` | `--sidebar` | #FAFAFA | #111114 |
| `surface/sidebar-raised` | `--sidebar-secondary` | rgb(10 10 12 / 0.075) | rgb(255 255 255 / 0.09) |
| `surface/sidebar-sunken` | `--sidebar-muted` | rgb(10 10 12 / 0.042) | rgb(255 255 255 / 0.048) |
| `surface/card` | `--card` | #FFFFFF | #131317 |
| `border/card` | `--card-border` | rgb(10 10 12 / 0.07) | rgb(255 255 255 / 0.08) |
| `border/default` | `--border` | rgb(10 10 12 / 0.06) | rgb(255 255 255 / 0.06) |
| `surface/glass` | `--glass` | #FFFFFF | #131317 |
| `border/glass` | `--glass-border` | rgb(10 10 12 / 0.065) | rgb(255 255 255 / 0.085) |
| `border/glass-highlight` | `--glass-highlight` | rgb(255 255 255 / 1) | rgb(255 255 255 / 0.085) |
| `overlay/scrim` | `--scrim` | rgb(10 10 12 / 0.28) | rgb(0 0 0 / 0.64) |
| `surface/shell` | `--shell` | #FAFAFA | #111114 |

状态色与数据可视化色（两套模式不同）：

| status | light | dark |
| --- | --- | --- |
| error | #f05151 | #de5555 |
| warning | #ac830b | #f3c949 |
| link | #3e8ed1 | #6a9fcb |
| success | #58983f | #7aae66 |
| code | #a31515 | #d7ba7d |

| viz | light | dark |
| --- | --- | --- |
| chart 1-6 | #1d4ed8 / #b45309 / #15803d / #7e22ce / #be123c / #0369a1 | #60a5fa / #fbbf24 / #34d399 / #c084fc / #fb7185 / #38bdf8 |

Onyx 深度梯度（独立于主题，硬编码）：

| onyx | light | dark |
| --- | --- | --- |
| frame | #F9F9F9 | #0D0D11 |
| well | rgb(10 10 12 / 0.055) | #111115 |
| raised | #FFFFFF | #15151A |
| selected | #FFFFFF | #1F1F24 |
| key | #FFFFFF | #24252A |

### 透明度策略

边框与次级表面**大量用 alpha 而不是实色**：`--border: rgb(255 255 255 / 0.06)`、`--secondary: rgb(10 10 12 / 0.06)`。这样做换背景色时层级关系自动保持，不需要为每种底色准备一套边框。这是整套系统里最值得抄的一条。

## 4. 字体

- **默认**：Inter
- **可选**：Google Sans Flex（`body[data-agy-font="google-sans"]`）
- **等宽**：`ui-monospace → SF Mono → Menlo → Consolas`

字阶用 `calc(var(--app-font-scale) * Xrem + var(--app-mobile-font-offset))`，支持全局缩放与移动端补偿。行高写成 `calc(1.25 / 0.875)` 这种比值——好处是最终行盒正好落在整数像素：

| 档位 | rem | px | 行高 | 比值 |
| --- | --- | --- | --- | --- |
| xs | 0.6875rem | 11px | 16px | 1.455 |
| sm | 0.75rem | 12px | 16px | 1.333 |
| compact | 0.8125rem | 13px | 20px | 1.538 |
| base | 0.875rem | 14px | 20px | 1.429 |
| lg | 1rem | 16px | 24px | 1.500 |
| xl | 1.125rem | 18px | 28px | 1.556 |
| 2xl | 1.25rem | 20px | 28px | 1.400 |
| 3xl | 1.5rem | 24px | 32px | 1.333 |

字重是**非标准的**：250 / 350 / 450 / 550 / 650 / 850。这不是随意值，是 Google Sans Flex 的光学校正档位；等宽块内退回 300–900 标准档。标题字距收紧 `-0.015em`（h1/h2）、`-0.008em`（h3）。

可变字体轴：`ROND 20`（圆度）、`wdth 92`（正文）/ `100`（标题）、斜体 `slnt -10`。

## 5. 间距 / 圆角 / 阴影 / 动效

- **间距基准 4px**（`--spacing: 0.25rem`），组件层另有一套命名刻度：4 / 6 / 8 / 12 / 16 / 24 / 32
- **圆角**：app 层 2 / 4 / 6 / 8 / 12 / 16；组件层 3 / 4 / 6 / 8 / 10；语义值 card 12、toolbar 8、action button 6
- **阴影**：只有三档真正用得上——glass（浮层）、peek（侧栏滑出）、sdk 的 sm/md
- **动效曲线**：`expo-out (0.16,1,0.3,1)` 用于入场，`cubic-out (0.23,1,0.32,1)` 用于位移，标准曲线 `(0.4,0,0.2,1)`
- **时长**：80ms（分隔条）/ 150ms（通用）/ 160ms（peek 退出）/ 200ms（peek 进入）/ 250ms（慢）
- **z-index**：组件层 1000–1070 连续段，app 层用 10/45 这种小值——两套不冲突，因为组件都活在容器内

## 6. 布局

- 卡片式外壳：`--card-gap: 8px`、`--card-radius: 12px`，`box-shadow` 反向撑出 gap（`0 0 0 calc(gap + radius) var(--shell-canvas)`），避免真的用 margin
- 只有一条响应式媒体查询（`max-width: 639px`），其余靠**容器查询** 600 / 800
- 桌面应用优先，不追求网页级断点体系

## 7. 命名体系与结论

命名是**角色制**而非色相制：`--background` / `--foreground` / `--muted-foreground` / `--card-border`。没有 `--blue-500` 出现在语义层，色相刻度被压在 Tailwind 层（`--color-*`），语义层只谈角色。这正是能换主题的原因。

三层各管一件事：Tailwind 层管**可用刻度**，语义层管**角色与模式**，组件层管**具体部件的尺寸**。抄这套结构，别抄数值。

## 8. 产出

- `tokens.json` — DTCG 形状，含 light/dark、highContrast 两档
- `contrast.json` — 关键前景/背景对的 WCAG 比值
- `palette.html` — 可视化色板 + 字体与刻度样张，可切明暗
