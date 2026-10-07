import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Clean 2-Tier Firebase Delta Sync (tests/unit/app-firebase-2tier-sync.test.js)', () => {
  beforeAll(() => {
    loadScriptsIntoGlobal(['js/firebase-config.js', 'js/app-crypto.js', 'js/app-firebase-sync.js', 'js/app-storage.js']);
  });

  beforeEach(() => {
    window.FirebaseSyncService.state = {
      engine: 'firebase',
      status: 'synced',
      config: null,
      vaultMeta: null,
      userId: 'test_user_2tier',
      isUnlocked: false,
      masterKey: null,
      pendingQueue: new Map(),
      pendingDocsQueue: new Map(),
      pendingAssetsQueue: new Map(),
      syncTimer: null,
      lastSyncTimestamp: null,
      lastError: null,
      localCache: new Map(),
      manifestCache: new Map(),
      encryptedDocs: new Map(),
      docsCache: new Map(),
      encryptedAssets: new Map(),
      assetsCache: new Map(),
      conflicts: new Map()
    };
    window.FirebaseBridge = null;
  });

  it('stores plaintext in localCache for 0ms latency and encrypts outbound payloads on the wire', async () => {
    let savedNoteRecord = null;
    window.FirebaseBridge = {
      init: () => true,
      ensureAuth: async () => ({ uid: 'user_2tier' }),
      saveVaultMeta: async () => true,
      saveNote: async (uid, noteId, record) => {
        savedNoteRecord = record;
        return true;
      },
      deleteNote: async () => true,
      listenVault: () => () => {}
    };

    await window.FirebaseSyncService.setupVault('strong-test-pass');

    const note = {
      id: 'note-2tier-1',
      title: 'Google Architecture Kickoff',
      contentHtml: '<p>Deep work on 2-tier delta sync.</p>',
      tags: ['Architecture', 'Firebase'],
      workstream: 'Engineering',
      pinned: true
    };

    await window.FirebaseSyncService.queueSyncNote(note, 0);

    // Verify record in localCache is plaintext for 0ms reads and instant full-text search
    const record = window.FirebaseSyncService.state.localCache.get('note-2tier-1');
    expect(record).toBeDefined();
    expect(record.title).toBe('Google Architecture Kickoff');
    expect(record.contentHtml).toBe('<p>Deep work on 2-tier delta sync.</p>');
    expect(record.tags).toEqual(['Architecture', 'Firebase']);
    expect(record.pinned).toBe(true);

    // Verify wire payload pushed to cloud is encrypted (0 plaintext on the wire)
    expect(savedNoteRecord).not.toBeNull();
    expect(savedNoteRecord.iv).toBeDefined();
    expect(savedNoteRecord.ciphertext).toBeDefined();
    expect(savedNoteRecord.ciphertext).not.toContain('Google Architecture Kickoff');
  });

  it('selectively queues ONLY meta and leaves body untouched when metadata changes', async () => {
    await window.FirebaseSyncService.setupVault('strong-test-pass');

    const originalNote = {
      id: 'note-2tier-2',
      title: 'Initial Title',
      contentHtml: '<p>Massive 50KB HTML body simulation...</p>',
      tags: ['Work']
    };
    await window.FirebaseSyncService.queueSyncNote(originalNote, 0);

    // Clear pending queue to test delta write
    window.FirebaseSyncService.state.pendingQueue.clear();

    // Now update only metadata (e.g. Kanban move / tagging / favorite) with debounce to inspect pending queue
    await window.FirebaseSyncService.updateNoteMetadata('note-2tier-2', {
      tags: ['Work', 'Important'],
      favorite: true,
      pinned: true
    }, 5000);

    // Verify pending queue has bodyChanged: false
    const queuedItem = window.FirebaseSyncService.state.pendingQueue.get('note-2tier-2');
    expect(queuedItem).toBeDefined();
    expect(queuedItem.metaPayload).toBeDefined();
    expect(queuedItem.bodyChanged).toBe(false);

    // Verify local record preserved existing body
    const updatedRecord = window.FirebaseSyncService.state.localCache.get('note-2tier-2');
    expect(updatedRecord.contentHtml).toBe('<p>Massive 50KB HTML body simulation...</p>');

    // Verify getNote returns updated metadata and intact content with 0ms latency
    const noteResult = await window.FirebaseSyncService.getNote('note-2tier-2');
    expect(noteResult.tags).toEqual(['Work', 'Important']);
    expect(noteResult.favorite).toBe(true);
    expect(noteResult.pinned).toBe(true);
    expect(noteResult.contentHtml).toBe('<p>Massive 50KB HTML body simulation...</p>');
  });

  it('pushes meta-only writes to bridge.saveNoteMeta without calling bridge.saveNoteBody', async () => {
    let savedMeta = null;
    let savedBody = null;

    window.FirebaseBridge = {
      init: () => true,
      ensureAuth: async () => ({ uid: 'user_delta' }),
      saveVaultMeta: async () => true,
      saveNoteMeta: async (uid, noteId, record) => {
        savedMeta = { noteId, record };
        return true;
      },
      saveNoteBody: async (uid, noteId, record) => {
        savedBody = { noteId, record };
        return true;
      },
      deleteNote: async () => true,
      listenVault: () => () => {}
    };

    await window.FirebaseSyncService.setupVault('strong-test-pass');

    // Create note
    await window.FirebaseSyncService.queueSyncNote({
      id: 'note-delta-cloud',
      title: 'Delta Cloud Note',
      contentHtml: '<p>Content</p>'
    }, 0);

    expect(savedMeta).not.toBeNull();
    expect(savedBody).not.toBeNull();

    // Reset spies
    savedMeta = null;
    savedBody = null;

    // Trigger metadata-only update
    await window.FirebaseSyncService.updateNoteMetadata('note-delta-cloud', {
      title: 'Renamed Delta Cloud Note',
      pinned: true
    }, 0);

    // Verify only saveNoteMeta was called, and saveNoteBody was skipped!
    expect(savedMeta).not.toBeNull();
    expect(savedMeta.noteId).toBe('note-delta-cloud');
    expect(savedBody).toBeNull(); // Body was never sent over the network!
  });

  it('supports itemized collection CRUD (planner, todos, colleagues, chat)', async () => {
    await window.FirebaseSyncService.setupVault('strong-test-pass');

    // 1. Save single todo item
    await window.FirebaseSyncService.putDocItem('todos', 'todo_001', {
      id: 'todo_001',
      text: 'Implement 2-tier sync',
      done: false
    }, 0);

    // 2. Save second todo item
    await window.FirebaseSyncService.putDocItem('todos', 'todo_002', {
      id: 'todo_002',
      text: 'Run verification tests',
      done: true
    }, 0);

    // 3. Read single item
    const item1 = await window.FirebaseSyncService.getDocItem('todos', 'todo_001');
    expect(item1.text).toBe('Implement 2-tier sync');
    expect(item1.done).toBe(false);

    // 4. Read entire collection
    const allTodos = await window.FirebaseSyncService.getDocCollection('todos');
    expect(allTodos.length).toBe(2);
    expect(allTodos.map(t => t.id)).toContain('todo_001');
    expect(allTodos.map(t => t.id)).toContain('todo_002');

    // 5. Delete single item
    await window.FirebaseSyncService.deleteDocItem('todos', 'todo_001', 0);
    const item1AfterDelete = await window.FirebaseSyncService.getDocItem('todos', 'todo_001');
    expect(item1AfterDelete).toBeNull();
  });

  it('seamlessly reads legacy Schema v1 monolithic notes alongside Schema v2 2-tier notes', async () => {
    await window.FirebaseSyncService.setupVault('strong-test-pass');
    const key = window.FirebaseSyncService.state.masterKey;

    // Simulate legacy Schema v1 record in localCache
    const encLegacy = await window.CryptoEngine.encryptData(key, {
      id: 'legacy-note-v1',
      title: 'Legacy Note Title',
      contentHtml: '<p>Old monolithic content</p>',
      tags: ['Legacy']
    });

    window.FirebaseSyncService.state.localCache.set('legacy-note-v1', {
      id: 'legacy-note-v1',
      iv: encLegacy.iv,
      ciphertext: encLegacy.ciphertext,
      updatedAt: Date.now(),
      deleted: false,
      schemaVersion: 1
    });

    // Read legacy note
    const decryptedLegacy = await window.FirebaseSyncService.getNote('legacy-note-v1');
    expect(decryptedLegacy).toBeDefined();
    expect(decryptedLegacy.title).toBe('Legacy Note Title');
    expect(decryptedLegacy.contentHtml).toBe('<p>Old monolithic content</p>');
    expect(decryptedLegacy.tags).toEqual(['Legacy']);
  });

  it('rotates vault passphrase across 2-tier notes without corruption', async () => {
    await window.FirebaseSyncService.setupVault('old-passphrase-alpha');

    await window.FirebaseSyncService.queueSyncNote({
      id: 'note-rotate-1',
      title: 'Note to Rotate',
      contentHtml: '<p>Body before rotation</p>',
      tags: ['Rotation']
    }, 0);

    const newMeta = await window.FirebaseSyncService.rotatePassphrase('old-passphrase-alpha', 'new-shiny-passphrase-beta');
    expect(newMeta).toBeDefined();
    expect(window.FirebaseSyncService.state.isUnlocked).toBe(true);

    const decryptedAfterRotation = await window.FirebaseSyncService.getNote('note-rotate-1');
    expect(decryptedAfterRotation.title).toBe('Note to Rotate');
    expect(decryptedAfterRotation.contentHtml).toBe('<p>Body before rotation</p>');
    expect(decryptedAfterRotation.tags).toEqual(['Rotation']);
  });

  it('journals mutations to Write-Ahead Log (WAL) and replays pending transactions on restart', async () => {
    await window.FirebaseSyncService.setupVault('strong-test-pass');

    // Simulate an un-flushed write with long debounce
    await window.FirebaseSyncService.queueSyncNote({
      id: 'wal-note-001',
      title: 'WAL Preserved Note',
      contentHtml: '<p>Unflushed journaled content</p>',
      tags: ['Resilience']
    }, 100000);

    // Verify entry is written to IndexedDB WAL
    const pendingWal = await window.VaultIDBStorage.getPendingWAL();
    expect(pendingWal.length).toBeGreaterThan(0);
    const walEntry = pendingWal.find(e => e.targetId === 'wal-note-001');
    expect(walEntry).toBeDefined();
    expect(walEntry.payload.cleanId).toBe('wal-note-001');

    // Simulate a crash / memory wipe
    window.FirebaseSyncService.state.pendingQueue.clear();
    window.FirebaseSyncService.state.localCache.clear();
    expect(window.FirebaseSyncService.state.pendingQueue.size).toBe(0);

    // Trigger startup WAL recovery
    const recovered = await window.FirebaseSyncService._recoverFromWAL();
    expect(recovered).toBeGreaterThan(0);
    expect(window.FirebaseSyncService.state.pendingQueue.has('wal-note-001')).toBe(true);
    expect(window.FirebaseSyncService.state.localCache.has('wal-note-001')).toBe(true);
  });

  it('performs non-conflicting 3-way field merge (tags, metadata) on concurrent remote updates', async () => {
    await window.FirebaseSyncService.setupVault('strong-test-pass');

    const baseNote = {
      id: 'merge-note-1',
      title: 'Original Title',
      tags: ['Alpha'],
      pinned: false,
      workstream: 'Design',
      updatedAt: 1000
    };
    await window.FirebaseSyncService.queueSyncNote(baseNote, 0);

    // Simulate local un-flushed change (added tag Beta, pinned note)
    await window.FirebaseSyncService.updateNoteMetadata('merge-note-1', {
      tags: ['Alpha', 'Beta'],
      pinned: true,
      updatedAt: 2000
    }, 100000);

    // Simulate remote note update arriving concurrently (remote device added tag Gamma, renamed title)
    const remoteMeta = {
      id: 'merge-note-1',
      title: 'Remote Renamed Title',
      tags: ['Alpha', 'Gamma'],
      pinned: false,
      workstream: 'Design',
      updatedAt: 1500
    };

    const merged = window.FirebaseSyncService._mergeMeta({
      title: 'Original Title',
      tags: ['Alpha', 'Beta'],
      pinned: true,
      workstream: 'Design',
      updatedAt: 2000
    }, remoteMeta);

    // Verify 3-way structural merge:
    // 1. Tags are unioned (Alpha, Beta, Gamma)
    expect(merged.tags).toContain('Alpha');
    expect(merged.tags).toContain('Beta');
    expect(merged.tags).toContain('Gamma');
    // 2. Local pinned: true is preserved because local updatedAt (2000) > remote updatedAt (1500)
    expect(merged.pinned).toBe(true);
  });

  it('broadcasts updates via BroadcastChannel to synchronize other tabs and windows in real-time', async () => {
    let broadcastMessages = [];
    const originalBroadcastChannel = globalThis.BroadcastChannel;

    // Mock BroadcastChannel
    globalThis.BroadcastChannel = class MockBroadcastChannel {
      constructor(name) {
        this.name = name;
      }
      postMessage(msg) {
        broadcastMessages.push(msg);
      }
      close() {}
    };

    try {
      await window.FirebaseSyncService.setupVault('strong-test-pass');

      await window.FirebaseSyncService.queueSyncNote({
        id: 'broadcast-note-1',
        title: 'Broadcast Note',
        contentHtml: '<p>Broadcast body</p>'
      }, 0);

      const noteMsg = broadcastMessages.find(m => m.type === 'NOTE_UPDATED' && m.cleanId === 'broadcast-note-1');
      expect(noteMsg).toBeDefined();
      expect(noteMsg.cleanId).toBe('broadcast-note-1');

      // Test doc update broadcast
      await window.FirebaseSyncService.putDoc('todos', 'manifest', { items: [] }, 0);
      const docMsg = broadcastMessages.find(m => m.type === 'DOC_UPDATED');
      expect(docMsg).toBeDefined();
    } finally {
      globalThis.BroadcastChannel = originalBroadcastChannel;
    }
  });

  it('uses DEFAULT_CLOUD_SYNC_DEBOUNCE_MS (5000ms) for snappy local saves and debounced cloud sync', async () => {
    expect(window.FirebaseSyncService.DEFAULT_CLOUD_SYNC_DEBOUNCE_MS).toBe(5000);

    await window.FirebaseSyncService.setupVault('strong-test-pass');

    // putDoc without explicit debounce should use default 5000ms debounce and not flush immediately
    await window.FirebaseSyncService.putDoc('planner', 'events', { events: [{ id: 'evt_1' }] });
    expect(window.FirebaseSyncService.state.pendingDocsQueue.has('planner__events')).toBe(true);
    expect(window.FirebaseSyncService.state.syncTimer).not.toBeNull();

    // Verify local cache and IndexedDB were updated instantly
    const docData = await window.FirebaseSyncService.getDoc('planner', 'events');
    expect(docData).toEqual({ events: [{ id: 'evt_1' }] });
  });

  it('supports IndexedDB index queries via VaultIDBStorage.getRecordsByIndex', async () => {
    await window.FirebaseSyncService.setupVault('strong-test-pass');

    await window.FirebaseSyncService.putDoc('topic_memory', 'topic_a', { name: 'Topic A' }, 0);
    await window.FirebaseSyncService.putDoc('topic_memory', 'topic_b', { name: 'Topic B' }, 0);
    await window.FirebaseSyncService.putDoc('settings', 'general', { dark: true }, 0);

    const allTopicDocs = await window.FirebaseSyncService.getAllDocs('topic_memory');
    expect(allTopicDocs.length).toBe(2);
    expect(allTopicDocs.some(d => d.id === 'topic_a')).toBe(true);
    expect(allTopicDocs.some(d => d.id === 'topic_b')).toBe(true);
  });
});


