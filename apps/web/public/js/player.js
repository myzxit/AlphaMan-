// 미리보기 플레이어 (웹사이트 · 프로그램 공용)
// 렌더된 MP4 가 있으면 그대로 재생하고, 없으면 원본(유튜브 IFrame / 업로드·로컬 파일)을 타임라인(원본 구간 · 리플레이 · 슬로모션 · 카드)대로
// 이어서 재생하며 자막 · 후킹 · 챕터 카드를 화면에 겹쳐 그린다. 완성본과 같은 순서/길이/자막으로 결과를 확인할 수 있다.
import { get, downloadUrl, getToken } from './api.js';
import { esc, modal, fmtTime, toast } from './ui.js';

let ytApi = null;
function loadYoutubeApi() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (ytApi) return ytApi;
  ytApi = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev && prev(); resolve(window.YT); };
    const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; s.onerror = () => reject(new Error('유튜브 플레이어를 불러오지 못했습니다 (네트워크 확인).')); document.head.appendChild(s);
    setTimeout(() => reject(new Error('유튜브 플레이어 로딩 시간 초과')), 15000);
  });
  return ytApi;
}

// 미디어 어댑터: HTML5 <video> 와 유튜브 IFrame 을 같은 인터페이스로 다룬다
function html5Adapter(el) {
  return {
    ready: new Promise((resolve, reject) => { if (el.readyState >= 1) resolve(); el.onloadedmetadata = () => resolve(); el.onerror = () => reject(new Error('영상을 불러올 수 없습니다. 원본 파일이 서버에 없거나 코덱을 지원하지 않습니다.')); }),
    seek: (t) => { el.currentTime = t; }, play: () => el.play().catch(() => {}), pause: () => el.pause(), rate: (r) => { el.playbackRate = r; }, time: () => el.currentTime, mute: (m) => { el.muted = m; }, destroy: () => { el.pause(); el.removeAttribute('src'); el.load(); },
  };
}
async function youtubeAdapter(host, videoId) {
  const YT = await loadYoutubeApi();
  const div = document.createElement('div'); host.appendChild(div);
  let player; let readyResolve;
  const ready = new Promise((r) => { readyResolve = r; });
  player = new YT.Player(div, { videoId, width: '100%', height: '100%', playerVars: { controls: 0, rel: 0, modestbranding: 1, playsinline: 1, disablekb: 1, iv_load_policy: 3, origin: location.origin }, events: { onReady: () => readyResolve(), onError: () => toast('유튜브 영상을 재생할 수 없습니다 (비공개/삭제/퍼가기 제한).', 'error', 6000) } });
  return {
    ready, seek: (t) => player.seekTo(t, true), play: () => player.playVideo(), pause: () => player.pauseVideo(), rate: (r) => player.setPlaybackRate(Math.max(0.25, Math.min(2, r))), time: () => (player.getCurrentTime ? player.getCurrentTime() : 0), mute: (m) => (m ? player.mute() : player.unMute()), destroy: () => { try { player.destroy(); } catch { /* ignore */ } },
  };
}

// spec: { kind, ratio, durationSec, rendered, renderUrl, burnedSubtitles, source, items[], subtitles[], hook, chapters?, sfx?, narration? }
export async function mountPlayer(container, spec, { autoplay = false } = {}) {
  const ratio = spec.ratio && spec.ratio !== 'auto' ? spec.ratio : '16:9';
  container.innerHTML = `<div class="player r-${ratio.replace(':', '-')}"><div class="player-stage"><div class="player-media"></div><div class="player-card hidden"></div><div class="player-hook hidden"></div><div class="player-sub"></div><div class="player-kind hidden"></div><div class="player-loading">불러오는 중...</div></div>
    <div class="player-bar"><button class="btn btn-sm player-play">▶</button><div class="player-progress"><div class="player-buffer"></div><div class="player-fill"></div>${(spec.items || []).map((it) => `<div class="player-mark k-${esc(it.kind)}" style="left:${(it.newStart / (spec.durationSec || 1)) * 100}%;width:${Math.max(0.2, ((it.newEnd - it.newStart) / (spec.durationSec || 1)) * 100)}%" title="${esc(it.kind)} ${esc(it.title || '')}"></div>`).join('')}${(spec.chapters || []).map((c) => `<div class="player-chapter" style="left:${(c.at / (spec.durationSec || 1)) * 100}%" title="${esc(c.title)}"></div>`).join('')}</div><span class="player-time">00:00 / ${fmtTime(spec.durationSec)}</span><button class="btn btn-sm player-mute" title="음소거">🔊</button></div>
    <div class="tiny muted player-note"></div>`;
  const root = container.querySelector('.player'); const mediaHost = root.querySelector('.player-media');
  const subEl = root.querySelector('.player-sub'); const cardEl = root.querySelector('.player-card'); const hookEl = root.querySelector('.player-hook'); const kindEl = root.querySelector('.player-kind'); const loading = root.querySelector('.player-loading');
  const playBtn = root.querySelector('.player-play'); const fill = root.querySelector('.player-fill'); const timeEl = root.querySelector('.player-time'); const note = root.querySelector('.player-note');
  const items = (spec.items || []).slice().sort((a, b) => a.newStart - b.newStart);
  const total = spec.durationSec || (items.length ? items[items.length - 1].newEnd : 0) || 1;
  let media = null; let outT = 0; let playing = false; let raf = null; let cur = -1; let cardStartedAt = 0; let cardElapsed = 0; let lastTick = 0; let muted = false; let destroyed = false;
  const direct = spec.rendered && spec.renderUrl; // 렌더된 MP4 를 바로 재생

  try {
    if (direct) {
      const v = document.createElement('video'); v.playsInline = true; v.preload = 'metadata'; v.crossOrigin = 'anonymous';
      v.src = await authedUrl(spec.renderUrl); mediaHost.appendChild(v); media = html5Adapter(v);
      note.textContent = `렌더된 MP4 재생 중 · ${spec.burnedSubtitles ? '자막은 영상에 입혀져 있습니다' : '자막 미리보기 표시'}`;
    } else if (spec.source?.type === 'youtube') {
      media = await youtubeAdapter(mediaHost, spec.source.videoId);
      note.textContent = `유튜브 원본을 타임라인대로 이어 재생하는 미리보기입니다 · 항목 ${items.length}개 · 자막 ${(spec.subtitles || []).length}줄`;
    } else if (spec.source?.streamUrl) {
      const v = document.createElement('video'); v.playsInline = true; v.preload = 'metadata';
      v.src = await authedUrl(spec.source.streamUrl); mediaHost.appendChild(v); media = html5Adapter(v);
      note.textContent = `원본 파일을 타임라인대로 이어 재생하는 미리보기입니다 · 항목 ${items.length}개 · 자막 ${(spec.subtitles || []).length}줄`;
    } else {
      throw new Error('미리보기를 재생할 원본이 없습니다 (TikTok/Reels 링크는 프로그램 버전에서 yt-dlp 로 내려받은 뒤 미리 볼 수 있습니다).');
    }
    await media.ready;
  } catch (err) { loading.textContent = err.message; loading.classList.add('error'); return { destroy() {} }; }
  loading.classList.add('hidden');

  const itemAt = (t) => { let i = items.findIndex((it) => t >= it.newStart && t < it.newEnd); if (i < 0 && items.length && t >= items[items.length - 1].newEnd) i = items.length - 1; return i; };
  const enter = (i, t) => {
    cur = i; const it = items[i]; if (!it) return;
    kindEl.classList.toggle('hidden', it.kind === 'source'); kindEl.textContent = { replay: '↻ 하이라이트 리플레이', slowmo: '🐢 슬로모션', card: '🃏 카드' }[it.kind] || '';
    if (it.kind === 'card') {
      cardEl.classList.remove('hidden');
      // 마무리 구독 카드(CTA): 구독 버튼 · 좋아요 · 알림 아이콘을 실제 종료 화면처럼 보여준다
      cardEl.innerHTML = it.cta ? `<div class="player-cta"><div>${esc(it.title || '구독 · 좋아요 · 알림 설정')}</div><div class="cta-btn">▶ 구독${it.channel ? ` · ${esc(it.channel)}` : ''}</div><div class="cta-icons">👍 좋아요 &nbsp; 🔔 알림 설정 &nbsp; 💬 댓글</div></div>` : `<div>${esc(it.title || '')}</div>${it.section ? `<div class="tiny">${esc(it.section)}</div>` : ''}`;
      media.pause(); cardElapsed = t - it.newStart; cardStartedAt = performance.now();
    }
    else { cardEl.classList.add('hidden'); const speed = it.speed || 1; media.rate(speed); media.seek(it.start + (t - it.newStart) * speed); if (playing) media.play(); }
  };
  const drawOverlays = (t) => {
    const sub = (spec.subtitles || []).find((s) => t >= s.start && t < s.end);
    subEl.textContent = sub && !(direct && spec.burnedSubtitles) ? sub.text : '';
    const hookOn = spec.hook && t < (spec.hook.durationSec || 3);
    hookEl.classList.toggle('hidden', !hookOn); if (hookOn) hookEl.textContent = `🔥 ${spec.hook.text}`;
    fill.style.width = `${Math.min(100, (t / total) * 100)}%`; timeEl.textContent = `${fmtTime(t)} / ${fmtTime(total)}`;
  };
  const tick = () => {
    if (destroyed) return;
    if (direct) { outT = media.time(); drawOverlays(outT); if (playing) raf = requestAnimationFrame(tick); return; }
    const it = items[cur];
    if (it) {
      if (it.kind === 'card') { outT = it.newStart + cardElapsed + (playing ? (performance.now() - cardStartedAt) / 1000 : 0); if (outT >= it.newEnd) { if (cur + 1 < items.length) enter(cur + 1, items[cur + 1].newStart); else stop(); } }
      else { const mt = media.time(); outT = it.newStart + (mt - it.start) / (it.speed || 1); if (mt >= it.end - 0.05 || outT >= it.newEnd) { if (cur + 1 < items.length) enter(cur + 1, items[cur + 1].newStart); else stop(); } }
    }
    drawOverlays(outT);
    if (playing) raf = requestAnimationFrame(tick);
  };
  const play = () => { playing = true; playBtn.textContent = '⏸'; if (direct) media.play(); else { if (cur < 0) enter(itemAt(outT) < 0 ? 0 : itemAt(outT), outT); const it = items[cur]; if (it?.kind === 'card') { cardStartedAt = performance.now(); } else media.play(); } cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); };
  const pause = () => { playing = false; playBtn.textContent = '▶'; media.pause(); const it = items[cur]; if (it?.kind === 'card') cardElapsed = outT - it.newStart; cancelAnimationFrame(raf); drawOverlays(outT); };
  const stop = () => { pause(); outT = direct ? media.time() : total; drawOverlays(outT); };
  const seekTo = (t) => { outT = Math.max(0, Math.min(total, t)); if (direct) { media.seek(outT); drawOverlays(outT); return; } const i = Math.max(0, itemAt(outT)); enter(i, outT); if (!playing) media.pause(); drawOverlays(outT); };
  playBtn.onclick = () => (playing ? pause() : play());
  root.querySelector('.player-progress').onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(); seekTo(((e.clientX - r.left) / r.width) * total); };
  root.querySelector('.player-mute').onclick = (e) => { muted = !muted; media.mute(muted); e.target.textContent = muted ? '🔇' : '🔊'; };
  root.querySelector('.player-stage').onclick = (e) => { if (e.target.closest('.player-bar')) return; playing ? pause() : play(); };
  if (!direct) { enter(0, 0); media.pause(); }
  drawOverlays(0);
  if (autoplay) play();
  return { play, pause, seekTo, destroy() { destroyed = true; cancelAnimationFrame(raf); try { media.destroy(); } catch { /* ignore */ } } };
}

// 인증이 필요한 스트림 URL: 프로그램/웹 모두 Bearer 토큰을 쿠키로도 보내므로 <video src> 에 그대로 쓸 수 있게 토큰 쿠키를 심는다
async function authedUrl(url) {
  const t = getToken();
  if (t) document.cookie = `am_token=${encodeURIComponent(t)}; path=/; SameSite=Lax`;
  return downloadUrl(url);
}

// 모달로 미리보기 열기. specOrRef: 스펙 객체 또는 { kind, refId } / { libraryId }
export async function openPreview(specOrRef, { title = '미리보기' } = {}) {
  let spec = specOrRef;
  try {
    if (specOrRef.libraryId) spec = (await get(`/api/library/${specOrRef.libraryId}`)).preview;
    else if (specOrRef.refId && !specOrRef.items) spec = await get(`/api/preview/${specOrRef.kind}/${specOrRef.refId}`);
  } catch (err) { toast(err.message, 'error', 6000); return null; }
  let player = null;
  const m = modal('<div class="player-host"></div>', { title: spec.title || title, wide: true, onClose: () => player && player.destroy() });
  const host = m.el.querySelector('.player-host');
  player = await mountPlayer(host, spec, { autoplay: true });
  const exact = spec.transcriptExact;
  host.insertAdjacentHTML('beforeend', `<div class="chips" style="margin-top:8px"><span class="chip">${esc({ shorts: '쇼츠', remix: 'AI 재구성', longform: '롱폼 컷편집' }[spec.kind] || spec.kind)}</span><span class="chip">${esc(spec.ratio || '')}</span><span class="chip">${fmtTime(spec.durationSec)}</span><span class="chip">자막 ${(spec.subtitles || []).length}줄</span>${exact === true ? '<span class="chip" style="border-color:var(--success);color:var(--success)">원본 대본 그대로</span>' : exact === false ? '<span class="chip" style="border-color:var(--warn);color:var(--warn)">대본 추정 (정확하지 않음)</span>' : ''}${spec.rendered ? '<span class="chip">렌더된 MP4</span>' : '<span class="chip">타임라인 미리보기</span>'}</div>`);
  return { close: m.close, player };
}
