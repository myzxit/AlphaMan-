// 단일 JSON 파일 기반 저장소. 외부 의존성 없이 웹 서버(Node)와 데스크톱(Electron) 양쪽에서 동작한다.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const COLLECTIONS = [
  'users', 'sessions', 'credits', 'creditLedger', 'jobs', 'clips', 'longformJobs',
  'subtitleProjects', 'publishAccounts', 'publishQueue', 'topicReports',
  'inquiries', 'notifications', 'feedback', 'notices', 'referrals', 'teamRequests',
  'payments', 'pixieThreads', 'uploads', 'settings', 'auditLog', 'remixJobs', 'voiceProfiles', 'voiceRenders', 'library',
];

export class Store {
  constructor(filePath, { remote = null } = {}) {
    this.filePath = filePath;
    this.data = Object.fromEntries(COLLECTIONS.map((c) => [c, []]));
    this._dirty = false;
    this._timer = null;
    this.remote = remote; // { load(): Promise<object|null>, save(json): Promise<void> } - 서버리스 인스턴스 간 공유 저장소
    this._lastRemoteLoad = 0;
    this.load();
    this.ready = remote ? this.loadRemote() : Promise.resolve();
  }

  // 원격(Vercel Blob 등) 스냅샷을 불러와 로컬 데이터를 대체한다
  async loadRemote() {
    if (!this.remote) return false;
    try {
      const raw = await this.remote.load();
      if (raw) for (const c of COLLECTIONS) this.data[c] = Array.isArray(raw[c]) ? raw[c] : [];
      this._lastRemoteLoad = Date.now();
      return Boolean(raw);
    } catch (err) { console.warn('[store] 원격 저장소 읽기 실패:', err.message); return false; }
  }

  // 요청 시작 시 호출: 변경 중이 아니고 일정 시간이 지났으면 원격 최신본을 다시 읽는다
  async refreshIfStale(maxAgeMs = 2000) {
    if (!this.remote || this._dirty) return;
    if (Date.now() - this._lastRemoteLoad > maxAgeMs) await this.loadRemote();
  }

  static memory() {
    return new Store(null);
  }

  load() {
    if (!this.filePath) return;
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        for (const c of COLLECTIONS) this.data[c] = Array.isArray(raw[c]) ? raw[c] : [];
      }
    } catch (err) {
      const backup = `${this.filePath}.corrupt-${Date.now()}`;
      try { fs.copyFileSync(this.filePath, backup); } catch { /* ignore */ }
      console.error(`[store] 데이터 파일을 읽지 못해 백업했습니다: ${backup}`, err.message);
    }
  }

  save() {
    if (this.filePath) {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.filePath);
    }
    this._dirty = false;
    if (this.remote) {
      const json = JSON.stringify(this.data);
      this._remoteSaving = (this._remoteSaving || Promise.resolve()).then(() => this.remote.save(json)).then(() => { this._lastRemoteLoad = Date.now(); }).catch((err) => console.warn('[store] 원격 저장소 쓰기 실패:', err.message));
    }
  }

  // 서버리스 응답 전에 원격 저장이 끝나길 기다린다
  async flushAsync() {
    this.flush();
    if (this._remoteSaving) await this._remoteSaving;
  }

  touch() {
    this._dirty = true;
    if (!this.filePath && !this.remote) return;
    if (this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      if (this._dirty) this.save();
    }, 150);
    if (typeof this._timer.unref === 'function') this._timer.unref();
  }

  flush() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    if (this._dirty) this.save();
  }

  col(name) {
    if (!(name in this.data)) throw new Error(`알 수 없는 컬렉션: ${name}`);
    return this.data[name];
  }

  insert(name, doc) {
    const now = new Date().toISOString();
    const rec = { id: doc.id || randomUUID(), createdAt: now, updatedAt: now, ...doc };
    this.col(name).push(rec);
    this.touch();
    return rec;
  }

  find(name, pred = () => true) {
    return this.col(name).filter(pred);
  }

  findOne(name, pred) {
    return this.col(name).find(pred) || null;
  }

  get(name, id) {
    return this.findOne(name, (d) => d.id === id);
  }

  update(name, id, patch) {
    const rec = this.get(name, id);
    if (!rec) return null;
    Object.assign(rec, typeof patch === 'function' ? patch(rec) : patch, { updatedAt: new Date().toISOString() });
    this.touch();
    return rec;
  }

  remove(name, id) {
    const col = this.col(name);
    const idx = col.findIndex((d) => d.id === id);
    if (idx < 0) return false;
    col.splice(idx, 1);
    this.touch();
    return true;
  }

  count(name, pred = () => true) {
    return this.col(name).filter(pred).length;
  }

  setting(key, fallback = null) {
    const rec = this.findOne('settings', (s) => s.key === key);
    return rec ? rec.value : fallback;
  }

  setSetting(key, value) {
    const rec = this.findOne('settings', (s) => s.key === key);
    if (rec) return this.update('settings', rec.id, { value });
    return this.insert('settings', { key, value });
  }
}

export { COLLECTIONS };

// Vercel Blob 을 원격 저장소로 사용 (BLOB_READ_WRITE_TOKEN 이 있을 때). 외부 SDK 없이 REST 호출만 사용한다.
export function vercelBlobRemote({ token = process.env.BLOB_READ_WRITE_TOKEN, pathname = 'alphaman/alphaman.json' } = {}) {
  if (!token) return null;
  const API = 'https://blob.vercel-storage.com';
  const headers = { authorization: `Bearer ${token}`, 'x-api-version': '7' };
  let url = null;
  return {
    kind: 'vercel-blob',
    async load() {
      if (!url) {
        const list = await fetch(`${API}/?prefix=${encodeURIComponent(pathname)}&limit=1`, { headers, signal: AbortSignal.timeout(8000) });
        if (!list.ok) throw new Error(`blob list ${list.status}`);
        const j = await list.json();
        const hit = (j.blobs || []).find((b) => b.pathname === pathname);
        if (!hit) return null;
        url = hit.url;
      }
      const res = await fetch(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (res.status === 404) { url = null; return null; }
      if (!res.ok) throw new Error(`blob get ${res.status}`);
      return res.json();
    },
    async save(json) {
      const res = await fetch(`${API}/${pathname}`, { method: 'PUT', headers: { ...headers, 'x-content-type': 'application/json', 'x-add-random-suffix': '0', 'x-allow-overwrite': '1', 'x-cache-control-max-age': '0' }, body: json, signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`blob put ${res.status}`);
      const j = await res.json();
      if (j.url) url = j.url;
    },
  };
}
