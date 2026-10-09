import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Planner Non-Neighbouring Day Gap Separator', () => {
  let plannerCode;
  let plannerCss;

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    plannerCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-planner.js'), 'utf8');
    plannerCss = fs.readFileSync(path.resolve(__dirname, '../../css/app-planner.css'), 'utf8');
  });

  function createPlannerEnvironment(config = {}) {
    // Create DOM container elements
    const panel = document.createElement('div');
    panel.id = 'planner-panel';
    panel.innerHTML = `
      <div id="planner-week-range-title"></div>
      <div id="planner-grid-body" class="planner-calendar-grid"></div>
    `;
    document.body.appendChild(panel);

    const workingDays = config.workingDays || [1, 2, 3, 4, 5];
    const viewMode = config.viewMode || '5days';
    const weekStart = config.weekStart || new Date(2026, 9, 7); // Wednesday Oct 7, 2026
    const displayOverride = config.displayOverride || null;

    const env = new Function(`
      window.plannerEvents = [];
      window.todosManifest = [];
      window.selectedPlannerEventId = null;
      window.plannerRightSidebarCollapsed = false;
      window.plannerActivePaneTab = 'unassigned';
      window.plannerRightPaneWidth = 320;
      window.plannerViewMode = ${JSON.stringify(viewMode)};
      window.currentPlannerWeekStart = new Date(${weekStart.getTime()});
      window.plannerDisplayDateOverride = ${JSON.stringify(displayOverride)};
      window.plannerInitialFocusDate = null;
      window.plannerDaysCount = 5;
      window.plannerWorkingDays = ${JSON.stringify(workingDays)};
      window.currentLang = 'en';
      window.workStartTime = '09:00';
      window.workEndTime = '18:30';
      window.plannerContextMenu = null;
      window.plannerContextMenuHandlers = [];
      window._reviewedDates = new Set();
      window.isDailyReviewDateReviewed = function() { return false; };
      window.getAppLocale = function() { return 'en-US'; };
      window.closePlannerContextMenu = function() {};
      window.parseLocalDateValue = function(s) {
        if (!s) return null;
        if (s instanceof Date) return s;
        const parts = String(s).split('-');
        if (parts.length === 3) {
          return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        }
        return new Date(s);
      };
      window.formatLocalDateValue = function(d) {
        if (!d) return '';
        if (typeof d === 'string') return d;
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return year + '-' + month + '-' + day;
      };
      window.getPlannerUnassignedTodos = function() { return []; };
      window.getPlannerNotDoneTodos = function() { return []; };
      window.getPlannerWeeklyStats = function() { return { totalHours: 0, callHours: 0, workHours: 0, prepHours: 0 }; };
      window._plannerTypeFilter = null;
      window._plannerSidePriorityFilter = 'All';
      window._plannerSideSearchQuery = '';
      window.getNoteById = function() { return null; };
      window.getTodoById = function() { return null; };
      window.getIntrinsicAssociatedNotesForPlannerEvent = function() { return []; };
      window.getRelatedNotesForTags = function() { return []; };
      window.getPlannerEventLinkedTodoIds = function() { return []; };
      window.plannerEventSupportsNoteAction = function() { return false; };
      window.editPlannerEvent = function() {};
      window.deletePlannerEvent = function() {};
      window.startDailyReview = function() {};
      window._getPlannerIsoWeekNumber = function() { return 41; };
      window.minutesToTime = function(m) {
        const h = Math.floor(m / 60);
        const min = m % 60;
        return String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
      };
      window.timeToMinutes = function(t) {
        if (!t) return 0;
        const p = t.split(':').map(Number);
        return (p[0] || 0) * 60 + (p[1] || 0);
      };
      window._getDayCapacity = function() { return { plannedMins: 0, availableMins: 480 }; };
      window.t = function(k) {
        const dict = {
          'week.dayNames': ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
          'planner.capacityTooltip': '{planned}/{available}h',
          'planner.planTimeSlot': 'Plan at {time}'
        };
        return dict[k] || k;
      };
      window.escA = function(s) { return String(s || '').replace(/"/g, '&quot;'); };
      window.escH = function(s) { return String(s || '').replace(/</g, '&lt;'); };
      window.jq = function(s) { return JSON.stringify(s); };

      ${plannerCode}

      return {
        hasPlannerDayGap: (typeof hasPlannerDayGap === 'function') ? hasPlannerDayGap : window.hasPlannerDayGap,
        getPlannerDaysToDisplay: (typeof getPlannerDaysToDisplay === 'function') ? getPlannerDaysToDisplay : window.getPlannerDaysToDisplay,
        renderCalendarGrid: (typeof renderCalendarGrid === 'function') ? renderCalendarGrid : window.renderCalendarGrid
      };
    `)();

    return env;
  }

  it('hasPlannerDayGap correctly detects non-neighbouring calendar dates', () => {
    const env = createPlannerEnvironment();
    expect(typeof env.hasPlannerDayGap).toBe('function');

    // Consecutive calendar days (1 day difference) -> false
    const wed = new Date(2026, 9, 7);
    const thu = new Date(2026, 9, 8);
    const fri = new Date(2026, 9, 9);
    expect(env.hasPlannerDayGap(wed, thu)).toBe(false);
    expect(env.hasPlannerDayGap(thu, fri)).toBe(false);

    // Weekend gap: Friday to Monday (3 days difference) -> true
    const mon = new Date(2026, 9, 12);
    expect(env.hasPlannerDayGap(fri, mon)).toBe(true);

    // 1 day skipped: Tuesday to Thursday (2 days difference) -> true
    const tue = new Date(2026, 9, 6);
    expect(env.hasPlannerDayGap(tue, thu)).toBe(true);

    // String date format support
    expect(env.hasPlannerDayGap('2026-10-09', '2026-10-12')).toBe(true);
    expect(env.hasPlannerDayGap('2026-10-08', '2026-10-09')).toBe(false);

    // Invalid or backwards cases -> false
    expect(env.hasPlannerDayGap(null, fri)).toBe(false);
    expect(env.hasPlannerDayGap(fri, null)).toBe(false);
    expect(env.hasPlannerDayGap(fri, fri)).toBe(false);
    expect(env.hasPlannerDayGap(mon, fri)).toBe(false);
  });

  it('renders a larger border (planner-day-gap) between Friday and Monday in 5-day view with Mon-Fri work week', () => {
    // Start on Wednesday Oct 7, 2026.
    // Displayed 5 working days: Wed Oct 7, Thu Oct 8, Fri Oct 9, Mon Oct 12, Tue Oct 13.
    const env = createPlannerEnvironment({
      viewMode: '5days',
      workingDays: [1, 2, 3, 4, 5],
      weekStart: new Date(2026, 9, 7)
    });

    const days = env.getPlannerDaysToDisplay();
    expect(days).toHaveLength(5);
    expect(days.map(d => d.getDay())).toEqual([3, 4, 5, 1, 2]); // Wed, Thu, Fri, Mon, Tue

    env.renderCalendarGrid();

    const headerCells = document.querySelectorAll('.planner-header-cell');
    const dayCols = document.querySelectorAll('.planner-day-col');

    expect(headerCells).toHaveLength(5);
    expect(dayCols).toHaveLength(5);

    // Days 0, 1, 2 (Wed, Thu, Fri) should NOT have planner-day-gap
    expect(headerCells[0].classList.contains('planner-day-gap')).toBe(false);
    expect(dayCols[0].classList.contains('planner-day-gap')).toBe(false);
    expect(headerCells[1].classList.contains('planner-day-gap')).toBe(false);
    expect(dayCols[1].classList.contains('planner-day-gap')).toBe(false);
    expect(headerCells[2].classList.contains('planner-day-gap')).toBe(false);
    expect(dayCols[2].classList.contains('planner-day-gap')).toBe(false);

    // Day 3 (Monday Oct 12, following the weekend) MUST have planner-day-gap and data-has-day-gap="true"
    expect(headerCells[3].classList.contains('planner-day-gap')).toBe(true);
    expect(dayCols[3].classList.contains('planner-day-gap')).toBe(true);
    expect(headerCells[3].getAttribute('data-has-day-gap')).toBe('true');
    expect(dayCols[3].getAttribute('data-has-day-gap')).toBe('true');

    // Day 4 (Tuesday Oct 13, neighbouring Monday) should NOT have planner-day-gap
    expect(headerCells[4].classList.contains('planner-day-gap')).toBe(false);
    expect(dayCols[4].classList.contains('planner-day-gap')).toBe(false);
  });

  it('generally supports arbitrary work day schedules (e.g. Wednesday off: Mon, Tue, Thu, Fri, Mon)', () => {
    // Working days: Mon(1), Tue(2), Thu(4), Fri(5). Wednesday(3) and Sat/Sun are off.
    // Start Monday Oct 5, 2026.
    // Displayed 5 days: Mon Oct 5, Tue Oct 6, Thu Oct 8, Fri Oct 9, Mon Oct 12.
    const env = createPlannerEnvironment({
      viewMode: '5days',
      workingDays: [1, 2, 4, 5],
      weekStart: new Date(2026, 9, 5)
    });

    const days = env.getPlannerDaysToDisplay();
    expect(days).toHaveLength(5);
    expect(days.map(d => d.getDay())).toEqual([1, 2, 4, 5, 1]);

    env.renderCalendarGrid();

    const headerCells = document.querySelectorAll('.planner-header-cell');
    const dayCols = document.querySelectorAll('.planner-day-col');

    // Mon (idx 0): first day -> no gap
    expect(headerCells[0].classList.contains('planner-day-gap')).toBe(false);
    expect(dayCols[0].classList.contains('planner-day-gap')).toBe(false);

    // Tue (idx 1): consecutive -> no gap
    expect(headerCells[1].classList.contains('planner-day-gap')).toBe(false);
    expect(dayCols[1].classList.contains('planner-day-gap')).toBe(false);

    // Thu (idx 2): Wednesday skipped -> HAS GAP!
    expect(headerCells[2].classList.contains('planner-day-gap')).toBe(true);
    expect(dayCols[2].classList.contains('planner-day-gap')).toBe(true);

    // Fri (idx 3): consecutive to Thu -> no gap
    expect(headerCells[3].classList.contains('planner-day-gap')).toBe(false);
    expect(dayCols[3].classList.contains('planner-day-gap')).toBe(false);

    // Mon (idx 4): Sat & Sun skipped -> HAS GAP!
    expect(headerCells[4].classList.contains('planner-day-gap')).toBe(true);
    expect(dayCols[4].classList.contains('planner-day-gap')).toBe(true);
  });

  it('does not add planner-day-gap when all 7 days are active working days and consecutive', () => {
    const env = createPlannerEnvironment({
      viewMode: '5days',
      workingDays: [0, 1, 2, 3, 4, 5, 6],
      weekStart: new Date(2026, 9, 7) // Wed
    });

    const days = env.getPlannerDaysToDisplay();
    expect(days).toHaveLength(5);
    // Wed, Thu, Fri, Sat, Sun are all consecutive
    expect(days.map(d => d.getDay())).toEqual([3, 4, 5, 6, 0]);

    env.renderCalendarGrid();

    const gappedHeaders = document.querySelectorAll('.planner-header-cell.planner-day-gap');
    const gappedCols = document.querySelectorAll('.planner-day-col.planner-day-gap');

    expect(gappedHeaders).toHaveLength(0);
    expect(gappedCols).toHaveLength(0);
  });

  it('defines prominent border styling for planner-day-gap in app-planner.css', () => {
    // Check that CSS defines a larger border for planner-day-gap
    expect(plannerCss).toContain('.planner-day-gap');
    // Ensure the border is larger than standard 1px (e.g. 3px, 3.5px, or 4px)
    const match = plannerCss.match(/\.planner-(?:header-cell|day-col)\.planner-day-gap[^{]*\{([^}]+)\}/);
    expect(match).not.toBeNull();
    const rules = match[1];
    expect(rules).toMatch(/border-left(?:-width)?:\s*(3px|3\.5px|4px)/);
  });
});
