// 파일 관리자(Media Library): 업로드한 원본 · 렌더링 결과 · 썸네일 · 합성 음성 · 자막 프로젝트를 한곳에서 검색/정렬/필터/이름 변경/휴지통/복구/다운로드/미리보기/프로젝트에 추가.
import fs from 'node:fs';
import path from 'node:path';
import { ApiError } from './errors.js';

export const MEDIA_CATEGORIES = { video: '영상', image: '이미지', audio: '오디오', subtitle: '자막', output: '렌더링 결과' };
const SAFE_EXT = { video: ['.mp4', '.mov', '.webm', '.m4v', '.mkv', '.avi'], audio: ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'], image: ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg'], subtitle: ['.srt', '.vtt', '.ass', '.txt', '.json'] };
export const UPLOAD_LIMITS = { maxBytes: Number(process.env.ALPHAMAN_UPLOAD_MAX_BYTES) || (process.env.VERCEL ? 4.5 * 1024 * 1024 : 2 * 1024 * 1024 * 1024) };

// 업로드 검증: 확장자 · MIME · 크기 · 파일명 (경로 문자 제거)
export function validateUpload({ filename, mimeType, size }) {
  const name = String(filename || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim().slice(0, 180) || 'upload';
  const ext = path.extname(name).toLowerCase();
  const cat = Object.entries(SAFE_EXT).find(([, exts]) => exts.includes(ext))?.[0] || null;
  if (!cat) throw new ApiError(400, `허용되지 않는 파일 형식입니다 (${ext || '확장자 없음'}). 영상(MP4/MOV/WebM), 오디오(MP3/WAV/M4A), 이미지(JPG/PNG/WebP), 자막(SRT/VTT) 파일만 올릴 수 있습니다.`);
  const mime = String(mimeType || '').toLowerCase().split(';')[0];
  const okMime = { video: /^(video\/|application\/octet-stream|application\/mp4)/, audio: /^(audio\/|video\/mp4|video\/webm|application\/octet-stream)/, image: /^(image\/|application\/octet-stream)/, subtitle: /^(text\/|application\/(json|octet-stream|x-subrip))/ }[cat];
  if (mime && !okMime.test(mime)) throw new ApiError(400, `파일 내용(${mime})이 확장자(${ext})와 맞지 않습니다.`);
  if (!(size > 0)) throw new ApiError(400, '빈 파일은 올릴 수 없습니다.');
  if (size > UPLOAD_LIMITS.maxBytes) throw new ApiError(413, `파일이 너무 큽니다 (최대 ${Math.round(UPLOAD_LIMITS.maxBytes / 1024 / 1024)}MB).`);
  return { name, ext, category: cat };
}

export class MediaService {
  constructor({ store, outputDir }) { this.store = store; this.outputDir = outputDir; }

  _sizeOf(p) { try { return p && fs.existsSync(p) ? fs.statSync(p).size : 0; } catch { return 0; } }
  _catOf(up) { const ext = path.extname(up.filename || '').toLowerCase(); return Object.entries(SAFE_EXT).find(([, e]) => e.includes(ext))?.[0] || (String(up.mimeType || '').startsWith('audio') ? 'audio' : 'video'); }

  items(userId) {
    const out = [];
    for (const up of this.store.find('uploads', (u) => u.userId === userId)) {
      const cat = this._catOf(up);
      out.push({ id: `upload:${up.id}`, refId: up.id, category: cat, name: up.displayName || up.filename, size: up.size || this._sizeOf(up.path), createdAt: up.createdAt, updatedAt: up.updatedAt, deletedAt: up.deletedAt || null, available: Boolean(up.remoteUrl || (up.path && fs.existsSync(up.path))), url: `/api/uploads/${up.id}/stream`, downloadUrl: `/api/uploads/${up.id}/stream?download=1`, previewable: cat === 'video' || cat === 'audio' || cat === 'image', usedBy: this._usedBy(up.id) });
    }
    for (const it of this.store.find('library', (r) => r.userId === userId)) {
      const size = this._sizeOf(it.renderPath);
      out.push({ id: `output:${it.id}`, refId: it.id, category: 'output', name: it.title, size, durationSec: it.durationSec, ratio: it.ratio, createdAt: it.savedAt || it.createdAt, updatedAt: it.updatedAt, deletedAt: it.deletedAt || null, available: true, rendered: Boolean(size), url: size ? `/api/library/${it.id}/video` : null, downloadUrl: size ? `/api/library/${it.id}/video?download=1` : null, previewable: true, libraryId: it.id, kind: it.kind, projectRoute: it.kind === 'shorts' ? `#/studio/${it.jobId}` : it.kind === 'remix' ? `#/remix/${it.refId}` : `#/longform/${it.refId}`, thumbnail: it.thumbnail || null });
    }
    for (const r of this.store.find('voiceRenders', (x) => x.userId === userId && (x.audioPath || x.audioUrl))) {
      out.push({ id: `tts:${r.id}`, refId: r.id, category: 'audio', name: r.displayName || `TTS · ${(r.voiceName || '내 목소리')} · ${String(r.text || '').slice(0, 24)}`, size: this._sizeOf(r.audioPath), durationSec: r.durationSec, createdAt: r.createdAt, updatedAt: r.updatedAt, deletedAt: r.deletedAt || null, available: true, url: `/api/voice/renders/${r.id}/audio`, downloadUrl: `/api/voice/renders/${r.id}/audio?download=1`, previewable: true, subtype: 'tts' });
    }
    for (const p of this.store.find('subtitleProjects', (x) => x.userId === userId)) {
      out.push({ id: `subtitle:${p.id}`, refId: p.id, category: 'subtitle', name: p.projectTitle || p.source?.title || '자막', size: JSON.stringify(p.segments || []).length, segments: (p.segments || []).length, createdAt: p.createdAt, updatedAt: p.updatedAt, deletedAt: p.deletedAt || null, available: true, url: `/api/subtitles/projects/${p.id}/export?format=srt`, downloadUrl: `/api/subtitles/projects/${p.id}/export?format=srt`, previewable: false, projectRoute: `#/subtitles/${p.id}` });
    }
    for (const kind of ['shorts', 'remix', 'longform']) {
      const col = { shorts: 'clips', remix: 'remixJobs', longform: 'longformJobs' }[kind];
      for (const rec of this.store.find(col, (x) => x.userId === userId && x.thumbnailSet?.svg)) out.push({ id: `thumb:${kind}:${rec.id}`, refId: rec.id, category: 'image', name: `썸네일 · ${rec.title || rec.projectTitle || rec.source?.title || kind}`, size: rec.thumbnailSet.svg.length, createdAt: rec.thumbnailSet.updatedAt, updatedAt: rec.thumbnailSet.updatedAt, deletedAt: null, available: true, url: `/api/thumbnail/${kind}/${rec.id}/image.svg`, downloadUrl: `/api/thumbnail/${kind}/${rec.id}/image.svg`, previewable: true, subtype: 'thumbnail', projectRoute: kind === 'shorts' ? `#/studio/${rec.jobId}` : `#/${kind}/${rec.id}` });
    }
    return out;
  }
  _usedBy(uploadId) {
    const refs = [];
    for (const j of this.store.find('jobs', (x) => x.source?.uploadId === uploadId)) refs.push({ kind: 'shorts', refId: j.id, route: `#/studio/${j.id}` });
    for (const j of this.store.find('remixJobs', (x) => x.source?.uploadId === uploadId)) refs.push({ kind: 'remix', refId: j.id, route: `#/remix/${j.id}` });
    for (const j of this.store.find('subtitleProjects', (x) => x.source?.uploadId === uploadId)) refs.push({ kind: 'subtitle', refId: j.id, route: `#/subtitles/${j.id}` });
    return refs;
  }

  list(userId, { category = '', q = '', sort = 'recent', trash = '' } = {}) {
    let items = this.items(userId);
    const inTrash = trash === '1' || trash === true;
    items = items.filter((i) => Boolean(i.deletedAt) === inTrash);
    if (category && MEDIA_CATEGORIES[category]) items = items.filter((i) => i.category === category);
    if (q) { const n = String(q).toLowerCase(); items = items.filter((i) => i.name.toLowerCase().includes(n)); }
    const by = { recent: (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)), oldest: (a, b) => String(a.createdAt).localeCompare(String(b.createdAt)), name: (a, b) => a.name.localeCompare(b.name, 'ko'), size: (a, b) => (b.size || 0) - (a.size || 0) };
    items.sort(by[sort] || by.recent);
    return { items, categories: MEDIA_CATEGORIES, usage: this.usage(userId) };
  }
  usage(userId) {
    const all = this.items(userId);
    const bytes = all.filter((i) => !i.deletedAt).reduce((s, i) => s + (i.size || 0), 0);
    const byCategory = Object.fromEntries(Object.keys(MEDIA_CATEGORIES).map((c) => [c, all.filter((i) => i.category === c && !i.deletedAt).length]));
    return { bytes, files: all.filter((i) => !i.deletedAt).length, trash: all.filter((i) => i.deletedAt).length, byCategory, limitBytes: Number(process.env.ALPHAMAN_STORAGE_LIMIT_BYTES) || 5 * 1024 * 1024 * 1024 };
  }

  _target(userId, id) {
    const [type, ...rest] = String(id).split(':'); const refId = rest.join(':');
    const map = { upload: 'uploads', output: 'library', tts: 'voiceRenders', subtitle: 'subtitleProjects' };
    if (!map[type]) throw new ApiError(400, '이 항목은 여기서 수정할 수 없습니다.');
    const rec = this.store.get(map[type], refId);
    if (!rec || rec.userId !== userId) throw new ApiError(404, '파일을 찾을 수 없습니다.');
    return { type, col: map[type], rec };
  }
  rename(userId, id, name) {
    const { type, col, rec } = this._target(userId, id);
    const n = String(name || '').replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 120); if (!n) throw new ApiError(400, '이름을 입력해주세요.');
    const patch = type === 'upload' ? { displayName: n } : type === 'output' ? { title: n } : type === 'tts' ? { displayName: n } : { projectTitle: n };
    this.store.update(col, rec.id, patch); return true;
  }
  trash(userId, id) { const { col, rec } = this._target(userId, id); this.store.update(col, rec.id, { deletedAt: new Date().toISOString() }); return true; }
  restore(userId, id) { const { col, rec } = this._target(userId, id); this.store.update(col, rec.id, { deletedAt: null }); return true; }
  destroy(userId, id) {
    const { type, col, rec } = this._target(userId, id);
    if (type === 'upload') { try { if (rec.path && fs.existsSync(rec.path)) fs.unlinkSync(rec.path); } catch { /* ignore */ } }
    if (type === 'output' && rec.renderPath) { try { fs.unlinkSync(rec.renderPath); } catch { /* ignore */ } }
    if (type === 'tts' && rec.audioPath) { try { fs.unlinkSync(rec.audioPath); } catch { /* ignore */ } }
    if (type === 'subtitle') { /* 자막 프로젝트는 프로젝트 관리에서 영구 삭제 */ throw new ApiError(400, '자막 프로젝트는 프로젝트 관리의 휴지통에서 영구 삭제할 수 있습니다.'); }
    return this.store.remove(col, rec.id);
  }
}
