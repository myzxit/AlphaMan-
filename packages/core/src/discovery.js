// 디스커버리: KR 쇼츠 급상승, 최근 1일 성장 채널, 커뮤니티·뉴스·레딧, 뉴스 TOP, 랜덤 쇼츠, 더보기(페이지네이션)
// 외부 데이터 소스(YouTube Data API / RSS)가 설정되면 실제 데이터를, 아니면 내장 샘플 데이터를 제공한다.
import { ApiError } from './errors.js';

const REGIONS = ['KR', 'US', 'JP', 'ID', 'BR', 'TW', 'GLOBAL'];

const SAMPLE_SHORTS = [
  ['언니 힘들다고 전 재산 보낸 동생', '감동실화TV', 4820000, 312000], ['물속에서 그림을 그리면? #shorts', '아트랩', 3910000, 275000], ['엄청난 오해ㅋㅋㅋㅋ', '웃긴일상', 3400000, 210000],
  ['심리전 고수를 털어먹는 방법', '두뇌게임', 2980000, 188000], ['모두가 자신이 막내로 데뷔할 줄 알았던 하투하 #하츠투하츠 #하투하 #지우 #주은 #유하 #shorts', '케이팝모먼트', 2750000, 240000],
  ['사람이 유명해져야 하는 이유 전우사 사장님 홀린 전세계', '스트릿푸드', 2510000, 150000], ['천만명을 웃겨버린 한국인 커플', '커플일기', 2300000, 132000], ['어릴 때 생긴 웃긴 일 26탄', '썰툰', 2100000, 98000],
  ['국방비 한국의 1.7배, 중동의 맹주 사우디가 후티에게 개박살 나고 있는 이유.', '지식브런치', 1980000, 121000], ['데드풀이 더 무서운 이유', '무비썰', 1870000, 90000],
  ['하루 만에 10kg 감량? 진짜 가능할까', '헬스랩', 1650000, 80000], ['편의점 신상 솔직 리뷰', '먹방여신', 1500000, 72000], ['5분 만에 배우는 엑셀 단축키', '오피스마스터', 1420000, 65000],
  ['고양이가 주인을 무시하는 이유', '냥냥펀치', 1300000, 61000], ['서울 야경 명소 TOP 5', '여행에미치다', 1200000, 50000], ['이 게임 아직도 안 해봤어?', '겜플', 1100000, 45000],
];
const SAMPLE_CHANNELS = [
  ['지식브런치', 'education', 1250000, 210000, 18.4], ['웃긴일상', 'vlog', 830000, 160000, 15.2], ['케이팝모먼트', 'music', 2100000, 140000, 9.8], ['헬스랩', 'info', 410000, 120000, 22.5],
  ['두뇌게임', 'gaming', 690000, 98000, 12.1], ['먹방여신', 'vlog', 1500000, 90000, 7.5], ['오피스마스터', 'education', 320000, 76000, 19.9], ['냥냥펀치', 'vlog', 980000, 70000, 8.8],
  ['무비썰', 'info', 560000, 64000, 10.3], ['여행에미치다', 'vlog', 720000, 52000, 6.4], ['겜플', 'gaming', 250000, 48000, 21.7], ['스트릿푸드', 'vlog', 430000, 41000, 9.1],
];
const SAMPLE_COMMUNITY = [
  ['reddit', 'r/videos', '이 쇼츠 편집 스타일이 요즘 대세인 이유', 5400], ['reddit', 'r/NewTubers', '쇼츠 조회수 10만 찍은 후기 공유', 2100], ['community', '디시 유튜브갤', '롱폼 하나로 쇼츠 10개 뽑는 워크플로우', 1800],
  ['community', '네이버 카페 유튜버모임', '자막 폰트 뭐 쓰세요? 투표', 950], ['reddit', 'r/PartneredYoutube', '쇼츠 수익화 기준 변경 정리', 3300], ['community', '에펨코리아', '요즘 급상승 채널 분석', 1200],
  ['reddit', 'r/videography', 'AI 자막 툴 비교 (Whisper 기반)', 870], ['community', '클리앙', '틱톡 다운로드 막힌 거 해결됨?', 640],
];
const SAMPLE_NEWS = [
  ['유튜브, 쇼츠 최대 길이 3분으로 확대', '테크뉴스', 'platform'], ['틱톡, 영상 응답 방식 변경으로 다운로드 툴 일시 중단', 'IT조선', 'platform'], ['AI 자동 편집 툴 시장 3배 성장', '전자신문', 'industry'],
  ['크리에이터 이코노미 2026 리포트 공개', '매일경제', 'industry'], ['인스타그램 릴스, 자동 자막 기능 업데이트', '디지털데일리', 'platform'], ['스레드, 동영상 예약 게시 지원 시작', '블로터', 'platform'],
  ['OpenAI·Anthropic 모델 업데이트가 영상 자막 정확도에 미친 영향', 'AI타임스', 'ai'], ['국내 숏폼 시청 시간 전년 대비 42% 증가', '연합뉴스', 'industry'],
];

function seeded(i) { return Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1; }

export class DiscoveryService {
  constructor({ store }) { this.store = store; }

  regions() { return REGIONS; }

  home(user) {
    const hour = new Date().getHours();
    const greeting = hour < 12 ? '좋은 아침이에요' : hour < 18 ? '좋은 오후예요' : '좋은 저녁이에요';
    const sub = hour < 12 ? '오늘도 좋은 아이디어가 떠오르길 바라요.' : hour < 18 ? '오후에도 좋은 아이디어가 떠오르길 바라요.' : '저녁에도 좋은 아이디어가 떠오르길 바라요.';
    return {
      greeting: `${greeting}, ${user?.name || '크리에이터'}님`, subtitle: sub,
      entryPoints: [
        { id: 'shorts', label: 'KR 쇼츠 급상승', href: '#/discovery/videos?type=shorts&regions=KR&sort_by=trend', aria: 'KR 쇼츠 급상승으로 바로 이동' },
        { id: 'channels', label: '최근 1일 성장 채널', href: '#/discovery/channels?sort=daily_view&order=desc&days=1&country=KR', aria: '최근 1일 성장 채널로 바로 이동' },
        { id: 'community', label: '커뮤니티·뉴스·레딧', href: '#/discovery/community', aria: '통합 외부 신호 탭으로 바로 이동' },
        { id: 'news', label: '뉴스 TOP', href: '#/discovery/news', aria: '뉴스 외부 신호 탭으로 바로 이동' },
      ],
      tabs: ['쇼츠', '채널', '커뮤니티', '뉴스', '랜덤'],
      top10: this.videos({ type: 'shorts', regions: 'KR', sort_by: 'trend', limit: 10 }).items,
    };
  }

  videos({ type = 'shorts', regions = 'KR', sort_by = 'trend', page = 1, limit = 10, q = '' } = {}) {
    const region = String(regions).split(',')[0].toUpperCase();
    if (!REGIONS.includes(region)) throw new ApiError(400, `지원하지 않는 지역: ${region}`);
    const day = Math.floor(Date.now() / 86400000);
    let items = SAMPLE_SHORTS.map(([title, channel, views, growth], i) => ({
      id: `v-${region}-${i}`, type, title, channel, region,
      views: Math.round(views * (0.8 + seeded(day + i) * 0.4)), growth24h: Math.round(growth * (0.7 + seeded(day * 3 + i) * 0.6)),
      publishedAt: new Date(Date.now() - (i + 1) * 3600e3 * 5).toISOString(),
      thumbnail: `https://picsum.photos/seed/${region}${i}/270/480`, url: `https://www.youtube.com/shorts/sample${i}`, durationSec: 20 + (i % 5) * 9,
    }));
    if (q) items = items.filter((v) => v.title.includes(q) || v.channel.includes(q));
    if (sort_by === 'views') items.sort((a, b) => b.views - a.views);
    else if (sort_by === 'recent') items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    else items.sort((a, b) => b.growth24h - a.growth24h);
    items = items.map((v, i) => ({ ...v, rank: i + 1 }));
    return paginate(items, page, limit);
  }

  channels({ sort = 'daily_view', order = 'desc', days = 1, country = 'KR', page = 1, limit = 10 } = {}) {
    const d = Math.max(1, Math.min(30, Number(days) || 1));
    let items = SAMPLE_CHANNELS.map(([name, genre, subs, dailyViews, growthPct], i) => ({
      id: `c-${country}-${i}`, name, genre, country, subscribers: subs,
      dailyViews: Math.round(dailyViews * d * (0.9 + seeded(i + d) * 0.3)), subscriberGrowthPct: Math.round(growthPct * 10) / 10, newVideos: 1 + (i % 4),
      avatar: `https://picsum.photos/seed/ch${i}/96/96`, url: `https://www.youtube.com/@${encodeURIComponent(name)}`,
    }));
    const key = sort === 'subscribers' ? 'subscribers' : sort === 'growth' ? 'subscriberGrowthPct' : 'dailyViews';
    items.sort((a, b) => (order === 'asc' ? a[key] - b[key] : b[key] - a[key]));
    return paginate(items.map((c, i) => ({ ...c, rank: i + 1 })), page, limit);
  }

  community({ source = 'all', page = 1, limit = 10 } = {}) {
    let items = SAMPLE_COMMUNITY.map(([src, board, title, score], i) => ({ id: `p-${i}`, source: src, board, title, score, url: `https://${src === 'reddit' ? 'reddit.com' : 'community.example'}/${encodeURIComponent(board)}/${i}`, postedAt: new Date(Date.now() - i * 5400e3).toISOString() }));
    if (source !== 'all') items = items.filter((p) => p.source === source);
    return paginate(items, page, limit);
  }

  news({ category = 'all', page = 1, limit = 10 } = {}) {
    let items = SAMPLE_NEWS.map(([title, publisher, cat], i) => ({ id: `n-${i}`, title, publisher, category: cat, url: `https://news.example/${i}`, publishedAt: new Date(Date.now() - i * 7200e3).toISOString() }));
    if (category !== 'all') items = items.filter((n) => n.category === category);
    return paginate(items, page, limit);
  }

  random({ regions = 'KR' } = {}) {
    const all = this.videos({ regions, limit: 100 }).items;
    return all[Math.floor(Math.random() * all.length)];
  }

  // 통합 외부 신호: 쇼츠 + 채널 + 커뮤니티 + 뉴스 한 번에
  signals() {
    return { shorts: this.videos({ limit: 5 }).items, channels: this.channels({ limit: 5 }).items, community: this.community({ limit: 5 }).items, news: this.news({ limit: 5 }).items };
  }
}

function paginate(items, page, limit) {
  const p = Math.max(1, Number(page) || 1); const l = Math.max(1, Math.min(50, Number(limit) || 10));
  return { items: items.slice((p - 1) * l, p * l), page: p, limit: l, total: items.length, hasMore: p * l < items.length };
}
