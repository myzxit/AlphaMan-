// 앱 페이지: 대시보드, 쇼츠 스튜디오, 롱폼, 자막 편집기, 디스커버리, SNS 업로드, 알파토픽, 번역, 계정, 문의, 이용권
import { get, post, put, patch, del, uploadFile, downloadUrl, getToken } from './api.js';
import { esc, html, raw, toast, modal, confirmDialog, fmtTime, fmtNum, fmtDate, fmtKRW, compactViews, creditsLabel, readVideoMeta, qs, qsa, on, debounce } from './ui.js';

const auth = (fn) => Object.assign(fn, { requiresAuth: true });

// 랜딩 히어로에서 바로 시작 (비로그인 시 로그인 후 이어서)
export async function startShortsFromLanding({ url, file, meta, state, navigate }) {
  if (!state.user) { try { sessionStorage.setItem('am_pending_url', url || ''); } catch { /* ignore */ } toast('먼저 무료 가입 또는 로그인해주세요.'); return navigate(`/login?next=${encodeURIComponent('/studio')}`); }
  navigate('/studio');
  if (url) setTimeout(() => { const i = qs('#s-url'); if (i) i.value = url; }, 200);
  if (file) setTimeout(() => window.__pendingFile = { file, meta }, 0);
}

export const dashboard = auth(async ({ view, state }) => {
  const [jobs, projects, queue, notifs] = await Promise.all([get('/api/shorts/jobs'), get('/api/subtitles/projects'), get('/api/publish/queue'), get('/api/notifications')]);
  const disc = await get('/api/discovery/home');
  view.innerHTML = html`<h1>${disc.greeting}</h1><p class="muted">${disc.subtitle}</p>
    <div class="grid grid-4"><div class="card"><div class="muted small">보유 이용권</div><div style="font-size:1.6rem;font-weight:900">${creditsLabel(state.user)}</div><a href="#/credits" class="small">충전 / 내역</a></div><div class="card"><div class="muted small">쇼츠 작업</div><div style="font-size:1.6rem;font-weight:900">${jobs.length}</div><a href="#/studio" class="small">스튜디오</a></div><div class="card"><div class="muted small">자막 프로젝트</div><div style="font-size:1.6rem;font-weight:900">${projects.length}</div><a href="#/subtitles" class="small">편집기</a></div><div class="card"><div class="muted small">예약 업로드</div><div style="font-size:1.6rem;font-weight:900">${queue.filter((q) => q.status === 'scheduled').length}</div><a href="#/publish" class="small">SNS 업로드</a></div></div>
    <div class="section-head" style="text-align:left;margin-top:28px"><h2>바로 시작</h2></div>
    <div class="grid grid-4">${raw([['#/studio', '✂️ 쇼츠 만들기', '링크나 파일로 하이라이트 쇼츠'], ['#/remix', '🪄 AI 재구성', '자막·효과음 새로 입혀 1~28분 재구성'], ['#/voice', '🎤 내 목소리 TTS', '내 목소리로 후킹·내레이션'], ['#/subtitles', '💬 자막 만들기', 'Whisper STT + 파형 편집'], ['#/topic', '📈 주제 추천', '채널 분석 & 떡상 주제'], ['#/discovery', '🔥 디스커버리', 'KR 쇼츠 급상승·성장 채널']].map(([h, t, b]) => `<a class="entry-card" href="${h}"><div>${esc(t)}</div><div class="small muted" style="font-weight:500">${esc(b)}</div></a>`).join(''))}</div>
    <div class="split" style="margin-top:28px"><div class="card"><h3>최근 쇼츠 작업</h3>${jobs.length ? raw(jobs.slice(0, 5).map((j) => `<div class="row row-between" style="padding:8px 0;border-bottom:1px solid var(--border)"><div><a href="#/studio/${j.id}"><b>${esc(j.source.title)}</b></a><div class="tiny muted">${fmtDate(j.createdAt)} · ${j.minutesCharged}분 차감 · 클립 ${j.clipIds.length}개</div></div>${statusBadge(j.status)}</div>`).join('')) : '<p class="muted">아직 작업이 없습니다.</p>'}</div>
    <div class="card"><h3>최근 알림</h3>${notifs.length ? raw(notifs.slice(0, 6).map((n) => `<div class="notif ${n.read ? '' : 'unread'}"><div class="small">${esc(n.title)}</div><div class="tiny muted">${esc(n.body)}</div></div>`).join('')) : '<p class="muted">알림이 없습니다.</p>'}</div></div>`;
});

function statusBadge(s) { return `<span class="badge ${s === 'done' ? 'badge-success' : s === 'failed' ? 'badge-danger' : 'badge-warn'}">${{ done: '완료', failed: '실패', queued: '대기', processing: '진행 중' }[s] || esc(s)}</span>`; }

// ---------------- 쇼츠 스튜디오 ----------------
export const studio = auth(async ({ view, state, navigate }) => {
  const [{ templates, genres, ratios }, jobs, targets, { profiles: voiceProfiles }] = await Promise.all([get('/api/shorts/templates'), get('/api/shorts/jobs'), get('/api/translate/targets'), get('/api/voice/profiles')]);
  const feats = state.info.content.features.items;
  view.innerHTML = html`<div class="row row-between"><h1>쇼츠 스튜디오</h1><span class="badge">보유 이용권 ${creditsLabel(state.user)}</span></div>
    <div class="split"><div class="card">
      <div class="tabs" id="s-tabs"><button class="tab active" data-tab="youtube">유튜브 링크</button><button class="tab" data-tab="file">파일 업로드</button><button class="tab desktop-only" data-tab="local">컴퓨터/USB 영상</button></div>
      <div id="s-youtube"><div class="field"><label>유튜브 링크</label><input id="s-url" placeholder="예: https://www.youtube.com/watch?v=..." /></div><div class="field"><label>예상 길이(분) - 메타데이터를 가져오지 못할 때 사용</label><input id="s-est" type="number" min="1" value="10" /></div></div>
      <div id="s-file" class="hidden"><div class="dropzone" id="s-drop">MP4, MOV, WebM 파일을 끌어다 놓거나 클릭 <input type="file" id="s-file-input" accept="video/*" class="hidden" /></div><div id="s-file-meta" class="small muted" style="margin-top:8px"></div><div class="progress" style="margin-top:8px"><div id="s-upload-bar" style="width:0"></div></div></div>
      <div id="s-local" class="hidden"><div class="row"><button class="btn" id="s-pick-local">파일 선택 (프로그램 전용)</button><button class="btn" id="s-usb">USB 드라이브 검색</button></div><div id="s-local-path" class="small muted" style="margin-top:8px"></div></div>
      <h3 style="margin-top:20px">편집 옵션</h3>
      <div class="toggle-grid">${raw(feats.map((f) => `<label class="check"><input type="checkbox" data-opt="${f.id === 'template' ? '' : f.id}" ${f.id === 'aiHookVoice' || f.id === 'template' ? '' : 'checked'} ${f.id === 'template' ? 'disabled' : ''}/> ${esc(f.title)}</label>`).join(''))}</div>
      <div class="field" style="margin-top:8px"><label>AI 후킹 보이스 목소리</label><select id="s-voice"><option value="">기본 AI 보이스</option>${raw(voiceProfiles.map((p) => `<option value="${p.id}">🎤 ${esc(p.name)} (내 목소리)</option>`).join(''))}</select><div class="tiny muted">내 목소리를 쓰려면 <a href="#/voice">내 목소리 TTS</a>에서 프로필을 만드세요.</div></div>
      <div class="grid grid-3" style="margin-top:12px"><div class="field"><label>장르</label><select id="s-genre"><option value="">자동 감지</option>${raw(genres.map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join(''))}</select></div><div class="field"><label>비율</label><select id="s-ratio">${raw(ratios.map((r) => `<option ${r === '9:16' ? 'selected' : ''}>${r}</option>`).join(''))}</select></div><div class="field"><label>클립 개수</label><select id="s-count"><option value="auto">자동 (2분당 1개)</option>${raw([1, 2, 3, 5, 8, 10].map((n) => `<option value="${n}">${n}개</option>`).join(''))}</select></div></div>
      <div class="field"><label>템플릿</label><div class="grid grid-5" id="s-templates"><div class="card template-card active" data-tpl="auto"><div class="template-swatch">자동</div><div class="tiny">장르에 맞게</div></div>${raw(templates.map((t) => `<div class="card template-card" data-tpl="${t.id}"><div class="template-swatch" style="font-family:'${esc(t.font)}';color:${esc(t.color)}">${esc(t.name)}</div><div class="tiny">${esc(t.name)}</div></div>`).join(''))}</div></div>
      <div class="field"><label>다국어 번역 자막/제목 (선택)</label><div class="chips" id="s-langs">${raw(targets.filter((t) => t.code !== 'ko').map((t) => `<span class="chip" data-lang="${t.code}">${esc(t.label)}</span>`).join(''))}</div></div>
      <button class="btn btn-primary btn-lg btn-block" id="s-go">쇼츠로 변환하기</button>
    </div>
    <div class="col"><div class="card"><h3>내 작업</h3><div id="s-jobs">${jobs.length ? raw(jobs.map((j) => `<div class="row row-between" style="padding:8px 0;border-bottom:1px solid var(--border)"><div><a href="#/studio/${j.id}"><b>${esc(j.source.title)}</b></a><div class="tiny muted">${fmtDate(j.createdAt)} · ${j.minutesCharged}분 · ${j.source.type === 'youtube' ? '유튜브' : '파일'}</div></div>${statusBadge(j.status)}</div>`).join('')) : '<p class="muted">아직 작업이 없습니다.</p>'}</div></div>
    <div class="card small muted"><b>이용 안내</b><br/>원본 영상 길이만큼 이용권이 차감되고, 2분당 1개의 쇼츠가 생성됩니다. 재생성은 절반만 차감됩니다. 실패 시 자동 환불.</div></div></div>`;

  let mode = 'youtube'; let uploadId = null; let localPath = null; let tpl = 'auto'; const langs = new Set();
  qsa('#s-tabs .tab').forEach((t) => { t.onclick = () => { mode = t.dataset.tab; qsa('#s-tabs .tab').forEach((x) => x.classList.remove('active')); t.classList.add('active'); ['youtube', 'file', 'local'].forEach((m) => qs(`#s-${m}`).classList.toggle('hidden', m !== mode)); }; });
  qsa('#s-templates .template-card').forEach((c) => { c.onclick = () => { tpl = c.dataset.tpl; qsa('#s-templates .template-card').forEach((x) => x.classList.remove('active')); c.classList.add('active'); }; });
  qsa('#s-langs .chip').forEach((c) => { c.onclick = () => { c.classList.toggle('active'); langs.has(c.dataset.lang) ? langs.delete(c.dataset.lang) : langs.add(c.dataset.lang); }; });
  const drop = qs('#s-drop'); const input = qs('#s-file-input');
  drop.onclick = () => input.click(); drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); }; drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); e.dataTransfer.files[0] && pick(e.dataTransfer.files[0]); };
  input.onchange = () => input.files[0] && pick(input.files[0]);
  async function pick(file, metaKnown) {
    try {
      const meta = metaKnown || await readVideoMeta(file);
      qs('#s-file-meta').textContent = `${file.name} · ${fmtTime(meta.durationSec)} · ${meta.width}×${meta.height} · 필요 이용권 ${(meta.durationSec / 60).toFixed(1)}분 · 업로드 중...`;
      const up = await uploadFile(file, (p) => { qs('#s-upload-bar').style.width = `${p}%`; });
      uploadId = up.id; qs('#s-file-meta').textContent += ' 완료';
    } catch (err) { uploadId = null; toast(err.message, 'error', 6000); }
  }
  if (window.__pendingFile) { const p = window.__pendingFile; window.__pendingFile = null; qsa('#s-tabs .tab')[1].click(); pick(p.file, p.meta); }
  try { const pending = sessionStorage.getItem('am_pending_url'); if (pending) { qs('#s-url').value = pending; sessionStorage.removeItem('am_pending_url'); } } catch { /* ignore */ }
  if (window.alphaman?.pickVideo) {
    qs('#s-pick-local').onclick = async () => { const p = await window.alphaman.pickVideo(); if (p) { localPath = p; qs('#s-local-path').textContent = p; } };
    qs('#s-usb').onclick = async () => { const drives = await window.alphaman.listRemovableDrives(); if (!drives.length) return toast('USB 드라이브를 찾지 못했습니다.'); const m = modal(drives.map((d) => `<button class="btn btn-block" data-path="${esc(d.path)}" style="margin-bottom:6px;justify-content:flex-start">💾 ${esc(d.label || d.path)} <span class="tiny muted">${esc(d.path)}</span></button>`).join(''), { title: 'USB 드라이브' }); m.el.querySelectorAll('[data-path]').forEach((b) => { b.onclick = async () => { m.close(); const p = await window.alphaman.pickVideo(b.dataset.path); if (p) { localPath = p; qs('#s-local-path').textContent = p; } }; }); };
  }
  qs('#s-go').onclick = async (e) => {
    const options = { template: tpl, ratio: qs('#s-ratio').value, genre: qs('#s-genre').value || undefined, clipCount: qs('#s-count').value, targetLanguages: [...langs], language: 'ko', voiceProfileId: qs('#s-voice').value || null };
    qsa('[data-opt]').forEach((c) => { if (c.dataset.opt) options[c.dataset.opt] = c.checked; });
    const body = { options };
    if (mode === 'youtube') { body.url = qs('#s-url').value; body.options.estimatedDurationSec = Number(qs('#s-est').value || 10) * 60; if (!body.url.trim()) return toast('링크를 입력해주세요.', 'error'); }
    else if (mode === 'file') { if (!uploadId) return toast('먼저 영상 파일을 업로드해주세요.', 'error'); body.uploadId = uploadId; }
    else { if (!localPath) return toast('파일을 선택해주세요.', 'error'); body.localPath = localPath; }
    e.target.disabled = true; e.target.textContent = '작업 생성 중...';
    try { const job = await post('/api/shorts/jobs', body); await window.AlphaManApp.refreshUser(); toast(`${job.minutesCharged}분 차감 · 쇼츠 제작을 시작했어요`); navigate(`/studio/${job.id}`); }
    catch (err) { toast(err.message, 'error', 6000); e.target.disabled = false; e.target.textContent = '쇼츠로 변환하기'; }
  };
});

export const studioJob = auth(async ({ view, params, state, navigate }) => {
  const { templates, ratios } = await get('/api/shorts/templates');
  let job = await get(`/api/shorts/jobs/${params.id}`);
  let timer = null;
  const draw = () => {
    const stepNames = { queued: '대기', downloading: '영상 가져오기', transcribing: '음성 인식', analyzing: 'AI 하이라이트 분석', editing: '자동 편집', rendering: '렌더링', done: '완료', failed: '실패' };
    view.innerHTML = html`<div class="row row-between"><div><a href="#/studio" class="small">← 스튜디오</a><h1>${job.source.title}</h1><div class="muted small">${job.source.type === 'youtube' ? raw(`<a href="${esc(job.source.url)}" target="_blank" rel="noopener">${esc(job.source.url)}</a>`) : '업로드 파일'} · ${fmtTime(job.source.durationSec)} · ${job.minutesCharged}분 차감 · 장르: ${job.genre || '-'} · 재생성 ${job.regenerations}회</div></div>
      <div class="row"><button class="btn" id="j-regen" ${job.status === 'done' || job.status === 'failed' ? '' : 'disabled'}>재생성하기 (${(job.minutesCharged / 2).toFixed(1)}분)</button><button class="btn btn-danger" id="j-del">삭제</button></div></div>
      ${job.status !== 'done' ? raw(`<div class="card"><div class="row row-between"><b>${esc(stepNames[job.step] || job.step)}</b><span>${job.progress}%</span></div><div class="progress"><div style="width:${job.progress}%"></div></div><div class="log" style="margin-top:10px">${job.log.map((l) => `${esc(l.at.slice(11, 19))} [${esc(l.step)}] ${esc(l.message)}`).join('\n')}</div>${job.error ? `<p class="badge badge-danger">${esc(job.error)}</p>` : ''}</div>`) : ''}
      <div class="grid grid-3" style="margin-top:16px">${raw((job.clips || []).map((c) => clipCard(c, templates)).join(''))}</div>`;
    qs('#j-regen').onclick = async () => { if (!(await confirmDialog(`재생성하면 이용권 ${(job.minutesCharged / 2).toFixed(1)}분이 차감됩니다. 진행할까요?`))) return; try { job = await post(`/api/shorts/jobs/${job.id}/regenerate`); job.clips = []; await window.AlphaManApp.refreshUser(); draw(); poll(); } catch (err) { toast(err.message, 'error'); } };
    qs('#j-del').onclick = async () => { if (!(await confirmDialog('작업과 클립을 삭제할까요?'))) return; await del(`/api/shorts/jobs/${job.id}`); navigate('/studio'); };
    on(view, 'click', '[data-edit]', (e, t) => editClipModal(job.clips.find((c) => c.id === t.dataset.edit), templates, ratios, async () => { job = await get(`/api/shorts/jobs/${job.id}`); draw(); }));
    on(view, 'click', '[data-publish]', (e, t) => navigate(`/publish?clip=${t.dataset.publish}`));
    on(view, 'click', '[data-export]', async (e, t) => {
      const fmt = t.dataset.format;
      if (fmt === 'mp4') { const r = await fetch(downloadUrl(`/api/shorts/clips/${t.dataset.export}/export?format=mp4`), { headers: { Authorization: `Bearer ${getToken()}` } }); if ((r.headers.get('content-type') || '').includes('json')) { const j = await r.json(); modal(`<p>${esc(j.message || '')}</p><pre class="log">${esc(JSON.stringify(j.plan || j.clip?.render, null, 2))}</pre>`, { title: '렌더 계획' }); } else { const b = await r.blob(); saveBlob(b, `${t.dataset.export}.mp4`); } }
      else { const r = await fetch(downloadUrl(`/api/shorts/clips/${t.dataset.export}/export?format=${fmt}`), { headers: { Authorization: `Bearer ${getToken()}` } }); saveBlob(await r.blob(), `${t.dataset.export}.${fmt}`); }
    });
  };
  const poll = () => { clearInterval(timer); timer = setInterval(async () => { try { job = await get(`/api/shorts/jobs/${job.id}`); draw(); if (job.status === 'done' || job.status === 'failed') { clearInterval(timer); window.AlphaManApp.refreshUser(); } } catch { clearInterval(timer); } }, 1200); };
  draw(); if (job.status !== 'done' && job.status !== 'failed') poll();
  window.addEventListener('hashchange', () => clearInterval(timer), { once: true });
});

function saveBlob(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }

function clipCard(c, templates) {
  const t = templates.find((x) => x.id === c.templateId) || templates[0];
  const firstSub = c.subtitles[0]?.text || '';
  return `<div class="card clip-card"><div class="clip-preview r-${c.ratio.replace(':', '-')}" style="background-image:url('${esc(c.thumbnail || `https://picsum.photos/seed/${c.id}/270/480`)}')">${c.hook ? `<div class="hook">🔥 ${esc(c.hook.text)}</div>` : ''}<div class="sub" style="font-family:'${esc(t.font)}';color:${esc(t.color)};bottom:14%;font-size:${Math.round(t.fontSize / 4)}px">${esc(firstSub)}</div>${c.zoomKeyframes?.length ? `<div class="zoom">🔍 줌 ${c.zoomKeyframes.length}</div>` : ''}</div>
    <div><b>${esc(c.title)}</b><div class="tiny muted">${fmtTime(c.start)} → ${fmtTime(c.end)} · ${c.durationSec}초 · ${c.ratio} · ${esc(t.name)} · 점수 ${c.score}</div></div>
    <div class="tiny muted">${esc(c.reason)}</div>
    <div class="chips">${c.cuts?.length ? `<span class="chip">무음 ${c.cuts.length}곳 제거</span>` : ''}${c.subtitles.length ? `<span class="chip">자막 ${c.subtitles.length}줄</span>` : ''}${c.audio?.voiceEnhance ? '<span class="chip">음성 향상</span>' : ''}${c.audio?.aiHookVoice ? '<span class="chip">AI 후킹 보이스</span>' : ''}${Object.keys(c.translations || {}).map((l) => `<span class="chip">${esc(l.toUpperCase())} 번역</span>`).join('')}</div>
    <div class="row"><button class="btn btn-sm" data-edit="${c.id}">편집</button><button class="btn btn-sm" data-export="${c.id}" data-format="mp4">MP4</button><button class="btn btn-sm" data-export="${c.id}" data-format="srt">SRT</button><button class="btn btn-sm btn-primary" data-publish="${c.id}">SNS 업로드</button></div></div>`;
}

function editClipModal(clip, templates, ratios, onSaved) {
  const m = modal(html`<div class="field"><label>제목</label><input id="e-title" value="${clip.title}" /></div>
    <div class="grid grid-2"><div class="field"><label>시작(초)</label><input id="e-start" type="number" step="0.1" value="${clip.start}" /></div><div class="field"><label>끝(초)</label><input id="e-end" type="number" step="0.1" value="${clip.end}" /></div></div>
    <div class="grid grid-2"><div class="field"><label>비율</label><select id="e-ratio">${raw(ratios.map((r) => `<option ${r === clip.ratio ? 'selected' : ''}>${r}</option>`).join(''))}</select></div><div class="field"><label>템플릿</label><select id="e-tpl">${raw(templates.map((t) => `<option value="${t.id}" ${t.id === clip.templateId ? 'selected' : ''}>${esc(t.name)}</option>`).join(''))}</select></div></div>
    <div class="field"><label>첫 3초 후킹 멘트</label><input id="e-hook" value="${clip.hook?.text || ''}" /></div>
    <div class="field"><label>자막 (한 줄에 하나: 시작|끝|텍스트)</label><textarea id="e-subs" rows="6">${clip.subtitles.map((s) => `${s.start}|${s.end}|${s.text}`).join('\n')}</textarea></div>
    <label class="check"><input type="checkbox" id="e-silence" ${clip.cuts?.length ? 'checked' : ''}/> 무음 구간 제거 유지</label>
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn btn-primary" id="e-save">저장</button></div>`, { title: '클립 편집', wide: true });
  m.el.querySelector('#e-save').onclick = async () => {
    const subs = m.el.querySelector('#e-subs').value.split('\n').map((l) => l.split('|')).filter((p) => p.length >= 3).map(([start, end, ...t]) => ({ start: Number(start), end: Number(end), text: t.join('|') }));
    try { await patch(`/api/shorts/clips/${clip.id}`, { title: m.el.querySelector('#e-title').value, start: Number(m.el.querySelector('#e-start').value), end: Number(m.el.querySelector('#e-end').value), ratio: m.el.querySelector('#e-ratio').value, templateId: m.el.querySelector('#e-tpl').value, hookText: m.el.querySelector('#e-hook').value, subtitles: subs, removeSilence: m.el.querySelector('#e-silence').checked }); await post(`/api/shorts/clips/${clip.id}/render`); m.close(); toast('저장되었습니다.'); onSaved(); } catch (err) { toast(err.message, 'error'); }
  };
}

// ---------------- 롱폼 컷편집 ----------------
export const longform = auth(async ({ view, params, navigate }) => {
  const jobs = await get('/api/longform/jobs');
  const cur = params.id ? await get(`/api/longform/jobs/${params.id}`) : null;
  view.innerHTML = html`<h1>롱폼 컷편집</h1><p class="muted">롱폼 영상 전체의 무음 구간을 제거하고 자동 자막·챕터를 만듭니다. (원본 길이만큼 이용권 차감)</p>
    <div class="split"><div class="card"><div class="field"><label>유튜브 링크 또는 업로드</label><div class="input-row"><input id="l-url" placeholder="https://www.youtube.com/watch?v=..." /><input type="file" id="l-file" accept="video/*" style="max-width:220px" /></div></div>
      <div class="toggle-grid"><label class="check"><input type="checkbox" id="l-silence" checked/> 무음 구간 제거</label><label class="check"><input type="checkbox" id="l-subs" checked/> 자동 자막</label><label class="check"><input type="checkbox" id="l-chapters" checked/> AI 챕터 생성</label><label class="check"><input type="checkbox" id="l-jump" checked/> 점프컷</label></div>
      <div class="field" style="margin-top:8px"><label>무음 기준(초)</label><input id="l-th" type="number" step="0.1" value="0.7" /></div><button class="btn btn-primary" id="l-go">컷편집 시작</button>
      ${cur ? raw(renderLongform(cur)) : ''}</div>
      <div class="card"><h3>내 작업</h3>${jobs.length ? raw(jobs.map((j) => `<div class="row row-between" style="padding:8px 0;border-bottom:1px solid var(--border)"><a href="#/longform/${j.id}"><b>${esc(j.source.title)}</b></a>${statusBadge(j.status)}</div>`).join('')) : '<p class="muted">작업이 없습니다.</p>'}</div></div>`;
  qs('#l-go').onclick = async (e) => {
    const options = { removeSilence: qs('#l-silence').checked, autoSubtitles: qs('#l-subs').checked, chapters: qs('#l-chapters').checked, jumpCuts: qs('#l-jump').checked, silenceThreshold: Number(qs('#l-th').value) };
    e.target.disabled = true;
    try {
      let body = { url: qs('#l-url').value, options };
      const f = qs('#l-file').files[0];
      if (f) { await readVideoMeta(f); const up = await uploadFile(f); body = { uploadId: up.id, options }; }
      const j = await post('/api/longform/jobs', body); await window.AlphaManApp.refreshUser(); navigate(`/longform/${j.id}`);
      setTimeout(() => { if (location.hash.includes(j.id)) navigate(`/longform/${j.id}?r=${Date.now()}`); }, 2500);
    } catch (err) { toast(err.message, 'error', 6000); e.target.disabled = false; }
  };
});
function renderLongform(j) {
  if (j.status !== 'done') return `<div class="card" style="margin-top:16px"><b>${esc(j.source.title)}</b> ${statusBadge(j.status)} <div class="progress" style="margin-top:8px"><div style="width:${j.progress}%"></div></div><p class="tiny muted">잠시 후 새로고침됩니다.</p></div>`;
  const r = j.result; const D = r.originalDurationSec;
  return `<div class="card" style="margin-top:16px"><h3>${esc(j.source.title)}</h3><div class="chips"><span class="chip">원본 ${fmtTime(D)}</span><span class="chip">편집본 ${fmtTime(r.editedDurationSec)}</span><span class="chip">공백 제거 ${r.removedSec}초 (${r.cuts.length}곳)</span><span class="chip">자막 ${r.subtitles.length}줄</span><span class="chip">STT: ${esc(r.transcriptEngine)}</span></div>
    <div class="timeline" style="margin:12px 0">${r.timeline.map((k) => `<div class="seg" style="left:${(k.start / D) * 100}%;width:${((k.end - k.start) / D) * 100}%"></div>`).join('')}${r.cuts.map((c) => `<div class="cut" style="left:${(c.start / D) * 100}%;width:${Math.max(0.3, ((c.end - c.start) / D) * 100)}%"></div>`).join('')}</div>
    <h4>챕터</h4>${r.chapters.map((c) => `<div class="row"><span class="kbd">${fmtTime(c.at)}</span> ${esc(c.title)}</div>`).join('')}
    <details style="margin-top:10px"><summary>자막 미리보기</summary><div class="log">${r.subtitles.slice(0, 40).map((s) => `${fmtTime(s.start)} ${esc(s.text)}`).join('\n')}</div></details></div>`;
}

// ---------------- 자막 편집기 (픽셀링) ----------------
export const subtitles = auth(async ({ view, state, navigate }) => {
  const projects = await get('/api/subtitles/projects');
  view.innerHTML = html`<div class="row row-between"><h1>자막 편집기</h1><span class="badge badge-success">기본 기능 무료</span></div><p class="muted">음성 인식(Whisper) → 의미 기반 분할 → 파형 편집 → 다국어 번역 → SRT/VTT/ASS 내보내기. YouTube Shorts, TikTok, Instagram Reels 링크 지원.</p>
    <div class="split"><div class="card"><div class="tabs" id="p-tabs"><button class="tab active" data-tab="url">영상 링크</button><button class="tab" data-tab="file">파일 업로드</button><button class="tab desktop-only" data-tab="local">컴퓨터/USB 영상</button></div>
      <div id="p-url"><div class="field"><label>YouTube / TikTok / Reels 링크</label><input id="p-link" placeholder="https://youtube.com/shorts/..." /></div></div>
      <div id="p-file" class="hidden"><input type="file" id="p-file-input" accept="video/*,audio/*" /><div id="p-file-meta" class="small muted" style="margin-top:6px"></div></div>
      <div id="p-local" class="hidden"><button class="btn" id="p-pick-local">파일 선택 (프로그램 전용)</button><div id="p-local-path" class="small muted"></div></div>
      <div class="grid grid-2"><div class="field"><label>음성 언어</label><select id="p-lang"><option value="ko">한국어</option><option value="en">English</option><option value="ja">日本語</option><option value="zh">中文</option></select></div><div class="field"><label>모드</label><select id="p-premium"><option value="">기본 (무료)</option><option value="1">프리미엄 일괄 생성 (이용권 차감, 고정밀)</option></select></div></div>
      <div id="p-premium-notice" class="small muted hidden">${state.info.content.pixeling.premiumNotice}</div>
      <button class="btn btn-primary btn-block" id="p-go">자막 생성</button></div>
      <div class="card"><h3>내 프로젝트</h3>${projects.length ? raw(projects.map((p) => `<div class="row row-between" style="padding:8px 0;border-bottom:1px solid var(--border)"><div><a href="#/subtitles/${p.id}"><b>${esc(p.source.title)}</b></a><div class="tiny muted">${fmtDate(p.createdAt)} · ${p.segments.length}줄 · ${esc(p.engine || '')} ${Object.keys(p.translations).length ? `· 번역 ${Object.keys(p.translations).join(',')}` : ''}</div></div><button class="btn btn-sm btn-danger" data-del="${p.id}">삭제</button></div>`).join('')) : '<p class="muted">프로젝트가 없습니다.</p>'}</div></div>`;
  let mode = 'url'; let uploadId = null; let localPath = null;
  qsa('#p-tabs .tab').forEach((t) => { t.onclick = () => { mode = t.dataset.tab; qsa('#p-tabs .tab').forEach((x) => x.classList.remove('active')); t.classList.add('active'); ['url', 'file', 'local'].forEach((m) => qs(`#p-${m}`).classList.toggle('hidden', m !== mode)); }; });
  qs('#p-premium').onchange = (e) => qs('#p-premium-notice').classList.toggle('hidden', !e.target.value);
  qs('#p-file-input').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { const meta = f.type.startsWith('audio') ? null : await readVideoMeta(f); qs('#p-file-meta').textContent = `${f.name} 업로드 중...`; const up = await uploadFile(f); uploadId = up.id; qs('#p-file-meta').textContent = `${f.name} 업로드 완료${meta ? ` · ${fmtTime(meta.durationSec)}` : ''}`; } catch (err) { toast(err.message, 'error', 6000); } };
  if (window.alphaman?.pickVideo) qs('#p-pick-local').onclick = async () => { const p = await window.alphaman.pickVideo(); if (p) { localPath = p; qs('#p-local-path').textContent = p; } };
  qs('#p-go').onclick = async (e) => {
    const body = { language: qs('#p-lang').value, premium: Boolean(qs('#p-premium').value) };
    if (mode === 'url') body.url = qs('#p-link').value; else if (mode === 'file') { if (!uploadId) return toast('파일을 먼저 업로드해주세요.', 'error'); body.uploadId = uploadId; } else { if (!localPath) return toast('파일을 선택해주세요.', 'error'); body.localPath = localPath; }
    e.target.disabled = true; e.target.textContent = '음성 인식 중...';
    try { const p = await post('/api/subtitles/projects', body); if (p.notice) toast(p.notice, 'info', 7000); navigate(`/subtitles/${p.id}`); } catch (err) { toast(err.message, 'error', 6000); e.target.disabled = false; e.target.textContent = '자막 생성'; }
  };
  on(view, 'click', '[data-del]', async (e, t) => { if (await confirmDialog('프로젝트를 삭제할까요?')) { await del(`/api/subtitles/projects/${t.dataset.del}`); navigate('/subtitles?r=1'); } });
});

export const subtitleEditor = auth(async ({ view, params, navigate }) => {
  let p = await get(`/api/subtitles/projects/${params.id}`);
  const [{ fonts, presets }, targets] = await Promise.all([get('/api/subtitles/fonts'), get('/api/translate/targets')]);
  let lang = null; let selected = new Set(); let playhead = 0;
  const segs = () => (lang && p.translations[lang] ? p.translations[lang].segments : p.segments);
  const draw = () => {
    const font = fonts.find((f) => f.id === p.style.font) || fonts[0];
    const s = p.style;
    view.innerHTML = html`<div class="row row-between"><div><a href="#/subtitles" class="small">← 프로젝트</a><h1>${p.source.title}</h1><div class="tiny muted">${fmtTime(p.source.durationSec)} · STT: ${p.engine} · 파형: ${p.waveform?.engine} · ${p.premium ? '프리미엄' : '기본'}</div></div>
      <div class="row"><select id="ed-lang" style="width:auto"><option value="">원문 (${p.language})</option>${raw(Object.keys(p.translations).map((l) => `<option value="${l}" ${l === lang ? 'selected' : ''}>${esc(l)} 번역</option>`).join(''))}</select>
        <select id="ed-export" style="width:auto"><option value="srt">SRT</option><option value="vtt">VTT</option><option value="ass">ASS</option><option value="txt">TXT</option><option value="json">JSON</option></select><button class="btn btn-primary" id="ed-download">내보내기</button></div></div>
      ${p.notice ? raw(`<div class="notice-bar" style="border-radius:10px;margin-bottom:12px">${esc(p.notice)}</div>`) : ''}
      <div class="split"><div class="col">
        <div class="card"><canvas id="wave" class="waveform" width="1200" height="120"></canvas><div class="row row-between tiny muted"><span>00:00</span><span id="ed-playhead">재생 위치 ${fmtTime(playhead)} · 파형 클릭으로 이동, 선택 자막에서 분할</span><span>${fmtTime(p.source.durationSec)}</span></div>
          <div class="row" style="margin-top:8px"><button class="btn btn-sm" id="ed-split">선택 자막 분할 @재생위치</button><button class="btn btn-sm" id="ed-merge">선택 병합</button><button class="btn btn-sm" id="ed-resplit">의미 기반 재분할</button><button class="btn btn-sm" id="ed-undo">되돌리기 (${p.history.length})</button><button class="btn btn-sm" id="ed-add">자막 추가</button><button class="btn btn-sm" id="ed-import">SRT 가져오기</button></div></div>
        <div class="card"><div id="seg-list">${raw(segs().map((sg, i) => `<div class="seg-row ${selected.has(sg.id) ? 'active' : ''}" data-id="${sg.id}"><input data-f="start" data-i="${i}" value="${sg.start}" type="number" step="0.01" /><input data-f="end" data-i="${i}" value="${sg.end}" type="number" step="0.01" /><input data-f="text" data-i="${i}" value="${esc(sg.text)}" /><div class="row" style="gap:4px"><button class="btn btn-sm" data-sel="${sg.id}">${selected.has(sg.id) ? '✓' : '선택'}</button><button class="btn btn-sm btn-danger" data-rm="${i}">✕</button></div></div>`).join(''))}</div><div class="row" style="margin-top:10px"><button class="btn btn-primary" id="ed-save">자막 저장</button><span class="tiny muted" id="ed-dirty"></span></div></div></div>
      <div class="col sticky"><div class="card"><h3>미리보기</h3><div class="subtitle-preview"><div class="line" id="pv-line" style="font-family:'${font.family}';font-size:${Math.round(s.size / 3)}px;color:${s.color};background:${s.bg || 'transparent'};-webkit-text-stroke:${s.outline ? `${Math.max(0.5, s.outlineWidth / 4)}px ${s.outline}` : '0'};font-weight:900">${segs()[0]?.text || '자막 미리보기'}</div></div></div>
        <div class="card"><h3>스타일</h3><div class="field"><label>프리셋</label><div class="chips">${raw(presets.map((pr) => `<span class="chip ${pr.id === s.presetId ? 'active' : ''}" data-preset="${pr.id}">${esc(pr.name)}</span>`).join(''))}</div></div>
          <div class="field"><label>폰트 (${fonts.length}종)</label><select id="st-font">${raw(fonts.map((f) => `<option value="${f.id}" ${f.id === s.font ? 'selected' : ''} style="font-family:'${esc(f.family)}'">${esc(f.name)} · ${esc(f.category)}</option>`).join(''))}</select></div>
          <div class="grid grid-2"><div class="field"><label>크기</label><input id="st-size" type="number" value="${s.size}" /></div><div class="field"><label>위치</label><select id="st-pos">${raw(['top', 'center', 'bottom'].map((x) => `<option ${x === s.position ? 'selected' : ''}>${x}</option>`).join(''))}</select></div><div class="field"><label>글자색</label><input id="st-color" type="color" value="${s.color}" /></div><div class="field"><label>외곽선</label><input id="st-outline" type="color" value="${s.outline || '#000000'}" /></div><div class="field"><label>애니메이션</label><select id="st-anim">${raw(['none', 'pop', 'fade', 'bounce', 'karaoke', 'word-highlight', 'slide'].map((x) => `<option ${x === s.animation ? 'selected' : ''}>${x}</option>`).join(''))}</select></div></div><button class="btn btn-block" id="st-save">스타일 저장</button></div>
        <div class="card"><h3>다국어 번역</h3><div class="row"><select id="tr-target" style="width:auto">${raw(targets.filter((t) => t.code !== p.language).map((t) => `<option value="${t.code}">${esc(t.label)}</option>`).join(''))}</select><button class="btn btn-primary" id="tr-go">번역하기</button></div><div class="tiny muted" style="margin-top:6px">클릭 한 번으로 자막 전체를 번역합니다. 번역본은 언어 선택에서 확인/내보내기.</div></div></div></div>`;

    drawWave();
    qs('#ed-lang').onchange = (e) => { lang = e.target.value || null; draw(); };
    qs('#ed-download').onclick = async () => { const f = qs('#ed-export').value; const r = await fetch(downloadUrl(`/api/subtitles/projects/${p.id}/export?format=${f}${lang ? `&language=${lang}` : ''}`), { headers: { Authorization: `Bearer ${getToken()}` } }); const cd = r.headers.get('content-disposition') || ''; const name = decodeURIComponent((cd.match(/filename\*=UTF-8''(.+)$/) || [])[1] || `subtitles.${f}`); saveBlob(await r.blob(), name); };
    on(view, 'click', '[data-sel]', (e, t) => { selected.has(t.dataset.sel) ? selected.delete(t.dataset.sel) : selected.add(t.dataset.sel); draw(); });
    on(view, 'click', '[data-rm]', (e, t) => { if (lang) return toast('원문에서만 편집할 수 있습니다.'); p.segments.splice(Number(t.dataset.rm), 1); draw(); markDirty(); });
    on(view, 'input', '[data-f]', (e, t) => { if (lang) return; const sg = p.segments[Number(t.dataset.i)]; sg[t.dataset.f] = t.dataset.f === 'text' ? t.value : Number(t.value); if (t.dataset.f === 'text') qs('#pv-line').textContent = t.value; markDirty(); });
    on(view, 'focusin', '[data-f]', (e, t) => { const sg = p.segments[Number(t.dataset.i)]; if (sg) { qs('#pv-line').textContent = sg.text; playhead = sg.start; qs('#ed-playhead').textContent = `재생 위치 ${fmtTime(playhead)}`; drawWave(); } });
    qs('#ed-save').onclick = async () => { try { p = await put(`/api/subtitles/projects/${p.id}/segments`, { segments: p.segments }); toast('자막이 저장되었습니다.'); draw(); } catch (err) { toast(err.message, 'error'); } };
    qs('#ed-split').onclick = async () => { const id = [...selected][0]; if (!id) return toast('분할할 자막을 선택하세요.'); try { p = await post(`/api/subtitles/projects/${p.id}/split`, { segmentId: id, at: playhead }); selected.clear(); draw(); } catch (err) { toast(err.message, 'error'); } };
    qs('#ed-merge').onclick = async () => { if (selected.size < 2) return toast('두 개 이상 선택하세요.'); try { p = await post(`/api/subtitles/projects/${p.id}/merge`, { segmentIds: [...selected] }); selected.clear(); draw(); } catch (err) { toast(err.message, 'error'); } };
    qs('#ed-resplit').onclick = async () => { const maxChars = Number(prompt('한 줄 최대 글자 수', '22') || 22); p = await post(`/api/subtitles/projects/${p.id}/resplit`, { maxChars }); draw(); };
    qs('#ed-undo').onclick = async () => { try { p = await post(`/api/subtitles/projects/${p.id}/undo`); draw(); } catch (err) { toast(err.message, 'error'); } };
    qs('#ed-add').onclick = () => { const last = p.segments[p.segments.length - 1]; p.segments.push({ id: `seg-${Date.now()}`, start: last ? last.end + 0.2 : 0, end: last ? last.end + 2 : 2, text: '새 자막', words: [] }); draw(); markDirty(); };
    qs('#ed-import').onclick = () => { const m = modal('<textarea id="imp" rows="8" placeholder="SRT 내용 붙여넣기"></textarea><button class="btn btn-primary btn-block" id="imp-go" style="margin-top:8px">가져오기</button>', { title: 'SRT 가져오기' }); m.el.querySelector('#imp-go').onclick = async () => { try { p = await post(`/api/subtitles/projects/${p.id}/import`, { srt: m.el.querySelector('#imp').value }); m.close(); draw(); } catch (err) { toast(err.message, 'error'); } }; };
    qsa('[data-preset]').forEach((c) => { c.onclick = async () => { p = await put(`/api/subtitles/projects/${p.id}/style`, { presetId: c.dataset.preset }); draw(); }; });
    qs('#st-save').onclick = async () => { p = await put(`/api/subtitles/projects/${p.id}/style`, { presetId: p.style.presetId, font: qs('#st-font').value, size: Number(qs('#st-size').value), position: qs('#st-pos').value, color: qs('#st-color').value, outline: qs('#st-outline').value, animation: qs('#st-anim').value }); toast('스타일 저장'); draw(); };
    qs('#st-font').onchange = (e) => { const f = fonts.find((x) => x.id === e.target.value); qs('#pv-line').style.fontFamily = `'${f.family}'`; };
    qs('#tr-go').onclick = async (e) => { e.target.disabled = true; e.target.textContent = '번역 중...'; try { p = await post(`/api/subtitles/projects/${p.id}/translate`, { target: qs('#tr-target').value }); lang = qs('#tr-target').value; toast('번역 완료'); draw(); } catch (err) { toast(err.message, 'error'); e.target.disabled = false; e.target.textContent = '번역하기'; } };
  };
  const markDirty = () => { const d = qs('#ed-dirty'); if (d) d.textContent = '저장되지 않은 변경 사항'; };
  function drawWave() {
    const cv = qs('#wave'); if (!cv || !p.waveform) return;
    const ctx = cv.getContext('2d'); const W = cv.width; const H = cv.height; const D = p.source.durationSec;
    ctx.clearRect(0, 0, W, H);
    const peaks = p.waveform.peaks; const bw = W / peaks.length;
    const css = getComputedStyle(document.documentElement);
    ctx.fillStyle = css.getPropertyValue('--primary').trim() || '#6c5ce7';
    peaks.forEach((v, i) => { const h = Math.max(2, v * H * 0.9); ctx.fillRect(i * bw, (H - h) / 2, Math.max(1, bw - 0.5), h); });
    ctx.fillStyle = 'rgba(255,122,0,.25)';
    for (const sg of segs()) if (selected.has(sg.id)) ctx.fillRect((sg.start / D) * W, 0, ((sg.end - sg.start) / D) * W, H);
    ctx.fillStyle = '#ff7a00'; ctx.fillRect((playhead / D) * W - 1, 0, 2, H);
    cv.onclick = (e) => { const r = cv.getBoundingClientRect(); playhead = Math.round(((e.clientX - r.left) / r.width) * D * 100) / 100; qs('#ed-playhead').textContent = `재생 위치 ${fmtTime(playhead)}`; const hit = segs().find((s) => playhead >= s.start && playhead <= s.end); if (hit) qs('#pv-line').textContent = hit.text; drawWave(); };
  }
  draw();
});

// ---------------- 디스커버리 ----------------
export async function discovery({ view, params, query, state }) {
  const tab = params.tab || 'home';
  if (tab === 'home') {
    const h = await get('/api/discovery/home');
    view.innerHTML = html`<h1>${h.greeting}</h1><p class="muted">${h.subtitle}</p><div class="section-head" style="text-align:left"><h2>${state.info.content.pixeling.discoveryTitle}</h2><p>${state.info.content.pixeling.discoverySubtitle} — ${state.info.content.pixeling.discoveryBody}</p></div>
      <div class="grid grid-4">${raw(h.entryPoints.map((e) => `<a class="entry-card" href="${esc(e.href)}" aria-label="${esc(e.aria)}"><div>${esc(e.label)}</div><div class="tiny muted" style="font-weight:500">바로 이동 →</div></a>`).join(''))}</div>
      <div class="tabs" style="margin-top:24px">${raw(['videos:쇼츠', 'channels:채널', 'community:커뮤니티', 'news:뉴스', 'random:랜덤'].map((t) => { const [k, l] = t.split(':'); return `<a class="tab" href="#/discovery/${k}">${l}</a>`; }).join(''))}</div>
      <div class="card"><h3>KR 쇼츠 급상승 TOP 10</h3>${raw(h.top10.map(videoRow).join(''))}<div style="text-align:center;margin-top:10px"><a class="btn" href="#/discovery/videos?type=shorts&regions=KR&sort_by=trend">더보기</a></div></div>`;
    return;
  }
  const page = Number(query.page || 1);
  let body = '';
  const tabsHtml = `<div class="tabs">${['videos:쇼츠', 'channels:채널', 'community:커뮤니티', 'news:뉴스', 'random:랜덤'].map((t) => { const [k, l] = t.split(':'); return `<a class="tab ${k === tab ? 'active' : ''}" href="#/discovery/${k}">${l}</a>`; }).join('')}</div>`;
  if (tab === 'videos') {
    const q = { type: query.type || 'shorts', regions: query.regions || 'KR', sort_by: query.sort_by || 'trend', page, q: query.q || '' };
    const r = await get(`/api/discovery/videos?${new URLSearchParams(q)}`);
    body = html`<div class="row"><select id="d-region" style="width:auto">${raw(['KR', 'US', 'JP', 'ID', 'BR', 'TW', 'GLOBAL'].map((x) => `<option ${x === q.regions ? 'selected' : ''}>${x}</option>`).join(''))}</select><select id="d-sort" style="width:auto">${raw([['trend', '급상승'], ['views', '조회수'], ['recent', '최신']].map(([v, l]) => `<option value="${v}" ${v === q.sort_by ? 'selected' : ''}>${l}</option>`).join(''))}</select><input id="d-q" placeholder="검색" value="${q.q}" style="max-width:220px" /><button class="btn" id="d-apply">적용</button></div>
      <div class="card" style="margin-top:12px">${raw(r.items.map(videoRow).join(''))}${pager(r, `/discovery/videos?${new URLSearchParams({ ...q, page: '' })}`)}</div>`;
  } else if (tab === 'channels') {
    const q = { sort: query.sort || 'daily_view', order: query.order || 'desc', days: query.days || 1, country: query.country || 'KR', page };
    const r = await get(`/api/discovery/channels?${new URLSearchParams(q)}`);
    body = html`<div class="row"><select id="c-days" style="width:auto">${raw([1, 3, 7, 30].map((d) => `<option value="${d}" ${String(d) === String(q.days) ? 'selected' : ''}>최근 ${d}일</option>`).join(''))}</select><select id="c-sort" style="width:auto">${raw([['daily_view', '일간 조회수'], ['growth', '구독자 성장률'], ['subscribers', '구독자']].map(([v, l]) => `<option value="${v}" ${v === q.sort ? 'selected' : ''}>${l}</option>`).join(''))}</select><button class="btn" id="c-apply">적용</button></div>
      <div class="card table-wrap" style="margin-top:12px"><table class="table"><tr><th>#</th><th>채널</th><th>장르</th><th>구독자</th><th>일간 조회수</th><th>성장률</th><th>신규 영상</th></tr>${raw(r.items.map((c) => `<tr><td class="rank">${c.rank}</td><td><a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.name)}</a></td><td>${esc(c.genre)}</td><td>${compactViews(c.subscribers)}</td><td>${compactViews(c.dailyViews)}</td><td class="badge badge-success">+${c.subscriberGrowthPct}%</td><td>${c.newVideos}</td></tr>`).join(''))}</table>${pager(r, `/discovery/channels?${new URLSearchParams({ ...q, page: '' })}`)}</div>`;
  } else if (tab === 'community') {
    const r = await get(`/api/discovery/community?${new URLSearchParams({ source: query.source || 'all', page })}`);
    body = html`<div class="chips">${raw([['all', '전체'], ['reddit', '레딧'], ['community', '커뮤니티']].map(([v, l]) => `<a class="chip ${(query.source || 'all') === v ? 'active' : ''}" href="#/discovery/community?source=${v}">${l}</a>`).join(''))}</div><div class="card" style="margin-top:12px">${raw(r.items.map((p) => `<div class="row row-between" style="padding:8px 0;border-bottom:1px solid var(--border)"><div><span class="badge badge-soft">${esc(p.source)} · ${esc(p.board)}</span> <a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title)}</a></div><span class="small muted">▲ ${fmtNum(p.score)}</span></div>`).join(''))}${pager(r, `/discovery/community?source=${query.source || 'all'}&page=`)}</div>`;
  } else if (tab === 'news') {
    const r = await get(`/api/discovery/news?${new URLSearchParams({ category: query.category || 'all', page })}`);
    body = html`<div class="chips">${raw([['all', '뉴스 TOP'], ['platform', '플랫폼'], ['industry', '산업'], ['ai', 'AI']].map(([v, l]) => `<a class="chip ${(query.category || 'all') === v ? 'active' : ''}" href="#/discovery/news?category=${v}">${l}</a>`).join(''))}</div><div class="card" style="margin-top:12px">${raw(r.items.map((n) => `<div style="padding:8px 0;border-bottom:1px solid var(--border)"><a href="${esc(n.url)}" target="_blank" rel="noopener"><b>${esc(n.title)}</b></a><div class="tiny muted">${esc(n.publisher)} · ${fmtDate(n.publishedAt)} · ${esc(n.category)}</div></div>`).join(''))}${pager(r, `/discovery/news?category=${query.category || 'all'}&page=`)}</div>`;
  } else if (tab === 'random') {
    const v = await get('/api/discovery/random');
    body = html`<div class="card" style="max-width:520px;margin:0 auto;text-align:center"><img src="${v.thumbnail}" alt="" style="width:200px;border-radius:12px" /><h3 style="margin-top:12px">${v.title}</h3><div class="muted small">${v.channel} · 조회수 ${compactViews(v.views)} · 24h +${compactViews(v.growth24h)}</div><div class="row" style="justify-content:center;margin-top:12px"><a class="btn" href="${v.url}" target="_blank" rel="noopener">영상 보기</a><a class="btn btn-primary" href="#/discovery/random?r=${Date.now()}" aria-label="랜덤 쇼츠 다시 보기">🎲 랜덤 쇼츠 다시 보기</a></div></div>`;
  }
  view.innerHTML = `<h1>디스커버리</h1>${tabsHtml}${body}`;
  const apply = qs('#d-apply'); if (apply) apply.onclick = () => { location.hash = `#/discovery/videos?${new URLSearchParams({ type: 'shorts', regions: qs('#d-region').value, sort_by: qs('#d-sort').value, q: qs('#d-q').value })}`; };
  const capply = qs('#c-apply'); if (capply) capply.onclick = () => { location.hash = `#/discovery/channels?${new URLSearchParams({ sort: qs('#c-sort').value, order: 'desc', days: qs('#c-days').value, country: 'KR' })}`; };
}
function videoRow(v) { return `<div class="video-item"><div class="rank">#${v.rank}</div><img src="${esc(v.thumbnail)}" alt="" loading="lazy" /><div><a href="${esc(v.url)}" target="_blank" rel="noopener"><b>${esc(v.title)}</b></a><div class="tiny muted">${esc(v.channel)} · ${v.durationSec}초 · ${esc(v.region)}</div></div><div class="small" style="text-align:right">조회수 ${compactViews(v.views)}<br/><span class="badge badge-success">24h +${compactViews(v.growth24h)}</span></div></div>`; }
function pager(r, base) { return `<div class="row" style="justify-content:center;margin-top:12px">${r.page > 1 ? `<a class="btn btn-sm" href="#${base}${r.page - 1}">이전</a>` : ''}<span class="small muted">${r.page} / ${Math.max(1, Math.ceil(r.total / r.limit))}</span>${r.hasMore ? `<a class="btn btn-sm" href="#${base}${r.page + 1}">더보기</a>` : ''}</div>`; }

// ---------------- SNS 업로드 ----------------
export const publish = auth(async ({ view, query, navigate }) => {
  const [platforms, accounts, queue, jobs] = await Promise.all([get('/api/publish/platforms'), get('/api/publish/accounts'), get('/api/publish/queue'), get('/api/shorts/jobs')]);
  const clips = (await Promise.all(jobs.filter((j) => j.status === 'done').map((j) => get(`/api/shorts/jobs/${j.id}`)))).flatMap((j) => j.clips);
  view.innerHTML = html`<h1>SNS 업로드</h1><p class="muted">클릭 한 번으로 모든 SNS에 바로 업로드하거나, 업로드를 예약하세요. 기본 예약: 오전 10시 · 월, 수, 금</p>
    <div class="split"><div class="col"><div class="card"><h3>연결된 계정</h3><div class="chips">${raw((accounts.map((a) => `<span class="chip">${esc(platforms.find((p) => p.id === a.platform)?.name)} · ${esc(a.handle)} <button class="btn btn-ghost btn-sm" data-disc="${a.id}">✕</button></span>`).join('')) || '<span class="muted small">아직 연결된 계정이 없습니다.</span>')}</div>
      <div class="row" style="margin-top:10px"><select id="pb-platform" style="width:auto">${raw(platforms.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join(''))}</select><input id="pb-handle" placeholder="@채널 또는 계정" style="max-width:220px" /><button class="btn" id="pb-connect">연결</button></div></div>
      <div class="card"><h3>업로드 / 예약</h3><div class="field"><label>클립</label><select id="pb-clip">${raw((clips.map((c) => `<option value="${c.id}" ${query.clip === c.id ? 'selected' : ''}>${esc(c.title)} (${c.ratio}, ${c.durationSec}초)</option>`).join('')) || '<option value="">완성된 클립이 없습니다</option>')}</select></div>
        <div class="field"><label>계정 선택</label><div class="chips">${raw(accounts.map((a) => `<label class="chip"><input type="checkbox" value="${a.id}" data-acc style="width:auto;margin-right:4px"/>${esc(platforms.find((p) => p.id === a.platform)?.name)} ${esc(a.handle)}</label>`).join(''))}</div></div>
        <div class="field"><label>제목</label><input id="pb-title" placeholder="비워두면 클립 제목 사용" /></div><div class="field"><label>설명 / 해시태그</label><textarea id="pb-desc" rows="2" placeholder="#shorts #쇼츠"></textarea></div>
        <div class="field"><label>언제 올릴까요?</label><select id="pb-when"><option value="now">지금 바로 업로드</option><option value="at">특정 시간 예약</option><option value="recurring">반복 예약 (요일 + 시간)</option></select></div>
        <div id="pb-at" class="field hidden"><input id="pb-at-input" type="datetime-local" /></div>
        <div id="pb-rec" class="hidden"><div class="chips" style="margin-bottom:8px">${raw([['mon', '월'], ['tue', '화'], ['wed', '수'], ['thu', '목'], ['fri', '금'], ['sat', '토'], ['sun', '일']].map(([v, l]) => `<label class="chip"><input type="checkbox" value="${v}" data-day ${['mon', 'wed', 'fri'].includes(v) ? 'checked' : ''} style="width:auto;margin-right:4px"/>${l}</label>`).join(''))}</div><input id="pb-time" type="time" value="10:00" style="max-width:160px" /></div>
        <button class="btn btn-primary btn-block" id="pb-go" style="margin-top:8px">업로드 예약</button></div></div>
      <div class="card"><h3>업로드 큐</h3><div class="table-wrap"><table class="table"><tr><th>시간</th><th>플랫폼</th><th>제목</th><th>상태</th><th></th></tr>${raw((queue.map((q) => `<tr><td>${fmtDate(q.scheduledAt)}${q.recurring ? ' 🔁' : ''}</td><td>${esc(platforms.find((p) => p.id === q.platform)?.name)}</td><td>${esc(q.title)}</td><td>${q.status === 'published' ? `<a class="badge badge-success" href="${esc(q.result?.url)}" target="_blank" rel="noopener">완료</a>` : q.status === 'scheduled' ? '<span class="badge badge-warn">예약</span>' : `<span class="badge badge-soft">${esc(q.status)}</span>`}</td><td>${q.status === 'scheduled' ? `<button class="btn btn-sm" data-cancel="${q.id}">취소</button>` : ''}</td></tr>`).join('')) || '<tr><td colspan="5" class="muted">큐가 비어 있습니다.</td></tr>')}</table></div></div></div>`;
  qs('#pb-when').onchange = (e) => { qs('#pb-at').classList.toggle('hidden', e.target.value !== 'at'); qs('#pb-rec').classList.toggle('hidden', e.target.value !== 'recurring'); };
  qs('#pb-connect').onclick = async () => { try { await post('/api/publish/accounts', { platform: qs('#pb-platform').value, handle: qs('#pb-handle').value }); navigate(`/publish?r=${Date.now()}`); } catch (err) { toast(err.message, 'error'); } };
  on(view, 'click', '[data-disc]', async (e, t) => { await del(`/api/publish/accounts/${t.dataset.disc}`); navigate(`/publish?r=${Date.now()}`); });
  on(view, 'click', '[data-cancel]', async (e, t) => { await del(`/api/publish/queue/${t.dataset.cancel}`); navigate(`/publish?r=${Date.now()}`); });
  qs('#pb-go').onclick = async () => {
    const when = qs('#pb-when').value;
    const schedule = when === 'at' ? { at: new Date(qs('#pb-at-input').value).toISOString() } : when === 'recurring' ? { recurring: { days: qsa('[data-day]:checked').map((d) => d.value), time: qs('#pb-time').value } } : null;
    try { const items = await post('/api/publish/schedule', { clipId: qs('#pb-clip').value, accountIds: qsa('[data-acc]:checked').map((a) => a.value), title: qs('#pb-title').value, description: qs('#pb-desc').value, hashtags: (qs('#pb-desc').value.match(/#\S+/g) || []), schedule }); toast(`${items.length}건 ${when === 'now' ? '업로드' : '예약'} 완료`); navigate(`/publish?r=${Date.now()}`); } catch (err) { toast(err.message, 'error', 5000); }
  };
});

// ---------------- 알파토픽 ----------------
export const topic = auth(async ({ view, query, navigate }) => {
  const reports = await get('/api/topic/reports');
  const cur = query.id ? reports.find((r) => r.id === query.id) : reports[0];
  view.innerHTML = html`<h1>알파토픽 · 채널 분석 & 떡상 주제 추천</h1><p class="muted">내 채널과 경쟁 채널 분석 후, 지금 올리기 좋은 영상 주제와 썸네일, 대본까지 AI가 추천합니다.</p>
    <div class="split"><div class="col"><div class="card"><div class="field"><label>내 채널 링크</label><input id="tp-channel" placeholder="https://youtube.com/@mychannel" /></div><div class="field"><label>경쟁 채널 (쉼표로 구분)</label><input id="tp-comp" placeholder="https://youtube.com/@rival1, https://youtube.com/@rival2" /></div><div class="grid grid-2"><div class="field"><label>장르</label><select id="tp-genre"><option value="education">교육 및 강의</option><option value="interview">인터뷰 및 토크</option><option value="info" selected>정보 및 리뷰</option><option value="gaming">게임 및 스트리밍</option><option value="vlog">브이로그 및 라이프</option></select></div><div class="field"><label>키워드</label><input id="tp-kw" placeholder="미국주식, 초보" /></div></div><button class="btn btn-primary" id="tp-go">분석하기</button></div>
      ${cur ? raw(renderTopic(cur)) : '<div class="card muted">아직 리포트가 없습니다. 채널을 분석해보세요.</div>'}</div>
      <div class="col"><div class="card"><h3>리포트</h3>${raw((reports.map((r) => `<div style="padding:6px 0;border-bottom:1px solid var(--border)"><a href="#/topic?id=${r.id}">${esc(r.channelUrl)}</a><div class="tiny muted">${fmtDate(r.createdAt)} · ${esc(r.genre)} · ${esc(r.engine)}</div></div>`).join('')) || '<p class="muted">없음</p>')}</div>
      <div class="card"><h3>대본 생성기</h3><div class="field"><input id="sc-title" placeholder="주제를 입력하세요" /></div><div class="row"><select id="sc-tone" style="width:auto"><option>친근한</option><option>전문적인</option><option>유머러스한</option><option>긴박한</option></select><button class="btn" id="sc-go">45초 대본 생성</button></div><pre id="sc-out" class="log" style="margin-top:8px;white-space:pre-wrap"></pre></div></div></div>`;
  qs('#tp-go').onclick = async (e) => { e.target.disabled = true; e.target.textContent = '분석 중...'; try { const r = await post('/api/topic/analyze', { channelUrl: qs('#tp-channel').value, competitors: qs('#tp-comp').value.split(',').map((s) => s.trim()).filter(Boolean), genre: qs('#tp-genre').value, keywords: qs('#tp-kw').value.split(',').map((s) => s.trim()).filter(Boolean) }); navigate(`/topic?id=${r.id}`); } catch (err) { toast(err.message, 'error'); e.target.disabled = false; e.target.textContent = '분석하기'; } };
  qs('#sc-go').onclick = async () => { try { const r = await post('/api/topic/script', { title: qs('#sc-title').value, tone: qs('#sc-tone').value }); qs('#sc-out').textContent = r.script; } catch (err) { toast(err.message, 'error'); } };
});
function renderTopic(r) {
  const R = r.report; const cs = R.channelSummary || {};
  return `<div class="card"><h3>${esc(cs.name || r.channelUrl)} 분석</h3><div class="chips"><span class="chip">평균 조회수 ${compactViews(cs.avgViews)}</span><span class="chip">30일 구독자 성장 +${cs.subscriberGrowth30d}%</span><span class="chip">업로드 ${esc(cs.postingCadence || '-')}</span></div><div class="grid grid-2" style="margin-top:10px"><div><b>강점</b><ul>${(cs.strengths || []).map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div><div><b>약점</b><ul>${(cs.weaknesses || []).map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div></div>
    ${(R.competitors || []).length ? `<h4>경쟁 채널</h4>${R.competitors.map((c) => `<div class="row row-between small"><span>${esc(c.name)}</span><span class="muted">평균 ${compactViews(c.avgViews)} · 급상승: ${(c.risingTopics || []).map(esc).join(', ')}</span></div>`).join('')}` : ''}</div>
    <div class="card" style="margin-top:12px"><h3>지금 올리기 좋은 주제</h3>${(R.recommendations || []).map((t) => `<div class="card" style="margin-bottom:10px"><div class="row row-between"><b>#${t.rank} ${esc(t.title)}</b><span class="badge badge-success">${t.score}점</span></div><div class="small muted">${esc(t.reason)}</div><div class="grid grid-2" style="margin-top:8px"><div class="card" style="background:var(--surface-2)"><div class="tiny muted">썸네일</div><div class="template-swatch" style="background:#111;font-size:1.1rem">${esc(t.thumbnail?.text || '')}</div><div class="tiny">${esc(t.thumbnail?.style || '')}</div></div><div class="card" style="background:var(--surface-2)"><div class="tiny muted">대본 (${t.script?.durationSec || 45}초)</div><div class="small"><b>후킹:</b> ${esc(t.script?.hook || '')}</div><ol class="small">${(t.script?.outline || []).map((o) => `<li>${esc(o)}</li>`).join('')}</ol></div></div><div class="chips" style="margin-top:6px">${(t.keywords || []).map((k) => `<span class="chip">#${esc(k)}</span>`).join('')}</div></div>`).join('')}</div>`;
}

// ---------------- 번역 ----------------
export const translate = auth(async ({ view }) => {
  const targets = await get('/api/translate/targets');
  view.innerHTML = html`<h1>클릭 한 번으로 다국어 번역</h1><p class="muted">국내 영상에 외국어 제목과 자막을, 해외 영상에 한국어 제목과 자막을 자동으로 붙여드립니다.</p>
    <div class="split"><div class="card"><div class="field"><label>원문</label><textarea id="tr-src" rows="6">엄청 따뜻해서 좋고</textarea></div><div class="row"><select id="tr-to" style="width:auto">${raw(targets.map((t) => `<option value="${t.code}" ${t.code === 'ja' ? 'selected' : ''}>${esc(t.label)}</option>`).join(''))}</select><button class="btn btn-primary" id="tr-go">번역하기</button></div></div><div class="card"><div class="muted small">번역 결과</div><div id="tr-out" style="font-size:1.2rem;font-weight:700;margin-top:8px">熱々で良いです</div><div class="tiny muted" id="tr-engine"></div></div></div>`;
  qs('#tr-go').onclick = async () => { try { const r = await post('/api/translate', { text: qs('#tr-src').value, target: qs('#tr-to').value }); qs('#tr-out').textContent = r.text; qs('#tr-engine').textContent = `엔진: ${r.engine}`; } catch (err) { toast(err.message, 'error'); } };
});

// ---------------- 계정 / 이용권 / 문의 ----------------
export const account = auth(async ({ view, state, navigate }) => {
  const [ref, payments] = await Promise.all([get('/api/referral'), get('/api/billing/payments')]);
  const u = state.user;
  view.innerHTML = html`<h1>내 계정</h1><div class="split"><div class="col"><div class="card"><h3>프로필</h3><div class="field"><label>이름</label><input id="ac-name" value="${u.name}" /></div><div class="field"><label>이메일</label><input value="${u.email}" disabled /></div><div class="grid grid-2"><div class="field"><label>언어</label><select id="ac-locale">${raw(state.info.locales.map((l) => `<option value="${l.code}" ${l.code === u.locale ? 'selected' : ''}>${esc(l.label)}</option>`).join(''))}</select></div><div class="field"><label>테마</label><select id="ac-theme">${raw(['system', 'light', 'dark'].map((t) => `<option ${t === u.theme ? 'selected' : ''}>${t}</option>`).join(''))}</select></div></div><div class="field"><label>내 유튜브 채널</label><input id="ac-channel" value="${u.channelUrl || ''}" placeholder="https://youtube.com/@..." /></div><button class="btn btn-primary" id="ac-save">저장</button></div>
      <div class="card"><h3>비밀번호 변경</h3><div class="field"><label>현재 비밀번호</label><input id="pw-cur" type="password" /></div><div class="field"><label>새 비밀번호</label><input id="pw-new" type="password" /></div><button class="btn" id="pw-go">변경</button></div></div>
      <div class="col"><div class="card"><h3>요금제 & 이용권</h3><div style="font-size:1.6rem;font-weight:900">${creditsLabel(u)}</div><div class="muted small">요금제: ${u.plan || 'free'} ${u.teamSeats ? `· 팀 ${u.teamSeats}석` : ''} ${(u.addons || []).length ? `· 부가: ${u.addons.join(', ')}` : ''}</div><div class="row" style="margin-top:8px"><a class="btn btn-primary btn-sm" href="#/pricing">충전</a><a class="btn btn-sm" href="#/credits">사용 내역</a></div></div>
      <div class="card"><h3>추천인</h3><div class="row row-between"><b style="font-size:1.2rem">${ref.code}</b><button class="btn btn-sm" id="ref-copy">복사</button></div><div class="tiny muted">초대 ${ref.invited}명 · 적립 ${ref.earnedMinutes}분</div></div>
      <div class="card"><h3>팀 계정 문의</h3><p class="small muted">여러 명이 이용권을 공유하는 팀 계정을 신청하세요.</p><div class="row"><input id="tm-company" placeholder="회사/팀명" /><input id="tm-seats" type="number" min="2" value="3" style="max-width:90px" /><button class="btn" id="tm-go">신청</button></div></div>
      <div class="card"><h3>결제 내역</h3>${raw((payments.map((p) => `<div class="row row-between small"><span>${fmtDate(p.createdAt)} · ${esc(p.planId)}</span><span>${p.currency === 'USD' ? `$${p.amount}` : fmtKRW(p.amount)} · ${esc(p.gateway)}</span></div>`).join('')) || '<p class="muted small">결제 내역이 없습니다.</p>')}</div></div></div>`;
  qs('#ac-save').onclick = async () => { try { await patch('/api/auth/me', { name: qs('#ac-name').value, locale: qs('#ac-locale').value, theme: qs('#ac-theme').value, channelUrl: qs('#ac-channel').value }); document.documentElement.setAttribute('data-theme', qs('#ac-theme').value); await window.AlphaManApp.refreshUser(); toast('저장되었습니다.'); } catch (err) { toast(err.message, 'error'); } };
  qs('#pw-go').onclick = async () => { try { await post('/api/auth/password', { currentPassword: qs('#pw-cur').value, newPassword: qs('#pw-new').value }); toast('비밀번호가 변경되었습니다.'); } catch (err) { toast(err.message, 'error'); } };
  qs('#ref-copy').onclick = () => { navigator.clipboard?.writeText(`${location.origin}/?ref=${ref.code}#/signup`); toast('복사되었습니다.'); };
  qs('#tm-go').onclick = async () => { try { await post('/api/team/request', { company: qs('#tm-company').value, seats: Number(qs('#tm-seats').value) }); toast('팀 계정 문의가 접수되었습니다. 관리자가 확인 후 연락드립니다.'); } catch (err) { toast(err.message, 'error'); } };
});

export const credits = auth(async ({ view }) => {
  const { balance, ledger } = await get('/api/credits');
  view.innerHTML = html`<h1>이용권</h1><div class="card"><div style="font-size:1.8rem;font-weight:900">${balance}분</div><a class="btn btn-primary btn-sm" href="#/pricing">충전하기</a></div><div class="card table-wrap" style="margin-top:12px"><table class="table"><tr><th>일시</th><th>내용</th><th>변동</th></tr>${raw(ledger.map((l) => `<tr><td>${fmtDate(l.createdAt)}</td><td>${esc(l.reason)}</td><td class="${l.delta > 0 ? 'badge-success' : ''}" style="font-weight:700;color:${l.delta > 0 ? 'var(--success)' : 'var(--danger)'}">${l.delta > 0 ? '+' : ''}${l.delta}분</td></tr>`).join(''))}</table></div>`;
});

export async function support({ view, state, params, navigate }) {
  const mine = state.user ? await get('/api/support/inquiries') : [];
  const cur = params.id ? mine.find((i) => i.id === params.id) : null;
  view.innerHTML = html`<h1>문의하기</h1><p class="muted">답변은 최대 24시간 안에 이메일과 알림으로 드립니다. 빠른 답변은 픽시(챗봇)에서 "관리자에게 전달"을 이용하세요.</p>
    <div class="split"><div class="card"><div class="field"><label>분류</label><select id="sp-cat"><option value="general">일반</option><option value="billing">결제/이용권</option><option value="bug">오류 신고</option><option value="team">팀 계정</option><option value="overseas">해외 결제</option></select></div>${state.user ? '' : raw('<div class="field"><label>답변 받을 이메일</label><input id="sp-email" type="email" /></div>')}<div class="field"><label>문의 내용</label><textarea id="sp-msg" rows="5" placeholder="문의 내용을 입력해주세요."></textarea></div><button class="btn btn-primary" id="sp-go">보내기</button></div>
      <div class="card"><h3>내 문의</h3>${cur ? raw(`<div class="card" style="margin-bottom:10px"><b>${esc(cur.message)}</b> <span class="badge badge-soft">${esc(cur.status)}</span><div class="chat-body" style="margin-top:8px">${cur.messages.map((m) => `<div class="msg ${m.from === 'user' ? 'user' : 'admin'}">${esc(m.text)}</div>`).join('')}</div><div class="input-row" style="margin-top:8px"><input id="sp-reply" placeholder="추가 메시지" /><button class="btn" id="sp-reply-go">전송</button></div></div>`) : ''}${raw((mine.map((i) => `<div style="padding:6px 0;border-bottom:1px solid var(--border)"><a href="#/support/${i.id}">${esc(i.message.slice(0, 40))}</a> <span class="badge badge-soft">${esc(i.status)}</span><div class="tiny muted">${fmtDate(i.createdAt)}</div></div>`).join('')) || '<p class="muted">문의 내역이 없습니다.</p>')}</div></div>`;
  qs('#sp-go').onclick = async () => { try { await post('/api/support/inquiries', { category: qs('#sp-cat').value, email: qs('#sp-email')?.value, message: qs('#sp-msg').value }); toast('문의가 접수되었습니다.'); qs('#sp-msg').value = ''; if (state.user) navigate(`/support?r=${Date.now()}`); } catch (err) { toast(err.message, 'error'); } };
  const rg = qs('#sp-reply-go'); if (rg) rg.onclick = async () => { await post(`/api/support/inquiries/${cur.id}/messages`, { text: qs('#sp-reply').value }); navigate(`/support/${cur.id}?r=${Date.now()}`); };
}
