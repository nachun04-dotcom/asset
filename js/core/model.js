// 数据模型与默认值。
//
// 快照（Snapshot）：
//   { id, date:'YYYY-MM-DD', note, source, createdAt, updatedAt,
//     entries: { [categoryId]: { fen:整数(分), fx?:{currency, original} } },
//     expectedIds: [保存时应有的类别 id], complete: boolean }
// entries 里没有某类别 = 未记录；{fen:0} = 已确认余额为零。二者永远不混同。

export const SCHEMA_VERSION = 1;
export const APP_FORMAT = 'asset-ledger-backup';

export const DEFAULT_CATEGORIES = Object.freeze([
  { id: 'alipay', name: '支付宝', enabled: true, order: 0, colorSlot: 0 },
  { id: 'wechat', name: '微信', enabled: true, order: 1, colorSlot: 1 },
  { id: 'goods', name: '货款', enabled: true, order: 2, colorSlot: 2 },
  { id: 'binance', name: '币安', enabled: true, order: 3, colorSlot: 3 },
  { id: 'bank', name: '银行卡', enabled: true, order: 4, colorSlot: 4 },
]);

export const DEFAULT_SETTINGS = Object.freeze({
  unit: 'yuan', // 显示单位：'yuan' | 'wan'
  changeThresholdPct: 20, // 与上一条相比变化超过该比例时提示
  riseColor: 'red', // 'red' = 红涨绿跌（默认），'green' = 绿涨红跌
  theme: 'auto', // 'auto' | 'light' | 'dark'
  backupRemindDays: 14,
  lockEnabled: false,
  lockAfterSec: 60,
});

export const SOURCE_LABELS = Object.freeze({
  manual: '手动录入',
  text: '文本导入',
  image: '图片导入',
  csv: 'CSV 导入',
  xlsx: 'Excel 导入',
  backup: '备份恢复',
});

export const CATEGORY_COLOR_SLOTS = 8;

export function newId(prefix = 'id') {
  const c = globalThis.crypto;
  if (c?.randomUUID) return `${prefix}_${c.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  let s = '';
  for (let i = 0; i < 16; i++) s += Math.floor(Math.random() * 16).toString(16);
  return `${prefix}_${s}`;
}

/** 显示用名称：只去掉多余空白，保留用户输入的原样（包括中文括号）。 */
export function cleanName(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

/** 比较/匹配用的键：全角半角、大小写不敏感。 */
export function nameKey(s) {
  return String(s ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** 新类别的固定颜色槽：颜色跟着类别走，不随排序或启停变化。 */
export function nextColorSlot(categories) {
  const used = new Set(categories.map((c) => c.colorSlot));
  for (let i = 0; i < CATEGORY_COLOR_SLOTS; i++) if (!used.has(i)) return i;
  return CATEGORY_COLOR_SLOTS; // 超过 8 类时统一用中性灰
}

export function sortedCategories(categories) {
  return [...categories].sort((a, b) => a.order - b.order);
}

export function enabledCategories(categories) {
  return sortedCategories(categories).filter((c) => c.enabled);
}

export function categoryById(categories) {
  return new Map(categories.map((c) => [c.id, c]));
}
