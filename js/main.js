// 启动：打开本地数据库 → 读取数据 → 显示界面 → 注册离线缓存。
import { createIdbRepo, createMemoryRepo, openDB } from './data/repo.js';
import { createStore } from './data/store.js';
import { applyAppearance, mountApp } from './ui/app.js';
import { button, toast } from './ui/components.js';
import { h } from './ui/dom.js';

const root = document.getElementById('app');

function fatal(title, text, actions = []) {
  root.replaceChildren(h('main', { class: 'screen' }, h('div', { class: 'empty' }, h('h2', {}, title), h('p', {}, text), h('div', { class: 'actions' }, ...actions))));
}

async function openRepo() {
  for (;;) {
    try {
      return { repo: createIdbRepo(await openDB()), kind: 'indexeddb' };
    } catch (e) {
      const choice = await new Promise((resolve) =>
        fatal('无法打开本机数据库', `${e.message}。常见原因：浏览器的「无痕/私密模式」，或存储被禁用。换成普通模式打开，或把 App 添加到主屏幕后再试。`, [
          button('重试', () => resolve('retry'), { block: true }),
          button('临时使用（关闭后数据会丢失）', () => resolve('memory'), { block: true, kind: 'secondary' }),
        ]),
      );
      if (choice === 'memory') return { repo: createMemoryRepo(), kind: 'memory' };
    }
  }
}

function registerServiceWorker() {
  const ok = 'serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname));
  if (!ok) return;
  navigator.serviceWorker
    .register('./sw.js')
    .then((reg) => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw?.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) toast('新版本已下载好，下次打开 App 时生效', { ms: 7000 });
        });
      });
    })
    .catch(() => {});
}

function watchPersistence(store) {
  if (!navigator.storage?.persist) return;
  let tried = false;
  const tryPersist = async () => {
    if (tried || store.state.snapshots.length === 0) return;
    tried = true;
    try {
      const already = await navigator.storage.persisted();
      const ok = already || (await navigator.storage.persist());
      if (ok !== store.state.meta.persisted) await store.setMeta('persisted', !!ok);
    } catch {
      /* 不影响使用 */
    }
  };
  setTimeout(tryPersist, 3000);
  store.subscribe(() => tryPersist());
}

function watchLock(store) {
  let hiddenAt = null;
  document.addEventListener('visibilitychange', () => {
    const { settings, meta } = store.state;
    const armed = settings.lockEnabled && meta.lockCredential;
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      if (armed) document.body.classList.add('covered'); // 切换应用时的预览画面不露出金额
    } else {
      document.body.classList.remove('covered');
      if (armed && hiddenAt != null && (Date.now() - hiddenAt) / 1000 >= settings.lockAfterSec) store.lock();
      hiddenAt = null;
    }
  });
}

async function boot() {
  const { repo, kind } = await openRepo();
  const store = createStore(repo);
  try {
    await store.init();
  } catch (e) {
    fatal('读取数据时出错', `${e.message}。你的数据没有被改动，请关闭后重新打开；如果问题一直存在，请不要清除网站数据，先联系开发者。`);
    return;
  }
  applyAppearance(store.state.settings);
  store.subscribe((st) => applyAppearance(st.settings));
  mountApp(root, store, { repoKind: kind });
  if (kind === 'memory') toast('临时模式：关闭后数据不会保留，请及时导出备份', { ms: 8000 });
  registerServiceWorker();
  watchPersistence(store);
  watchLock(store);
  window.__ledger = { store }; // 方便在浏览器控制台排查问题（只读用途）
}

boot().catch((e) => fatal('启动失败', String(e?.message ?? e)));
