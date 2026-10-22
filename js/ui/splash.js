// 开屏：一张暗金卡从远处转着浮现、金线走一圈，然后飞到首页卡片的位置，和首页的卡接上。
// 开屏直接写在 index.html 里，页面第一帧就是它（不会先闪一下浅色的空白页再跳出黑色开屏）。
// 动画从页面一打开就开始，这里只负责在合适的时候让它飞走、淡出。

const MIN_MS = 1700; // 卡片浮现 + 徽记描完 + 金线走一圈的时间
const FLY_MS = 760;

const el = () => document.getElementById('splash');

/** 立刻移除开屏（出错时要露出错误提示）。 */
export function dropSplash() {
  el()?.remove();
}

/**
 * 数据准备好后调用。on=false（设置里关了开屏）或系统要求减弱动态效果时，马上淡出；
 * 否则等卡片动画播完，再把卡片飞到首页卡片的位置。onReveal 在开始飞之前调用（这时挂上首页）。
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
    const card = sp.querySelector('.sp-card');
    const target = document.querySelector('.deck .cover, .cover');
    if (quick || !card || !target) {
      sp.classList.add('out');
      setTimeout(() => sp.remove(), 360);
      return;
    }
    // 从开屏卡片现在的位置，平移 + 缩放到首页卡片的位置
    card.style.animation = 'none';
    const a = card.getBoundingClientRect();
    const b = target.getBoundingClientRect();
    const dx = b.left + b.width / 2 - (a.left + a.width / 2);
    const dy = b.top + b.height / 2 - (a.top + a.height / 2);
    const k = b.width / a.width;
    void card.offsetWidth;
    card.style.transition = `transform ${FLY_MS}ms cubic-bezier(0.65, 0, 0.25, 1)`;
    card.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(${k})`;
    sp.classList.add('flying');
    setTimeout(() => sp.classList.add('out'), FLY_MS - 120);
    setTimeout(() => sp.remove(), FLY_MS + 300);
  };
  sp.addEventListener('pointerdown', go);
  const t = setTimeout(go, quick ? 0 : Math.max(0, MIN_MS - performance.now()));
}
