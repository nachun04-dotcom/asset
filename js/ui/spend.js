// 记一笔开销：说一句或写一句（「午饭 35，打车 20」），下面实时拆成几笔，确认后一起记下；
// 也可以点分类标签手动记。另有单笔修改面板、语音输入、分类小图标。
import { h, icon } from './dom.js';
import { button, confirmDialog, openSheet, toast } from './components.js';
import { fx } from './feedback.js';
import { spendIcon } from './spendIcons.js';
import { SPEND_CATS, iconFor, isQuestion, parseSpending, spendCat } from '../core/spending.js';
import { formatMoney, parseAmount } from '../core/money.js';
import { addDays, formatDateZh, todayISO } from '../core/date.js';

/** 分类小图标：类别色的圆底 + 线条图形。note：备注里有「台球」「KTV」这类关键词时换成专属图标。 */
export function spendChip(key, size = 32, note = '') {
  const c = spendCat(key);
  return h('span', { class: `cat-ico ${c.color >= 0 ? `c${c.color}` : 'cx'}`, style: `--sz:${size}px`, 'aria-hidden': 'true' }, spendIcon(iconFor(key, note), { size: Math.round(size * 0.52) }));
}

/** 今天 / 昨天 / 10月20日 */
export function dayName(iso, today = todayISO()) {
  if (iso === today) return '今天';
  if (iso === addDays(today, -1)) return '昨天';
  if (iso === addDays(today, -2)) return '前天';
  return formatDateZh(iso, { year: iso.slice(0, 4) !== today.slice(0, 4) });
}

/* ------------------------------ 语音 ------------------------------ */

const SR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

/**
 * 网页语音识别（iPhone 的 Safari 用的是系统的听写）。不支持或被拒绝时 onFail 告诉调用方，
 * 调用方改为让用户用键盘上的麦克风说。
 */
export function voice({ onText, onState, onFail }) {
  let rec = null;
  let finalText = '';
  return {
    get on() {
      return !!rec;
    },
    start(prefix = '') {
      if (!SR) return onFail('unsupported');
      try {
        rec = new SR();
      } catch {
        return onFail('unsupported');
      }
      finalText = prefix;
      rec.lang = 'zh-CN';
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      rec.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finalText += r[0].transcript;
          else interim += r[0].transcript;
        }
        onText(finalText + interim);
      };
      rec.onerror = (e) => {
        const why = e.error;
        rec = null;
        onState('idle');
        if (why !== 'aborted' && why !== 'no-speech') onFail(why);
      };
      rec.onend = () => {
        rec = null;
        onState('idle');
      };
      try {
        rec.start();
        onState('listening');
      } catch {
        rec = null;
        onFail('unsupported');
      }
    },
    stop() {
      rec?.stop();
    },
  };
}

const VOICE_FAIL_TIP = '这里用不了网页语音：点输入框，再点键盘上的麦克风说话';

/* ------------------------------ 一句话记账 ------------------------------ */

/**
 * 打开「记一笔开销」。text：预先填好的一句话（例如在开销页的问句框里输入了带金额的话）。
 */
export function openSpend(ctx, { text = '' } = {}) {
  const { store, nav } = ctx;
  const today = todayISO();
  const st = { text, rows: [], manual: [], edits: new Map(), picking: null };

  const input = h('textarea', { class: 'sp-input', rows: 2, placeholder: '说一句或写一句：中午吃饭 35，打车 20', 'aria-label': '用一句话记开销', autocomplete: 'off', enterkeyhint: 'done' });
  input.value = text;
  const status = h('div', { class: 'sp-status', 'aria-live': 'polite' });
  const mic = h('button', { type: 'button', class: 'sp-mic', 'aria-label': '语音记账' }, spendIcon('mic', { size: 24, stroke: 1.8 }));
  const preview = h('div', { class: 'sp-preview' });
  const saveBtn = h('button', { type: 'button', class: 'btn block sp-save' }, '记下');

  const v = voice({
    onText: (t) => {
      input.value = t;
      reparse();
    },
    onState: (s) => {
      mic.classList.toggle('on', s === 'listening');
      status.textContent = s === 'listening' ? '正在听…说完停一下就好' : '';
      if (s === 'listening') fx.select();
    },
    onFail: () => {
      toast(VOICE_FAIL_TIP, { ms: 5000 });
      input.focus();
    },
  });
  mic.addEventListener('click', () => (v.on ? v.stop() : v.start(input.value ? `${input.value.trim()}，` : '')));

  // 解析出来的几笔 + 手动加的几笔；每一行的修改（分类、备注、金额、日期）单独记着，重新解析时按序号保留
  const all = () => [...st.rows.map((r, i) => ({ ...r, ...st.edits.get(i), _i: i })), ...st.manual];
  let pt = null;
  function reparse() {
    clearTimeout(pt);
    pt = setTimeout(() => {
      st.rows = parseSpending(input.value, { today });
      for (const k of [...st.edits.keys()]) if (k >= st.rows.length) st.edits.delete(k);
      draw();
    }, 120);
  }
  input.addEventListener('input', reparse);

  const keyOf = (row) => (row._i != null ? `p${row._i}` : `m${st.manual.indexOf(row)}`);
  const patch = (row, p) => {
    if (row._i != null) st.edits.set(row._i, { ...st.edits.get(row._i), ...p });
    else Object.assign(row, p);
  };

  function rowEl(row) {
    const amt = h('input', { class: 'sr-amt', inputmode: 'decimal', placeholder: '金额', value: row.fen ? String(row.fen / 100) : '', 'aria-label': '金额', autocomplete: 'off' });
    amt.addEventListener('input', () => {
      const p = parseAmount(amt.value, 'yuan');
      patch(row, { fen: p.ok && !p.empty && p.fen > 0 ? p.fen : 0 });
      sum();
    });
    const note = h('input', { class: 'sr-note', value: row.note, placeholder: spendCat(row.cat).name, maxlength: 30, 'aria-label': '备注', autocomplete: 'off' });
    note.addEventListener('input', () => patch(row, { note: note.value }));
    const date = h('input', { type: 'date', class: 'sr-date-in', value: row.date, max: today, 'aria-label': '日期' });
    date.addEventListener('change', () => {
      if (date.value) patch(row, { date: date.value });
      draw();
    });
    const chip = h('button', { type: 'button', class: ['sr-chip', st.picking === keyOf(row) && 'on'], 'aria-label': `分类：${spendCat(row.cat).name}，点按更换` }, spendChip(row.cat, 34, row.note));
    chip.addEventListener('click', () => {
      st.picking = st.picking === keyOf(row) ? null : keyOf(row);
      draw();
    });
    const del = h('button', { type: 'button', class: 'sr-x', 'aria-label': '去掉这一笔' }, icon('x', { size: 16 }));
    del.addEventListener('click', () => {
      if (row._i != null) {
        st.edits.set(row._i, { ...st.edits.get(row._i), removed: true });
      } else st.manual.splice(st.manual.indexOf(row), 1);
      draw();
    });
    const el = h(
      'div',
      { class: 'sr' },
      chip,
      h('div', { class: 'sr-mid' }, note, h('label', { class: 'sr-date' }, h('span', {}, `${dayName(row.date, today)} · ${spendCat(row.cat).name}`), date)),
      h('div', { class: 'sr-amt-wrap' }, h('span', {}, '¥'), amt),
      del,
    );
    const out = [el];
    if (st.picking === keyOf(row)) {
      out.push(
        h(
          'div',
          { class: 'sr-pick' },
          ...SPEND_CATS.map((c) =>
            h('button', { type: 'button', class: ['tag', c.key === row.cat && 'on'], onClick: () => {
              const old = spendCat(row.cat).name;
              patch(row, { cat: c.key, ...(row.note === old || !row.note ? { note: c.name } : {}) });
              st.picking = null;
              fx.select();
              draw();
            } }, spendChip(c.key, 22), c.name),
          ),
        ),
      );
    }
    return out;
  }

  const valid = () => all().filter((r) => !r.removed && r.fen > 0);
  function sum() {
    const list = valid();
    const total = list.reduce((n, r) => n + r.fen, 0);
    saveBtn.textContent = list.length ? `记下 ${list.length} 笔 · ${formatMoney(total, 'yuan')}` : '记下';
    saveBtn.classList.toggle('off', !list.length);
  }

  function draw() {
    const rows = all().filter((r) => !r.removed);
    const q = input.value.trim() && isQuestion(input.value);
    preview.replaceChildren(
      ...[
        ...rows.flatMap(rowEl),
        q ? h('p', { class: 'sp-hint' }, '这是一个问题？到「开销」页的提问框里问，就能直接得到答案。') : null,
        !rows.length && input.value.trim() && !q ? h('p', { class: 'sp-hint' }, '没找到金额。写上数字就行，例如「午饭 35」「打车二十」。') : null,
      ].filter(Boolean),
    );
    sum();
  }

  // 分类标签：点一下手动加一笔（金额待填）
  const tags = h(
    'div',
    { class: 'sp-tags' },
    ...SPEND_CATS.map((c) =>
      h('button', { type: 'button', class: 'sp-tag', onClick: () => {
        const row = { date: today, time: new Date().toTimeString().slice(0, 5), fen: 0, cat: c.key, note: c.name };
        st.manual.push(row);
        fx.select();
        draw();
        preview.querySelectorAll('.sr-amt').forEach((el, i, arr) => i === arr.length - 1 && el.focus());
      } }, spendChip(c.key, 40), h('span', {}, c.name)),
    ),
  );

  saveBtn.addEventListener('click', async () => {
    const list = valid().map(({ date, time, fen, cat, note }) => ({ date, time, fen, cat, note: (note || spendCat(cat).name).trim() }));
    if (!list.length) {
      fx.error();
      toast('还没有金额');
      return;
    }
    const r = await store.addExpenses(list);
    if (!r.ok) return toast(r.message);
    fx.success();
    await sheet.close();
    const total = list.reduce((n, x) => n + x.fen, 0);
    const ids = r.added.map((x) => x.id);
    toast(`已记下 ${list.length} 笔 · ${formatMoney(total, 'yuan')}`, { actionText: '撤销', onAction: () => store.deleteExpenses(ids) });
  });

  const body = h(
    'div',
    { class: 'spend' },
    h('div', { class: 'sp-box' }, input, mic),
    status,
    preview,
    h('div', { class: 'sp-sect' }, '或者点分类，手动记一笔'),
    tags,
    h('button', { type: 'button', class: 'sp-asset', onClick: async () => {
      await sheet.close();
      nav.openEntry({});
    } }, icon('wallet', { size: 16 }), '更新资产余额', icon('chevronR', { size: 14 })),
  );
  const sheet = openSheet({ title: '记一笔开销', body, footer: saveBtn, onClose: () => v.stop() });
  sheet.el.classList.add('spend-sheet');
  draw();
  if (text) reparse();
  return sheet;
}

/* ------------------------------ 单笔修改 ------------------------------ */

export function openSpendEdit(ctx, id) {
  const { store } = ctx;
  const e = store.state.expenses.find((x) => x.id === id);
  if (!e) return;
  const st = { ...e };
  const amt = h('input', { class: 'se-amt', inputmode: 'decimal', value: String(e.fen / 100), 'aria-label': '金额', autocomplete: 'off' });
  const note = h('input', { value: e.note, maxlength: 30, placeholder: '备注', 'aria-label': '备注', autocomplete: 'off' });
  const date = h('input', { type: 'date', value: e.date, max: todayISO(), 'aria-label': '日期' });
  const time = h('input', { type: 'time', value: e.time, 'aria-label': '时间' });
  const grid = h('div', { class: 'sp-tags compact' });
  const drawGrid = () =>
    grid.replaceChildren(
      ...SPEND_CATS.map((c) =>
        h('button', { type: 'button', class: ['sp-tag', c.key === st.cat && 'on'], onClick: () => {
          if (note.value === spendCat(st.cat).name) note.value = c.name;
          st.cat = c.key;
          fx.select();
          drawGrid();
        } }, spendChip(c.key, 34), h('span', {}, c.name)),
      ),
    );
  drawGrid();
  const save = async () => {
    const p = parseAmount(amt.value, 'yuan');
    if (!p.ok || p.empty || p.fen <= 0) {
      fx.error();
      return toast('金额不对');
    }
    const r = await store.updateExpense(id, { fen: p.fen, note: note.value.trim() || spendCat(st.cat).name, cat: st.cat, date: date.value || e.date, time: time.value || e.time });
    if (!r.ok) return toast(r.message);
    fx.success();
    sheet.close();
  };
  const del = async () => {
    if (!(await confirmDialog({ title: '删除这笔开销？', message: `${e.note} ${formatMoney(e.fen, 'yuan')}`, confirmText: '删除', danger: true }))) return;
    await store.deleteExpenses([id]);
    await sheet.close();
    toast('已删除', { actionText: '撤销', onAction: () => store.undoDeleteExpenses() });
  };
  const body = h(
    'div',
    { class: 'spend-edit' },
    h('div', { class: 'se-amt-row' }, h('span', {}, '¥'), amt),
    h('div', { class: 'se-fields' }, h('label', {}, h('span', {}, '备注'), note), h('label', {}, h('span', {}, '日期'), date), h('label', {}, h('span', {}, '时间'), time)),
    grid,
    h('button', { type: 'button', class: 'btn ghost se-del', onClick: del }, icon('trash', { size: 16 }), '删除这笔'),
  );
  const sheet = openSheet({ title: '修改开销', body, footer: button('保存', save, { block: true }) });
  return sheet;
}
