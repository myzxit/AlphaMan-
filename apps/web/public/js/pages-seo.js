// 유튜브 최적화(제목·태그·설명·해시태그·업로드 시간·체크리스트) 패널 + 썸네일 편집기 (웹사이트 · 프로그램 공용)
import { get, post, put, api, downloadUrl, getToken } from './api.js';
import { esc, html, raw, toast, modal, fmtTime, qs, qsa, on } from './ui.js';

const KIND_LABEL = { shorts: '쇼츠', remix: 'AI 재구성', longform: '롱폼 컷편집' };
async function copy(text, label = '복사됨') { try { await navigator.clipboard.writeText(text); toast(`${label}: 클립보드에 복사했습니다.`); } catch { prompt('복사하세요', text); } }

// ---------------- 유튜브 최적화 ----------------
export async function openSeo(kind, refId, { title = '유튜브 최적화' } = {}) {
  let seo;
  try { seo = await get(`/api/seo/${kind}/${refId}`); } catch (err) { toast(err.message, 'error'); return; }
  const m = modal('<div class="seo-host"><div class="muted">불러오는 중...</div></div>', { title: `📈 ${title} · ${KIND_LABEL[kind] || kind}`, wide: true });
  const host = m.el.querySelector('.seo-host');
  const draw = () => {
    if (!seo) { host.innerHTML = '<p class="muted">아직 최적화 데이터가 없습니다.</p><button class="btn btn-primary" data-seo-regen>지금 생성</button>'; return; }
    host.innerHTML = html`<div class="tiny muted">엔진 ${seo.engine === 'ai' ? 'AI' : '규칙 기반'} · 원본 제목·태그·대본을 바탕으로 만든 유튜브 추천(홈·쇼츠 피드·검색) 최적화 데이터입니다. 클릭하면 복사됩니다.</div>
      <div class="card" style="margin-top:10px"><div class="row row-between"><b>🏆 최고 추천 제목</b><button class="btn btn-sm" data-copy="${seo.bestTitle}">복사</button></div><div class="seo-best">${seo.bestTitle}</div>
        <div class="row row-between" style="margin-top:8px"><b>원본과 거의 비슷한 제목</b><button class="btn btn-sm" data-copy="${seo.similarTitle}">복사</button></div><div class="small">${seo.similarTitle}</div></div>
      <div class="card"><b>제목 후보 (점수순)</b>${raw(seo.titles.map((t) => `<div class="seo-title" data-copy="${esc(t.text)}"><span class="badge ${t.score >= 80 ? 'badge-success' : 'badge-soft'}">${t.score}</span> <span>${esc(t.text)}</span><div class="tiny muted">${esc(t.reason)}</div></div>`).join(''))}</div>
      <div class="grid grid-2"><div class="card"><div class="row row-between"><b>설명</b><button class="btn btn-sm" data-copy="${seo.description}">복사</button></div><textarea rows="9" readonly>${seo.description}</textarea></div>
        <div class="card"><div class="row row-between"><b>태그 (${seo.tags.length})</b><button class="btn btn-sm" data-copy="${seo.tags.join(', ')}">복사</button></div><div class="chips">${raw(seo.tags.map((t) => `<span class="chip">${esc(t)}</span>`).join(''))}</div>
          <div class="row row-between" style="margin-top:10px"><b>해시태그</b><button class="btn btn-sm" data-copy="${seo.hashtags.join(' ')}">복사</button></div><div class="chips">${raw(seo.hashtags.map((t) => `<span class="chip" style="border-color:var(--primary)">${esc(t)}</span>`).join(''))}</div>
          <div style="margin-top:10px"><b>썸네일 문구</b> <span class="small">${(seo.thumbnailText || []).join(' / ')}</span></div>
          <div style="margin-top:10px"><b>추천 업로드 시간</b><ul class="small" style="margin:4px 0 0 18px">${raw((seo.bestPostTimes || []).map((t) => `<li>${esc(t)}</li>`).join(''))}</ul></div></div></div>
      <div class="card"><b>추천 알고리즘 체크리스트</b>${raw((seo.checklist || []).map((c) => `<div class="small" style="padding:4px 0">${c.ok ? '✅' : '⚠️'} <b>${esc(c.label)}</b> <span class="muted">— ${esc(c.tip)}</span></div>`).join(''))}</div>
      <div class="row" style="justify-content:flex-end"><input id="seo-hook" placeholder="후킹 문구를 바꿔 다시 생성 (선택)" style="max-width:320px" /><button class="btn" data-seo-regen>다시 생성</button></div>`;
  };
  draw();
  on(host, 'click', '[data-copy]', (e, t) => copy(t.dataset.copy));
  on(host, 'click', '[data-seo-regen]', async (e, t) => { t.disabled = true; try { seo = await post(`/api/seo/${kind}/${refId}`, { hook: host.querySelector('#seo-hook')?.value || undefined }); draw(); toast('다시 생성했습니다.'); } catch (err) { toast(err.message, 'error'); t.disabled = false; } });
  return m;
}

// ---------------- 썸네일 편집기 ----------------
export async function openThumbnail(kind, refId, { title = '썸네일' } = {}) {
  let data;
  try { data = await get(`/api/thumbnail/${kind}/${refId}`); if (!data.set) { data.set = await post(`/api/thumbnail/${kind}/${refId}/auto`, {}); } } catch (err) { toast(err.message, 'error'); return; }
  const m = modal('<div class="thumb-host"><div class="muted">불러오는 중...</div></div>', { title: `🖼️ ${title} · ${KIND_LABEL[kind] || kind}`, wide: true });
  const host = m.el.querySelector('.thumb-host');
  const state = { candidateId: data.set.selectedId, headline: data.set.headline, subline: data.set.subline, style: data.set.style, palette: data.set.palette, imageUrl: data.set.imageUrl };
  const svgUrl = () => downloadUrl(`/api/thumbnail/${kind}/${refId}/image.svg?v=${encodeURIComponent(data.set.updatedAt)}`);
  const draw = () => {
    host.innerHTML = html`<div class="thumb-editor"><div>
        <div class="thumb-preview"><img id="thumb-img" src="${svgUrl()}" alt="썸네일 미리보기" /></div>
        <div class="row" style="margin-top:8px;flex-wrap:wrap"><button class="btn btn-primary" id="thumb-png">PNG 저장</button><button class="btn" id="thumb-svg">SVG 저장</button><button class="btn" id="thumb-auto">🪄 자동 다시 만들기</button><button class="btn" id="thumb-similar">원본과 비슷하게</button></div>
        <div class="tiny muted" style="margin-top:6px">자동 제작: 원본 썸네일이 있으면 원본 구도 그대로 큰 텍스트만 얹고, 없으면 후킹·핵심 문장 장면을 골라 만듭니다. 장면을 고르고 문구·스타일을 바꾸면 바로 반영됩니다.</div></div>
      <div>
        <b>장면 고르기</b><div class="thumb-cands">${raw(data.candidates.map((c) => `<div class="thumb-cand ${c.id === state.candidateId ? 'active' : ''}" data-cand="${esc(c.id)}" title="${esc(c.reason || '')}">${c.url ? `<img src="${esc(downloadUrl(c.url))}" alt="" onerror="this.onerror=null;this.src='${esc(c.fallbackUrl ? downloadUrl(c.fallbackUrl) : '')}'" />` : `<div class="thumb-cand-empty">📸 캡처</div>`}<div class="tiny">${esc(c.label)}${c.at != null ? ` · ${fmtTime(c.at)}` : ''} <span class="muted">${c.score}</span></div></div>`).join(''))}</div>
        <div class="row" style="margin:6px 0"><button class="btn btn-sm" id="thumb-capture">🎞️ 영상에서 장면 캡처</button><input type="file" id="thumb-upload" accept="image/*" class="hidden" /><button class="btn btn-sm" id="thumb-upload-btn">이미지 올리기</button></div>
        <div class="field"><label>큰 문구 (6자 이내 권장)</label><input id="thumb-head" value="${state.headline}" maxlength="24" /></div>
        <div class="field"><label>작은 문구</label><input id="thumb-sub" value="${state.subline}" maxlength="24" /></div>
        <div class="grid grid-2"><div class="field"><label>스타일</label><select id="thumb-style">${raw(data.styles.map((s) => `<option value="${s.id}" ${s.id === state.style ? 'selected' : ''}>${esc(s.name)} — ${esc(s.desc)}</option>`).join(''))}</select></div>
          <div class="field"><label>색상</label><select id="thumb-palette">${raw(Object.entries(data.palettes).map(([k, [a]]) => `<option value="${k}" ${k === state.palette ? 'selected' : ''}>${k} (${a})</option>`).join(''))}</select></div></div>
        <button class="btn btn-primary btn-block" id="thumb-apply">적용</button></div></div>`;
    on(host, 'click', '[data-cand]', (e, t) => { const c = data.candidates.find((x) => x.id === t.dataset.cand); if (!c) return; if (!c.url && c.captureFrom) return captureFrame(c.captureFrom, c.at); state.candidateId = c.id; qsa('.thumb-cand', host).forEach((x) => x.classList.toggle('active', x.dataset.cand === c.id)); apply(); });
    qs('#thumb-apply', host).onclick = apply;
    ['thumb-style', 'thumb-palette'].forEach((id) => { qs(`#${id}`, host).onchange = apply; });
    qs('#thumb-auto', host).onclick = async () => { try { data.set = await post(`/api/thumbnail/${kind}/${refId}/auto`, {}); Object.assign(state, { candidateId: data.set.selectedId, headline: data.set.headline, subline: data.set.subline, style: data.set.style, palette: data.set.palette }); draw(); } catch (err) { toast(err.message, 'error'); } };
    qs('#thumb-similar', host).onclick = async () => { const orig = data.candidates.find((c) => c.id === 'original'); if (!orig) return toast('원본 썸네일이 없는 영상입니다 (파일 업로드). 장면을 골라 만들어보세요.', 'info', 5000); state.candidateId = 'original'; state.style = 'original-like'; draw(); apply(); };
    qs('#thumb-png', host).onclick = () => exportPng();
    qs('#thumb-svg', host).onclick = async () => { const res = await fetch(svgUrl(), { headers: { Authorization: `Bearer ${getToken()}` } }); const blob = await res.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `thumbnail-${refId.slice(0, 8)}.svg`; a.click(); };
    qs('#thumb-capture', host).onclick = () => { const c = data.candidates.find((x) => x.captureFrom); const spec = c ? { url: c.captureFrom, at: c.at } : null; if (!spec) return toast('캡처할 원본 파일이 없습니다 (유튜브 링크는 장면 25/50/75% 를 제공합니다).', 'info', 5000); captureFrame(spec.url, spec.at, true); };
    qs('#thumb-upload-btn', host).onclick = () => qs('#thumb-upload', host).click();
    qs('#thumb-upload', host).onchange = async (e) => { const f = e.target.files[0]; if (!f) return; await uploadFrame(await f.arrayBuffer(), f.type || 'image/jpeg', null); };
  };
  async function apply() {
    state.headline = qs('#thumb-head', host).value; state.subline = qs('#thumb-sub', host).value; state.style = qs('#thumb-style', host).value; state.palette = qs('#thumb-palette', host).value;
    try { data.set = await put(`/api/thumbnail/${kind}/${refId}`, { candidateId: state.candidateId, headline: state.headline, subline: state.subline, style: state.style, palette: state.palette }); qs('#thumb-img', host).src = svgUrl(); toast('썸네일을 저장했습니다.'); }
    catch (err) { toast(err.message, 'error'); }
  }
  async function uploadFrame(buf, mime, at) {
    try {
      const frame = await api('POST', `/api/thumbnail/${kind}/${refId}/frame`, new Blob([buf], { type: mime }), { headers: { 'Content-Type': mime, ...(at != null ? { 'X-At': String(at) } : {}) } });
      data.candidates.push(frame); state.candidateId = frame.id; draw(); apply();
    } catch (err) { toast(err.message, 'error'); }
  }
  // 원본 영상을 브라우저에서 재생해 특정 시점 프레임을 캡처 (업로드 파일 · PC 파일)
  function captureFrame(streamUrl, at, interactive = false) {
    const v = document.createElement('video'); v.crossOrigin = 'use-credentials'; v.preload = 'auto'; v.muted = true;
    const t = getToken(); if (t) document.cookie = `am_token=${encodeURIComponent(t)}; path=/; SameSite=Lax`;
    v.src = downloadUrl(streamUrl);
    const grab = () => { const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0); c.toBlob(async (b) => { if (!b) return toast('캡처에 실패했습니다.', 'error'); await uploadFrame(await b.arrayBuffer(), 'image/jpeg', v.currentTime); cm && cm.close(); }, 'image/jpeg', 0.9); };
    let cm = null;
    if (interactive) {
      cm = modal('<div class="thumb-capture-box"></div>', { title: '장면 캡처 — 원하는 장면에서 멈추고 캡처' });
      const box = cm.el.querySelector('.thumb-capture-box'); v.controls = true; v.muted = false; v.style.width = '100%'; box.appendChild(v);
      const b = document.createElement('button'); b.className = 'btn btn-primary btn-block'; b.style.marginTop = '8px'; b.textContent = '📸 이 장면 캡처'; b.onclick = grab; box.appendChild(b);
      v.onloadedmetadata = () => { if (at != null) v.currentTime = at; };
      return;
    }
    v.onloadedmetadata = () => { v.currentTime = Math.min(at || 0, Math.max(0, v.duration - 0.1)); };
    v.onseeked = () => grab();
    v.onerror = () => toast('원본 영상을 불러올 수 없어 캡처하지 못했습니다.', 'error');
  }
  async function exportPng() {
    try {
      const res = await fetch(svgUrl(), { headers: { Authorization: `Bearer ${getToken()}` } });
      let svg = await res.text();
      // 이미지들을 data URI 로 인라인 (캔버스 오염 방지)
      const hrefs = [...svg.matchAll(/href="([^"]+)"/g)].map((x) => x[1]).filter((h) => !h.startsWith('data:'));
      for (const h of hrefs) {
        const r = await fetch(h.startsWith('http') ? h : downloadUrl(h), { headers: { Authorization: `Bearer ${getToken()}` } });
        if (!r.ok) continue;
        const b = await r.blob(); const dataUrl = await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(b); });
        svg = svg.split(`href="${h}"`).join(`href="${dataUrl}"`);
      }
      const img = new Image(); const blob = new Blob([svg], { type: 'image/svg+xml' }); const url = URL.createObjectURL(blob);
      await new Promise((ok, fail) => { img.onload = ok; img.onerror = fail; img.src = url; });
      const c = document.createElement('canvas'); c.width = data.set.width; c.height = data.set.height; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `thumbnail-${refId.slice(0, 8)}.png`; a.click(); toast('PNG 로 저장했습니다.'); }, 'image/png');
    } catch (err) { toast(`PNG 변환 실패: ${err.message}. SVG 저장을 이용해주세요.`, 'error', 6000); }
  }
  draw();
  return m;
}

// 카드에 넣는 공용 버튼 묶음
export function seoButtons(kind, refId) { return `<button class="btn btn-sm" data-seo="${kind}:${refId}">📈 유튜브 최적화</button><button class="btn btn-sm" data-thumb="${kind}:${refId}">🖼️ 썸네일</button>`; }
export function bindSeoButtons(root) {
  on(root, 'click', '[data-seo]', (e, t) => { const [k, id] = t.dataset.seo.split(':'); openSeo(k, id); });
  on(root, 'click', '[data-thumb]', (e, t) => { const [k, id] = t.dataset.thumb.split(':'); openThumbnail(k, id); });
}
