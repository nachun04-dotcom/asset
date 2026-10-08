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
  // —— 类别图标（线条风格，与上面的界面图标同一套笔画）——
  wallet: 'M3.5 8h16a1 1 0 0 1 1 1v9.5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z M3.5 8V6.5A1.5 1.5 0 0 1 5 5h11 M16.5 14h.01',
  chat: 'M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z M8.5 11h.01 M12 11h.01 M15.5 11h.01',
  card: 'M3 6.5A1.5 1.5 0 0 1 4.5 5h15A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z M3 10h18 M6.5 15h3.5',
  bank: 'M3 9.5L12 4l9 5.5 M5.5 10.5v7 M9.8 10.5v7 M14.2 10.5v7 M18.5 10.5v7 M3.5 20h17',
  cash: 'M3 7h18v10H3z M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z M6.5 12h.01 M17.5 12h.01',
  coin: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M14.6 9.3c-.5-.8-1.4-1.2-2.6-1.2-1.5 0-2.6.8-2.6 2 0 2.8 5.2 1.3 5.2 4.1 0 1.2-1.1 2-2.6 2-1.2 0-2.2-.5-2.7-1.3 M12 6.5v1.6 M12 15.9v1.6',
  bitcoin: 'M9 6.5h4.2a2.5 2.5 0 0 1 0 5H9z M9 11.5h4.8a2.75 2.75 0 0 1 0 5.5H9z M9 6.5V17 M11.2 4.5v2 M11.2 17v2.2',
  safe: 'M4 4.5h16v14H4z M8 18.5v2 M16 18.5v2 M12 8.7a3.3 3.3 0 1 0 0 6.6 3.3 3.3 0 0 0 0-6.6z M12 10.4v3.2 M10.4 12h3.2',
  trend: 'M3 17l6-6 4 4 8-9 M15 6h6v6',
  chart: 'M4 20h16 M7 20v-7 M12 20V6 M17 20v-10',
  sprout: 'M12 21v-9 M12 12c0-3.5-2.5-5.5-6-5.5 0 3.5 2.5 5.5 6 5.5z M12 14.5c0-3 2.2-5 5.5-5 0 3-2.2 5-5.5 5z',
  gem: 'M6 4h12l3.5 5L12 20.5 2.5 9z M2.5 9h19 M9 4L7 9l5 11.5 M15 4l2 5-5 11.5',
  box: 'M12 3l8 4v10l-8 4-8-4V7z M4 7l8 4 8-4 M12 11v10',
  cart: 'M3 4h2.5l2 11h10.5l2-8H7 M9.5 19.5h.01 M17 19.5h.01',
  briefcase: 'M4 8h16v11H4z M9 8V5.5h6V8 M4 13h16 M11 13h2',
  car: 'M4 17v-4.5L5.8 8A1.5 1.5 0 0 1 7.2 7h9.6a1.5 1.5 0 0 1 1.4 1l1.8 4.5V17a1 1 0 0 1-1 1h-1.5a1 1 0 0 1-1-1v-1H7.5v1a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z M4 12.5h16 M7.5 14.3h.01 M16.5 14.3h.01',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M3 12h18 M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6 M9 12h6',
  heart: 'M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.6 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z',
  star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z',
  pie: 'M12 3a9 9 0 1 0 9 9h-9z M14.5 3.4A9 9 0 0 1 20.6 9.5h-6.1z',
  phone: 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z M11 18h2',
  fingerprint: 'M12 11v3a5 5 0 0 1-1 3 M8 14a4 4 0 0 1 8 0c0 2 0 3.5-.8 5 M5.5 12a6.5 6.5 0 0 1 13 0v1 M9 21c.6-1.4 1-2.6 1-4',
};

export function icon(name, { size = 22, stroke = 1.8 } = {}) {
  const d = ICONS[name];
  if (!d) throw new Error(`未知图标：${name}`);
  return s('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': stroke, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' }, s('path', { d }));
}

export const ICON_NAMES = Object.keys(ICONS);
