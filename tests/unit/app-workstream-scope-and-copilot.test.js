import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ═══════════════════════════════════════════════════
// Sourced from: app-workstream-tags.test.js
// ═══════════════════════════════════════════════════
describe('Workstream Tag Editor Selection', () => {
  let setupWorkstreamSelectionTagEditor;
  let createTagPill;

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();

    window.escH = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    window.escA = (s) => String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    window.escapeHtml = window.escH;

    // Load app-utils
    const utilsCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-utils.js'), 'utf8');
    const loadUtils = new Function('window', 'document', `
      ${utilsCode}
      return { createTagPill, makeTagChip };
    `);
    const utils = loadUtils(window, document);
    window.createTagPill = utils.createTagPill;
    window.makeTagChip = utils.makeTagChip;

    // Load app-collab helper functions
    const collabCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-collab.js'), 'utf8');
    
    const mockT = (key, params) => {
      if (key === 'common.clickToRemoveTag') return `Remove ${params?.tag || ''}`;
      if (key === 'common.clickToAddTag') return `Add ${params?.tag || ''}`;
      return key;
    };
    window.t = mockT;

    const loadCollab = new Function('window', 'document', 't', 'escH', 'escA', `
      ${collabCode}
      return { setupWorkstreamSelectionTagEditor, getWsIcon };
    `);

    const collab = loadCollab(window, document, mockT, window.escH, window.escA);
    setupWorkstreamSelectionTagEditor = collab.setupWorkstreamSelectionTagEditor;
  });

  it('renders selected tag text only once without duplicate text in the pill', () => {
    const container = document.createElement('div');
    container.id = 'ws-tag-topic';
    document.body.appendChild(container);

    const editor = setupWorkstreamSelectionTagEditor(container, 'Calls', 'topic');
    const pill = container.querySelector('.tag-pill');

    expect(pill).not.toBeNull();
    expect(pill.dataset.tag).toBe('Calls');

    // Pill text (excluding the remove button '✕') should NOT duplicate "Calls Calls"
    const textWithoutRm = pill.textContent.replace('✕', '').replace(/\s+/g, ' ').trim();
    expect(textWithoutRm).toBe('Calls');
  });

  it('renders tag without duplication when changing value', () => {
    const container = document.createElement('div');
    container.id = 'ws-tag-group';
    document.body.appendChild(container);

    let selectedValue = null;
    const editor = setupWorkstreamSelectionTagEditor(container, '', 'group', (val) => {
      selectedValue = val;
    });

    editor.setValue('Calls');
    const pill = container.querySelector('.tag-pill');
    expect(pill).not.toBeNull();

    const textWithoutRm = pill.textContent.replace('✕', '').replace(/\s+/g, ' ').trim();
    expect(textWithoutRm).toBe('Calls');
  });
});

// ═══════════════════════════════════════════════════
// Sourced from: app-workstream-separation.test.js
// ═══════════════════════════════════════════════════
describe('Strict Separation between major_topic_tags and Workstreams', () => {
  beforeAll(() => {
    loadScriptsIntoGlobal([
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-utils.js',
      'js/app-state.js',
      'js/app-notes.js',
      'js/app-board.js'
    ]);
  });

  describe('Board and Filter Separation', () => {
    it('does NOT match note with only major_topic_tags when filtering by workstream', async () => {
      const notes = [
        { path: 'notes/1.html', id: '1', title: 'Note 1', workstream: 'Alpha Project', major_topic_tags: ['General'] },
        { path: 'notes/2.html', id: '2', title: 'Note 2', major_topic_tags: ['Alpha Project'] }, // Only major tag, NOT a workstream
        { path: 'notes/3.html', id: '3', title: 'Note 3', workstreams: ['Alpha Project'] }
      ];

      // Setup activeFilter for workstream
      global.activeFilter = { type: 'workstream', value: 'Alpha Project' };
      global.activeGroup = 'All';
      global.manifest = notes;

      const filtered = await getFilteredNotes();

      expect(filtered.map(n => n.id)).toEqual(['1', '3']);
      expect(filtered.map(n => n.id)).not.toContain('2');
    });

    it('matches note by major_topic_tags when filtering by type=major', async () => {
      const notes = [
        { path: 'notes/1.html', id: '1', title: 'Note 1', major_topic_tags: ['Alpha Project'] },
        { path: 'notes/2.html', id: '2', title: 'Note 2', workstream: 'Alpha Project', major_topic_tags: [] }
      ];

      global.activeFilter = { type: 'major', value: 'Alpha Project' };
      global.activeGroup = 'All';
      global.manifest = notes;

      const filtered = await getFilteredNotes();

      expect(filtered.map(n => n.id)).toEqual(['1']);
    });
  });

  describe('Daily Review Workstream Separation', () => {
    let DailyReviewController;
    let mockEngine;

    beforeEach(() => {
      document.body.innerHTML = `
        <div id="daily-review-overlay" style="display:none;">
          <div id="dr-step-ai">
            <div id="dr-workstream-sync-banner" class="dr-ws-sync-banner" style="display:none;">
              <div id="dr-ws-sync-status-text"></div>
              <div id="dr-ws-sync-progress-bar" style="width: 0%;"></div>
            </div>
            <div class="dr-step5-tab-bar">
              <button id="dr-tab-summary-note" class="dr-step5-tab-btn active">Note</button>
              <button id="dr-tab-summaries-list" class="dr-step5-tab-btn">List</button>
              <button id="dr-tab-workstream-updates" class="dr-step5-tab-btn">Workstreams</button>
            </div>
            <div id="dr-step5-tab-note" class="dr-step5-tab-content" style="display:flex;"></div>
            <div id="dr-step5-tab-list" class="dr-step5-tab-content" style="display:none;"></div>
            <div id="dr-step5-tab-workstreams" class="dr-step5-tab-content" style="display:none;">
              <div id="dr-ai-workstream-updates-list"></div>
              <span id="dr-step5-ws-count">0</span>
            </div>
          </div>
        </div>
      `;

      if (!global.t || typeof global.t !== 'function') {
        global.t = (key) => key;
      }
      global.escH = (str) => String(str || '');
      global.escA = (str) => String(str || '');
      global.jq = (str) => JSON.stringify(str || '');
      global.markDailyReviewDateReviewed = vi.fn();
      global.saveMajorTopicMemory = vi.fn().mockResolvedValue(true);

      mockEngine = {
        getTopicMemoriesCatalog: async () => [
          { topicName: 'Core Engine', status: 'active', key: 'core_engine' }
        ],
        getMajorTopicMemory: async () => ({ topicName: 'Core Engine', oneSentenceSummary: 'Engine core' }),
        synthesizeWorkstreamMemoryWithAI: vi.fn().mockResolvedValue({ topicName: 'Core Engine' })
      };
      global.WorkstreamMemoryEngine = mockEngine;
      window.WorkstreamMemoryEngine = mockEngine;
      global._topicMemoriesIndexCache = {
        topics: [{ topicName: 'Core Engine', status: 'active', key: 'core_engine' }]
      };

      const code = fs.readFileSync(path.resolve(__dirname, '../../js/app-dailyreview.js'), 'utf8');
      const fn = new Function('window', 'document', 'StorageAPI', 'StashService', 'LLMService', 'WorkstreamMemoryEngine', code + '\nreturn DailyReviewController;');
      DailyReviewController = fn(
        global,
        document,
        { readNotesManifest: async () => [], readNoteContent: async () => '' },
        { list: async () => [] },
        { isEnabled: () => true, chat: async () => ({ parsed: {} }), extractJsonPayloadFromText: () => ({ parsed: {} }) },
        mockEngine
      );
    });

    it('commitFinal only updates topic memory for notes with workstream, not for major_topic_tags', async () => {
      global.manifest = [
        { id: 'n1', title: 'Note 1', date: '2026-09-23', workstream: 'Core Engine', major_topic_tags: ['Random Major Tag'] },
        { id: 'n2', title: 'Note 2', date: '2026-09-23', major_topic_tags: ['Legacy Topic Tag'] } // No workstream
      ];

      DailyReviewController.reviewDate = '2026-09-23';
      await DailyReviewController.commitFinal();

      expect(global.saveMajorTopicMemory).toHaveBeenCalledWith('Core Engine', expect.objectContaining({
        status: 'active',
        lastNoteId: 'n1'
      }));
      expect(global.saveMajorTopicMemory).not.toHaveBeenCalledWith('Random Major Tag', expect.anything());
      expect(global.saveMajorTopicMemory).not.toHaveBeenCalledWith('Legacy Topic Tag', expect.anything());
    });

    it('filters out updates in background sync if they do not match active workstreams', () => {
      const updates = [
        { workstream: 'Core Engine', updates: 'New engine optimizations.' },
        { workstream: 'Rogue Workstream', updates: 'Unknown workstream update.' },
        { workstream: 'Random Major Tag', updates: 'Major topic tag update.' }
      ];

      DailyReviewController.processWorkstreamUpdatesInBackground(updates);

      expect(DailyReviewController.workstreamUpdateStatuses.length).toBe(1);
      expect(DailyReviewController.workstreamUpdateStatuses[0].workstream).toBe('Core Engine');
    });
  });
});

// ═══════════════════════════════════════════════════
// Sourced from: app-workstream-other-copilot.test.js
// ═══════════════════════════════════════════════════
describe('Workstream Tab Add & Other Workstream AI Copilot', () => {
  beforeAll(() => {
    loadScriptsIntoGlobal([
      'js/app-utils.js',
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-fs.js',
      'js/app-storage.js',
      'js/app-topic-memory.js',
      'js/app-collab.js'
    ]);
  });

  beforeEach(() => {
    globalThis.appLanguage = 'en';
    if (globalThis.settings) globalThis.settings.language = 'en';
    window.rootHandle = { path: '/tmp/workspace', name: 'workspace' };
    window.decisionsByMajor = new Map([
      ['Core Engine', [{ id: '1', title: 'Use Rust core', status: 'active', major_topic_tags: ['Core Engine'] }]],
      ['UI Redesign', [{ id: '2', title: 'Glassmorphism theme', status: 'active', major_topic_tags: ['UI Redesign'] }]],
      ['__UNCATEGORIZED__', [{ id: '3', title: 'Uncategorized decision', status: 'active' }]]
    ]);
    window.decisionSource = [
      { id: '1', title: 'Use Rust core', status: 'active', major_topic_tags: ['Core Engine'] },
      { id: '2', title: 'Glassmorphism theme', status: 'active', major_topic_tags: ['UI Redesign'] },
      { id: '3', title: 'Uncategorized decision', status: 'active' }
    ];
    window.todosManifest = [
      { id: 't1', title: 'Fix memory leak', completed: false, major_topic_tags: ['Core Engine'] },
      { id: 't2', title: 'Add dark mode toggle', completed: false, major_topic_tags: ['UI Redesign'] },
      { id: 't3', title: 'Unassigned task', completed: false }
    ];
    window.manifest = [
      { path: 'notes/1.html', title: 'Engine note', major_topic_tags: ['Core Engine'] },
      { path: 'notes/2.html', title: 'UI note', major_topic_tags: ['UI Redesign'] }
    ];
    window.favoriteRegistryProjects = new Set();
    window.workstreamCustomOrder = [];
    window.selectedRegistryProject = '__OTHER_WORKSTREAM__';
    window.LLMService = {
      isEnabled: () => true,
      isSetup: () => true,
      chat: vi.fn()
    };
  });

  describe('Workstream + Tab Rendering', () => {
    it('renders + tab after the last workstream tab with workstream-tab class', () => {
      const container = document.createElement('div');
      container.id = 'team-panel';
      document.body.appendChild(container);

      renderRegisterView(container);

      const addBtn = container.querySelector('.workstream-tab-add');
      expect(addBtn).not.toBeNull();
      expect(addBtn.classList.contains('workstream-tab')).toBe(true);
      expect(addBtn.textContent).toContain('+');

      // Check position: addBtn should be the last child in workstream-tabs-strip
      const strip = container.querySelector('.workstream-tabs-strip');
      expect(strip.lastElementChild).toBe(addBtn);

      container.remove();
    });
  });

  describe('Other Workstream Copilot Header & System Prompt', () => {
    it('uses localized label Other instead of raw __OTHER_WORKSTREAM__ in chat UI header', async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      await renderWorkstreamChatTab('__OTHER_WORKSTREAM__', container, null);

      const header = container.querySelector('.workstream-chat-header');
      expect(header).not.toBeNull();
      expect(header.textContent).not.toContain('__OTHER_WORKSTREAM__');
      expect(header.textContent).toContain('Other');

      // Check empty state welcome message header if history is empty
      const welcomeHeader = container.querySelector('.workstream-chat-history');
      expect(welcomeHeader.textContent).not.toContain('__OTHER_WORKSTREAM__');

      container.remove();
    });

    it('generates cross-workstream portfolio review system prompt for __OTHER_WORKSTREAM__', () => {
      const prompt = buildWorkstreamSystemPrompt('__OTHER_WORKSTREAM__', null, {
        allMajors: ['Core Engine', 'UI Redesign'],
        todosList: window.todosManifest,
        decisionsList: window.decisionSource,
        langInfo: { code: 'en', name: 'English' }
      });

      expect(prompt).toContain('Executive Portfolio Secretary AI Copilot');
      expect(prompt).toContain('review all active workstreams');
      expect(prompt).toContain('Core Engine');
      expect(prompt).toContain('UI Redesign');
      expect(prompt).toContain('remaining work');
    });
  });

  describe('Workstream Copilot AI Setup Required State', () => {
    it('shows setup needed notice and link to settings if AI is not setup', async () => {
      window.LLMService = {
        isEnabled: () => false,
        isSetup: () => false
      };

      const container = document.createElement('div');
      document.body.appendChild(container);

      await renderWorkstreamChatTab('Core Engine', container, null);

      expect(container.querySelector('.workstream-chat-header')).toBeNull();
      const onboarding = container.querySelector('.chat-onboarding');
      expect(onboarding).not.toBeNull();
      expect(onboarding.textContent).toContain('Local LLM features are currently disabled');
      expect(onboarding.textContent).toContain('How to setup your local AI Agent');

      const prefsBtn = onboarding.querySelector('button');
      expect(prefsBtn).not.toBeNull();
      expect(prefsBtn.textContent).toContain('Go to Preferences');

      container.remove();
    });

    it('renders normal copilot chat layout when AI is properly setup', async () => {
      window.LLMService = {
        isEnabled: () => true,
        isSetup: () => true
      };

      const container = document.createElement('div');
      document.body.appendChild(container);

      await renderWorkstreamChatTab('Core Engine', container, null);

      expect(container.querySelector('.workstream-chat-header')).not.toBeNull();
      expect(container.querySelector('.chat-onboarding')).toBeNull();

      container.remove();
    });
  });

  describe('Workstream Meetings Tab Layout & Card Actions', () => {
    it('renders meeting cards with workstream-meeting-actions container and localized button titles', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-05T10:00:00'));
      try {
        window.plannerEvents = [
          {
            id: 'evt-1',
            title: 'Project Trend-Vision: Seasonal Review',
            date: '2026-09-05',
            startTime: '17:30',
            endTime: '18:30',
            type: 'event',
            description: 'Reviewing seasonal impact on retail forecasts.',
            major_topic_tags: ['Core Engine']
          }
        ];

        const container = document.createElement('div');
        document.body.appendChild(container);

        await renderWorkstreamMeetingsTab('Core Engine', container, null, {
          all: window.plannerEvents,
          suggestions: []
        });

        const card = container.querySelector('.workstream-meeting-card');
        expect(card).not.toBeNull();

        const actions = card.querySelector('.workstream-meeting-actions');
        expect(actions).not.toBeNull();

        const syncBtn = actions.querySelector('.btn-sync-meeting');
        expect(syncBtn).not.toBeNull();
        expect(syncBtn.title).toBeTruthy();

        const prepBtn = actions.querySelector('.btn-prep-meeting');
        expect(prepBtn).not.toBeNull();
        expect(prepBtn.title).toBeTruthy();

        const plannerBtn = actions.querySelector('.btn-jump-planner');
        expect(plannerBtn).not.toBeNull();
        expect(plannerBtn.title).toBeTruthy();

        container.remove();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});


// ═══════════════════════════════════════════════════
// Sourced from: app-workstream-scope-loading.test.js
// ═══════════════════════════════════════════════════
describe('Workstream Scope Loading & NativeFS Error Prevention', () => {
  beforeAll(() => {
    loadScriptsIntoGlobal([
      'js/app-utils.js',
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-fs.js',
      'js/app-storage.js',
      'js/app-topic-memory.js',
      'js/app-collab.js'
    ]);
  });

  beforeEach(() => {
    window.rootHandle = { path: '/tmp/workspace', name: 'workspace' };
    window.AppBridge = {
      fs: {
        hasNativeFS: () => true,
        readFile: async (pathStr) => {
          if (pathStr === 'existing.json') return JSON.stringify({ hello: 'world' });
          if (pathStr === 'raw/topic-memories/test_topic.json') {
            return JSON.stringify({
              topicName: 'Test Topic',
              summary: '',
              oneSentenceSummary: 'One sentence explanation of test topic',
              keyFacts: ['Fact 1'],
              scratchpad: '<h2>Scope</h2><p>Test</p>'
            });
          }
          return null; // File missing
        },
        writeFile: async () => true,
        listFiles: async () => []
      }
    };
  });

  describe('readFile in NativeFS mode', () => {
    it('returns content when file exists in NativeFS mode', async () => {
      const res = await readFile('existing.json');
      expect(res).toBe('{"hello":"world"}');
    });

    it('throws a NotFoundError when file is missing in NativeFS mode instead of calling getDirectoryHandle', async () => {
      let thrownErr = null;
      try {
        await readFile('.secretary/chat-history.json');
      } catch (err) {
        thrownErr = err;
      }
      expect(thrownErr).not.toBeNull();
      expect(thrownErr.name).toBe('NotFoundError');
      expect(thrownErr.message).toContain('.secretary/chat-history.json');
    });

    it('allows StorageAPI._readJSON to return fallback without TypeError logs when file is missing', async () => {
      const fallbackData = { history: [] };
      const res = await StorageAPI._readJSON('.secretary/chat-history.json', fallbackData);
      expect(res).toEqual(fallbackData);
    });
  });

  describe('Topic Memory loading & fallback', () => {
    it('retrieves topic memory and falls back gracefully when file is missing', async () => {
      const memory = await getMajorTopicMemory('non_existent_topic', { skipAutoArchive: true });
      expect(memory).toBeNull();
    });

    it('retrieves existing topic memory file via NativeFS', async () => {
      const memory = await getMajorTopicMemory('Test Topic', { skipAutoArchive: true, forceReload: true });
      expect(memory).not.toBeNull();
      expect(memory.topicName).toBe('Test Topic');
      expect(memory.oneSentenceSummary).toBe('One sentence explanation of test topic');
    });

    it('preloadAllWorkstreamMemories executes without errors', async () => {
      await expect(preloadAllWorkstreamMemories()).resolves.not.toThrow();
    });
  });

  describe('Workstream Sentence Scope UI rendering', () => {
    it('populates oneSentenceSummary when summary is empty', async () => {
      const parent = document.createElement('div');
      document.body.appendChild(parent);

      const mem = {
        topicName: 'Test Topic',
        summary: '',
        oneSentenceSummary: 'Primary 1-sentence workstream scope fallback',
        keyFacts: ['Fact A'],
        activeMilestones: [],
        decisions: [],
        scratchpad: ''
      };

      await renderWorkstreamOverviewTab('Test Topic', parent, mem);

      const summaryEl = parent.querySelector('#ws-dossier-summary');
      expect(summaryEl).not.toBeNull();
      expect(summaryEl.innerHTML).toBe('Primary 1-sentence workstream scope fallback');

      parent.remove();
    });
  });
});
