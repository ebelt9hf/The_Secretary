import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('FirebaseSyncService Engine (js/app-firebase-sync.js)', () => {
  beforeAll(() => {
    loadScriptsIntoGlobal(['js/firebase-config.js', 'js/app-crypto.js', 'js/app-firebase-sync.js']);
  });

  beforeEach(() => {
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
      localCache: new Map(),
      conflicts: new Map()
    };
    window.FirebaseBridge = null;
  });

  it('sets up a new vault and unlocks it with correct passphrase', async () => {
    const { vaultMeta, key } = await window.FirebaseSyncService.setupVault('my-secure-passphrase');
    expect(vaultMeta).toBeDefined();
    expect(key).toBeDefined();
    expect(window.FirebaseSyncService.state.isUnlocked).toBe(true);
    expect(window.FirebaseSyncService.state.status).toBe('synced');

    // Lock vault
    window.FirebaseSyncService.lockVault();
    expect(window.FirebaseSyncService.state.isUnlocked).toBe(false);
    expect(window.FirebaseSyncService.state.masterKey).toBeNull();

    // Unlock vault with wrong password
    const fail = await window.FirebaseSyncService.unlockVault('wrong-pass', vaultMeta);
    expect(fail).toBe(false);
    expect(window.FirebaseSyncService.state.isUnlocked).toBe(false);

    // Unlock vault with correct password
    const success = await window.FirebaseSyncService.unlockVault('my-secure-passphrase', vaultMeta);
    expect(success).toBe(true);
    expect(window.FirebaseSyncService.state.isUnlocked).toBe(true);
  });

  it('encrypts and queues notes for debounced synchronization in local cache', async () => {
    await window.FirebaseSyncService.setupVault('secret-password');

    const note = {
      id: 'note-101',
      title: 'Sprint Planning Meeting',
      contentHtml: '<p>Actions and decisions.</p>',
      tags: ['Sprint'],
      workstream: 'Engineering'
    };

    await window.FirebaseSyncService.queueSyncNote(note, 0); // 0ms debounce for instant flush
    expect(window.FirebaseSyncService.state.localCache.has('note-101')).toBe(true);

    const decrypted = await window.FirebaseSyncService.getNote('note-101');
    expect(decrypted.title).toBe('Sprint Planning Meeting');
    expect(decrypted.tags).toEqual(['Sprint']);
  });

  it('handles bidirectional migration from Filesystem to Firebase and back', async () => {
    const localNotes = [
      { id: 'n1', title: 'Note 1', html: '<p>Content 1</p>', tags: ['Work'] },
      { id: 'n2', title: 'Note 2', html: '<p>Content 2</p>', tags: ['Personal'] }
    ];

    // 1. Migrate to Firebase
    const migration = await window.FirebaseSyncService.migrateFromFilesystem(localNotes, 'master-migration-pass');
    expect(migration.notesCount).toBe(2);
    expect(window.FirebaseSyncService.state.engine).toBe('firebase');

    const allNotes = await window.FirebaseSyncService.getAllNotes();
    expect(allNotes.length).toBe(2);
    expect(allNotes.map(n => n.title)).toContain('Note 1');
    expect(allNotes.map(n => n.title)).toContain('Note 2');

    // 2. Export back to Filesystem
    const exported = await window.FirebaseSyncService.exportToFilesystem();
    expect(exported.manifest.length).toBe(2);
    expect(exported.notes.length).toBe(2);
    expect(window.FirebaseSyncService.state.engine).toBe('filesystem');
  });

  it('rotates vault passphrase across all cached encrypted notes', async () => {
    await window.FirebaseSyncService.setupVault('old-passphrase-1');
    await window.FirebaseSyncService.queueSyncNote({ id: 'docA', title: 'Doc A', contentHtml: 'AAA' }, 0);
    await window.FirebaseSyncService.queueSyncNote({ id: 'docB', title: 'Doc B', contentHtml: 'BBB' }, 0);

    const newMeta = await window.FirebaseSyncService.rotatePassphrase('old-passphrase-1', 'new-shiny-pass-2');
    expect(newMeta).toBeDefined();

    // Lock and re-unlock with new pass
    window.FirebaseSyncService.lockVault();
    const unlocked = await window.FirebaseSyncService.unlockVault('new-shiny-pass-2', newMeta);
    expect(unlocked).toBe(true);

    const docA = await window.FirebaseSyncService.getNote('docA');
    expect(docA.title).toBe('Doc A');
  });

  it('updates note metadata preserving encrypted content and handles path normalization', async () => {
    await window.FirebaseSyncService.setupVault('test-passphrase-meta');
    await window.FirebaseSyncService.queueSyncNote({
      id: 'docX',
      path: 'notes/docX.html',
      title: 'Original Title',
      contentHtml: '<h1>Important Body</h1>',
      tags: ['Tag1'],
      pinned: false
    }, 0);

    // Can retrieve via path or id
    const byId = await window.FirebaseSyncService.getNote('docX');
    const byPath = await window.FirebaseSyncService.getNote('notes/docX.html');
    expect(byId.title).toBe('Original Title');
    expect(byPath.title).toBe('Original Title');

    // Update metadata only
    await window.FirebaseSyncService.updateNoteMetadata('notes/docX.html', {
      title: 'Renamed Title',
      tags: ['Tag1', 'Tag2'],
      pinned: true
    }, 0);

    const updated = await window.FirebaseSyncService.getNote('docX');
    expect(updated.title).toBe('Renamed Title');
    expect(updated.tags).toEqual(['Tag1', 'Tag2']);
    expect(updated.pinned).toBe(true);
    // Preserves original HTML body
    expect(updated.contentHtml).toBe('<h1>Important Body</h1>');

    // Delete note
    await window.FirebaseSyncService.deleteNote('notes/docX.html', 0);
    const deletedNote = await window.FirebaseSyncService.getNote('docX');
    expect(deletedNote).toBeNull();
  });

  it('detects concurrency conflicts and resolves them with keepA/keep_local and keepB/keep_remote', async () => {
    await window.FirebaseSyncService.setupVault('sync-conflict-pass');

    const noteA = {
      id: 'docConflict',
      title: 'Local Version A',
      contentHtml: '<p>Local text</p>',
      tags: ['Work']
    };
    // Queue note with long debounce so it remains pending
    await window.FirebaseSyncService.queueSyncNote(noteA, 10000);

    const remoteNote = {
      id: 'docConflict',
      title: 'Remote Version B',
      contentHtml: '<p>Remote text from device 2</p>',
      tags: ['Work', 'Remote'],
      updatedAt: Date.now()
    };

    // 1. Detect conflict
    const conflict = await window.FirebaseSyncService.detectConflict('docConflict', remoteNote);
    expect(conflict).not.toBeNull();
    expect(conflict.id).toBe('docConflict');
    expect(window.FirebaseSyncService.hasConflict('docConflict')).toBe(true);
    expect(window.FirebaseSyncService.getConflict('docConflict')).toBeDefined();

    // 2. Resolve conflict with keepB / keep_remote
    const resB = await window.FirebaseSyncService.resolveConflict('docConflict', 'keepB');
    expect(resB.resolved).toBe(true);
    expect(window.FirebaseSyncService.hasConflict('docConflict')).toBe(false);

    // 3. Keep both creates conflict copy
    await window.FirebaseSyncService.queueSyncNote(noteA, 10000);
    await window.FirebaseSyncService.detectConflict('docConflict', remoteNote);
    expect(window.FirebaseSyncService.hasConflict('docConflict')).toBe(true);

    const resBoth = await window.FirebaseSyncService.resolveConflict('docConflict', 'keepBoth');
    expect(resBoth.resolved).toBe(true);
    expect(resBoth.copyNote).toBeDefined();
    expect(resBoth.copyNote.title).toContain('(Conflict Copy)');
    expect(window.FirebaseSyncService.hasConflict('docConflict')).toBe(false);
  });

  it('does not trigger conflict on normal remote update when local has no pending edits (fast-forward)', async () => {
    await window.FirebaseSyncService.setupVault('fast-forward-pass');

    const note = {
      id: 'docClean',
      title: 'Original Title',
      contentHtml: '<p>Original content</p>'
    };
    // Flush immediately so pendingQueue is empty
    await window.FirebaseSyncService.queueSyncNote(note, 0);
    expect(window.FirebaseSyncService.state.pendingQueue.has('docClean')).toBe(false);

    const remoteUpdate = {
      id: 'docClean',
      title: 'Updated from Phone',
      contentHtml: '<p>Remote newer content</p>',
      updatedAt: Date.now() + 50000
    };

    const conflict = await window.FirebaseSyncService.detectConflict('docClean', remoteUpdate);
    expect(conflict).toBeNull();
    expect(window.FirebaseSyncService.hasConflict('docClean')).toBe(false);
  });

  it('persists and restores vaultMeta across simulated application restart', async () => {
    const { vaultMeta } = await window.FirebaseSyncService.setupVault('restart-passphrase');
    expect(vaultMeta).toBeDefined();

    // Simulate complete application restart (wipe memory state)
    window.FirebaseSyncService.state.vaultMeta = null;
    window.FirebaseSyncService.state.masterKey = null;
    window.FirebaseSyncService.state.isUnlocked = false;

    // Load persisted vault metadata from settings / IndexedDB fallback
    const restoredMeta = await window.FirebaseSyncService.loadPersistedVaultMeta();
    expect(restoredMeta).toBeDefined();
    expect(restoredMeta.salt).toBe(vaultMeta.salt);

    // Unlocking without passing explicit vaultMeta succeeds by using restored metadata
    const unlocked = await window.FirebaseSyncService.unlockVault('restart-passphrase');
    expect(unlocked).toBe(true);
    expect(window.FirebaseSyncService.state.isUnlocked).toBe(true);
  });

  it('sanitizes note IDs against path traversal and prototype pollution', () => {
    // 1. Normal note path
    expect(window.FirebaseSyncService._normalizeId('notes/meeting_2026.html')).toBe('meeting_2026');

    // 2. Path traversal attack
    const traversal = window.FirebaseSyncService._normalizeId('../../etc/passwd.html');
    expect(traversal).not.toContain('..');
    expect(traversal).not.toContain('/');

    // 3. Prototype pollution attempt
    const protoId = window.FirebaseSyncService._normalizeId('__proto__');
    expect(protoId).not.toBe('__proto__');
    expect(protoId).toMatch(/^sanitized_note_/);

    // 4. Windows backslash path
    const winPath = window.FirebaseSyncService._normalizeId('notes\\sub\\secret.html');
    expect(winPath).not.toContain('\\');

    // 5. Firestore reserved collection prefixes and dot patterns
    const reservedId = window.FirebaseSyncService._normalizeId('__special__');
    expect(reservedId).not.toBe('__special__');
    expect(reservedId).toMatch(/^sanitized_note_/);

    const dotId = window.FirebaseSyncService._normalizeId('..');
    expect(dotId).not.toBe('..');
    expect(dotId).toMatch(/^sanitized_note_/);
  });

  it('maintains fast manifestCache without doing O(N) full document decryptions', async () => {
    await window.FirebaseSyncService.setupVault('manifest-cache-pass');

    await window.FirebaseSyncService.queueSyncNote({
      id: 'fastNote1',
      title: 'Fast Note 1',
      contentHtml: '<p>Body 1</p>',
      tags: ['A', 'B'],
      workstream: 'Core'
    }, 0);

    await window.FirebaseSyncService.queueSyncNote({
      id: 'fastNote2',
      title: 'Fast Note 2',
      contentHtml: '<p>Body 2</p>',
      tags: ['C'],
      workstream: 'Ops'
    }, 0);

    const manifest = window.FirebaseSyncService.getManifest();
    expect(manifest.length).toBe(2);
    expect(manifest.map(m => m.title)).toContain('Fast Note 1');
    expect(manifest.map(m => m.title)).toContain('Fast Note 2');

    // Delete note updates manifest cache
    await window.FirebaseSyncService.deleteNote('fastNote1', 0);
    const updatedManifest = window.FirebaseSyncService.getManifest();
    expect(updatedManifest.length).toBe(1);
    expect(updatedManifest[0].title).toBe('Fast Note 2');
  });

  it('preserves concurrent edits in pendingQueue during network flush without data loss', async () => {
    await window.FirebaseSyncService.setupVault('flush-concurrency-pass');

    // Queue note 1
    window.FirebaseSyncService.state.pendingQueue.set('note1', { id: 'note1', updatedAt: 1000 });

    // Simulate in-flight flush started, and user edits note2 during flight
    const flushPromise = window.FirebaseSyncService.flushQueue();

    // User adds new note while flush was in flight
    window.FirebaseSyncService.state.pendingQueue.set('note2', { id: 'note2', updatedAt: 2000 });

    await flushPromise;

    // note1 should be cleared, but note2 must be preserved!
    expect(window.FirebaseSyncService.state.pendingQueue.has('note1')).toBe(false);
    expect(window.FirebaseSyncService.state.pendingQueue.has('note2')).toBe(true);
    expect(window.FirebaseSyncService.state.pendingQueue.get('note2').updatedAt).toBe(2000);
  });

  it('pushes notes to Firebase Realtime Database and handles remote changes', async () => {
    const savedNotes = new Map();
    let listenerCb = null;

    window.FirebaseBridge = {
      init: () => true,
      ensureAuth: async () => ({ uid: 'user_123' }),
      saveVaultMeta: async () => true,
      getVaultMeta: async () => null,
      saveNote: async (uid, noteId, record) => {
        savedNotes.set(noteId, record);
        return true;
      },
      deleteNote: async (uid, noteId) => {
        savedNotes.set(noteId, { id: noteId, deleted: true, updatedAt: Date.now() });
        return true;
      },
      listenVault: (uid, onUpdate) => {
        listenerCb = onUpdate;
        return () => {};
      }
    };

    await window.FirebaseSyncService.setupVault('bridge-test-passphrase', { apiKey: 'test-api-key' });
    expect(window.FirebaseSyncService.state.userId).toBe('user_123');

    // Queue note and flush to cloud
    await window.FirebaseSyncService.queueSyncNote({
      id: 'cloudNote1',
      title: 'Cloud Synced Note',
      contentHtml: '<p>Secret content</p>',
      tags: ['RTDB']
    }, 0);

    expect(savedNotes.has('cloudNote1')).toBe(true);
    expect(savedNotes.get('cloudNote1').ciphertext).toBeDefined();

    // Now simulate remote update received via Realtime Database listener
    const encryptedRemote = await window.CryptoEngine.encryptData(window.FirebaseSyncService.state.masterKey, {
      id: 'remoteNote99',
      title: 'Remote Note 99',
      contentHtml: '<p>From another machine</p>',
      tags: ['Remote'],
      updatedAt: Date.now() + 5000
    });

    await listenerCb({
      remoteNote99: {
        id: 'remoteNote99',
        iv: encryptedRemote.iv,
        ciphertext: encryptedRemote.ciphertext,
        updatedAt: Date.now() + 5000
      }
    });

    const manifest = window.FirebaseSyncService.getManifest();
    expect(manifest.map(m => m.id)).toContain('remoteNote99');
    expect(manifest.find(m => m.id === 'remoteNote99').title).toBe('Remote Note 99');
  });

  it('generates, gets, and sets readable Sync Codes', () => {
    const code = window.FirebaseSyncService.generateSyncCode();
    expect(code).toMatch(/^SEC-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    window.FirebaseSyncService.setSyncCode('SEC-TEST-9999');
    expect(window.FirebaseSyncService.getSyncCode()).toBe('SEC-TEST-9999');
  });

  it('links to an existing vault using Sync Code and decrypts remote notes', async () => {
    const remoteVaultMeta = (await window.CryptoEngine.setupVault('primary-passphrase')).vaultMeta;
    const remoteKey = (await window.CryptoEngine.verifyPassphrase('primary-passphrase', remoteVaultMeta)).key;

    const encNoteA = await window.CryptoEngine.encryptData(remoteKey, {
      id: 'sharedNoteA',
      title: 'Shared Note A',
      contentHtml: '<p>Synchronized from Device 1</p>',
      tags: ['MultiDevice']
    });

    const mockCloud = {
      'SEC-PAIR-1111': {
        vaultMeta: remoteVaultMeta,
        notes: [
          { id: 'sharedNoteA', iv: encNoteA.iv, ciphertext: encNoteA.ciphertext, updatedAt: 1000 }
        ]
      }
    };

    window.FirebaseBridge = {
      init: () => true,
      ensureAuth: async () => ({ uid: 'SEC-PAIR-1111' }),
      getVaultMeta: async (code) => mockCloud[code]?.vaultMeta || null,
      getAllNotes: async (code) => mockCloud[code]?.notes || [],
      listenVault: (code, cb) => () => {}
    };

    // Attempt link with invalid sync code
    await expect(window.FirebaseSyncService.linkExistingVault('UNKNOWN-CODE', 'primary-passphrase'))
      .rejects.toThrow();

    // Attempt link with wrong password
    await expect(window.FirebaseSyncService.linkExistingVault('SEC-PAIR-1111', 'wrong-passphrase'))
      .rejects.toThrow();

    // Successful link
    const result = await window.FirebaseSyncService.linkExistingVault('SEC-PAIR-1111', 'primary-passphrase');
    expect(result.linkedCount).toBe(1);
    expect(result.syncCode).toBe('SEC-PAIR-1111');
    expect(window.FirebaseSyncService.state.isUnlocked).toBe(true);

    const manifest = window.FirebaseSyncService.getManifest();
    expect(manifest.length).toBe(1);
    expect(manifest[0].title).toBe('Shared Note A');

    const noteA = await window.FirebaseSyncService.getNote('sharedNoteA');
    expect(noteA.title).toBe('Shared Note A');
    expect(noteA.contentHtml).toBe('<p>Synchronized from Device 1</p>');
  });

  describe('Version Compatibility & Cloud Update Enforcement', () => {
    it('compares semver strings accurately across versions', () => {
      const cmp = window.FirebaseSyncService.compareSemver;
      expect(cmp('4.0.0', '3.1.0')).toBe(1);
      expect(cmp('3.1.0', '4.0.0')).toBe(-1);
      expect(cmp('4.0.0', '4.0.0')).toBe(0);
      expect(cmp('v4.0.0', '4.0.0')).toBe(0);
      expect(cmp('4.1.0', '4.0.9')).toBe(1);
      expect(cmp('4.0.1', '4.0.0')).toBe(1);
      expect(cmp('4.0.0', '4.0.1')).toBe(-1);
      expect(cmp('4.0.0-beta.1', '4.0.0')).toBe(0);
    });

    it('declines sync when client version is below minVersion', () => {
      const appInfo = {
        minVersion: '4.0.0',
        deprecatedVersion: '4.1.0',
        latestVersion: '4.2.0',
        downloadUrl: 'https://github.com/ebelt9hf/secretary'
      };

      const result = window.FirebaseSyncService.checkVersionCompatibility(appInfo, '3.9.0');
      expect(result.status).toBe('declined');
      expect(result.minVersion).toBe('4.0.0');
      expect(result.currentVersion).toBe('3.9.0');
      expect(result.downloadUrl).toBe('https://github.com/ebelt9hf/secretary');
    });

    it('warns with deprecation when client version is deprecated', () => {
      const appInfo = {
        minVersion: '3.5.0',
        deprecatedVersion: '4.0.0',
        latestVersion: '4.2.0',
        downloadUrl: 'https://github.com/ebelt9hf/secretary'
      };

      const result = window.FirebaseSyncService.checkVersionCompatibility(appInfo, '4.0.0');
      expect(result.status).toBe('deprecated');
      expect(result.deprecatedVersion).toBe('4.0.0');
      expect(result.latestVersion).toBe('4.2.0');
    });

    it('notifies update_available when a newer version exists', () => {
      const appInfo = {
        minVersion: '3.5.0',
        deprecatedVersion: '3.8.0',
        latestVersion: '4.5.0',
        downloadUrl: 'https://github.com/ebelt9hf/secretary'
      };

      const result = window.FirebaseSyncService.checkVersionCompatibility(appInfo, '4.0.0');
      expect(result.status).toBe('update_available');
      expect(result.latestVersion).toBe('4.5.0');
    });

    it('reports up_to_date when client is at or above latestVersion', () => {
      const appInfo = {
        minVersion: '3.5.0',
        deprecatedVersion: '3.8.0',
        latestVersion: '4.0.0'
      };

      const result = window.FirebaseSyncService.checkVersionCompatibility(appInfo, '4.0.0');
      expect(result.status).toBe('up_to_date');
    });

    it('blocks sync operations when client is in DECLINED state', async () => {
      window.FirebaseSyncService.applyVersionStatus({
        status: 'declined',
        currentVersion: '3.1.0',
        minVersion: '4.0.0'
      });

      expect(window.FirebaseSyncService.state.status).toBe('declined');

      // Attempt setup
      await expect(window.FirebaseSyncService.setupVault('password-1234567890'))
        .rejects.toThrow();

      // Attempt link
      await expect(window.FirebaseSyncService.linkExistingVault('SEC-TEST-0000', 'password-1234567890'))
        .rejects.toThrow();

      // Attempt unlock
      await expect(window.FirebaseSyncService.unlockVault('password-1234567890', { salt: 'abc' }))
        .rejects.toThrow();

      // Attempt queue note
      await window.FirebaseSyncService.queueSyncNote({ id: 'blockedNote', title: 'Blocked' }, 0);
      expect(window.FirebaseSyncService.state.localCache.has('blockedNote')).toBe(false);
    });
  });

  describe('Database Schema Versioning', () => {
    it('defines SCHEMA_VERSION as integer >= 1', () => {
      expect(window.FirebaseSyncService.SCHEMA_VERSION).toBeGreaterThanOrEqual(1);
    });

    it('attaches schemaVersion and appVersion when setting up a vault', async () => {
      const { vaultMeta } = await window.FirebaseSyncService.setupVault('test-schema-version-pass');
      expect(vaultMeta.schemaVersion).toBe(window.FirebaseSyncService.SCHEMA_VERSION);
      expect(vaultMeta.appVersion).toBe('4.0.0');
    });

    it('attaches schemaVersion and appVersion to encrypted note records', async () => {
      await window.FirebaseSyncService.setupVault('test-schema-note-pass');
      const note = {
        id: 'schemaNoteTest',
        title: 'Schema Test Note',
        contentHtml: '<p>Content</p>'
      };

      await window.FirebaseSyncService.queueSyncNote(note, 0);
      const cached = window.FirebaseSyncService.state.localCache.get('schemaNoteTest');
      expect(cached).toBeDefined();
      expect(cached.schemaVersion).toBe(window.FirebaseSyncService.SCHEMA_VERSION);
      expect(cached.appVersion).toBe('4.0.0');
    });

    it('attaches schemaVersion and appVersion to deleted note records', async () => {
      await window.FirebaseSyncService.setupVault('test-schema-delete-pass');
      await window.FirebaseSyncService.deleteNote('schemaDeletedNote', 0);

      const cached = window.FirebaseSyncService.state.localCache.get('schemaDeletedNote');
      expect(cached).toBeDefined();
      expect(cached.deleted).toBe(true);
      expect(cached.schemaVersion).toBe(window.FirebaseSyncService.SCHEMA_VERSION);
      expect(cached.appVersion).toBe('4.0.0');
    });

    it('validates schema compatibility correctly for current, legacy, and future versions', () => {
      // Legacy document without schemaVersion (assumed v1)
      expect(window.FirebaseSyncService.validateSchemaCompatibility({})).toBe(true);
      expect(window.FirebaseSyncService.validateSchemaCompatibility({ title: 'Old' })).toBe(true);

      // Current and legacy supported schemas
      expect(window.FirebaseSyncService.validateSchemaCompatibility({ schemaVersion: 1 })).toBe(true);
      expect(window.FirebaseSyncService.validateSchemaCompatibility({ schemaVersion: 2 })).toBe(true);

      // Future unsupported schema
      expect(window.FirebaseSyncService.validateSchemaCompatibility({ schemaVersion: 3 })).toBe(false);
      expect(window.FirebaseSyncService.validateSchemaCompatibility({ schemaVersion: 99 })).toBe(false);
    });

    it('declines linking an existing vault if the remote vault has a newer schema version', async () => {
      const futureMeta = {
        salt: 'abc123salt',
        canary: 'encryptedCanary',
        schemaVersion: 99,
        appVersion: '5.0.0'
      };

      window.FirebaseBridge = {
        init: () => true,
        ensureAuth: async () => ({ uid: 'SEC-FUTR-9999' }),
        getVaultMeta: async () => futureMeta,
        getAllNotes: async () => []
      };

      await expect(
        window.FirebaseSyncService.linkExistingVault('SEC-FUTR-9999', 'correct-passphrase-123')
      ).rejects.toThrow(/schema/i);
    });
  });

  describe('Default Cryptographic Passphrase & Entropy Evaluation', () => {
    it('generates a strong, memorable default passphrase with high entropy', () => {
      const pass1 = window.FirebaseSyncService.generateDefaultPassphrase();
      const pass2 = window.FirebaseSyncService.generateDefaultPassphrase();

      expect(typeof pass1).toBe('string');
      expect(pass1.length).toBeGreaterThanOrEqual(25);
      expect(pass1).not.toBe(pass2);

      // Verify format: word-word-word-word-word-1234
      const parts = pass1.split('-');
      expect(parts.length).toBe(6);
      expect(/^\d{4}$/.test(parts[5])).toBe(true);
    });

    it('evaluates passphrase strength into correct clarity tiers', () => {
      expect(window.FirebaseSyncService.evaluatePassphraseStrength('')).toEqual({
        score: 'empty',
        length: 0,
        textKey: 'sync.badgeTooShort'
      });

      expect(window.FirebaseSyncService.evaluatePassphraseStrength('short')).toEqual({
        score: 'too_short',
        length: 5,
        textKey: 'sync.badgeTooShort'
      });

      expect(window.FirebaseSyncService.evaluatePassphraseStrength('1234567890')).toEqual({
        score: 'acceptable',
        length: 10,
        textKey: 'sync.badgeAcceptable'
      });

      expect(window.FirebaseSyncService.evaluatePassphraseStrength('20charactersLongPassword')).toEqual({
        score: 'strong',
        length: 24,
        textKey: 'sync.badgeStrong'
      });

      const defaultPass = window.FirebaseSyncService.generateDefaultPassphrase();
      const evalUltra = window.FirebaseSyncService.evaluatePassphraseStrength(defaultPass);
      expect(evalUltra.score).toBe('ultra');
      expect(evalUltra.length).toBeGreaterThanOrEqual(35);
      expect(evalUltra.textKey).toBe('sync.badgeUltraSecure');
    });
  });

  describe('Passphrase Autofill & Device Remembering (OS keychain)', () => {
    let keychain;
    beforeEach(() => {
      keychain = { value: null };
      window.electronAPI = {
        securePassphrase: {
          isAvailable: async () => true,
          save: async (p) => { keychain.value = p; return true; },
          get: async () => keychain.value,
          clear: async () => { keychain.value = null; return true; }
        }
      };
      window.settings = window.settings || {};
      window.settings.rememberPassphrase = false;
    });

    it('saves, retrieves, checks, and clears the saved passphrase via the keychain', async () => {
      expect(await window.FirebaseSyncService.hasSavedPassphrase()).toBe(false);
      const testPass = 'test-remembered-passphrase-2026';
      expect(await window.FirebaseSyncService.savePassphraseLocally(testPass)).toBe(true);
      expect(localStorage.getItem('secretary_saved_passphrase')).toBeNull();
      expect(await window.FirebaseSyncService.getSavedPassphrase()).toBe(testPass);
      expect(await window.FirebaseSyncService.hasSavedPassphrase()).toBe(true);
      expect(await window.FirebaseSyncService.clearSavedPassphrase()).toBe(true);
      expect(await window.FirebaseSyncService.getSavedPassphrase()).toBeNull();
      expect(await window.FirebaseSyncService.hasSavedPassphrase()).toBe(false);
    });

    it('updates saved passphrase when rotating vault passphrase', async () => {
      const oldPass = 'old-passphrase-for-rotation-123';
      const newPass = 'new-shiny-rotated-passphrase-456';
      await window.FirebaseSyncService.setupVault(oldPass);
      await window.FirebaseSyncService.savePassphraseLocally(oldPass);
      await window.FirebaseSyncService.rotatePassphrase(oldPass, newPass);
      expect(await window.FirebaseSyncService.getSavedPassphrase()).toBe(newPass);
    });

    it('clears saved passphrase when exporting back to filesystem mode', async () => {
      const pass = 'revert-test-passphrase-789';
      await window.FirebaseSyncService.setupVault(pass);
      await window.FirebaseSyncService.savePassphraseLocally(pass);
      await window.FirebaseSyncService.exportToFilesystem();
      expect(await window.FirebaseSyncService.getSavedPassphrase()).toBeNull();
    });
  });

  describe('Custom Firebase Project Configuration', () => {
    beforeEach(() => {
      localStorage.removeItem('secretary_custom_firebase_config');
      window.settings = window.settings || {};
      delete window.settings.customFirebaseConfig;
    });

    it('parses JSON strings and JS config snippets correctly', () => {
      const jsonStr = '{\n  "apiKey": "AIzaSyCustomKey123",\n  "projectId": "my-custom-project",\n  "databaseURL": "https://my-custom-project.firebaseio.com"\n}';
      const parsed1 = window.FirebaseSyncService.parseFirebaseConfigString(jsonStr);
      expect(parsed1).toBeDefined();
      expect(parsed1.apiKey).toBe('AIzaSyCustomKey123');
      expect(parsed1.projectId).toBe('my-custom-project');
      expect(parsed1.databaseURL).toBe('https://my-custom-project.firebaseio.com');

      const jsSnippet = 'const firebaseConfig = { apiKey: "AIzaSyJsSnippet", projectId: "snippet-project" };';
      const parsed2 = window.FirebaseSyncService.parseFirebaseConfigString(jsSnippet);
      expect(parsed2).toBeDefined();
      expect(parsed2.apiKey).toBe('AIzaSyJsSnippet');
      expect(parsed2.projectId).toBe('snippet-project');
    });

    it('stores, retrieves, and clears custom Firebase config', () => {
      expect(window.FirebaseSyncService.getCustomFirebaseConfig()).toBeNull();

      const customCfg = {
        apiKey: 'AIzaSyTestApiKey',
        projectId: 'test-vault-project'
      };

      const saved = window.FirebaseSyncService.setCustomFirebaseConfig(customCfg);
      expect(saved).toBe(true);

      const retrieved = window.FirebaseSyncService.getCustomFirebaseConfig();
      expect(retrieved).toBeDefined();
      expect(retrieved.apiKey).toBe('AIzaSyTestApiKey');
      expect(retrieved.projectId).toBe('test-vault-project');

      window.FirebaseSyncService.clearCustomFirebaseConfig();
      expect(window.FirebaseSyncService.getCustomFirebaseConfig()).toBeNull();
    });
  });

  describe('Plaintext Local Working Store & Ephemeral Session Purge', () => {
    it('stores plaintext in IndexedDB/RAM and flushes encrypted records over the network', async () => {
      let savedCloudRecord = null;
      window.FirebaseBridge = {
        init: () => true,
        ensureAuth: async () => ({ uid: 'user_wire_test' }),
        saveVaultMeta: async () => true,
        saveNote: async (uid, noteId, record) => {
          savedCloudRecord = record;
          return true;
        },
        deleteNote: async () => true,
        listenVault: () => () => {}
      };

      await window.FirebaseSyncService.setupVault('wire-enc-passphrase');
      await window.FirebaseSyncService.queueSyncNote({
        id: 'wire-note-1',
        title: 'Secret Plaintext Note',
        contentHtml: '<p>Plaintext local content</p>'
      }, 0);

      // 1. Local Cache is plaintext
      const local = window.FirebaseSyncService.state.localCache.get('wire-note-1');
      expect(local).toBeDefined();
      expect(local.title).toBe('Secret Plaintext Note');
      expect(local.contentHtml).toBe('<p>Plaintext local content</p>');

      // 2. Cloud payload is ciphertext
      expect(savedCloudRecord).not.toBeNull();
      expect(savedCloudRecord.ciphertext).toBeDefined();
      expect(savedCloudRecord.ciphertext).not.toContain('Secret Plaintext Note');
      expect(savedCloudRecord.ciphertext).not.toContain('Plaintext local content');
    });

    it('purges all local session data and locks vault on purgeLocalSessionAndQuit', async () => {
      await window.FirebaseSyncService.setupVault('purge-passphrase');
      await window.FirebaseSyncService.savePassphraseLocally('purge-passphrase');
      await window.FirebaseSyncService.queueSyncNote({
        id: 'ephemeral-note',
        title: 'Ephemeral Title',
        contentHtml: '<p>Ephemeral body</p>'
      }, 0);

      expect(window.FirebaseSyncService.state.localCache.size).toBeGreaterThan(0);
      expect(window.FirebaseSyncService.state.isUnlocked).toBe(true);

      // Execute session purge
      const purged = await window.FirebaseSyncService.purgeLocalSessionAndQuit();
      expect(purged).toBe(true);

      // Memory caches wiped
      expect(window.FirebaseSyncService.state.localCache.size).toBe(0);
      expect(window.FirebaseSyncService.state.isUnlocked).toBe(false);
      expect(window.FirebaseSyncService.state.masterKey).toBeNull();
      expect(await window.FirebaseSyncService.getSavedPassphrase()).toBeNull();
    });
  });
});
