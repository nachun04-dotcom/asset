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
  hideAmounts: false, // 隐私模式：界面上的金额模糊显示
  goalFen: null, // 财富目标（分），null = 未设定
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

/** 类别图标：只存一个键名（字符串），图形本身在界面层。旧版的简写键名保留可用；新图标为「l-线条名」「b-品牌名」。 */
export const CATEGORY_ICON_KEYS = Object.freeze([
  'wallet', 'chat', 'card', 'bank', 'cash', 'coin', 'bitcoin', 'safe', 'trend', 'chart', 'sprout', 'gem',
  'box', 'cart', 'briefcase', 'home', 'car', 'globe', 'receipt', 'shield', 'heart', 'star', 'pie', 'phone',
]);
const ICON_KEY_SET = new Set(CATEGORY_ICON_KEYS);
export const isIconKey = (k) => typeof k === 'string' && (ICON_KEY_SET.has(k) || /^[lb]-[a-z0-9-]{1,40}$/.test(k));

// 内置类别的默认图标（用户没有选过图标时使用）
const DEFAULT_ICON_BY_ID = { alipay: 'b-alipay', wechat: 'b-wechat', goods: 'l-package', binance: 'b-binance', bank: 'l-credit-card' };

// 按名字猜一个合适的图标（只是默认值，用户随时可以在设置里换）；越靠前越优先
const ICON_GUESS = [
  [/花呗|借呗|白条|贷款|房贷|车贷|欠款|负债|分期|借款/, 'l-receipt-text'],
  [/支付宝|余额宝|alipay/i, 'b-alipay'],
  [/微信|零钱|wechat/i, 'b-wechat'],
  [/币安|binance/i, 'b-binance'],
  [/okx|欧易/i, 'b-okx'],
  [/usdt|泰达/i, 'b-tether'],
  [/以太|eth/i, 'b-ethereum'],
  [/币|crypto|btc|比特/i, 'b-bitcoin'],
  [/paypal/i, 'b-paypal'],
  [/shopee|虾皮/i, 'b-shopee'],
  [/淘宝|天猫|京东|拼多多|网店/i, 'l-shopping-bag'],
  [/信用卡|银行卡|储蓄卡|借记卡|卡/, 'l-credit-card'],
  [/银行|定期|活期|存款|大额存单/, 'l-landmark'],
  [/现金|钱包|零花/, 'l-banknote'],
  [/股票|证券|美股|港股|基金|etf|期货/i, 'l-chart-candlestick'],
  [/理财|养老|年金|国债|债券/, 'l-sprout'],
  [/黄金|金条|贵金属|珠宝|白银/, 'l-gem'],
  [/房|不动产|公寓/, 'l-house'],
  [/车/, 'l-car'],
  [/货款|货|库存|商品|仓/, 'l-package'],
  [/应收|借出|垫付|报销/, 'l-hand-coins'],
  [/保险|公积金|社保/, 'l-shield-check'],
  [/医|健康/, 'l-heart-pulse'],
  [/海外|外币|美元|日元|欧元|港币|外汇/, 'l-globe'],
  [/生意|公司|店|投资款|合伙/, 'l-briefcase-business'],
];

/** 一个类别该显示哪个图标：自己选过的 > 同类账户的「根」的图标 > 内置默认 > 按名字猜 > 钱包。 */
export function iconKeyFor(cat, categories = []) {
  if (!cat) return 'wallet';
  if (isIconKey(cat.icon)) return cat.icon;
  // 没选过图标的同类账户：沿用大类里最早那个账户的图标；它被删了，就用大类里第一个选过图标的
  if (cat.group && cat.group !== cat.id) {
    const mates = sortedCategories(categories).filter((c) => c.id !== cat.id && groupKey(c) === cat.group);
    const first = mates.find((c) => c.id === cat.group);
    if (first) return iconKeyFor({ ...first, group: undefined }, categories);
    const picked = mates.find((c) => isIconKey(c.icon));
    if (picked) return picked.icon;
  }
  if (DEFAULT_ICON_BY_ID[cat.id]) return DEFAULT_ICON_BY_ID[cat.id];
  for (const [re, key] of ICON_GUESS) if (re.test(cat.name ?? '')) return key;
  return 'l-wallet';
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

/**
 * 同类账户（大类）：成员都带同一个 group 键和同一个 groupName（大类自己的名字）。
 * 大类名字和任何一个账户的名字互不影响——改账户名不会改大类名，删掉任何一个账户也不会拆散大类。
 * 没有 group 的类别自己就是一类。
 */
export function groupKey(cat) {
  return cat.group || cat.id;
}

/** 大类的名字：成员里存的 groupName；旧数据没有时退回「键对应的那个账户」的名字，再退回自己的名字。 */
export function groupName(cat, categories = []) {
  if (!cat) return '';
  const key = groupKey(cat);
  const members = categories.filter((c) => groupKey(c) === key);
  const named = [cat, ...members].find((c) => typeof c.groupName === 'string' && c.groupName.trim());
  if (named) return cleanName(named.groupName);
  return cleanName((categories.find((c) => c.id === key) ?? cat).name);
}

/**
 * 整理大类数据（读取、恢复备份、保存时都会走一遍）：
 * 同一大类的每个成员都写上相同的 group 和 groupName（旧数据里「根」账户没有 group、大类名借用根的名字，这里一次性固定下来）。
 * 只剩一个成员的大类保留这两个字段（之后再添加同类账户时沿用原来的大类名），显示时按单个账户处理。
 */
export function normalizeGroups(categories) {
  const byKey = new Map();
  for (const c of categories) {
    const k = groupKey(c);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(c);
  }
  return categories.map((c) => {
    const k = groupKey(c);
    const members = byKey.get(k);
    const grouped = members.length > 1 || !!c.group;
    if (!grouped) {
      const { group, groupName: _g, ...rest } = c;
      return rest;
    }
    return { ...c, group: k, groupName: groupName(c, categories).slice(0, 20) };
  });
}

/** 这一类下有几个账户（含自己）。 */
export function groupMembers(categories, cat) {
  const key = groupKey(cat);
  return sortedCategories(categories).filter((c) => groupKey(c) === key);
}

/** 为「添加同类账户」建议一个不重名的名字：支付宝 → 支付宝 2 → 支付宝 3 … */
export function suggestSiblingName(categories, baseCat) {
  const gname = groupName(baseCat, categories);
  const base = gname.replace(/\s*[#＃]?\d+$/, '') || gname;
  const taken = new Set(categories.map((c) => nameKey(c.name)));
  for (let n = 2; n < 1000; n++) {
    const name = `${base} ${n}`;
    if (!taken.has(nameKey(name))) return name;
  }
  return `${base} ${Date.now() % 10000}`;
}

/** 负债类别（信用卡、花呗、贷款等）：记录里的金额存为负数，合计即净资产。 */
export const isDebt = (cat) => !!cat?.debt;

/** 一条记录里的资产合计与负债合计（负债以正数表示欠了多少）。 */
export function splitTotals(snap, categories) {
  let assets = 0;
  let debts = 0;
  let hasDebt = false;
  const byId = new Map(categories.map((c) => [c.id, c]));
  for (const [id, e] of Object.entries(snap.entries)) {
    if (!e || !Number.isInteger(e.fen)) continue;
    if (isDebt(byId.get(id))) {
      hasDebt = true;
      debts -= e.fen;
    } else assets += e.fen;
  }
  return { assets, debts, hasDebt };
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
