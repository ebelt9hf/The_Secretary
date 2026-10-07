import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Secretary Companion Window & Resizable Side Panels', () => {
  beforeAll(() => {
    globalThis.t = (key) => key;
    globalThis.escH = (s) => String(s || '');
    globalThis.escA = (s) => String(s || '');
    globalThis.toast = vi.fn();
    globalThis.manifest = [];
    globalThis.LLMService = { isEnabled: () => true };

    document.body.innerHTML = `
      <div id="screen-connect" style="display:block;"></div>
      <div id="screen-main" style="display:none;"></div>
      <div id="floating-secretary-chat" class="floating-chat-window">
        <div id="floating-chat-body" class="floating-chat-body chat-panel"></div>
      </div>
    `;

    loadScriptsIntoGlobal([
      'js/app-bridge.js',
      'js/app-chat.js'
    ]);
  });

  beforeEach(() => {
    document.body.className = '';
    const body = document.getElementById('floating-chat-body');
    if (body) body.innerHTML = '';
    localStorage.clear();
  });

  it('renders resize handles and loads stored sidebar widths', () => {
    localStorage.setItem('secretaryChatHistoryPaneWidth', '310');
    localStorage.setItem('secretaryChatCommandsPaneWidth', '280');
    localStorage.setItem('secretaryChatLeftSidebarCollapsed', '0');
    localStorage.setItem('secretaryChatRightSidebarCollapsed', '0');

    AIChatController.init();

    expect(AIChatController.leftSidebarWidth).toBe(310);
    expect(AIChatController.rightSidebarWidth).toBe(280);

    AIChatController.render();

    const leftHandle = document.getElementById('chat-history-resize-handle');
    const rightHandle = document.getElementById('chat-commands-resize-handle');
    const leftSidebar = document.getElementById('chat-history-sidebar');
    const rightSidebar = document.getElementById('chat-commands-sidebar');

    expect(leftHandle).toBeTruthy();
    expect(rightHandle).toBeTruthy();
    expect(leftSidebar).toBeTruthy();
    expect(rightSidebar).toBeTruthy();

    expect(leftSidebar.style.width).toBe('310px');
    expect(rightSidebar.style.width).toBe('280px');
  });

  it('handles dragging of history and commands resize handles and persists new widths', () => {
    localStorage.setItem('secretaryChatLeftSidebarCollapsed', '0');
    localStorage.setItem('secretaryChatRightSidebarCollapsed', '0');

    AIChatController.init();
    AIChatController.render();

    const leftHandle = document.getElementById('chat-history-resize-handle');
    const leftSidebar = document.getElementById('chat-history-sidebar');
    const container = document.getElementById('floating-chat-body');

    // Mock bounding rects
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      width: 1000,
      height: 700,
      top: 0,
      left: 0,
      right: 1000,
      bottom: 700
    });
    vi.spyOn(leftSidebar, 'getBoundingClientRect').mockReturnValue({
      width: 260,
      height: 700,
      top: 0,
      left: 0,
      right: 260,
      bottom: 700
    });

    // Mouse down on left handle
    leftHandle.dispatchEvent(new MouseEvent('mousedown', { clientX: 260, bubbles: true }));
    expect(leftHandle.classList.contains('dragging')).toBe(true);
    expect(document.body.classList.contains('chat-history-resizing')).toBe(true);

    // Mouse move: drag to 320px
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 320 }));
    expect(AIChatController.leftSidebarWidth).toBe(320);
    expect(leftSidebar.style.width).toBe('320px');

    // Mouse up
    window.dispatchEvent(new MouseEvent('mouseup'));
    expect(leftHandle.classList.contains('dragging')).toBe(false);
    expect(document.body.classList.contains('chat-history-resizing')).toBe(false);
    expect(localStorage.getItem('secretaryChatHistoryPaneWidth')).toBe('320');

    // Test right handle dragging
    const rightHandle = document.getElementById('chat-commands-resize-handle');
    const rightSidebar = document.getElementById('chat-commands-sidebar');
    vi.spyOn(rightSidebar, 'getBoundingClientRect').mockReturnValue({
      width: 240,
      height: 700,
      top: 0,
      left: 760,
      right: 1000,
      bottom: 700
    });

    rightHandle.dispatchEvent(new MouseEvent('mousedown', { clientX: 760, bubbles: true }));
    expect(rightHandle.classList.contains('dragging')).toBe(true);
    expect(document.body.classList.contains('chat-commands-resizing')).toBe(true);

    // Mouse move: drag leftwards to expand right sidebar from 240 to 300px
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 700 }));
    expect(AIChatController.rightSidebarWidth).toBe(300);
    expect(rightSidebar.style.width).toBe('300px');

    // Mouse up
    window.dispatchEvent(new MouseEvent('mouseup'));
    expect(rightHandle.classList.contains('dragging')).toBe(false);
    expect(document.body.classList.contains('chat-commands-resizing')).toBe(false);
    expect(localStorage.getItem('secretaryChatCommandsPaneWidth')).toBe('300');
  });

  it('allows increasing left and right sidebar widths in compact or typical companion window dimensions', () => {
    localStorage.setItem('secretaryChatLeftSidebarCollapsed', '0');
    localStorage.setItem('secretaryChatRightSidebarCollapsed', '0');

    AIChatController.init();
    AIChatController.render();

    const leftHandle = document.getElementById('chat-history-resize-handle');
    const leftSidebar = document.getElementById('chat-history-sidebar');
    const rightHandle = document.getElementById('chat-commands-resize-handle');
    const rightSidebar = document.getElementById('chat-commands-sidebar');
    const container = document.getElementById('floating-chat-body');

    // Simulate companion window with width = 800px (standard compact companion window bounds)
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      width: 800,
      height: 600,
      top: 0,
      left: 0,
      right: 800,
      bottom: 600
    });
    vi.spyOn(leftSidebar, 'getBoundingClientRect').mockReturnValue({
      width: 260,
      height: 600,
      top: 0,
      left: 0,
      right: 260,
      bottom: 600
    });
    vi.spyOn(rightSidebar, 'getBoundingClientRect').mockReturnValue({
      width: 240,
      height: 600,
      top: 0,
      left: 480,
      right: 720,
      bottom: 600
    });

    // Mouse down on left handle (startX = 260), drag to 320 (+60px)
    leftHandle.dispatchEvent(new MouseEvent('mousedown', { clientX: 260, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 320 }));
    // Old 40% cap restricted maxW to floor(720 * 0.4) = 288px, blocking increase to 320px
    expect(AIChatController.leftSidebarWidth).toBe(320);
    expect(leftSidebar.style.width).toBe('320px');
    window.dispatchEvent(new MouseEvent('mouseup'));

    // Mouse down on right handle (startX = 480), drag leftwards to 420 (-60px -> +60px width)
    rightHandle.dispatchEvent(new MouseEvent('mousedown', { clientX: 480, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 420 }));
    // Old 40% cap restricted maxW to floor(720 * 0.4) = 288px, blocking increase to 300px
    expect(AIChatController.rightSidebarWidth).toBe(300);
    expect(rightSidebar.style.width).toBe('300px');
    window.dispatchEvent(new MouseEvent('mouseup'));
  });

  it('allows expanding left sidebar when right sidebar is collapsed', () => {
    localStorage.setItem('secretaryChatLeftSidebarCollapsed', '0');
    localStorage.setItem('secretaryChatRightSidebarCollapsed', '1');

    AIChatController.init();
    AIChatController.render();

    const leftHandle = document.getElementById('chat-history-resize-handle');
    const leftSidebar = document.getElementById('chat-history-sidebar');
    const container = document.getElementById('floating-chat-body');

    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      width: 800,
      height: 600,
      top: 0,
      left: 0,
      right: 800,
      bottom: 600
    });
    vi.spyOn(leftSidebar, 'getBoundingClientRect').mockReturnValue({
      width: 260,
      height: 600,
      top: 0,
      left: 0,
      right: 260,
      bottom: 600
    });

    leftHandle.dispatchEvent(new MouseEvent('mousedown', { clientX: 260, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 400 }));
    // With 800px window and right sidebar collapsed, old formula capped at 800 * 0.4 = 320px!
    // It should allow expanding to 400px.
    expect(AIChatController.leftSidebarWidth).toBe(400);
    expect(leftSidebar.style.width).toBe('400px');
    window.dispatchEvent(new MouseEvent('mouseup'));
  });

  it('hides resize handles when sidebars are collapsed', () => {
    localStorage.setItem('secretaryChatLeftSidebarCollapsed', '1');
    localStorage.setItem('secretaryChatRightSidebarCollapsed', '1');

    AIChatController.init();
    AIChatController.render();

    const leftHandle = document.getElementById('chat-history-resize-handle');
    const rightHandle = document.getElementById('chat-commands-resize-handle');

    expect(leftHandle.classList.contains('collapsed-handle')).toBe(true);
    expect(rightHandle.classList.contains('collapsed-handle')).toBe(true);
  });

  describe('Opening Found Notes, Tasks, and Decisions from Chat', () => {
    it('opens notes via AppBridge.noteWindow.open when available', () => {
      const openNoteWinSpy = vi.fn();
      globalThis.AppBridge = {
        noteWindow: {
          open: openNoteWinSpy
        }
      };
      globalThis.manifest = [
        { id: 'note-xyz', path: 'notes/2026-09-01-strategy.html', title: 'Strategy Plan' }
      ];

      AIChatController.openNoteFromChat('notes/2026-09-01-strategy.html', 'Strategy Plan');
      expect(openNoteWinSpy).toHaveBeenCalledWith('note-xyz', 'notes/2026-09-01-strategy.html');
    });

    it('falls back to openNoteOverlay when AppBridge.noteWindow is not available', () => {
      globalThis.AppBridge = null;
      const overlaySpy = vi.fn();
      globalThis.openNoteOverlay = overlaySpy;

      AIChatController.openNoteFromChat('notes/fallback.html', 'Fallback Note');
      expect(overlaySpy).toHaveBeenCalledWith('notes/fallback.html');
    });

    it('opens tasks via openTodoOverlay', () => {
      const todoOverlaySpy = vi.fn();
      globalThis.openTodoOverlay = todoOverlaySpy;

      AIChatController.openTodoFromChat('task-999');
      expect(todoOverlaySpy).toHaveBeenCalledWith('task-999');
    });

    it('locates and opens the note containing a decision', async () => {
      const openNoteSpy = vi.spyOn(AIChatController, 'openNoteFromChat').mockImplementation(() => {});
      globalThis.manifest = [
        {
          id: 'note-decision-1',
          path: 'notes/architecture.html',
          title: 'Architecture Review',
          decisions: ['Adopt companion window for Secretary']
        }
      ];

      await AIChatController.openDecisionFromChat('Adopt companion window for Secretary');
      expect(openNoteSpy).toHaveBeenCalledWith('notes/architecture.html', 'Architecture Review');
    });

    it('formats tool calls and chat text with clickable notes, tasks, and decision chips', () => {
      const rawText = `
Found reference note [Architecture](notes/architecture.html).
Also identified task #todo:todo-456.
Agreed decision: !decision:active Adopt companion window for Secretary
      `;

      const formatted = AIChatController.formatToolCallsToHTML(rawText);
      expect(formatted).toContain('chat-item-link chat-note-link');
      expect(formatted).toContain('data-note-path="notes/architecture.html"');
      expect(formatted).toContain('chat-item-link chat-todo-link');
      expect(formatted).toContain('data-todo-id="todo-456"');
      expect(formatted).toContain('chat-decision-chip');
      expect(formatted).toContain('pill-decision-active');
      expect(formatted).toContain('data-decision-text="Adopt companion window for Secretary"');
    });
  });

  describe('Sidebar Tool Invocation Quick Action Buttons', () => {
    it('renders all categorized tool action buttons with localized titles', () => {
      localStorage.setItem('secretaryChatRightSidebarCollapsed', '0');
      AIChatController.init();
      AIChatController.render();

      const searchNotesBtn = document.querySelector('button[data-cmd="search-notes"]');
      const findDecisionsBtn = document.querySelector('button[data-cmd="find-decisions"]');
      const reviewNotesBtn = document.querySelector('button[data-cmd="review-notes"]');
      const listTasksBtn = document.querySelector('button[data-cmd="list-tasks"]');
      const createTaskBtn = document.querySelector('button[data-cmd="create-task"]');
      const checkScheduleBtn = document.querySelector('button[data-cmd="check-schedule"]');
      const scheduleMeetingBtn = document.querySelector('button[data-cmd="schedule-meeting"]');
      const searchColleaguesBtn = document.querySelector('button[data-cmd="search-colleagues"]');
      const exploreWorkstreamsBtn = document.querySelector('button[data-cmd="explore-workstreams"]');
      const synthesizeMemoryBtn = document.querySelector('button[data-cmd="synthesize-memory"]');
      const summarize3Btn = document.querySelector('button[data-cmd="summarize-3"]');
      const prepCallBtn = document.querySelector('button[data-cmd="prep-call"]');

      expect(searchNotesBtn).toBeTruthy();
      expect(findDecisionsBtn).toBeTruthy();
      expect(reviewNotesBtn).toBeTruthy();
      expect(listTasksBtn).toBeTruthy();
      expect(createTaskBtn).toBeTruthy();
      expect(checkScheduleBtn).toBeTruthy();
      expect(scheduleMeetingBtn).toBeTruthy();
      expect(searchColleaguesBtn).toBeTruthy();
      expect(exploreWorkstreamsBtn).toBeTruthy();
      expect(synthesizeMemoryBtn).toBeTruthy();
      expect(summarize3Btn).toBeTruthy();
      expect(prepCallBtn).toBeTruthy();

      // Tooltips required
      expect(searchNotesBtn.getAttribute('title')).toBeTruthy();
      expect(findDecisionsBtn.getAttribute('title')).toBeTruthy();
      expect(listTasksBtn.getAttribute('title')).toBeTruthy();
    });

    it('populates textarea with actionable template prompt on tool button click', () => {
      AIChatController.init();
      AIChatController.render();

      const textarea = document.getElementById('chat-input-textarea');
      expect(textarea).toBeTruthy();

      AIChatController.triggerQuickCommand('find-decisions');
      expect(textarea.value).toContain('decisions');

      AIChatController.triggerQuickCommand('create-task');
      expect(textarea.value).toContain('task');

      AIChatController.triggerQuickCommand('search-colleagues');
      expect(textarea.value).toContain('colleague');

      AIChatController.triggerQuickCommand('synthesize-memory');
      expect(textarea.value).toContain('memory');
    });
  });
});

