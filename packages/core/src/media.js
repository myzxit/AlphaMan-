// 미디어 어댑터: ffmpeg/ffprobe/yt-dlp/whisper 가 설치된 환경(특히 프로그램 버전)에서는 실제 도구를 호출하고,
// 없으면 메타데이터 추정과 시뮬레이션으로 동작한다. 파일 업로드 검증 규칙은 알파컷 원본 동작을 그대로 따른다.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ApiError } from './errors.js';

const SUPPORTED_EXT = ['.mp4', '.mov', '.webm', '.m4v', '.mkv', '.avi'];
const RECOMMENDED = ['MP4', 'MOV', 'WebM'];

export function which(bin) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  return r.stdout.split(/\r?\n/)[0].trim() || null;
}

export function toolAvailability() {
  return {
    ffmpeg: Boolean(which('ffmpeg')),
    ffprobe: Boolean(which('ffprobe')),
    ytdlp: Boolean(which('yt-dlp')),
    whisper: Boolean(which('whisper') || which('whisper-cpp') || which('main')),
  };
}

export function parseYoutubeUrl(input) {
  const s = String(input || '').trim();
  if (!s) throw new ApiError(400, '링크를 입력해주세요.');
  let url;
  try { url = new URL(s.startsWith('http') ? s : `https://${s}`); } catch { throw new ApiError(400, '올바른 유튜브 링크를 입력해주세요. 예: https://www.youtube.com/watch?v=...'); }
  const host = url.hostname.replace(/^www\.|^m\./, '');
  let id = null;
  if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0];
  else if (host.endsWith('youtube.com')) {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else if (url.pathname.startsWith('/shorts/') || url.pathname.startsWith('/live/') || url.pathname.startsWith('/embed/')) id = url.pathname.split('/')[2];
  }
  if (!id || !/^[A-Za-z0-9_-]{6,}$/.test(id)) throw new ApiError(400, '올바른 유튜브 링크를 입력해주세요. 예: https://www.youtube.com/watch?v=...');
  return { id, url: `https://www.youtube.com/watch?v=${id}`, platform: 'youtube' };
}

export function parseVideoUrl(input) {
  const s = String(input || '').trim();
  try { return parseYoutubeUrl(s); } catch { /* fallthrough */ }
  let url;
  try { url = new URL(s); } catch { throw new ApiError(400, '지원하지 않는 영상 링크입니다. YouTube, TikTok, Instagram Reels 링크를 입력해주세요.'); }
  const host = url.hostname.replace(/^www\./, '');
  if (host.includes('tiktok.com')) {
    // 픽셀링 공지: TikTok 응답 방식 변경으로 일부 영상 다운로드가 일시적으로 불가능
    return { platform: 'tiktok', url: s, id: url.pathname.split('/').filter(Boolean).pop(), notice: 'TikTok의 영상 응답 방식 변경으로 현재 일부 영상 다운로드가 일시적으로 불가능합니다. 영상 링크나 사용자 환경의 문제가 아니며, 다운로드 도구에서 대응되는 대로 반영하겠습니다.' };
  }
  if (host.includes('instagram.com')) return { platform: 'instagram', url: s, id: url.pathname.split('/').filter(Boolean).pop() };
  throw new ApiError(400, '지원하지 않는 영상 링크입니다. YouTube, TikTok, Instagram Reels 링크를 입력해주세요.');
}

// 브라우저/서버 공통 파일 검증 규칙 (알파컷 업로드 오류 메시지 기준)
export function validateVideoMeta(meta) {
  const { filename = '', mimeType = '', durationSec, width, height, hasVideoTrack = true, hasAudioTrack = true, codec = '' } = meta;
  const ext = path.extname(filename).toLowerCase();
  if (ext && !SUPPORTED_EXT.includes(ext)) throw new ApiError(400, `${ext.replace('.', '').toUpperCase()} 형식은 지원되지 않습니다. MP4로 변환 후 업로드해주세요.`);
  if (/hevc|h265|hvc1/i.test(codec)) throw new ApiError(400, '이 브라우저에서는 HEVC(H.265) 영상을 지원하지 않습니다. MP4(H.264)로 변환 후 업로드해주세요.');
  if (mimeType && !/^video\//.test(mimeType)) throw new ApiError(400, '이 비디오 형식은 브라우저에서 지원되지 않습니다. MP4 형식을 권장합니다.');
  if (!hasVideoTrack) throw new ApiError(400, '영상 트랙이 없는 파일입니다. 영상이 포함된 파일을 업로드해주세요.');
  if (!hasAudioTrack) throw new ApiError(400, '음성 트랙이 없는 파일입니다. 음성이 포함된 영상을 업로드해주세요.');
  if (durationSec == null || !(durationSec > 0)) throw new ApiError(400, '비디오 길이를 추출할 수 없습니다. 파일이 손상되었을 수 있습니다.');
  if (!(width > 0 && height > 0)) throw new ApiError(400, '비디오 해상도를 가져올 수 없습니다.');
  return { ok: true, ext, recommended: RECOMMENDED };
}

// 서버리스: 파일이 다른 인스턴스의 /tmp 에만 있을 수 있다. 원격 저장소(Vercel Blob) 사본이 있으면 내려받아 같은 경로에 둔다.
export async function ensureLocalFile(rec) {
  if (!rec) return null;
  const p = rec.path;
  if (p && fs.existsSync(p)) return p;
  if (rec.remoteUrl && p) {
    try {
      const res = await fetch(rec.remoteUrl, { signal: AbortSignal.timeout(60000) });
      if (res.ok) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, Buffer.from(await res.arrayBuffer())); return p; }
    } catch (err) { console.warn('[media] 원격 파일 내려받기 실패:', err.message); }
  }
  return p;
}

// 유튜브 원본 내려받기 (yt-dlp 가 있는 환경: 프로그램 버전 · 자체 호스팅). 실제 렌더링·프레임 추출·음원 분리에 사용
export async function downloadYoutube(videoId, outDir, { maxHeight = 1080 } = {}) {
  if (!which('yt-dlp')) return null;
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `${videoId}.mp4`);
  if (fs.existsSync(out) && fs.statSync(out).size > 0) return out;
  await run('yt-dlp', ['-f', `bv*[height<=${maxHeight}][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b`, '--merge-output-format', 'mp4', '--no-playlist', '--no-warnings', '-o', out, `https://www.youtube.com/watch?v=${videoId}`]);
  return fs.existsSync(out) ? out : null;
}

// 음원 분리 (demucs 가 있으면 목소리만 남긴 wav 를 돌려준다 → 효과음·배경음 실제 제거)
export async function separateVocals(input, outDir) {
  if (!which('demucs') || !input || !fs.existsSync(input)) return null;
  try {
    fs.mkdirSync(outDir, { recursive: true });
    await run('demucs', ['--two-stems=vocals', '-n', 'htdemucs', '-o', outDir, input]);
    const base = path.parse(input).name;
    const found = walk(outDir).find((f) => f.endsWith(`${path.sep}${base}${path.sep}vocals.wav`));
    return found || null;
  } catch (err) { console.warn('[media] demucs 실패:', err.message); return null; }
}
function walk(dir) { let out = []; for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) out = out.concat(walk(p)); else out.push(p); } return out; }

export async function probe(filePath) {
  if (!fs.existsSync(filePath)) throw new ApiError(404, '비디오 파일을 로드할 수 없습니다.');
  if (which('ffprobe')) {
    const out = await run('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath]).catch(() => null);
    if (out) {
      try {
        const j = JSON.parse(out);
        const v = j.streams.find((s) => s.codec_type === 'video');
        const a = j.streams.find((s) => s.codec_type === 'audio');
        return {
          durationSec: Number(j.format?.duration) || Number(v?.duration) || 0,
          width: v?.width || 0, height: v?.height || 0,
          codec: v?.codec_name || '', hasVideoTrack: Boolean(v), hasAudioTrack: Boolean(a),
          fps: v?.r_frame_rate ? evalFps(v.r_frame_rate) : 30,
          probedBy: 'ffprobe',
        };
      } catch { /* fallthrough */ }
    }
  }
  // ffprobe가 없으면 파일 크기로 길이를 추정 (약 1.2MB/s 기준). 실제 도구를 설치하면 정확한 값이 나온다.
  const size = fs.statSync(filePath).size;
  const ext = path.extname(filePath).toLowerCase();
  return {
    durationSec: Math.max(10, Math.round(size / (1.2 * 1024 * 1024))),
    width: 1920, height: 1080, codec: ext === '.webm' ? 'vp9' : 'h264',
    hasVideoTrack: true, hasAudioTrack: true, fps: 30, probedBy: 'estimate',
  };
}

function evalFps(s) {
  const [a, b] = s.split('/').map(Number);
  return b ? Math.round((a / b) * 100) / 100 : a;
}

export function run(bin, args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err || `${bin} exit ${code}`))));
  });
}

// 유튜브 메타데이터: yt-dlp 가 있으면 실제 조회, 없으면 oEmbed(네트워크) → 실패 시 기본값
export async function fetchYoutubeMeta(videoId) {
  if (which('yt-dlp')) {
    try {
      const out = await run('yt-dlp', ['-J', '--no-warnings', `https://www.youtube.com/watch?v=${videoId}`]);
      const j = JSON.parse(out);
      return { title: j.title, durationSec: j.duration, channel: j.uploader || j.channel, thumbnail: j.thumbnail, source: 'yt-dlp', language: j.language || 'ko', chapters: (j.chapters || []).map((c) => ({ start: c.start_time, end: c.end_time, title: c.title })), tags: j.tags || [], description: j.description || '' };
    } catch { /* fallthrough */ }
  }
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const j = await res.json();
      return { title: j.title, durationSec: null, channel: j.author_name, thumbnail: j.thumbnail_url, source: 'oembed', language: 'ko' };
    }
  } catch { /* offline */ }
  return { title: `YouTube 영상 ${videoId}`, durationSec: null, channel: '알 수 없는 채널', thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, source: 'fallback', language: 'ko' };
}

// 실제 클립 렌더링 (프로그램 버전/ffmpeg 설치 환경). ffmpeg 이 없으면 렌더 계획(JSON)만 남긴다.
// hookAudio: 첫 3초 AI 후킹 보이스 파일(있으면 앞에 섞고 원본은 덕킹) · vocalsPath: demucs 로 분리한 목소리 트랙(있으면 원본 오디오 대신 사용)
export async function renderClip({ input, output, start, end, ratio = '9:16', subtitlePath, speedUp = 1, outro = null, hookAudio = null, vocalsPath = null }) {
  const dims = ratio === '9:16' ? '1080:1920' : ratio === '1:1' ? '1080:1080' : ratio === '4:5' ? '1080:1350' : '1920:1080';
  const [w, h] = dims.split(':');
  const filters = [`scale=${w}:${h}:force_original_aspect_ratio=increase`, `crop=${w}:${h}`, 'setsar=1'];
  if (subtitlePath) filters.push(`subtitles='${subtitlePath.replace(/'/g, "\\'")}'`);
  if (speedUp !== 1) filters.push(`setpts=PTS/${speedUp}`);
  let args;
  const useVocals = vocalsPath && fs.existsSync(vocalsPath);
  const useHook = hookAudio && fs.existsSync(hookAudio);
  if (outro && outro.durationSec > 0 || useVocals || useHook) {
    if (!(outro && outro.durationSec > 0)) outro = { text: '', durationSec: 0 };
    // 마무리 구독 카드: 클립 뒤에 CTA 카드(검정 배경 + 큰 글씨 + 무음)를 이어 붙인다
    const text = String(outro.text || '구독 · 좋아요 · 알림 설정').replace(/[\\':]/g, ' ');
    const d = Math.max(0.1, outro.durationSec || 0.1);
    const inputs = ['-ss', String(start), '-to', String(end), '-i', input];
    let audioSrc = '[0:a]asetpts=PTS-STARTPTS[a0]';
    let idx = 1;
    if (useVocals) { inputs.push('-ss', String(start), '-to', String(end), '-i', vocalsPath); audioSrc = `[${idx}:a]asetpts=PTS-STARTPTS[a0]`; idx += 1; }
    if (useHook) { inputs.push('-i', hookAudio); audioSrc = `${audioSrc.replace('[a0]', '[abase]')};[${idx}:a]asetpts=PTS-STARTPTS[ahook];[abase][ahook]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=300[aduck];[aduck][ahook]amix=inputs=2:duration=first:dropout_transition=0[a0]`; idx += 1; }
    const fc = `[0:v]${filters.join(',')}[v0];${audioSrc};color=c=0x111111:s=${w}x${h}:d=${d}:r=30,drawtext=text='${text}':fontcolor=white:fontsize=${Math.round(Number(h) / 16)}:x=(w-text_w)/2:y=(h-text_h)/2,drawbox=x=(iw-${Math.round(Number(w) * 0.4)})/2:y=ih*0.62:w=${Math.round(Number(w) * 0.4)}:h=${Math.round(Number(h) / 14)}:color=0xff0033@1:t=fill,drawtext=text='구독':fontcolor=white:fontsize=${Math.round(Number(h) / 24)}:x=(w-text_w)/2:y=h*0.62+${Math.round(Number(h) / 60)}[v1];anullsrc=r=48000:cl=stereo,atrim=0:${d},asetpts=PTS-STARTPTS[a1];[v0][a0][v1][a1]concat=n=2:v=1:a=1[vo][ao]`;
    args = ['-y', ...inputs, '-filter_complex', fc, '-map', '[vo]', '-map', '[ao]', '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', output];
  } else {
    args = ['-y', '-ss', String(start), '-to', String(end), '-i', input, '-vf', filters.join(','), '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', output];
  }
  if (!which('ffmpeg')) return { rendered: false, plan: { bin: 'ffmpeg', args } };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  await run('ffmpeg', args);
  return { rendered: true, output };
}

export const constants = { SUPPORTED_EXT, RECOMMENDED };
