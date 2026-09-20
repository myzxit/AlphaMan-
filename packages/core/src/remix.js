// AI 재구성(리믹스): 영상 링크 또는 파일 하나만 넣으면 원본의 자막·효과음·배경음을 걷어내고, 1~28분 목표 길이로 다시 구성한 뒤
// AI 가 새 자막·효과음·배경음·내레이션(내 목소리 TTS)을 입혀 새로운 편집본을 만든다. 참고 유튜브 영상을 지정하면 그 영상의
// 구성·호흡·자막 스타일을 분석해 같은 방식으로 재구성한다.
// 사용 범위: 본인이 권리를 가진 영상(직접 촬영·제작했거나 사용 허가를 받은 영상)에 한하며, 작업 생성 시 권리 확인이 필요하다.
import path from 'node:path';
import fs from 'node:fs';
import { ApiError } from './errors.js';
import { parseYoutubeUrl, parseVideoUrl, fetchYoutubeMeta, probe, validateVideoMeta, which, run } from './media.js';
import { transcribe, semanticSplit } from './subtitles/stt.js';
import { toASS } from './subtitles/format.js';
import { TEMPLATES, detectGenre, templateFor } from './shorts/templates.js';

export const REMIX_LIMITS = Object.freeze({ minMinutes: 1, maxMinutes: 28 });

export const REMIX_DEFAULTS = Object.freeze({
  targetMinutes: 5,            // 1 ~ 28
  removeBurnedSubtitles: true, // 원본에 박힌 자막 제거 (크롭/인페인팅)
  removeSfx: true,             // 원본 효과음 제거 (음원 분리 후 효과음 트랙 제외)
  removeBgm: true,             // 원본 배경음악 제거
  keepOriginalVoice: true,     // 원본 목소리는 유지 (내레이션 모드에서는 false 로 두면 전체 더빙)
  newSubtitles: true,          // 새 자막 (템플릿)
  newSfx: true,                // 새 효과음 큐
  newBgm: true,                // 새 배경음악
  narration: 'none',           // none | intro | full  (내 목소리 TTS 내레이션)
  voiceProfileId: null,
  template: 'auto',
  ratio: 'auto',              // auto = 참고 영상이 있으면 참고 영상 비율, 없으면 원본 비율
  language: 'ko',
  pacing: 'auto',              // auto | slow | normal | fast  (참고 영상이 있으면 거기서 추정)
  reorder: true,               // 구조 재배열 (후킹 → 본문 → 마무리)
  colorGrade: 'auto',
  transitions: 'auto',
});

const SFX_LIBRARY = ['whoosh', 'pop', 'ding', 'boom', 'click', 'riser', 'swoosh', 'sparkle', 'thud', 'record-scratch'];
const BGM_LIBRARY = { education: 'lofi-focus', interview: 'warm-acoustic', info: 'upbeat-corporate', gaming: 'edm-drive', vlog: 'sunny-pop' };

export class RemixEngine {
  constructor({ store, credits, ai, translate, voice, notifications, outputDir, library = null }) {
    this.store = store; this.credits = credits; this.ai = ai; this.translate = translate; this.voice = voice; this.notifications = notifications; this.outputDir = outputDir; this.library = library;
    this.speed = Number(process.env.ALPHAMAN_JOB_SPEED || 1);
  }

  defaults() { return { ...REMIX_DEFAULTS, limits: REMIX_LIMITS, templates: TEMPLATES.map((t) => ({ id: t.id, name: t.name })), sfx: SFX_LIBRARY, bgm: BGM_LIBRARY }; }

  // ---- 작업 생성 (링크 또는 파일 중 하나) ----
  async create(userId, { url, uploadId, localPath, referenceUrl = null, options = {}, rightsConfirmed = false, transcript = null, transcriptText = '' }) {
    if (!rightsConfirmed) throw new ApiError(400, '재구성할 권리가 있는 영상(직접 제작했거나 사용 허가를 받은 영상)인지 확인해주세요.');
    const opts = { ...REMIX_DEFAULTS, ...options };
    if (Array.isArray(transcript) && transcript.length) opts.transcript = transcript; // 브라우저에서 추출한 원본 대본
    if (transcriptText && String(transcriptText).trim()) opts.transcriptText = String(transcriptText); // 붙여넣은 대본
    const target = Number(opts.targetMinutes);
    if (!(target >= REMIX_LIMITS.minMinutes && target <= REMIX_LIMITS.maxMinutes)) throw new ApiError(400, `목표 길이는 ${REMIX_LIMITS.minMinutes}~${REMIX_LIMITS.maxMinutes}분 사이여야 합니다.`);
    if (!['none', 'intro', 'full'].includes(opts.narration)) throw new ApiError(400, '내레이션 모드가 올바르지 않습니다.');
    if (!['auto', '16:9', '9:16', '1:1', '4:5'].includes(opts.ratio)) throw new ApiError(400, '지원하지 않는 비율입니다.');
    if (opts.narration !== 'none') { if (!opts.voiceProfileId) throw new ApiError(400, '내레이션에 사용할 음성 프로필을 선택해주세요.'); this.voice.get(userId, opts.voiceProfileId); }

    let source;
    if (uploadId) {
      const up = this.store.get('uploads', uploadId);
      if (!up || up.userId !== userId) throw new ApiError(404, '업로드된 파일을 찾을 수 없습니다.');
      const meta = await probe(up.path);
      validateVideoMeta({ filename: up.filename, mimeType: up.mimeType, ...meta });
      source = { type: 'file', uploadId, path: up.path, title: path.parse(up.filename).name, durationSec: meta.durationSec, width: meta.width, height: meta.height };
    } else if (localPath) {
      const meta = await probe(localPath);
      validateVideoMeta({ filename: path.basename(localPath), ...meta });
      source = { type: 'local', path: localPath, title: path.parse(localPath).name, durationSec: meta.durationSec, width: meta.width, height: meta.height };
    } else if (url) {
      // 롱폼 링크든 쇼츠 링크든(YouTube / YouTube Shorts / TikTok / Instagram Reels) 하나만 넣으면 된다
      const parsed = parseVideoUrl(url);
      const isShorts = /\/shorts\//.test(String(url)) || parsed.platform !== 'youtube';
      let meta = { title: `${parsed.platform} 영상 ${parsed.id}`, channel: null, thumbnail: null, durationSec: null };
      if (parsed.platform === 'youtube') meta = await fetchYoutubeMeta(parsed.id);
      const est = Number(options.estimatedDurationSec);
      source = { type: parsed.platform, url: parsed.url, videoId: parsed.id, title: meta.title, channel: meta.channel, thumbnail: meta.thumbnail, isShorts, durationSec: meta.durationSec || (est > 0 ? est : (isShorts ? 45 : 600)), notice: parsed.notice || null };
    } else throw new ApiError(400, '영상 링크(롱폼/쇼츠) 또는 파일 중 하나를 올려주세요.');

    let reference = null;
    if (referenceUrl) {
      // (선택) "이 영상처럼 편집해 달라"는 참고 영상. 롱폼/쇼츠/TikTok/Reels 링크 모두 가능
      const ref = parseVideoUrl(referenceUrl);
      let meta = { title: `${ref.platform} 영상 ${ref.id}`, channel: null, thumbnail: null, durationSec: null };
      if (ref.platform === 'youtube') meta = await fetchYoutubeMeta(ref.id);
      const isShorts = /\/shorts\//.test(String(referenceUrl)) || ref.platform !== 'youtube';
      reference = { url: ref.url, platform: ref.platform, videoId: ref.id, title: meta.title, channel: meta.channel, thumbnail: meta.thumbnail, durationSec: meta.durationSec || (isShorts ? 45 : null), isShorts, chapters: meta.chapters || [], tags: meta.tags || [], description: meta.description || '' };
    }

    const minutes = Math.max(0.5, Math.round((source.durationSec / 60) * 100) / 100);
    const job = this.store.insert('remixJobs', {
      userId, source, reference, options: opts, minutesCharged: minutes, rightsConfirmedAt: new Date().toISOString(),
      status: 'queued', step: 'queued', progress: 0, log: [], result: null, error: null,
    });
    this.credits.charge(userId, minutes, `AI 재구성: ${source.title}`, { jobId: job.id });
    const t = setTimeout(() => this._run(job.id).catch((err) => this._fail(job.id, err)), 10);
    if (t.unref) t.unref();
    return job;
  }

  _log(jobId, step, progress, message) {
    this.store.update('remixJobs', jobId, (j) => ({ step, status: step === 'done' ? 'done' : 'processing', progress, log: [...j.log, { at: new Date().toISOString(), step, message }] }));
  }
  _wait(ms) { return new Promise((r) => { const t = setTimeout(r, Math.max(0, ms / this.speed)); if (t.unref) t.unref(); }); }

  _fail(jobId, err) {
    console.error('[remix] 작업 실패', jobId, err);
    const job = this.store.update('remixJobs', jobId, (j) => ({ status: 'failed', error: err.message, log: [...j.log, { at: new Date().toISOString(), step: 'failed', message: err.message }] }));
    if (job) { this.credits.grant(job.userId, job.minutesCharged, '재구성 실패 환불', { jobId }); this.notifications?.push(job.userId, { type: 'remix.failed', title: 'AI 재구성 실패', body: err.message }); }
  }

  // ---- 파이프라인 ----
  async _run(jobId) {
    const job = this.store.get('remixJobs', jobId);
    const { source, options: opts } = job;

    this._log(jobId, 'ingest', 6, source.type === 'youtube' ? '원본 영상을 가져오는 중' : '원본 파일을 준비하는 중');
    await this._wait(300);

    let styleProfile = null;
    if (job.reference) {
      this._log(jobId, 'reference', 14, `참고 영상 분석 중: ${job.reference.title}`);
      styleProfile = await this.analyzeReference(job.reference, opts);
      await this._wait(300);
    }

    this._log(jobId, 'transcribing', 26, '원본 음성을 인식해 대본을 만드는 중');
    const stt = await transcribe({ filePath: source.path, durationSec: source.durationSec, language: opts.language, title: source.title, source, transcript: opts.transcript || null, transcriptText: opts.transcriptText || '' });
    const genre = detectGenre(source.title, stt.segments.map((s) => s.text).join(' '));
    await this._wait(300);

    this._log(jobId, 'cleaning', 40, `원본 정리 중 (${[opts.removeBurnedSubtitles && '박힌 자막 제거', opts.removeSfx && '효과음 제거', opts.removeBgm && '배경음 제거'].filter(Boolean).join(', ') || '원본 유지'})`);
    const cleaning = this.planCleaning(source, opts);
    await this._wait(300);

    this._log(jobId, 'planning', 55, `AI 가 ${opts.targetMinutes}분 구성을 짜는 중`);
    const plan = await this.planStructure({ segments: stt.segments, source, opts, genre, styleProfile });
    await this._wait(300);

    this._log(jobId, 'rebuilding', 72, '새 자막·효과음·배경음·내레이션을 입히는 중');
    const rebuild = await this.rebuild({ job, plan, segments: stt.segments, genre, styleProfile });
    await this._wait(300);

    this._log(jobId, 'rendering', 88, '렌더링 중');
    const render = await this.render({ job, plan, rebuild, cleaning });

    const result = {
      genre, styleProfile, cleaning, plan, ...rebuild, render, transcriptEngine: stt.engine, transcriptExact: stt.exact !== false,
      originalDurationSec: source.durationSec, targetDurationSec: opts.targetMinutes * 60, finalDurationSec: plan.finalDurationSec,
      summary: `${Math.round(source.durationSec / 60)}분 원본 → ${Math.round(plan.finalDurationSec / 60)}분 재구성 · 구간 ${plan.keep.length}개 · 자막 ${rebuild.subtitles.length}줄 · 효과음 ${rebuild.sfx.length}개${rebuild.narration ? ` · 내레이션 ${rebuild.narration.lines.length}줄` : ''}`,
    };
    this.store.update('remixJobs', jobId, { result });
    this._log(jobId, 'done', 100, '재구성 완료');
    const done = this.store.update('remixJobs', jobId, { status: 'done', completedAt: new Date().toISOString() });
    if (this.library) this.library.addRemixJob(done); // 보관함 자동 저장
    this.notifications?.push(job.userId, { type: 'remix.done', title: 'AI 재구성 완료', body: `${result.summary} · 보관함에서 미리 볼 수 있어요.`, link: `#/remix/${jobId}` });
  }

  // 참고 영상 → 편집 스타일 프로필. 타임라인이 그대로 따라 하는 항목: 섹션 구조·구간 길이 패턴·후킹 길이·호흡·자막 스타일/위치·
  // 효과음 밀도·전환·색감·비율·BGM 무드. yt-dlp 가 있으면 챕터/태그/설명을 읽고, AI 가 있으면 더 정밀하게 추정한다.
  async analyzeReference(reference, opts) {
    const dur = reference.durationSec || (reference.isShorts ? 45 : 480);
    const fallback = () => {
      const pacing = reference.isShorts || dur < 180 ? 'fast' : dur < 900 ? 'normal' : 'slow';
      const t = `${reference.title} ${reference.description || ''} ${(reference.tags || []).join(' ')}`.toLowerCase();
      const chapters = (reference.chapters || []).filter((c) => c.title);
      const structure = chapters.length >= 2 ? chapters.map((c) => c.title) : (reference.isShorts ? ['0-3초 후킹', '핵심 한 가지', '반전/결론', '마무리 한 줄'] : ['0-10초 후킹(결론 먼저)', '문제 제기', '핵심 3가지', '사례/증거', '마무리·구독 유도']);
      const segmentPattern = chapters.length >= 2
        ? chapters.map((c, i) => Math.max(0.02, ((chapters[i + 1]?.start ?? dur) - c.start) / dur))
        : (reference.isShorts ? [0.1, 0.35, 0.4, 0.15] : [0.06, 0.14, 0.45, 0.25, 0.1]);
      return {
        pacing, avgShotSec: pacing === 'fast' ? 2.5 : pacing === 'normal' ? 4.5 : 7, cutsPerMinute: pacing === 'fast' ? 22 : pacing === 'normal' ? 13 : 8,
        hookDurationSec: reference.isShorts ? 3 : 10, hookType: /\?|왜|이유|how|why/.test(t) ? 'question' : /\d/.test(t) ? 'number' : 'quote',
        subtitleStyle: /브이로그|vlog|여행/.test(t) ? 'vlog-soft' : /게임|game/.test(t) ? 'gamer-neon' : /리뷰|정보|주식|review|분석/.test(t) ? 'news-ticker' : /ㅋㅋ|웃긴|밈|개그/.test(t) ? 'meme-impact' : /강의|공부|설명|tutorial/.test(t) ? 'clean-bold' : 'talk-caption',
        subtitlePosition: reference.isShorts ? 'center' : 'bottom', captionsPerMinute: pacing === 'fast' ? 24 : 16,
        structure, segmentPattern, cardStyle: reference.isShorts ? 'none' : 'chapter-cards',
        tone: /ㅋㅋ|웃긴|개그|밈/.test(t) ? 'humorous' : /분석|이유|정리|explained/.test(t) ? 'analytical' : /감동|힐링|여행|일상/.test(t) ? 'warm' : 'friendly',
        sfxDensity: pacing === 'fast' ? 'high' : 'medium', bgm: /브이로그|vlog|여행|힐링/.test(t) ? 'sunny-pop' : /게임|game/.test(t) ? 'edm-drive' : /강의|공부/.test(t) ? 'lofi-focus' : 'upbeat-corporate',
        transitions: pacing === 'fast' ? 'hard-cut' : 'crossfade', colorGrade: /브이로그|vlog|여행/.test(t) ? 'warm' : /시네마|영화|cinematic/.test(t) ? 'cinematic' : 'clean-bright',
        ratio: reference.isShorts ? '9:16' : '16:9', zoomStyle: pacing === 'fast' ? 'punch-in' : 'slow-push', textOverlays: reference.isShorts ? 'big-keyword' : 'lower-third',
      };
    };
    const res = await this.ai.complete({
      system: '유튜브 편집 스타일 분석가입니다. 참고 영상 정보를 보고 "이 영상처럼 편집"하기 위한 스타일 프로필을 JSON 으로만 답합니다. segmentPattern 은 섹션별 길이 비율(합 1)입니다.',
      prompt: `제목: ${reference.title}\n채널: ${reference.channel}\n길이: ${dur}초 · ${reference.isShorts ? '쇼츠/세로' : '롱폼'}\n챕터: ${(reference.chapters || []).map((c) => `[${c.start}s] ${c.title}`).join(' / ') || '없음'}\n태그: ${(reference.tags || []).slice(0, 15).join(', ') || '없음'}\n설명: ${String(reference.description || '').slice(0, 600)}\n\n형식: {"pacing":"slow|normal|fast","avgShotSec":초,"cutsPerMinute":수,"hookDurationSec":초,"hookType":"question|number|quote|reaction|scene","subtitleStyle":"${TEMPLATES.map((t) => t.id).join('|')}","subtitlePosition":"top|center|bottom","captionsPerMinute":수,"structure":["섹션명"],"segmentPattern":[비율],"cardStyle":"none|chapter-cards|title-only","tone":"","sfxDensity":"low|medium|high","bgm":"","transitions":"hard-cut|crossfade|zoom|whip","colorGrade":"clean-bright|cinematic|warm|none","ratio":"16:9|9:16|1:1","zoomStyle":"","textOverlays":""}`,
      json: true, maxTokens: 3000, fallback,
    });
    const base = fallback();
    const profile = res && typeof res === 'object' && !Array.isArray(res) ? { ...base, ...res } : base;
    if (!TEMPLATES.some((t) => t.id === profile.subtitleStyle)) profile.subtitleStyle = base.subtitleStyle;
    if (!Array.isArray(profile.structure) || !profile.structure.length) profile.structure = base.structure;
    if (!Array.isArray(profile.segmentPattern) || profile.segmentPattern.length !== profile.structure.length || profile.segmentPattern.some((x) => !(Number(x) > 0))) profile.segmentPattern = profile.structure.map(() => 1 / profile.structure.length);
    const sum = profile.segmentPattern.reduce((a, b) => a + Number(b), 0);
    profile.segmentPattern = profile.segmentPattern.map((x) => round(Number(x) / sum));
    if (!['16:9', '9:16', '1:1'].includes(profile.ratio)) profile.ratio = base.ratio;
    return { ...profile, reference: { url: reference.url, platform: reference.platform, title: reference.title, channel: reference.channel, durationSec: reference.durationSec, isShorts: reference.isShorts, chapters: reference.chapters }, engine: this.ai.lastMode, mirrored: ['structure', 'segmentPattern', 'hookDurationSec', 'pacing', 'subtitleStyle', 'subtitlePosition', 'sfxDensity', 'transitions', 'colorGrade', 'ratio', 'bgm', 'tone'] };
  }

  planCleaning(source, opts) {
    const steps = [];
    if (opts.removeBurnedSubtitles) steps.push({ id: 'burned-subtitles', method: which('ffmpeg') ? 'crop+delogo' : 'plan', region: { x: 0, y: 0.78, w: 1, h: 0.18 }, note: '하단 자막 영역을 감지해 크롭/인페인팅으로 제거' });
    if (opts.removeSfx || opts.removeBgm) steps.push({ id: 'audio-separation', method: which('demucs') ? 'demucs' : 'plan', keep: opts.keepOriginalVoice ? ['vocals'] : [], drop: [opts.removeSfx && 'other', opts.removeBgm && 'drums', opts.removeBgm && 'bass'].filter(Boolean), note: '음원 분리 후 목소리만 남기고 효과음·배경음 트랙 제외' });
    steps.push({ id: 'normalize', method: 'loudnorm', targetLUFS: -14 });
    return { steps, engine: steps.some((s) => s.method !== 'plan') ? 'ffmpeg' : 'plan' };
  }

  // 구조 재배열 + 길이 맞추기: 원본이 길면 목표 길이만큼 구간을 골라 줄이고, 원본이 짧으면(쇼츠 등) 목표 길이까지 늘린다.
  async planStructure({ segments, source, opts, genre, styleProfile }) {
    const targetSec = Number(opts.targetMinutes) * 60;
    const pacing = opts.pacing === 'auto' ? (styleProfile?.pacing || 'normal') : opts.pacing;
    const heuristic = () => {
      const KEY = /핵심|비밀|놀라|반전|절반|실수|중요|결과|꼭|처음|마지막|사실|진짜|충격|방법|이유/;
      const scored = segments.map((s, i) => ({ s, i, score: 50 + (KEY.test(s.text) ? 30 : 0) + Math.min(15, s.text.length / 4) + (i < 3 ? 10 : 0) + (i > segments.length - 4 ? 8 : 0) }));
      if (source.durationSec <= targetSec) return { keep: [{ start: 0, end: source.durationSec, reason: '원본 길이가 목표 이하 - 전체 유지 후 확장' }], hook: segments[0]?.text || source.title };
      const sorted = [...scored].sort((a, b) => b.score - a.score);
      const keep = []; let total = 0;
      for (const c of sorted) { const len = c.s.end - c.s.start; if (total + len > targetSec) continue; keep.push({ start: c.s.start, end: c.s.end, reason: `점수 ${Math.round(c.score)}`, i: c.i }); total += len; if (total >= targetSec * 0.97) break; }
      keep.sort((a, b) => a.i - b.i);
      const hook = sorted[0]?.s.text || source.title;
      return { keep: keep.map(({ i, ...k }) => k), hook };
    };
    const transcript = segments.map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`).join('\n');
    const res = await this.ai.complete({
      system: '유튜브 영상 재구성 편집자입니다. 원본 대본에서 목표 길이에 맞게 남길 구간을 고르고 후킹→본문→마무리 구조로 재배열한 계획을 JSON 으로만 답합니다. 원본이 목표보다 짧으면 전체를 남기세요.',
      prompt: `제목: ${source.title}\n장르: ${genre}\n목표 길이: ${targetSec}초 (원본 ${source.durationSec}초)\n호흡: ${pacing}${styleProfile ? `\n참고 스타일: ${JSON.stringify({ structure: styleProfile.structure, tone: styleProfile.tone, hookType: styleProfile.hookType })}` : ''}\n\n대본:\n${transcript}\n\n형식: {"hook":"첫 10초 후킹 멘트","keep":[{"start":초,"end":초,"reason":"선정 이유"}],"outline":["섹션 제목"],"title":"새 제목","description":"설명 2문장"}`,
      json: true, maxTokens: 12000, fallback: heuristic,
    });
    const base = res && Array.isArray(res.keep) && res.keep.length ? res : heuristic();
    let keep = base.keep.map((k) => ({ start: clamp(Number(k.start) || 0, 0, source.durationSec), end: clamp(Number(k.end) || 0, 0, source.durationSec), reason: k.reason || '' })).filter((k) => k.end - k.start >= 1).sort((a, b) => a.start - b.start);
    keep = mergeAdjacent(keep);
    if (!keep.length) keep = [{ start: 0, end: source.durationSec, reason: '전체 유지' }];
    const speedFactor = pacing === 'fast' ? 1.08 : pacing === 'slow' ? 0.97 : 1;
    // 1) 원본이 길면: 목표 초과분은 뒤에서부터 잘라내고, 부족하면 원본 순서대로 채운다
    let total = keep.reduce((s, k) => s + (k.end - k.start), 0);
    while (total / speedFactor > targetSec * 1.05 && keep.length > 1) { const last = keep.pop(); total -= last.end - last.start; }
    if (total / speedFactor > targetSec * 1.05 && keep.length === 1) { keep[0].end = keep[0].start + targetSec * speedFactor; total = keep[0].end - keep[0].start; }
    if (total < Math.min(targetSec, source.durationSec) * 0.9) {
      for (const sg of segments) { if (total >= targetSec * 0.97) break; if (keep.some((k) => sg.start < k.end && sg.end > k.start)) continue; keep.push({ start: sg.start, end: sg.end, reason: '길이 보충' }); total += sg.end - sg.start; }
      keep.sort((a, b) => a.start - b.start); keep = mergeAdjacent(keep); total = keep.reduce((s, k) => s + (k.end - k.start), 0);
    }
    const outline = styleProfile?.structure?.length ? styleProfile.structure : (base.outline?.length ? base.outline : ['후킹', '본문', '마무리']);
    // 2) 타임라인 구성: 원본이 짧으면(쇼츠 등) 카드·리플레이·슬로모션·요약으로 목표 길이까지 확장
    const timeline = composeTimeline({ keep, segments, targetSec, speedFactor, outline, hook: String(base.hook || source.title), source, styleProfile });
    const finalDurationSec = round(timeline.reduce((s, t) => s + (t.newEnd - t.newStart), 0));
    const sourceUsedSec = round(keep.reduce((s, k) => s + (k.end - k.start), 0));
    return { hook: String(base.hook || source.title).slice(0, 120), keep, timeline, outline, title: String(base.title || `${source.title} (재구성)`).slice(0, 100), description: String(base.description || '').slice(0, 500), pacing, speedFactor, finalDurationSec, targetSec, sourceUsedSec, extended: finalDurationSec > sourceUsedSec + 1, stretchFactor: round(finalDurationSec / Math.max(1, source.durationSec)), reorder: opts.reorder, engine: this.ai.lastMode };
  }

  // 새 자막·효과음·배경음·전환·내레이션
  async rebuild({ job, plan, segments, genre, styleProfile }) {
    const opts = job.options;
    const template = opts.template === 'auto' ? (TEMPLATES.find((t) => t.id === styleProfile?.subtitleStyle) || templateFor(genre)) : (TEMPLATES.find((t) => t.id === opts.template) || templateFor(genre));
    const ratio = opts.ratio === 'auto' ? (styleProfile?.ratio || (job.source.isShorts || (job.source.height > job.source.width) ? '9:16' : '16:9')) : opts.ratio;
    const timeline = plan.timeline;
    const mapT = (t, x) => round((x - t.start) / (t.speed || 1) + t.newStart);

    let subtitles = [];
    if (opts.newSubtitles) {
      for (const t of timeline) {
        if (t.kind === 'card') { subtitles.push({ start: t.newStart, end: t.newEnd, text: t.title, words: [], animation: 'pop', card: true }); continue; }
        if (!['source', 'replay', 'slowmo'].includes(t.kind)) continue;
        const segs = segments.filter((s) => s.end > t.start && s.start < t.end).map((s) => ({ ...s, start: Math.max(s.start, t.start), end: Math.min(s.end, t.end) }));
        for (const s of semanticSplit(segs)) subtitles.push({ ...s, start: mapT(t, s.start), end: mapT(t, s.end), words: s.words.map((w) => ({ ...w, start: mapT(t, w.start), end: mapT(t, w.end) })), animation: t.kind === 'source' ? template.animation : 'karaoke' });
      }
      subtitles = subtitles.sort((a, b) => a.start - b.start).map((s, i) => ({ ...s, id: `seg-${i + 1}` }));
    }

    const sfx = [];
    if (opts.newSfx) {
      const density = styleProfile?.sfxDensity || (plan.pacing === 'fast' ? 'high' : 'medium');
      const every = density === 'high' ? 1 : density === 'medium' ? 2 : 4;
      timeline.forEach((t, i) => { if (i % every === 0) sfx.push({ at: t.newStart, name: SFX_LIBRARY[i % SFX_LIBRARY.length], reason: '구간 전환' }); });
      subtitles.forEach((s, i) => { if (/[!?]$/.test(s.text) && i % 3 === 0) sfx.push({ at: s.start, name: /\?$/.test(s.text) ? 'ding' : 'boom', reason: '강조 문장' }); });
      sfx.sort((a, b) => a.at - b.at);
    }
    const bgm = opts.newBgm ? { track: styleProfile?.bgm || BGM_LIBRARY[genre] || 'upbeat-corporate', volumeDb: -18, duckUnderVoice: true, fadeInSec: 1.5, fadeOutSec: 2 } : null;
    const zoom = styleProfile?.zoomStyle ? timeline.filter((t) => t.kind === 'source').map((t) => ({ at: t.newStart, style: styleProfile.zoomStyle, scale: styleProfile.zoomStyle === 'punch-in' ? 1.2 : 1.08 })) : [];
    const transitions = timeline.slice(1).map((t) => ({ at: t.newStart, type: opts.transitions === 'auto' ? (styleProfile?.transitions || (plan.pacing === 'fast' ? 'hard-cut' : 'crossfade')) : opts.transitions, durationSec: 0.3 }));
    const colorGrade = opts.colorGrade === 'auto' ? (styleProfile?.colorGrade || 'clean-bright') : opts.colorGrade;

    let narration = null;
    if (opts.narration !== 'none') {
      const lines = await this.writeNarration({ plan, subtitles, mode: opts.narration, tone: styleProfile?.tone || 'friendly' });
      const renders = [];
      for (const [i, line] of lines.entries()) {
        const r = await this.voice.synthesize(job.userId, { profileId: opts.voiceProfileId, text: line.text, style: i === 0 ? 'hook' : 'natural', outputName: `remix-${job.id.slice(0, 8)}-${i + 1}` });
        renders.push({ at: line.at, text: line.text, audioPath: r.audioPath, engine: r.engine, durationSec: r.durationSec });
      }
      narration = { mode: opts.narration, voiceProfileId: opts.voiceProfileId, lines: renders, replacesOriginalVoice: opts.narration === 'full' && !opts.keepOriginalVoice };
    }

    return { timeline, template: { id: template.id, name: template.name, font: template.font, position: styleProfile?.subtitlePosition || 'bottom' }, subtitles, sfx, bgm, zoom, transitions, colorGrade, narration, ratio, extended: plan.extended, stretchFactor: plan.stretchFactor, mirroredFromReference: styleProfile ? styleProfile.mirrored : [] };
  }

  async writeNarration({ plan, subtitles, mode, tone }) {
    const fallback = () => {
      const lines = [{ at: 0, text: plan.hook }];
      if (mode === 'full') for (const [i, o] of plan.outline.entries()) { const anchor = subtitles[Math.floor((subtitles.length / Math.max(1, plan.outline.length)) * i)]; lines.push({ at: anchor ? anchor.start : i * 30, text: `${o}. ${anchor ? anchor.text : ''}`.trim() }); }
      lines.push({ at: Math.max(0, plan.finalDurationSec - 8), text: '끝까지 봐주셔서 감사합니다. 다음 영상도 기대해주세요!' });
      return lines;
    };
    const res = await this.ai.complete({
      system: `영상 내레이션 작가입니다. ${tone} 톤으로 ${mode === 'intro' ? '오프닝 후킹 1줄과 마무리 1줄' : '오프닝·각 섹션 소개·마무리 내레이션'}을 JSON 배열 [{"at":초,"text":"..."}] 로만 답합니다.`,
      prompt: `후킹: ${plan.hook}\n아웃라인: ${plan.outline.join(' / ')}\n총 길이: ${plan.finalDurationSec}초\n자막 요약: ${subtitles.slice(0, 40).map((s) => `[${s.start}] ${s.text}`).join('\n')}`,
      json: true, maxTokens: 4000, fallback,
    });
    const lines = Array.isArray(res) && res.length ? res.map((l) => ({ at: Math.max(0, Number(l.at) || 0), text: String(l.text || '').slice(0, 400) })).filter((l) => l.text) : fallback();
    return lines.sort((a, b) => a.at - b.at);
  }

  // ffmpeg 이 있고 로컬 파일이면 실제 렌더링(타임라인 항목을 trim/배속/카드로 이어붙이고 자막 입힘), 아니면 렌더 계획을 남긴다
  async render({ job, plan, rebuild, cleaning }) {
    const dims = rebuild.ratio === '9:16' ? [1080, 1920] : rebuild.ratio === '1:1' ? [1080, 1080] : [1920, 1080];
    const [w, h] = dims;
    const ass = toASS(rebuild.subtitles.filter((s) => !s.card), { font: rebuild.template.font, size: 56, playResX: w, playResY: h });
    const dir = path.join(this.outputDir, job.userId, 'remix');
    const out = path.join(dir, `${job.id}.mp4`);
    const assPath = path.join(dir, `${job.id}.ass`);
    const crop = cleaning.steps.find((s) => s.id === 'burned-subtitles') ? 'crop=iw:ih*0.78:0:0,' : '';
    const fit = `${crop}scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1`;
    const parts = []; const labels = [];
    rebuild.timeline.forEach((t, i) => {
      const dur = round(t.newEnd - t.newStart);
      if (t.kind === 'card') {
        const text = String(t.title || '').replace(/[\\':]/g, ' ');
        parts.push(`color=c=0x14161c:s=${w}x${h}:d=${dur}:r=30,drawtext=text='${text}':fontcolor=white:fontsize=${Math.round(h / 14)}:x=(w-text_w)/2:y=(h-text_h)/2[v${i}]`, `anullsrc=r=48000:cl=stereo,atrim=0:${dur},asetpts=PTS-STARTPTS[a${i}]`);
      } else {
        const speed = t.speed || 1;
        parts.push(`[0:v]trim=${t.start}:${t.end},setpts=(PTS-STARTPTS)/${speed},${fit}[v${i}]`, `[0:a]atrim=${t.start}:${t.end},asetpts=PTS-STARTPTS,atempo=${Math.min(2, Math.max(0.5, speed))}[a${i}]`);
      }
      labels.push(`[v${i}][a${i}]`);
    });
    const n = rebuild.timeline.length;
    const filter = `${parts.join(';')};${labels.join('')}concat=n=${n}:v=1:a=1[vc][ac];[vc]subtitles='${assPath.replace(/'/g, "\\'")}'[vo];[ac]loudnorm=I=-14[ao]`;
    const args = ['-y', '-i', job.source.path || 'INPUT.mp4', '-filter_complex', filter, '-map', '[vo]', '-map', '[ao]', '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', out];
    if (job.source.path && which('ffmpeg')) {
      try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(assPath, ass); await run('ffmpeg', args); return { rendered: true, output: out, subtitleFile: assPath, args }; }
      catch (err) { return { rendered: false, error: err.message, plan: { bin: 'ffmpeg', args }, subtitleASS: ass }; }
    }
    return { rendered: false, plan: { bin: 'ffmpeg', args, items: n, note: job.source.path ? 'ffmpeg 을 설치하면 실제 MP4 가 렌더링됩니다.' : '링크 원본은 yt-dlp 로 내려받은 뒤 ffmpeg 으로 렌더링됩니다.' }, subtitleASS: ass };
  }

  // ---- 조회/편집/삭제 ----
  list(userId) { return this.store.find('remixJobs', (j) => j.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  get(userId, id) { const j = this.store.get('remixJobs', id); if (!j || j.userId !== userId) throw new ApiError(404, '재구성 작업을 찾을 수 없습니다.'); return j; }
  remove(userId, id) { this.get(userId, id); this.library?.removeByRef('remix', id); return this.store.remove('remixJobs', id); }

  updateResult(userId, id, patch) {
    const j = this.get(userId, id);
    if (j.status !== 'done') throw new ApiError(409, '완료된 작업만 수정할 수 있습니다.');
    const result = { ...j.result };
    if (patch.title != null) result.plan = { ...result.plan, title: String(patch.title).slice(0, 100) };
    if (patch.subtitles) result.subtitles = patch.subtitles.map((s, i) => ({ id: s.id || `seg-${i + 1}`, start: Number(s.start), end: Number(s.end), text: String(s.text), words: s.words || [], animation: s.animation || 'none' }));
    if (patch.sfx) result.sfx = patch.sfx.map((s) => ({ at: Number(s.at), name: String(s.name), reason: s.reason || '수동' }));
    if (patch.bgm !== undefined) result.bgm = patch.bgm ? { ...(result.bgm || {}), ...patch.bgm } : null;
    const updated = this.store.update('remixJobs', id, { result });
    if (this.library) this.library.addRemixJob(updated);
    return updated;
  }

  async regenerate(userId, id) {
    const j = this.get(userId, id);
    if (j.status !== 'done' && j.status !== 'failed') throw new ApiError(409, '진행 중인 작업은 다시 만들 수 없습니다.');
    const half = Math.round((j.minutesCharged / 2) * 100) / 100;
    this.credits.charge(userId, half, `AI 재구성 다시 만들기(50%): ${j.source.title}`, { jobId: id });
    this.library?.removeByRef('remix', id);
    this.store.update('remixJobs', id, { status: 'queued', step: 'queued', progress: 0, result: null, error: null, log: [{ at: new Date().toISOString(), step: 'queued', message: '다시 만들기 (이용권 50% 차감)' }] });
    const t = setTimeout(() => this._run(id).catch((err) => this._fail(id, err)), 10);
    if (t.unref) t.unref();
    return this.store.get('remixJobs', id);
  }
}

function clamp(n, a, b) { return Math.min(b, Math.max(a, n)); }

// 유지 구간(keep)을 새 타임라인으로 배치하고, 목표 길이에 못 미치면 카드·리플레이·슬로모션으로 확장한다.
// 참고 영상 프로필(styleProfile)이 있으면 그 영상의 섹션 구조·구간 길이 비율·후킹 길이·카드 스타일을 그대로 따라 배치한다.
// 항목 kind: source(원본 구간) | replay(하이라이트 다시 보기) | slowmo(슬로모션 리플레이) | card(챕터/타이틀 카드)
export function composeTimeline({ keep, segments, targetSec, speedFactor = 1, outline = [], hook = '', source, styleProfile = null }) {
  const items = []; let cursor = 0;
  const push = (item) => { const dur = item.kind === 'card' ? item.dur : (item.end - item.start) / (item.speed || 1); items.push({ ...item, newStart: round(cursor), newEnd: round(cursor + dur) }); cursor += dur; };
  const total = () => cursor;
  const cards = !styleProfile || styleProfile.cardStyle !== 'none';
  if (styleProfile && Array.isArray(styleProfile.segmentPattern) && styleProfile.segmentPattern.length && keep.length) {
    // 참고 영상 구조를 따라 배치: 각 섹션에 목표 길이 × 비율만큼 원본 구간을 순서대로 배정하고 섹션마다 챕터 카드
    const sections = styleProfile.structure.map((title, i) => ({ title, budget: targetSec * styleProfile.segmentPattern[i] }));
    const hookLen = Math.min(styleProfile.hookDurationSec || 5, sections[0].budget);
    const pool = keep.map((k) => ({ ...k })); let si = 0; let used = 0;
    if (cards) push({ kind: 'card', title: hook || source.title, dur: Math.min(3, hookLen) });
    // 후킹: 가장 점수 높은 문장 구간을 참고 영상의 후킹 길이만큼 앞에 배치
    const KEYH = /핵심|비밀|놀라|반전|중요|결과|진짜|충격|방법|이유|\?|!/;
    const hookSeg = segments.find((sg) => KEYH.test(sg.text)) || segments[0];
    if (hookSeg) push({ kind: 'source', start: hookSeg.start, end: Math.min(hookSeg.end, hookSeg.start + hookLen), speed: 1, reason: `후킹 (참고 영상 후킹 ${hookLen}초)` });
    for (const k of pool) {
      while (si < sections.length && used >= sections[si].budget) { si += 1; used = 0; if (si < sections.length && cards) push({ kind: 'card', title: sections[si].title, dur: 2.5 }); }
      if (si >= sections.length) si = sections.length - 1;
      push({ kind: 'source', start: k.start, end: k.end, speed: speedFactor, reason: `${sections[si].title} (참고 구조)` , section: sections[si].title });
      used += (k.end - k.start) / speedFactor;
    }
  } else {
    keep.forEach((k, i) => { if (i === 0 && cards) push({ kind: 'card', title: hook || source.title, dur: 3 }); push({ kind: 'source', start: k.start, end: k.end, speed: speedFactor, reason: k.reason }); });
  }
  if (total() >= targetSec * 0.95) { if (cards) push({ kind: 'card', title: '끝까지 봐주셔서 감사합니다', dur: 3 }); return items; }
  // 확장 1: 하이라이트 문장 리플레이 (키워드 문장 우선)
  const KEY = /핵심|비밀|놀라|반전|중요|결과|진짜|충격|방법|이유|\?|!/;
  const highlights = segments.filter((s) => s.end - s.start >= 1.5).sort((a, b) => (KEY.test(b.text) ? 1 : 0) - (KEY.test(a.text) ? 1 : 0) || b.text.length - a.text.length);
  const chapters = outline.length ? outline : ['핵심 정리'];
  let round_ = 0;
  while (total() < targetSec * 0.97 && round_ < 400) {
    const ch = chapters[round_ % chapters.length];
    const hl = highlights[round_ % Math.max(1, highlights.length)];
    if (!hl) { push({ kind: 'card', title: ch, dur: Math.min(5, targetSec - total()) }); round_ += 1; continue; }
    if (cards) push({ kind: 'card', title: `${ch} ${Math.floor(round_ / chapters.length) + 1}`, dur: 3 });
    if (total() >= targetSec) break;
    push({ kind: 'replay', start: hl.start, end: hl.end, speed: 1, reason: '하이라이트 다시 보기' });
    if (total() >= targetSec) break;
    if (round_ % 2 === 0) push({ kind: 'slowmo', start: hl.start, end: hl.end, speed: 0.5, reason: '슬로모션 리플레이' });
    round_ += 1;
  }
  // 초과분 정리: 마지막 항목을 목표에 맞춰 자른다
  const last = items[items.length - 1];
  if (last && cursor > targetSec) { const over = cursor - targetSec; if (last.kind === 'card') last.dur = Math.max(1, last.dur - over); else last.end = Math.max(last.start + 1, last.end - over * (last.speed || 1)); last.newEnd = round(Math.max(last.newStart + 1, last.newEnd - over)); }
  if (cards) push({ kind: 'card', title: '끝까지 봐주셔서 감사합니다', dur: 3 });
  return items;
}
function round(n) { return Math.round(n * 100) / 100; }
function mergeAdjacent(keep) {
  const out = [];
  for (const k of keep) { const last = out[out.length - 1]; if (last && k.start - last.end < 0.5) { last.end = Math.max(last.end, k.end); } else out.push({ ...k }); }
  return out;
}
