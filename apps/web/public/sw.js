// AlphaMan 서비스 워커: 앱 셸(HTML/JS/CSS/아이콘)을 캐시해 PWA 설치·오프라인 시작을 지원한다. API 요청은 네트워크 우선.
const VERSION = 'am-v3';
const SHELL = ['/', '/index.html', '/styles.css', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png', '/icons/icon-512.png',
  '/js/app.js', '/js/api.js', '/js/ui.js', '/js/pages-public.js', '/js/pages-app.js', '/js/pages-remix.js', '/js/pages-library.js', '/js/pages-seo.js', '/js/pages-admin.js', '/js/pages-workspace.js', '/js/player.js', '/js/transcript.js', '/js/tts.js', '/js/shortcuts.js', '/js/autosave.js', '/js/stt-worker.js'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL).catch(() => null)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // CDN·유튜브 등은 건드리지 않음
  if (url.pathname.startsWith('/api/')) {
    // API: 네트워크 우선, 실패 시 마지막 성공 응답(정보성 GET 만)
    if (!/^\/api\/(info|notices|shorts\/templates|subtitles\/fonts|translate\/targets|voice\/free|remix\/defaults|plans)$/.test(url.pathname)) return;
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); return res; }).catch(() => caches.match(req)));
    return;
  }
  // 앱 셸: 캐시 우선 + 백그라운드 갱신 (stale-while-revalidate)
  e.respondWith(caches.match(req).then((cached) => {
    const fetching = fetch(req).then((res) => { if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone())); return res; }).catch(() => cached || (req.mode === 'navigate' ? caches.match('/index.html') : undefined));
    return cached || fetching;
  }));
});

// 푸시 알림 (설정에서 켠 경우, 서버 푸시 연동 시)
self.addEventListener('push', (e) => { let data = {}; try { data = e.data.json(); } catch { data = { title: 'AlphaMan', body: e.data?.text() || '' }; } e.waitUntil(self.registration.showNotification(data.title || 'AlphaMan', { body: data.body || '', icon: '/icons/icon-192.png', data: { link: data.link || '/' } })); });
self.addEventListener('notificationclick', (e) => { e.notification.close(); e.waitUntil(self.clients.openWindow(e.notification.data?.link || '/')); });
