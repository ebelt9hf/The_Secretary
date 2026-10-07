import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ═══════════════════════════════════════════════════
// Sourced from: app-dailyreview-date-shadow.test.js
// ═══════════════════════════════════════════════════
describe('Daily Review Date Drop Shadow Refinement', () => {
  const dailyReviewCssPath = path.resolve(__dirname, '../../css/app-dailyreview.css');
  const dailyReviewCss = fs.readFileSync(dailyReviewCssPath, 'utf8');

  it('dr-review-date-input should not have inset drop-shadow and should have box-shadow: none by default', () => {
    // Extract .dr-review-date-input block
    const match = dailyReviewCss.match(/\.dr-review-date-input\s*\{([^}]+)\}/);
    expect(match).toBeTruthy();
    const block = match[1];

    // Should NOT have the harsh skeuomorphic inset shadow
    expect(block).not.toContain('inset 0 1px 0 rgba(255, 255, 255, 0.3)');
    expect(block).toContain('box-shadow: none;');
  });

  it('dr-step-date should explicitly disable box-shadow, filter, and text-shadow to prevent harsh drop-shadows', () => {
    const match = dailyReviewCss.match(/(?:^|\n)[^{]*\.dr-step-date[^{]*\{([^}]+)\}/);
    expect(match).toBeTruthy();
    const block = match[1];

    expect(block).toMatch(/box-shadow:\s*none/);
    expect(block).toMatch(/filter:\s*none/);
  });

  it('dr-start-card should use subtle shadow instead of heavy default shadow', () => {
    const match = dailyReviewCss.match(/\.dr-start-card\s*\{([^}]+)\}/);
    expect(match).toBeTruthy();
    const block = match[1];

    // Must not use heavy var(--shadow)
    expect(block).not.toContain('box-shadow: var(--shadow);');
    expect(block).toMatch(/box-shadow:\s*var\(--shadow-sm\)/);
  });

  it('retro-day-cell reviewable hover should not use harsh 12px purple drop-shadow', () => {
    const baseCssPath = path.resolve(__dirname, '../../css/app-base.css');
    const baseCss = fs.readFileSync(baseCssPath, 'utf8');

    const match = baseCss.match(/\.retro-day-cell\.reviewable:hover\s*\{([^}]+)\}/);
    expect(match).toBeTruthy();
    const block = match[1];

    expect(block).not.toContain('rgba(124, 58, 237, 0.15)');
  });
});

// ═══════════════════════════════════════════════════
// Sourced from: app-dailyreview-guide-ui.test.js
// ═══════════════════════════════════════════════════
describe('Daily Review Guide Tour and UI Localization', () => {
  let DailyReviewController;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="daily-review-overlay" style="display:none;">
        <div class="dr-header-actions">
          <button class="btn" id="btn-dr-guide" title="Lancer le guide interactif de la Daily Review"><span id="btn-dr-guide-text">Guide</span></button>
        </div>
      </div>
    `;

    const dict = {
      'tutorial.dailyReviewGuide.badge': 'Tagesrückblick-Leitfaden',
      'tutorial.dailyReviewGuide.guideBtn': 'Leitfaden',
      'tutorial.dailyReviewGuide.guideBtnTooltip': 'Interaktiven Leitfaden für den Tagesrückblick starten',
      'tutorial.dailyReviewGuide.closeTooltip': 'Leitfaden schließen',
      'tutorial.dailyReviewGuide.prevTooltip': 'Vorheriger Schritt',
      'tutorial.dailyReviewGuide.nextTooltip': 'Nächster Schritt',
      'tutorial.dailyReviewGuide.startReviewBtn': 'Review starten',
      'tutorial.dailyReviewGuide.startReviewTooltip': 'Leitfaden beenden und Review starten',
      'tutorial.dailyReviewGuide.step1Title': '1/4 Posteingang & Stash leeren',
      'tutorial.dailyReviewGuide.step1Text': 'Ungelesene Notizen verarbeiten.',
      'tutorial.dailyReviewGuide.step2Title': '2/4 Kalender & Zeitplan abgleichen',
      'tutorial.dailyReviewGuide.step2Text': 'Tagesplan anpassen.',
      'tutorial.dailyReviewGuide.step3Title': '3/4 KI-Notizen & Entscheidungen extrahieren',
      'tutorial.dailyReviewGuide.step3Text': 'KI-Zusammenfassungen erstellen.',
      'tutorial.dailyReviewGuide.step4Title': '4/4 Tagesabschluss & Freier Kopf',
      'tutorial.dailyReviewGuide.step4Text': 'Top-Prioritäten für morgen bestätigen.',
      'dailyreview.prevBtn': 'Zurück',
      'dailyreview.nextBtn': 'Weiter',
      'common.close': 'Schließen'
    };

    global.t = (key) => dict[key] || key;
    global.escH = (s) => String(s || '');
    global.escA = (s) => String(s || '').replace(/"/g, '&quot;');
    global.showConfirmDialog = vi.fn().mockResolvedValue(true);
    global.toast = vi.fn();

    // Load DailyReviewController
    const drCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-dailyreview.js'), 'utf8');
    const runner = new Function(`
      ${drCode}
      return DailyReviewController;
    `);
    DailyReviewController = runner();
  });

  it('renders interactive 4-step guided tour with localized badge, steps, buttons, and tooltips', () => {
    DailyReviewController.startGuidedTour();

    const modal = document.getElementById('dr-guided-tour-modal');
    expect(modal).not.toBeNull();

    // Badge renders SVG icon and pure text
    const badge = modal.querySelector('.dr-tour-badge');
    expect(badge).not.toBeNull();
    expect(badge.querySelector('svg')).not.toBeNull();
    expect(badge.textContent).toBe('Tagesrückblick-Leitfaden');

    // Close button
    const closeBtn = modal.querySelector('.dr-tour-close');
    expect(closeBtn).not.toBeNull();
    expect(closeBtn.getAttribute('title')).toBe('Leitfaden schließen');
    expect(closeBtn.getAttribute('aria-label')).toBe('Leitfaden schließen');

    // Step 1 title and text
    const title = modal.querySelector('.dr-tour-title');
    expect(title.textContent).toBe('1/4 Posteingang & Stash leeren');
    const text = modal.querySelector('.dr-tour-text');
    expect(text.textContent).toBe('Ungelesene Notizen verarbeiten.');

    // Buttons on Step 1: No prev button, Next button translated
    const prevBtn = modal.querySelector('#dr-tour-prev');
    expect(prevBtn).toBeNull();

    const nextBtn = modal.querySelector('#dr-tour-next');
    expect(nextBtn).not.toBeNull();
    expect(nextBtn.textContent).toBe('Weiter');
    expect(nextBtn.getAttribute('title')).toBe('Nächster Schritt');

    // Click Next -> Step 2
    nextBtn.click();
    expect(modal.querySelector('.dr-tour-title').textContent).toBe('2/4 Kalender & Zeitplan abgleichen');
    const prevBtnStep2 = modal.querySelector('#dr-tour-prev');
    expect(prevBtnStep2).not.toBeNull();
    expect(prevBtnStep2.textContent).toBe('Zurück');
    expect(prevBtnStep2.getAttribute('title')).toBe('Vorheriger Schritt');

    // Step 3
    modal.querySelector('#dr-tour-next').click();
    expect(modal.querySelector('.dr-tour-title').textContent).toBe('3/4 KI-Notizen & Entscheidungen extrahieren');

    // Step 4 (Final Step): Next button becomes Start Review with localized label and tooltip
    modal.querySelector('#dr-tour-next').click();
    expect(modal.querySelector('.dr-tour-title').textContent).toBe('4/4 Tagesabschluss & Freier Kopf');
    const startReviewBtn = modal.querySelector('#dr-tour-next');
    expect(startReviewBtn.textContent).toBe('Review starten');
    expect(startReviewBtn.getAttribute('title')).toBe('Leitfaden beenden und Review starten');

    // Click finish -> sets localStorage seen flag and closes modal
    startReviewBtn.click();
    expect(document.getElementById('dr-guided-tour-modal')).toBeNull();
    expect(localStorage.getItem('secretary_daily_review_guided_seen')).toBe('true');
  });

  it('localizes btn-dr-guide text and tooltip in localizeUI()', () => {
    DailyReviewController.localizeUI();

    const guideBtn = document.getElementById('btn-dr-guide');
    expect(guideBtn).not.toBeNull();
    expect(guideBtn.getAttribute('title')).toBe('Interaktiven Leitfaden für den Tagesrückblick starten');

    const guideText = document.getElementById('btn-dr-guide-text');
    expect(guideText).not.toBeNull();
    expect(guideText.textContent).toBe('Leitfaden');
  });

  it('verifies planner-header-reviewed CSS rules for unfilled unreviewed and filled green reviewed states', () => {
    const css = fs.readFileSync(path.resolve(__dirname, '../../css/app-planner.css'), 'utf8');

    // Unreviewed rule: transparent background, dashed border
    expect(css).toContain('.planner-header-cell.reviewable:not(.reviewed) .planner-header-reviewed');
    expect(css).toContain('border: 1.5px dashed');
    expect(css).toContain('background: transparent');

    // Reviewed rule: filled var(--color-low)
    expect(css).toContain('.planner-header-cell.reviewed .planner-header-reviewed');
    expect(css).toContain('background: var(--color-low)');
  });
});

// ═══════════════════════════════════════════════════
// Sourced from: app-dailyreview-ooo-autoreview.test.js
// ═══════════════════════════════════════════════════
describe('OOO Auto-Review & Wizard Prevention (app-utils.js & app-dailyreview.js)', () => {
  let isDateCoveredByOoo;
  let getCoveringOooEvent;
  let isDailyReviewDateReviewed;
  let DailyReviewController;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="daily-review-overlay" style="display:none;"></div>
      <div id="dr-target-date-wrap">
        <input id="dr-target-date" value="2026-09-04" />
      </div>
      <div id="dr-review-date-wrap">
        <input id="dr-review-date" value="2026-09-04" />
      </div>
    `;

    global.toast = vi.fn();
    global.switchTab = vi.fn();
    global.t = (key, params) => {
      if (key === 'dailyreview.oooDayAutoReviewed') {
        return `${params?.title || 'OOO'}: This day is marked as Out of Office and is already automatically reviewed.`;
      }
      return key;
    };
    global.formatLocalDateValue = (d) => {
      if (typeof d === 'string') return d.slice(0, 10);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    global.settings = { ui: { reviewedDates: [] } };
    global.manifest = [];
    global.plannerEvents = [];

    // Load app-utils.js
    const utilsCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-utils.js'), 'utf8');
    const utilsRunner = new Function(`
      ${utilsCode}
      return { isDateCoveredByOoo, getCoveringOooEvent, isDailyReviewDateReviewed };
    `);
    const utilsExports = utilsRunner();
    isDateCoveredByOoo = utilsExports.isDateCoveredByOoo;
    getCoveringOooEvent = utilsExports.getCoveringOooEvent;
    isDailyReviewDateReviewed = utilsExports.isDailyReviewDateReviewed;

    global.isDateCoveredByOoo = isDateCoveredByOoo;
    global.getCoveringOooEvent = getCoveringOooEvent;
    global.isDailyReviewDateReviewed = isDailyReviewDateReviewed;

    // Load DailyReviewController
    const drCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-dailyreview.js'), 'utf8');
    const drRunner = new Function(`
      ${drCode}
      return DailyReviewController;
    `);
    DailyReviewController = drRunner();
  });

  describe('isDateCoveredByOoo & getCoveringOooEvent', () => {
    it('returns true when a date falls within an allDay OOO event', () => {
      const events = [
        { id: '1', type: 'ooo', allDay: true, date: '2026-09-01', endDate: '2026-09-05', title: 'Vacation' }
      ];
      expect(isDateCoveredByOoo('2026-08-31', events)).toBe(false);
      expect(isDateCoveredByOoo('2026-09-01', events)).toBe(true);
      expect(isDateCoveredByOoo('2026-09-03', events)).toBe(true);
      expect(isDateCoveredByOoo('2026-09-05', events)).toBe(true);
      expect(isDateCoveredByOoo('2026-09-06', events)).toBe(false);

      const covering = getCoveringOooEvent('2026-09-03', events);
      expect(covering).not.toBeNull();
      expect(covering.title).toBe('Vacation');
    });

    it('returns true when an OOO event has no specific times on the date', () => {
      const events = [
        { id: '2', type: 'ooo', date: '2026-09-10', title: 'Bank Holiday' }
      ];
      expect(isDateCoveredByOoo('2026-09-10', events)).toBe(true);
      expect(getCoveringOooEvent('2026-09-10', events).title).toBe('Bank Holiday');
    });

    it('returns false for partial-day OOO events with specific times', () => {
      const events = [
        { id: '3', type: 'ooo', date: '2026-09-12', startTime: '14:00', endTime: '16:00', title: 'Doctor Appointment' }
      ];
      expect(isDateCoveredByOoo('2026-09-12', events)).toBe(false);
    });

    it('returns false for non-OOO events', () => {
      const events = [
        { id: '4', type: 'work', allDay: true, date: '2026-09-15', title: 'Conference' }
      ];
      expect(isDateCoveredByOoo('2026-09-15', events)).toBe(false);
    });
  });

  describe('isDailyReviewDateReviewed with OOO', () => {
    it('returns true automatically for an OOO day even with no notes reviewed', () => {
      global.plannerEvents = [
        { id: 'ooo-1', type: 'ooo', allDay: true, date: '2026-09-04', endDate: '2026-09-04', title: 'Off' }
      ];
      // Even if manifest has unreviewed notes or is empty, OOO is automatically reviewed
      expect(isDailyReviewDateReviewed('2026-09-04')).toBe(true);
      expect(isDailyReviewDateReviewed('2026-09-05')).toBe(false);
    });
  });

  describe('DailyReviewController wizard prevention on OOO dates', () => {
    it('aborts start() and shows toast when attempting to review an OOO date', async () => {
      global.plannerEvents = [
        { id: 'ooo-vacation', type: 'ooo', allDay: true, date: '2026-09-04', endDate: '2026-09-04', title: 'Holiday' }
      ];

      await DailyReviewController.start('2026-09-04');

      expect(global.toast).toHaveBeenCalledWith(
        expect.stringContaining('Holiday: This day is marked as Out of Office and is already automatically reviewed.')
      );
      expect(global.switchTab).not.toHaveBeenCalled();
      expect(DailyReviewController.currentStep).toBe(0);
    });

    it('aborts startForSelectedDate() and shows toast when date is OOO', async () => {
      global.plannerEvents = [
        { id: 'ooo-vacation', type: 'ooo', allDay: true, date: '2026-09-04', endDate: '2026-09-04', title: 'Congé' }
      ];

      DailyReviewController.loadStep = vi.fn();
      await DailyReviewController.startForSelectedDate();

      expect(global.toast).toHaveBeenCalledWith(
        expect.stringContaining('Congé: This day is marked as Out of Office and is already automatically reviewed.')
      );
      expect(DailyReviewController.loadStep).not.toHaveBeenCalled();
    });
  });
});

// ═══════════════════════════════════════════════════
// Sourced from: app-dailyreview-task-dedup.test.js
// ═══════════════════════════════════════════════════
describe('Daily Review Final Agent - Task Deduplication and Updates', () => {
  let DailyReviewController;
  let mockLLMService;
  let mockStorageAPI;
  let mockTaskGraphEngine;

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
        <div id="dr-step5-tab-note"></div>
        <div id="dr-step5-tab-list"></div>
        <div id="dr-step5-tab-workstreams"></div>
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
    global.saveTodosManifest = vi.fn().mockResolvedValue(true);
    global.refreshTodoViews = vi.fn();
    global.notifyDailyReviewNoteChanged = vi.fn();
    global.normalizeLanguageCode = (l) => l;
    global.formatLocalDateValue = (d) => (d instanceof Date ? d.toISOString().split('T')[0] : String(d));
    global.parseLocalDateValue = (s) => new Date(s);
    global.parseNoteHTML = (h) => ({ mainHTML: h });
    global.plannerEvents = [];

    global.todosManifest = [
      {
        id: 'todo-existing-1',
        title: 'Fix production database latency',
        priority: 'Low',
        eisenhowerQuadrant: 'Q4',
        workstream: 'Backend Infrastructure',
        owner: 'Marc',
        depends_on: []
      },
      {
        id: 'todo-existing-2',
        title: 'Upgrade React dependencies',
        priority: 'Medium',
        eisenhowerQuadrant: 'Q2',
        workstream: 'Frontend',
        owner: 'Alice',
        depends_on: ['todo-existing-1']
      }
    ];

    global.manifest = [];

    mockTaskGraphEngine = {
      validateNoCircularDependency: vi.fn((targetId, candidatePrereqId) => {
        // Mock cycle if candidate is todo-existing-2 and target is todo-existing-1
        if (targetId === 'todo-existing-1' && candidatePrereqId === 'todo-existing-2') {
          return { valid: false, reason: 'Circular dependency detected' };
        }
        return { valid: true };
      })
    };
    global.TaskGraphEngine = mockTaskGraphEngine;
    window.TaskGraphEngine = mockTaskGraphEngine;

    mockStorageAPI = {
      readNotesManifest: async () => global.manifest,
      readNoteContent: vi.fn().mockResolvedValue(''),
      writeNoteContent: vi.fn().mockResolvedValue(true)
    };
    global.StorageAPI = mockStorageAPI;

    mockLLMService = {
      isEnabled: () => true,
      chat: vi.fn(),
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

    DailyReviewController.reviewDateValue = '2026-09-02';
    DailyReviewController.todayNotes = [
      { id: 'note-1', title: 'Infra Retro', date: '2026-09-02', preview: 'DB performance issues' }
    ];
  });

  it('includes existing active tasks in the user prompt for deduplication and update context', async () => {
    mockLLMService.chat.mockResolvedValueOnce({
      parsed: {
        action: 'finalize_summary',
        properties: {
          final_summary: 'Infrastructure sync completed.',
          final_suggestions: '- [UPDATE: todo-existing-1] Fix production database latency (Haute, 45 min) Depends on: todo-existing-2 Reason: elevated due to outage',
          workstream_updates: []
        }
      }
    });

    await DailyReviewController.generateAISummary();

    expect(mockLLMService.chat).toHaveBeenCalled();
    const chatCall = mockLLMService.chat.mock.calls[0];
    const userPrompt = chatCall[0][1].content;

    expect(userPrompt).toContain('Existing Active Tasks / Todos in Board:');
    expect(userPrompt).toContain('[ID: todo-existing-1] "Fix production database latency"');
    expect(userPrompt).toContain('Workstream: "Backend Infrastructure"');
    expect(userPrompt).toContain('Dependencies: [todo-existing-1]');
  });

  it('parses suggestions with explicit [UPDATE: <id>], priority, and dependencies', async () => {
    mockLLMService.chat.mockResolvedValueOnce({
      parsed: {
        action: 'finalize_summary',
        properties: {
          final_summary: 'Infrastructure summary.',
          final_suggestions: '[SUGGESTIONS]\n- [UPDATE: todo-existing-1] Fix production database latency (High, 45 min) Depends on: todo-existing-3 Reason: escalated\n[/SUGGESTIONS]',
          workstream_updates: []
        }
      }
    });

    await DailyReviewController.generateAISummary();

    expect(DailyReviewController.currentSuggestions.length).toBe(1);
    const s = DailyReviewController.currentSuggestions[0];
    expect(s.isUpdate).toBe(true);
    expect(s.targetTodoId).toBe('todo-existing-1');
    expect(s.title).toBe('Fix production database latency');
    expect(s.priority).toBe('High');
    expect(s.duration).toBe(45);
    expect(s.dependsOn).toBe('todo-existing-3');
    expect(s.reason).toBe('escalated');
  });

  it('automatically recognizes existing task title and marks suggestion as update', async () => {
    mockLLMService.chat.mockResolvedValueOnce({
      parsed: {
        action: 'finalize_summary',
        properties: {
          final_summary: 'Infrastructure summary.',
          final_suggestions: '[SUGGESTIONS]\n- Fix production database latency (Priority: High, 60 min)\n[/SUGGESTIONS]',
          workstream_updates: []
        }
      }
    });

    await DailyReviewController.generateAISummary();

    expect(DailyReviewController.currentSuggestions.length).toBe(1);
    const s = DailyReviewController.currentSuggestions[0];
    expect(s.isUpdate).toBe(true);
    expect(s.targetTodoId).toBe('todo-existing-1');
    expect(s.title).toBe('Fix production database latency');
    expect(s.priority).toBe('High');
  });

  it('renders suggestion cards with Update Task badge, dependencies, and Update button', () => {
    DailyReviewController.currentSuggestions = [
      {
        title: 'Fix production database latency',
        duration: 45,
        priority: 'High',
        isUpdate: true,
        targetTodoId: 'todo-existing-1',
        dependsOn: 'todo-existing-3',
        reason: 'escalated'
      }
    ];

    DailyReviewController.renderAISuggestionsList();

    const container = document.getElementById('dr-ai-suggestions-list');
    expect(container.innerHTML).toContain('dailyreview.updateTask');
    expect(container.innerHTML).toContain('dailyreview.dependsOnLabel');
    expect(container.innerHTML).toContain('todo-existing-3');
    expect(container.innerHTML).toContain('dailyreview.updateTaskBtn');
  });

  it('updates existing task priority and quadrant, appends non-circular dependency, and dispatches note changed event', async () => {
    DailyReviewController.currentSuggestions = [
      {
        title: 'Fix production database latency',
        duration: 45,
        priority: 'High',
        isUpdate: true,
        targetTodoId: 'todo-existing-1',
        dependsOn: 'todo-existing-3',
        reason: 'escalated'
      }
    ];

    const targetTodo = global.todosManifest.find(t => t.id === 'todo-existing-1');
    expect(targetTodo.priority).toBe('Low');
    expect(targetTodo.eisenhowerQuadrant).toBe('Q4');
    expect(targetTodo.depends_on).toEqual([]);

    await DailyReviewController.createTodoFromSuggestion(0);

    expect(targetTodo.priority).toBe('High');
    expect(targetTodo.eisenhowerQuadrant).toBe('Q1');
    expect(targetTodo.depends_on).toContain('todo-existing-3');
    expect(global.todosManifest.length).toBe(2); // No duplicate created
    expect(global.saveTodosManifest).toHaveBeenCalled();
    expect(global.refreshTodoViews).toHaveBeenCalled();
    expect(global.notifyDailyReviewNoteChanged).toHaveBeenCalledWith(
      'notes/daily-summary-2026-09-02.html',
      expect.objectContaining({ todoId: 'todo-existing-1', date: '2026-09-02' })
    );
  });

  it('prevents adding circular dependencies when updating task from suggestion', async () => {
    DailyReviewController.currentSuggestions = [
      {
        title: 'Fix production database latency',
        duration: 45,
        priority: 'High',
        isUpdate: true,
        targetTodoId: 'todo-existing-1',
        dependsOn: 'todo-existing-2', // will cause cycle according to mock
        reason: 'circular attempt'
      }
    ];

    const targetTodo = global.todosManifest.find(t => t.id === 'todo-existing-1');
    await DailyReviewController.createTodoFromSuggestion(0);

    expect(mockTaskGraphEngine.validateNoCircularDependency).toHaveBeenCalledWith('todo-existing-1', 'todo-existing-2');
    expect(targetTodo.depends_on).not.toContain('todo-existing-2');
  });
});
