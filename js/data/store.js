// 应用状态与全部写操作。界面只通过这里读写数据；每个写操作先落盘、成功后才更新内存状态。
import { DEFAULT_CATEGORIES, DEFAULT_SETTINGS, cleanName, enabledCategories, groupKey, groupName, isIconKey, nameKey, newId, nextColorSlot, normalizeGroups, sortedCategories } from '../core/model.js';
import { finalizeSnapshot, findByDate, hasValue } from '../core/ledger.js';
import { checkSnapshot } from '../core/anomalies.js';
import { isISODate } from '../core/date.js';
import { buildPayload } from '../core/backup.js';
import { cleanExpense, spendId } from '../core/spending.js';

const fail = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });

export function createStore(repo, env = {}) {
  const nowIso = env.now ?? (() => new Date().toISOString());
  const mkId = env.newId ?? (() => newId('s'));
  let state = {
    ready: false,
    snapshots: [],
    expenses: [], // 日常开销 { id, date, time, fen, cat, note, createdAt }
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
      // 卡面第 3 版：低调的「墨」成为默认，老用户换一次；之后用户自己改什么就是什么
      if (kv.settings && kv.settings.skinV !== 3) {
        settings.coverSkin = 'ink';
        settings.skinV = 3;
        await repo.setKV('settings', settings).catch(() => {});
      }
      const meta = { lastBackupAt: kv.lastBackupAt ?? null, lockCredential: kv.lockCredential ?? null, persisted: kv.persisted ?? null, preRestore: kv.preRestore ?? null, reportSeen: kv.reportSeen ?? null };
      // 旧数据：把大类名字固定下来（以前借用第一个账户的名字，改账户名会连带改大类名）
      const fixed = normalizeGroups(categories);
      if (JSON.stringify(fixed) !== JSON.stringify(categories)) {
        categories = fixed;
        await repo.setKV('categories', categories).catch(() => {});
      }
      const expenses = (Array.isArray(kv.expenses) ? kv.expenses : []).map(cleanExpense).filter(Boolean);
      set({ ready: true, snapshots, expenses, categories, settings, meta, locked: !!(settings.lockEnabled && meta.lockCredential) });
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
      const next = normalizeGroups(list.map((c, i) => ({ id: c.id, name: cleanName(c.name), enabled: !!c.enabled, order: i, colorSlot: c.colorSlot, ...(c.group ? { group: c.group } : {}), ...(c.group && cleanName(c.groupName) ? { groupName: cleanName(c.groupName).slice(0, 20) } : {}), ...(isIconKey(c.icon) ? { icon: c.icon } : {}), ...(c.debt ? { debt: true } : {}) })));
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
    async addCategory(name, { sameAs = null, debt = false } = {}) {
      const n = cleanName(name);
      const list = sortedCategories(state.categories);
      const base = sameAs ? list.find((c) => c.id === sameAs) : null;
      if (sameAs && !base) return fail('NO_SUCH_CATEGORY', '找不到要添加同类的账户');
      // 同类账户沿用「负债」属性（例如第二张信用卡）
      const cat = { id: newId('c'), name: n, enabled: true, colorSlot: nextColorSlot(list, base?.colorSlot), ...(debt || base?.debt ? { debt: true } : {}) };
      let at = list.length;
      let all = list;
      if (base) {
        // 加入大类：大类名字在这一刻固定下来，之后改哪个账户的名字都不影响它
        const key = groupKey(base);
        const gname = groupName(base, list);
        cat.group = key;
        cat.groupName = gname;
        all = list.map((c) => (groupKey(c) === key ? { ...c, group: key, groupName: gname } : c));
        at = all.reduce((last, c, i) => (groupKey(c) === key ? i : last), -1) + 1;
      }
      const r = await store.saveCategories([...all.slice(0, at), cat, ...all.slice(at)]);
      return r.ok ? { ...r, category: { ...cat } } : r;
    },

    /** 给大类改名（只改大类，不动下面任何一个账户的名字）。 */
    async renameGroup(key, name) {
      const n = cleanName(name);
      if (!n) return fail('EMPTY_NAME', '大类名称不能为空');
      if (n.length > 20) return fail('TOO_LONG', '大类名称最多 20 个字');
      const list = sortedCategories(state.categories);
      if (!list.some((c) => groupKey(c) === key)) return fail('NO_SUCH_GROUP', '找不到这个大类');
      return store.saveCategories(list.map((c) => (groupKey(c) === key ? { ...c, group: key, groupName: n } : c)));
    },

    /**
     * 把一个类别设为 / 取消「负债」。负债的金额在记录里存为负数（总额自然就是净资产）。
     * flipRecords：同时把这个类别已有记录里的金额取相反数——以前把欠款记成正数的，切换后才算得对。
     */
    async setCategoryDebt(id, debt, { flipRecords = false } = {}) {
      const list = sortedCategories(state.categories).map((c) => (c.id === id ? { ...c, debt: !!debt } : c));
      const r = await store.saveCategories(list);
      if (!r.ok) return r;
      if (!flipRecords) return { ok: true, flipped: 0 };
      const changed = state.snapshots
        .filter((s) => hasValue(s.entries[id]) && s.entries[id].fen !== 0)
        .map((s) => ({ ...s, entries: { ...s.entries, [id]: { ...s.entries[id], fen: -s.entries[id].fen } }, updatedAt: nowIso() }));
      if (!changed.length) return { ok: true, flipped: 0 };
      try {
        await repo.putSnapshots(changed);
      } catch (e) {
        await store.saveCategories(sortedCategories(state.categories).map((c) => (c.id === id ? { ...c, debt: !debt } : c)));
        return fail('STORAGE', `保存失败，没有改动任何记录：${e.message}`);
      }
      const byId = new Map(changed.map((s) => [s.id, s]));
      set({ snapshots: state.snapshots.map((s) => byId.get(s.id) ?? s) });
      return { ok: true, flipped: changed.length };
    },

    isCategoryUsed(id) {
      return state.snapshots.some((s) => hasValue(s.entries[id]) || (s.expectedIds ?? []).includes(id));
    },

    /** 有几条记录填过这个类别的金额（删除前用来提示）。 */
    categoryValueCount(id) {
      return state.snapshots.filter((s) => hasValue(s.entries[id])).length;
    },

    /**
     * 删除类别。没有金额的直接删；已有金额的，需要 withRecords:true，
     * 会把它从所有记录里一并移除（这些记录的合计随之变化），然后重新判断每条记录是否完整。
     * 删掉大类里任何一个账户（包括最早那个），其余账户仍在原来的大类里，大类名字不变。
     */
    async deleteCategory(id, { withRecords = false } = {}) {
      const touched = state.snapshots.filter((s) => s.entries[id] || (s.expectedIds ?? []).includes(id));
      if (touched.some((s) => hasValue(s.entries[id])) && !withRecords) return fail('IN_USE', '这个类别已有记录金额');
      const rest = sortedCategories(state.categories).filter((c) => c.id !== id);
      if (!rest.some((c) => c.enabled)) return fail('NONE_ENABLED', '至少要保留一个启用的类别');
      const now = nowIso();
      const changed = touched.map((s) => {
        const entries = { ...s.entries };
        delete entries[id];
        return finalizeSnapshot({ ...s, entries }, (s.expectedIds ?? []).filter((x) => x !== id), { now });
      });
      try {
        if (changed.length) await repo.putSnapshots(changed);
      } catch (e) {
        return fail('STORAGE', `删除失败，没有改动任何数据：${e.message}`);
      }
      const r = await store.saveCategories(rest);
      if (!r.ok) return r;
      if (changed.length) {
        const byId = new Map(changed.map((s) => [s.id, s]));
        set({ snapshots: state.snapshots.map((s) => byId.get(s.id) ?? s) });
      }
      return { ok: true, records: changed.filter((s, i) => hasValue(touched[i].entries[id])).length };
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

    /* ------------------------------ 日常开销 ------------------------------ */

    async saveExpenses(next) {
      try {
        await repo.setKV('expenses', next);
      } catch (e) {
        return fail('STORAGE', `保存失败：${e.message}`);
      }
      set({ expenses: next });
      return { ok: true };
    },

    /** 记下一笔或几笔开销（一句话里拆出来的几笔一起存）。 */
    async addExpenses(items) {
      const now = nowIso();
      const added = items.map((x) => cleanExpense({ ...x, id: spendId(), createdAt: now })).filter(Boolean);
      if (!added.length) return fail('EMPTY', '没有可以记下的金额');
      const r = await store.saveExpenses([...state.expenses, ...added]);
      return r.ok ? { ok: true, added } : r;
    },

    async updateExpense(id, patch) {
      const old = state.expenses.find((e) => e.id === id);
      if (!old) return fail('NOT_FOUND', '这笔开销不存在');
      const next = cleanExpense({ ...old, ...patch, id });
      if (!next) return fail('BAD', '金额或日期无效');
      return store.saveExpenses(state.expenses.map((e) => (e.id === id ? next : e)));
    },

    async deleteExpenses(ids) {
      const gone = state.expenses.filter((e) => ids.includes(e.id));
      const r = await store.saveExpenses(state.expenses.filter((e) => !ids.includes(e.id)));
      if (r.ok) state = { ...state, lastDeletedExpenses: gone };
      return r;
    },

    async undoDeleteExpenses() {
      const gone = state.lastDeletedExpenses ?? [];
      if (!gone.length) return fail('NOTHING', '没有可撤销的删除');
      state = { ...state, lastDeletedExpenses: [] };
      return store.saveExpenses([...state.expenses, ...gone]);
    },

    getBackupPayload() {
      return buildPayload({ categories: sortedCategories(state.categories), settings: state.settings, snapshots: [...state.snapshots].sort((a, b) => (a.date < b.date ? -1 : 1)), expenses: state.expenses });
    },

    /** 用备份整体替换当前数据。恢复前自动保存一份当前数据的安全副本，可撤销。 */
    async restore(payload) {
      const safety = { savedAt: nowIso(), payload: store.getBackupPayload() };
      const settings = { ...DEFAULT_SETTINGS, ...payload.settings, lockEnabled: state.settings.lockEnabled, lockAfterSec: state.settings.lockAfterSec };
      try {
        await repo.replaceAll({
          snapshots: payload.snapshots,
          kv: { categories: payload.categories, settings, preRestore: safety, expenses: payload.expenses ?? [] },
        });
      } catch (e) {
        return fail('STORAGE', `恢复失败，当前数据没有改动：${e.message}`);
      }
      set({ snapshots: payload.snapshots, expenses: payload.expenses ?? [], categories: payload.categories, settings, meta: { ...state.meta, preRestore: safety }, lastDeleted: null });
      return { ok: true, count: payload.snapshots.length };
    },

    async undoRestore() {
      const safety = state.meta.preRestore;
      if (!safety) return fail('NOTHING', '没有可撤销的恢复');
      const p = safety.payload;
      const settings = { ...DEFAULT_SETTINGS, ...p.settings, lockEnabled: state.settings.lockEnabled, lockAfterSec: state.settings.lockAfterSec };
      try {
        await repo.replaceAll({ snapshots: p.snapshots, kv: { categories: p.categories, settings, expenses: p.expenses ?? [] } });
        await repo.deleteKV('preRestore');
      } catch (e) {
        return fail('STORAGE', `撤销失败：${e.message}`);
      }
      set({ snapshots: p.snapshots, expenses: p.expenses ?? [], categories: p.categories, settings, meta: { ...state.meta, preRestore: null } });
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
      set({ snapshots: [], expenses: [], categories, settings: { ...DEFAULT_SETTINGS }, meta: { lastBackupAt: null, lockCredential: null, persisted: state.meta.persisted, preRestore: null }, locked: false, lastDeleted: null });
      return { ok: true };
    },
  };
  return store;
}
