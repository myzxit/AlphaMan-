// 자동 저장 + 복구 + 오프라인 대응: 편집 변경을 지연 저장하고(저장 중/완료/실패 상태 표시), 브라우저 종료·새로고침·네트워크 끊김에도
// localStorage 초안으로 마지막 상태를 보존한 뒤 네트워크 복구 시 동기화한다.
import { toast } from './ui.js';

const DRAFT_PREFIX = 'am_draft:';

export function createAutosave({ key, save, delay = 1500, statusEl = null, enabled = true, onRecovered = null }) {
  let timer = null; let pending = null; let state = 'idle'; let lastSavedAt = null; let queued = false;
  const setStatus = (s, extra = '') => {
    state = s;
    const el = typeof statusEl === 'function' ? statusEl() : statusEl;
    if (!el) return;
    const label = { idle: lastSavedAt ? `저장됨 ${time(lastSavedAt)}` : (enabled ? '자동 저장 켜짐' : '자동 저장 꺼짐 (Ctrl+S 로 저장)'), dirty: enabled ? '변경됨 · 자동 저장 대기' : '저장되지 않은 변경 사항 (Ctrl+S)', saving: '저장 중...', saved: `저장 완료 ${time(lastSavedAt)}`, failed: `저장 실패 · ${extra || '다시 시도합니다'}`, offline: '오프라인 · 로컬에 임시 저장됨' }[s] || '';
    el.textContent = label; el.className = `autosave-status ${s}`;
  };
  const draftKey = `${DRAFT_PREFIX}${key}`;
  const writeDraft = (data) => { try { localStorage.setItem(draftKey, JSON.stringify({ at: Date.now(), data })); } catch { /* 용량 초과 등 */ } };
  const clearDraft = () => { try { localStorage.removeItem(draftKey); } catch { /* ignore */ } };
  const readDraft = () => { try { const raw = localStorage.getItem(draftKey); return raw ? JSON.parse(raw) : null; } catch { return null; } };
  async function flush() {
    if (!pending) return true;
    const data = pending; pending = null; setStatus('saving');
    try { await save(data); lastSavedAt = Date.now(); clearDraft(); setStatus('saved'); setTimeout(() => { if (state === 'saved') setStatus('idle'); }, 4000); return true; }
    catch (err) {
      if (!navigator.onLine || /네트워크|Failed to fetch/.test(err.message)) { setStatus('offline'); queued = true; pending = data; return false; }
      setStatus('failed', err.message); pending = data; toast(`자동 저장 실패: ${err.message}`, 'error', 5000); return false;
    }
  }
  const api = {
    // 변경 알림: 초안을 즉시 로컬에 남기고 지연 저장
    change(data) { pending = data; writeDraft(data); if (!enabled) { setStatus('dirty'); return; } setStatus('dirty'); clearTimeout(timer); timer = setTimeout(flush, delay); },
    flush() { clearTimeout(timer); return flush(); },
    get state() { return state; },
    refresh() { setStatus(state); },
    hasPending: () => Boolean(pending),
    draft: readDraft, clearDraft,
    destroy() { clearTimeout(timer); window.removeEventListener('online', onOnline); window.removeEventListener('beforeunload', onUnload); },
  };
  const onOnline = () => { if (queued || pending) { queued = false; toast('네트워크가 복구되어 변경 사항을 동기화합니다.'); flush(); } };
  const onUnload = (e) => { if (pending) { writeDraft(pending); e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('online', onOnline); window.addEventListener('beforeunload', onUnload);
  // 복구: 이전 세션의 초안이 있으면 알려준다
  const d = readDraft();
  if (d && onRecovered) onRecovered(d);
  setStatus('idle');
  return api;
}
function time(ts) { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }

// 온라인/오프라인 배너
export function initOfflineBanner() {
  const bar = document.createElement('div'); bar.className = 'offline-bar hidden'; bar.setAttribute('role', 'status'); bar.textContent = '📴 오프라인 상태입니다. 편집 내용은 이 기기에 임시 저장되고, 연결이 복구되면 동기화됩니다.';
  document.body.appendChild(bar);
  const update = () => bar.classList.toggle('hidden', navigator.onLine);
  window.addEventListener('online', () => { update(); toast('온라인 상태로 돌아왔습니다.'); }); window.addEventListener('offline', update); update();
}
