// 记一笔 / 修改一条快照。空白 = 未记录，0 = 已确认余额为零；总额由程序计算。
// 版面原则：顶部是日期和「一键沿用上次」；每个账户一行——左边名字和上次的数，右边是大号金额栏；
// 只有点金额栏才会弹出键盘（上下滑动时碰到行不会误触）；同类账户的添加、外币等放进每行的「⋯」。
import { h, icon } from '../dom.js';
import { alertDialog, button, confirmDialog, noteBox, openSheet, promptDialog, seg, stamp, switchControl, toast } from '../components.js';
import { catIcon } from '../fmt.js';
import { formatDecimal, formatMoney, formatSigned, parseAmount } from '../../core/money.js';
import { dayDiff, formatDateZh, isISODate, relativeDaysZh, todayISO } from '../../core/date.js';
import { cleanName, enabledCategories, groupKey, isDebt, nameKey, sortedCategories, suggestSiblingName } from '../../core/model.js';
import { findByDate, hasValue, isComplete, recordedTotal, sortDesc } from '../../core/ledger.js';
import { displayCategories } from '../snapshotView.js';
import { addDebtAccount, renameCategory, toggleDebt } from '../categoryActions.js';
import { confirmDeleteCategory, openCategoryEditor, openReorderSheet } from '../categoryEditor.js';

const newRow = () => ({ text: '', fxOn: false, cur: '', orig: '' });
/** 输入框里显示的金额：带千分位（218,440.72），parseAmount 能原样读回。 */
const showAmount = (fen, unit) => formatDecimal(fen, unit);

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
    const shown = debt ? `上次欠 ${formatMoney(-last.fen, st.unit)}` : `上次 ${formatMoney(last.fen, st.unit)}`;
    return { kind: 'last', text: `${shown}${last.fx ? `（${last.fx.currency}）` : ''}${far}`, reuse: !last.fx && !row.fxOn, fen: last.fen };
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
      // 名字下面一行小字（上次的数 / 较上次变化 / 错误）；能沿用时金额栏左边出现「沿用」
      ref.sub.className = `sub${s.kind ? ` ${s.kind}` : ''}`;
      ref.sub.hidden = !s.text;
      ref.sub.textContent = s.text;
      ref.reuse.hidden = !s.reuse;
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
    ui.reuseSub.textContent = canReuse ? `${reusable} 个空着的账户填入上次余额，只改有变化的` : '有变化的账户直接改金额就行';
    ui.reuse.setAttribute('aria-label', canReuse ? `把空着的 ${reusable} 项都沿用上次的金额` : ui.reuseTitle.textContent);

    // 底部：合计（不完整时绝不叫「总资产」）
    ui.lbl.textContent = ev.count === 0 ? '合计' : ev.complete ? (ev.hasDebt ? '净资产' : '总资产') : '已记录合计';
    ui.stamp.replaceChildren(...(ev.count === 0 ? [] : [stamp(ev.complete, { sm: true })]));
    ui.big.textContent = ev.count === 0 ? '—' : formatMoney(ev.total, st.unit);
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
    else if (dup) reason = '这一天已有记录，请先载入它再修改';
    else if (ev.hasError) reason = '有金额写得不对，请先改正标红的地方';
    const note = reason || (ev.count > 0 && !ev.complete ? `还缺：${ev.missing.map(catName).join('、')}` : '');
    ui.msg.textContent = note;
    ui.msg.hidden = !note;
    ui.msg.classList.toggle('err', !!reason);
    // 「保存」不再变成真正的 disabled（那样点了毫无反应，也看不到原因）：看起来变淡，点了会说明为什么不能保存
    ui.blocked = reason || (ev.count === 0 ? '先填至少一个账户的金额' : '');
    ui.save.classList.toggle('off', !!ui.blocked);
    ui.save.setAttribute('aria-disabled', String(!!ui.blocked));
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
      r.text = showAmount(signed(last.fen, c.id), st.unit);
      const input = refs.get(c.id)?.input;
      if (input) input.value = r.text;
      done.push({ cid: c.id, text: r.text });
    }
    if (!done.length) return;
    st.dirty = true;
    st.reusedCount = done.length;
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
    const debtSw = switchControl(isDebt(cat), async (on) => {
      await opt.close();
      if (await toggleDebt(store, cat.id, on)) rebuild();
    }, `${cat.name}：负债`);
    // 任何账户都能删：有金额时会说清楚要删掉多少笔，并建议改为「停用」
    const del = button('删除这个账户', async () => {
      if (!(await confirmDeleteCategory(store, cat.id))) return;
      st.rows.delete(cat.id);
      await opt.close();
      rebuild();
    }, { kind: 'danger', block: true, iconName: 'trash' });
    const edit = h('button', { type: 'button', class: 'item', onClick: async () => {
      await opt.close();
      openCategoryEditor(store, cat.id, { onChange: rebuild });
    } }, h('span', { class: 'ico' }, icon('sliders', { size: 18 })), h('span', { class: 'grow' }, h('div', { class: 'title' }, '换图标 · 停用'), h('div', { class: 'meta' }, '停用后记一笔和首页都不再显示它')), icon('chevronR', { size: 18 }));
    const rename = h('button', { type: 'button', class: 'item', onClick: async () => {
      await opt.close();
      if (await renameCategory(store, cat.id)) rebuild();
    } }, h('span', { class: 'ico' }, icon('edit', { size: 18 })), h('span', { class: 'grow' }, h('div', { class: 'title' }, '改名'), h('div', { class: 'meta' }, `现在叫「${cat.name}」，以前的记录会一起改`)), icon('chevronR', { size: 18 }));
    const sibling = h('button', { type: 'button', class: 'item', onClick: async () => {
      await opt.close();
      addSibling(cat);
    } }, h('span', { class: 'ico' }, icon('plus', { size: 18 })), h('span', { class: 'grow' }, h('div', { class: 'title' }, `再添加一个「${rootName(cat)}」账户`), h('div', { class: 'meta' }, '例如有两个支付宝，分开记录')), icon('chevronR', { size: 18 }));
    const opt = openSheet({
      title: cat.name,
      auto: true,
      body: h(
        'div',
        { class: 'stack' },
        h('div', { class: 'list' }, rename, edit, sibling, h('div', { class: 'setting' }, h('div', { class: 'grow' }, h('div', {}, '这是负债'), h('div', { class: 'desc' }, '信用卡、花呗、贷款等：填欠款金额（正数），自动从资产里减去')), debtSw), h('div', { class: 'setting' }, h('div', { class: 'grow' }, h('div', {}, '非人民币资产'), h('div', { class: 'desc' }, '金额栏填折算后的人民币；币种和原币数量记在下面作依据。App 不会自动换汇。')), sw)),
        del,
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
    const input = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', class: 'money', 'aria-label': `${cat.name}金额`, 'aria-describedby': `acct-sub-${idx}`, placeholder: '输入金额', value: r.text, enterkeyhint: idx === n - 1 ? 'done' : 'next' });
    input.addEventListener('input', () => {
      r.text = input.value;
      touch();
    });
    // 填完离开时整理成带千分位的写法；写错的保持原样，方便改
    input.addEventListener('blur', () => {
      const p = parseAmount(input.value, st.unit);
      if (!p.ok || p.empty) return;
      const pretty = showAmount(p.fen, st.unit);
      if (pretty !== input.value) {
        input.value = pretty;
        r.text = pretty;
      }
    });
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const next = [...refs.values()][idx + 1]?.input;
      if (next) next.focus();
      else input.blur();
    });
    // 金额栏是一个 label：点框里任何位置都会聚焦输入框；行的其他地方不响应，滑动时不会误弹键盘
    const debt = isDebt(cat);
    const amt = h('label', { class: ['amt', debt && 'debt'] }, h('span', { class: 'pre', 'aria-hidden': 'true' }, debt ? '欠 ¥' : '¥'), input, st.unit === 'wan' ? h('span', { class: 'sfx' }, '万') : null);

    const sub = h('div', { class: 'sub', id: `acct-sub-${idx}`, hidden: true });
    const reuse = keepFocus(h('button', { type: 'button', class: 'reuse', hidden: true, 'aria-label': `${cat.name}：沿用上次的金额` }, icon('repeat', { size: 13, stroke: 2 }), '沿用'));
    reuse.addEventListener('click', () => {
      const last = reusableOf(cat);
      if (!last) return;
      r.text = showAmount(signed(last.fen, cat.id), st.unit);
      input.value = r.text;
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

    const row = h(
      'div',
      { class: 'acct' },
      h('div', { class: 'acct-top' }, catIcon(cat, store.state.categories, { size: 34 }), h('div', { class: 'acct-name' }, h('div', { class: 'l1' }, h('span', { class: 'nm' }, cat.name), debt ? h('span', { class: 'tag debt' }, '负债') : null, cat.enabled ? null : h('span', { class: 'tag' }, '已停用')), sub), more),
      h('div', { class: 'acct-bottom' }, reuse, amt),
      fx,
    );
    refs.set(cat.id, { input, amt, sub, reuse, fx, cur, more });
    return row;
  }

  function buildForm() {
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

    const card = (g) => h('div', { class: 'acct-card' }, ...g.map((c) => buildRow(c, { idx: flat.indexOf(c), n: flat.length })));
    const assetGroups = groups.filter((g) => !isDebt(g[0]));
    const debtGroups = groups.filter((g) => isDebt(g[0]));
    const cards = [...assetGroups.map(card), ...(debtGroups.length ? [h('div', { class: 'list-label' }, '负债'), ...debtGroups.map(card)] : [])];
    const reorder = h('button', { type: 'button', class: 'link-btn', onClick: () => openReorderSheet(store, { onDone: rebuild }) }, icon('grip', { size: 15, stroke: 2 }), '调整账户顺序');
    const addDebt = h('button', { type: 'button', class: 'link-btn', onClick: async () => {
      if (await addDebtAccount(store)) rebuild();
    } }, icon('plus', { size: 14, stroke: 2.2 }), debtGroups.length ? '再添加负债账户' : '添加负债账户（信用卡、花呗、贷款）');

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

    return h('div', { class: 'entry' }, h('div', { class: 'entry-bar' }, chip, unitSeg), ui.future, ui.dup, ui.reuse, h('div', { class: 'acct-list' }, ...cards), h('div', { class: 'entry-extra' }, h('div', { class: 'extra-links' }, reorder, addDebt), addNote, noteWrap), del);
  }

  /* ------------------------------ 保存 ------------------------------ */

  let saving = false;
  async function save() {
    if (saving) return;
    const ev = recalc();
    if (ui.blocked) {
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
  const foot = h('div', { class: 'entry-foot' }, h('div', { class: 'fill-bar', 'aria-hidden': 'true' }, ui.bar), h('div', { class: 'sum', 'aria-live': 'polite' }, h('div', { class: 'cap' }, ui.lbl, ui.stamp, ui.progress), ui.big), ui.save, ui.msg);
  ui.reuseSub = h('span', { class: 'rs' });
  ui.reuseTitle = h('span', { class: 'rt' }, '一键沿用上次金额');
  ui.reuse = h('button', { type: 'button', class: 'reuse-all', hidden: true, onClick: reuseAll }, h('span', { class: 'ra-ico' }, icon('repeat', { size: 18 })), h('span', { class: 'grow' }, ui.reuseTitle, ui.reuseSub), icon('chevronR', { size: 18 }));

  const sheet = openSheet({
    title: st.id ? '修改记录' : '记一笔',
    body: buildForm(),
    footer: foot,
    beforeClose: async () => !st.dirty || confirmDialog({ title: '放弃修改？', message: '你填写的内容还没有保存。', confirmText: '放弃', cancelText: '继续编辑', danger: true }),
  });
  recalc();
  return sheet;
}
