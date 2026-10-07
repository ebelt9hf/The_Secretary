import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Planner Series Instance Moving & Exception Tracking', () => {
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
      const clamped = Math.max(0, Math.min(1439, mins));
      const h = Math.floor(clamped / 60);
      const m = clamped % 60;
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
    window.broadcastSync = vi.fn();
    global.broadcastSync = window.broadcastSync;
    window.manifest = [];
    window.saveManifest = vi.fn();
    window.plannerEvents = [];
    window.todosManifest = [];
    window.StorageAPI = {
      writeNoteContent: vi.fn().mockResolvedValue(true),
      writePlanner: vi.fn().mockResolvedValue(true)
    };
    window.populateTagEditor = vi.fn();
    window.pruneUnusedAutoCreatedColleagues = vi.fn();
    global.pruneUnusedAutoCreatedColleagues = window.pruneUnusedAutoCreatedColleagues;
    global.workStartTime = '09:00';
    global.workEndTime = '18:30';
    global.plannerWorkingDays = [1, 2, 3, 4, 5];
    global.selectedPlannerEventId = null;
    window.workStartTime = '09:00';
    window.workEndTime = '18:30';
    window.plannerWorkingDays = [1, 2, 3, 4, 5];
    window.selectedPlannerEventId = null;
    window.getPlannerDaysToDisplay = () => [
      new Date(2026, 8, 14),
      new Date(2026, 8, 15),
      new Date(2026, 8, 16),
      new Date(2026, 8, 17),
      new Date(2026, 8, 18),
      new Date(2026, 8, 19),
      new Date(2026, 8, 20),
      new Date(2026, 8, 21),
      new Date(2026, 8, 22),
      new Date(2026, 8, 28)
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
    global.populateTagEditor = window.populateTagEditor;
    global.plannerEvents = window.plannerEvents;
    window._lastPlannerDropTs = 0;
  });

  function loadPlannerModule() {
    const plannerCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-planner.js'), 'utf8');
    const exports = new Function(`
      ${plannerCode}
      return {
        handlePlannerDayColDrop: async (...args) => {
          window._lastPlannerDropTs = null;
          plannerEvents = window.plannerEvents;
          const res = await handlePlannerDayColDrop(...args);
          window.plannerEvents = plannerEvents;
          return res;
        },
        shiftPlannerSelectedEventDay: (...args) => {
          plannerEvents = window.plannerEvents;
          const res = shiftPlannerSelectedEventDay(...args);
          window.plannerEvents = plannerEvents;
          return res;
        },
        precreateRecurringEventsForWeek: (...args) => {
          plannerEvents = window.plannerEvents;
          const res = precreateRecurringEventsForWeek(...args);
          window.plannerEvents = plannerEvents;
          return res;
        },
        openPlanEventModal: (...args) => {
          plannerEvents = window.plannerEvents;
          const res = openPlanEventModal(...args);
          window.plannerEvents = plannerEvents;
          return res;
        },
        shouldEventOccurOnDate
      };
    `)();
    return exports;
  }

  it('moving a series occurrence to another date does NOT duplicate the event on subsequent precreation', async () => {
    const { handlePlannerDayColDrop, precreateRecurringEventsForWeek } = loadPlannerModule();

    const parent = {
      id: 'p-series-1',
      type: 'call',
      title: 'Weekly Team Sync',
      date: '2026-09-14',
      startTime: '10:00',
      endTime: '11:00',
      recurrenceId: 'rec-sync-1',
      recurrenceRule: { interval: 1, unit: 'week', until: null }
    };

    const occ = {
      id: 'occ-sync-2',
      type: 'call',
      title: 'Weekly Team Sync',
      date: '2026-09-21',
      startTime: '10:00',
      endTime: '11:00',
      recurrenceId: 'rec-sync-1'
    };

    window.plannerEvents = [parent, occ];
    global.plannerEvents = window.plannerEvents;

    // Simulate drop onto Tuesday 2026-09-22
    const fakeDropEvent = {
      preventDefault: vi.fn(),
      currentTarget: {
        getBoundingClientRect: () => ({ top: 0, height: 1000 })
      },
      clientY: 200, // around 12:30
      dataTransfer: {
        getData: (fmt) => JSON.stringify({ type: 'event-item', eventId: 'occ-sync-2', offsetY: 0 })
      }
    };

    await handlePlannerDayColDrop(fakeDropEvent, '2026-09-22');

    // Verify the moved occurrence is now on 2026-09-22
    expect(occ.date).toBe('2026-09-22');

    // Run precreation for the week (as happens on render)
    precreateRecurringEventsForWeek(['2026-09-14', '2026-09-21', '2026-09-22', '2026-09-28']);

    // 2026-09-21 MUST NOT have a duplicated event generated!
    const eventsOn21 = window.plannerEvents.filter(e => e.date === '2026-09-21' && e.recurrenceId === 'rec-sync-1');
    expect(eventsOn21.length).toBe(0);

    // 2026-09-22 must have exactly the 1 moved occurrence
    const eventsOn22 = window.plannerEvents.filter(e => e.date === '2026-09-22' && e.recurrenceId === 'rec-sync-1');
    expect(eventsOn22.length).toBe(1);
    expect(eventsOn22[0].id).toBe('occ-sync-2');

    // 2026-09-28 must have its newly created occurrence
    const eventsOn28 = window.plannerEvents.filter(e => e.date === '2026-09-28' && e.recurrenceId === 'rec-sync-1');
    expect(eventsOn28.length).toBe(1);
  });

  it('shiftPlannerSelectedEventDay moves a series occurrence without duplicating', () => {
    const { shiftPlannerSelectedEventDay, precreateRecurringEventsForWeek } = loadPlannerModule();

    const parent = {
      id: 'p-series-2',
      type: 'work',
      title: 'Focus Sprint',
      date: '2026-09-14',
      startTime: '14:00',
      endTime: '16:00',
      recurrenceId: 'rec-focus-2',
      recurrenceRule: { interval: 1, unit: 'week', until: null }
    };

    const occ = {
      id: 'occ-focus-2',
      type: 'work',
      title: 'Focus Sprint',
      date: '2026-09-21',
      startTime: '14:00',
      endTime: '16:00',
      recurrenceId: 'rec-focus-2'
    };

    window.plannerEvents = [parent, occ];
    global.plannerEvents = window.plannerEvents;
    window.selectedPlannerEventId = 'occ-focus-2';
    global.selectedPlannerEventId = 'occ-focus-2';

    // Shift +1 day to 2026-09-22
    shiftPlannerSelectedEventDay(1);

    expect(occ.date).toBe('2026-09-22');

    precreateRecurringEventsForWeek(['2026-09-14', '2026-09-21', '2026-09-22', '2026-09-28']);

    const eventsOn21 = window.plannerEvents.filter(e => e.date === '2026-09-21' && e.recurrenceId === 'rec-focus-2');
    expect(eventsOn21.length).toBe(0);

    const eventsOn22 = window.plannerEvents.filter(e => e.date === '2026-09-22' && e.recurrenceId === 'rec-focus-2');
    expect(eventsOn22.length).toBe(1);
  });

  it('moving a series parent/master event records exception and retains recurrence schedule', async () => {
    const { handlePlannerDayColDrop, precreateRecurringEventsForWeek } = loadPlannerModule();

    const parent = {
      id: 'p-series-3',
      type: 'call',
      title: 'Strategy Session',
      date: '2026-09-14',
      startTime: '09:00',
      endTime: '10:00',
      recurrenceId: 'rec-strat-3',
      recurrenceRule: { interval: 1, unit: 'week', until: null }
    };

    window.plannerEvents = [parent];
    global.plannerEvents = window.plannerEvents;

    // Move master from Monday 2026-09-14 to Wednesday 2026-09-16
    const fakeDropEvent = {
      preventDefault: vi.fn(),
      currentTarget: {
        getBoundingClientRect: () => ({ top: 0, height: 1000 })
      },
      clientY: 100,
      dataTransfer: {
        getData: () => JSON.stringify({ type: 'event-item', eventId: 'p-series-3', offsetY: 0 })
      }
    };

    await handlePlannerDayColDrop(fakeDropEvent, '2026-09-16');

    expect(parent.date).toBe('2026-09-16');

    // Run precreation
    precreateRecurringEventsForWeek(['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-21', '2026-09-28']);

    // 2026-09-14 must NOT have duplicate recreated
    const eventsOn14 = window.plannerEvents.filter(e => e.date === '2026-09-14' && e.recurrenceId === 'rec-strat-3');
    expect(eventsOn14.length).toBe(0);

    // 2026-09-16 has the moved parent
    const eventsOn16 = window.plannerEvents.filter(e => e.date === '2026-09-16' && e.recurrenceId === 'rec-strat-3');
    expect(eventsOn16.length).toBe(1);

    // Future Mondays (2026-09-21 and 2026-09-28) still receive their generated occurrences
    const eventsOn21 = window.plannerEvents.filter(e => e.date === '2026-09-21' && e.recurrenceId === 'rec-strat-3');
    expect(eventsOn21.length).toBe(1);

    const eventsOn28 = window.plannerEvents.filter(e => e.date === '2026-09-28' && e.recurrenceId === 'rec-strat-3');
    expect(eventsOn28.length).toBe(1);
  });

  it('moving an occurrence away and moving it back clears the exception cleanly', async () => {
    const { handlePlannerDayColDrop, precreateRecurringEventsForWeek } = loadPlannerModule();

    const parent = {
      id: 'p-series-4',
      type: 'call',
      title: 'Design Review',
      date: '2026-09-14',
      startTime: '15:00',
      endTime: '16:00',
      recurrenceId: 'rec-design-4',
      recurrenceRule: { interval: 1, unit: 'week', until: null }
    };

    const occ = {
      id: 'occ-design-4',
      type: 'call',
      title: 'Design Review',
      date: '2026-09-21',
      startTime: '15:00',
      endTime: '16:00',
      recurrenceId: 'rec-design-4'
    };

    window.plannerEvents = [parent, occ];
    global.plannerEvents = window.plannerEvents;

    // 1. Move to 2026-09-23
    window._lastPlannerDropTs = 0;
    global._lastPlannerDropTs = 0;
    await handlePlannerDayColDrop({
      preventDefault: vi.fn(),
      currentTarget: { getBoundingClientRect: () => ({ top: 0, height: 1000 }) },
      clientY: 100,
      dataTransfer: { getData: () => JSON.stringify({ type: 'event-item', eventId: 'occ-design-4', offsetY: 0 }) }
    }, '2026-09-23');

    expect(occ.date).toBe('2026-09-23');
    expect(parent.recurrenceExceptions).toContain('2026-09-21');

    // 2. Move back to 2026-09-21
    window._lastPlannerDropTs = 0;
    global._lastPlannerDropTs = 0;
    const res2 = await handlePlannerDayColDrop({
      preventDefault: vi.fn(),
      currentTarget: { getBoundingClientRect: () => ({ top: 0, height: 1000 }) },
      clientY: 100,
      dataTransfer: { getData: () => JSON.stringify({ type: 'event-item', eventId: 'occ-design-4', offsetY: 0 }) }
    }, '2026-09-21');

    const updatedOcc = window.plannerEvents.find(e => e.id === 'occ-design-4');
    const updatedParent = window.plannerEvents.find(e => e.id === 'p-series-4');
    expect(updatedOcc.date).toBe('2026-09-21');
    expect(updatedParent.recurrenceExceptions || []).not.toContain('2026-09-21');

    precreateRecurringEventsForWeek(['2026-09-14', '2026-09-21', '2026-09-28']);

    const eventsOn21 = window.plannerEvents.filter(e => e.date === '2026-09-21' && e.recurrenceId === 'rec-design-4');
    expect(eventsOn21.length).toBe(1);
    expect(eventsOn21[0].id).toBe('occ-design-4');
  });

  it('editing single series instance date in modal dialog records exception and prevents duplication', async () => {
    const { openPlanEventModal, precreateRecurringEventsForWeek } = loadPlannerModule();

    const parent = {
      id: 'p-series-5',
      type: 'call',
      title: 'Monthly All-Hands',
      date: '2026-09-14',
      startTime: '10:00',
      endTime: '11:00',
      recurrenceId: 'rec-allhands-5',
      recurrenceRule: { interval: 1, unit: 'week', until: null }
    };

    const occ = {
      id: 'occ-allhands-5',
      type: 'call',
      title: 'Monthly All-Hands',
      date: '2026-09-21',
      startTime: '10:00',
      endTime: '11:00',
      recurrenceId: 'rec-allhands-5'
    };

    window.plannerEvents = [parent, occ];
    global.plannerEvents = window.plannerEvents;

    openPlanEventModal(occ);

    const modal = document.getElementById('planner-dynamic-modal');
    expect(modal).not.toBeNull();

    // Change date field to 2026-09-22
    const dateInput = document.getElementById('pe-date');
    if (dateInput) dateInput.value = '2026-09-22';

    // Click Save
    const saveBtn = modal.querySelector('.modal-actions .btn-save');
    expect(saveBtn).not.toBeNull();
    await saveBtn.onclick();

    const updatedParent = window.plannerEvents.find(e => e.id === 'p-series-5');
    expect(updatedParent).toBeDefined();
    expect(updatedParent.recurrenceExceptions).toBeDefined();
    expect(updatedParent.recurrenceExceptions).toContain('2026-09-21');

    precreateRecurringEventsForWeek(['2026-09-14', '2026-09-21', '2026-09-22', '2026-09-28']);

    const eventsOn21 = window.plannerEvents.filter(e => e.date === '2026-09-21' && e.recurrenceId === 'rec-allhands-5');
    expect(eventsOn21.length).toBe(0);

    const eventsOn22 = window.plannerEvents.filter(e => e.date === '2026-09-22' && e.recurrenceId === 'rec-allhands-5');
    expect(eventsOn22.length).toBe(1);
  });
});
