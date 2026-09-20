// API 클라이언트: 웹 버전은 같은 오리진, 프로그램 버전은 Electron 이 알려준 내장 서버 주소를 사용한다.
const BASE = (window.alphaman && window.alphaman.apiBase) || '';
let token = null;
try { token = localStorage.getItem('am_token'); } catch { /* ignore */ }

export function getToken() { return token; }
// 토큰은 localStorage 와 쿠키 양쪽에 둔다: <img>/<video>/<audio> 태그가 인증이 필요한 스트림(썸네일·미리보기·목소리 샘플)을 바로 불러올 수 있도록
function syncCookie(t) { try { document.cookie = t ? `am_token=${encodeURIComponent(t)}; path=/; SameSite=Lax; max-age=${60 * 60 * 24 * 30}` : 'am_token=; path=/; max-age=0'; } catch { /* ignore */ } }
export function setToken(t) { token = t; try { if (t) localStorage.setItem('am_token', t); else localStorage.removeItem('am_token'); } catch { /* ignore */ } syncCookie(t); }
syncCookie(token);

export async function api(method, path, body, { raw = false, headers = {} } = {}) {
  const opts = { method, headers: { ...headers } };
  if (token) opts.headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) {
    if (body instanceof Blob || body instanceof ArrayBuffer) { opts.body = body; }
    else { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  }
  const res = await fetch(BASE + path, opts);
  if (raw) return res;
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const err = new Error((data && data.error) || `요청 실패 (${res.status})`);
    err.status = res.status; err.details = data && data.details;
    throw err;
  }
  return data;
}

export const get = (p) => api('GET', p);
export const post = (p, b) => api('POST', p, b);
export const put = (p, b) => api('PUT', p, b);
export const patch = (p, b) => api('PATCH', p, b);
export const del = (p) => api('DELETE', p);

export async function uploadFile(file, onProgress) {
  const max = window.AlphaManApp?.state?.info?.uploadMaxBytes;
  if (max && file.size > max) {
    const mb = Math.round(max / 1024 / 1024 * 10) / 10;
    return Promise.reject(new Error(`이 웹사이트 버전은 파일 업로드가 ${mb}MB 까지만 가능합니다 (${Math.round(file.size / 1024 / 1024)}MB). 영상 링크를 사용하거나, 프로그램(PC) 버전 또는 자체 호스팅에서는 2GB 까지 업로드할 수 있습니다.`));
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE}/api/upload`);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Content-Type', file.type || 'video/mp4');
    xhr.setRequestHeader('X-Filename', encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => { try { const d = JSON.parse(xhr.responseText); xhr.status < 400 ? resolve(d) : reject(new Error(d.error || '업로드 실패')); } catch { reject(new Error('업로드 실패')); } };
    xhr.onerror = () => reject(new Error('네트워크 오류가 발생했습니다.'));
    xhr.send(file);
  });
}

export function downloadUrl(path) { return BASE + path; }
