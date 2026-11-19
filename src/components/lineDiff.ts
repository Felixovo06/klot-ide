// 简单行级比对：为 2px Git Gutter 计算新增 / 修改 / 删除行
export interface LineChanges {
  added: number[];
  modified: number[];
  deleted: number[]; // 删除发生在该行之前（1-based）
}

const MAX_CELLS = 4_000_000;

export function computeLineChanges(base: string, current: string): LineChanges {
  const a = base.split('\n');
  const b = current.split('\n');
  const result: LineChanges = { added: [], modified: [], deleted: [] };

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA -= 1;
    endB -= 1;
  }
  const n = endA - start + 1;
  const m = endB - start + 1;
  if (n <= 0 && m <= 0) return result;
  if (n <= 0) {
    for (let j = 0; j < m; j += 1) result.added.push(start + j + 1);
    return result;
  }
  if (m <= 0) {
    result.deleted.push(Math.max(1, start + 1));
    return result;
  }
  if ((n + 1) * (m + 1) > MAX_CELLS) {
    for (let j = 0; j < m; j += 1) result.modified.push(start + j + 1);
    return result;
  }

  // LCS 动态规划
  const w = m + 1;
  const dp = new Int32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i * w + j] =
        a[start + i] === b[start + j]
          ? dp[(i + 1) * w + j + 1] + 1
          : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }

  let i = 0;
  let j = 0;
  let dels = 0;
  let ins: number[] = [];
  const flushHunk = () => {
    if (ins.length === 0 && dels > 0) {
      result.deleted.push(start + j + 1);
    } else {
      ins.forEach((line, k) => (k < dels ? result.modified : result.added).push(line));
    }
    dels = 0;
    ins = [];
  };
  while (i < n || j < m) {
    if (i < n && j < m && a[start + i] === b[start + j]) {
      flushHunk();
      i += 1;
      j += 1;
    } else if (j < m && (i >= n || dp[i * w + j + 1] >= dp[(i + 1) * w + j])) {
      ins.push(start + j + 1);
      j += 1;
    } else {
      dels += 1;
      i += 1;
    }
  }
  flushHunk();
  return result;
}
