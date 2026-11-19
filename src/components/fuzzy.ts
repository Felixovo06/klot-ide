// 模糊匹配：子序列匹配并给连续命中、词首命中与文件名命中加分
export interface FuzzyResult {
  score: number;
  positions: number[];
}

export function fuzzyMatch(query: string, target: string): FuzzyResult | null {
  if (!query) return { score: 0, positions: [] };
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  const baseStart = t.lastIndexOf('/') + 1;
  const positions: number[] = [];
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (let qi = 0; qi < q.length; qi += 1) {
    const ch = q[qi];
    let found = -1;
    while (ti < t.length) {
      if (t[ti] === ch) {
        found = ti;
        break;
      }
      ti += 1;
    }
    if (found < 0) return null;
    positions.push(found);
    let s = 1;
    if (found === prev + 1) s += 4;
    const before = found > 0 ? t[found - 1] : '/';
    if (before === '/' || before === '.' || before === '_' || before === '-' || before === ' ') s += 3;
    if (found >= baseStart) s += 2;
    score += s;
    prev = found;
    ti = found + 1;
  }
  const base = t.slice(baseStart);
  if (base.startsWith(q)) score += 10;
  else if (base.includes(q)) score += 6;
  score -= target.length * 0.01;
  return { score, positions };
}
