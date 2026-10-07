import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Delegated Tasks & Gantt Timeline View', () => {
  beforeAll(() => {
    loadScriptsIntoGlobal([
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-utils.js',
      'js/app-state.js',
      'js/app-board.js',
      'js/app-notes.js',
      'js/app-collab.js',
      'js/app-todos-board.js'
    ]);
  });

  beforeEach(() => {
    global.todosManifest = [];
    global.manifest = [];
    global.eisenhowerWorkstreamFilter = null;
    global.delegatedWorkstreamCollapsed = new Set();
    global.toast = vi.fn();
    global.saveTodosManifest = vi.fn().mockResolvedValue(true);
    global.setTodoDoneById = vi.fn().mockImplementation(async (id) => {
      const t = global.todosManifest.find(x => x.id === id);
      if (t) t.priority = 'Done';
      return true;
    });
  });

  describe('isTodoDelegated detection', () => {
    it('handles null and undefined safely', () => {
      expect(isTodoDelegated(null)).toBe(false);
      expect(isTodoDelegated(undefined)).toBe(false);
    });

    it('identifies user task without delegation as not delegated across all quadrants', () => {
      expect(isTodoDelegated({ id: 't1', ownerId: 'me', priority: 'High', eisenhowerQuadrant: 'Q1' })).toBe(false);
      expect(isTodoDelegated({ id: 't2', ownerId: 'me', priority: 'Medium', eisenhowerQuadrant: 'Q2' })).toBe(false);
      expect(isTodoDelegated({ id: 't3', ownerId: 'me', priority: 'Low', eisenhowerQuadrant: 'Q3' })).toBe(false);
      expect(isTodoDelegated({ id: 't4', ownerId: 'me', priority: 'Low', eisenhowerQuadrant: 'Q4' })).toBe(false);
    });

    it('identifies task as delegated when delegatedTo, isDelegated, or colleague owner is set', () => {
      expect(isTodoDelegated({ id: 't5', ownerId: 'me', delegatedTo: 'Alice' })).toBe(true);
      expect(isTodoDelegated({ id: 't6', ownerId: 'me', isDelegated: true })).toBe(true);
      expect(isTodoDelegated({ id: 't7', ownerId: 'me', delegated_to: 'Bob' })).toBe(true);
      expect(isTodoDelegated({ id: 't8', ownerId: 'me', delegatedToColleagueId: 'colleague-123' })).toBe(true);
      expect(isTodoDelegated({ id: 't9', ownerId: 'colleague_bob', owner: 'Bob' })).toBe(true);
    });
  });

  describe('Workstream Grouping & Collapse Toggling', () => {
    it('toggles workstream group collapse state', () => {
      expect(delegatedWorkstreamCollapsed.has('Marketing')).toBe(false);
      toggleDelegatedWorkstreamGroup('Marketing');
      expect(delegatedWorkstreamCollapsed.has('Marketing')).toBe(true);
      toggleDelegatedWorkstreamGroup('Marketing');
      expect(delegatedWorkstreamCollapsed.has('Marketing')).toBe(false);
    });

    it('groups unassigned workstreams under General/Other', () => {
      global.todosManifest = [
        { id: 'del-1', title: 'Task without workstream', owner: 'Bob', ownerId: 'bob' }
      ];

      const html = renderDelegatedTasksGanttHtml();
      expect(html).toContain(t('todo.delegatedWorkstreamOther') || 'General');
      expect(html).toContain('Task without workstream');
    });
  });

  describe('Gantt Timeline Calculations & Milestone Flags', () => {
    it('renders bounded, open-ended, and overdue task rows with accurate classes', () => {
      const today = new Date();
      const yesterday = new Date(today.getTime() - 86400000).toISOString().slice(0, 10);
      const nextWeek = new Date(today.getTime() + 7 * 86400000).toISOString().slice(0, 10);

      global.todosManifest = [
        {
          id: 'del-bounded',
          title: 'Bounded Task',
          owner: 'Alice',
          ownerId: 'alice',
          workstream: 'Engineering',
          created: '2026-09-01',
          delegatedDate: '2026-09-02',
          dueDate: nextWeek,
          updates: [
            { id: 'u1', date: '2026-09-03', type: 'general_update', text: 'Started coding' },
            { id: 'u2', date: '2026-09-05', type: 'feedback_received', text: 'Design approved' },
            { id: 'u3', date: nextWeek, type: 'sync_meeting', text: 'Weekly check-in' }
          ]
        },
        {
          id: 'del-open',
          title: 'Open-ended Task',
          owner: 'Bob',
          ownerId: 'bob',
          workstream: 'Design',
          created: '2026-09-05',
          delegatedDate: '2026-09-05',
          updates: [
            { id: 'u4', date: nextWeek, type: 'awaiting_feedback', text: 'Awaiting client review' }
          ]
        },
        {
          id: 'del-overdue',
          title: 'Overdue Task',
          owner: 'Claire',
          ownerId: 'claire',
          workstream: 'Operations',
          created: '2026-08-20',
          delegatedDate: '2026-08-21',
          dueDate: yesterday,
          updates: []
        }
      ];

      const html = renderDelegatedTasksGanttHtml();

      expect(html).toContain('Bounded Task');
      expect(html).toContain('Open-ended Task');
      expect(html).toContain('Overdue Task');

      // Classes
      expect(html).toContain('is-bounded');
      expect(html).toContain('is-open-ended');
      expect(html).toContain('is-overdue');
      expect(html).toContain('date-overdue');

      // Flags
      expect(html).toContain('flag-update');
      expect(html).toContain('flag-feedback-received');
      expect(html).toContain('flag-sync-meeting');
      expect(html).toContain('flag-awaiting-feedback');

      // Week Scale & Timeline Grid
      expect(html).toContain('delegated-week-scale-wrap');
      expect(html).toContain('delegated-week-col-header');
      expect(html).toContain('delegated-timeline-grid-bg');
      expect(html).toContain('delegated-week-grid-cell');
      expect(html).toContain('delegated-today-marker-line');

      // KPI summary chips & actions
      expect(html).toContain('delegated-kpi-chip');
      expect(html).toContain('btn-delegated-action');
      expect(html).toContain('btn-set-ret-date');
    });

    it('renders accurate KPI counters for total, overdue, and awaiting feedback', () => {
      const today = new Date();
      const pastDate = new Date(today.getTime() - 2 * 86400000).toISOString().slice(0, 10);
      const futureDate = new Date(today.getTime() + 5 * 86400000).toISOString().slice(0, 10);

      global.todosManifest = [
        { id: 'kpi-1', title: 'Task 1', owner: 'Alice', ownerId: 'alice', dueDate: pastDate },
        { id: 'kpi-2', title: 'Task 2', owner: 'Bob', ownerId: 'bob', dueDate: futureDate, updates: [{ id: 'u1', date: futureDate, type: 'awaiting_feedback' }] },
        { id: 'kpi-3', title: 'Task 3', owner: 'Claire', ownerId: 'claire' }
      ];

      const html = renderDelegatedTasksGanttHtml();
      expect(html).toContain('delegated-kpi-chip is-danger'); // overdue
      expect(html).toContain('delegated-kpi-chip is-warning'); // awaiting
      expect(html).toContain('delegated-total-count');
    });

    it('filters delegated tasks by workstream filter when active', () => {
      global.todosManifest = [
        { id: 'del-1', title: 'Engineering Task', owner: 'Alice', ownerId: 'alice', workstream: 'Engineering' },
        { id: 'del-2', title: 'Marketing Task', owner: 'Bob', ownerId: 'bob', workstream: 'Marketing' }
      ];

      global.eisenhowerWorkstreamFilter = 'Engineering';
      const html = renderDelegatedTasksGanttHtml();

      expect(html).toContain('Engineering Task');
      expect(html).not.toContain('Marketing Task');
    });
  });

  describe('Gantt Quick Actions & Modals', () => {
    it('marks task as completed from Gantt checkbox', async () => {
      const todo = { id: 'del-done-test', title: 'To complete', owner: 'Bob', ownerId: 'bob', priority: 'Medium' };
      global.todosManifest = [todo];
      global.getTodoById = (id) => global.todosManifest.find(x => x.id === id);

      await toggleTodoDoneFromGantt('del-done-test');
      expect(global.setTodoDoneById).toHaveBeenCalledWith('del-done-test');
      expect(todo.priority).toBe('Done');
    });

    it('sets return date inline with prompt', async () => {
      const todo = { id: 'del-inline-date', title: 'Open task', owner: 'Alice', ownerId: 'alice' };
      global.todosManifest = [todo];
      global.getTodoById = (id) => global.todosManifest.find(x => x.id === id);

      global.prompt = vi.fn().mockReturnValue('2026-09-30');

      await setDelegatedReturnDateInline('del-inline-date');

      expect(todo.dueDate).toBe('2026-09-30');
      expect(global.saveTodosManifest).toHaveBeenCalled();
    });

    it('pushes task follow-up to 1-on-1 sync note', async () => {
      const todo = { id: 'del-sync-test', title: 'Architecture Review', owner: 'Alice', ownerId: 'alice' };
      global.todosManifest = [todo];
      global.getTodoById = (id) => global.todosManifest.find(x => x.id === id);
      const originalFn = global.createSyncNoteForCollaborator;
      global.createSyncNoteForCollaborator = vi.fn().mockResolvedValue(true);

      await pushTodoTo1on1('del-sync-test');

      expect(global.createSyncNoteForCollaborator).toHaveBeenCalledWith('Alice');
      global.createSyncNoteForCollaborator = originalFn;
    });
  });

  describe('Quick Update Popover', () => {
    it('opens, saves, and closes quick update popover', async () => {
      const todo = { id: 'del-popover-test', title: 'Task to update', owner: 'Bob', ownerId: 'bob', updates: [] };
      global.todosManifest = [todo];
      global.getTodoById = (id) => global.todosManifest.find(x => x.id === id);

      const fakeEvent = { clientX: 100, clientY: 100, stopPropagation: vi.fn() };
      openQuickUpdatePopover('del-popover-test', fakeEvent);

      const popover = document.querySelector('.quick-update-popover');
      expect(popover).not.toBeNull();

      const textInp = document.getElementById('quick-update-text');
      const dateInp = document.getElementById('quick-update-date');
      const typeInp = document.getElementById('quick-update-type');

      if (textInp) textInp.value = 'Client approved milestones';
      if (dateInp) dateInp.value = '2026-09-22';
      if (typeInp) typeInp.value = 'feedback_received';

      await saveQuickUpdateFromPopover('del-popover-test');

      expect(todo.updates.length).toBe(1);
      expect(todo.updates[0].text).toBe('Client approved milestones');
      expect(todo.updates[0].type).toBe('feedback_received');
      expect(todo.updates[0].date).toBe('2026-09-22');
      expect(global.saveTodosManifest).toHaveBeenCalled();

      expect(document.querySelector('.quick-update-popover')).toBeNull();
    });
  });

  describe('Modal Dated Updates Management', () => {
    it('adds, renders, and removes dated updates in modal state', () => {
      document.body.innerHTML = `
        <div id="todo-edit-updates-container"></div>
        <input type="date" id="todo-edit-delegated-date">
        <input type="date" id="todo-edit-update-date" value="2026-09-18">
        <select id="todo-edit-update-type"><option value="sync_meeting" selected>Sync</option></select>
        <input type="text" id="todo-edit-update-text" value="Discussed blockers">
      `;

      global._todoModalDelegatedDate = '2026-09-10';
      global._todoModalUpdates = [];

      onTodoDelegatedDateChanged('2026-09-12');
      expect(global._todoModalDelegatedDate).toBe('2026-09-12');

      addTodoDatedUpdateFromUI();

      expect(global._todoModalUpdates.length).toBe(1);
      expect(global._todoModalUpdates[0].text).toBe('Discussed blockers');
      expect(global._todoModalUpdates[0].type).toBe('sync_meeting');
      expect(global._todoModalUpdates[0].date).toBe('2026-09-18');

      const container = document.getElementById('todo-edit-updates-container');
      expect(container.innerHTML).toContain('Discussed blockers');

      removeTodoDatedUpdate(0);
      expect(global._todoModalUpdates.length).toBe(0);
      expect(container.innerHTML).toContain(t('todo.noUpdatesLogged'));
    });
  });

  describe('1-on-1 Sync Note Template Integration', () => {
    it('formats active delegated tasks with expected return date and latest checkpoint', async () => {
      document.body.innerHTML = `
        <div id="modal-new-note"></div>
        <input id="nn-title">
        <input id="nn-date">
        <input id="nn-group">
        <input id="nn-topic">
        <textarea id="nn-content"></textarea>
      `;

      if (!global.collaboratorsMap) global.collaboratorsMap = {};
      global.collaboratorsMap['Alice'] = {
        agenda: [{ text: 'Project roadmap', noteTitle: 'Roadmap Note' }],
        delegations: []
      };

      global.todosManifest = [
        {
          id: 'del-sync-1',
          title: 'Implement Auth Service',
          owner: 'Alice',
          ownerId: 'alice',
          dueDate: '2026-09-28',
          updates: [
            { id: 'u1', date: '2026-09-15', type: 'feedback_received', text: 'JWT spec verified' }
          ]
        }
      ];

      global.showMdTab = vi.fn();

      await createSyncNoteForCollaborator('Alice');

      const content = document.getElementById('nn-content').value;
      expect(content).toContain('@Alice Project roadmap');
      expect(content).toContain('Implement Auth Service');
      expect(content).toContain('(Expected: 2026-09-28)');
      expect(content).toContain('[feedback_received: JWT spec verified]');
    });
  });

  describe('Gantt Timeline Calculations & Bounds Engine', () => {
    it('calculates fixed time scales correctly (4w, 8w, 12w)', () => {
      const ref = new Date(2026, 8, 15); // Sep 15, 2026 (Tuesday)
      
      const bounds4w = calculateGanttTimeBounds(ref, '4w', []);
      expect(bounds4w.startMs).toBeLessThan(ref.getTime());
      expect(bounds4w.endMs).toBeGreaterThan(ref.getTime());
      const days4w = Math.round((bounds4w.endMs - bounds4w.startMs) / (24 * 60 * 60 * 1000));
      expect(days4w).toBe(28);

      const bounds8w = calculateGanttTimeBounds(ref, '8w', []);
      const days8w = Math.round((bounds8w.endMs - bounds8w.startMs) / (24 * 60 * 60 * 1000));
      expect(days8w).toBe(56);

      const bounds12w = calculateGanttTimeBounds(ref, '12w', []);
      const days12w = Math.round((bounds12w.endMs - bounds12w.startMs) / (24 * 60 * 60 * 1000));
      expect(days12w).toBe(84);
    });

    it('calculates dynamic fit bounds covering task dates with padding', () => {
      const tasks = [
        { id: 't1', delegatedDate: '2026-09-01', dueDate: '2026-09-10' },
        { id: 't2', dueDate: '2026-10-15' }
      ];
      const ref = new Date(2026, 8, 15);
      const boundsFit = calculateGanttTimeBounds(ref, 'fit', tasks);
      expect(boundsFit.startMs).toBeLessThanOrEqual(new Date('2026-09-01').getTime());
      expect(boundsFit.endMs).toBeGreaterThanOrEqual(new Date('2026-10-15').getTime());
    });

    it('shifts start and due dates precisely with calculateGanttTimeShift', () => {
      // Both dates present
      const shift1 = calculateGanttTimeShift('2026-09-10', '2026-09-20', 3);
      expect(shift1.startDate).toBe('2026-09-13');
      expect(shift1.dueDate).toBe('2026-09-23');

      // Negative shift
      const shift2 = calculateGanttTimeShift('2026-09-10', '2026-09-20', -2);
      expect(shift2.startDate).toBe('2026-09-08');
      expect(shift2.dueDate).toBe('2026-09-18');

      // Only due date present
      const shift3 = calculateGanttTimeShift(null, '2026-09-20', 5);
      expect(shift3.startDate).toBeNull();
      expect(shift3.dueDate).toBe('2026-09-25');

      // Only start date present
      const shift4 = calculateGanttTimeShift('2026-09-10', null, -3);
      expect(shift4.startDate).toBe('2026-09-07');
      expect(shift4.dueDate).toBeNull();

      // Zero shift
      const shift5 = calculateGanttTimeShift('2026-09-10', '2026-09-20', 0);
      expect(shift5.startDate).toBe('2026-09-10');
      expect(shift5.dueDate).toBe('2026-09-20');
    });

    it('resizes start and end duration handles properly with calculateGanttDurationResize', () => {
      // Resizing start handle (moving start forward)
      const res1 = calculateGanttDurationResize('2026-09-10', '2026-09-20', 'handle-start', 2);
      expect(res1.startDate).toBe('2026-09-12');
      expect(res1.dueDate).toBe('2026-09-20');

      // Resizing start handle past due date is clamped to due date
      const res2 = calculateGanttDurationResize('2026-09-10', '2026-09-20', 'handle-start', 15);
      expect(res2.startDate).toBe('2026-09-20');
      expect(res2.dueDate).toBe('2026-09-20');

      // Resizing end handle (extending duration)
      const res3 = calculateGanttDurationResize('2026-09-10', '2026-09-20', 'handle-end', 5);
      expect(res3.startDate).toBe('2026-09-10');
      expect(res3.dueDate).toBe('2026-09-25');

      // Resizing end handle earlier than start date is clamped to start date
      const res4 = calculateGanttDurationResize('2026-09-10', '2026-09-20', 'handle-end', -15);
      expect(res4.startDate).toBe('2026-09-10');
      expect(res4.dueDate).toBe('2026-09-10');
    });
  });

  describe('Gantt Task Scope Filtering & Workstream Management', () => {
    beforeEach(() => {
      global.todosManifest = [
        { id: 't-del', title: 'Delegated Task', owner: 'Alice', ownerId: 'alice', isDelegated: true, dueDate: '2026-09-20', workstream: 'Dev' },
        { id: 't-own-due', title: 'Own Due Task', owner: 'me', ownerId: 'me', dueDate: '2026-09-22', workstream: 'Dev' },
        { id: 't-own-undated', title: 'Own Undated Task', owner: 'me', ownerId: 'me', workstream: 'Marketing' },
        { id: 't-own-updates', title: 'Own Task with Checkpoints', owner: 'me', ownerId: 'me', updates: [{ id: 'u1', date: '2026-09-25', text: 'Call' }] }
      ];
    });

    it('returns only delegated tasks when scope is "delegated"', () => {
      const delegatedTasks = getGanttFilteredTasks(global.todosManifest, 'delegated');
      expect(delegatedTasks.length).toBe(1);
      expect(delegatedTasks[0].id).toBe('t-del');
    });

    it('returns all scheduled tasks when scope is "all"', () => {
      const allTasks = getGanttFilteredTasks(global.todosManifest, 'all');
      expect(allTasks.length).toBe(3); // t-del, t-own-due, t-own-updates (t-own-undated has no date)
      expect(allTasks.map(x => x.id)).toContain('t-del');
      expect(allTasks.map(x => x.id)).toContain('t-own-due');
      expect(allTasks.map(x => x.id)).toContain('t-own-updates');
      expect(allTasks.map(x => x.id)).not.toContain('t-own-undated');
    });

    it('filters by workstream across scopes', () => {
      global.eisenhowerWorkstreamFilter = 'Dev';
      const filteredAll = getGanttFilteredTasks(global.todosManifest, 'all', 'Dev');
      expect(filteredAll.length).toBe(2);
      expect(filteredAll.map(x => x.id)).toEqual(['t-del', 't-own-due']);
    });
  });

  describe('Gantt Hover Card & Metadata Extraction', () => {
    it('computes checklist progress and update summaries accurately', () => {
      const task = {
        id: 't-hover',
        title: 'Complete Spec',
        owner: 'Bob',
        ownerId: 'bob',
        workstream: 'Design',
        eisenhowerQuadrant: 'Q2',
        delegatedDate: '2026-09-10',
        dueDate: '2026-09-15',
        checklist: [
          { text: 'Subtask 1', done: true },
          { text: 'Subtask 2', done: false },
          { text: 'Subtask 3', done: true }
        ],
        updates: [
          { id: 'u1', date: '2026-09-12', type: 'general_update', text: 'First draft completed' },
          { id: 'u2', date: '2026-09-14', type: 'feedback_received', text: 'Feedback approved' }
        ]
      };

      const data = buildGanttHoverCardData(task);
      expect(data.title).toBe('Complete Spec');
      expect(data.owner).toBe('Bob');
      expect(data.workstream).toBe('Design');
      expect(data.durationDays).toBe(6); // 10th to 15th inclusive = 6 days
      expect(data.checklistTotal).toBe(3);
      expect(data.checklistDone).toBe(2);
      expect(data.checklistPct).toBe(67);
      expect(data.updatesCount).toBe(2);
      expect(data.latestUpdate.text).toBe('Feedback approved');
    });

    it('handles tasks without subtasks or updates gracefully', () => {
      const task = { id: 't-minimal', title: 'Simple Task' };
      const data = buildGanttHoverCardData(task);
      expect(data.title).toBe('Simple Task');
      expect(data.checklistTotal).toBe(0);
      expect(data.checklistPct).toBe(0);
      expect(data.updatesCount).toBe(0);
      expect(data.latestUpdate).toBeNull();
      expect(data.durationDays).toBeNull();
    });
  });

  describe('Gantt UI Controls & Inline Scheduling', () => {
    it('renders scale controls and scope controls with active states and resize handles', () => {
      global.todosManifest = [
        { id: 't-gantt-render', title: 'Task 1', owner: 'Alice', ownerId: 'alice', isDelegated: true, dueDate: '2026-09-25', delegatedDate: '2026-09-15' }
      ];
      global.ganttTimeScale = '8w';
      global.ganttTaskScope = 'all';

      const html = renderDelegatedTasksGanttHtml();
      expect(html).toContain('onclick="setGanttTimeScale(\'8w\')"');
      expect(html).toContain('onclick="setGanttTaskScope(\'all\')"');
      expect(html).toContain('gantt-resize-handle handle-start');
      expect(html).toContain('gantt-resize-handle handle-end');
      expect(html).toContain('showGanttHoverCard(event, \'t-gantt-render\')');
    });

    it('shows and hides Gantt hover card in DOM dynamically', () => {
      const task = {
        id: 't-hover-dom',
        title: 'Design Review',
        owner: 'Alice',
        ownerId: 'alice',
        isDelegated: true,
        dueDate: '2026-09-30',
        checklist: [{ text: 'Prepare slides', done: true }]
      };
      global.todosManifest = [task];
      global.getTodoById = (id) => global.todosManifest.find(x => x.id === id);

      const fakeEvent = {
        currentTarget: {
          getBoundingClientRect: () => ({ left: 200, top: 150, width: 100, height: 30 })
        }
      };

      showGanttHoverCard(fakeEvent, 't-hover-dom', true);
      const card = document.getElementById('gantt-hover-card');
      expect(card).not.toBeNull();
      expect(card.innerHTML).toContain('Design Review');
      expect(card.innerHTML).toContain('1/1');

      hideGanttHoverCard(true);
      const cardAfterHide = document.getElementById('gantt-hover-card');
      expect(cardAfterHide).toBeNull();
    });

    it('switches time scale and scope state triggers rerender', () => {
      global.renderTodosBoard = vi.fn();
      setGanttTimeScale('12w');
      expect(ganttTimeScale).toBe('12w');
      expect(global.renderTodosBoard).toHaveBeenCalled();

      setGanttTaskScope('delegated');
      expect(ganttTaskScope).toBe('delegated');
    });

    it('schedules task at specific date from Gantt grid click', async () => {
      const task = { id: 't-sched', title: 'Unscheduled Task', owner: 'Alice' };
      global.todosManifest = [task];
      global.getTodoById = (id) => global.todosManifest.find(x => x.id === id);

      await scheduleTodoAtDateFromGantt('t-sched', '2026-10-05');
      expect(task.dueDate).toBe('2026-10-05');
      expect(global.saveTodosManifest).toHaveBeenCalled();
    });

    it('opens new task dialog prefilled with workstream from Gantt header', () => {
      global.openNewTodoDialog = vi.fn();

      addQuickTaskToWorkstream('Frontend');

      expect(global.openNewTodoDialog).toHaveBeenCalledWith({
        workstream: 'Frontend',
        ownerId: 'colleague'
      });
    });
  });
});


