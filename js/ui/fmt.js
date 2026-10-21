// 界面里的金额 / 变化量展示。
import { formatDecimal, formatMoney, formatPercent, formatSigned } from '../core/money.js';
import { iconKeyFor } from '../core/model.js';
import { h, icon, s } from './dom.js';
import { ICONSET } from './iconset.js';

/**
 * 类别图标的图形：新图标库（l- 线条 / b- 品牌）优先，旧的简写键名用原来的图标；找不到时退回钱包。
 * 品牌图标是实心剪影，线条图标是描边，都跟随 currentColor（也就是类别色）。
 */
export function iconGlyph(key, { size = 22, stroke = 1.7 } = {}) {
  const spec = ICONSET[key];
  if (!spec) {
    try {
      return icon(key, { size, stroke });
    } catch {
      return icon('wallet', { size, stroke });
    }
  }
  const attrs = spec.line
    ? { fill: 'none', stroke: 'currentColor', 'stroke-width': stroke, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }
    : { fill: 'currentColor', stroke: 'none' };
  return s('svg', { viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': 'true', focusable: 'false', class: spec.line ? 'gl-line' : 'gl-brand', ...attrs }, ...spec.els.map(([tag, a]) => s(tag, a)));
}

export const catSlotClass = (cat) => (cat && cat.colorSlot >= 0 && cat.colorSlot < 8 ? `c${cat.colorSlot}` : 'cx');
export const catCss = (cat) => (cat && cat.colorSlot >= 0 && cat.colorSlot < 8 ? `var(--cat-${cat.colorSlot})` : 'var(--cat-x)');

export function catDot(cat) {
  return h('span', { class: `dot ${catSlotClass(cat)}`, 'aria-hidden': 'true' });
}

/** 类别图标：淡色圆底 + 类别色的图形，颜色跟着类别固定；同类账户沿用「根」账户的图标。 */
export function catIcon(cat, categories = [], { size = 32, key = null } = {}) {
  const glyph = Math.round(size * 0.56);
  return h('span', { class: `cat-ico ${catSlotClass(cat)}`, style: `--sz:${size}px`, 'aria-hidden': 'true' }, iconGlyph(key ?? iconKeyFor(cat, categories), { size: glyph, stroke: 1.7 }));
}

/** 首页大数字：货币符号与小数部分缩小，整数部分最醒目。 */
export function heroAmount(fen, unit, { dim = false } = {}) {
  const text = formatDecimal(Math.abs(fen), unit);
  const [int, dec] = text.split('.');
  return h(
    'div',
    { class: ['hero', dim && 'dim'], 'aria-label': formatMoney(fen, unit) },
    fen < 0 ? '−' : '',
    h('span', { class: 'cur' }, '¥'),
    int,
    dec ? h('span', { class: 'dec' }, `.${dec}`) : null,
    unit === 'wan' ? h('span', { class: 'suf' }, '万') : null,
  );
}

/** 变化量：始终带三角与正负号，颜色只是辅助（涨跌配色可在设置里对调）。 */
export function deltaSpan(fen, ratio, unit, { withRatio = true } = {}) {
  if (fen === 0) return h('span', { class: 'chg flat' }, '持平');
  const cls = fen > 0 ? 'up' : 'down';
  return h('span', { class: `chg ${cls}` }, h('i', { class: 'tri', 'aria-hidden': 'true' }), formatSigned(fen, unit), withRatio && ratio != null ? h('span', { class: 'pct' }, ` ${formatPercent(ratio)}`) : null);
}

export function compactYuan(fen) {
  const v = Math.abs(fen) / 100;
  const sign = fen < 0 ? '−' : '';
  const trim = (n, d) => String(Number(n.toFixed(d)));
  if (v >= 1e8) return `${sign}${trim(v / 1e8, 2)}亿`;
  if (v >= 1e4) return `${sign}${trim(v / 1e4, v >= 1e6 ? 0 : v >= 1e5 ? 1 : 2)}万`;
  return `${sign}${Math.round(v).toLocaleString('en-US')}`;
}

/**
 * 坐标轴刻度标签：整组一起排版，保证相邻刻度不会显示成一样的字（例如都是「1.5万」）。
 * 先试「万」，小数位从 0 逐步加到 3；还是区分不开就直接写完整的元。
 */
export function axisLabels(fens) {
  const yuan = fens.map((f) => f / 100);
  const max = Math.max(0, ...yuan.map((v) => Math.abs(v)));
  const sign = (v) => (v < 0 ? '−' : '');
  const distinct = (arr) => new Set(arr).size === arr.length;
  const trim = (n, d) => String(Number(n.toFixed(d)));
  const tries = max >= 1e8 ? [[1e8, '亿']] : [];
  if (max >= 1e4) tries.push([1e4, '万']);
  for (const [div, suffix] of tries) {
    for (let d = 0; d <= 3; d++) {
      const labels = yuan.map((v) => (v === 0 ? '0' : `${sign(v)}${trim(Math.abs(v) / div, d)}${suffix}`));
      if (distinct(labels)) return labels;
    }
  }
  for (const d of [0, 2]) {
    const labels = yuan.map((v) => (v === 0 ? '0' : `${sign(v)}${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`));
    if (distinct(labels) || d === 2) return labels;
  }
  return yuan.map(String);
}
