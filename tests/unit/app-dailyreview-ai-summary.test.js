import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Daily Review AI Summary Generation', () => {
  let DailyReviewController;
  let mockLLMService;
  let mockStorageAPI;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="daily-review-overlay" style="display:none;">
        <div id="dr-ai-loading" style="display:none;">
          <div id="dr-ai-loading-details"></div>
        </div>
        <div id="dr-ai-editor">
          <div id="dr-ai-summary-content"></div>
          <div id="dr-ai-suggestions-list"></div>
        </div>
        <div id="edit-textarea"></div>
      </div>
    `;

    global.t = (key) => key;
    global.toast = vi.fn();
    global.mdToPreviewHTML = (md) => `<p>${md}</p>`;
    global.escH = (str) => String(str || '');
    global.escA = (str) => String(str || '');
    global.jq = (str) => JSON.stringify(str || '');
    global.settings = { ai: { language: 'en' } };
    global.getAppLanguage = () => 'en';
    global.getAppLocale = () => 'en-US';
    global.saveManifest = vi.fn().mockResolvedValue(true);
    global.normalizeLanguageCode = (l) => l;
    global.formatLocalDateValue = (d) => (d instanceof Date ? d.toISOString().split('T')[0] : String(d));
    global.parseLocalDateValue = (s) => new Date(s);
    global.parseNoteHTML = (h) => ({ mainHTML: h });
    global.plannerEvents = [];

    global.manifest = [
      {
        id: 'summary-2026-08-31',
        path: 'notes/daily-summary-2026-08-31.html',
        title: 'Daily Summary - August 31',
        date: '2026-08-31',
        major_topic_tags: ['Daily Summary'],
        summary: 'Yesterday we completed the release preparation.'
      }
    ];

    mockStorageAPI = {
      readNotesManifest: async () => global.manifest,
      readNoteContent: vi.fn().mockResolvedValue('<main><p>Yesterday we completed the release preparation.</p></main>'),
      writeNoteContent: vi.fn().mockResolvedValue(true)
    };
    global.StorageAPI = mockStorageAPI;

    mockLLMService = {
      isEnabled: () => true,
      chat: vi.fn().mockImplementation(async () => {
        return {
          parsed: {
            action: 'finalize_summary',
            properties: {
              final_summary: '### Summary of the Day\nGreat progress today.',
              final_suggestions: '- Follow up with QA (Duration: 30 min, Priority: High)',
              workstream_updates: []
            }
          }
        };
      }),
      extractJsonPayloadFromText: () => ({ parsed: null }),
      renderThinkingAccordionHTML: (txt) => `<details>${txt}</details>`
    };
    global.LLMService = mockLLMService;

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

    DailyReviewController.reviewDate = '2026-09-01';
    DailyReviewController.todayNotes = [
      { id: 'note-1', title: 'Sprint Planning', date: '2026-09-01', preview: 'Planned sprint tasks' }
    ];
  });

  it('generates AI summary successfully without ReferenceError for prevSummariesContext (EN)', async () => {
    global.settings = { ai: { language: 'en' } };
    await DailyReviewController.generateAISummary();

    expect(mockLLMService.chat).toHaveBeenCalled();
    const chatCall = mockLLMService.chat.mock.calls[0];
    const userPrompt = chatCall[0][1].content;
    
    // User prompt should include previous summaries context
    expect(userPrompt).toContain('Previous daily summaries');
    expect(userPrompt).toContain('Yesterday we completed the release preparation');
    
    // Content should be rendered in UI
    const contentTextarea = document.getElementById('dr-ai-summary-content');
    expect(contentTextarea.innerHTML).toContain('Great progress today');
  });

  it('generates AI summary successfully in German and French without error', async () => {
    // Test DE
    global.settings = { ai: { language: 'de' } };
    await DailyReviewController.generateAISummary();
    expect(mockLLMService.chat).toHaveBeenCalled();

    // Test FR
    global.settings = { ai: { language: 'fr' } };
    await DailyReviewController.generateAISummary();
    expect(mockLLMService.chat).toHaveBeenCalled();
  });

  it('generates AI summary cleanly when there are no previous daily summaries', async () => {
    global.manifest = [];
    global.settings = { ai: { language: 'en' } };
    await DailyReviewController.generateAISummary();
    expect(mockLLMService.chat).toHaveBeenCalled();
  });

  it('parses and renders suggested workstreams for growing topics in Step 5', async () => {
    mockLLMService.chat = vi.fn().mockResolvedValue({
      parsed: {
        action: 'finalize_summary',
        properties: {
          final_summary: '### Summary\nExpanding workstreams detected.',
          final_suggestions: '- Deploy backend (Duration: 45 min, Priority: High)',
          workstream_updates: [],
          suggested_workstreams: [
            {
              topic_name: 'Performance Optimization',
              scope: 'Optimize queries and UI bundle',
              reason: 'Multiple performance bottlenecks discussed today',
              tags: { group: 'Engineering', major: 'Performance', topic: 'Core' }
            }
          ]
        }
      }
    });

    await DailyReviewController.generateAISummary();

    expect(DailyReviewController.suggestedWorkstreams.length).toBe(1);
    expect(DailyReviewController.suggestedWorkstreams[0].topic_name).toBe('Performance Optimization');

    const sugList = document.getElementById('dr-ai-suggestions-list');
    expect(sugList.innerHTML).toContain('Performance Optimization');
    expect(sugList.innerHTML).toContain('Multiple performance bottlenecks discussed today');
    expect(sugList.innerHTML).toContain('Optimize queries and UI bundle');
    expect(sugList.innerHTML).toContain('Performance');
  });

  it('handles final_suggestions as an array without throwing ".trim is not a function"', async () => {
    mockLLMService.chat = vi.fn().mockResolvedValue({
      parsed: {
        action: 'finalize_summary',
        properties: {
          final_summary: '### Summary\nDone with tasks.',
          final_suggestions: [
            '- Prepare deployment checklist (Duration: 20 min, Priority: High)',
            '- Review pull request #12 (Duration: 15 min, Priority: Medium)'
          ],
          workstream_updates: []
        }
      }
    });

    await DailyReviewController.generateAISummary();

    expect(global.toast).not.toHaveBeenCalledWith(expect.stringContaining('is not a function'), true);
    const contentTextarea = document.getElementById('dr-ai-summary-content');
    expect(contentTextarea.innerHTML).toContain('Done with tasks');
    expect(DailyReviewController.currentSuggestions.length).toBe(2);
    expect(DailyReviewController.currentSuggestions[0].title).toBe('Prepare deployment checklist');
  });

  it('handles action "final_step" and "finalstep" in Step 5 mandatory finalization turn', async () => {
    // Force multi-turn loop to hit mandatory finalization turn (Step 5 / 5)
    let callCount = 0;
    mockLLMService.chat = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount < 5) {
        // Research turns: update scratchpad
        return {
          parsed: {
            action: 'update_scratchpad',
            properties: {
              scratchpad_content: `Turn ${callCount} notes`,
              draft_summary: 'Draft summary in progress'
            }
          }
        };
      }
      // Mandatory final turn (Step 5 / 5): agent returns "final_step" or "finalstep"
      return {
        parsed: {
          action: 'final_step',
          properties: {
            final_summary: '### Summary of the Day\nCompleted on final step.',
            final_suggestions: ['- Complete wrap-up (Duration: 10 min, Priority: High)'],
            workstream_updates: []
          }
        }
      };
    });

    await DailyReviewController.generateAISummary();

    expect(global.toast).not.toHaveBeenCalledWith(expect.stringContaining('is not a function'), true);
    const contentTextarea = document.getElementById('dr-ai-summary-content');
    expect(contentTextarea.innerHTML).toContain('Completed on final step');
  });

  it('handles final_summary and suggestions as objects without throwing TypeError', async () => {
    mockLLMService.chat = vi.fn().mockResolvedValue({
      parsed: {
        action: 'finalize',
        properties: {
          final_summary: {
            summary: '### Summary\nHandled object summary cleanly.',
            details: 'Key points explained.'
          },
          final_suggestions: [
            { title: 'Update documentation', duration: 40, priority: 'High', dependsOn: 'task-1' }
          ],
          workstream_updates: []
        }
      }
    });

    await DailyReviewController.generateAISummary();

    expect(global.toast).not.toHaveBeenCalledWith(expect.stringContaining('is not a function'), true);
    const contentTextarea = document.getElementById('dr-ai-summary-content');
    expect(contentTextarea.innerHTML).toContain('Handled object summary cleanly');
    expect(DailyReviewController.currentSuggestions.length).toBe(1);
    expect(DailyReviewController.currentSuggestions[0].title).toBe('Update documentation');
    expect(DailyReviewController.currentSuggestions[0].duration).toBe(40);
    expect(DailyReviewController.currentSuggestions[0].priority).toBe('High');
  });

  it('exposes finalStep, finalstep, and finalizeStep as defined functions on DailyReviewController', async () => {
    expect(typeof DailyReviewController.finalStep).toBe('function');
    expect(typeof DailyReviewController.finalstep).toBe('function');
    expect(typeof DailyReviewController.finalizeStep).toBe('function');
    expect(typeof DailyReviewController.finalizeSummary).toBe('function');

    const spy = vi.spyOn(DailyReviewController, 'generateAISummary').mockResolvedValue(true);
    await DailyReviewController.finalStep({ test: true });
    expect(spy).toHaveBeenCalledWith({ test: true });

    await DailyReviewController.finalstep({ test2: true });
    expect(spy).toHaveBeenCalledWith({ test2: true });
    spy.mockRestore();
  });
});
