// CSV 读写（RFC 4180）+ 编码识别。不依赖任何库。

export const BOM = '﻿';

/** 字节 → 文本。优先 UTF-8；失败则按 GB18030 解码（国内 Excel「另存为 CSV」常见编码）。 */
export function decodeBytes(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length >= 2 && u8[0] === 0xff && u8[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(u8.subarray(2)), encoding: 'utf-16le' };
  if (u8.length >= 2 && u8[0] === 0xfe && u8[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(u8.subarray(2)), encoding: 'utf-16be' };
  const body = u8.length >= 3 && u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf ? u8.subarray(3) : u8;
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(body), encoding: 'utf-8' };
  } catch {
    try {
      return { text: new TextDecoder('gb18030').decode(body), encoding: 'gb18030' };
    } catch {
      return { text: new TextDecoder('utf-8').decode(body), encoding: 'utf-8-lossy' };
    }
  }
}

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
  let inQ = false;
  const counts = { ',': 0, ';': 0, '\t': 0 };
  for (const ch of firstLine) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch in counts) counts[ch]++;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : ',';
}

/** 文本 → 二维数组。支持引号、转义引号、单元格内换行、CRLF。 */
export function parseCSV(input) {
  let text = String(input ?? '');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const delim = detectDelimiter(text);
  const rows = [];
  let row = [];
  let cell = '';
  let inQ = false;
  let i = 0;
  const pushCell = () => {
    row.push(cell);
    cell = '';
  };
  const pushRow = () => {
    pushCell();
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQ = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && cell === '') {
      inQ = true;
      i++;
    } else if (ch === delim) {
      pushCell();
      i++;
    } else if (ch === '\r') {
      pushRow();
      i += text[i + 1] === '\n' ? 2 : 1;
    } else if (ch === '\n') {
      pushRow();
      i++;
    } else {
      cell += ch;
      i++;
    }
  }
  if (cell !== '' || row.length > 0) pushRow();
  return rows;
}

/** 防止公式注入：以 = + - @ 开头的文字加一个撇号（导入时会还原）。数字单元格不走这里。 */
export function escapeFormulaText(s) {
  const t = String(s ?? '');
  return /^[=+\-@\t\r]/.test(t) ? `'${t}` : t;
}

export function unescapeFormulaText(s) {
  const t = String(s ?? '');
  return /^'[=+\-@\t\r]/.test(t) ? t.slice(1) : t;
}

function quoteCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 二维数组 → CSV 文本（CRLF，UTF-8 BOM 由调用方决定是否加）。 */
export function toCSV(rows) {
  return rows.map((r) => r.map(quoteCell).join(',')).join('\r\n') + '\r\n';
}
