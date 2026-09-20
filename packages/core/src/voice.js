// 내 목소리 TTS: 사용자가 아무 말이나 녹음한 음성 샘플을 올리면 음성 프로필을 만들고, 그 목소리로 후킹 멘트·내레이션을 합성한다.
// 제공자 우선순위: ElevenLabs(ELEVENLABS_API_KEY) → 로컬 Coqui XTTS(`tts` CLI) → 시뮬레이션(합성 계획만 저장, 두 버전 모두 오프라인 동작)
import fs from 'node:fs';
import path from 'node:path';
import { ApiError } from './errors.js';
import { probe, which, run, ensureLocalFile } from './media.js';
import { edgeSynthesize, edgeTtsAvailable } from './edgetts.js';
import { googleSynthesize, googleTtsAvailable } from './freetts.js';

const MIN_SAMPLE_SEC = 5;
const MAX_SAMPLE_SEC = 600;
const AUDIO_EXT = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.webm', '.mp4', '.mov'];

export const VOICE_STYLES = [
  { id: 'natural', name: '자연스럽게', speed: 1.0, pitch: 0 },
  { id: 'hook', name: '후킹 (빠르고 강하게)', speed: 1.12, pitch: 1 },
  { id: 'calm', name: '차분한 내레이션', speed: 0.95, pitch: -1 },
  { id: 'energetic', name: '에너지 넘치게', speed: 1.08, pitch: 2 },
];

// 무료 한국어 TTS 목소리 카탈로그. 서버에 edge-tts(무료 Microsoft 신경망 음성 CLI)가 있으면 실제 MP3 를 만들고,
// 없으면 브라우저 내장 음성(Web Speech API, 무료)으로 같은 성격의 한국어 목소리를 재생한다. 두 버전(웹/프로그램) 모두 추가 비용 없음.
export const FREE_VOICES = [
  // ── 한국어 기본 (Microsoft 신경망 음성 · 브라우저 내장 음성 대응) ──
  { id: 'ko-sunhi', name: '선희', lang: 'ko-KR', gender: 'female', tone: '밝고 또렷한 진행자', edge: 'ko-KR-SunHiNeural', rate: 1, pitch: 0, browserHint: ['Yuna', 'Google 한국의', 'Heami', 'SunHi'], sampleText: '안녕하세요! 오늘 영상 끝까지 보시면 진짜 도움 되실 거예요.' },
  { id: 'ko-injoon', name: '인준', lang: 'ko-KR', gender: 'male', tone: '차분한 내레이션', edge: 'ko-KR-InJoonNeural', rate: 1, pitch: 0, browserHint: ['InJoon', 'Google 한국의', 'Minsu'], sampleText: '이 영상에서는 핵심만 세 가지로 정리해 드립니다.' },
  { id: 'ko-hyunsu', name: '현수', lang: 'ko-KR', gender: 'male', tone: '젊고 활기찬', edge: 'ko-KR-HyunsuMultilingualNeural', rate: 1, pitch: 0, browserHint: ['Hyunsu', 'Google 한국의'], sampleText: '아직도 이거 모르셨어요? 지금 바로 알려드릴게요!' },
  { id: 'ko-bongjin', name: '봉진', lang: 'ko-KR', gender: 'male', tone: '뉴스 앵커 톤', edge: 'ko-KR-BongJinNeural', rate: 1, pitch: 0, browserHint: ['BongJin', 'Google 한국의'], sampleText: '오늘의 핵심 내용을 지금부터 전해드리겠습니다.' },
  { id: 'ko-gookmin', name: '국민', lang: 'ko-KR', gender: 'male', tone: '친근한 이웃', edge: 'ko-KR-GookMinNeural', rate: 1, pitch: 0, browserHint: ['GookMin', 'Google 한국의'], sampleText: '자, 그럼 같이 한번 살펴볼까요?' },
  { id: 'ko-jimin', name: '지민', lang: 'ko-KR', gender: 'female', tone: '상냥한 안내', edge: 'ko-KR-JiMinNeural', rate: 1, pitch: 0, browserHint: ['JiMin', 'Yuna', 'Google 한국의'], sampleText: '준비되셨나요? 천천히 따라오시면 됩니다.' },
  { id: 'ko-seohyeon', name: '서현', lang: 'ko-KR', gender: 'female', tone: '또박또박 강의', edge: 'ko-KR-SeoHyeonNeural', rate: 1, pitch: 0, browserHint: ['SeoHyeon', 'Heami', 'Google 한국의'], sampleText: '첫째, 둘째, 셋째. 이 순서만 기억하세요.' },
  { id: 'ko-soonbok', name: '순복', lang: 'ko-KR', gender: 'female', tone: '따뜻한 중년', edge: 'ko-KR-SoonBokNeural', rate: 1, pitch: 0, browserHint: ['SoonBok', 'Google 한국의'], sampleText: '오늘도 찾아와 주셔서 고마워요. 편하게 들어보세요.' },
  { id: 'ko-yujin', name: '유진', lang: 'ko-KR', gender: 'female', tone: '발랄한 쇼츠', edge: 'ko-KR-YuJinNeural', rate: 1, pitch: 0, browserHint: ['YuJin', 'Google 한국의', 'Yuna'], sampleText: '3초만요! 이거 보고 가세요!' },
  // ── 한국어 스타일 변형 (같은 음성 + 속도/높낮이 프리셋) ──
  { id: 'ko-sunhi-news', name: '선희 · 뉴스', lang: 'ko-KR', gender: 'female', tone: '정확한 뉴스 리포트', edge: 'ko-KR-SunHiNeural', rate: 0.98, pitch: -1, browserHint: ['Yuna', 'Google 한국의', 'Heami'], sampleText: '지금 이 순간, 가장 중요한 소식을 전해드립니다.' },
  { id: 'ko-sunhi-story', name: '선희 · 동화 낭독', lang: 'ko-KR', gender: 'female', tone: '느리고 부드러운 낭독', edge: 'ko-KR-SunHiNeural', rate: 0.88, pitch: 1, browserHint: ['Yuna', 'Google 한국의'], sampleText: '옛날 옛적, 작은 마을에 한 아이가 살고 있었어요.' },
  { id: 'ko-injoon-docu', name: '인준 · 다큐', lang: 'ko-KR', gender: 'male', tone: '묵직한 다큐멘터리', edge: 'ko-KR-InJoonNeural', rate: 0.92, pitch: -2, browserHint: ['InJoon', 'Google 한국의'], sampleText: '그날, 모든 것이 바뀌기 시작했습니다.' },
  { id: 'ko-hyunsu-fast', name: '현수 · 쇼츠 빠르게', lang: 'ko-KR', gender: 'male', tone: '빠른 템포 쇼츠', edge: 'ko-KR-HyunsuMultilingualNeural', rate: 1.18, pitch: 1, browserHint: ['Hyunsu', 'Google 한국의'], sampleText: '자 바로 갑니다, 딱 세 가지만 기억하세요!' },
  { id: 'ko-yujin-ad', name: '유진 · 광고', lang: 'ko-KR', gender: 'female', tone: '경쾌한 광고 멘트', edge: 'ko-KR-YuJinNeural', rate: 1.08, pitch: 2, browserHint: ['YuJin', 'Google 한국의'], sampleText: '지금 바로 확인하세요, 놓치면 후회합니다!' },
  { id: 'ko-jimin-asmr', name: '지민 · 속삭임', lang: 'ko-KR', gender: 'female', tone: '조용한 ASMR 톤', edge: 'ko-KR-JiMinNeural', rate: 0.85, pitch: -1, browserHint: ['JiMin', 'Google 한국의'], sampleText: '조용히, 천천히 들어보세요. 마음이 편안해질 거예요.' },
  { id: 'ko-bongjin-sports', name: '봉진 · 스포츠 중계', lang: 'ko-KR', gender: 'male', tone: '박진감 넘치는 중계', edge: 'ko-KR-BongJinNeural', rate: 1.15, pitch: 2, browserHint: ['BongJin', 'Google 한국의'], sampleText: '슛! 들어갑니다! 경기가 뒤집혔습니다!' },
  { id: 'ko-gookmin-variety', name: '국민 · 예능 리액션', lang: 'ko-KR', gender: 'male', tone: '웃음 섞인 예능 톤', edge: 'ko-KR-GookMinNeural', rate: 1.06, pitch: 2, browserHint: ['GookMin', 'Google 한국의'], sampleText: '아니 이게 말이 돼요? 진짜 대박이네요!' },
  { id: 'ko-seohyeon-lecture', name: '서현 · 강의', lang: 'ko-KR', gender: 'female', tone: '차분한 강의·설명', edge: 'ko-KR-SeoHyeonNeural', rate: 0.95, pitch: 0, browserHint: ['SeoHyeon', 'Google 한국의'], sampleText: '이 개념은 두 단계로 나눠서 이해하면 쉽습니다.' },
  { id: 'ko-soonbok-warm', name: '순복 · 힐링', lang: 'ko-KR', gender: 'female', tone: '포근한 힐링 내레이션', edge: 'ko-KR-SoonBokNeural', rate: 0.9, pitch: 0, browserHint: ['SoonBok', 'Google 한국의'], sampleText: '오늘 하루도 정말 수고 많으셨어요.' },
  // ── 다국어 (번역 자막·해외 채널용) ──
  { id: 'en-jenny', name: 'Jenny', lang: 'en-US', gender: 'female', tone: 'English · friendly', edge: 'en-US-JennyNeural', rate: 1, pitch: 0, browserHint: ['Samantha', 'Google US English', 'Jenny', 'Zira'], sampleText: 'Stick around until the end, this one is worth it.' },
  { id: 'en-guy', name: 'Guy', lang: 'en-US', gender: 'male', tone: 'English · energetic', edge: 'en-US-GuyNeural', rate: 1, pitch: 0, browserHint: ['Guy', 'Google US English', 'Daniel', 'David'], sampleText: 'Here are the three things you need to know.' },
  { id: 'en-aria', name: 'Aria', lang: 'en-US', gender: 'female', tone: 'English · narrator', edge: 'en-US-AriaNeural', rate: 0.96, pitch: 0, browserHint: ['Aria', 'Google US English', 'Samantha'], sampleText: 'Let me walk you through it, step by step.' },
  { id: 'ja-nanami', name: 'Nanami (七海)', lang: 'ja-JP', gender: 'female', tone: '日本語 · 明るい', edge: 'ja-JP-NanamiNeural', rate: 1, pitch: 0, browserHint: ['Kyoko', 'Google 日本語', 'Nanami', 'Haruka'], sampleText: '最後まで見てくださいね。今日は三つのポイントです。' },
  { id: 'ja-keita', name: 'Keita (圭太)', lang: 'ja-JP', gender: 'male', tone: '日本語 · 落ち着いた', edge: 'ja-JP-KeitaNeural', rate: 1, pitch: 0, browserHint: ['Otoya', 'Google 日本語', 'Keita', 'Ichiro'], sampleText: 'この動画では、要点だけを簡潔にお伝えします。' },
  { id: 'zh-xiaoxiao', name: 'Xiaoxiao (晓晓)', lang: 'zh-CN', gender: 'female', tone: '中文 · 亲切', edge: 'zh-CN-XiaoxiaoNeural', rate: 1, pitch: 0, browserHint: ['Tingting', 'Google 普通话', 'Xiaoxiao', 'Huihui'], sampleText: '大家好，今天给大家讲三个重点。' },
  { id: 'zh-yunxi', name: 'Yunxi (云希)', lang: 'zh-CN', gender: 'male', tone: '中文 · 活力', edge: 'zh-CN-YunxiNeural', rate: 1, pitch: 0, browserHint: ['Google 普通话', 'Yunxi', 'Kangkang'], sampleText: '别走开，最后有惊喜。' },
];
export const DEFAULT_FREE_VOICE = 'ko-sunhi';

export class VoiceService {
  constructor({ store, outputDir }) {
    this.store = store;
    this.outputDir = outputDir;
  }

  providers() {
    return {
      elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY),
      xtts: Boolean(which('tts')),
      edge: Boolean(which('edge-tts')),
      edgeNode: this._edgeNode === true,   // Node 내장 Edge TTS (네트워크 허용 시)
      google: this._google === true,       // Google 번역 읽어주기 (네트워크 허용 시, 언어당 1 목소리)
      browser: true, // 브라우저 내장 음성(Web Speech API) - 항상 무료
      ffmpeg: Boolean(which('ffmpeg')),
    };
  }

  _freeEngine() { return which('edge-tts') ? 'edge-tts' : this._edgeNode ? 'edge' : this._google ? 'google' : 'browser'; }
  freeVoices() { return FREE_VOICES.map((v) => ({ ...v, engine: this._freeEngine() })); }
  // 실제 음성 파일을 만들 수 있는 무료 엔진을 한 번 탐색해 둔다 (서버 시작 시 백그라운드)
  async detectFreeEngines() {
    if (this._detected) return { edgeNode: this._edgeNode, google: this._google };
    this._detected = true;
    [this._edgeNode, this._google] = await Promise.all([edgeTtsAvailable().catch(() => false), googleTtsAvailable().catch(() => false)]);
    return { edgeNode: this._edgeNode, google: this._google };
  }
  freeVoice(id) { return FREE_VOICES.find((v) => v.id === id) || null; }

  // 등록한 내 목소리 샘플 파일 (들어보기용)
  sampleFile(userId, id) {
    const v = this.get(userId, id);
    if (!v.samplePath || !fs.existsSync(v.samplePath)) {
      if (v.sampleUrl) return { redirect: v.sampleUrl }; // 원격 저장소에 보관된 샘플
      throw new ApiError(404, '샘플 파일이 더 이상 서버에 없습니다.');
    }
    return { path: v.samplePath, mime: v.samplePath.endsWith('.wav') ? 'audio/wav' : v.samplePath.endsWith('.mp4') || v.samplePath.endsWith('.m4a') ? 'audio/mp4' : 'audio/mpeg', filename: v.sampleFilename };
  }

  // 후킹/내레이션에 쓸 목소리 결정: 내 프로필 > 선택한 무료 목소리 > 기본 무료 목소리(선희)
  resolve(userId, { voiceProfileId = null, voiceId = null } = {}) {
    if (voiceProfileId) { const p = this.get(userId, voiceProfileId); return { kind: 'profile', id: p.id, label: `${p.name} (내 목소리)`, engine: p.engine }; }
    const fv = this.freeVoice(voiceId) || this.freeVoice(DEFAULT_FREE_VOICE);
    return { kind: 'free', id: fv.id, label: `${fv.name} (무료 · ${fv.tone})`, engine: this._freeEngine() };
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
      await ensureLocalFile(up);
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
    // 서버리스(웹사이트 버전)에서는 로컬 파일이 사라지므로 샘플을 원격 저장소(Vercel Blob)에도 저장해 프로필이 영구 보관되게 한다
    let sampleUrl = null;
    if (this.store.remote?.putFile) {
      try { sampleUrl = await this.store.remote.putFile(`voice/${userId}/${Date.now()}${path.extname(samplePath) || '.wav'}`, fs.readFileSync(samplePath), samplePath.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg'); }
      catch (err) { console.warn('[voice] 샘플 원격 저장 실패 (로컬만 유지):', err.message); }
    }
    const profile = this.store.insert('voiceProfiles', {
      userId, name: (name || `내 목소리 ${this.list(userId).length + 1}`).slice(0, 40), language, samplePath, sampleUrl, sampleFilename: filename,
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

  // 텍스트 → 음성. profileId(내 목소리) 또는 voiceId(무료 목소리). 결과: { audioPath|null, engine, durationSec, plan|browser }
  async synthesize(userId, { profileId = null, voiceId = null, text, style = 'natural', outputName = null }) {
    const clean = String(text || '').trim();
    if (!clean) throw new ApiError(400, '읽을 텍스트를 입력해주세요.');
    if (clean.length > 5000) throw new ApiError(400, '한 번에 5,000자까지 합성할 수 있습니다.');
    const st = VOICE_STYLES.find((s) => s.id === style) || VOICE_STYLES[0];
    const dir = path.join(this.outputDir, userId, 'voice');
    const out = path.join(dir, `${outputName || `tts-${Date.now()}`}.mp3`);
    const estimatedSec = Math.max(1, Math.round((clean.length / 5.5) / st.speed * 10) / 10); // 한국어 초당 약 5.5자
    if (!profileId) {
      // 무료 목소리
      const fv = this.freeVoice(voiceId) || this.freeVoice(DEFAULT_FREE_VOICE);
      const base = { profileId: null, voiceId: fv.id, voiceName: fv.name, text: clean, style: st.id, estimatedSec };
      const speed = st.speed * (fv.rate || 1); const pitchN = st.pitch + (fv.pitch || 0);
      const rate = `${speed >= 1 ? '+' : ''}${Math.round((speed - 1) * 100)}%`; const pitch = `${pitchN >= 0 ? '+' : ''}${pitchN * 2}Hz`;
      const browser = { lang: fv.lang || 'ko-KR', voiceHint: fv.browserHint, gender: fv.gender, rate: speed, pitch: 1 + pitchN * 0.08 };
      // ① edge-tts CLI ② Node 내장 Edge TTS ③ Google 번역 읽어주기 ④ 브라우저 음성 — 앞에서부터 되는 것을 쓴다
      if (which('edge-tts')) {
        try { fs.mkdirSync(dir, { recursive: true }); await run('edge-tts', ['--voice', fv.edge, '--rate', rate, '--pitch', pitch, '--text', clean, '--write-media', out]); return this._record(userId, { ...base, engine: 'edge-tts', audioPath: out, durationSec: estimatedSec, browser }); }
        catch (err) { console.warn('[voice] edge-tts CLI 실패:', err.message); }
      }
      if (!this._detected && process.env.ALPHAMAN_TTS_DETECT !== 'off') await this.detectFreeEngines().catch(() => {});
      if (this._edgeNode) {
        try { const mp3 = await edgeSynthesize({ text: clean, voice: fv.edge, rate, pitch }); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(out, mp3); return this._record(userId, { ...base, engine: 'edge', audioPath: out, durationSec: estimatedSec, browser }); }
        catch (err) { console.warn('[voice] Edge TTS 실패:', err.message); this._edgeNode = false; }
      }
      if (this._google) {
        try {
          const mp3 = await googleSynthesize({ text: clean, lang: (fv.lang || 'ko-KR').split('-')[0] });
          fs.mkdirSync(dir, { recursive: true });
          let finalPath = out.replace(/\.mp3$/, '.g.mp3'); fs.writeFileSync(finalPath, mp3);
          // 속도/높낮이 프리셋은 ffmpeg 이 있으면 적용
          if (which('ffmpeg') && (Math.abs(speed - 1) > 0.02 || pitchN !== 0)) { try { await run('ffmpeg', ['-y', '-i', finalPath, '-filter:a', `atempo=${Math.min(2, Math.max(0.5, speed))}${pitchN ? `,asetrate=24000*${(1 + pitchN * 0.03).toFixed(3)},aresample=24000` : ''}`, out]); finalPath = out; } catch { /* 원본 유지 */ } }
          return this._record(userId, { ...base, engine: 'google', audioPath: finalPath, durationSec: estimatedSec, browser, plan: { note: `Google 읽어주기 음성(${fv.lang || 'ko-KR'})으로 만든 MP3 입니다. 목소리 성격(${fv.name})은 브라우저 재생/edge-tts 에서 더 정확히 반영됩니다.` } });
        } catch (err) { console.warn('[voice] Google TTS 실패:', err.message); this._google = false; }
      }
      return this._record(userId, { ...base, engine: 'browser', audioPath: null, durationSec: estimatedSec, browser, plan: { note: '브라우저 내장 음성으로 재생됩니다. 서버가 인터넷에 연결되어 있거나 edge-tts 를 설치하면 MP3 파일도 생성됩니다.' } });
    }
    const profile = this.get(userId, profileId);
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
    const rec = this.store.insert('voiceRenders', { userId, ...data });
    // 서버리스: 음성 파일을 원격 저장소에도 올려 다른 인스턴스·재배포 후에도 재생되게 한다 (백그라운드)
    if (rec.audioPath && this.store.remote?.putFile && fs.existsSync(rec.audioPath)) {
      this._uploading = (this._uploading || Promise.resolve()).then(async () => {
        try { const url = await this.store.remote.putFile(`voice/${userId}/${rec.id}${path.extname(rec.audioPath)}`, fs.readFileSync(rec.audioPath), rec.audioPath.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg'); this.store.update('voiceRenders', rec.id, { audioUrl: url }); rec.audioUrl = url; }
        catch (err) { console.warn('[voice] 음성 파일 원격 저장 실패:', err.message); }
      });
    }
    return rec;
  }
  async flushUploads() { if (this._uploading) await this._uploading; }

  // 합성 결과 파일 (없으면 원격 URL 로 리다이렉트)
  renderFile(userId, id) {
    const rec = this.store.get('voiceRenders', id);
    if (!rec || rec.userId !== userId) throw new ApiError(404, '음성을 찾을 수 없습니다.');
    if (rec.audioPath && fs.existsSync(rec.audioPath)) return { path: rec.audioPath, mime: rec.audioPath.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg', filename: path.basename(rec.audioPath) };
    if (rec.audioUrl) return { redirect: rec.audioUrl };
    throw new ApiError(404, rec.engine === 'browser' ? '이 음성은 브라우저 내장 음성으로 재생됩니다 (파일 없음).' : '아직 실제 음성 파일이 생성되지 않았습니다.');
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
