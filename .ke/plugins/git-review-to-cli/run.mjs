import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

function readStdinJson() {
  try {
    const raw = fs.readFileSync(0, 'utf8').trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function runGit(cwd, args) {
  try {
    return execFileSync('git', ['-C', cwd, '-c', 'gc.auto=0', '--no-optional-locks', ...args], {
      encoding: 'utf8',
      timeout: 4000,
    }).trim();
  } catch {
    return '';
  }
}

const ctx = readStdinJson();
const workspaceRoot = ctx.workspaceRoot || process.env.KE_WORKSPACE || process.cwd();
const branch = ctx.branch || runGit(workspaceRoot, ['rev-parse', '--abbrev-ref', 'HEAD']) || 'HEAD';
const unstagedStat = runGit(workspaceRoot, ['diff', '--stat']);
const stagedStat = runGit(workspaceRoot, ['diff', '--cached', '--stat']);
const shortStatus = runGit(workspaceRoot, ['status', '--short']);

const sections = [];
if (stagedStat) sections.push(`已暂存变更统计:\n${stagedStat}`);
if (unstagedStat) sections.push(`未暂存变更统计:\n${unstagedStat}`);
if (!stagedStat && !unstagedStat && shortStatus) {
  sections.push(`工作区文件状态:\n${shortStatus}`);
}

if (sections.length === 0) {
  const out = {
    actions: [
      {
        type: 'toast',
        tone: 'info',
        message: `分支 ${branch} 当前无待审查的 Git 变更`,
      },
    ],
  };
  process.stdout.write(`${JSON.stringify(out)}\n`);
  process.exit(0);
}

const prompt = [
  `请对仓库当前分支 (${branch}) 的改动做一次简要代码审查，重点关注潜在 Bug、边界条件与类型安全。`,
  ctx.activeFile ? `当前聚焦文件: ${ctx.activeFile}` : '',
  sections.join('\n\n'),
]
  .filter(Boolean)
  .join('\n\n');

const out = {
  actions: [
    {
      type: 'toast',
      tone: 'success',
      message: `已汇总分支 ${branch} 的 diff 统计并投喂至右侧 CLI`,
    },
    {
      type: 'send_to_cli',
      prompt,
    },
  ],
};

process.stdout.write(`${JSON.stringify(out)}\n`);
