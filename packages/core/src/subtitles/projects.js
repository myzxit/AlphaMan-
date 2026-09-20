// 픽셀링 자막 편집기: 음성 인식 → 의미 기반 분할 → 파형 기반 편집 → 다국어 번역 → SRT/VTT/ASS 내보내기
import path from 'node:path';
import { ApiError } from '../errors.js';
import { parseVideoUrl, fetchYoutubeMeta, probe, validateVideoMeta, ensureLocalFile } from '../media.js';
import { transcribe, semanticSplit, waveform, splitWords } from './stt.js';
import { exportSubtitles, parseSRT } from './format.js';
import { FONTS, SUBTITLE_STYLE_PRESETS } from './fonts.js';

export const PREMIUM_NOTICE = '프리미엄 일괄 생성 중에는 MP4 원본 영상을 삭제하거나 경로/이름을 바꾸지 말아주세요. USB 영상은 연결을 유지하거나 컴퓨터에 옮겨주세요. 감사합니다!';

export class SubtitleProjects {
  constructor({ store, credits, ai, translate, notifications }) {
    this.store = store; this.credits = credits; this.ai = ai; this.translate = translate; this.notifications = notifications;
  }

  fonts() { return FONTS; }
  presets() { return SUBTITLE_STYLE_PRESETS; }

  async createFromUrl(userId, { url, language = 'ko', premium = false, transcript = null, transcriptText = '' }) {
    const parsed = parseVideoUrl(url);
    let meta = { title: `${parsed.platform} 영상`, durationSec: 60, thumbnail: null };
    if (parsed.platform === 'youtube') meta = await fetchYoutubeMeta(parsed.id);
    return this._create(userId, { source: { type: 'url', ...parsed, videoId: parsed.id, title: meta.title, durationSec: meta.durationSec || 60, thumbnail: meta.thumbnail }, language, premium, notice: parsed.notice || null, extra: { transcript, transcriptText } });
  }

  async createFromUpload(userId, { uploadId, language = 'ko', premium = false, transcript = null, transcriptText = '' }) {
    const up = this.store.get('uploads', uploadId);
    if (!up || up.userId !== userId) throw new ApiError(404, '업로드된 파일을 찾을 수 없습니다.');
    await ensureLocalFile(up);
    const meta = await probe(up.path);
    validateVideoMeta({ filename: up.filename, mimeType: up.mimeType, ...meta });
    return this._create(userId, { source: { type: 'file', uploadId, path: up.path, remoteUrl: up.remoteUrl || null, title: path.parse(up.filename).name, durationSec: meta.durationSec, width: meta.width, height: meta.height }, language, premium, extra: { transcript, transcriptText } });
  }

  // 로컬 경로(프로그램 버전: 컴퓨터/USB의 MP4 를 직접 지정)
  async createFromLocalPath(userId, { filePath, language = 'ko', premium = false, transcript = null, transcriptText = '' }) {
    const meta = await probe(filePath);
    validateVideoMeta({ filename: path.basename(filePath), ...meta });
    return this._create(userId, { source: { type: 'local', path: filePath, title: path.parse(filePath).name, durationSec: meta.durationSec, removable: /^(\/media|\/mnt|\/Volumes|[D-Z]:\\)/i.test(filePath) }, language, premium, extra: { transcript, transcriptText } });
  }

  async _create(userId, { source, language, premium, notice = null, extra = {} }) {
    const project = this.store.insert('subtitleProjects', {
      userId, source, language, premium, status: 'transcribing', notice: notice || (premium ? PREMIUM_NOTICE : null),
      segments: [], translations: {}, style: SUBTITLE_STYLE_PRESETS[0], engine: null, waveform: null, history: [],
    });
    // 기본 기능 무료: STT 는 이용권을 차감하지 않는다. 프리미엄(일괄 생성)만 길이만큼 차감
    if (premium) this.credits.charge(userId, Math.round((source.durationSec / 60) * 100) / 100, `프리미엄 자막 일괄 생성: ${source.title}`, { projectId: project.id });
    let stt;
    try { stt = await transcribe({ filePath: source.path, durationSec: source.durationSec, language, title: source.title, source, transcript: extra.transcript || null, transcriptText: extra.transcriptText || '' }); }
    catch (err) { this.store.remove('subtitleProjects', project.id); if (premium) this.credits.grant(userId, Math.round((source.durationSec / 60) * 100) / 100, '자막 생성 실패 환불', { projectId: project.id }); throw err; }
    const segments = semanticSplit(stt.segments);
    const wf = await waveform({ filePath: source.path, durationSec: source.durationSec, segments });
    const done = this.store.update('subtitleProjects', project.id, { status: 'ready', segments, engine: stt.engine, transcriptExact: stt.exact !== false, waveform: wf });
    this.notifications?.push(userId, { type: 'subtitle.ready', title: '자막 생성 완료', body: `"${source.title}" 자막 ${segments.length}줄이 준비됐어요.`, link: `#/subtitles/${project.id}` });
    return done;
  }

  list(userId) { return this.store.find('subtitleProjects', (p) => p.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }

  get(userId, id) {
    const p = this.store.get('subtitleProjects', id);
    if (!p || p.userId !== userId) throw new ApiError(404, '프로젝트를 찾을 수 없습니다.');
    return p;
  }

  _snapshot(p) { return { at: new Date().toISOString(), segments: p.segments }; }

  updateSegments(userId, id, segments) {
    const p = this.get(userId, id);
    if (!Array.isArray(segments)) throw new ApiError(400, '자막 배열이 필요합니다.');
    const cleaned = segments.map((s, i) => {
      const start = Number(s.start); const end = Number(s.end);
      if (!(end > start)) throw new ApiError(400, `${i + 1}번째 자막의 시간이 올바르지 않습니다.`);
      const text = String(s.text ?? '').trim();
      return { id: s.id || `seg-${i + 1}`, start, end, text, words: s.words?.length ? s.words : splitWords(text, start, end), speaker: s.speaker || 'A' };
    }).sort((a, b) => a.start - b.start);
    return this.store.update('subtitleProjects', id, { segments: cleaned, history: [...p.history.slice(-19), this._snapshot(p)] });
  }

  splitSegment(userId, id, segmentId, atSec) {
    const p = this.get(userId, id);
    const idx = p.segments.findIndex((s) => s.id === segmentId);
    if (idx < 0) throw new ApiError(404, '자막을 찾을 수 없습니다.');
    const seg = p.segments[idx];
    if (!(atSec > seg.start && atSec < seg.end)) throw new ApiError(400, '분할 지점은 자막 시간 안에 있어야 합니다.');
    const left = seg.words.filter((w) => w.end <= atSec); const right = seg.words.filter((w) => w.end > atSec);
    const a = { ...seg, id: `${seg.id}a`, end: atSec, text: left.map((w) => w.word).join(' ') || seg.text.slice(0, Math.ceil(seg.text.length / 2)), words: left };
    const b = { ...seg, id: `${seg.id}b`, start: atSec, text: right.map((w) => w.word).join(' ') || seg.text.slice(Math.ceil(seg.text.length / 2)), words: right };
    const segments = [...p.segments.slice(0, idx), a, b, ...p.segments.slice(idx + 1)];
    return this.store.update('subtitleProjects', id, { segments, history: [...p.history.slice(-19), this._snapshot(p)] });
  }

  mergeSegments(userId, id, segmentIds) {
    const p = this.get(userId, id);
    const targets = p.segments.filter((s) => segmentIds.includes(s.id));
    if (targets.length < 2) throw new ApiError(400, '두 개 이상의 자막을 선택해주세요.');
    const merged = { id: targets[0].id, start: Math.min(...targets.map((s) => s.start)), end: Math.max(...targets.map((s) => s.end)), text: targets.map((s) => s.text).join(' '), words: targets.flatMap((s) => s.words), speaker: targets[0].speaker };
    const segments = p.segments.filter((s) => !segmentIds.includes(s.id)).concat(merged).sort((a, b) => a.start - b.start);
    return this.store.update('subtitleProjects', id, { segments, history: [...p.history.slice(-19), this._snapshot(p)] });
  }

  resplit(userId, id, opts = {}) {
    const p = this.get(userId, id);
    return this.store.update('subtitleProjects', id, { segments: semanticSplit(p.segments, opts), history: [...p.history.slice(-19), this._snapshot(p)] });
  }

  undo(userId, id) {
    const p = this.get(userId, id);
    const last = p.history[p.history.length - 1];
    if (!last) throw new ApiError(409, '되돌릴 변경이 없습니다.');
    return this.store.update('subtitleProjects', id, { segments: last.segments, history: p.history.slice(0, -1) });
  }

  setStyle(userId, id, style) {
    this.get(userId, id);
    const preset = SUBTITLE_STYLE_PRESETS.find((s) => s.id === style.presetId) || {};
    const font = FONTS.find((f) => f.id === (style.font || preset.font)) ? (style.font || preset.font) : 'noto-sans-kr';
    return this.store.update('subtitleProjects', id, { style: { ...SUBTITLE_STYLE_PRESETS[0], ...preset, ...style, font } });
  }

  importSrt(userId, id, srtText) {
    const p = this.get(userId, id);
    const segs = parseSRT(srtText);
    if (!segs.length) throw new ApiError(400, 'SRT 내용을 읽을 수 없습니다.');
    return this.updateSegments(userId, id, segs.map((s) => ({ ...s, speaker: 'A' })).concat(p.segments.filter(() => false)));
  }

  async translateProject(userId, id, target) {
    const p = this.get(userId, id);
    const translated = await this.translate.translateSegments(p.segments, target);
    return this.store.update('subtitleProjects', id, { translations: { ...p.translations, [target]: { segments: translated, engine: this.ai.lastMode, at: new Date().toISOString() } } });
  }

  export(userId, id, { format = 'srt', language = null } = {}) {
    const p = this.get(userId, id);
    const segments = language && p.translations[language] ? p.translations[language].segments : p.segments;
    const font = FONTS.find((f) => f.id === p.style.font);
    const out = exportSubtitles(segments, format, { font: font?.family || 'Noto Sans KR', size: p.style.size });
    return { ...out, filename: `${sanitize(p.source.title)}${language ? `.${language}` : ''}.${out.ext}` };
  }

  remove(userId, id) { this.get(userId, id); return this.store.remove('subtitleProjects', id); }
}

function sanitize(s) { return String(s || 'subtitles').replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 60); }
