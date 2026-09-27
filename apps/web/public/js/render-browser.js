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
  // 원본에 박힌 자막 제거 영역: 서버가 준 영역(하단/중앙/상단) 또는 프레임 분석으로 자동 감지. 가장자리 띠는 잘라내고(크롭) 중앙 띠는 블러로 가린다
  let region = spec.burnedRegion ? { ...spec.burnedRegion } : (spec.cropBottom > 0 ? { x: 0, y: 1 - spec.cropBottom, w: 1, h: spec.cropBottom, detect: false } : null);
  // 원본 자막 스타일(위치·색·크기): 서버(ffmpeg) 분석 결과가 있으면 그것을, 없으면 여기서 프레임을 분석한다
  let origStyle = spec.originalStyle || null;
  if ((region?.detect || (spec.subtitleLook === 'original' && !origStyle)) && spec.source?.streamUrl) {
    onProgress(0, 0, '원본 자막 위치·스타일 분석 중...');
    const found = await detectSubtitleBand(video, items, { vw, vh, signal });
    if (found) { if (region?.detect) region = { ...found.band, detect: false, detected: true }; if (!origStyle) origStyle = found; }
  }
  const matchOriginal = spec.subtitleLook === 'original' && origStyle && origStyle.band;
  const cropBottom = region && region.y + region.h >= 0.95 ? Math.max(0, Math.min(0.4, region.h)) : 0;
  const cropTop = region && !cropBottom && region.y <= 0.03 ? Math.max(0, Math.min(0.4, region.h)) : 0;
  const blurBand = region && !cropBottom && !cropTop ? region : null;
  const srcY = vh * cropTop; const srcH = vh * (1 - cropBottom - cropTop);
  // cover-fit
  const scale = Math.max(W / vw, H / srcH); const dw = vw * scale; const dh = srcH * scale; const dx = (W - dw) / 2; const dy = (H - dh) / 2;

  // 오디오 그래프: 원본(덕킹/음소거) + TTS 큐 → 녹화 스트림
  const AC = window.AudioContext || window.webkitAudioContext; const ctx = new AC();
  const dest = ctx.createMediaStreamDestination();
  const srcNode = ctx.createMediaElementSource(video); const origGain = ctx.createGain(); srcNode.connect(origGain).connect(dest);
  const muteOriginal = Boolean(spec.audio?.muteOriginal); origGain.gain.value = muteOriginal ? 0 : 1;
  const duckLevel = spec.audio?.duckLevel != null ? Math.max(0, Math.min(1, Number(spec.audio.duckLevel))) : 0.25;
  const exclusiveCues = Boolean(spec.audio?.exclusiveCues); // 더빙: 다음 문장이 시작되면 이전 문장을 멈춘다
  const cues = [];
  for (const c of spec.audio?.cues || []) {
    if (!c.url) continue;
    try { const buf = await (await fetch(authed(c.url), { headers: { Authorization: `Bearer ${getToken()}` } })).arrayBuffer(); cues.push({ at: c.at, buffer: await ctx.decodeAudioData(buf) }); } catch { /* 파일 없는 큐는 건너뜀 */ }
  }
  cues.sort((a, b) => a.at - b.at);
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
      try {
        g.drawImage(video, 0, srcY, vw, srcH, dx, dy, dw, dh);
        if (blurBand) { // 중앙 자막 띠: 같은 영역을 블러+어둡게 덧그려 글자를 가린다
          const by = dy + (vh * blurBand.y - srcY) * scale; const bh = vh * blurBand.h * scale;
          g.save(); g.beginPath(); g.rect(dx, by, dw, bh); g.clip();
          try { g.filter = 'blur(14px)'; g.drawImage(video, 0, vh * blurBand.y, vw, vh * blurBand.h, dx - 20, by - 20, dw + 40, bh + 40); g.filter = 'none'; } catch { /* filter 미지원 */ }
          g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(dx, by, dw, bh); g.restore();
        }
      } catch { /* 첫 프레임 전 */ }
      if (it && it.kind === 'replay') drawText('↻ 리플레이', W - W * 0.02, H * 0.06, Math.round(H / 36), { align: 'right', weight: 800 });
      if (it && it.kind === 'slowmo') drawText('🐢 슬로모션', W - W * 0.02, H * 0.06, Math.round(H / 36), { align: 'right', weight: 800 });
    }
    const sub = subs.find((s) => t >= s.start && t < s.end);
    if (sub) {
      // 원본 자막과 비슷하게: 원본 자막이 있던 세로 위치 · 글자 크기 · 글자색 · 외곽선색으로 그린다
      if (matchOriginal) drawText(sub.text, W / 2, H * Math.max(0.08, Math.min(0.92, origStyle.centerY ?? (origStyle.band.y + origStyle.band.h / 2))), Math.round(H * Math.max(0.03, Math.min(0.12, origStyle.sizeRatio || 0.05))), { color: origStyle.color || '#fff', stroke: origStyle.outline || '#000', fontFamily: 'Noto Sans KR', weight: 800 });
      else drawText(sub.text, W / 2, H * (ratio === '9:16' ? 0.82 : 0.88), subSize);
    }
    if (spec.hook && t < (spec.hook.durationSec || 3)) { g.fillStyle = 'rgba(0,0,0,.6)'; roundRect(g, W * 0.04, H * 0.03, W * 0.92, H * 0.09, H / 60); g.fill(); drawText(`🔥 ${spec.hook.text}`, W / 2, H * 0.075, Math.round(H / 28), { color: '#ffd400', stroke: 'rgba(0,0,0,0)', weight: 800, fontFamily: 'Noto Sans KR' }); }
  };

  // 타임라인 재생 + 녹화 루프
  let stopped = false; let cur = -1; let outT = 0; let cardStart = 0;
  const seek = (t) => new Promise((res) => { const done = () => { video.removeEventListener('seeked', done); res(); }; video.addEventListener('seeked', done); video.currentTime = Math.max(0, Math.min(video.duration || t, t)); });
  // TTS 큐는 출력 시간(outT)이 시점에 도달할 때 그때그때 시작한다 (탐색 지연이 쌓여도 시점이 어긋나지 않는다)
  let activeCue = null;
  const startCue = (c) => {
    c.scheduled = true;
    if (exclusiveCues && activeCue) { try { activeCue.src.stop(); } catch { /* 이미 끝남 */ } }
    const src = ctx.createBufferSource(); src.buffer = c.buffer; const gn = ctx.createGain(); src.connect(gn).connect(dest); src.start();
    const now = ctx.currentTime; activeCue = { src, until: now + c.buffer.duration };
    src.onended = () => { if (activeCue?.src === src) activeCue = null; if (!muteOriginal) { const t = ctx.currentTime; origGain.gain.cancelScheduledValues(t); origGain.gain.setValueAtTime(origGain.gain.value, t); origGain.gain.linearRampToValueAtTime(1, t + 0.3); } };
    if (!muteOriginal) { origGain.gain.cancelScheduledValues(now); origGain.gain.setValueAtTime(origGain.gain.value, now); origGain.gain.linearRampToValueAtTime(duckLevel, now + 0.15); }
  };
  const scheduleCues = (fromOut) => { for (const c of cues) if (!c.scheduled && fromOut >= c.at - 0.03 && fromOut < c.at + 2) startCue(c); else if (!c.scheduled && fromOut >= c.at + 2) c.scheduled = true; };
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
      scheduleCues(outT);
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
  return { blob, mime: mime.split(';')[0], ext, durationSec: total, elapsedSec: Math.round((performance.now() - startedAt) / 1000), skippedCues, region, mutedOriginal: muteOriginal, cuesMixed: cues.length, originalStyle: matchOriginal ? origStyle : null };
}

// 원본에 박힌 자막 분석: 타임라인 곳곳의 프레임을 작게 그려 "밝은 글자 + 어두운 외곽선" 이 가로로 몰린 행 묶음(자막 띠)을 찾고,
// 글자색·외곽선색·글자 크기 비율도 추정한다 (서버 packages/core/src/subtitles/burned.js 와 같은 알고리즘).
// 결과: { band:{x,y,w,h}, align, centerY, color, outline, sizeRatio } 또는 null (박힌 자막 없음 → 호출자가 기본 영역 사용)
export async function detectSubtitleBand(video, items, { vw, vh, signal = null, samples = 10 } = {}) {
  const srcItems = items.filter((it) => it.kind !== 'card' && it.end > it.start);
  if (!srcItems.length || !video.duration) return null;
  const w = 160; const h = Math.max(60, Math.round(160 * vh / vw)); const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', { willReadFrequently: true });
  const rowHits = new Float32Array(h); let frames = 0;
  const textRgb = [0, 0, 0]; let textN = 0; const outRgb = [0, 0, 0]; let outN = 0;
  const seekTo = (t) => new Promise((res) => { const done = () => { video.removeEventListener('seeked', done); res(); }; video.addEventListener('seeked', done); video.currentTime = Math.max(0, Math.min(video.duration - 0.05, t)); setTimeout(res, 1500); });
  const span = srcItems.reduce((s, it) => s + (it.end - it.start), 0);
  const lumAt = (d, x, y) => { const p = (y * w + x) * 4; return d[p] * 0.3 + d[p + 1] * 0.59 + d[p + 2] * 0.11; };
  for (let i = 0; i < samples; i++) {
    if (signal?.aborted) return null;
    let off = span * ((i + 0.5) / samples); let t = srcItems[0].start;
    for (const it of srcItems) { const len = it.end - it.start; if (off <= len) { t = it.start + off; break; } off -= len; }
    await seekTo(t);
    try { g.drawImage(video, 0, 0, w, h); } catch { continue; }
    const d = g.getImageData(0, 0, w, h).data; frames += 1;
    for (let y = 1; y < h - 1; y++) {
      let n = 0;
      for (let x = 1; x < w - 1; x++) {
        if (lumAt(d, x, y) < 190) continue;
        // 밝은 픽셀 주변(상하좌우)에 어두운 픽셀이 있으면 글자 외곽선으로 본다
        let dark = null;
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) { if (lumAt(d, x + dx, y + dy) < 70) { dark = [x + dx, y + dy]; break; } }
        if (!dark) continue;
        n += 1;
        const p = (y * w + x) * 4; textRgb[0] += d[p]; textRgb[1] += d[p + 1]; textRgb[2] += d[p + 2]; textN += 1;
        const q = (dark[1] * w + dark[0]) * 4; outRgb[0] += d[q]; outRgb[1] += d[q + 1]; outRgb[2] += d[q + 2]; outN += 1;
      }
      rowHits[y] += n / w;
    }
  }
  if (!frames) return null;
  const avg = Array.from(rowHits, (v) => v / frames); const max = Math.max(...avg);
  if (max < 0.06) return null; // 글자 외곽선 특징이 거의 없음 → 박힌 자막 없음
  const thr = max * 0.35; let best = null; let start = -1;
  for (let y = 0; y <= h; y++) {
    const on = y < h && avg[y] >= thr;
    if (on && start < 0) start = y;
    if (!on && start >= 0) { const score = avg.slice(start, y).reduce((a, b) => a + b, 0); if (!best || score > best.score) best = { start, end: y, score }; start = -1; }
  }
  if (!best) return null;
  const pad = Math.round(h * 0.03); const y0 = Math.max(0, best.start - pad) / h; const y1 = Math.min(h, best.end + pad) / h;
  if (y1 - y0 < 0.05) return null;
  const r2 = (n) => Math.round(n * 100) / 100;
  const band = { x: 0, y: r2(y0), w: 1, h: Math.max(0.08, r2(y1 - y0)) };
  const hex = (rgb, n) => (n ? `#${rgb.map((v) => Math.round(v / n).toString(16).padStart(2, '0')).join('')}` : null);
  const lineH = (best.end - best.start) / h;
  return { band, detected: true, align: band.y + band.h >= 0.95 || band.y >= 0.6 ? 'bottom' : band.y <= 0.03 || band.y + band.h <= 0.35 ? 'top' : 'center', centerY: r2(band.y + band.h / 2), color: hex(textRgb, textN) || '#ffffff', outline: hex(outRgb, outN) || '#000000', sizeRatio: Math.max(0.03, Math.min(0.12, r2(lineH * 0.6))) };
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
  const reg = spec.burnedRegion; const regLabel = reg ? (reg.detect ? '원본 박힌 자막 자동 감지 후 제거' : reg.y + reg.h >= 0.95 ? '원본 박힌 자막 제거(하단 크롭)' : reg.y <= 0.03 ? '원본 박힌 자막 제거(상단 크롭)' : '원본 박힌 자막 제거(중앙 블러)') : (spec.cropBottom ? '원본 박힌 자막 제거(하단 크롭)' : '');
  const audioLabel = spec.audio?.mode === 'dub' ? `전체 더빙(${(spec.audio.cues || []).length}문장) · 원본 목소리 제거` : (spec.audio?.cues || []).length ? `내레이션(TTS ${(spec.audio.cues || []).length}개) 믹싱${spec.audio?.muteOriginal ? ' · 원본 소리 끔' : ''}` : '';
  const lookLabel = spec.subtitleLook === 'original' ? '새 자막(원본 자막과 비슷한 위치·크기·색)' : '새 자막(템플릿)';
  const m = modal(`<p class="small muted">원본 파일을 재생하며 ${lookLabel}·후킹·구독 카드${regLabel ? ` · ${regLabel}` : ''}${audioLabel ? ` · ${audioLabel}` : ''}을 그려 실제 영상 파일로 녹화합니다. 영상 길이(${fmtTime(spec.durationSec)})만큼 걸리며, <b>이 탭을 화면에 유지</b>해야 합니다.</p>
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
      const out = await renderInBrowser(spec, { quality, signal: ctrl.signal, onPreview: (canvas) => { const view = $('#rd-canvas'); const vg = view.getContext('2d'); view.width = canvas.width; view.height = canvas.height; const copy = () => { if (ctrl.signal.aborted || !document.body.contains(view)) return; vg.drawImage(canvas, 0, 0); requestAnimationFrame(copy); }; copy(); }, onProgress: (p, t, label) => { $('#rd-bar').style.width = `${Math.round(p * 100)}%`; $('#rd-status').textContent = label || `녹화 중 ${fmtTime(t)} / ${fmtTime(spec.durationSec)} (${Math.round(p * 100)}%)`; } });
      $('#rd-cancel').classList.add('hidden'); $('#rd-bar').style.width = '100%';
      $('#rd-status').textContent = `완료 · ${out.ext.toUpperCase()} ${fmtBytes(out.blob.size)} · ${out.elapsedSec}초 소요${out.region ? ` · 자막 영역 ${out.region.detected ? '자동 감지' : '지정'} (${Math.round(out.region.y * 100)}~${Math.round((out.region.y + out.region.h) * 100)}%)` : ''}${out.originalStyle ? ` · 새 자막을 원본처럼(${out.originalStyle.align === 'top' ? '상단' : out.originalStyle.align === 'center' ? '중앙' : '하단'} · ${out.originalStyle.color})` : ''}${out.cuesMixed ? ` · TTS ${out.cuesMixed}개 믹싱` : ''}${out.mutedOriginal ? ' · 원본 목소리 제거' : ''}${out.skippedCues ? ` · TTS ${out.skippedCues}개 제외` : ''}`;
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
