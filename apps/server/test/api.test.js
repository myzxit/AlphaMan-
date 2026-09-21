import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, createHttpServer } from '../src/server.js';

process.env.ALPHAMAN_AI = 'off';
process.env.ALPHAMAN_ALLOW_SIMULATED_STT = '1';
process.env.ALPHAMAN_JOB_SPEED = '1000';
process.env.ALPHAMAN_TTS_DETECT = 'off'; // 테스트에서는 네트워크 TTS 탐색 생략
process.env.ALPHAMAN_FAKE_PAYMENTS = '1'; // 테스트 전용 시뮬레이션 결제

async function boot() {
  const app = createApp({ memory: true, platform: 'test' });
  const server = createHttpServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, body, token, extraHeaders = {}) => {
    const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extraHeaders }, body: body === undefined ? undefined : (Buffer.isBuffer(body) ? body : JSON.stringify(body)) });
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, data: ct.includes('json') ? await res.json() : await res.text(), headers: res.headers };
  };
  return { app, server, base, call, close: () => new Promise((r) => { app.close(); server.close(r); }) };
}

test('API: info, admin login, admin-only routes, user flow', async () => {
  const t = await boot();
  try {
    const info = await t.call('GET', '/api/info');
    assert.equal(info.status, 200);
    assert.equal(info.data.adminEmail, 'hhudeu66@gmail.com');
    assert.ok(info.data.content.faq.items.length >= 11);

    const bad = await t.call('POST', '/api/auth/login', { email: 'hhudeu66@gmail.com', password: 'nope' });
    assert.equal(bad.status, 401);
    const login = await t.call('POST', '/api/auth/login', { email: 'hhudeu66@gmail.com', password: 'an1823037' });
    assert.equal(login.status, 200);
    assert.equal(login.data.user.isAdmin, true);
    const adminToken = login.data.token;

    const signup = await t.call('POST', '/api/auth/signup', { email: 'u@test.com', password: 'secret1', name: 'U' });
    assert.equal(signup.status, 200);
    const userToken = signup.data.token;
    const denied = await t.call('GET', '/api/admin/stats', undefined, userToken);
    assert.equal(denied.status, 403);
    const stats = await t.call('GET', '/api/admin/stats', undefined, adminToken);
    assert.equal(stats.data.users.total, 2);

    const grant = await t.call('POST', `/api/admin/users/${signup.data.user.id}/credits`, { minutes: 50, reason: 'test' }, adminToken);
    assert.equal(grant.data.balance, 80);

    const job = await t.call('POST', '/api/shorts/jobs', { url: 'https://youtu.be/abcdefghijk', options: { estimatedDurationSec: 240 } }, userToken);
    assert.equal(job.status, 200);
    let full;
    for (let i = 0; i < 100; i++) { full = await t.call('GET', `/api/shorts/jobs/${job.data.id}`, undefined, userToken); if (full.data.status === 'done') break; await new Promise((r) => setTimeout(r, 30)); }
    assert.equal(full.data.status, 'done');
    assert.equal(full.data.clips.length, 2);
    const srt = await t.call('GET', `/api/shorts/clips/${full.data.clips[0].id}/export?format=srt`, undefined, userToken);
    assert.equal(srt.status, 200);
    assert.match(String(srt.data), /-->/);

    const up = await t.call('POST', '/api/upload', Buffer.alloc(3 * 1024 * 1024, 1), userToken, { 'content-type': 'video/mp4', 'x-filename': encodeURIComponent('테스트.mp4') });
    assert.equal(up.status, 200);
    const proj = await t.call('POST', '/api/subtitles/projects', { uploadId: up.data.id }, userToken);
    assert.equal(proj.status, 200);
    assert.ok(proj.data.segments.length);
    const exp = await t.call('GET', `/api/subtitles/projects/${proj.data.id}/export?format=vtt`, undefined, userToken);
    assert.match(String(exp.data), /^WEBVTT/);

    // 보관함 + 미리보기 + 원본 스트리밍(Range)
    const lib = await t.call('GET', '/api/library', undefined, userToken);
    assert.equal(lib.status, 200); assert.equal(lib.data.items.length, 2); assert.equal(lib.data.stats.byKind.shorts, 2);
    const item = await t.call('GET', `/api/library/${lib.data.items[0].id}`, undefined, userToken);
    assert.equal(item.data.preview.kind, 'shorts'); assert.ok(item.data.preview.items.length >= 1);
    const fav = await t.call('PATCH', `/api/library/${lib.data.items[0].id}`, { favorite: true }, userToken);
    assert.equal(fav.data.favorite, true);
    const noVideo = await t.call('GET', `/api/library/${lib.data.items[0].id}/video`, undefined, userToken);
    assert.equal(noVideo.status, 404);
    const prev = await t.call('GET', `/api/preview/shorts/${full.data.clips[1].id}`, undefined, userToken);
    assert.equal(prev.status, 200); assert.equal(prev.data.source.videoId, 'abcdefghijk');
    const forbidden = await t.call('GET', `/api/preview/shorts/${full.data.clips[1].id}`, undefined, adminToken);
    assert.equal(forbidden.status, 404);
    const range = await fetch(`${t.base}/api/uploads/${up.data.id}/stream`, { headers: { authorization: `Bearer ${userToken}`, range: 'bytes=0-99' } });
    assert.equal(range.status, 206); assert.equal(range.headers.get('content-length'), '100'); assert.match(range.headers.get('content-range'), /^bytes 0-99\//);
    assert.match(range.headers.get('content-disposition'), /^inline/);
    const local = await t.call('GET', '/api/local/stream?path=/etc/hosts', undefined, userToken);
    assert.equal(local.status, 403);
    // 무료 목소리 · SEO · 썸네일
    const free = await t.call('GET', '/api/voice/free');
    assert.ok(free.data.voices.length >= 9 && free.data.styles.length >= 4);
    const tts = await t.call('POST', '/api/voice/synthesize', { voiceId: 'ko-jimin', text: '테스트 문장입니다', style: 'calm' }, userToken);
    assert.equal(tts.status, 200); assert.equal(tts.data.voiceId, 'ko-jimin');
    const clipId = full.data.clips[0].id;
    const seo = await t.call('GET', `/api/seo/shorts/${clipId}`, undefined, userToken);
    assert.ok(seo.data.bestTitle && seo.data.tags.length);
    const regen = await t.call('POST', `/api/seo/shorts/${clipId}`, { hook: '이거 모르면 손해' }, userToken);
    assert.equal(regen.status, 200); assert.ok(regen.data.titles.some((x) => x.text.includes('이거 모르면 손해')));
    const th = await t.call('GET', `/api/thumbnail/shorts/${clipId}`, undefined, userToken);
    assert.ok(th.data.set && th.data.candidates.length >= 4 && th.data.styles.length === 5);
    const svg = await fetch(`${t.base}/api/thumbnail/shorts/${clipId}/image.svg`, { headers: { authorization: `Bearer ${userToken}` } });
    assert.equal(svg.status, 200); assert.match(svg.headers.get('content-type'), /image\/svg\+xml/); assert.match(await svg.text(), /^<svg/);
    const put = await t.call('PUT', `/api/thumbnail/shorts/${clipId}`, { candidateId: 'yt-1', headline: '편집 제목', style: 'split', palette: 'blue' }, userToken);
    assert.equal(put.data.style, 'split');
    const fr = await t.call('POST', `/api/thumbnail/shorts/${clipId}/frame`, Buffer.from('jpeg'), userToken, { 'content-type': 'image/jpeg', 'x-at': '2.5' });
    assert.equal(fr.status, 200); assert.equal(fr.data.at, 2.5);
    const frameRes = await fetch(`${t.base}${fr.data.url}`, { headers: { authorization: `Bearer ${userToken}` } });
    assert.equal(frameRes.status, 200);
    const badProxy = await t.call('GET', '/api/thumbnail/proxy?url=https://example.com/x.jpg', undefined, userToken);
    assert.equal(badProxy.status, 400);
    const otherSeo = await t.call('GET', `/api/seo/shorts/${clipId}`, undefined, adminToken);
    assert.equal(otherSeo.status, 404);

    const disc = await t.call('GET', '/api/discovery/videos?type=shorts&regions=KR&sort_by=trend');
    assert.equal(disc.data.items.length, 10);
    const chat = await t.call('POST', '/api/pixie/chat', { message: '무료로 사용할 수 있나요?' }, userToken);
    assert.match(chat.data.reply, /무료/);

    const maint = await t.call('PATCH', '/api/admin/settings', { maintenance: true }, adminToken);
    assert.equal(maint.data.maintenance, true);
    const blocked = await t.call('GET', '/api/discovery/home', undefined, userToken);
    assert.equal(blocked.status, 503);
    await t.call('PATCH', '/api/admin/settings', { maintenance: false }, adminToken);

    const html = await fetch(`${t.base}/`);
    assert.equal(html.status, 200);
    assert.match(await html.text(), /AlphaMan/);
    const spa = await fetch(`${t.base}/some/deep/route`);
    assert.equal(spa.status, 200);
  } finally {
    await t.close();
  }
});

test('API: 플랫폼 라우트 — 프로젝트/작업 센터/파일 관리자/템플릿/공유(공개)/검색/사용량/알림 삭제/결제 설정/오류 보고/관리자 시스템·백업, 권한 검사', async () => {
  const t = await boot();
  try {
    const admin = (await t.call('POST', '/api/auth/login', { email: 'hhudeu66@gmail.com', password: 'an1823037' })).data.token;
    const su = await t.call('POST', '/api/auth/signup', { email: 'plat@test.com', password: 'secret1', name: 'Plat' });
    const tok = su.data.token; const uid = su.data.user.id;
    const info = await t.call('GET', '/api/info');
    assert.ok(info.data.projectKinds.subtitle && info.data.payments && info.data.uploadLimits.maxBytes > 0);
    assert.ok(!JSON.stringify(info.data.payments).includes('_sk_'), '시크릿 키 노출 없음');
    // 비로그인 → 401
    assert.equal((await t.call('GET', '/api/projects')).status, 401);
    assert.equal((await t.call('GET', '/api/media')).status, 401);
    assert.equal((await t.call('GET', '/api/admin/system', undefined, tok)).status, 403);
    // 자막 프로젝트 만들고 프로젝트 관리 라우트
    const p = await t.call('POST', '/api/subtitles/projects', { url: 'https://youtu.be/abcdefghijk', transcriptText: '0:00\n첫 줄\n0:03\n둘째 줄' }, tok);
    assert.equal(p.status, 200);
    const list = await t.call('GET', '/api/projects?sort=updated', undefined, tok);
    assert.equal(list.data.items.length, 1);
    assert.equal((await t.call('PATCH', `/api/projects/subtitle/${p.data.id}`, { title: '이름 변경', favorite: true }, tok)).data.favorite, true);
    assert.equal((await t.call('PUT', `/api/projects/subtitle/${p.data.id}/position`, { position: { playhead: 2 } }, tok)).data.ok, true);
    assert.equal((await t.call('GET', `/api/projects/subtitle/${p.data.id}/position`, undefined, tok)).data.position.playhead, 2);
    const ver = await t.call('POST', `/api/projects/subtitle/${p.data.id}/versions`, { label: 'v1' }, tok);
    assert.equal(ver.data.number, 1);
    const exp = await fetch(`${t.base}/api/projects/subtitle/${p.data.id}/export`, { headers: { authorization: `Bearer ${tok}` } });
    assert.match(exp.headers.get('content-disposition') || '', /alphaman\.json/);
    const imp = await t.call('POST', '/api/projects/import', await exp.json(), tok);
    assert.equal(imp.status, 200);
    assert.equal((await t.call('POST', '/api/projects/import', { format: 'x' }, tok)).status, 400);
    assert.equal((await t.call('GET', `/api/projects/subtitle/${p.data.id}`, undefined, admin)).status, 404, '다른 사용자의 프로젝트는 관리자도 이 라우트로 못 본다');
    assert.equal((await t.call('POST', `/api/projects/subtitle/${p.data.id}/trash`, {}, tok)).data.deletedAt != null, true);
    assert.equal((await t.call('GET', '/api/projects', undefined, tok)).data.items.length, 1);
    assert.equal((await t.call('POST', `/api/projects/subtitle/${p.data.id}/restore`, {}, tok)).data.deletedAt, null);
    // 자막 편집 확장 라우트
    assert.equal((await t.call('GET', `/api/subtitles/projects/${p.data.id}/search?q=둘째`, undefined, tok)).data.length, 1);
    assert.equal((await t.call('POST', `/api/subtitles/projects/${p.data.id}/replace`, { find: '첫', replace: '1' }, tok)).data.changed, 1);
    assert.equal((await t.call('POST', `/api/subtitles/projects/${p.data.id}/shift`, { offsetSec: 1 }, tok)).status, 200);
    assert.equal((await t.call('GET', `/api/subtitles/projects/${p.data.id}/history`, undefined, tok)).data.max, 50);
    assert.equal((await t.call('POST', `/api/subtitles/projects/${p.data.id}/undo`, {}, tok)).status, 200);
    assert.equal((await t.call('POST', `/api/subtitles/projects/${p.data.id}/redo`, {}, tok)).status, 200);
    assert.equal((await t.call('POST', `/api/subtitles/projects/${p.data.id}/import-vtt`, { vtt: 'WEBVTT\n\n00:00.000 --> 00:01.000\n하나\n' }, tok)).data.segments.length, 1);
    // 업로드 검증 (확장자 차단)
    const badUp = await t.call('POST', '/api/upload', Buffer.from('MZ'), tok, { 'content-type': 'application/octet-stream', 'x-filename': 'virus.exe' });
    assert.equal(badUp.status, 400);
    const up = await t.call('POST', '/api/upload', Buffer.from('fake-mp4-bytes'), tok, { 'content-type': 'video/mp4', 'x-filename': 'clip.mp4' });
    assert.equal(up.status, 200);
    const media = await t.call('GET', '/api/media?category=video', undefined, tok);
    assert.equal(media.data.items.length, 1);
    assert.equal((await t.call('PATCH', `/api/media/upload:${up.data.id}`, { name: 'renamed.mp4' }, tok)).data.ok, true);
    assert.equal((await t.call('POST', `/api/media/upload:${up.data.id}/trash`, {}, admin)).status, 404, '다른 사용자 파일은 휴지통으로 못 보낸다');
    // 템플릿 · 검색 · 사용량 · 작업 센터
    const tpl = await t.call('POST', '/api/templates', { name: '내 스타일', kind: 'subtitle', settings: { subtitleStyle: { color: '#fff000' } } }, tok);
    assert.equal(tpl.status, 200);
    assert.equal((await t.call('POST', `/api/projects/subtitle/${p.data.id}/apply`, tpl.data.settings, tok)).status, 200);
    const search = await t.call('GET', '/api/search?q=이름', undefined, tok);
    assert.ok(search.data.results.some((r) => r.type === 'project'));
    const usage = await t.call('GET', '/api/usage', undefined, tok);
    assert.ok(usage.data.storage.files >= 1);
    const acts = await t.call('GET', '/api/activities', undefined, tok);
    assert.ok(acts.data.queue && acts.data.counts);
    // 알림 삭제
    await t.call('POST', '/api/admin/notices', { title: '공지', body: '내용', broadcast: true }, admin);
    const n1 = await t.call('GET', '/api/notifications', undefined, tok);
    assert.ok(n1.data.length >= 1);
    assert.ok((await t.call('POST', '/api/notifications/delete', { ids: [n1.data[0].id] }, tok)).data.removed >= 1);
    // 결제 설정/주문 (테스트 키) · 가짜 결제 차단
    const cfg = await t.call('GET', '/api/billing/config');
    assert.equal(cfg.status, 200);
    if (cfg.data.toss.enabled) { const o = await t.call('POST', '/api/billing/orders', { planId: 'starter', region: 'domestic' }, tok); assert.equal(o.status, 200); assert.equal(o.data.currency, 'KRW'); assert.equal((await t.call('POST', '/api/billing/toss/confirm', { paymentKey: 'x', orderId: o.data.id, amount: 1 }, tok)).status, 400); assert.equal((await t.call('GET', '/api/admin/orders', undefined, admin)).data.length, 1); }
    assert.equal((await t.call('POST', '/api/billing/orders', { planId: 'free' }, tok)).status, 400);
    // 공유 링크 공개 조회
    assert.equal((await t.call('GET', '/api/share/nope')).status, 404);
    // 클라이언트 오류 보고 · 비밀번호 재설정 요청 · 관리자 시스템/오류/백업/저장공간
    assert.equal((await t.call('POST', '/api/client-errors', { message: 'TypeError: x', route: '#/x' }, tok)).data.ok, true);
    assert.equal((await t.call('POST', '/api/auth/reset-request', { email: 'plat@test.com' })).data.ok, true);
    assert.equal((await t.call('POST', '/api/auth/reset-request', { email: 'nobody@test.com' })).status, 404);
    const sys = await t.call('GET', '/api/admin/system', undefined, admin);
    assert.equal(sys.data.api.ok, true);
    const errs = await t.call('GET', '/api/admin/errors?source=client', undefined, admin);
    assert.ok(errs.data.items.length >= 1 && errs.data.stats.client >= 1);
    assert.ok((await t.call('GET', '/api/admin/storage', undefined, admin)).data.some((r) => r.userId === uid));
    const bk = await t.call('POST', '/api/admin/backups', {}, admin);
    assert.equal(bk.status, 200);
    assert.ok((await t.call('GET', '/api/admin/backups', undefined, admin)).data.items.length >= 1);
    assert.equal((await t.call('POST', `/api/admin/backups/${encodeURIComponent(bk.data.id)}/restore`, { merge: true }, admin)).status, 200);
    assert.equal((await t.call('GET', '/api/admin/activities', undefined, admin)).status, 200);
    // 정적: manifest · 서비스 워커 · 아이콘 · SEO 메타
    for (const f of ['/manifest.webmanifest', '/sw.js', '/icons/icon-192.png', '/js/pages-workspace.js']) assert.equal((await fetch(t.base + f)).status, 200, f);
    const home = await (await fetch(`${t.base}/`)).text();
    assert.match(home, /og:title/); assert.match(home, /rel="canonical"/); assert.match(home, /twitter:card/);
  } finally { await t.close(); }
});

test('API: 브라우저 렌더 업로드(조각) → /api/library/:id/video 스트리밍, 썸네일 image.svg 인라인', async () => {
  const t = await boot();
  try {
    const su = await t.call('POST', '/api/auth/signup', { email: 'render@test.com', password: 'secret1', name: 'R' });
    const tok = su.data.token;
    const job = await t.call('POST', '/api/shorts/jobs', { url: 'https://youtu.be/abcdefghijk', options: { estimatedDurationSec: 120 }, transcriptText: '1\n00:00:00,000 --> 00:00:02,000\n안녕\n\n2\n00:00:02,500 --> 00:00:05,000\n테스트\n' }, tok);
    assert.equal(job.status, 200);
    await new Promise((r) => setTimeout(r, 1500));
    const lib = await t.call('GET', '/api/library?kind=shorts', undefined, tok);
    const item = lib.data.items[0]; assert.ok(item);
    const bytes = Buffer.alloc(9000, 1);
    const a1 = await t.call('POST', `/api/library/${item.id}/render`, bytes.subarray(0, 4000), tok, { 'content-type': 'video/webm', 'x-upload-id': 'abc', 'x-part': '0', 'x-parts': '2' });
    assert.equal(a1.status, 200); assert.equal(a1.data.done, false);
    const a2 = await t.call('POST', `/api/library/${item.id}/render`, bytes.subarray(4000), tok, { 'content-type': 'video/webm', 'x-upload-id': 'abc', 'x-part': '1', 'x-parts': '2' });
    assert.equal(a2.data.done, true); assert.equal(a2.data.size, 9000);
    const v = await fetch(`${t.base}/api/library/${item.id}/video`, { headers: { authorization: `Bearer ${tok}`, range: 'bytes=0-99' } });
    assert.equal(v.status, 206); assert.equal(v.headers.get('content-type'), 'video/webm');
    const other = await t.call('POST', `/api/library/${item.id}/render`, bytes.subarray(0, 10), (await t.call('POST', '/api/auth/login', { email: 'hhudeu66@gmail.com', password: 'an1823037' })).data.token, { 'content-type': 'video/webm', 'x-upload-id': 'x', 'x-part': '0', 'x-parts': '1' });
    assert.equal(other.status, 404, '다른 사용자의 보관함에는 올릴 수 없다');
    const pv = await t.call('GET', `/api/preview/shorts/${item.refId}`, undefined, tok);
    assert.equal(pv.data.rendered, true); assert.equal(pv.data.renderedBy, 'browser');
    const fr = await t.call('POST', `/api/thumbnail/shorts/${item.refId}/frame`, Buffer.from('89504e470d0a1a0a', 'hex'), tok, { 'content-type': 'image/png', 'x-at': '1' });
    assert.equal(fr.status, 200);
    await t.call('PUT', `/api/thumbnail/shorts/${item.refId}`, { candidateId: fr.data.id, headline: '헤드', style: 'bold' }, tok);
    const svg = await fetch(`${t.base}/api/thumbnail/shorts/${item.refId}/image.svg`, { headers: { authorization: `Bearer ${tok}` } });
    assert.equal(svg.status, 200); assert.match(await svg.text(), /data:image\/png;base64,/);
  } finally { await t.close(); }
});
