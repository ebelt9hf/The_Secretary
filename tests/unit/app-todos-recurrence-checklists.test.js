import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Todos Checklists, Recurrence & Search (app-todos-board.js)', () => {
  beforeAll(() => {
    globalThis.window = globalThis.window || {};
    globalThis.t = (key) => key;
    globalThis.escH = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    globalThis.toast = () => {};
    globalThis.broadcastSync = () => {};

    loadScriptsIntoGlobal([
      'js/app-state.js',
      'js/app-utils.js',
      'js/app-fs.js',
      'js/app-storage.js',
      'js/app-notes.js',
      'js/app-overlay.js',
      'js/app-todos-board.js'
    ]);
  });

  beforeEach(() => {
    globalThis.todosManifest = [];
  });

  describe('Checklists inside Tasks', () => {
    it('computes checklist progress accurately', () => {
      const todo = {
        id: 'td-1',
        title: 'Launch Beta',
        checklist: [
          { id: 'c1', text: 'Run regression tests', done: true },
          { id: 'c2', text: 'Check translations', done: true },
          { id: 'c3', text: 'Deploy package', done: false }
        ]
      };

      const progress = TodoChecklistEngine.getProgress(todo);
      expect(progress.total).toBe(3);
      expect(progress.completed).toBe(2);
      expect(progress.text).toBe('2/3');
      expect(Math.round(progress.percentage)).toBe(67);
    });

    it('toggles checklist items and adds/removes items cleanly', () => {
      const todo = {
        id: 'td-2',
        title: 'Review PR',
        checklist: [
          { id: 'item-1', text: 'Code review', done: false }
        ]
      };
      globalThis.todosManifest = [todo];

      // Add item
      TodoChecklistEngine.addItem('td-2', 'Documentation check');
      expect(todo.checklist.length).toBe(2);
      expect(todo.checklist[1].text).toBe('Documentation check');
      expect(todo.checklist[1].done).toBe(false);

      // Toggle item
      TodoChecklistEngine.toggleItem('td-2', 'item-1', true);
      expect(todo.checklist[0].done).toBe(true);

      // Remove item
      TodoChecklistEngine.removeItem('td-2', 'item-1');
      expect(todo.checklist.length).toBe(1);
      expect(todo.checklist[0].text).toBe('Documentation check');
    });
  });

  describe('Recurring Tasks Spawning', () => {
    it('spawns the next recurring task when completed', () => {
      const todo = {
        id: 'rec-task-1',
        title: 'Weekly Standup Prep',
        status: 'To Do',
        priority: 'High',
        owner: 'Alice',
        dueDate: '2026-09-03',
        recurrence: {
          enabled: true,
          freq: 'weekly',
          interval: 1
        },
        checklist: [
          { id: 'c1', text: 'Gather metrics', done: true },
          { id: 'c2', text: 'Prepare slides', done: true }
        ]
      };
      globalThis.todosManifest = [todo];

      const nextTodo = TodoRecurrenceEngine.completeAndSpawnNext('rec-task-1');
      expect(nextTodo).toBeDefined();
      expect(nextTodo.id).not.toBe('rec-task-1');
      expect(nextTodo.title).toBe('Weekly Standup Prep');
      expect(nextTodo.status).toBe('To Do');
      expect(nextTodo.priority).toBe('High');
      expect(nextTodo.owner).toBe('Alice');
      expect(nextTodo.dueDate).toBe('2026-09-10'); // +7 days

      // All checklist items reset to false on the spawned iteration
      expect(nextTodo.checklist.every(c => c.done === false)).toBe(true);

      // Original task is now Done
      expect(todo.status).toBe('Done');
    });

    it('supports daily recurrence', () => {
      const todo = {
        id: 'daily-1',
        title: 'Daily Inbox Zero',
        status: 'To Do',
        dueDate: '2026-09-03',
        recurrence: {
          enabled: true,
          freq: 'daily',
          interval: 1
        }
      };
      globalThis.todosManifest = [todo];

      const nextTodo = TodoRecurrenceEngine.completeAndSpawnNext('daily-1');
      expect(nextTodo.dueDate).toBe('2026-09-04');
    });
  });

  describe('Todos Board Search & Filter Engine', () => {
    beforeEach(() => {
      globalThis.todosManifest = [
        { id: 't1', title: 'Fix CSS button padding', priority: 'High', owner: 'Alex', status: 'To Do', workstream: 'Design' },
        { id: 't2', title: 'Refactor database schema', priority: 'Medium', owner: 'Sam', status: 'WIP', workstream: 'Backend' },
        { id: 't3', title: 'Write user documentation', priority: 'Low', owner: 'Alex', status: 'Done', workstream: 'Content' }
      ];
    });

    it('filters tasks by search keyword across title and owner', () => {
      const results = TodoFilterEngine.filterList(globalThis.todosManifest, { query: 'css' });
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('t1');

      const ownerResults = TodoFilterEngine.filterList(globalThis.todosManifest, { query: 'Sam' });
      expect(ownerResults.length).toBe(1);
      expect(ownerResults[0].id).toBe('t2');
    });

    it('filters tasks by assignee chip', () => {
      const results = TodoFilterEngine.filterList(globalThis.todosManifest, { assignee: 'Alex' });
      expect(results.length).toBe(2);
    });

    it('filters tasks by workstream chip', () => {
      const results = TodoFilterEngine.filterList(globalThis.todosManifest, { workstream: 'Backend' });
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('t2');
    });
  });

  describe('Task Modal Owner & Requester Assignment (saveTodoFromOverlay)', () => {
    beforeEach(() => {
      document.body.innerHTML = `
        <div id="todo-edit-overlay">
          <input id="todo-edit-title" value="Refactor API client" />
          <select id="todo-edit-quadrant"><option value="Q1" selected>Q1</option></select>
          <select id="todo-edit-workstream"><option value="Core" selected>Core</option></select>
          <textarea id="todo-edit-context">Add retry support</textarea>
          <div id="todo-edit-owner-picker"></div>
          <div id="todo-edit-asked-by-picker"></div>
          <input type="checkbox" id="todo-edit-recurrence-enabled" />
        </div>
      `;
      globalThis.getColleagueLabelById = (id, fallback) => {
        if (id === 'collab-sarah') return 'Sarah';
        if (id === 'collab-alex') return 'Alex';
        if (id === 'me') return 'Me';
        return fallback || id;
      };
      globalThis.getDefaultMeLabel = () => 'Me';
      globalThis.saveTodosManifest = async () => {};
      globalThis.updateTodoLinkedNote = async () => {};
    });

    it('updates owner and askedBy when editing an existing task in the modal', async () => {
      const existingTodo = {
        id: 'todo-edit-1',
        title: 'Refactor API client',
        priority: 'Q1',
        owner: 'Me',
        ownerId: 'me',
        status: ''
      };
      globalThis.todosManifest = [existingTodo];
      globalThis._todoOverlayFile = 'todo-edit-1';
      globalThis._todoModalStatus = 'pending';
      globalThis._todoModalDueDate = '2026-09-20';
      globalThis._todoModalDependsOn = [];

      // Set owner picker to Sarah
      const ownerPicker = document.getElementById('todo-edit-owner-picker');
      ownerPicker.innerHTML = `<span class="tag-pill tag topic-tag" data-colleague-id="collab-sarah" data-tag="Sarah">Sarah <button class="rm">×</button></span>`;

      // Set asked-by picker to Alex
      const askedByPicker = document.getElementById('todo-edit-asked-by-picker');
      askedByPicker.innerHTML = `<span class="tag-pill tag topic-tag" data-colleague-id="collab-alex" data-tag="Alex">Alex <button class="rm">×</button></span>`;

      await saveTodoFromOverlay();

      expect(existingTodo.ownerId).toBe('collab-sarah');
      expect(existingTodo.owner).toBe('Sarah');
      expect(existingTodo.askedById).toBe('collab-alex');
      expect(existingTodo.askedBy).toBe('Alex');
    });

    it('sets owner and askedBy when creating a new task from the modal', async () => {
      globalThis._todoOverlayFile = null;
      globalThis._todoModalStatus = 'pending';
      globalThis._todoModalDueDate = '2026-09-25';
      globalThis._todoModalDependsOn = [];

      // Set owner picker to Sarah
      const ownerPicker = document.getElementById('todo-edit-owner-picker');
      ownerPicker.innerHTML = `<span class="tag-pill tag topic-tag" data-colleague-id="collab-sarah" data-tag="Sarah">Sarah <button class="rm">×</button></span>`;

      // Set asked-by picker to Alex
      const askedByPicker = document.getElementById('todo-edit-asked-by-picker');
      askedByPicker.innerHTML = `<span class="tag-pill tag topic-tag" data-colleague-id="collab-alex" data-tag="Alex">Alex <button class="rm">×</button></span>`;

      await saveTodoFromOverlay();

      expect(globalThis.todosManifest.length).toBe(1);
      const created = globalThis.todosManifest[0];
      expect(created.title).toBe('Refactor API client');
      expect(created.ownerId).toBe('collab-sarah');
      expect(created.owner).toBe('Sarah');
      expect(created.askedById).toBe('collab-alex');
      expect(created.askedBy).toBe('Alex');
    });

    it('populates and reads owner correctly via populateCollaboratorPicker and readCollaboratorPicker', () => {
      globalThis.getAllColleagueRecords = () => [
        { id: 'me', label: 'Me' },
        { id: 'collab-sarah', label: 'Sarah' },
        { id: 'collab-alex', label: 'Alex' }
      ];

      populateCollaboratorPicker('todo-edit-owner-picker', 'collab-sarah', {
        allowEmpty: false,
        includeMe: true,
        createOnType: true
      });

      const readVal = readCollaboratorPicker('todo-edit-owner-picker');
      expect(readVal).toBe('collab-sarah');

      const aliasVal = getCollaboratorPickerValue('todo-edit-owner-picker');
      expect(aliasVal).toBe('collab-sarah');
    });

    it('opens new todo dialog with custom owner and askedBy', async () => {
      globalThis.getAllColleagueRecords = () => [
        { id: 'me', label: 'Me' },
        { id: 'collab-sarah', label: 'Sarah' },
        { id: 'collab-alex', label: 'Alex' }
      ];

      await openNewTodoDialog({
        title: 'Design wireframes',
        ownerId: 'collab-alex',
        askedById: 'collab-sarah'
      });

      expect(readCollaboratorPicker('todo-edit-owner-picker')).toBe('collab-alex');
      expect(readCollaboratorPicker('todo-edit-asked-by-picker')).toBe('collab-sarah');
    });
  });
});
