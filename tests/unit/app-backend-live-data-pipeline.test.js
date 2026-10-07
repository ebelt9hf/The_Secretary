import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('End-to-End Backend Live Data Pipeline (tests/unit/app-backend-live-data-pipeline.test.js)', () => {
  let virtualFS = new Map();
  let cloudDb = new Map();

  beforeAll(() => {
    globalThis.window = globalThis.window || {};
    globalThis.window.AppBridge = {
      fs: {
        hasNativeFS: () => true,
        async readFile(pathStr) {
          if (virtualFS.has(pathStr)) return virtualFS.get(pathStr);
          const err = new Error('File not found: ' + pathStr);
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
          const results = [];
          for (const key of virtualFS.keys()) {
            if (key.startsWith(subDir)) {
              const rel = key.slice(subDir.length).replace(/^\//, '');
              const name = rel.split('/')[0];
              const isFile = !rel.includes('/');
              if (!results.some(r => r.name === name)) {
                results.push({ name, isFile, isDirectory: !isFile });
              }
            }
          }
          return results;
        }
      }
    };

    loadScriptsIntoGlobal([
      'js/app-utils.js',
      'js/app-fs.js',
      'js/firebase-config.js',
      'js/app-crypto.js',
      'js/app-firebase-sync.js',
      'js/app-storage.js'
    ]);
  });

  beforeEach(() => {
    virtualFS.clear();
    cloudDb.clear();
    window.StorageAPI.clearNoteCache();
    window.StorageAPI.setStorageEngine('filesystem');

    window.FirebaseBridge = {
      init: () => true,
      ensureAuth: async () => ({ uid: 'user_live_pipeline' }),
      saveVaultMeta: async (uid, meta) => {
        cloudDb.set('vaultMeta', meta);
        return true;
      },
      saveNote: async (uid, noteId, record) => {
        cloudDb.set(`notes/${noteId}`, record);
        return true;
      },
      saveNoteMeta: async (uid, noteId, record) => {
        const existing = cloudDb.get(`notes/${noteId}`) || {};
        cloudDb.set(`notes/${noteId}`, { ...existing, meta: record });
        return true;
      },
      saveNoteBody: async (uid, noteId, record) => {
        const existing = cloudDb.get(`notes/${noteId}`) || {};
        cloudDb.set(`notes/${noteId}`, { ...existing, body: record });
        return true;
      },
      deleteNote: async (uid, noteId) => {
        cloudDb.delete(`notes/${noteId}`);
        return true;
      },
      saveDoc: async (uid, col, docId, record) => {
        cloudDb.set(`docs/${col}/${docId}`, record);
        return true;
      },
      deleteDoc: async (uid, col, docId) => {
        cloudDb.delete(`docs/${col}/${docId}`);
        return true;
      },
      listenVault: () => () => {}
    };

    window.FirebaseSyncService.state = {
      engine: 'filesystem',
      status: 'disconnected',
      config: null,
      vaultMeta: null,
      userId: 'user_live_pipeline',
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
  });

  it('runs through realistic full lifecycle with real domain data across both storage engines', async () => {
    // ══════════════════════════════════════════════════════════════════════════
    // PHASE 1: Real domain data creation in Filesystem Mode
    // ══════════════════════════════════════════════════════════════════════════
    const note1 = {
      id: '2026-10-07_q3_strategy',
      title: 'Q3 Executive Strategy & OKR Review',
      date: '2026-10-07',
      tags: ['Strategy', 'Executive', 'Q3'],
      workstream: 'Leadership',
      pinned: true,
      favorite: true,
      contentHtml: `
        <h1>Q3 Executive Strategy &amp; OKR Review</h1>
        <p><strong>Attendees:</strong> Etienne Beltzung, Product Core Team</p>
        <h2>Key Objectives</h2>
        <ul>
          <li>Deliver Zero-Knowledge Dual-Engine Storage architecture with 0ms local read latency.</li>
          <li>Implement non-blocking background transactional outbox WAL.</li>
        </ul>
        <div data-formula="E = mc^2"></div>
      `.trim()
    };

    const note2 = {
      id: '2026-10-07_tech_spec',
      title: 'Secretary Cryptographic Specification v4',
      date: '2026-10-07',
      tags: ['Engineering', 'Security', 'AES-256-GCM'],
      workstream: 'Engineering',
      pinned: false,
      favorite: true,
      contentHtml: `
        <h1>Secretary Cryptographic Specification v4</h1>
        <p>This document details the network-boundary encryption guarantees.</p>
        <pre><code class="language-js">const key = await deriveMasterKey(passphrase, salt, 100000);</code></pre>
      `.trim()
    };

    // 1. Write Notes to local filesystem
    await window.StorageAPI.writeNoteContent(`notes/${note1.id}.html`, note1.contentHtml, note1);
    await window.StorageAPI.writeNoteContent(`notes/${note2.id}.html`, note2.contentHtml, note2);

    await window.StorageAPI.writeNotesManifest([
      { id: note1.id, path: `notes/${note1.id}.html`, title: note1.title, tags: note1.tags, workstream: note1.workstream, pinned: note1.pinned, favorite: note1.favorite, date: note1.date },
      { id: note2.id, path: `notes/${note2.id}.html`, title: note2.title, tags: note2.tags, workstream: note2.workstream, pinned: note2.pinned, favorite: note2.favorite, date: note2.date }
    ]);

    // 2. Write Planner events
    const plannerEvents = [
      {
        id: 'evt_plan_001',
        title: 'Sprint Planning & Backlog Grooming',
        date: '2026-10-08',
        startTime: '09:30',
        endTime: '10:30',
        type: 'sync',
        workstream: 'Engineering',
        tags: ['Sprint'],
        noteId: note1.id
      },
      {
        id: 'evt_plan_002',
        title: 'Deep Work: Cryptographic Verification',
        date: '2026-10-08',
        startTime: '14:00',
        endTime: '16:00',
        type: 'work',
        workstream: 'Engineering',
        tags: ['Security']
      }
    ];
    await window.StorageAPI.writePlanner(plannerEvents);

    // 3. Write Kanban & Eisenhower Tasks
    const todosManifest = [
      {
        id: 'task_001',
        text: 'Verify PBKDF2 100,000 iterations key derivation benchmark',
        column: 'in_progress',
        workstream: 'Engineering',
        urgency: 8,
        importance: 9,
        done: false,
        subtasks: [
          { id: 'sub_1', text: 'Benchmark on Apple Silicon', done: true },
          { id: 'sub_2', text: 'Benchmark on Windows DPAPI', done: false }
        ]
      },
      {
        id: 'task_002',
        text: 'Add 15-language key parity check to pre-commit CI',
        column: 'done',
        workstream: 'Core',
        urgency: 4,
        importance: 8,
        done: true
      }
    ];
    await window.StorageAPI.writeTodosManifest(todosManifest);

    // 4. Verify Filesystem reads
    const fsManifest = await window.StorageAPI.readNotesManifest();
    expect(fsManifest.length).toBe(2);
    expect(fsManifest[0].title).toBe('Q3 Executive Strategy & OKR Review');

    const readNote1 = await window.StorageAPI.readNoteContent(`notes/${note1.id}.html`);
    expect(readNote1).toContain('Zero-Knowledge Dual-Engine Storage');

    const fsPlanner = await window.StorageAPI.readPlanner();
    expect(fsPlanner.length).toBe(2);
    expect(fsPlanner[0].title).toBe('Sprint Planning & Backlog Grooming');

    const fsTodos = await window.StorageAPI.readTodosManifest();
    expect(fsTodos.length).toBe(2);
    expect(fsTodos[0].subtasks.length).toBe(2);

    // ══════════════════════════════════════════════════════════════════════════
    // PHASE 2: Migrate Entire Workspace to Firebase Cloud E2EE Mode
    // ══════════════════════════════════════════════════════════════════════════
    const masterPass = 'Super-Secure-Production-Passphrase-2026!';
    const migrationResult = await window.StorageAPI.migrateToFirebase(masterPass, { projectId: 'secretary-prod' });

    expect(migrationResult.notesCount).toBe(2);
    expect(window.StorageAPI.getStorageEngine()).toBe('firebase');
    expect(window.FirebaseSyncService.state.isUnlocked).toBe(true);

    // 1. Verify Local Store in IndexedDB/RAM holds CLEAN PLAINTEXT (0ms latency)
    const localNote1 = window.FirebaseSyncService.state.localCache.get(note1.id);
    expect(localNote1).toBeDefined();
    expect(localNote1.title).toBe(note1.title);
    expect(localNote1.contentHtml).toContain('Zero-Knowledge Dual-Engine Storage');
    expect(localNote1.workstream).toBe('Leadership');

    // 2. Verify Outbound Network Payloads to Firebase Cloud are 100% ENCRYPTED CIPHERTEXT (0 plaintext leakage)
    const cloudNote1Record = cloudDb.get(`notes/${note1.id}`);
    expect(cloudNote1Record).toBeDefined();
    const cipherMeta = cloudNote1Record.meta?.ciphertext || cloudNote1Record.ciphertext;
    const cipherBody = cloudNote1Record.body?.ciphertext || cloudNote1Record.ciphertext;
    expect(cipherMeta || cipherBody).toBeDefined();
    if (cipherMeta) expect(cipherMeta).not.toContain('Executive Strategy');
    if (cipherBody) expect(cipherBody).not.toContain('Zero-Knowledge');

    // 3. Fast Transparent Reads through StorageAPI in Firebase Mode
    const cloudManifest = await window.StorageAPI.readNotesManifest();
    expect(cloudManifest.length).toBe(2);
    expect(cloudManifest.map(n => n.title)).toContain('Q3 Executive Strategy & OKR Review');
    expect(cloudManifest.map(n => n.title)).toContain('Secretary Cryptographic Specification v4');

    const cloudNote1Content = await window.StorageAPI.readNoteContent(`notes/${note1.id}.html`);
    expect(cloudNote1Content).toContain('Zero-Knowledge Dual-Engine Storage');

    // ══════════════════════════════════════════════════════════════════════════
    // PHASE 3: Real-Time Mutation, Delta Sync & Concurrency Locks
    // ══════════════════════════════════════════════════════════════════════════
    // Create a 3rd note directly in Firebase mode
    const note3 = {
      id: '2026-10-07_daily_sync',
      title: 'Daily Standup Sync Notes',
      date: '2026-10-07',
      tags: ['Daily', 'Standup'],
      workstream: 'Engineering',
      contentHtml: '<p>Team velocity is optimal. Zero crypto overhead on UI.</p>'
    };

    await window.StorageAPI.writeNoteContent(`notes/${note3.id}.html`, note3.contentHtml, note3);
    const updatedCloudManifest = await window.StorageAPI.readNotesManifest();
    expect(updatedCloudManifest.length).toBe(3);

    // Update metadata (pinning and adding tags)
    await window.FirebaseSyncService.updateNoteMetadata(note3.id, {
      pinned: true,
      tags: ['Daily', 'Standup', 'HighPriority']
    }, 0);

    const updatedNote3 = await window.FirebaseSyncService.getNote(note3.id);
    expect(updatedNote3.pinned).toBe(true);
    expect(updatedNote3.tags).toContain('HighPriority');
    expect(updatedNote3.contentHtml).toContain('Team velocity is optimal');

    // ══════════════════════════════════════════════════════════════════════════
    // PHASE 4: Passphrase Rotation & Vault Re-Encryption
    // ══════════════════════════════════════════════════════════════════════════
    const newPassphrase = 'Rotated-Secure-Master-Passphrase-2027!';
    const rotated = await window.FirebaseSyncService.rotatePassphrase(masterPass, newPassphrase);
    expect(rotated).toBeDefined();
    expect(rotated.salt).toBeDefined();
    expect(rotated.canaryCiphertext).toBeDefined();
    expect(rotated.canaryIv).toBeDefined();

    // Verify all 3 notes are intact after rotation
    const note1AfterRotation = await window.FirebaseSyncService.getNote(note1.id);
    expect(note1AfterRotation.title).toBe(note1.title);
    expect(note1AfterRotation.contentHtml).toContain('Zero-Knowledge Dual-Engine Storage');

    // ══════════════════════════════════════════════════════════════════════════
    // PHASE 5: Exit Confirmation & Ephemeral Session Purge
    // ══════════════════════════════════════════════════════════════════════════
    expect(window.FirebaseSyncService.state.localCache.size).toBe(3);
    expect(window.FirebaseSyncService.state.isUnlocked).toBe(true);

    // Trigger Ephemeral Session Purge
    const purged = await window.FirebaseSyncService.purgeLocalSessionAndQuit();
    expect(purged).toBe(true);

    // Ensure RAM caches and unlock keys are completely wiped
    expect(window.FirebaseSyncService.state.localCache.size).toBe(0);
    expect(window.FirebaseSyncService.state.isUnlocked).toBe(false);
    expect(window.FirebaseSyncService.state.masterKey).toBeNull();
  });
});
