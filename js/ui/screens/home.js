// 首页：封面（最近一次完整快照的总资产）→ 账户明细 → 趋势。
import { h, icon } from '../dom.js';
import { button, emptyState, noteBox, seg } from '../components.js';
import { catCss } from '../fmt.js';
import { buildDataTable, buildLineChart } from '../charts.js';
import { accountRows, coverCard, shareBar } from '../snapshotView.js';
import { categorySeries, compareSnapshots, knownIds, latestComplete, latestOverall, missingIds, previousCompleteOf, recordedTotal, sortAsc, totalSeries } from '../../core/ledger.js';
import { checkSnapshot } from '../../core/anomalies.js';
import { addDays, dayDiff, formatDateZh, relativeDaysZh, todayISO } from '../../core/date.js';
import { formatMoney } from '../../core/money.js';
import { sortedCategories } from '../../core/model.js';

// 图表的选择状态放在模块里：数据刷新、重画页面后保持不变。
const view = { range: 'all', partial: false, hidden: new Set() };

const RANGES = [
  { value: '90', label: '3 月', days: 90 },
  { value: '180', label: '半年', days: 183 },
  { value: '365', label: '1 年', days: 365 },
  { value: 'all', label: '全部', days: null },
];

function inRange(points, latestDate) {
  const r = RANGES.find((x) => x.value === view.range);
  if (!r?.days) return points;
  const from = addDays(latestDate, -r.days);
  return points.filter((p) => p.date >= from);
}

/** 备份提醒：只占一行，点一下去备份；不抢首页的视线。 */
export function backupNote(store, ctx) {
  const { snapshots, meta, settings } = store.state;
  if (!snapshots.length) return null;
  let text = '';
  if (!meta.lastBackupAt) text = '还没有备份过，数据只在这台手机上';
  else {
    const days = dayDiff(meta.lastBackupAt.slice(0, 10), todayISO());
    if (days >= settings.backupRemindDays) text = `已经 ${days} 天没有备份了`;
  }
  if (!text) return null;
  return h('button', { type: 'button', class: 'nudge', onClick: () => ctx.nav.goto('settings', { focus: 'backup' }) }, icon('shield', { size: 18 }), h('span', { class: 'grow' }, text), h('span', { class: 'go' }, '去备份'), icon('chevronR', { size: 16 }));
}

const sectionHead = (title, right = null) => h('div', { class: 'sect-head' }, h('h2', { class: 'section-title' }, title), right);

export function buildHome(ctx) {
  const { store, nav } = ctx;
  const root = h('div', {});

  const draw = () => {
    const { snapshots, categories, settings } = store.state;
    const unit = settings.unit;
    const frag = [];

    // 顶栏
    frag.push(h('div', { class: 'screen-head' }, h('h1', { class: 'screen-title' }, '资产账本'), seg([{ value: 'yuan', label: '元' }, { value: 'wan', label: '万元' }], unit, (v) => store.updateSettings({ unit: v }), { label: '显示单位' })));

    if (snapshots.length === 0) {
      frag.push(
        emptyState({
          glyph: 'ledger',
          title: '还没有记录',
          text: '记下某一天各个账户的余额，App 会帮你算出总资产、画出变化。也可以把以前手写的记录导入进来。',
          actions: [button('记下今天的余额', () => nav.openEntry({}), { iconName: 'plus', block: true }), button('导入以前的记录', () => nav.goto('import'), { kind: 'secondary', iconName: 'download', block: true })],
        }),
      );
      root.replaceChildren(...frag);
      return;
    }

    const comp = latestComplete(snapshots);
    const newest = latestOverall(snapshots);
    const shown = comp ?? newest;
    const thisYear = todayISO().slice(0, 4);

    // 最新一条不是完整记录：明确告知，不让部分合计冒充总资产
    if (newest && !newest.complete) {
      const miss = missingIds(newest).map((id) => categories.find((c) => c.id === id)?.name ?? id);
      frag.push(
        h(
          'div',
          { class: 'notes', style: 'margin-bottom:14px' },
          noteBox(
            'warn',
            [h('b', {}, `${formatDateZh(newest.date, { year: false })}的记录不完整`), h('div', { class: 'small' }, `缺 ${miss.join('、') || '部分账户'}，所以不计入总资产。${comp ? `下面是 ${formatDateZh(comp.date, { year: false })} 的完整记录。` : ''}`)],
            [button('补全这一条', () => nav.openEntry({ id: newest.id }), { sm: true, kind: 'secondary' })],
          ),
        ),
      );
    }

    // 封面
    const prevComp = comp ? previousCompleteOf(snapshots, comp) : null;
    const cmp = comp && prevComp ? compareSnapshots(comp, prevComp) : null;
    const dateText = `${formatDateZh(shown.date, { year: shown.date.slice(0, 4) !== thisYear, weekday: true })} · ${relativeDaysZh(shown.date)}`;
    if (comp) {
      frag.push(
        coverCard({
          label: '总资产',
          dateText,
          fen: recordedTotal(comp),
          complete: true,
          unit,
          change: cmp?.total ?? null,
          changeNote: cmp?.total ? `较 ${formatDateZh(prevComp.date, { year: prevComp.date.slice(0, 4) !== comp.date.slice(0, 4) })}` : '这是第一条完整记录',
          note: cmp?.total?.basisChanged ? h('span', { class: 'tag' }, '账户口径不同，仅供参考') : null,
          bar: shareBar(comp, categories),
          ariaLabel: '最近一次完整资产快照',
        }),
      );
    } else {
      frag.push(coverCard({ label: '暂时算不出总资产', dateText, fen: null, complete: false, unit, changeNote: '还没有一条完整的记录。补全各账户的金额后，这里才会显示总资产。' }));
    }

    // 异常提示（不改任何数据）
    const issues = checkSnapshot(shown, { categories, snaps: snapshots, unit, thresholdPct: settings.changeThresholdPct }).filter((i) => i.code !== 'INCOMPLETE');
    if (issues.length) {
      frag.push(h('div', { class: 'notes', style: 'margin-top:12px' }, noteBox('warn', [h('b', {}, '请检查一下'), ...issues.map((i) => h('div', { class: 'small' }, i.text))], [button('查看并修改', () => nav.openDetail(shown.id), { sm: true, kind: 'secondary' })])));
    }
    const bn = backupNote(store, ctx);
    if (bn) frag.push(bn);

    // 账户
    frag.push(h('section', { class: 'section' }, sectionHead('账户', h('span', { class: 'muted small' }, shown.complete ? '' : '不完整，仅已记录部分')), accountRows({ snap: shown, categories, unit, cmp, group: true })));

    // 总资产趋势
    const complete = totalSeries(snapshots);
    const section1 = h('section', { class: 'section' });
    if (complete.length === 0) {
      section1.appendChild(sectionHead('总资产趋势'));
      section1.appendChild(h('p', { class: 'muted small' }, '有完整记录后才会画出趋势。'));
    } else {
      const latestDate = complete[complete.length - 1].date;
      const partialPts = view.partial ? totalSeries(snapshots, { includePartial: true }).filter((p) => !p.complete) : [];
      const completeIn = inRange(complete, latestDate);
      const partialIn = inRange(partialPts, latestDate);
      section1.appendChild(
        sectionHead(
          '总资产趋势',
          seg(RANGES.map((r) => ({ value: r.value, label: r.label })), view.range, (v) => {
            view.range = v;
            draw();
          }, { label: '时间范围', variant: 'lite' }),
        ),
      );
      const series = [{ id: 'total', name: '总资产', color: 'var(--brand-line)', points: completeIn, breakGaps: false }];
      if (partialIn.length) series.push({ id: 'partial', name: '已记录合计（不完整）', color: 'var(--amber)', points: partialIn, dashed: true });
      const allDates = sortAsc(snapshots).map((s) => s.date).filter((d) => completeIn.some((p) => p.date === d) || partialIn.some((p) => p.date === d));
      const chart = buildLineChart({ series, allDates, unit, height: 200, area: true, endLabel: true, ariaLabel: `总资产趋势图，共 ${completeIn.length} 个完整记录点。点击或用左右方向键查看每个点。` });
      section1.appendChild(h('div', { class: 'plate' }, chart.el));
      if (completeIn.length < 2) section1.appendChild(h('p', { class: 'muted small', style: 'margin-top:6px' }, '再记录一条完整快照，就能看到变化曲线。'));
      const hasPartialAny = snapshots.some((s) => !s.complete && knownIds(s).length);
      const table = buildDataTable({
        columns: ['日期', '金额', '状态'],
        rows: [...completeIn.map((p) => [p.date, formatMoney(p.fen, unit), '完整']), ...partialIn.map((p) => [p.date, formatMoney(p.fen, unit), '不完整'])].sort((a, b) => (a[0] < b[0] ? -1 : 1)),
      });
      section1.appendChild(
        h(
          'div',
          { class: 'chart-tools' },
          hasPartialAny ? h('button', { type: 'button', class: 'chip', 'aria-pressed': String(view.partial), title: '虚线、空心点表示不完整记录的「已记录合计」，它不是总资产', onClick: () => { view.partial = !view.partial; draw(); } }, '含不完整记录') : h('span', {}),
          h('details', { class: 'table-view' }, h('summary', {}, '数据表'), table),
        ),
      );
    }
    frag.push(section1);

    // 各账户趋势
    const usedIds = new Set(snapshots.flatMap((s) => knownIds(s)));
    const cats = sortedCategories(categories).filter((c) => usedIds.has(c.id));
    if (cats.length) {
      const section2 = h('section', { class: 'section' }, sectionHead('各账户趋势'));
      const visible = cats.filter((c) => !view.hidden.has(c.id));
      const latestDate = latestOverall(snapshots).date;
      const series = visible.map((c) => ({ id: c.id, name: c.name, color: catCss(c), points: inRange(categorySeries(snapshots, c.id), latestDate) }));
      section2.appendChild(
        h(
          'div',
          { class: 'legend' },
          ...cats.map((c) =>
            h('button', { type: 'button', class: ['chip', view.hidden.has(c.id) && 'off'], 'aria-pressed': String(!view.hidden.has(c.id)), onClick: () => { view.hidden.has(c.id) ? view.hidden.delete(c.id) : view.hidden.add(c.id); draw(); } }, h('i', { class: 'key', style: `background:${catCss(c)}` }), c.name),
          ),
        ),
      );
      const chart = buildLineChart({ series, allDates: sortAsc(snapshots).map((s) => s.date), unit, height: 200, zeroBase: true, ariaLabel: '各账户金额变化趋势图。某天没有记录的账户会断开，不会当作 0。' });
      section2.appendChild(h('div', { class: 'plate' }, chart.el));
      const dates = sortAsc(snapshots).filter((s) => cats.some((c) => knownIds(s).includes(c.id)));
      section2.appendChild(
        h(
          'div',
          { class: 'chart-tools' },
          h('span', { class: 'muted small' }, '没记录的日子曲线会断开，不当作 0'),
          h('details', { class: 'table-view' }, h('summary', {}, '数据表'), buildDataTable({ columns: ['日期', ...cats.map((c) => c.name)], rows: dates.map((s) => [s.date, ...cats.map((c) => (s.entries[c.id] && Number.isInteger(s.entries[c.id].fen) ? formatMoney(s.entries[c.id].fen, unit) : '—'))]) })),
        ),
      );
      frag.push(section2);
    }

    root.replaceChildren(...frag);
  };

  draw();
  const off = store.subscribe(draw);
  return { el: root, destroy: off };
}
