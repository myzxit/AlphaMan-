// Vercel 서버리스 진입점: 웹사이트 버전 전체(API + UI)를 하나의 함수로 제공한다.
// 주의: 서버리스 인스턴스의 /tmp 는 휘발성이라 데모 용도이며, 영구 데이터가 필요하면 Docker/VPS 로 `npm run web` 을 실행하세요.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, createRequestHandler } from '../apps/server/src/server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, '../apps/web/public');
const app = createApp({ dataDir: process.env.ALPHAMAN_DATA_DIR || '/tmp/alphaman', platform: 'web' });
const handler = createRequestHandler(app, { webDir });

export const config = { api: { bodyParser: false } };

// 함수 최대 실행 시간(vercel.json maxDuration 60초) 안에서 백그라운드 작업에 줄 수 있는 시간
const JOB_BUDGET_MS = Number(process.env.ALPHAMAN_SERVERLESS_JOB_BUDGET_MS || 50_000);

export default async function vercelHandler(req, res) {
  const started = Date.now();
  await app.ready;
  const isApi = Boolean(req.url && req.url.startsWith('/api/'));
  // 다른 인스턴스가 방금 저장한 데이터(예: 새 회원가입)를 놓치지 않도록 요청마다 원격 저장소를 짧은 주기로 다시 읽는다
  if (isApi) await app.store.refreshIfStale(500);
  await handler(req, res);
  // 서버리스는 응답 뒤 함수를 동결하므로, 방금 시작된 쇼츠/재구성/롱폼 작업이 끝날 때까지(예산 내) 함수를 살려둔 뒤 저장한다.
  // 응답은 이미 전송됐고, 작업 진행 상황은 클라이언트가 폴링으로 본다.
  if (isApi && app.activity?.queue?.busy) {
    await app.activity.queue.idle(Math.max(1000, JOB_BUDGET_MS - (Date.now() - started)));
    await app.voice.flushUploads().catch(() => {});
    await app.store.flushAsync();
  }
  await app.voice.flushUploads().catch(() => {});
  if (isApi) await app.backup.autoBackup().catch(() => {}); // 하루 1회 자동 백업
  await app.store.flushAsync();
}
