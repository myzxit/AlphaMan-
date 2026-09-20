// 안전한 공유 링크: 사용자가 명시적으로 만든 토큰으로만 결과(미리보기·자막)를 읽기 전용으로 볼 수 있다. 만료·취소 가능
import { randomBytes } from 'node:crypto';
import { ApiError } from './errors.js';

export class ShareService {
  constructor({ store, library }) { this.store = store; this.library = library; }
  create(userId, { kind, refId, expiresDays = 30, allowDownload = false, title = '' }) {
    if (!['shorts', 'remix', 'longform'].includes(kind)) throw new ApiError(400, '공유할 수 없는 종류입니다.');
    this.library.previewSpec(userId, kind, refId); // 소유권 확인
    const days = Math.min(365, Math.max(1, Number(expiresDays) || 30));
    const token = randomBytes(18).toString('base64url');
    return this.store.insert('shares', { userId, kind, refId, token, title: String(title || '').slice(0, 120), allowDownload: Boolean(allowDownload), expiresAt: new Date(Date.now() + days * 86400000).toISOString(), revokedAt: null, views: 0 });
  }
  list(userId) { return this.store.find('shares', (s) => s.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  revoke(userId, id) { const s = this.store.get('shares', id); if (!s || s.userId !== userId) throw new ApiError(404, '공유 링크를 찾을 수 없습니다.'); this.store.update('shares', id, { revokedAt: new Date().toISOString() }); return true; }
  remove(userId, id) { const s = this.store.get('shares', id); if (!s || s.userId !== userId) throw new ApiError(404, '공유 링크를 찾을 수 없습니다.'); return this.store.remove('shares', id); }
  // 공개 조회 (로그인 불필요): 토큰이 유효하고 취소·만료되지 않은 경우에만
  resolve(token) {
    const s = this.store.findOne('shares', (x) => x.token === token);
    if (!s || s.revokedAt) throw new ApiError(404, '공유 링크가 없거나 취소되었습니다.');
    if (new Date(s.expiresAt).getTime() < Date.now()) throw new ApiError(410, '공유 링크가 만료되었습니다.');
    let preview;
    try { preview = this.library.previewSpec(s.userId, s.kind, s.refId); } catch { throw new ApiError(404, '공유된 항목이 삭제되었습니다.'); }
    this.store.update('shares', s.id, { views: (s.views || 0) + 1, lastViewedAt: new Date().toISOString() });
    // 공유 화면에는 원본 파일 스트림 대신 토큰 기반 스트림 URL 을 준다
    if (preview.source?.streamUrl) preview.source = { ...preview.source, streamUrl: `${preview.source.streamUrl}${preview.source.streamUrl.includes('?') ? '&' : '?'}share=${token}` };
    if (preview.renderUrl) preview.renderUrl = `${preview.renderUrl}&share=${token}`;
    for (const c of preview.audio?.cues || []) if (c.url) c.url = `${c.url}?share=${token}`;
    return { title: s.title || preview.title, kind: s.kind, allowDownload: s.allowDownload, expiresAt: s.expiresAt, preview: { ...preview, seo: undefined, thumbnailSet: undefined } };
  }
  // 스트림 라우트가 토큰으로 접근 권한을 확인할 때 사용
  ownerForToken(token, { uploadId = null, renderId = null, kind = null, refId = null } = {}) {
    const s = this.store.findOne('shares', (x) => x.token === token && !x.revokedAt && new Date(x.expiresAt).getTime() > Date.now());
    if (!s) return null;
    if (uploadId) { const col = { shorts: 'jobs', remix: 'remixJobs', longform: 'longformJobs' }[s.kind]; const rec = this.store.get(col, s.refId); const src = s.kind === 'shorts' ? this.store.get('jobs', this.store.get('clips', s.refId)?.jobId)?.source : rec?.source; if (src?.uploadId !== uploadId) return null; }
    if (kind && refId && (s.kind !== kind || s.refId !== refId)) return null;
    if (renderId) { const r = this.store.get('voiceRenders', renderId); if (!r || r.userId !== s.userId) return null; }
    return s.userId;
  }
}
