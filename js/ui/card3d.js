// 首页卡片的立体感：
//  · 手指按住时，卡片朝按下的那一侧微微下沉、倾斜（像按在一张有厚度的金属卡上）；
//  · 按住约半秒，卡片绕竖轴翻到背面；在背面轻点一下翻回正面；
//  · 打开「卡面光影」后，卡片还会随手机倾斜轻轻转动几度。
// 旋转全部由 CSS 变量驱动（--px/--py 按压位置，--fy 翻面角度，--tx/--ty 来自陀螺仪）。
import { h } from './dom.js';
import { fx, iosHaptic, soundOnly } from './feedback.js';

const HOLD_MS = 460;

/**
 * @param {{ front: HTMLElement, back: HTMLElement, flipped?: boolean, onTap?: () => void, onFlip?: (flipped: boolean) => void }} o
 */
export function card3d({ front, back, flipped = false, onTap, onFlip }) {
  back.classList.add('cover-back');
  back.setAttribute('aria-hidden', String(!flipped));
  const inner = h('div', { class: 'card-inner' }, front, back);
  const el = h('div', { class: ['card3d', flipped && 'flipped'] }, inner);

  let hold = null;
  let longed = false;
  let start = null;

  const aim = (e) => {
    const r = el.getBoundingClientRect();
    el.style.setProperty('--px', (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
    el.style.setProperty('--py', (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
  };
  const release = () => {
    clearTimeout(hold);
    el.classList.remove('pressed');
  };

  function flip() {
    const on = !el.classList.contains('flipped');
    el.classList.add('flipping');
    el.classList.toggle('flipped', on);
    back.setAttribute('aria-hidden', String(!on));
    front.setAttribute('aria-hidden', String(on));
    soundOnly(() => fx.pick());
    clearTimeout(flip.t);
    flip.t = setTimeout(() => el.classList.remove('flipping'), 820);
    onFlip?.(on);
  }

  el.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || e.target.closest('button')) return;
    longed = false;
    start = { x: e.clientX, y: e.clientY };
    aim(e);
    el.classList.add('pressed');
    hold = setTimeout(() => {
      longed = true;
      el.classList.remove('pressed');
      flip();
    }, HOLD_MS);
  });
  el.addEventListener('pointermove', (e) => {
    if (!start) return;
    // 手指一滑动就是在滚页面：取消按压和翻面
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) {
      start = null;
      return release();
    }
    if (el.classList.contains('pressed')) aim(e);
  });
  el.addEventListener('pointerup', () => {
    start = null;
    release();
    if (longed) iosHaptic(); // iPhone 的触感只能在手指抬起时给
  });
  el.addEventListener('pointercancel', () => {
    start = null;
    release();
  });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('click', (e) => {
    if (longed) {
      longed = false;
      e.preventDefault();
      return;
    }
    if (e.target.closest('button')) return;
    if (el.classList.contains('flipped')) {
      flip();
      iosHaptic();
      return;
    }
    onTap?.();
  });

  return { el, flip };
}
