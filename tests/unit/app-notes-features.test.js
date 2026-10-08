import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ═══════════════════════════════════════════════════
// Sourced from: app-note-file-export.test.js
// ═══════════════════════════════════════════════════
describe('NoteFileExportEngine (Standalone Markdown & PDF Export)', () => {
  beforeAll(() => {
    globalThis.window = globalThis.window || {};
    globalThis.t = (key) => key;
    globalThis.escH = (s) => String(s || '');

    loadScriptsIntoGlobal([
      'js/app-utils.js',
      'js/app-notes.js'
    ]);
  });

  it('generates sanitized markdown filename from note title', () => {
    expect(NoteFileExportEngine.getSanitizedFilename('Weekly Sync: Q3 & OKRs'))
      .toBe('weekly_sync_q3_okrs.md');

    expect(NoteFileExportEngine.getSanitizedFilename('Project Launch 2026!'))
      .toBe('project_launch_2026.md');

    expect(NoteFileExportEngine.getSanitizedFilename(''))
      .toBe('note.md');

    expect(NoteFileExportEngine.getSanitizedFilename('   ---Spaced   Title---  '))
      .toBe('spaced_title.md');
  });

  it('formats clean standalone markdown without metadata wrappers', () => {
    const mockNote = {
      title: 'Sprint Planning',
      mainHTML: '<h2>Sprint Goals</h2><p>Deliver <strong>MVP</strong> on <em>Friday</em>.</p><ul><li>Task A</li><li>Task B</li></ul>'
    };

    const md = NoteFileExportEngine.generateMarkdownContent(mockNote);
    expect(md).toContain('# Sprint Planning');
    expect(md).toContain('## Sprint Goals');
    expect(md).toContain('Deliver **MVP** on *Friday*.');
    expect(md).toContain('- Task A');
    expect(md).toContain('- Task B');
    expect(md).not.toContain('<meta');
    expect(md).not.toContain('<h2>');
  });

  it('handles null or empty note gracefully without error', () => {
    expect(NoteFileExportEngine.generateMarkdownContent(null)).toBe('');
    expect(NoteFileExportEngine.generateMarkdownContent({ title: '', mainHTML: '' })).toBe('# Note\n\n');
  });
});

// ═══════════════════════════════════════════════════
// Sourced from: app-note-history.test.js
// ═══════════════════════════════════════════════════
describe('Note Version History & Snapshots (.history/) (app-storage.js)', () => {
  let mockFiles = new Map();

  beforeAll(() => {
    globalThis.window = globalThis.window || {};
    globalThis.t = (key) => key;
    globalThis.escH = (s) => String(s || '');

    globalThis.AppBridge = {
      isElectron: true,
      fs: {
        hasNativeFS: () => true,
        async fileExists(path) {
          return mockFiles.has(path);
        },
        async readFile(path) {
          if (mockFiles.has(path)) return mockFiles.get(path);
          const err = new Error(`File not found: ${path}`);
          err.name = 'NotFoundError';
          throw err;
        },
        async writeFile(path, content) {
          mockFiles.set(path, content);
          return true;
        },
        async deleteFile(path) {
          mockFiles.delete(path);
          return true;
        }
      }
    };

    loadScriptsIntoGlobal([
      'js/app-utils.js',
      'js/app-fs.js',
      'js/app-storage.js'
    ]);
  });

  beforeEach(() => {
    mockFiles.clear();
  });

  it('saves a snapshot and creates revision manifest', async () => {
    const notePath = 'notes/2026-09-03-weekly-sync.html';
    const noteContent = '<html><body><h1>Initial Content</h1></body></html>';

    mockFiles.set(notePath, noteContent);

    const snapshot = await StorageAPI.saveSnapshot(notePath, noteContent, 'manual');
    expect(snapshot).toBeDefined();
    expect(snapshot.id).toBeDefined();
    expect(snapshot.reason).toBe('manual');

    const snapshots = await StorageAPI.listSnapshots(notePath);
    expect(snapshots.length).toBe(1);
    expect(snapshots[0].id).toBe(snapshot.id);
    expect(snapshots[0].reason).toBe('manual');
  });

  it('restores a snapshot and backs up the existing version before restoring', async () => {
    const notePath = 'notes/2026-09-03-weekly-sync.html';
    const v1Content = '<html><body><h1>Version 1 Content</h1></body></html>';
    const v2Content = '<html><body><h1>Version 2 Mangled by User</h1></body></html>';

    mockFiles.set(notePath, v1Content);
    const snap1 = await StorageAPI.saveSnapshot(notePath, v1Content, 'initial');

    mockFiles.set(notePath, v2Content);

    const restored = await StorageAPI.restoreSnapshot(notePath, snap1.id);
    expect(restored).toBe(v1Content);

    expect(mockFiles.get(notePath)).toBe(v1Content);

    const snapshots = await StorageAPI.listSnapshots(notePath);
    expect(snapshots.length).toBe(2);
    expect(snapshots.some(s => s.reason === 'pre-rollback')).toBe(true);
  });

  it('throws an error when attempting to restore a non-existent snapshot', async () => {
    const notePath = 'notes/valid-note.html';
    mockFiles.set(notePath, '<p>Content</p>');

    await expect(StorageAPI.restoreSnapshot(notePath, 'rev-fake-999'))
      .rejects
      .toThrow('Snapshot not found');
  });

  it('culls oldest revisions when exceeding the 20 revisions limit', async () => {
    const notePath = 'notes/prolific-doc.html';
    mockFiles.set(notePath, '<p>Prolific</p>');

    for (let i = 1; i <= 25; i++) {
      await StorageAPI.saveSnapshot(notePath, `<p>Iteration ${i}</p>`, `rev-${i}`);
    }

    const snapshots = await StorageAPI.listSnapshots(notePath);
    expect(snapshots.length).toBe(20);
    // Most recent is iteration 25
    expect(snapshots[0].reason).toBe('rev-25');
  });

  it('safely handles empty or missing note paths without crashing', async () => {
    expect(await StorageAPI.saveSnapshot('', 'some text')).toBeNull();
    expect(await StorageAPI.saveSnapshot(null, 'some text')).toBeNull();
    expect(await StorageAPI.listSnapshots('')).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════
// Sourced from: app-note-templates-and-share.test.js
// ═══════════════════════════════════════════════════
describe('Note Templates & Share/Export Formatter', () => {
  beforeAll(() => {
    globalThis.window = globalThis.window || {};
    globalThis.t = (key) => key;
    globalThis.escH = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    loadScriptsIntoGlobal([
      'js/app-utils.js',
      'js/app-fs.js',
      'js/app-storage.js',
      'js/app-notes.js'
    ]);
  });

  describe('NoteTemplateManager', () => {
    it('provides standard built-in templates', () => {
      expect(typeof NoteTemplateManager).toBe('object');
      const templates = NoteTemplateManager.getTemplates();
      expect(Array.isArray(templates)).toBe(true);
      expect(templates.length).toBeGreaterThanOrEqual(5);

      const ids = templates.map(t => t.id);
      expect(ids).toContain('meeting_1on1');
      expect(ids).toContain('project_kickoff');
      expect(ids).toContain('decision_rfc');
      expect(ids).toContain('postmortem');
      expect(ids).toContain('daily_standup');
    });

    it('resolves localized names and descriptions without returning raw keys', () => {
      const mockDict = {
        'templates.standardName': 'Standard Meeting',
        'templates.standardDesc': 'Goal, Notes, Decisions, and Action Items',
        'templates.meeting1on1Name': '1-on-1 Meeting',
        'templates.meeting1on1Desc': 'Check-in, Priorities, Feedback & Growth, Action Items'
      };
      const origT = globalThis.t;
      globalThis.t = (k) => mockDict[k] || k;

      const templates = NoteTemplateManager.getTemplates();
      const standard = templates.find(t => t.id === 'standard');
      const meeting1on1 = templates.find(t => t.id === 'meeting_1on1');

      expect(standard.name).toBe('Standard Meeting');
      expect(standard.description).toBe('Goal, Notes, Decisions, and Action Items');
      expect(meeting1on1.name).toBe('1-on-1 Meeting');

      globalThis.t = origT;
    });

    it('generates rich HTML for 1-on-1 meeting template', () => {
      const html = NoteTemplateManager.getTemplateHTML('meeting_1on1');
      expect(html).toContain('<h2');
      expect(html.toLowerCase()).toMatch(/1-on-1|agenda|action/);
    });

    it('generates rich HTML for project kickoff template', () => {
      const html = NoteTemplateManager.getTemplateHTML('project_kickoff');
      expect(html).toContain('<h2');
      expect(html.toLowerCase()).toMatch(/objective|scope|milestone/);
    });
  });

  describe('NoteShareFormatter', () => {
    const sampleHTML = `
      <h2>Executive Summary</h2>
      <p>Project roadmap finalized with the steering committee.</p>
      <h2>Decisions</h2>
      <p>!decision:active "Launch date set to October 15"</p>
      <h2>Action Items</h2>
      <ul>
        <li>Prepare cloud infrastructure by next Friday</li>
        <li>Review documentation with @Sarah</li>
      </ul>
    `;

    it('formats note content for Slack and Microsoft Teams', () => {
      expect(typeof NoteShareFormatter).toBe('object');
      const slackText = NoteShareFormatter.formatForSlack('Roadmap Review', sampleHTML);
      expect(slackText).toContain('Roadmap Review');
      expect(slackText).toContain('Executive Summary');
      expect(slackText).toContain('Launch date set to October 15');
      expect(slackText).toContain('Prepare cloud infrastructure');
      expect(slackText).toContain('@Sarah');
    });

    it('formats note content for clean HTML email', () => {
      const emailHTML = NoteShareFormatter.formatForEmail('Roadmap Review', sampleHTML);
      expect(emailHTML).toContain('Roadmap Review');
      expect(emailHTML).toContain('font-family');
      expect(emailHTML).toContain('Executive Summary');
    });

    it('formats note content as clean Markdown', () => {
      const md = NoteShareFormatter.formatForMarkdown('Roadmap Review', sampleHTML);
      expect(md).toContain('# Roadmap Review');
      expect(md).toContain('Executive Summary');
    });
  });
});

// ═══════════════════════════════════════════════════
// Sourced from: app-notes-enhancements.test.js
// ═══════════════════════════════════════════════════
describe('Notes Tab Enhancements (Infinite Scroll, Today Button, OOO Exclusion, Daily Summary & Workstreams)', () => {
  beforeAll(() => {
      loadScriptsIntoGlobal([
        'js/translations.js',
        'js/app-i18n.js',
        'js/app-icons.js',
        'js/app-utils.js',
        'js/app-state.js',
        'js/app-notes.js',
        'js/app-board.js',
        'js/app-init.js'
      ]);
  });

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="app-main" style="height:500px;overflow-y:auto">
        <div id="swimlane-board"></div>
      </div>
      <div id="notes-view-switcher">
        <button id="btn-notes-view-map"></button>
        <button id="btn-notes-view-reader"></button>
      </div>
      <button id="btn-notes-today"></button>
      <div id="notes-workstream-bar">
        <div id="notes-workstream-bar-inner"></div>
      </div>
      <div id="filter-bar">
        <div id="filter-bar-chips"></div>
      </div>
      <div id="active-filter-chip-container"></div>
      <div id="notes-breadcrumb-bar"></div>
    `;

    globalThis.boardMode = 'notes';
    globalThis.activeTab = 'notes';
    globalThis.activeFilter = null;
    globalThis.activeGroup = 'All';
    globalThis.manifest = [];
    globalThis.plannerEvents = [];
    globalThis.notesViewMode = 'map';
    globalThis.mapZoomLevel = 'weeks';
  });

  describe('1. OOO Block Exclusion', () => {
    it('does not create planned notes from OOO or custom blocks', () => {
      globalThis.plannerEvents = [
        { id: 'ev-1', type: 'meeting', date: '2026-09-05', title: 'Sprint Planning' },
        { id: 'ev-2', type: 'ooo', date: '2026-09-06', title: 'Vacation Out of Office' },
        { id: 'ev-3', type: 'custom', date: '2026-09-07', title: 'Custom Bloc' }
      ];

      const planned = getPlannedNotesFromBlocs([], []);
      expect(planned.length).toBe(1);
      expect(planned[0].title).toBe('Sprint Planning');
      expect(planned.some(p => p.title.includes('Vacation'))).toBe(false);
      expect(planned.some(p => p.title.includes('Custom'))).toBe(false);
    });
  });

  describe('2. Daily Review Summary Detection & Day Indicator Rendering', () => {
    it('accurately identifies daily review and summary notes', () => {
      expect(isDailySummaryNote({ major_topic_tags: ['Daily Summary'] })).toBe(true);
      expect(isDailySummaryNote({ group_tags: ['Summary'], major_topic_tags: ['Daily Notes'] })).toBe(true);
      expect(isDailySummaryNote({ path: 'vault/daily-summary-2026-09-01.html' })).toBe(true);
      expect(isDailySummaryNote({ path: 'vault/daily-review-2026-09-01.html' })).toBe(true);
      expect(isDailySummaryNote({ id: 'daily-summary-2026-09-01' })).toBe(true);
      expect(isDailySummaryNote({ title: 'Daily Summary - 01/09/2026' })).toBe(true);
      expect(isDailySummaryNote({ title: 'Résumé quotidien - 01/09/2026' })).toBe(true);
      expect(isDailySummaryNote({ title: 'Tagesrückblick - 01/09/2026' })).toBe(true);
      expect(isDailySummaryNote({ title: 'Regular Engineering Meeting' })).toBe(false);
    });

    it('formats map day label as "Day - Mon Num" (e.g. Tue - Sep 1)', () => {
      const label = formatMapDayLabel('2026-09-01');
      expect(label).toBe('Tue - Sep 1');
    });

    it('renders daily summary badge right in the day indicator and excludes it from the card grid below', () => {
      const notes = [
        { path: 'note1.html', title: 'Team Catchup', date: '2026-09-01' },
        { path: 'note2.html', title: 'Daily Summary - Sep 1', date: '2026-09-01', major_topic_tags: ['Daily Summary'] }
      ];

      const html = renderMapMilestoneHTML('2026-W36', 'September 2026', notes);
      
      // Header must contain the daily summary badge
      expect(html).toContain('map-day-daily-summary-badge');
      expect(html).toContain('note2.html');
      expect(html).toContain('Tue - Sep 1');
      expect(html).toContain('(2)'); // Total count includes both

      // Card grid must ONLY contain note1
      expect(html).toContain('Team Catchup');
      expect(html).not.toContain('sl-card" data-path="note2.html"');
    });
  });

  describe('3. Permanent Workstream Bar with Vector SVG', () => {
    it('renders all workstreams with clean vector SVG icons and no emoticons', () => {
      globalThis.manifest = [
        { path: 'n1.html', workstream: 'Infra', other_tags: ['#workstream/Infra'] },
        { path: 'n2.html', workstream: 'Frontend', other_tags: ['#workstream/Frontend'] }
      ];

      renderNotesWorkstreamBar();
      const inner = document.getElementById('notes-workstream-bar-inner');
      expect(inner.innerHTML).toContain('notes-ws-chip');
      expect(inner.innerHTML).toContain('<svg');
      expect(inner.innerHTML).not.toContain('⚡');
      expect(inner.innerHTML).not.toContain('🧠');
      expect(inner.innerHTML).toContain('Infra');
      expect(inner.innerHTML).toContain('Frontend');
    });
  });

  describe('4. Infinite Scrolling Batch Loading & Today Button', () => {
    it('limits initial milestone render batch and provides sentinel loader', async () => {
      const board = document.getElementById('swimlane-board');
      // Create notes spanning 15 distinct months/milestones
      const items = Array.from({ length: 15 }, (_, i) => ({
        path: `note-${i}.html`,
        title: `Note ${i}`,
        date: `2024-${String((i % 12) + 1).padStart(2, '0')}-15`
      }));

      await renderChronologicalMapView(board, items);
      
      const sentinel = document.getElementById('map-scroll-sentinel');
      expect(sentinel).not.toBeNull();
      expect(sentinel.className).toContain('map-scroll-sentinel');
    });

    it('scrolls to today smoothly using scrollToTodayNotes', () => {
      const appMain = document.getElementById('app-main');
      appMain.scrollTo = vi.fn();
      scrollToTodayNotes();
      expect(appMain.scrollTo).toHaveBeenCalled();
    });
  });

  describe('5. Notes Filter Isolation across Tabs & Group Filter Inclusion', () => {
    it('hides notes filter-bar and workstream-bar when switching to other tabs', () => {
      const filterBar = document.getElementById('filter-bar');
      const wsBar = document.getElementById('notes-workstream-bar');
      
      // Simulate notes tab open filter
      globalThis.activeTab = 'notes';
      globalThis.boardMode = 'notes';
      filterBar.style.display = 'block';
      wsBar.style.display = 'flex';

      // Switch to planner
      globalThis.activeTab = 'planner';
      updateSubRowVisibility();
      expect(filterBar.style.display).toBe('none');
      expect(wsBar.style.display).toBe('none');

      // Switch to todos
      globalThis.activeTab = 'todos';
      globalThis.boardMode = 'todos';
      filterBar.style.display = 'block';
      updateSubRowVisibility();
      expect(filterBar.style.display).toBe('none');
      expect(wsBar.style.display).toBe('none');
    });

    it('includes group tags in renderFilterBarChips alongside workstream, major, and topic', () => {
      globalThis.manifest = [
        {
          path: 'n1.html',
          group_tags: ['Core Team', 'Engineering'],
          major_topic_tags: ['Infra'],
          topic_tags: ['Deploy'],
          workstream: 'Backend'
        }
      ];
      globalThis.activeTab = 'notes';
      globalThis.boardMode = 'notes';

      renderFilterBarChips();
      const chipsEl = document.getElementById('filter-bar-chips');
      expect(chipsEl.innerHTML).toContain('fb-group');
      expect(chipsEl.innerHTML).toContain('Core Team');
      expect(chipsEl.innerHTML).toContain('Engineering');
      expect(chipsEl.innerHTML).toContain('Infra');
      expect(chipsEl.innerHTML).toContain('Deploy');
    });

    it('toggles group filter correctly and updates activeFilter chip', () => {
      globalThis.activeTab = 'notes';
      globalThis.boardMode = 'notes';
      setFilter('group', 'Core Team');

      expect(globalThis.activeGroup).toBe('Core Team');
      expect(globalThis.activeFilter).toEqual({ type: 'group', value: 'Core Team' });

      const chipCt = document.getElementById('active-filter-chip-container');
      expect(chipCt.innerHTML).toContain('Core Team');

      // Clicking same group toggles back to All
      setFilter('group', 'Core Team');
      expect(globalThis.activeGroup).toBe('All');
      expect(globalThis.activeFilter).toBeNull();
      expect(chipCt.innerHTML).toBe('');
    });
  });
});

// ═══════════════════════════════════════════════════
// Sourced from: app-notes-scroll-indicator.test.js
// ═══════════════════════════════════════════════════
describe('Notes Scrollbar Timeline HUD & Today Indicator', () => {
  beforeAll(() => {
    loadScriptsIntoGlobal([
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-utils.js',
      'js/app-state.js',
      'js/app-notes.js',
      'js/app-board.js'
    ]);
  });

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="app-body">
        <div id="app-main" style="height: 500px; overflow-y: auto;">
          <div id="notes-scroll-hud" class="notes-scroll-hud" style="display:none">
            <span class="notes-scroll-hud-label" id="notes-scroll-hud-label"></span>
            <span class="notes-scroll-hud-today" id="notes-scroll-hud-today" style="display:none">Today</span>
          </div>
          <div id="swimlane-board"></div>
        </div>
      </div>
    `;
    global.activeTab = 'notes';
    global.boardMode = 'notes';
    global.notesViewMode = 'map';
    global.mapZoomLevel = 'weeks';
  });

  describe('getNotesScrollTimelineInfo', () => {
    it('returns "This Week" when the visible milestone corresponds to the current week in weeks mode', () => {
      const todayStr = formatLocalDateValue(new Date());
      const currentWeekKey = getNoteWeekKey(todayStr).key;

      const board = document.getElementById('swimlane-board');
      board.innerHTML = `
        <div class="map-milestone" data-milestone="${currentWeekKey}">
          <div class="map-milestone-header"><span>W36 – Sep 2026</span></div>
          <div class="map-day-section" data-date="${todayStr}" data-is-today="true"></div>
        </div>
      `;

      const appMain = document.getElementById('app-main');
      // Mock bounding rects
      appMain.getBoundingClientRect = () => ({ top: 0, bottom: 500, height: 500 });
      const milestone = board.querySelector('.map-milestone');
      milestone.getBoundingClientRect = () => ({ top: 50, bottom: 300, height: 250 });
      const daySection = board.querySelector('.map-day-section');
      daySection.getBoundingClientRect = () => ({ top: 60, bottom: 150, height: 90 });

      const info = getNotesScrollTimelineInfo();
      expect(info.label).toBe(t('notes.thisWeek'));
      expect(info.isToday).toBe(true);
      expect(info.isCurrentPeriod).toBe(true);
    });

    it('returns formatted week label when viewing a past or future week in weeks mode', () => {
      const pastWeekKey = '2024-W10';

      const board = document.getElementById('swimlane-board');
      board.innerHTML = `
        <div class="map-milestone" data-milestone="${pastWeekKey}">
          <div class="map-milestone-header"><span>W10 – Mar 2024</span></div>
          <div class="map-day-section" data-date="2024-03-05"></div>
        </div>
      `;

      const appMain = document.getElementById('app-main');
      appMain.getBoundingClientRect = () => ({ top: 0, bottom: 500, height: 500 });
      const milestone = board.querySelector('.map-milestone');
      milestone.getBoundingClientRect = () => ({ top: 50, bottom: 300, height: 250 });
      const daySection = board.querySelector('.map-day-section');
      daySection.getBoundingClientRect = () => ({ top: 60, bottom: 150, height: 90 });

      const info = getNotesScrollTimelineInfo();
      expect(info.label).toBe('W10 – Mar 2024');
      expect(info.isToday).toBe(false);
      expect(info.isCurrentPeriod).toBe(false);
    });

    it('returns "This Month" when in months zoom level and milestone is current month', () => {
      global.mapZoomLevel = 'months';
      const todayStr = formatLocalDateValue(new Date());
      const currentMonthKey = todayStr.slice(0, 7);

      const board = document.getElementById('swimlane-board');
      board.innerHTML = `
        <div class="map-milestone" data-milestone="${currentMonthKey}">
          <div class="map-milestone-header"><span>Sep 2026</span></div>
          <div class="map-day-section" data-date="${todayStr}" data-is-today="true"></div>
        </div>
      `;

      const appMain = document.getElementById('app-main');
      appMain.getBoundingClientRect = () => ({ top: 0, bottom: 500, height: 500 });
      const milestone = board.querySelector('.map-milestone');
      milestone.getBoundingClientRect = () => ({ top: 50, bottom: 300, height: 250 });
      const daySection = board.querySelector('.map-day-section');
      daySection.getBoundingClientRect = () => ({ top: 60, bottom: 150, height: 90 });

      const info = getNotesScrollTimelineInfo();
      expect(info.label).toBe(t('notes.thisMonth'));
      expect(info.isToday).toBe(true);
      expect(info.isCurrentPeriod).toBe(true);
    });

    it('returns "This Year" when in years zoom level and milestone is current year', () => {
      global.mapZoomLevel = 'years';
      const todayStr = formatLocalDateValue(new Date());
      const currentYearKey = todayStr.slice(0, 4);

      const board = document.getElementById('swimlane-board');
      board.innerHTML = `
        <div class="map-milestone" data-milestone="${currentYearKey}">
          <div class="map-milestone-header"><span>2026</span></div>
          <div class="map-day-section" data-date="${todayStr}" data-is-today="true"></div>
        </div>
      `;

      const appMain = document.getElementById('app-main');
      appMain.getBoundingClientRect = () => ({ top: 0, bottom: 500, height: 500 });
      const milestone = board.querySelector('.map-milestone');
      milestone.getBoundingClientRect = () => ({ top: 50, bottom: 300, height: 250 });
      const daySection = board.querySelector('.map-day-section');
      daySection.getBoundingClientRect = () => ({ top: 60, bottom: 150, height: 90 });

      const info = getNotesScrollTimelineInfo();
      expect(info.label).toBe(t('notes.thisYear'));
      expect(info.isToday).toBe(true);
      expect(info.isCurrentPeriod).toBe(true);
    });

    it('returns "Older Notes" when milestone is __older__', () => {
      const board = document.getElementById('swimlane-board');
      board.innerHTML = `
        <div class="map-milestone" data-milestone="__older__">
          <div class="map-milestone-header"><span>Older Notes</span></div>
          <div class="map-day-section" data-date="no-date"></div>
        </div>
      `;

      const appMain = document.getElementById('app-main');
      appMain.getBoundingClientRect = () => ({ top: 0, bottom: 500, height: 500 });
      const milestone = board.querySelector('.map-milestone');
      milestone.getBoundingClientRect = () => ({ top: 50, bottom: 300, height: 250 });

      const info = getNotesScrollTimelineInfo();
      expect(info.label).toBe(t('board.olderNotesLane'));
      expect(info.isToday).toBe(false);
    });
  });

  describe('updateNotesScrollIndicator and scrollToTodayNotes', () => {
    it('updates HUD label, today tag, and visible state', () => {
      const todayStr = formatLocalDateValue(new Date());
      const currentWeekKey = getNoteWeekKey(todayStr).key;

      const board = document.getElementById('swimlane-board');
      board.innerHTML = `
        <div class="map-milestone" data-milestone="${currentWeekKey}">
          <div class="map-milestone-header"><span>W36 – Sep 2026</span></div>
          <div class="map-day-section" data-date="${todayStr}" data-is-today="true"></div>
        </div>
      `;

      const appMain = document.getElementById('app-main');
      appMain.scrollTop = 100;
      Object.defineProperty(appMain, 'scrollHeight', { value: 1000, configurable: true });
      Object.defineProperty(appMain, 'clientHeight', { value: 500, configurable: true });
      appMain.getBoundingClientRect = () => ({ top: 0, bottom: 500, height: 500 });

      const milestone = board.querySelector('.map-milestone');
      milestone.getBoundingClientRect = () => ({ top: 50, bottom: 300, height: 250 });
      const daySection = board.querySelector('.map-day-section');
      daySection.getBoundingClientRect = () => ({ top: 60, bottom: 150, height: 90 });

      updateNotesScrollIndicator();

      const hud = document.getElementById('notes-scroll-hud');
      const label = document.getElementById('notes-scroll-hud-label');
      const today = document.getElementById('notes-scroll-hud-today');

      expect(hud.classList.contains('visible')).toBe(true);
      expect(label.textContent).toBe(t('notes.thisWeek'));
      expect(today.style.display).toBe('inline-flex');
    });

    it('scrolls to today element smoothly when scrollToTodayNotes is triggered', () => {
      const todayStr = formatLocalDateValue(new Date());
      const board = document.getElementById('swimlane-board');
      board.innerHTML = `
        <div class="map-milestone" data-milestone="2026-W36">
          <div class="map-day-section" data-date="${todayStr}" data-is-today="true"></div>
        </div>
      `;

      const appMain = document.getElementById('app-main');
      appMain.scrollTop = 0;
      appMain.getBoundingClientRect = () => ({ top: 0, bottom: 500, height: 500 });
      let scrollToCalled = false;
      let scrollToArgs = null;
      appMain.scrollTo = (args) => {
        scrollToCalled = true;
        scrollToArgs = args;
      };

      const daySection = board.querySelector('.map-day-section');
      daySection.getBoundingClientRect = () => ({ top: 250, bottom: 350, height: 100 });

      scrollToTodayNotes();

      expect(scrollToCalled).toBe(true);
      expect(scrollToArgs.behavior).toBe('smooth');
      expect(scrollToArgs.top).toBe(210); // 250 - 40
    });
  });
});

// ═══════════════════════════════════════════════════
// Sourced from: app-notes-search-timeline.test.js
// ═══════════════════════════════════════════════════
describe('Notes Search, Timeline Shrinking & Agent Notes Search Pagination', () => {
  beforeAll(() => {
    if (!globalThis.document) {
      globalThis.document = {
        createElement: () => ({ classList: { add() {}, remove() {}, toggle() {} }, style: {}, setAttribute() {} }),
        getElementById: () => null,
        querySelectorAll: () => []
      };
    }
    if (!globalThis.localStorage) {
      globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    }

    loadScriptsIntoGlobal([
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-utils.js',
      'js/app-state.js',
      'js/app-notes.js',
      'js/app-board.js',
      'js/app-chat.js'
    ]);
  });

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="app-body">
        <div id="app-main" style="height: 500px; overflow-y: auto;">
          <div id="notes-scroll-hud" class="notes-scroll-hud" style="display:none">
            <span class="notes-scroll-hud-label" id="notes-scroll-hud-label"></span>
            <span class="notes-scroll-hud-today" id="notes-scroll-hud-today" style="display:none">Today</span>
          </div>
          <div id="notes-breadcrumb-bar" style="display:none"></div>
          <div id="swimlane-board"></div>
        </div>
      </div>
    `;
    global.activeTab = 'notes';
    global.boardMode = 'notes';
    global.notesViewMode = 'map';
    global.mapZoomLevel = 'weeks';
    global.searchQuery = '';
    global.searchCaseSensitive = false;
    global.searchRegex = false;
    global.activeGroup = 'All';
    global.activeFilter = null;
  });

  describe('getPlannedNotesFromBlocs search & filter integration', () => {
    it('does NOT create phantom planned notes for planner events whose note exists in the vault but was filtered out by search', () => {
      // Vault has note-1 (about Alpha) and note-2 (about Beta)
      const allVaultNotes = [
        { id: 'note-1', title: 'Alpha Launch Plan', path: 'notes/alpha.html', date: '2026-08-10' },
        { id: 'note-2', title: 'Beta Testing', path: 'notes/beta.html', date: '2026-08-12' }
      ];
      global.manifest = allVaultNotes;

      // Planner has event linked to note-1
      global.plannerEvents = [
        { id: 'evt-1', title: 'Alpha Meeting', date: '2026-08-10', noteId: 'note-1' }
      ];

      // User searches for "Beta": only note-2 matches
      global.searchQuery = 'Beta';
      const filteredItems = [allVaultNotes[1]];

      const planned = getPlannedNotesFromBlocs(filteredItems, allVaultNotes);
      // evt-1 already has note-1 in vault (even though note-1 was filtered out), so no phantom planned note should be created
      expect(planned.some(p => p.id === 'planned-evt-1')).toBe(false);
    });

    it('filters genuine planned notes (events without notes) by searchQuery', () => {
      global.manifest = [];
      global.plannerEvents = [
        { id: 'evt-marketing', title: 'Q3 Marketing Strategy', date: '2026-09-15' },
        { id: 'evt-finance', title: 'Budget Allocation', date: '2026-09-20' }
      ];

      global.searchQuery = 'Marketing';
      const planned = getPlannedNotesFromBlocs([], []);
      expect(planned.map(p => p.id)).toEqual(['planned-evt-marketing']);
      expect(planned.some(p => p.id === 'planned-evt-finance')).toBe(false);
    });
  });

  describe('renderChronologicalMapView search & timeline shrinking', () => {
    it('shrinks timeline to only matching milestones and hides non-matching milestones', async () => {
      const board = document.getElementById('swimlane-board');
      global.manifest = [
        { id: 'n1', title: 'Roadmap Kickoff', date: '2026-08-05', path: 'notes/n1.html' },
        { id: 'n2', title: 'Vacation Plan', date: '2026-09-10', path: 'notes/n2.html' }
      ];
      global.plannerEvents = [];

      // Search matches only n1 (August 2026)
      global.searchQuery = 'Roadmap';
      const matchingNotes = [global.manifest[0]];

      await renderChronologicalMapView(board, matchingNotes);

      // Verify the map milestone for August 2026 is rendered
      const milestoneAugust = board.querySelector('[data-milestone*="2026-W32"]') || board.querySelector('.map-milestone');
      expect(milestoneAugust).not.toBeNull();

      // Verify September milestone is NOT rendered
      const milestoneSeptember = board.querySelector('[data-milestone*="2026-W37"]');
      expect(milestoneSeptember).toBeNull();
      expect(board.textContent).toContain('Roadmap Kickoff');
      expect(board.textContent).not.toContain('Vacation Plan');
    });

    it('renders empty filter state when no notes or planned notes match search', async () => {
      const board = document.getElementById('swimlane-board');
      global.manifest = [
        { id: 'n1', title: 'Roadmap Kickoff', date: '2026-08-05', path: 'notes/n1.html' }
      ];
      global.plannerEvents = [
        { id: 'evt-1', title: 'Lunch', date: '2026-08-06' }
      ];
      global.searchQuery = 'NonExistentXYZ';

      await renderChronologicalMapView(board, []);

      expect(board.innerHTML).toContain(t('board.noNotesMatchFilter'));
    });
  });

  describe('AIChatController search_notes tool pagination & iteration', () => {
    let controller;

    beforeEach(() => {
      controller = AIChatController;
      global.manifest = [
        { id: 'n1', title: 'Project A - Kickoff', path: 'notes/a1.html', date: '2026-08-01', modified: '2026-08-01T10:00:00Z', group_tags: ['Project A'] },
        { id: 'n2', title: 'Project A - Architecture', path: 'notes/a2.html', date: '2026-08-02', modified: '2026-08-02T10:00:00Z', group_tags: ['Project A'] },
        { id: 'n3', title: 'Project A - Implementation', path: 'notes/a3.html', date: '2026-08-03', modified: '2026-08-03T10:00:00Z', group_tags: ['Project A'] },
        { id: 'n4', title: 'Project A - QA & Testing', path: 'notes/a4.html', date: '2026-08-04', modified: '2026-08-04T10:00:00Z', group_tags: ['Project A'] },
        { id: 'n5', title: 'Project B - Overview', path: 'notes/b1.html', date: '2026-08-05', modified: '2026-08-05T10:00:00Z', group_tags: ['Project B'] }
      ];
    });

    it('paginates results with offset and limit and provides next-page instructions', async () => {
      const toolProps = {
        query: 'Project A',
        offset: 0,
        limit: 2
      };

      const resultText = await controller.executeSearchNotesTool(toolProps);

      // Should indicate notes 1 to 2 of 4 total
      expect(resultText).toMatch(/1.*2.*4/);
      // Should mention next page offset 2
      expect(resultText).toContain('"offset": 2');
      expect(resultText).toContain('"limit": 2');
    });

    it('retrieves the next slice (n+1 to n+x) when offset is incremented', async () => {
      const toolReqPage2 = {
        query: 'Project A',
        offset: 2,
        limit: 2
      };

      const resultText = await controller.executeSearchNotesTool(toolReqPage2);
      expect(resultText).toMatch(/3.*4.*4/);
      // Should not offer next page when all 4 are exhausted
      expect(resultText).not.toContain('"offset": 4');
    });

    it('supports page parameter as alternative to offset', async () => {
      const toolReqPage2 = {
        query: 'Project A',
        page: 2,
        limit: 2
      };

      const resultText = await controller.executeSearchNotesTool(toolReqPage2);
      expect(resultText).toMatch(/3.*4.*4/);
    });

    it('supports filtering by group or tag in search_notes', async () => {
      const toolReqGroup = {
        group: 'Project B'
      };

      const resultText = await controller.executeSearchNotesTool(toolReqGroup);
      expect(resultText).toContain('Project B - Overview');
      expect(resultText).not.toContain('Project A');
    });
  });
});

// ═══════════════════════════════════════════════════
// Sourced from: app-notes-views.test.js
// ═══════════════════════════════════════════════════
describe('Notes Tab View Modes & Timeline Zoom Engine', () => {
  beforeAll(() => {
    loadScriptsIntoGlobal([
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-utils.js',
      'js/app-state.js',
      'js/app-notes.js',
      'js/app-board.js'
    ]);
  });

  describe('getMapMilestoneInfo (Map Timeline Zoom)', () => {
    it('returns older notes key when date is missing or invalid', () => {
      expect(getMapMilestoneInfo(null, 'weeks').key).toBe('__older__');
      expect(getMapMilestoneInfo('invalid-date', 'months').key).toBe('__older__');
    });

    it('groups by ISO week when zoom level is "weeks"', () => {
      const res = getMapMilestoneInfo('2026-08-20', 'weeks');
      expect(res.key).toMatch(/^\d{4}-W\d{2}$/);
    });

    it('groups by YYYY-MM when zoom level is "months"', () => {
      const res = getMapMilestoneInfo('2026-08-20', 'months');
      expect(res.key).toBe('2026-08');
      expect(res.label).toContain('2026');
    });

    it('groups by YYYY when zoom level is "years"', () => {
      const res = getMapMilestoneInfo('2026-08-20', 'years');
      expect(res.key).toBe('2026');
      expect(res.label).toBe('2026');
    });

    it('extracts item time string correctly via getItemTimeInfo', () => {
      expect(getItemTimeInfo({ event: { startTime: '13:30' } })).toBe('13:30');
      expect(getItemTimeInfo({ date: '2026-08-21 15:00' })).toBe('15:00');
      expect(getItemTimeInfo({ summary: 'Meeting at 09:00 AM' })).toBe('09:00');
      expect(getItemTimeInfo({ title: 'Untimed Note' })).toBe('');
    });
  });

  describe('State Management for Notes View Modes', () => {
    it('updates notesViewMode correctly and redirects tree to map', () => {
      setNotesViewMode('tree');
      expect(notesViewMode).toBe('map');
      setNotesViewMode('reader');
      expect(notesViewMode).toBe('reader');
      setNotesViewMode('map');
      expect(notesViewMode).toBe('map');
    });

    it('updates mapZoomLevel correctly', () => {
      setMapZoomLevel('months');
      expect(mapZoomLevel).toBe('months');
      setMapZoomLevel('years');
      expect(mapZoomLevel).toBe('years');
      setMapZoomLevel('weeks');
      expect(mapZoomLevel).toBe('weeks');
    });

    it('sets notesReaderTarget when reviewTreeNode is invoked', () => {
      reviewTreeNode('group', 'Marketing');
      expect(notesReaderTarget).toEqual({ type: 'group', value: 'Marketing' });
      expect(notesViewMode).toBe('reader');

      clearNotesReaderTarget();
      expect(notesReaderTarget).toBeNull();
    });

    it('toggles tree node expand/collapse state in notesTreeOpenNodes', () => {
      notesTreeOpenNodes.clear();
      toggleNotesTreeNode('group::Dev');
      expect(notesTreeOpenNodes.has('group::Dev')).toBe(true);

      toggleNotesTreeNode('group::Dev');
      expect(notesTreeOpenNodes.has('group::Dev')).toBe(false);
    });
  });

  describe('scrollToReaderNote TOC Navigation', () => {
    it('scrolls appMain container even when appMain.scrollTop is 0', () => {
      document.body.innerHTML = `
        <div id="app-main">
          <div id="reader-note-0" class="reader-note-card"></div>
          <div id="reader-note-1" class="reader-note-card"></div>
        </div>
      `;
      const appMain = document.getElementById('app-main');
      appMain.scrollTop = 0;
      let scrollToCalled = false;
      let targetScroll = null;
      appMain.scrollTo = (options) => {
        scrollToCalled = true;
        targetScroll = options;
      };

      const el1 = document.getElementById('reader-note-1');
      el1.getBoundingClientRect = () => ({ top: 400, bottom: 600, height: 200 });
      appMain.getBoundingClientRect = () => ({ top: 0, bottom: 800, height: 800 });

      scrollToReaderNote(1);

      expect(scrollToCalled).toBe(true);
      expect(targetScroll.top).toBe(384); // (400 - 0) - 16 offset = 384
    });

    it('sets programmatic scroll flag to prevent intermediate observer interrupts', () => {
      document.body.innerHTML = `
        <div id="app-main">
          <div class="reader-toc-sidebar">
            <button id="reader-toc-item-0" class="reader-toc-item"></button>
            <button id="reader-toc-item-1" class="reader-toc-item"></button>
          </div>
          <div id="reader-note-0" class="reader-note-card"></div>
          <div id="reader-note-1" class="reader-note-card"></div>
        </div>
      `;
      const appMain = document.getElementById('app-main');
      appMain.scrollTo = () => {};
      const el1 = document.getElementById('reader-note-1');
      el1.getBoundingClientRect = () => ({ top: 400, bottom: 600, height: 200 });
      appMain.getBoundingClientRect = () => ({ top: 0, bottom: 800, height: 800 });

      scrollToReaderNote(1);

      const item1 = document.getElementById('reader-toc-item-1');
      expect(item1.classList.contains('active')).toBe(true);
      expect(typeof isReaderProgrammaticScroll !== 'undefined' && isReaderProgrammaticScroll).toBe(true);
    });
  });

  describe('Reader Breadcrumb Dropdown & Filter Actions', () => {
    it('executes selectBreadcrumbOption for group, tag, and target without throwing errors', () => {
      setNotesViewMode('reader');

      // Test selecting a group
      expect(() => selectBreadcrumbOption('group', 'Work')).not.toThrow();
      expect(activeGroup).toBe('Work');
      expect(notesReaderTarget).toEqual({ type: 'group', value: 'Work' });

      // Test resetting group to All
      expect(() => selectBreadcrumbOption('group', 'All')).not.toThrow();
      expect(activeGroup).toBe('All');
      expect(notesReaderTarget).toBeNull();

      // Test selecting a month target
      expect(() => selectBreadcrumbOption('target', '2026-08')).not.toThrow();
      expect(notesReaderTarget).toEqual({ type: 'month', value: '2026-08' });

      // Test selecting a year target
      expect(() => selectBreadcrumbOption('target', '2026')).not.toThrow();
      expect(notesReaderTarget).toEqual({ type: 'year', value: '2026' });

      // Test selecting a tag
      expect(() => selectBreadcrumbOption('tag', 'Roadmap')).not.toThrow();
      expect(notesReaderTarget).toEqual({ type: 'topic', value: 'Roadmap' });
    });

    it('provides setGroupFilter, setTagFilter, and setNotesReaderTarget functions', () => {
      expect(typeof setGroupFilter).toBe('function');
      expect(typeof setTagFilter).toBe('function');
      expect(typeof setNotesReaderTarget).toBe('function');

      setGroupFilter('Engineering');
      expect(activeGroup).toBe('Engineering');

      setNotesReaderTarget('month', '2026-09');
      expect(notesReaderTarget).toEqual({ type: 'month', value: '2026-09' });
    });
  });

  describe('hydrateMetadataFromManifestIncremental', () => {
    it('successfully hydrates note metadata without ReferenceError on parsed variable', async () => {
      globalThis.StorageAPI = globalThis.StorageAPI || {};
      globalThis.StorageAPI.readNotesManifest = vi.fn().mockResolvedValue([
        { path: 'notes/test-note.html', id: 'test-note-1', title: 'Untitled Note', modified: 100 }
      ]);
      globalThis.getNoteHtmlOnDemand = vi.fn().mockResolvedValue('<html><head><title>Actual Title</title></head><body><p>Content</p></body></html>');
      globalThis.saveMetadataBuffer = vi.fn().mockResolvedValue(true);

      await expect(hydrateMetadataFromManifestIncremental({ chunkSize: 10 })).resolves.not.toThrow();
    });
  });
});


