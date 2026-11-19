# Klot IDE (KE)

Klot IDE（简称 KE）是一款面向 macOS 原生开发场景设计的轻量级桌面集成开发环境，基于 **Tauri v2 (Rust 原生后端) + React + TypeScript + Monaco Editor + xterm.js** 构建，定位为「低噪音、高审美、与本地 Coding CLI 原生共生」的工作台。

## 核心特性

1. **Onyx Light 护眼极简视觉与可拖拽布局**：采用 Onyx Light（及可选 Onyx Dark）视觉主题，温润浅灰外壳（`#F3F4F6`）托起中间纯白代码画布卡（`#FFFFFF`）与右侧纯白本地 CLI 终端卡（`#FFFFFF`），无冗余活动栏与底部状态栏；支持左栏宽度、右侧 CLI 舱宽度以及中间底部运行控制台高度自由拖拽并自动记忆布局。
2. **Git 三视图一等公民工作台**：顶栏 `[ Code | Git ]` 一键切换，在 `Git` 模式下提供 `Changes`（暂存区与提交说明编辑）、`Graph`（多分支分叉合并拓扑树、Ref 标签徽章、提交详情与单文件 Diff）、`Compare`（本地分支 / 远端分支 / 当前工作区自由对比及一键 `Fetch`）三视图，并支持未初始化仓库一键 `git init`。
3. **进程组级项目运行控制台**：自动扫描 `package.json`、`Cargo.toml`、`Makefile` 与 `.ke/tasks.json`，支持在中间画布底部按需展开可拖拽控制台输出流式日志，并通过进程组信号（`killpg`）彻底停止子进程。
4. **右侧 Coding CLI 启动器与多会话 PTY 舱**：默认以零后台进程开销的 `Coding CLI` 启动器首页呈现，按需选择本机 `claude`、`agy`、`pi`、`codex` 或 `zsh` 开启交互式会话；基于 `portable-pty` 与亮色护眼 `xterm.js` 支持多 Tab 切换、`Cmd+L` 选区引用芯片投喂以及终端输出路径点击跳转。
5. **自生长 CLI 插件引擎**：监听 `~/.ke/plugins` 与 `<workspace>/.ke/plugins`，通过 `~/.ke/plugins/SPEC.md` 自举协议支持插件热加载与 `command`、`topbar_status`、`drawer_view` 三种槽位渲染，并附带 `scripts/ke-plugin-tool.mjs` 脚手架与校验工具。

## 设计与契约基准路径

- 设计系统 Token：`./antigravity-design-system/tokens.css` 与 `./antigravity-design-system/tokens.json`
- 生成主题文件：`./src/styles/onyx-generated-themes.ts`（由 `./scripts/generate-onyx-theme.mjs` 生成）
- 视觉定稿基准图：`./design-mockups/01-code-default.jpg`、`./design-mockups/02-git-review.jpg`、`./design-mockups/03-run-console.jpg`、`./design-mockups/04-search-and-settings.jpg`（简称 `./design-mockups/01~04.jpg`）
- 前后端 IPC 契约：`./src/types/ipc.ts` 与 `./src/lib/ipcClient.ts`
- 架构与页面规范：`./RUST-ARCHITECTURE-SPEC.md`、`./IDE-PAGE-DESIGN.md`、`./docs/PLUGIN-GUIDE.md`

## 开发与构建命令

```bash
# 安装前端依赖
npm install

# 根据 tokens.json 重新生成 Monaco 与 xterm 主题配置
npm run theme:generate

# 生成并替换 macOS 超椭圆圆角应用图标（同步输出 src-tauri/icons/ 全套图标）
npm run icon:apply -- /path/to/icon.png

# 仅启动 Vite 前端开发服务（端口 1420，自动启用浏览器降级 Mock）
npm run dev

# 类型检查与前端生产构建
npx tsc --noEmit
npm run build

# 启动完整 Tauri v2 桌面端开发窗口
export PATH="$HOME/.cargo/bin:$PATH"
npm run tauri dev

# 打包独立 macOS Release 应用（产出 src-tauri/target/release/bundle/macos/Klot IDE.app）
export PATH="$HOME/.cargo/bin:$PATH"
npx tauri build --bundles app

# 检查并测试 Rust 后端
export PATH="$HOME/.cargo/bin:$PATH"
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml

# 校验工作区自生长插件规范与零 Emoji 约束
node scripts/ke-plugin-tool.mjs validate

# 通过命令行直接打开指定项目目录（可软链接至 ~/.local/bin/ke）
./scripts/ke .
./scripts/ke /path/to/repo
```

## 工程规范

1. **中文项目文档规范**：仓库内的 `README.md`、`AGENTS.md`、`CLAUDE.md`、`docs/PLUGIN-GUIDE.md` 以及 `~/.ke/plugins/SPEC.md` 统一使用清晰自然的中文编写。
2. **零 Emoji 与特殊符号规范**：仓库中所有文件、文档、注释、UI 文案与代码均严禁包含任何 Emoji 或 Emoji 渲染符号；界面图标一律使用 `lucide-react` 提供的 `1.5px` 单色线性图标。
