// 픽셀링 자막 편집기: 음성 인식 → 의미 기반 분할 → 파형 기반 편집 → 다국어 번역 → SRT/VTT/ASS 내보내기
import path from 'node:path';
import { ApiError } from '../errors.js';
import { parseVideoUrl, fetchYoutubeMeta, probe, validateVideoMeta, ensureLocalFile } from '../media.js';
import { transcribe, semanticSplit, waveform, splitWords } from './stt.js';
import { exportSubtitles, parseSRT, parseVTT } from './format.js';
import { FONTS, SUBTITLE_STYLE_PRESETS } from './fonts.js';

export const MAX_HISTORY = 50; // 실행 취소 단계 (되돌리기/다시 실행)
export const PREMIUM_NOTICE = '프리미엄 일괄 생성 중에는 MP4 원본 영상을 삭제하거나 경로/이름을 바꾸지 말아주세요. USB 영상은 연결을 유지하거나 컴퓨터에 옮겨주세요. 감사합니다!';

export class SubtitleProjects {
  constructor({ store, credits, ai, translate, notifications, activity = null }) {
    this.store = store; this.credits = credits; this.ai = ai; this.translate = translate; this.notifications = notifications; this.activity = activity;
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
    const startedAt = new Date().toISOString();
    let stt;
    try { stt = await transcribe({ filePath: source.path, durationSec: source.durationSec, language, title: source.title, source, transcript: extra.transcript || null, transcriptText: extra.transcriptText || '' }); }
    catch (err) { this.store.remove('subtitleProjects', project.id); if (premium) this.credits.grant(userId, Math.round((source.durationSec / 60) * 100) / 100, '자막 생성 실패 환불', { projectId: project.id }); this.activity?.log(userId, { kind: 'subtitle', title: source.title, input: { url: source.url || null, uploadId: source.uploadId || null, language, premium, transcriptText: extra.transcriptText || '' }, error: err, startedAt }); throw err; }
    const segments = semanticSplit(stt.segments);
    const wf = await waveform({ filePath: source.path, durationSec: source.durationSec, segments });
    const done = this.store.update('subtitleProjects', project.id, { status: 'ready', segments, engine: stt.engine, transcriptExact: stt.exact !== false, waveform: wf });
    this.notifications?.push(userId, { type: 'subtitle.ready', title: '자막 생성 완료', body: `"${source.title}" 자막 ${segments.length}줄이 준비됐어요.`, link: `#/subtitles/${project.id}` });
    this.activity?.log(userId, { kind: 'subtitle', refId: project.id, title: source.title, input: { url: source.url || null, uploadId: source.uploadId || null, language, premium, transcriptText: extra.transcriptText || '' }, result: { segments: segments.length, engine: stt.engine, link: `#/subtitles/${project.id}` }, startedAt });
    return done;
  }

  list(userId) { return this.store.find('subtitleProjects', (p) => p.userId === userId && !p.deletedAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }

  get(userId, id) {
    const p = this.store.get('subtitleProjects', id);
    if (!p || p.userId !== userId) throw new ApiError(404, '프로젝트를 찾을 수 없습니다.');
    return p;
  }

  _snapshot(p) { return { at: new Date().toISOString(), segments: p.segments }; }
  _hist(p) { return [...(p.history || []).slice(-(MAX_HISTORY - 1)), this._snapshot(p)]; }

  updateSegments(userId, id, segments) {
    const p = this.get(userId, id);
    if (!Array.isArray(segments)) throw new ApiError(400, '자막 배열이 필요합니다.');
    const cleaned = segments.map((s, i) => {
      const start = Number(s.start); const end = Number(s.end);
      if (!(end > start)) throw new ApiError(400, `${i + 1}번째 자막의 시간이 올바르지 않습니다.`);
      const text = String(s.text ?? '').trim();
      return { id: s.id || `seg-${i + 1}`, start, end, text, words: s.words?.length ? s.words : splitWords(text, start, end), speaker: s.speaker || 'A' };
    }).sort((a, b) => a.start - b.start);
    return this.store.update('subtitleProjects', id, { segments: cleaned, history: this._hist(p), future: [] });
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
    return this.store.update('subtitleProjects', id, { segments, history: this._hist(p), future: [] });
  }

  mergeSegments(userId, id, segmentIds) {
    const p = this.get(userId, id);
    const targets = p.segments.filter((s) => segmentIds.includes(s.id));
    if (targets.length < 2) throw new ApiError(400, '두 개 이상의 자막을 선택해주세요.');
    const merged = { id: targets[0].id, start: Math.min(...targets.map((s) => s.start)), end: Math.max(...targets.map((s) => s.end)), text: targets.map((s) => s.text).join(' '), words: targets.flatMap((s) => s.words), speaker: targets[0].speaker };
    const segments = p.segments.filter((s) => !segmentIds.includes(s.id)).concat(merged).sort((a, b) => a.start - b.start);
    return this.store.update('subtitleProjects', id, { segments, history: this._hist(p), future: [] });
  }

  resplit(userId, id, opts = {}) {
    const p = this.get(userId, id);
    return this.store.update('subtitleProjects', id, { segments: semanticSplit(p.segments, opts), history: this._hist(p), future: [] });
  }

  undo(userId, id) {
    const p = this.get(userId, id);
    const last = p.history[p.history.length - 1];
    if (!last) throw new ApiError(409, '되돌릴 변경이 없습니다.');
    return this.store.update('subtitleProjects', id, { segments: last.segments, history: p.history.slice(0, -1), future: [this._snapshot(p), ...(p.future || [])].slice(0, MAX_HISTORY) });
  }
  redo(userId, id) {
    const p = this.get(userId, id);
    const next = (p.future || [])[0];
    if (!next) throw new ApiError(409, '다시 실행할 변경이 없습니다.');
    return this.store.update('subtitleProjects', id, { segments: next.segments, history: [...(p.history || []).slice(-(MAX_HISTORY - 1)), this._snapshot(p)], future: (p.future || []).slice(1) });
  }
  historyInfo(userId, id) { const p = this.get(userId, id); return { undo: (p.history || []).length, redo: (p.future || []).length, max: MAX_HISTORY, recent: (p.history || []).slice(-10).reverse().map((h) => ({ at: h.at, segments: h.segments.length })) }; }

  // 자막 검색 / 특정 문장 찾기
  search(userId, id, q, { language = null } = {}) {
    const p = this.get(userId, id);
    const segs = language && p.translations[language] ? p.translations[language].segments : p.segments;
    const n = String(q || '').toLowerCase(); if (!n) return [];
    return segs.map((s, i) => ({ index: i, ...s })).filter((s) => String(s.text).toLowerCase().includes(n)).map((s) => ({ index: s.index, id: s.id, start: s.start, end: s.end, text: s.text }));
  }
  // 일괄 수정: 찾아 바꾸기 (정규식 선택), 대상 전체 또는 선택 자막
  findReplace(userId, id, { find, replace = '', regex = false, caseSensitive = false, segmentIds = null }) {
    const p = this.get(userId, id);
    if (!find) throw new ApiError(400, '찾을 문자열을 입력해주세요.');
    let re;
    try { re = regex ? new RegExp(find, caseSensitive ? 'g' : 'gi') : new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'g' : 'gi'); } catch { throw new ApiError(400, '정규식이 올바르지 않습니다.'); }
    let changed = 0;
    const segments = p.segments.map((s) => { if (segmentIds && !segmentIds.includes(s.id)) return s; const text = String(s.text).replace(re, String(replace)); if (text === s.text) return s; changed += 1; return { ...s, text, words: splitWords(text, s.start, s.end) }; });
    if (!changed) return { changed: 0, project: p };
    return { changed, project: this.store.update('subtitleProjects', id, { segments, history: this._hist(p), future: [] }) };
  }
  // 자막 시간 이동: 전체 또는 선택 자막을 초 단위로 앞뒤 이동 (음수 가능), 배율 조정(속도 보정)
  shiftTime(userId, id, { offsetSec = 0, scale = 1, segmentIds = null, fromSec = null }) {
    const p = this.get(userId, id);
    const off = Number(offsetSec) || 0; const sc = Number(scale) || 1;
    if (Math.abs(off) > 3600 || sc <= 0 || sc > 10) throw new ApiError(400, '이동 값이 올바르지 않습니다.');
    const D = p.source.durationSec || Infinity;
    const segments = p.segments.map((s) => {
      if (segmentIds && !segmentIds.includes(s.id)) return s;
      if (fromSec != null && s.start < Number(fromSec)) return s;
      const start = Math.max(0, Math.min(D, s.start * sc + off)); const end = Math.max(start + 0.3, Math.min(D, s.end * sc + off));
      return { ...s, start: round2(start), end: round2(end), words: (s.words || []).map((w) => ({ ...w, start: round2(Math.max(0, w.start * sc + off)), end: round2(Math.max(0, w.end * sc + off)) })) };
    }).sort((a, b) => a.start - b.start);
    return this.store.update('subtitleProjects', id, { segments, history: this._hist(p), future: [] });
  }
  importVtt(userId, id, vttText) {
    const p = this.get(userId, id);
    const segs = parseVTT(vttText);
    if (!segs.length) throw new ApiError(400, 'VTT 내용을 읽을 수 없습니다.');
    return this.updateSegments(userId, id, segs.map((s) => ({ ...s, speaker: 'A' })).concat(p.segments.filter(() => false)));
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

function round2(n) { return Math.round(n * 100) / 100; }
function sanitize(s) { return String(s || 'subtitles').replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 60); }
