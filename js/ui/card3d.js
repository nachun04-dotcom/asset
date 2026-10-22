// 首页卡片组：左右滑动看更多（净资产 → 变化 → 构成 → 开销），下面几个小点表示第几张。
// 手指按住时，那一张朝按下的一侧微微下沉（有一点实体卡的分量）；打开「卡面光影」后，卡片随手机轻轻转动。
// 转动全部由 CSS 变量驱动（--px/--py 按压位置，--tx/--ty 来自陀螺仪）。
import { h } from './dom.js';
import { fx, soundOnly } from './feedback.js';

/**
 * @param {{ faces: HTMLElement[], page?: number, onTap?: (i: number) => void, onPage?: (i: number) => void }} o
 */
export function cardDeck({ faces, page = 0, onTap, onPage }) {
  const track = h('div', { class: 'deck-track' }, ...faces);
  const dots = faces.map((_, i) => h('i', { class: i === page ? 'on' : '' }));
  const el = h('div', { class: 'deck' }, track, faces.length > 1 ? h('div', { class: 'deck-dots', 'aria-hidden': 'true' }, ...dots) : null);
  let cur = page;

  const step = () => (faces.length > 1 ? faces[1].offsetLeft - faces[0].offsetLeft : track.clientWidth) || 1;
  track.addEventListener(
    'scroll',
    () => {
      const i = Math.max(0, Math.min(faces.length - 1, Math.round(track.scrollLeft / step())));
      if (i === cur) return;
      cur = i;
      dots.forEach((d, j) => d.classList.toggle('on', j === i));
      faces.forEach((f, j) => f.setAttribute('aria-hidden', String(j !== i)));
      soundOnly(() => fx.step());
      onPage?.(i);
    },
    { passive: true },
  );

  // 按住：朝手指那一侧微微下沉；一滑动就松开（是在翻页或滚动页面）
  let pressed = null;
  let start = null;
  const release = () => {
    pressed?.classList.remove('pressed');
    pressed = null;
  };
  track.addEventListener('pointerdown', (e) => {
    const face = e.target.closest('.cover');
    if (!face || e.button > 0 || e.target.closest('button')) return;
    const r = face.getBoundingClientRect();
    face.style.setProperty('--px', (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
    face.style.setProperty('--py', (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
    face.classList.add('pressed');
    pressed = face;
    start = { x: e.clientX, y: e.clientY };
    soundOnly(() => fx.press());
  });
  track.addEventListener('pointermove', (e) => {
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) {
      start = null;
      release();
    }
  });
  for (const t of ['pointerup', 'pointercancel', 'pointerleave']) track.addEventListener(t, release);
  track.addEventListener('click', (e) => {
    const face = e.target.closest('.cover');
    if (!face || e.target.closest('button')) return;
    onTap?.(faces.indexOf(face));
  });

  return {
    el,
    /** 跳到第 i 张（数据刷新重画后回到原来那张）。 */
    setPage(i, smooth = false) {
      cur = i;
      track.scrollTo({ left: i * step(), behavior: smooth ? 'smooth' : 'instant' });
      dots.forEach((d, j) => d.classList.toggle('on', j === i));
    },
  };
}
