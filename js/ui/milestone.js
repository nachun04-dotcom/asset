// 财富里程碑：跨过整数关口时弹出一张烫金纪念卡，可以存成图片；分析页列出走过的每一站。
import { h, icon } from './dom.js';
import { button, toast } from './components.js';
import { fx } from './feedback.js';
import { compactYuan, glint } from './fmt.js';
import { TIERS, milestoneName, nextMilestone, reachedMilestones } from '../core/milestones.js';
import { formatMoney } from '../core/money.js';
import { formatDateZh } from '../core/date.js';
import { saveFile } from '../platform.js';
import { guilloche } from './snapshotView.js';

const dateLong = (iso) => formatDateZh(iso, { year: true });

/** 卡片上的几行字（屏幕上的卡和存下来的图片共用）。 */
function cardText(m, holder) {
  return {
    kicker: 'MILESTONE',
    title: '净资产突破',
    big: milestoneName(m.fen),
    total: `达成时 ${formatMoney(m.total, 'yuan')}`,
    date: dateLong(m.date),
    days: m.days > 0 ? `自第一笔记录起 · 第 ${m.days} 天` : '第一笔记录即已达成',
    holder: holder || '',
  };
}

/* ------------------------------ 纪念卡 ------------------------------ */

let open = null;

/** 弹出纪念卡。replay：从列表里重看时不放庆祝音效。 */
export function celebrate(m, { holder = '', replay = false } = {}) {
  open?.close();
  const t = cardText(m, holder);
  const sparks = Array.from({ length: 14 }, (_, i) => h('i', { class: 'spark', style: `--x:${(i * 37) % 100}%;--y:${(i * 61) % 100}%;--d:${(i % 7) * 0.32}s;--s:${0.6 + ((i * 13) % 10) / 12}` }));
  const card = h(
    'div',
    { class: 'ms-card' },
    guilloche(),
    h('div', { class: 'ms-kicker' }, h('i', { 'aria-hidden': 'true' }), t.kicker, h('i', { 'aria-hidden': 'true' })),
    h('div', { class: 'ms-title' }, t.title),
    // 正好跨进新的卡片等级：多一行「卡片升级」
    TIERS.find((x) => x.min === m.fen && x.min > 0) ? h('div', { class: 'ms-tier' }, `卡片升级 · ${TIERS.find((x) => x.min === m.fen).name}`) : null,
    h('div', { class: 'ms-big' }, t.big),
    h('div', { class: 'ms-rule', 'aria-hidden': 'true' }),
    h('div', { class: 'ms-total' }, t.total),
    h('div', { class: 'ms-date' }, t.date),
    h('div', { class: 'ms-days' }, t.days),
    h('div', { class: 'ms-foot' }, h('span', {}, '资产账本 · PRIVATE LEDGER'), t.holder ? h('b', {}, t.holder) : null),
  );
  const close = () => {
    if (!el.isConnected) return;
    el.classList.add('out');
    setTimeout(() => el.remove(), 260);
    document.removeEventListener('keydown', onKey);
    open = null;
  };
  const onKey = (e) => e.key === 'Escape' && close();
  const el = h(
    'div',
    { class: 'ms-layer', role: 'dialog', 'aria-modal': 'true', 'aria-label': `里程碑：净资产突破 ${t.big}` },
    h('div', { class: 'ms-scrim', onClick: close }),
    h('div', { class: 'ms-stage' }, h('div', { class: 'ms-sparks', 'aria-hidden': 'true' }, ...sparks), card),
    h(
      'div',
      { class: 'ms-actions' },
      button('存为图片', () => saveCardImage(m, holder), { kind: 'secondary', iconName: 'download' }),
      button(replay ? '关闭' : '收下', close),
    ),
  );
  document.addEventListener('keydown', onKey);
  document.body.appendChild(el);
  open = { close };
  setTimeout(() => card.isConnected && glint(card, { inset: 12, radius: 17, dur: 2400 }), 700);
  if (!replay) setTimeout(() => fx.success(), 380);
}

/* ------------------------------ 存成图片 ------------------------------ */

function roundRect(g, x, y, w, r, hgt) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + hgt, r);
  g.arcTo(x + w, y + hgt, x, y + hgt, r);
  g.arcTo(x, y + hgt, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** 用 Canvas 画一张 1080×1440 的纪念卡（黑底 + 墨色卡、暖白字），存到相册 / 文件。 */
export async function saveCardImage(m, holder = '') {
  const t = cardText(m, holder);
  const W = 1080;
  const H = 1440;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d');
  const serif = '"Songti SC", "Noto Serif SC", "STSong", serif';
  const display = '"Didot", "Bodoni 72", "Times New Roman", serif';
  // 背景
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#1d1913');
  bg.addColorStop(1, '#080706');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  // 卡
  const x = 120;
  const y = 200;
  const w = W - 240;
  const ch = 1040;
  const foil = g.createLinearGradient(x, y, x + w, y + ch);
  foil.addColorStop(0, '#1f1e1b');
  foil.addColorStop(0.52, '#161513');
  foil.addColorStop(1, '#10100e');
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.55)';
  g.shadowBlur = 80;
  g.shadowOffsetY = 40;
  roundRect(g, x, y, w, 48, ch);
  g.fillStyle = foil;
  g.fill();
  g.restore();
  roundRect(g, x + 26, y + 26, w - 52, 30, ch - 52);
  g.strokeStyle = 'rgba(196, 172, 128, 0.25)';
  g.lineWidth = 2;
  g.stroke();
  // 字
  const ink = '#ece6da';
  g.textAlign = 'center';
  g.fillStyle = 'rgba(200, 192, 176, 0.7)';
  g.font = `500 30px ${serif}`;
  g.fillText(t.kicker.split('').join(' '), W / 2, y + 150);
  g.fillStyle = ink;
  g.font = `400 54px ${serif}`;
  g.fillText(t.title, W / 2, y + 290);
  g.font = `400 190px ${display}`;
  g.fillText(t.big, W / 2, y + 500);
  g.fillStyle = 'rgba(196, 172, 128, 0.35)';
  g.fillRect(W / 2 - 90, y + 570, 180, 2);
  g.fillStyle = ink;
  g.font = `400 40px ${serif}`;
  g.fillText(t.total, W / 2, y + 660);
  g.font = `400 36px ${serif}`;
  g.fillText(t.date, W / 2, y + 730);
  g.fillStyle = 'rgba(200, 192, 176, 0.7)';
  g.font = `400 30px ${serif}`;
  g.fillText(t.days, W / 2, y + 790);
  g.font = `500 24px ${serif}`;
  g.fillText('资产账本 · PRIVATE LEDGER', W / 2, y + ch - 90);
  if (t.holder) {
    g.fillStyle = ink;
    g.font = `500 32px ${serif}`;
    g.fillText(t.holder, W / 2, y + ch - 140);
  }
  const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
  if (!blob) return toast('生成图片失败');
  const r = await saveFile(`里程碑-${milestoneName(m.fen).replace(/\s/g, '')}-${m.date}.png`, blob, 'image/png', { title: '里程碑纪念卡' });
  if (r === 'downloaded') toast('图片已保存');
}

/* ------------------------------ 分析页的列表 ------------------------------ */

/** 「财富里程碑」：下一站的进度 + 走过的每一站（最新在上）。没有完整记录时返回 null。 */
export function milestoneSection(store) {
  const { snapshots, settings } = store.state;
  const reached = reachedMilestones(snapshots);
  const next = nextMilestone(snapshots);
  if (!reached.length && !next) return null;
  const holder = settings.holderName ?? '';
  const nextEl = next
    ? h(
        'div',
        { class: 'ms-next' },
        h('div', { class: 'ms-next-row' }, h('span', {}, '下一站 ', h('b', {}, milestoneName(next.fen))), h('span', { class: 'muted' }, '还差 ', h('span', { class: 'mask' }, compactYuan(next.gap)))),
        h('div', { class: 'goal-track ms-track' }, h('i', { style: `width:${Math.max(1.5, next.progress * 100).toFixed(1)}%` })),
      )
    : null;
  // 第一条记录时就已经超过的关口不算「走过」的一站：合成一行「起点」
  const walked = reached.filter((m) => m.days > 0);
  const start = reached.filter((m) => m.days === 0).pop();
  const list = walked
    .slice()
    .reverse()
    .map((m, i) =>
      h(
        'button',
        { type: 'button', class: ['ms-item', i === 0 && 'latest'], onClick: () => celebrate(m, { holder, replay: true }) },
        h('span', { class: 'ms-dia', 'aria-hidden': 'true' }),
        h('span', { class: 'ms-name' }, milestoneName(m.fen)),
        h('span', { class: 'grow ms-when' }, formatDateZh(m.date), m.days > 0 ? h('span', {}, ` · 第 ${m.days} 天`) : null),
        icon('chevronR', { size: 15 }),
      ),
    );
  const startEl = start ? h('div', { class: 'ms-item start' }, h('span', { class: 'ms-dia', 'aria-hidden': 'true' }), h('span', { class: 'ms-name' }, '起点'), h('span', { class: 'grow ms-when' }, `${formatDateZh(start.date)} 开始记账时已超过 ${milestoneName(start.fen)}`)) : null;
  return h('div', { class: 'ms-list' }, nextEl, ...list, startEl);
}
