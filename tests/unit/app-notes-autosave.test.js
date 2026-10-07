import { describe, it, expect, beforeAll, beforeEach, vi, afterEach } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Note Editor Autosave & Debounce Engine', () => {
  let realAutoSaveNote;

  beforeAll(() => {
    loadScriptsIntoGlobal([
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-state.js',
      'js/app-utils.js',
      'js/app-notes.js',
      'js/app-overlay.js'
    ]);
    realAutoSaveNote = globalThis.autoSaveNote;
  });

  beforeEach(() => {
    vi.useFakeTimers();
    globalThis.autoSaveNote = realAutoSaveNote;
    globalThis.StorageAPI = {
      writeNoteContent: vi.fn().mockResolvedValue(true),
      readNoteContent: vi.fn().mockResolvedValue('<html><body><main><p>Note content</p></main></body></html>'),
      deleteNoteContent: vi.fn().mockResolvedValue(true)
    };
    globalThis.saveManifest = vi.fn().mockResolvedValue(true);
    globalThis.manifest = [];
    globalThis.currentNote = {
      id: 'note-101',
      path: 'notes/note-101.html',
      title: 'Initial Title',
      date: '2026-10-05',
      mainHTML: '<p>Initial text</p>',
      originalHTML: '<!DOCTYPE html><html><head><title>Initial Title</title></head><body><main><p>Initial text</p></main></body></html>'
    };
    globalThis.broadcastSync = vi.fn();
    globalThis.setSaveIndicator = vi.fn();
    globalThis.createMissingTodosForCurrentNote = vi.fn().mockResolvedValue(true);
    globalThis.renderInspectorPanel = vi.fn().mockResolvedValue(true);
  });

  afterEach(() => {
    if (typeof clearAutoSave === 'function') {
      clearAutoSave();
    }
    globalThis.autoSaveNote = realAutoSaveNote;
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('debounces multiple rapid typing inputs and only saves once after inactivity threshold', async () => {
    const saveSpy = vi.fn().mockResolvedValue(true);
    globalThis.autoSaveNote = saveSpy;

    // Simulate rapid typing (10 keystrokes every 100ms: t=0, 100, ..., 900)
    for (let i = 0; i < 10; i++) {
      scheduleAutoSave();
      vi.advanceTimersByTime(100);
    }
    // At t=1000ms, last timer was scheduled at t=900 for t=2900

    // Advance by 1500ms (t=2500ms, still 400ms before debounce threshold)
    vi.advanceTimersByTime(1500);
    expect(saveSpy).not.toHaveBeenCalled();

    // Advance 500ms more (t=3000ms, crossing the 2000ms debounce since last input)
    vi.advanceTimersByTime(500);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledWith({ silent: true });
  });

  it('triggers max wait autosave during continuous non-stop typing', async () => {
    const saveSpy = vi.fn().mockResolvedValue(true);
    globalThis.autoSaveNote = saveSpy;

    // Type continuously every 500ms for 16 seconds
    for (let i = 0; i < 32; i++) {
      scheduleAutoSave();
      vi.advanceTimersByTime(500);
    }

    // Since 16s > AUTOSAVE_MAX_WAIT_MS (15s), max-wait timer should have triggered a background save
    expect(saveSpy).toHaveBeenCalled();
  });

  it('clears pending autosave timers on clearAutoSave', () => {
    const saveSpy = vi.fn().mockResolvedValue(true);
    globalThis.autoSaveNote = saveSpy;

    scheduleAutoSave();
    vi.advanceTimersByTime(500);

    clearAutoSave();
    vi.advanceTimersByTime(30000);

    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('does not trigger heavy todo scans or UI thrashing during intermediate typing autosaves', async () => {
    document.body.innerHTML = `
      <div class="overlay-panel">
        <div id="note-edit">
          <input id="edit-title" value="Updated Title">
          <input id="edit-date" value="2026-10-05">
          <div id="edit-textarea" contenteditable="true"><p>New typed content</p></div>
          <div id="edit-summary"></div>
          <div id="editor-group"></div>
          <div id="editor-major"></div>
          <div id="editor-topic"></div>
          <div id="editor-extra"></div>
          <div id="overlay-save-indicator"></div>
        </div>
      </div>
    `;

    currentNote = {
      id: 'note-101',
      path: 'notes/note-101.html',
      title: 'Initial Title',
      date: '2026-10-05',
      mainHTML: '<p>Initial text</p>',
      originalHTML: '<!DOCTYPE html><html><head><title>Initial Title</title></head><body><main><p>Initial text</p></main></body></html>'
    };

    // Focus on editor textarea
    const ta = document.getElementById('edit-textarea');
    ta.focus();

    // Run background autosave (silent: true, isFinal: false)
    await autoSaveNote({ silent: true, isFinal: false });

    // Verify note content was written to storage
    expect(globalThis.StorageAPI.writeNoteContent).toHaveBeenCalled();

    // Verify createMissingTodosForCurrentNote was NOT called during intermediate typing autosave
    expect(globalThis.createMissingTodosForCurrentNote).not.toHaveBeenCalled();
  });

  it('executes full finalization when isFinal is true', async () => {
    document.body.innerHTML = `
      <div class="overlay-panel">
        <div id="note-edit">
          <input id="edit-title" value="Final Title">
          <input id="edit-date" value="2026-10-05">
          <div id="edit-textarea" contenteditable="true"><p>Final note content</p></div>
          <div id="edit-summary"></div>
          <div id="editor-group"></div>
          <div id="editor-major"></div>
          <div id="editor-topic"></div>
          <div id="editor-extra"></div>
          <div id="overlay-save-indicator"></div>
        </div>
      </div>
    `;

    currentNote = {
      id: 'note-101',
      path: 'notes/note-101.html',
      title: 'Initial Title',
      date: '2026-10-05',
      mainHTML: '<p>Initial text</p>',
      originalHTML: '<!DOCTYPE html><html><head><title>Initial Title</title></head><body><main><p>Initial text</p></main></body></html>'
    };

    await autoSaveNote({ silent: false, isFinal: true });

    expect(globalThis.StorageAPI.writeNoteContent).toHaveBeenCalled();
    expect(globalThis.createMissingTodosForCurrentNote).toHaveBeenCalled();
    expect(globalThis.renderInspectorPanel).toHaveBeenCalled();
  });
});
