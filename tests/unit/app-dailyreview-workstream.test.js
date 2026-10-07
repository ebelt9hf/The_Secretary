import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Daily Review Workstream Agent Integration', () => {
  let DailyReviewController;
  let mockEngine;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="daily-review-overlay" style="display:none;">
        <div id="dr-step-ai">
          <div id="dr-workstream-sync-banner" class="dr-ws-sync-banner" style="display:none;">
            <div id="dr-ws-sync-status-text"></div>
            <div id="dr-ws-sync-progress-bar" style="width: 0%;"></div>
            <span id="dr-ws-sync-spinner"></span>
          </div>
          <div class="dr-step5-tab-bar">
            <button id="dr-tab-summary-note" class="dr-step5-tab-btn active">Note</button>
            <button id="dr-tab-summaries-list" class="dr-step5-tab-btn">List</button>
            <button id="dr-tab-workstream-updates" class="dr-step5-tab-btn">Workstreams</button>
          </div>
          <div id="dr-step5-tab-note" class="dr-step5-tab-content" style="display:flex;"></div>
          <div id="dr-step5-tab-list" class="dr-step5-tab-content" style="display:none;"></div>
          <div id="dr-step5-tab-workstreams" class="dr-step5-tab-content" style="display:none;">
            <div id="dr-ai-workstream-updates-list"></div>
            <span id="dr-step5-ws-count">0</span>
          </div>
        </div>
      </div>
    `;

    global.t = (key) => key;
    global.escH = (str) => String(str || '');
    global.escA = (str) => String(str || '');
    global.jq = (str) => JSON.stringify(str || '');
    global.formatLocalDateValue = (d) => (d instanceof Date ? d.toISOString().split('T')[0] : String(d));
    global.parseLocalDateValue = (str) => new Date(str || Date.now());
    global.formatMinutesToHHMM = (m) => {
      const h = String(Math.floor(m / 60)).padStart(2, '0');
      const min = String(m % 60).padStart(2, '0');
      return `${h}:${min}`;
    };
    global.getAppLanguage = () => 'en';
    global.getAppLocale = () => 'en-US';
    global.plannerEvents = [];
    global.manifest = [
      { id: 'note-1', title: 'Untagged Meeting Note', summary: 'Discussed Release 2.9 milestones.', date: '2026-08-28' }
    ];

    mockEngine = {
      getTopicMemoriesCatalog: async () => [{ topicName: 'Release 2.9', key: 'release_2_9' }],
      getMajorTopicMemory: async () => ({ topicName: 'Release 2.9', oneSentenceSummary: 'Release 2.9 features' }),
      synthesizeWorkstreamMemoryWithAI: vi.fn().mockResolvedValue({ topicName: 'Release 2.9' })
    };
    global.WorkstreamMemoryEngine = mockEngine;
    window.WorkstreamMemoryEngine = mockEngine;

    // Load DailyReviewController code cleanly
    const code = fs.readFileSync(path.resolve(__dirname, '../../js/app-dailyreview.js'), 'utf8');
    const fn = new Function('window', 'document', 'StorageAPI', 'StashService', 'LLMService', 'WorkstreamMemoryEngine', code + '\nreturn DailyReviewController;');
    DailyReviewController = fn(
      global,
      document,
      { readNotesManifest: async () => [], readNoteContent: async () => '' },
      { list: async () => [] },
      { isEnabled: () => true, chat: async () => ({ parsed: {} }), extractJsonPayloadFromText: () => ({ parsed: {} }) },
      mockEngine
    );
  });

  it('switches to the workstreams tab correctly', () => {
    DailyReviewController.switchStep5Tab('workstreams');

    expect(document.getElementById('dr-tab-workstream-updates').classList.contains('active')).toBe(true);
    expect(document.getElementById('dr-tab-summary-note').classList.contains('active')).toBe(false);
    expect(document.getElementById('dr-step5-tab-workstreams').style.display).toBe('flex');
    expect(document.getElementById('dr-step5-tab-note').style.display).toBe('none');
  });

  it('renders extracted workstream updates list with badges', () => {
    DailyReviewController.workstreamUpdateStatuses = [
      {
        workstream: 'Release 2.9',
        updates: 'Extracted milestone progress from untagged meeting note.',
        is_untagged_source: true,
        status: 'synced'
      }
    ];

    DailyReviewController.renderStep5WorkstreamUpdatesList();

    const listEl = document.getElementById('dr-ai-workstream-updates-list');
    expect(listEl.innerHTML).toContain('Release 2.9');
    expect(listEl.innerHTML).toContain('Extracted milestone progress');
    expect(document.getElementById('dr-step5-ws-count').textContent).toBe('1');
  });

  it('runs background workstream processing asynchronously and updates progress bar', async () => {
    let resolveSynthesis;
    const mockSynthesize = vi.fn().mockImplementation(() => new Promise((resolve) => {
      resolveSynthesis = resolve;
    }));
    mockEngine.synthesizeWorkstreamMemoryWithAI = mockSynthesize;

    DailyReviewController.processWorkstreamUpdatesInBackground([
      { workstream: 'Release 2.9', updates: 'Backend update', is_untagged_source: false }
    ]);

    expect(DailyReviewController.workstreamUpdateStatuses[0].status).toBe('syncing');
    const banner = document.getElementById('dr-workstream-sync-banner');
    const progressBar = document.getElementById('dr-ws-sync-progress-bar');
    const statusText = document.getElementById('dr-ws-sync-status-text');

    expect(banner.style.display).toBe('flex');
    expect(progressBar.style.width).toBe('0%');

    // Allow promise microtask queue to process
    await new Promise(r => setTimeout(r, 20));

    expect(mockSynthesize).toHaveBeenCalledWith('Release 2.9', expect.objectContaining({
      prompt: 'Backend update',
      mode: 'incremental'
    }));

    // Resolve synthesis
    resolveSynthesis({ topicName: 'Release 2.9' });
    await new Promise(r => setTimeout(r, 20));

    expect(DailyReviewController.workstreamUpdateStatuses[0].status).toBe('synced');
    expect(progressBar.style.width).toBe('100%');
    expect(banner.classList.contains('dr-ws-sync-complete')).toBe(true);
  });

  it('aborts active workstream updates on cancellation', async () => {
    let abortSignalObserved = null;
    const mockSynthesize = vi.fn().mockImplementation((name, opts) => {
      abortSignalObserved = opts.signal;
      return new Promise((resolve, reject) => {
        if (opts.signal) {
          opts.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }
      });
    });

    mockEngine.synthesizeWorkstreamMemoryWithAI = mockSynthesize;

    DailyReviewController.processWorkstreamUpdatesInBackground([
      { workstream: 'Release 2.9', updates: 'Ongoing update', is_untagged_source: true }
    ]);

    expect(DailyReviewController.workstreamUpdatesAbortController).toBeDefined();

    DailyReviewController.cancelWorkstreamUpdates();

    expect(abortSignalObserved?.aborted).toBe(true);
    expect(DailyReviewController.workstreamUpdateStatuses[0].status).toBe('cancelled');
  });

  it('elevates importance and priority on existing todo when suggestion matches without duplicating', async () => {
    const existingTodo = {
      id: 'todo-existing-1',
      title: 'Review Q3 Security Audit',
      priority: 'Low',
      eisenhowerQuadrant: 'Q3',
      eisenhowerY: 75,
      created: '2026-08-01',
      modified: '2026-08-01'
    };
    global.todosManifest = [existingTodo];
    global.saveTodosManifest = vi.fn().mockResolvedValue(true);
    global.refreshTodoViews = vi.fn();
    global.toast = vi.fn();

    DailyReviewController.currentSuggestions = [
      {
        title: 'Review Q3 Security Audit',
        duration: 45,
        priority: 'High'
      }
    ];

    document.body.innerHTML += '<div id="btn-dr-ai-actions-0"></div>';

    await DailyReviewController.createTodoFromSuggestion(0);

    expect(global.todosManifest.length).toBe(1);
    expect(existingTodo.priority).toBe('High');
    expect(existingTodo.eisenhowerQuadrant).toBe('Q1');
    expect(existingTodo.eisenhowerY).toBeLessThanOrEqual(25);
    expect(global.saveTodosManifest).toHaveBeenCalled();
  });

  it('creates new todo if suggestion does not match any existing open todo', async () => {
    const existingTodo = {
      id: 'todo-existing-1',
      title: 'Review Q3 Security Audit',
      priority: 'Low'
    };
    global.todosManifest = [existingTodo];
    global.saveTodosManifest = vi.fn().mockResolvedValue(true);
    global.refreshTodoViews = vi.fn();
    global.toast = vi.fn();

    DailyReviewController.currentSuggestions = [
      {
        title: 'Completely Brand New Task',
        duration: 30,
        priority: 'Medium'
      }
    ];

    document.body.innerHTML += '<div id="btn-dr-ai-actions-0"></div>';

    await DailyReviewController.createTodoFromSuggestion(0);

    expect(global.todosManifest.length).toBe(2);
    expect(global.todosManifest[1].title).toBe('Completely Brand New Task');
    expect(global.saveTodosManifest).toHaveBeenCalled();
  });

  it('planTimeFromSuggestion creates planned event, records item.eventId, renders clickable chip, and openPlanEventFromSuggestion opens modal', async () => {
    global.plannerEvents = [];
    global.savePlanner = vi.fn().mockResolvedValue(true);
    global.renderPlanner = vi.fn();
    global.openPlanEventModal = vi.fn();
    global.toast = vi.fn();

    DailyReviewController.currentSuggestions = [
      {
        title: 'Plan Strategy Session',
        duration: 30,
        priority: 'High'
      }
    ];

    document.body.innerHTML += '<div id="btn-dr-ai-actions-0"></div>';

    await DailyReviewController.planTimeFromSuggestion(0);

    const item = DailyReviewController.currentSuggestions[0];
    expect(item.eventId).toBeDefined();
    expect(item.eventId.startsWith('evt-')).toBe(true);
    expect(global.plannerEvents.length).toBe(1);
    expect(global.plannerEvents[0].id).toBe(item.eventId);
    expect(global.savePlanner).toHaveBeenCalled();

    const actionsRow = document.getElementById('btn-dr-ai-actions-0');
    expect(actionsRow.innerHTML).toContain('openPlanEventFromSuggestion');
    expect(actionsRow.innerHTML).toContain(item.eventId);
    expect(actionsRow.innerHTML).not.toContain('ondblclick');

    // Test openPlanEventFromSuggestion triggers openPlanEventModal
    DailyReviewController.openPlanEventFromSuggestion(item.eventId, item.todoId, 0);
    expect(global.openPlanEventModal).toHaveBeenCalledWith(expect.objectContaining({ id: item.eventId }));
  });

  it('createTodoFromSuggestion chip uses single-click onclick', async () => {
    global.todosManifest = [];
    global.saveTodosManifest = vi.fn().mockResolvedValue(true);
    global.refreshTodoViews = vi.fn();
    global.toast = vi.fn();

    DailyReviewController.currentSuggestions = [
      {
        title: 'Call Supplier',
        duration: 15,
        priority: 'Medium'
      }
    ];

    document.body.innerHTML += '<div id="btn-dr-ai-actions-0"></div>';

    await DailyReviewController.createTodoFromSuggestion(0);

    const actionsRow = document.getElementById('btn-dr-ai-actions-0');
    expect(actionsRow.innerHTML).toContain('onclick="if(typeof openTodoOverlay === \'function\') openTodoOverlay');
    expect(actionsRow.innerHTML).not.toContain('ondblclick');
  });

  it('updateStep5SyncBanner updates nextBtn label and tooltip while syncing and when synced', () => {
    document.body.innerHTML += '<button id="btn-dr-next">Next</button>';
    const nextBtn = document.getElementById('btn-dr-next');
    DailyReviewController.currentStep = 5;

    // While syncing
    DailyReviewController.workstreamUpdateStatuses = [
      { workstream: 'Project Apollo', updates: 'Update 1', status: 'syncing' }
    ];
    DailyReviewController.updateStep5SyncBanner();

    expect(nextBtn.innerHTML).toContain('spinner');
    expect(nextBtn.innerHTML).toContain('dailyreview.workstreamSyncingBtn');
    expect(nextBtn.title).toBe('dailyreview.workstreamSyncingTooltip');

    // When all synced
    DailyReviewController.workstreamUpdateStatuses = [
      { workstream: 'Project Apollo', updates: 'Update 1', status: 'synced' }
    ];
    DailyReviewController.updateStep5SyncBanner({ complete: true });

    expect(nextBtn.innerHTML).toContain('dailyreview.commitBtn');
    expect(nextBtn.title).toBe('dailyreview.commitBtnTooltip');
  });

  it('navigateStep(1) in Step 5 safely waits for background workstream sync, displays closing state, and commits', async () => {
    document.body.innerHTML += `
      <button id="btn-dr-next">Next</button>
      <button id="btn-dr-prev">Prev</button>
    `;
    const nextBtn = document.getElementById('btn-dr-next');
    const prevBtn = document.getElementById('btn-dr-prev');

    DailyReviewController.currentStep = 5;
    DailyReviewController.isClosingDay = false;
    DailyReviewController.saveAISummaryNote = vi.fn().mockResolvedValue(true);
    DailyReviewController.commitFinal = vi.fn().mockResolvedValue(true);

    let resolveSync;
    DailyReviewController.workstreamSyncPromise = new Promise(resolve => {
      resolveSync = resolve;
    });
    DailyReviewController.workstreamUpdateStatuses = [
      { workstream: 'Dossier Marketing', updates: 'Some notes', status: 'syncing' }
    ];

    const navPromise = DailyReviewController.navigateStep(1);

    // Buttons should be disabled during closing
    expect(nextBtn.disabled).toBe(true);
    expect(prevBtn.disabled).toBe(true);
    expect(nextBtn.innerHTML).toContain('dailyreview.workstreamWaitingBtn');

    // Resolve background workstream sync
    resolveSync();
    await navPromise;

    expect(DailyReviewController.saveAISummaryNote).toHaveBeenCalled();
    expect(DailyReviewController.commitFinal).toHaveBeenCalled();
  });

  it('toggleSuggestWorkstreams updates settings, toggles and dom visibility', () => {
    document.body.innerHTML += `
      <input type="checkbox" id="prefs-ai-suggest-workstreams" checked>
      <input type="checkbox" id="dr-toggle-suggest-ws" checked>
      <input type="checkbox" id="dr-ai-regen-suggest-workstreams" checked>
      <div class="dr-suggested-workstreams-section" style="display:flex;"></div>
    `;

    global.settings = { ai: { suggestWorkstreams: true } };

    DailyReviewController.toggleSuggestWorkstreams(false);

    expect(global.settings.ai.suggestWorkstreams).toBe(false);
    expect(document.getElementById('prefs-ai-suggest-workstreams').checked).toBe(false);
    expect(document.getElementById('dr-toggle-suggest-ws').checked).toBe(false);
    expect(document.getElementById('dr-ai-regen-suggest-workstreams').checked).toBe(false);
    expect(document.querySelector('.dr-suggested-workstreams-section').style.display).toBe('none');

    DailyReviewController.toggleSuggestWorkstreams(true);

    expect(global.settings.ai.suggestWorkstreams).toBe(true);
    expect(document.getElementById('prefs-ai-suggest-workstreams').checked).toBe(true);
    expect(document.getElementById('dr-toggle-suggest-ws').checked).toBe(true);
    expect(document.getElementById('dr-ai-regen-suggest-workstreams').checked).toBe(true);
    expect(document.querySelector('.dr-suggested-workstreams-section').style.display).toBe('flex');
  });

  it('openCreateWorkstreamFromSuggestion passes onCreated callback to openCreateWorkstreamModal', () => {
    global.openCreateWorkstreamModal = vi.fn();
    DailyReviewController.suggestedWorkstreams = [
      {
        topic_name: 'Quantum Engine',
        scope: 'Quantum computing engine development',
        tags: { group: 'Tech', major: 'R&D', topic: 'Quantum' }
      }
    ];

    DailyReviewController.openCreateWorkstreamFromSuggestion(0);

    expect(global.openCreateWorkstreamModal).toHaveBeenCalledWith(expect.objectContaining({
      topicName: 'Quantum Engine',
      scope: 'Quantum computing engine development',
      tags: { group: 'Tech', major: 'R&D', topic: 'Quantum' },
      onCreated: expect.any(Function)
    }));
  });

  it('onWorkstreamCreatedFromSuggestion updates suggestion card to confirmation chip and refreshes tab', () => {
    document.body.innerHTML += `
      <div id="dr-suggested-ws-0">
        <button id="btn-dr-create-ws-0">Create Workstream</button>
      </div>
      <div id="dr-ai-summary-content">
        <h3>Pending/New Topics to Tackle</h3>
        <ul></ul>
      </div>
    `;

    DailyReviewController.suggestedWorkstreams = [
      {
        topic_name: 'Quantum Engine',
        scope: 'Quantum computing engine development'
      }
    ];
    DailyReviewController.workstreamUpdateStatuses = [];

    DailyReviewController.onWorkstreamCreatedFromSuggestion(0, 'Quantum Engine');

    expect(DailyReviewController.suggestedWorkstreams[0].created).toBe(true);
    expect(DailyReviewController.suggestedWorkstreams[0].createdName).toBe('Quantum Engine');

    const card = document.getElementById('dr-suggested-ws-0');
    expect(card.innerHTML).toContain('Quantum Engine');
    expect(card.innerHTML).toContain('dailyreview.workstreamCreatedBadge');
    expect(card.innerHTML).toContain('DailyReviewController.openWorkstreamDossier');
    expect(card.innerHTML).toContain('DailyReviewController.createTodoForWorkstream');
    expect(card.innerHTML).toContain('DailyReviewController.planEventForWorkstream');

    // Workstreams tab list and badge count refreshed
    expect(DailyReviewController.workstreamUpdateStatuses.length).toBe(1);
    expect(DailyReviewController.workstreamUpdateStatuses[0].workstream).toBe('Quantum Engine');
    expect(document.getElementById('dr-step5-ws-count').textContent).toBe('1');

    // Summary note content updated
    const summaryEl = document.getElementById('dr-ai-summary-content');
    expect(summaryEl.innerHTML).toContain('Quantum Engine');
  });

  it('createTodoForWorkstream creates a task and opens overlay', async () => {
    global.todosManifest = [];
    global.saveTodosManifest = vi.fn().mockResolvedValue(true);
    global.refreshTodoViews = vi.fn();
    global.openTodoOverlay = vi.fn();
    global.toast = vi.fn();

    await DailyReviewController.createTodoForWorkstream('Project Genesis');

    expect(global.todosManifest.length).toBe(1);
    expect(global.todosManifest[0].title).toBe('Project Genesis: Follow-up');
    expect(global.todosManifest[0].context).toBe('Workstream: Project Genesis');
    expect(global.saveTodosManifest).toHaveBeenCalled();
    expect(global.refreshTodoViews).toHaveBeenCalled();
    expect(global.openTodoOverlay).toHaveBeenCalledWith(global.todosManifest[0].id);
  });
});
