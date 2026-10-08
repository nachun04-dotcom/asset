// 首页和详情页共用：封面（总资产）+ 账户明细行。
import { h } from './dom.js';
import { stamp } from './components.js';
import { catIcon, catSlotClass, deltaSpan, heroAmount } from './fmt.js';
import { formatMoney } from '../core/money.js';
import { hasValue, knownIds, shares } from '../core/ledger.js';
import { groupKey, sortedCategories } from '../core/model.js';

/** 一条记录里要展示的类别：应有的 ∪ 有金额的，按类别顺序。 */
export function displayCategories(snap, categories) {
  const ids = new Set([...(snap.expectedIds ?? []), ...knownIds(snap)]);
  return sortedCategories(categories).filter((c) => ids.has(c.id));
}

/** 封面里的占比条：一条横带，颜色与下面各账户前的圆点一一对应（数字写在列表里，不在色块里写字）。 */
export function shareBar(snap, categories) {
  const sh = shares(snap);
  if (!sh.length) return null;
  const cats = displayCategories(snap, categories).filter((c) => sh.some((x) => x.id === c.id));
  return h(
    'div',
    { class: 'share-bar', role: 'img', 'aria-label': '各账户占比' },
    ...cats.map((c) => {
      const x = sh.find((y) => y.id === c.id);
      return h('i', { class: catSlotClass(c), style: `flex:${Math.max(x.share, 0.004)}`, title: `${c.name} ${(x.share * 100).toFixed(1)}%` });
    }),
  );
}

/**
 * 封面：深色的「存折」卡片，是整个 App 里唯一的视觉焦点。
 * @param change { fen, ratio } 与上一条的变化（可为 null）；changeNote 说明比较对象
 */
export function coverCard({ label, dateText, fen = null, complete = true, unit, change = null, changeNote = null, note = null, bar = null, ariaLabel }) {
  const el = h('section', { class: ['cover', !complete && 'partial'], 'aria-label': ariaLabel ?? label },
    h('div', { class: 'cover-head' }, h('div', { class: 'cover-label' }, label), fen == null ? null : stamp(complete)),
    h('div', { class: 'cover-date' }, dateText),
    fen == null ? h('div', { class: 'hero dim', 'aria-label': '暂无总资产' }, '—') : heroAmount(fen, unit, { dim: !complete }),
  );
  const delta = h('div', { class: 'cover-delta' });
  if (change) delta.appendChild(deltaSpan(change.fen, change.ratio, unit));
  if (changeNote) delta.appendChild(h('span', { class: 'cover-note' }, changeNote));
  if (note) delta.appendChild(note);
  if (delta.childNodes.length) el.appendChild(delta);
  if (bar) el.appendChild(bar);
  return el;
}

const shareText = (x) => (x ? `${(x * 100).toFixed(1)}%` : '');

/**
 * 账户明细：一行一个账户——左边名字和较上次的变化，右边金额和占比。
 * @param cmp compareSnapshots(snap, prev) 的结果（可为 null）
 * @param group 同类账户（例如两个支付宝）并成一组：先显示合计，下面缩进列出各账户
 */
export function accountRows({ snap, categories, unit, cmp = null, group = false }) {
  const sh = new Map(shares(snap).map((x) => [x.id, x.share]));
  const cats = displayCategories(snap, categories);

  const row = (cat, { child = false, name = cat.name } = {}) => {
    const e = snap.entries[cat.id];
    const tags = cat.enabled ? null : h('span', { class: 'tag' }, '已停用');
    if (!hasValue(e)) {
      return h('div', { class: ['acc', 'unknown', child && 'child'] }, catIcon(cat, categories), h('div', { class: 'acc-main' }, h('div', { class: 'acc-name' }, name, tags)), h('div', { class: 'acc-val' }, h('div', { class: 'v' }, '未记录')));
    }
    const d = cmp?.categories?.[cat.id];
    const sub = [];
    if (d && d.fen !== 0) sub.push(deltaSpan(d.fen, d.ratio, unit));
    if (e.fx) sub.push(h('span', { class: 'fxnote' }, `折算自 ${e.fx.original} ${e.fx.currency}`));
    return h(
      'div',
      { class: ['acc', child && 'child'] },
      catIcon(cat, categories),
      h('div', { class: 'acc-main' }, h('div', { class: 'acc-name' }, name, tags), sub.length ? h('div', { class: 'acc-sub' }, ...sub) : null),
      h('div', { class: 'acc-val' }, h('div', { class: 'v num' }, formatMoney(e.fen, unit)), sh.has(cat.id) ? h('div', { class: 's num' }, shareText(sh.get(cat.id))) : null),
    );
  };

  const rows = [];
  if (!group) {
    for (const c of cats) rows.push(row(c));
  } else {
    const groups = new Map();
    for (const c of cats) {
      const k = groupKey(c);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(c);
    }
    for (const [k, members] of groups) {
      if (members.length === 1) {
        rows.push(row(members[0]));
        continue;
      }
      const root = categories.find((c) => c.id === k) ?? members[0];
      const known = members.filter((c) => hasValue(snap.entries[c.id]));
      const sum = known.reduce((n, c) => n + snap.entries[c.id].fen, 0);
      const share = members.reduce((n, c) => n + (sh.get(c.id) ?? 0), 0);
      const ds = members.map((c) => cmp?.categories?.[c.id]);
      const allCmp = known.length === members.length && ds.every(Boolean);
      const dfen = allCmp ? ds.reduce((n, d) => n + d.fen, 0) : null;
      const prev = allCmp ? sum - dfen : null;
      rows.push(
        h(
          'div',
          { class: 'acc group' },
          catIcon(root, categories),
          h('div', { class: 'acc-main' }, h('div', { class: 'acc-name' }, root.name), h('div', { class: 'acc-sub' }, dfen ? deltaSpan(dfen, prev ? dfen / Math.abs(prev) : null, unit) : null, h('span', { class: 'fxnote' }, `${members.length} 个账户`))),
          h('div', { class: 'acc-val' }, h('div', { class: 'v num' }, known.length ? formatMoney(sum, unit) : '未记录'), share ? h('div', { class: 's num' }, shareText(share)) : null),
        ),
      );
      for (const c of members) rows.push(row(c, { child: true }));
    }
  }
  return h('div', { class: 'accs' }, ...rows);
}
