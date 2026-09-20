// 원본과 똑같은 대본 만들기 (웹사이트 · 프로그램 공용)
//  1) 파일/로컬 영상: 브라우저에서 음성을 16kHz 로 디코드해 Whisper(transformers.js 워커)로 그대로 받아 적는다 → transcript 세그먼트
//  2) 링크: 유튜브 "스크립트 표시"에서 복사한 대본을 붙여넣는다 → transcriptText (서버가 SRT/[mm:ss]/문장 형식을 해석)
//  서버는 이 둘(또는 서버 whisper / yt-dlp 자막)로만 자막을 만들고, 추정 대본은 만들지 않는다.
import { esc, html, raw } from './ui.js';
import { downloadUrl, getToken } from './api.js';

let worker = null; let seq = 0; const pending = new Map();
function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./stt-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => { const p = pending.get(e.data.id); if (!p) return; if (e.data.type === 'done') { pending.delete(e.data.id); p.resolve(e.data); } else if (e.data.type === 'error') { pending.delete(e.data.id); p.reject(new Error(e.data.message)); } else p.onStatus(e.data); };
  worker.onerror = (e) => { for (const [id, p] of pending) { pending.delete(id); p.reject(new Error(e.message || '음성 인식 워커 오류')); } worker = null; };
  return worker;
}

export function sttModel() { try { return localStorage.getItem('am_stt_model') || 'Xenova/whisper-base'; } catch { return 'Xenova/whisper-base'; } }
export function setSttModel(m) { try { localStorage.setItem('am_stt_model', m); } catch { /* ignore */ } }
export const STT_MODELS = [['Xenova/whisper-tiny', 'tiny (가장 빠름, 약 40MB)'], ['Xenova/whisper-base', 'base (권장, 약 75MB)'], ['Xenova/whisper-small', 'small (더 정확, 약 250MB)']];

// 파일(File/Blob) → 16kHz 모노 Float32 → Whisper → [{start,end,text}]
export async function transcribeFile(file, { language = 'ko', onStatus = () => {}, model = sttModel() } = {}) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC || !window.Worker) throw new Error('이 브라우저는 대본 추출을 지원하지 않습니다.');
  onStatus({ type: 'status', message: '파일 읽는 중...' });
  const buf = await file.arrayBuffer();
  const ctx = new AC();
  let decoded;
  try { decoded = await ctx.decodeAudioData(buf.slice(0)); } catch (err) { throw new Error(`음성을 디코드하지 못했습니다 (${err.message || err}). MP4(H.264/AAC), MOV, WebM, MP3, WAV 파일을 사용해주세요.`); } finally { ctx.close?.(); }
  if (!decoded || decoded.duration < 0.5) throw new Error('음성 트랙이 없는 파일입니다.');
  onStatus({ type: 'status', message: `음성 ${Math.round(decoded.duration)}초 → 16kHz 변환 중...` });
  const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
  const src = off.createBufferSource(); src.buffer = decoded; src.connect(off.destination); src.start(0);
  const rendered = await off.startRendering();
  const audio = rendered.getChannelData(0);
  const id = ++seq;
  const result = await new Promise((resolve, reject) => { pending.set(id, { resolve, reject, onStatus }); getWorker().postMessage({ id, audio, language, model, sampleRate: 16000 }, [audio.buffer]); });
  return { segments: result.segments.map((s) => ({ start: round(s.start), end: round(s.end), text: s.text })), text: result.text, engine: `browser-whisper:${result.model.split('/').pop()}`, durationSec: round(decoded.duration) };
}

// 프로그램 버전: 컴퓨터/USB 경로의 영상을 내장 서버에서 읽어와 같은 방식으로 추출
export async function transcribeLocalPath(localPath, opts = {}) {
  const res = await fetch(downloadUrl(`/api/local/stream?path=${encodeURIComponent(localPath)}`), { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new Error('로컬 파일을 읽지 못했습니다.');
  const blob = await res.blob();
  return transcribeFile(new File([blob], localPath.split(/[\\/]/).pop() || 'video.mp4', { type: blob.type || 'video/mp4' }), opts);
}

// 페이지에 넣는 공용 패널. prefix 로 id 를 구분한다.
export function transcriptPanel(prefix, { info = null } = {}) {
  const t = info?.transcript || {};
  const linkNote = t.youtubeCaptions ? '이 서버는 유튜브 링크의 자막(스크립트)을 자동으로 가져옵니다. 자막이 없는 영상이면 아래에 대본을 붙여넣어 주세요.' : '웹사이트 버전은 유튜브 링크의 대본을 서버에서 가져올 수 없습니다. 유튜브 영상 아래 "...더보기 → 스크립트 표시"에서 대본을 복사해 붙여넣으면 원본과 똑같은 자막이 됩니다. (프로그램 버전은 자동으로 가져옵니다)';
  return html`<div class="card transcript-panel" id="${prefix}-tp" style="margin-top:12px;padding:14px">
    <div class="row row-between"><b>📝 원본 대본 (자막을 원본과 똑같이)</b><span class="badge badge-soft" id="${prefix}-tp-state">대본 없음</span></div>
    <div class="tiny muted" id="${prefix}-tp-status" style="margin-top:4px">파일을 올리면 브라우저에서 Whisper 로 원본 음성을 그대로 받아 적습니다 (처음 한 번 모델 다운로드). 링크는 대본을 붙여넣어 주세요.</div>
    <div class="progress hidden" id="${prefix}-tp-bar-wrap" style="margin-top:6px"><div id="${prefix}-tp-bar" style="width:0"></div></div>
    <details style="margin-top:8px"><summary class="small">대본 붙여넣기 / 확인 · 수정</summary>
      <div class="tiny muted" style="margin:6px 0">${linkNote} 지원 형식: 유튜브 스크립트 복사본( <code>0:00</code> 줄 + 문장 ), SRT, <code>[mm:ss] 문장</code>, 또는 문장만 줄바꿈.</div>
      <textarea id="${prefix}-tp-text" rows="6" placeholder="0:00&#10;안녕하세요 오늘은&#10;0:04&#10;이 영상에서는 ..."></textarea>
      <div class="row" style="margin-top:6px;align-items:center;gap:8px"><label class="tiny muted">브라우저 Whisper 모델</label><select id="${prefix}-tp-model" style="width:auto">${raw(STT_MODELS.map(([v, l]) => `<option value="${v}" ${v === sttModel() ? 'selected' : ''}>${esc(l)}</option>`).join(''))}</select><button class="btn btn-sm" id="${prefix}-tp-redo">파일 대본 다시 추출</button></div>
    </details></div>`;
}

// 패널 컨트롤러: 파일이 오면 추출, 붙여넣기는 그대로 사용
export function transcriptController(prefix, { language = () => 'ko' } = {}) {
  const el = (s) => document.getElementById(`${prefix}-tp-${s}`);
  const state = { segments: null, engine: null, file: null, localPath: null, busy: false };
  const setState = (label, cls = 'badge-soft') => { const b = el('state'); if (b) { b.textContent = label; b.className = `badge ${cls}`; } };
  const status = (msg) => { const s = el('status'); if (s) s.textContent = msg; };
  const bar = (p) => { const w = el('bar-wrap'); const b = el('bar'); if (!w || !b) return; w.classList.toggle('hidden', p == null); if (p != null) b.style.width = `${p}%`; };
  const modelSel = el('model'); if (modelSel) modelSel.onchange = () => setSttModel(modelSel.value);
  const onStatus = (m) => { if (m.type === 'download') { status(`모델 다운로드 ${m.progress}% (${m.file})`); bar(m.progress); } else { status(m.message); bar(null); } };
  async function run(source) {
    if (state.busy) return; state.busy = true; setState('추출 중...', 'badge-warn');
    try {
      const r = typeof source === 'string' ? await transcribeLocalPath(source, { language: language(), onStatus }) : await transcribeFile(source, { language: language(), onStatus });
      state.segments = r.segments; state.engine = r.engine; bar(null);
      if (!r.segments.length) { setState('음성 없음', 'badge-danger'); status('음성을 찾지 못했습니다. 대본을 직접 붙여넣어 주세요.'); return; }
      setState(`원본 대본 ${r.segments.length}줄 ✓`, 'badge-success'); status(`브라우저 Whisper 로 원본 음성을 그대로 받아 적었습니다 (${r.engine}). 아래에서 확인·수정할 수 있습니다.`);
      const ta = el('text'); if (ta) ta.value = r.segments.map((s) => `[${fmt(s.start)}] ${s.text}`).join('\n');
    } catch (err) { bar(null); state.segments = null; setState('추출 실패', 'badge-danger'); status(`브라우저 대본 추출 실패: ${err.message} → 대본을 붙여넣거나 프로그램 버전(서버 whisper)을 사용하세요.`); }
    finally { state.busy = false; }
  }
  const redo = el('redo'); if (redo) redo.onclick = () => { if (state.file) run(state.file); else if (state.localPath) run(state.localPath); else status('먼저 파일을 올리거나 선택해주세요.'); };
  return {
    state,
    fromFile(file) { state.file = file; state.localPath = null; return run(file); },
    fromLocalPath(p) { state.localPath = p; state.file = null; return run(p); },
    // 요청 본문에 넣을 값. 사용자가 텍스트를 고쳤으면 텍스트가 우선
    payload() {
      const text = (el('text')?.value || '').trim();
      const fromSegs = state.segments ? state.segments.map((s) => `[${fmt(s.start)}] ${s.text}`).join('\n') : '';
      if (text && text !== fromSegs) return { transcriptText: text };
      if (state.segments && state.segments.length) return { transcript: state.segments.map((s) => ({ ...s })), transcriptEngine: state.engine };
      if (text) return { transcriptText: text };
      return {};
    },
  };
}

export function exactBadge(exact) { return exact === true ? '<span class="badge badge-success" title="원본 음성/스크립트를 그대로 받아 적은 자막">원본 대본 그대로</span>' : exact === false ? '<span class="badge badge-warn" title="원본 대본을 구하지 못해 추정한 자막">대본 추정</span>' : ''; }
function fmt(sec) { const s = Math.max(0, Number(sec) || 0); const m = Math.floor(s / 60); const r = s - m * 60; return `${String(m).padStart(2, '0')}:${r.toFixed(1).padStart(4, '0')}`; }
function round(n) { return Math.round((Number(n) || 0) * 100) / 100; }
