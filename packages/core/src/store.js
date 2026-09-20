// 단일 JSON 파일 기반 저장소. 외부 의존성 없이 웹 서버(Node)와 데스크톱(Electron) 양쪽에서 동작한다.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const COLLECTIONS = [
  'users', 'sessions', 'credits', 'creditLedger', 'jobs', 'clips', 'longformJobs',
  'subtitleProjects', 'publishAccounts', 'publishQueue', 'topicReports',
  'inquiries', 'notifications', 'feedback', 'notices', 'referrals', 'teamRequests',
  'payments', 'pixieThreads', 'uploads', 'settings', 'auditLog', 'remixJobs', 'voiceProfiles', 'voiceRenders', 'library',
  'activities', 'versions', 'userTemplates', 'shares', 'orders', 'errorLog', 'workspaceState', 'backups',
  'tombstones', // 삭제 기록 {collection,id,at} — 여러 서버 인스턴스의 저장소를 병합할 때 삭제가 되살아나지 않도록
];
const MAX_TOMBSTONES = 3000;

// 두 스냅샷을 레코드 단위로 병합한다 (서버리스: 인스턴스마다 다른 변경을 서로 덮어쓰지 않도록).
// 같은 id 는 updatedAt 이 최신인 쪽을, 한쪽에만 있는 레코드는 그대로 두되 삭제 기록(tombstone)이 더 최신이면 제거한다.
export function mergeSnapshots(a, b) {
  const out = {};
  const tombs = new Map();
  for (const t of [...(a?.tombstones || []), ...(b?.tombstones || [])]) { const k = `${t.collection}:${t.id}`; if (!tombs.has(k) || tombs.get(k).at < t.at) tombs.set(k, t); }
  for (const c of COLLECTIONS) {
    if (c === 'tombstones') continue;
    const byId = new Map();
    for (const rec of [...(Array.isArray(a?.[c]) ? a[c] : []), ...(Array.isArray(b?.[c]) ? b[c] : [])]) {
      if (!rec || !rec.id) continue;
      const prev = byId.get(rec.id);
      if (!prev || String(rec.updatedAt || '') >= String(prev.updatedAt || '')) byId.set(rec.id, rec);
    }
    out[c] = [...byId.values()].filter((rec) => { const t = tombs.get(`${c}:${rec.id}`); return !(t && String(t.at) >= String(rec.updatedAt || rec.createdAt || '')); });
    if (c === 'users') {
      // 같은 이메일로 중복 가입된 레코드(인스턴스 병합 전)는 하나로: 오래된 쪽을 유지하되 비밀번호가 없으면 새 쪽의 것을 가져온다
      const byEmail = new Map();
      for (const u of out[c].sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))) {
        const prev = u.email ? byEmail.get(u.email) : null;
        if (!prev) { if (u.email) byEmail.set(u.email, u); continue; }
        if (!prev.passwordHash && u.passwordHash) prev.passwordHash = u.passwordHash;
        if (u.role === 'admin') prev.role = 'admin';
      }
      out[c] = out[c].filter((u) => !u.email || byEmail.get(u.email) === u);
    }
  }
  out.tombstones = [...tombs.values()].sort((x, y) => String(x.at).localeCompare(String(y.at))).slice(-MAX_TOMBSTONES);
  return out;
}

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
      // 원격본과 로컬(메모리)본을 병합: 아직 원격에 반영되지 않은 내 변경이 지워지지 않는다
      if (raw) { const merged = mergeSnapshots(raw, this.data); for (const c of COLLECTIONS) this.data[c] = merged[c]; }
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
      // 원격 최신본을 읽어 내 변경과 병합한 뒤 저장 → 다른 인스턴스가 방금 저장한 사용자·프로필·작업이 사라지지 않는다
      this._remoteSaving = (this._remoteSaving || Promise.resolve()).then(async () => {
        let remote = null;
        try { remote = await this.remote.load(); } catch (err) { console.warn('[store] 병합용 원격 읽기 실패 (내 데이터로 저장):', err.message); }
        if (remote) { const merged = mergeSnapshots(remote, this.data); for (const c of COLLECTIONS) this.data[c] = merged[c]; }
        await this.remote.save(JSON.stringify(this.data));
        this._lastRemoteLoad = Date.now();
      }).catch((err) => console.warn('[store] 원격 저장소 쓰기 실패:', err.message));
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
    const { id, createdAt, updatedAt, ...rest } = doc; // id/createdAt/updatedAt 가 undefined 로 넘어와도 새 값으로 채운다 (복제·가져오기)
    const rec = { id: id || randomUUID(), createdAt: createdAt || now, updatedAt: updatedAt || now, ...rest };
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
    if (name !== 'tombstones' && this.remote) { this.data.tombstones.push({ collection: name, id, at: new Date().toISOString() }); if (this.data.tombstones.length > MAX_TOMBSTONES) this.data.tombstones.splice(0, this.data.tombstones.length - MAX_TOMBSTONES); }
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
    // 부속 파일(목소리 샘플 등)을 별도 blob 으로 저장 → 서버리스 인스턴스가 바뀌어도 유지된다. 공개 URL 반환
    async putFile(name, buffer, contentType = 'application/octet-stream') {
      const dir = pathname.replace(/[^/]+$/, '');
      const res = await fetch(`${API}/${dir}files/${name}`, { method: 'PUT', headers: { ...headers, 'x-content-type': contentType, 'x-add-random-suffix': '1' }, body: buffer, signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`blob put file ${res.status}`);
      const j = await res.json();
      return j.url;
    },
  };
}
