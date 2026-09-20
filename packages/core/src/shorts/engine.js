// 알파컷 핵심: 링크/파일 → AI 하이라이트 분석 → 쇼츠 자동 편집(템플릿·자막·무음 제거·후킹·화자 줌·음성 향상·AI 후킹 보이스)
// → 결과 확인/편집/재생성/내보내기. 이용권은 원본 길이(분)만큼 차감, 재생성은 절반.
import path from 'node:path';
import { ApiError } from '../errors.js';
import { parseYoutubeUrl, fetchYoutubeMeta, probe, validateVideoMeta, renderClip } from '../media.js';
import { transcribe, semanticSplit } from '../subtitles/stt.js';
import { toASS, exportSubtitles } from '../subtitles/format.js';
import { TEMPLATES, GENRES, RATIOS, detectGenre, templateFor } from './templates.js';

export const DEFAULT_OPTIONS = Object.freeze({
  template: 'auto',          // 쇼츠 디자인 템플릿
  autoSubtitles: true,       // 초정밀 자동 자막
  subtitleAnimation: true,   // 자막 애니메이션 효과
  removeSilence: true,       // 무음 구간 제거
  autoHook: true,            // 첫 3초 후킹 자동화
  speakerTracking: true,     // 화자 추적 + 다이나믹 줌
  voiceEnhance: true,        // 음성 향상 (잡음/배경음 제거)
  aiHookVoice: false,        // AI 후킹 보이스 (첫 3초 멘트 TTS)
  voiceProfileId: null,      // 내 목소리 프로필 (없으면 기본 AI 보이스)
  ratio: '9:16',
  language: 'ko',
  targetLanguages: [],       // 다국어 번역 자막/제목
  clipCount: 'auto',         // 2분당 1개
});

const STEPS = ['queued', 'downloading', 'transcribing', 'analyzing', 'editing', 'rendering', 'done'];

export class ShortsEngine {
  constructor({ store, credits, ai, translate, notifications, uploadsDir, outputDir, voice = null, library = null }) {
    this.store = store; this.credits = credits; this.ai = ai; this.translate = translate; this.voice = voice; this.library = library;
    this.notifications = notifications;
    this.uploadsDir = uploadsDir; this.outputDir = outputDir;
    this.timers = new Map();
    this.speed = Number(process.env.ALPHAMAN_JOB_SPEED || 1); // 테스트에서 빠르게 돌리기 위한 배율
  }

  templates() { return TEMPLATES; }
  genres() { return GENRES; }
  ratios() { return RATIOS; }

  // 1) 작업 생성 --------------------------------------------------------------
  // transcript(브라우저 Whisper 세그먼트) / transcriptText(붙여넣은 대본)는 원본과 똑같은 자막을 위해 옵션으로 함께 저장한다
  async createFromYoutube(userId, { url, options = {}, transcript = null, transcriptText = '' }) {
    const yt = parseYoutubeUrl(url);
    const meta = await fetchYoutubeMeta(yt.id);
    const durationSec = meta.durationSec || Number(options.estimatedDurationSec) || 600;
    return this._create(userId, {
      source: { type: 'youtube', url: yt.url, videoId: yt.id, title: meta.title, channel: meta.channel, thumbnail: meta.thumbnail, durationSec },
      options: withTranscript(options, transcript, transcriptText),
    });
  }

  async createFromUpload(userId, { uploadId, options = {}, transcript = null, transcriptText = '' }) {
    const upload = this.store.get('uploads', uploadId);
    if (!upload || upload.userId !== userId) throw new ApiError(404, '업로드된 파일을 찾을 수 없습니다.');
    const meta = await probe(upload.path);
    validateVideoMeta({ filename: upload.filename, mimeType: upload.mimeType, ...meta });
    return this._create(userId, {
      source: { type: 'file', uploadId, path: upload.path, title: path.parse(upload.filename).name, durationSec: meta.durationSec, width: meta.width, height: meta.height, thumbnail: null },
      options: withTranscript(options, transcript, transcriptText),
    });
  }

  _create(userId, { source, options }) {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    if (!RATIOS.includes(opts.ratio)) throw new ApiError(400, `지원하지 않는 비율입니다: ${opts.ratio}`);
    const minutes = Math.max(0.5, Math.round((source.durationSec / 60) * 100) / 100);
    const job = this.store.insert('jobs', {
      userId, kind: 'shorts', source, options: opts, minutesCharged: minutes,
      status: 'queued', step: 'queued', progress: 0, log: [], clipIds: [], error: null, regenerations: 0,
    });
    this.credits.charge(userId, minutes, `쇼츠 제작: ${source.title}`, { jobId: job.id });
    this._schedule(job.id);
    return job;
  }

  // 2) 파이프라인 (비동기 단계별 진행) -------------------------------------------
  _schedule(jobId) {
    const t = setTimeout(() => this._run(jobId).catch((err) => this._fail(jobId, err)), 10);
    if (t.unref) t.unref();
    this.timers.set(jobId, t);
  }

  _log(jobId, step, progress, message) {
    this.store.update('jobs', jobId, (j) => ({ step, status: step === 'done' ? 'done' : 'processing', progress, log: [...j.log, { at: new Date().toISOString(), step, message }] }));
  }

  _wait(ms) { return new Promise((r) => { const t = setTimeout(r, Math.max(0, ms / this.speed)); if (t.unref) t.unref(); }); }

  async _run(jobId) {
    const job = this.store.get('jobs', jobId);
    if (!job) return;
    const { source, options } = job;
    this._log(jobId, 'downloading', 8, source.type === 'youtube' ? '유튜브 영상을 가져오는 중' : '업로드 파일을 준비하는 중');
    await this._wait(400);
    this._log(jobId, 'transcribing', 25, '음성을 인식해 대본을 만드는 중 (Whisper)');
    const stt = await transcribe({ filePath: source.path, durationSec: source.durationSec, language: options.language, title: source.title, source, transcript: options.transcript || null, transcriptText: options.transcriptText || '' });
    await this._wait(400);
    this._log(jobId, 'analyzing', 45, 'AI가 하이라이트 구간을 찾는 중');
    const genre = options.genre && GENRES.some((g) => g.id === options.genre) ? options.genre : detectGenre(source.title, stt.segments.map((s) => s.text).join(' '));
    const highlights = await this.findHighlights({ segments: stt.segments, durationSec: source.durationSec, genre, title: source.title, clipCount: options.clipCount });
    await this._wait(400);
    this._log(jobId, 'editing', 65, `${highlights.length}개 클립 편집 중 (자막·후킹·무음 제거·줌·음성 향상)`);
    const template = options.template === 'auto' ? templateFor(genre) : (TEMPLATES.find((t) => t.id === options.template) || templateFor(genre));
    const clipIds = [];
    for (const [i, h] of highlights.entries()) {
      const clip = await this.buildClip({ job, index: i, highlight: h, segments: stt.segments, template, genre });
      clipIds.push(clip.id);
    }
    this.store.update('jobs', jobId, { clipIds, genre, transcriptEngine: stt.engine, transcriptExact: stt.exact !== false, segmentCount: stt.segments.length });
    await this._wait(300);
    this._log(jobId, 'rendering', 85, '클립을 렌더링하는 중');
    for (const id of clipIds) await this.render(id);
    this._log(jobId, 'done', 100, `쇼츠 ${clipIds.length}개 제작 완료`);
    const done = this.store.update('jobs', jobId, { status: 'done', completedAt: new Date().toISOString() });
    // 보관함에 자동 저장 (완성된 클립마다 한 항목)
    if (this.library) this.library.addShortsJob(done, clipIds.map((id) => this.store.get('clips', id)).filter(Boolean));
    this.notifications?.push(job.userId, { type: 'shorts.done', title: '쇼츠 제작 완료', body: `"${source.title}" 에서 쇼츠 ${clipIds.length}개가 완성됐어요. 보관함에서 미리 볼 수 있어요.`, link: `#/studio/${jobId}` });
  }

  _fail(jobId, err) {
    console.error('[shorts] 작업 실패', jobId, err);
    const job = this.store.update('jobs', jobId, (j) => ({ status: 'failed', error: err.message, log: [...j.log, { at: new Date().toISOString(), step: 'failed', message: err.message }] }));
    if (job) {
      // 실패 시 이용권 환불
      this.credits.grant(job.userId, job.minutesCharged, '작업 실패 환불', { jobId });
      this.notifications?.push(job.userId, { type: 'shorts.failed', title: '쇼츠 제작 실패', body: err.message });
    }
  }

  // 3) 하이라이트 선정: "시청자의 관심을 끌 수 있는 장면, 중요한 정보, 감정적 몰입도" 기준. 2분당 1개.
  async findHighlights({ segments, durationSec, genre, title, clipCount }) {
    const rules = GENRES.find((g) => g.id === genre).rules;
    const target = clipCount === 'auto' || !clipCount ? Math.max(1, Math.round(durationSec / 120)) : Number(clipCount);
    const heuristic = () => this._heuristicHighlights({ segments, durationSec, rules, target });
    const transcript = segments.map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`).join('\n');
    const result = await this.ai.complete({
      system: '당신은 바이럴 쇼츠 편집자입니다. 롱폼 대본에서 시청자의 관심을 끌고 정보가 응축되고 감정적으로 몰입되는 구간을 골라 JSON 배열로만 답합니다.',
      prompt: `영상 제목: ${title}\n장르: ${genre}\n클립 개수: ${target}\n클립 길이: ${rules.minClip}~${rules.maxClip}초\n\n대본:\n${transcript}\n\n형식: [{"start":초,"end":초,"title":"후킹 제목(20자 이내)","reason":"선정 이유","hook":"첫 3초 후킹 멘트","score":0~100}]`,
      json: true,
      maxTokens: 8000,
      fallback: heuristic,
    });
    const list = Array.isArray(result) ? result : heuristic();
    return list.slice(0, target).map((h, i) => ({
      start: clamp(Number(h.start) || 0, 0, durationSec), end: clamp(Number(h.end) || 0, 0, durationSec),
      title: String(h.title || `하이라이트 #${i + 1}`).slice(0, 40), reason: h.reason || '', hook: h.hook || '', score: Number(h.score) || 70,
    })).filter((h) => h.end - h.start >= 5);
  }

  _heuristicHighlights({ segments, durationSec, rules, target }) {
    const KEYWORDS = /핵심|비밀|놀라|반전|절반|실수|중요|결과|꼭|처음|마지막|사실|진짜|충격|방법|shock|secret|key|never|best|why/i;
    const scored = segments.map((s, i) => ({ i, s, score: 40 + (KEYWORDS.test(s.text) ? 35 : 0) + (s.text.includes('?') ? 10 : 0) + Math.min(15, s.text.length / 4) + (i === 0 ? -20 : 0) }));
    const picked = [];
    const usable = scored.sort((a, b) => b.score - a.score);
    for (const cand of usable) {
      if (picked.length >= target) break;
      const len = clamp(rules.minClip + (cand.i % 3) * 8, rules.minClip, rules.maxClip);
      const start = Math.max(0, Math.min(cand.s.start - 3, durationSec - len));
      const end = Math.min(durationSec, start + len);
      if (picked.some((p) => Math.min(p.end, end) - Math.max(p.start, start) > 5)) continue;
      picked.push({ start: round(start), end: round(end), title: makeTitle(cand.s.text), reason: '키워드·문장 밀도 기반 자동 선정', hook: cand.s.text.split(/[,.!?]/)[0].slice(0, 30), score: Math.round(cand.score) });
    }
    return picked.sort((a, b) => a.start - b.start);
  }

  // 4) 클립 편집(가상 타임라인 구성) ---------------------------------------------
  async buildClip({ job, index, highlight, segments, template, genre }) {
    const opts = job.options;
    const rules = GENRES.find((g) => g.id === genre).rules;
    let segs = segments.filter((s) => s.end > highlight.start && s.start < highlight.end)
      .map((s) => ({ ...s, start: Math.max(s.start, highlight.start), end: Math.min(s.end, highlight.end) }));

    // 무음 구간 제거: 세그먼트 사이 공백이 threshold 이상이면 컷
    const cuts = [];
    if (opts.removeSilence) {
      for (let i = 1; i < segs.length; i++) {
        const gap = segs[i].start - segs[i - 1].end;
        if (gap >= rules.silenceThreshold) cuts.push({ start: round(segs[i - 1].end), end: round(segs[i].start), reason: 'silence' });
      }
    }
    const removed = cuts.reduce((s, c) => s + (c.end - c.start), 0);

    // 첫 3초 후킹: 하이라이트 문장을 앞으로, 알고리즘 친화 구조 (질문/숫자/인용)
    let hook = null;
    if (opts.autoHook) {
      hook = { text: highlight.hook || highlight.title, style: rules.hook, durationSec: 3, position: 'start' };
    }

    // 화자 추적 + 다이나믹 줌: 화자 전환 시점마다 줌 키프레임
    const zoomKeyframes = [];
    if (opts.speakerTracking) {
      let prev = null;
      for (const s of segs) {
        if (s.speaker !== prev) { zoomKeyframes.push({ at: round(s.start - highlight.start), speaker: s.speaker, scale: s.speaker === 'A' ? 1.15 : 1.25, mode: rules.zoom }); prev = s.speaker; }
      }
      if (!zoomKeyframes.length) zoomKeyframes.push({ at: 0, speaker: 'A', scale: 1.1, mode: rules.zoom });
    }

    // 자막: 의미 기반 분할 + 애니메이션 + 다국어 번역
    let subtitles = [];
    if (opts.autoSubtitles) {
      subtitles = semanticSplit(segs).map((s) => ({ ...s, start: round(s.start - highlight.start), end: round(s.end - highlight.start), words: s.words.map((w) => ({ ...w, start: round(w.start - highlight.start), end: round(w.end - highlight.start) })), animation: opts.subtitleAnimation ? template.animation : 'none' }));
    }
    const translations = {};
    for (const lang of opts.targetLanguages || []) {
      if (lang === opts.language) continue;
      translations[lang] = {
        title: (await this.translate.translateText(highlight.title, lang)).text,
        subtitles: subtitles.length ? await this.translate.translateSegments(subtitles, lang) : [],
      };
    }

    const durationSec = round(highlight.end - highlight.start - removed + (hook ? 0 : 0));
    return this.store.insert('clips', {
      jobId: job.id, userId: job.userId, index, title: highlight.title, reason: highlight.reason, score: highlight.score,
      start: highlight.start, end: highlight.end, durationSec, ratio: opts.ratio, templateId: template.id, genre,
      hook, cuts, zoomKeyframes, subtitles, translations,
      audio: { voiceEnhance: opts.voiceEnhance ? { denoise: true, removeMusic: true, loudnessLUFS: -14 } : null, aiHookVoice: opts.aiHookVoice && hook ? await this._hookVoice(job, hook, index) : null },
      status: 'edited', render: null, thumbnail: job.source.thumbnail, sourceTitle: job.source.title,
    });
  }

  // AI 후킹 보이스: 내 목소리 프로필이 있으면 그 목소리로, 없으면 기본 AI 보이스
  async _hookVoice(job, hook, index) {
    const base = { text: hook.text, durationSec: 3 };
    if (job.options.voiceProfileId && this.voice) {
      try { const r = await this.voice.synthesize(job.userId, { profileId: job.options.voiceProfileId, text: hook.text, style: 'hook', outputName: `hook-${job.id.slice(0, 8)}-${index + 1}` }); return { ...base, voice: 'my-voice', voiceProfileId: job.options.voiceProfileId, audioPath: r.audioPath, engine: r.engine }; }
      catch (err) { console.warn('[shorts] 내 목소리 합성 실패, 기본 보이스 사용:', err.message); }
    }
    return { ...base, voice: 'ko-female-bright', engine: 'default' };
  }

  // 5) 렌더링: ffmpeg 이 있으면 실제 파일 생성, 없으면 렌더 계획 저장
  async render(clipId) {
    const clip = this.store.get('clips', clipId);
    const job = this.store.get('jobs', clip.jobId);
    const template = TEMPLATES.find((t) => t.id === clip.templateId) || TEMPLATES[0];
    const ass = toASS(clip.subtitles, { font: template.font, size: template.fontSize });
    const out = path.join(this.outputDir, job.userId, `${clip.id}.mp4`);
    let result = { rendered: false, plan: null };
    if (job.source.path) {
      result = await renderClip({ input: job.source.path, output: out, start: clip.start, end: clip.end, ratio: clip.ratio });
    } else {
      result = { rendered: false, plan: { note: '유튜브 원본은 yt-dlp 로 내려받은 뒤 렌더링됩니다.', ratio: clip.ratio, start: clip.start, end: clip.end } };
    }
    const updated = this.store.update('clips', clipId, { status: 'ready', render: { ...result, subtitleASS: ass, templateId: template.id, renderedAt: new Date().toISOString() } });
    if (this.library && job.status === 'done') this.library.addShortsJob(job, [updated]); // 재렌더/편집 후 보관함 항목 갱신
    return updated;
  }

  // 6) 결과 조회/편집/재생성/내보내기 ---------------------------------------------
  listJobs(userId) {
    return this.store.find('jobs', (j) => j.userId === userId && j.kind === 'shorts').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getJob(userId, jobId, { admin = false } = {}) {
    const job = this.store.get('jobs', jobId);
    if (!job || (!admin && job.userId !== userId)) throw new ApiError(404, '작업을 찾을 수 없습니다.');
    return { ...job, clips: job.clipIds.map((id) => this.store.get('clips', id)).filter(Boolean) };
  }

  editClip(userId, clipId, patch) {
    const clip = this.store.get('clips', clipId);
    if (!clip || clip.userId !== userId) throw new ApiError(404, '클립을 찾을 수 없습니다.');
    const allowed = {};
    if (patch.title != null) allowed.title = String(patch.title).slice(0, 80);
    if (patch.ratio != null) { if (!RATIOS.includes(patch.ratio)) throw new ApiError(400, '지원하지 않는 비율입니다.'); allowed.ratio = patch.ratio; }
    if (patch.templateId != null) { if (!TEMPLATES.some((t) => t.id === patch.templateId)) throw new ApiError(400, '템플릿을 찾을 수 없습니다.'); allowed.templateId = patch.templateId; }
    if (patch.start != null || patch.end != null) {
      const start = Number(patch.start ?? clip.start); const end = Number(patch.end ?? clip.end);
      if (!(end - start >= 5)) throw new ApiError(400, '클립 길이는 5초 이상이어야 합니다.');
      if (end - start > 180) throw new ApiError(400, '클립 길이는 3분을 넘을 수 없습니다.');
      allowed.start = round(start); allowed.end = round(end); allowed.durationSec = round(end - start);
    }
    if (patch.subtitles) allowed.subtitles = patch.subtitles.map((s, i) => ({ id: s.id || `seg-${i + 1}`, start: Number(s.start), end: Number(s.end), text: String(s.text), words: s.words || [], animation: s.animation || 'none' }));
    if (patch.hookText != null) allowed.hook = { ...(clip.hook || { style: 'custom', durationSec: 3, position: 'start' }), text: String(patch.hookText) };
    if (typeof patch.removeSilence === 'boolean' && !patch.removeSilence) allowed.cuts = [];
    const updated = this.store.update('clips', clipId, { ...allowed, status: 'edited' });
    this.store.insert('auditLog', { userId, action: 'clip.edit', clipId, patch: Object.keys(allowed) });
    return updated;
  }

  async regenerate(userId, jobId) {
    const job = this.store.get('jobs', jobId);
    if (!job || job.userId !== userId) throw new ApiError(404, '작업을 찾을 수 없습니다.');
    if (job.status !== 'done' && job.status !== 'failed') throw new ApiError(409, '진행 중인 작업은 재생성할 수 없습니다.');
    const half = Math.round((job.minutesCharged / 2) * 100) / 100;
    this.credits.charge(userId, half, `쇼츠 재생성(50%): ${job.source.title}`, { jobId });
    for (const id of job.clipIds) { this.store.remove('clips', id); this.library?.removeByRef('shorts', id); }
    this.store.update('jobs', jobId, { status: 'queued', step: 'queued', progress: 0, clipIds: [], error: null, regenerations: job.regenerations + 1, log: [{ at: new Date().toISOString(), step: 'queued', message: '재생성 요청 (이용권 50% 차감)' }] });
    this._schedule(jobId);
    return this.store.get('jobs', jobId);
  }

  async rerender(userId, clipId) {
    const clip = this.store.get('clips', clipId);
    if (!clip || clip.userId !== userId) throw new ApiError(404, '클립을 찾을 수 없습니다.');
    return this.render(clipId);
  }

  exportClip(userId, clipId, format = 'mp4') {
    const clip = this.store.get('clips', clipId);
    if (!clip || clip.userId !== userId) throw new ApiError(404, '클립을 찾을 수 없습니다.');
    const template = TEMPLATES.find((t) => t.id === clip.templateId) || TEMPLATES[0];
    if (format === 'srt' || format === 'vtt' || format === 'ass') {
      return exportSubtitles(clip.subtitles, format, { font: template.font, size: template.fontSize });
    }
    if (format === 'json') return { body: JSON.stringify(clip, null, 2), mime: 'application/json', ext: 'json' };
    // mp4: 렌더된 파일 경로 또는 렌더 계획
    return { file: clip.render?.rendered ? clip.render.output : null, plan: clip.render?.plan || null, mime: 'video/mp4', ext: 'mp4', clip };
  }

  deleteJob(userId, jobId) {
    const job = this.store.get('jobs', jobId);
    if (!job || job.userId !== userId) throw new ApiError(404, '작업을 찾을 수 없습니다.');
    for (const id of job.clipIds) { this.store.remove('clips', id); this.library?.removeByRef('shorts', id); }
    this.store.remove('jobs', jobId);
    return true;
  }
}

function clamp(n, a, b) { return Math.min(b, Math.max(a, n)); }
function round(n) { return Math.round(n * 100) / 100; }
export function withTranscript(options, transcript, transcriptText) {
  const out = { ...options };
  if (Array.isArray(transcript) && transcript.length) out.transcript = transcript;
  if (transcriptText && String(transcriptText).trim()) out.transcriptText = String(transcriptText);
  return out;
}
function makeTitle(text) {
  const t = text.replace(/[.!?。]+$/, '').trim();
  const short = t.length > 22 ? `${t.slice(0, 20)}…` : t;
  return /[?]/.test(text) ? short : `${short} 🔥`;
}
