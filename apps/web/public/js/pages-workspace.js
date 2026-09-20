// 추가 플랫폼 페이지: 프로젝트 관리 · 작업 센터/히스토리 · 파일 관리자 · 전체 검색 · 설정(템플릿·단축키·사용량) · 공유 보기 · 결제 완료/실패
import { get, post, put, patch, del, api, downloadUrl, getToken, setToken } from './api.js';
import { esc, html, raw, toast, modal, confirmDialog, fmtTime, fmtDate, fmtNum, fmtKRW, creditsLabel, qs, qsa, on, emptyState, errorScreen, skeleton, fmtBytes } from './ui.js';
import { openPreview, mountPlayer, getWithRetry } from './player.js';
import { seoButtons, bindSeoButtons } from './pages-seo.js';
import { SHORTCUTS, showShortcutHelp } from './shortcuts.js';

const auth = (fn) => Object.assign(fn, { requiresAuth: true });
const KIND_ICON = { shorts: '✂️', remix: '🪄', longform: '🎬', subtitle: '💬' };
const STATUS = { done: ['완료', 'badge-success'], ready: ['준비됨', 'badge-success'], failed: ['실패', 'badge-danger'], cancelled: ['취소', 'badge-soft'], queued: ['대기', 'badge-warn'], processing: ['처리 중', 'badge-warn'], transcribing: ['처리 중', 'badge-warn'] };
const statusBadge = (s) => { const [l, c] = STATUS[s] || [s, 'badge-soft']; return `<span class="badge ${c}">${esc(l)}</span>`; };
function saveBlob(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }

// ---------------- 프로젝트 관리 ----------------
export const projects = auth(async ({ view, params, state, navigate }) => {
  const f = { q: params.q || '', sort: params.sort || 'updated', kind: params.kind || '', favorite: params.favorite || '', trash: params.trash || '' };
  const link = (o) => `#/projects?${new URLSearchParams({ ...f, ...o }).toString()}`;
  view.innerHTML = skeleton(4);
  let data;
  try { data = await get(`/api/projects?${new URLSearchParams(f)}`); } catch (err) { view.innerHTML = errorScreen(err, { retry: () => navigate(link({ r: Date.now() })) }); return; }
  const { items, counts } = data;
  const selected = new Set();
  view.innerHTML = html`<div class="row row-between" style="flex-wrap:wrap"><div><h1>📂 프로젝트</h1><p class="muted">쇼츠 · AI 재구성 · 롱폼 · 자막 프로젝트를 한곳에서 관리합니다. 이름 변경 · 즐겨찾기 · 복제 · 버전 기록 · 내보내기/가져오기 · 휴지통 · 일괄 적용.</p></div>
    <div class="row"><button class="btn" id="pj-import">📥 가져오기</button><a class="btn btn-primary" href="#/studio">+ 새 프로젝트</a></div></div>
    <div class="row" style="gap:8px;flex-wrap:wrap;margin:10px 0"><form id="pj-search" class="row" style="gap:6px"><input id="pj-q" value="${f.q}" placeholder="프로젝트 검색" aria-label="프로젝트 검색" style="max-width:240px" /><button class="btn btn-sm" type="submit">검색</button></form>
      <select id="pj-sort" aria-label="정렬" style="width:auto">${raw([['updated', '최근 수정순'], ['created', '생성일순'], ['favorite', '즐겨찾기순'], ['opened', '최근 연 순'], ['title', '이름순']].map(([v, l]) => `<option value="${v}" ${f.sort === v ? 'selected' : ''}>${l}</option>`).join(''))}</select>
      <select id="pj-kind" aria-label="종류" style="width:auto"><option value="">모든 종류</option>${raw(Object.entries(state.info.projectKinds || {}).map(([k, l]) => `<option value="${k}" ${f.kind === k ? 'selected' : ''}>${esc(l)}</option>`).join(''))}</select>
      <a class="chip ${f.favorite ? 'active' : ''}" href="${link({ favorite: f.favorite ? '' : '1', trash: '' })}">★ 즐겨찾기 ${counts.favorites}</a><a class="chip ${f.trash ? 'active' : ''}" href="${link({ trash: f.trash ? '' : '1', favorite: '' })}">🗑️ 휴지통 ${counts.trash}</a></div>
    <div id="pj-batch" class="card hidden" style="margin-bottom:10px"><div class="row row-between" style="flex-wrap:wrap"><b><span id="pj-sel-count">0</span>개 선택</b><div class="row" style="flex-wrap:wrap"><button class="btn btn-sm" data-batch="template">템플릿 적용</button><button class="btn btn-sm" data-batch="ratio">화면 비율 적용</button><button class="btn btn-sm" data-batch="favorite">즐겨찾기</button><button class="btn btn-sm" data-batch="export">내보내기</button><button class="btn btn-sm btn-danger" data-batch="trash">휴지통으로</button><button class="btn btn-sm btn-ghost" id="pj-clear">선택 해제</button></div></div><div class="progress hidden" id="pj-progress" style="margin-top:8px"><div style="width:0"></div></div><div class="tiny muted" id="pj-progress-text"></div></div>
    ${f.trash ? raw(`<div class="card small muted" style="margin-bottom:10px">휴지통의 프로젝트는 복구하거나 영구 삭제할 수 있습니다. <button class="btn btn-sm btn-danger" id="pj-empty">휴지통 비우기</button></div>`) : ''}
    ${items.length ? raw(`<div class="grid grid-3 project-grid">${items.map(card).join('')}</div>`) : raw(emptyState(f.trash ? '휴지통이 비어 있습니다.' : f.q ? '검색 결과가 없습니다.' : '프로젝트가 없습니다.', f.trash || f.q ? '' : '쇼츠 스튜디오, AI 재구성, 롱폼 컷편집, 자막 편집기에서 만든 작업이 모두 여기에 모입니다.', f.trash || f.q ? [] : [['#/studio', '새 프로젝트 만들기'], ['#/projects', '가져오기', 'pj-import-empty']]))}`;
  function card(p) {
    const st = p.status === 'done' || p.status === 'ready' ? '' : p.status === 'processing' || p.status === 'queued' ? `<div class="progress" style="margin:6px 0"><div style="width:${p.progress || 0}%"></div></div>` : '';
    return `<div class="card project-card" data-id="${p.id}"><div class="row row-between" style="align-items:flex-start"><label class="check" style="gap:6px"><input type="checkbox" data-select="${p.id}" aria-label="${esc(p.title)} 선택" /> <span style="font-size:1.2rem">${KIND_ICON[p.kind] || '📄'}</span></label><div class="row" style="gap:4px"><button class="btn btn-sm btn-ghost ${p.favorite ? 'active' : ''}" data-fav="${p.id}" aria-label="즐겨찾기">${p.favorite ? '★' : '☆'}</button>${statusBadge(p.status)}</div></div>
      <a href="${esc(p.route)}" class="project-title"><b>${esc(p.title)}</b></a><div class="tiny muted">${esc(p.kindLabel)} · ${fmtTime(p.durationSec)} · 수정 ${fmtDate(p.updatedAt)}${p.versions ? ` · 버전 ${p.versions}` : ''}${p.lastPosition ? ' · 이어서 작업 가능' : ''}</div>${st}
      <div class="chips">${(p.tags || []).map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>
      <div class="row" style="flex-wrap:wrap">${p.deletedAt ? `<button class="btn btn-sm btn-primary" data-restore="${p.id}">복구</button><button class="btn btn-sm btn-danger" data-destroy="${p.id}">영구 삭제</button>` : `<a class="btn btn-sm btn-primary" href="${esc(p.route)}${p.lastPosition ? '?resume=1' : ''}">${p.lastPosition ? '이어서 열기' : '열기'}</a><button class="btn btn-sm" data-rename="${p.id}">이름</button><button class="btn btn-sm" data-dup="${p.id}">복제</button><button class="btn btn-sm" data-versions="${p.id}">버전</button><button class="btn btn-sm" data-export="${p.id}">내보내기</button>${p.kind !== 'subtitle' ? `<button class="btn btn-sm" data-share="${p.id}">공유</button>` : ''}<button class="btn btn-sm btn-danger" data-trash="${p.id}">휴지통</button>`}</div></div>`;
  }
  const split = (id) => { const [kind, ...r] = id.split(':'); return [kind, r.join(':')]; };
  const reload = () => navigate(link({ r: Date.now() }));
  qs('#pj-search').onsubmit = (e) => { e.preventDefault(); navigate(link({ q: qs('#pj-q').value.trim() })); };
  qs('#pj-sort').onchange = (e) => navigate(link({ sort: e.target.value }));
  qs('#pj-kind').onchange = (e) => navigate(link({ kind: e.target.value }));
  const imp = () => importDialog(navigate);
  qs('#pj-import').onclick = imp; const ie = qs('#pj-import-empty'); if (ie) ie.onclick = (e) => { e.preventDefault(); imp(); };
  const emptyBtn = qs('#pj-empty'); if (emptyBtn) emptyBtn.onclick = async () => { if (await confirmDialog('휴지통의 모든 프로젝트를 영구 삭제할까요? 되돌릴 수 없습니다.')) { await post('/api/projects/trash/empty'); reload(); } };
  on(view, 'change', '[data-select]', (e, t) => { t.checked ? selected.add(t.dataset.select) : selected.delete(t.dataset.select); qs('#pj-batch').classList.toggle('hidden', !selected.size); qs('#pj-sel-count').textContent = selected.size; });
  qs('#pj-clear').onclick = () => { selected.clear(); qsa('[data-select]').forEach((c) => { c.checked = false; }); qs('#pj-batch').classList.add('hidden'); };
  on(view, 'click', '[data-fav]', async (e, t) => { const [k, id] = split(t.dataset.fav); const p = items.find((x) => x.id === t.dataset.fav); try { await patch(`/api/projects/${k}/${id}`, { favorite: !p.favorite }); p.favorite = !p.favorite; t.textContent = p.favorite ? '★' : '☆'; t.classList.toggle('active', p.favorite); } catch (err) { toast(err.message, 'error'); } });
  on(view, 'click', '[data-rename]', async (e, t) => { const [k, id] = split(t.dataset.rename); const p = items.find((x) => x.id === t.dataset.rename); const title = prompt('새 이름', p.title); if (title && title !== p.title) { try { await patch(`/api/projects/${k}/${id}`, { title }); reload(); } catch (err) { toast(err.message, 'error'); } } });
  on(view, 'click', '[data-dup]', async (e, t) => { const [k, id] = split(t.dataset.dup); if (!(await confirmDialog(k === 'subtitle' ? '프로젝트를 복제할까요?' : '복제하면 같은 원본·옵션으로 새 작업이 만들어지고 이용권이 다시 차감됩니다. 진행할까요?'))) return; t.disabled = true; try { const p = await post(`/api/projects/${k}/${id}/duplicate`); toast(`"${p.title}" 이(가) 만들어졌습니다.`); reload(); } catch (err) { toast(err.message, 'error', 6000); t.disabled = false; } });
  on(view, 'click', '[data-trash]', async (e, t) => { const [k, id] = split(t.dataset.trash); try { await post(`/api/projects/${k}/${id}/trash`); toast('휴지통으로 이동했습니다. 프로젝트 → 휴지통에서 복구할 수 있습니다.'); reload(); } catch (err) { toast(err.message, 'error'); } });
  on(view, 'click', '[data-restore]', async (e, t) => { const [k, id] = split(t.dataset.restore); await post(`/api/projects/${k}/${id}/restore`); toast('복구했습니다.'); reload(); });
  on(view, 'click', '[data-destroy]', async (e, t) => { const [k, id] = split(t.dataset.destroy); if (await confirmDialog('영구 삭제하면 되돌릴 수 없습니다. 삭제할까요?')) { await del(`/api/projects/${k}/${id}`); reload(); } });
  on(view, 'click', '[data-export]', async (e, t) => { const [k, id] = split(t.dataset.export); await exportProject(k, id); });
  on(view, 'click', '[data-versions]', (e, t) => { const [k, id] = split(t.dataset.versions); openVersions(k, id); });
  on(view, 'click', '[data-share]', (e, t) => { const [k, id] = split(t.dataset.share); openShare(k, id, items.find((x) => x.id === t.dataset.share)?.title); });
  on(view, 'click', '[data-batch]', async (e, t) => {
    const targets = [...selected].map(split); if (!targets.length) return;
    const action = t.dataset.batch; let settings = null;
    if (action === 'template') { const tpls = await get('/api/templates'); if (!tpls.length) return toast('저장된 템플릿이 없습니다. 설정 → 템플릿에서 먼저 만들어주세요.', 'info', 5000); const m = modal(`<div class="field"><label>템플릿</label><select id="bt-tpl">${tpls.map((x) => `<option value="${x.id}">${esc(x.name)} (${esc(x.kind)})</option>`).join('')}</select></div><button class="btn btn-primary btn-block" id="bt-go">적용</button>`, { title: '템플릿 일괄 적용' }); await new Promise((r) => { m.el.querySelector('#bt-go').onclick = () => { settings = tpls.find((x) => x.id === m.el.querySelector('#bt-tpl').value).settings; m.close(); r(); }; }); if (!settings) return; }
    else if (action === 'ratio') { const ratio = prompt('적용할 화면 비율 (16:9, 9:16, 1:1, 4:5)', '9:16'); if (!ratio) return; settings = { ratio }; }
    else if (action === 'favorite') settings = { favorite: true };
    const bar = qs('#pj-progress'); const txt = qs('#pj-progress-text'); bar.classList.remove('hidden'); let done = 0; const errors = [];
    for (const [k, id] of targets) {
      try {
        if (action === 'trash') await post(`/api/projects/${k}/${id}/trash`);
        else if (action === 'export') await exportProject(k, id);
        else await post(`/api/projects/${k}/${id}/apply`, settings);
      } catch (err) { errors.push(`${id.slice(0, 8)}: ${err.message}`); }
      done += 1; bar.firstElementChild.style.width = `${Math.round((done / targets.length) * 100)}%`; txt.textContent = `${done}/${targets.length} 처리 중...`;
    }
    txt.textContent = `완료 ${done - errors.length}건${errors.length ? ` · 실패 ${errors.length}건: ${errors.join(', ')}` : ''}`;
    toast(`일괄 작업 완료 (${done - errors.length}/${targets.length})`); setTimeout(reload, 800);
  });
});

async function exportProject(kind, id) {
  const res = await fetch(downloadUrl(`/api/projects/${kind}/${id}/export`), { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) { const j = await res.json().catch(() => ({})); return toast(j.error || '내보내기 실패', 'error'); }
  const cd = res.headers.get('content-disposition') || ''; const name = decodeURIComponent((cd.match(/filename\*=UTF-8''(.+)$/) || [])[1] || `project-${id.slice(0, 8)}.alphaman.json`);
  saveBlob(await res.blob(), name); toast('프로젝트 JSON 을 내려받았습니다.');
}
function importDialog(navigate) {
  const m = modal(`<p class="small muted">AlphaMan 프로젝트 파일(.alphaman.json)을 선택하세요. 자막·타임라인·버전·템플릿이 함께 들어오며, 가져오기 전에 형식을 검증합니다.</p><input type="file" id="imp-file" accept=".json,application/json" /><div id="imp-result" class="small" style="margin-top:8px"></div>`, { title: '프로젝트 가져오기' });
  m.el.querySelector('#imp-file').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return; const out = m.el.querySelector('#imp-result');
    try { const data = JSON.parse(await f.text()); const r = await post('/api/projects/import', data); out.innerHTML = `✅ "${esc(r.project.title)}" 가져오기 완료${r.templatesImported ? ` · 템플릿 ${r.templatesImported}개` : ''}. <a href="${esc(r.project.route)}">열기</a>`; toast('가져오기 완료'); setTimeout(() => { m.close(); navigate(`/projects?r=${Date.now()}`); }, 1200); }
    catch (err) { out.innerHTML = `❌ ${esc(err.message)}`; }
  };
}
export async function openVersions(kind, id) {
  const m = modal('<div class="ver-host">불러오는 중...</div>', { title: '버전 기록', wide: true });
  const host = m.el.querySelector('.ver-host');
  const draw = async () => {
    const list = await get(`/api/projects/${kind}/${id}/versions`);
    host.innerHTML = `<div class="row" style="margin-bottom:8px"><input id="ver-label" placeholder="버전 이름 (예: 자막 수정 전)" style="max-width:240px" /><input id="ver-changes" placeholder="변경 내용" /><button class="btn btn-primary" id="ver-save">현재 상태 저장</button></div>
      ${list.length ? list.map((v) => `<div class="row row-between" style="padding:8px 0;border-bottom:1px solid var(--border)"><div><b>Version ${v.number}</b> · ${esc(v.label)}<div class="tiny muted">${fmtDate(v.createdAt)} · ${esc(v.changes || '')} · ${fmtBytes(v.size)}</div></div><div class="row"><button class="btn btn-sm" data-vpreview="${v.id}">미리보기</button><button class="btn btn-sm btn-primary" data-vrestore="${v.id}">복원</button><button class="btn btn-sm btn-danger" data-vdel="${v.id}">삭제</button></div></div>`).join('') : '<p class="muted">저장된 버전이 없습니다. 자막 저장·편집 시 자동으로 기록되며, 지금 상태를 수동으로 저장할 수도 있습니다.</p>'}`;
    host.querySelector('#ver-save').onclick = async () => { await post(`/api/projects/${kind}/${id}/versions`, { label: host.querySelector('#ver-label').value, changes: host.querySelector('#ver-changes').value }); toast('버전을 저장했습니다.'); draw(); };
  };
  on(host, 'click', '[data-vrestore]', async (e, t) => { if (await confirmDialog('이 버전으로 복원할까요? 현재 상태는 자동으로 새 버전으로 저장됩니다.')) { await post(`/api/projects/${kind}/${id}/versions/${t.dataset.vrestore}/restore`); toast('복원했습니다. 페이지를 새로고침하면 반영됩니다.'); draw(); } });
  on(host, 'click', '[data-vdel]', async (e, t) => { await del(`/api/projects/${kind}/${id}/versions/${t.dataset.vdel}`); draw(); });
  on(host, 'click', '[data-vpreview]', async (e, t) => { const v = await get(`/api/projects/${kind}/${id}/versions/${t.dataset.vpreview}`); const s = v.snapshot; const summary = kind === 'subtitle' ? (s.segments || []).slice(0, 30).map((x) => `${fmtTime(x.start)} ${esc(x.text)}`).join('\n') : kind === 'shorts' ? (s.clips || []).map((c) => `${esc(c.title)} (${c.start}→${c.end})`).join('\n') : esc(JSON.stringify({ title: s.result?.plan?.title, subtitles: s.result?.subtitles?.length, timeline: s.result?.timeline?.length, sfx: s.result?.sfx?.length }, null, 1)); modal(`<pre class="log" style="max-height:60vh;white-space:pre-wrap">${summary || '(비어 있음)'}</pre>`, { title: `Version ${v.number} 미리보기` }); });
  draw();
}
export async function openShare(kind, refId, title = '') {
  const m = modal('<div class="share-host">불러오는 중...</div>', { title: '공유 링크' });
  const host = m.el.querySelector('.share-host');
  const draw = async () => {
    const all = (await get('/api/shares')).filter((s) => s.kind === kind && s.refId === refId);
    host.innerHTML = `<p class="small muted">공유 링크를 만든 경우에만 다른 사람이 읽기 전용 미리보기를 볼 수 있습니다. 언제든 취소할 수 있습니다.</p><div class="row"><select id="sh-days" style="width:auto"><option value="7">7일</option><option value="30" selected>30일</option><option value="90">90일</option><option value="365">1년</option></select><label class="check"><input type="checkbox" id="sh-dl"/> 다운로드 허용</label><button class="btn btn-primary" id="sh-make">링크 만들기</button></div>
      ${all.map((s) => { const url = `${location.origin}/#/share/${s.token}`; return `<div style="padding:8px 0;border-top:1px solid var(--border)"><div class="row row-between"><code class="small" style="word-break:break-all">${esc(url)}</code><div class="row"><button class="btn btn-sm" data-copy="${esc(url)}">복사</button>${s.revokedAt ? '<span class="badge badge-soft">취소됨</span>' : `<button class="btn btn-sm btn-danger" data-revoke="${s.id}">취소</button>`}</div></div><div class="tiny muted">만료 ${fmtDate(s.expiresAt)} · 조회 ${s.views}</div></div>`; }).join('')}`;
    host.querySelector('#sh-make').onclick = async () => { await post('/api/shares', { kind, refId, expiresDays: Number(host.querySelector('#sh-days').value), allowDownload: host.querySelector('#sh-dl').checked, title }); draw(); };
  };
  on(host, 'click', '[data-copy]', (e, t) => { navigator.clipboard?.writeText(t.dataset.copy); toast('링크를 복사했습니다.'); });
  on(host, 'click', '[data-revoke]', async (e, t) => { await post(`/api/shares/${t.dataset.revoke}/revoke`); draw(); });
  draw();
}

// ---------------- 작업 센터 + 히스토리 ----------------
export const jobs = auth(async ({ view, params, state, navigate }) => {
  const tab = params.tab || 'active';
  let timer = null;
  const draw = async () => {
    let data;
    try { data = await get(`/api/activities?${new URLSearchParams(tab === 'active' ? { status: 'active' } : tab === 'all' ? {} : { status: tab })}`); } catch (err) { view.innerHTML = errorScreen(err, { retry: draw }); return; }
    const { items, counts, queue } = data;
    const tabs = [['active', `진행 중 ${counts.queued + counts.processing}`], ['done', `완료 ${counts.done}`], ['failed', `실패 ${counts.failed}`], ['cancelled', `취소 ${counts.cancelled}`], ['all', '전체 기록']];
    view.innerHTML = html`<div class="row row-between"><div><h1>⚙️ 작업 센터</h1><p class="muted">AI 작업의 대기·처리·완료·실패·취소 상태와 진행률, 실행 시간, 결과를 확인하고 취소·재시도·다시 실행합니다.</p></div><div class="row"><span class="badge badge-soft">동시 실행 ${queue.concurrency} · 실행 ${queue.running.length} · 대기 ${queue.queued.length}</span><button class="btn btn-sm" id="jb-clear">끝난 작업 기록 정리</button></div></div>
      <div class="tabs">${raw(tabs.map(([k, l]) => `<a class="tab ${k === tab ? 'active' : ''}" href="#/jobs?tab=${k}">${esc(l)}</a>`).join(''))}</div>
      ${items.length ? raw(items.map(row).join('')) : raw(emptyState(tab === 'active' ? '진행 중인 작업이 없습니다.' : '작업 기록이 없습니다.', '쇼츠 제작·AI 재구성·롱폼·자막·SEO·썸네일·TTS 작업이 실행되면 여기에 기록됩니다.', [['#/studio', '쇼츠 만들기']]))}`;
    function row(a) {
      const link = a.result?.link || (a.projectKind && a.refId ? { shorts: `#/studio/${a.refId}`, remix: `#/remix/${a.refId}`, longform: `#/longform/${a.refId}`, subtitle: `#/subtitles/${a.refId}` }[a.projectKind] : null);
      const active = ['queued', 'processing'].includes(a.status);
      const elapsed = a.durationMs != null ? `${Math.round(a.durationMs / 1000)}초` : active ? `${Math.round((Date.now() - new Date(a.startedAt).getTime()) / 1000)}초 경과` : '';
      return `<div class="card job-row" id="act-${a.id}"><div class="row row-between" style="flex-wrap:wrap;gap:8px"><div><b>${esc(a.kindLabel)}</b> · ${esc(a.title || '-')} ${statusBadge(a.status)}<div class="tiny muted">시작 ${fmtDate(a.startedAt)} · ${elapsed}${a.estimatedSec && active ? ` · 예상 약 ${a.estimatedSec}초` : ''}${a.step ? ` · 단계: ${esc(a.step)}` : ''}${a.error ? ` · <span style="color:var(--danger)">${esc(a.error)}</span>` : ''}</div>${active ? `<div class="progress" style="margin-top:6px;max-width:420px"><div style="width:${a.progress || 0}%"></div></div>` : ''}</div>
        <div class="row" style="flex-wrap:wrap">${link ? `<a class="btn btn-sm btn-primary" href="${esc(link)}">결과 보기</a>` : ''}${a.result && !link ? `<button class="btn btn-sm" data-result="${a.id}">결과</button>` : ''}${active ? `<button class="btn btn-sm btn-danger" data-cancel="${a.id}">취소</button>` : ''}${a.status === 'failed' && a.input ? `<button class="btn btn-sm btn-primary" data-rerun="${a.id}">재시도</button>` : ''}${!active && a.input && a.status !== 'failed' ? `<button class="btn btn-sm" data-rerun="${a.id}">다시 실행</button>` : ''}${!active ? `<button class="btn btn-sm btn-ghost" data-remove="${a.id}">삭제</button>` : ''}</div></div></div>`;
    }
    if (params.id) { const el = qs(`#act-${params.id}`); if (el) { el.scrollIntoView({ block: 'center' }); el.style.outline = '2px solid var(--primary)'; } }
    qs('#jb-clear').onclick = async () => { if (await confirmDialog('완료·실패·취소된 작업 기록을 모두 지울까요?')) { await post('/api/activities/clear'); draw(); } };
  };
  on(view, 'click', '[data-cancel]', async (e, t) => { if (!(await confirmDialog('작업을 취소할까요? 차감된 이용권은 환불됩니다.'))) return; try { await post(`/api/activities/${t.dataset.cancel}/cancel`); toast('취소 요청을 보냈습니다.'); draw(); } catch (err) { toast(err.message, 'error'); } });
  on(view, 'click', '[data-rerun]', async (e, t) => { if (!(await confirmDialog('같은 입력으로 작업을 다시 실행합니다. AI 작업은 이용권이 차감됩니다. 진행할까요?'))) return; t.disabled = true; try { const r = await post(`/api/activities/${t.dataset.rerun}/rerun`); toast('다시 실행했습니다.'); await window.AlphaManApp.refreshUser(); navigate('/jobs?tab=active'); } catch (err) { toast(err.message, 'error', 6000); t.disabled = false; } });
  on(view, 'click', '[data-remove]', async (e, t) => { await del(`/api/activities/${t.dataset.remove}`); draw(); });
  on(view, 'click', '[data-result]', async (e, t) => { const a = await get(`/api/activities/${t.dataset.result}`); modal(`<pre class="log" style="white-space:pre-wrap;max-height:60vh">${esc(JSON.stringify(a.result, null, 2))}</pre>`, { title: '실행 결과' }); });
  await draw();
  if (tab === 'active') { timer = setInterval(() => { if (!location.hash.startsWith('#/jobs')) return clearInterval(timer); draw(); }, 2500); window.addEventListener('hashchange', () => clearInterval(timer), { once: true }); }
});

// ---------------- 파일 관리자 ----------------
export const media = auth(async ({ view, params, state, navigate }) => {
  const f = { category: params.category || '', q: params.q || '', sort: params.sort || 'recent', trash: params.trash || '' };
  const link = (o) => `#/media?${new URLSearchParams({ ...f, ...o }).toString()}`;
  view.innerHTML = skeleton(3);
  let data;
  try { data = await get(`/api/media?${new URLSearchParams(f)}`); } catch (err) { view.innerHTML = errorScreen(err, { retry: () => navigate(link({ r: Date.now() })) }); return; }
  const { items, categories, usage } = data;
  const pct = Math.min(100, Math.round((usage.bytes / usage.limitBytes) * 100));
  view.innerHTML = html`<div class="row row-between" style="flex-wrap:wrap"><div><h1>🗂️ 파일 관리자</h1><p class="muted">업로드한 영상·오디오·이미지, 자막, 렌더링 결과를 한곳에서 관리합니다.</p></div><div><label class="btn btn-primary" for="md-upload">📤 파일 업로드</label><input type="file" id="md-upload" class="hidden" multiple accept="video/*,audio/*,image/*,.srt,.vtt" /></div></div>
    <div class="card" style="margin-bottom:10px"><div class="row row-between"><span class="small">저장공간 ${fmtBytes(usage.bytes)} / ${fmtBytes(usage.limitBytes)} · 파일 ${usage.files}개 · 휴지통 ${usage.trash}개</span><span class="tiny muted">${pct}%</span></div><div class="progress"><div style="width:${pct}%"></div></div></div>
    <div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:10px"><div class="chips"><a class="chip ${!f.category && !f.trash ? 'active' : ''}" href="${link({ category: '', trash: '' })}">전체</a>${raw(Object.entries(categories).map(([k, l]) => `<a class="chip ${f.category === k ? 'active' : ''}" href="${link({ category: k, trash: '' })}">${esc(l)} ${usage.byCategory[k] || 0}</a>`).join(''))}<a class="chip ${f.trash ? 'active' : ''}" href="${link({ trash: f.trash ? '' : '1' })}">🗑️ 휴지통</a></div>
      <form id="md-search" class="row" style="gap:6px"><input id="md-q" value="${f.q}" placeholder="파일 검색" aria-label="파일 검색" style="max-width:220px" /><button class="btn btn-sm" type="submit">검색</button></form><select id="md-sort" aria-label="정렬" style="width:auto">${raw([['recent', '최신순'], ['oldest', '오래된순'], ['name', '이름순'], ['size', '크기순']].map(([v, l]) => `<option value="${v}" ${f.sort === v ? 'selected' : ''}>${l}</option>`).join(''))}</select></div>
    ${items.length ? raw(`<div class="card table-wrap"><table class="table media-table"><tr><th>파일</th><th>분류</th><th>크기</th><th>날짜</th><th></th></tr>${items.map(row).join('')}</table></div>`) : raw(emptyState(f.trash ? '휴지통이 비어 있습니다.' : '파일이 없습니다.', '영상을 올리면 쇼츠·재구성·자막 작업에 바로 쓸 수 있습니다.', [['#', '파일 업로드', 'md-upload-empty']]))}`;
  function row(m) {
    const icon = { video: '🎞️', audio: '🎵', image: '🖼️', subtitle: '💬', output: '📦' }[m.category] || '📄';
    return `<tr><td>${icon} <b>${esc(m.name)}</b>${m.durationSec ? ` <span class="tiny muted">${fmtTime(m.durationSec)}</span>` : ''}${m.usedBy?.length ? `<div class="tiny muted">사용 중: ${m.usedBy.map((u) => `<a href="${esc(u.route)}">${esc(u.kind)}</a>`).join(', ')}</div>` : ''}${m.projectRoute ? `<div class="tiny"><a href="${esc(m.projectRoute)}">프로젝트 열기 →</a></div>` : ''}${!m.available ? '<div class="tiny" style="color:var(--danger)">원본 파일이 서버에 없습니다</div>' : ''}</td><td>${esc(categories[m.category] || m.category)}${m.subtype ? ` · ${esc(m.subtype)}` : ''}</td><td>${fmtBytes(m.size)}</td><td>${fmtDate(m.createdAt)}</td>
      <td><div class="row" style="flex-wrap:wrap;justify-content:flex-end">${m.deletedAt ? `<button class="btn btn-sm btn-primary" data-restore="${esc(m.id)}">복구</button>${m.category !== 'subtitle' ? `<button class="btn btn-sm btn-danger" data-destroy="${esc(m.id)}">영구 삭제</button>` : ''}` : `${m.previewable && m.url ? `<button class="btn btn-sm" data-preview="${esc(m.id)}">미리보기</button>` : ''}${m.downloadUrl ? `<button class="btn btn-sm" data-download="${esc(m.id)}">다운로드</button>` : ''}${m.category === 'video' && m.id.startsWith('upload:') ? `<button class="btn btn-sm btn-primary" data-use="${esc(m.id)}">프로젝트에 추가</button>` : ''}${!m.id.startsWith('thumb:') ? `<button class="btn btn-sm" data-rename="${esc(m.id)}">이름</button><button class="btn btn-sm btn-danger" data-trash="${esc(m.id)}">휴지통</button>` : ''}`}</div></td></tr>`;
  }
  const reload = () => navigate(link({ r: Date.now() }));
  qs('#md-search').onsubmit = (e) => { e.preventDefault(); navigate(link({ q: qs('#md-q').value.trim() })); };
  qs('#md-sort').onchange = (e) => navigate(link({ sort: e.target.value }));
  const upEl = qs('#md-upload'); const ue = qs('#md-upload-empty'); if (ue) ue.onclick = (e) => { e.preventDefault(); upEl.click(); };
  upEl.onchange = async (e) => { const { uploadFile } = await import('./api.js'); let ok = 0; for (const f of e.target.files) { try { await uploadFile(f); ok += 1; } catch (err) { toast(`${f.name}: ${err.message}`, 'error', 6000); } } if (ok) { toast(`${ok}개 업로드 완료`); reload(); } };
  on(view, 'click', '[data-preview]', (e, t) => { const m = items.find((x) => x.id === t.dataset.preview); if (m.category === 'output' && m.libraryId) return openPreview({ libraryId: m.libraryId }); const url = downloadUrl(m.url); const body = m.category === 'image' ? `<img src="${esc(url)}" alt="" style="max-width:100%;max-height:70vh;border-radius:10px" />` : m.category === 'audio' ? `<audio controls autoplay src="${esc(url)}" style="width:100%"></audio>` : `<video controls autoplay playsinline src="${esc(url)}" style="width:100%;max-height:70vh;border-radius:10px"></video>`; modal(body, { title: m.name, wide: true }); });
  on(view, 'click', '[data-download]', async (e, t) => { const m = items.find((x) => x.id === t.dataset.download); const res = await fetch(downloadUrl(m.downloadUrl), { headers: { Authorization: `Bearer ${getToken()}` } }); if (!res.ok) return toast('다운로드 실패', 'error'); saveBlob(await res.blob(), m.name.includes('.') ? m.name : `${m.name}.${m.category === 'output' ? 'mp4' : m.category === 'subtitle' ? 'srt' : 'bin'}`); });
  on(view, 'click', '[data-use]', (e, t) => { const id = t.dataset.use.replace('upload:', ''); const m = modal(`<p class="small muted">이 파일로 어떤 작업을 시작할까요?</p><div class="row" style="flex-wrap:wrap"><a class="btn btn-primary" href="#/studio?upload=${id}">쇼츠 만들기</a><a class="btn" href="#/remix?upload=${id}">AI 재구성</a><a class="btn" href="#/subtitles?upload=${id}">자막 만들기</a><a class="btn" href="#/longform?upload=${id}">롱폼 컷편집</a></div>`, { title: '프로젝트에 추가' }); m.el.querySelectorAll('a').forEach((a) => { a.onclick = () => m.close(); }); });
  on(view, 'click', '[data-rename]', async (e, t) => { const m = items.find((x) => x.id === t.dataset.rename); const name = prompt('새 이름', m.name); if (name && name !== m.name) { try { await patch(`/api/media/${encodeURIComponent(t.dataset.rename)}`, { name }); reload(); } catch (err) { toast(err.message, 'error'); } } });
  on(view, 'click', '[data-trash]', async (e, t) => { try { await post(`/api/media/${encodeURIComponent(t.dataset.trash)}/trash`); toast('휴지통으로 이동했습니다.'); reload(); } catch (err) { toast(err.message, 'error'); } });
  on(view, 'click', '[data-restore]', async (e, t) => { await post(`/api/media/${encodeURIComponent(t.dataset.restore)}/restore`); reload(); });
  on(view, 'click', '[data-destroy]', async (e, t) => { if (await confirmDialog('영구 삭제할까요? 되돌릴 수 없습니다.')) { try { await del(`/api/media/${encodeURIComponent(t.dataset.destroy)}`); reload(); } catch (err) { toast(err.message, 'error'); } } });
});

// ---------------- 전체 검색 ----------------
export const search = auth(async ({ view, params, navigate }) => {
  const q = params.q || '';
  view.innerHTML = html`<h1>🔍 검색</h1><form id="gs-form" class="row" style="gap:6px;margin-bottom:12px"><input id="gs-q" value="${q}" placeholder="프로젝트 · 파일 · 자막 문장 · 템플릿 · 작업 기록 검색" aria-label="전체 검색" autofocus /><button class="btn btn-primary" type="submit">검색</button></form><div id="gs-results">${q ? raw(skeleton(3)) : raw(emptyState('검색어를 입력하세요.', '프로젝트, 영상/이미지/오디오 파일, 자막 문장, 템플릿, 작업 기록을 한 번에 찾습니다.'))}</div>`;
  qs('#gs-form').onsubmit = (e) => { e.preventDefault(); navigate(`/search?q=${encodeURIComponent(qs('#gs-q').value.trim())}`); };
  if (!q) return;
  try {
    const { results } = await get(`/api/search?q=${encodeURIComponent(q)}`);
    const icon = { project: '📂', media: '🗂️', template: '🎨', activity: '⚙️', 'subtitle-line': '💬' };
    qs('#gs-results').innerHTML = results.length ? `<div class="card">${results.map((r) => `<a class="search-row" href="${esc(r.route)}"><span class="ico">${icon[r.type] || '•'}</span><div><b>${esc(r.title)}</b><div class="tiny muted">${esc(r.subtitle)} · ${fmtDate(r.at)}</div></div></a>`).join('')}</div>` : emptyState(`"${q}" 에 대한 결과가 없습니다.`, '다른 검색어로 시도해보세요.');
  } catch (err) { qs('#gs-results').innerHTML = errorScreen(err, { retry: () => navigate(`/search?q=${encodeURIComponent(q)}&r=${Date.now()}`) }); }
});

// ---------------- 설정 (사용자 설정 · 템플릿 · 단축키 · 사용량 · 공유 링크) ----------------
export const settings = auth(async ({ view, params, state, navigate }) => {
  const tab = params.tab || 'general';
  const u = state.user; const prefs = u.prefs || {};
  const tabs = [['general', '일반'], ['editor', '편집기 기본값'], ['notifications', '알림'], ['templates', '템플릿'], ['shortcuts', '단축키'], ['usage', '사용량'], ['shares', '공유 링크'], ['privacy', '개인정보']];
  let body = '';
  if (tab === 'general') body = html`<div class="card"><h3>일반</h3><div class="grid grid-2"><div class="field"><label>언어</label><select id="st-locale">${raw(state.info.locales.map((l) => `<option value="${l.code}" ${l.code === u.locale ? 'selected' : ''}>${esc(l.label)}</option>`).join(''))}</select></div><div class="field"><label>테마 (다크모드)</label><select id="st-theme">${raw([['system', '시스템 설정 따르기'], ['light', '라이트'], ['dark', '다크']].map(([v, l]) => `<option value="${v}" ${v === u.theme ? 'selected' : ''}>${l}</option>`).join(''))}</select></div></div>
    <label class="check"><input type="checkbox" id="st-autosave" ${prefs.autosave !== false ? 'checked' : ''}/> 편집 중 자동 저장 (자막 편집기)</label><label class="check"><input type="checkbox" id="st-reduce" ${prefs.reduceMotion ? 'checked' : ''}/> 애니메이션 줄이기</label><label class="check"><input type="checkbox" id="st-mobile" ${prefs.mobileEditor !== false ? 'checked' : ''}/> 모바일에서 큰 터치 영역 사용</label>
    <button class="btn btn-primary" id="st-save-general" style="margin-top:8px">저장</button></div>`;
  else if (tab === 'editor') { const { templates, ratios } = await get('/api/shorts/templates'); const { presets } = await get('/api/subtitles/fonts'); body = html`<div class="card"><h3>편집기 기본값</h3><div class="grid grid-3"><div class="field"><label>기본 화면 비율</label><select id="st-ratio">${raw(ratios.map((r) => `<option ${r === (prefs.defaultRatio || '9:16') ? 'selected' : ''}>${r}</option>`).join(''))}</select></div><div class="field"><label>기본 자막 스타일</label><select id="st-preset">${raw(presets.map((p) => `<option value="${p.id}" ${p.id === prefs.defaultSubtitlePreset ? 'selected' : ''}>${esc(p.name)}</option>`).join(''))}</select></div><div class="field"><label>기본 영상 품질</label><select id="st-quality">${raw([['720p', '720p (빠름)'], ['1080p', '1080p (기본)'], ['1440p', '1440p'], ['2160p', '4K']].map(([v, l]) => `<option value="${v}" ${v === (prefs.quality || '1080p') ? 'selected' : ''}>${l}</option>`).join(''))}</select></div></div><div class="tiny muted">새 작업을 만들 때 이 값이 기본으로 선택됩니다. 렌더 품질은 ffmpeg 이 있는 프로그램 버전에서 적용됩니다.</div><button class="btn btn-primary" id="st-save-editor" style="margin-top:8px">저장</button></div>`; }
  else if (tab === 'notifications') body = html`<div class="card"><h3>알림</h3><label class="check"><input type="checkbox" id="st-notif" ${prefs.notifications !== false ? 'checked' : ''}/> 앱 내 알림 (영상 처리 완료 · 렌더링 완료 · AI 작업 완료 · 작업 실패 · 저장 완료 · 시스템 공지)</label><label class="check"><input type="checkbox" id="st-notif-email" ${prefs.notifyEmail ? 'checked' : ''}/> 이메일로도 받기 (이메일 발송 서비스 연결 시)</label><label class="check"><input type="checkbox" id="st-push" ${prefs.push ? 'checked' : ''}/> 브라우저 푸시 알림 (PWA 설치 시)</label><button class="btn btn-primary" id="st-save-notif" style="margin-top:8px">저장</button><div class="tiny muted" style="margin-top:8px">알림은 상단 🔔 (Alt+T) 에서 읽음 처리·모두 읽음·삭제할 수 있습니다.</div></div>`;
  else if (tab === 'templates') { const list = await get('/api/templates'); body = html`<div class="card"><div class="row row-between"><h3>내 템플릿 (${list.length})</h3><button class="btn btn-primary btn-sm" id="tp-new">+ 새 템플릿</button></div><p class="small muted">자막 스타일 · 텍스트 스타일 · 효과/전환 · 화면 비율 · 기본 옵션을 저장해 두고 다른 프로젝트에 적용합니다 (프로젝트 페이지의 일괄 적용, 자막 편집기의 템플릿 적용).</p>
    ${list.length ? raw(list.map((t) => `<div class="row row-between" style="padding:8px 0;border-bottom:1px solid var(--border)"><div><b>${esc(t.name)}</b> <span class="badge badge-soft">${esc(state.info.templateKinds?.[t.kind] || t.kind)}</span><div class="tiny muted">${esc(t.description || '')} · ${Object.keys(t.settings).join(', ')} · 사용 ${t.uses || 0}회</div></div><div class="row"><button class="btn btn-sm" data-tedit="${t.id}">편집</button><button class="btn btn-sm btn-danger" data-tdel="${t.id}">삭제</button></div></div>`).join('')) : raw(emptyState('저장된 템플릿이 없습니다.', '자막 편집기의 "스타일을 템플릿으로 저장" 또는 여기서 새로 만들 수 있습니다.'))}</div>`; }
  else if (tab === 'shortcuts') body = html`<div class="card"><h3>키보드 단축키</h3><label class="check"><input type="checkbox" id="st-shortcuts" ${prefs.shortcuts !== false ? 'checked' : ''}/> 단축키 사용</label><div class="table-wrap" style="margin-top:8px"><table class="table">${raw(SHORTCUTS.map(([k, d]) => `<tr><td><span class="kbd">${esc(k)}</span></td><td>${esc(d)}</td></tr>`).join(''))}</table></div><button class="btn btn-primary" id="st-save-shortcuts" style="margin-top:8px">저장</button> <button class="btn" id="st-help">도움말 창 보기 (?)</button></div>`;
  else if (tab === 'usage') { const us = await get('/api/usage'); const pct = Math.min(100, Math.round((us.storage.usedBytes / us.storage.limitBytes) * 100)); body = html`<div class="grid grid-2"><div class="card"><h3>저장공간</h3><div style="font-size:1.4rem;font-weight:900">${fmtBytes(us.storage.usedBytes)} <span class="small muted">/ ${fmtBytes(us.storage.limitBytes)}</span></div><div class="progress" style="margin:6px 0"><div style="width:${pct}%"></div></div><div class="tiny muted">파일 ${us.storage.files}개 · ${raw(Object.entries(us.storage.byCategory).map(([k, v]) => `${esc(state.info.mediaCategories?.[k] || k)} ${v}`).join(' · '))}</div><a class="small" href="#/media">파일 관리자 →</a></div>
    <div class="card"><h3>작업</h3><div class="chips"><span class="chip">처리 중 ${us.jobs.active}</span><span class="chip">완료 ${us.jobs.done}</span><span class="chip">실패 ${us.jobs.failed}</span></div><div class="tiny muted" style="margin-top:6px">${raw(Object.entries(us.ai.byKind).map(([k, v]) => `${esc(state.info.activityKinds?.[k] || k)} ${v}`).join(' · ') || '기록 없음')}</div><a class="small" href="#/jobs?tab=all">작업 센터 →</a></div>
    <div class="card"><h3>생성된 결과물</h3><div style="font-size:1.4rem;font-weight:900">${us.outputs.total}개</div><div class="tiny muted">렌더된 MP4 ${us.outputs.rendered}개</div><a class="small" href="#/library">보관함 →</a></div>
    <div class="card"><h3>AI 사용량 (최근 30일)</h3><div style="font-size:1.4rem;font-weight:900">${us.ai.chargedMinutes30d}분 차감</div><div class="tiny muted">${us.credits.creditsUnlimited ? `관리자 무제한 (차감 없이 ${us.ai.wouldChargeMinutes30d}분 사용)` : `잔여 이용권 ${us.credits.credits}분`}</div><a class="small" href="#/credits">이용권 내역 →</a></div></div>`; }
  else if (tab === 'shares') { const list = await get('/api/shares'); body = html`<div class="card"><h3>공유 링크 (${list.length})</h3><p class="small muted">내가 명시적으로 만든 링크만 접근할 수 있습니다. 취소하면 즉시 접근이 막힙니다.</p>${list.length ? raw(list.map((s) => `<div class="row row-between" style="padding:8px 0;border-bottom:1px solid var(--border)"><div><b>${esc(s.title || s.kind)}</b> ${s.revokedAt ? '<span class="badge badge-soft">취소됨</span>' : new Date(s.expiresAt) < new Date() ? '<span class="badge badge-warn">만료</span>' : '<span class="badge badge-success">활성</span>'}<div class="tiny muted"><code>${location.origin}/#/share/${esc(s.token)}</code> · 만료 ${fmtDate(s.expiresAt)} · 조회 ${s.views}</div></div><div class="row"><button class="btn btn-sm" data-copy="${location.origin}/#/share/${esc(s.token)}">복사</button>${!s.revokedAt ? `<button class="btn btn-sm btn-danger" data-revoke="${s.id}">취소</button>` : `<button class="btn btn-sm" data-sdel="${s.id}">삭제</button>`}</div></div>`).join('')) : raw(emptyState('공유 링크가 없습니다.', '프로젝트 카드의 "공유" 버튼으로 읽기 전용 링크를 만들 수 있습니다.'))}</div>`; }
  else if (tab === 'privacy') body = html`<div class="card"><h3>개인정보 설정</h3><label class="check"><input type="checkbox" id="st-marketing" ${u.marketingOptIn ? 'checked' : ''}/> 마케팅 정보 수신 동의</label><label class="check"><input type="checkbox" id="st-analytics" ${prefs.privacyAnalytics !== false ? 'checked' : ''}/> 오류 진단 정보 전송 (오류 화면 개선에만 사용)</label><div class="field" style="margin-top:8px"><label>공유 링크 기본 만료</label><select id="st-share-days">${raw([7, 30, 90, 365].map((d) => `<option value="${d}" ${Number(prefs.shareDefaultDays || 30) === d ? 'selected' : ''}>${d}일</option>`).join(''))}</select></div><button class="btn btn-primary" id="st-save-privacy">저장</button><hr style="border:0;border-top:1px solid var(--border);margin:14px 0"/><div class="small muted">내 데이터 내보내기: 프로젝트 페이지에서 프로젝트별 JSON 으로 내려받을 수 있습니다. 계정 삭제는 <a href="#/support">문의하기</a>로 요청해주세요. <a href="#/privacy">개인정보처리방침</a></div></div>`;
  view.innerHTML = html`<h1>⚙️ 설정</h1><div class="tabs">${raw(tabs.map(([k, l]) => `<a class="tab ${k === tab ? 'active' : ''}" href="#/settings?tab=${k}">${esc(l)}</a>`).join(''))}</div>${raw(body)}`;
  const savePrefs = async (prefsPatch, extra = {}) => { try { await patch('/api/auth/me', { ...extra, prefs: prefsPatch }); await window.AlphaManApp.refreshUser(); toast('저장되었습니다.'); } catch (err) { toast(err.message, 'error'); } };
  const b = (id) => qs(id);
  if (b('#st-save-general')) b('#st-save-general').onclick = () => { document.documentElement.setAttribute('data-theme', b('#st-theme').value); try { localStorage.setItem('am_theme', b('#st-theme').value); } catch { /* ignore */ } document.body.classList.toggle('reduce-motion', b('#st-reduce').checked); savePrefs({ autosave: b('#st-autosave').checked, reduceMotion: b('#st-reduce').checked, mobileEditor: b('#st-mobile').checked }, { locale: b('#st-locale').value, theme: b('#st-theme').value }); };
  if (b('#st-save-editor')) b('#st-save-editor').onclick = () => savePrefs({ defaultRatio: b('#st-ratio').value, defaultSubtitlePreset: b('#st-preset').value, quality: b('#st-quality').value });
  if (b('#st-save-notif')) b('#st-save-notif').onclick = async () => { if (b('#st-push').checked && 'Notification' in window && Notification.permission !== 'granted') await Notification.requestPermission(); savePrefs({ notifications: b('#st-notif').checked, notifyEmail: b('#st-notif-email').checked, push: b('#st-push').checked }); };
  if (b('#st-save-shortcuts')) b('#st-save-shortcuts').onclick = () => savePrefs({ shortcuts: b('#st-shortcuts').checked });
  if (b('#st-help')) b('#st-help').onclick = () => showShortcutHelp();
  if (b('#st-save-privacy')) b('#st-save-privacy').onclick = () => savePrefs({ privacyAnalytics: b('#st-analytics').checked, shareDefaultDays: Number(b('#st-share-days').value) }, { marketingOptIn: b('#st-marketing').checked });
  if (b('#tp-new')) b('#tp-new').onclick = () => templateDialog(null, () => navigate(`/settings?tab=templates&r=${Date.now()}`), state);
  on(view, 'click', '[data-tedit]', async (e, t) => templateDialog(await get('/api/templates').then((l) => l.find((x) => x.id === t.dataset.tedit)), () => navigate(`/settings?tab=templates&r=${Date.now()}`), state));
  on(view, 'click', '[data-tdel]', async (e, t) => { if (await confirmDialog('템플릿을 삭제할까요?')) { await del(`/api/templates/${t.dataset.tdel}`); navigate(`/settings?tab=templates&r=${Date.now()}`); } });
  on(view, 'click', '[data-copy]', (e, t) => { navigator.clipboard?.writeText(t.dataset.copy); toast('복사했습니다.'); });
  on(view, 'click', '[data-revoke]', async (e, t) => { await post(`/api/shares/${t.dataset.revoke}/revoke`); navigate(`/settings?tab=shares&r=${Date.now()}`); });
  on(view, 'click', '[data-sdel]', async (e, t) => { await del(`/api/shares/${t.dataset.sdel}`); navigate(`/settings?tab=shares&r=${Date.now()}`); });
});
export function templateDialog(existing, onSaved, state) {
  const s = existing?.settings || {};
  const m = modal(html`<div class="grid grid-2"><div class="field"><label>이름</label><input id="tp-name" value="${existing?.name || ''}" /></div><div class="field"><label>종류</label><select id="tp-kind">${raw(Object.entries(state.info.templateKinds || {}).map(([k, l]) => `<option value="${k}" ${k === (existing?.kind || 'general') ? 'selected' : ''}>${esc(l)}</option>`).join(''))}</select></div></div>
    <div class="field"><label>설명</label><input id="tp-desc" value="${existing?.description || ''}" /></div>
    <div class="grid grid-3"><div class="field"><label>화면 비율</label><select id="tp-ratio"><option value="">-</option>${raw(['16:9', '9:16', '1:1', '4:5'].map((r) => `<option ${r === s.ratio ? 'selected' : ''}>${r}</option>`).join(''))}</select></div><div class="field"><label>자막 템플릿 ID</label><input id="tp-tpl" value="${s.templateId || ''}" placeholder="예: neon" /></div><div class="field"><label>전환</label><select id="tp-trans"><option value="">-</option>${raw(['auto', 'hard-cut', 'crossfade', 'zoom'].map((r) => `<option ${r === s.transitions ? 'selected' : ''}>${r}</option>`).join(''))}</select></div></div>
    <div class="grid grid-3"><div class="field"><label>자막 글자색</label><input id="tp-color" type="color" value="${s.subtitleStyle?.color || '#ffffff'}" /></div><div class="field"><label>외곽선</label><input id="tp-outline" type="color" value="${s.subtitleStyle?.outline || '#000000'}" /></div><div class="field"><label>자막 크기</label><input id="tp-size" type="number" value="${s.subtitleStyle?.size || 56}" /></div></div>
    <div class="grid grid-2"><div class="field"><label>자막 위치</label><select id="tp-pos">${raw(['bottom', 'center', 'top'].map((r) => `<option ${r === (s.subtitleStyle?.position || 'bottom') ? 'selected' : ''}>${r}</option>`).join(''))}</select></div><div class="field"><label>애니메이션 효과</label><select id="tp-anim">${raw(['none', 'pop', 'fade', 'bounce', 'karaoke', 'word-highlight', 'slide'].map((r) => `<option ${r === (s.subtitleStyle?.animation || 'pop') ? 'selected' : ''}>${r}</option>`).join(''))}</select></div></div>
    <div class="field"><label>마무리 카드 문구</label><input id="tp-outro" value="${s.outroText || ''}" placeholder="구독 · 좋아요 · 알림 설정 🔔" /></div>
    <button class="btn btn-primary btn-block" id="tp-save">저장</button>`, { title: existing?.id ? '템플릿 편집' : '새 템플릿', wide: true });
  m.el.querySelector('#tp-save').onclick = async () => {
    const g = (id) => m.el.querySelector(id).value;
    const settings = { ratio: g('#tp-ratio') || undefined, templateId: g('#tp-tpl') || undefined, transitions: g('#tp-trans') || undefined, subtitleStyle: { color: g('#tp-color'), outline: g('#tp-outline'), size: Number(g('#tp-size')), position: g('#tp-pos'), animation: g('#tp-anim') }, outroText: g('#tp-outro') || undefined };
    try { if (existing?.id) await patch(`/api/templates/${existing.id}`, { name: g('#tp-name'), kind: g('#tp-kind'), description: g('#tp-desc'), settings }); else await post('/api/templates', { name: g('#tp-name'), kind: g('#tp-kind'), description: g('#tp-desc'), settings }); m.close(); toast('템플릿을 저장했습니다.'); onSaved && onSaved(); } catch (err) { toast(err.message, 'error'); }
  };
}

// ---------------- 공유 보기 (공개) ----------------
export async function shareView({ view, params }) {
  view.innerHTML = skeleton(2);
  try {
    const s = await get(`/api/share/${encodeURIComponent(params.token)}`);
    view.innerHTML = html`<div class="card" style="max-width:960px;margin:0 auto"><div class="row row-between"><h1 style="font-size:1.3rem">${s.title}</h1><span class="badge badge-soft">공유 · ${{ shorts: '쇼츠', remix: 'AI 재구성', longform: '롱폼' }[s.kind] || s.kind}</span></div><div id="share-player"></div><div class="tiny muted" style="margin-top:8px">읽기 전용 미리보기 · 만료 ${fmtDate(s.expiresAt)} · <a href="#/">AlphaMan 으로 만들기</a></div></div>`;
    await mountPlayer(qs('#share-player'), s.preview, { autoplay: false });
  } catch (err) { view.innerHTML = errorScreen(err, { back: '#/' }); }
}

// ---------------- 결제 완료 / 실패 (토스페이먼츠 · Stripe 리다이렉트) ----------------
export const paySuccess = auth(async ({ view, params: routeParams, navigate }) => {
  const params = { ...Object.fromEntries(new URLSearchParams(location.search)), ...routeParams };
  view.innerHTML = '<div class="card" style="max-width:520px;margin:40px auto;text-align:center"><h2>결제 승인 중...</h2><div class="progress"><div style="width:60%"></div></div><p class="muted small">잠시만 기다려주세요. 창을 닫지 마세요.</p></div>';
  try {
    let r;
    if (params.paymentKey) r = await post('/api/billing/toss/confirm', { paymentKey: params.paymentKey, orderId: params.orderId, amount: Number(params.amount) });
    else if (params.session_id) r = await post('/api/billing/stripe/confirm', { sessionId: params.session_id, orderId: params.orderId });
    else throw new Error('결제 정보가 없습니다.');
    await window.AlphaManApp.refreshUser();
    if (r.pending) { view.innerHTML = `<div class="card" style="max-width:520px;margin:40px auto;text-align:center"><h2>입금 대기</h2><p>${esc(r.message)}</p><a class="btn btn-primary" href="#/credits">이용권 확인</a></div>`; return; }
    view.innerHTML = html`<div class="card" style="max-width:520px;margin:40px auto;text-align:center"><div style="font-size:3rem">✅</div><h2>결제가 완료되었습니다</h2><p class="muted">${r.planId} · ${r.currency === 'USD' ? `$${r.amount}` : fmtKRW(r.amount)}${r.testMode ? ' · 테스트 결제(실제 청구 없음)' : ''}</p>${r.receiptUrl ? raw(`<a class="btn btn-sm" href="${esc(r.receiptUrl)}" target="_blank" rel="noopener">영수증 보기</a> `) : ''}<a class="btn btn-primary" href="#/credits">이용권 확인</a></div>`;
  } catch (err) { view.innerHTML = errorScreen(err, { title: '결제를 승인하지 못했습니다', retry: () => navigate(`/pay/success?${new URLSearchParams(params)}&r=${Date.now()}`), back: '#/pricing' }); }
});
export async function payFail({ view, params: routeParams }) {
  const params = { ...Object.fromEntries(new URLSearchParams(location.search)), ...routeParams };
  view.innerHTML = errorScreen(new Error(params.message || '결제가 취소되었거나 실패했습니다.'), { title: '결제 실패', back: '#/pricing', hint: params.code ? `코드: ${params.code}` : '' });
}

export { showShortcutHelp };
