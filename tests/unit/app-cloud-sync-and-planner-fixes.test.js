import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Cloud Sync, Planner Note Resolution, and UI Fixes', () => {
  beforeAll(() => {
    globalThis.window = globalThis.window || {};
    globalThis.t = (key) => key;
    globalThis.escH = (s) => String(s || '');
    globalThis.escA = (s) => String(s || '');
    globalThis.normalizeLanguageCode = (c) => c || 'en';
    globalThis.applyLocalizedUI = () => {};

    loadScriptsIntoGlobal([
      'js/app-utils.js',
      'js/app-notes.js',
      'js/app-planner.js',
      'js/app-init.js'
    ]);
  });

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="screen-connect"></div>
      <div id="screen-main"></div>
      <div id="swimlane-board" style="display:none"></div>
      <div id="prefs-panel" style="display:none"></div>
      <div id="planner-panel" style="display:none"></div>
      <div id="team-panel" style="display:none"></div>
      <div id="retro-panel" style="display:none"></div>
      <div id="group-nav"></div>
      <div id="cloud-sync-icon-wrap"></div>
      <button id="btn-cloud-sync-status"></button>
      <div id="prefs-sync-status-text"></div>
      <div id="prefs-sync-count-text"></div>
      <select id="prefs-storage-engine-select">
        <option value="filesystem">Filesystem</option>
        <option value="firebase">Firebase</option>
      </select>
      <button id="btn-prefs-migrate-firebase"></button>
      <button id="btn-prefs-revert-fs" style="display:none"></button>
      <button id="btn-prefs-rotate-pass" style="display:none"></button>
      <div id="prefs-sync-code-row" style="display:none"></div>
      <input id="prefs-sync-code-input" value="">
    `;

    globalThis.manifest = [
      { id: 'note-101', path: 'notes/note-101.html', title: 'Session Note 101' },
      { id: 'custom-id', path: 'notes/custom-id.html', title: 'Custom Title' }
    ];
    globalThis.metadataById = new Map([
      ['note-101', { id: 'note-101', path: 'notes/note-101.html', title: 'Session Note 101' }]
    ]);
    globalThis.metadataByPath = new Map([
      ['notes/note-101.html', { id: 'note-101', path: 'notes/note-101.html', title: 'Session Note 101' }]
    ]);
    globalThis.todosManifest = [
      { id: 'todo-1', title: 'Task 1', priority: 'High', status: 'Pending', noteId: 'note-101' }
    ];
    globalThis.plannerEvents = [];
    globalThis.activeTab = 'planner';
    globalThis.boardMode = 'notes';
  });

  it('Bug 1: getNoteById correctly resolves notes by clean id, full path, or extension', () => {
    expect(globalThis.getNoteById('note-101')).toBeTruthy();
    expect(globalThis.getNoteById('note-101').title).toBe('Session Note 101');

    // Should resolve when passed full path
    expect(globalThis.getNoteById('notes/note-101.html')).toBeTruthy();
    expect(globalThis.getNoteById('notes/note-101.html').id).toBe('note-101');

    // Should resolve when passed note-101.html
    expect(globalThis.getNoteById('note-101.html')).toBeTruthy();
    expect(globalThis.getNoteById('note-101.html').id).toBe('note-101');

    // Should resolve custom-id from manifest
    expect(globalThis.getNoteById('custom-id')).toBeTruthy();
    expect(globalThis.getNoteById('custom-id').title).toBe('Custom Title');
  });

  it('Bug 1: planner event note label and action recognizes existing notes in direct, linked, and prep events', () => {
    const eventWithNote = { id: 'ev-1', type: 'call', title: 'Call 1', noteId: 'note-101' };
    expect(globalThis.getPlannerEventEffectiveNoteId(eventWithNote)).toBe('note-101');
    expect(globalThis.getPlannerEventNoteActionLabel(eventWithNote)).toBe('planner.openNote');

    const eventWithLinked = { id: 'ev-2', type: 'work', title: 'Deep Work', linkedNoteIds: ['note-101'] };
    expect(globalThis.getPlannerEventEffectiveNoteId(eventWithLinked)).toBe('note-101');
    expect(globalThis.getPlannerEventNoteActionLabel(eventWithLinked)).toBe('planner.openNote');

    const prepEvent = { id: 'ev-prep', type: 'prep', prepForEventId: 'ev-1' };
    globalThis.plannerEvents = [eventWithNote, prepEvent];
    expect(globalThis.getPlannerEventEffectiveNoteId(prepEvent)).toBe('note-101');
    expect(globalThis.getPlannerEventNoteActionLabel(prepEvent)).toBe('planner.openNote');

    const brandNewEvent = { id: 'ev-new', type: 'call', title: 'Brand New Call' };
    expect(globalThis.getPlannerEventEffectiveNoteId(brandNewEvent)).toBeNull();
    expect(globalThis.getPlannerEventNoteActionLabel(brandNewEvent)).toBe('planner.generateNewNote');
  });

  it('Bug 2 & Bug 5: updateCloudSyncUI sets green color for synced status and toggles migration buttons', () => {
    // When in synced Firebase mode:
    globalThis.updateCloudSyncUI({
      status: 'synced',
      engine: 'firebase',
      notesCount: 2
    });

    const statusEl = document.getElementById('prefs-sync-status-text');
    expect(statusEl.innerHTML).toContain('color:var(--color-low, #10b981)');

    const countEl = document.getElementById('prefs-sync-count-text');
    expect(countEl.textContent).toContain('2 sync.notesCached');
    expect(countEl.textContent).toContain('1 sync.todosCached');

    // Migrate button hidden, Revert/Rotate buttons visible
    const btnMigrate = document.getElementById('btn-prefs-migrate-firebase');
    const btnRevert = document.getElementById('btn-prefs-revert-fs');
    const btnRotate = document.getElementById('btn-prefs-rotate-pass');

    expect(btnMigrate.style.display).toBe('none');
    expect(btnRevert.style.display).toBe('');
    expect(btnRotate.style.display).toBe('');

    // When in Filesystem mode:
    globalThis.updateCloudSyncUI({
      status: 'disconnected',
      engine: 'filesystem',
      notesCount: 2
    });

    expect(btnMigrate.style.display).toBe('');
    expect(btnRevert.style.display).toBe('none');
    expect(btnRotate.style.display).toBe('none');
  });

  it('Bug 3: Checkboxes in cloud sync setup modal have proper inline-flex alignment styling', () => {
    const modalsHtml = fs.readFileSync(path.resolve(__dirname, '../../templates/modals.html'), 'utf-8');
    expect(modalsHtml).toContain('id="sync-setup-remember-pass"');
    expect(modalsHtml).toContain('id="sync-setup-dont-show-again"');
    
    const setupSection = modalsHtml.slice(modalsHtml.indexOf('id="modal-cloud-sync-setup"'), modalsHtml.indexOf('id="modal-cloud-sync-unlock"'));
    expect(setupSection).not.toContain('<div class="form-field" style="margin-bottom:8px;">\n        <label style="display:flex;');
    expect(setupSection).toContain('display:inline-flex; align-items:center; gap:8px;');
  });

  it('Bug 6: _readTodosManifestFromDisk does not wipe todos in Firebase mode when doc does not exist', async () => {
    globalThis.StorageAPI = {
      getStorageEngine: () => 'firebase',
      hasTodosManifest: async () => false,
      readTodosManifest: async () => []
    };

    globalThis.todosManifest = [{ id: 'task-keep', title: 'Keep this task', priority: 'High' }];
    globalThis.todosLoadState = 'unloaded';

    await globalThis.ensureTodosManifestFullyLoaded();

    expect(globalThis.todosManifest.length).toBe(1);
    expect(globalThis.todosManifest[0].id).toBe('task-keep');
  });

  it('drawCurrentTimeLine renders time indicator line and time badges on today column and time column', () => {
    const todayStr = globalThis.formatLocalDateValue(new Date());
    document.body.innerHTML += `
      <div id="planner-panel">
        <div id="planner-grid-body">
          <div class="planner-time-col"></div>
          <div class="planner-day-col today" data-date="${todayStr}"></div>
        </div>
      </div>
    `;

    globalThis.drawCurrentTimeLine();

    const indicator = document.querySelector('.planner-current-time-indicator');
    expect(indicator).toBeTruthy();
    expect(indicator.querySelector('.planner-current-time-badge')).toBeTruthy();

    const gutterBadge = document.querySelector('.planner-current-time-gutter-badge');
    expect(gutterBadge).toBeTruthy();
  });

  it('showPlannerNoteGenerationProgress creates spinner modal and supports real-time updateStage and progress bar', () => {
    const closeProgress = globalThis.showPlannerNoteGenerationProgress('Initial message');
    const overlay = document.querySelector('.planner-progress-overlay');
    expect(overlay).toBeTruthy();

    const spinner = overlay.querySelector('.planner-progress-spinner');
    expect(spinner).toBeTruthy();

    const message = overlay.querySelector('.planner-progress-message');
    expect(message.textContent).toBe('Initial message');

    const barContainer = overlay.querySelector('.planner-progress-bar-container');
    expect(barContainer).toBeTruthy();

    const barFill = overlay.querySelector('.planner-progress-bar-fill');
    expect(barFill).toBeTruthy();
    expect(barFill.style.width).toBe('0%');

    const detail = overlay.querySelector('.planner-progress-detail');
    expect(detail).toBeTruthy();

    expect(typeof closeProgress.updateStage).toBe('function');
    closeProgress.updateStage('Step 2: Encrypting and saving note content...', 'Writing data...', 45);

    expect(message.textContent).toBe('Step 2: Encrypting and saving note content...');
    expect(detail.textContent).toBe('Writing data...');
    expect(barFill.style.width).toBe('45%');

    closeProgress.update('Opening note editor...', 95);
    expect(message.textContent).toBe('Opening note editor...');
    expect(barFill.style.width).toBe('95%');

    closeProgress();
    expect(document.querySelector('.planner-progress-overlay')).toBeNull();
  });

  it('Bug 1: checkPlannerRefresh checks updates when rootHandle is null in Firebase mode', async () => {
    let readPlannerCalled = false;
    globalThis.rootHandle = null;
    globalThis.StorageAPI = {
      getStorageEngine: () => 'firebase',
      hasPlanner: async () => true,
      readPlanner: async () => {
        readPlannerCalled = true;
        return { events: [{ id: 'ev-1', title: 'Remote sync event' }] };
      },
      hasPlannerProposals: async () => false,
      readPlannerProposals: async () => null
    };

    globalThis._lastPlannerFileCheckedAt = 0;
    globalThis._isPlannerRefreshing = false;
    globalThis.plannerEvents = [];

    await globalThis.checkPlannerRefresh();

    expect(readPlannerCalled).toBe(true);
  });

  it('Bug 2: CSS does not shift planner cards with translateY on hover and marks background slots as pointer-events: none', () => {
    const plannerCss = fs.readFileSync(path.resolve(__dirname, '../../css/app-planner.css'), 'utf-8');
    
    // Check that event card hover rules use transform: none to avoid infinite hover oscillation loops
    const cardHoverMatches = plannerCss.match(/\.planner-event-card:hover\s*\{[^}]+\}/g);
    expect(cardHoverMatches).toBeTruthy();
    for (const match of cardHoverMatches) {
      expect(match).not.toContain('translateY(-2px)');
      expect(match).toContain('transform: none;');
    }

    // Check pointer-events none on unplanned and off-hours zones
    expect(plannerCss).toContain('.planner-unplanned-slot {\n  position: absolute;\n  left: 0;\n  right: 0;\n  pointer-events: none !important;');
    expect(plannerCss).toContain('.planner-off-hours {\n  position: absolute;\n  left: 0;\n  right: 0;\n  pointer-events: none !important;');
  });
});
