// 记一笔专用的金额键盘：不弹系统键盘，版面不会被顶起；带加减，右下角「完成」。
// 只管「算式」本身：数字、小数点、+ −、退格、清空；结果怎么用由调用方决定。
import { h, icon } from './dom.js';
import { parseAmount } from '../core/money.js';
import { fx, iosHaptic, soundOnly } from './feedback.js';

const OPS = ['+', '−'];
const isOp = (c) => OPS.includes(c);

/** 把算式拆成 [数, 运算符, 数, …]（末尾可能是运算符）。 */
const tokens = (expr) => expr.split(/([+−])/).filter((t) => t !== '');

/** 算式求值（按「分」整数计算，没有浮点误差）。末尾悬着的运算符忽略。 */
export function evalExpr(expr, unit) {
  const ts = tokens(expr);
  while (ts.length && isOp(ts[ts.length - 1])) ts.pop();
  if (!ts.length) return { empty: true, hasOp: false };
  let fen = 0;
  let sign = 1;
  for (const t of ts) {
    if (isOp(t)) {
      sign = t === '+' ? 1 : -1;
      continue;
    }
    const p = parseAmount(t, unit);
    if (!p.ok || p.empty) return { error: true, hasOp: ts.length > 1 };
    fen += sign * p.fen;
  }
  return { fen, hasOp: ts.length > 1 };
}

/** 显示用：每个数加千分位，运算符两边留窄空格。 */
export function prettyExpr(expr) {
  return tokens(expr)
    .map((t) => {
      if (isOp(t)) return ` ${t} `;
      const [i, f] = t.split('.');
      const g = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return f === undefined ? g : `${g}.${f}`;
    })
    .join('');
}

/**
 * @param {{ decimals: () => number, onChange: (expr: string) => void, onNext: () => void, onDone: () => void }} opts
 * onNext 只给实体键盘的 Enter / Tab 用（跳到下一栏）；屏幕键盘上那个位置是「清空」。
 * 键盘顶上有一根小横条：按住横条或算式那一行往下拉，就能收起键盘。
 */
export function amountPad({ decimals, onChange, onNext, onDone }) {
  let expr = '';
  let fresh = false; // 刚打开一个已有金额的栏：先按数字＝重新输入，先按 + − ＝在原数上加减

  const set = (v) => {
    expr = v;
    onChange(expr);
  };

  function press(k) {
    const ts = tokens(expr);
    const last = expr.slice(-1);
    const cur = isOp(last) || !ts.length ? '' : ts[ts.length - 1];
    if (/^\d$/.test(k) || k === '.') {
      if (fresh) {
        fresh = false;
        return set(k === '.' ? '0.' : k);
      }
      if (k === '.') {
        if (cur.includes('.')) return;
        return set(expr + (cur === '' ? '0.' : '.'));
      }
      if (cur.includes('.')) {
        if (cur.split('.')[1].length >= decimals()) return;
      } else if (cur.replace(/^0+/, '').length >= 12) return;
      if (cur === '0') return set(expr.slice(0, -1) + k);
      return set(expr + k);
    }
    fresh = false;
    if (isOp(k)) {
      if (expr === '') return;
      if (isOp(last)) return set(expr.slice(0, -1) + k);
      return set((last === '.' ? expr.slice(0, -1) : expr) + k);
    }
    if (k === 'back') return set(expr.slice(0, -1));
    if (k === 'clear') return set('');
  }

  // 按下就响应（不等抬手），手感接近系统键盘；不抢输入框焦点
  const key = (label, k, cls = '', aria = label) => {
    const b = h('button', { type: 'button', class: ['pk', cls], 'data-k': k, 'aria-label': aria }, label);
    return b;
  };
  const back = key(icon('backspace', { size: 24, stroke: 1.7 }), 'back', 'fn', '退格（长按清空）');
  const clear = key('清空', 'clear', 'fn sm', '清空这一栏');
  const done = key('完成', 'done', 'done');
  const grid = h(
    'div',
    { class: 'pad-grid' },
    key('1', '1'), key('2', '2'), key('3', '3'), back,
    key('4', '4'), key('5', '5'), key('6', '6'), key('−', '−', 'op', '减'),
    key('7', '7'), key('8', '8'), key('9', '9'), key('+', '+', 'op', '加'),
    key('.', '.', 'pt', '小数点'), key('0', '0'), clear, done,
  );
  // 键盘顶上一行：正在填的账户 · 算式 · = 结果（有加减时结果用金色突出）
  const calcName = h('span', { class: 'pc-name' });
  const calcExpr = h('span', { class: 'pc-expr' });
  const calcRes = h('span', { class: 'pc-res', hidden: true });
  const calc = h('div', { class: 'pad-calc', 'aria-live': 'polite' }, calcName, h('span', { class: 'pc-main' }, calcExpr, calcRes));
  const top = h('div', { class: 'pad-top', title: '往下拉收起键盘' }, h('span', { class: 'pad-grab', 'aria-hidden': 'true' }), calc);
  const el = h('div', { class: 'amount-pad', role: 'group', 'aria-label': '金额键盘' }, top, grid);

  // 往下拉收起：键盘跟着手指走，松手时拉得够远（或甩得够快）就收起，否则弹回
  let drag = null;
  top.addEventListener('pointerdown', (e) => {
    drag = { id: e.pointerId, y0: e.clientY, t0: performance.now(), dy: 0, lastY: e.clientY, lastT: performance.now(), v: 0 };
    top.setPointerCapture?.(e.pointerId);
    el.style.transition = 'none';
  });
  top.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const raw = e.clientY - drag.y0;
    drag.dy = raw > 0 ? raw : -Math.sqrt(-raw) * 2; // 往上拉只有一点点阻尼感
    const now = performance.now();
    drag.v = (e.clientY - drag.lastY) / Math.max(1, now - drag.lastT);
    drag.lastY = e.clientY;
    drag.lastT = now;
    el.style.transform = `translate3d(0, ${drag.dy}px, 0)`;
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { dy, v } = drag;
    drag = null;
    const h0 = el.offsetHeight || 300;
    if (dy > Math.min(90, h0 * 0.28) || (dy > 16 && v > 0.55)) {
      el.style.transition = 'transform 0.24s cubic-bezier(0.3, 0, 0.8, 0.4)';
      el.style.transform = `translate3d(0, ${h0}px, 0)`;
      fx.done();
      iosHaptic();
      setTimeout(() => {
        onDone();
        el.style.transition = 'none';
        el.style.transform = '';
      }, 230);
    } else {
      el.style.transition = 'transform 0.42s cubic-bezier(0.2, 1.3, 0.4, 1)';
      el.style.transform = '';
    }
  };
  top.addEventListener('pointerup', endDrag);
  top.addEventListener('pointercancel', endDrag);

  let holdT = null;
  grid.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.pk');
    if (!b || b.disabled) return;
    e.preventDefault();
    b.classList.add('down');
    const k = b.dataset.k;
    if (k === 'done') return soundOnly(() => fx.done()), onDone();
    if (k === 'clear') {
      if (expr) soundOnly(() => fx.remove());
      return press('clear');
    }
    soundOnly(() => (k === 'back' ? fx.back() : fx.key()));
    press(k);
    if (k === 'back') {
      clearTimeout(holdT);
      holdT = setTimeout(() => {
        if (!expr) return;
        press('clear');
        fx.remove();
      }, 550);
    }
  });
  const up = () => {
    clearTimeout(holdT);
    grid.querySelectorAll('.pk.down').forEach((b) => b.classList.remove('down'));
  };
  // iPhone 的触感：手指抬起这一刻补上（按下时系统不给触感）
  grid.addEventListener('pointerup', (e) => {
    if (e.target.closest('.pk') && grid.querySelector('.pk.down')) iosHaptic();
    up();
  });
  grid.addEventListener('pointercancel', up);
  grid.addEventListener('pointerleave', up);
  // 读屏 / 键盘用户：用 click 触发（pointerdown 已处理的会被 preventDefault 掉焦点，不会重复）
  grid.addEventListener('click', (e) => {
    if (e.detail !== 0) return; // 手指 / 鼠标点按已在 pointerdown 处理过；这里只管读屏和键盘操作
    const b = e.target.closest('.pk');
    if (!b) return;
    const k = b.dataset.k;
    if (k === 'done') onDone();
    else press(k);
  });

  return {
    el,
    /** 开始编辑一栏：text 是这一栏现有的金额（可带千分位）。 */
    start(text) {
      expr = String(text ?? '').replace(/[,\s]/g, '').replace(/-/g, '−');
      if (expr.startsWith('−')) expr = expr.slice(1) ? `0${expr}` : '';
      fresh = expr !== '';
    },
    get expr() {
      return expr;
    },
    /** 更新顶上那一行：name 账户名，text 算式（已排好版），result 有加减时的结果文本。 */
    show({ name = '', text = '', result = '' } = {}) {
      calcName.textContent = name;
      calcExpr.textContent = text || '输入金额';
      calcExpr.classList.toggle('ph', !text);
      calcRes.hidden = !result;
      calcRes.textContent = result ? `= ${result}` : '';
    },
    /** 电脑上用实体键盘也能输入。返回 true 表示已处理。 */
    key(e) {
      const map = { Enter: 'next', Tab: 'next', Escape: 'done', Backspace: 'back', Delete: 'clear', '-': '−', '+': '+', '=': 'done', ',': '.' };
      const k = /^[\d.]$/.test(e.key) ? e.key : map[e.key];
      if (!k || e.metaKey || e.ctrlKey || e.altKey) return false;
      e.preventDefault();
      if (k === 'next') onNext();
      else if (k === 'done') onDone();
      else press(k);
      return true;
    },
  };
}
