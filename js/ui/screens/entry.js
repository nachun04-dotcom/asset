// 记一笔 / 修改一条快照。空白 = 未记录，0 = 已确认余额为零；总额由程序计算。
import { h } from '../dom.js';
import { alertDialog, button, confirmDialog, noteBox, openSheet, seg, stamp, toast } from '../components.js';
import { catDot } from '../fmt.js';
import { UNITS, formatForInput, formatMoney, parseAmount } from '../../core/money.js';
import { formatDateZh, isISODate, relativeDaysZh, todayISO } from '../../core/date.js';
import { enabledCategories, sortedCategories } from '../../core/model.js';
import { findByDate, hasValue, isComplete, recordedTotal, sortDesc } from '../../core/ledger.js';
import { displayCategories } from '../snapshotView.js';

const newRow = () => ({ text: '', fxOn: false, cur: '', orig: '' });

export function openEntry(ctx, { id = null, date = null } = {}) {
  const { store, nav } = ctx;
  const initial = id ? store.state.snapshots.find((s) => s.id === id) : null;
  const st = { id: initial?.id ?? null, date: initial?.date ?? date ?? todayISO(), unit: store.state.settings.unit, rows: new Map(), note: initial?.note ?? '', dirty: false };
  let refs = new Map();
  let ui = {};

  const current = () => (st.id ? store.state.snapshots.find((s) => s.id === st.id) ?? null : null);
  const visibleCats = () => {
    const old = current();
    const map = new Map();
    for (const c of enabledCategories(store.state.categories)) map.set(c.id, c);
    if (old) for (const c of displayCategories(old, store.state.categories)) map.set(c.id, c);
    return sortedCategories([...map.values()]);
  };

  const fillRows = (snap) => {
    st.rows = new Map();
    for (const c of visibleCats()) st.rows.set(c.id, newRow());
    if (snap) {
      for (const [cid, e] of Object.entries(snap.entries)) {
        if (!hasValue(e)) continue;
        st.rows.set(cid, { text: formatForInput(e.fen, st.unit), fxOn: !!e.fx, cur: e.fx?.currency ?? '', orig: e.fx?.original ?? '' });
      }
    }
  };
  fillRows(initial);

  /* ------------------------------ 解析 ------------------------------ */

  function parseRow(cat) {
    const r = st.rows.get(cat.id);
    const p = parseAmount(r.text, st.unit);
    if (!p.ok) {
      const msg = p.error === 'decimals' ? `${st.unit === 'yuan' ? '元最多 2 位小数（精确到分）' : '万元最多 6 位小数'}` : p.error === 'range' ? '数值太大了' : '这不是有效的数字';
      return { state: 'error', msg };
    }
    const fxTouched = r.fxOn && (r.cur.trim() || r.orig.trim());
    if (p.empty) return fxTouched ? { state: 'error', msg: '已选「非人民币」，请填写折算后的人民币金额；或关闭非人民币' } : { state: 'empty' };
    let fx;
    if (r.fxOn) {
      const cur = r.cur.trim();
      const orig = r.orig.trim();
      if (!cur) return { state: 'error', msg: '请填写币种，例如 USDT、USD、BTC' };
      if (cur.length > 12) return { state: 'error', msg: '币种太长了' };
      if (!orig) return { state: 'error', msg: '请填写原币金额（折算前的数量）' };
      if (!/^-?\d[\d,]*(\.\d+)?$|^-?\.\d+$/.test(orig.normalize('NFKC'))) return { state: 'error', msg: '原币金额应是数字' };
      fx = { currency: cur, original: orig.normalize('NFKC') };
    }
    return { state: p.fen === 0 ? 'zero' : 'value', fen: p.fen, fx };
  }

  function evaluate() {
    const cats = visibleCats();
    const parsed = new Map(cats.map((c) => [c.id, parseRow(c)]));
    const entries = {};
    for (const [cid, p] of parsed) if (p.state === 'value' || p.state === 'zero') entries[cid] = p.fx ? { fen: p.fen, fx: p.fx } : { fen: p.fen };
    const old = current();
    const withValue = Object.keys(entries);
    const expected = old ? [...new Set([...(old.expectedIds ?? []), ...withValue])] : enabledCategories(store.state.categories).map((c) => c.id);
    const complete = isComplete(entries, expected);
    const missing = expected.filter((cid) => !entries[cid]);
    const total = withValue.reduce((n, cid) => n + entries[cid].fen, 0);
    const hasError = [...parsed.values()].some((p) => p.state === 'error');
    return { cats, parsed, entries, expected, complete, missing, total, hasError, count: withValue.length };
  }

  const catName = (cid) => store.state.categories.find((c) => c.id === cid)?.name ?? cid;

  /* ------------------------------ 刷新（不重建输入框，避免丢焦点） ------------------------------ */

  function lastOf(cid) {
    const before = sortDesc(store.state.snapshots).find((s) => s.id !== st.id && s.date < st.date && hasValue(s.entries[cid]));
    return before ? { fen: before.entries[cid].fen, date: before.date } : null;
  }

  function recalc() {
    const ev = evaluate();
    for (const cat of ev.cats) {
      const r = refs.get(cat.id);
      const p = ev.parsed.get(cat.id);
      r.input.classList.toggle('invalid', p.state === 'error');
      r.input.setAttribute('aria-invalid', String(p.state === 'error'));
      r.state.className = `state${p.state === 'zero' ? ' zero' : ''}${p.state === 'error' ? ' err' : ''}`;
      r.state.textContent = p.state === 'error' ? p.msg : p.state === 'empty' ? '未记录（不计入总额，也不等于 0）' : p.state === 'zero' ? '已确认余额为 0' : st.unit === 'wan' ? `= ${formatMoney(p.fen, 'yuan')}` : p.fen >= 1000000 ? `= ${formatMoney(p.fen, 'wan')}` : '';
      const last = lastOf(cat.id);
      r.last.textContent = last ? `上次 ${formatMoney(last.fen, st.unit)} · ${formatDateZh(last.date, { year: false })}` : '';
      r.fx.hidden = !st.rows.get(cat.id).fxOn;
      r.fxBtn.setAttribute('aria-pressed', String(st.rows.get(cat.id).fxOn));
    }
    // 总额面板
    const t = ui.total;
    t.label.textContent = ev.count === 0 ? '合计' : ev.complete ? '总资产' : '已记录合计';
    t.stamp.replaceChildren(ev.count === 0 ? '' : stamp(ev.complete));
    t.big.textContent = ev.count === 0 ? '—' : formatMoney(ev.total, st.unit);
    t.big.classList.toggle('muted', ev.count === 0 || !ev.complete);
    t.text.textContent = ev.count === 0 ? '还没有填写金额。总额由 App 自动相加。' : ev.complete ? `${ev.expected.length} 个类别都已记录，总额由 App 自动相加` : `还缺：${ev.missing.map(catName).join('、')}。这只是已填部分，不是总资产；保存后标为「不完整」。`;

    updateDup();
    const future = isISODate(st.date) && st.date > todayISO();
    ui.future.hidden = !future;

    const dup = dupRecord();
    let reason = '';
    if (!isISODate(st.date)) reason = '请选择有效的日期';
    else if (dup) reason = '这一天已有记录，请先载入它再修改';
    else if (ev.hasError) reason = '有金额写得不对，请先修改标红的地方';
    else if (ev.count === 0) reason = '至少填写一个类别的金额';
    ui.hint.textContent = reason;
    ui.hint.hidden = !reason;
    ui.total.text.hidden = !!reason; // 有问题时只显示红色原因，让底部栏保持紧凑
    ui.save.disabled = !!reason;
    return ev;
  }

  function dupRecord() {
    if (!isISODate(st.date)) return null;
    const other = findByDate(store.state.snapshots, st.date);
    return other && other.id !== st.id ? other : null;
  }

  function updateDup() {
    const other = dupRecord();
    ui.dup.replaceChildren();
    ui.dup.hidden = !other;
    if (!other) return;
    const total = recordedTotal(other);
    ui.dup.appendChild(
      noteBox(
        'warn',
        [h('b', {}, `${formatDateZh(st.date)}已经有一条记录`), h('div', { class: 'small' }, `${other.complete ? '完整' : '不完整'}，${other.complete ? '总资产' : '已记录合计'} ${formatMoney(total, st.unit)}。为了不悄悄覆盖，请先载入它，再在它的基础上修改。`)],
        [button('载入这条记录来修改', () => loadOther(other), { sm: true, kind: 'secondary' })],
      ),
    );
  }

  async function loadOther(other) {
    if (st.dirty && !(await confirmDialog({ title: '载入这条记录？', message: '你现在填写的内容会被它替换。', confirmText: '载入', cancelText: '先不用' }))) return;
    st.id = other.id;
    st.date = other.date;
    st.note = other.note ?? '';
    fillRows(other);
    st.dirty = false;
    sheet.setTitle('修改记录');
    sheet.body.replaceChildren(buildForm());
    recalc();
  }

  /* ------------------------------ 构建表单 ------------------------------ */

  function buildRow(cat, idx, all) {
    const r = st.rows.get(cat.id);
    const input = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', class: 'money', 'aria-label': `${cat.name}金额`, placeholder: '留空 = 未记录', value: r.text, enterkeyhint: idx === all.length - 1 ? 'done' : 'next' });
    const state = h('div', { class: 'state' });
    const last = h('span', { class: 'hint' });
    const cur = h('input', { type: 'text', autocomplete: 'off', placeholder: '币种，如 USDT', value: r.cur, 'aria-label': `${cat.name}币种`, maxlength: 12 });
    const orig = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '原币金额，如 1200.5', value: r.orig, 'aria-label': `${cat.name}原币金额` });
    const fx = h('div', { class: 'fx', hidden: !r.fxOn }, h('div', { class: 'hint' }, '非人民币资产：App 不会自动换汇。上面请填你自己折算后的人民币金额；这里记下币种和原币数量作依据。'), h('div', { class: 'row' }, h('div', { class: 'grow' }, cur), h('div', { class: 'grow' }, orig)));
    const touch = () => {
      st.dirty = true;
      recalc();
    };
    input.addEventListener('input', () => {
      r.text = input.value;
      touch();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const next = [...refs.values()][idx + 1]?.input;
      if (next) next.focus();
      else input.blur();
    });
    cur.addEventListener('input', () => {
      r.cur = cur.value;
      touch();
    });
    orig.addEventListener('input', () => {
      r.orig = orig.value;
      touch();
    });
    const zeroBtn = button('记为 0', () => {
      r.text = '0';
      input.value = '0';
      touch();
    }, { sm: true, kind: 'ghost' });
    const clearBtn = button('清除', () => {
      r.text = '';
      input.value = '';
      r.fxOn = false;
      r.cur = '';
      r.orig = '';
      cur.value = '';
      orig.value = '';
      touch();
    }, { sm: true, kind: 'ghost' });
    const fxBtn = h('button', { type: 'button', class: 'btn sm ghost', 'aria-pressed': String(r.fxOn), onClick: () => {
      r.fxOn = !r.fxOn;
      touch();
    } }, '非人民币');
    refs.set(cat.id, { input, state, last, fx, fxBtn });
    return h(
      'div',
      { class: 'entry-row' },
      h('div', { class: 'top' }, h('label', { class: 'name' }, catDot(cat), cat.name, cat.enabled ? null : h('span', { class: 'tag' }, '已停用')), last),
      h('div', { class: 'input-wrap' }, input, h('span', { class: 'unit' }, UNITS[st.unit].label)),
      h('div', { class: 'state-row' }, state, h('div', { class: 'tools' }, zeroBtn, clearBtn, fxBtn)),
      fx,
    );
  }

  function buildForm() {
    refs = new Map();
    const cats = visibleCats();
    for (const c of cats) if (!st.rows.has(c.id)) st.rows.set(c.id, newRow());
    const dateInput = h('input', { type: 'date', value: st.date, 'aria-label': '记录日期', max: '2200-12-31', min: '1900-01-01' });
    const dateText = h('div', { class: 'hint' });
    const showDate = () => {
      dateText.textContent = isISODate(st.date) ? `${formatDateZh(st.date, { weekday: true })} · ${relativeDaysZh(st.date)}` : '请选择日期';
    };
    showDate();
    dateInput.addEventListener('change', () => {
      st.date = dateInput.value;
      st.dirty = true;
      showDate();
      recalc();
    });
    ui.dup = h('div', { class: 'notes', hidden: true });
    ui.future = h('div', { class: 'notes', hidden: true }, noteBox('info', '这个日期在今天之后，请确认没有选错。'));

    const unitSeg = seg([{ value: 'yuan', label: '元' }, { value: 'wan', label: '万元' }], st.unit, (u) => {
      // 换算已填的数：先用旧单位解析成「分」，再按新单位写回；写不对的保持原样
      for (const [, r] of st.rows) {
        const p = parseAmount(r.text, st.unit);
        if (p.ok && !p.empty) r.text = formatForInput(p.fen, u);
      }
      st.unit = u;
      sheet.body.replaceChildren(buildForm());
      recalc();
    }, { label: '输入单位' });

    const note = h('textarea', { rows: '2', placeholder: '可不填。例如：买了新手机，花了 5,000 元', 'aria-label': '备注', maxlength: 500 }, st.note);
    note.value = st.note;
    note.addEventListener('input', () => {
      st.note = note.value;
      st.dirty = true;
    });

    const del = current()
      ? button('删除这条记录', async () => {
          const snap = current();
          if (!(await confirmDialog({ title: '删除这条记录？', message: `${formatDateZh(snap.date)}的记录会被删除。删除后可以马上撤销。`, confirmText: '删除', danger: true }))) return;
          const r = await store.deleteSnapshot(snap.id);
          if (!r.ok) return alertDialog({ title: '删除失败', message: r.message });
          st.dirty = false;
          await sheet.close();
          toast('已删除', { actionText: '撤销', onAction: async () => { const u = await store.undoDelete(); toast(u.ok ? '已恢复' : u.message); } });
        }, { kind: 'danger', block: true, iconName: 'trash' })
      : null;

    return h(
      'div',
      { class: 'stack' },
      h('div', { class: 'field' }, h('label', {}, '日期'), dateInput, dateText),
      ui.dup,
      ui.future,
      h('div', { class: 'row between' }, h('span', { class: 'label' }, '金额单位'), unitSeg),
      h('p', { class: 'hint', style: 'margin-top:-4px' }, '空白表示「没有记录」，填 0 才表示「余额确认为 0」。两者不会混淆。'),
      ...cats.map((c, i) => buildRow(c, i, cats)),
      h('div', { class: 'field' }, h('label', {}, '备注'), note, h('div', { class: 'hint' }, '备注只做记录，不会改动任何余额。')),
      del,
    );
  }

  /* ------------------------------ 保存 ------------------------------ */

  async function save() {
    const ev = recalc();
    if (ui.save.disabled) return;
    ui.save.disabled = true;
    const res = await store.saveSnapshot({ id: st.id, date: st.date, note: st.note.trim(), entries: ev.entries, source: 'manual' });
    if (!res.ok) {
      recalc();
      return alertDialog({ title: res.code === 'DUP_DATE' ? '这一天已有记录' : '没有保存', message: res.message });
    }
    st.dirty = false;
    const hints = res.issues.filter((i) => i.code !== 'INCOMPLETE');
    await sheet.close();
    const id2 = res.snapshot.id;
    toast(res.snapshot.complete ? '已保存' : '已保存（不完整记录，不计入总资产）');
    if (hints.length) toast(`有 ${hints.length} 条需要留意的提示`, { actionText: '查看', onAction: () => nav.openDetail(id2), ms: 7000 });
  }

  ui.total = { label: h('span', { class: 'label' }), stamp: h('span', {}), big: h('span', { class: 'big num' }), text: h('div', { class: 'hint' }) };
  const totalBar = h('div', { class: 'total-bar', 'aria-live': 'polite' }, h('div', { class: 'row between' }, h('span', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, ui.total.label, ui.total.stamp), ui.total.big), ui.total.text);
  ui.hint = h('div', { class: 'err', role: 'status', hidden: true, style: 'text-align:center' });
  ui.save = button('保存', save, { block: true });
  const sheet = openSheet({
    title: st.id ? '修改记录' : '记一笔',
    body: buildForm(),
    footer: h('div', { class: 'stack', style: 'gap:8px' }, totalBar, ui.hint, ui.save),
    beforeClose: async () => !st.dirty || confirmDialog({ title: '放弃修改？', message: '你填写的内容还没有保存。', confirmText: '放弃', cancelText: '继续编辑', danger: true }),
  });
  recalc();
  return sheet;
}
