// 보관함: 내가 만든 영상(쇼츠 · AI 재구성 · 롱폼 컷편집)을 모아 미리보기 · 다운로드 · 즐겨찾기 · 삭제
import { get, patch, del, downloadUrl, getToken } from './api.js';
import { esc, html, raw, toast, confirmDialog, fmtTime, fmtDate, qs, qsa, on } from './ui.js';
import { openPreview } from './player.js';
import { exactBadge } from './transcript.js';

const auth = (fn) => Object.assign(fn, { requiresAuth: true });
const KIND_LABEL = { shorts: '✂️ 쇼츠', remix: '🪄 AI 재구성', longform: '🎬 롱폼 컷편집' };

export const library = auth(async ({ view, params, navigate }) => {
  const filters = { kind: params.kind || '', favorite: params.favorite || '', q: params.q || '' };
  const { items, stats } = await get(`/api/library?kind=${encodeURIComponent(filters.kind)}&favorite=${encodeURIComponent(filters.favorite)}&q=${encodeURIComponent(filters.q)}`);
  const link = (f) => `#/library?${new URLSearchParams({ ...filters, ...f }).toString()}`;
  view.innerHTML = html`<div class="row row-between"><div><h1>📁 보관함</h1><p class="muted">내가 만든 영상이 모두 여기에 저장됩니다. ▶ 미리보기로 완성본을 바로 확인하고, MP4 로 저장하거나 SNS 에 올리세요.</p></div></div>
    <div class="grid grid-4">${raw([['전체', stats.total, link({ kind: '', favorite: '' }), !filters.kind && !filters.favorite], ['쇼츠', stats.byKind.shorts, link({ kind: 'shorts', favorite: '' }), filters.kind === 'shorts'], ['AI 재구성', stats.byKind.remix, link({ kind: 'remix', favorite: '' }), filters.kind === 'remix'], ['롱폼 컷편집', stats.byKind.longform, link({ kind: 'longform', favorite: '' }), filters.kind === 'longform']].map(([t, n, h, active]) => `<a class="card entry-card ${active ? 'active' : ''}" href="${h}" style="${active ? 'border-color:var(--primary)' : ''}"><div class="muted small">${esc(t)}</div><div style="font-size:1.6rem;font-weight:900">${n}</div></a>`).join(''))}</div>
    <div class="row" style="margin:14px 0;gap:8px;flex-wrap:wrap"><a class="chip ${filters.favorite ? 'active' : ''}" href="${link({ favorite: filters.favorite ? '' : '1' })}">★ 즐겨찾기 ${stats.favorites}</a><span class="chip">총 ${fmtTime(stats.totalDurationSec)}</span><span class="chip">렌더된 MP4 ${stats.rendered}개</span><form id="lib-search" class="row" style="gap:6px;margin-left:auto"><input id="lib-q" placeholder="제목 · 원본 · 태그 검색" value="${filters.q}" style="max-width:260px" /><button class="btn btn-sm" type="submit">검색</button></form></div>
    ${items.length ? raw(`<div class="grid grid-4 library-grid">${items.map(card).join('')}</div>`) : raw('<div class="card"><h3>아직 보관된 영상이 없습니다</h3><p class="muted">쇼츠 스튜디오 · AI 재구성 · 롱폼 컷편집에서 영상을 만들면 완료되는 즉시 여기에 자동으로 저장됩니다.</p><div class="row"><a class="btn btn-primary" href="#/studio">쇼츠 만들기</a><a class="btn" href="#/remix">AI 재구성</a><a class="btn" href="#/longform">롱폼 컷편집</a></div></div>')}`;
  qs('#lib-search').onsubmit = (e) => { e.preventDefault(); navigate(link({ q: qs('#lib-q').value.trim() })); };
  on(view, 'click', '[data-preview]', (e, t) => openPreview({ libraryId: t.dataset.preview }));
  on(view, 'click', '[data-fav]', async (e, t) => { const it = items.find((x) => x.id === t.dataset.fav); try { await patch(`/api/library/${it.id}`, { favorite: !it.favorite }); it.favorite = !it.favorite; t.textContent = it.favorite ? '★' : '☆'; t.classList.toggle('active', it.favorite); } catch (err) { toast(err.message, 'error'); } });
  on(view, 'click', '[data-rename]', async (e, t) => { const it = items.find((x) => x.id === t.dataset.rename); const title = prompt('새 제목', it.title); if (title && title !== it.title) { try { await patch(`/api/library/${it.id}`, { title }); navigate(`${link({})}&r=${Date.now()}`); } catch (err) { toast(err.message, 'error'); } } });
  on(view, 'click', '[data-remove]', async (e, t) => { if (!(await confirmDialog('보관함에서 뺄까요? (원본 작업은 남습니다)'))) return; try { await del(`/api/library/${t.dataset.remove}`); t.closest('.library-card').remove(); toast('보관함에서 제거했습니다.'); } catch (err) { toast(err.message, 'error'); } });
  on(view, 'click', '[data-download]', async (e, t) => {
    const it = items.find((x) => x.id === t.dataset.download);
    try {
      const res = await fetch(downloadUrl(`/api/library/${it.id}/video?download=1`), { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || '다운로드 실패'); }
      const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = `${it.title.replace(/[\\/:*?"<>|]+/g, '_')}.mp4`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (err) { toast(err.message, 'error', 6000); }
  });
  on(view, 'click', '[data-publish]', (e, t) => navigate(`/publish?clip=${t.dataset.publish}`));
});

function card(it) {
  const thumb = it.thumbnail ? `background-image:url('${esc(it.thumbnail)}')` : '';
  const r = (it.ratio || '16:9').replace(':', '-');
  return `<div class="card library-card" data-id="${it.id}">
    <div class="clip-preview r-${r}" style="${thumb};cursor:pointer;max-height:260px" data-preview="${it.id}" title="미리보기"><div class="library-play">▶</div><div class="zoom">${fmtTime(it.durationSec)}</div>${it.rendered ? '<div class="hook" style="right:auto">MP4</div>' : ''}</div>
    <div><div class="row row-between" style="align-items:flex-start"><b style="line-height:1.3">${esc(it.title)}</b><button class="btn btn-sm btn-ghost ${it.favorite ? 'active' : ''}" data-fav="${it.id}" title="즐겨찾기">${it.favorite ? '★' : '☆'}</button></div>
      <div class="tiny muted">${esc(KIND_LABEL[it.kind] || it.kind)} · ${esc(it.ratio || '')} · ${fmtDate(it.savedAt)}</div>
      <div class="tiny muted">원본: ${esc(it.sourceTitle || '-')}</div></div>
    <div class="chips">${it.subtitleCount ? `<span class="chip">자막 ${it.subtitleCount}줄</span>` : ''}${exactBadge(it.transcriptExact)}${it.extra?.reference ? '<span class="chip">참고 영상</span>' : ''}${it.extra?.targetMinutes ? `<span class="chip">${it.extra.targetMinutes}분 재구성</span>` : ''}${it.extra?.removedSec != null ? `<span class="chip">공백 ${it.extra.removedSec}초 제거</span>` : ''}</div>
    <div class="row" style="flex-wrap:wrap"><button class="btn btn-sm btn-primary" data-preview="${it.id}">▶ 미리보기</button>${it.rendered ? `<button class="btn btn-sm" data-download="${it.id}">MP4 저장</button>` : ''}<a class="btn btn-sm" href="${it.kind === 'shorts' ? `#/studio/${it.jobId}` : it.kind === 'remix' ? `#/remix/${it.refId}` : `#/longform/${it.refId}`}">작업 열기</a>${it.kind === 'shorts' ? `<button class="btn btn-sm" data-publish="${it.refId}">SNS 업로드</button>` : ''}<button class="btn btn-sm" data-rename="${it.id}">이름</button><button class="btn btn-sm btn-danger" data-remove="${it.id}">제거</button></div></div>`;
}
