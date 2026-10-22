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

/**
 * 大数字一行的宽度（以字号为单位）：数字 0.52、逗号小数点 0.28（Didot 实测），小数部分是半号字，加上 ¥ 和「万」。
 * CSS 用它算出刚好放得下一行的字号——数字永远不折行，滚动、实时增长时卡片高度也不会跳。
 */
export function heroWidth(int, dec, unit) {
  const w = (t) => [...t].reduce((n, c) => n + (c >= '0' && c <= '9' ? 0.52 : 0.28), 0);
  return w(int) + (dec ? 0.5 * w(`.${dec}`) : 0) + 0.36 + (unit === 'wan' ? 0.45 : 0) + 0.08;
}

/** 开屏卡片正飞向首页时，首页的欢迎动画往后推这么久（毫秒），等卡片落定再开始。 */
export const splashDelay = () => (typeof document !== 'undefined' && document.getElementById('splash') ? 900 : 0);

/**
 * 按实际渲染宽度把大数字缩到刚好放进卡片一行（字体、机型不同也不会超框）。
 * 在挂到页面后、浏览器画出来之前同步调用，不会看到先大后小的跳动。
 * 流光风格在从 0 数上来的途中不量（那时数字还短），翻牌 / 滚轮一开始就是最终的位数。
 */
export function fitHero(hero) {
  if (!hero?.isConnected || (hero.classList.contains('counting') && !hero.classList.contains('board'))) return;
  hero.style.fontSize = '';
  const card = hero.parentElement;
  const cs = getComputedStyle(card);
  const avail = card.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const r = document.createRange();
  r.selectNodeContents(hero);
  const need = r.getBoundingClientRect().width;
  if (avail > 0 && need > avail) hero.style.fontSize = `${((parseFloat(getComputedStyle(hero).fontSize) * avail) / need) * 0.98}px`;
}

/** 首页大数字：货币符号与小数部分缩小，整数部分最醒目。 */
export function heroAmount(fen, unit, { dim = false } = {}) {
  const text = formatDecimal(Math.abs(fen), unit);
  const [int, dec] = text.split('.');
  return h(
    'div',
    { class: ['hero', dim && 'dim'], 'aria-label': formatMoney(fen, unit), style: `--w:${heroWidth(int, dec, unit).toFixed(2)}` },
    fen < 0 ? '−' : '',
    h('span', { class: 'cur' }, '¥'),
    h('span', { class: 'int' }, int),
    dec ? h('span', { class: 'dec' }, `.${dec}`) : null,
    unit === 'wan' ? h('span', { class: 'suf' }, '万') : null,
  );
}

/**
 * 一束光沿着卡片内圈的金线走一圈后隐去（像灯光掠过金属卡的包边），只亮金线，不盖住数字。
 * 一层细的亮线 + 一层模糊的光晕。inset / radius：金线离卡边的距离和圆角。
 */
export function glint(card, { inset = 8, radius = 19, dur = 2200 } = {}) {
  if (!card || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  card.querySelectorAll(':scope > .trace').forEach((t) => t.remove());
  const style = `--ti:${inset}px;--tr:${radius}px;--td:${dur}ms`;
  const glow = h('span', { class: 'trace glow', style, 'aria-hidden': 'true' }, h('i'));
  const line = h('span', { class: 'trace', style, 'aria-hidden': 'true' }, h('i'));
  line.addEventListener('animationend', (e) => {
    if (e.target !== line) return;
    glow.remove();
    line.remove();
  });
  card.append(glow, line);
}

/**
 * 首页欢迎动画：大数字从 0 一路滚到总额（先快后慢，约 1.4 秒），落定后一束光沿金线走一圈。
 * 隐藏金额或系统要求减弱动态效果时不播放。
 */
export function animateHero(hero, fen, unit) {
  if (!hero || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const intEl = hero.querySelector('.int');
  const decEl = hero.querySelector('.dec');
  if (!intEl) return;
  const target = Math.abs(fen);
  const paint = (v) => {
    const [i, d] = (hero.classList.contains('live') ? liveParts(v, unit) : formatDecimal(v, unit, { minDecimals: decEl ? 2 : 0 }).split('.'));
    intEl.textContent = i;
    if (decEl) decEl.textContent = d ? `.${d}` : '';
  };
  const finalInt = intEl.textContent;
  const finalDec = decEl?.textContent;
  const done = () => {
    intEl.textContent = finalInt;
    if (decEl) decEl.textContent = finalDec;
    if (!hero.classList.contains('counting')) return;
    hero.classList.remove('counting');
    fitHero(hero);
    glint(hero.closest('.cover'));
  };
  hero.classList.add('counting');
  const delay = splashDelay();
  const t0 = performance.now() + delay;
  const dur = 1400;
  const step = (now) => {
    const p = Math.max(0, Math.min(1, (now - t0) / dur));
    if (p >= 1) return done();
    paint(Math.round(target * (1 - 2 ** (-10 * p))));
    hero._raf = requestAnimationFrame(step);
  };
  paint(0);
  hero._raf = requestAnimationFrame(step);
  setTimeout(() => {
    cancelAnimationFrame(hero._raf);
    done();
  }, dur + 200 + delay); // 动画帧被暂停（切到后台）时也保证最后是准确的数
}

/** 实时估算的金额拆成整数和小数：万元时显示到元（四位小数），每秒的增长才看得见。 */
export function liveParts(fen, unit) {
  const text = unit === 'wan' ? formatDecimal(Math.round(fen / 100) * 100, 'wan', { minDecimals: 4 }) : formatDecimal(fen, unit, { minDecimals: 2 });
  return text.split('.');
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
