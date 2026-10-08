// 导入计划：文本 / 图片文字 / CSV / Excel 都先变成「草稿」，在预览页由用户逐项确认，
// 之后才会写入账本。本文件全是纯函数：
//   draftFrom*  → 草稿（用户可修改：单位、年份、类别对应、日期、金额、备注、重复日期处理）
//   evaluateDraft → 阻断项 / 警告项 / 将要写入的快照（不改动草稿和账本）
//   buildCommit → 确认后要保存的快照列表
//
// 硬规则：
//   1. 数字对应到哪个类别，永远由用户指定。位置、数量、顺序都不能作为推断依据。
//   2. 单位（元/万元）、年份没确认前不能保存。
//   3. 空白 = 未记录，绝不当作 0；「确认为 0」必须是用户的显式选择。
//   4. 重复日期默认跳过，覆盖/合并必须用户逐条选择。

import { formatMoney, formatSigned, parseAmount } from './money.js';
import { isValidYMD, toISO } from './date.js';
import { enabledCategories, nameKey, newId } from './model.js';
import { finalizeSnapshot, hasValue } from './ledger.js';
import { checkSnapshot } from './anomalies.js';

export const SKIP_CATEGORY = '__skip';
const SOURCE_BY_KIND = { text: 'text', image: 'image', csv: 'csv', xlsx: 'xlsx' };

/* ------------------------------ 构建草稿 ------------------------------ */

function baseDraft(kind, fileName) {
  return {
    kind,
    fileName: fileName ?? null,
    unit: null,
    unitSource: null,
    baseYear: null,
    yearRollover: false,
    headerLabels: null,
    columns: [],
    rows: [],
    ignored: [],
    unparsed: [],
    zeroFill: [],
  };
}

/** 文本 / 图片识别出的文字 → 草稿。数字的类别一律为空，等用户指定。 */
export function draftFromText(parsed, { kind = 'text', fileName = null } = {}) {
  const d = baseDraft(kind, fileName);
  d.headerLabels = parsed.headerLabels;
  d.ignored = parsed.ignored ?? [];
  d.unparsed = parsed.unparsed ?? [];
  const width = Math.max(0, ...parsed.records.map((r) => r.values.length));
  d.columns = Array.from({ length: width }, (_, j) => ({ key: j, header: `第 ${j + 1} 个数`, kind: 'positional', categoryId: null, unitHint: null }));
  d.rows = parsed.records.map((rec, i) => ({
    id: `r${i}`,
    lineRef: `第 ${rec.lineNo} 行`,
    raw: rec.raw,
    date: { year: rec.year, month: rec.month, day: rec.day },
    dateRaw: rec.dateText,
    cells: rec.values.map((v, j) => ({ colKey: j, raw: v.raw, categoryId: null, conf: v.conf ?? null, lowConf: !!v.lowConf, bad: !!v.bad })),
    statedTotalRaw: rec.statedTotalRaw,
    note: rec.notes.join('\n'),
    unit: null,
    unitRaw: '',
    unitInvalid: false,
    resolution: 'skip',
    include: true,
    fixups: rec.fixups ?? [],
  }));
  // 第一条记录之前的备注：归到第一条记录，用户可在预览页修改
  if (parsed.looseNotes?.length && d.rows.length) {
    const lead = parsed.looseNotes.map((n) => n.text).join('\n');
    d.rows[0].note = d.rows[0].note ? `${lead}\n${d.rows[0].note}` : lead;
  }
  return d;
}

/** parseTable 的结果 → 草稿。列名与类别名一致的列会自动对应，其余列等用户选择。 */
export function draftFromTable(table, { kind = 'csv', fileName = null } = {}) {
  const d = baseDraft(kind, fileName);
  d.columns = table.activeColumns.map((c, k) => ({ key: k, header: c.header, kind: c.kind, categoryId: c.categoryId, unitHint: c.unitHint }));
  if (table.headerUnit === 'yuan' || table.headerUnit === 'wan') {
    d.unit = table.headerUnit;
    d.unitSource = 'file';
  }
  d.rows = table.rows.map((r, i) => ({
    id: `r${i}`,
    lineRef: `第 ${r.rowNo} 行`,
    raw: '',
    date: r.date,
    dateRaw: r.dateRaw,
    cells: r.cells.map((c, k) => ({ colKey: k, raw: c.raw, categoryId: d.columns[k].categoryId, conf: null, lowConf: false, bad: false })),
    statedTotalRaw: r.statedTotalRaw,
    note: r.note,
    unit: r.unit,
    unitRaw: r.unitRaw,
    unitInvalid: r.unitInvalid,
    resolution: 'skip',
    include: true,
    fixups: [],
  }));
  return d;
}

/* ------------------------------ 草稿的修改操作（给预览页用） ------------------------------ */

/** 把某一列/某个位置的所有数字都指定为同一类别（或 SKIP_CATEGORY = 不导入）。这是用户的显式操作。 */
export function applyColumnMapping(draft, colKey, categoryId) {
  const col = draft.columns.find((c) => c.key === colKey);
  if (col) col.categoryId = categoryId;
  for (const row of draft.rows) for (const cell of row.cells) if (cell.colKey === colKey) cell.categoryId = categoryId;
}

/** 原文表头与每行数字个数完全一致、且每个表头都能对上现有类别时，给出按表头顺序的类别 id 列表；否则 null。 */
export function headerOrderMapping(draft, categories) {
  const labels = draft.headerLabels;
  if (!labels || labels.length === 0 || labels.length !== draft.columns.length) return null;
  const byName = new Map(categories.map((c) => [nameKey(c.name), c.id]));
  const ids = labels.map((l) => byName.get(nameKey(l)) ?? null);
  if (ids.some((x) => !x) || new Set(ids).size !== ids.length) return null;
  return ids;
}

/** 仅当 headerOrderMapping 成立时才允许「按原文表头顺序对应」；否则什么都不改并返回 false。 */
export function applyHeaderOrder(draft, categories) {
  const ids = headerOrderMapping(draft, categories);
  if (!ids) return false;
  ids.forEach((id, j) => applyColumnMapping(draft, draft.columns[j].key, id));
  return true;
}

export function setZeroFill(draft, categoryId, on) {
  const s = new Set(draft.zeroFill);
  if (on) s.add(categoryId);
  else s.delete(categoryId);
  draft.zeroFill = [...s];
}

export function setRowDate(row, iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  row.date = m ? { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) } : null;
}

/** 仅作提示：数字都不大时，更可能是「万元」。从不自动采用。 */
export function suggestUnit(draft) {
  let max = 0;
  let any = false;
  for (const row of draft.rows) {
    for (const c of row.cells) {
      const n = Number(String(c.raw).replace(/,/g, ''));
      if (Number.isFinite(n) && c.raw !== '') {
        any = true;
        max = Math.max(max, Math.abs(n));
      }
    }
  }
  return any && max <= 1000 ? { unit: 'wan', reason: `这些数字最大只有 ${max}，更像是「万元」；但这只是提示，请你确认` } : null;
}

/* ------------------------------ 评估 ------------------------------ */

function resolveDates(draft) {
  let bump = 0;
  let prev = null;
  return draft.rows.map((row) => {
    const d = row.date;
    if (!d) return { iso: null, issue: 'invalid', text: row.dateRaw ? `无法识别日期「${row.dateRaw}」` : '没有日期' };
    let year = d.year;
    if (year == null) {
      if (draft.baseYear == null) return { iso: null, issue: 'year', text: '日期没有年份，请先确认年份' };
      if (draft.yearRollover && row.include) {
        if (prev && (d.month < prev.month || (d.month === prev.month && d.day < prev.day))) bump++;
        prev = d;
      }
      year = draft.baseYear + bump;
    }
    if (!isValidYMD(year, d.month, d.day)) return { iso: null, issue: 'invalid', text: `${year}年${d.month}月${d.day}日 不是有效日期` };
    return { iso: toISO(year, d.month, d.day), issue: null, inferredYear: d.year == null };
  });
}

function mergeNotes(a, b) {
  const lines = String(a ?? '').split('\n').filter(Boolean);
  for (const l of String(b ?? '').split('\n').filter(Boolean)) if (!lines.includes(l)) lines.push(l);
  return lines.join('\n');
}

function colLabel(draft, key) {
  return draft.columns.find((c) => c.key === key)?.header ?? `第 ${key + 1} 个数`;
}

function evalRow(row, dateRes, draft, ctx, catMap, expectedIds) {
  const issues = [];
  const ev = { id: row.id, include: row.include, iso: dateRes.iso, issues, cells: [], entries: {}, zeroFilled: [], missingIds: [], status: 'ok', action: 'none', dup: null, resulting: null, unit: null, sumFen: null, statedFen: null };
  if (!row.include) {
    ev.status = 'excluded';
    return ev;
  }
  if (dateRes.issue) issues.push({ code: dateRes.issue === 'year' ? 'YEAR_UNKNOWN' : 'DATE_INVALID', level: 'block', text: dateRes.text });

  if (row.unitInvalid) issues.push({ code: 'UNIT_INVALID', level: 'block', text: `单位「${row.unitRaw}」无法识别，应为「元」或「万元」` });
  const unit = row.unitInvalid ? null : row.unit ?? draft.unit ?? null;
  ev.unit = unit;
  if (!unit && !row.unitInvalid) issues.push({ code: 'UNIT_UNKNOWN', level: 'block', text: '单位不明，请选择「元」或「万元」' });

  let sumAll = 0;
  let allParsed = true;
  let anyEmpty = false;
  const used = new Set();
  row.cells.forEach((cell, j) => {
    const raw = String(cell.raw ?? '').trim();
    const label = colLabel(draft, cell.colKey);
    if (raw === '') {
      anyEmpty = true;
      ev.cells.push({ state: 'empty' });
      return;
    }
    let fen = null;
    let state = 'ok';
    if (cell.bad) {
      state = 'error';
      allParsed = false;
      issues.push({ code: 'NOT_NUMBER', level: 'block', cell: j, text: `${label}「${raw}」的千分位写法不规范，请修改` });
    } else if (!unit) {
      state = 'pending';
      allParsed = false;
    } else {
      const p = parseAmount(raw, unit);
      if (!p.ok || p.empty) {
        state = 'error';
        allParsed = false;
        const why = p.error === 'decimals' ? '小数位过多' : p.error === 'range' ? '数值过大' : '不是有效金额';
        issues.push({ code: 'NOT_NUMBER', level: 'block', cell: j, text: `${label}「${raw}」${why}` });
      } else {
        fen = p.fen;
        sumAll += fen;
      }
    }
    const cat = cell.categoryId;
    if (cat === SKIP_CATEGORY) {
      state = state === 'ok' || state === 'pending' ? 'skipped' : state;
    } else if (!cat) {
      state = state === 'error' ? 'error' : 'unmapped';
      issues.push({ code: 'UNMAPPED', level: 'block', cell: j, text: `${label}「${raw}」还没有指定类别` });
    } else if (!catMap.has(cat)) {
      issues.push({ code: 'UNKNOWN_CATEGORY', level: 'block', cell: j, text: `${label}对应的类别已不存在，请重新选择` });
    } else if (used.has(cat)) {
      issues.push({ code: 'DUP_CATEGORY', level: 'block', cell: j, text: `「${catMap.get(cat).name}」在同一条记录里被指定了两次` });
    } else {
      used.add(cat);
      if (fen != null) ev.entries[cat] = { fen };
    }
    if (cell.lowConf) {
      issues.push({ code: 'LOW_CONF', level: 'warn', cell: j, text: `「${raw}」识别置信度偏低${cell.conf != null ? `（${Math.round(cell.conf)}%）` : ''}，请对照原图核对` });
    }
    ev.cells.push({ state, fen, categoryId: cat ?? null });
  });

  if (row.fixups?.length) {
    issues.push({ code: 'FIXUP', level: 'warn', text: `识别结果经过 ${row.fixups.length} 处自动修正（如把「十」当作「+」），请对照原图核对` });
  }

  // 用户明确选择「确认为 0 元」的类别：仅对这条记录里没有金额的类别生效
  for (const id of draft.zeroFill) {
    if (catMap.has(id) && !ev.entries[id] && !used.has(id)) {
      ev.entries[id] = { fen: 0 };
      ev.zeroFilled.push(id);
    }
  }

  // 合计核对
  if (row.statedTotalRaw != null && unit) {
    const st = parseAmount(row.statedTotalRaw, unit);
    if (!st.ok || st.empty) {
      issues.push({ code: 'TOTAL_INVALID', level: 'warn', text: `原文的合计「${row.statedTotalRaw}」不是有效金额` });
    } else {
      ev.statedFen = st.fen;
      if (allParsed) {
        ev.sumFen = sumAll;
        if (sumAll !== st.fen) {
          const text = `各项相加 ${formatMoney(sumAll, unit)}，原文合计 ${formatMoney(st.fen, unit)}，相差 ${formatSigned(sumAll - st.fen, unit)}`;
          issues.push(anyEmpty ? { code: 'SUM_UNVERIFIABLE', level: 'info', text: `${text}（有未填写的类别，无法确认是否算错）` } : { code: 'SUM_MISMATCH', level: 'warn', text: `${text}，请检查是哪个数写错了` });
        }
      }
    }
  } else if (allParsed && unit) {
    ev.sumFen = sumAll;
  }

  ev.missingIds = expectedIds.filter((id) => !ev.entries[id]);
  const hasBlock = issues.some((i) => i.level === 'block');
  ev.status = hasBlock ? 'block' : issues.some((i) => i.level === 'warn') ? 'warn' : 'ok';
  return ev;
}

/**
 * 评估草稿。
 * ctx = { categories, snapshots, unit(显示单位), thresholdPct, now, newId }
 * 返回 { rows, global, counts, canCommit, warnCount, upserts }
 */
export function evaluateDraft(draft, ctx) {
  const { categories, snapshots, unit: displayUnit = 'yuan', thresholdPct = 20, now = new Date().toISOString(), newId: mkId = () => newId('s') } = ctx;
  const catMap = new Map(categories.map((c) => [c.id, c]));
  const expectedIds = enabledCategories(categories).map((c) => c.id);
  const names = (ids) => ids.map((id) => catMap.get(id)?.name ?? id).join('、');

  const dates = resolveDates(draft);
  const rows = draft.rows.map((row, i) => evalRow(row, dates[i], draft, ctx, catMap, expectedIds));
  const included = rows.filter((r) => r.include);
  const global = [];

  if (included.length === 0) global.push({ code: 'NO_ROWS', level: 'block', text: '没有可导入的记录' });
  if (included.some((r) => r.issues.some((i) => i.code === 'UNIT_UNKNOWN'))) {
    global.push({ code: 'UNIT_UNKNOWN', level: 'block', text: draft.kind === 'csv' || draft.kind === 'xlsx' ? '文件没有标明金额单位，请先选择「元」或「万元」' : '请先选择这些数字的单位：「元」还是「万元」' });
  }
  if (included.some((r) => r.issues.some((i) => i.code === 'YEAR_UNKNOWN'))) {
    global.push({ code: 'YEAR_UNKNOWN', level: 'block', text: '日期里没有年份，请先确认年份' });
  }
  // 表头里的单位标注（如「支付宝（万元）」）：各列不一致时无法逐列换算，直接拦住
  const hinted = [...new Set(draft.columns.filter((c) => c.unitHint).map((c) => c.unitHint))];
  const unitName = (u) => (u === 'wan' ? '万元' : '元');
  if (hinted.length > 1) {
    global.push({ code: 'UNIT_MIXED', level: 'block', text: `各列的表头标注的单位不一样（${draft.columns.filter((c) => c.unitHint).map((c) => `${c.header}→${unitName(c.unitHint)}`).join('、')}），无法逐列换算。请在文件里统一成同一个单位后再导入。` });
  } else if (hinted.length === 1 && draft.unit && draft.unit !== hinted[0]) {
    global.push({ code: 'UNIT_DIFFERS_FROM_FILE', level: 'warn', text: `文件表头标注的单位是「${unitName(hinted[0])}」，你现在选的是「${unitName(draft.unit)}」，请确认没有选错。` });
  }
  const dangling = draft.columns.filter((c) => c.kind === 'unknown' && !c.categoryId && draft.rows.some((r) => r.include && r.cells.some((x) => x.colKey === c.key && String(x.raw).trim() !== '')));
  if (dangling.length) {
    global.push({ code: 'UNMAPPED_COLUMN', level: 'block', text: `有 ${dangling.length} 列无法对应到类别（${dangling.map((c) => c.header).join('、')}），请选择类别或「不导入」` });
  }
  if (draft.headerLabels && draft.columns.length && draft.headerLabels.length !== draft.columns.length) {
    global.push({
      code: 'HEADER_COUNT',
      level: 'warn',
      text: `原文表头有 ${draft.headerLabels.length} 项（${draft.headerLabels.join('、')}），但每条记录最多只有 ${draft.columns.length} 个数。无法确定缺的是哪一项，请你为每个数指定类别，缺少的类别会保持「未记录」。`,
    });
  }
  if (draft.unparsed.length) {
    global.push({ code: 'UNPARSED_LINES', level: 'warn', text: `有 ${draft.unparsed.length} 行以日期开头但没能识别出金额，不会导入：${draft.unparsed.slice(0, 3).map((u) => `「${u.text}」`).join('')}${draft.unparsed.length > 3 ? '…' : ''}` });
  }
  const clean = included.filter((r) => r.status !== 'block' && r.iso);
  const common = expectedIds.filter((id) => clean.length > 0 && clean.every((r) => r.missingIds.includes(id)));
  if (common.length) {
    global.push({
      code: 'COMMON_MISSING',
      level: 'warn',
      text: `${names(common)} 在这 ${clean.length} 条记录里都没有金额：它们会保存为「不完整」，不计入总资产。可以稍后逐条补录，或在上方对该类别选择「确认为 0 元」。`,
    });
  }
  for (const r of included) {
    if (r.missingIds.length) {
      const same = r.missingIds.length === common.length && r.missingIds.every((id) => common.includes(id));
      r.issues.push({ code: 'INCOMPLETE', level: same ? 'info' : 'warn', text: `缺少 ${names(r.missingIds)}，将保存为「不完整」` });
      if (!same && r.status === 'ok') r.status = 'warn';
    }
  }

  // 模拟写入：同日重复默认跳过；覆盖/合并由用户逐条选择
  const working = new Map(snapshots.map((s) => [s.date, s]));
  const origin = new Map(snapshots.map((s) => [s.date, 'ledger']));
  const lastRowForDate = new Map();
  const source = SOURCE_BY_KIND[draft.kind] ?? 'text';
  draft.rows.forEach((row, i) => {
    const ev = rows[i];
    if (!ev.include) return;
    if (ev.status === 'block' || !ev.iso) {
      ev.action = 'blocked';
      return;
    }
    const existing = working.get(ev.iso);
    if (!existing) {
      const snap = finalizeSnapshot({ id: mkId(), date: ev.iso, note: row.note, source, createdAt: now, entries: ev.entries }, expectedIds, { now });
      working.set(ev.iso, snap);
      origin.set(ev.iso, 'file');
      ev.action = 'add';
      ev.resulting = snap;
      lastRowForDate.set(ev.iso, i);
      return;
    }
    ev.dup = { type: origin.get(ev.iso), date: ev.iso, existing };
    const res = row.resolution === 'overwrite' || row.resolution === 'merge' ? row.resolution : 'skip';
    ev.action = res;
    if (res === 'skip') {
      ev.resulting = existing;
      return;
    }
    if (res === 'overwrite') {
      const snap = finalizeSnapshot({ id: existing.id, date: ev.iso, note: mergeNotes(existing.note, row.note), source, createdAt: existing.createdAt, entries: ev.entries }, expectedIds, { now });
      working.set(ev.iso, snap);
      ev.resulting = snap;
    } else {
      const entries = { ...existing.entries };
      const filled = [];
      for (const [id, e] of Object.entries(ev.entries)) {
        if (!hasValue(entries[id])) {
          entries[id] = e;
          filled.push(id);
        }
      }
      ev.mergeFilled = filled;
      const note = mergeNotes(existing.note, row.note);
      if (filled.length === 0 && note === existing.note) {
        ev.noChange = true;
        ev.resulting = existing;
      } else {
        const expected = [...new Set([...(existing.expectedIds ?? []), ...filled])];
        const snap = finalizeSnapshot({ id: existing.id, date: ev.iso, note, source: existing.source, createdAt: existing.createdAt, entries }, expected, { now });
        working.set(ev.iso, snap);
        ev.resulting = snap;
      }
    }
    origin.set(ev.iso, 'file');
    lastRowForDate.set(ev.iso, i);
  });

  // 与相邻记录相比变化明显（只提示）
  const all = [...working.values()];
  for (const [iso, i] of lastRowForDate) {
    const ev = rows[i];
    if (ev.noChange) continue;
    for (const issue of checkSnapshot(working.get(iso), { categories, snaps: all, unit: displayUnit, thresholdPct })) {
      if (issue.code === 'INCOMPLETE') continue;
      ev.issues.push(issue);
      if (issue.level === 'warn' && ev.status === 'ok') ev.status = 'warn';
    }
  }

  for (const ev of rows) {
    if (ev.dup && ev.action === 'skip') {
      ev.issues.push({ code: ev.dup.type === 'file' ? 'DUP_FILE' : 'DUP_EXISTING', level: 'warn', text: `${ev.iso} ${ev.dup.type === 'file' ? '在本次导入里已出现过' : '已有记录'}：当前选择「跳过」，不会写入` });
      if (ev.status === 'ok') ev.status = 'warn';
    } else if (ev.dup && ev.action === 'overwrite') {
      ev.issues.push({ code: 'DUP_OVERWRITE', level: 'warn', text: `${ev.iso} 已有记录：将被这条覆盖（原有各类金额会被替换）` });
      if (ev.status === 'ok') ev.status = 'warn';
    } else if (ev.dup && ev.action === 'merge') {
      ev.issues.push({ code: 'DUP_MERGE', level: 'info', text: ev.noChange ? `${ev.iso} 已有记录，且没有可补充的内容` : `${ev.iso} 已有记录：只补充空白类别（${names(ev.mergeFilled)}），已有金额不变` });
    }
  }

  const counts = { add: 0, overwrite: 0, merge: 0, skip: 0, blocked: 0, excluded: rows.filter((r) => !r.include).length };
  for (const r of rows) if (r.include) counts[r.action === 'none' ? 'blocked' : r.action] = (counts[r.action === 'none' ? 'blocked' : r.action] ?? 0) + 1;
  const writes = counts.add + counts.overwrite + counts.merge - rows.filter((r) => r.noChange).length;
  const blockers = global.filter((g) => g.level === 'block').length + included.filter((r) => r.status === 'block').length;
  const warnCount = global.filter((g) => g.level === 'warn').length + included.reduce((n, r) => n + r.issues.filter((i) => i.level === 'warn').length, 0);

  const touched = new Set();
  for (const r of rows) if (r.include && r.resulting && ['add', 'overwrite', 'merge'].includes(r.action) && !r.noChange) touched.add(r.iso);
  const upserts = [...touched].map((iso) => working.get(iso)).sort((a, b) => (a.date < b.date ? -1 : 1));

  return { rows, global, counts, warnCount, canCommit: blockers === 0 && upserts.length > 0, writes: upserts.length, upserts };
}

/** 用户确认后，取出要保存的快照。有阻断项时拒绝。 */
export function buildCommit(draft, ctx) {
  const ev = evaluateDraft(draft, ctx);
  if (!ev.canCommit) throw new Error('导入还有未解决的问题，不能保存');
  return { upserts: ev.upserts, counts: ev.counts };
}
