// AI 재구성(리믹스) + 내 목소리 TTS 페이지
import { get, post, patch, del, uploadFile, downloadUrl, getToken } from './api.js';
import { esc, html, raw, toast, modal, confirmDialog, fmtTime, fmtDate, creditsLabel, readVideoMeta, extractVoiceSample, qs, qsa, on } from './ui.js';
import { transcriptPanel, transcriptController, exactBadge } from './transcript.js';
import { mountPlayer, getWithRetry } from './player.js';
import { seoButtons, bindSeoButtons } from './pages-seo.js';
import { listenFreeVoice, playProfileSample, playRender, stopAll } from './tts.js';

const auth = (fn) => Object.assign(fn, { requiresAuth: true });
const statusBadge = (s) => `<span class="badge ${s === 'done' ? 'badge-success' : s === 'failed' ? 'badge-danger' : 'badge-warn'}">${{ done: '완료', failed: '실패', queued: '대기', processing: '진행 중' }[s] || esc(s)}</span>`;
function saveBlob(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }

export const remix = auth(async ({ view, state, navigate }) => {
  const [defs, jobs, { profiles, freeVoices = [] }] = await Promise.all([get('/api/remix/defaults'), get('/api/remix/jobs'), get('/api/voice/profiles')]);
  view.innerHTML = html`<div class="row row-between"><h1>🪄 AI 재구성</h1><span class="badge">보유 이용권 ${creditsLabel(state.user)}</span></div>
    <p class="muted">영상 링크 또는 파일 하나만 넣으면 원본의 자막·효과음·배경음을 걷어내고 ${defs.limits.minMinutes}~${defs.limits.maxMinutes}분으로 길이를 맞춘 뒤, AI 가 새 자막·효과음·배경음·내레이션을 입혀 다시 구성합니다. 참고 유튜브 영상을 넣으면 그 영상의 구성과 호흡, 자막 스타일을 따라 재구성합니다.</p>
    <div class="split"><div class="card">
      <h3>1. 원본 영상 (롱폼 또는 쇼츠 링크, 또는 파일 중 하나)</h3>
      <div class="tabs" id="r-tabs"><button class="tab active" data-tab="youtube">영상 링크 (롱폼/쇼츠)</button><button class="tab" data-tab="file">파일 업로드</button><button class="tab desktop-only" data-tab="local">컴퓨터/USB 영상</button></div>
      <div id="r-youtube"><div class="field"><input id="r-url" placeholder="YouTube 롱폼 / YouTube Shorts / TikTok / Reels 링크" /><div class="tiny muted">원본이 목표보다 길면 핵심 구간만 골라 줄이고, 쇼츠처럼 짧으면 챕터 카드·하이라이트 리플레이·슬로모션으로 목표 길이까지 늘립니다.</div></div><div class="field"><label>예상 길이(분) - 메타데이터를 가져오지 못할 때 사용</label><input id="r-est" type="number" min="1" value="10" /></div></div>
      <div id="r-file" class="hidden"><div class="dropzone" id="r-drop">MP4, MOV, WebM 파일을 끌어다 놓거나 클릭 <input type="file" id="r-file-input" accept="video/*" class="hidden" /></div><div id="r-file-meta" class="small muted" style="margin-top:8px"></div><div class="progress" style="margin-top:8px"><div id="r-upload-bar" style="width:0"></div></div></div>
      <div id="r-local" class="hidden"><button class="btn" id="r-pick-local">파일 선택 (프로그램 전용)</button><div id="r-local-path" class="small muted"></div></div>
      ${raw(transcriptPanel('r', { info: state.info }))}

      <h3 style="margin-top:20px">2. 참고 영상 링크 (선택) — "이런 식으로 편집해줘"</h3>
      <div class="field"><input id="r-ref" placeholder="참고할 영상 링크 (YouTube 롱폼 / Shorts / TikTok / Reels)" /><div class="tiny muted">비워두면 장르에 맞게 자동 편집합니다. 넣으면 참고 영상의 섹션 구조와 구간 길이 비율, 후킹 길이, 호흡(컷 속도), 자막 스타일·위치, 효과음 밀도, 전환, 색감, 화면 비율, 배경음 무드를 분석해 그 영상과 비슷하게 재구성합니다.</div></div>

      <h3 style="margin-top:20px">3. 재구성 옵션</h3>
      <div class="field"><label>목표 길이: <b id="r-len-label">${defs.targetMinutes}분</b> (${defs.limits.minMinutes}~${defs.limits.maxMinutes}분)</label><input id="r-len" type="range" min="${defs.limits.minMinutes}" max="${defs.limits.maxMinutes}" value="${defs.targetMinutes}" /></div>
      <div class="toggle-grid">
        <label class="check"><input type="checkbox" data-opt="removeBurnedSubtitles" checked/> 원본 자막 제거</label>
        <label class="check"><input type="checkbox" data-opt="removeSfx" checked/> 원본 효과음 제거</label>
        <label class="check"><input type="checkbox" data-opt="removeBgm" checked/> 원본 배경음악 제거</label>
        <label class="check"><input type="checkbox" data-opt="keepOriginalVoice" checked/> 원본 목소리 유지</label>
        <label class="check"><input type="checkbox" data-opt="newSubtitles" checked/> 새 자막 (템플릿)</label>
        <label class="check"><input type="checkbox" data-opt="newSfx" checked/> 새 효과음</label>
        <label class="check"><input type="checkbox" data-opt="newBgm" checked/> 새 배경음악</label>
        <label class="check"><input type="checkbox" data-opt="reorder" checked/> 구조 재배열 (후킹→본문→마무리)</label>
        <label class="check"><input type="checkbox" data-opt="outro" checked/> 마무리 구독·좋아요·알림 카드</label>
      </div>
      <div class="field" style="margin-top:8px"><label>마무리 카드 문구</label><input id="r-outro-text" value="구독 · 좋아요 · 알림 설정 🔔" maxlength="60" /></div>
      <div class="grid grid-3" style="margin-top:12px">
        <div class="field"><label>자막 템플릿</label><select id="r-template"><option value="auto">자동 (참고 영상/장르)</option>${raw(defs.templates.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join(''))}</select></div>
        <div class="field"><label>호흡</label><select id="r-pacing"><option value="auto">자동 (참고 영상)</option><option value="slow">느리게</option><option value="normal">보통</option><option value="fast">빠르게</option></select></div>
        <div class="field"><label>비율</label><select id="r-ratio"><option value="auto">자동 (참고/원본 비율)</option><option>16:9</option><option>9:16</option><option>1:1</option></select></div>
        <div class="field"><label>전환</label><select id="r-trans"><option value="auto">자동</option><option value="hard-cut">하드컷</option><option value="crossfade">크로스페이드</option><option value="zoom">줌</option></select></div>
        <div class="field"><label>색보정</label><select id="r-color"><option value="auto">자동</option><option value="clean-bright">밝고 깨끗하게</option><option value="cinematic">시네마틱</option><option value="warm">따뜻하게</option><option value="none">없음</option></select></div>
        <div class="field"><label>언어</label><select id="r-lang"><option value="ko">한국어</option><option value="en">English</option><option value="ja">日本語</option></select></div>
      </div>

      <h3 style="margin-top:20px">4. 내레이션 목소리 (선택)</h3>
      <div class="grid grid-2"><div class="field"><label>내레이션</label><select id="r-narr"><option value="none">없음</option><option value="intro">오프닝·마무리만</option><option value="full">전체 내레이션 (섹션마다)</option></select></div>
        <div class="field"><label>목소리</label><div class="row"><select id="r-voice"><optgroup label="무료 한국어 목소리">${raw(freeVoices.filter((v) => (v.lang || 'ko-KR').startsWith('ko')).map((v) => `<option value="free:${v.id}" ${v.id === 'ko-injoon' ? 'selected' : ''}>🔊 ${esc(v.name)} — ${esc(v.tone)}</option>`).join(''))}</optgroup><optgroup label="내 목소리">${raw(profiles.map((p) => `<option value="profile:${p.id}">🎤 ${esc(p.name)} (${p.sampleDurationSec}초 샘플 · ${esc(p.engine)})</option>`).join('') || '<option disabled>프로필 없음</option>')}</optgroup><optgroup label="다른 언어">${raw(freeVoices.filter((v) => !(v.lang || 'ko-KR').startsWith('ko')).map((v) => `<option value="free:${v.id}">🌐 ${esc(v.name)} — ${esc(v.tone)}</option>`).join(''))}</optgroup></select><button class="btn btn-sm" id="r-voice-listen" type="button">▶ 듣기</button></div><div class="tiny muted">내 목소리는 <a href="#/voice">내 목소리 TTS</a>에서 샘플을 올려 만드세요.</div></div></div>

      <label class="check" style="margin-top:8px"><input type="checkbox" id="r-rights"/> <span>이 영상은 내가 직접 제작했거나 사용 허가를 받은 영상입니다. (타인의 영상을 무단으로 재구성하는 용도로는 사용할 수 없습니다)</span></label>
      <button class="btn btn-primary btn-lg btn-block" id="r-go" style="margin-top:12px">AI 재구성 시작</button>
    </div>
    <div class="col"><div class="card"><h3>내 재구성 작업</h3>${raw(jobs.length ? jobs.map((j) => `<div class="row row-between" style="padding:8px 0;border-bottom:1px solid var(--border)"><div><a href="#/remix/${j.id}"><b>${esc(j.source.title)}</b></a><div class="tiny muted">${fmtDate(j.createdAt)} · ${fmtTime(j.source.durationSec)} → ${j.options.targetMinutes}분${j.reference ? ' · 참고 영상' : ''}${j.options.narration !== 'none' ? ' · 내레이션' : ''}</div></div>${statusBadge(j.status)}</div>`).join('') : '<p class="muted">아직 작업이 없습니다.</p>')}</div>
      <div class="card small muted"><b>어떻게 동작하나요?</b><ol style="padding-left:18px;margin:6px 0"><li>원본 가져오기 → 참고 영상 스타일 분석</li><li>음성 인식으로 대본 추출</li><li>박힌 자막·효과음·배경음 제거 (음원 분리)</li><li>AI 가 목표 길이에 맞게 구간 선별·재배열</li><li>새 자막·효과음·배경음·전환·내레이션 입히기</li><li>렌더링 (ffmpeg 설치 시 실제 MP4)</li></ol>원본 길이만큼 이용권이 차감되고, 다시 만들기는 절반입니다.</div></div></div>`;

  let mode = 'youtube'; let uploadId = null; let localPath = null;
  const tc = transcriptController('r', { language: () => qs('#r-lang').value });
  qs('#r-voice-listen').onclick = () => { const v = qs('#r-voice').value || ''; if (v.startsWith('profile:')) playProfileSample(v.slice(8)); else listenFreeVoice(v.replace('free:', ''), freeVoices); };
  qsa('#r-tabs .tab').forEach((t) => { t.onclick = () => { mode = t.dataset.tab; qsa('#r-tabs .tab').forEach((x) => x.classList.remove('active')); t.classList.add('active'); ['youtube', 'file', 'local'].forEach((m) => qs(`#r-${m}`).classList.toggle('hidden', m !== mode)); }; });
  qs('#r-len').oninput = (e) => { qs('#r-len-label').textContent = `${e.target.value}분`; };
  const drop = qs('#r-drop'); const input = qs('#r-file-input');
  drop.onclick = () => input.click(); drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); }; drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); e.dataTransfer.files[0] && pick(e.dataTransfer.files[0]); };
  input.onchange = () => input.files[0] && pick(input.files[0]);
  async function pick(file) {
    try { const meta = await readVideoMeta(file); qs('#r-file-meta').textContent = `${file.name} · ${fmtTime(meta.durationSec)} · 업로드 중...`; tc.fromFile(file); const up = await uploadFile(file, (p) => { qs('#r-upload-bar').style.width = `${p}%`; }); uploadId = up.id; qs('#r-file-meta').textContent = `${file.name} · ${fmtTime(meta.durationSec)} · 업로드 완료 · 필요 이용권 ${(meta.durationSec / 60).toFixed(1)}분`; }
    catch (err) { uploadId = null; toast(err.message, 'error', 6000); }
  }
  if (window.alphaman?.pickVideo) qs('#r-pick-local').onclick = async () => { const p = await window.alphaman.pickVideo(); if (p) { localPath = p; qs('#r-local-path').textContent = p; tc.fromLocalPath(p); } };
  qs('#r-go').onclick = async (e) => {
    if (tc.state.busy) return toast('원본 대본 추출이 끝날 때까지 잠시 기다려주세요.', 'info');
    const vsel = qs('#r-voice').value || '';
    const options = { targetMinutes: Number(qs('#r-len').value), template: qs('#r-template').value, pacing: qs('#r-pacing').value, ratio: qs('#r-ratio').value, transitions: qs('#r-trans').value, colorGrade: qs('#r-color').value, language: qs('#r-lang').value, narration: qs('#r-narr').value, voiceProfileId: vsel.startsWith('profile:') ? vsel.slice(8) : null, voiceId: vsel.startsWith('free:') ? vsel.slice(5) : null, outroText: qs('#r-outro-text').value.trim() || undefined };
    qsa('[data-opt]').forEach((c) => { options[c.dataset.opt] = c.checked; });
    const body = { options, referenceUrl: qs('#r-ref').value.trim() || null, rightsConfirmed: qs('#r-rights').checked, ...tc.payload() };
    if (mode === 'youtube') { body.url = qs('#r-url').value; body.options.estimatedDurationSec = Number(qs('#r-est').value || 10) * 60; if (!body.url.trim()) return toast('원본 영상 링크를 입력해주세요.', 'error'); }
    else if (mode === 'file') { if (!uploadId) return toast('먼저 영상 파일을 업로드해주세요.', 'error'); body.uploadId = uploadId; }
    else { if (!localPath) return toast('파일을 선택해주세요.', 'error'); body.localPath = localPath; }
    e.target.disabled = true; e.target.textContent = '작업 생성 중...';
    try { const job = await post('/api/remix/jobs', body); await window.AlphaManApp.refreshUser(); toast('AI 재구성을 시작했어요'); navigate(`/remix/${job.id}`); }
    catch (err) { toast(err.message, 'error', 6000); e.target.disabled = false; e.target.textContent = 'AI 재구성 시작'; }
  };
});

export const remixJob = auth(async ({ view, params, navigate }) => {
  let job = await get(`/api/remix/jobs/${params.id}`);
  let timer = null;
  const stepNames = { queued: '대기', ingest: '원본 가져오기', reference: '참고 영상 분석', transcribing: '음성 인식', cleaning: '원본 정리 (자막·효과음·배경음 제거)', planning: 'AI 구성 계획', rebuilding: '새 자막·효과음·내레이션', rendering: '렌더링', done: '완료', failed: '실패' };
  const draw = () => {
    const r = job.result;
    view.innerHTML = html`<div class="row row-between"><div><a href="#/remix" class="small">← AI 재구성</a><h1>${r?.plan?.title || job.source.title}</h1><div class="muted small">원본: ${job.source.title} · ${fmtTime(job.source.durationSec)} · 목표 ${job.options.targetMinutes}분 · ${job.minutesCharged}분 차감${job.reference ? raw(` · 참고: <a href="${esc(job.reference.url)}" target="_blank" rel="noopener">${esc(job.reference.title)}</a>`) : ''}</div></div>
      <div class="row">${job.status === 'done' ? raw('<a class="btn" href="#/library?kind=remix">📁 보관함</a>') : ''}<button class="btn" id="rj-regen" ${job.status === 'done' || job.status === 'failed' ? '' : 'disabled'}>다시 만들기 (${(job.minutesCharged / 2).toFixed(1)}분)</button><button class="btn btn-danger" id="rj-del">삭제</button></div></div>
      ${job.status !== 'done' ? raw(`<div class="card"><div class="row row-between"><b>${esc(stepNames[job.step] || job.step)}</b><span>${job.progress}%</span></div><div class="progress"><div style="width:${job.progress}%"></div></div><div class="log" style="margin-top:10px">${job.log.map((l) => `${esc(l.at.slice(11, 19))} [${esc(l.step)}] ${esc(l.message)}`).join('\n')}</div>${job.error ? `<p class="badge badge-danger">${esc(job.error)}</p>` : ''}</div>`) : raw(renderResult(job))}`;
    if (job.status === 'done') { const host = qs('#rj-player'); if (host) getWithRetry(`/api/preview/remix/${job.id}`).then((spec) => mountPlayer(host, spec)).catch((err) => { host.innerHTML = `<div class="tiny muted">미리보기를 불러오지 못했습니다: ${esc(err.message)} <button class="btn btn-sm" onclick="location.reload()">다시 시도</button></div>`; }); bindSeoButtons(view); }
    on(view, 'click', '[data-play-narr]', async (e, t) => { const line = job.result?.narration?.lines?.[Number(t.dataset.playNarr)]; if (line) playRender(line); });
    qs('#rj-regen').onclick = async () => { if (!(await confirmDialog(`다시 만들면 이용권 ${(job.minutesCharged / 2).toFixed(1)}분이 차감됩니다.`))) return; try { job = await post(`/api/remix/jobs/${job.id}/regenerate`); await window.AlphaManApp.refreshUser(); draw(); poll(); } catch (err) { toast(err.message, 'error'); } };
    qs('#rj-del').onclick = async () => { if (await confirmDialog('작업을 삭제할까요?')) { await del(`/api/remix/jobs/${job.id}`); navigate('/remix'); } };
    on(view, 'click', '[data-export]', async (e, t) => {
      const fmt = t.dataset.export;
      const res = await fetch(downloadUrl(`/api/remix/jobs/${job.id}/export?format=${fmt}`), { headers: { Authorization: `Bearer ${getToken()}` } });
      if ((res.headers.get('content-type') || '').includes('json') && fmt === 'mp4') { const j = await res.json(); modal(`<p>${esc(j.message || '')}</p><pre class="log">${esc(JSON.stringify(j.plan, null, 2))}</pre>`, { title: '렌더 계획', wide: true }); return; }
      saveBlob(await res.blob(), `${job.id}.${fmt}`);
    });
    const save = qs('#rj-save'); if (save) save.onclick = async () => {
      const subs = qs('#rj-subs').value.split('\n').map((l) => l.split('|')).filter((p) => p.length >= 3).map(([start, end, ...t]) => ({ start: Number(start), end: Number(end), text: t.join('|') }));
      const sfx = qs('#rj-sfx').value.split('\n').map((l) => l.split('|')).filter((p) => p.length >= 2).map(([at, name]) => ({ at: Number(at), name: name.trim() }));
      try { job = await patch(`/api/remix/jobs/${job.id}`, { title: qs('#rj-title').value, subtitles: subs, sfx }); toast('저장되었습니다.'); draw(); } catch (err) { toast(err.message, 'error'); }
    };
  };
  const poll = () => { clearInterval(timer); timer = setInterval(async () => { try { job = await get(`/api/remix/jobs/${job.id}`); draw(); if (job.status === 'done' || job.status === 'failed') { clearInterval(timer); window.AlphaManApp.refreshUser(); } } catch { clearInterval(timer); } }, 1200); };
  draw(); if (job.status !== 'done' && job.status !== 'failed') poll();
  window.addEventListener('hashchange', () => clearInterval(timer), { once: true });
});

function renderResult(job) {
  const r = job.result; const D = job.source.durationSec; const F = r.finalDurationSec || 1;
  const sp = r.styleProfile;
  return `<div class="card"><h3>▶ 완성본 미리보기</h3><div class="tiny muted">${r.render?.rendered ? '렌더된 MP4 를 재생합니다.' : '원본을 새 타임라인(원본 구간 · 리플레이 · 슬로모션 · 카드)대로 이어 재생하며 자막·후킹을 겹쳐 보여줍니다. ffmpeg 이 있는 프로그램 버전에서는 실제 MP4 가 렌더링됩니다.'}</div><div id="rj-player" class="preview-inline"><div class="muted">플레이어 준비 중...</div></div>
    <div class="chips"><span class="chip">${esc(r.summary)}</span><span class="chip">장르 ${esc(r.genre)}</span><span class="chip">호흡 ${esc(r.plan.pacing)}</span><span class="chip">템플릿 ${esc(r.template.name)}</span><span class="chip">STT ${esc(r.transcriptEngine)}</span>${exactBadge(r.transcriptExact)}<span class="chip">계획 ${esc(r.plan.engine)}</span></div>
    <div class="row" style="margin-top:10px;flex-wrap:wrap"><button class="btn btn-primary" data-export="mp4">MP4 내보내기</button><button class="btn" data-export="ass">자막(ASS)</button><button class="btn" data-export="json">편집 데이터(JSON)</button>${seoButtons('remix', job.id)}<a class="btn" href="#/library?kind=remix">📁 보관함</a></div>
    ${r.seo ? `<div class="grid grid-2" style="margin-top:12px"><div><div class="tiny muted">🏆 유튜브 최고 추천 제목</div><div style="font-weight:900">${esc(r.seo.bestTitle)}</div><div class="tiny muted" style="margin-top:4px">원본과 비슷한 제목: ${esc(r.seo.similarTitle)}</div><div class="chips" style="margin-top:6px">${r.seo.hashtags.map((h) => `<span class="chip">${esc(h)}</span>`).join('')}</div></div>${job.thumbnailSet ? `<div><div class="tiny muted">🖼️ 자동 제작 썸네일 (${esc(job.thumbnailSet.style)})</div><img src="${esc(downloadUrl(`/api/thumbnail/remix/${job.id}/image.svg?v=${encodeURIComponent(job.thumbnailSet.updatedAt)}`))}" alt="썸네일" style="width:100%;max-height:220px;object-fit:contain;border-radius:10px;background:#000;cursor:pointer" data-thumb="remix:${job.id}" /></div>` : ''}</div>` : ''}</div>
  <div class="split" style="margin-top:16px"><div class="col">
    <div class="card"><h3>구성</h3><div class="small"><b>후킹:</b> ${esc(r.plan.hook)}</div><div class="small muted">${esc(r.plan.description)}</div><ol class="small">${r.plan.outline.map((o) => `<li>${esc(o)}</li>`).join('')}</ol>
      <div class="tiny muted">원본 타임라인 (유지 구간)</div><div class="timeline">${r.plan.keep.map((k) => `<div class="seg" style="left:${(k.start / D) * 100}%;width:${Math.max(0.3, ((k.end - k.start) / D) * 100)}%" title="${esc(k.reason)}"></div>`).join('')}</div>
      <div class="tiny muted" style="margin-top:8px">새 타임라인 ${fmtTime(F)} (목표 ${job.options.targetMinutes}분${r.extended ? ` · 원본 ${fmtTime(D)} → ${r.stretchFactor}배 확장` : ''}) · 항목 ${r.timeline.length}개 · 전환 ${r.transitions.length}개 · 효과음 ${r.sfx.length}개</div><div class="timeline">${r.timeline.map((t) => `<div class="seg" style="left:${(t.newStart / F) * 100}%;width:${Math.max(0.3, ((t.newEnd - t.newStart) / F) * 100)}%;background:${{ source: 'var(--primary)', replay: 'var(--accent)', slowmo: '#16a34a', card: '#6b7280' }[t.kind] || 'var(--primary)'}" title="${esc(t.kind)} ${esc(t.title || t.reason || '')}"></div>`).join('')}${r.sfx.map((s) => `<div class="cut" style="left:${(s.at / F) * 100}%;width:0.4%" title="${esc(s.name)}"></div>`).join('')}</div>
      <div class="chips" style="margin-top:6px"><span class="chip" style="border-color:var(--primary)">원본 구간 ${r.timeline.filter((t) => t.kind === 'source').length}</span><span class="chip" style="border-color:var(--accent)">리플레이 ${r.timeline.filter((t) => t.kind === 'replay').length}</span><span class="chip" style="border-color:#16a34a">슬로모션 ${r.timeline.filter((t) => t.kind === 'slowmo').length}</span><span class="chip">카드 ${r.timeline.filter((t) => t.kind === 'card').length}</span></div></div>
    <div class="card"><h3>원본 정리</h3>${r.cleaning.steps.map((s) => `<div class="small">• ${esc(s.id)} <span class="muted">(${esc(s.method)}) ${esc(s.note || '')}</span></div>`).join('')}</div>
    ${sp ? `<div class="card"><h3>참고 영상처럼 편집됨</h3><div class="small muted">참고: <a href="${esc(sp.reference?.url)}" target="_blank" rel="noopener">${esc(sp.reference?.title)}</a> (${sp.reference?.isShorts ? '쇼츠' : '롱폼'}${sp.reference?.durationSec ? ` · ${fmtTime(sp.reference.durationSec)}` : ''}) · 분석 ${esc(sp.engine)}</div><div class="chips" style="margin-top:6px"><span class="chip">호흡 ${esc(sp.pacing)} (${sp.avgShotSec}초/컷, ${sp.cutsPerMinute}컷/분)</span><span class="chip">후킹 ${sp.hookDurationSec}초 · ${esc(sp.hookType)}</span><span class="chip">자막 ${esc(sp.subtitleStyle)} · ${esc(sp.subtitlePosition)}</span><span class="chip">톤 ${esc(sp.tone)}</span><span class="chip">효과음 ${esc(sp.sfxDensity)}</span><span class="chip">BGM ${esc(sp.bgm)}</span><span class="chip">전환 ${esc(sp.transitions)}</span><span class="chip">색감 ${esc(sp.colorGrade)}</span><span class="chip">비율 ${esc(sp.ratio)}</span><span class="chip">줌 ${esc(sp.zoomStyle)}</span></div><div class="tiny muted" style="margin-top:8px">섹션 구조 · 구간 길이 비율 (참고 영상 그대로)</div><ol class="small">${(sp.structure || []).map((s, i) => `<li>${esc(s)} <span class="muted">${Math.round((sp.segmentPattern?.[i] || 0) * 100)}%</span></li>`).join('')}</ol></div>` : '<div class="card small muted">참고 영상 링크를 넣지 않아 장르 기본 스타일로 편집했습니다. 다음에는 "참고 영상 링크"에 원하는 편집 스타일의 영상을 넣어보세요.</div>'}
    ${r.narration ? `<div class="card"><h3>내레이션 (${r.narration.mode === 'full' ? '전체' : '오프닝·마무리'} · ${esc(r.narration.voice?.label || '내 목소리')})</h3>${r.narration.lines.map((l, i) => `<div class="small" style="padding:4px 0;border-bottom:1px dashed var(--border)"><button class="btn btn-sm" data-play-narr="${i}" title="들어보기">▶</button> <span class="kbd">${fmtTime(l.at)}</span> ${esc(l.text)} <span class="tiny muted">${esc(l.engine)}${l.audioPath ? ' · 음성 파일' : l.engine === 'browser' ? ' · 브라우저 음성' : ' · 합성 계획'}</span></div>`).join('')}</div>` : ''}
  </div><div class="col">
    <div class="card"><h3>편집</h3><div class="field"><label>제목</label><input id="rj-title" value="${esc(r.plan.title)}" /></div>
      <div class="field"><label>자막 (시작|끝|텍스트)</label><textarea id="rj-subs" rows="10">${r.subtitles.map((s) => `${s.start}|${s.end}|${esc(s.text)}`).join('\n')}</textarea></div>
      <div class="field"><label>효과음 큐 (시간|이름)</label><textarea id="rj-sfx" rows="5">${r.sfx.map((s) => `${s.at}|${esc(s.name)}`).join('\n')}</textarea></div>
      <div class="small muted">배경음악: ${r.bgm ? `${esc(r.bgm.track)} (${r.bgm.volumeDb}dB, 목소리 아래로 덕킹)` : '없음'} · 색보정: ${esc(r.colorGrade)} · 비율 ${esc(r.ratio)}</div>
      <button class="btn btn-primary" id="rj-save" style="margin-top:8px">저장</button></div>
  </div></div>`;
}

// ---------------- 내 목소리 TTS ----------------
export const voice = auth(async ({ view, state, navigate }) => {
  const [{ profiles, providers, freeVoices = [] }, renders] = await Promise.all([get('/api/voice/profiles'), get('/api/voice/renders')]);
  const engineLabel = providers.elevenlabs ? 'ElevenLabs (실제 음성 클론)' : providers.xtts ? '로컬 XTTS (실제 음성 클론)' : '시뮬레이션 (합성 계획만 생성 - ELEVENLABS_API_KEY 또는 로컬 XTTS 설정 시 실제 음성)';
  const freeEngine = providers.edge ? 'edge-tts (서버에서 MP3 생성)' : '브라우저 내장 음성 (무료 · 오프라인) — 서버에 edge-tts 를 설치하면 MP3 파일도 생성';
  const LANGS = [['ko', '한국어'], ['en', 'English'], ['ja', '日本語'], ['zh', '中文']];
  const voiceCard = (v) => `<div class="voice-card" data-voice="${esc(v.id)}"><div class="row row-between"><b>${esc(v.name)}</b><span class="badge badge-soft">${v.gender === 'female' ? '여성' : '남성'} · ${esc((v.lang || 'ko-KR').split('-')[0])}</span></div><div class="tiny muted">${esc(v.tone)}</div><div class="row"><button class="btn btn-sm btn-primary" data-listen="${esc(v.id)}">▶ 듣기</button><button class="btn btn-sm" data-read="${esc(v.id)}" title="아래 문장을 이 목소리로 읽기">문장 읽기</button></div></div>`;
  view.innerHTML = html`<h1>🎤 TTS 목소리 · 내 목소리</h1><p class="muted">무료 기본 목소리 ${freeVoices.length}종을 바로 들어보고, 아무 말이나 녹음한 내 목소리 샘플을 올려 음성 프로필을 만들면 저장되어 쇼츠 AI 후킹 보이스와 AI 재구성 내레이션에 계속 쓸 수 있습니다.</p>
    <div class="card"><div class="row row-between" style="flex-wrap:wrap"><h3>무료 TTS 목소리 (${freeVoices.length}종)</h3><div class="chips" id="v-filters"><span class="chip active" data-lang="">전체</span>${raw(LANGS.map(([c, l]) => `<span class="chip" data-lang="${c}">${esc(l)} ${freeVoices.filter((v) => (v.lang || 'ko-KR').startsWith(c)).length}</span>`).join(''))}<span class="chip" data-gender="female">여성</span><span class="chip" data-gender="male">남성</span></div></div>
      <div class="tiny muted" style="margin-bottom:8px">엔진: ${freeEngine}. ▶ 듣기는 각 목소리의 샘플 문장을, "문장 읽기"는 아래 입력한 문장을 읽어줍니다.</div>
      <div class="voice-grid" id="v-free">${raw(freeVoices.map(voiceCard).join(''))}</div></div>
    <div class="split" style="margin-top:16px"><div class="col"><div class="card"><h3>내 목소리 프로필 만들기</h3>
      <div class="field"><label>이름</label><input id="v-name" placeholder="예: 내 목소리 (밝게)" /></div>
      <div class="field"><label>목소리 샘플 — 오디오(MP3/WAV/M4A) 또는 영상(MP4/MOV/WebM) 파일</label><input type="file" id="v-file" accept="audio/*,video/*,.mp4,.mov,.m4a,.mp3,.wav,.webm" /><div id="v-file-meta" class="tiny muted"></div><div class="tiny muted">영상을 올려도 브라우저에서 목소리만 뽑아(앞 60초, 약 2MB) 올리므로 큰 MP4 도 몇 초면 업로드됩니다.</div></div>
      <div class="desktop-only"><button class="btn btn-sm" id="v-pick-local">컴퓨터에서 선택 (프로그램 전용)</button><span id="v-local-path" class="tiny muted"></span></div>
      <div class="field"><label>언어</label><select id="v-lang"><option value="ko">한국어</option><option value="en">English</option><option value="ja">日本語</option></select></div>
      <label class="check"><input type="checkbox" id="v-consent"/> <span>이 목소리는 제 목소리이거나 사용 허가를 받은 목소리입니다.</span></label>
      <button class="btn btn-primary btn-block" id="v-create" style="margin-top:10px">프로필 만들고 저장</button>
      <div class="tiny muted" style="margin-top:8px">음성 클론 엔진: ${engineLabel}. 프로필과 샘플은 계정에 저장되어 다음에 접속해도 그대로 남아 있습니다.</div></div>
      <div class="card"><h3>읽어보기</h3><div class="field"><label>목소리</label><select id="v-profile"><optgroup label="내 목소리">${raw(profiles.map((p) => `<option value="profile:${p.id}">🎤 ${esc(p.name)}</option>`).join('') || '<option disabled>아직 프로필이 없습니다</option>')}</optgroup><optgroup label="무료 목소리">${raw(freeVoices.map((v) => `<option value="free:${v.id}">🔊 ${esc(v.name)} — ${esc(v.tone)}</option>`).join(''))}</optgroup></select></div><div class="field"><textarea id="v-text" rows="3" placeholder="읽을 문장을 입력하세요. 예) 아직도 모르셨나요? 오늘 이 영상 하나로 정리해 드릴게요.">아직도 모르셨나요? 오늘 이 영상 하나로 정리해 드릴게요.</textarea></div><div class="row"><select id="v-style" style="width:auto"><option value="natural">자연스럽게</option><option value="hook">후킹 (빠르고 강하게)</option><option value="calm">차분한 내레이션</option><option value="energetic">에너지 넘치게</option></select><button class="btn btn-primary" id="v-speak">▶ 합성해서 듣기</button><button class="btn" id="v-stop">■ 정지</button></div><div id="v-out" style="margin-top:8px"></div></div></div>
    <div class="col"><div class="card"><h3>내 프로필 (${profiles.length})</h3>${raw(profiles.length ? profiles.map((p) => `<div style="padding:8px 0;border-bottom:1px solid var(--border)"><div class="row row-between"><div><b>${esc(p.name)}</b> <span class="badge badge-soft">${esc(p.engine)}</span> <span class="badge badge-success">저장됨</span><div class="tiny muted">${esc(p.sampleFilename)} · ${p.sampleDurationSec}초 · 품질 ${esc(p.quality)} · ${fmtDate(p.createdAt)}${p.sampleUrl ? ' · 클라우드 보관' : ''}</div><div class="tiny muted">${esc(p.characteristics?.recommendation || '')}</div></div></div><div class="row" style="margin-top:6px;flex-wrap:wrap"><button class="btn btn-sm btn-primary" data-sample="${p.id}">▶ 샘플 듣기</button><button class="btn btn-sm" data-read-profile="${p.id}">내 목소리로 문장 읽기</button><button class="btn btn-sm" data-rename="${p.id}">이름</button><button class="btn btn-sm btn-danger" data-del="${p.id}">삭제</button></div></div>`).join('') : '<p class="muted">아직 프로필이 없습니다. 왼쪽에서 샘플을 올려 만들면 여기에 저장됩니다.</p>')}</div>
      <div class="card"><h3>최근 합성</h3>${raw(renders.length ? renders.slice(0, 10).map((r) => `<div class="small" style="padding:6px 0;border-bottom:1px dashed var(--border)"><button class="btn btn-sm" data-play-render="${r.id}">▶</button> ${esc(r.text.slice(0, 60))} <span class="tiny muted">${esc(r.voiceName ? `${r.voiceName} · ` : '')}${esc(r.engine)} · ${r.durationSec}초</span></div>`).join('') : '<p class="muted">없음</p>')}</div>
      <div class="card small muted"><b>어디에 쓰이나요?</b><br/>· 쇼츠 스튜디오 → "AI 후킹 보이스" 목소리 선택 (무료 목소리 또는 내 목소리)<br/>· AI 재구성 → 내레이션 목소리 선택<br/>· 여기서 바로 문장을 읽혀 확인</div></div></div>`;
  let uploadId = null; let localPath = null;
  const readText = () => qs('#v-text').value.trim() || '안녕하세요, 알파맨입니다.';
  qsa('#v-filters .chip').forEach((c) => { c.onclick = () => { qsa('#v-filters .chip').forEach((x) => x.classList.remove('active')); c.classList.add('active'); const lang = c.dataset.lang; const gender = c.dataset.gender; qsa('#v-free .voice-card').forEach((card) => { const v = freeVoices.find((x) => x.id === card.dataset.voice); const ok = (lang === undefined || lang === '' || (v.lang || 'ko-KR').startsWith(lang)) && (!gender || v.gender === gender); card.classList.toggle('hidden', !ok); }); }; });
  on(view, 'click', '[data-listen]', (e, t) => { qsa('.voice-card').forEach((c) => c.classList.toggle('active', c.dataset.voice === t.dataset.listen)); listenFreeVoice(t.dataset.listen, freeVoices); });
  on(view, 'click', '[data-read]', (e, t) => listenFreeVoice(t.dataset.read, freeVoices, readText()));
  on(view, 'click', '[data-sample]', (e, t) => playProfileSample(t.dataset.sample));
  on(view, 'click', '[data-read-profile]', async (e, t) => { try { const r = await post('/api/voice/synthesize', { profileId: t.dataset.readProfile, text: readText(), style: qs('#v-style').value }); playRender(r); } catch (err) { toast(err.message, 'error'); } });
  on(view, 'click', '[data-play-render]', (e, t) => { const r = renders.find((x) => x.id === t.dataset.playRender); if (r) playRender(r); });
  qs('#v-stop').onclick = () => stopAll();
  qs('#v-file').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const meta = qs('#v-file-meta'); uploadId = null;
    try {
      let toUpload = f; let info = '';
      try {
        const ex = await extractVoiceSample(f, { maxSec: 60, onStatus: (t) => { meta.textContent = t; } });
        toUpload = ex.file; info = ` · 원본 ${Math.round(f.size / 1024 / 1024 * 10) / 10}MB → 음성만 ${Math.round(ex.file.size / 1024)}KB (${ex.durationSec}초${ex.skippedSec ? `, 앞 무음 ${ex.skippedSec}초 제외` : ''})`;
      } catch (exErr) {
        if (f.size > 4 * 1024 * 1024) throw new Error(`브라우저에서 음성을 추출하지 못했습니다 (${exErr.message}). 파일이 커서 그대로 올릴 수 없으니 MP3/WAV 로 변환해 올려주세요.`);
        info = ' · 원본 그대로 업로드';
      }
      meta.textContent = `${f.name} 업로드 중...${info}`;
      const up = await uploadFile(toUpload, (p) => { meta.textContent = `${f.name} 업로드 ${p}%${info}`; });
      uploadId = up.id; meta.textContent = `${f.name} 업로드 완료${info}`;
    } catch (err) { meta.textContent = ''; toast(err.message, 'error', 7000); }
  };
  if (window.alphaman?.pickVideo) qs('#v-pick-local').onclick = async () => { const p = await window.alphaman.pickVideo(); if (p) { localPath = p; qs('#v-local-path').textContent = p; } };
  qs('#v-create').onclick = async (e) => {
    if (!uploadId && !localPath) return toast('목소리 샘플 파일을 올려주세요.', 'error');
    e.target.disabled = true; e.target.textContent = '저장 중...';
    try {
      const p = await post('/api/voice/profiles', { uploadId, localPath, name: qs('#v-name').value, language: qs('#v-lang').value, consent: qs('#v-consent').checked });
      // 저장 확인: 목록에 나타날 때까지 잠시 기다린다 (서버 인스턴스 동기화)
      for (let i = 0; i < 6; i++) { const { profiles: now } = await get('/api/voice/profiles'); if (now.some((x) => x.id === p.id)) break; await new Promise((r) => setTimeout(r, 700)); }
      toast(`음성 프로필 "${p.name}" 을 저장했습니다. 샘플 듣기로 확인해보세요.`, 'info', 5000); navigate(`/voice?r=${Date.now()}`);
    }
    catch (err) { toast(err.message, 'error', 6000); e.target.disabled = false; e.target.textContent = '프로필 만들고 저장'; }
  };
  qs('#v-speak').onclick = async () => {
    const sel = qs('#v-profile').value || '';
    if (!sel) return toast('목소리를 선택해주세요.', 'error');
    try {
      const body = { text: readText(), style: qs('#v-style').value, ...(sel.startsWith('profile:') ? { profileId: sel.slice(8) } : { voiceId: sel.slice(5) }) };
      const r = await post('/api/voice/synthesize', body);
      qs('#v-out').innerHTML = r.audioPath ? `<audio controls autoplay src="${downloadUrl(`/api/voice/renders/${r.id}/audio`)}" style="width:100%"></audio>` : `<div class="badge ${r.engine === 'browser' ? 'badge-success' : 'badge-warn'}">${r.engine === 'browser' ? '브라우저 음성으로 재생 중' : `합성 계획 생성 (${esc(r.engine)})`} · 예상 ${r.durationSec}초</div><div class="tiny muted">${esc(r.plan?.note || '')}</div>`;
      if (!r.audioPath) playRender(r);
    } catch (err) { toast(err.message, 'error'); }
  };
  on(view, 'click', '[data-del]', async (e, t) => { if (await confirmDialog('프로필을 삭제할까요?')) { await del(`/api/voice/profiles/${t.dataset.del}`); navigate(`/voice?r=${Date.now()}`); } });
  on(view, 'click', '[data-rename]', async (e, t) => { const name = prompt('새 이름'); if (name) { await patch(`/api/voice/profiles/${t.dataset.rename}`, { name }); navigate(`/voice?r=${Date.now()}`); } });
});

