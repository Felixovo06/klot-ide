# CLAUDE.md - Klot IDE (KE) 项目工作指南

本文件用于在当前工作区中快速对齐 Klot IDE（简称 KE）上下文、架构路径与强制工程约束。

## 核心参考路径

- 工程架构方案：`./RUST-ARCHITECTURE-SPEC.md`
- 页面布局与交互规范：`./IDE-PAGE-DESIGN.md`
- Onyx Light 设计 Token：`./antigravity-design-system/tokens.css` 与 `./antigravity-design-system/tokens.json`
- 编辑器与终端主题导出：`./src/styles/onyx-generated-themes.ts`
- 定稿视觉参考图：`./design-mockups/01~04.jpg`
  - `./design-mockups/01-code-default.jpg`
  - `./design-mockups/02-git-review.jpg`
  - `./design-mockups/03-run-console.jpg`
  - `./design-mockups/04-search-and-settings.jpg`
- 前后端 IPC 契约定义：`./src/types/ipc.ts`
- 前后端 IPC 调用封装（含浏览器 Mock 降级）：`./src/lib/ipcClient.ts`
- 自生长插件目录与规范：`~/.ke/plugins/`、`<workspace>/.ke/plugins/` 与 `~/.ke/plugins/SPEC.md`

## 开发与验证指令

- Rust 工具链位于 `~/.cargo/bin`，执行 Cargo 命令前需确保注入 `export PATH="$HOME/.cargo/bin:$PATH"`。
- 前端类型检查：`npx tsc --noEmit`
- 前端构建验证：`npm run build`
- 主题文件生成：`npm run theme:generate`
- 后端检查与测试：`cargo check --manifest-path src-tauri/Cargo.toml && cargo test --manifest-path src-tauri/Cargo.toml`

## 不可违背的规范

1. **中文项目文档规范**：`README.md`、`AGENTS.md`、`CLAUDE.md` 与 `~/.ke/plugins/SPEC.md` 必须使用清晰自然的中文。
2. **零 Emoji 与特殊图标字符规范**：代码、注释、文档与 UI 文本中绝对禁止出现任何 Emoji 或特殊装饰符号，UI 图标一律采用 `lucide-react` 线性图标。
3. **契约一致性**：所有前后端通道（`invoke`、`Channel`、`listen`）必须严格对齐 `./src/types/ipc.ts` 中的类型与名称定义。
