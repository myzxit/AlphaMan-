// 고객 지원: 관리자에게 문의하기(채팅 → 관리자 전달, 24시간 내 답변), 의견 보내기, 팀 계정 문의, 알림
import { ApiError } from './errors.js';
import { isValidEmail, normalizeEmail } from './auth.js';

export class NotificationService {
  constructor(store) { this.store = store; }

  push(userId, { type, title, body, link = null }) {
    return this.store.insert('notifications', { userId, type, title, body, link, read: false });
  }

  list(userId, { unreadOnly = false } = {}) {
    return this.store.find('notifications', (n) => n.userId === userId && (!unreadOnly || !n.read)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
  }

  markRead(userId, ids = null) {
    for (const n of this.store.find('notifications', (x) => x.userId === userId && !x.read && (!ids || ids.includes(x.id)))) this.store.update('notifications', n.id, { read: true });
    return true;
  }

  remove(userId, ids = null) {
    let n = 0;
    for (const x of this.store.find('notifications', (r) => r.userId === userId && (!ids || ids.includes(r.id)))) { this.store.remove('notifications', x.id); n += 1; }
    return n;
  }
  broadcast({ title, body, link = null }) {
    for (const u of this.store.find('users')) this.push(u.id, { type: 'notice', title, body, link });
  }
}

export class SupportService {
  constructor({ store, notifications }) { this.store = store; this.notifications = notifications; }

  // 문의하기 (비로그인 시 답변 받을 이메일 필수). transcript: 챗봇 대화 내용을 관리자에게 함께 전달.
  createInquiry({ user = null, email, message, transcript = [], category = 'general', extra = '' }) {
    if (!message || !String(message).trim()) throw new ApiError(400, '문의 내용을 입력해주세요.');
    let replyEmail = user?.email;
    if (!user) {
      replyEmail = normalizeEmail(email);
      if (!isValidEmail(replyEmail)) throw new ApiError(400, '비로그인 상태에서는 답변 받을 이메일을 입력해주세요.');
    }
    const inquiry = this.store.insert('inquiries', {
      userId: user?.id || null, email: replyEmail, category, message: String(message).trim(), extra: String(extra || ''), transcript,
      status: 'open', messages: [{ from: 'user', text: String(message).trim(), at: new Date().toISOString() }], slaHours: 24,
    });
    for (const admin of this.store.find('users', (u) => u.role === 'admin')) {
      this.notifications.push(admin.id, { type: 'inquiry.new', title: '새 문의가 도착했습니다', body: inquiry.message.slice(0, 80), link: `#/admin/inquiries/${inquiry.id}` });
    }
    return inquiry;
  }

  myInquiries(userId) { return this.store.find('inquiries', (i) => i.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }

  addUserMessage(userId, inquiryId, text) {
    const inq = this.store.get('inquiries', inquiryId);
    if (!inq || inq.userId !== userId) throw new ApiError(404, '문의를 찾을 수 없습니다.');
    return this.store.update('inquiries', inquiryId, (i) => ({ status: 'open', messages: [...i.messages, { from: 'user', text: String(text), at: new Date().toISOString() }] }));
  }

  adminReply(admin, inquiryId, text) {
    const inq = this.store.get('inquiries', inquiryId);
    if (!inq) throw new ApiError(404, '문의를 찾을 수 없습니다.');
    const updated = this.store.update('inquiries', inquiryId, (i) => ({ status: 'answered', answeredBy: admin.id, messages: [...i.messages, { from: 'admin', text: String(text), at: new Date().toISOString() }] }));
    if (inq.userId) this.notifications.push(inq.userId, { type: 'inquiry.answered', title: '문의에 답변이 도착했습니다', body: String(text).slice(0, 80), link: `#/support/${inquiryId}` });
    return updated;
  }

  closeInquiry(inquiryId) { return this.store.update('inquiries', inquiryId, { status: 'closed' }); }

  allInquiries({ status = null } = {}) {
    return this.store.find('inquiries', (i) => !status || i.status === status).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  // 의견 보내기 (픽셀링 "의견 보내기")
  feedback({ user = null, email = '', message, page = '', rating = null }) {
    if (!message || !String(message).trim()) throw new ApiError(400, '의견을 입력해주세요.');
    return this.store.insert('feedback', { userId: user?.id || null, email: user?.email || normalizeEmail(email), message: String(message).trim(), page, rating });
  }

  // 팀 계정 문의 (support@ 이메일 대신 인앱 접수)
  teamRequest({ user, company, seats, message }) {
    if (!(Number(seats) >= 2)) throw new ApiError(400, '팀 인원은 2명 이상이어야 합니다.');
    const req = this.store.insert('teamRequests', { userId: user.id, email: user.email, company: String(company || ''), seats: Number(seats), message: String(message || ''), status: 'pending' });
    for (const admin of this.store.find('users', (u) => u.role === 'admin')) this.notifications.push(admin.id, { type: 'team.request', title: '팀 계정 문의', body: `${user.email} · ${seats}석`, link: '#/admin/teams' });
    return req;
  }
}
