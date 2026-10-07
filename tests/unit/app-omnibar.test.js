import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Omnibar Engine & Parameter Indicator (app-omnibar.js)', () => {
  beforeAll(() => {
    // Setup minimal DOM elements required by OmnibarController
    document.body.innerHTML = `
      <div id="omnibar-overlay" class="omnibar-overlay">
        <div id="omnibar-container" class="omnibar-container">
          <div class="omnibar-input-wrapper">
            <div id="omnibar-input-area" class="omnibar-input-area">
              <div id="omnibar-ghost-layer" class="omnibar-ghost-layer"></div>
              <input id="omnibar-input" class="omnibar-input" type="text" />
            </div>
          </div>
          <div id="omnibar-param-indicator" class="omnibar-param-indicator"></div>
          <div id="omnibar-results" class="omnibar-results-container"></div>
          <div class="omnibar-hints"></div>
        </div>
      </div>
    `;

    // Global helper mocks
    globalThis.t = (key) => {
      const map = {
        'omnibar.paramUrgency': '<urgency>',
        'omnibar.paramLabel': '<label>',
        'omnibar.paramDate': '<date>',
        'omnibar.paramTime': '<time>',
        'omnibar.paramDuration': '<duration>',
        'omnibar.paramGroup': '<group>',
        'omnibar.paramTopic': '<topic>',
        'omnibar.paramThought': '<thought>',
        'omnibar.paramQuery': '<query>',
        'omnibar.cmdTodo': '/todo',
        'omnibar.cmdBlock': '/block',
        'omnibar.cmdCall': '/call',
        'omnibar.cmdDec': '/dec',
        'omnibar.cmdNote': '/note',
        'omnibar.cmdStash': '/stash',
        'omnibar.cmdSecretary': '/secretary',
        'omnibar.hintTodo': 'Create a task',
        'omnibar.hintBlock': 'Create planner block',
        'omnibar.hintCall': 'Create call & note',
        'omnibar.hintDec': 'Record decision',
        'omnibar.hintNote': 'New note',
        'omnibar.hintStash': 'Capture thought',
        'omnibar.hintSecretary': 'Ask assistant',
        'omnibar.sectionNavigation': 'Navigation',
        'omnibar.sectionCommands': 'Commands',
        'omnibar.sectionNotes': 'Notes',
        'omnibar.sectionTodos': 'Tasks',
        'omnibar.sectionEvents': 'Planner & Calls',
        'topbar.planner': 'Planner',
        'topbar.notes': 'Notes',
        'topbar.todos': 'Tasks',
        'topbar.workstreams': 'Decisions',
        'topbar.retro': 'Retro',
        'topbar.dailyReview': 'Review',
        'topbar.chat': 'Chat',
        'topbar.team': 'Team',
        'topbar.prefsTitle': 'Preferences'
      };
      return map[key] || key;
    };
    globalThis.escH = (str) => String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    globalThis.toast = () => {};
    globalThis.rootHandle = {};

    loadScriptsIntoGlobal([
      'js/app-omnibar.js'
    ]);
  });

  beforeEach(() => {
    const input = document.getElementById('omnibar-input');
    const indicator = document.getElementById('omnibar-param-indicator');
    if (input) {
      input.value = '';
      input.selectionStart = 0;
      input.selectionEnd = 0;
    }
    if (indicator) {
      indicator.innerHTML = '';
      indicator.classList.remove('active');
    }
    OmnibarController.isOpen = false;
    OmnibarController.history = [];
    OmnibarController.results = [];
    OmnibarController.selectedIndex = 0;
    OmnibarController.tabCycle = {
      active: false,
      tokenType: '',
      options: [],
      index: 0
    };
    globalThis.rootHandle = {};
    OmnibarController.init();
  });

  describe('getParamBreakdown() Parsing Logic', () => {
    it('returns empty array when input does not start with slash', () => {
      const res = OmnibarController.getParamBreakdown('search query', 5);
      expect(res).toEqual([]);
    });

    it('returns next expected parameter badge when user types command prefix without space', () => {
      const res = OmnibarController.getParamBreakdown('/tod', 4);
      expect(res).toHaveLength(1);
      expect(res[0].label).toBe('<urgency>');
      expect(res[0].isActive).toBe(true);
    });

    it('parses /todo with priority token and task description', () => {
      // Input: /todo Q1 Finalize slides
      const inputVal = '/todo Q1 Finalize slides';
      const cursorAtLabel = 15; // inside "Finalize"

      const res = OmnibarController.getParamBreakdown(inputVal, cursorAtLabel);
      expect(res).toHaveLength(2);

      const [urgency, label] = res;
      expect(urgency.label).toBe('<urgency>');
      expect(urgency.isFilled).toBe(true);
      expect(urgency.isActive).toBe(false);

      expect(label.label).toBe('<label>');
      expect(label.isFilled).toBe(true);
      expect(label.isActive).toBe(true);
    });

    it('parses /todo when priority is active at cursor position', () => {
      const inputVal = '/todo Q2 Strategic plan';
      const cursorAtPriority = 7; // inside "Q2"

      const res = OmnibarController.getParamBreakdown(inputVal, cursorAtPriority);
      expect(res).toHaveLength(2);
      expect(res[0].isActive).toBe(true);
      expect(res[1].isActive).toBe(false);
    });

    it('parses /todo without priority token when title is typed directly', () => {
      const inputVal = '/todo Buy milk';
      const res = OmnibarController.getParamBreakdown(inputVal, 10);
      expect(res).toHaveLength(1);
      expect(res[0].label).toBe('<label>');
      expect(res[0].isFilled).toBe(true);
      expect(res[0].isActive).toBe(true);
    });

    it('parses /block with title, date, time, and duration tokens', () => {
      const inputVal = '/block Team sync tomorrow 14:00 45m';
      const cursorAtTime = 28; // inside 14:00

      const res = OmnibarController.getParamBreakdown(inputVal, cursorAtTime);
      expect(res).toHaveLength(4);

      const [label, date, time, duration] = res;
      expect(label.label).toBe('<label>');
      expect(label.isFilled).toBe(true);

      expect(date.label).toBe('<date>');
      expect(date.isFilled).toBe(true);

      expect(time.label).toBe('<time>');
      expect(time.isFilled).toBe(true);
      expect(time.isActive).toBe(true);

      expect(duration.label).toBe('<duration>');
      expect(duration.isFilled).toBe(true);
    });

    it('handles /block when date and time are typed before the block title without badge overlap', () => {
      const inputVal = '/block today 14:00 Sync meeting';
      const res = OmnibarController.getParamBreakdown(inputVal, 22);

      const label = res.find(p => p.label === '<label>');
      const date = res.find(p => p.label === '<date>');
      const time = res.find(p => p.label === '<time>');

      expect(date.startIndex).toBe(7);
      expect(time.startIndex).toBe(13);
      expect(label.startIndex).toBe(19); // "Sync meeting" starts at index 19
    });

    it('parses /note with group tag and note title', () => {
      const inputVal = '/note [Work] Meeting minutes';
      const res = OmnibarController.getParamBreakdown(inputVal, 8); // inside group tag
      expect(res).toHaveLength(2);
      expect(res[0].label).toBe('<group>');
      expect(res[0].isFilled).toBe(true);
      expect(res[0].isActive).toBe(true);

      expect(res[1].label).toBe('<label>');
      expect(res[1].isFilled).toBe(true);
      expect(res[1].isActive).toBe(false);
    });

    it('parses /dec with topic tag and decision text', () => {
      const inputVal = '/dec [Architecture] Use SQLite for local storage';
      const res = OmnibarController.getParamBreakdown(inputVal, 25); // inside decision text
      expect(res).toHaveLength(2);
      expect(res[0].label).toBe('<topic>');
      expect(res[0].isActive).toBe(false);
      expect(res[1].label).toBe('<label>');
      expect(res[1].isActive).toBe(true);
    });

    it('parses /stash with thought content', () => {
      const inputVal = '/stash Quick idea to capture';
      const res = OmnibarController.getParamBreakdown(inputVal, 12);
      expect(res).toHaveLength(1);
      expect(res[0].label).toBe('<thought>');
      expect(res[0].isFilled).toBe(true);
      expect(res[0].isActive).toBe(true);
    });

    it('parses /secretary with query text', () => {
      const inputVal = '/secretary Summarize my daily notes';
      const res = OmnibarController.getParamBreakdown(inputVal, 15);
      expect(res).toHaveLength(1);
      expect(res[0].label).toBe('<query>');
      expect(res[0].isFilled).toBe(true);
      expect(res[0].isActive).toBe(true);
    });

    it('parses localized command aliases (/tâche, /bloc, /aufgabe, /tarea, /úkol, etc.) seamlessly', () => {
      // French /tâche
      const frTodo = OmnibarController.getParamBreakdown('/tâche Q1 Préparer le bilan', 12);
      expect(frTodo).toHaveLength(2);
      expect(frTodo[0].label).toBe('<urgency>');
      expect(frTodo[1].label).toBe('<label>');

      // French /bloc
      const frBlock = OmnibarController.getParamBreakdown('/bloc Réunion demain 14:00 30m', 15);
      expect(frBlock).toHaveLength(4);
      expect(frBlock[0].label).toBe('<label>');
      expect(frBlock[1].label).toBe('<date>');
      expect(frBlock[2].label).toBe('<time>');
      expect(frBlock[3].label).toBe('<duration>');

      // German /aufgabe
      const deTodo = OmnibarController.getParamBreakdown('/aufgabe Q2 Quartalsbericht erstellen', 15);
      expect(deTodo).toHaveLength(2);
      expect(deTodo[0].label).toBe('<urgency>');
      expect(deTodo[1].label).toBe('<label>');

      // Spanish /tarea
      const esTodo = OmnibarController.getParamBreakdown('/tarea Comprar suministros', 10);
      expect(esTodo).toHaveLength(1);
      expect(esTodo[0].label).toBe('<label>');

      // Czech /úkol
      const csTodo = OmnibarController.getParamBreakdown('/úkol Q3 Připravit podklady', 10);
      expect(csTodo).toHaveLength(2);
      expect(csTodo[0].label).toBe('<urgency>');
      expect(csTodo[1].label).toBe('<label>');

      // French /appel (call command)
      const frCall = OmnibarController.getParamBreakdown('/appel Point synchronisation équipe', 10);
      expect(frCall).toHaveLength(1);
      expect(frCall[0].label).toBe('<label>');
      expect(frCall[0].isFilled).toBe(true);
      expect(frCall[0].isActive).toBe(true);
      expect(frCall[0].startIndex).toBe(7);

      // French /appell variant
      const frAppell = OmnibarController.getParamBreakdown('/appell Point client', 10);
      expect(frAppell).toHaveLength(1);
      expect(frAppell[0].label).toBe('<label>');
      expect(frAppell[0].isFilled).toBe(true);

      // German /anruf
      const deCall = OmnibarController.getParamBreakdown('/anruf Kundengespräch', 8);
      expect(deCall).toHaveLength(1);
      expect(deCall[0].label).toBe('<label>');
      expect(deCall[0].isFilled).toBe(true);

      // Spanish /llamada
      const esCall = OmnibarController.getParamBreakdown('/llamada Cliente', 10);
      expect(esCall).toHaveLength(1);
      expect(esCall[0].label).toBe('<label>');
      expect(esCall[0].isFilled).toBe(true);
    });

    it('returns localized command via getLocalizedCommand() and setCommandPrefix()', () => {
      const origT = globalThis.t;
      // Mock French active locale
      globalThis.t = (key) => {
        const frMap = {
          'omnibar.cmdCall': '/appel',
          'omnibar.cmdTodo': '/tâche',
          'omnibar.cmdBlock': '/bloc',
          'omnibar.cmdDec': '/déc',
          'omnibar.cmdNote': '/note',
          'omnibar.cmdStash': '/pensée',
          'omnibar.cmdSecretary': '/secrétaire',
          'omnibar.paramLabel': '<label>'
        };
        return frMap[key] || origT(key);
      };

      expect(OmnibarController.getLocalizedCommand('call')).toBe('/appel');
      expect(OmnibarController.getLocalizedCommand('/call')).toBe('/appel');
      expect(OmnibarController.getLocalizedCommand('/todo')).toBe('/tâche');
      expect(OmnibarController.getLocalizedCommand('/block')).toBe('/bloc');

      // setCommandPrefix applies localized command to input
      OmnibarController.setCommandPrefix('/call');
      const input = document.getElementById('omnibar-input');
      expect(input.value).toBe('/appel ');

      // Ghost suggestion for English /cal completes and suggests in active language
      const ghost = OmnibarController.getGhostSuggestionInfo('/cal');
      expect(ghost.tabComplete).toBe('/call ');

      globalThis.t = origT;
    });

    it('matches /appel command and generates ghost text and autocompletion properly', () => {
      const ghostApp = OmnibarController.getGhostSuggestionInfo('/app');
      expect(ghostApp.tabComplete).toBe('/appel ');

      const ghostAppel = OmnibarController.getGhostSuggestionInfo('/appel');
      expect(ghostAppel.tabComplete).toBe('/appel ');
      expect(ghostAppel.ghostSuffix).toBe(' <label>');

      const matchAppel = OmnibarController.matchCommandType('/appel Point client');
      expect(matchAppel).not.toBeNull();
      expect(matchAppel.type).toBe('call');
      expect(matchAppel.matchedAlias).toBe('/appel');
      expect(matchAppel.cmdLen).toBe(6);
    });
  });

  describe('updateParamIndicator() DOM rendering and positioning', () => {
    it('clears indicator when input is empty or non-command', () => {
      const input = document.getElementById('omnibar-input');
      const indicator = document.getElementById('omnibar-param-indicator');

      input.value = 'plain search';
      OmnibarController.updateParamIndicator();

      expect(indicator.innerHTML).toBe('');
      expect(indicator.classList.contains('active')).toBe(false);
    });

    it('renders parameter badge elements and activates indicator container for valid command', () => {
      const input = document.getElementById('omnibar-input');
      const indicator = document.getElementById('omnibar-param-indicator');

      input.value = '/todo Q1 Finalize slides';
      input.selectionStart = 15;
      OmnibarController.updateParamIndicator();

      expect(indicator.classList.contains('active')).toBe(true);
      const badges = indicator.querySelectorAll('.omnibar-param-badge');
      expect(badges).toHaveLength(2);

      expect(badges[0].textContent).toBe('<urgency>');
      expect(badges[0].classList.contains('is-filled')).toBe(true);

      expect(badges[1].textContent).toBe('<label>');
      expect(badges[1].classList.contains('is-active')).toBe(true);
    });

    it('renders filled parameter badges across the full width of the block', () => {
      const input = document.getElementById('omnibar-input');
      const indicator = document.getElementById('omnibar-param-indicator');

      input.value = '/block Team sync tomorrow 14:00 45m';
      OmnibarController.updateParamIndicator();

      const badges = indicator.querySelectorAll('.omnibar-param-badge');
      expect(badges).toHaveLength(4);
      expect(badges[0].textContent).toBe('<label>');
      expect(badges[1].textContent).toBe('<date>');
      expect(badges[2].textContent).toBe('<time>');
      expect(badges[3].textContent).toBe('<duration>');
    });
  });

  describe('Omnibar Modal Open/Close Lifecycle', () => {
    it('opens modal and resets parameter indicator', () => {
      OmnibarController.open();
      const overlay = document.getElementById('omnibar-overlay');
      expect(overlay.style.display).toBe('flex');
      expect(OmnibarController.isOpen).toBe(true);
    });

    it('blocks opening when storage is not ready and displays toast', () => {
      const origRoot = globalThis.rootHandle;
      globalThis.rootHandle = null;
      let toastMsg = null;
      globalThis.toast = (msg) => { toastMsg = msg; };

      OmnibarController.open();
      expect(OmnibarController.isOpen).toBe(false);
      expect(toastMsg).toBe('omnibar.openFolderFirst');

      globalThis.rootHandle = origRoot;
    });

    it('opens Omnibar via Cmd+K with international keyboard layout (e.code === KeyK)', () => {
      OmnibarController.close();
      const event = new KeyboardEvent('keydown', {
        metaKey: true,
        key: 'л', // Cyrillic K
        code: 'KeyK',
        bubbles: true,
        cancelable: true
      });
      document.dispatchEvent(event);
      expect(OmnibarController.isOpen).toBe(true);
    });

    it('opens Omnibar via Ctrl+Shift+Space even when focused inside rich text editor', () => {
      OmnibarController.close();
      const textarea = document.createElement('textarea');
      textarea.id = 'edit-textarea';
      document.body.appendChild(textarea);
      textarea.focus();

      const modalOverlay = document.createElement('div');
      modalOverlay.id = 'note-edit-overlay';
      modalOverlay.style.display = 'flex';
      document.body.appendChild(modalOverlay);

      const event = new KeyboardEvent('keydown', {
        ctrlKey: true,
        shiftKey: true,
        code: 'Space',
        key: ' ',
        bubbles: true,
        cancelable: true
      });
      document.dispatchEvent(event);
      expect(OmnibarController.isOpen).toBe(true);

      modalOverlay.remove();
      textarea.remove();
    });

    it('prevents Cmd+K from opening Omnibar when actively typing inside note editor overlay', () => {
      OmnibarController.close();
      const textarea = document.createElement('textarea');
      textarea.id = 'edit-textarea';
      document.body.appendChild(textarea);
      textarea.focus();

      const modalOverlay = document.createElement('div');
      modalOverlay.id = 'note-edit-overlay';
      modalOverlay.style.display = 'flex';
      document.body.appendChild(modalOverlay);

      const event = new KeyboardEvent('keydown', {
        metaKey: true,
        key: 'k',
        code: 'KeyK',
        bubbles: true,
        cancelable: true
      });
      document.dispatchEvent(event);
      expect(OmnibarController.isOpen).toBe(false);

      modalOverlay.remove();
      textarea.remove();
    });

    it('closes on Escape key press', () => {
      OmnibarController.open();
      expect(OmnibarController.isOpen).toBe(true);

      const escEvent = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true
      });
      document.dispatchEvent(escEvent);
      expect(OmnibarController.isOpen).toBe(false);
    });
  });

  describe('Live Search & Filtering', () => {
    beforeEach(() => {
      globalThis.manifest = [
        { id: 'note-1', title: 'Weekly Roadmap & Vision', group_tags: ['Projects'], major_topic_tags: ['Architecture'], date: '2026-10-01', path: 'note-1.html' },
        { id: 'note-2', title: 'Customer Feedback Session', group_tags: ['Clients'], major_topic_tags: ['Product'], date: '2026-10-02', path: 'note-2.html' }
      ];
      globalThis.todosManifest = [
        { id: 'todo-1', title: 'Refactor omnibar search', eisenhowerQuadrant: 'Q1', status: 'TODO', created: '2026-10-05' },
        { id: 'todo-2', title: 'Update documentation', eisenhowerQuadrant: 'Q2', status: 'DONE', created: '2026-10-06' }
      ];
      globalThis.plannerEvents = [
        { id: 'evt-1', title: 'Sprint Planning Sync', type: 'call', date: '2026-10-06', startTime: '10:00', endTime: '11:00' }
      ];
      OmnibarController.open();
    });

    it('filters notes by title, group tags, and major topics', () => {
      const input = document.getElementById('omnibar-input');
      input.value = 'Roadmap';
      OmnibarController.performLiveSearch();

      const noteResult = OmnibarController.results.find(r => r.type === 'note' && r.id === 'note-1');
      expect(noteResult).toBeDefined();
      expect(noteResult.title).toBe('Weekly Roadmap & Vision');

      input.value = 'Clients';
      OmnibarController.performLiveSearch();
      const clientResult = OmnibarController.results.find(r => r.type === 'note' && r.id === 'note-2');
      expect(clientResult).toBeDefined();
    });

    it('filters tasks from todosManifest', () => {
      const input = document.getElementById('omnibar-input');
      input.value = 'Refactor';
      OmnibarController.performLiveSearch();

      const todoResult = OmnibarController.results.find(r => r.type === 'todo' && r.id === 'todo-1');
      expect(todoResult).toBeDefined();
      expect(todoResult.title).toBe('Refactor omnibar search');
    });

    it('filters planner events', () => {
      const input = document.getElementById('omnibar-input');
      input.value = 'Sprint Planning';
      OmnibarController.performLiveSearch();

      const eventResult = OmnibarController.results.find(r => r.type === 'event' && r.id === 'evt-1');
      expect(eventResult).toBeDefined();
      expect(eventResult.title).toBe('Sprint Planning Sync');
    });

    it('matches navigation tabs and command shortcuts', () => {
      const input = document.getElementById('omnibar-input');
      input.value = 'planner';
      OmnibarController.performLiveSearch();

      const navResult = OmnibarController.results.find(r => r.type === 'nav' && r.tab === 'planner');
      expect(navResult).toBeDefined();

      const cmdResult = OmnibarController.results.find(r => r.type === 'cmd');
      expect(cmdResult).toBeDefined();
    });

    it('includes stash capture fallback item for arbitrary queries', () => {
      const input = document.getElementById('omnibar-input');
      input.value = 'random new idea';
      OmnibarController.performLiveSearch();

      const stashResult = OmnibarController.results.find(r => r.id === 'action-stash');
      expect(stashResult).toBeDefined();
      expect(stashResult.text).toBe('random new idea');
    });

    it('navigates through results with navigateResults()', () => {
      const input = document.getElementById('omnibar-input');
      input.value = 'planner';
      OmnibarController.performLiveSearch();

      expect(OmnibarController.selectedIndex).toBe(0);
      OmnibarController.navigateResults(1);
      expect(OmnibarController.selectedIndex).toBe(1);
      OmnibarController.navigateResults(-1);
      expect(OmnibarController.selectedIndex).toBe(0);
    });
  });

  describe('Command Execution Handlers', () => {
    beforeEach(() => {
      globalThis.todosManifest = [];
      globalThis.plannerEvents = [];
      globalThis.manifest = [];
      globalThis.saveTodosManifest = async () => {};
      globalThis.savePlanner = async () => {};
      globalThis.saveManifest = async () => {};
      globalThis.rebuildIndexHTML = async () => {};
      globalThis.StorageAPI = {
        writeNoteContent: async () => {},
        readNoteContent: async () => ''
      };
      globalThis.generateNoteId = () => 'note-test-123';
      globalThis.getCanonicalNotePath = (id) => `${id}.html`;
      globalThis.buildNewNoteHTML = () => '<html><body></body></html>';
      globalThis.upsertManifest = (item) => { globalThis.manifest.push(item); };
      globalThis.StashService = {
        add: async (txt) => { globalThis.lastStashedText = txt; }
      };
    });

    it('executes /todo command and appends new task to todosManifest', async () => {
      await OmnibarController.handleTodoCommand('/todo Q1 Fix critical sync race condition');
      expect(globalThis.todosManifest).toHaveLength(1);
      expect(globalThis.todosManifest[0].title).toBe('Fix critical sync race condition');
      expect(globalThis.todosManifest[0].eisenhowerQuadrant).toBe('Q1');
      expect(globalThis.todosManifest[0].priority).toBe('High');
    });

    it('executes /block command and appends event to plannerEvents', async () => {
      await OmnibarController.handleBlockCommand('/block Strategy Meeting tomorrow 14:00 45m');
      expect(globalThis.plannerEvents).toHaveLength(1);
      const ev = globalThis.plannerEvents[0];
      expect(ev.title).toBe('Strategy Meeting');
      expect(ev.startTime).toBe('14:00');
      expect(ev.endTime).toBe('14:45');
    });

    it('executes /note command and creates new note document in manifest', async () => {
      await OmnibarController.handleNoteCommand('/note [Architecture] New Omnibar Engine Design');
      expect(globalThis.manifest).toHaveLength(1);
      const note = globalThis.manifest[0];
      expect(note.title).toBe('New Omnibar Engine Design');
      expect(note.group_tags).toContain('Architecture');
    });

    it('executes /stash command and records entry in StashService', async () => {
      globalThis.lastStashedText = null;
      const input = document.getElementById('omnibar-input');
      input.value = '/stash Quick thought on caching';
      await OmnibarController.submit();
      expect(globalThis.lastStashedText).toBe('Quick thought on caching');
    });

    it('executes /call command and localized aliases (/appel, /appell, /appelle, /anruf, /llamada, /chiamata) via quickCreateCallAndOpenNote', async () => {
      let createdCallTitle = null;
      window.quickCreateCallAndOpenNote = async (title) => {
        createdCallTitle = title;
      };

      // English /call
      const input = document.getElementById('omnibar-input');
      input.value = '/call Weekly Team Alignment';
      await OmnibarController.submit();
      expect(createdCallTitle).toBe('Weekly Team Alignment');

      // French standard /appel
      input.value = '/appel Point hebdomadaire';
      await OmnibarController.submit();
      expect(createdCallTitle).toBe('Point hebdomadaire');

      // French variant /appell
      input.value = '/appell Entretien client';
      await OmnibarController.submit();
      expect(createdCallTitle).toBe('Entretien client');

      // French conjugated /appelle
      input.value = '/appelle Débrief technique';
      await OmnibarController.submit();
      expect(createdCallTitle).toBe('Débrief technique');

      // German /anruf
      input.value = '/anruf Abstimmungsgespräch';
      await OmnibarController.submit();
      expect(createdCallTitle).toBe('Abstimmungsgespräch');

      // Spanish /llamada
      input.value = '/llamada Revisión del proyecto';
      await OmnibarController.submit();
      expect(createdCallTitle).toBe('Revisión del proyecto');

      // Italian /chiamata
      input.value = '/chiamata Allineamento team';
      await OmnibarController.submit();
      expect(createdCallTitle).toBe('Allineamento team');

      // Czech /hovor
      input.value = '/hovor Konzultace architektury';
      await OmnibarController.submit();
      expect(createdCallTitle).toBe('Konzultace architektury');
    });

    it('routes /secretary queries to AIChatController if present', async () => {
      let askedQuery = null;
      window.AIChatController = {
        askFromOmnibar: async (q) => { askedQuery = q; }
      };

      const input = document.getElementById('omnibar-input');
      input.value = '/secretary What are my open Q1 tasks?';
      await OmnibarController.submit();
      expect(askedQuery).toBe('What are my open Q1 tasks?');
    });
  });

  describe('History & Tab Completion', () => {
    it('records and navigates command history', () => {
      OmnibarController.recordHistory('/todo First task');
      OmnibarController.recordHistory('/block Second event');
      expect(OmnibarController.history).toHaveLength(2);

      OmnibarController.navigateHistory();
      const input = document.getElementById('omnibar-input');
      expect(input.value).toBe('/block Second event');
    });

    it('autocompletes command on Tab and parameter options on subsequent Tab', () => {
      const input = document.getElementById('omnibar-input');
      input.value = '/';
      OmnibarController.handleTabCompletion(false);
      expect(input.value).toBe('/todo ');

      // Subsequent Tab completes priority token for /todo
      OmnibarController.handleTabCompletion(false);
      expect(input.value).toBe('/todo Q1 ');

      // Cycling notes groups
      input.value = '/note ';
      OmnibarController.tabCycle.active = false;
      OmnibarController.handleTabCompletion(false);
      expect(input.value).toContain('/note [');
    });
  });

  describe('Search Relevance Scoring & Ranking (calculateRelevanceScore)', () => {
    it('ranks exact matches highest (score 100)', () => {
      const score = OmnibarController.calculateRelevanceScore('planner', 'planner');
      expect(score).toBe(100);
    });

    it('ranks prefix title matches higher than substring or tag matches', () => {
      const prefixScore = OmnibarController.calculateRelevanceScore('plan', 'Planning Roadmap');
      const substrScore = OmnibarController.calculateRelevanceScore('plan', 'Quarterly Explanation');
      const tagScore = OmnibarController.calculateRelevanceScore('plan', 'Strategy', '', ['planner']);

      expect(prefixScore).toBeGreaterThan(substrScore);
      expect(prefixScore).toBeGreaterThan(tagScore);
    });

    it('ranks word boundary matches (e.g. second word in title)', () => {
      const score = OmnibarController.calculateRelevanceScore('sync', 'Daily Team Sync');
      expect(score).toBeGreaterThanOrEqual(45);
    });

    it('sorts notes by relevance score when performing live search', () => {
      globalThis.manifest = [
        { id: 'note-1', title: 'Architecture Review and Discussion', group_tags: ['Dev'], date: '2026-10-01', path: 'note-1.html' },
        { id: 'note-2', title: 'Review Protocol', group_tags: ['Quality'], date: '2026-10-02', path: 'note-2.html' },
        { id: 'note-3', title: 'Sprint Retrospective with Peer Review', group_tags: ['Agile'], date: '2026-10-03', path: 'note-3.html' }
      ];

      OmnibarController.open();
      const input = document.getElementById('omnibar-input');
      input.value = 'Review';
      OmnibarController.performLiveSearch();

      const noteResults = OmnibarController.results.filter(r => r.type === 'note');
      expect(noteResults).toHaveLength(3);
      // "Review Protocol" starts with "Review", so it should be ranked first
      expect(noteResults[0].id).toBe('note-2');
    });
  });

  describe('Accessibility & WAI-ARIA Combobox 1.2 Standards', () => {
    it('sets aria-activedescendant when search results are rendered and updates on navigation', () => {
      globalThis.manifest = [
        { id: 'note-1', title: 'Alpha Note', path: 'alpha.html' },
        { id: 'note-2', title: 'Beta Note', path: 'beta.html' }
      ];

      OmnibarController.open();
      const input = document.getElementById('omnibar-input');
      input.value = 'Note';
      OmnibarController.performLiveSearch();

      expect(input.getAttribute('aria-activedescendant')).toBe('omnibar-item-0');
      const firstItem = document.getElementById('omnibar-item-0');
      expect(firstItem).not.toBeNull();
      expect(firstItem.getAttribute('aria-selected')).toBe('true');

      OmnibarController.navigateResults(1);
      expect(input.getAttribute('aria-activedescendant')).toBe('omnibar-item-1');

      OmnibarController.close();
      expect(input.getAttribute('aria-activedescendant')).toBeNull();
    });

    it('renders hint pills with localized tooltips (title attribute)', () => {
      OmnibarController.open();
      const hintPills = document.querySelectorAll('.omnibar-hint-pill');
      expect(hintPills.length).toBeGreaterThan(0);
      hintPills.forEach(pill => {
        expect(pill.getAttribute('title')).toBeTruthy();
      });
    });
  });
});
