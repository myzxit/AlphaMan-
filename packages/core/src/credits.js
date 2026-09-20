// 이용권(분 단위) 원장 - "원본 영상 길이만큼 이용권이 차감"되는 알파컷 과금 방식
import { ApiError } from './errors.js';

export const PLANS = [
  { id: 'free', name: '무료', price: 0, minutes: 30, period: 'once', features: ['30분 무료 이용권', '링크만 넣으면 자동 쇼츠 제작', 'SNS 업로드 자동화', '워터마크 없음'] },
  { id: 'starter', name: '스타터', price: 19000, minutes: 120, period: 'month', features: ['월 120분', '모든 템플릿', '자동 자막 + 애니메이션', 'SNS 예약 업로드'] },
  { id: 'pro', name: '프로', price: 49000, minutes: 400, period: 'month', popular: true, features: ['월 400분', '화자 추적 + 다이나믹 줌', 'AI 후킹 보이스', '다국어 번역', '알파토픽 채널 분석'] },
  { id: 'business', name: '비즈니스', price: 149000, minutes: 1500, period: 'month', features: ['월 1,500분', '팀 계정(이용권 공유)', '대량 자동 처리', '우선 처리', '전담 지원'] },
];

// 부가 서비스 요금제 (publish-pricing, topic-pricing)
export const ADDON_PLANS = {
  publish: [
    { id: 'publish-basic', name: 'SNS 업로드 베이직', price: 9900, period: 'month', features: ['채널 3개 연결', '예약 업로드 무제한', '유튜브·인스타·틱톡·스레드·페이스북'] },
    { id: 'publish-agency', name: 'SNS 업로드 에이전시', price: 39000, period: 'month', features: ['채널 20개 연결', '클라이언트 워크스페이스', '업로드 리포트'] },
  ],
  topic: [
    { id: 'topic-basic', name: '알파토픽 베이직', price: 14900, period: 'month', features: ['내 채널 분석', '주간 떡상 주제 20개', '썸네일·대본 추천'] },
    { id: 'topic-pro', name: '알파토픽 프로', price: 39000, period: 'month', features: ['경쟁 채널 5개 비교', '일간 주제 추천', '대본 전체 생성'] },
  ],
};

export const REFERRAL_REWARD_MINUTES = 30; // 추천인·피추천인 각각 30분

export class CreditService {
  constructor(store) {
    this.store = store;
  }

  // 관리자 계정은 이용권 무제한: 잔액 조회는 Infinity, 차감은 기록만 남기고 잔액을 줄이지 않는다.
  isUnlimited(userId) {
    const user = this.store.get('users', userId);
    return Boolean(user && (user.role === 'admin' || user.unlimitedCredits));
  }

  balance(userId) {
    if (this.isUnlimited(userId)) return Infinity;
    const rec = this.store.findOne('credits', (c) => c.userId === userId);
    return rec ? Math.max(0, Math.round(rec.minutes * 100) / 100) : 0;
  }

  // API/UI 용 표현: 무제한이면 { credits: null, creditsUnlimited: true }
  summary(userId) {
    const unlimited = this.isUnlimited(userId);
    return { credits: unlimited ? null : this.balance(userId), creditsUnlimited: unlimited };
  }

  _ensure(userId) {
    let rec = this.store.findOne('credits', (c) => c.userId === userId);
    if (!rec) rec = this.store.insert('credits', { userId, minutes: 0 });
    return rec;
  }

  grant(userId, minutes, reason, meta = {}) {
    if (!(minutes > 0)) throw new ApiError(400, '지급할 이용권은 0보다 커야 합니다.');
    const rec = this._ensure(userId);
    this.store.update('credits', rec.id, { minutes: rec.minutes + minutes });
    this.store.insert('creditLedger', { userId, delta: minutes, reason, ...meta });
    return this.balance(userId);
  }

  charge(userId, minutes, reason, meta = {}) {
    if (this.isUnlimited(userId)) {
      this.store.insert('creditLedger', { userId, delta: 0, wouldCharge: -minutes, reason: `${reason} (무제한 계정)`, ...meta });
      return Infinity;
    }
    const rec = this._ensure(userId);
    if (rec.minutes < minutes) {
      throw new ApiError(402, `이용권이 부족합니다. 필요: ${minutes.toFixed(1)}분, 보유: ${rec.minutes.toFixed(1)}분`, { required: minutes, balance: rec.minutes });
    }
    this.store.update('credits', rec.id, { minutes: rec.minutes - minutes });
    this.store.insert('creditLedger', { userId, delta: -minutes, reason, ...meta });
    return this.balance(userId);
  }

  ledger(userId) {
    return this.store.find('creditLedger', (l) => l.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  applyReferral(newUserId, code) {
    const referrer = this.store.findOne('users', (u) => u.referralCode === String(code).toUpperCase());
    if (!referrer || referrer.id === newUserId) return null;
    if (this.store.findOne('referrals', (r) => r.referredUserId === newUserId)) return null;
    this.store.insert('referrals', { referrerId: referrer.id, referredUserId: newUserId, reward: REFERRAL_REWARD_MINUTES });
    this.grant(referrer.id, REFERRAL_REWARD_MINUTES, '추천인 보상', { by: 'referral' });
    this.grant(newUserId, REFERRAL_REWARD_MINUTES, '추천 가입 보상', { by: 'referral' });
    return referrer.id;
  }

  referralSummary(userId) {
    const user = this.store.get('users', userId);
    const referred = this.store.find('referrals', (r) => r.referrerId === userId);
    return {
      code: user?.referralCode,
      link: `/?ref=${user?.referralCode}`,
      rewardMinutes: REFERRAL_REWARD_MINUTES,
      invited: referred.length,
      earnedMinutes: referred.reduce((s, r) => s + r.reward, 0),
    };
  }

  // 결제: 국내(토스) / 해외 카드 전용 페이지
  checkout(userId, { planId, region = 'domestic', method = 'card' }) {
    const plan = [...PLANS, ...ADDON_PLANS.publish, ...ADDON_PLANS.topic].find((p) => p.id === planId);
    if (!plan) throw new ApiError(404, '요금제를 찾을 수 없습니다.');
    if (plan.price === 0) throw new ApiError(400, '무료 요금제는 결제가 필요 없습니다.');
    const currency = region === 'overseas' ? 'USD' : 'KRW';
    const amount = region === 'overseas' ? Math.round(plan.price / 1350 * 100) / 100 : plan.price;
    const payment = this.store.insert('payments', {
      userId, planId, region, method, currency, amount, status: 'paid',
      gateway: region === 'overseas' ? 'overseas-card' : 'toss',
    });
    if (plan.minutes) this.grant(userId, plan.minutes, `${plan.name} 요금제 결제`, { paymentId: payment.id });
    const user = this.store.get('users', userId);
    const addons = new Set(user.addons || []);
    if (!plan.minutes) addons.add(plan.id.split('-')[0]);
    this.store.update('users', userId, { plan: plan.minutes ? plan.id : user.plan, addons: [...addons], planUpdatedAt: new Date().toISOString() });
    return payment;
  }

  payments(userId) {
    return this.store.find('payments', (p) => p.userId === userId);
  }
}
