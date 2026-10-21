// 卡面光影：倾斜手机时，卡上的高光跟着移动，金边上「迎光」的那一段会亮起来，像拿着一张实体金属卡。
// 只读陀螺仪的角度，不记录、不上传。iPhone 需要用户点一下授权（系统规定）。
// 电脑上用鼠标在卡片上移动也有同样效果。
//
// 输出到 <html> 上的 CSS 变量：
//   --tx / --ty  左右、前后倾斜（-1 ~ 1）
//   --ta         光从哪个方向来（角度，给金边高光用）
//   --tm         倾斜的幅度（0 ~ 1）

const root = typeof document !== 'undefined' ? document.documentElement : null;
let on = false;
let inited = false;
let listening = false;
let base = null; // 平常拿手机的角度：非常缓慢地跟随（约 6 秒），倾斜后停住时光不会马上退回中间
let target = { x: 0, y: 0 };
const cur = { x: 0, y: 0 };
let raf = 0;
let gotEvent = false;

const clamp = (v) => Math.max(-1, Math.min(1, v));

function frame() {
  raf = 0;
  cur.x += (target.x - cur.x) * 0.16;
  cur.y += (target.y - cur.y) * 0.16;
  const m = Math.min(1, Math.hypot(cur.x, cur.y));
  root.style.setProperty('--tx', cur.x.toFixed(3));
  root.style.setProperty('--ty', cur.y.toFixed(3));
  root.style.setProperty('--tm', m.toFixed(3));
  if (m > 0.02) root.style.setProperty('--ta', ((Math.atan2(cur.y, cur.x) * 180) / Math.PI + 90).toFixed(1));
  if (Math.abs(target.x - cur.x) > 0.002 || Math.abs(target.y - cur.y) > 0.002) raf = requestAnimationFrame(frame);
}
const kick = () => {
  if (!raf) raf = requestAnimationFrame(frame);
};

function onOrient(e) {
  if (!on || e.beta == null || e.gamma == null) return;
  gotEvent = true;
  if (!base) base = { b: e.beta, g: e.gamma };
  base.b += (e.beta - base.b) * 0.003;
  base.g += (e.gamma - base.g) * 0.003;
  target = { x: clamp((e.gamma - base.g) / 14), y: clamp((e.beta - base.b) / 14) };
  kick();
}

function onPointer(e) {
  if (!on || e.pointerType === 'touch') return;
  const card = e.target.closest?.('.cover');
  if (!card) target = { x: 0, y: 0 };
  else {
    const r = card.getBoundingClientRect();
    target = { x: clamp(((e.clientX - r.left) / r.width) * 2 - 1), y: clamp(((e.clientY - r.top) / r.height) * 2 - 1) };
  }
  kick();
}

function listen() {
  if (listening) return;
  listening = true;
  window.addEventListener('deviceorientation', onOrient);
  document.addEventListener('pointermove', onPointer, { passive: true });
}

const needsPermission = () => typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function';

/** 请求陀螺仪权限（iPhone）。必须在点按事件里同步调用。返回是否可用。 */
export async function askTilt() {
  if (!needsPermission()) return true;
  try {
    const r = await DeviceOrientationEvent.requestPermission();
    if (r === 'granted') listen();
    return r === 'granted';
  } catch {
    return false;
  }
}

/** 打开后一小段时间内有没有收到方向数据（用来提示用户去系统里允许）。 */
export function tiltAlive() {
  return gotEvent;
}

/** 跟随设置开关。iPhone 的授权每次重新打开 App 后要在第一次点屏幕时确认（已授权过不会再弹窗）。 */
export function setTilt(enabled) {
  if (!root || (inited && on === !!enabled)) return;
  inited = true;
  on = !!enabled;
  root.toggleAttribute('data-tilt', on);
  base = null;
  if (!on) {
    target = { x: 0, y: 0 };
    kick();
    return;
  }
  listen();
  if (needsPermission() && !gotEvent) {
    const once = () => {
      document.removeEventListener('touchend', once, true);
      document.removeEventListener('click', once, true);
      if (!gotEvent) askTilt();
    };
    document.addEventListener('touchend', once, true);
    document.addEventListener('click', once, true);
  }
}
