import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
  onFullscreenChange: (callback) => {
    const handler = (event, isFullScreen) => callback(isFullScreen);
    ipcRenderer.on('fullscreen-change', handler);
    return () => ipcRenderer.removeListener('fullscreen-change', handler);
  },
  openNoteWindow: (noteId, path) => {
    ipcRenderer.send('open-note-window', { noteId, path });
  },
  notifyActiveNoteChanged: (noteId, path) => {
    ipcRenderer.send('note-window-active-note-changed', { noteId, path });
  },
  notifyNoteWindowReady: () => {
    ipcRenderer.send('note-window-ready');
  },
  getOpenNotes: () => ipcRenderer.invoke('get-open-note-windows'),
  onOpenNotesChanged: (callback) => {
    const handler = (event, notes) => callback(notes);
    ipcRenderer.on('open-notes-changed', handler);
    return () => ipcRenderer.removeListener('open-notes-changed', handler);
  },
  onOpenNote: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('open-note', handler);
    return () => ipcRenderer.removeListener('open-note', handler);
  },
  openChatWindow: () => {
    ipcRenderer.send('open-chat-window');
  },
  onFlashWindowUpward: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('flash-window-upward', handler);
    return () => ipcRenderer.removeListener('flash-window-upward', handler);
  },
  onChatWindowStateChange: (callback) => {
    const handler = (event, isOpen) => callback(isOpen);
    ipcRenderer.on('chat-window-state-change', handler);
    return () => ipcRenderer.removeListener('chat-window-state-change', handler);
  },
  isChatWindowOpen: () => ipcRenderer.invoke('is-chat-window-open'),
  openFocusPipWindow: () => {
    ipcRenderer.send('open-focus-pip-window');
  },
  showSaveDialog: (options) => {
    return ipcRenderer.invoke('show-save-dialog', options);
  },
  onOmnibarTrigger: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('trigger-omnibar', handler);
    return () => ipcRenderer.removeListener('trigger-omnibar', handler);
  },
  broadcastSync: (msg) => {
    ipcRenderer.send('sync-broadcast', msg);
  },
  onSyncMessage: (callback) => {
    const handler = (event, msg) => callback(msg);
    ipcRenderer.on('sync-message', handler);
    return () => ipcRenderer.removeListener('sync-message', handler);
  },
  // Window Controls
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  unmaximizeWindow: () => ipcRenderer.send('window-unmaximize'),
  toggleMaximizeWindow: () => ipcRenderer.send('window-toggle-maximize'),
  isWindowMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  onWindowMaximizeChange: (callback) => {
    const handler = (event, isMaximized) => callback(isMaximized);
    ipcRenderer.on('window-maximized-change', handler);
    return () => ipcRenderer.removeListener('window-maximized-change', handler);
  },
  closeWindow: () => ipcRenderer.send('window-close'),
  onMainWindowCloseRequest: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('main-window-close-request', handler);
    return () => ipcRenderer.removeListener('main-window-close-request', handler);
  },
  closeAppConfirmed: () => ipcRenderer.send('app-close-confirmed'),
  requestSaveAllWindows: () => ipcRenderer.invoke('request-save-all-windows'),
  onRequestSave: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('request-save-window', handler);
    return () => ipcRenderer.removeListener('request-save-window', handler);
  },
  notifySaveComplete: () => ipcRenderer.send('note-save-complete'),
  // Native File System & Workspace IPC
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  getWorkspacePath: () => ipcRenderer.invoke('get-workspace-path'),
  setWorkspacePath: (folderPath) => ipcRenderer.invoke('set-workspace-path', folderPath),
  readFile: (relativePath) => ipcRenderer.invoke('fs-read-file', relativePath),
  readAsset: (relativePath) => ipcRenderer.invoke('fs-read-asset', relativePath),
  writeFile: (relativePath, content) => ipcRenderer.invoke('fs-write-file', relativePath, content),
  deleteFile: (relativePath) => ipcRenderer.invoke('fs-delete-file', relativePath),
  fileExists: (relativePath) => ipcRenderer.invoke('fs-file-exists', relativePath),
  listFiles: (subDir) => ipcRenderer.invoke('fs-list-files', subDir),
  notifyThemeChanged: (theme) => ipcRenderer.send('theme-changed', theme)
});
