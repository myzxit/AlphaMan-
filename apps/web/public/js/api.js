// API 클라이언트: 웹 버전은 같은 오리진, 프로그램 버전은 Electron 이 알려준 내장 서버 주소를 사용한다.
const BASE = (window.alphaman && window.alphaman.apiBase) || '';
let token = null;
try { token = localStorage.getItem('am_token'); } catch { /* ignore */ }

export function getToken() { return token; }
export function setToken(t) { token = t; try { if (t) localStorage.setItem('am_token', t); else localStorage.removeItem('am_token'); } catch { /* ignore */ } }

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
