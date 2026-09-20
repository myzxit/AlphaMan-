// 자막 포맷 변환: SRT / VTT / ASS 내보내기 (픽셀링 "SRT, VTT, ASS 등 주요 자막 형식")
function pad(n, w = 2) { return String(n).padStart(w, '0'); }

export function formatTime(sec, { ms = ',', assStyle = false } = {}) {
  const s = Math.max(0, Number(sec) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const frac = Math.round((s - Math.floor(s)) * 1000);
  if (assStyle) return `${h}:${pad(m)}:${pad(ss)}.${pad(Math.floor(frac / 10))}`;
  return `${pad(h)}:${pad(m)}:${pad(ss)}${ms}${pad(frac, 3)}`;
}

export function parseTime(str) {
  const m = String(str).trim().match(/^(\d+):(\d{2}):(\d{2})[,.](\d{1,3})$/);
  if (!m) return NaN;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000;
}

export function toSRT(segments) {
  return segments.map((s, i) => `${i + 1}\n${formatTime(s.start)} --> ${formatTime(s.end)}\n${s.text}\n`).join('\n');
}

export function toVTT(segments) {
  return `WEBVTT\n\n${segments.map((s) => `${formatTime(s.start, { ms: '.' })} --> ${formatTime(s.end, { ms: '.' })}\n${s.text}\n`).join('\n')}`;
}

export function toASS(segments, { font = 'Noto Sans KR', size = 64, primary = '&H00FFFFFF', outline = '&H00000000', playResX = 1080, playResY = 1920 } = {}) {
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${playResX}
PlayResY: ${playResY}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${font},${size},${primary},&H000000FF,${outline},&H80000000,-1,0,0,0,100,100,0,0,1,4,2,2,40,40,220,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const lines = segments.map((s) => `Dialogue: 0,${formatTime(s.start, { assStyle: true })},${formatTime(s.end, { assStyle: true })},Default,,0,0,0,,${s.text.replace(/\n/g, '\\N')}`);
  return header + lines.join('\n') + '\n';
}

export function parseSRT(text) {
  const blocks = String(text).replace(/\r/g, '').split(/\n\n+/);
  const out = [];
  for (const b of blocks) {
    const lines = b.trim().split('\n');
    const timeIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeIdx < 0) continue;
    const [a, c] = lines[timeIdx].split('-->').map((x) => parseTime(x.trim().replace('.', ',')));
    out.push({ start: a, end: c, text: lines.slice(timeIdx + 1).join('\n') });
  }
  return out;
}

export function exportSubtitles(segments, format, options) {
  switch (String(format).toLowerCase()) {
    case 'srt': return { body: toSRT(segments), mime: 'application/x-subrip', ext: 'srt' };
    case 'vtt': return { body: toVTT(segments), mime: 'text/vtt', ext: 'vtt' };
    case 'ass': return { body: toASS(segments, options), mime: 'text/x-ssa', ext: 'ass' };
    case 'txt': return { body: segments.map((s) => s.text).join('\n'), mime: 'text/plain', ext: 'txt' };
    case 'json': return { body: JSON.stringify(segments, null, 2), mime: 'application/json', ext: 'json' };
    default: throw new Error(`지원하지 않는 자막 형식: ${format}`);
  }
}
