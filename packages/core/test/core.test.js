import test from 'node:test';
import assert from 'node:assert/strict';
import { AlphaMan, ADMIN_ACCOUNT, validateVideoMeta, parseYoutubeUrl, toSRT, toVTT, toASS, semanticSplit, nextOccurrences, ApiError } from '../src/index.js';

process.env.ALPHAMAN_AI = 'off';
process.env.ALPHAMAN_ALLOW_SIMULATED_STT = '1';
process.env.ALPHAMAN_JOB_SPEED = '1000';

function app() { return new AlphaMan({ memory: true, platform: 'test' }); }
function waitFor(fn, ms = 4000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const t = setInterval(() => { const v = fn(); if (v) { clearInterval(t); resolve(v); } else if (Date.now() - started > ms) { clearInterval(t); reject(new Error('timeout')); } }, 20);
  });
}

test('관리자 계정이 시드되고 로그인된다', () => {
  const a = app();
  const { user } = a.auth.login({ email: ADMIN_ACCOUNT.email, password: ADMIN_ACCOUNT.password });
  assert.equal(user.email, 'hhudeu66@gmail.com');
  assert.equal(user.role, 'admin');
  assert.equal(user.isAdmin, true);
  assert.throws(() => a.auth.login({ email: ADMIN_ACCOUNT.email, password: 'wrong' }), ApiError);
  // 두 번 생성해도 관리자는 하나
  a.auth.seedAdmin();
  assert.equal(a.store.count('users', (u) => u.role === 'admin'), 1);
  a.close();
});

test('회원가입 시 30분 무료 이용권, 추천인 보상', () => {
  const a = app();
  const s1 = a.auth.signup({ email: 'a@test.com', password: 'secret1', name: 'A' });
  assert.equal(s1.user.credits, 30);
  const s2 = a.auth.signup({ email: 'b@test.com', password: 'secret1', referral: s1.user.referralCode });
  assert.equal(s2.user.credits, 60);
  assert.equal(a.credits.balance(s1.user.id), 60);
  assert.equal(a.credits.referralSummary(s1.user.id).invited, 1);
  a.close();
});

test('쇼츠 파이프라인: 이용권 차감, 2분당 1개 클립, 편집, 재생성 절반 차감', async () => {
  const a = app();
  const { user } = a.auth.signup({ email: 'c@test.com', password: 'secret1' });
  a.credits.grant(user.id, 100, 'test');
  const job = await a.shorts.createFromYoutube(user.id, { url: 'https://youtu.be/dQw4w9WgXcQ', options: { estimatedDurationSec: 600, targetLanguages: ['ja'] } });
  assert.equal(job.minutesCharged, 10);
  assert.equal(a.credits.balance(user.id), 120);
  const done = await waitFor(() => { const j = a.store.get('jobs', job.id); return j.status === 'done' ? j : null; });
  assert.equal(done.clipIds.length, 5);
  const full = a.shorts.getJob(user.id, job.id);
  const clip = full.clips[0];
  assert.ok(clip.subtitles.length > 0);
  assert.ok(clip.hook);
  assert.ok(clip.zoomKeyframes.length > 0);
  assert.ok(clip.translations.ja);
  assert.ok(clip.audio.voiceEnhance);
  const edited = a.shorts.editClip(user.id, clip.id, { title: '새 제목', ratio: '1:1', start: clip.start, end: clip.start + 20 });
  assert.equal(edited.title, '새 제목');
  assert.equal(edited.ratio, '1:1');
  assert.equal(edited.durationSec, 20);
  assert.throws(() => a.shorts.editClip(user.id, clip.id, { ratio: '3:2' }), ApiError);
  const srt = a.shorts.exportClip(user.id, clip.id, 'srt');
  assert.match(srt.body, /-->/);
  await a.shorts.regenerate(user.id, job.id);
  assert.equal(a.credits.balance(user.id), 115);
  await waitFor(() => a.store.get('jobs', job.id).status === 'done');
  assert.equal(a.shorts.getJob(user.id, job.id).regenerations, 1);
  a.close();
});

test('이용권 부족 시 402', async () => {
  const a = app();
  const { user } = a.auth.signup({ email: 'd@test.com', password: 'secret1' });
  await assert.rejects(() => a.shorts.createFromYoutube(user.id, { url: 'https://www.youtube.com/watch?v=abcdefghijk', options: { estimatedDurationSec: 6000 } }), (e) => e.status === 402);
  a.close();
});

test('파일 검증 규칙', () => {
  assert.throws(() => validateVideoMeta({ filename: 'a.avi2', durationSec: 10, width: 1, height: 1 }), /형식은 지원되지 않습니다/);
  assert.throws(() => validateVideoMeta({ filename: 'a.mp4', codec: 'hevc', durationSec: 10, width: 1, height: 1 }), /HEVC/);
  assert.throws(() => validateVideoMeta({ filename: 'a.mp4', hasAudioTrack: false, durationSec: 10, width: 1, height: 1 }), /음성 트랙/);
  assert.throws(() => validateVideoMeta({ filename: 'a.mp4', hasVideoTrack: false, durationSec: 10, width: 1, height: 1 }), /영상 트랙/);
  assert.throws(() => validateVideoMeta({ filename: 'a.mp4', durationSec: 0, width: 1, height: 1 }), /비디오 길이/);
  assert.ok(validateVideoMeta({ filename: 'a.mp4', durationSec: 10, width: 1920, height: 1080 }).ok);
  assert.equal(parseYoutubeUrl('https://www.youtube.com/shorts/abcdefghijk').id, 'abcdefghijk');
  assert.throws(() => parseYoutubeUrl('https://example.com/x'), /유튜브 링크/);
});

test('자막 프로젝트: STT → 의미 분할 → 편집 → 번역 → 내보내기', async () => {
  const a = app();
  const { user } = a.auth.signup({ email: 'e@test.com', password: 'secret1' });
  const p = await a.subtitles.createFromUrl(user.id, { url: 'https://youtu.be/abcdefghijk', language: 'ko' });
  assert.equal(p.status, 'ready');
  assert.ok(p.segments.length > 5);
  assert.ok(p.waveform.peaks.length === 600);
  assert.equal(a.credits.balance(user.id), 30, '기본 기능은 무료');
  const first = p.segments[0];
  const before = p.segments.length;
  const split = a.subtitles.splitSegment(user.id, p.id, first.id, (first.start + first.end) / 2);
  assert.equal(split.segments.length, before + 1);
  const undone = a.subtitles.undo(user.id, p.id);
  assert.equal(undone.segments.length, before);
  const tr = await a.subtitles.translateProject(user.id, p.id, 'en');
  assert.ok(tr.translations.en.segments.length);
  for (const f of ['srt', 'vtt', 'ass']) assert.ok(a.subtitles.export(user.id, p.id, { format: f }).body.length > 20);
  assert.match(a.subtitles.export(user.id, p.id, { format: 'srt', language: 'en' }).filename, /\.en\.srt$/);
  a.subtitles.setStyle(user.id, p.id, { presetId: 'bold-yellow' });
  assert.equal(a.subtitles.get(user.id, p.id).style.font, 'black-han-sans');
  a.close();
});

test('자막 포맷', () => {
  const segs = [{ start: 0, end: 1.5, text: '안녕' }, { start: 2, end: 3.25, text: '세계' }];
  assert.match(toSRT(segs), /00:00:00,000 --> 00:00:01,500/);
  assert.match(toVTT(segs), /^WEBVTT/);
  assert.match(toASS(segs), /Dialogue: 0,0:00:02.00,0:00:03.25/);
  const split = semanticSplit([{ start: 0, end: 10, text: '이것은 아주 긴 문장입니다. 그래서 두 개로 나뉘어야 합니다. 맞죠?' }], { maxChars: 20 });
  assert.ok(split.length >= 2);
});

test('SNS 예약 업로드: 월수금 오전 10시 반복 및 즉시 업로드', async () => {
  const a = app();
  const { user } = a.auth.signup({ email: 'f@test.com', password: 'secret1' });
  const job = await a.shorts.createFromYoutube(user.id, { url: 'https://youtu.be/abcdefghijk', options: { estimatedDurationSec: 120 } });
  await waitFor(() => a.store.get('jobs', job.id).status === 'done');
  const clip = a.shorts.getJob(user.id, job.id).clips[0];
  const acc = a.publish.connect(user.id, { platform: 'youtube', handle: '@mychannel' });
  const items = a.publish.schedule(user.id, { clipId: clip.id, accountIds: [acc.id], schedule: { recurring: { days: ['mon', 'wed', 'fri'], time: '10:00' } } });
  assert.equal(items.length, 4);
  for (const it of items) { const d = new Date(it.scheduledAt); assert.ok([1, 3, 5].includes(d.getDay())); assert.equal(d.getHours(), 10); }
  const now = a.publish.schedule(user.id, { clipId: clip.id, accountIds: [acc.id], title: '즉시' });
  assert.equal(a.store.get('publishQueue', now[0].id).status, 'published');
  assert.throws(() => a.publish.connect(user.id, { platform: 'myspace', handle: 'x' }), ApiError);
  assert.equal(nextOccurrences({ days: ['sun'], time: '09:30' }, 2).length, 2);
  a.close();
});

test('디스커버리 · 픽시 · 문의 → 관리자 답변 → 채팅 동기화', async () => {
  const a = app();
  const { user } = a.auth.signup({ email: 'g@test.com', password: 'secret1', name: '웨펀마스터' });
  const home = a.discovery.home(user);
  assert.match(home.greeting, /웨펀마스터님/);
  assert.equal(home.top10.length, 10);
  assert.equal(a.discovery.videos({ regions: 'KR', limit: 5 }).items.length, 5);
  assert.ok(a.discovery.channels({ days: 1 }).items[0].dailyViews > 0);
  assert.ok(a.discovery.random().title);
  assert.throws(() => a.discovery.videos({ regions: 'XX' }), ApiError);
  const chat = await a.pixie.chat(user, { message: '쇼츠 몇 개 생성돼요?' });
  assert.match(chat.reply, /2분당 1개/);
  const esc = a.pixie.escalate(user, { threadId: chat.threadId, extra: '급해요' });
  const admin = a.auth.login({ email: ADMIN_ACCOUNT.email, password: ADMIN_ACCOUNT.password }).user;
  assert.equal(a.admin.inquiries().length, 1);
  a.admin.replyInquiry(admin, esc.inquiryId, '확인했습니다. 곧 도와드릴게요.');
  const synced = a.pixie.syncAdminReplies(user.id, chat.threadId);
  assert.ok(synced.messages.some((m) => m.role === 'admin'));
  assert.ok(a.notifications.list(user.id).some((n) => n.type === 'inquiry.answered'));
  assert.throws(() => a.support.createInquiry({ user: null, email: 'bad', message: 'x' }), /답변 받을 이메일/);
  a.close();
});

test('관리자: 통계, 이용권 지급/회수, 정지, 공지 방송, 설정', () => {
  const a = app();
  const admin = a.auth.login({ email: ADMIN_ACCOUNT.email, password: ADMIN_ACCOUNT.password }).user;
  const { user } = a.auth.signup({ email: 'h@test.com', password: 'secret1' });
  assert.equal(a.admin.stats().users.total, 2);
  a.admin.grantCredits(admin, user.id, 100, '이벤트');
  assert.equal(a.credits.balance(user.id), 130);
  a.admin.revokeCredits(admin, user.id, 30);
  assert.equal(a.credits.balance(user.id), 100);
  a.admin.updateUser(admin, user.id, { status: 'banned' });
  assert.throws(() => a.auth.login({ email: 'h@test.com', password: 'secret1' }), /이용이 제한/);
  assert.throws(() => a.admin.updateUser(admin, admin.id, { role: 'user' }), /기본 관리자/);
  a.admin.createNotice(admin, { title: '점검', body: '내용', broadcast: true });
  assert.ok(a.notifications.list(user.id).some((n) => n.type === 'notice'));
  assert.equal(a.admin.updateSettings(admin, { maintenance: true }).maintenance, true);
  assert.throws(() => a.admin.deleteUser(admin, admin.id), /삭제할 수 없습니다/);
  a.close();
});

test('알파토픽 · 롱폼 · 무료 도구 · 번역 · 결제', async () => {
  const a = app();
  const { user } = a.auth.signup({ email: 'i@test.com', password: 'secret1' });
  const rep = await a.topic.analyze(user.id, { channelUrl: 'https://youtube.com/@mych', competitors: ['https://youtube.com/@rival'], genre: 'vlog' });
  assert.equal(rep.report.recommendations.length, 3);
  assert.ok(rep.report.recommendations[0].thumbnail.text);
  const lf = await a.longform.create(user.id, { url: 'https://youtu.be/abcdefghijk', options: {} });
  const done = await waitFor(() => { const j = a.store.get('longformJobs', lf.id); return j.status === 'done' ? j : null; });
  assert.ok(done.result.chapters.length);
  assert.ok(done.result.removedSec > 0);
  assert.equal((await a.tools.run('credit-calculator', { minutes: 10 })).estimatedShorts, 5);
  assert.equal((await a.tools.run('yt-thumbnail', { url: 'https://youtu.be/abcdefghijk' })).thumbnails.length, 5);
  assert.ok((await a.tools.run('hook-checker', { text: '아무도 모르는 3가지 비밀?' })).score >= 80);
  const t = await a.translate.translateText('엄청 따뜻해서 좋고', 'ja');
  assert.equal(t.text, '熱々で良いです');
  const pay = a.credits.checkout(user.id, { planId: 'pro', region: 'overseas' });
  assert.equal(pay.currency, 'USD');
  // 30(가입) - 15(롱폼 15분) + 400(프로 요금제)
  assert.equal(a.credits.balance(user.id), 415);
  a.close();
});

test('관리자 이용권 무제한: 차감되지 않고 잔액은 무제한으로 표시', async () => {
  const a = app();
  const admin = a.auth.login({ email: ADMIN_ACCOUNT.email, password: ADMIN_ACCOUNT.password }).user;
  assert.equal(admin.creditsUnlimited, true);
  assert.equal(admin.credits, null);
  assert.equal(a.credits.balance(admin.id), Infinity);
  const job = await a.shorts.createFromYoutube(admin.id, { url: 'https://youtu.be/abcdefghijk', options: { estimatedDurationSec: 60 * 600 } });
  assert.equal(job.minutesCharged, 600);
  assert.equal(a.credits.balance(admin.id), Infinity);
  assert.ok(a.credits.ledger(admin.id).some((l) => l.delta === 0 && l.wouldCharge === -600));
  const normal = a.auth.signup({ email: 'n@test.com', password: 'secret1' }).user;
  assert.equal(normal.creditsUnlimited, false);
  await waitFor(() => a.store.get('jobs', job.id).status === 'done');
  a.close();
});

test('AI 재구성: 권리 확인 필수, 1~28분 범위, 참고 영상 스타일 반영, 자막·효과음·배경음 재구성, 다시 만들기 50%', async () => {
  const a = app();
  const { user } = a.auth.signup({ email: 'r@test.com', password: 'secret1' });
  a.credits.grant(user.id, 200, 'test');
  await assert.rejects(() => a.remix.create(user.id, { url: 'https://youtu.be/abcdefghijk', rightsConfirmed: false }), /권리/);
  await assert.rejects(() => a.remix.create(user.id, { url: 'https://youtu.be/abcdefghijk', rightsConfirmed: true, options: { targetMinutes: 40 } }), /1~28분/);
  await assert.rejects(() => a.remix.create(user.id, { rightsConfirmed: true }), /또는 파일 중 하나/);
  const job = await a.remix.create(user.id, { url: 'https://youtu.be/abcdefghijk', referenceUrl: 'https://www.youtube.com/watch?v=zyxwvutsrqp', rightsConfirmed: true, options: { targetMinutes: 3, estimatedDurationSec: 20 * 60 } });
  assert.equal(job.minutesCharged, 20);
  assert.equal(a.credits.balance(user.id), 210);
  assert.ok(job.reference);
  const done = await waitFor(() => { const j = a.store.get('remixJobs', job.id); return j.status === 'done' ? j : null; }, 8000);
  const r = done.result;
  assert.ok(r.styleProfile && r.styleProfile.pacing);
  // 참고 영상 구조를 따라 섹션 카드와 구간 길이 비율이 반영된다
  assert.ok(Array.isArray(r.styleProfile.segmentPattern) && Math.abs(r.styleProfile.segmentPattern.reduce((a, b) => a + b, 0) - 1) < 0.02);
  assert.ok(r.timeline.some((t) => t.kind === 'card' && r.styleProfile.structure.includes(t.title)));
  assert.ok(r.timeline.some((t) => t.section));
  assert.ok(r.mirroredFromReference.includes('segmentPattern'));
  // 쇼츠를 참고 영상으로 주면 비율이 자동으로 9:16
  const refShort = await a.remix.create(user.id, { url: 'https://youtu.be/abcdefghijk', referenceUrl: 'https://www.youtube.com/shorts/qqqqqqqqqqq', rightsConfirmed: true, options: { targetMinutes: 1, estimatedDurationSec: 300 } });
  const rsDone = await waitFor(() => { const j = a.store.get('remixJobs', refShort.id); return j.status === 'done' ? j : null; }, 8000);
  assert.equal(rsDone.result.ratio, '9:16');
  assert.equal(rsDone.result.styleProfile.reference.isShorts, true);
  assert.ok(r.finalDurationSec >= 60 && r.finalDurationSec <= 28 * 60);
  assert.ok(Math.abs(r.finalDurationSec - 180) <= 30, `목표 3분 근처여야 함: ${r.finalDurationSec}`);
  assert.ok(r.plan.keep.length > 0);
  assert.ok(r.subtitles.length > 0);
  assert.ok(r.sfx.length > 0);
  assert.ok(r.bgm && r.bgm.track);
  assert.ok(r.cleaning.steps.some((s) => s.id === 'burned-subtitles'));
  assert.ok(r.cleaning.steps.some((s) => s.id === 'audio-separation'));
  assert.ok(r.render.plan || r.render.rendered);
  assert.match(r.render.subtitleASS, /Dialogue/);
  const edited = a.remix.updateResult(user.id, job.id, { title: '새 제목', sfx: [{ at: 1, name: 'pop' }] });
  assert.equal(edited.result.plan.title, '새 제목');
  assert.equal(edited.result.sfx.length, 1);
  await a.remix.regenerate(user.id, job.id);
  // 230(가입+지급) - 20(첫 작업) - 5(참고 쇼츠 작업) - 10(다시 만들기 50%)
  assert.equal(a.credits.balance(user.id), 195);
  await waitFor(() => a.store.get('remixJobs', job.id).status === 'done', 8000);
  // 쇼츠 링크(짧은 원본)는 카드·리플레이·슬로모션으로 목표 길이까지 확장된다
  const short = await a.remix.create(user.id, { url: 'https://www.youtube.com/shorts/zyxwvutsrqp', rightsConfirmed: true, options: { targetMinutes: 10, estimatedDurationSec: 45 } });
  assert.equal(short.source.isShorts, true);
  const sdone = await waitFor(() => { const j = a.store.get('remixJobs', short.id); return j.status === 'done' ? j : null; }, 8000);
  assert.ok(Math.abs(sdone.result.finalDurationSec - 600) <= 30, `목표 10분 근처여야 함: ${sdone.result.finalDurationSec}`);
  assert.equal(sdone.result.extended, true);
  const kinds = new Set(sdone.result.timeline.map((t) => t.kind));
  assert.ok(kinds.has('source') && kinds.has('replay') && kinds.has('card'));
  assert.ok(sdone.result.subtitles.length > 10);
  assert.match(sdone.result.render.plan.args.join(' '), /concat=n=/);
  // TikTok / Reels 링크도 허용
  const tk = await a.remix.create(user.id, { url: 'https://www.tiktok.com/@user/video/7300000000000000000', rightsConfirmed: true, options: { targetMinutes: 1, estimatedDurationSec: 30 } });
  assert.equal(tk.source.type, 'tiktok');
  await waitFor(() => a.store.get('remixJobs', tk.id).status === 'done', 8000);
  a.close();
});

test('내 목소리 TTS: 샘플 업로드 → 프로필 → 합성, 쇼츠 후킹 보이스와 재구성 내레이션에 사용', async () => {
  const a = app();
  const { user } = a.auth.signup({ email: 'v@test.com', password: 'secret1' });
  a.credits.grant(user.id, 100, 'test');
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-voice-'));
  const sample = path.join(dir, 'me.wav'); fs.writeFileSync(sample, Buffer.alloc(16 * 1024 * 20)); // 추정 20초
  const tooShort = path.join(dir, 'short.wav'); fs.writeFileSync(tooShort, Buffer.alloc(16 * 1024 * 2));
  const up = a.registerUpload(user.id, { filename: 'me.wav', mimeType: 'audio/wav', size: 1, path: sample });
  const upShort = a.registerUpload(user.id, { filename: 'short.wav', mimeType: 'audio/wav', size: 1, path: tooShort });
  await assert.rejects(() => a.voice.createProfile(user.id, { uploadId: up.id, consent: false }), /본인의 목소리/);
  await assert.rejects(() => a.voice.createProfile(user.id, { uploadId: upShort.id, consent: true }), /최소 5초/);
  const profile = await a.voice.createProfile(user.id, { uploadId: up.id, name: '내 목소리', consent: true });
  assert.equal(profile.status, 'ready');
  assert.ok(profile.sampleDurationSec >= 5);
  const tts = await a.voice.synthesize(user.id, { profileId: profile.id, text: '아직도 모르셨나요? 오늘 정리해 드릴게요.', style: 'hook' });
  assert.ok(tts.estimatedSec > 0);
  assert.ok(['simulated', 'xtts', 'elevenlabs'].includes(tts.engine));
  assert.equal(a.voice.renders(user.id).length, 1);
  // 쇼츠 AI 후킹 보이스에 내 목소리 사용
  const job = await a.shorts.createFromYoutube(user.id, { url: 'https://youtu.be/abcdefghijk', options: { estimatedDurationSec: 120, aiHookVoice: true, voiceProfileId: profile.id } });
  await waitFor(() => a.store.get('jobs', job.id).status === 'done');
  const clip = a.shorts.getJob(user.id, job.id).clips[0];
  assert.equal(clip.audio.aiHookVoice.voice, 'my-voice');
  assert.equal(clip.audio.aiHookVoice.voiceProfileId, profile.id);
  // 재구성 내레이션
  // 프로필이 없어도 무료 한국어 목소리로 내레이션 (존재하지 않는 프로필 id 는 404)
  await assert.rejects(() => a.remix.create(user.id, { url: 'https://youtu.be/abcdefghijk', rightsConfirmed: true, options: { targetMinutes: 2, narration: 'intro', voiceProfileId: 'nope', estimatedDurationSec: 300 } }), /음성 프로필/);
  const remix = await a.remix.create(user.id, { url: 'https://youtu.be/abcdefghijk', rightsConfirmed: true, options: { targetMinutes: 2, narration: 'full', voiceProfileId: profile.id, estimatedDurationSec: 300 } });
  const done = await waitFor(() => { const j = a.store.get('remixJobs', remix.id); return j.status === 'done' ? j : null; }, 8000);
  assert.ok(done.result.narration.lines.length >= 2);
  assert.equal(done.result.narration.voiceProfileId, profile.id);
  a.voice.remove(user.id, profile.id);
  assert.equal(a.voice.list(user.id).length, 0);
  a.close();
});

test('원본 대본 그대로: 붙여넣은 대본 형식 해석(SRT · 유튜브 스크립트 · [mm:ss.s] · 문장), 제공된 대본이 자막에 그대로 쓰이고, 추정 대본 금지 시 422', async () => {
  const { parseTranscriptText } = await import('../src/index.js');
  const srt = parseTranscriptText('1\n00:00:01,000 --> 00:00:03,500\n안녕하세요 오늘은\n\n2\n00:00:03,500 --> 00:00:06,000\n이 영상에서는 세 가지를 다룹니다\n');
  assert.equal(srt.length, 2); assert.equal(srt[0].text, '안녕하세요 오늘은'); assert.equal(srt[1].start, 3.5);
  const yt = parseTranscriptText('0:00\n안녕하세요 오늘은\n0:04\n이 영상에서는 세 가지를 다룹니다\n1:02\n마지막 정리입니다', 70);
  assert.deepEqual(yt.map((s) => [s.start, s.end, s.text]), [[0, 4, '안녕하세요 오늘은'], [4, 62, '이 영상에서는 세 가지를 다룹니다'], [62, 68, '마지막 정리입니다']]);
  const browser = parseTranscriptText('[00:00.0] 안녕하세요 오늘은\n[00:04.5] 이 영상에서는', 30);
  assert.equal(browser[1].start, 4.5);
  const plain = parseTranscriptText('첫 문장입니다. 두 번째 문장입니다! 세 번째?', 30);
  assert.equal(plain.length, 3); assert.equal(plain[2].end, 30);

  const a = app();
  const { user } = a.auth.signup({ email: 'exact@test.com', password: 'secret1' });
  a.credits.grant(user.id, 100, 'test');
  // 브라우저 Whisper 세그먼트를 제공하면 자막 텍스트가 원본 대본과 완전히 같다
  const transcript = [{ start: 0, end: 4, text: '안녕하세요 오늘은 알파맨을 소개합니다' }, { start: 4, end: 9, text: '핵심은 세 가지입니다' }, { start: 9, end: 15, text: '첫째 링크만 넣으면 됩니다' }, { start: 15, end: 22, text: '둘째 자막이 원본과 똑같습니다' }, { start: 22, end: 30, text: '셋째 보관함에 저장됩니다' }];
  const job = await a.shorts.createFromYoutube(user.id, { url: 'https://youtu.be/abcdefghijk', options: { estimatedDurationSec: 60, clipCount: 1 }, transcript });
  const done = await waitFor(() => { const j = a.store.get('jobs', job.id); return j.status === 'done' ? j : null; });
  assert.equal(done.transcriptExact, true); assert.equal(done.transcriptEngine, 'client');
  const clip = a.shorts.getJob(user.id, job.id).clips[0];
  const original = transcript.map((s) => s.text).join(' ').replace(/\s+/g, '');
  const subtitleText = clip.subtitles.map((s) => s.text).join(' ').replace(/\s+/g, '');
  assert.ok(original.includes(subtitleText) && subtitleText.length > 0, '자막은 원본 대본의 일부를 그대로 담아야 한다');
  // 붙여넣은 대본(transcriptText)도 그대로
  const proj = await a.subtitles.createFromUrl(user.id, { url: 'https://youtu.be/abcdefghijk', transcriptText: '0:00\n첫 번째 줄 그대로\n0:03\n두 번째 줄 그대로' });
  assert.equal(proj.transcriptExact, true); assert.equal(proj.engine, 'pasted-transcript');
  assert.deepEqual(proj.segments.map((s) => s.text), ['첫 번째 줄 그대로', '두 번째 줄 그대로']);
  // 추정 대본을 금지하면(기본값) 대본 없이 링크만으로는 422 안내
  process.env.ALPHAMAN_ALLOW_SIMULATED_STT = '0';
  try {
    await assert.rejects(() => a.subtitles.createFromUrl(user.id, { url: 'https://youtu.be/abcdefghijk' }), (err) => err.status === 422 && /스크립트 표시/.test(err.message));
    assert.equal(a.subtitles.list(user.id).length, 1, '실패한 프로젝트는 남지 않는다');
  } finally { process.env.ALPHAMAN_ALLOW_SIMULATED_STT = '1'; }
  a.close();
});

test('보관함: 쇼츠·재구성·롱폼 완료 시 자동 저장, 미리보기 스펙, 즐겨찾기/이름 수정, 제거, 작업 삭제 시 함께 삭제', async () => {
  const a = app();
  const { user } = a.auth.signup({ email: 'lib@test.com', password: 'secret1' });
  a.credits.grant(user.id, 200, 'test');
  assert.equal(a.library.list(user.id).items.length, 0);
  const job = await a.shorts.createFromYoutube(user.id, { url: 'https://youtu.be/abcdefghijk', options: { estimatedDurationSec: 240 } });
  await waitFor(() => a.store.get('jobs', job.id).status === 'done');
  let { items, stats } = a.library.list(user.id);
  assert.equal(items.length, 2); assert.equal(stats.byKind.shorts, 2);
  assert.ok(items.every((i) => i.kind === 'shorts' && i.jobId === job.id && i.durationSec > 0 && i.ratio === '9:16'));
  const detail = a.library.detail(user.id, items[0].id);
  assert.equal(detail.preview.kind, 'shorts'); assert.equal(detail.preview.source.type, 'youtube'); assert.equal(detail.preview.source.videoId, 'abcdefghijk');
  assert.ok(detail.preview.items.length >= 1 && detail.preview.items[0].newStart === 0);
  assert.ok(detail.preview.subtitles.length > 0); assert.equal(detail.link, `#/studio/${job.id}`);
  // 재구성
  const remix = await a.remix.create(user.id, { url: 'https://youtu.be/abcdefghijk', rightsConfirmed: true, options: { targetMinutes: 1, estimatedDurationSec: 120 } });
  await waitFor(() => a.store.get('remixJobs', remix.id).status === 'done', 8000);
  ({ items, stats } = a.library.list(user.id));
  assert.equal(stats.byKind.remix, 1);
  const rItem = items.find((i) => i.kind === 'remix');
  const rSpec = a.library.previewSpec(user.id, 'remix', remix.id);
  assert.ok(rSpec.items.some((t) => t.kind === 'card') && rSpec.durationSec >= 57);
  // 롱폼
  const lf = await a.longform.create(user.id, { url: 'https://youtu.be/abcdefghijk', options: { estimatedDurationSec: 300 } });
  await waitFor(() => a.store.get('longformJobs', lf.id).status === 'done');
  ({ items, stats } = a.library.list(user.id));
  assert.equal(stats.byKind.longform, 1); assert.equal(stats.total, 4);
  const lSpec = a.library.previewSpec(user.id, 'longform', lf.id);
  assert.ok(lSpec.items.length >= 1 && lSpec.chapters.length >= 1);
  // 편집
  const fav = a.library.update(user.id, rItem.id, { favorite: true, title: '내 첫 재구성', tags: ['테스트'] });
  assert.equal(fav.favorite, true); assert.equal(fav.title, '내 첫 재구성');
  assert.equal(a.library.list(user.id, { favorite: '1' }).items.length, 1);
  assert.equal(a.library.list(user.id, { q: '첫 재구성' }).items.length, 1);
  // 재구성 결과 수정(제목)도 보관함에 반영되고 즐겨찾기는 유지
  a.remix.updateResult(user.id, remix.id, { title: '수정된 제목' });
  const after = a.library.list(user.id).items.find((i) => i.kind === 'remix');
  assert.equal(after.title, '수정된 제목'); assert.equal(after.favorite, true);
  // 다른 사용자는 볼 수 없다
  const other = a.auth.signup({ email: 'other@test.com', password: 'secret1' }).user;
  assert.throws(() => a.library.get(other.id, rItem.id), /찾을 수 없습니다/);
  // 제거 · 작업 삭제 시 연동
  a.library.remove(user.id, rItem.id);
  assert.equal(a.library.list(user.id).stats.byKind.remix, 1, '원본 작업이 남아 있으면 다시 동기화된다');
  a.remix.remove(user.id, remix.id);
  assert.equal(a.library.list(user.id).stats.byKind.remix, 0);
  a.shorts.deleteJob(user.id, job.id);
  assert.equal(a.library.list(user.id).stats.byKind.shorts, 0);
  a.close();
});


test('무료 한국어 TTS 목소리: 목록·합성(브라우저/edge)·샘플 듣기, 기본 후킹 보이스와 내레이션에 사용', async () => {
  const a = app();
  const { user } = a.auth.signup({ email: 'free@test.com', password: 'secret1' });
  a.credits.grant(user.id, 100, 'test');
  const voices = a.voice.freeVoices();
  assert.ok(voices.length >= 25 && voices.every((v) => v.id && v.name && v.sampleText && v.lang));
  assert.ok(voices.filter((v) => v.lang === 'ko-KR').length >= 18, '한국어 목소리(기본 + 스타일 변형)가 충분히 많아야 한다');
  assert.ok(voices.some((v) => v.gender === 'male') && voices.some((v) => v.gender === 'female'));
  const r = await a.voice.synthesize(user.id, { voiceId: 'ko-hyunsu', text: '아직도 이거 모르셨어요?', style: 'hook' });
  assert.equal(r.voiceId, 'ko-hyunsu'); assert.ok(['browser', 'edge-tts'].includes(r.engine));
  if (r.engine === 'browser') assert.equal(r.browser.lang, 'ko-KR');
  assert.throws(() => a.voice.sampleFile(user.id, 'nope'), /찾을 수 없습니다/);
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-voice2-')); const sample = path.join(dir, 'me.wav'); fs.writeFileSync(sample, Buffer.alloc(16 * 1024 * 20));
  const up = a.registerUpload(user.id, { filename: 'me.wav', mimeType: 'audio/wav', size: 1, path: sample });
  const profile = await a.voice.createProfile(user.id, { uploadId: up.id, name: '내 목소리', consent: true });
  assert.equal(a.voice.sampleFile(user.id, profile.id).path, sample);
  assert.equal(a.voice.resolve(user.id, { voiceProfileId: profile.id }).kind, 'profile');
  assert.equal(a.voice.resolve(user.id, {}).id, 'ko-sunhi');
  // 후킹 보이스: 프로필 없이 무료 목소리 선택
  const job = await a.shorts.createFromYoutube(user.id, { url: 'https://youtu.be/abcdefghijk', options: { estimatedDurationSec: 120, aiHookVoice: true, voiceId: 'ko-yujin' } });
  await waitFor(() => a.store.get('jobs', job.id).status === 'done');
  const clip = a.shorts.getJob(user.id, job.id).clips[0];
  assert.equal(clip.audio.aiHookVoice.voice, 'ko-yujin');
  // 내레이션도 무료 목소리로
  const remix = await a.remix.create(user.id, { url: 'https://youtu.be/abcdefghijk', rightsConfirmed: true, options: { targetMinutes: 1, narration: 'intro', voiceId: 'ko-injoon', estimatedDurationSec: 120 } });
  const done = await waitFor(() => { const j = a.store.get('remixJobs', remix.id); return j.status === 'done' ? j : null; }, 8000);
  assert.equal(done.result.narration.voice.id, 'ko-injoon');
  a.close();
});

test('영상 마무리 구독 CTA · 유튜브 최적화(원본 비슷한 제목/추천 제목/태그/해시태그) · 썸네일 자동 제작(원본 비슷하게 + 장면 선택 + 편집)', async () => {
  const { composeSvg, extractKeywords } = await import('../src/index.js');
  const a = app();
  const { user } = a.auth.signup({ email: 'seo@test.com', password: 'secret1' });
  a.credits.grant(user.id, 200, 'test');
  const transcript = [{ start: 0, end: 5, text: '오늘은 유튜브 알고리즘의 비밀 3가지를 알려드립니다' }, { start: 5, end: 12, text: '첫째 썸네일이 클릭률을 결정합니다' }, { start: 12, end: 20, text: '둘째 첫 3초 후킹이 시청 지속시간을 만듭니다' }, { start: 20, end: 30, text: '셋째 제목과 태그가 검색 노출을 만듭니다' }, { start: 30, end: 40, text: '알고리즘은 결국 시청자를 봅니다' }];
  const job = await a.shorts.createFromYoutube(user.id, { url: 'https://youtu.be/abcdefghijk', options: { estimatedDurationSec: 60, clipCount: 1 }, transcript });
  await waitFor(() => a.store.get('jobs', job.id).status === 'done');
  const clip = a.shorts.getJob(user.id, job.id).clips[0];
  // 마무리 구독 카드
  assert.equal(clip.outro.style, 'subscribe'); assert.match(clip.outro.text, /구독/);
  const spec = a.library.previewSpec(user.id, 'shorts', clip.id);
  const last = spec.items[spec.items.length - 1];
  assert.equal(last.kind, 'card'); assert.equal(last.cta, true); assert.ok(spec.durationSec > clip.durationSec);
  // 유튜브 최적화
  const seo = clip.seo;
  assert.ok(seo && seo.titles.length >= 4 && seo.bestTitle && seo.similarTitle);
  assert.ok(seo.titles.every((t) => t.text.length <= 60 && t.score > 0));
  assert.ok(seo.tags.length >= 5 && seo.tags.includes('쇼츠'));
  assert.equal(seo.hashtags.length, 3); assert.ok(seo.hashtags.includes('#shorts'));
  assert.ok(seo.keywords.includes('알고리즘') || seo.keywords.includes('썸네일'));
  assert.match(seo.description, /구독/);
  assert.ok(seo.checklist.length >= 7 && seo.checklist.find((c) => /구독/.test(c.label)).ok);
  assert.ok(extractKeywords('썸네일이 썸네일을 썸네일은 제목과 제목은').includes('썸네일'));
  // 원본 비슷한 제목: 원본 접두/이모지 유지
  const seo2 = await a.seo.generate({ kind: 'shorts', title: '핵심 정리', hook: '이거 모르면 손해', originalTitle: '[알파채널] 유튜브 성장 비법 총정리 🔥', originalTags: ['유튜브', '성장'], segments: transcript, durationSec: 40 });
  assert.match(seo2.similarTitle, /^\[알파채널\]/); assert.match(seo2.similarTitle, /🔥$/); assert.ok(seo2.tags.includes('유튜브'));
  // 썸네일: 자동 제작(유튜브 원본 → 원본과 비슷하게) + 편집
  const set = a.thumbnail.get(user.id, 'shorts', clip.id);
  assert.ok(set && set.svg.startsWith('<svg') && set.selectedId === 'original' && set.style === 'original-like');
  assert.ok(set.candidates.length >= 4 && set.candidates.some((c) => c.id === 'yt-2'));
  assert.equal(set.width, 1080); assert.equal(set.height, 1920);
  assert.ok(set.svg.includes('/api/thumbnail/proxy?url=') && set.svg.includes('SHORTS'));
  const edited = await a.thumbnail.update(user.id, 'shorts', clip.id, { candidateId: 'yt-2', headline: '3가지 비밀', subline: '알고리즘 정복', style: 'big-number', palette: 'red' });
  assert.equal(edited.selectedId, 'yt-2'); assert.ok(edited.svg.includes('hq2.jpg') && edited.svg.includes('비밀') && edited.svg.includes('#ff3b3b'));
  const item = a.library.list(user.id).items.find((i) => i.refId === clip.id);
  assert.match(item.thumbnail, /\/api\/thumbnail\/shorts\//);
  const frame = a.thumbnail.addUserFrame(user.id, 'shorts', clip.id, { buffer: Buffer.from('jpegdata'), at: 3.5 });
  assert.ok(a.thumbnail.frameFile(user.id, 'shorts', clip.id, 100).path.endsWith('.jpg') && frame.at === 3.5);
  assert.ok(!a.thumbnail.isAllowedProxy('https://evil.example.com/a.jpg') && a.thumbnail.isAllowedProxy('https://i.ytimg.com/vi/x/hq1.jpg'));
  const svg = composeSvg({ width: 1280, height: 720, image: null, headline: '텍스트 없는 배경', subline: '', style: 'split', palette: 'mint', badge: null });
  assert.ok(svg.includes('bgGrad') && svg.includes('#2dd4bf'));
  // 재구성도 마무리 구독 카드 + SEO
  const remix = await a.remix.create(user.id, { url: 'https://youtu.be/abcdefghijk', rightsConfirmed: true, options: { targetMinutes: 1, estimatedDurationSec: 60 }, transcript });
  const done = await waitFor(() => { const j = a.store.get('remixJobs', remix.id); return j.status === 'done' ? j : null; }, 8000);
  const lastCard = done.result.timeline[done.result.timeline.length - 1];
  assert.equal(lastCard.cta, true); assert.match(lastCard.title, /구독/);
  assert.ok(done.result.seo.bestTitle && done.thumbnailSet.svg);
  const noOutro = await a.remix.create(user.id, { url: 'https://youtu.be/abcdefghijk', rightsConfirmed: true, options: { targetMinutes: 1, estimatedDurationSec: 60, outro: false }, transcript });
  const done2 = await waitFor(() => { const j = a.store.get('remixJobs', noOutro.id); return j.status === 'done' ? j : null; }, 8000);
  assert.ok(!done2.result.timeline.some((t) => t.cta));
  a.close();
});
