// 首页净资产的实时增长，三套风格：
//  流光 glow —— 整串数字每秒安静地更新；
//  翻牌 flip —— 像机场航班牌，每个数字一块牌，变的那一格上半片翻下来；
//  滚轮 roll —— 像机械里程表，每个数字是一圈滚轮，向上滚到新数字。
import { h } from './dom.js';
import { animateHero, fitHero, glint, heroWidth, liveParts, splashDelay } from './fmt.js';

export const LIVE_STYLES = [
  { value: 'glow', label: '流光', desc: '数字安静地平滑更新' },
  { value: 'flip', label: '翻牌', desc: '像机场航班牌，逐格翻动' },
  { value: 'roll', label: '滚轮', desc: '像机械里程表，数字向上滚动' },
];
export const liveStyleOf = (settings) => (LIVE_STYLES.some((s) => s.value === settings.liveStyle) ? settings.liveStyle : 'glow');

const isDigit = (c) => c >= '0' && c <= '9';
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------ 翻牌 ------------------------------ */

function flipCell(ch) {
  const top = h('span', { class: 'fl-top' }, ch);
  const bot = h('span', { class: 'fl-bot' }, ch);
  const el = h('span', { class: 'fl' }, top, bot);
  let cur = ch;
  let chain = Promise.resolve();
  // 翻一次：旧数字的上半片向下翻倒，新数字的下半片接着落下
  const once = (next, dur) =>
    new Promise((done) => {
      if (next === cur) return done();
      const a = h('span', { class: 'fl-top leaf-a', style: `animation-duration:${dur / 2}ms` }, cur);
      const b = h('span', { class: 'fl-bot leaf-b', style: `animation-duration:${dur / 2}ms;animation-delay:${dur / 2}ms` }, next);
      top.textContent = next;
      el.append(a, b);
      cur = next;
      setTimeout(() => {
        bot.textContent = next;
        a.remove();
        b.remove();
        done();
      }, dur + 20);
    });
  return {
    el,
    /** steps：欢迎时从 0 一格一格翻到目标数字（像航班牌刷新）；平时直接翻到新数字。 */
    to(next, { delay = 0, cascade = false } = {}) {
      chain = chain.then(async () => {
        if (delay) await new Promise((r) => setTimeout(r, delay));
        if (reduced()) {
          cur = next;
          top.textContent = bot.textContent = next;
          return;
        }
        if (!cascade) return once(next, 420);
        for (let d = Number(cur) + 1; d <= Number(next); d++) await once(String(d), 130);
      });
    },
  };
}

/* ------------------------------ 滚轮 ------------------------------ */

const STRIP = '01234567890123456789'; // 两圈：从 9 往上滚到 0 时不倒转

function rollCell(ch) {
  const strip = h('span', { class: 'rl-strip' }, ...[...STRIP].map((d) => h('span', {}, d)));
  const el = h('span', { class: 'rl' }, strip);
  let cur = Number(ch);
  const place = (i, ms = 0, delay = 0) => {
    strip.style.transition = ms && !reduced() ? `transform ${ms}ms cubic-bezier(0.2, 0.85, 0.25, 1) ${delay}ms` : 'none';
    strip.style.transform = `translateY(${-i * 5}%)`;
  };
  place(cur);
  let snapT = null;
  return {
    el,
    /** spin：欢迎时多转一整圈再停下。 */
    to(next, { delay = 0, spin = false, ms = 650 } = {}) {
      const n = Number(next);
      clearTimeout(snapT);
      place(cur); // 先回到第一圈的同一位置，再往上滚
      void strip.offsetWidth;
      const target = n + (spin || n < cur ? 10 : 0);
      place(target, ms, delay);
      cur = n;
      // 滚到第二圈后，悄悄换回第一圈的同一个数字
      if (target >= 10) snapT = setTimeout(() => place(n), ms + delay + 30);
    },
  };
}

/* ------------------------------ 数字板 ------------------------------ */

/** 一串字符的数字板：数字一格一个滚轮 / 翻牌，逗号小数点原样。字符结构变了（多一位）就整排重建。 */
function board(host, style) {
  let text = '';
  let cells = [];
  const shape = (t) => [...t].map((c) => (isDigit(c) ? '9' : c)).join('');
  const build = (t) => {
    text = t;
    cells = [...t].map((c) => (isDigit(c) ? (style === 'flip' ? flipCell(c) : rollCell(c)) : { el: h('span', { class: 'bd-sep' }, c) }));
    host.replaceChildren(...cells.map((c) => c.el));
  };
  return {
    /** welcome：从全 0 开始，从左到右依次转到目标数字。 */
    set(next, { welcome = false, base = 0 } = {}) {
      if (welcome) {
        build(next.replace(/\d/g, '0'));
        const digits = cells.map((c, i) => [c, next[i]]).filter(([, c]) => isDigit(c));
        digits.forEach(([cell, c], k) => cell.to(c, style === 'flip' ? { delay: base + 160 + k * 55, cascade: true } : { delay: base + 120 + k * 70, spin: true, ms: 1300 }));
        text = next;
        return;
      }
      if (shape(next) !== shape(text)) return build(next);
      [...next].forEach((c, i) => {
        if (c !== text[i] && isDigit(c)) cells[i].to(c);
      });
      text = next;
    },
  };
}

/**
 * 封面大数字按 perSec（分/秒）从记录那一刻起线性增长，每秒刷新。
 * welcome：这次进入首页要播欢迎动画（流光＝从 0 数上来；翻牌、滚轮＝每一格转到位）。
 * 封面离开页面后计时器自己停下。
 */
export function liveHero(hero, { fen0, t0, perSec, unit, style = 'glow', welcome = false }) {
  const intEl = hero?.querySelector('.int');
  if (!intEl) return;
  let decEl = hero.querySelector('.dec');
  if (!decEl) {
    decEl = h('span', { class: 'dec' });
    intEl.after(decEl);
  }
  const at = () => Math.round(fen0 + (perSec * Math.max(0, Date.now() - t0)) / 1000);
  hero.classList.add('live');

  let paint;
  if (style === 'glow') {
    // 流光：数字每秒安静地更新，不做任何闪动
    let width = 0;
    paint = () => {
      const [i, d] = liveParts(at(), unit);
      if (i.length + d.length !== width) {
        width = i.length + d.length;
        hero.style.setProperty('--w', heroWidth(i, d, unit).toFixed(2)); // 多了一位数时重新算字号
        fitHero(hero);
      }
      // 只改变了的部分，没变就不碰（避免每秒无谓地重绘整串数字）
      if (intEl.textContent !== i) intEl.textContent = i;
      if (decEl.textContent !== `.${d}`) decEl.textContent = `.${d}`;
    };
    paint();
    if (welcome) animateHero(hero, at(), unit);
  } else {
    hero.classList.add('board', style);
    const ib = board(intEl, style);
    const db = board(decEl, style);
    const [i0, d0] = liveParts(at(), unit);
    // 按位数估一个字号，让整排牌子刚好放得下（CSS 里用容器宽度换算）
    const width = (s, k) => [...s].reduce((n, c) => n + (isDigit(c) ? 0.74 : 0.34), 0) * k;
    hero.style.setProperty('--w', (width(i0, 1) + width(`.${d0}`, 0.56) + 1.1).toFixed(2));
    const base = splashDelay();
    ib.set(i0, { welcome: welcome && !reduced(), base });
    db.set(`.${d0}`, { welcome: welcome && !reduced(), base });
    if (welcome && !reduced()) {
      hero.classList.add('counting');
      setTimeout(() => {
        hero.classList.remove('counting');
        glint(hero.closest('.cover'));
      }, base + (style === 'flip' ? 2000 : 2300));
    }
    let len = i0.length + d0.length;
    paint = () => {
      const [i, d] = liveParts(at(), unit);
      ib.set(i);
      db.set(`.${d}`);
      if (i.length + d.length !== len) {
        len = i.length + d.length;
        fitHero(hero); // 多了一位数：重新量一次
      }
    };
  }

  const timer = setInterval(() => {
    if (!hero.isConnected) return clearInterval(timer);
    if (document.hidden || hero.classList.contains('counting')) return;
    paint();
  }, 1000);
}
