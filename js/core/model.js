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

/** 类别图标：只存一个键名（字符串），图形本身在界面层。键名必须在这张表里，其余一律忽略。 */
export const CATEGORY_ICON_KEYS = Object.freeze([
  'wallet', 'chat', 'card', 'bank', 'cash', 'coin', 'bitcoin', 'safe', 'trend', 'chart', 'sprout', 'gem',
  'box', 'cart', 'briefcase', 'home', 'car', 'globe', 'receipt', 'shield', 'heart', 'star', 'pie', 'phone',
]);
const ICON_KEY_SET = new Set(CATEGORY_ICON_KEYS);
export const isIconKey = (k) => typeof k === 'string' && ICON_KEY_SET.has(k);

// 内置类别的默认图标（用户没有选过图标时使用）
const DEFAULT_ICON_BY_ID = { alipay: 'wallet', wechat: 'chat', goods: 'box', binance: 'bitcoin', bank: 'card' };

// 按名字猜一个合适的图标（只是默认值，用户随时可以在设置里换）；越靠前越优先
const ICON_GUESS = [
  [/支付宝|余额宝|alipay/i, 'wallet'],
  [/微信|零钱|wechat/i, 'chat'],
  [/币|crypto|btc|eth|binance|okx|比特|以太/i, 'bitcoin'],
  [/信用卡|银行卡|储蓄卡|借记卡|卡/, 'card'],
  [/银行|定期|活期|存款|大额存单/, 'bank'],
  [/现金|钱包|零花/, 'cash'],
  [/股票|证券|美股|港股|基金|etf|期货/i, 'trend'],
  [/理财|养老|年金|国债|债券/, 'sprout'],
  [/黄金|金条|贵金属|珠宝|白银/, 'gem'],
  [/房|不动产|公寓/, 'home'],
  [/车/, 'car'],
  [/货款|货|库存|商品|仓/, 'box'],
  [/应收|借出|欠款|垫付|报销/, 'receipt'],
  [/保险|公积金|社保/, 'shield'],
  [/医|健康/, 'heart'],
  [/海外|外币|美元|日元|欧元|港币|外汇/, 'globe'],
  [/生意|公司|店|投资款|合伙/, 'briefcase'],
];

/** 一个类别该显示哪个图标：自己选过的 > 同类账户的「根」的图标 > 内置默认 > 按名字猜 > 钱包。 */
export function iconKeyFor(cat, categories = []) {
  if (!cat) return 'wallet';
  if (isIconKey(cat.icon)) return cat.icon;
  const root = cat.group ? categories.find((c) => c.id === cat.group) : null;
  if (root && root !== cat) return iconKeyFor(root, categories);
  if (DEFAULT_ICON_BY_ID[cat.id]) return DEFAULT_ICON_BY_ID[cat.id];
  for (const [re, key] of ICON_GUESS) if (re.test(cat.name ?? '')) return key;
  return 'wallet';
}


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

/**
 * 新类别的固定颜色槽：颜色跟着类别走，不随排序或启停变化。
 * 8 个颜色槽用完后：同类账户沿用同类的颜色（preferred），否则用中性灰。
 */
export function nextColorSlot(categories, preferred = null) {
  const used = new Set(categories.map((c) => c.colorSlot));
  for (let i = 0; i < CATEGORY_COLOR_SLOTS; i++) if (!used.has(i)) return i;
  return Number.isInteger(preferred) && preferred >= 0 && preferred < CATEGORY_COLOR_SLOTS ? preferred : CATEGORY_COLOR_SLOTS;
}

/** 同类账户的归属：没有 group 的类别自己就是一类的「根」。 */
export function groupKey(cat) {
  return cat.group || cat.id;
}

/** 这一类下有几个账户（含自己）。 */
export function groupMembers(categories, cat) {
  const key = groupKey(cat);
  return sortedCategories(categories).filter((c) => groupKey(c) === key);
}

/** 为「添加同类账户」建议一个不重名的名字：支付宝 → 支付宝 2 → 支付宝 3 … */
export function suggestSiblingName(categories, baseCat) {
  const root = categories.find((c) => c.id === groupKey(baseCat)) ?? baseCat;
  const base = cleanName(root.name).replace(/\s*[#＃]?\d+$/, '') || cleanName(root.name);
  const taken = new Set(categories.map((c) => nameKey(c.name)));
  for (let n = 2; n < 1000; n++) {
    const name = `${base} ${n}`;
    if (!taken.has(nameKey(name))) return name;
  }
  return `${base} ${Date.now() % 10000}`;
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
