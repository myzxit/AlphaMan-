// 알파컷이 제공하는 언어: 한국어(ko), 영어(en), 인도네시아어(id), 일본어(ja), 포르투갈어(pt), 대만 번체(tw)
export const LOCALES = [
  { code: 'ko', label: '한국어' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'id', label: 'Bahasa Indonesia' },
  { code: 'pt', label: 'Português' },
  { code: 'tw', label: '繁體中文' },
];

// 번역 대상 언어(자막/제목 번역): 픽셀링 기준 영어·일본어·중국어 + 알파컷 다국어
export const TRANSLATION_TARGETS = [
  { code: 'ko', label: '한국어' }, { code: 'en', label: '영어' }, { code: 'ja', label: '일본어' },
  { code: 'zh', label: '중국어(간체)' }, { code: 'tw', label: '중국어(번체)' }, { code: 'id', label: '인도네시아어' },
  { code: 'pt', label: '포르투갈어' }, { code: 'es', label: '스페인어' }, { code: 'vi', label: '베트남어' }, { code: 'th', label: '태국어' },
];

export function isLocale(code) {
  return LOCALES.some((l) => l.code === code);
}
