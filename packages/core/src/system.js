// 시스템: 오류 로그(서버·클라이언트) · 시스템 상태(API/DB/저장소/렌더 워커/큐) · 백업/복원 · 사용량
import fs from 'node:fs';
import path from 'node:path';
import { ApiError } from './errors.js';
import { toolAvailability } from './media.js';

const MAX_ERRORS = 2000;

export class ErrorLogService {
  constructor({ store }) { this.store = store; }
  log({ level = 'error', source = 'server', message, stack = null, route = null, userId = null, meta = null }) {
    const rec = this.store.insert('errorLog', { level, source, message: String(message || '').slice(0, 1000), stack: stack ? String(stack).slice(0, 4000) : null, route, userId, meta, at: new Date().toISOString() });
    const all = this.store.find('errorLog');
    if (all.length > MAX_ERRORS) for (const old of all.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, all.length - MAX_ERRORS)) this.store.remove('errorLog', old.id);
    return rec;
  }
  list({ source = '', level = '', limit = 200 } = {}) { return this.store.find('errorLog', (e) => (!source || e.source === source) && (!level || e.level === level)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit); }
  clear() { let n = 0; for (const e of this.store.find('errorLog')) { this.store.remove('errorLog', e.id); n += 1; } return n; }
  stats() { const all = this.store.find('errorLog'); const dayAgo = Date.now() - 86400000; return { total: all.length, last24h: all.filter((e) => new Date(e.createdAt).getTime() > dayAgo).length, client: all.filter((e) => e.source === 'client').length, server: all.filter((e) => e.source === 'server').length }; }
}

export class SystemService {
  constructor({ store, dataDir, activity = null, voice = null, errors = null, startedAt = Date.now() }) { this.store = store; this.dataDir = dataDir; this.activity = activity; this.voice = voice; this.errors = errors; this.startedAt = startedAt; }
  async status() {
    const tools = toolAvailability();
    const out = { at: new Date().toISOString(), uptimeSec: Math.round((Date.now() - this.startedAt) / 1000), memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024), node: process.version, serverless: Boolean(process.env.VERCEL), api: { ok: true }, db: {}, storage: {}, render: {}, queue: {}, errors: this.errors ? this.errors.stats() : null };
    // DB(저장소)
    const t0 = Date.now();
    out.db = { kind: this.store.remote ? this.store.remote.kind : 'local-json', records: Object.fromEntries(['users', 'jobs', 'clips', 'remixJobs', 'longformJobs', 'subtitleProjects', 'library', 'uploads', 'activities'].map((c) => [c, this.store.count(c)])), lastRemoteLoad: this.store._lastRemoteLoad ? new Date(this.store._lastRemoteLoad).toISOString() : null, dirty: Boolean(this.store._dirty) };
    if (this.store.remote) { try { await this.store.remote.load(); out.db.remoteOk = true; out.db.remoteLatencyMs = Date.now() - t0; } catch (err) { out.db.remoteOk = false; out.db.error = err.message; } }
    // Storage
    try { fs.mkdirSync(this.dataDir, { recursive: true }); const probe = path.join(this.dataDir, '.write-test'); fs.writeFileSync(probe, 'ok'); fs.unlinkSync(probe); out.storage.localWritable = true; } catch (err) { out.storage.localWritable = false; out.storage.error = err.message; }
    out.storage.dataDir = this.dataDir; out.storage.usedBytes = dirSize(this.dataDir);
    if (this.store.remote?.putFile) { const t1 = Date.now(); try { await this.store.remote.putFile('diag/ping.txt', Buffer.from('ping'), 'text/plain'); out.storage.remoteOk = true; out.storage.remoteLatencyMs = Date.now() - t1; } catch (err) { out.storage.remoteOk = false; out.storage.remoteError = err.message; } } else out.storage.remoteOk = null;
    // Render worker / queue
    out.render = { ffmpeg: tools.ffmpeg, ffprobe: tools.ffprobe, ytdlp: tools.ytdlp, whisper: tools.whisper, demucs: Boolean(toolAvailability().demucs), mode: tools.ffmpeg ? 'real' : 'plan-only' };
    out.queue = this.activity ? this.activity.queue.stats() : null;
    out.tts = this.voice ? this.voice.providers() : null;
    out.jobs = { processing: this.store.count('jobs', (j) => j.status === 'processing') + this.store.count('remixJobs', (j) => j.status === 'processing') + this.store.count('longformJobs', (j) => j.status === 'processing'), failed24h: this.store.count('activities', (a) => a.status === 'failed' && Date.now() - new Date(a.createdAt).getTime() < 86400000) };
    return out;
  }
  storageByUser() {
    const users = this.store.find('users');
    return users.map((u) => { const uploads = this.store.find('uploads', (x) => x.userId === u.id); const lib = this.store.find('library', (x) => x.userId === u.id); return { userId: u.id, email: u.email, uploads: uploads.length, uploadBytes: uploads.reduce((s, x) => s + (x.size || 0), 0), outputs: lib.length, outputBytes: lib.reduce((s, x) => s + sizeOf(x.renderPath), 0) }; }).sort((a, b) => (b.uploadBytes + b.outputBytes) - (a.uploadBytes + a.outputBytes));
  }
}

export class BackupService {
  constructor({ store, dataDir }) { this.store = store; this.dataDir = dataDir; this.dir = path.join(dataDir, 'backups'); }
  list() {
    const local = [];
    try { fs.mkdirSync(this.dir, { recursive: true }); for (const f of fs.readdirSync(this.dir)) if (f.endsWith('.json')) local.push({ id: f, at: f.replace('.json', ''), size: fs.statSync(path.join(this.dir, f)).size, where: 'local' }); } catch { /* ignore */ }
    const remote = this.store.find('backups').map((b) => ({ id: b.id, at: b.at, size: b.size, where: 'remote', url: b.url }));
    return [...remote, ...local].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 60);
  }
  async backup({ reason = 'manual' } = {}) {
    const snapshot = JSON.stringify({ ...this.store.data, backups: [] });
    const at = new Date().toISOString();
    let url = null;
    if (this.store.remote?.putFile) { try { url = await this.store.remote.putFile(`backups/${at.replace(/[:.]/g, '-')}.json`, Buffer.from(snapshot), 'application/json'); } catch (err) { console.warn('[backup] 원격 백업 실패:', err.message); } }
    let file = null;
    try { fs.mkdirSync(this.dir, { recursive: true }); file = path.join(this.dir, `${at.replace(/[:.]/g, '-')}.json`); fs.writeFileSync(file, snapshot); const files = fs.readdirSync(this.dir).filter((f) => f.endsWith('.json')).sort(); for (const old of files.slice(0, Math.max(0, files.length - 30))) fs.unlinkSync(path.join(this.dir, old)); } catch (err) { console.warn('[backup] 로컬 백업 실패:', err.message); }
    const rec = this.store.insert('backups', { at, size: snapshot.length, url, file, reason });
    const all = this.store.find('backups').sort((a, b) => a.at.localeCompare(b.at)); for (const old of all.slice(0, Math.max(0, all.length - 60))) this.store.remove('backups', old.id);
    this.store.setSetting('lastBackupAt', at);
    return { id: rec.id, at, size: snapshot.length, url, file };
  }
  // 하루 한 번 자동 백업 (요청 처리 중 호출해도 안전)
  async autoBackup() { const last = this.store.setting('lastBackupAt'); if (last && Date.now() - new Date(last).getTime() < 86400000) return null; return this.backup({ reason: 'auto' }); }
  async restore(id, { merge = true } = {}) {
    let raw = null;
    const rec = this.store.get('backups', id);
    if (rec?.url) { const res = await fetch(rec.url, { signal: AbortSignal.timeout(60000) }); if (res.ok) raw = await res.json(); }
    if (!raw && rec?.file && fs.existsSync(rec.file)) raw = JSON.parse(fs.readFileSync(rec.file, 'utf8'));
    if (!raw && /\.json$/.test(id) && fs.existsSync(path.join(this.dir, id))) raw = JSON.parse(fs.readFileSync(path.join(this.dir, id), 'utf8'));
    if (!raw) throw new ApiError(404, '백업을 찾을 수 없습니다.');
    await this.backup({ reason: 'pre-restore' });
    const { mergeSnapshots, COLLECTIONS } = await import('./store.js');
    const merged = merge ? mergeSnapshots(this.store.data, raw) : raw;
    for (const c of COLLECTIONS) if (c !== 'backups') this.store.data[c] = Array.isArray(merged[c]) ? merged[c] : [];
    this.store.touch(); this.store.flush();
    return { restored: true, merge, at: rec?.at || id };
  }
}

export class UsageService {
  constructor({ store, media, credits, activity }) { this.store = store; this.media = media; this.credits = credits; this.activity = activity; }
  usage(userId) {
    const m = this.media.usage(userId);
    const acts = this.store.find('activities', (a) => a.userId === userId);
    const ledger = this.credits.ledger(userId);
    const monthAgo = Date.now() - 30 * 86400000;
    return {
      storage: { usedBytes: m.bytes, limitBytes: m.limitBytes, files: m.files, byCategory: m.byCategory },
      jobs: { active: acts.filter((a) => ['queued', 'processing'].includes(a.status)).length, done: acts.filter((a) => a.status === 'done').length, failed: acts.filter((a) => a.status === 'failed').length, total: acts.length },
      outputs: { total: this.store.count('library', (r) => r.userId === userId), rendered: this.store.count('library', (r) => r.userId === userId && r.renderPath && fs.existsSync(r.renderPath)) },
      ai: { chargedMinutes30d: Math.round(ledger.filter((l) => l.delta < 0 && new Date(l.createdAt).getTime() > monthAgo).reduce((s, l) => s + Math.abs(l.delta), 0) * 100) / 100, wouldChargeMinutes30d: Math.round(ledger.filter((l) => l.wouldCharge && new Date(l.createdAt).getTime() > monthAgo).reduce((s, l) => s + Math.abs(l.wouldCharge), 0) * 100) / 100, byKind: Object.fromEntries(Object.entries(acts.reduce((acc, a) => { acc[a.kind] = (acc[a.kind] || 0) + 1; return acc; }, {}))) },
      credits: this.credits.summary(userId),
    };
  }
}

function sizeOf(p) { try { return p && fs.existsSync(p) ? fs.statSync(p).size : 0; } catch { return 0; } }
function dirSize(dir) { let total = 0; try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) total += dirSize(p); else total += fs.statSync(p).size; } } catch { /* ignore */ } return total; }
