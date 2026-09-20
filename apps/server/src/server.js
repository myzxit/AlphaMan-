// HTTP 서버: API + 정적 웹 UI(apps/web/public) 제공. 프로그램 버전은 같은 서버를 내장하여 127.0.0.1 에서 띄운다.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AlphaMan, ApiError } from '@alphaman/core';
import { buildApi } from './api.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_WEB_DIR = path.resolve(here, '../../web/public');
const MAX_BODY = 2 * 1024 * 1024 * 1024; // 2GB 업로드 허용

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.mp4': 'video/mp4', '.txt': 'text/plain; charset=utf-8' };

export function createApp(opts = {}) {
  return new AlphaMan(opts);
}

// 요청 핸들러: Node http 서버와 서버리스(Vercel 등) 양쪽에서 동일하게 사용
export function createRequestHandler(app, { webDir = DEFAULT_WEB_DIR } = {}) {
  const api = buildApi(app);

  return async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const started = Date.now();
    res.setHeader('X-AlphaMan-Platform', app.platform);
    if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }
    try {
      if (url.pathname.startsWith('/api/')) {
        cors(res);
        const match = api.match(req.method, url.pathname);
        if (!match) throw new ApiError(404, `API 를 찾을 수 없습니다: ${req.method} ${url.pathname}`);
        const raw = await readBody(req);
        let body = {};
        const ct = req.headers['content-type'] || '';
        if (raw.length && ct.includes('application/json')) {
          try { body = JSON.parse(raw.toString('utf8')); } catch { throw new ApiError(400, 'JSON 본문이 올바르지 않습니다.'); }
        }
        const token = bearer(req);
        const user = app.auth.userFromToken(token);
        const settings = app.admin.settings();
        if (settings.maintenance && (!user || user.role !== 'admin') && !url.pathname.startsWith('/api/auth') && url.pathname !== '/api/info') {
          throw new ApiError(503, settings.maintenanceMessage || '서비스 점검 중입니다. 잠시 후 다시 시도해주세요.');
        }
        const ctx = { req, res, headers: req.headers, params: match.params, query: Object.fromEntries(url.searchParams), body, raw, token, user, app };
        const result = await match.handler(ctx);
        if (result && result._sent) return undefined; // 핸들러가 직접 응답을 보낸 경우
        if (result && result._file) return sendFile(req, res, result);
        if (result && result._raw != null) {
          res.writeHead(200, { 'Content-Type': `${result.mime}; charset=utf-8`, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}` });
          return res.end(result._raw);
        }
        return json(res, 200, result ?? { ok: true });
      }
      return serveStatic(req, res, url.pathname, webDir);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 500;
      if (status >= 500 && !(err instanceof ApiError)) console.error(`[api] ${req.method} ${url.pathname}`, err);
      if (status >= 500) { try { app.errors?.log({ level: 'error', source: 'server', message: err.message, stack: err.stack, route: `${req.method} ${url.pathname}`, userId: app.auth.userFromToken(bearer(req))?.id || null }); } catch { /* ignore */ } }
      return json(res, status, { error: err.message || '서버 오류', details: err.details || null });
    } finally {
      if (process.env.ALPHAMAN_LOG) console.log(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`);
    }
  };
}

export function createHttpServer(app, opts = {}) {
  return http.createServer(createRequestHandler(app, opts));
}

export async function startServer({ port = 4100, host = '127.0.0.1', dataDir, platform = 'web', webDir } = {}) {
  const app = createApp({ dataDir, platform });
  const server = createHttpServer(app, { webDir });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  const actual = server.address().port;
  const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${actual}`;
  const backupTimer = setInterval(() => app.backup.autoBackup().catch(() => {}), 60 * 60 * 1000); if (backupTimer.unref) backupTimer.unref(); // 매시간 확인, 하루 1회 백업
  app.backup.autoBackup().catch(() => {});
  const stop = () => new Promise((resolve) => { clearInterval(backupTimer); app.close(); server.close(() => resolve()); });
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { stop().then(() => process.exit(0)); });
  return { app, server, url, port: actual, stop };
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Filename');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
}

function bearer(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/(?:^|;\s*)am_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function readBody(req) {
  if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body); // 서버리스 런타임이 이미 본문을 읽은 경우
  if (typeof req.body === 'string') return Promise.resolve(Buffer.from(req.body));
  if (req.body && typeof req.body === 'object' && !req.readable) return Promise.resolve(Buffer.from(JSON.stringify(req.body)));
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new ApiError(413, '파일이 너무 큽니다 (최대 2GB).')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// 파일 응답: 다운로드(attachment) 또는 미리보기 스트리밍(inline). Range 요청을 지원해 <video> 탐색(seek)이 된다.
function sendFile(req, res, { _file: file, mime = 'application/octet-stream', filename = path.basename(file), inline = false }) {
  if (!fs.existsSync(file)) return json(res, 404, { error: '파일을 찾을 수 없습니다.' });
  const size = fs.statSync(file).size;
  const disposition = `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(filename)}`;
  const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
  if (range && size > 0) {
    let start = range[1] === '' ? Math.max(0, size - Number(range[2])) : Number(range[1]);
    let end = range[2] === '' || range[1] === '' ? size - 1 : Math.min(size - 1, Number(range[2]));
    if (!(start <= end) || start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
    res.writeHead(206, { 'Content-Type': mime, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Disposition': disposition, 'Cache-Control': 'private, max-age=0' });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': mime, 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Content-Disposition': disposition, 'Cache-Control': 'private, max-age=0' });
  if (req.method === 'HEAD') return res.end();
  return fs.createReadStream(file).pipe(res);
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function serveStatic(req, res, pathname, webDir) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(webDir, rel));
  if (!file.startsWith(path.normalize(webDir))) { res.writeHead(403); return res.end('forbidden'); }
  let target = file;
  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) target = path.join(webDir, 'index.html'); // SPA fallback
  if (!fs.existsSync(target)) { res.writeHead(404); return res.end('not found'); }
  const ext = path.extname(target).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600' });
  fs.createReadStream(target).pipe(res);
}
