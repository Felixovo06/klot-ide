# Klot IDE (KE) 产品页面设计与视觉规范文档（VS Code 轻改造版 · 默认亮色主题）

> 本文档面向产品确认与高保真界面生图模型（Image Generation Model）设计，基于 `Antigravity 2.32.2 (onyx)` 设计系统提取的实色规范编写，**默认采用 Onyx Light（亮色模式）为主基准**。所有界面模块均严格对齐 `Code - OSS` 原生架构，不引入破坏上游可维护性的结构性魔改。

---

## 一、产品定位与 VS Code 轻改造原则

### 1.1 四大核心工作流闭环
本产品定位为「**低噪音、高审美、CLI 原生共生的轻量版 VS Code**」，只服务高频刚需的四件事：
1. **清晰的多文件翻阅与代码编写**：保留高效目录树、全局搜词、单行 Tab 与原生 Monaco 编辑能力。
2. **一等公民级 Git 变更审查**：通过顶栏 `Code | Git` 切换，把 Git 变更列表与双栏 Diff 提升为主画布主角。
3. **经典项目运行与调试输出**：右上角配备类似 JetBrains / Xcode 的目标运行控制组，按需在编辑区下方弹出运行日志抽屉。
4. **右侧常驻本地 Coding CLI 舱**：在右侧全高保留原生终端体验，无缝运行本地 `claude`、`codex` 等命令行工具，与左侧代码上下文双向打通。

### 1.2 VS Code (`Code - OSS`) 原生模块映射与裁剪清单

| 界面区域 | 对应的 `Code - OSS` 原生模块 | 改造幅度 | 明确保留与裁剪策略 |
| --- | --- | --- | --- |
| 顶部极简栏 | `titlebarPart` | 轻度定制 | 保留窗口控制与 `Cmd+P` 搜索框；新增 `[ Code \| Git ]` 切模式开关、分支胶囊、右上角任务运行控制组 |
| 左侧活动栏 | `activitybarPart` | 直接隐藏 | 彻底移除左侧最老气的 48px 竖排大图标栏，释放横向空间 |
| 左侧边栏 | `sidebarPart` | 轻度样式调整 | `Code` 模式下承载原生 `Explorer` 与 `Search`；`Git` 模式下自动切为原生 `SCM`；默认隐藏 `Outline` 与 `Timeline` 折叠面板 |
| 中间主画布 | `editorPart` (`Monaco` / `DiffEditor`) | 零结构重写 | 沿用原生单行 Tab、面包屑、Monaco 代码编辑器与 Split Diff 编辑器；默认关闭右侧缩略图 `Minimap` 与多余悬浮灯泡 |
| 底部运行抽屉 | `panelPart` | 布局约束 + 默认收起 | 约束在中间主画布下方展开（不挤占左右两栏全高）；默认收起，仅在点击运行或按快捷键时弹出服务/测试输出 |
| 右侧 CLI 舱 | `auxiliaryBarPart` + 原生 `xterm.js` | 轻度封装内置扩展 | 全高常驻，切换 `Code`/`Git` 时不断连；采用与全界面统一的亮色终端配色承载本地 PTY 会话，补充快捷键传入当前文件路径与选中行号 |
| 底部状态栏 | `statusbarPart` | 直接隐藏 | 移除底部整条杂乱状态栏；仅将「当前 Git 分支」收进顶部左侧，其余插件徽章全部清理 |

---

## 二、全局视觉规范（Antigravity Onyx Light 设计系统实色标定）

> 桌面基准画布分辨率：**`1440 x 900 px`**（16:10 无边框 macOS 桌面应用窗口）。以下以 **Light 模式（Onyx Light）** 为默认主基准，并附 Dark 模式作为可选切换对照。

### 2.1 空间层级哲学：浅灰哑光外框 + 纯白双悬浮卡片
为避免亮色界面在普通编辑器里容易显得「平铺一片、缺乏层次」或「黑线边框过重」，本界面采用 **Light Flush Shell + Pure White Dual Floating Cards** 层次：
- **底层外壳与左栏（浅灰哑光底，无卡片框线）**：顶栏（`40px`）与左侧边栏（`240px`）共享连续的柔和浅灰底色 `#FAFAFA`，左侧边栏**不加外框线和圆角大盒子**，靠与纯白卡片的明度差自然分区。
- **双纯白悬浮圆角主卡**：中间主画布卡片（`#FFFFFF`）与右侧本地 CLI 卡片（`#FFFFFF`）以 `8px` 浅灰间隙（`#FAFAFA`）悬浮在外壳之上，均采用 **`12px` 圆角** 和 **`1px solid rgba(10, 10, 12, 0.07)`**（视觉近似 `#E8E8EA`）极细发丝描边。
- **凹槽与激活胶囊对比**：凹槽容器（分段控制底座、过滤输入框、Commit 输入框）使用浅灰凹陷底色 `rgba(10, 10, 12, 0.055)`（近似 `#EFEFF1`）；其中的激活标签或选中行则使用纯白 `#FFFFFF` 浮起胶囊，配合 `1px solid rgba(10, 10, 12, 0.07)` 描边与微弱阴影 `0 1px 2px rgba(10, 10, 12, 0.05)`。

### 2.2 核心色彩 Token 实色表

| 视觉角色 | Token 名称 | Light 模式实色（默认基准） | Dark 模式实色（可选对照） | 用途说明 |
| --- | --- | --- | --- | --- |
| 外壳与顶栏底色 | `surface/shell` | `#FAFAFA` | `#111114` | 窗口背景、顶栏底色、卡片间隙底色 |
| 左侧边栏底色 | `surface/sidebar` | `#FAFAFA` | `#111114` | 左侧文件树 / Git 面板背景 |
| 主代码画布底色 | `surface/canvas` | `#FFFFFF` | `#070708` | 中间主卡片（Monaco 代码区 / Diff 区） |
| 右侧 CLI 卡片底色 | `surface/card` | `#FFFFFF` | `#131317` | 右侧本地 CLI 终端舱卡片（统一亮色） |
| 次级条带底色 | `onyx/frame` | `#F9F9F9` | `#0D0D11` | Run 底部控制台底色、Tab/Diff 头条辅助底色 |
| 凹槽容器底色 | `onyx/well` | `rgba(10, 10, 12, 0.055)` / `#EFEFF1` | `#111115` | 分段切换器底座、搜索框、Commit 框 |
| 浮起控件底色 | `onyx/raised` | `#FFFFFF` | `#15151A` | 工具栏胶囊按钮、弹窗浮层底色 |
| 选中高亮底色 | `onyx/selected` | `#FFFFFF`（带细描边与微阴影） | `#1F1F24` | 选中文件行、激活 Tab、分段控制器激活态 |
| 快捷键徽章底色 | `onyx/key` | `#FFFFFF`（带细描边） | `#24252A` | `Cmd+P`、`Cmd+L` 等键帽底色 |
| 卡片描边 | `border/card` | `rgba(10, 10, 12, 0.07)` / `#E8E8EA` | `rgba(255, 255, 255, 0.08)` | 纯白悬浮卡片 1px 外描边 |
| 内部分割线 | `border/default` | `rgba(10, 10, 12, 0.06)` / `#ECECEE` | `rgba(255, 255, 255, 0.06)` | Tab 栏底线、头部分割线 |
| 主文字色 | `content/primary` | `#0A0A0C` | `#FFFFFF` | 标题、激活文件名、正文代码与终端主字色 |
| 次级文字色 | `content/secondary` | `#3F3F46` | `#BCBDC6` | 未选中文件、常规按钮、终端输出说明字色 |
| 三级辅助文字 | `content/tertiary` | `#71717A` | `#87888F` | 路径面包屑、Git 行统计后缀、时间戳 |
| 占位/行号文字 | `content/placeholder` | `#8E8E95` | `#636470` | 编辑器行号、输入框占位符 |
| 品牌主强调色 | `accent/default` | `#2F75C3` | `#2F71E3` | 主按钮（Commit、运行确认）、聚焦框线 |
| 成功 / 新增态 | `status/success` | `#58983F` | `#7AAE66` | 新增文件 `U`/`A`、CLI 在线绿点、运行通过 |
| 警告 / 修改态 | `status/warning` | `#AC830B` | `#F3C949` | 修改文件 `M`、编译中或运行状态指示 |
| 错误 / 删除态 | `status/error` | `#F05151` | `#DE5555` | 报错行数、Stop 图标、Diff 删除标记 |
| 链接 / 代码锚点 | `status/link` | `#3E8ED1` | `#6A9FCB` | 分支名、CLI 输出中可点击的文件路径 |
| Diff 新增行背景 | 自定义低透明绿 | `rgba(88, 152, 63, 0.09)` / `#EEF6EB` | `rgba(122, 174, 102, 0.11)` | Git Diff 新增代码行底色 |
| Diff 删除行背景 | 自定义低透明红 | `rgba(240, 81, 81, 0.09)` / `#FDEEEE` | `rgba(222, 85, 85, 0.12)` | Git Diff 删除代码行底色 |

### 2.3 排版、圆角与图标克制原则
- **字体系统**：
  - UI 界面字体：`Inter`（macOS 回退 `SF Pro Text`），字重采用轻量光学校正感（正文 `400/450`，标题与选中态 `550/600`），字号严格收束在 **`12px / 16px`**（树节点、按钮、Tab）与 **`13px / 20px`**（主标题、分段控制、输入）。
  - 代码与终端字体：`SF Mono` / `JetBrains Mono` / `ui-monospace`；代码编辑区 **`13px / 21px`**，右侧 CLI 终端 **`12px / 18px`**，行号 `12px` 等宽右对齐。
  - 亮色语法高亮：高对比清晰配色（关键字 `#1D4ED8`、字符串 `#15803D`、函数名 `#7E22CE`、类型 `#0369A1`、数字 `#B45309`、注释 `#8E8E95`）。
- **圆角规范**：主卡片 `12px`、分段控件底座 `8px`、按钮与列表行 `6px`、键帽 `4px`。
- **图标规范**：全程使用 **`1.5px` 单色线性图标**（Lucide / Codicon 线性极简风格）。文件树使用低饱和深灰单色文件轮廓或小圆点标识，**严禁使用彩色卡通文件图标包，严禁使用任何 Emoji**。

---

## 三、全局空间布局尺寸图（1440 x 900 px，Onyx Light）

### 3.1 默认三栏全高布局（适用于「画面 1：Code 态」与「画面 2：Git 审查态」）

```text
+---------------------------------------------------------------------------------------------------+
| Top Bar (H: 40px, Bg: #FAFAFA)                                                                    |
| [o o o] [Sidebar] [kt-payment-core / feat/idempotent-refund v]   [ Code | Git 4 ] [Cmd+P Search]  |
|                                               [Task: dev:server v] [Run] [Console] [CLI Toggle]   |
+-------------------+---------------------------------------------------+---+-----------------------+
| Left Sidebar      | Center Main Canvas Card                           |8px| Right CLI Dock Card   |
| (W: 240px)        | (W: 804px, H: 852px, R: 12px, Bg: #FFFFFF)        |gap| (W: 380px, H: 852px,  |
| Bg: #FAFAFA       | Border: 1px solid rgba(10,10,12,0.07)             |   |  R: 12px, Bg: #FFFFFF)|
| (Flush, no box)   +---------------------------------------------------+   +-----------------------+
|                   | Editor Tabs (H: 36px) / Git Toolbar (H: 36px)     |   | CLI Tabs (H: 36px)    |
| Code mode:        +---------------------------------------------------+   | [claude] [codex] [+]  |
|  [Files | Search] | Breadcrumb (H: 24px)                              |   +-----------------------+
|  [Filter input]   +---------------------------------------------------+   |                       |
|  > src            |                                                   |   | Light-mode xterm PTY  |
|    api/           | Native Monaco Editor (Code mode, #FFFFFF)         |   | (#FFFFFF bg, #0A0A0C) |
|      routes.ts  M |   OR                                              |   | > prompt              |
|    core/          | Native Split Diff Editor (Git mode, #FFFFFF)      |   |   Read file...        |
|      service.ts M |                                                   |   |   Edit file...        |
|      idemp.ts   U | (No Minimap on the right edge)                    |   |   diff summary        |
|  > tests          |                                                   |   |                       |
|                   |                                                   |   +-----------------------+
| Git mode:         |                                                   |   | Context chip:         |
|  [Commit box]     |                                                   |   | @refund.service:18-32 |
|  Changes (4)      |                                                   |   | > _                   |
+-------------------+---------------------------------------------------+---+-----------------------+
| Bottom outer padding: 8px (Bg: #FAFAFA) | Right outer padding: 8px                                |
+---------------------------------------------------------------------------------------------------+
```

### 3.2 Run 运行控制台展开态（适用于「画面 3：项目运行态」）

当用户在右上角触发运行，仅**中间主画布卡**在内部纵向一分为二，左侧文件树与右侧 CLI 舱保持 `852px` 全高不断流：

```text
+-------------------+---------------------------------------------------+---+-----------------------+
| Left Sidebar      | Center Main Canvas Card (W: 804px, H: 852px)      |8px| Right CLI Dock Card   |
| (W: 240px,        | +-----------------------------------------------+ |   | (W: 380px,            |
|  H: 852px)        | | Monaco Editor Area (H: 622px, Bg: #FFFFFF)    | |   |  H: 852px,            |
|  Bg: #FAFAFA      | |   Tabs + Breadcrumb + Code lines              | |   |  Bg: #FFFFFF)         |
|                   | +-----------------------------------------------+ |   |                       |
|                   |   10px gap / 1px rgba(10,10,12,0.07) divider      |   |  (Uninterrupted       |
|                   | +-----------------------------------------------+ |   |   light-mode PTY      |
|                   | | Run Output Console (H: 220px, Bg: #F9F9F9)    | |   |   claude / codex      |
|                   | | [Running: npm run dev]     [Clear] [Hide]     | |   |   terminal session)   |
|                   | | 19:02:11 [vite] server ready in 184 ms        | |   |                       |
|                   | | 19:02:11 [api] listening on 127.0.0.1:3000    | |   |                       |
|                   | +-----------------------------------------------+ |   |                       |
+-------------------+---------------------------------------------------+---+-----------------------+
```

---

## 四、四大区域组件级拆解详述

### 4.1 顶部一体化极简栏（Top Bar，`H: 40px`, `Bg: #FAFAFA`）
- **左区（导航与上下文）**：
  - macOS 原生红黄绿窗口控制点（距左 `14px`）。
  - 左侧栏折叠图标按钮（`28 x 28px`，`1.5px` 线性面板图标，色值 `#3F3F46`）。
  - 仓库与分支融合胶囊（背景 `rgba(10,10,12,0.038)`，边框 `rgba(10,10,12,0.06)`，圆角 `6px`）：显示 `kt-payment-core / feat/idempotent-refund` 加上小向下箭头，分支名用 `#3E8ED1`。
- **中区（模式主导航与快搜）**：
  - **核心模式分段器**：置于 `#EFEFF1`（`rgba(10,10,12,0.055)`）浅灰凹槽内，圆角 `8px`，内含两枚选项：
    - `Code`（`Cmd+1`）：激活时为纯白浮起胶囊 `#FFFFFF`（带 `1px solid rgba(10,10,12,0.07)` 描边和极轻阴影），深黑字 `#0A0A0C`。
    - `Git`（`Cmd+2`）：未激活时文字 `#71717A`，右侧附带克制的变更文件数字角标（如 `4`，文字 `#AC830B`、底色 `rgba(10,10,12,0.06)`）。
  - **全局快速跳转框**：紧邻分段器右侧，宽约 `240px`，高 `28px`，底色 `#FFFFFF` 或 `rgba(10,10,12,0.042)`，边框 `rgba(10,10,12,0.07)`，显示放大镜图标 + `Search files or symbols...` 占位字 `#8E8E95` + 右端纯白 `Cmd+P` 键帽。
- **右区（运行控制组与视图开关）**：
  - **JetBrains / Xcode 风格运行控制组**：
    - 运行目标下拉选择器（`H: 28px`，圆角 `6px`，纯白底 `#FFFFFF`，边框 `rgba(10,10,12,0.08)`）：显示当前选中脚本或服务，如 `dev:server` 或 `test:unit`，带下拉箭头。
    - 执行按钮组：空闲态为一个简洁的三角形 `Play` 运行按钮（深色描边或 `#58983F` 线性填充）；运行态自动变为方形红色 `#F05151` `Stop` 按钮 + 环形 `Restart` 重启按钮。
  - **面板显隐开关**：两个克制的 `28 x 28px` 线性图标按钮——底部输出抽屉开关、右侧 CLI 舱开关。

### 4.2 左侧上下文联动栏（Left Sidebar，`W: 240px`, `Bg: #FAFAFA`）
左栏完全依附 `#FAFAFA` 外壳底色，不设独立外框，顶部与主体用极细 `1px rgba(10,10,12,0.06)` 分隔。
- **在 `Code` 模式下**：
  - 顶部功能切换行：极简双切胶囊 `[ Files | Search ]`（无需额外活动栏即可在目录浏览与全库文本搜索 `Cmd+Shift+F` 间切换），下方带 `28px` 高的路径快速过滤输入框（底色 `#EFEFF1` 或 `#FFFFFF` 凹边）。
  - 文件树主体：行高 `28px`，缩进 `14px/层`，圆角 `6px`。当前打开文件使用纯白 `#FFFFFF` 选区胶囊（带 `1px solid rgba(10,10,12,0.07)` 边框与微阴影），文字 `#0A0A0C` 加重；行尾仅保留单字母 Git 状态标识（`M` 用 `#AC830B`，`U` 用 `#58983F`）。无 `Outline`、无 `Timeline` 折叠栏。
- **在 `Git` 模式下**：
  - 顶部提交区：多行紧凑 Commit 输入框（纯白 `#FFFFFF` 带细边框，高 `56px`，占位字 `Commit message...`）+ 通栏主色 `#2F75C3` `Commit` 按钮（白字 `#FFFFFF`）。
  - 变更列表区：分 `Staged Changes` 与 `Changes` 两组，每行右侧展示简洁的 `+24 -6` 等宽数字及单文件 Stage/Discard 悬浮图标。
  - 底部历史区：可折叠的 `Recent Commits` 列表，显示提交标题、短 Hash（如 `a4f91c2`）与相对时间。

### 4.3 中间主画布卡（Center Main Card，`W: 804px`, `Bg: #FFFFFF`, `R: 12px`）
- **在 `Code` 模式下**：
  - **单行文件 Tab 栏（`H: 36px`）**：背景 `#FFFFFF`（或极浅 `#F9F9F9` 顶条带 `1px solid rgba(10,10,12,0.06)` 底线），激活 Tab 为纯白 `#FFFFFF` 配 `#2F75C3` `1.5px` 底部指示线（或微浅灰底区分未激活 Tab），最多同时呈现 4-6 个核心文件，溢出横向平滑滚动。
  - **细窄面包屑（`H: 24px`）**：显示 `src > core > refund.service.ts > processRefund`，字体 `12px` `#71717A`。
  - **原生 Monaco 代码编辑区**：纯净白纸感画布 `#FFFFFF`；左侧行号列宽 `48px`（字色 `#8E8E95`），紧贴行号右侧有 `2px` 宽的原生 Git Gutter 变更条（绿 `#58983F` / 琥珀 `#AC830B`）；**彻底关闭右侧缩略图（Minimap）**，保留最纯粹的横向阅读呼吸感。
- **在 `Git` 模式下**：
  - **Diff 工具栏（`H: 36px`）**：左侧展示当前审阅文件路径（`src/core/refund.service.ts`）与变更统计（`+22 -6`）；右侧放置 `[ Inline | Split ]` 切换分段器（`#EFEFF1` 底座 + `#FFFFFF` 激活胶囊），以及快捷按钮「跳转到文件编辑」。
  - **原生 Split Diff 对比区**：左右双栏 50%/50% 对分，中间 `1px rgba(10,10,12,0.06)` 分隔线。左侧展示旧版本（删除行带 `#FDEEEE` / `rgba(240,81,81,0.09)` 柔和淡粉底），右侧展示新版本（新增行带 `#EEF6EB` / `rgba(88,152,63,0.09)` 柔和淡绿底），右侧保留完整 Monaco 可编辑性与亮色语法高亮。
- **在 `Run` 控制台展开态下**：
  - 中间主画布卡底部切出 `220px` 高的运行输出区（背景 `#F9F9F9`，上边框 `1px solid rgba(10,10,12,0.07)`）。
  - 顶部 `30px` 工具条：左侧绿点 `#58983F` 状态指示 + `Running: npm run dev` 标签；右侧为 `Clear` 清理、`Maximize` 放大与 `Close` 关闭线性图标。
  - 下方为干净的 `12px` 等宽运行日志流（主字 `#0A0A0C`/`#3F3F46`），高亮关键报错行（`#F05151`）与本地服务端口地址（`#3E8ED1`）。

### 4.4 右侧常驻本地 Coding CLI 舱（Right CLI Dock，`W: 380px`, `Bg: #FFFFFF`, `R: 12px`）
- **视觉统一关键点**：右侧 CLI 舱**必须同为亮色主题**（`#FFFFFF` 纯白卡片底 + `#0A0A0C` / `#3F3F46` 深色等宽字体），绝不在浅色窗口右边硬塞一块刺眼的纯黑终端块。
- **常驻特性**：无论中间在 `Code` 还是 `Git` 模式，右侧 CLI 舱保持固定宽度与会话不断连。
- **顶部终端会话 Tab（`H: 36px`）**：显示多个本地 PTY 会话标签，例如 `claude`（绿点 `#58983F` 活跃态）、`codex`（静默态）、以及右侧 `+` 新建终端按钮，旁边带极简 `PTY` 状态徽章。
- **主体终端流（亮色原生 xterm TUI 质感）**：
  - 严禁使用圆角聊天气泡、AI 头像或花哨卡片堆砌；严格还原高端终端工具的紧凑单色排版。
  - 含 `>` 命令输入回显、结构化工具步骤行（如 `Read  src/core/refund.service.ts`、`Edit  src/core/refund.service.ts (+4 -2)`，文件名呈 `#3E8ED1` 可点击链接）、简洁的亮色终端内嵌 Diff 块，以及总结段落。
- **底部上下文联动输入区**：
  - 选区引用条（按需出现）：展示通过 `Cmd+L` 从左侧代码区注入的上下文芯片（浅蓝灰标签底 + `#3E8ED1` 字色），例如 `@src/core/refund.service.ts#L18-32`，带 `x` 移除按钮。
  - 最底行置于轻微灰底条或极细分隔线下，保持纯正终端输入提示符 `>` 与闪烁光标。

---

## 五、生图模型专用分画面提示词包（默认 Onyx Light 亮色版，直接复制可用）

> 使用建议：先用**画面 1** 生成基准图并确认亮色纸感层级与质感，随后携带画面 1 作为视觉参考（Reference Image）再分别生成**画面 2** 与**画面 3**，可获得最高的三态界面一致性。

---

### 画面 1：Code 编码与浏览默认主界面（亮色基准）

**画面重点说明**：展示日常浏览与手写微调代码的亮色默认态。浅灰 `#FAFAFA` 外壳与左栏托起两张 `#FFFFFF` 纯白圆角卡片；无左侧竖排活动图标栏、无底部状态栏、无代码 Minimap；右侧常驻亮色终端风格的 `claude` 本地 CLI 会话，通过选区引用芯片与代码联动。

#### 中文生图 Prompt
```text
高保真 macOS 桌面软件 UI 设计稿，1440x900 比例，极简现代 AI 原生轻量代码编辑器（基于 VS Code 轻改造），默认亮色模式 Onyx Light 主题，通透干净的日间纸感美学。
顶部一体化 40px 极简标题栏，柔和浅灰背景 #FAFAFA：左上角为 macOS 三色窗口圆点、边栏收起图标和浅灰圆角分支胶囊 "kt-payment-core / feat/idempotent-refund"；正中为 #EFEFF1 浅灰凹槽分段控制器 "[ Code | Git 4 ]"，"Code" 处于纯白 #FFFFFF 浮起激活胶囊态（带细描边和微阴影），紧邻一个圆角搜索框 "Search files or symbols... Cmd+P"；右上角为运行控制组，包含纯白下拉框 "dev:server"、干净的三角形运行按钮，以及面板开关线性图标。
主工作区呈三栏布局，彻底去除最左侧竖排图标栏，彻底去除底部状态栏：
1. 左侧文件树（宽 240px，直接融入 #FAFAFA 浅灰哑光背景，无卡片外框）：顶部有 "[ Files | Search ]" 小切换与过滤输入框，下方是干净的目录树（src/api/refund.routes.ts, src/core/refund.service.ts, src/core/idempotency.ts, tests/refund.test.ts），当前选中文件为纯白 #FFFFFF 圆角高亮胶囊（带 1px 浅灰描边），仅使用单色线性文件图标，行尾有极小的 "M"（#AC830B）或 "U"（#58983F）字母标记。
2. 中间主代码编辑卡片（宽 804px，纯白底色 #FFFFFF，12px 圆角，1px 极细浅灰描边 rgba(10,10,12,0.07)）：顶部 36px 单行文件 Tab 栏（激活 Tab 底部有 #2F75C3 细蓝线）与细窄面包屑；主体为清晰的 TypeScript 代码（SF Mono 字体），高雅清晰的亮色语法高亮（深蓝关键字 #1D4ED8、森绿字符串 #15803D、紫色函数 #7E22CE），行号列 #8E8E95，右侧带 2px 绿黄变更竖线，第 18-32 行有极柔和的淡蓝选中高亮，右侧完全没有代码缩略图 Minimap。
3. 右侧独立悬浮 CLI 终端卡片（宽 380px，同样为亮色纯白底色 #FFFFFF，12px 圆角，与中间卡片保持 8px #FAFAFA 间隙）：顶部会话 Tab "[claude] [codex] [+]"；主体为亮色极客命令行终端输出（深炭黑等宽字体 #0A0A0C，禁止出现黑框终端、禁止出现圆角聊天气泡或头像），包含 Read/Edit 步骤行、#3E8ED1 可点击文件路径与终端段落；底部输入行上方挂着一个浅灰蓝引用芯片 "@refund.service.ts#L18-32"。
整体风格像 Linear Light 与 Apple Xcode 的克制极简日间美学，文字锐利清晰，留白呼吸感强，无任何 Emoji。
```

#### 英文高精度 UI 生图 Prompt
```text
High-craft macOS desktop IDE UI mockup, 1440x900 aspect ratio, ultra-minimalist AI-native lightweight fork of VS Code in bright Onyx Light theme, crisp daylight flat minimalist interface.
Top unified 40px slim titlebar on #FAFAFA matte off-white shell: left side has macOS traffic light window dots, sidebar collapse icon, and a subtle pill "kt-payment-core / feat/idempotent-refund"; center has a recessed #EFEFF1 segmented switcher "[ Code | Git 4 ]" with "Code" active as a crisp #FFFFFF raised white pill with subtle border, next to a search bar pill "Search files or symbols... Cmd+P"; right side has a JetBrains-style run control group with white dropdown "dev:server", crisp play button, and two minimal linear panel toggle icons.
Three-column body with NO left activity icon bar and NO bottom status bar:
1. Left sidebar (240px wide, flush on #FAFAFA matte background, no outer card border): compact "[ Files | Search ]" toggle, filter input, and clean directory tree (src/api/refund.routes.ts, src/core/refund.service.ts, src/core/idempotency.ts, tests/refund.test.ts) with monochrome 1.5px dark gray stroke icons, #FFFFFF white pill highlight for selected file, and subtle single-letter "M" (#AC830B) and "U" (#58983F) git indicators.
2. Center floating code editor card (804px wide, pure #FFFFFF white canvas, 12px rounded corners, 1px rgba(10,10,12,0.07) hairline border): 36px single-row file tabs with #2F75C3 active bottom accent, slim breadcrumb, crisp SF Mono TypeScript code with clean daylight syntax highlighting (cobalt blue keywords, forest green strings, purple functions), #8E8E95 line numbers, thin 2px git gutter bars, soft light-blue selection on lines 18-32, and strictly NO code minimap on the right.
3. Right floating local CLI dock card (380px wide, pure #FFFFFF white card matching light mode, 12px rounded corners, 8px #FAFAFA gap from center card): top session tabs "claude", "codex", and "+"; authentic light-mode monospace TUI terminal stream (#0A0A0C dark ink on white background, NO black terminal box, NO rounded chat bubbles, NO avatars) showing Read/Edit tool output lines and clickable #3E8ED1 file paths; bottom terminal prompt with attached context chip "@refund.service.ts#L18-32".
Linear Light and Notion-inspired clean daylight precision aesthetic, sharp Inter and SF Mono typography, generous whitespace, zero emojis.
```

#### Negative Prompt（负面排除词）
```text
dark mode, black background, dark terminal panel, dark editor, left activity bar icon strip, bottom blue status bar, code minimap, chat bubbles, rounded message cards, AI robot avatar, colorful cartoon file icons, emojis, heavy drop shadows, skewed perspective, laptop mockup frame, blurry text
```

---

### 画面 2：Git 变更审查双栏对比主界面（亮色）

**画面重点说明**：展示顶栏切换到 `Git` 态后，左侧无缝变为亮色变更文件列表与 Commit 提交区，中间变为纯白全宽双栏 Split Diff 编辑器，同时**右侧亮色本地 CLI 终端舱保持原地不动**。

#### 中文生图 Prompt
```text
高保真 macOS 桌面软件 UI 设计稿，1440x900 比例，延续同一套 Onyx Light 默认亮色极简代码编辑器视觉规范，展示顶栏切换到 Git 审查模式后的界面状态。
顶部 40px 浅灰标题栏（#FAFAFA）：中间分段控制器 "[ Code | Git 4 ]" 中右侧 "Git 4" 处于纯白 #FFFFFF 浮起激活态；右上角运行控制组与按钮保持一致。
主工作区三栏布局（无左侧活动图标栏，无底部状态栏）：
1. 左侧 Git 变更边栏（240px，#FAFAFA 无边框背景）：顶部为纯白带细边框的 Commit 输入框与通栏 #2F75C3 蓝色 "Commit" 按钮（白字）；中间分为 "Staged Changes" 与 "Changes (4)" 列表，文件行右侧展示 "+22 -6" 等宽绿红统计数字；底部为紧凑的 "Recent Commits" 历史提交列表（含 7 位短 Hash 与提交摘要）。
2. 中间全宽纯白 Git Diff 审查卡片（804px，#FFFFFF，12px 圆角，1px 浅灰描边）：顶部 36px 工具栏左侧显示当前文件 "src/core/refund.service.ts" 及 "+22 -6"，右侧有 "[ Inline | Split ]" 切换开关（Split 为纯白激活态）与 "Open File" 按钮；主区域为左右 50/50 双栏 Split Diff 对比视图，中间极细浅灰线分割，左侧旧代码删除行带柔和低饱和淡粉红底色 #FDEEEE，右侧新代码新增行带柔和淡绿底色 #EEF6EB，双栏均带清晰行号与亮色代码高亮，无 Minimap。
3. 右侧常驻亮色本地 CLI 终端卡片（380px，#FFFFFF 纯白底色，12px 圆角，8px #FAFAFA 间距）：内容与位置完全保持稳定，展示刚刚完成代码修改的 claude 命令行输出与文件 Diff 汇总行，深炭黑等宽字体，体现一边审阅 Diff 一边随时指挥本地 CLI 的体验。
界面通透锐利，无黑块终端，无任何聊天气泡，无任何 Emoji。
```

#### 英文高精度 UI 生图 Prompt
```text
High-craft macOS desktop IDE UI mockup, 1440x900 aspect ratio, matching the exact Onyx Light daylight minimalist IDE aesthetic, showing the Git Review mode state.
Top 40px slim titlebar (#FAFAFA): center segmented switcher "[ Code | Git 4 ]" now has "Git 4" active as a crisp #FFFFFF raised pill; top-right run control group remains identical.
Three-column workspace (no left activity bar, no bottom status bar):
1. Left Git sidebar (240px wide, flush on #FAFAFA): compact #FFFFFF commit message textarea with subtle border and a solid #2F75C3 blue "Commit" button with white text; "Staged Changes" and "Changes (4)" file lists with crisp monospace "+22 -6" green/red stats; bottom collapsible "Recent Commits" history list with short 7-char hashes.
2. Center floating pure white Split Diff card (804px wide, #FFFFFF, 12px rounded corners, 1px rgba(10,10,12,0.07) border): 36px header showing "src/core/refund.service.ts +22 -6" on the left and "[ Inline | Split ]" toggle with "Split" active on the right; main area renders a clean 50/50 side-by-side Split Diff editor with gentle muted blush red tint #FDEEEE on left deletions and gentle mint green tint #EEF6EB on right additions, clean line numbers and light syntax highlighting, no minimap.
3. Right pinned light-mode local CLI dock card (380px wide, #FFFFFF, 12px rounded corners, 8px #FAFAFA gap): stays intact in place showing claude CLI light-mode terminal tool logs and summary lines, strictly TUI style without chat bubbles or black box.
Ultra-clean Linear Light precision, sharp text, zero emojis.
```

#### Negative Prompt（负面排除词）
```text
dark mode, black background, dark terminal panel, dark editor, left activity bar, bottom status bar, harsh neon red green diff backgrounds, git graph rainbow spaghetti lines, chat bubbles, avatars, emojis, overlapping floating windows, blurry monospace text, perspective tilt
```

---

### 画面 3：Run 项目运行与底部日志展开界面（亮色）

**画面重点说明**：展示点击右上角 Run 后，仅在**中间纯白主卡片内部底部**弹出一个克制的 `220px` 浅灰底色（`#F9F9F9`）运行控制台抽屉，而左侧文件树和右侧亮色 CLI 舱保持全高不打断。

#### 中文生图 Prompt
```text
高保真 macOS 桌面软件 UI 设计稿，1440x900 比例，延续同一套 Onyx Light 默认亮色极简代码编辑器视觉规范，展示项目正在运行并展开底部运行输出抽屉的状态。
顶部 40px 浅灰标题栏（#FAFAFA）：中间分段控制器 "Code" 处于纯白激活态；右上角运行控制组显示当前任务 "dev:server"，运行按钮变为运行中状态——珊瑚红方形停止图标 Stop（#F05151）与环形重启图标 Restart，旁边底部控制台开关图标呈高亮激活态。
主工作区三栏布局：
1. 左侧文件树（240px，全高 852px，#FAFAFA 无边框）：保持完整高度浏览项目文件，不受底部控制台影响。
2. 中间纯白主卡片内部上下分割（总宽 804px，12px 圆角，1px 浅灰描边）：
   - 上半部分（高 622px，#FFFFFF）：保持原生单行 Tab、面包屑与清晰的亮色 TypeScript 代码编辑区，无 Minimap。
   - 下半部分（高 220px，微灰底色 #F9F9F9，顶部以 1px rgba(10,10,12,0.07) 细线与代码区分割）：顶部 30px 控制台头栏左侧带绿色圆点（#58983F）与等宽字样 "Running: npm run dev"，右侧为 Clear 与 Hide 线性小图标；主体展示干净对齐的 12px 等宽服务启动日志与 HTTP 请求记录（深灰字体 #0A0A0C/#3F3F46，如 "[vite] ready in 184 ms"、"listening on http://127.0.0.1:3000"、"POST /v1/refunds 200 14ms"），最后一行有克制的红色报错提示（#F05151）与可点击蓝字文件路径高亮（#3E8ED1）。
3. 右侧亮色本地 CLI 终端卡片（380px，全高 852px，#FFFFFF 纯白底色，12px 圆角）：依然维持完整高度，不被底部日志抽屉横穿压缩，内部显示亮色本地 claude 终端正在待命。
极致干净有序的日间工程师工具美感，无多余装饰与 Emoji。
```

#### 英文高精度 UI 生图 Prompt
```text
High-craft macOS desktop IDE UI mockup, 1440x900 aspect ratio, matching the exact Onyx Light daylight minimalist IDE aesthetic, showing an active project Run state with the bottom output drawer expanded only under the center editor.
Top 40px slim titlebar (#FAFAFA): "Code" active in center switcher; top-right run control group shows task "dev:server" with active red Stop square icon (#F05151) and Restart icon, plus active console toggle icon.
Three-column workspace:
1. Left file tree sidebar (240px wide, full 852px height, flush #FAFAFA): stays full height uninterrupted.
2. Center floating white card (804px wide, 12px rounded corners, 1px rgba(10,10,12,0.07) border) split vertically inside:
   - Top pane (622px high, #FFFFFF): single-row tabs, breadcrumb, crisp daylight TypeScript Monaco code editor without minimap.
   - Bottom Run Output drawer (220px high, #F9F9F9 subtle light-gray surface, separated by crisp 1px rgba(10,10,12,0.07) horizontal divider): 30px header with green dot (#58983F) "Running: npm run dev" on left and Clear/Close icons on right; clean 12px SF Mono logs in #0A0A0C/#3F3F46 ink showing server startup, local URL http://127.0.0.1:3000, request traces, and one highlighted error stack link.
3. Right pinned light-mode local CLI dock card (380px wide, full 852px height, #FFFFFF white surface, 12px rounded corners): remains full height from top to bottom without being cut by the bottom console drawer, showing active light-mode claude PTY terminal.
Precision daylight engineering aesthetic, razor-sharp typography, zero emojis.
```

#### Negative Prompt（负面排除词）
```text
dark mode, black background, dark terminal panel, dark editor, full-width bottom panel spanning across sidebars, multi-tab debug problems output ports clutter, left activity bar, bottom status bar, chat bubbles, minimap, emojis, crowded icons, tilted view
```

---

## 六、视觉验收与反面排查清单（防止生图跑偏）

拿到生图模型结果后，直接对照以下 6 条做快速筛选：
1. **有没有残留老式 VS Code 噪音**：是否错误画出了最左侧一排彩色/大号 Activity Bar 图标，或者底部横跨全屏的蓝/灰 Status Bar？
2. **底部控制台是否“横穿”了全屏**：在画面 3 中，底部日志抽屉只能局限在中间画布下方，不能把右侧本地 CLI 终端压扁成半截。
3. **右侧 CLI 舱有没有被画成黑框或聊天软件**：在默认亮色模式下，右侧 CLI 必须同样是纯白底色 `#FFFFFF` + 深色等宽字体（TUI 质感），既不能突然出现一块刺眼黑框，也不能出现圆角对话气泡和 AI 头像。
4. **编辑器右侧有没有多余缩略图**：主编辑区右侧必须留白干净，不能出现 VS Code 默认的 Minimap。
5. **左栏是否过于沉重**：左栏应融入 `#FAFAFA` 浅灰外壳底色，避免出现「左框 + 中框 + 右框」三个等重粗边框盒子死板并排。
6. **明暗层级与图标是否克制**：亮色层级应为 `#FAFAFA` 柔和浅灰外框托起 `#FFFFFF` 纯白双卡片，全局仅用单色线性图标，无彩色卡通文件图标与 Emoji。
