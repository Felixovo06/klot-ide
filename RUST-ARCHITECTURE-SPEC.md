# Klot IDE (KE) 工程架构方案（Rust / Tauri v2 + Monaco + 自生长 CLI 插件）

> 本方案基于全本机 macOS 开发、无第三方旧插件包袱、通过右侧 Coding CLI 自写扩展的定位拍板定型。采用 **`Tauri v2 (Rust 原生后端)` + `React / TypeScript` + `真 Monaco Editor` + `真 xterm.js`**，以约 `10MB` 原生桌面包实现定稿 4 张 Onyx Light 界面的像素级还原与亚秒级冷启动。

---

## 一、架构拍板与核心设计哲学

### 1.1 视觉定稿基准（North-Star Mockups）

四张定稿原图已归档至工作区 `./design-mockups/`：

| 画面序号 | 对应状态 | 归档文件路径 | 核心视觉与交互特征 |
| --- | --- | --- | --- |
| 01 | 默认 Code 编码与浏览态 | `./design-mockups/01-code-default.jpg` | `#FAFAFA` 浅灰外壳 + 中间纯白代码卡 `#FFFFFF` + 右侧亮色 CLI 终端卡 `#FFFFFF` |
| 02 | Git 变更审查双栏对比态 | `./design-mockups/02-git-review.jpg` | 左栏切换 SCM 列表与 Commit 区，中栏切为 Split Diff，右栏 CLI 原地常驻 |
| 03 | Run 运行控制台局部展开态 | `./design-mockups/03-run-console.jpg` | 中间主画布下方局部弹出控制台，左树与右 CLI 保持 `100%` 全高 |
| 04 | Search 全局搜索与设置菜单态 | `./design-mockups/04-search-and-settings.jpg` | 左栏切为全库搜索，右上角常驻齿轮菜单收纳设置与插件管理入口 |

### 1.2 为什么选 Tauri v2 (Rust) + Monaco 而不是重改 Code - OSS

| 对比维度 | Code - OSS (Electron 二改) | Fork Zed (Rust + GPUI) | Tauri v2 (Rust) + 真 Monaco + xterm |
| --- | --- | --- | --- |
| 历史包袱与改造难度 | 200 万行旧 Workbench，合并上游易冲突 | 自研 GPUI 语料少，UI 微调与编译较重 | 全新干净骨架，前端直接写 React + CSS，极适合 AI 高频迭代 |
| 视觉还原度（4 张定稿图） | 受限于 `SplitView` 与内部菜单约束 | 难精确套用给定 Tailwind / CSS Token | 直接引入 `./antigravity-design-system/tokens.css` 像素级还原 |
| 编辑器与 Diff 手感 | 原生 Monaco | 自研 GPUI Editor | 直接嵌入微软原版 **Monaco Editor & DiffEditor**，非自绘玩具 |
| 启动速度与安装包体积 | 约 300MB+，冷启动 2-4 秒 | 约 80MB，极快 | 约 10MB `.app`，冷启动 300ms 内，内存占 Electron 的 1/4 |
| 扩展方式 | 需兼容数万旧 `.vsix` 扩展 | 需用 Rust/WASM 写扩展 | **CLI 自生长扩展**：在右侧 `claude`/`codex` 一句话生成脚本即热加载 |
| 开源协议 | MIT | 客户端 GPLv3（有传染约束） | MIT / Apache-2.0（完全可控） |

### 1.3 `~/workspace/klot-ide` 工程目录规划

```text
~/workspace/klot-ide/
├── antigravity-design-system/      # 已解压：tokens.css / tokens.json / tailwind.config.js
├── design-mockups/                 # 已归档：01~04 四态视觉定稿图
├── IDE-PAGE-DESIGN.md              # 页面尺寸、Token 与交互规范
├── RUST-ARCHITECTURE-SPEC.md       # 本文档工作区副本
├── package.json                    # Vite + React + Monaco + xterm 前端工程配置
├── index.html
├── src/                            # 前端渲染层（严格遵循 Onyx Light Token）
│   ├── main.tsx
│   ├── styles/
│   │   ├── onyx-theme.css          # 直接桥接 ../antigravity-design-system/tokens.css
│   │   └── monaco-themes.ts        # 由 tokens.json 编译出的 Monaco Light/Dark 主题
│   ├── stores/
│   │   ├── workspaceStore.ts       # 当前项目路径、mode(code|git)、文件树、打开 Tab
│   │   ├── gitStore.ts             # 分支、Staged/Changes、Commit 历史、Inline/Split 状态
│   │   ├── runStore.ts             # 可运行任务列表、当前运行进程状态、底部控制台日志流
│   │   ├── cliStore.ts             # 多 PTY 会话 Tab、选区引用芯片、输入草稿
│   │   └── pluginStore.ts          # 热加载的自生长插件注册表（命令/状态胶囊/抽屉视图）
│   └── components/
│       ├── TopBar.tsx              # 40px 沉浸顶栏：分支胶囊 / Code|Git / Search / Run / 齿轮
│       ├── LeftSidebar.tsx         # 240px 无框左栏：Code(Files|Search) 与 Git(Commit|Changes)
│       ├── CenterCanvas.tsx        # 悬浮纯白主卡：Monaco Editor / Split Diff / 底部 RunDrawer
│       ├── RightCliDock.tsx        # 380px 悬浮纯白 CLI 卡：PTY Tab + xterm + 底部复合输入栏
│       ├── QuickOpenModal.tsx      # Cmd+P 毛玻璃全局文件与符号跳转面板
│       └── SettingsMenu.tsx        # 右上角齿轮下拉菜单（主题/快捷键/插件管理）
└── src-tauri/                      # Rust 原生系统引擎
    ├── Cargo.toml
    ├── tauri.conf.json             # macOS Overlay 无边框顶栏与安全权限配置
    └── src/
        ├── main.rs / lib.rs        # Tauri App 装配、状态注入与事件广播总线
        ├── env_path.rs             # 登录 Shell 环境变量同步（修复 Finder 启动 PATH 缺失）
        ├── fs_tree.rs              # ignore 高速目录树 + notify 防抖监听（CLI 改码实时联动）
        ├── search.rs               # 内嵌 ripgrep (grep-searcher) 毫秒级全库搜索与替换
        ├── git_ops.rs              # 异步本机 git CLI 封装（完整兼容本机 SSH/GPG/Hooks）
        ├── task_runner.rs          # 项目脚本扫描 + 独立进程组管理（彻底杀干净子进程）
        ├── pty_dock.rs             # portable-pty 多会话管理 + Tauri Channel 字节流直推
        ├── lsp_bridge.rs           # 按需本机 LSP 进程桥（tsserver / rust-analyzer / pyright）
        └── plugin_host.rs          # ~/.ke/plugins 与 .ke/plugins 热加载与 JSON 协议执行器
```

---

## 二、Rust 后端七大核心模块与 Crate 选型（`src-tauri`）

### 2.1 核心 `Cargo.toml` 依赖清单

| Crate | 推荐版本 | 职责说明 |
| --- | --- | --- |
| `tauri` | `2.x` | 桌面窗口宿主持久化、IPC 命令、高频 `tauri::ipc::Channel` 流式传输 |
| `tokio` | `1.x` (`full`) | 异步 I/O 调度、子进程流式读取、LSP 与 PTY 并发 |
| `portable-pty` | `0.8` | 跨平台伪终端分配，无缝运行 `zsh`、`claude`、`codex` 交互式 TUI |
| `notify` + `notify-debouncer-mini` | `6.x` / `0.4` | 毫秒级监听工作区代码改动与 `~/.ke/plugins` 插件热更新 |
| `ignore` | `0.4` | `ripgrep` 同源目录遍历器，天然遵循 `.gitignore` 跳过 `node_modules`/`target` |
| `grep-searcher` + `grep-regex` | `0.1` | 编进二进制的原生 `ripgrep` 搜索引擎，支撑左栏 `Search` 瞬时出结果 |
| `nix` | `0.29` (`signal`, `process`) | 控制 Unix 进程组（`killpg` / 负 PID 信号），保证 `Stop` 彻底清理 dev server 子树 |
| `serde` + `serde_json` | `1.x` | IPC DTO、插件协议 JSON 与 LSP JSON-RPC 编解码 |

### 2.2 关键系统模块设计与 macOS 必避坑点

#### 1. `env_path.rs`：解决 macOS 双击启动找不到 `claude` / `node` / `cargo`
- **macOS 经典坑点**：从 Xcode/Finder 双击启动 `.app` 时，系统只给极简 `PATH`（`/usr/bin:/bin:/usr/sbin:/sbin`），导致找不到 `/opt/homebrew/bin`、`~/.nvm`、`~/.cargo/bin` 里的 `claude`、`codex`、`git` 或 `node`。
- **解法**：应用启动初始化阶段执行一次 `/bin/zsh -lic 'env -0'`（超时保护 `2000ms`），解析出用户完整的 `PATH`、代理配置与 API Key 环境变量并缓存在 `AppEnv` 状态中，后续所有 `pty_dock`、`git_ops`、`task_runner` 与 `lsp_bridge` 子进程全部继承该环境。

#### 2. `fs_tree.rs`：高速目录树与「CLI 改码秒级联动」
- **目录扫描**：使用 `ignore::WalkBuilder::new(&workspace_root)` 构建树结构，自动过滤 `.git`、`node_modules`、`dist`、`target`，万级文件项目首扫在 `30ms` 内完成。
- **实时联动**：`notify-debouncer-mini` 以 `120ms` 防抖窗口监听工作区文件增删改事件，通过 `app.emit("fs:changed", ChangedPayload)` 推送给前端：
  - 左栏文件树自动高亮新创建/被修改文件及最新 Git 状态标记（`M` / `U`）；
  - 中间 Monaco 若当前正打开该文件且无未保存草稿，自动无感热重载磁盘最新内容；
  - 顶栏 `Git` 徽标数字自动增量更新。

#### 3. `search.rs`：内嵌 `ripgrep` 全库搜索（对应图 04 左栏）
- 直接使用 `ignore::WalkBuilder` + `grep_searcher::Searcher` + `grep_regex::RegexMatcherBuilder`，避免频繁 fork 外部 `rg` 进程。
- 支持图 04 左侧全部交互：大小写开关（`Aa`）、正则开关（`.*`）、按文件聚合结果列表（含行号、命中列起止偏移量供前端淡黄高亮）以及全库安全替换。

#### 4. `git_ops.rs`：异步本机 `git` CLI 封装（对应图 02）
- **为何用本机 `git` CLI 而非 `libgit2` (`git2` crate)**：`libgit2` 长期存在 macOS SSH Agent、1Password SSH 密钥代理、GPG 签名以及复杂 `.git/hooks` 兼容性坑。
- **实现策略**：使用 `tokio::process::Command("git")` 并统一注入 `-c gc.auto=0` 与 `--no-optional-locks`（防止和右侧 CLI 同时读 `.git/index` 时发生锁冲突）：
  - `git_status`：`git status --porcelain=v2 --branch -z`，精确返回当前分支、ahead/behind、Staged / Unstaged 文件列表。
  - `git_diff_file`：调用 `git show HEAD:<path>` 取得旧版本全文，连同磁盘新文件全文一并返回前端，直接喂给原生 **Monaco `DiffEditor`** 渲染真双栏对比，同时用 `git diff --numstat` 计算 `+22 -6` 统计数字。
  - `git_stage` / `git_unstage` / `git_commit` / `git_recent_commits`（`git log -n 30 --format=...`）/ `git_checkout`。

#### 5. `task_runner.rs`：项目任务扫描与独立进程组级 `Run` 控制（对应图 03）
- **零配置任务发现**：自动扫描工作区根目录 `package.json`（`scripts`）、`Cargo.toml`（`bin`/`test`）、`Makefile`（target）与 `.ke/tasks.json`，生成右上角下拉菜单选项（如 `dev:server`、`test`、`build`）。
- **彻底杀干净子进程（关键工程细节）**：Node/Vite/Next 等 dev server 会派生子进程监听端口；若仅 `child.kill()` 杀父进程，子进程会变成孤儿进程继续霸占 `3000` 端口。
  - 启动时通过 `std::os::unix::process::CommandExt::process_group(0)` 为任务建立独立进程组（`pgid == child.id()`）。
  - 用户点击右上角红色 `Stop` 按钮时，调用 `nix::sys::signal::killpg(Pid::from_raw(pgid), Signal::SIGTERM)`，等待 `800ms` 未退出则补 `SIGKILL`，保证服务与子端口彻底释放。
- **日志流**：将合并后的 `stdout + stderr` 字节流处理 ANSI 后通过 `tauri::ipc::Channel` 实时推送到中间主卡下方的 `220px` 控制台。

#### 6. `pty_dock.rs`：本地 Coding CLI 多会话 PTY 舱（对应图 01-04 右侧）
- 基于 `portable-pty`（`native_pty_system().openpty(...)`）为每个右侧 Tab 拉起独立伪终端：
  - 默认可一键启动 `claude`、`codex` 或登录态交互式 `zsh`；
  - 每次打开新 PTY 时，自动向子进程注入 Klot IDE 上下文环境变量（`` `KE_PLUGINS_DIR` ``、`` `KE_WORKSPACE` `` 等，详见第四节）。
- **零延迟通道**：不使用低效的全局 Event 字符串广播，而是为每个 PTY 会话绑定专属的 **`tauri::ipc::Channel<Vec<u8>>`**，Rust 后台阻塞读取线程直接向 WebView 流式喂给 `xterm.js`，高吞吐输出（如 CLI 刷大量代码或测试日志）依然丝滑不卡顿。

#### 7. `lsp_bridge.rs`：按需本机 LSP 跳定义桥
- 不强求内置臃肿语言服务端，而是按当前打开文件后缀（`.ts/.tsx` -> `typescript-language-server --stdio`、`.rs` -> `rust-analyzer`、`.py` -> `pyright-langserver --stdio`、`.go` -> `gopls`）懒加载本机已安装的 LSP 二进制。
- Rust 侧封装标准 JSON-RPC `Content-Length` 帧收发，将 `didOpen` / `didChange` / `definition` / `hover` / `publishDiagnostics` 桥接给前端 Monaco（`monaco.languages.registerDefinitionProvider` 等），实现 **`Cmd+Click` 跨文件跳定义、悬停类型提示与红色波浪线报错**；若本机未装对应 LSP，优雅降级为纯 Monaco 高亮与文本补全，不报错打扰用户。

---

## 三、前端壳层与 Onyx Light 像素级还原架构（`src`）

### 3.1 macOS 沉浸式窗口配置（`src-tauri/tauri.conf.json`）

```json
{
  "productName": "Klot IDE",
  "app": {
    "windows": [
      {
        "title": "Klot IDE",
        "width": 1440,
        "height": 900,
        "minWidth": 1024,
        "minHeight": 680,
        "titleBarStyle": "Overlay",
        "hiddenTitle": true,
        "trafficLightPosition": { "x": 14, "y": 14 },
        "backgroundColor": "#FAFAFA"
      }
    ]
  }
}
```

- 在 `TopBar.tsx` 顶部 `40px` 区域左端预留 `76px` 给 macOS 原生红黄绿交通灯，空白底条加上 `data-tauri-drag-region` 支持原生窗口拖拽，交互按钮加 `data-tauri-drag-region="false"` 避免误拖。

### 3.2 设计系统复用与双纯白卡片布局实现
直接把 `./antigravity-design-system/tokens.css` 与 `tailwind.config.js` 接入 Vite 构建管线：
- **外框与左栏（`#FAFAFA`）**：根容器与 `LeftSidebar` 共享 `--ag-surface-shell`（`#FAFAFA`），左栏无外边框线；激活文件行应用 `--ag-onyx-selected`（`#FFFFFF`）+ `1px solid var(--ag-border-card)` + 柔和微阴影 `0 1px 2px rgb(10 10 12 / 0.04)`。
- **双纯白悬浮卡片（`#FFFFFF`, `12px` 圆角）**：`CenterCanvas` 与 `RightCliDock` 通过 Flex 容器的 `gap: 8px; padding: 0 8px 8px 8px` 自然悬浮在 `#FAFAFA` 外壳上，带有 `border: 1px solid var(--ag-border-card)`。
- **Run 控制台局部展开（对齐图 03）**：`RunDrawer` 直接渲染在 `CenterCanvas` 的 Flex 纵向容器内部底部（默认 `height: 0` 隐藏，展开后 `height: 220px`，背景 `--ag-onyx-frame` `#F9F9F9`，顶部 `1px solid var(--ag-border-default)` 分隔线），天然保证左侧 `240px` 文件树和右侧 `380px` CLI 卡片保持 `100%` 全高不被压扁。

### 3.3 真 Monaco Editor 与真 xterm.js 集成要点
- **Monaco 本地 Worker 打包**：通过 `vite-plugin-monaco-editor`（或直接配置 `MonacoEnvironment.getWorker`）把 `editor.worker`、`ts.worker`、`json.worker`、`css.worker` 打进本地静态资源，零外网依赖秒开。
- **Monaco 主题编译**：编写 `scripts/generate-onyx-theme.mjs` 读取 `./antigravity-design-system/tokens.json` 同步生成：
  1. Monaco 编辑器主题 JSON（背景 `#FFFFFF`、行号 `#8E8E95`、选区淡蓝、Diff 淡绿 `#EEF6EB` / 淡粉 `#FDEEEE`、高对比日间语法色）；
  2. `xterm.js` 16 色亮色主题对象（`background: '#FFFFFF'`、`foreground: '#0A0A0C'`、`cursor: '#2F75C3'`）。
- **右侧 `RightCliDock` 双向打通**：
  - **代码 -> CLI（`Cmd+L`）**：在 Monaco 中监听选区并绑定 `Cmd+L`，读取当前文件路径与起始结束行号推入 `cliStore.contextChips`，右侧底部输入条立刻出现 `@refund.service.ts#L18-32` 芯片。
  - **CLI -> 代码（点击文件跳转）**：在 `xterm.js` 注册自定义 `ILinkProvider`，正则匹配终端文本里的相对路径与行号（例如 `src/core/refund.service.ts:18` 或 `L18-32`），悬停显示下划线，点击直接切换回 `Code` 模式并在中间 Monaco 滚动居中高亮目标行。
  - **底部独立复合输入栏**：保留类似图 01-04 右下角的独立 `Type a command...` 输入框，彻底解决直接在 raw terminal 里输中文候选框偏移与多行粘贴乱执行的问题；按下回车将 `@file#L` 芯片与输入指令一起通过 `pty_write` 写入当前激活的 PTY 会话。

---

## 四、核心创新：「自生长 CLI 插件协议」（Self-Growing Plugin Engine）

这是区别于传统 IDE 最核心的设计——**不需要复杂的插件 API SDK 和插件市场，右边 CLI 写完脚本落盘就能直接变成 IDE 的功能按钮、状态条或底部面板**。

### 4.1 发现目录与零重启热加载
Rust 后端模块 `plugin_host.rs` 使用 `notify` 同时监听两个目录，变更后 `50ms` 内热更新并广播给前端重新渲染菜单与快捷键：
- **全局插件目录**（跨项目复用）：`~/.ke/plugins/<plugin-id>/`
- **项目专属插件目录**（随仓库走）：`<workspace>/.ke/plugins/<plugin-id>/`

### 4.2 让右侧 CLI 天然会写插件的自举机制
每次在 `pty_dock.rs` 启动右侧终端会话时，Rust 自动完成两件事：
1. 若 `~/.ke/plugins/SPEC.md` 不存在或版本落后，自动写入一份精简清晰的《Klot IDE 插件协议规范》；
2. 向 PTY 进程注入环境变量：`` `KE_PLUGINS_DIR` ``、`KE_WORKSPACE`、`KE_ACTIVE_FILE`。

因此你只需要在右边 `claude` 或 `codex` 里用自然语言说：
> *"读一下 `$KE_PLUGINS_DIR/SPEC.md`，帮我写一个插件：一键检查当前分支的待提交改动有没有遗漏 console.log，挂到右上角菜单里，快捷键 Cmd+Shift+C。"*

CLI 写完 `plugin.json` 和脚本文件保存到硬盘后，右上角齿轮菜单和快捷键面板**无需重启立即出现该功能**。

### 4.3 `plugin.json` 声明规范与 3 种扩展槽位

每个插件目录只需包含一个 `plugin.json` 和一个可执行脚本（Node / Python / Shell / Rust 二进制均可）：

```json
{
  "id": "check-console-logs",
  "name": "Check Console Logs",
  "version": "0.1.0",
  "slot": "command",
  "entry": "run.mjs",
  "runtime": "node",
  "triggers": {
    "menu": "gear",
    "shortcut": "Cmd+Shift+C",
    "palette": true
  }
}
```

支持三种严格遵循 Onyx Light 极简审美的原生槽位（**禁止返回花哨自定义 HTML 或 Emoji 图标**）：

| `slot` 类型 | 挂载位置 | 典型用途 | 返回交互协议 |
| --- | --- | --- | --- |
| `command` | 右上角齿轮菜单 + `Cmd+P` 命令面板 + 快捷键 | 一键代码规范检查、生成单测骨架、提交前审计 | 执行脚本，返回 `actions` 指令数组（见 4.4） |
| `topbar_status` | 顶栏右侧（运行组左侧）纯文本/小圆点微胶囊 | 显示当前环境端口占用、未推送提交数、本地服务健康度 | 脚本定时或在文件保存/Git 变更事件后返回 `{ "label": "3000 up", "tone": "success" }` |
| `drawer_view` | 中间卡片底部面板标签页（与 Run 控制台同级） | 结构化展示覆盖率报告、依赖审计表、SQL 查询结果 | 返回标准结构化 JSON（`markdown` 或 `table` 数据），由前端用 Onyx Light 原生组件统一样式渲染 |

### 4.4 标准输入/输出 JSON 执行契约
触发插件时，`plugin_host.rs` 启动对应脚本进程，通过 **`stdin`** 传入当前 IDE 完整上下文 JSON：

```json
{
  "workspaceRoot": "~/workspace/klot-ide",
  "branch": "feat/idempotent-refund",
  "activeFile": "src/core/refund.service.ts",
  "selection": { "startLine": 18, "endLine": 32, "text": "..." },
  "changedFiles": ["src/core/refund.service.ts", "src/core/idempotency.ts"]
}
```

脚本执行完毕后，向 **`stdout`** 输出一行标准 JSON 指令，IDE 前端立即调度执行：

```json
{
  "actions": [
    { "type": "toast", "tone": "warning", "message": "发现 2 处调试日志未清理" },
    { "type": "open_file", "path": "src/core/refund.service.ts", "line": 24 },
    { "type": "send_to_cli", "prompt": "帮我清理以下两处调试日志并保留关键错误上报" }
  ]
}
```

可用原子动作：`toast`（轻量提示）、`open_file`（打开并定位行）、`replace_selection`（回写编辑器选区）、`run_console`（向底部控制台输出日志）、`send_to_cli`（直接投喂右侧当前 CLI 会话）、`render_drawer`（展示结构化表格或 Markdown 报告）。

---

## 五、前后端 Tauri IPC 命令与流式通道契约汇总

| 模块 | IPC Command / Event / Channel | 方向 | 职责说明 |
| --- | --- | --- | --- |
| `fs_tree` | `fs_list_tree(root)` / `fs_read_file(path)` / `fs_write_file(path, text)` | Invoke | 目录树初始化、文件读写保存 |
| `fs_tree` | `fs:changed` | Event (Rust -> Web) | CLI 或外部改动文件后秒级同步树、Tab 内容与 Git 状态 |
| `search` | `search_workspace(root, query, regex, case_sensitive, channel)` | Invoke + Channel | 内嵌 `ripgrep` 流式返回各文件匹配片段 |
| `git_ops` | `git_status(root)` / `git_diff_file(root, path)` / `git_stage` / `git_commit` / `git_log` / `git_checkout` | Invoke | 支撑左栏 Git 面板、顶栏分支切换与中间 Split Diff |
| `task_runner` | `task_discover(root)` / `task_run(id, channel)` / `task_stop(id)` / `task_restart(id)` | Invoke + Channel | 扫描可执行任务、独立进程组启停与实时控制台日志流 |
| `pty_dock` | `pty_spawn(id, cmd, cwd, channel)` / `pty_write(id, data)` / `pty_resize(id, cols, rows)` / `pty_kill(id)` | Invoke + Channel | 多会话本地 PTY 生命周期管理与高频字节流直传 |
| `lsp_bridge` | `lsp_notify(lang, method, params)` / `lsp_request(lang, method, params)` / `lsp:diagnostics` | Invoke + Event | 本机 LSP 跳定义、Hover 类型与报错诊断转发 |
| `plugin_host` | `plugin_list(root)` / `plugin_execute(id, ctx)` / `plugins:updated` | Invoke + Event | 插件目录扫描、热重载广播与 stdin/stdout JSON 执行 |

---

## 六、四阶段开发里程碑与验收标准（M1 -> M4）

| 阶段 | 里程碑目标 | 核心交付内容 | 验收标准（DoD） |
| --- | --- | --- | --- |
| **M1** | **环境初始化 + Onyx Light 桌面壳 + 真文件树与 Monaco 编辑** | 安装 `rustup`；搭建 Tauri v2 工程与 `env_path.rs`；接入 `tokens.css` 做出 40px 无边框顶栏、240px 浅灰文件树与 804px 纯白 Monaco 编辑器；完成 `fs_tree.rs` 文件读写与 `notify` 监听 | 运行 `npm run tauri dev` 弹出与 **01 定稿图** 一致的亮色桌面窗口；打开 `~/workspace/klot-ide` 可秒级浏览目录树、编辑保存代码、按 `Cmd+P` 快速跳文件 |
| **M2** | **右侧 `portable-pty` + 真 `xterm.js` 多会话 CLI 舱** | 实现 `pty_dock.rs` 与 `RightCliDock.tsx`；支持 `claude` / `codex` / `+` 多 Tab 真实运行；实现编辑器 `Cmd+L` 投喂 `@file#L` 芯片与点击 CLI 输出路径跳回左侧代码行 | 在右侧面板里真实启动本机 `claude` 或 `codex` 修改工作区文件，左侧文件树与中间 Monaco 编辑器自动无感同步刷新，全程无卡顿与输入法错位 |
| **M3** | **`Git` 双栏审查 + 内嵌 `ripgrep` 搜索 + 进程组级 `Run` 控制台** | 完成 `git_ops.rs`、`search.rs`、`task_runner.rs`；实现顶栏 `Code \| Git` 切换与真 Monaco Split Diff（02 图）、左栏 `Files \| Search`（04 图）、以及右上角选任务跑服务并在中间下方展开日志且可彻底杀净进程（03 图） | 完整跑通 **01 / 02 / 03 / 04** 全部四态交互；跑完 Vite/Node 服务点 `Stop` 后确认端口完全释放不留僵尸进程 |
| **M4** | **本机 LSP 跳定义桥 + 自生长 CLI 插件引擎 + `.app` 打包** | 完成 `lsp_bridge.rs` 与 `plugin_host.rs`（含 `~/.ke/plugins/SPEC.md` 自举生成与右上角齿轮菜单渲染）；通过 `tauri build` 打包原生 macOS 应用 | 在代码区按 `Cmd+Click` 可跨文件跳转函数定义；在右侧 CLI 用自然语言让 `claude` 现写一个实用插件存到 `~/.ke/plugins/`，IDE 不重启直接热生效；产出约 `10MB` 的 `Klot IDE.app` |
