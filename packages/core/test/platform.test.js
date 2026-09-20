// 플랫폼 기능 테스트: 프로젝트 관리 · 작업 센터 · 파일 관리자 · 템플릿 · 공유 · 결제(실결제 게이트) · 자막 편집 확장 · 알림 삭제 · 로그인 중복 레코드 · 백업
import test from 'node:test';
import assert from 'node:assert/strict';
import { AlphaMan, ApiError } from '../src/index.js';
import { validateUpload, UPLOAD_LIMITS } from '../src/medialib.js';
import { PaymentService } from '../src/payments.js';

process.env.ALPHAMAN_AI = 'off';
process.env.ALPHAMAN_ALLOW_SIMULATED_STT = '1';
process.env.ALPHAMAN_JOB_SPEED = '1000';
process.env.ALPHAMAN_TTS_DETECT = 'off';
process.env.ALPHAMAN_FAKE_PAYMENTS = '1';

function app() { return new AlphaMan({ memory: true, platform: 'test' }); }
function waitFor(fn, ms = 6000) {
  return new Promise((resolve, reject) => { const started = Date.now(); const t = setInterval(() => { const v = fn(); if (v) { clearInterval(t); resolve(v); } else if (Date.now() - started > ms) { clearInterval(t); reject(new Error('timeout')); } }, 20); });
}
const SRT = '1\n00:00:00,000 --> 00:00:02,000\n안녕하세요 여러분\n\n2\n00:00:02,500 --> 00:00:05,000\n오늘은 테스트입니다\n\n3\n00:00:05,500 --> 00:00:08,000\n마지막 문장입니다\n';

test('프로젝트 관리: 목록/정렬/검색, 이름 변경, 즐겨찾기, 휴지통·복구·영구 삭제, 복제, 버전 기록·복원, 내보내기/가져오기 검증, 마지막 위치', async () => {
  const a = app();
  const { user } = a.auth.signup({ email: 'p@test.com', password: 'secret1', name: 'P' });
  const p = await a.subtitles.createFromUrl(user.id, { url: 'https://youtu.be/abcdefghijk', language: 'ko', transcriptText: SRT });
  const job = await a.shorts.createFromYoutube(user.id, { url: 'https://youtu.be/abcdefghijk', options: { estimatedDurationSec: 120 }, transcriptText: SRT });
  await waitFor(() => a.shorts.getJob(user.id, job.id).status === 'done');
  let list = a.projects.list(user.id, {});
  assert.equal(list.items.length, 2);
  assert.ok(list.items.every((x) => x.id && x.kind && x.route && x.title));
  // 이름 변경 · 검색 · 즐겨찾기 정렬
  a.projects.rename(user.id, 'subtitle', p.id, '내 첫 자막');
  assert.equal(a.projects.list(user.id, { q: '첫 자막' }).items.length, 1);
  a.projects.favorite(user.id, 'subtitle', p.id, true);
  assert.equal(a.projects.list(user.id, { sort: 'favorite' }).items[0].id, `subtitle:${p.id}`);
  assert.equal(a.projects.list(user.id, { favorite: '1' }).items.length, 1);
  assert.equal(a.projects.list(user.id, {}).counts.favorites, 1);
  // 마지막 위치
  a.projects.setPosition(user.id, 'subtitle', p.id, { playhead: 3.2, segIndex: 1 });
  assert.equal(a.projects.getPosition(user.id, 'subtitle', p.id).segIndex, 1);
  assert.equal(a.projects.get(user.id, 'subtitle', p.id).lastPosition.playhead, 3.2);
  // 버전 기록 · 복원
  const v1 = a.projects.snapshot(user.id, 'subtitle', p.id, { label: '처음' });
  a.subtitles.updateSegments(user.id, p.id, a.subtitles.get(user.id, p.id).segments.slice(0, 1));
  assert.equal(a.subtitles.get(user.id, p.id).segments.length, 1);
  assert.ok(a.projects.versions(user.id, 'subtitle', p.id).length >= 1);
  a.projects.restoreVersion(user.id, 'subtitle', p.id, v1.id);
  assert.equal(a.subtitles.get(user.id, p.id).segments.length, 3);
  assert.ok(a.projects.versions(user.id, 'subtitle', p.id).some((v) => /복원 전/.test(v.label)));
  // 내보내기 · 가져오기 (검증 포함)
  const exported = a.projects.exportProject(user.id, 'subtitle', p.id);
  assert.equal(exported.format, 'alphaman-project');
  assert.equal(exported.project.segments.length, 3);
  assert.throws(() => a.projects.importProject(user.id, { format: 'nope' }), (e) => e.status === 400);
  assert.throws(() => a.projects.importProject(user.id, { ...exported, project: { ...exported.project, segments: [{ start: 5, end: 1, text: 'x' }] } }), (e) => e.status === 400 && /자막의 시간/.test(e.message));
  const imported = a.projects.importProject(user.id, JSON.parse(JSON.stringify(exported)));
  assert.match(imported.project.title, /가져옴/);
  assert.equal(a.projects.list(user.id, {}).items.length, 3);
  // 복제 (자막은 무료)
  const dup = await a.projects.duplicate(user.id, 'subtitle', p.id);
  assert.notEqual(dup.refId, p.id);
  assert.equal(a.subtitles.get(user.id, dup.refId).segments.length, 3);
  // 휴지통 → 목록에서 사라지고 → 복구 → 영구 삭제
  a.projects.trash(user.id, 'subtitle', dup.refId);
  assert.ok(!a.projects.list(user.id, {}).items.some((x) => x.refId === dup.refId));
  assert.equal(a.projects.list(user.id, { trash: '1' }).items.length, 1);
  assert.ok(!a.subtitles.list(user.id).some((x) => x.id === dup.refId), '기존 자막 목록에서도 숨겨진다');
  a.projects.restore(user.id, 'subtitle', dup.refId);
  assert.ok(a.subtitles.list(user.id).some((x) => x.id === dup.refId));
  a.projects.trash(user.id, 'subtitle', dup.refId);
  assert.equal(a.projects.emptyTrash(user.id), 1);
  assert.throws(() => a.subtitles.get(user.id, dup.refId), ApiError);
  // 쇼츠 프로젝트 휴지통은 보관함에서도 숨긴다
  a.projects.trash(user.id, 'shorts', job.id);
  assert.equal(a.library.list(user.id, {}).items.length, 0);
  a.projects.restore(user.id, 'shorts', job.id);
  assert.ok(a.library.list(user.id, {}).items.length >= 1);
  // 다른 사용자는 접근 불가
  const { user: other } = a.auth.signup({ email: 'q@test.com', password: 'secret1', name: 'Q' });
  assert.throws(() => a.projects.get(other.id, 'subtitle', p.id), (e) => e.status === 404);
  a.close();
});

test('작업 센터: 작업 기록(대기/처리/완료/실패/취소), 진행률, 취소 시 환불, 재실행, 기록 정리', async () => {
  const a = app();
  const { user } = a.auth.signup({ email: 'j@test.com', password: 'secret1', name: 'J' });
  const job = await a.shorts.createFromYoutube(user.id, { url: 'https://youtu.be/abcdefghijk', options: { estimatedDurationSec: 120 }, transcriptText: SRT });
  await waitFor(() => a.shorts.getJob(user.id, job.id).status === 'done');
  const { items, counts } = a.activity.list(user.id, {});
  const act = items.find((x) => x.kind === 'shorts' && x.refId === job.id);
  assert.ok(act, '쇼츠 작업이 기록된다');
  assert.equal(act.status, 'done');
  assert.equal(act.progress, 100);
  assert.ok(act.startedAt && act.finishedAt && act.durationMs >= 0);
  assert.ok(act.input, '재실행용 입력이 기록된다');
  assert.equal(counts.done >= 1, true);
  assert.throws(() => a.activity.cancel(user.id, act.id), (e) => e.status === 409);
  // 다시 실행 → 새 작업 생성 (이용권 차감)
  const before = a.credits.balance(user.id);
  const re = await a.activity.rerun(user.id, act.id);
  assert.ok(re.created?.id && re.created.id !== job.id);
  assert.ok(a.credits.balance(user.id) < before);
  await waitFor(() => a.shorts.getJob(user.id, re.created.id).status === 'done');
  // 대기 중 취소 → 환불. 동시 실행 1로 줄여 큐에 쌓이게 한다
  a.activity.queue.concurrency = 1;
  const bal = a.credits.balance(user.id);
  const j1 = await a.shorts.createFromYoutube(user.id, { url: 'https://youtu.be/abcdefghijk', options: { estimatedDurationSec: 120 }, transcriptText: SRT });
  const j2 = await a.shorts.createFromYoutube(user.id, { url: 'https://youtu.be/abcdefghijk', options: { estimatedDurationSec: 120 }, transcriptText: SRT });
  const a2 = a.activity.list(user.id, {}).items.find((x) => x.refId === j2.id);
  if (a2.status === 'queued') {
    a.activity.cancel(user.id, a2.id);
    assert.equal(a.activity.get(user.id, a2.id).status, 'cancelled');
    await waitFor(() => a.shorts.getJob(user.id, j2.id).status === 'cancelled' || a.shorts.getJob(user.id, j2.id).status === 'failed');
    assert.equal(a.credits.balance(user.id), bal - 2, '취소된 작업의 이용권은 환불된다');
  }
  await waitFor(() => ['done', 'failed', 'cancelled'].includes(a.shorts.getJob(user.id, j1.id).status));
  // 기록 정리는 끝난 것만 지운다
  const removed = a.activity.clearFinished(user.id);
  assert.ok(removed >= 2);
  assert.equal(a.activity.list(user.id, { status: 'done' }).items.length, 0);
  a.close();
});

test('파일 관리자: 업로드 검증(확장자·MIME·크기), 분류, 검색/정렬, 이름 변경, 휴지통/복구, 사용량', async () => {
  assert.throws(() => validateUpload({ filename: 'x.exe', mimeType: 'application/octet-stream', size: 10 }), (e) => e.status === 400);
  assert.throws(() => validateUpload({ filename: 'x.mp4', mimeType: 'text/html', size: 10 }), (e) => e.status === 400 && /맞지 않습니다/.test(e.message));
  assert.throws(() => validateUpload({ filename: 'x.mp4', mimeType: 'video/mp4', size: 0 }), (e) => e.status === 400);
  assert.throws(() => validateUpload({ filename: 'x.mp4', mimeType: 'video/mp4', size: UPLOAD_LIMITS.maxBytes + 1 }), (e) => e.status === 413);
  assert.equal(validateUpload({ filename: '../evil/../a.mp4', mimeType: 'video/mp4', size: 10 }).name.includes('/'), false);
  assert.equal(validateUpload({ filename: 'a.srt', mimeType: 'text/plain', size: 10 }).category, 'subtitle');
  assert.equal(validateUpload({ filename: 'a.mp3', mimeType: 'audio/mpeg', size: 10 }).category, 'audio');

  const a = app();
  const { user } = a.auth.signup({ email: 'm@test.com', password: 'secret1', name: 'M' });
  const up1 = a.registerUpload(user.id, { filename: 'sample video.mp4', mimeType: 'video/mp4', size: 1234, meta: { durationSec: 60, width: 1280, height: 720 } });
  const up2 = a.registerUpload(user.id, { filename: 'voice.wav', mimeType: 'audio/wav', size: 999 });
  const all = a.media.list(user.id, {});
  assert.ok(all.items.length >= 2);
  assert.ok(all.categories.video && all.categories.audio && all.categories.output);
  assert.equal(a.media.list(user.id, { category: 'audio' }).items.length, 1);
  assert.equal(a.media.list(user.id, { q: 'sample' }).items[0].id, `upload:${up1.id}`);
  assert.equal(a.media.list(user.id, { sort: 'size' }).items[0].id, `upload:${up1.id}`);
  a.media.rename(user.id, `upload:${up1.id}`, '새 이름.mp4');
  assert.equal(a.media.list(user.id, { q: '새 이름' }).items.length, 1);
  a.media.trash(user.id, `upload:${up2.id}`);
  assert.equal(a.media.list(user.id, {}).items.some((i) => i.id === `upload:${up2.id}`), false);
  assert.equal(a.media.list(user.id, { trash: '1' }).items.length, 1);
  a.media.restore(user.id, `upload:${up2.id}`);
  assert.equal(a.media.list(user.id, { trash: '1' }).items.length, 0);
  const usage = a.media.usage(user.id);
  assert.equal(usage.files, 2);
  assert.equal(usage.bytes, 1234 + 999);
  assert.ok(usage.limitBytes > usage.bytes);
  // 다른 사용자의 파일은 보이지 않고 삭제도 불가
  const { user: other } = a.auth.signup({ email: 'n@test.com', password: 'secret1', name: 'N' });
  assert.equal(a.media.list(other.id, {}).items.length, 0);
  assert.throws(() => a.media.trash(other.id, `upload:${up1.id}`), (e) => e.status === 404);
  a.close();
});

test('템플릿: 저장·수정·삭제·사용 횟수, 다른 프로젝트(자막)에 적용, 일괄 적용', async () => {
  const a = app();
  const { user } = a.auth.signup({ email: 't@test.com', password: 'secret1', name: 'T' });
  const t = a.templates.create(user.id, { name: '노랑 굵게', kind: 'subtitle', settings: { subtitleStyle: { color: '#ffee00', size: 72, position: 'top', animation: 'pop' }, templateId: 'bold-yellow' } });
  assert.throws(() => a.templates.create(user.id, { name: '', settings: {} }), ApiError);
  a.templates.update(user.id, t.id, { description: '설명' });
  assert.equal(a.templates.list(user.id)[0].description, '설명');
  const p = await a.subtitles.createFromUrl(user.id, { url: 'https://youtu.be/abcdefghijk', language: 'ko', transcriptText: SRT });
  const r = await a.projects.applySettings(user.id, 'subtitle', p.id, t.settings);
  assert.ok(r.applied.length >= 1);
  const style = a.subtitles.get(user.id, p.id).style;
  assert.equal(style.color, '#ffee00');
  assert.equal(style.position, 'top');
  a.templates.markUsed(user.id, t.id);
  assert.equal(a.templates.list(user.id)[0].uses, 1);
  a.templates.remove(user.id, t.id);
  assert.equal(a.templates.list(user.id).length, 0);
  a.close();
});

test('공유 링크: 명시적으로 만든 링크만 접근, 만료·취소 즉시 차단, 소유자 확인', async () => {
  const a = app();
  const { user } = a.auth.signup({ email: 's@test.com', password: 'secret1', name: 'S' });
  const job = await a.shorts.createFromYoutube(user.id, { url: 'https://youtu.be/abcdefghijk', options: { estimatedDurationSec: 120 }, transcriptText: SRT });
  await waitFor(() => a.shorts.getJob(user.id, job.id).status === 'done');
  assert.throws(() => a.share.resolve('does-not-exist'), (e) => e.status === 404);
  const clipId = a.shorts.getJob(user.id, job.id).clips[0].id; // 쇼츠는 클립 단위로 공유
  assert.throws(() => a.share.create(user.id, { kind: 'shorts', refId: 'nope' }), (e) => e.status === 404);
  const s = a.share.create(user.id, { kind: 'shorts', refId: clipId, expiresDays: 7, title: '공유 테스트' });
  assert.ok(s.token.length >= 16);
  const pub = a.share.resolve(s.token);
  assert.equal(pub.kind, 'shorts');
  assert.ok(pub.preview && Array.isArray(pub.preview.items));
  assert.equal(a.share.ownerForToken(s.token), user.id);
  assert.equal(a.share.list(user.id)[0].views, 1);
  a.share.revoke(user.id, s.id);
  assert.throws(() => a.share.resolve(s.token), (e) => e.status === 410 || e.status === 404);
  const { user: other } = a.auth.signup({ email: 's2@test.com', password: 'secret1', name: 'S2' });
  assert.throws(() => a.share.revoke(other.id, s.id), (e) => e.status === 404);
  assert.throws(() => a.share.create(other.id, { kind: 'shorts', refId: clipId }), (e) => e.status === 404);
  a.close();
});

test('결제: 가짜 결제 금지(키 없으면 503), 서버가 금액 확정, 주문 생성·조회, 승인 시 금액 대조, 관리자 주문 목록', async () => {
  const a = app();
  const { user } = a.auth.signup({ email: 'pay@test.com', password: 'secret1', name: 'Pay' });
  const cfg = a.payments.config();
  assert.equal(typeof cfg.toss.enabled, 'boolean');
  assert.ok(!('secretKey' in cfg.toss) && !JSON.stringify(cfg).includes('test_sk_'), '시크릿 키는 프론트에 내려가지 않는다');
  // 테스트 키가 기본으로 있어 국내 주문은 만들어진다 (실제 청구 없음)
  if (cfg.toss.enabled) {
    const order = a.payments.createOrder(user.id, { planId: 'starter', region: 'domestic', method: 'card' });
    assert.equal(order.gateway, 'toss');
    assert.equal(order.currency, 'KRW');
    assert.ok(order.amount > 0 && order.orderName.includes('AlphaMan'));
    assert.equal(order.status, 'created');
    assert.equal(a.payments.orders(user.id).length, 1);
    await assert.rejects(() => a.payments.confirmToss(user.id, { paymentKey: 'x', orderId: order.id, amount: order.amount + 1 }), (e) => e.status === 400 && /금액/.test(e.message));
    const { user: other } = a.auth.signup({ email: 'pay2@test.com', password: 'secret1', name: 'Pay2' });
    await assert.rejects(() => a.payments.confirmToss(other.id, { paymentKey: 'x', orderId: order.id, amount: order.amount }), (e) => e.status === 404);
    assert.equal(a.payments.adminOrders().length, 1);
    // 웹훅: 모르는 주문은 무시
    assert.deepEqual(await a.payments.tossWebhook({ data: { orderId: 'nope', status: 'DONE' } }), { ignored: true });
  }
  // 해외(Stripe)는 키가 없으면 503, 가짜 결제를 만들지 않는다
  if (!cfg.stripe.enabled) assert.throws(() => a.payments.createOrder(user.id, { planId: 'starter', region: 'overseas' }), (e) => e.status === 503);
  assert.throws(() => a.payments.createOrder(user.id, { planId: 'free' }), (e) => e.status === 400);
  // 키를 모두 끄면 국내도 503
  const prevTest = process.env.ALPHAMAN_PAYMENTS_TEST; process.env.ALPHAMAN_PAYMENTS_TEST = 'off';
  const ps = new PaymentService({ store: a.store, credits: a.credits });
  assert.equal(ps.config().toss.enabled, false);
  assert.throws(() => ps.createOrder(user.id, { planId: 'starter' }), (e) => e.status === 503);
  process.env.ALPHAMAN_PAYMENTS_TEST = prevTest;
  // 이행(_fulfill)은 이용권 지급 + 요금제 반영
  if (cfg.toss.enabled) {
    const order = a.payments.createOrder(user.id, { planId: 'starter', region: 'domestic' });
    const before = a.credits.balance(user.id);
    const pay = a.payments._fulfill(order, { paymentKey: 'pk', method: 'card', receiptUrl: null, approvedAt: new Date().toISOString(), raw: {} });
    assert.equal(pay.status, 'paid');
    assert.ok(a.credits.balance(user.id) > before);
    assert.equal(a.payments.orders(user.id).find((o) => o.id === order.id).status, 'paid');
    assert.equal(a.store.get('users', user.id).plan, 'starter');
  }
  // 기존 시뮬레이션 checkout 은 ALPHAMAN_FAKE_PAYMENTS 없이는 503
  const prevFake = process.env.ALPHAMAN_FAKE_PAYMENTS; delete process.env.ALPHAMAN_FAKE_PAYMENTS;
  assert.throws(() => a.credits.checkout(user.id, { planId: 'starter', region: 'domestic', method: 'card' }), (e) => e.status === 503);
  process.env.ALPHAMAN_FAKE_PAYMENTS = prevFake;
  a.close();
});

test('자막 편집 확장: 되돌리기/다시 실행 50단계, 검색, 찾기/바꾸기, 시간 이동, VTT 가져오기, 변경 기록', async () => {
  const a = app();
  const { user } = a.auth.signup({ email: 'e@test.com', password: 'secret1', name: 'E' });
  const p = await a.subtitles.createFromUrl(user.id, { url: 'https://youtu.be/abcdefghijk', language: 'ko', transcriptText: SRT });
  assert.equal(a.subtitles.search(user.id, p.id, '테스트').length, 1);
  assert.equal(a.subtitles.search(user.id, p.id, '').length, 0);
  const r = a.subtitles.findReplace(user.id, p.id, { find: '테스트', replace: '시험' });
  assert.equal(r.changed, 1);
  assert.match(r.project.segments[1].text, /시험/);
  assert.throws(() => a.subtitles.findReplace(user.id, p.id, { find: '' }), ApiError);
  const shifted = a.subtitles.shiftTime(user.id, p.id, { offsetSec: 1.5 });
  assert.equal(shifted.segments[0].start, 1.5);
  const scaled = a.subtitles.shiftTime(user.id, p.id, { scale: 2, fromSec: 3 });
  assert.equal(scaled.segments[0].start, 1.5, 'fromSec 이전은 그대로');
  assert.ok(scaled.segments[2].start > 7);
  assert.throws(() => a.subtitles.shiftTime(user.id, p.id, { scale: 50 }), ApiError);
  // 되돌리기/다시 실행
  const h0 = a.subtitles.historyInfo(user.id, p.id);
  assert.equal(h0.max, 50);
  assert.ok(h0.undo >= 3);
  const u = a.subtitles.undo(user.id, p.id);
  assert.equal(u.segments[2].start, 5.5 + 1.5);
  assert.equal(a.subtitles.historyInfo(user.id, p.id).redo, 1);
  const rd = a.subtitles.redo(user.id, p.id);
  assert.ok(rd.segments[2].start > 7);
  assert.throws(() => a.subtitles.redo(user.id, p.id), (e) => e.status === 409);
  // 50단계 제한
  for (let i = 0; i < 60; i++) a.subtitles.updateSegments(user.id, p.id, a.subtitles.get(user.id, p.id).segments.map((s) => ({ ...s, text: `${s.text} ` })));
  assert.equal(a.subtitles.historyInfo(user.id, p.id).undo, 50);
  // VTT 가져오기
  const vtt = 'WEBVTT\n\n00:00.000 --> 00:01.000\n첫 줄\n\n00:01.500 --> 00:03.000\n둘째 줄\n';
  const v = a.subtitles.importVtt(user.id, p.id, vtt);
  assert.equal(v.segments.length, 2);
  assert.equal(v.segments[1].start, 1.5);
  assert.throws(() => a.subtitles.importVtt(user.id, p.id, 'garbage'), ApiError);
  a.close();
});

test('알림 삭제 · 로그인: 같은 이메일 레코드가 여러 개여도 비밀번호가 맞는 레코드로 로그인 · 재설정 요청은 관리자 문의로 접수', () => {
  const a = app();
  const { user } = a.auth.signup({ email: 'dup@test.com', password: 'secret1', name: 'D' });
  a.notifications.push(user.id, { type: 'x', title: 'a', body: 'b' });
  a.notifications.push(user.id, { type: 'x', title: 'c', body: 'd' });
  const list = a.notifications.list(user.id, {});
  assert.equal(list.length, 2);
  assert.equal(a.notifications.remove(user.id, [list[0].id]), 1);
  assert.equal(a.notifications.list(user.id, {}).length, 1);
  assert.equal(a.notifications.remove(user.id, null), 1);
  assert.equal(a.notifications.list(user.id, {}).length, 0);
  // 다른 인스턴스 병합 등으로 같은 이메일의 레코드가 하나 더 생긴 상황
  a.store.insert('users', { email: 'dup@test.com', name: 'D-old', role: 'user', status: 'active', passwordHash: 'x:y', credits: 0 });
  const r = a.auth.login({ email: 'dup@test.com', password: 'secret1' });
  assert.equal(r.user.id, user.id);
  assert.throws(() => a.auth.login({ email: 'dup@test.com', password: 'wrong' }), (e) => /비밀번호/.test(e.message));
  assert.throws(() => a.auth.login({ email: 'none@test.com', password: 'wrong' }), (e) => /가입된 이메일이 아닙니다/.test(e.message));
  const rr = a.auth.requestPasswordReset({ email: 'dup@test.com', support: a.support });
  assert.ok(rr.ok || rr.message);
  assert.ok(a.support.allInquiries().some((i) => /비밀번호/.test(i.message)));
  assert.throws(() => a.auth.requestPasswordReset({ email: 'none@test.com', support: a.support }), (e) => e.status === 404);
  a.close();
});

test('시스템: 상태 점검, 오류 로그, 백업/복원(병합), 사용량', async () => {
  const a = app();
  const { user } = a.auth.signup({ email: 'sys@test.com', password: 'secret1', name: 'Sys' });
  const st = await a.system.status();
  assert.equal(st.api.ok, true);
  assert.ok(st.db.records.users >= 2);
  assert.ok(typeof st.render.mode === 'string');
  assert.ok(st.queue && typeof st.queue.concurrency === 'number');
  a.errors.log({ level: 'error', source: 'client', message: 'boom', route: '#/x', userId: user.id });
  assert.equal(a.errors.stats().client, 1);
  assert.equal(a.errors.list({ source: 'client' }).length, 1);
  const p = await a.subtitles.createFromUrl(user.id, { url: 'https://youtu.be/abcdefghijk', language: 'ko', transcriptText: SRT });
  const b = await a.backup.backup({ reason: 'test' });
  assert.ok(b.id && b.size > 100);
  assert.ok(a.backup.list().length >= 1);
  // 프로젝트를 지운 뒤 병합 복원하면 되살아난다
  a.store.remove('subtitleProjects', p.id);
  assert.ok(!a.store.get('subtitleProjects', p.id));
  await a.backup.restore(b.id, { merge: true });
  assert.ok(a.store.get('subtitleProjects', p.id), '백업에서 복원됨');
  const us = a.usage.usage(user.id);
  assert.ok(us.storage && us.jobs && us.outputs && us.ai && us.credits);
  assert.equal(a.errors.clear() >= 1, true);
  a.close();
});
