// 离线缓存（由 scripts/build-sw.mjs 生成 app/sw.js —— 不要直接改生成出来的文件）。
// 策略：安装时把整个 App 存进本机缓存；之后一律先用缓存，所以断网、飞行模式下也能打开。
// 不会请求任何其他网站；新版本下载好后，等所有窗口关闭、再次打开时才会生效（不会在你录入到一半时换掉代码）。
const VERSION = 'a68b6e64e2b1';
const CACHE = `asset-ledger-${VERSION}`;
const CORE = [
  "./",
  "./css/app.css",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./index.html",
  "./js/core/anomalies.js",
  "./js/core/backup.js",
  "./js/core/csv.js",
  "./js/core/csvExport.js",
  "./js/core/date.js",
  "./js/core/importPlan.js",
  "./js/core/ledger.js",
  "./js/core/model.js",
  "./js/core/money.js",
  "./js/core/tabular.js",
  "./js/core/textImport.js",
  "./js/core/xlsx.js",
  "./js/data/repo.js",
  "./js/data/store.js",
  "./js/features.js",
  "./js/main.js",
  "./js/ocr.js",
  "./js/platform.js",
  "./js/ui/app.js",
  "./js/ui/charts.js",
  "./js/ui/components.js",
  "./js/ui/dom.js",
  "./js/ui/fmt.js",
  "./js/ui/lock.js",
  "./js/ui/screens/detail.js",
  "./js/ui/screens/entry.js",
  "./js/ui/screens/history.js",
  "./js/ui/screens/home.js",
  "./js/ui/screens/importHub.js",
  "./js/ui/screens/importPreview.js",
  "./js/ui/screens/settings.js",
  "./js/ui/snapshotView.js",
  "./js/version.js",
  "./manifest.webmanifest"
];
const OPTIONAL = []; // 文字识别组件等较大的文件：下载失败不影响 App 本身离线可用

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(CORE.map((u) => new Request(u, { cache: 'reload' })));
      await Promise.allSettled(
        OPTIONAL.map(async (u) => {
          const res = await fetch(new Request(u, { cache: 'reload' }));
          if (res.ok) await cache.put(u, res);
        }),
      );
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith('asset-ledger-') && key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 绝不代理别的网站
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const index = await cache.match('./index.html');
        if (index) return index;
      }
      try {
        return await fetch(req);
      } catch {
        return new Response('当前离线，且这个文件不在缓存里。', { status: 504, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })(),
  );
});
