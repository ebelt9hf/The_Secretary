'use strict';

// ── Secretary: State ──
// ═══ State ═══
let rootHandle  = null;
let manifest    = [];               // array of {title,path,group_tags,...,date,modified}
let todosManifest = []; // array of todo objects — the single source of truth
let todosLoadState = 'idle';        // idle | loading | partial | ready | error
let currentNote = null;             // { path, title, date, group_tags, …, originalHTML }
let startupState = 'BOOT_MINIMAL';  // BOOT_MINIMAL | BOOT_HYDRATING | BOOT_READY
let colleaguesDb = null;            // { version, me, colleagues[] }
let colleaguesById = new Map();
let colleaguesByNormLabel = new Map();
let colleaguesLoadState = 'idle';   // idle | loading | ready | error

// Metadata buffer state (lightweight planner/board note index)
let metadataBuffer = [];
let metadataById = new Map();
let metadataByPath = new Map();
let metadataVersion = 1;
let metadataStorageMode = 'single'; // single | sharded
let metadataHydrationProgress = { done: 0, total: 0, running: false };
let metadataShardIndexCache = null;

// Runtime telemetry (lightweight, in-memory)
let perfTelemetry = {
  startup: {
    mountStartedAt: 0,
    plannerVisibleMs: 0,
    hydrationStartedAt: 0,
    hydrationDurationMs: 0,
  },
  caches: {
    htmlHits: 0,
    htmlMisses: 0,
    previewHits: 0,
    previewMisses: 0,
    collabHits: 0,
    collabMisses: 0,
  },
  sharding: {
    mode: 'single',
    shardsWritten: 0,
    shardsDeleted: 0,
    indexWrites: 0,
    partialRewriteCount: 0,
    fullRewriteCount: 0,
  },
};

// Bounded caches (LRU semantics via insertion order in Map)
let htmlLRUCache = new Map();      // path -> { modified, text, rawContent? }
let previewLRUCache = new Map();   // path -> { text, highlights }
let collabLRUCache = new Map();    // path -> { modified, decisions, mentions, delegations }
const HTML_LRU_LIMIT = 200;
const PREVIEW_LRU_LIMIT = 2000;
const COLLAB_LRU_LIMIT = 1000;
let editMode    = false;
let activeTab   = 'notes';
let activeFilter = null;            // { type:'group'|'major'|'topic', value }
let activeGroup = 'All';
let groupsRetracted = (localStorage.getItem('secretaryGroupsRetracted') || '1') === '1';
let groupNavState   = localStorage.getItem('secretaryGroupNavState') || 'full';
let searchQuery  = '';
let editingTodo = null;             // { id } when editing a todo in modal
let _noteClickTimer = null;
let noteTodoTokenMap = {};
let _imgTokenMap = {};
let searchInContent = true; // search inside note content
let searchCaseSensitive = false; // minor = insensitive (default)
let searchRegex = false;
let boardMode    = 'notes'; // 'notes' | 'todos'
let showDoneTodos = false;
let todoContextMenu = null;
let todoContextMenuHandlers = null;

let laneAxis = 'group'; // 'group' | 'major' | 'week'
let laneSubcols = {};   // { laneVal: activeSubCol }
let collapsedLanes = new Set();
let laneSortMode = 'recent'; // 'recent' or 'alpha'
let maximizedLanes = new Set(); // lanes expanded inline to show multiple rows (session-only)
let weekSubGrouping = 'day';  // 'day' | 'group' | 'major' | 'topic'
let weekCutoffWeeks = 8;       // notes older than this many weeks appear in "Older Notes" lane
let notesViewMode = 'map';    // 'map' | 'reader'
let mapZoomLevel = 'weeks';   // 'weeks' | 'months' | 'years'
let notesTreeOpenNodes = new Set();
let notesReaderTarget = null; // null or { type: 'group'|'major'|'topic'|'all', value: string }
let appLanguage = 'fr';
let autoSaveTimer = null;
try { laneAxis = localStorage.getItem('secretaryLaneAxis') || 'group'; } catch(e) {}
try { collapsedLanes = new Set(JSON.parse(localStorage.getItem('secretaryCollapsedLanes')||'[]')); } catch(e) {}
try { laneSortMode = localStorage.getItem('secretaryLaneSort') || laneSortMode; } catch(e) {}
try { weekSubGrouping = localStorage.getItem('secretaryWeekSubGrouping') || 'day'; } catch(e) {}
try { weekCutoffWeeks = parseInt(localStorage.getItem('secretaryWeekCutoff') || '8') || 8; } catch(e) {}
try { notesViewMode = localStorage.getItem('secretaryNotesViewMode') || 'map'; } catch(e) {}
if (notesViewMode === 'tree') notesViewMode = 'map';
try { mapZoomLevel = localStorage.getItem('secretaryMapZoomLevel') || 'weeks'; } catch(e) {}

// Lane Focus View state
let expandedLaneVal      = null;   // lane open in focus view (null = normal board)
let focusModeFullScreen  = false;
let focusSelectedPaths   = null;   // Set of visible paths; null = all
let focusNoteCache       = {};     // path → { html, md }
let focusSaveTimers      = {};     // path → debounce timer
let focusCollapsedNotes  = new Set(); // paths minimised in expanded lane view
let focusNotesListCollapsed = (localStorage.getItem('secretaryFocusNotesListCollapsed') || '1') === '1';
// Focus drawer state (hidden by default). mode: 'tags' | 'notes' | null
let focusDrawerOpen = (localStorage.getItem('secretaryFocusDrawerOpen') || '0') === '1';
let focusDrawerMode = localStorage.getItem('secretaryFocusDrawerMode') || null;
// Whether the notes list uses a hierarchical tree (group → major → topic → note). Default enabled.
let focusNotesTreeEnabled = (localStorage.getItem('secretaryFocusNotesTreeEnabled') || '1') === '1';
// Track which tree nodes are open in the expanded lane view (keeps UX between re-renders).
let focusTreeOpenNodes = new Set();
let labelManagerState    = null;   // { type, label, tab, partitionType, promoteType }

// Main-board note card state
let collapsedCards   = new Set();
try { collapsedCards = new Set(JSON.parse(localStorage.getItem('secretaryCollapsedCards')||'[]')); } catch(e) {}
let notePreviewCache = {};     // path → { text, highlights }
let cardClickTimers  = {};     // path → timeout for single/double-click detection

// Multi-window support
let _isFocusedMode = false;        // true when app loaded with #note=<id> in URL
let _windowId = 'w-' + Date.now() + '-' + Math.random().toString(36).slice(2);
let _syncChannel = null;           // BroadcastChannel, created in mountFolder
let pendingDeletes = {};           // path -> { manifestEntry, timer } for undoable deletes

// Planner State
let plannerEvents = [];
let plannerLoadState = 'idle'; // idle | loading | ready | error
let currentPlannerWeekStart = null; // Date (Monday of the active week)
let selectedPlannerEventId = null; // Selected event ID for Inspector
let plannerContextMenu = null;
let plannerContextMenuHandlers = null;

// Work schedule settings
let workStartTime = '09:00';
let workEndTime = '18:30';
try { workStartTime = localStorage.getItem('secretaryWorkStart') || '09:00'; } catch(e) {}
try { workEndTime = localStorage.getItem('secretaryWorkEnd') || '18:30'; } catch(e) {}

// Default event/block duration for planner
let defaultPlannerDuration = 30;
try { defaultPlannerDuration = parseInt(localStorage.getItem('secretaryDefaultDuration') || '30') || 30; } catch(e) {}

// Note editor collapse state
let metadataCollapsed = false;
try { metadataCollapsed = (localStorage.getItem('secretaryMetaCollapsed') || '0') === '1'; } catch(e) {}

// Related notes panel open state in overlay
let relatedNotesOpen = true;
try { relatedNotesOpen = (localStorage.getItem('secretaryRelatedNotesOpen') || '1') === '1'; } catch(e) {}

// Dynamic planner views and collapsible panels state
let plannerWorkingDays = [1, 2, 3, 4, 5];
try {
  const storedWd = localStorage.getItem('secretaryWorkingDays');
  if (storedWd) plannerWorkingDays = JSON.parse(storedWd);
} catch(e) {}

let plannerViewMode = '3days';
try { plannerViewMode = localStorage.getItem('secretaryPlannerViewMode') || '3days'; } catch(e) {}

let plannerShowPast = false;
try { plannerShowPast = localStorage.getItem('secretaryPlannerShowPast') === '1'; } catch(e) {}

let plannerLeftSidebarCollapsed = false;
try { plannerLeftSidebarCollapsed = localStorage.getItem('secretaryPlannerLeftCollapsed') === '1'; } catch(e) {}

let plannerRightSidebarCollapsed = false;
try { plannerRightSidebarCollapsed = localStorage.getItem('secretaryPlannerRightCollapsed') === '1'; } catch(e) {}

let plannerActivePaneTab = 'unassigned'; // 'unassigned' | 'notdone' | 'details'
try { plannerActivePaneTab = sessionStorage.getItem('secretaryPlannerActivePaneTab') || 'unassigned'; } catch(e) {}

let plannerRightPaneWidth = 320;
try {
  const _w = parseInt(sessionStorage.getItem('secretaryPlannerRightPaneWidth') || '320', 10);
  if (!isNaN(_w)) plannerRightPaneWidth = _w;
} catch(e) {}

let plannerDisplayDateOverride = null;
let plannerInitialFocusDate = null;

let noteEditorLeftPaneWidth = null;
try {
  const _w = parseInt(sessionStorage.getItem('secretaryNoteEditorLeftPaneWidth') || '', 10);
  if (!isNaN(_w)) noteEditorLeftPaneWidth = _w;
} catch(e) {}

let noteEditorRightPaneWidth = null;
try {
  const _w = parseInt(sessionStorage.getItem('secretaryNoteEditorPreviewPaneWidth') || '', 10);
  if (!isNaN(_w)) noteEditorRightPaneWidth = _w;
} catch(e) {}

let noteInspectorPaneWidth = null;
try {
  const _w = parseInt(localStorage.getItem('secretaryNoteInspectorPaneWidth') || '', 10);
  if (!isNaN(_w)) noteInspectorPaneWidth = _w;
} catch(e) {}

// Pagination, search cache, and hash routing states
let laneLimits = {};           // laneVal -> current rendered limit
let noteContentCache = {};     // path -> { modified, text }
let _isApplyingHash = false;
let lastActiveNoteForTab = { notes: null, todos: null, planner: null, team: null, retro: null, prefs: null };

// ═══ Reactive Keyed State Bus ═══
const StateBus = (() => {
  const _listeners = new Map(); // topic -> Set<callback>
  const _wildcardListeners = new Set(); // fn(topic, payload)

  function on(topic, callback) {
    if (typeof callback !== 'function') return () => {};
    if (topic === '*') {
      _wildcardListeners.add(callback);
      return () => _wildcardListeners.delete(callback);
    }
    if (!_listeners.has(topic)) {
      _listeners.set(topic, new Set());
    }
    _listeners.get(topic).add(callback);
    return () => {
      const set = _listeners.get(topic);
      if (set) {
        set.delete(callback);
        if (set.size === 0) _listeners.delete(topic);
      }
    };
  }

  function emit(topic, payload) {
    // Exact match
    if (_listeners.has(topic)) {
      for (const cb of _listeners.get(topic)) {
        try { cb(payload, topic); } catch (e) { console.error(`[StateBus] Error in '${topic}' listener:`, e); }
      }
    }
    // Prefix wildcard, e.g. "todo:update:123" triggers "todo:*"
    const colonIdx = topic.indexOf(':');
    if (colonIdx !== -1) {
      const nsTopic = topic.substring(0, colonIdx) + ':*';
      if (_listeners.has(nsTopic)) {
        for (const cb of _listeners.get(nsTopic)) {
          try { cb(payload, topic); } catch (e) { console.error(`[StateBus] Error in '${nsTopic}' listener:`, e); }
        }
      }
    }
    // Global wildcard
    for (const cb of _wildcardListeners) {
      try { cb(topic, payload); } catch (e) { console.error('[StateBus] Error in wildcard listener:', e); }
    }
  }

  return { on, emit };
})();

if (typeof window !== 'undefined') {
  window.StateBus = StateBus;
}

// ═══ Knowledge Graph & Task Graph Index State ═══
let noteGraphIndex = {
  forwardLinks: new Map(), // path -> Set<path>
  backlinks: new Map(),    // path -> Set<path>
  mentions: new Map(),     // path -> Set<string>
  isHydrated: false
};
let showEisenhowerCriticalPath = false;
let eisDependencyHoverFocusId = null;

