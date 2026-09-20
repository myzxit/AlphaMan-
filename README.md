# AlphaMan

**AI 하이라이트 쇼츠 자동 제작(알파컷) + AI 자막 편집기·디스커버리(픽셀링)** 를 하나로 통합한 플랫폼입니다.
**웹사이트 버전**과 **프로그램(데스크톱) 버전** 두 가지로 제공되며, 두 버전은 같은 코어(`packages/core`)와 같은 UI(`apps/web`)를 공유하므로 모든 기능이 양쪽에 동일하게 들어 있습니다.

기능 목록 전체와 원본(alphacut.video / app.pixeling.io) 대응표는 [FEATURES.md](./FEATURES.md) 를 보세요.

## 빠른 시작

```bash
npm install            # 워크스페이스 링크 + (선택) Anthropic SDK, Electron
npm run web            # 웹사이트 버전 → http://localhost:4100
npm run desktop        # 프로그램 버전 (Electron 창이 열리고 내장 서버가 127.0.0.1 에서 실행)
npm test               # 코어 + API 테스트 (12개)
npm run check          # 전체 JS 구문 검사
npm run desktop:build  # Windows(.exe/portable) · macOS(.dmg) · Linux(.AppImage/.deb) 설치 파일 생성 → release/
```

Node.js 20.10 이상이 필요합니다. 외부 런타임 의존성은 없습니다(저장소는 JSON 파일, 서버는 Node 내장 `http`).

## 관리자 전용 계정

최초 실행 시 자동으로 생성됩니다(웹/프로그램 공통).

| 항목 | 값 |
|---|---|
| 이메일 | `hhudeu66@gmail.com` |
| 초기 비밀번호 | `an1823037` |
| 역할 | `admin` (사이드바에 "관리자" 메뉴가 나타남) |
| 이용권 | **무제한** (모든 작업이 차감 없이 실행되고, 원장에는 "무제한 계정" 기록만 남음) |

비밀번호는 scrypt 로 해시되어 저장되며 관리자 계정은 삭제·강등할 수 없습니다. 로그인 후 **내 계정 → 비밀번호 변경**에서 초기 비밀번호를 바꾸세요.

관리자 기능: 대시보드 통계, 사용자 관리(이용권 지급/회수, 정지, 권한, 비밀번호 초기화, 삭제), 작업 모니터, 문의 답변(픽시 채팅으로 전달), 피드백, 팀 계정 승인, 공지(고정/전체 알림), 결제 내역, 업로드 큐, 시스템 설정(가입 허용, 점검 모드, TikTok 공지), 감사 로그.

## AI 재구성 · 내 목소리 TTS

- **AI 재구성 (`#/remix`)**: 영상 링크 또는 파일 하나를 올리면 원본의 박힌 자막·효과음·배경음을 걷어내고, 목표 길이(1~28분)에 맞춰 AI 가 구간을 선별·재배열한 뒤 새 자막(템플릿)·효과음 큐·배경음악·전환·색보정을 입혀 다시 구성합니다. 참고 유튜브 링크를 넣으면 그 영상의 호흡·자막 스타일·구조·톤·효과음 밀도를 분석해 같은 방식으로 재구성합니다. 결과는 편집(제목·자막·효과음)과 다시 만들기(이용권 50%)가 가능하고 MP4/ASS/JSON 으로 내보냅니다.
  - 작업 생성 시 **"내가 직접 제작했거나 사용 허가를 받은 영상"** 확인이 필요합니다. 타인의 영상을 무단으로 재가공하는 용도는 지원하지 않으며, 플랫폼의 저작권 판정 결과를 보장하지 않습니다.
- **내 목소리 TTS (`#/voice`)**: 아무 말이나 녹음한 목소리 샘플(5초 이상, 30초 이상 권장)을 올려 음성 프로필을 만들면, 쇼츠 스튜디오의 "AI 후킹 보이스"와 AI 재구성의 내레이션(오프닝·마무리 / 전체)을 내 목소리로 읽어줍니다. 본인 목소리(또는 허가받은 목소리) 확인이 필요합니다.
  - 실제 음성 파일 생성: `ELEVENLABS_API_KEY` 설정 또는 로컬 Coqui XTTS(`tts` CLI) 설치. 둘 다 없으면 합성 계획만 생성됩니다.

## 구조

```
packages/core/        공통 기능 엔진 (auth, credits, shorts, longform, subtitles, publish, topic, translate, tools, discovery, pixie, support, admin)
apps/server/          REST API + 정적 UI 호스팅 (웹사이트 버전 진입점)
apps/web/public/      빌드 없는 SPA UI (두 버전 공용)
apps/desktop/         Electron 프로그램 버전 (내장 서버 + 파일/USB/트레이/OS 알림 브리지)
```

## 선택적 연동

| 기능 | 없을 때 | 있을 때 |
|---|---|---|
| `ANTHROPIC_API_KEY` (또는 `ant auth login`) | 규칙 기반 엔진으로 하이라이트/번역/주제 추천/픽시 응답 | `claude-opus-5` 로 실제 AI 처리 (`@anthropic-ai/sdk`) |
| `ffmpeg` / `ffprobe` | 길이 추정 + 렌더 계획(JSON) | 실제 메타데이터 추출, 파형, MP4 클립 렌더링 |
| `whisper` CLI | 시뮬레이션 대본 | 실제 음성 인식(STT) |
| `yt-dlp` | oEmbed 로 제목/썸네일만 | 유튜브 길이·채널 정보 조회 |
| `ELEVENLABS_API_KEY` 또는 `tts`(Coqui XTTS) | 내 목소리 합성 계획만 | 실제 음성 클론 TTS 파일 생성 |
| `demucs` | 효과음/배경음 제거 계획 | 음원 분리로 목소리만 남기고 효과음·배경음 실제 제거 |

환경 변수: `PORT`(기본 4100), `HOST`, `ALPHAMAN_DATA_DIR`(데이터 폴더), `ALPHAMAN_AI=off`(AI 강제 비활성), `ALPHAMAN_WHISPER_MODEL`.

## 프로그램 버전 전용 기능

- 컴퓨터/USB 드라이브의 MP4 를 업로드 없이 바로 열기 (쇼츠 스튜디오 · 자막 편집기의 "컴퓨터/USB 영상" 탭)
- USB 드라이브 자동 검색 (Windows/macOS/Linux)
- 로컬 ffmpeg/Whisper 로 오프라인 렌더링·음성 인식
- 시스템 트레이, OS 알림(작업 완료·문의 답변), 앱 메뉴(데이터/출력 폴더 열기)
- `ALPHAMAN_SCREENSHOT=경로` 로 무인 스모크 테스트(화면 캡처 후 종료)
