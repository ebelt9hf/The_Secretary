import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Planner Note Opening & Dual-Backend Manifest Indexing Pipeline', () => {
  beforeAll(() => {
    globalThis.window = globalThis.window || globalThis;
    globalThis.escH = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    globalThis.escA = (s) => String(s || '');
    globalThis.toast = vi.fn();
    globalThis.syncPreview = vi.fn();
    globalThis.scheduleAutoSave = vi.fn();
    globalThis.openModal = vi.fn();
    globalThis.closeModal = vi.fn();
    globalThis.broadcastSync = vi.fn();
    globalThis.saveLocalSettings = vi.fn();
    globalThis.saveFolderSettingsDebounced = vi.fn();
    globalThis.renderPrefs = vi.fn();
    globalThis.renderBoard = vi.fn();
    globalThis.setAppLanguage = vi.fn();
    globalThis.mdToPreviewHTML = (md) => `<div>${md}</div>`;
    globalThis.rebuildIndexHTML = vi.fn().mockResolvedValue(true);
    globalThis.renderFilterChips = vi.fn();
    globalThis.openNoteOverlay = vi.fn();
    globalThis.switchTab = vi.fn();
    globalThis.savePlanner = vi.fn().mockResolvedValue(true);
    globalThis.renderPlanner = vi.fn();
    globalThis.showMdTab = vi.fn();

    loadScriptsIntoGlobal([
      'js/app-state.js',
      'js/app-fs.js',
      'js/app-idb.js',
      'js/app-crypto.js',
      'js/app-firebase-sync.js',
      'js/app-storage.js',
      'js/app-utils.js',
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-notes.js',
      'js/app-collab.js',
      'js/app-planner.js'
    ]);
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    StorageAPI.clearNoteCache();
    StorageAPI.setStorageEngine('filesystem');
    StorageAPI._lastManifestMap = new Map();
    globalThis.manifest = [];
    globalThis.metadataBuffer = [];
    globalThis.metadataById = new Map();
    globalThis.metadataByPath = new Map();
    globalThis.metadataStorageMode = 'single';
    globalThis.metadataShardIndexCache = null;
    globalThis.plannerEvents = [];
    globalThis.todosManifest = [];
    globalThis.collaborativeDataCache = {};
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * 1. Protected Behavior: `StorageAPI.readNotesManifest()` seeds `_lastManifestMap` so the first `writeNotesManifest()`
   *    call in a session only invokes `FirebaseSyncService.updateNoteMetadata` for newly added or changed notes, and
   *    resolves combined tags from `group_tags`, `major_topic_tags`, `topic_tags`, and `extra_tags`.
   * 2. Regression Target: Unseeded `_lastManifestMap` causing O(N) WebCrypto + IndexedDB stalls at 75% planner note
   *    linking on Firebase vaults, and dropping structured tag arrays when `item.tags` is undefined.
   * 3. Coverage Overlap / Redundancy: Existing Firebase tests verify full vault migration, not manifest delta seeding
   *    after `readNotesManifest()` or structured tag array forwarding.
   * 4. Production Code Footprint: None; exercises `StorageAPI.readNotesManifest` and `StorageAPI.writeNotesManifest`.
   */
  it('seeds _lastManifestMap on readNotesManifest and only updates changed notes with combined tags on writeNotesManifest', async () => {
    const existingEntries = [
      {
        id: 'note-existing-1',
        path: 'notes/note-existing-1.html',
        title: 'Existing Note 1',
        date: '2026-11-01',
        group_tags: ['Engineering'],
        major_topic_tags: ['Backend'],
        topic_tags: ['Indexing'],
        extra_tags: ['Urgent'],
        workstream: 'Core',
        pinned: false,
        archived: false,
        favorite: false
      },
      {
        id: 'note-existing-2',
        path: 'notes/note-existing-2.html',
        title: 'Existing Note 2',
        date: '2026-11-02',
        tags: ['General'],
        workstream: '',
        pinned: true,
        archived: false,
        favorite: false
      }
    ];

    const updateNoteMetadataSpy = vi.fn().mockResolvedValue(true);
    const updateManifestCacheSpy = vi.fn();

    window.FirebaseSyncService.state = {
      isUnlocked: true,
      localCache: new Map([['note-existing-1', {}], ['note-existing-2', {}]])
    };
    vi.spyOn(window.FirebaseSyncService, 'getManifest').mockReturnValue(existingEntries);
    vi.spyOn(window.FirebaseSyncService, 'updateNoteMetadata').mockImplementation(updateNoteMetadataSpy);
    vi.spyOn(window.FirebaseSyncService, '_updateManifestCache').mockImplementation(updateManifestCacheSpy);

    StorageAPI.setStorageEngine('firebase');

    const loaded = await StorageAPI.readNotesManifest();
    expect(loaded).toHaveLength(2);

    // Append one newly created planner note and write the manifest
    const newPlannerNote = {
      id: 'note-planner-new',
      path: 'notes/note-planner-new.html',
      title: 'Planner Sync Note',
      date: '2026-11-04',
      group_tags: ['Meetings'],
      major_topic_tags: ['Roadmap'],
      topic_tags: ['Q4'],
      extra_tags: [],
      workstream: 'Product',
      pinned: false,
      archived: false,
      favorite: false
    };

    await StorageAPI.writeNotesManifest([...existingEntries, newPlannerNote]);

    // Only the 1 newly added note should trigger FirebaseSyncService.updateNoteMetadata
    expect(updateNoteMetadataSpy).toHaveBeenCalledTimes(1);
    expect(updateNoteMetadataSpy).toHaveBeenCalledWith(
      'note-planner-new',
      expect.objectContaining({
        title: 'Planner Sync Note',
        tags: ['Meetings', 'Roadmap', 'Q4'],
        workstream: 'Product',
        date: '2026-11-04'
      }),
      5000
    );
  });

  /**
   * 1. Protected Behavior: `loadManifest()` reconciles `notes/manifest.json` entries when `notes/metadata-buffer.json`
   *    is present on local disk so any note written to `notes/manifest.json` before a reload is immediately discoverable
   *    via `getNoteById()` while preserving rich metadata (`decisions`, `decisionsReady`, `preview`) from the buffer.
   * 2. Regression Target: Early `if (loadedMeta) return;` in `loadManifest()` hiding newly created planner notes when
   *    `notes/manifest.json` was persisted before `notes/metadata-buffer.json` completed writing.
   * 3. Coverage Overlap / Redundancy: None; no existing test exercises divergence between `metadata-buffer.json` and
   *    `manifest.json` during `loadManifest()`.
   * 4. Production Code Footprint: None; tests production `loadManifest()` and `getNoteById()`.
   */
  it('merges newer notes/manifest.json entries into metadataBuffer during loadManifest while preserving buffered decisions', async () => {
    vi.spyOn(StorageAPI, 'hasMetadataShardsIndex').mockResolvedValue(false);
    vi.spyOn(StorageAPI, 'hasMetadataBuffer').mockResolvedValue(true);
    vi.spyOn(StorageAPI, 'readMetadataBuffer').mockResolvedValue({
      version: 1,
      items: [
        {
          id: 'note-buffered',
          path: 'notes/note-buffered.html',
          title: 'Buffered Note',
          date: '2026-11-01',
          modified: '2026-11-01T10:00:00.000Z',
          preview: 'Cached preview text',
          decisionsReady: true,
          decisions: [{ text: 'Keep local architecture clean', status: 'active' }],
          stats: { todoMarkers: 1, mentions: 2, decisions: 1 }
        }
      ]
    });
    vi.spyOn(StorageAPI, 'readNotesManifest').mockResolvedValue([
      {
        id: 'note-buffered',
        path: 'notes/note-buffered.html',
        title: 'Buffered Note',
        date: '2026-11-01',
        modified: '2026-11-01T10:00:00.000Z'
      },
      {
        id: 'note-from-manifest-only',
        path: 'notes/note-from-manifest-only.html',
        title: 'Planner Note Created Before Reload',
        date: '2026-11-04',
        modified: '2026-11-04T09:30:00.000Z',
        group_tags: ['Work']
      }
    ]);

    await loadManifest();

    const recoveredNote = getNoteById('note-from-manifest-only');
    expect(recoveredNote).not.toBeNull();
    expect(recoveredNote.title).toBe('Planner Note Created Before Reload');

    const bufferedNote = getNoteById('note-buffered');
    expect(bufferedNote).not.toBeNull();
    expect(bufferedNote.preview).toBe('Cached preview text');
    expect(bufferedNote.decisionsReady).toBe(true);
    expect(bufferedNote.decisions).toHaveLength(1);
  });

  /**
   * 1. Protected Behavior: `hydrateMetadataFromManifestIncremental()` treats entries with empty `modified: ""` and
   *    `decisionsReady: true` as fresh without re-reading/re-parsing HTML, preserves notes added to `manifest`
   *    concurrently while hydration is running, and writes `metadata-buffer.json` once rather than per-note.
   * 2. Regression Target: False-negative `current.modified && ...` check re-parsing all notes with empty `modified`,
   *    and `manifest = metadataBuffer.map(...)` overwriting concurrent `upsertManifest()` additions during startup.
   * 3. Coverage Overlap / Redundancy: None; first unit test covering incremental hydration freshness and concurrency.
   * 4. Production Code Footprint: None; exercises `hydrateMetadataFromManifestIncremental` and `upsertManifest`.
   */
  it('skips already-ready notes with empty modified timestamp and preserves concurrent manifest additions during hydration', async () => {
    const initialEntries = [
      {
        id: 'note-empty-mod',
        path: 'notes/note-empty-mod.html',
        title: 'Ready Note With Empty Modified',
        date: '2026-11-01',
        modified: '',
        preview: 'Already extracted',
        decisionsReady: true,
        decisions: [],
        stats: { todoMarkers: 0, mentions: 0, decisions: 0 }
      },
      {
        id: 'note-needs-hydration',
        path: 'notes/note-needs-hydration.html',
        title: 'Unready Note',
        date: '2026-11-02',
        modified: '2026-11-02T12:00:00.000Z',
        decisionsReady: false
      }
    ];

    globalThis.manifest = initialEntries.map((e) => ({ ...e }));
    globalThis.metadataBuffer = initialEntries.map((e) => ({ ...e }));
    syncMetadataIndexes();

    vi.spyOn(StorageAPI, 'readNotesManifest').mockResolvedValue(initialEntries);
    const readContentSpy = vi.spyOn(StorageAPI, 'readNoteContent').mockImplementation(async (path) => {
      // Simulate user creating a new note from the planner while hydration is awaiting note HTML
      if (path === 'notes/note-needs-hydration.html') {
        upsertManifest({
          id: 'note-concurrent-planner',
          path: 'notes/note-concurrent-planner.html',
          title: 'Concurrent Planner Note',
          date: '2026-11-04',
          group_tags: ['Calls'],
          mainHTML: '<p>Created concurrently while hydrating</p>'
        });
      }
      return '<!DOCTYPE html><html><head><title>Hydrated Note</title></head><body><main><p>Hydrated body</p></main></body></html>';
    });
    const writeBufferSpy = vi.spyOn(StorageAPI, 'writeMetadataBuffer').mockResolvedValue(true);

    await hydrateMetadataFromManifestIncremental({ chunkSize: 10 });

    // 'note-empty-mod' must NOT be re-read from disk because decisionsReady === true and modified === '' matches
    expect(readContentSpy).toHaveBeenCalledTimes(1);
    expect(readContentSpy).toHaveBeenCalledWith('notes/note-needs-hydration.html');
    expect(writeBufferSpy).toHaveBeenCalledTimes(1);

    // Concurrent planner note must still exist in both manifest and getNoteById()
    expect(getNoteById('note-concurrent-planner')).not.toBeNull();
    expect(globalThis.manifest.some((n) => n.id === 'note-concurrent-planner')).toBe(true);
  });

  /**
   * 1. Protected Behavior: `saveMetadataBuffer()` in single-file mode (`metadataStorageMode === 'single'` and no shard
   *    cache) writes `notes/metadata-buffer.json` directly without probing `StorageAPI.hasMetadataShardsIndex()`.
   * 2. Regression Target: Redundant `hasMetadataShardsIndex()` filesystem probes on every `saveManifest()` call when
   *    the vault is already in `'single'` mode.
   * 3. Coverage Overlap / Redundancy: `app-backend-storage.test.js` tests shard CRUD helpers, not `saveMetadataBuffer`
   *    probe avoidance in `'single'` mode.
   * 4. Production Code Footprint: None; exercises `saveMetadataBuffer()` directly.
   */
  it('does not probe hasMetadataShardsIndex on saveMetadataBuffer when already in single metadataStorageMode', async () => {
    globalThis.metadataStorageMode = 'single';
    globalThis.metadataShardIndexCache = null;
    globalThis.metadataBuffer = [
      {
        id: 'note-single-mode',
        path: 'notes/note-single-mode.html',
        title: 'Single Mode Note',
        date: '2026-11-04',
        decisionsReady: true,
        decisions: []
      }
    ];

    const hasShardsSpy = vi.spyOn(StorageAPI, 'hasMetadataShardsIndex').mockResolvedValue(false);
    const writeBufferSpy = vi.spyOn(StorageAPI, 'writeMetadataBuffer').mockResolvedValue(true);

    await saveMetadataBuffer();

    expect(writeBufferSpy).toHaveBeenCalledTimes(1);
    expect(hasShardsSpy).not.toHaveBeenCalled();
  });

  /**
   * 1. Protected Behavior: `openNoteForEvent()` stages the new note in memory (`StorageAPI.getNoteFromCache`),
   *    links `event.noteId` and `event.linkedNoteIds` (and propagates to linked `prep` events), opens the
   *    note overlay immediately without blocking on a progress dialog or disk/cloud persistence, and persists
   *    `savePlanner()` and `StorageAPI.writeNoteContent()` in the background with zero warnings.
   * 2. Regression Target: Reintroducing a blocking `showPlannerNoteGenerationProgress` modal, artificial timer
   *    delays, or synchronous `await savePlanner()` / `writeNoteContent()` before opening the note overlay.
   * 3. Coverage Overlap / Redundancy: None; existing planner tests do not assert instant in-memory opening
   *    with background persistence and zero warnings during `openNoteForEvent()`.
   * 4. Production Code Footprint: None; exercises production `openNoteForEvent()`.
   */
  it('opens note immediately in memory without progress modal and persists event/prep links in background without warnings', async () => {
    const callEvent = {
      id: 'ev-call-1',
      type: 'call',
      title: 'Client Architecture Call',
      date: '2026-11-04',
      startTime: '10:00',
      endTime: '11:00',
      group_tags: ['Client'],
      major_topic_tags: ['Architecture'],
      topic_tags: ['Sync']
    };
    const prepEvent = {
      id: 'ev-prep-1',
      type: 'prep',
      prepForEventId: 'ev-call-1',
      title: 'Prep: Client Architecture Call',
      date: '2026-11-04',
      startTime: '09:30',
      endTime: '10:00'
    };
    globalThis.plannerEvents = [callEvent, prepEvent];

    const warnSpy = vi.spyOn(console, 'warn');
    const errorSpy = vi.spyOn(console, 'error');
    const showProgressSpy = vi.fn();
    globalThis.showPlannerNoteGenerationProgress = showProgressSpy;

    const writeNoteSpy = vi.spyOn(StorageAPI, 'writeNoteContent').mockResolvedValue(true);
    vi.spyOn(StorageAPI, 'writeNotesManifest').mockResolvedValue(true);
    vi.spyOn(StorageAPI, 'writeNotesManifestJS').mockResolvedValue(true);
    vi.spyOn(StorageAPI, 'writeMetadataBuffer').mockResolvedValue(true);

    let savePlannerResolvedBeforeOverlay = false;
    globalThis.savePlanner = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 10));
      savePlannerResolvedBeforeOverlay = true;
    });

    let cachedHtmlAtOpen = null;
    globalThis.openNoteOverlay = vi.fn((notePath) => {
      expect(savePlannerResolvedBeforeOverlay).toBe(false);
      cachedHtmlAtOpen = StorageAPI.getNoteFromCache(notePath);
    });

    await openNoteForEvent(callEvent);

    expect(showProgressSpy).not.toHaveBeenCalled();
    expect(callEvent.noteId).toBeTruthy();
    expect(callEvent.linkedNoteIds).toEqual([callEvent.noteId]);
    expect(prepEvent.noteId).toBe(callEvent.noteId);
    expect(prepEvent.linkedNoteIds).toEqual([callEvent.noteId]);
    expect(globalThis.openNoteOverlay).toHaveBeenCalledTimes(1);
    expect(cachedHtmlAtOpen).toContain('Client Architecture Call');
    expect(writeNoteSpy).toHaveBeenCalledTimes(1);

    // Wait for background persistence to settle
    await new Promise((r) => setTimeout(r, 25));
    expect(globalThis.savePlanner).toHaveBeenCalledTimes(1);
    expect(savePlannerResolvedBeforeOverlay).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  /**
   * 1. Protected Behavior: Concurrent `saveTodosManifest()` calls are serialized so an overlapping save
   *    with a deletion (`deletedIds`) never races with an earlier in-flight save and resurrects the deleted todo.
   * 2. Regression Target: Concurrent `readTodosManifest()` -> `writeTodosManifest()` calls interleaving and
   *    clobbering deletions or updates made by the other call.
   * 3. Coverage Overlap / Redundancy: None; no existing test verifies `saveTodosManifest()` serialization.
   * 4. Production Code Footprint: None; exercises authentic `saveTodosManifest()` contract.
   */
  it('serializes concurrent saveTodosManifest calls so deletions are not clobbered by in-flight saves', async () => {
    let persistedTodos = [
      { id: 'todo-keep', title: 'Keep me', priority: 'Medium', status: 'todo' },
      { id: 'todo-del', title: 'Delete me', priority: 'Low', status: 'todo' }
    ];
    globalThis.todosManifest = persistedTodos.map(t => ({ ...t }));

    vi.spyOn(StorageAPI, 'readTodosManifest').mockImplementation(async () => {
      await new Promise(r => setTimeout(r, 8));
      return persistedTodos.map(t => ({ ...t }));
    });
    const writeSpy = vi.spyOn(StorageAPI, 'writeTodosManifest').mockImplementation(async (next) => {
      await new Promise(r => setTimeout(r, 10));
      persistedTodos = next.map(t => ({ ...t }));
    });

    const p1 = saveTodosManifest();
    globalThis.todosManifest = globalThis.todosManifest.filter(t => t.id !== 'todo-del');
    const p2 = saveTodosManifest({ deletedIds: ['todo-del'] });

    await Promise.all([p1, p2]);

    expect(writeSpy).toHaveBeenCalledTimes(2);
    expect(persistedTodos.map(t => t.id)).toEqual(['todo-keep']);
  });

  /**
   * 1. Protected Behavior: `writeFile()` coalesces concurrent pending writes to the same file path so a burst of writes
   *    while one write is in flight executes at most 2 physical disk writes (the in-flight write + 1 coalesced write with
   *    the latest content) and resolves all callers once the latest payload is persisted.
   * 2. Regression Target: Unbounded sequential write chaining in `_writeQueues` causing O(K) slow `createWritable/close`
   *    disk operations for obsolete intermediate JSON snapshots.
   * 3. Coverage Overlap / Redundancy: None; no existing test verifies write queue coalescing under concurrent load.
   * 4. Production Code Footprint: None; exercises production `writeFile()` via `window.AppBridge.fs.writeFile`.
   */
  it('coalesces burst of concurrent writeFile calls for the same path into a single follow-up disk write with latest content', async () => {
    const physicalWrites = [];
    const origBridge = window.AppBridge;
    window.AppBridge = {
      fs: {
        hasNativeFS: () => true,
        writeFile: vi.fn(async (pathStr, content) => {
          await new Promise((r) => setTimeout(r, 20));
          physicalWrites.push({ pathStr, content });
          return true;
        })
      }
    };

    try {
      const p1 = writeFile('notes/metadata-buffer.json', '{"v":1}');
      const p2 = writeFile('notes/metadata-buffer.json', '{"v":2}');
      const p3 = writeFile('notes/metadata-buffer.json', '{"v":3}');
      const p4 = writeFile('notes/metadata-buffer.json', '{"v":4}');
      const p5 = writeFile('notes/metadata-buffer.json', '{"v":5}');

      await Promise.all([p1, p2, p3, p4, p5]);

      expect(physicalWrites).toHaveLength(2);
      expect(physicalWrites[0]).toEqual({ pathStr: 'notes/metadata-buffer.json', content: '{"v":1}' });
      expect(physicalWrites[1]).toEqual({ pathStr: 'notes/metadata-buffer.json', content: '{"v":5}' });
    } finally {
      window.AppBridge = origBridge;
    }
  });

  /**
   * 1. Protected Behavior: `saveManifest({ force: true })` updates in-memory metadata indexes synchronously before I/O
   *    awaits, dispatches `writeNotesManifest`, `writeNotesManifestJS`, and `writeMetadataBuffer` in parallel, and
   *    coalesces overlapping `saveManifest({ force: true })` calls into at most 2 flushes.
   * 2. Regression Target: Sequential 3-file waiting in `_doSaveManifestDirect()` and overlapping uncoalesced full-manifest
   *    disk flushes stalling the UI at 75%.
   * 3. Coverage Overlap / Redundancy: None; first test validating parallel dispatch and single-flight coalescing of
   *    `_doSaveManifestDirect()`.
   * 4. Production Code Footprint: None; exercises production `saveManifest()`.
   */
  it('updates indexes synchronously, dispatches manifest/buffer writes in parallel, and coalesces concurrent saveManifest calls', async () => {
    let manifestWriteCount = 0;
    let bufferWriteCount = 0;
    let inFlightManifestWrites = 0;
    let parallelObserved = false;

    vi.spyOn(StorageAPI, 'writeNotesManifest').mockImplementation(async () => {
      manifestWriteCount += 1;
      inFlightManifestWrites += 1;
      await new Promise((r) => setTimeout(r, 25));
      inFlightManifestWrites -= 1;
    });
    vi.spyOn(StorageAPI, 'writeNotesManifestJS').mockResolvedValue(true);
    vi.spyOn(StorageAPI, 'writeMetadataBuffer').mockImplementation(async () => {
      bufferWriteCount += 1;
      if (inFlightManifestWrites > 0) {
        parallelObserved = true;
      }
      await new Promise((r) => setTimeout(r, 25));
    });

    globalThis.manifest = [
      { id: 'note-sync-1', path: 'notes/note-sync-1.html', title: 'Sync 1', date: '2026-11-04' }
    ];

    const s1 = saveManifest({ force: true });
    // Synchronous index update before async disk I/O finishes:
    expect(getNoteById('note-sync-1')?.title).toBe('Sync 1');

    // Trigger 3 more force saves while s1 is in flight
    globalThis.manifest.push({ id: 'note-sync-2', path: 'notes/note-sync-2.html', title: 'Sync 2', date: '2026-11-04' });
    const s2 = saveManifest({ force: true });
    globalThis.manifest.push({ id: 'note-sync-3', path: 'notes/note-sync-3.html', title: 'Sync 3', date: '2026-11-04' });
    const s3 = saveManifest({ force: true });
    const s4 = saveManifest({ force: true });

    await Promise.all([s1, s2, s3, s4]);

    expect(parallelObserved).toBe(true);
    expect(manifestWriteCount).toBe(2);
    expect(bufferWriteCount).toBe(2);
    expect(getNoteById('note-sync-3')?.title).toBe('Sync 3');
  });

  /**
   * 1. Protected Behavior: `StorageAPI.writeNotesManifest()` persists a Tier-1 copy in `VaultIDBStorage` (`meta` store)
   *    and `StorageAPI.readNotesManifest()` reconciles any Tier-1 cached entries missing from `notes/manifest.json`.
   * 2. Regression Target: Losing newly linked planner notes on startup if the app was reloaded after Tier-1 persistence
   *    but before the local filesystem `notes/manifest.json` stream finished closing.
   * 3. Coverage Overlap / Redundancy: None; tests Tier-1 IndexedDB manifest recovery in filesystem mode.
   * 4. Production Code Footprint: None; exercises `StorageAPI.writeNotesManifest` and `StorageAPI.readNotesManifest`.
   */
  it('recovers newly written manifest entries from Tier-1 VaultIDBStorage if disk manifest.json was behind', async () => {
    vi.spyOn(StorageAPI, '_writeJSON').mockResolvedValue(true);

    const fullManifest = [
      { id: 'note-disk-1', path: 'notes/note-disk-1.html', title: 'On Disk' },
      { id: 'note-tier1-only', path: 'notes/note-tier1-only.html', title: 'Saved In Tier 1 Before Reload' }
    ];
    await StorageAPI.writeNotesManifest(fullManifest);

    // Simulate reload where note HTML is present on disk/cache, but disk `notes/manifest.json` only had the first entry
    StorageAPI.clearNoteCache();
    StorageAPI._noteCache.set('notes/note-tier1-only.html', '<p>Saved note HTML</p>');
    vi.spyOn(StorageAPI, '_readJSON').mockResolvedValue([
      { id: 'note-disk-1', path: 'notes/note-disk-1.html', title: 'On Disk' }
    ]);

    const recovered = await StorageAPI.readNotesManifest();
    expect(recovered.map((n) => n.id)).toEqual(['note-disk-1', 'note-tier1-only']);
  });
});
