import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Todo Fusion / Merging Engine', () => {
  beforeAll(() => {
    loadScriptsIntoGlobal([
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-utils.js',
      'js/app-state.js',
      'js/app-board.js',
      'js/app-notes.js',
      'js/app-todos-board.js'
    ]);
  });

  beforeEach(() => {
    global.saveTodosManifest = vi.fn().mockResolvedValue(true);
    global.renderTodoChecklistInModal = vi.fn();
    global.renderTodoUpdatesInModal = vi.fn();
    global.setTodoOverlayBusy = vi.fn();
    global.toast = vi.fn();

    global.manifest = [
      { id: 'note-1', path: 'notes/meeting.html' }
    ];

    global.window.plannerEvents = [
      { id: 'evt-1', todoId: 'todo-secondary', linkedTodoIds: ['todo-secondary', 'todo-other'] }
    ];

    global.StorageAPI = {
      readNoteContent: vi.fn().mockResolvedValue('<div data-todo-id="todo-secondary">Task in note</div>'),
      writeNoteContent: vi.fn().mockResolvedValue(true),
      writePlanner: vi.fn().mockResolvedValue(true)
    };

    global.StateBus = {
      emit: vi.fn()
    };
  });

  describe('UI Panel Controls & Candidate Search', () => {
    it('opens and closes merge panel cleanly', () => {
      document.body.innerHTML = `
        <div id="todo-edit-merge-panel" style="display:none;"></div>
        <input type="text" id="todo-edit-merge-search">
        <div id="todo-edit-merge-preview" style="display:block;"></div>
        <div id="todo-edit-merge-candidates-list"></div>
      `;

      global._todoOverlayFile = 'todo-1';
      global.todosManifest = [
        { id: 'todo-1', title: 'Task 1', owner: 'me' },
        { id: 'todo-2', title: 'Task 2', owner: 'Bob', workstream: 'Eng' }
      ];

      openTodoMergePanel();

      const panel = document.getElementById('todo-edit-merge-panel');
      const preview = document.getElementById('todo-edit-merge-preview');
      expect(panel.style.display).toBe('block');
      expect(preview.style.display).toBe('none');

      closeTodoMergePanel();
      expect(panel.style.display).toBe('none');
      expect(global._selectedMergeCandidateId).toBeNull();
    });

    it('filters merge candidates by query and excludes current overlay task', () => {
      document.body.innerHTML = `
        <div id="todo-edit-merge-candidates-list"></div>
      `;

      global._todoOverlayFile = 'todo-1';
      global.todosManifest = [
        { id: 'todo-1', title: 'Task 1 to edit', owner: 'me' },
        { id: 'todo-2', title: 'Design Homepage Mockup', owner: 'Alice', workstream: 'Design' },
        { id: 'todo-3', title: 'Backend API Endpoint', owner: 'Bob', workstream: 'Engineering' }
      ];

      filterTodoMergeCandidates('Design');

      const list = document.getElementById('todo-edit-merge-candidates-list');
      expect(list.innerHTML).toContain('Design Homepage Mockup');
      expect(list.innerHTML).not.toContain('Task 1 to edit');
      expect(list.innerHTML).not.toContain('Backend API Endpoint');

      // When no matching candidate found
      filterTodoMergeCandidates('NonExistentXYZ');
      expect(list.innerHTML).toContain(t('todo.mergeNoCandidates'));
    });

    it('selects a candidate and computes combined preview summary', () => {
      document.body.innerHTML = `
        <div id="todo-edit-merge-preview" style="display:none;"></div>
        <div id="todo-edit-merge-preview-content"></div>
      `;

      const primary = {
        id: 'todo-p',
        title: 'Primary Task',
        checklist: [{ text: 'Item 1' }]
      };
      const candidate = {
        id: 'todo-c',
        title: 'Candidate Task',
        checklist: [{ text: 'Item 2' }, { text: 'Item 3' }],
        updates: [{ date: '2026-09-01', text: 'Started' }]
      };

      global.todosManifest = [primary, candidate];
      global.getTodoById = (id) => global.todosManifest.find(x => x.id === id);
      global._todoOverlayFile = 'todo-p';
      global._todoModalUpdates = [{ date: '2026-09-02', text: 'In progress' }];

      selectTodoMergeCandidate('todo-c');

      expect(global._selectedMergeCandidateId).toBe('todo-c');
      const preview = document.getElementById('todo-edit-merge-preview');
      const previewContent = document.getElementById('todo-edit-merge-preview-content');

      expect(preview.style.display).toBe('block');
      expect(previewContent.innerHTML).toContain('Primary Task');
      expect(previewContent.innerHTML).toContain('Candidate Task');
      expect(previewContent.innerHTML).toContain('3'); // 1 + 2 subtasks
      expect(previewContent.innerHTML).toContain('2'); // 1 + 1 updates
    });
  });

  describe('confirmExecuteTodoMerge execution and vault propagation', () => {
    it('returns early when no candidate is selected or overlay file is missing', async () => {
      global._selectedMergeCandidateId = null;
      global._todoOverlayFile = null;

      await confirmExecuteTodoMerge();

      expect(global.saveTodosManifest).not.toHaveBeenCalled();
    });

    it('merges secondary task into primary task, rewrites vault notes, calendar links, and dependencies', async () => {
      const primaryTodo = {
        id: 'todo-primary',
        title: 'Primary Task',
        context: 'Initial primary description',
        checklist: [{ id: 'chk-1', text: 'Subtask 1', done: false }],
        updates: [{ id: 'u1', date: '2026-09-01', type: 'general_update', text: 'Started' }],
        depends_on: ['todo-other'],
        major_topic_tags: ['Feature A']
      };

      const secondaryTodo = {
        id: 'todo-secondary',
        title: 'Secondary Task to Merge',
        context: 'Secondary details to append',
        checklist: [
          { id: 'chk-1-dup', text: 'Subtask 1', done: true }, // Duplicate text should be skipped
          { id: 'chk-2', text: 'Subtask 2', done: true }
        ],
        updates: [{ id: 'u2', date: '2026-09-02', type: 'feedback_received', text: 'Design approved' }],
        depends_on: ['todo-prereq'],
        major_topic_tags: ['Feature B']
      };

      const otherDependentTodo = {
        id: 'todo-dep',
        title: 'Dependent Task',
        depends_on: ['todo-secondary']
      };

      global.todosManifest = [primaryTodo, secondaryTodo, otherDependentTodo];
      global.getTodoById = (id) => global.todosManifest.find(x => x.id === id);
      global._todoOverlayFile = 'todo-primary';
      global._selectedMergeCandidateId = 'todo-secondary';
      global._todoModalUpdates = [...primaryTodo.updates];
      global._todoModalDependsOn = [...primaryTodo.depends_on];

      document.body.innerHTML = `
        <textarea id="todo-edit-context"></textarea>
      `;

      await confirmExecuteTodoMerge();

      // 1. Checklist items absorbed without duplicates
      expect(primaryTodo.checklist.length).toBe(2);
      expect(primaryTodo.checklist.some(c => c.text === 'Subtask 2')).toBe(true);

      // 2. Context absorbed
      expect(primaryTodo.context).toContain('Secondary details to append');
      expect(primaryTodo.context).toContain('Merged from [Secondary Task to Merge]');

      // 3. Updates absorbed with [Merged] prefix
      expect(global._todoModalUpdates.length).toBe(2);
      expect(global._todoModalUpdates.some(u => u.text.includes('[Merged]: Design approved'))).toBe(true);

      // 4. Tags and dependencies absorbed
      expect(primaryTodo.major_topic_tags).toContain('Feature B');
      expect(global._todoModalDependsOn).toContain('todo-prereq');

      // 5. Note HTML rewritten with primary ID
      expect(global.StorageAPI.writeNoteContent).toHaveBeenCalledWith(
        'notes/meeting.html',
        '<div data-todo-id="todo-primary">Task in note</div>'
      );

      // 6. Planner event rewritten
      expect(global.window.plannerEvents[0].todoId).toBe('todo-primary');
      expect(global.window.plannerEvents[0].linkedTodoIds).toContain('todo-primary');
      expect(global.window.plannerEvents[0].linkedTodoIds).not.toContain('todo-secondary');

      // 7. Dependent task updated
      expect(otherDependentTodo.depends_on).toContain('todo-primary');
      expect(otherDependentTodo.depends_on).not.toContain('todo-secondary');

      // 8. Secondary task deleted from manifest
      expect(global.todosManifest.find(t => t.id === 'todo-secondary')).toBeUndefined();

      // 9. StateBus events emitted
      expect(global.StateBus.emit).toHaveBeenCalledWith('todo:update:todo-primary', { todo: primaryTodo });
      expect(global.StateBus.emit).toHaveBeenCalledWith('todo:deleted', { id: 'todo-secondary' });
      expect(global.toast).toHaveBeenCalled();
    });
  });
});
