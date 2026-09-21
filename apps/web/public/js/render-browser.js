// 브라우저 렌더러 (웹사이트 버전용): ffmpeg 이 없는 서버(서버리스)에서도 실제 편집된 영상 파일을 만든다.
// 업로드/컴퓨터 원본을 <video> 로 재생하면서 캔버스에 (원본 박힌 자막 크롭 → 화면 비율 맞춤 → 새 자막 · 후킹 배너 · 구독 카드) 를 그리고,
// 원본 소리 + TTS 내레이션(MP3 큐, 덕킹) 을 WebAudio 로 섞어 MediaRecorder 로 녹화한다 (실시간: 영상 길이만큼 걸린다).
// 결과(WebM 또는 MP4)는 내려받거나 조각 업로드로 보관함에 저장한다. 유튜브 링크 원본은 브라우저가 프레임을 읽을 수 없어 PC 프로그램(ffmpeg)에서만 렌더링된다.
import { get, post, downloadUrl, getToken } from './api.js';
import { esc, modal, toast, fmtTime, fmtBytes } from './ui.js';

const TEMPLATE_FONT = { auto: 'Black Han Sans', neon: 'Jua', clean: 'Noto Sans KR', bold: 'Black Han Sans', pop: 'Do Hyeon', news: 'IBM Plex Sans KR', cute: 'Gaegu', vlog: 'Gowun Dodum' };

export function browserRenderSupport(spec) {
  if (!spec || spec.rendered) return { ok: false, reason: '이미 렌더된 파일이 있습니다.' };
  if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) return { ok: false, reason: '이 브라우저는 화면 녹화(MediaRecorder)를 지원하지 않습니다. Chrome/Edge 최신 버전을 사용해주세요.' };
  if (!spec.source?.streamUrl) return { ok: false, reason: spec.source?.type === 'youtube' ? '유튜브 링크 원본은 브라우저가 영상 프레임을 읽을 수 없어 웹에서는 렌더링할 수 없습니다. PC 프로그램(ffmpeg + yt-dlp 자동 설치)에서 같은 작업을 열면 실제 MP4 가 렌더링됩니다.' : '재생할 원본 파일이 없습니다.' };
  return { ok: true };
}

function pickMime() {
  const cands = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return cands.find((m) => MediaRecorder.isTypeSupported(m)) || '';
}
const authed = (u) => { const t = getToken(); if (t) document.cookie = `am_token=${encodeURIComponent(t)}; path=/; SameSite=Lax`; return downloadUrl(u); };

// spec → { blob, mime, ext, durationSec }
export async function renderInBrowser(spec, { onProgress = () => {}, onPreview = null, quality = 'hd', signal = null } = {}) {
  const sup = browserRenderSupport(spec); if (!sup.ok) throw new Error(sup.reason);
  const ratio = spec.ratio && spec.ratio !== 'auto' ? spec.ratio : '16:9';
  const base = quality === 'fhd' ? 1080 : 720;
  const [W, H] = ratio === '9:16' ? [base, Math.round(base * 16 / 9)] : ratio === '1:1' ? [base, base] : ratio === '4:5' ? [base, Math.round(base * 5 / 4)] : [Math.round(base * 16 / 9), base];
  const items = (spec.items || []).slice().sort((a, b) => a.newStart - b.newStart);
  const total = spec.durationSec || (items.length ? items[items.length - 1].newEnd : 0);
  if (!items.length || !(total > 0)) throw new Error('렌더링할 타임라인이 없습니다.');
  const mime = pickMime(); if (!mime) throw new Error('지원되는 녹화 형식이 없습니다.');
  const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
  await Promise.all(['Black Han Sans', 'Noto Sans KR', 'Jua', 'Do Hyeon'].map((f) => document.fonts?.load?.(`900 40px '${f}'`).catch(() => null)));
  const font = TEMPLATE_FONT[spec.templateId] || 'Black Han Sans';

  // 원본 영상
  const video = document.createElement('video'); video.playsInline = true; video.preload = 'auto'; video.crossOrigin = 'anonymous'; video.src = authed(spec.source.streamUrl);
  await new Promise((res, rej) => { video.onloadedmetadata = () => res(); video.onerror = () => rej(new Error('원본 영상을 불러오지 못했습니다. 파일이 서버에 남아 있는지 확인해주세요.')); });
  const vw = video.videoWidth || 1280; const vh = video.videoHeight || 720;
  const crop = Math.max(0, Math.min(0.4, spec.cropBottom || 0));
  const srcH = vh * (1 - crop);
  // cover-fit
  const scale = Math.max(W / vw, H / srcH); const dw = vw * scale; const dh = srcH * scale; const dx = (W - dw) / 2; const dy = (H - dh) / 2;

  // 오디오 그래프: 원본(덕킹) + TTS 큐 → 녹화 스트림
  const AC = window.AudioContext || window.webkitAudioContext; const ctx = new AC();
  const dest = ctx.createMediaStreamDestination();
  const srcNode = ctx.createMediaElementSource(video); const origGain = ctx.createGain(); srcNode.connect(origGain).connect(dest);
  const muteOriginal = Boolean(spec.audio?.muteOriginal); origGain.gain.value = muteOriginal ? 0 : 1;
  const cues = [];
  for (const c of spec.audio?.cues || []) {
    if (!c.url) continue;
    try { const buf = await (await fetch(authed(c.url), { headers: { Authorization: `Bearer ${getToken()}` } })).arrayBuffer(); cues.push({ at: c.at, buffer: await ctx.decodeAudioData(buf) }); } catch { /* 파일 없는 큐는 건너뜀 */ }
  }
  const skippedCues = (spec.audio?.cues || []).filter((c) => !c.url).length;

  // 캔버스 + 녹화
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H; const g = canvas.getContext('2d');
  if (onPreview) onPreview(canvas);
  const stream = canvas.captureStream(30); for (const t of dest.stream.getAudioTracks()) stream.addTrack(t);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: quality === 'fhd' ? 8_000_000 : 5_000_000, audioBitsPerSecond: 160_000 });
  const chunks = []; rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const subs = spec.subtitles || [];
  const subSize = Math.round(H / (ratio === '9:16' ? 26 : 22));
  const drawText = (text, x, y, size, { color = '#fff', stroke = '#000', align = 'center', weight = 900, fontFamily = font, maxWidth = W * 0.9 } = {}) => {
    g.font = `${weight} ${size}px '${fontFamily}', 'Noto Sans KR', sans-serif`; g.textAlign = align; g.textBaseline = 'middle'; g.lineJoin = 'round'; g.lineWidth = Math.max(2, size / 8); g.strokeStyle = stroke; g.fillStyle = color;
    const lines = wrapText(text, maxWidth, g);
    lines.forEach((l, i) => { const yy = y + (i - (lines.length - 1) / 2) * size * 1.15; g.strokeText(l, x, yy); g.fillText(l, x, yy); });
  };
  const drawFrame = (t, it) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    if (it && it.kind === 'card') {
      g.fillStyle = '#14161c'; g.fillRect(0, 0, W, H);
      if (it.cta) { drawText(it.title || '구독 · 좋아요 · 알림 설정', W / 2, H * 0.4, Math.round(H / 16)); g.fillStyle = '#ff0033'; roundRect(g, W * 0.3, H * 0.55, W * 0.4, H / 12, H / 40); g.fill(); drawText(`▶ 구독${it.channel ? ` · ${it.channel}` : ''}`, W / 2, H * 0.55 + H / 24, Math.round(H / 26), { stroke: 'rgba(0,0,0,0)' }); drawText('👍 좋아요   🔔 알림 설정   💬 댓글', W / 2, H * 0.72, Math.round(H / 34), { weight: 700, stroke: 'rgba(0,0,0,0)', fontFamily: 'Noto Sans KR' }); }
      else { drawText(it.title || '', W / 2, H / 2, Math.round(H / 14)); if (it.section) drawText(it.section, W / 2, H / 2 + H / 10, Math.round(H / 30), { weight: 700 }); }
    } else {
      try { g.drawImage(video, 0, 0, vw, srcH, dx, dy, dw, dh); } catch { /* 첫 프레임 전 */ }
      if (it && it.kind === 'replay') drawText('↻ 리플레이', W - W * 0.02, H * 0.06, Math.round(H / 36), { align: 'right', weight: 800 });
      if (it && it.kind === 'slowmo') drawText('🐢 슬로모션', W - W * 0.02, H * 0.06, Math.round(H / 36), { align: 'right', weight: 800 });
    }
    const sub = subs.find((s) => t >= s.start && t < s.end);
    if (sub) drawText(sub.text, W / 2, H * (ratio === '9:16' ? 0.82 : 0.88), subSize);
    if (spec.hook && t < (spec.hook.durationSec || 3)) { g.fillStyle = 'rgba(0,0,0,.6)'; roundRect(g, W * 0.04, H * 0.03, W * 0.92, H * 0.09, H / 60); g.fill(); drawText(`🔥 ${spec.hook.text}`, W / 2, H * 0.075, Math.round(H / 28), { color: '#ffd400', stroke: 'rgba(0,0,0,0)', weight: 800, fontFamily: 'Noto Sans KR' }); }
  };

  // 타임라인 재생 + 녹화 루프
  let stopped = false; let cur = -1; let outT = 0; let cardStart = 0;
  const seek = (t) => new Promise((res) => { const done = () => { video.removeEventListener('seeked', done); res(); }; video.addEventListener('seeked', done); video.currentTime = Math.max(0, Math.min(video.duration || t, t)); });
  const scheduleCues = (fromOut) => { const now = ctx.currentTime; for (const c of cues) { if (c.at < fromOut - 0.2 || c.scheduled) continue; const src = ctx.createBufferSource(); src.buffer = c.buffer; const gn = ctx.createGain(); src.connect(gn).connect(dest); const when = now + (c.at - fromOut) / 1; src.start(Math.max(now, when)); c.scheduled = true; if (!muteOriginal) { const s0 = Math.max(now, when); origGain.gain.setValueAtTime(1, s0); origGain.gain.linearRampToValueAtTime(0.25, s0 + 0.15); origGain.gain.setValueAtTime(0.25, s0 + c.buffer.duration); origGain.gain.linearRampToValueAtTime(1, s0 + c.buffer.duration + 0.3); } } };
  await ctx.resume();
  rec.start(1000);
  const startedAt = performance.now();
  const enter = async (i) => {
    cur = i; const it = items[i]; if (!it) return;
    if (it.kind === 'card') { video.pause(); cardStart = performance.now(); }
    else { video.playbackRate = Math.max(0.25, Math.min(4, it.speed || 1)); await seek(it.start); try { await video.play(); } catch { /* autoplay 정책: 사용자 클릭으로 시작되므로 보통 허용 */ } }
  };
  await enter(0); scheduleCues(0);
  await new Promise((resolve, reject) => {
    const tick = () => {
      if (stopped) return resolve();
      if (signal?.aborted) { stopped = true; return reject(new Error('취소되었습니다.')); }
      const it = items[cur];
      if (it) {
        if (it.kind === 'card') { outT = it.newStart + (performance.now() - cardStart) / 1000; if (outT >= it.newEnd) { if (cur + 1 < items.length) { enter(cur + 1); } else { stopped = true; } } }
        else { const mt = video.currentTime; outT = it.newStart + (mt - it.start) / (it.speed || 1); if (video.ended || mt >= it.end - 0.04 || outT >= it.newEnd) { if (cur + 1 < items.length) { outT = it.newEnd; enter(cur + 1); } else { stopped = true; } } }
      }
      drawFrame(Math.min(total, outT), it);
      onProgress(Math.min(1, outT / total), outT);
      if (stopped) { drawFrame(total, it); return resolve(); }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  video.pause();
  await new Promise((res) => { rec.onstop = res; rec.stop(); });
  try { srcNode.disconnect(); ctx.close(); } catch { /* ignore */ }
  video.removeAttribute('src'); video.load();
  const blob = new Blob(chunks, { type: mime.split(';')[0] });
  return { blob, mime: mime.split(';')[0], ext, durationSec: total, elapsedSec: Math.round((performance.now() - startedAt) / 1000), skippedCues };
}

function wrapText(text, maxWidth, g) { const words = String(text || '').split(/\s+/); const lines = []; let cur = ''; for (const w of words) { const test = cur ? `${cur} ${w}` : w; if (g.measureText(test).width > maxWidth && cur) { lines.push(cur); cur = w; } else cur = test; } if (cur) lines.push(cur); return lines.slice(0, 3); }
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

// 조각 업로드 → 보관함 저장 (서버리스 4.5MB 본문 제한 대응)
export async function uploadRender(libraryId, blob, mime, { onProgress = () => {} } = {}) {
  const CHUNK = 3.5 * 1024 * 1024; const parts = Math.max(1, Math.ceil(blob.size / CHUNK)); const uploadId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  let last = null;
  for (let i = 0; i < parts; i++) {
    const part = blob.slice(i * CHUNK, Math.min(blob.size, (i + 1) * CHUNK));
    const res = await fetch(downloadUrl(`/api/library/${libraryId}/render`), { method: 'POST', headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': mime, 'X-Upload-Id': uploadId, 'X-Part': String(i), 'X-Parts': String(parts) }, body: part });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || `업로드 실패 (${res.status})`);
    last = j; onProgress((i + 1) / parts);
  }
  return last;
}

// 렌더 대화상자: 미리보기 스펙을 받아 진행률을 보여주며 렌더링 → 내려받기 / 보관함 저장
export async function openRenderDialog({ kind, refId, libraryId = null, title = '' }) {
  let spec;
  try { spec = await get(`/api/preview/${kind}/${refId}`); } catch (err) { return toast(err.message, 'error', 6000); }
  const sup = browserRenderSupport(spec);
  const desktop = Boolean(window.alphaman?.isDesktop);
  if (!sup.ok) { modal(`<p>${esc(sup.reason)}</p>${spec.source?.type === 'youtube' && !desktop ? '<div class="row"><a class="btn btn-primary" href="#/download">PC 프로그램 받기</a><a class="btn" href="#/guide">렌더링 안내</a></div>' : ''}`, { title: '브라우저 렌더링' }); return null; }
  if (!libraryId) { try { const { items } = await get(`/api/library?kind=${kind}`); libraryId = items.find((it) => it.refId === refId)?.id || null; } catch { /* ignore */ } }
  const cuesNoFile = (spec.audio?.cues || []).filter((c) => !c.url).length;
  const m = modal(`<p class="small muted">원본 파일을 재생하며 자막·후킹·구독 카드${spec.cropBottom ? ' · 원본 박힌 자막 제거(하단 크롭)' : ''}${(spec.audio?.cues || []).length ? ' · 내레이션(TTS) 믹싱' : ''}을 그려 실제 영상 파일로 녹화합니다. 영상 길이(${fmtTime(spec.durationSec)})만큼 걸리며, <b>이 탭을 화면에 유지</b>해야 합니다.</p>
    ${cuesNoFile ? `<p class="tiny" style="color:var(--warn)">TTS ${cuesNoFile}개는 음성 파일이 없어(브라우저 음성) 녹화에 포함되지 않습니다.</p>` : ''}
    <div class="row" style="margin-bottom:8px"><label class="check"><input type="radio" name="rq" value="hd" checked/> HD (720p · 빠름)</label><label class="check"><input type="radio" name="rq" value="fhd"/> Full HD (1080p)</label></div>
    <div class="render-preview"><canvas id="rd-canvas" style="width:100%;max-height:50vh;background:#000;border-radius:10px;object-fit:contain"></canvas></div>
    <div class="progress" style="margin:10px 0"><div id="rd-bar" style="width:0"></div></div><div class="tiny muted" id="rd-status">준비됨</div>
    <div class="row" style="margin-top:10px"><button class="btn btn-primary" id="rd-start">렌더링 시작</button><button class="btn btn-danger hidden" id="rd-cancel">취소</button><a class="btn hidden" id="rd-download">파일 내려받기</a><button class="btn hidden" id="rd-save">보관함에 저장</button></div>`, { title: `🎬 브라우저 렌더링 · ${title || spec.title || ''}`, wide: true });
  const $ = (id) => m.el.querySelector(id);
  const ctrl = new AbortController();
  $('#rd-cancel').onclick = () => ctrl.abort();
  $('#rd-start').onclick = async () => {
    $('#rd-start').disabled = true; $('#rd-cancel').classList.remove('hidden');
    const quality = m.el.querySelector('input[name=rq]:checked').value;
    try {
      const out = await renderInBrowser(spec, { quality, signal: ctrl.signal, onPreview: (canvas) => { const view = $('#rd-canvas'); const vg = view.getContext('2d'); view.width = canvas.width; view.height = canvas.height; const copy = () => { if (ctrl.signal.aborted || !document.body.contains(view)) return; vg.drawImage(canvas, 0, 0); requestAnimationFrame(copy); }; copy(); }, onProgress: (p, t) => { $('#rd-bar').style.width = `${Math.round(p * 100)}%`; $('#rd-status').textContent = `녹화 중 ${fmtTime(t)} / ${fmtTime(spec.durationSec)} (${Math.round(p * 100)}%)`; } });
      $('#rd-cancel').classList.add('hidden'); $('#rd-bar').style.width = '100%';
      $('#rd-status').textContent = `완료 · ${out.ext.toUpperCase()} ${fmtBytes(out.blob.size)} · ${out.elapsedSec}초 소요${out.skippedCues ? ` · TTS ${out.skippedCues}개 제외` : ''}`;
      const url = URL.createObjectURL(out.blob); const dl = $('#rd-download'); dl.href = url; dl.download = `${(title || spec.title || 'alphaman').replace(/[\\/:*?"<>|]+/g, '_')}.${out.ext}`; dl.classList.remove('hidden');
      if (libraryId) { const sv = $('#rd-save'); sv.classList.remove('hidden'); sv.onclick = async () => { sv.disabled = true; try { await uploadRender(libraryId, out.blob, out.mime, { onProgress: (p) => { sv.textContent = `업로드 ${Math.round(p * 100)}%`; } }); sv.textContent = '보관함에 저장됨'; toast('보관함에 저장했습니다. 미리보기가 렌더된 파일로 재생됩니다.'); window.dispatchEvent(new CustomEvent('am:rendered', { detail: { kind, refId, libraryId } })); } catch (err) { toast(err.message, 'error', 6000); sv.disabled = false; sv.textContent = '보관함에 저장'; } }; }
      if (window.alphaman?.notify) window.alphaman.notify('렌더링 완료', `${title || spec.title || ''} (${out.ext.toUpperCase()})`);
    } catch (err) { $('#rd-status').textContent = `실패: ${err.message}`; $('#rd-start').disabled = false; $('#rd-cancel').classList.add('hidden'); if (!ctrl.signal.aborted) toast(err.message, 'error', 6000); }
  };
  return m;
}

// 페이지 공용: data-render="kind:refId" 버튼 바인딩
export function renderButton(kind, refId, spec = null) { const canDesktop = Boolean(window.alphaman?.isDesktop); return `<button class="btn btn-sm" data-render="${kind}:${refId}" title="${canDesktop ? '브라우저 렌더링 (ffmpeg 없이)' : '웹사이트에서 실제 영상 파일 만들기'}">🎬 영상 파일 만들기</button>`; }
export function bindRenderButtons(root, titleOf = () => '') { root.addEventListener('click', (e) => { const t = e.target.closest('[data-render]'); if (!t || !root.contains(t)) return; const [k, id] = t.dataset.render.split(':'); openRenderDialog({ kind: k, refId: id, title: titleOf(k, id) }); }); }
