// 账单报告：某个月 / 某一年的净资产变化、各账户的贡献、记账次数。只读记录，不改数据。
import { compareSnapshots, recordedTotal, sortAsc } from './ledger.js';
import { changeRatio } from './money.js';
import { dayDiff } from './date.js';

const pad = (n) => String(n).padStart(2, '0');
const monthEnd = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${pad(new Date(y, m, 0).getDate())}`;
};

/** 期间的起止日期。period：'2026-09'（月）或 '2026'（年）。 */
export function periodRange(period) {
  return period.length === 4 ? { from: `${period}-01-01`, to: `${period}-12-31` } : { from: `${period}-01`, to: monthEnd(period) };
}

/** 上一个 / 下一个期间。 */
export function shiftPeriod(period, n) {
  if (period.length === 4) return String(Number(period) + n);
  const [y, m] = period.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** 有完整记录的期间（月或年），从新到旧。 */
export function reportPeriods(snaps, kind) {
  const set = new Set(snaps.filter((s) => s.complete).map((s) => (kind === 'year' ? s.date.slice(0, 4) : s.date.slice(0, 7))));
  return [...set].sort().reverse();
}

/**
 * 一个期间的报告。
 *  start：期初＝期间开始前最后一条完整记录（没有就用期间内第一条）；end：期间内最后一条完整记录。
 *  movers：各账户在期初和期末之间的变化，从涨得最多到跌得最多（负债账户欠款减少算「涨」）。
 *  months：年报里每个月的月末变化。
 */
export function buildReport(snaps, period) {
  const { from, to } = periodRange(period);
  const comp = sortAsc(snaps).filter((s) => s.complete);
  const inside = comp.filter((s) => s.date >= from && s.date <= to);
  if (!inside.length) return null;
  const end = inside[inside.length - 1];
  const before = comp.filter((s) => s.date < from);
  const start = before.length ? before[before.length - 1] : inside[0] !== end ? inside[0] : null;
  const endFen = recordedTotal(end);
  const startFen = start ? recordedTotal(start) : null;
  const totals = inside.map((s) => ({ date: s.date, fen: recordedTotal(s) }));
  const high = totals.reduce((a, b) => (b.fen > a.fen ? b : a));
  const low = totals.reduce((a, b) => (b.fen < a.fen ? b : a));
  const cmp = start ? compareSnapshots(end, start) : null;
  const movers = cmp ? Object.entries(cmp.categories).map(([id, d]) => ({ id, fen: d.fen, ratio: d.ratio })).filter((m) => m.fen !== 0).sort((a, b) => b.fen - a.fen) : [];

  let months = null;
  if (period.length === 4) {
    months = [];
    let prev = startFen;
    for (let m = 1; m <= 12; m++) {
      const ym = `${period}-${pad(m)}`;
      const last = inside.filter((s) => s.date.startsWith(ym)).pop();
      if (!last) {
        months.push({ month: ym, fen: null, delta: null });
        continue;
      }
      const fen = recordedTotal(last);
      // 期初就在这个月（没有更早的记录）且月末就是期初那条：这个月没有可比的变化
      months.push({ month: ym, fen, delta: prev == null || last === start ? null : fen - prev });
      prev = fen;
    }
  }

  return {
    period,
    kind: period.length === 4 ? 'year' : 'month',
    start: start ? { date: start.date, fen: startFen, inside: start.date >= from } : null,
    end: { date: end.date, fen: endFen, snap: end },
    delta: startFen == null ? null : endFen - startFen,
    ratio: startFen == null ? null : changeRatio(endFen, startFen),
    days: start ? dayDiff(start.date, end.date) : 0,
    count: snaps.filter((s) => s.date >= from && s.date <= to).length,
    high,
    low,
    movers,
    months,
  };
}
