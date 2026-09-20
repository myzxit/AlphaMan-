// 단일 JSON 파일 기반 저장소. 외부 의존성 없이 웹 서버(Node)와 데스크톱(Electron) 양쪽에서 동작한다.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const COLLECTIONS = [
  'users', 'sessions', 'credits', 'creditLedger', 'jobs', 'clips', 'longformJobs',
  'subtitleProjects', 'publishAccounts', 'publishQueue', 'topicReports',
  'inquiries', 'notifications', 'feedback', 'notices', 'referrals', 'teamRequests',
  'payments', 'pixieThreads', 'uploads', 'settings', 'auditLog',
];

export class Store {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = Object.fromEntries(COLLECTIONS.map((c) => [c, []]));
    this._dirty = false;
    this._timer = null;
    this.load();
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
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.filePath);
    this._dirty = false;
  }

  touch() {
    this._dirty = true;
    if (!this.filePath) return;
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
