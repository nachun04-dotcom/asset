// 日常开销：分类、一句话解析（「午饭 35，打车 20」）、问答（「这个月打车花了多少」）、统计。
// 纯函数，不碰界面和存储。金额一律用「分」整数。
import { addDays, todayISO } from './date.js';

/* ------------------------------ 分类 ------------------------------ */

// 顺序就是匹配优先级：同一句里同时出现时，排在前面的分类先认。kw 越具体越好。
export const SPEND_CATS = [
  { key: 'drink', name: '饮品', icon: 'coffee', color: 1, kw: ['咖啡', '奶茶', '星巴克', '瑞幸', '喜茶', '霸王茶姬', '茶饮', '饮料', '果汁', '拿铁', '美式'] },
  { key: 'food', name: '餐饮', icon: 'utensils', color: 7, kw: ['早餐', '早饭', '午饭', '午餐', '中饭', '晚饭', '晚餐', '夜宵', '宵夜', '外卖', '吃饭', '吃了', '火锅', '烧烤', '食堂', '小吃', '点心', '汉堡', '麦当劳', '肯德基', '寿司', '面', '饭', '餐', '吃'] },
  { key: 'taxi', name: '交通', icon: 'car', color: 0, kw: ['打车', '滴滴', '出租', '的士', 'grab', 'uber', '网约车', '地铁', '公交', '巴士', '高铁', '火车', '动车', '车票', '机票', '飞机', '加油', '油费', '停车', '过路费', '高速', '单车', '共享单车', '船票', '车费', '路费'] },
  { key: 'stay', name: '住宿', icon: 'bed', color: 5, kw: ['酒店', '住宿', '民宿', '宾馆', '旅馆', '房租', '租金', 'airbnb', '住'] },
  { key: 'fun', name: '娱乐', icon: 'film', color: 4, kw: ['电影', 'ktv', '唱歌', '游戏', '演唱会', '门票', '酒吧', '剧本杀', '密室', '桌游', '按摩', '足疗', '演出', '展览', '娱乐', '蹦迪', '玩'] },
  { key: 'shop', name: '购物', icon: 'bag', color: 3, kw: ['衣服', '鞋', '裤', '包包', '淘宝', '京东', '拼多多', 'shopee', 'lazada', '购物', '化妆品', '护肤', '数码', '耳机', '网购'] },
  { key: 'daily', name: '日用', icon: 'cart', color: 2, kw: ['超市', '日用', '便利店', '7-11', '711', '水果', '买菜', '菜', '纸巾', '洗衣'] },
  { key: 'bill', name: '缴费', icon: 'zap', color: 6, kw: ['水费', '电费', '燃气', '网费', '话费', '宽带', '物业', '充值', '会员', '订阅'] },
  { key: 'health', name: '医疗', icon: 'pill', color: 7, kw: ['药', '医院', '看病', '挂号', '体检', '牙', '诊所'] },
  { key: 'sport', name: '运动', icon: 'dumbbell', color: 2, kw: ['健身', '游泳', '羽毛球', '篮球', '足球', '网球', '瑜伽', '运动', '跑步', '球'] },
  { key: 'study', name: '学习', icon: 'book', color: 0, kw: ['书', '课', '学费', '培训', '课程', '考试'] },
  { key: 'gift', name: '人情', icon: 'gift', color: 4, kw: ['红包', '礼物', '请客', '份子', '随礼', '送礼', '人情'] },
  { key: 'travel', name: '旅行', icon: 'plane', color: 6, kw: ['旅游', '旅行', '景点', '签证', '度假'] },
  { key: 'pet', name: '宠物', icon: 'paw', color: 1, kw: ['猫', '狗', '宠物'] },
  { key: 'beauty', name: '美容', icon: 'scissors', color: 5, kw: ['理发', '剪头', '美甲', '美容', '洗头', '做头发'] },
  { key: 'other', name: '其他', icon: 'more', color: -1, kw: [] },
];
const CAT = new Map(SPEND_CATS.map((c) => [c.key, c]));
export const spendCat = (key) => CAT.get(key) ?? CAT.get('other');

/** 按关键词认分类：最早出现、同位置时最长的关键词说了算。 */
export function guessCat(text) {
  const t = text.toLowerCase();
  let best = null;
  for (const c of SPEND_CATS) {
    for (const k of c.kw) {
      const i = t.indexOf(k);
      if (i < 0) continue;
      if (!best || i < best.i || (i === best.i && k.length > best.len)) best = { key: c.key, i, len: k.length };
    }
  }
  return best?.key ?? 'other';
}

/* ------------------------------ 数字 ------------------------------ */

const CN_DIGIT = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CN_UNIT = { 十: 10, 百: 100, 千: 1000, 万: 10000 };

/** 中文数字 → 数值：三十五、一百二、两千五、十、八点五。不认识返回 null。 */
export function cnNumber(str) {
  if (!str) return null;
  const [intPart, decPart] = str.split('点');
  let total = 0;
  let section = 0;
  let num = null;
  let lastUnit = 1;
  for (const ch of intPart) {
    if (ch in CN_DIGIT) num = CN_DIGIT[ch];
    else if (ch in CN_UNIT) {
      const u = CN_UNIT[ch];
      if (u === 10000) {
        total += (section + (num ?? 0)) * u;
        section = 0;
      } else section += (num ?? 1) * u;
      num = null;
      lastUnit = u;
    } else return null;
  }
  // 「一百二」「两千五」「一万二」：末尾单独一个数字，按上一个单位的十分之一算（「一百零五」「十二」不算）
  if (num != null) {
    const tailOfUnit = lastUnit >= 100 && intPart.length > 1 && !(intPart.at(-2) in CN_DIGIT);
    if (tailOfUnit && lastUnit === 10000) total += num * 1000;
    else section += tailOfUnit ? num * (lastUnit / 10) : num;
  }
  let v = total + section;
  if (decPart) {
    let f = '';
    for (const ch of decPart) {
      if (!(ch in CN_DIGIT)) return null;
      f += CN_DIGIT[ch];
    }
    v = Number(`${v}.${f}`);
  }
  return v;
}

// 金额：阿拉伯数字（可带小数、千分位，「12块5」），或中文数字（「八十」「一百二」「两千」「三十五块」）
const AMOUNT_RE = /(?:[¥￥$]|rmb|rm)?\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?:\s*(块钱|块|元|rmb|rm)((?:\d|[一二三四五六七八九])(?![\d.]))?)?|([零〇一二两三四五六七八九十百千万点]+)(?:\s*(块钱|块|元)([一二三四五六七八九])?)?/gi;
// 数字后面跟这些字时不是钱（时间、日期、数量）
const NOT_MONEY_AFTER = /^\s*(点(?!\d)|:|号|月|日|年|个|次|人|位|天|小时|分钟|分|斤|公里|km|楼|岁|周|多|几|口|件|张|杯|瓶)/i;
const CN_TRAIL = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

function amounts(text) {
  const out = [];
  AMOUNT_RE.lastIndex = 0;
  let m;
  while ((m = AMOUNT_RE.exec(text))) {
    let yuan = null;
    const after = text.slice(m.index + m[0].length);
    if (m[1]) {
      if (!m[2] && NOT_MONEY_AFTER.test(after)) continue;
      if (text[m.index - 1] === ':') continue; // 「12:30」这种时间
      yuan = Number(m[1].replace(/,/g, ''));
      if (m[3]) yuan += (CN_TRAIL[m[3]] ?? Number(m[3])) / 10; // 12块5、八块五
    } else if (m[4]) {
      // 中文数字：要么带「块 / 元」，要么像「八十」「一百二」「两千」这样带单位、至少两个字，避免把「一起」「十分」当成钱
      if (m[4].endsWith('点')) continue; // 「十二点」是时间
      if (!m[5] && (!/[十百千万]/.test(m[4]) || m[4].length < 2 || NOT_MONEY_AFTER.test(after))) continue;
      const v = cnNumber(m[4]);
      if (v == null) continue;
      yuan = v + (m[6] ? CN_TRAIL[m[6]] / 10 : 0);
    }
    if (!(yuan > 0) || yuan > 10_000_000) continue;
    out.push({ start: m.index, end: m.index + m[0].length, fen: Math.round(yuan * 100) });
  }
  return out;
}

/* ------------------------------ 日期与时段 ------------------------------ */

const WEEK = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };

/** 句子里的日期词 → ISO 日期；没有日期词返回 null。 */
function dateIn(text, today) {
  if (/大前天/.test(text)) return addDays(today, -3);
  if (/前天/.test(text)) return addDays(today, -2);
  if (/昨天|昨日|昨晚|昨夜/.test(text)) return addDays(today, -1);
  if (/今天|今日|今早|今晚/.test(text)) return today;
  let m = text.match(/(上)?(?:周|星期|礼拜)([一二三四五六日天])/);
  if (m) {
    const now = new Date(`${today}T12:00:00`).getDay();
    let back = (now - WEEK[m[2]] + 7) % 7;
    if (m[1]) back += 7;
    return addDays(today, -back);
  }
  m = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/);
  if (m) {
    const y = Number(today.slice(0, 4));
    let iso = `${y}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
    if (iso > today) iso = `${y - 1}${iso.slice(4)}`;
    return iso;
  }
  m = text.match(/(\d{1,2})\s*号/);
  if (m) {
    let iso = `${today.slice(0, 8)}${String(m[1]).padStart(2, '0')}`;
    if (iso > today) iso = `${addDays(`${today.slice(0, 8)}01`, -1).slice(0, 8)}${String(m[1]).padStart(2, '0')}`;
    return iso;
  }
  return null;
}

const MEAL_BY_HOUR = (h) => (h >= 5 && h < 10 ? '早餐' : h >= 10 && h < 15 ? '午饭' : h >= 15 && h < 17 ? '下午茶' : h >= 17 && h < 21 ? '晚饭' : '夜宵');

/** 时段词 → 时刻和三餐的叫法。「12点」「晚上8点」这种具体钟点优先。 */
function partIn(text) {
  const hm = text.match(/(\d{1,2}|[一二三四五六七八九十]{1,3})\s*点\s*(半|\d{1,2}分?)?/);
  if (hm) {
    let hr = Number(hm[1]) || cnNumber(hm[1]) || 0;
    if (/下午|晚上|傍晚/.test(text) && hr < 12) hr += 12;
    const min = hm[2] === '半' ? 30 : Number.parseInt(hm[2] ?? '0', 10) || 0;
    if (hr <= 24) return { time: `${String(hr % 24).padStart(2, '0')}:${String(min).padStart(2, '0')}`, meal: MEAL_BY_HOUR(hr % 24) };
  }
  if (/早上|早晨|早饭|早餐|早点|今早|上午/.test(text)) return { time: '08:30', meal: '早餐' };
  if (/中午|午饭|午餐|中饭/.test(text)) return { time: '12:30', meal: '午饭' };
  if (/下午|下午茶/.test(text)) return { time: '15:30', meal: '下午茶' };
  if (/夜宵|宵夜|深夜|凌晨|半夜/.test(text)) return { time: '23:00', meal: '夜宵' };
  if (/晚上|晚饭|晚餐|傍晚|今晚|昨晚/.test(text)) return { time: '19:00', meal: '晚饭' };
  return null;
}

/* ------------------------------ 一句话记账 ------------------------------ */

const FILLER = /(\d{1,2}|[一二三四五六七八九十]{1,3})\s*点\s*(半|\d{1,2}分?)?|今天|今日|昨天|昨日|前天|大前天|今早|今晚|昨晚|昨夜|(上)?(周|星期|礼拜)[一二三四五六日天]|\d{1,2}\s*月\s*\d{1,2}\s*[日号]|\d{1,2}\s*号|早上|早晨|上午|中午|下午|晚上|傍晚|深夜|凌晨|半夜|一共|总共|共计|合计|花了|花费|花|付了|付款|支付|用了|消费了?|大概|大约|左右|然后|还有|另外|再|又|了|的|是|我们|咱们|大家|一起|我|在|去|块钱|块|元|钱|¥|￥|[，,。.;；、！!？?\s]+/g;

/** 去掉日期、动词、金额之后剩下的「买了什么」。 */
function cleanNote(seg) {
  return seg.replace(FILLER, ' ').replace(/\s+/g, ' ').trim().slice(0, 20);
}

/**
 * 一句话拆成多笔开销。「今天中午吃饭花了35，打车20，晚上看电影八十」→ 三笔。
 * 每一笔：{ date, time, fen, cat, note }。日期词会延续到后面的几笔（「昨天午饭30打车15」两笔都是昨天）。
 */
export function parseSpending(input, { today = todayISO(), now = new Date() } = {}) {
  const text = String(input ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!text) return [];
  const list = amounts(text);
  const out = [];
  let date = null;
  let prevEnd = 0;
  const nowTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  for (const a of list) {
    // 这一笔的文字：从上一笔结束到这一笔的金额结束；金额后面紧跟的说明（「35 午饭」）也算进来
    let seg = text.slice(prevEnd, a.end);
    const next = list[list.indexOf(a) + 1];
    const tail = text.slice(a.end, next ? next.start : text.length);
    const tailHead = tail.split(/[，,。;；、]/)[0];
    if (!cleanNote(seg.slice(0, a.start - prevEnd)) && cleanNote(tailHead)) {
      seg += tailHead;
      prevEnd = a.end + tailHead.length;
    } else prevEnd = a.end;
    date = dateIn(seg, today) ?? date ?? today;
    const part = partIn(seg);
    const cat = guessCat(seg);
    let note = cleanNote(seg.replace(text.slice(a.start, a.end), ' '));
    // 「吃饭」「饭」这类泛称，按时段换成早餐 / 午饭 / 晚饭
    const meal = part?.meal ?? (date === today ? MEAL_BY_HOUR(now.getHours()) : null);
    if (cat === 'food' && meal && (!note || /^(吃饭|吃|饭|餐|吃了饭?)$/.test(note))) note = meal;
    if (!note) note = spendCat(cat).name;
    out.push({ date, time: part?.time ?? (date === today ? nowTime : '12:00'), fen: a.fen, cat, note });
  }
  return out;
}

/* ------------------------------ 问答 ------------------------------ */

/** 这句话是在问（「这个月打车花了多少」），不是在记账。 */
export function isQuestion(text) {
  return /多少|几次|几笔|多少次|总共|一共.*[?？]|统计|查一下|查查|看看/.test(text) && amounts(String(text).normalize('NFKC')).length === 0;
}

/** 问句里的时间范围。默认本月。 */
export function periodIn(text, today = todayISO()) {
  const ym = today.slice(0, 7);
  const dow = (new Date(`${today}T12:00:00`).getDay() + 6) % 7; // 周一 = 0
  let m = text.match(/最近\s*(\d+|[一二三四五六七八九十]+)\s*天/);
  if (m) {
    const n = Number(m[1]) || cnNumber(m[1]) || 7;
    return { from: addDays(today, -(n - 1)), to: today, label: `最近 ${n} 天` };
  }
  if (/今天|今日/.test(text)) return { from: today, to: today, label: '今天' };
  if (/昨天|昨日/.test(text)) return { from: addDays(today, -1), to: addDays(today, -1), label: '昨天' };
  if (/上周|上星期|上个星期/.test(text)) return { from: addDays(today, -dow - 7), to: addDays(today, -dow - 1), label: '上周' };
  if (/本周|这周|这个星期|这星期/.test(text)) return { from: addDays(today, -dow), to: today, label: '本周' };
  if (/上个?月/.test(text)) {
    const first = `${ym}-01`;
    const lastPrev = addDays(first, -1);
    return { from: `${lastPrev.slice(0, 7)}-01`, to: lastPrev, label: '上个月' };
  }
  if (/去年/.test(text)) {
    const y = Number(today.slice(0, 4)) - 1;
    return { from: `${y}-01-01`, to: `${y}-12-31`, label: '去年' };
  }
  if (/今年|本年/.test(text)) return { from: `${today.slice(0, 4)}-01-01`, to: today, label: '今年' };
  return { from: `${ym}-01`, to: today, label: '本月' };
}

const ASK_FILLER = /这个月|本月|上个?月|今天|今日|昨天|昨日|本周|这周|上周|这个星期|上个星期|今年|去年|本年|最近\s*\S+?天|一共|总共|花了|花|多少钱|多少次|多少|几次|几笔|了|的|我|在|吗|呢|啊|查一下|查查|看看|统计|[?？，,。.\s]+/g;

/**
 * 回答「这个月打车花了多少」「上周午饭多少钱」。
 * 先按备注里的字找（午饭、打车），找不到再按分类（吃饭→餐饮）。返回 { label, word, cat, total, count, items }。
 */
export function answer(question, expenses, { today = todayISO() } = {}) {
  const text = String(question ?? '').normalize('NFKC');
  const period = periodIn(text, today);
  const word = text.replace(ASK_FILLER, ' ').replace(/\s+/g, ' ').trim();
  const inPeriod = expenses.filter((e) => e.date >= period.from && e.date <= period.to);
  let items = inPeriod;
  let cat = null;
  if (word) {
    const byNote = inPeriod.filter((e) => e.note.includes(word) || word.includes(e.note));
    const guessed = guessCat(word);
    if (byNote.length) items = byNote;
    else if (guessed !== 'other') {
      cat = guessed;
      items = inPeriod.filter((e) => e.cat === guessed);
    } else {
      const named = SPEND_CATS.find((c) => word.includes(c.name));
      cat = named?.key ?? null;
      items = named ? inPeriod.filter((e) => e.cat === named.key) : [];
    }
  }
  const total = items.reduce((n, e) => n + e.fen, 0);
  return { label: period.label, from: period.from, to: period.to, word, cat, total, count: items.length, items: [...items].sort((a, b) => (a.date + a.time < b.date + b.time ? 1 : -1)) };
}

/* ------------------------------ 统计 ------------------------------ */

/** 一段时间内的合计、按分类的合计（从多到少）。 */
export function summarize(expenses, from, to) {
  const list = expenses.filter((e) => e.date >= from && e.date <= to);
  const total = list.reduce((n, e) => n + e.fen, 0);
  const by = new Map();
  for (const e of list) by.set(e.cat, (by.get(e.cat) ?? 0) + e.fen);
  const cats = [...by.entries()].map(([key, fen]) => ({ key, fen, share: total ? fen / total : 0 })).sort((a, b) => b.fen - a.fen);
  return { total, count: list.length, cats, list };
}

/** 新记录的 id。 */
export const spendId = () => `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** 校验并规范化一笔开销（备份恢复、保存时都用）。不合格返回 null。 */
export function cleanExpense(e) {
  if (!e || typeof e !== 'object') return null;
  if (typeof e.id !== 'string' || !e.id) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) return null;
  if (!Number.isSafeInteger(e.fen) || e.fen <= 0) return null;
  return {
    id: e.id,
    date: e.date,
    time: /^\d{2}:\d{2}$/.test(e.time) ? e.time : '12:00',
    fen: e.fen,
    cat: CAT.has(e.cat) ? e.cat : 'other',
    note: String(e.note ?? '').trim().slice(0, 30),
    createdAt: typeof e.createdAt === 'string' ? e.createdAt : new Date().toISOString(),
  };
}
