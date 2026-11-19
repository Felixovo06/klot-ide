import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const IGNORE_DIRS = new Set([
  '.git',
  'node_modules',
  'target',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.venv',
  'vendor',
  'coverage',
]);

const SOURCE_EXTS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.rs',
  '.py',
  '.go',
  '.java',
  '.kt',
  '.swift',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.css',
  '.scss',
  '.html',
  '.vue',
  '.svelte',
  '.sql',
  '.sh',
  '.zsh',
]);

const MAX_COMMITS = 30;
const TOP_LIMIT = 15;

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
 * 在工作区执行只读 Git 命令
 */
function runGit(cwd, args) {
  try {
    return execFileSync(
      'git',
      ['-C', cwd, '-c', 'gc.auto=0', '--no-optional-locks', ...args],
      {
        encoding: 'utf8',
        timeout: 5000,
        maxBuffer: 4 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    ).trim();
  } catch {
    return '';
  }
}

/**
 * 统计近 30 次 commit 中各文件被修改的次数
 */
function collectCommitHotspots(workspaceRoot) {
  const isRepo = runGit(workspaceRoot, ['rev-parse', '--is-inside-work-tree']) === 'true';
  if (!isRepo) {
    return { isRepo: false, commitCount: 0, hotspots: [] };
  }

  const raw = runGit(workspaceRoot, [
    'log',
    '-n',
    String(MAX_COMMITS),
    '--name-only',
    '--pretty=format:__COMMIT__%H',
  ]);
  if (!raw) {
    return { isRepo: true, commitCount: 0, hotspots: [] };
  }

  const counts = new Map();
  let commitCount = 0;
  let seenInCommit = new Set();

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('__COMMIT__')) {
      commitCount += 1;
      seenInCommit = new Set();
      continue;
    }
    if (!seenInCommit.has(line)) {
      seenInCommit.add(line);
      counts.set(line, (counts.get(line) || 0) + 1);
    }
  }

  const hotspots = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TOP_LIMIT)
    .map(([relPath, touches]) => {
      const exists = fs.existsSync(path.join(workspaceRoot, relPath));
      return {
        path: relPath,
        touches,
        status: exists ? '存在' : '已移除或重命名',
      };
    });

  return { isRepo: true, commitCount, hotspots };
}

/**
 * 递归扫描工作区源码文件大小与行数
 */
function collectLargestSourceFiles(workspaceRoot) {
  const files = [];

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;

      const ext = path.extname(entry.name).toLowerCase();
      if (!SOURCE_EXTS.has(ext)) continue;

      let stat;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }

      let lineCount = 0;
      if (stat.size > 0 && stat.size <= 4 * 1024 * 1024) {
        try {
          const text = fs.readFileSync(fullPath, 'utf8');
          lineCount = text.split(/\r?\n/).length;
        } catch {
          lineCount = 0;
        }
      }

      const relPath = path.relative(workspaceRoot, fullPath).split(path.sep).join('/');
      files.push({
        path: relPath,
        bytes: stat.size,
        lines: lineCount,
      });
    }
  }

  walk(workspaceRoot);

  const totalCount = files.length;
  const topFiles = files
    .sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path))
    .slice(0, TOP_LIMIT);

  return { totalCount, topFiles };
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function escapeCell(text) {
  return String(text).replace(/\|/g, '\\|');
}

const ctx = readStdinJson();
const workspaceRoot = ctx.workspaceRoot || process.env.KE_WORKSPACE || process.cwd();

const hotspotData = collectCommitHotspots(workspaceRoot);
const sizeData = collectLargestSourceFiles(workspaceRoot);

const mdLines = [
  `## 代码热点与大文件分析`,
  '',
  `工作区: \`${escapeCell(workspaceRoot)}\` | 分析提交数: **${hotspotData.commitCount}** 次（上限 ${MAX_COMMITS} 次） | 源码文件总数: **${sizeData.totalCount}** 个`,
  '',
  `### 近 ${MAX_COMMITS} 次提交高频修改文件排行`,
  '',
];

if (!hotspotData.isRepo) {
  mdLines.push('> 当前工作区未初始化为 Git 仓库，跳过提交热点统计。', '');
} else if (hotspotData.hotspots.length === 0) {
  mdLines.push('> 当前仓库暂无可用提交历史记录。', '');
} else {
  mdLines.push('| 排名 | 文件路径 | 修改提交数 | 当前状态 |');
  mdLines.push('| --- | --- | --- | --- |');
  hotspotData.hotspots.forEach((item, index) => {
    mdLines.push(
      `| ${index + 1} | \`${escapeCell(item.path)}\` | ${item.touches} | ${item.status} |`,
    );
  });
  mdLines.push('');
}

mdLines.push(`### 最大源码文件体积排行`, '');

if (sizeData.topFiles.length === 0) {
  mdLines.push('> 未在当前工作区扫描到常见源码文件。', '');
} else {
  mdLines.push('| 排名 | 文件路径 | 文件体积 | 代码行数 |');
  mdLines.push('| --- | --- | --- | --- |');
  sizeData.topFiles.forEach((item, index) => {
    const lineText = item.lines > 0 ? `${item.lines}` : '-';
    mdLines.push(
      `| ${index + 1} | \`${escapeCell(item.path)}\` | ${formatBytes(item.bytes)} | ${lineText} |`,
    );
  });
  mdLines.push('');
}

const out = {
  actions: [
    {
      type: 'render_drawer',
      title: '代码热点与大文件分析',
      format: 'markdown',
      content: mdLines.join('\n'),
    },
    {
      type: 'toast',
      tone: 'info',
      message: `分析完成：统计近 ${hotspotData.commitCount} 次提交热点及 ${sizeData.totalCount} 个源码文件`,
    },
  ],
};

process.stdout.write(`${JSON.stringify(out)}\n`);
