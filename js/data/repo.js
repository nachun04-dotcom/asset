// 本地存储。两个实现、同一套接口：
//   createIdbRepo  —— 浏览器里的 IndexedDB（手机上实际使用）
//   createMemoryRepo —— 内存（测试用）
//
// 接口：loadAll / putSnapshots / deleteSnapshot / setKV / deleteKV / replaceAll
// 所有写入都是原子的：要么全部成功，要么全部不生效。
// 「同一天只能有一条记录」由存储层的唯一索引兜底，哪怕界面层有 bug 也不会写出重复日期。

const DB_NAME = 'asset-ledger';
const DB_VERSION = 1;

const req = (r) =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

const done = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('写入被中止'));
  });

export function openDB(idb = globalThis.indexedDB, name = DB_NAME) {
  return new Promise((resolve, reject) => {
    if (!idb) return reject(new Error('此浏览器不支持本地数据库（IndexedDB）'));
    const open = idb.open(name, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('snapshots')) {
        const s = db.createObjectStore('snapshots', { keyPath: 'id' });
        s.createIndex('date', 'date', { unique: true });
      }
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error('无法打开本地数据库'));
    open.onblocked = () => reject(new Error('数据库被另一个窗口占用，请关闭其他窗口后重试'));
  });
}

export function createIdbRepo(db) {
  return {
    kind: 'indexeddb',
    async loadAll() {
      const tx = db.transaction(['snapshots', 'kv'], 'readonly');
      const [snapshots, kvRows] = await Promise.all([req(tx.objectStore('snapshots').getAll()), req(tx.objectStore('kv').getAll())]);
      const kv = Object.fromEntries(kvRows.map((r) => [r.key, r.value]));
      return { snapshots, kv };
    },
    async putSnapshots(list) {
      const tx = db.transaction('snapshots', 'readwrite');
      const store = tx.objectStore('snapshots');
      for (const s of list) store.put(s);
      await done(tx);
    },
    async deleteSnapshot(id) {
      const tx = db.transaction('snapshots', 'readwrite');
      tx.objectStore('snapshots').delete(id);
      await done(tx);
    },
    async setKV(key, value) {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put({ key, value });
      await done(tx);
    },
    async deleteKV(key) {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').delete(key);
      await done(tx);
    },
    /** 恢复备份用：清空记录并整体写入，原子完成。 */
    async replaceAll({ snapshots, kv }) {
      const tx = db.transaction(['snapshots', 'kv'], 'readwrite');
      const s = tx.objectStore('snapshots');
      s.clear();
      for (const x of snapshots) s.put(x);
      const k = tx.objectStore('kv');
      for (const [key, value] of Object.entries(kv)) k.put({ key, value });
      await done(tx);
    },
    async wipe() {
      const tx = db.transaction(['snapshots', 'kv'], 'readwrite');
      tx.objectStore('snapshots').clear();
      tx.objectStore('kv').clear();
      await done(tx);
    },
  };
}

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

export function createMemoryRepo() {
  let snaps = new Map();
  let kv = new Map();
  const checkUniqueDates = (map) => {
    const seen = new Set();
    for (const s of map.values()) {
      if (seen.has(s.date)) throw new Error(`ConstraintError: 同一天已有记录 ${s.date}`);
      seen.add(s.date);
    }
  };
  return {
    kind: 'memory',
    async loadAll() {
      return { snapshots: [...snaps.values()].map(clone), kv: Object.fromEntries([...kv].map(([k, v]) => [k, clone(v)])) };
    },
    async putSnapshots(list) {
      const next = new Map(snaps);
      for (const s of list) next.set(s.id, clone(s));
      checkUniqueDates(next); // 失败则整体不生效
      snaps = next;
    },
    async deleteSnapshot(id) {
      snaps.delete(id);
    },
    async setKV(key, value) {
      kv.set(key, clone(value));
    },
    async deleteKV(key) {
      kv.delete(key);
    },
    async replaceAll({ snapshots, kv: nextKv }) {
      const next = new Map(snapshots.map((s) => [s.id, clone(s)]));
      checkUniqueDates(next);
      snaps = next;
      for (const [k, v] of Object.entries(nextKv)) kv.set(k, clone(v));
    },
    async wipe() {
      snaps = new Map();
      kv = new Map();
    },
  };
}
