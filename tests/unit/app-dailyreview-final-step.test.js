import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Daily Review Final Step (Step 5) Note Editor & Summaries', () => {
  let DailyReviewController;
  let mockLLMService;
  let mockStorageAPI;
  let writtenFiles;

  beforeEach(() => {
    writtenFiles = {};
    document.body.innerHTML = `
      <div id="daily-review-overlay" style="display:none;">
        <div id="dr-header-desc"></div>
        <div id="dr-step-date-select" style="display:none;"></div>
        <div id="dr-step-1" style="display:none;"></div>
        <div id="dr-step-2" style="display:none;"></div>
        <div id="dr-step-3" style="display:none;">
          <div id="dr-note-review-editor-container"></div>
          <div id="dr-note-review-list"></div>
        </div>
        <div id="dr-step-ai" style="display:none;">
          <div id="dr-ai-loading" style="display:none;">
            <div id="dr-ai-loading-title"></div>
            <div id="dr-ai-loading-details"></div>
          </div>
          <div id="dr-ai-editor">
            <input type="text" id="dr-ai-summary-title" style="display:none;" />
            <div id="dr-ai-summary-content"></div>
            <div id="dr-ai-suggestions-list"></div>
            <div id="dr-step5-editor-container"></div>
            <div id="dr-step5-tab-note"></div>
            <div id="dr-step5-tab-list">
              <div id="dr-ai-meeting-summaries-list"></div>
              <span id="dr-step5-notes-count">0</span>
            </div>
            <div id="dr-step5-tab-workstreams"></div>
          </div>
        </div>
        <button id="btn-dr-prev"></button>
        <button id="btn-dr-next"></button>
      </div>
      <div id="note-edit-overlay" style="display:none;">
        <div class="overlay-panel">
          <div class="overlay-header-container">
            <span id="edit-meta-title-preview"></span>
            <button id="overlay-validate-note-btn"></button>
          </div>
          <div class="overlay-main-layout">
            <div id="note-edit">
              <div id="edit-meta-wrap">
                <input id="edit-title" />
              </div>
              <div id="edit-textarea" contenteditable="true"></div>
            </div>
            <div id="overlay-right-panel" class="collapsed"></div>
          </div>
        </div>
      </div>
    `;

    global.t = (key, params) => {
      if (key === 'notes.dailySummary') return 'Résumé quotidien';
      if (key === 'dailyreview.dailySummaryTitle') return `Résumé quotidien - ${params?.date || ''}`;
      return key;
    };
    global.toast = vi.fn();
    global.mdToPreviewHTML = (md) => `<p>${md}</p>`;
    global.escH = (str) => String(str || '');
    global.escA = (str) => String(str || '');
    global.jq = (str) => JSON.stringify(str || '');
    global.settings = { ai: { language: 'fr', enabled: true } };
    global.getAppLanguage = () => 'fr';
    global.getAppLocale = () => 'fr-FR';
    global.saveManifest = vi.fn().mockResolvedValue(true);
    global.rebuildIndexHTML = vi.fn().mockResolvedValue(true);
    global.normalizeLanguageCode = (l) => l;
    global.formatLocalDateValue = (d) => (d instanceof Date ? d.toISOString().split('T')[0] : String(d));
    global.parseLocalDateValue = (s) => new Date(s);
    global.getDefaultNoteTemplateHTML = () => '<h2>Objectif</h2><p></p><h2>Notes</h2><p></p><h2>Décisions</h2><p></p><h2>Actions</h2><p></p>';
    global.parseNoteHTML = (h) => {
      const match = /<title>([^<]*)<\/title>/.exec(h || '');
      const mainMatch = /<main>([\s\S]*?)<\/main>/.exec(h || '');
      return {
        title: match ? match[1] : '',
        mainHTML: mainMatch ? mainMatch[1] : h,
        summary: ''
      };
    };

    global.manifest = [
      {
        id: 'note-meeting-1',
        path: 'notes/meeting-1.html',
        title: 'Morning Standup',
        date: '2026-09-07',
        reviewed: true,
        summary: '<p>Discussed daily goals</p>',
        preview: 'Discussed daily goals'
      },
      {
        id: 'note-meeting-2',
        path: 'notes/meeting-2.html',
        title: '1:1 with Alice',
        date: '2026-09-07',
        reviewed: true,
        summary: '<p>Discussed roadmap and Q3 priorities</p>',
        preview: 'Discussed roadmap and Q3 priorities'
      }
    ];

    global.plannerEvents = [
      { id: 'ev-1', date: '2026-09-07', startTime: '09:00', endTime: '09:30', noteId: 'note-meeting-1', title: 'Morning Standup' },
      { id: 'ev-2', date: '2026-09-07', startTime: '14:00', endTime: '15:00', noteId: 'note-meeting-2', title: '1:1 with Alice' }
    ];

    mockStorageAPI = {
      readNotesManifest: async () => global.manifest,
      readNoteContent: vi.fn().mockImplementation(async (p) => {
        return writtenFiles[p] || (p.includes('meeting-2') ? '<main><p>Alice agreed on Q3 priorities</p></main>' : '<main><p>Default note content</p></main>');
      }),
      writeNoteContent: vi.fn().mockImplementation(async (p, content) => {
        writtenFiles[p] = content;
        return true;
      })
    };
    global.StorageAPI = mockStorageAPI;

    mockLLMService = {
      isEnabled: () => true,
      chat: vi.fn().mockResolvedValue({
        parsed: {
          action: 'finalize_summary',
          properties: {
            final_summary: '### Résumé de la journée\nProgression sur tous les sujets.',
            final_suggestions: '- Préparer la démo',
            workstream_updates: []
          }
        }
      }),
      extractJsonPayloadFromText: () => ({ parsed: null }),
      renderThinkingAccordionHTML: (txt) => `<details>${txt}</details>`
    };
    global.LLMService = mockLLMService;

    global.openNoteOverlay = vi.fn().mockImplementation(async (path) => {
      const raw = await mockStorageAPI.readNoteContent(path);
      const parsed = global.parseNoteHTML(raw);
      const mItem = global.manifest.find(m => m.path === path);
      global.currentNote = {
        path,
        title: mItem?.title || parsed.title || 'Untitled',
        id: mItem?.id || 'note-id',
        mainHTML: parsed.mainHTML
      };
      const editArea = document.getElementById('edit-textarea');
      if (editArea) {
        editArea.innerHTML = parsed.mainHTML || global.getDefaultNoteTemplateHTML();
      }
    });

    const code = fs.readFileSync(path.resolve(__dirname, '../../js/app-dailyreview.js'), 'utf8');
    const fn = new Function('window', 'document', 'StorageAPI', 'StashService', 'LLMService', 'WorkstreamMemoryEngine', code + '\nreturn DailyReviewController;');
    DailyReviewController = fn(
      global,
      document,
      mockStorageAPI,
      { list: async () => [] },
      mockLLMService,
      { getTopicMemoriesCatalog: async () => [], getMajorTopicMemory: async () => null }
    );
  });

  it('does NOT save meeting title as daily summary title when autosaveAISummaryNote runs with currentNote being a meeting', async () => {
    // Current note is Meeting 2 from Step 4
    global.currentNote = {
      id: 'note-meeting-2',
      path: 'notes/meeting-2.html',
      title: '1:1 with Alice',
      mainHTML: '<p>Alice 1:1 notes</p>'
    };

    DailyReviewController.reviewDateValue = '2026-09-07';
    DailyReviewController.reviewDate = new Date('2026-09-07T00:00:00');
    DailyReviewController.todayNotes = global.manifest.slice();

    const titleInput = document.getElementById('dr-ai-summary-title');
    titleInput.value = ''; // cleared on start

    const editArea = document.getElementById('edit-textarea');
    editArea.innerHTML = '<p>Daily summary content</p>';

    await DailyReviewController.autosaveAISummaryNote();

    const summaryPath = 'notes/daily-summary-2026-09-07.html';
    const summaryManifest = global.manifest.find(m => m.path === summaryPath);
    expect(summaryManifest).toBeDefined();
    // Must NOT be the meeting title!
    expect(summaryManifest.title).not.toBe('1:1 with Alice');
    expect(summaryManifest.title).toContain('Résumé quotidien');
  });

  it('populates todayNotes in Step 5 even if Step 4 was skipped or empty', async () => {
    DailyReviewController.reviewDateValue = '2026-09-07';
    DailyReviewController.reviewDate = new Date('2026-09-07T00:00:00');
    DailyReviewController.todayNotes = []; // Step 4 not loaded

    // Should collect today's notes via collectTodayNotes
    const collected = DailyReviewController.collectTodayNotes('2026-09-07');
    expect(collected.length).toBe(2);
    expect(collected.map(n => n.id)).toEqual(['note-meeting-1', 'note-meeting-2']);

    // When refreshing meeting summaries list in Step 5:
    await DailyReviewController.refreshStep5SummariesList();
    const countBadge = document.getElementById('dr-step5-notes-count');
    expect(countBadge.textContent).toBe('2');

    const cards = document.querySelectorAll('.dr-meeting-summary-card');
    expect(cards.length).toBe(2);
  });

  it('does not include the daily summary note itself in todayNotes or meeting summaries list', async () => {
    // Add daily summary note to manifest
    global.manifest.push({
      id: 'summary-2026-09-07',
      path: 'notes/daily-summary-2026-09-07.html',
      title: 'Résumé quotidien - 07/09/2026',
      date: '2026-09-07',
      major_topic_tags: ['Daily Summary'],
      group_tags: ['Summary']
    });

    const collected = DailyReviewController.collectTodayNotes('2026-09-07');
    expect(collected.some(n => n.id === 'summary-2026-09-07')).toBe(false);
    expect(collected.some(n => n.path.includes('daily-summary'))).toBe(false);
  });

  it('does not mutate currentNote.mainHTML of a meeting note during generateAISummary', async () => {
    const meetingNote = {
      id: 'note-meeting-2',
      path: 'notes/meeting-2.html',
      title: '1:1 with Alice',
      mainHTML: '<p>Original meeting content</p>'
    };
    global.currentNote = meetingNote;

    DailyReviewController.reviewDateValue = '2026-09-07';
    DailyReviewController.reviewDate = new Date('2026-09-07T00:00:00');
    DailyReviewController.todayNotes = [
      { id: 'note-meeting-1', title: 'Meeting 1', summary: '<p>Summary 1</p>' },
      { id: 'note-meeting-2', title: 'Meeting 2', summary: '<p>Summary 2</p>' }
    ];

    await DailyReviewController.generateAISummary();

    // Meeting note object should NOT have been overwritten with the AI summary
    expect(meetingNote.mainHTML).toBe('<p>Original meeting content</p>');
    // And currentNote should now be pointing to the daily summary note
    expect(global.currentNote.id).toBe('summary-2026-09-07');
  });

  it('does not suppress AI note summarization when notes lack summaries', async () => {
    DailyReviewController.reviewDateValue = '2026-09-07';
    DailyReviewController.reviewDate = new Date('2026-09-07T00:00:00');

    // Two notes without AI summaries
    const notes = [
      { id: 'n1', path: 'notes/n1.html', title: 'N1', summary: '' },
      { id: 'n2', path: 'notes/n2.html', title: 'N2', summary: '' }
    ];
    DailyReviewController.todayNotes = notes;

    global.AIChatController = {
      generateNoteSummaries: vi.fn().mockImplementation(async (notesToSummarize) => {
        notesToSummarize.forEach(n => {
          n.summary = `<p>AI Summary for ${n.title}</p>`;
        });
      })
    };

    await DailyReviewController.generateNoteSummaries();

    expect(global.AIChatController.generateNoteSummaries).toHaveBeenCalled();
    const passedNotes = global.AIChatController.generateNoteSummaries.mock.calls[0][0];
    expect(passedNotes.length).toBe(2);
    expect(notes[0].summary).toBe('<p>AI Summary for N1</p>');
    expect(notes[1].summary).toBe('<p>AI Summary for N2</p>');
  });
});
