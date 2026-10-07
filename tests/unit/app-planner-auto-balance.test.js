import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('PlannerScheduler Future Slot and Auto-Balance', () => {
  let PlannerScheduler;
  let timeToMinutes;
  let minutesToTime;
  let formatLocalDateValue;

  beforeEach(() => {
    const plannerCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-planner.js'), 'utf8');

    const fn = new Function(`
      window.plannerEvents = [];
      window.todosManifest = [];
      window.workStartTime = '09:00';
      window.workEndTime = '18:30';
      window.defaultPlannerDuration = 30;
      window.plannerWorkingDays = [1, 2, 3, 4, 5];
      window.plannerViewMode = 'week';
      window.currentPlannerWeekStart = new Date(2026, 8, 2); // Wednesday Sept 2, 2026
      window.t = function(k, params) {
        if (k === 'planner.autoBalanceSuccess' && params?.count) {
          return 'Scheduled ' + params.count + ' tasks into open calendar slots!';
        }
        return k;
      };
      window.escA = function(s) { return String(s || '').replace(/"/g, '&quot;'); };
      window.escH = function(s) { return String(s || '').replace(/</g, '&lt;'); };
      window.jq = function(s) { return JSON.stringify(s); };
      window.toast = function() {};
      window.pushPlannerUndoState = function() {};
      window.savePlanner = async function() {};
      window.renderPlanner = function() {};
      window.formatLocalDateValue = function(d) {
        if (!d) return '';
        const date = (d instanceof Date) ? d : new Date(d);
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return y + '-' + m + '-' + day;
      };
      window.parseLocalDateValue = function(s) {
        if (!s) return null;
        const [y, m, d] = s.split('-').map(Number);
        return new Date(y, m - 1, d);
      };
      window.isUserTask = function(t) { return true; };
      window.getCleanTaskTitle = function(t) { return t.title || 'Task'; };

      ${plannerCode}

      return {
        PlannerScheduler,
        timeToMinutes,
        minutesToTime,
        formatLocalDateValue: window.formatLocalDateValue,
        openPlannerAutoBalanceModal,
        triggerPlannerAutoBalance
      };
    `);

    const exports = fn();
    PlannerScheduler = exports.PlannerScheduler;
    timeToMinutes = exports.timeToMinutes;
    minutesToTime = exports.minutesToTime;
    formatLocalDateValue = exports.formatLocalDateValue;
    window.openPlannerAutoBalanceModal = exports.openPlannerAutoBalanceModal;
    window.triggerPlannerAutoBalance = exports.triggerPlannerAutoBalance;
  });

  it('never returns gaps for a date in the past when futureOnly is true', () => {
    // Simulated "now" is Sept 2, 2026 at 14:00
    const mockNow = new Date(2026, 8, 2, 14, 0); // 2026-09-02 14:00
    const pastDateStr = '2026-09-01'; // Yesterday

    const gaps = PlannerScheduler.findAvailableGaps(pastDateStr, '09:00', '18:30', [], {
      futureOnly: true,
      now: mockNow
    });

    expect(gaps).toEqual([]);
  });

  it('clamps gaps for today so they start at or after current time', () => {
    // Simulated "now" is Sept 2, 2026 at 14:07 -> next 15m slot is 14:15 (855 mins)
    const mockNow = new Date(2026, 8, 2, 14, 7);
    const todayStr = '2026-09-02';

    const gaps = PlannerScheduler.findAvailableGaps(todayStr, '09:00', '18:30', [], {
      futureOnly: true,
      now: mockNow
    });

    expect(gaps.length).toBeGreaterThan(0);
    // The earliest gap on today MUST start at or after 14:15 (855 mins)
    expect(gaps[0].startMins).toBeGreaterThanOrEqual(855);
    expect(gaps[0].startTime).toBe('14:15');
    // None of the gaps may start in the past
    for (const g of gaps) {
      expect(g.startMins).toBeGreaterThanOrEqual(855);
    }
  });

  it('returns empty gaps if today work hours have already ended', () => {
    // Simulated "now" is Sept 2, 2026 at 19:30 (after 18:30)
    const mockNow = new Date(2026, 8, 2, 19, 30);
    const todayStr = '2026-09-02';

    const gaps = PlannerScheduler.findAvailableGaps(todayStr, '09:00', '18:30', [], {
      futureOnly: true,
      now: mockNow
    });

    expect(gaps).toEqual([]);
  });

  it('returns full working day gaps for future dates', () => {
    const mockNow = new Date(2026, 8, 2, 14, 0);
    const tomorrowStr = '2026-09-03';

    const gaps = PlannerScheduler.findAvailableGaps(tomorrowStr, '09:00', '18:30', [], {
      futureOnly: true,
      now: mockNow
    });

    expect(gaps.length).toBe(1);
    expect(gaps[0].startTime).toBe('09:00');
    expect(gaps[0].endTime).toBe('18:30');
    expect(gaps[0].duration).toBe(570);
    expect(gaps[0].date).toBe(tomorrowStr);
  });

  it('simulates and schedules tasks strictly in future slots across multi-day target scope', async () => {
    const mockNow = new Date(2026, 8, 2, 17, 30); // 1 hour left today (17:30 to 18:30)
    const targetDays = ['2026-09-02', '2026-09-03'];

    const todos = [
      { id: 't1', title: 'Task 1', durationMins: 30, eisenhowerQuadrant: 'Q1' },
      { id: 't2', title: 'Task 2', durationMins: 30, eisenhowerQuadrant: 'Q1' },
      { id: 't3', title: 'Task 3', durationMins: 45, eisenhowerQuadrant: 'Q2' },
      { id: 't4', title: 'Task 4', durationMins: 60, eisenhowerQuadrant: 'Q2' }
    ];

    const planned = PlannerScheduler.simulateSchedule({
      candidateTodos: todos,
      targetDays,
      workStart: '09:00',
      workEnd: '18:30',
      eventsList: [],
      options: { futureOnly: true, now: mockNow }
    });

    // Today (17:30 - 18:30) can fit 60 mins -> Task 1 (30m) and Task 2 (30m)
    // Task 3 (45m) and Task 4 (60m) must roll over to tomorrow (2026-09-03)
    expect(planned.length).toBe(4);

    expect(planned[0].todo.id).toBe('t1');
    expect(planned[0].date).toBe('2026-09-02');
    expect(planned[0].startTime).toBe('17:30');
    expect(planned[0].endTime).toBe('18:00');

    expect(planned[1].todo.id).toBe('t2');
    expect(planned[1].date).toBe('2026-09-02');
    expect(planned[1].startTime).toBe('18:00');
    expect(planned[1].endTime).toBe('18:30');

    // Tomorrow starts at 09:00
    expect(planned[2].todo.id).toBe('t3');
    expect(planned[2].date).toBe('2026-09-03');
    expect(planned[2].startTime).toBe('09:00');
    expect(planned[2].endTime).toBe('09:45');

    expect(planned[3].todo.id).toBe('t4');
    expect(planned[3].date).toBe('2026-09-03');
    expect(planned[3].startTime).toBe('09:45');
    expect(planned[3].endTime).toBe('10:45');
  });

  it('respects meeting buffer ratio to leave open space in gaps', () => {
    const mockNow = new Date(2026, 8, 3, 8, 0); // Morning before 09:00
    const targetDays = ['2026-09-03'];

    // 09:00 - 18:30 is 570 minutes
    const todos = [
      { id: 't1', title: 'Task 1', durationMins: 60, eisenhowerQuadrant: 'Q1' },
      { id: 't2', title: 'Task 2', durationMins: 60, eisenhowerQuadrant: 'Q1' },
      { id: 't3', title: 'Task 3', durationMins: 60, eisenhowerQuadrant: 'Q1' },
      { id: 't4', title: 'Task 4', durationMins: 60, eisenhowerQuadrant: 'Q1' },
      { id: 't5', title: 'Task 5', durationMins: 60, eisenhowerQuadrant: 'Q1' }
    ];

    // With a 40% meeting buffer (bufferRatio = 0.4), each gap can only use 60% of its duration for tasks
    const planned = PlannerScheduler.simulateSchedule({
      candidateTodos: todos,
      targetDays,
      workStart: '09:00',
      workEnd: '12:00', // 180 mins total. With 40% buffer, max task time is 108 mins -> fits 1 60m task (2 60m tasks = 120m > 108m)
      eventsList: [],
      bufferRatio: 0.4,
      options: { futureOnly: true, now: mockNow }
    });

    expect(planned.length).toBe(1);
    expect(planned[0].todo.id).toBe('t1');
  });

  it('warns with toast if active days are entirely in the past', async () => {
    let toastedMessage = '';
    window.toast = (msg) => { toastedMessage = msg; };
    window.getPlannerDaysToDisplay = () => [new Date(2026, 7, 24), new Date(2026, 7, 25)]; // Aug 24-25, 2026 (past)
    window.formatLocalDateValue = (d) => {
      const date = new Date(d);
      return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
    };

    await window.triggerPlannerAutoBalance();

    expect(toastedMessage).toBe('planner.noFutureSlotsInView');
    expect(document.getElementById('planner-autobalance-modal')).toBeNull();
  });

  it('opens interactive modal and handles task checkbox toggles', () => {
    window.getPlannerDaysToDisplay = () => [new Date(2026, 8, 2), new Date(2026, 8, 3)];
    window.todosManifest = [
      { id: 'todo-1', title: 'Task 1', durationMins: 30, eisenhowerQuadrant: 'Q1' },
      { id: 'todo-2', title: 'Task 2', durationMins: 45, eisenhowerQuadrant: 'Q2' }
    ];

    window.openPlannerAutoBalanceModal();

    const modal = document.getElementById('planner-autobalance-modal');
    expect(modal).not.toBeNull();

    // Verify header and elements exist
    const title = modal.querySelector('.planner-autobalance-title');
    expect(title).not.toBeNull();

    // Verify task items rendered
    const items = modal.querySelectorAll('.planner-autobalance-item');
    expect(items.length).toBe(2);

    // Close modal via close button
    const closeBtn = modal.querySelector('#autobalance-modal-close');
    closeBtn.click();
    expect(document.getElementById('planner-autobalance-modal')).toBeNull();
  });
});
