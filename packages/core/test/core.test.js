import test from 'node:test';
import assert from 'node:assert/strict';
import { AlphaMan, ADMIN_ACCOUNT, validateVideoMeta, parseYoutubeUrl, toSRT, toVTT, toASS, semanticSplit, nextOccurrences, ApiError } from '../src/index.js';

process.env.ALPHAMAN_AI = 'off';
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
