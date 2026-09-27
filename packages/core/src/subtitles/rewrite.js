// 대본 다시 쓰기: 원본 자막 문장들을 뜻은 그대로 두고 표현만 바꿔 "원본과 거의 비슷한" 새 대본을 만든다.
// AI(Claude)가 있으면 줄 수·길이를 지키며 자연스럽게 바꿔 쓰고, 없으면 규칙 기반(동의어·어미·접속어 교체)으로 바꾼다. 타이밍은 그대로 유지.
const KO_SYNONYMS = [
  ['정말', '진짜'], ['진짜', '정말'], ['아주', '매우'], ['매우', '아주'], ['너무', '굉장히'], ['굉장히', '너무'], ['그래서', '그러니까'], ['하지만', '그런데'], ['그런데', '하지만'],
  ['왜냐하면', '이유는'], ['여러분', '여러분들'], ['방법', '방식'], ['중요한', '핵심적인'], ['핵심', '포인트'], ['시작', '출발'], ['마지막으로', '끝으로'], ['먼저', '우선'], ['우선', '먼저'],
  ['지금', '이제'], ['이제', '지금'], ['많이', '잔뜩'], ['빨리', '빠르게'], ['쉽게', '간단하게'], ['간단하게', '쉽게'], ['확인', '체크'], ['문제', '이슈'], ['결과', '결과물'],
  ['사용', '활용'], ['활용', '사용'], ['이야기', '얘기'], ['얘기', '이야기'], ['영상', '비디오'], ['오늘은', '오늘'], ['꼭', '반드시'], ['반드시', '꼭'], ['보통', '대개'], ['거의', '대부분'],
  ['조금', '약간'], ['약간', '조금'], ['처음', '맨 처음'], ['이유', '까닭'], ['비밀', '노하우'], ['실수', '실패'], ['놀라운', '깜짝 놀랄'], ['생각', '판단'], ['알려드릴게요', '소개할게요'],
  ['소개할게요', '알려드릴게요'], ['준비했어요', '가져왔어요'], ['끝까지', '마지막까지'], ['도움', '보탬'], ['질문', '궁금한 점'], ['댓글', '댓글창'],
];
const KO_ENDINGS = [
  [/했습니다([.!?]?)$/, '했어요$1'], [/입니다([.!?]?)$/, '이에요$1'], [/합니다([.!?]?)$/, '해요$1'], [/됩니다([.!?]?)$/, '돼요$1'], [/있습니다([.!?]?)$/, '있어요$1'], [/없습니다([.!?]?)$/, '없어요$1'],
  [/것입니다([.!?]?)$/, '거예요$1'], [/겁니다([.!?]?)$/, '거예요$1'], [/드립니다([.!?]?)$/, '드릴게요$1'], [/봅시다([.!?]?)$/, '보죠$1'], [/주세요([.!?]?)$/, '주시면 돼요$1'],
  [/했어요([.!?]?)$/, '했습니다$1'], [/이에요([.!?]?)$/, '입니다$1'], [/예요([.!?]?)$/, '입니다$1'], [/해요([.!?]?)$/, '합니다$1'], [/돼요([.!?]?)$/, '됩니다$1'], [/있어요([.!?]?)$/, '있습니다$1'], [/없어요([.!?]?)$/, '없습니다$1'],
  [/거예요([.!?]?)$/, '것입니다$1'], [/볼게요([.!?]?)$/, '보겠습니다$1'], [/할게요([.!?]?)$/, '하겠습니다$1'], [/거든요([.!?]?)$/, '기 때문이에요$1'],
];
const EN_SYNONYMS = [
  ['really', 'truly'], ['very', 'extremely'], ['important', 'key'], ['start', 'begin'], ['but', 'however'], ['so', 'therefore'], ['now', 'right now'], ['make', 'create'], ['use', 'utilize'],
  ['easy', 'simple'], ['quick', 'fast'], ['first', 'to begin with'], ['finally', 'lastly'], ['remember', 'keep in mind'], ['show', 'demonstrate'], ['help', 'assist'], ['big', 'huge'],
  ['small', 'tiny'], ['get', 'grab'], ['think', 'believe'], ['maybe', 'perhaps'], ['also', 'as well'], ['because', 'since'], ['amazing', 'incredible'], ['good', 'great'],
];

export function paraphraseLine(text, { language = 'ko', seed = 0 } = {}) {
  let t = String(text || '').trim();
  if (!t) return t;
  const isKo = /[가-힣]/.test(t); // 언어 설정과 무관하게 실제 한글 문장에만 한국어 규칙
  if (isKo) {
    // 동의어: 줄마다 다른 항목부터 시도해 문장마다 표현이 달라지게 (최대 2곳)
    let swapped = 0;
    for (let k = 0; k < KO_SYNONYMS.length && swapped < 2; k++) {
      const [a, b] = KO_SYNONYMS[(k + seed) % KO_SYNONYMS.length];
      if (t.includes(a)) { t = t.replace(a, b); swapped += 1; }
    }
    // 어미 바꾸기 (존댓말 ↔ 격식체)
    for (const [re, rep] of KO_ENDINGS) { if (re.test(t)) { t = t.replace(re, rep); break; } }
    // 군더더기 정리 + 접속어 변주
    t = t.replace(/^(자,|자 |음,|어,|그니까 )\s*/, '');
    if (seed % 3 === 0 && /^(이|그|저)/.test(t) === false && !/^(그러면|그런데|그래서|하지만)/.test(t) && t.length > 12 && seed % 6 === 0) t = `그러면 ${t}`;
  } else {
    let swapped = 0;
    for (let k = 0; k < EN_SYNONYMS.length && swapped < 2; k++) {
      const [a, b] = EN_SYNONYMS[(k + seed) % EN_SYNONYMS.length];
      const re = new RegExp(`\\b${a}\\b`, 'i');
      if (re.test(t)) { t = t.replace(re, (m) => (m[0] === m[0].toUpperCase() ? b[0].toUpperCase() + b.slice(1) : b)); swapped += 1; }
    }
    t = t.replace(/\bcan't\b/gi, 'cannot').replace(/\bdon't\b/gi, 'do not').replace(/\bit's\b/gi, 'it is').replace(/\bI'm\b/g, 'I am');
  }
  return t.replace(/\s+/g, ' ').trim();
}

// segments: [{start,end,text,...}] → 같은 개수·같은 타이밍의 새 문장. 반환 { segments, engine, changed }
export async function rewriteSegments(segments, { language = 'ko', ai = null, tone = '원본과 같은 톤' } = {}) {
  const src = (segments || []).map((s) => ({ ...s }));
  if (!src.length) return { segments: src, engine: 'none', changed: 0 };
  const fallback = () => src.map((s, i) => paraphraseLine(s.text, { language, seed: i }));
  let texts = null; let engine = 'rules';
  if (ai && typeof ai.complete === 'function') {
    const res = await ai.complete({
      system: `영상 대본 작가입니다. 주어진 자막 문장들을 뜻·순서·정보는 그대로 두고 표현만 바꿔 "원본과 거의 비슷하지만 새로 쓴" 대본을 만듭니다. 줄 수는 반드시 같고, 각 줄 길이는 원본의 ±25% 안, 언어는 원본과 같게(${language}), ${tone}. JSON 문자열 배열로만 답합니다.`,
      prompt: JSON.stringify(src.map((s) => s.text)),
      json: true, maxTokens: 12000, fallback,
    }).catch(() => null);
    if (Array.isArray(res) && res.length === src.length && res.every((x) => typeof x === 'string' && x.trim())) { texts = res.map((x) => x.trim()); engine = ai.lastMode && ai.lastMode !== 'heuristic' ? ai.lastMode : 'rules'; }
  }
  if (!texts) { texts = fallback(); engine = 'rules'; }
  let changed = 0;
  const out = src.map((s, i) => { const text = texts[i] || s.text; if (text !== s.text) changed += 1; return { ...s, text, originalText: s.text }; });
  return { segments: out, engine, changed };
}
