// 사용자 템플릿: 자막 스타일 · 텍스트 스타일 · 효과/전환 · 화면 비율 · 기본 옵션을 저장해 다른 프로젝트(쇼츠/재구성/자막)에 다시 적용한다
import { ApiError } from './errors.js';

export const TEMPLATE_KINDS = { shorts: '쇼츠 설정', remix: '재구성 설정', subtitle: '자막 스타일', general: '공통 설정' };
const ALLOWED = ['ratio', 'templateId', 'subtitleStyle', 'textStyle', 'effects', 'transitions', 'options', 'outroText', 'outro', 'colorGrade', 'pacing', 'language', 'quality'];

export class UserTemplateService {
  constructor({ store }) { this.store = store; }
  list(userId, kind = '') { return this.store.find('userTemplates', (t) => t.userId === userId && (!kind || t.kind === kind || t.kind === 'general')).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  get(userId, id) { const t = this.store.get('userTemplates', id); if (!t || t.userId !== userId) throw new ApiError(404, '템플릿을 찾을 수 없습니다.'); return t; }
  _clean(settings) {
    if (!settings || typeof settings !== 'object') throw new ApiError(400, '템플릿 설정이 필요합니다.');
    const out = {};
    for (const k of ALLOWED) if (settings[k] !== undefined) out[k] = settings[k];
    if (out.ratio && !['16:9', '9:16', '1:1', '4:5', 'auto'].includes(out.ratio)) throw new ApiError(400, '지원하지 않는 화면 비율입니다.');
    if (JSON.stringify(out).length > 20000) throw new ApiError(400, '템플릿 설정이 너무 큽니다.');
    return out;
  }
  create(userId, { name, kind = 'general', settings, description = '' }) {
    const n = String(name || '').trim().slice(0, 60); if (!n) throw new ApiError(400, '템플릿 이름을 입력해주세요.');
    if (!TEMPLATE_KINDS[kind]) throw new ApiError(400, '알 수 없는 템플릿 종류입니다.');
    if (this.store.findOne('userTemplates', (t) => t.userId === userId && t.name === n)) throw new ApiError(409, '같은 이름의 템플릿이 이미 있습니다.');
    if (this.store.count('userTemplates', (t) => t.userId === userId) >= 100) throw new ApiError(400, '템플릿은 100개까지 저장할 수 있습니다.');
    return this.store.insert('userTemplates', { userId, name: n, kind, description: String(description || '').slice(0, 200), settings: this._clean(settings), uses: 0 });
  }
  update(userId, id, patch = {}) {
    this.get(userId, id);
    const allowed = {};
    if (patch.name != null) allowed.name = String(patch.name).trim().slice(0, 60);
    if (patch.description != null) allowed.description = String(patch.description).slice(0, 200);
    if (patch.settings) allowed.settings = this._clean(patch.settings);
    if (patch.kind && TEMPLATE_KINDS[patch.kind]) allowed.kind = patch.kind;
    return this.store.update('userTemplates', id, allowed);
  }
  remove(userId, id) { this.get(userId, id); return this.store.remove('userTemplates', id); }
  markUsed(userId, id) { const t = this.get(userId, id); this.store.update('userTemplates', id, { uses: (t.uses || 0) + 1, lastUsedAt: new Date().toISOString() }); return t; }
}
