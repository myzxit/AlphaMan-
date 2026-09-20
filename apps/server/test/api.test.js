import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, createHttpServer } from '../src/server.js';

process.env.ALPHAMAN_AI = 'off';
process.env.ALPHAMAN_JOB_SPEED = '1000';

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
