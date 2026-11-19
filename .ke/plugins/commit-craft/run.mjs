import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

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
 * 在指定目录执行只读 Git 命令
 */
function runGit(cwd, args, trimMode = 'both') {
  try {
    const raw = execFileSync(
      'git',
      ['-C', cwd, '-c', 'gc.auto=0', '--no-optional-locks', ...args],
      {
        encoding: 'utf8',
        timeout: 4000,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    return trimMode === 'end' ? raw.trimEnd() : raw.trim();
  } catch {
    return '';
  }
}

const ctx = readStdinJson();
const workspaceRoot = ctx.workspaceRoot || process.env.KE_WORKSPACE || process.cwd();

const isRepo = runGit(workspaceRoot, ['rev-parse', '--is-inside-work-tree']) === 'true';
if (!isRepo) {
  const out = {
    actions: [
      {
        type: 'toast',
        tone: 'warning',
        message: '当前工作区不是有效的 Git 仓库，无法分析提交变更',
      },
    ],
  };
  process.stdout.write(`${JSON.stringify(out)}\n`);
  process.exit(0);
}

const branch = ctx.branch || runGit(workspaceRoot, ['rev-parse', '--abbrev-ref', 'HEAD']) || 'HEAD';
const statusShort = runGit(workspaceRoot, ['status', '-s'], 'end');
const stagedStat = runGit(workspaceRoot, ['diff', '--cached', '--stat']);
const unstagedStat = runGit(workspaceRoot, ['diff', '--stat']);

if (!statusShort.trim() && !stagedStat && !unstagedStat) {
  const out = {
    actions: [
      {
        type: 'toast',
        tone: 'info',
        message: `分支 ${branch} 当前工作区干净，暂无待审查或提交的变更`,
      },
    ],
  };
  process.stdout.write(`${JSON.stringify(out)}\n`);
  process.exit(0);
}

const contextBlocks = [
  `工作区路径: ${workspaceRoot}`,
  `当前分支: ${branch}`,
  ctx.activeFile ? `当前聚焦文件: ${ctx.activeFile}` : '',
];

const statSections = [];
if (statusShort.trim()) {
  statSections.push({ title: '文件变更列表 (git status -s)', body: statusShort });
}
if (stagedStat) {
  statSections.push({ title: '已暂存区统计 (git diff --cached --stat)', body: stagedStat });
}
if (unstagedStat) {
  statSections.push({ title: '未暂存区统计 (git diff --stat)', body: unstagedStat });
}

statSections.forEach((sec, idx) => {
  contextBlocks.push(`### ${idx + 1}. ${sec.title}\n${sec.body}`);
});

const prompt = [
  '请基于以下 Git 变更状态与统计信息，完成中文代码变更审查并生成规范的提交信息（Commit Message）：',
  '',
  contextBlocks.filter(Boolean).join('\n\n'),
  '',
  '请按以下结构输出：',
  '1. 变更审查摘要：指出影响范围、潜在风险点（如边界条件、遗漏测试或调试残留）以及是否建议拆分提交；',
  '2. 推荐提交信息：按照 Conventional Commits 格式（如 feat/fix/refactor/docs/chore）提供 1 条主提交标题及简明中文要点正文；',
  '3. 可执行命令建议：如适合直接提交，给出推荐的 git add 与 git commit 参考命令（不要擅自执行提交）。',
].join('\n');

const out = {
  actions: [
    {
      type: 'send_to_cli',
      prompt,
    },
    {
      type: 'toast',
      tone: 'success',
      message: `已汇总分支 ${branch} 的状态与 diff 统计，并向右侧 CLI 发送提交生成指令`,
    },
  ],
};

process.stdout.write(`${JSON.stringify(out)}\n`);
