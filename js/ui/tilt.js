// 卡面光影：倾斜手机时，封面上的金色反光跟着移动，像拿着一张实体金属卡。
// 只读陀螺仪的角度，不记录、不上传。iPhone 需要用户点一下授权（系统规定），授权后系统会记住。
// 电脑上用鼠标在卡片上移动也有同样效果。

const root = typeof document !== 'undefined' ? document.documentElement : null;
let on = false;
let listening = false;
let base = null; // 手机「平常拿着」的角度：缓慢跟随，所以只有倾斜的那一下才有反光变化
let target = { x: 0, y: 0 };
let cur = { x: 0, y: 0 };
let raf = 0;
let inited = false;

const clamp = (v) => Math.max(-1, Math.min(1, v));

function frame() {
  raf = 0;
  cur.x += (target.x - cur.x) * 0.14;
  cur.y += (target.y - cur.y) * 0.14;
  root.style.setProperty('--tx', cur.x.toFixed(3));
  root.style.setProperty('--ty', cur.y.toFixed(3));
  if (Math.abs(target.x - cur.x) > 0.002 || Math.abs(target.y - cur.y) > 0.002) raf = requestAnimationFrame(frame);
}
const kick = () => {
  if (!raf) raf = requestAnimationFrame(frame);
};

function onOrient(e) {
  if (!on || e.beta == null || e.gamma == null) return;
  if (!base) base = { b: e.beta, g: e.gamma };
  base.b += (e.beta - base.b) * 0.02;
  base.g += (e.gamma - base.g) * 0.02;
  target = { x: clamp((e.gamma - base.g) / 18), y: clamp((e.beta - base.b) / 18) };
  kick();
}

function onPointer(e) {
  if (!on || e.pointerType === 'touch') return;
  const card = e.target.closest?.('.cover');
  if (!card) {
    target = { x: 0, y: 0 };
    return kick();
  }
  const r = card.getBoundingClientRect();
  target = { x: clamp(((e.clientX - r.left) / r.width) * 2 - 1), y: clamp(((e.clientY - r.top) / r.height) * 2 - 1) };
  kick();
}

function listen() {
  if (listening) return;
  listening = true;
  window.addEventListener('deviceorientation', onOrient);
  document.addEventListener('pointermove', onPointer, { passive: true });
}

const needsPermission = () => typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function';

/** 请求陀螺仪权限（iPhone）。必须在点按事件里调用。返回是否可用。 */
export async function askTilt() {
  if (!needsPermission()) return true;
  try {
    return (await DeviceOrientationEvent.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

/** 跟随设置开关。iPhone 上已授权过的，第一次点屏幕时静默确认一下（不会再弹窗）。 */
export function setTilt(enabled) {
  if (!root || (inited && on === !!enabled)) return;
  inited = true;
  on = !!enabled;
  root.toggleAttribute('data-tilt', on);
  if (!on) {
    target = { x: 0, y: 0 };
    kick();
    return;
  }
  listen();
  if (needsPermission()) {
    const once = () => {
      document.removeEventListener('touchend', once, true);
      askTilt();
    };
    document.addEventListener('touchend', once, true);
  }
}
