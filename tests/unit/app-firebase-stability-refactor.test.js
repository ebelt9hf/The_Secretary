import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Firebase & Storage Stability Refactor Tests', () => {
  beforeAll(() => {
    globalThis.window = globalThis.window || {};
    globalThis.t = (key) => key;
    globalThis.escH = (s) => String(s || '');
    globalThis.escA = (s) => String(s || '');
    globalThis.normalizeLanguageCode = (c) => c || 'en';
    globalThis.applyLocalizedUI = () => {};

    loadScriptsIntoGlobal([
      'js/translations.js',
      'js/firebase-config.js',
      'js/app-crypto.js',
      'js/app-utils.js',
      'js/app-storage.js',
      'js/app-firebase-sync.js',
      'js/app-notes.js',
      'js/app-planner.js',
      'js/app-init.js'
    ]);
  });

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="screen-connect" style="display:none"></div>
      <div id="screen-main"></div>
      <div id="modal-cloud-sync-setup" class="modal-overlay" style="display:none"></div>
      <div id="modal-cloud-link-email" class="modal-overlay" style="display:none"></div>
      <div id="modal-cloud-password-reset" class="modal-overlay" style="display:none"></div>
      <input id="link-email-input" value="test@example.com">
      <input id="link-password-input" value="secretpass123">
      <input id="sync-reset-password-email" value="test@example.com">
      <div id="sync-reset-password-msg" style="display:none"></div>
    `;
  });

  describe('VaultIDBStorage Generic & _runTx Operations', () => {
    it('handles fallback gracefully when db is null', async () => {
      const storage = window.VaultIDBStorage;
      expect(storage).toBeDefined();

      const origDb = storage.db;
      storage.db = null;

      const resGet = await storage.getRecord('notes', 'missing-id', null);
      expect(resGet).toBeNull();

      const resAll = await storage.getAllRecords('notes', []);
      expect(resAll).toEqual([]);

      const resDelete = await storage.deleteRecord('notes', 'some-id');
      expect(resDelete).toBe(true);

      const resClear = await storage.clearStore('notes');
      expect(resClear).toBe(true);

      storage.db = origDb;
    });

    it('delegates note-specific operations through generic record helpers', async () => {
      const storage = window.VaultIDBStorage;
      const getSpy = vi.spyOn(storage, 'getRecord').mockResolvedValue({ id: 'note-1', content: 'test' });
      const putSpy = vi.spyOn(storage, 'putRecord').mockResolvedValue(true);
      const allSpy = vi.spyOn(storage, 'getAllRecords').mockResolvedValue([{ id: 'note-1' }]);
      const delSpy = vi.spyOn(storage, 'deleteRecord').mockResolvedValue(true);
      const clrSpy = vi.spyOn(storage, 'clearStore').mockResolvedValue(true);

      await storage.putNote('note-1', { content: 'test' });
      expect(putSpy).toHaveBeenCalledWith('notes', { id: 'note-1', content: 'test' });

      const note = await storage.getNote('note-1');
      expect(getSpy).toHaveBeenCalledWith('notes', 'note-1');
      expect(note).toEqual({ id: 'note-1', content: 'test' });

      const all = await storage.getAllNotes();
      expect(allSpy).toHaveBeenCalledWith('notes');
      expect(all).toEqual([{ id: 'note-1' }]);

      await storage.deleteNote('note-1');
      expect(delSpy).toHaveBeenCalledWith('notes', 'note-1');

      await storage.clearNotes();
      expect(clrSpy).toHaveBeenCalledWith('notes');

      getSpy.mockRestore();
      putSpy.mockRestore();
      allSpy.mockRestore();
      delSpy.mockRestore();
      clrSpy.mockRestore();
    });
  });

  describe('FirebaseSyncService Validation Helpers', () => {
    it('validates email addresses correctly', () => {
      const service = window.FirebaseSyncService;
      expect(service._validateEmail('user@example.com')).toBe('user@example.com');
      expect(service._validateEmail('   test@domain.org  ')).toBe('test@domain.org');
      expect(() => service._validateEmail('')).toThrow();
      expect(() => service._validateEmail('invalid-email')).toThrow();
      expect(() => service._validateEmail(null)).toThrow();
    });

    it('validates passwords and minimum length constraints', () => {
      const service = window.FirebaseSyncService;
      expect(service._validatePassword('validpass', 6)).toBe('validpass');
      expect(() => service._validatePassword('12345', 6)).toThrow();
      expect(() => service._validatePassword('', 6)).toThrow();
      expect(() => service._validatePassword(null, 6)).toThrow();
    });
  });

  describe('StorageAPI _collectLocalNoteEntries Helper', () => {
    it('collects note entries from manifest and buffer into a Map', async () => {
      globalThis.manifest = [
        { id: 'note-1', path: 'notes/note-1.html', title: 'Note 1', updated: 1000 }
      ];
      globalThis.metadataBuffer = [
        { id: 'note-2', path: 'notes/note-2.html', title: 'Note 2', updated: 2000 }
      ];

      const localMap = await window.StorageAPI._collectLocalNoteEntries();
      expect(localMap instanceof Map).toBe(true);
      expect(localMap.has('note-1')).toBe(true);
      expect(localMap.get('note-1').title).toBe('Note 1');
      expect(localMap.has('note-2')).toBe(true);
      expect(localMap.get('note-2').title).toBe('Note 2');
    });
  });

  describe('finalizeCloudSyncSessionUI Helper', () => {
    it('executes rememberPassphrase, closes modal, and triggers notifications', async () => {
      let remembered = null;
      globalThis.rememberPassphraseAfterSetup = async (p) => { remembered = p; };

      let closedModal = null;
      globalThis.closeModal = (id) => { closedModal = id; };

      let toastMsg = null;
      globalThis.showToast = (msg) => { toastMsg = msg; };

      let uiUpdated = false;
      globalThis.updateCloudSyncUI = () => { uiUpdated = true; };

      let boardRendered = false;
      globalThis.renderBoard = () => { boardRendered = true; };

      await globalThis.finalizeCloudSyncSessionUI({
        pass: 'master-pass-123',
        rememberPass: true,
        toastMessage: 'Sync succeeded!',
        closeModalId: 'modal-cloud-sync-setup'
      });

      expect(remembered).toBe('master-pass-123');
      expect(closedModal).toBe('modal-cloud-sync-setup');
      expect(toastMsg).toBe('Sync succeeded!');
      expect(uiUpdated).toBe(true);
      expect(boardRendered).toBe(true);
    });
  });

  describe('In-Flight Protection on Auth Forms', () => {
    it('prevents concurrent executions of submitLinkEmailUI', async () => {
      let callCount = 0;
      const spy = vi.spyOn(window.FirebaseSyncService, 'linkEmail').mockImplementation(async () => {
        callCount++;
        await new Promise((r) => setTimeout(r, 50));
      });

      const p1 = globalThis.submitLinkEmailUI();
      const p2 = globalThis.submitLinkEmailUI();
      await Promise.all([p1, p2]);

      expect(callCount).toBe(1);
      spy.mockRestore();
    });

    it('prevents concurrent executions of submitPasswordResetUI', async () => {
      let callCount = 0;
      const spy = vi.spyOn(window.FirebaseSyncService, 'sendPasswordReset').mockImplementation(async () => {
        callCount++;
        await new Promise((r) => setTimeout(r, 50));
      });

      const p1 = globalThis.submitPasswordResetUI();
      const p2 = globalThis.submitPasswordResetUI();
      await Promise.all([p1, p2]);

      expect(callCount).toBe(1);
      spy.mockRestore();
    });
  });

  describe('Path & ID Normalization Helpers', () => {
    it('normalizes note IDs from various formats and objects', () => {
      expect(globalThis.normalizeNoteId('notes/meeting.html')).toBe('meeting');
      expect(globalThis.normalizeNoteId('meeting.html')).toBe('meeting');
      expect(globalThis.normalizeNoteId('meeting')).toBe('meeting');
      expect(globalThis.normalizeNoteId('notes\\meeting.html')).toBe('meeting');
      expect(globalThis.normalizeNoteId({ id: 'custom-note' })).toBe('custom-note');
      expect(globalThis.normalizeNoteId({ path: 'notes/doc-42.html' })).toBe('doc-42');
      expect(globalThis.normalizeNoteId(null)).toBe('');
      expect(globalThis.normalizeNoteId('')).toBe('');
    });

    it('normalizes note paths from various formats and objects', () => {
      expect(globalThis.normalizeNotePath('notes/meeting.html')).toBe('notes/meeting.html');
      expect(globalThis.normalizeNotePath('meeting.html')).toBe('notes/meeting.html');
      expect(globalThis.normalizeNotePath('meeting')).toBe('notes/meeting.html');
      expect(globalThis.normalizeNotePath('notes\\meeting.html')).toBe('notes/meeting.html');
      expect(globalThis.normalizeNotePath({ id: 'custom-note' })).toBe('notes/custom-note.html');
      expect(globalThis.normalizeNotePath({ path: 'notes/doc-42.html' })).toBe('notes/doc-42.html');
      expect(globalThis.normalizeNotePath(null)).toBe('');
      expect(globalThis.normalizeNotePath('')).toBe('');
    });
  });

  describe('UI & Toast Helpers', () => {
    it('safeToast dispatches message safely', () => {
      let toastReceived = null;
      window.showToast = (msg, isErr) => { toastReceived = { msg, isErr }; };

      globalThis.safeToast('Operation completed', false);
      expect(toastReceived).toEqual({ msg: 'Operation completed', isErr: false });

      globalThis.safeToast('Something failed', true);
      expect(toastReceived).toEqual({ msg: 'Something failed', isErr: true });
    });

    it('setElementLoadingState manages button disabled and loading styling', () => {
      const btn = document.createElement('button');
      btn.innerHTML = '<span>Save Note</span>';

      globalThis.setElementLoadingState(btn, true, 'Saving…');
      expect(btn.disabled).toBe(true);
      expect(btn.classList.contains('loading')).toBe(true);
      expect(btn.style.opacity).toBe('0.7');
      expect(btn.textContent).toBe('Saving…');

      globalThis.setElementLoadingState(btn, false);
      expect(btn.disabled).toBe(false);
      expect(btn.classList.contains('loading')).toBe(false);
      expect(btn.style.opacity).toBe('');
      expect(btn.innerHTML).toBe('<span>Save Note</span>');
    });
  });

  describe('StorageAPI Document Entity Helpers', () => {
    it('readDocEntity reads from filesystem in filesystem mode and returns fallback', async () => {
      window.StorageAPI.setStorageEngine('filesystem');
      const spy = vi.spyOn(window.StorageAPI, '_readJSON').mockImplementation(async (path, fallback) => fallback);

      const res = await window.StorageAPI.readDocEntity('todos', 'manifest', 'todos/manifest.json', ['default']);
      expect(res).toEqual(['default']);

      spy.mockRestore();
    });

    it('readDocEntity reads from Firebase when engine is firebase and unlocked', async () => {
      window.StorageAPI.setStorageEngine('firebase');
      window.FirebaseSyncService.state = window.FirebaseSyncService.state || {};
      window.FirebaseSyncService.state.engine = 'firebase';
      window.FirebaseSyncService.state.isUnlocked = true;
      window.FirebaseSyncService.getDoc = vi.fn().mockResolvedValue({ events: [{ id: 'ev-1' }] });

      const res = await window.StorageAPI.readDocEntity('planner', 'events', 'planner.json', null);
      expect(res).toEqual({ events: [{ id: 'ev-1' }] });
      expect(window.FirebaseSyncService.getDoc).toHaveBeenCalledWith('planner', 'events');

      window.StorageAPI.setStorageEngine('filesystem');
      window.FirebaseSyncService.state.isUnlocked = false;
    });

    it('writeDocEntity writes to cloud when engine is firebase and unlocked', async () => {
      window.StorageAPI.setStorageEngine('firebase');
      window.FirebaseSyncService.state.isUnlocked = true;
      window.FirebaseSyncService.putDoc = vi.fn().mockResolvedValue(true);

      await window.StorageAPI.writeDocEntity('colleagues', 'database', 'colleagues.json', { colleagues: [] });
      expect(window.FirebaseSyncService.putDoc).toHaveBeenCalledWith('colleagues', 'database', { colleagues: [] });

      window.StorageAPI.setStorageEngine('filesystem');
      window.FirebaseSyncService.state.isUnlocked = false;
    });
  });

  describe('Passphrase Rotation Encrypted Store Helper', () => {
    it('_rotateEncryptedStoreRecords re-encrypts records and updates stores', async () => {
      const syncService = window.FirebaseSyncService;
      syncService.state = syncService.state || {};
      syncService.state.userId = 'user-123';
      syncService.state.encryptedDocs = new Map();

      const oldDerivedKey = 'old-key';
      const newKey = 'new-key';

      // Mock CryptoEngine
      globalThis.CryptoEngine = globalThis.CryptoEngine || {};
      const decryptSpy = vi.spyOn(globalThis.CryptoEngine, 'decryptData').mockResolvedValue({ title: 'Secret Doc' });
      const encryptSpy = vi.spyOn(globalThis.CryptoEngine, 'encryptData').mockResolvedValue({ iv: 'iv-2', ciphertext: 'cipher-2' });

      // Put record in state
      syncService.state.encryptedDocs.set('doc-1', { id: 'doc-1', iv: 'iv-1', ciphertext: 'cipher-1' });

      let savedRemote = null;
      await syncService._rotateEncryptedStoreRecords({
        storeName: 'docs',
        stateMapName: 'encryptedDocs',
        cacheName: 'docsCache',
        oldDerivedKey,
        newKey,
        saveRemoteFn: async (uid, id, r) => { savedRemote = { uid, id, r }; },
        isDoc: true,
        label: 'doc'
      });

      expect(decryptSpy).toHaveBeenCalled();
      expect(encryptSpy).toHaveBeenCalled();
      const updated = syncService.state.encryptedDocs.get('doc-1');
      expect(updated.iv).toBe('iv-2');
      expect(updated.ciphertext).toBe('cipher-2');

      decryptSpy.mockRestore();
      encryptSpy.mockRestore();
    });
  });

  describe('Planner Load & Stability Checks', () => {
    it('safely handles missing StorageAPI.writePlanner without throwing', async () => {
      globalThis.plannerEvents = [];
      globalThis.StorageAPI = {
        readPlanner: async () => ({ events: [] }),
        hasPlanner: async () => true
      };

      let caughtErr = null;
      try {
        if (typeof globalThis.loadPlanner === 'function') {
          await globalThis.loadPlanner();
        }
      } catch (e) {
        caughtErr = e;
      }
      expect(caughtErr).toBeNull();
    });
  });
});
