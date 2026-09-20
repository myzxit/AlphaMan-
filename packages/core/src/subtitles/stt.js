// 음성 인식(STT): whisper(CLI)가 설치되어 있으면 실제 인식, 아니면 제목/설명 기반의 시뮬레이션 대본을 생성한다.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { which, run } from '../media.js';
import { parseSRT } from './format.js';
import { ApiError } from '../errors.js';

const SAMPLE_LINES = {
  ko: [
    '안녕하세요, 오늘은 정말 중요한 이야기를 준비했어요.', '이 부분은 꼭 끝까지 보셔야 해요.', '제가 직접 해보니까 결과가 완전히 달랐거든요.',
    '첫 번째 핵심은 바로 이겁니다.', '많은 분들이 여기서 실수를 하세요.', '그런데 놀라운 반전이 있었어요.', '이 방법을 쓰면 시간이 절반으로 줄어요.',
    '두 번째로 중요한 건 타이밍이에요.', '솔직히 처음엔 저도 믿지 않았어요.', '결과를 보고 정말 깜짝 놀랐습니다.', '마지막으로 이것만 기억하세요.',
    '댓글로 여러분의 경험도 알려주세요.', '이게 바로 사람들이 잘 모르는 비밀이에요.', '한 번만 따라 해보시면 바로 느끼실 거예요.', '자, 이제 진짜 핵심으로 들어갑니다.',
  ],
  en: [
    'Hey everyone, today I have something really important to share.', 'You need to watch this part until the end.', 'When I tried it myself the result was completely different.',
    'The first key point is this.', 'A lot of people make a mistake right here.', 'But then there was a surprising twist.', 'This method cuts the time in half.',
    'The second thing that matters is timing.', 'Honestly, I did not believe it at first either.', 'I was shocked when I saw the results.', 'Finally, just remember this one thing.',
  ],
};

export function synthesizeTranscript({ durationSec, language = 'ko', title = '' }) {
  const lines = SAMPLE_LINES[language] || SAMPLE_LINES.ko;
  const segments = [];
  let t = 0; let i = 0;
  while (t < durationSec) {
    const len = 2.5 + ((i * 7) % 5) * 0.7; // 2.5~5.3초
    const end = Math.min(durationSec, t + len);
    const text = i === 0 && title ? `${title} - ${lines[0]}` : lines[i % lines.length];
    segments.push({ id: `seg-${i + 1}`, start: round(t), end: round(end), text, words: splitWords(text, t, end), speaker: i % 9 === 4 ? 'B' : 'A' });
    // 무음 구간 시뮬레이션: 6번째마다 1.2초 공백
    t = end + (i % 6 === 5 ? 1.2 : 0.15);
    i += 1;
  }
  return segments;
}

export function splitWords(text, start, end) {
  const words = text.split(/\s+/).filter(Boolean);
  const dur = (end - start) / Math.max(1, words.length);
  return words.map((w, i) => ({ word: w, start: round(start + i * dur), end: round(start + (i + 1) * dur) }));
}

function round(n) { return Math.round(n * 100) / 100; }

export const SIMULATED_ALLOWED = () => process.env.ALPHAMAN_ALLOW_SIMULATED_STT === '1';

// 붙여넣은 대본 파싱: "0:00 텍스트", "[00:00] 텍스트", "00:00:00,000 --> ..." (SRT), 또는 타임스탬프 없는 줄글
export function parseTranscriptText(text, durationSec = 0) {
  const raw = String(text || '').replace(/\r/g, '').trim();
  if (!raw) return [];
  if (/-->/.test(raw)) return parseSRT(raw).map((s) => ({ start: s.start, end: s.end, text: s.text.replace(/\n/g, ' ').trim() })).filter((s) => s.text);
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const stamped = [];
  // [mm:ss] · mm:ss · h:mm:ss · [mm:ss.s] (브라우저 추출본) 모두 허용
  const re = /^\[?(\d{1,2}):(\d{2}(?:\.\d+)?)(?::(\d{2}(?:\.\d+)?))?\]?\s*(.*)$/;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re);
    if (!m) { if (stamped.length) stamped[stamped.length - 1].text += ` ${lines[i]}`; continue; }
    const t = round(m[3] != null ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : Number(m[1]) * 60 + Number(m[2]));
    let txt = m[4].trim();
    // 유튜브 "스크립트 표시" 복사 형식: 시간 줄 다음 줄에 텍스트
    if (!txt && lines[i + 1] && !re.test(lines[i + 1])) { txt = lines[i + 1].trim(); i += 1; }
    if (txt) stamped.push({ start: t, text: txt });
  }
  if (stamped.length) {
    return stamped.map((s, i) => ({ start: s.start, end: stamped[i + 1] ? stamped[i + 1].start : (durationSec > s.start ? Math.min(durationSec, s.start + 6) : s.start + 5), text: s.text }));
  }
  // 타임스탬프가 없으면 문장 길이에 비례해 전체 길이에 고르게 배치
  const sentences = raw.split(/(?<=[.!?。？！])\s+|\n/).map((x) => x.trim()).filter(Boolean);
  const totalChars = sentences.reduce((a, b) => a + b.length, 0) || 1;
  const D = durationSec > 0 ? durationSec : sentences.length * 4;
  let t = 0;
  return sentences.map((txt) => { const d = Math.max(1, (txt.length / totalChars) * D); const seg = { start: round(t), end: round(t + d), text: txt }; t += d; return seg; });
}

// 유튜브 json3 자막 포맷 → 세그먼트
export function parseJson3(json) {
  const events = (json?.events || []).filter((e) => e.segs && e.segs.some((x) => (x.utf8 || '').trim()));
  return events.map((e) => ({ start: round((e.tStartMs || 0) / 1000), end: round(((e.tStartMs || 0) + (e.dDurationMs || 3000)) / 1000), text: e.segs.map((x) => x.utf8).join('').replace(/\s+/g, ' ').trim() })).filter((s) => s.text);
}

// exact=true: 원본 대본 그대로(브라우저 Whisper · 붙여넣기 · whisper · 유튜브 자막). 의미 분할 시 줄을 최대한 원본대로 유지한다.
function normalizeSegments(segs, speaker = 'A', exact = true) {
  return segs.filter((s) => s && s.text && Number.isFinite(Number(s.start))).map((s, i) => {
    const start = round(Number(s.start)); const end = round(Math.max(start + 0.3, Number(s.end ?? start + 3)));
    const text = String(s.text).trim();
    return { id: `seg-${i + 1}`, start, end, text, words: s.words?.length ? s.words : splitWords(text, start, end), speaker: s.speaker || speaker, exact };
  });
}

// yt-dlp 로 유튜브 자막(업로드 자막 우선, 없으면 자동 생성 자막) 가져오기
async function fetchYoutubeCaptionsViaYtDlp(videoId, language) {
  if (!which('yt-dlp')) return null;
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alphaman-cap-'));
  try {
    const langs = [language, `${language}-orig`, 'ko', 'en', 'ja'].filter((x, i, a) => a.indexOf(x) === i).join(',');
    await run('yt-dlp', ['--skip-download', '--write-subs', '--write-auto-subs', '--sub-langs', langs, '--sub-format', 'json3', '--no-warnings', '-o', path.join(outDir, 'cap'), `https://www.youtube.com/watch?v=${videoId}`]);
    const files = fs.readdirSync(outDir).filter((f) => f.endsWith('.json3'));
    const pick = files.find((f) => f.includes(`.${language}.`)) || files.find((f) => f.includes(`.${language}-orig.`)) || files[0];
    if (!pick) return null;
    const segs = parseJson3(JSON.parse(fs.readFileSync(path.join(outDir, pick), 'utf8')));
    return segs.length ? { engine: 'youtube-captions', exact: true, segments: normalizeSegments(segs), captionFile: pick } : null;
  } catch (err) { console.warn('[stt] yt-dlp 자막 가져오기 실패:', err.message); return null; }
}

// 대본 확보 우선순위: ① 클라이언트가 보낸 대본(브라우저 Whisper / 붙여넣기) ② 서버 Whisper CLI ③ yt-dlp 유튜브 자막
// ④ (테스트·데모 전용, ALPHAMAN_ALLOW_SIMULATED_STT=1) 시뮬레이션. 그 외에는 가짜 대본을 만들지 않고 안내와 함께 실패한다.
export async function transcribe({ filePath, durationSec, language = 'ko', title = '', source = null, transcript = null, transcriptText = '' }) {
  if (Array.isArray(transcript) && transcript.length) return { engine: transcript.engine || 'client', exact: true, segments: normalizeSegments(transcript) };
  if (transcriptText && String(transcriptText).trim()) {
    const segs = parseTranscriptText(transcriptText, durationSec);
    if (segs.length) return { engine: 'pasted-transcript', exact: true, segments: normalizeSegments(segs) };
  }
  const whisper = which('whisper');
  if (whisper && filePath && fs.existsSync(filePath)) {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alphaman-stt-'));
    try {
      await run('whisper', [filePath, '--model', process.env.ALPHAMAN_WHISPER_MODEL || 'small', '--language', language, '--output_format', 'srt', '--output_dir', outDir]);
      const srt = fs.readdirSync(outDir).find((f) => f.endsWith('.srt'));
      if (srt) return { engine: 'whisper', exact: true, segments: normalizeSegments(parseSRT(fs.readFileSync(path.join(outDir, srt), 'utf8'))) };
    } catch (err) { console.warn('[stt] whisper 실행 실패:', err.message); }
  }
  if (source && source.videoId && (source.type === 'youtube' || source.platform === 'youtube')) {
    const cap = await fetchYoutubeCaptionsViaYtDlp(source.videoId, language);
    if (cap) return cap;
  }
  if (SIMULATED_ALLOWED()) return { engine: 'simulated', exact: false, segments: synthesizeTranscript({ durationSec, language, title }) };
  throw new ApiError(422, source && source.videoId
    ? '이 서버에서는 유튜브 링크의 대본을 가져올 수 없습니다. 유튜브 "스크립트 표시"에서 복사한 대본을 붙여넣거나, 영상 파일을 올리면(브라우저에서 대본 추출) 원본과 똑같은 자막이 됩니다. PC 프로그램 버전은 링크 대본을 자동으로 가져옵니다.'
    : '대본을 인식하지 못했습니다. 브라우저에서 대본 추출을 켜고 다시 시도하거나, 대본을 붙여넣어 주세요.');
}

// 의미 기반 분할: 문장 부호와 최대 글자 수/시간을 기준으로 자연스러운 자막 단위로 다시 나눈다.
export function semanticSplit(segments, { maxChars = 22, maxDuration = 4.5 } = {}) {
  const out = [];
  for (const seg of segments) {
    // 원본 대본 줄(exact)은 한 줄이 너무 길 때만 나눈다 → 자막이 원본 스크립트와 같은 줄 단위를 유지
    const limitChars = seg.exact ? Math.max(maxChars, 34) : maxChars; const limitDur = seg.exact ? Math.max(maxDuration, 8) : maxDuration;
    const words = seg.words?.length ? seg.words : splitWords(seg.text, seg.start, seg.end);
    let cur = [];
    const flush = () => {
      if (!cur.length) return;
      out.push({ id: `seg-${out.length + 1}`, start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map((w) => w.word).join(' '), words: cur, speaker: seg.speaker || 'A', ...(seg.exact ? { exact: true } : {}) });
      cur = [];
    };
    for (const w of words) {
      const nextLen = cur.reduce((s, x) => s + x.word.length + 1, 0) + w.word.length;
      const nextDur = cur.length ? w.end - cur[0].start : 0;
      if (cur.length && (nextLen > limitChars || (nextDur > limitDur && nextLen > limitChars / 2))) flush();
      cur.push(w);
      if (!seg.exact && (/[.!?。？！]$/.test(w.word) || /[다요죠][.!?]?$/.test(w.word) && cur.length >= 3)) flush();
    }
    flush();
  }
  return out;
}

// 파형(waveform) 데이터: ffmpeg 이 있으면 실제 PCM 피크, 없으면 대본 기반 가상 파형 (파형 기반 편집기용)
export async function waveform({ filePath, durationSec, segments = [], buckets = 600 }) {
  const peaks = new Array(buckets).fill(0.05);
  if (filePath && which('ffmpeg') && fs.existsSync(filePath)) {
    try {
      const raw = await run('ffmpeg', ['-v', 'quiet', '-i', filePath, '-ac', '1', '-ar', '4000', '-f', 's16le', '-']);
      const buf = Buffer.from(raw, 'binary');
      const samples = buf.length / 2;
      const per = Math.max(1, Math.floor(samples / buckets));
      for (let b = 0; b < buckets; b++) {
        let max = 0;
        for (let i = b * per; i < Math.min(samples, (b + 1) * per); i++) max = Math.max(max, Math.abs(buf.readInt16LE(i * 2)) / 32768);
        peaks[b] = Math.round(max * 100) / 100;
      }
      return { engine: 'ffmpeg', buckets, durationSec, peaks };
    } catch { /* fallthrough */ }
  }
  for (const s of segments) {
    const a = Math.floor((s.start / durationSec) * buckets);
    const b = Math.ceil((s.end / durationSec) * buckets);
    for (let i = a; i < Math.min(buckets, b); i++) peaks[i] = Math.round((0.35 + 0.5 * Math.abs(Math.sin(i * 0.9 + s.start))) * 100) / 100;
  }
  return { engine: 'simulated', buckets, durationSec, peaks };
}
