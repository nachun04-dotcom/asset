// 应用状态与全部写操作。界面只通过这里读写数据；每个写操作先落盘、成功后才更新内存状态。
import { DEFAULT_CATEGORIES, DEFAULT_SETTINGS, cleanName, enabledCategories, groupKey, isIconKey, nameKey, newId, nextColorSlot, sortedCategories } from '../core/model.js';
import { finalizeSnapshot, findByDate, hasValue } from '../core/ledger.js';
import { checkSnapshot } from '../core/anomalies.js';
import { isISODate } from '../core/date.js';
import { buildPayload } from '../core/backup.js';

const fail = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });

export function createStore(repo, env = {}) {
  const nowIso = env.now ?? (() => new Date().toISOString());
  const mkId = env.newId ?? (() => newId('s'));
  let state = {
    ready: false,
    snapshots: [],
    categories: [],
    settings: { ...DEFAULT_SETTINGS },
    meta: { lastBackupAt: null, lockCredential: null, persisted: null, preRestore: null },
    locked: false,
    lastDeleted: null,
  };
  const listeners = new Set();
  const set = (patch) => {
    state = { ...state, ...patch };
    for (const fn of listeners) fn(state);
  };

  const issuesFor = (snap, snaps = state.snapshots) => checkSnapshot(snap, { categories: state.categories, snaps, unit: state.settings.unit, thresholdPct: state.settings.changeThresholdPct });

  const store = {
    get state() {
      return state;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    async init() {
      const { snapshots, kv } = await repo.loadAll();
      let categories = kv.categories;
      if (!Array.isArray(categories) || categories.length === 0) {
        categories = DEFAULT_CATEGORIES.map((c) => ({ ...c }));
        await repo.setKV('categories', categories);
      }
      const settings = { ...DEFAULT_SETTINGS, ...(kv.settings ?? {}) };
      const meta = { lastBackupAt: kv.lastBackupAt ?? null, lockCredential: kv.lockCredential ?? null, persisted: kv.persisted ?? null, preRestore: kv.preRestore ?? null };
      set({ ready: true, snapshots, categories, settings, meta, locked: !!(settings.lockEnabled && meta.lockCredential) });
      return state;
    },

    /** 新增或修改一条快照。同一天已有别的记录时不会覆盖，而是返回 DUP_DATE。 */
    async saveSnapshot(form) {
      if (!isISODate(form.date)) return fail('BAD_DATE', '日期无效');
      const existingOnDate = findByDate(state.snapshots, form.date);
      if (existingOnDate && existingOnDate.id !== form.id) return fail('DUP_DATE', '这一天已经有记录了', { existing: existingOnDate });
      const old = form.id ? state.snapshots.find((s) => s.id === form.id) : null;
      if (form.id && !old) return fail('NOT_FOUND', '要修改的记录不存在');
      const withValue = Object.keys(form.entries ?? {}).filter((id) => hasValue(form.entries[id]));
      // 新记录：应有类别 = 当前启用的类别；修改旧记录：保持它原有的口径，只追加这次填了金额的类别
      const expected = old ? [...new Set([...(old.expectedIds ?? []), ...withValue])] : enabledCategories(state.categories).map((c) => c.id);
      const snap = finalizeSnapshot(
        { id: old?.id ?? mkId(), date: form.date, note: form.note ?? '', source: old?.source ?? form.source ?? 'manual', createdAt: old?.createdAt, entries: form.entries ?? {} },
        expected,
        { now: nowIso() },
      );
      try {
        await repo.putSnapshots([snap]);
      } catch (e) {
        return fail('STORAGE', `保存失败：${e.message}`);
      }
      const snapshots = old ? state.snapshots.map((s) => (s.id === snap.id ? snap : s)) : [...state.snapshots, snap];
      set({ snapshots });
      return { ok: true, snapshot: snap, issues: issuesFor(snap, snapshots) };
    },

    async deleteSnapshot(id) {
      const snap = state.snapshots.find((s) => s.id === id);
      if (!snap) return fail('NOT_FOUND', '记录不存在');
      try {
        await repo.deleteSnapshot(id);
      } catch (e) {
        return fail('STORAGE', `删除失败：${e.message}`);
      }
      set({ snapshots: state.snapshots.filter((s) => s.id !== id), lastDeleted: snap });
      return { ok: true, snapshot: snap };
    },

    /** 撤销刚才的删除（那一天已经有新记录时拒绝）。 */
    async undoDelete() {
      const snap = state.lastDeleted;
      if (!snap) return fail('NOTHING', '没有可撤销的删除');
      if (findByDate(state.snapshots, snap.date)) return fail('DUP_DATE', '这一天已经有新记录，无法撤销');
      try {
        await repo.putSnapshots([snap]);
      } catch (e) {
        return fail('STORAGE', `撤销失败：${e.message}`);
      }
      set({ snapshots: [...state.snapshots, snap], lastDeleted: null });
      return { ok: true, snapshot: snap };
    },

    /** 导入确认后一次性写入（原子）。 */
    async commitImport(upserts) {
      if (!upserts.length) return fail('EMPTY', '没有需要保存的记录');
      try {
        await repo.putSnapshots(upserts);
      } catch (e) {
        return fail('STORAGE', `导入失败，没有写入任何记录：${e.message}`);
      }
      const byId = new Map(state.snapshots.map((s) => [s.id, s]));
      for (const s of upserts) byId.set(s.id, s);
      set({ snapshots: [...byId.values()] });
      return { ok: true, count: upserts.length };
    },

    /* ------------------------------ 类别 ------------------------------ */

    async saveCategories(list) {
      const names = new Set();
      for (const c of list) {
        const n = cleanName(c.name);
        if (!n) return fail('EMPTY_NAME', '类别名称不能为空');
        if (names.has(nameKey(n))) return fail('DUP_NAME', `类别名称重复：${n}`);
        names.add(nameKey(n));
      }
      if (!list.some((c) => c.enabled)) return fail('NONE_ENABLED', '至少要启用一个类别');
      const next = list.map((c, i) => ({ id: c.id, name: cleanName(c.name), enabled: !!c.enabled, order: i, colorSlot: c.colorSlot, ...(c.group ? { group: c.group } : {}), ...(isIconKey(c.icon) ? { icon: c.icon } : {}) }));
      try {
        await repo.setKV('categories', next);
      } catch (e) {
        return fail('STORAGE', `保存失败：${e.message}`);
      }
      set({ categories: next });
      return { ok: true };
    },

    /**
     * 新增类别。传入 sameAs（已有类别的 id）时，作为它的「同类账户」：
     * 排在同类最后一个的后面，归到同一类；8 个颜色槽用完时沿用同类的颜色。
     */
    async addCategory(name, { sameAs = null } = {}) {
      const n = cleanName(name);
      const list = sortedCategories(state.categories);
      const base = sameAs ? list.find((c) => c.id === sameAs) : null;
      if (sameAs && !base) return fail('NO_SUCH_CATEGORY', '找不到要添加同类的账户');
      const cat = { id: newId('c'), name: n, enabled: true, colorSlot: nextColorSlot(list, base?.colorSlot) };
      let at = list.length;
      if (base) {
        cat.group = groupKey(base);
        at = list.reduce((last, c, i) => (groupKey(c) === cat.group ? i : last), -1) + 1;
      }
      const r = await store.saveCategories([...list.slice(0, at), cat, ...list.slice(at)]);
      return r.ok ? { ...r, category: { ...cat } } : r;
    },

    isCategoryUsed(id) {
      return state.snapshots.some((s) => hasValue(s.entries[id]) || (s.expectedIds ?? []).includes(id));
    },

    /** 只能删除从未被任何记录使用的类别；否则请改为「停用」。 */
    async deleteCategory(id) {
      if (store.isCategoryUsed(id)) return fail('IN_USE', '这个类别已有历史记录，不能删除，请改为「停用」');
      return store.saveCategories(sortedCategories(state.categories).filter((c) => c.id !== id));
    },

    /* ------------------------------ 设置与元数据 ------------------------------ */

    async updateSettings(patch) {
      const next = { ...state.settings, ...patch };
      if (!['yuan', 'wan'].includes(next.unit)) return fail('BAD_SETTING', '单位无效');
      if (!(next.changeThresholdPct > 0 && next.changeThresholdPct <= 1000)) return fail('BAD_SETTING', '提醒阈值需要是 0 到 1000 之间的数');
      try {
        await repo.setKV('settings', next);
      } catch (e) {
        return fail('STORAGE', `保存失败：${e.message}`);
      }
      set({ settings: next });
      return { ok: true };
    },

    async setMeta(key, value) {
      try {
        if (value == null) await repo.deleteKV(key);
        else await repo.setKV(key, value);
      } catch (e) {
        return fail('STORAGE', e.message);
      }
      set({ meta: { ...state.meta, [key]: value ?? null } });
      return { ok: true };
    },

    markBackedUp() {
      return store.setMeta('lastBackupAt', nowIso());
    },

    lock() {
      if (state.settings.lockEnabled && state.meta.lockCredential) set({ locked: true });
    },
    unlock() {
      set({ locked: false });
    },

    /* ------------------------------ 备份 / 恢复 ------------------------------ */

    getBackupPayload() {
      return buildPayload({ categories: sortedCategories(state.categories), settings: state.settings, snapshots: [...state.snapshots].sort((a, b) => (a.date < b.date ? -1 : 1)) });
    },

    /** 用备份整体替换当前数据。恢复前自动保存一份当前数据的安全副本，可撤销。 */
    async restore(payload) {
      const safety = { savedAt: nowIso(), payload: store.getBackupPayload() };
      const settings = { ...DEFAULT_SETTINGS, ...payload.settings, lockEnabled: state.settings.lockEnabled, lockAfterSec: state.settings.lockAfterSec };
      try {
        await repo.replaceAll({
          snapshots: payload.snapshots,
          kv: { categories: payload.categories, settings, preRestore: safety },
        });
      } catch (e) {
        return fail('STORAGE', `恢复失败，当前数据没有改动：${e.message}`);
      }
      set({ snapshots: payload.snapshots, categories: payload.categories, settings, meta: { ...state.meta, preRestore: safety }, lastDeleted: null });
      return { ok: true, count: payload.snapshots.length };
    },

    async undoRestore() {
      const safety = state.meta.preRestore;
      if (!safety) return fail('NOTHING', '没有可撤销的恢复');
      const p = safety.payload;
      const settings = { ...DEFAULT_SETTINGS, ...p.settings, lockEnabled: state.settings.lockEnabled, lockAfterSec: state.settings.lockAfterSec };
      try {
        await repo.replaceAll({ snapshots: p.snapshots, kv: { categories: p.categories, settings } });
        await repo.deleteKV('preRestore');
      } catch (e) {
        return fail('STORAGE', `撤销失败：${e.message}`);
      }
      set({ snapshots: p.snapshots, categories: p.categories, settings, meta: { ...state.meta, preRestore: null } });
      return { ok: true };
    },

    async wipeAll() {
      try {
        await repo.wipe();
      } catch (e) {
        return fail('STORAGE', e.message);
      }
      const categories = DEFAULT_CATEGORIES.map((c) => ({ ...c }));
      await repo.setKV('categories', categories);
      set({ snapshots: [], categories, settings: { ...DEFAULT_SETTINGS }, meta: { lastBackupAt: null, lockCredential: null, persisted: state.meta.persisted, preRestore: null }, locked: false, lastDeleted: null });
      return { ok: true };
    },
  };
  return store;
}
