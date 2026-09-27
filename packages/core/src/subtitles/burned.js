// 원본 영상에 박힌(burned-in) 자막 분석: 여러 프레임의 RGB 픽셀에서 "밝은 글자 + 어두운 외곽선" 이 가로로 몰린 행 묶음을 찾아
// 자막 띠의 위치·높이, 글자색, 외곽선색, 글자 크기 비율을 추정한다. 브라우저 렌더러(render-browser.js detectSubtitleBand)와 같은 알고리즘이며,
// 프로그램 버전/자체 호스팅에서는 ffmpeg 로 뽑은 원시 프레임(media.js detectBurnedSubtitleStyle)에 쓴다. 의존성 없음.
// frames: [{ data: Uint8Array|Buffer (RGB 또는 RGBA), width, height, channels }]

// 기준: 글자 픽셀 = 밝기 170 이상이고 2px 이내에 어두운(90 미만) 픽셀이 있는 것. 행 점수 = 그런 픽셀 수 / 가로폭. 분석 폭은 320px 권장
export function analyzeSubtitleFrames(frames, { minRows = 0.05, bright = 170, dark = 90, minScore = 0.02 } = {}) {
  const valid = (frames || []).filter((f) => f && f.data && f.width > 8 && f.height > 8);
  if (!valid.length) return null;
  const w = valid[0].width; const h = valid[0].height;
  const rowHits = new Float64Array(h);
  let used = 0;
  const textRgb = [0, 0, 0]; let textN = 0; const outRgb = [0, 0, 0]; let outN = 0;
  const lumAt = (d, ch, x, y) => { const p = (y * w + x) * ch; return d[p] * 0.3 + d[p + 1] * 0.59 + d[p + 2] * 0.11; };
  for (const f of valid) {
    if (f.width !== w || f.height !== h) continue;
    const d = f.data; const ch = f.channels || (d.length / (w * h) >= 4 ? 4 : 3);
    used += 1;
    const maxRun = Math.max(4, Math.round(w * 0.06)); // 글자 획은 짧은 밝은 조각, 밝은 박스/지평선 모서리는 긴 연속 조각 → 제외
    const brightRow = new Uint8Array(w);
    for (let y = 2; y < h - 2; y++) {
      for (let x = 0; x < w; x++) brightRow[x] = lumAt(d, ch, x, y) >= bright ? 1 : 0;
      let n = 0; let runs = 0; let x = 2;
      while (x < w - 2) {
        if (!brightRow[x]) { x += 1; continue; }
        let e = x; while (e < w - 2 && brightRow[e]) e += 1;
        if (e - x <= maxRun) {
          runs += 1;
          for (let xx = x; xx < e; xx++) {
            // 밝은 픽셀의 상하좌우 2px 이내에 어두운 픽셀이 있으면 글자 외곽선 특징으로 본다
            let darkPx = null;
            for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-2, 0], [2, 0], [0, -2], [0, 2]]) { if (lumAt(d, ch, xx + dx, y + dy) < dark) { darkPx = [xx + dx, y + dy]; break; } }
            if (!darkPx) continue;
            n += 1;
            const p = (y * w + xx) * ch; textRgb[0] += d[p]; textRgb[1] += d[p + 1]; textRgb[2] += d[p + 2]; textN += 1;
            const q = (darkPx[1] * w + darkPx[0]) * ch; outRgb[0] += d[q]; outRgb[1] += d[q + 1]; outRgb[2] += d[q + 2]; outN += 1;
          }
        }
        x = e;
      }
      if (runs >= 3) rowHits[y] += n / w; // 글자 행은 여러 획 조각으로 이루어진다
    }
  }
  if (!used) return null;
  const avg = Array.from(rowHits, (v) => v / used);
  const max = Math.max(...avg);
  if (max < minScore) return null; // 글자 외곽선 특징이 거의 없음 → 박힌 자막 없음
  const thr = max * 0.35; let best = null; let start = -1;
  for (let y = 0; y <= h; y++) {
    const on = y < h && avg[y] >= thr;
    if (on && start < 0) start = y;
    if (!on && start >= 0) { const score = avg.slice(start, y).reduce((a, b) => a + b, 0); if (!best || score > best.score) best = { start, end: y, score }; start = -1; }
  }
  if (!best) return null;
  const pad = Math.round(h * 0.03);
  const y0 = Math.max(0, best.start - pad) / h; const y1 = Math.min(h, best.end + pad) / h;
  if (y1 - y0 < minRows) return null;
  const band = { x: 0, y: r2(y0), w: 1, h: Math.max(0.08, r2(y1 - y0)) };
  const hex = (rgb, n) => (n ? `#${rgb.map((v) => Math.round(v / n).toString(16).padStart(2, '0')).join('')}` : null);
  const lineH = (best.end - best.start) / h; // 글자 띠 높이(외곽선 포함)
  return {
    band, detected: true,
    align: band.y + band.h >= 0.95 || band.y >= 0.6 ? 'bottom' : band.y <= 0.03 || band.y + band.h <= 0.35 ? 'top' : 'center',
    centerY: r2(band.y + band.h / 2),
    color: hex(textRgb, textN) || '#ffffff', outline: hex(outRgb, outN) || '#000000',
    sizeRatio: Math.max(0.03, Math.min(0.12, r2(lineH * 0.6))), // 세로 해상도 대비 글자 크기 (한 줄 기준)
  };
}

// ASS 색상(&HAABBGGRR) 변환
export function hexToAss(hex, alpha = '00') {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''));
  if (!m) return null;
  return `&H${alpha}${m[3]}${m[2]}${m[1]}`.toUpperCase();
}

function r2(n) { return Math.round(n * 100) / 100; }
