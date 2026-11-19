import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const TOOL_SPECS = [
  { name: 'node', label: 'Node.js', args: ['-v'] },
  { name: 'npm', label: 'npm', args: ['-v'] },
  { name: 'rustc', label: 'Rust 编译器 (rustc)', args: ['--version'] },
  { name: 'cargo', label: 'Cargo', args: ['--version'] },
  { name: 'git', label: 'Git', args: ['--version'] },
  { name: 'claude', label: 'Claude Code CLI', args: ['--version'] },
  { name: 'codex', label: 'Codex CLI', args: ['--version'] },
  { name: 'python3', label: 'Python 3', args: ['--version'] },
  { name: 'go', label: 'Go', args: ['version'] },
  { name: 'rg', label: 'ripgrep (rg)', args: ['--version'] },
];

/**
 * 读取标准输入中的插件执行上下文
 */
function readStdinJson() {
  try {
    const raw = fs.readFileSync(0, 'utf8').trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * 组合当前 PATH 与常见 macOS 工具目录，确保在精简环境中也能定位工具链
 */
function getSearchPaths() {
  const home = os.homedir();
  const rawPath = process.env.PATH || '';
  const extra = [
    path.join(home, '.cargo', 'bin'),
    path.join(home, '.local', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ];
  const seen = new Set();
  const merged = [];
  for (const dir of [...rawPath.split(path.delimiter), ...extra]) {
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    merged.push(dir);
  }
  return merged;
}

function findExecutable(binName, searchPaths) {
  for (const dir of searchPaths) {
    const candidate = path.join(dir, binName);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      const stat = fs.statSync(candidate);
      if (stat.isFile()) return candidate;
    } catch {
      // 继续检查下一目录
    }
  }
  return null;
}

function probeTool(spec, searchPaths, envPath) {
  const resolved = findExecutable(spec.name, searchPaths);
  if (!resolved) {
    return {
      label: spec.label,
      status: '未安装',
      version: '-',
      binPath: '未在 PATH 中找到',
      ready: false,
    };
  }

  try {
    const stdout = execFileSync(resolved, spec.args, {
      encoding: 'utf8',
      timeout: 2000,
      env: { ...process.env, PATH: envPath },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const firstLine = stdout.split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '已安装';
    return {
      label: spec.label,
      status: '就绪',
      version: firstLine.slice(0, 80),
      binPath: resolved,
      ready: true,
    };
  } catch (err) {
    const stderrFirst =
      err && err.stderr ? String(err.stderr).split(/\r?\n/).map((l) => l.trim()).find(Boolean) : '';
    return {
      label: spec.label,
      status: '异常',
      version: stderrFirst ? stderrFirst.slice(0, 80) : '执行版本检查失败',
      binPath: resolved,
      ready: false,
    };
  }
}

function escapeCell(value) {
  return String(value).replace(/\|/g, '\\|');
}

const ctx = readStdinJson();
const homeDir = os.homedir();
const workspaceRoot = ctx.workspaceRoot || process.env.KE_WORKSPACE || process.cwd();
const searchPaths = getSearchPaths();
const envPath = searchPaths.join(path.delimiter);

const toolResults = TOOL_SPECS.map((spec) => probeTool(spec, searchPaths, envPath));
const readyCount = toolResults.filter((item) => item.ready).length;

const globalPluginsDir = process.env.KE_PLUGINS_DIR || path.join(homeDir, '.ke', 'plugins');
const wsPluginsDir = path.join(workspaceRoot, '.ke', 'plugins');
const activeFile = ctx.activeFile || process.env.KE_ACTIVE_FILE || '(当前未打开文件)';

const envChecks = [
  {
    key: 'KE_PLUGINS_DIR',
    status: process.env.KE_PLUGINS_DIR ? '已注入' : '默认推导',
    value: `\`${escapeCell(globalPluginsDir)}\` (${fs.existsSync(globalPluginsDir) ? '目录存在' : '尚未创建'})`,
  },
  {
    key: 'KE_WORKSPACE',
    status: process.env.KE_WORKSPACE || ctx.workspaceRoot ? '已注入' : '回退当前目录',
    value: `\`${escapeCell(workspaceRoot)}\``,
  },
  {
    key: 'KE_ACTIVE_FILE',
    status: ctx.activeFile || process.env.KE_ACTIVE_FILE ? '已传入' : '空',
    value: `\`${escapeCell(activeFile)}\``,
  },
  {
    key: '项目插件目录 (.ke/plugins)',
    status: fs.existsSync(wsPluginsDir) ? '已启用' : '未创建',
    value: `\`${escapeCell(wsPluginsDir)}\``,
  },
  {
    key: '默认 Shell / 平台',
    status: '信息',
    value: `${process.env.SHELL || '未知'} (${process.platform} / ${os.arch()})`,
  },
  {
    key: 'PATH 搜索目录数',
    status: '信息',
    value: `系统 PATH 共 ${String(process.env.PATH || '').split(path.delimiter).filter(Boolean).length} 项`,
  },
];

const mdLines = [
  '## 开发环境与工具链诊断',
  '',
  `工作区: \`${escapeCell(workspaceRoot)}\` | 工具链就绪: **${readyCount} / ${toolResults.length}** 项`,
  '',
  '### 1. 本机开发工具链与 Coding CLI 检测',
  '',
  '| 工具 | 状态 | 版本摘要 | 可执行路径 |',
  '| --- | --- | --- | --- |',
  ...toolResults.map(
    (item) =>
      `| ${escapeCell(item.label)} | ${item.status} | \`${escapeCell(item.version)}\` | \`${escapeCell(item.binPath)}\` |`,
  ),
  '',
  '### 2. Klot IDE 环境变量与目录状态',
  '',
  '| 检查项 | 状态 | 当前值 / 说明 |',
  '| --- | --- | --- |',
  ...envChecks.map(
    (item) => `| ${escapeCell(item.key)} | ${item.status} | ${item.value} |`,
  ),
  '',
];

const out = {
  actions: [
    {
      type: 'render_drawer',
      title: '环境与工具链诊断',
      format: 'markdown',
      content: mdLines.join('\n'),
    },
    {
      type: 'toast',
      tone: readyCount >= 5 ? 'success' : 'info',
      message: `环境诊断完成：${readyCount}/${toolResults.length} 项常用开发工具已就绪`,
    },
  ],
};

process.stdout.write(`${JSON.stringify(out)}\n`);
