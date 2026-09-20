// 보관함: 내가 만든 영상(쇼츠 클립 · AI 재구성 · 롱폼 컷편집)을 한곳에 모아 미리보기 · 다운로드 · 즐겨찾기 · 삭제
// 작업이 완료되면 자동으로 저장되고, 미리보기 스펙(previewSpec)은 웹사이트/프로그램 공용 플레이어가 그대로 재생한다.
import fs from 'node:fs';
import { ApiError } from './errors.js';

export const LIBRARY_KINDS = { shorts: '쇼츠', remix: 'AI 재구성', longform: '롱폼 컷편집' };

export class LibraryService {
  constructor({ store, notifications = null }) { this.store = store; this.notifications = notifications; }

  // 같은 원본(kind + refId)이 이미 있으면 갱신해 중복을 막는다 (재생성 · 재렌더 · 편집 저장 시)
  add(userId, { kind, refId, jobId = null, title, thumbnail = null, durationSec = 0, ratio = '16:9', renderPath = null, subtitleCount = 0, transcriptExact = null, sourceTitle = '', sourceType = '', extra = {} }) {
    if (!LIBRARY_KINDS[kind]) throw new ApiError(400, '알 수 없는 보관함 종류입니다.');
    const rendered = Boolean(renderPath && fs.existsSync(renderPath));
    const rec = { userId, kind, refId, jobId, title: String(title || '제목 없음').slice(0, 120), thumbnail, durationSec: round(durationSec), ratio, renderPath, rendered, subtitleCount, transcriptExact, sourceTitle, sourceType, extra, savedAt: new Date().toISOString() };
    const existing = this.store.find('library', (r) => r.userId === userId && r.kind === kind && r.refId === refId)[0];
    if (existing) return this.store.update('library', existing.id, { ...rec, thumbnail: existing.thumbnailCustom ? existing.thumbnail : rec.thumbnail, thumbnailCustom: existing.thumbnailCustom || false, favorite: existing.favorite, tags: existing.tags, note: existing.note });
    return this.store.insert('library', { ...rec, favorite: false, tags: [], note: '' });
  }

  // 쇼츠 작업 완료 → 클립마다 한 항목
  addShortsJob(job, clips) {
    return clips.map((c) => this.add(job.userId, {
      kind: 'shorts', refId: c.id, jobId: job.id, title: c.title, thumbnail: c.thumbnail || job.source.thumbnail || null, durationSec: c.durationSec, ratio: c.ratio,
      renderPath: c.render?.rendered ? c.render.output : null, subtitleCount: c.subtitles?.length || 0, transcriptExact: job.transcriptExact ?? null,
      sourceTitle: job.source.title, sourceType: job.source.type, extra: { start: c.start, end: c.end, templateId: c.templateId, score: c.score },
    }));
  }

  addRemixJob(job) {
    const r = job.result || {};
    return this.add(job.userId, {
      kind: 'remix', refId: job.id, jobId: job.id, title: r.plan?.title || job.source.title, thumbnail: job.source.thumbnail || null, durationSec: r.finalDurationSec || 0, ratio: r.ratio || '16:9',
      renderPath: r.render?.rendered ? r.render.output : null, subtitleCount: r.subtitles?.length || 0, transcriptExact: r.transcriptExact ?? null,
      sourceTitle: job.source.title, sourceType: job.source.type, extra: { targetMinutes: job.options?.targetMinutes, reference: job.reference ? { title: job.reference.title, url: job.reference.url } : null, items: r.timeline?.length || 0 },
    });
  }

  addLongformJob(job) {
    const r = job.result || {};
    return this.add(job.userId, {
      kind: 'longform', refId: job.id, jobId: job.id, title: job.source.title, thumbnail: job.source.thumbnail || null, durationSec: r.editedDurationSec || job.source.durationSec, ratio: '16:9',
      renderPath: null, subtitleCount: r.subtitles?.length || 0, transcriptExact: r.transcriptExact ?? null,
      sourceTitle: job.source.title, sourceType: job.source.type, extra: { removedSec: r.removedSec, cuts: r.cuts?.length || 0, chapters: r.chapters?.length || 0 },
    });
  }

  // 이 기능이 생기기 전에 만든 영상도 보관함에 나타나도록, 완료된 작업을 훑어 빠진 항목을 채운다 (메모리 연산이라 매 조회마다 가능)
  sync(userId) {
    const have = new Set(this.store.find('library', (r) => r.userId === userId).map((r) => `${r.kind}:${r.refId}`));
    let added = 0;
    for (const job of this.store.find('jobs', (j) => j.userId === userId && j.kind === 'shorts' && j.status === 'done')) {
      const clips = (job.clipIds || []).map((id) => this.store.get('clips', id)).filter((c) => c && !have.has(`shorts:${c.id}`));
      if (clips.length) { this.addShortsJob(job, clips); added += clips.length; }
    }
    for (const job of this.store.find('remixJobs', (j) => j.userId === userId && j.status === 'done' && j.result)) if (!have.has(`remix:${job.id}`)) { this.addRemixJob(job); added += 1; }
    for (const job of this.store.find('longformJobs', (j) => j.userId === userId && j.status === 'done' && j.result)) if (!have.has(`longform:${job.id}`)) { this.addLongformJob(job); added += 1; }
    return added;
  }

  list(userId, { kind = '', favorite = '', q = '' } = {}) {
    this.sync(userId);
    let items = this.store.find('library', (r) => r.userId === userId);
    // 원본 작업이 지워진 항목은 정리
    items = items.filter((r) => { if (this._ref(r)) return true; this.store.remove('library', r.id); return false; });
    if (kind && LIBRARY_KINDS[kind]) items = items.filter((r) => r.kind === kind);
    if (favorite === '1' || favorite === true) items = items.filter((r) => r.favorite);
    if (q) { const needle = String(q).toLowerCase(); items = items.filter((r) => `${r.title} ${r.sourceTitle} ${(r.tags || []).join(' ')} ${r.note || ''}`.toLowerCase().includes(needle)); }
    items = items.map((r) => ({ ...r, rendered: Boolean(r.renderPath && fs.existsSync(r.renderPath)), renderPath: undefined })).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    return { items, stats: this.stats(userId) };
  }

  stats(userId) {
    const all = this.store.find('library', (r) => r.userId === userId);
    const byKind = Object.fromEntries(Object.keys(LIBRARY_KINDS).map((k) => [k, all.filter((r) => r.kind === k).length]));
    return { total: all.length, byKind, favorites: all.filter((r) => r.favorite).length, totalDurationSec: round(all.reduce((s, r) => s + (r.durationSec || 0), 0)), rendered: all.filter((r) => r.renderPath && fs.existsSync(r.renderPath)).length };
  }

  get(userId, id) {
    const r = this.store.get('library', id);
    if (!r || r.userId !== userId) throw new ApiError(404, '보관함 항목을 찾을 수 없습니다.');
    return r;
  }

  // 항목 + 플레이어가 재생할 미리보기 스펙 + 원본 작업 링크
  detail(userId, id) {
    const item = this.get(userId, id);
    const preview = this.previewSpec(userId, item.kind, item.refId);
    return { ...item, renderPath: undefined, rendered: Boolean(item.renderPath && fs.existsSync(item.renderPath)), preview, link: item.kind === 'shorts' ? `#/studio/${item.jobId}` : item.kind === 'remix' ? `#/remix/${item.refId}` : `#/longform/${item.refId}` };
  }

  update(userId, id, patch = {}) {
    this.get(userId, id);
    const allowed = {};
    if (patch.title != null) allowed.title = String(patch.title).slice(0, 120);
    if (typeof patch.favorite === 'boolean') allowed.favorite = patch.favorite;
    if (Array.isArray(patch.tags)) allowed.tags = patch.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 20);
    if (patch.note != null) allowed.note = String(patch.note).slice(0, 500);
    return this.store.update('library', id, allowed);
  }

  remove(userId, id, { deleteFile = false } = {}) {
    const r = this.get(userId, id);
    if (deleteFile && r.renderPath) { try { fs.unlinkSync(r.renderPath); } catch { /* 이미 없음 */ } }
    return this.store.remove('library', id);
  }

  removeByRef(kind, refId) { for (const r of this.store.find('library', (x) => x.kind === kind && x.refId === refId)) this.store.remove('library', r.id); return true; }

  // 렌더된 MP4 경로 (미리보기 스트리밍/다운로드용)
  videoFile(userId, id) {
    const r = this.get(userId, id);
    if (!r.renderPath || !fs.existsSync(r.renderPath)) return null;
    return r.renderPath;
  }

  _ref(item) {
    if (item.kind === 'shorts') return this.store.get('clips', item.refId);
    if (item.kind === 'remix') return this.store.get('remixJobs', item.refId);
    if (item.kind === 'longform') return this.store.get('longformJobs', item.refId);
    return null;
  }

  // ---- 미리보기 스펙: 플레이어가 원본(유튜브/업로드 파일)을 타임라인대로 이어 재생하고 자막·후킹·카드를 겹쳐 그린다.
  // 렌더된 MP4 가 있으면 그 파일을 바로 재생한다.
  previewSpec(userId, kind, refId) {
    if (kind === 'shorts') {
      const clip = this.store.get('clips', refId);
      if (!clip || clip.userId !== userId) throw new ApiError(404, '클립을 찾을 수 없습니다.');
      const job = this.store.get('jobs', clip.jobId) || { source: {} };
      const items = []; let cursor = 0; let pos = clip.start;
      for (const c of [...(clip.cuts || [])].sort((a, b) => a.start - b.start)) {
        if (c.start > pos) { items.push({ kind: 'source', start: pos, end: c.start, speed: 1, newStart: round(cursor), newEnd: round(cursor + c.start - pos) }); cursor += c.start - pos; }
        pos = Math.max(pos, c.end);
      }
      if (clip.end > pos) { items.push({ kind: 'source', start: pos, end: clip.end, speed: 1, newStart: round(cursor), newEnd: round(cursor + clip.end - pos) }); cursor += clip.end - pos; }
      if (clip.outro) { items.push({ kind: 'card', title: clip.outro.text, cta: true, channel: clip.outro.channel || null, start: 0, end: 0, speed: 1, newStart: round(cursor), newEnd: round(cursor + clip.outro.durationSec) }); cursor += clip.outro.durationSec; }
      const rendered = Boolean(clip.render?.rendered && clip.render.output && fs.existsSync(clip.render.output));
      return {
        kind: 'shorts', refId: clip.id, title: clip.title, ratio: clip.ratio, durationSec: round(cursor), rendered, burnedSubtitles: false,
        renderUrl: rendered ? `/api/shorts/clips/${clip.id}/export?format=mp4&inline=1` : null,
        source: sourceSpec(job.source), items, subtitles: (clip.subtitles || []).map(sub), hook: clip.hook ? { text: clip.hook.text, durationSec: clip.hook.durationSec || 3 } : null,
        zoomKeyframes: clip.zoomKeyframes || [], templateId: clip.templateId, transcriptExact: job.transcriptExact ?? null, thumbnail: clip.thumbnail || job.source.thumbnail || null,
        outro: clip.outro || null, seo: clip.seo || null, thumbnailSet: clip.thumbnailSet ? { ...clip.thumbnailSet, svg: undefined, imageUrl: `/api/thumbnail/shorts/${clip.id}/image.svg?v=${encodeURIComponent(clip.thumbnailSet.updatedAt)}` } : null,
      };
    }
    if (kind === 'remix') {
      const job = this.store.get('remixJobs', refId);
      if (!job || job.userId !== userId) throw new ApiError(404, '재구성 작업을 찾을 수 없습니다.');
      const r = job.result || {};
      const rendered = Boolean(r.render?.rendered && r.render.output && fs.existsSync(r.render.output));
      return {
        kind: 'remix', refId: job.id, title: r.plan?.title || job.source.title, ratio: r.ratio || '16:9', durationSec: r.finalDurationSec || 0, rendered, burnedSubtitles: rendered,
        renderUrl: rendered ? `/api/remix/jobs/${job.id}/export?format=mp4&inline=1` : null,
        source: sourceSpec(job.source), items: (r.timeline || []).map((t) => ({ kind: t.kind, start: t.start, end: t.end, speed: t.speed || 1, title: t.title || null, newStart: t.newStart, newEnd: t.newEnd, section: t.section || null, cta: Boolean(t.cta), channel: t.channel || null })),
        subtitles: (r.subtitles || []).filter((s) => !s.card).map(sub), hook: r.plan?.hook ? { text: r.plan.hook, durationSec: r.styleProfile?.hookDurationSec || 3 } : null,
        sfx: r.sfx || [], narration: r.narration?.lines || [], templateId: r.template?.id || null, transcriptExact: r.transcriptExact ?? null, thumbnail: job.source.thumbnail || null,
        seo: r.seo || null, thumbnailSet: job.thumbnailSet ? { ...job.thumbnailSet, svg: undefined, imageUrl: `/api/thumbnail/remix/${job.id}/image.svg?v=${encodeURIComponent(job.thumbnailSet.updatedAt)}` } : null,
      };
    }
    if (kind === 'longform') {
      const job = this.store.get('longformJobs', refId);
      if (!job || job.userId !== userId) throw new ApiError(404, '롱폼 작업을 찾을 수 없습니다.');
      const r = job.result || {};
      let cursor = 0;
      const items = (r.timeline || []).map((k) => { const it = { kind: 'source', start: k.start, end: k.end, speed: 1, newStart: round(cursor), newEnd: round(cursor + k.end - k.start) }; cursor += k.end - k.start; return it; });
      // 자막은 원본 시간 기준 → 새 타임라인 시간으로 변환
      const toNew = (t) => { for (const it of items) if (t >= it.start && t <= it.end) return round(it.newStart + (t - it.start)); const before = items.filter((it) => it.end <= t).pop(); return before ? before.newEnd : 0; };
      return {
        kind: 'longform', refId: job.id, title: job.source.title, ratio: '16:9', durationSec: round(cursor), rendered: false, burnedSubtitles: false, renderUrl: null,
        source: sourceSpec(job.source), items, subtitles: (r.subtitles || []).map((s) => ({ start: toNew(s.start), end: toNew(s.end), text: s.text })), hook: null,
        chapters: (r.chapters || []).map((c) => ({ at: toNew(c.at), title: c.title })), transcriptExact: r.transcriptExact ?? null, thumbnail: job.source.thumbnail || null,
        seo: r.seo || null, thumbnailSet: job.thumbnailSet ? { ...job.thumbnailSet, svg: undefined, imageUrl: `/api/thumbnail/longform/${job.id}/image.svg?v=${encodeURIComponent(job.thumbnailSet.updatedAt)}` } : null,
      };
    }
    throw new ApiError(400, '알 수 없는 미리보기 종류입니다.');
  }
}

function sourceSpec(source = {}) {
  if (source.videoId && (source.type === 'youtube' || source.platform === 'youtube')) return { type: 'youtube', videoId: source.videoId, url: source.url || null, title: source.title || '' };
  if (source.uploadId) return { type: 'upload', uploadId: source.uploadId, streamUrl: `/api/uploads/${source.uploadId}/stream`, title: source.title || '' };
  if (source.path) return { type: 'local', path: source.path, streamUrl: `/api/local/stream?path=${encodeURIComponent(source.path)}`, title: source.title || '' };
  return { type: source.type || 'unknown', url: source.url || null, title: source.title || '' };
}
function sub(s) { return { start: s.start, end: s.end, text: s.text, animation: s.animation || 'none' }; }
function round(n) { return Math.round((Number(n) || 0) * 100) / 100; }
