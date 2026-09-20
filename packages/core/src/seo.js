// 유튜브 최적화(SEO): 원본 영상의 제목·태그·설명을 참고해 "원본과 거의 비슷한" 제목과, 유튜브 추천(홈/쇼츠 피드)에 잘 뜨는
// 최고 추천 제목 후보 · 설명 · 태그 · 해시태그 · 업로드 시간 · 알고리즘 체크리스트를 만든다. AI 가 있으면 더 정교하게, 없어도 규칙 기반으로 동작.
const STOP = new Set(['그리고', '그래서', '하지만', '그런데', '이제', '정말', '진짜', '근데', '이거', '저거', '그거', '오늘', '영상', '여러분', '우리', '제가', '저는', '이게', '그게', '있는', '없는', '하는', '되는', '합니다', '있습니다', '됩니다', '거예요', '이런', '저런', '그런', '너무', '아주', '좀', '더', '또', '것', '수', '때', '분', '및', '등', 'the', 'and', 'this', 'that', 'with', 'for', 'you', 'are', 'was', 'have']);
const PARTICLES = /(은|는|이|가|을|를|의|에|에서|도|로|으로|과|와|께|한테|에게|까지|부터|처럼|만|밖에|이다|입니다|했다|해요|해서|하고|하면|이라|라고|라는|이라는|들|요)$/;

export const BEST_POST_TIMES = {
  default: ['평일 18:00~21:00 (퇴근·저녁)', '주말 10:00~12:00', '쇼츠는 매일 같은 시간에 1~2개'],
  education: ['평일 07:00~09:00 (출근길)', '평일 20:00~22:00', '일요일 저녁'],
  gaming: ['평일 21:00~24:00', '금·토 저녁', '방학·연휴 낮'],
  vlog: ['주말 오전', '평일 19:00~21:00', '금요일 저녁'],
};

export class SeoService {
  constructor({ ai }) { this.ai = ai; }

  async generate({ kind = 'shorts', title = '', hook = '', originalTitle = '', originalTags = [], originalDescription = '', channel = '', segments = [], genre = 'general', durationSec = 0, language = 'ko' }) {
    const text = segments.map((s) => s.text).join(' ');
    const keywords = extractKeywords(`${originalTitle} ${originalTitle} ${title} ${hook} ${text}`);
    const heuristic = () => buildHeuristic({ kind, title, hook, originalTitle, originalTags, originalDescription, channel, keywords, segments, genre, durationSec });
    const base = heuristic();
    if (!this.ai) return base;
    const res = await this.ai.complete({
      system: '당신은 한국 유튜브 성장 전문가입니다. 원본 영상 제목·태그와 대본을 보고 (1) 원본 제목과 거의 비슷한 제목 1개 (2) 유튜브 추천 알고리즘(클릭률·시청 지속)에 최적화된 제목 후보 4개 (3) 설명 (4) 태그 15개 (5) 해시태그 3개 (6) 썸네일 문구(6자 이내 2줄)를 JSON 으로만 답합니다. 형식: {"similarTitle":"","titles":[{"text":"","reason":""}],"description":"","tags":[],"hashtags":[],"thumbnailText":["",""]}',
      prompt: `종류: ${kind}\n원본 제목: ${originalTitle}\n원본 태그: ${originalTags.join(', ')}\n채널: ${channel}\n장르: ${genre}\n길이: ${Math.round(durationSec)}초\n클립 제목: ${title}\n후킹: ${hook}\n대본(앞부분): ${text.slice(0, 1500)}`,
      json: true, maxTokens: 2000, fallback: () => null,
    });
    if (!res || typeof res !== 'object') return base;
    const titles = Array.isArray(res.titles) && res.titles.length ? res.titles.map((t, i) => scoreTitle({ text: String(t.text || t).slice(0, 100), reason: t.reason || 'AI 추천', kind, keywords, rank: i })) : base.titles;
    return {
      ...base, engine: 'ai',
      similarTitle: String(res.similarTitle || base.similarTitle).slice(0, 100),
      titles: titles.sort((a, b) => b.score - a.score), bestTitle: titles.sort((a, b) => b.score - a.score)[0].text,
      description: String(res.description || base.description), tags: dedupeTags([...(Array.isArray(res.tags) ? res.tags : []), ...base.tags]),
      hashtags: (Array.isArray(res.hashtags) && res.hashtags.length ? res.hashtags : base.hashtags).map(hashify).slice(0, 3),
      thumbnailText: Array.isArray(res.thumbnailText) && res.thumbnailText.length ? res.thumbnailText.map((x) => String(x).slice(0, 12)) : base.thumbnailText,
    };
  }
}

export function extractKeywords(text, limit = 12) {
  const counts = new Map();
  for (const raw of String(text || '').split(/[\s,.!?~()\[\]"'“”‘’:;|/\\#]+/)) {
    let w = raw.trim();
    if (!w || w.length < 2 || /^\d+$/.test(w) || STOP.has(w)) continue;
    if (/[가-힣]/.test(w) && w.length > 2) w = w.replace(PARTICLES, '');
    if (w.length < 2 || STOP.has(w)) continue;
    // 한국어 대본에서는 한글 키워드를 우선 (원본 제목의 영문 고유명사가 앞서지 않도록)
    counts.set(w, (counts.get(w) || 0) + 1 + (w.length >= 4 ? 0.3 : 0) + (/[가-힣]/.test(w) ? 0.6 : 0));
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([w]) => w);
}

function buildHeuristic({ kind, title, hook, originalTitle, originalTags, originalDescription, channel, keywords, segments, genre, durationSec }) {
  const kw = keywords.slice(0, 5); const k1 = kw[0] || title || '핵심'; const k2 = kw[1] || '';
  const orig = String(originalTitle || '').trim();
  const prefix = (orig.match(/^(\[[^\]]+\]|\([^)]+\)|【[^】]+】)\s*/) || [])[0] || '';
  const suffixEmoji = (orig.match(/(\p{Extended_Pictographic}+)\s*$/u) || [])[1] || '';
  const baseTitle = (title || hook || k1).replace(/\s*🔥$/, '').trim();
  const isShorts = kind === 'shorts';
  // 원본과 거의 비슷한 제목: 원본의 접두([채널]·(시리즈))·이모지·문체를 그대로 두고 핵심만 이 영상에 맞춘다
  const similarTitle = clampTitle(orig ? `${prefix}${orig.replace(prefix, '').replace(/(\p{Extended_Pictographic}+)\s*$/u, '').trim()}${isShorts && baseTitle && !orig.includes(baseTitle) ? ` | ${baseTitle}` : ''}${suffixEmoji ? ` ${suffixEmoji}` : ''}`.trim() : baseTitle, isShorts ? 60 : 80);
  const first = segments[0]?.text?.split(/[,.!?]/)[0]?.trim() || '';
  const number = (`${baseTitle} ${first}`.match(/\d+/) || [])[0];
  const candidates = [
    { text: `${prefix}${baseTitle}${k2 && !baseTitle.includes(k2) ? ` (${k2})` : ''}${isShorts ? ' #shorts' : ''}`, reason: '핵심 키워드 + 쇼츠 태그 — 검색·추천 동시 노출' },
    { text: `${k1}${/[?？]$/.test(baseTitle) ? '' : ','} 이것만 알면 끝${number ? ` (${number}가지)` : ''}`, reason: '호기심 유발형 — 클릭률(CTR) 높은 패턴' },
    { text: `왜 ${k1}${/[가-힣]$/.test(k1) ? '이' : ''} 중요할까? ${hook || baseTitle}`.slice(0, 70), reason: '질문형 — 시청 지속시간에 유리' },
    { text: `${orig ? orig.replace(prefix, '').replace(/(\p{Extended_Pictographic}+)\s*$/u, '').trim().slice(0, 30) : k1} ${isShorts ? '핵심 요약' : '완벽 정리'}${durationSec ? ` (${isShorts ? `${Math.round(durationSec)}초` : `${Math.max(1, Math.round(durationSec / 60))}분`})` : ''}`, reason: '원본 제목 + 요약 — 원본 시청자 유입' },
    { text: `${hook || baseTitle}${suffixEmoji ? ` ${suffixEmoji}` : ' 🔥'}`, reason: '후킹 멘트 그대로 — 첫 3초와 제목 일치' },
  ].map((c, i) => scoreTitle({ text: clampTitle(c.text, isShorts ? 60 : 80), reason: c.reason, kind, keywords, rank: i }));
  const titles = candidates.sort((a, b) => b.score - a.score);
  const summary = segments.slice(0, 3).map((s) => `• ${s.text}`).join('\n');
  const hashtags = [...new Set([...(isShorts ? ['shorts'] : []), ...kw.slice(0, 3)])].map(hashify).slice(0, 3);
  const tags = dedupeTags([...kw, ...(originalTags || []).slice(0, 10), ...(isShorts ? ['쇼츠', 'shorts', '숏폼'] : []), genre !== 'general' ? genre : '', channel, ...(orig ? extractKeywords(orig, 5) : [])]);
  const description = [
    hook || baseTitle, '', summary, '',
    `${orig ? `원본: ${orig}${channel ? ` — ${channel}` : ''}` : ''}`,
    (originalDescription || '').split('\n').slice(0, 2).join('\n'),
    '', '👍 도움이 됐다면 좋아요 · 구독 · 알림 설정 🔔', '', hashtags.join(' '),
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n').trim();
  const thumbnailText = [k1.slice(0, 8), (number ? `${number}가지` : (hook || baseTitle).split(/\s+/).slice(0, 2).join(' ')).slice(0, 8)];
  return {
    engine: 'rules', similarTitle, titles, bestTitle: titles[0].text, description, tags, hashtags, keywords: kw, thumbnailText,
    bestPostTimes: BEST_POST_TIMES[genre] || BEST_POST_TIMES.default,
    checklist: checklist({ kind, title: titles[0].text, hook, tags, hashtags, segments, durationSec }),
  };
}

function scoreTitle({ text, reason, kind, keywords, rank }) {
  let score = 60 - rank * 3;
  const ideal = kind === 'shorts' ? 40 : 60;
  if (text.length <= ideal) score += 12; else if (text.length <= ideal + 20) score += 4; else score -= 10;
  if (/\d/.test(text)) score += 6;
  if (/[?？]/.test(text)) score += 5;
  if (keywords[0] && text.includes(keywords[0])) score += 10;
  if (/\p{Extended_Pictographic}/u.test(text)) score += 2;
  if (/#shorts/i.test(text) && kind === 'shorts') score += 4;
  return { text, reason, score: Math.max(1, Math.min(100, Math.round(score))) };
}

function checklist({ kind, title, hook, tags, hashtags, segments, durationSec }) {
  const items = [
    ['첫 3초 후킹 멘트', Boolean(hook), '첫 3초 안에 궁금증을 만들면 시청 지속률이 올라갑니다'],
    [`제목 ${kind === 'shorts' ? 40 : 60}자 이내`, title.length <= (kind === 'shorts' ? 40 : 60), '모바일 목록에서 잘리지 않는 길이'],
    ['자막 100% (원본 대본)', segments.length > 0, '무음 시청 환경에서도 이해 가능'],
    ['해시태그 3개', hashtags.length >= 3, '설명 끝 해시태그 3개까지가 제목 아래에 표시됩니다'],
    ['태그 10~15개', tags.length >= 10 && tags.length <= 20, '검색·연관 동영상 매칭'],
    ['영상 끝 구독·좋아요 CTA', true, '종료 화면에 구독 버튼 카드가 들어갑니다'],
    ['썸네일 문구 6자 이내 2줄', true, '작은 화면에서도 읽히는 큰 글씨'],
    kind === 'shorts' ? ['쇼츠 길이 60초 이내', durationSec <= 60, '60초를 넘으면 쇼츠 피드에 노출되지 않습니다'] : ['챕터·타임스탬프', true, '설명에 타임스탬프를 넣으면 검색 노출이 늘어납니다'],
  ];
  return items.map(([label, ok, tip]) => ({ label, ok: Boolean(ok), tip }));
}

function clampTitle(t, max) { const s = String(t).replace(/\s+/g, ' ').trim(); return s.length > max ? `${s.slice(0, max - 1)}…` : s; }
function hashify(t) { return `#${String(t).replace(/^#/, '').replace(/\s+/g, '')}`; }
function dedupeTags(list) {
  const out = []; let chars = 0;
  for (const raw of list) { const t = String(raw || '').trim().replace(/^#/, ''); if (!t || t.length > 30 || out.some((x) => x.toLowerCase() === t.toLowerCase())) continue; if (chars + t.length + 1 > 480 || out.length >= 20) break; out.push(t); chars += t.length + 1; }
  return out;
}
