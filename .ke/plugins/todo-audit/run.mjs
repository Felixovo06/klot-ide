import fs from 'node:fs';
import path from 'node:path';

const IGNORE_DIRS = new Set([
  '.git',
  'node_modules',
  'target',
  'dist',
  '.next',
  '.turbo',
]);

const TEXT_EXTS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.rs',
  '.py',
  '.go',
  '.css',
  '.json',
  '.md',
  '.toml',
  '.html',
]);

function readStdinJson() {
  try {
    const raw = fs.readFileSync(0, 'utf8').trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function walkFiles(dir, root, results) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, root, results);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!TEXT_EXTS.has(ext)) continue;
      let content = '';
      try {
        content = fs.readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      const rel = path.relative(root, full).split(path.sep).join('/');
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const match = /\b(TODO|FIXME)\b[:：]?\s*(.*)/.exec(line);
        if (match) {
          const snippet = (match[2] || line.trim()).slice(0, 120);
          results.push([rel, i + 1, match[1], snippet || '(无附加说明)']);
          if (results.length >= 200) return;
        }
      }
    }
    if (results.length >= 200) return;
  }
}

const ctx = readStdinJson();
const workspaceRoot = ctx.workspaceRoot || process.env.KE_WORKSPACE || process.cwd();
const rows = [];
walkFiles(workspaceRoot, workspaceRoot, rows);

const out = {
  actions: [
    {
      type: 'render_drawer',
      title: 'TODO 与 FIXME 审计报告',
      format: 'table',
      columns: ['文件', '行号', '类型', '摘要'],
      rows,
    },
    {
      type: 'toast',
      tone: rows.length > 0 ? 'warning' : 'success',
      message:
        rows.length > 0
          ? `审计完成，共发现 ${rows.length} 处 TODO/FIXME 标记`
          : '审计完成，当前工作区未发现 TODO/FIXME 标记',
    },
  ],
};

process.stdout.write(`${JSON.stringify(out)}\n`);
