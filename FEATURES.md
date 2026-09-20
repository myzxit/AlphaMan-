# 기능 대응표 (원본 4개 파일 → AlphaMan 웹사이트 버전 · 프로그램 버전)

업로드된 4개 파일(`alphacut.video` 사이트 저장본 ZIP, `AI 하이라이트 쇼츠 자동 제작 - Alphacut.mht`, `app.pixeling.io` 저장본 Z01, `디스커버리 | Pixeling.mht`)에서 추출한 모든 기능·문구·정책을 아래와 같이 구현했습니다. 두 버전은 같은 코어와 UI 를 공유하므로 **모든 항목이 웹/프로그램 양쪽에 동일하게 존재**합니다. 프로그램 버전은 여기에 로컬 파일·USB·트레이 기능이 추가됩니다.

## 1. AlphaCut (alphacut.video) — 쇼츠 자동 제작

| 원본 기능/문구 | 구현 위치 | 웹 | 프로그램 |
|---|---|---|---|
| 상단 메뉴: 가격 안내 · 사용 가이드 · FAQ · 무료 도구 · 로그인 · 무료 시작 | 사이드바/상단바, `#/pricing #/guide #/faq #/tools #/login #/signup` | ✓ | ✓ |
| "🎁 지금 회원가입하고 무료로 쇼츠를 제작해보세요!" / 마케팅 대행사들의 선택 / AI가 잡은 하이라이트 구간 / 바이럴 확률 73% 증가 | 랜딩 히어로 (`content.js` hero) | ✓ | ✓ |
| 유튜브 링크 입력 / 파일 업로드 → "쇼츠로 변환하기" | 랜딩 히어로 + 쇼츠 스튜디오 (`#/studio`) | ✓ | ✓ (+ 컴퓨터/USB 영상 탭) |
| 50,000명+ 크리에이터 / 100만 개+ 쇼츠 / 10억+ 조회수 | 랜딩 통계 | ✓ | ✓ |
| 장르별 자동 편집: 교육·강의 / 인터뷰·토크 / 정보·리뷰 / 게임·스트리밍 / 브이로그·라이프 | `shorts/templates.js` GENRES (장르별 클립 길이·후킹·무음·줌 규칙, 자동 감지) | ✓ | ✓ |
| 5만 명+ 유튜버 마퀴(파워제이탁구 … 레이먼킴의 인생고기) | 랜딩 마퀴 2줄 | ✓ | ✓ |
| 페르소나 4종(유튜브 크리에이터 / 전문직·자영업자 / 마케팅 에이전시 / 기업 마케팅팀·공공기관) + 결과 칩 | 랜딩 페르소나 섹션 | ✓ | ✓ |
| 3단계: 링크 붙여넣기 → 하이라이트 쇼츠 자동 편집 → 저장 또는 바로 업로드 ("오전 10시 업로드 월, 수, 금") | 랜딩 단계 + `publish.js` 기본 반복 예약 월/수/금 10:00 | ✓ | ✓ |
| 쇼츠 디자인 템플릿 ("인기 유튜버들이 쓰는 템플릿") | TEMPLATES 10종, 스튜디오 선택/클립 편집 변경 | ✓ | ✓ |
| 초정밀 자동 자막 + 자막 애니메이션 효과 | STT → 의미 분할 → 애니메이션(pop/fade/karaoke/word-highlight…) | ✓ | ✓ |
| 무음 구간 제거 | 세그먼트 간격 기반 컷(장르별 임계값) | ✓ | ✓ |
| 첫 3초 후킹 자동화 | 하이라이트별 hook(질문/숫자/인용/리액션/장면) | ✓ | ✓ |
| 화자 추적 + 다이나믹 줌 | 화자 전환 줌 키프레임 | ✓ | ✓ |
| 음성 향상 (잡음·배경음악 제거) | 클립 audio.voiceEnhance(denoise, removeMusic, -14 LUFS) | ✓ | ✓ |
| AI 후킹 보이스 (첫 3초 멘트 TTS) | 옵션 aiHookVoice | ✓ | ✓ |
| 후기 3건 (곰자TV / 또모TOWMOO "보러가기" / 사라패밀리) | 랜딩 후기 섹션 | ✓ | ✓ |
| 모든 SNS 한 번에 예약 (Threads, Instagram, Youtube, Facebook, TikTok) + 예약 업로드 | `publish.js` 계정 연결·즉시/특정 시간/반복 예약·큐·스케줄러·플랫폼별 비율 검증 | ✓ | ✓ |
| 클릭 한 번으로 다국어 번역 ("엄청 따뜻해서 좋고 → 熱々で良いです") | `translate.js` + `#/translate` + 클립 다국어 자막/제목 | ✓ | ✓ |
| 채널 분석 & 떡상 주제 추천 (알파토픽: 주제·썸네일·대본) | `topic.js` + `#/topic` + 대본 생성기 | ✓ | ✓ |
| FAQ 6문항 (AI 기준 / 이용요금 원본 길이만큼 차감 / 2분당 1개 / 재생성 절반·편집 / 팀 계정 / 해외 결제) | `content.js` faq + 실제 정책 구현(`credits.js`, `shorts/engine.js`) | ✓ | ✓ |
| "다음 쇼츠, 직접 만들지 마세요" CTA / 30분 무료 이용권 / SNS 업로드 자동화 | 랜딩 CTA + 가입 시 30분 지급 | ✓ | ✓ |
| 푸터: 요금제 · 롱폼 컷편집 · 알파토픽 · SNS 업로드 · 추천인 보상 제도 · 무료 도구 · 사용 가이드 · 팀 소개 · 문의하기 · 이용약관 · 개인정보처리방침 · 환불정책 · 오픈소스 고지 · 사업자 정보 | 푸터 + 각 페이지(`#/longform #/referral #/team #/terms #/privacy #/refund #/open-source`) | ✓ | ✓ |
| 언어: ko / en / id / ja / pt / tw | `i18n.js` LOCALES, 계정 설정·푸터 | ✓ | ✓ |
| 라우트: /pricing, /overseas-payment, /publish-pricing, /topic-pricing, /referral(-promo), /team, /tools, /topic-landing, /publish-landing, /longform-landing, /blog | 동일 해시 라우트 | ✓ | ✓ |
| 파일 업로드 검증 오류 메시지 전부 (형식 미지원→MP4 변환, HEVC(H.265) 미지원, 음성/영상 트랙 없음, 길이/해상도 추출 실패, 메타데이터 시간 초과, 로딩 중단, 코덱 오류, 썸네일 생성 오류, 네트워크 오류) | `media.js validateVideoMeta` + `ui.js readVideoMeta` | ✓ | ✓ |
| 관리자에게 문의하기 채팅 (문의 내용, 답변 받을 이메일, 비로그인 시 이메일 필수, "전달 중...", 24시간 내 답변, 관리자에게 추가 전달 내용) | 픽시 "관리자에게 전달" + `support.js` + 관리자 답변 → 채팅 동기화 | ✓ | ✓ |
| 재생성하기(이용권 50%) / 제목·길이·비율 편집 | `shorts/engine.js regenerate/editClip` + 클립 편집 모달 | ✓ | ✓ |
| 팀 계정(이용권 공유) 문의 | 내 계정 → 팀 계정 문의 → 관리자 승인 | ✓ | ✓ |
| 해외 결제 전용 페이지(해외 카드, USD) / 국내 토스 결제 | `credits.js checkout` + `#/overseas-payment` | ✓ | ✓ |
| 추천인 보상 제도 | 추천 코드/링크, 양쪽 30분 지급 | ✓ | ✓ |
| 롱폼 컷편집 | `longform.js` (무음 제거·자막·챕터·타임라인) | ✓ | ✓ |
| 무료 도구 | 8종(썸네일 다운로더, 제목 생성기, 해시태그, 자막 변환기, 후킹 점수, 이용권 계산기, 최적 업로드 시간, 영상 ID 추출) | ✓ | ✓ |
| 블로그, 팀 소개, 사용 가이드 | `#/blog #/team #/guide` | ✓ | ✓ |

## 2. Pixeling (app.pixeling.io) — 자막 편집기 · 디스커버리 · 픽시

| 원본 기능/문구 | 구현 위치 | 웹 | 프로그램 |
|---|---|---|---|
| "좋은 오후예요, ○○님 / 오후에도 좋은 아이디어가 떠오르길 바라요." (시간대별 인사) | `discovery.js home` | ✓ | ✓ |
| Discovery Home: 오늘의 진입점 (KR 쇼츠 급상승 / 최근 1일 성장 채널 / 커뮤니티·뉴스·레딧 / 뉴스 TOP) + aria 문구 | `#/discovery` 진입점 카드 | ✓ | ✓ |
| 탭: 쇼츠 · 채널 · 커뮤니티 · 뉴스 · 랜덤 · 더보기 | `#/discovery/{videos,channels,community,news,random}` + 페이지네이션 | ✓ | ✓ |
| TOP 10 급상승 쇼츠 랭킹(#1~#10) | 홈 TOP10 + videos 탭 | ✓ | ✓ |
| `/discovery/videos?type=shorts&regions=KR&sort_by=trend` | 동일 쿼리(지역 KR/US/JP/ID/BR/TW/GLOBAL, 정렬 trend/views/recent, 검색) | ✓ | ✓ |
| `/discovery/channels?sort=daily_view&order=desc&days=1&country=KR` | 동일 쿼리(1/3/7/30일, 정렬) | ✓ | ✓ |
| `/discovery/community`, `/discovery/news` | 레딧/커뮤니티 필터, 뉴스 카테고리 | ✓ | ✓ |
| "랜덤 쇼츠 다시 보기" | random 탭 | ✓ | ✓ |
| 사이드바 토글 | Ctrl+B / 버튼 | ✓ | ✓ |
| 알림 (Notifications alt+T) | 알림 서랍, Alt+T, 미읽음 배지, 모두 읽음 | ✓ | ✓ (+ OS 알림) |
| 의견 보내기 | 피드백 모달(평점·페이지) → 관리자 피드백 탭 | ✓ | ✓ |
| 챗봇 열기 / "픽시를 여는 중..." / 픽시 커맨드 센터("채팅으로 작업을 시작하고, 필요한 순간에만 편집기로 이어지는") | 픽시 서랍(Ctrl+K), 인텐트 → 편집기 열기 액션 | ✓ | ✓ |
| 테마 변경 (light / dark / system) | 상단 버튼, Ctrl+Shift+L, 계정 설정 | ✓ | ✓ |
| Pixeling QnA | FAQ 페이지 + 픽시 FAQ 응답 | ✓ | ✓ |
| 음성 인식(STT, Whisper) 자동 자막 / 의미 기반 분할 | `subtitles/stt.js transcribe + semanticSplit` | ✓ | ✓ (로컬 whisper) |
| 파형 기반 편집기로 세밀한 수정 | 캔버스 파형, 재생 위치, 분할/병합/재분할/되돌리기/추가/삭제 | ✓ | ✓ |
| 다국어 번역 원클릭 (영어, 일본어, 중국어 등) | 프로젝트 번역 + 언어별 내보내기 | ✓ | ✓ |
| SRT, VTT, ASS 등 내보내기 (+TXT/JSON) / SRT 가져오기 | `subtitles/format.js` | ✓ | ✓ |
| YouTube Shorts, TikTok, Instagram Reels 링크 지원 | `media.js parseVideoUrl` | ✓ | ✓ |
| TikTok 다운로드 일시 불가 공지 | 상단 공지 바(관리자 설정으로 on/off) + 프로젝트 생성 시 안내 | ✓ | ✓ |
| "프리미엄 일괄 생성 중에는 MP4 원본 영상을 삭제하거나 경로/이름을 바꾸지 말아주세요. USB 영상은…" | 프리미엄 모드 안내 | ✓ | ✓ (USB 직접 열기) |
| 기본 기능 무료 · Google 계정 간편 로그인 | STT 무료, `/api/auth/google` | ✓ | ✓ |
| 번들 폰트 25종 (Noto Sans KR, Black Han Sans, Do Hyeon, Jua, Gasoek One, Bagel Fat One, Dongle, Gaegu, Cute Font, Dokdo, East Sea Dokdo, Nanum Brush/Pen Script, Kirang Haerang, Nanum Gothic/Coding/Myeongjo, Gothic A1, Gowun Dodum, IBM Plex Sans KR, Gugi, Moirai One, Grandiflora One, Diphylleia, Gmarket Sans) | `subtitles/fonts.js` + 스타일 패널 + 프리셋 5종 | ✓ | ✓ |
| SEO 키워드(자막 생성, AI 자막, STT … subtitle generator, video editor) | `index.html` meta + `content.js` | ✓ | ✓ |
| 사용자 프로필(웨펀마스터::이메일) | 계정 페이지 · 사이드바 하단 | ✓ | ✓ |

## 3. 계정 · 관리자

| 항목 | 구현 |
|---|---|
| 관리자 전용 계정 `hhudeu66@gmail.com` / `an1823037` | `auth.js ADMIN_ACCOUNT` — 최초 실행 시 자동 시드, 삭제/강등 불가, 이용권 100,000분 |
| 이메일 가입/로그인, Google 로그인, 세션 30일, 비밀번호 변경, 프로필(언어/테마/채널) | `auth.js` |
| 이용권 원장(지급/차감/환불/추천/결제) | `credits.js` |
| 관리자 패널 11개 섹션 | `admin.js` + `pages-admin.js` |
| 점검 모드(관리자만 접근), 가입 허용, 보너스/추천 보상 설정 | 시스템 설정 |

## 4. 추가 기능 (요청 반영)

| 항목 | 구현 | 웹 | 프로그램 |
|---|---|---|---|
| 관리자 계정 이용권 무제한 | `credits.js isUnlimited/summary` — 관리자는 차감 없이 모든 작업 실행, UI 에 "무제한" 표시 | ✓ | ✓ |
| AI 재구성: 링크/파일 하나 → 원본 자막·효과음·배경음 제거 → 1~28분 길이 조절 → 새 자막·효과음·배경음·전환·색보정 | `remix.js` (`#/remix`, `/api/remix/*`), 권리 확인 필수, 실패 시 환불, 다시 만들기 50% | ✓ | ✓ (+ 컴퓨터/USB 영상) |
| 참고 유튜브 영상처럼 재구성 | `remix.js analyzeReference` → 스타일 프로필(호흡·자막 스타일·구조·톤·효과음 밀도·전환·색감) 을 계획/재구성에 반영 | ✓ | ✓ |
| 내 목소리 TTS (목소리 샘플 업로드 → 음성 프로필 → 합성) | `voice.js` (`#/voice`, `/api/voice/*`), ElevenLabs/XTTS/시뮬레이션 제공자, 본인 목소리 확인 | ✓ | ✓ |
| 내 목소리로 AI 후킹 보이스 / 재구성 내레이션 | 쇼츠 스튜디오 음성 프로필 선택, 재구성 내레이션(오프닝·마무리/전체) | ✓ | ✓ |
| 보관함: 내가 만든 영상(쇼츠·재구성·롱폼) 자동 저장, 즐겨찾기/검색/이름/제거, MP4 저장, SNS 업로드 | `library.js` (`#/library`, `/api/library*`), 완료 시 자동 저장 + 기존 작업 동기화, 대시보드 "최근 만든 영상" | ✓ | ✓ |
| 완성 영상 미리보기 (클립 카드 · 재구성 결과 인라인 · 롱폼 · 보관함) | `player.js` — 렌더 MP4 재생(Range 스트리밍) 또는 원본(유튜브/파일)을 타임라인대로 이어 재생 + 자막·후킹·카드 오버레이, `/api/preview/:kind/:id`, `/api/uploads/:id/stream` | ✓ | ✓ (+ `/api/local/stream` 로컬 파일) |
| 무료 TTS 목소리 26종(한국어 19 + 영/일/중) 듣기·선택, 내 목소리 프로필 저장·샘플 듣기 | `voice.js FREE_VOICES` (`/api/voice/free`, `/api/voice/profiles/:id/sample`), edge-tts 또는 브라우저 음성(`tts.js`), 샘플 Vercel Blob 보관 | ✓ | ✓ |
| 영상 마무리 구독·좋아요·알림 CTA 카드 | 쇼츠 `outro` 옵션 + 재구성 타임라인 `cta` 카드, 미리보기 종료 화면, ffmpeg 렌더 시 이어 붙임 | ✓ | ✓ |
| 유튜브 최적화: 원본과 비슷한 제목 + 추천 제목 후보/설명/태그/해시태그/업로드 시간/체크리스트 | `seo.js` (`/api/seo/:kind/:id`), 클립·재구성·롱폼 자동 생성, `pages-seo.js` 패널 | ✓ | ✓ |
| 썸네일 자동 제작(원본과 비슷하게 / 장면 자동 선택) + 편집기(장면·캡처·문구·스타일·색상, PNG/SVG) | `thumbnail.js` (`/api/thumbnail/*`), SVG 조합, 유튜브 프레임·ffmpeg 프레임·브라우저 캡처 | ✓ | ✓ (ffmpeg 프레임 추출) |
| 자막 = 원본 대본 그대로 | `stt.js transcribe` — 브라우저 Whisper(`transcript.js`, `stt-worker.js`) / 붙여넣은 대본(`parseTranscriptText`) / 서버 whisper / yt-dlp 유튜브 자막만 사용, 추정 대본 금지(422 안내), "원본 대본 그대로" 배지 | ✓ | ✓ (yt-dlp 자동 설치로 링크 대본 자동) |

## 5. 프로그램 버전에서만 추가되는 기능

- 컴퓨터/USB 영상 직접 열기(업로드 없이 경로 지정), USB 드라이브 검색
- 로컬 ffmpeg/ffprobe/whisper/yt-dlp 자동 감지 후 실제 렌더링·STT
- 시스템 트레이, OS 알림, 앱 메뉴(데이터/출력 폴더 열기), 외부 링크는 기본 브라우저로
- 설치 파일 빌드: Windows NSIS/portable, macOS dmg/zip, Linux AppImage/deb
