// 클릭 한 번으로 다국어 번역: 제목/자막을 목표 언어로 번역. Claude 사용 가능 시 실제 번역, 아니면 사전 기반 대체.
import { TRANSLATION_TARGETS } from './i18n.js';

const DICT = {
  ja: [['안녕하세요', 'こんにちは'], ['오늘은', '今日は'], ['정말', '本当に'], ['중요한', '大事な'], ['이야기', '話'], ['준비했어요', '用意しました'], ['꼭', '必ず'], ['끝까지', '最後まで'], ['결과', '結果'], ['방법', '方法'], ['시간', '時間'], ['핵심', 'ポイント'], ['엄청 따뜻해서 좋고', '熱々で良いです'], ['쇼츠', 'ショート'], ['영상', '動画']],
  en: [['안녕하세요', 'Hello'], ['오늘은', 'today'], ['정말', 'really'], ['중요한', 'important'], ['이야기', 'story'], ['준비했어요', 'prepared'], ['꼭', 'definitely'], ['끝까지', 'until the end'], ['결과', 'result'], ['방법', 'method'], ['시간', 'time'], ['핵심', 'key point'], ['엄청 따뜻해서 좋고', 'It is so warm and nice'], ['쇼츠', 'Shorts'], ['영상', 'video']],
  zh: [['안녕하세요', '你好'], ['오늘은', '今天'], ['정말', '真的'], ['중요한', '重要的'], ['이야기', '故事'], ['결과', '结果'], ['방법', '方法'], ['시간', '时间'], ['핵심', '要点'], ['쇼츠', '短视频'], ['영상', '视频']],
  tw: [['안녕하세요', '你好'], ['오늘은', '今天'], ['정말', '真的'], ['중요한', '重要的'], ['이야기', '故事'], ['결과', '結果'], ['방법', '方法'], ['시간', '時間'], ['핵심', '要點'], ['쇼츠', '短影音'], ['영상', '影片']],
  id: [['안녕하세요', 'Halo'], ['오늘은', 'hari ini'], ['정말', 'benar-benar'], ['중요한', 'penting'], ['결과', 'hasil'], ['방법', 'cara'], ['시간', 'waktu'], ['영상', 'video']],
  pt: [['안녕하세요', 'Olá'], ['오늘은', 'hoje'], ['정말', 'realmente'], ['중요한', 'importante'], ['결과', 'resultado'], ['방법', 'método'], ['시간', 'tempo'], ['영상', 'vídeo']],
  es: [['안녕하세요', 'Hola'], ['오늘은', 'hoy'], ['정말', 'realmente'], ['중요한', 'importante'], ['결과', 'resultado'], ['영상', 'video']],
  vi: [['안녕하세요', 'Xin chào'], ['오늘은', 'hôm nay'], ['결과', 'kết quả'], ['영상', 'video']],
  th: [['안녕하세요', 'สวัสดี'], ['오늘은', 'วันนี้'], ['결과', 'ผลลัพธ์'], ['영상', 'วิดีโอ']],
  ko: [['Hello', '안녕하세요'], ['today', '오늘'], ['really', '정말'], ['important', '중요한'], ['result', '결과'], ['video', '영상'], ['Shorts', '쇼츠'], ['thank you', '감사합니다']],
};

export function dictionaryTranslate(text, target) {
  const pairs = DICT[target] || [];
  let out = String(text);
  for (const [from, to] of pairs) out = out.split(from).join(to);
  const label = TRANSLATION_TARGETS.find((t) => t.code === target)?.label || target;
  return out === text ? `[${label}] ${text}` : out;
}

export class TranslateService {
  constructor(ai) { this.ai = ai; }

  targets() { return TRANSLATION_TARGETS; }

  async translateText(text, target, { source = 'auto' } = {}) {
    if (!TRANSLATION_TARGETS.some((t) => t.code === target)) throw new Error(`지원하지 않는 언어: ${target}`);
    const label = TRANSLATION_TARGETS.find((t) => t.code === target).label;
    const result = await this.ai.complete({
      system: '당신은 숏폼 영상 자막/제목 전문 번역가입니다. 원문의 뉘앙스와 길이를 유지하고, 번역문만 출력합니다.',
      prompt: `다음 텍스트를 ${label}(으)로 번역하세요. 원문 언어: ${source}\n\n${text}`,
      maxTokens: 4000,
      fallback: () => dictionaryTranslate(text, target),
    });
    return { text: String(result).trim(), target, engine: this.ai.lastMode };
  }

  async translateSegments(segments, target) {
    const joined = segments.map((s, i) => `${i + 1}|||${s.text}`).join('\n');
    const result = await this.ai.complete({
      system: '자막 번역가입니다. 각 줄은 "번호|||텍스트" 형식입니다. 번호를 유지하며 같은 형식으로 번역만 출력하세요.',
      prompt: `목표 언어: ${TRANSLATION_TARGETS.find((t) => t.code === target)?.label}\n\n${joined}`,
      maxTokens: 16000,
      fallback: () => segments.map((s, i) => `${i + 1}|||${dictionaryTranslate(s.text, target)}`).join('\n'),
    });
    const map = new Map();
    for (const line of String(result).split('\n')) {
      const m = line.match(/^(\d+)\|\|\|(.*)$/);
      if (m) map.set(Number(m[1]), m[2].trim());
    }
    return segments.map((s, i) => ({ ...s, text: map.get(i + 1) ?? dictionaryTranslate(s.text, target), sourceText: s.text, language: target }));
  }
}
