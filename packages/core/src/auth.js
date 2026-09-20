// 인증/계정: 이메일+비밀번호, Google 간편 로그인, 세션, 역할(admin/user), 관리자 전용 계정 시드
import { randomBytes, scryptSync, timingSafeEqual, randomUUID } from 'node:crypto';
import { ApiError } from './errors.js';

export const ADMIN_ACCOUNT = Object.freeze({
  email: 'hhudeu66@gmail.com',
  password: 'an1823037',
  name: '관리자',
  role: 'admin',
});

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30일
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
    });
    this.credits.grant(admin.id, 100000, '관리자 계정 기본 이용권', { by: 'system' });
    return admin;
  }

  publicUser(user) {
    if (!user) return null;
    const { passwordHash, ...rest } = user;
    return { ...rest, isAdmin: user.role === 'admin', credits: this.credits.balance(user.id) };
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
    const token = randomUUID() + randomBytes(16).toString('hex');
    this.store.insert('sessions', { token, userId: user.id, expiresAt: Date.now() + SESSION_TTL_MS });
    this.store.update('users', user.id, { lastLoginAt: new Date().toISOString() });
    return { token, user: this.publicUser(user) };
  }

  logout(token) {
    const s = this.store.findOne('sessions', (x) => x.token === token);
    if (s) this.store.remove('sessions', s.id);
    return true;
  }

  userFromToken(token) {
    if (!token) return null;
    const s = this.store.findOne('sessions', (x) => x.token === token);
    if (!s) return null;
    if (s.expiresAt < Date.now()) { this.store.remove('sessions', s.id); return null; }
    const user = this.store.get('users', s.userId);
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
