// 极简 DOM 构建工具。绝不使用 innerHTML：所有文字都以文本节点写入，类别名、备注等用户内容不可能注入标记。

const SVG_NS = 'http://www.w3.org/2000/svg';
const PROP_KEYS = new Set(['value', 'checked', 'selected', 'disabled', 'indeterminate']);

function applyProps(el, props) {
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) {
      if (PROP_KEYS.has(k)) el[k] = k === 'value' ? '' : false;
      continue;
    }
    if (k === 'class') el.setAttribute('class', Array.isArray(v) ? v.filter(Boolean).join(' ') : v);
    else if (k === 'style') {
      el.setAttribute('style', typeof v === 'string' ? v : Object.entries(v).map(([a, b]) => `${a}:${b}`).join(';'));
    } else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (PROP_KEYS.has(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === true) continue;
    el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
}

/** HTML 元素：h('div', {class:'x', onClick}, 子节点…) */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  applyProps(el, props);
  append(el, children);
  return el;
}

/** SVG 元素 */
export function s(tag, props, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  applyProps(el, props);
  append(el, children);
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function replaceChildren(el, ...children) {
  clear(el);
  append(el, children);
  return el;
}

const ICONS = {
  home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  ledger: 'M5 3.5h14v17H5z M9 8h6 M9 12h6 M9 16h4',
  plus: 'M12 5v14 M5 12h14',
  download: 'M12 3v12 M7 10l5 5 5-5 M4 20h16',
  sliders: 'M4 7h9 M17 7h3 M4 17h3 M11 17h9 M15 4v6 M7 14v6',
  chevronR: 'M9 6l6 6-6 6',
  chevronD: 'M6 9l6 6 6-6',
  chevronU: 'M6 15l6-6 6 6',
  check: 'M5 12.5l4.5 4.5L19 7',
  x: 'M6 6l12 12 M18 6L6 18',
  warn: 'M12 3.5l10 17.5H2z M12 10v5 M12 18v.4',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 11v5.5 M12 7.6v.4',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v5 M14 11v5',
  edit: 'M4 20l4-1 11-11-3-3L5 16z M14 7l3 3',
  lock: 'M6 11h12v9H6z M9 11V8a3 3 0 0 1 6 0v3',
  image: 'M3.5 5h17v14h-17z M3.5 16l5-5 4 4 3-3 5 5 M9 9.2v.1',
  clipboard: 'M8 4h8v3H8z M6 5.5H5v15h14v-15h-1 M9 12h6 M9 16h6',
  file: 'M6 3h8l5 5v13H6z M14 3v5h5 M9 13h6 M9 17h6',
  share: 'M12 15V3 M8 7l4-4 4 4 M5 12v8h14v-8',
  up: 'M12 19V5 M6 11l6-6 6 6',
  down: 'M12 5v14 M6 13l6 6 6-6',
  table: 'M4 5h16v14H4z M4 10h16 M10 5v14',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z M9 12l2.2 2.2L15 10',
  upload: 'M12 16V4 M7 9l5-5 5 5 M4 20h16',
  undo: 'M9 7L4 12l5 5 M4 12h10a6 6 0 0 1 0 12',
  more: 'M5 12h.01 M12 12h.01 M19 12h.01',
  calendar: 'M4 6h16v14H4z M4 10h16 M8 3v4 M16 3v4',
  fingerprint: 'M12 11v3a5 5 0 0 1-1 3 M8 14a4 4 0 0 1 8 0c0 2 0 3.5-.8 5 M5.5 12a6.5 6.5 0 0 1 13 0v1 M9 21c.6-1.4 1-2.6 1-4',
};

export function icon(name, { size = 22, stroke = 1.8 } = {}) {
  const d = ICONS[name];
  if (!d) throw new Error(`未知图标：${name}`);
  return s('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': stroke, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' }, s('path', { d }));
}

export const ICON_NAMES = Object.keys(ICONS);
