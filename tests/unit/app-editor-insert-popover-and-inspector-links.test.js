import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Note Editor Toolbar Layout, Insert Popover & Key Idea Block', () => {
  let templateHtml;

  beforeAll(() => {
    const templatePath = path.resolve(process.cwd(), 'templates/note-editor-overlay.html');
    templateHtml = fs.readFileSync(templatePath, 'utf-8');

    globalThis.t = (k) => k;
    globalThis.escH = (s) => String(s || '');
    globalThis.escA = (s) => String(s || '');
    globalThis.toast = vi.fn();

    loadScriptsIntoGlobal([
      'js/app-state.js',
      'js/app-utils.js',
      'js/app-collab.js',
      'js/app-overlay.js',
      'js/app-llm.js',
      'js/app-i18n.js'
    ]);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    delete globalThis.window.electronAPI;

    document.body.innerHTML = `
      <div id="screen-main">
        ${templateHtml}
      </div>
      <div id="inspector-panel-container"></div>
    `;

    globalThis.currentNote = {
      id: 'note-101',
      title: 'Sprint Planning',
      path: 'notes/sprint-planning.md',
      date: '2026-10-04'
    };

    globalThis.todosManifest = [
      { id: 'todo-1', title: 'Review pull request', priority: 'High', noteId: 'note-101' },
      { id: 'todo-2', title: 'Prepare slide deck', priority: 'Medium', noteId: '' }
    ];
  });

  describe('Insert Items Popover & Progressive Disclosure', () => {
    it('renders the insert button and popover with all action items including horizontal line', () => {
      const insertBtn = document.getElementById('btn-insert-items');
      const popover = document.getElementById('insert-items-popover');
      expect(insertBtn).toBeTruthy();
      expect(popover).toBeTruthy();
      expect(popover.style.display).toBe('none');

      // Verify all 5 action items exist inside popover
      const todoBtn = document.getElementById('todo-btn-add');
      const decisionBtn = document.getElementById('decision-btn-add');
      const hrBtn = document.getElementById('hr-btn-add');
      const linkBtn = document.getElementById('todo-link-btn');
      const templateBtn = document.getElementById('btn-apply-template');

      expect(popover.contains(todoBtn)).toBe(true);
      expect(popover.contains(decisionBtn)).toBe(true);
      expect(popover.contains(hrBtn)).toBe(true);
      expect(popover.contains(linkBtn)).toBe(true);
      expect(popover.contains(templateBtn)).toBe(true);

      // Verify titles/tooltips
      expect(insertBtn.getAttribute('title')).toBeTruthy();
      expect(todoBtn.getAttribute('title')).toBeTruthy();
      expect(decisionBtn.getAttribute('title')).toBeTruthy();
      expect(hrBtn.getAttribute('title')).toBeTruthy();
      expect(linkBtn.getAttribute('title')).toBeTruthy();
      expect(templateBtn.getAttribute('title')).toBeTruthy();
    });

    it('toggles insert items popover open and closed', () => {
      const insertBtn = document.getElementById('btn-insert-items');
      const popover = document.getElementById('insert-items-popover');

      // 1. Open popover
      toggleInsertItemsPopover({ currentTarget: insertBtn, preventDefault: vi.fn(), stopPropagation: vi.fn() });
      expect(popover.style.display).toBe('flex');
      expect(insertBtn.classList.contains('active')).toBe(true);
      expect(insertBtn.getAttribute('aria-expanded')).toBe('true');

      // 2. Close popover via toggle
      toggleInsertItemsPopover({ currentTarget: insertBtn, preventDefault: vi.fn(), stopPropagation: vi.fn() });
      expect(popover.style.display).toBe('none');
      expect(insertBtn.classList.contains('active')).toBe(false);
      expect(insertBtn.getAttribute('aria-expanded')).toBe('false');

      // 3. Close popover via closeInsertItemsPopover()
      toggleInsertItemsPopover({ currentTarget: insertBtn, preventDefault: vi.fn(), stopPropagation: vi.fn() });
      expect(popover.style.display).toBe('flex');
      closeInsertItemsPopover();
      expect(popover.style.display).toBe('none');
      expect(insertBtn.classList.contains('active')).toBe(false);
    });

    it('closes insert items popover and invokes appropriate handlers when actions are clicked', () => {
      const insertBtn = document.getElementById('btn-insert-items');
      const popover = document.getElementById('insert-items-popover');

      // Add Todo
      toggleInsertItemsPopover({ currentTarget: insertBtn, preventDefault: vi.fn(), stopPropagation: vi.fn() });
      expect(popover.style.display).toBe('flex');
      globalThis.toggleTodoPriority = vi.fn();
      const todoBtn = document.getElementById('todo-btn-add');
      new Function('event', todoBtn.getAttribute('onclick')).call(todoBtn, new MouseEvent('click'));
      expect(globalThis.toggleTodoPriority).toHaveBeenCalledWith('Medium');
      expect(popover.style.display).toBe('none');

      // Add Decision
      toggleInsertItemsPopover({ currentTarget: insertBtn, preventDefault: vi.fn(), stopPropagation: vi.fn() });
      expect(popover.style.display).toBe('flex');
      globalThis.toggleDecision = vi.fn();
      const decisionBtn = document.getElementById('decision-btn-add');
      new Function('event', decisionBtn.getAttribute('onclick')).call(decisionBtn, new MouseEvent('click'));
      expect(globalThis.toggleDecision).toHaveBeenCalledTimes(1);
      expect(popover.style.display).toBe('none');

      // Add Horizontal Rule / Line
      toggleInsertItemsPopover({ currentTarget: insertBtn, preventDefault: vi.fn(), stopPropagation: vi.fn() });
      expect(popover.style.display).toBe('flex');
      globalThis.insertMd = vi.fn();
      const hrBtn = document.getElementById('hr-btn-add');
      new Function('event', hrBtn.getAttribute('onclick')).call(hrBtn, new MouseEvent('click'));
      expect(globalThis.insertMd).toHaveBeenCalledWith('hr');
      expect(popover.style.display).toBe('none');

      // Link Todo
      toggleInsertItemsPopover({ currentTarget: insertBtn, preventDefault: vi.fn(), stopPropagation: vi.fn() });
      expect(popover.style.display).toBe('flex');
      globalThis.showLinkTodoPicker = vi.fn();
      const linkBtn = document.getElementById('todo-link-btn');
      new Function('event', linkBtn.getAttribute('onclick')).call(linkBtn, new MouseEvent('click'));
      expect(globalThis.showLinkTodoPicker).toHaveBeenCalled();
      expect(popover.style.display).toBe('none');

      // Apply Template
      toggleInsertItemsPopover({ currentTarget: insertBtn, preventDefault: vi.fn(), stopPropagation: vi.fn() });
      expect(popover.style.display).toBe('flex');
      globalThis.openNoteTemplatePicker = vi.fn();
      const templateBtn = document.getElementById('btn-apply-template');
      new Function('event', templateBtn.getAttribute('onclick')).call(templateBtn, new MouseEvent('click'));
      expect(globalThis.openNoteTemplatePicker).toHaveBeenCalledTimes(1);
      expect(popover.style.display).toBe('none');
    });
  });

  describe('Key Idea Promotion to Block in Format Popover', () => {
    it('places key idea highlight button under blocks row and verifies formatting action', () => {
      const formatPopover = document.getElementById('format-aa-popover');
      expect(formatPopover).toBeTruthy();

      const blocksRow = formatPopover.querySelector('.popover-blocks-row');
      expect(blocksRow).toBeTruthy();

      const highlightBtn = document.getElementById('md-highlight-btn');
      expect(highlightBtn).toBeTruthy();
      expect(blocksRow.contains(highlightBtn)).toBe(true);

      const charGrid = formatPopover.querySelector('.popover-inline-grid');
      expect(charGrid.contains(highlightBtn)).toBe(false);

      // Verify label
      expect(highlightBtn.textContent).toContain('Key Idea');
    });
  });

  describe('Removal of Voice and Transcribe Audio Features', () => {
    it('verifies audio buttons and audio group are completely absent from note editor overlay', () => {
      const audioGroup = document.getElementById('editor-audio-group');
      const recordBtn = document.getElementById('btn-audio-record');
      const modeBtn = document.getElementById('btn-audio-mode');

      expect(audioGroup).toBeNull();
      expect(recordBtn).toBeNull();
      expect(modeBtn).toBeNull();
    });
  });

  describe('Inspector Panel Tab C (Tasks) Link Todo Integration', () => {
    it('renders the link todo button in Tab C of the Inspector panel', async () => {
      const panel = document.createElement('div');
      panel.id = 'overlay-right-panel';
      document.body.appendChild(panel);

      globalThis.relatedNotesOpen = true;
      globalThis.activeInspectorTab = 'C';
      await renderInspectorPanel();

      const linkTodoBtn = document.getElementById('link-todo-inspector-btn');
      expect(linkTodoBtn).toBeTruthy();
      expect(linkTodoBtn.title).toBeTruthy();
      expect(linkTodoBtn.textContent).toContain('editor.linkTodoInspector');

      // Click invokes showLinkTodoPicker
      globalThis.showLinkTodoPicker = vi.fn();
      linkTodoBtn.click();
      expect(globalThis.showLinkTodoPicker).toHaveBeenCalledTimes(1);
    });

    it('links an existing todo to currentNote and updates inspector panel', async () => {
      const ta = document.getElementById('edit-textarea');
      ta.contentEditable = 'true';
      ta.textContent = 'Notes on sprint.';

      const unlinkedTodo = globalThis.todosManifest[1]; // todo-2 with noteId: ''
      expect(unlinkedTodo.noteId).toBe('');

      globalThis.saveTodosManifest = vi.fn().mockResolvedValue();

      await insertLinkedTodo(unlinkedTodo);

      // Verify noteId was attached to currentNote
      expect(unlinkedTodo.noteId).toBe('note-101');
      expect(globalThis.saveTodosManifest).toHaveBeenCalled();

      // Verify DOM insertion
      const insertedSpan = ta.querySelector('.note-todo');
      expect(insertedSpan).toBeTruthy();
      expect(insertedSpan.dataset.todoId).toBe('todo-2');
    });
  });
});
