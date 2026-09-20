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

export function createHttpServer(app, { webDir = DEFAULT_WEB_DIR } = {}) {
  const api = buildApi(app);

  return http.createServer(async (req, res) => {
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
        if (result && result._file) {
          res.writeHead(200, { 'Content-Type': result.mime, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}` });
          return fs.createReadStream(result._file).pipe(res);
        }
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
      return json(res, status, { error: err.message || '서버 오류', details: err.details || null });
    } finally {
      if (process.env.ALPHAMAN_LOG) console.log(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`);
    }
  });
}

export async function startServer({ port = 4100, host = '127.0.0.1', dataDir, platform = 'web', webDir } = {}) {
  const app = createApp({ dataDir, platform });
  const server = createHttpServer(app, { webDir });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  const actual = server.address().port;
  const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${actual}`;
  const stop = () => new Promise((resolve) => { app.close(); server.close(() => resolve()); });
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
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new ApiError(413, '파일이 너무 큽니다 (최대 2GB).')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
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
