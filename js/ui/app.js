// 应用外壳：底部标签栏、路由、锁屏覆盖层、外观设置。
import { h, icon } from './dom.js';
import { closeAllSheets } from './components.js';
import { buildHome } from './screens/home.js';
import { buildHistory } from './screens/history.js';
import { buildImport } from './screens/importHub.js';
import { buildSettings } from './screens/settings.js';
import { openEntry } from './screens/entry.js';
import { openDetail } from './screens/detail.js';
import { buildLockScreen } from './lock.js';

const ROUTES = {
  home: { hash: '#/', label: '首页', icon: 'home', build: buildHome },
  history: { hash: '#/history', label: '历史', icon: 'ledger', build: buildHistory },
  import: { hash: '#/import', label: '导入', icon: 'download', build: buildImport },
  settings: { hash: '#/settings', label: '设置', icon: 'sliders', build: buildSettings },
};

export function routeFromHash(hash) {
  const key = String(hash || '').replace(/^#\/?/, '').split('?')[0];
  return ROUTES[key] ? key : 'home';
}

const THEME_COLOR = { light: '#eff3f0', dark: '#0d1311' };

export function applyAppearance(settings) {
  const root = document.documentElement;
  if (settings.theme === 'light' || settings.theme === 'dark') root.setAttribute('data-theme', settings.theme);
  else root.removeAttribute('data-theme');
  root.setAttribute('data-rise', settings.riseColor === 'green' ? 'green' : 'red');
  // 手动选了浅色/深色时，让状态栏颜色跟着变；跟随系统时保持 index.html 里按系统外观设置的两条
  const fixed = document.querySelector('meta[name="theme-color"][data-fixed]');
  const auto = document.querySelectorAll('meta[name="theme-color"][media]');
  if (settings.theme === 'light' || settings.theme === 'dark') {
    auto.forEach((m) => m.setAttribute('content', THEME_COLOR[settings.theme]));
  } else {
    auto.forEach((m) => m.setAttribute('content', m.getAttribute('media').includes('dark') ? THEME_COLOR.dark : THEME_COLOR.light));
  }
  void fixed;
}

export function mountApp(rootEl, store, env = {}) {
  const view = h('main', { class: 'screen', id: 'main' });
  const tabs = {};
  const tabEls = Object.entries(ROUTES).map(([key, r]) => {
    const a = h('a', { class: 'tab', href: r.hash }, icon(r.icon, { size: 22 }), r.label);
    tabs[key] = a;
    return a;
  });
  const fab = h('button', { type: 'button', class: 'fab', 'aria-label': '记一笔', onClick: () => ctx.nav.openEntry({}) }, icon('plus', { size: 28, stroke: 2.2 }));
  const bar = h('nav', { class: 'tabbar', 'aria-label': '主导航' }, h('div', { class: 'tabbar-inner' }, tabEls[0], tabEls[1], h('div', { class: 'tab-fab' }, fab), tabEls[2], tabEls[3]));
  const app = h('div', { class: 'app' }, view, bar);
  rootEl.replaceChildren(app);

  const ctx = { store, repoKind: env.repoKind ?? 'indexeddb', nav: {} };
  let current = null;
  let pending = {};

  function render() {
    const key = routeFromHash(location.hash);
    current?.destroy?.();
    const r = ROUTES[key];
    const built = r.build(ctx, pending);
    pending = {};
    current = built;
    view.replaceChildren(built.el);
    for (const [k, a] of Object.entries(tabs)) {
      if (k === key) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    document.title = key === 'home' ? '资产账本' : `${r.label} · 资产账本`;
  }

  ctx.nav = {
    goto(route, opts = {}) {
      pending = opts;
      const target = ROUTES[route]?.hash ?? '#/';
      if (location.hash === target || (target === '#/' && (location.hash === '' || location.hash === '#'))) {
        render();
        if (!opts.focus) window.scrollTo(0, 0);
      } else {
        location.hash = target;
      }
    },
    openEntry: (o) => openEntry(ctx, o),
    openDetail: (id) => openDetail(ctx, id),
  };

  window.addEventListener('hashchange', async () => {
    await closeAllSheets();
    render();
    window.scrollTo(0, 0);
  });
  render();

  // 锁屏覆盖层
  let lockEl = null;
  const syncLock = (st) => {
    if (st.locked && !lockEl) {
      closeAllSheets(); // 锁定时收起所有抽屉，解锁后回到干净的界面
      lockEl = buildLockScreen(store);
      document.body.appendChild(lockEl);
      app.setAttribute('inert', '');
      document.getElementById('layer')?.setAttribute('inert', '');
    } else if (!st.locked && lockEl) {
      lockEl.remove();
      lockEl = null;
      app.removeAttribute('inert');
      document.getElementById('layer')?.removeAttribute('inert');
    }
  };
  store.subscribe(syncLock);
  syncLock(store.state);
  return ctx;
}
