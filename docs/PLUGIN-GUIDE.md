# Klot IDE (KE) 自生长插件开发指南

Klot IDE（简称 KE）内置了一套基于进程标准输入输出（`stdin` / `stdout` JSON）的轻量级自生长插件机制。插件无需编译 SDK 或重打包宿主应用，保存后约 50ms 即可自动热加载生效。

你可以直接在 KE 右侧终端舱的 `claude` 或 `codex` 会话中，用自然语言让 AI 为你现场编写、调试并挂载新插件；也可以借助仓库提供的脚手架工具快速创建与校验插件。

---

## 1. 插件目录与热加载机制

KE 在运行期间会同时监听两个插件根目录（`src-tauri/src/plugin_host.rs`）：

| 作用域 | 目录路径 | 适用场景 | 优先级 |
| --- | --- | --- | --- |
| 全局插件（`global`） | `~/.ke/plugins/<plugin-id>/` | 跨项目复用的个人效率工具、环境检测、通用 CLI 指令 | 基础加载 |
| 项目插件（`workspace`） | `<workspace>/.ke/plugins/<plugin-id>/` | 随代码仓库提交、团队共享的构建检查与分析工具 | 同 `id` 时覆盖全局插件 |

说明：
- 宿主启动或切换工作区时，会自动在 `~/.ke/plugins/SPEC.md` 生成并同步最新协议规范，方便右侧 Coding CLI 直接读取。
- 对上述两个目录中任意文件进行新建、修改或删除，后端文件监听器会在约 50ms 防抖后触发 `plugins:updated` 事件，前端顶部栏、命令面板与齿轮菜单会立即刷新。

---

## 2. 右侧 CLI 环境变量注入

在 KE 右侧终端舱启动 `claude`、`codex` 或 `zsh` 会话时（`src-tauri/src/pty_dock.rs`），系统会自动注入以下环境变量，使 CLI 无需询问即可定位插件目录与当前上下文：

| 环境变量 | 含义说明 | 注入范围 |
| --- | --- | --- |
| `KE_PLUGINS_DIR` | 全局插件根目录（默认 `~/.ke/plugins`） | 右侧 CLI 终端、插件运行进程 |
| `KE_WORKSPACE` | 当前打开的工作区根目录绝对路径 | 右侧 CLI 终端、任务运行器、插件运行进程 |
| `KE_ACTIVE_FILE` | 当前编辑器正在聚焦的文件路径（未打开文件时为空字符串） | 右侧 CLI 终端 |

注：插件脚本执行时可通过 `stdin` JSON 的 `workspaceRoot` 与 `activeFile` 字段获取精确的实时上下文（优先读取 `stdin` 字段，再回退 `KE_WORKSPACE`）。

---

## 3. 在右侧 CLI 用自然语言生成插件（实战示例）

在 KE 右侧启动 `claude` 或 `codex` 后，可以直接参考以下自然语言提示词生成并热加载插件。

### 示例 A：生成项目专属 `command` 插件

在右侧 CLI 中输入：

> 请先阅读 `$KE_PLUGINS_DIR/SPEC.md`。然后在 `$KE_WORKSPACE/.ke/plugins/check-rust-fmt/` 下创建一个 Klot IDE 的 `command` 插件：检查当前工作区 Rust 代码格式（`cargo fmt --check`），若存在格式差异则在右侧 CLI 发送修复提示并弹出 `warning` 提示，否则弹出 `success` 提示。完成后运行 `node scripts/ke-plugin-tool.mjs validate` 校验。

CLI 会自动读取协议规范并生成 `plugin.json` 与 `run.mjs`，保存后约 50ms 即可在右上角齿轮菜单或 `Cmd+P` 命令面板中看到并触发该插件。

### 示例 B：生成全局 `topbar_status` 微胶囊插件

在右侧 CLI 中输入：

> 参考 `$KE_PLUGINS_DIR/SPEC.md`，在 `$KE_PLUGINS_DIR/docker-status/` 创建一个全局 `topbar_status` 插件，每 10 秒检查本地 Docker 守护进程是否运行，在顶部栏显示 `"Docker 运行中"`（`tone: "success"`）或 `"Docker 未启动"`（`tone: "neutral"`）。严格禁止使用任何 Emoji。

### 示例 C：生成 `drawer_view` 报告插件

在右侧 CLI 中输入：

> 在 `$KE_WORKSPACE/.ke/plugins/dep-outdated/` 创建一个 `drawer_view` 插件，挂载到齿轮菜单和命令面板，读取 `package.json` 依赖清单并在底部抽屉以 Markdown 表格形式展示当前项目依赖概览。

---

## 4. `plugin.json` 清单规范与三种槽位（Slot）

每个插件目录必须包含 `plugin.json` 与入口脚本（支持 `node`、`python3`、`sh`、`bash` 或可执行文件 `binary`）：

```json
{
  "id": "commit-craft",
  "name": "提交信息生成与审查",
  "version": "0.1.0",
  "description": "读取工作区 git status -s 与 git diff --stat，向右侧 CLI 发送结构化中文代码审查与提交信息生成指令",
  "slot": "command",
  "entry": "run.mjs",
  "runtime": "node",
  "triggers": {
    "menu": "gear",
    "shortcut": "Cmd+Shift+G",
    "palette": true
  }
}
```

### 三种扩展槽位详解

1. `command`（命令动作槽位）
   - 挂载位置：右上角齿轮菜单（`triggers.menu: "gear"`）、`Cmd+P` 命令面板（`triggers.palette: true`）及全局快捷键（`triggers.shortcut`）。
   - 支持额外自动触发器：`onSave: true`（保存文件时触发）、`onGitChange: true`（Git 状态变化时触发）。
   - 返回结构：`{ "actions": [ ... ] }`。

2. `topbar_status`（顶部状态胶囊槽位）
   - 挂载位置：顶部栏右侧运行控制组旁的状态胶囊区域（`TopBar.tsx`），点击胶囊可立即手动刷新。
   - 典型触发器：`triggers: { "intervalMs": 5000 }`（前端按不低于 1000ms 的间隔定时轮询）。
   - 返回结构（直接输出 `TopbarStatusOutput` 对象，或包在 `status` 字段内）：
     ```json
     {
       "label": "端口 3000 监听",
       "tone": "success",
       "tooltip": "常用开发端口监听中: 3000 (node)"
     }
     ```
     其中 `tone` 仅支持 `neutral`、`success`、`warning`、`error`。

3. `drawer_view`（底部抽屉视图槽位）
   - 挂载位置：齿轮菜单与命令面板，执行后自动打开中间主画布底部的控制台抽屉并创建独立标签页。
   - 返回结构：`{ "actions": [ { "type": "render_drawer", ... }, ... ] }`。

---

## 5. 标准输入输出协议（stdin / stdout）

### 5.1 输入上下文（`PluginExecutionContext`）

插件运行时工作目录为插件自身目录（`sourceDir`），`stdin` 传入单行 JSON：

```json
{
  "workspaceRoot": "/Users/name/project",
  "branch": "main",
  "activeFile": "src/main.ts",
  "selection": {
    "startLine": 10,
    "endLine": 25,
    "text": "selected code..."
  },
  "changedFiles": ["src/main.ts"]
}
```

注意：`activeFile` 与 `selection` 可能为 `null`，脚本应做好空值兼容。

### 5.2 输出动作类型（`PluginAction`）

宿主会解析 `stdout` 最后一个非空 JSON 行（或整段 `stdout` JSON），支持以下 6 种原子动作：

| `type` | 必填字段 | 可选字段 | 效果说明 |
| --- | --- | --- | --- |
| `toast` | `tone` (`info`/`success`/`warning`/`error`), `message` | - | 在界面弹出轻量通知 |
| `open_file` | `path` | `line` | 切换到代码模式并打开指定文件及行号 |
| `replace_selection` | `text` | - | 替换当前编辑器选中的文本内容 |
| `run_console` | `text` | `tone` (`info`/`error`) | 向运行控制台追加日志并展开底部抽屉 |
| `send_to_cli` | `prompt` | - | 将结构化指令自动投喂到右侧激活的 CLI 终端会话 |
| `render_drawer` | `title`, `format` (`markdown`/`table`) | `content`, `columns`, `rows` | 在底部抽屉创建或更新插件专属标签页 |

---

## 6. 使用 `ke-plugin-tool.mjs` 脚手架与校验工具

仓库在 `scripts/ke-plugin-tool.mjs` 提供了开箱即用的插件骨架生成器与全自动协议校验器。

### 6.1 一键生成插件骨架

```bash
# 默认生成一个 node 运行时的 command 插件
node scripts/ke-plugin-tool.mjs new my-check

# 生成 topbar_status 状态胶囊插件
node scripts/ke-plugin-tool.mjs new api-health --slot topbar_status --name "接口健康检查"

# 生成 python3 运行时的 drawer_view 报告插件
node scripts/ke-plugin-tool.mjs new py-metrics --slot drawer_view --runtime python3 --name "Python 指标统计"
```

常用参数：
- `--slot <command|topbar_status|drawer_view>`：指定插件槽位（默认 `command`）。
- `--runtime <node|python3|sh|bash>`：指定运行时模板（默认 `node`）。
- `--name <中文显示名>`：设置插件在菜单与面板中的展示名称。
- `--description <中文描述>`：设置插件说明。
- `--workspace <路径>`：指定目标工作区根目录（默认当前目录）。
- `--force`：若目标插件目录已存在则允许覆盖生成。

### 6.2 全自动协议与无 Emoji 校验

```bash
node scripts/ke-plugin-tool.mjs validate
```

`validate` 命令会自动遍历 `.ke/plugins/*` 下全部插件目录并依次检查：
1. `plugin.json` 字段类型、`id` 与目录名一致性、`SemVer` 版本号、`slot`/`runtime`/`triggers` 合法性及入口文件存在性；
2. 静态扫描插件目录下所有文本文件，确保 0 Emoji 与特殊符号字符；
3. 构造模拟 `PluginExecutionContext` 通过 `stdin` 试跑每个入口脚本，校验退出码为 `0`、`stdout` 为合法 JSON、输出结构符合对应槽位协议，且运行时输出同样 0 Emoji；
4. 全部通过返回退出码 `0`，任意插件不合规返回退出码 `1`，适合直接接入本地 pre-commit 或 CI 检查。

---

## 7. 仓库内置自生长插件一览

当前 `.ke/plugins/` 已内置以下 6 个即用插件：

| 插件 ID | 槽位 | 触发方式 | 核心功能 |
| --- | --- | --- | --- |
| `port-radar` | `topbar_status` | 每 5 秒轮询 / 点击刷新 | 调用 `lsof` 检测 `1420`、`3000`、`5173`、`8080` 等常用本地开发端口监听状态 |
| `commit-craft` | `command` | 齿轮菜单 / `Cmd+Shift+G` / 命令面板 | 读取 `git status -s` 与 `git diff --stat`，向右侧 CLI 发送中文审查与提交信息生成指令 |
| `code-hotspot` | `drawer_view` | 齿轮菜单 / 命令面板 | 统计近 30 次 commit 高频修改文件与最大源码文件排行并渲染 Markdown 表格 |
| `env-doctor` | `drawer_view` | 齿轮菜单 / 命令面板 | 检测 `node`、`rustc`、`cargo`、`git`、`claude`、`codex` 等工具链版本及 KE 环境变量 |
| `git-review-to-cli` | `command` | 齿轮菜单 / `Cmd+Shift+G` / 命令面板 | 汇总当前分支 diff 统计并投喂至右侧 CLI 请求代码审查 |
| `todo-audit` | `drawer_view` | 齿轮菜单 / 命令面板 | 扫描工作区源码中的 `TODO` 与 `FIXME` 标记并在底部抽屉展示表格 |

---

## 8. 开发规范与视觉红线

1. **全中文文案**：插件显示名称、描述、抽屉标题、表头和通知提示均应使用清晰自然的中文。
2. **严禁 Emoji 与特殊图形符号**：任何配置文件、脚本源码、注释及 `stdout` 输出不得包含 Emoji 或特殊装饰符，保持与 Onyx Light 极简工作台一致的克制风格。
3. **短时安全执行**：宿主执行插件超时上限为 15 秒，请避免在插件中执行交互式命令或长时间阻塞操作，外部命令建议显式设置 `timeout`。
