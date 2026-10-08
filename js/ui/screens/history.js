// 历史记录：按月分组，点开看详情。
import { h } from '../dom.js';
import { button, emptyState, seg, stamp } from '../components.js';
import { deltaSpan } from '../fmt.js';
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
      frag.push(h('div', { style: 'margin-bottom:6px' }, seg([{ value: 'all', label: '全部' }, { value: 'incomplete', label: `只看不完整 (${incompleteCount})` }], view.filter, (v) => { view.filter = v; draw(); }, { label: '筛选' })));
    } else view.filter = 'all';
    const list = sortDesc(snapshots).filter((s) => view.filter === 'all' || !s.complete);
    let month = '';
    let box = null;
    for (const s of list) {
      const mk = monthKey(s.date);
      if (mk !== month) {
        month = mk;
        frag.push(h('div', { class: 'month-head' }, `${mk.slice(0, 4)} 年 ${Number(mk.slice(5))} 月`));
        box = h('div', { class: 'list' });
        frag.push(box);
      }
      const prev = previousOf(snapshots, s);
      const cmp = prev ? compareSnapshots(s, prev) : null;
      const chg = cmp?.total ?? cmp?.partial ?? null;
      const known = knownIds(s).length;
      box.appendChild(
        h(
          'button',
          { type: 'button', class: 'item', onClick: () => nav.openDetail(s.id), 'aria-label': `${formatDateZh(s.date)}，${s.complete ? '总资产' : '已记录合计'} ${known ? formatMoney(recordedTotal(s), unit) : '无金额'}` },
          h('div', { class: 'grow' }, h('div', { class: 'title' }, `${formatDateZh(s.date, { year: false })} ${weekdayZh(s.date)}`), h('div', { class: 'meta' }, SOURCE_LABELS[s.source] ?? s.source, s.note ? ` · ${s.note.split('\n')[0].slice(0, 16)}${s.note.length > 16 ? '…' : ''}` : '')),
          h('div', { class: 'end' }, known ? h('div', { class: s.complete ? 'num' : 'num muted', style: s.complete ? 'font-weight:600' : 'font-style:italic' }, s.complete ? formatMoney(recordedTotal(s), unit) : `已记 ${formatMoney(recordedTotal(s), unit)}`) : h('div', { class: 'muted' }, '无金额'), chg ? h('div', { class: 'small' }, deltaSpan(chg.fen, chg.ratio, unit, { withRatio: false })) : null),
          s.complete ? null : stamp(false, { sm: true }),
        ),
      );
    }
    root.replaceChildren(...frag);
  };
  draw();
  return { el: root, destroy: store.subscribe(draw) };
}
