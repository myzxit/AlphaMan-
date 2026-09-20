// 자막 폰트 카탈로그 (픽셀링 편집기에 번들된 한글 폰트 목록). Google Fonts 에서 로드하며, 프로그램 버전은 로컬 설치 폰트도 사용한다.
export const FONTS = [
  { id: 'noto-sans-kr', name: 'Noto Sans KR', family: 'Noto Sans KR', category: 'sans', google: 'Noto+Sans+KR:wght@400;700;900', file: 'NotoSansKR-VF.ttf' },
  { id: 'black-han-sans', name: 'Black Han Sans', family: 'Black Han Sans', category: 'display', google: 'Black+Han+Sans', file: 'BlackHanSans-Regular.ttf' },
  { id: 'do-hyeon', name: 'Do Hyeon', family: 'Do Hyeon', category: 'display', google: 'Do+Hyeon', file: 'DoHyeon-Regular.ttf' },
  { id: 'jua', name: 'Jua', family: 'Jua', category: 'display', google: 'Jua', file: 'Jua-Regular.ttf' },
  { id: 'gasoek-one', name: 'Gasoek One', family: 'Gasoek One', category: 'display', google: 'Gasoek+One', file: 'GasoekOne-Regular.ttf' },
  { id: 'bagel-fat-one', name: 'Bagel Fat One', family: 'Bagel Fat One', category: 'display', google: 'Bagel+Fat+One', file: 'BagelFatOne-Regular.ttf' },
  { id: 'dongle', name: 'Dongle', family: 'Dongle', category: 'handwriting', google: 'Dongle:wght@700', file: 'Dongle-Bold.ttf' },
  { id: 'gaegu', name: 'Gaegu', family: 'Gaegu', category: 'handwriting', google: 'Gaegu:wght@700', file: 'Gaegu-Bold.ttf' },
  { id: 'cute-font', name: 'Cute Font', family: 'Cute Font', category: 'handwriting', google: 'Cute+Font', file: 'CuteFont-Regular.ttf' },
  { id: 'dokdo', name: 'Dokdo', family: 'Dokdo', category: 'handwriting', google: 'Dokdo', file: 'Dokdo-Regular.ttf' },
  { id: 'east-sea-dokdo', name: 'East Sea Dokdo', family: 'East Sea Dokdo', category: 'handwriting', google: 'East+Sea+Dokdo', file: 'EastSeaDokdo-Regular.ttf' },
  { id: 'nanum-brush', name: 'Nanum Brush Script', family: 'Nanum Brush Script', category: 'handwriting', google: 'Nanum+Brush+Script', file: 'NanumBrushScript-Regular.ttf' },
  { id: 'nanum-pen', name: 'Nanum Pen Script', family: 'Nanum Pen Script', category: 'handwriting', google: 'Nanum+Pen+Script', file: 'NanumPenScript-Regular.ttf' },
  { id: 'kirang-haerang', name: 'Kirang Haerang', family: 'Kirang Haerang', category: 'handwriting', google: 'Kirang+Haerang', file: 'KirangHaerang-Regular.ttf' },
  { id: 'nanum-gothic', name: 'Nanum Gothic', family: 'Nanum Gothic', category: 'sans', google: 'Nanum+Gothic:wght@400;800', file: 'NanumGothic-ExtraBold.ttf' },
  { id: 'nanum-gothic-coding', name: 'Nanum Gothic Coding', family: 'Nanum Gothic Coding', category: 'mono', google: 'Nanum+Gothic+Coding:wght@700', file: 'NanumGothicCoding-Bold.ttf' },
  { id: 'nanum-myeongjo', name: 'Nanum Myeongjo', family: 'Nanum Myeongjo', category: 'serif', google: 'Nanum+Myeongjo:wght@800', file: 'NanumMyeongjo-ExtraBold.ttf' },
  { id: 'gothic-a1', name: 'Gothic A1', family: 'Gothic A1', category: 'sans', google: 'Gothic+A1:wght@900', file: 'GothicA1-Black.ttf' },
  { id: 'gowun-dodum', name: 'Gowun Dodum', family: 'Gowun Dodum', category: 'sans', google: 'Gowun+Dodum', file: 'GowunDodum-Regular.ttf' },
  { id: 'ibm-plex-sans-kr', name: 'IBM Plex Sans KR', family: 'IBM Plex Sans KR', category: 'sans', google: 'IBM+Plex+Sans+KR:wght@700', file: 'IBMPlexSansKR-Bold.ttf' },
  { id: 'gugi', name: 'Gugi', family: 'Gugi', category: 'display', google: 'Gugi', file: 'Gugi-Regular.ttf' },
  { id: 'moirai-one', name: 'Moirai One', family: 'Moirai One', category: 'display', google: 'Moirai+One', file: 'MoiraiOne-Regular.ttf' },
  { id: 'grandiflora-one', name: 'Grandiflora One', family: 'Grandiflora One', category: 'serif', google: 'Grandiflora+One', file: 'GrandifloraOne-Regular.ttf' },
  { id: 'diphylleia', name: 'Diphylleia', family: 'Diphylleia', category: 'serif', google: 'Diphylleia', file: 'Diphylleia-Regular.ttf' },
  { id: 'gmarket-sans', name: 'Gmarket Sans', family: 'GmarketSans', category: 'sans', google: null, cdn: 'https://webfontworld.github.io/gmarket/GmarketSans.css', file: 'GmarketSansBold.woff', weights: ['Light', 'Medium', 'Bold'] },
];

export function googleFontsHref(fonts = FONTS) {
  const families = fonts.filter((f) => f.google).map((f) => `family=${f.google}`).join('&');
  return `https://fonts.googleapis.com/css2?${families}&display=swap`;
}

export const SUBTITLE_STYLE_PRESETS = [
  { id: 'default', name: '기본', font: 'noto-sans-kr', size: 64, color: '#FFFFFF', outline: '#000000', outlineWidth: 4, bg: null, position: 'bottom', animation: 'none' },
  { id: 'bold-yellow', name: '볼드 옐로', font: 'black-han-sans', size: 72, color: '#FFE600', outline: '#000000', outlineWidth: 5, bg: null, position: 'center', animation: 'pop' },
  { id: 'box-white', name: '화이트 박스', font: 'do-hyeon', size: 60, color: '#111111', outline: null, outlineWidth: 0, bg: '#FFFFFF', position: 'bottom', animation: 'fade' },
  { id: 'hand-pink', name: '핸드 핑크', font: 'gaegu', size: 70, color: '#FF6FA5', outline: '#FFFFFF', outlineWidth: 4, bg: null, position: 'top', animation: 'bounce' },
  { id: 'karaoke-orange', name: '가라오케 오렌지', font: 'jua', size: 68, color: '#FFFFFF', highlight: '#FF7A00', outline: '#000000', outlineWidth: 4, bg: null, position: 'bottom', animation: 'karaoke' },
];
