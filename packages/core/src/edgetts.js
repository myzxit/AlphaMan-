// 무료 신경망 TTS (Microsoft Edge 읽어주기 서비스) — 외부 패키지 없이 Node 만으로 WebSocket 을 직접 구현해 MP3 를 받는다.
// edge-tts(Python) CLI 가 없어도 웹사이트 버전(서버리스)과 프로그램 버전 모두에서 실제 음성 파일을 만들 수 있다.
// 프록시 환경(HTTPS_PROXY)에서는 CONNECT 터널을 사용한다. 실패하면 호출자가 브라우저 내장 음성으로 대체한다.
import tls from 'node:tls';
import net from 'node:net';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const CHROMIUM_FULL_VERSION = '130.0.2849.68';
const HOST = 'speech.platform.bing.com';
const PATH = '/consumer/speech/synthesize/readaloud/edge/v1';
const OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';

export function isEdgeTtsDisabled() { return process.env.ALPHAMAN_EDGE_TTS === 'off'; }

// Sec-MS-GEC: 5분 단위 Windows 파일 시간 + 토큰의 SHA-256
function secMsGec() {
  let s = Math.floor(Date.now() / 1000) + 11644473600;
  s -= s % 300;
  const ticks = BigInt(s) * 10000000n;
  return createHash('sha256').update(`${ticks}${TRUSTED_CLIENT_TOKEN}`).digest('hex').toUpperCase();
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const ts = () => new Date().toString().replace(/\(.*\)$/, '(Coordinated Universal Time)');

// 프록시(CONNECT) 또는 직접 TLS 소켓
function openSocket(timeoutMs) {
  return new Promise((resolve, reject) => {
    const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
    const onErr = (e) => reject(e);
    const wrapTls = (raw) => {
      const sock = tls.connect({ socket: raw, servername: HOST, rejectUnauthorized: process.env.ALPHAMAN_TLS_INSECURE !== '1' }, () => resolve(sock));
      sock.once('error', onErr);
    };
    if (proxy) {
      const u = new URL(proxy);
      const raw = net.connect({ host: u.hostname, port: Number(u.port) || 80 });
      raw.setTimeout(timeoutMs, () => raw.destroy(new Error('proxy timeout')));
      raw.once('error', onErr);
      raw.once('connect', () => {
        const auth = u.username ? `Proxy-Authorization: Basic ${Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString('base64')}\r\n` : '';
        raw.write(`CONNECT ${HOST}:443 HTTP/1.1\r\nHost: ${HOST}:443\r\n${auth}\r\n`);
        raw.once('data', (d) => { if (/^HTTP\/1\.[01] 200/.test(d.toString())) wrapTls(raw); else reject(new Error(`proxy CONNECT failed: ${d.toString().split('\r\n')[0]}`)); });
      });
    } else {
      const sock = tls.connect({ host: HOST, port: 443, servername: HOST }, () => resolve(sock));
      sock.setTimeout(timeoutMs, () => sock.destroy(new Error('connect timeout')));
      sock.once('error', onErr);
    }
  });
}

// 최소 WebSocket 클라이언트 (핸드셰이크 + 프레임 인코딩/디코딩)
function wsFrame(payload, opcode) {
  const mask = randomBytes(4); const len = payload.length;
  const head = len < 126 ? Buffer.from([0x80 | opcode, 0x80 | len]) : len < 65536 ? Buffer.concat([Buffer.from([0x80 | opcode, 0x80 | 126]), Buffer.from([(len >> 8) & 255, len & 255])]) : Buffer.concat([Buffer.from([0x80 | opcode, 0x80 | 127]), Buffer.from([0, 0, 0, 0, (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255])]);
  const masked = Buffer.alloc(len); for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i % 4];
  return Buffer.concat([head, mask, masked]);
}
function parseFrames(buf) {
  const frames = []; let off = 0;
  while (off + 2 <= buf.length) {
    const b0 = buf[off]; const b1 = buf[off + 1]; const opcode = b0 & 0x0f; const masked = (b1 & 0x80) !== 0; let len = b1 & 0x7f; let p = off + 2;
    if (len === 126) { if (p + 2 > buf.length) break; len = buf.readUInt16BE(p); p += 2; } else if (len === 127) { if (p + 8 > buf.length) break; len = Number(buf.readBigUInt64BE(p)); p += 8; }
    if (masked) p += 4;
    if (p + len > buf.length) break;
    frames.push({ opcode, data: buf.subarray(p, p + len) }); off = p + len;
  }
  return { frames, rest: buf.subarray(off) };
}

// text → MP3 Buffer
export async function edgeSynthesize({ text, voice = 'ko-KR-SunHiNeural', rate = '+0%', pitch = '+0Hz', volume = '+0%', timeoutMs = 20000 }) {
  if (isEdgeTtsDisabled()) throw new Error('edge tts disabled');
  const clean = String(text || '').trim();
  if (!clean) throw new Error('text required');
  const sock = await openSocket(timeoutMs);
  const key = randomBytes(16).toString('base64');
  const connectionId = randomUUID().replace(/-/g, '');
  const url = `${PATH}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${secMsGec()}&Sec-MS-GEC-Version=1-${CHROMIUM_FULL_VERSION}&ConnectionId=${connectionId}`;
  sock.write([`GET ${url} HTTP/1.1`, `Host: ${HOST}`, 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Key: ${key}`, 'Sec-WebSocket-Version: 13', 'Pragma: no-cache', 'Cache-Control: no-cache', 'Origin: chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold', 'Accept-Encoding: gzip, deflate, br', 'Accept-Language: en-US,en;q=0.9', `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_FULL_VERSION.split('.')[0]}.0.0.0 Safari/537.36 Edg/${CHROMIUM_FULL_VERSION}`, '', ''].join('\r\n'));
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0); let upgraded = false; const audio = []; let done = false;
    const timer = setTimeout(() => finish(new Error('edge tts timeout')), timeoutMs);
    const finish = (err, out) => { if (done) return; done = true; clearTimeout(timer); try { sock.destroy(); } catch { /* ignore */ } err ? reject(err) : resolve(out); };
    sock.on('error', (e) => finish(e));
    sock.on('close', () => { if (!done) finish(audio.length ? null : new Error('edge tts closed without audio'), Buffer.concat(audio)); });
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!upgraded) {
        const idx = buf.indexOf('\r\n\r\n'); if (idx < 0) return;
        const head = buf.subarray(0, idx).toString();
        if (!/^HTTP\/1\.1 101/.test(head)) return finish(new Error(`edge tts handshake failed: ${head.split('\r\n')[0]}`));
        upgraded = true; buf = buf.subarray(idx + 4);
        const requestId = randomUUID().replace(/-/g, '');
        sock.write(wsFrame(Buffer.from(`X-Timestamp:${ts()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${JSON.stringify({ context: { synthesis: { audio: { metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'false' }, outputFormat: OUTPUT_FORMAT } } } })}\r\n`), 1));
        const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='https://www.w3.org/2001/mstts' xml:lang='en-US'><voice name='${voice}'><prosody pitch='${pitch}' rate='${rate}' volume='${volume}'>${esc(clean)}</prosody></voice></speak>`;
        sock.write(wsFrame(Buffer.from(`X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${ts()}Z\r\nPath:ssml\r\n\r\n${ssml}`), 1));
      }
      const { frames, rest } = parseFrames(buf); buf = rest;
      for (const f of frames) {
        if (f.opcode === 8) return finish(audio.length ? null : new Error('edge tts connection closed'), Buffer.concat(audio));
        if (f.opcode === 9) { sock.write(wsFrame(f.data, 10)); continue; }
        if (f.opcode === 1) { const t = f.data.toString(); if (t.includes('Path:turn.end')) return finish(null, Buffer.concat(audio)); continue; }
        if (f.opcode === 2 && f.data.length >= 2) {
          const hlen = f.data.readUInt16BE(0); const header = f.data.subarray(2, 2 + hlen).toString();
          if (header.includes('Path:audio')) audio.push(Buffer.from(f.data.subarray(2 + hlen)));
        }
      }
    });
  });
}

// 실행 환경에서 실제로 동작하는지 한 번 확인해 캐시 (실패 시 브라우저 음성으로 대체)
let available = null;
export async function edgeTtsAvailable() {
  if (isEdgeTtsDisabled()) return false;
  if (available !== null) return available;
  try { const mp3 = await edgeSynthesize({ text: 'ok', voice: 'en-US-JennyNeural', timeoutMs: 8000 }); available = mp3.length > 500; }
  catch { available = false; }
  return available;
}
