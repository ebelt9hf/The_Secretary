import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

// ═══════════════════════════════════════════════════
// Sourced from: app-backend-storage.test.js
// ═══════════════════════════════════════════════════
describe('StorageAPI Backend Persistence Engine (app-storage.js & app-fs.js)', () => {
  let virtualFS = new Map();

  beforeAll(() => {
    // Setup in-memory AppBridge filesystem mock
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
      'js/app-storage.js'
    ]);
  });

  beforeEach(() => {
    virtualFS.clear();
    StorageAPI.clearNoteCache();
  });

  describe('Generic JSON Operations (_readJSON & _writeJSON)', () => {
    it('serializes JSON data to storage and reads it back', async () => {
      const testObj = { name: 'Secretary', version: '2.8.0', active: true };
      await StorageAPI._writeJSON('config/test.json', testObj);

      const readBack = await StorageAPI._readJSON('config/test.json');
      expect(readBack).toEqual(testObj);
    });

    it('returns fallback value for missing or corrupt files', async () => {
      const missing = await StorageAPI._readJSON('nonexistent.json', { default: true });
      expect(missing).toEqual({ default: true });

      virtualFS.set('corrupt.json', '{ invalid json syntax... }');
      const corrupt = await StorageAPI._readJSON('corrupt.json', []);
      expect(corrupt).toEqual([]);
    });
  });

  describe('Notes Manifest Storage', () => {
    it('persists and loads notes manifest json and js format', async () => {
      const manifestData = [
        { id: 'note_1', path: 'notes/Meeting.html', title: 'Meeting' },
        { id: 'note_2', path: 'notes/Project.html', title: 'Project' }
      ];

      await StorageAPI.writeNotesManifest(manifestData);
      const loaded = await StorageAPI.readNotesManifest();
      expect(loaded).toEqual(manifestData);

      const jsCode = 'window.manifest = ' + JSON.stringify(manifestData) + ';';
      await StorageAPI.writeNotesManifestJS(jsCode);
      expect(virtualFS.get('notes/manifest.js')).toBe(jsCode);
    });
  });

  describe('Todos & Planner Databases Storage', () => {
    it('handles todos manifest persistence and existence check', async () => {
      expect(await StorageAPI.hasTodosManifest()).toBe(false);

      const todos = [{ id: 'td_1', title: 'Buy milk', priority: 'High' }];
      await StorageAPI.writeTodosManifest(todos);
      expect(await StorageAPI.hasTodosManifest()).toBe(true);

      const readTodos = await StorageAPI.readTodosManifest();
      expect(readTodos).toEqual(todos);
    });

    it('handles planner events database persistence', async () => {
      expect(await StorageAPI.hasPlanner()).toBe(false);

      const plannerData = { events: [{ id: 'ev_1', title: 'Sprint Demo', date: '2026-08-28' }] };
      await StorageAPI.writePlanner(plannerData);
      expect(await StorageAPI.hasPlanner()).toBe(true);

      const readPlanner = await StorageAPI.readPlanner();
      expect(readPlanner).toEqual(plannerData);
    });
  });

  describe('Colleagues & Settings Storage', () => {
    it('persists colleagues database and migration status', async () => {
      expect(await StorageAPI.hasColleagues()).toBe(false);

      const colleagues = [{ id: 'col_1', name: 'Sarah', role: 'Engineer' }];
      await StorageAPI.writeColleagues(colleagues);
      expect(await StorageAPI.hasColleagues()).toBe(true);
      expect(await StorageAPI.readColleagues()).toEqual(colleagues);

      await StorageAPI.writeColleaguesMigration({ version: 1, done: true });
      expect(await StorageAPI.hasColleaguesMigration()).toBe(true);
      expect(await StorageAPI.readColleaguesMigration()).toEqual({ version: 1, done: true });
    });

    it('persists application settings', async () => {
      const settings = { theme: 'dark', language: 'en', ai: { provider: 'ollama' } };
      await StorageAPI.writeSettings(settings);
      expect(await StorageAPI.hasSettings('secretary-settings.json')).toBe(true);
      expect(await StorageAPI.readSettings('secretary-settings.json')).toEqual(settings);
    });
  });

  describe('Note Content & In-Memory Cache Engine', () => {
    it('writes, reads, caches, and deletes note content', async () => {
      const notePath = 'notes/2026/Review.html';
      const htmlContent = '<h2>Quarterly Review</h2><p>All targets met.</p>';

      await StorageAPI.writeNoteContent(notePath, htmlContent);
      expect(await StorageAPI.hasNoteContent(notePath)).toBe(true);
      expect(StorageAPI.getNoteFromCache(notePath)).toBe(htmlContent);

      // Mutate raw virtual storage to verify readNoteContent returns from cache
      virtualFS.set(notePath, '<h2>Overwritten Storage</h2>');
      expect(await StorageAPI.readNoteContent(notePath)).toBe(htmlContent);

      // Invalidate cache and verify fresh read from storage
      StorageAPI.invalidateNoteCache(notePath);
      expect(await StorageAPI.readNoteContent(notePath)).toBe('<h2>Overwritten Storage</h2>');

      // Delete note content
      await StorageAPI.deleteNoteContent(notePath);
      expect(StorageAPI.getNoteFromCache(notePath)).toBeNull();
      expect(await StorageAPI.hasNoteContent(notePath)).toBe(false);
    });

    it('preloads all notes in concurrent batches', async () => {
      virtualFS.set('notes/A.html', '<p>A</p>');
      virtualFS.set('notes/B.html', '<p>B</p>');
      globalThis.manifest = [
        { path: 'notes/A.html', title: 'A' },
        { path: 'notes/B.html', title: 'B' }
      ];

      let progressCount = 0;
      await StorageAPI.preloadAllNotes((completed, total) => {
        progressCount = completed;
      });

      expect(progressCount).toBe(2);
      expect(StorageAPI.getNoteFromCache('notes/A.html')).toBe('<p>A</p>');
      expect(StorageAPI.getNoteFromCache('notes/B.html')).toBe('<p>B</p>');
    });
  });

  describe('Metadata Buffer & Shards Storage', () => {
    it('manages metadata buffer and sharded storage files', async () => {
      const bufferPayload = { items: [{ id: 'meta_1', title: 'Buf' }] };
      await StorageAPI.writeMetadataBuffer(bufferPayload);
      expect(await StorageAPI.hasMetadataBuffer()).toBe(true);
      expect(await StorageAPI.readMetadataBuffer()).toEqual(bufferPayload);

      const shardsIndex = { shardCount: 1, files: ['0.json'] };
      await StorageAPI.writeMetadataShardsIndex(shardsIndex);
      expect(await StorageAPI.hasMetadataShardsIndex()).toBe(true);
      expect(await StorageAPI.readMetadataShardsIndex()).toEqual(shardsIndex);

      const shardData = [{ id: 'shard_item_1' }];
      await StorageAPI.writeMetadataShard('0.json', shardData);
      expect(await StorageAPI.readMetadataShard('0.json')).toEqual(shardData);

      await StorageAPI.deleteMetadataShard('0.json');
      expect(await StorageAPI.readMetadataShard('0.json')).toBeNull();

      await StorageAPI.deleteMetadataShardsIndex();
      expect(await StorageAPI.hasMetadataShardsIndex()).toBe(false);
    });
  });

  describe('Stash & Chat History Storage', () => {
    it('manages stash files and lists stash directory', async () => {
      await StorageAPI.writeStashContent('scratchpad_1.txt', 'Temporary research notes');
      expect(await StorageAPI.readStashContent('scratchpad_1.txt')).toBe('Temporary research notes');

      const files = await StorageAPI.listStashFiles();
      expect(files).toContain('scratchpad_1.txt');

      await StorageAPI.deleteStashFile('scratchpad_1.txt');
      const filesAfterDelete = await StorageAPI.listStashFiles();
      expect(filesAfterDelete).not.toContain('scratchpad_1.txt');
    });

    it('persists chat history payload', async () => {
      const chatData = { messages: [{ role: 'user', content: 'Hello Secretary' }] };
      await StorageAPI.writeChatHistory(chatData);
      expect(await StorageAPI.readChatHistory()).toEqual(chatData);
    });
  });
});

// ═══════════════════════════════════════════════════
// Sourced from: app-stash-service.test.js
// ═══════════════════════════════════════════════════
describe('Stash Data Service (app-stash-service.js)', () => {
  let savedStorageAPI;

  beforeAll(() => {
    savedStorageAPI = globalThis.StorageAPI;
    loadScriptsIntoGlobal(['js/app-stash-service.js']);
  });

  afterAll(() => {
    globalThis.StorageAPI = savedStorageAPI;
  });

  beforeEach(() => {
    globalThis.rootHandle = {};
    globalThis.StorageAPI = {
      ...savedStorageAPI,
      listStashFiles: vi.fn().mockResolvedValue(['capture-1000.txt', 'capture-2000.txt']),
      readStashContent: vi.fn().mockImplementation((name) => Promise.resolve(`Content for ${name}`)),
      writeStashContent: vi.fn().mockResolvedValue(undefined),
      deleteStashFile: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('lists stash items sorted by ID', async () => {
    const items = await StashService.list();
    expect(items).toHaveLength(2);
    expect(items[0].filename).toBe('capture-1000.txt');
    expect(items[0].text).toBe('Content for capture-1000.txt');
    expect(items[1].filename).toBe('capture-2000.txt');
  });

  it('returns empty array if rootHandle is null', async () => {
    globalThis.rootHandle = null;
    const items = await StashService.list();
    expect(items).toEqual([]);
  });

  it('adds a new thought to stash', async () => {
    const result = await StashService.add('New thought to store');
    expect(result).not.toBeNull();
    expect(result.text).toBe('New thought to store');
    expect(StorageAPI.writeStashContent).toHaveBeenCalledWith(expect.stringMatching(/^capture-\d+\.txt$/), 'New thought to store');
  });

  it('ignores empty input when adding to stash', async () => {
    const result = await StashService.add('   ');
    expect(result).toBeNull();
    expect(StorageAPI.writeStashContent).not.toHaveBeenCalled();
  });

  it('deletes an item from stash', async () => {
    await StashService.delete('capture-1000.txt');
    expect(StorageAPI.deleteStashFile).toHaveBeenCalledWith('capture-1000.txt');
  });

  it('clears all items from stash', async () => {
    await StashService.clear();
    expect(StorageAPI.listStashFiles).toHaveBeenCalled();
    expect(StorageAPI.deleteStashFile).toHaveBeenCalledWith('capture-1000.txt');
    expect(StorageAPI.deleteStashFile).toHaveBeenCalledWith('capture-2000.txt');
  });
});

// ═══════════════════════════════════════════════════
// Sourced from: app-quick-stash-capture.test.js
// ═══════════════════════════════════════════════════
describe('QuickStashController (Global Quick Stash Capture)', () => {
  beforeAll(() => {
    globalThis.window = globalThis.window || {};
    globalThis.t = (key) => key;
    globalThis.escH = (s) => String(s || '');

    loadScriptsIntoGlobal([
      'js/app-utils.js',
      'js/app-stash-service.js'
    ]);
  });

  it('detects Cmd+Shift+S or Ctrl+Shift+S shortcut correctly', () => {
    const macShortcutEvent = {
      key: 'S',
      shiftKey: true,
      metaKey: true,
      ctrlKey: false
    };

    const winShortcutEvent = {
      key: 'S',
      shiftKey: true,
      metaKey: false,
      ctrlKey: true
    };

    const regularEvent = {
      key: 's',
      shiftKey: false,
      metaKey: false,
      ctrlKey: false
    };

    expect(QuickStashController.isQuickStashShortcut(macShortcutEvent)).toBe(true);
    expect(QuickStashController.isQuickStashShortcut(winShortcutEvent)).toBe(true);
    expect(QuickStashController.isQuickStashShortcut(regularEvent)).toBe(false);
  });

  it('processes raw input and extracts hashtags and clean body', () => {
    const rawInput = 'Follow up with design team on prototype #design #ui-refresh';
    const processed = QuickStashController.processRawInput(rawInput);

    expect(processed).toBeDefined();
    expect(processed.text).toBe('Follow up with design team on prototype');
    expect(processed.tags).toEqual(['design', 'ui-refresh']);
  });

  it('handles multiline input and preserves notes without hashtags', () => {
    const rawInput = 'Call client back tomorrow at 10am.\nDiscuss Q3 roadmap.';
    const processed = QuickStashController.processRawInput(rawInput);

    expect(processed.text).toBe('Call client back tomorrow at 10am.\nDiscuss Q3 roadmap.');
    expect(processed.tags).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════
// Sourced from: app-trash-bin.test.js
// ═══════════════════════════════════════════════════
describe('Trash Bin System (.trash/) in app-storage.js', () => {
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
      'js/app-storage.js'
    ]);
  });

  beforeEach(() => {
    virtualFS.clear();
    StorageAPI.clearNoteCache();
  });

  it('moves a note to .trash/ and logs it in .trash/manifest.json', async () => {
    const notePath = 'notes/Meeting-2026-09-03.html';
    const noteContent = '<html><head><title>Project Kickoff</title></head><body>Notes</body></html>';
    await StorageAPI.writeNoteContent(notePath, noteContent);

    expect(await StorageAPI.hasNoteContent(notePath)).toBe(true);

    const trashEntry = await StorageAPI.moveToTrash(notePath, { title: 'Project Kickoff' });
    expect(trashEntry).toBeDefined();
    expect(trashEntry.originalPath).toBe(notePath);
    expect(trashEntry.title).toBe('Project Kickoff');

    // Original note is removed from notes/
    expect(await StorageAPI.hasNoteContent(notePath)).toBe(false);

    // Trashed file exists in .trash/
    const trashList = await StorageAPI.listTrash();
    expect(trashList.length).toBe(1);
    expect(trashList[0].filename).toBe('Meeting-2026-09-03.html');
    expect(virtualFS.has('.trash/Meeting-2026-09-03.html')).toBe(true);
  });

  it('restores a trashed note back to notes/', async () => {
    const notePath = 'notes/Strategy.html';
    const noteContent = '<h1>Strategy Q4</h1>';
    await StorageAPI.writeNoteContent(notePath, noteContent);

    await StorageAPI.moveToTrash(notePath, { title: 'Strategy Q4' });
    expect(await StorageAPI.hasNoteContent(notePath)).toBe(false);

    const restored = await StorageAPI.restoreFromTrash('Strategy.html');
    expect(restored.path).toBe(notePath);
    expect(await StorageAPI.hasNoteContent(notePath)).toBe(true);
    expect(await StorageAPI.readNoteContent(notePath)).toBe(noteContent);

    const trashList = await StorageAPI.listTrash();
    expect(trashList.length).toBe(0);
  });

  it('permanently deletes a single note from .trash/', async () => {
    const notePath = 'notes/Draft.html';
    await StorageAPI.writeNoteContent(notePath, '<p>Draft</p>');
    await StorageAPI.moveToTrash(notePath, { title: 'Draft' });

    expect((await StorageAPI.listTrash()).length).toBe(1);

    await StorageAPI.permanentDeleteFromTrash('Draft.html');
    expect((await StorageAPI.listTrash()).length).toBe(0);
    expect(virtualFS.has('.trash/Draft.html')).toBe(false);
  });

  it('empties the entire trash bin', async () => {
    await StorageAPI.writeNoteContent('notes/N1.html', 'N1');
    await StorageAPI.writeNoteContent('notes/N2.html', 'N2');
    await StorageAPI.moveToTrash('notes/N1.html', { title: 'N1' });
    await StorageAPI.moveToTrash('notes/N2.html', { title: 'N2' });

    expect((await StorageAPI.listTrash()).length).toBe(2);

    await StorageAPI.emptyTrash();
    expect((await StorageAPI.listTrash()).length).toBe(0);
    expect(virtualFS.has('.trash/N1.html')).toBe(false);
    expect(virtualFS.has('.trash/N2.html')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════
// Sourced from: app-state.test.js
// ═══════════════════════════════════════════════════
describe('App State & StateBus (app-state.js)', () => {
  beforeAll(() => {
    loadScriptsIntoGlobal(['js/app-state.js']);
  });

  describe('StateBus Event Emitter', () => {
    it('subscribes and receives emitted events for exact topic matches', () => {
      const listener = vi.fn();
      const unsubscribe = StateBus.on('todo:created', listener);

      StateBus.emit('todo:created', { id: 'todo-1', title: 'Test Task' });
      expect(listener).toHaveBeenCalledWith({ id: 'todo-1', title: 'Test Task' }, 'todo:created');

      unsubscribe();
      StateBus.emit('todo:created', { id: 'todo-2' });
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('supports namespace wildcard topic matches (e.g. todo:*)', () => {
      const listener = vi.fn();
      StateBus.on('todo:*', listener);

      StateBus.emit('todo:updated:123', { status: 'WIP' });
      expect(listener).toHaveBeenCalledWith({ status: 'WIP' }, 'todo:updated:123');
    });

    it('supports global wildcard topic matches (*)', () => {
      const listener = vi.fn();
      StateBus.on('*', listener);

      StateBus.emit('note:opened', { path: '/notes/test.md' });
      expect(listener).toHaveBeenCalledWith('note:opened', { path: '/notes/test.md' });
    });
  });
});
