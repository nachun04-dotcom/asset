// 日期工具：全部使用「本地日历日期」字符串 YYYY-MM-DD，不涉及时区换算。

const pad2 = (n) => String(n).padStart(2, '0');

export function isValidYMD(y, m, d) {
  if (![y, m, d].every(Number.isInteger)) return false;
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return false;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= dim;
}

export function toISO(y, m, d) {
  return `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`;
}

export function parseISO(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? ''));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return isValidYMD(y, mo, d) ? { y, m: mo, d } : null;
}

export function isISODate(s) {
  return parseISO(s) !== null;
}

export function todayISO(now = new Date()) {
  return toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function weekdayZh(iso) {
  const p = parseISO(iso);
  if (!p) return '';
  return WEEKDAYS[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()];
}

export function formatDateZh(iso, { year = true, weekday = false } = {}) {
  const p = parseISO(iso);
  if (!p) return String(iso ?? '');
  const core = `${year ? `${p.y}年` : ''}${p.m}月${p.d}日`;
  return weekday ? `${core} ${weekdayZh(iso)}` : core;
}

export function dayNumber(iso) {
  const p = parseISO(iso);
  if (!p) return NaN;
  return Math.round(Date.UTC(p.y, p.m - 1, p.d) / 86400000);
}

export function dayDiff(aIso, bIso) {
  return dayNumber(bIso) - dayNumber(aIso);
}

export function isoFromDayNumber(n) {
  const dt = new Date(n * 86400000);
  return toISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addDays(iso, n) {
  return isoFromDayNumber(dayNumber(iso) + n);
}

export function monthKey(iso) {
  return String(iso).slice(0, 7);
}

/** 距今天数的人性化描述 */
export function relativeDaysZh(iso, now = new Date()) {
  const diff = dayDiff(iso, todayISO(now));
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  if (diff > 1 && diff < 31) return `${diff} 天前`;
  if (diff >= 31 && diff < 365) return `${Math.floor(diff / 30)} 个月前`;
  if (diff >= 365) return `${Math.floor(diff / 365)} 年前`;
  return formatDateZh(iso);
}
