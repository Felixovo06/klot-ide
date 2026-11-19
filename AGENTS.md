# Klot IDE (KE) 开发协作规范（AGENTS.md）

本文档为 Klot IDE（简称 KE）仓库内所有协同开发代理与工程贡献者的统一约束说明。

## 1. 技术栈与目录职责

- **前端渲染层（`src/`）**：React + TypeScript + Tailwind CSS + Zustand + 原生 `monaco-editor` + 原生 `@xterm/xterm`。
- **原生系统后端（`src-tauri/`）**：Rust + Tauri v2，负责登录 Shell 环境同步、文件树与文件监听、内嵌 `ripgrep` 全库检索、异步 `git` CLI 封装、进程组任务运行器、多会话 PTY 管理、按需本机 LSP 桥接与自生长插件宿主。
- **契约边界（严禁擅自漂移）**：
  - 全部 IPC 命令名、参数字段、返回数据结构与 Tauri Event 名称均以 `./src/types/ipc.ts` 与 `./src/lib/ipcClient.ts` 为唯一真相来源。
  - Rust 侧 `src-tauri/src/` 暴露的 `#[tauri::command]`、`tauri::generate_handler![...]` 与 `app.emit(...)` 必须与前端契约 1:1 严格一致。

## 2. 设计系统与视觉参考

- **Onyx Light Token 基准**：`./antigravity-design-system/tokens.css` 与 `./antigravity-design-system/tokens.json`（保留 `Onyx Light` / `Onyx Dark` 主题命名）。
- **编译生成主题**：执行 `npm run theme:generate` 从 `tokens.json` 生成 `./src/styles/onyx-generated-themes.ts`，向 Monaco Editor 与 xterm.js 提供亮色与暗色主题配置。
- **四态视觉定稿图**：`./design-mockups/01~04.jpg`（`01-code-default.jpg`、`02-git-review.jpg`、`03-run-console.jpg`、`04-search-and-settings.jpg`）。
- **视觉红线**：
  - 禁止出现左侧竖排活动图标栏、底部全宽状态栏、Monaco 右侧 Minimap。
  - 默认亮色模式下，右侧 CLI 终端必须保持纯白 `#FFFFFF` 底色与深色等宽字体，禁止出现黑框终端或圆角聊天气泡。
  - Run 控制台展开时仅在中间主画布下方划出区域，左右两栏保持 `100%` 全高。

## 3. 全局强约束

1. **中文项目文档规范**：仓库内的 `README.md`、`AGENTS.md`、`CLAUDE.md` 以及插件协议模板 `~/.ke/plugins/SPEC.md` 必须全部使用清晰自然的中文编写。
2. **零 Emoji / 特殊图标字符规范**：任何文件、文档、注释、UI 文案和代码中严禁出现任何 Emoji 或特殊符号字符。所有界面图标必须统一使用 `lucide-react` 的 `1.5px` 单色线性图标。
3. **构建与校验要求**：提交或交付前需确保 `npx tsc --noEmit`、`npm run build` 与 `cargo check --manifest-path src-tauri/Cargo.toml`、`cargo test --manifest-path src-tauri/Cargo.toml` 全部 0 报错通过。
