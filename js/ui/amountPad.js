// 记一笔专用的金额键盘：不弹系统键盘，版面不会被顶起；带加减，右下角「完成」。
// 只管「算式」本身：数字、小数点、+ −、退格（长按清空）；结果怎么用由调用方决定。
import { h, icon } from './dom.js';
import { parseAmount } from '../core/money.js';
import { fx, iosHaptic } from './feedback.js';

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
  const next = key(h('span', { class: 'pk-next' }, icon('chevronD', { size: 18, stroke: 2 }), '下一项'), 'next', 'fn sm', '下一项');
  const done = key('完成', 'done', 'done');
  const grid = h(
    'div',
    { class: 'pad-grid' },
    key('1', '1'), key('2', '2'), key('3', '3'), back,
    key('4', '4'), key('5', '5'), key('6', '6'), key('−', '−', 'op', '减'),
    key('7', '7'), key('8', '8'), key('9', '9'), key('+', '+', 'op', '加'),
    key('.', '.', 'pt', '小数点'), key('0', '0'), next, done,
  );
  // 键盘顶上一行：正在填的账户 · 算式 · = 结果（有加减时结果用金色突出）
  const calcName = h('span', { class: 'pc-name' });
  const calcExpr = h('span', { class: 'pc-expr' });
  const calcRes = h('span', { class: 'pc-res', hidden: true });
  const calc = h('div', { class: 'pad-calc', 'aria-live': 'polite' }, calcName, h('span', { class: 'pc-main' }, calcExpr, calcRes));
  const el = h('div', { class: 'amount-pad', role: 'group', 'aria-label': '金额键盘' }, calc, grid);

  let holdT = null;
  grid.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.pk');
    if (!b || b.disabled) return;
    e.preventDefault();
    b.classList.add('down');
    const k = b.dataset.k;
    if (k === 'next') return fx.select(), onNext();
    if (k === 'done') return fx.done(), onDone();
    if (k === 'back') fx.back();
    else fx.key();
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
  grid.addEventListener('pointerup', up);
  grid.addEventListener('pointercancel', up);
  grid.addEventListener('pointerleave', up);
  // 读屏 / 键盘用户：用 click 触发（pointerdown 已处理的会被 preventDefault 掉焦点，不会重复）
  grid.addEventListener('click', (e) => {
    if (e.detail !== 0) return iosHaptic(); // iPhone 的触感只能在点按完成的这一刻触发
    const b = e.target.closest('.pk');
    if (!b) return;
    const k = b.dataset.k;
    if (k === 'next') onNext();
    else if (k === 'done') onDone();
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
    setNext(ok) {
      next.disabled = !ok;
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
