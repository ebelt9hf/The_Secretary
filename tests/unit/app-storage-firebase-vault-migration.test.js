import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Complete Secretary Data Migration to Firebase Vault', () => {
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
      'js/app-storage.js'
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
    if (window.FirebaseSyncService.state.encryptedDocs) {
      window.FirebaseSyncService.state.encryptedDocs.clear();
    }
    if (window.FirebaseSyncService.state.docsCache) {
      window.FirebaseSyncService.state.docsCache.clear();
    }
    if (window.FirebaseSyncService.state.encryptedAssets) {
      window.FirebaseSyncService.state.encryptedAssets.clear();
    }
    if (window.FirebaseSyncService.state.assetsCache) {
      window.FirebaseSyncService.state.assetsCache.clear();
    }
    if (window.FirebaseSyncService.state.pendingDocsQueue) {
      window.FirebaseSyncService.state.pendingDocsQueue.clear();
    }
    if (window.FirebaseSyncService.state.pendingAssetsQueue) {
      window.FirebaseSyncService.state.pendingAssetsQueue.clear();
    }
  });

  it('supports generic typed document encryption and retrieval in vault', async () => {
    const pass = 'Correct-Master-Passphrase-2026!';
    await window.FirebaseSyncService.setupVault(pass);

    // Test todos
    const todosData = [{ id: 'todo-1', title: 'Task 1', done: false }];
    await window.FirebaseSyncService.putDoc('todos', 'manifest', todosData);
    const readTodos = await window.FirebaseSyncService.getDoc('todos', 'manifest');
    expect(readTodos).toEqual(todosData);

    // Test planner
    const plannerData = { version: 1, events: [{ id: 'evt-1', title: 'Meeting' }] };
    await window.FirebaseSyncService.putDoc('planner', 'events', plannerData);
    const readPlanner = await window.FirebaseSyncService.getDoc('planner', 'events');
    expect(readPlanner).toEqual(plannerData);

    // Test colleagues
    const colleaguesData = [{ id: 'col-1', name: 'Alice', role: 'Dev' }];
    await window.FirebaseSyncService.putDoc('colleagues', 'database', colleaguesData);
    const readColleagues = await window.FirebaseSyncService.getDoc('colleagues', 'database');
    expect(readColleagues).toEqual(colleaguesData);

    // Test deleteDoc
    await window.FirebaseSyncService.deleteDoc('todos', 'manifest');
    expect(await window.FirebaseSyncService.getDoc('todos', 'manifest')).toBeNull();
  });

  it('supports encrypted asset storage and retrieval in vault', async () => {
    const pass = 'Asset-Master-Passphrase-2026!';
    await window.FirebaseSyncService.setupVault(pass);

    const assetDataUrl = 'data:image/webp;base64,UklGRkAAAABXRUJQVlA4IDQAAADwAQCdASoBAAEAAQAcJaACdLoAAP7/2QAA';
    await window.FirebaseSyncService.saveAsset('img_test_001.webp', assetDataUrl, { mimeType: 'image/webp' });

    const retrieved = await window.FirebaseSyncService.getAsset('img_test_001.webp');
    expect(retrieved).toBe(assetDataUrl);

    // Also retrieved via readAssetAsDataUrl in app-fs.js
    window.StorageAPI.setStorageEngine('firebase');
    const fsRetrieved = await readAssetAsDataUrl('img_test_001.webp');
    expect(fsRetrieved).toBe(assetDataUrl);

    await window.FirebaseSyncService.deleteAsset('img_test_001.webp');
    expect(await window.FirebaseSyncService.getAsset('img_test_001.webp')).toBeNull();
  });

  it('routes StorageAPI data operations to Firebase vault without touching local disk in Firebase mode', async () => {
    const pass = 'Route-Master-Passphrase-2026!';
    await window.FirebaseSyncService.setupVault(pass);
    window.StorageAPI.setStorageEngine('firebase');

    // 1. Write todos in Firebase mode
    const todos = [{ id: 't-1', title: 'Buy milk' }];
    await window.StorageAPI.writeTodosManifest(todos);
    expect(virtualFS.has('todos/manifest.json')).toBe(false); // Does NOT write to disk in Firebase mode
    expect(await window.StorageAPI.readTodosManifest()).toEqual(todos);

    // 2. Write planner in Firebase mode
    const planner = { events: [{ id: 'p-1', title: 'Sprint Review' }] };
    await window.StorageAPI.writePlanner(planner);
    expect(virtualFS.has('planner.json')).toBe(false);
    expect(await window.StorageAPI.readPlanner()).toEqual(planner);

    // 3. Write colleagues in Firebase mode
    const colleagues = [{ id: 'c-1', name: 'Bob' }];
    await window.StorageAPI.writeColleagues(colleagues);
    expect(virtualFS.has('colleagues.json')).toBe(false);
    expect(await window.StorageAPI.readColleagues()).toEqual(colleagues);

    // 4. Write note in Firebase mode
    await window.StorageAPI.writeNoteContent('notes/meeting.html', '<p>Confidential Meeting</p>', {
      id: 'meeting',
      title: 'Confidential Meeting'
    });
    expect(virtualFS.has('notes/meeting.html')).toBe(false); // Note content not written to disk
    expect(await window.StorageAPI.readNoteContent('notes/meeting.html')).toBe('<p>Confidential Meeting</p>');

    // 5. Trash in Firebase mode
    await window.StorageAPI.moveToTrash('notes/meeting.html', { title: 'Confidential Meeting' });
    expect(virtualFS.has('.trash/manifest.json')).toBe(false);
    const trashList = await window.StorageAPI.listTrash();
    expect(trashList.length).toBe(1);
    expect(trashList[0].title).toBe('Confidential Meeting');

    // 6. Stash in Firebase mode
    await window.StorageAPI.writeStashContent('scratch.txt', 'Quick thought in vault');
    expect(virtualFS.has('stash/scratch.txt')).toBe(false);
    expect(await window.StorageAPI.readStashContent('scratch.txt')).toBe('Quick thought in vault');
    expect(await window.StorageAPI.listStashFiles()).toContain('scratch.txt');

    // 7. Chat history in Firebase mode
    const chat = [{ role: 'user', text: 'Hello AI' }];
    await window.StorageAPI.writeChatHistory(chat);
    expect(virtualFS.has('.secretary/chat-history.json')).toBe(false);
    expect(await window.StorageAPI.readChatHistory()).toEqual(chat);

    // 8. Planner proposals MUST always be a local file on disk (AGENTS.md contract)
    const proposals = { version: 1, proposals: [{ id: 'agent-1', title: 'Agent Proposed Event' }] };
    await window.StorageAPI.writePlannerProposals(proposals);
    expect(virtualFS.has('planner-proposals.json')).toBe(true);
    expect(await window.StorageAPI.readPlannerProposals()).toEqual(proposals);
  });

  it('migrates full workspace to Firebase vault and reverts all data back to filesystem', async () => {
    // 1. Populate filesystem workspace
    virtualFS.set('notes/manifest.json', JSON.stringify([
      { id: 'note1', path: 'notes/note1.html', title: 'First Note', tags: ['work'] },
      { id: 'note2', path: 'notes/note2.html', title: 'Second Note', tags: ['ideas'] }
    ]));
    virtualFS.set('notes/note1.html', '<h1>Note 1 Body</h1>');
    virtualFS.set('notes/note2.html', '<h2>Note 2 Body</h2>');
    virtualFS.set('todos/manifest.json', JSON.stringify([{ id: 'todo-mig-1', title: 'Migrate tasks' }]));
    virtualFS.set('planner.json', JSON.stringify({ events: [{ id: 'plan-1', title: 'Launch' }] }));
    virtualFS.set('colleagues.json', JSON.stringify([{ id: 'col-1', name: 'Charlie' }]));
    virtualFS.set('.secretary/colleagues-migration-v1.done', JSON.stringify({ migratedAt: 123456 }));
    virtualFS.set('.secretary/chat-history.json', JSON.stringify([{ role: 'user', text: 'Chat before migration' }]));
    virtualFS.set('.trash/manifest.json', JSON.stringify([{ filename: 'deleted_old.html', title: 'Deleted Old' }]));
    virtualFS.set('.trash/deleted_old.html', '<p>Old deleted note</p>');
    virtualFS.set('stash/memo.md', '# Stashed Memo');

    // 2. Perform full migration
    const pass = 'Full-Migration-Master-Passphrase-2026!';
    const result = await window.StorageAPI.migrateToFirebase(pass);
    expect(result.notesCount).toBe(2);
    // Verify all original local files were moved into _migrated_to_cloud_backup folder
    expect(result.archive.backupDir).toBe('_migrated_to_cloud_backup');
    expect(virtualFS.has('notes/note1.html')).toBe(false);
    expect(virtualFS.has('notes/manifest.json')).toBe(false);
    expect(virtualFS.has('planner.json')).toBe(false);
    expect(virtualFS.has('_migrated_to_cloud_backup/notes/note1.html')).toBe(true);
    expect(virtualFS.has('_migrated_to_cloud_backup/notes/manifest.json')).toBe(true);
    expect(virtualFS.has('_migrated_to_cloud_backup/planner.json')).toBe(true);
    expect(virtualFS.has('_migrated_to_cloud_backup/todos/manifest.json')).toBe(true);
    expect(virtualFS.has('_migrated_to_cloud_backup/colleagues.json')).toBe(true);
    expect(virtualFS.has('_migrated_to_cloud_backup/.secretary/chat-history.json')).toBe(true);
    expect(virtualFS.has('_migrated_to_cloud_backup/.trash/deleted_old.html')).toBe(true);
    expect(virtualFS.has('_migrated_to_cloud_backup/stash/memo.md')).toBe(true);
    expect(virtualFS.has('_migrated_to_cloud_backup/README.txt')).toBe(true);

    // Verify all data is accessible in Firebase mode
    expect(await window.StorageAPI.readNotesManifest()).toHaveLength(2);
    expect(await window.StorageAPI.readNoteContent('notes/note1.html')).toBe('<h1>Note 1 Body</h1>');
    expect((await window.StorageAPI.readTodosManifest())[0].title).toBe('Migrate tasks');
    expect((await window.StorageAPI.readPlanner()).events[0].title).toBe('Launch');
    expect((await window.StorageAPI.readColleagues())[0].name).toBe('Charlie');
    expect(await window.StorageAPI.readChatHistory()).toHaveLength(1);
    expect((await window.StorageAPI.listTrash())[0].title).toBe('Deleted Old');
    expect(await window.StorageAPI.readStashContent('memo.md')).toBe('# Stashed Memo');

    // 3. Clear virtualFS to simulate clean directory before revert
    virtualFS.clear();

    // 4. Revert all data back to filesystem
    const revertResult = await window.StorageAPI.revertToFilesystem();
    expect(revertResult.notesCount).toBe(2);
    expect(window.StorageAPI.getStorageEngine()).toBe('filesystem');

    // Verify all files were created on disk
    expect(virtualFS.has('notes/manifest.json')).toBe(true);
    expect(virtualFS.get('notes/note1.html')).toBe('<h1>Note 1 Body</h1>');
    expect(virtualFS.get('notes/note2.html')).toBe('<h2>Note 2 Body</h2>');
    expect(virtualFS.has('todos/manifest.json')).toBe(true);
    expect(virtualFS.has('planner.json')).toBe(true);
    expect(virtualFS.has('colleagues.json')).toBe(true);
    expect(virtualFS.has('.secretary/colleagues-migration-v1.done')).toBe(true);
    expect(virtualFS.has('.secretary/chat-history.json')).toBe(true);
    expect(virtualFS.has('.trash/manifest.json')).toBe(true);
    expect(virtualFS.get('.trash/deleted_old.html')).toBe('<p>Old deleted note</p>');
    expect(virtualFS.get('stash/memo.md')).toBe('# Stashed Memo');
  });

  it('re-encrypts notes, generic docs, and assets on passphrase rotation', async () => {
    const oldPass = 'Old-Secret-Passphrase-2026!';
    const newPass = 'New-Super-Secret-Passphrase-2026!';

    await window.FirebaseSyncService.setupVault(oldPass);

    // Save note, doc, and asset
    await window.FirebaseSyncService.queueSyncNote({ id: 'rot_note', title: 'Rotation Note', contentHtml: '<p>Secret</p>' }, 0);
    await window.FirebaseSyncService.putDoc('planner', 'events', { events: [{ id: 'e1', title: 'Top Secret Plan' }] });
    await window.FirebaseSyncService.saveAsset('secret_img.webp', 'data:image/webp;base64,ABCDEF123456');

    // Rotate passphrase
    await window.FirebaseSyncService.rotatePassphrase(oldPass, newPass);

    // Lock and unlock with new passphrase
    window.FirebaseSyncService.lockVault();
    const unlocked = await window.FirebaseSyncService.unlockVault(newPass);
    expect(unlocked).toBe(true);

    // Verify all items are decrypted correctly with new passphrase
    const note = await window.FirebaseSyncService.getNote('rot_note');
    expect(note.title).toBe('Rotation Note');
    expect(note.contentHtml).toBe('<p>Secret</p>');

    const planner = await window.FirebaseSyncService.getDoc('planner', 'events');
    expect(planner.events[0].title).toBe('Top Secret Plan');

    const asset = await window.FirebaseSyncService.getAsset('secret_img.webp');
    expect(asset).toBe('data:image/webp;base64,ABCDEF123456');
  });

  it('reports granular progress during migration to Firebase vault', async () => {
    virtualFS.set('notes/manifest.json', JSON.stringify([
      { id: 'prog1', path: 'notes/prog1.html', title: 'Progress 1' },
      { id: 'prog2', path: 'notes/prog2.html', title: 'Progress 2' }
    ]));
    virtualFS.set('notes/prog1.html', '<p>P1</p>');
    virtualFS.set('notes/prog2.html', '<p>P2</p>');

    const progressReports = [];
    const pass = 'Progress-Test-Passphrase-2026!';
    await window.StorageAPI.migrateToFirebase(pass, {}, (p) => {
      progressReports.push({ ...p });
    });

    expect(progressReports.length).toBeGreaterThanOrEqual(4);
    expect(progressReports[0].stage).toBe('collecting');
    expect(progressReports[0].percent).toBe(5);
    expect(progressReports.some(p => p.stage === 'encrypting' || p.stage === 'vault' || p.stage === 'notes')).toBe(true);
    expect(progressReports[progressReports.length - 1].stage).toBe('finalizing');
    expect(progressReports[progressReports.length - 1].percent).toBe(100);
  });

  it('allows reading migrated notes and generating new notes post-migration without local files', async () => {
    // 1. Initial workspace with notes
    virtualFS.set('notes/manifest.json', JSON.stringify([
      { id: 'migrated-note-1', path: 'notes/migrated-note-1.html', title: 'Migrated Note 1', tags: ['work'] }
    ]));
    virtualFS.set('notes/migrated-note-1.html', '<p>Content from disk</p>');

    // 2. Migrate
    const pass = 'Post-Mig-Passphrase-2026!';
    await window.StorageAPI.migrateToFirebase(pass);
    expect(window.StorageAPI.getStorageEngine()).toBe('firebase');

    // 3. Verify reading existing note by path and by ID
    const contentByPath = await window.StorageAPI.readNoteContent('notes/migrated-note-1.html');
    expect(contentByPath).toBe('<p>Content from disk</p>');

    const noteDirect = await window.FirebaseSyncService.getNote('migrated-note-1');
    expect(noteDirect).not.toBeNull();
    expect(noteDirect.title).toBe('Migrated Note 1');

    // 4. Create a brand new note post-migration
    const newNotePath = 'notes/newly-created-note.html';
    const newNoteContent = '<h1>Brand New Cloud Note</h1>';
    await window.StorageAPI.writeNoteContent(newNotePath, newNoteContent, {
      id: 'newly-created-note',
      title: 'Newly Created Note',
      date: '2026-10-05',
      tags: ['cloud', 'fresh']
    });

    // Verify it is in Firebase vault and note cache, and NOT on disk
    expect(virtualFS.has(newNotePath)).toBe(false);
    const readNewContent = await window.StorageAPI.readNoteContent(newNotePath);
    expect(readNewContent).toBe(newNoteContent);

    const newNoteFromVault = await window.FirebaseSyncService.getNote('newly-created-note');
    expect(newNoteFromVault).not.toBeNull();
    expect(newNoteFromVault.title).toBe('Newly Created Note');

    // 5. Reading a non-existent note returns empty string without throwing fatal errors
    const nonExistent = await window.StorageAPI.readNoteContent('notes/non-existent-999.html');
    expect(nonExistent).toBe('');
  });

  it('syncs workspace settings to cloud vault while strictly excluding AI API keys and credentials', async () => {
    // 1. Initial settings on local filesystem with sensitive AI credentials
    const localSettings = {
      storageEngine: 'filesystem',
      username: 'Alice Explorer',
      language: 'fr',
      ui: {
        theme: 'dark',
        colors: { accent: '#ff4400', bg: '#111111' },
        workingDays: [1, 2, 3, 4, 5],
        workStartTime: '08:30',
        workEndTime: '17:30'
      },
      ai: {
        enabled: true,
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: 'sk-super-confidential-secret-key-12345'
      },
      apiKey: 'legacy-api-key-999',
      rememberPassphrase: true,
      windowState: { x: 100, y: 100, width: 1200, height: 800 }
    };
    virtualFS.set('secretary-settings.json', JSON.stringify(localSettings));

    // 2. Migrate to Firebase
    const pass = 'Settings-Vault-Passphrase-2026!';
    await window.StorageAPI.migrateToFirebase(pass);
    expect(window.StorageAPI.getStorageEngine()).toBe('firebase');

    // 3. Inspect encrypted document stored in vault for settings
    const vaultSettings = await window.FirebaseSyncService.getDoc('settings', 'config');
    expect(vaultSettings).not.toBeNull();
    expect(vaultSettings.username).toBe('Alice Explorer');
    expect(vaultSettings.language).toBe('fr');
    expect(vaultSettings.ui.theme).toBe('dark');
    expect(vaultSettings.ui.colors.accent).toBe('#ff4400');
    expect(vaultSettings.ui.workStartTime).toBe('08:30');
    expect(vaultSettings.ai.model).toBe('gpt-4o');

    // Verify AI API key and sensitive credentials were NEVER saved to cloud vault
    expect(vaultSettings.ai.apiKey).toBeUndefined();
    expect(vaultSettings.apiKey).toBeUndefined();
    expect(vaultSettings.rememberPassphrase).toBeUndefined();
    expect(vaultSettings.windowState).toBeUndefined();

    // 4. Update settings in Firebase mode
    const updatedSettings = {
      ...localSettings,
      username: 'Alice Updated',
      ui: { ...localSettings.ui, theme: 'light' },
      ai: {
        enabled: true,
        provider: 'anthropic',
        model: 'claude-3-5-sonnet',
        apiKey: 'sk-ant-very-private-key-67890'
      }
    };
    await window.StorageAPI.writeSettings(updatedSettings);

    const vaultUpdated = await window.FirebaseSyncService.getDoc('settings', 'config');
    expect(vaultUpdated.username).toBe('Alice Updated');
    expect(vaultUpdated.ui.theme).toBe('light');
    expect(vaultUpdated.ai.model).toBe('claude-3-5-sonnet');
    expect(vaultUpdated.ai.apiKey).toBeUndefined();

    // 5. Read settings via StorageAPI (merges cloud settings with local AI credentials)
    const readMerged = await window.StorageAPI.readSettings();
    expect(readMerged.username).toBe('Alice Updated');
    expect(readMerged.ui.theme).toBe('light');
    expect(readMerged.ai.model).toBe('claude-3-5-sonnet');
    expect(readMerged.ai.apiKey).toBe('sk-ant-very-private-key-67890'); // Local key preserved

    // 6. Revert to filesystem
    await window.StorageAPI.revertToFilesystem();
    expect(virtualFS.has('secretary-settings.json')).toBe(true);
    const revertedSettings = JSON.parse(virtualFS.get('secretary-settings.json'));
    expect(revertedSettings.username).toBe('Alice Updated');
    expect(revertedSettings.ui.theme).toBe('light');
    expect(revertedSettings.storageEngine).toBe('filesystem');
    expect(revertedSettings.ai.apiKey).toBe('sk-ant-very-private-key-67890');
  });
});

