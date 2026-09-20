// 무료 도구: 로그인 없이 쓸 수 있는 크리에이터 유틸리티 (알파컷 "무료 도구" 메뉴)
import { parseYoutubeUrl } from './media.js';
import { parseSRT, exportSubtitles } from './subtitles/format.js';
import { ApiError } from './errors.js';

export const TOOLS = [
  { id: 'yt-thumbnail', name: '유튜브 썸네일 다운로더', description: '유튜브 링크에서 모든 해상도의 썸네일 URL을 추출합니다.', input: 'url' },
  { id: 'title-generator', name: '쇼츠 제목 생성기', description: '키워드로 클릭을 부르는 쇼츠 제목 10개를 만듭니다.', input: 'text' },
  { id: 'hashtag-generator', name: '해시태그 생성기', description: '주제에 맞는 해시태그 세트를 추천합니다.', input: 'text' },
  { id: 'subtitle-converter', name: '자막 변환기', description: 'SRT ↔ VTT ↔ ASS ↔ TXT 자막 형식을 변환합니다.', input: 'subtitle' },
  { id: 'hook-checker', name: '첫 3초 후킹 점수', description: '오프닝 멘트가 시청자를 잡는지 점수로 평가합니다.', input: 'text' },
  { id: 'credit-calculator', name: '이용권 계산기', description: '영상 길이로 필요한 이용권(분)과 생성될 쇼츠 개수를 계산합니다.', input: 'duration' },
  { id: 'best-upload-time', name: '최적 업로드 시간', description: '타깃 국가·장르에 맞는 업로드 시간대를 추천합니다.', input: 'text' },
  { id: 'yt-id-extractor', name: '유튜브 영상 ID 추출', description: '어떤 형태의 유튜브 링크든 영상 ID와 정규화 링크를 추출합니다.', input: 'url' },
];

export class ToolsService {
  constructor({ ai }) { this.ai = ai; }

  list() { return TOOLS; }

  async run(toolId, input = {}) {
    switch (toolId) {
      case 'yt-thumbnail': {
        const yt = parseYoutubeUrl(input.url);
        return { videoId: yt.id, thumbnails: ['maxresdefault', 'sddefault', 'hqdefault', 'mqdefault', 'default'].map((q) => ({ quality: q, url: `https://i.ytimg.com/vi/${yt.id}/${q}.jpg` })) };
      }
      case 'yt-id-extractor': {
        const yt = parseYoutubeUrl(input.url);
        return { videoId: yt.id, normalized: yt.url, embed: `https://www.youtube.com/embed/${yt.id}`, short: `https://youtu.be/${yt.id}` };
      }
      case 'title-generator': {
        const kw = String(input.text || '').trim();
        if (!kw) throw new ApiError(400, '키워드를 입력해주세요.');
        const fallback = () => [`${kw}, 이거 모르면 손해`, `${kw} 3초 만에 정리`, `아무도 안 알려주는 ${kw}의 비밀`, `${kw} 초보가 꼭 봐야 하는 이유`, `${kw} 실제로 해봤더니…`, `${kw} 1위 vs 꼴찌 차이`, `${kw}? 이것만 기억하세요`, `${kw} 하루 만에 바뀐 결과`, `${kw} 전문가도 놀란 방법`, `${kw} 90%가 틀리는 것`];
        const res = await this.ai.complete({ system: '유튜브 쇼츠 제목 카피라이터. JSON 배열(문자열 10개)로만 답합니다.', prompt: `키워드: ${kw}`, json: true, maxTokens: 2000, fallback });
        return { titles: Array.isArray(res) ? res.slice(0, 10) : fallback() };
      }
      case 'hashtag-generator': {
        const kw = String(input.text || '').trim();
        if (!kw) throw new ApiError(400, '주제를 입력해주세요.');
        const base = kw.split(/\s+/).map((w) => `#${w.replace(/[^\p{L}\p{N}]/gu, '')}`).filter((x) => x.length > 1);
        return { hashtags: [...new Set([...base, '#shorts', '#쇼츠', '#추천', '#fyp', '#viral', '#틱톡', '#릴스'])] };
      }
      case 'subtitle-converter': {
        const segs = parseSRT(input.content || '');
        if (!segs.length) throw new ApiError(400, 'SRT 형식의 자막을 붙여넣어주세요.');
        return { count: segs.length, ...exportSubtitles(segs, input.format || 'vtt') };
      }
      case 'hook-checker': {
        const t = String(input.text || '').trim();
        if (!t) throw new ApiError(400, '오프닝 멘트를 입력해주세요.');
        let score = 40;
        const tips = [];
        if (/\?/.test(t)) score += 15; else tips.push('질문형으로 바꾸면 궁금증을 유발합니다.');
        if (/\d/.test(t)) score += 10; else tips.push('숫자를 넣으면 구체성이 올라갑니다.');
        if (t.length <= 25) score += 15; else tips.push('25자 이내로 줄이면 3초 안에 읽힙니다.');
        if (/비밀|절대|충격|진짜|아무도|손해|이유/.test(t)) score += 15; else tips.push('"비밀/이유/손해" 같은 트리거 단어를 고려하세요.');
        return { score: Math.min(100, score), grade: score >= 80 ? 'A' : score >= 60 ? 'B' : 'C', tips };
      }
      case 'credit-calculator': {
        const min = Number(input.minutes);
        if (!(min > 0)) throw new ApiError(400, '영상 길이(분)를 입력해주세요.');
        return { minutesRequired: Math.round(min * 100) / 100, estimatedShorts: Math.max(1, Math.round(min / 2)), regenerateCost: Math.round((min / 2) * 100) / 100 };
      }
      case 'best-upload-time': {
        const region = String(input.region || 'KR').toUpperCase();
        const table = { KR: ['평일 18:00-21:00', '주말 10:00-12:00', '월/수/금 10:00 (알파컷 기본 예약)'], US: ['Weekdays 12:00-15:00 EST', 'Sat 09:00-11:00 EST'], JP: ['平日 19:00-22:00', '日曜 11:00-13:00'] };
        return { region, slots: table[region] || table.KR };
      }
      default:
        throw new ApiError(404, '도구를 찾을 수 없습니다.');
    }
  }
}
