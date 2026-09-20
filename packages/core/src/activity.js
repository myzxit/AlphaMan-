// 작업 히스토리 + AI 작업 진행 센터 + 렌더링/작업 큐: 사용자가 실행한 모든 AI 작업(쇼츠·재구성·롱폼·자막·SEO·썸네일·TTS)을 기록하고
// 대기/처리/완료/실패/취소 상태, 진행률, 취소, 재시도, 다시 실행을 제공한다. 무거운 작업은 동시 실행 수를 제한하는 큐로 돌린다.
import { ApiError } from './errors.js';

export class CancelledError extends Error { constructor(msg = '사용자가 작업을 취소했습니다.') { super(msg); this.name = 'CancelledError'; this.cancelled = true; } }

export class JobQueue {
  constructor({ concurrency = Number(process.env.ALPHAMAN_JOB_CONCURRENCY || 2), onChange = null } = {}) {
    this.concurrency = Math.max(1, concurrency); this.running = new Map(); this.waiting = []; this.onChange = onChange; this.seq = 0; this.history = [];
  }
  push(fn, meta = {}) {
    const ticket = { id: `t${++this.seq}`, meta, queuedAt: new Date().toISOString(), startedAt: null, status: 'queued' };
    this.waiting.push({ ticket, fn }); this._pump(); return ticket;
  }
  cancel(pred) { const idx = this.waiting.findIndex((w) => pred(w.ticket.meta)); if (idx < 0) return false; const [w] = this.waiting.splice(idx, 1); w.ticket.status = 'cancelled'; this._remember(w.ticket); return true; }
  _pump() {
    while (this.running.size < this.concurrency && this.waiting.length) {
      const w = this.waiting.shift(); w.ticket.startedAt = new Date().toISOString(); w.ticket.status = 'running'; this.running.set(w.ticket.id, w.ticket);
      Promise.resolve().then(w.fn).then(() => { w.ticket.status = 'done'; }).catch((err) => { w.ticket.status = err?.cancelled ? 'cancelled' : 'failed'; w.ticket.error = err?.message; })
        .finally(() => { w.ticket.finishedAt = new Date().toISOString(); this.running.delete(w.ticket.id); this._remember(w.ticket); this._pump(); });
    }
    this.onChange && this.onChange(this.stats());
  }
  _remember(t) { this.history.unshift(t); if (this.history.length > 200) this.history.length = 200; }
  stats() { return { concurrency: this.concurrency, running: [...this.running.values()].map((t) => ({ id: t.id, meta: t.meta, startedAt: t.startedAt })), queued: this.waiting.map((w) => ({ id: w.ticket.id, meta: w.ticket.meta, queuedAt: w.ticket.queuedAt })), recent: this.history.slice(0, 20) }; }
}

export const ACTIVITY_KINDS = { shorts: '쇼츠 제작', remix: 'AI 재구성', longform: '롱폼 컷편집', subtitle: '자막 생성', seo: '유튜브 최적화', thumbnail: '썸네일 제작', tts: 'TTS 합성', translate: '번역', topic: '알파토픽 분석', render: '렌더링', batch: '일괄 작업', import: '프로젝트 가져오기' };

export class ActivityService {
  constructor({ store, notifications = null }) { this.store = store; this.notifications = notifications; this.queue = new JobQueue(); this.runners = {}; }

  // 작업 시작 기록. input 은 "다시 실행"에 쓰이는 요청 본문(민감 정보 없음)
  start(userId, { kind, refId = null, title = '', input = null, projectKind = null, status = 'queued', estimatedSec = null }) {
    if (!ACTIVITY_KINDS[kind]) throw new ApiError(400, '알 수 없는 작업 종류입니다.');
    return this.store.insert('activities', { userId, kind, kindLabel: ACTIVITY_KINDS[kind], refId, projectKind: projectKind || (['shorts', 'remix', 'longform', 'subtitle'].includes(kind) ? kind : null), title: String(title || '').slice(0, 120), input, status, progress: 0, step: null, startedAt: new Date().toISOString(), finishedAt: null, durationMs: null, result: null, error: null, estimatedSec, cancelRequested: false });
  }
  _find(kind, refId) { return this.store.find('activities', (a) => a.kind === kind && a.refId === refId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null; }
  progress(kind, refId, progress, step = null) { const a = this._find(kind, refId); if (a && !['done', 'failed', 'cancelled'].includes(a.status)) this.store.update('activities', a.id, { status: 'processing', progress: Math.round(progress), step }); }
  done(kind, refId, result = null) { const a = this._find(kind, refId); if (a) this.store.update('activities', a.id, { status: 'done', progress: 100, finishedAt: new Date().toISOString(), durationMs: Date.now() - new Date(a.startedAt).getTime(), result: summarize(result) }); return a; }
  fail(kind, refId, err) { const a = this._find(kind, refId); if (a) this.store.update('activities', a.id, { status: err?.cancelled ? 'cancelled' : 'failed', finishedAt: new Date().toISOString(), durationMs: Date.now() - new Date(a.startedAt).getTime(), error: err?.message || String(err) }); return a; }
  // 즉시 끝나는 작업(SEO·썸네일·TTS 등)을 한 번에 기록
  log(userId, { kind, refId = null, title = '', input = null, result = null, error = null, startedAt = null }) {
    const s = startedAt || new Date().toISOString();
    return this.store.insert('activities', { userId, kind, kindLabel: ACTIVITY_KINDS[kind] || kind, refId, projectKind: null, title: String(title || '').slice(0, 120), input, status: error ? 'failed' : 'done', progress: error ? 0 : 100, step: null, startedAt: s, finishedAt: new Date().toISOString(), durationMs: Date.now() - new Date(s).getTime(), result: summarize(result), error: error ? String(error.message || error) : null, estimatedSec: null, cancelRequested: false });
  }

  list(userId, { status = '', kind = '', limit = 200 } = {}) {
    let items = this.store.find('activities', (a) => a.userId === userId);
    if (status) items = items.filter((a) => (status === 'active' ? ['queued', 'processing'].includes(a.status) : a.status === status));
    if (kind) items = items.filter((a) => a.kind === kind);
    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const counts = { queued: 0, processing: 0, done: 0, failed: 0, cancelled: 0 };
    for (const a of this.store.find('activities', (x) => x.userId === userId)) counts[a.status] = (counts[a.status] || 0) + 1;
    return { items: items.slice(0, limit), counts, queue: this.queue.stats() };
  }
  get(userId, id) { const a = this.store.get('activities', id); if (!a || a.userId !== userId) throw new ApiError(404, '작업 기록을 찾을 수 없습니다.'); return a; }
  remove(userId, id) { this.get(userId, id); return this.store.remove('activities', id); }
  clearFinished(userId) { let n = 0; for (const a of this.store.find('activities', (x) => x.userId === userId && ['done', 'failed', 'cancelled'].includes(x.status))) { this.store.remove('activities', a.id); n += 1; } return n; }

  // 취소: 큐 대기 중이면 즉시, 처리 중이면 엔진이 다음 단계에서 확인해 중단한다
  cancel(userId, id) {
    const a = this.get(userId, id);
    if (['done', 'failed', 'cancelled'].includes(a.status)) throw new ApiError(409, '이미 끝난 작업입니다.');
    const col = { shorts: 'jobs', remix: 'remixJobs', longform: 'longformJobs' }[a.kind];
    if (col && a.refId) this.store.update(col, a.refId, { cancelRequested: true });
    const dequeued = this.queue.cancel((meta) => meta.refId === a.refId && meta.kind === a.kind);
    this.store.update('activities', id, { cancelRequested: true, ...(dequeued ? { status: 'cancelled', finishedAt: new Date().toISOString(), error: '대기 중 취소' } : {}) });
    if (dequeued && col) { const runner = this.runners[a.kind]; runner?.onCancelled?.(a.refId); }
    return this.get(userId, id);
  }

  // 다시 실행 / 실패한 작업 재시도: 기록된 입력으로 같은 종류의 작업을 새로 만든다
  async rerun(userId, id) {
    const a = this.get(userId, id);
    const runner = this.runners[a.kind];
    if (!runner?.rerun) throw new ApiError(400, '이 작업은 다시 실행할 수 없습니다.');
    if (!a.input) throw new ApiError(400, '다시 실행할 입력 정보가 없습니다.');
    const created = await runner.rerun(userId, a.input, a);
    return { activity: this._find(a.kind, created?.id || null) || a, created };
  }

  registerRunner(kind, runner) { this.runners[kind] = runner; }

  // 엔진 훅: 취소 확인
  checkCancelled(col, refId) { const rec = this.store.get(col, refId); if (rec?.cancelRequested) throw new CancelledError(); }
}

function summarize(result) {
  if (result == null) return null;
  if (typeof result !== 'object') return { value: result };
  try { const s = JSON.stringify(result); return s.length > 4000 ? { summary: s.slice(0, 4000), truncated: true } : result; } catch { return null; }
}
