// 모든 JS 파일 구문 검사 (빌드 단계가 없으므로 커밋 전 빠른 확인용)
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const roots = ['packages', 'apps', 'scripts'];
const files = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'data' || name === 'release') continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p); else if (/\.(m?js|cjs)$/.test(name)) files.push(p);
  }
}
roots.forEach(walk);
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) { failed += 1; console.error(`✗ ${f}\n${r.stderr}`); }
}
console.log(`${files.length - failed}/${files.length} 파일 구문 검사 통과`);
process.exit(failed ? 1 : 0);
