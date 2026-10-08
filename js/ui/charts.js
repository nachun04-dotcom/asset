// 手写 SVG 图表（离线，无库）。规格：线 2px 圆头；标记点 r=4 且带 2px 底色描边；面积 10%；
// 网格与坐标轴为 1px 实线；悬停/触摸有十字线 + 提示框；支持键盘左右键；每个图都有「数据表」对照。
import { s, h, clear } from './dom.js';
import { dayNumber, formatDateZh } from '../core/date.js';
import { formatMoney } from '../core/money.js';
import { axisLabels, compactYuan } from './fmt.js';

/* ------------------------------ 纯函数（可测试） ------------------------------ */

export function niceStep(range, target = 4) {
  const raw = range / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return nice * mag;
}

export function niceScale(min, max, { target = 4, zeroBase = false, pad = 0.08 } = {}) {
  if (zeroBase) min = Math.min(0, min);
  if (!(max > min)) {
    const base = Math.abs(max) || 100;
    min = zeroBase ? Math.min(0, max - base * 0.1) : max - base * 0.1;
    max += base * 0.1;
  } else if (zeroBase) {
    max += (max - min) * pad;
  } else {
    const p = (max - min) * pad;
    min -= p;
    max += p;
  }
  const step = niceStep(max - min, target);
  const lo = Math.floor(min / step + 1e-9) * step;
  const hi = Math.ceil(max / step - 1e-9) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step * 1e-6; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { min: lo, max: hi, step, ticks };
}

/** X 轴刻度：在时间上均匀取 n 个位置，标签格式随跨度变化。 */
export function xTicks(minDay, maxDay, n = 4) {
  if (maxDay <= minDay) return [{ day: minDay }];
  const count = Math.min(n, Math.max(2, Math.floor(maxDay - minDay) + 1));
  return Array.from({ length: count }, (_, i) => ({ day: Math.round(minDay + ((maxDay - minDay) * i) / (count - 1)) }));
}

export function dayLabel(day, spanDays) {
  const dt = new Date(day * 86400000);
  const y = dt.getUTCFullYear();
  const m = dt.getUTCMonth() + 1;
  const d = dt.getUTCDate();
  return spanDays > 300 ? `${String(y).slice(2)}/${m}` : `${m}/${d}`;
}

/**
 * 折线分段：相邻两个点之间，如果账本里还有别的记录日期、而该系列在那天没有金额，
 * 就断开，不画连线（未记录不是 0，也不做插值）。
 */
export function segmentsFor(points, allDays, breakGaps = true) {
  const segs = [];
  let cur = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (cur.length) {
      const prev = cur[cur.length - 1];
      const gap = breakGaps && allDays.some((d) => d > prev.day && d < p.day);
      if (gap) {
        segs.push(cur);
        cur = [];
      }
    }
    cur.push(p);
  }
  if (cur.length) segs.push(cur);
  return segs;
}

/* ------------------------------ 折线图 ------------------------------ */

/**
 * series: [{ id, name, color:'var(--cat-0)', points:[{date, fen, complete?}], dashed?, breakGaps? }]
 * allDates: 账本中所有记录日期（用于判断断点）
 */
export function buildLineChart({ series, allDates = [], unit = 'yuan', height = 210, zeroBase = false, area = false, endLabel = false, ariaLabel = '趋势图' }) {
  const root = h('div', { class: 'chart' });
  const tip = h('div', { class: 'tip', hidden: true });
  const host = h('div', {});
  root.appendChild(host);
  root.appendChild(tip);
  let state = { width: 0, active: -1 };
  let model = null;

  function compute(width) {
    const vis = series.filter((x) => x.points.length);
    const allPts = vis.flatMap((x) => x.points.map((p) => ({ ...p, day: dayNumber(p.date) })));
    const vals = allPts.map((p) => p.fen);
    const y = niceScale(Math.min(...vals), Math.max(...vals), { zeroBase });
    const yLabels = axisLabels(y.ticks);
    // 左边距跟着刻度文字的长度走（「1.52万」「15,200」都要放得下）
    const margin = { top: 14, right: endLabel ? 52 : 14, bottom: 26, left: Math.min(70, Math.max(44, 14 + Math.max(...yLabels.map((t) => t.length)) * 7)) };
    const plotW = Math.max(60, width - margin.left - margin.right);
    const plotH = height - margin.top - margin.bottom;
    const days = [...new Set(allPts.map((p) => p.day))].sort((a, b) => a - b);
    const minDay = days[0];
    const maxDay = days[days.length - 1];
    const xOf = (day) => margin.left + (maxDay === minDay ? plotW / 2 : ((day - minDay) / (maxDay - minDay)) * plotW);
    const yOf = (v) => margin.top + plotH - ((v - y.min) / (y.max - y.min)) * plotH;
    const allDays = [...new Set((allDates.length ? allDates : allPts.map((p) => p.date)).map(dayNumber))].sort((a, b) => a - b);
    return { margin, plotW, plotH, vis, days, minDay, maxDay, y, yLabels, xOf, yOf, allDays, width };
  }

  function draw() {
    const width = Math.round(root.getBoundingClientRect?.().width || root.clientWidth || 340);
    if (!series.some((x) => x.points.length)) {
      clear(host);
      return;
    }
    model = compute(width);
    state.width = width;
    const { margin, plotW, plotH, vis, days, minDay, maxDay, y, yLabels, xOf, yOf, allDays } = model;
    const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': ariaLabel, tabindex: '0' });

    const grid = s('g', {});
    for (const [ti, t] of y.ticks.entries()) {
      const py = yOf(t);
      grid.appendChild(s('line', { class: t === y.min && zeroBase ? 'axis' : 'grid', x1: margin.left, x2: margin.left + plotW, y1: py, y2: py }));
      grid.appendChild(s('text', { x: margin.left - 8, y: py + 4, 'text-anchor': 'end' }, yLabels[ti]));
    }
    svg.appendChild(grid);
    const span = maxDay - minDay;
    for (const t of xTicks(minDay, maxDay)) {
      svg.appendChild(s('text', { x: xOf(t.day), y: height - 6, 'text-anchor': t.day === minDay && span > 0 ? 'start' : t.day === maxDay && span > 0 ? 'end' : 'middle' }, dayLabel(t.day, span)));
    }

    const marks = s('g', {});
    for (const se of vis) {
      const pts = se.points.map((p) => ({ ...p, day: dayNumber(p.date), px: xOf(dayNumber(p.date)), py: yOf(p.fen) }));
      const segs = segmentsFor(pts, allDays, se.breakGaps !== false);
      const color = `stroke:${se.color}`;
      if (area && !se.dashed) {
        for (const seg of segs) {
          if (seg.length < 2) continue;
          const d = `M${seg[0].px},${margin.top + plotH} ` + seg.map((p) => `L${p.px},${p.py}`).join(' ') + ` L${seg[seg.length - 1].px},${margin.top + plotH} Z`;
          svg.appendChild(s('path', { d, style: `fill:${se.color};opacity:.1;stroke:none` }));
        }
      }
      for (const seg of segs) {
        if (seg.length < 2) continue;
        svg.appendChild(s('path', { d: seg.map((p, i) => `${i ? 'L' : 'M'}${p.px.toFixed(1)},${p.py.toFixed(1)}`).join(' '), fill: 'none', style: color, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-dasharray': se.dashed ? '5 5' : null }));
      }
      // 标记点：未完整的点画空心；完整系列只在末端和孤立点上画实心点
      pts.forEach((p, i) => {
        const isEnd = i === pts.length - 1;
        const isolated = segs.some((sg) => sg.length === 1 && sg[0] === p);
        const hollow = p.complete === false;
        if (!(hollow || isEnd || isolated)) return;
        marks.appendChild(s('circle', { cx: p.px, cy: p.py, r: 6, style: 'fill:var(--page)' }));
        marks.appendChild(s('circle', { cx: p.px, cy: p.py, r: 4, style: hollow ? `fill:var(--page);stroke:${se.color};stroke-width:2` : `fill:${se.color}` }));
      });
      if (endLabel && se === vis[0]) {
        const last = pts[pts.length - 1];
        svg.appendChild(s('text', { class: 'endlabel', x: Math.min(last.px + 9, width - 2), y: last.py + 4, 'text-anchor': 'start' }, compactYuan(last.fen)));
      }
    }
    svg.appendChild(marks);

    const hover = s('g', {});
    svg.appendChild(hover);
    const hit = s('rect', { x: margin.left - 8, y: margin.top - 6, width: plotW + 16, height: plotH + 12, fill: 'transparent' });
    svg.appendChild(hit);

    const showAt = (idx) => {
      idx = Math.max(0, Math.min(days.length - 1, idx));
      state.active = idx;
      const day = days[idx];
      const px = xOf(day);
      clear(hover);
      hover.appendChild(s('line', { class: 'cross', x1: px, x2: px, y1: margin.top, y2: margin.top + plotH }));
      clear(tip);
      const date = new Date(day * 86400000).toISOString().slice(0, 10);
      tip.appendChild(h('div', { class: 't-date' }, formatDateZh(date, { weekday: true })));
      for (const se of vis) {
        const p = se.points.find((q) => dayNumber(q.date) === day);
        if (p) {
          hover.appendChild(s('circle', { cx: px, cy: yOf(p.fen), r: 6, style: 'fill:var(--page)' }));
          hover.appendChild(s('circle', { cx: px, cy: yOf(p.fen), r: 4, style: `fill:${se.color}` }));
        }
        tip.appendChild(h('div', { class: 't-row' }, h('i', { class: 't-key', style: `background:${se.color}` }), h('span', { class: 't-name' }, se.name + (p && p.complete === false ? '（不完整）' : '')), h('span', { class: 't-val' }, p ? formatMoney(p.fen, unit) : '未记录')));
      }
      tip.hidden = false;
      const tw = tip.offsetWidth || 160;
      tip.setAttribute('style', `top:${margin.top}px;left:${Math.max(0, px > width / 2 ? px - tw - 12 : px + 12)}px`);
    };
    const hide = () => {
      state.active = -1;
      clear(hover);
      tip.hidden = true;
    };
    const idxFromEvent = (e) => {
      const rect = svg.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / (rect.width || width)) * width;
      let best = 0;
      let bd = Infinity;
      days.forEach((d, i) => {
        const dd = Math.abs(xOf(d) - x);
        if (dd < bd) {
          bd = dd;
          best = i;
        }
      });
      return best;
    };
    svg.addEventListener('pointermove', (e) => showAt(idxFromEvent(e)));
    svg.addEventListener('pointerdown', (e) => showAt(idxFromEvent(e)));
    svg.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && hide());
    svg.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') showAt((state.active < 0 ? days.length : state.active) - 1);
      else if (e.key === 'ArrowRight') showAt(state.active + 1);
      else if (e.key === 'Escape') hide();
      else return;
      e.preventDefault();
    });
    svg.addEventListener('blur', hide);

    clear(host);
    host.appendChild(svg);
    tip.hidden = true;
  }

  draw();
  if (typeof ResizeObserver !== 'undefined') {
    let last = 0;
    const ro = new ResizeObserver(() => {
      const w = Math.round(root.getBoundingClientRect().width);
      if (w && Math.abs(w - last) > 1) {
        last = w;
        draw();
      }
    });
    ro.observe(root);
  }
  return { el: root, redraw: draw };
}

/* ------------------------------ 占比条 ------------------------------ */

/** 数据表（图表的无障碍对照） */
export function buildDataTable({ columns, rows }) {
  return h('div', { class: 'table-wrap' }, h('table', { class: 'data-table' }, h('thead', {}, h('tr', {}, ...columns.map((c) => h('th', { scope: 'col' }, c)))), h('tbody', {}, ...rows.map((r) => h('tr', {}, ...r.map((c) => h('td', {}, c)))))));
}
