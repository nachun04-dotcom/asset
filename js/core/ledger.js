// 快照账本的纯函数：完整性、总额、对比、图表序列。
import { changeRatio, sumFen } from './money.js';

export function hasValue(entry) {
  return !!entry && Number.isInteger(entry.fen);
}

export function knownIds(snap) {
  return Object.keys(snap.entries).filter((id) => hasValue(snap.entries[id]));
}

/** 已记录金额的合计。对不完整记录，这只是「部分合计」，不是总资产。 */
export function recordedTotal(snap) {
  return sumFen(knownIds(snap).map((id) => snap.entries[id].fen));
}

export function missingIds(snap) {
  return (snap.expectedIds ?? []).filter((id) => !hasValue(snap.entries[id]));
}

export function isComplete(entries, expectedIds) {
  if (!expectedIds || expectedIds.length === 0) return false;
  return expectedIds.every((id) => hasValue(entries[id]));
}

/** 总资产：只有完整记录才有；不完整记录返回 null，绝不拿部分合计冒充。 */
export function totalAssets(snap) {
  return snap.complete ? recordedTotal(snap) : null;
}

/**
 * 由草稿生成可保存的快照。expectedIds 由调用方决定：
 * 新记录 = 当前启用的类别；修改旧记录 = 它原有的 expectedIds ∪ 已有金额的类别。
 */
export function finalizeSnapshot(draft, expectedIds, { now = new Date().toISOString() } = {}) {
  const entries = {};
  for (const [id, e] of Object.entries(draft.entries ?? {})) {
    if (!hasValue(e)) continue;
    entries[id] = { fen: e.fen };
    if (e.fx) entries[id].fx = { currency: e.fx.currency, original: e.fx.original };
  }
  const expected = [...new Set(expectedIds)];
  return {
    id: draft.id,
    date: draft.date,
    note: draft.note ?? '',
    source: draft.source ?? 'manual',
    createdAt: draft.createdAt ?? now,
    updatedAt: now,
    entries,
    expectedIds: expected,
    complete: isComplete(entries, expected),
  };
}

export const byDateAsc = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
export const byDateDesc = (a, b) => byDateAsc(b, a);

export function sortAsc(snaps) {
  return [...snaps].sort(byDateAsc);
}

export function sortDesc(snaps) {
  return [...snaps].sort(byDateDesc);
}

export function findByDate(snaps, date) {
  return snaps.find((s) => s.date === date) ?? null;
}

/** 日期上紧邻的上一条记录（不论是否完整）。 */
export function previousOf(snaps, snap) {
  let best = null;
  for (const s of snaps) if (s.date < snap.date && (!best || s.date > best.date)) best = s;
  return best;
}

export function latestComplete(snaps) {
  let best = null;
  for (const s of snaps) if (s.complete && (!best || s.date > best.date)) best = s;
  return best;
}

export function latestOverall(snaps) {
  let best = null;
  for (const s of snaps) if (!best || s.date > best.date) best = s;
  return best;
}

/** 比 snap 更早的最近一条完整记录。 */
export function previousCompleteOf(snaps, snap) {
  let best = null;
  for (const s of snaps) if (s.complete && s.date < snap.date && (!best || s.date > best.date)) best = s;
  return best;
}

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * 两条记录的对比：
 *  - total：仅当两条都完整才有（basisChanged = 两条记录的类别口径不同）
 *  - partial：任一不完整时，若两条已记录的类别完全相同，才给出「部分合计」变化
 *  - categories：两条都有金额的类别各自的变化
 */
export function compareSnapshots(cur, prev) {
  const categories = {};
  for (const id of knownIds(cur)) {
    if (!hasValue(prev.entries[id])) continue;
    const fen = cur.entries[id].fen - prev.entries[id].fen;
    categories[id] = { fen, ratio: changeRatio(cur.entries[id].fen, prev.entries[id].fen) };
  }
  let total = null;
  let partial = null;
  if (cur.complete && prev.complete) {
    const c = recordedTotal(cur);
    const p = recordedTotal(prev);
    total = { fen: c - p, ratio: changeRatio(c, p), basisChanged: !sameSet(cur.expectedIds, prev.expectedIds) };
  } else {
    const a = knownIds(cur);
    const b = knownIds(prev);
    if (a.length > 0 && sameSet(a, b)) {
      const c = recordedTotal(cur);
      const p = recordedTotal(prev);
      partial = { fen: c - p, ratio: changeRatio(c, p), ids: a };
    }
  }
  return { total, partial, categories };
}

/** 总额趋势：默认只含完整记录；includePartial 时不完整记录以 complete:false 的点加入。 */
export function totalSeries(snaps, { includePartial = false } = {}) {
  return sortAsc(snaps)
    .filter((s) => s.complete || (includePartial && knownIds(s).length > 0))
    .map((s) => ({ date: s.date, fen: recordedTotal(s), complete: s.complete, id: s.id }));
}

/** 某类别的变化趋势：只取有金额的记录；未记录的日期不画点，也不当作 0。 */
export function categorySeries(snaps, categoryId) {
  return sortAsc(snaps)
    .filter((s) => hasValue(s.entries[categoryId]))
    .map((s) => ({ date: s.date, fen: s.entries[categoryId].fen, id: s.id }));
}

/** 各已记录类别占已记录合计的比例（仅正数参与占比）。 */
export function shares(snap) {
  const ids = knownIds(snap).filter((id) => snap.entries[id].fen > 0);
  const total = sumFen(ids.map((id) => snap.entries[id].fen));
  return ids.map((id) => ({ id, fen: snap.entries[id].fen, share: total > 0 ? snap.entries[id].fen / total : 0 }));
}

export function dateRange(snaps) {
  if (snaps.length === 0) return null;
  const s = sortAsc(snaps);
  return { from: s[0].date, to: s[s.length - 1].date };
}
