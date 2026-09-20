// 프로젝트 관리: 기존 작업(쇼츠 · AI 재구성 · 롱폼 · 자막 프로젝트)을 "프로젝트"로 묶어 이름 변경 · 즐겨찾기 · 검색 · 정렬 · 휴지통(복구/영구 삭제) ·
// 복제 · 마지막 작업 위치 · 버전 기록 · 내보내기/가져오기 · 일괄 적용을 제공한다. 기존 데이터 구조는 그대로 두고 필드만 덧붙인다.
import { ApiError } from './errors.js';

export const PROJECT_KINDS = {
  shorts: { col: 'jobs', label: '쇼츠', route: (id) => `#/studio/${id}` },
  remix: { col: 'remixJobs', label: 'AI 재구성', route: (id) => `#/remix/${id}` },
  longform: { col: 'longformJobs', label: '롱폼 컷편집', route: (id) => `#/longform/${id}` },
  subtitle: { col: 'subtitleProjects', label: '자막', route: (id) => `#/subtitles/${id}` },
};
const MAX_VERSIONS = 50;

export class ProjectService {
  constructor({ store, shorts, remix, longform, subtitles, library, credits }) {
    this.store = store; this.shorts = shorts; this.remix = remix; this.longform = longform; this.subtitles = subtitles; this.library = library; this.credits = credits;
  }

  _def(kind) { const d = PROJECT_KINDS[kind]; if (!d) throw new ApiError(400, '알 수 없는 프로젝트 종류입니다.'); return d; }
  _rec(userId, kind, refId) {
    const d = this._def(kind);
    const rec = this.store.get(d.col, refId);
    if (!rec || rec.userId !== userId) throw new ApiError(404, '프로젝트를 찾을 수 없습니다.');
    return { d, rec };
  }
  titleOf(kind, rec) { return rec.projectTitle || (kind === 'remix' ? rec.result?.plan?.title : null) || rec.source?.title || '제목 없음'; }
  summarize(kind, rec) {
    const d = PROJECT_KINDS[kind];
    const state = this.store.findOne('workspaceState', (w) => w.kind === kind && w.refId === rec.id);
    const versions = this.store.count('versions', (v) => v.kind === kind && v.refId === rec.id);
    return {
      id: `${kind}:${rec.id}`, kind, kindLabel: d.label, refId: rec.id, title: this.titleOf(kind, rec), status: rec.status || 'ready', progress: rec.progress ?? null,
      favorite: Boolean(rec.favorite), tags: rec.tags || [], createdAt: rec.createdAt, updatedAt: rec.updatedAt, deletedAt: rec.deletedAt || null,
      sourceTitle: rec.source?.title || '', sourceType: rec.source?.type || '', durationSec: rec.source?.durationSec || 0, thumbnail: rec.source?.thumbnail || null,
      route: d.route(rec.id), lastPosition: state?.position || null, lastOpenedAt: state?.updatedAt || null, versions,
      counts: kind === 'shorts' ? { clips: (rec.clipIds || []).length } : kind === 'subtitle' ? { segments: (rec.segments || []).length } : {},
    };
  }

  list(userId, { q = '', sort = 'updated', kind = '', favorite = '', trash = '' } = {}) {
    let items = [];
    for (const [k, d] of Object.entries(PROJECT_KINDS)) {
      if (kind && kind !== k) continue;
      for (const rec of this.store.find(d.col, (r) => r.userId === userId && (k !== 'shorts' || r.kind === 'shorts'))) items.push(this.summarize(k, rec));
    }
    const inTrash = trash === '1' || trash === true;
    items = items.filter((p) => Boolean(p.deletedAt) === inTrash);
    if (favorite === '1' || favorite === true) items = items.filter((p) => p.favorite);
    if (q) { const n = String(q).toLowerCase(); items = items.filter((p) => `${p.title} ${p.sourceTitle} ${p.tags.join(' ')}`.toLowerCase().includes(n)); }
    const by = { updated: (a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)), created: (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)), favorite: (a, b) => (b.favorite - a.favorite) || String(b.updatedAt).localeCompare(String(a.updatedAt)), title: (a, b) => a.title.localeCompare(b.title, 'ko'), opened: (a, b) => String(b.lastOpenedAt || '').localeCompare(String(a.lastOpenedAt || '')) };
    items.sort(by[sort] || by.updated);
    return { items, counts: { total: items.length, favorites: items.filter((p) => p.favorite).length, trash: this.store.count('jobs', (r) => r.userId === userId && r.deletedAt) + this.store.count('remixJobs', (r) => r.userId === userId && r.deletedAt) + this.store.count('longformJobs', (r) => r.userId === userId && r.deletedAt) + this.store.count('subtitleProjects', (r) => r.userId === userId && r.deletedAt) } };
  }

  get(userId, kind, refId) { const { rec } = this._rec(userId, kind, refId); return this.summarize(kind, rec); }
  rename(userId, kind, refId, title) { const { d } = this._rec(userId, kind, refId); const t = String(title || '').trim().slice(0, 120); if (!t) throw new ApiError(400, '이름을 입력해주세요.'); this.store.update(d.col, refId, { projectTitle: t }); if (this.library) { const it = this.store.find('library', (r) => r.refId === refId || r.jobId === refId)[0]; if (it && kind !== 'shorts') this.store.update('library', it.id, { title: t }); } return this.get(userId, kind, refId); }
  favorite(userId, kind, refId, on) { const { d } = this._rec(userId, kind, refId); this.store.update(d.col, refId, { favorite: Boolean(on) }); return this.get(userId, kind, refId); }
  setTags(userId, kind, refId, tags) { const { d } = this._rec(userId, kind, refId); this.store.update(d.col, refId, { tags: (Array.isArray(tags) ? tags : []).map((t) => String(t).trim()).filter(Boolean).slice(0, 20) }); return this.get(userId, kind, refId); }
  trash(userId, kind, refId) { const { d } = this._rec(userId, kind, refId); this.store.update(d.col, refId, { deletedAt: new Date().toISOString() }); return this.get(userId, kind, refId); }
  restore(userId, kind, refId) { const { d } = this._rec(userId, kind, refId); this.store.update(d.col, refId, { deletedAt: null }); return this.get(userId, kind, refId); }
  destroy(userId, kind, refId) {
    this._rec(userId, kind, refId);
    if (kind === 'shorts') this.shorts.deleteJob(userId, refId);
    else if (kind === 'remix') this.remix.remove(userId, refId);
    else if (kind === 'longform') this.longform.remove(userId, refId);
    else this.subtitles.remove(userId, refId);
    for (const v of this.store.find('versions', (x) => x.kind === kind && x.refId === refId)) this.store.remove('versions', v.id);
    for (const w of this.store.find('workspaceState', (x) => x.kind === kind && x.refId === refId)) this.store.remove('workspaceState', w.id);
    return true;
  }
  emptyTrash(userId) { let n = 0; for (const p of this.list(userId, { trash: '1' }).items) { this.destroy(userId, p.kind, p.refId); n += 1; } return n; }

  // 복제: 같은 원본·옵션으로 새 작업을 만든다 (AI 작업은 이용권이 다시 차감됨). 자막 프로젝트는 데이터만 복사
  async duplicate(userId, kind, refId) {
    const { rec } = this._rec(userId, kind, refId);
    const title = `${this.titleOf(kind, rec)} (복제)`;
    let created;
    if (kind === 'subtitle') {
      created = this.store.insert('subtitleProjects', { ...structuredClone({ ...rec, id: undefined, createdAt: undefined, updatedAt: undefined }), id: undefined, projectTitle: title, favorite: false, deletedAt: null, history: [] });
    } else if (kind === 'shorts') {
      const body = { options: { ...rec.options }, transcript: rec.options.transcript || null, transcriptText: rec.options.transcriptText || '' };
      created = rec.source.uploadId ? await this.shorts.createFromUpload(userId, { uploadId: rec.source.uploadId, ...body }) : await this.shorts.createFromYoutube(userId, { url: rec.source.url, ...body });
      this.store.update('jobs', created.id, { projectTitle: title });
    } else if (kind === 'remix') {
      created = await this.remix.create(userId, { url: rec.source.url, uploadId: rec.source.uploadId, localPath: rec.source.type === 'local' ? rec.source.path : undefined, referenceUrl: rec.reference?.url || null, options: { ...rec.options }, rightsConfirmed: true, transcript: rec.options.transcript || null, transcriptText: rec.options.transcriptText || '' });
      this.store.update('remixJobs', created.id, { projectTitle: title });
    } else {
      created = await this.longform.create(userId, { url: rec.source.url, uploadId: rec.source.uploadId, options: { ...rec.options }, transcript: rec.options.transcript || null, transcriptText: rec.options.transcriptText || '' });
      this.store.update('longformJobs', created.id, { projectTitle: title });
    }
    return this.get(userId, kind, created.id);
  }

  // 마지막 작업 위치 (편집기 스크롤/선택/재생 위치 등 자유 형식)
  setPosition(userId, kind, refId, position) {
    this._rec(userId, kind, refId);
    const cur = this.store.findOne('workspaceState', (w) => w.userId === userId && w.kind === kind && w.refId === refId);
    const pos = position && typeof position === 'object' ? position : {};
    if (cur) return this.store.update('workspaceState', cur.id, { position: pos });
    return this.store.insert('workspaceState', { userId, kind, refId, position: pos });
  }
  getPosition(userId, kind, refId) { this._rec(userId, kind, refId); return this.store.findOne('workspaceState', (w) => w.userId === userId && w.kind === kind && w.refId === refId)?.position || null; }

  // ---- 버전 기록 ----
  _snapshotOf(kind, rec) {
    if (kind === 'shorts') return { clips: (rec.clipIds || []).map((id) => this.store.get('clips', id)).filter(Boolean).map((c) => ({ ...c })), options: rec.options };
    if (kind === 'subtitle') return { segments: rec.segments, style: rec.style, translations: rec.translations, language: rec.language };
    return { result: rec.result, options: rec.options };
  }
  snapshot(userId, kind, refId, { label = '', changes = '' } = {}) {
    const { rec } = this._rec(userId, kind, refId);
    const all = this.store.find('versions', (v) => v.kind === kind && v.refId === refId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const number = all.length ? all[all.length - 1].number + 1 : 1;
    const v = this.store.insert('versions', { userId, kind, refId, number, label: String(label || `Version ${number}`).slice(0, 80), changes: String(changes || '').slice(0, 300), snapshot: this._snapshotOf(kind, rec) });
    if (all.length + 1 > MAX_VERSIONS) for (const old of all.slice(0, all.length + 1 - MAX_VERSIONS)) this.store.remove('versions', old.id);
    return { ...v, snapshot: undefined };
  }
  versions(userId, kind, refId) { this._rec(userId, kind, refId); return this.store.find('versions', (v) => v.kind === kind && v.refId === refId).sort((a, b) => b.number - a.number).map((v) => ({ ...v, snapshot: undefined, size: JSON.stringify(v.snapshot).length })); }
  version(userId, kind, refId, versionId) { this._rec(userId, kind, refId); const v = this.store.get('versions', versionId); if (!v || v.userId !== userId || v.refId !== refId) throw new ApiError(404, '버전을 찾을 수 없습니다.'); return v; }
  restoreVersion(userId, kind, refId, versionId) {
    const { d, rec } = this._rec(userId, kind, refId);
    const v = this.version(userId, kind, refId, versionId);
    this.snapshot(userId, kind, refId, { label: `복원 전 자동 저장`, changes: `Version ${v.number} 복원 직전 상태` });
    const s = v.snapshot;
    if (kind === 'shorts') {
      for (const c of s.clips || []) { const cur = this.store.get('clips', c.id); if (cur) this.store.update('clips', c.id, { ...c, updatedAt: undefined }); else this.store.insert('clips', { ...c }); }
      this.store.update(d.col, refId, { clipIds: (s.clips || []).map((c) => c.id), options: s.options || rec.options });
    } else if (kind === 'subtitle') this.store.update(d.col, refId, { segments: s.segments, style: s.style, translations: s.translations || {}, history: [...(rec.history || []).slice(-49), { at: new Date().toISOString(), segments: rec.segments }] });
    else this.store.update(d.col, refId, { result: s.result, options: s.options || rec.options });
    if (this.library) this.library.sync(userId);
    return this.get(userId, kind, refId);
  }
  removeVersion(userId, kind, refId, versionId) { this.version(userId, kind, refId, versionId); return this.store.remove('versions', versionId); }

  // ---- 내보내기 / 가져오기 ----
  exportProject(userId, kind, refId) {
    const { rec } = this._rec(userId, kind, refId);
    const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (['userId', 'path', 'samplePath', 'audioPath', 'renderPath', 'remoteUrl', 'vocalsPath'].includes(k) ? undefined : v)));
    const project = strip({ ...rec, id: undefined });
    const data = { format: 'alphaman-project', version: 1, kind, exportedAt: new Date().toISOString(), title: this.titleOf(kind, rec), project };
    if (kind === 'shorts') data.clips = strip((rec.clipIds || []).map((id) => this.store.get('clips', id)).filter(Boolean));
    data.versions = this.store.find('versions', (v) => v.kind === kind && v.refId === refId).map((v) => strip({ number: v.number, label: v.label, changes: v.changes, createdAt: v.createdAt, snapshot: v.snapshot }));
    data.templates = this.store.find('userTemplates', (t) => t.userId === userId && (t.kind === kind || t.kind === 'general')).map((t) => strip({ ...t, id: undefined }));
    return data;
  }
  importProject(userId, data) {
    // 검증
    if (!data || typeof data !== 'object') throw new ApiError(400, '프로젝트 파일이 올바르지 않습니다.');
    if (data.format !== 'alphaman-project') throw new ApiError(400, 'AlphaMan 프로젝트 파일(format: alphaman-project)이 아닙니다.');
    if (Number(data.version) !== 1) throw new ApiError(400, `지원하지 않는 프로젝트 파일 버전입니다 (${data.version}).`);
    const kind = data.kind; const d = this._def(kind);
    const p = data.project;
    if (!p || typeof p !== 'object' || !p.source || typeof p.source !== 'object') throw new ApiError(400, '프로젝트 본문(source)이 없습니다.');
    if (typeof p.source.title !== 'string') throw new ApiError(400, '원본 제목이 올바르지 않습니다.');
    if (kind === 'subtitle') { if (!Array.isArray(p.segments)) throw new ApiError(400, '자막 세그먼트가 없습니다.'); for (const [i, s] of p.segments.entries()) if (!(Number(s.end) > Number(s.start)) || typeof s.text !== 'string') throw new ApiError(400, `${i + 1}번째 자막의 시간/텍스트가 올바르지 않습니다.`); }
    if (kind === 'shorts' && !Array.isArray(data.clips)) throw new ApiError(400, '쇼츠 클립 데이터가 없습니다.');
    if ((kind === 'remix' || kind === 'longform') && p.result != null && typeof p.result !== 'object') throw new ApiError(400, '결과 데이터가 올바르지 않습니다.');
    const now = new Date().toISOString();
    const base = { ...p, id: undefined, createdAt: undefined, updatedAt: undefined, userId, projectTitle: `${data.title || p.source.title} (가져옴)`, favorite: false, deletedAt: null, importedAt: now, status: kind === 'subtitle' ? 'ready' : (p.status === 'done' ? 'done' : p.status || 'done'), source: { ...p.source, path: undefined, uploadId: undefined } };
    if (kind === 'shorts') base.clipIds = [];
    const rec = this.store.insert(d.col, base);
    if (kind === 'shorts') {
      const ids = [];
      for (const c of data.clips) { const clip = this.store.insert('clips', { ...c, id: undefined, createdAt: undefined, updatedAt: undefined, jobId: rec.id, userId, render: null }); ids.push(clip.id); }
      this.store.update('jobs', rec.id, { clipIds: ids, kind: 'shorts' });
    }
    for (const v of Array.isArray(data.versions) ? data.versions : []) { if (v && v.snapshot) this.store.insert('versions', { userId, kind, refId: rec.id, number: Number(v.number) || 1, label: String(v.label || '').slice(0, 80), changes: String(v.changes || '').slice(0, 300), snapshot: v.snapshot }); }
    let templates = 0;
    for (const t of Array.isArray(data.templates) ? data.templates : []) { if (t && t.name && t.settings && !this.store.findOne('userTemplates', (x) => x.userId === userId && x.name === t.name)) { this.store.insert('userTemplates', { userId, name: String(t.name).slice(0, 60), kind: t.kind || 'general', settings: t.settings }); templates += 1; } }
    if (this.library) this.library.sync(userId);
    return { project: this.get(userId, kind, rec.id), templatesImported: templates };
  }

  // ---- 일괄 적용 (항목 하나 처리; 클라이언트가 진행률을 보여주며 순차 호출) ----
  async applySettings(userId, kind, refId, settings = {}) {
    const { d, rec } = this._rec(userId, kind, refId);
    const applied = [];
    if (kind === 'shorts') {
      for (const id of rec.clipIds || []) {
        const patch = {};
        if (settings.ratio) patch.ratio = settings.ratio;
        if (settings.templateId) patch.templateId = settings.templateId;
        if (settings.outro !== undefined) patch.outro = settings.outro;
        if (Object.keys(patch).length) { this.shorts.editClip(userId, id, patch); applied.push(id); }
      }
    } else if (kind === 'subtitle') {
      if (settings.subtitleStyle) { this.subtitles.setStyle(userId, refId, settings.subtitleStyle); applied.push('style'); }
    } else if (kind === 'remix') {
      const result = { ...(rec.result || {}) };
      if (settings.ratio) result.ratio = settings.ratio;
      if (settings.templateId) result.template = { ...(result.template || {}), id: settings.templateId };
      if (rec.result && (settings.ratio || settings.templateId)) { this.store.update(d.col, refId, { result }); applied.push('result'); }
    }
    if (settings.favorite !== undefined) { this.store.update(d.col, refId, { favorite: Boolean(settings.favorite) }); applied.push('favorite'); }
    if (settings.tags) { this.setTags(userId, kind, refId, settings.tags); applied.push('tags'); }
    return { id: `${kind}:${refId}`, applied };
  }
}
