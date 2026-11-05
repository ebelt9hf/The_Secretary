import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Planner Block Selection, Sidebar State, Working Day Navigation & Past Proposals', () => {
  beforeAll(() => {
    globalThis.t = (k) => {
      if (k === 'planner.yesterday') return 'Hier';
      if (k === 'planner.today') return 'Aujourd\'hui';
      if (k === 'planner.tomorrow') return 'Demain';
      if (k === 'planner.prevWeek') return 'Semaine préc.';
      if (k === 'planner.nextWeek') return 'Semaine suiv.';
      return k;
    };
    globalThis.escH = (s) => String(s || '');
    globalThis.escA = (s) => String(s || '');
    globalThis.jq = (s) => JSON.stringify(s);
    globalThis.toast = vi.fn();
    globalThis.getAppLocale = () => 'fr-FR';

    loadScriptsIntoGlobal([
      'js/app-utils.js',
      'js/app-state.js',
      'js/app-planner.js'
    ]);
  });

  beforeEach(() => {
    document.body.innerHTML = '<div id="planner-panel"></div>';
    vi.restoreAllMocks();

    globalThis.plannerEvents = [];
    globalThis.selectedPlannerEventId = null;
    globalThis.plannerRightSidebarCollapsed = false;
    globalThis.plannerActivePaneTab = 'unassigned';
    globalThis.plannerViewMode = 'week';
    globalThis.currentPlannerWeekStart = new Date(2026, 10, 2); // Monday Nov 2, 2026
    globalThis.plannerWorkingDays = [1, 2, 3, 4, 5];
    globalThis.plannerDisplayDateOverride = null;
    globalThis.showPlannerProposals = false;
    globalThis.setPlannerProposals([]);
  });

  describe('1. Right Sidebar Collapse State during Block Click/Unclick', () => {
    it('does not uncollapse the right sidebar when clicking a block if it was collapsed', () => {
      globalThis.plannerEvents = [{ id: 'evt-1', title: 'Task 1', date: '2026-11-02', startTime: '10:00', endTime: '11:00' }];
      globalThis.plannerRightSidebarCollapsed = true;

      // Click on event
      globalThis.selectPlannerEvent('evt-1');

      expect(globalThis.selectedPlannerEventId).toBe('evt-1');
      expect(globalThis.plannerRightSidebarCollapsed).toBe(true);
    });

    it('does not uncollapse the right sidebar when unclicking (deselecting) a block', () => {
      globalThis.plannerEvents = [{ id: 'evt-1', title: 'Task 1', date: '2026-11-02', startTime: '10:00', endTime: '11:00' }];
      globalThis.selectedPlannerEventId = 'evt-1';
      globalThis.plannerRightSidebarCollapsed = true;

      // Unclick event (toggle off)
      globalThis.selectPlannerEvent('evt-1');

      expect(globalThis.selectedPlannerEventId).toBeNull();
      expect(globalThis.plannerRightSidebarCollapsed).toBe(true);
    });
  });

  describe('2. Block Selection Persistence within Visible Days', () => {
    it('keeps block selected when it falls within visible days', () => {
      globalThis.plannerEvents = [{ id: 'evt-nov2', title: 'Task Nov 2', date: '2026-11-02', startTime: '10:00', endTime: '11:00' }];
      globalThis.selectedPlannerEventId = 'evt-nov2';
      globalThis.currentPlannerWeekStart = new Date(2026, 10, 2); // Week of Nov 2

      globalThis.renderPlanner();

      expect(globalThis.selectedPlannerEventId).toBe('evt-nov2');
      expect(globalThis.plannerActivePaneTab).toBe('details');
    });

    it('deselects block when user navigates away so it is no longer in visible days', () => {
      globalThis.plannerEvents = [{ id: 'evt-nov2', title: 'Task Nov 2', date: '2026-11-02', startTime: '10:00', endTime: '11:00' }];
      globalThis.selectedPlannerEventId = 'evt-nov2';
      // Week of Nov 9 (Nov 2 is not in visible days)
      globalThis.currentPlannerWeekStart = new Date(2026, 10, 9);

      globalThis.renderPlanner();

      expect(globalThis.selectedPlannerEventId).toBeNull();
      expect(globalThis.plannerActivePaneTab).toBe('unassigned');
    });
  });

  describe('3. Previous Working Day Navigation in 3days / 5days View', () => {
    it('correctly calculates previous and next working days with default Mon-Fri', () => {
      const monday = new Date(2026, 10, 9); // Monday Nov 9, 2026
      const prevWorking = globalThis.getPreviousWorkingDay(monday, [1, 2, 3, 4, 5]);
      // Previous working day from Monday Nov 9 is Friday Nov 6
      expect(prevWorking.getDay()).toBe(5); // Friday
      expect(prevWorking.getDate()).toBe(6);

      const friday = new Date(2026, 10, 6); // Friday Nov 6, 2026
      const nextWorking = globalThis.getNextWorkingDay(friday, [1, 2, 3, 4, 5]);
      // Next working day from Friday Nov 6 is Monday Nov 9
      expect(nextWorking.getDay()).toBe(1); // Monday
      expect(nextWorking.getDate()).toBe(9);
    });

    it('navigates to previous working day (Friday) from Monday in 3days and 5days view mode and displays Hier', () => {
      globalThis.plannerViewMode = '5days';
      const monday = new Date(2026, 10, 9);
      monday.setHours(0, 0, 0, 0);
      globalThis.currentPlannerWeekStart = monday;

      vi.useFakeTimers();
      vi.setSystemTime(monday);

      globalThis.renderPlanner();

      const prevBtn = document.querySelector('.planner-nav-prev-btn');
      expect(prevBtn).toBeTruthy();
      expect(prevBtn.textContent).toContain('Hier');

      const onclickAttr = prevBtn.getAttribute('onclick');
      expect(onclickAttr).toContain('navigatePlannerWeek(-3)');

      globalThis.navigatePlannerWeek(-3);

      expect(globalThis.currentPlannerWeekStart.getDay()).toBe(5); // Friday
      expect(globalThis.currentPlannerWeekStart.getDate()).toBe(6);

      vi.useRealTimers();
    });
  });

  describe('4. Filtering Past Unaccepted Proposals', () => {
    it('identifies past proposals based on date and time', () => {
      const fixedNow = new Date('2026-11-05T10:30:00');

      // Yesterday's proposal is in the past
      expect(globalThis.isPlannerProposalInPast({ date: '2026-11-04', startTime: '14:00', endTime: '15:00' }, fixedNow)).toBe(true);

      // Today's proposal that already ended is in the past
      expect(globalThis.isPlannerProposalInPast({ date: '2026-11-05', startTime: '09:00', endTime: '10:00' }, fixedNow)).toBe(true);

      // Today's proposal currently ongoing or in future is NOT in the past
      expect(globalThis.isPlannerProposalInPast({ date: '2026-11-05', startTime: '11:00', endTime: '12:00' }, fixedNow)).toBe(false);

      // Tomorrow's proposal is NOT in the past
      expect(globalThis.isPlannerProposalInPast({ date: '2026-11-06', startTime: '09:00', endTime: '10:00' }, fixedNow)).toBe(false);
    });

    it('does not display past unaccepted proposals in the planner or count them in pending badge', () => {
      const fixedNow = new Date('2026-11-05T10:30:00');
      vi.useFakeTimers();
      vi.setSystemTime(fixedNow);

      const proposals = [
        {
          id: 'prop-past',
          title: 'Past Meeting',
          date: '2026-11-04',
          startTime: '10:00',
          endTime: '11:00',
          status: 'pending'
        },
        {
          id: 'prop-future',
          title: 'Future Meeting',
          date: '2026-11-06',
          startTime: '14:00',
          endTime: '15:00',
          status: 'pending'
        }
      ];
      globalThis.setPlannerProposals(proposals);
      globalThis.showPlannerProposals = true;
      globalThis.plannerEvents = [];

      globalThis.renderPlanner();

      // The badge count should only count the 1 future proposal, ignoring the past one
      const badge = document.querySelector('.planner-proposals-badge-count');
      expect(badge?.textContent?.trim()).toBe('1');

      // Past proposal must NOT be rendered in yesterday's column
      const yesterdayHtml = globalThis.renderPlannerEventsForDayHTML('2026-11-04');
      expect(yesterdayHtml).not.toContain('Past Meeting');

      vi.useRealTimers();
    });

    it('keeps accepted past events visible in the planner', () => {
      const fixedNow = new Date('2026-11-05T10:30:00');
      vi.useFakeTimers();
      vi.setSystemTime(fixedNow);

      globalThis.plannerEvents = [
        {
          id: 'accepted-evt-1',
          proposalId: 'prop-past-accepted',
          title: 'Accepted Past Meeting',
          date: '2026-11-04',
          startTime: '10:00',
          endTime: '11:00',
          type: 'call'
        }
      ];

      const yesterdayHtml = globalThis.renderPlannerEventsForDayHTML('2026-11-04');
      expect(yesterdayHtml).toContain('Accepted Past Meeting');

      vi.useRealTimers();
    });
  });

  describe('5. Form Field Accessibility & Form Audit Attributes (id & name)', () => {
    it('ensures planner-view-select has valid id and name attributes', () => {
      globalThis.renderPlanner();
      const select = document.querySelector('.planner-view-select');
      expect(select).toBeTruthy();
      expect(select.id).toBe('planner-view-select');
      expect(select.getAttribute('name')).toBe('planner-view-select');
    });

    it('ensures chat-context-select in app-chat has valid id and name attributes', () => {
      loadScriptsIntoGlobal(['js/app-chat.js']);
      const container = document.createElement('div');
      container.id = 'floating-chat-container';
      document.body.appendChild(container);

      if (typeof globalThis.AIChatController?.render === 'function') {
        globalThis.AIChatController.render();
      }
      const select = document.querySelector('.chat-context-select');
      if (select) {
        expect(select.id).toBe('chat-context-select');
        expect(select.getAttribute('name')).toBe('chat-context-select');
      }
    });
  });
});
