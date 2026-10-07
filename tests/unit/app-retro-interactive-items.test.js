import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Retrospective Interactive Items & Targeted Note Synchronization (app-retro.js)', () => {
  let handleRetroItemActivation;
  let notifyDailyReviewNoteChanged;
  let attachRetroDailyReviewNoteChangeListener;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="retro-panel">
        <div class="retro-day-summary-card has-note" 
             data-note-path="notes/daily-summary-2026-09-02.html" 
             data-note-id="summary-2026-09-02" 
             data-date="2026-09-02">
          <div class="retro-summary-full-html">
            <p>Original summary text</p>
            <p><a href="#todo-todo-101" class="note-todo-link" data-todo-id="todo-101">📋 Fix server crash</a></p>
            <p><span class="note-decision-badge" data-decision-id="dec-1">Adopt Vitest</span></p>
            <p><a href="notes/architecture.html" class="note-link" data-note-path="notes/architecture.html">Architecture Note</a></p>
            <p><a href="https://github.com/example/repo" class="retro-external-link">GitHub Repo</a></p>
            <p class="plain-text">Non-interactive description of the day</p>
          </div>
        </div>
        <div class="retro-day-summary-card has-note" 
             data-note-path="notes/daily-summary-2026-09-01.html" 
             data-note-id="summary-2026-09-01" 
             data-date="2026-09-01">
          <div class="retro-summary-full-html">
            <p>Yesterday summary text</p>
          </div>
        </div>
      </div>
    `;

    global.t = (key) => key;
    global.escH = (str) => String(str || '');
    global.escA = (str) => String(str || '');
    global.manifest = [
      { id: 'summary-2026-09-02', path: 'notes/daily-summary-2026-09-02.html', date: '2026-09-02' },
      { id: 'regular-note-1', path: 'notes/architecture.html', date: '2026-09-02' }
    ];
    global.todosManifest = [
      { id: 'todo-101', title: 'Fix server crash', priority: 'High' }
    ];

    global.openTodoOverlay = vi.fn();
    global.openTodoFromMarker = vi.fn();
    global.handleDecisionClick = vi.fn();
    global.openNoteFromLink = vi.fn();
    global.openNoteOverlay = vi.fn();
    global.openExternalLink = vi.fn();
    global.window.open = vi.fn();

    global.StorageAPI = {
      readNoteContent: vi.fn().mockImplementation(async (filePath) => {
        if (filePath === 'notes/daily-summary-2026-09-02.html') {
          return '<main><p>Updated daily summary content from disk!</p></main>';
        }
        return '';
      })
    };

    global.parseNoteHTML = vi.fn().mockImplementation((raw) => {
      return { mainHTML: '<p>Updated daily summary content from disk!</p>' };
    });

    const retroCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-retro.js'), 'utf8');
    const runner = new Function('window', 'document', `
      ${retroCode}
      return { handleRetroItemActivation, notifyDailyReviewNoteChanged, attachRetroDailyReviewNoteChangeListener };
    `);
    const exportsObj = runner(global.window, document);
    handleRetroItemActivation = exportsObj.handleRetroItemActivation;
    notifyDailyReviewNoteChanged = exportsObj.notifyDailyReviewNoteChanged;
    attachRetroDailyReviewNoteChangeListener = exportsObj.attachRetroDailyReviewNoteChangeListener;
  });

  describe('handleRetroItemActivation', () => {
    it('activates todo item on click or double-click', () => {
      const todoLink = document.querySelector('.note-todo-link');
      const event = {
        target: todoLink,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn()
      };

      handleRetroItemActivation(event, true);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.stopPropagation).toHaveBeenCalled();
      expect(global.openTodoOverlay).toHaveBeenCalledWith('todo-101');
    });

    it('activates decision tag on click or double-click', () => {
      const decBadge = document.querySelector('.note-decision-badge');
      const event = {
        target: decBadge,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn()
      };

      handleRetroItemActivation(event, false);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.stopPropagation).toHaveBeenCalled();
      expect(global.handleDecisionClick).toHaveBeenCalledWith(decBadge, event);
    });

    it('activates internal note link on click or double-click', () => {
      const noteLink = document.querySelector('.note-link');
      const event = {
        target: noteLink,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn()
      };

      handleRetroItemActivation(event, true);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.stopPropagation).toHaveBeenCalled();
      expect(global.openNoteFromLink).toHaveBeenCalledWith(noteLink);
    });

    it('opens external URL links on double-click', () => {
      const extLink = document.querySelector('.retro-external-link');
      const event = {
        target: extLink,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        metaKey: false,
        ctrlKey: false
      };

      handleRetroItemActivation(event, true);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.stopPropagation).toHaveBeenCalled();
      expect(global.openExternalLink).toHaveBeenCalledWith('https://github.com/example/repo');
    });

    it('stops propagation on double-clicking plain text so note editor edit mode is not entered', () => {
      const plainText = document.querySelector('.plain-text');
      const event = {
        target: plainText,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn()
      };

      handleRetroItemActivation(event, true);

      expect(event.stopPropagation).toHaveBeenCalled();
      expect(global.openNoteOverlay).not.toHaveBeenCalled();
    });
  });

  describe('Targeted Daily Review Note Change Synchronization', () => {
    it('dispatches daily-review-note-changed event for daily summaries', () => {
      const dispatchSpy = vi.spyOn(global.window, 'dispatchEvent');

      notifyDailyReviewNoteChanged('notes/daily-summary-2026-09-02.html', { date: '2026-09-02' });

      expect(dispatchSpy).toHaveBeenCalled();
      const customEvent = dispatchSpy.mock.calls[0][0];
      expect(customEvent.type).toBe('daily-review-note-changed');
      expect(customEvent.detail.path).toBe('notes/daily-summary-2026-09-02.html');
      expect(customEvent.detail.date).toBe('2026-09-02');
    });

    it('does not dispatch event for regular non-daily-summary notes', () => {
      const dispatchSpy = vi.spyOn(global.window, 'dispatchEvent');

      notifyDailyReviewNoteChanged('notes/architecture.html');

      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it('updates only the matching retrospective card HTML dynamically without redrawing other cards', async () => {
      attachRetroDailyReviewNoteChangeListener();

      // Trigger custom event
      const event = new CustomEvent('daily-review-note-changed', {
        detail: {
          path: 'notes/daily-summary-2026-09-02.html',
          noteId: 'summary-2026-09-02',
          date: '2026-09-02'
        }
      });
      window.dispatchEvent(event);

      // Wait for microtasks
      await new Promise(r => setTimeout(r, 10));

      const card1 = document.querySelector('[data-note-path="notes/daily-summary-2026-09-02.html"] .retro-summary-full-html');
      const card2 = document.querySelector('[data-note-path="notes/daily-summary-2026-09-01.html"] .retro-summary-full-html');

      expect(card1.innerHTML).toContain('Updated daily summary content from disk!');
      expect(card2.innerHTML).toContain('Yesterday summary text'); // Unchanged
    });
  });
});
