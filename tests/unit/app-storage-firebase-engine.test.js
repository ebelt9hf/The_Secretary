import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('StorageAPI Dual-Engine with Firebase (js/app-storage.js)', () => {
  let virtualFS = new Map();

  beforeAll(() => {
    globalThis.window = globalThis.window || {};
    globalThis.window.AppBridge = {
      fs: {
        hasNativeFS: () => true,
        async readFile(pathStr) {
          if (virtualFS.has(pathStr)) return virtualFS.get(pathStr);
          const err = new Error('File not found');
          err.name = 'NotFoundError';
          throw err;
        },
        async writeFile(pathStr, content) {
          virtualFS.set(pathStr, String(content));
          return true;
        },
        async deleteFile(pathStr) {
          virtualFS.delete(pathStr);
          return true;
        },
        async fileExists(pathStr) {
          return virtualFS.has(pathStr);
        },
        async listFiles(subDir) {
          return [];
        }
      }
    };

    loadScriptsIntoGlobal([
      'js/app-fs.js',
      'js/app-crypto.js',
      'js/app-firebase-sync.js',
      'js/app-storage.js'
    ]);
  });

  beforeEach(() => {
    virtualFS.clear();
    window.StorageAPI.clearNoteCache();
    window.StorageAPI.setStorageEngine('filesystem');
    window.FirebaseSyncService.state = {
      engine: 'filesystem',
      status: 'disconnected',
      config: null,
      vaultMeta: null,
      userId: 'test_user',
      isUnlocked: false,
      masterKey: null,
      pendingQueue: new Map(),
      syncTimer: null,
      lastSyncTimestamp: null,
      lastError: null,
      localCache: new Map()
    };
  });

  it('switches between filesystem and firebase engines cleanly', () => {
    expect(window.StorageAPI.getStorageEngine()).toBe('filesystem');
    window.StorageAPI.setStorageEngine('firebase');
    expect(window.StorageAPI.getStorageEngine()).toBe('firebase');
    window.StorageAPI.setStorageEngine('filesystem');
    expect(window.StorageAPI.getStorageEngine()).toBe('filesystem');
  });

  it('transparently writes and reads note content in Firebase engine mode', async () => {
    await window.FirebaseSyncService.setupVault('password-12345');
    window.StorageAPI.setStorageEngine('firebase');

    await window.StorageAPI.writeNoteContent('notes/meeting.html', '<h1>Meeting Notes</h1>', {
      id: 'meeting',
      title: 'Meeting Notes',
      tags: ['Work']
    });

    const content = await window.StorageAPI.readNoteContent('notes/meeting.html');
    expect(content).toBe('<h1>Meeting Notes</h1>');

    const manifest = await window.StorageAPI.readNotesManifest();
    expect(manifest.length).toBe(1);
    expect(manifest[0].title).toBe('Meeting Notes');
  });

  it('migrates from local filesystem to Firebase and reverts back', async () => {
    // 1. Setup local notes on virtual filesystem
    await window.StorageAPI.writeNotesManifest([
      { id: 'proj-a', path: 'notes/proj-a.html', title: 'Project A' },
      { id: 'proj-b', path: 'notes/proj-b.html', title: 'Project B' }
    ]);
    await window.StorageAPI.writeNoteContent('notes/proj-a.html', '<p>Alpha</p>');
    await window.StorageAPI.writeNoteContent('notes/proj-b.html', '<p>Beta</p>');

    // 2. Migrate to Firebase
    const migration = await window.StorageAPI.migrateToFirebase('migration-secret-pass');
    expect(migration.notesCount).toBe(2);
    expect(window.StorageAPI.getStorageEngine()).toBe('firebase');

    // 3. Revert back to Filesystem
    const reverted = await window.StorageAPI.revertToFilesystem();
    expect(reverted.notesCount).toBe(2);
    expect(window.StorageAPI.getStorageEngine()).toBe('filesystem');

    const fsManifest = await window.StorageAPI.readNotesManifest();
    expect(fsManifest.length).toBe(2);
  });

  it('handles empty vault manifest cleanly without fallback to filesystem manifest', async () => {
    // Write note on filesystem
    await window.StorageAPI.writeNotesManifest([
      { id: 'fs-note', path: 'notes/fs-note.html', title: 'FS Note' }
    ]);

    // Setup empty vault
    await window.FirebaseSyncService.setupVault('vault-empty-pass');
    window.StorageAPI.setStorageEngine('firebase');

    const manifest = await window.StorageAPI.readNotesManifest();
    // Must be empty array, NOT fallback to ['fs-note']
    expect(manifest).toEqual([]);
  });

  it('syncs updated manifest tags and pin status to Firebase cache and deletes notes', async () => {
    await window.FirebaseSyncService.setupVault('vault-sync-meta-pass');
    window.StorageAPI.setStorageEngine('firebase');

    await window.StorageAPI.writeNoteContent('notes/idea.html', '<p>Great idea</p>', {
      id: 'idea',
      title: 'Initial Idea',
      tags: ['Innovation'],
      pinned: false
    });

    // Write updated manifest
    await window.StorageAPI.writeNotesManifest([
      {
        id: 'idea',
        path: 'notes/idea.html',
        title: 'Updated Idea Title',
        tags: ['Innovation', 'Roadmap'],
        pinned: true,
        workstream: 'Product'
      }
    ]);

    const updatedNote = await window.FirebaseSyncService.getNote('idea');
    expect(updatedNote.title).toBe('Updated Idea Title');
    expect(updatedNote.tags).toEqual(['Innovation', 'Roadmap']);
    expect(updatedNote.pinned).toBe(true);
    expect(updatedNote.workstream).toBe('Product');

    // Delete note content
    await window.StorageAPI.deleteNoteContent('notes/idea.html');
    const deletedNote = await window.FirebaseSyncService.getNote('idea');
    expect(deletedNote).toBeNull();
  });

  it('handles collection documents CRUD (planner, todos, colleagues, settings) across both engines', async () => {
    // 1. Filesystem mode
    window.StorageAPI.setStorageEngine('filesystem');
    await window.StorageAPI.writePlanner([{ id: 'evt-1', title: 'Sprint Review' }]);
    const fsEvents = await window.StorageAPI.readPlanner();
    expect(fsEvents).toEqual([{ id: 'evt-1', title: 'Sprint Review' }]);
    expect(await window.StorageAPI.hasPlanner()).toBe(true);

    await window.StorageAPI.writeTodosManifest([{ id: 'task-1', text: 'Build backend', done: true }]);
    const fsTodos = await window.StorageAPI.readTodosManifest();
    expect(fsTodos).toEqual([{ id: 'task-1', text: 'Build backend', done: true }]);
    expect(await window.StorageAPI.hasTodosManifest()).toBe(true);

    await window.StorageAPI.writeColleagues([{ id: 'col-1', name: 'Alice' }]);
    const fsColleagues = await window.StorageAPI.readColleagues();
    expect(fsColleagues).toEqual([{ id: 'col-1', name: 'Alice' }]);
    expect(await window.StorageAPI.hasColleagues()).toBe(true);

    // 2. Firebase mode
    await window.FirebaseSyncService.setupVault('vault-docs-pass');
    window.StorageAPI.setStorageEngine('firebase');

    await window.StorageAPI.writePlanner([{ id: 'evt-2', title: 'Cloud Strategy' }]);
    const cloudEvents = await window.StorageAPI.readPlanner();
    expect(cloudEvents).toEqual([{ id: 'evt-2', title: 'Cloud Strategy' }]);
    expect(await window.StorageAPI.hasPlanner()).toBe(true);

    await window.StorageAPI.writeTodosManifest([{ id: 'task-2', text: 'Validate backend', done: false }]);
    const cloudTodos = await window.StorageAPI.readTodosManifest();
    expect(cloudTodos).toEqual([{ id: 'task-2', text: 'Validate backend', done: false }]);

    await window.StorageAPI.writeColleagues([{ id: 'col-2', name: 'Bob' }]);
    const cloudColleagues = await window.StorageAPI.readColleagues();
    expect(cloudColleagues).toEqual([{ id: 'col-2', name: 'Bob' }]);

    // Low-level document CRUD on FirebaseSyncService
    await window.FirebaseSyncService.putDoc('custom_collection', 'doc_1', { hello: 'world' });
    const customDoc = await window.FirebaseSyncService.getDoc('custom_collection', 'doc_1');
    expect(customDoc).toEqual({ hello: 'world' });

    await window.FirebaseSyncService.deleteDoc('custom_collection', 'doc_1');
    const deletedCustomDoc = await window.FirebaseSyncService.getDoc('custom_collection', 'doc_1');
    expect(deletedCustomDoc).toBeNull();
  });

  it('handles asset storage (data URLs) via FirebaseSyncService', async () => {
    const testDataUrl = 'data:image/webp;base64,UklGRkAAAABXRUJQVlA4IDQAAADwAQCdASoBAAEAAQAcJaACdLoAAP7/2QAA';
    
    await window.FirebaseSyncService.setupVault('vault-asset-pass');
    await window.FirebaseSyncService.saveAsset('asset_cloud_1', testDataUrl, { type: 'image/webp' });
    const cloudAsset = await window.FirebaseSyncService.getAsset('asset_cloud_1');
    expect(cloudAsset).toBe(testDataUrl);

    await window.FirebaseSyncService.deleteAsset('asset_cloud_1');
    const deletedAsset = await window.FirebaseSyncService.getAsset('asset_cloud_1');
    expect(deletedAsset).toBeNull();
  });

  it('ensures concurrency serialization with withLock mutex', async () => {
    const executedOrder = [];
    const p1 = window.VaultIDBStorage.withLock('note-lock-test', async () => {
      await new Promise(r => setTimeout(r, 20));
      executedOrder.push('first');
      return 'val1';
    });

    const p2 = window.VaultIDBStorage.withLock('note-lock-test', async () => {
      executedOrder.push('second');
      return 'val2';
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe('val1');
    expect(r2).toBe('val2');
    expect(executedOrder).toEqual(['first', 'second']);
  });
});
