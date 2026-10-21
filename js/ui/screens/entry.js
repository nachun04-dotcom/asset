// 记一笔 / 修改一条快照。空白 = 未记录，0 = 已确认余额为零；总额由程序计算。
// 版面原则：顶部是日期和「一键沿用上次」；每个账户一行——左边名字和上次的数，右边是大号金额栏；
// 只有点金额栏才会弹出键盘（上下滑动时碰到行不会误触）；同类账户的添加、外币等放进每行的「⋯」。
import { h, icon } from '../dom.js';
import { alertDialog, button, confirmDialog, noteBox, openSheet, promptDialog, seg, stamp, switchControl, toast } from '../components.js';
import { catIcon, compactYuan } from '../fmt.js';
import { formatDecimal, formatMoney, formatSigned, parseAmount } from '../../core/money.js';
import { dayDiff, formatDateZh, isISODate, relativeDaysZh, todayISO } from '../../core/date.js';
import { cleanName, enabledCategories, groupKey, groupName, isDebt, nameKey, sortedCategories, suggestSiblingName } from '../../core/model.js';
import { findByDate, hasValue, isComplete, recordedTotal, sortDesc } from '../../core/ledger.js';
import { displayCategories } from '../snapshotView.js';
import { confirmDeleteCategory, dragHandle, groupedSortable, openCategoryEditor } from '../categoryEditor.js';
import { amountPad, evalExpr, prettyExpr } from '../amountPad.js';
import { fx } from '../feedback.js';

const newRow = () => ({ text: '', fxOn: false, cur: '', orig: '' });
/** 输入框里显示的金额：带千分位（218,440.72），parseAmount 能原样读回。 */
const showAmount = (fen, unit) => formatDecimal(fen, unit);

/** 按「类型」归组，保持类别原有的先后顺序：同类账户落在同一张卡片里。 */
function groupsOf(cats) {
  const map = new Map();
  for (const c of cats) {
    const k = `${groupKey(c)}${isDebt(c) ? ':debt' : ''}`; // 同一大类里资产、负债分开，各进各的卡片
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

/* 草稿：没保存就关掉也不会丢，下次打开同一条（新记录 / 某条旧记录）时自动恢复。只存在这台手机的浏览器里。 */
const DRAFT_KEY = 'asset-entry-drafts';
function readDrafts() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}');
    return d && typeof d === 'object' ? d : {};
  } catch {
    return {};
  }
}
function writeDrafts(d) {
  try {
    if (Object.keys(d).length) localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else localStorage.removeItem(DRAFT_KEY);
    return true;
  } catch {
    return false;
  }
}
const isoOf = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function openEntry(ctx, { id = null, date = null } = {}) {
  const { store, nav } = ctx;
  const initial = id ? store.state.snapshots.find((s) => s.id === id) : null;
  const st = { manage: false, id: initial?.id ?? null, date: initial?.date ?? date ?? todayISO(), unit: store.state.settings.unit, rows: new Map(), note: initial?.note ?? '', dirty: false };
  let refs = new Map();
  let ui = {};

  const current = () => (st.id ? store.state.snapshots.find((s) => s.id === st.id) ?? null : null);
  // 负债账户：输入框里填「欠多少」（正数），存进记录时取负数，合计自然就是净资产
  const sgn = (cid) => (isDebt(store.state.categories.find((c) => c.id === cid)) ? -1 : 1);
  const signed = (fen, cid) => (fen === 0 ? 0 : fen * sgn(cid));
  const visibleCats = () => {
    const old = current();
    const map = new Map();
    for (const c of enabledCategories(store.state.categories)) map.set(c.id, c);
    // 修改旧记录时，只额外带上「这条记录里有金额」的已停用账户（否则金额会丢）；停用且没填的不再出现
    if (old) for (const c of displayCategories(old, store.state.categories)) if (c.enabled || hasValue(old.entries[c.id])) map.set(c.id, c);
    return sortedCategories([...map.values()]);
  };

  const fillRows = (snap) => {
    st.rows = new Map();
    for (const c of visibleCats()) st.rows.set(c.id, newRow());
    if (snap) {
      for (const [cid, e] of Object.entries(snap.entries)) {
        if (!hasValue(e)) continue;
        st.rows.set(cid, { text: showAmount(signed(e.fen, cid), st.unit), fxOn: !!e.fx, cur: e.fx?.currency ?? '', orig: e.fx?.original ?? '' });
      }
    }
  };
  fillRows(initial);

  /* ------------------------------ 草稿 ------------------------------ */

  const draftKey = () => st.id ?? 'new';
  let draftOk = true;
  function flushDraft() {
    clearTimeout(flushDraft.t);
    const d = readDrafts();
    const rows = [...st.rows].filter(([, r]) => r.text.trim() || r.fxOn || r.cur.trim() || r.orig.trim());
    if (!st.dirty || (!rows.length && !st.note.trim() && !st.id)) delete d[draftKey()];
    else d[draftKey()] = { date: st.date, unit: st.unit, note: st.note, rows, at: Date.now() };
    draftOk = writeDrafts(d);
  }
  const saveDraft = () => {
    clearTimeout(flushDraft.t);
    flushDraft.t = setTimeout(flushDraft, 300);
  };
  const dropDraft = (key = draftKey()) => {
    clearTimeout(flushDraft.t);
    const d = readDrafts();
    delete d[key];
    writeDrafts(d);
  };
  let restored = false;
  {
    const dr = readDrafts()[draftKey()];
    const known = new Set(store.state.categories.map((c) => c.id));
    if (dr && Array.isArray(dr.rows)) {
      // 新记录：草稿那天记的是「当天」的话，过了一天就换成今天；手动选过的日期照旧
      if (!st.id) st.date = date ?? (dr.date === isoOf(dr.at) ? todayISO() : dr.date || st.date);
      if (dr.unit === 'yuan' || dr.unit === 'wan') st.unit = dr.unit;
      for (const [cid, r] of dr.rows) if (known.has(cid) && r && typeof r.text === 'string') st.rows.set(cid, { ...newRow(), ...r });
      st.note = typeof dr.note === 'string' ? dr.note : st.note;
      st.dirty = true;
      restored = true;
    }
  }
  const onHide = () => document.visibilityState === 'hidden' && flushDraft();
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', flushDraft);

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
    return { state: p.fen === 0 ? 'zero' : 'value', fen: signed(p.fen, cat.id), fx };
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
    const hasDebt = withValue.some((cid) => sgn(cid) < 0);
    const hasError = [...parsed.values()].some((p) => p.state === 'error');
    return { cats, parsed, entries, expected, complete, missing, total, hasDebt, hasError, count: withValue.length };
  }

  const catName = (cid) => store.state.categories.find((c) => c.id === cid)?.name ?? cid;
  const rootName = (cat) => groupName(cat, store.state.categories);

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
  function subOf(p, row, last, cat) {
    const debt = isDebt(cat);
    if (p.state === 'error') return { kind: 'err', text: p.msg };
    if (p.state === 'zero') return { kind: 'zero', text: debt ? '已还清（欠款为 0）' : '已确认为 0' };
    if (p.state === 'value') {
      if (last) {
        if (p.fen === last.fen) return { kind: '', text: '与上次相同' };
        if (debt) {
          const more = last.fen - p.fen; // 存的是负数：差值为正表示多欠了
          return { kind: '', text: `较上次${more > 0 ? '多欠' : '少欠'} ${formatMoney(Math.abs(more), st.unit)}` };
        }
        return { kind: '', text: `较上次 ${formatSigned(p.fen - last.fen, st.unit)}` };
      }
      const abs = Math.abs(p.fen);
      if (st.unit === 'wan') return { kind: '', text: `= ${formatMoney(abs, 'yuan')}` };
      if (abs >= 1000000) return { kind: '', text: `= ${formatMoney(abs, 'wan')}` };
      return { kind: '', text: '' };
    }
    if (!last) return { kind: '', text: debt ? '填欠款金额，正数即可' : '' };
    const far = dayDiff(last.date, st.date) > 45 ? ` · ${formatDateZh(last.date, { year: last.date.slice(0, 4) !== st.date.slice(0, 4) })}` : '';
    // 一行放得下：上次的数用简短写法（2.55万），点一下填入的仍是精确金额
    const shown = debt ? `上次欠 ${compactYuan(-last.fen)}` : `上次 ${compactYuan(last.fen)}`;
    return { kind: 'last', text: `${shown}${last.fx ? `（${last.fx.currency}）` : ''}${far}`, reuse: !last.fx && !row.fxOn, fen: last.fen };
  }

  /** 合计数字滚动到新值（约 0.3 秒，先快后慢）；系统设了「减弱动态效果」时直接跳到结果。 */
  function rollMoney(el, fen) {
    cancelAnimationFrame(el._roll);
    clearTimeout(el._rollEnd);
    if (fen == null) {
      el._fen = null;
      el.textContent = '—';
      return;
    }
    const from = el._fen;
    el._fen = fen;
    if (from == null || from === fen || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.textContent = formatMoney(fen, st.unit);
      return;
    }
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / 320);
      const e = 1 - (1 - p) ** 3;
      el.textContent = formatMoney(p < 1 ? Math.round(from + (fen - from) * e) : fen, st.unit);
      if (p < 1) el._roll = requestAnimationFrame(step);
    };
    el._roll = requestAnimationFrame(step);
    // 后台或省电时动画帧可能暂停：到点直接写上最终结果
    el._rollEnd = setTimeout(() => {
      cancelAnimationFrame(el._roll);
      el.textContent = formatMoney(fen, st.unit);
    }, 420);
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
      const s = subOf(p, row, lastOf(cat.id, sorted), cat);
      // 名字下面一行小字（较上次变化 / 错误）；能沿用时这行小字本身就是按钮：「上次 ¥x ↺」，点一下填入
      ref.sub.className = `sub${s.kind ? ` ${s.kind}` : ''}`;
      ref.sub.hidden = !s.text || !!s.reuse;
      ref.sub.textContent = s.text;
      ref.reuse.hidden = !s.reuse;
      ref.reuseText.textContent = s.reuse ? s.text : '';
      ref.reuse.setAttribute('aria-label', s.reuse ? `沿用${cat.name}上次的金额 ${formatMoney(s.fen, st.unit)}` : '');
      ref.fx.hidden = !row.fxOn;
      ref.more.classList.toggle('on', row.fxOn);
      if (s.reuse) reusable++;
    }
    // 一键沿用：用过之后卡片留在原处变成「已沿用」，不突然消失——否则下面的内容会整体往上跳
    const canReuse = reusable >= 2;
    ui.reuse.hidden = !canReuse && !st.reusedCount;
    ui.reuse.disabled = !canReuse;
    ui.reuse.classList.toggle('done', !canReuse);
    ui.reuseTitle.textContent = canReuse ? '一键沿用上次金额' : `已沿用 ${st.reusedCount} 项上次金额`;
    ui.reuseSub.textContent = canReuse ? `${reusable} 个空账户填入上次余额` : '有变化的直接改金额';
    ui.reuse.setAttribute('aria-label', canReuse ? `把空着的 ${reusable} 项都沿用上次的金额` : ui.reuseTitle.textContent);

    // 底部：合计（不完整时绝不叫「总资产」）
    ui.lbl.textContent = ev.count === 0 ? '合计' : ev.complete ? (ev.hasDebt ? '净资产' : '总资产') : '已记录合计';
    ui.stamp.replaceChildren(...(ev.count === 0 ? [] : [stamp(ev.complete, { sm: true })]));
    rollMoney(ui.big, ev.count === 0 ? null : ev.total);
    ui.big.classList.toggle('muted', ev.count === 0 || !ev.complete);
    const need = Math.max(ev.expected.length, ev.count);
    ui.progress.textContent = need ? `已填 ${ev.count} / ${need}` : '';
    ui.bar.style.width = `${need ? Math.min(100, (ev.count / need) * 100) : 0}%`;

    updateDup();
    ui.future.hidden = !(isISODate(st.date) && st.date > todayISO());
    showDate();

    const dup = dupRecord();
    let reason = '';
    if (!isISODate(st.date)) reason = '请选择有效的日期';
    else if (dup) reason = '这一天已有记录';
    else if (ev.hasError) reason = '有金额写得不对，请先改正标红的地方';
    const note = reason || (ev.count > 0 && !ev.complete ? `还缺：${ev.missing.map(catName).join('、')}` : '');
    ui.msg.textContent = note;
    ui.msg.hidden = !note;
    ui.msg.classList.toggle('err', !!reason);
    // 「保存」不再变成真正的 disabled（那样点了毫无反应，也看不到原因）：看起来变淡，点了会说明为什么不能保存
    ui.blocked = reason || (ev.count === 0 ? '先填至少一个账户的金额' : '');
    ui.save.classList.toggle('off', !!ui.blocked);
    ui.kbSave.classList.toggle('off', !!ui.blocked);
    ui.save.setAttribute('aria-disabled', String(!!ui.blocked));
    for (const { sum, ids } of ui.grpSums ?? []) {
      const got = ids.filter((cid) => ev.entries[cid]);
      sum.textContent = got.length ? formatMoney(Math.abs(got.reduce((n, cid) => n + ev.entries[cid].fen, 0)), st.unit) : '';
    }
    if (ev.count === 0) ui.kbSum.textContent = '';
    else rollMoney(ui.kbSum, ev.total);
    ui.kbProg.textContent = ui.progress.textContent;
    if (st.dirty) saveDraft();
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
        [h('b', {}, `${formatDateZh(st.date, { year: false })}已有记录`), h('div', { class: 'small' }, `${other.complete ? '总资产' : '合计'} ${formatMoney(total, st.unit)}${other.complete ? '' : '（未填完）'}`)],
        [button('打开修改', () => loadOther(other), { sm: true, kind: 'secondary' })],
      ),
    );
  }

  async function loadOther(other) {
    if (st.dirty && !(await confirmDialog({ title: '载入这条记录？', message: '你现在填写的内容会被它替换。', confirmText: '载入', cancelText: '先不用' }))) return;
    dropDraft();
    st.id = other.id;
    st.date = other.date;
    st.note = other.note ?? '';
    fillRows(other);
    st.dirty = false;
    sheet.setTitle('修改记录');
    rebuild();
  }

  function rebuild() {
    if (padCid) closePad();
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
      r.text = showAmount(signed(last.fen, c.id), st.unit);
      const input = refs.get(c.id)?.input;
      if (input) input.value = r.text;
      done.push({ cid: c.id, text: r.text });
    }
    if (!done.length) return;
    if (padCid) pad.start(st.rows.get(padCid)?.text ?? '');
    st.dirty = true;
    st.reusedCount = done.length;
    fx.done();
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
    const sw = switchControl(r.fxOn, async (on) => {
      r.fxOn = on;
      st.dirty = true;
      recalc();
      await new Promise((ok) => setTimeout(ok, 160));
      await opt.close();
      if (on) refs.get(cat.id)?.cur.focus();
    }, `${cat.name}：非人民币资产`);
    // 改名、图标、负债、停用、删除都在「编辑账户」里，菜单只留三项
    const item = (ic, title, meta, fn) => h('button', { type: 'button', class: 'item', onClick: async () => { await opt.close(); fn(); } }, h('span', { class: 'ico' }, icon(ic, { size: 18 })), h('span', { class: 'grow' }, h('div', { class: 'title' }, title), meta ? h('div', { class: 'meta' }, meta) : null), icon('chevronR', { size: 18 }));
    const opt = openSheet({
      title: cat.name,
      auto: true,
      body: h(
        'div',
        { class: 'list' },
        item('edit', '编辑账户', '名称、图标、负债、停用、删除', () => openCategoryEditor(store, cat.id, { onChange: rebuild })),
        item('plus', `再添加一个「${rootName(cat)}」`, '同类多个账户分开记', () => addSibling(cat)),
        h('div', { class: 'setting' }, h('div', { class: 'grow' }, h('div', {}, '非人民币'), h('div', { class: 'desc' }, '填折算后的人民币，原币记在下面')), sw),
      ),
    });
  }

  /* ------------------------------ 构建表单 ------------------------------ */

  function buildRow(cat, { idx, n }) {
    const r = st.rows.get(cat.id);
    const touch = () => {
      st.dirty = true;
      recalc();
    };
    // 金额栏用自带的金额键盘（readonly + inputmode=none：不弹系统键盘，版面不被顶起）
    const input = h('input', { type: 'text', inputmode: 'none', readonly: true, tabindex: '-1', autocomplete: 'off', class: 'money', 'aria-label': `${cat.name}金额`, 'aria-describedby': `acct-sub-${idx}`, placeholder: '输入金额', value: r.text });
    // 点金额栏任何位置都打开金额键盘；行的其他地方不响应，滑动时不会误弹
    const debt = isDebt(cat);
    const amt = h('div', { class: ['amt', debt && 'debt', padCid === cat.id && 'active'], role: 'button', tabindex: '0', 'aria-label': `填写${cat.name}金额` }, h('span', { class: 'pre', 'aria-hidden': 'true' }, debt ? '欠 ¥' : '¥'), input, st.unit === 'wan' ? h('span', { class: 'sfx' }, '万') : null);
    amt.addEventListener('click', () => openPad(cat.id));
    amt.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), openPad(cat.id)));

    const sub = h('div', { class: 'sub', id: `acct-sub-${idx}`, hidden: true });
    const reuseText = h('span', {});
    const reuse = keepFocus(h('button', { type: 'button', class: 'reuse', hidden: true, 'aria-label': `${cat.name}：沿用上次的金额` }, reuseText, icon('repeat', { size: 12, stroke: 2.2 })));
    reuse.addEventListener('click', () => {
      const last = reusableOf(cat);
      if (!last) return;
      r.text = showAmount(signed(last.fen, cat.id), st.unit);
      input.value = r.text;
      if (padCid === cat.id) pad.start(r.text);
      touch();
    });
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

    // 一行：图标 · 名称（下面一行小字）· 金额栏 · ⋯ ；只有外币账户展开时才多一行
    const row = h(
      'div',
      { class: 'acct line' },
      catIcon(cat, store.state.categories, { size: 32 }),
      h('div', { class: 'acct-name' }, h('div', { class: 'l1' }, h('span', { class: 'nm' }, cat.name)), sub, reuse),
      amt,
      more,
      fx,
    );
    refs.set(cat.id, { input, amt, sub, reuse, reuseText, fx, cur, more });
    return row;
  }

  /**
   * 管理账户（就在记一笔里，不用跑去设置）：每行可直接改名、点图标换图标 / 停用、点垃圾桶删除、按住 ≡ 拖动排序；
   * 底部直接新增资产或负债账户。点右上角「完成」回到记账。
   */
  let addKind = 'asset';
  function buildManage() {
    refs = new Map();
    // 两层排序：大类整组移动，小账户只在自己的大类里调换
    const list = groupedSortable(store, (c, child) => {
      const name = h('input', { type: 'text', class: 'm-name', value: c.name, maxlength: 20, 'aria-label': `「${c.name}」的名称`, enterkeyhint: 'done' });
      name.addEventListener('keydown', (e) => e.key === 'Enter' && name.blur());
      name.addEventListener('change', async () => {
        const n = cleanName(name.value);
        const now = store.state.categories.find((x) => x.id === c.id);
        if (!now) return;
        if (!n || n === now.name) return void (name.value = now.name);
        const r = await store.saveCategories(sortedCategories(store.state.categories).map((x) => (x.id === c.id ? { ...x, name: n } : x)));
        if (!r.ok) {
          toast(r.message);
          name.value = now.name;
        } else toast(`已改名为「${n}」`);
      });
      const iconBtn = h('button', { type: 'button', class: 'm-icon', 'aria-label': `「${c.name}」：换图标、负债、停用` }, catIcon(c, store.state.categories, { size: child ? 30 : 34 }));
      iconBtn.addEventListener('click', () => openCategoryEditor(store, c.id, { onChange: rebuild }));
      const delBtn = h('button', { type: 'button', class: 'm-del', 'aria-label': `删除「${c.name}」` }, icon('trash', { size: 18 }));
      delBtn.addEventListener('click', async () => {
        if (await confirmDeleteCategory(store, c.id)) {
          st.rows.delete(c.id);
          rebuild();
        }
      });
      return h('div', { class: ['m-row', !c.enabled && 'off', child && 'child'] }, iconBtn, h('div', { class: 'm-main' }, name, h('div', { class: 'm-tags' }, isDebt(c) ? h('span', { class: 'tag debt' }, '负债') : null, c.enabled ? null : h('span', { class: 'tag' }, '已停用'))), delBtn, dragHandle(c.name));
    }, { className: 'manage-list', onChange: rebuild });
    const newName = h('input', { type: 'text', placeholder: addKind === 'debt' ? '新负债，如「信用卡」「花呗」' : '新账户，如「基金」「现金」', maxlength: 20, 'aria-label': '新账户名称', enterkeyhint: 'done' });
    const kind = seg([{ value: 'asset', label: '资产' }, { value: 'debt', label: '负债' }], addKind, (v) => {
      addKind = v;
      newName.placeholder = v === 'debt' ? '新负债，如「信用卡」「花呗」' : '新账户，如「基金」「现金」';
    }, { label: '新账户类型' });
    const add = async () => {
      const r = await store.addCategory(newName.value, { debt: addKind === 'debt' });
      if (!r.ok) return toast(r.message);
      toast(`已添加「${r.category.name}」`);
      rebuild();
    };
    newName.addEventListener('keydown', (e) => e.key === 'Enter' && add());
    return h(
      'div',
      { class: 'entry manage' },
      h('p', { class: 'hint manage-hint' }, '点名字改名 · 点图标更多设置 · 按住 ≡ 排序'),
      list,
      h('div', { class: 'add-cat card' }, h('div', { class: 'row between' }, h('span', { class: 'label' }, '新增账户'), kind), h('div', { class: 'row' }, h('div', { class: 'grow' }, newName), button('添加', add, { kind: 'secondary', iconName: 'plus' }))),
      button('完成，回到记账', () => setManage(false), { block: true }),
    );
  }

  function setManage(on) {
    if (document.activeElement?.matches?.('input')) document.activeElement.blur();
    st.manage = on;
    ui.manageBtn.textContent = on ? '完成' : '管理';
    ui.manageBtn.classList.toggle('on', on);
    sheet.el.classList.toggle('managing', on);
    sheet.setTitle(on ? '管理账户' : st.id ? '修改记录' : '记一笔');
    sheet.body.scrollTop = 0;
    rebuild();
  }

  function buildForm() {
    if (st.manage) return buildManage();
    refs = new Map();
    const cats = visibleCats();
    for (const c of cats) if (!st.rows.has(c.id)) st.rows.set(c.id, newRow());
    // 资产在前、负债在后（与显示顺序一致，「下一项」才会按看到的顺序跳）
    const all = groupsOf(cats);
    const groups = [...all.filter((g) => !isDebt(g[0])), ...all.filter((g) => isDebt(g[0]))];
    const flat = groups.flat();

    ui.dateText = h('span', { class: 'txt' });
    const dateInput = h('input', { type: 'date', value: st.date, 'aria-label': '记录日期', max: '2200-12-31', min: '1900-01-01' });
    dateInput.addEventListener('change', () => {
      st.date = dateInput.value;
      st.dirty = true;
      recalc();
    });
    const chip = h('label', { class: 'date-chip' }, icon('calendar', { size: 18 }), ui.dateText, h('span', { class: 'chg-date', 'aria-hidden': 'true' }, icon('chevronD', { size: 15 })), dateInput);

    const unitSeg = seg([{ value: 'yuan', label: '元' }, { value: 'wan', label: '万元' }], st.unit, (u) => {
      // 换算已填的数：先用旧单位解析成「分」，再按新单位写回；写不对的保持原样
      for (const [, r] of st.rows) {
        const p = parseAmount(r.text, st.unit);
        if (p.ok && !p.empty) r.text = showAmount(p.fen, u);
      }
      st.unit = u;
      rebuild();
    }, { label: '输入单位' });

    ui.future = h('div', { class: 'mini', hidden: true }, icon('warn', { size: 14 }), '日期在今天之后，请确认没有选错');
    ui.dup = h('div', { class: 'notes', hidden: true });

    // 资产一张卡片、负债一张卡片，账户之间用细线分隔，紧凑好扫。
    // 同一大类有多个账户（如 3 个支付宝）时和首页一样归成一组：浅金底色 + 一行小标题（名称 · 个数 · 小计）
    ui.grpSums = [];
    const rowsOf = (g) => {
      const rows = g.map((c) => buildRow(c, { idx: flat.indexOf(c), n: flat.length }));
      if (g.length < 2) return rows;
      const gname = groupName(g[0], store.state.categories);
      const sum = h('span', { class: 'gc-sum num' });
      ui.grpSums.push({ sum, ids: g.map((c) => c.id) });
      return [h('div', { class: 'acct-grp', role: 'group', 'aria-label': `${gname}，${g.length} 个账户` }, h('div', { class: 'grp-cap' }, h('span', { class: 'gc-name' }, gname), h('span', { class: 'gc-n' }, String(g.length)), sum), ...rows)];
    };
    const card = (gs) => h('div', { class: 'acct-card' }, ...gs.flatMap(rowsOf));
    const assetGroups = groups.filter((g) => !isDebt(g[0]));
    const debtGroups = groups.filter((g) => isDebt(g[0]));
    const cards = [...(assetGroups.length ? [card(assetGroups)] : []), ...(debtGroups.length ? [h('div', { class: 'list-label' }, '负债'), card(debtGroups)] : [])];

    const note = h('textarea', { rows: '2', placeholder: '备注，例如：买了新手机，花了 5,000 元', 'aria-label': '备注', maxlength: 500 }, st.note);
    note.value = st.note;
    note.addEventListener('input', () => {
      st.note = note.value;
      st.dirty = true;
      saveDraft();
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
          dropDraft();
          await sheet.close();
          toast('已删除', { actionText: '撤销', onAction: async () => { const u = await store.undoDelete(); toast(u.ok ? '已恢复' : u.message); } });
        } }, icon('trash', { size: 16 }), '删除这条记录')
      : null;

    return h('div', { class: 'entry' }, h('div', { class: 'entry-bar' }, chip, unitSeg), ui.future, ui.dup, ui.reuse, h('div', { class: 'acct-list' }, ...cards), h('div', { class: 'entry-extra' }, addNote, noteWrap), del);
  }

  /* ------------------------------ 金额键盘 ------------------------------ */

  let padCid = null;
  const pad = amountPad({
    decimals: () => (st.unit === 'wan' ? 6 : 2),
    onChange: padChange,
    onNext: () => {
      const n = nextCid(padCid);
      if (n) openPad(n);
      else closePad();
    },
    onDone: () => closePad(),
  });
  const nextCid = (cid) => {
    const ids = [...refs.keys()];
    return ids[ids.indexOf(cid) + 1] ?? null;
  };

  function padChange(expr) {
    const r = st.rows.get(padCid);
    const ref = refs.get(padCid);
    if (!r) return;
    const ev = evalExpr(expr, st.unit);
    r.text = ev.empty ? '' : ev.error || !ev.hasOp ? expr.replace(/−/g, '-') : showAmount(ev.fen, st.unit);
    if (ref) ref.input.value = prettyExpr(expr);
    st.dirty = true;
    recalc();
    // 有加减时，名字下面那行小字直接显示结果
    if (ref && ev.hasOp && !ev.error) {
      ref.sub.className = 'sub calc';
      ref.sub.hidden = false;
      ref.sub.textContent = `= ${formatMoney(ev.fen, st.unit)}`;
      ref.reuse.hidden = true;
    }
  }

  /** 收起当前这一栏：算式换成结果，金额整理成带千分位的写法。 */
  function commitPad() {
    if (!padCid) return;
    const r = st.rows.get(padCid);
    const ref = refs.get(padCid);
    const p = r ? parseAmount(r.text, st.unit) : null;
    if (r && p?.ok && !p.empty) r.text = showAmount(p.fen, st.unit);
    if (ref) {
      ref.input.value = r?.text ?? '';
      ref.amt.classList.remove('active');
    }
    padCid = null;
    recalc();
  }

  function openPad(cid) {
    if (padCid === cid) return;
    commitPad();
    if (document.activeElement?.matches?.('input, textarea')) document.activeElement.blur(); // 收起系统键盘（备注、外币栏）
    padCid = cid;
    const ref = refs.get(cid);
    ref?.amt.classList.add('active');
    pad.start(st.rows.get(cid)?.text ?? '');
    pad.setNext(!!nextCid(cid));
    sheet.el.classList.add('kp-open');
    // 键盘升起后可视区变小：把正在填的这一行刚好露出来
    setTimeout(() => {
      const row = ref?.amt.closest('.acct');
      if (!row) return;
      const r = row.getBoundingClientRect();
      const b = sheet.body.getBoundingClientRect();
      const m = 14;
      let dy = 0;
      if (r.bottom > b.bottom - m) dy = r.bottom - (b.bottom - m);
      else if (r.top < b.top + m) dy = r.top - (b.top + m);
      if (dy) sheet.body.scrollBy({ top: dy, behavior: 'smooth' });
    }, 60);
  }

  function closePad() {
    commitPad();
    sheet.el.classList.remove('kp-open');
  }

  const onKey = (e) => {
    if (!padCid || e.target.closest?.('input:not([readonly]), textarea, select, .dialog')) return;
    pad.key(e);
  };

  /* ------------------------------ 保存 ------------------------------ */

  let saving = false;
  async function save() {
    if (saving) return;
    const ev = recalc();
    if (ui.blocked) {
      fx.error();
      toast(ui.blocked);
      return;
    }
    saving = true;
    ui.save.disabled = true;
    let res;
    try {
      res = await store.saveSnapshot({ id: st.id, date: st.date, note: st.note.trim(), entries: ev.entries, source: 'manual' });
    } catch (e) {
      res = { ok: false, message: `保存失败：${e?.message ?? e}` };
    }
    saving = false;
    ui.save.disabled = false;
    if (!res.ok) {
      recalc();
      return alertDialog({ title: res.code === 'DUP_DATE' ? '这一天已有记录' : '没有保存', message: res.message });
    }
    st.dirty = false;
    dropDraft();
    fx.success();
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
  // 按下「保存」时不让输入框失去焦点：否则键盘先收起、底栏跟着下移，有些浏览器会因此把这次点击落空
  ui.save = keepFocus(button('保存', save));
  ui.progress = h('span', { class: 'prog' });
  ui.bar = h('i', {});
  // 键盘弹出时底栏换成一行：已填几项 · 合计 · 保存，把高度让给正在填的内容
  ui.kbProg = h('span', { class: 'kp' });
  ui.kbSum = h('span', { class: 'ks num' });
  ui.kbSave = keepFocus(h('button', { type: 'button', class: 'kb-save', onClick: save }, '保存'));
  const kbBar = h('div', { class: 'kb-bar' }, ui.kbProg, ui.kbSum, ui.kbSave);
  const foot = h('div', { class: 'entry-foot' }, h('div', { class: 'fill-bar', 'aria-hidden': 'true' }, ui.bar), h('div', { class: 'sum', 'aria-live': 'polite' }, h('div', { class: 'cap' }, ui.lbl, ui.stamp, ui.progress), ui.big), ui.save, ui.msg, kbBar);
  ui.reuseSub = h('span', { class: 'rs' });
  ui.reuseTitle = h('span', { class: 'rt' }, '一键沿用上次金额');
  ui.reuse = h('button', { type: 'button', class: 'reuse-all', hidden: true, onClick: reuseAll }, h('span', { class: 'ra-ico' }, icon('repeat', { size: 18 })), h('span', { class: 'grow' }, ui.reuseTitle, ui.reuseSub), icon('chevronR', { size: 18 }));

  const sheet = openSheet({
    title: st.id ? '修改记录' : '记一笔',
    body: buildForm(),
    footer: h('div', { class: 'entry-footwrap' }, foot, pad.el),
    // 没保存就关掉：内容存成草稿，下次打开还在；只有存不了草稿（浏览器禁止本地存储）时才提醒
    beforeClose: async () => {
      if (padCid) closePad();
      if (!st.dirty) return true;
      flushDraft();
      if (draftOk) {
        toast('已暂存，下次打开继续');
        return true;
      }
      return confirmDialog({ title: '放弃修改？', message: '你填写的内容还没有保存。', confirmText: '放弃', cancelText: '继续编辑', danger: true });
    },
    onClose: () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flushDraft);
    },
  });
  sheet.el.classList.add('entry-sheet');
  document.addEventListener('keydown', onKey);
  // 点金额栏以外的地方（不是滑动）收起金额键盘；去填备注、外币栏时也收起
  sheet.body.addEventListener('click', (e) => {
    if (padCid && !e.target.closest('.amt, .reuse')) closePad();
  });
  sheet.body.addEventListener('focusin', (e) => {
    if (padCid && e.target.matches('input:not([readonly]), textarea')) closePad();
  });
  ui.manageBtn = h('button', { type: 'button', class: 'head-btn', onClick: () => setManage(!st.manage) }, '管理');
  const head = sheet.el.querySelector('.sheet-head');
  if (!head.querySelector('.head-btn')) head.insertBefore(ui.manageBtn, head.lastElementChild); // 已开着的记一笔不会再叠一个按钮
  recalc();
  if (restored) {
    toast('已恢复上次没保存的内容', {
      actionText: '清空',
      ms: 6000,
      onAction: () => {
        dropDraft();
        const snap = current();
        st.date = snap?.date ?? date ?? todayISO();
        st.unit = store.state.settings.unit;
        st.note = snap?.note ?? '';
        fillRows(snap);
        st.reusedCount = 0;
        st.dirty = false;
        rebuild();
      },
    });
  }
  return sheet;
}
