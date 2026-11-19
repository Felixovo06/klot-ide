#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const VALID_SLOTS = new Set(['command', 'topbar_status', 'drawer_view']);
const VALID_RUNTIMES = new Set(['node', 'python3', 'sh', 'bash', 'binary']);
const VALID_MANIFEST_KEYS = new Set([
  'id',
  'name',
  'version',
  'description',
  'slot',
  'entry',
  'runtime',
  'triggers',
]);
const VALID_TRIGGER_KEYS = new Set([
  'menu',
  'shortcut',
  'palette',
  'intervalMs',
  'onSave',
  'onGitChange',
]);
const VALID_TONES_STATUS = new Set(['neutral', 'success', 'warning', 'error']);
const VALID_TONES_TOAST = new Set(['info', 'success', 'warning', 'error']);
const TEXT_SCAN_EXTS = new Set([
  '.json',
  '.mjs',
  '.js',
  '.cjs',
  '.ts',
  '.py',
  '.sh',
  '.bash',
  '.md',
  '.txt',
]);

// 检测 Emoji、象形符号、变体选择符与特殊图形字符
const EMOJI_OR_SYMBOL_RE =
  /(\p{Extended_Pictographic}|\uFE0F|\u200D|\u20E3|[\u{1F1E6}-\u{1F1FF}]|[\u2600-\u26FF]|[\u2700-\u27BF])/u;

function findDisallowedChar(text) {
  const match = EMOJI_OR_SYMBOL_RE.exec(String(text));
  if (!match) return null;
  const ch = match[0];
  const code = ch.codePointAt(0)?.toString(16).toUpperCase() || '';
  return { char: ch, codePoint: `U+${code}` };
}

function printHelp() {
  const lines = [
    'Klot IDE (KE) 自生长插件开发与校验工具',
    '',
    '用法:',
    '  node scripts/ke-plugin-tool.mjs new <id> [选项]     生成符合协议的中文插件骨架',
    '  node scripts/ke-plugin-tool.mjs validate [选项]     校验 .ke/plugins/* 全部插件',
    '',
    'new 子命令选项:',
    '  --slot <command|topbar_status|drawer_view>   插件槽位（默认: command）',
    '  --runtime <node|python3|sh|bash>             运行环境（默认: node）',
    '  --name <名称>                                插件中文显示名称',
    '  --description <描述>                         插件中文功能说明',
    '  --workspace <路径>                           工作区根目录（默认: 当前目录）',
    '  --force                                      若插件目录已存在则覆盖生成',
    '',
    'validate 子命令选项:',
    '  --workspace <路径>                           工作区根目录（默认: 当前目录）',
    '  --dir <路径>                                 直接指定插件根目录（默认: <workspace>/.ke/plugins）',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

function parseCliArgs(argv) {
  const positional = [];
  const flags = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--help' || token === '-h') {
      flags.help = true;
      continue;
    }
    if (token === '--force') {
      flags.force = true;
      continue;
    }
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        throw new Error(`参数 --${key} 缺少取值`);
      }
      flags[key] = next;
      i += 1;
      continue;
    }
    positional.push(token);
  }

  return { positional, flags };
}

function buildEntryTemplate(id, name, slot, runtime) {
  if (runtime === 'node') {
    if (slot === 'topbar_status') {
      return `import fs from 'node:fs';

/**
 * 读取 Klot IDE 通过标准输入传入的上下文 JSON
 */
function readStdinJson() {
  try {
    const raw = fs.readFileSync(0, 'utf8').trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

const ctx = readStdinJson();
const workspaceRoot = ctx.workspaceRoot || process.env.KE_WORKSPACE || process.cwd();

// 根据实际探测结果返回 TopbarStatusOutput（label 与 tone 为必填字段）
const output = {
  label: '${name} 就绪',
  tone: 'neutral',
  tooltip: \`工作区: \${workspaceRoot}\`,
};

process.stdout.write(\`\${JSON.stringify(output)}\\n\`);
`;
    }

    if (slot === 'drawer_view') {
      return `import fs from 'node:fs';

/**
 * 读取 Klot IDE 通过标准输入传入的上下文 JSON
 */
function readStdinJson() {
  try {
    const raw = fs.readFileSync(0, 'utf8').trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

const ctx = readStdinJson();
const workspaceRoot = ctx.workspaceRoot || process.env.KE_WORKSPACE || process.cwd();
const branch = ctx.branch || 'HEAD';

const markdown = [
  '## ${name} 报告',
  '',
  \`工作区: \\\`\${workspaceRoot}\\\` | 当前分支: \\\`\${branch}\\\`\`,
  '',
  '| 检查项 | 状态 | 说明 |',
  '| --- | --- | --- |',
  '| 插件骨架 | 正常 | 请在此替换为真实分析逻辑 |',
].join('\\n');

const output = {
  actions: [
    {
      type: 'render_drawer',
      title: '${name}',
      format: 'markdown',
      content: markdown,
    },
    {
      type: 'toast',
      tone: 'info',
      message: '${name} 执行完成',
    },
  ],
};

process.stdout.write(\`\${JSON.stringify(output)}\\n\`);
`;
    }

    return `import fs from 'node:fs';

/**
 * 读取 Klot IDE 通过标准输入传入的上下文 JSON
 */
function readStdinJson() {
  try {
    const raw = fs.readFileSync(0, 'utf8').trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

const ctx = readStdinJson();
const workspaceRoot = ctx.workspaceRoot || process.env.KE_WORKSPACE || process.cwd();

const output = {
  actions: [
    {
      type: 'toast',
      tone: 'info',
      message: \`插件 ${id} 已触发，当前工作区: \${workspaceRoot}\`,
    },
  ],
};

process.stdout.write(\`\${JSON.stringify(output)}\\n\`);
`;
  }

  if (runtime === 'python3') {
    if (slot === 'topbar_status') {
      return `import json
import sys

try:
    raw = sys.stdin.read().strip()
    ctx = json.loads(raw) if raw else {}
except Exception:
    ctx = {}

workspace_root = ctx.get("workspaceRoot") or ""
output = {
    "label": "${name} 就绪",
    "tone": "neutral",
    "tooltip": f"工作区: {workspace_root}",
}
print(json.dumps(output, ensure_ascii=False))
`;
    }
    if (slot === 'drawer_view') {
      return `import json
import sys

try:
    raw = sys.stdin.read().strip()
    ctx = json.loads(raw) if raw else {}
except Exception:
    ctx = {}

workspace_root = ctx.get("workspaceRoot") or ""
output = {
    "actions": [
        {
            "type": "render_drawer",
            "title": "${name}",
            "format": "markdown",
            "content": f"## ${name}\\n\\n工作区: \`{workspace_root}\`",
        },
        {
            "type": "toast",
            "tone": "info",
            "message": "${name} 执行完成",
        },
    ]
}
print(json.dumps(output, ensure_ascii=False))
`;
    }
    return `import json
import sys

try:
    raw = sys.stdin.read().strip()
    ctx = json.loads(raw) if raw else {}
except Exception:
    ctx = {}

workspace_root = ctx.get("workspaceRoot") or ""
output = {
    "actions": [
        {
            "type": "toast",
            "tone": "info",
            "message": f"插件 ${id} 已触发，工作区: {workspace_root}",
        }
    ]
}
print(json.dumps(output, ensure_ascii=False))
`;
  }

  // sh / bash 模板
  if (slot === 'topbar_status') {
    return `#!/usr/bin/env ${runtime}
cat >/dev/null
printf '{"label":"%s","tone":"neutral","tooltip":"%s"}\\n' "${name} 就绪" "Klot IDE 插件状态"
`;
  }
  if (slot === 'drawer_view') {
    return `#!/usr/bin/env ${runtime}
cat >/dev/null
printf '{"actions":[{"type":"render_drawer","title":"%s","format":"markdown","content":"## %s\\n\\n请补充实际分析脚本输出。"},{"type":"toast","tone":"info","message":"%s"}]}\\n' "${name}" "${name}" "${name} 执行完成"
`;
  }
  return `#!/usr/bin/env ${runtime}
cat >/dev/null
printf '{"actions":[{"type":"toast","tone":"info","message":"插件 %s 已执行"}]}\\n' "${id}"
`;
}

function handleNew(positional, flags) {
  const id = positional[1];
  if (!id) {
    throw new Error('请提供插件 ID，例如: node scripts/ke-plugin-tool.mjs new my-plugin');
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    throw new Error(`插件 ID "${id}" 不合法，必须使用小写字母、数字和连字符（kebab-case）`);
  }

  const slot = flags.slot || 'command';
  if (!VALID_SLOTS.has(slot)) {
    throw new Error(`不支持的 slot "${slot}"，可选值: command | topbar_status | drawer_view`);
  }

  const runtime = flags.runtime || 'node';
  if (!['node', 'python3', 'sh', 'bash'].includes(runtime)) {
    throw new Error(`脚手架暂不支持 runtime "${runtime}"，可选值: node | python3 | sh | bash`);
  }

  const name = flags.name || `自定义插件 ${id}`;
  const description = flags.description || `Klot IDE 自生长插件 ${id}（槽位: ${slot}）`;

  for (const fieldVal of [id, name, description]) {
    const bad = findDisallowedChar(fieldVal);
    if (bad) {
      throw new Error(`检测到禁止的 Emoji 或特殊符号 "${bad.char}" (${bad.codePoint})`);
    }
  }

  const workspaceRoot = path.resolve(flags.workspace || process.cwd());
  const pluginDir = path.join(workspaceRoot, '.ke', 'plugins', id);

  if (fs.existsSync(pluginDir) && !flags.force) {
    throw new Error(`插件目录已存在: ${pluginDir}（如需覆盖请附加 --force）`);
  }

  const entryMap = {
    node: 'run.mjs',
    python3: 'run.py',
    sh: 'run.sh',
    bash: 'run.sh',
  };
  const entry = entryMap[runtime];

  const triggers =
    slot === 'topbar_status'
      ? { intervalMs: 10000 }
      : { menu: 'gear', palette: true };

  const manifest = {
    id,
    name,
    version: '0.1.0',
    description,
    slot,
    entry,
    runtime,
    triggers,
  };

  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, 'plugin.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  const entryPath = path.join(pluginDir, entry);
  const entrySource = buildEntryTemplate(id, name, slot, runtime);
  fs.writeFileSync(entryPath, entrySource, 'utf8');
  if (runtime === 'sh' || runtime === 'bash') {
    fs.chmodSync(entryPath, 0o755);
  }

  process.stdout.write(
    [
      `已生成插件骨架: ${pluginDir}`,
      `- 清单文件: ${path.join(pluginDir, 'plugin.json')}`,
      `- 入口脚本: ${entryPath}`,
      `- 槽位 / 运行时: ${slot} / ${runtime}`,
      `下一步可运行校验: node scripts/ke-plugin-tool.mjs validate`,
    ].join('\n') + '\n',
  );
}

function detectGitBranch(workspaceRoot) {
  try {
    const out = execFileSync(
      'git',
      ['-C', workspaceRoot, '-c', 'gc.auto=0', '--no-optional-locks', 'rev-parse', '--abbrev-ref', 'HEAD'],
      { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
    return out || 'main';
  } catch {
    return 'main';
  }
}

function validateManifestSchema(manifest, dirName) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return ['plugin.json 顶层必须为 JSON 对象'];
  }

  for (const key of Object.keys(manifest)) {
    if (!VALID_MANIFEST_KEYS.has(key)) {
      errors.push(`plugin.json 包含未定义字段: ${key}`);
    }
  }

  for (const reqKey of ['id', 'name', 'version', 'slot', 'entry', 'runtime']) {
    if (typeof manifest[reqKey] !== 'string' || manifest[reqKey].trim() === '') {
      errors.push(`plugin.json 缺少有效的必填字符串字段: ${reqKey}`);
    }
  }

  if (typeof manifest.id === 'string') {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(manifest.id)) {
      errors.push(`plugin.json.id "${manifest.id}" 格式不合法，需为小写 kebab-case`);
    }
    if (manifest.id !== dirName) {
      errors.push(`plugin.json.id ("${manifest.id}") 与插件目录名 ("${dirName}") 不一致`);
    }
  }

  if (typeof manifest.version === 'string' && !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(manifest.version)) {
    errors.push(`plugin.json.version "${manifest.version}" 不符合 SemVer 规范`);
  }

  if (manifest.description !== undefined && typeof manifest.description !== 'string') {
    errors.push('plugin.json.description 若提供则必须为字符串');
  }

  if (typeof manifest.slot === 'string' && !VALID_SLOTS.has(manifest.slot)) {
    errors.push(`plugin.json.slot "${manifest.slot}" 非法，仅支持 command | topbar_status | drawer_view`);
  }

  if (typeof manifest.runtime === 'string' && !VALID_RUNTIMES.has(manifest.runtime)) {
    errors.push(`plugin.json.runtime "${manifest.runtime}" 非法，仅支持 node | python3 | sh | bash | binary`);
  }

  if (manifest.triggers !== undefined) {
    if (!manifest.triggers || typeof manifest.triggers !== 'object' || Array.isArray(manifest.triggers)) {
      errors.push('plugin.json.triggers 必须为对象');
    } else {
      for (const tKey of Object.keys(manifest.triggers)) {
        if (!VALID_TRIGGER_KEYS.has(tKey)) {
          errors.push(`plugin.json.triggers 包含未定义字段: ${tKey}`);
        }
      }
      const tr = manifest.triggers;
      if (tr.menu !== undefined && typeof tr.menu !== 'string') {
        errors.push('triggers.menu 必须为字符串');
      }
      if (tr.shortcut !== undefined && typeof tr.shortcut !== 'string') {
        errors.push('triggers.shortcut 必须为字符串');
      }
      if (tr.palette !== undefined && typeof tr.palette !== 'boolean') {
        errors.push('triggers.palette 必须为布尔值');
      }
      if (tr.intervalMs !== undefined && (typeof tr.intervalMs !== 'number' || tr.intervalMs <= 0)) {
        errors.push('triggers.intervalMs 必须为大于 0 的数字');
      }
      if (tr.onSave !== undefined && typeof tr.onSave !== 'boolean') {
        errors.push('triggers.onSave 必须为布尔值');
      }
      if (tr.onGitChange !== undefined && typeof tr.onGitChange !== 'boolean') {
        errors.push('triggers.onGitChange 必须为布尔值');
      }
    }
  }

  return errors;
}

function scanDirectoryForDisallowedChars(pluginDir) {
  const errors = [];
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!TEXT_SCAN_EXTS.has(ext)) continue;
        const content = fs.readFileSync(fullPath, 'utf8');
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i += 1) {
          const bad = findDisallowedChar(lines[i]);
          if (bad) {
            const rel = path.relative(pluginDir, fullPath);
            errors.push(`${rel}:${i + 1} 包含禁止的 Emoji 或特殊符号 "${bad.char}" (${bad.codePoint})`);
            break;
          }
        }
      }
    }
  }
  walk(pluginDir);
  return errors;
}

/**
 * 与 src-tauri/src/plugin_host.rs 保持 1:1 一致的 stdout JSON 解析规则
 */
function parseHostStdout(stdoutStr) {
  const lines = stdoutStr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i]);
    } catch {
      // 继续尝试整段解析
    }
  }
  try {
    return JSON.parse(stdoutStr.trim());
  } catch {
    return null;
  }
}

function validateTopbarStatusObj(st, prefix) {
  const errors = [];
  if (!st || typeof st !== 'object' || Array.isArray(st)) {
    return [`${prefix} 必须为对象`];
  }
  if (typeof st.label !== 'string' || st.label.trim() === '') {
    errors.push(`${prefix}.label 必须为非空字符串`);
  }
  if (typeof st.tone !== 'string' || !VALID_TONES_STATUS.has(st.tone)) {
    errors.push(`${prefix}.tone 非法，仅支持 neutral | success | warning | error`);
  }
  if (st.tooltip !== undefined && typeof st.tooltip !== 'string') {
    errors.push(`${prefix}.tooltip 若提供则必须为字符串`);
  }
  return errors;
}

function validateActionItem(action, index) {
  const prefix = `actions[${index}]`;
  if (!action || typeof action !== 'object' || Array.isArray(action)) {
    return [`${prefix} 必须为对象`];
  }
  const errors = [];
  switch (action.type) {
    case 'toast':
      if (!VALID_TONES_TOAST.has(action.tone)) {
        errors.push(`${prefix}.tone 非法，仅支持 info | success | warning | error`);
      }
      if (typeof action.message !== 'string' || action.message.trim() === '') {
        errors.push(`${prefix}.message 必须为非空字符串`);
      }
      break;
    case 'open_file':
      if (typeof action.path !== 'string' || action.path.trim() === '') {
        errors.push(`${prefix}.path 必须为非空字符串`);
      }
      if (action.line !== undefined && (typeof action.line !== 'number' || action.line < 1)) {
        errors.push(`${prefix}.line 若提供则必须为正整数`);
      }
      break;
    case 'replace_selection':
      if (typeof action.text !== 'string') {
        errors.push(`${prefix}.text 必须为字符串`);
      }
      break;
    case 'run_console':
      if (typeof action.text !== 'string') {
        errors.push(`${prefix}.text 必须为字符串`);
      }
      if (action.tone !== undefined && action.tone !== 'info' && action.tone !== 'error') {
        errors.push(`${prefix}.tone 仅支持 info | error`);
      }
      break;
    case 'send_to_cli':
      if (typeof action.prompt !== 'string' || action.prompt.trim() === '') {
        errors.push(`${prefix}.prompt 必须为非空字符串`);
      }
      break;
    case 'render_drawer':
      if (typeof action.title !== 'string' || action.title.trim() === '') {
        errors.push(`${prefix}.title 必须为非空字符串`);
      }
      if (action.format !== 'markdown' && action.format !== 'table') {
        errors.push(`${prefix}.format 仅支持 markdown | table`);
      }
      if (action.format === 'markdown' && typeof action.content !== 'string') {
        errors.push(`${prefix}.content 在 markdown 格式下必须为字符串`);
      }
      if (action.format === 'table') {
        if (!Array.isArray(action.columns)) {
          errors.push(`${prefix}.columns 在 table 格式下必须为数组`);
        }
        if (!Array.isArray(action.rows)) {
          errors.push(`${prefix}.rows 在 table 格式下必须为二维数组`);
        }
      }
      break;
    default:
      errors.push(`${prefix}.type "${String(action.type)}" 不在 PluginAction 协议范围内`);
      break;
  }
  return errors;
}

function validateRuntimeOutput(manifest, parsedStdout) {
  const errors = [];
  if (!parsedStdout || typeof parsedStdout !== 'object' || Array.isArray(parsedStdout)) {
    return ['stdout 必须输出合法 JSON 对象'];
  }

  if (manifest.slot === 'topbar_status') {
    const statusCandidate = parsedStdout.status ?? parsedStdout;
    errors.push(...validateTopbarStatusObj(statusCandidate, 'TopbarStatusOutput'));
    return errors;
  }

  if (!Array.isArray(parsedStdout.actions) || parsedStdout.actions.length === 0) {
    errors.push(`槽位 ${manifest.slot} 的输出必须包含非空 actions 数组`);
    return errors;
  }

  parsedStdout.actions.forEach((act, idx) => {
    errors.push(...validateActionItem(act, idx));
  });

  if (manifest.slot === 'drawer_view') {
    const hasDrawer = parsedStdout.actions.some((act) => act && act.type === 'render_drawer');
    if (!hasDrawer) {
      errors.push('槽位 drawer_view 的输出至少需要包含一个 render_drawer 动作');
    }
  }

  return errors;
}

function validateSinglePlugin(pluginDir, pluginsRoot, mockCtx) {
  const dirName = path.basename(pluginDir);
  const errors = [];

  const manifestPath = path.join(pluginDir, 'plugin.json');
  if (!fs.existsSync(manifestPath)) {
    return { id: dirName, ok: false, errors: ['缺少 plugin.json 文件'] };
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    return {
      id: dirName,
      ok: false,
      errors: [`plugin.json JSON 解析失败: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  errors.push(...validateManifestSchema(manifest, dirName));
  errors.push(...scanDirectoryForDisallowedChars(pluginDir));

  const resolvedPluginDir = path.resolve(pluginDir);
  let entryPath = '';
  if (typeof manifest.entry === 'string' && manifest.entry.trim() !== '') {
    entryPath = path.resolve(resolvedPluginDir, manifest.entry);
    if (!entryPath.startsWith(`${resolvedPluginDir}${path.sep}`)) {
      errors.push(`entry 路径 "${manifest.entry}" 越界超出插件目录`);
    } else if (!fs.existsSync(entryPath) || !fs.statSync(entryPath).isFile()) {
      errors.push(`入口脚本不存在: ${manifest.entry}`);
    }
  }

  let summaryNote = '';
  if (errors.length === 0) {
    const bin = manifest.runtime === 'binary' ? entryPath : manifest.runtime;
    const args = manifest.runtime === 'binary' ? [] : [entryPath];
    const runRes = spawnSync(bin, args, {
      cwd: resolvedPluginDir,
      input: JSON.stringify(mockCtx),
      encoding: 'utf8',
      timeout: 15000,
      env: {
        ...process.env,
        KE_PLUGINS_DIR: pluginsRoot,
        KE_WORKSPACE: mockCtx.workspaceRoot,
      },
    });

    if (runRes.error) {
      errors.push(`试跑失败: ${runRes.error.message}`);
    } else {
      if (runRes.status !== 0) {
        errors.push(`进程退出码非 0 (${runRes.status})${runRes.stderr ? `: ${runRes.stderr.trim()}` : ''}`);
      }
      const stdout = String(runRes.stdout || '');
      const stderr = String(runRes.stderr || '');

      const badOut = findDisallowedChar(stdout);
      if (badOut) {
        errors.push(`stdout 输出包含禁止的 Emoji 或特殊符号 "${badOut.char}" (${badOut.codePoint})`);
      }
      const badErr = findDisallowedChar(stderr);
      if (badErr) {
        errors.push(`stderr 输出包含禁止的 Emoji 或特殊符号 "${badErr.char}" (${badErr.codePoint})`);
      }

      const parsed = parseHostStdout(stdout);
      if (!parsed) {
        errors.push(`stdout 不是合法 JSON（原始输出: ${stdout.trim().slice(0, 120) || '<空>'}）`);
      } else {
        const outErrors = validateRuntimeOutput(manifest, parsed);
        errors.push(...outErrors);
        if (outErrors.length === 0) {
          if (manifest.slot === 'topbar_status') {
            const st = parsed.status ?? parsed;
            summaryNote = `status="${st.label}" (${st.tone})`;
          } else {
            const types = parsed.actions.map((a) => a.type).join(', ');
            summaryNote = `actions=[${types}]`;
          }
        }
      }
    }
  }

  return {
    id: typeof manifest?.id === 'string' ? manifest.id : dirName,
    slot: typeof manifest?.slot === 'string' ? manifest.slot : '-',
    ok: errors.length === 0,
    errors,
    summaryNote,
  };
}

function handleValidate(flags) {
  const workspaceRoot = path.resolve(flags.workspace || process.cwd());
  const pluginsRoot = path.resolve(flags.dir || path.join(workspaceRoot, '.ke', 'plugins'));

  if (!fs.existsSync(pluginsRoot) || !fs.statSync(pluginsRoot).isDirectory()) {
    process.stderr.write(`校验失败: 插件目录不存在 (${pluginsRoot})\n`);
    process.exit(1);
  }

  const pluginDirs = fs
    .readdirSync(pluginsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => path.join(pluginsRoot, entry.name))
    .sort();

  if (pluginDirs.length === 0) {
    process.stderr.write(`校验失败: 在 ${pluginsRoot} 下未发现任何插件目录\n`);
    process.exit(1);
  }

  const mockCtx = {
    workspaceRoot,
    branch: detectGitBranch(workspaceRoot),
    activeFile: 'src/types/ipc.ts',
    selection: {
      startLine: 1,
      endLine: 5,
      text: 'export const IPC_EVENTS = {};',
    },
    changedFiles: ['src/types/ipc.ts'],
  };

  process.stdout.write(`正在校验插件目录: ${pluginsRoot}\n`);
  process.stdout.write(`模拟上下文工作区: ${mockCtx.workspaceRoot} (分支: ${mockCtx.branch})\n\n`);

  let failedCount = 0;
  for (const dir of pluginDirs) {
    const result = validateSinglePlugin(dir, pluginsRoot, mockCtx);
    if (result.ok) {
      process.stdout.write(`[PASS] ${result.id} (${result.slot}) -> ${result.summaryNote}\n`);
    } else {
      failedCount += 1;
      process.stdout.write(`[FAIL] ${result.id} (${result.slot || '-'})\n`);
      for (const err of result.errors) {
        process.stdout.write(`       - ${err}\n`);
      }
    }
  }

  process.stdout.write(
    `\n校验完成: 共 ${pluginDirs.length} 个插件，通过 ${pluginDirs.length - failedCount} 个，失败 ${failedCount} 个。\n`,
  );

  process.exit(failedCount > 0 ? 1 : 0);
}

function main() {
  const { positional, flags } = parseCliArgs(process.argv.slice(2));
  const cmd = positional[0];

  if (flags.help || !cmd) {
    printHelp();
    process.exit(cmd || flags.help ? 0 : 1);
  }

  if (cmd === 'new') {
    handleNew(positional, flags);
    return;
  }

  if (cmd === 'validate') {
    handleValidate(flags);
    return;
  }

  throw new Error(`未知子命令 "${cmd}"，请使用 new 或 validate（查看 --help）`);
}

try {
  main();
} catch (err) {
  process.stderr.write(`错误: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
