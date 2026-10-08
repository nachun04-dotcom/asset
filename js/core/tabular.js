// 表格（CSV / Excel）解析：把二维数组识别成「日期 + 单位 + 各类别金额 + 合计 + 备注」。
// 和文本一样只做「照实读取」：列名与类别名一致才自动对应（这是文件里写明的信息，不是猜测），
// 其余列一律交给预览页让用户选择。

import { cleanName, nameKey } from './model.js';
import { matchDate } from './textImport.js';
import { unescapeFormulaText } from './csv.js';

const RE_DATE = /^(日期|记录日期|时间|date)$/i;
const RE_UNIT = /^(单位|金额单位|unit)$/i;
const RE_NOTE = /^(备注|说明|note|notes|remark)$/i;
const RE_TOTAL = /^(合计|总额|总计|总资产|total)$/i;
const RE_INFO_ONLY = /^(已记录合计|完整状态|状态|来源|数据来源|折算说明|是否完整)$/;
const UNIT_ANNOTATION = /[(（]\s*(元|万元|万|rmb|cny)\s*[)）]\s*$/i;

export function parseDateCell(input) {
  const t = String(input ?? '').normalize('NFKC').trim();
  if (!t) return null;
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(t);
  if (compact) return { year: Number(compact[1]), month: Number(compact[2]), day: Number(compact[3]) };
  const m = matchDate(t);
  if (!m) return null;
  const rest = t.slice(m.length).trim();
  if (rest && !/^[T\s]*\d{1,2}:\d{2}(:\d{2})?(\.\d+)?Z?$/.test(rest)) return null;
  return { year: m.year, month: m.month, day: m.day };
}

/** @returns {'yuan'|'wan'|null|'invalid'} null = 没填 */
export function parseUnitCell(input) {
  const t = String(input ?? '').normalize('NFKC').trim().toLowerCase();
  if (!t) return null;
  if (['元', '人民币', '人民币元', 'rmb', 'cny', 'yuan', '¥'].includes(t)) return 'yuan';
  if (['万元', '万', '万人民币', '万rmb', 'w', 'wan'].includes(t)) return 'wan';
  return 'invalid';
}

function unitFromAnnotation(word) {
  const w = word.toLowerCase();
  return w === '万元' || w === '万' ? 'wan' : 'yuan';
}

/**
 * @param {string[][]} rows
 * @param {Array<{id:string,name:string}>} categories 全部类别（含已停用）
 */
export function parseTable(rows, categories) {
  const cell = (r, i) => String(r?.[i] ?? '').trim();
  const nonEmpty = (r) => r.some((c) => String(c ?? '').trim() !== '');

  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    if (rows[i]?.some((c) => RE_DATE.test(nameKey(c)))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return { ok: false, error: '找不到「日期」列。请使用导入模板，或确保第一行有「日期」表头。' };

  const header = rows[headerIdx];
  const byName = new Map(categories.map((c) => [nameKey(c.name), c.id]));
  const meta = { date: -1, unit: -1, note: -1, total: -1 };
  const columns = [];
  const infoOnly = [];

  header.forEach((h, index) => {
    const display = cleanName(h);
    const name = nameKey(h);
    if (!name) return;
    if (meta.date < 0 && RE_DATE.test(name)) return void (meta.date = index);
    if (meta.unit < 0 && RE_UNIT.test(name)) return void (meta.unit = index);
    if (meta.note < 0 && RE_NOTE.test(name)) return void (meta.note = index);
    if (meta.total < 0 && RE_TOTAL.test(name.replace(/[(（].*[)）]\s*$/, '').trim())) return void (meta.total = index);
    if (RE_INFO_ONLY.test(name)) return void infoOnly.push({ index, header: display });
    const ann = UNIT_ANNOTATION.exec(name);
    const base = (ann ? name.slice(0, ann.index) : name).trim();
    const categoryId = byName.get(base) ?? null;
    columns.push({ index, header: display, kind: categoryId ? 'category' : 'unknown', categoryId, unitHint: ann ? unitFromAnnotation(ann[1]) : null });
  });

  const data = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !nonEmpty(r)) continue;
    data.push({ rowNo: i + 1, r });
  }

  // 完全没有数据的未识别列：直接忽略，不打扰用户
  for (const col of columns) {
    if (col.kind === 'unknown' && !data.some(({ r }) => cell(r, col.index) !== '')) {
      col.kind = 'ignore';
      col.reason = '整列为空';
    }
  }

  const hints = new Set(columns.filter((c) => c.kind !== 'ignore' && c.unitHint).map((c) => c.unitHint));
  const headerUnit = hints.size === 0 ? null : hints.size === 1 ? [...hints][0] : 'mixed';
  const active = columns.filter((c) => c.kind !== 'ignore');

  const outRows = data.map(({ rowNo, r }) => {
    const unitRaw = meta.unit >= 0 ? cell(r, meta.unit) : '';
    const unitParsed = parseUnitCell(unitRaw);
    const dateRaw = meta.date >= 0 ? cell(r, meta.date) : '';
    return {
      rowNo,
      dateRaw,
      date: parseDateCell(dateRaw),
      unit: unitParsed === 'invalid' ? null : unitParsed,
      unitRaw,
      unitInvalid: unitParsed === 'invalid',
      cells: active.map((c) => ({ colIndex: c.index, raw: cell(r, c.index) })),
      statedTotalRaw: meta.total >= 0 && cell(r, meta.total) !== '' ? cell(r, meta.total) : null,
      note: meta.note >= 0 ? unescapeFormulaText(cell(r, meta.note)) : '',
    };
  });

  return { ok: true, headerRow: headerIdx + 1, columns, activeColumns: active, headerUnit, infoOnlyColumns: infoOnly, rows: outRows };
}
