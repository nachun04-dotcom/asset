// 首页：封面（最近一次完整快照的总资产）→ 阶段变化 → 更新余额 → 账户明细。图表都在「分析」页。
import { h, icon, s } from '../dom.js';
import { button, emptyState, noteBox, openSheet, seg, toast } from '../components.js';
import { accountRows, coverCard } from '../snapshotView.js';
import { animateHero, catCss, compactYuan, fitHero, splashDelay } from '../fmt.js';
import { LIVE_STYLES, liveHero, liveStyleOf } from '../liveNumber.js';
import { openReport, reportNudge } from '../report.js';
import { nextMilestone, milestoneName } from '../../core/milestones.js';
import { goalLine, periodStats } from '../insights.js';
import { card3d } from '../card3d.js';
import { spendChip } from '../spend.js';
import { spendCat, summarize } from '../../core/spending.js';
import { compareSnapshots, findByDate, growthRate, latestComplete, latestOverall, missingIds, previousCompleteOf, recordedTotal, shares } from '../../core/ledger.js';
import { checkSnapshot } from '../../core/anomalies.js';
import { isDebt, splitTotals } from '../../core/model.js';
import { formatMoney, formatPercent, formatSigned } from '../../core/money.js';
import { dayDiff, formatDateZh, relativeDaysZh, todayISO } from '../../core/date.js';

/** 备份提醒：只占一行，点一下去备份；不抢首页的视线。 */
export function backupNote(store, ctx) {
  const { snapshots, meta, settings } = store.state;
  if (!snapshots.length) return null;
  let text = '';
  if (!meta.lastBackupAt) text = '还没有备份过';
  else {
    const days = dayDiff(meta.lastBackupAt.slice(0, 10), todayISO());
    if (days >= settings.backupRemindDays) text = `已经 ${days} 天没有备份了`;
  }
  if (!text) return null;
  return h('button', { type: 'button', class: 'nudge', onClick: () => ctx.nav.goto('settings', { focus: 'backup' }) }, icon('shield', { size: 18 }), h('span', { class: 'grow' }, text), h('span', { class: 'go' }, '去备份'), icon('chevronR', { size: 16 }));
}

/**
 * 卡片背面的几页：变化、构成、开销。居中一个小标题，内容只放要紧的几个数；左右滑动切换。
 */
function backPages(store, comp, sp, settings, nav) {
  const { snapshots, categories, expenses } = store.state;
  const face = (title, ...body) => h('div', { class: 'bk-pg', 'aria-label': title }, h('div', { class: 'cover-label' }, title), h('div', { class: 'fc-body' }, ...body));
  const out = [];

  // 变化：较上月末 / 今年以来 / 历史最高
  const st = periodStats(snapshots);
  if (st) {
    const dir = (fen) => (fen > 0 ? 'up' : fen < 0 ? 'down' : 'flat');
    const signed = (fen) => `${fen < 0 ? '−' : fen > 0 ? '+' : ''}${compactYuan(Math.abs(fen))}`;
    const row = (k, v, d, cls = '') => h('div', { class: 'fc-row' }, h('span', { class: 'k' }, k), h('span', { class: ['v', 'mask', cls] }, v), h('span', { class: 'd' }, d));
    const first = [...snapshots].sort((a, b) => (a.date < b.date ? -1 : 1))[0];
    const days = first ? dayDiff(first.date, todayISO()) + 1 : 0;
    out.push(
      face(
        '变 化',
        row('较上月末', st.month ? signed(st.month.delta) : '—', st.month ? formatPercent(st.month.ratio) : '上月无记录', st.month ? `chg ${dir(st.month.delta)}` : ''),
        row(st.yLabel, st.year ? signed(st.year.delta) : '—', st.year ? formatPercent(st.year.ratio) : '暂无比较', st.year ? `chg ${dir(st.year.delta)}` : ''),
        row('历史最高', compactYuan(st.peak.fen), st.isPeak ? '当前即新高' : `回撤 ${formatPercent(st.drawdown)}`),
        h('div', { class: 'fc-foot' }, sp.hasDebt ? h('span', {}, '资产 ', h('b', { class: 'mask' }, compactYuan(sp.assets)), ' · 负债 ', h('b', { class: 'mask' }, compactYuan(sp.debts))) : h('span', {}, `记账第 ${days} 天`), h('button', { type: 'button', class: 'fc-link', onClick: () => nav.openDetail(comp.id) }, '这条记录', icon('chevronR', { size: 12, stroke: 2 }))),
      ),
    );
  }

  // 构成：资产占比小环 + 目标（没设目标就看下一个里程碑）
  const byId = new Map(categories.map((c) => [c.id, c]));
  const parts = shares(comp).map((x) => ({ ...x, cat: byId.get(x.id) })).filter((x) => x.cat && !isDebt(x.cat)).sort((a, b) => b.share - a.share);
  if (parts.length) {
    const top = parts.slice(0, 4);
    const rest = parts.slice(4).reduce((n, x) => n + x.share, 0);
    const R0 = 30;
    const C = 2 * Math.PI * R0;
    let off = 0;
    const segs = [...top.map((x) => ({ share: x.share, color: catCss(x.cat) })), ...(rest > 0 ? [{ share: rest, color: 'var(--ivory-3)' }] : [])].map((x) => {
      const len = Math.max(0, x.share * C - 1.5);
      const el = s('circle', { cx: 40, cy: 40, r: R0, fill: 'none', stroke: x.color, 'stroke-width': 7, 'stroke-dasharray': `${len} ${C - len}`, 'stroke-dashoffset': -off, transform: 'rotate(-90 40 40)' });
      off += x.share * C;
      return el;
    });
    const ring = s('svg', { viewBox: '0 0 80 80', class: 'bk-ring', 'aria-hidden': 'true' }, ...segs);
    const legend = h('div', { class: 'bk-legend' }, ...top.map((x) => h('div', {}, h('i', { style: `background:${catCss(x.cat)}` }), h('span', {}, x.cat.name), h('b', {}, `${(x.share * 100).toFixed(0)}%`))), rest > 0 ? h('div', {}, h('i', { style: 'background:var(--ivory-3)' }), h('span', {}, '其他'), h('b', {}, `${(rest * 100).toFixed(0)}%`)) : null);
    const total = recordedTotal(comp);
    let target = null;
    if (settings.goalFen) target = { name: `目标 ${compactYuan(settings.goalFen)}`, p: total / settings.goalFen };
    else {
      const nx = nextMilestone(snapshots);
      if (nx) target = { name: `下一站 ${milestoneName(nx.fen)}`, p: nx.progress };
    }
    out.push(
      face(
        '构 成',
        h('div', { class: 'bk-alloc' }, ring, legend),
        target ? h('div', { class: 'bk-goal' }, h('div', { class: 'bk-goal-row' }, h('span', {}, target.name), h('b', {}, target.p >= 1 ? '已达成' : `${Math.min(99.9, target.p * 100).toFixed(1)}%`)), h('div', { class: 'goal-track' }, h('i', { style: `width:${Math.max(2, Math.min(100, target.p * 100)).toFixed(1)}%` }))) : null,
      ),
    );
  }

  // 开销：本月花了多少、今天、花得最多的三类（记过开销才有这一张）
  if (expenses.length) {
    const today = todayISO();
    const m = summarize(expenses, `${today.slice(0, 7)}-01`, today);
    const td = summarize(expenses, today, today).total;
    out.push(
      face(
        '开 销',
        h('div', { class: 'fc-big mask' }, formatMoney(m.total, 'yuan')),
        h('div', { class: 'fc-sub' }, `本月 ${m.count} 笔 · 今天 `, h('b', { class: 'mask' }, formatMoney(td, 'yuan'))),
        h('div', { class: 'fc-cats' }, ...m.cats.slice(0, 3).map((c) => h('span', {}, spendChip(c.key, 22), spendCat(c.key).name, h('b', { class: 'mask' }, compactYuan(c.fen))))),
        h('button', { type: 'button', class: 'fc-link center', onClick: () => nav.goto('spend') }, '查看开销', icon('chevronR', { size: 12, stroke: 2 })),
      ),
    );
  }
  return out;
}

/** 实时估算的小面板：选风格，或者关掉。 */
function liveSheet(store, rate) {
  const cur = liveStyleOf(store.state.settings);
  const pick = (v) => {
    sheet.close();
    if (v !== cur) store.updateSettings({ liveStyle: v });
  };
  const opts = LIVE_STYLES.map((o) =>
    h(
      'button',
      { type: 'button', class: ['live-opt', o.value === cur && 'on'], 'aria-pressed': String(o.value === cur), onClick: () => pick(o.value) },
      h('span', { class: `live-demo ${o.value}`, 'aria-hidden': 'true' }, ...(o.value === 'glow' ? ['8', '8', h('small', {}, '.88')] : ['8', '8', '8'].map((d) => h('i', {}, d)))),
      h('span', { class: 'grow' }, h('b', {}, o.label), h('span', {}, o.desc)),
      o.value === cur ? icon('check', { size: 18, stroke: 2.2 }) : null,
    ),
  );
  const basis = rate.days >= 365 ? '近一年' : `近 ${rate.days} 天`;
  const sheet = openSheet({
    title: '实时估算',
    auto: true,
    body: h('div', { class: 'live-sheet' }, h('p', { class: 'muted small' }, `按${basis}的平均增速，从上次记录起每秒往上加。只是展示，不改任何记录。`), h('div', { class: 'live-opts' }, ...opts)),
    footer: button('关闭实时估算', async () => {
      await sheet.close();
      await store.updateSettings({ liveGrowth: false });
      toast('已关闭，可在「设置 → 实时增长」重新打开');
    }, { kind: 'secondary', block: true }),
  });
}

/** 记录的时刻：当天新建的用创建时间，补记的旧日期按当天中午算。 */
function recordTime(snap) {
  const c = snap.createdAt ? new Date(snap.createdAt) : null;
  if (c && !Number.isNaN(c.getTime()) && todayISO(c) === snap.date) return c.getTime();
  const [y, m, d] = snap.date.split('-').map(Number);
  return new Date(y, m - 1, d, 12).getTime();
}

const sectionHead = (title, right = null) => h('div', { class: 'sect-head' }, h('h2', { class: 'section-title' }, title), right);

export function buildHome(ctx) {
  const { store, nav } = ctx;
  const root = h('div', {});
  let welcomed = false; // 每次进入首页，总额只播一次欢迎动画；之后数据刷新直接显示
  let flipped = false; // 卡片翻在哪一面、背面停在第几页（数据刷新重画后保持）
  let page = 0;
  let deck = null;

  const draw = () => {
    const { snapshots, categories, settings } = store.state;
    const unit = settings.unit;
    const frag = [];

    // 顶栏
    const hidden = !!settings.hideAmounts;
    const eye = h('button', { type: 'button', class: ['icon-btn', 'eye', hidden && 'on'], 'aria-pressed': String(hidden), 'aria-label': hidden ? '显示金额' : '隐藏金额', title: hidden ? '显示金额' : '隐藏金额', onClick: () => store.updateSettings({ hideAmounts: !hidden }) }, icon(hidden ? 'eyeOff' : 'eye', { size: 20 }));
    frag.push(h('div', { class: 'screen-head' }, h('h1', { class: 'screen-title' }, '资产账本'), h('div', { class: 'head-tools' }, snapshots.length ? eye : null, seg([{ value: 'yuan', label: '元' }, { value: 'wan', label: '万元' }], unit, (v) => store.updateSettings({ unit: v }), { label: '显示单位' }))));

    if (snapshots.length === 0) {
      frag.push(
        emptyState({
          glyph: 'ledger',
          title: '还没有记录',
          text: '记下各账户的余额，自动算出总资产和变化。',
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
            [h('b', {}, `${formatDateZh(newest.date, { year: false })}未填完`), h('div', { class: 'small' }, `缺 ${miss.join('、') || '部分账户'}，暂不计入总资产`)],
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
      const sp = splitTotals(comp, categories);
      // 封面只放最关键的：净资产这一个数。涨跌在下面三格里，资产 / 负债在账户列表里，不再重复
      const cover = coverCard({
          minimal: true,
          label: sp.hasDebt ? '净资产' : '总资产',
          dateText: `记于 ${formatDateZh(comp.date, { year: comp.date.slice(0, 4) !== thisYear })}`,
          fen: recordedTotal(comp),
          unit,
          bar: goalLine(store, recordedTotal(comp)),
          ariaLabel: '最近一次完整资产快照',
        });
      // 立体卡片：轻点翻面；背面左右滑动看变化、构成、开销
      const card = card3d({
        front: cover,
        pages: backPages(store, comp, sp, settings, nav),
        flipped,
        page,
        onFlip: (on) => {
          flipped = on;
        },
        onPage: (i) => {
          page = i;
        },
      });
      frag.push(card.el);
      deck = card;
      // 实时增长：按近一年的平均增速，从这条记录起每秒往上加（估算，不改任何数据）
      const hero = cover.querySelector('.hero');
      const fen0 = recordedTotal(comp);
      const rate = settings.liveGrowth !== false && !settings.hideAmounts && fen0 > 0 ? growthRate(snapshots) : null;
      const welcome = !welcomed && !settings.hideAmounts;
      if (!welcomed) {
        welcomed = true;
        if (!splashDelay()) card.el.classList.add('welcome'); // 从开屏飞过来时，卡片已经在位，不再上浮
      }
      if (rate) {
        liveHero(hero, { fen0, t0: recordTime(comp), perSec: rate.perSec, unit, style: liveStyleOf(settings), welcome });
        const per = rate.perSec >= 1 ? ['每秒', rate.perSec] : ['每天', rate.perSec * 86400];
        cover.querySelector('.cover-meta').prepend(
          h(
            'button',
            { type: 'button', class: 'cover-live', 'aria-label': `实时估算，${per[0]}约 ${formatSigned(Math.max(1, Math.round(per[1])), 'yuan')}。点按可换风格或关闭`, onClick: () => liveSheet(store, rate) },
            h('i', { class: 'pulse', 'aria-hidden': 'true' }),
            h('b', { class: 'mask' }, formatSigned(Math.max(1, Math.round(per[1])), 'yuan')),
            ` / ${per[0] === '每秒' ? '秒' : '天'}`,
          ),
          h('i', { class: 'meta-dot', 'aria-hidden': 'true' }),
        );
      } else if (welcome) animateHero(hero, fen0, unit);
    } else {
      frag.push(coverCard({ label: '暂时算不出总资产', dateText, fen: null, complete: false, unit, changeNote: '补全各账户金额后显示总资产' }));
    }

    // 最常用的操作：更新今天的余额（今天已记过则改为修改）
    const today = todayISO();
    const todays = findByDate(snapshots, today);
    const lastDays = dayDiff(newest.date, today);
    frag.push(
      h(
        'button',
        { type: 'button', class: 'cta', onClick: () => nav.openEntry(todays ? { id: todays.id } : {}) },
        h('span', { class: 'cta-ico' }, icon(todays ? 'edit' : 'plus', { size: 20, stroke: 2 })),
        h('span', { class: 'grow' }, h('span', { class: 'ct' }, todays ? '修改今天的记录' : '更新今天的余额'), h('span', { class: 'cs' }, todays ? '今天已记录' : lastDays > 0 ? `上次 ${relativeDaysZh(newest.date)}` : '记下各账户的余额')),
        icon('chevronR', { size: 18 }),
      ),
    );

    // 异常提示（不改任何数据）
    const issues = checkSnapshot(shown, { categories, snaps: snapshots, unit, thresholdPct: settings.changeThresholdPct }).filter((i) => i.code !== 'INCOMPLETE');
    if (issues.length) {
      frag.push(h('div', { class: 'notes', style: 'margin-top:12px' }, noteBox('warn', [h('b', {}, '请检查一下'), ...issues.map((i) => h('div', { class: 'small' }, i.text))], [button('查看并修改', () => nav.openDetail(shown.id), { sm: true, kind: 'secondary' })])));
    }
    const bn = backupNote(store, ctx);
    if (bn) frag.push(bn);
    // 日常开销：今天和本月各花了多少，点进开销页
    if (store.state.expenses.length) {
      const ym = today.slice(0, 7);
      let td = 0;
      let mo = 0;
      for (const e of store.state.expenses) {
        if (e.date === today) td += e.fen;
        if (e.date.startsWith(ym)) mo += e.fen;
      }
      frag.push(
        h(
          'button',
          { type: 'button', class: 'nudge spend-line', onClick: () => nav.goto('spend') },
          icon('receipt', { size: 18 }),
          h('span', { class: 'grow' }, '今天 ', h('b', { class: 'mask' }, formatMoney(td, 'yuan')), h('i', { 'aria-hidden': 'true' }), '本月 ', h('b', { class: 'mask' }, formatMoney(mo, 'yuan'))),
          icon('chevronR', { size: 16 }),
        ),
      );
    }
    const rn = reportNudge(store, (o) => openReport(store, o));
    if (rn) frag.push(rn);

    // 账户
    // 有负债账户时分成「资产」「负债」两组，负债组标题旁写合计欠款
    const when = shown.complete ? `${formatDateZh(shown.date, { year: false })} 的余额` : '不完整，仅已记录部分';
    const hasDebtRows = categories.some((c) => c.enabled && isDebt(c) && (shown.entries[c.id] || (shown.expectedIds ?? []).includes(c.id)));
    // 已停用的账户在首页不列出；如果它在这条记录里有金额，就在列表下面用一行小字说明，合计才对得上
    const hiddenOff = categories.filter((c) => !c.enabled && shown.entries[c.id] && Number.isInteger(shown.entries[c.id].fen));
    const offNote = hiddenOff.length
      ? h('p', { class: 'acc-foot' }, `另有 ${hiddenOff.length} 个已停用账户（${hiddenOff.map((c) => c.name).join('、')}）共 `, h('span', { class: 'mask' }, formatMoney(hiddenOff.reduce((n, c) => n + shown.entries[c.id].fen, 0), unit)), ' 计入合计')
      : null;
    if (!hasDebtRows) {
      frag.push(h('section', { class: 'section' }, sectionHead('账户', h('span', { class: 'muted small' }, when)), accountRows({ snap: shown, categories, unit, cmp, group: true, only: (c) => c.enabled }), offNote));
    } else {
      const sp = splitTotals(shown, categories);
      frag.push(h('section', { class: 'section' }, sectionHead('资产', h('span', { class: 'muted small' }, when)), accountRows({ snap: shown, categories, unit, cmp, group: true, only: (c) => c.enabled && !isDebt(c) })));
      frag.push(h('section', { class: 'section' }, sectionHead('负债', h('span', { class: 'muted small' }, '合计欠 ', h('span', { class: 'mask' }, formatMoney(sp.debts, unit)))), accountRows({ snap: shown, categories, unit, cmp, group: true, only: (c) => c.enabled && isDebt(c) }), offNote));
    }

    root.replaceChildren(...frag);
    // 挂到页面之后、画出来之前，按实际宽度把大数字缩到刚好一行
    queueMicrotask(() => {
      root.querySelectorAll('.cover .hero').forEach(fitHero);
      if (page) deck?.setPage(page);
    });
  };

  draw();
  const off = store.subscribe(draw);
  const refit = () => root.querySelectorAll('.cover .hero').forEach(fitHero);
  window.addEventListener('resize', refit);
  return {
    el: root,
    destroy: () => {
      off();
      window.removeEventListener('resize', refit);
    },
  };
}
