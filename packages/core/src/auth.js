// 인증/계정: 이메일+비밀번호, Google 간편 로그인, 세션, 역할(admin/user), 관리자 전용 계정 시드
import { randomBytes, scryptSync, timingSafeEqual, createHmac, createHash } from 'node:crypto';
import { ApiError } from './errors.js';

export const ADMIN_ACCOUNT = Object.freeze({
  email: 'hhudeu66@gmail.com',
  password: 'an1823037',
  name: '관리자',
  role: 'admin',
});

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30일
export const ADMIN_USER_ID = 'user-admin-hhudeu66'; // 인스턴스(서버리스)마다 같은 ID 를 갖도록 고정

// 세션 토큰은 서명된 자체 포함 토큰이라 서버 인스턴스가 여러 개(서버리스)여도 어디서나 검증된다.
function sessionSecret() {
  return process.env.ALPHAMAN_SECRET || createHash('sha256').update(`alphaman-session:${ADMIN_ACCOUNT.password}`).digest('hex');
}
const b64u = (buf) => Buffer.from(buf).toString('base64url');
function sign(payload) {
  const body = b64u(JSON.stringify(payload));
  const sig = createHmac('sha256', sessionSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}
export function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', sessionSecret()).update(body).digest('base64url');
  if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  try { const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); return payload.exp > Date.now() ? payload : null; } catch { return null; }
}
const FREE_SIGNUP_MINUTES = 30; // 회원가입 시 무료 이용권 30분

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const candidate = scryptSync(String(password), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function referralCodeFor(seed) {
  return seed.replace(/[^a-z0-9]/gi, '').slice(0, 5).toUpperCase() + randomBytes(2).toString('hex').toUpperCase();
}

export class AuthService {
  constructor(store, credits) {
    this.store = store;
    this.credits = credits;
  }

  seedAdmin() {
    const existing = this.store.findOne('users', (u) => u.email === ADMIN_ACCOUNT.email);
    if (existing) {
      if (existing.role !== 'admin') this.store.update('users', existing.id, { role: 'admin' });
      return existing;
    }
    const admin = this.store.insert('users', {
      id: ADMIN_USER_ID,
      email: ADMIN_ACCOUNT.email,
      name: ADMIN_ACCOUNT.name,
      passwordHash: hashPassword(ADMIN_ACCOUNT.password),
      role: 'admin',
      provider: 'password',
      locale: 'ko',
      theme: 'system',
      referralCode: 'ADMIN0001',
      status: 'active',
      isSeededAdmin: true,
      unlimitedCredits: true,
    });
    return admin;
  }

  publicUser(user) {
    if (!user) return null;
    const { passwordHash, altPasswordHashes, ...rest } = user;
    return { ...rest, isAdmin: user.role === 'admin', ...this.credits.summary(user.id) };
  }

  signup({ email, password, name, referral, locale = 'ko' }) {
    email = normalizeEmail(email);
    if (!isValidEmail(email)) throw new ApiError(400, '올바른 이메일을 입력해주세요.');
    if (!password || String(password).length < 6) throw new ApiError(400, '비밀번호는 6자 이상이어야 합니다.');
    if (this.store.findOne('users', (u) => u.email === email)) throw new ApiError(409, '이미 가입된 이메일입니다.');
    const user = this.store.insert('users', {
      email,
      name: (name || email.split('@')[0]).trim(),
      passwordHash: hashPassword(password),
      role: 'user',
      provider: 'password',
      locale,
      theme: 'system',
      referralCode: referralCodeFor(email),
      status: 'active',
    });
    this.credits.grant(user.id, FREE_SIGNUP_MINUTES, '회원가입 무료 이용권 30분', { by: 'system' });
    if (referral) this.credits.applyReferral(user.id, referral);
    return this.createSession(user);
  }

  login({ email, password }) {
    email = normalizeEmail(email);
    // 같은 이메일 레코드가 여러 개(서버 인스턴스 병합 전 중복 가입)여도 비밀번호가 맞는 레코드로 로그인한다
    const candidates = this.store.find('users', (u) => u.email === email);
    if (!candidates.length) throw new ApiError(401, '가입된 이메일이 아닙니다. 이메일을 확인하거나 무료로 가입해주세요. (저장소 전환 이전에 만든 계정은 남아 있지 않을 수 있습니다)');
    const matches = (u) => (u.passwordHash && verifyPassword(password, u.passwordHash)) || (u.altPasswordHashes || []).some((h) => verifyPassword(password, h));
    const user = candidates.find(matches);
    if (!user) {
      const social = candidates.find((u) => !u.passwordHash && u.provider && u.provider !== 'password');
      if (social) throw new ApiError(401, `이 이메일은 ${social.provider} 간편 로그인으로 가입된 계정입니다. 같은 방법으로 로그인해주세요.`);
      throw new ApiError(401, '비밀번호가 올바르지 않습니다. 비밀번호를 잊으셨다면 로그인 화면의 "비밀번호 재설정 요청"을 이용하세요.');
    }
    if (user.status === 'banned') throw new ApiError(403, '이용이 제한된 계정입니다. 관리자에게 문의하세요.');
    // 병합 시 보관된 다른 비밀번호로 로그인했다면 그 비밀번호를 기본으로 승격한다
    if (!(user.passwordHash && verifyPassword(password, user.passwordHash))) this.store.update('users', user.id, { passwordHash: hashPassword(password), altPasswordHashes: [] });
    return this.createSession(user);
  }

  // 비밀번호 재설정 요청 (이메일 발송 없이 운영): 관리자에게 문의로 전달되고, 관리자가 초기화한다
  requestPasswordReset({ email, support }) {
    email = normalizeEmail(email);
    if (!isValidEmail(email)) throw new ApiError(400, '올바른 이메일을 입력해주세요.');
    const user = this.store.findOne('users', (u) => u.email === email);
    if (!user) throw new ApiError(404, '가입된 이메일이 아닙니다.');
    if (support) support.createInquiry({ user, email, category: 'account', message: `[비밀번호 재설정 요청] ${email} 계정의 비밀번호 초기화를 요청했습니다.` });
    this.store.insert('auditLog', { userId: user.id, action: 'auth.password.reset-request' });
    return { ok: true, message: '관리자에게 재설정 요청을 전달했습니다. 확인 후 임시 비밀번호를 문의 답변(픽시 채팅·알림)으로 알려드립니다.' };
  }

  // Google 간편 로그인: 클라이언트가 확인한 프로필(email, name, sub)을 받아 계정을 만들거나 연결한다.
  loginWithGoogle({ email, name, sub }) {
    email = normalizeEmail(email);
    if (!isValidEmail(email)) throw new ApiError(400, 'Google 계정 이메일이 필요합니다.');
    let user = this.store.findOne('users', (u) => u.email === email);
    if (!user) {
      user = this.store.insert('users', {
        email,
        name: name || email.split('@')[0],
        passwordHash: null,
        role: 'user',
        provider: 'google',
        googleSub: sub || null,
        locale: 'ko',
        theme: 'system',
        referralCode: referralCodeFor(email),
        status: 'active',
      });
      this.credits.grant(user.id, FREE_SIGNUP_MINUTES, '회원가입 무료 이용권 30분', { by: 'system' });
    }
    return this.createSession(user);
  }

  createSession(user) {
    const exp = Date.now() + SESSION_TTL_MS;
    const token = sign({ uid: user.id, email: user.email, name: user.name, role: user.role, exp, n: randomBytes(4).toString('hex') });
    this.store.update('users', user.id, { lastLoginAt: new Date().toISOString() });
    return { token, user: this.publicUser(user) };
  }

  logout(token) {
    const payload = verifySessionToken(token);
    if (payload) this.store.insert('sessions', { revoked: token.slice(-32), userId: payload.uid, expiresAt: payload.exp });
    return true;
  }

  userFromToken(token) {
    const payload = verifySessionToken(token);
    if (!payload) return null;
    if (this.store.findOne('sessions', (x) => x.revoked === token.slice(-32))) return null;
    let user = this.store.get('users', payload.uid) || this.store.findOne('users', (u) => u.email === payload.email);
    if (!user && payload.email === ADMIN_ACCOUNT.email) user = this.seedAdmin();
    // 서버리스: 방금 가입한 사용자가 아직 이 인스턴스의 저장소에 동기화되지 않았을 수 있다.
    // 서명이 유효하면 토큰의 정보로 임시 사용자 객체를 만들어 "로그인이 필요합니다" 오류 대신 정상 응답한다 (저장하지는 않음).
    if (!user && payload.uid && payload.email) {
      user = { id: payload.uid, email: payload.email, name: payload.name || payload.email.split('@')[0], role: payload.role === 'admin' ? 'user' : (payload.role || 'user'), status: 'active', locale: 'ko', theme: 'system', referralCode: '', createdAt: new Date().toISOString(), transient: true };
    }
    if (!user || user.status === 'banned') return null;
    return user;
  }

  updateProfile(userId, patch) {
    const allowed = ['name', 'locale', 'theme', 'channelUrl', 'phone', 'marketingOptIn'];
    const safe = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k)).map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 200) : v]));
    if (patch.prefs && typeof patch.prefs === 'object') {
      const user = this.store.get('users', userId);
      const PREF_KEYS = ['autosave', 'notifications', 'notifyEmail', 'defaultRatio', 'defaultSubtitlePreset', 'quality', 'shortcuts', 'privacyAnalytics', 'shareDefaultDays', 'language', 'reduceMotion', 'mobileEditor'];
      const prefs = { ...(user?.prefs || {}) };
      for (const k of PREF_KEYS) if (patch.prefs[k] !== undefined) prefs[k] = typeof patch.prefs[k] === 'string' ? patch.prefs[k].slice(0, 100) : patch.prefs[k];
      safe.prefs = prefs;
    }
    return this.publicUser(this.store.update('users', userId, safe));
  }

  changePassword(userId, { currentPassword, newPassword }) {
    const user = this.store.get('users', userId);
    if (!user) throw new ApiError(404, '사용자를 찾을 수 없습니다.');
    const okCur = (user.passwordHash && verifyPassword(currentPassword, user.passwordHash)) || (user.altPasswordHashes || []).some((h) => verifyPassword(currentPassword, h));
    if (user.passwordHash && !okCur) throw new ApiError(401, '현재 비밀번호가 올바르지 않습니다.');
    if (!newPassword || newPassword.length < 6) throw new ApiError(400, '새 비밀번호는 6자 이상이어야 합니다.');
    this.store.update('users', userId, { passwordHash: hashPassword(newPassword), altPasswordHashes: [] });
    return true;
  }

  requireAdmin(user) {
    if (!user || user.role !== 'admin') throw new ApiError(403, '관리자 전용 기능입니다.');
    return user;
  }
}
