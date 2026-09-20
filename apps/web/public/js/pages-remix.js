// AI 재구성(리믹스) + 내 목소리 TTS 페이지
import { get, post, patch, del, uploadFile, downloadUrl, getToken } from './api.js';
import { esc, html, raw, toast, modal, confirmDialog, fmtTime, fmtDate, creditsLabel, readVideoMeta, qs, qsa, on } from './ui.js';

const auth = (fn) => Object.assign(fn, { requiresAuth: true });
const statusBadge = (s) => `<span class="badge ${s === 'done' ? 'badge-success' : s === 'failed' ? 'badge-danger' : 'badge-warn'}">${{ done: '완료', failed: '실패', queued: '대기', processing: '진행 중' }[s] || esc(s)}</span>`;
function saveBlob(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }

export const remix = auth(async ({ view, state, navigate }) => {
  const [defs, jobs, { profiles }] = await Promise.all([get('/api/remix/defaults'), get('/api/remix/jobs'), get('/api/voice/profiles')]);
  view.innerHTML = html`<div class="row row-between"><h1>🪄 AI 재구성</h1><span class="badge">보유 이용권 ${creditsLabel(state.user)}</span></div>
    <p class="muted">영상 링크 또는 파일 하나만 넣으면 원본의 자막·효과음·배경음을 걷어내고 ${defs.limits.minMinutes}~${defs.limits.maxMinutes}분으로 길이를 맞춘 뒤, AI 가 새 자막·효과음·배경음·내레이션을 입혀 다시 구성합니다. 참고 유튜브 영상을 넣으면 그 영상의 구성과 호흡, 자막 스타일을 따라 재구성합니다.</p>
    <div class="split"><div class="card">
      <h3>1. 원본 영상 (링크 또는 파일 중 하나)</h3>
      <div class="tabs" id="r-tabs"><button class="tab active" data-tab="youtube">유튜브 링크</button><button class="tab" data-tab="file">파일 업로드</button><button class="tab desktop-only" data-tab="local">컴퓨터/USB 영상</button></div>
      <div id="r-youtube"><div class="field"><input id="r-url" placeholder="https://www.youtube.com/watch?v=..." /></div><div class="field"><label>예상 길이(분) - 메타데이터를 가져오지 못할 때 사용</label><input id="r-est" type="number" min="1" value="10" /></div></div>
      <div id="r-file" class="hidden"><div class="dropzone" id="r-drop">MP4, MOV, WebM 파일을 끌어다 놓거나 클릭 <input type="file" id="r-file-input" accept="video/*" class="hidden" /></div><div id="r-file-meta" class="small muted" style="margin-top:8px"></div><div class="progress" style="margin-top:8px"><div id="r-upload-bar" style="width:0"></div></div></div>
      <div id="r-local" class="hidden"><button class="btn" id="r-pick-local">파일 선택 (프로그램 전용)</button><div id="r-local-path" class="small muted"></div></div>

      <h3 style="margin-top:20px">2. 참고 영상 (선택) — 이 영상처럼 재구성</h3>
      <div class="field"><input id="r-ref" placeholder="예시 유튜브 링크: https://www.youtube.com/watch?v=..." /><div class="tiny muted">참고 영상의 호흡(컷 길이), 자막 스타일, 구조(후킹→본문→마무리), 톤, 효과음 밀도, 전환, 색감을 분석해 적용합니다.</div></div>

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
      </div>
      <div class="grid grid-3" style="margin-top:12px">
        <div class="field"><label>자막 템플릿</label><select id="r-template"><option value="auto">자동 (참고 영상/장르)</option>${raw(defs.templates.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join(''))}</select></div>
        <div class="field"><label>호흡</label><select id="r-pacing"><option value="auto">자동 (참고 영상)</option><option value="slow">느리게</option><option value="normal">보통</option><option value="fast">빠르게</option></select></div>
        <div class="field"><label>비율</label><select id="r-ratio"><option>16:9</option><option>9:16</option><option>1:1</option></select></div>
        <div class="field"><label>전환</label><select id="r-trans"><option value="auto">자동</option><option value="hard-cut">하드컷</option><option value="crossfade">크로스페이드</option><option value="zoom">줌</option></select></div>
        <div class="field"><label>색보정</label><select id="r-color"><option value="auto">자동</option><option value="clean-bright">밝고 깨끗하게</option><option value="cinematic">시네마틱</option><option value="warm">따뜻하게</option><option value="none">없음</option></select></div>
        <div class="field"><label>언어</label><select id="r-lang"><option value="ko">한국어</option><option value="en">English</option><option value="ja">日本語</option></select></div>
      </div>

      <h3 style="margin-top:20px">4. 내 목소리 내레이션 (선택)</h3>
      <div class="grid grid-2"><div class="field"><label>내레이션</label><select id="r-narr"><option value="none">없음</option><option value="intro">오프닝·마무리만</option><option value="full">전체 내레이션 (섹션마다)</option></select></div>
        <div class="field"><label>음성 프로필</label><select id="r-voice"><option value="">선택 안 함</option>${raw(profiles.map((p) => `<option value="${p.id}">${esc(p.name)} (${p.sampleDurationSec}초 샘플 · ${esc(p.engine)})</option>`).join(''))}</select><div class="tiny muted">프로필이 없으면 <a href="#/voice">내 목소리 TTS</a>에서 목소리 샘플을 올려 만드세요.</div></div></div>

      <label class="check" style="margin-top:8px"><input type="checkbox" id="r-rights"/> <span>이 영상은 내가 직접 제작했거나 사용 허가를 받은 영상입니다. (타인의 영상을 무단으로 재구성하는 용도로는 사용할 수 없습니다)</span></label>
      <button class="btn btn-primary btn-lg btn-block" id="r-go" style="margin-top:12px">AI 재구성 시작</button>
    </div>
    <div class="col"><div class="card"><h3>내 재구성 작업</h3>${raw(jobs.length ? jobs.map((j) => `<div class="row row-between" style="padding:8px 0;border-bottom:1px solid var(--border)"><div><a href="#/remix/${j.id}"><b>${esc(j.source.title)}</b></a><div class="tiny muted">${fmtDate(j.createdAt)} · ${fmtTime(j.source.durationSec)} → ${j.options.targetMinutes}분${j.reference ? ' · 참고 영상' : ''}${j.options.narration !== 'none' ? ' · 내레이션' : ''}</div></div>${statusBadge(j.status)}</div>`).join('') : '<p class="muted">아직 작업이 없습니다.</p>')}</div>
      <div class="card small muted"><b>어떻게 동작하나요?</b><ol style="padding-left:18px;margin:6px 0"><li>원본 가져오기 → 참고 영상 스타일 분석</li><li>음성 인식으로 대본 추출</li><li>박힌 자막·효과음·배경음 제거 (음원 분리)</li><li>AI 가 목표 길이에 맞게 구간 선별·재배열</li><li>새 자막·효과음·배경음·전환·내레이션 입히기</li><li>렌더링 (ffmpeg 설치 시 실제 MP4)</li></ol>원본 길이만큼 이용권이 차감되고, 다시 만들기는 절반입니다.</div></div></div>`;

  let mode = 'youtube'; let uploadId = null; let localPath = null;
  qsa('#r-tabs .tab').forEach((t) => { t.onclick = () => { mode = t.dataset.tab; qsa('#r-tabs .tab').forEach((x) => x.classList.remove('active')); t.classList.add('active'); ['youtube', 'file', 'local'].forEach((m) => qs(`#r-${m}`).classList.toggle('hidden', m !== mode)); }; });
  qs('#r-len').oninput = (e) => { qs('#r-len-label').textContent = `${e.target.value}분`; };
  const drop = qs('#r-drop'); const input = qs('#r-file-input');
  drop.onclick = () => input.click(); drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); }; drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); e.dataTransfer.files[0] && pick(e.dataTransfer.files[0]); };
  input.onchange = () => input.files[0] && pick(input.files[0]);
  async function pick(file) {
    try { const meta = await readVideoMeta(file); qs('#r-file-meta').textContent = `${file.name} · ${fmtTime(meta.durationSec)} · 업로드 중...`; const up = await uploadFile(file, (p) => { qs('#r-upload-bar').style.width = `${p}%`; }); uploadId = up.id; qs('#r-file-meta').textContent = `${file.name} · ${fmtTime(meta.durationSec)} · 업로드 완료 · 필요 이용권 ${(meta.durationSec / 60).toFixed(1)}분`; }
    catch (err) { uploadId = null; toast(err.message, 'error', 6000); }
  }
  if (window.alphaman?.pickVideo) qs('#r-pick-local').onclick = async () => { const p = await window.alphaman.pickVideo(); if (p) { localPath = p; qs('#r-local-path').textContent = p; } };
  qs('#r-go').onclick = async (e) => {
    const options = { targetMinutes: Number(qs('#r-len').value), template: qs('#r-template').value, pacing: qs('#r-pacing').value, ratio: qs('#r-ratio').value, transitions: qs('#r-trans').value, colorGrade: qs('#r-color').value, language: qs('#r-lang').value, narration: qs('#r-narr').value, voiceProfileId: qs('#r-voice').value || null };
    qsa('[data-opt]').forEach((c) => { options[c.dataset.opt] = c.checked; });
    const body = { options, referenceUrl: qs('#r-ref').value.trim() || null, rightsConfirmed: qs('#r-rights').checked };
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
      <div class="row"><button class="btn" id="rj-regen" ${job.status === 'done' || job.status === 'failed' ? '' : 'disabled'}>다시 만들기 (${(job.minutesCharged / 2).toFixed(1)}분)</button><button class="btn btn-danger" id="rj-del">삭제</button></div></div>
      ${job.status !== 'done' ? raw(`<div class="card"><div class="row row-between"><b>${esc(stepNames[job.step] || job.step)}</b><span>${job.progress}%</span></div><div class="progress"><div style="width:${job.progress}%"></div></div><div class="log" style="margin-top:10px">${job.log.map((l) => `${esc(l.at.slice(11, 19))} [${esc(l.step)}] ${esc(l.message)}`).join('\n')}</div>${job.error ? `<p class="badge badge-danger">${esc(job.error)}</p>` : ''}</div>`) : raw(renderResult(job))}`;
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
  return `<div class="card"><div class="chips"><span class="chip">${esc(r.summary)}</span><span class="chip">장르 ${esc(r.genre)}</span><span class="chip">호흡 ${esc(r.plan.pacing)}</span><span class="chip">템플릿 ${esc(r.template.name)}</span><span class="chip">STT ${esc(r.transcriptEngine)}</span><span class="chip">계획 ${esc(r.plan.engine)}</span></div>
    <div class="row" style="margin-top:10px"><button class="btn btn-primary" data-export="mp4">MP4 내보내기</button><button class="btn" data-export="ass">자막(ASS)</button><button class="btn" data-export="json">편집 데이터(JSON)</button></div></div>
  <div class="split" style="margin-top:16px"><div class="col">
    <div class="card"><h3>구성</h3><div class="small"><b>후킹:</b> ${esc(r.plan.hook)}</div><div class="small muted">${esc(r.plan.description)}</div><ol class="small">${r.plan.outline.map((o) => `<li>${esc(o)}</li>`).join('')}</ol>
      <div class="tiny muted">원본 타임라인 (유지 구간)</div><div class="timeline">${r.plan.keep.map((k) => `<div class="seg" style="left:${(k.start / D) * 100}%;width:${Math.max(0.3, ((k.end - k.start) / D) * 100)}%" title="${esc(k.reason)}"></div>`).join('')}</div>
      <div class="tiny muted" style="margin-top:8px">새 타임라인 · 전환 ${r.transitions.length}개 · 효과음 ${r.sfx.length}개</div><div class="timeline">${r.timeline.map((t, i) => `<div class="seg" style="left:${(t.newStart / F) * 100}%;width:${Math.max(0.3, ((t.newEnd - t.newStart) / F) * 100)}%;opacity:${0.5 + (i % 2) * 0.3}"></div>`).join('')}${r.sfx.map((s) => `<div class="cut" style="left:${(s.at / F) * 100}%;width:0.4%" title="${esc(s.name)}"></div>`).join('')}</div></div>
    <div class="card"><h3>원본 정리</h3>${r.cleaning.steps.map((s) => `<div class="small">• ${esc(s.id)} <span class="muted">(${esc(s.method)}) ${esc(s.note || '')}</span></div>`).join('')}</div>
    ${sp ? `<div class="card"><h3>참고 영상 스타일 프로필</h3><div class="chips"><span class="chip">호흡 ${esc(sp.pacing)} (${sp.avgShotSec}초/컷)</span><span class="chip">자막 ${esc(sp.subtitleStyle)}</span><span class="chip">톤 ${esc(sp.tone)}</span><span class="chip">효과음 ${esc(sp.sfxDensity)}</span><span class="chip">BGM ${esc(sp.bgm)}</span><span class="chip">전환 ${esc(sp.transitions)}</span><span class="chip">색감 ${esc(sp.colorGrade)}</span></div><ol class="small">${(sp.structure || []).map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div>` : ''}
    ${r.narration ? `<div class="card"><h3>내레이션 (${r.narration.mode === 'full' ? '전체' : '오프닝·마무리'} · 내 목소리)</h3>${r.narration.lines.map((l) => `<div class="small" style="padding:4px 0;border-bottom:1px dashed var(--border)"><span class="kbd">${fmtTime(l.at)}</span> ${esc(l.text)} <span class="tiny muted">${esc(l.engine)}${l.audioPath ? ' · 음성 생성됨' : ' · 합성 계획'}</span></div>`).join('')}</div>` : ''}
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
  const [{ profiles, providers }, renders] = await Promise.all([get('/api/voice/profiles'), get('/api/voice/renders')]);
  const engineLabel = providers.elevenlabs ? 'ElevenLabs (실제 음성 클론)' : providers.xtts ? '로컬 XTTS (실제 음성 클론)' : '시뮬레이션 (합성 계획만 생성 - ELEVENLABS_API_KEY 또는 로컬 XTTS 설정 시 실제 음성)';
  view.innerHTML = html`<h1>🎤 내 목소리 TTS</h1><p class="muted">아무 말이나 녹음한 목소리 파일(10~60초 권장)을 올리면 음성 프로필이 만들어지고, 쇼츠 AI 후킹 보이스와 AI 재구성 내레이션을 내 목소리로 읽어줍니다.</p>
    <div class="split"><div class="col"><div class="card"><h3>음성 프로필 만들기</h3>
      <div class="field"><label>이름</label><input id="v-name" placeholder="예: 내 목소리 (밝게)" /></div>
      <div class="field"><label>목소리 샘플 (MP3/WAV/M4A 또는 영상)</label><input type="file" id="v-file" accept="audio/*,video/*" /><div id="v-file-meta" class="tiny muted"></div></div>
      <div class="desktop-only"><button class="btn btn-sm" id="v-pick-local">컴퓨터에서 선택 (프로그램 전용)</button><span id="v-local-path" class="tiny muted"></span></div>
      <div class="field"><label>언어</label><select id="v-lang"><option value="ko">한국어</option><option value="en">English</option><option value="ja">日本語</option></select></div>
      <label class="check"><input type="checkbox" id="v-consent"/> <span>이 목소리는 제 목소리이거나 사용 허가를 받은 목소리입니다.</span></label>
      <button class="btn btn-primary btn-block" id="v-create" style="margin-top:10px">프로필 만들기</button>
      <div class="tiny muted" style="margin-top:8px">엔진: ${engineLabel}</div></div>
      <div class="card"><h3>내 목소리로 읽어보기</h3><div class="field"><select id="v-profile">${raw(profiles.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('') || '<option value="">먼저 프로필을 만드세요</option>')}</select></div><div class="field"><textarea id="v-text" rows="3" placeholder="읽을 문장을 입력하세요. 예) 아직도 모르셨나요? 오늘 이 영상 하나로 정리해 드릴게요."></textarea></div><div class="row"><select id="v-style" style="width:auto"><option value="natural">자연스럽게</option><option value="hook">후킹 (빠르고 강하게)</option><option value="calm">차분한 내레이션</option><option value="energetic">에너지 넘치게</option></select><button class="btn btn-primary" id="v-speak">합성</button></div><div id="v-out" style="margin-top:8px"></div></div></div>
    <div class="col"><div class="card"><h3>내 프로필 (${profiles.length})</h3>${raw(profiles.length ? profiles.map((p) => `<div class="row row-between" style="padding:8px 0;border-bottom:1px solid var(--border)"><div><b>${esc(p.name)}</b> <span class="badge badge-soft">${esc(p.engine)}</span><div class="tiny muted">${esc(p.sampleFilename)} · ${p.sampleDurationSec}초 · 품질 ${esc(p.quality)} · ${fmtDate(p.createdAt)}</div><div class="tiny muted">${esc(p.characteristics?.recommendation || '')}</div></div><div class="row"><button class="btn btn-sm" data-rename="${p.id}">이름</button><button class="btn btn-sm btn-danger" data-del="${p.id}">삭제</button></div></div>`).join('') : '<p class="muted">아직 프로필이 없습니다.</p>')}</div>
      <div class="card"><h3>최근 합성</h3>${raw(renders.length ? renders.slice(0, 10).map((r) => `<div class="small" style="padding:6px 0;border-bottom:1px dashed var(--border)">${esc(r.text.slice(0, 60))} <span class="tiny muted">${esc(r.engine)} · ${r.durationSec}초</span> ${r.audioPath ? `<audio controls src="${downloadUrl(`/api/voice/renders/${r.id}/audio`)}" style="width:100%"></audio>` : ''}</div>`).join('') : '<p class="muted">없음</p>')}</div>
      <div class="card small muted"><b>어디에 쓰이나요?</b><br/>· 쇼츠 스튜디오 → "AI 후킹 보이스" 켜고 음성 프로필 선택<br/>· AI 재구성 → 내레이션(오프닝·마무리 / 전체)<br/>· 여기서 바로 문장을 읽혀 MP3 로 저장</div></div></div>`;
  let uploadId = null; let localPath = null;
  qs('#v-file').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { qs('#v-file-meta').textContent = `${f.name} 업로드 중...`; const up = await uploadFile(f); uploadId = up.id; qs('#v-file-meta').textContent = `${f.name} 업로드 완료 (${Math.round(f.size / 1024)}KB)`; } catch (err) { toast(err.message, 'error'); } };
  if (window.alphaman?.pickVideo) qs('#v-pick-local').onclick = async () => { const p = await window.alphaman.pickVideo(); if (p) { localPath = p; qs('#v-local-path').textContent = p; } };
  qs('#v-create').onclick = async (e) => {
    if (!uploadId && !localPath) return toast('목소리 샘플 파일을 올려주세요.', 'error');
    e.target.disabled = true;
    try { await post('/api/voice/profiles', { uploadId, localPath, name: qs('#v-name').value, language: qs('#v-lang').value, consent: qs('#v-consent').checked }); toast('음성 프로필이 만들어졌습니다.'); navigate(`/voice?r=${Date.now()}`); }
    catch (err) { toast(err.message, 'error', 6000); e.target.disabled = false; }
  };
  qs('#v-speak').onclick = async () => {
    try { const r = await post('/api/voice/synthesize', { profileId: qs('#v-profile').value, text: qs('#v-text').value, style: qs('#v-style').value }); qs('#v-out').innerHTML = r.audioPath ? `<audio controls autoplay src="${downloadUrl(`/api/voice/renders/${r.id}/audio`)}" style="width:100%"></audio>` : `<div class="badge badge-warn">합성 계획 생성 (${esc(r.engine)}) · 예상 ${r.durationSec}초</div><div class="tiny muted">${esc(r.plan?.note || '')}</div>`; }
    catch (err) { toast(err.message, 'error'); }
  };
  on(view, 'click', '[data-del]', async (e, t) => { if (await confirmDialog('프로필을 삭제할까요?')) { await del(`/api/voice/profiles/${t.dataset.del}`); navigate(`/voice?r=${Date.now()}`); } });
  on(view, 'click', '[data-rename]', async (e, t) => { const name = prompt('새 이름'); if (name) { await patch(`/api/voice/profiles/${t.dataset.rename}`, { name }); navigate(`/voice?r=${Date.now()}`); } });
});
