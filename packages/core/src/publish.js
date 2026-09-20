// SNS 업로드 자동화: 유튜브·인스타그램·틱톡·스레드·페이스북에 클릭 한 번으로 바로 업로드하거나 예약 (예: 오전 10시 월/수/금)
import { ApiError } from './errors.js';

export const PLATFORMS = [
  { id: 'youtube', name: 'YouTube', maxTitle: 100, formats: ['9:16'], oauth: true },
  { id: 'instagram', name: 'Instagram', maxTitle: 2200, formats: ['9:16', '4:5', '1:1'], oauth: true },
  { id: 'tiktok', name: 'TikTok', maxTitle: 2200, formats: ['9:16'], oauth: true },
  { id: 'threads', name: 'Threads', maxTitle: 500, formats: ['9:16', '1:1'], oauth: true },
  { id: 'facebook', name: 'Facebook', maxTitle: 63206, formats: ['9:16', '1:1', '16:9'], oauth: true },
];

const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export class PublishService {
  constructor({ store, notifications }) {
    this.store = store; this.notifications = notifications;
    this._timer = null;
  }

  platforms() { return PLATFORMS; }

  // 계정 연결 (OAuth 콜백을 흉내 낸 연결 정보 저장 - 실제 토큰은 환경에 맞게 확장)
  connect(userId, { platform, handle, accessToken = null }) {
    if (!PLATFORMS.some((p) => p.id === platform)) throw new ApiError(400, '지원하지 않는 플랫폼입니다.');
    if (!handle) throw new ApiError(400, '채널/계정 이름을 입력해주세요.');
    const existing = this.store.findOne('publishAccounts', (a) => a.userId === userId && a.platform === platform && a.handle === handle);
    if (existing) return existing;
    return this.store.insert('publishAccounts', { userId, platform, handle, accessToken, status: 'connected' });
  }

  disconnect(userId, accountId) {
    const a = this.store.get('publishAccounts', accountId);
    if (!a || a.userId !== userId) throw new ApiError(404, '연결된 계정을 찾을 수 없습니다.');
    return this.store.remove('publishAccounts', accountId);
  }

  accounts(userId) { return this.store.find('publishAccounts', (a) => a.userId === userId); }

  // 즉시 업로드 또는 예약. schedule: {at: ISO} 또는 {recurring: {days:['mon','wed','fri'], time:'10:00', tz}}
  schedule(userId, { clipId, accountIds, title, description = '', hashtags = [], schedule = null, language = 'ko' }) {
    const clip = this.store.get('clips', clipId);
    if (!clip || clip.userId !== userId) throw new ApiError(404, '클립을 찾을 수 없습니다.');
    if (!Array.isArray(accountIds) || !accountIds.length) throw new ApiError(400, '업로드할 SNS 계정을 선택해주세요.');
    const items = [];
    for (const accountId of accountIds) {
      const acc = this.store.get('publishAccounts', accountId);
      if (!acc || acc.userId !== userId) throw new ApiError(404, '연결된 계정을 찾을 수 없습니다.');
      const platform = PLATFORMS.find((p) => p.id === acc.platform);
      if (!platform.formats.includes(clip.ratio)) throw new ApiError(400, `${platform.name}은(는) ${clip.ratio} 비율을 지원하지 않습니다.`);
      const finalTitle = String(title || clip.title).slice(0, platform.maxTitle);
      if (schedule?.recurring) {
        const slots = nextOccurrences(schedule.recurring, 4);
        for (const at of slots) items.push(this._enqueue({ userId, clipId, accountId, platform: acc.platform, title: finalTitle, description, hashtags, language, scheduledAt: at, recurring: schedule.recurring }));
      } else {
        const at = schedule?.at ? new Date(schedule.at) : new Date();
        if (Number.isNaN(at.getTime())) throw new ApiError(400, '예약 시간이 올바르지 않습니다.');
        items.push(this._enqueue({ userId, clipId, accountId, platform: acc.platform, title: finalTitle, description, hashtags, language, scheduledAt: at.toISOString(), recurring: null }));
      }
    }
    this.tick();
    return items;
  }

  _enqueue(data) {
    return this.store.insert('publishQueue', { ...data, status: 'scheduled', result: null });
  }

  queue(userId) {
    return this.store.find('publishQueue', (q) => q.userId === userId).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  }

  cancel(userId, itemId) {
    const it = this.store.get('publishQueue', itemId);
    if (!it || it.userId !== userId) throw new ApiError(404, '예약을 찾을 수 없습니다.');
    if (it.status !== 'scheduled') throw new ApiError(409, '이미 처리된 예약입니다.');
    return this.store.update('publishQueue', itemId, { status: 'cancelled' });
  }

  // 스케줄러: 예약 시간이 지난 항목을 업로드 처리 (실제 API 연동 시 platform adapter 에서 처리)
  tick(now = new Date()) {
    const due = this.store.find('publishQueue', (q) => q.status === 'scheduled' && q.scheduledAt <= now.toISOString());
    for (const item of due) {
      const acc = this.store.get('publishAccounts', item.accountId);
      const clip = this.store.get('clips', item.clipId);
      const ok = Boolean(acc && clip);
      const result = ok
        ? { uploadedAt: now.toISOString(), url: `https://${item.platform}.example/${acc.handle}/${clip.id.slice(0, 8)}`, mode: acc.accessToken ? 'api' : 'simulated' }
        : { error: '계정 또는 클립이 삭제되었습니다.' };
      this.store.update('publishQueue', item.id, { status: ok ? 'published' : 'failed', result });
      this.notifications?.push(item.userId, { type: ok ? 'publish.done' : 'publish.failed', title: ok ? `${PLATFORMS.find((p) => p.id === item.platform).name} 업로드 완료` : '업로드 실패', body: item.title, link: '#/publish' });
      if (ok && item.recurring) {
        const [next] = nextOccurrences(item.recurring, 1, new Date(new Date(item.scheduledAt).getTime() + 60000));
        if (next) this._enqueue({ ...pick(item, ['userId', 'clipId', 'accountId', 'platform', 'title', 'description', 'hashtags', 'language', 'recurring']), scheduledAt: next });
      }
    }
    return due.length;
  }

  start(intervalMs = 30000) {
    if (this._timer) return;
    this._timer = setInterval(() => this.tick(), intervalMs);
    if (this._timer.unref) this._timer.unref();
  }

  stop() { if (this._timer) clearInterval(this._timer); this._timer = null; }
}

export function nextOccurrences({ days = ['mon', 'wed', 'fri'], time = '10:00' }, count = 4, from = new Date()) {
  const [hh, mm] = String(time).split(':').map(Number);
  const wanted = new Set(days.map((d) => DOW.indexOf(String(d).toLowerCase().slice(0, 3))).filter((d) => d >= 0));
  if (!wanted.size) throw new ApiError(400, '요일을 하나 이상 선택해주세요.');
  const out = [];
  const cur = new Date(from);
  cur.setSeconds(0, 0);
  for (let i = 0; i < 60 && out.length < count; i++) {
    const cand = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + i, hh, mm, 0, 0);
    if (wanted.has(cand.getDay()) && cand > from) out.push(cand.toISOString());
  }
  return out;
}

function pick(obj, keys) { return Object.fromEntries(keys.map((k) => [k, obj[k]])); }
