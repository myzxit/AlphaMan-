// REST API: 모든 코어 기능을 HTTP 로 노출. 웹사이트 버전과 프로그램 버전(내장 서버)이 동일하게 사용한다.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ApiError, validateUpload } from '@alphaman/core';
import { Router } from './router.js';

// 간단한 요청 제한 (로그인·재설정 등 무차별 대입 방지) — 인스턴스 메모리 기준
const RATE = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now(); const rec = RATE.get(key) || { count: 0, reset: now + windowMs };
  if (now > rec.reset) { rec.count = 0; rec.reset = now + windowMs; }
  rec.count += 1; RATE.set(key, rec);
  if (RATE.size > 5000) for (const [k, v] of RATE) if (now > v.reset) RATE.delete(k);
  if (rec.count > max) throw new ApiError(429, '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.');
}
const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();

export function buildApi(app) {
  const r = new Router();
  const auth = (ctx) => { if (!ctx.user) throw new ApiError(401, '로그인이 필요합니다.'); return ctx.user; };
  const admin = (ctx) => app.auth.requireAdmin(ctx.user);

  // ---- 시스템 / 콘텐츠 ----
  r.get('/api/info', async () => app.info());
  r.get('/api/health', async () => ({ ok: true, at: new Date().toISOString() }));
  r.get('/api/notices', async () => app.admin.notices().filter((n) => n.active));

  // ---- 인증 ----
  r.post('/api/auth/signup', async ({ body }) => { if (!app.admin.settings().allowSignup) throw new ApiError(403, '현재 회원가입이 중단되었습니다.'); return app.auth.signup(body); });
  r.post('/api/auth/login', async ({ body, req }) => { rateLimit(`login:${clientIp(req)}`, 20, 10 * 60 * 1000); return app.auth.login(body); });
  r.post('/api/auth/reset-request', async ({ body, req }) => { rateLimit(`reset:${clientIp(req)}`, 5, 10 * 60 * 1000); return app.auth.requestPasswordReset({ email: body.email, support: app.support }); });
  r.post('/api/auth/google', async ({ body }) => app.auth.loginWithGoogle(body));
  r.post('/api/auth/logout', async ({ token }) => ({ ok: app.auth.logout(token) }));
  r.get('/api/auth/me', async (ctx) => ({ user: ctx.user ? app.auth.publicUser(ctx.user) : null }));
  r.patch('/api/auth/me', async (ctx) => ({ user: app.auth.updateProfile(auth(ctx).id, ctx.body) }));
  r.post('/api/auth/password', async (ctx) => ({ ok: app.auth.changePassword(auth(ctx).id, ctx.body) }));

  // ---- 이용권 / 요금제 / 결제 / 추천 ----
  r.get('/api/credits', async (ctx) => ({ ...app.credits.summary(auth(ctx).id), balance: app.credits.summary(ctx.user.id).credits, ledger: app.credits.ledger(ctx.user.id) }));
  r.get('/api/plans', async () => { const info = await app.info(); return { plans: info.plans, addons: info.addonPlans }; });
  r.post('/api/billing/checkout', async (ctx) => app.credits.checkout(auth(ctx).id, ctx.body));
  r.get('/api/billing/payments', async (ctx) => app.credits.payments(auth(ctx).id));
  // 실제 결제: 주문 → 결제창(토스/Stripe) → 서버 승인 → 이용권 지급
  r.get('/api/billing/config', async () => app.payments.config());
  r.post('/api/billing/orders', async (ctx) => app.payments.createOrder(auth(ctx).id, ctx.body));
  r.get('/api/billing/orders', async (ctx) => app.payments.orders(auth(ctx).id));
  r.post('/api/billing/toss/confirm', async (ctx) => app.payments.confirmToss(auth(ctx).id, ctx.body));
  r.post('/api/billing/toss/webhook', async (ctx) => app.payments.tossWebhook(ctx.body));
  r.post('/api/billing/stripe/session', async (ctx) => app.payments.createStripeSession(auth(ctx).id, ctx.body));
  r.post('/api/billing/stripe/confirm', async (ctx) => app.payments.confirmStripe(auth(ctx).id, ctx.body));
  r.get('/api/referral', async (ctx) => app.credits.referralSummary(auth(ctx).id));
  r.post('/api/referral/apply', async (ctx) => ({ referrerId: app.credits.applyReferral(auth(ctx).id, ctx.body.code) }));
  r.post('/api/team/request', async (ctx) => app.support.teamRequest({ user: auth(ctx), ...ctx.body }));

  // ---- 업로드 (raw body, X-Filename 헤더) ----
  r.post('/api/upload', async (ctx) => {
    const user = auth(ctx);
    const rawName = decodeURIComponent(ctx.headers['x-filename'] || 'upload.mp4');
    const mimeType = ctx.headers['content-type'] || 'video/mp4';
    const { name: filename, ext } = validateUpload({ filename: rawName, mimeType, size: ctx.raw.length }); // 확장자·MIME·크기·파일명 검증
    const dir = path.join(app.uploadsDir, user.id);
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, `${randomUUID()}${ext || '.mp4'}`);
    fs.writeFileSync(dest, ctx.raw);
    // 서버리스: 다른 인스턴스에서도 쓸 수 있도록 원격 저장소(Vercel Blob)에도 올린다
    let remoteUrl = null;
    if (app.store.remote?.putFile) { try { remoteUrl = await app.store.remote.putFile(`uploads/${user.id}/${path.basename(dest)}`, ctx.raw, mimeType); } catch (err) { console.warn('[upload] 원격 저장 실패 (로컬만):', err.message); } }
    return app.registerUpload(user.id, { filename, mimeType, size: ctx.raw.length, path: dest, remoteUrl });
  });
  r.post('/api/validate-file', async ({ body }) => { const { validateVideoMeta } = await import('@alphaman/core'); return validateVideoMeta(body); });

  // ---- 쇼츠 (알파컷) ----
  r.get('/api/shorts/templates', async () => ({ templates: app.shorts.templates(), genres: app.shorts.genres(), ratios: app.shorts.ratios() }));
  r.get('/api/shorts/jobs', async (ctx) => app.shorts.listJobs(auth(ctx).id));
  r.post('/api/shorts/jobs', async (ctx) => {
    const user = auth(ctx);
    if (ctx.body.uploadId) return app.shorts.createFromUpload(user.id, ctx.body);
    if (ctx.body.localPath && app.platform === 'desktop') {
      const up = app.registerUpload(user.id, { filename: path.basename(ctx.body.localPath), mimeType: 'video/mp4', size: fs.statSync(ctx.body.localPath).size, path: ctx.body.localPath });
      return app.shorts.createFromUpload(user.id, { uploadId: up.id, options: ctx.body.options, transcript: ctx.body.transcript, transcriptText: ctx.body.transcriptText });
    }
    return app.shorts.createFromYoutube(user.id, ctx.body);
  });
  r.get('/api/shorts/jobs/:id', async (ctx) => app.shorts.getJob(auth(ctx).id, ctx.params.id, { admin: ctx.user.role === 'admin' }));
  r.delete('/api/shorts/jobs/:id', async (ctx) => ({ ok: app.shorts.deleteJob(auth(ctx).id, ctx.params.id) }));
  r.post('/api/shorts/jobs/:id/regenerate', async (ctx) => app.shorts.regenerate(auth(ctx).id, ctx.params.id));
  r.patch('/api/shorts/clips/:id', async (ctx) => app.shorts.editClip(auth(ctx).id, ctx.params.id, ctx.body));
  r.post('/api/shorts/clips/:id/render', async (ctx) => app.shorts.rerender(auth(ctx).id, ctx.params.id));
  r.get('/api/shorts/clips/:id/export', async (ctx) => {
    const out = app.shorts.exportClip(auth(ctx).id, ctx.params.id, ctx.query.format || 'mp4');
    if (out.file && fs.existsSync(out.file)) return { _file: out.file, mime: out.mime, filename: `${ctx.params.id}.mp4`, inline: ctx.query.inline === '1' };
    if (out.body != null) return { _raw: out.body, mime: out.mime, filename: `${ctx.params.id}.${out.ext}` };
    return { rendered: false, plan: out.plan, clip: out.clip, message: 'ffmpeg 이 설치된 환경(프로그램 버전)에서 실제 MP4 가 렌더링됩니다.' };
  });

  // ---- 롱폼 컷편집 ----
  r.get('/api/longform/jobs', async (ctx) => app.longform.list(auth(ctx).id));
  r.post('/api/longform/jobs', async (ctx) => app.longform.create(auth(ctx).id, ctx.body));
  r.get('/api/longform/jobs/:id', async (ctx) => app.longform.get(auth(ctx).id, ctx.params.id));
  r.delete('/api/longform/jobs/:id', async (ctx) => ({ ok: app.longform.remove(auth(ctx).id, ctx.params.id) }));

  // ---- AI 재구성 (리믹스) ----
  r.get('/api/remix/defaults', async () => app.remix.defaults());
  r.get('/api/remix/jobs', async (ctx) => app.remix.list(auth(ctx).id));
  r.post('/api/remix/jobs', async (ctx) => {
    const user = auth(ctx);
    const body = { ...ctx.body };
    if (body.localPath && app.platform !== 'desktop') delete body.localPath;
    return app.remix.create(user.id, body);
  });
  r.get('/api/remix/jobs/:id', async (ctx) => app.remix.get(auth(ctx).id, ctx.params.id));
  r.patch('/api/remix/jobs/:id', async (ctx) => app.remix.updateResult(auth(ctx).id, ctx.params.id, ctx.body));
  r.delete('/api/remix/jobs/:id', async (ctx) => ({ ok: app.remix.remove(auth(ctx).id, ctx.params.id) }));
  r.post('/api/remix/jobs/:id/regenerate', async (ctx) => app.remix.regenerate(auth(ctx).id, ctx.params.id));
  r.get('/api/remix/jobs/:id/export', async (ctx) => {
    const j = app.remix.get(auth(ctx).id, ctx.params.id);
    if (j.status !== 'done') throw new ApiError(409, '아직 완료되지 않은 작업입니다.');
    const fmt = ctx.query.format || 'mp4';
    if (fmt === 'ass') return { _raw: j.result.render.subtitleASS || '', mime: 'text/x-ssa', filename: `${j.id}.ass` };
    if (fmt === 'json') return { _raw: JSON.stringify(j.result, null, 2), mime: 'application/json', filename: `${j.id}.json` };
    if (j.result.render?.rendered && fs.existsSync(j.result.render.output)) return { _file: j.result.render.output, mime: 'video/mp4', filename: `${j.id}.mp4`, inline: ctx.query.inline === '1' };
    return { rendered: false, plan: j.result.render?.plan || null, message: 'ffmpeg 이 설치된 환경(프로그램 버전)에서 실제 MP4 가 렌더링됩니다.' };
  });

  // ---- 보관함 (내가 만든 영상) + 미리보기 ----
  r.get('/api/library', async (ctx) => app.library.list(auth(ctx).id, ctx.query));
  r.post('/api/library/sync', async (ctx) => ({ added: app.library.sync(auth(ctx).id) }));
  r.get('/api/library/:id', async (ctx) => app.library.detail(auth(ctx).id, ctx.params.id));
  r.patch('/api/library/:id', async (ctx) => app.library.update(auth(ctx).id, ctx.params.id, ctx.body));
  r.delete('/api/library/:id', async (ctx) => ({ ok: app.library.remove(auth(ctx).id, ctx.params.id, { deleteFile: ctx.query.deleteFile === '1' }) }));
  r.get('/api/library/:id/video', async (ctx) => {
    const file = app.library.videoFile(auth(ctx).id, ctx.params.id);
    if (!file) throw new ApiError(404, '아직 렌더된 MP4 가 없습니다. 미리보기는 원본 영상을 타임라인대로 이어서 재생합니다.');
    return { _file: file, mime: 'video/mp4', filename: `${ctx.params.id}.mp4`, inline: ctx.query.download !== '1' };
  });
  r.get('/api/preview/:kind/:refId', async (ctx) => app.library.previewSpec(auth(ctx).id, ctx.params.kind, ctx.params.refId));

  // ---- 유튜브 최적화(제목·태그·설명) + 썸네일 ----
  const seoRef = (ctx) => {
    const user = auth(ctx); const { kind, refId } = ctx.params;
    const col = { shorts: 'clips', remix: 'remixJobs', longform: 'longformJobs' }[kind];
    const rec = col && app.store.get(col, refId);
    if (!rec || rec.userId !== user.id) throw new ApiError(404, '작업을 찾을 수 없습니다.');
    return { user, kind, refId, col, rec, job: kind === 'shorts' ? app.store.get('jobs', rec.jobId) : rec };
  };
  r.get('/api/seo/:kind/:refId', async (ctx) => { const { rec } = seoRef(ctx); return rec.seo || rec.result?.seo || null; });
  r.post('/api/seo/:kind/:refId', async (ctx) => {
    const { kind, refId, col, rec, job } = seoRef(ctx);
    const src = job.source || {};
    const segments = kind === 'shorts' ? rec.subtitles : (rec.result?.subtitles || []);
    const seo = await app.seo.generate({ kind, title: ctx.body.title || (kind === 'shorts' ? rec.title : rec.result?.plan?.title || src.title), hook: ctx.body.hook || (kind === 'shorts' ? rec.hook?.text : rec.result?.plan?.hook) || '', originalTitle: src.title || '', originalTags: src.tags || [], originalDescription: src.description || '', channel: src.channel || '', segments, genre: rec.genre || rec.result?.genre || 'general', durationSec: kind === 'shorts' ? rec.durationSec : (rec.result?.finalDurationSec || rec.result?.editedDurationSec || 0), language: ctx.body.language || 'ko' });
    if (kind === 'shorts') app.store.update(col, refId, { seo }); else app.store.update(col, refId, { result: { ...rec.result, seo } });
    app.activity.log(ctx.user.id, { kind: 'seo', refId, title: seo.bestTitle, result: { titles: seo.titles.length } });
    return seo;
  });
  r.get('/api/thumbnail/proxy', async (ctx) => {
    auth(ctx);
    const url = String(ctx.query.url || '');
    if (!app.thumbnail.isAllowedProxy(url)) throw new ApiError(400, '허용되지 않은 이미지 주소입니다.');
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new ApiError(res.status === 404 ? 404 : 502, '이미지를 가져오지 못했습니다.');
    ctx.res.writeHead(200, { 'Content-Type': res.headers.get('content-type') || 'image/jpeg', 'Cache-Control': 'public, max-age=86400', 'Access-Control-Allow-Origin': '*' });
    ctx.res.end(Buffer.from(await res.arrayBuffer()));
    return { _sent: true };
  });
  r.get('/api/thumbnail/:kind/:refId', async (ctx) => { const { user, kind, refId } = seoRef(ctx); return { set: app.thumbnail.get(user.id, kind, refId), candidates: await app.thumbnail.candidates(user.id, kind, refId), styles: (await import('@alphaman/core')).THUMB_STYLES, palettes: (await import('@alphaman/core')).THUMB_PALETTES }; });
  r.post('/api/thumbnail/:kind/:refId/auto', async (ctx) => { const { user, kind, refId } = seoRef(ctx); const set = await app.thumbnail.auto(user.id, kind, refId, ctx.body || {}); app.activity.log(user.id, { kind: 'thumbnail', refId, title: set.headline, result: { style: set.style } }); return set; });
  r.put('/api/thumbnail/:kind/:refId', async (ctx) => { const { user, kind, refId } = seoRef(ctx); return app.thumbnail.update(user.id, kind, refId, ctx.body || {}); });
  r.post('/api/thumbnail/:kind/:refId/frame', async (ctx) => { const { user, kind, refId } = seoRef(ctx); return app.thumbnail.addUserFrame(user.id, kind, refId, { buffer: ctx.raw, at: ctx.headers['x-at'] != null ? Number(ctx.headers['x-at']) : null, mime: ctx.headers['content-type'] || 'image/jpeg' }); });
  r.get('/api/thumbnail/:kind/:refId/image.svg', async (ctx) => { const { user, kind, refId } = seoRef(ctx); ctx.res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'private, max-age=60' }); ctx.res.end(app.thumbnail.svg(user.id, kind, refId)); return { _sent: true }; });
  r.get('/api/thumbnail/:kind/:refId/frame/:idx', async (ctx) => { const { user, kind, refId } = seoRef(ctx); const f = app.thumbnail.frameFile(user.id, kind, refId, ctx.params.idx); return { _file: f.path, mime: f.mime, filename: path.basename(f.path), inline: true }; });
  // 업로드한 원본 스트리밍 (미리보기 플레이어 · 브라우저 대본 추출용). 본인 파일만.
  r.get('/api/uploads/:id/stream', async (ctx) => {
    const up = app.store.get('uploads', ctx.params.id);
    const owner = ctx.query.share ? app.share.ownerForToken(ctx.query.share, { uploadId: ctx.params.id }) : auth(ctx).id;
    if (!up || up.userId !== owner) throw new ApiError(404, '업로드된 파일을 찾을 수 없습니다.');
    const { ensureLocalFile } = await import('@alphaman/core');
    await ensureLocalFile(up);
    if (!fs.existsSync(up.path)) throw new ApiError(410, '원본 파일이 더 이상 서버에 없습니다 (서버리스 환경은 업로드 파일을 오래 보관하지 않습니다). 다시 업로드하거나 프로그램 버전을 사용해주세요.');
    return { _file: up.path, mime: up.mimeType || 'video/mp4', filename: up.displayName || up.filename, inline: ctx.query.download !== '1' };
  });
  // 프로그램(데스크톱) 버전 전용: 컴퓨터/USB 의 로컬 영상 스트리밍
  r.get('/api/local/stream', async (ctx) => {
    auth(ctx);
    if (app.platform !== 'desktop') throw new ApiError(403, '프로그램 버전에서만 사용할 수 있습니다.');
    const p = String(ctx.query.path || '');
    if (!p || !fs.existsSync(p) || fs.statSync(p).isDirectory()) throw new ApiError(404, '파일을 찾을 수 없습니다.');
    const ext = path.extname(p).toLowerCase();
    return { _file: p, mime: { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4' }[ext] || 'application/octet-stream', filename: path.basename(p), inline: true };
  });

  // ---- 내 목소리 TTS ----
  r.get('/api/voice/free', async () => ({ voices: app.voice.freeVoices(), providers: app.voice.providers(), styles: (await import('@alphaman/core')).VOICE_STYLES }));
  r.get('/api/voice/profiles', async (ctx) => ({ profiles: app.voice.list(auth(ctx).id), providers: app.voice.providers(), freeVoices: app.voice.freeVoices() }));
  r.get('/api/voice/profiles/:id/sample', async (ctx) => { const f = app.voice.sampleFile(auth(ctx).id, ctx.params.id); if (f.redirect) { ctx.res.writeHead(302, { Location: f.redirect }); ctx.res.end(); return { _sent: true }; } return { _file: f.path, mime: f.mime, filename: f.filename, inline: true }; });
  r.post('/api/voice/profiles', async (ctx) => {
    const user = auth(ctx);
    const body = { ...ctx.body };
    if (body.localPath && app.platform !== 'desktop') delete body.localPath;
    return app.voice.createProfile(user.id, body);
  });
  r.patch('/api/voice/profiles/:id', async (ctx) => app.voice.rename(auth(ctx).id, ctx.params.id, ctx.body.name));
  r.delete('/api/voice/profiles/:id', async (ctx) => ({ ok: app.voice.remove(auth(ctx).id, ctx.params.id) }));
  r.post('/api/voice/synthesize', async (ctx) => { const u = auth(ctx); const started = new Date().toISOString(); try { const r = await app.voice.synthesize(u.id, ctx.body); app.activity.log(u.id, { kind: 'tts', refId: r.id, title: String(ctx.body.text || '').slice(0, 60), input: { ...ctx.body }, result: { engine: r.engine, audio: Boolean(r.audioPath) }, startedAt: started }); return r; } catch (err) { app.activity.log(u.id, { kind: 'tts', title: String(ctx.body.text || '').slice(0, 60), input: { ...ctx.body }, error: err, startedAt: started }); throw err; } });
  r.get('/api/voice/renders', async (ctx) => app.voice.renders(auth(ctx).id));
  r.get('/api/voice/renders/:id/audio', async (ctx) => {
    const owner = ctx.query.share ? app.share.ownerForToken(ctx.query.share, { renderId: ctx.params.id }) : auth(ctx).id;
    if (!owner) throw new ApiError(404, '음성을 찾을 수 없습니다.');
    const f = app.voice.renderFile(owner, ctx.params.id);
    if (f.redirect) { ctx.res.writeHead(302, { Location: f.redirect }); ctx.res.end(); return { _sent: true }; }
    return { _file: f.path, mime: f.mime, filename: f.filename, inline: ctx.query.download !== '1' };
  });

  // ---- 자막 편집기 (픽셀링) ----
  r.get('/api/subtitles/fonts', async () => ({ fonts: app.subtitles.fonts(), presets: app.subtitles.presets() }));
  r.get('/api/subtitles/projects', async (ctx) => app.subtitles.list(auth(ctx).id));
  r.post('/api/subtitles/projects', async (ctx) => {
    const user = auth(ctx);
    if (ctx.body.uploadId) return app.subtitles.createFromUpload(user.id, ctx.body);
    if (ctx.body.localPath && app.platform === 'desktop') return app.subtitles.createFromLocalPath(user.id, { filePath: ctx.body.localPath, language: ctx.body.language, premium: ctx.body.premium, transcript: ctx.body.transcript, transcriptText: ctx.body.transcriptText });
    return app.subtitles.createFromUrl(user.id, ctx.body);
  });
  r.get('/api/subtitles/projects/:id', async (ctx) => app.subtitles.get(auth(ctx).id, ctx.params.id));
  r.delete('/api/subtitles/projects/:id', async (ctx) => ({ ok: app.subtitles.remove(auth(ctx).id, ctx.params.id) }));
  r.put('/api/subtitles/projects/:id/segments', async (ctx) => app.subtitles.updateSegments(auth(ctx).id, ctx.params.id, ctx.body.segments));
  r.post('/api/subtitles/projects/:id/split', async (ctx) => app.subtitles.splitSegment(auth(ctx).id, ctx.params.id, ctx.body.segmentId, Number(ctx.body.at)));
  r.post('/api/subtitles/projects/:id/merge', async (ctx) => app.subtitles.mergeSegments(auth(ctx).id, ctx.params.id, ctx.body.segmentIds));
  r.post('/api/subtitles/projects/:id/resplit', async (ctx) => app.subtitles.resplit(auth(ctx).id, ctx.params.id, ctx.body));
  r.post('/api/subtitles/projects/:id/undo', async (ctx) => app.subtitles.undo(auth(ctx).id, ctx.params.id));
  r.post('/api/subtitles/projects/:id/redo', async (ctx) => app.subtitles.redo(auth(ctx).id, ctx.params.id));
  r.get('/api/subtitles/projects/:id/history', async (ctx) => app.subtitles.historyInfo(auth(ctx).id, ctx.params.id));
  r.get('/api/subtitles/projects/:id/search', async (ctx) => app.subtitles.search(auth(ctx).id, ctx.params.id, ctx.query.q, { language: ctx.query.language || null }));
  r.post('/api/subtitles/projects/:id/replace', async (ctx) => app.subtitles.findReplace(auth(ctx).id, ctx.params.id, ctx.body));
  r.post('/api/subtitles/projects/:id/shift', async (ctx) => app.subtitles.shiftTime(auth(ctx).id, ctx.params.id, ctx.body));
  r.post('/api/subtitles/projects/:id/import-vtt', async (ctx) => app.subtitles.importVtt(auth(ctx).id, ctx.params.id, ctx.body.vtt));
  r.put('/api/subtitles/projects/:id/style', async (ctx) => app.subtitles.setStyle(auth(ctx).id, ctx.params.id, ctx.body));
  r.post('/api/subtitles/projects/:id/import', async (ctx) => app.subtitles.importSrt(auth(ctx).id, ctx.params.id, ctx.body.srt));
  r.post('/api/subtitles/projects/:id/translate', async (ctx) => app.subtitles.translateProject(auth(ctx).id, ctx.params.id, ctx.body.target));
  r.get('/api/subtitles/projects/:id/export', async (ctx) => { const out = app.subtitles.export(auth(ctx).id, ctx.params.id, ctx.query); return { _raw: out.body, mime: out.mime, filename: out.filename }; });

  // ---- 번역 ----
  r.get('/api/translate/targets', async () => app.translate.targets());
  r.post('/api/translate', async (ctx) => { auth(ctx); return ctx.body.segments ? { segments: await app.translate.translateSegments(ctx.body.segments, ctx.body.target) } : app.translate.translateText(ctx.body.text, ctx.body.target, ctx.body); });

  // ---- SNS 업로드 ----
  r.get('/api/publish/platforms', async () => app.publish.platforms());
  r.get('/api/publish/accounts', async (ctx) => app.publish.accounts(auth(ctx).id));
  r.post('/api/publish/accounts', async (ctx) => app.publish.connect(auth(ctx).id, ctx.body));
  r.delete('/api/publish/accounts/:id', async (ctx) => ({ ok: app.publish.disconnect(auth(ctx).id, ctx.params.id) }));
  r.get('/api/publish/queue', async (ctx) => app.publish.queue(auth(ctx).id));
  r.post('/api/publish/schedule', async (ctx) => app.publish.schedule(auth(ctx).id, ctx.body));
  r.delete('/api/publish/queue/:id', async (ctx) => app.publish.cancel(auth(ctx).id, ctx.params.id));

  // ---- 알파토픽 ----
  r.get('/api/topic/reports', async (ctx) => app.topic.list(auth(ctx).id));
  r.post('/api/topic/analyze', async (ctx) => app.topic.analyze(auth(ctx).id, ctx.body));
  r.get('/api/topic/reports/:id', async (ctx) => app.topic.get(auth(ctx).id, ctx.params.id));
  r.post('/api/topic/script', async (ctx) => app.topic.generateScript(auth(ctx).id, ctx.body));

  // ---- 디스커버리 ----
  r.get('/api/discovery/home', async (ctx) => app.discovery.home(ctx.user));
  r.get('/api/discovery/videos', async ({ query }) => app.discovery.videos(query));
  r.get('/api/discovery/channels', async ({ query }) => app.discovery.channels(query));
  r.get('/api/discovery/community', async ({ query }) => app.discovery.community(query));
  r.get('/api/discovery/news', async ({ query }) => app.discovery.news(query));
  r.get('/api/discovery/random', async ({ query }) => app.discovery.random(query));
  r.get('/api/discovery/signals', async () => app.discovery.signals());

  // ---- 픽시 챗봇 / 지원 ----
  r.get('/api/pixie/threads', async (ctx) => app.pixie.threads(auth(ctx).id));
  r.post('/api/pixie/chat', async (ctx) => app.pixie.chat(ctx.user, ctx.body));
  r.post('/api/pixie/escalate', async (ctx) => app.pixie.escalate(ctx.user, ctx.body));
  r.get('/api/pixie/threads/:id', async (ctx) => app.pixie.syncAdminReplies(auth(ctx).id, ctx.params.id));
  r.post('/api/support/inquiries', async (ctx) => app.support.createInquiry({ user: ctx.user, ...ctx.body }));
  r.get('/api/support/inquiries', async (ctx) => app.support.myInquiries(auth(ctx).id));
  r.post('/api/support/inquiries/:id/messages', async (ctx) => app.support.addUserMessage(auth(ctx).id, ctx.params.id, ctx.body.text));
  r.post('/api/feedback', async (ctx) => app.support.feedback({ user: ctx.user, ...ctx.body }));
  r.get('/api/notifications', async (ctx) => app.notifications.list(auth(ctx).id, ctx.query));
  r.post('/api/notifications/read', async (ctx) => ({ ok: app.notifications.markRead(auth(ctx).id, ctx.body.ids || null) }));
  r.post('/api/notifications/delete', async (ctx) => ({ removed: app.notifications.remove(auth(ctx).id, ctx.body.ids || null) }));

  // ---- 프로젝트 관리 (기존 작업을 프로젝트로 묶어 관리) ----
  r.get('/api/projects', async (ctx) => app.projects.list(auth(ctx).id, ctx.query));
  r.post('/api/projects/import', async (ctx) => { const user = auth(ctx); const out = app.projects.importProject(user.id, ctx.body); app.activity.log(user.id, { kind: 'import', refId: out.project.refId, title: out.project.title, result: { link: out.project.route } }); return out; });
  r.post('/api/projects/trash/empty', async (ctx) => ({ removed: app.projects.emptyTrash(auth(ctx).id) }));
  r.get('/api/projects/:kind/:id', async (ctx) => app.projects.get(auth(ctx).id, ctx.params.kind, ctx.params.id));
  r.patch('/api/projects/:kind/:id', async (ctx) => { const u = auth(ctx); const { kind, id } = ctx.params; let out; if (ctx.body.title != null) out = app.projects.rename(u.id, kind, id, ctx.body.title); if (ctx.body.favorite !== undefined) out = app.projects.favorite(u.id, kind, id, ctx.body.favorite); if (ctx.body.tags) out = app.projects.setTags(u.id, kind, id, ctx.body.tags); return out || app.projects.get(u.id, kind, id); });
  r.post('/api/projects/:kind/:id/duplicate', async (ctx) => app.projects.duplicate(auth(ctx).id, ctx.params.kind, ctx.params.id));
  r.post('/api/projects/:kind/:id/trash', async (ctx) => app.projects.trash(auth(ctx).id, ctx.params.kind, ctx.params.id));
  r.post('/api/projects/:kind/:id/restore', async (ctx) => app.projects.restore(auth(ctx).id, ctx.params.kind, ctx.params.id));
  r.delete('/api/projects/:kind/:id', async (ctx) => ({ ok: app.projects.destroy(auth(ctx).id, ctx.params.kind, ctx.params.id) }));
  r.get('/api/projects/:kind/:id/position', async (ctx) => ({ position: app.projects.getPosition(auth(ctx).id, ctx.params.kind, ctx.params.id) }));
  r.put('/api/projects/:kind/:id/position', async (ctx) => ({ ok: Boolean(app.projects.setPosition(auth(ctx).id, ctx.params.kind, ctx.params.id, ctx.body.position)) }));
  r.get('/api/projects/:kind/:id/versions', async (ctx) => app.projects.versions(auth(ctx).id, ctx.params.kind, ctx.params.id));
  r.post('/api/projects/:kind/:id/versions', async (ctx) => app.projects.snapshot(auth(ctx).id, ctx.params.kind, ctx.params.id, ctx.body));
  r.get('/api/projects/:kind/:id/versions/:vid', async (ctx) => app.projects.version(auth(ctx).id, ctx.params.kind, ctx.params.id, ctx.params.vid));
  r.post('/api/projects/:kind/:id/versions/:vid/restore', async (ctx) => app.projects.restoreVersion(auth(ctx).id, ctx.params.kind, ctx.params.id, ctx.params.vid));
  r.delete('/api/projects/:kind/:id/versions/:vid', async (ctx) => ({ ok: app.projects.removeVersion(auth(ctx).id, ctx.params.kind, ctx.params.id, ctx.params.vid) }));
  r.get('/api/projects/:kind/:id/export', async (ctx) => { const data = app.projects.exportProject(auth(ctx).id, ctx.params.kind, ctx.params.id); return { _raw: JSON.stringify(data, null, 2), mime: 'application/json', filename: `${String(data.title).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60)}.alphaman.json` }; });
  r.post('/api/projects/:kind/:id/apply', async (ctx) => app.projects.applySettings(auth(ctx).id, ctx.params.kind, ctx.params.id, ctx.body));

  // ---- 작업 히스토리 / AI 작업 진행 센터 ----
  r.get('/api/activities', async (ctx) => app.activity.list(auth(ctx).id, ctx.query));
  r.post('/api/activities/clear', async (ctx) => ({ removed: app.activity.clearFinished(auth(ctx).id) }));
  r.get('/api/activities/:id', async (ctx) => app.activity.get(auth(ctx).id, ctx.params.id));
  r.delete('/api/activities/:id', async (ctx) => ({ ok: app.activity.remove(auth(ctx).id, ctx.params.id) }));
  r.post('/api/activities/:id/cancel', async (ctx) => app.activity.cancel(auth(ctx).id, ctx.params.id));
  r.post('/api/activities/:id/rerun', async (ctx) => app.activity.rerun(auth(ctx).id, ctx.params.id));

  // ---- 파일 관리자 (Media Library) ----
  r.get('/api/media', async (ctx) => app.media.list(auth(ctx).id, ctx.query));
  r.patch('/api/media/:id', async (ctx) => ({ ok: app.media.rename(auth(ctx).id, ctx.params.id, ctx.body.name) }));
  r.post('/api/media/:id/trash', async (ctx) => ({ ok: app.media.trash(auth(ctx).id, ctx.params.id) }));
  r.post('/api/media/:id/restore', async (ctx) => ({ ok: app.media.restore(auth(ctx).id, ctx.params.id) }));
  r.delete('/api/media/:id', async (ctx) => ({ ok: app.media.destroy(auth(ctx).id, ctx.params.id) }));

  // ---- 사용자 템플릿 ----
  r.get('/api/templates', async (ctx) => app.templates.list(auth(ctx).id, ctx.query.kind || ''));
  r.post('/api/templates', async (ctx) => app.templates.create(auth(ctx).id, ctx.body));
  r.patch('/api/templates/:id', async (ctx) => app.templates.update(auth(ctx).id, ctx.params.id, ctx.body));
  r.delete('/api/templates/:id', async (ctx) => ({ ok: app.templates.remove(auth(ctx).id, ctx.params.id) }));
  r.post('/api/templates/:id/use', async (ctx) => app.templates.markUsed(auth(ctx).id, ctx.params.id));

  // ---- 공유 링크 ----
  r.get('/api/shares', async (ctx) => app.share.list(auth(ctx).id));
  r.post('/api/shares', async (ctx) => app.share.create(auth(ctx).id, ctx.body));
  r.post('/api/shares/:id/revoke', async (ctx) => ({ ok: app.share.revoke(auth(ctx).id, ctx.params.id) }));
  r.delete('/api/shares/:id', async (ctx) => ({ ok: app.share.remove(auth(ctx).id, ctx.params.id) }));
  r.get('/api/share/:token', async (ctx) => app.share.resolve(ctx.params.token));

  // ---- 전체 검색 ----
  r.get('/api/search', async (ctx) => {
    const user = auth(ctx); const q = String(ctx.query.q || '').trim().toLowerCase();
    if (!q) return { q, results: [] };
    const results = [];
    for (const p of app.projects.list(user.id, { q }).items) results.push({ type: 'project', kind: p.kind, title: p.title, subtitle: `${p.kindLabel} · ${p.status}`, route: p.route, at: p.updatedAt });
    for (const m of app.media.list(user.id, { q }).items) results.push({ type: 'media', kind: m.category, title: m.name, subtitle: `${app.media.list(user.id, {}).categories[m.category]}`, route: `#/media?q=${encodeURIComponent(q)}`, at: m.createdAt });
    for (const t of app.templates.list(user.id).filter((t) => t.name.toLowerCase().includes(q))) results.push({ type: 'template', kind: t.kind, title: t.name, subtitle: '템플릿', route: '#/settings?tab=templates', at: t.updatedAt });
    for (const a of app.activity.list(user.id).items.filter((a) => `${a.title} ${a.kindLabel}`.toLowerCase().includes(q)).slice(0, 20)) results.push({ type: 'activity', kind: a.kind, title: a.title || a.kindLabel, subtitle: `작업 기록 · ${a.status}`, route: `#/jobs?id=${a.id}`, at: a.createdAt });
    for (const p of app.subtitles.list(user.id)) { const hits = app.subtitles.search(user.id, p.id, q).slice(0, 3); for (const h of hits) results.push({ type: 'subtitle-line', kind: 'subtitle', title: h.text, subtitle: `${p.projectTitle || p.source.title} · ${Math.floor(h.start / 60)}:${String(Math.floor(h.start % 60)).padStart(2, '0')}`, route: `#/subtitles/${p.id}?seg=${encodeURIComponent(h.id)}`, at: p.updatedAt }); }
    return { q, results: results.sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))).slice(0, 100) };
  });

  // ---- 사용량 / 클라이언트 오류 보고 ----
  r.get('/api/usage', async (ctx) => app.usage.usage(auth(ctx).id));
  r.post('/api/client-errors', async (ctx) => { rateLimit(`cerr:${clientIp(ctx.req)}`, 60, 10 * 60 * 1000); const b = ctx.body || {}; app.errors.log({ level: 'error', source: 'client', message: b.message, stack: b.stack, route: b.route, userId: ctx.user?.id || null, meta: { ua: String(ctx.headers['user-agent'] || '').slice(0, 200) } }); return { ok: true }; });

  // ---- 무료 도구 ----
  r.get('/api/tools', async () => app.tools.list());
  r.post('/api/tools/:id/run', async (ctx) => app.tools.run(ctx.params.id, ctx.body));

  // ---- 관리자 ----
  r.get('/api/admin/stats', async (ctx) => { admin(ctx); return app.admin.stats(); });
  r.get('/api/admin/diag', async (ctx) => { admin(ctx); return app.diagnostics(); });
  r.get('/api/admin/system', async (ctx) => { admin(ctx); return app.system.status(); });
  r.get('/api/admin/errors', async (ctx) => { admin(ctx); return { items: app.errors.list(ctx.query), stats: app.errors.stats() }; });
  r.post('/api/admin/errors/clear', async (ctx) => { admin(ctx); return { removed: app.errors.clear() }; });
  r.get('/api/admin/storage', async (ctx) => { admin(ctx); return app.system.storageByUser(); });
  r.get('/api/admin/backups', async (ctx) => { admin(ctx); return { items: app.backup.list(), lastBackupAt: app.store.setting('lastBackupAt') }; });
  r.post('/api/admin/backups', async (ctx) => { admin(ctx); return app.backup.backup({ reason: 'manual' }); });
  r.post('/api/admin/backups/:id/restore', async (ctx) => { const a = admin(ctx); app.store.insert('auditLog', { userId: a.id, action: 'admin.backup.restore', backupId: ctx.params.id }); return app.backup.restore(ctx.params.id, { merge: ctx.body?.merge !== false }); });
  r.get('/api/admin/orders', async (ctx) => { admin(ctx); return app.payments.adminOrders(); });
  r.get('/api/admin/activities', async (ctx) => { admin(ctx); return { queue: app.activity.queue.stats(), recent: app.store.find('activities').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100) }; });
  r.get('/api/admin/users', async (ctx) => { admin(ctx); return app.admin.users(ctx.query); });
  r.get('/api/admin/users/:id', async (ctx) => { admin(ctx); return app.admin.user(ctx.params.id); });
  r.patch('/api/admin/users/:id', async (ctx) => app.admin.updateUser(admin(ctx), ctx.params.id, ctx.body));
  r.delete('/api/admin/users/:id', async (ctx) => ({ ok: app.admin.deleteUser(admin(ctx), ctx.params.id) }));
  r.post('/api/admin/users/:id/credits', async (ctx) => (Number(ctx.body.minutes) >= 0 ? app.admin.grantCredits(admin(ctx), ctx.params.id, ctx.body.minutes, ctx.body.reason) : app.admin.revokeCredits(admin(ctx), ctx.params.id, -ctx.body.minutes, ctx.body.reason)));
  r.get('/api/admin/jobs', async (ctx) => { admin(ctx); return app.admin.jobs(ctx.query); });
  r.get('/api/admin/inquiries', async (ctx) => { admin(ctx); return app.admin.inquiries(ctx.query); });
  r.post('/api/admin/inquiries/:id/reply', async (ctx) => app.admin.replyInquiry(admin(ctx), ctx.params.id, ctx.body.text));
  r.post('/api/admin/inquiries/:id/close', async (ctx) => { admin(ctx); return app.admin.closeInquiry(ctx.params.id); });
  r.get('/api/admin/feedback', async (ctx) => { admin(ctx); return app.admin.feedback(); });
  r.get('/api/admin/teams', async (ctx) => { admin(ctx); return app.admin.teamRequests(); });
  r.post('/api/admin/teams/:id', async (ctx) => app.admin.resolveTeamRequest(admin(ctx), ctx.params.id, ctx.body));
  r.get('/api/admin/notices', async (ctx) => { admin(ctx); return app.admin.notices(); });
  r.post('/api/admin/notices', async (ctx) => app.admin.createNotice(admin(ctx), ctx.body));
  r.patch('/api/admin/notices/:id', async (ctx) => { admin(ctx); return app.admin.updateNotice(ctx.params.id, ctx.body); });
  r.delete('/api/admin/notices/:id', async (ctx) => { admin(ctx); return { ok: app.admin.deleteNotice(ctx.params.id) }; });
  r.get('/api/admin/settings', async (ctx) => { admin(ctx); return app.admin.settings(); });
  r.patch('/api/admin/settings', async (ctx) => app.admin.updateSettings(admin(ctx), ctx.body));
  r.get('/api/admin/audit', async (ctx) => { admin(ctx); return app.admin.auditLog(); });
  r.get('/api/admin/publish', async (ctx) => { admin(ctx); return app.admin.publishQueue(); });
  r.get('/api/admin/payments', async (ctx) => { admin(ctx); return app.admin.payments(); });
  r.post('/api/admin/publish/tick', async (ctx) => { admin(ctx); return { processed: app.publish.tick() }; });

  return r;
}
