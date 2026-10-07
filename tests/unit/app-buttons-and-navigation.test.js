import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

function triggerClick(el, eventObj = new MouseEvent('click')) {
  if (!el) return;
  const onclickAttr = el.getAttribute('onclick');
  if (onclickAttr) {
    return new Function('event', onclickAttr).call(el, eventObj);
  } else if (typeof el.onclick === 'function') {
    return el.onclick(eventObj);
  } else {
    return el.click();
  }
}

// ═══════════════════════════════════════════════════
// Sourced from: app-buttons-topbar-and-nav.test.js
// ═══════════════════════════════════════════════════
describe('UI Buttons - Topbar, Navigation & Window Controls', () => {
  beforeAll(() => {
    // Basic DOM setup mimicking app.html topbar, window controls, and landing
    document.body.innerHTML = `
      <div id="screen-connect" style="display:block;">
        <button class="landing-btn-resume" id="btn-resume-folder">Resume</button>
        <button class="landing-btn-open" id="btn-open-folder">Open Folder</button>
      </div>
      <div id="screen-main" style="display:none;">
        <button class="win-ctrl-btn" id="win-min" title="Minimize window"></button>
        <button class="win-ctrl-btn" id="win-max" title="Maximize window"></button>
        <button class="win-ctrl-btn win-ctrl-close" id="win-close" title="Close window"></button>
        
        <header class="topbar">
          <button id="btn-topbar-ai" class="topbar-ai-btn" onclick="toggleFloatingChat()">AI</button>
          <button class="tab-btn" id="tab-planner" onclick="switchTab('planner')">Planner</button>
          <button class="tab-btn" id="tab-todos-mode" onclick="switchTab('todos')">Todos</button>
          <button class="tab-btn" id="tab-retro" onclick="switchTab('retro')">Retro</button>
          <button class="tab-btn active" id="tab-notes" onclick="switchTab('notes')">Notes</button>
          <button class="tab-btn" id="tab-decisions" onclick="switchTab('decisions')">Workstreams</button>
          <button class="tab-btn" id="tab-team" onclick="switchTab('team')">Team</button>
          <button class="tab-btn" id="tab-daily-review-btn" onclick="startDailyReview()" style="display: none;">Daily Review</button>
          
          <button class="topbar-icon-btn" id="btn-tutorial-icon" onclick="startTutorial()">Tutorial</button>
          <button class="topbar-icon-btn" id="btn-prefs-icon" onclick="switchTab('prefs')">Prefs</button>
        </header>

        <div id="notes-controls">
          <button class="notes-view-tab active" id="btn-notes-view-map" onclick="setNotesViewMode('map')">Map</button>
          <button class="notes-view-tab" id="btn-notes-view-reader" onclick="setNotesViewMode('reader')">Reader</button>
          <button class="topbar-btn notes-today-btn" id="btn-notes-today" onclick="scrollToTodayNotes()">Today</button>
          <button class="axis-pill active" id="axis-pill-group" onclick="setLaneAxis('group')">Groups</button>
          <button class="axis-pill" id="axis-pill-major" onclick="setLaneAxis('major')">Topics</button>
          <button class="axis-pill" id="axis-pill-week" onclick="setLaneAxis('week')">Weeks</button>
          <button class="topbar-srch-btn on" id="search-content-toggle" onclick="toggleSearchOption('content')">C</button>
          <button class="topbar-srch-btn" id="search-case-toggle" onclick="toggleSearchOption('case')">aa</button>
          <button class="topbar-srch-btn" id="search-regex-toggle" onclick="toggleSearchOption('regex')">.*</button>
          <button class="topbar-btn" id="btn-filter-bar" onclick="toggleFilterBar()">Filter</button>
          <button class="topbar-btn" id="btn-trash-bin" onclick="openTrashBinModal()">Trash</button>
          <button class="topbar-btn" id="btn-knowledge-graph" onclick="KnowledgeGraphViewer.openGraphModal()">Graph</button>
        </div>

        <div id="filter-bar" style="display:none;">
          <button id="filter-clear-btn" onclick="clearFilters()">Clear</button>
        </div>
        <div id="notes-workstream-bar" style="display:none;"></div>
        <div id="note-edit-overlay" style="display:none;"></div>
      </div>
    `;

    globalThis.t = (k) => k;
    globalThis.escH = (s) => String(s || '');
    globalThis.escA = (s) => String(s || '');
    globalThis.toast = vi.fn();
    globalThis.activeTab = 'notes';
    globalThis.startupState = 'BOOT_READY';
    globalThis.lastActiveNoteForTab = {};
    globalThis.currentNote = null;
    globalThis.notesViewMode = 'map';
    globalThis.laneAxis = 'group';
    globalThis.searchInContent = true;
    globalThis.searchCaseSensitive = false;
    globalThis.searchRegex = false;
    globalThis.boardMode = 'notes';
    globalThis.expandedLaneVal = null;
    globalThis.plannerSelectedWeekOffset = 0;
    globalThis._isApplyingHash = false;
    globalThis._isFocusedMode = false;
    globalThis.manifest = [];
    globalThis.updateUrlHash = vi.fn();
    globalThis.renderPlanner = vi.fn();
    globalThis.renderTodos = vi.fn();
    globalThis.renderTodosBoard = vi.fn();
    globalThis.renderRetroPanel = vi.fn();
    globalThis.renderTeamPanel = vi.fn();
    globalThis.renderPrefs = vi.fn();
    globalThis.renderBoard = vi.fn();
    globalThis.renderFilterBarChips = vi.fn();

    // Load scripts
    loadScriptsIntoGlobal([
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-utils.js',
      'js/app-init.js',
      'js/app-board.js'
    ]);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.activeTab = 'notes';
  });

  describe('Window controls', () => {
    it('handles window minimize, maximize, and close buttons', () => {
      const minBtn = document.getElementById('win-min');
      const maxBtn = document.getElementById('win-max');
      const closeBtn = document.getElementById('win-close');

      globalThis.windowControls = {
        minimize: vi.fn(),
        maximize: vi.fn(),
        close: vi.fn()
      };

      expect(minBtn).toBeTruthy();
      expect(maxBtn).toBeTruthy();
      expect(closeBtn).toBeTruthy();

      minBtn.onclick = () => globalThis.windowControls.minimize();
      maxBtn.onclick = () => globalThis.windowControls.maximize();
      closeBtn.onclick = () => globalThis.windowControls.close();

      triggerClick(minBtn);
      expect(globalThis.windowControls.minimize).toHaveBeenCalledTimes(1);

      triggerClick(maxBtn);
      expect(globalThis.windowControls.maximize).toHaveBeenCalledTimes(1);

      triggerClick(closeBtn);
      expect(globalThis.windowControls.close).toHaveBeenCalledTimes(1);
    });
  });

  describe('Landing Screen Buttons', () => {
    it('handles resume folder button click', () => {
      const resumeBtn = document.getElementById('btn-resume-folder');
      expect(resumeBtn).toBeTruthy();
      const resumeSpy = vi.fn();
      resumeBtn.onclick = resumeSpy;
      triggerClick(resumeBtn);
      expect(resumeSpy).toHaveBeenCalledTimes(1);
    });

    it('handles open folder button click', () => {
      const openBtn = document.getElementById('btn-open-folder');
      expect(openBtn).toBeTruthy();
      const openSpy = vi.fn();
      openBtn.onclick = openSpy;
      triggerClick(openBtn);
      expect(openSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Topbar Navigation Tabs', () => {
    it('switches to planner tab on tab-planner click', async () => {
      const plannerTab = document.getElementById('tab-planner');
      expect(plannerTab).toBeTruthy();

      await triggerClick(plannerTab);
      expect(globalThis.activeTab).toBe('planner');
      expect(plannerTab.classList.contains('active')).toBe(true);
    });

    it('switches to todos tab on tab-todos-mode click', async () => {
      const todosTab = document.getElementById('tab-todos-mode');
      expect(todosTab).toBeTruthy();

      await triggerClick(todosTab);
      expect(globalThis.activeTab).toBe('todos');
      expect(todosTab.classList.contains('active')).toBe(true);
    });

    it('switches to retro tab on tab-retro click', async () => {
      const retroTab = document.getElementById('tab-retro');
      expect(retroTab).toBeTruthy();

      await triggerClick(retroTab);
      expect(globalThis.activeTab).toBe('retro');
      expect(retroTab.classList.contains('active')).toBe(true);
    });

    it('switches to notes tab on tab-notes click', async () => {
      globalThis.activeTab = 'planner';
      const notesTab = document.getElementById('tab-notes');
      expect(notesTab).toBeTruthy();

      await triggerClick(notesTab);
      expect(globalThis.activeTab).toBe('notes');
      expect(notesTab.classList.contains('active')).toBe(true);
    });

    it('switches to decisions / workstreams tab on tab-decisions click', async () => {
      const decTab = document.getElementById('tab-decisions');
      expect(decTab).toBeTruthy();

      await triggerClick(decTab);
      expect(globalThis.activeTab).toBe('decisions');
      expect(decTab.classList.contains('active')).toBe(true);
    });

    it('switches to team tab on tab-team click', async () => {
      const teamTab = document.getElementById('tab-team');
      expect(teamTab).toBeTruthy();

      await triggerClick(teamTab);
      expect(globalThis.activeTab).toBe('team');
      expect(teamTab.classList.contains('active')).toBe(true);
    });

    it('handles daily review start button click', () => {
      const drBtn = document.getElementById('tab-daily-review-btn');
      expect(drBtn).toBeTruthy();

      globalThis.startDailyReview = vi.fn();
      triggerClick(drBtn);
      expect(globalThis.startDailyReview).toHaveBeenCalledTimes(1);
    });

    it('handles tutorial icon button click', () => {
      const tutBtn = document.getElementById('btn-tutorial-icon');
      expect(tutBtn).toBeTruthy();

      globalThis.startTutorial = vi.fn();
      triggerClick(tutBtn);
      expect(globalThis.startTutorial).toHaveBeenCalledTimes(1);
    });

    it('handles preferences icon button click', async () => {
      const prefsBtn = document.getElementById('btn-prefs-icon');
      expect(prefsBtn).toBeTruthy();

      await triggerClick(prefsBtn);
      expect(globalThis.activeTab).toBe('prefs');
    });

    it('handles topbar AI button toggle click', () => {
      const aiBtn = document.getElementById('btn-topbar-ai');
      expect(aiBtn).toBeTruthy();

      globalThis.toggleFloatingChat = vi.fn();
      triggerClick(aiBtn);
      expect(globalThis.toggleFloatingChat).toHaveBeenCalledTimes(1);
    });
  });

  describe('Notes Topbar & View Controls', () => {
    it('switches notes view mode between map and reader', () => {
      const mapBtn = document.getElementById('btn-notes-view-map');
      const readerBtn = document.getElementById('btn-notes-view-reader');

      expect(mapBtn).toBeTruthy();
      expect(readerBtn).toBeTruthy();

      globalThis.renderBoard = vi.fn();
      globalThis.renderIntegratedReader = vi.fn();

      triggerClick(readerBtn);
      expect(globalThis.notesViewMode).toBe('reader');

      triggerClick(mapBtn);
      expect(globalThis.notesViewMode).toBe('map');
    });

    it('handles scroll to today notes button click', () => {
      const todayBtn = document.getElementById('btn-notes-today');
      expect(todayBtn).toBeTruthy();

      globalThis.scrollToTodayNotes = vi.fn();
      triggerClick(todayBtn);
      expect(globalThis.scrollToTodayNotes).toHaveBeenCalledTimes(1);
    });

    it('handles axis grouping pill button clicks (group, major, week)', () => {
      const pillGroup = document.getElementById('axis-pill-group');
      const pillMajor = document.getElementById('axis-pill-major');
      const pillWeek = document.getElementById('axis-pill-week');

      globalThis.renderBoard = vi.fn();

      triggerClick(pillMajor);
      expect(globalThis.laneAxis).toBe('major');
      expect(pillMajor.classList.contains('active')).toBe(true);

      triggerClick(pillWeek);
      expect(globalThis.laneAxis).toBe('week');
      expect(pillWeek.classList.contains('active')).toBe(true);

      triggerClick(pillGroup);
      expect(globalThis.laneAxis).toBe('group');
      expect(pillGroup.classList.contains('active')).toBe(true);
    });

    it('handles search option toggle buttons (content, case, regex)', () => {
      const contentToggle = document.getElementById('search-content-toggle');
      const caseToggle = document.getElementById('search-case-toggle');
      const regexToggle = document.getElementById('search-regex-toggle');

      globalThis.filterCards = vi.fn();

      triggerClick(contentToggle);
      expect(globalThis.searchInContent).toBe(false);

      triggerClick(caseToggle);
      expect(globalThis.searchCaseSensitive).toBe(true);

      triggerClick(regexToggle);
      expect(globalThis.searchRegex).toBe(true);
    });

    it('handles filter bar toggle button click', () => {
      const filterBarBtn = document.getElementById('btn-filter-bar');
      const filterBar = document.getElementById('filter-bar');

      triggerClick(filterBarBtn);
      expect(filterBar.style.display).toBe('block');

      triggerClick(filterBarBtn);
      expect(filterBar.style.display).toBe('none');
    });

    it('handles trash bin button click', () => {
      const trashBtn = document.getElementById('btn-trash-bin');
      globalThis.openTrashBinModal = vi.fn();

      triggerClick(trashBtn);
      expect(globalThis.openTrashBinModal).toHaveBeenCalledTimes(1);
    });

    it('handles knowledge graph button click', () => {
      const graphBtn = document.getElementById('btn-knowledge-graph');
      globalThis.KnowledgeGraphViewer = {
        openGraphModal: vi.fn()
      };

      triggerClick(graphBtn);
      expect(globalThis.KnowledgeGraphViewer.openGraphModal).toHaveBeenCalledTimes(1);
    });

    it('handles clear filters button click inside filter bar', () => {
      const clearBtn = document.getElementById('filter-clear-btn');
      globalThis.clearFilters = vi.fn();

      triggerClick(clearBtn);
      expect(globalThis.clearFilters).toHaveBeenCalledTimes(1);
    });
  });
});

// ═══════════════════════════════════════════════════
// Sourced from: app-buttons-planner-and-board.test.js
// ═══════════════════════════════════════════════════
describe('UI Buttons - Planner, Board, Workstreams & Team Dynamic Actions', () => {
  beforeAll(() => {
    document.body.innerHTML = `
      <div id="screen-main">
        <!-- Planner Header and Controls Container -->
        <div id="planner-header" class="planner-header">
          <button class="btn btn-sm" id="planner-nav-prev" onclick="navigatePlannerWeek(-1)">Prev</button>
          <button class="btn btn-sm" id="planner-nav-today" onclick="navigatePlannerToday()">Today</button>
          <button class="btn btn-sm" id="planner-nav-next" onclick="navigatePlannerWeek(1)">Next</button>
          <button class="btn btn-sm" id="planner-proposals-toggle" onclick="togglePlannerProposals()">Proposals</button>
          <button class="btn btn-sm" id="planner-auto-balance-btn" onclick="openPlannerAutoBalanceModal()">Auto Balance</button>
          <button class="btn btn-sm" id="planner-add-block-btn" onclick="openNewPlannerBlockModal()">+ New Block</button>
          <button class="btn btn-sm" id="planner-export-ics-btn" onclick="exportPlannerCalendarICS()">Export ICS</button>
        </div>

        <!-- Planner Block Modal -->
        <div id="modal-planner-block" class="modal-overlay" style="display:none;">
          <button id="pb-save-btn" onclick="savePlannerBlockFromModal()">Save Block</button>
          <button id="pb-delete-btn" onclick="deletePlannerBlockFromModal()">Delete Block</button>
          <button id="pb-series-edit-btn" onclick="openSeriesEditOptions()">Edit Series</button>
          <button id="pb-close-btn" onclick="closePlannerBlockModal()">Cancel</button>
        </div>

        <!-- Todos Board Controls -->
        <div id="todos-board-controls">
          <button id="todos-add-btn" onclick="openNewTodoModal()">+ New Task</button>
          <button id="todos-matrix-view-btn" onclick="switchTodosView('matrix')">Matrix View</button>
          <button id="todos-list-view-btn" onclick="switchTodosView('list')">List View</button>
          <button id="todos-filter-high-btn" onclick="toggleTodosPriorityFilter('high')">High Priority</button>
          <button id="todos-bulk-done-btn" onclick="markSelectedTodosDone()">Mark Done</button>
          <button id="todos-bulk-delete-btn" onclick="deleteSelectedTodos()">Delete Selected</button>
        </div>

        <!-- Workstreams and Team Controls -->
        <div id="workstreams-controls">
          <button id="ws-create-btn" onclick="openCreateWorkstreamModal()">+ New Workstream</button>
          <button id="team-add-member-btn" onclick="openAddTeamMemberModal()">+ Add Member</button>
        </div>

        <!-- Retrospective View Controls -->
        <div id="retro-controls">
          <button class="retro-period-btn active" id="retro-period-week" onclick="setRetroPeriod('week')">Week</button>
          <button class="retro-period-btn" id="retro-period-month" onclick="setRetroPeriod('month')">Month</button>
          <button class="retro-period-btn" id="retro-period-quarter" onclick="setRetroPeriod('quarter')">Quarter</button>
          <button id="retro-export-report-btn" onclick="exportRetroReport()">Export Report</button>
        </div>
      </div>
    `;

    globalThis.t = (k) => k;
    globalThis.escH = (s) => String(s || '');
    globalThis.escA = (s) => String(s || '');
    globalThis.toast = vi.fn();

    loadScriptsIntoGlobal([
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-utils.js'
    ]);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Planner Calendar Header & Action Buttons', () => {
    it('handles planner week navigation and today buttons', () => {
      const prevBtn = document.getElementById('planner-nav-prev');
      const todayBtn = document.getElementById('planner-nav-today');
      const nextBtn = document.getElementById('planner-nav-next');

      globalThis.navigatePlannerWeek = vi.fn();
      globalThis.navigatePlannerToday = vi.fn();

      triggerClick(prevBtn);
      expect(globalThis.navigatePlannerWeek).toHaveBeenCalledWith(-1);

      triggerClick(todayBtn);
      expect(globalThis.navigatePlannerToday).toHaveBeenCalledTimes(1);

      triggerClick(nextBtn);
      expect(globalThis.navigatePlannerWeek).toHaveBeenCalledWith(1);
    });

    it('handles proposals toggle, auto-balance, new block, and export ICS buttons', () => {
      const propToggle = document.getElementById('planner-proposals-toggle');
      const autoBalBtn = document.getElementById('planner-auto-balance-btn');
      const addBlockBtn = document.getElementById('planner-add-block-btn');
      const exportIcsBtn = document.getElementById('planner-export-ics-btn');

      globalThis.togglePlannerProposals = vi.fn();
      globalThis.openPlannerAutoBalanceModal = vi.fn();
      globalThis.openNewPlannerBlockModal = vi.fn();
      globalThis.exportPlannerCalendarICS = vi.fn();

      triggerClick(propToggle);
      expect(globalThis.togglePlannerProposals).toHaveBeenCalledTimes(1);

      triggerClick(autoBalBtn);
      expect(globalThis.openPlannerAutoBalanceModal).toHaveBeenCalledTimes(1);

      triggerClick(addBlockBtn);
      expect(globalThis.openNewPlannerBlockModal).toHaveBeenCalledTimes(1);

      triggerClick(exportIcsBtn);
      expect(globalThis.exportPlannerCalendarICS).toHaveBeenCalledTimes(1);
    });

    it('handles planner block modal buttons (save, delete, series edit, close)', () => {
      const saveBtn = document.getElementById('pb-save-btn');
      const delBtn = document.getElementById('pb-delete-btn');
      const seriesBtn = document.getElementById('pb-series-edit-btn');
      const closeBtn = document.getElementById('pb-close-btn');

      globalThis.savePlannerBlockFromModal = vi.fn();
      globalThis.deletePlannerBlockFromModal = vi.fn();
      globalThis.openSeriesEditOptions = vi.fn();
      globalThis.closePlannerBlockModal = vi.fn();

      triggerClick(saveBtn);
      expect(globalThis.savePlannerBlockFromModal).toHaveBeenCalledTimes(1);

      triggerClick(delBtn);
      expect(globalThis.deletePlannerBlockFromModal).toHaveBeenCalledTimes(1);

      triggerClick(seriesBtn);
      expect(globalThis.openSeriesEditOptions).toHaveBeenCalledTimes(1);

      triggerClick(closeBtn);
      expect(globalThis.closePlannerBlockModal).toHaveBeenCalledTimes(1);
    });
  });

  describe('Todos Board & Eisenhower Matrix View Buttons', () => {
    it('handles new task, matrix/list view switch, priority filter, and bulk action buttons', () => {
      const addBtn = document.getElementById('todos-add-btn');
      const matrixBtn = document.getElementById('todos-matrix-view-btn');
      const listBtn = document.getElementById('todos-list-view-btn');
      const filterBtn = document.getElementById('todos-filter-high-btn');
      const bulkDoneBtn = document.getElementById('todos-bulk-done-btn');
      const bulkDelBtn = document.getElementById('todos-bulk-delete-btn');

      globalThis.openNewTodoModal = vi.fn();
      globalThis.switchTodosView = vi.fn();
      globalThis.toggleTodosPriorityFilter = vi.fn();
      globalThis.markSelectedTodosDone = vi.fn();
      globalThis.deleteSelectedTodos = vi.fn();

      triggerClick(addBtn);
      expect(globalThis.openNewTodoModal).toHaveBeenCalledTimes(1);

      triggerClick(matrixBtn);
      expect(globalThis.switchTodosView).toHaveBeenCalledWith('matrix');

      triggerClick(listBtn);
      expect(globalThis.switchTodosView).toHaveBeenCalledWith('list');

      triggerClick(filterBtn);
      expect(globalThis.toggleTodosPriorityFilter).toHaveBeenCalledWith('high');

      triggerClick(bulkDoneBtn);
      expect(globalThis.markSelectedTodosDone).toHaveBeenCalledTimes(1);

      triggerClick(bulkDelBtn);
      expect(globalThis.deleteSelectedTodos).toHaveBeenCalledTimes(1);
    });
  });

  describe('Workstreams, Team & Retrospective View Buttons', () => {
    it('handles create workstream and add team member buttons', () => {
      const wsBtn = document.getElementById('ws-create-btn');
      const teamBtn = document.getElementById('team-add-member-btn');

      globalThis.openCreateWorkstreamModal = vi.fn();
      globalThis.openAddTeamMemberModal = vi.fn();

      triggerClick(wsBtn);
      expect(globalThis.openCreateWorkstreamModal).toHaveBeenCalledTimes(1);

      triggerClick(teamBtn);
      expect(globalThis.openAddTeamMemberModal).toHaveBeenCalledTimes(1);
    });

    it('handles retrospective period selection and export report buttons', () => {
      const weekBtn = document.getElementById('retro-period-week');
      const monthBtn = document.getElementById('retro-period-month');
      const quarterBtn = document.getElementById('retro-period-quarter');
      const exportBtn = document.getElementById('retro-export-report-btn');

      globalThis.setRetroPeriod = vi.fn();
      globalThis.exportRetroReport = vi.fn();

      triggerClick(weekBtn);
      expect(globalThis.setRetroPeriod).toHaveBeenCalledWith('week');

      triggerClick(monthBtn);
      expect(globalThis.setRetroPeriod).toHaveBeenCalledWith('month');

      triggerClick(quarterBtn);
      expect(globalThis.setRetroPeriod).toHaveBeenCalledWith('quarter');

      triggerClick(exportBtn);
      expect(globalThis.exportRetroReport).toHaveBeenCalledTimes(1);
    });
  });
});

// ═══════════════════════════════════════════════════
// Sourced from: app-buttons-preferences.test.js
// ═══════════════════════════════════════════════════
describe('UI Buttons - Preferences & Settings Panel', () => {
  beforeAll(() => {
    document.body.innerHTML = `
      <div id="tab-content-prefs">
        <!-- Prefs tabs -->
        <div class="prefs-tab-bar" role="tablist">
          <button class="prefs-tab-btn active" id="prefs-tab-general-btn" data-tab="general" onclick="switchPrefsTab('general')" role="tab" aria-selected="true">Général</button>
          <button class="prefs-tab-btn" id="prefs-tab-appearance-btn" data-tab="appearance" onclick="switchPrefsTab('appearance')" role="tab" aria-selected="false">Apparence</button>
          <button class="prefs-tab-btn" id="prefs-tab-schedule-btn" data-tab="schedule" onclick="switchPrefsTab('schedule')" role="tab" aria-selected="false">Agenda</button>
          <button class="prefs-tab-btn" id="prefs-tab-ai-btn" data-tab="ai" onclick="switchPrefsTab('ai')" role="tab" aria-selected="false">Assistant IA</button>
          <button class="prefs-tab-btn" id="prefs-tab-system-btn" data-tab="system" onclick="switchPrefsTab('system')" role="tab" aria-selected="false">Système</button>
        </div>

        <div id="prefs-sec-language" class="prefs-section" style="display:block;"></div>
        <div id="prefs-sec-profile" class="prefs-section" style="display:block;"></div>
        <div id="prefs-sec-appearance" class="prefs-section" style="display:none;"></div>
        <div id="prefs-sec-schedule" class="prefs-section" style="display:none;"></div>
        <div id="prefs-sec-ai" class="prefs-section" style="display:none;">
          <button type="button" class="btn btn-secondary btn-sm" id="btn-scan-models" onclick="scanLocalModelsFromUI()">Scan</button>
          <button type="button" id="btn-test-ai-connection" class="setup-wizard-btn setup-wizard-btn-test" onclick="testLocalLLMConnection()">Test Connection</button>
          <button type="button" class="btn" onclick="copyAiJsonSchema()" id="btn-copy-ai-schema">Copy Schema</button>
          <button type="button" class="btn" onclick="copyExternalAgentPrompt()" id="btn-copy-agent-prompt">Copy Guidelines</button>
          <button type="button" class="btn" id="btn-run-bulk-summaries" onclick="runBulkAISummaries()">Lancer la génération</button>
          <button type="button" class="btn btn-danger" id="btn-cancel-bulk-summaries" onclick="cancelBulkAISummaries()">Annuler</button>
        </div>
        <div id="prefs-sec-folder" class="prefs-section" style="display:none;"></div>
        <div id="prefs-sec-maintenance" class="prefs-section" style="display:none;">
          <button class="btn" id="btn-rebuild-all" onclick="rebuildAll()">Rebuild</button>
          <button class="btn" id="prefs-setup-wizard-btn" onclick="SetupWizardController.open()">Run Setup Wizard</button>
          <button class="btn" id="prefs-tutorial-btn" onclick="startTutorial()">Start Tour</button>
          <button class="btn" id="btn-change-folder" onclick="changeFolderFromPrefs()">Change</button>
          <button class="btn" id="btn-forget-folder" onclick="clearSavedFolder()">Forget</button>
        </div>
        <div id="prefs-sec-help" class="prefs-section" style="display:none;"></div>

        <div class="prefs-bottom-actions">
          <button class="btn" id="btn-load-settings" onclick="loadSettingsFromFolderUI()">Load</button>
          <button class="btn btn-save" id="btn-save-prefs" onclick="savePrefs()">Save</button>
        </div>
      </div>
    `;

    globalThis.t = (k) => k;
    globalThis.escH = (s) => String(s || '');
    globalThis.escA = (s) => String(s || '');
    globalThis.toast = vi.fn();
    globalThis.settings = {
      username: 'Tester',
      aiModel: 'mistral'
    };

    loadScriptsIntoGlobal([
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-utils.js',
      'js/app-init.js'
    ]);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Preferences Tabs Switching', () => {
    it('switches between all 5 preferences tabs', () => {
      const generalBtn = document.getElementById('prefs-tab-general-btn');
      const appearanceBtn = document.getElementById('prefs-tab-appearance-btn');
      const scheduleBtn = document.getElementById('prefs-tab-schedule-btn');
      const aiBtn = document.getElementById('prefs-tab-ai-btn');
      const systemBtn = document.getElementById('prefs-tab-system-btn');

      triggerClick(appearanceBtn);
      expect(document.getElementById('prefs-sec-appearance').style.display).toBe('block');
      expect(document.getElementById('prefs-sec-language').style.display).toBe('none');
      expect(appearanceBtn.classList.contains('active')).toBe(true);

      triggerClick(scheduleBtn);
      expect(document.getElementById('prefs-sec-schedule').style.display).toBe('block');
      expect(scheduleBtn.classList.contains('active')).toBe(true);

      triggerClick(aiBtn);
      expect(document.getElementById('prefs-sec-ai').style.display).toBe('block');
      expect(aiBtn.classList.contains('active')).toBe(true);

      triggerClick(systemBtn);
      expect(document.getElementById('prefs-sec-maintenance').style.display).toBe('block');
      expect(systemBtn.classList.contains('active')).toBe(true);

      triggerClick(generalBtn);
      expect(document.getElementById('prefs-sec-language').style.display).toBe('block');
      expect(generalBtn.classList.contains('active')).toBe(true);
    });
  });

  describe('AI Preferences Action Buttons', () => {
    it('handles scan models button click', () => {
      const scanBtn = document.getElementById('btn-scan-models');
      globalThis.scanLocalModelsFromUI = vi.fn();

      triggerClick(scanBtn);
      expect(globalThis.scanLocalModelsFromUI).toHaveBeenCalledTimes(1);
    });

    it('handles test connection button click', () => {
      const testBtn = document.getElementById('btn-test-ai-connection');
      globalThis.testLocalLLMConnection = vi.fn();

      triggerClick(testBtn);
      expect(globalThis.testLocalLLMConnection).toHaveBeenCalledTimes(1);
    });

    it('handles copy schema button click', () => {
      const copySchemaBtn = document.getElementById('btn-copy-ai-schema');
      globalThis.copyAiJsonSchema = vi.fn();

      triggerClick(copySchemaBtn);
      expect(globalThis.copyAiJsonSchema).toHaveBeenCalledTimes(1);
    });

    it('handles copy agent prompt button click', () => {
      const copyPromptBtn = document.getElementById('btn-copy-agent-prompt');
      globalThis.copyExternalAgentPrompt = vi.fn();

      triggerClick(copyPromptBtn);
      expect(globalThis.copyExternalAgentPrompt).toHaveBeenCalledTimes(1);
    });

    it('handles run bulk summaries and cancel bulk summaries button clicks', () => {
      const runBtn = document.getElementById('btn-run-bulk-summaries');
      const cancelBtn = document.getElementById('btn-cancel-bulk-summaries');

      globalThis.runBulkAISummaries = vi.fn();
      globalThis.cancelBulkAISummaries = vi.fn();

      triggerClick(runBtn);
      expect(globalThis.runBulkAISummaries).toHaveBeenCalledTimes(1);

      triggerClick(cancelBtn);
      expect(globalThis.cancelBulkAISummaries).toHaveBeenCalledTimes(1);
    });
  });

  describe('System & General Settings Action Buttons', () => {
    it('handles rebuild all button click', () => {
      const rebuildBtn = document.getElementById('btn-rebuild-all');
      globalThis.rebuildAll = vi.fn();

      triggerClick(rebuildBtn);
      expect(globalThis.rebuildAll).toHaveBeenCalledTimes(1);
    });

    it('handles setup wizard trigger button click', () => {
      const wizardBtn = document.getElementById('prefs-setup-wizard-btn');
      globalThis.SetupWizardController = {
        open: vi.fn()
      };

      triggerClick(wizardBtn);
      expect(globalThis.SetupWizardController.open).toHaveBeenCalledTimes(1);
    });

    it('handles tutorial tour start button click', () => {
      const tourBtn = document.getElementById('prefs-tutorial-btn');
      globalThis.startTutorial = vi.fn();

      triggerClick(tourBtn);
      expect(globalThis.startTutorial).toHaveBeenCalledTimes(1);
    });

    it('handles change folder and forget folder button clicks', () => {
      const changeBtn = document.getElementById('btn-change-folder');
      const forgetBtn = document.getElementById('btn-forget-folder');

      globalThis.changeFolderFromPrefs = vi.fn();
      globalThis.clearSavedFolder = vi.fn();

      triggerClick(changeBtn);
      expect(globalThis.changeFolderFromPrefs).toHaveBeenCalledTimes(1);

      triggerClick(forgetBtn);
      expect(globalThis.clearSavedFolder).toHaveBeenCalledTimes(1);
    });

    it('handles load settings and save preferences button clicks', () => {
      const loadBtn = document.getElementById('btn-load-settings');
      const saveBtn = document.getElementById('btn-save-prefs');

      globalThis.loadSettingsFromFolderUI = vi.fn();
      globalThis.savePrefs = vi.fn();

      triggerClick(loadBtn);
      expect(globalThis.loadSettingsFromFolderUI).toHaveBeenCalledTimes(1);

      triggerClick(saveBtn);
      expect(globalThis.savePrefs).toHaveBeenCalledTimes(1);
    });
  });
});

// ═══════════════════════════════════════════════════
// Sourced from: app-buttons-dailyreview-and-companion.test.js
// ═══════════════════════════════════════════════════
describe('UI Buttons - Daily Review, Companion Chat & Omnibar', () => {
  beforeAll(() => {
    const floatingChatHtml = fs.readFileSync(path.resolve(process.cwd(), 'templates/floating-chat.html'), 'utf-8');
    const omnibarHtml = fs.readFileSync(path.resolve(process.cwd(), 'templates/omnibar.html'), 'utf-8');

    document.body.innerHTML = `
      <div id="screen-main">
        <!-- Daily Review Section -->
        <div class="dr-header-actions">
          <button class="btn" id="btn-dr-guide" onclick="DailyReviewController.startGuidedTour()">Guide</button>
          <button class="btn btn-danger" id="btn-dr-quit" onclick="confirmQuitDailyReview()">Quitter</button>
        </div>

        <div class="dr-start-card">
          <button class="btn btn-primary" id="btn-dr-start" onclick="startDailyReviewForSelectedDate()">Démarrer la Revue</button>
        </div>

        <!-- Step 3 actions -->
        <button type="button" class="btn btn-primary dr-batch-btn" id="btn-dr-batch-perfect" onclick="DailyReviewController.startBatchPerfectNotes()">Convert All to Perfect Notes</button>
        <button type="button" class="dr-step3-toggle-btn" id="btn-dr-step3-note-toggle" onclick="DailyReviewController.toggleStep3EditorPane()">-</button>
        <button type="button" class="btn btn-secondary" id="btn-dr-cancel-batch" onclick="DailyReviewController.cancelBatchPerfectNotes()">Cancel</button>

        <!-- Step 3 Integrated Review Buttons -->
        <button type="button" class="refactor-tab-btn" id="dr-tab-proposal-a" onclick="DailyReviewController.switchIntegratedTab('A')">Proposal A</button>
        <button type="button" class="refactor-tab-btn" id="dr-tab-proposal-b" onclick="DailyReviewController.switchIntegratedTab('B')">Proposal B</button>
        <button type="button" class="refactor-tab-btn" id="dr-tab-proposal-c" onclick="DailyReviewController.switchIntegratedTab('C')">Option C</button>
        <button type="button" class="refactor-tab-btn" id="dr-tab-original" onclick="DailyReviewController.switchIntegratedTab('original')">Original</button>
        <button type="button" class="refactor-tab-btn" id="dr-tab-scratchpad" onclick="DailyReviewController.switchIntegratedTab('scratchpad')">Scratchpad</button>

        <button type="button" class="btn btn-secondary" id="btn-dr-switch-raw-editor" onclick="DailyReviewController.switchToRawEditor()">Raw Editor</button>
        <button type="button" class="btn btn-secondary" id="btn-dr-integrated-decline" onclick="DailyReviewController.toggleIntegratedFeedbackDrawer(true)">Option C</button>
        <button type="button" class="btn" id="btn-dr-integrated-copy" onclick="DailyReviewController.copyIntegratedProposal()">Copy</button>
        <button type="button" class="btn" id="btn-dr-integrated-keep-orig" onclick="DailyReviewController.keepOriginalNote()">Keep Original</button>
        <button type="button" class="btn btn-primary" id="btn-dr-integrated-apply" onclick="DailyReviewController.applyIntegratedProposal()">Apply</button>
        <button type="button" class="btn btn-primary" id="btn-dr-integrated-gen-c" onclick="DailyReviewController.generateIntegratedOptionC()">Generate Option C</button>
        <button type="button" class="btn btn-danger" id="btn-dr-ai-cancel" onclick="DailyReviewController.cancelAISummaryGeneration()">Cancel AI</button>

        <!-- Step 5 Tabs -->
        <button type="button" class="refactor-tab-btn" id="dr-ws-sync-view-btn" onclick="DailyReviewController.switchStep5Tab('sync')">Sync</button>
        <button type="button" class="refactor-tab-btn" id="dr-tab-summary-note" onclick="DailyReviewController.switchStep5Tab('summary')">Summary Note</button>
        <button type="button" class="refactor-tab-btn" id="dr-tab-summaries-list" onclick="DailyReviewController.switchStep5Tab('list')">List</button>
        <button type="button" class="refactor-tab-btn" id="dr-tab-workstream-updates" onclick="DailyReviewController.switchStep5Tab('ws')">Updates</button>

        <!-- Navigation Buttons -->
        <button class="btn btn-secondary" id="btn-dr-prev" onclick="navigateDailyReviewStep(-1)">Précédent</button>
        <button class="btn btn-primary" id="btn-dr-next" onclick="navigateDailyReviewStep(1)">Suivant</button>

        <!-- AI Regenerate Popover Buttons -->
        <button type="button" class="btn btn-secondary" id="btn-dr-ai-regenerate" onclick="DailyReviewController.handleRegenerateClick()">Regenerate</button>
        <button type="button" id="btn-dr-submit-regen" onclick="DailyReviewController.submitRegenerateWithContext()">Submit Regen</button>
        <button type="button" id="btn-dr-hide-regen" onclick="DailyReviewController.hideRegeneratePopover()">Hide Regen</button>

        <!-- Focus PIP Overlay Buttons -->
        <button id="btn-pip-toggle-timer" onclick="toggleFocusPipTimer()">Timer</button>
        <button id="btn-pip-close" onclick="closeFocusPipWindow()">Close PIP</button>

        <!-- Floating Chat Companion -->
        ${floatingChatHtml}

        <!-- Omnibar Template -->
        ${omnibarHtml}
      </div>
    `;

    globalThis.t = (k) => k;
    globalThis.escH = (s) => String(s || '');
    globalThis.escA = (s) => String(s || '');
    globalThis.toast = vi.fn();

    loadScriptsIntoGlobal([
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-utils.js'
    ]);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Daily Review Header & Navigation Buttons', () => {
    it('handles guide, quit, start, and step navigation buttons', () => {
      const guideBtn = document.getElementById('btn-dr-guide');
      const quitBtn = document.getElementById('btn-dr-quit');
      const startBtn = document.getElementById('btn-dr-start');
      const prevBtn = document.getElementById('btn-dr-prev');
      const nextBtn = document.getElementById('btn-dr-next');

      globalThis.DailyReviewController = {
        startGuidedTour: vi.fn(),
        startBatchPerfectNotes: vi.fn(),
        toggleStep3EditorPane: vi.fn(),
        cancelBatchPerfectNotes: vi.fn(),
        switchIntegratedTab: vi.fn(),
        switchToRawEditor: vi.fn(),
        toggleIntegratedFeedbackDrawer: vi.fn(),
        copyIntegratedProposal: vi.fn(),
        keepOriginalNote: vi.fn(),
        applyIntegratedProposal: vi.fn(),
        generateIntegratedOptionC: vi.fn(),
        cancelAISummaryGeneration: vi.fn(),
        switchStep5Tab: vi.fn(),
        handleRegenerateClick: vi.fn(),
        submitRegenerateWithContext: vi.fn(),
        hideRegeneratePopover: vi.fn()
      };

      globalThis.confirmQuitDailyReview = vi.fn();
      globalThis.startDailyReviewForSelectedDate = vi.fn();
      globalThis.navigateDailyReviewStep = vi.fn();

      triggerClick(guideBtn);
      expect(globalThis.DailyReviewController.startGuidedTour).toHaveBeenCalledTimes(1);

      triggerClick(quitBtn);
      expect(globalThis.confirmQuitDailyReview).toHaveBeenCalledTimes(1);

      triggerClick(startBtn);
      expect(globalThis.startDailyReviewForSelectedDate).toHaveBeenCalledTimes(1);

      triggerClick(prevBtn);
      expect(globalThis.navigateDailyReviewStep).toHaveBeenCalledWith(-1);

      triggerClick(nextBtn);
      expect(globalThis.navigateDailyReviewStep).toHaveBeenCalledWith(1);
    });
  });

  describe('Daily Review Step 3 & Step 5 Action Buttons', () => {
    it('handles batch perfect notes and pane toggle buttons', () => {
      const batchBtn = document.getElementById('btn-dr-batch-perfect');
      const togglePaneBtn = document.getElementById('btn-dr-step3-note-toggle');
      const cancelBatchBtn = document.getElementById('btn-dr-cancel-batch');

      triggerClick(batchBtn);
      expect(globalThis.DailyReviewController.startBatchPerfectNotes).toHaveBeenCalledTimes(1);

      triggerClick(togglePaneBtn);
      expect(globalThis.DailyReviewController.toggleStep3EditorPane).toHaveBeenCalledTimes(1);

      triggerClick(cancelBatchBtn);
      expect(globalThis.DailyReviewController.cancelBatchPerfectNotes).toHaveBeenCalledTimes(1);
    });

    it('handles integrated proposal review actions and tabs', () => {
      const tabA = document.getElementById('dr-tab-proposal-a');
      const tabB = document.getElementById('dr-tab-proposal-b');
      const tabC = document.getElementById('dr-tab-proposal-c');
      const tabOrig = document.getElementById('dr-tab-original');
      const tabScratch = document.getElementById('dr-tab-scratchpad');

      triggerClick(tabA);
      expect(globalThis.DailyReviewController.switchIntegratedTab).toHaveBeenCalledWith('A');

      triggerClick(tabB);
      expect(globalThis.DailyReviewController.switchIntegratedTab).toHaveBeenCalledWith('B');

      triggerClick(tabC);
      expect(globalThis.DailyReviewController.switchIntegratedTab).toHaveBeenCalledWith('C');

      triggerClick(tabOrig);
      expect(globalThis.DailyReviewController.switchIntegratedTab).toHaveBeenCalledWith('original');

      triggerClick(tabScratch);
      expect(globalThis.DailyReviewController.switchIntegratedTab).toHaveBeenCalledWith('scratchpad');

      const rawBtn = document.getElementById('btn-dr-switch-raw-editor');
      const declineBtn = document.getElementById('btn-dr-integrated-decline');
      const copyBtn = document.getElementById('btn-dr-integrated-copy');
      const keepOrigBtn = document.getElementById('btn-dr-integrated-keep-orig');
      const applyBtn = document.getElementById('btn-dr-integrated-apply');
      const genCBtn = document.getElementById('btn-dr-integrated-gen-c');
      const cancelAiBtn = document.getElementById('btn-dr-ai-cancel');

      triggerClick(rawBtn);
      expect(globalThis.DailyReviewController.switchToRawEditor).toHaveBeenCalledTimes(1);

      triggerClick(declineBtn);
      expect(globalThis.DailyReviewController.toggleIntegratedFeedbackDrawer).toHaveBeenCalledWith(true);

      triggerClick(copyBtn);
      expect(globalThis.DailyReviewController.copyIntegratedProposal).toHaveBeenCalledTimes(1);

      triggerClick(keepOrigBtn);
      expect(globalThis.DailyReviewController.keepOriginalNote).toHaveBeenCalledTimes(1);

      triggerClick(applyBtn);
      expect(globalThis.DailyReviewController.applyIntegratedProposal).toHaveBeenCalledTimes(1);

      triggerClick(genCBtn);
      expect(globalThis.DailyReviewController.generateIntegratedOptionC).toHaveBeenCalledTimes(1);

      triggerClick(cancelAiBtn);
      expect(globalThis.DailyReviewController.cancelAISummaryGeneration).toHaveBeenCalledTimes(1);
    });

    it('handles Step 5 tab switching buttons', () => {
      const syncBtn = document.getElementById('dr-ws-sync-view-btn');
      const summaryNoteBtn = document.getElementById('dr-tab-summary-note');
      const summariesListBtn = document.getElementById('dr-tab-summaries-list');
      const wsUpdatesBtn = document.getElementById('dr-tab-workstream-updates');

      triggerClick(syncBtn);
      expect(globalThis.DailyReviewController.switchStep5Tab).toHaveBeenCalledWith('sync');

      triggerClick(summaryNoteBtn);
      expect(globalThis.DailyReviewController.switchStep5Tab).toHaveBeenCalledWith('summary');

      triggerClick(summariesListBtn);
      expect(globalThis.DailyReviewController.switchStep5Tab).toHaveBeenCalledWith('list');

      triggerClick(wsUpdatesBtn);
      expect(globalThis.DailyReviewController.switchStep5Tab).toHaveBeenCalledWith('ws');
    });

    it('handles AI regenerate popover buttons', () => {
      const regenBtn = document.getElementById('btn-dr-ai-regenerate');
      const submitBtn = document.getElementById('btn-dr-submit-regen');
      const hideBtn = document.getElementById('btn-dr-hide-regen');

      triggerClick(regenBtn);
      expect(globalThis.DailyReviewController.handleRegenerateClick).toHaveBeenCalledTimes(1);

      triggerClick(submitBtn);
      expect(globalThis.DailyReviewController.submitRegenerateWithContext).toHaveBeenCalledTimes(1);

      triggerClick(hideBtn);
      expect(globalThis.DailyReviewController.hideRegeneratePopover).toHaveBeenCalledTimes(1);
    });
  });

  describe('Focus PIP Window Buttons', () => {
    it('handles PIP timer toggle and PIP close buttons', () => {
      const timerBtn = document.getElementById('btn-pip-toggle-timer');
      const closePipBtn = document.getElementById('btn-pip-close');

      globalThis.toggleFocusPipTimer = vi.fn();
      globalThis.closeFocusPipWindow = vi.fn();

      triggerClick(timerBtn);
      expect(globalThis.toggleFocusPipTimer).toHaveBeenCalledTimes(1);

      triggerClick(closePipBtn);
      expect(globalThis.closeFocusPipWindow).toHaveBeenCalledTimes(1);
    });
  });

  describe('Floating Chat Companion & Omnibar AI Buttons', () => {
    it('handles floating chat header buttons (guide, popout, minimize, toggle)', () => {
      const guideBtn = document.getElementById('btn-agent-guide');
      const popoutBtn = document.getElementById('btn-floating-chat-popout');
      const chatHeader = document.querySelector('.floating-chat-header');
      const minBtn = chatHeader.querySelector('button:nth-last-child(2)');
      const toggleBtn = chatHeader.querySelector('button:nth-last-child(1)');

      globalThis.AIChatController = {
        showAgentGuide: vi.fn(),
        popoutToWindow: vi.fn()
      };
      globalThis.minimizeFloatingChat = vi.fn();
      globalThis.toggleFloatingChat = vi.fn();

      triggerClick(guideBtn);
      expect(globalThis.AIChatController.showAgentGuide).toHaveBeenCalledTimes(1);

      triggerClick(popoutBtn);
      expect(globalThis.AIChatController.popoutToWindow).toHaveBeenCalledTimes(1);

      triggerClick(minBtn);
      expect(globalThis.minimizeFloatingChat).toHaveBeenCalledTimes(1);

      triggerClick(toggleBtn);
      expect(globalThis.toggleFloatingChat).toHaveBeenCalledTimes(1);
    });

    it('handles omnibar AI button trigger', () => {
      const omnibarAiBtn = document.getElementById('omnibar-ai-btn');
      globalThis.openFloatingChatFromOmnibar = vi.fn();

      triggerClick(omnibarAiBtn);
      expect(globalThis.openFloatingChatFromOmnibar).toHaveBeenCalledTimes(1);
    });
  });
});
