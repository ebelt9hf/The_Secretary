import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('View and Application Architecture Regression & Consistency Fixes', () => {
  beforeAll(() => {
    globalThis.window = globalThis.window || {};
    globalThis.t = (key) => key;
    globalThis.escH = (s) => String(s || '');
    globalThis.escA = (s) => String(s || '');
    globalThis.jq = (s) => JSON.stringify(s || '');
    globalThis.minutesToTime = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    globalThis.timeToMinutes = (t) => {
      const [h, m] = (t || '00:00').split(':').map(Number);
      return h * 60 + m;
    };
    globalThis.broadcastSync = vi.fn();

    loadScriptsIntoGlobal([
      'js/app-state.js',
      'js/app-utils.js',
      'js/app-storage.js',
      'js/app-notes.js',
      'js/app-planner.js',
      'js/app-collab.js',
      'js/app-chat.js',
      'js/app-stash-service.js',
      'js/app-omnibar.js',
      'js/app-board.js',
      'js/app-todos-board.js'
    ]);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.rootHandle = null;
  });

  describe('Storage Readiness Checks in Firebase Vault Mode', () => {
    it('allows saveColleaguesDb and loadColleaguesDb to run when rootHandle is null in Firebase mode', async () => {
      const getStorageEngineSpy = vi.spyOn(StorageAPI, 'getStorageEngine').mockReturnValue('firebase');
      const writeColleaguesSpy = vi.spyOn(StorageAPI, 'writeColleagues').mockResolvedValue(true);
      const readColleaguesSpy = vi.spyOn(StorageAPI, 'readColleagues').mockResolvedValue({
        version: 1,
        me: { id: 'me', label: 'Myself' },
        colleagues: [{ id: 'col-1', label: 'Alice', name: 'Alice' }]
      });
      const hasColleaguesSpy = vi.spyOn(StorageAPI, 'hasColleagues').mockResolvedValue(true);

      try {
        globalThis.rootHandle = null;
        globalThis.colleaguesDb = {
          version: 1,
          me: { id: 'me', label: 'Myself' },
          colleagues: [{ id: 'col-1', label: 'Alice', name: 'Alice' }]
        };

        await globalThis.saveColleaguesDb();
        expect(writeColleaguesSpy).toHaveBeenCalled();

        const loaded = await globalThis.loadColleaguesDb();
        expect(readColleaguesSpy).toHaveBeenCalled();
        expect(loaded.colleagues.length).toBe(1);
        expect(loaded.colleagues[0].id).toBe('col-1');
      } finally {
        getStorageEngineSpy.mockRestore();
        writeColleaguesSpy.mockRestore();
        readColleaguesSpy.mockRestore();
        hasColleaguesSpy.mockRestore();
      }
    });

    it('persists and loads AI chat history via StorageAPI when rootHandle is null in Firebase mode', async () => {
      const getStorageEngineSpy = vi.spyOn(StorageAPI, 'getStorageEngine').mockReturnValue('firebase');
      const writeChatSpy = vi.spyOn(StorageAPI, 'writeChatHistory').mockResolvedValue(true);
      const readChatSpy = vi.spyOn(StorageAPI, 'readChatHistory').mockResolvedValue({
        conversations: [{ id: 'conv-1', title: 'Firebase Conversation' }],
        currentConversationId: 'conv-1'
      });

      try {
        globalThis.rootHandle = null;
        globalThis.AIChatController.conversations = [{ id: 'conv-1', title: 'Firebase Conversation' }];
        globalThis.AIChatController.currentConversationId = 'conv-1';

        await globalThis.AIChatController.saveChatHistoryToFolder();
        expect(writeChatSpy).toHaveBeenCalled();

        await globalThis.AIChatController.loadChatHistoryFromFolder();
        expect(readChatSpy).toHaveBeenCalled();
      } finally {
        getStorageEngineSpy.mockRestore();
        writeChatSpy.mockRestore();
        readChatSpy.mockRestore();
      }
    });

    it('lists and clears Stash items via StorageAPI when rootHandle is null in Firebase mode', async () => {
      const getStorageEngineSpy = vi.spyOn(StorageAPI, 'getStorageEngine').mockReturnValue('firebase');
      const listStashSpy = vi.spyOn(StorageAPI, 'listStashFiles').mockResolvedValue(['capture-12345.txt']);
      const readStashSpy = vi.spyOn(StorageAPI, 'readStashContent').mockResolvedValue('Quick thought note');
      const deleteStashSpy = vi.spyOn(StorageAPI, 'deleteStashFile').mockResolvedValue(true);

      try {
        globalThis.rootHandle = null;

        const items = await globalThis.StashService.list();
        expect(listStashSpy).toHaveBeenCalled();
        expect(items.length).toBe(1);
        expect(items[0].text).toBe('Quick thought note');

        await globalThis.StashService.clear();
        expect(deleteStashSpy).toHaveBeenCalledWith('capture-12345.txt');
      } finally {
        getStorageEngineSpy.mockRestore();
        listStashSpy.mockRestore();
        readStashSpy.mockRestore();
        deleteStashSpy.mockRestore();
      }
    });

    it('allows Omnibar to open without "openFolderFirst" toast when rootHandle is null in Firebase mode', () => {
      document.body.innerHTML = `
        <div id="omnibar-overlay"></div>
        <input id="omnibar-input" />
        <div id="omnibar-container"></div>
        <div id="omnibar-results"></div>
      `;

      const getStorageEngineSpy = vi.spyOn(StorageAPI, 'getStorageEngine').mockReturnValue('firebase');
      const toastSpy = vi.spyOn(globalThis, 'toast').mockImplementation(() => {});
      try {
        globalThis.rootHandle = null;
        globalThis.OmnibarController.open();
        expect(toastSpy).not.toHaveBeenCalledWith('omnibar.openFolderFirst', true);
        expect(globalThis.OmnibarController.isOpen).toBe(true);
      } finally {
        getStorageEngineSpy.mockRestore();
        toastSpy.mockRestore();
      }
    });
  });

  describe('Cross-Platform Path Normalization on Board Views', () => {
    it('deletes note from board card with Windows backslash path', async () => {
      globalThis.manifest = [
        { id: 'note-win', path: 'notes/win-note.html', title: 'Windows Note' }
      ];
      globalThis.showConfirmDialog = vi.fn().mockResolvedValue(true);
      const moveToTrashSpy = vi.spyOn(StorageAPI, 'moveToTrash').mockResolvedValue(true);
      const saveManifestSpy = vi.spyOn(globalThis, 'saveManifest').mockResolvedValue(true);

      try {
        await globalThis.deleteNoteFromCard('notes\\win-note.html');
        expect(moveToTrashSpy).toHaveBeenCalledWith('notes/win-note.html', expect.any(Object));
        expect(globalThis.manifest.length).toBe(0);
      } finally {
        moveToTrashSpy.mockRestore();
        saveManifestSpy.mockRestore();
      }
    });

    it('retags note for lane when given Windows backslash path', async () => {
      globalThis.manifest = [
        { id: 'note-lane', path: 'notes/lane-note.html', title: 'Lane Note' }
      ];
      globalThis.laneAxis = 'group';
      const readContentSpy = vi.spyOn(StorageAPI, 'readNoteContent').mockResolvedValue('<p>content</p>');
      const writeContentSpy = vi.spyOn(StorageAPI, 'writeNoteContent').mockResolvedValue(true);
      const saveManifestSpy = vi.spyOn(globalThis, 'saveManifest').mockResolvedValue(true);
      globalThis.parseNoteHTML = () => ({ group_tags: ['OldGroup'] });

      try {
        await globalThis.retagNoteForLane('notes\\lane-note.html', 'OldGroup', 'NewGroup', false);
        expect(readContentSpy).toHaveBeenCalledWith('notes/lane-note.html');
      } finally {
        readContentSpy.mockRestore();
        writeContentSpy.mockRestore();
        saveManifestSpy.mockRestore();
      }
    });
  });

  describe('Popover & Dropdown Coordinate Positioning', () => {
    it('clamps autocomplete dropdown inside viewport and avoids double scrollY subtraction', () => {
      document.body.innerHTML = `
        <div id="editor-autocomplete-list" class="editor-autocomplete-dropdown"></div>
      `;
      const dropdown = document.getElementById('editor-autocomplete-list');
      const textarea = document.createElement('textarea');
      textarea.value = '@Alice';
      document.body.appendChild(textarea);

      // Mock getBoundingClientRect
      textarea.getBoundingClientRect = () => ({ left: 800, top: 200, width: 200, height: 100 });
      window.innerWidth = 850;
      window.innerHeight = 600;
      window.scrollY = 250;

      globalThis.activeAutocompleteTextarea = textarea;
      globalThis.showAutocompleteSuggestions(textarea, 'mention', 'Alice', 1);

      const leftPx = parseInt(dropdown.style.left, 10);
      expect(leftPx).toBeLessThanOrEqual(window.innerWidth - 100);
      expect(leftPx).toBeGreaterThanOrEqual(10);
    });

    it('ensures quick update popover coordinates are clamped to positive viewport space', () => {
      const todo = { id: 'td-quick-1', title: 'Quick Update Task' };
      globalThis.getTodoById = () => todo;
      window.innerWidth = 800;
      window.innerHeight = 600;

      // Event near negative space
      const mockEvent = { clientX: -20, clientY: -15, stopPropagation: vi.fn() };
      globalThis.openQuickUpdatePopover('td-quick-1', mockEvent);

      const popover = document.querySelector('.quick-update-popover');
      expect(popover).not.toBeNull();
      const left = parseInt(popover.style.left, 10);
      const top = parseInt(popover.style.top, 10);
      expect(left).toBeGreaterThanOrEqual(10);
      expect(top).toBeGreaterThanOrEqual(10);
    });
  });

  describe('Planner Event Effective Note Resolution in Inspector and Context Menu', () => {
    it('resolves effective note for prep event linked to meeting with note in inspector panel', () => {
      globalThis.plannerEvents = [
        { id: 'meeting-1', title: 'Client Sync', noteId: 'note-meeting-1', date: '2026-10-06' },
        { id: 'prep-1', type: 'prep', title: 'Prep for Sync', prepForEventId: 'meeting-1', date: '2026-10-06' }
      ];
      globalThis.getNoteById = (id) => id === 'note-meeting-1' ? { id: 'note-meeting-1', path: 'notes/meeting-1.html', title: 'Meeting Note', group_tags: ['Client'] } : null;

      document.body.innerHTML = `
        <div id="planner-right-sidebar-inspector"></div>
      `;

      globalThis.selectedPlannerEventId = 'prep-1';
      globalThis.renderPlannerInspector();
      const inspectorHtml = document.getElementById('planner-right-sidebar-inspector')?.innerHTML || '';
      expect(inspectorHtml).toContain('Meeting Note');
      expect(inspectorHtml).toContain('Client');
    });
  });
});
