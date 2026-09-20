// 관리자 전용 페이지: 대시보드, 사용자, 작업, 문의, 피드백, 팀 요청, 공지, 결제, 업로드 큐, 설정, 감사 로그
import { get, post, patch, del } from './api.js';
import { esc, html, raw, toast, modal, confirmDialog, fmtDate, fmtNum, fmtKRW, creditsLabel, qs, qsa, on } from './ui.js';

const adminPage = (fn) => Object.assign(fn, { requiresAuth: true, requiresAdmin: true });
const SECTIONS = [['', '대시보드'], ['users', '사용자'], ['jobs', '작업 모니터'], ['inquiries', '문의'], ['feedback', '피드백'], ['teams', '팀 요청'], ['notices', '공지'], ['payments', '결제'], ['publish', '업로드 큐'], ['settings', '설정'], ['audit', '감사 로그']];
const tabs = (cur) => `<div class="tabs">${SECTIONS.map(([k, l]) => `<a class="tab ${cur === k ? 'active' : ''}" href="#/admin${k ? `/${k}` : ''}">${l}</a>`).join('')}</div>`;

export const dashboard = adminPage(async ({ view, state }) => {
  const s = await get('/api/admin/stats');
  const cards = [['사용자', s.users.total, `관리자 ${s.users.admins} · 24h 신규 ${s.users.new24h} · 정지 ${s.users.banned}`], ['쇼츠 작업', s.shorts.jobs, `클립 ${s.shorts.clips} · 진행 ${s.shorts.processing} · 실패 ${s.shorts.failed}`], ['처리 분량', `${fmtNum(s.shorts.minutesProcessed)}분`, `미사용 이용권 ${fmtNum(s.credits.outstandingMinutes)}분`], ['자막/롱폼', `${s.subtitles.projects} / ${s.longform.jobs}`, '프로젝트 / 작업'], ['AI 재구성 / 음성', `${s.remix.jobs} / ${s.voice.profiles}`, `재구성 완료 ${s.remix.done} · 합성 ${s.voice.renders}`], ['SNS 업로드', s.publish.queued, `완료 ${s.publish.published}`], ['미답변 문의', s.support.openInquiries, `피드백 ${s.support.feedback} · 팀 요청 ${s.support.teamRequests}`], ['매출(KRW)', fmtKRW(s.revenue.paymentsKRW), `USD $${s.revenue.paymentsUSD} · ${s.revenue.count}건`], ['AI 엔진', state.info.ai.mode, `${state.info.ai.model} · ffmpeg ${state.info.tools.ffmpeg ? '✓' : '✗'} · whisper ${state.info.tools.whisper ? '✓' : '✗'}`]];
  view.innerHTML = html`<h1>관리자 대시보드 <span class="badge">${state.user.email}</span></h1>${raw(tabs(''))}<div class="admin-grid">${raw(cards.map(([t, v, d]) => `<div class="card admin-stat"><div class="muted small">${esc(t)}</div><div class="value">${esc(v)}</div><div class="tiny muted">${esc(d)}</div></div>`).join(''))}</div>
    <div class="card" style="margin-top:16px"><h3>빠른 작업</h3><div class="row"><a class="btn" href="#/admin/inquiries">문의 답변</a><a class="btn" href="#/admin/users">이용권 지급</a><a class="btn" href="#/admin/notices">공지 작성</a><button class="btn" id="tick">업로드 큐 즉시 처리</button></div></div>`;
  qs('#tick').onclick = async () => { const r = await post('/api/admin/publish/tick'); toast(`${r.processed}건 처리`); };
});

export const section = adminPage(async (ctx) => {
  const { params } = ctx;
  const fn = { users, jobs, inquiries, feedback, teams, notices, payments, publish, settings, audit }[params.section];
  if (!fn) { ctx.view.innerHTML = '<div class="card">없는 섹션</div>'; return; }
  await fn(ctx);
});

async function users({ view, params, query, navigate }) {
  if (params.id) {
    const u = await get(`/api/admin/users/${params.id}`);
    view.innerHTML = html`${raw(tabs('users'))}<a href="#/admin/users" class="small">← 사용자 목록</a><h1>${u.name} <span class="badge ${u.role === 'admin' ? '' : 'badge-soft'}">${u.role}</span> <span class="badge ${u.status === 'active' ? 'badge-success' : 'badge-danger'}">${u.status}</span></h1><div class="muted">${u.email} · 가입 ${fmtDate(u.createdAt)} · 최근 로그인 ${fmtDate(u.lastLoginAt)} · 요금제 ${u.plan || 'free'} · 추천코드 ${u.referralCode}</div>
      <div class="grid grid-3" style="margin-top:16px"><div class="card"><h3>이용권 ${creditsLabel(u)}</h3><div class="row"><input id="cr-min" type="number" placeholder="+지급 / -회수 (분)" /><input id="cr-reason" placeholder="사유" /></div><button class="btn btn-primary" id="cr-go" style="margin-top:8px">적용</button></div>
      <div class="card"><h3>계정 관리</h3><div class="row"><select id="u-role" style="width:auto"><option value="user" ${u.role === 'user' ? 'selected' : ''}>user</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>admin</option></select><select id="u-status" style="width:auto"><option value="active" ${u.status === 'active' ? 'selected' : ''}>활성</option><option value="banned" ${u.status === 'banned' ? 'selected' : ''}>정지</option></select><input id="u-plan" value="${u.plan || 'free'}" style="max-width:120px" /></div><div class="field" style="margin-top:8px"><input id="u-pw" type="password" placeholder="비밀번호 초기화 (선택)" /></div><div class="row"><button class="btn btn-primary" id="u-save">저장</button><button class="btn btn-danger" id="u-del" ${u.isSeededAdmin ? 'disabled' : ''}>계정 삭제</button></div></div>
      <div class="card"><h3>활동</h3><div class="small">쇼츠 작업 ${u.jobs.length}건 · 문의 ${u.inquiries.length}건 · 결제 ${u.payments.length}건</div><div class="log" style="margin-top:8px">${raw(u.ledger.slice(0, 30).map((l) => `${esc(fmtDate(l.createdAt))} ${l.delta > 0 ? '+' : ''}${l.delta} ${esc(l.reason)}`).join('\n'))}</div></div></div>`;
    qs('#cr-go').onclick = async () => { try { const r = await post(`/api/admin/users/${u.id}/credits`, { minutes: Number(qs('#cr-min').value), reason: qs('#cr-reason').value }); toast(`잔액 ${r.balance}분`); navigate(`/admin/users/${u.id}?r=${Date.now()}`); } catch (err) { toast(err.message, 'error'); } };
    qs('#u-save').onclick = async () => { try { await patch(`/api/admin/users/${u.id}`, { role: qs('#u-role').value, status: qs('#u-status').value, plan: qs('#u-plan').value, newPassword: qs('#u-pw').value || undefined }); toast('저장'); navigate(`/admin/users/${u.id}?r=${Date.now()}`); } catch (err) { toast(err.message, 'error'); } };
    qs('#u-del').onclick = async () => { if (await confirmDialog(`${u.email} 계정과 모든 데이터를 삭제할까요?`)) { try { await del(`/api/admin/users/${u.id}`); navigate('/admin/users'); } catch (err) { toast(err.message, 'error'); } } };
    return;
  }
  const r = await get(`/api/admin/users?q=${encodeURIComponent(query.q || '')}&page=${query.page || 1}`);
  view.innerHTML = html`${raw(tabs('users'))}<div class="row row-between"><h1>사용자 (${r.total})</h1><div class="input-row"><input id="q" value="${query.q || ''}" placeholder="이메일/이름 검색" /><button class="btn" id="q-go">검색</button></div></div>
    <div class="card table-wrap"><table class="table"><tr><th>이메일</th><th>이름</th><th>역할</th><th>상태</th><th>이용권</th><th>요금제</th><th>작업</th><th>가입</th></tr>${raw(r.items.map((u) => `<tr><td><a href="#/admin/users/${u.id}">${esc(u.email)}</a></td><td>${esc(u.name)}</td><td>${u.role === 'admin' ? '<span class="badge">admin</span>' : 'user'}</td><td>${u.status === 'banned' ? '<span class="badge badge-danger">정지</span>' : '활성'}</td><td>${creditsLabel(u)}</td><td>${esc(u.plan || 'free')}</td><td>${u.jobs} / ${u.subtitleProjects}</td><td>${fmtDate(u.createdAt)}</td></tr>`).join(''))}</table></div>`;
  qs('#q-go').onclick = () => navigate(`/admin/users?q=${encodeURIComponent(qs('#q').value)}`);
}

async function jobs({ view, query }) {
  const list = await get(`/api/admin/jobs?${new URLSearchParams(query.status ? { status: query.status } : {})}`);
  view.innerHTML = html`${raw(tabs('jobs'))}<h1>작업 모니터</h1><div class="chips">${raw([['', '전체'], ['processing', '진행'], ['done', '완료'], ['failed', '실패']].map(([v, l]) => `<a class="chip ${(query.status || '') === v ? 'active' : ''}" href="#/admin/jobs${v ? `?status=${v}` : ''}">${l}</a>`).join(''))}</div>
    <div class="card table-wrap" style="margin-top:12px"><table class="table"><tr><th>생성</th><th>사용자</th><th>영상</th><th>분</th><th>상태</th><th>단계</th><th>클립</th><th>STT</th></tr>${raw(list.map((j) => `<tr><td>${fmtDate(j.createdAt)}</td><td>${esc(j.userEmail)}</td><td>${esc(j.source.title)}</td><td>${j.minutesCharged}</td><td>${esc(j.status)}</td><td>${esc(j.step)} ${j.progress}%</td><td>${j.clipCount}</td><td>${esc(j.transcriptEngine || '-')}</td></tr>`).join(''))}</table></div>`;
}

async function inquiries({ view, params, navigate }) {
  const list = await get('/api/admin/inquiries');
  const cur = params.id ? list.find((i) => i.id === params.id) : null;
  view.innerHTML = html`${raw(tabs('inquiries'))}<h1>문의 관리 <span class="badge badge-warn">미답변 ${list.filter((i) => i.status === 'open').length}</span></h1>
    <div class="split"><div class="card">${cur ? raw(`<div class="row row-between"><b>${esc(cur.userEmail)}</b><span class="badge badge-soft">${esc(cur.category)} · ${esc(cur.status)}</span></div><div class="tiny muted">${fmtDate(cur.createdAt)} · SLA ${cur.slaHours}h</div>${cur.extra ? `<div class="small" style="margin-top:6px"><b>추가 전달:</b> ${esc(cur.extra)}</div>` : ''}${cur.transcript?.length ? `<details style="margin-top:8px"><summary class="small">챗봇 대화 기록 (${cur.transcript.length})</summary><div class="log">${cur.transcript.map((m) => `${esc(m.role)}: ${esc(m.text)}`).join('\n')}</div></details>` : ''}<div class="chat-body" style="margin-top:10px">${cur.messages.map((m) => `<div class="msg ${m.from === 'user' ? '' : 'user'}">${esc(m.text)}<div class="tiny" style="opacity:.7">${fmtDate(m.at)}</div></div>`).join('')}</div><div class="field" style="margin-top:10px"><textarea id="rp-text" rows="3" placeholder="답변 (사용자 채팅과 알림으로 전달됩니다)"></textarea></div><div class="row"><button class="btn btn-primary" id="rp-go">답변 보내기</button><button class="btn" id="rp-close">종료</button></div>`) : '<p class="muted">왼쪽 목록에서 문의를 선택하세요.</p>'}</div>
      <div class="card">${raw((list.map((i) => `<div style="padding:8px 0;border-bottom:1px solid var(--border)"><a href="#/admin/inquiries/${i.id}"><b>${esc(i.message.slice(0, 50))}</b></a><div class="tiny muted">${esc(i.userEmail)} · ${fmtDate(i.createdAt)} · <span class="badge ${i.status === 'open' ? 'badge-warn' : 'badge-soft'}">${esc(i.status)}</span></div></div>`).join('')) || '<p class="muted">문의가 없습니다.</p>')}</div></div>`;
  if (cur) {
    qs('#rp-go').onclick = async () => { try { await post(`/api/admin/inquiries/${cur.id}/reply`, { text: qs('#rp-text').value }); toast('답변 전송'); navigate(`/admin/inquiries/${cur.id}?r=${Date.now()}`); } catch (err) { toast(err.message, 'error'); } };
    qs('#rp-close').onclick = async () => { await post(`/api/admin/inquiries/${cur.id}/close`); navigate('/admin/inquiries'); };
  }
}

async function feedback({ view }) {
  const list = await get('/api/admin/feedback');
  view.innerHTML = html`${raw(tabs('feedback'))}<h1>피드백 (${list.length})</h1><div class="card table-wrap"><table class="table"><tr><th>일시</th><th>이메일</th><th>평점</th><th>페이지</th><th>내용</th></tr>${raw(list.map((f) => `<tr><td>${fmtDate(f.createdAt)}</td><td>${esc(f.email || '-')}</td><td>${f.rating ? '★'.repeat(f.rating) : '-'}</td><td>${esc(f.page)}</td><td>${esc(f.message)}</td></tr>`).join(''))}</table></div>`;
}

async function teams({ view, navigate }) {
  const list = await get('/api/admin/teams');
  view.innerHTML = html`${raw(tabs('teams'))}<h1>팀 계정 요청</h1><div class="card table-wrap"><table class="table"><tr><th>일시</th><th>이메일</th><th>회사</th><th>인원</th><th>상태</th><th></th></tr>${raw(list.map((t) => `<tr><td>${fmtDate(t.createdAt)}</td><td>${esc(t.email)}</td><td>${esc(t.company)}</td><td>${t.seats}</td><td>${esc(t.status)}</td><td>${t.status === 'pending' ? `<div class="row"><input data-min="${t.id}" type="number" placeholder="지급 분" style="max-width:100px" /><button class="btn btn-sm btn-primary" data-approve="${t.id}">승인</button><button class="btn btn-sm" data-reject="${t.id}">거절</button></div>` : ''}</td></tr>`).join(''))}</table></div>`;
  on(view, 'click', '[data-approve]', async (e, t) => { await post(`/api/admin/teams/${t.dataset.approve}`, { status: 'approved', minutes: Number(qs(`[data-min="${t.dataset.approve}"]`).value || 0) }); navigate(`/admin/teams?r=${Date.now()}`); });
  on(view, 'click', '[data-reject]', async (e, t) => { await post(`/api/admin/teams/${t.dataset.reject}`, { status: 'rejected' }); navigate(`/admin/teams?r=${Date.now()}`); });
}

async function notices({ view, navigate }) {
  const list = await get('/api/admin/notices');
  view.innerHTML = html`${raw(tabs('notices'))}<h1>공지 관리</h1><div class="split"><div class="card"><div class="field"><label>제목</label><input id="n-title" /></div><div class="field"><label>내용</label><textarea id="n-body" rows="4"></textarea></div><div class="row"><select id="n-level" style="width:auto"><option value="info">안내</option><option value="warn">주의</option><option value="update">업데이트</option></select><label class="check"><input type="checkbox" id="n-pinned"/> 상단 고정</label><label class="check"><input type="checkbox" id="n-broadcast"/> 전체 알림 발송</label></div><button class="btn btn-primary" id="n-go" style="margin-top:8px">등록</button></div>
    <div class="card">${raw((list.map((n) => `<div class="row row-between" style="padding:8px 0;border-bottom:1px solid var(--border)"><div><b>${n.pinned ? '📌 ' : ''}${esc(n.title)}</b> <span class="badge badge-soft">${esc(n.level)}</span>${n.active ? '' : ' <span class="badge badge-danger">비활성</span>'}<div class="tiny muted">${esc(n.body.slice(0, 80))}</div></div><div class="row"><button class="btn btn-sm" data-toggle="${n.id}" data-active="${n.active}">${n.active ? '숨김' : '표시'}</button><button class="btn btn-sm" data-pin="${n.id}" data-pinned="${n.pinned}">${n.pinned ? '고정 해제' : '고정'}</button><button class="btn btn-sm btn-danger" data-del="${n.id}">삭제</button></div></div>`).join('')) || '<p class="muted">공지가 없습니다.</p>')}</div></div>`;
  qs('#n-go').onclick = async () => { try { await post('/api/admin/notices', { title: qs('#n-title').value, body: qs('#n-body').value, level: qs('#n-level').value, pinned: qs('#n-pinned').checked, broadcast: qs('#n-broadcast').checked }); navigate(`/admin/notices?r=${Date.now()}`); } catch (err) { toast(err.message, 'error'); } };
  on(view, 'click', '[data-toggle]', async (e, t) => { await patch(`/api/admin/notices/${t.dataset.toggle}`, { active: t.dataset.active !== 'true' }); navigate(`/admin/notices?r=${Date.now()}`); });
  on(view, 'click', '[data-pin]', async (e, t) => { await patch(`/api/admin/notices/${t.dataset.pin}`, { pinned: t.dataset.pinned !== 'true' }); navigate(`/admin/notices?r=${Date.now()}`); });
  on(view, 'click', '[data-del]', async (e, t) => { if (await confirmDialog('삭제할까요?')) { await del(`/api/admin/notices/${t.dataset.del}`); navigate(`/admin/notices?r=${Date.now()}`); } });
}

async function payments({ view }) {
  const list = await get('/api/admin/payments');
  view.innerHTML = html`${raw(tabs('payments'))}<h1>결제 내역 (${list.length})</h1><div class="card table-wrap"><table class="table"><tr><th>일시</th><th>사용자</th><th>요금제</th><th>금액</th><th>지역</th><th>게이트웨이</th><th>상태</th></tr>${raw(list.map((p) => `<tr><td>${fmtDate(p.createdAt)}</td><td>${esc(p.userId.slice(0, 8))}</td><td>${esc(p.planId)}</td><td>${p.currency === 'USD' ? `$${p.amount}` : fmtKRW(p.amount)}</td><td>${esc(p.region)}</td><td>${esc(p.gateway)}</td><td>${esc(p.status)}</td></tr>`).join(''))}</table></div>`;
}

async function publish({ view }) {
  const list = await get('/api/admin/publish');
  view.innerHTML = html`${raw(tabs('publish'))}<h1>업로드 큐 (${list.length})</h1><div class="card table-wrap"><table class="table"><tr><th>예약</th><th>플랫폼</th><th>제목</th><th>상태</th><th>결과</th></tr>${raw(list.map((q) => `<tr><td>${fmtDate(q.scheduledAt)}</td><td>${esc(q.platform)}</td><td>${esc(q.title)}</td><td>${esc(q.status)}</td><td class="tiny">${esc(q.result?.url || q.result?.error || '')}</td></tr>`).join(''))}</table></div>`;
}

async function settings({ view, state }) {
  const s = await get('/api/admin/settings');
  view.innerHTML = html`${raw(tabs('settings'))}<h1>시스템 설정</h1><div class="split"><div class="card"><div class="grid grid-2"><div class="field"><label>가입 보너스(분)</label><input id="st-bonus" type="number" value="${s.signupBonusMinutes}" /></div><div class="field"><label>추천 보상(분)</label><input id="st-ref" type="number" value="${s.referralRewardMinutes}" /></div></div><label class="check"><input type="checkbox" id="st-signup" ${s.allowSignup ? 'checked' : ''}/> 회원가입 허용</label><label class="check"><input type="checkbox" id="st-maint" ${s.maintenance ? 'checked' : ''}/> 점검 모드 (관리자만 접근)</label><div class="field"><label>점검 안내 문구</label><input id="st-maint-msg" value="${s.maintenanceMessage || ''}" /></div><label class="check"><input type="checkbox" id="st-tiktok" ${s.tiktokDownloadNotice ? 'checked' : ''}/> TikTok 다운로드 제한 공지 표시</label><button class="btn btn-primary" id="st-save" style="margin-top:8px">저장</button></div>
    <div class="card"><h3>환경</h3><div class="log">${esc(JSON.stringify({ platform: state.info.platform, version: state.info.version, ai: state.info.ai, tools: state.info.tools, adminEmail: state.info.adminEmail }, null, 2))}</div><p class="tiny muted" style="margin-top:8px">AI: ANTHROPIC_API_KEY 설정 시 claude-opus-5, 미설정 시 규칙 기반 엔진. 영상: ffmpeg/ffprobe/yt-dlp/whisper 설치 시 실제 렌더링·인식.</p></div></div>`;
  qs('#st-save').onclick = async () => { try { await patch('/api/admin/settings', { signupBonusMinutes: Number(qs('#st-bonus').value), referralRewardMinutes: Number(qs('#st-ref').value), allowSignup: qs('#st-signup').checked, maintenance: qs('#st-maint').checked, maintenanceMessage: qs('#st-maint-msg').value, tiktokDownloadNotice: qs('#st-tiktok').checked }); toast('저장되었습니다.'); } catch (err) { toast(err.message, 'error'); } };
}

async function audit({ view }) {
  const list = await get('/api/admin/audit');
  view.innerHTML = html`${raw(tabs('audit'))}<h1>감사 로그</h1><div class="card"><div class="log" style="max-height:600px">${raw(list.map((l) => `${esc(fmtDate(l.createdAt))} ${esc(l.action)} ${esc(JSON.stringify({ ...l, id: undefined, createdAt: undefined, updatedAt: undefined, action: undefined }))}`).join('\n'))}</div></div>`;
}
