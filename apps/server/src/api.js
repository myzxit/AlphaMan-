// REST API: 모든 코어 기능을 HTTP 로 노출. 웹사이트 버전과 프로그램 버전(내장 서버)이 동일하게 사용한다.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ApiError } from '@alphaman/core';
import { Router } from './router.js';

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
  r.post('/api/auth/login', async ({ body }) => app.auth.login(body));
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
  r.get('/api/referral', async (ctx) => app.credits.referralSummary(auth(ctx).id));
  r.post('/api/referral/apply', async (ctx) => ({ referrerId: app.credits.applyReferral(auth(ctx).id, ctx.body.code) }));
  r.post('/api/team/request', async (ctx) => app.support.teamRequest({ user: auth(ctx), ...ctx.body }));

  // ---- 업로드 (raw body, X-Filename 헤더) ----
  r.post('/api/upload', async (ctx) => {
    const user = auth(ctx);
    const filename = decodeURIComponent(ctx.headers['x-filename'] || 'upload.mp4');
    const mimeType = ctx.headers['content-type'] || 'video/mp4';
    const dir = path.join(app.uploadsDir, user.id);
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, `${randomUUID()}${path.extname(filename).toLowerCase() || '.mp4'}`);
    fs.writeFileSync(dest, ctx.raw);
    return app.registerUpload(user.id, { filename, mimeType, size: ctx.raw.length, path: dest });
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
  // 업로드한 원본 스트리밍 (미리보기 플레이어 · 브라우저 대본 추출용). 본인 파일만.
  r.get('/api/uploads/:id/stream', async (ctx) => {
    const up = app.store.get('uploads', ctx.params.id);
    if (!up || up.userId !== auth(ctx).id) throw new ApiError(404, '업로드된 파일을 찾을 수 없습니다.');
    if (!fs.existsSync(up.path)) throw new ApiError(410, '원본 파일이 더 이상 서버에 없습니다 (서버리스 환경은 업로드 파일을 오래 보관하지 않습니다). 다시 업로드하거나 프로그램 버전을 사용해주세요.');
    return { _file: up.path, mime: up.mimeType || 'video/mp4', filename: up.filename, inline: true };
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
  r.get('/api/voice/profiles', async (ctx) => ({ profiles: app.voice.list(auth(ctx).id), providers: app.voice.providers() }));
  r.post('/api/voice/profiles', async (ctx) => {
    const user = auth(ctx);
    const body = { ...ctx.body };
    if (body.localPath && app.platform !== 'desktop') delete body.localPath;
    return app.voice.createProfile(user.id, body);
  });
  r.patch('/api/voice/profiles/:id', async (ctx) => app.voice.rename(auth(ctx).id, ctx.params.id, ctx.body.name));
  r.delete('/api/voice/profiles/:id', async (ctx) => ({ ok: app.voice.remove(auth(ctx).id, ctx.params.id) }));
  r.post('/api/voice/synthesize', async (ctx) => app.voice.synthesize(auth(ctx).id, ctx.body));
  r.get('/api/voice/renders', async (ctx) => app.voice.renders(auth(ctx).id));
  r.get('/api/voice/renders/:id/audio', async (ctx) => {
    const rec = app.store.get('voiceRenders', ctx.params.id);
    if (!rec || rec.userId !== auth(ctx).id) throw new ApiError(404, '음성을 찾을 수 없습니다.');
    if (!rec.audioPath || !fs.existsSync(rec.audioPath)) throw new ApiError(404, '아직 실제 음성 파일이 생성되지 않았습니다 (TTS 제공자 미설정).');
    return { _file: rec.audioPath, mime: rec.audioPath.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg', filename: path.basename(rec.audioPath) };
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

  // ---- 무료 도구 ----
  r.get('/api/tools', async () => app.tools.list());
  r.post('/api/tools/:id/run', async (ctx) => app.tools.run(ctx.params.id, ctx.body));

  // ---- 관리자 ----
  r.get('/api/admin/stats', async (ctx) => { admin(ctx); return app.admin.stats(); });
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
