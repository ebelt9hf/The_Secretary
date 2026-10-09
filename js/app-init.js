(function initElectronEnvironment() {
  const applyEnv = () => {
    if (window.AppBridge?.windowManager) {
      window.AppBridge.windowManager.init();
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyEnv);
  } else {
    applyEnv();
  }
})();

function updateSubRowVisibility() {
  const isNotes = (activeTab === 'notes' || (typeof activeTab === 'undefined' && boardMode === 'notes'))
    && boardMode === 'notes'
    && activeTab !== 'prefs'
    && activeTab !== 'planner'
    && activeTab !== 'team'
    && activeTab !== 'decisions'
    && activeTab !== 'retro'
    && activeTab !== 'daily-review'
    && activeTab !== 'todos'
    && activeTab !== 'chat';
  const isTodos = boardMode === 'todos' && activeTab !== 'prefs' && activeTab !== 'planner' && activeTab !== 'team' && activeTab !== 'decisions' && activeTab !== 'retro' && activeTab !== 'daily-review' && activeTab !== 'chat';
  const subRow  = document.getElementById('topbar-sub-row');
  if (subRow) subRow.style.display = isNotes ? '' : 'none';

  const filterBar = document.getElementById('filter-bar');
  if (filterBar && !isNotes) {
    filterBar.style.display = 'none';
  }

  const notesViewSwitcher = document.getElementById('notes-view-switcher');
  const mapZoomCtrl       = document.getElementById('map-zoom-ctrl');
  const notesTodayBtn     = document.getElementById('btn-notes-today');
  if (notesViewSwitcher) notesViewSwitcher.style.display = isNotes ? '' : 'none';
  if (mapZoomCtrl)       mapZoomCtrl.style.display       = 'none';
  if (notesTodayBtn) {
    notesTodayBtn.style.display = isNotes ? '' : 'none';
    notesTodayBtn.title = (typeof t === 'function' ? t('notes.todayBtnTooltip') : 'Jump to today in notes timeline');
  }

  const notesWsBar = document.getElementById('notes-workstream-bar');
  if (notesWsBar) {
    if (!isNotes) {
      notesWsBar.style.display = 'none';
    } else {
      notesWsBar.style.display = 'flex';
      if (typeof renderNotesWorkstreamBar === 'function') renderNotesWorkstreamBar();
    }
  }

  const axisPills = document.getElementById('axis-pills');
  const weekCtrl  = document.getElementById('week-subgroup-ctrl');
  if (axisPills) axisPills.style.display = 'none';
  if (weekCtrl)  weekCtrl.style.display  = 'none';

  const searchGroup = document.getElementById('notes-search-group');
  const breadcrumbBar = document.getElementById('notes-breadcrumb-bar');
  if (searchGroup) searchGroup.style.display = isNotes ? '' : 'none';
  if (breadcrumbBar) {
    if (!isNotes) breadcrumbBar.style.display = 'none';
    else if (typeof renderNotesBreadcrumbBar === 'function') renderNotesBreadcrumbBar();
  }

  const showDoneBtn  = document.getElementById('btn-show-done');
  const clearDoneBtn = document.getElementById('btn-clear-done');
  if (showDoneBtn) showDoneBtn.style.display = 'none';
  if (clearDoneBtn) clearDoneBtn.style.display = 'none';

  const filterBarBtn = document.getElementById('btn-filter-bar');
  const filterChipCt = document.getElementById('active-filter-chip-container');
  if (filterBarBtn) {
    filterBarBtn.style.display = isNotes ? '' : 'none';
    const isFilterBarOpen = document.getElementById('filter-bar')?.style.display === 'block';
    filterBarBtn.title = isFilterBarOpen ? t('board.hideFilterBarTooltip') : t('board.showFilterBarTooltip');
  }
  if (filterChipCt) {
    filterChipCt.style.display = isNotes ? '' : 'none';
    if (!isNotes) filterChipCt.innerHTML = '';
  }

  // Notes View Mode pills active state
  ['map', 'reader'].forEach(mode => {
    const btn = document.getElementById(`btn-notes-view-${mode}`);
    if (btn) btn.classList.toggle('active', notesViewMode === mode);
  });

  // Legacy Axis pills active state
  ['group', 'major', 'week'].forEach(axis => {
    const pill = document.getElementById(`axis-pill-${axis}`);
    if (pill) pill.classList.toggle('active', laneAxis === axis);
  });
  const select = document.getElementById('week-subgroup-select');
  if (select && select.value !== weekSubGrouping) select.value = weekSubGrouping;

  // Prefs icon active state
  const prefsIcon = document.getElementById('btn-prefs-icon');
  if (prefsIcon) prefsIcon.classList.toggle('active', activeTab === 'prefs');
}

let _lastDependencyLoadingHintAt = 0;
function notifyLoadingDependency(featureLabel = '') {
  const now = Date.now();
  if (now - _lastDependencyLoadingHintAt < 1200) return;
  _lastDependencyLoadingHintAt = now;

  const loadingLabel = t('common.loading') || 'Loading...';
  const suffix = featureLabel ? ` ${featureLabel}` : '';
  toast(`${loadingLabel}${suffix}`.trim(), false);
}
window.notifyLoadingDependency = notifyLoadingDependency;

// ═══ UI – Tab switching ═══
async function switchTab(tab) {
  if (tab === 'chat') {
    if (typeof window.toggleFloatingChat === 'function') {
      window.toggleFloatingChat();
    }
    return;
  }
  if (startupState !== 'BOOT_READY' && tab !== 'notes' && tab !== 'todos' && tab !== 'chat') {
    notifyLoadingDependency();
  }

  const overlay = document.getElementById('note-edit-overlay');
  const isOverlayVisible = overlay && overlay.style.display !== 'none';
  if (isOverlayVisible && currentNote) {
    if (typeof autoSaveNote === 'function') {
      await autoSaveNote({ silent: true, isFinal: true });
    }
    lastActiveNoteForTab[activeTab] = currentNote.path;
  } else {
    lastActiveNoteForTab[activeTab] = null;
  }

  if (overlay) overlay.style.display = 'none';

  if (activeTab === 'daily-review' && tab !== 'daily-review') {
    if (window.DailyReviewController && typeof window.DailyReviewController.pause === 'function') {
      window.DailyReviewController.pause();
    }
  }

  activeTab = tab;
  document.getElementById('tab-notes')?.classList.toggle('active', tab === 'notes');
  document.getElementById('tab-todos-mode')?.classList.toggle('active', tab === 'todos');
  document.getElementById('tab-planner')?.classList.toggle('active', tab === 'planner');
  document.getElementById('tab-decisions')?.classList.toggle('active', tab === 'decisions');
  document.getElementById('tab-team')?.classList.toggle('active', tab === 'team');
  document.getElementById('tab-retro')?.classList.toggle('active', tab === 'retro');
  document.getElementById('tab-daily-review-btn')?.classList.toggle('active', tab === 'daily-review');
  // Note: btn-topbar-ai active state is managed by toggleFloatingChat, not the tab system

  if (tab !== 'notes') {
    const filterBar = document.getElementById('filter-bar');
    if (filterBar) filterBar.style.display = 'none';
    const notesWsBar = document.getElementById('notes-workstream-bar');
    if (notesWsBar) notesWsBar.style.display = 'none';
  }

  if (typeof window.updateRetroFlashAndHoverState === 'function') {
    window.updateRetroFlashAndHoverState();
  }

  const appMain = document.getElementById('app-main');

  const setPanelDisplay = (id, displayStyle) => {
    const el = document.getElementById(id);
    if (el) el.style.display = displayStyle;
  };

  const dailyReviewPanel = document.getElementById('daily-review-overlay');
  if (dailyReviewPanel) {
    dailyReviewPanel.style.display = (tab === 'daily-review') ? 'flex' : 'none';
  }

  // Toggle chat-panel visibility
  const chatPanel = document.getElementById('chat-panel');
  if (chatPanel) {
    chatPanel.style.display = (tab === 'chat') ? 'flex' : 'none';
  }

  if (tab === 'notes' || tab === 'todos') {
    if (tab === 'todos') {
      boardMode = 'todos';
      expandedLaneVal = null;
      if (typeof ensureTodosManifestFullyLoaded === 'function') {
        await ensureTodosManifestFullyLoaded();
      }
    }
    else { boardMode = 'notes'; }
    if (appMain) appMain.style.overflow = '';
    setPanelDisplay('swimlane-board', 'flex');
    setPanelDisplay('prefs-panel', 'none');
    setPanelDisplay('planner-panel', 'none');
    setPanelDisplay('team-panel', 'none');
    setPanelDisplay('retro-panel', 'none');
    // Restore group nav when leaving planner or dailyreview
    const gn = document.getElementById('group-nav');
    if (gn) gn.style.display = '';
    updateSubRowVisibility();
    renderBoard();
  } else if (tab === 'prefs') {
    if (appMain) appMain.style.overflow = '';
    setPanelDisplay('swimlane-board', 'none');
    setPanelDisplay('prefs-panel', 'block');
    setPanelDisplay('planner-panel', 'none');
    setPanelDisplay('team-panel', 'none');
    setPanelDisplay('retro-panel', 'none');
    updateSubRowVisibility();
    renderGroupNav();
    renderPrefs();
  } else if (tab === 'planner') {
    if (appMain) appMain.style.overflow = 'hidden';
    setPanelDisplay('swimlane-board', 'none');
    setPanelDisplay('prefs-panel', 'none');
    setPanelDisplay('planner-panel', 'flex');
    setPanelDisplay('team-panel', 'none');
    setPanelDisplay('retro-panel', 'none');
    // Hide the left group-nav in planner mode
    const gn = document.getElementById('group-nav');
    if (gn) gn.style.display = 'none';
    updateSubRowVisibility();
    window._plannerInitialScrollDone = false; // Allow auto-scroll
    renderPlanner();
  } else if (tab === 'decisions') {
    if (appMain) appMain.style.overflow = 'hidden';
    setPanelDisplay('swimlane-board', 'none');
    setPanelDisplay('prefs-panel', 'none');
    setPanelDisplay('planner-panel', 'none');
    setPanelDisplay('team-panel', 'flex');
    setPanelDisplay('retro-panel', 'none');
    const gn = document.getElementById('group-nav');
    if (gn) gn.style.display = 'none';
    if (typeof activeCollabView !== 'undefined') {
      activeCollabView = 'registry';
    }
    updateSubRowVisibility();
    renderTeamPanel();
  } else if (tab === 'team') {
    if (appMain) appMain.style.overflow = 'hidden';
    setPanelDisplay('swimlane-board', 'none');
    setPanelDisplay('prefs-panel', 'none');
    setPanelDisplay('planner-panel', 'none');
    setPanelDisplay('team-panel', 'flex');
    setPanelDisplay('retro-panel', 'none');
    const gn = document.getElementById('group-nav');
    if (gn) gn.style.display = 'none';
    if (typeof activeCollabView !== 'undefined' && activeCollabView === 'registry') {
      activeCollabView = 'org';
    }
    updateSubRowVisibility();
    renderTeamPanel();
  } else if (tab === 'retro') {
    if (appMain) appMain.style.overflow = 'hidden';
    setPanelDisplay('swimlane-board', 'none');
    setPanelDisplay('prefs-panel', 'none');
    setPanelDisplay('planner-panel', 'none');
    setPanelDisplay('team-panel', 'none');
    setPanelDisplay('retro-panel', 'flex');
    const gn = document.getElementById('group-nav');
    if (gn) gn.style.display = 'none';
    updateSubRowVisibility();
    renderRetroPanel();
  } else if (tab === 'daily-review') {
    if (appMain) appMain.style.overflow = 'hidden';
    setPanelDisplay('swimlane-board', 'none');
    setPanelDisplay('prefs-panel', 'none');
    setPanelDisplay('planner-panel', 'none');
    setPanelDisplay('team-panel', 'none');
    setPanelDisplay('retro-panel', 'none');
    const gn = document.getElementById('group-nav');
    if (gn) gn.style.display = 'none';
    updateSubRowVisibility();
    if (window.DailyReviewController && typeof window.DailyReviewController.resume === 'function') {
      window.DailyReviewController.resume();
    } else {
      notifyLoadingDependency('Daily Review');
      setTimeout(() => {
        if (activeTab === 'daily-review' && window.DailyReviewController && typeof window.DailyReviewController.resume === 'function') {
          window.DailyReviewController.resume();
        }
      }, 120);
    }
  } else if (tab === 'chat') {
    if (appMain) appMain.style.overflow = 'hidden';
    setPanelDisplay('swimlane-board', 'none');
    setPanelDisplay('prefs-panel', 'none');
    setPanelDisplay('planner-panel', 'none');
    setPanelDisplay('team-panel', 'none');
    setPanelDisplay('retro-panel', 'none');
    const gn = document.getElementById('group-nav');
    if (gn) gn.style.display = 'none';
    updateSubRowVisibility();
    if (window.AIChatController) window.AIChatController.render();
  }

  const nextNotePath = lastActiveNoteForTab[tab];
  if (nextNotePath && tab !== 'daily-review') {
    if (typeof openNoteOverlay === 'function') {
      await openNoteOverlay(nextNotePath);
    }
  } else {
    currentNote = null;
    updateUrlHash();
  }
}

function toggleShowDone() {
  showDoneTodos = !showDoneTodos;
  const btn = document.getElementById('btn-show-done');
  if (btn) {
    btn.classList.toggle('active', showDoneTodos);
    btn.title = showDoneTodos ? t('board.hideDoneTooltip') : t('board.showDoneTooltip');
  }
  renderBoard();
}

async function confirmClearDone() {
  const n = getTodosByPriority('Done').length;
  if (!n) { toast(t('common.noDoneTodos')); return; }
  const confirmed = await showConfirmDialog(t('confirm.deleteDoneTodos', { count: n }), { isDanger: true, confirmLabel: '🗑️ ' + (t('todo.delete') || 'Delete') });
  if (!confirmed) return;
  await clearDone();
}
let settings = {
  ui: {
    theme: 'system',
    colors: {}
  },
  folder: { last: null },
  language: (typeof getBrowserLanguageCode === 'function' ? getBrowserLanguageCode() : 'en'),
  workingLanguage: 'en',
  ai: {
    enabled: false,
    provider: 'custom',
    endpoint: 'http://localhost:1234/v1',
    apiKey: '',
    model: 'qwen2.5-coder-7b-instruct',
    language: 'auto',
    returnPreset: 'full'
  }
};


const SECRETARY_FOLDER_PICKER_ID = 'secretary-last-folder';
let rememberedFolderHandle = null;

function getPreferredFolderStartInHandle() {
  return rootHandle || rememberedFolderHandle || null;
}

async function showSecretaryFolderPicker(startInHandle = null) {
  if (window.AppBridge?.fs) {
    const res = await window.AppBridge.fs.selectFolder();
    if (res) return res;
    if (window.AppBridge.fs.hasNativeFS()) {
      const err = new Error('Folder selection canceled');
      err.name = 'AbortError';
      throw err;
    }
  }
  const options = { mode: 'readwrite' };
  const preferredHandle = startInHandle || getPreferredFolderStartInHandle();
  if (preferredHandle) {
    options.startIn = preferredHandle;
  }

  try {
    return await window.showDirectoryPicker({ ...options, id: SECRETARY_FOLDER_PICKER_ID });
  } catch (e) {
    if (e.name === 'AbortError') throw e;

    // If the error was not an abort, it might be due to an invalid/stale startIn handle.
    // Try to open the picker without the startIn option.
    const cleanOptions = { mode: 'readwrite' };
    try {
      return await window.showDirectoryPicker({ ...cleanOptions, id: SECRETARY_FOLDER_PICKER_ID });
    } catch (fallbackErr) {
      if (fallbackErr && fallbackErr.name === 'AbortError') throw fallbackErr;
      try {
        return await window.showDirectoryPicker({ mode: 'readwrite' });
      } catch (lastErr) {
        throw lastErr;
      }
    }
  }
}

function loadLocalSettings() {
  try {
    const raw = localStorage.getItem('secretaryLocalSettings');
    if (raw) {
      const parsed = JSON.parse(raw);
      deepMerge(settings, parsed);
    }
    const defaultLang = (typeof getBrowserLanguageCode === 'function' ? getBrowserLanguageCode() : 'en');
    settings.language = normalizeLanguageCode(settings.language || appLanguage || defaultLang);
    appLanguage = settings.language;
    plannerWorkingDays = settings.ui?.workingDays || [1, 2, 3, 4, 5];
    if (!raw) saveLocalSettings();
  } catch (e) { console.warn('Could not load local settings', e); }
}
function saveLocalSettings() {
  try {
    if (!settings.ui) settings.ui = {};
    settings.ui.workingDays = plannerWorkingDays;
    localStorage.setItem('secretaryLocalSettings', JSON.stringify(settings));
  } catch (e) { console.warn('Could not save local settings', e); }
}

function updateStartupProgress(pct, stepText) {
  const wrap = document.getElementById('startup-progress-wrap');
  if (wrap) wrap.style.display = 'flex';
  const fill = document.getElementById('startup-progress-fill');
  const clampedPct = Math.min(100, Math.max(0, Math.round(pct)));
  if (fill) fill.style.width = `${clampedPct}%`;
  const pctEl = document.getElementById('startup-progress-pct');
  if (pctEl) pctEl.textContent = `${clampedPct}%`;
  const stepEl = document.getElementById('startup-progress-step');
  if (stepEl && stepText) stepEl.textContent = stepText;

  // Mirror startup progress to native Windows taskbar
  if (clampedPct >= 100) {
    window.AppBridge?.setProgressBar(-1);
  } else {
    window.AppBridge?.setProgressBar(clampedPct / 100);
  }

  const iconEl = document.getElementById('startup-progress-icon');
  if (iconEl && window.AppIcons) {
    if (clampedPct >= 100) {
      iconEl.innerHTML = window.AppIcons.get('checkCircle', { size: 13, className: 'icon-ready' });
    } else {
      iconEl.innerHTML = window.AppIcons.get('spinner', { size: 13, className: 'icon-spin' });
    }
  }
}

function setLandingBusy(isBusy, message = '') {
  const screen = document.getElementById('screen-connect');
  const status = document.getElementById('connect-status-hint');
  const wrap = document.getElementById('startup-progress-wrap');
  if (screen) {
    screen.classList.toggle('loading', !!isBusy);
    if (isBusy) screen.setAttribute('aria-busy', 'true');
    else screen.removeAttribute('aria-busy');
  }
  if (status) status.textContent = isBusy ? (message || (typeof t === 'function' ? t('common.loading') : 'Loading…')) : '';
  if (wrap) {
    wrap.style.display = isBusy ? 'flex' : 'none';
  }
}

function setStartupState(nextState) {
  startupState = nextState;
  const nameEl = document.getElementById('folder-name');
  if (!nameEl) return;
  const base = (typeof rootHandle !== 'undefined' && rootHandle?.name) || settings?.folder?.last || '';
  if (!base) return;
  if (startupState === 'BOOT_HYDRATING') nameEl.textContent = `${base} · Indexing...`;
  else nameEl.textContent = base;
}

// Keep viewport-dependent layouts stable across monitor moves and browser resize.
let _lastViewportSig = '';
let _layoutRefreshTimer = null;
let _lastFocusedNoteRefreshAt = 0;

function updateViewportCssVars() {
  const vh = Math.max(320, Math.round(window.visualViewport?.height || window.innerHeight || 0));
  document.documentElement.style.setProperty('--app-vh', `${vh}px`);
}

function queueResponsiveRefresh() {
  if (_layoutRefreshTimer) clearTimeout(_layoutRefreshTimer);
  _layoutRefreshTimer = setTimeout(async () => {
    _layoutRefreshTimer = null;
    updateViewportCssVars();

    const isStorageReady = Boolean(rootHandle || (typeof StorageAPI !== 'undefined' && typeof StorageAPI.getStorageEngine === 'function' && StorageAPI.getStorageEngine() === 'firebase'));
    if (!isStorageReady) return;

    if ((activeTab === 'team' || activeTab === 'decisions') && typeof renderTeamPanel === 'function') {
      renderTeamPanel();
      return;
    }
    if (activeTab === 'planner' && typeof renderPlanner === 'function') {
      renderPlanner();
      return;
    }
    if (activeTab === 'retro' && typeof renderRetroPanel === 'function') {
      renderRetroPanel();
      return;
    }
    if (activeTab === 'chat' && window.AIChatController) {
      window.AIChatController.render();
      return;
    }
    if (typeof renderBoard === 'function') {
      renderBoard();
    }
  }, 120);
}

async function refreshOpenNoteIfChanged(reason = 'focus') {
  const isStorageReady = Boolean(rootHandle || (typeof StorageAPI !== 'undefined' && typeof StorageAPI.getStorageEngine === 'function' && StorageAPI.getStorageEngine() === 'firebase'));
  if (!currentNote?.path || !isStorageReady) return;

  const now = Date.now();
  if (now - _lastFocusedNoteRefreshAt < 1000) return;
  _lastFocusedNoteRefreshAt = now;

  const overlayVisible = document.getElementById('note-edit-overlay')?.style.display !== 'none';
  const dailyReviewStepOpen = typeof DailyReviewController !== 'undefined'
    && DailyReviewController
    && typeof activeTab !== 'undefined'
    && activeTab === 'daily-review'
    && (DailyReviewController.currentStep === 4 || DailyReviewController.currentStep === 5 || DailyReviewController.currentStep === 3)
    && (!!DailyReviewController.activeNotePath || DailyReviewController.currentStep === 5);
  if (!_isFocusedMode && !overlayVisible && !dailyReviewStepOpen) return;

  try {
    const html = await StorageAPI.readNoteContent(currentNote.path);
    if (html === currentNote.originalHTML) return;
    if (!html && (!currentNote.originalHTML || currentNote.originalHTML.trim() === '')) return;

    const isViewMode = document.querySelector('.overlay-panel')?.classList.contains('overlay-view-mode');
    if (isViewMode) {
      const parsed = parseNoteHTML(html);
      currentNote = { ...currentNote, originalHTML: html, ...parsed };
      const ta = document.getElementById('edit-textarea');
      if (ta) {
        let cleanHTML = parsed.mainHTML || '<p><br></p>';
        if (typeof resolveNoteImages === 'function') {
          cleanHTML = await resolveNoteImages(cleanHTML);
        }
        ta.innerHTML = cleanHTML;
      }
      syncPreview();
      dismissReloadBanner();
    } else {
      const banner = document.getElementById('overlay-reload-banner');
      if (banner) banner.classList.add('visible');
    }
  } catch (e) {
    console.warn(`Focused-note refresh failed (${reason})`, e);
  }
}

function bindResponsiveLayoutHooks() {
  if (window._secretaryResponsiveHooksBound) return;
  window._secretaryResponsiveHooksBound = true;

  updateViewportCssVars();

  const onDisplayGeometryMaybeChanged = () => {
    const vw = Math.round(window.visualViewport?.width || window.innerWidth || 0);
    const vh = Math.round(window.visualViewport?.height || window.innerHeight || 0);
    const dpr = window.devicePixelRatio || 1;
    const sig = `${vw}x${vh}@${dpr}`;
    if (sig === _lastViewportSig) return;
    _lastViewportSig = sig;
    queueResponsiveRefresh();
  };

  window.addEventListener('resize', onDisplayGeometryMaybeChanged);
  window.addEventListener('orientationchange', onDisplayGeometryMaybeChanged);
  window.addEventListener('pageshow', onDisplayGeometryMaybeChanged);
  window.addEventListener('focus', () => {
    onDisplayGeometryMaybeChanged();
    refreshOpenNoteIfChanged('focus');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      onDisplayGeometryMaybeChanged();
      refreshOpenNoteIfChanged('visibility');
    }
  });

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', onDisplayGeometryMaybeChanged);
  }

  try {
    const dprMq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    dprMq.addEventListener('change', onDisplayGeometryMaybeChanged);
  } catch (e) {
    // Ignore unsupported matchMedia resolution listeners.
  }
}

function applySettings() {
  // theme attribute (dark/light/system)
  const themeVal = (settings.ui && settings.ui.theme) || 'system';
  if (themeVal === 'system') {
    document.body.removeAttribute('data-theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.body.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    document.body.setAttribute('data-theme', themeVal === 'dark' ? 'dark' : 'light');
  }
  if (window.AppBridge?.theme?.notifyChanged) {
    window.AppBridge.theme.notifyChanged(themeVal);
  }

  // Clear legacy inline color overrides on root that break CSS theme switching
  const rootStyle = document.documentElement.style;
  ['--bg', '--text', '--card-bg', '--card-bg-alt', '--todo-rank-bg', '--todo-rank-text'].forEach(prop => {
    rootStyle.removeProperty(prop);
  });

  // Apply custom accent color if defined
  if (settings.ui && settings.ui.accent) {
    rootStyle.setProperty('--accent', settings.ui.accent);
  } else {
    rootStyle.removeProperty('--accent');
  }

  // Apply week cutoff if stored in settings
  if (settings.ui && settings.ui.weekCutoffWeeks) {
    weekCutoffWeeks = Math.max(1, Math.min(104, parseInt(settings.ui.weekCutoffWeeks) || 8));
    try { localStorage.setItem('secretaryWeekCutoff', String(weekCutoffWeeks)); } catch(e) {}
  }
  // Apply work schedule from settings
  if (settings.ui && settings.ui.workStartTime) {
    workStartTime = settings.ui.workStartTime;
    try { localStorage.setItem('secretaryWorkStart', workStartTime); } catch(e) {}
  }
  if (settings.ui && settings.ui.workEndTime) {
    workEndTime = settings.ui.workEndTime;
    try { localStorage.setItem('secretaryWorkEnd', workEndTime); } catch(e) {}
  }
  if (settings.ui && settings.ui.defaultPlannerDuration) {
    defaultPlannerDuration = parseInt(settings.ui.defaultPlannerDuration) || 30;
    try { localStorage.setItem('secretaryDefaultDuration', String(defaultPlannerDuration)); } catch(e) {}
  }
  if (settings.ui && settings.ui.workingDays) {
    plannerWorkingDays = settings.ui.workingDays;
    try { localStorage.setItem('secretaryWorkingDays', JSON.stringify(plannerWorkingDays)); } catch(e) {}
  }
  const defaultLang = (typeof getBrowserLanguageCode === 'function' ? getBrowserLanguageCode() : 'en');
  appLanguage = normalizeLanguageCode(settings.language || appLanguage || defaultLang);
  applyLocalizedUI();
}

let _saveFolderSettingsTimer = null;
function saveFolderSettingsDebounced() {
  if (typeof rootHandle === 'undefined' || !rootHandle) return;
  if (_saveFolderSettingsTimer) clearTimeout(_saveFolderSettingsTimer);
  _saveFolderSettingsTimer = setTimeout(async () => {
    try {
      await StorageAPI.writeSettings(settings);
      broadcastSync({ type: 'SETTINGS_UPDATED', settings });
      console.log('Auto-saved settings to folder');
    } catch (e) {
      console.warn('Failed to auto-save settings to folder', e);
    }
  }, 500);
}

let activePrefsTab = 'general';

function switchPrefsTab(tabId) {
  activePrefsTab = tabId;
  document.querySelectorAll('.prefs-tab-btn').forEach(btn => {
    const isCurrent = (btn.dataset.tab === tabId);
    btn.classList.toggle('active', isCurrent);
    btn.setAttribute('aria-selected', isCurrent ? 'true' : 'false');
  });
  const sections = {
    general: ['prefs-sec-language', 'prefs-sec-profile'],
    appearance: ['prefs-sec-appearance'],
    schedule: ['prefs-sec-schedule'],
    ai: ['prefs-sec-ai'],
    sync: ['prefs-sec-sync', 'prefs-sec-user-info'],
    system: ['prefs-sec-folder', 'prefs-sec-maintenance', 'prefs-sec-help']
  };
  Object.entries(sections).forEach(([tId, secIds]) => {
    const isCurrent = (tId === tabId);
    secIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        if (id === 'prefs-sec-user-info') {
          const isFirebase = window.FirebaseSyncService?.state?.engine === 'firebase';
          el.style.display = (isCurrent && isFirebase) ? 'block' : 'none';
        } else {
          el.style.display = isCurrent ? 'block' : 'none';
        }
      }
    });
  });
}
window.switchPrefsTab = switchPrefsTab;

function togglePassVisibility(inputId, btnEl) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const isPass = input.type === 'password';
  input.type = isPass ? 'text' : 'password';
  if (btnEl) {
    btnEl.innerHTML = isPass
      ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
      : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  }
}
window.togglePassVisibility = togglePassVisibility;

function openCloudSyncModalOrPrefs() {
  if (window.FirebaseSyncService?.state?.engine === 'firebase' && !window.FirebaseSyncService?.state?.isUnlocked) {
    if (typeof openModal === 'function') {
      openModal('modal-cloud-sync-unlock');
      return;
    }
  }
  if (typeof switchTab === 'function') {
    switchTab('prefs');
    if (typeof switchPrefsTab === 'function') {
      switchPrefsTab('sync');
    }
  }
}
window.openCloudSyncModalOrPrefs = openCloudSyncModalOrPrefs;

function updateCloudSyncUI(statusObj) {
  const status = statusObj || (window.FirebaseSyncService ? window.FirebaseSyncService.getStatus() : { status: 'disconnected', engine: 'filesystem' });
  const iconWrap = document.getElementById('cloud-sync-icon-wrap');
  const btn = document.getElementById('btn-cloud-sync-status');
  const statusText = document.getElementById('prefs-sync-status-text');
  const countText = document.getElementById('prefs-sync-count-text');
  const engineSelect = document.getElementById('prefs-storage-engine-select');

  if (engineSelect) {
    engineSelect.value = status.engine || 'filesystem';
  }

  let statusHtml = (typeof t === 'function' ? t('sync.status') : 'Status') + ': ';
  let iconSvg = '';

  const isFirebase = status.engine === 'firebase';
  const folderName = (typeof rootHandle !== 'undefined' && rootHandle?.name) || window.folderPath || (typeof settings !== 'undefined' && settings?.folder?.last) || 'Local Notes Folder';

  // Update Active Storage & Folder Banner
  const folderPathEl = document.getElementById('prefs-storage-folder-path');
  const bannerTitle = document.getElementById('prefs-storage-banner-title');
  const bannerBadge = document.getElementById('prefs-storage-banner-badge');
  const bannerDesc = document.getElementById('prefs-storage-banner-desc');
  const bannerIcon = document.getElementById('prefs-storage-banner-icon');

  if (folderPathEl) {
    folderPathEl.textContent = folderName;
  }
  if (bannerTitle && bannerBadge && bannerDesc) {
    if (isFirebase) {
      bannerTitle.textContent = typeof t === 'function' ? t('sync.activeStorageCloud') : 'Firebase Cloud Vault Active';
      bannerBadge.textContent = typeof t === 'function' ? t('landing.cloudBadge') : 'E2EE Cloud';
      bannerBadge.style.background = 'rgba(99,102,241,0.15)';
      bannerBadge.style.color = 'var(--accent)';
      bannerBadge.style.borderColor = 'rgba(99,102,241,0.3)';
      if (bannerIcon) {
        bannerIcon.style.background = 'rgba(99,102,241,0.15)';
        bannerIcon.style.color = 'var(--accent)';
        bannerIcon.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/><polyline points="9 15 12 18 17 13"/></svg>`;
      }
      bannerDesc.innerHTML = `${typeof t === 'function' ? t('sync.cloudStoringDesc') : 'Notes are synchronized securely with client-side encryption'}: <strong style="color:var(--text);">${window.FirebaseSyncService?.getSyncCode() || 'SEC-PAIRING'}</strong>`;
    } else {
      bannerTitle.textContent = typeof t === 'function' ? t('sync.activeStorageLocalFolder') : 'Local Folder Storage Active';
      bannerBadge.textContent = typeof t === 'function' ? t('sync.localFolderStorage') : 'Local Folder';
      bannerBadge.style.background = 'rgba(16,185,129,0.15)';
      bannerBadge.style.color = '#10b981';
      bannerBadge.style.borderColor = 'rgba(16,185,129,0.3)';
      if (bannerIcon) {
        bannerIcon.style.background = 'rgba(16,185,129,0.15)';
        bannerIcon.style.color = '#10b981';
        bannerIcon.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
      }
      bannerDesc.innerHTML = `${typeof t === 'function' ? t('sync.folderStoringDesc') : 'Notes, tasks, and files are saved directly in your local folder'}: <strong style="color:var(--text); font-family:var(--font-mono, monospace);">${folderName}</strong>`;
    }
  }

  if (status.engine === 'filesystem') {
    statusHtml += `<span style="display:inline-flex; align-items:center; gap:5px; color:#10b981"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg> ${typeof t === 'function' ? t('sync.statusLocalFolder') : 'Local Folder Active'}</span>`;
    iconSvg = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
  } else if (status.status === 'synced') {
    statusHtml += `<span style="display:inline-flex; align-items:center; gap:5px; color:var(--color-low, #10b981)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/><polyline points="9 15 12 18 17 13"/></svg> ${typeof t === 'function' ? t('sync.statusSynced') : 'Synced (Encrypted)'}</span>`;
    iconSvg = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/><polyline points="9 15 12 18 17 13"/></svg>`;
  } else if (status.status === 'syncing') {
    statusHtml += `<span style="display:inline-flex; align-items:center; gap:5px; color:var(--color-medium, #3b82f6)"><svg class="icon-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg> ${typeof t === 'function' ? t('sync.statusSyncing') : 'Syncing...'}</span>`;
    iconSvg = `<svg class="icon-spin" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg>`;
  } else if (status.status === 'declined') {
    statusHtml += `<span style="display:inline-flex; align-items:center; gap:5px; color:#ef4444" title="${typeof t === 'function' ? t('sync.statusDeclinedTooltip') : 'Cloud sync is disabled because your Secretary version is below the minimum supported version.'}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> ${typeof t === 'function' ? t('sync.statusDeclined') : 'Version Declined (Sync Disabled)'}</span>`;
    iconSvg = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>`;
  } else if (status.status === 'offline') {
    statusHtml += `<span style="display:inline-flex; align-items:center; gap:5px; color:#f59e0b"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/><line x1="1" y1="1" x2="23" y2="23"/></svg> ${typeof t === 'function' ? t('sync.statusOffline') : 'Local Cache (Offline)'}</span>`;
    iconSvg = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
  } else if (status.status === 'locked') {
    statusHtml += `<span style="display:inline-flex; align-items:center; gap:5px; color:#ef4444"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> ${typeof t === 'function' ? t('sync.statusLocked') : 'Vault Locked'}</span>`;
    iconSvg = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
  } else {
    statusHtml += `<span style="display:inline-flex; align-items:center; gap:5px; color:var(--text-muted)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg> ${typeof t === 'function' ? t('sync.statusDisconnected') : 'Disconnected'}</span>`;
    iconSvg = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>`;
  }

  if (statusText) statusText.innerHTML = statusHtml;
  if (countText) {
    const notesCount = (typeof manifest !== 'undefined' && Array.isArray(manifest)) ? manifest.length : (status.notesCount || 0);
    const todosCount = (typeof todosManifest !== 'undefined' && Array.isArray(todosManifest)) ? todosManifest.length : 0;
    const plannerCount = (typeof plannerEvents !== 'undefined' && Array.isArray(plannerEvents)) ? plannerEvents.length : 0;

    const notesLabel = isFirebase
      ? (typeof t === 'function' ? t('sync.notesCached') : 'notes cached')
      : (typeof t === 'function' ? t('sync.notesInLocalFolder') : 'notes in local folder');

    const parts = [`${notesCount} ${notesLabel}`];
    if (todosCount > 0) {
      parts.push(`${todosCount} ${typeof t === 'function' ? t('sync.todosCached') : 'tasks'}`);
    }
    if (plannerCount > 0) {
      parts.push(`${plannerCount} ${typeof t === 'function' ? t('sync.eventsCached') : 'events'}`);
    }
    countText.textContent = parts.join(' · ');
  }
  if (iconWrap && iconSvg) iconWrap.innerHTML = iconSvg;
  if (btn) {
    btn.title = isFirebase
      ? `${typeof t === 'function' ? t('sync.storage') : 'Storage'}: Firebase E2EE (${status.status})`
      : `${typeof t === 'function' ? t('sync.storage') : 'Storage'}: ${typeof t === 'function' ? t('sync.localFolderStorage') : 'Local Folder'} (${folderName})`;
  }

  const btnMigrate = document.getElementById('btn-prefs-migrate-firebase');
  const btnReconcile = document.getElementById('btn-prefs-reconcile-backup');
  const btnRevert = document.getElementById('btn-prefs-revert-fs');
  const btnRotate = document.getElementById('btn-prefs-rotate-pass');
  if (btnMigrate) btnMigrate.style.display = isFirebase ? 'none' : '';
  if (btnReconcile) btnReconcile.style.display = isFirebase ? '' : 'none';
  if (btnRevert) btnRevert.style.display = isFirebase ? '' : 'none';
  if (btnRotate) btnRotate.style.display = isFirebase ? '' : 'none';

  const user = window.FirebaseSyncService ? window.FirebaseSyncService.getAuthUser() : null;

  const syncCodeRow = document.getElementById('prefs-sync-code-row');
  const syncCodeInput = document.getElementById('prefs-sync-code-input');
  let syncCode = window.FirebaseSyncService ? window.FirebaseSyncService.getSyncCode() : null;
  if (!syncCode && typeof settings !== 'undefined' && settings?.vaultId) {
    syncCode = settings.vaultId;
  }
  if (!syncCode && user && user.uid) {
    syncCode = user.uid;
  }
  if (syncCodeRow && syncCodeInput) {
    syncCodeRow.style.display = 'flex';
    syncCodeInput.value = syncCode || (typeof t === 'function' ? t('sync.syncCodeNotSet') : 'Not Generated Yet');
  }

  const passRow = document.getElementById('prefs-sync-pass-row');
  const passInput = document.getElementById('prefs-sync-pass-input');
  if (passRow && passInput) {
    passRow.style.display = 'flex';
    if (window.FirebaseSyncService?.getActivePassphrase) {
      window.FirebaseSyncService.getActivePassphrase().then(pass => {
        if (pass && passInput) {
          passInput.value = pass;
        } else if (passInput) {
          passInput.value = '';
          passInput.placeholder = window.FirebaseSyncService?.state?.isUnlocked
            ? '•••••••••••• (In Memory)'
            : (typeof t === 'function' ? t('sync.passphraseLockedPlaceholder') : '•••••••••••• (Locked)');
        }
      }).catch(() => {});
    }
  }

  const accountEmailEl = document.getElementById('prefs-sync-account-email');
  const btnSignIn = document.getElementById('btn-prefs-sync-signin');
  const btnSignOut = document.getElementById('btn-prefs-sync-signout');
  const btnResetPass = document.getElementById('btn-prefs-sync-reset-pass');

  if (accountEmailEl) {
    if (user && user.email) {
      accountEmailEl.textContent = `${typeof t === 'function' ? t('sync.accountSignedInAs') : 'Signed in as'}: ${user.email}`;
      if (btnSignIn) {
        btnSignIn.textContent = typeof t === 'function' ? t('sync.accountSignInBtn') : 'Switch User';
        btnSignIn.title = typeof t === 'function' ? t('sync.accountSignInTooltip') : 'Sign in or switch cloud account';
      }
      if (btnSignOut) btnSignOut.style.display = 'inline-flex';
      if (btnResetPass) btnResetPass.style.display = 'inline-flex';
    } else if (user && user.isAnonymous) {
      accountEmailEl.textContent = typeof t === 'function' ? t('sync.accountGuestSession') : 'Guest / Anonymous Session';
      if (btnSignIn) {
        btnSignIn.textContent = typeof t === 'function' ? t('sync.accountSignInBtn') : 'Sign In / Create Account';
        btnSignIn.title = typeof t === 'function' ? t('sync.accountSignInTooltip') : 'Sign in or switch cloud account';
      }
      if (btnSignOut) btnSignOut.style.display = 'inline-flex';
      if (btnResetPass) btnResetPass.style.display = 'none';
    } else {
      accountEmailEl.textContent = typeof t === 'function' ? t('sync.accountNotSignedIn') : 'Not Signed In';
      if (btnSignIn) {
        btnSignIn.textContent = typeof t === 'function' ? t('sync.accountSignInBtn') : 'Sign In / Switch User';
        btnSignIn.title = typeof t === 'function' ? t('sync.accountSignInTooltip') : 'Sign in or switch cloud account';
      }
      if (btnSignOut) btnSignOut.style.display = 'none';
      if (btnResetPass) btnResetPass.style.display = 'none';
    }
  }

  // ── Multi-Provider User Information & Authentication Methods (Shown only when not local only) ──
  const userInfoSec = document.getElementById('prefs-sec-user-info');
  if (userInfoSec) {
    const isFirebase = status.engine === 'firebase';
    userInfoSec.style.display = isFirebase ? 'block' : 'none';

    if (isFirebase) {
      const avatarEl = document.getElementById('prefs-user-avatar');
      const nameEl = document.getElementById('prefs-user-display-name');
      const badgeEl = document.getElementById('prefs-user-session-badge');
      const emailEl = document.getElementById('prefs-user-email-text');
      const uidEl = document.getElementById('prefs-user-uid-text');

      if (avatarEl) {
        avatarEl.textContent = (user && user.email)
          ? user.email.charAt(0).toUpperCase()
          : (user && user.isAnonymous ? 'G' : 'P');
      }
      if (nameEl) {
        nameEl.textContent = (user && user.email)
          ? user.email.split('@')[0]
          : (user && user.isAnonymous
              ? (typeof t === 'function' ? t('sync.accountGuestSession') : 'Guest Session')
              : (typeof t === 'function' ? t('sync.authMethodPassphraseTitle') : 'Passphrase Vault'));
      }
      if (badgeEl) {
        badgeEl.textContent = (user && user.isAnonymous)
          ? (typeof t === 'function' ? t('sync.accountGuestSession') : 'Guest Session')
          : (user && user.email
              ? (typeof t === 'function' ? t('sync.authStatusLinked') : 'Linked')
              : (typeof t === 'function' ? t('sync.authStatusActive') : 'Active'));
      }
      if (emailEl) {
        emailEl.textContent = (user && user.email)
          ? user.email
          : (user && user.isAnonymous
              ? (typeof t === 'function' ? t('sync.accountGuestSession') : 'Guest / Anonymous')
              : (typeof t === 'function' ? t('sync.authStatusNotLinked') : 'Not Linked'));
      }
      if (uidEl) {
        uidEl.textContent = (user && user.uid) ? `UID: ${user.uid}` : '';
      }

      // Provider rows
      const linkedProviders = (user && user.linkedProviders) ? user.linkedProviders : [];
      const hasGoogle = linkedProviders.some(p => p.providerId === 'google.com');
      const hasPassword = linkedProviders.some(p => p.providerId === 'password') || (!!(user && user.email) && !user.isAnonymous && !hasGoogle);

      // Google
      const badgeGoogle = document.getElementById('badge-auth-google');
      const btnLinkGoogle = document.getElementById('btn-link-auth-google');
      if (badgeGoogle) {
        badgeGoogle.textContent = hasGoogle
          ? (typeof t === 'function' ? t('sync.authStatusLinked') : 'Linked')
          : (typeof t === 'function' ? t('sync.authStatusNotLinked') : 'Not Linked');
        badgeGoogle.style.background = hasGoogle ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.08)';
        badgeGoogle.style.color = hasGoogle ? '#10b981' : 'var(--text-muted)';
      }
      if (btnLinkGoogle) {
        btnLinkGoogle.style.display = hasGoogle ? 'none' : 'inline-flex';
      }

      // Email & Password
      const badgeEmail = document.getElementById('badge-auth-email');
      const btnLinkEmail = document.getElementById('btn-link-auth-email');
      const btnUserReset = document.getElementById('btn-user-reset-pass');
      if (badgeEmail) {
        badgeEmail.textContent = hasPassword
          ? (typeof t === 'function' ? t('sync.authStatusLinked') : 'Linked')
          : (typeof t === 'function' ? t('sync.authStatusNotLinked') : 'Not Linked');
        badgeEmail.style.background = hasPassword ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.08)';
        badgeEmail.style.color = hasPassword ? '#10b981' : 'var(--text-muted)';
      }
      if (btnLinkEmail) {
        btnLinkEmail.style.display = hasPassword ? 'none' : 'inline-flex';
      }
      if (btnUserReset) {
        btnUserReset.style.display = (hasPassword && user && user.email) ? 'inline-flex' : 'none';
      }

      // Magic link
      const btnSendMagic = document.getElementById('btn-user-send-magic');
      if (btnSendMagic) {
        btnSendMagic.style.display = (user && user.email && !user.isAnonymous) ? 'inline-flex' : 'none';
      }
    }
  }

  refreshRememberPassphraseControl();
}
window.updateCloudSyncUI = updateCloudSyncUI;

function renderAppVersionBanner(vStatus) {
  const mainBanner = document.getElementById('app-version-banner');
  const landingBanner = document.getElementById('landing-version-banner');
  const banners = [mainBanner, landingBanner].filter(Boolean);

  if (!vStatus || vStatus.status === 'up_to_date' || vStatus.status === 'unknown') {
    banners.forEach((b) => {
      b.style.display = 'none';
      b.innerHTML = '';
      b.className = b.id === 'landing-version-banner' ? 'app-version-banner landing-version-banner' : 'app-version-banner';
    });
    return;
  }

  const { status, currentVersion, minVersion, latestVersion, downloadUrl } = vStatus;
  const targetUrl = downloadUrl || 'https://github.com/ebelt9hf/The_Secretary';

  let bannerClass = '';
  let iconSvg = '';
  let message = '';
  let showClose = false;

  if (status === 'declined') {
    bannerClass = 'banner-declined';
    iconSvg = `<svg class="version-banner-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
    const template = typeof t === 'function' ? t('sync.versionDeclined') : 'Secretary v{currentVersion} is below the minimum required version v{minVersion}. Cloud sync has been declined.';
    message = template.replace('{currentVersion}', currentVersion || '4.0.0').replace('{minVersion}', minVersion || '4.0.0');
    showClose = false;
  } else if (status === 'deprecated') {
    bannerClass = 'banner-deprecated';
    iconSvg = `<svg class="version-banner-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
    const template = typeof t === 'function' ? t('sync.versionDeprecated') : 'Deprecation Warning: Secretary v{currentVersion} will soon lose cloud support. Please update to v{latestVersion}.';
    message = template.replace('{currentVersion}', currentVersion || '4.0.0').replace('{latestVersion}', latestVersion || '4.0.0');
    showClose = true;
  } else if (status === 'update_available') {
    bannerClass = 'banner-update';
    iconSvg = `<svg class="version-banner-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
    const template = typeof t === 'function' ? t('sync.versionUpdateAvailable') : 'A new version of Secretary (v{latestVersion}) is available.';
    message = template.replace('{latestVersion}', latestVersion || '4.0.0');
    showClose = true;
  }

  const btnLabel = typeof t === 'function' ? t('sync.versionDownloadBtn') : 'Download Update';
  const btnTooltip = typeof t === 'function' ? t('sync.versionDownloadTooltip') : 'Open GitHub releases page to download the latest Secretary version';
  const closeTitle = typeof t === 'function' ? t('sync.versionDismissBtn') : 'Dismiss';

  const html = `
    <div class="version-banner-content">
      ${iconSvg}
      <span class="version-banner-text">${message}</span>
    </div>
    <div class="version-banner-actions">
      <a href="${targetUrl}" target="_blank" rel="noopener noreferrer" class="version-banner-btn" title="${btnTooltip}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
        ${btnLabel}
      </a>
      ${showClose ? `<button type="button" class="version-banner-close-btn" title="${closeTitle}" onclick="dismissAppVersionBanner()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>` : ''}
    </div>
  `;

  banners.forEach((b) => {
    b.className = b.id === 'landing-version-banner' ? `app-version-banner landing-version-banner ${bannerClass}` : `app-version-banner ${bannerClass}`;
    b.innerHTML = html;
    b.style.display = 'flex';
  });
}
window.renderAppVersionBanner = renderAppVersionBanner;

function dismissAppVersionBanner() {
  const mainBanner = document.getElementById('app-version-banner');
  const landingBanner = document.getElementById('landing-version-banner');
  [mainBanner, landingBanner].forEach((b) => {
    if (b) b.style.display = 'none';
  });
}
window.dismissAppVersionBanner = dismissAppVersionBanner;

function updatePassphraseStrengthUI(passphrase) {
  const badge = document.getElementById('sync-setup-pass-badge');
  if (!badge) return;
  const evalResult = window.FirebaseSyncService?.evaluatePassphraseStrength
    ? window.FirebaseSyncService.evaluatePassphraseStrength(passphrase)
    : { score: (passphrase && passphrase.length >= 35) ? 'ultra' : 'acceptable', length: passphrase?.length || 0, textKey: 'sync.badgeUltraSecure' };

  let rawText = typeof t === 'function' ? t(evalResult.textKey) : evalResult.textKey;
  rawText = rawText.replace('{count}', String(evalResult.length));
  badge.textContent = rawText;

  if (evalResult.score === 'ultra') {
    badge.style.background = 'rgba(16, 185, 129, 0.15)';
    badge.style.color = '#10b981';
    badge.style.borderColor = 'rgba(16, 185, 129, 0.3)';
  } else if (evalResult.score === 'strong') {
    badge.style.background = 'rgba(59, 130, 246, 0.15)';
    badge.style.color = '#3b82f6';
    badge.style.borderColor = 'rgba(59, 130, 246, 0.3)';
  } else if (evalResult.score === 'acceptable') {
    badge.style.background = 'rgba(245, 158, 11, 0.15)';
    badge.style.color = '#f59e0b';
    badge.style.borderColor = 'rgba(245, 158, 11, 0.3)';
  } else {
    badge.style.background = 'rgba(239, 68, 68, 0.15)';
    badge.style.color = '#ef4444';
    badge.style.borderColor = 'rgba(239, 68, 68, 0.3)';
  }
}
window.updatePassphraseStrengthUI = updatePassphraseStrengthUI;

function handleSetupPassphraseInput(value) {
  updatePassphraseStrengthUI(value);
}
window.handleSetupPassphraseInput = handleSetupPassphraseInput;

function regenerateSetupPassphrase() {
  const passInput = document.getElementById('sync-setup-passphrase');
  if (passInput && window.FirebaseSyncService?.generateDefaultPassphrase) {
    const newPass = window.FirebaseSyncService.generateDefaultPassphrase();
    passInput.value = newPass;
    updatePassphraseStrengthUI(newPass);
  }
}
window.regenerateSetupPassphrase = regenerateSetupPassphrase;

function _fallbackCopyText(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '-9999px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return true;
  } catch (e) {
    return false;
  }
}

function copySetupPassphrase() {
  const passInput = document.getElementById('sync-setup-passphrase');
  const pass = passInput?.value;
  if (!pass) return;
  const cleanPass = typeof CryptoEngine !== 'undefined' && typeof CryptoEngine.cleanPassphrase === 'function'
    ? CryptoEngine.cleanPassphrase(pass)
    : pass.replace(/^[\s\uFEFF\u200B-\u200D\u00A0]+|[\s\uFEFF\u200B-\u200D\u00A0]+$/g, '').normalize('NFC');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(cleanPass).catch(() => _fallbackCopyText(cleanPass));
  } else {
    _fallbackCopyText(cleanPass);
  }
  if (typeof showToast === 'function') {
    showToast(typeof t === 'function' ? t('sync.passphraseCopied') : 'Master passphrase copied to clipboard');
  }
}
window.copySetupPassphrase = copySetupPassphrase;

function switchSyncSetupTab(mode) {
  const normMode = mode === 'new' ? 'signup' : mode;
  const isSignIn = normMode === 'signin';
  const isSignUp = normMode === 'signup';
  const isLink = normMode === 'link';
  const isGuest = normMode === 'guest';

  const tabSignIn = document.getElementById('tab-sync-signin');
  const tabSignUp = document.getElementById('tab-sync-signup');
  const tabLink = document.getElementById('tab-sync-link');
  const tabGuest = document.getElementById('tab-sync-guest');
  const tabNew = document.getElementById('tab-sync-new');

  const authFields = document.getElementById('sync-setup-auth-fields');
  const emailInput = document.getElementById('sync-setup-email');
  const authPassInput = document.getElementById('sync-setup-auth-password');
  const dummyUsername = document.getElementById('sync-setup-username');
  const forgotPassLink = document.getElementById('sync-setup-forgot-pass-link');
  const codeContainer = document.getElementById('sync-setup-code-container');
  const regenBtn = document.getElementById('btn-sync-setup-regen');
  const codeHint = document.getElementById('sync-setup-code-hint');
  const syncInput = document.getElementById('sync-setup-sync-code');
  const submitBtn = document.getElementById('btn-submit-cloud-sync');
  const passInput = document.getElementById('sync-setup-passphrase');
  const passRegenBtn = document.getElementById('btn-sync-setup-pass-regen');
  const passCopyBtn = document.getElementById('btn-sync-setup-pass-copy');
  const passClarityCard = document.getElementById('sync-setup-pass-clarity-card');
  const passHint = document.getElementById('sync-setup-pass-hint');
  const passVisibilityBtn = document.getElementById('btn-sync-setup-pass-visibility');

  if (dummyUsername) {
    dummyUsername.disabled = (isSignIn || isSignUp);
  }

  if (emailInput) {
    if (isSignIn || isSignUp) {
      emailInput.setAttribute('autocomplete', 'username');
    }
  }

  if (authPassInput) {
    if (isSignUp) {
      authPassInput.setAttribute('autocomplete', 'new-password');
    } else {
      authPassInput.setAttribute('autocomplete', 'current-password');
    }
  }

  const updateTabStyle = (el, active) => {
    if (!el) return;
    el.style.borderBottomColor = active ? 'var(--accent)' : 'transparent';
    el.style.color = active ? 'var(--accent)' : 'var(--text-muted)';
  };

  updateTabStyle(tabSignIn, isSignIn);
  updateTabStyle(tabSignUp, isSignUp);
  updateTabStyle(tabNew, isSignUp);
  updateTabStyle(tabLink, isLink);
  updateTabStyle(tabGuest, isGuest);

  if (authFields) authFields.style.display = (isSignIn || isSignUp) ? 'block' : 'none';
  if (forgotPassLink) forgotPassLink.style.display = isSignIn ? 'inline' : 'none';
  if (codeContainer) codeContainer.style.display = (isLink || isGuest) ? 'block' : 'none';
  if (regenBtn) regenBtn.style.display = (isSignUp || isGuest) ? 'inline-flex' : 'none';
  if (passRegenBtn) passRegenBtn.style.display = (isSignUp || isGuest) ? 'inline-flex' : 'none';
  if (passCopyBtn) passCopyBtn.style.display = (isSignUp || isGuest) ? 'inline-flex' : 'none';
  if (passClarityCard) passClarityCard.style.display = 'block';

  if (syncInput) {
    if ((isSignUp || isGuest) && (!syncInput.value || syncInput.getAttribute('data-linked') === 'true')) {
      if (window.FirebaseSyncService?.generateSyncCode) {
        syncInput.value = window.FirebaseSyncService.generateSyncCode();
      }
      syncInput.removeAttribute('data-linked');
    } else if (isLink) {
      syncInput.value = '';
      syncInput.setAttribute('data-linked', 'true');
    }
  }

  if (passInput) {
    if (isSignUp || isGuest) {
      if (!passInput.value || passInput.getAttribute('data-linked') === 'true') {
        if (window.FirebaseSyncService?.generateDefaultPassphrase) {
          passInput.value = window.FirebaseSyncService.generateDefaultPassphrase();
        }
        passInput.removeAttribute('data-linked');
      }
      passInput.type = 'text';
      if (passVisibilityBtn) {
        passVisibilityBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
      }
    } else {
      passInput.value = '';
      passInput.setAttribute('data-linked', 'true');
      passInput.type = 'password';
      if (passVisibilityBtn) {
        passVisibilityBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
      }
    }
    updatePassphraseStrengthUI(passInput.value);
  }

  if (passHint) {
    if (isSignIn) {
      passHint.textContent = typeof t === 'function' ? t('sync.passphraseSignInHelp') : 'Enter the master passphrase configured for your vault to decrypt your notes.';
    } else if (isSignUp || isGuest) {
      passHint.textContent = typeof t === 'function' ? t('sync.passphraseHint') : 'Minimum 10 characters. Required to decrypt notes on other devices.';
    } else {
      passHint.textContent = typeof t === 'function' ? t('sync.passphraseLinkHelp') : 'Enter the master passphrase configured on your other device to decrypt your notes.';
    }
  }

  if (codeHint) {
    if (isLink) {
      codeHint.textContent = typeof t === 'function' ? t('sync.tabLinkVaultTooltip') : 'Connect to an existing vault using a sync code and passphrase';
    } else {
      codeHint.textContent = typeof t === 'function' ? t('sync.syncCodeHelp') : 'Enter this Sync Code and your Master Passphrase on any other computer to synchronize your notes.';
    }
  }

  if (submitBtn) {
    submitBtn.setAttribute('data-mode', normMode);
    if (isSignIn) {
      submitBtn.textContent = typeof t === 'function' ? t('sync.signInAndSyncBtn') : 'Sign In & Sync';
      submitBtn.title = typeof t === 'function' ? t('sync.signInAndSyncBtnTooltip') : 'Sign in with email and connect your encrypted vault';
    } else if (isSignUp) {
      submitBtn.textContent = typeof t === 'function' ? t('sync.createAccountAndSyncBtn') : 'Create Account & Sync';
      submitBtn.title = typeof t === 'function' ? t('sync.createAccountAndSyncBtnTooltip') : 'Create account and initialize zero-knowledge encrypted vault';
    } else if (isLink) {
      submitBtn.textContent = typeof t === 'function' ? t('sync.linkVaultBtn') : 'Link & Sync Notes';
      submitBtn.title = typeof t === 'function' ? t('sync.linkVaultBtnTooltip') : 'Connect to existing vault';
    } else {
      submitBtn.textContent = typeof t === 'function' ? t('sync.enableSyncBtn') : 'Enable Sync';
      submitBtn.title = typeof t === 'function' ? t('sync.enableSyncBtnTooltip') : 'Initialize zero-knowledge encryption and enable sync';
    }
  }
}
window.switchSyncSetupTab = switchSyncSetupTab;

function regenerateSetupSyncCode() {
  const syncInput = document.getElementById('sync-setup-sync-code');
  if (syncInput && window.FirebaseSyncService?.generateSyncCode) {
    syncInput.value = window.FirebaseSyncService.generateSyncCode();
  }
}
window.regenerateSetupSyncCode = regenerateSetupSyncCode;

function copySetupSyncCode() {
  const syncInput = document.getElementById('sync-setup-sync-code');
  const code = syncInput?.value ? String(syncInput.value).trim() : '';
  if (!code) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(code).catch(() => _fallbackCopyText(code));
  } else {
    _fallbackCopyText(code);
  }
  if (typeof showToast === 'function') {
    showToast(typeof t === 'function' ? t('sync.syncCodeCopied') : 'Sync Code copied to clipboard');
  }
}
window.copySetupSyncCode = copySetupSyncCode;

function copySyncCodeUI() {
  const syncCodeInput = document.getElementById('prefs-sync-code-input');
  let syncCode = window.FirebaseSyncService ? window.FirebaseSyncService.getSyncCode() : null;
  if (!syncCode && syncCodeInput && syncCodeInput.value && !syncCodeInput.value.includes('Not') && !syncCodeInput.value.includes('•')) {
    syncCode = syncCodeInput.value;
  }
  if (!syncCode) {
    if (typeof showToast === 'function') {
      showToast(typeof t === 'function' ? t('sync.syncCodeNotSet') : 'No Sync Code found', true);
    }
    return;
  }
  const clean = String(syncCode).trim();
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(clean).catch(() => _fallbackCopyText(clean));
  } else {
    _fallbackCopyText(clean);
  }
  if (typeof showToast === 'function') {
    showToast(typeof t === 'function' ? t('sync.syncCodeCopied') : 'Sync Code copied to clipboard');
  }
}
window.copySyncCodeUI = copySyncCodeUI;

async function copyPassphraseUI() {
  const input = document.getElementById('prefs-sync-pass-input');
  let pass = input?.value || '';
  if (!pass || pass.startsWith('••••')) {
    if (window.FirebaseSyncService?.getActivePassphrase) {
      pass = await window.FirebaseSyncService.getActivePassphrase();
    }
  }
  if (!pass) {
    if (typeof showToast === 'function') {
      showToast(typeof t === 'function' ? t('sync.passphraseUnavailable') : 'Passphrase is not available in memory. Please unlock vault.', true);
    }
    return;
  }
  const clean = typeof CryptoEngine?.cleanPassphrase === 'function' ? CryptoEngine.cleanPassphrase(pass) : String(pass).trim();
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(clean).catch(() => _fallbackCopyText(clean));
  } else {
    _fallbackCopyText(clean);
  }
  if (typeof showToast === 'function') {
    showToast(typeof t === 'function' ? t('sync.passphraseCopied') : 'Master passphrase copied to clipboard');
  }
}
window.copyPassphraseUI = copyPassphraseUI;

async function togglePassphraseVisibilityUI() {
  const input = document.getElementById('prefs-sync-pass-input');
  const btn = document.getElementById('btn-prefs-sync-pass-visibility');
  if (!input) return;
  const isPass = input.type === 'password';
  if (isPass) {
    if (!input.value || input.value.startsWith('••••')) {
      if (window.FirebaseSyncService?.getActivePassphrase) {
        const p = await window.FirebaseSyncService.getActivePassphrase();
        if (p) input.value = p;
      }
    }
    input.type = 'text';
    if (btn) {
      btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
    }
  } else {
    input.type = 'password';
    if (btn) {
      btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
    }
  }
}
window.togglePassphraseVisibilityUI = togglePassphraseVisibilityUI;

async function changeStorageEngineUI(engine) {
  if (engine === 'firebase') {
    if (!window.FirebaseSyncService?.state?.isUnlocked) {
      if (typeof openModal === 'function') openModal('modal-cloud-sync-setup');
    } else {
      window.StorageAPI.setStorageEngine('firebase');
      updateCloudSyncUI();
      if (typeof showToast === 'function') showToast(typeof t === 'function' ? t('sync.switchedToFirebase') : 'Switched to Firebase Engine');
    }
  } else {
    window.StorageAPI.setStorageEngine('filesystem');
    updateCloudSyncUI();
    if (typeof showToast === 'function') showToast(typeof t === 'function' ? t('sync.switchedToFs') : 'Switched to Filesystem Engine');
  }
}
window.changeStorageEngineUI = changeStorageEngineUI;

async function triggerSyncNowUI() {
  if (window.FirebaseSyncService) {
    await window.FirebaseSyncService.flushQueue();
    updateCloudSyncUI();
    if (typeof showToast === 'function') showToast(typeof t === 'function' ? t('sync.syncedToast') : 'Synced with cloud');
  }
}
window.triggerSyncNowUI = triggerSyncNowUI;

async function rememberPassphraseAfterSetup(pass) {
  const svc = window.FirebaseSyncService;
  if (!svc || typeof svc.savePassphraseLocally !== 'function') return false;
  const saved = await svc.savePassphraseLocally(pass);
  if (!saved && typeof showToast === 'function') {
    showToast(typeof t === 'function' ? t('sync.passphraseStorageUnavailable') : 'Secure passphrase storage is not available on this device', true);
  }
  return saved;
}

function showMigrationProgressDialog(title, initialMsg) {
  let overlay = document.getElementById('migration-progress-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'migration-progress-overlay';
    overlay.className = 'modal-overlay planner-progress-overlay';
    overlay.style.zIndex = '99999';
    overlay.style.display = 'flex';
    overlay.innerHTML = `
      <div class="modal-card planner-progress-dialog" style="padding: 1.5rem; border-radius: 12px; background: var(--card-bg, #1e1e2d); box-shadow: 0 10px 30px rgba(0,0,0,0.5); min-width: 320px; max-width: 440px;">
        <div class="planner-progress-spinner" style="margin-bottom: 0.5rem;"></div>
        <div id="migration-progress-title" class="planner-progress-title" style="font-size: 1.1rem; margin-bottom: 0.25rem;"></div>
        <div id="migration-progress-message" class="planner-progress-message" style="margin-bottom: 1rem;"></div>
        <div class="progress-container" style="width: 100%; margin-bottom: 0.5rem;">
          <div class="progress-track" style="height: 8px; background: rgba(255,255,255,0.1); border-radius: 4px; overflow: hidden;">
            <div id="migration-progress-fill" class="progress-fill" style="width: 0%; height: 100%; background: var(--accent, #6366f1); transition: width 0.2s ease;"></div>
          </div>
        </div>
        <div id="migration-progress-pct" class="progress-pct" style="font-size: 0.85rem; font-weight: 600; color: var(--text-muted, #94a3b8);">0%</div>
      </div>
    `;
    document.body.appendChild(overlay);
  }

  const titleEl = overlay.querySelector('#migration-progress-title');
  const msgEl = overlay.querySelector('#migration-progress-message');
  const fillEl = overlay.querySelector('#migration-progress-fill');
  const pctEl = overlay.querySelector('#migration-progress-pct');

  if (titleEl) titleEl.textContent = title || (typeof t === 'function' ? t('sync.migrationProgressTitle') : 'Migrating to Cloud Vault…');
  if (msgEl) msgEl.textContent = initialMsg || (typeof t === 'function' ? t('sync.migrationProgressCollecting') : 'Collecting local notes and documents…');
  if (fillEl) fillEl.style.width = '0%';
  if (pctEl) pctEl.textContent = '0%';
  overlay.style.display = 'flex';

  return {
    update(msg, pct) {
      if (msg && msgEl) msgEl.textContent = msg;
      const cleanPct = Math.max(0, Math.min(100, Math.round(pct || 0)));
      if (fillEl) fillEl.style.width = `${cleanPct}%`;
      if (pctEl) pctEl.textContent = `${cleanPct}%`;
    },
    close() {
      if (overlay) {
        overlay.style.display = 'none';
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }
    }
  };
}
window.showMigrationProgressDialog = showMigrationProgressDialog;

let _syncConflictResolver = null;

function selectConflictStrategyUI(strategy) {
  const cards = document.querySelectorAll('.sync-conflict-option-card');
  cards.forEach(c => c.classList.remove('selected'));
  const targetCard = document.getElementById(`card-strategy-${strategy === 'merge' ? 'merge' : (strategy === 'overwrite_cloud' ? 'overwrite-cloud' : 'overwrite-local')}`);
  if (targetCard) targetCard.classList.add('selected');
  const radio = document.getElementById(`strategy-radio-${strategy === 'merge' ? 'merge' : (strategy === 'overwrite_cloud' ? 'overwrite-cloud' : 'overwrite-local')}`);
  if (radio) radio.checked = true;
}
window.selectConflictStrategyUI = selectConflictStrategyUI;

function showSyncConflictModalUI(conflictInfo) {
  return new Promise((resolve) => {
    _syncConflictResolver = resolve;

    // Update Local Badges
    const lNotes = document.getElementById('sync-conflict-local-notes-badge');
    const lTodos = document.getElementById('sync-conflict-local-todos-badge');
    const lPlanner = document.getElementById('sync-conflict-local-planner-badge');
    if (lNotes) lNotes.textContent = `${conflictInfo.local.noteCount} ${typeof t === 'function' ? t('sync.conflictBadgeNotes') : 'Notes'}`;
    if (lTodos) lTodos.textContent = `${conflictInfo.local.todoCount} ${typeof t === 'function' ? t('sync.conflictBadgeTodos') : 'Todos'}`;
    if (lPlanner) lPlanner.textContent = `${conflictInfo.local.plannerCount} ${typeof t === 'function' ? t('sync.conflictBadgeEvents') : 'Events'}`;

    // Update Remote Badges
    const rNotes = document.getElementById('sync-conflict-remote-notes-badge');
    const rTodos = document.getElementById('sync-conflict-remote-todos-badge');
    const rPlanner = document.getElementById('sync-conflict-remote-planner-badge');
    if (rNotes) rNotes.textContent = `${conflictInfo.remote.noteCount} ${typeof t === 'function' ? t('sync.conflictBadgeNotes') : 'Notes'}`;
    if (rTodos) rTodos.textContent = `${conflictInfo.remote.todoCount} ${typeof t === 'function' ? t('sync.conflictBadgeTodos') : 'Todos'}`;
    if (rPlanner) rPlanner.textContent = `${conflictInfo.remote.plannerCount} ${typeof t === 'function' ? t('sync.conflictBadgeEvents') : 'Events'}`;

    // Update Summary text
    const sumText = document.getElementById('sync-conflict-summary-text');
    if (sumText) {
      const shared = conflictInfo.sharedNotesCount || 0;
      const onlyLoc = conflictInfo.onlyLocalNotesCount || 0;
      const onlyRem = conflictInfo.onlyRemoteNotesCount || 0;
      const diff = conflictInfo.differingNotesCount || 0;
      sumText.textContent = `${shared} ${typeof t === 'function' ? t('sync.conflictSummaryShared') : 'Shared Notes'} (${diff} ${typeof t === 'function' ? t('sync.conflictSummaryDiffering') : 'modified in both'}) • ${onlyLoc} ${typeof t === 'function' ? t('sync.conflictSummaryOnlyLocal') : 'Local only'} • ${onlyRem} ${typeof t === 'function' ? t('sync.conflictSummaryOnlyRemote') : 'Cloud only'}`;
    }

    selectConflictStrategyUI('merge');
    if (typeof openModal === 'function') openModal('modal-sync-conflict-resolution');
  });
}
window.showSyncConflictModalUI = showSyncConflictModalUI;

function applySyncConflictResolutionUI() {
  const selectedRadio = document.querySelector('input[name="sync-conflict-strategy"]:checked');
  let chosenStrategy = selectedRadio ? selectedRadio.value : 'merge';
  if (chosenStrategy === 'merge') {
    const priorityRadio = document.querySelector('input[name="sync-conflict-priority"]:checked');
    const priority = priorityRadio ? priorityRadio.value : 'local';
    chosenStrategy = priority === 'remote' ? 'merge_remote_priority' : 'merge_local_priority';
  }
  if (typeof closeModal === 'function') closeModal('modal-sync-conflict-resolution');
  if (_syncConflictResolver) {
    _syncConflictResolver({ cancelled: false, strategy: chosenStrategy });
    _syncConflictResolver = null;
  }
}
window.applySyncConflictResolutionUI = applySyncConflictResolutionUI;

function cancelSyncConflictModalUI() {
  if (typeof closeModal === 'function') closeModal('modal-sync-conflict-resolution');
  if (_syncConflictResolver) {
    _syncConflictResolver({ cancelled: true });
    _syncConflictResolver = null;
  }
}
window.cancelSyncConflictModalUI = cancelSyncConflictModalUI;

if (typeof window !== 'undefined') {
  window.showToast = window.showToast || function(msg, isError = false) {
    if (typeof toast === 'function') {
      toast(msg, isError);
    } else if (typeof window.toast === 'function') {
      window.toast(msg, isError);
    } else {
      console.warn('[Toast]', msg);
    }
  };
}

let _isSubmittingCloudSync = false;

async function finalizeCloudSyncSessionUI({
  pass = '',
  rememberPass = false,
  toastMessage = '',
  closeModalId = 'modal-cloud-sync-setup',
  notificationMsg = ''
} = {}) {
  if (rememberPass && pass && typeof rememberPassphraseAfterSetup === 'function') {
    try {
      await rememberPassphraseAfterSetup(pass);
    } catch (e) {
      console.warn('[CloudSync] Failed to remember passphrase:', e);
    }
  }

  if (closeModalId && typeof closeModal === 'function') {
    closeModal(closeModalId);
  }

  const sc = document.getElementById('screen-connect');
  if (sc && sc.style.display !== 'none' && (typeof rootHandle === 'undefined' || !rootHandle)) {
    try {
      if (typeof mountFolder === 'function') {
        await mountFolder({ name: 'Firebase Cloud Vault' });
      }
    } catch (mountErr) {
      console.error('[CloudSync] mountFolder error during finalize:', mountErr);
    }
  }

  if (typeof updateCloudSyncUI === 'function') updateCloudSyncUI();
  if (typeof renderBoard === 'function') renderBoard();

  if (toastMessage) {
    if (typeof showToast === 'function') {
      showToast(toastMessage);
    } else if (typeof toast === 'function') {
      toast(toastMessage);
    }
  }

  if (notificationMsg && window.AppBridge?.notifications?.showNotification) {
    try {
      const appTitle = (typeof t === 'function' ? t('app.name') : '') || 'Secretary';
      window.AppBridge.notifications.showNotification(appTitle, { body: notificationMsg });
    } catch (e) {}
  }
}
window.finalizeCloudSyncSessionUI = finalizeCloudSyncSessionUI;

async function submitCloudSyncSetup() {
  if (_isSubmittingCloudSync) return;
  _isSubmittingCloudSync = true;

  const notify = (msg, isError = false) => {
    if (typeof showToast === 'function') {
      showToast(msg, isError);
    } else if (typeof toast === 'function') {
      toast(msg, isError);
    } else {
      console.warn('[Toast]', msg);
    }
  };

  const submitBtn = document.getElementById('btn-submit-cloud-sync');
  setElementLoadingState(submitBtn, true);

  const mode = submitBtn?.getAttribute('data-mode') || 'signin';
  const emailInput = document.getElementById('sync-setup-email');
  const authPassInput = document.getElementById('sync-setup-auth-password');
  const passInput = document.getElementById('sync-setup-passphrase');
  const syncCodeInput = document.getElementById('sync-setup-sync-code');
  const dontShow = document.getElementById('sync-setup-dont-show-again')?.checked;
  const rememberPass = document.getElementById('sync-setup-remember-pass')?.checked;

  try {
    // Auto-apply custom Firebase configuration if user pasted JSON into the custom config area
    const customJsonEl = document.getElementById('sync-custom-firebase-json');
    if (customJsonEl && customJsonEl.value.trim()) {
      const parsed = window.FirebaseSyncService?.parseFirebaseConfigString?.(customJsonEl.value);
      if (parsed && parsed.apiKey) {
        window.FirebaseSyncService.setCustomFirebaseConfig(parsed);
        if (typeof updateCustomFirebaseStatusUI === 'function') updateCustomFirebaseStatusUI();
      }
    }

    const email = emailInput?.value?.trim() || '';
    const authPass = authPassInput?.value?.trim() || '';
    const rawPass = passInput?.value || '';
    const pass = window.CryptoEngine?.cleanPassphrase ? window.CryptoEngine.cleanPassphrase(rawPass) : rawPass.trim();
    const syncCode = syncCodeInput?.value?.trim() || '';

    if (dontShow && typeof settings !== 'undefined') {
      settings.disableCloudSyncPrompt = true;
    }

    // Form Validations
    if (mode === 'signin' || mode === 'signup') {
      if (!email || !email.includes('@')) {
        notify(typeof t === 'function' ? t('sync.emailRequired') : 'Please enter a valid email address', true);
        return;
      }
      if (!authPass || authPass.length < 6) {
        notify(typeof t === 'function' ? t('sync.accountPasswordTooShort') : 'Account password must be at least 6 characters', true);
        return;
      }
    }

    if (!pass || pass.length < 10) {
      notify(typeof t === 'function' ? t('sync.passphraseTooShort') : 'Master passphrase must be at least 10 characters long', true);
      return;
    }

    if (mode === 'link' && !syncCode) {
      notify(typeof t === 'function' ? t('sync.syncCodeRequired') : 'Please enter a valid Sync Code', true);
      return;
    }

    if (mode === 'signin') {
      const progressDialog = typeof showMigrationProgressDialog === 'function' ? showMigrationProgressDialog(
        typeof t === 'function' ? t('sync.signInProgressTitle') : 'Sign In & Vault Synchronization',
        typeof t === 'function' ? t('sync.signInProgressAuthenticating') : 'Authenticating cloud account…'
      ) : null;

      try {
        if (progressDialog) progressDialog.update(typeof t === 'function' ? t('sync.signInProgressAuthenticating') : 'Authenticating cloud account…', 20);

        // 1. Authenticate with Firebase Email & Password
        if (window.FirebaseSyncService?.signInWithEmail) {
          try {
            await window.FirebaseSyncService.signInWithEmail(email, authPass);
          } catch (authErr) {
            const errMsg = String(authErr?.message || authErr?.code || authErr || '');
            if ((errMsg.includes('user-not-found') || errMsg.includes('auth/invalid-credential')) && window.FirebaseSyncService?.signUpWithEmail) {
              try {
                await window.FirebaseSyncService.signUpWithEmail(email, authPass);
              } catch {
                throw authErr;
              }
            } else {
              throw authErr;
            }
          }
        }

        if (progressDialog) {
          progressDialog.update(typeof t === 'function' ? t('sync.signInProgressDecrypting') : 'Decrypting encrypted vault…', 50);
        }

        // 2. Unlock or initialize vault with Master Passphrase
        let unlockSuccess = false;
        try {
          unlockSuccess = await window.FirebaseSyncService.unlockVault(pass);
          if (!unlockSuccess) {
            throw new Error(typeof t === 'function' ? t('sync.incorrectPassphrase') : 'Incorrect master passphrase');
          }
        } catch (uErr) {
          if (uErr?.message === 'No vault metadata found') {
            await window.FirebaseSyncService.setupVault(pass);
          } else {
            throw uErr;
          }
        }

        if (progressDialog) {
          progressDialog.update(typeof t === 'function' ? t('sync.linkingFinalizing') : 'Finalizing synchronization…', 95);
        }

        // 3. Detect if there is a conflict between local files and existing cloud vault
        if (window.StorageAPI?.detectSyncConflict) {
          try {
            const conflict = await window.StorageAPI.detectSyncConflict();
            if (conflict && conflict.hasConflict) {
              if (progressDialog) progressDialog.close();
              if (typeof closeModal === 'function') closeModal('modal-cloud-sync-setup');
              const resolution = await showSyncConflictModalUI(conflict);
              if (!resolution || resolution.cancelled) {
                return;
              }

              const reconProgressDialog = showMigrationProgressDialog(
                typeof t === 'function' ? t('sync.reconcileProgressTitle') : 'Synchronizing Vault…',
                typeof t === 'function' ? t('sync.migrationProgressCollecting') : 'Collecting notes and documents…'
              );

              try {
                await window.StorageAPI.reconcileLocalAndCloudVault(pass, resolution.strategy, {}, (prog) => {
                  reconProgressDialog.update(prog.message, prog.percent);
                });
                reconProgressDialog.update(typeof t === 'function' ? t('sync.reconcileSuccessToast') : 'Reconciliation complete! Encrypted vault synchronized.', 100);
                await new Promise(r => setTimeout(r, 180));
              } finally {
                reconProgressDialog.close();
              }

              await finalizeCloudSyncSessionUI({
                pass,
                rememberPass,
                toastMessage: typeof t === 'function' ? t('sync.reconcileSuccessToast') : 'Reconciliation complete! Encrypted vault synchronized.',
                closeModalId: null
              });
              return;
            }
          } catch (cErr) {
            console.warn('[CloudSync] detectSyncConflict error:', cErr);
          }
        }

        if (typeof settings !== 'undefined' && settings) {
          settings.storageEngine = 'firebase';
          if (typeof saveFolderSettingsDebounced === 'function') saveFolderSettingsDebounced();
        }

        if (progressDialog) {
          progressDialog.update(typeof t === 'function' ? t('sync.signInSuccessToast') : 'Signed in successfully! Encrypted vault connected.', 100);
          await new Promise(r => setTimeout(r, 180));
          progressDialog.close();
        }

        await finalizeCloudSyncSessionUI({
          pass,
          rememberPass,
          toastMessage: typeof t === 'function' ? t('sync.signInSuccessToast') : 'Signed in successfully! Encrypted vault connected.',
          closeModalId: 'modal-cloud-sync-setup'
        });
      } finally {
        if (progressDialog) progressDialog.close();
      }
    } else if (mode === 'signup') {
      // 1. Create account with Firebase Email & Password
      if (window.FirebaseSyncService?.signUpWithEmail) {
        try {
          await window.FirebaseSyncService.signUpWithEmail(email, authPass);
        } catch (authErr) {
          const errMsg = String(authErr?.message || authErr?.code || authErr || '');
          if (errMsg.includes('email-already-in-use') && window.FirebaseSyncService?.signInWithEmail) {
            await window.FirebaseSyncService.signInWithEmail(email, authPass);
          } else {
            throw authErr;
          }
        }
      }

      // 2. Initialize vault & migrate local notes
      if (typeof settings !== 'undefined' && settings) {
        settings.storageEngine = 'firebase';
        if (typeof saveFolderSettingsDebounced === 'function') saveFolderSettingsDebounced();
      }

      if (typeof closeModal === 'function') closeModal('modal-cloud-sync-setup');
      const progressDialog = showMigrationProgressDialog(
        typeof t === 'function' ? t('sync.migrationProgressTitle') : 'Migrating to Cloud Vault…',
        typeof t === 'function' ? t('sync.migrationProgressCollecting') : 'Collecting local notes and documents…'
      );

      try {
        if (window.StorageAPI) {
          await window.StorageAPI.migrateToFirebase(pass, { syncCode: syncCode || null }, (prog) => {
            progressDialog.update(prog.message, prog.percent);
          });
        }
        progressDialog.update(typeof t === 'function' ? t('sync.signUpSuccessToast') : 'Account created successfully! Vault initialized.', 100);
        await new Promise(r => setTimeout(r, 180));
      } finally {
        progressDialog.close();
      }

      await finalizeCloudSyncSessionUI({
        pass,
        rememberPass,
        toastMessage: typeof t === 'function' ? t('sync.signUpSuccessToast') : 'Account created successfully! Vault initialized.',
        closeModalId: null
      });
    } else if (mode === 'link') {
      const progressDialog = typeof showMigrationProgressDialog === 'function' ? showMigrationProgressDialog(
        typeof t === 'function' ? t('sync.linkingProgressTitle') : 'Linking Cloud Vault',
        typeof t === 'function' ? t('sync.linkingConnecting') : 'Connecting to cloud vault…'
      ) : null;

      try {
        await window.FirebaseSyncService.linkExistingVault(syncCode, pass, {}, (msg, pct) => {
          if (progressDialog) progressDialog.update(msg, pct);
        });
        if (progressDialog) {
          progressDialog.update(typeof t === 'function' ? t('sync.linkSuccess') : 'Device linked successfully! Encrypted notes synchronized.', 100);
          await new Promise(r => setTimeout(r, 180));
          progressDialog.close();
        }
        await finalizeCloudSyncSessionUI({
          pass,
          rememberPass,
          toastMessage: typeof t === 'function' ? t('sync.linkSuccess') : 'Device linked successfully! Encrypted notes synchronized.',
          closeModalId: 'modal-cloud-sync-setup'
        });
      } finally {
        if (progressDialog) progressDialog.close();
      }
    } else {
      // guest or legacy new mode
      if (typeof settings !== 'undefined' && settings) {
        settings.storageEngine = 'firebase';
        if (typeof saveFolderSettingsDebounced === 'function') saveFolderSettingsDebounced();
      }

      if (typeof closeModal === 'function') closeModal('modal-cloud-sync-setup');
      const progressDialog = showMigrationProgressDialog(
        typeof t === 'function' ? t('sync.migrationProgressTitle') : 'Migrating to Cloud Vault…',
        typeof t === 'function' ? t('sync.migrationProgressCollecting') : 'Collecting local notes and documents…'
      );

      try {
        if (window.StorageAPI) {
          await window.StorageAPI.migrateToFirebase(pass, { syncCode: syncCode || null }, (prog) => {
            progressDialog.update(prog.message, prog.percent);
          });
        }
        progressDialog.update(typeof t === 'function' ? t('sync.migrationProgressFinalizing') : 'Migration complete!', 100);
        await new Promise(r => setTimeout(r, 180));
      } finally {
        progressDialog.close();
      }

      const successMsg = typeof t === 'function'
        ? t('sync.migrationSuccessDetailed')
        : "Migration complete! All data is encrypted in the cloud. Local files moved to '_migrated_to_cloud_backup' (safe to delete).";

      await finalizeCloudSyncSessionUI({
        pass,
        rememberPass,
        toastMessage: successMsg,
        closeModalId: null,
        notificationMsg: successMsg
      });
    }
  } catch (err) {
    console.error('[CloudSync] Setup failed:', err);
    notify((typeof t === 'function' ? t('sync.setupFailed') : 'Setup failed') + ': ' + (err?.message || err || ''), true);
  } finally {
    _isSubmittingCloudSync = false;
    setElementLoadingState(submitBtn, false);
  }
}
window.submitCloudSyncSetup = submitCloudSyncSetup;

async function submitCloudSyncGoogle() {
  const passInput = document.getElementById('sync-setup-passphrase');
  const rememberPass = document.getElementById('sync-setup-remember-pass')?.checked;
  let rawPass = passInput?.value || '';
  let pass = window.CryptoEngine?.cleanPassphrase ? window.CryptoEngine.cleanPassphrase(rawPass) : rawPass.trim();

  if (!pass || pass.length < 10) {
    if (window.FirebaseSyncService?.generateDefaultPassphrase) {
      pass = window.FirebaseSyncService.generateDefaultPassphrase();
      if (passInput) passInput.value = pass;
    }
  }

  try {
    if (window.FirebaseSyncService?.signInWithGoogle) {
      await window.FirebaseSyncService.signInWithGoogle();
    }

    if (typeof settings !== 'undefined' && settings) {
      settings.storageEngine = 'firebase';
      if (typeof saveFolderSettingsDebounced === 'function') saveFolderSettingsDebounced();
    }

    if (typeof closeModal === 'function') closeModal('modal-cloud-sync-setup');

    const progressDialog = typeof showMigrationProgressDialog === 'function' ? showMigrationProgressDialog(
      typeof t === 'function' ? t('sync.migrationProgressTitle') : 'Migrating to Cloud Vault…',
      typeof t === 'function' ? t('sync.migrationProgressCollecting') : 'Collecting local notes and documents…'
    ) : null;

    try {
      if (window.StorageAPI?.migrateToFirebase) {
        await window.StorageAPI.migrateToFirebase(pass, null, (prog) => {
          if (progressDialog) progressDialog.update(prog.message, prog.percent);
        });
      } else if (window.FirebaseSyncService?.unlockVault) {
        await window.FirebaseSyncService.unlockVault(pass, !!rememberPass);
      }
      if (progressDialog) {
        progressDialog.update(typeof t === 'function' ? t('sync.signInSuccessToast') : 'Signed in successfully! Encrypted vault connected.', 100);
        await new Promise(r => setTimeout(r, 180));
      }
    } finally {
      if (progressDialog) progressDialog.close();
    }

    await finalizeCloudSyncSessionUI({
      pass,
      rememberPass,
      toastMessage: typeof t === 'function' ? t('sync.googleSignInSuccessToast') : 'Successfully signed in with Google!',
      closeModalId: null
    });
  } catch (err) {
    console.error('Google Sign-In failed:', err);
    if (typeof showToast === 'function') {
      showToast((typeof t === 'function' ? t('sync.setupFailed') : 'Setup failed') + ': ' + (err.message || ''), true);
    }
  }
}
window.submitCloudSyncGoogle = submitCloudSyncGoogle;

async function submitCloudSyncMagicLink() {
  const emailInput = document.getElementById('sync-setup-email');
  const email = emailInput?.value?.trim() || '';

  if (!email || !email.includes('@')) {
    if (typeof showToast === 'function') {
      showToast(typeof t === 'function' ? t('sync.emailRequired') : 'Please enter a valid email address', true);
    }
    if (emailInput) emailInput.focus();
    return;
  }

  const passInput = document.getElementById('sync-setup-passphrase');
  if (passInput?.value && typeof localStorage !== 'undefined') {
    try { localStorage.setItem('secretary_magic_link_pending_pass', passInput.value); } catch (e) {}
  }

  try {
    if (window.FirebaseSyncService?.sendSignInLink) {
      await window.FirebaseSyncService.sendSignInLink(email);
      if (typeof showToast === 'function') {
        showToast(typeof t === 'function' ? t('sync.magicLinkSentToast') : 'Sign-in link sent! Please check your email inbox.', false);
      }
    }
  } catch (err) {
    console.error('Send magic link failed:', err);
    if (typeof showToast === 'function') {
      showToast((typeof t === 'function' ? t('sync.setupFailed') : 'Setup failed') + ': ' + (err.message || ''), true);
    }
  }
}
window.submitCloudSyncMagicLink = submitCloudSyncMagicLink;

async function checkPendingEmailLinkAuth() {
  if (typeof window === 'undefined' || !window.location) return;
  if (window.FirebaseSyncService?.isSignInWithEmailLink?.(window.location.href)) {
    try {
      let email = typeof localStorage !== 'undefined' ? localStorage.getItem('secretary_email_link_email') : null;
      if (!email) {
        email = window.prompt(typeof t === 'function' ? t('sync.emailPromptForMagicLink') : 'Please enter your email to confirm sign-in:');
      }
      if (email) {
        await window.FirebaseSyncService.signInWithEmailLink(email, window.location.href);
        const pendingPass = typeof localStorage !== 'undefined' ? localStorage.getItem('secretary_magic_link_pending_pass') : null;
        if (pendingPass) {
          if (typeof rememberPassphraseAfterSetup === 'function') await rememberPassphraseAfterSetup(pendingPass);
          if (window.FirebaseSyncService?.unlockVault) await window.FirebaseSyncService.unlockVault(pendingPass, true);
          try { localStorage.removeItem('secretary_magic_link_pending_pass'); } catch (e) {}
        }
        if (window.history?.replaceState) {
          window.history.replaceState({}, document.title, window.location.pathname);
        }
        if (typeof showToast === 'function') {
          showToast(typeof t === 'function' ? t('sync.magicLinkSuccessToast') : 'Successfully signed in with email link!', false);
        }
        if (typeof updateCloudSyncUI === 'function') updateCloudSyncUI();
        const sc = document.getElementById('screen-connect');
        if (sc && sc.style.display !== 'none' && (typeof rootHandle === 'undefined' || !rootHandle)) {
          if (typeof mountFolder === 'function') await mountFolder({ name: 'Firebase Cloud Vault' });
        }
      }
    } catch (err) {
      console.warn('Failed to complete email link sign-in:', err);
      if (typeof showToast === 'function') {
        showToast((typeof t === 'function' ? t('sync.setupFailed') : 'Sign-in failed') + ': ' + (err.message || ''), true);
      }
    }
  }
}
window.checkPendingEmailLinkAuth = checkPendingEmailLinkAuth;

async function signOutCloudAccountUI() {
  try {
    if (window.FirebaseSyncService) {
      await window.FirebaseSyncService.signOut();
      updateCloudSyncUI();
      if (typeof showToast === 'function') {
        showToast(typeof t === 'function' ? t('sync.signOutSuccessToast') : 'Signed out from cloud account');
      }
    }
  } catch (err) {
    if (typeof showToast === 'function') {
      showToast((typeof t === 'function' ? t('sync.setupFailed') : 'Sign out failed') + ': ' + (err.message || ''), true);
    }
  }
}
window.signOutCloudAccountUI = signOutCloudAccountUI;

async function linkCloudSyncGoogleUI() {
  try {
    if (!window.FirebaseSyncService) return;
    await window.FirebaseSyncService.linkGoogle();
    if (typeof showToast === 'function') {
      showToast(typeof t === 'function' ? t('sync.googleLinkedSuccess') : 'Google account linked successfully!');
    }
    updateCloudSyncUI();
  } catch (err) {
    console.error('Failed to link Google account:', err);
    if (typeof showToast === 'function') {
      showToast((typeof t === 'function' ? t('sync.linkFailed') : 'Account linking failed') + ': ' + (err.message || ''), true);
    }
  }
}
window.linkCloudSyncGoogleUI = linkCloudSyncGoogleUI;

function openLinkEmailModalUI() {
  const emailInput = document.getElementById('link-email-input');
  const passInput = document.getElementById('link-password-input');
  const authUser = window.FirebaseSyncService ? window.FirebaseSyncService.getAuthUser() : null;
  if (emailInput) {
    emailInput.value = authUser?.email || '';
  }
  if (passInput) {
    passInput.value = '';
  }
  if (typeof openModal === 'function') {
    openModal('modal-cloud-link-email');
  }
}
window.openLinkEmailModalUI = openLinkEmailModalUI;

let _isSubmittingLinkEmail = false;

async function submitLinkEmailUI() {
  if (_isSubmittingLinkEmail) return;
  _isSubmittingLinkEmail = true;

  const emailInput = document.getElementById('link-email-input');
  const passInput = document.getElementById('link-password-input');
  const email = emailInput?.value?.trim();
  const password = passInput?.value;

  try {
    if (!email || !email.includes('@')) {
      if (typeof showToast === 'function') {
        showToast(typeof t === 'function' ? t('sync.emailRequired') : 'Please enter a valid email address', true);
      }
      return;
    }
    if (!password || password.length < 6) {
      if (typeof showToast === 'function') {
        showToast(typeof t === 'function' ? t('sync.accountPasswordTooShort') : 'Password must be at least 6 characters', true);
      }
      return;
    }

    if (!window.FirebaseSyncService) return;
    await window.FirebaseSyncService.linkEmail(email, password);
    if (typeof closeModal === 'function') {
      closeModal('modal-cloud-link-email');
    }
    if (typeof showToast === 'function') {
      showToast(typeof t === 'function' ? t('sync.emailLinkedSuccess') : 'Email and password linked successfully!');
    }
    updateCloudSyncUI();
  } catch (err) {
    console.error('Failed to link email/password:', err);
    if (typeof showToast === 'function') {
      showToast((typeof t === 'function' ? t('sync.linkFailed') : 'Account linking failed') + ': ' + (err.message || ''), true);
    }
  } finally {
    _isSubmittingLinkEmail = false;
  }
}
window.submitLinkEmailUI = submitLinkEmailUI;

async function sendMagicLinkForCurrentAccountUI() {
  const user = window.FirebaseSyncService ? window.FirebaseSyncService.getAuthUser() : null;
  if (!user || !user.email) {
    if (typeof showToast === 'function') {
      showToast(typeof t === 'function' ? t('sync.emailRequired') : 'No email address associated with account', true);
    }
    return;
  }
  try {
    await window.FirebaseSyncService.sendSignInLink(user.email);
    if (typeof showToast === 'function') {
      showToast(typeof t === 'function' ? t('sync.magicLinkSentToast') : 'Sign-in link sent to your email inbox!');
    }
  } catch (err) {
    console.error('Failed to send magic link:', err);
    if (typeof showToast === 'function') {
      showToast((typeof t === 'function' ? t('sync.setupFailed') : 'Failed') + ': ' + (err.message || ''), true);
    }
  }
}
window.sendMagicLinkForCurrentAccountUI = sendMagicLinkForCurrentAccountUI;

async function unlinkAuthProviderUI(providerId) {
  try {
    if (!window.FirebaseSyncService) return;
    await window.FirebaseSyncService.unlinkProvider(providerId);
    updateCloudSyncUI();
  } catch (err) {
    console.error('Failed to unlink provider:', err);
    if (typeof showToast === 'function') {
      showToast((typeof t === 'function' ? t('sync.linkFailed') : 'Failed to unlink') + ': ' + (err.message || ''), true);
    }
  }
}
window.unlinkAuthProviderUI = unlinkAuthProviderUI;

function openPasswordResetModalUI(email = '') {
  const emailInput = document.getElementById('sync-reset-password-email');
  const msgEl = document.getElementById('sync-reset-password-msg');
  if (msgEl) {
    msgEl.style.display = 'none';
    msgEl.textContent = '';
  }
  if (emailInput) {
    emailInput.value = email || '';
  }
  if (typeof openModal === 'function') {
    openModal('modal-cloud-password-reset');
  }
}
window.openPasswordResetModalUI = openPasswordResetModalUI;

function openPasswordResetFromSetupUI() {
  const setupEmail = document.getElementById('sync-setup-email')?.value || '';
  openPasswordResetModalUI(setupEmail);
}
window.openPasswordResetFromSetupUI = openPasswordResetFromSetupUI;

let _isSubmittingPasswordReset = false;

async function submitPasswordResetUI() {
  if (_isSubmittingPasswordReset) return;
  _isSubmittingPasswordReset = true;

  const email = document.getElementById('sync-reset-password-email')?.value?.trim();
  const msgEl = document.getElementById('sync-reset-password-msg');

  try {
    if (!email || !email.includes('@')) {
      if (msgEl) {
        msgEl.textContent = typeof t === 'function' ? t('sync.emailRequired') : 'Please enter a valid email address';
        msgEl.style.background = 'rgba(239,68,68,0.12)';
        msgEl.style.color = '#ef4444';
        msgEl.style.display = 'block';
      }
      return;
    }

    if (window.FirebaseSyncService) {
      await window.FirebaseSyncService.sendPasswordReset(email);
      if (msgEl) {
        msgEl.textContent = typeof t === 'function' ? t('sync.resetEmailSentToast') : 'Password reset email sent! Check your inbox.';
        msgEl.style.background = 'rgba(16,185,129,0.12)';
        msgEl.style.color = '#10b981';
        msgEl.style.display = 'block';
      }
      if (typeof showToast === 'function') {
        showToast(typeof t === 'function' ? t('sync.resetEmailSentToast') : 'Password reset email sent! Check your inbox.');
      }
      setTimeout(() => {
        if (typeof closeModal === 'function') closeModal('modal-cloud-password-reset');
      }, 2000);
    }
  } catch (err) {
    if (msgEl) {
      msgEl.textContent = (typeof t === 'function' ? t('sync.resetEmailFailedToast') : 'Failed to send reset email') + ': ' + (err.message || '');
      msgEl.style.background = 'rgba(239,68,68,0.12)';
      msgEl.style.color = '#ef4444';
      msgEl.style.display = 'block';
    }
  } finally {
    _isSubmittingPasswordReset = false;
  }
}
window.submitPasswordResetUI = submitPasswordResetUI;

function toggleCustomFirebaseSetupUI() {
  const body = document.getElementById('sync-custom-firebase-body');
  if (!body) return;
  const isHidden = body.style.display === 'none' || !body.style.display;
  body.style.display = isHidden ? 'block' : 'none';
  if (isHidden) {
    updateCustomFirebaseStatusUI();
  }
}
window.toggleCustomFirebaseSetupUI = toggleCustomFirebaseSetupUI;

function updateCustomFirebaseStatusUI() {
  const pill = document.getElementById('sync-custom-firebase-status-pill');
  const textarea = document.getElementById('sync-custom-firebase-json');
  const customCfg = window.FirebaseSyncService?.getCustomFirebaseConfig?.();

  if (customCfg) {
    if (pill) {
      pill.textContent = customCfg.projectId ? `Custom (${customCfg.projectId})` : (typeof t === 'function' ? t('sync.customFirebaseActive') : 'Custom Project');
      pill.style.background = 'rgba(16, 185, 129, 0.15)';
      pill.style.color = '#10b981';
    }
    if (textarea && !textarea.value) {
      textarea.value = JSON.stringify(customCfg, null, 2);
    }
  } else {
    if (pill) {
      pill.textContent = typeof t === 'function' ? t('sync.customFirebaseStatusDefault') : "Etienne's Firebase Project";
      pill.style.background = 'rgba(59, 130, 246, 0.12)';
      pill.style.color = '#3b82f6';
    }
  }
}
window.updateCustomFirebaseStatusUI = updateCustomFirebaseStatusUI;

function saveCustomFirebaseConfigUI() {
  const textarea = document.getElementById('sync-custom-firebase-json');
  if (!textarea || !textarea.value.trim()) {
    if (typeof showToast === 'function') {
      showToast(typeof t === 'function' ? t('sync.customFirebaseEmpty') : 'Please paste your Firebase configuration JSON', true);
    }
    return;
  }

  const parsed = window.FirebaseSyncService?.parseFirebaseConfigString?.(textarea.value);
  if (!parsed || !parsed.apiKey) {
    if (typeof showToast === 'function') {
      showToast(typeof t === 'function' ? t('sync.customFirebaseInvalid') : 'Invalid Firebase configuration. Must include apiKey and projectId.', true);
    }
    return;
  }

  const success = window.FirebaseSyncService.setCustomFirebaseConfig(parsed);
  if (success) {
    updateCustomFirebaseStatusUI();
    if (typeof showToast === 'function') {
      showToast(typeof t === 'function' ? t('sync.customFirebaseSaved') : 'Custom Firebase configuration applied successfully!');
    }
  }
}
window.saveCustomFirebaseConfigUI = saveCustomFirebaseConfigUI;

function resetCustomFirebaseConfigUI() {
  window.FirebaseSyncService?.clearCustomFirebaseConfig?.();
  const textarea = document.getElementById('sync-custom-firebase-json');
  if (textarea) textarea.value = '';
  updateCustomFirebaseStatusUI();
  if (typeof showToast === 'function') {
    showToast(typeof t === 'function' ? t('sync.customFirebaseReset') : "Reverted to Etienne's Firebase project.");
  }
}
window.resetCustomFirebaseConfigUI = resetCustomFirebaseConfigUI;

async function submitCloudSyncUnlock(forceSave = false) {
  const rawPass = document.getElementById('sync-unlock-passphrase')?.value || '';
  const pass = window.CryptoEngine?.cleanPassphrase ? window.CryptoEngine.cleanPassphrase(rawPass) : rawPass.trim();
  const errEl = document.getElementById('sync-unlock-error');
  const rememberCb = document.getElementById('sync-unlock-remember-pass');
  const shouldSave = forceSave || (rememberCb ? rememberCb.checked : false);

  if (!pass) return;

  const success = await window.FirebaseSyncService.unlockVault(pass);
  if (success) {
    if (shouldSave) {
      if (rememberCb) rememberCb.checked = true;
      const saved = await window.FirebaseSyncService.savePassphraseLocally(pass);
      if (!saved && typeof showToast === 'function') {
        showToast(typeof t === 'function' ? t('sync.passphraseStorageUnavailable') : 'Secure passphrase storage is not available on this device', true);
      }
    } else if (rememberCb && !rememberCb.checked) {
      const cleared = await window.FirebaseSyncService.clearSavedPassphrase();
      if (!cleared && typeof showToast === 'function') {
        showToast(typeof t === 'function' ? t('sync.passphraseClearFailed') : 'Could not remove the saved passphrase', true);
      }
    }

    if (errEl) errEl.style.display = 'none';
    if (typeof closeModal === 'function') closeModal('modal-cloud-sync-unlock');
    updateCloudSyncUI();
    if (typeof renderBoard === 'function') renderBoard();
    if (typeof showToast === 'function') showToast(typeof t === 'function' ? t('sync.unlockedToast') : 'Vault unlocked');
  } else {
    if (errEl) {
      errEl.textContent = typeof t === 'function' ? t('sync.incorrectPassphrase') : 'Incorrect passphrase';
      errEl.style.display = 'block';
    }
  }
}
window.submitCloudSyncUnlock = submitCloudSyncUnlock;

async function toggleRememberPassphraseUI(checked) {
  const svc = window.FirebaseSyncService;
  const cb = document.getElementById('prefs-sync-remember-pass');
  const toast = (key, fallback, isError) => {
    if (typeof showToast === 'function') showToast(typeof t === 'function' ? t(key) : fallback, !!isError);
  };
  if (!svc) return;

  if (!checked) {
    const cleared = await svc.clearSavedPassphrase();
    if (cleared) {
      toast('sync.passphraseForgotten', 'Saved passphrase removed from this device');
    } else {
      // Deletion failed: do not claim success; reflect that a copy may remain.
      if (cb) cb.checked = true;
      toast('sync.passphraseClearFailed', 'Could not remove the saved passphrase', true);
    }
    return;
  }

  if (!(await svc.isPassphraseStorageAvailable())) {
    if (cb) cb.checked = false;
    toast('sync.passphraseStorageUnavailable', 'Secure passphrase storage is not available on this device', true);
    return;
  }
  // The passphrase is not kept in memory: ask for it again, and persist only after a successful unlock.
  if (cb) cb.checked = false;
  const remCb = document.getElementById('sync-unlock-remember-pass');
  if (typeof openModal === 'function') openModal('modal-cloud-sync-unlock');
  if (remCb) remCb.checked = true;
}
window.toggleRememberPassphraseUI = toggleRememberPassphraseUI;

async function refreshRememberPassphraseControl() {
  const rememberRow = document.getElementById('prefs-sync-remember-row');
  const rememberCb = document.getElementById('prefs-sync-remember-pass');
  const svc = window.FirebaseSyncService;
  if (!rememberRow || !rememberCb) return;
  const engine = svc && svc.state ? svc.state.engine : null;
  if (engine !== 'firebase' || !svc || typeof svc.isPassphraseStorageAvailable !== 'function') {
    rememberRow.style.display = 'none';
    return;
  }
  try {
    const available = await svc.isPassphraseStorageAvailable();
    rememberRow.style.display = available ? 'flex' : 'none';
    if (available) rememberCb.checked = !!(await svc.hasSavedPassphrase());
  } catch (e) {
    console.warn('Failed to refresh remember-passphrase control', e);
    rememberRow.style.display = 'none';
  }
}
window.refreshRememberPassphraseControl = refreshRememberPassphraseControl;

async function submitCloudSyncPasswordRotate() {
  const rawOldPass = document.getElementById('sync-rotate-current-pass')?.value || '';
  const rawNewPass = document.getElementById('sync-rotate-new-pass')?.value || '';
  const rawConfirmPass = document.getElementById('sync-rotate-confirm-pass')?.value || '';
  const clean = (s) => (window.CryptoEngine?.cleanPassphrase ? window.CryptoEngine.cleanPassphrase(s) : (typeof s === 'string' ? s.trim() : ''));
  const oldPass = clean(rawOldPass);
  const newPass = clean(rawNewPass);
  const confirmPass = clean(rawConfirmPass);
  const errEl = document.getElementById('sync-rotate-error');

  if (!oldPass || !newPass) {
    if (errEl) {
      errEl.textContent = typeof t === 'function' ? t('sync.fillAllFields') : 'Please fill in all fields';
      errEl.style.display = 'block';
    }
    return;
  }
  if (newPass.length < 10) {
    if (errEl) {
      errEl.textContent = typeof t === 'function' ? t('sync.passphraseTooShort') : 'New passphrase must be at least 10 characters';
      errEl.style.display = 'block';
    }
    return;
  }
  if (newPass !== confirmPass) {
    if (errEl) {
      errEl.textContent = typeof t === 'function' ? t('sync.passwordsDoNotMatch') : 'New passphrases do not match';
      errEl.style.display = 'block';
    }
    return;
  }

  try {
    await window.FirebaseSyncService.rotatePassphrase(oldPass, newPass);
    if (errEl) errEl.style.display = 'none';
    if (typeof closeModal === 'function') closeModal('modal-cloud-sync-password-rotate');
    updateCloudSyncUI();
    if (typeof showToast === 'function') showToast(typeof t === 'function' ? t('sync.passwordRotatedToast') : 'Passphrase changed and vault re-encrypted!');
  } catch (err) {
    if (errEl) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    }
  }
}
window.submitCloudSyncPasswordRotate = submitCloudSyncPasswordRotate;

async function reconcileMigrationBackupUI() {
  const btn = document.getElementById('btn-prefs-reconcile-backup');
  const origText = btn ? btn.textContent : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = typeof t === 'function' ? t('sync.reconcileRunning') : 'Reconciling...';
  }
  try {
    const res = await window.StorageAPI.reconcileMigrationBackup({ force: true }, (progress) => {
      if (btn && progress && progress.message) {
        btn.textContent = progress.message;
      }
    });
    if (typeof loadManifest === 'function') await loadManifest();
    if (typeof renderBoard === 'function') renderBoard();
    updateCloudSyncUI();
    const restored = (res && (res.restoredNotesCount || res.restoredCount)) || 0;
    const merged = (res && (res.mergedNotesCount || res.mergedCount)) || 0;
    if (typeof showToast === 'function') {
      showToast(`${typeof t === 'function' ? t('sync.reconciledToast') : 'Backup reconciliation complete'}: ${restored} restored, ${merged} merged`);
    }
  } catch (e) {
    if (typeof showToast === 'function') {
      showToast((typeof t === 'function' ? t('sync.reconcileFailed') : 'Reconciliation failed') + ': ' + (e.message || ''), true);
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = typeof t === 'function' ? t('sync.reconcileBackupBtn') : (origText || 'Reconcile Backup Notes');
    }
  }
}
window.reconcileMigrationBackupUI = reconcileMigrationBackupUI;

async function revertToFilesystemUI() {
  const progressDialog = typeof showMigrationProgressDialog === 'function' ? showMigrationProgressDialog(
    typeof t === 'function' ? t('sync.revertProgressTitle') : 'Exporting to Local Folder',
    typeof t === 'function' ? t('sync.revertProgressStarting') : 'Preparing to decrypt and export notes to local folder…'
  ) : null;

  try {
    const res = await window.StorageAPI.revertToFilesystem((prog) => {
      if (progressDialog && prog) {
        progressDialog.update(prog.message || '', prog.percent || 0);
      }
    });

    if (progressDialog) {
      progressDialog.update(typeof t === 'function' ? t('sync.revertDone') : 'Local export verified and complete!', 100);
      await new Promise(r => setTimeout(r, 220));
      progressDialog.close();
    }

    if (typeof settings !== 'undefined' && settings) {
      settings.storageEngine = 'filesystem';
      if (typeof saveFolderSettingsDebounced === 'function') saveFolderSettingsDebounced();
    }
    updateCloudSyncUI();
    if (typeof renderBoard === 'function') renderBoard();

    // Show verification dialog with the option to delete remote Firebase data
    showRevertCleanupModalUI(res);
  } catch (e) {
    if (progressDialog) progressDialog.close();
    if (typeof showToast === 'function') {
      showToast((typeof t === 'function' ? t('sync.exportFailed') : 'Export failed') + ': ' + (e.message || ''), true);
    }
  }
}
window.revertToFilesystemUI = revertToFilesystemUI;

function showRevertCleanupModalUI(result = {}) {
  const notesCount = result?.notesCount || result?.writtenNotes || 0;
  const countMsgEl = document.getElementById('revert-cleanup-count-msg');
  if (countMsgEl) {
    const baseText = typeof t === 'function' ? t('sync.revertVerifiedAllNotes') : 'All notes and documents verified on local disk';
    countMsgEl.textContent = `${baseText} (${notesCount} ${typeof t === 'function' ? t('sync.notesVerified') : 'notes verified'})`;
  }
  if (typeof openModal === 'function') {
    openModal('modal-revert-cleanup');
  }
}
window.showRevertCleanupModalUI = showRevertCleanupModalUI;

async function confirmDeleteCloudDataUI() {
  const btn = document.getElementById('btn-revert-delete-cloud');
  if (btn) btn.disabled = true;

  try {
    if (window.FirebaseSyncService?.deleteRemoteVault) {
      await window.FirebaseSyncService.deleteRemoteVault();
    }
    if (typeof closeModal === 'function') closeModal('modal-revert-cleanup');
    updateCloudSyncUI();
    if (typeof showToast === 'function') {
      showToast(typeof t === 'function' ? t('sync.cloudDataDeletedToast') : 'Cloud data successfully deleted. Operating 100% locally.');
    }
  } catch (err) {
    console.error('Delete cloud data failed:', err);
    if (typeof showToast === 'function') {
      showToast((typeof t === 'function' ? t('sync.deleteCloudFailed') : 'Failed to delete cloud data') + ': ' + (err.message || ''), true);
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}
window.confirmDeleteCloudDataUI = confirmDeleteCloudDataUI;

function keepCloudBackupUI() {
  if (typeof closeModal === 'function') closeModal('modal-revert-cleanup');
  updateCloudSyncUI();
  if (typeof showToast === 'function') {
    showToast(typeof t === 'function' ? t('sync.cloudDataKeptToast') : 'Cloud backup retained. Workspace running from local folder.');
  }
}
window.keepCloudBackupUI = keepCloudBackupUI;

function saveCloudSyncPromptDismissal() {
  if (typeof settings !== 'undefined') {
    settings.disableCloudSyncPrompt = true;
    if (typeof saveFolderSettingsDebounced === 'function') saveFolderSettingsDebounced();
  }
  if (typeof closeModal === 'function') closeModal('modal-cloud-sync-setup');
}
window.saveCloudSyncPromptDismissal = saveCloudSyncPromptDismissal;

function prefsThemeChanged(val) {
  if (!settings.ui) settings.ui = {};
  settings.ui.theme = val;
  saveLocalSettings();
  applySettings();
  broadcastSync({ type: 'SETTINGS_UPDATED', settings });
  saveFolderSettingsDebounced();
}

function prefsAccentChanged(val) {
  if (!settings.ui) settings.ui = {};
  settings.ui.accent = val;
  saveLocalSettings();
  applySettings();
  broadcastSync({ type: 'SETTINGS_UPDATED', settings });
  saveFolderSettingsDebounced();
  const colorEl = document.getElementById('prefs-accent-color');
  const presetEl = document.getElementById('prefs-accent-preset');
  if (colorEl) colorEl.value = val;
  if (presetEl) presetEl.value = val;
}
function prefsUsernameChanged(val) {
  settings.username = val.trim();
  saveLocalSettings();
  saveFolderSettingsDebounced();
  if (typeof updateExternalAgentPromptDisplay === 'function') updateExternalAgentPromptDisplay();
  if (typeof rebuildCollaborativeAggregates === 'function') rebuildCollaborativeAggregates();
  if (typeof renderBoard === 'function') renderBoard();
  if (typeof renderTeamPanel === 'function' && (activeTab === 'team' || activeTab === 'decisions')) renderTeamPanel();
}

function prefsLanguageChanged(val) {
  setAppLanguage(val);
  saveFolderSettingsDebounced();
  renderBoard();
  renderPrefs();
}
window.prefsLanguageChanged = prefsLanguageChanged;

function prefsWorkingLanguageChanged(val) {
  settings.workingLanguage = val;
  saveLocalSettings();
  saveFolderSettingsDebounced();
  broadcastSync({ type: 'SETTINGS_UPDATED', settings });
  renderPrefs();
}
window.prefsWorkingLanguageChanged = prefsWorkingLanguageChanged;

const PREFS_AI_PROVIDERS = [
  {
    id: 'lmstudio',
    name: 'LM Studio',
    tag: 'Local • 100% Private',
    descKey: 'setupWizard.providerLmStudioDesc',
    linkUrl: 'https://lmstudio.ai',
    endpoint: 'http://127.0.0.1:1234/v1',
    model: 'qwen2.5-coder-7b-instruct',
    apiKey: 'lm-studio',
    icon: '🖥️'
  },
  {
    id: 'ollama',
    name: 'Ollama',
    tag: 'Local • Open Source',
    descKey: 'setupWizard.providerOllamaDesc',
    linkUrl: 'https://ollama.com',
    endpoint: 'http://127.0.0.1:11434/v1',
    model: 'llama3.1',
    apiKey: 'ollama',
    icon: '🦙'
  },
  {
    id: 'openai',
    name: 'OpenAI',
    tag: 'Cloud • GPT-4o',
    descKey: 'setupWizard.providerOpenAiDesc',
    linkUrl: 'https://platform.openai.com/api-keys',
    endpoint: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    apiKey: '',
    icon: '🟢'
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    tag: 'Cloud • Claude',
    descKey: 'setupWizard.providerAnthropicDesc',
    linkUrl: 'https://console.anthropic.com/settings/keys',
    endpoint: 'https://api.anthropic.com/v1',
    model: 'claude-3-5-sonnet-20241022',
    apiKey: '',
    icon: '🧠'
  },
  {
    id: 'google',
    name: 'Google Gemini',
    tag: 'Cloud • Gemini 2.0',
    descKey: 'setupWizard.providerGoogleDesc',
    linkUrl: 'https://aistudio.google.com/app/apikey',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    model: 'gemini-2.0-flash-exp',
    apiKey: '',
    icon: '✨'
  },
  {
    id: 'groq',
    name: 'Groq',
    tag: 'Cloud • Ultra-Fast',
    descKey: 'setupWizard.providerGroqDesc',
    linkUrl: 'https://console.groq.com/keys',
    endpoint: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    apiKey: '',
    icon: '⚡'
  },
  {
    id: 'custom',
    name: 'Custom / OpenRouter',
    tag: 'Compatible API',
    descKey: 'setupWizard.providerCustomDesc',
    linkUrl: 'https://openrouter.ai/keys',
    endpoint: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
    apiKey: '',
    icon: '🌐'
  }
];

function getPrefsAiProviders() {
  if (typeof SetupWizardController !== 'undefined' && Array.isArray(SetupWizardController.providers)) {
    return SetupWizardController.providers;
  }
  return PREFS_AI_PROVIDERS;
}

function renderPrefsAiProviderCards() {
  const container = document.getElementById('prefs-ai-providers-grid');
  if (!container) return;
  const providers = getPrefsAiProviders();
  const currentProvider = (settings.ai && settings.ai.provider) || 'custom';
  let html = '';
  providers.forEach(p => {
    const isSelected = currentProvider === p.id;
    const descText = (typeof t === 'function' && p.descKey) ? t(p.descKey) : p.name;
    const portalBtnText = (typeof t === 'function' && t('setupWizard.providerLinkBtn')) || 'Provider Portal ↗';
    const portalTooltipText = (typeof t === 'function' && t('setupWizard.providerLinkTooltip')) || 'Open provider website in a new tab';
    
    html += `
      <div class="setup-wizard-provider-card ${isSelected ? 'selected' : ''}" onclick="selectPrefsAiProvider('${p.id}')" title="${descText}">
        <div class="setup-wizard-provider-header">
          <span class="setup-wizard-provider-icon">${p.icon}</span>
          <div class="setup-wizard-provider-info">
            <span class="setup-wizard-provider-name">${p.name}</span>
            <span class="setup-wizard-provider-tag">${p.tag}</span>
          </div>
          ${isSelected ? '<span class="setup-wizard-provider-check">✓</span>' : ''}
        </div>
        <p class="setup-wizard-provider-desc">${descText}</p>
        <div class="setup-wizard-provider-footer">
          <button type="button" class="setup-wizard-provider-link" onclick="event.stopPropagation(); openAiProviderLink('${p.id}')" title="${portalTooltipText}">
            ${portalBtnText}
          </button>
        </div>
      </div>
    `;
  });
  container.innerHTML = html;
}

function selectPrefsAiProvider(providerId) {
  if (!settings.ai) settings.ai = {};
  const prevProvider = settings.ai.provider;
  settings.ai.provider = providerId;

  // Sync hidden select element
  const sel = document.getElementById('prefs-ai-provider');
  if (sel) sel.value = providerId;

  const providers = getPrefsAiProviders();
  const found = providers.find(p => p.id === providerId);
  if (found && prevProvider !== providerId) {
    if (found.endpoint) settings.ai.endpoint = found.endpoint;
    if (found.model) settings.ai.model = found.model;
    if (found.apiKey !== undefined) settings.ai.apiKey = found.apiKey;

    const epEl = document.getElementById('prefs-ai-endpoint'); if (epEl) epEl.value = settings.ai.endpoint;
    const mdEl = document.getElementById('prefs-ai-model'); if (mdEl) mdEl.value = settings.ai.model;
    const keyEl = document.getElementById('prefs-ai-key'); if (keyEl) keyEl.value = settings.ai.apiKey;
  }

  saveLocalSettings();
  saveFolderSettingsDebounced();
  renderPrefsAiProviderCards();
  if (typeof updateAiJsonSchemaDisplay === 'function') updateAiJsonSchemaDisplay();
  if (typeof updateLLMToolbarVisibility === 'function') updateLLMToolbarVisibility();
}

function openAiProviderLink(providerId) {
  const providers = getPrefsAiProviders();
  const found = providers.find(p => p.id === providerId);
  if (found && found.linkUrl) {
    window.open(found.linkUrl, '_blank');
  }
}

function prefsAiSettingChanged() {
  if (!settings.ai) settings.ai = {};
  const enabledCb = document.getElementById('prefs-ai-enabled');
  if (enabledCb) settings.ai.enabled = !!enabledCb.checked;

  const providersContainer = document.getElementById('prefs-ai-providers-container');
  if (providersContainer) {
    providersContainer.classList.toggle('is-disabled', !settings.ai.enabled);
  }

  settings.ai.provider = document.getElementById('prefs-ai-provider')?.value || settings.ai.provider || 'custom';
  settings.ai.endpoint = document.getElementById('prefs-ai-endpoint')?.value?.trim() || '';
  settings.ai.apiKey   = document.getElementById('prefs-ai-key')?.value?.trim() || '';
  settings.ai.model    = document.getElementById('prefs-ai-model')?.value?.trim() || '';
  settings.ai.language = document.getElementById('prefs-ai-language')?.value || 'auto';
  settings.ai.returnPreset = document.getElementById('prefs-ai-return-preset')?.value || 'full';
  const suggestWsCb = document.getElementById('prefs-ai-suggest-workstreams');
  if (suggestWsCb) settings.ai.suggestWorkstreams = !!suggestWsCb.checked;
  saveLocalSettings();
  saveFolderSettingsDebounced();
  renderPrefsAiProviderCards();
  if (typeof updateAiJsonSchemaDisplay === 'function') updateAiJsonSchemaDisplay();
  if (typeof updateExternalAgentPromptDisplay === 'function') updateExternalAgentPromptDisplay();
  if (typeof updateLLMToolbarVisibility === 'function') updateLLMToolbarVisibility();
}

function detectAiProviderFromEndpoint(endpoint) {
  const raw = String(endpoint || '').trim().toLowerCase();
  if (!raw) return 'custom';
  if (raw.includes('127.0.0.1:1234') || raw.includes('localhost:1234') || raw.includes('lmstudio')) {
    return 'lmstudio';
  }
  if (raw.includes('127.0.0.1:11434') || raw.includes('localhost:11434') || raw.includes('ollama')) {
    return 'ollama';
  }
  if (raw.includes('api.openai.com')) {
    return 'openai';
  }
  if (raw.includes('api.anthropic.com')) {
    return 'anthropic';
  }
  if (raw.includes('api.groq.com')) {
    return 'groq';
  }
  if (raw.includes('generativelanguage.googleapis.com')) {
    return 'google';
  }
  return 'custom';
}

function updateAiProviderHelperVisibility() {
  const provider = document.getElementById('prefs-ai-provider')?.value || settings.ai?.provider || 'custom';
  const keyBtn = document.getElementById('btn-prefs-ai-key-helper');
  const localBtn = document.getElementById('btn-prefs-ai-local-helper');
  
  if (keyBtn) {
    keyBtn.style.display = ['openai', 'anthropic', 'groq', 'google'].includes(provider) ? 'inline-block' : 'none';
  }
  if (localBtn) {
    localBtn.style.display = ['lmstudio', 'ollama', 'custom'].includes(provider) ? 'inline-block' : 'none';
  }
}

function openAiKeyHelper() {
  const provider = document.getElementById('prefs-ai-provider')?.value || settings.ai?.provider || 'custom';
  let url = 'https://platform.openai.com/api-keys';
  if (provider === 'anthropic') url = 'https://console.anthropic.com/settings/keys';
  if (provider === 'groq') url = 'https://console.groq.com/keys';
  if (provider === 'google') url = 'https://aistudio.google.com/app/apikey';
  window.open(url, '_blank');
}

function openAiLocalSetupHelper() {
  const provider = document.getElementById('prefs-ai-provider')?.value || settings.ai?.provider || 'custom';
  let url = 'https://lmstudio.ai';
  if (provider === 'ollama') url = 'https://ollama.com';
  window.open(url, '_blank');
}

function prefsAiProviderChanged(provider) {
  if (!settings.ai) settings.ai = {};
  settings.ai.provider = provider || 'custom';
  updateAiProviderHelperVisibility();
  saveLocalSettings();
  saveFolderSettingsDebounced();
  renderPrefsAiProviderCards();
}

function applyAiProviderPreset() {
  if (!settings.ai) settings.ai = {};
  const provider = document.getElementById('prefs-ai-provider')?.value || settings.ai.provider || 'custom';

  if (provider === 'lmstudio') {
    settings.ai.provider = 'lmstudio';
    settings.ai.endpoint = 'http://127.0.0.1:1234/v1';
    if (!settings.ai.model || !settings.ai.model.trim()) settings.ai.model = 'qwen2.5-coder-7b-instruct';
    if (!settings.ai.apiKey || !settings.ai.apiKey.trim()) settings.ai.apiKey = 'lm-studio';
    saveLocalSettings();
    saveFolderSettingsDebounced();
    renderPrefs();
    toast(t('common.lmStudioPresetApplied') || 'LM Studio preset applied!');
    return;
  }
  
  if (provider === 'ollama') {
    settings.ai.provider = 'ollama';
    settings.ai.endpoint = 'http://127.0.0.1:11434/v1';
    if (!settings.ai.model || !settings.ai.model.trim()) settings.ai.model = 'llama3.1';
    if (!settings.ai.apiKey || !settings.ai.apiKey.trim()) settings.ai.apiKey = 'ollama';
    saveLocalSettings();
    saveFolderSettingsDebounced();
    renderPrefs();
    toast('Ollama preset applied!');
    return;
  }

  if (provider === 'openai') {
    settings.ai.provider = 'openai';
    settings.ai.endpoint = 'https://api.openai.com/v1';
    settings.ai.model = 'gpt-4o';
    saveLocalSettings();
    saveFolderSettingsDebounced();
    renderPrefs();
    toast(t('common.openAiPresetApplied') || 'OpenAI preset applied!');
    return;
  }

  if (provider === 'anthropic') {
    settings.ai.provider = 'anthropic';
    settings.ai.endpoint = 'https://api.anthropic.com/v1';
    settings.ai.model = 'claude-3-5-sonnet-20241022';
    saveLocalSettings();
    saveFolderSettingsDebounced();
    renderPrefs();
    toast(t('common.anthropicPresetApplied') || 'Anthropic preset applied!');
    return;
  }

  if (provider === 'groq') {
    settings.ai.provider = 'groq';
    settings.ai.endpoint = 'https://api.groq.com/openai/v1';
    settings.ai.model = 'llama-3.3-70b-versatile';
    saveLocalSettings();
    saveFolderSettingsDebounced();
    renderPrefs();
    toast('Groq preset applied!');
    return;
  }

  if (provider === 'google') {
    settings.ai.provider = 'google';
    settings.ai.endpoint = 'https://generativelanguage.googleapis.com/v1beta/openai/';
    settings.ai.model = 'gemini-2.0-flash-exp';
    saveLocalSettings();
    saveFolderSettingsDebounced();
    renderPrefs();
    toast('Google Gemini preset applied!');
    return;
  }

  settings.ai.provider = 'custom';
  saveLocalSettings();
  saveFolderSettingsDebounced();
  renderPrefs();
  toast(t('common.customEndpointModeSelected'));
}

function toggleAiFeatureEnabled() {
  if (!settings.ai) settings.ai = {};
  settings.ai.enabled = !settings.ai.enabled;
  saveLocalSettings();
  saveFolderSettingsDebounced();
  renderPrefs();
  if (typeof updateLLMToolbarVisibility === 'function') updateLLMToolbarVisibility();
  toast(settings.ai.enabled ? t('common.localLlmEnabled') : t('common.localLlmDisabled'));
}

async function runFirstStartSetupIfNeeded() {
  if (settings && settings.firstRunSetupDone) return;
  // If first run setup is not done, launch the Setup Wizard
  if (typeof SetupWizardController !== 'undefined') {
    SetupWizardController.open();
  }
}
function prefsWorkTimeChanged() {
  const s = document.getElementById('prefs-work-start')?.value || '09:00';
  const e = document.getElementById('prefs-work-end')?.value   || '18:30';
  workStartTime = s;
  workEndTime   = e;
  try { localStorage.setItem('secretaryWorkStart', s); } catch(ex) {}
  try { localStorage.setItem('secretaryWorkEnd',   e); } catch(ex) {}
  if (!settings.ui) settings.ui = {};
  settings.ui.workStartTime = s;
  settings.ui.workEndTime   = e;
  saveLocalSettings();
  saveFolderSettingsDebounced();
  if (activeTab === 'planner') {
    window._plannerInitialScrollDone = false;
    renderPlanner();
  }
}
function prefsDefaultDurationChanged() {
  const d = parseInt(document.getElementById('prefs-default-duration')?.value || '30') || 30;
  defaultPlannerDuration = d;
  try { localStorage.setItem('secretaryDefaultDuration', String(d)); } catch(ex) {}
  if (!settings.ui) settings.ui = {};
  settings.ui.defaultPlannerDuration = d;
  saveLocalSettings();
  saveFolderSettingsDebounced();
}
function prefsLaneSortChanged(val) { if (!settings.ui) settings.ui = {}; settings.ui.laneSort = val; saveLocalSettings(); saveFolderSettingsDebounced(); try { localStorage.setItem('secretaryLaneSort', val); } catch(e) {} laneSortMode = val; const laneSortSel = document.getElementById('prefs-lane-sorting'); if (laneSortSel && laneSortSel.value !== val) laneSortSel.value = val; renderBoard(); }
function prefsWeekCutoffChanged(val) {
  const v = Math.max(1, Math.min(104, parseInt(val) || 8));
  weekCutoffWeeks = v;
  if (!settings.ui) settings.ui = {};
  settings.ui.weekCutoffWeeks = v;
  try { localStorage.setItem('secretaryWeekCutoff', String(v)); } catch(e) {}
  saveLocalSettings();
  saveFolderSettingsDebounced();
  renderBoard();
}
async function changeFolderFromPrefs() {
  try {
    const handle = await showSecretaryFolderPicker();
    await saveHandleIDB(handle);
    settings.folder.last = handle.name;
    rememberedFolderHandle = handle;
    saveLocalSettings();
    await mountFolder(handle);
  } catch (e) { if (e.name !== 'AbortError') toast(t('common.couldNotOpenFolder', { message: e.message }), true); }
}

async function clearSavedFolder() {
  try {
    await saveHandleIDB(null);
    settings.folder.last = null;
    rememberedFolderHandle = null;
    saveLocalSettings();
    toast(t('common.forgotSavedFolder'));
    const resumeWrap = document.getElementById('landing-resume-wrap');
    if (resumeWrap) resumeWrap.style.display = 'none';
    const divider = document.getElementById('landing-divider');
    if (divider) divider.style.display = 'none';
    const btnOpen = document.getElementById('btn-open-folder');
    if (btnOpen) {
      btnOpen.classList.add('landing-btn-open-hero');
      const openText = document.getElementById('btn-open-folder-text');
      if (openText) openText.textContent = t('landing.open');
    }
    const btnResume = document.getElementById('btn-resume-folder');
    if (btnResume) {
      btnResume.style.display = 'none';
      btnResume.onclick = null;
    }
  } catch (e) { toast(t('common.couldNotClearSavedFolder', { message: e.message }), true); }
}

async function loadSettingsFromFolder() {
  if (!rootHandle) return null;
  for (const p of ['secretary-settings.json', '.secretary/settings.json']) {
    try {
      if (await StorageAPI.hasSettings(p)) {
        const s = await StorageAPI.readSettings(p);
        deepMerge(settings, s);
        if (settings.storageEngine === 'firebase' && window.StorageAPI) {
          window.StorageAPI.setStorageEngine('firebase');
        }
        saveLocalSettings();
        applySettings();
        return s;
      }
    } catch (e) { console.warn('Failed reading settings from', p, e); }
  }
  return null;
}

async function loadSettingsFromFolderUI() {
  try {
    const s = await loadSettingsFromFolder();
    if (s) toast(t('common.loadedSettings'));
    else toast(t('common.noSettingsFile'), true);
    renderPrefs();
  } catch (e) { toast(t('common.loadFailed', { message: e.message }), true); }
}

function gatherPrefsFromDOM() {
  if (!settings.ui) settings.ui = {};
  if (!settings.ui.colors) settings.ui.colors = {};
  if (!settings.ai) settings.ai = {};
  if (!settings.folder) settings.folder = {};

  const themeEl = document.getElementById('prefs-theme');
  if (themeEl) settings.ui.theme = themeEl.value;

  const mappings = {
    bg: 'pref-color-bg',
    text: 'pref-color-text',
    accent: 'pref-color-accent',
    cardBg: 'pref-color-cardBg',
    cardBgAlt: 'pref-color-cardBgAlt',
    todoRankBg: 'pref-color-todoRankBg',
    todoRankText: 'pref-color-todoRankText'
  };
  Object.entries(mappings).forEach(([k, id]) => {
    const el = document.getElementById(id);
    if (el) settings.ui.colors[k] = el.value;
  });

  const laneSortEl = document.getElementById('prefs-lane-sorting');
  if (laneSortEl) settings.ui.laneSort = laneSortEl.value;

  const weekCutoffEl = document.getElementById('prefs-week-cutoff');
  if (weekCutoffEl) settings.ui.weekCutoffWeeks = parseInt(weekCutoffEl.value) || 8;

  const wsEl = document.getElementById('prefs-work-start');
  if (wsEl) settings.ui.workStartTime = wsEl.value;
  const weEl = document.getElementById('prefs-work-end');
  if (weEl) settings.ui.workEndTime = weEl.value;

  const selectedDays = [];
  [1, 2, 3, 4, 5, 6, 0].forEach(day => {
    const cb = document.getElementById(`pref-wd-${day}`);
    if (cb && cb.checked) selectedDays.push(day);
  });
  settings.ui.workingDays = selectedDays;
  plannerWorkingDays = selectedDays;

  const ddEl = document.getElementById('prefs-default-duration');
  if (ddEl) settings.ui.defaultPlannerDuration = parseInt(ddEl.value) || 30;

  const usernameEl = document.getElementById('prefs-username');
  if (usernameEl) settings.username = usernameEl.value.trim();

  // rememberPassphrase is managed exclusively by toggleRememberPassphraseUI / the keychain save path
  // (never inferred from the checkbox, which may not reflect a successful save).



  const langSel = document.getElementById('prefs-language');
  if (langSel) settings.language = langSel.value;

  const aiEnabledEl = document.getElementById('prefs-ai-enabled');
  if (aiEnabledEl) settings.ai.enabled = aiEnabledEl.checked;

  const providerEl = document.getElementById('prefs-ai-provider');
  if (providerEl) settings.ai.provider = providerEl.value;

  const endpointEl = document.getElementById('prefs-ai-endpoint');
  if (endpointEl) settings.ai.endpoint = endpointEl.value.trim();

  const apiKeyEl = document.getElementById('prefs-ai-key');
  if (apiKeyEl) settings.ai.apiKey = apiKeyEl.value.trim();

  const modelEl = document.getElementById('prefs-ai-model');
  if (modelEl) settings.ai.model = modelEl.value.trim();

  const aiLangEl = document.getElementById('prefs-ai-language');
  if (aiLangEl) settings.ai.language = aiLangEl.value;

  const returnPresetEl = document.getElementById('prefs-ai-return-preset');
  if (returnPresetEl) settings.ai.returnPreset = returnPresetEl.value;

  const suggestWsEl = document.getElementById('prefs-ai-suggest-workstreams');
  if (suggestWsEl) settings.ai.suggestWorkstreams = suggestWsEl.checked;
}

async function savePrefs() {
  try {
    const oldUsername = settings.username || '';
    const oldLang = settings.language || '';
    const oldLaneSort = (settings.ui && settings.ui.laneSort) || '';
    const oldWeekCutoff = (settings.ui && settings.ui.weekCutoffWeeks) || 8;
    const oldWorkStart = (settings.ui && settings.ui.workStartTime) || '';
    const oldWorkEnd = (settings.ui && settings.ui.workEndTime) || '';
    const oldWorkingDays = (settings.ui && settings.ui.workingDays || []).join(',');

    gatherPrefsFromDOM();
    saveLocalSettings();
    applySettings();

    const newUsername = settings.username || '';
    const newLang = settings.language || '';
    const newLaneSort = (settings.ui && settings.ui.laneSort) || '';
    const newWeekCutoff = (settings.ui && settings.ui.weekCutoffWeeks) || 8;
    const newWorkStart = (settings.ui && settings.ui.workStartTime) || '';
    const newWorkEnd = (settings.ui && settings.ui.workEndTime) || '';
    const newWorkingDays = (settings.ui && settings.ui.workingDays || []).join(',');

    let needsBoardRender = false;
    let needsCollabRebuild = false;

    if (oldUsername !== newUsername) {
      needsCollabRebuild = true;
      needsBoardRender = true;
    }
    if (oldLang !== newLang) {
      setAppLanguage(newLang);
      needsBoardRender = true;
    }
    if (oldLaneSort !== newLaneSort) {
      laneSortMode = newLaneSort;
      needsBoardRender = true;
    }
    if (oldWeekCutoff !== newWeekCutoff) {
      needsBoardRender = true;
    }
    if (oldWorkStart !== newWorkStart || oldWorkEnd !== newWorkEnd || oldWorkingDays !== newWorkingDays) {
      if (activeTab === 'planner') {
        window._plannerInitialScrollDone = false;
        renderPlanner();
      }
      if (typeof window.updateRetroFlashAndHoverState === 'function') {
        window.updateRetroFlashAndHoverState();
      }
    }

    if (needsCollabRebuild && typeof rebuildCollaborativeAggregates === 'function') {
      rebuildCollaborativeAggregates();
    }
    if (needsBoardRender && typeof renderBoard === 'function') {
      renderBoard();
    }

    if (rootHandle) {
      await StorageAPI.writeSettings(settings);
      toast(t('common.settingsSaved'));
    } else {
      toast(t('common.settingsSavedLocally'));
    }
    renderPrefs();
  } catch (e) { toast(t('common.saveFailed', { message: e.message }), true); }
}

function normalizeToHexColor(colorStr) {
  if (!colorStr) return '';
  colorStr = colorStr.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(colorStr)) return colorStr.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(colorStr)) {
    return ('#' + colorStr[1] + colorStr[1] + colorStr[2] + colorStr[2] + colorStr[3] + colorStr[3]).toLowerCase();
  }
  const rgb = colorStr.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)$/i);
  if (rgb) {
    const r = parseInt(rgb[1]).toString(16).padStart(2, '0');
    const g = parseInt(rgb[2]).toString(16).padStart(2, '0');
    const b = parseInt(rgb[3]).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }
  if (typeof document !== 'undefined') {
    const temp = document.createElement('div');
    temp.style.color = colorStr;
    document.body.appendChild(temp);
    const computedColor = getComputedStyle(temp).color;
    temp.remove();
    const resolvedRgb = computedColor.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)$/i);
    if (resolvedRgb) {
      const r = parseInt(resolvedRgb[1]).toString(16).padStart(2, '0');
      const g = parseInt(resolvedRgb[2]).toString(16).padStart(2, '0');
      const b = parseInt(resolvedRgb[3]).toString(16).padStart(2, '0');
      return `#${r}${g}${b}`;
    }
  }
  return '';
}

function renderPrefs() {
  const el = document.getElementById('prefs-panel');
  if (!el) return;
  const themeSel = document.getElementById('prefs-theme'); if (themeSel) themeSel.value = (settings.ui && settings.ui.theme) || 'system';
  const folderNameEl = document.getElementById('prefs-folder-name'); if (folderNameEl) folderNameEl.textContent = rootHandle ? rootHandle.name : (settings.folder && settings.folder.last) ? settings.folder.last : t('prefs.notSet');
  
  const accentVal = (settings.ui && settings.ui.accent) || '#4f46e5';
  const accentColorEl = document.getElementById('prefs-accent-color'); if (accentColorEl) accentColorEl.value = accentVal;
  const accentPresetEl = document.getElementById('prefs-accent-preset'); if (accentPresetEl) accentPresetEl.value = accentVal;

  const usernameEl = document.getElementById('prefs-username'); if (usernameEl) usernameEl.value = settings.username || '';
  const langSel = document.getElementById('prefs-language'); if (langSel) langSel.value = settings.language || (typeof getBrowserLanguageCode === 'function' ? getBrowserLanguageCode() : 'en');
  const workingLangSel = document.getElementById('prefs-working-language'); if (workingLangSel) workingLangSel.value = settings.workingLanguage || 'en';
  const laneSortSel = document.getElementById('prefs-lane-sorting'); if (laneSortSel) laneSortSel.value = (settings.ui && settings.ui.laneSort) || laneSortMode || 'recent';
  const weekCutoffEl = document.getElementById('prefs-week-cutoff'); if (weekCutoffEl) weekCutoffEl.value = (settings.ui && settings.ui.weekCutoffWeeks) || weekCutoffWeeks || 8;
  // Work time settings
  const wsEl = document.getElementById('prefs-work-start'); if (wsEl) wsEl.value = (settings.ui && settings.ui.workStartTime) || workStartTime || '09:00';
  const weEl = document.getElementById('prefs-work-end');   if (weEl) weEl.value = (settings.ui && settings.ui.workEndTime)   || workEndTime   || '18:30';
  const ddEl = document.getElementById('prefs-default-duration'); if (ddEl) ddEl.value = (settings.ui && settings.ui.defaultPlannerDuration) || defaultPlannerDuration || 30;
  
  [1, 2, 3, 4, 5, 6, 0].forEach(day => {
    const cb = document.getElementById(`pref-wd-${day}`);
    if (cb) cb.checked = plannerWorkingDays.includes(day);
  });

  const ai = settings.ai || {};
  const aiProvider = ai.provider || detectAiProviderFromEndpoint(ai.endpoint);
  const aiProviderEl = document.getElementById('prefs-ai-provider');
  if (aiProviderEl) aiProviderEl.value = aiProvider;
  
  const aiEnabled = !!ai.enabled;
  const aiEnabledHiddenEl = document.getElementById('prefs-ai-enabled');
  if (aiEnabledHiddenEl) aiEnabledHiddenEl.checked = aiEnabled;

  const aiProvidersContainer = document.getElementById('prefs-ai-providers-container');
  if (aiProvidersContainer) {
    aiProvidersContainer.classList.toggle('is-disabled', !aiEnabled);
  }

  const aiEndpointEl = document.getElementById('prefs-ai-endpoint'); if (aiEndpointEl) aiEndpointEl.value = ai.endpoint || 'http://localhost:1234/v1';
  const aiKeyEl = document.getElementById('prefs-ai-key'); if (aiKeyEl) aiKeyEl.value = ai.apiKey || '';
  const aiModelEl = document.getElementById('prefs-ai-model'); if (aiModelEl) aiModelEl.value = ai.model || (aiProvider === 'lmstudio' ? 'local-model' : 'qwen2.5-coder-7b-instruct');
  const aiLanguageEl = document.getElementById('prefs-ai-language'); if (aiLanguageEl) aiLanguageEl.value = ai.language || 'auto';
  const aiPresetEl = document.getElementById('prefs-ai-return-preset'); if (aiPresetEl) aiPresetEl.value = ai.returnPreset || 'full';
  const aiSuggestWsEl = document.getElementById('prefs-ai-suggest-workstreams'); if (aiSuggestWsEl) aiSuggestWsEl.checked = ai.suggestWorkstreams !== false;
  
  refreshRememberPassphraseControl();

  renderPrefsAiProviderCards();
  if (typeof updateAiJsonSchemaDisplay === 'function') updateAiJsonSchemaDisplay();
  if (typeof updateExternalAgentPromptDisplay === 'function') updateExternalAgentPromptDisplay();
  if (typeof updateLLMToolbarVisibility === 'function') updateLLMToolbarVisibility();
  if (typeof switchPrefsTab === 'function') switchPrefsTab(activePrefsTab);
}

function getAiJsonSchema(preset) {
  const actionsEnum = [];
  if (!preset || preset === 'full') {
    actionsEnum.push('create_todo', 'log_decision', 'text_correction');
  } else if (preset === 'summary_actions' || preset === 'actions_only') {
    actionsEnum.push('create_todo', 'log_decision');
  } else if (preset === 'corrections_only') {
    actionsEnum.push('text_correction');
  }

  const schema = {
    type: 'object',
    properties: {
      general_comment: {
        type: 'string',
        description: (preset === 'actions_only' || preset === 'corrections_only')
          ? 'Laisser ce champ vide ou égal à ""'
          : 'Résumé du meeting en 2 à 4 phrases (les points clés entourés de <mark>...</mark>)'
      },
      suggested_actions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: actionsEnum.length ? actionsEnum : ['unknown']
            },
            properties: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'Titre court de la tâche' },
                priority: { type: 'string', enum: ['High', 'Medium', 'Low'] },
                assignee: { type: 'string', description: 'Nom du responsable (ou null)' },
                context_link: { type: 'string' },
                text: { type: 'string', description: 'Texte complet de la décision prise' },
                major_topic: { type: 'string' },
                supersedes: { type: 'string', description: 'Note ID ou texte remplacé' },
                diff: { type: 'string', description: 'Bloc Unified Diff (lignes avec - et +)' },
                annotation: { type: 'string', description: 'Pourquoi la correction est proposée' }
              },
              required: []
            }
          },
          required: ['action', 'properties']
        }
      }
    },
    required: ['general_comment', 'suggested_actions']
  };

  if (preset === 'summary_only') {
    schema.properties.suggested_actions = {
      type: 'array',
      maxItems: 0,
      description: 'Doit être strictement vide'
    };
  }

  return JSON.stringify(schema, null, 2);
}

function updateAiJsonSchemaDisplay() {
  const preset = document.getElementById('prefs-ai-return-preset')?.value || 'full';
  const textarea = document.getElementById('prefs-ai-schema-display');
  if (textarea) {
    textarea.value = getAiJsonSchema(preset);
  }
}

async function copyAiJsonSchema() {
  const textarea = document.getElementById('prefs-ai-schema-display');
  if (!textarea) return;
  try {
    await navigator.clipboard.writeText(textarea.value);
    toast(t('prefs.schemaCopied') || 'JSON Schema copied to clipboard!');
  } catch (err) {
    toast(t('common.copyFailed', { message: err.message }), true);
  }
}

function updateExternalAgentPromptDisplay() {
  const textarea = document.getElementById('prefs-external-agent-prompt');
  if (textarea) {
    const activeUserName = (typeof settings !== 'undefined' && settings && settings.username) ||
      (typeof window !== 'undefined' && window.settings && window.settings.username) || '';
    const wsPath = (typeof currentWorkspacePath !== 'undefined' && currentWorkspacePath)
      || (typeof rootHandle !== 'undefined' && rootHandle && (rootHandle.path || rootHandle.name))
      || (typeof settings !== 'undefined' && settings && settings.folder && settings.folder.last)
      || '';
    if (typeof AppPrompts !== 'undefined' && typeof AppPrompts.buildExternalAgentEmailProposalPrompt === 'function') {
      textarea.value = AppPrompts.buildExternalAgentEmailProposalPrompt({
        userName: activeUserName,
        workspacePath: wsPath
      });
    } else {
      textarea.value = `# External AI Agent Guidelines: Extracting Calendar Events from Email into Secretary\n\nTarget file: planner-proposals.json in the root workspace.\nAlways append new proposals to planner-proposals.json without deleting existing entries.\nAsk user for their mail application if unknown.`;
    }
  }
}

async function copyExternalAgentPrompt() {
  const textarea = document.getElementById('prefs-external-agent-prompt');
  if (!textarea) return;
  try {
    await navigator.clipboard.writeText(textarea.value);
    toast(t('prefs.agentPromptCopied') || 'External agent guidelines copied to clipboard!');
  } catch (err) {
    toast(t('common.copyFailed', { message: err.message }), true);
  }
}

window.updateAiJsonSchemaDisplay = updateAiJsonSchemaDisplay;
window.copyAiJsonSchema = copyAiJsonSchema;
window.updateExternalAgentPromptDisplay = updateExternalAgentPromptDisplay;
window.copyExternalAgentPrompt = copyExternalAgentPrompt;
// ═══ Cross-window sync ═══
function broadcastSync(msg) {
  if (!msg || typeof msg !== 'object') return;
  const msgId = msg.msgId || (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9));
  let safePayload;
  try {
    safePayload = JSON.parse(JSON.stringify({ ...msg, msgId, senderId: _windowId }));
  } catch (e) {
    safePayload = { type: msg.type || 'UNKNOWN', noteId: msg.noteId, path: msg.path, file: msg.file, msgId, senderId: _windowId };
  }
  if (_syncChannel) {
    try { _syncChannel.postMessage(safePayload); } catch(e) {}
  }
  if (window.AppBridge?.sync) {
    try { window.AppBridge.sync.broadcast(safePayload); } catch(e) {}
  }
}

let _syncRefreshTimer = null;
let _syncNeedsManifestReload = false;
let _syncNeedsFiltersRefresh = false;
let _syncNeedsTodosReload = false;
let _syncNeedsPlannerReload = false;
let _syncChangedNotes = [];

function scheduleSyncRefresh({ manifest = false, filters = false, todos = false, planner = false, changedNote = null } = {}) {
  _syncNeedsManifestReload = _syncNeedsManifestReload || manifest;
  _syncNeedsFiltersRefresh = _syncNeedsFiltersRefresh || filters;
  _syncNeedsTodosReload = _syncNeedsTodosReload || todos;
  _syncNeedsPlannerReload = _syncNeedsPlannerReload || planner;
  if (changedNote) {
    _syncChangedNotes.push(changedNote);
  }
  if (_syncRefreshTimer) return;
  _syncRefreshTimer = setTimeout(async () => {
    _syncRefreshTimer = null;
    const needManifest = _syncNeedsManifestReload;
    const needFilters = _syncNeedsFiltersRefresh;
    const needTodos = _syncNeedsTodosReload;
    const needPlanner = _syncNeedsPlannerReload;
    const changedNotesList = [..._syncChangedNotes];
    _syncNeedsManifestReload = false;
    _syncNeedsFiltersRefresh = false;
    _syncNeedsTodosReload = false;
    _syncNeedsPlannerReload = false;
    _syncChangedNotes = [];

    if (needManifest) {
      try { await loadManifest(); } catch(e) { console.warn('Manifest reload failed', e); }
    }
    if (needTodos) {
      try { await loadTodosManifest(); } catch(e) { console.warn('Todos reload failed', e); }
    }
    if (needPlanner) {
      try { await loadPlanner(); } catch(e) { console.warn('Planner reload failed', e); }
    }

    if (needManifest || needTodos) {
      if ((activeTab === 'team' || activeTab === 'decisions') && typeof rebuildCollaborativeAggregates === 'function') {
        rebuildCollaborativeAggregates();
      }
      if ((activeTab === 'team' || activeTab === 'decisions') && typeof renderTeamPanel === 'function') {
        let shouldRedrawWorkstream = true;
        if (changedNotesList.length > 0) {
          const notesToCheck = changedNotesList.map(item => {
            const path = typeof item === 'string' ? item : (item.path || null);
            const noteId = typeof item === 'object' ? (item.noteId || item.id || null) : null;
            let noteObj = typeof item === 'object' && (item.major_topic_tags || item.group_tags) ? item : null;
            if (!noteObj && path && typeof metadataByPath !== 'undefined' && metadataByPath) noteObj = metadataByPath.get(path);
            if (!noteObj && noteId && typeof metadataById !== 'undefined' && metadataById) noteObj = metadataById.get(noteId);
            if (!noteObj && typeof manifest !== 'undefined' && Array.isArray(manifest)) {
              noteObj = manifest.find(n => (path && n.path === path) || (noteId && n.id === noteId));
            }
            return noteObj || item;
          }).filter(Boolean);

          if (notesToCheck.length > 0 && typeof doesNoteMatchWorkstreamTags === 'function') {
            const activeWorkstream = typeof selectedRegistryProject !== 'undefined' ? selectedRegistryProject : '';
            shouldRedrawWorkstream = notesToCheck.some(n => doesNoteMatchWorkstreamTags(n, activeWorkstream));
          }
        }
        if (shouldRedrawWorkstream) {
          renderTeamPanel();
        }
      }
      if (activeTab === 'retro' && typeof renderRetroPanel === 'function') renderRetroPanel();
    }

    if (needFilters && (activeTab === 'notes' || activeTab === 'todos')) renderFilterChips();
    else if ((needManifest || needTodos) && (activeTab === 'notes' || activeTab === 'todos')) renderBoard();
    if (needPlanner && activeTab === 'planner') renderPlanner();
    if ((needManifest || needTodos) && activeTab === 'chat' && window.AIChatController) {
      window.AIChatController.render();
    }
  }, 200);
}

let _unsubscribeElectronSync = null;
const _processedSyncMsgIds = new Set();

async function handleSyncMessage(e) {
  const { type, senderId, noteId, path, modified, msgId } = e.data || {};
  if (senderId === _windowId) return; // ignore own messages

  // De-duplicate broadcast messages received via both BroadcastChannel and Electron IPC
  if (msgId) {
    if (_processedSyncMsgIds.has(msgId)) return;
    _processedSyncMsgIds.add(msgId);
    if (_processedSyncMsgIds.size > 200) {
      const first = _processedSyncMsgIds.values().next().value;
      _processedSyncMsgIds.delete(first);
    }
  }

  if (type === 'NOTE_SAVED') {
    let existingMeta = (path && typeof metadataByPath !== 'undefined' && metadataByPath ? metadataByPath.get(path) : null) ||
                       (noteId && typeof metadataById !== 'undefined' && metadataById ? metadataById.get(noteId) : null);
    if (path) {
      if (typeof StorageAPI !== 'undefined' && StorageAPI.invalidateNoteCache) {
        StorageAPI.invalidateNoteCache(path);
      } else if (typeof StorageAPI !== 'undefined' && StorageAPI._noteCache) {
        StorageAPI._noteCache.delete(path);
      }
      if (typeof noteContentCache !== 'undefined' && noteContentCache) delete noteContentCache[path];
      if (typeof notePreviewCache !== 'undefined' && notePreviewCache) delete notePreviewCache[path];
      if (typeof htmlLRUCache !== 'undefined' && htmlLRUCache) htmlLRUCache.delete(path);
      if (typeof previewLRUCache !== 'undefined' && previewLRUCache) previewLRUCache.delete(path);
      if (typeof collabLRUCache !== 'undefined' && collabLRUCache) collabLRUCache.delete(path);
    }
    scheduleSyncRefresh({ manifest: true, filters: true, changedNote: existingMeta || { path, noteId } });
    try { await updateNoteInCollabIndex(path); } catch(err) {}
    
    const isCurrentNote = (noteId && currentNote?.id === noteId) || (path && currentNote?.path === path);
    if (isCurrentNote && currentNote) {
      const isViewMode = document.querySelector('.overlay-panel')?.classList.contains('overlay-view-mode');
      if (isViewMode) {
        try {
          const html = await StorageAPI.readNoteContent(path || currentNote.path);
          const parsed = parseNoteHTML(html);
          currentNote = { ...currentNote, originalHTML: html, ...parsed };
          const titleEl = document.getElementById('edit-title');
          if (titleEl) titleEl.value = currentNote.title || '';
          const dateEl = document.getElementById('edit-date');
          if (dateEl) dateEl.value = currentNote.date || '';
          const sumEl = document.getElementById('edit-summary');
          if (sumEl) {
            sumEl.innerHTML = await resolveNoteImages(currentNote.summary || '<p><br></p>');
            if (typeof renderLatexInElement === 'function') renderLatexInElement(sumEl);
          }
          const ta = document.getElementById('edit-textarea');
          if (ta) {
            let cleanHTML = parsed.mainHTML || '<p><br></p>';
            if (typeof window.cleanHtmlBeforeSave === 'function') {
              cleanHTML = window.cleanHtmlBeforeSave(cleanHTML);
            }
            if (typeof resolveNoteImages === 'function') {
              cleanHTML = await resolveNoteImages(cleanHTML);
            }
            ta.innerHTML = cleanHTML;
            if (typeof renderLatexInElement === 'function') renderLatexInElement(ta);
          }
          const activeEl = document.activeElement;
          const isFocusingTags = activeEl && activeEl.closest && activeEl.closest('.tags-editor');
          if (!isFocusingTags && typeof populateTagEditor === 'function') {
            populateTagEditor('editor-group', currentNote.group_tags, 'group');
            populateTagEditor('editor-major', currentNote.major_topic_tags, 'major');
            populateTagEditor('editor-topic', currentNote.topic_tags, 'topic');
            populateTagEditor('editor-extra', currentNote.extra_tags, 'extra');
          }
          syncPreview();
          if (_isFocusedMode) {
            document.title = (currentNote.title || t('common.untitled')) + ' — ' + t('app.name');
          }
          if (typeof renderInspectorPanel === 'function') renderInspectorPanel().catch(() => {});
          if (typeof syncImageStrip === 'function') syncImageStrip();
        } catch(err) { console.warn('Sync reload failed', err); }
      } else {
        const banner = document.getElementById('overlay-reload-banner');
        if (banner) banner.classList.add('visible');
      }
    }
  }

  if (type === 'NOTE_DELETED') {
    let existingMeta = (path && typeof metadataByPath !== 'undefined' && metadataByPath ? metadataByPath.get(path) : null) ||
                       (noteId && typeof metadataById !== 'undefined' && metadataById ? metadataById.get(noteId) : null);
    if (path) {
      if (typeof StorageAPI !== 'undefined' && StorageAPI.invalidateNoteCache) {
        StorageAPI.invalidateNoteCache(path);
      } else if (typeof StorageAPI !== 'undefined' && StorageAPI._noteCache) {
        StorageAPI._noteCache.delete(path);
      }
      if (typeof noteContentCache !== 'undefined' && noteContentCache) delete noteContentCache[path];
      if (typeof notePreviewCache !== 'undefined' && notePreviewCache) delete notePreviewCache[path];
      if (typeof htmlLRUCache !== 'undefined' && htmlLRUCache) htmlLRUCache.delete(path);
      if (typeof previewLRUCache !== 'undefined' && previewLRUCache) previewLRUCache.delete(path);
      if (typeof collabLRUCache !== 'undefined' && collabLRUCache) collabLRUCache.delete(path);
    }
    if (typeof metadataShardIndexCache !== 'undefined') metadataShardIndexCache = null;
    scheduleSyncRefresh({ manifest: true, filters: true, changedNote: existingMeta || { path, noteId } });
    const isCurrentNote = (noteId && currentNote?.id === noteId) || (path && currentNote?.path === path);
    if (isCurrentNote) {
      closeNoteOverlay({ skipSave: true, forceCloseAll: true });
      toast(t('common.thisNoteDeletedElsewhere'));
    }
  }

  if (type === 'MANIFEST_UPDATED') {
    if (typeof metadataShardIndexCache !== 'undefined') metadataShardIndexCache = null;
    scheduleSyncRefresh({ manifest: true, filters: true });
  }

  if (type === 'TODOS_UPDATED') {
    scheduleSyncRefresh({ todos: true });
  }

  if (type === 'PLANNER_UPDATED' || type === 'PLANNER_PROPOSALS_UPDATED') {
    if (_isFocusedMode && currentNote?.id && typeof _renderPlannerBlocksForNote === 'function') {
      _renderPlannerBlocksForNote(currentNote.id);
    } else {
      scheduleSyncRefresh({ planner: true });
    }
  }

  if (type === 'SETTINGS_UPDATED') {
    if (e.data?.settings && typeof e.data.settings === 'object') {
      Object.assign(settings, e.data.settings);
      saveLocalSettings();
      applySettings();
      if (e.data.settings.ui?.workingDays && Array.isArray(e.data.settings.ui.workingDays)) {
        plannerWorkingDays = e.data.settings.ui.workingDays;
      }
      if (typeof renderPrefs === 'function') renderPrefs();
      if (typeof renderBoard === 'function') renderBoard();
      if (typeof renderPlanner === 'function' && activeTab === 'planner') renderPlanner();
      if (typeof renderFilterChips === 'function') renderFilterChips();
    }
  }

  if (type === 'DECISIONS_UPDATED') {
    if (typeof rebuildCollaborativeAggregates === 'function') rebuildCollaborativeAggregates();
    if ((activeTab === 'team' || activeTab === 'decisions') && typeof renderTeamPanel === 'function') renderTeamPanel();
    if (typeof renderInspectorPanel === 'function' && currentNote) renderInspectorPanel().catch(() => {});
  }

  if (type === 'COLLEAGUES_UPDATED') {
    if (typeof loadColleaguesDb === 'function') {
      try { await loadColleaguesDb(); } catch(err) {}
    }
    if (typeof rebuildCollaborativeAggregates === 'function') rebuildCollaborativeAggregates();
    if ((activeTab === 'team' || activeTab === 'decisions') && typeof renderTeamPanel === 'function') renderTeamPanel();
    if (typeof renderBoard === 'function') renderBoard();
  }

  if (type === 'AI_CHAT_UPDATED') {
    if (window.AIChatController && typeof window.AIChatController.loadChatHistoryFromFolder === 'function') {
      try {
        await window.AIChatController.loadChatHistoryFromFolder();
        if (activeTab === 'chat' || window.AIChatController.isOpen) {
          window.AIChatController.render();
        }
      } catch(err) {}
    }
  }

  if (type === 'WRITE_DONE') {
    // Release any yielded write for this file
    const key = '__write_yield_' + (e.data?.file || '');
    if (window[key]) { clearTimeout(window[key]); delete window[key]; }
  }
}
// ═══ Init ═══

/** Mount a directory handle: load data and switch to the main screen. */
// ═══ App Init ═══
async function mountFolder(handle) {
  if (typeof showLandingStep === 'function') {
    showLandingStep('welcome');
  }
  if (typeof perfTelemetry !== 'undefined' && perfTelemetry?.startup) {
    perfTelemetry.startup.mountStartedAt = performance.now();
  }
  setLandingBusy(true, typeof t === 'function' ? t('landing.loadingFolder') : 'Loading folder…');
  setStartupState('BOOT_MINIMAL');

  // Reset folder-scoped runtime caches before loading a new workspace folder.
  manifest = [];
  metadataBuffer = [];
  metadataById = new Map();
  metadataByPath = new Map();
  metadataShardIndexCache = null;
  metadataHydrationProgress = { done: 0, total: 0, running: false };
  plannerLoadState = 'idle';
  noteContentCache = {};
  notePreviewCache = {};
  collaborativeDataCache = {};
  htmlLRUCache = new Map();
  previewLRUCache = new Map();
  collabLRUCache = new Map();

  rootHandle = handle;
  rememberedFolderHandle = handle;
  if (typeof settings !== 'undefined' && settings) {
    if (!settings.folder) settings.folder = {};
    settings.folder.last = handle?.name || '';
  }
  saveLocalSettings();
  if (handle?.path && window.AppBridge?.fs?.setWorkspacePath) {
    try { await window.AppBridge.fs.setWorkspacePath(handle.path); } catch (e) {}
  }
  try {
    // Set up cross-window sync channel
    if (typeof _syncChannel !== 'undefined' && _syncChannel) { try { _syncChannel.close(); } catch(e) {} }
    if (typeof BroadcastChannel !== 'undefined' && typeof _syncChannel !== 'undefined') {
      _syncChannel = new BroadcastChannel('secretary-sync');
      if (typeof handleSyncMessage === 'function') {
        _syncChannel.onmessage = handleSyncMessage;
      }
    }
    
    if (typeof _unsubscribeElectronSync !== 'undefined' && typeof _unsubscribeElectronSync === 'function') {
      try { _unsubscribeElectronSync(); } catch(e) {}
      _unsubscribeElectronSync = null;
    }
    if (window.AppBridge?.sync && typeof handleSyncMessage === 'function') {
      const unsub = window.AppBridge.sync.onMessage((msg) => {
        handleSyncMessage({ data: msg });
      });
      if (typeof _unsubscribeElectronSync !== 'undefined') {
        _unsubscribeElectronSync = unsub;
      }
    }
    const folderNameEl = document.getElementById('folder-name');
    if (folderNameEl) folderNameEl.textContent = handle.name;

    if (typeof StorageAPI !== 'undefined' && StorageAPI && typeof StorageAPI.clearNoteCache === 'function') {
      StorageAPI.clearNoteCache();
    }
    updateStartupProgress(5, t('landing.loadingWorkspace') || 'Loading workspace…');

    // Critical path: settings & storageEngine first, then auto-unlock if firebase, then metadata/manifest.
    try { await loadSettingsFromFolder(); } catch (e) { /* ignore */ }
    if (settings && settings.storageEngine === 'firebase') {
      if (window.StorageAPI) window.StorageAPI.setStorageEngine('firebase');
      if (window.FirebaseSyncService) {
        try {
          await window.FirebaseSyncService.loadPersistedVaultMeta();
          if (settings.rememberPassphrase === true && typeof window.FirebaseSyncService.getSavedPassphrase === 'function') {
            const savedPass = await window.FirebaseSyncService.getSavedPassphrase();
            if (savedPass) {
              await window.FirebaseSyncService.unlockVault(savedPass);
            }
          }
        } catch (e) {
          console.warn('Initial auto-unlock failed:', e);
        }
      }
    }
    await loadManifest();

    // Dedicated note window fast-path: immediately display main screen and load note without blocking on heavy main app assets
    const isFocused = _isFocusedMode || (typeof isFocusedNoteWindow === 'function' && isFocusedNoteWindow()) || (location.hash && (location.hash.includes('note=') || location.hash.includes('path=') || location.hash.includes('preloaded=true')));
    if (isFocused) {
      _isFocusedMode = true;
      document.body.classList.add('focused-note-mode');
      const screenConnect = document.getElementById('screen-connect');
      if (screenConnect) screenConnect.style.display = 'none';
      const screenMain = document.getElementById('screen-main');
      if (screenMain) screenMain.classList.add('active');
      setLandingBusy(false);
      if (location.hash && location.hash.length > 1) {
        await applyHashState();
      }
      return;
    }

    // Standalone Secretary Companion Window fast-path: immediately display chat without full app loading or notes preload
    const isSecretaryCompanion = document.body.classList.contains('secretary-window-standalone') ||
                                 document.body.classList.contains('chat-window-mode') ||
                                 (location.hash && location.hash.includes('chat-window=true'));
    if (isSecretaryCompanion) {
      document.body.classList.add('chat-window-mode');
      const screenConnect = document.getElementById('screen-connect');
      if (screenConnect) screenConnect.style.display = 'none';
      const screenMain = document.getElementById('screen-main');
      if (screenMain) screenMain.classList.add('active');
      setLandingBusy(false);

      // Lightweight index for tasks/context attachments without scanning/preloading note contents
      try { await loadTodosManifest({ nonDoneOnly: true }); } catch (e) {}

      // Restore chat history from workspace folder
      try {
        if (window.AIChatController && typeof window.AIChatController.loadChatHistoryFromFolder === 'function') {
          await window.AIChatController.loadChatHistoryFromFolder();
        }
      } catch (e) {
        console.warn('Failed restoring chat history on mount', e);
      }

      if (window.AIChatController && typeof window.AIChatController.render === 'function') {
        window.AIChatController.render();
      }

      const floating = document.getElementById('floating-secretary-chat');
      if (floating) floating.classList.add('is-open');
      return;
    }

    updateStartupProgress(15, t('landing.loadingWorkspace') || 'Loading workspace…');

    await loadTodosManifest({ nonDoneOnly: true });
    updateStartupProgress(25, t('landing.loadingWorkspace') || 'Loading workspace…');

    if (typeof rebuildCollaborativeAggregates === 'function') rebuildCollaborativeAggregates();
    try { await loadPlanner(); } catch(e) { console.warn('Planner load failed', e); }
    updateStartupProgress(35, t('landing.preloadingNotes') || 'Preloading notes into memory…');

    // Preload ALL notes into memory cache during startup progress bar phase
    if (StorageAPI && typeof StorageAPI.preloadAllNotes === 'function') {
      await StorageAPI.preloadAllNotes((done, total, title) => {
        const pct = 35 + Math.round((done / Math.max(1, total)) * 45);
        const text = `${t('landing.preloadingNotes') || 'Preloading notes…'} (${done}/${total})`;
        updateStartupProgress(pct, text);
      });
    }
    updateStartupProgress(82, t('landing.loadingWorkspace') || 'Loading workspace…');

    // Preload workstream topic memories into memory cache during startup progress bar phase
    try {
      if (typeof preloadAllWorkstreamMemories === 'function') {
        await preloadAllWorkstreamMemories();
      } else if (window.WorkstreamMemoryEngine && typeof window.WorkstreamMemoryEngine.preloadAllWorkstreamMemories === 'function') {
        await window.WorkstreamMemoryEngine.preloadAllWorkstreamMemories();
      }
    } catch (e) {
      console.warn('Failed preloading workstream memories on mount', e);
    }

    // Restore chat history from workspace folder
    try {
      if (window.AIChatController && typeof window.AIChatController.loadChatHistoryFromFolder === 'function') {
        await window.AIChatController.loadChatHistoryFromFolder();
      }
    } catch (e) {
      console.warn('Failed restoring chat history on mount', e);
    }
    try {
      if (typeof ensureColleaguesWorkspaceReady === 'function') {
        await ensureColleaguesWorkspaceReady();
      }
    } catch (e) {
      console.warn('Colleagues load/migration failed', e);
    }
    try { await runFirstStartSetupIfNeeded(); } catch (e) { console.warn('First-run setup skipped', e); }

    updateStartupProgress(100, t('landing.readyProgress') || 'Ready!');
    await new Promise(r => setTimeout(r, 180));

    if (location.hash && location.hash.length > 1) {
      await applyHashState();
    } else {
      await switchTab('planner');
    }
    if (typeof renderPlanner === 'function' && activeTab === 'planner') {
      renderPlanner();
    }

    const sc = document.getElementById('screen-connect');
    if (sc) sc.style.display = 'none';
    const sm = document.getElementById('screen-main');
    if (sm) sm.classList.add('active');
    if (!_isFocusedMode) {
      if (typeof setupGroupNavResize === 'function') setupGroupNavResize();
      if (typeof updateSubRowVisibility === 'function') updateSubRowVisibility();
    }
    if (typeof perfTelemetry !== 'undefined' && perfTelemetry?.startup) {
      perfTelemetry.startup.plannerVisibleMs = Math.round(performance.now() - (perfTelemetry.startup.mountStartedAt || performance.now()));
    }

    // Determine whether this is a brand-new empty workspace folder vs an existing folder
    let isNewWorkspaceFolder = false;
    try {
      const noteCount = (manifest && manifest.length) || 0;
      const todoCount = (typeof todosManifest !== 'undefined' && todosManifest && todosManifest.length) || 0;
      const folderName = (handle && handle.name) ? handle.name : 'default';
      const folderInitKey = 'secretary_folder_init_' + folderName;
      const isFolderInitInStorage = localStorage.getItem(folderInitKey) === 'true';
      const isFolderInitInSettings = settings && settings.folderInitialized === true;

      if (noteCount === 0 && todoCount === 0 && !isFolderInitInStorage && !isFolderInitInSettings) {
        isNewWorkspaceFolder = true;
      }
    } catch (e) {
      console.warn('Error checking if new workspace folder:', e);
    }

    // ensure prefs UI shows current folder
    try { renderPrefs(); } catch(e){}

    toast(t('common.folderLoaded', { folder: handle.name, count: manifest.length, noteWord: word('note', manifest.length) }));

    setStartupState('BOOT_HYDRATING');
    if (typeof perfTelemetry !== 'undefined' && perfTelemetry?.startup) {
      perfTelemetry.startup.hydrationStartedAt = performance.now();
    }
    queueBackgroundHydration(isNewWorkspaceFolder);
  } catch (e) {
    setLandingBusy(false);
    throw e;
  }
  setLandingBusy(false);
}

function queueBackgroundHydration(isNewWorkspaceFolder = false) {
  setTimeout(async () => {
    try {
      await ensureNoteStoragePaths();
      if (typeof ensureTodosManifestFullyLoaded === 'function') {
        await ensureTodosManifestFullyLoaded();
      }
      await hydrateMetadataFromManifestIncremental({ chunkSize: 100 });
      if (typeof indexCollaborativeData === 'function') {
        await indexCollaborativeData({ chunkSize: 60 });
      }
      await migrateFavicons();
    } catch (e) {
      console.warn('Background hydration failed', e);
    } finally {
      try { renderFilterChips(); } catch (e) {}
      try { renderBoard(); } catch (e) {}
      if (activeTab === 'planner') {
        try { renderPlanner(); } catch (e) {}
      }
      if (activeTab === 'chat' && window.AIChatController) {
        try { window.AIChatController.render(); } catch (e) {}
      }
      if (typeof perfTelemetry !== 'undefined' && perfTelemetry?.startup) {
        perfTelemetry.startup.hydrationDurationMs = Math.round(performance.now() - (perfTelemetry.startup.hydrationStartedAt || performance.now()));
      }
      setStartupState('BOOT_READY');

      // Trigger start-of-day onboarding wizard ONLY if a NEW folder is opened (or if folder is unknown/uninitialized)
      setTimeout(() => {
        try {
          const folderName = (rootHandle && rootHandle.name) ? rootHandle.name : 'default';
          const isFolderInitInStorage = localStorage.getItem('secretary_folder_init_' + folderName) === 'true';
          const isFolderInitInSettings = settings && settings.folderInitialized === true;
          const isFolderUnknownOrNew = isNewWorkspaceFolder || !isFolderInitInStorage || !isFolderInitInSettings || !(settings && settings.firstRunSetupDone);

          if (isFolderUnknownOrNew) {
            try { localStorage.setItem('secretary_folder_init_' + folderName, 'true'); } catch (ex) {}
            if (typeof settings === 'object' && settings) {
              settings.folderInitialized = true;
              if (typeof saveFolderSettingsDebounced === 'function') saveFolderSettingsDebounced();
            }
            if (typeof SetupWizardController !== 'undefined') {
              SetupWizardController.open();
            } else if (typeof TutorialController !== 'undefined') {
              TutorialController.startDayOnboarding();
            }
          }

          // Check and handle storageEngine mode & startup prompts
          if (typeof settings === 'object' && settings) {
            if (settings.storageEngine === 'firebase') {
              if (window.StorageAPI) window.StorageAPI.setStorageEngine('firebase');
              if (window.FirebaseSyncService && !window.FirebaseSyncService.state.isUnlocked) {
                window.FirebaseSyncService.loadPersistedVaultMeta().then(async () => {
                  let autoUnlocked = false;
                  if (typeof window.FirebaseSyncService.purgeLegacyPassphraseStorage === 'function') {
                    window.FirebaseSyncService.purgeLegacyPassphraseStorage();
                  }
                  if (settings.rememberPassphrase === true && typeof window.FirebaseSyncService.getSavedPassphrase === 'function') {
                    try {
                      const savedPass = await window.FirebaseSyncService.getSavedPassphrase();
                      if (savedPass) {
                        const success = await window.FirebaseSyncService.unlockVault(savedPass);
                        if (success) {
                          autoUnlocked = true;
                          if (typeof updateCloudSyncUI === 'function') updateCloudSyncUI();
                          if (typeof renderBoard === 'function') renderBoard();
                        } else {
                          // Passphrase was incorrect or changed on another device: clear stale saved passphrase
                          await window.FirebaseSyncService.clearSavedPassphrase();
                        }
                      }
                    } catch (e) {
                      console.warn('Auto-unlock with saved passphrase failed:', e);
                    }
                  }
                  if (!autoUnlocked) {
                    window.FirebaseSyncService.state.status = window.FirebaseSyncService.STATUS.LOCKED;
                    if (typeof updateCloudSyncUI === 'function') updateCloudSyncUI();
                    setTimeout(() => {
                      if (typeof openModal === 'function') openModal('modal-cloud-sync-unlock');
                    }, 500);
                  }
                });
              }
            } else if (!settings.disableCloudSyncPrompt && !settings.storageEngine && !isNewWorkspaceFolder) {
              setTimeout(() => {
                if (typeof openModal === 'function') openModal('modal-cloud-sync-setup');
              }, 600);
            }
          }
        } catch (e) {
          console.warn('Onboarding trigger failed:', e);
        }
      }, 400);
    }
  }, 0);
}

/** On page load: check IDB for a saved handle and surface the Resume button. */
async function checkSavedFolder() {
  if (window.initTranslationsPromise) {
    await window.initTranslationsPromise;
  }
  if (typeof applyLocalizedUI === 'function') {
    applyLocalizedUI();
  }
  if (window.AppBridge?.fs && typeof window.AppBridge.fs.getWorkspacePath === 'function') {
    try {
      const ws = await window.AppBridge.fs.getWorkspacePath();
      if (ws) {
        await mountFolder(ws);
        return;
      }
    } catch (e) {
      console.warn('Failed getting workspace path', e);
    }
  }
  if (settings && settings.storageEngine === 'firebase') {
    await mountFolder({ name: 'Firebase Cloud Vault' });
    return;
  }
  let handle = null;
  try {
    handle = await loadHandleIDB();
  } catch (e) {
    setLandingBusy(false);
    return;
  }
  if (!handle) {
    setLandingBusy(false);
    return;
  }

  rememberedFolderHandle = handle;
  settings.folder.last = handle.name;
  saveLocalSettings();

  // Try to auto-mount if permission already survived the refresh or if running in Electron / focused note mode.
  try {
    const isElectronEnv = !!(window.AppBridge?.isElectron);
    let perm = 'prompt';
    if (typeof handle.queryPermission === 'function') perm = await handle.queryPermission({ mode: 'readwrite' });
    const isCompanion = document.body.classList.contains('secretary-window-standalone') ||
                        document.body.classList.contains('chat-window-mode') ||
                        (location.hash && location.hash.includes('chat-window=true'));
    if (perm === 'granted' || isElectronEnv || _isFocusedMode || isCompanion) {
      await saveHandleIDB(handle);
      await mountFolder(handle);
      return;
    }
  } catch (e) {
    console.warn('Auto-resume failed', e);
  }

  setLandingBusy(false);
  // fallback: show resume button — permission will be requested on click (requires gesture)
  const resumeWrap = document.getElementById('landing-resume-wrap');
  if (resumeWrap) resumeWrap.style.display = '';
  const btn = document.getElementById('btn-resume-folder');
  const btnLabel = document.getElementById('btn-resume-folder-label');
  if (btnLabel) btnLabel.textContent = t('landing.resumeAction') || t('landing.resume');
  const btnName = document.getElementById('btn-resume-folder-name');
  if (btnName) btnName.textContent = handle.name;
  if (btn) btn.title = t('landing.resumeTitle');
  const divider = document.getElementById('landing-divider');
  if (divider) divider.style.display = '';
  const btnOpen = document.getElementById('btn-open-folder');
  if (btnOpen) {
    btnOpen.classList.remove('landing-btn-open-hero');
    const openText = document.getElementById('btn-open-folder-text');
    if (openText) openText.textContent = t('landing.openDifferent') || t('landing.open');
  }

  btn.onclick = async () => {
    try {
      let perm = 'prompt';
      if (typeof handle.requestPermission === 'function') {
        perm = await handle.requestPermission({ mode: 'readwrite' });
      }
      if (perm === 'granted') {
        await saveHandleIDB(handle);
        await mountFolder(handle);
        return;
      }
    } catch (e) {
      if (e.name !== 'AbortError') console.warn('Resume permission request failed', e);
    }

    try {
      const pickedHandle = await showSecretaryFolderPicker(handle);
      await saveHandleIDB(pickedHandle);
      rememberedFolderHandle = pickedHandle;
      settings.folder.last = pickedHandle.name;
      saveLocalSettings();
      await mountFolder(pickedHandle);
    } catch (e) {
      if (e.name !== 'AbortError') toast(t('common.couldNotResume', { message: e.message }), true);
    }
  };
}

document.addEventListener('click', async e => {
  const btnOpenFolder = e.target?.closest ? e.target.closest('#btn-open-folder') : null;
  if (!btnOpenFolder) return;
  if (typeof window.showDirectoryPicker === 'undefined' && !window.AppBridge?.fs?.hasNativeFS()) {
    if (typeof window.copyWebAppUrl === 'function') {
      window.copyWebAppUrl(btnOpenFolder);
    } else if (typeof toast === 'function') {
      toast(typeof t === 'function' ? t('landing.chromeOnly') : 'Direct disk storage requires Chrome, Edge, or Desktop App.', true);
    }
    return;
  }
  try {
    const handle = await showSecretaryFolderPicker();
    await saveHandleIDB(handle);   // remember for next time
    rememberedFolderHandle = handle;
    settings.folder.last = handle.name;
    saveLocalSettings();
    await mountFolder(handle);
  } catch (err) {
    if (err.name !== 'AbortError') toast(t('common.couldNotOpenFolder', { message: err.message }), true);
  }
});

// Keyboard shortcuts
// ═══ Keyboard & Resize ═══
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    if (editMode && typeof saveCurrentNote === 'function') saveCurrentNote();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === ',') {
    e.preventDefault();
    if (typeof switchTab === 'function') switchTab('prefs');
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'w' || e.key === 'W')) {
    const isStandaloneChild = _isFocusedMode ||
      document.body.classList.contains('chat-window-mode') ||
      document.body.classList.contains('secretary-window-standalone') ||
      document.body.classList.contains('note-window-standalone') ||
      document.body.classList.contains('focus-pip-mode');

    if (isStandaloneChild) {
      e.preventDefault();
      if (_isFocusedMode && typeof closeNoteOverlay === 'function') {
        closeNoteOverlay();
      } else if (window.AppBridge?.windowControls?.close) {
        window.AppBridge.windowControls.close();
      } else if (window.electronAPI?.closeWindow) {
        window.electronAPI.closeWindow();
      }
      return;
    }
  }
  if (e.key === 'Escape') {
    if (typeof getAiActionState === 'function' && getAiActionState() === 'refactoring' && typeof RefactorModalController !== 'undefined') {
      RefactorModalController.cancelRefactor();
      return;
    }
    const dialogOverlays = Array.from(document.querySelectorAll('.dialog-overlay'));
    if (dialogOverlays.length > 0) {
      const topDialog = dialogOverlays[dialogOverlays.length - 1];
      topDialog.remove();
      return;
    }
    const nestedOverlay = document.getElementById('nested-note-overlay');
    if (nestedOverlay && nestedOverlay.style.display !== 'none') { closeNestedNoteOverlay(); return; }
    const matrixPickerOverlay = document.getElementById('todo-matrix-picker-overlay');
    if (matrixPickerOverlay && matrixPickerOverlay.style.display !== 'none') {
      if (typeof closeSingleTodoMatrixPicker === 'function') closeSingleTodoMatrixPicker();
      return;
    }
    const todoOverlay = document.getElementById('todo-edit-overlay');
    if (todoOverlay && (todoOverlay.style.display === 'flex' || todoOverlay.style.display === 'block' || todoOverlay.classList.contains('active'))) {
      if (typeof requestCloseTodoOverlay === 'function') requestCloseTodoOverlay();
      else if (typeof closeTodoOverlay === 'function') closeTodoOverlay();
      return;
    }
    const activeModals = Array.from(document.querySelectorAll('.modal-overlay.active'));
    const topModal = activeModals[activeModals.length - 1];
    if (topModal) {
      if (typeof _requestCloseModalOverlay === 'function') {
        _requestCloseModalOverlay(topModal);
      } else {
        topModal.classList.remove('active');
      }
      return;
    }
    const overlay = document.getElementById('note-edit-overlay');
    if (overlay && overlay.classList.contains('active') && overlay.style.display !== 'none' && (typeof activeTab === 'undefined' || activeTab !== 'daily-review' || typeof DailyReviewController === 'undefined' || !DailyReviewController.currentStep)) {
      if (typeof requestCloseNoteOverlay === 'function') requestCloseNoteOverlay();
      else if (typeof closeNoteOverlay === 'function') closeNoteOverlay();
      return;
    }
    const drOverlay = document.getElementById('daily-review-overlay');
    if (drOverlay && drOverlay.style.display !== 'none' && typeof activeTab !== 'undefined' && activeTab === 'daily-review' && typeof DailyReviewController !== 'undefined' && DailyReviewController.currentStep > 0) {
      DailyReviewController.confirmQuit();
      return;
    }
    const setupStep = document.getElementById('landing-step-setup');
    const connectCard = document.getElementById('screen-connect-card');
    if (setupStep && setupStep.style.display !== 'none' && connectCard && connectCard.classList.contains('is-setup-step')) {
      if (typeof showLandingStep === 'function') {
        showLandingStep('welcome');
        return;
      }
    }
  }

  // Focus search box shortcut
  const activeEl = document.activeElement;
  const isEditing = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable);
  if (!isEditing) {
    if (e.key === '/' || ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'k'))) {
      const searchInput = document.getElementById('note-search');
      if (searchInput && searchInput.offsetParent !== null) {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
      }
    }
  }
});

// Check for a remembered folder on startup
loadLocalSettings();
applySettings();
bindResponsiveLayoutHooks();
checkPendingEmailLinkAuth();

function copyWebAppUrl(btn) {
  const url = window.location.href.split('#')[0];
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(url).then(() => {
      const origText = btn.innerHTML;
      const tCopied = typeof t === 'function' ? t('landing.urlCopied') : 'Link Copied!';
      btn.innerHTML = `<span>${escH(tCopied)}</span>`;
      btn.classList.add('btn-success');
      setTimeout(() => {
        btn.innerHTML = origText;
        btn.classList.remove('btn-success');
      }, 2500);
    }).catch(() => {});
  }
}
window.copyWebAppUrl = copyWebAppUrl;

function openCustomFirebaseSetupFromLanding() {
  if (typeof openModal === 'function') {
    openModal('modal-cloud-sync-setup');
  } else if (typeof window.openModal === 'function') {
    window.openModal('modal-cloud-sync-setup');
  }
  if (typeof switchSyncSetupTab === 'function') switchSyncSetupTab('signup');
  const body = document.getElementById('sync-custom-firebase-body');
  if (body) body.style.display = 'block';
  if (typeof updateCustomFirebaseStatusUI === 'function') updateCustomFirebaseStatusUI();
  const textarea = document.getElementById('sync-custom-firebase-json');
  if (textarea) setTimeout(() => textarea.focus(), 150);
}
window.openCustomFirebaseSetupFromLanding = openCustomFirebaseSetupFromLanding;

function openManagedFirebaseSetupFromLanding() {
  if (typeof openModal === 'function') {
    openModal('modal-cloud-sync-setup');
  } else if (typeof window.openModal === 'function') {
    window.openModal('modal-cloud-sync-setup');
  }
  if (typeof switchSyncSetupTab === 'function') switchSyncSetupTab('signup');
  const body = document.getElementById('sync-custom-firebase-body');
  if (body) body.style.display = 'none';
  if (typeof updateCustomFirebaseStatusUI === 'function') updateCustomFirebaseStatusUI();
  const emailInput = document.getElementById('sync-setup-email');
  if (emailInput) setTimeout(() => emailInput.focus(), 150);
}
window.openManagedFirebaseSetupFromLanding = openManagedFirebaseSetupFromLanding;

function renderBrowserCompatibilityOptions() {
  const screenConnect = document.getElementById('screen-connect');
  if (!screenConnect) return;

  // Stop loading state
  screenConnect.classList.remove('loading');
  screenConnect.removeAttribute('aria-busy');
  const status = document.getElementById('connect-status-hint');
  if (status) status.textContent = '';

  const existing = document.getElementById('browser-compatibility-options');
  if (existing) existing.remove();

  const container = document.createElement('div');
  container.id = 'browser-compatibility-options';
  container.className = 'browser-compat-card';

  const tTitle = typeof t === 'function' ? t('landing.browserCompatTitle') : 'Choose Your Storage Option';
  const tDesc = typeof t === 'function' ? t('landing.browserCompatDesc') : 'Your browser does not support the File System Access API for local folder access. Choose one of the 3 options below to get started with Secretary:';

  const tA_Title = typeof t === 'function' ? t('landing.optionChromeTitle') : 'Google Chrome / Desktop App';
  const tA_Desc = typeof t === 'function' ? t('landing.optionChromeDesc') : 'Free local-first disk storage. Run Secretary in Chrome, Edge, Brave, or the Desktop App for direct folder reading & writing with 100% privacy.';
  const tA_Btn = typeof t === 'function' ? t('landing.optionChromeBtn') : 'Copy Web App Link';

  const tB_Title = typeof t === 'function' ? t('landing.optionOwnFirebaseTitle') : 'Connect Own Firebase';
  const tB_Desc = typeof t === 'function' ? t('landing.optionOwnFirebaseDesc') : '100% Free on Google\'s Spark tier. Bring your own Firebase project with client-side AES-256-GCM Zero-Knowledge encryption.';
  const tB_Btn = typeof t === 'function' ? t('landing.optionOwnFirebaseBtn') : 'Connect Own Firebase';

  const tC_Title = typeof t === 'function' ? t('landing.optionManagedFirebaseTitle') : 'Etienne\'s Managed Cloud Vault';
  const tC_Desc = typeof t === 'function' ? t('landing.optionManagedFirebaseDesc') : 'Turnkey managed cloud infrastructure with Zero-Knowledge E2EE encryption, automated sync & backups (Paid subscription service).';
  const tC_Btn = typeof t === 'function' ? t('landing.optionManagedFirebaseBtn') : 'Connect Cloud Vault';

  const badgeFree = typeof t === 'function' ? t('landing.badgeFree') : 'Free';
  const badgePaid = typeof t === 'function' ? t('landing.badgeFreePreview') : 'Free Preview';

  container.innerHTML = `
    <div class="browser-compat-header">
      <div class="browser-compat-icon">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      </div>
      <div>
        <h3 class="browser-compat-title">${escH(tTitle)}</h3>
        <p class="browser-compat-desc">${escH(tDesc)}</p>
      </div>
    </div>

    <div class="browser-options-grid">
      <!-- Option A: Chrome / Desktop -->
      <div class="browser-option-item" id="landing-option-chrome">
        <div class="browser-option-header">
          <h4 class="browser-option-heading">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
            <span>A) ${escH(tA_Title)}</span>
          </h4>
          <span class="browser-option-badge badge-free">${escH(badgeFree)} · Local Disk</span>
        </div>
        <p class="browser-option-text">${escH(tA_Desc)}</p>
        <div class="browser-option-action">
          <button type="button" class="landing-card-btn landing-card-btn-primary" id="btn-copy-chrome-url" onclick="window.copyWebAppUrl(this)" title="Copy the web app link to clipboard to open in Chrome">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            <span>${escH(tA_Btn)}</span>
          </button>
        </div>
      </div>

      <!-- Option B: Own Firebase (Free BYO) -->
      <div class="browser-option-item" id="landing-option-own-firebase">
        <div class="browser-option-header">
          <h4 class="browser-option-heading">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            <span>B) ${escH(tB_Title)}</span>
          </h4>
          <span class="browser-option-badge badge-free">${escH(badgeFree)} · BYO Firebase · E2EE</span>
        </div>
        <p class="browser-option-text">${escH(tB_Desc)}</p>
        <div class="browser-option-action">
          <button type="button" class="landing-card-btn landing-card-btn-own-firebase" id="btn-landing-own-firebase" onclick="window.openCustomFirebaseSetupFromLanding()" title="Connect your own free Google Firebase project">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
            <span>${escH(tB_Btn)}</span>
          </button>
        </div>
      </div>

      <!-- Option C: Etienne's Managed Firebase (Free Preview) -->
      <div class="browser-option-item" id="landing-option-managed-firebase">
        <div class="browser-option-header">
          <h4 class="browser-option-heading">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>
            <span>C) ${escH(tC_Title)}</span>
          </h4>
          <span class="browser-option-badge badge-paid">${escH(badgePaid)}</span>
        </div>
        <p class="browser-option-text">${escH(tC_Desc)}</p>
        <div class="browser-option-action">
          <button type="button" class="landing-card-btn landing-card-btn-cloud" id="btn-landing-managed-firebase" onclick="window.openManagedFirebaseSetupFromLanding()" title="Start using Etienne's managed cloud vault with end-to-end encryption">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            <span>${escH(tC_Btn)}</span>
          </button>
        </div>
      </div>
    </div>
  `;

  const card = document.getElementById('screen-connect-card') || screenConnect;
  if (card && card.classList) card.classList.add('has-browser-options');
  const actionsContainer = card.querySelector ? card.querySelector('.landing-actions-container') : null;
  if (actionsContainer && actionsContainer.parentNode) {
    actionsContainer.parentNode.insertBefore(container, actionsContainer);
  } else if (card) {
    card.appendChild(container);
  }

  // Hide local folder pick buttons
  const btnOpen = document.getElementById('btn-open-folder');
  if (btnOpen) btnOpen.style.display = 'none';
  const btnResume = document.getElementById('btn-resume-folder');
  if (btnResume) btnResume.style.display = 'none';
  const divider = document.getElementById('landing-divider');
  if (divider) divider.style.display = 'none';
  const cloudLink = document.getElementById('landing-cloud-link-wrap');
  if (cloudLink) cloudLink.style.display = 'none';
}
window.renderBrowserCompatibilityOptions = renderBrowserCompatibilityOptions;

function showLandingStep(step) {
  const welcomeStep = document.getElementById('landing-step-welcome');
  const setupStep = document.getElementById('landing-step-setup');
  const btnBack = document.getElementById('btn-landing-back');
  const card = document.getElementById('screen-connect-card');

  if (step === 'setup') {
    if (welcomeStep) welcomeStep.style.display = 'none';
    if (setupStep) setupStep.style.display = 'flex';
    if (btnBack) btnBack.style.display = 'inline-flex';
    if (card) {
      card.classList.add('is-setup-step');
      if (card.classList.contains('has-browser-options')) {
        const localCard = document.getElementById('landing-card-local') || document.querySelector('.landing-storage-card-local');
        if (localCard) {
          const badge = localCard.querySelector('.landing-card-badge');
          if (badge) {
            badge.textContent = typeof t === 'function' ? t('landing.badgeChromiumDesktop') : 'Chromium / Desktop';
            badge.className = 'landing-card-badge';
          }
          const title = localCard.querySelector('h3');
          if (title) title.textContent = typeof t === 'function' ? t('landing.optionChromeTitle') : 'Google Chrome / Desktop App';
          const desc = localCard.querySelector('p');
          if (desc) desc.textContent = typeof t === 'function' ? t('landing.optionChromeDesc') : 'Free local-first disk storage. Run Secretary in Chrome, Edge, Brave, or Desktop App for direct folder reading & writing.';
          const btnText = document.getElementById('btn-open-folder-text');
          if (btnText) btnText.textContent = typeof t === 'function' ? t('landing.optionChromeBtn') : 'Copy Web App Link';
        }
      }
    }
  } else {
    if (welcomeStep) welcomeStep.style.display = 'flex';
    if (setupStep) setupStep.style.display = 'none';
    if (btnBack) btnBack.style.display = 'none';
    if (card) {
      card.classList.remove('is-setup-step');
    }
  }
}
window.showLandingStep = showLandingStep;

function changeLandingLanguage(langCode) {
  const normalized = normalizeLanguageCode(langCode);
  if (typeof setLanguage === 'function') {
    setLanguage(normalized);
  } else {
    appLanguage = normalized;
    if (typeof applyLocalizedUI === 'function') applyLocalizedUI();
  }
  if (typeof settings !== 'undefined') {
    settings.language = normalized;
    if (typeof saveLocalSettings === 'function') saveLocalSettings();
  }
}
window.changeLandingLanguage = changeLandingLanguage;

function createVirtualDirectoryHandle(rootName, initialFiles = {}) {
  const fileStore = new Map();
  for (const [filePath, content] of Object.entries(initialFiles)) {
    fileStore.set(filePath.replace(/^\/+/, ''), typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }

  function makeFileHandle(fullPath, fileName) {
    return {
      name: fileName,
      kind: 'file',
      async getFile() {
        const content = fileStore.get(fullPath) || '';
        return {
          name: fileName,
          size: content.length,
          lastModified: Date.now(),
          type: fileName.endsWith('.json') ? 'application/json' : 'text/html',
          async text() {
            return fileStore.get(fullPath) || '';
          }
        };
      },
      async createWritable() {
        let buffer = '';
        return {
          async write(chunk) {
            if (typeof chunk === 'string') {
              buffer += chunk;
            } else if (chunk && typeof chunk.text === 'function') {
              buffer += await chunk.text();
            } else {
              buffer += String(chunk || '');
            }
          },
          async close() {
            fileStore.set(fullPath, buffer);
          },
          async abort() {}
        };
      }
    };
  }

  function makeDirHandle(dirPath, dirName) {
    const prefix = dirPath ? `${dirPath}/` : '';
    return {
      name: dirName,
      kind: 'directory',
      async getDirectoryHandle(subName, options = {}) {
        const subPath = prefix ? `${prefix}${subName}` : subName;
        return makeDirHandle(subPath, subName);
      },
      async getFileHandle(fileName, options = {}) {
        const fullPath = prefix ? `${prefix}${fileName}` : fileName;
        if (!options.create && !fileStore.has(fullPath)) {
          const err = new Error(`File not found: ${fullPath}`);
          err.name = 'NotFoundError';
          throw err;
        }
        if (options.create && !fileStore.has(fullPath)) {
          fileStore.set(fullPath, '');
        }
        return makeFileHandle(fullPath, fileName);
      },
      async removeEntry(entryName) {
        const targetPath = prefix ? `${prefix}${entryName}` : entryName;
        fileStore.delete(targetPath);
        for (const k of Array.from(fileStore.keys())) {
          if (k.startsWith(`${targetPath}/`)) {
            fileStore.delete(k);
          }
        }
      },
      async *entries() {
        const seen = new Set();
        for (const k of fileStore.keys()) {
          if (prefix && !k.startsWith(prefix)) continue;
          const rest = prefix ? k.slice(prefix.length) : k;
          const parts = rest.split('/');
          const childName = parts[0];
          if (!seen.has(childName)) {
            seen.add(childName);
            if (parts.length > 1) {
              yield [childName, makeDirHandle(prefix ? `${prefix}${childName}` : childName, childName)];
            } else {
              yield [childName, makeFileHandle(k, childName)];
            }
          }
        }
      },
      async *values() {
        for await (const [, handle] of this.entries()) {
          yield handle;
        }
      }
    };
  }

  return makeDirHandle('', rootName);
}
window.createVirtualDirectoryHandle = createVirtualDirectoryHandle;

function createDemoVirtualDirectoryHandle() {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 is Sunday, 1 is Monday, ..., 6 is Saturday
  const diffToMonday = (dayOfWeek === 0 ? -6 : 1 - dayOfWeek);
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToMonday);

  const getWeekDateStr = (offsetDays) => {
    const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + offsetDays);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const getWeekDateTimestamp = (offsetDays, hour = 9, minute = 0) => {
    const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + offsetDays, hour, minute, 0);
    return d.getTime();
  };

  const dateMon = getWeekDateStr(0);
  const dateTue = getWeekDateStr(1);
  const dateWed = getWeekDateStr(2);
  const dateThu = getWeekDateStr(3);
  const dateFri = getWeekDateStr(4);

  const initialFiles = {
    'settings.json': {
      version: 1,
      username: 'Alex Demo',
      theme: 'system',
      ui: {
        workStartTime: '08:30',
        workEndTime: '18:30',
        workingDays: [1, 2, 3, 4, 5],
        defaultPlannerDuration: 30,
        laneSort: 'date',
        weekCutoffWeeks: 8
      },
      collaborators: [
        { id: 'collab-1', name: 'Etienne Beltzung', role: 'Lead Architect', color: '#4f46e5' },
        { id: 'collab-2', name: 'Sarah Connor', role: 'Security Engineer', color: '#059669' },
        { id: 'collab-3', name: 'Alex Martin', role: 'Product Designer', color: '#d97706' }
      ],
      workstreams: [
        { id: 'ws-1', name: 'Product Launch', color: '#4f46e5', status: 'active' },
        { id: 'ws-2', name: 'Architecture & Security', color: '#059669', status: 'active' },
        { id: 'ws-3', name: 'Quality & Bug Fixes', color: '#ef4444', status: 'active' },
        { id: 'ws-4', name: 'Personal / Strategy', color: '#d97706', status: 'active' }
      ],
      firstRunSetupDone: true
    },
    'notes/manifest.json': [
      {
        id: 'welcome-demo-note',
        path: 'notes/welcome-demo-note.html',
        title: typeof t === 'function' ? t('demo.welcomeNoteTitle') : 'Welcome to Secretary',
        date: dateMon,
        updatedAt: getWeekDateTimestamp(0, 9, 30),
        tags: ['welcome', 'onboarding', 'productivity'],
        workstream: 'Product Launch',
        pinned: true,
        favorite: true
      },
      {
        id: 'strategy-roadmap-note',
        path: 'notes/strategy-roadmap-note.html',
        title: typeof t === 'function' ? t('demo.strategyNoteTitle') : '2026 Product Strategy & Roadmap',
        date: dateMon,
        updatedAt: getWeekDateTimestamp(0, 11, 0),
        tags: ['strategy', 'roadmap', 'features'],
        workstream: 'Product Launch',
        pinned: true,
        favorite: true
      },
      {
        id: 'bug-tracking-note',
        path: 'notes/bug-tracking-note.html',
        title: typeof t === 'function' ? t('demo.bugTrackingNoteTitle') : 'Active Bug Tracker & Resolution Log',
        date: dateTue,
        updatedAt: getWeekDateTimestamp(1, 14, 15),
        tags: ['bugs', 'quality', 'triage'],
        workstream: 'Quality & Bug Fixes',
        pinned: false,
        favorite: true
      },
      {
        id: 'weekly-sync-notes',
        path: 'notes/weekly-sync-notes.html',
        title: typeof t === 'function' ? t('demo.syncNoteTitle') : 'Weekly Team Synchronization',
        date: dateWed,
        updatedAt: getWeekDateTimestamp(2, 10, 0),
        tags: ['team', 'meeting', 'sync'],
        workstream: 'Architecture & Security',
        pinned: false,
        favorite: false
      },
      {
        id: 'security-zero-knowledge',
        path: 'notes/security-zero-knowledge.html',
        title: typeof t === 'function' ? t('demo.securityNoteTitle') : 'Zero-Knowledge Encryption Architecture',
        date: dateThu,
        updatedAt: getWeekDateTimestamp(3, 16, 45),
        tags: ['security', 'crypto', 'e2ee'],
        workstream: 'Architecture & Security',
        pinned: false,
        favorite: false
      }
    ],
    'notes/welcome-demo-note.html': `<h1>Welcome to Secretary</h1><p>Secretary is your <strong>private, local-first personal productivity workspace</strong>. It seamlessly brings together note taking, task management (Kanban), weekly planning, retrospective summaries, and team collaboration.</p><h2>Key Features</h2><ul><li><strong>100% Private & Local-First:</strong> Direct file reading and writing on your machine with zero tracking.</li><li><strong>Zero-Knowledge E2EE Cloud Sync:</strong> Optional end-to-end encrypted backup and cross-device synchronization with AES-256-GCM.</li><li><strong>Integrated Planner & Daily Review:</strong> Schedule work blocks, track focus, and maintain clean daily momentum.</li></ul>`,
    'notes/strategy-roadmap-note.html': `<h1>2026 Product Strategy & Roadmap</h1><p>Objectives and key initiatives for Secretary core development and ecosystem expansions.</p><h2>Upcoming Milestones & Roadmap</h2><ul><li>[x] <strong>Client-side AES-256-GCM Zero-Knowledge Sync:</strong> End-to-end encrypted vault with PBKDF2 key derivation.</li><li>[x] <strong>Multi-Platform Compatibility:</strong> Unified experience across Web, Desktop (Electron), and Chrome extension environments.</li><li>[x] <strong>Dynamic Startup Flow:</strong> Dedicated 3-option storage onboarding (Local Folder, Own Firebase Spark Tier, Managed Cloud Vault).</li><li>[ ] <strong>Local LLM & Context Engine:</strong> Private on-device embeddings and context retrieval for interactive note synthesis.</li><li>[ ] <strong>Multi-Device Conflict-Free CRDTs:</strong> Real-time peer-to-peer sync with automated field-level conflict resolution.</li></ul>`,
    'notes/bug-tracking-note.html': `<h1>Active Bug Tracker & Resolution Log</h1><p>Continuous quality monitoring and resolved bug reports across Secretary releases.</p><h2>Resolved Bugs & Regressions</h2><ul><li>[x] <strong>Fixed: Startup Cloud Vault Button:</strong> Fixed unclickable connection trigger on web environments by binding explicit modal opening handlers.</li><li>[x] <strong>Fixed: Modal Viewport Overflow:</strong> Added dynamic max-height and custom scrollbars to prevent action buttons from clipping on laptop screens.</li><li>[x] <strong>Fixed: Planner Week Parity:</strong> Implemented dynamic current-week date calculations so the planner is always pre-populated for active week dates.</li><li>[x] <strong>Fixed: 15-Language Key Parity:</strong> Validated 100% key completeness and zero missing strings across all European languages.</li></ul><h2>Quality Metrics</h2><p>Target: 0 unhandled exceptions, \u226599% unit test coverage across all storage and planner engines.</p>`,
    'notes/weekly-sync-notes.html': `<h1>Weekly Team Synchronization</h1><p><strong>Attendees:</strong> Alex Martin, Etienne Beltzung, Sarah Connor</p><h2>Discussion Points</h2><ul><li>Reviewed UX improvements on the startup storage selection screen.</li><li>Verified that modal scrollbars and dialog action buttons remain responsive across all screen dimensions.</li><li>Confirmed full internationalization parity across all 15 supported European languages.</li></ul>`,
    'notes/security-zero-knowledge.html': `<h1>Zero-Knowledge Encryption Architecture</h1><p>Every note and metadata attribute is encrypted locally on your device with your master passphrase using AES-256-GCM and PBKDF2 before ever touching the cloud.</p><p>Neither Secretary nor any cloud provider has access to your plaintext data or encryption keys.</p>`,
    'collaborators.json': [
      { id: 'collab-1', name: 'Etienne Beltzung', role: 'Lead Architect', color: '#4f46e5' },
      { id: 'collab-2', name: 'Sarah Connor', role: 'Security Engineer', color: '#059669' },
      { id: 'collab-3', name: 'Alex Martin', role: 'Product Designer', color: '#d97706' }
    ],
    'workstreams.json': [
      { id: 'ws-1', name: 'Product Launch', color: '#4f46e5', status: 'active' },
      { id: 'ws-2', name: 'Architecture & Security', color: '#059669', status: 'active' },
      { id: 'ws-3', name: 'Quality & Bug Fixes', color: '#ef4444', status: 'active' },
      { id: 'ws-4', name: 'Personal / Strategy', color: '#d97706', status: 'active' }
    ],
    'decisions.json': [
      { id: 'dec-1', title: typeof t === 'function' ? t('demo.decEncryptionTitle') : 'Zero-Knowledge Encryption as Core Cloud Sync Engine', date: dateMon, status: 'decided', workstream: 'Architecture & Security' },
      { id: 'dec-2', title: typeof t === 'function' ? t('demo.decLanguageTitle') : '15 European Language Parity Guarantee', date: dateTue, status: 'decided', workstream: 'Product Launch' },
      { id: 'dec-3', title: typeof t === 'function' ? t('demo.decBugResolutionTitle') : 'Zero Unhandled Exceptions Policy & Strict Regression Testing', date: dateWed, status: 'decided', workstream: 'Quality & Bug Fixes' }
    ],
    'todos.json': [
      { id: 'todo-1', text: 'Review encryption specification and key rotation test cases', col: 'todo', priority: 'high', workstream: 'Architecture & Security', created: getWeekDateTimestamp(0, 8, 30) },
      { id: 'todo-2', text: 'Fix modal viewport scrollbar overflow on laptop screens', col: 'done', priority: 'high', workstream: 'Quality & Bug Fixes', created: getWeekDateTimestamp(1, 9, 0) },
      { id: 'todo-3', text: 'Verify startup cloud vault connection button on web build', col: 'done', priority: 'high', workstream: 'Quality & Bug Fixes', created: getWeekDateTimestamp(1, 10, 30) },
      { id: 'todo-4', text: 'Finalize Q4 roadmap presentation for team sync', col: 'in-progress', priority: 'medium', workstream: 'Product Launch', created: getWeekDateTimestamp(2, 9, 15) },
      { id: 'todo-5', text: 'Benchmark local LLM context retrieval latency', col: 'todo', priority: 'medium', workstream: 'Product Launch', created: getWeekDateTimestamp(3, 11, 0) },
      { id: 'todo-6', text: 'Test interactive demo workspace in multiple browsers', col: 'done', priority: 'low', workstream: 'Personal / Strategy', created: getWeekDateTimestamp(4, 14, 0) }
    ],
    'planner.json': {
      events: [
        { id: 'plan-1', title: typeof t === 'function' ? t('demo.planSyncTitle') : 'Team Synchronization', date: dateMon, startTime: '09:00', endTime: '10:00', duration: 60, type: 'sync', workstream: 'Architecture & Security', collaborator: 'collab-1' },
        { id: 'plan-2', title: typeof t === 'function' ? t('demo.planWorkTitle') : 'Deep Work - Architecture', date: dateMon, startTime: '10:30', endTime: '12:00', duration: 90, type: 'work', workstream: 'Architecture & Security' },
        { id: 'plan-3', title: typeof t === 'function' ? t('demo.planPersonalTitle') : 'Lunch & Walk', date: dateMon, startTime: '12:30', endTime: '13:30', duration: 60, type: 'personal' },
        { id: 'plan-4', title: typeof t === 'function' ? t('demo.planBugTriageTitle') : 'Bug Triage & Quality Review', date: dateTue, startTime: '09:30', endTime: '10:30', duration: 60, type: 'work', workstream: 'Quality & Bug Fixes', collaborator: 'collab-2' },
        { id: 'plan-5', title: typeof t === 'function' ? t('demo.planCallTitle') : 'Product Review Call', date: dateTue, startTime: '14:00', endTime: '15:00', duration: 60, type: 'call', workstream: 'Product Launch', collaborator: 'collab-3' },
        { id: 'plan-6', title: typeof t === 'function' ? t('demo.planRoadmapWorkTitle') : 'Roadmap Planning & Milestones', date: dateWed, startTime: '10:00', endTime: '11:30', duration: 90, type: 'work', workstream: 'Product Launch' },
        { id: 'plan-7', title: typeof t === 'function' ? t('demo.planTodoSessionTitle') : 'Todo Focus - Bug Fixes Verification', date: dateWed, startTime: '15:00', endTime: '16:00', duration: 60, type: 'todo', workstream: 'Quality & Bug Fixes' },
        { id: 'plan-8', title: typeof t === 'function' ? t('demo.planSecurityAuditTitle') : 'Security & Zero-Knowledge Audit', date: dateThu, startTime: '09:30', endTime: '11:00', duration: 90, type: 'work', workstream: 'Architecture & Security', collaborator: 'collab-2' },
        { id: 'plan-9', title: typeof t === 'function' ? t('demo.planCollabCheckinTitle') : 'Collaborator 1-on-1 Check-in', date: dateThu, startTime: '14:30', endTime: '15:15', duration: 45, type: 'sync', collaborator: 'collab-3' },
        { id: 'plan-10', title: typeof t === 'function' ? t('demo.planPrepTitle') : 'Sprint Retrospective Prep', date: dateFri, startTime: '11:00', endTime: '12:00', duration: 60, type: 'prep', workstream: 'Product Launch' },
        { id: 'plan-11', title: typeof t === 'function' ? t('demo.planWeeklyRetroTitle') : 'Weekly Retrospective & Review', date: dateFri, startTime: '15:30', endTime: '16:30', duration: 60, type: 'sync', collaborator: 'collab-1' }
      ]
    },
    'raw/topic-memories/index.json': {
      topics: [
        {
          key: 'product_launch',
          topicName: 'Product Launch',
          summary: 'Core product milestones, roadmap planning, and go-to-market alignment.',
          status: 'active',
          pinned: true,
          lastUpdated: new Date().toISOString(),
          mappedTags: { major_topic_tags: ['Product Launch'], group_tags: ['strategy', 'roadmap'], topic_tags: ['features'] },
          factsCount: 3,
          decisionsCount: 1,
          associatedNotesCount: 2
        },
        {
          key: 'architecture_security',
          topicName: 'Architecture & Security',
          summary: 'Zero-knowledge end-to-end encryption and modular client architecture.',
          status: 'active',
          pinned: true,
          lastUpdated: new Date().toISOString(),
          mappedTags: { major_topic_tags: ['Architecture & Security'], group_tags: ['security', 'crypto'], topic_tags: ['e2ee'] },
          factsCount: 3,
          decisionsCount: 1,
          associatedNotesCount: 2
        },
        {
          key: 'quality_bug_fixes',
          topicName: 'Quality & Bug Fixes',
          summary: 'Strict automated test suites, cross-platform stability, and regression triage.',
          status: 'active',
          pinned: false,
          lastUpdated: new Date().toISOString(),
          mappedTags: { major_topic_tags: ['Quality & Bug Fixes'], group_tags: ['bugs', 'quality'], topic_tags: ['triage'] },
          factsCount: 2,
          decisionsCount: 1,
          associatedNotesCount: 1
        },
        {
          key: 'personal_strategy',
          topicName: 'Personal / Strategy',
          summary: 'High-level personal productivity strategy, retrospectives, and deep work focus blocks.',
          status: 'active',
          pinned: false,
          lastUpdated: new Date().toISOString(),
          mappedTags: { major_topic_tags: ['Personal / Strategy'], group_tags: ['productivity'], topic_tags: ['habits'] },
          factsCount: 1,
          decisionsCount: 0,
          associatedNotesCount: 0
        }
      ]
    },
    'raw/topic-memories/product_launch.json': {
      key: 'product_launch',
      topicName: 'Product Launch',
      summary: 'Core product milestones, roadmap planning, and go-to-market alignment.',
      status: 'active',
      pinned: true,
      lastUpdated: new Date().toISOString(),
      mappedTags: { major_topic_tags: ['Product Launch'], group_tags: ['strategy', 'roadmap'], topic_tags: ['features'] },
      keyFacts: ['Private local-first personal productivity workspace', 'Multi-platform support across web, electron desktop, and chrome extension', 'Zero-knowledge end-to-end encryption with AES-256-GCM'],
      activeMilestones: ['15 European language parity guarantee', 'Seamless demo sandbox for instant browser exploration'],
      decisions: ['15 European Language Parity Guarantee'],
      openThreads: ['Evaluate on-device local LLM execution latency'],
      participants: ['Etienne Beltzung', 'Sarah Connor', 'Alex Martin'],
      associatedNotes: ['notes/strategy-roadmap-note.html', 'notes/welcome-demo-note.html']
    },
    'raw/topic-memories/architecture_security.json': {
      key: 'architecture_security',
      topicName: 'Architecture & Security',
      summary: 'Zero-knowledge end-to-end encryption and modular client architecture.',
      status: 'active',
      pinned: true,
      lastUpdated: new Date().toISOString(),
      mappedTags: { major_topic_tags: ['Architecture & Security'], group_tags: ['security', 'crypto'], topic_tags: ['e2ee'] },
      keyFacts: ['Client-side PBKDF2 key derivation from user passphrase', 'Local Write-Ahead Log (WAL) ensures zero data loss on crash', 'Direct File System Access with IndexedDB fallback'],
      activeMilestones: ['Finalize multi-window broadcast sync channel'],
      decisions: ['Zero-Knowledge Encryption as Core Cloud Sync Engine'],
      openThreads: ['Audit WebCrypto subtle key export restrictions'],
      participants: ['Etienne Beltzung', 'Sarah Connor'],
      associatedNotes: ['notes/security-zero-knowledge.html', 'notes/weekly-sync-notes.html']
    },
    'raw/topic-memories/quality_bug_fixes.json': {
      key: 'quality_bug_fixes',
      topicName: 'Quality & Bug Fixes',
      summary: 'Strict automated test suites, cross-platform stability, and regression triage.',
      status: 'active',
      pinned: false,
      lastUpdated: new Date().toISOString(),
      mappedTags: { major_topic_tags: ['Quality & Bug Fixes'], group_tags: ['bugs', 'quality'], topic_tags: ['triage'] },
      keyFacts: ['Automated test suite with over 1200 unit tests', 'Translation validator ensuring 100% key parity across 15 languages'],
      activeMilestones: ['Zero unhandled exceptions policy'],
      decisions: ['Zero Unhandled Exceptions Policy & Strict Regression Testing'],
      openThreads: ['Continuous integration verification across all operating systems'],
      participants: ['Sarah Connor', 'Etienne Beltzung'],
      associatedNotes: ['notes/bug-tracking-note.html']
    },
    'raw/topic-memories/personal_strategy.json': {
      key: 'personal_strategy',
      topicName: 'Personal / Strategy',
      summary: 'High-level personal productivity strategy, retrospectives, and deep work focus blocks.',
      status: 'active',
      pinned: false,
      lastUpdated: new Date().toISOString(),
      mappedTags: { major_topic_tags: ['Personal / Strategy'], group_tags: ['productivity'], topic_tags: ['habits'] },
      keyFacts: ['Daily and weekly retrospectives for continuous improvement'],
      activeMilestones: ['Maintain structured deep work blocks on Mondays and Wednesdays'],
      decisions: [],
      openThreads: ['Review weekly planner balance every Friday afternoon'],
      participants: ['Etienne Beltzung'],
      associatedNotes: []
    }
  };

  return createVirtualDirectoryHandle('Demo Workspace (Sandbox)', initialFiles);
}
window.createDemoVirtualDirectoryHandle = createDemoVirtualDirectoryHandle;

window.startDemoWorkspaceFromLanding = async function() {
  try {
    const demoHandle = createDemoVirtualDirectoryHandle();
    if (typeof mountFolder === 'function') {
      await mountFolder(demoHandle);
    }
    const msg = typeof t === 'function' ? t('landing.demoWorkspaceToast') : 'Demo workspace loaded! Explore sample notes, tasks, and planner.';
    if (typeof showToast === 'function') {
      showToast(msg);
    } else if (typeof toast === 'function') {
      toast(msg);
    }
  } catch (err) {
    console.error('Failed to launch demo workspace:', err);
    if (typeof toast === 'function') toast('Failed to launch demo workspace', true);
  }
};

// Browser compatibility check for File System Access API
if (typeof window.showDirectoryPicker === 'undefined' && !window.AppBridge?.fs?.hasNativeFS()) {
  if (settings && settings.storageEngine === 'firebase') {
    mountFolder({ name: 'Firebase Cloud Vault' });
  } else {
    renderBrowserCompatibilityOptions();
  }
} else {
  // Hash routing: detect #note=<id> or #path=<path> or #chat-window=true
  (function initHashRouting() {
    const hash = location.hash;
    const isCompanion = hash.includes('chat-window=true') || document.body.classList.contains('secretary-window-standalone');
    if (isCompanion) {
      document.body.classList.add('chat-window-mode');
      setTimeout(() => {
        const floating = document.getElementById('floating-secretary-chat');
        if (floating) floating.classList.add('is-open');
      }, 50);
    }
    if (hash.includes('focus-pip=true')) {
      document.body.classList.add('focus-pip-mode');
      setTimeout(() => {
        if (typeof renderFocusPipHud === 'function') renderFocusPipHud();
      }, 100);
    }
    const isPreloaded = hash.includes('preloaded=true');
    const m = hash.match(/[#&](note|path)=([^&]+)/);
    if (m || isPreloaded) {
      _isFocusedMode = true;
      document.body.classList.add('focused-note-mode');
      // Update connect screen hint
      const hint = document.querySelector('.connect-note-hint');
      if (hint && m) hint.textContent = t('common.noteLinkDetected');
    }
  })();
  const isCompanionMode = document.body.classList.contains('secretary-window-standalone') ||
                          document.body.classList.contains('chat-window-mode') ||
                          (location.hash && location.hash.includes('chat-window=true'));
  window.checkSavedFolderPromise = checkSavedFolder();
}


function prefsWorkingDaysChanged() {
  const selected = [];
  [1, 2, 3, 4, 5, 6, 0].forEach(day => {
    const cb = document.getElementById(`pref-wd-${day}`);
    if (cb && cb.checked) selected.push(day);
  });
  plannerWorkingDays = selected;
  try { localStorage.setItem('secretaryWorkingDays', JSON.stringify(selected)); } catch(e) {}
  if (!settings.ui) settings.ui = {};
  settings.ui.workingDays = selected;
  saveLocalSettings();
  broadcastSync({ type: 'SETTINGS_UPDATED', settings });
  saveFolderSettingsDebounced();
  if (activeTab === 'planner') {
    renderPlanner();
  }
}

// Global hashchange listener for browser Back/Forward routing
window.addEventListener('hashchange', async () => {
  if (_isApplyingHash) return;
  const hash = location.hash;
  if (hash && (hash.includes('note=') || hash.includes('path='))) {
    _isFocusedMode = true;
    document.body.classList.add('focused-note-mode');
  }
  await applyHashState();
});

// Electron IPC listener for dedicated note window dispatch
if (window.electronAPI?.onOpenNote) {
  window.electronAPI.onOpenNote(async ({ noteId, path }) => {
    _isFocusedMode = true;
    document.body.classList.add('focused-note-mode');
    const screenConnect = document.getElementById('screen-connect');
    if (screenConnect) screenConnect.style.display = 'none';
    const screenMain = document.getElementById('screen-main');
    if (screenMain) screenMain.classList.add('active');

    // Update location hash silently without triggering a synthetic hashchange event race
    const targetHash = noteId
      ? `#note=${encodeURIComponent(noteId)}`
      : (path ? `#path=${encodeURIComponent(path)}` : '');
    if (targetHash && location.hash !== targetHash) {
      try {
        history.replaceState(null, '', targetHash);
      } catch (e) {
        _isApplyingHash = true;
        location.hash = targetHash;
        setTimeout(() => { _isApplyingHash = false; }, 80);
      }
    }

    if (window.checkSavedFolderPromise) {
      try { await window.checkSavedFolderPromise; } catch (e) {}
    }
    if (!rootHandle && window.AppBridge?.fs) {
      try {
        const ws = await window.AppBridge.fs.getWorkspacePath();
        if (ws) await mountFolder(ws);
      } catch (e) {}
    }

    let targetNote = (noteId ? getNoteById(noteId) : null)
      || (path ? (typeof getNoteByPath === 'function' ? getNoteByPath(path) : null) : null)
      || (noteId ? (typeof getNoteByPath === 'function' ? getNoteByPath(noteId) : null) : null);

    // If note not found in memory manifest (e.g. freshly created in another window), try reloading manifest once
    if (!targetNote && (noteId || path)) {
      try {
        await loadManifest();
        targetNote = (noteId ? getNoteById(noteId) : null)
          || (path ? (typeof getNoteByPath === 'function' ? getNoteByPath(path) : null) : null)
          || (noteId ? (typeof getNoteByPath === 'function' ? getNoteByPath(noteId) : null) : null);
      } catch (e) {}
    }

    const resolvedPath = targetNote?.path || path || (noteId && noteId.includes('/') ? noteId : (noteId ? getCanonicalNotePath(noteId) : null));
    if (resolvedPath) {
      try {
        await openNoteOverlay(resolvedPath, null, null, false, null, { sameWindow: true });
      } catch (e) {
        console.error('Failed to open note overlay in dedicated window:', resolvedPath, e);
      }
      if (currentNote && window.AppBridge?.noteWindow?.notifyActiveNote) {
        window.AppBridge.noteWindow.notifyActiveNote(currentNote.id, currentNote.path);
      }
    }
    if (window.electronAPI?.notifyNoteWindowReady) {
      window.electronAPI.notifyNoteWindowReady();
    }
  });
}

// ── App Close Confirmation & Saving Progress ──
let _isExiting = false;
let _isClosePromptActive = false;

let _cloudExitResolver = null;

function resolveCloudExitDialog(choice = 'cancel') {
  const modal = document.getElementById('modal-cloud-exit-confirm');
  if (modal) {
    if (typeof closeModal === 'function') {
      closeModal('modal-cloud-exit-confirm');
    } else {
      modal.style.display = 'none';
      modal.classList.remove('active');
    }
  }
  if (typeof _cloudExitResolver === 'function') {
    const res = _cloudExitResolver;
    _cloudExitResolver = null;
    res(choice || 'cancel');
  }
}
window.resolveCloudExitDialog = resolveCloudExitDialog;

function showCloudExitConfirmDialog() {
  return new Promise(resolve => {
    const modal = document.getElementById('modal-cloud-exit-confirm');
    if (modal && typeof openModal === 'function') {
      _cloudExitResolver = (choice) => {
        _cloudExitResolver = null;
        resolve(choice || 'cancel');
      };
      openModal('modal-cloud-exit-confirm');
    } else {
      const overlay = document.createElement('div');
      overlay.className = 'dialog-overlay';
      const box = document.createElement('div');
      box.className = 'dialog-box';
      const title = document.createElement('h3');
      title.textContent = (typeof t === 'function' ? t('confirm.cloudExitTitle') : null) || 'Close Secretary (Cloud Mode)';
      box.appendChild(title);
      const msg = document.createElement('div');
      msg.className = 'dialog-message';
      msg.textContent = (typeof t === 'function' ? t('confirm.cloudExitSubtitle') : null) || 'Choose how to handle local working copies on this device:';
      box.appendChild(msg);

      const actions = document.createElement('div');
      actions.className = 'dialog-actions';

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn';
      cancelBtn.textContent = (typeof t === 'function' ? t('confirm.closeAppCancel') : null) || 'Cancel';
      cancelBtn.onclick = () => { cleanup(); resolve('cancel'); };
      actions.appendChild(cancelBtn);

      const purgeBtn = document.createElement('button');
      purgeBtn.className = 'btn btn-danger';
      purgeBtn.textContent = (typeof t === 'function' ? t('confirm.cloudExitPurgeBtn') : null) || 'Close & Delete Local Copies';
      purgeBtn.onclick = () => { cleanup(); resolve('close_and_delete'); };
      actions.appendChild(purgeBtn);

      const keepBtn = document.createElement('button');
      keepBtn.className = 'btn btn-save';
      keepBtn.textContent = (typeof t === 'function' ? t('confirm.cloudExitKeepBtn') : null) || 'Close';
      keepBtn.onclick = () => { cleanup(); resolve('close'); };
      actions.appendChild(keepBtn);

      box.appendChild(actions);
      overlay.appendChild(box);
      document.body.appendChild(overlay);

      const cleanup = () => {
        document.removeEventListener('keydown', keyHandler);
        overlay.remove();
      };
      const keyHandler = e => {
        if (e.key === 'Escape') { cleanup(); resolve('cancel'); }
      };
      document.addEventListener('keydown', keyHandler);
      overlay.addEventListener('click', e => {
        if (e.target === overlay) { cleanup(); resolve('cancel'); }
      });
    }
  });
}
window.showCloudExitConfirmDialog = showCloudExitConfirmDialog;

async function handleMainWindowCloseRequest() {
  if (_isExiting) return true;
  if (_isClosePromptActive) {
    const isPromptVisible = document.querySelector('.dialog-overlay, #modal-cloud-exit-confirm.active');
    if (isPromptVisible) return false;
    _isClosePromptActive = false;
  }

  const isStandalone = !document.getElementById('topbar-main-row') && (
    (window.AppBridge?.isStandaloneChildWindow && window.AppBridge.isStandaloneChildWindow()) ||
    document.body.classList.contains('note-window-standalone') ||
    document.body.classList.contains('secretary-window-standalone') ||
    document.body.classList.contains('chat-window-mode') ||
    document.body.classList.contains('focus-pip-mode') ||
    (typeof location !== 'undefined' && location.pathname && (location.pathname.includes('secretary-window') || location.pathname.includes('note-window')))
  );

  if (isStandalone) {
    if (window.electronAPI?.closeWindow) {
      window.electronAPI.closeWindow();
    } else {
      window.close();
    }
    return true;
  }

  const isCloudMode = (window.FirebaseSyncService && window.FirebaseSyncService.state && window.FirebaseSyncService.state.engine === 'firebase') ||
                      (window.StorageAPI && typeof window.StorageAPI.getStorageEngine === 'function' && window.StorageAPI.getStorageEngine() === 'firebase');

  _isClosePromptActive = true;
  let exitAction = 'close';
  try {
    if (isCloudMode) {
      exitAction = await showCloudExitConfirmDialog();
    } else {
      const confirmMessage = (typeof t === 'function' ? t('confirm.closeApp') : null) || 'Are you sure you want to close Secretary? All open windows will be closed.';
      const confirmLabel = (typeof t === 'function' ? t('confirm.closeAppConfirm') : null) || 'Close Secretary';
      const confirmTooltip = (typeof t === 'function' ? t('confirm.closeAppConfirmTooltip') : null) || confirmLabel;
      const cancelLabel = (typeof t === 'function' ? t('confirm.closeAppCancel') : null) || (typeof t === 'function' ? t('editor.cancel') : 'Cancel');
      const cancelTooltip = (typeof t === 'function' ? t('confirm.closeAppCancelTooltip') : null) || cancelLabel;

      const confirmed = await showConfirmDialog(confirmMessage, {
        confirmLabel,
        confirmTooltip,
        cancelLabel,
        cancelTooltip,
        isDanger: true
      });
      exitAction = confirmed ? 'close' : 'cancel';
    }
  } catch (err) {
    console.error('Error during close confirmation dialog:', err);
    exitAction = 'cancel';
  } finally {
    _isClosePromptActive = false;
  }

  if (exitAction === 'cancel') {
    return false;
  }

  const purgeLocal = exitAction === 'close_and_delete';
  const hasUnsavedOverlay = typeof hasUnsavedNoteOverlayChanges === 'function' && hasUnsavedNoteOverlayChanges();
  const savingInProgress = typeof isSaveInProgress === 'function' && isSaveInProgress();
  const isSyncing = !!(
    window.FirebaseSyncService && (
      (typeof window.FirebaseSyncService.hasPendingCloudWrites === 'function' && window.FirebaseSyncService.hasPendingCloudWrites()) ||
      window.FirebaseSyncService.state?.status === 'syncing' ||
      window.FirebaseSyncService.state?.syncTimer !== null
    )
  );

  if (hasUnsavedOverlay || savingInProgress || purgeLocal || isSyncing) {
    await executeSaveAndExitWithProgressBar({ purgeLocal, isSyncing });
  } else {
    if (window.electronAPI?.requestSaveAllWindows) {
      try { await window.electronAPI.requestSaveAllWindows(); } catch (e) {}
    }
    const stillSyncing = !!(
      window.FirebaseSyncService && (
        (typeof window.FirebaseSyncService.hasPendingCloudWrites === 'function' && window.FirebaseSyncService.hasPendingCloudWrites()) ||
        window.FirebaseSyncService.state?.status === 'syncing' ||
        window.FirebaseSyncService.state?.syncTimer !== null
      )
    );
    if ((typeof isSaveInProgress === 'function' && isSaveInProgress()) || stillSyncing) {
      await executeSaveAndExitWithProgressBar({ purgeLocal, isSyncing: stillSyncing });
    } else {
      _isExiting = true;
      if (window.electronAPI?.closeAppConfirmed) {
        window.electronAPI.closeAppConfirmed();
      } else if (window.AppBridge?.windowControls?.closeAppConfirmed) {
        window.AppBridge.windowControls.closeAppConfirmed();
      } else {
        window.close();
      }
    }
  }
  return true;
}
window.handleMainWindowCloseRequest = handleMainWindowCloseRequest;

async function executeSaveAndExitWithProgressBar(options = {}) {
  _isExiting = true;
  const isSyncingMode = !!(options.isSyncing || (window.FirebaseSyncService && (
    (typeof window.FirebaseSyncService.hasPendingCloudWrites === 'function' && window.FirebaseSyncService.hasPendingCloudWrites()) ||
    window.FirebaseSyncService.state?.status === 'syncing' ||
    window.FirebaseSyncService.state?.syncTimer !== null
  )));

  const initialMsg = isSyncingMode
    ? ((typeof t === 'function' ? t('sync.statusSyncing') : null) || 'Syncing changes with cloud...')
    : ((typeof t === 'function' ? t('editor.closingAppMessage') : null) || 'Please wait while all changes are saved to disk...');

  const progress = showAppCloseProgressDialog(initialMsg);
  progress.update(initialMsg, 15);

  try {
    if (window.electronAPI?.requestSaveAllWindows) {
      try {
        await window.electronAPI.requestSaveAllWindows();
      } catch (e) {}
    }
    progress.update((typeof t === 'function' ? t('editor.closingSaveStep') : null) || 'Saving notes...', 35);

    if (typeof hasUnsavedNoteOverlayChanges === 'function' && hasUnsavedNoteOverlayChanges()) {
      if (typeof autoSaveNote === 'function') {
        await autoSaveNote({ silent: true, isFinal: true });
      }
    }
    progress.update((typeof t === 'function' ? t('editor.closingSaveStep') : null) || 'Saving notes...', 60);

    if (typeof saveManifest === 'function') {
      try { await saveManifest({ force: true }); } catch (e) {}
    }
    if (typeof saveTodosManifest === 'function') {
      try { await saveTodosManifest(); } catch (e) {}
    }
    if (typeof savePlanner === 'function') {
      try { await savePlanner(); } catch (e) {}
    }

    if (typeof finalizeSaves === 'function') {
      await finalizeSaves(progress);
    }

    if (window.FirebaseSyncService) {
      const hasPending = typeof window.FirebaseSyncService.hasPendingCloudWrites === 'function' && window.FirebaseSyncService.hasPendingCloudWrites();
      const inFlightSync = window.FirebaseSyncService.state?.status === 'syncing' || window.FirebaseSyncService.state?.syncTimer !== null;
      if (hasPending || inFlightSync) {
        const isOnline = typeof navigator !== 'undefined' && navigator.onLine !== undefined ? navigator.onLine : true;
        if (isOnline) {
          progress.update((typeof t === 'function' ? t('sync.statusSyncing') : null) || 'Syncing changes with cloud...', 80);
          try {
            if (typeof window.FirebaseSyncService.flushQueue === 'function') {
              await window.FirebaseSyncService.flushQueue();
            }
          } catch (e) {
            console.warn('Failed to flush cloud queue on exit:', e);
          }
          const syncStart = Date.now();
          while (window.FirebaseSyncService.state?.status === 'syncing' && Date.now() - syncStart < 3000) {
            await new Promise(r => setTimeout(r, 100));
          }
        }
      }
    }

    if (options.purgeLocal && window.FirebaseSyncService && typeof window.FirebaseSyncService.purgeLocalSessionAndQuit === 'function') {
      progress.update((typeof t === 'function' ? t('confirm.cloudExitPurgeOptionTitle') : null) || 'Deleting local copies...', 95);
      try {
        await window.FirebaseSyncService.purgeLocalSessionAndQuit();
      } catch (e) {
        console.warn('Failed to purge local session on exit:', e);
      }
    }

    progress.update((typeof t === 'function' ? t('editor.closingAppFinished') : null) || 'All changes saved!', 100);
    await new Promise(resolve => setTimeout(resolve, 350));
  } catch (err) {
    console.error('Error finalizing saves on close:', err);
  } finally {
    progress.close();
    _isExiting = false;
    if (window.electronAPI?.closeAppConfirmed) {
      window.electronAPI.closeAppConfirmed();
    } else if (window.AppBridge?.windowControls?.closeAppConfirmed) {
      window.AppBridge.windowControls.closeAppConfirmed();
    } else {
      window.close();
    }
  }
}

window.addEventListener('beforeunload', (e) => {
  const isStandalone = !document.getElementById('topbar-main-row') && (
    (window.AppBridge?.isStandaloneChildWindow && window.AppBridge.isStandaloneChildWindow()) ||
    document.body.classList.contains('note-window-standalone') ||
    document.body.classList.contains('secretary-window-standalone') ||
    document.body.classList.contains('chat-window-mode') ||
    document.body.classList.contains('focus-pip-mode') ||
    (typeof location !== 'undefined' && location.pathname && (location.pathname.includes('secretary-window') || location.pathname.includes('note-window')))
  );
  if (isStandalone) {
    const hasUnsavedNote = typeof hasUnsavedNoteOverlayChanges === 'function' && hasUnsavedNoteOverlayChanges();
    if (hasUnsavedNote && typeof autoSaveNote === 'function') {
      autoSaveNote({ silent: true, isFinal: true }).catch(() => {});
    }
    return;
  }

  const hasUnsavedNote = typeof hasUnsavedNoteOverlayChanges === 'function' && hasUnsavedNoteOverlayChanges();
  const isSaving = typeof isSaveInProgress === 'function' && isSaveInProgress();
  const hasCloudPending = window.FirebaseSyncService && (
    (typeof window.FirebaseSyncService.hasPendingCloudWrites === 'function' && window.FirebaseSyncService.hasPendingCloudWrites()) ||
    window.FirebaseSyncService.state?.status === 'syncing' ||
    window.FirebaseSyncService.state?.syncTimer !== null
  );
  if (isSaving || hasUnsavedNote || hasCloudPending) {
    if (_isExiting) return;
    if (hasUnsavedNote && typeof autoSaveNote === 'function') {
      autoSaveNote({ silent: true, isFinal: true }).catch(() => {});
    }
    e.preventDefault();
    e.returnValue = '';
    
    setTimeout(() => {
      const stillPending = window.FirebaseSyncService && (
        (typeof window.FirebaseSyncService.hasPendingCloudWrites === 'function' && window.FirebaseSyncService.hasPendingCloudWrites()) ||
        window.FirebaseSyncService.state?.status === 'syncing' ||
        window.FirebaseSyncService.state?.syncTimer !== null
      );
      if ((typeof isSaveInProgress === 'function' && isSaveInProgress()) || 
          (typeof hasUnsavedNoteOverlayChanges === 'function' && hasUnsavedNoteOverlayChanges()) ||
          stillPending) {
        executeSaveAndExitWithProgressBar({ isSyncing: !!stillPending });
      }
    }, 150);
  }
});

// Initialize Cloud Sync status listener and real-time version monitor
if (typeof window !== 'undefined' && window.FirebaseSyncService) {
  window.FirebaseSyncService.onStatusChange((status) => {
    if (typeof updateCloudSyncUI === 'function') updateCloudSyncUI(status);
  });
  window.FirebaseSyncService.onVersionChange((versionStatus) => {
    if (typeof renderAppVersionBanner === 'function') renderAppVersionBanner(versionStatus);
  });
  // Auto-detect and monitor app version compatibility from Firebase /app_info
  if (typeof window.FirebaseSyncService.listenAppVersion === 'function') {
    window.FirebaseSyncService.listenAppVersion();
  }
}

if (window.electronAPI?.onMainWindowCloseRequest) {
  window.electronAPI.onMainWindowCloseRequest(() => {
    handleMainWindowCloseRequest();
  });
}

if (window.electronAPI?.onRequestSave) {
  window.electronAPI.onRequestSave(async () => {
    if (typeof hasUnsavedNoteOverlayChanges === 'function' && hasUnsavedNoteOverlayChanges()) {
      if (typeof autoSaveNote === 'function') {
        try { await autoSaveNote({ silent: true, isFinal: true }); } catch (e) {}
      }
    }
    if (window.electronAPI?.notifySaveComplete) {
      window.electronAPI.notifySaveComplete();
    }
  });
}

// Electron IPC listener for application actions (e.g. Windows Taskbar Jump Lists)
if (window.AppBridge?.onAppAction || window.electronAPI?.onAppAction) {
  const listenAction = window.AppBridge?.onAppAction || window.electronAPI?.onAppAction;
  listenAction((action) => {
    if (action === 'new-note') {
      if (typeof createNote === 'function') {
        createNote();
      } else if (typeof openNoteEditModal === 'function') {
        openNoteEditModal(null, true);
      }
    } else if (action === 'planner') {
      if (typeof switchTab === 'function') {
        switchTab('planner');
      }
    }
  });
}

function showAppCloseProgressDialog(message) {
  const existing = document.getElementById('app-close-progress-overlay');
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

  const overlay = document.createElement('div');
  overlay.id = 'app-close-progress-overlay';
  overlay.className = 'dialog-overlay planner-progress-overlay';
  overlay.style.zIndex = '100020';

  const box = document.createElement('div');
  box.className = 'dialog-box planner-progress-dialog';

  const title = document.createElement('div');
  title.className = 'planner-progress-title';
  title.textContent = (typeof t === 'function' ? t('editor.closingAppTitle') : null) || 'Saving in progress';

  const body = document.createElement('div');
  body.className = 'planner-progress-message';
  body.textContent = message || ((typeof t === 'function' ? t('editor.closingAppMessage') : null) || 'Please wait while all changes are saved to disk...');

  const spinner = document.createElement('div');
  spinner.className = 'planner-progress-spinner';
  spinner.setAttribute('aria-hidden', 'true');

  const barContainer = document.createElement('div');
  barContainer.className = 'planner-progress-bar-container';
  barContainer.style.width = '100%';
  barContainer.style.height = '6px';
  barContainer.style.background = 'var(--card-border, #e2e8f0)';
  barContainer.style.borderRadius = '3px';
  barContainer.style.overflow = 'hidden';
  barContainer.style.marginTop = '0.5rem';

  const barFill = document.createElement('div');
  barFill.className = 'planner-progress-bar-fill';
  barFill.style.width = '0%';
  barFill.style.height = '100%';
  barFill.style.background = 'var(--accent, #4f46e5)';
  barFill.style.borderRadius = '3px';
  barFill.style.transition = 'width 0.25s ease';

  barContainer.appendChild(barFill);

  box.appendChild(spinner);
  box.appendChild(title);
  box.appendChild(body);
  box.appendChild(barContainer);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  return {
    update(nextMessage, percentage) {
      if (body) body.textContent = nextMessage || body.textContent;
      if (barFill && percentage !== undefined) {
        barFill.style.width = percentage + '%';
        if (typeof percentage === 'number') {
          window.AppBridge?.setProgressBar(Math.min(1, Math.max(0, percentage / 100)));
        }
      }
    },
    close() {
      window.AppBridge?.setProgressBar(-1);
      if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
  };
}

function makeDraggable(el, header) {
  let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
  header.onmousedown = dragMouseDown;

  function dragMouseDown(e) {
    e = e || window.event;
    if (e.target.closest('button') || e.target.closest('select') || e.target.closest('input')) return;
    e.preventDefault();
    pos3 = e.clientX;
    pos4 = e.clientY;
    document.onmouseup = closeDragElement;
    document.onmousemove = elementDrag;
  }

  function elementDrag(e) {
    e = e || window.event;
    e.preventDefault();
    pos1 = pos3 - e.clientX;
    pos2 = pos4 - e.clientY;
    pos3 = e.clientX;
    pos4 = e.clientY;
    
    let newTop = el.offsetTop - pos2;
    let newLeft = el.offsetLeft - pos1;
    
    const boundary = 5;
    if (newTop < boundary) newTop = boundary;
    if (newTop > window.innerHeight - el.offsetHeight - boundary) {
      newTop = window.innerHeight - el.offsetHeight - boundary;
    }
    if (newLeft < boundary) newLeft = boundary;
    if (newLeft > window.innerWidth - el.offsetWidth - boundary) {
      newLeft = window.innerWidth - el.offsetWidth - boundary;
    }
    
    el.style.top = newTop + "px";
    el.style.left = newLeft + "px";
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  }

  function closeDragElement() {
    document.onmouseup = null;
    document.onmousemove = null;
  }
}
window.makeDraggable = makeDraggable;




