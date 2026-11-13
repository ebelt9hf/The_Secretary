import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

/**
 * Unit Tests: Fast Startup, Bounded Memory & Lazy Note Loading
 *
 * 4-Point Audit:
 * 1. Protected Behavior:
 *    - StorageAPI.preloadRecentNotes only preloads notes within the recent window (last 4 weeks) and skips older notes.
 *    - StorageAPI._noteCache enforces LRU eviction at NOTE_CACHE_LIMIT so memory does not grow unboundedly.
 *    - StorageAPI.readNoteContent loads older (un-preloaded) notes on demand.
 *    - FirebaseSyncService.listenRemoteVault uses listenVaultIndex when available, avoiding body downloads for old notes while fetching bodies for recent notes.
 *    - FirebaseSyncService.getNote fetches uncached older notes on demand via bridge.getNote.
 *    - FirebaseSyncService.unlockVault hydrates localCache with only recent notes via VaultIDBStorage.getRecentNotes.
 * 2. Regression Target:
 *    - Fails if preloadRecentNotes reads old notes, if _noteCache exceeds NOTE_CACHE_LIMIT, if listenRemoteVault downloads bodies for old notes, or if unlockVault calls getAllNotes instead of getRecentNotes.
 * 3. Coverage Overlap & Redundancy:
 *    - Distinct from app-backend-storage.test.js (which tests preloadAllNotes) and app-firebase-2tier-sync.test.js (which tests 2-tier writes).
 * 4. Production Code Footprint:
 *    - Zero test-only helpers in production code; exercises public StorageAPI, VaultIDBStorage, and FirebaseSyncService contracts.
 */
describe('Fast Startup, Bounded Note Memory & Firebase Lazy Sync', () => {
  beforeAll(() => {
    loadScriptsIntoGlobal([
      'js/firebase-config.js',
      'js/app-crypto.js',
      'js/app-idb.js',
      'js/app-firebase-sync.js',
      'js/app-storage.js'
    ]);
  });

  beforeEach(() => {
    StorageAPI.clearNoteCache();
    StorageAPI.setStorageEngine('filesystem');
    globalThis.manifest = [];
    window.FirebaseBridge = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    StorageAPI.clearNoteCache();
    globalThis.manifest = [];
  });

  it('preloadRecentNotes loads only notes from the last 4 weeks and leaves older notes to load on demand', async () => {
    const now = Date.now();
    const recentIso = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString();
    const oldIso = new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString();

    const files = new Map([
      ['notes/recent.html', '<p>Recent note</p>'],
      ['notes/old.html', '<p>Old note</p>']
    ]);
    globalThis.readFile = vi.fn(async (p) => files.get(p) || '');
    globalThis.manifest = [
      { path: 'notes/recent.html', title: 'Recent', modified: recentIso },
      { path: 'notes/old.html', title: 'Old', modified: oldIso }
    ];

    const res = await StorageAPI.preloadRecentNotes({ weeks: 4 });
    expect(res.total).toBe(1);
    expect(res.loaded).toBe(1);
    expect(StorageAPI.getNoteFromCache('notes/recent.html')).toBe('<p>Recent note</p>');
    expect(StorageAPI.getNoteFromCache('notes/old.html')).toBeNull();
    expect(globalThis.readFile).toHaveBeenCalledTimes(1);
    expect(globalThis.readFile).toHaveBeenCalledWith('notes/recent.html');

    // Older note is still loaded cleanly on demand
    const onDemand = await StorageAPI.readNoteContent('notes/old.html');
    expect(onDemand).toBe('<p>Old note</p>');
    expect(StorageAPI.getNoteFromCache('notes/old.html')).toBe('<p>Old note</p>');
  });

  it('evicts oldest entries from StorageAPI._noteCache when exceeding NOTE_CACHE_LIMIT', () => {
    const origLimit = StorageAPI.NOTE_CACHE_LIMIT;
    StorageAPI.NOTE_CACHE_LIMIT = 3;
    try {
      StorageAPI._setNoteCache('notes/1.html', 'one');
      StorageAPI._setNoteCache('notes/2.html', 'two');
      StorageAPI._setNoteCache('notes/3.html', 'three');
      // Access 1.html to refresh its LRU position
      expect(StorageAPI.getNoteFromCache('notes/1.html')).toBe('one');
      // Adding 4.html should evict 2.html (least recently used)
      StorageAPI._setNoteCache('notes/4.html', 'four');

      expect(StorageAPI._noteCache.size).toBe(3);
      expect(StorageAPI._noteCache.has('notes/2.html')).toBe(false);
      expect(StorageAPI.getNoteFromCache('notes/1.html')).toBe('one');
      expect(StorageAPI.getNoteFromCache('notes/3.html')).toBe('three');
      expect(StorageAPI.getNoteFromCache('notes/4.html')).toBe('four');
    } finally {
      StorageAPI.NOTE_CACHE_LIMIT = origLimit;
    }
  });

  it('FirebaseSyncService.listenRemoteVault uses listenVaultIndex and skips downloading bodies for old notes', async () => {
    const masterKey = await CryptoEngine.deriveKey('test-passphrase', CryptoEngine.generateSalt());
    const now = Date.now();
    const recentTs = now - 2 * 24 * 60 * 60 * 1000;
    const oldTs = now - 120 * 24 * 60 * 60 * 1000;

    const encRecentMeta = await CryptoEngine.encryptData(masterKey, {
      id: 'note-recent',
      title: 'Recent Cloud Note',
      updatedAt: recentTs
    });
    const encRecentBody = await CryptoEngine.encryptData(masterKey, {
      contentHtml: '<p>Recent body</p>'
    });
    const encOldMeta = await CryptoEngine.encryptData(masterKey, {
      id: 'note-old',
      title: 'Old Cloud Note',
      updatedAt: oldTs
    });
    const encOldBody = await CryptoEngine.encryptData(masterKey, {
      contentHtml: '<p>Huge old body</p>'
    });

    let indexCallback = null;
    const getNoteBodySpy = vi.fn(async (_uid, noteId) => {
      if (noteId === 'note-recent') return encRecentBody;
      if (noteId === 'note-old') return encOldBody;
      return null;
    });
    const getNoteSpy = vi.fn(async (_uid, noteId) => {
      if (noteId === 'note-old') return { id: 'note-old', meta: encOldMeta, body: encOldBody };
      return null;
    });

    window.FirebaseBridge = {
      listenVaultIndex: vi.fn((_uid, onUpdate) => {
        indexCallback = onUpdate;
        return () => {};
      }),
      listenVault: vi.fn(() => () => {}),
      getNoteBody: getNoteBodySpy,
      getNote: getNoteSpy
    };

    FirebaseSyncService.state.userId = 'user_lazy_test';
    FirebaseSyncService.state.isUnlocked = true;
    FirebaseSyncService.state.masterKey = masterKey;
    FirebaseSyncService.state.localCache = new Map();
    FirebaseSyncService.state.manifestCache = new Map();

    FirebaseSyncService.listenRemoteVault();
    expect(window.FirebaseBridge.listenVaultIndex).toHaveBeenCalledTimes(1);
    expect(window.FirebaseBridge.listenVault).not.toHaveBeenCalled();

    await indexCallback({
      'note-recent': { id: 'note-recent', meta: encRecentMeta, updatedAt: recentTs },
      'note-old': { id: 'note-old', meta: encOldMeta, updatedAt: oldTs }
    });

    // Only recent note body was downloaded; old note is in manifestCache only
    expect(getNoteBodySpy).toHaveBeenCalledTimes(1);
    expect(getNoteBodySpy).toHaveBeenCalledWith('user_lazy_test', 'note-recent');
    expect(FirebaseSyncService.state.manifestCache.has('note-old')).toBe(true);
    expect(FirebaseSyncService.state.localCache.has('note-recent')).toBe(true);
    expect(FirebaseSyncService.state.localCache.has('note-old')).toBe(false);

    // Opening the old note later fetches it on demand via bridge.getNote
    vi.spyOn(VaultIDBStorage, 'getNote').mockResolvedValue(null);
    vi.spyOn(VaultIDBStorage, 'putNote').mockResolvedValue(true);
    const oldNote = await FirebaseSyncService.getNote('note-old');
    expect(getNoteSpy).toHaveBeenCalledWith('user_lazy_test', 'note-old');
    expect(oldNote).not.toBeNull();
    expect(oldNote.title).toBe('Old Cloud Note');
    expect(oldNote.contentHtml).toBe('<p>Huge old body</p>');
  });

  it('FirebaseSyncService.unlockVault hydrates localCache with only recent notes from IndexedDB', async () => {
    const pass = 'vault-pass-123';
    const { vaultMeta } = await CryptoEngine.setupVault(pass);
    const recentRec = { id: 'n-recent', title: 'Recent', contentHtml: '<p>R</p>', updatedAt: Date.now() };

    const getRecentSpy = vi.spyOn(VaultIDBStorage, 'getRecentNotes').mockResolvedValue([recentRec]);
    const getAllSpy = vi.spyOn(VaultIDBStorage, 'getAllNotes').mockResolvedValue([
      recentRec,
      { id: 'n-old', title: 'Old', contentHtml: '<p>O</p>', updatedAt: 1000 }
    ]);
    vi.spyOn(VaultIDBStorage, 'getMeta').mockResolvedValue([{ id: 'n-recent', title: 'Recent' }, { id: 'n-old', title: 'Old' }]);
    vi.spyOn(FirebaseSyncService, 'listenRemoteVault').mockReturnValue(() => {});
    vi.spyOn(FirebaseSyncService, '_recoverFromWAL').mockResolvedValue();

    FirebaseSyncService.state.userId = 'user_unlock_test';
    FirebaseSyncService.state.localCache = new Map();
    FirebaseSyncService.state.manifestCache = new Map();

    const ok = await FirebaseSyncService.unlockVault(pass, vaultMeta);
    expect(ok).toBe(true);
    expect(getRecentSpy).toHaveBeenCalledTimes(1);
    expect(getAllSpy).not.toHaveBeenCalled();
    expect(FirebaseSyncService.state.localCache.has('n-recent')).toBe(true);
    expect(FirebaseSyncService.state.localCache.has('n-old')).toBe(false);
    expect(FirebaseSyncService.state.manifestCache.has('n-old')).toBe(true);
  });
});

