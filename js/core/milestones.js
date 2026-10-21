// 财富里程碑：净资产第一次跨过整数关口（10 万、50 万、100 万……）的日子。全部由记录推算，不另外保存。
import { totalSeries } from './ledger.js';
import { dayDiff } from './date.js';

const WAN = 1_000_000; // 1 万元 = 1,000,000 分

/** 从小到大的关口，一直列到 limit（分）以上一个。 */
export function milestoneSteps(limit) {
  const out = [10, 30, 50].map((w) => w * WAN);
  for (let w = 100; w <= 1000; w += 100) out.push(w * WAN); // 100 万 ~ 1000 万：每 100 万
  for (let w = 1500; w <= 5000; w += w < 2000 ? 500 : 1000) out.push(w * WAN); // 1500 万、2000 万、3000 万……5000 万
  for (let w = 10000; out[out.length - 1] <= limit; w += 10000) out.push(w * WAN); // 1 亿起每 1 亿
  return out;
}

/**
 * 已达成的里程碑：按日期顺序，记下每个关口第一次达到的那条完整记录。
 * 跌回去再涨上来不重复算。返回 [{ fen: 关口, date, total: 当天净资产, days: 距第一条记录的天数 }]。
 */
export function reachedMilestones(snaps) {
  const pts = totalSeries(snaps);
  if (!pts.length) return [];
  const peak = Math.max(...pts.map((p) => p.fen));
  const steps = milestoneSteps(peak);
  const out = [];
  let k = 0;
  for (const p of pts) {
    while (k < steps.length && p.fen >= steps[k]) {
      out.push({ fen: steps[k], date: p.date, total: p.fen, days: dayDiff(pts[0].date, p.date) });
      k++;
    }
  }
  return out;
}

/** 下一个关口和还差多少（以最近一条完整记录为准）。 */
export function nextMilestone(snaps) {
  const pts = totalSeries(snaps);
  if (!pts.length) return null;
  const last = pts[pts.length - 1].fen;
  const peak = Math.max(...pts.map((p) => p.fen));
  const reached = new Set(reachedMilestones(snaps).map((m) => m.fen));
  const fen = milestoneSteps(Math.max(peak, last)).find((s) => !reached.has(s) && s > 0);
  if (!fen) return null;
  const prev = [...reached].filter((s) => s < fen).pop() ?? 0;
  return { fen, gap: fen - last, progress: Math.max(0, Math.min(1, (last - prev) / (fen - prev))) };
}

/**
 * 保存一条记录后，是否刚好在这条记录上跨过新关口（只认最新的那条完整记录，补记旧日子不庆祝）。
 * 返回最高的那个新关口，没有则 null。
 */
export function freshMilestone(before, after, snap) {
  if (!snap?.complete) return null;
  const latest = totalSeries(after).pop();
  if (!latest || latest.id !== snap.id) return null;
  const had = new Set(reachedMilestones(before).map((m) => m.fen));
  const fresh = reachedMilestones(after).filter((m) => !had.has(m.fen) && m.date === snap.date);
  return fresh.length ? fresh[fresh.length - 1] : null;
}

/** 关口的叫法：100 万、1500 万、1 亿、1.5 亿。 */
export function milestoneName(fen) {
  const w = fen / WAN;
  if (w >= 10000) return `${Number((w / 10000).toFixed(2))} 亿`;
  return `${w} 万`;
}
