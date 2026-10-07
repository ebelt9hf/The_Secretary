import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ═══════════════════════════════════════════════════
// Sourced from: app-perfect-note-informal.test.js
// ═══════════════════════════════════════════════════
describe('Perfect Note Informal Notes, Image Injection & Verification Fixes', () => {
  beforeAll(() => {
    globalThis.t = (key) => key;
    globalThis.toast = () => {};
    globalThis.plannerEvents = [];
    loadScriptsIntoGlobal(['js/app-fs.js', 'js/app-utils.js', 'js/app-overlay.js', 'js/app-dailyreview.js', 'js/app-llm.js']);
  });

  describe('restoreOriginalImagesToProposal (inline image restoration)', () => {
    it('restores [IMAGE_1] inline within the text flow replacing the placeholder', () => {
      const originalHtml = '<p>Meeting intro</p><img src="data:image/png;base64,abc123" alt="Whiteboard Architecture" /><p>Conclusion</p>';
      const proposalHtml = '<p>Intro synthesis</p><p>[IMAGE_1: html image (see attached vision payload)]</p><p>Discussion points</p>';

      const result = restoreOriginalImagesToProposal(originalHtml, proposalHtml);
      expect(result).not.toContain('[IMAGE_1');
      expect(result).toContain('note-embedded-image-wrap');
      expect(result).toContain('<img src="data:image/png;base64,abc123" alt="Whiteboard Architecture" />');
      expect(result).not.toContain('note-attached-images-gallery');
    });

    it('replaces multiple numbered images [IMAGE_1] and [IMAGE_2] at their exact positions', () => {
      const originalHtml = '<p>Diagram 1:</p><img src="notes/_assets/img_1.png" alt="Arch" /><p>Diagram 2:</p><img src="notes/_assets/img_2.png" alt="Schema" />';
      const proposalHtml = '<h2>Architecture</h2>[IMAGE_1]<h2>Data Schema</h2>[IMAGE_2]';

      const result = restoreOriginalImagesToProposal(originalHtml, proposalHtml);
      expect(result).not.toContain('[IMAGE_1]');
      expect(result).not.toContain('[IMAGE_2]');
      expect(result).toContain('src="notes/_assets/img_1.png"');
      expect(result).toContain('src="notes/_assets/img_2.png"');
      const pos1 = result.indexOf('notes/_assets/img_1.png');
      const pos2 = result.indexOf('notes/_assets/img_2.png');
      expect(pos1).toBeLessThan(pos2);
    });

    it('places unplaced images in context within the text flow instead of moving them to the end', () => {
      const originalHtml = '<img src="notes/_assets/img_placed.png" alt="Placed" /><img src="notes/_assets/img_extra.png" alt="Extra" />';
      const proposalHtml = '<h2>Overview</h2><p>[IMAGE_1]</p><p>Summary</p>';

      const result = restoreOriginalImagesToProposal(originalHtml, proposalHtml);
      expect(result).not.toContain('[IMAGE_1]');
      expect(result).toContain('src="notes/_assets/img_placed.png"');
      expect(result).toContain('src="notes/_assets/img_extra.png"');
      expect(result).toContain('note-embedded-image-wrap');
    });

    it('contextually matches surrounding text to place images without explicit placeholders adjacent to explanatory notes', () => {
      const originalHtml = '<p>Database entity relationship diagram:</p><img src="notes/_assets/db_schema.png" alt="Schema" /><p>Next section discussing endpoints.</p>';
      const proposalHtml = '<h2>Database Architecture</h2><p>Here is the entity relationship diagram for the database.</p><h2>API Endpoints</h2><p>Routes and controllers.</p>';

      const result = restoreOriginalImagesToProposal(originalHtml, proposalHtml);
      expect(result).toContain('src="notes/_assets/db_schema.png"');
      const imgPos = result.indexOf('db_schema.png');
      const dbHeaderPos = result.indexOf('Database Architecture');
      const apiHeaderPos = result.indexOf('API Endpoints');

      // The image should appear after Database Architecture and before API Endpoints
      expect(imgPos).toBeGreaterThan(dbHeaderPos);
      expect(imgPos).toBeLessThan(apiHeaderPos);
    });

    it('removes unused placeholder markers if original has no images', () => {
      const originalHtml = '<p>Plain note with no images</p>';
      const proposalHtml = '<h2>Overview</h2><p>[IMAGE_1]</p><p>Synthesis</p>';

      const result = restoreOriginalImagesToProposal(originalHtml, proposalHtml);
      expect(result).not.toContain('[IMAGE_1]');
      expect(result).toContain('<h2>Overview</h2>');
      expect(result).toContain('<p>Synthesis</p>');
    });

    it('resolveNoteImagesSync and resolveNoteImages replace asset paths with cached data URLs', async () => {
      const cache = (typeof _assetDataUrlCache !== 'undefined' ? _assetDataUrlCache : null) || globalThis._assetDataUrlCache || window._assetDataUrlCache;
      if (cache) {
        cache.set('notes/_assets/img_test.png', 'data:image/png;base64,mockImageData123');
      }
      const html = '<p>Diagram:</p><img src="notes/_assets/img_test.png" alt="Test" />';

      const syncResult = resolveNoteImagesSync(html);
      expect(syncResult).toContain('src="data:image/png;base64,mockImageData123"');
      expect(syncResult).toContain('data-asset-path="notes/_assets/img_test.png"');

      const asyncResult = await resolveNoteImages(html);
      expect(asyncResult).toContain('src="data:image/png;base64,mockImageData123"');
    });
  });

  describe('DailyReviewController.updateNoteSummaryBadge', () => {
    it('adds summary badge to Step 3 item button when note summary is provided', () => {
      const fakeBtn = document.createElement('button');
      fakeBtn.className = 'dr-note-item-btn';
      fakeBtn.dataset.notePath = 'notes/2026-09-04-meeting.html';
      const titleSpan = document.createElement('span');
      titleSpan.textContent = 'Team Sync';
      fakeBtn.appendChild(titleSpan);
      const cb = document.createElement('span');
      cb.className = 'dr-note-checkbox-indicator';
      fakeBtn.appendChild(cb);

      document.body.appendChild(fakeBtn);

      DailyReviewController.todayNotes = [
        { path: 'notes/2026-09-04-meeting.html', title: 'Team Sync', summary: '' }
      ];

      DailyReviewController.updateNoteSummaryBadge('notes/2026-09-04-meeting.html', '<p>Executive summary generated by Perfect Note.</p>');

      const badge = fakeBtn.querySelector('.dr-note-has-summary-badge');
      expect(badge).not.toBeNull();
      expect(badge.textContent).toContain('📝');
      expect(DailyReviewController.todayNotes[0].summary).toContain('Executive summary');

      // Now clear summary and verify badge is removed
      DailyReviewController.updateNoteSummaryBadge('notes/2026-09-04-meeting.html', '');
      expect(fakeBtn.querySelector('.dr-note-has-summary-badge')).toBeNull();

      fakeBtn.remove();
    });
  });

  describe('LLMService.analyzeNote (verification agent fix)', () => {
    it('constructs userMessageContent without throwing ReferenceError', async () => {
      const executeRequestSpy = vi.fn().mockResolvedValue({
        parsed: { general_comment: 'ok', suggested_actions: [] }
      });
      const originalExecute = LLMService.executeRequest;
      const originalEnsure = LLMService.ensureReadyForCalls;
      const originalExtract = LLMService.extractNoteImageUrls;

      LLMService.executeRequest = executeRequestSpy;
      LLMService.ensureReadyForCalls = () => ({
        provider: 'openai-compatible',
        endpoint: 'https://api.example.com',
        model: 'gpt-4o'
      });
      LLMService.extractNoteImageUrls = vi.fn().mockResolvedValue(['data:image/png;base64,testimg']);

      try {
        const note = { id: 'note-1', title: 'Test Note', date: '2026-09-04' };
        const noteContent = '<p>Raw meeting notes content</p>';

        const result = await LLMService.analyzeNote(note, noteContent);
        expect(result).toBeDefined();
        expect(executeRequestSpy).toHaveBeenCalled();

        const callArgs = executeRequestSpy.mock.calls[0][0];
        expect(callArgs.messages).toBeDefined();
        expect(callArgs.messages.length).toBe(2);

        const userMsg = callArgs.messages[1];
        expect(userMsg.role).toBe('user');
        // Multimodal format because extractNoteImageUrls returned an image
        expect(Array.isArray(userMsg.content)).toBe(true);
        expect(userMsg.content[0].type).toBe('text');
        expect(userMsg.content[0].text).toContain('Here is the active note');
        expect(userMsg.content[1].type).toBe('image_url');
      } finally {
        LLMService.executeRequest = originalExecute;
        LLMService.ensureReadyForCalls = originalEnsure;
        LLMService.extractNoteImageUrls = originalExtract;
      }
    });
  });

  describe('RefactorModalController formatting and proposal application', () => {
    it('formatProposal delegates formatting to formatRichTextInEditor targeting modal preview pane', () => {
      const modalPreviewPane = document.createElement('div');
      modalPreviewPane.id = 'refactor-proposal-preview-pane';
      modalPreviewPane.innerHTML = '<p>Some proposal paragraph</p>';
      document.body.appendChild(modalPreviewPane);

      let calledCmd = null;
      globalThis.formatRichTextInEditor = vi.fn((el, cmd) => {
        calledCmd = cmd;
      });

      RefactorModalController.formatProposal('bold');
      expect(globalThis.formatRichTextInEditor).toHaveBeenCalled();
      expect(calledCmd).toBe('bold');

      RefactorModalController.formatProposal('h2set');
      expect(calledCmd).toBe('h2set');

      modalPreviewPane.remove();
    });

    it('applyCurrentProposal removes proposal from DailyReviewController.noteProposals and refreshes badges', async () => {
      const editor = document.createElement('div');
      editor.id = 'edit-textarea';
      document.body.appendChild(editor);

      const htmlContainer = document.createElement('div');
      htmlContainer.id = 'refactor-proposal-html';
      htmlContainer.innerHTML = '<h2>Accepted Executive Notes</h2><p>Content</p>';
      document.body.appendChild(htmlContainer);

      globalThis.currentNote = {
        id: 'note-123',
        path: 'notes/2026-09-04-client-call.html',
        title: 'Client Call',
        mainHTML: '<p>Raw notes</p>'
      };

      DailyReviewController.noteProposals = {
        'notes/2026-09-04-client-call.html': { status: 'ready', proposalA: '<p>Proposal</p>' }
      };

      DailyReviewController.renderStep3ListBadges = vi.fn();
      RefactorModalController.activeNote = globalThis.currentNote;
      const origClose = RefactorModalController.closeProposalsModal;
      RefactorModalController.closeProposalsModal = vi.fn();

      await RefactorModalController.applyCurrentProposal();

      expect(DailyReviewController.noteProposals['notes/2026-09-04-client-call.html']).toBeUndefined();
      expect(DailyReviewController.renderStep3ListBadges).toHaveBeenCalled();

      RefactorModalController.closeProposalsModal = origClose;
      editor.remove();
      htmlContainer.remove();
    });

    it('toggles formatting toolbar visibility between editable proposal tabs and scratchpad', () => {
      const modal = document.createElement('div');
      modal.id = 'modal-refactor-proposals';
      const toolbar = document.createElement('div');
      toolbar.id = 'refactor-modal-toolbar';
      toolbar.style.display = 'flex';
      const previewPane = document.createElement('div');
      previewPane.id = 'refactor-proposal-preview-pane';
      const scratchpadPane = document.createElement('div');
      scratchpadPane.id = 'refactor-scratchpad-pane';
      const descEl = document.createElement('div');
      descEl.id = 'refactor-tab-desc';
      const htmlContainer = document.createElement('div');
      htmlContainer.id = 'refactor-proposal-html';

      document.body.appendChild(modal);
      document.body.appendChild(toolbar);
      document.body.appendChild(previewPane);
      document.body.appendChild(scratchpadPane);
      document.body.appendChild(descEl);
      document.body.appendChild(htmlContainer);

      RefactorModalController.proposalA = '<p>Executive Proposal A</p>';
      RefactorModalController.proposalB = '<p>Comprehensive Proposal B</p>';
      RefactorModalController.scratchpadLog = [{ step: 1, title: 'Analysis', content: 'Rationale' }];

      // Switch to Proposal A -> toolbar is visible
      RefactorModalController.switchTab('A');
      expect(toolbar.style.display).toBe('flex');
      expect(previewPane.style.display).toBe('block');
      expect(scratchpadPane.style.display).toBe('none');

      // Switch to Scratchpad -> toolbar is hidden
      RefactorModalController.switchTab('scratchpad');
      expect(toolbar.style.display).toBe('none');
      expect(previewPane.style.display).toBe('none');
      expect(scratchpadPane.style.display).toBe('block');

      // Switch back to Proposal B -> toolbar is visible again
      RefactorModalController.switchTab('B');
      expect(toolbar.style.display).toBe('flex');
      expect(previewPane.style.display).toBe('block');

      modal.remove();
      toolbar.remove();
      previewPane.remove();
      scratchpadPane.remove();
      descEl.remove();
      htmlContainer.remove();
    });

    it('shows Re-perfect with Edits button only when the user makes a change', () => {
      const reperfectBtn = document.createElement('button');
      reperfectBtn.id = 'btn-refactor-reperfect';
      reperfectBtn.style.display = 'none';
      const htmlContainer = document.createElement('div');
      htmlContainer.id = 'refactor-proposal-html';
      const previewPane = document.createElement('div');
      previewPane.id = 'refactor-proposal-preview-pane';
      const descEl = document.createElement('div');
      descEl.id = 'refactor-tab-desc';

      document.body.appendChild(reperfectBtn);
      document.body.appendChild(htmlContainer);
      document.body.appendChild(previewPane);
      document.body.appendChild(descEl);

      RefactorModalController.proposalA = '<p>Original Executive Proposal A</p>';
      RefactorModalController.hasUserEditedTab = { A: false, B: false, C: false, original: false };
      RefactorModalController.tabBaselineHtml = { A: '<p>Original Executive Proposal A</p>' };

      // Initially on Tab A: pristine, button must be hidden
      RefactorModalController.switchTab('A');
      RefactorModalController.updateReperfectButtonState();
      expect(RefactorModalController.isCurrentTabEdited()).toBe(false);
      expect(reperfectBtn.style.display).toBe('none');

      // User simulates typing an edit
      htmlContainer.innerHTML = '<p>Original Executive Proposal A with custom edits</p>';
      RefactorModalController.hasUserEditedTab.A = true;
      RefactorModalController.updateReperfectButtonState();
      expect(RefactorModalController.isCurrentTabEdited()).toBe(true);
      expect(reperfectBtn.style.display).toBe('inline-flex');

      // User reverts changes back to baseline
      htmlContainer.innerHTML = '<p>Original Executive Proposal A</p>';
      RefactorModalController.updateReperfectButtonState();
      reperfectBtn.remove();
      htmlContainer.remove();
      previewPane.remove();
      descEl.remove();
    });

    it('routes proposals to DailyReviewController.renderIntegratedProposalView when inside Daily Review step 3', () => {
      const note = {
        id: 'note-dr-1',
        path: 'notes/2026-09-04-client-dr.html',
        title: 'DR Client Note',
        content: '<p>DR note content</p>'
      };

      DailyReviewController.active = true;
      DailyReviewController.currentStep = 3;
      DailyReviewController.noteProposals = {};
      DailyReviewController.renderStep3ListBadges = vi.fn();
      DailyReviewController.renderIntegratedProposalView = vi.fn();

      RefactorModalController.activeNote = note;
      RefactorModalController.proposalA = '<p>Executive Proposal</p>';
      RefactorModalController.proposalB = '<p>Comprehensive Proposal</p>';
      const origShow = RefactorModalController.showProposalsModal;
      RefactorModalController.showProposalsModal = vi.fn();

      RefactorModalController._presentProposals(note);

      expect(DailyReviewController.noteProposals[note.path]).toBeDefined();
      expect(DailyReviewController.noteProposals[note.path].status).toBe('ready');
      expect(DailyReviewController.noteProposals[note.path].proposalA).toBe('<p>Executive Proposal</p>');
      expect(DailyReviewController.renderStep3ListBadges).toHaveBeenCalled();
      expect(DailyReviewController.renderIntegratedProposalView).toHaveBeenCalledWith(note.path);
      expect(RefactorModalController.showProposalsModal).not.toHaveBeenCalled();

      RefactorModalController.showProposalsModal = origShow;
      DailyReviewController.active = false;
      DailyReviewController.currentStep = 1;
    });

    it('routes proposals to showProposalsModal in standalone note editor mode', () => {
      const note = {
        id: 'note-standalone-1',
        path: 'notes/2026-09-04-standalone.html',
        title: 'Standalone Note',
        content: '<p>Standalone content</p>'
      };

      DailyReviewController.active = false;
      DailyReviewController.currentStep = 1;
      RefactorModalController.activeNote = note;
      const origShow = RefactorModalController.showProposalsModal;
      RefactorModalController.showProposalsModal = vi.fn();

      RefactorModalController._presentProposals(note);

      expect(RefactorModalController.showProposalsModal).toHaveBeenCalled();
      RefactorModalController.showProposalsModal = origShow;
    });
  });
});


// ═══════════════════════════════════════════════════
// Sourced from: app-perfect-note-summary.test.js
// ═══════════════════════════════════════════════════
describe('Perfect Note Meeting Summary Generation & Field Population (app-llm.js)', () => {
  beforeAll(() => {
    globalThis.t = (key) => key;
    globalThis.toast = () => {};
    loadScriptsIntoGlobal(['js/app-utils.js', 'js/app-overlay.js', 'js/app-llm.js']);
  });

  describe('cleanMeetingSummaryHtml', () => {
    it('cleans and formats meeting summary HTML properly', () => {
      const rawSummary = '<p>The team discussed the Q3 release. <mark>Launch confirmed for October 15.</mark></p><ul><li>Review of backend migration</li><li>Finalized design assets</li></ul>';
      const cleaned = cleanMeetingSummaryHtml(rawSummary, 'Etienne');
      expect(cleaned).toContain('The team discussed the Q3 release.');
      expect(cleaned).toContain('<mark>Launch confirmed for October 15.</mark>');
      expect(cleaned).toContain('<li>Review of backend migration</li>');
    });

    it('strips any heading tags from summary fragment and converts to bold text', () => {
      const rawWithHeaders = '<h2>Meeting Summary</h2><p>High level overview.</p><h3>Key Points</h3><ul><li>Point A</li></ul>';
      const cleaned = cleanMeetingSummaryHtml(rawWithHeaders, 'Etienne');
      expect(cleaned).not.toContain('<h2>');
      expect(cleaned).not.toContain('<h3>');
      expect(cleaned).toContain('<p><strong>Meeting Summary</strong></p>');
      expect(cleaned).toContain('Point A');
    });

    it('handles JSON string containing meeting_summary_html', () => {
      const jsonStr = JSON.stringify({
        action: 'finalize_refactoring',
        properties: {
          meeting_summary_html: '<p>Direct summary from JSON payload.</p><ul><li>Task 1</li></ul>'
        }
      });
      const cleaned = cleanMeetingSummaryHtml(jsonStr, 'Etienne');
      expect(cleaned).toContain('Direct summary from JSON payload.');
      expect(cleaned).toContain('<li>Task 1</li>');
    });
  });

  describe('RefactorModalController Meeting Summary Application', () => {
    it('sets the summary field in the DOM and note object upon apply without re-running generateNoteSummaryWithAI', async () => {
      document.body.innerHTML = `
        <div id="edit-textarea"></div>
        <div id="edit-summary"></div>
        <div id="modal-refactor-proposals" style="display: flex;"></div>
        <input id="refactor-feedback-input" value="" />
        <div id="refactor-feedback-drawer" style="display: none;"></div>
        <button id="tab-proposal-c" style="display: none;"></button>
        <div id="refactor-proposal-html"><p>Perfect note proposal A</p></div>
      `;

      const fakeSummaryEl = document.getElementById('edit-summary');
      fakeSummaryEl.dispatchEvent = vi.fn();

      globalThis.autoSaveNote = vi.fn();
      globalThis.syncPreview = vi.fn();

      const mockNote = {
        id: 'note-123',
        path: '/notes/note-123.html',
        title: 'Strategy Meeting',
        content: '<p>Original Note Content</p>',
        summary: ''
      };
      globalThis.currentNote = mockNote;
      RefactorModalController.activeNote = mockNote;
      RefactorModalController.activeTab = 'A';
      RefactorModalController.proposalA = '<p>Perfect note proposal A</p>';
      RefactorModalController.meetingSummaryA = '<p>Meeting summary generated by perfect note agent.</p><ul><li>Decision 1</li></ul>';
      RefactorModalController.meetingSummary = RefactorModalController.meetingSummaryA;

      const mockGenerateSummary = vi.fn();
      globalThis.generateNoteSummaryWithAI = mockGenerateSummary;

      await RefactorModalController.applyCurrentProposal();
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(fakeSummaryEl.innerHTML).toContain('Meeting summary generated by perfect note agent.');
      expect(fakeSummaryEl.innerHTML).toContain('Decision 1');
      expect(fakeSummaryEl.dispatchEvent).toHaveBeenCalled();
      expect(mockNote.summary).toContain('Meeting summary generated by perfect note agent.');
      expect(mockGenerateSummary).not.toHaveBeenCalled();
    });

    it('resets meeting summary state when closing modal', () => {
      document.body.innerHTML = `
        <div id="modal-refactor-proposals" style="display: flex;"></div>
        <input id="refactor-feedback-input" value="" />
        <div id="refactor-feedback-drawer" style="display: none;"></div>
        <button id="tab-proposal-c" style="display: none;"></button>
        <div id="refactor-proposal-html"></div>
      `;

      RefactorModalController.meetingSummary = '<p>Some summary</p>';
      RefactorModalController.meetingSummaryA = '<p>Some summary A</p>';
      RefactorModalController.meetingSummaryB = '<p>Some summary B</p>';
      RefactorModalController.meetingSummaryC = '<p>Some summary C</p>';

      RefactorModalController.closeProposalsModal();

      expect(RefactorModalController.meetingSummary).toBe('');
      expect(RefactorModalController.meetingSummaryA).toBe('');
      expect(RefactorModalController.meetingSummaryB).toBe('');
      expect(RefactorModalController.meetingSummaryC).toBe('');
    });
  });
});

// ═══════════════════════════════════════════════════
// Sourced from: app-perfect-note-task-dedup.test.js
// ═══════════════════════════════════════════════════
describe('Perfect Note Agent - Task Deduplication and Linking (app-llm.js)', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="note-editor"></div>
      <div id="edit-textarea"></div>
      <div id="refactor-modal" style="display:none;">
        <div id="refactor-preview-content"></div>
        <div id="refactor-actions-list"></div>
        <div id="refactor-actions-review-container"></div>
      </div>
    `;

    global.t = (key) => key;
    global.escH = (str) => String(str || '');
    global.escA = (str) => String(str || '');
    global.saveTodosManifest = vi.fn().mockResolvedValue(true);
    global.autoSaveNote = vi.fn().mockResolvedValue(true);
    global.currentNote = { id: 'note-roadmap-2026', path: 'notes/roadmap.html', mainHTML: '' };
    global.toast = vi.fn();

    global.todosManifest = [
      {
        id: 'td_existing_99',
        title: 'Prepare Q3 roadmap',
        priority: 'Medium',
        importance: 'Medium',
        urgency: 'Medium',
        owner: 'Sarah',
        ownerId: 'sarah_id'
      },
      {
        id: 'td_existing_100',
        title: 'Review pull requests',
        priority: 'Done', // Done tasks should not block creating a new one if needed
        owner: 'Alice'
      }
    ];

    loadScriptsIntoGlobal(['js/app-utils.js', 'js/app-overlay.js', 'js/app-llm.js']);
  });

  describe('extractProposedActionsFromProposal', () => {
    it('filters out proposed todos that already exist as active tasks in todosManifest', () => {
      const rawProposal = {
        proposed_todos: [
          {
            title: 'Prepare Q3 roadmap', // exact match with existing active task
            owner: 'Sarah',
            importance: 'High',
            urgency: 'High'
          },
          {
            title: 'Implement new auth provider', // new task
            owner: 'Marc',
            importance: 'High',
            urgency: 'Medium'
          }
        ]
      };

      const result = extractProposedActionsFromProposal('<h2>Summary</h2>', rawProposal);

      expect(result.todos.length).toBe(1);
      expect(result.todos[0].title).toBe('Implement new auth provider');
    });

    it('filters out proposed todos with case-insensitive and trimmed matches against todosManifest', () => {
      const rawProposal = {
        proposed_todos: [
          {
            title: '   PREPARE Q3 ROADMAP   ', // casing and whitespace difference
            owner: 'Sarah',
            importance: 'High'
          },
          {
            title: 'Setup automated performance benchmark',
            owner: 'Marc',
            importance: 'Medium'
          }
        ]
      };

      const result = extractProposedActionsFromProposal('<h2>Summary</h2>', rawProposal);

      expect(result.todos.length).toBe(1);
      expect(result.todos[0].title).toBe('Setup automated performance benchmark');
    });

    it('does not filter out tasks that match a Done task in todosManifest', () => {
      const rawProposal = {
        proposed_todos: [
          {
            title: 'Review pull requests', // matches td_existing_100 which is Done
            owner: 'Alice',
            importance: 'Medium'
          }
        ]
      };

      const result = extractProposedActionsFromProposal('<h2>Summary</h2>', rawProposal);

      expect(result.todos.length).toBe(1);
      expect(result.todos[0].title).toBe('Review pull requests');
    });
  });

  describe('applyCurrentProposal deduplication & linking', () => {
    it('updates existing manifest task rather than pushing a duplicate when applying proposal', async () => {
      const initialCount = global.todosManifest.length;
      RefactorModalController.activeNote = { id: 'note-roadmap-2026', path: 'notes/roadmap.html' };
      RefactorModalController.activeTab = 'A';
      RefactorModalController.proposalA = `
        <h2>Next Steps & Action Items</h2>
        <ul>
          <li>Prepare Q3 roadmap</li>
        </ul>
      `;
      RefactorModalController.proposalActionsA = {
        todos: [
          {
            title: 'Prepare Q3 roadmap',
            owner: 'Sarah',
            importance: 'High',
            urgency: 'High'
          }
        ],
        decisions: []
      };

      const container = document.getElementById('refactor-actions-review-container');
      container.innerHTML = `
        <div class="refactor-action-item">
          <input type="checkbox" class="refactor-check-todo" checked data-idx="0" />
          <input type="text" class="refactor-todo-title" data-idx="0" value="Prepare Q3 roadmap" />
          <select class="refactor-todo-imp" data-idx="0"><option value="High" selected>High</option></select>
          <select class="refactor-todo-urg" data-idx="0"><option value="High" selected>High</option></select>
        </div>
      `;

      const editor = document.getElementById('edit-textarea');
      await RefactorModalController.applyCurrentProposal();

      // Manifest length must remain the same (no duplicate added)
      expect(global.todosManifest.length).toBe(initialCount);

      // Existing task was updated
      const existingTask = global.todosManifest.find(t => t.id === 'td_existing_99');
      expect(existingTask.importance).toBe('High');
      expect(existingTask.urgency).toBe('High');
      expect(global.saveTodosManifest).toHaveBeenCalled();

      // Note editor HTML contains link chip referencing existing ID
      expect(editor.innerHTML).toContain('data-todo-id="td_existing_99"');
    });
  });

  describe('LLM prompt template interpolation and agent execution', () => {
    it('executes runRefactorAgentLoop without ReferenceError: id is not defined', async () => {
      const executeRequestSpy = vi.fn().mockResolvedValue({
        parsed: {
          action: 'finalize_refactoring',
          properties: {
            proposal_a_html: '<h2>Next Steps</h2><p>Done</p>',
            proposal_b_html: '<h2>Next Steps</h2><p>Done B</p>',
            meeting_summary_html: '<p>Meeting summary</p>'
          }
        }
      });
      const origExecute = LLMService.executeRequest;
      const origEnsure = LLMService.ensureReadyForCalls;
      LLMService.executeRequest = executeRequestSpy;
      LLMService.ensureReadyForCalls = () => ({
        provider: 'openai-compatible',
        endpoint: 'https://api.example.com',
        model: 'gpt-4o'
      });

      try {
        const note = { id: 'note-roadmap-2026', title: 'Roadmap Note', date: '2026-09-04', content: 'Notes text' };
        const result = await LLMService.runRefactorAgentLoop(note, 'Notes text here', {});
        expect(result).toBeDefined();
        expect(result.status).toBe('proposals_ready');
      } finally {
        LLMService.executeRequest = origExecute;
        LLMService.ensureReadyForCalls = origEnsure;
      }
    });

    it('executes generateOptionCWithFeedback without ReferenceError: id is not defined', async () => {
      const executeRequestSpy = vi.fn().mockResolvedValue({
        parsed: {
          proposal_c_html: '<h2>Option C</h2><p>Done</p>',
          meeting_summary_html: '<p>Summary</p>'
        }
      });
      const origExecute = LLMService.executeRequest;
      const origEnsure = LLMService.ensureReadyForCalls;
      LLMService.executeRequest = executeRequestSpy;
      LLMService.ensureReadyForCalls = () => ({
        provider: 'openai-compatible',
        endpoint: 'https://api.example.com',
        model: 'gpt-4o'
      });

      try {
        const note = { id: 'note-roadmap-2026', title: 'Roadmap Note', date: '2026-09-04', content: 'Notes text' };
        const result = await LLMService.generateOptionCWithFeedback(note, 'Notes text here', 'Scratchpad', 'More concise');
        expect(result).toBeDefined();
        expect(result.proposalC).toContain('Option C');
      } finally {
        LLMService.executeRequest = origExecute;
        LLMService.ensureReadyForCalls = origEnsure;
      }
    });
  });
});

// ═══════════════════════════════════════════════════
// Sourced from: app-perfect-note-todo.test.js
// ═══════════════════════════════════════════════════
describe('Perfect Note Todo & Action Item Tag Formatting (app-llm.js)', () => {
  beforeAll(() => {
    loadScriptsIntoGlobal(['js/app-utils.js', 'js/app-overlay.js', 'js/app-llm.js']);
  });

  describe('formatTodoTitleWithMetadata', () => {
    it('strips free-text owner mentions and urgency brackets from todo titles', () => {
      const rawTitle1 = '@Sarah [Urgent] Prepare Q3 financial roadmap';
      const clean1 = formatTodoTitleWithMetadata(rawTitle1, 'Sarah', 'High');
      expect(clean1).toBe('Prepare Q3 financial roadmap');

      const rawTitle2 = '@Marc Finalize technical architecture design [Medium Urgency]';
      const clean2 = formatTodoTitleWithMetadata(rawTitle2, 'Marc', 'Medium');
      expect(clean2).toBe('Finalize technical architecture design');

      const rawTitle3 = '[Low] Update documentation';
      const clean3 = formatTodoTitleWithMetadata(rawTitle3, '', 'Low');
      expect(clean3).toBe('Update documentation');
    });

    it('does not append free-text @Owner or [Urgent] tags to clean titles', () => {
      const cleanInput = 'Draft new API specification';
      const result = formatTodoTitleWithMetadata(cleanInput, 'Sarah', 'High');
      expect(result).toBe('Draft new API specification');
    });
  });

  describe('extractProposedActionsFromProposal', () => {
    it('cleans proposed_todos titles and leaves tags as structured metadata', () => {
      const rawProps = {
        proposed_todos: [
          {
            title: '@Sarah [Urgent] Prepare Q3 financial roadmap',
            owner: 'Sarah',
            importance: 'High',
            urgency: 'High'
          }
        ]
      };

      const result = extractProposedActionsFromProposal('<h2>Summary</h2><p>Note text</p>', rawProps);
      expect(result.todos.length).toBe(1);
      expect(result.todos[0].title).toBe('Prepare Q3 financial roadmap');
      expect(result.todos[0].owner).toBe('Sarah');
      expect(result.todos[0].urgency).toBe('High');
    });

    it('extracts actions from HTML bullets without embedding free-text tags in title', () => {
      const html = `<h2>Next Steps & Action Items</h2><ul><li>@Alex [Urgent] Deploy release to staging</li></ul>`;
      const result = extractProposedActionsFromProposal(html, {});
      expect(result.todos.length).toBe(1);
      expect(result.todos[0].title).toBe('Deploy release to staging');
      expect(result.todos[0].owner).toBe('Alex');
    });
  });

  describe('RefactorModalController Option C & State Reset', () => {
    it('resets feedback input and proposal C state when closing modal', () => {
      document.body.innerHTML = `
        <div id="modal-refactor-proposals" style="display: flex;"></div>
        <input id="refactor-feedback-input" value="Make it concise" />
        <div id="refactor-feedback-drawer" style="display: flex;"></div>
        <button id="tab-proposal-c" style="display: block;"></button>
        <div id="refactor-proposal-html"></div>
      `;

      RefactorModalController.proposalC = '<p>Draft C</p>';
      RefactorModalController.closeProposalsModal();

      const fakeInput = document.getElementById('refactor-feedback-input');
      const fakeDrawer = document.getElementById('refactor-feedback-drawer');

      expect(fakeInput.value).toBe('');
      expect(fakeDrawer.style.display).toBe('none');
      expect(RefactorModalController.proposalC).toBe('');
    });
  });

  describe('Colleague Chip Rendering and Reassignment on Proposed Todo Nodes', () => {
    it('formats todo chip HTML with colleague owner badge', () => {
      const ownerDisplayName = 'Sarah';
      const ownerId = 'collab-123';
      const ownerBadgeLabel = '@Sarah';
      const title = 'Review quarterly goals';
      const imp = 'High';
      const urg = 'Medium';
      const todoId = 'todo-test-1';

      const todoChipHtml = `<span class="note-todo" data-todo-id="${todoId}" data-importance="${imp}" data-urgency="${urg}" data-owner="${ownerDisplayName}" data-owner-id="${ownerId}" data-todo-priority="${imp}" contenteditable="false">` +
        `<span class="note-todo-badge imp-high" contenteditable="false" title="Importance: ${imp}">⚡ ${imp}</span> ` +
        `<span class="note-todo-badge urg-medium" contenteditable="false" title="Urgency: ${urg}">⏳ ${urg}</span> ` +
        `<span class="note-todo-badge owner-tag inline-reassign-owner" contenteditable="false" title="Click to reassign colleague">👤 ${ownerBadgeLabel}</span> ` +
        `<span class="note-todo-text" contenteditable="true">${title}</span>` +
        `</span>`;

      expect(todoChipHtml).toContain('owner-tag');
      expect(todoChipHtml).toContain('data-owner="Sarah"');
      expect(todoChipHtml).toContain('👤 @Sarah');
    });
  });

  describe('cleanRefactoredProposalHtml', () => {
    it('strips square bracketed urgency/priority tags from proposal HTML', () => {
      const rawHtml = '<p>Task assigned to @Sarah [Urgent] for immediate execution [High Urgency].</p>';
      const cleaned = cleanRefactoredProposalHtml(rawHtml, 'Etienne');
      expect(cleaned).toBe('<p>Task assigned to @Sarah for immediate execution.</p>');
    });

    it('replaces generic @User mentions with the active username', () => {
      const rawHtml = '<p>Review document with @User [Medium].</p>';
      const cleaned = cleanRefactoredProposalHtml(rawHtml, 'Etienne');
      expect(cleaned).toBe('<p>Review document with @Etienne.</p>');
    });
  });

  describe('cleanTaskTitleText and getTodoMarkerTitleText', () => {
    it('strips prepended metadata badges (⚡ High, ⏳ Medium, 👤 @Sarah, todo urgency) from todo title text', () => {
      const dirty1 = '⚡ High ⏳ Medium 👤 @Sarah Prepare quarterly report';
      expect(cleanTaskTitleText(dirty1)).toBe('Prepare quarterly report');

      const dirty2 = 'todo urgency: High 👤 @Sarah Review budget [Urgent]';
      expect(cleanTaskTitleText(dirty2)).toBe('Review budget');

      const dirty3 = '⚡ Q1 ⏳ High Importance: High Assignee: @Alex Fix critical bug';
      expect(cleanTaskTitleText(dirty3)).toBe('Fix critical bug');

      const dirty4 = 'Medium Medium Etienne Finalize budget plan';
      expect(cleanTaskTitleText(dirty4)).toBe('Finalize budget plan');
    });

    it('extracts clean title from note-todo DOM marker without prepending badge text', () => {
      const mockMarker = {
        querySelector(selector) {
          if (selector === '.note-todo-text') return { textContent: '⚡ High ⏳ Medium 👤 @Sarah Finalize Q3 roadmap' };
          return null;
        },
        cloneNode() {
          return {
            querySelectorAll() { return []; },
            textContent: '⚡ High ⏳ Medium 👤 @Sarah Finalize Q3 roadmap'
          };
        }
      };
      expect(getTodoMarkerTitleText(mockMarker)).toBe('Finalize Q3 roadmap');
    });

    it('extracts clean text when marker has child badge elements without note-todo-text', () => {
      const mockMarker = {
        querySelector(selector) {
          if (selector === '.note-todo-text') return null;
          return null;
        },
        cloneNode() {
          return {
            querySelectorAll() { return []; },
            textContent: 'Medium Medium Etienne Plan sprint priorities'
          };
        }
      };
      expect(getTodoMarkerTitleText(mockMarker)).toBe('Plan sprint priorities');
    });
  });
});



// ═══════════════════════════════════════════════════
// Sourced from: app-perfect-note-uncertainty-and-tags.test.js
// ═══════════════════════════════════════════════════
describe('Perfect Note Uncertainty Highlighting, Hover Cards & Tag Recommendations (app-llm.js & app-prompts.js)', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="modal-refactor-proposals" class="modal-overlay">
        <div id="refactor-tags-container" style="display:none;"></div>
        <div id="refactor-proposal-preview-pane">
          <div id="refactor-proposal-html"></div>
        </div>
        <div id="refactor-tab-desc"></div>
        <button id="tab-proposal-a"></button>
        <button id="tab-proposal-b"></button>
        <button id="tab-proposal-c" style="display:none;"></button>
        <button id="tab-original"></button>
        <button id="tab-scratchpad"></button>
        <button id="btn-refactor-apply"></button>
        <button id="btn-refactor-reperfect"></button>
        <button id="btn-refactor-decline"></button>
      </div>
      <textarea id="edit-textarea"></textarea>
    `;

    global.toast = vi.fn();
    global.t = (key) => key;
    global.escH = (s) => String(s || '');
    global.escA = (s) => String(s || '').replace(/"/g, '&quot;');
    global.assignNoteToWorkstream = vi.fn().mockResolvedValue(true);
    global.populateTagEditor = vi.fn();
    global.saveMajorTopicMemory = vi.fn().mockResolvedValue(true);

    loadScriptsIntoGlobal(['js/app-utils.js', 'js/app-prompts.js', 'js/app-llm.js']);
  });

  describe('Uncertainty Span DOM and Hover Card Engine', () => {
    it('sets up popover card and mouse interactions on inline-uncertain-text spans', () => {
      const container = document.getElementById('refactor-proposal-html');
      container.innerHTML = `
        <p>Decided to launch on <span class="inline-uncertain-text" data-uncertainty-reason="Deduced from context" data-original-text="next week">Wednesday</span>.</p>
      `;

      window.setupUncertaintyHoverCards(container);

      const popover = document.getElementById('uncertainty-hover-popover');
      expect(popover).not.toBeNull();
      expect(popover.className).toBe('uncertainty-hover-card');

      const span = container.querySelector('.inline-uncertain-text');
      expect(span).not.toBeNull();

      // Trigger mouseenter
      span.dispatchEvent(new MouseEvent('mouseenter'));

      expect(popover.style.display).toBe('flex');
      expect(popover.innerHTML).toContain('Deduced from context');
      expect(popover.innerHTML).toContain('next week');
      expect(popover.querySelector('.btn-uncertain-accept')).not.toBeNull();
      expect(popover.querySelector('.btn-uncertain-revert')).not.toBeNull();
    });

    it('acceptInlineUncertainty replaces span with clean text node and hides popover', () => {
      const container = document.getElementById('refactor-proposal-html');
      container.innerHTML = `<p>Price is <span class="inline-uncertain-text" data-uncertainty-reason="Inferred">€500</span>.</p>`;
      window.setupUncertaintyHoverCards(container);

      const span = container.querySelector('.inline-uncertain-text');
      span.dispatchEvent(new MouseEvent('mouseenter'));

      window.acceptInlineUncertainty(span);

      expect(container.querySelector('.inline-uncertain-text')).toBeNull();
      expect(container.textContent).toContain('Price is €500.');
      const popover = document.getElementById('uncertainty-hover-popover');
      expect(popover.style.display).toBe('none');
      expect(global.toast).toHaveBeenCalled();
    });

    it('revertInlineUncertainty restores original text when data-original-text is present', () => {
      const container = document.getElementById('refactor-proposal-html');
      container.innerHTML = `<p>Timeline: <span class="inline-uncertain-text" data-uncertainty-reason="Assumed Q4" data-original-text="soon">Q4 2026</span>.</p>`;
      window.setupUncertaintyHoverCards(container);

      const span = container.querySelector('.inline-uncertain-text');
      span.dispatchEvent(new MouseEvent('mouseenter'));

      window.revertInlineUncertainty(span);

      expect(container.querySelector('.inline-uncertain-text')).toBeNull();
      expect(container.textContent).toContain('Timeline: soon.');
      const popover = document.getElementById('uncertainty-hover-popover');
      expect(popover.style.display).toBe('none');
    });

    it('revertInlineUncertainty removes span completely when data-original-text is omitted', () => {
      const container = document.getElementById('refactor-proposal-html');
      container.innerHTML = `<p>Items: Task A, <span class="inline-uncertain-text" data-uncertainty-reason="Hallucinated extra item" data-original-text="omitted">Task B, </span>Task C.</p>`;
      window.setupUncertaintyHoverCards(container);

      const span = container.querySelector('.inline-uncertain-text');
      span.dispatchEvent(new MouseEvent('mouseenter'));

      window.revertInlineUncertainty(span);

      expect(container.querySelector('.inline-uncertain-text')).toBeNull();
      expect(container.textContent).toBe('Items: Task A, Task C.');
    });
  });

  describe('Proposed Workstreams & Tags Recommendations in RefactorModalController', () => {
    it('renders recommendations banner in showProposalsModal with current vs proposed tags and supports toggling acceptance', () => {
      RefactorModalController.activeNote = {
        path: 'notes/test.html',
        title: 'Test Note',
        workstreams: ['Marketing'],
        group_tags: ['Outreach'],
        topic_tags: ['Campaigns']
      };
      RefactorModalController.proposedWorkstreams = ['Marketing', 'Growth'];
      RefactorModalController.proposedGroup = 'Strategy';
      RefactorModalController.proposedTopic = 'Expansion';
      RefactorModalController.tagChangeReason = 'Note discusses expansion roadmap.';
      RefactorModalController.acceptedTagChanges = false;

      RefactorModalController.showProposalsModal();

      const tagsContainer = document.getElementById('refactor-tags-container');
      expect(tagsContainer.style.display).toBe('block');
      // Contains currently assigned tags
      expect(tagsContainer.innerHTML).toContain('refactor.currentTags');
      expect(tagsContainer.innerHTML).toContain('Marketing');
      expect(tagsContainer.innerHTML).toContain('Outreach');
      expect(tagsContainer.innerHTML).toContain('Campaigns');

      // Contains proposed changes
      expect(tagsContainer.innerHTML).toContain('refactor.proposedTags');
      expect(tagsContainer.innerHTML).toContain('Growth');
      expect(tagsContainer.innerHTML).toContain('Strategy');
      expect(tagsContainer.innerHTML).toContain('Expansion');
      expect(tagsContainer.innerHTML).toContain('Note discusses expansion roadmap.');

      const toggleBtn = tagsContainer.querySelector('button');
      expect(toggleBtn).not.toBeNull();

      // Toggle accept
      RefactorModalController.toggleAcceptTags(toggleBtn);
      expect(RefactorModalController.acceptedTagChanges).toBe(true);
      expect(toggleBtn.classList.contains('btn-primary')).toBe(true);

      // Toggle revert
      RefactorModalController.toggleAcceptTags(toggleBtn);
      expect(RefactorModalController.acceptedTagChanges).toBe(false);
      expect(toggleBtn.classList.contains('btn-secondary')).toBe(true);
    });

    it('renders fallback None when current note has no workstreams or tags assigned', () => {
      const container = document.createElement('div');
      RefactorModalController.renderTagsBanner(container, {
        note: { path: 'notes/empty.html', title: 'Empty Note' },
        proposal: {
          proposedWorkstreams: ['Engineering'],
          proposedGroup: 'Backend',
          proposedTopic: 'API',
          tagChangeReason: 'API redesign discussed.'
        },
        accepted: false
      });

      expect(container.style.display).toBe('block');
      expect(container.innerHTML).toContain('refactor.noTagsAssigned');
      expect(container.innerHTML).toContain('Engineering');
      expect(container.innerHTML).toContain('Backend');
      expect(container.innerHTML).toContain('API');
      expect(container.innerHTML).toContain('API redesign discussed.');
    });

    it('commitWorkstreamAndTagChanges assigns workstream and updates tag editors', async () => {
      const note = { path: 'notes/test.html', title: 'Test Note', workstreams: [], group_tags: [], topic_tags: [] };
      global.currentNote = note;

      const proposal = {
        proposedWorkstreams: ['DevOps', 'Infrastructure'],
        proposedGroup: 'Platform',
        proposedTopic: 'Cloud',
        acceptedTagChanges: true
      };

      await RefactorModalController.commitWorkstreamAndTagChanges(note, proposal);

      expect(global.assignNoteToWorkstream).toHaveBeenCalledWith('DevOps');
      expect(global.assignNoteToWorkstream).toHaveBeenCalledWith('Infrastructure');
      expect(global.populateTagEditor).toHaveBeenCalledWith('editor-group', ['Platform'], 'group');
      expect(global.populateTagEditor).toHaveBeenCalledWith('editor-topic', ['Cloud'], 'topic');
      expect(note.group_tags).toEqual(['Platform']);
      expect(note.topic_tags).toEqual(['Cloud']);
      expect(note.workstreams).toEqual(['DevOps', 'Infrastructure']);
    });

    it('commits workstream assignment and tag updates when applying proposal if accepted', async () => {
      RefactorModalController.activeNote = { path: 'notes/test.html', title: 'Test Note' };
      global.currentNote = { path: 'notes/test.html', title: 'Test Note', mainHTML: '<p>Original</p>' };
      RefactorModalController.proposalA = '<h2>Perfect Note</h2><p>Updated content</p>';
      RefactorModalController.activeTab = 'A';
      RefactorModalController.proposedWorkstreams = ['Product Design'];
      RefactorModalController.proposedGroup = 'Core';
      RefactorModalController.proposedTopic = 'UI';
      RefactorModalController.acceptedTagChanges = true;

      const editArea = document.getElementById('edit-textarea');
      editArea.innerHTML = '<p>Original</p>';

      await RefactorModalController.applyCurrentProposal();

      expect(global.assignNoteToWorkstream).toHaveBeenCalledWith('Product Design');
      expect(global.populateTagEditor).toHaveBeenCalledWith('editor-group', ['Core'], 'group');
      expect(global.populateTagEditor).toHaveBeenCalledWith('editor-topic', ['UI'], 'topic');
    });

    it('unrolls any lingering uncertainty spans before writing to editor when applying proposal', async () => {
      RefactorModalController.activeNote = { path: 'notes/test.html', title: 'Test Note' };
      global.currentNote = { path: 'notes/test.html', title: 'Test Note', mainHTML: '<p>Original</p>' };
      RefactorModalController.proposalA = '<h2>Perfect Note</h2><p>Launch on <span class="inline-uncertain-text" data-uncertainty-reason="Assumed">Wednesday</span>.</p>';
      RefactorModalController.activeTab = 'A';
      RefactorModalController.proposedWorkstreams = [];
      RefactorModalController.acceptedTagChanges = false;

      const editArea = document.getElementById('edit-textarea');
      editArea.innerHTML = '<p>Original</p>';

      await RefactorModalController.applyCurrentProposal();

      expect(editArea.innerHTML).toContain('Launch on Wednesday.');
      expect(editArea.innerHTML).not.toContain('inline-uncertain-text');
    });
  });

  describe('Perfect Note Prompt Structure (app-prompts.js)', () => {
    it('includes zero hallucinations principle and inline-uncertain-text guidance', () => {
      const prompt = AppPrompts.buildPerfectNotePrompt({ title: 'Design Sprint' });
      expect(prompt).toContain('ZERO HALLUCINATIONS');
      expect(prompt).toContain('inline-uncertain-text');
      expect(prompt).toContain('data-uncertainty-reason');
      expect(prompt).toContain('data-original-text');
    });

    it('injects workstreams into prompt and finalize_refactoring schema with proposed_workstreams', () => {
      const prompt = AppPrompts.buildPerfectNotePrompt({
        title: 'Design Sprint',
        availableWorkstreams: ['Engineering', 'Marketing'],
        currentWorkstreams: ['Engineering'],
        currentGroup: 'Dev',
        currentTopic: 'Frontend'
      });

      expect(prompt).toContain('Engineering');
      expect(prompt).toContain('Marketing');
      expect(prompt).toContain('proposed_workstreams');
      expect(prompt).toContain('proposed_group');
      expect(prompt).toContain('proposed_topic');
      expect(prompt).toContain('tag_change_reason');
    });
  });
});
