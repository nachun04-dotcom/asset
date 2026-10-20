// 首页：封面（最近一次完整快照的总资产）→ 阶段变化 → 更新余额 → 账户明细。图表都在「分析」页。
import { h, icon } from '../dom.js';
import { button, emptyState, noteBox, seg } from '../components.js';
import { accountRows, coverCard } from '../snapshotView.js';
import { goalBlock, kpiRow } from '../insights.js';
import { compareSnapshots, findByDate, latestComplete, latestOverall, missingIds, previousCompleteOf, recordedTotal } from '../../core/ledger.js';
import { checkSnapshot } from '../../core/anomalies.js';
import { dayDiff, formatDateZh, relativeDaysZh, todayISO } from '../../core/date.js';

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
    const hidden = !!settings.hideAmounts;
    const eye = h('button', { type: 'button', class: ['icon-btn', 'eye', hidden && 'on'], 'aria-pressed': String(hidden), 'aria-label': hidden ? '显示金额' : '隐藏金额', title: hidden ? '显示金额' : '隐藏金额', onClick: () => store.updateSettings({ hideAmounts: !hidden }) }, icon(hidden ? 'eyeOff' : 'eye', { size: 20 }));
    frag.push(h('div', { class: 'screen-head' }, h('h1', { class: 'screen-title' }, '资产账本'), h('div', { class: 'head-tools' }, snapshots.length ? eye : null, seg([{ value: 'yuan', label: '元' }, { value: 'wan', label: '万元' }], unit, (v) => store.updateSettings({ unit: v }), { label: '显示单位' }))));

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
      const cover = coverCard({
          label: '总资产',
          dateText,
          fen: recordedTotal(comp),
          complete: true,
          unit,
          change: cmp?.total ?? null,
          changeNote: cmp?.total ? `较 ${formatDateZh(prevComp.date, { year: prevComp.date.slice(0, 4) !== comp.date.slice(0, 4) })}` : '这是第一条完整记录',
          note: cmp?.total?.basisChanged ? h('span', { class: 'tag' }, '账户口径不同，仅供参考') : null,
          bar: goalBlock(store, recordedTotal(comp)),
          ariaLabel: '最近一次完整资产快照',
        });
      // 点封面空白处查看这条记录的明细（目标进度有自己的点按操作）
      cover.classList.add('tappable');
      cover.addEventListener('click', (e) => {
        if (!e.target.closest('button')) nav.openDetail(comp.id);
      });
      frag.push(cover);
    } else {
      frag.push(coverCard({ label: '暂时算不出总资产', dateText, fen: null, complete: false, unit, changeNote: '还没有一条完整的记录。补全各账户的金额后，这里才会显示总资产。' }));
    }

    // 阶段变化：较上月末 / 今年 / 历史最高
    const kpis = kpiRow(snapshots);
    if (kpis) frag.push(kpis);

    // 最常用的操作：更新今天的余额（今天已记过则改为修改）
    const today = todayISO();
    const todays = findByDate(snapshots, today);
    const lastDays = dayDiff(newest.date, today);
    frag.push(
      h(
        'button',
        { type: 'button', class: 'cta', onClick: () => nav.openEntry(todays ? { id: todays.id } : {}) },
        h('span', { class: 'cta-ico' }, icon(todays ? 'edit' : 'plus', { size: 20, stroke: 2 })),
        h('span', { class: 'grow' }, h('span', { class: 'ct' }, todays ? '修改今天的记录' : '更新今天的余额'), h('span', { class: 'cs' }, todays ? '今天已经记录过，可以随时修改' : lastDays > 0 ? `上次记录在 ${relativeDaysZh(newest.date)}，约 1 分钟填完` : '记下各账户现在的余额')),
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

    // 账户
    frag.push(h('section', { class: 'section' }, sectionHead('账户', h('span', { class: 'muted small' }, shown.complete ? `${formatDateZh(shown.date, { year: false })} 的余额` : '不完整，仅已记录部分')), accountRows({ snap: shown, categories, unit, cmp, group: true })));

    // 去分析页的入口
    frag.push(h('button', { type: 'button', class: 'go-card', onClick: () => nav.goto('analysis') }, h('span', { class: 'ico' }, icon('pie', { size: 20 })), h('span', { class: 'grow' }, h('span', { class: 'gt' }, '查看分析'), h('span', { class: 'gs' }, '资产配置 · 趋势 · 每月变化')), icon('chevronR', { size: 18 })));

    root.replaceChildren(...frag);
  };

  draw();
  const off = store.subscribe(draw);
  return { el: root, destroy: off };
}
