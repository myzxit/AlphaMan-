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
    const { passwordHash, ...rest } = user;
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
    const user = this.store.findOne('users', (u) => u.email === email);
    if (!user || !verifyPassword(password, user.passwordHash)) throw new ApiError(401, '이메일 또는 비밀번호가 올바르지 않습니다.');
    if (user.status === 'banned') throw new ApiError(403, '이용이 제한된 계정입니다. 관리자에게 문의하세요.');
    return this.createSession(user);
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
    const token = sign({ uid: user.id, email: user.email, role: user.role, exp, n: randomBytes(4).toString('hex') });
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
    if (!user || user.status === 'banned') return null;
    return user;
  }

  updateProfile(userId, patch) {
    const allowed = ['name', 'locale', 'theme', 'channelUrl', 'phone', 'marketingOptIn'];
    const safe = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k)));
    return this.publicUser(this.store.update('users', userId, safe));
  }

  changePassword(userId, { currentPassword, newPassword }) {
    const user = this.store.get('users', userId);
    if (!user) throw new ApiError(404, '사용자를 찾을 수 없습니다.');
    if (user.passwordHash && !verifyPassword(currentPassword, user.passwordHash)) throw new ApiError(401, '현재 비밀번호가 올바르지 않습니다.');
    if (!newPassword || newPassword.length < 6) throw new ApiError(400, '새 비밀번호는 6자 이상이어야 합니다.');
    this.store.update('users', userId, { passwordHash: hashPassword(newPassword) });
    return true;
  }

  requireAdmin(user) {
    if (!user || user.role !== 'admin') throw new ApiError(403, '관리자 전용 기능입니다.');
    return user;
  }
}
