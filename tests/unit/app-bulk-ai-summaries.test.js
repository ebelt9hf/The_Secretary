import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Bulk AI Summaries - Skip Already Summarized Notes', () => {
  beforeAll(() => {
    globalThis.window = globalThis.window || {};
    loadScriptsIntoGlobal([
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-utils.js',
      'js/app-notes.js',
      'js/app-llm.js'
    ]);
  });

  beforeEach(() => {
    globalThis.toast = vi.fn();
    globalThis.showConfirmDialog = vi.fn().mockResolvedValue(true);
    globalThis.saveManifest = vi.fn().mockResolvedValue(true);
    globalThis.rebuildIndexHTML = vi.fn().mockResolvedValue(true);
    globalThis.renderBoard = vi.fn();
    globalThis.updateNoteAtPath = vi.fn().mockImplementation(async (path, updater) => {
      return updater({});
    });
    globalThis.LLMService = {
      isEnabled: vi.fn().mockReturnValue(true),
      generateNoteSummary: vi.fn().mockResolvedValue('Newly generated summary')
    };

    document.body.innerHTML = `
      <select id="prefs-ai-bulk-weeks">
        <option value="4" selected>4 weeks</option>
      </select>
      <div id="bulk-summary-controls" style="display:flex;"></div>
      <div id="bulk-summary-progress-container" style="display:none;"></div>
      <span id="bulk-summary-progress-text"></span>
      <div id="bulk-summary-progress-bar" style="width:0%;"></div>
    `;

    globalThis.StorageAPI = {
      readNoteContent: vi.fn()
    };
  });

  it('strictly filters out notes that already have a summary in manifest', async () => {
    const today = new Date().toISOString().slice(0, 10);
    globalThis.manifest = [
      {
        path: 'notes/meeting-1.html',
        date: today,
        title: 'Meeting 1',
        summary: 'Existing summary from previous run'
      },
      {
        path: 'notes/meeting-2.html',
        date: today,
        title: 'Meeting 2',
        summary: '' // No summary
      },
      {
        path: 'notes/meeting-3.html',
        date: today,
        title: 'Meeting 3'
        // undefined summary
      }
    ];

    globalThis.StorageAPI.readNoteContent.mockImplementation(async (path) => {
      return `<html><body><h1>Note</h1><div class="note-body">Content</div></body></html>`;
    });

    await globalThis.runBulkAISummaries();

    // Confirm dialog was shown for 2 candidate notes (meeting-2 and meeting-3)
    expect(globalThis.showConfirmDialog).toHaveBeenCalledTimes(1);
    const confirmMessage = globalThis.showConfirmDialog.mock.calls[0][0];
    expect(confirmMessage).toContain('2');

    // LLM should only have been called for meeting-2 and meeting-3, NOT meeting-1
    expect(globalThis.LLMService.generateNoteSummary).toHaveBeenCalledTimes(2);
    expect(globalThis.LLMService.generateNoteSummary).not.toHaveBeenCalledWith(
      expect.objectContaining({ path: 'notes/meeting-1.html' }),
      expect.anything()
    );
  });

  it('skips LLM generation if note file on disk already contains a summary despite stale manifest', async () => {
    const today = new Date().toISOString().slice(0, 10);
    globalThis.manifest = [
      {
        path: 'notes/meeting-disk-summarized.html',
        date: today,
        title: 'Meeting Disk',
        summary: '' // manifest thinks it has no summary
      }
    ];

    // Note content on disk actually has a summary in HTML
    globalThis.StorageAPI.readNoteContent.mockResolvedValue(`
      <html>
        <head><meta name="summary" content="Summary already present on disk"></head>
        <body><div id="ai-summary">Summary already present on disk</div><div class="note-body">Discussion</div></body>
      </html>
    `);

    await globalThis.runBulkAISummaries();

    // LLM Service should NOT be called because on-disk verification detected summary
    expect(globalThis.LLMService.generateNoteSummary).not.toHaveBeenCalled();

    // Manifest should be updated with the on-disk summary
    expect(globalThis.manifest[0].summary).toBe('Summary already present on disk');
  });

  it('notifies and aborts if all notes in the cutoff period already have summaries', async () => {
    const today = new Date().toISOString().slice(0, 10);
    globalThis.manifest = [
      {
        path: 'notes/meeting-done-1.html',
        date: today,
        title: 'Done 1',
        summary: 'All good'
      },
      {
        path: 'notes/meeting-done-2.html',
        date: today,
        title: 'Done 2',
        summary: '<p>HTML summary</p>'
      }
    ];

    await globalThis.runBulkAISummaries();

    expect(globalThis.showConfirmDialog).not.toHaveBeenCalled();
    expect(globalThis.LLMService.generateNoteSummary).not.toHaveBeenCalled();
    expect(globalThis.toast).toHaveBeenCalledTimes(1);
  });
});
