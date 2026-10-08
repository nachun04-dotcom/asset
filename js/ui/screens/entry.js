// 记一笔 / 修改一条快照。空白 = 未记录，0 = 已确认余额为零；总额由程序计算。
// 版面原则：同一类型的账户共用一张卡片（每个账户一行输入框）；每行只有一条小字，说明放进占位符和状态里。
import { h, icon } from '../dom.js';
import { alertDialog, button, confirmDialog, noteBox, openSheet, promptDialog, seg, stamp, switchControl, toast } from '../components.js';
import { catIcon } from '../fmt.js';
import { formatForInput, formatMoney, formatSigned, parseAmount } from '../../core/money.js';
import { dayDiff, formatDateZh, isISODate, relativeDaysZh, todayISO } from '../../core/date.js';
import { cleanName, enabledCategories, groupKey, nameKey, sortedCategories, suggestSiblingName } from '../../core/model.js';
import { findByDate, hasValue, isComplete, recordedTotal, sortDesc } from '../../core/ledger.js';
import { displayCategories } from '../snapshotView.js';

const newRow = () => ({ text: '', fxOn: false, cur: '', orig: '' });

/** 按「类型」归组，保持类别原有的先后顺序：同类账户落在同一张卡片里。 */
function groupsOf(cats) {
  const map = new Map();
  for (const c of cats) {
    const k = groupKey(c);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(c);
  }
  return [...map.values()];
}

/** 点按钮时不要让输入框失去焦点（否则手机键盘会收起、版面跳动，点击容易落空）。 */
const keepFocus = (el) => {
  el.addEventListener('pointerdown', (e) => e.preventDefault());
  return el;
};

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
      const msg = p.error === 'decimals' ? (st.unit === 'yuan' ? '元最多 2 位小数' : '万元最多 6 位小数') : p.error === 'range' ? '数值太大了' : '不是有效的数字';
      return { state: 'error', msg };
    }
    const fxTouched = r.fxOn && (r.cur.trim() || r.orig.trim());
    if (p.empty) return fxTouched ? { state: 'error', msg: '请填折算后的人民币金额' } : { state: 'empty' };
    let fx;
    if (r.fxOn) {
      const cur = r.cur.trim();
      const orig = r.orig.trim();
      if (!cur) return { state: 'error', msg: '请填币种，如 USDT' };
      if (cur.length > 12) return { state: 'error', msg: '币种太长了' };
      if (!orig) return { state: 'error', msg: '请填原币数量' };
      if (!/^-?\d[\d,]*(\.\d+)?$|^-?\.\d+$/.test(orig.normalize('NFKC'))) return { state: 'error', msg: '原币数量应是数字' };
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
  const rootName = (cat) => store.state.categories.find((c) => c.id === groupKey(cat))?.name ?? cat.name;

  /* ------------------------------ 「上次」 ------------------------------ */

  function lastOf(cid, sorted = sortDesc(store.state.snapshots)) {
    const before = sorted.find((s) => s.id !== st.id && s.date < st.date && hasValue(s.entries[cid]));
    return before ? { fen: before.entries[cid].fen, date: before.date, fx: before.entries[cid].fx ?? null } : null;
  }

  /** 这一行能「沿用上次」吗：行还空着、上次有数、上次不是外币。 */
  function reusableOf(cat, sorted) {
    const row = st.rows.get(cat.id);
    const last = lastOf(cat.id, sorted);
    return last && !last.fx && row && row.text.trim() === '' && !row.fxOn ? last : null;
  }

  /** 每行名字下面唯一的一条小字：错误 > 已确认为 0 > 较上次变化 / 换算 > 上次的数（可点着沿用）。 */
  function subOf(p, row, last) {
    if (p.state === 'error') return { kind: 'err', text: p.msg };
    if (p.state === 'zero') return { kind: 'zero', text: '已确认为 0' };
    if (p.state === 'value') {
      if (last) return { kind: '', text: p.fen === last.fen ? '与上次相同' : `较上次 ${formatSigned(p.fen - last.fen, st.unit)}` };
      if (st.unit === 'wan') return { kind: '', text: `= ${formatMoney(p.fen, 'yuan')}` };
      if (p.fen >= 1000000) return { kind: '', text: `= ${formatMoney(p.fen, 'wan')}` };
      return { kind: '', text: '' };
    }
    if (!last) return { kind: '', text: '' };
    const far = dayDiff(last.date, st.date) > 45 ? ` · ${formatDateZh(last.date, { year: last.date.slice(0, 4) !== st.date.slice(0, 4) })}` : '';
    return { kind: 'last', text: `上次 ${formatMoney(last.fen, st.unit)}${last.fx ? `（${last.fx.currency}）` : ''}${far}`, reuse: !last.fx && !row.fxOn, fen: last.fen };
  }

  /* ------------------------------ 刷新（不重建输入框，避免丢焦点） ------------------------------ */

  /** 日期小标签：「10月8日 周四」，今天 / 昨天再加一个小尾巴（窄屏会隐藏）。 */
  function showDate() {
    if (!isISODate(st.date)) return ui.dateText.replaceChildren('选择日期');
    const sameYear = st.date.slice(0, 4) === todayISO().slice(0, 4);
    const rel = relativeDaysZh(st.date);
    ui.dateText.replaceChildren(formatDateZh(st.date, { year: !sameYear, weekday: true }), ...(rel === '今天' || rel === '昨天' ? [h('span', { class: 'rel' }, ` · ${rel}`)] : []));
  }

  function recalc() {
    const ev = evaluate();
    const sorted = sortDesc(store.state.snapshots);
    let reusable = 0;
    for (const cat of ev.cats) {
      const ref = refs.get(cat.id);
      if (!ref) continue;
      const p = ev.parsed.get(cat.id);
      const row = st.rows.get(cat.id);
      const bad = p.state === 'error';
      ref.input.classList.toggle('invalid', bad);
      ref.input.setAttribute('aria-invalid', String(bad));
      ref.amt.classList.toggle('invalid', bad);
      ref.amt.classList.toggle('filled', row.text.trim() !== '');
      const s = subOf(p, row, lastOf(cat.id, sorted));
      ref.sub.className = `sub${s.kind && !s.reuse ? ` ${s.kind}` : ''}`;
      ref.sub.hidden = !s.text || !!s.reuse;
      ref.sub.textContent = s.reuse ? '' : s.text;
      ref.reuse.hidden = !s.reuse;
      ref.reuse.textContent = s.reuse ? s.text : '';
      ref.reuse.setAttribute('aria-label', s.reuse ? `沿用${cat.name}上次的金额 ${formatMoney(s.fen, st.unit)}` : '');
      ref.fx.hidden = !row.fxOn;
      ref.more.classList.toggle('on', row.fxOn);
      if (s.reuse) reusable++;
    }
    ui.reuse.hidden = reusable < 2;
    ui.reuse.setAttribute('aria-label', `把空着的 ${reusable} 项都沿用上次的金额`);

    // 底部：合计（不完整时绝不叫「总资产」）
    ui.lbl.textContent = ev.count === 0 ? '合计' : ev.complete ? '总资产' : '已记录合计';
    ui.stamp.replaceChildren(...(ev.count === 0 ? [] : [stamp(ev.complete, { sm: true })]));
    ui.big.textContent = ev.count === 0 ? '—' : formatMoney(ev.total, st.unit);
    ui.big.classList.toggle('muted', ev.count === 0 || !ev.complete);

    updateDup();
    ui.future.hidden = !(isISODate(st.date) && st.date > todayISO());
    showDate();

    const dup = dupRecord();
    let reason = '';
    if (!isISODate(st.date)) reason = '请选择有效的日期';
    else if (dup) reason = '这一天已有记录，请先载入它再修改';
    else if (ev.hasError) reason = '有金额写得不对，请先改正标红的地方';
    const note = reason || (ev.count > 0 && !ev.complete ? `还缺：${ev.missing.map(catName).join('、')}` : '');
    ui.msg.textContent = note;
    ui.msg.hidden = !note;
    ui.msg.classList.toggle('err', !!reason);
    ui.save.disabled = !!reason || ev.count === 0; // 什么都没填时只是安静地不能保存，不用红字吓人
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
        [h('b', {}, `${formatDateZh(st.date)}已经有一条记录`), h('div', { class: 'small' }, `${other.complete ? '总资产' : '已记录合计'} ${formatMoney(total, st.unit)}（${other.complete ? '完整' : '不完整'}）。请载入它再修改，避免悄悄覆盖。`)],
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
    rebuild();
  }

  function rebuild() {
    const scroller = sheet.body;
    const top = scroller.scrollTop;
    scroller.replaceChildren(buildForm()); // 已填的内容都在 st.rows 里，重画不会丢
    scroller.scrollTop = top;
    recalc();
  }

  /* ------------------------------ 沿用上次 ------------------------------ */

  let undoToast = null; // 「沿用」和「添加账户」的撤销提示只保留最新一条，避免点错
  function reuseAll() {
    const sorted = sortDesc(store.state.snapshots);
    const done = [];
    for (const c of visibleCats()) {
      const last = reusableOf(c, sorted);
      if (!last) continue;
      const r = st.rows.get(c.id);
      r.text = formatForInput(last.fen, st.unit);
      const input = refs.get(c.id)?.input;
      if (input) input.value = r.text;
      done.push({ cid: c.id, text: r.text });
    }
    if (!done.length) return;
    st.dirty = true;
    recalc();
    undoToast?.remove();
    undoToast = toast(`已沿用 ${done.length} 项，有变动的请改一下`, {
      actionText: '撤销',
      ms: 6000,
      onAction: () => {
        for (const { cid, text } of done) {
          const r = st.rows.get(cid);
          if (!r || r.text !== text) continue; // 已经被你改过的不动
          r.text = '';
          const input = refs.get(cid)?.input;
          if (input) input.value = '';
        }
        recalc();
      },
    });
  }

  /* ------------------------------ 添加同类账户 ------------------------------ */

  async function addSibling(cat) {
    const root = rootName(cat);
    const name = await promptDialog({
      title: `再添加一个「${root}」账户`,
      message: '给它起个名字，例如「支付宝 2」。以前的记录不受影响。',
      value: suggestSiblingName(store.state.categories, cat),
      maxlength: 20,
      confirmText: '添加',
      validate: (v) => {
        const n = cleanName(v);
        if (!n) return '名称不能为空';
        if (store.state.categories.some((c) => nameKey(c.name) === nameKey(n))) return '已经有同名账户了，换一个名字';
        return '';
      },
    });
    if (name == null) return;
    const res = await store.addCategory(name, { sameAs: cat.id });
    if (!res.ok) return alertDialog({ title: '没有添加', message: res.message });
    rebuild();
    const fresh = refs.get(res.category.id)?.input;
    if (fresh) {
      fresh.scrollIntoView?.({ block: 'center' });
      fresh.focus({ preventScroll: true });
    }
    undoToast?.remove();
    undoToast = toast(`已添加「${res.category.name}」`, {
      actionText: '撤销',
      onAction: async () => {
        const d = await store.deleteCategory(res.category.id);
        if (!d.ok) return toast(d.message);
        st.rows.delete(res.category.id);
        rebuild();
      },
    });
  }

  /* ------------------------------ 每行的「更多」：非人民币、删除账户 ------------------------------ */

  function openOptions(cat) {
    if (document.activeElement?.matches?.('input, textarea')) document.activeElement.blur(); // 先收起键盘
    const r = st.rows.get(cat.id);
    const removable = !!cat.group && !store.isCategoryUsed(cat.id); // 只有后来加的、还没用过的同类账户可以在这里删
    const sw = switchControl(r.fxOn, async (on) => {
      r.fxOn = on;
      st.dirty = true;
      recalc();
      await new Promise((ok) => setTimeout(ok, 160));
      await opt.close();
      if (on) refs.get(cat.id)?.cur.focus();
    }, `${cat.name}：非人民币资产`);
    const del = removable
      ? button('删除这个账户', async () => {
          if (!(await confirmDialog({ title: `删除「${cat.name}」？`, message: '它还没有任何历史记录，删除不影响其他数据。', confirmText: '删除', danger: true }))) return;
          const d = await store.deleteCategory(cat.id);
          if (!d.ok) return alertDialog({ title: '没有删除', message: d.message });
          st.rows.delete(cat.id);
          await opt.close();
          rebuild();
        }, { kind: 'danger', block: true, iconName: 'trash' })
      : null;
    const opt = openSheet({
      title: cat.name,
      auto: true,
      body: h(
        'div',
        { class: 'stack' },
        h('div', { class: 'list' }, h('div', { class: 'setting' }, h('div', { class: 'grow' }, h('div', {}, '非人民币资产'), h('div', { class: 'desc' }, '金额栏填折算后的人民币；币种和原币数量记在下面作依据。App 不会自动换汇。')), sw)),
        del,
      ),
    });
  }

  /* ------------------------------ 构建表单 ------------------------------ */

  function buildRow(cat, { idx, n, tail }) {
    const r = st.rows.get(cat.id);
    const touch = () => {
      st.dirty = true;
      recalc();
    };
    const input = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', class: 'money', 'aria-label': `${cat.name}金额`, 'aria-describedby': `acct-sub-${idx}`, placeholder: '未记录', value: r.text, enterkeyhint: idx === n - 1 ? 'done' : 'next' });
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
    const amt = h('div', { class: 'amt' }, h('span', { class: 'pre', 'aria-hidden': 'true' }, '¥'), input, st.unit === 'wan' ? h('span', { class: 'sfx' }, '万') : null);

    const sub = h('div', { class: 'sub', id: `acct-sub-${idx}`, hidden: true });
    const reuse = keepFocus(h('button', { type: 'button', class: 'sub reuse', hidden: true }));
    reuse.addEventListener('click', () => {
      const last = reusableOf(cat);
      if (!last) return;
      r.text = formatForInput(last.fen, st.unit);
      input.value = r.text;
      touch();
    });
    const plus = tail ? keepFocus(h('button', { type: 'button', class: 'plus', 'aria-label': `再添加一个${rootName(cat)}账户`, onClick: () => addSibling(cat) }, icon('plus', { size: 13, stroke: 2.4 }))) : null;
    const who = h('div', { class: 'who' }, catIcon(cat, store.state.categories, { size: 30 }), h('div', { class: 'l1' }, h('span', { class: 'nm' }, cat.name), cat.enabled ? null : h('span', { class: 'tag' }, '已停用'), plus), sub, reuse);

    const more = keepFocus(h('button', { type: 'button', class: 'more', 'aria-label': `${cat.name}：更多`, onClick: () => openOptions(cat) }, icon('more', { size: 20 })));

    const cur = h('input', { type: 'text', autocomplete: 'off', placeholder: '币种 USDT', value: r.cur, 'aria-label': `${cat.name}币种`, maxlength: 12 });
    const orig = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '原币数量', value: r.orig, 'aria-label': `${cat.name}原币金额` });
    cur.addEventListener('input', () => {
      r.cur = cur.value;
      touch();
    });
    orig.addEventListener('input', () => {
      r.orig = orig.value;
      touch();
    });
    const fx = h('div', { class: 'fx', hidden: !r.fxOn }, cur, orig);

    const row = h('div', { class: 'acct' }, who, amt, more, fx);
    row.addEventListener('click', (e) => {
      if (!e.target.closest('button, input')) input.focus();
    });
    refs.set(cat.id, { input, amt, sub, reuse, fx, cur, more });
    return row;
  }

  function buildForm() {
    refs = new Map();
    const cats = visibleCats();
    for (const c of cats) if (!st.rows.has(c.id)) st.rows.set(c.id, newRow());
    const groups = groupsOf(cats);
    const flat = groups.flat();

    ui.dateText = h('span', { class: 'txt' });
    const dateInput = h('input', { type: 'date', value: st.date, 'aria-label': '记录日期', max: '2200-12-31', min: '1900-01-01' });
    dateInput.addEventListener('change', () => {
      st.date = dateInput.value;
      st.dirty = true;
      recalc();
    });
    const chip = h('label', { class: 'date-chip' }, icon('calendar', { size: 17 }), ui.dateText, dateInput);

    const unitSeg = seg([{ value: 'yuan', label: '元' }, { value: 'wan', label: '万元' }], st.unit, (u) => {
      // 换算已填的数：先用旧单位解析成「分」，再按新单位写回；写不对的保持原样
      for (const [, r] of st.rows) {
        const p = parseAmount(r.text, st.unit);
        if (p.ok && !p.empty) r.text = formatForInput(p.fen, u);
      }
      st.unit = u;
      rebuild();
    }, { label: '输入单位' });

    ui.future = h('div', { class: 'mini', hidden: true }, icon('warn', { size: 14 }), '日期在今天之后，请确认没有选错');
    ui.dup = h('div', { class: 'notes', hidden: true });

    const cards = groups.map((g) => h('div', { class: 'acct-card' }, ...g.map((c, i) => buildRow(c, { idx: flat.indexOf(c), n: flat.length, tail: i === g.length - 1 }))));

    const note = h('textarea', { rows: '2', placeholder: '备注，例如：买了新手机，花了 5,000 元', 'aria-label': '备注', maxlength: 500 }, st.note);
    note.value = st.note;
    note.addEventListener('input', () => {
      st.note = note.value;
      st.dirty = true;
    });
    const noteWrap = h('div', { class: 'note-wrap', hidden: !st.note }, note);
    const addNote = h('button', { type: 'button', class: 'link-btn', hidden: !!st.note, onClick: () => {
      addNote.hidden = true;
      noteWrap.hidden = false;
      note.focus();
    } }, icon('plus', { size: 14, stroke: 2.2 }), '添加备注');

    const del = current()
      ? h('button', { type: 'button', class: 'link-btn danger', onClick: async () => {
          const snap = current();
          if (!(await confirmDialog({ title: '删除这条记录？', message: `${formatDateZh(snap.date)}的记录会被删除。删除后可以马上撤销。`, confirmText: '删除', danger: true }))) return;
          const r = await store.deleteSnapshot(snap.id);
          if (!r.ok) return alertDialog({ title: '删除失败', message: r.message });
          st.dirty = false;
          await sheet.close();
          toast('已删除', { actionText: '撤销', onAction: async () => { const u = await store.undoDelete(); toast(u.ok ? '已恢复' : u.message); } });
        } }, icon('trash', { size: 16 }), '删除这条记录')
      : null;

    return h('div', { class: 'entry' }, h('div', { class: 'entry-bar' }, chip, unitSeg), ui.future, ui.dup, ...cards, h('div', { class: 'entry-extra' }, addNote, noteWrap), del);
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

  ui.lbl = h('span', {});
  ui.stamp = h('span', {});
  ui.big = h('span', { class: 'big num' });
  ui.msg = h('div', { class: 'msg', role: 'status', hidden: true });
  ui.save = button('保存', save);
  const foot = h('div', { class: 'entry-foot' }, h('div', { class: 'sum', 'aria-live': 'polite' }, h('div', { class: 'cap' }, ui.lbl, ui.stamp), ui.big), ui.save, ui.msg);
  ui.reuse = h('button', { type: 'button', class: 'pill', hidden: true, onClick: reuseAll }, '沿用上次');

  const sheet = openSheet({
    title: st.id ? '修改记录' : '记一笔',
    body: buildForm(),
    footer: foot,
    beforeClose: async () => !st.dirty || confirmDialog({ title: '放弃修改？', message: '你填写的内容还没有保存。', confirmText: '放弃', cancelText: '继续编辑', danger: true }),
  });
  const head = sheet.el.querySelector('.sheet-head');
  head.insertBefore(ui.reuse, head.lastElementChild);
  recalc();
  return sheet;
}
