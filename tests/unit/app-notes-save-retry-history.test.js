import { describe, it, expect, beforeAll, beforeEach, vi, afterEach } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Note Save Error Retry & Auto-History Snapshot Engine', () => {
  beforeAll(() => {
    loadScriptsIntoGlobal([
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-state.js',
      'js/app-utils.js',
      'js/app-notes.js',
      'js/app-overlay.js'
    ]);
  });

  beforeEach(() => {
    document.body.innerHTML = `
      <div class="overlay-panel">
        <div id="note-edit">
          <input id="edit-title" value="My Failing Note">
          <input id="edit-date" value="2026-10-15">
          <div id="edit-textarea" contenteditable="true"><p>Unsaved precious thoughts</p></div>
          <div id="edit-summary"></div>
          <div id="editor-group"></div>
          <div id="editor-major"></div>
          <div id="editor-topic"></div>
          <div id="editor-extra"></div>
          <div id="overlay-save-indicator" class="save-indicator"></div>
          <div id="note-history-list"></div>
          <div id="note-history-empty-hint" style="display:none"></div>
        </div>
      </div>
    `;

    globalThis.StorageAPI = {
      writeNoteContent: vi.fn(),
      readNoteContent: vi.fn().mockResolvedValue('<html><body><main><p>Original</p></main></body></html>'),
      deleteNoteContent: vi.fn().mockResolvedValue(true),
      saveSnapshot: vi.fn().mockResolvedValue({ id: 'rev-error-1', reason: 'save-error' }),
      listSnapshots: vi.fn().mockResolvedValue([]),
      restoreSnapshot: vi.fn()
    };
    globalThis.saveManifest = vi.fn().mockResolvedValue(true);
    globalThis.manifest = [];
    globalThis.broadcastSync = vi.fn();
    globalThis.toast = vi.fn();

    globalThis.currentNote = {
      id: 'note-err-1',
      path: 'notes/note-err-1.html',
      title: 'Original Title',
      date: '2026-10-15',
      mainHTML: '<p>Original</p>',
      originalHTML: '<!DOCTYPE html><html><head><title>Original Title</title></head><body><main><p>Original</p></main></body></html>'
    };
    if (typeof clearAutoSave === 'function') {
      clearAutoSave();
    }
  });

  afterEach(() => {
    if (typeof clearAutoSave === 'function') {
      clearAutoSave();
    }
    vi.clearAllMocks();
  });

  it('automatically saves a snapshot into history when note save fails', async () => {
    // Simulate writeNoteContent throwing a write/disk error
    globalThis.StorageAPI.writeNoteContent.mockRejectedValue(new Error('Disk I/O error or permission denied'));

    const result = await autoSaveNote({ silent: true, isFinal: true });
    expect(result).toBe(false);

    // Verify StorageAPI.saveSnapshot was automatically called to preserve note in history
    expect(globalThis.StorageAPI.saveSnapshot).toHaveBeenCalledTimes(1);
    const [snapshotPath, snapshotContent, snapshotReason] = globalThis.StorageAPI.saveSnapshot.mock.calls[0];
    expect(snapshotPath).toBe('notes/note-err-1.html');
    expect(snapshotReason).toBe('save-error');
    expect(snapshotContent).toContain('Unsaved precious thoughts');
  });

  it('renders a retry button with localized title and label in setSaveIndicator when state is error', () => {
    setSaveIndicator('error');

    const indicator = document.getElementById('overlay-save-indicator');
    expect(indicator.classList.contains('error')).toBe(true);

    const retryBtn = document.getElementById('overlay-save-retry-btn');
    expect(retryBtn).not.toBeNull();
    expect(retryBtn.tagName).toBe('BUTTON');
    expect(retryBtn.textContent).toContain(t('common.saveIndicatorRetry') || 'Retry');
    expect(retryBtn.title).toBe(t('common.saveIndicatorRetryTooltip') || 'Retry saving the note');
    expect(retryBtn.title).not.toBe(retryBtn.textContent); // Rule: tooltip must describe outcome
  });

  it('allows the user to retry saving, recovering on subsequent success', async () => {
    // 1st attempt: fails
    globalThis.StorageAPI.writeNoteContent.mockRejectedValueOnce(new Error('Network glitch'));

    await autoSaveNote({ silent: true, isFinal: false });
    const indicator = document.getElementById('overlay-save-indicator');
    expect(indicator.classList.contains('error')).toBe(true);

    const retryBtn = document.getElementById('overlay-save-retry-btn');
    expect(retryBtn).not.toBeNull();

    // 2nd attempt: succeeds
    globalThis.StorageAPI.writeNoteContent.mockResolvedValueOnce(true);

    await retrySaveNote();

    expect(globalThis.StorageAPI.writeNoteContent).toHaveBeenCalledTimes(2);
    expect(indicator.classList.contains('saved')).toBe(true);
    expect(globalThis.toast).toHaveBeenCalledWith(t('common.noteSaved'));
  });

  it('displays the localized reason for save-error in renderNoteHistoryList', async () => {
    globalThis.StorageAPI.listSnapshots.mockResolvedValue([
      {
        id: 'rev-failed-1',
        timestamp: Date.now(),
        reason: 'save-error',
        size: 1024
      }
    ]);

    await renderNoteHistoryList();

    const list = document.getElementById('note-history-list');
    expect(list.children.length).toBe(1);
    const itemText = list.children[0].textContent;
    expect(itemText).toContain(t('history.reasonSaveError'));
  });

  it('categorizes network connectivity issue vs file issue and informs the user', async () => {
    // 1. Network connectivity error
    const netErr = new Error('Failed to fetch from remote');
    netErr.name = 'TypeError';
    globalThis.StorageAPI.writeNoteContent.mockRejectedValueOnce(netErr);

    await autoSaveNote({ silent: true, isFinal: false });
    const indicator = document.getElementById('overlay-save-indicator');
    expect(indicator.textContent).toContain(t('common.saveErrorNetwork'));

    // 2. File / storage issue
    const fileErr = new Error('Permission denied on disk write');
    fileErr.name = 'NotAllowedError';
    globalThis.StorageAPI.writeNoteContent.mockRejectedValueOnce(fileErr);

    await autoSaveNote({ silent: true, isFinal: false });
    expect(indicator.textContent).toContain(t('common.saveErrorFile'));
  });

  it('performs background retries with exponential backoff (1s, 2s, 4s)', async () => {
    vi.useFakeTimers();

    // 1st attempt: fails
    globalThis.StorageAPI.writeNoteContent.mockRejectedValueOnce(new Error('Network offline'));
    await autoSaveNote({ silent: true, isFinal: false });

    const indicator = document.getElementById('overlay-save-indicator');
    expect(indicator.textContent).toContain(t('common.saveErrorNetwork'));
    // Retrying interval hint shown (1s)
    expect(indicator.textContent).toContain('1s');

    // Advance 500ms -> background retry has NOT run yet
    await vi.advanceTimersByTimeAsync(500);
    expect(globalThis.StorageAPI.writeNoteContent).toHaveBeenCalledTimes(1);

    // 2nd attempt: fails at 1000ms
    globalThis.StorageAPI.writeNoteContent.mockRejectedValueOnce(new Error('Network offline again'));
    await vi.advanceTimersByTimeAsync(500);
    expect(globalThis.StorageAPI.writeNoteContent).toHaveBeenCalledTimes(2);
    // Interval doubles to 2s
    expect(indicator.textContent).toContain('2s');

    // 3rd attempt: succeeds at 2000ms
    globalThis.StorageAPI.writeNoteContent.mockResolvedValueOnce(true);
    await vi.advanceTimersByTimeAsync(2000);

    expect(globalThis.StorageAPI.writeNoteContent).toHaveBeenCalledTimes(3);
    expect(indicator.classList.contains('saved')).toBe(true);

    vi.useRealTimers();
  });

  it('surfaces the known exception message after multiple failed tries for file issues', async () => {
    const specificErr = new Error('EACCES: permission denied, open /vault/note.html');
    globalThis.StorageAPI.writeNoteContent.mockRejectedValue(specificErr);

    // Run 3 failed attempts
    await autoSaveNote({ silent: true, isFinal: false });
    await autoSaveNote({ silent: true, isFinal: false });
    await autoSaveNote({ silent: true, isFinal: false });

    const indicator = document.getElementById('overlay-save-indicator');
    expect(indicator.textContent).toContain(t('common.saveErrorFile'));
    // The specific known exception message is now surfaced to the user
    expect(indicator.textContent).toContain('permission denied');
  });
});

