import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Planner Recurrence Engine & Comprehensive Series Coverage', () => {
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
      if (!str) return null;
      if (str instanceof Date) return str;
      const [y, m, d] = str.split('-').map(Number);
      if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
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
    window.StorageAPI = { writeNoteContent: vi.fn().mockResolvedValue(true), writePlanner: vi.fn().mockResolvedValue(true) };
    window.populateTagEditor = vi.fn();

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
    global.populateTagEditor = window.populateTagEditor;
    global.plannerEvents = window.plannerEvents;
  });

  function loadPlannerModule() {
    const plannerCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-planner.js'), 'utf8');
    const exports = new Function(`
      let plannerContextMenu = null;
      let plannerContextMenuHandlers = null;
      ${plannerCode}
      return {
        shouldEventOccurOnDate,
        precreateRecurringEventsForWeek,
        normalizePlannerEventsStrict,
        openPlanEventModal,
        openPlannerSeriesModal,
        closePlannerSeriesModal,
        savePlannerSeriesFromModal,
        deletePlannerSeries,
        deletePlannerEventWithDissolve,
        togglePlannerRecurrenceEnabled,
        togglePlannerRecurrenceNoEnd,
        updateRecurrenceButtonLabel,
        showPlannerEventContextMenu,
        showPlannerEmptyContextMenu,
        openPlannerRecurrenceOverlay,
        closePlannerRecurrenceOverlay,
        formatPlannerRecurrenceRuleSummary,
        _isPlannerWorkday,
        _getNthWeekdayOfMonth,
        _getNthWorkdayOfMonth,
        _renderPlannerSvgIcon
      };
    `)();
    return exports;
  }

  describe('Algorithm: shouldEventOccurOnDate', () => {
    it('handles daily recurrence intervals and boundaries', () => {
      const { shouldEventOccurOnDate } = loadPlannerModule();

      const dailyParent = {
        date: '2026-09-14',
        recurrenceRule: { interval: 1, unit: 'day', until: null }
      };

      // Every day
      expect(shouldEventOccurOnDate(dailyParent, '2026-09-14')).toBe(true);
      expect(shouldEventOccurOnDate(dailyParent, '2026-09-15')).toBe(true);
      expect(shouldEventOccurOnDate(dailyParent, '2026-09-16')).toBe(true);
      // Prior date returns false
      expect(shouldEventOccurOnDate(dailyParent, '2026-09-13')).toBe(false);

      // Every 2 days
      const every2Days = {
        date: '2026-09-14',
        recurrenceRule: { interval: 2, unit: 'day', until: null }
      };
      expect(shouldEventOccurOnDate(every2Days, '2026-09-14')).toBe(true);
      expect(shouldEventOccurOnDate(every2Days, '2026-09-15')).toBe(false);
      expect(shouldEventOccurOnDate(every2Days, '2026-09-16')).toBe(true);
      expect(shouldEventOccurOnDate(every2Days, '2026-09-17')).toBe(false);
      expect(shouldEventOccurOnDate(every2Days, '2026-09-18')).toBe(true);
    });

    it('handles weekly recurrence intervals and weekday matching', () => {
      const { shouldEventOccurOnDate } = loadPlannerModule();

      // Monday 2026-09-14
      const weeklyParent = {
        date: '2026-09-14',
        recurrenceRule: { interval: 1, unit: 'week', until: null }
      };

      // Exactly 1 week later (Monday 2026-09-21)
      expect(shouldEventOccurOnDate(weeklyParent, '2026-09-21')).toBe(true);
      // 2 weeks later (Monday 2026-09-28)
      expect(shouldEventOccurOnDate(weeklyParent, '2026-09-28')).toBe(true);
      // Different weekday (Tuesday 2026-09-15, Friday 2026-09-25)
      expect(shouldEventOccurOnDate(weeklyParent, '2026-09-15')).toBe(false);
      expect(shouldEventOccurOnDate(weeklyParent, '2026-09-25')).toBe(false);
      // Prior week
      expect(shouldEventOccurOnDate(weeklyParent, '2026-09-07')).toBe(false);

      // Bi-weekly (every 2 weeks)
      const biWeekly = {
        date: '2026-09-14',
        recurrenceRule: { interval: 2, unit: 'week', until: null }
      };
      expect(shouldEventOccurOnDate(biWeekly, '2026-09-14')).toBe(true);
      expect(shouldEventOccurOnDate(biWeekly, '2026-09-21')).toBe(false);
      expect(shouldEventOccurOnDate(biWeekly, '2026-09-28')).toBe(true);
      expect(shouldEventOccurOnDate(biWeekly, '2026-10-05')).toBe(false);
      expect(shouldEventOccurOnDate(biWeekly, '2026-10-12')).toBe(true);
    });

    it('handles monthly recurrence intervals and day-of-month matching', () => {
      const { shouldEventOccurOnDate } = loadPlannerModule();

      const monthlyParent = {
        date: '2026-09-15',
        recurrenceRule: { interval: 1, unit: 'month', until: null }
      };

      // 15th of upcoming months
      expect(shouldEventOccurOnDate(monthlyParent, '2026-10-15')).toBe(true);
      expect(shouldEventOccurOnDate(monthlyParent, '2026-11-15')).toBe(true);
      expect(shouldEventOccurOnDate(monthlyParent, '2026-12-15')).toBe(true);
      expect(shouldEventOccurOnDate(monthlyParent, '2027-01-15')).toBe(true);

      // Different day of month
      expect(shouldEventOccurOnDate(monthlyParent, '2026-10-16')).toBe(false);
      expect(shouldEventOccurOnDate(monthlyParent, '2026-10-14')).toBe(false);

      // Every 3 months (quarterly)
      const quarterly = {
        date: '2026-09-15',
        recurrenceRule: { interval: 3, unit: 'month', until: null }
      };
      expect(shouldEventOccurOnDate(quarterly, '2026-10-15')).toBe(false);
      expect(shouldEventOccurOnDate(quarterly, '2026-11-15')).toBe(false);
      expect(shouldEventOccurOnDate(quarterly, '2026-12-15')).toBe(true); // +3 months
      expect(shouldEventOccurOnDate(quarterly, '2027-03-15')).toBe(true); // +6 months
    });

    it('handles yearly recurrence intervals', () => {
      const { shouldEventOccurOnDate } = loadPlannerModule();

      const yearlyParent = {
        date: '2026-09-15',
        recurrenceRule: { interval: 1, unit: 'year', until: null }
      };

      expect(shouldEventOccurOnDate(yearlyParent, '2027-09-15')).toBe(true);
      expect(shouldEventOccurOnDate(yearlyParent, '2028-09-15')).toBe(true);
      expect(shouldEventOccurOnDate(yearlyParent, '2027-09-14')).toBe(false);
      expect(shouldEventOccurOnDate(yearlyParent, '2027-10-15')).toBe(false);

      // Every 2 years
      const biYearly = {
        date: '2026-09-15',
        recurrenceRule: { interval: 2, unit: 'year', until: null }
      };
      expect(shouldEventOccurOnDate(biYearly, '2027-09-15')).toBe(false);
      expect(shouldEventOccurOnDate(biYearly, '2028-09-15')).toBe(true);
    });

    it('enforces until cutoff date boundaries', () => {
      const { shouldEventOccurOnDate } = loadPlannerModule();

      const limitedParent = {
        date: '2026-09-14',
        recurrenceRule: { interval: 1, unit: 'week', until: '2026-09-28' }
      };

      // Before until
      expect(shouldEventOccurOnDate(limitedParent, '2026-09-21')).toBe(true);
      // Exact until date
      expect(shouldEventOccurOnDate(limitedParent, '2026-09-28')).toBe(true);
      // After until date
      expect(shouldEventOccurOnDate(limitedParent, '2026-10-05')).toBe(false);
    });

    it('returns false for invalid, missing or non-recurring events', () => {
      const { shouldEventOccurOnDate } = loadPlannerModule();

      expect(shouldEventOccurOnDate({}, '2026-09-15')).toBe(false);
      expect(shouldEventOccurOnDate({ recurrenceRule: null }, '2026-09-15')).toBe(false);
      expect(shouldEventOccurOnDate({ recurrenceRule: { unit: 'unknown' } }, '2026-09-15')).toBe(false);
    });
  });

  describe('Precreation Engine: precreateRecurringEventsForWeek', () => {
    it('creates occurrences across requested days and skips parent date', () => {
      const { precreateRecurringEventsForWeek } = loadPlannerModule();

      const parent = {
        id: 'p-1',
        type: 'call',
        title: 'Weekly Sync',
        date: '2026-09-14',
        startTime: '10:00',
        endTime: '11:00',
        recurrenceId: 'rec-series-1',
        recurrenceRule: { interval: 1, unit: 'week', until: null }
      };

      window.plannerEvents = [parent];
      global.plannerEvents = window.plannerEvents;

      const days = ['2026-09-14', '2026-09-15', '2026-09-21', '2026-09-28'];
      precreateRecurringEventsForWeek(days);

      const occurrences = window.plannerEvents.filter(e => e.recurrenceId === 'rec-series-1');
      // Parent + 2 occurrences (2026-09-21, 2026-09-28); 2026-09-14 is parent; 2026-09-15 is not a Monday
      expect(occurrences.length).toBe(3);
      expect(occurrences.map(o => o.date).sort()).toEqual(['2026-09-14', '2026-09-21', '2026-09-28']);
    });

    it('is idempotent: repeated precreation does not duplicate occurrences', () => {
      const { precreateRecurringEventsForWeek } = loadPlannerModule();

      const parent = {
        id: 'p-idem',
        type: 'work',
        title: 'Deep Work Session',
        date: '2026-09-14',
        startTime: '14:00',
        endTime: '16:00',
        recurrenceId: 'rec-idem',
        recurrenceRule: { interval: 1, unit: 'day', until: null }
      };

      window.plannerEvents = [parent];
      global.plannerEvents = window.plannerEvents;

      const days = ['2026-09-14', '2026-09-15', '2026-09-16'];
      // First run
      precreateRecurringEventsForWeek(days);
      expect(window.plannerEvents.length).toBe(3);

      // Second run with same days
      precreateRecurringEventsForWeek(days);
      expect(window.plannerEvents.length).toBe(3);

      // Third run with subset
      precreateRecurringEventsForWeek(['2026-09-15']);
      expect(window.plannerEvents.length).toBe(3);
    });

    it('skips dates listed in parent.recurrenceExceptions', () => {
      const { precreateRecurringEventsForWeek } = loadPlannerModule();

      const parent = {
        id: 'p-except',
        type: 'call',
        title: 'Team Standup',
        date: '2026-09-14',
        startTime: '09:00',
        endTime: '09:30',
        recurrenceId: 'rec-except',
        recurrenceRule: { interval: 1, unit: 'week', until: null },
        recurrenceExceptions: ['2026-09-21'] // Deleted / skipped occurrence
      };

      window.plannerEvents = [parent];
      global.plannerEvents = window.plannerEvents;

      const days = ['2026-09-14', '2026-09-21', '2026-09-28'];
      precreateRecurringEventsForWeek(days);

      const dates = window.plannerEvents.map(e => e.date);
      expect(dates).toContain('2026-09-14');
      expect(dates).not.toContain('2026-09-21'); // Must be skipped
      expect(dates).toContain('2026-09-28');
    });

    it('automatically generates matching prep sessions for created occurrences when parent has linked prep', () => {
      const { precreateRecurringEventsForWeek } = loadPlannerModule();

      const parentCall = {
        id: 'call-parent',
        type: 'call',
        title: 'Executive Review',
        date: '2026-09-14',
        startTime: '10:00',
        endTime: '11:00',
        recurrenceId: 'rec-prep-chain',
        recurrenceRule: { interval: 1, unit: 'week', until: null }
      };

      const parentPrep = {
        id: 'prep-parent',
        type: 'prep',
        title: 'Prep: Executive Review',
        date: '2026-09-14',
        startTime: '09:30',
        endTime: '10:00',
        prepForEventId: 'call-parent',
        recurrenceId: 'rec-prep-chain'
      };

      window.plannerEvents = [parentCall, parentPrep];
      global.plannerEvents = window.plannerEvents;

      precreateRecurringEventsForWeek(['2026-09-21']);

      // Should have generated 1 occurrence call and 1 prep session
      const occCall = window.plannerEvents.find(e => e.type === 'call' && e.date === '2026-09-21');
      const occPrep = window.plannerEvents.find(e => e.type === 'prep' && e.date === '2026-09-21');

      expect(occCall).toBeDefined();
      expect(occPrep).toBeDefined();
      expect(occPrep.prepForEventId).toBe(occCall.id);
      expect(occPrep.recurrenceId).toBe('rec-prep-chain');
      expect(occPrep.title).toBe('Prep: Executive Review');
    });

    it('self-heals missing recurrenceId on parent during precreation', () => {
      const { precreateRecurringEventsForWeek } = loadPlannerModule();

      const parentNoId = {
        id: 'p-no-id',
        type: 'call',
        title: 'Heal Me Call',
        date: '2026-09-14',
        startTime: '11:00',
        endTime: '12:00',
        recurrenceRule: { interval: 1, unit: 'week', until: null }
        // Missing recurrenceId!
      };

      window.plannerEvents = [parentNoId];
      global.plannerEvents = window.plannerEvents;

      precreateRecurringEventsForWeek(['2026-09-21']);

      expect(parentNoId.recurrenceId).toBeDefined();
      expect(parentNoId.recurrenceId.startsWith('rec-')).toBe(true);

      const occ = window.plannerEvents.find(e => e.date === '2026-09-21');
      expect(occ).toBeDefined();
      expect(occ.recurrenceId).toBe(parentNoId.recurrenceId);
    });
  });

  describe('Recurrence UI Controls: Toggles & Labels', () => {
    it('togglePlannerRecurrenceEnabled updates content opacity and pointer events', () => {
      const { togglePlannerRecurrenceEnabled } = loadPlannerModule();

      document.body.innerHTML = `
        <div id="pe-recurrence-overlay-content" style="opacity: 0.5; pointer-events: none;"></div>
      `;

      togglePlannerRecurrenceEnabled(true);
      const content = document.getElementById('pe-recurrence-overlay-content');
      expect(content.style.opacity).toBe('1');
      expect(content.style.pointerEvents).toBe('auto');

      togglePlannerRecurrenceEnabled(false);
      expect(content.style.opacity).toBe('0.5');
      expect(content.style.pointerEvents).toBe('none');
    });

    it('togglePlannerRecurrenceNoEnd toggles disabled property and opacity of until input', () => {
      const { togglePlannerRecurrenceNoEnd } = loadPlannerModule();

      document.body.innerHTML = `
        <input type="date" id="pe-recurrence-until" value="2026-12-31">
      `;

      togglePlannerRecurrenceNoEnd(true);
      const input = document.getElementById('pe-recurrence-until');
      expect(input.disabled).toBe(true);
      expect(input.style.opacity).toBe('0.5');

      togglePlannerRecurrenceNoEnd(false);
      expect(input.disabled).toBe(false);
      expect(input.style.opacity).toBe('1');
    });

    it('updateRecurrenceButtonLabel dynamically formats label and class', () => {
      const { updateRecurrenceButtonLabel } = loadPlannerModule();

      document.body.innerHTML = `
        <button type="button" class="btn" id="pe-recurrence-btn"><span>📅 Recurrence</span></button>
        <input type="checkbox" id="pe-recurrence-enabled" checked>
        <input type="number" id="pe-recurrence-interval" value="2">
        <select id="pe-recurrence-unit">
          <option value="week" selected>week</option>
        </select>
      `;

      updateRecurrenceButtonLabel();
      const btn = document.getElementById('pe-recurrence-btn');
      expect(btn.classList.contains('btn-save')).toBe(true);
      expect(btn.innerHTML).toContain('2');
      expect(btn.innerHTML).toContain('week');

      // Disabled state
      document.getElementById('pe-recurrence-enabled').checked = false;
      updateRecurrenceButtonLabel();
      expect(btn.classList.contains('btn-save')).toBe(false);
    });

    it('backdrop click on recurrence overlay applies settings rather than discarding', () => {
      const { openPlannerRecurrenceOverlay, closePlannerRecurrenceOverlay } = loadPlannerModule();

      document.body.innerHTML = `
        <div class="modal">
          <button type="button" id="pe-recurrence-btn">📅 Recurrence</button>
          <div id="pe-recurrence-overlay" style="display:none;">
            <input type="checkbox" id="pe-recurrence-enabled">
            <div id="pe-recurrence-overlay-content">
              <input type="number" id="pe-recurrence-interval" value="1">
              <select id="pe-recurrence-unit"><option value="week" selected>week</option></select>
              <input type="date" id="pe-recurrence-until" value="">
              <input type="checkbox" id="pe-recurrence-no-end">
            </div>
            <button type="button" class="btn btn-save" onclick="closePlannerRecurrenceOverlay(true)">Apply</button>
            <button type="button" class="btn" onclick="closePlannerRecurrenceOverlay(false)">Cancel</button>
          </div>
        </div>
      `;

      // Open overlay (starts with enabled=false)
      openPlannerRecurrenceOverlay();

      const overlay = document.getElementById('pe-recurrence-overlay');
      const backdrop = document.querySelector('.planner-recurrence-backdrop');
      expect(overlay.style.display).toBe('flex');
      expect(backdrop).not.toBeNull();
      expect(backdrop.style.display).toBe('block');

      // User checks enabled and changes interval to 3
      document.getElementById('pe-recurrence-enabled').checked = true;
      document.getElementById('pe-recurrence-interval').value = '3';

      // User clicks backdrop (clicks outside the popover)
      backdrop.onclick();

      // Overlay should close, and enabled=true and interval=3 should be retained
      expect(overlay.style.display).toBe('none');
      expect(document.getElementById('pe-recurrence-enabled').checked).toBe(true);
      expect(document.getElementById('pe-recurrence-interval').value).toBe('3');
    });
  });

  describe('Modal Transitions & Workflow: openPlanEventModal', () => {
    it('editing non-recurring event to become recurring creates recurrenceId and precreates future occurrences', async () => {
      const { openPlanEventModal } = loadPlannerModule();

      const existingEvent = {
        id: 'evt-to-recur',
        type: 'call',
        title: 'Weekly 1-on-1',
        date: '2026-09-14',
        startTime: '15:00',
        endTime: '15:30'
      };

      window.plannerEvents = [existingEvent];
      global.plannerEvents = window.plannerEvents;

      openPlanEventModal(existingEvent, true);

      const modal = document.getElementById('planner-dynamic-modal');
      expect(modal).not.toBeNull();

      // Configure recurrence via overlay
      document.getElementById('pe-recurrence-enabled').checked = true;
      document.getElementById('pe-recurrence-interval').value = '1';
      document.getElementById('pe-recurrence-unit').value = 'week';
      document.getElementById('pe-recurrence-no-end').checked = true;

      // Click Save
      const saveBtn = modal.querySelector('.modal-actions .btn-save');
      await saveBtn.onclick();

      // Event should now have recurrenceRule and recurrenceId
      const updatedEvent = window.plannerEvents.find(e => e.id === existingEvent.id);
      expect(updatedEvent.recurrenceRule).toEqual({ interval: 1, unit: 'week', until: null });
      expect(updatedEvent.recurrenceId).toBeDefined();
      expect(updatedEvent.recurrenceId.startsWith('rec-')).toBe(true);

      // Future occurrence was precreated for 2026-09-21
      const future = window.plannerEvents.find(e => e.date === '2026-09-21' && e.title === 'Weekly 1-on-1');
      expect(future).toBeDefined();
      expect(future.recurrenceId).toBe(updatedEvent.recurrenceId);
    });

    it('opening a recurring instance displays the series banner and hides the standalone recurrence button', () => {
      const { openPlanEventModal } = loadPlannerModule();

      const parent = {
        id: 'series-p',
        type: 'sync',
        title: 'Daily Standup',
        date: '2026-09-14',
        startTime: '09:00',
        endTime: '09:15',
        recurrenceId: 'rec-daily-1',
        recurrenceRule: { interval: 1, unit: 'day', until: null }
      };

      const occurrence = {
        id: 'series-occ',
        type: 'sync',
        title: 'Daily Standup',
        date: '2026-09-15',
        startTime: '09:00',
        endTime: '09:15',
        recurrenceId: 'rec-daily-1'
      };

      window.plannerEvents = [parent, occurrence];
      global.plannerEvents = window.plannerEvents;

      openPlanEventModal(occurrence, true);

      const modal = document.getElementById('planner-dynamic-modal');
      expect(modal).not.toBeNull();

      // Banner is shown
      const banner = modal.querySelector('.planner-series-notice-banner');
      expect(banner).not.toBeNull();

      // Standalone recurrence button is hidden
      const recBtn = modal.querySelector('#pe-recurrence-btn');
      expect(recBtn).toBeNull();
    });

    it('editing an instance in a series preserves recurrenceId and updates only that block', async () => {
      const { openPlanEventModal } = loadPlannerModule();

      const parent = {
        id: 'series-parent-block',
        type: 'work',
        title: 'Focus Sprint',
        date: '2026-09-14',
        startTime: '10:00',
        endTime: '11:00',
        recurrenceId: 'rec-sprint-series',
        recurrenceRule: { interval: 1, unit: 'week', until: null }
      };

      const occ = {
        id: 'series-occ-block',
        type: 'work',
        title: 'Focus Sprint',
        date: '2026-09-21',
        startTime: '10:00',
        endTime: '11:00',
        recurrenceId: 'rec-sprint-series'
      };

      window.plannerEvents = [parent, occ];
      global.plannerEvents = window.plannerEvents;

      openPlanEventModal(occ, true);

      // Modify the instance title
      const titleInput = document.getElementById('pe-title');
      titleInput.value = 'Focus Sprint - Mid-Sprint Checkpoint';

      const modal = document.getElementById('planner-dynamic-modal');
      const saveBtn = modal.querySelector('.modal-actions .btn-save');
      await saveBtn.onclick();

      // Occ event was updated
      const updatedOcc = window.plannerEvents.find(e => e.id === 'series-occ-block');
      expect(updatedOcc.title).toBe('Focus Sprint - Mid-Sprint Checkpoint');
      // Preserved series ID
      expect(updatedOcc.recurrenceId).toBe('rec-sprint-series');
      // Parent event remained intact
      const updatedParent = window.plannerEvents.find(e => e.id === 'series-parent-block');
      expect(updatedParent.title).toBe('Focus Sprint');
      expect(updatedParent.recurrenceRule).toBeDefined();
    });
  });

  describe('Context Menu: showPlannerEventContextMenu', () => {
    it('displays "Edit Series..." when right clicking recurring event with recurrenceId', () => {
      const { showPlannerEventContextMenu } = loadPlannerModule();

      const recEvent = {
        id: 'ctx-rec-1',
        type: 'call',
        title: 'Weekly 1-on-1',
        date: '2026-09-14',
        startTime: '10:00',
        endTime: '10:30',
        recurrenceId: 'rec-ctx-1',
        recurrenceRule: { interval: 1, unit: 'week', until: null }
      };

      window.plannerEvents = [recEvent];
      global.plannerEvents = window.plannerEvents;

      const dummyE = {
        clientX: 100,
        clientY: 100,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        target: document.createElement('div')
      };
      showPlannerEventContextMenu(dummyE, 'ctx-rec-1');

      const menu = document.querySelector('.planner-ctx-menu');
      expect(menu).not.toBeNull();

      const btnTexts = Array.from(menu.querySelectorAll('.planner-ctx-btn')).map(b => b.textContent);
      const hasEditSeries = btnTexts.some(txt => txt.includes('Edit Series'));
      expect(hasEditSeries).toBe(true);

      menu.remove();
    });

    it('auto-heals recurrenceId and displays "Edit Series..." when parent has recurrenceRule without recurrenceId', () => {
      const { showPlannerEventContextMenu } = loadPlannerModule();

      const parentWithoutRecId = {
        id: 'ctx-rec-heal',
        type: 'call',
        title: 'Weekly Standup',
        date: '2026-09-14',
        startTime: '09:00',
        endTime: '09:30',
        recurrenceRule: { interval: 1, unit: 'week', until: null }
        // Missing recurrenceId!
      };

      window.plannerEvents = [parentWithoutRecId];
      global.plannerEvents = window.plannerEvents;

      const dummyE = {
        clientX: 100,
        clientY: 100,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        target: document.createElement('div')
      };
      showPlannerEventContextMenu(dummyE, 'ctx-rec-heal');

      expect(parentWithoutRecId.recurrenceId).toBeDefined();
      expect(parentWithoutRecId.recurrenceId.startsWith('rec-')).toBe(true);

      const menu = document.querySelector('.planner-ctx-menu');
      expect(menu).not.toBeNull();

      const btnTexts = Array.from(menu.querySelectorAll('.planner-ctx-btn')).map(b => b.textContent);
      const hasEditSeries = btnTexts.some(txt => txt.includes('Edit Series'));
      expect(hasEditSeries).toBe(true);

      menu.remove();
    });

    it('does NOT display "Edit Series..." for non-recurring standalone events', () => {
      const { showPlannerEventContextMenu } = loadPlannerModule();

      const regularEvent = {
        id: 'ctx-regular-1',
        type: 'work',
        title: 'One-off Task',
        date: '2026-09-14',
        startTime: '14:00',
        endTime: '15:00'
      };

      window.plannerEvents = [regularEvent];
      global.plannerEvents = window.plannerEvents;

      const dummyE = {
        clientX: 100,
        clientY: 100,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        target: document.createElement('div')
      };
      showPlannerEventContextMenu(dummyE, 'ctx-regular-1');

      const menu = document.querySelector('.planner-ctx-menu');
      expect(menu).not.toBeNull();

      const btnTexts = Array.from(menu.querySelectorAll('.planner-ctx-btn')).map(b => b.textContent);
      const hasEditSeries = btnTexts.some(txt => txt.includes('Edit Series'));
      expect(hasEditSeries).toBe(false);

      const hasRepeatEvent = btnTexts.some(txt => txt.includes('Repeat') || txt.includes('Wiederholen') || txt.includes('Répéter'));
      expect(hasRepeatEvent).toBe(true);

      menu.remove();
    });

    it('heals child occurrence missing recurrenceId from recurring parent and displays "Edit Series..."', () => {
      const { showPlannerEventContextMenu } = loadPlannerModule();

      const parentEvent = {
        id: 'ctx-parent-series',
        type: 'call',
        title: 'Weekly Alignment',
        date: '2026-09-14',
        startTime: '10:00',
        endTime: '10:30',
        recurrenceId: 'rec-series-align',
        recurrenceRule: { interval: 1, unit: 'week', until: null }
      };

      // Child occurrence that somehow lost or did not have recurrenceId
      const unlinkedOccurrence = {
        id: 'ctx-occ-unlinked',
        type: 'call',
        title: 'Weekly Alignment',
        date: '2026-09-21',
        startTime: '10:00',
        endTime: '10:30'
        // No recurrenceId or recurrenceRule
      };

      window.plannerEvents = [parentEvent, unlinkedOccurrence];
      global.plannerEvents = window.plannerEvents;

      const dummyE = {
        clientX: 100,
        clientY: 100,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        target: document.createElement('div')
      };
      showPlannerEventContextMenu(dummyE, 'ctx-occ-unlinked');

      expect(unlinkedOccurrence.recurrenceId).toBe('rec-series-align');

      const menu = document.querySelector('.planner-ctx-menu');
      expect(menu).not.toBeNull();

      const btnTexts = Array.from(menu.querySelectorAll('.planner-ctx-btn')).map(b => b.textContent);
      const hasEditSeries = btnTexts.some(txt => txt.includes('Edit Series'));
      expect(hasEditSeries).toBe(true);

      menu.remove();
    });

    it('showPlannerEmptyContextMenu provides Recurrence action when right-clicking empty slot', () => {
      const { showPlannerEmptyContextMenu } = loadPlannerModule();

      const dummyE = {
        clientX: 200,
        clientY: 300,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        target: document.createElement('div')
      };
      showPlannerEmptyContextMenu(dummyE, '2026-09-15', '11:00', '12:00');

      const menu = document.querySelector('.planner-ctx-menu');
      expect(menu).not.toBeNull();

      const btns = Array.from(menu.querySelectorAll('.planner-ctx-btn'));
      const recurBtn = btns.find(b => b.textContent.includes('recurrence') || b.textContent.includes('Recurrence') || b.textContent.includes('Wiederholung') || b.textContent.includes('Récurrence'));
      expect(recurBtn).toBeDefined();
      expect(recurBtn.title).toBeDefined();
      expect(recurBtn.title.length).toBeGreaterThan(0);

      menu.remove();
    });
  });

  describe('Dissolution & Exceptions: deletePlannerEventWithDissolve', () => {
    it('records exception on parent event so deleted occurrence is never resurrected', () => {
      const { deletePlannerEventWithDissolve, precreateRecurringEventsForWeek } = loadPlannerModule();

      const parent = {
        id: 'p-dissolve',
        type: 'call',
        title: 'Weekly Alignment',
        date: '2026-09-14',
        startTime: '11:00',
        endTime: '11:30',
        recurrenceId: 'rec-dissolve-1',
        recurrenceRule: { interval: 1, unit: 'week', until: null }
      };

      const occ = {
        id: 'occ-dissolve-to-delete',
        type: 'call',
        title: 'Weekly Alignment',
        date: '2026-09-21',
        startTime: '11:00',
        endTime: '11:30',
        recurrenceId: 'rec-dissolve-1'
      };

      window.plannerEvents = [parent, occ];
      global.plannerEvents = window.plannerEvents;

      deletePlannerEventWithDissolve('occ-dissolve-to-delete');

      // Event deleted from list
      expect(window.plannerEvents.find(e => e.id === 'occ-dissolve-to-delete')).toBeUndefined();
      // Parent recorded exception
      expect(parent.recurrenceExceptions).toContain('2026-09-21');

      // Subsequent precreation run must not recreate the occurrence
      precreateRecurringEventsForWeek(['2026-09-14', '2026-09-21', '2026-09-28']);
      expect(window.plannerEvents.find(e => e.date === '2026-09-21')).toBeUndefined();
      expect(window.plannerEvents.find(e => e.date === '2026-09-28')).toBeDefined();
    });
  });

  describe('Normalization & Multi-Series Isolation: normalizePlannerEventsStrict', () => {
    it('correctly heals multiple distinct recurring series without cross-contamination', () => {
      const { normalizePlannerEventsStrict } = loadPlannerModule();

      // Series 1: Daily Standup (missing recurrenceId on parent and child)
      const series1Parent = {
        id: 's1-p',
        type: 'call',
        title: 'Daily Standup',
        date: '2026-09-14',
        startTime: '09:00',
        endTime: '09:15',
        recurrenceRule: { interval: 1, unit: 'day', until: null }
      };
      const series1Occ = {
        id: 's1-occ',
        type: 'call',
        title: 'Daily Standup',
        date: '2026-09-15',
        startTime: '09:00',
        endTime: '09:15'
      };

      // Series 2: Weekly Review (already has recurrenceId)
      const series2Parent = {
        id: 's2-p',
        type: 'work',
        title: 'Weekly Review',
        date: '2026-09-14',
        startTime: '16:00',
        endTime: '17:00',
        recurrenceId: 'rec-existing-s2',
        recurrenceRule: { interval: 1, unit: 'week', until: null }
      };
      const series2Occ = {
        id: 's2-occ',
        type: 'work',
        title: 'Weekly Review',
        date: '2026-09-21',
        startTime: '16:00',
        endTime: '17:00'
        // Missing recurrenceId on occ
      };

      const result = normalizePlannerEventsStrict([series1Parent, series1Occ, series2Parent, series2Occ]);

      expect(result.mutated).toBe(true);

      const healedS1P = result.events.find(e => e.id === 's1-p');
      const healedS1Occ = result.events.find(e => e.id === 's1-occ');
      const healedS2P = result.events.find(e => e.id === 's2-p');
      const healedS2Occ = result.events.find(e => e.id === 's2-occ');

      // Series 1 parent got newly generated recurrenceId and propagated to child
      expect(healedS1P.recurrenceId).toBeDefined();
      expect(healedS1P.recurrenceId.startsWith('rec-')).toBe(true);
      expect(healedS1Occ.recurrenceId).toBe(healedS1P.recurrenceId);

      // Series 2 preserved existing recurrenceId and propagated to child
      expect(healedS2P.recurrenceId).toBe('rec-existing-s2');
      expect(healedS2Occ.recurrenceId).toBe('rec-existing-s2');

      // No cross-contamination
      expect(healedS1P.recurrenceId).not.toBe(healedS2P.recurrenceId);
    });
  });

  describe('Flexible Recurrence Patterns: Weekdays, Workdays & Monthly Rules', () => {
    it('accurately calculates weekly recurrence on a specific weekday (e.g. Tuesday)', () => {
      const { shouldEventOccurOnDate } = loadPlannerModule();

      // Parent event defined on Monday 2026-09-14, but rule specifies recurrence every week on Tuesday (day 2)
      const tuesdayParent = {
        date: '2026-09-14', // Monday
        recurrenceRule: { interval: 1, unit: 'week', weekdays: [2], until: null }
      };

      expect(shouldEventOccurOnDate(tuesdayParent, '2026-09-14')).toBe(false); // Monday
      expect(shouldEventOccurOnDate(tuesdayParent, '2026-09-15')).toBe(true);  // Tuesday
      expect(shouldEventOccurOnDate(tuesdayParent, '2026-09-16')).toBe(false); // Wednesday
      expect(shouldEventOccurOnDate(tuesdayParent, '2026-09-22')).toBe(true);  // Next Tuesday
      expect(shouldEventOccurOnDate(tuesdayParent, '2026-09-29')).toBe(true);  // 3rd Tuesday
      expect(shouldEventOccurOnDate(tuesdayParent, '2026-10-06')).toBe(true);  // 4th Tuesday
    });

    it('supports multi-weekday recurrence (e.g. Monday, Wednesday, Friday)', () => {
      const { shouldEventOccurOnDate } = loadPlannerModule();

      const mwfParent = {
        date: '2026-09-14', // Monday
        recurrenceRule: { interval: 1, unit: 'week', weekdays: [1, 3, 5], until: null }
      };

      // Week 1
      expect(shouldEventOccurOnDate(mwfParent, '2026-09-14')).toBe(true);  // Mon
      expect(shouldEventOccurOnDate(mwfParent, '2026-09-15')).toBe(false); // Tue
      expect(shouldEventOccurOnDate(mwfParent, '2026-09-16')).toBe(true);  // Wed
      expect(shouldEventOccurOnDate(mwfParent, '2026-09-17')).toBe(false); // Thu
      expect(shouldEventOccurOnDate(mwfParent, '2026-09-18')).toBe(true);  // Fri
      expect(shouldEventOccurOnDate(mwfParent, '2026-09-19')).toBe(false); // Sat
      expect(shouldEventOccurOnDate(mwfParent, '2026-09-20')).toBe(false); // Sun

      // Week 2
      expect(shouldEventOccurOnDate(mwfParent, '2026-09-21')).toBe(true);  // Mon
      expect(shouldEventOccurOnDate(mwfParent, '2026-09-23')).toBe(true);  // Wed
      expect(shouldEventOccurOnDate(mwfParent, '2026-09-25')).toBe(true);  // Fri
    });

    it('supports bi-weekly multi-weekday recurrence', () => {
      const { shouldEventOccurOnDate } = loadPlannerModule();

      const biWeeklyParent = {
        date: '2026-09-14', // Monday
        recurrenceRule: { interval: 2, unit: 'week', weekdays: [2, 4], until: null }
      };

      // Week 0: matches Tue & Thu
      expect(shouldEventOccurOnDate(biWeeklyParent, '2026-09-15')).toBe(true); // Tue
      expect(shouldEventOccurOnDate(biWeeklyParent, '2026-09-17')).toBe(true); // Thu

      // Week 1: skipped (interval: 2)
      expect(shouldEventOccurOnDate(biWeeklyParent, '2026-09-22')).toBe(false); // Tue
      expect(shouldEventOccurOnDate(biWeeklyParent, '2026-09-24')).toBe(false); // Thu

      // Week 2: matches again
      expect(shouldEventOccurOnDate(biWeeklyParent, '2026-09-29')).toBe(true); // Tue
      expect(shouldEventOccurOnDate(biWeeklyParent, '2026-10-01')).toBe(true); // Thu
    });

    it('supports daily workdays only recurrence (Mon-Fri only)', () => {
      const { shouldEventOccurOnDate, _isPlannerWorkday } = loadPlannerModule();

      expect(_isPlannerWorkday(new Date(2026, 8, 14))).toBe(true);  // Mon
      expect(_isPlannerWorkday(new Date(2026, 8, 18))).toBe(true);  // Fri
      expect(_isPlannerWorkday(new Date(2026, 8, 19))).toBe(false); // Sat
      expect(_isPlannerWorkday(new Date(2026, 8, 20))).toBe(false); // Sun

      const workdayParent = {
        date: '2026-09-14', // Monday
        recurrenceRule: { interval: 1, unit: 'day', workdaysOnly: true, until: null }
      };

      expect(shouldEventOccurOnDate(workdayParent, '2026-09-14')).toBe(true);  // Mon
      expect(shouldEventOccurOnDate(workdayParent, '2026-09-15')).toBe(true);  // Tue
      expect(shouldEventOccurOnDate(workdayParent, '2026-09-16')).toBe(true);  // Wed
      expect(shouldEventOccurOnDate(workdayParent, '2026-09-17')).toBe(true);  // Thu
      expect(shouldEventOccurOnDate(workdayParent, '2026-09-18')).toBe(true);  // Fri
      expect(shouldEventOccurOnDate(workdayParent, '2026-09-19')).toBe(false); // Sat
      expect(shouldEventOccurOnDate(workdayParent, '2026-09-20')).toBe(false); // Sun
      expect(shouldEventOccurOnDate(workdayParent, '2026-09-21')).toBe(true);  // Mon
    });

    it('supports monthly recurrence on the Nth work day (e.g. 3rd work day and last work day)', () => {
      const { shouldEventOccurOnDate, _getNthWorkdayOfMonth } = loadPlannerModule();

      // September 2026:
      // Sept 1 = Tue (workday 1)
      // Sept 2 = Wed (workday 2)
      // Sept 3 = Thu (workday 3)
      // Sept 30 = Wed (last workday)
      expect(_getNthWorkdayOfMonth(2026, 8, 1)).toBe(1);
      expect(_getNthWorkdayOfMonth(2026, 8, 2)).toBe(2);
      expect(_getNthWorkdayOfMonth(2026, 8, 3)).toBe(3);
      expect(_getNthWorkdayOfMonth(2026, 8, -1)).toBe(30);

      // October 2026:
      // Oct 1 = Thu (workday 1)
      // Oct 2 = Fri (workday 2)
      // Oct 3 = Sat (weekend)
      // Oct 4 = Sun (weekend)
      // Oct 5 = Mon (workday 3)
      // Oct 31 = Sat -> Oct 30 = Fri (last workday)
      expect(_getNthWorkdayOfMonth(2026, 9, 3)).toBe(5);
      expect(_getNthWorkdayOfMonth(2026, 9, -1)).toBe(30);

      const thirdWorkdayParent = {
        date: '2026-09-01',
        recurrenceRule: { interval: 1, unit: 'month', monthlyType: 'nth_workday', monthlyNth: 3, until: null }
      };

      expect(shouldEventOccurOnDate(thirdWorkdayParent, '2026-09-03')).toBe(true);
      expect(shouldEventOccurOnDate(thirdWorkdayParent, '2026-09-04')).toBe(false);
      expect(shouldEventOccurOnDate(thirdWorkdayParent, '2026-10-05')).toBe(true);
      expect(shouldEventOccurOnDate(thirdWorkdayParent, '2026-10-03')).toBe(false);

      const lastWorkdayParent = {
        date: '2026-09-01',
        recurrenceRule: { interval: 1, unit: 'month', monthlyType: 'nth_workday', monthlyNth: -1, until: null }
      };

      expect(shouldEventOccurOnDate(lastWorkdayParent, '2026-09-30')).toBe(true);
      expect(shouldEventOccurOnDate(lastWorkdayParent, '2026-10-30')).toBe(true);
      expect(shouldEventOccurOnDate(lastWorkdayParent, '2026-10-31')).toBe(false);
    });

    it('supports monthly recurrence on the Nth weekday (e.g. 3rd Tuesday)', () => {
      const { shouldEventOccurOnDate, _getNthWeekdayOfMonth } = loadPlannerModule();

      // September 2026: 1st Tue=1, 2nd Tue=8, 3rd Tue=15, 4th Tue=22
      expect(_getNthWeekdayOfMonth(2026, 8, 1, 2)).toBe(1);
      expect(_getNthWeekdayOfMonth(2026, 8, 2, 2)).toBe(8);
      expect(_getNthWeekdayOfMonth(2026, 8, 3, 2)).toBe(15);
      expect(_getNthWeekdayOfMonth(2026, 8, 4, 2)).toBe(22);
      expect(_getNthWeekdayOfMonth(2026, 8, -1, 2)).toBe(29); // Last Tue

      // October 2026: 1st Tue=6, 2nd Tue=13, 3rd Tue=20
      expect(_getNthWeekdayOfMonth(2026, 9, 3, 2)).toBe(20);

      const thirdTuesdayParent = {
        date: '2026-09-01',
        recurrenceRule: { interval: 1, unit: 'month', monthlyType: 'nth_weekday', monthlyNth: 3, monthlyWeekday: 2, until: null }
      };

      expect(shouldEventOccurOnDate(thirdTuesdayParent, '2026-09-15')).toBe(true);
      expect(shouldEventOccurOnDate(thirdTuesdayParent, '2026-09-08')).toBe(false);
      expect(shouldEventOccurOnDate(thirdTuesdayParent, '2026-10-20')).toBe(true);
      expect(shouldEventOccurOnDate(thirdTuesdayParent, '2026-10-13')).toBe(false);
    });

    it('generates clean, localized recurrence summaries via formatPlannerRecurrenceRuleSummary without emojis', () => {
      const { formatPlannerRecurrenceRuleSummary } = loadPlannerModule();

      // Daily workdays
      const dailyWorkdays = formatPlannerRecurrenceRuleSummary({ interval: 1, unit: 'day', workdaysOnly: true });
      expect(dailyWorkdays).toBe('planner.everyWorkday');

      // Weekly on Tuesday
      const weeklyTue = formatPlannerRecurrenceRuleSummary({ interval: 1, unit: 'week', weekdays: [2] }, '2026-09-14');
      expect(weeklyTue).toContain('setupWizard.dayTueFull');
      expect(weeklyTue).not.toMatch(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}]/u);

      // Monthly on 3rd workday
      const monthlyWorkday = formatPlannerRecurrenceRuleSummary({ interval: 1, unit: 'month', monthlyType: 'nth_workday', monthlyNth: 3 });
      expect(monthlyWorkday).toContain('planner.nthThird');
      expect(monthlyWorkday).toContain('planner.workdayLabel');

      // Monthly on last workday
      const monthlyLastWorkday = formatPlannerRecurrenceRuleSummary({ interval: 1, unit: 'month', monthlyType: 'nth_workday', monthlyNth: -1 });
      expect(monthlyLastWorkday).toContain('planner.nthLast');
      expect(monthlyLastWorkday).toContain('planner.workdayLabel');

      // Monthly on 3rd Tuesday
      const monthlyWeekday = formatPlannerRecurrenceRuleSummary({ interval: 1, unit: 'month', monthlyType: 'nth_weekday', monthlyNth: 3, monthlyWeekday: 2 });
      expect(monthlyWeekday).toContain('planner.nthThird');
      expect(monthlyWeekday).toContain('setupWizard.dayTueFull');
    });

    it('verifies SVG icons render with vector tags without emoticons', () => {
      const { _renderPlannerSvgIcon } = loadPlannerModule();

      const repeatSvg = _renderPlannerSvgIcon('repeat', 14);
      expect(repeatSvg).toContain('<svg');
      expect(repeatSvg).toContain('width="14"');
      expect(repeatSvg).toContain('height="14"');
      expect(repeatSvg).not.toContain('🔁');

      const trashSvg = _renderPlannerSvgIcon('trash', 14);
      expect(trashSvg).toContain('<svg');
      expect(trashSvg).not.toContain('🗑️');

      const saveSvg = _renderPlannerSvgIcon('save', 14);
      expect(saveSvg).toContain('<svg');
      expect(saveSvg).not.toContain('💾');
    });

    it('updating recurrence pattern in savePlannerSeriesFromModal reschedules upcoming occurrences to new weekdays', async () => {
      const { savePlannerSeriesFromModal, precreateRecurringEventsForWeek } = loadPlannerModule();

      const master = {
        id: 'evt-master-shift',
        recurrenceId: 'rec-shift-1',
        recurrenceRule: { interval: 1, unit: 'week', until: null }, // defaults to Mon
        title: 'Weekly Standup',
        type: 'call',
        date: '2026-09-14', // Monday
        startTime: '09:00',
        endTime: '09:30'
      };

      const occMon1 = {
        id: 'evt-occ-mon1',
        recurrenceId: 'rec-shift-1',
        title: 'Weekly Standup',
        type: 'call',
        date: '2026-10-12', // upcoming Monday
        startTime: '09:00',
        endTime: '09:30'
      };

      window.plannerEvents = [master, occMon1];

      // Setup DOM modal state to change recurrence to Tuesday (day 2)
      document.body.innerHTML = `
        <div id="planner-series-modal">
          <input type="text" id="ps-title" value="Weekly Standup">
          <select id="ps-type"><option value="call" selected>Call</option></select>
          <input type="time" id="ps-start-time" value="09:00">
          <input type="time" id="ps-end-time" value="09:30">
          <input type="checkbox" id="ps-no-end-date" checked>
          <input type="date" id="ps-until-date" value="">
          <input type="number" id="ps-recurrence-interval" value="1">
          <select id="ps-recurrence-unit"><option value="week" selected>Week</option></select>
          <div id="ps-recurrence-weekdays">
            <button type="button" class="planner-weekday-pill" data-day="1">Mon</button>
            <button type="button" class="planner-weekday-pill active" data-day="2">Tue</button>
          </div>
          <select id="ps-note-template"><option value="standard" selected>Standard</option></select>
          <select id="ps-scope-schedule"><option value="all_history" selected>All</option></select>
          <select id="ps-scope-tags"><option value="all_history" selected>All</option></select>
          <select id="ps-scope-collab"><option value="all_history" selected>All</option></select>
          <select id="ps-scope-template"><option value="all_history" selected>All</option></select>
        </div>
      `;

      await savePlannerSeriesFromModal('rec-shift-1');

      // Master rule must now specify Tuesday
      expect(master.recurrenceRule.weekdays).toEqual([2]);

      // Old upcoming Monday occurrence must be pruned
      expect(window.plannerEvents.find(e => e.id === 'evt-occ-mon1')).toBeUndefined();

      // New upcoming Tuesday occurrences must be precreated for the horizon
      const tueOcc = window.plannerEvents.find(e => e.recurrenceId === 'rec-shift-1' && (e.date === '2026-10-13' || e.date === '2026-09-15' || e.date === '2026-09-22'));
      expect(tueOcc).toBeDefined();
      expect(tueOcc.title).toBe('Weekly Standup');
      expect(tueOcc.startTime).toBe('09:00');
    });
  });
});
