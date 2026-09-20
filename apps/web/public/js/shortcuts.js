// 키보드 단축키 (PC) + 도움말 창. 페이지는 window.AlphaManShortcuts 에 핸들러를 등록해 편집기 동작(저장·실행 취소·삭제·복사·붙여넣기)을 연결한다.
import { modal, esc } from './ui.js';

export const SHORTCUTS = [
  ['Space', '재생 / 일시정지 (플레이어·편집기)'], ['Ctrl + Z', '실행 취소'], ['Ctrl + Shift + Z', '다시 실행'], ['Ctrl + S', '저장'], ['Ctrl + C', '선택 항목 복사'], ['Ctrl + V', '붙여넣기'], ['Delete', '선택 항목 삭제'],
  ['← / →', '프레임 단위 이동 (플레이어)'], ['Shift + ← / →', '5초 이동'], ['F', '전체화면'], ['M', '음소거'], ['L', '반복 재생'], ['[ / ]', '구간 반복 시작/끝 지정'],
  ['Ctrl + K', '픽시 열기'], ['Alt + T', '알림'], ['Ctrl + B', '사이드바'], ['Ctrl + Shift + L', '테마 변경'], ['Ctrl + /', '전체 검색'], ['?', '단축키 도움말'], ['Esc', '창 닫기'],
];

const handlers = {}; // { save, undo, redo, delete, copy, paste, playPause, ... }
export function registerShortcuts(map) { Object.assign(handlers, map); return () => { for (const k of Object.keys(map)) if (handlers[k] === map[k]) delete handlers[k]; }; }
export function showShortcutHelp() {
  modal(`<div class="table-wrap"><table class="table">${SHORTCUTS.map(([k, d]) => `<tr><td style="white-space:nowrap"><span class="kbd">${esc(k)}</span></td><td>${esc(d)}</td></tr>`).join('')}</table></div><p class="tiny muted" style="margin-top:8px">설정 → 단축키에서 끌 수 있습니다.</p>`, { title: '⌨️ 키보드 단축키' });
}
function editing(e) { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); }

export function initShortcuts(getState) {
  document.addEventListener('keydown', (e) => {
    const st = getState();
    if (st.user?.prefs?.shortcuts === false) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    if (mod && k === '/') { e.preventDefault(); location.hash = '#/search'; return; }
    if (mod && !e.shiftKey && k.toLowerCase() === 's' && handlers.save) { e.preventDefault(); handlers.save(); return; }
    if (mod && k.toLowerCase() === 'z' && !editing(e)) { e.preventDefault(); if (e.shiftKey) handlers.redo?.(); else handlers.undo?.(); return; }
    if (mod && k.toLowerCase() === 'y' && !editing(e) && handlers.redo) { e.preventDefault(); handlers.redo(); return; }
    if (editing(e)) return;
    if (k === '?' ) { e.preventDefault(); showShortcutHelp(); return; }
    if (k === ' ' && handlers.playPause) { e.preventDefault(); handlers.playPause(); return; }
    if ((k === 'Delete' || k === 'Backspace') && handlers.delete) { e.preventDefault(); handlers.delete(); return; }
    if (mod && k.toLowerCase() === 'c' && handlers.copy) { e.preventDefault(); handlers.copy(); return; }
    if (mod && k.toLowerCase() === 'v' && handlers.paste) { e.preventDefault(); handlers.paste(); return; }
    if (k === 'ArrowLeft' && handlers.frame) { e.preventDefault(); handlers.frame(e.shiftKey ? -5 : -1 / 30); return; }
    if (k === 'ArrowRight' && handlers.frame) { e.preventDefault(); handlers.frame(e.shiftKey ? 5 : 1 / 30); return; }
    if (k.toLowerCase() === 'f' && handlers.fullscreen) { e.preventDefault(); handlers.fullscreen(); return; }
    if (k.toLowerCase() === 'm' && handlers.mute) { e.preventDefault(); handlers.mute(); return; }
    if (k.toLowerCase() === 'l' && handlers.loop) { e.preventDefault(); handlers.loop(); return; }
    if (k === '[' && handlers.loopA) { e.preventDefault(); handlers.loopA(); return; }
    if (k === ']' && handlers.loopB) { e.preventDefault(); handlers.loopB(); }
  });
}
