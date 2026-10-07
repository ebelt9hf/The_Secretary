// ── Secretary: File System ──
// ═══ File System helpers ═══

/** Navigate to a nested directory (read-only nav). Throws if not found. */
async function getDirHandle(pathStr) {
  if (!rootHandle) throw new Error('No root folder handle loaded');
  if (typeof rootHandle.getDirectoryHandle !== 'function') {
    const err = new Error(`FileSystemDirectoryHandle not available for directory navigation: ${pathStr}`);
    err.name = 'NotFoundError';
    throw err;
  }
  let handle = rootHandle;
  for (const part of pathStr.split('/').filter(Boolean)) {
    handle = await handle.getDirectoryHandle(part);
  }
  return handle;
}

/** Navigate to a nested directory, creating intermediate dirs as needed. */
async function getOrCreateDirHandle(pathStr) {
  if (!rootHandle) throw new Error('No root folder handle loaded');
  if (typeof rootHandle.getDirectoryHandle !== 'function') {
    const err = new Error(`FileSystemDirectoryHandle not available for creating directory: ${pathStr}`);
    err.name = 'NotFoundError';
    throw err;
  }
  let handle = rootHandle;
  for (const part of pathStr.split('/').filter(Boolean)) {
    handle = await handle.getDirectoryHandle(part, { create: true });
  }
  return handle;
}

/** Read a text file by path relative to root. */
async function readFile(pathStr) {
  if (!pathStr || !pathStr.trim()) throw new Error('Invalid file path');
  if (window.AppBridge?.fs?.hasNativeFS()) {
    const res = await window.AppBridge.fs.readFile(pathStr);
    if (res !== null && res !== undefined) return res;
    const err = new Error(`File not found: ${pathStr}`);
    err.name = 'NotFoundError';
    throw err;
  }
  const parts = pathStr.split('/').filter(Boolean);
  const name  = parts.pop();
  if (!name) throw new Error(`Invalid file path: ${pathStr}`);
  const dir   = parts.length ? await getDirHandle(parts.join('/')) : rootHandle;
  if (!dir || typeof dir.getFileHandle !== 'function') {
    const err = new Error(`FileSystemDirectoryHandle not available to get file: ${name}`);
    err.name = 'NotFoundError';
    throw err;
  }
  const fh    = await dir.getFileHandle(name);
  return (await fh.getFile()).text();
}

const _assetDataUrlCache = new Map();

/** Read a binary asset (image) and return as a base64 Data URL. */
async function readAssetAsDataUrl(pathStr) {
  if (!pathStr || !pathStr.trim()) return null;
  const normalized = pathStr.replace(/^[./\\]+/, '').replace(/^\/+/, '');
  if (_assetDataUrlCache.has(normalized)) {
    return _assetDataUrlCache.get(normalized);
  }
  const altKey = normalized.startsWith('notes/') ? normalized.slice(6) : `notes/${normalized}`;
  if (_assetDataUrlCache.has(altKey)) {
    return _assetDataUrlCache.get(altKey);
  }
  const fileName = normalized.split('/').pop();
  if (fileName && _assetDataUrlCache.has(fileName)) {
    return _assetDataUrlCache.get(fileName);
  }

  if (typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked && window.StorageAPI?.getStorageEngine() === 'firebase') {
    try {
      const assetData = await window.FirebaseSyncService.getAsset(fileName || normalized) || (fileName ? await window.FirebaseSyncService.getAsset(normalized) : null);
      if (assetData) {
        _assetDataUrlCache.set(normalized, assetData);
        _assetDataUrlCache.set(altKey, assetData);
        if (fileName) _assetDataUrlCache.set(fileName, assetData);
        return assetData;
      }
    } catch (e) {}
  }

  let res = null;
  if (window.AppBridge?.fs?.hasNativeFS()) {
    try {
      res = await window.AppBridge.fs.readAsset(normalized);
      if (!res && fileName && fileName !== normalized) {
        res = await window.AppBridge.fs.readAsset(fileName);
      }
    } catch (e) {
      console.warn('Native readAsset failed:', normalized, e);
    }
  }

  if (!res) {
    // Web FileSystemAccess API fallback
    try {
      if (typeof rootHandle !== 'undefined' && rootHandle) {
        const parts = normalized.split('/').filter(Boolean);
        const name = parts.pop();
        if (name) {
          const dir = parts.length ? await getDirHandle(parts.join('/')) : rootHandle;
          const fh = await dir.getFileHandle(name);
          const file = await fh.getFile();
          res = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(file);
          });
        }
      }
    } catch (e) {
      console.warn('Web FS readAssetAsDataUrl failed:', normalized, e);
    }
  }

  if (res) {
    _assetDataUrlCache.set(normalized, res);
    _assetDataUrlCache.set(altKey, res);
    if (fileName) _assetDataUrlCache.set(fileName, res);

    if (typeof window !== 'undefined' && window.StorageAPI?.getStorageEngine() === 'firebase' && window.FirebaseSyncService?.saveAsset && window.FirebaseSyncService?.state?.isUnlocked) {
      try {
        window.FirebaseSyncService.saveAsset(fileName || normalized, res, {}, 5000);
      } catch (e) {}
    }
    return res;
  }
  return null;
}

if (typeof window !== 'undefined') {
  window._assetDataUrlCache = _assetDataUrlCache;
  window.readAssetAsDataUrl = readAssetAsDataUrl;
}
if (typeof globalThis !== 'undefined') {
  globalThis._assetDataUrlCache = _assetDataUrlCache;
  globalThis.readAssetAsDataUrl = readAssetAsDataUrl;
}

var _activeWrites = typeof window !== 'undefined' && window._activeWrites ? window._activeWrites : new Set();
var _writeQueues = typeof window !== 'undefined' && window._writeQueues ? window._writeQueues : new Map();
if (typeof window !== 'undefined') {
  window._activeWrites = _activeWrites;
  window._writeQueues = _writeQueues;
}

function isSaveInProgress() {
  return _activeWrites.size > 0;
}

async function finalizeSaves(progress) {
  const total = _activeWrites.size;
  if (total === 0) return;
  
  let completed = 0;
  const promises = Array.from(_activeWrites).map(p => {
    return p.then(() => {
      completed++;
      if (progress && typeof progress.update === 'function') {
        progress.update(
          (t('editor.closingSaveStep') || 'Saving note...') + ` (${completed}/${total})`,
          Math.round((completed / total) * 100)
        );
      }
    }).catch((err) => {
      completed++;
      if (progress && typeof progress.update === 'function') {
        progress.update(
          (t('common.saveFailed') || 'Save failed') + ` (${completed}/${total})`,
          Math.round((completed / total) * 100)
        );
      }
      console.error('Save failed during finalization', err);
    });
  });
  
  await Promise.all(promises);
}

/** Write a text file by path relative to root (creates dirs + file). */
async function writeFile(pathStr, content) {
  if (!pathStr || !pathStr.trim()) throw new Error('Invalid file path');
  // Serialize writes to the same path within this window
  const prev = _writeQueues.get(pathStr) || Promise.resolve();
  
  let writeResolve;
  const writeTrackingPromise = new Promise(resolve => {
    writeResolve = resolve;
  });
  _activeWrites.add(writeTrackingPromise);

  const next = prev.then(async () => {
    try {
      await _writeFileDirect(pathStr, content);
    } finally {
      _activeWrites.delete(writeTrackingPromise);
      writeResolve();
    }
  });
  
  const wrapped = next.catch(() => {}).then(() => {
    if (_writeQueues.get(pathStr) === wrapped) {
      _writeQueues.delete(pathStr);
    }
  });

  _writeQueues.set(pathStr, wrapped);
  return next;
}

async function _writeFileDirect(pathStr, content) {
  if (typeof window !== 'undefined' && window.StorageAPI?.getStorageEngine() === 'firebase' && window.FirebaseSyncService?.saveAsset && pathStr.includes('_assets/')) {
    try {
      await window.FirebaseSyncService.saveAsset(pathStr, content);
      return true;
    } catch (e) {
      console.warn('FirebaseSyncService saveAsset direct failed:', pathStr, e);
    }
  }
  if (window.AppBridge?.fs?.hasNativeFS()) {
    const res = await window.AppBridge.fs.writeFile(pathStr, content);
    if (res !== null) return res;
  }
  const parts = pathStr.split('/').filter(Boolean);
  const name  = parts.pop();
  if (!name) throw new Error(`Invalid target filename in path: ${pathStr}`);
  const dir   = parts.length ? await getOrCreateDirHandle(parts.join('/')) : rootHandle;
  const fh    = await dir.getFileHandle(name, { create: true });
  const w     = await fh.createWritable();
  try {
    if (typeof content === 'string' && content.startsWith('data:image/')) {
      const blob = await fetch(content).then(r => r.blob());
      await w.write(blob);
    } else {
      await w.write(content);
    }
    await w.close();
  } catch (err) {
    await w.abort().catch(() => {});
    throw err;
  }
}

/** Delete a file by path relative to root. */
async function deleteFile(pathStr) {
  if (!pathStr || !pathStr.trim()) return;
  if (window.AppBridge?.fs?.hasNativeFS()) {
    const res = await window.AppBridge.fs.deleteFile(pathStr);
    if (res !== null) return res;
  }
  const parts = pathStr.split('/').filter(Boolean);
  const name  = parts.pop();
  if (!name) return;
  const dir   = parts.length ? await getDirHandle(parts.join('/')) : rootHandle;
  await dir.removeEntry(name);
}

/** List *.md filenames in a directory. Returns [] if dir missing. */
async function listMdFiles(pathStr) {
  if (window.AppBridge?.fs?.hasNativeFS()) {
    try {
      const files = await window.AppBridge.fs.listFiles(pathStr);
      if (files !== null) {
        return (files || []).filter(f => (f.isFile || !f.isDirectory) && f.name.endsWith('.md')).map(f => f.name).sort((a, b) => a.localeCompare(b));
      }
    } catch { return []; }
  }
  try {
    const dir   = await getDirHandle(pathStr);
    const names = [];
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === 'file' && name.endsWith('.md')) names.push(name);
    }
    return names.sort((a, b) => a.localeCompare(b));
  } catch { return []; }
}

/** Check if a file exists. */
async function fileExists(pathStr) {
  if (window.AppBridge?.fs?.hasNativeFS() && typeof window.AppBridge.fs.fileExists === 'function') {
    const res = await window.AppBridge.fs.fileExists(pathStr);
    if (res !== null && res !== undefined) return res;
  }
  try { await readFile(pathStr); return true; } catch { return false; }
}

/** Generate a unique filename by appending -2, -3 etc if needed. */
async function uniqueFilePath(dirPath, baseName, ext) {
  let filename = baseName + ext;
  let n = 2;
  while (await fileExists(`${dirPath}/${filename}`)) {
    filename = `${baseName}-${n}${ext}`;
    n++;
  }
  return `${dirPath}/${filename}`;
}

// ═══ IndexedDB — persist directory handle across sessions ═══
const IDB_NAME  = 'secretary-app';
const IDB_STORE = 'handles';
const IDB_KEY   = 'last-folder';

// ═══ IDB ═══
function openIDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB is not supported in this environment'));
    }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error || new Error('Failed to open IndexedDB'));
  });
}

async function saveHandleIDB(handle) {
  if (typeof indexedDB === 'undefined') return;
  try {
    const db = await openIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(handle, IDB_KEY);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror    = e => { db.close(); reject(e.target.error); };
      tx.onabort    = e => { db.close(); reject(e.target.error); };
    });
  } catch (e) {
    console.warn('saveHandleIDB failed', e);
  }
}

async function loadHandleIDB() {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const db = await openIDB();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = e => { db.close(); resolve(e.target.result || null); };
      req.onerror   = e => { db.close(); reject(e.target.error); };
      tx.onabort    = e => { db.close(); reject(e.target.error); };
    });
  } catch (e) {
    console.warn('loadHandleIDB failed', e);
    return null;
  }
}

function deepMerge(target, source) {
  if (!target || typeof target !== 'object') target = {};
  for (const key of Object.keys(source || {})) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const val = source[key];
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      if (!target[key] || typeof target[key] !== 'object') target[key] = {};
      deepMerge(target[key], val);
    } else {
      target[key] = val;
    }
  }
  return target;
}

