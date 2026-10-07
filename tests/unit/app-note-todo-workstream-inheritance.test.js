import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Note Todo Workstream Inheritance', () => {
  beforeAll(() => {
    loadScriptsIntoGlobal([
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-utils.js',
      'js/app-state.js',
      'js/app-board.js',
      'js/app-notes.js',
      'js/app-todos-board.js',
      'js/app-chat.js',
      'js/app-llm.js',
      'js/app-overlay.js'
    ]);
  });

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="edit-textarea" contenteditable="true"></div>
      <div id="editor-extra"></div>
      <div id="edit-title"></div>
    `;

    global.todosManifest = [];
    global.saveTodosManifest = vi.fn().mockResolvedValue(true);
    global.saveManifest = vi.fn().mockResolvedValue(true);
    const testNote = {
      id: 'note-ws-101',
      path: 'notes/architecture-strategy.html',
      title: 'Architecture Strategy',
      workstream: 'Platform Engineering',
      workstreams: ['Platform Engineering'],
      originalHTML: '<!doctype html><html><head><meta name="workstream" content="Platform Engineering"></head><body><main><p>Some content</p></main></body></html>',
      mainHTML: '<p>Some content</p>'
    };

    if (typeof todosManifest !== 'undefined') todosManifest = [];
    global.todosManifest = [];
    window.todosManifest = global.todosManifest;

    if (typeof manifest !== 'undefined') manifest = [testNote];
    global.manifest = [testNote];
    window.manifest = global.manifest;

    if (typeof currentNote !== 'undefined') currentNote = testNote;
    global.currentNote = testNote;
    window.currentNote = testNote;

    global.StorageAPI = {
      readNoteContent: vi.fn().mockResolvedValue(testNote.originalHTML),
      writeNoteContent: vi.fn().mockResolvedValue(true),
      hasTodosManifest: vi.fn().mockResolvedValue(true),
      readTodosManifest: vi.fn().mockResolvedValue([]),
      writeTodosManifest: vi.fn().mockResolvedValue(true)
    };
  });

  it('assigns note workstream when creating todo via wrapSelectionWithTodo in note editor', async () => {
    const editor = document.getElementById('edit-textarea');
    editor.innerHTML = 'Refactor database client layer';
    
    // Select text in editor
    const range = document.createRange();
    range.selectNodeContents(editor);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    await wrapSelectionWithTodo('High');

    expect(global.todosManifest.length).toBe(1);
    const created = global.todosManifest[0];
    expect(created.noteId).toBe('note-ws-101');
    expect(created.workstream).toBe('Platform Engineering');
    expect(created.major_topic_tags).toContain('Platform Engineering');
  });

  it('assigns note workstream when creating todo via createTodoFromMarker', async () => {
    const todoId = 'ntodo-marker-1';
    global.currentNote.originalHTML = `<!doctype html><html><head><meta name="workstream" content="Platform Engineering"></head><body><main><p><span class="note-todo" data-todo-id="${todoId}" data-todo-priority="Medium"><span class="note-todo-text">Implement caching</span></span></p></main></body></html>`;
    global.currentNote.mainHTML = `<p><span class="note-todo" data-todo-id="${todoId}" data-todo-priority="Medium"><span class="note-todo-text">Implement caching</span></span></p>`;

    await createTodoFromMarker(todoId);

    const created = global.todosManifest.find(t => t.id === todoId);
    expect(created).toBeDefined();
    expect(created.workstream).toBe('Platform Engineering');
    expect(created.major_topic_tags).toContain('Platform Engineering');
  });

  it('assigns note workstream when auto-creating missing todos via createMissingTodosForCurrentNote', async () => {
    const todoId = 'ntodo-marker-2';
    const editor = document.getElementById('edit-textarea');
    editor.innerHTML = `<p><span class="note-todo" data-todo-id="${todoId}" data-todo-priority="Low"><span class="note-todo-text">Update documentation</span></span></p>`;

    await createMissingTodosForCurrentNote();

    const created = global.todosManifest.find(t => t.id === todoId);
    expect(created).toBeDefined();
    expect(created.workstream).toBe('Platform Engineering');
    expect(created.major_topic_tags).toContain('Platform Engineering');
  });

  it('assigns note workstream when creating todo via createTodoFromMarkerEditMode', async () => {
    const todoId = 'ntodo-marker-3';
    const editor = document.getElementById('edit-textarea');
    editor.innerHTML = `<p><span class="note-todo" data-todo-id="${todoId}" data-todo-priority="High"><span class="note-todo-text">Deploy Kubernetes cluster</span></span></p>`;

    await createTodoFromMarkerEditMode(todoId);

    const created = global.todosManifest.find(t => t.id === todoId);
    expect(created).toBeDefined();
    expect(created.workstream).toBe('Platform Engineering');
    expect(created.major_topic_tags).toContain('Platform Engineering');
  });

  it('assigns note workstream when normalizing todo linked to a note with a workstream', () => {
    const rawTodo = {
      id: 'todo-normalize-1',
      title: 'Normalize Test Task',
      priority: 'Medium',
      noteId: 'note-ws-101'
    };

    const normalized = normalizeTodoEntry(rawTodo);
    expect(normalized.workstream).toBe('Platform Engineering');
    expect(normalized.major_topic_tags).toContain('Platform Engineering');
  });

  it('assigns note workstream when executing AI suggestion create_todo within note context', async () => {
    if (typeof AIChatController !== 'undefined') {
      AIChatController.saveCurrentConversation = vi.fn();
      await AIChatController.executeSuggestion({
        action: 'create_todo',
        properties: {
          title: 'Review PR #99',
          priority: 'Medium',
          context_link: 'note-ws-101'
        }
      });

      const created = global.todosManifest.find(t => t.title === 'Review PR #99');
      expect(created).toBeDefined();
      expect(created.workstream).toBe('Platform Engineering');
      expect(created.major_topic_tags).toContain('Platform Engineering');
    }
  });
});
