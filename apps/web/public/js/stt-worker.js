// 브라우저 Whisper 워커: transformers.js 로 원본 음성을 그대로 받아 적는다 (원본 영상과 똑같은 대본).
// 모델은 처음 한 번만 내려받아 브라우저 캐시에 저장된다.
let transformers = null; let transcriber = null; let loadedModel = null;

const CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.2/dist/transformers.min.js';

self.onmessage = async (e) => {
  const { id, audio, language = 'ko', model = 'Xenova/whisper-base', sampleRate = 16000 } = e.data;
  const post = (msg) => self.postMessage({ id, ...msg });
  try {
    if (!transformers) { post({ type: 'status', message: '음성 인식 엔진 불러오는 중...' }); transformers = await import(CDN); transformers.env.allowLocalModels = false; }
    if (!transcriber || loadedModel !== model) {
      post({ type: 'status', message: `Whisper 모델 준비 중 (${model.split('/').pop()})` });
      transcriber = await transformers.pipeline('automatic-speech-recognition', model, {
        progress_callback: (p) => { if (p.status === 'progress' && p.total) post({ type: 'download', file: p.file, progress: Math.round((p.loaded / p.total) * 100) }); },
      });
      loadedModel = model;
    }
    post({ type: 'status', message: '대본 받아 적는 중... (원본 음성 그대로)' });
    const totalSec = audio.length / sampleRate;
    const out = await transcriber(audio, { language, task: 'transcribe', return_timestamps: true, chunk_length_s: 30, stride_length_s: 5, force_full_sequences: false });
    const chunks = (out.chunks || []).map((c) => ({ start: Number(c.timestamp?.[0]) || 0, end: c.timestamp?.[1] == null ? null : Number(c.timestamp[1]), text: collapseRepeats(String(c.text || '').trim()) }))
      .filter((c) => c.text && !isSilent(audio, c.start, c.end ?? totalSec, sampleRate)); // 무음 구간의 환각(반복) 텍스트 제거
    // 마지막 청크의 끝 시간이 없으면 전체 길이로, 겹치는 시간은 정리
    for (let i = 0; i < chunks.length; i++) {
      if (chunks[i].end == null || !(chunks[i].end > chunks[i].start)) chunks[i].end = i + 1 < chunks.length ? chunks[i + 1].start : totalSec;
      if (i > 0 && chunks[i].start < chunks[i - 1].end) chunks[i].start = chunks[i - 1].end;
      if (!(chunks[i].end > chunks[i].start)) chunks[i].end = chunks[i].start + 0.5;
    }
    post({ type: 'done', segments: chunks, text: chunks.map((c) => c.text).join(' '), model });
  } catch (err) { post({ type: 'error', message: err.message || String(err) }); }
};

// Whisper 가 무음/잡음에서 같은 말을 반복하는 환각을 정리: 2~12자 구간이 3번 이상 연속 반복되면 한 번만 남긴다
function collapseRepeats(text) {
  let t = text;
  for (let i = 0; i < 3; i++) t = t.replace(/(.{2,12}?)\1{2,}/g, '$1');
  return t.replace(/\s+/g, ' ').trim();
}
function isSilent(audio, start, end, sr) {
  const a = Math.max(0, Math.floor(start * sr)); const b = Math.min(audio.length, Math.floor(end * sr));
  if (b - a < sr * 0.2) return false;
  let sum = 0; for (let i = a; i < b; i += 4) sum += audio[i] * audio[i];
  return Math.sqrt(sum / ((b - a) / 4)) < 0.004;
}
