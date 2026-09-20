// 쇼츠 디자인 템플릿: "인기 유튜버들이 쓰는 템플릿들을 보고 고르기만 하면 끝!"
export const TEMPLATES = [
  { id: 'clean-bold', name: '클린 볼드', genre: ['education', 'info'], font: 'Black Han Sans', fontSize: 72, color: '#FFFFFF', highlight: '#FFD400', outline: '#000000', position: 'bottom', animation: 'pop', bg: 'blur', description: '굵은 자막 + 키워드 강조. 강의/정보 영상에 최적' },
  { id: 'talk-caption', name: '토크 캡션', genre: ['interview', 'vlog'], font: 'Noto Sans KR', fontSize: 60, color: '#FFFFFF', highlight: '#4DD4FF', outline: '#0B0B0B', position: 'center-bottom', animation: 'word-highlight', bg: 'none', description: '한 단어씩 하이라이트되는 인터뷰형 자막' },
  { id: 'gamer-neon', name: '게이머 네온', genre: ['gaming'], font: 'Jua', fontSize: 68, color: '#F3FF7A', highlight: '#FF3CAC', outline: '#1A0033', position: 'top', animation: 'shake', bg: 'none', description: '네온 컬러 + 흔들림 효과. 게임/스트리밍용' },
  { id: 'vlog-soft', name: '브이로그 소프트', genre: ['vlog'], font: 'Gowun Dodum', fontSize: 56, color: '#FFFFFF', highlight: '#FFB4C6', outline: '#3A3A3A', position: 'bottom', animation: 'fade', bg: 'none', description: '부드러운 페이드 자막. 감성 브이로그' },
  { id: 'news-ticker', name: '뉴스 티커', genre: ['info', 'education'], font: 'IBM Plex Sans KR', fontSize: 54, color: '#FFFFFF', highlight: '#FF4B4B', outline: '#000000', position: 'bottom-bar', animation: 'slide', bg: 'bar', description: '하단 바 형태의 정보 전달형 자막' },
  { id: 'review-box', name: '리뷰 박스', genre: ['info'], font: 'Do Hyeon', fontSize: 62, color: '#111111', highlight: '#FFFFFF', outline: 'none', position: 'center', animation: 'pop', bg: 'box', description: '흰 박스 배경의 리뷰형 자막' },
  { id: 'meme-impact', name: '밈 임팩트', genre: ['gaming', 'vlog', 'interview'], font: 'Gasoek One', fontSize: 84, color: '#FFFFFF', highlight: '#FFEA00', outline: '#000000', position: 'top', animation: 'bounce', bg: 'none', description: '큼직한 밈 스타일 자막' },
  { id: 'minimal-line', name: '미니멀 라인', genre: ['education', 'interview'], font: 'Nanum Gothic', fontSize: 52, color: '#FFFFFF', highlight: '#FFFFFF', outline: '#000000', position: 'bottom', animation: 'none', bg: 'none', description: '효과 없는 깔끔한 기본 자막' },
  { id: 'split-face', name: '스플릿 페이스', genre: ['interview', 'gaming'], font: 'Noto Sans KR', fontSize: 58, color: '#FFFFFF', highlight: '#00E5A0', outline: '#000000', position: 'center', animation: 'word-highlight', bg: 'split', layout: 'split', description: '화면 분할(상: 게임/자료, 하: 얼굴) 레이아웃' },
  { id: 'karaoke', name: '가라오케', genre: ['vlog', 'interview'], font: 'Dongle', fontSize: 80, color: '#FFFFFF', highlight: '#FF7A00', outline: '#000000', position: 'bottom', animation: 'karaoke', bg: 'none', description: '읽는 위치가 색으로 채워지는 노래방 자막' },
];

export const GENRES = [
  { id: 'education', name: '교육 및 강의', rules: { minClip: 35, maxClip: 60, hook: 'question', silenceThreshold: 0.6, zoom: 'speaker' } },
  { id: 'interview', name: '인터뷰 및 토크', rules: { minClip: 30, maxClip: 59, hook: 'quote', silenceThreshold: 0.8, zoom: 'speaker-switch' } },
  { id: 'info', name: '정보 및 리뷰', rules: { minClip: 25, maxClip: 55, hook: 'number', silenceThreshold: 0.5, zoom: 'product' } },
  { id: 'gaming', name: '게임 및 스트리밍', rules: { minClip: 15, maxClip: 45, hook: 'reaction', silenceThreshold: 0.3, zoom: 'action' } },
  { id: 'vlog', name: '브이로그 및 라이프', rules: { minClip: 20, maxClip: 50, hook: 'scene', silenceThreshold: 0.7, zoom: 'soft' } },
];

export const RATIOS = ['9:16', '1:1', '4:5', '16:9'];

export function detectGenre(title = '', transcriptText = '') {
  const t = `${title} ${transcriptText}`.toLowerCase();
  const score = {
    gaming: /게임|스트리밍|롤|배그|플레이|스트리머|game|stream/.test(t) ? 3 : 0,
    education: /강의|수업|공부|배우|설명|튜토리얼|lesson|course|how to/.test(t) ? 3 : 0,
    interview: /인터뷰|토크|대담|질문|팟캐스트|interview|talk|podcast/.test(t) ? 3 : 0,
    info: /리뷰|추천|정보|비교|주식|투자|review|tips|top/.test(t) ? 2 : 0,
    vlog: /브이로그|일상|여행|먹방|vlog|daily|travel/.test(t) ? 3 : 0,
  };
  const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : 'info';
}

export function templateFor(genre) {
  return TEMPLATES.find((tpl) => tpl.genre.includes(genre)) || TEMPLATES[0];
}
