// 异常提示：只提示、不修改任何数据。
import { formatMoney, formatPercent, formatSigned } from './money.js';
import { compareSnapshots, hasValue, missingIds, previousOf, recordedTotal } from './ledger.js';

/**
 * 检查一条快照。ctx = { categories, snaps（含该快照所在的整本账本）, unit, thresholdPct }
 * 返回 [{code, level:'warn'|'info', text, categoryId?}]
 */
export function checkSnapshot(snap, ctx) {
  const { categories, snaps, unit = 'yuan', thresholdPct = 20 } = ctx;
  const name = (id) => categories.find((c) => c.id === id)?.name ?? '（已删除的类别）';
  const issues = [];

  const missing = missingIds(snap);
  if (missing.length > 0) {
    issues.push({
      code: 'INCOMPLETE',
      level: 'warn',
      text: `缺少 ${missing.map(name).join('、')} 的金额，这条记录不计入总资产`,
    });
  }
  for (const [id, e] of Object.entries(snap.entries)) {
    if (hasValue(e) && e.fen < 0) {
      issues.push({ code: 'NEGATIVE', level: 'info', text: `${name(id)} 是负数，请确认`, categoryId: id });
    }
  }

  const prev = previousOf(snaps, snap);
  if (prev) {
    const th = thresholdPct / 100;
    const cmp = compareSnapshots(snap, prev);
    if (cmp.total && cmp.total.ratio != null && Math.abs(cmp.total.ratio) >= th) {
      issues.push({
        code: 'BIG_TOTAL_CHANGE',
        level: 'warn',
        text: `总资产较上一条记录（${prev.date}）变化 ${formatSigned(cmp.total.fen, unit)}（${formatPercent(cmp.total.ratio)}），请检查`,
      });
    }
    // 单个类别：变化量超过「上一条合计 × 阈值」才提示，避免小额类别的百分比噪音。
    const base = Math.max(Math.abs(recordedTotal(prev)), 1);
    for (const [id, d] of Object.entries(cmp.categories)) {
      if (Math.abs(d.fen) >= base * th) {
        issues.push({
          code: 'BIG_CATEGORY_CHANGE',
          level: 'warn',
          categoryId: id,
          text: `${name(id)} 较上一条记录变化 ${formatSigned(d.fen, unit)}${d.ratio != null ? `（${formatPercent(d.ratio)}）` : ''}，请检查`,
        });
      }
    }
  }
  return issues;
}

export function describeAmount(fen, unit) {
  return formatMoney(fen, unit);
}
