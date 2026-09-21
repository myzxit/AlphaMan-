// 무료 TTS 백업 엔진: Google 번역 읽어주기 (외부 패키지 없이 HTTPS GET). 언어당 목소리는 하나지만 어디서나(서버리스 포함) 실제 MP3 를 만들어
// 미리보기·렌더링에 넣을 수 있다. 200자 제한이 있어 문장 단위로 나눠 받은 뒤 이어 붙인다. 실패하면 호출자가 브라우저 음성으로 대체한다.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const MAX = 180;

export function isGoogleTtsDisabled() { return process.env.ALPHAMAN_GOOGLE_TTS === 'off'; }

export function chunkText(text, max = MAX) {
  const out = [];
  for (const sentence of String(text).replace(/\s+/g, ' ').trim().split(/(?<=[.!?。？！\n])\s+/)) {
    let s = sentence.trim(); if (!s) continue;
    while (s.length > max) {
      let cut = s.lastIndexOf(' ', max); if (cut < max * 0.5) cut = max;
      out.push(s.slice(0, cut).trim()); s = s.slice(cut).trim();
    }
    if (s) out.push(s);
  }
  return out;
}

export async function googleSynthesize({ text, lang = 'ko', timeoutMs = 15000 }) {
  if (isGoogleTtsDisabled()) throw new Error('google tts disabled');
  const parts = chunkText(text);
  if (!parts.length) throw new Error('text required');
  const buffers = [];
  for (const part of parts) {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(lang)}&q=${encodeURIComponent(part)}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://translate.google.com/' }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`google tts ${res.status}`);
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('audio')) throw new Error(`google tts unexpected content-type ${ct}`);
    buffers.push(Buffer.from(await res.arrayBuffer()));
  }
  return Buffer.concat(buffers);
}

// 성공은 영구 캐시, 실패는 잠시만 캐시했다가 다시 확인한다 (서버리스 동결·일시적 네트워크 오류 대응)
let available = null; let failedAt = 0; export let googleLastError = null;
const RETRY_MS = 60_000;
export async function googleTtsAvailable() {
  if (isGoogleTtsDisabled()) return false;
  if (available === true) return true;
  if (available === false && Date.now() - failedAt < RETRY_MS) return false;
  try { const b = await googleSynthesize({ text: 'hello there', lang: 'en', timeoutMs: 8000 }); available = b.length > 300; if (!available) googleLastError = `too small (${b.length}B)`; else googleLastError = null; } catch (err) { available = false; googleLastError = err.message; }
  if (available === false) failedAt = Date.now();
  return available;
}
