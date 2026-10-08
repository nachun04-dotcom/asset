// 通用界面组件：分段控件、印章标签、提示条、空状态、抽屉、对话框、提示消息。
import { h, icon, clear } from './dom.js';

export function seg(options, value, onChange, { block = false, label, variant } = {}) {
  const wrap = h('div', { class: ['seg', block && 'block', variant], role: 'group', 'aria-label': label });
  const draw = (v) => {
    clear(wrap);
    for (const o of options) {
      wrap.appendChild(
        h('button', { type: 'button', 'aria-pressed': String(o.value === v), onClick: () => {
          if (o.value === v) return;
          v = o.value;
          draw(v);
          onChange(o.value);
        } }, o.label),
      );
    }
  };
  draw(value);
  return wrap;
}

/** 印章式状态标签：完整 / 不完整（不完整用虚线框，不靠颜色单独区分）。 */
export function stamp(complete, { sm = false } = {}) {
  return h('span', { class: ['stamp', complete ? 'ok' : 'warn', sm && 'sm'] }, icon(complete ? 'check' : 'warn', { size: sm ? 11 : 13, stroke: 2.4 }), complete ? '完整' : '不完整');
}

export function noteBox(kind, content, actions) {
  const ic = kind === 'bad' || kind === 'warn' || kind === undefined ? 'warn' : kind === 'ok' ? 'check' : 'info';
  return h('div', { class: ['note', kind === 'warn' ? '' : kind], role: kind === 'bad' ? 'alert' : undefined }, icon(ic, { size: 18 }), h('div', { class: 'grow' }, ...[].concat(content), actions?.length ? h('div', { class: 'note-actions' }, ...actions) : null));
}

export function emptyState({ glyph = 'ledger', title, text, actions = [] }) {
  return h('div', { class: 'empty' }, h('div', { class: 'glyph' }, icon(glyph, { size: 30 })), h('h2', {}, title), text ? h('p', {}, text) : null, actions.length ? h('div', { class: 'actions' }, ...actions) : null);
}

export function button(text, onClick, { kind = '', block = false, sm = false, disabled = false, iconName, type = 'button' } = {}) {
  return h('button', { type, class: ['btn', kind, block && 'block', sm && 'sm'], onClick, disabled }, iconName ? icon(iconName, { size: 18 }) : null, text);
}

export function switchControl(checked, onChange, label) {
  return h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked, 'aria-label': label, onChange: (e) => onChange(e.target.checked) }), h('i'));
}

/* ------------------------------ 抽屉 / 对话框 / 提示 ------------------------------ */

const stack = [];
let suppressPop = 0;
let popBound = false;
const settlers = [];

/** history.back() 是异步的：关闭抽屉后要等它落定，才能安全地改地址栏里的 #路由。 */
function backAndSettle() {
  return new Promise((resolve) => {
    suppressPop++;
    let finished = false;
    const finish = (viaTimer) => {
      if (finished) return;
      finished = true;
      const i = settlers.indexOf(finish);
      if (i >= 0) settlers.splice(i, 1);
      if (viaTimer) suppressPop = Math.max(0, suppressPop - 1);
      resolve();
    };
    settlers.push(finish);
    try {
      history.back();
    } catch {
      finish(true);
      return;
    }
    setTimeout(() => finish(true), 400);
  });
}

function layer() {
  let el = document.getElementById('layer');
  if (!el) {
    el = h('div', { id: 'layer' });
    document.body.appendChild(el);
  }
  return el;
}

/** 对话框放在单独的容器里：锁屏时主界面和抽屉会被设为 inert，但锁屏上弹出的对话框必须还能操作。 */
function topLayer() {
  let el = document.getElementById('dialogs');
  if (!el) {
    el = h('div', { id: 'dialogs' });
    document.body.appendChild(el);
  }
  return el;
}

const EXIT_MS = 300;
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 抽屉离场：顺着当前位置（可能正被手指拖着）滑下去，同时遮罩淡出；动画结束后才移除节点。 */
function leave(entry, animate) {
  const { el, scrim } = entry;
  if (!animate || reducedMotion()) {
    scrim.remove();
    el.remove();
    return;
  }
  el.setAttribute('inert', '');
  el.classList.remove('dragging', 'snapping');
  el.classList.add('leaving');
  scrim.classList.add('leaving');
  el.style.transition = `transform ${EXIT_MS}ms cubic-bezier(0.32, 0.72, 0, 1)`;
  el.style.transform = 'translate3d(0, 100%, 0)';
  scrim.style.transition = `opacity ${EXIT_MS}ms ease-out`;
  scrim.style.opacity = '0';
  setTimeout(() => {
    scrim.remove();
    el.remove();
  }, EXIT_MS + 60);
}

function removeEntry(entry, { animate = true } = {}) {
  if (entry.closed) return;
  entry.closed = true;
  const i = stack.indexOf(entry);
  if (i >= 0) stack.splice(i, 1);
  leave(entry, animate);
  entry.restoreFocus?.focus?.();
  entry.onClose?.();
}

/**
 * 下拉关闭：从顶部标题栏（或内容已滚到最上面时的任意位置）向下拖，抽屉跟手；
 * 拖过一段距离或快速下甩就关闭，否则弹回。有未保存内容时，沿用「×」的确认流程。
 */
function attachDrag(entry, { head, close }) {
  const { el, scrim } = entry;
  let g = null;
  const isTop = () => stack[stack.length - 1] === entry && !entry.closed;
  const scrolledInside = (target) => {
    for (let n = target; n && n !== el; n = n.parentElement) {
      if (n.scrollHeight > n.clientHeight + 1 && n.scrollTop > 0) {
        const oy = getComputedStyle(n).overflowY;
        if (oy === 'auto' || oy === 'scroll') return true;
      }
    }
    return false;
  };
  const offsetOf = (dy) => (dy >= 0 ? dy : -Math.min(16, Math.sqrt(-dy) * 2.2));
  const paint = (dy) => {
    const off = offsetOf(dy);
    el.style.transform = `translate3d(0, ${off}px, 0)`;
    scrim.style.opacity = String(Math.max(0, 1 - (Math.max(0, off) / (el.offsetHeight || 1)) * 1.15));
  };
  const snapBack = () => {
    el.classList.remove('dragging');
    el.classList.add('snapping');
    el.style.transform = '';
    scrim.style.opacity = '';
    setTimeout(() => el.classList.remove('snapping'), 460);
  };
  const begin = (x, y, target, fromHead) => {
    if (!isTop()) return;
    g = { x0: x, y0: y, samples: [{ y, t: performance.now() }], vy: 0, on: false, dy: 0, target, fromHead };
  };
  /** 返回 true 表示这次移动已被手势接管（调用方应阻止页面滚动）。 */
  const move = (x, y, cancelable) => {
    if (!g) return false;
    const dy = y - g.y0;
    const dx = x - g.x0;
    if (!g.on) {
      if (Math.abs(dy) < 6 && Math.abs(dx) < 6) return false;
      if (Math.abs(dx) > Math.abs(dy) || dy < 0 || (!g.fromHead && scrolledInside(g.target)) || !cancelable) {
        g = null;
        return false;
      }
      g.on = true;
      el.classList.remove('snapping');
      el.classList.add('dragging');
    }
    // 速度只看最近 ~100ms 的移动，这样「先慢后快」的甩动也能被识别
    const now = performance.now();
    g.samples.push({ y, t: now });
    while (g.samples.length > 2 && now - g.samples[0].t > 100) g.samples.shift();
    const first = g.samples[0];
    g.vy = g.samples.length > 1 ? (y - first.y) / Math.max(1, now - first.t) : 0;
    g.dy = dy;
    paint(dy);
    return true;
  };
  const finish = async (cancelled) => {
    const s = g;
    g = null;
    if (!s?.on) return;
    const far = s.dy > Math.min(150, (el.offsetHeight || 600) * 0.28);
    const fling = s.vy > 0.4 && s.dy > 30;
    if (!cancelled && (far || fling)) {
      el.classList.remove('dragging');
      const ok = (await entry.beforeClose?.()) ?? true;
      if (ok) return close();
    }
    snapBack();
  };

  el.addEventListener('touchstart', (e) => {
    g = null;
    if (e.touches.length === 1) begin(e.touches[0].clientX, e.touches[0].clientY, e.target, head.contains(e.target));
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 1) return;
    if (move(e.touches[0].clientX, e.touches[0].clientY, e.cancelable)) e.preventDefault();
  }, { passive: false });
  el.addEventListener('touchend', () => finish(false));
  el.addEventListener('touchcancel', () => finish(true));

  // 鼠标（电脑浏览器）：只从标题栏开始拖
  head.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    begin(e.clientX, e.clientY, e.target, true);
    const onMove = (ev) => move(ev.clientX, ev.clientY, true);
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      finish(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
}

function bindPop() {
  if (popBound || typeof window === 'undefined') return;
  popBound = true;
  window.addEventListener('popstate', async () => {
    if (suppressPop > 0) {
      suppressPop--;
      settlers[0]?.(false);
      return;
    }
    const top = stack[stack.length - 1];
    if (!top) return;
    const ok = (await top.beforeClose?.()) ?? true;
    if (!ok) {
      history.pushState({ sheet: stack.length }, '');
      return;
    }
    removeEntry(top);
  });
}

/**
 * 从底部升起的抽屉。返回 { close, body, foot, setFooter }。
 * 手机的返回手势 / 返回键会先关闭抽屉，而不是退出 App。
 */
export function openSheet({ title, body, footer, onClose, beforeClose, auto = false }) {
  bindPop();
  const restoreFocus = typeof document !== 'undefined' ? document.activeElement : null;
  const entry = { closed: false, onClose, beforeClose, restoreFocus };
  const request = async () => {
    if (entry.closed) return;
    const ok = (await beforeClose?.()) ?? true;
    if (ok) await api.close();
  };
  const head = h('div', { class: 'sheet-head' }, h('h2', { class: 'sheet-title', id: `sheet-t${stack.length}` }, title), h('button', { class: 'icon-btn', type: 'button', 'aria-label': '关闭', onClick: request }, icon('x')));
  const bodyEl = h('div', { class: 'sheet-body' }, body);
  const foot = h('div', { class: 'sheet-foot', hidden: !footer }, footer);
  const el = h('div', { class: ['sheet', auto && 'auto'], role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': `sheet-t${stack.length}`, tabindex: '-1' }, head, bodyEl, foot);
  const scrim = h('div', { class: 'scrim', onClick: request });
  entry.el = el;
  entry.scrim = scrim;
  const root = layer();
  root.appendChild(scrim);
  root.appendChild(el);
  stack.push(entry);
  try {
    history.pushState({ sheet: stack.length }, '');
  } catch {
    /* 个别环境不允许，忽略 */
  }
  el.focus?.();
  attachDrag(entry, { head, close: () => api.close() });
  const api = {
    el,
    body: bodyEl,
    foot,
    /** 关闭抽屉；返回的 Promise 在浏览器历史记录处理完后才完成。 */
    close() {
      if (entry.closed) return Promise.resolve();
      const wasTop = stack[stack.length - 1] === entry;
      removeEntry(entry);
      return wasTop ? backAndSettle() : Promise.resolve();
    },
    setFooter(node) {
      clear(foot);
      foot.hidden = !node;
      if (node) foot.appendChild(node);
    },
    setTitle(t) {
      head.firstChild.textContent = t;
    },
  };
  return api;
}

export async function closeAllSheets() {
  while (stack.length) {
    removeEntry(stack[stack.length - 1], { animate: false });
    await backAndSettle();
  }
}

export function sheetCount() {
  return stack.length;
}

function openDialog(build) {
  return new Promise((resolve) => {
    const scrim = h('div', { class: 'scrim top' });
    const dlg = build((v) => {
      scrim.remove();
      dlg.remove();
      resolve(v);
    });
    topLayer().appendChild(scrim);
    topLayer().appendChild(dlg);
    const first = dlg.__focus ?? dlg.querySelector?.('button');
    first?.focus?.();
    if (dlg.__focus) dlg.__focus.select?.();
  });
}

/** 确认对话框 → Promise<boolean> */
export function confirmDialog({ title, message, confirmText = '确定', cancelText = '取消', danger = false }) {
  return openDialog((done) =>
    h('div', { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true' }, h('h2', {}, title), message ? h('p', {}, ...[].concat(message)) : null, h('div', { class: 'actions' }, h('button', { class: ['btn', danger ? 'danger' : ''], type: 'button', onClick: () => done(true) }, confirmText), h('button', { class: 'btn secondary', type: 'button', onClick: () => done(false) }, cancelText))),
  );
}

export function alertDialog({ title, message, okText = '知道了' }) {
  return openDialog((done) =>
    h('div', { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true' }, h('h2', {}, title), message ? h('div', {}, ...[].concat(message)) : null, h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onClick: () => done() }, okText))),
  );
}

/** 单行输入对话框 → Promise<string|null> */
export function promptDialog({ title, message, placeholder = '', value = '', confirmText = '确定', type = 'text', maxlength, validate }) {
  return openDialog((done) => {
    const err = h('div', { class: 'err', role: 'alert' });
    const input = h('input', { type, placeholder, autocomplete: 'off', 'aria-label': title, value, maxlength });
    const submit = () => {
      const msg = validate?.(input.value);
      if (msg) {
        err.textContent = msg;
        return;
      }
      done(input.value);
    };
    input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
    const dlg = h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true' }, h('h2', {}, title), message ? h('p', { style: 'margin-bottom:12px' }, message) : null, input, err, h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onClick: submit }, confirmText), h('button', { class: 'btn secondary', type: 'button', onClick: () => done(null) }, '取消')));
    dlg.__focus = input; // 输入框优先获得焦点（手机上直接弹出键盘）
    return dlg;
  });
}

let toastRoot = null;
export function toast(message, { actionText, onAction, ms = 4200 } = {}) {
  if (!toastRoot) {
    toastRoot = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(toastRoot);
  }
  const el = h('div', { class: 'toast' }, h('span', {}, message), actionText ? h('button', { type: 'button', onClick: () => { onAction?.(); el.remove(); } }, actionText) : null);
  toastRoot.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 240);
  }, ms);
  return el;
}

export function issueList(issues) {
  const ic = { block: 'warn', warn: 'warn', info: 'info' };
  return h('div', { class: 'pv-issues' }, ...issues.map((i) => h('div', { class: `issue ${i.level === 'block' ? 'block' : i.level === 'info' ? 'info' : 'warn'}` }, icon(ic[i.level] ?? 'warn', { size: 15 }), h('span', {}, i.text))));
}
