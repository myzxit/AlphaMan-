// 픽시 커맨드 센터: "채팅으로 작업을 시작하고, 필요한 순간에만 편집기로 이어지는" 챗봇 + 관리자 전달(문의) 기능
import { ApiError } from './errors.js';

const FAQ = [
  { q: /어떤 서비스|뭐하는|소개/, a: 'AlphaMan은 AI 기반 쇼츠 자동 제작(알파컷)과 자막 생성·편집(픽셀링)을 한 곳에서 제공합니다. 링크만 넣으면 하이라이트 쇼츠를 만들고, 음성 인식(STT)으로 자막을 만들어 의미 단위로 나누고 다국어 번역까지 원클릭으로 지원합니다.' },
  { q: /무료|가격|요금|얼마/, a: '기본 기능은 무료입니다. 회원가입 시 30분 무료 이용권을 드리고, 쇼츠 제작은 원본 영상 길이만큼 이용권이 차감됩니다. 자세한 요금제는 가격 안내 페이지에서 확인하세요.' },
  { q: /몇 개|개수|얼마나 생성/, a: '쇼츠는 원본 영상 길이 2분당 1개 꼴로 생성됩니다. 10분 영상이면 약 5개가 만들어져요.' },
  { q: /재생성|다시 만들|수정/, a: '결과 화면에서 "재생성하기"를 누르면 새로 만들 수 있고, 이때는 최초 이용권의 절반만 차감됩니다. 제목·길이·비율·템플릿은 편집 기능에서 바로 수정할 수 있어요.' },
  { q: /형식|내보내|srt|vtt|ass/i, a: '자막은 SRT, VTT, ASS, TXT 형식으로 내보낼 수 있어 대부분의 영상 편집 소프트웨어와 호환됩니다.' },
  { q: /정확도|whisper|음성 인식|stt/i, a: '최신 Whisper 모델로 높은 정확도의 음성 인식을 제공하며 한국어·영어·일본어 등 다양한 언어를 지원합니다. 파형 기반 편집기로 세밀한 수정도 가능해요.' },
  { q: /플랫폼|틱톡|릴스|지원/, a: 'YouTube Shorts, TikTok, Instagram Reels 등 숏폼 제작에 최적화되어 있습니다. 다만 TikTok 은 영상 응답 방식 변경으로 일부 다운로드가 일시적으로 제한될 수 있어요.' },
  { q: /팀|공유|여러 명/, a: '팀 계정(이용권 공유)은 비즈니스 요금제 또는 "팀 계정 문의"로 신청하실 수 있습니다.' },
  { q: /해외|overseas|외국/, a: '해외 거주 중이시면 해외 결제 전용 페이지에서 해외 카드로 결제하실 수 있습니다.' },
];

const INTENTS = [
  { re: /쇼츠|숏폼|하이라이트|잘라/, action: { type: 'open', target: '#/studio', label: '쇼츠 스튜디오 열기' }, reply: '롱폼 링크나 파일을 넣으면 하이라이트 쇼츠를 만들어 드릴게요. 쇼츠 스튜디오로 이동할까요?' },
  { re: /자막|캡션|subtitle/i, action: { type: 'open', target: '#/subtitles', label: '자막 편집기 열기' }, reply: '영상을 올리면 음성 인식으로 자막을 만들고 파형 편집기에서 다듬을 수 있어요. 자막 편집기로 이동할까요?' },
  { re: /번역|영어로|일본어로|translate/i, action: { type: 'open', target: '#/subtitles', label: '번역하러 가기' }, reply: '자막이나 제목을 클릭 한 번으로 다국어 번역할 수 있어요.' },
  { re: /업로드|예약|인스타|틱톡|유튜브에 올/, action: { type: 'open', target: '#/publish', label: 'SNS 업로드 열기' }, reply: '완성된 쇼츠를 모든 SNS에 한 번에 예약 업로드할 수 있어요. 기본 예약은 월·수·금 오전 10시입니다.' },
  { re: /주제|떡상|뭘 올려|아이디어|분석/, action: { type: 'open', target: '#/topic', label: '알파토픽 열기' }, reply: '내 채널과 경쟁 채널을 분석해 지금 올리기 좋은 주제와 썸네일·대본을 추천해 드릴게요.' },
  { re: /급상승|트렌드|랜덤|디스커버리/, action: { type: 'open', target: '#/discovery', label: '디스커버리 열기' }, reply: 'KR 쇼츠 급상승과 성장 채널, 커뮤니티·뉴스 신호를 디스커버리에서 볼 수 있어요.' },
];

export class PixieService {
  constructor({ store, ai, support }) { this.store = store; this.ai = ai; this.support = support; }

  threads(userId) { return this.store.find('pixieThreads', (t) => t.userId === userId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }

  _thread(userId, threadId) {
    if (threadId) {
      const t = this.store.get('pixieThreads', threadId);
      if (!t || t.userId !== userId) throw new ApiError(404, '대화를 찾을 수 없습니다.');
      return t;
    }
    return this.store.insert('pixieThreads', { userId, title: '새 대화', messages: [] });
  }

  async chat(user, { threadId = null, message }) {
    if (!message || !String(message).trim()) throw new ApiError(400, '메시지를 입력해주세요.');
    const thread = this._thread(user?.id || 'guest', threadId);
    const text = String(message).trim();
    const faq = FAQ.find((f) => f.q.test(text));
    const intent = INTENTS.find((i) => i.re.test(text));
    const fallback = () => faq?.a || intent?.reply || '무엇을 도와드릴까요? 쇼츠 제작, 자막 편집, 번역, SNS 예약 업로드, 주제 추천, 디스커버리 중에서 말씀해주세요. 해결이 어려우면 "관리자에게 전달"을 눌러 문의를 남길 수 있어요.';
    const history = thread.messages.slice(-10).map((m) => `${m.role === 'user' ? '사용자' : '픽시'}: ${m.text}`).join('\n');
    const reply = await this.ai.complete({
      system: 'You are Pixie(픽시), the command-center assistant of AlphaMan. Answer in Korean, concisely. Product facts: AI highlight shorts from a link (1 clip per 2 minutes, credits charged by source length, regenerate costs half), auto subtitles via Whisper with semantic split, waveform editor, translation (en/ja/zh...), export SRT/VTT/ASS, SNS scheduling (YouTube/Instagram/TikTok/Threads/Facebook, default Mon/Wed/Fri 10:00), AlphaTopic channel analysis, Discovery trends. Free basic features, 30 free minutes at signup. If the user needs a human, tell them to use "관리자에게 전달".',
      prompt: `${history}\n사용자: ${text}\n픽시:`, maxTokens: 1500, fallback,
    });
    const actions = intent ? [intent.action] : [];
    actions.push({ type: 'escalate', label: '관리자에게 전달' });
    const updated = this.store.update('pixieThreads', thread.id, (t) => ({
      title: t.messages.length ? t.title : text.slice(0, 30),
      messages: [...t.messages, { role: 'user', text, at: new Date().toISOString() }, { role: 'assistant', text: String(reply).trim(), at: new Date().toISOString(), actions }],
    }));
    return { threadId: thread.id, reply: String(reply).trim(), actions, engine: this.ai.lastMode, thread: updated };
  }

  // "현재 대화 내용이 관리자에게 전달됩니다. 답변은 이 채팅에서 확인할 수 있으며 최대 24시간이 걸릴 수 있습니다."
  escalate(user, { threadId, email, extra = '' }) {
    const thread = this._thread(user?.id || 'guest', threadId);
    const lastUser = [...thread.messages].reverse().find((m) => m.role === 'user');
    const inquiry = this.support.createInquiry({ user, email, message: lastUser?.text || '(대화 내용 참조)', extra, transcript: thread.messages, category: 'pixie' });
    this.store.update('pixieThreads', thread.id, (t) => ({ inquiryId: inquiry.id, messages: [...t.messages, { role: 'system', text: '현재 대화 내용이 관리자에게 전달됩니다. 답변은 이 채팅에서 확인할 수 있으며 최대 24시간이 걸릴 수 있습니다.', at: new Date().toISOString() }] }));
    return { inquiryId: inquiry.id, threadId: thread.id };
  }

  // 관리자 답변을 채팅에 반영
  syncAdminReplies(userId, threadId) {
    const thread = this._thread(userId, threadId);
    if (!thread.inquiryId) return thread;
    const inq = this.store.get('inquiries', thread.inquiryId);
    if (!inq) return thread;
    const adminMsgs = inq.messages.filter((m) => m.from === 'admin');
    const have = new Set(thread.messages.filter((m) => m.role === 'admin').map((m) => m.at));
    const missing = adminMsgs.filter((m) => !have.has(m.at)).map((m) => ({ role: 'admin', text: m.text, at: m.at }));
    if (!missing.length) return thread;
    return this.store.update('pixieThreads', thread.id, (t) => ({ messages: [...t.messages, ...missing] }));
  }
}
