// 单条记录详情：各类别金额与变化、提示、修改 / 删除。
import { h } from '../dom.js';
import { alertDialog, button, confirmDialog, issueList, openSheet, toast } from '../components.js';
import { accountRows, coverCard, shareBar } from '../snapshotView.js';
import { compareSnapshots, previousCompleteOf, previousOf, recordedTotal } from '../../core/ledger.js';
import { checkSnapshot } from '../../core/anomalies.js';
import { formatDateZh, relativeDaysZh } from '../../core/date.js';
import { SOURCE_LABELS } from '../../core/model.js';

function stampTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || d.getTime() < 86400000) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function openDetail(ctx, id) {
  const { store, nav } = ctx;
  let unsub = () => {};
  const sheet = openSheet({ title: '记录详情', body: h('div', {}), onClose: () => unsub() });

  const draw = () => {
    const { snapshots, categories, settings } = store.state;
    const snap = snapshots.find((s) => s.id === id);
    if (!snap) {
      sheet.close();
      return;
    }
    const unit = settings.unit;
    const prevAny = previousOf(snapshots, snap);
    const prevComp = snap.complete ? previousCompleteOf(snapshots, snap) : null;
    const cmpCat = prevAny ? compareSnapshots(snap, prevAny) : null;
    const cmpTotal = prevComp ? compareSnapshots(snap, prevComp) : null;
    const issues = checkSnapshot(snap, { categories, snaps: snapshots, unit, thresholdPct: settings.changeThresholdPct });

    const dateText = `${formatDateZh(snap.date, { weekday: true })} · ${relativeDaysZh(snap.date)}`;
    let change = null;
    let changeNote = null;
    let basis = null;
    if (snap.complete) {
      if (cmpTotal?.total) {
        change = cmpTotal.total;
        changeNote = `较 ${formatDateZh(prevComp.date)}`;
        if (cmpTotal.total.basisChanged) basis = h('span', { class: 'tag' }, '账户口径不同，仅供参考');
      } else changeNote = prevComp ? null : '没有更早的完整记录可比较';
    } else if (cmpCat?.partial) {
      change = cmpCat.partial;
      changeNote = `已记录部分较 ${formatDateZh(prevAny.date)}`;
    }
    const head = coverCard({ label: snap.complete ? '总资产' : '已记录合计（不是总资产）', dateText, fen: recordedTotal(snap), complete: snap.complete, unit, change, changeNote, note: basis, bar: shareBar(snap, categories) });
    const rows = accountRows({ snap, categories, unit, cmp: cmpCat });

    const frag = [head, h('div', { class: 'detail-rows' }, rows)];
    if (cmpCat && prevAny) frag.push(h('p', { class: 'muted small', style: 'margin:10px 2px 0' }, `变化均与 ${formatDateZh(prevAny.date)} 的记录相比${prevAny.complete ? '' : '（那一条不完整，只比较两边都有金额的账户）'}`));
    if (issues.length) frag.push(h('div', { class: 'card flat', style: 'margin-top:14px' }, h('div', { class: 'card-title' }, '请检查'), issueList(issues)));
    if (snap.note) frag.push(h('div', { class: 'card flat', style: 'margin-top:14px' }, h('div', { class: 'card-title' }, '备注'), h('div', { style: 'white-space:pre-wrap;word-break:break-word' }, snap.note)));
    frag.push(h('div', { class: 'muted small', style: 'margin:16px 2px 0' }, `${SOURCE_LABELS[snap.source] ?? snap.source}${stampTime(snap.updatedAt) ? ` · 最后修改 ${stampTime(snap.updatedAt)}` : ''}`));
    sheet.body.replaceChildren(...frag);

    sheet.setFooter(
      h(
        'div',
        { class: 'row' },
        h('div', { class: 'grow' }, button('修改', () => nav.openEntry({ id: snap.id }), { block: true, iconName: 'edit' })),
        button('删除', async () => {
          const ok = await confirmDialog({ title: '删除这条记录？', message: `${formatDateZh(snap.date)}的记录会被删除。删除后可以马上撤销。`, confirmText: '删除', danger: true });
          if (!ok) return;
          const r = await store.deleteSnapshot(snap.id);
          if (!r.ok) return alertDialog({ title: '删除失败', message: r.message });
          await sheet.close();
          toast('已删除', { actionText: '撤销', onAction: async () => { const u = await store.undoDelete(); toast(u.ok ? '已恢复' : u.message); } });
        }, { kind: 'danger', iconName: 'trash' }),
      ),
    );
  };
  draw();
  unsub = store.subscribe(draw);
  return sheet;
}
