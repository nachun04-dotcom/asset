// 首页的「洞察」组件：阶段变化、资产配置环形图、财富目标、月度变化柱状图；历史页共用的月末汇总。
// 只读数据、不改任何记录。金额隐藏（隐私模式）由样式统一处理：需要遮挡的数字都带 .mask 类。
import { h, s, icon } from './dom.js';
import { promptDialog, toast } from './components.js';
import { catCss, compactYuan } from './fmt.js';
import { groupKey, sortedCategories } from '../core/model.js';
import { shares, totalSeries } from '../core/ledger.js';
import { changeRatio, formatDecimal, formatMoney, formatPercent, formatSigned, parseAmount } from '../core/money.js';

/* ------------------------------ 纯函数 ------------------------------ */

/** 每个月最后一条完整记录：[{ month:'2026-09', date, fen }]，按月份升序。 */
export function monthEnds(snaps) {
  const map = new Map();
  for (const p of totalSeries(snaps)) map.set(p.date.slice(0, 7), p);
  return [...map.entries()].map(([month, p]) => ({ month, date: p.date, fen: p.fen }));
}

/** 月末之间的变化：[{ month, fen, prev, delta, ratio }]，第一个有月末数的月份没有比较对象，不列入。 */
export function monthlyChanges(snaps) {
  const ends = monthEnds(snaps);
  return ends.slice(1).map((m, i) => ({ month: m.month, date: m.date, fen: m.fen, prev: ends[i], delta: m.fen - ends[i].fen, ratio: changeRatio(m.fen, ends[i].fen) }));
}

/** 阶段统计：较上月末、今年以来、历史最高。以最近一条完整记录为「现在」。 */
export function periodStats(snaps) {
  const pts = totalSeries(snaps);
  if (!pts.length) return null;
  const last = pts[pts.length - 1];
  const before = (d) => {
    for (let i = pts.length - 1; i >= 0; i--) if (pts[i].date < d) return pts[i];
    return null;
  };
  const mBase = before(`${last.date.slice(0, 7)}-01`);
  let yBase = before(`${last.date.slice(0, 4)}-01-01`);
  let yLabel = '较去年末';
  if (!yBase) {
    yBase = pts.find((p) => p.date.slice(0, 4) === last.date.slice(0, 4));
    yLabel = '今年以来';
    if (yBase === last) yBase = null;
  }
  let peak = pts[0];
  for (const p of pts) if (p.fen >= peak.fen) peak = p;
  const mk = (base) => (base ? { base, delta: last.fen - base.fen, ratio: changeRatio(last.fen, base.fen) } : null);
  return { last, month: mk(mBase), year: mk(yBase), yLabel, peak, isPeak: peak === last, drawdown: peak.fen > 0 ? (last.fen - peak.fen) / peak.fen : null };
}

/* ------------------------------ 小部件 ------------------------------ */

const signedCompact = (fen) => (fen === 0 ? '0' : `${fen > 0 ? '+' : '−'}${compactYuan(Math.abs(fen))}`);
const dir = (fen) => (fen > 0 ? 'up' : fen < 0 ? 'down' : 'flat');

function tile(label, main, sub, cls = '') {
  return h('div', { class: 'kpi' }, h('div', { class: 'k' }, label), h('div', { class: ['v', 'num', 'mask', cls] }, main), h('div', { class: 'd' }, sub));
}

/** 封面下方的三格阶段统计。 */
export function kpiRow(snaps) {
  const st = periodStats(snaps);
  if (!st) return null;
  const chg = (x) => (x ? [h('i', { class: 'tri', 'aria-hidden': 'true' }), signedCompact(x.delta)] : '—');
  const pct = (x, fallback) => (x ? h('span', { class: `chg ${dir(x.delta)}` }, formatPercent(x.ratio)) : h('span', {}, fallback));
  return h(
    'div',
    { class: 'kpis', role: 'group', 'aria-label': '阶段变化' },
    tile('较上月末', chg(st.month), pct(st.month, '上月无记录'), st.month ? `chg ${dir(st.month.delta)}` : 'flat'),
    tile(st.yLabel, chg(st.year), pct(st.year, '暂无比较'), st.year ? `chg ${dir(st.year.delta)}` : 'flat'),
    tile('历史最高', compactYuan(st.peak.fen), st.isPeak ? h('span', { class: 'peak' }, '◆ 当前即新高') : h('span', {}, `回撤 ${formatPercent(st.drawdown)}`)),
  );
}

/** 资产配置：环形图 + 图例（按占比从大到小）。 */
export function allocation(snap, categories) {
  const sh = shares(snap);
  if (sh.length < 1) return null;
  const byId = new Map(categories.map((c) => [c.id, c]));
  const order = new Map(sortedCategories(categories).map((c, i) => [c.id, i]));
  const items = sh.map((x) => ({ ...x, cat: byId.get(x.id) })).filter((x) => x.cat).sort((a, b) => b.share - a.share || order.get(a.id) - order.get(b.id));
  const size = 132;
  const r = 52;
  const C = 2 * Math.PI * r;
  const gap = items.length > 1 ? 2.2 : 0;
  const ring = s('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, class: 'donut', role: 'img', 'aria-label': `资产配置：${items.map((x) => `${x.cat.name} ${(x.share * 100).toFixed(1)}%`).join('，')}` });
  ring.appendChild(s('circle', { cx: size / 2, cy: size / 2, r, class: 'track' }));
  let acc = 0;
  for (const x of items) {
    const len = Math.max(0, x.share * C - gap);
    ring.appendChild(s('circle', { cx: size / 2, cy: size / 2, r, class: 'seg', style: `stroke:${catCss(x.cat)}`, 'stroke-dasharray': `${len.toFixed(2)} ${(C - len).toFixed(2)}`, 'stroke-dashoffset': (-acc * C).toFixed(2), transform: `rotate(-90 ${size / 2} ${size / 2})` }));
    acc += x.share;
  }
  const top = items[0];
  const center = h('div', { class: 'donut-c' }, h('div', { class: 'p num' }, (top.share * 100).toFixed(1), h('small', {}, '%')), h('div', { class: 'n' }, top.cat.name));
  const shown = items.slice(0, 5);
  const rest = items.slice(5);
  const legend = h(
    'div',
    { class: 'alloc-legend' },
    ...shown.map((x) => h('div', { class: 'li' }, h('i', { style: `background:${catCss(x.cat)}` }), h('span', { class: 'nm' }, x.cat.name), h('span', { class: 'pc num' }, `${(x.share * 100).toFixed(1)}%`))),
    rest.length ? h('div', { class: 'li' }, h('i', { style: 'background:var(--cat-x)' }), h('span', { class: 'nm' }, `其他 ${rest.length} 项`), h('span', { class: 'pc num' }, `${(rest.reduce((n, x) => n + x.share, 0) * 100).toFixed(1)}%`)) : null,
  );
  const groups = new Set(items.map((x) => groupKey(x.cat))).size;
  const top3 = items.slice(0, 3).reduce((n, x) => n + x.share, 0);
  return h(
    'div',
    { class: 'alloc' },
    h('div', { class: 'alloc-main' }, h('div', { class: 'donut-wrap' }, ring, center), legend),
    h('div', { class: 'alloc-foot' }, h('span', {}, `${groups} 类资产 · ${items.length} 个账户`), items.length > 3 ? h('span', {}, `前三项合计 ${(top3 * 100).toFixed(1)}%`) : null),
  );
}

/** 设定 / 修改财富目标（以当前显示单位输入；留空即取消目标）。 */
export async function editGoal(store) {
  const { unit, goalFen } = store.state.settings;
  const unitName = unit === 'wan' ? '万元' : '元';
  const text = await promptDialog({
    title: goalFen ? '修改财富目标' : '设定财富目标',
    message: `以「${unitName}」填写。首页会显示达成进度；留空可取消目标。`,
    placeholder: unit === 'wan' ? '例如 300' : '例如 3000000',
    value: goalFen ? formatDecimal(goalFen, unit, { group: false, minDecimals: 0 }) : '',
    confirmText: '保存',
    validate: (t) => {
      const r = parseAmount(t, unit);
      if (!r.ok) return '请输入有效的金额';
      if (!r.empty && r.fen <= 0) return '目标需要大于 0';
      return '';
    },
  });
  if (text == null) return;
  const r = parseAmount(text, unit);
  const res = await store.updateSettings({ goalFen: r.empty ? null : r.fen });
  if (!res.ok) return toast(res.message);
  toast(r.empty ? '已取消财富目标' : `目标已设为 ${formatMoney(r.fen, unit)}`);
}

/** 封面底部：财富目标进度（没有目标时是一个轻量的入口）。 */
export function goalBlock(store, totalFen) {
  const { goalFen, unit } = store.state.settings;
  const open = () => editGoal(store);
  if (!goalFen) {
    return h('button', { type: 'button', class: 'goal-set', onClick: open }, icon('target', { size: 15 }), '设定财富目标', icon('chevronR', { size: 14 }));
  }
  const p = totalFen / goalFen;
  const done = p >= 1;
  return h(
    'button',
    { type: 'button', class: ['goal', done && 'done'], onClick: open, 'aria-label': `财富目标 ${formatMoney(goalFen, unit)}，已达成 ${(p * 100).toFixed(1)}%，点按可修改` },
    h('div', { class: 'goal-row' }, h('span', { class: 'gl' }, icon('target', { size: 14 }), '目标 ', h('b', { class: 'mask' }, compactYuan(goalFen))), h('span', { class: 'gp num' }, `${Math.min(999.9, p * 100).toFixed(1)}%`)),
    h('div', { class: 'goal-track' }, h('i', { style: `width:${Math.max(1.5, Math.min(100, p * 100)).toFixed(2)}%` })),
    h('div', { class: 'goal-note' }, done ? '已达成目标，可以设一个更高的了' : h('span', {}, '还差 ', h('span', { class: 'mask' }, formatMoney(goalFen - totalFen, unit)))),
  );
}

/** 月度变化：最近 12 个月的月末变化柱状图；点按柱子查看该月详情。 */
export function monthlyBars(snaps, unit) {
  const all = monthlyChanges(snaps);
  if (all.length < 1) return null;
  const data = all.slice(-12);
  const W = 340;
  const H = 150;
  const top = 12;
  const bottom = 24;
  const plotH = H - top - bottom;
  // 零线按正负两侧的最大值分配高度，只涨或只跌时零线贴边
  const maxPos = Math.max(0, ...data.map((d) => d.delta));
  const maxNeg = Math.max(0, ...data.map((d) => -d.delta));
  const span = Math.max(1, maxPos + maxNeg);
  const zeroY = top + plotH * (maxPos / span);
  const scale = plotH / span;
  const slot = W / data.length;
  const bw = Math.min(22, slot * 0.52);
  const caption = h('div', { class: 'mb-cap' });
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'mbars', role: 'img', 'aria-label': `月度变化：${data.map((d) => `${Number(d.month.slice(5))}月 ${formatSigned(d.delta, unit)}`).join('，')}` });
  svg.appendChild(s('line', { x1: 0, x2: W, y1: zeroY, y2: zeroY, class: 'zero' }));
  const bars = [];
  const show = (i) => {
    const d = data[i];
    bars.forEach((b, j) => b.classList.toggle('on', j === i));
    caption.replaceChildren(
      h('span', { class: 'm' }, `${d.month.slice(0, 4)} 年 ${Number(d.month.slice(5))} 月`),
      h('span', { class: `chg ${dir(d.delta)} mask` }, h('i', { class: 'tri', 'aria-hidden': 'true' }), formatSigned(d.delta, unit), h('span', { class: 'pct' }, ` ${formatPercent(d.ratio)}`)),
      h('span', { class: 'b' }, `月末 `, h('span', { class: 'mask' }, formatMoney(d.fen, unit))),
    );
  };
  data.forEach((d, i) => {
    const hgt = Math.max(1.5, Math.abs(d.delta) * scale);
    const x = slot * i + (slot - bw) / 2;
    const y = d.delta >= 0 ? zeroY - hgt : zeroY;
    const g = s('g', { class: `bar ${dir(d.delta)}` });
    g.appendChild(s('rect', { x: slot * i, y: 0, width: slot, height: H, fill: 'transparent' }));
    g.appendChild(s('rect', { x, y, width: bw, height: hgt, rx: Math.min(4, bw / 3), class: 'b' }));
    g.appendChild(s('text', { x: slot * i + slot / 2, y: H - 6, 'text-anchor': 'middle' }, `${Number(d.month.slice(5))}月`));
    g.addEventListener('pointerdown', () => show(i));
    g.addEventListener('pointerenter', () => show(i));
    bars.push(g);
    svg.appendChild(g);
  });
  show(data.length - 1);
  const up = data.filter((d) => d.delta > 0).length;
  return h('div', { class: 'plate mb' }, caption, svg, h('div', { class: 'mb-foot' }, `近 ${data.length} 个月：${up} 个月增长，${data.length - up} 个月回落或持平`));
}
