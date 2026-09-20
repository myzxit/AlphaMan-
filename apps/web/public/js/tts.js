// TTS 재생 도우미 (웹사이트 · 프로그램 공용): 무료 목소리 듣기(서버 edge-tts MP3 → 없으면 브라우저 내장 음성), 내 목소리 샘플 듣기, 합성 결과 재생
import { post, downloadUrl } from './api.js';
import { toast } from './ui.js';

let current = null; // 재생 중인 <audio>
function stopAll() { if (current) { try { current.pause(); } catch { /* ignore */ } current = null; } if (window.speechSynthesis) window.speechSynthesis.cancel(); }

// 브라우저 내장 음성 목록에서 힌트(이름)와 언어가 맞는 목소리를 고른다
export function pickBrowserVoice({ lang = 'ko-KR', voiceHint = [], gender = null } = {}) {
  if (!window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  const sameLang = voices.filter((v) => (v.lang || '').replace('_', '-').toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()));
  for (const hint of voiceHint) { const hit = sameLang.find((v) => v.name.toLowerCase().includes(String(hint).toLowerCase())); if (hit) return hit; }
  if (gender) { const g = sameLang.find((v) => new RegExp(gender === 'female' ? 'female|여성|woman|yuna|heami|nanami|kyoko|samantha|jenny|aria|zira|tingting' : 'male|남성|man|minsu|guy|daniel|david|otoya|keita|kangkang', 'i').test(v.name)); if (g) return g; }
  return sameLang[0] || null;
}
function voicesReady() { return new Promise((r) => { if (!window.speechSynthesis) return r(); if (window.speechSynthesis.getVoices().length) return r(); window.speechSynthesis.onvoiceschanged = () => r(); setTimeout(r, 800); }); }

export async function speakBrowser(text, browser = {}) {
  if (!window.speechSynthesis) throw new Error('이 브라우저는 내장 음성을 지원하지 않습니다.');
  await voicesReady();
  const u = new SpeechSynthesisUtterance(text);
  const v = pickBrowserVoice(browser);
  if (v) u.voice = v; u.lang = browser.lang || 'ko-KR'; u.rate = browser.rate || 1; u.pitch = browser.pitch || 1;
  window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
  return { voice: v ? v.name : null, lang: u.lang };
}

export function playUrl(url, { autoplay = true } = {}) {
  stopAll();
  const a = new Audio(downloadUrl(url)); a.crossOrigin = 'use-credentials';
  current = a; if (autoplay) a.play().catch((err) => toast(`재생 실패: ${err.message}`, 'error'));
  return a;
}

// 합성 결과(voiceRenders 레코드) 재생: 실제 파일이 있으면 파일, 브라우저 엔진이면 내장 음성
export async function playRender(r) {
  if (r.audioPath) return playUrl(`/api/voice/renders/${r.id}/audio`);
  if (r.engine === 'browser' && r.browser) { const info = await speakBrowser(r.text, r.browser); if (!info.voice) toast('이 기기에는 해당 언어의 내장 음성이 없어 기본 음성으로 읽습니다. (프로그램 버전 · edge-tts 설치 시 실제 MP3)', 'info', 6000); return info; }
  toast(r.plan?.note || '실제 음성 파일이 없습니다. ELEVENLABS_API_KEY / XTTS / edge-tts 를 설정하면 파일이 생성됩니다.', 'info', 6000);
  return null;
}

// 무료 목소리 듣기: 서버 합성(edge-tts 있으면 MP3) → 브라우저 음성
export async function listenFreeVoice(voiceId, catalog = [], text = null) {
  const v = catalog.find((x) => x.id === voiceId) || {};
  const sample = text || v.sampleText || '안녕하세요, 알파맨입니다. 이 목소리로 영상을 읽어드릴게요.';
  try {
    const r = await post('/api/voice/synthesize', { voiceId, text: sample, style: 'natural' });
    return playRender(r);
  } catch (err) {
    // 로그인 전이거나 서버 오류여도 브라우저 음성으로 미리 듣기
    try { return await speakBrowser(sample, { lang: v.lang || 'ko-KR', voiceHint: v.browserHint || [], gender: v.gender, rate: v.rate || 1, pitch: 1 + (v.pitch || 0) * 0.08 }); }
    catch (e2) { toast(`${err.message} / ${e2.message}`, 'error'); return null; }
  }
}

export function playProfileSample(profileId) { return playUrl(`/api/voice/profiles/${profileId}/sample`); }
export { stopAll };
