import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Daily Review Batch Perfect Notes & Integrated Proposal Review (app-dailyreview.js)', () => {
  let DailyReviewController;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="daily-review-overlay" style="display:none;">
        <div id="dr-step-3">
          <button id="btn-dr-batch-perfect"></button>
          <div id="dr-batch-progress-container" style="display:none;">
            <span id="dr-batch-progress-status"></span>
            <div id="dr-batch-progress-bar" style="width:0%;"></div>
            <button id="btn-dr-cancel-batch"></button>
          </div>
          <div id="dr-notes-to-review-list"></div>
          <div id="dr-note-review-editor-container">
            <textarea id="edit-textarea"></textarea>
          </div>
          <div id="dr-integrated-proposal-container" style="display:none;">
            <div id="dr-integrated-tags-container" style="display:none;"></div>
            <div id="dr-integrated-questions-container" style="display:none;"></div>
            <div id="dr-integrated-tab-desc"></div>
            <button id="dr-tab-proposal-a"></button>
            <button id="dr-tab-proposal-b"></button>
            <button id="dr-tab-proposal-c" style="display:none;"></button>
            <button id="dr-tab-original"></button>
            <button id="dr-tab-scratchpad"></button>
            <div id="dr-integrated-toolbar" style="display:flex;"></div>
            <div id="dr-integrated-preview-pane">
              <div id="dr-integrated-proposal-html"></div>
              <div id="dr-integrated-actions-container" style="display:none;"></div>
            </div>
            <div id="dr-integrated-scratchpad-pane" style="display:none;">
              <div id="dr-integrated-scratchpad-content"></div>
            </div>
            <button id="btn-dr-integrated-apply"></button>
            <button id="btn-dr-integrated-keep-orig"></button>
            <button id="btn-dr-integrated-decline"></button>
            <button id="btn-dr-integrated-copy"></button>
            <button id="btn-dr-switch-raw-editor"></button>
            <div id="dr-integrated-feedback-drawer" style="display:none;">
              <input id="dr-integrated-feedback-input" />
              <button id="btn-dr-integrated-gen-c"></button>
            </div>
          </div>
        </div>
      </div>
    `;

    loadScriptsIntoGlobal(['js/app-utils.js', 'js/app-llm.js', 'js/app-dailyreview.js']);
    DailyReviewController = global.DailyReviewController;

    global.t = (key) => key;
    global.escH = (s) => String(s || '');
    global.escA = (s) => String(s || '').replace(/"/g, '&quot;');
    global.toast = vi.fn();
    global.cleanProposalHtml = (html) => String(html || '');
    global.restoreOriginalImagesToProposal = (orig, prop) => prop;
    global.cleanMeetingSummaryHtml = (s) => String(s || '');
    global.extractProposedActionsFromProposal = () => ({ decisions: [], todos: [], colleagues: [], notes: [] });
    global.formatLocalDateValue = () => '2026-09-13';
    global.parseLocalDateValue = () => new Date();
    global.assignNoteToWorkstream = vi.fn().mockResolvedValue(true);
    global.populateTagEditor = vi.fn();
    global.setupUncertaintyHoverCards = vi.fn();
    global.StorageAPI = {
      readNoteContent: vi.fn().mockResolvedValue('<p>Original note content</p>'),
      writeNoteContent: vi.fn().mockResolvedValue(true),
      saveSnapshot: vi.fn().mockResolvedValue(true)
    };
    global.manifest = [
      { path: 'notes/1.html', id: 'note1', title: 'Note 1', date: '2026-09-13', reviewed: false },
      { path: 'notes/2.html', id: 'note2', title: 'Note 2', date: '2026-09-13', reviewed: false }
    ];
    window.manifest = global.manifest;

    global.LLMService = {
      runRefactorAgentLoop: vi.fn().mockResolvedValue({
        status: 'proposals_ready',
        proposalA: '<h2>Executive</h2><p>Structured text</p>',
        proposalB: '<h2>Comprehensive</h2><p>Nuanced text</p>',
        meetingSummary: '<p>Key summary</p>',
        proposedWorkstreams: ['Engineering'],
        proposedGroup: 'Dev',
        proposedTopic: 'Architecture',
        tagChangeReason: 'Note discusses dev architecture.',
        questions: []
      }),
      renderThinkingAccordionHTML: vi.fn().mockReturnValue('<div>Thinking accordion</div>')
    };

    DailyReviewController.noteProposals = {};
    DailyReviewController.batchState = { active: false, paused: false, currentIndex: 0, totalCount: 0, abortController: null };
    DailyReviewController.todayNotes = [
      { path: 'notes/1.html', id: 'note1', title: 'Note 1', reviewed: false },
      { path: 'notes/2.html', id: 'note2', title: 'Note 2', reviewed: false }
    ];
    DailyReviewController.activeNotePath = 'notes/1.html';
  });

  describe('Batch Perfect Notes Execution', () => {
    it('initializes batch progress and processes notes sequentially', async () => {
      const listEl = document.getElementById('dr-notes-to-review-list');
      listEl.innerHTML = `
        <button class="dr-note-item-btn" data-note-path="notes/1.html"><span class="dr-note-checkbox-indicator"></span></button>
        <button class="dr-note-item-btn" data-note-path="notes/2.html"><span class="dr-note-checkbox-indicator"></span></button>
      `;

      await DailyReviewController.startBatchPerfectNotes();

      expect(global.LLMService.runRefactorAgentLoop).toHaveBeenCalledTimes(2);
      expect(DailyReviewController.noteProposals['notes/1.html']?.status).toBe('ready');
      expect(DailyReviewController.noteProposals['notes/2.html']?.status).toBe('ready');
      expect(DailyReviewController.batchState.active).toBe(false);

      // Check badges
      const badges = listEl.querySelectorAll('.dr-batch-badge.status-ready');
      expect(badges.length).toBe(2);
    });

    it('can be cancelled early and cleans queued state', async () => {
      DailyReviewController.batchState = {
        active: true,
        cancelled: false,
        abortController: new AbortController()
      };
      DailyReviewController.noteProposals = {
        'notes/1.html': { status: 'ready' },
        'notes/2.html': { status: 'queued' }
      };

      DailyReviewController.cancelBatchPerfectNotes();

      expect(DailyReviewController.batchState.active).toBe(false);
      expect(DailyReviewController.batchState.cancelled).toBe(true);
      expect(DailyReviewController.noteProposals['notes/2.html']).toBeUndefined();
      expect(DailyReviewController.noteProposals['notes/1.html']).toBeDefined();
    });

    it('continues processing batch when an individual note refactoring fails', async () => {
      const listEl = document.getElementById('dr-notes-to-review-list');
      listEl.innerHTML = `
        <button class="dr-note-item-btn" data-note-path="notes/1.html"><span class="dr-note-checkbox-indicator"></span></button>
        <button class="dr-note-item-btn" data-note-path="notes/2.html"><span class="dr-note-checkbox-indicator"></span></button>
      `;

      // Note 1 fails, Note 2 succeeds
      global.LLMService.runRefactorAgentLoop
        .mockRejectedValueOnce(new Error('Network error on note 1'))
        .mockResolvedValueOnce({
          status: 'proposals_ready',
          proposalA: '<h2>Executive Note 2</h2>',
          proposalB: '<h2>Comprehensive Note 2</h2>',
          meetingSummary: 'Summary 2'
        });

      await DailyReviewController.startBatchPerfectNotes();

      expect(DailyReviewController.noteProposals['notes/1.html']?.status).toBe('error');
      expect(DailyReviewController.noteProposals['notes/2.html']?.status).toBe('ready');
      expect(DailyReviewController.batchState.active).toBe(false);
      expect(global.toast).toHaveBeenCalledWith('dailyreview.batchCompleteToast');
    });

    it('does not reconvert notes that are already reviewed', async () => {
      // Note 1 is already reviewed, Note 2 is unreviewed
      DailyReviewController.todayNotes = [
        { path: 'notes/1.html', id: 'note1', title: 'Note 1 (Reviewed)', reviewed: true },
        { path: 'notes/2.html', id: 'note2', title: 'Note 2 (Pending)', reviewed: false }
      ];
      global.manifest = [
        { path: 'notes/1.html', id: 'note1', title: 'Note 1 (Reviewed)', reviewed: true },
        { path: 'notes/2.html', id: 'note2', title: 'Note 2 (Pending)', reviewed: false }
      ];

      const listEl = document.getElementById('dr-notes-to-review-list');
      listEl.innerHTML = `
        <button class="dr-note-item-btn reviewed" data-note-path="notes/1.html"><span class="dr-note-checkbox-indicator"></span></button>
        <button class="dr-note-item-btn" data-note-path="notes/2.html"><span class="dr-note-checkbox-indicator"></span></button>
      `;

      await DailyReviewController.startBatchPerfectNotes();

      // Only Note 2 should have been converted
      expect(global.LLMService.runRefactorAgentLoop).toHaveBeenCalledTimes(1);
      expect(global.LLMService.runRefactorAgentLoop).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'notes/2.html' }),
        expect.anything(),
        expect.anything()
      );
      expect(DailyReviewController.noteProposals['notes/1.html']).toBeUndefined();
      expect(DailyReviewController.noteProposals['notes/2.html']?.status).toBe('ready');
    });

    it('displays allNotesAlreadyReviewed toast and aborts when all notes are already reviewed', async () => {
      DailyReviewController.todayNotes = [
        { path: 'notes/1.html', id: 'note1', title: 'Note 1', reviewed: true },
        { path: 'notes/2.html', id: 'note2', title: 'Note 2', reviewed: true }
      ];
      global.manifest = [
        { path: 'notes/1.html', id: 'note1', title: 'Note 1', reviewed: true },
        { path: 'notes/2.html', id: 'note2', title: 'Note 2', reviewed: true }
      ];

      await DailyReviewController.startBatchPerfectNotes();

      expect(global.LLMService.runRefactorAgentLoop).not.toHaveBeenCalled();
      expect(global.toast).toHaveBeenCalledWith('dailyreview.allNotesAlreadyReviewed');
    });

    it('isNoteReviewed correctly determines reviewed state from note property and manifest', () => {
      global.manifest = [
        { path: 'notes/1.html', id: 'note1', reviewed: true },
        { path: 'notes/2.html', id: 'note2', reviewed: false }
      ];

      expect(DailyReviewController.isNoteReviewed({ path: 'notes/1.html', reviewed: true })).toBe(true);
      expect(DailyReviewController.isNoteReviewed({ path: 'notes/1.html' })).toBe(true);
      expect(DailyReviewController.isNoteReviewed({ path: 'notes/2.html', reviewed: false })).toBe(false);
      expect(DailyReviewController.isNoteReviewed('notes/1.html')).toBe(true);
      expect(DailyReviewController.isNoteReviewed('notes/2.html')).toBe(false);
      expect(DailyReviewController.isNoteReviewed(null)).toBe(false);
    });
  });

  describe('Integrated Proposal Review in Step 4', () => {
    beforeEach(() => {
      DailyReviewController.noteProposals['notes/1.html'] = {
        status: 'ready',
        note: DailyReviewController.todayNotes[0],
        originalHtml: '<p>Raw 1</p>',
        originalHtmlSnapshot: '<p>Raw 1</p>',
        proposalA: '<h2>Executive A</h2><p>Action items here</p>',
        proposalB: '<h2>Comprehensive B</h2><p>Context here</p>',
        proposalC: '',
        meetingSummary: 'Summary text',
        proposedWorkstreams: ['Engineering'],
        proposedGroup: 'Dev',
        proposedTopic: 'Backend',
        tagChangeReason: 'Relates to backend system.',
        acceptedTagChanges: false,
        questions: [{ question: 'Clarify SLA?' }],
        activeTab: 'A'
      };
    });

    it('renders integrated container instead of raw editor when proposals are ready', async () => {
      await DailyReviewController.renderIntegratedProposalView('notes/1.html');

      const rawEditor = document.getElementById('dr-note-review-editor-container');
      const integratedContainer = document.getElementById('dr-integrated-proposal-container');
      expect(rawEditor.style.display).toBe('none');
      expect(integratedContainer.style.display).toBe('flex');

      // Tags container is populated
      const tagsContainer = document.getElementById('dr-integrated-tags-container');
      expect(tagsContainer.style.display).toBe('block');
      expect(tagsContainer.innerHTML).toContain('Engineering');
      expect(tagsContainer.innerHTML).toContain('Dev');

      // Questions banner is populated
      const questionsContainer = document.getElementById('dr-integrated-questions-container');
      expect(questionsContainer.style.display).toBe('block');
      expect(questionsContainer.innerHTML).toContain('Clarify SLA?');

      // Preview pane rendered and uncertainty hover attached
      const previewHtml = document.getElementById('dr-integrated-proposal-html');
      expect(previewHtml.innerHTML).toBe('<h2>Executive A</h2><p>Action items here</p>');
      expect(global.setupUncertaintyHoverCards).toHaveBeenCalled();
    });

    it('allows switching tabs between A, B, original, and scratchpad', () => {
      DailyReviewController.renderIntegratedProposalView('notes/1.html');

      DailyReviewController.switchIntegratedTab('B');
      const previewHtml = document.getElementById('dr-integrated-proposal-html');
      expect(previewHtml.innerHTML).toBe('<h2>Comprehensive B</h2><p>Context here</p>');

      DailyReviewController.switchIntegratedTab('scratchpad');
      const scratchpadPane = document.getElementById('dr-integrated-scratchpad-pane');
      const previewPane = document.getElementById('dr-integrated-preview-pane');
      expect(scratchpadPane.style.display).toBe('block');
      expect(previewPane.style.display).toBe('none');
    });

    it('toggles workstream & tag acceptance in integrated view', () => {
      DailyReviewController.renderIntegratedProposalView('notes/1.html');
      const btn = document.createElement('button');

      DailyReviewController.toggleIntegratedAcceptTags(btn);
      expect(DailyReviewController.noteProposals['notes/1.html'].acceptedTagChanges).toBe(true);

      DailyReviewController.toggleIntegratedAcceptTags(btn);
      expect(DailyReviewController.noteProposals['notes/1.html'].acceptedTagChanges).toBe(false);
    });

    it('applies proposal, unrolls uncertainty spans, saves note and advances to next note', async () => {
      DailyReviewController.renderIntegratedProposalView('notes/1.html');
      DailyReviewController.noteProposals['notes/1.html'].acceptedTagChanges = true;

      const previewHtml = document.getElementById('dr-integrated-proposal-html');
      previewHtml.innerHTML = '<p>Decided <span class="inline-uncertain-text" data-uncertainty-reason="Assumed">Q4 launch</span>.</p>';

      DailyReviewController.toggleNoteReviewed = vi.fn().mockResolvedValue(true);
      DailyReviewController.selectNoteForReview = vi.fn().mockResolvedValue(true);

      await DailyReviewController.applyIntegratedProposal();

      // Uncertainty span unrolled cleanly before saving
      expect(global.StorageAPI.writeNoteContent).toHaveBeenCalledWith(
        'notes/1.html',
        expect.not.stringContaining('inline-uncertain-text')
      );
      expect(global.StorageAPI.writeNoteContent).toHaveBeenCalledWith(
        'notes/1.html',
        expect.stringContaining('Q4 launch')
      );

      // Workstream committed
      expect(global.assignNoteToWorkstream).toHaveBeenCalledWith('Engineering');
      expect(DailyReviewController.toggleNoteReviewed).toHaveBeenCalledWith('notes/1.html', true);

      // Advanced to note 2
      expect(DailyReviewController.selectNoteForReview).toHaveBeenCalledWith('notes/2.html');
    });

    it('switching to raw editor shows editor and adds a toggle banner', () => {
      DailyReviewController.renderIntegratedProposalView('notes/1.html');
      DailyReviewController.switchToRawEditor();

      const rawEditor = document.getElementById('dr-note-review-editor-container');
      const integratedContainer = document.getElementById('dr-integrated-proposal-container');
      expect(integratedContainer.style.display).toBe('none');
      expect(rawEditor.style.display).toBe('flex');

      const toggleBanner = document.getElementById('dr-switch-to-proposal-banner');
      expect(toggleBanner).not.toBeNull();
      expect(toggleBanner.style.display).toBe('flex');
    });

    it('keepOriginalNote marks note reviewed and advances to next note', async () => {
      DailyReviewController.toggleNoteReviewed = vi.fn().mockResolvedValue(true);
      const advanceSpy = vi.spyOn(DailyReviewController, 'advanceToNextNote').mockResolvedValue();

      await DailyReviewController.keepOriginalNote();

      expect(DailyReviewController.toggleNoteReviewed).toHaveBeenCalledWith('notes/1.html', true);
      expect(global.toast).toHaveBeenCalledWith('refactor.keptOriginal');
      expect(advanceSpy).toHaveBeenCalled();
      advanceSpy.mockRestore();
    });

    it('advanceToNextNote selects next unreviewed note or updates button state if done', async () => {
      DailyReviewController.selectNoteForReview = vi.fn().mockResolvedValue(true);
      DailyReviewController.updateMarkReviewedButtonState = vi.fn();
      DailyReviewController.todayNotes = [
        { path: 'notes/1.html', id: 'note1', title: 'Note 1', reviewed: false },
        { path: 'notes/2.html', id: 'note2', title: 'Note 2', reviewed: false }
      ];

      // When note 2 is unreviewed
      manifest = [
        { path: 'notes/1.html', reviewed: true },
        { path: 'notes/2.html', reviewed: false }
      ];
      window.manifest = manifest;
      DailyReviewController.activeNotePath = 'notes/1.html';
      await DailyReviewController.advanceToNextNote();
      expect(DailyReviewController.selectNoteForReview).toHaveBeenCalledWith('notes/2.html');

      // When note 2 is already reviewed
      DailyReviewController.selectNoteForReview.mockClear();
      manifest = [
        { path: 'notes/1.html', reviewed: true },
        { path: 'notes/2.html', reviewed: true }
      ];
      window.manifest = manifest;
      await DailyReviewController.advanceToNextNote();
      expect(DailyReviewController.selectNoteForReview).not.toHaveBeenCalled();
      expect(DailyReviewController.updateMarkReviewedButtonState).toHaveBeenCalled();
    });

    it('generateIntegratedOptionC prompts for feedback if empty and calls refineAmendedProposal when provided', async () => {
      await DailyReviewController.renderIntegratedProposalView('notes/1.html');
      const input = document.getElementById('dr-integrated-feedback-input');

      // Empty feedback
      input.value = '   ';
      await DailyReviewController.generateIntegratedOptionC();
      expect(global.toast).toHaveBeenCalledWith('refactor.enterFeedbackPrompt', true);

      // Valid feedback
      input.value = 'Focus more on architecture and next steps';
      global.LLMService.refineAmendedProposal = vi.fn().mockResolvedValue({
        proposalC: '<h2>Option C</h2><p>Synthesized architecture</p>',
        meetingSummary: '<p>Synthesized summary</p>',
        proposedDecisions: [],
        proposedTodos: [],
        proposedColleagues: [],
        proposedNotes: []
      });

      await DailyReviewController.generateIntegratedOptionC();

      expect(global.LLMService.refineAmendedProposal).toHaveBeenCalled();
      expect(DailyReviewController.noteProposals['notes/1.html'].proposalC).toContain('Synthesized architecture');
      const tabC = document.getElementById('dr-tab-proposal-c');
      expect(tabC.style.display).toBe('inline-flex');
      expect(DailyReviewController.integratedActiveTab).toBe('C');
    });

    it('copyIntegratedProposal copies rendered proposal to clipboard', () => {
      const previewHtml = document.getElementById('dr-integrated-proposal-html');
      previewHtml.innerHTML = '<p>Copied content</p>';

      const writeTextMock = vi.fn().mockResolvedValue();
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeTextMock },
        configurable: true
      });

      DailyReviewController.copyIntegratedProposal();

      expect(writeTextMock).toHaveBeenCalledWith('<p>Copied content</p>');
    });

    it('formatProposal delegates formatting to formatRichTextInEditor targeting preview pane', () => {
      global.formatRichTextInEditor = vi.fn();
      const previewPane = document.getElementById('dr-integrated-preview-pane');

      DailyReviewController.formatProposal('bold');

      expect(global.formatRichTextInEditor).toHaveBeenCalledWith(previewPane, 'bold');

      DailyReviewController.formatProposal('h1set');
      expect(global.formatRichTextInEditor).toHaveBeenCalledWith(previewPane, 'h1set');
    });

    it('switchIntegratedTab toggles formatting toolbar visibility', () => {
      DailyReviewController.renderIntegratedProposalView('notes/1.html');
      const toolbar = document.getElementById('dr-integrated-toolbar');

      DailyReviewController.switchIntegratedTab('scratchpad');
      expect(toolbar.style.display).toBe('none');

      DailyReviewController.switchIntegratedTab('A');
      expect(toolbar.style.display).toBe('flex');
    });

    it('removes ready proposal and clears ready badge from DOM when applied', async () => {
      const listEl = document.getElementById('dr-notes-to-review-list');
      listEl.innerHTML = `
        <button class="dr-note-item-btn active" data-note-path="notes/1.html">
          <span class="dr-batch-badge status-ready">✨ Ready</span>
          <span class="dr-note-checkbox-indicator"></span>
        </button>
      `;

      DailyReviewController.renderIntegratedProposalView('notes/1.html');
      DailyReviewController.toggleNoteReviewed = vi.fn().mockResolvedValue(true);
      DailyReviewController.advanceToNextNote = vi.fn();

      await DailyReviewController.applyIntegratedProposal();

      // Proposal state should be removed
      expect(DailyReviewController.noteProposals['notes/1.html']).toBeUndefined();

      // Badge should be removed from DOM
      const badge = listEl.querySelector('.dr-batch-badge');
      expect(badge).toBeNull();
    });

    it('removes ready proposal and clears ready badge from DOM when keeping original', async () => {
      const listEl = document.getElementById('dr-notes-to-review-list');
      listEl.innerHTML = `
        <button class="dr-note-item-btn active" data-note-path="notes/1.html">
          <span class="dr-batch-badge status-ready">✨ Ready</span>
          <span class="dr-note-checkbox-indicator"></span>
        </button>
      `;

      DailyReviewController.renderIntegratedProposalView('notes/1.html');
      DailyReviewController.toggleNoteReviewed = vi.fn().mockResolvedValue(true);
      DailyReviewController.advanceToNextNote = vi.fn();

      await DailyReviewController.keepOriginalNote();

      // Proposal state should be removed
      expect(DailyReviewController.noteProposals['notes/1.html']).toBeUndefined();

      // Badge should be removed from DOM
      const badge = listEl.querySelector('.dr-batch-badge');
      expect(badge).toBeNull();
    });
  });
});
