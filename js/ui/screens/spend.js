// 开销页：问一句（「这个月打车花了多少」）→ 本月合计与分类占比 → 按天列出每一笔。
import { h, icon } from '../dom.js';
import { button, emptyState, toast } from '../components.js';
import { dayName, openSpend, openSpendEdit, spendChip, voice } from '../spend.js';
import { spendIcon } from '../spendIcons.js';
import { answer, isQuestion, spendCat, summarize } from '../../core/spending.js';
import { formatMoney } from '../../core/money.js';
import { todayISO, weekdayZh } from '../../core/date.js';

const pad = (n) => String(n).padStart(2, '0');
const monthEnd = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${pad(new Date(y, m, 0).getDate())}`;
};
const shiftMonth = (ym, n) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};

// 看到哪个月、最近一次问答：放在模块里，数据刷新重画后保持
const view = { month: null, ask: null, q: '' };

export function buildSpend(ctx) {
  const { store } = ctx;
  const root = h('div', {});

  const draw = () => {
    const { expenses } = store.state;
    const today = todayISO();
    view.month = view.month ?? today.slice(0, 7);
    const ym = view.month;
    const from = `${ym}-01`;
    const to = ym === today.slice(0, 7) ? today : monthEnd(ym);
    const frag = [];

    // 顶栏：标题 + 月份
    const isNow = ym === today.slice(0, 7);
    frag.push(
      h(
        'div',
        { class: 'screen-head' },
        h('h1', { class: 'screen-title' }, '开销'),
        h(
          'div',
          { class: 'month-nav' },
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': '上个月', onClick: () => { view.month = shiftMonth(ym, -1); view.ask = null; draw(); } }, icon('chevronL', { size: 18 })),
          h('span', {}, `${ym.slice(0, 4) !== today.slice(0, 4) ? `${ym.slice(0, 4)}年` : ''}${Number(ym.slice(5))}月`),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': '下个月', disabled: isNow, onClick: () => { view.month = shiftMonth(ym, 1); view.ask = null; draw(); } }, icon('chevronR', { size: 18 })),
        ),
      ),
    );

    // 问一句 / 记一句：带金额就去记账，是问题就当场回答
    const ask = h('input', { class: 'ask-in', placeholder: '问一句：这个月打车花了多少？', value: view.q, 'aria-label': '问开销，或者用一句话记账', enterkeyhint: 'search', autocomplete: 'off' });
    const mic = h('button', { type: 'button', class: 'ask-mic', 'aria-label': '用语音问' }, spendIcon('mic', { size: 20, stroke: 1.8 }));
    const submit = () => {
      const q = ask.value.trim();
      view.q = q;
      if (!q) return;
      if (isQuestion(q)) {
        view.ask = answer(q, store.state.expenses, { today });
        draw();
      } else {
        view.q = '';
        openSpend(ctx, { text: q });
      }
    };
    ask.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), submit()));
    const v = voice({
      onText: (t) => {
        ask.value = t;
      },
      onState: (s) => {
        mic.classList.toggle('on', s === 'listening');
        if (s === 'idle' && ask.value.trim()) submit();
      },
      onFail: () => {
        toast('这里用不了网页语音：点输入框，再点键盘上的麦克风说话', { ms: 5000 });
        ask.focus();
      },
    });
    mic.addEventListener('click', () => (v.on ? v.stop() : v.start('')));
    frag.push(h('div', { class: 'ask' }, spendIcon('search', { size: 18 }), ask, mic));

    // 问答结果
    if (view.ask) {
      const a = view.ask;
      const subject = a.word || (a.cat ? spendCat(a.cat).name : '全部');
      frag.push(
        h(
          'section',
          { class: 'answer' },
          h('div', { class: 'an-head' }, h('span', {}, `${a.label} · ${subject}`), h('button', { type: 'button', class: 'icon-btn', 'aria-label': '关闭', onClick: () => { view.ask = null; view.q = ''; draw(); } }, icon('x', { size: 16 }))),
          h('div', { class: 'an-big mask' }, formatMoney(a.total, 'yuan')),
          h('div', { class: 'an-sub' }, a.count ? `${a.count} 笔 · 平均 ${formatMoney(Math.round(a.total / a.count), 'yuan')}` : '这段时间没有找到相关的开销'),
          a.items.length
            ? h('div', { class: 'an-list' }, ...a.items.slice(0, 5).map((e) => h('div', { class: 'an-row' }, h('span', {}, `${dayName(e.date, today)} ${e.note}`), h('b', { class: 'mask' }, formatMoney(e.fen, 'yuan')))), a.items.length > 5 ? h('div', { class: 'an-more' }, `还有 ${a.items.length - 5} 笔`) : null)
            : null,
        ),
      );
    }

    const sum = summarize(expenses, from, to);
    if (!expenses.length) {
      frag.push(
        emptyState({
          glyph: 'ledger',
          title: '一句话记开销',
          text: '说或写「午饭 35，打车 20」，自动分好类；之后问「这个月打车花了多少」就能看到答案。',
          actions: [button('记一笔开销', () => openSpend(ctx), { iconName: 'plus', block: true })],
        }),
      );
      root.replaceChildren(...frag);
      return;
    }

    // 本月合计 + 分类占比
    const todaySum = isNow ? summarize(expenses, today, today).total : null;
    const days = isNow ? Number(today.slice(8)) : Number(to.slice(8));
    const top = sum.cats.slice(0, 6);
    frag.push(
      h(
        'section',
        { class: 'sp-sum' },
        h('div', { class: 'ss-label' }, isNow ? '本月支出' : `${Number(ym.slice(5))}月支出`),
        h('div', { class: 'ss-big mask' }, formatMoney(sum.total, 'yuan')),
        h('div', { class: 'ss-sub' }, isNow ? h('span', {}, '今天 ', h('b', { class: 'mask' }, formatMoney(todaySum, 'yuan'))) : null, h('span', {}, '日均 ', h('b', { class: 'mask' }, formatMoney(Math.round(sum.total / Math.max(1, days)), 'yuan'))), h('span', {}, `${sum.count} 笔`)),
        sum.total
          ? h(
              'div',
              { class: 'ss-cats' },
              ...top.map((c) =>
                h(
                  'button',
                  { type: 'button', class: 'ss-cat', onClick: () => {
                    const items = sum.list.filter((e) => e.cat === c.key).sort((a, b) => (a.date + a.time < b.date + b.time ? 1 : -1));
                    view.ask = { label: isNow ? '本月' : `${Number(ym.slice(5))}月`, word: '', cat: c.key, total: c.fen, count: items.length, items };
                    draw();
                  } },
                  spendChip(c.key, 30),
                  h('div', { class: 'grow' }, h('div', { class: 'ss-row' }, h('span', {}, spendCat(c.key).name), h('b', { class: 'mask' }, formatMoney(c.fen, 'yuan'))), h('div', { class: 'ss-bar' }, h('i', { style: `width:${Math.max(2, c.share * 100).toFixed(1)}%` }))),
                  h('span', { class: 'ss-pct' }, `${(c.share * 100).toFixed(0)}%`),
                ),
              ),
            )
          : null,
      ),
    );

    // 按天列出
    const byDay = new Map();
    for (const e of [...sum.list].sort((a, b) => (a.date + a.time < b.date + b.time ? 1 : -1))) {
      if (!byDay.has(e.date)) byDay.set(e.date, []);
      byDay.get(e.date).push(e);
    }
    if (!byDay.size) frag.push(h('p', { class: 'muted small', style: 'text-align:center;margin:28px 0' }, '这个月还没有开销'));
    for (const [d, list] of byDay) {
      const total = list.reduce((n, e) => n + e.fen, 0);
      frag.push(
        h(
          'section',
          { class: 'sp-day' },
          h('div', { class: 'sd-head' }, h('span', {}, `${dayName(d, today)}`, h('i', {}, ` ${weekdayZh(d)}`)), h('b', { class: 'mask' }, formatMoney(total, 'yuan'))),
          h(
            'div',
            { class: 'sd-list' },
            ...list.map((e) =>
              h(
                'button',
                { type: 'button', class: 'sd-row', onClick: () => openSpendEdit(ctx, e.id) },
                spendChip(e.cat, 36),
                h('div', { class: 'grow' }, h('div', { class: 'sd-note' }, e.note), h('div', { class: 'sd-meta' }, `${spendCat(e.cat).name} · ${e.time}`)),
                h('div', { class: 'sd-amt mask' }, formatMoney(e.fen, 'yuan')),
              ),
            ),
          ),
        ),
      );
    }
    root.replaceChildren(...frag);
  };

  draw();
  const off = store.subscribe(draw);
  return { el: root, destroy: off };
}
