// 공개 페이지: 랜딩(알파컷 전체 섹션), 로그인/가입, 가격, 가이드, FAQ, 무료 도구, 추천인, 팀, 법적 정보, 다운로드, 공지
import { get, post, setToken } from './api.js';
import { esc, html, raw, toast, modal, fmtKRW, creditsLabel, readVideoMeta, qs, qsa } from './ui.js';
import { startShortsFromLanding } from './pages-app.js';

const genreIcons = { education: '🎓', interview: '🎙️', info: '📰', gaming: '🎮', vlog: '🌿' };

export async function landing({ view, state, navigate }) {
  const c = state.info.content;
  const tpl = await get('/api/shorts/templates');
  view.innerHTML = html`
    <section class="hero">
      <div class="badge" style="margin-bottom:14px">${c.hero.badge}</div>
      <h1>${c.hero.title}<br/><span style="color:var(--primary)">AI 하이라이트 쇼츠 자동 제작</span></h1>
      <div class="chips" style="justify-content:center;margin-bottom:12px">${raw(c.hero.chips.map((x) => `<span class="chip">${esc(x)}</span>`).join(''))}</div>
      <p class="lead">${c.hero.subtitle}</p>
      <div class="card hero-box">
        <div class="tabs" id="hero-tabs"><button class="tab active" data-tab="youtube">유튜브 링크</button><button class="tab" data-tab="file">파일 업로드</button></div>
        <div id="hero-youtube"><div class="input-row"><input id="hero-url" placeholder="${c.hero.inputs[0].placeholder}" /><button class="btn btn-primary" id="hero-go">${c.hero.cta}</button></div></div>
        <div id="hero-file" class="hidden"><div class="dropzone" id="hero-drop">MP4, MOV, WebM 파일을 끌어다 놓거나 클릭해서 선택 <input type="file" id="hero-file-input" accept="video/*" class="hidden" /></div><div id="hero-file-meta" class="small muted" style="margin-top:8px"></div><button class="btn btn-primary btn-block" id="hero-go-file" style="margin-top:8px" disabled>${c.hero.cta}</button></div>
        <div class="tiny muted" style="margin-top:8px">${state.user ? `보유 이용권 ${creditsLabel(state.user)}` : '회원가입 시 30분 무료 이용권 제공 · 원본 길이만큼 차감'}</div>
      </div>
      <div class="stats">${raw(c.hero.stats.map((s) => `<div class="stat"><div class="value">${esc(s.value)}</div><div class="label">${esc(s.label)}</div></div>`).join(''))}</div>
    </section>

    <section class="section"><div class="section-head"><h2>${c.genresSection.title}</h2><p>${c.genresSection.subtitle}</p></div>
      <div class="grid grid-5">${raw(tpl.genres.map((g) => `<div class="card card-hover" style="text-align:center"><div style="font-size:2rem">${genreIcons[g.id] || '🎬'}</div><h3>${esc(g.name)}</h3><div class="tiny muted">클립 ${g.rules.minClip}~${g.rules.maxClip}초 · 후킹: ${esc(g.rules.hook)}</div></div>`).join(''))}</div></section>

    <section class="section"><div class="section-head"><h2>${c.creators.title}</h2><p>${c.creators.subtitle}</p></div>
      ${raw(c.creators.rows.map((row, i) => `<div class="marquee"><div class="marquee-track ${i % 2 ? 'reverse' : ''}">${[...row, ...row].map((n) => `<span class="creator"><span class="avatar"></span>${esc(n)}</span>`).join('')}</div></div>`).join(''))}</section>

    <section class="section"><div class="section-head"><h2>${c.personas.title}</h2><p>${c.personas.subtitle}</p></div>
      <div class="grid grid-2">${raw(c.personas.items.map((p) => `<div class="card persona"><div class="who">${esc(p.who)}</div><div class="quote">“ ${esc(p.quote)} ”</div><div>${p.results.map((r) => `<span class="result-chip">${esc(r)}</span>`).join('')}</div></div>`).join(''))}</div></section>

    <section class="section"><div class="section-head"><h2>${c.steps.title}</h2><p>${c.steps.subtitle}</p></div>
      <div class="grid grid-3">${raw(c.steps.items.map((s, i) => `<div class="card step"><div class="num">${i + 1}</div><div><h3>${esc(s.title)}</h3><p class="muted">${esc(s.body)}</p>${s.badge ? `<span class="badge">${esc(s.badge)}</span>` : ''}</div></div>`).join(''))}</div></section>

    <section class="section"><div class="section-head"><h2>${c.features.title}</h2><p>${c.features.subtitle}</p></div>
      <div class="grid grid-4">${raw(c.features.items.map((f) => `<div class="card card-hover"><h3>${esc(f.title)}</h3><p class="muted small">${esc(f.body)}</p></div>`).join(''))}<a class="card card-hover" href="#/guide" style="display:grid;place-items:center;font-weight:800;color:var(--primary)">${esc(c.features.more)}</a></div>
      <div class="section-head" style="margin-top:32px"><h3>쇼츠 디자인 템플릿</h3></div>
      <div class="grid grid-5">${raw(tpl.templates.map((t) => `<div class="card template-card"><div class="template-swatch" style="font-family:'${esc(t.font)}';color:${esc(t.color)}">${esc(t.name)}</div><div class="bold" style="margin-top:8px">${esc(t.name)}</div><div class="tiny muted">${esc(t.description)}</div></div>`).join(''))}</div></section>

    <section class="section"><div class="section-head"><h2>${c.testimonials.title}</h2><p>${c.testimonials.subtitle}</p></div>
      <div class="grid grid-3">${raw(c.testimonials.items.map((t) => `<div class="card"><div class="bold">${esc(t.channel)} <span class="muted small">${esc(t.kind)}</span></div><div class="tiny muted">${esc(t.subs)}</div><p class="quote" style="margin-top:8px">${esc(t.quote)}</p><div class="row row-between"><span class="badge badge-success">${esc(t.views)}</span>${t.link ? `<a href="${esc(t.link)}" target="_blank" rel="noopener">보러가기</a>` : ''}</div></div>`).join(''))}</div></section>

    <section class="section"><div class="section-head"><h2>${c.extras.title}</h2><p>${c.extras.subtitle}</p></div>
      <div class="grid grid-3">${raw(c.extras.items.map((x) => `<a class="card card-hover" href="${esc(x.href)}" style="color:inherit"><h3>${esc(x.title)}</h3><p class="muted small">${esc(x.body)}</p>${x.platforms ? `<div class="chips">${x.platforms.map((p) => `<span class="chip">${esc(p)}</span>`).join('')}</div>` : ''}${x.sample ? `<div class="row"><span class="chip">${esc(x.sample.from)}</span>→<span class="chip">${esc(x.sample.to)}</span><span class="badge">번역하기</span></div>` : ''}</a>`).join(''))}</div></section>

    <section class="section"><div class="section-head"><h2 id="faq-title">${c.faq.title}</h2><p>${c.faq.subtitle}</p></div>
      <div class="card">${raw(c.faq.items.slice(0, 6).map((f) => `<details class="faq-item"><summary>${esc(f.q)}</summary><div class="answer">${esc(f.a)}</div></details>`).join(''))}<div style="text-align:center;margin-top:12px"><a href="#/faq">FAQ 전체 보기 →</a></div></div></section>

    <section class="section card" style="text-align:center;background:linear-gradient(135deg,var(--primary-soft),var(--surface))"><h2>${c.finalCta.title}</h2><p class="muted">${c.finalCta.subtitle}</p><a class="btn btn-primary btn-lg" href="#/signup">${c.finalCta.button}</a><div class="chips" style="justify-content:center;margin-top:14px">${raw(c.finalCta.perks.map((p) => `<span class="chip">✓ ${esc(p)}</span>`).join(''))}</div></section>`;

  qsa('#hero-tabs .tab').forEach((t) => { t.onclick = () => { qsa('#hero-tabs .tab').forEach((x) => x.classList.remove('active')); t.classList.add('active'); qs('#hero-youtube').classList.toggle('hidden', t.dataset.tab !== 'youtube'); qs('#hero-file').classList.toggle('hidden', t.dataset.tab !== 'file'); }; });
  qs('#hero-go').onclick = () => startShortsFromLanding({ url: qs('#hero-url').value, state, navigate });
  let picked = null;
  const drop = qs('#hero-drop'); const input = qs('#hero-file-input');
  drop.onclick = () => input.click();
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); }; drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) pick(e.dataTransfer.files[0]); };
  input.onchange = () => input.files[0] && pick(input.files[0]);
  async function pick(file) {
    try { const meta = await readVideoMeta(file); picked = { file, meta }; qs('#hero-file-meta').textContent = `${file.name} · ${Math.round(meta.durationSec / 60)}분 · ${meta.width}×${meta.height} · 필요 이용권 ${(meta.durationSec / 60).toFixed(1)}분`; qs('#hero-go-file').disabled = false; }
    catch (err) { picked = null; qs('#hero-go-file').disabled = true; toast(err.message, 'error', 5000); }
  }
  qs('#hero-go-file').onclick = () => picked && startShortsFromLanding({ file: picked.file, meta: picked.meta, state, navigate });
}

export async function login({ view, state, navigate, query }) {
  view.innerHTML = html`<div class="card" style="max-width:440px;margin:40px auto"><h2>로그인</h2><p class="muted">AlphaMan 웹사이트·프로그램 버전 공통 계정</p>
    <form id="login-form"><div class="field"><label>이메일</label><input name="email" type="email" required autocomplete="email" /></div><div class="field"><label>비밀번호</label><input name="password" type="password" required autocomplete="current-password" /></div><button class="btn btn-primary btn-block">로그인</button></form>
    <button class="btn btn-block" id="google-btn" style="margin-top:8px">G Google 계정으로 간편 로그인</button>
    <p class="small muted" style="margin-top:12px">계정이 없으신가요? <a href="#/signup">무료로 시작하기</a></p></div>`;
  qs('#login-form').onsubmit = async (e) => { e.preventDefault(); const f = new FormData(e.target); try { const r = await post('/api/auth/login', Object.fromEntries(f)); setToken(r.token); await window.AlphaManApp.refreshUser(); toast(`환영합니다, ${r.user.name}님`); navigate(query.next || (r.user.isAdmin ? '/admin' : '/dashboard')); } catch (err) { toast(err.message, 'error'); } };
  qs('#google-btn').onclick = () => googleFlow(navigate, query.next);
}

function googleFlow(navigate, next) {
  const m = modal(html`<p class="small muted">Google 로그인은 Google 계정 이메일로 계정을 만들거나 연결합니다. (OAuth 클라이언트 ID 를 설정하면 실제 Google 팝업이 사용됩니다)</p><div class="field"><label>Google 이메일</label><input id="g-email" type="email" placeholder="you@gmail.com" /></div><div class="field"><label>이름</label><input id="g-name" placeholder="표시 이름" /></div><button class="btn btn-primary btn-block" id="g-go">계속</button>`, { title: 'Google 계정으로 로그인' });
  m.el.querySelector('#g-go').onclick = async () => { try { const r = await post('/api/auth/google', { email: m.el.querySelector('#g-email').value, name: m.el.querySelector('#g-name').value }); setToken(r.token); await window.AlphaManApp.refreshUser(); m.close(); navigate(next || '/dashboard'); } catch (err) { toast(err.message, 'error'); } };
}

export async function signup({ view, navigate, query }) {
  let ref = query.ref || ''; try { ref = ref || localStorage.getItem('am_ref') || ''; } catch { /* ignore */ }
  view.innerHTML = html`<div class="card" style="max-width:440px;margin:40px auto"><h2>무료로 시작하기</h2><p class="muted">🎁 지금 회원가입하고 무료로 쇼츠를 제작해보세요! (30분 무료 이용권)</p>
    <form id="signup-form"><div class="field"><label>이름</label><input name="name" required /></div><div class="field"><label>이메일</label><input name="email" type="email" required /></div><div class="field"><label>비밀번호 (6자 이상)</label><input name="password" type="password" minlength="6" required /></div><div class="field"><label>추천인 코드 (선택, +30분)</label><input name="referral" value="${ref}" /></div><label class="check"><input type="checkbox" required /> <span class="small"><a href="#/terms">이용약관</a>과 <a href="#/privacy">개인정보처리방침</a>에 동의합니다</span></label><button class="btn btn-primary btn-block" style="margin-top:12px">가입하고 무료 쇼츠 만들기</button></form>
    <button class="btn btn-block" id="google-btn" style="margin-top:8px">G Google 계정으로 간편 가입</button>
    <p class="small muted" style="margin-top:12px">이미 계정이 있으신가요? <a href="#/login">로그인</a></p></div>`;
  qs('#signup-form').onsubmit = async (e) => { e.preventDefault(); try { const r = await post('/api/auth/signup', Object.fromEntries(new FormData(e.target))); setToken(r.token); await window.AlphaManApp.refreshUser(); toast('가입 완료! 30분 무료 이용권이 지급되었습니다.'); navigate('/dashboard'); } catch (err) { toast(err.message, 'error'); } };
  qs('#google-btn').onclick = () => googleFlow(navigate);
}

export async function pricing({ view, state, navigate }) {
  const { plans, addons } = await get('/api/plans');
  view.innerHTML = html`<div class="section-head"><h1>가격 안내</h1><p>원본 영상 길이만큼 이용권이 차감됩니다. 10분 영상 = 10분 이용권. 재생성은 절반.</p></div>
    <div class="grid grid-4">${raw(plans.map((p) => `<div class="card pricing-card ${p.popular ? 'popular' : ''}">${p.popular ? '<span class="badge" style="position:absolute;top:-10px;left:16px">인기</span>' : ''}<h3>${esc(p.name)}</h3><div class="price">${p.price ? fmtKRW(p.price) : '무료'}<span class="small muted">${p.period === 'month' ? '/월' : ''}</span></div><div class="muted small">${p.period === 'month' ? `월 ${p.minutes}분` : `${p.minutes}분 1회`}</div><ul>${p.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul><button class="btn ${p.popular ? 'btn-primary' : ''} btn-block" data-plan="${p.id}">${p.price ? '결제하기' : '무료 시작'}</button></div>`).join(''))}</div>
    <div class="section"><div class="section-head"><h2>부가 서비스 요금제</h2></div><div class="grid grid-2">
      <div class="card"><h3>SNS 업로드 자동화</h3>${raw(addons.publish.map((p) => `<div class="row row-between" style="padding:8px 0;border-bottom:1px solid var(--border)"><div><b>${esc(p.name)}</b><div class="tiny muted">${p.features.map(esc).join(' · ')}</div></div><button class="btn btn-sm" data-plan="${p.id}">${fmtKRW(p.price)}/월</button></div>`).join(''))}</div>
      <div class="card"><h3>알파토픽</h3>${raw(addons.topic.map((p) => `<div class="row row-between" style="padding:8px 0;border-bottom:1px solid var(--border)"><div><b>${esc(p.name)}</b><div class="tiny muted">${p.features.map(esc).join(' · ')}</div></div><button class="btn btn-sm" data-plan="${p.id}">${fmtKRW(p.price)}/월</button></div>`).join(''))}</div></div></div>
    <div class="card" style="text-align:center"><b>해외에서 거주 중이신가요?</b> <a href="#/overseas-payment">해외 결제 전용 페이지</a>에서 해외 카드로 결제하실 수 있습니다. · 팀 계정은 <a href="#/support">문의하기</a></div>`;
  qsa('[data-plan]').forEach((b) => { b.onclick = () => checkout(b.dataset.plan, 'domestic', state, navigate); });
}

export async function checkout(planId, region, state, navigate) {
  if (!state.user) return navigate(`/login?next=${encodeURIComponent(`/pricing`)}`);
  if (planId === 'free') return navigate('/dashboard');
  const m = modal(html`<p>${region === 'overseas' ? '해외 카드 (USD 청구)' : '토스페이먼츠 (KRW)'}로 결제합니다.</p><div class="field"><label>결제 수단</label><select id="pay-method"><option value="card">신용/체크카드</option><option value="transfer">계좌이체</option><option value="paypal">PayPal</option></select></div><button class="btn btn-primary btn-block" id="pay-go">결제 진행</button>`, { title: '결제' });
  m.el.querySelector('#pay-go').onclick = async () => { try { const r = await post('/api/billing/checkout', { planId, region, method: m.el.querySelector('#pay-method').value }); await window.AlphaManApp.refreshUser(); m.close(); toast(`결제 완료: ${r.currency} ${r.amount}`); navigate('/credits'); } catch (err) { toast(err.message, 'error'); } };
}

export async function overseas({ view, state, navigate }) {
  const { plans } = await get('/api/plans');
  const c = state.info.content.overseasPayment;
  view.innerHTML = html`<div class="card" style="max-width:720px;margin:0 auto"><h1>${c.title}</h1><p class="muted">${c.body}</p><div class="grid grid-2">${raw(plans.filter((p) => p.price).map((p) => `<div class="card"><h3>${esc(p.name)}</h3><div class="price">$${(p.price / 1350).toFixed(2)}<span class="small muted">/mo</span></div><div class="tiny muted">${p.minutes} min</div><button class="btn btn-primary btn-block" data-plan="${p.id}">Pay with overseas card</button></div>`).join(''))}</div></div>`;
  qsa('[data-plan]').forEach((b) => { b.onclick = () => checkout(b.dataset.plan, 'overseas', state, navigate); });
}

export async function addonPricing({ view, state, navigate, path }) {
  const { addons } = await get('/api/plans');
  const key = path.includes('publish') ? 'publish' : 'topic';
  const title = key === 'publish' ? 'SNS 업로드 요금제' : '알파토픽 요금제';
  view.innerHTML = html`<div class="section-head"><h1>${title}</h1></div><div class="grid grid-2">${raw(addons[key].map((p) => `<div class="card pricing-card"><h3>${esc(p.name)}</h3><div class="price">${fmtKRW(p.price)}<span class="small muted">/월</span></div><ul>${p.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul><button class="btn btn-primary btn-block" data-plan="${p.id}">결제하기</button></div>`).join(''))}</div>`;
  qsa('[data-plan]').forEach((b) => { b.onclick = () => checkout(b.dataset.plan, 'domestic', state, navigate); });
}

export async function guide({ view, state }) {
  const c = state.info.content;
  view.innerHTML = html`<div class="section-head"><h1>사용 가이드</h1><p>가입부터 업로드까지 7단계</p></div><div class="stack">${raw(c.guide.map((g) => `<div class="card"><h3>${esc(g.title)}</h3><p class="muted">${esc(g.body)}</p></div>`).join(''))}
    <div class="card"><h3>키보드 단축키</h3>${raw(c.pixeling.shortcuts.map((s) => `<div class="row"><span class="kbd">${esc(s.keys)}</span><span>${esc(s.action)}</span></div>`).join(''))}</div></div>`;
}

export async function faq({ view, state }) {
  const c = state.info.content.faq;
  view.innerHTML = html`<div class="section-head"><h1>${c.title}</h1><p>${c.subtitle}</p></div><div class="card">${raw(c.items.map((f) => `<details class="faq-item"><summary>${esc(f.q)}</summary><div class="answer">${esc(f.a)}</div></details>`).join(''))}</div>`;
}

export async function tools({ view, params }) {
  const list = await get('/api/tools');
  const active = list.find((t) => t.id === params.id) || list[0];
  const form = { url: '<div class="field"><label>유튜브 링크</label><input id="t-url" placeholder="https://www.youtube.com/watch?v=..." /></div>', text: '<div class="field"><label>키워드 / 문장</label><input id="t-text" placeholder="예: 미국주식 초보" /></div><div class="field"><label>지역 (업로드 시간 도구)</label><select id="t-region"><option>KR</option><option>US</option><option>JP</option></select></div>', subtitle: '<div class="field"><label>SRT 내용</label><textarea id="t-content" rows="6" placeholder="1\n00:00:00,000 --> 00:00:01,500\n안녕하세요"></textarea></div><div class="field"><label>변환 형식</label><select id="t-format"><option>vtt</option><option>ass</option><option>txt</option><option>srt</option></select></div>', duration: '<div class="field"><label>영상 길이 (분)</label><input id="t-minutes" type="number" min="1" value="10" /></div>' };
  view.innerHTML = html`<div class="section-head"><h1>무료 도구</h1><p>로그인 없이 바로 쓰는 크리에이터 유틸리티</p></div><div class="split"><div class="card"><h2>${active.name}</h2><p class="muted">${active.description}</p>${raw(form[active.input])}<button class="btn btn-primary" id="t-run">실행</button><pre id="t-out" class="log" style="margin-top:12px;white-space:pre-wrap"></pre></div>
    <div class="col">${raw(list.map((t) => `<a class="card card-hover ${t.id === active.id ? 'template-card active' : ''}" href="#/tools/${t.id}" style="color:inherit"><b>${esc(t.name)}</b><div class="tiny muted">${esc(t.description)}</div></a>`).join(''))}</div></div>`;
  qs('#t-run').onclick = async () => {
    const input = { url: qs('#t-url')?.value, text: qs('#t-text')?.value, region: qs('#t-region')?.value, content: qs('#t-content')?.value, format: qs('#t-format')?.value, minutes: qs('#t-minutes')?.value };
    try { const r = await post(`/api/tools/${active.id}/run`, input); qs('#t-out').textContent = typeof r.body === 'string' ? r.body : JSON.stringify(r, null, 2); } catch (err) { toast(err.message, 'error'); }
  };
}

export async function referral({ view, state }) {
  const c = state.info.content.referralPromo;
  let mine = null; if (state.user) mine = await get('/api/referral');
  view.innerHTML = html`<div class="card" style="max-width:720px;margin:0 auto;text-align:center"><h1>${c.title}</h1><p class="muted">${c.body}</p><div class="grid grid-3">${raw(c.steps.map((s, i) => `<div class="card step"><div class="num">${i + 1}</div><div>${esc(s)}</div></div>`).join(''))}</div>
    ${mine ? raw(`<div class="card" style="margin-top:16px"><div class="muted small">내 추천 코드</div><div style="font-size:1.6rem;font-weight:900">${esc(mine.code)}</div><div class="row" style="justify-content:center"><button class="btn btn-sm" id="copy-ref">링크 복사</button></div><div class="small muted" style="margin-top:8px">초대 ${mine.invited}명 · 적립 ${mine.earnedMinutes}분</div></div>`) : raw('<a class="btn btn-primary" href="#/signup" style="margin-top:16px">가입하고 코드 받기</a>')}</div>`;
  const b = qs('#copy-ref'); if (b) b.onclick = () => { navigator.clipboard?.writeText(`${location.origin}/?ref=${mine.code}#/signup`); toast('추천 링크가 복사되었습니다.'); };
}

export async function team({ view, state }) {
  const c = state.info.content.team;
  view.innerHTML = html`<div class="section-head"><h1>${c.title}</h1><p>${c.body}</p></div><div class="grid grid-4">${raw(c.members.map((m) => `<div class="card" style="text-align:center"><div class="creator" style="justify-content:center"><span class="avatar"></span>${esc(m.name)}</div><div class="muted small" style="margin-top:6px">${esc(m.role)}</div></div>`).join(''))}</div>`;
}

export async function legal({ view, state, path }) {
  const key = { '/terms': 'terms', '/privacy': 'privacy', '/refund': 'refund', '/open-source': 'openSource' }[path];
  const doc = state.info.content.legal[key];
  view.innerHTML = html`<div class="card" style="max-width:820px;margin:0 auto"><h1>${doc.title}</h1>${raw(doc.sections.map(([h, b]) => `<h3 style="margin-top:20px">${esc(h)}</h3><p class="muted">${esc(b)}</p>`).join(''))}</div>`;
}

export async function download({ view, state }) {
  const v = state.info.version;
  const rel = `https://github.com/myzxit/AlphaMan-/releases/download/v${v}`;
  const files = [
    ['Windows', '설치형 (.exe)', `${rel}/AlphaMan-${v}-win-x64.exe`], ['Windows', '무설치 포터블 (.exe)', `${rel}/AlphaMan-${v}-win-x64-portable.exe`],
    ['macOS', 'Apple Silicon (.dmg)', `${rel}/AlphaMan-${v}-mac-arm64.dmg`], ['macOS', 'Intel (.dmg)', `${rel}/AlphaMan-${v}-mac-x64.dmg`],
    ['Linux', 'AppImage', `${rel}/AlphaMan-${v}-linux-x86_64.AppImage`], ['Linux', 'Debian/Ubuntu (.deb)', `${rel}/AlphaMan-${v}-linux-amd64.deb`],
  ];
  view.innerHTML = html`<div class="section-head"><h1>다운로드</h1><p>웹사이트 버전은 설치 없이 바로, 프로그램 버전은 PC 에 설치해서 사용하세요. 두 버전의 기능은 같습니다.</p></div>
    <div class="grid grid-2"><div class="card"><h3>🌐 웹사이트 버전</h3><p class="muted small">브라우저에서 바로 사용. 설치 불필요.</p><a class="btn btn-primary btn-lg" href="https://alphaman.vercel.app" target="_blank" rel="noopener">alphaman.vercel.app 열기</a><div class="tiny muted" style="margin-top:8px">현재 실행 중: <b>${state.desktop ? '프로그램 버전' : '웹사이트 버전'}</b> · 버전 ${v}</div></div>
    <div class="card"><h3>💻 프로그램(PC) 버전 v${v}</h3><p class="muted small">컴퓨터/USB 영상 직접 열기, 로컬 ffmpeg/Whisper 렌더링, 트레이 알림이 추가됩니다.</p><div class="table-wrap"><table class="table"><tr><th>OS</th><th>파일</th><th></th></tr>${raw(files.map(([os, label, href]) => `<tr><td>${esc(os)}</td><td>${esc(label)}</td><td><a class="btn btn-sm" href="${esc(href)}">다운로드</a></td></tr>`).join(''))}</table></div><a class="small" href="https://github.com/myzxit/AlphaMan-/releases" target="_blank" rel="noopener">모든 릴리스 보기 →</a></div></div>
    <div class="card" style="margin-top:16px"><h3>설치 안내</h3><ul class="small muted"><li><b>Windows</b>: SmartScreen 경고가 뜨면 "추가 정보 → 실행" 을 누르세요 (코드 서명 전).</li><li><b>macOS</b>: 처음 실행 시 Finder 에서 앱을 우클릭 → "열기" 를 선택하세요 (서명되지 않은 앱).</li><li><b>Linux</b>: AppImage 는 <code>chmod +x</code> 후 실행, .deb 는 <code>sudo dpkg -i</code> 로 설치합니다.</li><li>관리자 로그인: <code>hhudeu66@gmail.com</code></li></ul></div>
    <div class="card" style="margin-top:16px"><h3>개발자용 실행 / 자체 호스팅</h3><pre class="log">npm install
npm run web            # 웹사이트 버전 (http://localhost:4100)
npm run desktop        # 프로그램 버전 실행
npm run desktop:build  # 설치 파일 직접 빌드 → release/
docker compose up -d   # 영구 데이터 볼륨을 가진 자체 호스팅</pre></div>`;
}

export async function notices({ view, state }) {
  const list = await get('/api/notices');
  view.innerHTML = html`<div class="section-head"><h1>공지사항</h1></div>${list.length ? raw(list.map((n) => `<div class="card" style="margin-bottom:12px"><div class="row row-between"><h3>${n.pinned ? '📌 ' : ''}${esc(n.title)}</h3><span class="badge badge-soft">${esc(n.level)}</span></div><p class="muted">${esc(n.body)}</p></div>`).join('')) : '<div class="card muted">등록된 공지가 없습니다.</div>'}`;
}

export async function blog({ view }) {
  view.innerHTML = html`<div class="section-head"><h1>블로그</h1><p>쇼츠 성장 노하우와 업데이트 소식</p></div><div class="grid grid-3">${raw(['첫 3초 후킹, 이렇게 자동화했습니다', '롱폼 1편으로 쇼츠 10편 만드는 워크플로우', '자막 폰트 선택이 조회수에 미치는 영향', '월·수·금 10시 예약 업로드가 효과적인 이유', 'Whisper 기반 STT 정확도 개선 노트', '알파토픽으로 떡상 주제 찾기'].map((t, i) => `<div class="card card-hover"><div class="template-swatch" style="background-image:url('https://picsum.photos/seed/blog${i}/400/160')"></div><h3 style="margin-top:10px">${esc(t)}</h3><p class="tiny muted">AlphaMan 팀 · 5분 읽기</p></div>`).join(''))}</div>`;
}

export async function landingLongform({ view }) { view.innerHTML = featureLanding('롱폼 컷편집', '롱폼 영상 전체의 무음 구간을 제거하고 자동 자막·챕터를 생성합니다. 점프컷으로 속도감 있는 롱폼을 만드세요.', '#/longform', ['무음 구간 자동 제거', '초정밀 자동 자막', 'AI 챕터 생성', '타임라인 미리보기']); }
export async function landingPublish({ view }) { view.innerHTML = featureLanding('SNS 업로드 자동화', '유튜브·인스타그램·틱톡·스레드·페이스북에 클릭 한 번으로 바로 업로드하거나 원하는 시간에 예약하세요.', '#/publish', ['5개 플랫폼 동시 업로드', '월·수·금 오전 10시 반복 예약', '플랫폼별 비율 검증', '업로드 결과 알림']); }
export async function landingTopic({ view }) { view.innerHTML = featureLanding('알파토픽', '내 채널과 경쟁 채널을 분석해 지금 올리기 좋은 주제, 썸네일 문구, 45초 대본까지 AI가 추천합니다.', '#/topic', ['채널 강점/약점 분석', '경쟁 채널 비교', '떡상 주제 랭킹', '썸네일 + 대본 자동 생성']); }
function featureLanding(title, body, href, points) {
  return html`<section class="hero"><h1>${title}</h1><p class="lead">${body}</p><a class="btn btn-primary btn-lg" href="${href}">지금 시작하기</a></section><div class="grid grid-4">${raw(points.map((p) => `<div class="card" style="text-align:center;font-weight:700">${esc(p)}</div>`).join(''))}</div>`;
}

export async function notFound({ view }) { view.innerHTML = '<div class="card"><h2>페이지를 찾을 수 없습니다.</h2><a href="#/">홈으로</a></div>'; }
