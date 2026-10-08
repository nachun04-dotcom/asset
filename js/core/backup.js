// 完整备份：一个可恢复的 JSON 文件，可选用密码加密（PBKDF2-SHA-256 + AES-256-GCM，全部由系统自带的 WebCrypto 完成）。
// 恢复时会严格校验每一条数据；校验失败就拒绝恢复，绝不写入半截数据。

import { APP_FORMAT, DEFAULT_SETTINGS, SCHEMA_VERSION } from './model.js';
import { hasValue, isComplete } from './ledger.js';
import { isISODate } from './date.js';

const te = new TextEncoder();
const td = new TextDecoder();

export const MIN_PASSWORD_LENGTH = 6;
export const DEFAULT_KDF_ITERATIONS = 600_000;

export function toB64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** key 排序后的 JSON：同一份数据永远得到同一个字符串，用来算校验和。 */
export function canonicalJSON(v) {
  if (Array.isArray(v)) return `[${v.map(canonicalJSON).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .filter((k) => v[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJSON(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

export async function sha256Hex(text) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(text)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 备份内容。设备锁凭据只属于这台设备，不进备份。 */
export function buildPayload({ categories, settings, snapshots }) {
  const { lockEnabled, lockAfterSec, ...portable } = settings;
  return { schemaVersion: SCHEMA_VERSION, categories, settings: portable, snapshots };
}

async function deriveKey(password, salt, iterations, usage) {
  const material = await crypto.subtle.importKey('raw', te.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, { name: 'AES-GCM', length: 256 }, false, usage);
}

const aad = (h) => te.encode(canonicalJSON({ format: h.format, version: h.version, createdAt: h.createdAt, kdf: h.kdf, iv: h.cipher.iv }));

/** 生成备份文件文本。password 为空 = 不加密。 */
export async function createBackup(payload, { password = '', iterations = DEFAULT_KDF_ITERATIONS, now = new Date().toISOString() } = {}) {
  const checksum = await sha256Hex(canonicalJSON(payload));
  if (!password) {
    return JSON.stringify({ format: APP_FORMAT, version: 1, createdAt: now, encrypted: false, checksum, payload }, null, 1);
  }
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`密码至少 ${MIN_PASSWORD_LENGTH} 位`);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const header = {
    format: APP_FORMAT,
    version: 1,
    createdAt: now,
    encrypted: true,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toB64(salt) },
    cipher: { name: 'AES-GCM', iv: toB64(iv) },
  };
  const key = await deriveKey(password, salt, iterations, ['encrypt']);
  const plain = te.encode(canonicalJSON({ payload, checksum }));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(header) }, key, plain));
  return JSON.stringify({ ...header, ciphertext: toB64(ct) });
}

const fail = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });

/** 读取备份文本。返回 {ok:true, payload, meta} 或 {ok:false, code, message}。 */
export async function openBackup(text, { password = '' } = {}) {
  let file;
  try {
    file = JSON.parse(text);
  } catch {
    return fail('NOT_BACKUP', '这不是资产账本的备份文件（无法读取内容）');
  }
  if (!file || file.format !== APP_FORMAT) return fail('NOT_BACKUP', '这不是资产账本的备份文件');
  if (typeof file.version !== 'number' || file.version > 1) return fail('NEWER_VERSION', '备份文件来自更新版本的 App，请先更新 App 再恢复');

  let inner;
  if (file.encrypted) {
    if (!password) return fail('NEED_PASSWORD', '这个备份已加密，请输入密码');
    try {
      const { kdf, cipher } = file;
      if (kdf?.name !== 'PBKDF2' || cipher?.name !== 'AES-GCM' || !Number.isInteger(kdf.iterations) || kdf.iterations < 1000 || kdf.iterations > 10_000_000) {
        return fail('CORRUPT', '备份文件的加密参数无效');
      }
      const key = await deriveKey(password, fromB64(kdf.salt), kdf.iterations, ['decrypt']);
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(cipher.iv), additionalData: aad(file) }, key, fromB64(file.ciphertext));
      inner = JSON.parse(td.decode(plain));
    } catch {
      return fail('BAD_PASSWORD', '密码不对，或备份文件已损坏');
    }
  } else {
    inner = { payload: file.payload, checksum: file.checksum };
  }
  if (!inner?.payload || typeof inner.checksum !== 'string') return fail('CORRUPT', '备份文件内容不完整');
  if ((await sha256Hex(canonicalJSON(inner.payload))) !== inner.checksum) return fail('CORRUPT', '备份文件校验失败，内容可能已被修改或损坏');

  const v = validatePayload(inner.payload);
  if (!v.ok) return fail('INVALID', `备份内容有问题：${v.errors.slice(0, 5).join('；')}`, { errors: v.errors });
  return { ok: true, payload: v.payload, summary: v.summary, meta: { createdAt: file.createdAt, encrypted: !!file.encrypted } };
}

/** 严格校验并规范化。任何一处不合格都返回 ok:false，不做「尽量修复」。 */
export function validatePayload(p) {
  const errors = [];
  const err = (m) => errors.length < 30 && errors.push(m);
  if (!p || typeof p !== 'object') return { ok: false, errors: ['缺少数据'] };
  if (!Number.isInteger(p.schemaVersion) || p.schemaVersion < 1 || p.schemaVersion > SCHEMA_VERSION) err(`数据版本 ${p.schemaVersion} 不受支持`);

  const categories = [];
  const catIds = new Set();
  if (!Array.isArray(p.categories) || p.categories.length === 0) err('没有类别');
  for (const c of Array.isArray(p.categories) ? p.categories : []) {
    if (!c || typeof c.id !== 'string' || !c.id || typeof c.name !== 'string' || !c.name.trim()) {
      err('有类别缺少 id 或名称');
      continue;
    }
    if (catIds.has(c.id)) err(`类别 id 重复：${c.id}`);
    catIds.add(c.id);
    categories.push({ id: c.id, name: c.name.trim(), enabled: c.enabled !== false, order: Number.isFinite(c.order) ? c.order : categories.length, colorSlot: Number.isInteger(c.colorSlot) ? c.colorSlot : categories.length, ...(typeof c.group === 'string' && c.group ? { group: c.group } : {}) });
  }
  // 同类账户的归属必须指向一个真实存在的类别，否则当作独立类别（不报错，也不丢数据）
  for (const c of categories) if (c.group && (!catIds.has(c.group) || c.group === c.id)) delete c.group;

  const settings = { ...DEFAULT_SETTINGS };
  const s = p.settings && typeof p.settings === 'object' ? p.settings : {};
  if (s.unit === 'yuan' || s.unit === 'wan') settings.unit = s.unit;
  if (Number.isFinite(s.changeThresholdPct) && s.changeThresholdPct > 0 && s.changeThresholdPct <= 1000) settings.changeThresholdPct = s.changeThresholdPct;
  if (s.riseColor === 'red' || s.riseColor === 'green') settings.riseColor = s.riseColor;
  if (['auto', 'light', 'dark'].includes(s.theme)) settings.theme = s.theme;
  if (Number.isInteger(s.backupRemindDays) && s.backupRemindDays >= 1 && s.backupRemindDays <= 365) settings.backupRemindDays = s.backupRemindDays;

  const snapshots = [];
  const ids = new Set();
  const dates = new Set();
  if (!Array.isArray(p.snapshots)) err('缺少记录列表');
  for (const r of Array.isArray(p.snapshots) ? p.snapshots : []) {
    const label = r?.date ?? '?';
    if (!r || typeof r.id !== 'string' || !r.id) {
      err('有记录缺少 id');
      continue;
    }
    if (ids.has(r.id)) err(`记录 id 重复：${r.id}`);
    ids.add(r.id);
    if (!isISODate(r.date)) err(`记录日期无效：${label}`);
    else if (dates.has(r.date)) err(`同一天有多条记录：${r.date}`);
    dates.add(r.date);
    const entries = {};
    for (const [cid, e] of Object.entries(r.entries && typeof r.entries === 'object' ? r.entries : {})) {
      if (!catIds.has(cid)) {
        err(`${label} 的记录引用了不存在的类别：${cid}`);
        continue;
      }
      if (!e || !Number.isSafeInteger(e.fen)) {
        err(`${label} 的金额不是有效整数：${cid}`);
        continue;
      }
      entries[cid] = { fen: e.fen };
      if (e.fx) {
        if (typeof e.fx.currency === 'string' && typeof e.fx.original === 'string') entries[cid].fx = { currency: e.fx.currency, original: e.fx.original };
        else err(`${label} 的币种信息无效：${cid}`);
      }
    }
    const expectedIds = Array.isArray(r.expectedIds) ? r.expectedIds.filter((x) => typeof x === 'string') : [];
    for (const x of expectedIds) if (!catIds.has(x)) err(`${label} 的应有类别不存在：${x}`);
    const stamp = (v) => (typeof v === 'string' && v ? v : new Date(0).toISOString());
    snapshots.push({
      id: r.id,
      date: r.date,
      note: typeof r.note === 'string' ? r.note : '',
      source: typeof r.source === 'string' ? r.source : 'backup',
      createdAt: stamp(r.createdAt),
      updatedAt: stamp(r.updatedAt),
      entries,
      expectedIds,
      complete: isComplete(entries, expectedIds), // 不信任文件里的 complete，按数据重新计算
    });
  }
  if (errors.length) return { ok: false, errors };
  snapshots.sort((a, b) => (a.date < b.date ? -1 : 1));
  const summary = { snapshots: snapshots.length, categories: categories.length, from: snapshots[0]?.date ?? null, to: snapshots[snapshots.length - 1]?.date ?? null, values: snapshots.reduce((n, x) => n + Object.values(x.entries).filter(hasValue).length, 0) };
  return { ok: true, errors, payload: { schemaVersion: p.schemaVersion, categories, settings, snapshots }, summary };
}
