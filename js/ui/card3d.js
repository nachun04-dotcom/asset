// 首页卡片：一张真正有厚度的卡——正面、背面、四条鎏金侧边，在三维空间里摆放。
//  · 平时卡片在空中极慢地轻轻摆动（几度），反光和底下的投影跟着角度移动，一眼看得出是实物；
//    打开「卡面光影」后改为跟着手机倾斜转动；
//  · 轻点卡片绕竖轴翻到背面（翻到一半能看到金色侧边）；背面左右滑动看「变化 / 构成 / 开销」，轻点翻回来；
//  · 手指按住时，卡片朝按下的那一侧微微下沉。
// 三层：.card3d（摆动 / 陀螺仪，--sx/--sy）→ .card-sway → .card-inner（按压、翻面，--px/--py/--fy）。
import { h } from './dom.js';
import { fx, iosHaptic, soundOnly } from './feedback.js';
import { guilloche } from './snapshotView.js';

/**
 * @param {{ front: HTMLElement, pages: HTMLElement[], flipped?: boolean, page?: number, onFlip?: (on: boolean) => void, onPage?: (i: number) => void }} o
 */
export function card3d({ front, pages, flipped = false, page = 0, onFlip, onPage }) {
  // 背面：几页内容横向排开，左右滑动切换，底部小点表示第几页
  const track = h('div', { class: 'bk-track' }, ...pages);
  const dots = pages.map((_, i) => h('i', { class: i === page ? 'on' : '' }));
  const back = h('section', { class: 'cover cover-back', 'aria-label': '卡片背面', 'aria-hidden': String(!flipped) }, guilloche(), track, pages.length > 1 ? h('div', { class: 'bk-dots', 'aria-hidden': 'true' }, ...dots) : null, h('span', { class: 'cover-rim', 'aria-hidden': 'true' }));
  front.setAttribute('aria-hidden', String(flipped));
  // 四条鎏金侧边：卡的厚度
  const edges = ['t', 'b', 'l', 'r'].map((k) => h('i', { class: `card-edge ${k}`, 'aria-hidden': 'true' }));
  // 每一面上一层随角度移动的柔光
  for (const f of [front, back]) f.appendChild(h('span', { class: 'cover-gloss', 'aria-hidden': 'true' }));
  const inner = h('div', { class: 'card-inner' }, front, back, ...edges);
  const el = h('div', { class: ['card3d', flipped && 'flipped'] }, h('div', { class: 'card-sway' }, inner));

  let cur = page;
  track.addEventListener(
    'scroll',
    () => {
      const i = Math.max(0, Math.min(pages.length - 1, Math.round(track.scrollLeft / Math.max(1, track.clientWidth))));
      if (i === cur) return;
      cur = i;
      dots.forEach((d, j) => d.classList.toggle('on', j === i));
      soundOnly(() => fx.step());
      onPage?.(i);
    },
    { passive: true },
  );

  function flip() {
    const on = !el.classList.contains('flipped');
    el.classList.add('flipping');
    el.classList.toggle('flipped', on);
    back.setAttribute('aria-hidden', String(!on));
    front.setAttribute('aria-hidden', String(on));
    soundOnly(() => fx.flip());
    iosHaptic();
    clearTimeout(flip.t);
    clearTimeout(flip.l);
    flip.l = setTimeout(() => soundOnly(() => fx.land()), 520);
    flip.t = setTimeout(() => el.classList.remove('flipping'), 860);
    onFlip?.(on);
  }

  // 按住：朝手指那一侧微微下沉；一滑动就松开（在滚页面或翻背面的页）
  let start = null;
  const release = () => el.classList.remove('pressed');
  el.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || e.target.closest('button')) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--px', (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
    el.style.setProperty('--py', (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
    el.classList.add('pressed');
    start = { x: e.clientX, y: e.clientY };
    soundOnly(() => fx.press());
  });
  el.addEventListener('pointermove', (e) => {
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) {
      start = null;
      release();
    }
  });
  for (const t of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(t, release);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  // 轻点（没有滑动）就翻面；点到卡上的按钮（实时估算、目标、查看明细）不翻
  el.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    flip();
  });

  return {
    el,
    flip,
    /** 背面回到第 i 页（数据刷新重画后保持）。 */
    setPage(i) {
      cur = i;
      track.scrollTo({ left: i * track.clientWidth, behavior: 'instant' });
      dots.forEach((d, j) => d.classList.toggle('on', j === i));
    },
  };
}
