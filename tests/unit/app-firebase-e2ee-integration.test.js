import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Firebase E2EE End-to-End Integration (Secretary v4.0.0 Architecture)', () => {
  let virtualFS = new Map();
  let statusEvents = [];

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
        async listFiles() {
          return [];
        }
      }
    };

    loadScriptsIntoGlobal([
      'js/app-fs.js',
      'js/app-crypto.js',
      'js/app-image-optimizer.js',
      'js/app-firebase-sync.js',
      'js/app-storage.js'
    ]);
  });

  beforeEach(() => {
    virtualFS.clear();
    statusEvents = [];
    window.StorageAPI.clearNoteCache();
    window.StorageAPI.setStorageEngine('filesystem');

    window.FirebaseSyncService.state = {
      engine: 'filesystem',
      status: 'disconnected',
      config: null,
      vaultMeta: null,
      userId: 'test_user_integration',
      isUnlocked: false,
      masterKey: null,
      pendingQueue: new Map(),
      syncTimer: null,
      lastSyncTimestamp: null,
      lastError: null,
      localCache: new Map()
    };

    window.FirebaseSyncService.onStatusChange((s) => {
      statusEvents.push(s.status);
    });
  });

  it('executes full end-to-end lifecycle: filesystem notes -> E2EE migration -> cloud sync -> rotation -> filesystem export', async () => {
    // 1. Initial State: Filesystem Engine
    expect(window.StorageAPI.getStorageEngine()).toBe('filesystem');

    // Create 3 notes on local filesystem
    const initialNotes = [
      { id: 'note-1', path: 'notes/note-1.html', title: 'Architecture Kickoff', date: '2026-10-01', tags: ['Arch'], workstream: 'Engineering' },
      { id: 'note-2', path: 'notes/note-2.html', title: 'Security Audit', date: '2026-10-02', tags: ['Security'], workstream: 'Compliance' },
      { id: 'note-3', path: 'notes/note-3.html', title: 'Release Checklist', date: '2026-10-03', tags: ['Release'], workstream: 'Ops' }
    ];
    await window.StorageAPI.writeNotesManifest(initialNotes);
    await window.StorageAPI.writeNoteContent('notes/note-1.html', '<h1>Architecture Overview</h1><p>AES-256-GCM design.</p>');
    await window.StorageAPI.writeNoteContent('notes/note-2.html', '<h2>Security Audit</h2><p>Zero-Knowledge canary verified.</p>');
    await window.StorageAPI.writeNoteContent('notes/note-3.html', '<h3>Checklist</h3><p>Production release ready.</p>');

    const fsManifestBefore = await window.StorageAPI.readNotesManifest();
    expect(fsManifestBefore.length).toBe(3);

    // 2. Image Optimization & Routing Check
    const smallWebp = 'data:image/webp;base64,' + 'A'.repeat(50 * 1024);
    const largeWebp = 'data:image/webp;base64,' + 'B'.repeat(800 * 1024);
    expect(window.ImageOptimizer.shouldRouteToBlobStorage(smallWebp)).toBe(false);
    expect(window.ImageOptimizer.shouldRouteToBlobStorage(largeWebp)).toBe(true);

    // 3. Migrate from Filesystem to Firebase with Master Passphrase
    const passphrase1 = 'super-secure-passphrase-v4';
    const migrationResult = await window.StorageAPI.migrateToFirebase(passphrase1, { projectId: 'secretary-cloud-v4' });

    expect(migrationResult.notesCount).toBe(3);
    expect(window.StorageAPI.getStorageEngine()).toBe('firebase');
    expect(window.FirebaseSyncService.state.isUnlocked).toBe(true);
    expect(window.FirebaseSyncService.state.status).toBe('synced');

    // Verify all notes are stored as fast plaintext in localCache for 0ms reads and rapid indexing
    for (const [id, record] of window.FirebaseSyncService.state.localCache.entries()) {
      expect(record.title).toBeDefined();
      expect(record.contentHtml).toBeDefined();
    }

    // 4. Transparent High-Performance Reading & Writing via StorageAPI
    const manifestFromFirebase = await window.StorageAPI.readNotesManifest();
    expect(manifestFromFirebase.length).toBe(3);
    expect(manifestFromFirebase.map(n => n.title)).toContain('Architecture Kickoff');

    const note1Content = await window.StorageAPI.readNoteContent('notes/note-1.html');
    expect(note1Content).toContain('AES-256-GCM design.');

    // Write a 4th note directly in Firebase mode
    await window.StorageAPI.writeNoteContent('notes/note-4.html', '<p>Fourth Encrypted Note</p>', {
      id: 'note-4',
      title: 'Fourth Note',
      tags: ['New']
    });

    const manifestWith4 = await window.StorageAPI.readNotesManifest();
    expect(manifestWith4.length).toBe(4);

    // 5. Update Note Metadata in Firebase mode
    await window.StorageAPI.writeNotesManifest([
      ...manifestWith4.map(n => n.id === 'note-4' ? { ...n, tags: ['New', 'Pinned'], pinned: true } : n)
    ]);
    const note4Updated = await window.FirebaseSyncService.getNote('note-4');
    expect(note4Updated.pinned).toBe(true);
    expect(note4Updated.tags).toEqual(['New', 'Pinned']);
    expect(note4Updated.contentHtml).toBe('<p>Fourth Encrypted Note</p>');

    // 6. Passphrase Rotation & Vault Re-encryption
    const passphrase2 = 'ultra-strong-rotated-passphrase-2026';
    const rotationMeta = await window.FirebaseSyncService.rotatePassphrase(passphrase1, passphrase2);
    expect(rotationMeta).toBeDefined();

    // 7. Locking and Unlocking Vault
    window.FirebaseSyncService.lockVault();
    expect(window.FirebaseSyncService.state.isUnlocked).toBe(false);
    expect(window.FirebaseSyncService.state.status).toBe('locked');

    // Reading while locked returns null/empty
    const readLocked = await window.FirebaseSyncService.getNote('note-1');
    expect(readLocked).toBeNull();

    // Unlock with old passphrase must FAIL
    const oldUnlockFail = await window.FirebaseSyncService.unlockVault(passphrase1, rotationMeta);
    expect(oldUnlockFail).toBe(false);
    expect(window.FirebaseSyncService.state.isUnlocked).toBe(false);

    // Unlock with new passphrase must SUCCEED
    const newUnlockSuccess = await window.FirebaseSyncService.unlockVault(passphrase2, rotationMeta);
    expect(newUnlockSuccess).toBe(true);
    expect(window.FirebaseSyncService.state.isUnlocked).toBe(true);

    const decryptedAfterRotation = await window.FirebaseSyncService.getNote('note-1');
    expect(decryptedAfterRotation.title).toBe('Architecture Kickoff');

    // 8. Revert to Filesystem (Export decrypted notes to local disk)
    const exportResult = await window.StorageAPI.revertToFilesystem();
    expect(exportResult.notesCount).toBe(4);
    expect(window.StorageAPI.getStorageEngine()).toBe('filesystem');

    // Verify all 4 notes and manifest are restored on disk
    expect(virtualFS.has('notes/note-1.html')).toBe(true);
    expect(virtualFS.has('notes/note-4.html')).toBe(true);
    expect(virtualFS.get('notes/note-4.html')).toBe('<p>Fourth Encrypted Note</p>');

    const finalFsManifest = await window.StorageAPI.readNotesManifest();
    expect(finalFsManifest.length).toBe(4);
  });
});
