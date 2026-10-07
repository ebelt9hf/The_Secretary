import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Background Sync & Crypto Web Worker Engine (js/app-sync-worker.js)', () => {
  beforeAll(() => {
    loadScriptsIntoGlobal([
      'js/firebase-config.js',
      'js/app-crypto.js',
      'js/app-sync-worker.js'
    ]);
  });

  beforeEach(() => {
    const engine = globalThis.SyncWorkerEngine;
    engine.state = {
      status: 'disconnected',
      config: null,
      vaultMeta: null,
      userId: 'test_user_worker',
      isUnlocked: false,
      masterKey: null,
      pendingQueue: new Map(),
      pendingDocsQueue: new Map(),
      pendingAssetsQueue: new Map(),
      localCache: new Map(),
      manifestCache: new Map(),
      encryptedDocs: new Map(),
      encryptedAssets: new Map(),
      conflicts: new Map(),
      outbox: new Map(),
      inFlight: new Map(),
      noteRevisions: new Map()
    };
    globalThis.FirebaseBridge = null;
    globalThis.VaultIDBStorage = null;
  });

  const pendingResolvers = new Map();
  const eventListeners = new Set();

  beforeAll(() => {
    globalThis.postMessage = (msg) => {
      if (msg && msg.isEvent) {
        eventListeners.forEach(l => l(msg));
        return;
      }
      if (msg && msg.id && pendingResolvers.has(msg.id)) {
        const resolve = pendingResolvers.get(msg.id);
        pendingResolvers.delete(msg.id);
        resolve(msg);
      }
    };
  });

  // Helper to dispatch messages through handleWorkerMessage
  function sendWorkerMessage(action, payload = {}, revId = null, chunkType = 'full') {
    return new Promise((resolve) => {
      const reqId = 'req_' + Math.random().toString(36).substring(2, 9);
      pendingResolvers.set(reqId, resolve);

      globalThis.handleWorkerMessage({
        data: { id: reqId, action, payload, revId, chunkType }
      });
    });
  }

  it('initializes worker and connects FirebaseBridge config', async () => {
    const res = await sendWorkerMessage('INIT', { config: { apiKey: 'dummy-api-key' } });
    expect(res.success).toBe(true);
    expect(res.data.ready).toBe(true);
  });

  it('sets up a new vault and unlocks it with correct passphrase off-thread', async () => {
    const res = await sendWorkerMessage('SETUP_VAULT', { passphrase: 'worker-secure-passphrase' });
    expect(res.success).toBe(true);
    expect(res.data.vaultMeta).toBeDefined();
    expect(res.data.keyDerived).toBe(true);

    const meta = res.data.vaultMeta;

    // Lock vault
    const lockRes = await sendWorkerMessage('LOCK_VAULT');
    expect(lockRes.success).toBe(true);
    expect(globalThis.SyncWorkerEngine.state.isUnlocked).toBe(false);

    // Unlock with wrong password
    const failRes = await sendWorkerMessage('UNLOCK_VAULT', { passphrase: 'wrong-password', vaultMeta: meta });
    expect(failRes.success).toBe(true);
    expect(failRes.data.verified).toBe(false);

    // Unlock with correct password
    const unlockRes = await sendWorkerMessage('UNLOCK_VAULT', { passphrase: 'worker-secure-passphrase', vaultMeta: meta });
    expect(unlockRes.success).toBe(true);
    expect(unlockRes.data.verified).toBe(true);
    expect(globalThis.SyncWorkerEngine.state.isUnlocked).toBe(true);
  });

  it('encrypts and persists 2-tier notes in worker', async () => {
    await sendWorkerMessage('SETUP_VAULT', { passphrase: 'notes-password' });

    const note = {
      id: 'worker-note-1',
      title: 'Worker Note Title',
      contentHtml: '<p>Body text encrypted off-thread</p>',
      tags: ['worker', 'e2ee'],
      workstream: 'Operations'
    };

    const saveRes = await sendWorkerMessage('SAVE_NOTE', { id: note.id, noteData: note });
    expect(saveRes.success).toBe(true);
    expect(saveRes.superseded).toBe(false);

    // Read back and decrypt
    const getRes = await sendWorkerMessage('GET_NOTE', { id: note.id });
    expect(getRes.success).toBe(true);
    expect(getRes.data.title).toBe('Worker Note Title');
    expect(getRes.data.contentHtml).toBe('<p>Body text encrypted off-thread</p>');
    expect(getRes.data.workstream).toBe('Operations');
  });

  it('implements write coalescing and supersedes in-flight stale saves', async () => {
    await sendWorkerMessage('SETUP_VAULT', { passphrase: 'coalesce-password' });

    let cloudPushCount = 0;
    globalThis.FirebaseBridge = {
      saveNote: async () => { cloudPushCount++; },
      saveNoteMeta: async () => { cloudPushCount++; },
      saveNoteBody: async () => { cloudPushCount++; }
    };

    const noteId = 'coalesce-note-99';
    const noteRev1 = { id: noteId, title: 'Rev 1', contentHtml: '<p>v1</p>' };
    const noteRev2 = { id: noteId, title: 'Rev 2', contentHtml: '<p>v2 final</p>' };

    // Trigger Rev 1 then immediately Rev 2 before Rev 1 finishes
    const p1 = sendWorkerMessage('SAVE_NOTE', { id: noteId, noteData: noteRev1 }, 101, 'body');
    const p2 = sendWorkerMessage('SAVE_NOTE', { id: noteId, noteData: noteRev2 }, 102, 'body');

    const [res1, res2] = await Promise.all([p1, p2]);

    expect(res2.success).toBe(true);
    expect(res2.superseded).toBe(false);

    // Verify latest state is Rev 2
    const finalNote = await sendWorkerMessage('GET_NOTE', { id: noteId });
    expect(finalNote.data.contentHtml).toBe('<p>v2 final</p>');
  });

  it('encrypts and decrypts media assets with zero-copy binary transfer support', async () => {
    await sendWorkerMessage('SETUP_VAULT', { passphrase: 'asset-password' });

    const assetId = '_assets/diagram-123.png';
    const fakeImageBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const saveAssetRes = await sendWorkerMessage('SAVE_ASSET', { pathOrId: assetId, content: fakeImageBase64 });
    expect(saveAssetRes.success).toBe(true);

    const getAssetRes = await sendWorkerMessage('GET_ASSET', { pathOrId: assetId });
    expect(getAssetRes.success).toBe(true);
    expect(getAssetRes.data).toBe(fakeImageBase64);
  });

  it('rotates vault passphrase and streams progress events', async () => {
    await sendWorkerMessage('SETUP_VAULT', { passphrase: 'old-passphrase-123' });

    // Create 3 notes
    await sendWorkerMessage('SAVE_NOTE', { id: 'n1', noteData: { title: 'N1', contentHtml: 'C1' } });
    await sendWorkerMessage('SAVE_NOTE', { id: 'n2', noteData: { title: 'N2', contentHtml: 'C2' } });
    await sendWorkerMessage('SAVE_NOTE', { id: 'n3', noteData: { title: 'N3', contentHtml: 'C3' } });

    const progressEvents = [];
    const onEvent = (msg) => {
      if (msg && msg.event === 'EVENT_ROTATION_PROGRESS') {
        progressEvents.push(msg.data);
      }
    };
    eventListeners.add(onEvent);

    const rotateRes = await sendWorkerMessage('ROTATE_PASSPHRASE', {
      oldPassphrase: 'old-passphrase-123',
      newPassphrase: 'new-rotated-passphrase-456'
    });

    expect(rotateRes.success).toBe(true);
    expect(progressEvents.length).toBeGreaterThanOrEqual(3);
    expect(progressEvents[progressEvents.length - 1].percent).toBe(100);

    // Verify notes are readable with the new rotated key
    const note1 = await sendWorkerMessage('GET_NOTE', { id: 'n1' });
    expect(note1.data.title).toBe('N1');
  });

  it('deletes note by writing tombstone', async () => {
    await sendWorkerMessage('SETUP_VAULT', { passphrase: 'delete-pass' });

    await sendWorkerMessage('SAVE_NOTE', { id: 'to-delete', noteData: { title: 'Will Delete' } });
    const delRes = await sendWorkerMessage('DELETE_NOTE', { id: 'to-delete' });
    expect(delRes.success).toBe(true);
    expect(delRes.data.deleted).toBe(true);

    const checkNote = await sendWorkerMessage('GET_NOTE', { id: 'to-delete' });
    expect(checkNote.data.deleted).toBe(true);
  });

  it('saves, retrieves, lists, and deletes encrypted documents (planner, todos, whiteboards) in worker', async () => {
    await sendWorkerMessage('SETUP_VAULT', { passphrase: 'doc-secure-password' });

    const todosPayload = {
      items: [
        { id: 'todo-1', title: 'Task A', completed: false },
        { id: 'todo-2', title: 'Task B', completed: true }
      ]
    };

    // Save doc
    const saveDocRes = await sendWorkerMessage('SAVE_DOC', { kind: 'todos', id: 'main', docData: todosPayload });
    expect(saveDocRes.success).toBe(true);

    // Get doc
    const getDocRes = await sendWorkerMessage('GET_DOC', { kind: 'todos', id: 'main' });
    expect(getDocRes.success).toBe(true);
    expect(getDocRes.data.items.length).toBe(2);
    expect(getDocRes.data.items[0].title).toBe('Task A');

    // List docs
    const listDocsRes = await sendWorkerMessage('LIST_DOCS', { kind: 'todos' });
    expect(listDocsRes.success).toBe(true);
    expect(listDocsRes.data.length).toBe(1);
    expect(listDocsRes.data[0].id).toBe('main');

    // Delete doc
    const delDocRes = await sendWorkerMessage('DELETE_DOC', { kind: 'todos', id: 'main' });
    expect(delDocRes.success).toBe(true);

    const getAfterDel = await sendWorkerMessage('GET_DOC', { kind: 'todos', id: 'main' });
    expect(getAfterDel.data).toBeNull();
  });

  it('lists note manifests with decrypted metadata in worker', async () => {
    await sendWorkerMessage('SETUP_VAULT', { passphrase: 'manifest-password' });

    await sendWorkerMessage('SAVE_NOTE', { id: 'note-a', noteData: { title: 'Note A', tags: ['work'] } });
    await sendWorkerMessage('SAVE_NOTE', { id: 'note-b', noteData: { title: 'Note B', tags: ['personal'] } });

    const listRes = await sendWorkerMessage('LIST_NOTES');
    expect(listRes.success).toBe(true);
    expect(listRes.data.length).toBe(2);
    const titles = listRes.data.map(n => n.title);
    expect(titles).toContain('Note A');
    expect(titles).toContain('Note B');
  });
});
