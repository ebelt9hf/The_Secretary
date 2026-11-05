import { describe, it, expect, beforeEach, beforeAll, afterEach, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Cross-Entity Lifecycle Pruning & Cooperative Sync (Tasks, Colleagues, Labels & Chat)', () => {
  beforeAll(() => {
    loadScriptsIntoGlobal([
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-utils.js',
      'js/app-state.js',
      'js/app-notes.js',
      'js/app-board.js',
      'js/app-todos-board.js',
      'js/app-collab.js',
      'js/app-chat.js',
      'js/app-init.js'
    ]);
  });

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="todo-edit-overlay" style="display:none;"></div>
      <div id="chat-attachments-container" style="display:none;"></div>
      <div id="modal-collab-details" style="display:none;"></div>
    `;

    globalThis.localStorage = {
      _store: {},
      getItem(k) { return this._store[k] || null; },
      setItem(k, v) { this._store[k] = String(v); },
      removeItem(k) { delete this._store[k]; }
    };

    globalThis.toast = vi.fn();
    globalThis.toastAction = vi.fn();
    globalThis.showConfirmDialog = vi.fn().mockResolvedValue(true);
    globalThis.showPromptDialog = vi.fn().mockResolvedValue('Updated Item');
    globalThis.broadcastSync = vi.fn();
    globalThis.refreshTodoViews = vi.fn();
    globalThis.renderPlanner = vi.fn();
    globalThis.renderPlannerInspector = vi.fn();
    globalThis.renderTeamPanel = vi.fn();
    globalThis.renderBoard = vi.fn();
    globalThis.renderFilterChips = vi.fn();
    globalThis.rebuildIndexHTML = vi.fn().mockResolvedValue(true);
    globalThis.closeModal = vi.fn();
    globalThis.scheduleSyncRefresh = vi.fn();
    globalThis.savePlanner = vi.fn().mockResolvedValue(true);
    globalThis.saveTodosManifest = vi.fn().mockResolvedValue(true);
    globalThis.saveManifest = vi.fn().mockResolvedValue(true);

    globalThis.StorageAPI = {
      readNoteContent: vi.fn().mockResolvedValue('<!DOCTYPE html><html><body><main></main></body></html>'),
      writeNoteContent: vi.fn().mockResolvedValue(true),
      readColleagues: vi.fn().mockResolvedValue(null),
      writeColleagues: vi.fn().mockResolvedValue(true),
      hasColleagues: vi.fn().mockResolvedValue(true),
      getStorageEngine: vi.fn().mockReturnValue('local')
    };

    globalThis.manifest = [];
    globalThis.todosManifest = [];
    globalThis.plannerEvents = [];
    globalThis.window.plannerEvents = globalThis.plannerEvents;
    globalThis.currentNote = null;
    globalThis._todoOverlayFile = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * 1. Protected Behavior: `deleteTodoById` immediately closes the open todo modal, prunes in-memory
   *    `todosManifest`, converts calendar blocks linked to this todo from `type: 'todo'` to `type: 'work'`,
   *    prunes chat attachments, and broadcasts `TODO_DELETED`.
   * 2. Regression Target: If `deleteTodoById` left planner blocks with dangling `todoId` or failed to
   *    broadcast `TODO_DELETED`, calendar sync and other open windows would fail to reflect task deletion.
   * 3. Coverage Overlap: Unique test covering todo deletion across planner, chat, and multi-window sync.
   * 4. Production Footprint: Exercises public production contracts `deleteTodoById`, `plannerEvents`, `AIChatController`.
   */
  it('instantly dismisses todo modal, cleans planner events, prunes chat attachments, and broadcasts TODO_DELETED', async () => {
    const todoId = 'todo-del-999';
    globalThis.todosManifest = [
      { id: todoId, title: 'Write Architecture Docs', noteId: '' },
      { id: 'todo-other-1', title: 'Keep this', noteId: '' }
    ];
    globalThis.plannerEvents = [
      { id: 'pe-1', title: 'Focus on Architecture Docs', type: 'todo', todoId: todoId, linkedTodoIds: [todoId] },
      { id: 'pe-2', title: 'Call with Team', type: 'call', todoId: '', linkedTodoIds: [todoId, 'todo-other-1'] }
    ];
    globalThis._todoOverlayFile = todoId;

    if (globalThis.AIChatController) {
      globalThis.AIChatController.currentConversationId = 'conv-test-1';
      globalThis.AIChatController.attachedTasks = [todoId, 'todo-other-1'];
      globalThis.localStorage.setItem('secretary_conv_tasks_conv-test-1', JSON.stringify([todoId, 'todo-other-1']));
    }

    const result = await globalThis.deleteTodoById(todoId, { confirmDelete: true });
    expect(result).toBe(true);

    // Modal closed immediately
    expect(globalThis._todoOverlayFile).toBeNull();

    // Todos manifest filtered
    expect(globalThis.todosManifest.some(t => t.id === todoId)).toBe(false);
    expect(globalThis.todosManifest.length).toBe(1);

    // Planner event 1 converted from 'todo' to 'work' and todoId cleared
    const pe1 = globalThis.plannerEvents.find(e => e.id === 'pe-1');
    expect(pe1.todoId).toBe('');
    expect(pe1.type).toBe('work');
    expect(pe1.linkedTodoIds).toEqual([]);

    // Planner event 2 linkedTodoIds pruned
    const pe2 = globalThis.plannerEvents.find(e => e.id === 'pe-2');
    expect(pe2.linkedTodoIds).toEqual(['todo-other-1']);

    // AIChatController attached tasks pruned
    if (globalThis.AIChatController) {
      expect(globalThis.AIChatController.attachedTasks).toEqual(['todo-other-1']);
      const stored = JSON.parse(globalThis.localStorage.getItem('secretary_conv_tasks_conv-test-1') || '[]');
      expect(stored).toEqual(['todo-other-1']);
    }

    // Broadcast sync dispatched
    expect(globalThis.broadcastSync).toHaveBeenCalledWith({ type: 'TODO_DELETED', todoId });
  });

  /**
   * 1. Protected Behavior: `handleSyncMessage` receives `TODO_DELETED` from another window,
   *    closes local overlay if viewing that task, cleans in-memory `todosManifest` and `plannerEvents`,
   *    prunes chat attachments, and schedules view refresh.
   * 2. Regression Target: If `handleSyncMessage` does not handle `TODO_DELETED`, tasks deleted on a
   *    secondary window would remain stale on the primary window until manually reloaded.
   * 3. Coverage Overlap: Exercises receiver side of the cooperative sync pipeline.
   * 4. Production Footprint: Tests authentic `handleSyncMessage` handler with production data structures.
   */
  it('handles remote TODO_DELETED message to prune local state and close open task modal', async () => {
    const remoteTodoId = 'todo-remote-555';
    globalThis.todosManifest = [
      { id: remoteTodoId, title: 'Remote Task' }
    ];
    globalThis.plannerEvents = [
      { id: 'pe-remote', title: 'Remote Task Bloc', type: 'todo', todoId: remoteTodoId, linkedTodoIds: [remoteTodoId] }
    ];
    globalThis._todoOverlayFile = remoteTodoId;

    if (globalThis.AIChatController) {
      globalThis.AIChatController.attachedTasks = [remoteTodoId];
    }

    await globalThis.handleSyncMessage({
      data: {
        type: 'TODO_DELETED',
        todoId: remoteTodoId,
        senderId: 'remote-win-1',
        msgId: 'msg-' + Date.now()
      }
    });

    // In-memory manifests cleaned
    expect(globalThis.todosManifest.some(t => t.id === remoteTodoId)).toBe(false);
    const pe = globalThis.plannerEvents.find(e => e.id === 'pe-remote');
    expect(pe.todoId).toBe('');
    expect(pe.type).toBe('work');
    expect(pe.linkedTodoIds).toEqual([]);

    // Open overlay closed
    expect(globalThis._todoOverlayFile).toBeNull();
    expect(globalThis.scheduleSyncRefresh).toHaveBeenCalledWith(expect.objectContaining({ todos: true }));
  });

  /**
   * 1. Protected Behavior: `deleteColleagueEntirelyGlobal` removes colleague from `colleaguesDb`,
   *    reassigns their owned tasks in `todosManifest` back to `'me'`, removes their collaborator links,
   *    and prunes `event.collaboratorName` and `event.collaborators` in `plannerEvents`.
   * 2. Regression Target: If `deleteColleagueEntirelyGlobal` left colleague names in tasks or planner events,
   *    tasks would retain dead owner references and filtered views would crash or show phantom assignments.
   * 3. Coverage Overlap: Validates colleague deletion across team DB, todos manifest, and calendar events.
   * 4. Production Footprint: Uses authentic `deleteColleagueEntirelyGlobal` and global collections.
   */
  it('cleanses colleague references from todosManifest and plannerEvents when deleting colleague entirely', async () => {
    const colleagueName = 'Alice Wonderland';
    globalThis.colleaguesDb = {
      version: 1,
      colleagues: [
        { id: 'colleague-alice', label: colleagueName, role: 'Engineer' },
        { id: 'colleague-bob', label: 'Bob', role: 'Designer' }
      ],
      teams: [
        { id: 'team-eng', name: 'Engineering', managerId: 'colleague-alice' }
      ]
    };
    if (typeof reindexColleaguesDb === 'function') reindexColleaguesDb();

    globalThis.todosManifest = [
      { id: 't1', title: 'Task 1', owner: colleagueName, ownerId: 'colleague-alice', askedBy: colleagueName, collaborators: [colleagueName, 'Bob'] },
      { id: 't2', title: 'Task 2', owner: 'me', ownerId: 'me', askedBy: '', collaborators: ['Bob'] }
    ];

    globalThis.plannerEvents = [
      { id: 'evt-1', title: '1:1 with Alice', type: 'sync', collaboratorName: colleagueName, collaborators: [colleagueName, 'Bob'] },
      { id: 'evt-2', title: 'Personal Sync', type: 'personal', collaboratorName: '', collaborators: ['Bob'] }
    ];

    await globalThis.deleteColleagueEntirelyGlobal(colleagueName);

    // Colleagues DB updated
    expect(globalThis.colleaguesDb.colleagues.some(c => c.id === 'colleague-alice')).toBe(false);
    expect(globalThis.colleaguesDb.teams.find(t => t.id === 'team-eng').managerId).toBe('');

    // Todos manifest cleansed
    const t1 = globalThis.todosManifest.find(t => t.id === 't1');
    expect(t1.ownerId).toBe('me');
    expect(['me', 'Me'].includes(t1.owner)).toBe(true);
    expect(t1.askedBy).toBe('');
    expect(t1.collaborators).toEqual(['Bob']);

    // Planner events cleansed
    const evt1 = globalThis.plannerEvents.find(e => e.id === 'evt-1');
    expect(evt1.collaboratorName).toBe('');
    expect(evt1.collaborators).toEqual(['Bob']);

    // Sync broadcast dispatched
    expect(globalThis.broadcastSync).toHaveBeenCalledWith({ type: 'COLLEAGUES_UPDATED' });
  });

  /**
   * 1. Protected Behavior: `renameLabelAcrossNotes` and `removeLabelAcrossNotes` propagate tag changes
   *    and workstream updates to `plannerEvents` and `todosManifest`.
   * 2. Regression Target: Renaming a workstream previously only altered note HTML and manifest,
   *    leaving tasks and planner blocks referencing the old obsolete label.
   * 3. Coverage Overlap: Verifies bi-directional workstream and tag synchronization.
   * 4. Production Footprint: Calls authentic `renameLabelAcrossNotes` and `removeLabelAcrossNotes`.
   */
  it('synchronizes label renames and removals across notes, todos, and planner events', async () => {
    globalThis.manifest = [
      { id: 'n1', path: 'notes/1.html', major_topic_tags: ['Alpha Project'] }
    ];
    globalThis.todosManifest = [
      { id: 't1', title: 'Task in Alpha', workstream: 'Alpha Project', major_topic_tags: ['Alpha Project'] }
    ];
    globalThis.plannerEvents = [
      { id: 'pe1', title: 'Alpha Milestone', type: 'work', major_topic_tags: ['Alpha Project'] }
    ];

    // Rename 'Alpha Project' -> 'Beta Initiative'
    await globalThis.renameLabelAcrossNotes('major', 'Alpha Project', 'Beta Initiative');

    const updatedTodo = globalThis.todosManifest.find(t => t.id === 't1');
    expect(updatedTodo.workstream).toBe('Beta Initiative');
    expect(updatedTodo.major_topic_tags).toEqual(['Beta Initiative']);

    const updatedEvent = globalThis.plannerEvents.find(e => e.id === 'pe1');
    expect(updatedEvent.major_topic_tags).toEqual(['Beta Initiative']);

    // Remove 'Beta Initiative'
    await globalThis.removeLabelAcrossNotes('major', 'Beta Initiative');

    const removedTodo = globalThis.todosManifest.find(t => t.id === 't1');
    expect(removedTodo.workstream).toBe('');
    expect(removedTodo.major_topic_tags).toEqual([]);

    const removedEvent = globalThis.plannerEvents.find(e => e.id === 'pe1');
    expect(removedEvent.major_topic_tags).toEqual([]);
  });
});
