// 导入预览校对页：所有来源（图片 / 文本 / CSV / Excel）都先到这里，逐项确认后才写入账本。
// 这一页上的每个控件都直接修改「草稿」，每次修改后重新评估；草稿不等于账本，关掉页面不会留下任何东西。
import { h } from '../dom.js';
import { alertDialog, button, closeAllSheets, confirmDialog, issueList, openSheet, promptDialog, seg, toast } from '../components.js';
import { catIcon } from '../fmt.js';
import { SKIP_CATEGORY, applyColumnMapping, applyHeaderOrder, buildCommit, evaluateDraft, headerOrderMapping, setRowDate, setZeroFill, suggestUnit } from '../../core/importPlan.js';
import { formatDecimal, formatMoney } from '../../core/money.js';
import { formatDateZh, isValidYMD } from '../../core/date.js';
import { sortedCategories } from '../../core/model.js';
import { recordedTotal } from '../../core/ledger.js';

const KIND_LABEL = { text: '粘贴的文本', image: '图片识别结果（本机识别）', csv: 'CSV 文件', xlsx: 'Excel 文件' };

const both = (fen, unit) => (unit === 'wan' ? `${formatMoney(fen, 'yuan')}（${formatDecimal(fen, 'wan')} 万）` : formatMoney(fen, 'yuan'));

export function openImportPreview(ctx, draft, { imageUrl = null } = {}) {
  const { store, nav } = ctx;
  const syncs = [];
  let touched = false;
  let ev = null;
  const ack = { on: false, n: 0 };

  const evalCtx = () => ({ categories: store.state.categories, snapshots: store.state.snapshots, unit: store.state.settings.unit, thresholdPct: store.state.settings.changeThresholdPct });
  const cats = () => sortedCategories(store.state.categories);
  const catName = (id) => store.state.categories.find((c) => c.id === id)?.name ?? id;

  const change = () => {
    touched = true;
    refresh();
  };

  /* ------------------------------ 顶部说明 ------------------------------ */
  const globalBox = h('div', { class: 'stack', 'aria-live': 'polite' });
  const top = h(
    'div',
    { class: 'stack' },
    h('p', { class: 'muted small' }, `来源：${KIND_LABEL[draft.kind] ?? draft.kind}${draft.fileName ? `「${draft.fileName}」` : ''}，共 ${draft.rows.length} 条记录。请逐项核对，点最下面的「确认并保存」之前，不会写入任何数据。`),
    imageUrl ? h('img', { class: 'thumb', src: imageUrl, alt: '你选择的原图，用来对照识别结果', onClick: (e) => (e.target.style.maxHeight = e.target.style.maxHeight ? '' : 'none') }) : null,
    imageUrl ? h('p', { class: 'hint', style: 'margin-top:-6px' }, '点图片可放大/缩小。识别可能出错，请对照原图核对每一个数字。') : null,
    draft.ignored.length ? h('p', { class: 'hint' }, `已忽略 ${draft.ignored.length} 行（备忘录标题、状态栏等）。`) : null,
    globalBox,
  );

  /* ------------------------------ ① 单位 ------------------------------ */
  const unitHint = h('p', { class: 'hint' });
  const rowUnitCount = draft.rows.filter((r) => r.unit).length;
  const unitCard = h(
    'section',
    { class: 'card flat stack' },
    h('div', { class: 'card-title' }, '金额单位'),
    h('p', {}, draft.kind === 'csv' || draft.kind === 'xlsx' ? '文件里的金额是「元」还是「万元」？' : '这些数字是「元」还是「万元」？没有选之前不能保存。'),
    seg([{ value: 'yuan', label: '元' }, { value: 'wan', label: '万元' }], draft.unit, (v) => {
      draft.unit = v;
      draft.unitSource = 'user';
      change();
    }, { block: true, label: '金额单位' }),
    unitHint,
    rowUnitCount ? h('p', { class: 'hint' }, `文件里有 ${rowUnitCount} 行单独标注了单位，那几行以它自己的标注为准。`) : null,
  );
  const suggested = !draft.unit && rowUnitCount === 0 ? suggestUnit(draft) : null;
  unitHint.textContent = draft.unitSource === 'file' ? '已按文件表头的标注选好，请确认。' : suggested ? suggested.reason : '';

  /* ------------------------------ ② 年份 ------------------------------ */
  const needsYear = draft.rows.some((r) => r.date && r.date.year == null);
  const yearChips = h('div', { class: 'chips' });
  let yearCard = null;
  const drawYears = () => {
    const y = new Date().getFullYear();
    const years = [...new Set([y - 2, y - 1, y, ...(draft.baseYear ? [draft.baseYear] : [])])].sort();
    yearChips.replaceChildren(
      ...years.map((yy) =>
        h('button', { type: 'button', class: 'chip', 'aria-pressed': String(draft.baseYear === yy), onClick: () => { draft.baseYear = yy; change(); } }, `${yy} 年`),
      ),
      h('button', { type: 'button', class: 'chip', onClick: async () => {
        const v = await promptDialog({ title: '其他年份', placeholder: '例如 2025', type: 'text', validate: (t) => (/^\d{4}$/.test(t.trim()) && isValidYMD(Number(t.trim()), 1, 1) ? '' : '请输入 4 位数的年份') });
        if (v) {
          draft.baseYear = Number(v.trim());
          change();
        }
      } }, '其他…'),
    );
  };
  if (needsYear) {
    drawYears();
    yearCard = h(
      'section',
      { class: 'card flat stack' },
      h('div', { class: 'card-title' }, '年份'),
      h('p', {}, '记录里的日期没有写年份，App 不会替你猜。请选择第一条记录所在的年份：'),
      yearChips,
      h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: draft.yearRollover, onChange: (e) => { draft.yearRollover = e.target.checked; change(); } }), h('span', {}, '记录是从早到晚排列的，月份变小时算作下一年（例如 12 月之后出现 1 月）')),
      h('p', { class: 'hint' }, '选好后，下面每条记录都会显示完整日期，请逐条核对；也可以在每条记录里直接改日期。'),
    );
  }

  /* ------------------------------ ③ 类别对应 ------------------------------ */
  const mapBody = h('div', { class: 'stack' });
  const headerBtnBox = h('div', {});
  const isText = draft.kind === 'text' || draft.kind === 'image';
  const colSelects = [];
  for (const col of draft.columns) {
    const examples = draft.rows
      .map((r) => r.cells.find((c) => c.colKey === col.key)?.raw)
      .filter((x) => x)
      .slice(0, 3)
      .join('、');
    const sel = h('select', { 'aria-label': `${col.header} 对应的类别` }, h('option', { value: '' }, '— 请选择类别 —'), h('option', { value: '__mixed', disabled: true }, '各条不同（在下面逐条设置）'), ...cats().map((c) => h('option', { value: c.id }, c.name + (c.enabled ? '' : '（已停用）'))), h('option', { value: SKIP_CATEGORY }, '不导入这个数'));
    sel.addEventListener('change', () => {
      applyColumnMapping(draft, col.key, sel.value || null);
      change();
    });
    colSelects.push({ col, sel });
    mapBody.appendChild(h('div', { class: 'field' }, h('label', {}, `${col.header}`, examples ? h('span', { class: 'muted' }, `　例如 ${examples}`) : null), sel));
  }
  const mapCard = draft.columns.length
    ? h(
        'section',
        { class: 'card flat stack' },
        h('div', { class: 'card-title' }, '每个数对应哪个类别'),
        h('p', { class: 'small' }, isText ? `每条记录里的数字个数可能比类别少，App 不会按顺序去猜哪个数是哪一类。请为每个数指定类别；某条记录里不一样的，可以在下面那条记录里单独改。` : '列名能对上类别的已经自动对应，请核对；对不上的列请选择类别，或选「不导入」。'),
        headerBtnBox,
        mapBody,
      )
    : null;

  /* ------------------------------ ④ 缺少的类别 ------------------------------ */
  const zeroBody = h('div', { class: 'stack' });
  const zeroCard = h('section', { class: 'card flat stack', hidden: true }, h('div', { class: 'card-title' }, '没有金额的类别'), h('p', { class: 'small' }, '下面这些类别在记录里没有金额。默认保持「未记录」（它不等于 0），这些记录会标为「不完整」。只有你确定余额就是 0 时，才选「确认为 0 元」。'), zeroBody);

  /* ------------------------------ ⑤ 记录 ------------------------------ */
  const rowViews = draft.rows.map((row, i) => buildRow(row, i));
  const rowsBox = h('div', { class: 'stack' }, ...rowViews.map((v) => v.el));

  function buildRow(row, idx) {
    const include = h('input', { type: 'checkbox', checked: row.include, 'aria-label': `导入第 ${idx + 1} 条` });
    include.addEventListener('change', () => {
      row.include = include.checked;
      change();
    });
    const dateInput = h('input', { type: 'date', 'aria-label': `${row.lineRef}的日期`, min: '1900-01-01', max: '2200-12-31' });
    dateInput.addEventListener('change', () => {
      setRowDate(row, dateInput.value);
      change();
    });
    const dateText = h('div', { class: 'small' });
    const cells = row.cells.map((cell, j) => {
      const amt = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', value: cell.raw, 'aria-label': `${row.lineRef}第 ${j + 1} 个金额` });
      amt.addEventListener('input', () => {
        cell.raw = amt.value;
        cell.bad = false;
        cell.lowConf = false;
        change();
      });
      const sel = h('select', { 'aria-label': `${row.lineRef}第 ${j + 1} 个金额的类别` }, h('option', { value: '' }, '— 选择类别 —'), ...cats().map((c) => h('option', { value: c.id }, c.name + (c.enabled ? '' : '（已停用）'))), h('option', { value: SKIP_CATEGORY }, '不导入'));
      sel.addEventListener('change', () => {
        cell.categoryId = sel.value || null;
        change();
      });
      const cap = h('div', { class: 'cap hint' });
      const el = h('div', { class: 'pv-cell' }, amt, sel, cap);
      return { el, amt, sel, cap, cell };
    });
    const sum = h('div', { class: 'pv-sum' });
    const note = h('textarea', { rows: '1', placeholder: '备注（可不填）', 'aria-label': `${row.lineRef}的备注`, maxlength: 500 }, row.note);
    note.value = row.note;
    note.addEventListener('input', () => {
      row.note = note.value;
      touched = true;
    });
    const unitSel = h('select', { 'aria-label': `${row.lineRef}的单位` }, h('option', { value: '' }, '单位：跟随上面的选择'), h('option', { value: 'yuan' }, '这一行按「元」'), h('option', { value: 'wan' }, '这一行按「万元」'));
    unitSel.addEventListener('change', () => {
      row.unit = unitSel.value || null;
      row.unitInvalid = false;
      change();
    });
    const showUnitSel = !!(row.unit || row.unitRaw);
    const dupSel = h('select', { 'aria-label': `${row.lineRef}遇到同一天已有记录时` }, h('option', { value: 'skip' }, '跳过（不写入，保留已有记录）'), h('option', { value: 'merge' }, '只补充空白的类别（已有金额不动）'), h('option', { value: 'overwrite' }, '用这一条覆盖已有记录'));
    dupSel.addEventListener('change', () => {
      row.resolution = dupSel.value;
      change();
    });
    const dupText = h('div', { class: 'small' });
    const dupBox = h('div', { class: 'stack', hidden: true, style: 'gap:8px' }, dupText, dupSel);
    const issues = h('div', {});
    const outcome = h('span', { class: 'tag' });
    const result = h('div', { class: 'small muted' });
    const raw = row.raw ? h('div', { class: 'raw' }, `原文（第 ${row.lineRef.replace(/\D/g, '')} 行）：${row.raw}`) : null;

    const el = h(
      'div',
      { class: 'pv-row' },
      h('div', { class: 'row between' }, h('label', { class: 'check' }, include, h('span', {}, h('b', {}, `第 ${idx + 1} 条`), row.raw ? null : h('span', { class: 'muted small' }, `（文件${row.lineRef}）`), ' ', outcome)), dateText),
      raw,
      h('div', { class: 'field' }, h('label', {}, row.dateRaw ? `日期（原文：${row.dateRaw}）` : '日期'), dateInput),
      h('div', { class: 'pv-cells' }, ...cells.map((c) => c.el)),
      sum,
      showUnitSel ? unitSel : null,
      h('div', { class: 'field' }, note),
      dupBox,
      issues,
      result,
    );

    const update = (e) => {
      el.classList.toggle('block', e.status === 'block');
      el.classList.toggle('warn', e.status === 'warn');
      el.classList.toggle('off', !row.include);
      include.checked = row.include;
      outcome.textContent = !row.include ? '不导入' : { add: '将新增', overwrite: '将覆盖', merge: e.noChange ? '无可补充' : '将补充', skip: '跳过', blocked: '有问题', none: '' }[e.action] ?? '';
      dateText.textContent = e.iso ? formatDateZh(e.iso, { weekday: true }) : '日期待确认';
      dateText.className = e.iso ? 'small' : 'small err';
      if (document.activeElement !== dateInput) dateInput.value = e.iso ?? '';
      cells.forEach((c, j) => {
        const ce = e.cells[j];
        if (document.activeElement !== c.amt) c.amt.value = c.cell.raw;
        c.sel.value = c.cell.categoryId ?? '';
        c.el.classList.toggle('err', ce?.state === 'error' || ce?.state === 'unmapped');
        const unit = e.unit;
        let text = '';
        if (!ce || ce.state === 'empty') text = '空白：这个类别保持「未记录」，不当作 0';
        else if (ce.state === 'error') text = '这个数无法识别，请修改';
        else if (ce.state === 'pending') text = '先在上面选择单位';
        else if (ce.state === 'skipped') text = '不导入这个数';
        else if (ce.state === 'unmapped') text = ce.fen != null ? `${unit === 'wan' ? `${c.cell.raw} 万元 = ` : ''}${formatMoney(ce.fen, 'yuan')} · 还没有指定类别` : '还没有指定类别';
        else text = `${unit === 'wan' ? `${c.cell.raw} 万元 = ` : ''}${formatMoney(ce.fen, 'yuan')}`;
        c.cap.textContent = text + (c.cell.lowConf ? '　⚠ 识别不确定，请对照原图' : '');
        c.cap.style.color = ce?.state === 'error' || ce?.state === 'unmapped' || c.cell.lowConf ? 'var(--bad)' : '';
      });
      if (e.sumFen != null && row.include) {
        const mismatch = e.issues.some((i) => i.code === 'SUM_MISMATCH');
        const same = e.statedFen != null && e.statedFen === e.sumFen;
        sum.className = `pv-sum${mismatch ? ' bad' : ''}`;
        sum.replaceChildren(
          h('span', {}, `各项相加 ${both(e.sumFen, e.unit)}`),
          e.statedFen != null ? h('span', {}, `原文合计 ${both(e.statedFen, e.unit)} ${same ? '✓ 一致' : mismatch ? '✗ 不一致' : '（有空白类别，无法核对）'}`) : null,
        );
        sum.hidden = false;
      } else sum.hidden = true;
      if (showUnitSel) unitSel.value = row.unit ?? '';
      dupBox.hidden = !(e.dup && row.include);
      if (e.dup && row.include) {
        dupSel.value = row.resolution ?? 'skip';
        const ex = e.dup.existing;
        const names = Object.entries(ex.entries).map(([id, v]) => `${catName(id)} ${formatMoney(v.fen, 'yuan')}`);
        dupText.textContent = `${formatDateZh(e.iso)}${e.dup.type === 'file' ? '在本次导入的前面已经出现过' : '已经有一条记录'}（${ex.complete ? '完整' : '不完整'}）：${names.join('、') || '没有金额'}。要怎么处理？`;
      }
      issues.replaceChildren(e.issues.length && row.include ? issueList(e.issues) : '');
      result.replaceChildren();
      if (row.include && e.resulting && ['add', 'overwrite', 'merge'].includes(e.action) && !e.noChange) {
        const r = e.resulting;
        result.append(`保存后：${r.complete ? '完整，总资产' : '不完整，已记录合计'} ${formatMoney(recordedTotal(r), 'yuan')}`);
      }
    };
    return { el, update };
  }

  /* ------------------------------ 底部确认栏 ------------------------------ */
  const sumText = h('div', { class: 'small', 'aria-live': 'polite' });
  const blockText = h('div', { class: 'small err' });
  const ackCheck = h('input', { type: 'checkbox' });
  ackCheck.addEventListener('change', () => {
    ack.on = ackCheck.checked;
    ack.n = ev?.warnCount ?? 0;
    refresh();
  });
  const ackRow = h('label', { class: 'check small', hidden: true }, ackCheck, h('span', {}, ''));
  const saveBtn = button('确认并保存', commit, { block: true, iconName: 'check' });
  const footer = h('div', { class: 'confirm-bar' }, sumText, blockText, ackRow, saveBtn);

  /* ------------------------------ 刷新 ------------------------------ */
  function refresh() {
    ev = evaluateDraft(draft, evalCtx());
    if (ack.on && ack.n !== ev.warnCount) {
      ack.on = false;
      ackCheck.checked = false;
    }

    globalBox.replaceChildren(ev.global.length ? issueList(ev.global) : '');
    if (needsYear) drawYears();

    // 类别对应：每列显示共同的类别；不一致显示「各条不同」
    for (const { col, sel } of colSelects) {
      const ids = new Set(draft.rows.flatMap((r) => r.cells.filter((c) => c.colKey === col.key).map((c) => c.categoryId ?? '')));
      sel.value = ids.size === 1 ? [...ids][0] : '__mixed';
    }
    const order = headerOrderMapping(draft, store.state.categories);
    headerBtnBox.replaceChildren(
      order
        ? button(`按原文表头顺序对应（${order.map(catName).join('、')}）`, () => {
            applyHeaderOrder(draft, store.state.categories);
            change();
          }, { kind: 'secondary', sm: true })
        : '',
    );

    // 缺少的类别
    const missing = new Set(draft.zeroFill);
    for (const r of ev.rows) if (r.include) for (const id of r.missingIds) missing.add(id);
    zeroCard.hidden = missing.size === 0;
    zeroBody.replaceChildren(
      ...[...missing]
        .filter((id) => store.state.categories.some((c) => c.id === id))
        .map((id) => {
          const cat = store.state.categories.find((c) => c.id === id);
          return h('div', { class: 'row between' }, h('span', { class: 'name', style: 'display:inline-flex;gap:8px;align-items:center;font-weight:600' }, catIcon(cat, store.state.categories, { size: 26 }), cat.name), seg([{ value: 'no', label: '保持未记录' }, { value: 'zero', label: '确认为 0 元' }], draft.zeroFill.includes(id) ? 'zero' : 'no', (v) => {
            setZeroFill(draft, id, v === 'zero');
            change();
          }, { label: `${cat.name}没有金额时` }));
        }),
    );

    rowViews.forEach((v, i) => v.update(ev.rows[i]));

    // 确认栏
    const c = ev.counts;
    const parts = [];
    if (c.add) parts.push(`新增 ${c.add} 条`);
    if (c.overwrite) parts.push(`覆盖 ${c.overwrite} 条`);
    if (c.merge) parts.push(`补充 ${c.merge} 条`);
    if (c.skip) parts.push(`跳过 ${c.skip} 条`);
    if (c.blocked) parts.push(`${c.blocked} 条有问题`);
    if (c.excluded) parts.push(`不导入 ${c.excluded} 条`);
    sumText.textContent = parts.length ? `将：${parts.join('，')}` : '';
    const blockers = ev.global.filter((g) => g.level === 'block');
    blockText.textContent = ev.canCommit ? '' : blockers[0]?.text ?? (c.blocked ? `还有 ${c.blocked} 条记录有问题，请看标红的记录` : ev.rows.some((r) => r.include) ? '没有会被写入的记录' : '没有可导入的记录');
    ackRow.hidden = !(ev.canCommit && ev.warnCount > 0);
    ackRow.lastChild.textContent = `我已看过上面的 ${ev.warnCount} 条提示，仍然保存`;
    saveBtn.disabled = !(ev.canCommit && (ev.warnCount === 0 || ack.on));
  }

  async function commit() {
    if (saveBtn.disabled) return;
    saveBtn.disabled = true;
    let plan;
    try {
      plan = buildCommit(draft, evalCtx());
    } catch (e) {
      refresh();
      return alertDialog({ title: '还不能保存', message: e.message });
    }
    const res = await store.commitImport(plan.upserts);
    if (!res.ok) {
      refresh();
      return alertDialog({ title: '没有保存', message: res.message });
    }
    touched = false;
    await closeAllSheets();
    toast(`已导入 ${res.count} 条记录`);
    nav.goto('history');
  }

  const body = h('div', { class: 'stack' }, top, unitCard, yearCard, mapCard, zeroCard, h('section', { class: 'stack' }, h('div', { class: 'section-title', style: 'margin:6px 0 0' }, `逐条核对（${draft.rows.length} 条）`), rowsBox));
  const sheet = openSheet({
    title: '核对并确认导入',
    body,
    footer,
    beforeClose: async () => !touched || confirmDialog({ title: '放弃这次导入？', message: '你在预览页做的修改会丢失，账本不会有任何变化。', confirmText: '放弃', cancelText: '继续核对', danger: true }),
    onClose: () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    },
  });
  refresh();
  return sheet;
}
