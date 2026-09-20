// 알파토픽: 채널 분석 & 떡상 주제 추천 - 내 채널과 경쟁 채널 분석 후 지금 올리기 좋은 주제·썸네일·대본을 AI가 추천
import { ApiError } from './errors.js';

const TOPIC_BANK = {
  education: ['30일 만에 습관 만드는 법', '공부 효율 2배 올리는 노트 정리법', '시험 전날 꼭 해야 하는 3가지'],
  interview: ['성공한 사람들의 아침 루틴', '10년 경력자가 말하는 이직 타이밍', '처음 창업할 때 몰랐던 것'],
  info: ['2026년 하반기 주목할 주식 3개', '가성비 최고 노트북 비교', '초보자가 절대 하면 안 되는 투자'],
  gaming: ['숨겨진 신캐릭터 공략', '1등 유저의 세팅 공개', '패치 후 달라진 메타 정리'],
  vlog: ['서울 근교 당일치기 여행 코스', '월 50만원 자취 생활비 공개', '혼자 떠난 첫 해외여행'],
};

export class TopicService {
  constructor({ store, ai }) { this.store = store; this.ai = ai; }

  async analyze(userId, { channelUrl, competitors = [], genre = 'info', keywords = [] }) {
    if (!channelUrl) throw new ApiError(400, '내 채널 링크를 입력해주세요.');
    const bank = TOPIC_BANK[genre] || TOPIC_BANK.info;
    const fallback = () => ({
      channelSummary: { name: channelName(channelUrl), genre, postingCadence: '주 2회', avgViews: 12400, subscriberGrowth30d: 3.2, strengths: ['꾸준한 업로드', '명확한 주제'], weaknesses: ['첫 3초 이탈률 높음', '썸네일 대비 낮음'] },
      competitors: competitors.map((c) => ({ url: c, name: channelName(c), avgViews: 25000 + c.length * 300, risingTopics: bank.slice(0, 2) })),
      recommendations: bank.map((title, i) => ({
        rank: i + 1, title, score: 92 - i * 7, reason: '최근 7일 검색·조회 급상승 키워드와 채널 강점이 겹칩니다.',
        thumbnail: { text: title.split(' ').slice(0, 3).join(' '), style: i % 2 ? '얼굴 클로즈업 + 큰 텍스트' : '비교 구도(전/후)', colors: ['#FFD400', '#111111'] },
        script: { hook: `${title}, 아직도 모르셨나요?`, outline: ['문제 제기', '핵심 3가지', '실제 사례', '행동 유도(구독·댓글)'], durationSec: 45 },
        keywords: [...keywords, ...title.split(' ').slice(0, 2)],
      })),
    });
    const report = await this.ai.complete({
      system: '유튜브 채널 성장 컨설턴트입니다. 채널/경쟁 채널을 분석하고 지금 올리기 좋은 주제, 썸네일 문구/구도, 45초 쇼츠 대본을 JSON 으로만 답합니다.',
      prompt: `내 채널: ${channelUrl}\n경쟁 채널: ${competitors.join(', ') || '없음'}\n장르: ${genre}\n키워드: ${keywords.join(', ') || '없음'}\n\n형식: {"channelSummary":{...},"competitors":[...],"recommendations":[{"rank":1,"title":"","score":0,"reason":"","thumbnail":{"text":"","style":"","colors":[]},"script":{"hook":"","outline":[],"durationSec":45},"keywords":[]}]}`,
      json: true, maxTokens: 8000, fallback,
    });
    const rec = this.store.insert('topicReports', { userId, channelUrl, competitors, genre, keywords, report, engine: this.ai.lastMode });
    return rec;
  }

  list(userId) { return this.store.find('topicReports', (r) => r.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  get(userId, id) { const r = this.store.get('topicReports', id); if (!r || r.userId !== userId) throw new ApiError(404, '리포트를 찾을 수 없습니다.'); return r; }

  async generateScript(userId, { title, durationSec = 45, tone = '친근한' }) {
    if (!title) throw new ApiError(400, '주제를 입력해주세요.');
    const fallback = () => `[후킹 0-3초] ${title}, 아직도 모르셨나요?\n[본문] 첫째, 핵심을 한 문장으로 말합니다. 둘째, 왜 중요한지 사례를 보여줍니다. 셋째, 바로 따라 할 수 있는 방법을 알려줍니다.\n[마무리] 더 많은 팁은 구독과 댓글로!`;
    const script = await this.ai.complete({ system: `숏폼 대본 작가입니다. ${tone} 톤으로 ${durationSec}초 분량의 쇼츠 대본을 씁니다.`, prompt: `주제: ${title}`, maxTokens: 3000, fallback });
    return { title, durationSec, tone, script: String(script), engine: this.ai.lastMode };
  }
}

function channelName(url) {
  try { const u = new URL(url); return decodeURIComponent(u.pathname.replace(/^\/@?/, '').split('/')[0]) || u.hostname; } catch { return String(url); }
}
