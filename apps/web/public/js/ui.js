// 공용 UI 유틸: 템플릿 이스케이프, 토스트, 모달, 포맷터, 브라우저 측 파일 검증
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isRaw = (v) => v !== null && typeof v === 'object' && '__raw' in v;
export const html = (strings, ...vals) => strings.reduce((out, s, i) => out + s + (i < vals.length ? (isRaw(vals[i]) ? vals[i].__raw : Array.isArray(vals[i]) ? vals[i].map((v) => (isRaw(v) ? v.__raw : esc(v))).join('') : esc(vals[i])) : ''), '');
export const raw = (s) => ({ __raw: String(s) });

export function toast(msg, type = 'info', ms = 3000) {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = `toast ${type}`; el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

export function modal(content, { title = '', onClose = null, wide = false } = {}) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal"><div class="modal-box" ${wide ? 'style="max-width:820px"' : ''}><div class="row row-between" style="margin-bottom:12px"><h3>${esc(title)}</h3><button class="icon-btn" data-modal-close aria-label="닫기">✕</button></div><div class="modal-content"></div></div></div>`;
  root.querySelector('.modal-content').append(typeof content === 'string' ? Object.assign(document.createElement('div'), { innerHTML: content }) : content);
  const close = () => { root.innerHTML = ''; onClose && onClose(); };
  root.querySelector('[data-modal-close]').onclick = close;
  root.querySelector('.modal').addEventListener('click', (e) => { if (e.target.classList.contains('modal')) close(); });
  return { close, el: root.querySelector('.modal-content') };
}

export function confirmDialog(message) {
  return new Promise((resolve) => {
    const m = modal(`<p>${esc(message)}</p><div class="row" style="justify-content:flex-end"><button class="btn" data-no>취소</button><button class="btn btn-primary" data-yes>확인</button></div>`, { title: '확인' });
    m.el.querySelector('[data-no]').onclick = () => { m.close(); resolve(false); };
    m.el.querySelector('[data-yes]').onclick = () => { m.close(); resolve(true); };
  });
}

export function fmtTime(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const m = Math.floor(s / 60); const r = Math.floor(s % 60);
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}
export function creditsLabel(u) { return u && u.creditsUnlimited ? '무제한' : `${u ? u.credits : 0}분`; }
export function fmtNum(n) { return Number(n || 0).toLocaleString('ko-KR'); }
export function fmtDate(iso) { if (!iso) return '-'; const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
export function fmtKRW(n) { return `₩${fmtNum(n)}`; }
export function compactViews(n) { n = Number(n || 0); if (n >= 1e8) return `${(n / 1e8).toFixed(1)}억`; if (n >= 1e4) return `${(n / 1e4).toFixed(1)}만`; if (n >= 1e3) return `${(n / 1e3).toFixed(1)}천`; return String(n); }

// 브라우저 측 파일 메타데이터 추출 + 알파컷 검증 메시지
export function readVideoMeta(file) {
  return new Promise((resolve, reject) => {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!['mp4', 'mov', 'webm', 'm4v', 'mkv', 'avi'].includes(ext)) return reject(new Error(`${ext.toUpperCase()} 형식은 지원되지 않습니다. MP4로 변환 후 업로드해주세요.`));
    const v = document.createElement('video');
    v.preload = 'metadata';
    const url = URL.createObjectURL(file);
    const timer = setTimeout(() => { URL.revokeObjectURL(url); reject(new Error('비디오 메타데이터 로딩 시간 초과')); }, 15000);
    v.onloadedmetadata = () => {
      clearTimeout(timer);
      const meta = { filename: file.name, mimeType: file.type, durationSec: v.duration, width: v.videoWidth, height: v.videoHeight, hasVideoTrack: v.videoWidth > 0, hasAudioTrack: true, sizeBytes: file.size };
      try {
        const canvas = document.createElement('canvas'); canvas.width = 180; canvas.height = Math.round(180 * (v.videoHeight / v.videoWidth || 1.77));
        v.currentTime = Math.min(1, v.duration / 2);
        v.onseeked = () => { try { canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height); meta.thumbnail = canvas.toDataURL('image/jpeg', .7); } catch { /* 썸네일 생성 중 오류 - 무시 */ } URL.revokeObjectURL(url); resolve(meta); };
        setTimeout(() => { if (!meta.thumbnail) { URL.revokeObjectURL(url); resolve(meta); } }, 2500);
      } catch { URL.revokeObjectURL(url); resolve(meta); }
      if (!(v.duration > 0) || !Number.isFinite(v.duration)) reject(new Error('비디오 길이를 추출할 수 없습니다. 파일이 손상되었을 수 있습니다.'));
      if (!(v.videoWidth > 0)) reject(new Error(v.duration > 0 ? '영상 트랙이 없는 파일입니다. 영상이 포함된 파일을 업로드해주세요.' : '비디오 해상도를 가져올 수 없습니다.'));
    };
    v.onerror = () => {
      clearTimeout(timer); URL.revokeObjectURL(url);
      const code = v.error && v.error.code;
      if (code === 4) reject(new Error(ext === 'mov' || ext === 'mp4' ? '이 브라우저에서는 HEVC(H.265) 영상을 지원하지 않습니다. MP4(H.264)로 변환 후 업로드해주세요.' : '비디오 코덱이 지원되지 않거나 파일이 손상되었습니다. MP4, MOV, WebM 형식을 사용해주세요.'));
      else if (code === 3) reject(new Error('비디오 파일을 로드할 수 없습니다. 파일 형식이나 코덱을 확인해주세요.'));
      else if (code === 2) reject(new Error('비디오 로딩이 중단되었습니다.'));
      else reject(new Error(`비디오 파일을 로드할 수 없습니다. (에러 코드: ${code || '?'})`));
    };
    v.src = url;
  });
}

export function debounce(fn, ms = 300) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
export function qs(sel, root = document) { return root.querySelector(sel); }
export function qsa(sel, root = document) { return [...root.querySelectorAll(sel)]; }
export function on(root, event, selector, handler) { root.addEventListener(event, (e) => { const t = e.target.closest(selector); if (t && root.contains(t)) handler(e, t); }); }
