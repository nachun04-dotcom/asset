// 操作反馈：震动 + 音效。音效全部用 Web Audio 现场合成（不下载任何文件），轻、短、偏高频，像精密仪器的按键声。
// 震动：安卓用 navigator.vibrate；iPhone（iOS 18 起的 Safari）借助系统开关控件的触感——点一下隐藏的开关就会「嗒」一下。
// iPhone 上音效走「环境音」通道：静音键打开时不出声，也不会打断正在播放的音乐。

const env = typeof window !== 'undefined' && typeof document !== 'undefined';
const isIOS = env && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
const canVibrate = env && typeof navigator.vibrate === 'function';
const reducedMotion = () => env && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

let opts = { sound: true, haptics: true };
let holdIOS = false; // 在 pointerdown 里时先不点 iPhone 的触感，等手指抬起再补（见 iosHaptic）
/** 跟随设置里的「操作音效」「触感震动」开关。 */
export function configure(next) {
  opts = { ...opts, ...next };
}

/* ------------------------------ 震动 ------------------------------ */

// 每次新建一个隐藏的系统开关、点一下、再移除（与 iOS 18 上验证可用的做法一致）。
// 必须在「手指抬起」那一刻（pointerup / touchend / click）调用，系统才会给触感。
function iosTick() {
  // 正在打字时不点（点隐藏开关可能抢走输入框的焦点）
  if (document.activeElement?.matches?.('input:not([readonly]):not([type=checkbox]), textarea')) return;
  try {
    const label = document.createElement('label');
    label.setAttribute('aria-hidden', 'true');
    label.style.display = 'none';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    label.appendChild(input);
    label.addEventListener('click', (e) => e.stopPropagation());
    document.head.appendChild(label);
    label.click();
    label.remove();
  } catch {
    /* 不支持就算了 */
  }
}

function buzz(pattern) {
  if (!env || !opts.haptics) return;
  if (canVibrate) {
    try {
      navigator.vibrate(pattern);
    } catch {
      /* 忽略 */
    }
  } else if (isIOS && !holdIOS) {
    iosTick();
    // 多段的（成功 / 出错）再补一下；不在点按当下时系统可能不响应，没关系
    if (Array.isArray(pattern) && pattern.length > 2) setTimeout(iosTick, 110);
  }
}

/** 在 pointerdown 里播放声音和安卓震动，iPhone 的触感留到手指抬起时由 iosHaptic 补上。 */
export function soundOnly(fn) {
  holdIOS = true;
  try {
    fn();
  } finally {
    holdIOS = false;
  }
}

/** iPhone 的触感只能在「手指抬起」那一刻触发：按下就响应的按键，在 pointerup 里补一下。 */
export function iosHaptic() {
  if (env && opts.haptics && !canVibrate && isIOS) iosTick();
}

/* ------------------------------ 音效 ------------------------------ */

let ac = null;
let out = null;
function audio() {
  if (!env || !opts.sound) return null;
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'ambient';
      ac = new AC({ latencyHint: 'interactive' });
    } catch {
      return null;
    }
    // 总音量 + 轻微压限：多个声音叠在一起也不会刺耳
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 6;
    out = ac.createGain();
    out.gain.value = 0.9;
    out.connect(comp);
    comp.connect(ac.destination);
  }
  if (ac.state === 'suspended') ac.resume().catch(() => {});
  return ac.state === 'closed' ? null : ac;
}

/** 浏览器要求「用户点过之后」才能出声：第一次点按时把音频准备好。 */
export function unlockAudio() {
  if (!env) return;
  const go = () => {
    const a = audio();
    if (a && a.state === 'running') {
      // 播一个听不见的极短声音，iOS 才算真正解锁
      const b = a.createBuffer(1, 1, 22050);
      const s = a.createBufferSource();
      s.buffer = b;
      s.connect(a.destination);
      s.start(0);
    }
  };
  for (const ev of ['touchend', 'click', 'keydown']) document.addEventListener(ev, go, { capture: true, passive: true });
}

/** 一个短音：频率可滑动，指数衰减。at 是相对现在的延迟（秒）。 */
function tone(freq, { dur = 0.05, gain = 0.05, type = 'sine', to = null, at = 0, attack = 0.002 } = {}) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + 0.005 + at;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** 一小段过滤后的噪声：按键的「咔」感。 */
function click(at = 0, { gain = 0.04, freq = 3200, dur = 0.018 } = {}) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + 0.005 + at;
  const len = Math.max(1, Math.floor(a.sampleRate * dur));
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  const s = a.createBufferSource();
  s.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = 1.4;
  const g = a.createGain();
  g.gain.value = gain;
  s.connect(f);
  f.connect(g);
  g.connect(out);
  s.start(t);
}

/** 铃声般的和弦：基音 + 一点泛音，余音较长。 */
function bell(freq, at = 0, gain = 0.045) {
  tone(freq, { dur: 0.55, gain, at, attack: 0.004 });
  tone(freq * 2.01, { dur: 0.28, gain: gain * 0.28, at, attack: 0.003 });
}

// 同一种声音太密时合并（连按时不会糊成一片）
const last = new Map();
const gate = (k, ms) => {
  const now = performance.now();
  if (now - (last.get(k) ?? 0) < ms) return false;
  last.set(k, now);
  return true;
};

/* ------------------------------ 对外：按用途命名 ------------------------------ */

export const fx = {
  /** 普通点按：按钮、导航、列表项。 */
  tap() {
    buzz(7);
    if (gate('tap', 40)) {
      click(0, { gain: 0.03, freq: 2600, dur: 0.014 });
      tone(1250, { dur: 0.03, gain: 0.018, type: 'triangle' });
    }
  },
  /** 金额键盘的数字、小数点、加减。 */
  key() {
    buzz(6);
    if (gate('key', 18)) {
      click(0, { gain: 0.045, freq: 3400, dur: 0.016 });
      tone(1700, { dur: 0.035, gain: 0.022, to: 1350 });
    }
  },
  /** 退格。 */
  back() {
    buzz(6);
    if (gate('key', 18)) {
      click(0, { gain: 0.04, freq: 2200, dur: 0.016 });
      tone(1100, { dur: 0.04, gain: 0.02, to: 820 });
    }
  },
  /** 开关、分段选择、下一项：清脆的两下。 */
  select() {
    buzz(9);
    if (gate('select', 50)) {
      tone(1320, { dur: 0.04, gain: 0.028 });
      tone(1760, { dur: 0.05, gain: 0.022, at: 0.035 });
    }
  },
  /** 完成一项（收起键盘、一键沿用）。 */
  done() {
    buzz(12);
    tone(880, { dur: 0.12, gain: 0.035 });
    tone(1318.5, { dur: 0.22, gain: 0.03, at: 0.06 });
  },
  /** 保存成功、导入 / 恢复完成：上行的三音和弦。 */
  success() {
    buzz([12, 70, 18]);
    bell(1046.5, 0);
    bell(1318.5, 0.075);
    bell(1568, 0.15, 0.04);
  },
  /** 删除、清空：低沉下行。 */
  remove() {
    buzz([18, 50, 10]);
    tone(520, { dur: 0.16, gain: 0.05, to: 240, type: 'triangle' });
    click(0, { gain: 0.03, freq: 900, dur: 0.03 });
  },
  /** 不能这样做（例如保存条件不满足）：两下短促低音。 */
  error() {
    buzz([22, 60, 22]);
    tone(330, { dur: 0.08, gain: 0.05, type: 'triangle' });
    tone(294, { dur: 0.1, gain: 0.05, type: 'triangle', at: 0.11 });
  },
  /** 拖动排序：拿起 / 经过一格 / 放下。 */
  pick() {
    buzz(14);
    tone(660, { dur: 0.06, gain: 0.03, to: 880 });
  },
  step() {
    buzz(4);
    if (gate('step', 30)) click(0, { gain: 0.025, freq: 4200, dur: 0.01 });
  },
  drop() {
    buzz(10);
    tone(880, { dur: 0.07, gain: 0.03, to: 620 });
  },
};

export { reducedMotion };
