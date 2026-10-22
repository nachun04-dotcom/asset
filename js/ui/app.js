// 应用外壳：底部标签栏、路由、锁屏覆盖层、外观设置。
import { h, icon } from './dom.js';
import { configure as configureFeedback, fx, unlockAudio } from './feedback.js';
import { closeAllSheets } from './components.js';
import { buildHome } from './screens/home.js';
import { buildAnalysis } from './screens/analysis.js';
import { buildHistory } from './screens/history.js';
import { buildSpend } from './screens/spend.js';
import { openSpend } from './spend.js';
import { buildImport } from './screens/importHub.js';
import { buildSettings } from './screens/settings.js';
import { openEntry } from './screens/entry.js';
import { openDetail } from './screens/detail.js';
import { buildLockScreen } from './lock.js';
import { setTilt } from './tilt.js';
import { skinOf } from '../core/model.js';

// 底部标签栏：首页 · 开销 · ＋ · 分析 · 设置。「历史」从分析页进入，「导入」从设置页进入（parent 决定高亮哪个标签）。
const ROUTES = {
  home: { hash: '#/', label: '首页', icon: 'home', build: buildHome },
  spend: { hash: '#/spend', label: '开销', icon: 'receipt', build: buildSpend },
  analysis: { hash: '#/analysis', label: '分析', icon: 'pie', build: buildAnalysis },
  history: { hash: '#/history', label: '历史', icon: 'ledger', build: buildHistory, parent: 'analysis' },
  settings: { hash: '#/settings', label: '设置', icon: 'sliders', build: buildSettings },
  import: { hash: '#/import', label: '导入', icon: 'download', build: buildImport, parent: 'settings' },
};

export function routeFromHash(hash) {
  const key = String(hash || '').replace(/^#\/?/, '').split('?')[0];
  return ROUTES[key] ? key : 'home';
}

const THEME_COLOR = { light: '#f5f1e8', dark: '#0b0a08' };

export function applyAppearance(settings) {
  const root = document.documentElement;
  if (settings.theme === 'light' || settings.theme === 'dark') root.setAttribute('data-theme', settings.theme);
  else root.removeAttribute('data-theme');
  root.setAttribute('data-rise', settings.riseColor === 'green' ? 'green' : 'red');
  root.toggleAttribute('data-mask', !!settings.hideAmounts); // 隐私模式：样式里统一模糊 .mask 金额
  root.setAttribute('data-skin', skinOf(settings)); // 封面卡面
  setTilt(!!settings.tilt);
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
  const tabEls = Object.entries(ROUTES).filter(([, r]) => !r.parent).map(([key, r]) => {
    const a = h('a', { class: 'tab', href: r.hash }, icon(r.icon, { size: 22 }), r.label);
    tabs[key] = a;
    return a;
  });
  // ＋：最常用的是记日常开销；更新资产余额在首页的大按钮和记开销面板里都能进
  const fab = h('button', { type: 'button', class: 'fab', 'aria-label': '记一笔开销', onClick: () => openSpend(ctx) }, icon('plus', { size: 28, stroke: 2.2 }));
  const bar = h('nav', { class: 'tabbar', 'aria-label': '主导航' }, h('div', { class: 'tabbar-inner' }, tabEls[0], tabEls[1], h('div', { class: 'tab-fab' }, fab), tabEls[2], tabEls[3]));
  const app = h('div', { class: 'app' }, view, bar);
  rootEl.replaceChildren(app);

  const ctx = { store, repoKind: env.repoKind ?? 'indexeddb', nav: {} };

  // 操作反馈：跟随设置里的开关；所有按钮、导航、开关统一给轻触感和按键声（金额键盘、拖动把手有自己的反馈）
  const syncFeedback = (st) => configureFeedback({ sound: st.settings.sound !== false, haptics: st.settings.haptics !== false });
  syncFeedback(store.state);
  store.subscribe(syncFeedback);
  unlockAudio();
  document.addEventListener(
    'click',
    (e) => {
      const t = e.target;
      if (!(t instanceof Element) || t.closest('.amount-pad, .drag-handle, .switch')) return;
      if (t.closest('.seg button')) return fx.select();
      if (t.closest('button:not(:disabled), a[href], [role="button"], label.date-chip')) fx.tap();
    },
    true,
  );
  document.addEventListener('change', (e) => e.target instanceof Element && e.target.closest('.switch') && fx.select(), true);
  let current = null;
  let pending = {};

  function render() {
    const key = routeFromHash(location.hash);
    current?.destroy?.();
    const r = ROUTES[key];
    const built = r.build(ctx, pending);
    pending = {};
    current = built;
    view.dataset.route = key; // 样式按页面切换标题上方的小字
    view.replaceChildren(built.el);
    // 切换页面时内容依次浮现（只在切换那一刻播放；之后数据刷新重画不会再动）
    view.classList.remove('enter');
    void view.offsetWidth;
    view.classList.add('enter');
    clearTimeout(render.t);
    render.t = setTimeout(() => view.classList.remove('enter'), 950);
    for (const [k, a] of Object.entries(tabs)) {
      if (k === key || k === r.parent) a.setAttribute('aria-current', 'page');
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
