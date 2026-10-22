// 首页和详情页共用：封面（总资产）+ 账户明细行。
import { h, s as sv } from './dom.js';
import { stamp } from './components.js';
import { catIcon, catSlotClass, deltaSpan, heroAmount } from './fmt.js';
import { formatMoney } from '../core/money.js';
import { hasValue, knownIds, shares } from '../core/ledger.js';
import { groupKey, groupName, sortedCategories } from '../core/model.js';

/**
 * 一条记录里要展示的类别：应有的 ∪ 有金额的，按类别顺序。
 * 已停用、且这条记录里没填金额的不显示（在设置里关掉的账户就不再出现）；有金额的仍显示，否则合计对不上。
 */
export function displayCategories(snap, categories) {
  const known = new Set(knownIds(snap));
  const ids = new Set([...(snap.expectedIds ?? []), ...known]);
  return sortedCategories(categories).filter((c) => ids.has(c.id) && (c.enabled || known.has(c.id)));
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
 * 扭索纹（guilloche）：几十个旋转的椭圆叠成的玫瑰线，像钞票和金属卡上的雕刻底纹。
 * 一大一小两朵，静态矢量，颜色由卡面决定（currentColor）。
 */
export function guilloche() {
  const rosette = (cx, cy, rx, ry, n) => Array.from({ length: n }, (_, i) => sv('ellipse', { cx, cy, rx, ry, transform: `rotate(${(180 / n) * i} ${cx} ${cy})` }));
  return sv(
    'svg',
    { class: 'guilloche', viewBox: '0 0 400 250', preserveAspectRatio: 'xMidYMid slice', 'aria-hidden': 'true', focusable: 'false' },
    sv('g', { fill: 'none', stroke: 'currentColor', 'stroke-width': 0.45 }, ...rosette(372, 236, 230, 92, 44), ...rosette(30, 18, 120, 46, 30)),
  );
}

/**
 * 封面：深色的「存折」卡片，是整个 App 里唯一的视觉焦点。
 * @param change { fen, ratio } 与上一条的变化（可为 null）；changeNote 说明比较对象
 */
export function coverCard({ label, dateText, fen = null, complete = true, unit, change = null, changeNote = null, note = null, bar = null, split = null, owner = null, card = null, minimal = false, ariaLabel }) {
  // 首页用的极简版：居中只放标题、大数字和一行小字（日期 / 实时增长），其余都不放
  if (minimal) {
    const el = h(
      'section',
      { class: 'cover min', 'aria-label': ariaLabel ?? label },
      h('div', { class: 'cover-label' }, label),
      heroAmount(fen, unit),
      h('div', { class: 'cover-meta' }, h('span', { class: 'cover-when' }, dateText)),
    );
    el.prepend(guilloche());
    if (bar) el.appendChild(bar);
    // 左下角：卡号（四位一组），下面一行是持有人和开始记账的年份
    if (card) {
      el.appendChild(
        h(
          'div',
          { class: 'cover-foot' },
          h('div', { class: 'cover-no', 'aria-label': `卡号 ${card.no.join(' ')}` }, ...card.no.map((g) => h('span', {}, g))),
          h('div', { class: 'cover-sub' }, h('b', {}, card.name || 'PRIVATE LEDGER'), h('span', {}, `SINCE ${card.since}`)),
        ),
      );
    }
    el.appendChild(h('span', { class: 'cover-sheen', 'aria-hidden': 'true' }));
    el.appendChild(h('span', { class: 'cover-edge', 'aria-hidden': 'true' }));
    return el;
  }
  const el = h('section', { class: ['cover', !complete && 'partial'], 'aria-label': ariaLabel ?? label },
    guilloche(),
    h('div', { class: 'cover-head' }, h('div', { class: 'cover-label' }, label), fen == null ? null : stamp(complete)),
    h('div', { class: 'cover-date' }, dateText),
    fen == null ? h('div', { class: 'hero dim', 'aria-label': '暂无总资产' }, '—') : heroAmount(fen, unit, { dim: !complete }),
  );
  // 有负债时：大数字是净资产，下面一行写清楚资产和负债各多少
  if (split) el.appendChild(h('div', { class: 'cover-split' }, h('span', {}, '资产 ', h('b', { class: 'mask' }, formatMoney(split.assets, unit))), h('i', { 'aria-hidden': 'true' }), h('span', {}, '负债 ', h('b', { class: 'mask' }, formatMoney(split.debts, unit)))));
  const delta = h('div', { class: 'cover-delta' });
  if (change) delta.appendChild(deltaSpan(change.fen, change.ratio, unit));
  if (changeNote) delta.appendChild(h('span', { class: 'cover-note' }, changeNote));
  if (note) delta.appendChild(note);
  if (delta.childNodes.length) el.appendChild(delta);
  if (bar) el.appendChild(bar);
  // 卡面底部：持有人名字（设置里可填，留空就不显示）
  if (owner) el.appendChild(h('div', { class: 'cover-owner' }, h('span', {}, `PRIVATE LEDGER · SINCE ${owner.since}`), h('b', {}, owner.name)));
  // 卡面光影：倾斜手机时移动的反光层（设置里打开才显示）
  el.appendChild(h('span', { class: 'cover-sheen', 'aria-hidden': 'true' }));
  el.appendChild(h('span', { class: 'cover-edge', 'aria-hidden': 'true' }));
  return el;
}

const shareText = (x) => (x ? `${(x * 100).toFixed(1)}%` : '');

/**
 * 账户明细：一行一个账户——左边名字和较上次的变化，右边金额和占比。
 * @param cmp compareSnapshots(snap, prev) 的结果（可为 null）
 * @param group 同类账户（例如两个支付宝）并成一组：先显示合计，下面缩进列出各账户
 */
export function accountRows({ snap, categories, unit, cmp = null, group = false, only = null }) {
  const sh = new Map(shares(snap).map((x) => [x.id, x.share]));
  const cats = displayCategories(snap, categories).filter((c) => !only || only(c));

  const row = (cat, { child = false, name = cat.name } = {}) => {
    const e = snap.entries[cat.id];
    const tags = [cat.debt ? h('span', { class: 'tag debt' }, '负债') : null, cat.enabled ? null : h('span', { class: 'tag' }, '已停用')];
    if (!hasValue(e)) {
      // 没填的账户：金额位置只放一条细横线，下面一行小字说明，不再用斜体「未记录」占满一行
      return h('div', { class: ['acc', 'unknown', child && 'child'] }, catIcon(cat, categories), h('div', { class: 'acc-main' }, h('div', { class: 'acc-name' }, name, tags), h('div', { class: 'acc-sub' }, h('span', {}, '这次没有填写'))), h('div', { class: 'acc-val' }, h('div', { class: 'v' }, h('span', { class: 'dash', 'aria-label': '未记录' }))));
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
          h('div', { class: 'acc-main' }, h('div', { class: 'acc-name' }, groupName(members[0], categories)), h('div', { class: 'acc-sub' }, dfen ? deltaSpan(dfen, prev ? dfen / Math.abs(prev) : null, unit) : null, h('span', { class: 'fxnote' }, `${members.length} 个账户`))),
          h('div', { class: 'acc-val' }, h('div', { class: 'v num' }, known.length ? formatMoney(sum, unit) : h('span', { class: 'dash', 'aria-label': '未记录' })), share ? h('div', { class: 's num' }, shareText(share)) : null),
        ),
      );
      for (const c of members) rows.push(row(c, { child: true }));
    }
  }
  return h('div', { class: 'accs' }, ...rows);
}
