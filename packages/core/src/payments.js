// 실제 결제: 토스페이먼츠(국내 KRW, 결제창 v2 + 서버 승인) · Stripe Checkout(해외 USD). 키가 없으면 가짜 결제를 만들지 않고 503 으로 안내한다.
// 키는 서버 환경변수에서만 읽고 프론트에는 공개용 클라이언트 키만 내려보낸다.
import { randomBytes } from 'node:crypto';
import { ApiError } from './errors.js';
import { PLANS, ADDON_PLANS } from './credits.js';

// 토스페이먼츠 문서에 공개된 테스트 키(실제 청구 없음). 라이브 결제는 반드시 내 상점의 키를 환경변수로 넣어야 한다.
const TOSS_TEST_CLIENT = 'test_ck_D5GePWvyJnrK0W0k6q8gLzN97Eoq';
const TOSS_TEST_SECRET = 'test_sk_zXLkKEypNArWmo50nX3lmeaxYG5R';
const USD_RATE = Number(process.env.ALPHAMAN_USD_RATE || 1350);

export class PaymentService {
  constructor({ store, credits, notifications = null }) { this.store = store; this.credits = credits; this.notifications = notifications; }

  keys() {
    const tossClient = process.env.TOSS_CLIENT_KEY || (process.env.ALPHAMAN_PAYMENTS_TEST === 'off' ? null : TOSS_TEST_CLIENT);
    const tossSecret = process.env.TOSS_SECRET_KEY || (process.env.ALPHAMAN_PAYMENTS_TEST === 'off' ? null : TOSS_TEST_SECRET);
    return { tossClient, tossSecret, tossTest: !process.env.TOSS_CLIENT_KEY || String(tossClient).startsWith('test_'), stripeSecret: process.env.STRIPE_SECRET_KEY || null };
  }
  // 프론트에 내려보내는 공개 정보 (시크릿 키 없음)
  config() {
    const k = this.keys();
    return { toss: { enabled: Boolean(k.tossClient && k.tossSecret), clientKey: k.tossClient || null, testMode: Boolean(k.tossClient) && k.tossTest }, stripe: { enabled: Boolean(k.stripeSecret), testMode: Boolean(k.stripeSecret && k.stripeSecret.startsWith('sk_test_')) }, usdRate: USD_RATE };
  }
  plan(planId) { const p = [...PLANS, ...ADDON_PLANS.publish, ...ADDON_PLANS.topic].find((x) => x.id === planId); if (!p) throw new ApiError(404, '요금제를 찾을 수 없습니다.'); if (p.price === 0) throw new ApiError(400, '무료 요금제는 결제가 필요 없습니다.'); return p; }

  // 1) 주문 생성 (금액은 서버가 정한다 — 클라이언트가 보낸 금액은 승인 시 대조)
  createOrder(userId, { planId, region = 'domestic', method = 'card' }) {
    const plan = this.plan(planId);
    const user = this.store.get('users', userId);
    if (!user) throw new ApiError(401, '로그인이 필요합니다.');
    const currency = region === 'overseas' ? 'USD' : 'KRW';
    const amount = currency === 'USD' ? Math.round((plan.price / USD_RATE) * 100) / 100 : plan.price;
    const gateway = currency === 'USD' ? 'stripe' : 'toss';
    const k = this.keys();
    if (gateway === 'toss' && !(k.tossClient && k.tossSecret)) throw new ApiError(503, '국내 결제(토스페이먼츠)가 아직 설정되지 않았습니다. 관리자가 TOSS_CLIENT_KEY / TOSS_SECRET_KEY 를 설정해야 합니다.');
    if (gateway === 'stripe' && !k.stripeSecret) throw new ApiError(503, '해외 결제(Stripe)가 아직 설정되지 않았습니다. 관리자가 STRIPE_SECRET_KEY 를 설정해야 합니다.');
    const orderId = `am_${Date.now().toString(36)}_${randomBytes(6).toString('hex')}`;
    const order = this.store.insert('orders', { id: orderId, userId, planId, planName: plan.name, region, method, currency, amount, gateway, status: 'created', orderName: `AlphaMan ${plan.name}${plan.minutes ? ` (${plan.minutes}분)` : ''}`, customerKey: `am-user-${userId}`.slice(0, 50), customerEmail: user.email, customerName: user.name, testMode: gateway === 'toss' ? k.tossTest : Boolean(k.stripeSecret?.startsWith('sk_test_')) });
    return order;
  }
  orders(userId) { return this.store.find('orders', (o) => o.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  order(userId, orderId) { const o = this.store.get('orders', orderId); if (!o || o.userId !== userId) throw new ApiError(404, '주문을 찾을 수 없습니다.'); return o; }

  // 2-a) 토스페이먼츠 승인: 결제창 성공 리다이렉트로 받은 paymentKey/orderId/amount 를 서버가 시크릿 키로 승인
  async confirmToss(userId, { paymentKey, orderId, amount }) {
    const order = this.order(userId, orderId);
    if (order.status === 'paid') return this.store.get('payments', order.paymentId);
    if (Number(amount) !== Number(order.amount)) throw new ApiError(400, '결제 금액이 주문 금액과 다릅니다. 결제가 승인되지 않았습니다.');
    const k = this.keys();
    if (!k.tossSecret) throw new ApiError(503, '토스페이먼츠 시크릿 키가 설정되지 않았습니다.');
    const res = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
      method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${k.tossSecret}:`).toString('base64')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentKey, orderId, amount: Number(amount) }), signal: AbortSignal.timeout(20000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !['DONE', 'IN_PROGRESS', 'WAITING_FOR_DEPOSIT'].includes(data.status)) {
      this.store.update('orders', orderId, { status: 'failed', error: data.message || `승인 실패 (${res.status})`, gatewayCode: data.code || null });
      throw new ApiError(402, `결제 승인에 실패했습니다: ${data.message || res.status}`);
    }
    if (data.status === 'WAITING_FOR_DEPOSIT') { this.store.update('orders', orderId, { status: 'pending', paymentKey, gateway: 'toss', receiptUrl: data.receipt?.url || null }); return { pending: true, message: '가상계좌 입금 대기 중입니다. 입금이 확인되면 이용권이 지급됩니다.', order: this.order(userId, orderId) }; }
    return this._fulfill(order, { paymentKey, method: data.method || order.method, receiptUrl: data.receipt?.url || null, approvedAt: data.approvedAt || new Date().toISOString(), raw: { status: data.status, totalAmount: data.totalAmount, currency: data.currency, card: data.card ? { company: data.card.issuerCode, number: data.card.number } : null } });
  }

  // 2-b) Stripe Checkout 세션 생성 (호스팅 결제 페이지) → 성공 URL 에서 session_id 로 확인
  async createStripeSession(userId, { orderId, successUrl, cancelUrl }) {
    const order = this.order(userId, orderId);
    const k = this.keys(); if (!k.stripeSecret) throw new ApiError(503, 'Stripe 가 설정되지 않았습니다.');
    const params = new URLSearchParams({ mode: 'payment', 'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': 'usd', 'line_items[0][price_data][unit_amount]': String(Math.round(order.amount * 100)), 'line_items[0][price_data][product_data][name]': order.orderName, success_url: `${successUrl}${successUrl.includes('?') ? '&' : '?'}session_id={CHECKOUT_SESSION_ID}&orderId=${orderId}`, cancel_url: cancelUrl, client_reference_id: orderId, customer_email: order.customerEmail || '', 'metadata[orderId]': orderId, 'metadata[userId]': userId });
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { Authorization: `Bearer ${k.stripeSecret}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: params, signal: AbortSignal.timeout(20000) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(502, `Stripe 세션 생성 실패: ${data.error?.message || res.status}`);
    this.store.update('orders', orderId, { stripeSessionId: data.id });
    return { url: data.url, sessionId: data.id };
  }
  async confirmStripe(userId, { sessionId, orderId }) {
    const order = this.order(userId, orderId);
    if (order.status === 'paid') return this.store.get('payments', order.paymentId);
    const k = this.keys(); if (!k.stripeSecret) throw new ApiError(503, 'Stripe 가 설정되지 않았습니다.');
    if (order.stripeSessionId && order.stripeSessionId !== sessionId) throw new ApiError(400, '세션이 주문과 일치하지 않습니다.');
    const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, { headers: { Authorization: `Bearer ${k.stripeSecret}` }, signal: AbortSignal.timeout(20000) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(502, `Stripe 확인 실패: ${data.error?.message || res.status}`);
    if (data.payment_status !== 'paid') { this.store.update('orders', orderId, { status: 'pending' }); throw new ApiError(402, `아직 결제가 완료되지 않았습니다 (${data.payment_status}).`); }
    if (Math.round(order.amount * 100) !== Number(data.amount_total)) throw new ApiError(400, '결제 금액이 주문과 다릅니다.');
    return this._fulfill(order, { paymentKey: data.payment_intent || data.id, method: 'card', receiptUrl: null, approvedAt: new Date().toISOString(), raw: { amount_total: data.amount_total, currency: data.currency } });
  }

  // 3) 이행: 결제 기록 + 이용권 지급 + 요금제/부가 서비스 반영 (기존 checkout 과 같은 결과)
  _fulfill(order, info) {
    const plan = this.plan(order.planId);
    const payment = this.store.insert('payments', { userId: order.userId, orderId: order.id, planId: order.planId, region: order.region, method: info.method, currency: order.currency, amount: order.amount, status: 'paid', gateway: order.gateway, paymentKey: info.paymentKey, receiptUrl: info.receiptUrl, approvedAt: info.approvedAt, testMode: order.testMode, raw: info.raw });
    if (plan.minutes) this.credits.grant(order.userId, plan.minutes, `${plan.name} 요금제 결제`, { paymentId: payment.id });
    const user = this.store.get('users', order.userId);
    const addons = new Set(user?.addons || []);
    if (!plan.minutes) addons.add(plan.id.split('-')[0]);
    if (user) this.store.update('users', order.userId, { plan: plan.minutes ? plan.id : user.plan, addons: [...addons], planUpdatedAt: new Date().toISOString() });
    this.store.update('orders', order.id, { status: 'paid', paymentId: payment.id, paidAt: new Date().toISOString() });
    this.notifications?.push(order.userId, { type: 'payment.done', title: '결제 완료', body: `${plan.name} 결제가 완료되었습니다.${plan.minutes ? ` 이용권 ${plan.minutes}분이 지급되었어요.` : ''}`, link: '#/credits' });
    return payment;
  }

  // 토스 웹훅(입금 완료 등): 상태를 다시 조회해 반영
  async tossWebhook(body) {
    const orderId = body?.data?.orderId || body?.orderId; const status = body?.data?.status || body?.status;
    if (!orderId) return { ignored: true };
    const order = this.store.get('orders', orderId); if (!order) return { ignored: true };
    if (status === 'DONE' && order.status !== 'paid') { const k = this.keys(); const res = await fetch(`https://api.tosspayments.com/v1/payments/orders/${encodeURIComponent(orderId)}`, { headers: { Authorization: `Basic ${Buffer.from(`${k.tossSecret}:`).toString('base64')}` }, signal: AbortSignal.timeout(15000) }); const data = await res.json().catch(() => ({})); if (res.ok && data.status === 'DONE' && Number(data.totalAmount) === Number(order.amount)) this._fulfill(order, { paymentKey: data.paymentKey, method: data.method, receiptUrl: data.receipt?.url || null, approvedAt: data.approvedAt, raw: { status: data.status } }); }
    if (['CANCELED', 'EXPIRED', 'ABORTED'].includes(status)) this.store.update('orders', orderId, { status: 'failed', error: status });
    return { ok: true };
  }
  adminOrders() { return this.store.find('orders').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 500); }
}
