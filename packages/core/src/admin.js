// 관리자 전용 기능: 대시보드 통계, 사용자/이용권 관리, 문의 답변, 공지, 피드백, 팀 요청, 작업 모니터링, 시스템 설정
import { ApiError } from './errors.js';
import { hashPassword } from './auth.js';

export class AdminService {
  constructor({ store, credits, auth, support, notifications, publish }) {
    this.store = store; this.credits = credits; this.auth = auth; this.support = support; this.notifications = notifications; this.publish = publish;
  }

  stats() {
    const users = this.store.find('users');
    const jobs = this.store.find('jobs');
    const clips = this.store.find('clips');
    const dayAgo = new Date(Date.now() - 86400e3).toISOString();
    return {
      users: { total: users.length, admins: users.filter((u) => u.role === 'admin').length, new24h: users.filter((u) => u.createdAt >= dayAgo).length, banned: users.filter((u) => u.status === 'banned').length },
      shorts: { jobs: jobs.length, clips: clips.length, processing: jobs.filter((j) => j.status === 'processing' || j.status === 'queued').length, failed: jobs.filter((j) => j.status === 'failed').length, minutesProcessed: Math.round(jobs.reduce((s, j) => s + (j.minutesCharged || 0), 0)) },
      subtitles: { projects: this.store.count('subtitleProjects') },
      longform: { jobs: this.store.count('longformJobs') },
      remix: { jobs: this.store.count('remixJobs'), done: this.store.count('remixJobs', (j) => j.status === 'done') },
      voice: { profiles: this.store.count('voiceProfiles'), renders: this.store.count('voiceRenders') },
      publish: { queued: this.store.count('publishQueue', (q) => q.status === 'scheduled'), published: this.store.count('publishQueue', (q) => q.status === 'published') },
      support: { openInquiries: this.store.count('inquiries', (i) => i.status === 'open'), feedback: this.store.count('feedback'), teamRequests: this.store.count('teamRequests', (t) => t.status === 'pending') },
      revenue: { paymentsKRW: this.store.find('payments', (p) => p.currency === 'KRW').reduce((s, p) => s + p.amount, 0), paymentsUSD: this.store.find('payments', (p) => p.currency === 'USD').reduce((s, p) => s + p.amount, 0), count: this.store.count('payments') },
      credits: { outstandingMinutes: Math.round(this.store.find('credits').reduce((s, c) => s + c.minutes, 0)) },
    };
  }

  users({ q = '', page = 1, limit = 50 } = {}) {
    const needle = String(q).toLowerCase();
    const list = this.store.find('users', (u) => !needle || u.email.includes(needle) || (u.name || '').toLowerCase().includes(needle))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((u) => ({ ...this.auth.publicUser(u), jobs: this.store.count('jobs', (j) => j.userId === u.id), subtitleProjects: this.store.count('subtitleProjects', (p) => p.userId === u.id) }));
    const p = Math.max(1, Number(page)); const l = Math.max(1, Math.min(200, Number(limit)));
    return { items: list.slice((p - 1) * l, p * l), total: list.length, page: p, limit: l };
  }

  user(id) {
    const u = this.store.get('users', id);
    if (!u) throw new ApiError(404, '사용자를 찾을 수 없습니다.');
    return { ...this.auth.publicUser(u), ledger: this.credits.ledger(id), payments: this.credits.payments(id), jobs: this.store.find('jobs', (j) => j.userId === id), inquiries: this.store.find('inquiries', (i) => i.userId === id) };
  }

  updateUser(admin, id, patch) {
    const u = this.store.get('users', id);
    if (!u) throw new ApiError(404, '사용자를 찾을 수 없습니다.');
    const safe = {};
    if (patch.role && ['admin', 'user'].includes(patch.role)) {
      if (u.isSeededAdmin && patch.role !== 'admin') throw new ApiError(400, '기본 관리자 계정의 권한은 변경할 수 없습니다.');
      safe.role = patch.role;
    }
    if (patch.status && ['active', 'banned'].includes(patch.status)) {
      if (u.id === admin.id) throw new ApiError(400, '자기 자신을 정지할 수 없습니다.');
      safe.status = patch.status;
    }
    if (patch.name) safe.name = String(patch.name);
    if (patch.plan) safe.plan = String(patch.plan);
    if (patch.newPassword) safe.passwordHash = hashPassword(patch.newPassword);
    this.store.insert('auditLog', { userId: admin.id, action: 'admin.user.update', targetId: id, patch: Object.keys(safe) });
    return this.auth.publicUser(this.store.update('users', id, safe));
  }

  grantCredits(admin, id, minutes, reason = '관리자 지급') {
    if (!this.store.get('users', id)) throw new ApiError(404, '사용자를 찾을 수 없습니다.');
    const balance = this.credits.grant(id, Number(minutes), reason, { by: admin.id });
    this.notifications.push(id, { type: 'credits.granted', title: '이용권이 지급되었습니다', body: `${minutes}분 (${reason})` });
    this.store.insert('auditLog', { userId: admin.id, action: 'admin.credits.grant', targetId: id, minutes });
    return { balance };
  }

  revokeCredits(admin, id, minutes, reason = '관리자 회수') {
    const balance = this.credits.charge(id, Number(minutes), reason, { by: admin.id });
    this.store.insert('auditLog', { userId: admin.id, action: 'admin.credits.revoke', targetId: id, minutes });
    return { balance };
  }

  deleteUser(admin, id) {
    const u = this.store.get('users', id);
    if (!u) throw new ApiError(404, '사용자를 찾을 수 없습니다.');
    if (u.isSeededAdmin) throw new ApiError(400, '기본 관리자 계정은 삭제할 수 없습니다.');
    for (const c of ['sessions', 'jobs', 'clips', 'subtitleProjects', 'longformJobs', 'remixJobs', 'voiceProfiles', 'voiceRenders', 'library', 'publishAccounts', 'publishQueue', 'topicReports', 'notifications', 'pixieThreads', 'credits']) {
      for (const rec of this.store.find(c, (r) => r.userId === id)) this.store.remove(c, rec.id);
    }
    this.store.remove('users', id);
    this.store.insert('auditLog', { userId: admin.id, action: 'admin.user.delete', targetId: id });
    return true;
  }

  jobs({ status = null, limit = 100 } = {}) {
    return this.store.find('jobs', (j) => !status || j.status === status).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit)
      .map((j) => ({ ...j, userEmail: this.store.get('users', j.userId)?.email || null, clipCount: j.clipIds.length }));
  }

  inquiries(opts) { return this.support.allInquiries(opts).map((i) => ({ ...i, userEmail: i.userId ? this.store.get('users', i.userId)?.email : i.email })); }
  replyInquiry(admin, id, text) { return this.support.adminReply(admin, id, text); }
  closeInquiry(id) { return this.support.closeInquiry(id); }

  feedback() { return this.store.find('feedback').sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }

  teamRequests() { return this.store.find('teamRequests').sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  resolveTeamRequest(admin, id, { status, seats, minutes }) {
    const req = this.store.get('teamRequests', id);
    if (!req) throw new ApiError(404, '팀 요청을 찾을 수 없습니다.');
    const updated = this.store.update('teamRequests', id, { status: status || 'approved', resolvedBy: admin.id });
    if ((status || 'approved') === 'approved') {
      this.store.update('users', req.userId, { plan: 'business', teamSeats: Number(seats || req.seats) });
      if (minutes) this.credits.grant(req.userId, Number(minutes), '팀 계정 이용권', { by: admin.id });
      this.notifications.push(req.userId, { type: 'team.approved', title: '팀 계정이 승인되었습니다', body: `${seats || req.seats}석 이용권 공유가 활성화됐어요.` });
    }
    return updated;
  }

  notices() { return this.store.find('notices').sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  createNotice(admin, { title, body, level = 'info', pinned = false, broadcast = false }) {
    if (!title || !body) throw new ApiError(400, '제목과 내용을 입력해주세요.');
    const n = this.store.insert('notices', { title, body, level, pinned, authorId: admin.id, active: true });
    if (broadcast) this.notifications.broadcast({ title, body, link: '#/notices' });
    return n;
  }
  updateNotice(id, patch) { const n = this.store.update('notices', id, patch); if (!n) throw new ApiError(404, '공지를 찾을 수 없습니다.'); return n; }
  deleteNotice(id) { return this.store.remove('notices', id); }

  settings() {
    return {
      signupBonusMinutes: this.store.setting('signupBonusMinutes', 30),
      referralRewardMinutes: this.store.setting('referralRewardMinutes', 30),
      maintenance: this.store.setting('maintenance', false),
      maintenanceMessage: this.store.setting('maintenanceMessage', ''),
      tiktokDownloadNotice: this.store.setting('tiktokDownloadNotice', true),
      allowSignup: this.store.setting('allowSignup', true),
    };
  }
  updateSettings(admin, patch) {
    for (const [k, v] of Object.entries(patch)) if (k in this.settings()) this.store.setSetting(k, v);
    this.store.insert('auditLog', { userId: admin.id, action: 'admin.settings.update', patch: Object.keys(patch) });
    return this.settings();
  }

  auditLog(limit = 200) { return this.store.find('auditLog').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit); }
  publishQueue() { return this.store.find('publishQueue').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200); }
  payments() { return this.store.find('payments').sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
}
