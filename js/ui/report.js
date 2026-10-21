// 账单报告：像私人银行的对账单——期末净资产、较期初的变化、各账户的贡献、目标还差多少。
import { h, icon } from './dom.js';
import { button, openSheet, seg } from './components.js';
import { catIcon, compactYuan, deltaSpan } from './fmt.js';
import { buildReport, reportPeriods, shiftPeriod } from '../core/report.js';
import { growthRate } from '../core/ledger.js';
import { reachedMilestones, milestoneName } from '../core/milestones.js';
import { isDebt } from '../core/model.js';
import { formatMoney, formatPercent, formatSigned } from '../core/money.js';
import { addDays, formatDateZh, todayISO } from '../core/date.js';

const periodName = (p) => (p.length === 4 ? `${p} 年` : `${p.slice(0, 4)} 年 ${Number(p.slice(5))} 月`);

/** 上个月（报告按「已结束的月份」生成）。 */
export function lastMonth(today = todayISO()) {
  return shiftPeriod(today.slice(0, 7), -1);
}

/** 上个月有完整记录、还没看过月报时，首页给一行提醒。 */
export function reportNudge(store, open) {
  const { snapshots, meta } = store.state;
  const p = lastMonth();
  if (meta.reportSeen === p || !reportPeriods(snapshots, 'month').includes(p)) return null;
  return h(
    'button',
    { type: 'button', class: 'nudge gold', onClick: () => open({ period: p }) },
    icon('receipt', { size: 18 }),
    h('span', { class: 'grow' }, `${Number(p.slice(5))} 月账单已生成`),
    h('span', { class: 'go' }, '查看'),
    icon('chevronR', { size: 16 }),
  );
}

/** 打开报告。period 不给时：月报默认上个月（没有就最近有记录的月份）。 */
export function openReport(store, { period } = {}) {
  const st = { kind: period?.length === 4 ? 'year' : 'month', period: period ?? null };
  const pick = () => {
    const list = reportPeriods(store.state.snapshots, st.kind);
    if (!st.period || (st.kind === 'year') !== (st.period.length === 4)) {
      const lm = st.kind === 'year' ? String(Number(todayISO().slice(0, 4)) - 1) : lastMonth();
      st.period = list.includes(lm) ? lm : list[0] ?? null;
    }
    return list;
  };
  const body = h('div', { class: 'report' });
  const sheet = openSheet({ title: '账单报告', body });

  const draw = () => {
    const list = pick();
    const { snapshots, categories, settings } = store.state;
    const unit = settings.unit;
    if (st.kind === 'month' && st.period === lastMonth() && store.state.meta.reportSeen !== st.period) store.setMeta('reportSeen', st.period);
    const kindSeg = seg([{ value: 'month', label: '月报' }, { value: 'year', label: '年报' }], st.kind, (v) => {
      st.kind = v;
      st.period = null;
      draw();
    }, { label: '报告类型', block: true });
    const idx = list.indexOf(st.period);
    const nav = h(
      'div',
      { class: 'rp-nav' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': '更早', disabled: idx < 0 || idx >= list.length - 1, onClick: () => { st.period = list[idx + 1]; draw(); } }, icon('chevronL', { size: 20 })),
      h('div', { class: 'rp-period' }, st.period ? periodName(st.period) : '—'),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': '更晚', disabled: idx <= 0, onClick: () => { st.period = list[idx - 1]; draw(); } }, icon('chevronR', { size: 20 })),
    );
    const r = st.period ? buildReport(snapshots, st.period) : null;
    if (!r) {
      body.replaceChildren(kindSeg, nav, h('p', { class: 'muted', style: 'text-align:center;margin:40px 0' }, '这段时间没有完整记录'));
      return;
    }

    const kindName = r.kind === 'year' ? '年报' : '月报';
    // 抬头：黑金小卡
    const head = h(
      'section',
      { class: 'cover rp-cover' },
      h('div', { class: 'cover-head' }, h('div', { class: 'cover-label' }, `${periodName(r.period)} · ${kindName}`)),
      h('div', { class: 'cover-date' }, `截至 ${formatDateZh(r.end.date, { year: false })}`),
      h('div', { class: 'rp-big mask' }, formatMoney(r.end.fen, unit)),
      h('div', { class: 'cover-delta' }, r.delta != null ? deltaSpan(r.delta, r.ratio, unit) : null, h('span', { class: 'cover-note' }, r.start ? `较 ${formatDateZh(r.start.date, { year: r.start.date.slice(0, 4) !== r.end.date.slice(0, 4) })}` : '这是第一条完整记录')),
    );

    // 四格数字
    const perDay = r.delta != null && r.days > 0 ? Math.round(r.delta / r.days) : null;
    const cell = (k, v, sub) => h('div', { class: 'rp-cell' }, h('div', { class: 'k' }, k), h('div', { class: 'v mask' }, v), sub ? h('div', { class: 'd' }, sub) : null);
    const grid = h(
      'div',
      { class: 'rp-grid' },
      cell('记账', `${r.count} 次`),
      cell('日均变化', perDay == null ? '—' : formatSigned(perDay, 'yuan')),
      cell('期内最高', compactYuan(r.high.fen), formatDateZh(r.high.date, { year: false })),
      cell('期内最低', compactYuan(r.low.fen), formatDateZh(r.low.date, { year: false })),
    );

    const parts = [kindSeg, nav, head, grid];

    // 年报：每个月的变化
    if (r.months) {
      const vals = r.months.map((m) => m.delta ?? 0);
      const max = Math.max(1, ...vals.map(Math.abs));
      const best = r.months.filter((m) => m.delta != null).sort((a, b) => b.delta - a.delta);
      parts.push(
        h('h3', { class: 'rp-h' }, '每月变化'),
        h(
          'div',
          { class: 'rp-months' },
          ...r.months.map((m) =>
            h(
              'div',
              { class: ['rp-m', m.delta == null ? 'none' : m.delta >= 0 ? 'up' : 'down'], title: m.delta == null ? '没有记录' : formatSigned(m.delta, unit) },
              h('i', { style: `height:${m.delta == null ? 0 : Math.max(4, (Math.abs(m.delta) / max) * 100).toFixed(1)}%` }),
              h('span', {}, String(Number(m.month.slice(5)))),
            ),
          ),
        ),
        best.length > 1 ? h('p', { class: 'rp-note' }, `最好的月份是 ${Number(best[0].month.slice(5))} 月（`, h('span', { class: 'mask' }, formatSigned(best[0].delta, unit)), `），最差的是 ${Number(best[best.length - 1].month.slice(5))} 月（`, h('span', { class: 'mask' }, formatSigned(best[best.length - 1].delta, unit)), '）') : null,
      );
    }

    // 各账户的贡献
    if (r.movers.length) {
      const byId = new Map(categories.map((c) => [c.id, c]));
      const ups = r.movers.filter((m) => m.fen > 0).slice(0, 3);
      const downs = r.movers.filter((m) => m.fen < 0).slice(-3).reverse();
      const row = (m) => {
        const c = byId.get(m.id);
        if (!c) return null;
        const debt = isDebt(c);
        return h(
          'div',
          { class: 'rp-row' },
          catIcon(c, categories, { size: 30 }),
          h('div', { class: 'grow' }, h('div', { class: 'n' }, c.name), debt ? h('div', { class: 'muted small' }, m.fen > 0 ? '欠款减少' : '欠款增加') : null),
          deltaSpan(m.fen, debt ? null : m.ratio, unit),
        );
      };
      if (ups.length) parts.push(h('h3', { class: 'rp-h' }, '拉动增长'), h('div', { class: 'rp-list' }, ...ups.map(row)));
      if (downs.length) parts.push(h('h3', { class: 'rp-h' }, '拖累'), h('div', { class: 'rp-list' }, ...downs.map(row)));
    }

    // 里程碑与目标
    const ms = reachedMilestones(snapshots).filter((m) => m.days > 0 && m.date.startsWith(r.period));
    const extras = [];
    if (ms.length) extras.push(h('div', { class: 'rp-badge' }, h('span', { class: 'ms-dia' }), `这${r.kind === 'year' ? '一年' : '个月'}跨过了 `, h('b', {}, ms.map((m) => milestoneName(m.fen)).join('、'))));
    if (settings.goalFen) {
      const left = settings.goalFen - r.end.fen;
      if (left <= 0) extras.push(h('div', { class: 'rp-badge' }, h('span', { class: 'ms-dia' }), '财富目标 ', h('b', { class: 'mask' }, compactYuan(settings.goalFen)), ' 已达成'));
      else {
        const rate = growthRate(snapshots);
        const eta = rate ? addDays(r.end.date, Math.ceil(left / (rate.perSec * 86400))) : null;
        extras.push(
          h(
            'div',
            { class: 'rp-badge' },
            h('span', { class: 'ms-dia' }),
            '距离目标 ',
            h('b', { class: 'mask' }, compactYuan(settings.goalFen)),
            ' 还差 ',
            h('span', { class: 'mask' }, compactYuan(left)),
            ` · 已完成 ${formatPercent(r.end.fen / settings.goalFen, { signed: false })}`,
            eta ? h('div', { class: 'muted small' }, `按近期增速，预计 ${eta.slice(0, 4)} 年 ${Number(eta.slice(5, 7))} 月达成`) : null,
          ),
        );
      }
    }
    if (extras.length) parts.push(h('h3', { class: 'rp-h' }, '目标与里程碑'), ...extras);
    parts.push(h('p', { class: 'rp-foot' }, `以${r.kind === 'year' ? '这一年' : '这个月'}最后一条完整记录为期末${!r.start ? '' : r.start.inside ? '，期内第一条为期初（更早没有记录）' : `，上${r.kind === 'year' ? '一年' : '个月'}最后一条为期初`}。`));
    body.replaceChildren(...parts);
    sheet.body.scrollTop = 0;
  };
  draw();
  return sheet;
}

/** 分析页顶部的两个入口。 */
export function reportEntry(store) {
  if (!reportPeriods(store.state.snapshots, 'month').length) return null;
  return h(
    'div',
    { class: 'rp-entry' },
    button('月报', () => openReport(store, {}), { kind: 'secondary', iconName: 'receipt' }),
    button('年报', () => openReport(store, { period: reportPeriods(store.state.snapshots, 'year')[0] }), { kind: 'secondary', iconName: 'calendar' }),
  );
}
