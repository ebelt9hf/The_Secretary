import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Firebase Cloud Sync & Local Workspace Conflict Resolution', () => {
  let virtualFS = new Map();
  let mockBridge;

  beforeAll(() => {
    globalThis.window = globalThis.window || {};
    globalThis.t = (key) => key;
    globalThis.escH = (s) => String(s || '');
    globalThis.escA = (s) => String(s || '');
    globalThis.normalizeLanguageCode = (c) => c || 'en';
    globalThis.applyLocalizedUI = () => {};
    globalThis.openModal = vi.fn((id) => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'flex';
    });
    globalThis.closeModal = vi.fn((id) => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    globalThis.showToast = vi.fn();
    globalThis.toast = vi.fn();

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
        async listFiles(subDir) {
          const prefix = subDir ? `${subDir}/` : '';
          const matches = [];
          for (const k of virtualFS.keys()) {
            if (k.startsWith(prefix)) {
              const rel = k.slice(prefix.length);
              if (!rel.includes('/')) {
                matches.push({ name: rel, isFile: true, isDirectory: false });
              }
            }
          }
          return matches;
        }
      }
    };

    loadScriptsIntoGlobal([
      'js/app-utils.js',
      'js/app-fs.js',
      'js/app-crypto.js',
      'js/app-firebase-sync.js',
      'js/app-storage.js',
      'js/app-init.js'
    ]);
  });

  beforeEach(() => {
    virtualFS.clear();
    window.StorageAPI.setStorageEngine('filesystem');
    window.StorageAPI.clearNoteCache();

    window.FirebaseSyncService.state.isUnlocked = false;
    window.FirebaseSyncService.state.masterKey = null;
    window.FirebaseSyncService.state.engine = 'filesystem';
    window.FirebaseSyncService.state.localCache.clear();
    if (window.FirebaseSyncService.state.manifestCache) {
      window.FirebaseSyncService.state.manifestCache.clear();
    }
    if (window.FirebaseSyncService.state.pendingQueue) {
      window.FirebaseSyncService.state.pendingQueue.clear();
    }
    if (window.FirebaseSyncService.state.pendingDocsQueue) {
      window.FirebaseSyncService.state.pendingDocsQueue.clear();
    }
    if (window.FirebaseSyncService.state.docsCache) {
      window.FirebaseSyncService.state.docsCache.clear();
    }
    if (window.FirebaseSyncService.state.encryptedDocs) {
      window.FirebaseSyncService.state.encryptedDocs.clear();
    }

    mockBridge = {
      app: {},
      auth: {},
      currentUser: { uid: 'user_test_conflict', email: 'test@example.com' },
      init: vi.fn().mockReturnValue(true),
      ensureAuth: vi.fn().mockResolvedValue({ uid: 'user_test_conflict', email: 'test@example.com' }),
      signInWithEmail: vi.fn().mockResolvedValue({ uid: 'user_test_conflict', email: 'test@example.com' }),
      signUpWithEmail: vi.fn().mockResolvedValue({ uid: 'user_test_conflict', email: 'test@example.com' }),
      getUserId: vi.fn().mockReturnValue('user_test_conflict'),
      getUser: vi.fn().mockReturnValue({ uid: 'user_test_conflict', email: 'test@example.com' }),
      getVaultMeta: vi.fn().mockResolvedValue(null),
      saveVaultMeta: vi.fn().mockResolvedValue(true),
      getNotesManifest: vi.fn().mockResolvedValue([]),
      saveNotesManifest: vi.fn().mockResolvedValue(true),
      getEncryptedDoc: vi.fn().mockResolvedValue(null),
      saveEncryptedDoc: vi.fn().mockResolvedValue(true),
      getEncryptedAsset: vi.fn().mockResolvedValue(null),
      saveEncryptedAsset: vi.fn().mockResolvedValue(true),
      saveNote: vi.fn().mockResolvedValue(true),
      listenVault: vi.fn().mockReturnValue(() => {}),
      listenDocs: vi.fn().mockReturnValue(() => {})
    };

    globalThis.FirebaseBridge = mockBridge;
    window.FirebaseBridge = mockBridge;
    window.FirebaseSyncService.state.userId = 'user_test_conflict';

    // Set up DOM
    document.body.innerHTML = `
      <div class="modal-overlay" id="modal-cloud-sync-setup" style="display:none;">
        <input type="email" id="sync-setup-email" value="test@example.com">
        <input type="password" id="sync-setup-auth-password" value="secret123">
        <input type="password" id="sync-setup-passphrase" value="TestPassphrase-2026!">
        <button id="btn-submit-cloud-sync" data-mode="signin"></button>
      </div>

      <div class="modal-overlay" id="modal-sync-conflict-resolution" style="display:none;">
        <span id="sync-conflict-local-notes-badge"></span>
        <span id="sync-conflict-local-todos-badge"></span>
        <span id="sync-conflict-local-planner-badge"></span>
        <span id="sync-conflict-remote-notes-badge"></span>
        <span id="sync-conflict-remote-todos-badge"></span>
        <span id="sync-conflict-remote-planner-badge"></span>
        <span id="sync-conflict-summary-text"></span>

        <label class="sync-conflict-option-card selected" id="card-strategy-merge">
          <input type="radio" name="sync-conflict-strategy" id="strategy-radio-merge" value="merge" checked>
          <input type="radio" name="sync-conflict-priority" id="priority-local" value="local" checked>
          <input type="radio" name="sync-conflict-priority" id="priority-remote" value="remote">
        </label>
        <label class="sync-conflict-option-card" id="card-strategy-overwrite-cloud">
          <input type="radio" name="sync-conflict-strategy" id="strategy-radio-overwrite-cloud" value="overwrite_cloud">
        </label>
        <label class="sync-conflict-option-card" id="card-strategy-overwrite-local">
          <input type="radio" name="sync-conflict-strategy" id="strategy-radio-overwrite-local" value="overwrite_local">
        </label>

        <button id="btn-submit-sync-conflict"></button>
      </div>

      <div id="screen-connect" style="display:none;"></div>
      <div id="prefs-sync-account-email"></div>
      <div id="prefs-sync-status-text"></div>
      <div id="prefs-sync-count-text"></div>
      <select id="prefs-storage-engine-select">
        <option value="filesystem">Local</option>
        <option value="firebase">Firebase</option>
      </select>
    `;
  });

  it('detects no conflict when local workspace is empty', async () => {
    const pass = 'TestPassphrase-2026!';
    await window.FirebaseSyncService.setupVault(pass);
    await window.FirebaseSyncService.saveNote('note-1', '<h1>Remote Note</h1>', { title: 'Remote Note', updatedAt: 1000 });

    const conflict = await window.StorageAPI.detectSyncConflict();
    expect(conflict.hasConflict).toBe(false);
    expect(conflict.local.noteCount).toBe(0);
    expect(conflict.remote.noteCount).toBe(1);
  });

  it('detects conflict when both local workspace and remote vault contain data', async () => {
    const pass = 'TestPassphrase-2026!';
    await window.FirebaseSyncService.setupVault(pass);
    await window.FirebaseSyncService.saveNote('note-remote', '<h1>Remote Note</h1>', { title: 'Remote Note', updatedAt: 2000 });

    // Local notes
    virtualFS.set('notes/note-local.html', '<h1>Local Note</h1>');
    virtualFS.set('notes/manifest.json', JSON.stringify([
      { id: 'note-local', title: 'Local Note', path: 'notes/note-local.html', updatedAt: 1000 }
    ]));
    virtualFS.set('planner.json', JSON.stringify({
      version: 1,
      events: [{ id: 'evt-loc-1', title: 'Local Meeting', date: '2026-10-10' }]
    }));

    const conflict = await window.StorageAPI.detectSyncConflict();
    expect(conflict.hasConflict).toBe(true);
    expect(conflict.local.noteCount).toBe(1);
    expect(conflict.remote.noteCount).toBe(1);
    expect(conflict.local.plannerCount).toBe(1);
  });

  it('executes merge_local_priority: merges unique notes, favors local on collision, and saves remote snapshot', async () => {
    const pass = 'TestPassphrase-2026!';
    await window.FirebaseSyncService.setupVault(pass);
    
    // Remote has note-shared and note-remote-only
    await window.FirebaseSyncService.saveNote('note-shared', '<h1>Old Cloud Version</h1>', {
      title: 'Shared Note',
      updatedAt: 1000
    });
    await window.FirebaseSyncService.saveNote('note-remote-only', '<h1>Remote Only Note</h1>', {
      title: 'Remote Only',
      updatedAt: 1500
    });
    await window.FirebaseSyncService.putDoc('planner', 'events', {
      version: 1,
      events: [{ id: 'evt-cloud', title: 'Cloud Call', date: '2026-10-12' }]
    });

    // Local has note-shared (with new edits) and note-local-only
    virtualFS.set('notes/note-shared.html', '<h1>New Local Edits</h1>');
    virtualFS.set('notes/note-local-only.html', '<h1>Local Only Note</h1>');
    virtualFS.set('notes/manifest.json', JSON.stringify([
      { id: 'note-shared', title: 'Shared Note', path: 'notes/note-shared.html', updatedAt: 2000 },
      { id: 'note-local-only', title: 'Local Only', path: 'notes/note-local-only.html', updatedAt: 2000 }
    ]));
    virtualFS.set('planner.json', JSON.stringify({
      version: 1,
      events: [{ id: 'evt-local', title: 'Local Work', date: '2026-10-11' }]
    }));

    const result = await window.StorageAPI.reconcileLocalAndCloudVault(pass, 'merge_local_priority');
    expect(result.success).toBe(true);
    expect(window.StorageAPI.getStorageEngine()).toBe('firebase');

    // Both notes exist in merged state
    const mergedShared = await window.FirebaseSyncService.getNote('note-shared');
    expect(mergedShared.html).toBe('<h1>New Local Edits</h1>');

    const mergedRemoteOnly = await window.FirebaseSyncService.getNote('note-remote-only');
    expect(mergedRemoteOnly.html).toBe('<h1>Remote Only Note</h1>');

    const mergedLocalOnly = await window.FirebaseSyncService.getNote('note-local-only');
    expect(mergedLocalOnly.html).toBe('<h1>Local Only Note</h1>');

    // Planner events are merged
    const mergedPlanner = await window.FirebaseSyncService.getDoc('planner', 'events');
    expect(mergedPlanner.events.length).toBe(2);
    expect(mergedPlanner.events.some(e => e.id === 'evt-cloud')).toBe(true);
    expect(mergedPlanner.events.some(e => e.id === 'evt-local')).toBe(true);
  });

  it('executes merge_remote_priority: merges unique notes, favors remote on collision, and saves local snapshot', async () => {
    const pass = 'TestPassphrase-2026!';
    await window.FirebaseSyncService.setupVault(pass);
    
    // Remote has note-shared and note-remote-only
    await window.FirebaseSyncService.saveNote('note-shared', '<h1>Authoritative Cloud Version</h1>', {
      title: 'Shared Note',
      updatedAt: 2500
    });
    await window.FirebaseSyncService.saveNote('note-remote-only', '<h1>Remote Only Note</h1>', {
      title: 'Remote Only',
      updatedAt: 1500
    });

    // Local has note-shared and note-local-only
    virtualFS.set('notes/note-shared.html', '<h1>Local Divergent Draft</h1>');
    virtualFS.set('notes/note-local-only.html', '<h1>Local Only Note</h1>');
    virtualFS.set('notes/manifest.json', JSON.stringify([
      { id: 'note-shared', title: 'Shared Note', path: 'notes/note-shared.html', updatedAt: 2000 },
      { id: 'note-local-only', title: 'Local Only', path: 'notes/note-local-only.html', updatedAt: 2000 }
    ]));

    const result = await window.StorageAPI.reconcileLocalAndCloudVault(pass, 'merge_remote_priority');
    expect(result.success).toBe(true);
    expect(window.StorageAPI.getStorageEngine()).toBe('firebase');

    // Collision resolved in favor of remote
    const mergedShared = await window.FirebaseSyncService.getNote('note-shared');
    expect(mergedShared.html).toBe('<h1>Authoritative Cloud Version</h1>');

    // Local only is still imported
    const mergedLocalOnly = await window.FirebaseSyncService.getNote('note-local-only');
    expect(mergedLocalOnly.html).toBe('<h1>Local Only Note</h1>');
  });

  it('executes overwrite_cloud: replaces remote vault with local workspace', async () => {
    const pass = 'TestPassphrase-2026!';
    await window.FirebaseSyncService.setupVault(pass);
    await window.FirebaseSyncService.saveNote('old-cloud-note', '<h1>Old Cloud</h1>', { title: 'Old' });

    virtualFS.set('notes/new-local-note.html', '<h1>Fresh Local Note</h1>');
    virtualFS.set('notes/manifest.json', JSON.stringify([
      { id: 'new-local-note', title: 'Fresh Local Note', path: 'notes/new-local-note.html' }
    ]));

    const result = await window.StorageAPI.reconcileLocalAndCloudVault(pass, 'overwrite_cloud');
    expect(result.success).toBe(true);

    const activeNote = await window.FirebaseSyncService.getNote('new-local-note');
    expect(activeNote).toBeTruthy();
    expect(activeNote.html).toBe('<h1>Fresh Local Note</h1>');
  });

  it('executes overwrite_local: keeps remote vault and safely archives local files to backup directory', async () => {
    const pass = 'TestPassphrase-2026!';
    await window.FirebaseSyncService.setupVault(pass);
    await window.FirebaseSyncService.saveNote('cloud-master-note', '<h1>Cloud Master Note</h1>', { title: 'Cloud Master' });

    virtualFS.set('notes/scratch-local.html', '<h1>Scratch Local</h1>');
    virtualFS.set('notes/manifest.json', JSON.stringify([
      { id: 'scratch-local', title: 'Scratch Local', path: 'notes/scratch-local.html' }
    ]));

    const result = await window.StorageAPI.reconcileLocalAndCloudVault(pass, 'overwrite_local');
    expect(result.success).toBe(true);
    expect(window.StorageAPI.getStorageEngine()).toBe('firebase');

    // Local note was archived to backup folder
    expect(virtualFS.has('_migrated_to_cloud_backup/notes/scratch-local.html')).toBe(true);

    // Active cloud note is accessible
    const activeNote = await window.FirebaseSyncService.getNote('cloud-master-note');
    expect(activeNote.html).toBe('<h1>Cloud Master Note</h1>');
  });

  it('manages UI interaction: updates stat badges, supports strategy switching and modal resolution', async () => {
    const conflictMock = {
      hasConflict: true,
      local: { noteCount: 12, todoCount: 5, plannerCount: 8 },
      remote: { noteCount: 20, todoCount: 7, plannerCount: 15 },
      sharedNotesCount: 10,
      differingNotesCount: 3,
      onlyLocalNotesCount: 2,
      onlyRemoteNotesCount: 10
    };

    const modalPromise = window.showSyncConflictModalUI(conflictMock);

    expect(document.getElementById('sync-conflict-local-notes-badge').textContent).toContain('12');
    expect(document.getElementById('sync-conflict-remote-notes-badge').textContent).toContain('20');
    expect(document.getElementById('sync-conflict-summary-text').textContent).toContain('10');

    // Switch strategy to overwrite_cloud
    window.selectConflictStrategyUI('overwrite_cloud');
    expect(document.getElementById('card-strategy-overwrite-cloud').classList.contains('selected')).toBe(true);
    expect(document.getElementById('strategy-radio-overwrite-cloud').checked).toBe(true);

    // Switch strategy to overwrite_local
    window.selectConflictStrategyUI('overwrite_local');
    expect(document.getElementById('card-strategy-overwrite-local').classList.contains('selected')).toBe(true);
    expect(document.getElementById('strategy-radio-overwrite-local').checked).toBe(true);

    // Switch back to merge with local priority
    window.selectConflictStrategyUI('merge');
    document.getElementById('priority-local').checked = true;

    // Apply resolution
    window.applySyncConflictResolutionUI();
    const resolution = await modalPromise;
    expect(resolution).toEqual({ cancelled: false, strategy: 'merge_local_priority' });
  });

  it('cancels conflict resolution modal cleanly when cancel is clicked', async () => {
    const conflictMock = {
      hasConflict: true,
      local: { noteCount: 1, todoCount: 0, plannerCount: 0 },
      remote: { noteCount: 1, todoCount: 0, plannerCount: 0 }
    };

    const modalPromise = window.showSyncConflictModalUI(conflictMock);
    window.cancelSyncConflictModalUI();

    const resolution = await modalPromise;
    expect(resolution).toEqual({ cancelled: true });
  });
});
