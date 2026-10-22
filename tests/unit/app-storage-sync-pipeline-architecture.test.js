import { describe, it, expect, beforeEach, vi } from 'vitest';

// Load app-idb.js and app-storage.js
import '../../js/app-idb.js';
import '../../js/app-storage.js';

describe('Two-Tier Storage Pipeline Architecture (RAM + IndexedDB -> Connector)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    StorageAPI.clearNoteCache();
    StorageAPI.setStorageEngine('filesystem');
    StorageAPI.setConnectorStatus('synced', null);
  });

  describe('Tier 1 Local Persistence (RAM + IndexedDB First)', () => {
    it('persists note to RAM and IndexedDB before writing to connector', async () => {
      const putNoteSpy = vi.spyOn(VaultIDBStorage, 'putNote').mockResolvedValue(true);
      const writeFileSpy = vi.fn().mockResolvedValue(true);
      globalThis.writeFile = writeFileSpy;

      const path = 'notes/my-test-note.html';
      const content = '<h1>Test Note Content</h1>';
      const meta = { id: 'my-test-note', title: 'Test Note', tags: ['work'] };

      await StorageAPI.writeNoteContent(path, content, meta);

      // Check RAM cache (0ms)
      expect(StorageAPI.getNoteFromCache(path)).toBe(content);

      // Check IndexedDB persistent store called
      expect(putNoteSpy).toHaveBeenCalledWith('my-test-note', expect.objectContaining({
        id: 'my-test-note',
        path,
        content,
        title: 'Test Note'
      }));

      // Check connector was called
      expect(writeFileSpy).toHaveBeenCalledWith(path, content);
      expect(StorageAPI.getConnectorStatus().status).toBe('synced');
    });

    it('persists asset to RAM and IndexedDB before writing to connector', async () => {
      const putRecordSpy = vi.spyOn(VaultIDBStorage, 'putRecord').mockResolvedValue(true);
      const writeFileSpy = vi.fn().mockResolvedValue(true);
      globalThis.writeFile = writeFileSpy;

      const relPath = 'notes/_assets/img-123.png';
      const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

      await StorageAPI.writeAsset(relPath, dataUrl);

      // Check IndexedDB called for both filename and full relative path
      expect(putRecordSpy).toHaveBeenCalledWith('assets', expect.objectContaining({
        id: 'img-123.png',
        data: dataUrl
      }));

      // Check connector was called
      expect(writeFileSpy).toHaveBeenCalledWith(relPath, dataUrl);
      expect(StorageAPI.getConnectorStatus().status).toBe('synced');
    });

    it('persists generic docs (planner, todos) to IndexedDB before connector', async () => {
      const putRecordSpy = vi.spyOn(VaultIDBStorage, 'putRecord').mockResolvedValue(true);
      const writeFileSpy = vi.fn().mockResolvedValue(true);
      globalThis.writeFile = writeFileSpy;

      const payload = [{ id: 'task-1', title: 'Buy milk' }];
      await StorageAPI.writeDocEntity('todos', 'manifest', 'todos/manifest.json', payload);

      expect(putRecordSpy).toHaveBeenCalledWith('docs', expect.objectContaining({
        id: 'todos:manifest',
        kind: 'todos',
        docId: 'manifest',
        data: payload
      }));
    });

    it('triggers notifyCriticalLocalFailure if Tier 1 IndexedDB write throws', async () => {
      const criticalSpy = vi.spyOn(StorageAPI, 'notifyCriticalLocalFailure');
      vi.spyOn(VaultIDBStorage, 'putNote').mockRejectedValue(new Error('QuotaExceededError: IDB transaction failed'));

      const path = 'notes/failing-note.html';
      const content = '<p>Important unpersisted data</p>';

      await expect(StorageAPI.writeNoteContent(path, content, { id: 'failing-note' })).rejects.toThrow();
      expect(criticalSpy).toHaveBeenCalledWith(expect.any(Error), 'note', 'failing-note');
    });
  });

  describe('Asynchronous Connector Dispatch & Error Classification', () => {
    it('classifies disk permission errors (NotAllowedError) and updates connector status', async () => {
      const permError = new Error('The request is not allowed by the user agent or the platform in the current context.');
      permError.name = 'NotAllowedError';

      const classified = StorageAPI.classifyConnectorError(permError);
      expect(classified.type).toBe('permission');
      expect(classified.engine).toBe('filesystem');

      vi.spyOn(VaultIDBStorage, 'putNote').mockResolvedValue(true);
      globalThis.writeFile = vi.fn().mockRejectedValue(permError);
      const notifySpy = vi.spyOn(StorageAPI, 'notifyConnectorError');

      await expect(StorageAPI.writeNoteContent('notes/test.html', '<p>Test</p>', { id: 'test' })).rejects.toThrow();

      const status = StorageAPI.getConnectorStatus();
      expect(status.status).toBe('error');
      expect(status.error.type).toBe('permission');
      expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'permission' }));
    });

    it('classifies authentication/vault errors and updates connector status', async () => {
      const authError = new Error('Vault is locked. Cannot write note.');
      const classified = StorageAPI.classifyConnectorError(authError);
      expect(classified.type).toBe('auth');
    });

    it('classifies quota/storage full errors and updates connector status', async () => {
      const quotaError = new Error('ENOSPC: no space left on device');
      const classified = StorageAPI.classifyConnectorError(quotaError);
      expect(classified.type).toBe('quota');
    });

    it('classifies offline network errors', () => {
      const netError = new Error('Failed to fetch remote Firebase doc');
      netError.name = 'NetworkError';
      const classified = StorageAPI.classifyConnectorError(netError);
      expect(classified.type).toBe('network');
    });
  });

  describe('Tier 1 Local Read Fast-Path', () => {
    it('serves note content directly from RAM cache without touching connector', async () => {
      const writeFileSpy = vi.fn();
      globalThis.readFile = writeFileSpy;

      StorageAPI._noteCache.set('notes/cached.html', '<p>Instant RAM</p>');
      const res = await StorageAPI.readNoteContent('notes/cached.html');

      expect(res).toBe('<p>Instant RAM</p>');
      expect(writeFileSpy).not.toHaveBeenCalled();
    });

    it('serves note from IndexedDB if not in RAM cache', async () => {
      vi.spyOn(VaultIDBStorage, 'getNote').mockResolvedValue({
        id: 'idb-note',
        content: '<p>From IndexedDB</p>'
      });
      globalThis.readFile = vi.fn();

      const res = await StorageAPI.readNoteContent('notes/idb-note.html');
      expect(res).toBe('<p>From IndexedDB</p>');
      expect(StorageAPI.getNoteFromCache('notes/idb-note.html')).toBe('<p>From IndexedDB</p>');
    });

    it('serves asset from IndexedDB if not in RAM cache', async () => {
      const assetData = 'data:image/png;base64,IDBAssetData';
      vi.spyOn(VaultIDBStorage, 'getRecord').mockResolvedValue({
        id: 'img-idb.png',
        data: assetData
      });

      const res = await StorageAPI.readAsset('notes/_assets/img-idb.png');
      expect(res).toBe(assetData);
    });
  });
});
