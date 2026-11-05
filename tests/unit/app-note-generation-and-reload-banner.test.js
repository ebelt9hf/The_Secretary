import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Note Generation Progress Localization & Editor Reload Banner Isolation', () => {
  beforeAll(() => {
    globalThis.window = globalThis.window || globalThis;
    globalThis.escH = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    globalThis.escA = (s) => String(s || '');
    globalThis.toast = vi.fn();
    globalThis.syncPreview = vi.fn();
    globalThis.broadcastSync = vi.fn();
    globalThis.rebuildIndexHTML = vi.fn().mockResolvedValue(true);
    globalThis.savePlanner = vi.fn().mockResolvedValue(true);
    globalThis.renderPlanner = vi.fn();
    globalThis.renderFilterChips = vi.fn();
    globalThis.saveManifest = vi.fn().mockResolvedValue(true);
    globalThis.upsertManifest = vi.fn();

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
      'js/app-planner.js',
      'js/app-overlay.js',
      'js/app-init.js'
    ]);
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    StorageAPI.clearNoteCache();
    StorageAPI.setStorageEngine('filesystem');
    globalThis.rootHandle = { kind: 'directory', name: 'vault' };
    globalThis._isFocusedMode = false;
    globalThis._lastFocusedNoteRefreshAt = 0;
    globalThis._lastNoteSelfSavedAt = 0;
    globalThis.currentNote = null;
    globalThis.manifest = [];
    globalThis.plannerEvents = [];

    const createMockElement = (id, overrides = {}) => ({
      id,
      innerHTML: '',
      value: '',
      style: {},
      classList: {
        add: vi.fn(),
        remove: vi.fn(),
        contains: vi.fn(() => false)
      },
      setAttribute: vi.fn(),
      getAttribute: vi.fn(() => null),
      removeAttribute: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      closest: vi.fn(() => null),
      querySelector: vi.fn(() => null),
      querySelectorAll: vi.fn(() => []),
      ...overrides
    });

    const bannerClasses = new Set();
    const mockBanner = createMockElement('overlay-reload-banner', {
      classList: {
        add: vi.fn((cls) => bannerClasses.add(cls)),
        remove: vi.fn((cls) => bannerClasses.delete(cls)),
        contains: vi.fn((cls) => bannerClasses.has(cls))
      }
    });

    const mockOverlay = createMockElement('note-edit-overlay', {
      style: { display: 'flex' }
    });

    const mockTextarea = createMockElement('edit-textarea', {
      innerHTML: '<p>User active editing text</p>',
      value: '<p>User active editing text</p>'
    });

    const mockTitle = createMockElement('edit-title', {
      value: 'My Note Title'
    });

    const mockDate = createMockElement('edit-date', {
      value: '2026-11-05'
    });

    const mockSummary = createMockElement('edit-summary', {
      innerHTML: '<p>Summary</p>'
    });

    const mockPanel = createMockElement('overlay-panel');

    const elements = new Map([
      ['overlay-reload-banner', mockBanner],
      ['note-edit-overlay', mockOverlay],
      ['edit-textarea', mockTextarea],
      ['edit-title', mockTitle],
      ['edit-date', mockDate],
      ['edit-summary', mockSummary],
      ['editor-group', createMockElement('editor-group')],
      ['editor-major', createMockElement('editor-major')],
      ['editor-topic', createMockElement('editor-topic')],
      ['editor-extra', createMockElement('editor-extra')]
    ]);

    globalThis.document = {
      getElementById: vi.fn((id) => elements.get(id) || null),
      querySelector: vi.fn((sel) => {
        if (sel === '.overlay-panel') return mockPanel;
        if (sel === '#overlay-reload-banner') return mockBanner;
        return null;
      }),
      querySelectorAll: vi.fn(() => []),
      createElement: vi.fn((tag) => createMockElement(tag)),
      createDocumentFragment: vi.fn(() => ({ appendChild: vi.fn() })),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
      activeElement: null
    };

    globalThis.window.document = globalThis.document;
    globalThis._mockBannerClasses = bannerClasses;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * 1. Protected Behavior: `getPlannerNoteSavingStageText()` selects `planner.savingNoteContentLocal`
   *    ("Saving note content...") when local storage is used (`StorageAPI.getStorageEngine() !== 'firebase'`),
   *    and selects `planner.writingNoteContent` ("Encrypting and saving note content...") when cloud mode is active.
   * 2. Regression Target: Hardcoding `planner.writingNoteContent` ("Chiffrement et enregistrement du contenu de la note...")
   *    during local filesystem note creation, falsely misleading users into believing encryption is failing.
   * 3. Coverage Overlap & Redundancy: None; this is the authoritative test for local vs cloud progress stage text.
   * 4. Production Code Footprint: None; exercises public `getPlannerNoteSavingStageText()` and `StorageAPI.getStorageEngine()`.
   */
  it('selects local saving message on filesystem and encryption message on firebase across languages', () => {
    // English
    setAppLanguage('en');
    StorageAPI.setStorageEngine('filesystem');
    expect(getPlannerNoteSavingStageText()).toBe('Saving note content...');

    StorageAPI.setStorageEngine('firebase');
    expect(getPlannerNoteSavingStageText()).toBe('Encrypting and saving note content...');

    // French
    setAppLanguage('fr');
    StorageAPI.setStorageEngine('filesystem');
    expect(getPlannerNoteSavingStageText()).toBe('Enregistrement du contenu de la note...');

    StorageAPI.setStorageEngine('firebase');
    expect(getPlannerNoteSavingStageText()).toBe('Chiffrement et enregistrement du contenu de la note...');

    // Reset language
    setAppLanguage('en');
    StorageAPI.setStorageEngine('filesystem');
  });

  /**
   * 1. Protected Behavior: `refreshOpenNoteIfChanged()` suppresses the external reload warning banner
   *    when the current note was recently saved by this window (`Date.now() - _lastNoteSelfSavedAt < 3000`).
   * 2. Regression Target: Triggering `overlay-reload-banner` ("Updated in another window") immediately after the user's
   *    own editor auto-saved the note and window focus refreshed.
   * 3. Coverage Overlap & Redundancy: None; validates the self-save grace window guard in `refreshOpenNoteIfChanged`.
   * 4. Production Code Footprint: None; exercises authentic `refreshOpenNoteIfChanged` and `_lastNoteSelfSavedAt`.
   */
  it('does not trigger reload warning when note was recently self-saved by the current window', async () => {
    currentNote = {
      id: 'note-1',
      path: 'notes/note-1.html',
      title: 'Note 1',
      originalHTML: '<p>Original text</p>',
      mainHTML: '<p>Original text</p>'
    };

    vi.spyOn(StorageAPI, 'readNoteContent').mockResolvedValue('<p>Updated text from save</p>');

    // Simulate self-save occurred 500ms ago
    _lastNoteSelfSavedAt = Date.now() - 500;
    if (typeof window !== 'undefined') window._lastNoteSelfSavedAt = _lastNoteSelfSavedAt;

    await refreshOpenNoteIfChanged('focus');

    expect(_mockBannerClasses.has('visible')).toBe(false);
  });

  /**
   * 1. Protected Behavior: `refreshOpenNoteIfChanged()` normalizes CRLF and LF line endings and whitespace,
   *    preventing false positive reload banners when disk files use CRLF formatting.
   * 2. Regression Target: False-positive `overlay-reload-banner` triggering due to `\r\n` vs `\n` character differences.
   * 3. Coverage Overlap & Redundancy: None; specifically targets newline normalization in `refreshOpenNoteIfChanged`.
   * 4. Production Code Footprint: None; exercises authentic `refreshOpenNoteIfChanged`.
   */
  it('does not trigger reload warning when disk and in-memory HTML differ only by CRLF line endings', async () => {
    const memoryHTML = '<!DOCTYPE html>\n<html>\n<body><p>Hello world</p></body>\n</html>';
    const diskCRLFHTML = '<!DOCTYPE html>\r\n<html>\r\n<body><p>Hello world</p></body>\r\n</html>\r\n';

    currentNote = {
      id: 'note-crlf',
      path: 'notes/note-crlf.html',
      title: 'CRLF Test',
      originalHTML: memoryHTML,
      mainHTML: '<p>Hello world</p>'
    };

    _lastNoteSelfSavedAt = 0;
    vi.spyOn(StorageAPI, 'readNoteContent').mockResolvedValue(diskCRLFHTML);

    await refreshOpenNoteIfChanged('focus');

    expect(_mockBannerClasses.has('visible')).toBe(false);
  });

  /**
   * 1. Protected Behavior: When note on disk only had metadata or planner tags updated (e.g. from planner sync),
   *    `refreshOpenNoteIfChanged()` silently updates note tags without showing the reload conflict banner.
   * 2. Regression Target: Disrupting active note editing with "Updated in another window" warning when planner
   *    blocks update note tags.
   * 3. Coverage Overlap & Redundancy: None; tests metadata/tag silent reconciliation during active editing.
   * 4. Production Code Footprint: None; exercises authentic `refreshOpenNoteIfChanged` logic.
   */
  it('silently updates tags and suppresses reload banner when only metadata/tags changed on disk', async () => {
    const baseHTML = '<!DOCTYPE html><html><head><title>My Note</title><meta name="group-tags" content="Projects"></head><body><main><p>Same body text</p></main></body></html>';
    const tagUpdatedHTML = '<!DOCTYPE html><html><head><title>My Note</title><meta name="group-tags" content="Projects, Clients"></head><body><main><p>Same body text</p></main></body></html>';

    currentNote = {
      id: 'note-tags',
      path: 'notes/note-tags.html',
      title: 'My Note',
      originalHTML: baseHTML,
      mainHTML: '<p>Same body text</p>',
      group_tags: ['Projects']
    };

    _lastNoteSelfSavedAt = 0;
    vi.spyOn(StorageAPI, 'readNoteContent').mockResolvedValue(tagUpdatedHTML);

    await refreshOpenNoteIfChanged('focus');

    expect(_mockBannerClasses.has('visible')).toBe(false);
    expect(currentNote.group_tags).toContain('Clients');
    expect(currentNote.originalHTML).toBe(tagUpdatedHTML);
  });

  /**
   * 1. Protected Behavior: `refreshOpenNoteIfChanged()` displays the reload banner when the note body or title
   *    was genuinely modified externally on disk.
   * 2. Regression Target: Failing to alert the user when genuine conflicting body edits occurred in another window.
   * 3. Coverage Overlap & Redundancy: None; tests true positive conflict detection.
   * 4. Production Code Footprint: None; exercises authentic `refreshOpenNoteIfChanged`.
   */
  it('displays reload banner when note body content was genuinely modified on disk', async () => {
    const memoryHTML = '<!DOCTYPE html><html><head><title>My Note</title></head><body><main><p>User text</p></main></body></html>';
    const externalHTML = '<!DOCTYPE html><html><head><title>My Note</title></head><body><main><p>External modifications from other device</p></main></body></html>';

    currentNote = {
      id: 'note-conflict',
      path: 'notes/note-conflict.html',
      title: 'My Note',
      originalHTML: memoryHTML,
      mainHTML: '<p>User text</p>'
    };

    _lastNoteSelfSavedAt = 0;
    vi.spyOn(StorageAPI, 'readNoteContent').mockResolvedValue(externalHTML);

    await refreshOpenNoteIfChanged('focus');

    expect(_mockBannerClasses.has('visible')).toBe(true);
  });

  /**
   * 1. Protected Behavior: `handleSyncMessage()` for `NOTE_SAVED` ignores broadcasts when the note was recently
   *    saved by the current window, preventing false positive reload warnings in detached note windows.
   * 2. Regression Target: `handleSyncMessage` immediately marking `overlay-reload-banner` visible on every `NOTE_SAVED`
   *    without checking self-save timestamp or content equivalence.
   * 3. Coverage Overlap & Redundancy: None; tests `handleSyncMessage` broadcast deduplication and self-save suppression.
   * 4. Production Code Footprint: None; exercises authentic `handleSyncMessage`.
   */
  it('ignores NOTE_SAVED sync broadcasts when current note was recently self-saved', async () => {
    currentNote = {
      id: 'note-sync-msg',
      path: 'notes/note-sync-msg.html',
      title: 'Note Sync',
      originalHTML: '<p>Active</p>',
      mainHTML: '<p>Active</p>'
    };

    _lastNoteSelfSavedAt = Date.now() - 400;
    if (typeof window !== 'undefined') window._lastNoteSelfSavedAt = _lastNoteSelfSavedAt;

    await handleSyncMessage({
      data: {
        type: 'NOTE_SAVED',
        noteId: 'note-sync-msg',
        path: 'notes/note-sync-msg.html',
        senderId: 'other-window-broadcast-id',
        msgId: 'msg-123'
      }
    });

    expect(_mockBannerClasses.has('visible')).toBe(false);
  });

  /**
   * 1. Protected Behavior: `StorageAPI.writeNoteContent()` handles queued writes without deadlock when multiple
   *    notes are written, and quarantines items that exceed retry thresholds so subsequent writes proceed cleanly.
   * 2. Regression Target: Queue deadlock where a failed write for note 1 indefinitely stalls note 2 generation.
   * 3. Coverage Overlap & Redundancy: None; tests multi-note queue isolation and timeout/retry resiliency in `StorageAPI`.
   * 4. Production Code Footprint: None; exercises authentic `StorageAPI.writeNoteContent` and `StorageAPI._processSyncQueue`.
   */
  it('processes queued writes cleanly and isolates item errors without permanent queue deadlock', async () => {
    StorageAPI.clearSyncQueue();
    let writtenFiles = [];

    vi.spyOn(globalThis, 'writeFile').mockImplementation(async (pathStr, content) => {
      if (pathStr.includes('failing-note')) {
        throw new Error('Simulated disk error on note 1');
      }
      writtenFiles.push(pathStr);
      return true;
    });

    // Write note 1 (which will fail)
    await expect(StorageAPI.writeNoteContent('notes/failing-note.html', '<p>Fail</p>')).rejects.toThrow('Simulated disk error on note 1');

    // Write note 2 (must succeed and not be blocked by note 1)
    await StorageAPI.writeNoteContent('notes/success-note-2.html', '<p>Success</p>');

    expect(writtenFiles).toContain('notes/success-note-2.html');
  });

  /**
   * 1. Protected Behavior: `StorageAPI` cooperatively supersedes in-flight writes when a newer revision
   *    arrives for the same note, aborting the earlier write signal and allowing the newer revision to save cleanly.
   * 2. Regression Target: In-flight saves blocking or overwriting newer edits, or failing due to arbitrary timeouts.
   * 3. Coverage Overlap & Redundancy: None; specifically tests cooperative AbortController-driven supersession in sync queue.
   * 4. Production Code Footprint: None; exercises authentic `StorageAPI._enqueueSync` and `StorageAPI._processSyncQueue`.
   */
  it('cooperatively supersedes in-flight writes when a newer save arrives for the same note', async () => {
    StorageAPI.clearSyncQueue();

    let unblockFirstWrite;
    const firstWriteStarted = new Promise(r => { unblockFirstWrite = r; });
    let firstWriteSignalAborted = false;

    vi.spyOn(globalThis, 'writeFile').mockImplementation(async (pathStr, content, options) => {
      if (content === '<p>Version 1</p>') {
        await firstWriteStarted;
        if (options?.signal?.aborted) {
          firstWriteSignalAborted = true;
          const abortErr = new Error('The operation was aborted');
          abortErr.name = 'AbortError';
          throw abortErr;
        }
      }
      return true;
    });

    const p1 = StorageAPI.writeNoteContent('notes/supersede-note.html', '<p>Version 1</p>', { id: 'supersede-note' });
    const p2 = StorageAPI.writeNoteContent('notes/supersede-note.html', '<p>Version 2 (Latest)</p>', { id: 'supersede-note' });

    unblockFirstWrite();
    await Promise.all([p1, p2]);

    expect(firstWriteSignalAborted).toBe(true);
    expect(StorageAPI._noteCache.get('notes/supersede-note.html')).toBe('<p>Version 2 (Latest)</p>');
  });

  /**
   * 1. Protected Behavior: When writing to disk connector fails (e.g. disk locked, EBUSY, permission error),
   *    `StorageAPI` automatically preserves the unpersisted changes by creating an emergency snapshot in `.history/`.
   * 2. Regression Target: Total data loss when disk write fails without creating a historic recovery point.
   * 3. Coverage Overlap & Redundancy: None; tests emergency snapshot archiving on connector failure.
   * 4. Production Code Footprint: None; exercises authentic `StorageAPI.saveSnapshot` with `reason: 'save-failed'`.
   */
  it('creates an emergency historic snapshot in .history/ when a note save fails', async () => {
    StorageAPI.clearSyncQueue();
    const snapshotSpy = vi.spyOn(StorageAPI, 'saveSnapshot').mockResolvedValue({ id: 'rev-test' });

    const diskLockedError = new Error('EBUSY: resource busy or locked');
    vi.spyOn(globalThis, 'writeFile').mockRejectedValue(diskLockedError);

    await expect(
      StorageAPI.writeNoteContent('notes/locked-note.html', '<p>Emergency Unsaved Content</p>', { id: 'locked-note' })
    ).rejects.toThrow('EBUSY');

    expect(snapshotSpy).toHaveBeenCalledWith('notes/locked-note.html', '<p>Emergency Unsaved Content</p>', 'save-failed');
  });

  /**
   * 1. Protected Behavior: `StorageAPI.readNoteContent()` uses the staged source model to return in-flight
   *    sync queue content and recovers from emergency history snapshots if canonical disk file is unreadable.
   * 2. Regression Target: Reading outdated or blank content when a note is currently in-flight in sync queue
   *    or when canonical disk file reading throws an error.
   * 3. Coverage Overlap & Redundancy: None; tests staged source and emergency history fallback in read pipeline.
   * 4. Production Code Footprint: None; exercises authentic `StorageAPI.readNoteContent`.
   */
  it('resolves staged in-flight content and fallback snapshots in readNoteContent when disk read fails', async () => {
    StorageAPI.clearSyncQueue();
    StorageAPI._noteCache.clear();

    // 1. Staged in-flight queue test
    StorageAPI._syncQueue.set('in-flight-note', {
      id: 'in-flight-note',
      path: 'notes/in-flight-note.html',
      action: 'save',
      content: '<p>In-Flight Staged Content</p>'
    });

    const stagedContent = await StorageAPI.readNoteContent('notes/in-flight-note.html');
    expect(stagedContent).toBe('<p>In-Flight Staged Content</p>');

    // 2. Fallback history snapshot test when canonical disk file fails
    StorageAPI._noteCache.clear();
    StorageAPI.clearSyncQueue();

    vi.spyOn(globalThis, 'readFile').mockRejectedValue(new Error('Disk read lock'));
    vi.spyOn(StorageAPI, 'listSnapshots').mockResolvedValue([{ id: 'rev-recent', reason: 'save-failed' }]);
    vi.spyOn(StorageAPI, 'getSnapshotContent').mockResolvedValue('<p>Recovered Snapshot Content</p>');

    const recoveredContent = await StorageAPI.readNoteContent('notes/recovered-note.html');
    expect(recoveredContent).toBe('<p>Recovered Snapshot Content</p>');
  });
});
