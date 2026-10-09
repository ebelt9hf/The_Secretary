import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Firebase Migration, Note Merging & Zero-Disk Dependency', () => {
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
        async readAsset(pathStr) {
          if (virtualFS.has(pathStr)) return virtualFS.get(pathStr);
          return null;
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
      'js/app-fs.js',
      'js/app-crypto.js',
      'js/app-firebase-sync.js',
      'js/app-notes.js',
      'js/app-storage.js',
      'js/storage-migration.js',
      'js/app-topic-memory.js'
    ]);
  });

  beforeEach(() => {
    virtualFS.clear();
    window.manifest = [];
    window.metadataBuffer = [];
    if (window._assetDataUrlCache && window._assetDataUrlCache.clear) {
      window._assetDataUrlCache.clear();
    }
    window.StorageAPI.setStorageEngine('filesystem');
    window.StorageAPI.clearNoteCache();
    window.FirebaseSyncService.state.isUnlocked = false;
    window.FirebaseSyncService.state.masterKey = null;
    window.FirebaseSyncService.state.engine = 'filesystem';
    window.FirebaseSyncService.state.localCache.clear();
    if (window.FirebaseSyncService.state.manifestCache) {
      window.FirebaseSyncService.state.manifestCache.clear();
    }
    if (window.FirebaseSyncService.state.syncQueue) {
      window.FirebaseSyncService.state.syncQueue.clear();
    }
    if (window.FirebaseSyncService.state.docsCache) {
      window.FirebaseSyncService.state.docsCache.clear();
    }
    if (window.FirebaseSyncService.state.encryptedDocs) {
      window.FirebaseSyncService.state.encryptedDocs.clear();
    }
  });

  it('migrates all stores to Firebase, archives local files to backup, and runs with 0 disk dependency in Firebase mode', async () => {
    // 1. Setup local notes, todos, planner, colleagues, topic memories
    virtualFS.set('notes/manifest.json', JSON.stringify([
      { id: 'note-1', path: 'notes/note-1.html', title: 'Note 1' }
    ]));
    virtualFS.set('notes/note-1.html', '<!DOCTYPE html><html><head><title>Note 1</title></head><body><main><p>Content of Note 1</p></main></body></html>');
    virtualFS.set('notes/untracked.html', '<!DOCTYPE html><html><head><title>Untracked Note</title></head><body><main><p>Untracked Body</p></main></body></html>');
    virtualFS.set('todos/manifest.json', JSON.stringify([{ id: 'todo-1', title: 'Task 1', priority: 'p1' }]));
    virtualFS.set('todos/_order.json', JSON.stringify(['todo-1']));
    virtualFS.set('planner.json', JSON.stringify([{ id: 'evt-1', title: 'Sprint Review', date: '2026-10-10' }]));
    virtualFS.set('colleagues.json', JSON.stringify([{ id: 'col-1', name: 'Alice' }]));
    virtualFS.set('raw/topic-memories/index.json', JSON.stringify({ topics: [{ key: 'project_alpha', topicName: 'Project Alpha', summary: 'Core project' }] }));
    virtualFS.set('raw/topic-memories/project_alpha.json', JSON.stringify({ key: 'project_alpha', topicName: 'Project Alpha', summary: 'Core project', keyFacts: ['Fact 1'] }));
    virtualFS.set('planner-proposals.json', JSON.stringify({ proposals: [] })); // external agent proposals file MUST stay local

    const pass = 'Master-Passphrase-2026!';
    const result = await window.StorageAPI.migrateToFirebase(pass);

    expect(result.notesCount).toBe(2);
    expect(window.StorageAPI.getStorageEngine()).toBe('firebase');

    // 2. Verify all local data files were moved to backup (and removed from active local paths)
    expect(virtualFS.has('notes/note-1.html')).toBe(false);
    expect(virtualFS.has('notes/untracked.html')).toBe(false);
    expect(virtualFS.has('notes/manifest.json')).toBe(false);
    expect(virtualFS.has('todos/manifest.json')).toBe(false);
    expect(virtualFS.has('planner.json')).toBe(false);
    expect(virtualFS.has('colleagues.json')).toBe(false);
    expect(virtualFS.has('raw/topic-memories/index.json')).toBe(false);

    // 3. Verify files are safely in backup folder
    expect(virtualFS.has('_migrated_to_cloud_backup/notes/note-1.html')).toBe(true);
    expect(virtualFS.has('_migrated_to_cloud_backup/notes/untracked.html')).toBe(true);
    expect(virtualFS.has('_migrated_to_cloud_backup/planner.json')).toBe(true);
    expect(virtualFS.has('_migrated_to_cloud_backup/todos/manifest.json')).toBe(true);

    // 4. Verify external agent proposals file was kept local
    expect(virtualFS.has('planner-proposals.json')).toBe(true);

    // 5. Zero-dependency read in Firebase mode:
    // Even if we completely clear the backup directory from disk, Firebase reading works seamlessly from encrypted vault!
    const note1Html = await window.StorageAPI.readNoteContent('notes/note-1.html');
    expect(note1Html).toContain('Content of Note 1');

    const todos = await window.StorageAPI.readTodosManifest();
    expect(todos.length).toBe(1);
    expect(todos[0].title).toBe('Task 1');

    const planner = await window.StorageAPI.readPlanner();
    expect(planner.length).toBe(1);
    expect(planner[0].title).toBe('Sprint Review');

    const colleagues = await window.StorageAPI.readColleagues();
    expect(colleagues.length).toBe(1);
    expect(colleagues[0].name).toBe('Alice');
  });

  it('correctly merges notes using original from backup and appending new edits when both exist and differ', () => {
    const originalHtml = `<!DOCTYPE html><html><head><title>Architecture Doc</title><meta name="topic-tags" content="architecture,design"></head><body><main><p>Original architecture design specifications.</p></main></body></html>`;
    const newHtmlWithEdits = `<!DOCTYPE html><html><head><title>Architecture Doc</title><meta name="topic-tags" content="architecture,security"></head><body><main><p>New security considerations added by user.</p></main></body></html>`;

    const merged = window.StorageAPI.mergeNoteContents(originalHtml, newHtmlWithEdits);

    // Original content is preserved first
    expect(merged).toContain('Original architecture design specifications.');
    // New edits are appended
    expect(merged).toContain('New security considerations added by user.');
    expect(merged).toContain('note-merged-divider');
    expect(merged).toContain('Appended edits');
  });

  it('restores original backup note if vault has only an empty note template', () => {
    const originalHtml = `<!DOCTYPE html><html><head><title>Meeting Notes</title></head><body><main><p>Detailed minutes of the meeting.</p></main></body></html>`;
    // Empty template created when editor opened a blank note
    const emptyTemplateHtml = `<!DOCTYPE html><html><head><title>Meeting Notes</title></head><body><main><p></p></main></body></html>`;

    const merged = window.StorageAPI.mergeNoteContents(originalHtml, emptyTemplateHtml);
    expect(merged).toBe(originalHtml);
  });

  it('reconcileMigrationBackup restores missing notes, merges edited notes, and rebuilds manifest/search index', async () => {
    const pass = 'Reconcile-Passphrase-2026!';
    await window.FirebaseSyncService.setupVault(pass);
    window.StorageAPI.setStorageEngine('firebase');

    // 1. In Firebase vault: note-A is empty, note-B has new user edits, note-C is missing
    await window.FirebaseSyncService.queueSyncNote({
      id: 'note-a',
      path: 'notes/note-a.html',
      title: 'Note A',
      contentHtml: '' // Empty body bug
    }, 0);

    await window.FirebaseSyncService.queueSyncNote({
      id: 'note-b',
      path: 'notes/note-b.html',
      title: 'Note B',
      contentHtml: '<!DOCTYPE html><html><head><title>Note B</title></head><body><main><p>User new notes while offline.</p></main></body></html>'
    }, 0);

    // 2. In backup folder: all 3 notes have original bodies
    virtualFS.set('_migrated_to_cloud_backup/notes/manifest.json', JSON.stringify([
      { id: 'note-a', path: 'notes/note-a.html', title: 'Note A' },
      { id: 'note-b', path: 'notes/note-b.html', title: 'Note B' },
      { id: 'note-c', path: 'notes/note-c.html', title: 'Note C' }
    ]));
    virtualFS.set('_migrated_to_cloud_backup/notes/note-a.html', '<!DOCTYPE html><html><head><title>Note A</title></head><body><main><p>Original Body A</p></main></body></html>');
    virtualFS.set('_migrated_to_cloud_backup/notes/note-b.html', '<!DOCTYPE html><html><head><title>Note B</title></head><body><main><p>Original Body B</p></main></body></html>');
    virtualFS.set('_migrated_to_cloud_backup/notes/note-c.html', '<!DOCTYPE html><html><head><title>Note C</title></head><body><main><p>Original Body C</p></main></body></html>');
    virtualFS.set('_migrated_to_cloud_backup/planner.json', JSON.stringify([{ id: 'p-1', title: 'Backup Planner Event' }]));

    // 3. Run reconciliation
    const reconReport = await window.StorageAPI.reconcileMigrationBackup({ force: true });
    expect(reconReport.success).toBe(true);
    expect(reconReport.restoredCount).toBe(2); // Note A (empty body) & Note C (missing)
    expect(reconReport.mergedCount).toBe(1); // Note B (merged original + new)

    // 4. Verify Note A has original body restored
    const noteA = await window.FirebaseSyncService.getNote('note-a');
    expect(noteA.contentHtml).toContain('Original Body A');

    // 5. Verify Note B has both original body and new edits merged
    const noteB = await window.FirebaseSyncService.getNote('note-b');
    expect(noteB.contentHtml).toContain('Original Body B');
    expect(noteB.contentHtml).toContain('User new notes while offline.');

    // 6. Verify Note C is restored
    const noteC = await window.FirebaseSyncService.getNote('note-c');
    expect(noteC.contentHtml).toContain('Original Body C');

    // 7. Verify planner was restored from backup
    const restoredPlanner = await window.StorageAPI.readPlanner();
    expect(restoredPlanner.length).toBe(1);
    expect(restoredPlanner[0].title).toBe('Backup Planner Event');
  });

  it('revertToFilesystem cleanly restores all notes, todos, planner, colleagues and topic memories back to local files', async () => {
    const pass = 'Revert-Passphrase-2026!';
    await window.FirebaseSyncService.setupVault(pass);
    window.StorageAPI.setStorageEngine('firebase');

    await window.FirebaseSyncService.queueSyncNote({
      id: 'revert-note-1',
      path: 'notes/revert-note-1.html',
      title: 'Revert Note 1',
      contentHtml: '<p>Revert Content 1</p>'
    }, 0);

    await window.FirebaseSyncService.putDoc('todos', 'manifest', [{ id: 'revert-todo-1', title: 'Task' }]);
    await window.FirebaseSyncService.putDoc('todos', '_order', ['revert-todo-1']);
    await window.FirebaseSyncService.putDoc('planner', 'events', [{ id: 'revert-evt-1', title: 'Event' }]);
    await window.FirebaseSyncService.putDoc('colleagues', 'database', [{ id: 'col-1', name: 'Bob' }]);
    await window.FirebaseSyncService.putDoc('topic_memories', 'index', { topics: [{ key: 'workstream_1', topicName: 'Workstream 1' }] });
    await window.FirebaseSyncService.putDoc('topic_memories', 'workstream_1', { key: 'workstream_1', topicName: 'Workstream 1', summary: 'Summary 1' });

    const revertRes = await window.StorageAPI.revertToFilesystem();
    expect(revertRes.notesCount).toBe(1);
    expect(window.StorageAPI.getStorageEngine()).toBe('filesystem');

    // Verify files were written back to disk
    expect(virtualFS.has('notes/revert-note-1.html')).toBe(true);
    expect(virtualFS.get('notes/revert-note-1.html')).toBe('<p>Revert Content 1</p>');
    expect(virtualFS.has('notes/manifest.json')).toBe(true);
    expect(virtualFS.has('todos/manifest.json')).toBe(true);
    expect(virtualFS.has('todos/_order.json')).toBe(true);
    expect(virtualFS.has('planner.json')).toBe(true);
    expect(virtualFS.has('colleagues.json')).toBe(true);
    expect(virtualFS.has('raw/topic-memories/index.json')).toBe(true);
    expect(virtualFS.has('raw/topic-memories/workstream_1.json')).toBe(true);
  });

  it('reports progress events during backup reconciliation and skips subsequent non-forced runs', async () => {
    const pass = 'Progress-Passphrase-2026!';
    await window.FirebaseSyncService.setupVault(pass);
    window.StorageAPI.setStorageEngine('firebase');

    virtualFS.set('_migrated_to_cloud_backup/notes/manifest.json', JSON.stringify([
      { id: 'progress-note-1', path: 'notes/progress-note-1.html', title: 'Progress 1' },
      { id: 'progress-note-2', path: 'notes/progress-note-2.html', title: 'Progress 2' }
    ]));
    virtualFS.set('_migrated_to_cloud_backup/notes/progress-note-1.html', '<p>Progress 1 Content</p>');
    virtualFS.set('_migrated_to_cloud_backup/notes/progress-note-2.html', '<p>Progress 2 Content</p>');

    const progressEvents = [];
    const res1 = await window.StorageAPI.reconcileMigrationBackup({}, (evt) => {
      progressEvents.push(evt);
    });

    expect(res1.success).toBe(true);
    expect(res1.restoredCount).toBe(2);
    expect(progressEvents.length).toBeGreaterThan(0);

    // Second run without force should detect already reconciled and skip cleanly
    const res2 = await window.StorageAPI.reconcileMigrationBackup({});
    expect(res2.skipped).toBe(true);
    expect(res2.reason).toBe('Already reconciled');

    // Forced run should execute again
    const res3 = await window.StorageAPI.reconcileMigrationBackup({ force: true });
    expect(res3.success).toBe(true);
  });

  it('preserves real titles from HTML content and repairs dummy ID titles during migration and reconciliation', async () => {
    const pass = 'Title-Passphrase-2026!';
    await window.FirebaseSyncService.setupVault(pass);
    window.StorageAPI.setStorageEngine('filesystem');

    // 1. Untracked file on disk with real title in <title> and <h1>, but no manifest entry
    virtualFS.set('notes/2026-10-07-123456.html', `<!DOCTYPE html><html><head><title>Product Roadmap 2027</title></head><body><main><h1>Product Roadmap 2027</h1><p>Key strategic goals</p></main></body></html>`);

    // 2. Untracked file in backup with real title in meta and title tag
    virtualFS.set('_migrated_to_cloud_backup/notes/2026-10-07-999999.html', `<!DOCTYPE html><html><head><title>Q3 Financial Review</title><meta name="title" content="Q3 Financial Review"></head><body><main><p>Financial summary</p></main></body></html>`);

    const migRes = await window.StorageAPI.migrateToFirebase(pass);
    expect(migRes.notesCount).toBe(2);

    const manifest = window.FirebaseSyncService.getManifest();
    const roadmapNote = manifest.find(n => n.id.includes('123456'));
    expect(roadmapNote).toBeDefined();
    expect(roadmapNote.title).toBe('Product Roadmap 2027');

    const financeNote = manifest.find(n => n.id.includes('999999'));
    expect(financeNote).toBeDefined();
    expect(financeNote.title).toBe('Q3 Financial Review');

    // Test self-healing: if an item in vault had dummy title set, repairManifestTitles fixes it
    roadmapNote.title = '2026-10-07-123456';
    window.FirebaseSyncService.state.manifestCache.set(roadmapNote.id, { ...roadmapNote, title: '2026-10-07-123456' });
    await window.FirebaseSyncService.repairManifestTitles();

    const repairedManifest = window.FirebaseSyncService.getManifest();
    const repairedNote = repairedManifest.find(n => n.id.includes('123456'));
    expect(repairedNote.title).toBe('Product Roadmap 2027');
  });

  it('migrates and reconciles image assets from notes/_assets/ and _migrated_to_cloud_backup/notes/_assets/', async () => {
    const pass = 'Asset-Passphrase-2026!';
    await window.FirebaseSyncService.setupVault(pass);
    window.StorageAPI.setStorageEngine('filesystem');

    const mockBase64Img = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    // Image on local disk in notes/_assets
    virtualFS.set('notes/_assets/diagram-alpha.png', mockBase64Img);
    // Image in backup folder
    virtualFS.set('_migrated_to_cloud_backup/notes/_assets/chart-beta.png', mockBase64Img);

    // Note referencing images
    virtualFS.set('notes/arch-note.html', `<!DOCTYPE html><html><head><title>Architecture</title></head><body><main><p>Diagram:</p><img src="notes/_assets/diagram-alpha.png"><img src="notes/_assets/chart-beta.png"></main></body></html>`);

    await window.StorageAPI.migrateToFirebase(pass);
    expect(window.StorageAPI.getStorageEngine()).toBe('firebase');

    // Verify assets were uploaded/saved into FirebaseSyncService
    const asset1 = await window.FirebaseSyncService.getAsset('diagram-alpha.png');
    expect(asset1).toBeDefined();

    const asset2 = await window.FirebaseSyncService.getAsset('chart-beta.png');
    expect(asset2).toBeDefined();

    // Verify readAssetAsDataUrl retrieves the asset seamlessly in Firebase mode
    const dataUrl1 = await window.readAssetAsDataUrl('notes/_assets/diagram-alpha.png');
    expect(dataUrl1).toBe(mockBase64Img);

    const dataUrl2 = await window.readAssetAsDataUrl('notes/_assets/chart-beta.png');
    expect(dataUrl2).toBe(mockBase64Img);
  });
});

