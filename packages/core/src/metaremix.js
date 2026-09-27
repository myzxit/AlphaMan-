// 썸네일·제목·태그 리믹스: 영상 링크(유튜브)나 영상 파일을 넣으면 원본 썸네일·제목·태그를 가져와
// "원본과 거의 비슷하지만 새로 만든" 썸네일(다운로드 가능한 SVG/PNG)·제목 후보·태그를 만든다.
// AI(Claude)가 있으면 제목·태그·썸네일 문구를 AI 가, 없으면 규칙(동의어 바꿔쓰기·키워드 재조합)이 만든다. 이용권은 차감하지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { ApiError } from './errors.js';
import { parseYoutubeUrl, fetchYoutubeMeta } from './media.js';
import { composeSvg, THUMB_STYLES, THUMB_PALETTES } from './thumbnail.js';
import { extractKeywords } from './seo.js';
import { paraphraseLine } from './subtitles/rewrite.js';

const YT_IMAGE_HOSTS = ['i.ytimg.com', 'img.youtube.com', 'i9.ytimg.com', 'yt3.ggpht.com'];
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
export const META_FX_DEFAULTS = { mirror: false, zoom: 1.06, tint: true, saturate: 1.15 }; // 원본 사진을 "새 사진처럼" 보이게 하는 기본 효과. 좌우 반전은 원본에 글자가 있으면 뒤집혀 보이므로 기본 꺼짐(옵션)

export class MetaRemixService {
  constructor({ store, ai, seo, outputDir }) { this.store = store; this.ai = ai; this.seo = seo; this.outputDir = outputDir; this._svgCache = new Map(); }

  list(userId) {
    return this.store.find('metaRemixes', (r) => r.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((r) => ({ id: r.id, createdAt: r.createdAt, updatedAt: r.updatedAt, source: r.source, originalTitle: r.original.title, title: r.selected?.title || r.result?.titles?.[0] || '', engine: r.result?.engine || 'rules', thumb: { width: r.thumb.width, height: r.thumb.height, updatedAt: r.thumb.updatedAt } }));
  }

  get(userId, id) {
    const rec = this.store.get('metaRemixes', id);
    if (!rec || rec.userId !== userId) throw new ApiError(404, '리믹스 기록을 찾을 수 없습니다.');
    return rec;
  }

  // 링크(유튜브) 또는 파일(브라우저에서 캡처한 장면 + 파일명/직접 입력한 제목·태그) → 원본 정보 수집 → 새로 생성
  async create(userId, { url = '', title = '', tags = [], description = '', frameDataUrl = null, filename = '', durationSec = null, width = null, height = null, options = {} } = {}) {
    let original; let source; let imageBuf = null; let imageMime = 'image/jpeg';
    if (url) {
      const yt = parseYoutubeUrl(url); // 유튜브가 아니면 400
      const meta = await fetchYoutubeMeta(yt.id).catch(() => null) || {};
      source = { type: 'youtube', url: yt.url, videoId: yt.id, shorts: /\/shorts\//.test(url) };
      original = { title: String(meta.title || title || `YouTube 영상 ${yt.id}`).trim(), tags: normalizeTags(meta.tags?.length ? meta.tags : tags), description: String(meta.description || description || '').slice(0, 1500), channel: meta.channel || '', durationSec: meta.durationSec || durationSec || null, thumbnailUrl: `https://i.ytimg.com/vi/${yt.id}/maxresdefault.jpg`, thumbnailFallbackUrl: `https://i.ytimg.com/vi/${yt.id}/hqdefault.jpg` };
      const img = await fetchFirstImage([`https://i.ytimg.com/vi/${yt.id}/maxresdefault.jpg`, `https://i.ytimg.com/vi/${yt.id}/sddefault.jpg`, `https://i.ytimg.com/vi/${yt.id}/hqdefault.jpg`]);
      if (img) { imageBuf = img.buffer; imageMime = img.mime; original.thumbnailUrl = img.url; }
    } else {
      const base = String(filename || '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_-]+/g, ' ').trim();
      const t = String(title || base).trim();
      if (!t) throw new ApiError(400, '영상 링크를 넣거나, 파일과 제목을 입력해주세요.');
      source = { type: 'file', filename: String(filename || '').slice(0, 200), shorts: Boolean(width && height && height > width) };
      original = { title: t.slice(0, 120), tags: normalizeTags(tags), description: String(description || '').slice(0, 1500), channel: '', durationSec: durationSec || null, thumbnailUrl: null, thumbnailFallbackUrl: null };
      if (frameDataUrl) { const d = decodeDataUrl(frameDataUrl); imageBuf = d.buffer; imageMime = d.mime; }
    }
    const vertical = Boolean(source.shorts);
    const rec = this.store.insert('metaRemixes', { userId, source, original, options: sanitizeOptions(options), result: null, selected: null, thumb: { width: vertical ? 1080 : 1280, height: vertical ? 1920 : 720, style: 'original-like', palette: 'yellow', headline: '', subline: '', fx: { ...META_FX_DEFAULTS }, updatedAt: new Date().toISOString() }, image: null, seed: 0 });
    if (imageBuf) await this._saveImage(rec, imageBuf, imageMime);
    return this._generate(rec, { seed: 0 });
  }

  async regenerate(userId, id, { seed = null } = {}) {
    const rec = this.get(userId, id);
    return this._generate(rec, { seed: seed != null ? Number(seed) : (rec.seed || 0) + 1 });
  }

  // 문구·스타일·색·효과·선택한 제목/태그 수정 → 썸네일 다시 조합
  update(userId, id, { headline, subline, style, palette, fx, title, tags } = {}) {
    const rec = this.get(userId, id);
    const thumb = { ...rec.thumb };
    if (headline != null) thumb.headline = String(headline).slice(0, 24);
    if (subline != null) thumb.subline = String(subline).slice(0, 24);
    if (style != null) thumb.style = THUMB_STYLES.some((s) => s.id === style) ? style : thumb.style;
    if (palette != null) thumb.palette = THUMB_PALETTES[palette] ? palette : thumb.palette;
    if (fx && typeof fx === 'object') thumb.fx = { mirror: Boolean(fx.mirror), zoom: clamp(Number(fx.zoom) || 1, 1, 1.4), tint: Boolean(fx.tint), saturate: clamp(Number(fx.saturate) || 1, 0.5, 1.8) };
    thumb.updatedAt = new Date().toISOString();
    const selected = { ...(rec.selected || {}) };
    if (title != null) selected.title = String(title).slice(0, 120);
    if (tags != null) selected.tags = normalizeTags(tags);
    return this.store.update('metaRemixes', id, { thumb, selected });
  }

  remove(userId, id) {
    const rec = this.get(userId, id);
    for (const p of [rec.image?.path]) { if (p) { try { fs.unlinkSync(p); } catch { /* 이미 없음 */ } } }
    this.store.remove('metaRemixes', id);
    return { ok: true };
  }

  // <img src> 로 바로 쓸 수 있도록 배경 사진을 base64 로 넣은 완성 SVG (수정 시각 기준 캐시)
  async svgInline(userId, id) {
    const rec = this.get(userId, id);
    const key = `${id}:${JSON.stringify(rec.thumb)}:${rec.image?.path || rec.image?.remoteUrl || ''}`; // 같은 밀리초에 두 번 수정돼도 설정이 다르면 다시 조합
    const hit = this._svgCache.get(key); if (hit) return hit;
    const image = await this._loadImage(rec).catch(() => null);
    const svg = this.compose(rec, image);
    if (this._svgCache.size > 100) this._svgCache.delete(this._svgCache.keys().next().value);
    this._svgCache.set(key, svg);
    return svg;
  }

  compose(rec, image) {
    const t = rec.thumb;
    return composeSvg({ width: t.width, height: t.height, image, headline: t.headline, subline: t.subline, style: t.style, palette: t.palette, badge: rec.source.shorts ? 'SHORTS' : null, imageFx: t.fx });
  }

  // 원본 사진 파일 (로컬 → 원격 저장소 → 유튜브 원본 주소 순)
  imageFile(userId, id) {
    const rec = this.get(userId, id);
    if (rec.image?.path && fs.existsSync(rec.image.path)) return { path: rec.image.path, mime: rec.image.mime || 'image/jpeg' };
    if (rec.image?.remoteUrl) return { redirect: rec.image.remoteUrl };
    if (rec.original.thumbnailUrl) return { redirect: rec.original.thumbnailUrl };
    throw new ApiError(404, '원본 이미지가 없습니다.');
  }

  async _saveImage(rec, buffer, mime) {
    if (!buffer?.length) return;
    if (buffer.length > MAX_IMAGE_BYTES) throw new ApiError(413, '이미지는 6MB 이하로 올려주세요.');
    const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
    const dir = path.join(this.outputDir, rec.userId, 'metaremix');
    let filePath = null;
    try { fs.mkdirSync(dir, { recursive: true }); filePath = path.join(dir, `${rec.id}.${ext}`); fs.writeFileSync(filePath, buffer); } catch (err) { console.warn('[metaremix] 이미지 로컬 저장 실패:', err.message); filePath = null; }
    let remoteUrl = null;
    if (this.store.remote?.putFile) { try { remoteUrl = await this.store.remote.putFile(`metaremix/${rec.userId}/${rec.id}.${ext}`, buffer, mime); } catch (err) { console.warn('[metaremix] 이미지 원격 저장 실패:', err.message); } }
    rec.image = { path: filePath, remoteUrl, mime, size: buffer.length };
    this.store.update('metaRemixes', rec.id, { image: rec.image });
  }

  async _loadImage(rec) {
    let buf = null; let mime = rec.image?.mime || 'image/jpeg';
    if (rec.image?.path && fs.existsSync(rec.image.path)) buf = fs.readFileSync(rec.image.path);
    else {
      const urls = [rec.image?.remoteUrl, rec.original?.thumbnailUrl, rec.original?.thumbnailFallbackUrl].filter(Boolean);
      for (const u of urls) {
        const r = await fetchImage(u).catch(() => null);
        if (r) { buf = r.buffer; mime = r.mime; break; }
      }
    }
    if (!buf || !buf.length || buf.length > 8 * 1024 * 1024) return null;
    return `data:${mime.split(';')[0]};base64,${buf.toString('base64')}`;
  }

  // 새 제목·태그·썸네일 문구 생성 (AI → 규칙). 원본은 그대로 두고 result/selected/thumb 만 바꾼다
  async _generate(rec, { seed = 0 } = {}) {
    const { original, options } = rec;
    const language = options.language || (/[가-힣]/.test(original.title) ? 'ko' : 'en');
    const keywords = extractKeywords(`${original.title} ${original.title} ${original.tags.join(' ')} ${original.description}`, 12);
    const rules = rulesGenerate(original, { keywords, seed, language });
    let out = rules; let engine = 'rules';
    if (this.ai) {
      const res = await this.ai.complete({
        system: `유튜브 썸네일·제목·태그 카피라이터입니다. 원본 영상의 제목·태그·설명을 보고, 같은 주제·같은 어투·비슷한 길이·비슷한 구조를 유지하되 표현과 핵심 단어 일부를 바꿔 "원본과 거의 비슷하지만 새로 쓴" 결과를 만듭니다. 원본 문장을 그대로 복사하지 않습니다. 언어는 원본과 같게(${language}). JSON 으로만 답합니다. 형식: {"titles":["",...5개],"tags":["",...15개(원본 태그의 유의어·연관어, 원본 태그 중 일부는 유지)],"hashtags":["#..","#..","#.."],"thumbnail":[{"headline":"6자 이내 큰 문구","subline":"10자 이내 작은 문구"},{"headline":"","subline":""}],"description":"원본 설명과 비슷한 톤의 2~3문장 설명"}`,
        prompt: `원본 제목: ${original.title}\n원본 태그: ${original.tags.join(', ') || '(없음)'}\n채널: ${original.channel || '(모름)'}\n길이: ${original.durationSec ? `${Math.round(original.durationSec)}초` : '(모름)'}\n원본 설명(앞부분): ${original.description.slice(0, 800) || '(없음)'}\n변주 번호: ${seed} (번호가 다르면 다른 표현으로)`,
        json: true, maxTokens: 3000, fallback: () => null,
      }).catch(() => null);
      if (res && typeof res === 'object' && Array.isArray(res.titles) && res.titles.length) {
        const titles = uniqStrings([...res.titles.map((t) => String(typeof t === 'string' ? t : t?.text || '').trim()), ...rules.titles], original.title).slice(0, 6);
        const tags = normalizeTags([...(Array.isArray(res.tags) ? res.tags : []), ...rules.tags]);
        const thumbs = (Array.isArray(res.thumbnail) ? res.thumbnail : []).map((x) => ({ headline: String(x?.headline || '').slice(0, 12), subline: String(x?.subline || '').slice(0, 16) })).filter((x) => x.headline);
        out = { titles, tags, hashtags: (Array.isArray(res.hashtags) && res.hashtags.length ? res.hashtags : rules.hashtags).map(hashify).slice(0, 3), thumbnail: thumbs.length ? thumbs : rules.thumbnail, description: String(res.description || rules.description).slice(0, 1200) };
        engine = this.ai.lastMode && this.ai.lastMode !== 'heuristic' ? this.ai.lastMode : 'rules';
      }
    }
    // 기존 유튜브 최적화(SEO) 엔진의 추천 제목·업로드 시간도 함께 (원본과 비슷한 제목과 별개로 "알고리즘 추천" 참고용)
    let recommended = null;
    // SEO 엔진의 규칙 템플릿은 한국어 기준이라 한국어 제목일 때만
    if (this.seo && language === 'ko') { try { const s = await this.seo.generate({ kind: rec.source.shorts ? 'shorts' : 'video', title: out.titles[0], originalTitle: original.title, originalTags: original.tags, originalDescription: original.description, channel: original.channel, durationSec: original.durationSec || 0, language }); recommended = { bestTitle: s.bestTitle, titles: s.titles.slice(0, 4), bestPostTimes: s.bestPostTimes, hashtags: s.hashtags }; } catch { recommended = null; } }
    const result = { engine, titles: out.titles, tags: out.tags, hashtags: out.hashtags, thumbnail: out.thumbnail, description: out.description, keywords, recommended, generatedAt: new Date().toISOString() };
    const pick = out.thumbnail[seed % out.thumbnail.length] || out.thumbnail[0] || { headline: keywords[0] || original.title.slice(0, 8), subline: '' };
    const thumb = { ...rec.thumb, headline: options.headline || pick.headline, subline: options.subline != null ? options.subline : pick.subline, style: options.style || rec.thumb.style || 'original-like', palette: options.palette && THUMB_PALETTES[options.palette] ? options.palette : rec.thumb.palette, fx: options.fx ? { ...META_FX_DEFAULTS, ...options.fx } : rec.thumb.fx, updatedAt: new Date().toISOString() };
    const selected = { title: out.titles[0], tags: out.tags };
    return this.store.update('metaRemixes', rec.id, { result, selected, thumb, seed });
  }
}

// ---------- 규칙 기반 생성 ----------
// 제목에 자주 쓰이는 표현의 유의어 (대본 바꿔쓰기용 KO_SYNONYMS 와 별개로, 제목·태그에 맞는 것만)
const TITLE_SYNONYMS = [
  ['브이로그', 'VLOG'], ['투어', '탐방'], ['리뷰', '후기'], ['후기', '리뷰'], ['꿀팁', '팁'], ['총정리', '완벽 정리'], ['완벽 정리', '총정리'], ['추천', '베스트'], ['방법', '하는 법'], ['비법', '노하우'], ['노하우', '비법'],
  ['먹방', '먹방 브이로그'], ['튜토리얼', '강좌'], ['강의', '강좌'], ['하이라이트', '명장면'], ['최고의', '역대급'], ['역대급', '최고의'], ['쉬운', '간단한'], ['처음', '입문'], ['초보', '입문자'], ['모음', '몰아보기'], ['몰아보기', '모음'],
  ['공식', '오피셜'], ['비하인드', '뒷이야기'], ['레시피', '만드는 법'], ['언박싱', '개봉기'], ['개봉기', '언박싱'], ['비교', 'VS'], ['정리', '요약'], ['요약', '정리'],
  ['Official Video', 'Official MV'], ['Official MV', 'Official Video'], ['Remaster', 'Remastered'], ['Tutorial', 'Guide'], ['Guide', 'Tutorial'], ['Review', 'Honest Review'], ['Tips', 'Tricks'], ['Tricks', 'Tips'], ['Best', 'Top'], ['How to', 'How I'],
  ['Vlog', 'Daily Vlog'], ['Highlights', 'Best Moments'], ['Ultimate', 'Complete'], ['Complete', 'Ultimate'], ['Easy', 'Simple'], ['Beginner', 'Beginner-Friendly'], ['Full', 'Complete'], ['Recipe', 'How to Make'], ['Unboxing', 'First Look'], ['Compilation', 'Best Of'],
];
const EN_STOP = new Set(['to', 'of', 'in', 'on', 'a', 'an', 'is', 'it', 'be', 'by', 'at', 'or', 'vs', 'my', 'we', 'he', 'she', 'do', 'no', 'so', 'up', 'if', 'as', 'me', 'us', 'our', 'his', 'her', 'its', 'not', 'but', 'all', 'can', 'get', 'got', 'has', 'had', 'out', 'new', 'now', 'one', 'two', 'from', 'into', 'your', 'they', 'them', 'than', 'then', 'what', 'when', 'will', 'just', 'like', 'more', 'some', 'here', 'over', 'also', 'http', 'https', 'www', 'com', 'link', 'links', 'follow', 'subscribe', 'official']);
const COUNT_UNITS = /^(가지|개|명|곳|단계|분|초|things|tips|ways|reasons|steps|hacks|ideas|mistakes|secrets|rules)/i;
const reEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function titleSynonyms(text, seed = 0) {
  let t = String(text || ''); let swapped = 0;
  for (let k = 0; k < TITLE_SYNONYMS.length && swapped < 2; k++) {
    const [a, b] = TITLE_SYNONYMS[(k + seed) % TITLE_SYNONYMS.length];
    const re = /[가-힣]/.test(a) ? new RegExp(a) : new RegExp('\\b' + reEsc(a) + '\\b', 'i');
    if (re.test(t)) { t = t.replace(re, b); swapped += 1; }
  }
  return t;
}
const EN_WEAK = new Set(['give', 'gonna', 'never', 'wanna', 'gotta', 'make', 'made', 'take', 'look', 'know', 'feel', 'love', 'want', 'need', 'back', 'down', 'there', 'with', 'this', 'that', 'have', 'been', 'were', 'about', 'after', 'before', 'every', 'thing', 'things', 'really', 'very', 'much', 'many', 'most', 'even', 'still', 'again', 'video']);
function cleanKeywords(list, title) {
  const c = String(title || '').toLowerCase();
  return list.filter((k) => { const w = String(k).trim(); if (!w || !/[\p{L}\p{N}]/u.test(w) || /^\d+$/.test(w)) return false; if (/^[a-z0-9'’.-]+$/i.test(w)) { const l = w.toLowerCase(); if (w.length < 4 || EN_STOP.has(l) || EN_WEAK.has(l)) return false; } return true; })
    .sort((a, b) => Number(c.includes(a.toLowerCase())) - Number(c.includes(b.toLowerCase()))); // 제목에 아직 없는 키워드를 앞으로
}
const stripParens = (s) => String(s).replace(/\s*[([【][^)\]】]*[)\]】]/g, '').replace(/\s+/g, ' ').trim();
function swapSides(core) { const m = core.match(/^(.{2,}?)\s+([-–—|:])\s+(.{2,})$/); return m ? `${m[3]} ${m[2] === ':' ? '-' : m[2]} ${m[1]}` : null; }
// "요리 5가지" → "요리 TOP 5", "10 Tips ..." → "Top 10 Tips ..." (개수는 그대로 두고 표현만 바꾼다)
function restyleCount(text, isKo) {
  const m = text.match(/(\d+)\s*(\S*)/); if (!m) return null;
  const n = m[1]; const after = m[2] || '';
  if (isKo && /^(가지|개|곳|선)/.test(after)) return text.replace(new RegExp(`\\s*${n}\\s*(가지|개|곳|선)`), '').replace(/\s+/g, ' ').trim() + ` TOP ${n}`;
  if (!isKo && text.trim().startsWith(n) && COUNT_UNITS.test(after)) return `Top ${text.trim()}`;
  return null;
}

export function rulesGenerate(original, { keywords = [], seed = 0, language = 'ko' } = {}) {
  const orig = String(original.title || '').trim();
  const prefix = (orig.match(/^(\[[^\]]+\]|\([^)]+\)|【[^】]+】)\s*/) || [])[0] || '';
  const emoji = (orig.match(/(\p{Extended_Pictographic}+)\s*$/u) || [])[1] || '';
  const core = orig.replace(prefix, '').replace(/(\p{Extended_Pictographic}+)\s*$/u, '').trim() || orig;
  const isKo = /[가-힣]/.test(core);
  const kws = cleanKeywords(keywords, orig);
  const squash = (s) => String(s).toLowerCase().replace(/[\s_\-#]+/g, ''); // "RickAstley" 와 "Rick Astley" 를 같은 것으로 본다
  const fresh = kws.filter((k) => !orig.toLowerCase().includes(k.toLowerCase()) && !squash(orig).includes(squash(k))); // 제목(접두 포함)에 없는 키워드만 새 요소로 쓴다
  const k1 = fresh[0] || ''; const k2 = fresh[1] || '';
  const p = (s) => titleSynonyms(paraphraseLine(core, { language, seed: s }), s);
  const stripped = stripParens(core) || core;
  const wrapT = (t) => `${prefix}${t}${emoji ? ` ${emoji}` : ''}`.replace(/\s+/g, ' ').trim();
  const suffixes = isKo ? [' 완벽 정리', ' (총정리)', ' 핵심만', ' 이렇게 하세요', ' 몰아보기'] : [' (Full Version)', ' — Complete Guide', ': Everything You Need', ' (Must Watch)', ' — Best Moments'];
  const suf = (i) => suffixes[(i + seed) % suffixes.length];
  const counted = restyleCount(p(seed + 4), isKo);
  const raw = [
    wrapT(p(seed)),
    wrapT(swapSides(titleSynonyms(core, seed + 1)) || (k1 ? `${p(seed + 1)} | ${k1}` : `${p(seed + 1)}${suf(1)}`)),
    wrapT(`${titleSynonyms(stripped, seed + 2)}${/[?？!]$/.test(stripped) ? '' : suf(0)}`),
    wrapT(k1 ? `${k1}${isKo ? ',' : ':'} ${p(seed + 2)}` : `${p(seed + 3)}${suf(2)}`),
    wrapT(counted || (k2 ? `${p(seed + 3)} · ${k2}` : `${isKo ? '이것만 보면 끝: ' : 'All You Need: '}${stripped}`)),
  ];
  const uniq = uniqStrings(raw, orig);
  if (uniq.length < 3) uniq.push(...uniqStrings([wrapT(`${stripped}${isKo ? ' 핵심 정리' : ' Explained'}`), wrapT(`${isKo ? '다시 보는 ' : 'Revisited: '}${stripped}`)], orig).filter((t) => !uniq.includes(t)));
  // 변주 번호에 따라 첫 후보가 달라지도록 (중복 제거 뒤에) 순서를 돌린다 — 다시 생성 시 눈에 띄게 바뀐다
  const titles = uniq.map((_, i) => uniq[(i + seed) % uniq.length]);
  const tags = normalizeTags([
    ...original.tags.filter((_, i) => (i + seed) % 2 === 0), // 원본 태그 절반은 유지
    ...original.tags.map((t) => titleSynonyms(paraphraseLine(t, { language, seed }), seed)).filter((t, i) => t && t !== original.tags[i]), // 나머지는 유의어
    ...kws.slice(0, 8),
    ...(k1 && k2 ? [`${k1} ${k2}`] : []),
    ...(isKo ? ['영상', '추천', '정리'] : ['video', 'guide', 'tips']).slice(0, 2),
  ]);
  const hashtags = uniqStrings([...(original.tags.slice(0, 2)), ...kws.slice(0, 3)].filter(Boolean).map(hashify)).filter((h, i, arr) => arr.findIndex((x) => x.toLowerCase() === h.toLowerCase()) === i).slice(0, 3); // 대소문자만 다른 해시태그 중복 제거
  const firstWords = (s, n) => stripParens(s).split(/\s+/).filter((w) => !(EN_STOP.has(w.toLowerCase()) && !/[가-힣]/.test(w))).slice(0, n).join(' ');
  const num = (stripped.match(/(\d+)\s*(\S*)/) || []);
  const head1 = shortText(k1 && k1.length <= 8 ? k1 : firstWords(stripped, 2), 8);
  const head2 = num[1] && (COUNT_UNITS.test(num[2] || '') || stripped.startsWith(num[1])) ? `${num[1]}${isKo ? '가지' : ''}` : shortText(firstWords(stripped, 3), 10);
  // 작은 문구는 큰 문구와 겹치지 않는 나머지 부분 (예: 큰 문구 "Rick Astley" → 작은 문구 "Never Gonna Give You Up")
  const rest = (head) => { const r = stripped.replace(new RegExp(reEsc(head), 'i'), '').replace(/^[\s\-–—|:,]+|[\s\-–—|:,]+$/g, '').trim(); return r && r.toLowerCase() !== head.toLowerCase() ? r : ''; };
  const thumbnail = uniqBy([{ headline: head1, subline: shortText(rest(head1) || k2 || '', 18) }, { headline: head2, subline: shortText(rest(head2) || k2 || k1 || '', 18) }].filter((x) => x.headline), (x) => x.headline);
  const description = [titles[0], '', (original.description || '').split('\n').filter((l) => l.trim()).slice(0, 2).map((l) => paraphraseLine(l, { language, seed })).join('\n'), '', hashtags.join(' ')].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n').trim();
  return { engine: 'rules', titles: titles.slice(0, 6), tags, hashtags, thumbnail, description };
}
function uniqBy(list, key) { const seen = new Set(); return list.filter((x) => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; }); }

// ---------- 유틸 ----------
function sanitizeOptions(o = {}) {
  return { style: THUMB_STYLES.some((s) => s.id === o.style) ? o.style : undefined, palette: THUMB_PALETTES[o.palette] ? o.palette : undefined, language: ['ko', 'en', 'ja', 'zh', 'es'].includes(o.language) ? o.language : undefined, headline: o.headline ? String(o.headline).slice(0, 24) : undefined, subline: o.subline != null ? String(o.subline).slice(0, 24) : undefined, fx: o.fx && typeof o.fx === 'object' ? o.fx : undefined };
}
export function normalizeTags(tags) {
  const list = Array.isArray(tags) ? tags : String(tags || '').split(/[,\n]/);
  const out = []; let chars = 0;
  for (const raw of list) { const t = String(raw || '').trim().replace(/^#/, '').replace(/\s+/g, ' '); if (!t || t.length > 30 || out.some((x) => x.toLowerCase() === t.toLowerCase())) continue; if (chars + t.length + 1 > 480 || out.length >= 20) break; out.push(t); chars += t.length + 1; }
  return out;
}
function uniqStrings(list, exclude = '') {
  const out = []; const ex = String(exclude).replace(/\s+/g, ' ').trim().toLowerCase();
  for (const raw of list) { const t = String(raw || '').replace(/\s+/g, ' ').trim(); if (!t || t.length > 120 || t.toLowerCase() === ex || out.some((x) => x.toLowerCase() === t.toLowerCase())) continue; out.push(t); }
  return out;
}
function hashify(t) { return `#${String(t).replace(/^#/, '').replace(/\s+/g, '')}`; }
// 글자 수 제한. 영문은 단어 중간에서 자르지 않고, 끝에 남는 구분 기호(- | : ,)는 뗀다
function shortText(s, n) {
  const t = String(s || '').replace(/\p{Extended_Pictographic}/gu, '').replace(/\s+/g, ' ').trim();
  const max = /[가-힣]/.test(t) ? n : Math.round(n * 1.5);
  let out = t.length > max ? t.slice(0, max) : t;
  if (t.length > max && !/[가-힣]/.test(t) && out.includes(' ')) out = out.slice(0, out.lastIndexOf(' '));
  return out.replace(/[\s\-–—|:,]+$/g, '').trim();
}
function clamp(n, a, b) { return Math.min(b, Math.max(a, n)); }
function decodeDataUrl(dataUrl) {
  const m = String(dataUrl || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new ApiError(400, '이미지 데이터 형식이 올바르지 않습니다 (JPEG/PNG/WebP data URL).');
  const buffer = Buffer.from(m[2], 'base64');
  if (!buffer.length) throw new ApiError(400, '이미지 데이터가 비어 있습니다.');
  if (buffer.length > MAX_IMAGE_BYTES) throw new ApiError(413, '이미지는 6MB 이하로 올려주세요.');
  return { buffer, mime: m[1] };
}
async function fetchImage(url) {
  const host = new URL(url).hostname;
  if (!YT_IMAGE_HOSTS.includes(host) && !/\.vercel-storage\.com$/.test(host)) return null;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const mime = (res.headers.get('content-type') || 'image/jpeg').split(';')[0];
  if (!mime.startsWith('image/')) return null;
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length < 1500 || buffer.length > MAX_IMAGE_BYTES) return null; // 유튜브의 "없음" 자리표시 이미지(아주 작음)는 건너뛴다
  return { buffer, mime, url };
}
async function fetchFirstImage(urls) {
  for (const u of urls) { const r = await fetchImage(u).catch(() => null); if (r) return r; }
  return null;
}
