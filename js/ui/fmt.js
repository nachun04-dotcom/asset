// 界面里的金额 / 变化量展示。
import { formatDecimal, formatMoney, formatPercent, formatSigned } from '../core/money.js';
import { h } from './dom.js';

export const catSlotClass = (cat) => (cat && cat.colorSlot >= 0 && cat.colorSlot < 8 ? `c${cat.colorSlot}` : 'cx');
export const catCss = (cat) => (cat && cat.colorSlot >= 0 && cat.colorSlot < 8 ? `var(--cat-${cat.colorSlot})` : 'var(--cat-x)');

export function catDot(cat) {
  return h('span', { class: `dot ${catSlotClass(cat)}`, 'aria-hidden': 'true' });
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

/** 变化量：始终带 ▲/▼ 与正负号，颜色只是辅助（涨跌配色可在设置里对调）。 */
export function deltaSpan(fen, ratio, unit, { withRatio = true } = {}) {
  if (fen === 0) return h('span', { class: 'chg flat' }, '持平');
  const cls = fen > 0 ? 'up' : 'down';
  return h('span', { class: `chg ${cls}` }, fen > 0 ? '▲ ' : '▼ ', formatSigned(fen, unit), withRatio && ratio != null ? ` (${formatPercent(ratio)})` : '');
}

export function compactYuan(fen) {
  const v = Math.abs(fen) / 100;
  const sign = fen < 0 ? '−' : '';
  const trim = (n, d) => String(Number(n.toFixed(d)));
  if (v >= 1e8) return `${sign}${trim(v / 1e8, 2)}亿`;
  if (v >= 1e4) return `${sign}${trim(v / 1e4, v >= 1e6 ? 0 : 1)}万`;
  return `${sign}${trim(v, 0)}`;
}
