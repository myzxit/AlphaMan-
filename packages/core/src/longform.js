// 롱폼 컷편집: 롱폼 영상 전체에 무음 구간 제거 + 자동 자막 + 챕터 생성 (알파컷 "서비스 > 롱폼 컷편집")
import { ApiError } from './errors.js';
import { parseYoutubeUrl, fetchYoutubeMeta, probe, ensureLocalFile } from './media.js';
import { transcribe, semanticSplit } from './subtitles/stt.js';

export class LongformEngine {
  constructor({ store, credits, ai, notifications, library = null, seo = null, thumbnail = null, activity = null }) {
    this.store = store; this.credits = credits; this.ai = ai; this.notifications = notifications; this.library = library; this.seo = seo; this.thumbnail = thumbnail; this.activity = activity;
    this.speed = Number(process.env.ALPHAMAN_JOB_SPEED || 1);
  }

  async create(userId, { url, uploadId, options = {}, transcript = null, transcriptText = '' }) {
    if (Array.isArray(transcript) && transcript.length) options = { ...options, transcript };
    if (transcriptText && String(transcriptText).trim()) options = { ...options, transcriptText: String(transcriptText) };
    let source;
    if (uploadId) {
      const up = this.store.get('uploads', uploadId);
      if (!up || up.userId !== userId) throw new ApiError(404, '업로드된 파일을 찾을 수 없습니다.');
      await ensureLocalFile(up);
      const meta = await probe(up.path);
      source = { type: 'file', uploadId, path: up.path, remoteUrl: up.remoteUrl || null, title: up.filename, durationSec: meta.durationSec };
    } else {
      const yt = parseYoutubeUrl(url);
      const meta = await fetchYoutubeMeta(yt.id);
      source = { type: 'youtube', url: yt.url, videoId: yt.id, title: meta.title, channel: meta.channel, durationSec: meta.durationSec || 900, thumbnail: meta.thumbnail, tags: meta.tags || [], description: meta.description || '' };
    }
    const opts = { removeSilence: true, silenceThreshold: 0.7, autoSubtitles: true, chapters: true, jumpCuts: true, language: 'ko', ...options };
    const minutes = Math.round((source.durationSec / 60) * 100) / 100;
    const job = this.store.insert('longformJobs', { userId, source, options: opts, minutesCharged: minutes, status: 'processing', progress: 10, result: null });
    this.credits.charge(userId, minutes, `롱폼 컷편집: ${source.title}`, { jobId: job.id });
    this.activity?.start(userId, { kind: 'longform', refId: job.id, title: source.title, input: { url: url || null, uploadId: uploadId || null, options: { ...opts, transcript: undefined }, transcript: opts.transcript || null, transcriptText: opts.transcriptText || '' } });
    const run = () => this._run(job.id).catch((e) => this._fail(job.id, e));
    if (this.activity?.queue) this.activity.queue.push(run, { kind: 'longform', refId: job.id });
    else { const t = setTimeout(run, 10); if (t.unref) t.unref(); }
    return job;
  }
  _fail(jobId, err) {
    const cancelled = Boolean(err?.cancelled);
    const job = this.store.update('longformJobs', jobId, { status: cancelled ? 'cancelled' : 'failed', error: err.message });
    if (job) { this.credits.grant(job.userId, job.minutesCharged, cancelled ? '롱폼 취소 환불' : '롱폼 실패 환불', { jobId }); this.notifications?.push(job.userId, { type: cancelled ? 'longform.cancelled' : 'longform.failed', title: cancelled ? '롱폼 컷편집 취소' : '롱폼 컷편집 실패', body: err.message, link: '#/jobs' }); }
    this.activity?.fail('longform', jobId, err);
  }
  onCancelled(jobId) { const j = this.store.get('longformJobs', jobId); if (j && j.status !== 'done') this._fail(jobId, Object.assign(new Error('대기 중 취소되었습니다.'), { cancelled: true })); }

  async _run(jobId) {
    const job = this.store.get('longformJobs', jobId);
    const stt = await transcribe({ filePath: job.source.path, durationSec: job.source.durationSec, language: job.options.language, title: job.source.title, source: job.source, transcript: job.options.transcript || null, transcriptText: job.options.transcriptText || '' });
    this.activity?.checkCancelled('longformJobs', jobId);
    this.store.update('longformJobs', jobId, { progress: 50 });
    this.activity?.progress('longform', jobId, 50, 'analyzing');
    const segs = stt.segments;
    const cuts = [];
    if (job.options.removeSilence) {
      for (let i = 1; i < segs.length; i++) {
        const gap = segs[i].start - segs[i - 1].end;
        if (gap >= job.options.silenceThreshold) cuts.push({ start: segs[i - 1].end, end: segs[i].start });
      }
    }
    const removed = cuts.reduce((s, c) => s + c.end - c.start, 0);
    const chapters = job.options.chapters ? await this._chapters(segs, job.source.title) : [];
    const subtitles = job.options.autoSubtitles ? semanticSplit(segs) : [];
    const seo = this.seo ? await this.seo.generate({ kind: 'longform', title: job.source.title, hook: segs[0]?.text || '', originalTitle: job.source.title, originalTags: job.source.tags || [], originalDescription: job.source.description || '', channel: job.source.channel || '', segments: segs, durationSec: job.source.durationSec - removed, language: job.options.language }).catch(() => null) : null;
    const result = {
      seo,
      originalDurationSec: job.source.durationSec,
      editedDurationSec: Math.round((job.source.durationSec - removed) * 100) / 100,
      removedSec: Math.round(removed * 100) / 100,
      cuts, chapters, subtitles, transcriptEngine: stt.engine, transcriptExact: stt.exact !== false,
      timeline: buildTimeline(job.source.durationSec, cuts),
    };
    const done = this.store.update('longformJobs', jobId, { status: 'done', progress: 100, result });
    if (this.library) this.library.addLongformJob(done); // 보관함 자동 저장
    if (this.thumbnail) await this.thumbnail.auto(job.userId, 'longform', jobId).catch((e) => console.warn('[longform] 썸네일 자동 제작 실패:', e.message));
    this.notifications?.push(job.userId, { type: 'longform.done', title: '롱폼 컷편집 완료', body: `${result.removedSec}초의 공백을 제거했어요. 보관함에서 미리 볼 수 있어요.`, link: `#/longform/${jobId}` });
    this.activity?.done('longform', jobId, { removedSec: result.removedSec, link: `#/longform/${jobId}` });
  }

  async _chapters(segments, title) {
    const every = Math.max(1, Math.floor(segments.length / 6));
    const fallback = () => segments.filter((_, i) => i % every === 0).slice(0, 8).map((s) => ({ at: s.start, title: s.text.slice(0, 18) }));
    const res = await this.ai.complete({
      system: '유튜브 롱폼 편집자입니다. 대본을 보고 6~8개의 챕터를 JSON 배열 [{"at":초,"title":"챕터명"}] 로만 답합니다.',
      prompt: `제목: ${title}\n\n${segments.map((s) => `[${s.start}] ${s.text}`).join('\n')}`,
      json: true, maxTokens: 4000, fallback,
    });
    return Array.isArray(res) ? res.map((c) => ({ at: Number(c.at) || 0, title: String(c.title || '').slice(0, 40) })) : fallback();
  }

  list(userId) { return this.store.find('longformJobs', (j) => j.userId === userId && !j.deletedAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  get(userId, id) { const j = this.store.get('longformJobs', id); if (!j || j.userId !== userId) throw new ApiError(404, '작업을 찾을 수 없습니다.'); return j; }
  remove(userId, id) { this.get(userId, id); this.library?.removeByRef('longform', id); return this.store.remove('longformJobs', id); }
}

function buildTimeline(duration, cuts) {
  const keep = [];
  let cur = 0;
  for (const c of cuts) { if (c.start > cur) keep.push({ start: cur, end: c.start }); cur = c.end; }
  if (cur < duration) keep.push({ start: cur, end: duration });
  return keep;
}
