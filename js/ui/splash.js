// 开屏：金色菱形徽记描出来 → 「资产账本」浮现 → 渐隐进首页。约 1.3 秒，点一下可以跳过。
// 开屏直接写在 index.html 里，页面第一帧就是它（不会先闪一下浅色的空白页再跳出黑色开屏）。
// 动画从页面一打开就开始，这里只负责在合适的时候让它渐隐。

const MIN_MS = 1350; // 徽记、字、金线都出完的时间

const el = () => document.getElementById('splash');

/** 立刻移除开屏（出错时要露出错误提示）。 */
export function dropSplash() {
  el()?.remove();
}

/**
 * 数据准备好后调用。on=false（设置里关了开屏）或系统要求减弱动态效果时，马上淡出；
 * 否则等徽记动画播完再淡出。onReveal 在开始淡出时调用：这时挂上首页，首页的欢迎动画正好接上。
 */
export function revealSplash(onReveal, { on = true } = {}) {
  const sp = el();
  if (!sp) return onReveal();
  const quick = !on || matchMedia('(prefers-reduced-motion: reduce)').matches;
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    clearTimeout(t);
    onReveal();
    sp.classList.add('out');
    if (quick) sp.style.transitionDuration = '0.28s';
    setTimeout(() => sp.remove(), quick ? 320 : 700);
  };
  sp.addEventListener('pointerdown', go);
  const t = setTimeout(go, quick ? 0 : Math.max(0, MIN_MS - performance.now()));
}
