// 내 목소리 TTS: 사용자가 아무 말이나 녹음한 음성 샘플을 올리면 음성 프로필을 만들고, 그 목소리로 후킹 멘트·내레이션을 합성한다.
// 제공자 우선순위: ElevenLabs(ELEVENLABS_API_KEY) → 로컬 Coqui XTTS(`tts` CLI) → 시뮬레이션(합성 계획만 저장, 두 버전 모두 오프라인 동작)
import fs from 'node:fs';
import path from 'node:path';
import { ApiError } from './errors.js';
import { probe, which, run } from './media.js';

const MIN_SAMPLE_SEC = 5;
const MAX_SAMPLE_SEC = 600;
const AUDIO_EXT = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.webm', '.mp4', '.mov'];

export const VOICE_STYLES = [
  { id: 'natural', name: '자연스럽게', speed: 1.0, pitch: 0 },
  { id: 'hook', name: '후킹 (빠르고 강하게)', speed: 1.12, pitch: 1 },
  { id: 'calm', name: '차분한 내레이션', speed: 0.95, pitch: -1 },
  { id: 'energetic', name: '에너지 넘치게', speed: 1.08, pitch: 2 },
];

export class VoiceService {
  constructor({ store, outputDir }) {
    this.store = store;
    this.outputDir = outputDir;
  }

  providers() {
    return {
      elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY),
      xtts: Boolean(which('tts')),
      ffmpeg: Boolean(which('ffmpeg')),
    };
  }

  list(userId) {
    return this.store.find('voiceProfiles', (v) => v.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(userId, id) {
    const v = this.store.get('voiceProfiles', id);
    if (!v || v.userId !== userId) throw new ApiError(404, '음성 프로필을 찾을 수 없습니다.');
    return v;
  }

  // 샘플 업로드 → 프로필 생성. consent: 본인 목소리(또는 허가받은 목소리)임을 확인
  async createProfile(userId, { uploadId, localPath, name, consent = false, language = 'ko' }) {
    if (!consent) throw new ApiError(400, '본인의 목소리(또는 사용 허가를 받은 목소리)임을 확인해주세요.');
    let samplePath; let filename;
    if (uploadId) {
      const up = this.store.get('uploads', uploadId);
      if (!up || up.userId !== userId) throw new ApiError(404, '업로드된 파일을 찾을 수 없습니다.');
      samplePath = up.path; filename = up.filename;
    } else if (localPath) {
      samplePath = localPath; filename = path.basename(localPath);
    } else throw new ApiError(400, '음성 샘플 파일을 올려주세요.');
    const ext = path.extname(filename).toLowerCase();
    if (!AUDIO_EXT.includes(ext)) throw new ApiError(400, `${ext.replace('.', '').toUpperCase()} 형식은 지원되지 않습니다. MP3, WAV, M4A 또는 영상 파일을 올려주세요.`);
    // 영상/압축 오디오 샘플은 ffmpeg 이 있으면 16kHz 모노 WAV 로 변환해 둔다 (음성 클론 엔진 입력용)
    if (ext !== '.wav' && which('ffmpeg')) {
      try {
        const dir = path.join(this.outputDir, userId, 'voice'); fs.mkdirSync(dir, { recursive: true });
        const wav = path.join(dir, `sample-${Date.now()}.wav`);
        await run('ffmpeg', ['-y', '-i', samplePath, '-vn', '-ac', '1', '-ar', '16000', '-t', String(MAX_SAMPLE_SEC), wav]);
        samplePath = wav;
      } catch (err) { console.warn('[voice] 샘플 변환 실패, 원본 사용:', err.message); }
    }
    const meta = await probeAudio(samplePath);
    if (meta.durationSec < MIN_SAMPLE_SEC) throw new ApiError(400, `음성 샘플은 최소 ${MIN_SAMPLE_SEC}초 이상이어야 합니다. 아무 말이나 10~60초 정도 녹음해 주세요.`);
    if (meta.durationSec > MAX_SAMPLE_SEC) throw new ApiError(400, '음성 샘플은 10분 이하로 올려주세요.');
    const providers = this.providers();
    const engine = providers.elevenlabs ? 'elevenlabs' : providers.xtts ? 'xtts' : 'simulated';
    const profile = this.store.insert('voiceProfiles', {
      userId, name: (name || `내 목소리 ${this.list(userId).length + 1}`).slice(0, 40), language, samplePath, sampleFilename: filename,
      sampleDurationSec: Math.round(meta.durationSec * 10) / 10, quality: meta.durationSec >= 30 ? 'good' : 'basic', engine, status: 'ready', externalVoiceId: null, consentAt: new Date().toISOString(),
      characteristics: analyzeCharacteristics(meta),
    });
    if (engine === 'elevenlabs') {
      try { const id = await elevenLabsClone(profile); this.store.update('voiceProfiles', profile.id, { externalVoiceId: id }); }
      catch (err) { this.store.update('voiceProfiles', profile.id, { engine: 'simulated', engineError: err.message }); }
    }
    return this.store.get('voiceProfiles', profile.id);
  }

  rename(userId, id, name) { this.get(userId, id); return this.store.update('voiceProfiles', id, { name: String(name).slice(0, 40) }); }
  remove(userId, id) { this.get(userId, id); return this.store.remove('voiceProfiles', id); }

  // 텍스트 → 내 목소리 음성. 결과: { audioPath|null, engine, durationSec, plan }
  async synthesize(userId, { profileId, text, style = 'natural', outputName = null }) {
    const profile = this.get(userId, profileId);
    const clean = String(text || '').trim();
    if (!clean) throw new ApiError(400, '읽을 텍스트를 입력해주세요.');
    if (clean.length > 5000) throw new ApiError(400, '한 번에 5,000자까지 합성할 수 있습니다.');
    const st = VOICE_STYLES.find((s) => s.id === style) || VOICE_STYLES[0];
    const dir = path.join(this.outputDir, userId, 'voice');
    const out = path.join(dir, `${outputName || `tts-${Date.now()}`}.mp3`);
    const estimatedSec = Math.max(1, Math.round((clean.length / 5.5) / st.speed * 10) / 10); // 한국어 초당 약 5.5자
    const base = { profileId, text: clean, style: st.id, estimatedSec, engine: profile.engine };
    if (profile.engine === 'elevenlabs' && profile.externalVoiceId) {
      try { fs.mkdirSync(dir, { recursive: true }); await elevenLabsSpeak(profile.externalVoiceId, clean, out, st); return this._record(userId, { ...base, audioPath: out, durationSec: estimatedSec }); }
      catch (err) { console.warn('[voice] ElevenLabs 합성 실패, 다음 제공자로:', err.message); }
    }
    if (which('tts')) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        const wav = out.replace(/\.mp3$/, '.wav');
        await run('tts', ['--model_name', 'tts_models/multilingual/multi-dataset/xtts_v2', '--speaker_wav', profile.samplePath, '--language_idx', profile.language, '--text', clean, '--out_path', wav]);
        let finalPath = wav;
        if (which('ffmpeg')) { await run('ffmpeg', ['-y', '-i', wav, '-filter:a', `atempo=${st.speed}`, out]); finalPath = out; }
        return this._record(userId, { ...base, engine: 'xtts', audioPath: finalPath, durationSec: estimatedSec });
      } catch (err) { console.warn('[voice] XTTS 합성 실패, 시뮬레이션으로:', err.message); }
    }
    return this._record(userId, { ...base, engine: 'simulated', audioPath: null, durationSec: estimatedSec, plan: { note: 'ELEVENLABS_API_KEY 또는 로컬 XTTS(tts CLI)를 설정하면 실제 음성 파일이 생성됩니다.', speakerSample: profile.samplePath, speed: st.speed, pitch: st.pitch } });
  }

  _record(userId, data) {
    return this.store.insert('voiceRenders', { userId, ...data });
  }

  renders(userId) { return this.store.find('voiceRenders', (r) => r.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50); }
}

async function probeAudio(filePath) {
  if (!fs.existsSync(filePath)) throw new ApiError(404, '음성 파일을 찾을 수 없습니다.');
  if (which('ffprobe')) {
    try {
      const out = await run('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath]);
      const j = JSON.parse(out);
      const a = j.streams.find((s) => s.codec_type === 'audio');
      if (!a) throw new ApiError(400, '음성 트랙이 없는 파일입니다. 목소리가 담긴 파일을 올려주세요.');
      return { durationSec: Number(j.format?.duration) || 0, sampleRate: Number(a.sample_rate) || 0, channels: a.channels || 1, codec: a.codec_name, probedBy: 'ffprobe' };
    } catch (err) { if (err instanceof ApiError) throw err; }
  }
  const size = fs.statSync(filePath).size;
  // WAV 는 헤더에서 정확한 길이를 읽는다 (브라우저 추출 샘플은 항상 16kHz 모노 WAV)
  try {
    const fd = fs.openSync(filePath, 'r'); const head = Buffer.alloc(Math.min(size, 4096)); fs.readSync(fd, head, 0, head.length, 0); fs.closeSync(fd);
    if (head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WAVE') {
      let off = 12; let fmt = null; let dataSize = null;
      while (off + 8 <= head.length) {
        const id = head.toString('ascii', off, off + 4); const len = head.readUInt32LE(off + 4);
        if (id === 'fmt ') fmt = { channels: head.readUInt16LE(off + 10), sampleRate: head.readUInt32LE(off + 12), bits: head.readUInt16LE(off + 22) };
        if (id === 'data') { dataSize = len || (size - off - 8); break; }
        off += 8 + len + (len % 2);
      }
      if (fmt && dataSize) return { durationSec: dataSize / (fmt.sampleRate * fmt.channels * (fmt.bits / 8)), sampleRate: fmt.sampleRate, channels: fmt.channels, codec: 'pcm', probedBy: 'wav-header' };
    }
  } catch { /* fallthrough */ }
  return { durationSec: Math.max(1, Math.round(size / (16 * 1024))), sampleRate: 44100, channels: 1, codec: 'unknown', probedBy: 'estimate' };
}

function analyzeCharacteristics(meta) {
  return { sampleRate: meta.sampleRate, channels: meta.channels, codec: meta.codec, probedBy: meta.probedBy, recommendation: meta.durationSec < 30 ? '30초 이상 샘플을 올리면 더 비슷한 목소리가 됩니다.' : '충분한 길이의 샘플입니다.' };
}

async function elevenLabsClone(profile) {
  const form = new FormData();
  form.append('name', `alphaman-${profile.id.slice(0, 8)}`);
  form.append('files', new Blob([fs.readFileSync(profile.samplePath)]), profile.sampleFilename);
  const res = await fetch('https://api.elevenlabs.io/v1/voices/add', { method: 'POST', headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY }, body: form, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`ElevenLabs 클론 실패 (${res.status})`);
  return (await res.json()).voice_id;
}

async function elevenLabsSpeak(voiceId, text, out, style) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST', headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.8, speed: style.speed } }), signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`ElevenLabs 합성 실패 (${res.status})`);
  fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
}
