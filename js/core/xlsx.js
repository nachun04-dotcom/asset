// 极简 .xlsx 读写：只覆盖「一张表的文字/数字/日期」，用于导入和模板，不依赖任何库。
// 读：自己解析 zip + XML（解压用浏览器/Node 自带的 DecompressionStream）。
// 写：不压缩的 zip（store），文件略大但格式最稳妥。

const te = new TextEncoder();
const td = new TextDecoder('utf-8');

/* ------------------------------ zip 读取 ------------------------------ */

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function readZipDirectory(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('不是有效的 Excel 文件（找不到 zip 目录）');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  if (count === 0xffff || p === 0xffffffff) throw new Error('暂不支持 ZIP64 格式的 Excel 文件');
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Excel 文件目录损坏');
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);
    const name = td.decode(u8.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, { name, method, compSize, size, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { u8, dv, entries };
}

export async function readZipEntry(zip, name) {
  const e = zip.entries.get(name);
  if (!e) return null;
  const { u8, dv } = zip;
  if (dv.getUint32(e.localOffset, true) !== 0x04034b50) throw new Error('Excel 文件损坏');
  const start = e.localOffset + 30 + dv.getUint16(e.localOffset + 26, true) + dv.getUint16(e.localOffset + 28, true);
  const data = u8.subarray(start, start + e.compSize);
  if (e.method === 0) return data;
  if (e.method === 8) return inflateRaw(data);
  throw new Error(`不支持的压缩方式 ${e.method}`);
}

async function readText(zip, name) {
  const b = await readZipEntry(zip, name);
  return b ? td.decode(b) : null;
}

/* ------------------------------ XML 小工具 ------------------------------ */

export function decodeXml(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, g) => {
    if (g === 'amp') return '&';
    if (g === 'lt') return '<';
    if (g === 'gt') return '>';
    if (g === 'quot') return '"';
    if (g === 'apos') return "'";
    const code = g[1] === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : m;
  });
}

export function escapeXml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

function attr(tag, name) {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m ? decodeXml(m[1]) : null;
}

function textOfSi(xml) {
  const cleaned = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  for (const m of cleaned.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) out += decodeXml(m[1]);
  return out;
}

/* ------------------------------ 日期/数字 ------------------------------ */

const BUILTIN_DATE_FMT = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

function isDateFormatCode(code) {
  const c = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
  return /[ymdhs]/i.test(c) && !/^general$/i.test(c.trim());
}

export function excelSerialToISO(serial, date1904 = false) {
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const dt = new Date(base + Math.floor(serial) * 86400000);
  const p = (n) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

/** Excel 里的 27.599999999999998 这类浮点噪音，按 15 位有效数字还原成 27.6。 */
export function cleanNumberString(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  const s = String(Number(n.toPrecision(15)));
  if (!/e/i.test(s)) return s;
  return n.toFixed(8).replace(/\.?0+$/, '');
}

function colIndex(ref) {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/* ------------------------------ xlsx 读取 ------------------------------ */

/**
 * 读取 .xlsx 的一张表，返回 { sheetName, sheetNames, rows: string[][] }。
 * 所有单元格都转成字符串：数字保留原值（去浮点噪音），日期转 YYYY-MM-DD。
 * @param {Uint8Array|ArrayBuffer} bytes
 * @param {{prefer?: string[]}} opts prefer：优先选用的工作表名
 */
export async function readXlsx(bytes, { prefer = ['导入模板'] } = {}) {
  const zip = readZipDirectory(bytes);
  const workbook = await readText(zip, 'xl/workbook.xml');
  if (!workbook) throw new Error('不是有效的 .xlsx 文件（缺少 workbook.xml）。旧版 .xls 请先在 Excel 里另存为 .xlsx 或 CSV');
  const rels = (await readText(zip, 'xl/_rels/workbook.xml.rels')) ?? '';
  const relTarget = new Map();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id');
    let target = attr(m[0], 'Target') ?? '';
    target = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    relTarget.set(id, target);
  }
  const date1904 = /<workbookPr\b[^>]*date1904="(1|true)"/.test(workbook);
  const sheets = [];
  for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(m[0], 'name');
    const rid = attr(m[0], 'r:id') ?? attr(m[0], 'id');
    if (name && relTarget.get(rid)) sheets.push({ name, path: relTarget.get(rid) });
  }
  if (sheets.length === 0) throw new Error('Excel 文件里没有工作表');

  const shared = [];
  const sst = await readText(zip, 'xl/sharedStrings.xml');
  if (sst) for (const m of sst.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) shared.push(textOfSi(m[1]));

  const dateStyle = new Set();
  const styles = await readText(zip, 'xl/styles.xml');
  if (styles) {
    const custom = new Map();
    for (const m of styles.matchAll(/<numFmt\b[^>]*>/g)) custom.set(Number(attr(m[0], 'numFmtId')), attr(m[0], 'formatCode') ?? '');
    const block = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? '';
    let idx = 0;
    for (const m of block.matchAll(/<xf\b[^>]*?(?:\/>|>)/g)) {
      const id = Number(attr(m[0], 'numFmtId') ?? 0);
      if (BUILTIN_DATE_FMT.has(id) || (custom.has(id) && isDateFormatCode(custom.get(id)))) dateStyle.add(idx);
      idx++;
    }
  }

  async function readSheet(sheet) {
    const xml = await readText(zip, sheet.path);
    if (!xml) return [];
    const rows = [];
    for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const rowNum = Number(attr(rm[1], 'r') ?? rows.length + 1);
      const cells = [];
      for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attr(cm[1], 'r') ?? '';
        const t = attr(cm[1], 't');
        const s = Number(attr(cm[1], 's') ?? 0);
        const inner = cm[2] ?? '';
        const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        let val = '';
        if (t === 's') val = shared[Number(v)] ?? '';
        else if (t === 'inlineStr') val = textOfSi(inner);
        else if (t === 'str') val = v == null ? '' : decodeXml(v);
        else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
        else if (t === 'e') val = '';
        else if (t === 'd') val = (v ?? '').slice(0, 10);
        else if (v != null && v !== '') val = dateStyle.has(s) ? excelSerialToISO(Number(v), date1904) : cleanNumberString(v);
        cells[ref ? colIndex(ref) : cells.length] = val;
      }
      rows[rowNum - 1] = Array.from(cells, (x) => x ?? '');
    }
    return Array.from(rows, (r) => r ?? []);
  }

  const nonEmpty = (rows) => rows.some((r) => r.some((c) => String(c).trim() !== ''));
  const ordered = [...sheets.filter((s) => prefer.includes(s.name)), ...sheets.filter((s) => !prefer.includes(s.name))];
  for (const sheet of ordered) {
    const rows = await readSheet(sheet);
    if (nonEmpty(rows)) return { sheetName: sheet.name, sheetNames: sheets.map((s) => s.name), rows };
  }
  return { sheetName: sheets[0].name, sheetNames: sheets.map((s) => s.name), rows: [] };
}

/* ------------------------------ zip 写入（store） ------------------------------ */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function writeZip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  const push = (u8) => {
    parts.push(u8);
    offset += u8.length;
  };
  for (const [name, content] of files) {
    const nameB = te.encode(name);
    const data = typeof content === 'string' ? te.encode(content) : content;
    const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true); // UTF-8 文件名
    lh.setUint16(8, 0, true); // store
    lh.setUint16(10, 0, true);
    lh.setUint16(12, 0x21, true); // 1980-01-01
    lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true);
    lh.setUint32(22, data.length, true);
    lh.setUint16(26, nameB.length, true);
    lh.setUint16(28, 0, true);
    const localOffset = offset;
    push(new Uint8Array(lh.buffer));
    push(nameB);
    push(data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, 0, true);
    ch.setUint16(14, 0x21, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true);
    ch.setUint32(24, data.length, true);
    ch.setUint16(28, nameB.length, true);
    ch.setUint32(42, localOffset, true);
    central.push(new Uint8Array(ch.buffer), nameB);
  }
  const cdStart = offset;
  for (const c of central) push(c);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, files.length, true);
  eocd.setUint16(10, files.length, true);
  eocd.setUint32(12, offset - cdStart, true);
  eocd.setUint32(16, cdStart, true);
  push(new Uint8Array(eocd.buffer));
  const out = new Uint8Array(offset);
  let p = 0;
  for (const part of parts) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

/* ------------------------------ xlsx 写入（模板用） ------------------------------ */

export const XF = Object.freeze({ normal: 0, header: 1, date: 2, wrap: 3, hint: 4 });

function colName(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function sheetXml({ rows, colWidths = [], dateCol = null, dateRows = 0 }) {
  const cols = colWidths.length
    ? `<cols>${colWidths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    : '';
  const out = [];
  const total = Math.max(rows.length, dateRows ? dateRows + 1 : 0);
  for (let r = 0; r < total; r++) {
    const cells = [];
    const row = rows[r] ?? [];
    const width = Math.max(row.length, dateCol != null && r > 0 && r <= dateRows ? dateCol + 1 : 0);
    for (let c = 0; c < width; c++) {
      const spec = row[c];
      const ref = `${colName(c)}${r + 1}`;
      const isDateSlot = dateCol === c && r > 0 && r <= dateRows;
      if (spec == null || spec === '') {
        if (isDateSlot) cells.push(`<c r="${ref}" s="${XF.date}"/>`);
        continue;
      }
      const { v, s = XF.normal } = typeof spec === 'object' ? spec : { v: spec };
      if (typeof v === 'number') cells.push(`<c r="${ref}" s="${s}"><v>${v}</v></c>`);
      else cells.push(`<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(v)}</t></is></c>`);
    }
    if (cells.length) out.push(`<row r="${r + 1}">${cells.join('')}</row>`);
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${out.join('')}</sheetData></worksheet>`;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF777777"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE6EEE9"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF8FA39A"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

/**
 * 生成 .xlsx。sheets: [{name, rows:[[string|number|{v,s}]], colWidths?, dateCol?, dateRows?}]
 * 单元格内容一律用内联字符串，不需要 sharedStrings。
 */
export function buildXlsx(sheets) {
  const files = [];
  files.push([
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
      .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
      .join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
  ]);
  files.push([
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  ]);
  files.push([
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
      .map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join('')}</sheets></workbook>`,
  ]);
  files.push([
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
      .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
      .join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  ]);
  files.push(['xl/styles.xml', STYLES_XML]);
  sheets.forEach((s, i) => files.push([`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)]));
  return writeZip(files);
}
