import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

// 重点关注的本地常用开发端口（按常见前端、全栈与后端端口排序）
const DEV_PORTS = [1420, 3000, 3001, 4173, 4200, 5000, 5173, 5174, 8000, 8080, 8888, 9000];
const DEV_PORT_SET = new Set(DEV_PORTS);

/**
 * 读取标准输入中的插件上下文 JSON
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
 * 执行 lsof 探测当前 TCP LISTEN 端口；无监听时 lsof 返回退出码 1，视为正常空结果
 */
function runLsof() {
  const args = ['-nP', '-iTCP', '-sTCP:LISTEN'];
  const candidates = ['lsof', '/usr/sbin/lsof'];

  for (const bin of candidates) {
    try {
      const stdout = execFileSync(bin, args, {
        encoding: 'utf8',
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { ok: true, stdout };
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        continue;
      }
      if (err && typeof err.status === 'number' && err.status === 1) {
        return { ok: true, stdout: String(err.stdout || '') };
      }
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return { ok: false, error: '未找到 lsof 命令' };
}

/**
 * 解析 lsof 输出，提取监听端口号与对应进程名称
 */
function parseListeningPorts(stdout) {
  const portMap = new Map();
  const lines = stdout.split(/\r?\n/);

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;

    const match = /\bTCP\s+\S+:(\d+)\s+\(LISTEN\)/.exec(line);
    if (!match) continue;

    const port = Number.parseInt(match[1], 10);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) continue;

    const rawCmd = line.split(/\s+/)[0] || 'unknown';
    const command = rawCmd.replace(/\\x20/g, ' ');
    if (!portMap.has(port)) {
      portMap.set(port, command);
    }
  }

  return portMap;
}

readStdinJson();

const result = runLsof();
if (!result.ok) {
  const output = {
    label: '端口检测不可用',
    tone: 'warning',
    tooltip: `本地端口扫描失败: ${result.error}`,
  };
  process.stdout.write(`${JSON.stringify(output)}\n`);
  process.exit(0);
}

const allListening = parseListeningPorts(result.stdout);
const matchedDevPorts = DEV_PORTS.filter((port) => allListening.has(port));

let output;
if (matchedDevPorts.length === 1) {
  const port = matchedDevPorts[0];
  const procName = allListening.get(port);
  output = {
    label: `端口 ${port} 监听`,
    tone: 'success',
    tooltip: `常用开发端口监听中: ${port} (${procName})`,
  };
} else if (matchedDevPorts.length > 1) {
  const detail = matchedDevPorts
    .map((port) => `${port} (${allListening.get(port)})`)
    .join('、');
  output = {
    label: `端口 ${matchedDevPorts[0]} 等 ${matchedDevPorts.length} 个监听`,
    tone: 'success',
    tooltip: `常用开发端口监听中: ${detail}`,
  };
} else {
  const extraCount = Array.from(allListening.keys()).filter((p) => !DEV_PORT_SET.has(p)).length;
  const extraNote = extraCount > 0 ? `（另有 ${extraCount} 个其他系统 TCP 监听端口）` : '';
  output = {
    label: '本地无监听端口',
    tone: 'neutral',
    tooltip: `未检测到常用开发端口 (${DEV_PORTS.slice(0, 6).join(', ')} 等) 监听${extraNote}`,
  };
}

process.stdout.write(`${JSON.stringify(output)}\n`);
