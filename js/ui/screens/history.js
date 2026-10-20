// 历史记录：按月分组，点开看详情。
import { h } from '../dom.js';
import { button, emptyState, seg, stamp } from '../components.js';
import { compactYuan, deltaSpan } from '../fmt.js';
import { monthEnds } from '../insights.js';
import { compareSnapshots, knownIds, previousOf, recordedTotal, sortDesc } from '../../core/ledger.js';
import { formatDateZh, monthKey, weekdayZh } from '../../core/date.js';
import { formatMoney } from '../../core/money.js';
import { SOURCE_LABELS } from '../../core/model.js';

const view = { filter: 'all' };

export function buildHistory(ctx) {
  const { store, nav } = ctx;
  const root = h('div', {});

  const draw = () => {
    const { snapshots, categories, settings } = store.state;
    const unit = settings.unit;
    const frag = [h('div', { class: 'screen-head' }, h('h1', { class: 'screen-title' }, '历史记录'), h('span', { class: 'muted small' }, `${snapshots.length} 条`))];
    if (!snapshots.length) {
      frag.push(emptyState({ glyph: 'ledger', title: '还没有历史记录', text: '记下第一笔，或者导入以前的记录，就会按日期出现在这里。', actions: [button('记一笔', () => nav.openEntry({}), { iconName: 'plus', block: true }), button('导入记录', () => nav.goto('import'), { kind: 'secondary', block: true })] }));
      root.replaceChildren(...frag);
      return;
    }
    const incompleteCount = snapshots.filter((s) => !s.complete).length;
    if (incompleteCount) {
      frag.push(h('div', { class: 'filter-row' }, seg([{ value: 'all', label: '全部' }, { value: 'incomplete', label: `只看不完整 (${incompleteCount})` }], view.filter, (v) => { view.filter = v; draw(); }, { label: '筛选', variant: 'lite' })));
    } else view.filter = 'all';
    const ends = monthEnds(snapshots);
    const endIdx = new Map(ends.map((e, i) => [e.month, i]));
    const list = sortDesc(snapshots).filter((s) => view.filter === 'all' || !s.complete);
    let month = '';
    let box = null;
    for (const s of list) {
      const mk = monthKey(s.date);
      if (mk !== month) {
        month = mk;
        // 月份标题右侧：月末总资产与较上一个月末的变化
        const ei = endIdx.get(mk);
        const end = ei == null ? null : ends[ei];
        const prevEnd = ei ? ends[ei - 1] : null;
        const d = end && prevEnd ? end.fen - prevEnd.fen : null;
        const sum = end
          ? h('span', { class: 'month-sum' }, d != null ? h('span', { class: `chg ${d > 0 ? 'up' : d < 0 ? 'down' : 'flat'}` }, d ? h('i', { class: 'tri', 'aria-hidden': 'true' }) : null, d === 0 ? '持平' : `${d > 0 ? '+' : '−'}${compactYuan(Math.abs(d))}`) : null, h('span', { class: 'me' }, `月末 ${compactYuan(end.fen)}`))
          : null;
        frag.push(h('div', { class: 'month-head' }, h('span', {}, `${Number(mk.slice(5))} 月`), h('span', { class: 'yr' }, mk.slice(0, 4)), sum));
        box = h('div', { class: 'list' });
        frag.push(box);
      }
      const prev = previousOf(snapshots, s);
      const cmp = prev ? compareSnapshots(s, prev) : null;
      const chg = cmp?.total ?? cmp?.partial ?? null;
      const known = knownIds(s).length;
      const noteLine = s.note ? `${s.note.split('\n')[0].slice(0, 18)}${s.note.length > 18 || s.note.includes('\n') ? '…' : ''}` : '';
      const meta = [s.source === 'manual' ? '' : SOURCE_LABELS[s.source] ?? s.source, noteLine].filter(Boolean).join(' · ');
      box.appendChild(
        h(
          'button',
          { type: 'button', class: 'item', onClick: () => nav.openDetail(s.id), 'aria-label': `${formatDateZh(s.date)}，${s.complete ? '总资产' : '已记录合计'} ${known ? formatMoney(recordedTotal(s), unit) : '无金额'}` },
          h('div', { class: 'grow' }, h('div', { class: 'title' }, formatDateZh(s.date, { year: false }), h('span', { class: 'wd' }, weekdayZh(s.date))), meta ? h('div', { class: 'meta' }, meta) : null),
          h(
            'div',
            { class: 'end' },
            known ? h('div', { class: s.complete ? 'amt-line num' : 'amt-line num part' }, s.complete ? formatMoney(recordedTotal(s), unit) : `已记 ${formatMoney(recordedTotal(s), unit)}`) : h('div', { class: 'muted' }, '无金额'),
            s.complete ? (chg ? h('div', { class: 'small' }, deltaSpan(chg.fen, chg.ratio, unit, { withRatio: false })) : null) : stamp(false, { sm: true }),
          ),
        ),
      );
    }
    root.replaceChildren(...frag);
  };
  draw();
  return { el: root, destroy: store.subscribe(draw) };
}
