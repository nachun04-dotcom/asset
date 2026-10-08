// 首页：最近一次完整快照、与上一条完整记录的变化、类别明细、趋势与占比。
import { h } from '../dom.js';
import { button, emptyState, noteBox, seg, stamp } from '../components.js';
import { catCss, catSlotClass, deltaSpan, heroAmount } from '../fmt.js';
import { buildComposition, buildDataTable, buildLineChart } from '../charts.js';
import { categorySeries, compareSnapshots, knownIds, latestComplete, latestOverall, missingIds, previousCompleteOf, recordedTotal, shares, sortAsc, totalSeries } from '../../core/ledger.js';
import { checkSnapshot } from '../../core/anomalies.js';
import { addDays, dayDiff, formatDateZh, relativeDaysZh, todayISO } from '../../core/date.js';
import { formatMoney } from '../../core/money.js';
import { groupKey, sortedCategories } from '../../core/model.js';
import { categoryRows } from '../snapshotView.js';

// 图表的选择状态放在模块里：数据刷新、重画页面后保持不变。
const view = { range: 'all', partial: false, mode: 'share', hidden: new Set(), groupBy: 'account' };

const RANGES = [
  { value: '90', label: '近 3 月', days: 90 },
  { value: '180', label: '近半年', days: 183 },
  { value: '365', label: '近 1 年', days: 365 },
  { value: 'all', label: '全部', days: null },
];

function inRange(points, latestDate) {
  const r = RANGES.find((x) => x.value === view.range);
  if (!r?.days) return points;
  const from = addDays(latestDate, -r.days);
  return points.filter((p) => p.date >= from);
}

export function backupNote(store, ctx) {
  const { snapshots, meta, settings } = store.state;
  if (!snapshots.length) return null;
  const go = [button('去备份', () => ctx.nav.goto('settings', { focus: 'backup' }), { sm: true, kind: 'secondary' })];
  if (!meta.lastBackupAt) {
    return noteBox('warn', ['还没有备份过。', h('div', { class: 'small' }, '数据只保存在这台手机的浏览器存储里，换手机、卸载或清除网站数据都会丢失。')], go);
  }
  const days = dayDiff(meta.lastBackupAt.slice(0, 10), todayISO());
  if (days >= settings.backupRemindDays) return noteBox('warn', [`距离上次备份已经 ${days} 天。`], go);
  return null;
}

export function buildHome(ctx) {
  const { store, nav } = ctx;
  const root = h('div', {});

  const draw = () => {
    const { snapshots, categories, settings } = store.state;
    const unit = settings.unit;
    const frag = [];

    // 顶栏
    frag.push(
      h(
        'div',
        { class: 'screen-head' },
        h('h1', { class: 'screen-title' }, '资产账本'),
        seg([{ value: 'yuan', label: '元' }, { value: 'wan', label: '万元' }], unit, (v) => store.updateSettings({ unit: v }), { label: '显示单位' }),
      ),
    );

    if (snapshots.length === 0) {
      frag.push(
        emptyState({
          glyph: 'ledger',
          title: '还没有记录',
          text: '这里记的是某一天各个渠道的余额快照，不是每笔收支。先记下今天的余额，或者把以前手写的记录导入进来。',
          actions: [button('记下今天的余额', () => nav.openEntry({}), { iconName: 'plus', block: true }), button('导入以前的记录', () => nav.goto('import'), { kind: 'secondary', iconName: 'download', block: true })],
        }),
      );
      root.replaceChildren(...frag);
      return;
    }

    const comp = latestComplete(snapshots);
    const newest = latestOverall(snapshots);
    const shown = comp ?? newest;

    // 最新一条不是完整记录：明确告知，不让部分合计冒充总资产
    if (newest && !newest.complete) {
      const miss = missingIds(newest).map((id) => categories.find((c) => c.id === id)?.name ?? id);
      frag.push(
        h(
          'div',
          { class: 'notes', style: 'margin-bottom:12px' },
          noteBox(
            'warn',
            [h('b', {}, `${formatDateZh(newest.date, { year: false })}的记录不完整`), h('div', { class: 'small' }, `缺少 ${miss.join('、') || '部分类别'} 的金额，所以不计入总资产。${comp ? `下面显示的是 ${formatDateZh(comp.date, { year: false })} 的完整记录。` : ''}`)],
            [button('补全这一条', () => nav.openEntry({ id: newest.id }), { sm: true, kind: 'secondary' })],
          ),
        ),
      );
    }

    // 账页
    const prevComp = comp ? previousCompleteOf(snapshots, comp) : null;
    const cmp = comp && prevComp ? compareSnapshots(comp, prevComp) : null;
    const leafHead = h(
      'div',
      { class: 'leaf-head' },
      h('div', {}, h('div', { class: 'leaf-label' }, comp ? '总资产' : '暂时算不出总资产'), h('div', { class: 'leaf-date' }, `${formatDateZh(shown.date, { weekday: true })} · ${relativeDaysZh(shown.date)}`)),
      stamp(shown.complete),
    );
    const leaf = h('section', { class: 'leaf', 'aria-label': '最近一次完整资产快照' }, leafHead);
    if (comp) {
      leaf.appendChild(heroAmount(recordedTotal(comp), unit));
      const delta = h('div', { class: 'delta' });
      if (cmp?.total) {
        delta.appendChild(deltaSpan(cmp.total.fen, cmp.total.ratio, unit));
        delta.appendChild(h('span', { class: 'muted small' }, `较 ${formatDateZh(prevComp.date, { year: prevComp.date.slice(0, 4) !== comp.date.slice(0, 4) })}`));
        if (cmp.total.basisChanged) delta.appendChild(h('span', { class: 'tag' }, '类别口径不同，仅供参考'));
      } else {
        delta.appendChild(h('span', { class: 'muted small' }, '这是第一条完整记录，暂时没有可比较的上一条'));
      }
      leaf.appendChild(delta);
    } else {
      leaf.appendChild(h('div', { class: 'hero dim', 'aria-label': '暂无总资产' }, '—'));
      leaf.appendChild(h('div', { class: 'delta' }, h('span', { class: 'muted small' }, '还没有一条完整的记录。补全各类别的金额后，这里才会显示总资产。')));
    }
    leaf.appendChild(categoryRows({ snap: shown, categories, unit, cmp }));
    frag.push(leaf);

    // 异常提示（不改任何数据）
    const issues = checkSnapshot(shown, { categories, snaps: snapshots, unit, thresholdPct: settings.changeThresholdPct }).filter((i) => i.code !== 'INCOMPLETE');
    if (issues.length) {
      frag.push(
        h(
          'div',
          { class: 'notes', style: 'margin-top:12px' },
          noteBox('warn', [h('b', {}, '请检查一下'), ...issues.map((i) => h('div', { class: 'small' }, i.text))], [button('查看并修改', () => nav.openDetail(shown.id), { sm: true, kind: 'secondary' })]),
        ),
      );
    }

    const bn = backupNote(store, ctx);
    if (bn) frag.push(h('div', { class: 'notes', style: 'margin-top:12px' }, bn));

    // 总资产趋势
    const complete = totalSeries(snapshots);
    const section1 = h('section', { class: 'section' }, h('h2', { class: 'section-title' }, '总资产趋势'));
    if (complete.length === 0) {
      section1.appendChild(h('p', { class: 'muted small' }, '有完整记录后才会画出趋势。'));
    } else {
      const latestDate = complete[complete.length - 1].date;
      const partialPts = view.partial ? totalSeries(snapshots, { includePartial: true }).filter((p) => !p.complete) : [];
      const completeIn = inRange(complete, latestDate);
      const partialIn = inRange(partialPts, latestDate);
      const rangeRow = h(
        'div',
        { class: 'range-row' },
        seg(RANGES.map((r) => ({ value: r.value, label: r.label })), view.range, (v) => {
          view.range = v;
          draw();
        }, { label: '时间范围' }),
      );
      section1.appendChild(rangeRow);
      const series = [{ id: 'total', name: '总资产', color: 'var(--pine-text)', points: completeIn, breakGaps: false }];
      if (partialIn.length) series.push({ id: 'partial', name: '已记录合计（不完整）', color: 'var(--amber)', points: partialIn, dashed: true });
      const allDates = sortAsc(snapshots).map((s) => s.date).filter((d) => completeIn.some((p) => p.date === d) || partialIn.some((p) => p.date === d));
      const chart = buildLineChart({ series, allDates, unit, height: 214, area: true, endLabel: true, ariaLabel: `总资产趋势图，共 ${completeIn.length} 个完整记录点。点击或用左右方向键查看每个点。` });
      section1.appendChild(h('div', { class: 'card', style: 'padding:12px 10px 8px' }, chart.el));
      if (completeIn.length < 2) section1.appendChild(h('p', { class: 'muted small', style: 'margin-top:8px' }, '再记录一条完整快照，就能看到变化曲线。'));
      const hasPartialAny = snapshots.some((s) => !s.complete && knownIds(s).length);
      if (hasPartialAny) {
        section1.appendChild(
          h(
            'label',
            { class: 'check small', style: 'margin-top:10px' },
            h('input', { type: 'checkbox', checked: view.partial, onChange: (e) => { view.partial = e.target.checked; draw(); } }),
            h('span', {}, '同时显示不完整记录的「已记录合计」（虚线、空心点；它不是总资产）'),
          ),
        );
      }
      const table = buildDataTable({
        columns: ['日期', '金额', '状态'],
        rows: [...completeIn.map((p) => [p.date, formatMoney(p.fen, unit), '完整']), ...partialIn.map((p) => [p.date, formatMoney(p.fen, unit), '不完整'])].sort((a, b) => (a[0] < b[0] ? -1 : 1)),
      });
      section1.appendChild(h('details', { class: 'table-view' }, h('summary', {}, '查看数据表'), table));
    }
    frag.push(section1);

    // 各类别：占比 / 趋势
    const section2 = h('section', { class: 'section' }, h('div', { class: 'row between', style: 'margin-bottom:10px' }, h('h2', { class: 'section-title', style: 'margin:0' }, '各类别'), seg([{ value: 'share', label: '占比' }, { value: 'trend', label: '趋势' }], view.mode, (v) => { view.mode = v; draw(); }, { label: '类别视图' })));
    if (view.mode === 'share') {
      const sh = shares(shown);
      if (!sh.length) {
        section2.appendChild(h('p', { class: 'muted small' }, '没有可计算占比的金额（占比只统计大于 0 的类别）。'));
      } else {
        const accounts = sortedCategories(categories)
          .map((c) => ({ c, s: sh.find((x) => x.id === c.id) }))
          .filter((x) => x.s);
        // 同类账户（例如两个支付宝）可以合并成一项来看占比
        const byType = new Map();
        for (const { c, s } of accounts) {
          const key = groupKey(c);
          const root = categories.find((x) => x.id === key) ?? c;
          const cur = byType.get(key) ?? { name: root.name, cls: catSlotClass(root), fen: 0, share: 0, n: 0 };
          cur.fen += s.fen;
          cur.share += s.share;
          cur.n += 1;
          byType.set(key, cur);
        }
        const canMerge = [...byType.values()].some((g) => g.n > 1);
        const merged = canMerge && view.groupBy === 'type';
        const parts = merged ? [...byType.values()].map(({ name, cls, fen, share, n }) => ({ name: n > 1 ? `${name}（${n} 个账户）` : name, cls, fen, share })) : accounts.map(({ c, s }) => ({ name: c.name, cls: catSlotClass(c), fen: s.fen, share: s.share }));
        if (canMerge) section2.appendChild(h('div', { class: 'row between', style: 'margin-bottom:8px' }, h('span', { class: 'label' }, '统计方式'), seg([{ value: 'account', label: '按账户' }, { value: 'type', label: '按类型合并' }], view.groupBy, (v) => { view.groupBy = v; draw(); }, { label: '占比统计方式' })));
        section2.appendChild(h('p', { class: 'section-sub' }, `${formatDateZh(shown.date, { year: false })}${shown.complete ? '' : '（不完整，仅按已记录部分计算）'}`));
        section2.appendChild(h('div', { class: 'card' }, buildComposition({ parts, unit })));
      }
    } else {
      const usedIds = new Set(snapshots.flatMap((s) => knownIds(s)));
      const cats = sortedCategories(categories).filter((c) => usedIds.has(c.id));
      const visible = cats.filter((c) => !view.hidden.has(c.id));
      const latestDate = latestOverall(snapshots).date;
      const series = visible.map((c) => ({ id: c.id, name: c.name, color: catCss(c), points: inRange(categorySeries(snapshots, c.id), latestDate) }));
      const chart = buildLineChart({ series, allDates: sortAsc(snapshots).map((s) => s.date), unit, height: 214, zeroBase: true, ariaLabel: '各类别金额变化趋势图。某天没有记录的类别会断开，不会当作 0。' });
      section2.appendChild(h('div', { class: 'card', style: 'padding:12px 10px 8px' }, chart.el));
      section2.appendChild(
        h(
          'div',
          { class: 'legend' },
          ...cats.map((c) =>
            h('button', { type: 'button', class: ['chip', view.hidden.has(c.id) && 'off'], 'aria-pressed': String(!view.hidden.has(c.id)), onClick: () => { view.hidden.has(c.id) ? view.hidden.delete(c.id) : view.hidden.add(c.id); draw(); } }, h('i', { class: 'key', style: `background:${catCss(c)}` }), c.name),
          ),
        ),
      );
      section2.appendChild(h('p', { class: 'muted small', style: 'margin-top:8px' }, '某一天没有填写的类别，曲线会在那里断开，不会当作 0 来连线。'));
      const dates = sortAsc(snapshots).filter((s) => cats.some((c) => knownIds(s).includes(c.id)));
      section2.appendChild(
        h('details', { class: 'table-view' }, h('summary', {}, '查看数据表'), buildDataTable({ columns: ['日期', ...cats.map((c) => c.name)], rows: dates.map((s) => [s.date, ...cats.map((c) => (s.entries[c.id] && Number.isInteger(s.entries[c.id].fen) ? formatMoney(s.entries[c.id].fen, unit) : '—'))]) })),
      );
    }
    frag.push(section2);

    root.replaceChildren(...frag);
  };

  draw();
  const off = store.subscribe(draw);
  return { el: root, destroy: off };
}
