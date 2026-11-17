import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Orphan Note Recovery (Local, Firebase, IndexedDB, Memory), Duplicate Detection & User Finalization', () => {
  beforeAll(() => {
    globalThis.window = globalThis.window || globalThis;
    globalThis.escH = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    globalThis.escA = (s) => String(s || '');
    globalThis.jq = (s) => JSON.stringify(String(s || ''));
    globalThis.toast = vi.fn();
    globalThis.syncPreview = vi.fn();
    globalThis.scheduleAutoSave = vi.fn();
    globalThis.openModal = vi.fn((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.style.display = 'flex';
        el.classList.add('active');
      }
    });
    globalThis.closeModal = vi.fn((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.style.display = 'none';
        el.classList.remove('active');
      }
    });
    globalThis.broadcastSync = vi.fn();
    globalThis.saveLocalSettings = vi.fn();
    globalThis.saveFolderSettingsDebounced = vi.fn();
    globalThis.renderPrefs = vi.fn();
    globalThis.renderBoard = vi.fn();
    globalThis.setAppLanguage = vi.fn();
    globalThis.rebuildIndexHTML = vi.fn().mockResolvedValue(true);
    globalThis.renderFilterChips = vi.fn();
    globalThis.openNoteOverlay = vi.fn().mockResolvedValue(true);
    globalThis.switchTab = vi.fn();
    globalThis.savePlanner = vi.fn().mockResolvedValue(true);
    globalThis.renderPlanner = vi.fn();
    globalThis.renderPlannerInspector = vi.fn();

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
      'js/app-notes.js'
    ]);
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '<div id="note-edit-overlay" style="display:none;"></div>';
    StorageAPI.clearNoteCache();
    StorageAPI.setStorageEngine('filesystem');
    globalThis.manifest = [];
    globalThis.metadataBuffer = [];
    globalThis.metadataById = new Map();
    globalThis.metadataByPath = new Map();
    globalThis.plannerEvents = [];
    globalThis.rootHandle = null;
    globalThis.openNoteOverlay = vi.fn().mockResolvedValue(true);
    globalThis.savePlanner = vi.fn().mockResolvedValue(true);
    globalThis.renderPlanner = vi.fn();
    globalThis.renderPlannerInspector = vi.fn();
    globalThis.renderBoard = vi.fn();
    globalThis.renderFilterChips = vi.fn();
    globalThis.rebuildIndexHTML = vi.fn().mockResolvedValue(true);
    globalThis.toast = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    globalThis.rootHandle = null;
  });

  /**
   * 1. Protected Behavior: `rebuildAll()` stages unregistered notes from local disk, IndexedDB, and memory cache
   *    WITHOUT mutating `manifest` or writing to disk until the user explicitly finalizes them in the modal.
   * 2. Regression Target: Auto-merging orphan notes into `manifest` before user review/confirmation.
   * 3. Coverage Overlap / Redundancy: None; verifies staging-only behavior of `rebuildAll()` and explicit user merge.
   * 4. Production Code Footprint: None; exercises `rebuildAll()`, `finalizeRecoveredNote()`, and `getNoteById()`.
   */
  it('stages recovered notes from disk, IndexedDB, and memory without modifying manifest until user finalizes', async () => {
    globalThis.rootHandle = { name: 'workspace' };

    const diskHtml = `<!DOCTYPE html><html><head><title>Disk Orphan</title><meta name="note-id" content="note-disk-1"><meta name="date" content="2026-11-15"></head><body><main><p>Disk body</p></main></body></html>`;
    const idbHtml = `<!DOCTYPE html><html><head><title>IDB Orphan</title><meta name="note-id" content="note-idb-1"><meta name="date" content="2026-11-16"></head><body><main><p>IDB body</p></main></body></html>`;
    const memHtml = `<!DOCTYPE html><html><head><title>Memory Orphan</title><meta name="note-id" content="note-mem-1"><meta name="date" content="2026-11-17"></head><body><main><p>Mem body</p></main></body></html>`;

    vi.spyOn(StorageAPI, 'listNoteFiles').mockResolvedValue(['notes/note-disk-1.html']);
    vi.spyOn(StorageAPI, 'readNoteContent').mockImplementation(async (p) => (p === 'notes/note-disk-1.html' ? diskHtml : ''));
    const writeNoteSpy = vi.spyOn(StorageAPI, 'writeNoteContent').mockResolvedValue(true);
    vi.spyOn(StorageAPI, 'writeNotesManifest').mockResolvedValue(true);
    vi.spyOn(StorageAPI, 'writeMetadataBuffer').mockResolvedValue(true);
    vi.spyOn(StorageAPI, 'writeNotesManifestJS').mockResolvedValue(true);

    vi.spyOn(VaultIDBStorage, 'getAllNotes').mockResolvedValue([
      { id: 'note-idb-1', path: 'notes/note-idb-1.html', title: 'IDB Orphan', date: '2026-11-16', contentHtml: idbHtml }
    ]);
    StorageAPI._noteCache.set('notes/note-mem-1.html', memHtml);

    const staged = await rebuildAll();

    expect(staged).toHaveLength(3);
    // Manifest must remain empty until user explicitly merges/assigns
    expect(globalThis.manifest).toHaveLength(0);
    expect(getNoteById('note-disk-1')).toBeNull();
    expect(writeNoteSpy).not.toHaveBeenCalled();

    const modal = document.getElementById('recovered-notes-modal');
    expect(modal).not.toBeNull();
    expect(modal.classList.contains('active')).toBe(true);
    expect(modal.querySelectorAll('.recovered-note-row')).toHaveLength(3);

    // User explicitly merges the IDB note
    await finalizeRecoveredNote('note-idb-1');
    expect(getNoteById('note-idb-1')?.date).toBe('2026-11-16');
    expect(writeNoteSpy).toHaveBeenCalledWith('notes/note-idb-1.html', idbHtml);
    expect(getNoteById('note-disk-1')).toBeNull();
  });

  /**
   * 1. Protected Behavior: `rebuildAll()` handles malformed, empty, non-note, unreadable, encrypted, and deleted
   *    files/records gracefully, removes missing local files from `manifest`, and falls back to `<h1>` or filename
   *    when `<title>` or `<meta name="note-id">` are missing.
   * 2. Regression Target: Crashing or aborting `rebuildAll()` on corrupt HTML, `readNoteContent` rejection, locked
   *    encrypted IDB records, or non-note entries in `_noteCache`.
   * 3. Coverage Overlap / Redundancy: None; covers all malformed-input and error-resilience edge cases.
   * 4. Production Code Footprint: None; exercises `rebuildAll()` and `parseNoteHTML()`.
   */
  it('handles malformed HTML, empty files, read errors, encrypted/deleted IDB records, and missing disk files safely', async () => {
    globalThis.rootHandle = { name: 'workspace' };

    // Seed manifest with one existing file and one deleted-on-disk file
    globalThis.manifest = [
      { id: 'note-still-here', path: 'notes/note-still-here.html', title: 'Still Here', date: '2026-11-10' },
      { id: 'note-missing-disk', path: 'notes/note-missing-disk.html', title: 'Deleted On Disk', date: '2026-11-11' }
    ];
    syncMetadataIndexes();

    const files = {
      'notes/note-still-here.html': '<html><head><title>Still Here</title></head><body><main><p>ok</p></main></body></html>',
      'notes/empty.html': '   \n\t  ',
      'notes/nav-only.html': '<html><body><nav><a href="../app.html">Back</a></nav></body></html>',
      'notes/broken-html.html': '<html><head><title>Broken',
      'notes/no-meta-fallback.html': '<html><body><main><h1>Heading Fallback</h1><p>Body</p></main></body></html>',
      'notes/filename-fallback.html': '<html><body><main><p>No heading or title</p></main></body></html>',
      'notes/unreadable.html': '__THROW__'
    };

    vi.spyOn(StorageAPI, 'listNoteFiles').mockResolvedValue(Object.keys(files));
    vi.spyOn(StorageAPI, 'readNoteContent').mockImplementation(async (p) => {
      if (files[p] === '__THROW__') throw new Error('EIO: read failure');
      return files[p] ?? '';
    });
    vi.spyOn(StorageAPI, 'writeNotesManifest').mockResolvedValue(true);
    vi.spyOn(StorageAPI, 'writeMetadataBuffer').mockResolvedValue(true);
    vi.spyOn(StorageAPI, 'writeNotesManifestJS').mockResolvedValue(true);

    // Locked/undecryptable IDB record and deleted IDB record should both be skipped
    vi.spyOn(VaultIDBStorage, 'getAllNotes').mockResolvedValue([
      { id: 'note-locked-idb', ciphertext: 'abc123', updatedAt: Date.now() },
      { id: 'note-deleted-idb', deleted: true, title: 'Deleted', contentHtml: '<main><p>x</p></main>' }
    ]);

    // Non-note entries in _noteCache should be ignored
    StorageAPI._noteCache.set('notes/manifest.json', '[]');
    StorageAPI._noteCache.set('planner.json', '{"events":[]}');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const staged = await rebuildAll();

    // Missing disk file pruned from manifest
    expect(getNoteById('note-missing-disk')).toBeNull();
    expect(getNoteById('note-still-here')).not.toBeNull();

    // Only the two valid fallback notes should be staged
    const titles = staged.map((s) => s.note.title).sort();
    expect(titles).toEqual(['Heading Fallback', 'filename-fallback']);
    expect(staged.every((s) => Boolean(s.note.id))).toBe(true);
    expect(warnSpy).toHaveBeenCalled();
  });

  /**
   * 1. Protected Behavior: `findRecoveredNoteDuplicate()` flags a recovered note as a duplicate when an existing
   *    note has the same normalized title, same date, and is within the 30-minute rough time window, while NOT
   *    flagging notes on different dates, different titles, or >30 minutes apart; `finalizeAllNonDuplicateRecoveredNotes()`
   *    merges only non-duplicates.
   * 2. Regression Target: Duplicate notes being merged silently or non-duplicates being falsely flagged as duplicates.
   * 3. Coverage Overlap / Redundancy: None; covers all duplicate-detection boundaries and selective bulk merge.
   * 4. Production Code Footprint: None; exercises `findRecoveredNoteDuplicate()`, `rebuildAll()`, and `finalizeAllNonDuplicateRecoveredNotes()`.
   */
  it('flags same-title same-date notes within 30 minutes as duplicates and skips them on bulk merge', async () => {
    const baseTime = Date.parse('2026-11-17T10:00:00.000Z');
    globalThis.manifest = [
      {
        id: 'note-orig-1',
        path: 'notes/note-orig-1.html',
        title: 'Weekly Product Sync',
        date: '2026-11-17',
        modified: new Date(baseTime).toISOString()
      }
    ];
    syncMetadataIndexes();

    // 1. Same title (different case/spacing), same date, 10 min later -> DUPLICATE
    const dupCandidate = {
      id: 'note-dup-1',
      path: 'notes/note-dup-1.html',
      title: '  weekly  product sync ',
      date: '2026-11-17',
      modified: new Date(baseTime + 10 * 60 * 1000).toISOString()
    };
    // 2. Same title, same date, 6 hours later -> NOT duplicate
    const farTimeCandidate = {
      id: 'note-far-1',
      path: 'notes/note-far-1.html',
      title: 'Weekly Product Sync',
      date: '2026-11-17',
      modified: new Date(baseTime + 6 * 60 * 60 * 1000).toISOString()
    };
    // 3. Same title, different date -> NOT duplicate
    const diffDateCandidate = {
      id: 'note-diffdate-1',
      path: 'notes/note-diffdate-1.html',
      title: 'Weekly Product Sync',
      date: '2026-11-18',
      modified: new Date(baseTime + 24 * 60 * 60 * 1000).toISOString()
    };

    expect(findRecoveredNoteDuplicate(dupCandidate, globalThis.manifest)).toEqual(
      expect.objectContaining({ id: 'note-orig-1', timeDiffMinutes: 10 })
    );
    expect(findRecoveredNoteDuplicate(farTimeCandidate, globalThis.manifest)).toBeNull();
    expect(findRecoveredNoteDuplicate(diffDateCandidate, globalThis.manifest)).toBeNull();

    // Run full rebuildAll with these in IndexedDB and test modal + bulk merge
    vi.spyOn(StorageAPI, 'writeNoteContent').mockResolvedValue(true);
    vi.spyOn(StorageAPI, 'writeNotesManifest').mockResolvedValue(true);
    vi.spyOn(StorageAPI, 'writeMetadataBuffer').mockResolvedValue(true);
    vi.spyOn(StorageAPI, 'writeNotesManifestJS').mockResolvedValue(true);
    vi.spyOn(VaultIDBStorage, 'getAllNotes').mockResolvedValue([
      { ...dupCandidate, contentHtml: '<main><p>dup</p></main>' },
      { ...farTimeCandidate, contentHtml: '<main><p>far</p></main>' }
    ]);

    const staged = await rebuildAll();
    expect(staged).toHaveLength(2);
    expect(staged.find((s) => s.note.id === 'note-dup-1')?.duplicateOf).not.toBeNull();
    expect(staged.find((s) => s.note.id === 'note-far-1')?.duplicateOf).toBeNull();

    const dupBadges = document.querySelectorAll('.recovered-note-duplicate-badge');
    expect(dupBadges).toHaveLength(1);

    // Bulk merge should merge only the non-duplicate note
    const mergedCount = await finalizeAllNonDuplicateRecoveredNotes();
    expect(mergedCount).toBe(1);
    expect(getNoteById('note-far-1')).not.toBeNull();
    expect(getNoteById('note-dup-1')).toBeNull();
  });

  /**
   * 1. Protected Behavior: In `firebase` storage engine mode, `rebuildAll()` scans `FirebaseSyncService.getAllNotes()`
   *    without calling `StorageAPI.listNoteFiles()` or wiping existing `manifest` entries, and stages unregistered cloud notes.
   * 2. Regression Target: `rebuildAll()` calling `listNoteFiles()` in Firebase mode (which returns `[]`) and wiping `manifest`.
   * 3. Coverage Overlap / Redundancy: None; covers Firebase mode in `rebuildAll()`.
   * 4. Production Code Footprint: None; exercises production `rebuildAll()`.
   */
  it('stages unregistered Firebase notes without wiping manifest when storage engine is firebase', async () => {
    StorageAPI.setStorageEngine('firebase');
    globalThis.manifest = [
      { id: 'note-existing-fb', path: 'notes/note-existing-fb.html', title: 'Existing Cloud Note', date: '2026-11-10' }
    ];
    syncMetadataIndexes();

    const listSpy = vi.spyOn(StorageAPI, 'listNoteFiles').mockResolvedValue([]);
    vi.spyOn(VaultIDBStorage, 'getAllNotes').mockResolvedValue([]);

    window.FirebaseSyncService.state = { isUnlocked: true, localCache: new Map() };
    vi.spyOn(window.FirebaseSyncService, 'getAllNotes').mockResolvedValue([
      { id: 'note-existing-fb', title: 'Existing Cloud Note', date: '2026-11-10', contentHtml: '<main><p>ok</p></main>' },
      { id: 'note-orphan-fb', title: 'Unregistered Cloud Note', date: '2026-11-17', contentHtml: '<main><p>cloud orphan</p></main>' }
    ]);

    const staged = await rebuildAll();

    expect(listSpy).not.toHaveBeenCalled();
    expect(getNoteById('note-existing-fb')).not.toBeNull();
    expect(staged).toHaveLength(1);
    expect(staged[0].note.id).toBe('note-orphan-fb');
    expect(staged[0].source).toBe('firebase');
    // Still staged, not merged yet
    expect(getNoteById('note-orphan-fb')).toBeNull();
  });

  /**
   * 1. Protected Behavior: `previewRecoveredNoteReadOnly()` opens the staged note in read-only mode
   *    (`viewMode: true, sameWindow: true, previewOnly: true, previewHtml`) above `#recovered-notes-modal`.
   * 2. Regression Target: Clicking a recovered note opening in edit mode, auto-merging into `manifest`, or rendering underneath the modal.
   * 3. Coverage Overlap / Redundancy: None; tests read-only preview from the recovery modal.
   * 4. Production Code Footprint: None; exercises `previewRecoveredNoteReadOnly()`.
   */
  it('opens staged recovered note in read-only view without auto-merging it', async () => {
    const html = '<!DOCTYPE html><html><head><title>Preview Only</title><meta name="note-id" content="note-prev-1"></head><body><main><p>Preview body</p></main></body></html>';
    StorageAPI._noteCache.set('notes/note-prev-1.html', html);
    vi.spyOn(VaultIDBStorage, 'getAllNotes').mockResolvedValue([]);

    await rebuildAll();
    await previewRecoveredNoteReadOnly('notes/note-prev-1.html');

    expect(globalThis.openNoteOverlay).toHaveBeenCalledWith(
      'notes/note-prev-1.html',
      null,
      null,
      false,
      null,
      { viewMode: true, sameWindow: true, previewOnly: true, previewHtml: html }
    );
    expect(document.getElementById('note-edit-overlay').style.zIndex).toBe('10001');
    expect(getNoteById('note-prev-1')).toBeNull();
  });

  /**
   * 1. Protected Behavior: `assignRecoveredNoteToBloc()` finalizes the staged note into `manifest`, links it to
   *    the selected bloc (and linked prep blocs), copies the bloc's tags and workstream onto the note, and persists.
   * 2. Regression Target: Assigning a staged note to a bloc failing to finalize it, transfer tags/workstream, or save planner.
   * 3. Coverage Overlap / Redundancy: None; tests bloc assignment & tag inheritance from the recovery modal.
   * 4. Production Code Footprint: None; exercises `openRecoveredNotesModal()` and `assignRecoveredNoteToBloc()`.
   */
  it('finalizes staged note when assigned to a calendar bloc and inherits bloc tags and workstream', async () => {
    const rawNoteHtml = '<!DOCTYPE html><html><head><title>Recovered Sync Note</title><meta name="note-id" content="note-rec-1"><meta name="date" content="2026-11-17"></head><body><main><p>Notes</p></main></body></html>';
    vi.spyOn(VaultIDBStorage, 'getAllNotes').mockResolvedValue([
      { id: 'note-rec-1', path: 'notes/note-rec-1.html', title: 'Recovered Sync Note', date: '2026-11-17', contentHtml: rawNoteHtml }
    ]);

    const bloc = {
      id: 'evt-bloc-1',
      type: 'sync',
      title: 'Weekly Sync',
      date: '2026-11-17',
      startTime: '14:00',
      endTime: '15:00',
      group_tags: ['Engineering'],
      major_topic_tags: ['Platform'],
      topic_tags: ['Sync'],
      workstream: 'Core'
    };
    const prepBloc = {
      id: 'evt-prep-1',
      type: 'prep',
      prepForEventId: 'evt-bloc-1',
      title: 'Prep Weekly Sync',
      date: '2026-11-17',
      startTime: '13:30',
      endTime: '14:00'
    };
    globalThis.plannerEvents = [bloc, prepBloc];

    vi.spyOn(StorageAPI, 'writeNoteContent').mockResolvedValue(true);
    vi.spyOn(StorageAPI, 'writeNotesManifest').mockResolvedValue(true);
    vi.spyOn(StorageAPI, 'writeMetadataBuffer').mockResolvedValue(true);
    vi.spyOn(StorageAPI, 'writeNotesManifestJS').mockResolvedValue(true);

    await rebuildAll();
    expect(getNoteById('note-rec-1')).toBeNull();

    const selectEl = document.getElementById('recovered-bloc-select-0');
    expect(selectEl).not.toBeNull();
    selectEl.value = 'evt-bloc-1';

    const ok = await assignRecoveredNoteToBloc('note-rec-1', 'recovered-bloc-select-0', 'recovered-note-row-0');
    expect(ok).toBe(true);
    expect(bloc.noteId).toBe('note-rec-1');
    expect(prepBloc.noteId).toBe('note-rec-1');

    const updatedNote = getNoteById('note-rec-1');
    expect(updatedNote).not.toBeNull();
    expect(updatedNote.group_tags).toEqual(['Engineering']);
    expect(updatedNote.major_topic_tags).toEqual(['Platform']);
    expect(updatedNote.topic_tags).toEqual(['Sync']);
    expect(updatedNote.workstream).toBe('Core');
    expect(globalThis.savePlanner).toHaveBeenCalled();
    expect(globalThis.renderPlanner).toHaveBeenCalled();
    expect(globalThis.renderPlannerInspector).toHaveBeenCalled();

    const statusBadge = document.querySelector('#recovered-note-row-0 .recovered-note-status');
    expect(statusBadge.style.display).toBe('inline-block');
  });
});
