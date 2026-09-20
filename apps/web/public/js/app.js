// 앱 셸: 해시 라우터, 사이드바, 테마, 알림(Alt+T), 픽시(Ctrl+K), 의견 보내기, 프로그램(데스크톱) 브리지 감지
import { get, post, setToken, getToken } from './api.js';
import { esc, html, raw, toast, modal, fmtDate, creditsLabel, qs, qsa, on, errorScreen } from './ui.js';
import * as pub from './pages-public.js';
import * as appPages from './pages-app.js';
import * as remixPages from './pages-remix.js';
import * as libraryPages from './pages-library.js';
import * as admin from './pages-admin.js';
import { initShortcuts, showShortcutHelp } from './shortcuts.js';
import { initOfflineBanner } from './autosave.js';

export const state = { user: null, info: null, notices: [], unread: 0, desktop: Boolean(window.alphaman && window.alphaman.isDesktop), pixieThread: null, installPrompt: null };

// 추가 플랫폼 페이지(프로젝트·작업 센터·파일 관리자·검색·설정·공유·결제 결과)는 필요할 때만 불러온다 (코드 분할)
let workspaceMod = null;
const loadWorkspace = () => (workspaceMod ||= import('./pages-workspace.js'));
const lazy = (name, flags = {}) => Object.assign(async (ctx) => (await loadWorkspace())[name](ctx), flags);
const ws = { projects: lazy('projects', { requiresAuth: true }), jobs: lazy('jobs', { requiresAuth: true }), media: lazy('media', { requiresAuth: true }), search: lazy('search', { requiresAuth: true }), settings: lazy('settings', { requiresAuth: true }), shareView: lazy('shareView'), paySuccess: lazy('paySuccess', { requiresAuth: true }), payFail: lazy('payFail') };

const ROUTES = [
  ['/', pub.landing], ['/login', pub.login], ['/signup', pub.signup], ['/pricing', pub.pricing], ['/overseas-payment', pub.overseas], ['/publish-pricing', pub.addonPricing], ['/topic-pricing', pub.addonPricing],
  ['/guide', pub.guide], ['/faq', pub.faq], ['/tools', pub.tools], ['/tools/:id', pub.tools], ['/referral', pub.referral], ['/referral-promo', pub.referral], ['/team', pub.team], ['/terms', pub.legal], ['/privacy', pub.legal], ['/refund', pub.legal], ['/open-source', pub.legal],
  ['/download', pub.download], ['/notices', pub.notices], ['/blog', pub.blog], ['/longform-landing', pub.landingLongform], ['/publish-landing', pub.landingPublish], ['/topic-landing', pub.landingTopic],
  ['/dashboard', appPages.dashboard], ['/studio', appPages.studio], ['/studio/:id', appPages.studioJob], ['/longform', appPages.longform], ['/longform/:id', appPages.longform],
  ['/subtitles', appPages.subtitles], ['/subtitles/:id', appPages.subtitleEditor], ['/discovery', appPages.discovery], ['/discovery/:tab', appPages.discovery],
  ['/remix', remixPages.remix], ['/remix/:id', remixPages.remixJob], ['/voice', remixPages.voice], ['/library', libraryPages.library],
  ['/publish', appPages.publish], ['/topic', appPages.topic], ['/translate', appPages.translate], ['/account', appPages.account], ['/support', appPages.support], ['/support/:id', appPages.support], ['/credits', appPages.credits],
  ['/admin', admin.dashboard], ['/admin/:section', admin.section], ['/admin/:section/:id', admin.section],
  // 추가 플랫폼 기능 (기존 라우트는 그대로, 새 경로만 추가)
  ['/projects', ws.projects], ['/jobs', ws.jobs], ['/media', ws.media], ['/search', ws.search], ['/settings', ws.settings], ['/share/:token', ws.shareView], ['/pay/success', ws.paySuccess], ['/pay/fail', ws.payFail],
];

export function navigate(hash) { location.hash = hash.startsWith('#') ? hash : `#${hash}`; }

function matchRoute(path) {
  for (const [pattern, handler] of ROUTES) {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}/?$`);
    const m = path.match(re);
    if (m) return { handler, params: Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}

export async function refreshUser() {
  try { const r = await get('/api/auth/me'); state.user = r.user; if (!r.user && getToken()) setToken(null); } catch (err) { state.user = null; if (err.status === 401) setToken(null); }
  renderUserMenu(); renderSidebar(); applyPrefs();
  if (state.user) refreshNotifications();
}
// 사용자 설정(애니메이션 줄이기 · 모바일 터치 영역) 반영
function applyPrefs() { const p = state.user?.prefs || {}; document.body.classList.toggle('reduce-motion', Boolean(p.reduceMotion)); document.body.classList.toggle('touch-lg', p.mobileEditor !== false); }

let lastRoute = null;
async function render() {
  const full = location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = full.split('?');
  const params = Object.fromEntries(new URLSearchParams(query));
  const route = matchRoute(path) || { handler: pub.notFound, params: {} };
  const view = qs('#view');
  view.innerHTML = '<div class="skeleton-list" aria-busy="true"><div class="card skeleton-card"><div class="skeleton-line" style="width:40%"></div><div class="skeleton-line" style="width:90%"></div><div class="skeleton-line" style="width:70%"></div></div></div>';
  document.getElementById('app').classList.remove('sidebar-mobile-open');
  const gsi = qs('#global-search'); if (gsi && path === '/search') gsi.value = params.q || '';
  try {
    if (route.handler.requiresAuth && !state.user) { navigate(`/login?next=${encodeURIComponent(full)}`); return; }
    if (route.handler.requiresAdmin && (!state.user || !state.user.isAdmin)) { view.innerHTML = '<div class="card"><h2>관리자 전용 기능입니다.</h2><p class="muted">관리자 계정으로 로그인해주세요.</p></div>'; return; }
    lastRoute = full;
    await route.handler({ view, params: { ...route.params, ...params }, query: params, path, state, navigate });
  } catch (err) {
    console.error(err);
    reportClientError(err, full);
    view.innerHTML = errorScreen(err, { retry: () => { location.hash = `#${full}${full.includes('?') ? '&' : '?'}r=${Date.now()}`; }, back: '#/' });
  }
  renderSidebar();
  window.scrollTo(0, 0);
  updateSeo(path);
}

// 라우트별 제목/설명 (SEO · 공유 미리보기). 공개 페이지는 canonical 을 해시 라우트로 유지
const PAGE_META = { '/': ['AlphaMan - AI 하이라이트 쇼츠 자동 제작 · AI 자막 편집기', null], '/pricing': ['가격 안내 · AlphaMan', '원본 영상 길이만큼 차감되는 이용권 요금제'], '/guide': ['사용 가이드 · AlphaMan', '가입부터 업로드까지 7단계'], '/faq': ['FAQ · AlphaMan', '자주 묻는 질문'], '/tools': ['무료 도구 · AlphaMan', '로그인 없이 쓰는 크리에이터 유틸리티'], '/download': ['프로그램 다운로드 · AlphaMan', 'Windows · macOS · Linux 설치 파일'], '/login': ['로그인 · AlphaMan', null], '/signup': ['무료로 시작하기 · AlphaMan', null], '/projects': ['프로젝트 · AlphaMan', null], '/jobs': ['작업 센터 · AlphaMan', null], '/media': ['파일 관리자 · AlphaMan', null], '/settings': ['설정 · AlphaMan', null], '/library': ['보관함 · AlphaMan', null] };
function updateSeo(path) {
  const [title, desc] = PAGE_META[path] || [`${({ '/studio': '쇼츠 스튜디오', '/remix': 'AI 재구성', '/voice': '내 목소리 TTS', '/longform': '롱폼 컷편집', '/subtitles': '자막 편집기', '/dashboard': '대시보드', '/admin': '관리자' })[`/${path.split('/')[1]}`] || 'AlphaMan'} · AlphaMan`, null];
  document.title = title;
  const set = (sel, attr, val) => { const el = document.querySelector(sel); if (el && val != null) el.setAttribute(attr, val); };
  set('meta[property="og:title"]', 'content', title); set('meta[name="twitter:title"]', 'content', title);
  if (desc) { set('meta[name="description"]', 'content', desc); set('meta[property="og:description"]', 'content', desc); }
  set('link[rel="canonical"]', 'href', `${location.origin}/${path === '/' ? '' : `#${path}`}`); set('meta[property="og:url"]', 'content', `${location.origin}/${path === '/' ? '' : `#${path}`}`);
}

// 클라이언트 오류 보고 (설정 → 개인정보에서 끌 수 있음). 같은 메시지는 5분에 1회만
const reported = new Map();
function reportClientError(err, route = location.hash) {
  try {
    if (state.user?.prefs?.privacyAnalytics === false) return;
    const key = String(err?.message || err).slice(0, 120); const now = Date.now();
    if (reported.get(key) && now - reported.get(key) < 5 * 60 * 1000) return; reported.set(key, now);
    if (err?.status && err.status < 500) return; // 4xx 는 사용자 입력 오류 → 보고하지 않음
    if (/Failed to fetch|NetworkError|Load failed|network/i.test(key)) return; // 네트워크 끊김·페이지 이동으로 취소된 요청은 버그가 아님
    post('/api/client-errors', { message: key, stack: String(err?.stack || '').slice(0, 2000), route }).catch(() => {});
  } catch { /* ignore */ }
}
window.addEventListener('error', (e) => reportClientError(e.error || new Error(e.message)));
window.addEventListener('unhandledrejection', (e) => { const r = e.reason; if (r && r.status && r.status < 500) return; reportClientError(r instanceof Error ? r : new Error(String(r))); });

const NAV = [
  { group: '시작', items: [['/', '🏠', '홈'], ['/dashboard', '📊', '대시보드', true], ['/projects', '📂', '프로젝트', true], ['/library', '📁', '보관함', true], ['/jobs', '⚙️', '작업 센터', true], ['/media', '🗂️', '파일 관리자', true]] },
  { group: '알파컷 · 쇼츠', items: [['/studio', '✂️', '쇼츠 스튜디오', true], ['/remix', '🪄', 'AI 재구성', true], ['/voice', '🎤', '내 목소리 TTS', true], ['/longform', '🎬', '롱폼 컷편집', true], ['/publish', '📤', 'SNS 업로드', true], ['/topic', '📈', '알파토픽', true], ['/translate', '🌐', '다국어 번역', true]] },
  { group: '픽셀링 · 자막', items: [['/subtitles', '💬', '자막 편집기', true], ['/discovery', '🔥', '디스커버리']] },
  { group: '더보기', items: [['/settings', '🛠️', '설정', true], ['/pricing', '💳', '가격 안내'], ['/tools', '🧰', '무료 도구'], ['/guide', '📖', '사용 가이드'], ['/faq', '❓', 'FAQ'], ['/referral', '🎁', '추천인 보상'], ['/support', '🛟', '문의하기', true], ['/notices', '📢', '공지사항'], ['/download', '💾', '프로그램 다운로드']] },
];

function renderSidebar() {
  const path = (location.hash.replace(/^#/, '') || '/').split('?')[0];
  const groups = NAV.map((g) => ({ ...g }));
  if (state.user && state.user.isAdmin) groups.push({ group: '관리자', items: [['/admin', '🛡️', '관리자 대시보드'], ['/admin/users', '👥', '사용자 관리'], ['/admin/inquiries', '📨', '문의 관리'], ['/admin/notices', '📌', '공지 관리'], ['/admin/system', '🩺', '시스템 상태'], ['/admin/errors', '🐞', '오류 로그'], ['/admin/backups', '🗄️', '백업 / 복원'], ['/admin/settings', '⚙️', '시스템 설정']] });
  qs('#sidebar-nav').innerHTML = groups.map((g) => `<div class="nav-group-title">${esc(g.group)}</div>${g.items.map(([href, ico, label]) => `<a class="nav-item ${path === href || (href !== '/' && path.startsWith(`${href}/`)) ? 'active' : ''}" href="#${href}"><span class="ico">${ico}</span><span class="label">${esc(label)}</span></a>`).join('')}`).join('');
  qs('#sidebar-foot').innerHTML = state.user ? `<div><strong>${esc(state.user.name)}</strong><div class="tiny">${esc(state.user.email)}</div><div class="tiny">이용권 ${creditsLabel(state.user)} · <a href="#/credits">충전</a></div></div>` : '<a class="btn btn-primary btn-sm btn-block" href="#/signup">무료 시작</a>';
}

function renderUserMenu() {
  const el = qs('#user-menu');
  if (!state.user) { el.innerHTML = '<a class="btn btn-ghost btn-sm" href="#/login">로그인</a><a class="btn btn-accent btn-sm" href="#/signup">무료 시작</a>'; return; }
  el.innerHTML = `<div class="row" style="gap:6px"><a class="btn btn-ghost btn-sm" href="#/account">${esc(state.user.name)} ${state.user.isAdmin ? '<span class="badge">관리자</span>' : ''}</a><button class="btn btn-ghost btn-sm" id="logout-btn">로그아웃</button></div>`;
  qs('#logout-btn').onclick = async () => { try { await post('/api/auth/logout'); } catch { /* ignore */ } setToken(null); state.user = null; renderUserMenu(); renderSidebar(); toast('로그아웃되었습니다.'); navigate('/'); };
}

async function refreshNotifications() {
  try {
    const list = await get('/api/notifications');
    state.unread = list.filter((n) => !n.read).length;
    const c = qs('#notif-count'); c.textContent = state.unread; c.classList.toggle('hidden', !state.unread);
    qs('#notif-list').innerHTML = list.length ? list.map((n) => `<div class="notif ${n.read ? '' : 'unread'}" data-nid="${esc(n.id)}"><div class="row row-between" style="gap:6px"><div>${esc(n.title)}</div><div class="row" style="gap:2px">${n.read ? '' : `<button class="icon-btn" data-nread="${esc(n.id)}" title="읽음" aria-label="읽음 처리">✓</button>`}<button class="icon-btn" data-ndel="${esc(n.id)}" title="삭제" aria-label="알림 삭제">🗑</button></div></div><div class="small muted">${esc(n.body)}</div><div class="tiny muted">${fmtDate(n.createdAt)} ${n.link ? `· <a href="${esc(n.link)}">열기</a>` : ''}</div></div>`).join('') : '<div class="muted">새 알림이 없습니다.</div>';
  } catch { /* ignore */ }
}
on(document.body, 'click', '[data-ndel]', async (e, t) => { try { await post('/api/notifications/delete', { ids: [t.dataset.ndel] }); } catch { /* ignore */ } refreshNotifications(); });
on(document.body, 'click', '[data-nread]', async (e, t) => { try { await post('/api/notifications/read', { ids: [t.dataset.nread] }); } catch { /* ignore */ } refreshNotifications(); });
qs('#notif-clear').onclick = async () => { try { await post('/api/notifications/delete', {}); } catch { /* ignore */ } refreshNotifications(); };

function toggle(id, show) {
  const el = document.getElementById(id);
  const willShow = show ?? el.classList.contains('hidden');
  qsa('.drawer').forEach((d) => d.classList.add('hidden'));
  el.classList.toggle('hidden', !willShow);
  qs('#backdrop').classList.toggle('hidden', !willShow);
  if (willShow && id === 'drawer-notifs' && state.user) refreshNotifications();
  if (willShow && id === 'drawer-pixie') openPixie();
}

function cycleTheme() {
  const order = ['system', 'light', 'dark'];
  const cur = document.documentElement.getAttribute('data-theme') || 'system';
  const next = order[(order.indexOf(cur) + 1) % order.length];
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('am_theme', next); } catch { /* ignore */ }
  toast(`테마: ${{ system: '시스템', light: '라이트', dark: '다크' }[next]}`);
  if (state.user) post('/api/auth/me', { theme: next }).catch(() => {});
}

// ---- 픽시 커맨드 센터 ----
async function openPixie() {
  const box = qs('#pixie-messages');
  if (state.pixieThread) { renderPixie(); return; }
  box.innerHTML = '<div class="muted">픽시를 여는 중...</div>';
  try {
    const threads = state.user ? await get('/api/pixie/threads') : [];
    state.pixieThread = threads[0] || { messages: [{ role: 'assistant', text: `안녕하세요${state.user ? `, ${state.user.name}님` : ''}! 픽시예요. 쇼츠 제작, 자막 편집, 번역, SNS 예약 업로드, 주제 추천 중 무엇을 도와드릴까요?`, at: new Date().toISOString() }] };
    if (state.pixieThread.id) state.pixieThread = await get(`/api/pixie/threads/${state.pixieThread.id}`);
  } catch { state.pixieThread = { messages: [] }; }
  renderPixie();
}
function renderPixie() {
  const box = qs('#pixie-messages');
  box.innerHTML = state.pixieThread.messages.map((m) => `<div class="msg ${m.role}">${esc(m.text)}${m.actions ? `<div class="msg-actions">${m.actions.filter((a) => a.type === 'open').map((a) => `<a class="btn btn-sm" href="${esc(a.target)}">${esc(a.label)}</a>`).join('')}</div>` : ''}</div>`).join('') || '<div class="muted">대화를 시작해보세요.</div>';
  box.scrollTop = box.scrollHeight;
}
qs('#pixie-form').onsubmit = async (e) => {
  e.preventDefault();
  const input = qs('#pixie-input'); const message = input.value.trim(); if (!message) return;
  input.value = '';
  state.pixieThread.messages.push({ role: 'user', text: message }); renderPixie();
  try {
    const r = await post('/api/pixie/chat', { threadId: state.pixieThread.id || null, message });
    state.pixieThread = r.thread; renderPixie();
  } catch (err) { toast(err.message, 'error'); }
};
qs('#pixie-escalate').onclick = async () => {
  const m = modal(html`<p>현재 대화 내용이 관리자에게 전달됩니다. 답변은 이 채팅에서 확인할 수 있으며 최대 24시간이 걸릴 수 있습니다.</p>
    ${state.user ? '' : raw('<div class="field"><label>답변 받을 이메일</label><input id="esc-email" type="email" placeholder="이메일" /></div>')}
    <div class="field"><label>문의 내용 (선택)</label><textarea id="esc-extra" rows="3" placeholder="관리자에게 추가로 전달할 내용이 있다면 입력해주세요."></textarea></div>
    <button class="btn btn-primary btn-block" id="esc-send">관리자에게 전달</button>`, { title: '관리자에게 문의하기' });
  m.el.querySelector('#esc-send').onclick = async (ev) => {
    ev.target.textContent = '전달 중...'; ev.target.disabled = true;
    try {
      const r = await post('/api/pixie/escalate', { threadId: state.pixieThread.id || null, email: m.el.querySelector('#esc-email')?.value, extra: m.el.querySelector('#esc-extra').value });
      state.pixieThread.id = r.threadId; state.pixieThread = await get(`/api/pixie/threads/${r.threadId}`).catch(() => state.pixieThread); renderPixie(); m.close(); toast('관리자에게 전달되었습니다.');
    } catch (err) { toast(err.message, 'error'); ev.target.disabled = false; ev.target.textContent = '관리자에게 전달'; }
  };
};

// ---- 의견 보내기 ----
qs('#feedback-btn').onclick = () => {
  const m = modal(html`<div class="field"><label>의견</label><textarea id="fb-msg" rows="4" placeholder="불편한 점이나 원하는 기능을 알려주세요."></textarea></div>
    ${state.user ? '' : raw('<div class="field"><label>이메일 (선택)</label><input id="fb-email" type="email" /></div>')}
    <div class="field"><label>만족도</label><select id="fb-rating"><option value="5">😍 매우 만족</option><option value="4">🙂 만족</option><option value="3">😐 보통</option><option value="2">🙁 불만</option><option value="1">😡 매우 불만</option></select></div>
    <button class="btn btn-primary btn-block" id="fb-send">보내기</button>`, { title: '의견 보내기' });
  m.el.querySelector('#fb-send').onclick = async () => {
    try { await post('/api/feedback', { message: m.el.querySelector('#fb-msg').value, email: m.el.querySelector('#fb-email')?.value, rating: Number(m.el.querySelector('#fb-rating').value), page: location.hash }); m.close(); toast('소중한 의견 감사합니다!'); } catch (err) { toast(err.message, 'error'); }
  };
};

// ---- 셸 이벤트 ----
qs('#sidebar-toggle').onclick = () => document.getElementById('app').classList.toggle('sidebar-collapsed');
qs('#sidebar-open').onclick = () => document.getElementById('app').classList.toggle('sidebar-mobile-open');
qs('#theme-btn').onclick = cycleTheme;
qs('#notif-btn').onclick = () => toggle('drawer-notifs');
qs('#pixie-btn').onclick = () => toggle('drawer-pixie');
qs('#notif-read-all').onclick = async () => { await post('/api/notifications/read', {}); refreshNotifications(); };
qs('#backdrop').onclick = () => { qsa('.drawer').forEach((d) => d.classList.add('hidden')); qs('#backdrop').classList.add('hidden'); };
on(document.body, 'click', '[data-close]', (e, t) => { document.getElementById(t.dataset.close).classList.add('hidden'); qs('#backdrop').classList.add('hidden'); });
document.addEventListener('keydown', (e) => {
  if (e.altKey && e.key.toLowerCase() === 't') { e.preventDefault(); toggle('drawer-notifs'); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); toggle('drawer-pixie'); qs('#pixie-input').focus(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); document.getElementById('app').classList.toggle('sidebar-collapsed'); }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'l') { e.preventDefault(); cycleTheme(); }
  if (e.key === 'Escape') { qsa('.drawer').forEach((d) => d.classList.add('hidden')); qs('#backdrop').classList.add('hidden'); }
});
initShortcuts(() => state);
qs('#global-search-form').onsubmit = (e) => { e.preventDefault(); const q = qs('#global-search').value.trim(); if (!state.user) return navigate(`/login?next=${encodeURIComponent(`/search?q=${encodeURIComponent(q)}`)}`); navigate(`/search?q=${encodeURIComponent(q)}`); };
qs('#help-btn').onclick = () => showShortcutHelp();

// ---- PWA: 서비스 워커 등록 + 설치 배너 ----
function initPwa() {
  if ('serviceWorker' in navigator && !state.desktop && location.protocol !== 'file:') {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => { const nw = reg.installing; nw && nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) toast('새 버전이 준비되었습니다. 새로고침하면 적용됩니다.', 'info', 6000); }); });
    }).catch(() => {});
  }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); state.installPrompt = e; const b = qs('#install-btn'); if (b) b.classList.remove('hidden'); });
  window.addEventListener('appinstalled', () => { state.installPrompt = null; qs('#install-btn')?.classList.add('hidden'); toast('AlphaMan 이 설치되었습니다.'); });
  const ib = qs('#install-btn'); if (ib) ib.onclick = async () => { if (!state.installPrompt) return; state.installPrompt.prompt(); const r = await state.installPrompt.userChoice.catch(() => null); if (r?.outcome === 'accepted') ib.classList.add('hidden'); state.installPrompt = null; };
  if (window.matchMedia('(display-mode: standalone)').matches) document.body.classList.add('standalone');
}

function renderFooter() {
  const f = state.info?.content?.footer; if (!f) return;
  qs('#footer').innerHTML = `<div class="footer-grid"><div><div class="brand" style="margin-bottom:8px"><span class="brand-mark">α</span><span class="brand-name">AlphaMan</span></div><div>${esc(state.info.content.brand.tagline)}</div><div class="tiny" style="margin-top:8px">언어: ${state.info.locales.map((l) => `<a href="#/?lang=${l.code}">${esc(l.label)}</a>`).join(' · ')}</div></div>
    ${f.columns.map((c) => `<div><h4>${esc(c.title)}</h4>${c.links.map(([label, href]) => `<a href="${esc(href)}">${esc(label)}</a>`).join('')}</div>`).join('')}</div>
    <div class="footer-company">${f.company.map(esc).join(' | ')}</div>`;
}

function renderNoticeBar() {
  const bar = qs('#notice-bar');
  const s = state.info?.settings || {};
  const pinned = state.notices.find((n) => n.pinned);
  if (s.maintenance) { bar.className = 'notice-bar warn'; bar.textContent = s.maintenanceMessage || '서비스 점검 중입니다.'; }
  else if (pinned) { bar.className = 'notice-bar'; bar.innerHTML = `📢 ${esc(pinned.title)} — ${esc(pinned.body)}`; }
  else if (s.tiktokDownloadNotice) { bar.className = 'notice-bar'; bar.textContent = state.info.content.pixeling.tiktokNotice; }
  else { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
}

async function boot() {
  const sp = new URLSearchParams(location.search);
  const ref = sp.get('ref'); if (ref) try { localStorage.setItem('am_ref', ref); } catch { /* ignore */ }
  // 결제사 리다이렉트(?pay=success&paymentKey=...&orderId=...&amount=... / ?pay=fail&code=&message=) → 해시 라우트로 이동
  if (sp.get('pay')) { const pay = sp.get('pay'); sp.delete('pay'); history.replaceState(null, '', `${location.pathname}#/pay/${pay === 'success' ? 'success' : 'fail'}?${sp.toString()}`); }
  if (state.desktop) document.body.classList.add('is-desktop');
  qs('#platform-badge').textContent = state.desktop ? '프로그램 버전' : '웹사이트 버전';
  initOfflineBanner(); initPwa();
  try { [state.info, state.notices] = await Promise.all([get('/api/info'), get('/api/notices')]); } catch (err) { qs('#view').innerHTML = errorScreen(err, { title: '서버에 연결할 수 없습니다', retry: () => location.reload() }); return; }
  renderFooter(); renderNoticeBar();
  await refreshUser();
  window.addEventListener('hashchange', render);
  await render();
  setInterval(() => { if (state.user && document.visibilityState === 'visible') refreshNotifications(); }, 30000);
}
window.AlphaManApp = { state, navigate, refreshUser, toast, toggle, reportClientError, loadWorkspace };
boot();
