import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Firebase E2EE Conflict Management & Note History Archival', () => {
  let virtualFS = new Map();

  beforeAll(() => {
    globalThis.window = globalThis.window || {};
    globalThis.window.AppBridge = {
      fs: {
        hasNativeFS: () => true,
        async readFile(pathStr) {
          if (virtualFS.has(pathStr)) return virtualFS.get(pathStr);
          const err = new Error(`File not found: ${pathStr}`);
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
      'js/app-firebase-sync.js',
      'js/app-storage.js'
    ]);
  });

  beforeEach(async () => {
    virtualFS.clear();
    window.StorageAPI.clearNoteCache();
    window.StorageAPI.setStorageEngine('firebase');

    // Reset Firebase Sync Service state
    window.FirebaseSyncService.state = {
      engine: 'firebase',
      status: 'synced',
      config: null,
      vaultMeta: null,
      userId: 'test_user',
      isUnlocked: true,
      masterKey: null,
      pendingQueue: new Map(),
      syncTimer: null,
      lastSyncTimestamp: Date.now(),
      lastError: null,
      localCache: new Map(),
      conflicts: new Map()
    };

    // Initialize mock masterKey
    const { key } = await window.CryptoEngine.setupVault('conflict-test-pass');
    window.FirebaseSyncService.state.masterKey = key;
  });

  it('detectConflict returns null if no local document exists', async () => {
    const remoteNote = {
      id: 'note-100',
      title: 'Remote Only',
      contentHtml: '<p>Remote content</p>',
      updatedAt: Date.now()
    };

    const conflict = await window.FirebaseSyncService.detectConflict('note-100', remoteNote);
    expect(conflict).toBeNull();
    expect(window.FirebaseSyncService.hasConflict('note-100')).toBe(false);
  });

  it('detectConflict returns null if local and remote content are identical', async () => {
    const noteId = 'note-200';
    const noteData = {
      id: noteId,
      path: `notes/${noteId}.html`,
      title: 'Identical Note',
      contentHtml: '<p>Identical content</p>',
      updatedAt: 1000
    };

    // Save locally
    await window.FirebaseSyncService.queueSyncNote(noteData, 0);

    const remoteNote = {
      id: noteId,
      title: 'Identical Note',
      contentHtml: '<p>Identical content</p>',
      updatedAt: 2000
    };

    const conflict = await window.FirebaseSyncService.detectConflict(noteId, remoteNote);
    expect(conflict).toBeNull();
    expect(window.FirebaseSyncService.hasConflict(noteId)).toBe(false);
  });

  it('detectConflict records conflict when local has pending changes that differ from remote', async () => {
    const noteId = 'note-300';
    const localNote = {
      id: noteId,
      path: `notes/${noteId}.html`,
      title: 'Project Roadmap',
      contentHtml: '<p>Local edits made offline on Laptop</p>',
      updatedAt: 1500
    };

    // Queue local note (creates pending edit)
    await window.FirebaseSyncService.queueSyncNote(localNote, 10000); // long debounce so it stays pending
    expect(window.FirebaseSyncService.state.pendingQueue.has(noteId)).toBe(true);

    const remoteNote = {
      id: noteId,
      path: `notes/${noteId}.html`,
      title: 'Project Roadmap',
      contentHtml: '<p>Remote edits made on Phone</p>',
      updatedAt: 2000
    };

    const conflict = await window.FirebaseSyncService.detectConflict(noteId, remoteNote);
    expect(conflict).not.toBeNull();
    expect(conflict.id).toBe(noteId);
    expect(conflict.localNote.contentHtml).toContain('Laptop');
    expect(conflict.remoteNote.contentHtml).toContain('Phone');
    expect(window.FirebaseSyncService.hasConflict(noteId)).toBe(true);
    expect(window.FirebaseSyncService.getConflict(noteId)).toBe(conflict);
    expect(window.FirebaseSyncService.listConflicts().length).toBe(1);
  });

  it('resolveConflict with keep_local archives remote version in .history/ and keeps local version', async () => {
    const noteId = 'note-400';
    const notePath = `notes/${noteId}.html`;

    const localNote = {
      id: noteId,
      path: notePath,
      title: 'Budget Q3',
      contentHtml: '<p>Option A: Local budget with $50k</p>',
      updatedAt: 1200
    };

    const remoteNote = {
      id: noteId,
      path: notePath,
      title: 'Budget Q3',
      contentHtml: '<p>Option B: Remote budget with $60k</p>',
      updatedAt: 1500
    };

    await window.FirebaseSyncService.queueSyncNote(localNote, 10000);
    await window.FirebaseSyncService.detectConflict(noteId, remoteNote);
    expect(window.FirebaseSyncService.hasConflict(noteId)).toBe(true);

    // Resolve choosing Option A (keep_local)
    const res = await window.FirebaseSyncService.resolveConflict(noteId, 'keep_local');
    expect(res.resolved).toBe(true);
    expect(res.choice).toBe('keep_local');
    expect(res.archivedVersion).toBe('remote');
    expect(window.FirebaseSyncService.hasConflict(noteId)).toBe(false);

    // Verify active note is local
    const active = await window.FirebaseSyncService.getNote(noteId);
    expect(active.contentHtml).toContain('$50k');

    // Verify remote declined content was archived into Note History (.history/)
    const snapshots = await window.StorageAPI.listSnapshots(notePath);
    expect(snapshots.length).toBeGreaterThan(0);
    const declinedSnap = snapshots.find(s => s.reason === 'conflict-declined-remote');
    expect(declinedSnap).toBeDefined();

    const archivedContent = await window.StorageAPI.getSnapshotContent(notePath, declinedSnap.id);
    expect(archivedContent).toContain('$60k');
  });

  it('resolveConflict with keep_remote archives local version in .history/ and applies remote version', async () => {
    const noteId = 'note-500';
    const notePath = `notes/${noteId}.html`;

    const localNote = {
      id: noteId,
      path: notePath,
      title: 'Meeting Notes',
      contentHtml: '<p>Option A: Local discussion notes</p>',
      updatedAt: 1000
    };

    const remoteNote = {
      id: noteId,
      path: notePath,
      title: 'Meeting Notes Updated',
      contentHtml: '<p>Option B: Remote finalized conclusions</p>',
      updatedAt: 1400
    };

    await window.FirebaseSyncService.queueSyncNote(localNote, 10000);
    await window.FirebaseSyncService.detectConflict(noteId, remoteNote);
    expect(window.FirebaseSyncService.hasConflict(noteId)).toBe(true);

    // Resolve choosing Option B (keep_remote)
    const res = await window.FirebaseSyncService.resolveConflict(noteId, 'keep_remote');
    expect(res.resolved).toBe(true);
    expect(res.choice).toBe('keep_remote');
    expect(res.archivedVersion).toBe('local');
    expect(window.FirebaseSyncService.hasConflict(noteId)).toBe(false);

    // Verify active note content is now Option B (remote)
    const active = await window.StorageAPI.readNoteContent(notePath);
    expect(active).toContain('Option B: Remote finalized conclusions');

    // Verify local declined content was archived into Note History (.history/)
    const snapshots = await window.StorageAPI.listSnapshots(notePath);
    expect(snapshots.length).toBeGreaterThan(0);
    const declinedSnap = snapshots.find(s => s.reason === 'conflict-declined-local');
    expect(declinedSnap).toBeDefined();

    const archivedContent = await window.StorageAPI.getSnapshotContent(notePath, declinedSnap.id);
    expect(archivedContent).toContain('Option A: Local discussion notes');
  });

  it('resolveConflict with keep_both preserves local note and creates a duplicate conflict note', async () => {
    const noteId = 'note-600';
    const notePath = `notes/${noteId}.html`;

    const localNote = {
      id: noteId,
      path: notePath,
      title: 'Sprint Goals',
      contentHtml: '<p>Local sprint tasks</p>',
      updatedAt: 1000
    };

    const remoteNote = {
      id: noteId,
      path: notePath,
      title: 'Sprint Goals',
      contentHtml: '<p>Remote sprint tasks</p>',
      updatedAt: 1400
    };

    await window.FirebaseSyncService.queueSyncNote(localNote, 10000);
    await window.FirebaseSyncService.detectConflict(noteId, remoteNote);
    expect(window.FirebaseSyncService.hasConflict(noteId)).toBe(true);

    const res = await window.FirebaseSyncService.resolveConflict(noteId, 'keep_both');
    expect(res.resolved).toBe(true);
    expect(res.choice).toBe('keep_both');
    expect(res.copyNote).toBeDefined();
    expect(res.copyNote.title).toContain('(Conflict Copy)');

    // Verify local note is still accessible
    const localActive = await window.FirebaseSyncService.getNote(noteId);
    expect(localActive.contentHtml).toContain('Local sprint tasks');

    // Verify conflict copy note exists and has remote content
    const copyContent = await window.StorageAPI.readNoteContent(res.copyNote.path);
    expect(copyContent).toContain('Remote sprint tasks');
    expect(window.FirebaseSyncService.hasConflict(noteId)).toBe(false);
  });

  it('sanitizes malicious script and iframe tags in conflict preview modal to prevent XSS/RCE', () => {
    // Setup mock DOM elements for modal preview
    const localPrev = { innerHTML: '' };
    const remotePrev = { innerHTML: '' };
    const modalEl = { style: {} };

    const originalGetElementById = globalThis.document?.getElementById;
    globalThis.document = globalThis.document || {};
    globalThis.document.getElementById = (id) => {
      if (id === 'conflict-local-preview') return localPrev;
      if (id === 'conflict-remote-preview') return remotePrev;
      if (id === 'modal-sync-conflict') return modalEl;
      return null;
    };

    const maliciousConflict = {
      id: 'xss-note',
      localNote: { contentHtml: '<p>Legitimate local</p>' },
      remoteNote: { contentHtml: '<script>alert("hacked")</script><iframe src="evil.com"></iframe><p>Remote payload</p>' }
    };

    if (window.ConflictResolverController) {
      window.ConflictResolverController.openModal(maliciousConflict);
      expect(remotePrev.innerHTML).not.toContain('<script>');
      expect(remotePrev.innerHTML).not.toContain('<iframe');
      expect(remotePrev.innerHTML).toContain('Remote payload');
    }

    if (originalGetElementById) {
      globalThis.document.getElementById = originalGetElementById;
    }
  });
});

