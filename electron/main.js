import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { app, BrowserWindow, shell, Menu, protocol, net, ipcMain, dialog, globalShortcut, nativeTheme, screen, session, systemPreferences, safeStorage } from 'electron';
import { createSecurePassphraseStore } from './secure-passphrase.js';
import {
  APP_ID,
  resolveAppIconPath,
  configureAppUserModelId,
  applyWindowAppDetails,
  getTitleBarOverlayOptions as getTitleBarOverlayOptionsUtil,
  getWindowFrameOptions as getWindowFrameOptionsUtil,
  formatSystemAccentColor,
  applyWindowProgressBar,
  configureWindowsJumpList,
  parseCommandLineAction
} from './window-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = !app.isPackaged || process.env.NODE_ENV === 'development';
const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
const isLinux = process.platform === 'linux';

// Configure explicit process-level AppUserModelID on Windows immediately for taskbar pinning & window grouping
configureAppUserModelId(app, process.platform);

// Configure Windows Taskbar Jump List with quick actions
configureWindowsJumpList(app, process.platform, process.execPath);

const appIconPath = resolveAppIconPath(process.platform, __dirname);

let currentWorkspacePath = '';
const appDataConfigPath = path.join(app.getPath('userData'), 'secretary-workspace.json');
try {
  if (fs.existsSync(appDataConfigPath)) {
    const cfg = JSON.parse(fs.readFileSync(appDataConfigPath, 'utf8'));
    if (cfg && cfg.workspacePath && fs.existsSync(cfg.workspacePath)) {
      currentWorkspacePath = cfg.workspacePath;
    }
  }
} catch (e) {}

function saveWorkspacePathConfig(wsPath) {
  currentWorkspacePath = wsPath;
  try {
    fs.writeFileSync(appDataConfigPath, JSON.stringify({ workspacePath: wsPath }, null, 2), 'utf8');
  } catch (e) {}
}

let lastKnownTheme = '';

function getWindowBackgroundColor() {
  try {
    if (lastKnownTheme === 'light') return '#f8fafc';
    if (lastKnownTheme === 'dark') return '#0f172a';
    if (currentWorkspacePath) {
      const settingsPath = path.join(currentWorkspacePath, 'secretary-settings.json');
      if (fs.existsSync(settingsPath)) {
        const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        const t = s?.ui?.theme || s?.theme;
        if (t === 'light') return '#f8fafc';
        if (t === 'dark') return '#0f172a';
      }
    }
  } catch (e) {}
  return nativeTheme.shouldUseDarkColors ? '#0f172a' : '#f8fafc';
}

function getTitleBarOverlayOptions() {
  const isDark = lastKnownTheme === 'dark' || (lastKnownTheme !== 'light' && nativeTheme.shouldUseDarkColors);
  return getTitleBarOverlayOptionsUtil(isDark);
}

function getWindowFrameOptions() {
  const isDark = lastKnownTheme === 'dark' || (lastKnownTheme !== 'light' && nativeTheme.shouldUseDarkColors);
  return getWindowFrameOptionsUtil(process.platform, isDark);
}

// Process exception handlers to prevent main process crashes
process.on('uncaughtException', (err) => {
  console.error('[Secretary Main] Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Secretary Main] Unhandled Rejection:', reason);
});

// Enforce single instance lock
const gotTheLock = app.requestSingleInstanceLock();
let mainWindow = null;

// Track application quit state and active windows
let isQuitting = false;
let isAppCloseConfirmed = false;

// Store active note windows by noteId or path to enforce single window instance per note
const openNoteWindows = new Map();

function closeAllAuxiliaryWindows() {
  for (const poolWin of noteWindowPool) {
    if (poolWin && !poolWin.isDestroyed()) {
      try { poolWin.destroy(); } catch (e) {}
    }
  }
  noteWindowPool = [];

  for (const [k, noteWin] of openNoteWindows.entries()) {
    if (noteWin && !noteWin.isDestroyed()) {
      try { noteWin.destroy(); } catch (e) {}
    }
  }
  openNoteWindows.clear();

  if (openChatWindowInstance && !openChatWindowInstance.isDestroyed()) {
    try { openChatWindowInstance.destroy(); } catch (e) {}
    openChatWindowInstance = null;
  }

  if (openFocusPipInstance && !openFocusPipInstance.isDestroyed()) {
    try { openFocusPipInstance.destroy(); } catch (e) {}
    openFocusPipInstance = null;
  }

  const allWins = BrowserWindow.getAllWindows();
  for (const win of allWins) {
    if (win && !win.isDestroyed() && win !== mainWindow && !win._isClosingAux) {
      win._isClosingAux = true;
      try { win.destroy(); } catch (e) {}
    }
  }
}

function getOpenNotesList() {
  const openKeys = new Set();
  for (const [k, v] of openNoteWindows.entries()) {
    if (v && !v.isDestroyed() && v !== mainWindow) {
      if (k) openKeys.add(k);
    } else {
      openNoteWindows.delete(k);
    }
  }
  return Array.from(openKeys);
}

function broadcastOpenNotesChanged() {
  const list = getOpenNotesList();
  const allWins = BrowserWindow.getAllWindows();
  for (const win of allWins) {
    if (win && !win.isDestroyed()) {
      try {
        win.webContents.send('open-notes-changed', list);
      } catch (e) {}
    }
  }
}

function trackNoteWindow(win, noteId, normPath) {
  if (!win || win.isDestroyed() || win === mainWindow) return;
  const targetNoteId = noteId && typeof noteId === 'string' ? noteId.replace(/\\/g, '/').trim() : '';
  const targetPath = normPath && typeof normPath === 'string' ? normalizeNotePath(normPath) : '';

  // Clean up any stale mappings pointing to this window or matching the target keys
  for (const [k, v] of openNoteWindows.entries()) {
    if (!v || v.isDestroyed() || v === win || (targetNoteId && k === targetNoteId) || (targetPath && k === targetPath)) {
      openNoteWindows.delete(k);
    }
  }
  if (targetNoteId) {
    openNoteWindows.set(targetNoteId, win);
  }
  if (targetPath) {
    openNoteWindows.set(targetPath, win);
  }
  broadcastOpenNotesChanged();
}

function untrackNoteWindow(win) {
  let changed = false;
  for (const [k, v] of openNoteWindows.entries()) {
    if (!v || v.isDestroyed() || v === win) {
      openNoteWindows.delete(k);
      changed = true;
    }
  }
  if (changed) {
    broadcastOpenNotesChanged();
  }
}

ipcMain.handle('get-open-note-windows', () => {
  return getOpenNotesList();
});

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    // Route command-line action (e.g. from Windows Jump List)
    const action = parseCommandLineAction(commandLine);
    if (action && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app-action', action);
    }

    // Route file argument to dedicated note window if passed via CLI
    if (Array.isArray(commandLine)) {
      const fileArg = commandLine.find(arg => arg && typeof arg === 'string' && (arg.endsWith('.html') || arg.endsWith('.md')));
      if (fileArg && fs.existsSync(fileArg)) {
        const rel = path.relative(currentWorkspacePath || path.dirname(fileArg), fileArg);
        const norm = normalizeNotePath(rel);
        if (norm) {
          openNoteWindowInstance({ path: norm, sourceWin: mainWindow });
        }
      }
    }
  });

  // macOS open-file event (e.g. file dropped on dock or opened from Finder)
  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    if (filePath && fs.existsSync(filePath)) {
      const rel = path.relative(currentWorkspacePath || path.dirname(filePath), filePath);
      const norm = normalizeNotePath(rel);
      if (norm) {
        openNoteWindowInstance({ path: norm, sourceWin: mainWindow });
      }
    }
  });
}

function normalizeNotePath(p) {
  if (!p) return '';
  return String(p).replace(/\\/g, '/').replace(/^\/+/, '').trim();
}

// Workspace & Storage IPC Handlers
ipcMain.handle('select-folder', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  const result = await dialog.showOpenDialog(win, {
    title: 'Select Secretary Workspace Folder',
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return null;
  }
  const folderPath = result.filePaths[0];
  saveWorkspacePathConfig(folderPath);
  return { path: folderPath, name: path.basename(folderPath) };
});

ipcMain.handle('get-workspace-path', async () => {
  if (currentWorkspacePath && fs.existsSync(currentWorkspacePath)) {
    return { path: currentWorkspacePath, name: path.basename(currentWorkspacePath) };
  }
  return null;
});

ipcMain.handle('set-workspace-path', async (event, folderPath) => {
  if (folderPath && fs.existsSync(folderPath)) {
    saveWorkspacePathConfig(folderPath);
    return { path: folderPath, name: path.basename(folderPath) };
  }
  return null;
});

function resolveWorkspaceFilePath(relPath) {
  if (!currentWorkspacePath) throw new Error('No workspace directory active');
  const target = path.resolve(currentWorkspacePath, String(relPath || '').replace(/^\/+/, ''));
  if (target !== currentWorkspacePath && !target.startsWith(currentWorkspacePath + path.sep)) {
    throw new Error('Access denied outside workspace directory');
  }
  return target;
}

ipcMain.handle('fs-read-file', async (event, relPath) => {
  try {
    const target = resolveWorkspaceFilePath(relPath);
    if (!fs.existsSync(target)) return null;
    return await fs.promises.readFile(target, 'utf8');
  } catch (e) {
    console.warn('fs-read-file error for:', relPath, e.message);
    return null;
  }
});

ipcMain.handle('fs-read-asset', async (event, relPath) => {
  try {
    let target = resolveWorkspaceFilePath(relPath);
    if (!fs.existsSync(target)) {
      const fileName = path.basename(relPath);
      const cleanRel = String(relPath).replace(/^[./\\]+/, '').replace(/^notes\//, '');
      const candidates = [
        resolveWorkspaceFilePath(`notes/_assets/${fileName}`),
        resolveWorkspaceFilePath(`_assets/${fileName}`),
        resolveWorkspaceFilePath(`_migrated_to_cloud_backup/notes/_assets/${fileName}`),
        resolveWorkspaceFilePath(`_migrated_to_cloud_backup/_assets/${fileName}`),
        resolveWorkspaceFilePath(`_migrated_to_cloud_backup/notes/${cleanRel}`),
        resolveWorkspaceFilePath(`_migrated_to_cloud_backup/${relPath}`),
        resolveWorkspaceFilePath(`_migrated_to_cloud_backup/${cleanRel}`)
      ];
      const found = candidates.find(c => fs.existsSync(c));
      if (found) {
        target = found;
      } else {
        return null;
      }
    }
    const ext = path.extname(target).toLowerCase().replace('.', '');
    const mimeMap = {
      svg: 'image/svg+xml',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      gif: 'image/gif',
      avif: 'image/avif',
      ico: 'image/x-icon',
      bmp: 'image/bmp'
    };
    const mime = mimeMap[ext] || 'image/png';
    const buf = await fs.promises.readFile(target);
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch (e) {
    console.error('fs-read-asset failed:', relPath, e);
    return null;
  }
});

ipcMain.handle('fs-write-file', async (event, relPath, content) => {
  const target = resolveWorkspaceFilePath(relPath);
  const targetDir = path.dirname(target);
  await fs.promises.mkdir(targetDir, { recursive: true });

  const isBase64Img = typeof content === 'string' && content.startsWith('data:image/');
  const bufferToWrite = isBase64Img
    ? Buffer.from(content.split(',')[1] || '', 'base64')
    : null;

  // Use atomic temporary file rename to prevent zero-byte or corrupted note files on sudden interruptions
  const tempTarget = path.join(targetDir, `.tmp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
  try {
    if (bufferToWrite) {
      await fs.promises.writeFile(tempTarget, bufferToWrite);
    } else {
      await fs.promises.writeFile(tempTarget, content, 'utf8');
    }
    await fs.promises.rename(tempTarget, target);
    return true;
  } catch (atomicErr) {
    try {
      if (fs.existsSync(tempTarget)) await fs.promises.unlink(tempTarget);
    } catch (cleanErr) {}
    // Fallback to direct write if rename fails
    if (bufferToWrite) {
      await fs.promises.writeFile(target, bufferToWrite);
    } else {
      await fs.promises.writeFile(target, content, 'utf8');
    }
    return true;
  }
});

ipcMain.handle('fs-delete-file', async (event, relPath) => {
  const target = resolveWorkspaceFilePath(relPath);
  if (fs.existsSync(target)) {
    await fs.promises.unlink(target);
  }
  return true;
});

ipcMain.handle('fs-file-exists', async (event, relPath) => {
  try {
    const target = resolveWorkspaceFilePath(relPath);
    return fs.existsSync(target);
  } catch (e) {
    return false;
  }
});

ipcMain.handle('fs-list-files', async (event, subDir) => {
  try {
    const target = resolveWorkspaceFilePath(subDir || '');
    if (!fs.existsSync(target)) return [];
    const entries = await fs.promises.readdir(target, { withFileTypes: true });
    return entries.map(ent => ({
      name: ent.name,
      isDirectory: ent.isDirectory(),
      isFile: ent.isFile()
    }));
  } catch (e) {
    return [];
  }
});

// Window Control IPC Handlers
ipcMain.on('window-minimize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) win.minimize();
});

ipcMain.on('window-maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed() && !win.isMaximized()) win.maximize();
});

ipcMain.on('window-unmaximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed() && win.isMaximized()) win.unmaximize();
});

let lastToggleMaximizeTime = 0;
ipcMain.on('window-toggle-maximize', (event) => {
  const now = Date.now();
  if (now - lastToggleMaximizeTime < 300) return;
  lastToggleMaximizeTime = now;
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) {
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  }
});

ipcMain.handle('window-is-maximized', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return win && !win.isDestroyed() ? win.isMaximized() : false;
});

ipcMain.on('window-close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;
  if (win === mainWindow) {
    if (!isAppCloseConfirmed) {
      win.webContents.send('main-window-close-request');
      return;
    }
  }
  win.close();
});

ipcMain.on('app-close-confirmed', () => {
  isAppCloseConfirmed = true;
  isQuitting = true;
  closeAllAuxiliaryWindows();
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.destroy();
    } catch (e) {}
    mainWindow = null;
  }
  app.quit();
});

ipcMain.handle('request-save-all-windows', async () => {
  const noteWins = Array.from(new Set(Array.from(openNoteWindows.values()))).filter(w => w && !w.isDestroyed());
  for (const win of noteWins) {
    try {
      win.webContents.send('request-save-window');
    } catch (e) {}
  }
  await new Promise(r => setTimeout(r, 150));
  return true;
});

// Secure vault passphrase storage (OS keychain via safeStorage; never plaintext)
const securePassphraseStore = createSecurePassphraseStore({ safeStorage, userDataPath: app.getPath('userData') });
ipcMain.handle('secure-passphrase-available', () => securePassphraseStore.isAvailable());
ipcMain.handle('secure-passphrase-save', (event, passphrase) => securePassphraseStore.save(passphrase));
ipcMain.handle('secure-passphrase-get', () => securePassphraseStore.get());
ipcMain.handle('secure-passphrase-clear', () => securePassphraseStore.clear());

// Windows System Accent Color IPC & Dynamic Listener
ipcMain.handle('get-system-accent-color', () => {
  try {
    if (process.platform === 'win32' && systemPreferences && typeof systemPreferences.getAccentColor === 'function') {
      return formatSystemAccentColor(systemPreferences.getAccentColor());
    }
  } catch (e) {}
  return null;
});

if (process.platform === 'win32' && systemPreferences && typeof systemPreferences.on === 'function') {
  try {
    systemPreferences.on('accent-color-changed', (event, newColor) => {
      const formatted = formatSystemAccentColor(newColor);
      const allWindows = BrowserWindow.getAllWindows();
      for (const win of allWindows) {
        if (win && !win.isDestroyed()) {
          win.webContents.send('system-accent-color-changed', formatted);
        }
      }
    });
  } catch (e) {}
}

// Windows Taskbar Progress Reporting
ipcMain.on('set-progress-bar', (event, { progress, options } = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  applyWindowProgressBar(win, progress, options);
});

// Multi-Window Note Handlers & Pre-warmed Window Pool
let noteWindowPool = [];
let isPrewarmingNoteWindow = false;

function checkAllWindowsClosed() {
  if (isQuitting) return;
  const nonPoolWindows = BrowserWindow.getAllWindows().filter(w => !w.isDestroyed() && !noteWindowPool.includes(w));
  if (nonPoolWindows.length === 0) {
    for (const poolWin of noteWindowPool) {
      if (poolWin && !poolWin.isDestroyed()) {
        try {
          poolWin.destroy();
        } catch (e) {}
      }
    }
    noteWindowPool = [];
    openNoteWindows.clear();
    if (!isMac) {
      isQuitting = true;
      app.quit();
    }
  }
}

let cascadeOffsetCount = 0;
function getNextNoteWindowBounds(sourceWin) {
  try {
    let display = null;
    if (sourceWin && !sourceWin.isDestroyed()) {
      try {
        const b = sourceWin.getBounds();
        display = screen.getDisplayNearestPoint({
          x: Math.round(b.x + b.width / 2),
          y: Math.round(b.y + b.height / 2)
        });
      } catch (e) {}
    }
    if (!display) {
      display = screen.getPrimaryDisplay();
    }
    const { x: workX, y: workY, width: screenWidth, height: screenHeight } = display.workArea;
    const winWidth = Math.min(1100, Math.max(700, screenWidth - 60));
    const winHeight = Math.min(750, Math.max(500, screenHeight - 60));

    const baseX = workX + Math.max(0, Math.round((screenWidth - winWidth) / 2));
    const baseY = workY + Math.max(0, Math.round((screenHeight - winHeight) / 2));

    const offset = (cascadeOffsetCount % 8) * 26;
    cascadeOffsetCount++;

    const minX = workX;
    const maxX = Math.max(workX, workX + screenWidth - winWidth);
    const minY = workY;
    const maxY = Math.max(workY, workY + screenHeight - winHeight);

    const clampedX = Math.min(Math.max(minX, baseX + offset), maxX);
    const clampedY = Math.min(Math.max(minY, baseY + offset), maxY);

    return {
      x: clampedX,
      y: clampedY,
      width: winWidth,
      height: winHeight
    };
  } catch (e) {
    return { width: 1100, height: 750 };
  }
}

function prewarmNoteWindow() {
  if (isQuitting || isPrewarmingNoteWindow) return;
  noteWindowPool = noteWindowPool.filter(w => w && !w.isDestroyed());
  const nonPoolWindows = BrowserWindow.getAllWindows().filter(w => !w.isDestroyed() && !noteWindowPool.includes(w));
  if (nonPoolWindows.length === 0) return;
  if (noteWindowPool.length >= 1) return;

  isPrewarmingNoteWindow = true;
  try {
    const frameOpts = getWindowFrameOptions();
    const preWin = new BrowserWindow({
      width: 1100,
      height: 750,
      minWidth: 700,
      minHeight: 500,
      title: 'Secretary Note',
      icon: appIconPath,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: getWindowBackgroundColor(),
      ...frameOpts,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });

    setupWindowOpenHandler(preWin);
    applyWindowAppDetails(preWin, process.platform, appIconPath);

    const cleanupAndRetry = () => {
      isPrewarmingNoteWindow = false;
      noteWindowPool = noteWindowPool.filter(w => w !== preWin && !w.isDestroyed());
      untrackNoteWindow(preWin);
      try { preWin.destroy(); } catch (e) {}
      if (!isQuitting) {
        const remaining = BrowserWindow.getAllWindows().filter(w => !w.isDestroyed() && !noteWindowPool.includes(w));
        if (remaining.length > 0) {
          setTimeout(prewarmNoteWindow, 1000);
        }
      }
    };

    preWin.webContents.on('did-fail-load', cleanupAndRetry);
    preWin.webContents.on('render-process-gone', cleanupAndRetry);
    preWin.on('unresponsive', cleanupAndRetry);

    const baseUrl = isDev
      ? 'http://localhost:5173/note-window.html#preloaded=true'
      : 'app://secretary/note-window.html#preloaded=true';
    preWin.loadURL(baseUrl);

    preWin.once('ready-to-show', () => {
      isPrewarmingNoteWindow = false;
      if (!preWin.isDestroyed() && !preWin.isVisible()) {
        noteWindowPool.push(preWin);
      }
    });

    preWin.once('closed', () => {
      isPrewarmingNoteWindow = false;
      noteWindowPool = noteWindowPool.filter(w => w !== preWin && !w.isDestroyed());
      untrackNoteWindow(preWin);
      checkAllWindowsClosed();
    });
  } catch (e) {
    isPrewarmingNoteWindow = false;
    console.warn('[Secretary Main] Failed to prewarm note window:', e);
  }
}

function attachNoteWinLifecycle(win) {
  if (!win || win.isDestroyed() || win._hasNoteLifecycle) return;
  win._hasNoteLifecycle = true;

  win.on('closed', () => {
    untrackNoteWindow(win);
    noteWindowPool = noteWindowPool.filter(w => w !== win && !w.isDestroyed());
    checkAllWindowsClosed();
    if (!isQuitting) {
      setTimeout(prewarmNoteWindow, 300);
    }
  });
  win.webContents.on('render-process-gone', () => {
    untrackNoteWindow(win);
    noteWindowPool = noteWindowPool.filter(w => w !== win && !w.isDestroyed());
  });
  win.on('unresponsive', () => {
    untrackNoteWindow(win);
    noteWindowPool = noteWindowPool.filter(w => w !== win && !w.isDestroyed());
  });
}

function openNoteWindowInstance({ noteId, path: notePath, sourceWin } = {}) {
  const normPath = normalizeNotePath(notePath);
  const cleanNoteId = noteId && typeof noteId === 'string' ? noteId.replace(/\\/g, '/').trim() : null;
  const windowKey = cleanNoteId || normPath;
  if (!windowKey) return null;

  // Prune any destroyed windows from openNoteWindows map
  for (const [k, v] of openNoteWindows.entries()) {
    if (!v || v.isDestroyed()) {
      openNoteWindows.delete(k);
    }
  }

  const existingWin = (cleanNoteId && openNoteWindows.get(cleanNoteId)) || (normPath && openNoteWindows.get(normPath)) || openNoteWindows.get(windowKey);
  if (existingWin && !existingWin.isDestroyed()) {
    if (existingWin.isMinimized()) existingWin.restore();
    if (!existingWin.isVisible()) existingWin.show();
    if (isMac) {
      try { app.focus({ steal: true }); } catch (e) {}
    }
    existingWin.focus();

    const dispatchToExisting = () => {
      if (!existingWin.isDestroyed()) {
        existingWin.webContents.send('open-note', { noteId: cleanNoteId, path: normPath });
      }
    };
    if (existingWin.webContents.isLoading()) {
      existingWin.webContents.once('did-finish-load', dispatchToExisting);
    } else {
      dispatchToExisting();
    }
    return existingWin;
  }

  const queryParams = [];
  if (noteId) queryParams.push(`note=${encodeURIComponent(noteId)}`);
  if (normPath) queryParams.push(`path=${encodeURIComponent(normPath)}`);
  const hashQuery = queryParams.join('&') || (noteId ? `note=${encodeURIComponent(noteId)}` : `path=${encodeURIComponent(normPath)}`);
  const targetUrl = isDev
    ? `http://localhost:5173/note-window.html#${hashQuery}`
    : `app://secretary/note-window.html#${hashQuery}`;

  const winBounds = getNextNoteWindowBounds(sourceWin || mainWindow || BrowserWindow.getFocusedWindow());
  noteWindowPool = noteWindowPool.filter(w => w && !w.isDestroyed());
  let noteWin = noteWindowPool.pop();

  if (noteWin && !noteWin.isDestroyed()) {
    try { noteWin.setBounds(winBounds); } catch (e) {}
    attachNoteWinLifecycle(noteWin);
    trackNoteWindow(noteWin, noteId, normPath);

    const dispatchOpen = () => {
      if (!noteWin.isDestroyed()) {
        noteWin.webContents.send('open-note', { noteId, path: normPath });
        // Fallback display timer if renderer did not send note-window-ready within 450ms
        setTimeout(() => {
          if (!noteWin.isDestroyed() && !noteWin.isVisible()) {
            noteWin.show();
            if (isMac) {
              try { app.focus({ steal: true }); } catch (e) {}
            }
            noteWin.focus();
          }
        }, 450);
      }
    };

    if (noteWin.webContents.isLoading()) {
      noteWin.webContents.once('did-finish-load', dispatchOpen);
    } else {
      dispatchOpen();
    }
  } else {
    const frameOpts = getWindowFrameOptions();
    noteWin = new BrowserWindow({
      ...winBounds,
      minWidth: 700,
      minHeight: 500,
      title: 'Secretary Note',
      icon: appIconPath,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: getWindowBackgroundColor(),
      ...frameOpts,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });

    setupWindowOpenHandler(noteWin);
    applyWindowAppDetails(noteWin, process.platform, appIconPath);
    attachNoteWinLifecycle(noteWin);

    noteWin.loadURL(targetUrl);
    // Fallback reveal in case ready-to-show is delayed
    const showFallbackTimer = setTimeout(() => {
      if (!noteWin.isDestroyed() && !noteWin.isVisible()) {
        noteWin.show();
        if (isMac) {
          try { app.focus({ steal: true }); } catch (e) {}
        }
        noteWin.focus();
      }
    }, 750);
    noteWin.once('ready-to-show', () => {
      setTimeout(() => {
        if (!noteWin.isDestroyed() && !noteWin.isVisible()) {
          noteWin.show();
          if (isMac) {
            try { app.focus({ steal: true }); } catch (e) {}
          }
          noteWin.focus();
        }
      }, 100);
    });
    noteWin.once('closed', () => {
      clearTimeout(showFallbackTimer);
    });
  }

  trackNoteWindow(noteWin, noteId, normPath);

  if (!isQuitting) {
    setTimeout(prewarmNoteWindow, 200);
  }

  return noteWin;
}

ipcMain.on('note-window-ready', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) {
    if (noteWindowPool.includes(win)) return;
    if (!win.isVisible()) {
      win.show();
    }
    if (isMac) {
      try { app.focus({ steal: true }); } catch (e) {}
    }
    win.focus();
  }
});

ipcMain.on('note-window-active-note-changed', (event, { noteId, path: notePath } = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;
  const normPath = normalizeNotePath(notePath);
  trackNoteWindow(win, noteId, normPath);
});

ipcMain.on('open-note-window', (event, { noteId, path: notePath } = {}) => {
  const senderWin = BrowserWindow.fromWebContents(event.sender);
  openNoteWindowInstance({ noteId, path: notePath, sourceWin: senderWin });
});

ipcMain.on('theme-changed', (event, theme) => {
  if (typeof theme === 'string' && (theme === 'light' || theme === 'dark' || theme === 'system')) {
    lastKnownTheme = theme;
    const bg = getWindowBackgroundColor();
    const overlayOpts = getTitleBarOverlayOptions();
    const allWindows = BrowserWindow.getAllWindows();
    for (const win of allWindows) {
      if (win && !win.isDestroyed()) {
        try { win.setBackgroundColor(bg); } catch (e) {}
        if (isWin || isLinux) {
          try { win.setTitleBarOverlay(overlayOpts); } catch (e) {}
        }
      }
    }
  }
});

let openChatWindowInstance = null;
let lastChatWindowBounds = null;

function getChatWindowBounds(sourceWin) {
  try {
    let display = null;
    if (sourceWin && !sourceWin.isDestroyed()) {
      try {
        const b = sourceWin.getBounds();
        display = screen.getDisplayNearestPoint({
          x: Math.round(b.x + b.width / 2),
          y: Math.round(b.y + b.height / 2)
        });
      } catch (e) {}
    }
    if (!display) {
      display = screen.getPrimaryDisplay();
    }
    const { x: workX, y: workY, width: screenWidth, height: screenHeight } = display.workArea;

    // Check if user previously moved/resized the companion window and restore bounded by screen size
    if (lastChatWindowBounds) {
      const winWidth = Math.min(screenWidth, Math.max(720, Math.min(screenWidth, lastChatWindowBounds.width)));
      const winHeight = Math.min(screenHeight, Math.max(480, Math.min(screenHeight, lastChatWindowBounds.height)));
      const minX = workX;
      const maxX = Math.max(workX, workX + screenWidth - winWidth);
      const minY = workY;
      const maxY = Math.max(workY, workY + screenHeight - winHeight);
      const clampedX = Math.min(Math.max(minX, lastChatWindowBounds.x), maxX);
      const clampedY = Math.min(Math.max(minY, lastChatWindowBounds.y), maxY);
      return {
        x: Math.round(clampedX),
        y: Math.round(clampedY),
        width: Math.round(winWidth),
        height: Math.round(winHeight)
      };
    }

    // Default sizing: spacious companion window bounded strictly by the screen work area
    const winWidth = Math.min(screenWidth, Math.max(720, Math.min(1150, screenWidth - 60)));
    const winHeight = Math.min(screenHeight, Math.max(480, Math.min(800, screenHeight - 60)));

    const baseX = workX + Math.max(0, Math.round((screenWidth - winWidth) / 2));
    const baseY = workY + Math.max(0, Math.round((screenHeight - winHeight) / 2));

    return {
      x: Math.round(baseX),
      y: Math.round(baseY),
      width: Math.round(winWidth),
      height: Math.round(winHeight)
    };
  } catch (e) {
    return { width: 1100, height: 750 };
  }
}

function broadcastChatWindowState(isOpen) {
  const allWindows = BrowserWindow.getAllWindows();
  for (const win of allWindows) {
    if (win && !win.isDestroyed()) {
      try {
        win.webContents.send('chat-window-state-change', isOpen);
      } catch (e) {}
    }
  }
}

function flashChatWindowUpwards(win) {
  if (!win || win.isDestroyed()) return;

  if (win.isMinimized()) {
    win.restore();
  }
  if (!win.isVisible()) {
    win.show();
  }

  if (isMac) {
    try { app.focus({ steal: true }); } catch (e) {}
  }

  try { win.moveTop(); } catch (e) {}

  // Ensure window is brought to foreground above other windows
  try {
    win.setAlwaysOnTop(true);
    win.show();
    win.focus();
    setTimeout(() => {
      if (win && !win.isDestroyed()) {
        try { win.setAlwaysOnTop(false); } catch (e) {}
        try { win.focus(); } catch (e) {}
      }
    }, 150);
  } catch (e) {
    try { win.focus(); } catch (err) {}
  }

  // Flash native frame / taskbar / dock to attract attention
  try {
    win.flashFrame(true);
    setTimeout(() => {
      if (win && !win.isDestroyed()) {
        try { win.flashFrame(false); } catch (e) {}
      }
    }, 2400);
  } catch (e) {}

  // Send visual flash message to renderer
  try {
    win.webContents.send('flash-window-upward');
  } catch (e) {}
}

ipcMain.on('open-chat-window', (event) => {
  const senderWin = BrowserWindow.fromWebContents(event?.sender);
  if (openChatWindowInstance && !openChatWindowInstance.isDestroyed()) {
    flashChatWindowUpwards(openChatWindowInstance);
    return;
  }

  const targetUrl = isDev
    ? 'http://localhost:5173/secretary-window.html'
    : 'app://secretary/secretary-window.html';

  const frameOpts = getWindowFrameOptions();
  const winBounds = getChatWindowBounds(senderWin);
  openChatWindowInstance = new BrowserWindow({
    ...winBounds,
    minWidth: 720,
    minHeight: 480,
    title: 'Secretary AI Companion',
    icon: appIconPath,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: getWindowBackgroundColor(),
    ...frameOpts,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  setupWindowOpenHandler(openChatWindowInstance);
  applyWindowAppDetails(openChatWindowInstance, process.platform, appIconPath);

  const saveBounds = () => {
    if (openChatWindowInstance && !openChatWindowInstance.isDestroyed() && !openChatWindowInstance.isMinimized() && !openChatWindowInstance.isMaximized()) {
      try {
        lastChatWindowBounds = openChatWindowInstance.getBounds();
      } catch (e) {}
    }
  };
  openChatWindowInstance.on('resize', saveBounds);
  openChatWindowInstance.on('move', saveBounds);

  openChatWindowInstance.webContents.on('did-fail-load', (e, errorCode) => {
    if (errorCode !== -3 && openChatWindowInstance && !openChatWindowInstance.isDestroyed()) {
      const fallbackUrl = isDev
        ? 'http://localhost:5173/app.html#chat-window=true'
        : 'app://secretary/app.html#chat-window=true';
      try { openChatWindowInstance.loadURL(fallbackUrl); } catch (err) {}
    }
  });

  openChatWindowInstance.loadURL(targetUrl);
  openChatWindowInstance.once('ready-to-show', () => {
    if (openChatWindowInstance && !openChatWindowInstance.isDestroyed()) {
      openChatWindowInstance.show();
      if (isMac) {
        try { app.focus({ steal: true }); } catch (e) {}
      }
      openChatWindowInstance.focus();
      broadcastChatWindowState(true);
    }
  });

  openChatWindowInstance.on('closed', () => {
    openChatWindowInstance = null;
    broadcastChatWindowState(false);
    checkAllWindowsClosed();
  });
});

ipcMain.handle('is-chat-window-open', () => {
  return !!(openChatWindowInstance && !openChatWindowInstance.isDestroyed());
});

let openFocusPipInstance = null;

ipcMain.on('open-focus-pip-window', () => {
  if (openFocusPipInstance && !openFocusPipInstance.isDestroyed()) {
    if (openFocusPipInstance.isMinimized()) openFocusPipInstance.restore();
    openFocusPipInstance.focus();
    return;
  }

  const targetUrl = isDev
    ? 'http://localhost:5173/app.html#focus-pip=true'
    : 'app://secretary/app.html#focus-pip=true';

  openFocusPipInstance = new BrowserWindow({
    width: 320,
    height: 150,
    minWidth: 260,
    minHeight: 120,
    title: 'Secretary Focus HUD',
    icon: appIconPath,
    show: false,
    alwaysOnTop: true,
    frame: false,
    resizable: true,
    backgroundColor: getWindowBackgroundColor(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  setupWindowOpenHandler(openFocusPipInstance);
  applyWindowAppDetails(openFocusPipInstance, process.platform, appIconPath);

  openFocusPipInstance.loadURL(targetUrl);
  openFocusPipInstance.once('ready-to-show', () => {
    if (openFocusPipInstance && !openFocusPipInstance.isDestroyed()) {
      openFocusPipInstance.show();
      openFocusPipInstance.focus();
    }
  });

  openFocusPipInstance.on('closed', () => {
    openFocusPipInstance = null;
    checkAllWindowsClosed();
  });
});

ipcMain.handle('show-save-dialog', async (event, options) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow() || mainWindow;
    if (!win || win.isDestroyed()) return { canceled: true, filePath: '' };
    return await dialog.showSaveDialog(win, options || {});
  } catch (err) {
    console.warn('[Secretary Main] show-save-dialog error:', err);
    return { canceled: true, filePath: '' };
  }
});

ipcMain.on('sync-broadcast', (event, msg) => {
  const allWindows = BrowserWindow.getAllWindows();
  for (const win of allWindows) {
    if (win.webContents !== event.sender && !win.isDestroyed()) {
      win.webContents.send('sync-message', msg);
    }
  }
});

// Register custom scheme 'app' as secure so Chromium File System Access API works in production
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      bypassCSP: true
    }
  }
]);

function createWindow() {
  const frameOptions = getWindowFrameOptions();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 900,
    minHeight: 600,
    title: 'Secretary',
    icon: appIconPath,
    show: false,
    backgroundColor: getWindowBackgroundColor(),
    ...frameOptions,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173/app.html');
  } else {
    mainWindow.loadURL('app://secretary/app.html');
  }

  setupWindowOpenHandler(mainWindow);
  applyWindowAppDetails(mainWindow, process.platform, appIconPath);

  mainWindow.webContents.once('did-finish-load', () => {
    const action = parseCommandLineAction(process.argv);
    if (action && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app-action', action);
    }
    if (Array.isArray(process.argv)) {
      const fileArg = process.argv.find(arg => arg && typeof arg === 'string' && (arg.endsWith('.html') || arg.endsWith('.md')));
      if (fileArg && fs.existsSync(fileArg)) {
        const rel = path.relative(currentWorkspacePath || path.dirname(fileArg), fileArg);
        const norm = normalizeNotePath(rel);
        if (norm) {
          openNoteWindowInstance({ path: norm, sourceWin: mainWindow });
        }
      }
    }
  });

  // Custom Application Menu
  const menuTemplate = [
    {
      label: 'Secretary',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { role: 'close' },
        { type: 'separator' },
        { role: 'front' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);

  mainWindow.on('close', (e) => {
    if (isAppCloseConfirmed) {
      closeAllAuxiliaryWindows();
      return;
    }
    e.preventDefault();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('main-window-close-request');
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    closeAllAuxiliaryWindows();
    checkAllWindowsClosed();
  });
}

function setupWindowOpenHandler(win) {
  if (!win || win.isDestroyed()) return;

  win.webContents.on('will-navigate', (event, url) => {
    const isInternalApp = url.startsWith('app://') || url.includes('localhost:') || url.includes('127.0.0.1:') || url.startsWith('file://');
    if (!isInternalApp && (url.startsWith('http:') || url.startsWith('https:'))) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    const isInternalApp = url.startsWith('app://') || url.includes('localhost:') || url.includes('127.0.0.1:') || url.startsWith('file://');
    if (!isInternalApp && (url.startsWith('http:') || url.startsWith('https:'))) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    const frameOpts = getWindowFrameOptions();
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 1100,
        height: 750,
        minWidth: 700,
        minHeight: 500,
        title: 'Secretary',
        icon: appIconPath,
        autoHideMenuBar: true,
        backgroundColor: getWindowBackgroundColor(),
        ...frameOpts,
        webPreferences: {
          preload: path.join(__dirname, 'preload.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false
        }
      }
    };
  });
}

app.whenReady().then(() => {
  // Automatically authorize media (microphone) and notifications for local application windows
  if (session && session.defaultSession) {
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      const allowed = ['media', 'notifications', 'accessibility-events', 'clipboard-read', 'fullscreen'];
      if (allowed.includes(permission)) {
        return callback(true);
      }
      callback(true);
    });

    session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
      const allowed = ['media', 'notifications', 'accessibility-events', 'clipboard-read', 'fullscreen'];
      return allowed.includes(permission);
    });
  }

  // Update background colors of pooled pre-warmed windows when theme changes
  nativeTheme.on('updated', () => {
    const bg = getWindowBackgroundColor();
    const overlayOpts = getTitleBarOverlayOptions();
    const allWindows = BrowserWindow.getAllWindows();
    for (const win of allWindows) {
      if (!win.isDestroyed()) {
        try { win.setBackgroundColor(bg); } catch (e) {}
        if (isWin || isLinux) {
          try { win.setTitleBarOverlay(overlayOpts); } catch (e) {}
        }
      }
    }
  });

  // Secure protocol handler for app://secretary/... serving dist assets
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    let relativePath = url.pathname.replace(/^\/+/, '');
    if (!relativePath) {
      relativePath = 'app.html';
    }
    const distDir = path.resolve(__dirname, '../dist');
    const finalPath = path.resolve(distDir, relativePath);

    // Verify target path remains inside dist directory to prevent traversal
    if (!finalPath.startsWith(distDir + path.sep) && finalPath !== distDir) {
      return new Response('Access Denied', { status: 403 });
    }
    return net.fetch(pathToFileURL(finalPath).toString());
  });

  app.on('browser-window-created', (event, win) => {
    applyWindowAppDetails(win, process.platform, appIconPath);
    setupWindowOpenHandler(win);
    win.on('enter-full-screen', () => {
      win.webContents.send('fullscreen-change', true);
    });
    win.on('leave-full-screen', () => {
      win.webContents.send('fullscreen-change', false);
    });
    win.on('maximize', () => {
      win.webContents.send('window-maximized-change', true);
    });
    win.on('unmaximize', () => {
      win.webContents.send('window-maximized-change', false);
    });
  });

  createWindow();
  setTimeout(prewarmNoteWindow, 800);

  try {
    const omniShortcut = isMac ? 'Command+Shift+Space' : 'Control+Shift+Space';
    globalShortcut.register(omniShortcut, () => {
      const activeWindows = BrowserWindow.getAllWindows().filter(w => !w.isDestroyed() && w.isVisible());
      const targetWin = BrowserWindow.getFocusedWindow() || (activeWindows.length > 0 ? activeWindows[0] : mainWindow);
      if (targetWin && !targetWin.isDestroyed()) {
        if (targetWin.isMinimized()) targetWin.restore();
        targetWin.show();
        targetWin.focus();
        setTimeout(() => {
          if (targetWin && !targetWin.isDestroyed()) {
            targetWin.webContents.send('trigger-omnibar');
          }
        }, 40);
      }
    });
  } catch (e) {
    console.warn('[Secretary Main] Failed to register global shortcut:', e);
  }

  app.on('activate', () => {
    isQuitting = false;
    const nonPoolWindows = BrowserWindow.getAllWindows().filter(w => !w.isDestroyed() && !noteWindowPool.includes(w));
    if (nonPoolWindows.length === 0) {
      createWindow();
      setTimeout(prewarmNoteWindow, 800);
    } else {
      const targetWin = BrowserWindow.getFocusedWindow() || nonPoolWindows[0];
      if (targetWin && !targetWin.isDestroyed()) {
        if (targetWin.isMinimized()) targetWin.restore();
        if (!targetWin.isVisible()) targetWin.show();
        if (isMac) {
          try { app.focus({ steal: true }); } catch (e) {}
        }
        targetWin.focus();
      }
    }
  });
});

app.on('before-quit', (e) => {
  if (isAppCloseConfirmed) {
    isQuitting = true;
    closeAllAuxiliaryWindows();
    return;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    e.preventDefault();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    mainWindow.webContents.send('main-window-close-request');
    return;
  }
  isQuitting = true;
  try {
    globalShortcut.unregisterAll();
  } catch (e) {}
  closeAllAuxiliaryWindows();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});


