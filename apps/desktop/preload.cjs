// 렌더러(웹 UI)에 노출되는 데스크톱 브리지. 웹 UI 는 window.alphaman 이 있으면 "프로그램 버전" 전용 기능을 활성화한다.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('alphaman', {
  isDesktop: true,
  apiBase: '', // 내장 서버가 같은 오리진에서 UI 를 제공하므로 상대 경로 사용
  pickVideo: (defaultPath) => ipcRenderer.invoke('pick-video', defaultPath),
  pickVideos: (defaultPath) => ipcRenderer.invoke('pick-videos', defaultPath),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  saveFile: (opts) => ipcRenderer.invoke('save-file', opts),
  listRemovableDrives: () => ipcRenderer.invoke('list-removable-drives'),
  openPath: (p) => ipcRenderer.invoke('open-path', p),
  showInFolder: (p) => ipcRenderer.invoke('show-in-folder', p),
  notify: (title, body) => ipcRenderer.invoke('notify', { title, body }),
  appInfo: () => ipcRenderer.invoke('app-info'),
  toolsState: () => ipcRenderer.invoke('tools-state'),
});
