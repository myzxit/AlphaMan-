// 썸네일 자동 제작: ① 원본 영상 썸네일과 거의 비슷한 썸네일(원본 이미지 + 같은 구도의 큰 텍스트) ② 만든 영상에서 장면을 자동으로 골라(후킹 시점·핵심 문장·
// 유튜브 프레임·ffmpeg 프레임) 텍스트·그라데이션·배지를 입힌 썸네일. 결과는 SVG 로 조합해 두 버전(웹/프로그램) 모두 브라우저에서 PNG 로 저장할 수 있다.
import fs from 'node:fs';
import path from 'node:path';
import { ApiError } from './errors.js';
import { which, run } from './media.js';

export const THUMB_STYLES = [
  { id: 'original-like', name: '원본과 비슷하게', desc: '원본 썸네일 구도 그대로 + 하단 큰 텍스트' },
  { id: 'bold', name: '큰 텍스트', desc: '어두운 그라데이션 위에 2줄 큰 글씨' },
  { id: 'big-number', name: '숫자 강조', desc: '왼쪽에 거대한 숫자, 오른쪽 문구' },
  { id: 'split', name: '컬러 밴드', desc: '한쪽에 색 띠 + 흰 글씨 (정보·리뷰형)' },
  { id: 'minimal', name: '미니멀', desc: '작은 라벨 하나만 (브이로그·감성)' },
];
export const THUMB_PALETTES = { yellow: ['#ffd400', '#111111'], red: ['#ff3b3b', '#ffffff'], white: ['#ffffff', '#111111'], mint: ['#2dd4bf', '#0b1220'], blue: ['#3b82f6', '#ffffff'] };
const YT_HOSTS = ['i.ytimg.com', 'img.youtube.com', 'i9.ytimg.com', 'yt3.ggpht.com'];

export class ThumbnailService {
  constructor({ store, outputDir, library }) { this.store = store; this.outputDir = outputDir; this.library = library; }

  _ref(userId, kind, refId) {
    const col = { shorts: 'clips', remix: 'remixJobs', longform: 'longformJobs' }[kind];
    if (!col) throw new ApiError(400, '알 수 없는 종류입니다.');
    const rec = this.store.get(col, refId);
    if (!rec || rec.userId !== userId) throw new ApiError(404, '작업을 찾을 수 없습니다.');
    const job = kind === 'shorts' ? this.store.get('jobs', rec.jobId) : rec;
    return { col, rec, job, source: job?.source || {} };
  }

  // 후보 장면: 원본 썸네일(비슷하게 만들기용) · 유튜브 프레임 3장(25/50/75%) · 파일이면 ffmpeg 로 후킹/핵심 문장/중간 프레임 · 사용자가 브라우저에서 캡처한 프레임
  async candidates(userId, kind, refId) {
    const { rec, job, source } = this._ref(userId, kind, refId);
    const list = [];
    const D = source.durationSec || 60;
    const times = keyTimes(kind, rec, D);
    if (source.videoId) {
      list.push({ id: 'original', label: '원본 썸네일', url: this.proxyUrl(`https://i.ytimg.com/vi/${source.videoId}/maxresdefault.jpg`), fallbackUrl: this.proxyUrl(`https://i.ytimg.com/vi/${source.videoId}/hqdefault.jpg`), at: null, reason: '원본과 거의 비슷한 썸네일을 만들 때 사용', score: 95 });
      [0.25, 0.5, 0.75].forEach((p, i) => list.push({ id: `yt-${i + 1}`, label: `장면 ${Math.round(p * 100)}%`, url: this.proxyUrl(`https://i.ytimg.com/vi/${source.videoId}/hq${i + 1}.jpg`), at: Math.round(D * p), reason: '유튜브가 제공하는 원본 프레임', score: 60 + (times.some((t) => Math.abs(t.at - D * p) < D * 0.12) ? 20 : 0) }));
    }
    const filePath = source.path;
    if (filePath && fs.existsSync(filePath) && which('ffmpeg')) {
      const dir = path.join(this.outputDir, userId, 'thumbs'); fs.mkdirSync(dir, { recursive: true });
      for (const [i, t] of times.entries()) {
        const out = path.join(dir, `${refId}-${i}.jpg`);
        try { if (!fs.existsSync(out)) await run('ffmpeg', ['-y', '-ss', String(t.at), '-i', filePath, '-frames:v', '1', '-q:v', '3', '-vf', 'scale=1280:-2', out]); list.push({ id: `frame-${i}`, label: t.label, url: `/api/thumbnail/${kind}/${refId}/frame/${i}`, path: out, at: t.at, reason: t.reason, score: t.score }); }
        catch (err) { console.warn('[thumbnail] 프레임 추출 실패:', err.message); }
      }
    } else if (filePath) {
      // ffmpeg 이 없으면 브라우저가 원본을 재생해 캡처하도록 시점만 알려준다
      for (const [i, t] of times.entries()) list.push({ id: `frame-${i}`, label: t.label, url: null, at: t.at, reason: `${t.reason} (브라우저에서 캡처)`, score: t.score, captureFrom: source.uploadId ? `/api/uploads/${source.uploadId}/stream` : `/api/local/stream?path=${encodeURIComponent(filePath)}` });
    }
    // 사용자가 올린 프레임
    for (const c of rec.thumbnailSet?.userFrames || []) list.push(c);
    return list;
  }

  proxyUrl(u) { return `/api/thumbnail/proxy?url=${encodeURIComponent(u)}`; }
  isAllowedProxy(u) { try { const h = new URL(u).hostname; return YT_HOSTS.includes(h); } catch { return false; } }

  get(userId, kind, refId) { const { rec } = this._ref(userId, kind, refId); return rec.thumbnailSet || null; }

  // 자동 제작: 원본 썸네일이 있으면 "원본과 비슷하게", 아니면 점수가 가장 높은 장면 + 유튜브 최적화 문구
  async auto(userId, kind, refId, { style = null, headline = null, subline = null, palette = 'yellow' } = {}) {
    const { rec } = this._ref(userId, kind, refId);
    const candidates = await this.candidates(userId, kind, refId);
    const selected = candidates.find((c) => c.id === 'original') || [...candidates].filter((c) => c.url).sort((a, b) => b.score - a.score)[0] || candidates[0] || null;
    const seo = rec.seo || rec.result?.seo || null;
    const text = seo?.thumbnailText || [];
    const hookText = kind === 'shorts' ? (rec.hook?.text || rec.title) : (rec.result?.plan?.hook || rec.source?.title || '');
    const h = headline || text[0] || shortText(hookText, 10);
    const s = subline != null ? subline : (text[1] || '');
    const st = style || (selected?.id === 'original' ? 'original-like' : /\d/.test(h) ? 'big-number' : 'bold');
    return this.update(userId, kind, refId, { candidateId: selected?.id || null, headline: h, subline: s, style: st, palette, candidates });
  }

  async update(userId, kind, refId, { candidateId, headline, subline = '', style = 'bold', palette = 'yellow', imageUrl = null, candidates = null } = {}) {
    const { col, rec } = this._ref(userId, kind, refId);
    const list = candidates || rec.thumbnailSet?.candidates || await this.candidates(userId, kind, refId);
    const cand = list.find((c) => c.id === candidateId) || null;
    const ratio = kind === 'shorts' ? (rec.ratio || '9:16') : (rec.result?.ratio || '16:9');
    const [w, h] = ratio === '9:16' ? [1080, 1920] : ratio === '1:1' ? [1080, 1080] : ratio === '4:5' ? [1080, 1350] : [1280, 720];
    const image = imageUrl || cand?.url || cand?.fallbackUrl || null;
    const svg = composeSvg({ width: w, height: h, image, headline: String(headline || '').slice(0, 24), subline: String(subline || '').slice(0, 24), style: THUMB_STYLES.some((x) => x.id === style) ? style : 'bold', palette: THUMB_PALETTES[palette] ? palette : 'yellow', badge: kind === 'shorts' ? 'SHORTS' : null });
    const set = { candidates: list.map(({ path: _p, ...c }) => c), selectedId: cand?.id || null, imageUrl: image, headline: String(headline || ''), subline: String(subline || ''), style, palette, width: w, height: h, svg, updatedAt: new Date().toISOString(), userFrames: rec.thumbnailSet?.userFrames || [] };
    this.store.update(col, refId, { thumbnailSet: set });
    // 보관함 항목 썸네일도 갱신
    const item = this.store.find('library', (r) => r.kind === kind && r.refId === refId)[0];
    if (item) this.store.update('library', item.id, { thumbnail: `/api/thumbnail/${kind}/${refId}/image.svg?v=${Date.now()}`, thumbnailCustom: true });
    return set;
  }

  // 브라우저에서 캡처한 프레임(JPEG/PNG raw body) 저장 → 후보에 추가
  addUserFrame(userId, kind, refId, { buffer, at = null, mime = 'image/jpeg' }) {
    const { col, rec } = this._ref(userId, kind, refId);
    if (!buffer || !buffer.length) throw new ApiError(400, '이미지 데이터가 없습니다.');
    if (buffer.length > 6 * 1024 * 1024) throw new ApiError(413, '이미지는 6MB 이하로 올려주세요.');
    const dir = path.join(this.outputDir, userId, 'thumbs'); fs.mkdirSync(dir, { recursive: true });
    const idx = (rec.thumbnailSet?.userFrames || []).length + 100;
    const out = path.join(dir, `${refId}-${idx}.${mime.includes('png') ? 'png' : 'jpg'}`);
    fs.writeFileSync(out, buffer);
    const frame = { id: `frame-${idx}`, label: at != null ? `캡처 ${fmt(at)}` : '캡처', url: `/api/thumbnail/${kind}/${refId}/frame/${idx}`, at, reason: '브라우저에서 캡처한 장면', score: 70 };
    const set = { ...(rec.thumbnailSet || { candidates: [] }), userFrames: [...(rec.thumbnailSet?.userFrames || []), frame] };
    set.candidates = [...(set.candidates || []).filter((c) => c.id !== frame.id), frame];
    this.store.update(col, refId, { thumbnailSet: set });
    return frame;
  }

  frameFile(userId, kind, refId, idx) {
    const { rec } = this._ref(userId, kind, refId);
    const dir = path.join(this.outputDir, userId, 'thumbs');
    const f = ['jpg', 'png'].map((e) => path.join(dir, `${refId}-${idx}.${e}`)).find((p) => fs.existsSync(p));
    if (!f) throw new ApiError(404, '프레임 파일이 없습니다.');
    return { path: f, mime: f.endsWith('.png') ? 'image/png' : 'image/jpeg', rec };
  }

  svg(userId, kind, refId) {
    const { rec } = this._ref(userId, kind, refId);
    if (!rec.thumbnailSet?.svg) throw new ApiError(404, '아직 썸네일이 없습니다. 자동 제작을 먼저 실행하세요.');
    return rec.thumbnailSet.svg;
  }
}

// 썸네일에 쓸 장면 시점: 후킹(시작) · 점수 높은/키워드 문장 · 중간 · 끝 직전
function keyTimes(kind, rec, D) {
  const KEY = /핵심|비밀|놀라|반전|중요|결과|진짜|충격|방법|이유|\?|!/;
  if (kind === 'shorts') {
    const subs = rec.subtitles || [];
    const key = subs.find((s) => KEY.test(s.text)) || subs[Math.floor(subs.length / 2)];
    return [
      { at: round(rec.start + 0.5), label: '후킹 장면', reason: '첫 3초 후킹 시점', score: 85 },
      key ? { at: round(rec.start + key.start + 0.2), label: '핵심 문장', reason: `"${shortText(key.text, 14)}"`, score: 90 } : null,
      { at: round((rec.start + rec.end) / 2), label: '중간', reason: '클립 중간 장면', score: 60 },
      { at: round(Math.max(rec.start, rec.end - 1)), label: '마무리', reason: '마무리 장면', score: 50 },
    ].filter(Boolean);
  }
  const keep = rec.result?.plan?.keep || rec.result?.timeline || [];
  const first = keep[0];
  return [
    { at: round(first ? first.start + 0.5 : 1), label: '후킹 장면', reason: '첫 구간 시작', score: 85 },
    { at: round(D * 0.3), label: '30%', reason: '앞부분 핵심', score: 70 },
    { at: round(D * 0.55), label: '55%', reason: '중반', score: 65 },
    { at: round(D * 0.8), label: '80%', reason: '후반 클라이맥스', score: 60 },
  ];
}

// SVG 조합: 배경 이미지(있으면) + 스타일별 그라데이션/띠 + 큰 텍스트(외곽선) + 배지
export function composeSvg({ width, height, image, headline, subline, style, palette, badge }) {
  const [accent, ink] = THUMB_PALETTES[palette] || THUMB_PALETTES.yellow;
  const vertical = height > width;
  const fontHead = Math.round(width / (vertical ? 9 : 11));
  const fontSub = Math.round(fontHead * 0.62);
  const lines = wrap(headline, vertical ? 7 : 10);
  const subLines = subline ? wrap(subline, vertical ? 9 : 14) : [];
  const font = "'Black Han Sans','Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',sans-serif";
  const bg = image ? `<image href="${esc(image)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"/>` : `<rect width="${width}" height="${height}" fill="url(#bgGrad)"/>`;
  const text = (x, y, anchor, size, fill, stroke, arr, weight = 900) => arr.map((l, i) => `<text x="${x}" y="${y + i * size * 1.12}" text-anchor="${anchor}" font-family="${font}" font-weight="${weight}" font-size="${size}" fill="${fill}" stroke="${stroke}" stroke-width="${Math.max(2, Math.round(size / 11))}" paint-order="stroke" stroke-linejoin="round">${esc(l)}</text>`).join('');
  let body = '';
  const pad = Math.round(width * 0.05);
  if (style === 'original-like' || style === 'bold') {
    const gradH = Math.round(height * (vertical ? 0.42 : 0.55));
    const baseY = height - pad - (subLines.length ? subLines.length * fontSub * 1.12 : 0) - (lines.length - 1) * fontHead * 1.12;
    body = `<rect x="0" y="${height - gradH}" width="${width}" height="${gradH}" fill="url(#shade)"/>${text(pad, baseY, 'start', fontHead, style === 'original-like' ? accent : '#ffffff', '#000000', lines)}${subLines.length ? text(pad, baseY + lines.length * fontHead * 1.12 + fontSub * 0.2, 'start', fontSub, '#ffffff', '#000000', subLines, 700) : ''}`;
  } else if (style === 'big-number') {
    const num = (headline.match(/\d+/) || [''])[0];
    const rest = headline.replace(num, '').trim();
    const numSize = Math.round(width / (vertical ? 3.2 : 4));
    body = `<rect x="0" y="0" width="${width}" height="${height}" fill="url(#shade)" opacity=".85"/>${num ? `<text x="${pad}" y="${Math.round(height * 0.62)}" font-family="${font}" font-weight="900" font-size="${numSize}" fill="${accent}" stroke="#000" stroke-width="${Math.round(numSize / 14)}" paint-order="stroke">${esc(num)}</text>` : ''}${text(num ? pad + numSize * 0.62 * num.length + pad : pad, Math.round(height * (vertical ? 0.4 : 0.5)), 'start', fontHead, '#ffffff', '#000000', wrap(rest || headline, vertical ? 6 : 8))}${subLines.length ? text(pad, height - pad, 'start', fontSub, '#ffffff', '#000000', subLines, 700) : ''}`;
  } else if (style === 'split') {
    const bandW = Math.round(width * (vertical ? 1 : 0.42)); const bandH = vertical ? Math.round(height * 0.34) : height;
    const bx = 0; const by = vertical ? height - bandH : 0;
    body = `<rect x="${bx}" y="${by}" width="${bandW}" height="${bandH}" fill="${accent}" opacity=".93"/>${text(bx + pad, by + pad + fontHead, 'start', fontHead, ink, 'none', wrap(headline, vertical ? 8 : 7))}${subLines.length ? text(bx + pad, by + pad + fontHead + wrap(headline, vertical ? 8 : 7).length * fontHead * 1.12, 'start', fontSub, ink, 'none', subLines, 700) : ''}`;
  } else { // minimal
    const label = lines.join(' ');
    const lw = Math.round(label.length * fontSub * 0.95 + pad * 1.2);
    body = `<rect x="${pad}" y="${height - pad - fontSub * 1.7}" rx="${Math.round(fontSub * 0.4)}" width="${lw}" height="${Math.round(fontSub * 1.7)}" fill="${accent}" opacity=".95"/><text x="${pad + Math.round(pad * 0.6)}" y="${height - pad - Math.round(fontSub * 0.45)}" font-family="${font}" font-weight="900" font-size="${fontSub}" fill="${ink}">${esc(label)}</text>`;
  }
  const badgeSvg = badge ? `<rect x="${width - pad - 190}" y="${pad}" rx="14" width="190" height="56" fill="#ff0033"/><text x="${width - pad - 95}" y="${pad + 40}" text-anchor="middle" font-family="${font}" font-weight="900" font-size="30" fill="#fff">${esc(badge)}</text>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".85"/></linearGradient><linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1f2937"/><stop offset="1" stop-color="#0b1220"/></linearGradient></defs>${bg}${body}${badgeSvg}</svg>`;
}

function wrap(text, perLine) {
  const t = String(text || '').trim(); if (!t) return [''];
  const words = t.split(/\s+/); const lines = []; let cur = '';
  for (const w of words) { if ((cur + (cur ? ' ' : '') + w).length > perLine && cur) { lines.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w; }
  if (cur) lines.push(cur);
  // 띄어쓰기 없는 긴 한글은 글자 수로 자른다
  return lines.flatMap((l) => (l.length > perLine + 2 ? l.match(new RegExp(`.{1,${perLine}}`, 'g')) : [l])).slice(0, 3);
}
function shortText(s, n) { const t = String(s || '').replace(/[🔥]/g, '').trim(); return t.length > n ? `${t.slice(0, n)}` : t; }
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function round(n) { return Math.round(n * 100) / 100; }
function fmt(sec) { const m = Math.floor(sec / 60); const s = Math.floor(sec % 60); return `${m}:${String(s).padStart(2, '0')}`; }
