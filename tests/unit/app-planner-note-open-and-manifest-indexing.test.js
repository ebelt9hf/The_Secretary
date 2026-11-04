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
   * 1. Protected Behavior: `openNoteForEvent()` links both `event.noteId` and `event.linkedNoteIds` (and propagates to
   *    linked `prep` events), awaits `savePlanner()`, closes the progress dialog, and opens the note overlay.
   * 2. Regression Target: Failing to populate `event.linkedNoteIds` on regular planner events or leaving `savePlanner()`
   *    unawaited before opening the note overlay.
   * 3. Coverage Overlap / Redundancy: None; existing planner tests do not assert `linkedNoteIds` and `prep` propagation
   *    during `openNoteForEvent()` on-demand note creation.
   * 4. Production Code Footprint: None; exercises production `openNoteForEvent()`.
   */
  it('links noteId and linkedNoteIds on event and prep blocks and awaits savePlanner in openNoteForEvent', async () => {
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

    const closeProgressSpy = vi.fn();
    closeProgressSpy.updateStage = vi.fn();
    globalThis.showPlannerNoteGenerationProgress = vi.fn(() => closeProgressSpy);

    vi.spyOn(StorageAPI, 'writeNoteContent').mockResolvedValue(true);
    vi.spyOn(StorageAPI, 'writeNotesManifest').mockResolvedValue(true);
    vi.spyOn(StorageAPI, 'writeNotesManifestJS').mockResolvedValue(true);
    vi.spyOn(StorageAPI, 'writeMetadataBuffer').mockResolvedValue(true);

    let savePlannerResolvedBeforeOverlay = false;
    globalThis.savePlanner = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
      savePlannerResolvedBeforeOverlay = true;
    });
    globalThis.openNoteOverlay = vi.fn(() => {
      expect(savePlannerResolvedBeforeOverlay).toBe(true);
    });

    await openNoteForEvent(callEvent);

    expect(callEvent.noteId).toBeTruthy();
    expect(callEvent.linkedNoteIds).toEqual([callEvent.noteId]);
    expect(prepEvent.noteId).toBe(callEvent.noteId);
    expect(prepEvent.linkedNoteIds).toEqual([callEvent.noteId]);
    expect(globalThis.savePlanner).toHaveBeenCalledTimes(1);
    expect(globalThis.openNoteOverlay).toHaveBeenCalledTimes(1);
    expect(closeProgressSpy).toHaveBeenCalledTimes(1);
  });
});
