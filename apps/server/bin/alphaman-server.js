#!/usr/bin/env node
import { startServer } from '../src/server.js';

const port = Number(process.env.PORT || 4100);
const host = process.env.HOST || '0.0.0.0';
const dataDir = process.env.ALPHAMAN_DATA_DIR || undefined;

startServer({ port, host, dataDir, platform: 'web' }).then(({ url, app }) => {
  console.log(`\n  AlphaMan 웹사이트 버전이 실행 중입니다: ${url}`);
  console.log(`  데이터 폴더: ${app.dataDir}`);
  console.log('  관리자 로그인: hhudeu66@gmail.com (초기 비밀번호는 README 참고)\n');
}).catch((err) => {
  console.error('서버 시작 실패:', err);
  process.exit(1);
});
