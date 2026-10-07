import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Planner Series vs Bloc Edit Split & Series Modal', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();

    window.t = (key, params) => {
      if (params && params.count !== undefined) {
        return key.replace('{count}', params.count);
      }
      return key;
    };
    window.escH = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    window.escA = s => String(s || '').replace(/"/g, '&quot;');
    window.jq = s => JSON.stringify(s);
    window.parseLocalDateValue = str => {
      if (!str) return new Date();
      const [y, m, d] = str.split('-').map(Number);
      return new Date(y, m - 1, d);
    };
    window.formatLocalDateValue = d => {
      if (!d) return '';
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    window.timeToMinutes = timeStr => {
      if (!timeStr) return 0;
      const [h, m] = timeStr.split(':').map(Number);
      return h * 60 + m;
    };
    window.minutesToTime = mins => {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    };
    window._calcDurationMins = (start, end) => {
      if (!start || !end) return 30;
      const [sh, sm] = start.split(':').map(Number);
      const [eh, em] = end.split(':').map(Number);
      return (eh * 60 + em) - (sh * 60 + sm);
    };
    window.btnLabel = (icon, key, fallback) => `${icon} ${fallback}`;
    window.pushPlannerUndoState = vi.fn();
    window.savePlanner = vi.fn().mockResolvedValue(true);
    window.renderPlanner = vi.fn();
    window.toast = vi.fn();
    window.manifest = [];
    window.saveManifest = vi.fn();
    window.plannerEvents = [];
    window.todosManifest = [];
    window.StorageAPI = { writeNoteContent: vi.fn().mockResolvedValue(true) };
    window.NoteTemplateManager = {
      getTemplates: () => [
        { id: 'standard', name: 'Standard Note', icon: '📝' },
        { id: 'meeting_1on1', name: '1-on-1 Meeting', icon: '👥' },
        { id: 'project_kickoff', name: 'Project Kickoff', icon: '🚀' }
      ],
      getTemplateHTML: id => {
        if (id === 'meeting_1on1') return '<h2>1-on-1 Check In</h2>';
        if (id === 'project_kickoff') return '<h2>Kickoff Objectives</h2>';
        return '';
      }
    };
    window.populateTagEditor = vi.fn();
    window.pruneUnusedAutoCreatedColleagues = vi.fn();
    global.pruneUnusedAutoCreatedColleagues = window.pruneUnusedAutoCreatedColleagues;
    global.workStartTime = '09:00';
    global.workEndTime = '18:30';
    global.selectedPlannerEventId = null;
    window.workStartTime = '09:00';
    window.workEndTime = '18:30';
    window.selectedPlannerEventId = null;
    window.getPlannerDaysToDisplay = () => [
      new Date(2026, 8, 14),
      new Date(2026, 8, 15),
      new Date(2026, 8, 16),
      new Date(2026, 8, 17),
      new Date(2026, 8, 18),
      new Date(2026, 8, 19),
      new Date(2026, 8, 20),
      new Date(2026, 8, 21)
    ];
    global.getPlannerDaysToDisplay = window.getPlannerDaysToDisplay;
    global.formatLocalDateValue = window.formatLocalDateValue;
    global.parseLocalDateValue = window.parseLocalDateValue;
    global.timeToMinutes = window.timeToMinutes;
    global.minutesToTime = window.minutesToTime;
    global._calcDurationMins = window._calcDurationMins;
    global.t = window.t;
    global.escH = window.escH;
    global.escA = window.escA;
    global.jq = window.jq;
    global.toast = window.toast;
    global.manifest = window.manifest;
    global.todosManifest = window.todosManifest;
    global.savePlanner = window.savePlanner;
    global.renderPlanner = window.renderPlanner;
    global.pushPlannerUndoState = window.pushPlannerUndoState;
    window.populateTagEditor = vi.fn();
    window.readTagEditor = vi.fn().mockReturnValue([]);
    window.readCollaboratorMultiPicker = vi.fn().mockReturnValue([]);
    window.populateCollaboratorMultiPicker = vi.fn();
    window.isUserTask = vi.fn(() => true);
    window.getCleanTaskTitle = vi.fn(t => t?.title || '');
    window.plannerEvents = [];
    global.plannerEvents = window.plannerEvents;
  });

  function loadPlannerModule() {
    const plannerCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-planner.js'), 'utf8');
    const exports = new Function(`
      ${plannerCode}
      return {
        syncPlannerEventTagsToLinkedNote,
        openPlannerSeriesModal,
        closePlannerSeriesModal,
        deletePlannerSeries,
        savePlannerSeriesFromModal,
        openNoteForEvent,
        normalizePlannerEventsStrict,
        openPlanEventModal,
        precreateRecurringEventsForWeek,
        deletePlannerEventWithDissolve
      };
    `)();
    return exports;
  }

  it('verifies single bloc edit preserves recurrenceId and synchronizes note tags without scope dialog', () => {
    const { syncPlannerEventTagsToLinkedNote } = loadPlannerModule();

    const linkedNote = {
      id: 'note-101',
      group_tags: ['InitialGroup'],
      major_topic_tags: [],
      topic_tags: []
    };
    window.manifest = [linkedNote];

    const event = {
      id: 'evt-1',
      recurrenceId: 'rec-series-1',
      noteId: 'note-101',
      group_tags: ['UpdatedGroup', 'ExtraTag'],
      major_topic_tags: ['Sprint'],
      topic_tags: ['Planning']
    };

    syncPlannerEventTagsToLinkedNote(event);

    expect(linkedNote.group_tags).toEqual(['UpdatedGroup', 'ExtraTag']);
    expect(linkedNote.major_topic_tags).toEqual(['Sprint']);
    expect(linkedNote.topic_tags).toEqual(['Planning']);
    expect(window.saveManifest).toHaveBeenCalled();
  });

  it('detects schedule, duration, tags, and participants drift across series sessions', () => {
    const { openPlannerSeriesModal, closePlannerSeriesModal } = loadPlannerModule();

    // Setup a recurring series with baseline and drifted sessions
    window.plannerEvents = [
      {
        id: 'evt-baseline',
        recurrenceId: 'rec-test-1',
        recurrenceRule: { interval: 1, unit: 'week', until: '2026-12-31' },
        date: '2026-09-01',
        startTime: '10:00',
        endTime: '11:00',
        title: 'Weekly Standup',
        group_tags: ['Engineering'],
        major_topic_tags: ['Core'],
        topic_tags: [],
        collaboratorIds: ['alice', 'bob'],
        collaborators: ['Alice', 'Bob']
      },
      {
        id: 'evt-drift-schedule',
        recurrenceId: 'rec-test-1',
        date: '2026-09-08',
        startTime: '14:00', // Drifted start time
        endTime: '15:00',
        title: 'Weekly Standup',
        group_tags: ['Engineering'],
        major_topic_tags: ['Core'],
        topic_tags: [],
        collaboratorIds: ['alice', 'bob'],
        collaborators: ['Alice', 'Bob']
      },
      {
        id: 'evt-drift-duration',
        recurrenceId: 'rec-test-1',
        date: '2026-09-15',
        startTime: '10:00',
        endTime: '10:30', // Drifted duration (30m vs 60m)
        title: 'Weekly Standup',
        group_tags: ['Engineering'],
        major_topic_tags: ['Core'],
        topic_tags: [],
        collaboratorIds: ['alice', 'bob'],
        collaborators: ['Alice', 'Bob']
      },
      {
        id: 'evt-drift-tags',
        recurrenceId: 'rec-test-1',
        date: '2026-09-22',
        startTime: '10:00',
        endTime: '11:00',
        title: 'Weekly Standup',
        group_tags: ['Product'], // Drifted tag
        major_topic_tags: ['Roadmap'],
        topic_tags: [],
        collaboratorIds: ['alice', 'bob'],
        collaborators: ['Alice', 'Bob']
      },
      {
        id: 'evt-drift-collabs',
        recurrenceId: 'rec-test-1',
        date: '2026-09-29',
        startTime: '10:00',
        endTime: '11:00',
        title: 'Weekly Standup',
        group_tags: ['Engineering'],
        major_topic_tags: ['Core'],
        topic_tags: [],
        collaboratorIds: ['alice', 'charlie'], // Drifted participants
        collaborators: ['Alice', 'Charlie']
      }
    ];

    openPlannerSeriesModal('rec-test-1');

    const modal = document.getElementById('planner-series-modal');
    expect(modal).not.toBeNull();

    // Check that cards are rendered for all 5 sessions
    const cards = modal.querySelectorAll('.planner-series-session-card');
    expect(cards.length).toBe(5);

    // Verify badges in evt-drift-schedule card
    const scheduleCard = modal.querySelector('.planner-series-session-card[data-event-id="evt-drift-schedule"]');
    expect(scheduleCard.querySelector('.planner-drift-badge--override').textContent).toContain('planner.statusRescheduled');

    // Verify badges in evt-drift-duration card
    const durationCard = modal.querySelector('.planner-series-session-card[data-event-id="evt-drift-duration"]');
    expect(durationCard.querySelector('.planner-drift-badge--override').textContent).toContain('planner.statusDurationCustom');

    // Verify badges in evt-drift-tags card
    const tagsCard = modal.querySelector('.planner-series-session-card[data-event-id="evt-drift-tags"]');
    expect(tagsCard.querySelector('.planner-drift-badge--override').textContent).toContain('planner.statusTagsCustom');

    // Verify badges in evt-drift-collabs card
    const collabsCard = modal.querySelector('.planner-series-session-card[data-event-id="evt-drift-collabs"]');
    expect(collabsCard.querySelector('.planner-drift-badge--override').textContent).toContain('planner.statusCollabsCustom');

    closePlannerSeriesModal();
    expect(document.getElementById('planner-series-modal')).toBeNull();
  });

  it('supports end date presets (+3m, +6m, +1y, now) and no-end-date toggle', () => {
    loadPlannerModule();

    // Render input controls mock
    document.body.innerHTML = `
      <div id="planner-series-modal">
        <input type="checkbox" id="ps-no-end-date">
        <input type="date" id="ps-until-date">
      </div>
    `;

    const untilInput = document.getElementById('ps-until-date');
    const noEndCb = document.getElementById('ps-no-end-date');

    // Preset 3m
    window._setPlannerSeriesEndDatePreset('3m');
    expect(untilInput.value).not.toBe('');
    expect(noEndCb.checked).toBe(false);

    // Preset now
    window._setPlannerSeriesEndDatePreset('now');
    const todayStr = window.formatLocalDateValue(new Date());
    expect(untilInput.value).toBe(todayStr);

    // Toggle No end date
    window._togglePlannerSeriesNoEndDate(true);
    expect(untilInput.disabled).toBe(true);
    expect(untilInput.value).toBe('');

    // Untoggle No end date
    window._togglePlannerSeriesNoEndDate(false);
    expect(untilInput.disabled).toBe(false);
    expect(untilInput.value).not.toBe('');
  });

  it('allows granular dimension propagation across all_history, unmodified, and selection scopes', async () => {
    const { savePlannerSeriesFromModal } = loadPlannerModule();

    window.plannerEvents = [
      {
        id: 'evt-master',
        recurrenceId: 'rec-prop-1',
        recurrenceRule: { interval: 1, unit: 'week', until: '2026-12-31' },
        date: '2026-09-01',
        startTime: '10:00',
        endTime: '11:00',
        title: 'Original Title',
        group_tags: ['OldGroup'],
        major_topic_tags: [],
        topic_tags: [],
        noteId: 'note-master'
      },
      {
        id: 'evt-custom-tags',
        recurrenceId: 'rec-prop-1',
        date: '2026-09-08',
        startTime: '10:00',
        endTime: '11:00',
        title: 'Original Title',
        group_tags: ['CustomizedGroup'], // Drifted
        major_topic_tags: [],
        topic_tags: [],
        noteId: 'note-custom'
      }
    ];

    window.manifest = [
      { id: 'note-master', group_tags: ['OldGroup'] },
      { id: 'note-custom', group_tags: ['CustomizedGroup'] }
    ];

    // Mock series modal DOM with unmodified tags scope
    document.body.innerHTML = `
      <div id="planner-series-modal">
        <input type="text" id="ps-title" value="Updated Title">
        <select id="ps-type"><option value="call" selected>Call</option></select>
        <input type="time" id="ps-start-time" value="11:00">
        <input type="time" id="ps-end-time" value="12:00">
        <input type="checkbox" id="ps-no-end-date" checked>
        <input type="date" id="ps-until-date" value="">
        <select id="ps-note-template"><option value="meeting_1on1" selected>1-on-1 Meeting</option></select>
        <select id="ps-scope-schedule"><option value="all_history" selected>All</option></select>
        <select id="ps-scope-tags"><option value="unmodified" selected>Unmodified only</option></select>
        <select id="ps-scope-collab"><option value="all_history" selected>All</option></select>
        <select id="ps-scope-template"><option value="all_history" selected>All</option></select>
        <input type="checkbox" class="planner-series-session-checkbox" data-event-id="evt-master" checked>
        <input type="checkbox" class="planner-series-session-checkbox" data-event-id="evt-custom-tags" checked>
      </div>
    `;

    // Mock readTagEditor to return new tags
    window.readTagEditor = id => {
      if (id === 'ps-group-tags') return ['NewSeriesGroup'];
      return [];
    };

    await savePlannerSeriesFromModal('rec-prop-1');

    const master = window.plannerEvents.find(e => e.id === 'evt-master');
    const custom = window.plannerEvents.find(e => e.id === 'evt-custom-tags');

    // Title updated on both (schedule/general scope = all_history)
    expect(master.title).toBe('Updated Title');
    expect(custom.title).toBe('Updated Title');

    // Tags scope was 'unmodified': master was updated, but custom session preserved its override!
    expect(master.group_tags).toEqual(['NewSeriesGroup']);
    expect(custom.group_tags).toEqual(['CustomizedGroup']);

    // Template updated on both
    expect(master.noteTemplateId).toBe('meeting_1on1');
    expect(custom.noteTemplateId).toBe('meeting_1on1');

    // Note tag synced for master note in manifest
    const noteMaster = window.manifest.find(n => n.id === 'note-master');
    expect(noteMaster.group_tags).toEqual(['NewSeriesGroup']);
  });

  it('inherits note layout template when generating note for series session', async () => {
    window.generateNoteId = () => 'gen-note-1';
    window.getCanonicalNotePath = id => `Notes/${id}.html`;
    window.mdToPreviewHTML = md => `<p>${md}</p>`;
    window.buildNewNoteHTML = note => note.mainHTML;
    window.upsertManifest = vi.fn();
    window.rebuildIndexHTML = vi.fn().mockResolvedValue(true);
    window.renderFilterChips = vi.fn();
    window.openNoteOverlay = vi.fn();
    window.showPlannerNoteGenerationProgress = () => () => {};

    const { openNoteForEvent } = loadPlannerModule();

    const masterEvent = {
      id: 'evt-parent',
      recurrenceId: 'rec-templ-1',
      recurrenceRule: { interval: 1, unit: 'week' },
      noteTemplateId: 'project_kickoff',
      date: '2026-09-01',
      startTime: '10:00',
      endTime: '11:00'
    };

    const sessionEvent = {
      id: 'evt-child',
      recurrenceId: 'rec-templ-1',
      date: '2026-09-08',
      startTime: '10:00',
      endTime: '11:00'
    };

    window.plannerEvents = [masterEvent, sessionEvent];

    await openNoteForEvent(sessionEvent);

    expect(window.StorageAPI.writeNoteContent).toHaveBeenCalledWith(
      'Notes/gen-note-1.html',
      '<h2>Kickoff Objectives</h2>'
    );
    expect(sessionEvent.noteId).toBe('gen-note-1');
  });

  it('BUG FIX: tags drift detection uses original baseline even after masterEvent tags are updated', async () => {
    const { savePlannerSeriesFromModal } = loadPlannerModule();

    // masterEvent processed first. With scope=unmodified for tags:
    // - masterEvent and evt-matching-baseline both had ['Original'] -> NOT drifted -> should get NewGroup
    // - evt-custom-tags had ['CustomTag'] -> IS drifted -> should be preserved
    // BUG: after masterEvent is updated to NewGroup, evt-matching-baseline compares against NewGroup
    //      and appears drifted, so it gets skipped. FIX: snapshot before loop.
    window.plannerEvents = [
      {
        id: 'evt-master',
        recurrenceId: 'rec-drift-fix-1',
        recurrenceRule: { interval: 1, unit: 'week', until: null },
        date: '2026-09-01',
        startTime: '10:00',
        endTime: '11:00',
        title: 'Weekly Meeting',
        group_tags: ['Original'],
        major_topic_tags: [],
        topic_tags: [],
        collaboratorIds: ['alice']
      },
      {
        id: 'evt-matching-baseline',
        recurrenceId: 'rec-drift-fix-1',
        date: '2026-09-08',
        startTime: '10:00',
        endTime: '11:00',
        title: 'Weekly Meeting',
        group_tags: ['Original'],
        major_topic_tags: [],
        topic_tags: [],
        collaboratorIds: ['alice']
      },
      {
        id: 'evt-custom-tags',
        recurrenceId: 'rec-drift-fix-1',
        date: '2026-09-15',
        startTime: '10:00',
        endTime: '11:00',
        title: 'Weekly Meeting',
        group_tags: ['CustomTag'],
        major_topic_tags: [],
        topic_tags: [],
        collaboratorIds: ['alice']
      }
    ];

    window.manifest = [];

    document.body.innerHTML = `
      <div id="planner-series-modal">
        <input type="text" id="ps-title" value="Weekly Meeting">
        <select id="ps-type"><option value="work" selected>Work</option></select>
        <input type="time" id="ps-start-time" value="10:00">
        <input type="time" id="ps-end-time" value="11:00">
        <input type="checkbox" id="ps-no-end-date" checked>
        <input type="date" id="ps-until-date" value="">
        <select id="ps-note-template"><option value="standard" selected>Standard</option></select>
        <select id="ps-scope-schedule"><option value="all_history" selected>All</option></select>
        <select id="ps-scope-tags"><option value="unmodified" selected>Unmodified only</option></select>
        <select id="ps-scope-collab"><option value="all_history" selected>All</option></select>
        <select id="ps-scope-template"><option value="all_history" selected>All</option></select>
        <input type="checkbox" class="planner-series-session-checkbox" data-event-id="evt-master" checked>
        <input type="checkbox" class="planner-series-session-checkbox" data-event-id="evt-matching-baseline" checked>
        <input type="checkbox" class="planner-series-session-checkbox" data-event-id="evt-custom-tags" checked>
      </div>
    `;

    window.readTagEditor = id => {
      if (id === 'ps-group-tags') return ['NewGroup'];
      return [];
    };

    await savePlannerSeriesFromModal('rec-drift-fix-1');

    const master = window.plannerEvents.find(e => e.id === 'evt-master');
    const matching = window.plannerEvents.find(e => e.id === 'evt-matching-baseline');
    const custom = window.plannerEvents.find(e => e.id === 'evt-custom-tags');

    expect(master.group_tags).toEqual(['NewGroup']);
    expect(matching.group_tags).toEqual(['NewGroup']); // BUG FIX: was wrongly skipped before fix
    expect(custom.group_tags).toEqual(['CustomTag']);
  });

  it('BUG FIX: collaborator drift detection uses original baseline even after masterEvent collab is updated', async () => {
    const { savePlannerSeriesFromModal } = loadPlannerModule();

    window.plannerEvents = [
      {
        id: 'evt-master-c',
        recurrenceId: 'rec-collab-fix-1',
        recurrenceRule: { interval: 1, unit: 'week', until: null },
        date: '2026-09-01',
        startTime: '09:00',
        endTime: '10:00',
        title: 'Sync',
        group_tags: [],
        major_topic_tags: [],
        topic_tags: [],
        collaboratorIds: ['alice', 'bob'],
        collaborators: ['Alice', 'Bob']
      },
      {
        id: 'evt-same-collabs',
        recurrenceId: 'rec-collab-fix-1',
        date: '2026-09-08',
        startTime: '09:00',
        endTime: '10:00',
        title: 'Sync',
        group_tags: [],
        major_topic_tags: [],
        topic_tags: [],
        collaboratorIds: ['alice', 'bob'],
        collaborators: ['Alice', 'Bob']
      },
      {
        id: 'evt-custom-collabs',
        recurrenceId: 'rec-collab-fix-1',
        date: '2026-09-15',
        startTime: '09:00',
        endTime: '10:00',
        title: 'Sync',
        group_tags: [],
        major_topic_tags: [],
        topic_tags: [],
        collaboratorIds: ['alice', 'charlie'],
        collaborators: ['Alice', 'Charlie']
      }
    ];

    window.manifest = [];

    document.body.innerHTML = `
      <div id="planner-series-modal">
        <input type="text" id="ps-title" value="Sync">
        <select id="ps-type"><option value="work" selected>Work</option></select>
        <input type="time" id="ps-start-time" value="09:00">
        <input type="time" id="ps-end-time" value="10:00">
        <input type="checkbox" id="ps-no-end-date" checked>
        <input type="date" id="ps-until-date" value="">
        <select id="ps-note-template"><option value="standard" selected>Standard</option></select>
        <select id="ps-scope-schedule"><option value="all_history" selected>All</option></select>
        <select id="ps-scope-tags"><option value="all_history" selected>All</option></select>
        <select id="ps-scope-collab"><option value="unmodified" selected>Unmodified only</option></select>
        <select id="ps-scope-template"><option value="all_history" selected>All</option></select>
        <input type="checkbox" class="planner-series-session-checkbox" data-event-id="evt-master-c" checked>
        <input type="checkbox" class="planner-series-session-checkbox" data-event-id="evt-same-collabs" checked>
        <input type="checkbox" class="planner-series-session-checkbox" data-event-id="evt-custom-collabs" checked>
      </div>
    `;

    window.readTagEditor = () => [];

    await savePlannerSeriesFromModal('rec-collab-fix-1');

    const master = window.plannerEvents.find(e => e.id === 'evt-master-c');
    const sameColl = window.plannerEvents.find(e => e.id === 'evt-same-collabs');
    const customColl = window.plannerEvents.find(e => e.id === 'evt-custom-collabs');

    expect(master.collaboratorIds).toEqual([]);
    expect(sameColl.collaboratorIds).toEqual([]); // BUG FIX
    expect(customColl.collaboratorIds).toEqual(['alice', 'charlie']);
  });

  it('prunes future events beyond the new until date when a deadline is set', async () => {
    const { savePlannerSeriesFromModal } = loadPlannerModule();

    window.plannerEvents = [
      {
        id: 'evt-past',
        recurrenceId: 'rec-prune-1',
        recurrenceRule: { interval: 1, unit: 'week', until: null },
        date: '2026-09-01',
        startTime: '10:00',
        endTime: '11:00',
        title: 'Meeting',
        group_tags: [], major_topic_tags: [], topic_tags: []
      },
      {
        id: 'evt-within',
        recurrenceId: 'rec-prune-1',
        date: '2026-09-08',
        startTime: '10:00',
        endTime: '11:00',
        title: 'Meeting',
        group_tags: [], major_topic_tags: [], topic_tags: []
      },
      {
        id: 'evt-beyond',
        recurrenceId: 'rec-prune-1',
        date: '2026-11-01',
        startTime: '10:00',
        endTime: '11:00',
        title: 'Meeting',
        group_tags: [], major_topic_tags: [], topic_tags: []
      },
      {
        id: 'evt-other-series',
        recurrenceId: 'OTHER-series',
        date: '2026-11-15',
        startTime: '09:00',
        endTime: '10:00',
        title: 'Other',
        group_tags: [], major_topic_tags: [], topic_tags: []
      }
    ];

    window.manifest = [];

    document.body.innerHTML = `
      <div id="planner-series-modal">
        <input type="text" id="ps-title" value="Meeting">
        <select id="ps-type"><option value="work" selected>Work</option></select>
        <input type="time" id="ps-start-time" value="10:00">
        <input type="time" id="ps-end-time" value="11:00">
        <input type="checkbox" id="ps-no-end-date">
        <input type="date" id="ps-until-date" value="2026-09-30">
        <select id="ps-note-template"><option value="standard" selected>Standard</option></select>
        <select id="ps-scope-schedule"><option value="all_history" selected>All</option></select>
        <select id="ps-scope-tags"><option value="all_history" selected>All</option></select>
        <select id="ps-scope-collab"><option value="all_history" selected>All</option></select>
        <select id="ps-scope-template"><option value="all_history" selected>All</option></select>
      </div>
    `;

    window.readTagEditor = () => [];

    await savePlannerSeriesFromModal('rec-prune-1');

    const ids = window.plannerEvents.map(e => e.id);
    expect(ids).toContain('evt-past');
    expect(ids).toContain('evt-within');
    expect(ids).not.toContain('evt-beyond');
    expect(ids).toContain('evt-other-series');
  });

  it('_togglePlannerSeriesSessionSelection selects and deselects all checkboxes', () => {
    loadPlannerModule();

    document.body.innerHTML = `
      <div id="planner-series-modal">
        <input type="checkbox" class="planner-series-session-checkbox" data-event-id="evt-1" checked>
        <input type="checkbox" class="planner-series-session-checkbox" data-event-id="evt-2" checked>
        <input type="checkbox" class="planner-series-session-checkbox" data-event-id="evt-3">
      </div>
    `;

    window._togglePlannerSeriesSessionSelection(false);
    let checkboxes = document.querySelectorAll('#planner-series-modal .planner-series-session-checkbox');
    checkboxes.forEach(cb => expect(cb.checked).toBe(false));

    window._togglePlannerSeriesSessionSelection(true);
    checkboxes = document.querySelectorAll('#planner-series-modal .planner-series-session-checkbox');
    checkboxes.forEach(cb => expect(cb.checked).toBe(true));
  });

  it('_applyPlannerSeriesGlobalScope sets all 4 scope selects to the given value', () => {
    loadPlannerModule();

    document.body.innerHTML = `
      <div>
        <select id="ps-scope-schedule"><option value="all_history" selected>All</option><option value="coming">Coming</option></select>
        <select id="ps-scope-tags"><option value="all_history" selected>All</option><option value="coming">Coming</option></select>
        <select id="ps-scope-collab"><option value="all_history" selected>All</option><option value="coming">Coming</option></select>
        <select id="ps-scope-template"><option value="all_history" selected>All</option><option value="coming">Coming</option></select>
      </div>
    `;

    window._applyPlannerSeriesGlobalScope('coming');

    expect(document.getElementById('ps-scope-schedule').value).toBe('coming');
    expect(document.getElementById('ps-scope-tags').value).toBe('coming');
    expect(document.getElementById('ps-scope-collab').value).toBe('coming');
    expect(document.getElementById('ps-scope-template').value).toBe('coming');
  });

  it('_plannerSeriesSyncEndFromDuration computes end time from start + duration', () => {
    loadPlannerModule();

    document.body.innerHTML = `
      <div>
        <input type="time" id="ps-start-time" value="09:00">
        <select id="ps-duration"><option value="60" selected>60</option><option value="custom">Custom</option></select>
        <input type="time" id="ps-end-time" value="">
        <div id="ps-end-time-field" style="display:none"></div>
      </div>
    `;

    window._plannerSeriesSyncEndFromDuration();
    expect(document.getElementById('ps-end-time').value).toBe('10:00');
    expect(document.getElementById('ps-end-time-field').style.display).toBe('none');
  });

  it('_plannerSeriesSyncEndFromDuration shows custom end-time field when duration is custom', () => {
    loadPlannerModule();

    document.body.innerHTML = `
      <div>
        <input type="time" id="ps-start-time" value="09:00">
        <select id="ps-duration"><option value="custom" selected>Custom</option></select>
        <input type="time" id="ps-end-time" value="">
        <div id="ps-end-time-field" style="display:none"></div>
      </div>
    `;

    window._plannerSeriesSyncEndFromDuration();
    expect(document.getElementById('ps-end-time-field').style.display).toBe('block');
  });

  it('_plannerSeriesSyncDurationFromEnd computes matching preset duration from start and end', () => {
    loadPlannerModule();

    document.body.innerHTML = `
      <div>
        <input type="time" id="ps-start-time" value="09:00">
        <select id="ps-duration"><option value="30">30</option><option value="60" selected>60</option><option value="90">90</option><option value="custom">Custom</option></select>
        <input type="time" id="ps-end-time" value="09:30">
        <div id="ps-end-time-field" style="display:block"></div>
      </div>
    `;

    window._plannerSeriesSyncDurationFromEnd();
    expect(document.getElementById('ps-duration').value).toBe('30');
    expect(document.getElementById('ps-end-time-field').style.display).toBe('none');
  });

  it('_plannerSeriesSyncDurationFromEnd sets custom when duration not in presets', () => {
    loadPlannerModule();

    document.body.innerHTML = `
      <div>
        <input type="time" id="ps-start-time" value="09:00">
        <select id="ps-duration"><option value="30">30</option><option value="60">60</option><option value="custom">Custom</option></select>
        <input type="time" id="ps-end-time" value="09:40">
        <div id="ps-end-time-field" style="display:none"></div>
      </div>
    `;

    window._plannerSeriesSyncDurationFromEnd();
    expect(document.getElementById('ps-duration').value).toBe('custom');
    expect(document.getElementById('ps-end-time-field').style.display).toBe('block');
  });

  it('deletePlannerSeries removes all events with matching recurrenceId and prep blocks, and calls save', async () => {
    // Provide required globals for the internal savePlanner() and renderPlanner()
    window.normalizePlannerEventsStrict = (events) => ({ events });
    window.broadcastSync = vi.fn();

    const { deletePlannerSeries } = loadPlannerModule();

    // The function checks `typeof showConfirmDialog === 'function'` in its own scope.
    // Inside new Function(), window properties are accessible as globals, so both
    // window.showConfirmDialog and window.confirm need to be set.
    window.showConfirmDialog = vi.fn().mockResolvedValue(true);
    window.confirm = vi.fn().mockReturnValue(true);
    // savePlanner() (module-internal) calls StorageAPI.writePlanner — spy on that
    window.StorageAPI.writePlanner = vi.fn().mockResolvedValue(true);

    window.plannerEvents = [
      { id: 'main-1', recurrenceId: 'rec-del-1', type: 'work', date: '2026-09-01' },
      { id: 'main-2', recurrenceId: 'rec-del-1', type: 'work', date: '2026-09-08' },
      { id: 'prep-1', recurrenceId: 'rec-del-1', type: 'prep', prepForEventId: 'main-1', date: '2026-08-31' },
      { id: 'other-1', recurrenceId: 'OTHER', type: 'work', date: '2026-09-01' }
    ];

    await deletePlannerSeries('rec-del-1');

    // Events correctly filtered: main series + its prep block removed, other series kept
    expect(window.plannerEvents.length).toBe(1);
    expect(window.plannerEvents[0].id).toBe('other-1');
    // savePlanner() was invoked (verified via its side-effect on StorageAPI)
    expect(window.StorageAPI.writePlanner).toHaveBeenCalled();
    // toast is a global, so window.toast spy captures it
    expect(window.toast).toHaveBeenCalled();
  });



  it('deletePlannerSeries does nothing when user cancels the confirmation', async () => {
    const { deletePlannerSeries } = loadPlannerModule();

    window.showConfirmDialog = vi.fn().mockResolvedValue(false);

    window.plannerEvents = [
      { id: 'main-1', recurrenceId: 'rec-del-2', type: 'work', date: '2026-09-01' }
    ];

    const initialLength = window.plannerEvents.length;
    await deletePlannerSeries('rec-del-2');

    expect(window.plannerEvents.length).toBe(initialLength);
    expect(window.savePlanner).not.toHaveBeenCalled();
  });

  it('savePlannerSeriesFromModal applies coming scope only to future events', async () => {
    const { savePlannerSeriesFromModal } = loadPlannerModule();

    const past = '2026-01-01';
    const future = '2030-12-01';

    window.plannerEvents = [
      {
        id: 'evt-past-coming',
        recurrenceId: 'rec-coming-1',
        recurrenceRule: { interval: 1, unit: 'week', until: null },
        date: past,
        startTime: '10:00',
        endTime: '11:00',
        title: 'OldTitle',
        group_tags: [], major_topic_tags: [], topic_tags: []
      },
      {
        id: 'evt-future-coming',
        recurrenceId: 'rec-coming-1',
        date: future,
        startTime: '10:00',
        endTime: '11:00',
        title: 'OldTitle',
        group_tags: [], major_topic_tags: [], topic_tags: []
      }
    ];

    window.manifest = [];

    document.body.innerHTML = `
      <div id="planner-series-modal">
        <input type="text" id="ps-title" value="NewTitle">
        <select id="ps-type"><option value="work" selected>Work</option></select>
        <input type="time" id="ps-start-time" value="10:00">
        <input type="time" id="ps-end-time" value="11:00">
        <input type="checkbox" id="ps-no-end-date" checked>
        <input type="date" id="ps-until-date" value="">
        <select id="ps-note-template"><option value="standard" selected>Standard</option></select>
        <select id="ps-scope-schedule"><option value="coming" selected>Coming</option></select>
        <select id="ps-scope-tags"><option value="all_history" selected>All</option></select>
        <select id="ps-scope-collab"><option value="all_history" selected>All</option></select>
        <select id="ps-scope-template"><option value="all_history" selected>All</option></select>
      </div>
    `;

    window.readTagEditor = () => [];

    await savePlannerSeriesFromModal('rec-coming-1');

    const pastEvt = window.plannerEvents.find(e => e.id === 'evt-past-coming');
    const futureEvt = window.plannerEvents.find(e => e.id === 'evt-future-coming');

    expect(pastEvt.title).toBe('OldTitle');
    expect(futureEvt.title).toBe('NewTitle');
  });

  it('openCreateWorkstreamModal pre-fills topicName, scope and tags from initialData', () => {
    const collabCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-collab.js'), 'utf8');
    const loadCollab = new Function('window', 'document', `
      ${collabCode}
      return { openCreateWorkstreamModal };
    `);
    const collab = loadCollab(window, document);

    window.manifest = [];
    window.escH = s => String(s || '');
    window.escA = s => String(s || '');
    window.toast = vi.fn();
    window.WorkstreamMemoryEngine = { saveMajorTopicMemory: vi.fn() };

    collab.openCreateWorkstreamModal({
      topicName: 'AI Platform',
      scope: 'Build out ML pipeline infrastructure',
      tags: { group: 'Engineering', major: 'AI', topic: 'Platform' }
    });

    const overlay = document.getElementById('modal-create-workstream');
    expect(overlay).not.toBeNull();

    const nameInput = overlay.querySelector('#ws-modal-topic-name');
    expect(nameInput).not.toBeNull();
    expect(nameInput.value).toBe('AI Platform');

    const promptInput = overlay.querySelector('#ws-modal-prompt');
    expect(promptInput).not.toBeNull();
    expect(promptInput.value).toBe('Build out ML pipeline infrastructure');

    overlay.remove();
  });

  it('reproduces bug: saving recurring event correctly persists recurrenceRule, recurrenceId, and precreates occurrences', async () => {
    const { openPlanEventModal } = loadPlannerModule();

    window.plannerEvents = [];
    global.plannerEvents = window.plannerEvents;

    // Open modal to create a new call
    openPlanEventModal({
      title: 'Weekly Standup',
      type: 'call',
      date: '2026-09-14',
      startTime: '10:00',
      endTime: '11:00'
    }, false);

    const modal = document.getElementById('planner-dynamic-modal');
    expect(modal).not.toBeNull();

    // Enable recurrence via the popover checkbox
    const recCheckbox = document.getElementById('pe-recurrence-enabled');
    expect(recCheckbox).not.toBeNull();
    recCheckbox.checked = true;

    const intervalInput = document.getElementById('pe-recurrence-interval');
    if (intervalInput) intervalInput.value = '1';
    const unitSelect = document.getElementById('pe-recurrence-unit');
    if (unitSelect) unitSelect.value = 'week';
    const noEndCheckbox = document.getElementById('pe-recurrence-no-end');
    if (noEndCheckbox) noEndCheckbox.checked = true;

    // Trigger Save
    const saveBtn = modal.querySelector('.modal-actions .btn-save');
    expect(saveBtn).not.toBeNull();
    await saveBtn.onclick();

    // Verify parent event was saved with recurrenceRule & recurrenceId
    const savedEvent = window.plannerEvents.find(e => e.title === 'Weekly Standup' && e.date === '2026-09-14');
    expect(savedEvent).toBeDefined();
    expect(savedEvent.recurrenceRule).toBeDefined();
    expect(savedEvent.recurrenceRule).toEqual({
      interval: 1,
      unit: 'week',
      until: null
    });
    expect(savedEvent.recurrenceId).toBeDefined();
    expect(typeof savedEvent.recurrenceId).toBe('string');
    expect(savedEvent.recurrenceId.startsWith('rec-')).toBe(true);

    // Verify future occurrence was precreated for 2026-09-21 (next Monday)
    const futureOcc = window.plannerEvents.find(e => e.title === 'Weekly Standup' && e.date === '2026-09-21');
    expect(futureOcc).toBeDefined();
    expect(futureOcc.recurrenceId).toBe(savedEvent.recurrenceId);
  });

  it('reproduces bug: normalizePlannerEventsStrict heals missing recurrenceId and links occurrences/prep events', () => {
    const { normalizePlannerEventsStrict } = loadPlannerModule();

    const parent = {
      id: 'parent-1',
      title: 'Team Sync',
      type: 'sync',
      date: '2026-09-14',
      startTime: '09:00',
      endTime: '09:30',
      recurrenceRule: { interval: 1, unit: 'week', until: null }
      // Missing recurrenceId!
    };

    const occurrence = {
      id: 'occ-1',
      title: 'Team Sync',
      type: 'sync',
      date: '2026-09-21',
      startTime: '09:00',
      endTime: '09:30'
      // Missing recurrenceId!
    };

    const prep = {
      id: 'prep-1',
      title: 'Prep: Team Sync',
      type: 'prep',
      date: '2026-09-21',
      startTime: '08:30',
      endTime: '09:00',
      prepForEventId: 'occ-1'
      // Missing recurrenceId!
    };

    const result = normalizePlannerEventsStrict([parent, occurrence, prep]);

    expect(result.mutated).toBe(true);
    const healedParent = result.events.find(e => e.id === 'parent-1');
    const healedOcc = result.events.find(e => e.id === 'occ-1');
    const healedPrep = result.events.find(e => e.id === 'prep-1');

    expect(healedParent.recurrenceId).toBeDefined();
    expect(healedParent.recurrenceId.startsWith('rec-')).toBe(true);
    expect(healedOcc.recurrenceId).toBe(healedParent.recurrenceId);
    expect(healedPrep.recurrenceId).toBe(healedParent.recurrenceId);
  });

  it('reproduces bug: openPlanEventModal displays series banner and hides recurrence button for recurring series instance missing recurrenceId', () => {
    const { openPlanEventModal } = loadPlannerModule();

    // Setup a recurring parent with recurrenceRule (missing recurrenceId) and child occurrence
    window.plannerEvents = [
      {
        id: 'parent-evt',
        recurrenceRule: { interval: 1, unit: 'week', until: null },
        title: 'Sprint Planning',
        type: 'call',
        date: '2026-09-14',
        startTime: '14:00',
        endTime: '15:00'
      },
      {
        id: 'occ-evt',
        title: 'Sprint Planning',
        type: 'call',
        date: '2026-09-21',
        startTime: '14:00',
        endTime: '15:00'
      }
    ];

    // Open modal on the occurrence instance
    openPlanEventModal(window.plannerEvents[1], true);

    const modal = document.getElementById('planner-dynamic-modal');
    expect(modal).not.toBeNull();

    // Series banner must be present
    const seriesBanner = modal.querySelector('.planner-series-notice-banner');
    expect(seriesBanner).not.toBeNull();

    // Standalone recurrence button MUST NOT be present
    const recBtn = modal.querySelector('#pe-recurrence-btn');
    expect(recBtn).toBeNull();
  });

  it('deleting an instance of a series records recurrenceException on the parent event', () => {
    const { deletePlannerEventWithDissolve } = loadPlannerModule();

    const parent = {
      id: 'parent-series',
      recurrenceId: 'rec-del-1',
      recurrenceRule: { interval: 1, unit: 'week', until: null },
      title: 'Weekly 1-on-1',
      type: 'call',
      date: '2026-09-14',
      startTime: '11:00',
      endTime: '11:30'
    };

    const occ = {
      id: 'occ-to-delete',
      recurrenceId: 'rec-del-1',
      title: 'Weekly 1-on-1',
      type: 'call',
      date: '2026-09-21',
      startTime: '11:00',
      endTime: '11:30'
    };

    window.plannerEvents = [parent, occ];

    // Delete occurrence without card animation
    deletePlannerEventWithDissolve('occ-to-delete');

    expect(window.plannerEvents.find(e => e.id === 'occ-to-delete')).toBeUndefined();
    expect(parent.recurrenceExceptions).toContain('2026-09-21');
  });

  it('openPlannerSeriesModal renders recurrence controls with weekday pills and monthly selectors without emoticons', () => {
    const { openPlannerSeriesModal } = loadPlannerModule();

    const master = {
      id: 'evt-rec-render',
      recurrenceId: 'rec-render-1',
      recurrenceRule: { interval: 1, unit: 'week', until: '2026-12-31' },
      title: 'Design Review',
      type: 'sync',
      date: '2026-09-14',
      startTime: '10:00',
      endTime: '11:00'
    };

    window.plannerEvents = [master];

    openPlannerSeriesModal('rec-render-1', 'evt-rec-render');

    const modal = document.getElementById('planner-series-modal');
    expect(modal).not.toBeNull();

    // Verify recurrence inputs
    expect(modal.querySelector('#ps-recurrence-interval')).not.toBeNull();
    expect(modal.querySelector('#ps-recurrence-unit')).not.toBeNull();
    expect(modal.querySelector('#ps-recurrence-weekdays')).not.toBeNull();
    expect(modal.querySelector('#ps-recurrence-monthly-type')).not.toBeNull();
    expect(modal.querySelector('#ps-recurrence-monthly-workday-nth')).not.toBeNull();
    expect(modal.querySelector('#ps-recurrence-monthly-weekday-nth')).not.toBeNull();

    // Verify no emoticons in footer and header buttons
    const footer = modal.querySelector('.planner-series-modal-footer');
    expect(footer).not.toBeNull();
    expect(footer.innerHTML).not.toContain('🗑️');
    expect(footer.innerHTML).not.toContain('💾');
    expect(footer.innerHTML).toContain('<svg');

    const closeBtn = modal.querySelector('.planner-series-modal-header .btn-icon');
    expect(closeBtn.innerHTML).not.toContain('✕');
    expect(closeBtn.innerHTML).toContain('<svg');
  });

  it('savePlannerSeriesFromModal updates recurrence pattern to monthly 3rd workday and updates master event', async () => {
    const { savePlannerSeriesFromModal } = loadPlannerModule();

    const master = {
      id: 'evt-master-m',
      recurrenceId: 'rec-monthly-1',
      recurrenceRule: { interval: 1, unit: 'week', until: null },
      title: 'Monthly Strategy',
      type: 'work',
      date: '2026-09-01',
      startTime: '14:00',
      endTime: '15:00'
    };

    window.plannerEvents = [master];

    // Render series modal DOM with monthly 3rd workday options
    document.body.innerHTML = `
      <div id="planner-series-modal">
        <input type="text" id="ps-title" value="Monthly Strategy">
        <select id="ps-type"><option value="work" selected>Work</option></select>
        <input type="time" id="ps-start-time" value="14:00">
        <input type="time" id="ps-end-time" value="15:00">
        <input type="checkbox" id="ps-no-end-date" checked>
        <input type="date" id="ps-until-date" value="">
        <input type="number" id="ps-recurrence-interval" value="1">
        <select id="ps-recurrence-unit"><option value="month" selected>Month</option></select>
        <select id="ps-recurrence-monthly-type"><option value="nth_workday" selected>Nth Workday</option></select>
        <select id="ps-recurrence-monthly-workday-nth"><option value="3" selected>3rd</option></select>
        <select id="ps-note-template"><option value="standard" selected>Standard</option></select>
        <select id="ps-scope-schedule"><option value="all_history" selected>All</option></select>
        <select id="ps-scope-tags"><option value="all_history" selected>All</option></select>
        <select id="ps-scope-collab"><option value="all_history" selected>All</option></select>
        <select id="ps-scope-template"><option value="all_history" selected>All</option></select>
      </div>
    `;

    await savePlannerSeriesFromModal('rec-monthly-1');

    expect(master.recurrenceRule.unit).toBe('month');
    expect(master.recurrenceRule.monthlyType).toBe('nth_workday');
    expect(master.recurrenceRule.monthlyNth).toBe(3);
  });

  it('detects schedule drift in series modal when an event is shifted off its recurrence rule date', () => {
    const { openPlannerSeriesModal } = loadPlannerModule();

    // Master on Tuesdays (weekdays: [2])
    const master = {
      id: 'evt-drift-master',
      recurrenceId: 'rec-drift-sched',
      recurrenceRule: { interval: 1, unit: 'week', weekdays: [2], until: null },
      title: 'Weekly Sync',
      type: 'sync',
      date: '2026-09-15', // Tuesday
      startTime: '10:00',
      endTime: '11:00'
    };

    // On-schedule child (next Tuesday)
    const onScheduleOcc = {
      id: 'evt-drift-on',
      recurrenceId: 'rec-drift-sched',
      title: 'Weekly Sync',
      type: 'sync',
      date: '2026-09-22', // Tuesday
      startTime: '10:00',
      endTime: '11:00'
    };

    // Drifted child (moved to Wednesday 2026-09-23)
    const offScheduleOcc = {
      id: 'evt-drift-off',
      recurrenceId: 'rec-drift-sched',
      title: 'Weekly Sync',
      type: 'sync',
      date: '2026-09-23', // Wednesday - does not match weekdays: [2]
      startTime: '10:00',
      endTime: '11:00'
    };

    window.plannerEvents = [master, onScheduleOcc, offScheduleOcc];

    openPlannerSeriesModal('rec-drift-sched', 'evt-drift-master');

    const modal = document.getElementById('planner-series-modal');
    expect(modal).not.toBeNull();

    const onCard = modal.querySelector(`[data-event-id="evt-drift-on"]`);
    const offCard = modal.querySelector(`[data-event-id="evt-drift-off"]`);

    expect(onCard).not.toBeNull();
    expect(offCard).not.toBeNull();

    // onCard should show on schedule badge
    const onBadge = onCard.querySelector('.planner-drift-badge');
    expect(onBadge.classList.contains('planner-drift-badge--match')).toBe(true);

    // offCard should show rescheduled/drift badge
    const offBadge = offCard.querySelector('.planner-drift-badge');
    expect(offBadge.classList.contains('planner-drift-badge--override')).toBe(true);
  });

  it('disables scope selects when modal opens and enables them only when respective field changes', () => {
    const { openPlannerSeriesModal, closePlannerSeriesModal } = loadPlannerModule();

    const master = {
      id: 'evt-scope-track-master',
      recurrenceId: 'rec-scope-track-1',
      recurrenceRule: { interval: 1, unit: 'week', until: '2026-12-31' },
      title: 'Design Review',
      type: 'work',
      date: '2026-09-15',
      startTime: '10:00',
      endTime: '11:00',
      group_tags: ['UI'],
      major_topic_tags: [],
      topic_tags: [],
      collaboratorIds: ['alice'],
      collaborators: ['Alice'],
      noteTemplateId: 'standard'
    };

    window.plannerEvents = [master];

    let currentGroupTags = ['UI'];
    let currentMajorTags = [];
    let currentTopicTags = [];
    let currentCollabIds = ['alice'];

    window.readTagEditor = id => {
      if (id === 'ps-group-tags') return [...currentGroupTags];
      if (id === 'ps-major-tags') return [...currentMajorTags];
      if (id === 'ps-topic-tags') return [...currentTopicTags];
      return [];
    };
    window.readCollaboratorMultiPicker = () => [...currentCollabIds];

    openPlannerSeriesModal('rec-scope-track-1', 'evt-scope-track-master');

    const scopeTitle = document.getElementById('ps-scope-title');
    const scopeSchedule = document.getElementById('ps-scope-schedule');
    const scopeTags = document.getElementById('ps-scope-tags');
    const scopeCollab = document.getElementById('ps-scope-collab');
    const scopeTemplate = document.getElementById('ps-scope-template');

    // All dimension scopes must initially be disabled
    expect(scopeTitle.disabled).toBe(true);
    expect(scopeSchedule.disabled).toBe(true);
    expect(scopeTags.disabled).toBe(true);
    expect(scopeCollab.disabled).toBe(true);
    expect(scopeTemplate.disabled).toBe(true);

    // Modify title field
    const titleInput = document.getElementById('ps-title');
    titleInput.value = 'Updated Design Review';
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));

    // Only title scope should now be enabled
    expect(scopeTitle.disabled).toBe(false);
    expect(scopeSchedule.disabled).toBe(true);
    expect(scopeTags.disabled).toBe(true);
    expect(scopeCollab.disabled).toBe(true);
    expect(scopeTemplate.disabled).toBe(true);

    // Modify schedule field
    const startTimeInput = document.getElementById('ps-start-time');
    startTimeInput.value = '11:00';
    startTimeInput.dispatchEvent(new Event('change', { bubbles: true }));

    expect(scopeTitle.disabled).toBe(false);
    expect(scopeSchedule.disabled).toBe(false);

    // Revert title back to original
    titleInput.value = 'Design Review';
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));

    // Title scope becomes disabled again
    expect(scopeTitle.disabled).toBe(true);
    expect(scopeSchedule.disabled).toBe(false);

    closePlannerSeriesModal();
  });

  it('only modifies changed dimensions upon save and preserves untouched dimensions even if sessions are drifted', async () => {
    const { savePlannerSeriesFromModal } = loadPlannerModule();

    const master = {
      id: 'evt-selective-master',
      recurrenceId: 'rec-selective-1',
      recurrenceRule: { interval: 1, unit: 'week', until: '2026-12-31' },
      title: 'Original Title',
      type: 'work',
      date: '2026-09-01',
      startTime: '10:00',
      endTime: '11:00',
      group_tags: ['OriginalTag'],
      major_topic_tags: [],
      topic_tags: [],
      collaboratorIds: ['alice'],
      collaborators: ['Alice'],
      noteTemplateId: 'standard'
    };

    const driftedSession = {
      id: 'evt-selective-drifted',
      recurrenceId: 'rec-selective-1',
      title: 'Original Title',
      type: 'work',
      date: '2026-09-08',
      startTime: '15:00', // Drifted time
      endTime: '16:00',
      group_tags: ['CustomTag'], // Drifted tag
      major_topic_tags: [],
      topic_tags: [],
      collaboratorIds: ['bob'], // Drifted collaborator
      collaborators: ['Bob'],
      noteTemplateId: 'standard'
    };

    window.plannerEvents = [master, driftedSession];
    window.manifest = [];

    // Mock series modal DOM where ONLY ps-title was modified
    document.body.innerHTML = `
      <div id="planner-series-modal">
        <input type="text" id="ps-title" value="New Modified Title">
        <select id="ps-type"><option value="work" selected>Work</option></select>
        <input type="time" id="ps-start-time" value="10:00">
        <input type="time" id="ps-end-time" value="11:00">
        <input type="checkbox" id="ps-no-end-date" checked>
        <input type="date" id="ps-until-date" value="">
        <select id="ps-note-template"><option value="standard" selected>Standard</option></select>
        <select id="ps-scope-title"><option value="all_history" selected>All</option></select>
        <select id="ps-scope-schedule" disabled><option value="all_history" selected>All</option></select>
        <select id="ps-scope-tags" disabled><option value="all_history" selected>All</option></select>
        <select id="ps-scope-collab" disabled><option value="all_history" selected>All</option></select>
        <select id="ps-scope-template" disabled><option value="all_history" selected>All</option></select>
      </div>
    `;

    window.readTagEditor = id => (id === 'ps-group-tags' ? ['OriginalTag'] : []);
    window.readCollaboratorMultiPicker = () => ['alice'];

    await savePlannerSeriesFromModal('rec-selective-1');

    // Title should be updated across all sessions
    expect(master.title).toBe('New Modified Title');
    expect(driftedSession.title).toBe('New Modified Title');

    // Unmodified schedule, tags, and collaborators must NOT be touched or overwritten on drifted sessions
    expect(driftedSession.startTime).toBe('15:00');
    expect(driftedSession.endTime).toBe('16:00');
    expect(driftedSession.group_tags).toEqual(['CustomTag']);
    expect(driftedSession.collaboratorIds).toEqual(['bob']);
    expect(driftedSession.collaborators).toEqual(['Bob']);
  });

  it('renders bloc modal with distinct card groups and places call prep in the schedule section', () => {
    const { openPlanEventModal } = loadPlannerModule();

    const existingEvent = {
      id: 'evt-bloc-card-test',
      title: 'Customer Sync',
      type: 'call',
      date: '2026-09-18',
      startTime: '14:00',
      endTime: '15:00',
      group_tags: ['Sales'],
      major_topic_tags: [],
      topic_tags: [],
      collaborators: []
    };

    window.plannerEvents = [existingEvent];
    window.allGroupTags = ['Sales'];
    window.allMajorTopicTags = [];
    window.allTopicTags = [];

    openPlanEventModal(existingEvent);

    const detailsCard = document.getElementById('pe-section-details');
    const scheduleCard = document.getElementById('pe-section-schedule');
    const contextCard = document.getElementById('pe-section-context');
    const taxonomyCard = document.getElementById('pe-section-taxonomy');

    expect(detailsCard).not.toBeNull();
    expect(scheduleCard).not.toBeNull();
    expect(contextCard).not.toBeNull();
    expect(taxonomyCard).not.toBeNull();

    // The call prep option group should be located inside the schedule/time card
    const prepGroup = document.getElementById('pe-call-options-group');
    expect(prepGroup).not.toBeNull();
    expect(scheduleCard.contains(prepGroup)).toBe(true);

    document.getElementById('planner-dynamic-modal')?.remove();
  });

  it('correctly updates and saves changes when editing an existing bloc (including proposal-originated events)', async () => {
    window.StorageAPI.writePlanner = vi.fn().mockResolvedValue(true);

    const existingEvent = {
      id: 'evt-edit-save-test',
      title: 'Old Title',
      type: 'work',
      date: '2026-09-20',
      startTime: '09:00',
      endTime: '10:00',
      group_tags: ['Dev'],
      major_topic_tags: [],
      topic_tags: [],
      collaborators: [],
      proposalId: 'prop-123'
    };

    window.plannerEvents = [existingEvent];
    window.allGroupTags = ['Dev'];
    window.allMajorTopicTags = [];
    window.allTopicTags = [];

    const { openPlanEventModal } = loadPlannerModule();
    openPlanEventModal(existingEvent);

    // Edit fields in modal
    const titleInput = document.getElementById('pe-title');
    titleInput.value = 'Updated Deep Work Session';

    const startTimeInput = document.getElementById('pe-start-time');
    startTimeInput.value = '09:30';

    const endTimeInput = document.getElementById('pe-end-time');
    endTimeInput.value = '11:00';

    // Click save button in modal
    const saveBtn = document.querySelector('#planner-dynamic-modal .modal-actions .btn-save');
    expect(saveBtn).not.toBeNull();
    saveBtn.click();
    await new Promise(r => setTimeout(r, 50));

    // Verify plannerEvents was updated in place
    expect(window.plannerEvents.length).toBe(1);
    expect(window.plannerEvents[0].id).toBe('evt-edit-save-test');
    expect(window.plannerEvents[0].title).toBe('Updated Deep Work Session');
    expect(window.plannerEvents[0].startTime).toBe('09:30');
    expect(window.plannerEvents[0].endTime).toBe('11:00');
    expect(window.StorageAPI.writePlanner).toHaveBeenCalled();
  });
});


