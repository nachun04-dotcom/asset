// CSV 导出 / 导入模板。导出文件可以原样再导入（往返无损）。
import { BOM, escapeFormulaText, toCSV } from './csv.js';
import { formatDecimal } from './money.js';
import { hasValue, missingIds, recordedTotal, sortAsc } from './ledger.js';
import { SOURCE_LABELS, sortedCategories } from './model.js';
import { buildXlsx, XF } from './xlsx.js';

/** 导出列：所有启用的类别，加上有历史数据的已停用类别。 */
export function exportCategories(snapshots, categories) {
  const used = new Set(snapshots.flatMap((s) => Object.keys(s.entries)));
  return sortedCategories(categories).filter((c) => c.enabled || used.has(c.id));
}

const yuan = (fen) => formatDecimal(fen, 'yuan', { group: false, minDecimals: 2 });

export function exportRows(snapshots, categories) {
  const cols = exportCategories(snapshots, categories);
  const name = (id) => categories.find((c) => c.id === id)?.name ?? id;
  const header = ['日期', '单位', ...cols.map((c) => c.name), '合计', '已记录合计', '完整状态', '来源', '备注', '折算说明'];
  const rows = [header];
  for (const s of sortAsc(snapshots)) {
    const miss = missingIds(s);
    const fx = Object.entries(s.entries)
      .filter(([, e]) => e.fx)
      .map(([id, e]) => `${name(id)}：${e.fx.original} ${e.fx.currency} → ¥${yuan(e.fen)}`)
      .join('；');
    rows.push([
      s.date,
      '元',
      ...cols.map((c) => (hasValue(s.entries[c.id]) ? yuan(s.entries[c.id].fen) : '')),
      s.complete ? yuan(recordedTotal(s)) : '',
      Object.values(s.entries).some(hasValue) ? yuan(recordedTotal(s)) : '',
      s.complete ? '完整' : `不完整（缺：${miss.map(name).join('、') || '—'}）`,
      SOURCE_LABELS[s.source] ?? s.source,
      escapeFormulaText(s.note ?? ''),
      escapeFormulaText(fx),
    ]);
  }
  return rows;
}

export function exportCSV(snapshots, categories) {
  return BOM + toCSV(exportRows(snapshots, categories));
}

/* ------------------------------ 导入模板 ------------------------------ */

export function templateHeader(categories) {
  return ['日期', '单位', ...sortedCategories(categories).filter((c) => c.enabled).map((c) => c.name), '合计(可选，仅用于核对)', '备注'];
}

export function templateCSV(categories) {
  return BOM + toCSV([templateHeader(categories)]);
}

export const TEMPLATE_HELP = [
  '资产账本 · 导入模板填写说明',
  '',
  '1. 每一行是一次「资产快照」：某一天各渠道的余额。这里不记录流水。',
  '2. 日期写完整的年月日，例如 2026-10-08。没有年份的日期，导入时需要你确认年份。',
  '3. 单位列填「元」或「万元」。留空时，导入时需要你选择，App 不会替你默认。',
  '4. 金额留空 = 没有记录（未知）；填 0 = 已确认余额为零。不知道的请留空，不要用 0 代替。',
  '5. 金额只填数字，可以带小数，不要带文字或单位。',
  '6. 合计列可以不填。填了的话，只用来和各类别相加的结果核对，不一致会提示，但不会改你的数据。',
  '7. 不是人民币的资产，请先折算成人民币再填写，并在备注里写明币种和原币金额。',
  '8. 同一天已有记录时，导入预览里可以选择：跳过 / 覆盖 / 只补充空白类别。默认是跳过。',
  '9. 类别列名要和 App 里的类别名称一致；改过名称的话，请改同样的列名。',
  '10. 请在「导入模板」这张表里填写，不要改第一行的表头。',
];

export function templateXlsx(categories) {
  const header = templateHeader(categories);
  return buildXlsx([
    {
      name: '导入模板',
      rows: [header.map((v) => ({ v, s: XF.header }))],
      colWidths: header.map((h, i) => (i === 0 ? 14 : i === 1 ? 8 : h.length > 6 ? 26 : 12)),
      dateCol: 0,
      dateRows: 300,
    },
    { name: '填写说明', rows: TEMPLATE_HELP.map((t, i) => [{ v: t, s: i === 0 ? XF.header : XF.normal }]), colWidths: [90] },
  ]);
}
