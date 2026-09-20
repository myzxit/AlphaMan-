// AlphaMan 프로그램(데스크톱) 버전 - Electron 메인 프로세스
// 웹사이트 버전과 같은 서버/코어/UI 를 내장하여 127.0.0.1 에서 띄우고, 데스크톱 전용 기능(파일/USB/트레이/알림/오프라인 렌더링)을 preload 로 노출한다.
const { app, BrowserWindow, dialog, ipcMain, Tray, Menu, Notification, shell, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execSync } = require('node:child_process');

let server = null; let win = null; let tray = null;
const isPackaged = app.isPackaged;
const appRoot = isPackaged ? path.join(process.resourcesPath, 'app') : path.resolve(__dirname, '../..');

// 프로그램 버전은 유튜브 링크의 원본 자막(대본)을 자동으로 가져오기 위해 yt-dlp 를 사용자 데이터 폴더에 자동 설치한다 (없을 때만).
const toolsState = { ytdlp: 'checking', ytdlpPath: null, error: null };
function hasOnPath(bin) { try { execSync(`${process.platform === 'win32' ? 'where' : 'which'} ${bin}`, { stdio: 'ignore', timeout: 5000 }); return true; } catch { return false; } }
async function ensureYtDlp() {
  const binDir = path.join(app.getPath('userData'), 'bin');
  const file = path.join(binDir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  if (!process.env.PATH.split(path.delimiter).includes(binDir)) process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;
  if (hasOnPath('yt-dlp')) { toolsState.ytdlp = 'ready'; toolsState.ytdlpPath = fs.existsSync(file) ? file : 'PATH'; return; }
  try {
    fs.mkdirSync(binDir, { recursive: true });
    const asset = process.platform === 'win32' ? 'yt-dlp.exe' : process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp';
    toolsState.ytdlp = 'downloading';
    const res = await fetch(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    if (process.platform !== 'win32') fs.chmodSync(file, 0o755);
    toolsState.ytdlp = 'ready'; toolsState.ytdlpPath = file;
  } catch (err) { toolsState.ytdlp = 'missing'; toolsState.error = err.message; console.warn('yt-dlp 자동 설치 실패 (링크 대본은 붙여넣기로 대체):', err.message); }
}

async function startEmbeddedServer() {
  // 패키징된 앱에서는 extraResources 로 복사된 코어/서버를, 개발 중에는 워크스페이스를 사용
  const serverEntry = isPackaged ? path.join(appRoot, 'apps/server/src/server.js') : path.resolve(__dirname, '../server/src/server.js');
  if (isPackaged) {
    // 패키지 내부에서 '@alphaman/core' 를 해석할 수 있도록 node_modules 링크 구성
    const nm = path.join(appRoot, 'node_modules/@alphaman');
    fs.mkdirSync(nm, { recursive: true });
    for (const [name, target] of [['core', 'packages/core'], ['server', 'apps/server']]) {
      const link = path.join(nm, name);
      if (!fs.existsSync(link)) { try { fs.symlinkSync(path.join(appRoot, target), link, 'junction'); } catch { fs.cpSync(path.join(appRoot, target), link, { recursive: true }); } }
    }
  }
  const { startServer } = await import(require('node:url').pathToFileURL(serverEntry).href);
  const dataDir = path.join(app.getPath('userData'), 'data');
  const webDir = isPackaged ? path.join(appRoot, 'apps/web/public') : path.resolve(__dirname, '../web/public');
  server = await startServer({ port: Number(process.env.ALPHAMAN_DESKTOP_PORT || 0), host: '127.0.0.1', dataDir, platform: 'desktop', webDir });
  return server;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 920, minWidth: 960, minHeight: 640,
    title: 'AlphaMan',
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#0f1115',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  win.loadURL(server.url);
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  // CI/스모크 테스트용: ALPHAMAN_SCREENSHOT=경로 설정 시 화면을 저장하고 종료
  if (process.env.ALPHAMAN_SCREENSHOT) {
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      try { const img = await win.webContents.capturePage(); fs.writeFileSync(process.env.ALPHAMAN_SCREENSHOT, img.toPNG()); } catch (err) { console.error('screenshot failed', err); }
      app.isQuitting = true; app.quit();
    }, 2500));
  }
  win.on('close', (e) => { if (!app.isQuitting && process.platform !== 'darwin' && tray) { e.preventDefault(); win.hide(); } });
  const menu = Menu.buildFromTemplate([
    { label: 'AlphaMan', submenu: [{ label: '홈', click: () => win.webContents.executeJavaScript("location.hash='#/'") }, { label: '쇼츠 스튜디오', click: () => win.webContents.executeJavaScript("location.hash='#/studio'") }, { label: '자막 편집기', click: () => win.webContents.executeJavaScript("location.hash='#/subtitles'") }, { label: '디스커버리', click: () => win.webContents.executeJavaScript("location.hash='#/discovery'") }, { type: 'separator' }, { label: '데이터 폴더 열기', click: () => shell.openPath(server.app.dataDir) }, { label: '출력 폴더 열기', click: () => shell.openPath(server.app.outputDir) }, { type: 'separator' }, { role: 'quit', label: '종료' }] },
    { label: '편집', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '보기', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { label: '도움말', submenu: [{ label: '사용 가이드', click: () => win.webContents.executeJavaScript("location.hash='#/guide'") }, { label: '문의하기', click: () => win.webContents.executeJavaScript("location.hash='#/support'") }, { label: `버전 ${app.getVersion()}`, enabled: false }] },
  ]);
  Menu.setApplicationMenu(menu);
}

function createTray() {
  try {
    const icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({ width: 16, height: 16 });
    tray = new Tray(icon);
    tray.setToolTip('AlphaMan - 실행 중');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '열기', click: () => { win.show(); win.focus(); } },
      { label: `내장 서버: ${server.url}`, enabled: false },
      { label: '브라우저에서 열기', click: () => shell.openExternal(server.url) },
      { type: 'separator' },
      { label: '종료', click: () => { app.isQuitting = true; app.quit(); } },
    ]));
    tray.on('click', () => { win.isVisible() ? win.hide() : win.show(); });
  } catch (err) { console.warn('트레이 생성 실패', err.message); }
}

// ---- 데스크톱 전용 IPC ----
ipcMain.handle('pick-video', async (_e, defaultPath) => {
  const r = await dialog.showOpenDialog(win, { title: '영상 파일 선택', defaultPath: defaultPath || undefined, properties: ['openFile'], filters: [{ name: '영상', extensions: ['mp4', 'mov', 'webm', 'm4v', 'mkv', 'avi'] }] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('pick-videos', async (_e, defaultPath) => {
  const r = await dialog.showOpenDialog(win, { title: '영상 파일 선택 (여러 개)', defaultPath: defaultPath || undefined, properties: ['openFile', 'multiSelections'], filters: [{ name: '영상', extensions: ['mp4', 'mov', 'webm', 'm4v', 'mkv', 'avi'] }] });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('pick-folder', async () => { const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] }); return r.canceled ? null : r.filePaths[0]; });
ipcMain.handle('save-file', async (_e, { defaultName, content, mime }) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: defaultName });
  if (r.canceled) return null;
  fs.writeFileSync(r.filePath, typeof content === 'string' ? content : Buffer.from(content));
  return r.filePath;
});
ipcMain.handle('list-removable-drives', async () => listRemovableDrives());
ipcMain.handle('open-path', async (_e, p) => shell.openPath(p));
ipcMain.handle('show-in-folder', async (_e, p) => shell.showItemInFolder(p));
ipcMain.handle('notify', async (_e, { title, body }) => { if (Notification.isSupported()) new Notification({ title, body }).show(); return true; });
ipcMain.handle('app-info', async () => ({ version: app.getVersion(), platform: process.platform, dataDir: server?.app.dataDir, outputDir: server?.app.outputDir, apiBase: server?.url, tools: server ? (await server.app.info()).tools : null, toolsState }));
ipcMain.handle('tools-state', async () => toolsState);

function listRemovableDrives() {
  const drives = [];
  try {
    if (process.platform === 'win32') {
      const out = execSync('powershell -NoProfile -Command "Get-CimInstance Win32_LogicalDisk | Where-Object {$_.DriveType -eq 2} | Select-Object DeviceID,VolumeName | ConvertTo-Json"', { encoding: 'utf8', timeout: 8000 });
      const j = JSON.parse(out || '[]'); for (const d of Array.isArray(j) ? j : [j]) drives.push({ path: `${d.DeviceID}\\`, label: d.VolumeName || d.DeviceID });
    } else if (process.platform === 'darwin') {
      for (const name of fs.readdirSync('/Volumes')) { const p = path.join('/Volumes', name); if (name !== 'Macintosh HD') drives.push({ path: p, label: name }); }
    } else {
      for (const base of ['/media', '/run/media', '/mnt']) {
        if (!fs.existsSync(base)) continue;
        for (const user of fs.readdirSync(base)) { const p = path.join(base, user); try { const st = fs.statSync(p); if (!st.isDirectory()) continue; const subs = fs.readdirSync(p); if (base === '/media' || base === '/run/media') { for (const s of subs) drives.push({ path: path.join(p, s), label: s }); } else drives.push({ path: p, label: user }); } catch { /* ignore */ } }
      }
    }
  } catch (err) { console.warn('드라이브 검색 실패', err.message); }
  return drives;
}

app.whenReady().then(async () => {
  try { await startEmbeddedServer(); } catch (err) { dialog.showErrorBox('AlphaMan 시작 실패', String(err.stack || err)); app.quit(); return; }
  createWindow(); createTray();
  if (!process.env.ALPHAMAN_SCREENSHOT) ensureYtDlp().catch(() => {}); // 백그라운드 설치 (시작을 막지 않음)
  // 알림 브리지: 새 알림이 오면 OS 알림으로 표시
  setInterval(async () => {
    try {
      const notifs = server.app.store.find('notifications', (n) => !n.read && !n.desktopShown);
      for (const n of notifs.slice(0, 3)) { if (Notification.isSupported()) new Notification({ title: n.title, body: n.body }).show(); server.app.store.update('notifications', n.id, { desktopShown: true }); }
    } catch { /* ignore */ }
  }, 15000);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); else win.show(); });
});
app.on('before-quit', () => { app.isQuitting = true; if (server) server.stop().catch(() => {}); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && !tray) app.quit(); });
