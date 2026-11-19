import { Channel, invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  IPC_EVENTS,
  type AppContextInfo,
  type FsChangedEvent,
  type FsFileContent,
  type FsTreeNode,
  type GitBranchInfo,
  type GitCommitDetail,
  type GitCommitInfo,
  type GitCompareResult,
  type GitDiffResult,
  type GitGraphNode,
  type GitStatusResult,
  type LspDiagnosticsEvent,
  type LspServerStatus,
  type OnyxPluginManifest,
  type PluginExecutionContext,
  type PluginExecutionResult,
  type PluginsUpdatedEvent,
  type PtySessionInfo,
  type PtySpawnOptions,
  type SearchFileResult,
  type SearchReplaceResult,
  type SearchStreamEvent,
  type SearchSummary,
  type TaskDefinition,
  type TaskOutputEvent,
  type TaskRunHandle,
} from '../types/ipc';

export function isTauriRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
  );
}

// ==================== 浏览器演示 Mock 状态 ====================

const MOCK_ROOT = '/workspace/kt-payment-core';

const mockFiles = new Map<string, string>([
  [
    `${MOCK_ROOT}/src/core/refund.service.ts`,
    `import { IdempotencyStore } from './idempotency';

export interface RefundRequest {
  orderId: string;
  amountCents: number;
  reason: string;
  idempotencyKey: string;
}

export interface RefundReceipt {
  refundId: string;
  status: 'accepted' | 'duplicate';
  amountCents: number;
}

export async function processRefund(
  req: RefundRequest,
  store: IdempotencyStore,
): Promise<RefundReceipt> {
  const existing = await store.get(req.idempotencyKey);
  if (existing) {
    return {
      refundId: existing.refundId,
      status: 'duplicate',
      amountCents: existing.amountCents,
    };
  }

  if (req.amountCents <= 0) {
    throw new Error('Refund amount must be positive');
  }

  const refundId = \`rf_\${Date.now()}\`;
  await store.set(req.idempotencyKey, { refundId, amountCents: req.amountCents });

  return {
    refundId,
    status: 'accepted',
    amountCents: req.amountCents,
  };
}
`,
  ],
  [
    `${MOCK_ROOT}/src/core/idempotency.ts`,
    `export interface StoredRecord {
  refundId: string;
  amountCents: number;
}

export class IdempotencyStore {
  private readonly records = new Map<string, StoredRecord>();

  async get(key: string): Promise<StoredRecord | undefined> {
    return this.records.get(key);
  }

  async set(key: string, value: StoredRecord): Promise<void> {
    this.records.set(key, value);
  }
}
`,
  ],
  [
    `${MOCK_ROOT}/src/api/refund.routes.ts`,
    `import { processRefund } from '../core/refund.service';
import { IdempotencyStore } from '../core/idempotency';

const store = new IdempotencyStore();

export async function handleCreateRefund(body: {
  orderId: string;
  amountCents: number;
  reason: string;
  idempotencyKey: string;
}) {
  return processRefund(body, store);
}
`,
  ],
  [
    `${MOCK_ROOT}/tests/refund.test.ts`,
    `import { IdempotencyStore } from '../src/core/idempotency';
import { processRefund } from '../src/core/refund.service';

export async function runSmokeTest() {
  const store = new IdempotencyStore();
  const first = await processRefund(
    {
      orderId: 'ord_1001',
      amountCents: 1200,
      reason: 'customer_request',
      idempotencyKey: 'key_01',
    },
    store,
  );
  const second = await processRefund(
    {
      orderId: 'ord_1001',
      amountCents: 1200,
      reason: 'customer_request',
      idempotencyKey: 'key_01',
    },
    store,
  );
  return { first, second };
}
`,
  ],
  [
    `${MOCK_ROOT}/package.json`,
    JSON.stringify(
      {
        name: 'kt-payment-core',
        version: '0.1.0',
        scripts: {
          'dev:server': 'vite --port 3000',
          'test:unit': 'vitest run',
          build: 'tsc && vite build',
        },
      },
      null,
      2,
    ),
  ],
]);

let mockStagedSet = new Set<string>(['src/core/idempotency.ts']);
let mockBranches: GitBranchInfo[] = [
  { name: 'feat/idempotent-refund', isCurrent: true, isRemote: false },
  { name: 'main', isCurrent: false, isRemote: false },
  { name: 'origin/main', isCurrent: false, isRemote: true },
  { name: 'origin/feat/idempotent-refund', isCurrent: false, isRemote: true },
];
let mockCommits: GitCommitInfo[] = [
  {
    hash: 'a4f91c28e0d12a7f34b91288d8b7e9a5d3011220',
    shortHash: 'a4f91c2',
    message: 'feat(refund): add idempotency key validation',
    author: 'Klot Engineer',
    relativeTime: '14 mins ago',
    timestamp: Date.now() - 840_000,
  },
  {
    hash: 'f19e8402b832a901c5e1204b1284a0219c00391a',
    shortHash: 'f19e840',
    message: 'Merge branch main into feat/idempotent-refund',
    author: 'Klot Engineer',
    relativeTime: '48 mins ago',
    timestamp: Date.now() - 2_880_000,
  },
  {
    hash: '9b22d10e4421b0c988a12d77c89b00412e89441b',
    shortHash: '9b22d10',
    message: 'fix(api): guard negative refund amountCents',
    author: 'Klot Reviewer',
    relativeTime: '1 hour ago',
    timestamp: Date.now() - 4_200_000,
  },
  {
    hash: '7c31b091d4a0882ef7345210b199a0cc48102344',
    shortHash: '7c31b09',
    message: 'chore: bootstrap payment core module',
    author: 'Klot Engineer',
    relativeTime: '2 hours ago',
    timestamp: Date.now() - 7_200_000,
  },
];

const mockGraphNodes: GitGraphNode[] = [
  {
    hash: 'a4f91c28e0d12a7f34b91288d8b7e9a5d3011220',
    shortHash: 'a4f91c2',
    parents: ['f19e8402b832a901c5e1204b1284a0219c00391a'],
    refs: [
      { name: 'feat/idempotent-refund', kind: 'head', isCurrentHead: true },
      { name: 'origin/feat/idempotent-refund', kind: 'remote' },
    ],
    message: 'feat(refund): add idempotency key validation',
    author: 'Klot Engineer',
    authorEmail: 'dev@klot.dev',
    relativeTime: '14 mins ago',
    timestamp: Date.now() - 840_000,
  },
  {
    hash: 'f19e8402b832a901c5e1204b1284a0219c00391a',
    shortHash: 'f19e840',
    parents: [
      'd0184a22c9107f34120089ab45cd67ef89012345',
      '9b22d10e4421b0c988a12d77c89b00412e89441b',
    ],
    refs: [],
    message: 'Merge branch main into feat/idempotent-refund',
    author: 'Klot Engineer',
    authorEmail: 'dev@klot.dev',
    relativeTime: '48 mins ago',
    timestamp: Date.now() - 2_880_000,
  },
  {
    hash: '9b22d10e4421b0c988a12d77c89b00412e89441b',
    shortHash: '9b22d10',
    parents: ['7c31b091d4a0882ef7345210b199a0cc48102344'],
    refs: [
      { name: 'main', kind: 'local' },
      { name: 'origin/main', kind: 'remote' },
    ],
    message: 'fix(api): guard negative refund amountCents',
    author: 'Klot Reviewer',
    authorEmail: 'reviewer@klot.dev',
    relativeTime: '1 hour ago',
    timestamp: Date.now() - 4_200_000,
  },
  {
    hash: 'd0184a22c9107f34120089ab45cd67ef89012345',
    shortHash: 'd0184a2',
    parents: ['7c31b091d4a0882ef7345210b199a0cc48102344'],
    refs: [],
    message: 'feat(store): introduce IdempotencyStore interface',
    author: 'Klot Engineer',
    authorEmail: 'dev@klot.dev',
    relativeTime: '95 mins ago',
    timestamp: Date.now() - 5_700_000,
  },
  {
    hash: '7c31b091d4a0882ef7345210b199a0cc48102344',
    shortHash: '7c31b09',
    parents: [],
    refs: [{ name: 'v0.1.0', kind: 'tag' }],
    message: 'chore: bootstrap payment core module',
    author: 'Klot Engineer',
    authorEmail: 'dev@klot.dev',
    relativeTime: '2 hours ago',
    timestamp: Date.now() - 7_200_000,
  },
];

const mockTaskTimers = new Map<string, number>();
const mockPtyCallbacks = new Map<string, (bytes: number[]) => void>();
const textEncoder = new TextEncoder();

function buildMockTree(): FsTreeNode[] {
  const root: FsTreeNode[] = [];
  const ensureDir = (nodes: FsTreeNode[], name: string, relPath: string): FsTreeNode => {
    let existing = nodes.find((n) => n.isDir && n.name === name);
    if (!existing) {
      existing = {
        name,
        path: relPath,
        fullPath: `${MOCK_ROOT}/${relPath}`,
        isDir: true,
        children: [],
      };
      nodes.push(existing);
    }
    return existing;
  };

  for (const fullPath of Array.from(mockFiles.keys()).sort()) {
    const rel = fullPath.slice(MOCK_ROOT.length + 1);
    const parts = rel.split('/');
    let cursor = root;
    let accum = '';
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      accum = accum ? `${accum}/${part}` : part;
      if (i === parts.length - 1) {
        cursor.push({
          name: part,
          path: accum,
          fullPath,
          isDir: false,
          size: mockFiles.get(fullPath)?.length ?? 0,
        });
      } else {
        const dirNode = ensureDir(cursor, part, accum);
        cursor = dirNode.children!;
      }
    }
  }

  const sortNodes = (nodes: FsTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) {
      if (n.children) sortNodes(n.children);
    }
  };
  sortNodes(root);
  return root;
}

const mockPlugins: OnyxPluginManifest[] = [
  {
    id: 'check-console-logs',
    name: '检查调试日志',
    version: '0.1.0',
    description: '扫描当前工作区改动中遗留的 console.log 调试输出',
    slot: 'command',
    entry: 'run.mjs',
    runtime: 'node',
    triggers: {
      menu: 'gear',
      shortcut: 'Cmd+Shift+C',
      palette: true,
    },
    sourceDir: '~/.ke/plugins/check-console-logs',
    scope: 'global',
  },
];

// ==================== 应用上下文 ====================

export async function appGetContext(): Promise<AppContextInfo> {
  if (!isTauriRuntime()) {
    return {
      defaultWorkspace: MOCK_ROOT,
      homeDir: '/Users/demo',
      platform: 'macos',
      availableClis: ['claude', 'agy', 'pi', 'codex', 'zsh'],
      onyxPluginsDir: '/Users/demo/.ke/plugins',
    };
  }
  return invoke<AppContextInfo>('app_get_context');
}

// ==================== 文件系统 (fs_tree.rs) ====================

export async function fsListTree(root: string): Promise<FsTreeNode[]> {
  if (!isTauriRuntime()) {
    return buildMockTree();
  }
  return invoke<FsTreeNode[]>('fs_list_tree', { root });
}

export async function fsReadFile(path: string): Promise<FsFileContent> {
  if (!isTauriRuntime()) {
    const content = mockFiles.get(path) ?? `// Mock file: ${path}\n`;
    return {
      path,
      content,
      encoding: 'utf-8',
      size: content.length,
      modifiedMs: Date.now(),
    };
  }
  return invoke<FsFileContent>('fs_read_file', { path });
}

export async function fsWriteFile(path: string, text: string): Promise<void> {
  if (!isTauriRuntime()) {
    mockFiles.set(path, text);
    return;
  }
  return invoke<void>('fs_write_file', { path, text });
}

export async function fsCreateFile(path: string, isDir = false): Promise<void> {
  if (!isTauriRuntime()) {
    if (!isDir) {
      mockFiles.set(path, '');
    }
    return;
  }
  return invoke<void>('fs_create_file', { path, isDir });
}

export async function fsRename(oldPath: string, newPath: string): Promise<void> {
  if (!isTauriRuntime()) {
    const prev = mockFiles.get(oldPath);
    if (prev !== undefined) {
      mockFiles.delete(oldPath);
      mockFiles.set(newPath, prev);
    }
    return;
  }
  return invoke<void>('fs_rename', { oldPath, newPath });
}

export async function fsDelete(path: string): Promise<void> {
  if (!isTauriRuntime()) {
    mockFiles.delete(path);
    return;
  }
  return invoke<void>('fs_delete', { path });
}

export async function fsWatchWorkspace(root: string): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  return invoke<void>('fs_watch_workspace', { root });
}

// ==================== 全库搜索 (search.rs) ====================

export interface SearchOptions {
  regex?: boolean;
  caseSensitive?: boolean;
}

export async function searchWorkspace(
  root: string,
  query: string,
  options: SearchOptions,
  onEvent: (event: SearchStreamEvent) => void,
): Promise<SearchSummary> {
  const regex = options.regex ?? false;
  const caseSensitive = options.caseSensitive ?? false;

  if (!isTauriRuntime()) {
    const start = performance.now();
    if (!query) {
      const summary: SearchSummary = {
        totalFiles: 0,
        totalMatches: 0,
        durationMs: 0,
        truncated: false,
      };
      onEvent({ event: 'done', data: summary });
      return summary;
    }

    let totalFiles = 0;
    let totalMatches = 0;
    const flags = caseSensitive ? 'g' : 'gi';
    const matcher = regex
      ? new RegExp(query, flags)
      : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);

    for (const [fullPath, content] of mockFiles.entries()) {
      const lines = content.split('\n');
      const fileMatches: SearchFileResult['matches'] = [];
      lines.forEach((lineText, idx) => {
        matcher.lastIndex = 0;
        const ranges: Array<{ start: number; end: number }> = [];
        let m: RegExpExecArray | null;
        while ((m = matcher.exec(lineText)) !== null) {
          if (m[0].length === 0) {
            matcher.lastIndex += 1;
            continue;
          }
          ranges.push({ start: m.index, end: m.index + m[0].length });
        }
        if (ranges.length > 0) {
          totalMatches += ranges.length;
          fileMatches.push({
            lineNumber: idx + 1,
            lineText,
            ranges,
          });
        }
      });

      if (fileMatches.length > 0) {
        totalFiles += 1;
        onEvent({
          event: 'match',
          data: {
            path: fullPath.slice(MOCK_ROOT.length + 1),
            fullPath,
            matches: fileMatches,
          },
        });
      }
    }

    const summary: SearchSummary = {
      totalFiles,
      totalMatches,
      durationMs: Math.round(performance.now() - start),
      truncated: false,
    };
    onEvent({ event: 'done', data: summary });
    return summary;
  }

  const channel = new Channel<SearchStreamEvent>();
  channel.onmessage = onEvent;
  return invoke<SearchSummary>('search_workspace', {
    root,
    query,
    regex,
    caseSensitive,
    channel,
  });
}

export async function searchReplace(
  root: string,
  query: string,
  replacement: string,
  options: SearchOptions & { paths?: string[] },
): Promise<SearchReplaceResult> {
  const regex = options.regex ?? false;
  const caseSensitive = options.caseSensitive ?? false;

  if (!isTauriRuntime()) {
    const flags = caseSensitive ? 'g' : 'gi';
    const matcher = regex
      ? new RegExp(query, flags)
      : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    let filesModified = 0;
    let replacementsCount = 0;
    const modifiedPaths: string[] = [];

    for (const [fullPath, content] of mockFiles.entries()) {
      const rel = fullPath.slice(MOCK_ROOT.length + 1);
      if (options.paths && options.paths.length > 0 && !options.paths.includes(rel)) {
        continue;
      }
      let localCount = 0;
      const next = content.replace(matcher, () => {
        localCount += 1;
        return replacement;
      });
      if (localCount > 0) {
        mockFiles.set(fullPath, next);
        filesModified += 1;
        replacementsCount += localCount;
        modifiedPaths.push(rel);
      }
    }
    return { filesModified, replacementsCount, modifiedPaths };
  }

  return invoke<SearchReplaceResult>('search_replace', {
    root,
    query,
    replacement,
    regex,
    caseSensitive,
    paths: options.paths ?? null,
  });
}

// ==================== Git 操作 (git_ops.rs) ====================

export async function gitInit(root: string): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  return invoke<void>('git_init', { root });
}

export async function gitStatus(root: string): Promise<GitStatusResult> {
  if (!isTauriRuntime()) {
    const current = mockBranches.find((b) => b.isCurrent)?.name ?? 'feat/idempotent-refund';
    const allChanges = [
      { path: 'src/core/refund.service.ts', status: 'M' as const, additions: 22, deletions: 6 },
      { path: 'src/api/refund.routes.ts', status: 'M' as const, additions: 8, deletions: 2 },
      { path: 'src/core/idempotency.ts', status: 'U' as const, additions: 18, deletions: 0 },
      { path: 'tests/refund.test.ts', status: 'M' as const, additions: 14, deletions: 3 },
    ];
    const staged = allChanges
      .filter((c) => mockStagedSet.has(c.path))
      .map((c) => ({ ...c, staged: true }));
    const changes = allChanges
      .filter((c) => !mockStagedSet.has(c.path))
      .map((c) => ({ ...c, staged: false }));

    return {
      isRepo: true,
      branch: current,
      upstream: `origin/${current}`,
      ahead: 1,
      behind: 0,
      staged,
      changes,
      totalChanges: staged.length + changes.length,
    };
  }
  return invoke<GitStatusResult>('git_status', { root });
}

export async function gitDiffFile(
  root: string,
  path: string,
  staged = false,
): Promise<GitDiffResult> {
  if (!isTauriRuntime()) {
    const full = `${MOCK_ROOT}/${path}`;
    const modifiedText = mockFiles.get(full) ?? '';
    const originalText = modifiedText
      .replace("status: 'accepted' | 'duplicate';", "status: 'accepted';")
      .replace("throw new Error('Refund amount must be positive');", '// TODO: validate amount');
    return {
      path,
      originalText,
      modifiedText,
      additions: 22,
      deletions: 6,
      isBinary: false,
      isNewFile: path === 'src/core/idempotency.ts',
    };
  }
  return invoke<GitDiffResult>('git_diff_file', { root, path, staged });
}

export async function gitStage(root: string, paths: string[]): Promise<void> {
  if (!isTauriRuntime()) {
    paths.forEach((p) => mockStagedSet.add(p));
    return;
  }
  return invoke<void>('git_stage', { root, paths });
}

export async function gitUnstage(root: string, paths: string[]): Promise<void> {
  if (!isTauriRuntime()) {
    paths.forEach((p) => mockStagedSet.delete(p));
    return;
  }
  return invoke<void>('git_unstage', { root, paths });
}

export async function gitDiscard(root: string, paths: string[]): Promise<void> {
  if (!isTauriRuntime()) {
    paths.forEach((p) => mockStagedSet.delete(p));
    return;
  }
  return invoke<void>('git_discard', { root, paths });
}

export async function gitCommit(root: string, message: string): Promise<GitCommitInfo> {
  if (!isTauriRuntime()) {
    mockStagedSet = new Set();
    const info: GitCommitInfo = {
      hash: `${Date.now().toString(16)}00000000000000000000000000000000`.slice(0, 40),
      shortHash: Date.now().toString(16).slice(-7),
      message,
      author: 'Onyx Engineer',
      relativeTime: 'just now',
      timestamp: Date.now(),
    };
    mockCommits = [info, ...mockCommits];
    return info;
  }
  return invoke<GitCommitInfo>('git_commit', { root, message });
}

export async function gitLog(root: string, limit = 30): Promise<GitCommitInfo[]> {
  if (!isTauriRuntime()) {
    return mockCommits.slice(0, limit);
  }
  return invoke<GitCommitInfo[]>('git_log', { root, limit });
}

export async function gitBranches(root: string): Promise<GitBranchInfo[]> {
  if (!isTauriRuntime()) {
    return mockBranches;
  }
  return invoke<GitBranchInfo[]>('git_branches', { root });
}

export async function gitCheckout(root: string, branch: string, create = false): Promise<void> {
  if (!isTauriRuntime()) {
    if (create && !mockBranches.some((b) => b.name === branch)) {
      mockBranches = [...mockBranches, { name: branch, isCurrent: true, isRemote: false }];
    }
    mockBranches = mockBranches.map((b) => ({ ...b, isCurrent: b.name === branch }));
    return;
  }
  return invoke<void>('git_checkout', { root, branch, create });
}

export async function gitFetch(root: string): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  return invoke<void>('git_fetch', { root });
}

export async function gitGraph(
  root: string,
  limit = 150,
  all = true,
): Promise<GitGraphNode[]> {
  if (!isTauriRuntime()) {
    const sliced = mockGraphNodes.slice(0, limit);
    if (all) {
      return sliced;
    }
    return sliced.filter((n) => n.hash !== '9b22d10e4421b0c988a12d77c89b00412e89441b');
  }
  return invoke<GitGraphNode[]>('git_graph', { root, limit, all });
}

export async function gitCommitDetail(root: string, commit: string): Promise<GitCommitDetail> {
  if (!isTauriRuntime()) {
    const node = mockGraphNodes.find((n) => n.hash === commit || n.shortHash === commit) ?? mockGraphNodes[0];
    return {
      hash: node.hash,
      shortHash: node.shortHash,
      parents: node.parents,
      author: node.author,
      authorEmail: node.authorEmail,
      timestamp: node.timestamp,
      relativeTime: node.relativeTime,
      subject: node.message,
      body: '在预览模式下模拟提交详情与变更文件清单。',
      files: [
        {
          path: 'src/core/refund.service.ts',
          status: 'M',
          staged: false,
          additions: 14,
          deletions: 4,
        },
        {
          path: 'src/core/idempotency.ts',
          status: 'A',
          staged: false,
          additions: 18,
          deletions: 0,
        },
      ],
      totalAdditions: 32,
      totalDeletions: 4,
    };
  }
  return invoke<GitCommitDetail>('git_commit_detail', { root, commit });
}

export async function gitDiffCommitFile(
  root: string,
  commit: string,
  path: string,
  oldPath?: string | null,
): Promise<GitDiffResult> {
  if (!isTauriRuntime()) {
    const full = `${MOCK_ROOT}/${path}`;
    const modifiedText = mockFiles.get(full) ?? `// Mock commit ${commit.slice(0, 7)} file: ${path}\n`;
    const originalText =
      path === 'src/core/idempotency.ts'
        ? ''
        : modifiedText.replace("status: 'duplicate'", "status: 'accepted'");
    return {
      path,
      originalText,
      modifiedText,
      additions: 14,
      deletions: 4,
      isBinary: false,
      isNewFile: path === 'src/core/idempotency.ts',
    };
  }
  return invoke<GitDiffResult>('git_diff_commit_file', {
    root,
    commit,
    path,
    oldPath: oldPath ?? null,
  });
}

export async function gitCompareRefs(
  root: string,
  baseRef: string,
  headRef: string,
  threeDot = true,
): Promise<GitCompareResult> {
  if (!isTauriRuntime()) {
    const isWorktree = headRef === 'WORKTREE';
    return {
      baseRef,
      headRef,
      threeDot,
      ahead: isWorktree ? 2 : 3,
      behind: isWorktree ? 0 : 1,
      files: [
        {
          path: 'src/core/refund.service.ts',
          status: 'M',
          staged: false,
          additions: 22,
          deletions: 6,
        },
        {
          path: 'src/core/idempotency.ts',
          status: 'A',
          staged: false,
          additions: 18,
          deletions: 0,
        },
        {
          path: 'tests/refund.test.ts',
          status: 'M',
          staged: false,
          additions: 14,
          deletions: 3,
        },
      ],
      commits: mockCommits.slice(0, 3),
      totalAdditions: 54,
      totalDeletions: 9,
    };
  }
  return invoke<GitCompareResult>('git_compare_refs', {
    root,
    baseRef,
    headRef,
    threeDot,
  });
}

export async function gitDiffRefsFile(
  root: string,
  baseRef: string,
  headRef: string,
  path: string,
  oldPath?: string | null,
  threeDot = true,
): Promise<GitDiffResult> {
  if (!isTauriRuntime()) {
    const full = `${MOCK_ROOT}/${path}`;
    const modifiedText = mockFiles.get(full) ?? '';
    const originalText = modifiedText
      .replace("status: 'accepted' | 'duplicate';", "status: 'accepted';")
      .replace("throw new Error('Refund amount must be positive');", '// validate amount');
    return {
      path,
      originalText,
      modifiedText,
      additions: 22,
      deletions: 6,
      isBinary: false,
      isNewFile: path === 'src/core/idempotency.ts',
    };
  }
  return invoke<GitDiffResult>('git_diff_refs_file', {
    root,
    baseRef,
    headRef,
    path,
    oldPath: oldPath ?? null,
    threeDot,
  });
}

// ==================== 任务运行器 (task_runner.rs) ====================

export async function taskDiscover(root: string): Promise<TaskDefinition[]> {
  if (!isTauriRuntime()) {
    return [
      {
        id: 'npm:dev:server',
        name: 'dev:server',
        command: 'npm run dev:server',
        cwd: MOCK_ROOT,
        source: 'package.json',
      },
      {
        id: 'npm:test:unit',
        name: 'test:unit',
        command: 'npm run test:unit',
        cwd: MOCK_ROOT,
        source: 'package.json',
      },
      {
        id: 'npm:build',
        name: 'build',
        command: 'npm run build',
        cwd: MOCK_ROOT,
        source: 'package.json',
      },
    ];
  }
  return invoke<TaskDefinition[]>('task_discover', { root });
}

export async function taskRun(
  root: string,
  taskId: string,
  command: string,
  onEvent: (event: TaskOutputEvent) => void,
): Promise<TaskRunHandle> {
  if (!isTauriRuntime()) {
    const runId = `mock-run-${Date.now()}`;
    onEvent({
      event: 'stdout',
      data: {
        runId,
        chunk: `[ke-mock] starting "${command}" in ${root}\n`,
        timestampMs: Date.now(),
      },
    });
    const timer = window.setTimeout(() => {
      onEvent({
        event: 'stdout',
        data: {
          runId,
          chunk: `[vite] server ready in 184 ms\n[api] listening on http://127.0.0.1:3000\n`,
          timestampMs: Date.now(),
        },
      });
    }, 250);
    mockTaskTimers.set(runId, timer);
    return { runId, taskId, pid: 99999, command };
  }

  const channel = new Channel<TaskOutputEvent>();
  channel.onmessage = onEvent;
  return invoke<TaskRunHandle>('task_run', { root, taskId, command, channel });
}

export async function taskRunCustom(
  root: string,
  name: string,
  command: string,
  onEvent: (event: TaskOutputEvent) => void,
): Promise<TaskRunHandle> {
  if (!isTauriRuntime()) {
    return taskRun(root, `custom:${name}`, command, onEvent);
  }
  const channel = new Channel<TaskOutputEvent>();
  channel.onmessage = onEvent;
  return invoke<TaskRunHandle>('task_run_custom', { root, name, command, channel });
}

export async function taskStop(runId: string): Promise<void> {
  if (!isTauriRuntime()) {
    const timer = mockTaskTimers.get(runId);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      mockTaskTimers.delete(runId);
    }
    return;
  }
  return invoke<void>('task_stop', { runId });
}

export async function taskRestart(
  root: string,
  runId: string,
  taskId: string,
  command: string,
  onEvent: (event: TaskOutputEvent) => void,
): Promise<TaskRunHandle> {
  if (!isTauriRuntime()) {
    await taskStop(runId);
    return taskRun(root, taskId, command, onEvent);
  }
  const channel = new Channel<TaskOutputEvent>();
  channel.onmessage = onEvent;
  return invoke<TaskRunHandle>('task_restart', {
    root,
    runId,
    taskId,
    command,
    channel,
  });
}

// ==================== PTY 终端舱 (pty_dock.rs) ====================

export async function ptySpawn(
  options: PtySpawnOptions,
  onBytes: (bytes: Uint8Array) => void,
): Promise<PtySessionInfo> {
  if (!isTauriRuntime()) {
    const cb = (chunk: number[]) => onBytes(new Uint8Array(chunk));
    mockPtyCallbacks.set(options.id, cb);
    const banner =
      `[ke-mock] ${options.cmd} session ready in ${options.cwd}\r\n` +
      `Read src/core/refund.service.ts\r\n` +
      `> `;
    window.setTimeout(() => {
      cb(Array.from(textEncoder.encode(banner)));
    }, 50);
    return {
      id: options.id,
      cmd: options.cmd,
      cwd: options.cwd,
      pid: 88888,
    };
  }

  const channel = new Channel<number[]>();
  channel.onmessage = (bytes) => {
    onBytes(new Uint8Array(bytes));
  };
  return invoke<PtySessionInfo>('pty_spawn', {
    id: options.id,
    cmd: options.cmd,
    args: options.args,
    cwd: options.cwd,
    cols: options.cols,
    rows: options.rows,
    activeFile: options.activeFile,
    theme: options.theme ?? null,
    channel,
  });
}

export async function ptyWrite(id: string, data: string): Promise<void> {
  if (!isTauriRuntime()) {
    const cb = mockPtyCallbacks.get(id);
    if (cb) {
      const normalized = data.replace(/\r?\n/g, '\r\n');
      cb(Array.from(textEncoder.encode(`${normalized}\r\n> `)));
    }
    return;
  }
  return invoke<void>('pty_write', { id, data });
}

export async function ptyResize(id: string, cols: number, rows: number): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  return invoke<void>('pty_resize', { id, cols, rows });
}

export async function ptyKill(id: string): Promise<void> {
  if (!isTauriRuntime()) {
    mockPtyCallbacks.delete(id);
    return;
  }
  return invoke<void>('pty_kill', { id });
}

// ==================== LSP 桥接 (lsp_bridge.rs) ====================

export async function lspNotify(
  root: string,
  lang: string,
  method: string,
  params: unknown,
): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  return invoke<void>('lsp_notify', { root, lang, method, params });
}

export async function lspRequest<T = unknown>(
  root: string,
  lang: string,
  method: string,
  params: unknown,
): Promise<T | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  return invoke<T | null>('lsp_request', { root, lang, method, params });
}

export async function lspStatus(root: string): Promise<LspServerStatus[]> {
  if (!isTauriRuntime()) {
    return [
      { lang: 'typescript', command: 'typescript-language-server', available: false, running: false },
      { lang: 'rust', command: 'rust-analyzer', available: false, running: false },
      { lang: 'python', command: 'pyright-langserver', available: false, running: false },
      { lang: 'go', command: 'gopls', available: false, running: false },
    ];
  }
  return invoke<LspServerStatus[]>('lsp_status', { root });
}

// ==================== 自生长插件 (plugin_host.rs) ====================

export async function pluginList(root: string): Promise<OnyxPluginManifest[]> {
  if (!isTauriRuntime()) {
    return mockPlugins;
  }
  return invoke<OnyxPluginManifest[]>('plugin_list', { root });
}

export async function pluginExecute(
  id: string,
  root: string,
  ctx: PluginExecutionContext,
): Promise<PluginExecutionResult> {
  if (!isTauriRuntime()) {
    return {
      pluginId: id,
      actions: [
        {
          type: 'toast',
          tone: 'info',
          message: `浏览器预览模式已触发插件: ${id}`,
        },
      ],
      exitCode: 0,
    };
  }
  return invoke<PluginExecutionResult>('plugin_execute', { id, root, ctx });
}

export async function pluginWatch(root: string): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  return invoke<void>('plugin_watch', { root });
}

// ==================== 事件订阅封装 ====================

export async function onFsChanged(
  handler: (payload: FsChangedEvent) => void,
): Promise<UnlistenFn> {
  if (!isTauriRuntime()) {
    return () => {};
  }
  return listen<FsChangedEvent>(IPC_EVENTS.FS_CHANGED, (event) => {
    handler(event.payload);
  });
}

export async function onPluginsUpdated(
  handler: (payload: PluginsUpdatedEvent) => void,
): Promise<UnlistenFn> {
  if (!isTauriRuntime()) {
    return () => {};
  }
  return listen<PluginsUpdatedEvent>(IPC_EVENTS.PLUGINS_UPDATED, (event) => {
    handler(event.payload);
  });
}

export async function onLspDiagnostics(
  handler: (payload: LspDiagnosticsEvent) => void,
): Promise<UnlistenFn> {
  if (!isTauriRuntime()) {
    return () => {};
  }
  return listen<LspDiagnosticsEvent>(IPC_EVENTS.LSP_DIAGNOSTICS, (event) => {
    handler(event.payload);
  });
}
