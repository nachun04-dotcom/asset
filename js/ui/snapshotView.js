// 首页和详情页共用：一张「账页」里各类别的明细行。
import { h } from './dom.js';
import { catDot, deltaSpan } from './fmt.js';
import { formatMoney } from '../core/money.js';
import { hasValue, knownIds, recordedTotal } from '../core/ledger.js';
import { sortedCategories } from '../core/model.js';

/** 一条记录里要展示的类别：应有的 ∪ 有金额的，按类别顺序。 */
export function displayCategories(snap, categories) {
  const ids = new Set([...(snap.expectedIds ?? []), ...knownIds(snap)]);
  return sortedCategories(categories).filter((c) => ids.has(c.id));
}

/**
 * @param cmp compareSnapshots(snap, prev) 的结果（可为 null）
 * @param showTotal 是否显示底部合计行
 */
export function categoryRows({ snap, categories, unit, cmp = null, showTotal = true }) {
  const rows = displayCategories(snap, categories).map((cat) => {
    const e = snap.entries[cat.id];
    if (!hasValue(e)) {
      return h('div', { class: 'leader unknown' }, h('span', { class: 'name' }, catDot(cat), cat.name, cat.enabled ? null : h('span', { class: 'tag' }, '已停用')), h('span', { class: 'dots' }), h('span', { class: 'val' }, '未记录'));
    }
    const d = cmp?.categories?.[cat.id];
    return h(
      'div',
      { class: 'leader' },
      h('span', { class: 'name' }, catDot(cat), cat.name, cat.enabled ? null : h('span', { class: 'tag' }, '已停用')),
      h('span', { class: 'dots' }),
      h('span', { class: 'val' }, formatMoney(e.fen, unit), d && d.fen !== 0 ? h('span', { class: 'sub' }, deltaSpan(d.fen, d.ratio, unit)) : null, e.fx ? h('span', { class: 'sub muted' }, `折算自 ${e.fx.original} ${e.fx.currency}`) : null),
    );
  });
  if (showTotal) {
    const any = knownIds(snap).length > 0;
    if (snap.complete) {
      rows.push(h('div', { class: 'leader total' }, h('span', { class: 'name' }, '合计'), h('span', { class: 'dots' }), h('span', { class: 'val' }, formatMoney(recordedTotal(snap), unit))));
    } else if (any) {
      rows.push(h('div', { class: 'leader total' }, h('span', { class: 'name' }, '已记录合计'), h('span', { class: 'dots' }), h('span', { class: 'val' }, formatMoney(recordedTotal(snap), unit), h('span', { class: 'sub muted' }, '只是已填写部分，不是总资产'))));
    }
  }
  return h('div', { class: 'leaders' }, ...rows);
}
