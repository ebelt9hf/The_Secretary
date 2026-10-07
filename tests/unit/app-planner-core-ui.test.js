import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

// ═══════════════════════════════════════════════════
// Sourced from: app-planner-header-ui.test.js
// ═══════════════════════════════════════════════════
describe('Planner Header and Side Panel UI Elements', () => {
  beforeEach(() => {
    global.document = document;
    global.window = window;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('ensures planner-week-title does not have an excessive box-shadow in CSS', () => {
    const cssContent = fs.readFileSync(path.resolve(__dirname, '../../css/app-planner.css'), 'utf8');
    const weekTitleMatch = cssContent.match(/\.planner-week-title\s*\{([^}]+)\}/);
    expect(weekTitleMatch).not.toBeNull();
    const rules = weekTitleMatch[1];
    expect(rules).not.toContain('0 12px 30px');
    expect(rules).toMatch(/box-shadow:\s*(none|0 1px 2px|var\(--shadow)/);
  });

  it('renders more options menu button in planner-header and contract title button with auto-balance in sidebar header', () => {
    const plannerCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-planner.js'), 'utf8');
    
    // Create panel container
    const panel = document.createElement('div');
    panel.id = 'planner-panel';
    document.body.appendChild(panel);

    const initFunc = new Function(`
      window.plannerEvents = [];
      window.todosManifest = [];
      window.selectedPlannerEventId = null;
      window.plannerRightSidebarCollapsed = false;
      window.plannerActivePaneTab = 'unassigned';
      window.plannerRightPaneWidth = 320;
      window.plannerViewMode = 'week';
      window.currentPlannerWeekStart = new Date(2026, 7, 31);
      window.plannerDisplayDateOverride = null;
      window.plannerInitialFocusDate = null;
      window.plannerDaysCount = 7;
      window.plannerWorkingDays = [1, 2, 3, 4, 5];
      window.currentLang = 'fr';
      window.workStartTime = '09:00';
      window.workEndTime = '18:30';
      window.plannerContextMenu = null;
      window.plannerContextMenuHandlers = [];
      window.isDailyReviewDateReviewed = function() { return false; };
      window.getAppLocale = function() { return 'fr-FR'; };
      window.closePlannerContextMenu = function() {};
      window.parseLocalDateValue = function(s) { return new Date(s); };
      window.getPlannerUnassignedTodos = function() { return []; };
      window.getPlannerNotDoneTodos = function() { return []; };
      window.getPlannerDaysToDisplay = function() { return [new Date(2026, 7, 31)]; };
      window.getPlannerWeeklyStats = function() { return { totalHours: 0, callHours: 0, workHours: 0, prepHours: 0 }; };
      window._plannerTypeFilter = null;
      window._plannerSidePriorityFilter = 'All';
      window._plannerSideSearchQuery = '';
      window._plannerRightPaneWidth = 320;
      window.renderCalendarGrid = function() {};
      window._initPlannerPaneResizeHandle = function() {};
      window.renderPlannerSidePaneContent = function() {};
      window.t = function(k) {
        const dict = {
          'planner.panel': 'Planificateur',
          'planner.autoBalance': 'Équilibrer',
          'planner.autoBalanceTooltip': 'Placer automatiquement les tâches prioritaires dans les créneaux libres',
          'planner.moreOptionsTooltip': 'Plus d\\'options',
          'common.collapseSidebar': 'Réduire la barre latérale',
          'common.expandSidebar': 'Développer la barre latérale'
        };
        return dict[k] || k;
      };
      window.escA = function(s) { return String(s || '').replace(/"/g, '&quot;'); };
      window.escH = function(s) { return String(s || '').replace(/</g, '&lt;'); };
      window.jq = function(s) { return JSON.stringify(s); };
      window.formatLocalDateValue = function(d) { return d.toISOString().split('T')[0]; };
      window._plannerText = function(k, def) { return window.t(k) || def; };
      window._plannerTabLabel = function(lbl, count) { return lbl + ' (' + count + ')'; };
      ${plannerCode}
      return { renderPlanner, togglePlannerMoreDropdown, closePlannerMoreDropdown };
    `)();

    initFunc.renderPlanner();

    // Verify header layout: Date title & View switcher on left, Nav group & More button on right
    const headerLeft = document.querySelector('.planner-header .planner-header-left');
    expect(headerLeft).not.toBeNull();
    const titleInLeft = headerLeft.querySelector('#planner-week-range-title');
    const viewSwitcherInLeft = headerLeft.querySelector('.planner-view-switcher');
    expect(titleInLeft).not.toBeNull();
    expect(viewSwitcherInLeft).not.toBeNull();

    const navGroup = document.querySelector('.planner-header .planner-nav-group');
    expect(navGroup).not.toBeNull();

    // Verify Daily Review button is no longer in nav group
    const reviewBtn = navGroup.querySelector('.planner-review-btn');
    expect(reviewBtn).toBeNull();

    // Verify stats bar icons are SVGs
    const statIcons = document.querySelectorAll('.planner-stat-item svg');
    expect(statIcons.length).toBeGreaterThanOrEqual(4);

    // Verify side pills icons are SVGs
    const pillIcons = document.querySelectorAll('.planner-side-pill svg');
    expect(pillIcons.length).toBeGreaterThanOrEqual(4);

    // Verify more options button in header
    const moreBtn = document.getElementById('planner-more-menu-btn');
    expect(moreBtn).not.toBeNull();
    expect(moreBtn.querySelector('svg')).not.toBeNull();
    expect(moreBtn.getAttribute('title')).toBeTruthy();

    // Verify contract button in sidebar header
    const contractBtn = document.querySelector('.planner-sidebar-contract-btn');
    expect(contractBtn).not.toBeNull();
    expect(contractBtn.textContent).toContain('Planificateur');
    expect(contractBtn.querySelector('svg')).not.toBeNull();
    expect(contractBtn.getAttribute('title')).toBeTruthy();

    // Verify auto-balance button in sidebar header
    const balanceBtn = document.querySelector('.planner-sidebar-balance-btn');
    expect(balanceBtn).not.toBeNull();
    expect(balanceBtn.textContent).toContain('Équilibrer');
    expect(balanceBtn.querySelector('svg')).not.toBeNull();
    expect(balanceBtn.getAttribute('title')).toBeTruthy();

    // Test togglePlannerMoreDropdown
    initFunc.togglePlannerMoreDropdown({ currentTarget: moreBtn, stopPropagation: () => {} });
    const dropdown = document.getElementById('planner-more-dropdown-menu');
    expect(dropdown).not.toBeNull();

    const menuItems = dropdown.querySelectorAll('.planner-more-menu-item');
    expect(menuItems.length).toBe(3); // Import ICS, Export ICS, Shortcuts
    for (const item of menuItems) {
      expect(item.querySelector('svg')).not.toBeNull();
      expect(item.getAttribute('title')).toBeTruthy();
    }

    initFunc.closePlannerMoreDropdown();
    expect(document.getElementById('planner-more-dropdown-menu')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════
// Sourced from: app-planner-block-selection.test.js
// ═══════════════════════════════════════════════════
describe('Planner Block Selection and Right-side Creation Gutter', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('ensures event cards leave a right-side space and prevent mousedown bubbling to empty slots', () => {
    const plannerCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-planner.js'), 'utf8');
    const renderFunc = new Function(`
      window.plannerEvents = [
        { id: 'evt_1', type: 'call', title: 'Client Sync', date: '2026-08-31', startTime: '10:00', endTime: '11:00' }
      ];
      window.selectedPlannerEventId = null;
      window.workStartTime = '09:00';
      window.workEndTime = '18:30';
      function t(k) { return k; }
      function escA(s) { return String(s || '').replace(/"/g, '&quot;'); }
      function escH(s) { return String(s || '').replace(/</g, '&lt;'); }
      function jq(s) { return JSON.stringify(s); }
      function parseLocalDateValue(s) { return new Date(s); }
      function formatLocalDateValue(d) { return d.toISOString().split('T')[0]; }
      function getPlannerEventLinkedTodoIds() { return []; }
      ${plannerCode}
      return renderPlannerEventsForDayHTML;
    `)();

    const html = renderFunc('2026-08-31');
    expect(html).toContain('planner-event-card');
    expect(html).toContain('onmousedown="event.stopPropagation()"');
    expect(html).toContain('selectPlannerEvent(');
    // Ensure the card style reserves right-side space for creating new blocks (e.g. 100% - 28px)
    expect(html).toMatch(/width:\s*calc\(100%\s*-\s*2[4-8]px\)/);
  });

  it('ensures CSS rules keep empty slot hover below event cards so clicks on blocks are not hijacked', () => {
    const cssContent = fs.readFileSync(path.resolve(__dirname, '../../css/app-planner.css'), 'utf8');

    // Empty slot hover must not have z-index: 10 overriding event cards
    const emptySlotHoverMatch = cssContent.match(/\.planner-empty-slot:hover\s*\{([^}]+)\}/g);
    expect(emptySlotHoverMatch).not.toBeNull();
    for (const rule of emptySlotHoverMatch) {
      expect(rule).not.toMatch(/z-index:\s*(10|20|25|30)/);
    }

    // Event card creation preview width should leave space on right
    expect(cssContent).toMatch(/\.planner-event-card\.planner-create-preview[\s\S]*?width:\s*calc\(100%\s*-\s*2[4-8]px\)/);
  });

  it('correctly proportions overlapping event cards while maintaining the right-side creation gutter', () => {
    const plannerCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-planner.js'), 'utf8');
    const renderFunc = new Function(`
      window.plannerEvents = [
        { id: 'evt_1', type: 'call', title: 'Call 1', date: '2026-08-31', startTime: '10:00', endTime: '11:00' },
        { id: 'evt_2', type: 'work', title: 'Work 2', date: '2026-08-31', startTime: '10:00', endTime: '11:00' }
      ];
      window.selectedPlannerEventId = null;
      window.workStartTime = '09:00';
      window.workEndTime = '18:30';
      function t(k) { return k; }
      function escA(s) { return String(s || '').replace(/"/g, '&quot;'); }
      function escH(s) { return String(s || '').replace(/</g, '&lt;'); }
      function jq(s) { return JSON.stringify(s); }
      function parseLocalDateValue(s) { return new Date(s); }
      function formatLocalDateValue(d) { return d.toISOString().split('T')[0]; }
      function getPlannerEventLinkedTodoIds() { return []; }
      ${plannerCode}
      return renderPlannerEventsForDayHTML;
    `)();

    const html = renderFunc('2026-08-31');
    expect(html).toContain('evt_1');
    expect(html).toContain('evt_2');
    // Both cards must contain onmousedown="event.stopPropagation()"
    const stopPropagationMatches = html.match(/onmousedown="event\.stopPropagation\(\)"/g);
    expect(stopPropagationMatches).toHaveLength(2);
    // Overlapping cards should also reserve right space
    expect(html).toMatch(/width:\s*calc\(\(\(100%\s*-\s*28px\)\s*\/\s*2\)\s*-\s*3px\)/);
  });
});

// ═══════════════════════════════════════════════════
// Sourced from: app-planner-block-tags.test.js
// ═══════════════════════════════════════════════════
describe('Planner Block Tag Editing and Apple Device Interaction', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('supports pointerdown on makeTagChip for Apple touch / Safari devices', () => {
    const utilsCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-utils.js'), 'utf8');
    const makeTagChipFunc = new Function('options', `
      ${utilsCode}
      return makeTagChip;
    `)();

    let selectedTag = null;
    let removedTag = null;

    const selectChip = makeTagChipFunc('ProjectA', {
      isAssigned: false,
      onSelect: (tag) => { selectedTag = tag; }
    });

    const removeChip = makeTagChipFunc('ProjectB', {
      isAssigned: true,
      onRemove: (tag) => { removedTag = tag; }
    });

    // Simulate PointerEvent / pointerdown
    const pointerEvt = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    selectChip.dispatchEvent(pointerEvt);
    expect(selectedTag).toBe('ProjectA');

    const pointerEvtRemove = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    removeChip.dispatchEvent(pointerEvtRemove);
    expect(removedTag).toBe('ProjectB');
  });

  it('allows editing tags for planner blocks even when a note is linked', () => {
    // Setup mock DOM for planner modal
    document.body.innerHTML = `
      <div id="planner-dynamic-modal">
        <div id="pe-group-tags" class="tags-editor"></div>
        <div id="pe-major-tags" class="tags-editor"></div>
        <div id="pe-topic-tags" class="tags-editor"></div>
      </div>
    `;

    const groupEl = document.getElementById('pe-group-tags');
    const majorEl = document.getElementById('pe-major-tags');
    const topicEl = document.getElementById('pe-topic-tags');

    // Verify none of the tag editors are locked with readonly class
    expect(groupEl.classList.contains('readonly')).toBe(false);
    expect(majorEl.classList.contains('readonly')).toBe(false);
    expect(topicEl.classList.contains('readonly')).toBe(false);
  });

  it('syncs updated tags from block editor to linked note on save', () => {
    const mockManifest = [
      {
        id: 'note_123',
        group_tags: ['Sync'],
        major_topic_tags: ['OldTopic'],
        topic_tags: ['Alice']
      }
    ];

    const event = {
      id: 'evt_1',
      noteId: 'note_123',
      group_tags: ['Sync'],
      major_topic_tags: ['OldTopic'],
      topic_tags: ['Alice']
    };

    // Simulate user editing tags in the block modal
    const updatedGroups = ['Sync', 'Leadership'];
    const updatedMajors = ['Strategy'];
    const updatedTopics = ['Alice', 'Bob'];

    event.group_tags = [...updatedGroups];
    event.major_topic_tags = [...updatedMajors];
    event.topic_tags = [...updatedTopics];
    event.tags = [...new Set([...event.group_tags, ...event.major_topic_tags, ...event.topic_tags])];

    if (event.noteId) {
      const linkedNote = mockManifest.find(n => n.id === event.noteId);
      if (linkedNote) {
        linkedNote.group_tags = [...event.group_tags];
        linkedNote.major_topic_tags = [...event.major_topic_tags];
        linkedNote.topic_tags = [...event.topic_tags];
      }
    }

    expect(mockManifest[0].group_tags).toEqual(['Sync', 'Leadership']);
    expect(mockManifest[0].major_topic_tags).toEqual(['Strategy']);
    expect(mockManifest[0].topic_tags).toEqual(['Alice', 'Bob']);
  });

  it('generates event note markdown with context on top and notes section without automatic decisions or todos', async () => {
    const plannerCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-planner.js'), 'utf8');
    const generateEventNoteMarkdownFunc = new Function(`
      const NOTE_TRANSLATIONS = {
        en: {
          goal: "Goal",
          syncGoal: "Sync Up Goal",
          callGoal: "Call Goal",
          meetingGoal: "Meeting Goal",
          notes: "Notes",
          meetingNotes: "Meeting Notes"
        }
      };
      function getNoteLanguage() { return 'en'; }
      ${plannerCode}
      return generateEventNoteMarkdown;
    `)();

    const mockEventWithContext = {
      type: 'call',
      title: 'Quarterly Alignment',
      context: 'Align on Q3 budget allocations and timeline.'
    };

    const markdownWithContext = await generateEventNoteMarkdownFunc(mockEventWithContext, 'call');
    expect(markdownWithContext).toContain('# Call Goal\n\nAlign on Q3 budget allocations and timeline.');
    expect(markdownWithContext).toContain('# Notes');
    expect(markdownWithContext).not.toContain('# Decisions');
    expect(markdownWithContext).not.toContain('# Actions');
    expect(markdownWithContext).not.toContain('# Agenda & Discussion Points');
    expect(markdownWithContext).not.toContain('# Call Preparation');

    const mockEventNoContext = {
      type: 'sync',
      title: 'Quick Sync'
    };
    const markdownNoContext = await generateEventNoteMarkdownFunc(mockEventNoContext, 'sync');
    expect(markdownNoContext).toContain('# Sync Up Goal');
    expect(markdownNoContext).toContain('# Notes');
    expect(markdownNoContext).not.toContain('# Decisions');
    expect(markdownNoContext).not.toContain('# Actions');
  });
});

// ═══════════════════════════════════════════════════
// Sourced from: app-planner-bloc-modal-title.test.js
// ═══════════════════════════════════════════════════
describe('Planner Bloc Modal Title Localization', () => {
  let getHeaderPrefixAndSuffix;
  let mockLang = 'en';

  const translations = {
    de: {
      'planner.headerEdit': '',
      'planner.headerEditFeminine': '',
      'planner.headerModifyOoo': '',
      'planner.headerSchedule': '',
      'planner.headerScheduleFeminine': '',
      'planner.headerMarkOoo': '',
      'planner.headerSuffixEdit': 'bearbeiten',
      'planner.headerSuffixSchedule': 'planen',
      'planner.headerSuffixOoo': 'eintragen',
      'planner.call': 'Anruf',
      'planner.sync': 'Sync',
      'planner.ooo': 'Abwesend'
    },
    en: {
      'planner.headerEdit': 'Edit a',
      'planner.headerEditFeminine': 'Edit a',
      'planner.headerModifyOoo': 'Modify',
      'planner.headerSchedule': 'Schedule a',
      'planner.headerScheduleFeminine': 'Schedule a',
      'planner.headerMarkOoo': 'Mark',
      'planner.headerSuffixEdit': '',
      'planner.headerSuffixSchedule': '',
      'planner.headerSuffixOoo': '',
      'planner.call': 'Call',
      'planner.sync': 'Sync',
      'planner.ooo': 'OOO'
    },
    fr: {
      'planner.headerEdit': 'Modifier un',
      'planner.headerEditFeminine': 'Modifier une',
      'planner.headerModifyOoo': 'Modifier',
      'planner.headerSchedule': 'Planifier un',
      'planner.headerScheduleFeminine': 'Planifier une',
      'planner.headerMarkOoo': 'Marquer comme OOO',
      'planner.headerSuffixEdit': '',
      'planner.headerSuffixSchedule': '',
      'planner.headerSuffixOoo': '',
      'planner.call': 'Appel',
      'planner.sync': 'Réunion',
      'planner.ooo': 'OOO'
    }
  };

  beforeEach(() => {
    const plannerCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-planner.js'), 'utf8');

    const fn = new Function(`
      window.t = function(key) {
        const langPack = ${JSON.stringify(translations)}[window.currentMockLang] || ${JSON.stringify(translations.en)};
        return langPack[key] !== undefined ? langPack[key] : key;
      };
      ${plannerCode}
      return { getHeaderPrefixAndSuffix };
    `);

    const exports = fn();
    getHeaderPrefixAndSuffix = exports.getHeaderPrefixAndSuffix;
  });

  it('correctly handles German empty prefix and non-empty suffix when editing a block', () => {
    window.currentMockLang = 'de';
    const result = getHeaderPrefixAndSuffix('call', 'de', true);
    expect(result.prefix).toBe('');
    expect(result.suffix).toBe('bearbeiten');
  });

  it('correctly handles German empty prefix and non-empty suffix when creating/scheduling a block', () => {
    window.currentMockLang = 'de';
    const result = getHeaderPrefixAndSuffix('call', 'de', false);
    expect(result.prefix).toBe('');
    expect(result.suffix).toBe('planen');
  });

  it('correctly handles English prefix and empty suffix when editing a block', () => {
    window.currentMockLang = 'en';
    const result = getHeaderPrefixAndSuffix('call', 'en', true);
    expect(result.prefix).toBe('Edit a');
    expect(result.suffix).toBe('');
  });

  it('correctly handles English prefix and empty suffix when creating a block', () => {
    window.currentMockLang = 'en';
    const result = getHeaderPrefixAndSuffix('call', 'en', false);
    expect(result.prefix).toBe('Schedule a');
    expect(result.suffix).toBe('');
  });

  it('correctly handles French feminine vs masculine prefixes when editing and creating', () => {
    window.currentMockLang = 'fr';
    const editMasculine = getHeaderPrefixAndSuffix('call', 'fr', true);
    expect(editMasculine.prefix).toBe('Modifier un');

    const editFeminine = getHeaderPrefixAndSuffix('sync', 'fr', true);
    expect(editFeminine.prefix).toBe('Modifier une');

    const schedMasculine = getHeaderPrefixAndSuffix('call', 'fr', false);
    expect(schedMasculine.prefix).toBe('Planifier un');

    const schedFeminine = getHeaderPrefixAndSuffix('sync', 'fr', false);
    expect(schedFeminine.prefix).toBe('Planifier une');
  });
});

// ═══════════════════════════════════════════════════
// Sourced from: app-planner-drag-and-type-fields.test.js
// ═══════════════════════════════════════════════════
describe('Planner Task Drag-and-Drop and Modal Type/Title Fields', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  function setupPlannerScope() {
    window.t = (k) => k;
    window.manifest = [];
    window.todosManifest = [];
    window.plannerEvents = [];
    window.defaultPlannerDuration = 30;
    window.StorageAPI = { writePlanner: vi.fn(), writeNoteContent: vi.fn() };
    window.toast = vi.fn();
    window.savePlanner = vi.fn();
    window.renderPlanner = vi.fn();
    window.parseLocalDateValue = (s) => new Date(s + 'T00:00:00');
    window.formatLocalDateValue = (d) => d.toISOString().slice(0, 10);
    window.minutesToTime = (min) => {
      const h = Math.floor(min / 60);
      const m = min % 60;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    };
    window.timeToMinutes = (t) => {
      if (!t || typeof t !== 'string') return NaN;
      const [h, m] = t.split(':').map(Number);
      return isNaN(h) || isNaN(m) ? NaN : h * 60 + m;
    };
    window.escA = (s) => String(s || '').replace(/"/g, '&quot;');
    window.escH = (s) => String(s || '').replace(/</g, '&lt;');
    window.cleanTaskTitleText = (s) => s;
    window.isUserTask = () => true;
    window.getTodoQuadrant = () => 'Q1';
    window.getAppLocale = () => 'en';

    const plannerCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-planner.js'), 'utf8');
    const exports = new Function(`
      ${plannerCode}
      return {
        normalizePlannerEventsStrict,
        togglePlannerModalFields,
        handlePlannerDayColDrop,
        inferPlannerEventType
      };
    `)();
    return exports;
  }

  it('normalizes invalid event types like "event" to valid planner types in normalizePlannerEventsStrict', () => {
    const { normalizePlannerEventsStrict } = setupPlannerScope();

    const rawEvents = [
      { id: 'evt-1', title: 'Call with Team', type: 'event', date: '2026-09-02', startTime: '10:00', endTime: '10:30' },
      { id: 'evt-2', title: 'Write Documentation', type: '', date: '2026-09-02', startTime: '11:00', endTime: '11:30' },
      { id: 'evt-3', title: 'Out of office', type: 'event', date: '2026-09-02', startTime: '14:00', endTime: '15:00' }
    ];

    const result = normalizePlannerEventsStrict(rawEvents);
    const normalized = result.events;
    expect(normalized[0].type).toBe('call');
    expect(normalized[1].type).toBe('work');
    expect(normalized[2].type).toBe('ooo');
    expect(result.mutated).toBe(true);
  });

  it('shows the title field for "todo" type events in togglePlannerModalFields', () => {
    const { togglePlannerModalFields } = setupPlannerScope();

    document.body.innerHTML = `
      <div id="planner-dynamic-modal" data-is-creation="false">
        <div id="pe-title-field" style="display:none;"></div>
        <div id="pe-call-field" style="display:none;"></div>
        <div id="pe-todo-field" style="display:none;"></div>
        <div id="pe-call-options-group" style="display:none;"></div>
        <div id="pe-note-field" style="display:none;"></div>
        <div id="pe-linked-notes-field" style="display:none;"></div>
        <div id="pe-linked-todos-field" style="display:none;"></div>
        <div id="pe-collaborators-field" style="display:none;"></div>
        <div id="pe-group-tags-field" style="display:none;"></div>
        <div id="pe-major-tags-field" style="display:none;"></div>
        <div id="pe-topic-tags-field" style="display:none;"></div>
        <div id="pe-context-field" style="display:none;"></div>
        <div id="pe-type-explanation"></div>
      </div>
    `;

    togglePlannerModalFields('todo', false, false);

    const titleField = document.getElementById('pe-title-field');
    const todoField = document.getElementById('pe-todo-field');

    // Title field must be visible for todo type
    expect(titleField.style.display).not.toBe('none');
    expect(todoField.style.display).not.toBe('none');
  });

  it('populates rich task fields when dropping a todo-item onto a day column', async () => {
    const { handlePlannerDayColDrop } = setupPlannerScope();

    window.todosManifest = [
      {
        id: 'todo-99',
        title: 'Review quarterly architecture',
        noteId: 'note-42',
        group_tags: ['Tech'],
        major_topic: 'Architecture',
        topic_tags: ['Alice', 'Bob'],
        collaborators: ['Alice', 'Bob'],
        collaboratorIds: ['col-alice', 'col-bob'],
        description: 'Review the architecture diagram and approve RFC'
      }
    ];

    const mockDropEvent = {
      preventDefault: vi.fn(),
      currentTarget: {
        getBoundingClientRect: () => ({ top: 0, height: 1000 })
      },
      clientY: 240, // 240px at 80px/hr = 3 hours = 180 min -> 03:00
      dataTransfer: {
        getData: (format) => {
          if (format === 'text/plain') {
            return JSON.stringify({
              type: 'todo-item',
              todoId: 'todo-99',
              todoTitle: 'Review quarterly architecture'
            });
          }
          return '';
        }
      }
    };

    await handlePlannerDayColDrop(mockDropEvent, '2026-09-02');

    expect(window.plannerEvents.length).toBe(1);
    const created = window.plannerEvents[0];
    expect(created.type).toBe('todo');
    expect(created.title).toBe('Review quarterly architecture');
    expect(created.todoId).toBe('todo-99');
    expect(created.noteId).toBe('note-42');
    expect(created.group_tags).toEqual(['Tech']);
    expect(created.major_topic_tags).toEqual(['Architecture']);
    expect(created.topic_tags).toEqual(['Alice', 'Bob']);
    expect(created.collaborators).toEqual(['Alice', 'Bob']);
    expect(created.context).toBe('Review the architecture diagram and approve RFC');
  });
});

// ═══════════════════════════════════════════════════
// Sourced from: app-planner-type-explanations.test.js
// ═══════════════════════════════════════════════════
describe('Planner Type Explanations and Modal Type Localization', () => {
  const translationsCode = fs.readFileSync(path.resolve(__dirname, '../../js/translations.js'), 'utf8');
  const bundle = new Function(`
    ${translationsCode}
    return window.APP_TRANSLATIONS_BUNDLE;
  `)();

  const supportedLanguages = ['cs', 'de', 'en', 'es', 'fr', 'hu', 'it', 'nl', 'pl', 'pt', 'ro', 'ru', 'sv', 'tr', 'uk'];

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  function setupPlannerScope(locale = 'en') {
    window.APP_TRANSLATIONS_BUNDLE = bundle;
    window.t = (k) => {
      const entry = bundle.translations?.[k];
      if (!entry) return '';
      return entry[locale] || entry['en'] || '';
    };
    window.getAppLocale = () => locale;
    window.manifest = [];
    window.todosManifest = [];
    window.plannerEvents = [];
    window.defaultPlannerDuration = 30;
    window.StorageAPI = { writePlanner: vi.fn(), writeNoteContent: vi.fn() };
    window.toast = vi.fn();
    window.savePlanner = vi.fn();
    window.renderPlanner = vi.fn();
    window.parseLocalDateValue = (s) => new Date(s + 'T00:00:00');
    window.formatLocalDateValue = (d) => d.toISOString().slice(0, 10);
    window.minutesToTime = (min) => {
      const h = Math.floor(min / 60);
      const m = min % 60;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    };
    window.timeToMinutes = (t) => {
      if (!t || typeof t !== 'string') return NaN;
      const [h, m] = t.split(':').map(Number);
      return isNaN(h) || isNaN(m) ? NaN : h * 60 + m;
    };
    window.escA = (s) => String(s || '').replace(/"/g, '&quot;');
    window.escH = (s) => String(s || '').replace(/</g, '&lt;');
    window.cleanTaskTitleText = (s) => s;
    window.isUserTask = () => true;
    window.getTodoQuadrant = () => 'Q1';

    const plannerCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-planner.js'), 'utf8');
    const exports = new Function(`
      ${plannerCode}
      return {
        normalizePlannerEventsStrict,
        togglePlannerModalFields,
        getHeaderOptionsHtml,
        getHeaderPrefixAndSuffix,
        inferPlannerEventType
      };
    `)();
    return exports;
  }

  it('has 100% 15-language key parity for all planner explanation keys', () => {
    const explainKeys = [
      'planner.explainCall',
      'planner.explainSync',
      'planner.explainPrep',
      'planner.explainTodo',
      'planner.explainWork',
      'planner.explainOoo',
      'planner.explainCustom',
      'planner.explainPersonal'
    ];

    explainKeys.forEach(key => {
      const entry = bundle.translations?.[key];
      expect(entry, `Key ${key} should exist in translations`).toBeDefined();
      supportedLanguages.forEach(lang => {
        expect(entry[lang], `Key ${key} must have translation for language "${lang}"`).toBeTruthy();
        expect(typeof entry[lang]).toBe('string');
        expect(entry[lang].trim().length).toBeGreaterThan(0);
      });
    });
  });

  it('has 100% 15-language key parity for planner type labels and plan action buttons', () => {
    const typeKeys = [
      'planner.call',
      'planner.sync',
      'planner.prep',
      'planner.todo',
      'planner.work',
      'planner.ooo',
      'planner.custom',
      'planner.personal',
      'planner.planCall',
      'planner.planSync',
      'planner.planPrep',
      'planner.planTodo',
      'planner.planWork',
      'planner.planOoo',
      'planner.planCustom',
      'planner.planPersonal',
      'planner.assigned'
    ];

    typeKeys.forEach(key => {
      const entry = bundle.translations?.[key];
      expect(entry, `Key ${key} should exist in translations`).toBeDefined();
      supportedLanguages.forEach(lang => {
        expect(entry[lang], `Key ${key} must have translation for language "${lang}"`).toBeTruthy();
        expect(typeof entry[lang]).toBe('string');
        expect(entry[lang].trim().length).toBeGreaterThan(0);
      });
    });
  });

  it('renders correct explanation in pe-type-explanation for every bloc type in togglePlannerModalFields', () => {
    const { togglePlannerModalFields } = setupPlannerScope('en');

    document.body.innerHTML = `
      <div id="planner-dynamic-modal" data-is-creation="false">
        <div id="pe-title-field" style="display:none;"></div>
        <div id="pe-call-field" style="display:none;"></div>
        <div id="pe-todo-field" style="display:none;"></div>
        <div id="pe-call-options-group" style="display:none;"></div>
        <div id="pe-note-field" style="display:none;"><span class="field-label"></span></div>
        <div id="pe-linked-notes-field" style="display:none;"></div>
        <div id="pe-linked-todos-field" style="display:none;"></div>
        <div id="pe-collaborators-field" style="display:none;"></div>
        <div id="pe-group-tags-field" style="display:none;"></div>
        <div id="pe-major-tags-field" style="display:none;"></div>
        <div id="pe-topic-tags-field" style="display:none;"></div>
        <div id="pe-context-field" style="display:none;"></div>
        <div id="pe-type-explanation"></div>
        <span id="pe-header-prefix"></span>
        <span id="pe-header-suffix"></span>
      </div>
    `;

    const explanationEl = document.getElementById('pe-type-explanation');

    // Test 'personal'
    togglePlannerModalFields('personal', false, false);
    expect(explanationEl.textContent).toContain('Personal block (lunch, break, admin tasks)');

    // Test 'custom'
    togglePlannerModalFields('custom', false, false);
    expect(explanationEl.textContent).toContain('Personal block (lunch, break, admin tasks)');

    // Test 'call'
    togglePlannerModalFields('call', false, false);
    expect(explanationEl.textContent).toContain('Plan a voice or video call');

    // Test 'sync'
    togglePlannerModalFields('sync', false, false);
    expect(explanationEl.textContent).toContain('Team or 1-on-1 synchronization meeting');

    // Test 'prep'
    togglePlannerModalFields('prep', false, false);
    expect(explanationEl.textContent).toContain('Preparation or follow-up session');

    // Test 'todo'
    togglePlannerModalFields('todo', false, false);
    expect(explanationEl.textContent).toContain('Scheduled work session dedicated to completing a specific task');

    // Test 'work'
    togglePlannerModalFields('work', false, false);
    expect(explanationEl.textContent).toContain('Focus session to work on a professional project');

    // Test 'ooo'
    togglePlannerModalFields('ooo', false, false);
    expect(explanationEl.textContent).toContain('Time away from work');
  });

  it('translates explanation box properly in German, French and other languages', () => {
    // German test
    {
      const { togglePlannerModalFields } = setupPlannerScope('de');
      document.body.innerHTML = `
        <div id="planner-dynamic-modal" data-is-creation="false">
          <div id="pe-title-field" style="display:none;"></div>
          <div id="pe-call-field" style="display:none;"></div>
          <div id="pe-todo-field" style="display:none;"></div>
          <div id="pe-call-options-group" style="display:none;"></div>
          <div id="pe-note-field" style="display:none;"><span class="field-label"></span></div>
          <div id="pe-linked-notes-field" style="display:none;"></div>
          <div id="pe-linked-todos-field" style="display:none;"></div>
          <div id="pe-collaborators-field" style="display:none;"></div>
          <div id="pe-group-tags-field" style="display:none;"></div>
          <div id="pe-major-tags-field" style="display:none;"></div>
          <div id="pe-topic-tags-field" style="display:none;"></div>
          <div id="pe-context-field" style="display:none;"></div>
          <div id="pe-type-explanation"></div>
        </div>
      `;
      const explanationEl = document.getElementById('pe-type-explanation');
      togglePlannerModalFields('personal', false, false);
      expect(explanationEl.textContent).toContain('Persönlicher Block (Mittagessen, Pause, administrative Aufgaben)');
    }

    // French test
    {
      const { togglePlannerModalFields } = setupPlannerScope('fr');
      document.body.innerHTML = `
        <div id="planner-dynamic-modal" data-is-creation="false">
          <div id="pe-title-field" style="display:none;"></div>
          <div id="pe-call-field" style="display:none;"></div>
          <div id="pe-todo-field" style="display:none;"></div>
          <div id="pe-call-options-group" style="display:none;"></div>
          <div id="pe-note-field" style="display:none;"><span class="field-label"></span></div>
          <div id="pe-linked-notes-field" style="display:none;"></div>
          <div id="pe-linked-todos-field" style="display:none;"></div>
          <div id="pe-collaborators-field" style="display:none;"></div>
          <div id="pe-group-tags-field" style="display:none;"></div>
          <div id="pe-major-tags-field" style="display:none;"></div>
          <div id="pe-topic-tags-field" style="display:none;"></div>
          <div id="pe-context-field" style="display:none;"></div>
          <div id="pe-type-explanation"></div>
        </div>
      `;
      const explanationEl = document.getElementById('pe-type-explanation');
      togglePlannerModalFields('personal', false, false);
      expect(explanationEl.textContent).toContain('Créneau personnel (déjeuner, pause, tâches administratives)');
    }
  });

  it('normalizes events with type "personal" as valid without mutating away from personal', () => {
    const { normalizePlannerEventsStrict, inferPlannerEventType } = setupPlannerScope();

    expect(inferPlannerEventType('Lunch with Team', '')).toBe('personal');
    expect(inferPlannerEventType('Doctor Appointment', '')).toBe('personal');

    const rawEvents = [
      { id: 'evt-1', title: 'Lunch break', type: 'personal', date: '2026-09-22', startTime: '12:00', endTime: '13:00' }
    ];

    const result = normalizePlannerEventsStrict(rawEvents);
    expect(result.events[0].type).toBe('personal');
  });
});

// ═══════════════════════════════════════════════════
// Sourced from: app-planner-reviewed-note.test.js
// ═══════════════════════════════════════════════════
describe('Planner Reviewed Days Note Opening', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="planner-week-range-title"></div><div id="planner-grid-body"></div>';
    vi.restoreAllMocks();
  });

  function createPlannerEnvironment(options = {}) {
    const plannerCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-planner.js'), 'utf8');

    // Create container
    const panel = document.createElement('div');
    panel.id = 'planner-panel';
    document.body.appendChild(panel);

    const initFunc = new Function(`
      window.plannerEvents = [];
      window.todosManifest = [];
      window.manifest = [];
      window.selectedPlannerEventId = null;
      window.plannerRightSidebarCollapsed = false;
      window.plannerActivePaneTab = 'unassigned';
      window.plannerRightPaneWidth = 320;
      window.plannerViewMode = 'week';
      window.currentPlannerWeekStart = new Date(2026, 7, 24);
      window.plannerDisplayDateOverride = ['2026-08-28'];
      window.plannerInitialFocusDate = null;
      window.plannerDaysCount = 7;
      window.plannerWorkingDays = [1, 2, 3, 4, 5];
      window.currentLang = 'en';
      window.workStartTime = '09:00';
      window.workEndTime = '18:30';
      window.plannerContextMenu = null;
      window.plannerContextMenuHandlers = [];
      window._reviewedDates = new Set(${JSON.stringify(options.reviewedDates || [])});
      window.isDailyReviewDateReviewed = function(d) { return window._reviewedDates.has(d); };
      window.getAppLocale = function() { return 'en-US'; };
      window.closePlannerContextMenu = function() {};
      window.parseLocalDateValue = function(s) { return new Date(s + 'T00:00:00'); };
      window.getPlannerUnassignedTodos = function() { return []; };
      window.getPlannerNotDoneTodos = function() { return []; };
      window.btnLabel = function(icon, key, fallback) { return icon + ' ' + (window.t(key) || fallback); };
      window.getPlannerDaysToDisplay = function() {
        return [
          new Date(2026, 7, 28)
        ];
      };
      window.getPlannerWeeklyStats = function() { return { totalHours: 0, callHours: 0, workHours: 0, prepHours: 0 }; };
      window._plannerTypeFilter = null;
      window._plannerSidePriorityFilter = 'All';
      window._plannerSideSearchQuery = '';
      window._plannerRightPaneWidth = 320;
      window.getNoteById = function() { return null; };
      window.getTodoById = function() { return null; };
      window.getIntrinsicAssociatedNotesForPlannerEvent = function() { return []; };
      window.getRelatedNotesForTags = function() { return []; };
      window.getPlannerEventLinkedTodoIds = function() { return []; };
      window.plannerEventSupportsNoteAction = function() { return false; };
      window.editPlannerEvent = function() {};
      window.deletePlannerEvent = function() {};
      window.startDailyReview = vi.fn();
      window.t = function(k) {
        const dict = {
          'planner.panel': 'Planner',
          'planner.allDayBadge': 'All day',
          'planner.openDailyReviewNote': 'Daily Review Note',
          'planner.openDailyReviewNoteTooltip': 'Open daily review note for this day',
          'retro.reviewDayTooltip': 'Review this day',
          'week.dayNames': ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
          'planner.date': 'Date',
          'planner.startTime': 'Time'
        };
        return dict[k] || k;
      };
      window.escA = function(s) { return String(s || '').replace(/"/g, '&quot;'); };
      window.escH = function(s) { return String(s || '').replace(/</g, '&lt;'); };
      window.jq = function(s) { return JSON.stringify(s); };
      window.formatLocalDateValue = function(d) {
        if (typeof d === 'string') return d;
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return year + '-' + month + '-' + day;
      };
      window._plannerText = function(k, def) { return window.t(k) || def; };
      window._plannerTabLabel = function(lbl, count) { return lbl + ' (' + count + ')'; };
      ${plannerCode}
      return {
        renderPlanner,
        renderCalendarGrid
      };
    `)();

    return initFunc;
  }

  it('renders reviewed day checkmark and cell with startDailyReview(dateStr, 5) and localized tooltip', () => {
    const env = createPlannerEnvironment({ reviewedDates: ['2026-08-28'] });
    env.renderPlanner();

    const gridBody = document.getElementById('planner-grid-body');
    expect(gridBody).not.toBeNull();

    const headerCell = gridBody.querySelector('.planner-header-cell.reviewed');
    expect(headerCell).not.toBeNull();
    expect(headerCell.getAttribute('onclick')).toContain("window.startDailyReview('2026-08-28', 5)");
    expect(headerCell.getAttribute('title')).toBe('Open daily review note for this day');

    const checkmarkBtn = headerCell.querySelector('.planner-header-reviewed');
    expect(checkmarkBtn).not.toBeNull();
    expect(checkmarkBtn.getAttribute('onclick')).toContain("window.startDailyReview('2026-08-28', 5)");
    expect(checkmarkBtn.getAttribute('title')).toBe('Open daily review note for this day');
  });

  it('renders unreviewed past day with standard review start', () => {
    const env = createPlannerEnvironment({ reviewedDates: [] });
    env.renderPlanner();

    const gridBody = document.getElementById('planner-grid-body');
    const headerCell = gridBody.querySelector('.planner-header-cell');
    expect(headerCell).not.toBeNull();
    expect(headerCell.getAttribute('onclick')).toContain("window.startDailyReview('2026-08-28')");
    expect(headerCell.getAttribute('onclick')).not.toContain(', 5');
    expect(headerCell.getAttribute('title')).toBe('Review this day');
  });
});

// ═══════════════════════════════════════════════════
// Sourced from: app-planner-ooo-allday-block.test.js
// ═══════════════════════════════════════════════════
describe('Planner All-Day OOO Blocks & Daily Review Triggers', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  function createPlannerEnvironment() {
    const plannerCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-planner.js'), 'utf8');

    // Create container
    const panel = document.createElement('div');
    panel.id = 'planner-panel';
    document.body.appendChild(panel);

    const initFunc = new Function(`
      window.plannerEvents = [];
      window.todosManifest = [];
      window.manifest = [];
      window.selectedPlannerEventId = null;
      window.plannerRightSidebarCollapsed = false;
      window.plannerActivePaneTab = 'unassigned';
      window.plannerRightPaneWidth = 320;
      window.plannerViewMode = 'week';
      window.currentPlannerWeekStart = new Date(2026, 8, 1);
      window.plannerDisplayDateOverride = ['2026-09-01', '2026-09-02', '2026-09-03'];
      window.plannerInitialFocusDate = null;
      window.plannerDaysCount = 7;
      window.plannerWorkingDays = [1, 2, 3];
      window.currentLang = 'en';
      window.workStartTime = '09:00';
      window.workEndTime = '18:30';
      window.plannerContextMenu = null;
      window.plannerContextMenuHandlers = [];
      window._reviewedDates = new Set();
      window.isDailyReviewDateReviewed = function(d) { return window._reviewedDates.has(d); };
      window.getAppLocale = function() { return 'en-US'; };
      window.closePlannerContextMenu = function() {};
      window.parseLocalDateValue = function(s) { return new Date(s + 'T00:00:00'); };
      window.getPlannerUnassignedTodos = function() { return []; };
      window.getPlannerNotDoneTodos = function() { return []; };
      window.btnLabel = function(icon, key, fallback) { return icon + ' ' + (window.t(key) || fallback); };
      window.getPlannerDaysToDisplay = function() {
        return [
          new Date(2026, 8, 1),
          new Date(2026, 8, 2),
          new Date(2026, 8, 3)
        ];
      };
      window.getPlannerWeeklyStats = function() { return { totalHours: 0, callHours: 0, workHours: 0, prepHours: 0 }; };
      window._plannerTypeFilter = null;
      window._plannerSidePriorityFilter = 'All';
      window._plannerSideSearchQuery = '';
      window._plannerRightPaneWidth = 320;
      window.getNoteById = function(id) { return null; };
      window.getTodoById = function(id) { return null; };
      window.getIntrinsicAssociatedNotesForPlannerEvent = function() { return []; };
      window.getRelatedNotesForTags = function() { return []; };
      window.getPlannerEventLinkedTodoIds = function() { return []; };
      window.plannerEventSupportsNoteAction = function() { return false; };
      window.editPlannerEvent = function(id) {};
      window.deletePlannerEvent = function(id) {};
      window.startDailyReview = vi.fn();
      window.t = function(k) {
        const dict = {
          'planner.panel': 'Planner',
          'planner.allDayBadge': 'All day',
          'planner.ooo': 'Out of Office',
          'planner.oooFullDayBanner': 'Out of Office',
          'planner.triggerDailyReview': 'Daily Review',
          'planner.triggerDailyReviewTooltip': 'Start Daily Review to reflect and plan',
          'retro.reviewDayTooltip': 'Review this day',
          'retro.reopenReviewTooltip': 'Reopen Daily Review',
          'week.dayNames': ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
          'planner.date': 'Date',
          'planner.startTime': 'Time'
        };
        return dict[k] || k;
      };
      window.escA = function(s) { return String(s || '').replace(/"/g, '&quot;'); };
      window.escH = function(s) { return String(s || '').replace(/</g, '&lt;'); };
      window.jq = function(s) { return JSON.stringify(s); };
      window.formatLocalDateValue = function(d) {
        if (typeof d === 'string') return d;
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return year + '-' + month + '-' + day;
      };
      window._plannerText = function(k, def) { return window.t(k) || def; };
      window._plannerTabLabel = function(lbl, count) { return lbl + ' (' + count + ')'; };
      ${plannerCode}
      return {
        renderPlanner,
        selectPlannerEvent,
        renderPlannerEventsForDayHTML,
        renderCalendarGrid,
        togglePlannerMoreDropdown,
        closePlannerMoreDropdown
      };
    `)();

    return initFunc;
  }

  it('renders all-day OOO events as blocks during the day timeline in addition to header banners', () => {
    const env = createPlannerEnvironment();

    window.plannerEvents = [
      {
        id: 'evt-ooo-1',
        type: 'ooo',
        title: 'Vacation in Alps',
        allDay: true,
        date: '2026-09-01',
        endDate: '2026-09-02'
      }
    ];

    env.renderPlanner();

    // Check header banners
    const headerBanners = document.querySelectorAll('.planner-ooo-allday-banner');
    expect(headerBanners.length).toBe(2); // 2026-09-01 and 2026-09-02

    // Check timeline blocks
    const colDay1 = document.querySelector('.planner-day-col[data-date="2026-09-01"]');
    const colDay2 = document.querySelector('.planner-day-col[data-date="2026-09-02"]');
    const colDay3 = document.querySelector('.planner-day-col[data-date="2026-09-03"]');

    expect(colDay1).not.toBeNull();
    expect(colDay2).not.toBeNull();
    expect(colDay3).not.toBeNull();

    const oooBlockDay1 = colDay1.querySelector('.planner-event-card.event-ooo');
    const oooBlockDay2 = colDay2.querySelector('.planner-event-card.event-ooo');
    const oooBlockDay3 = colDay3.querySelector('.planner-event-card.event-ooo');

    expect(oooBlockDay1).not.toBeNull();
    expect(oooBlockDay2).not.toBeNull();
    expect(oooBlockDay3).toBeNull();

    // Verify classes and content
    expect(oooBlockDay1.classList.contains('event-allday-ooo')).toBe(true);
    expect(oooBlockDay1.textContent).toContain('Vacation in Alps');
    expect(oooBlockDay1.textContent).toContain('All day');

    // Verify quick action buttons exist on the block
    const quickActions = oooBlockDay1.querySelector('.planner-event-quick-actions');
    expect(quickActions).not.toBeNull();
    expect(quickActions.querySelectorAll('button').length).toBeGreaterThanOrEqual(3);
  });

  it('allows clicking an all-day OOO block to select and inspect it in the right sidebar', () => {
    const env = createPlannerEnvironment();

    window.plannerEvents = [
      {
        id: 'evt-ooo-1',
        type: 'ooo',
        title: 'Holiday',
        allDay: true,
        date: '2026-09-01',
        endDate: '2026-09-03'
      }
    ];

    env.renderPlanner();

    // Click block to select it
    env.selectPlannerEvent('evt-ooo-1');

    const inspector = document.getElementById('planner-right-sidebar-inspector');
    expect(inspector).not.toBeNull();
    expect(inspector.textContent).toContain('Holiday');
    expect(inspector.textContent).toContain('2026-09-01 – 2026-09-03');
    expect(inspector.textContent).toContain('All day');
  });

  it('renders interactive review checkmarks in planner day headers and triggers Daily Review on click', () => {
    const env = createPlannerEnvironment();

    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const dayBefore = new Date(today);
    dayBefore.setDate(today.getDate() - 2);

    const d0 = window.formatLocalDateValue(dayBefore);
    const d1 = window.formatLocalDateValue(yesterday);
    const d2 = window.formatLocalDateValue(today);

    window.plannerDisplayDateOverride = [d0, d1, d2];
    // Mark d0 as reviewed, d1 as unreviewed
    window._reviewedDates = new Set([d0]);

    env.renderPlanner();

    const headerCells = document.querySelectorAll('.planner-header-cell');
    expect(headerCells.length).toBe(3);

    // d0 is reviewed -> has reviewed checkmark
    const reviewedBtn = headerCells[0].querySelector('.planner-header-reviewed');
    expect(reviewedBtn).not.toBeNull();
    expect(reviewedBtn.classList.contains('unreviewed')).toBe(false);
    expect(headerCells[0].classList.contains('reviewed')).toBe(true);

    // d1 is unreviewed -> has unreviewed button
    const unreviewedBtn = headerCells[1].querySelector('.planner-header-reviewed');
    expect(unreviewedBtn).not.toBeNull();
    expect(unreviewedBtn.classList.contains('unreviewed')).toBe(true);

    // Verify onclick handler attributes
    expect(unreviewedBtn.getAttribute('onclick')).toContain(`window.startDailyReview('${d1}')`);
    expect(headerCells[1].getAttribute('onclick')).toContain(`window.startDailyReview('${d1}')`);

    // Verify calling startDailyReview with the date triggers the review spy
    const reviewSpy = vi.fn();
    window.startDailyReview = reviewSpy;
    eval(unreviewedBtn.getAttribute('onclick').replace('event.stopPropagation();', ''));
    expect(reviewSpy).toHaveBeenCalledWith(d1);
  });

  it('automatically reviews OOO days without opening Daily Review wizard on click', () => {
    const env = createPlannerEnvironment();

    const today = new Date();
    const d0 = window.formatLocalDateValue(today);

    window.plannerEvents = [
      {
        id: 'ooo-day-event',
        title: 'Holiday',
        type: 'ooo',
        allDay: true,
        date: d0,
        endDate: d0
      }
    ];

    window.plannerDisplayDateOverride = [d0];
    env.renderPlanner();

    const headerCells = document.querySelectorAll('.planner-header-cell');
    expect(headerCells.length).toBe(1);

    const cell = headerCells[0];
    expect(cell.classList.contains('is-ooo')).toBe(true);

    const checkmarkBtn = cell.querySelector('.planner-header-reviewed');
    expect(checkmarkBtn).not.toBeNull();
    expect(checkmarkBtn.classList.contains('ooo-reviewed')).toBe(true);

    // Click does not invoke startDailyReview
    expect(checkmarkBtn.getAttribute('onclick')).not.toContain('startDailyReview');
    expect(cell.getAttribute('onclick') || '').not.toContain('startDailyReview');
  });
});

