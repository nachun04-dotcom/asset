// 开屏：金色菱形徽记描出来 → 「资产账本」浮现 → 渐隐进首页。约 1.3 秒，点一下可以跳过。
// 只在冷启动时播放；系统要求减弱动态效果时不播放。
import { h, s } from './dom.js';

/**
 * 显示开屏。onReveal 在开始渐隐时调用（这时挂上首页，首页的欢迎动画正好接上）。
 */
export function playSplash(onReveal) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return onReveal();
  const mark = s(
    'svg',
    { viewBox: '0 0 64 64', width: 64, height: 64, class: 'sp-mark', 'aria-hidden': 'true' },
    s('path', { d: 'M32 4 L60 32 L32 60 L4 32 Z', class: 'sp-outer' }),
    s('path', { d: 'M32 15 L49 32 L32 49 L15 32 Z', class: 'sp-inner' }),
    s('path', { d: 'M32 25 L39 32 L32 39 L25 32 Z', class: 'sp-core' }),
  );
  const el = h(
    'div',
    { class: 'splash', role: 'presentation' },
    h('div', { class: 'sp-box' }, mark, h('div', { class: 'sp-name' }, '资产账本'), h('div', { class: 'sp-line', 'aria-hidden': 'true' }), h('div', { class: 'sp-sub' }, 'PRIVATE  LEDGER')),
  );
  let revealed = false;
  const reveal = () => {
    if (revealed) return;
    revealed = true;
    clearTimeout(t);
    onReveal();
    el.classList.add('out');
    setTimeout(() => el.remove(), 650);
  };
  el.addEventListener('pointerdown', reveal);
  document.body.appendChild(el);
  const t = setTimeout(reveal, 1350);
}
