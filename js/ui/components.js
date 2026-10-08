// 通用界面组件：分段控件、印章标签、提示条、空状态、抽屉、对话框、提示消息。
import { h, icon, clear } from './dom.js';

export function seg(options, value, onChange, { block = false, label } = {}) {
  const wrap = h('div', { class: ['seg', block && 'block'], role: 'group', 'aria-label': label });
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

function removeEntry(entry) {
  if (entry.closed) return;
  entry.closed = true;
  const i = stack.indexOf(entry);
  if (i >= 0) stack.splice(i, 1);
  entry.scrim.remove();
  entry.el.remove();
  entry.restoreFocus?.focus?.();
  entry.onClose?.();
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
    removeEntry(stack[stack.length - 1]);
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
  setTimeout(() => el.remove(), ms);
  return el;
}

export function issueList(issues) {
  const ic = { block: 'warn', warn: 'warn', info: 'info' };
  return h('div', { class: 'pv-issues' }, ...issues.map((i) => h('div', { class: `issue ${i.level === 'block' ? 'block' : i.level === 'info' ? 'info' : 'warn'}` }, icon(ic[i.level] ?? 'warn', { size: 15 }), h('span', {}, i.text))));
}
