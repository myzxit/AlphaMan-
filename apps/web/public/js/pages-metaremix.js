// 썸네일·제목·태그 리믹스: 영상 링크(유튜브) 또는 영상/이미지 파일 → 원본 썸네일·제목·태그 → 원본과 거의 비슷한 새 썸네일(PNG/SVG 저장)·제목 후보·태그 (웹사이트 · 프로그램 공용)
import { get, post, put, del, downloadUrl, getToken } from './api.js';
import { esc, html, raw, toast, modal, confirmDialog, fmtDate, qs, qsa, on } from './ui.js';

const auth = (fn) => Object.assign(fn, { requiresAuth: true });
const FALLBACK_STYLES = [{ id: 'original-like', name: '원본과 비슷하게' }, { id: 'bold', name: '큰 텍스트' }, { id: 'big-number', name: '숫자 강조' }, { id: 'split', name: '컬러 밴드' }, { id: 'minimal', name: '미니멀' }];
const FALLBACK_PALETTES = { yellow: ['#ffd400'], red: ['#ff3b3b'], white: ['#ffffff'], mint: ['#2dd4bf'], blue: ['#3b82f6'] };
async function copy(text, label = '복사됨') { try { await navigator.clipboard.writeText(text); toast(`${label}: 클립보드에 복사했습니다.`); } catch { modal(`<p class="small muted">클립보드를 쓸 수 없어 직접 복사하세요.</p><textarea rows="4" style="width:100%" readonly>${esc(text)}</textarea>`, { title: '복사' }); } }
const authHeaders = () => ({ Authorization: `Bearer ${getToken()}` });

export const metaremix = auth(async ({ view, params, navigate, state }) => {
  const info = state.info && state.info.thumbStyles ? state.info : await get('/api/info').catch(() => ({}));
  const styles = info.thumbStyles || FALLBACK_STYLES; const palettes = info.thumbPalettes || FALLBACK_PALETTES; const fxDefaults = info.metaFxDefaults || { mirror: true, zoom: 1.06, tint: true, saturate: 1.15 };
  let list = await get('/api/metaremix');
  let cur = null;
  if (params.id) { try { cur = await get(`/api/metaremix/${params.id}`); } catch (err) { toast(err.message, 'error'); } }
  const src = { mode: 'link', file: null, frame: null, frameW: null, frameH: null, durationSec: null };

  view.innerHTML = html`<div class="row row-between"><div><h1>🎨 썸네일·제목·태그 리믹스</h1><p class="muted">영상 링크나 파일을 넣으면 원본 썸네일·제목·태그를 가져와, <b>원본과 거의 비슷하지만 새로 만든</b> 썸네일(PNG/SVG 저장)·제목 후보·태그를 만들어 줍니다. 이용권은 차감되지 않습니다.</p></div></div>
    <div class="card">
      <div class="row mr-tabs" style="gap:8px;flex-wrap:wrap"><button class="btn btn-sm active" data-mode="link" id="mr-tab-link">🔗 영상 링크</button><button class="btn btn-sm" data-mode="file" id="mr-tab-file">📁 영상·이미지 파일</button></div>
      <div id="mr-pane-link" style="margin-top:10px"><div class="field"><label>유튜브 링크 (일반 영상 · 쇼츠)</label><input id="mr-url" placeholder="https://www.youtube.com/watch?v=... 또는 https://youtube.com/shorts/..." /></div><div class="tiny muted">원본 썸네일(최고 화질)·제목·태그·설명을 자동으로 가져옵니다. 쇼츠 링크는 세로(1080×1920) 썸네일로 만듭니다.</div></div>
      <div id="mr-pane-file" class="hidden" style="margin-top:10px">
        <div class="field"><label>영상 파일 또는 썸네일 이미지</label><input type="file" id="mr-file" accept="video/*,image/*" /></div>
        <div id="mr-file-preview" class="hidden"><video id="mr-video" muted playsinline style="width:100%;max-height:320px;background:#000;border-radius:8px"></video>
          <div class="row" style="gap:8px;margin-top:6px;align-items:center"><input type="range" id="mr-seek" min="0" max="100" step="0.1" value="0" style="flex:1" /><span class="tiny muted" id="mr-time">0:00</span><button class="btn btn-sm btn-primary" id="mr-grab">📸 이 장면을 원본 썸네일로</button></div>
          <div class="tiny muted">파일은 서버로 올라가지 않고, 고른 장면 한 장만 전송됩니다 (용량 제한 없음).</div></div>
        <div id="mr-frame-wrap" class="hidden" style="margin-top:8px"><img id="mr-frame" alt="원본 썸네일로 쓸 장면" style="max-width:320px;border-radius:8px;border:1px solid var(--border)" /></div>
        <div class="grid grid-2" style="margin-top:8px"><div class="field"><label>원본 제목 (파일명에서 자동)</label><input id="mr-title" placeholder="예: 서울 카페 투어 브이로그" maxlength="120" /></div><div class="field"><label>원본 태그 (쉼표로 구분, 선택)</label><input id="mr-tags" placeholder="카페, 서울, 브이로그" /></div></div>
        <div class="field"><label>원본 설명 (선택)</label><textarea id="mr-desc" rows="2" placeholder="영상 설명이 있으면 붙여넣으세요. 태그·문구 생성에 참고합니다."></textarea></div>
      </div>
      <details style="margin-top:10px"><summary class="small">썸네일 옵션 (스타일 · 색 · 효과 · 언어)</summary>
        <div class="grid grid-3" style="margin-top:8px"><div class="field"><label>스타일</label><select id="mr-style">${raw(styles.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join(''))}</select></div>
          <div class="field"><label>포인트 색</label><select id="mr-palette"><option value="auto">자동 (원본 사진에서 추출)</option>${raw(Object.entries(palettes).map(([k, v]) => `<option value="${esc(k)}">${esc(k)} (${esc(v[0])})</option>`).join(''))}</select></div>
          <div class="field"><label>언어</label><select id="mr-lang"><option value="">자동</option><option value="ko">한국어</option><option value="en">English</option><option value="ja">日本語</option></select></div></div>
        <div class="row" style="gap:14px;flex-wrap:wrap"><label class="small"><input type="checkbox" id="mr-fx-mirror" ${fxDefaults.mirror ? 'checked' : ''} /> 좌우 반전</label><label class="small"><input type="checkbox" id="mr-fx-zoom" ${fxDefaults.zoom > 1 ? 'checked' : ''} /> 살짝 확대</label><label class="small"><input type="checkbox" id="mr-fx-tint" ${fxDefaults.tint ? 'checked' : ''} /> 포인트 색 톤</label><span class="tiny muted">원본 사진을 "새 사진처럼" 보이게 하는 효과</span></div></details>
      <div class="row" style="margin-top:12px"><button class="btn btn-primary" id="mr-go">✨ 새로 만들기</button><span class="tiny muted" id="mr-status"></span></div>
    </div>
    <div id="mr-result"></div>
    <div class="card"><div class="row row-between"><b>최근 리믹스</b><span class="tiny muted">${list.length}개</span></div><div id="mr-history" class="grid grid-4" style="margin-top:8px"></div></div>`;

  // ---- 입력 모드 전환 · 파일 미리보기 · 장면 캡처 ----
  const setMode = (m) => { src.mode = m; qs('#mr-pane-link').classList.toggle('hidden', m !== 'link'); qs('#mr-pane-file').classList.toggle('hidden', m !== 'file'); qsa('[data-mode]', view).forEach((b) => b.classList.toggle('active', b.dataset.mode === m)); };
  on(view, 'click', '[data-mode]', (e, t) => setMode(t.dataset.mode));
  const video = qs('#mr-video'); const seek = qs('#mr-seek');
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  qs('#mr-file').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    src.file = f; src.frame = null; qs('#mr-frame-wrap').classList.add('hidden');
    if (!qs('#mr-title').value) qs('#mr-title').value = f.name.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_-]+/g, ' ');
    if (f.type.startsWith('image/')) {
      qs('#mr-file-preview').classList.add('hidden');
      try { const d = await fileToDataUrl(f, 1280); src.frame = d.dataUrl; src.frameW = d.width; src.frameH = d.height; qs('#mr-frame').src = d.dataUrl; qs('#mr-frame-wrap').classList.remove('hidden'); } catch (err) { toast(`이미지를 읽지 못했습니다: ${err.message}`, 'error'); }
      return;
    }
    qs('#mr-file-preview').classList.remove('hidden');
    if (video.src) URL.revokeObjectURL(video.src);
    video.src = URL.createObjectURL(f);
    video.onloadedmetadata = () => { src.durationSec = video.duration; seek.max = String(Math.max(0.1, video.duration - 0.05)); video.currentTime = Math.min(1, video.duration / 2); };
    video.ontimeupdate = () => { seek.value = String(video.currentTime); qs('#mr-time').textContent = fmt(video.currentTime); };
    video.onerror = () => toast('이 브라우저에서 재생할 수 없는 영상입니다. 썸네일 이미지를 직접 올려주세요.', 'error', 6000);
  };
  seek.oninput = () => { video.currentTime = Number(seek.value); qs('#mr-time').textContent = fmt(Number(seek.value)); };
  qs('#mr-grab').onclick = () => {
    if (!video.videoWidth) return toast('영상이 아직 준비되지 않았습니다.', 'error');
    const scale = Math.min(1, 1280 / video.videoWidth);
    const c = document.createElement('canvas'); c.width = Math.round(video.videoWidth * scale); c.height = Math.round(video.videoHeight * scale);
    c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
    src.frame = c.toDataURL('image/jpeg', 0.86); src.frameW = c.width; src.frameH = c.height;
    qs('#mr-frame').src = src.frame; qs('#mr-frame-wrap').classList.remove('hidden'); toast(`${fmt(video.currentTime)} 장면을 원본 썸네일로 쓰겠습니다.`);
  };

  // ---- 생성 ----
  const options = () => ({ style: qs('#mr-style').value, palette: qs('#mr-palette').value === 'auto' ? undefined : qs('#mr-palette').value, language: qs('#mr-lang').value || undefined, fx: { mirror: qs('#mr-fx-mirror').checked, zoom: qs('#mr-fx-zoom').checked ? fxDefaults.zoom || 1.06 : 1, tint: qs('#mr-fx-tint').checked, saturate: fxDefaults.saturate || 1.15 } });
  qs('#mr-go').onclick = async (e) => {
    const btn = e.currentTarget; const status = qs('#mr-status');
    let body;
    if (src.mode === 'link') { const url = qs('#mr-url').value.trim(); if (!url) return toast('유튜브 링크를 입력해주세요.', 'error'); body = { url, options: options() }; }
    else {
      const title = qs('#mr-title').value.trim();
      if (!src.file && !title) return toast('영상·이미지 파일을 고르거나 제목을 입력해주세요.', 'error');
      if (src.file && !src.frame && !src.file.type.startsWith('image/')) return toast('📸 버튼으로 원본 썸네일로 쓸 장면을 먼저 골라주세요.', 'error', 5000);
      body = { filename: src.file?.name || '', title, tags: qs('#mr-tags').value, description: qs('#mr-desc').value, frameDataUrl: src.frame || null, width: src.frameW, height: src.frameH, durationSec: src.durationSec, options: options() };
    }
    btn.disabled = true; status.textContent = src.mode === 'link' ? '원본 썸네일·제목·태그를 가져와 새로 만드는 중...' : '새로 만드는 중...';
    try {
      cur = await post('/api/metaremix', body);
      if (qs('#mr-palette').value === 'auto') { const p = await detectPalette(cur, palettes).catch(() => null); if (p && p !== cur.thumb.palette) { try { cur = await put(`/api/metaremix/${cur.id}`, { palette: p }); } catch { /* 색 자동 선택 실패는 무시 */ } } }
      list = await get('/api/metaremix'); drawHistory(); drawResult(); toast(`새 썸네일·제목·태그를 만들었습니다 (${cur.result.engine === 'rules' ? '규칙 기반' : 'AI'}).`);
      history.replaceState(null, '', `#/metaremix/${cur.id}`);
      qs('#mr-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) { toast(err.message, 'error', 7000); }
    finally { btn.disabled = false; status.textContent = ''; }
  };

  // ---- 결과 ----
  const svgUrl = (r, dl = false) => downloadUrl(`/api/metaremix/${r.id}/image.svg?v=${encodeURIComponent(r.thumb.updatedAt)}${dl ? '&download=1' : ''}`);
  const origUrl = (r) => downloadUrl(`/api/metaremix/${r.id}/original?v=${encodeURIComponent(r.updatedAt || '')}`);
  function drawResult() {
    const host = qs('#mr-result');
    if (!cur) { host.innerHTML = ''; return; }
    const r = cur; const res = r.result || { titles: [], tags: [], hashtags: [], thumbnail: [], description: '' }; const sel = r.selected || {};
    const fx = r.thumb.fx || {};
    host.innerHTML = html`<div class="card">
      <div class="row row-between" style="flex-wrap:wrap"><div><b>결과</b> <span class="tiny muted">${r.source.type === 'youtube' ? `유튜브 ${r.source.videoId}` : `파일 ${r.source.filename || ''}`} · 엔진 ${res.engine === 'rules' ? '규칙 기반' : 'AI'} · ${fmtDate(r.updatedAt)}</span></div>
        <div class="row" style="gap:6px"><button class="btn btn-sm" id="mr-regen">🔁 다시 생성</button><button class="btn btn-sm btn-danger" id="mr-del">삭제</button></div></div>
      <div class="grid grid-2" style="margin-top:10px">
        <div><div class="tiny muted" style="margin-bottom:4px">원본</div>
          <div class="thumb-preview">${raw(r.image || r.original.thumbnailUrl ? `<img id="mr-orig-img" src="${esc(origUrl(r))}" alt="원본 썸네일" />` : '<div class="muted small" style="padding:30px;text-align:center">원본 이미지 없음</div>')}</div>
          <div style="margin-top:6px"><b>${r.original.title}</b></div>
          <div class="chips" style="margin-top:4px">${raw((r.original.tags || []).map((t) => `<span class="chip">${esc(t)}</span>`).join('')) || '<span class="tiny muted">태그 없음</span>'}</div>
          ${r.original.channel ? raw(`<div class="tiny muted" style="margin-top:4px">채널 ${esc(r.original.channel)}</div>`) : ''}
          <div class="row" style="margin-top:6px"><a class="btn btn-sm" href="${origUrl(r)}&download=1" download>원본 이미지 저장</a></div></div>
        <div><div class="tiny muted" style="margin-bottom:4px">새로 만든 썸네일 (${r.thumb.width}×${r.thumb.height})</div>
          <div class="thumb-preview"><img id="mr-new-img" src="${svgUrl(r)}" alt="새 썸네일" /></div>
          <div class="row" style="margin-top:8px;flex-wrap:wrap"><button class="btn btn-primary btn-sm" id="mr-png">⬇ PNG 저장</button><button class="btn btn-sm" id="mr-svg">⬇ SVG 저장</button></div>
          <div class="grid grid-2" style="margin-top:8px"><div class="field"><label>큰 문구</label><input id="mr-head" value="${r.thumb.headline}" maxlength="24" /></div><div class="field"><label>작은 문구</label><input id="mr-sub" value="${r.thumb.subline}" maxlength="24" /></div></div>
          <div class="grid grid-2"><div class="field"><label>스타일</label><select id="mr-e-style">${raw(styles.map((s) => `<option value="${esc(s.id)}" ${s.id === r.thumb.style ? 'selected' : ''}>${esc(s.name)}</option>`).join(''))}</select></div>
            <div class="field"><label>포인트 색</label><select id="mr-e-palette">${raw(Object.entries(palettes).map(([k, v]) => `<option value="${esc(k)}" ${k === r.thumb.palette ? 'selected' : ''}>${esc(k)} (${esc(v[0])})</option>`).join(''))}</select></div></div>
          <div class="row" style="gap:14px;flex-wrap:wrap"><label class="small"><input type="checkbox" id="mr-e-mirror" ${fx.mirror ? 'checked' : ''} /> 좌우 반전</label><label class="small"><input type="checkbox" id="mr-e-zoom" ${(fx.zoom || 1) > 1 ? 'checked' : ''} /> 살짝 확대</label><label class="small"><input type="checkbox" id="mr-e-tint" ${fx.tint ? 'checked' : ''} /> 포인트 색 톤</label></div>
          ${res.thumbnail?.length > 1 ? raw(`<div class="tiny muted" style="margin-top:4px">문구 후보: ${res.thumbnail.map((t) => `<a href="javascript:void 0" data-thumb-text="${esc(t.headline)}|${esc(t.subline || '')}">${esc(t.headline)}${t.subline ? ` / ${esc(t.subline)}` : ''}</a>`).join(' · ')}</div>`) : ''}
          <button class="btn btn-block" id="mr-apply" style="margin-top:8px">적용</button></div>
      </div></div>
      <div class="grid grid-2">
        <div class="card"><div class="row row-between"><b>새 제목 후보</b><button class="btn btn-sm" data-copy="${sel.title || res.titles[0] || ''}">선택한 제목 복사</button></div>
          <div class="seo-best" style="margin:6px 0">${sel.title || res.titles[0] || ''}</div>
          ${raw((res.titles || []).map((t) => `<div class="seo-title ${t === sel.title ? 'active' : ''}" data-title="${esc(t)}" style="cursor:pointer"><span class="badge ${t === sel.title ? 'badge-success' : 'badge-soft'}">${t === sel.title ? '선택' : '선택'}</span> <span>${esc(t)}</span></div>`).join(''))}
          <div class="field" style="margin-top:8px"><label>직접 고치기</label><div class="row"><input id="mr-title-edit" value="${sel.title || ''}" maxlength="120" style="flex:1" /><button class="btn btn-sm" id="mr-title-save">저장</button></div></div>
          ${res.recommended ? raw(`<div class="tiny muted" style="margin-top:8px">📈 추천 알고리즘용 제목: <a href="javascript:void 0" data-title="${esc(res.recommended.bestTitle)}">${esc(res.recommended.bestTitle)}</a></div>`) : ''}</div>
        <div class="card"><div class="row row-between"><b>새 태그 (${(sel.tags || res.tags || []).length})</b><button class="btn btn-sm" data-copy="${(sel.tags || res.tags || []).join(', ')}">복사</button></div>
          <div class="chips">${raw((sel.tags || res.tags || []).map((t) => `<span class="chip">${esc(t)}</span>`).join(''))}</div>
          <div class="field" style="margin-top:8px"><label>태그 직접 고치기 (쉼표 구분)</label><div class="row"><input id="mr-tags-edit" value="${(sel.tags || res.tags || []).join(', ')}" style="flex:1" /><button class="btn btn-sm" id="mr-tags-save">저장</button></div></div>
          <div class="row row-between" style="margin-top:10px"><b>해시태그</b><button class="btn btn-sm" data-copy="${(res.hashtags || []).join(' ')}">복사</button></div><div class="chips">${raw((res.hashtags || []).map((t) => `<span class="chip" style="border-color:var(--primary)">${esc(t)}</span>`).join(''))}</div>
          <div class="row row-between" style="margin-top:10px"><b>설명</b><button class="btn btn-sm" data-copy="${res.description || ''}">복사</button></div><textarea rows="5" readonly>${res.description || ''}</textarea></div>
      </div>`;
    qs('#mr-png').onclick = () => exportPng(r);
    qs('#mr-svg').onclick = () => downloadBlob(svgUrl(r, true), `thumbnail-${r.id.slice(0, 8)}.svg`);
    qs('#mr-apply').onclick = applyThumb;
    ['mr-e-style', 'mr-e-palette', 'mr-e-mirror', 'mr-e-zoom', 'mr-e-tint'].forEach((id) => { qs(`#${id}`).onchange = applyThumb; });
    qs('#mr-title-save').onclick = () => saveSel({ title: qs('#mr-title-edit').value.trim() });
    qs('#mr-tags-save').onclick = () => saveSel({ tags: qs('#mr-tags-edit').value });
    qs('#mr-regen').onclick = async (e) => { e.currentTarget.disabled = true; try { cur = await post(`/api/metaremix/${r.id}/regenerate`, {}); drawResult(); toast('다른 표현으로 다시 만들었습니다.'); } catch (err) { toast(err.message, 'error'); e.currentTarget.disabled = false; } };
    qs('#mr-del').onclick = async () => { if (!(await confirmDialog('이 리믹스 기록을 삭제할까요?'))) return; try { await del(`/api/metaremix/${r.id}`); cur = null; list = list.filter((x) => x.id !== r.id); drawResult(); drawHistory(); history.replaceState(null, '', '#/metaremix'); toast('삭제했습니다.'); } catch (err) { toast(err.message, 'error'); } };
  }
  async function applyThumb() {
    if (!cur) return;
    const fx = { mirror: qs('#mr-e-mirror').checked, zoom: qs('#mr-e-zoom').checked ? fxDefaults.zoom || 1.06 : 1, tint: qs('#mr-e-tint').checked, saturate: cur.thumb.fx?.saturate || fxDefaults.saturate || 1.15 };
    try { cur = await put(`/api/metaremix/${cur.id}`, { headline: qs('#mr-head').value, subline: qs('#mr-sub').value, style: qs('#mr-e-style').value, palette: qs('#mr-e-palette').value, fx }); qs('#mr-new-img').src = svgUrl(cur); drawHistory(); toast('썸네일을 갱신했습니다.'); } catch (err) { toast(err.message, 'error'); }
  }
  async function saveSel(patch) { if (!cur) return; try { cur = await put(`/api/metaremix/${cur.id}`, patch); drawResult(); drawHistory(); toast('저장했습니다.'); } catch (err) { toast(err.message, 'error'); } }
  on(view, 'click', '[data-copy]', (e, t) => copy(t.dataset.copy));
  on(view, 'click', '[data-title]', (e, t) => saveSel({ title: t.dataset.title }));
  on(view, 'click', '[data-thumb-text]', (e, t) => { const [h, s] = t.dataset.thumbText.split('|'); qs('#mr-head').value = h; qs('#mr-sub').value = s || ''; applyThumb(); });
  on(view, 'click', '[data-open]', (e, t) => { navigate(`/metaremix/${t.dataset.open}`); });
  function drawHistory() {
    const host = qs('#mr-history');
    host.innerHTML = list.length ? list.slice(0, 12).map((it) => `<div class="card" style="cursor:pointer;padding:8px" data-open="${esc(it.id)}"><div class="thumb-preview"><img src="${esc(svgUrl(it))}" alt="" loading="lazy" /></div><div class="small" style="margin-top:6px;font-weight:700;line-height:1.3">${esc(it.title || it.originalTitle)}</div><div class="tiny muted">${it.source?.type === 'youtube' ? '유튜브' : '파일'} · ${fmtDate(it.createdAt)}</div></div>`).join('') : '<div class="muted small">아직 없습니다. 위에서 링크나 파일을 넣고 만들어보세요.</div>';
  }
  async function exportPng(r) {
    try {
      const res = await fetch(svgUrl(r), { headers: authHeaders() }); if (!res.ok) throw new Error('썸네일을 불러오지 못했습니다.');
      const svg = await res.text();
      const img = new Image(); const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      await new Promise((ok, fail) => { img.onload = ok; img.onerror = () => fail(new Error('SVG 렌더링 실패')); img.src = url; });
      const c = document.createElement('canvas'); c.width = r.thumb.width; c.height = r.thumb.height; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      c.toBlob((b) => { if (!b) return toast('PNG 변환에 실패했습니다.', 'error'); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `thumbnail-${r.id.slice(0, 8)}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); toast('PNG 로 저장했습니다.'); }, 'image/png');
    } catch (err) { toast(`PNG 저장 실패: ${err.message}. SVG 저장을 이용해주세요.`, 'error', 6000); }
  }
  async function downloadBlob(url, name) {
    try { const res = await fetch(url, { headers: authHeaders() }); if (!res.ok) throw new Error('다운로드 실패'); const b = await res.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
    catch (err) { toast(err.message, 'error'); }
  }
  drawHistory(); drawResult();
});

// 이미지 파일 → (최대 폭 maxW 로 줄인) JPEG data URL
function fileToDataUrl(file, maxW) {
  return new Promise((resolve, reject) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => { const scale = Math.min(1, maxW / img.naturalWidth); const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); resolve({ dataUrl: c.toDataURL('image/jpeg', 0.88), width: c.width, height: c.height }); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지 형식을 지원하지 않습니다.')); };
    img.src = url;
  });
}

// 원본 사진에서 가장 눈에 띄는 색을 골라 팔레트(yellow/red/blue/mint/white)로 매핑
async function detectPalette(rec, palettes) {
  const img = new Image(); img.crossOrigin = 'anonymous';
  await new Promise((ok, fail) => { img.onload = ok; img.onerror = fail; img.src = downloadUrl(`/api/metaremix/${rec.id}/original?v=${Date.now()}`); });
  const c = document.createElement('canvas'); c.width = 48; c.height = 27; const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, 48, 27);
  const d = ctx.getImageData(0, 0, 48, 27).data; const bins = { yellow: 0, red: 0, blue: 0, mint: 0 }; let bright = 0; let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255; const g = d[i + 1] / 255; const b = d[i + 2] / 255; const max = Math.max(r, g, b); const min = Math.min(r, g, b); const s = max ? (max - min) / max : 0; n += 1;
    if (max > 0.85 && s < 0.15) bright += 1;
    if (s < 0.35 || max < 0.35) continue;
    let h = 0; if (max === r) h = ((g - b) / (max - min)) % 6; else if (max === g) h = (b - r) / (max - min) + 2; else h = (r - g) / (max - min) + 4; h = (h * 60 + 360) % 360;
    if (h >= 35 && h < 70) bins.yellow += 1; else if (h < 20 || h >= 335) bins.red += 1; else if (h >= 190 && h < 260) bins.blue += 1; else if (h >= 140 && h < 190) bins.mint += 1;
  }
  const [best, count] = Object.entries(bins).sort((a, b) => b[1] - a[1])[0];
  // 사진의 주된 색과 대비되는 보색 계열을 고른다 (같은 색이면 글씨가 묻힌다): 파랑/민트 사진 → 노랑, 빨강 사진 → 흰색, 노랑 사진 → 파랑
  const contrast = { blue: 'yellow', mint: 'yellow', red: 'white', yellow: 'blue' };
  if (count / n > 0.06 && palettes[contrast[best]]) return contrast[best];
  if (bright / n > 0.4 && palettes.red) return 'red'; // 아주 밝은(흰) 사진엔 빨강이 또렷하다
  return 'yellow';
}
