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

export default function vercelHandler(req, res) {
  return handler(req, res);
}
