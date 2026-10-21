// 分析：资产配置 → 总资产趋势 → 月度变化 → 各账户趋势。首页只放最常看的内容，图表都集中在这里。
import { h } from '../dom.js';
import { button, emptyState, seg } from '../components.js';
import { catCss } from '../fmt.js';
import { buildDataTable, buildLineChart } from '../charts.js';
import { allocation, monthlyBars } from '../insights.js';
import { milestoneSection } from '../milestone.js';
import { reportEntry } from '../report.js';
import { categorySeries, knownIds, latestComplete, latestOverall, sortAsc, totalSeries } from '../../core/ledger.js';
import { addDays, formatDateZh } from '../../core/date.js';
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

const sectionHead = (title, right = null) => h('div', { class: 'sect-head' }, h('h2', { class: 'section-title' }, title), right);

export function buildAnalysis(ctx) {
  const { store, nav } = ctx;
  const root = h('div', {});

  const draw = () => {
    const { snapshots, categories, settings } = store.state;
    const unit = settings.unit;
    const frag = [h('div', { class: 'screen-head' }, h('h1', { class: 'screen-title' }, '分析'), seg([{ value: 'yuan', label: '元' }, { value: 'wan', label: '万元' }], unit, (v) => store.updateSettings({ unit: v }), { label: '显示单位' }))];

    if (!snapshots.length) {
      frag.push(emptyState({ glyph: 'ledger', title: '还没有可分析的记录', text: '记下几次各账户的余额后，这里会显示资产配置、趋势和每月的变化。', actions: [button('记一笔', () => nav.openEntry({}), { iconName: 'plus', block: true })] }));
      root.replaceChildren(...frag);
      return;
    }

    const shown = latestComplete(snapshots) ?? latestOverall(snapshots);

    // 账单报告入口
    const rpe = reportEntry(store);
    if (rpe) frag.push(rpe);

    // 资产配置
    const alloc = allocation(shown, categories);
    if (alloc) frag.push(h('section', { class: 'section first' }, sectionHead('资产配置', h('span', { class: 'muted small' }, formatDateZh(shown.date, { year: false }))), alloc));

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
          hasPartialAny ? h('button', { type: 'button', class: 'chip', 'aria-pressed': String(view.partial), title: '虚线、空心点表示不完整记录的「已记录合计」，它不是总资产', onClick: () => { view.partial = !view.partial; draw(); } }, '含不完整记录') : h('span', { class: 'muted small' }, '手指在图上滑动可查看每个点'),
          h('details', { class: 'table-view' }, h('summary', {}, '数据表'), table),
        ),
      );
    }
    frag.push(section1);

    // 财富里程碑
    const ms = milestoneSection(store);
    if (ms) frag.push(h('section', { class: 'section' }, sectionHead('财富里程碑', ms.querySelector('button.ms-item') ? h('span', { class: 'muted small' }, '点一站可重看纪念卡') : null), ms));

    // 月度变化
    const bars = monthlyBars(snapshots, unit);
    if (bars) frag.push(h('section', { class: 'section' }, sectionHead('月度变化', h('span', { class: 'muted small' }, '点按柱子看详情')), bars));

    // 各账户趋势
    const usedIds = new Set(snapshots.flatMap((s) => knownIds(s)));
    const cats = sortedCategories(categories).filter((c) => usedIds.has(c.id));
    if (cats.length) {
      const section2 = h('section', { class: 'section' }, sectionHead('各账户趋势', h('span', { class: 'muted small' }, '点名字可隐藏')));
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
