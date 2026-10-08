// 金额工具：内部一律用「人民币分」的整数保存；所有换算都用整数/字符串运算，不经过浮点数。

export const UNITS = Object.freeze({
  yuan: Object.freeze({ id: 'yuan', label: '元', fenPerUnit: 100n, decimals: 2 }),
  wan: Object.freeze({ id: 'wan', label: '万元', fenPerUnit: 1000000n, decimals: 6 }),
});

export const MAX_ABS_FEN = Number.MAX_SAFE_INTEGER; // 约 90 万亿元，远超个人资产

export function unitOf(id) {
  const u = UNITS[id];
  if (!u) throw new Error(`未知单位: ${id}`);
  return u;
}

/** 把用户输入的文本整理成可解析的形式（全角→半角，去掉千分位、空格、货币符号）。 */
export function normalizeAmountText(input) {
  let t = String(input ?? '').normalize('NFKC');
  t = t.replace(/[−–—]/g, '-');
  t = t.replace(/[¥￥\s_]/g, '');
  return t;
}

/**
 * 解析金额文本。
 * @returns {{ok:true, empty:true} | {ok:true, empty?:false, fen:number} | {ok:false, error:'invalid'|'decimals'|'range'}}
 * 空字符串 = 未记录（empty），"0" = 已确认为零（fen:0）。两者绝不混同。
 */
export function parseAmount(input, unitId = 'yuan') {
  const unit = unitOf(unitId);
  let t = normalizeAmountText(input);
  if (t === '') return { ok: true, empty: true };
  // 千分位逗号只接受标准分组（1,234,567），像 1,2 或 1,23,456 这样的写法一律拒绝，避免悄悄读成别的数。
  if (t.includes(',')) {
    if (!/^[+-]?\d{1,3}(,\d{3})+(\.\d*)?$/.test(t)) return { ok: false, error: 'invalid' };
    t = t.replace(/,/g, '');
  }
  const m = /^([+-])?(\d*)(?:\.(\d*))?$/.exec(t);
  if (!m || (m[2] === '' && (m[3] === undefined || m[3] === ''))) return { ok: false, error: 'invalid' };
  let frac = m[3] ?? '';
  if (frac.length > unit.decimals) {
    if (!/^0*$/.test(frac.slice(unit.decimals))) return { ok: false, error: 'decimals' };
    frac = frac.slice(0, unit.decimals);
  }
  frac = frac.padEnd(unit.decimals, '0');
  const big = BigInt(m[2] || '0') * unit.fenPerUnit + BigInt(frac || '0');
  if (big > BigInt(MAX_ABS_FEN)) return { ok: false, error: 'range' };
  const fen = Number(big);
  return { ok: true, fen: m[1] === '-' ? (fen === 0 ? 0 : -fen) : fen };
}

function group3(intStr) {
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 把分格式化为文本（不含符号和单位）。
 * 元：整数元不显示小数，有角分才显示两位。 万元：至少两位小数，最多六位，去掉多余的 0。
 */
export function formatDecimal(fen, unitId = 'yuan', { group = true, minDecimals } = {}) {
  const unit = unitOf(unitId);
  const neg = fen < 0;
  const abs = BigInt(Math.abs(fen));
  const intPart = abs / unit.fenPerUnit;
  let frac = String(abs % unit.fenPerUnit).padStart(unit.decimals, '0');
  frac = frac.replace(/0+$/, '');
  // 元：有角分时固定两位（0.50 而不是 0.5）；输入框用途传 minDecimals:0 保留最短形式。
  const min = minDecimals ?? (unitId === 'wan' ? 2 : frac ? 2 : 0);
  if (frac.length < min) frac = frac.padEnd(min, '0');
  const intStr = group ? group3(String(intPart)) : String(intPart);
  const body = frac ? `${intStr}.${frac}` : intStr;
  return neg && fen !== 0 ? `-${body}` : body;
}

/** 输入框里的文本：ASCII 负号、无千分位，能被 parseAmount 原样解析回同一个值。 */
export function formatForInput(fen, unitId = 'yuan') {
  return formatDecimal(fen, unitId, { group: false, minDecimals: 0 });
}

/** 展示用：¥1,234.50 / 12.35万（负数用真正的减号 −）。 */
export function formatMoney(fen, unitId = 'yuan', { symbol = true, suffix = true } = {}) {
  const unit = unitOf(unitId);
  const text = formatDecimal(Math.abs(fen), unitId);
  const body = `${symbol ? '¥' : ''}${text}${suffix && unitId === 'wan' ? '万' : ''}`;
  return fen < 0 ? `−${body}` : body;
}

/** 带正负号的变化量：+1.30万 / −¥200 / 0 */
export function formatSigned(fen, unitId = 'yuan', opts = {}) {
  if (fen === 0) return '0';
  return `${fen > 0 ? '+' : '−'}${formatMoney(Math.abs(fen), unitId, opts)}`;
}

/** 变化比例（小数，如 0.052 表示 +5.2%）。上一条为 0 时无意义，返回 null。 */
export function changeRatio(cur, prev) {
  if (prev === 0 || prev == null || cur == null) return null;
  return (cur - prev) / Math.abs(prev);
}

export function formatPercent(ratio, { signed = true, digits = 1 } = {}) {
  if (ratio == null || !Number.isFinite(ratio)) return '—';
  const pct = ratio * 100;
  const fixed = Math.abs(pct).toFixed(digits);
  if (Number(fixed) === 0) return `${(0).toFixed(digits)}%`;
  const sign = pct < 0 ? '−' : signed ? '+' : '';
  return `${sign}${fixed}%`;
}

export function sumFen(values) {
  let s = 0;
  for (const v of values) s += v;
  return s;
}
