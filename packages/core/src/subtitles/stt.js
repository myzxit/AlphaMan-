// 음성 인식(STT): whisper(CLI)가 설치되어 있으면 실제 인식, 아니면 제목/설명 기반의 시뮬레이션 대본을 생성한다.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { which, run } from '../media.js';
import { parseSRT } from './format.js';

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

export async function transcribe({ filePath, durationSec, language = 'ko', title = '' }) {
  const whisper = which('whisper');
  if (whisper && filePath && fs.existsSync(filePath)) {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alphaman-stt-'));
    try {
      await run('whisper', [filePath, '--model', process.env.ALPHAMAN_WHISPER_MODEL || 'small', '--language', language, '--output_format', 'srt', '--output_dir', outDir]);
      const srt = fs.readdirSync(outDir).find((f) => f.endsWith('.srt'));
      if (srt) {
        const segs = parseSRT(fs.readFileSync(path.join(outDir, srt), 'utf8')).map((s, i) => ({ id: `seg-${i + 1}`, ...s, words: splitWords(s.text, s.start, s.end), speaker: 'A' }));
        return { engine: 'whisper', segments: segs };
      }
    } catch (err) {
      console.warn('[stt] whisper 실행 실패, 시뮬레이션으로 대체:', err.message);
    }
  }
  return { engine: 'simulated', segments: synthesizeTranscript({ durationSec, language, title }) };
}

// 의미 기반 분할: 문장 부호와 최대 글자 수/시간을 기준으로 자연스러운 자막 단위로 다시 나눈다.
export function semanticSplit(segments, { maxChars = 22, maxDuration = 4.5 } = {}) {
  const out = [];
  for (const seg of segments) {
    const words = seg.words?.length ? seg.words : splitWords(seg.text, seg.start, seg.end);
    let cur = [];
    const flush = () => {
      if (!cur.length) return;
      out.push({ id: `seg-${out.length + 1}`, start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map((w) => w.word).join(' '), words: cur, speaker: seg.speaker || 'A' });
      cur = [];
    };
    for (const w of words) {
      const nextLen = cur.reduce((s, x) => s + x.word.length + 1, 0) + w.word.length;
      const nextDur = cur.length ? w.end - cur[0].start : 0;
      if (cur.length && (nextLen > maxChars || nextDur > maxDuration)) flush();
      cur.push(w);
      if (/[.!?。？！]$/.test(w.word) || /[다요죠][.!?]?$/.test(w.word) && cur.length >= 3) flush();
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
