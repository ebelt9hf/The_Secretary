import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Planner and Block Modal Apple UI Standards', () => {
  let plannerScope;

  beforeEach(() => {
    global.document = document;
    global.window = window;
    document.body.innerHTML = '';
    vi.restoreAllMocks();

    const plannerCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-planner.js'), 'utf8');

    const setupCode = `
      window.plannerEvents = [];
      global.plannerEvents = window.plannerEvents;
      window.plannerProposals = [];
      global.plannerProposals = window.plannerProposals;
      window.todosManifest = [];
      window.manifest = [];
      window.selectedPlannerEventId = null;
      window.plannerViewMode = 'week';
      window.currentPlannerWeekStart = new Date(2026, 9, 5);
      window.currentLang = 'en';
      window.workStartTime = '09:00';
      window.workEndTime = '18:30';
      window.defaultPlannerDuration = 30;
      window.getAppLocale = function() { return 'en-US'; };
      window.timeToMinutes = function(timeStr) {
        if (!timeStr) return 0;
        const [h, m] = timeStr.split(':').map(Number);
        return (h || 0) * 60 + (m || 0);
      };
      window.minutesToTime = function(mins) {
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
      };
      window.parseLocalDateValue = function(s) {
        if (!s) return new Date();
        const [y, m, d] = s.split('-').map(Number);
        return new Date(y, (m || 1) - 1, d || 1);
      };
      window.formatLocalDateValue = function(d) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return y + '-' + m + '-' + day;
      };
      window._calcDurationMins = function(start, end) {
        const sm = window.timeToMinutes(start);
        const em = window.timeToMinutes(end);
        return em >= sm ? (em - sm) : (1440 - sm + em);
      };
      window.t = function(key, params) {
        const dict = {
          'planner.call': 'Call',
          'planner.sync': 'Sync Up',
          'planner.prep': 'Prep',
          'planner.work': 'Focus Work',
          'planner.todo': 'Todo Task',
          'planner.personal': 'Personal',
          'planner.ooo': 'Out of Office',
          'planner.custom': 'Custom',
          'planner.editBlock': 'Edit Block',
          'planner.newEvent': 'New Block',
          'planner.deleteBlock': 'Delete Block',
          'planner.quickDelete': 'Delete',
          'planner.quickEdit': 'Edit',
          'planner.quickDuplicate': 'Duplicate',
          'planner.quickOpenNote': 'Open Note',
          'editor.cancel': 'Cancel',
          'todo.save': 'Save',
          'common.close': 'Close',
          'planner.date': 'Date',
          'planner.startTime': 'Start Time',
          'planner.endTime': 'End Time',
          'planner.durationLabel': 'Duration'
        };
        let val = dict[key] || key;
        if (params && typeof params === 'object') {
          for (const [pk, pv] of Object.entries(params)) {
            val = val.replace(new RegExp('\\\\{' + pk + '\\\\}', 'g'), String(pv));
          }
        }
        return val;
      };
      window.escH = function(s) { return String(s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
      window.escA = function(s) { return String(s || '').replace(/"/g, '&quot;'); };
      window.jq = function(s) { return JSON.stringify(s); };
      window.toast = vi.fn();
      window.savePlanner = vi.fn().mockResolvedValue(true);
      window.renderPlanner = vi.fn();
      window.deletePlannerEventWithDissolve = vi.fn();
      window.populateTagEditor = vi.fn();
      window.readTagEditor = vi.fn().mockReturnValue([]);
      window.populatePlannerEventWorkstreamEditor = vi.fn();
      window.normalizePlannerCollaboratorIds = vi.fn(ids => ids || []);
      window.getPlannerCollaboratorLabelsByIds = vi.fn(ids => ids || []);
      window.normalizePlannerLinkedNoteIds = vi.fn(ids => ids || []);
      window.normalizePlannerLinkedTodoIds = vi.fn(ids => ids || []);
      window.getPlannerEventLinkedTodoIds = vi.fn(() => []);
      window.getPlannerEventLinkedNoteIds = vi.fn(() => []);

      ${plannerCode}

      return {
        openPlannerModal,
        openPlanEventModal,
        togglePlannerModalFields,
        _selectPlannerSegmentType,
        _renderPlannerSvgIcon,
        renderPlannerEventsForDayHTML
      };
    `;

    const runner = new Function('vi', setupCode);
    plannerScope = runner(vi);
  });

  it('renders an Apple Segmented Control for block types with vector icons and labels', () => {
    plannerScope.openPlanEventModal({
      title: 'Strategy Session',
      type: 'work',
      date: '2026-10-05',
      startTime: '10:00',
      endTime: '11:00'
    });

    const modal = document.getElementById('planner-dynamic-modal');
    expect(modal).not.toBeNull();

    // Check Apple Segmented Control exists
    const segmentedCtrl = modal.querySelector('.pe-type-segmented-control');
    expect(segmentedCtrl).not.toBeNull();

    const segmentBtns = modal.querySelectorAll('.pe-type-segment-btn');
    expect(segmentBtns.length).toBeGreaterThanOrEqual(7);

    // Verify 'work' is active
    const activeBtn = modal.querySelector('.pe-type-segment-btn.active');
    expect(activeBtn).not.toBeNull();
    expect(activeBtn.getAttribute('data-type')).toBe('work');
    expect(activeBtn.getAttribute('aria-checked')).toBe('true');

    // Verify SVG icon exists inside segment button
    expect(activeBtn.querySelector('svg')).not.toBeNull();
  });

  it('switches event type via Apple Segmented Control and synchronizes underlying #pe-type and fields', () => {
    plannerScope.openPlanEventModal({
      title: 'Coffee Break',
      type: 'work',
      date: '2026-10-05',
      startTime: '10:00',
      endTime: '10:30'
    });

    const modal = document.getElementById('planner-dynamic-modal');
    const select = document.getElementById('pe-type');
    expect(select).not.toBeNull();
    expect(select.value).toBe('work');

    // Click on 'call' segment
    const callSegmentBtn = modal.querySelector('.pe-type-segment-btn[data-type="call"]');
    expect(callSegmentBtn).not.toBeNull();
    callSegmentBtn.click();

    // Check that select value is now 'call'
    expect(select.value).toBe('call');
    expect(callSegmentBtn.classList.contains('active')).toBe(true);
    expect(modal.classList.contains('pe-type-call')).toBe(true);
  });

  it('includes an Apple-standard top-right close button in planner modal', async () => {
    plannerScope.openPlanEventModal({
      title: 'Test Block',
      type: 'call',
      date: '2026-10-05',
      startTime: '14:00',
      endTime: '14:30'
    });

    const modal = document.getElementById('planner-dynamic-modal');
    const closeBtn = modal.querySelector('.planner-modal-close-btn');
    expect(closeBtn).not.toBeNull();
    expect(closeBtn.getAttribute('title')).toBeTruthy();
    expect(closeBtn.querySelector('svg')).not.toBeNull();

    // Click close button and await handler
    await closeBtn.onclick();
    expect(document.getElementById('planner-dynamic-modal')).toBeNull();
  });

  it('renders a Delete Block button in modal actions when editing an existing event', () => {
    const existingEvt = {
      id: 'evt-existing-1',
      title: 'Existing Review',
      type: 'work',
      date: '2026-10-05',
      startTime: '15:00',
      endTime: '16:00'
    };
    window.plannerEvents = [existingEvt];
    global.plannerEvents = window.plannerEvents;

    plannerScope.openPlanEventModal(existingEvt);

    const modal = document.getElementById('planner-dynamic-modal');
    const deleteBtn = modal.querySelector('.pe-modal-delete-btn');
    expect(deleteBtn).not.toBeNull();
    expect(deleteBtn.textContent).toContain('Delete');
    expect(deleteBtn.querySelector('svg')).not.toBeNull();
  });

  it('renders vector SVG icons in event card quick action buttons instead of raw emoji characters', () => {
    window.plannerEvents = [
      {
        id: 'evt-card-1',
        title: 'Project Sync',
        type: 'sync',
        date: '2026-10-05',
        startTime: '09:00',
        endTime: '09:30'
      }
    ];

    const html = plannerScope.renderPlannerEventsForDayHTML('2026-10-05');
    expect(html).toContain('planner-event-card');

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;

    const quickActionBtns = tempDiv.querySelectorAll('.planner-event-act-btn');
    expect(quickActionBtns.length).toBeGreaterThanOrEqual(3);

    quickActionBtns.forEach(btn => {
      // Must contain an SVG element
      const svg = btn.querySelector('svg');
      expect(svg).not.toBeNull();
      // Must not contain raw emoji characters
      expect(btn.textContent.trim()).not.toMatch(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u);
    });
  });
});
