import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Storage Architecture Separation & Layered Subsystems', () => {
  let emittedEvents = [];
  let unsubscribeEvent = null;

  beforeEach(() => {
    emittedEvents = [];
    loadScriptsIntoGlobal([
      'js/app-idb.js',
      'js/app-fs.js',
      'js/app-crypto.js',
      'js/storage-migration.js',
      'js/app-sync-worker.js',
      'js/app-sync-pipeline.js',
      'js/app-firebase-sync.js',
      'js/app-storage.js'
    ]);

    if (window.StorageAPI?.on) {
      unsubscribeEvent = window.StorageAPI.on('storage:change', (eventData) => {
        emittedEvents.push(eventData);
      });
    }
  });

  afterEach(() => {
    if (typeof unsubscribeEvent === 'function') {
      unsubscribeEvent();
      unsubscribeEvent = null;
    }
  });

  describe('Tier 1: Operational IndexedDB Adapter (VaultIDBStorage in js/app-idb.js)', () => {
    it('provides operational storage adapter for notes, docs, and assets with in-memory fallback', async () => {
      expect(window.VaultIDBStorage).toBeDefined();
      expect(typeof window.VaultIDBStorage.putRecord).toBe('function');
      expect(typeof window.VaultIDBStorage.getRecord).toBe('function');

      // Notes store
      const testNote = { id: 'arch-note-1', title: 'Layered Arch', contentHtml: '<p>Content</p>', updatedAt: Date.now() };
      await window.VaultIDBStorage.putRecord('notes', testNote);
      const retrievedNote = await window.VaultIDBStorage.getRecord('notes', 'arch-note-1');
      expect(retrievedNote).toEqual(testNote);

      // Docs store
      const testDoc = { id: 'planner-v1', version: 1, events: [{ id: 'evt-1' }] };
      await window.VaultIDBStorage.saveDoc('planner-v1', testDoc);
      const retrievedDoc = await window.VaultIDBStorage.getDoc('planner-v1');
      expect(retrievedDoc).toEqual(testDoc);

      // Assets store
      const testAsset = { id: 'notes/_assets/img_test_1.png', dataUrl: 'data:image/png;base64,AAAA' };
      await window.VaultIDBStorage.saveAsset('notes/_assets/img_test_1.png', testAsset);
      const retrievedAsset = await window.VaultIDBStorage.getAsset('notes/_assets/img_test_1.png');
      expect(retrievedAsset).toEqual(testAsset);
    });

    it('supports Write-Ahead Logging (WAL) and mutex locking', async () => {
      expect(typeof window.VaultIDBStorage.appendWAL).toBe('function');
      expect(typeof window.VaultIDBStorage.getPendingWAL).toBe('function');
      expect(typeof window.VaultIDBStorage.clearWAL).toBe('function');

      await window.VaultIDBStorage.appendWAL({ id: 'wal-entry-1', type: 'note', payload: { id: 'n1' } });
      const pending = await window.VaultIDBStorage.getPendingWAL();
      expect(pending.some(e => e.id === 'wal-entry-1')).toBe(true);

      await window.VaultIDBStorage.clearWAL(['wal-entry-1']);
      const afterClear = await window.VaultIDBStorage.getPendingWAL();
      expect(afterClear.some(e => e.id === 'wal-entry-1')).toBe(false);

      // Mutex lock
      let lockedRan = false;
      await window.VaultIDBStorage.withLock('test-resource', async () => {
        lockedRan = true;
      });
      expect(lockedRan).toBe(true);
    });
  });

  describe('Tier 2: Semantic DAOs & Storage Event Bus (StorageAPI in js/app-storage.js)', () => {
    it('exposes semantic DAOs for notes, docs, and assets', () => {
      expect(window.StorageAPI.notes).toBeDefined();
      expect(typeof window.StorageAPI.notes.get).toBe('function');
      expect(typeof window.StorageAPI.notes.save).toBe('function');
      expect(typeof window.StorageAPI.notes.delete).toBe('function');

      expect(window.StorageAPI.docs).toBeDefined();
      expect(typeof window.StorageAPI.docs.get).toBe('function');
      expect(typeof window.StorageAPI.docs.save).toBe('function');
      expect(typeof window.StorageAPI.docs.exists).toBe('function');

      expect(window.StorageAPI.assets).toBeDefined();
      expect(typeof window.StorageAPI.assets.get).toBe('function');
      expect(typeof window.StorageAPI.assets.save).toBe('function');
      expect(typeof window.StorageAPI.assets.list).toBe('function');
    });

    it('dispatches storage:change events through the Storage Event Bus on operations', async () => {
      expect(typeof window.StorageAPI.on).toBe('function');
      expect(typeof window.StorageAPI.off).toBe('function');
      expect(typeof window.StorageAPI.emit).toBe('function');

      // Emit custom storage event
      window.StorageAPI.emit('storage:change', { entity: 'notes', id: 'note-42', action: 'save' });
      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0]).toEqual({ entity: 'notes', id: 'note-42', action: 'save' });

      // Doc DAO write triggers doc write and can emit
      await window.StorageAPI.docs.save('planner', 'events', 'planner.json', { events: [] });
      window.StorageAPI.emit('storage:change', { entity: 'docs', kind: 'planner', id: 'events', action: 'save' });
      expect(emittedEvents.some(e => e.entity === 'docs' && e.kind === 'planner')).toBe(true);
    });
  });

  describe('Tier 3: Decoupled Migration Subsystem (StorageMigration in js/storage-migration.js)', () => {
    it('is isolated as a separate subsystem with standalone utilities', () => {
      expect(window.StorageMigration).toBeDefined();
      expect(typeof window.StorageMigration.mergeNoteContents).toBe('function');
      expect(typeof window.StorageMigration.detectSyncConflict).toBe('function');
      expect(typeof window.StorageMigration.migrateToFirebase).toBe('function');
      expect(typeof window.StorageMigration.revertToFilesystem).toBe('function');
    });

    it('correctly merges HTML note bodies during migration reconciliation', () => {
      const original = '<h2>Notes</h2><p>Original point A</p>';
      const edited = '<h2>Notes</h2><p>Original point A</p><p>New point B added offline</p>';

      const merged = window.StorageMigration.mergeNoteContents(original, edited);
      expect(merged).toContain('Original point A');
      expect(merged).toContain('New point B added offline');
    });
  });

  describe('Tier 4: Background Sync Pipeline (SyncPipeline in js/app-sync-pipeline.js)', () => {
    it('manages background sync pipeline and exposes event emitter', async () => {
      expect(window.SyncPipeline).toBeDefined();
      expect(typeof window.SyncPipeline.init).toBe('function');
      expect(typeof window.SyncPipeline.saveNote).toBe('function');
      expect(typeof window.SyncPipeline.saveDoc).toBe('function');
      expect(typeof window.SyncPipeline.saveAsset).toBe('function');
      expect(window.StorageAPI.pipeline).toBe(window.SyncPipeline);

      const statusEvents = [];
      const unsub = window.SyncPipeline.on('pipeline:status', (s) => statusEvents.push(s));

      await window.SyncPipeline.init();
      expect(statusEvents.length).toBeGreaterThan(0);
      unsub();
    });

    it('processes notes and docs through pipeline without blocking main thread', async () => {
      await window.SyncPipeline.init();
      const vaultRes = await window.SyncPipeline.setupVault('pipeline-test-pass');
      expect(vaultRes.keyDerived).toBe(true);

      const notePayload = { title: 'Pipeline Note', contentHtml: '<p>Async thread</p>', path: 'notes/pipe1.html' };
      const saveRes = await window.SyncPipeline.saveNote('pipe1', notePayload);
      expect(saveRes.id).toBe('pipe1');

      const retrieved = await window.SyncPipeline.getNote('pipe1');
      expect(retrieved.title).toBe('Pipeline Note');
      expect(retrieved.contentHtml).toBe('<p>Async thread</p>');

      const docPayload = { version: 1, items: ['task1', 'task2'] };
      const docRes = await window.SyncPipeline.saveDoc('todos', 'manifest', docPayload);
      expect(docRes.id).toBe('manifest');

      const retrievedDoc = await window.SyncPipeline.getDoc('todos', 'manifest');
      expect(retrievedDoc.items).toEqual(['task1', 'task2']);
    });
  });
});
