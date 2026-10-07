'use strict';

/**
 * Secretary - Daily Review Wizard Controller
 * Manages the 4-step end-of-day cleanup workflow.
 */
const DailyReviewController = {
  currentStep: 0,
  stashItems: [],
  todayNotes: [],
  activeNotePath: null,
  activeRoutingStashId: null,
  reviewDate: null,
  reviewDateValue: null,
  plannerQASignature: null,
  plannerQADoneSignature: null,
  originalTab: null,
  step3PlannerVisible: true,
  plannerReviewDefaultApplied: false,
  step3NotePaneVisible: true,
  step3NotePaneWidth: null,
  isGeneratingSummaries: false,
  noteProposals: {},
  batchState: {
    active: false,
    cancelled: false,
    currentIndex: 0,
    totalCount: 0,
    abortController: null
  },
  integratedActiveTab: 'A',
  viewingIntegratedProposal: false,
  
  // Keep track of original parents to restore on quit/finish
  editorOriginalParent: null,
  editorMetaOriginalParent: null,
  overlayHeaderOriginalParent: null,
  plannerOriginalParent: null,
  originalPlannerViewMode: null,
  originalPlannerWeekStart: null,
  originalRelatedNotesOpen: null,
  overlayMainOriginalParent: null,
  overlayHeaderOriginalNextSibling: null,
  editorMetaOriginalNextSibling: null,
  overlayMainOriginalNextSibling: null,
  
  // Store original globals to restore when review finishes
  originalCreateNewTodo: null,
  originalCreateNewNote: null,
  originalOpenPlannerModal: null,
  interceptorsHooked: false,

  /**
   * Start the Daily Review wizard
   */
  async start(reviewDateValue = null, targetStep = 0) {
    const targetDateStr = reviewDateValue
      ? (typeof formatLocalDateValue === 'function' ? formatLocalDateValue(reviewDateValue) : String(reviewDateValue).slice(0, 10))
      : (typeof formatLocalDateValue === 'function' ? formatLocalDateValue(new Date()) : new Date().toISOString().slice(0, 10));

    if (typeof isDateCoveredByOoo === 'function' && isDateCoveredByOoo(targetDateStr)) {
      const oooEv = typeof getCoveringOooEvent === 'function' ? getCoveringOooEvent(targetDateStr) : null;
      const oooTitle = oooEv?.title || (typeof t === 'function' ? t('planner.ooo') : null) || 'Out of Office';
      const msg = typeof t === 'function'
        ? t('dailyreview.oooDayAutoReviewed', { title: oooTitle })
        : `${oooTitle}: This day is marked as Out of Office and is already automatically reviewed.`;
      if (typeof toast === 'function') toast(msg);
      return;
    }

    const isNewDate = reviewDateValue && reviewDateValue !== this.reviewDateValue;

    if (this.currentStep > 0 && !isNewDate) {
      if (targetStep > 0 && targetStep !== this.currentStep) {
        this.currentStep = targetStep;
      }
      await switchTab('daily-review');
      return;
    }

    const overlay = document.getElementById('daily-review-overlay');
    if (!overlay) return;

    this.originalTab = (typeof activeTab === 'string' && activeTab !== 'daily-review')
      ? activeTab
      : (this.originalTab && this.originalTab !== 'daily-review' ? this.originalTab : 'retro');
    this.reviewSessionStartTime = Date.now();

    // Save original DOM parents if not saved yet
    const planner = document.getElementById('planner-panel');
    if (planner && !this.plannerOriginalParent) {
      this.plannerOriginalParent = planner.parentElement;
    }
    const overlayMain = document.querySelector('.overlay-main-layout');
    if (overlayMain && !this.overlayMainOriginalParent) {
      this.overlayMainOriginalParent = overlayMain.parentElement;
    }
    
    // Save original planner view mode and start date
    this.originalPlannerViewMode = typeof plannerViewMode !== 'undefined' ? plannerViewMode : 'week';
    this.originalPlannerWeekStart = typeof currentPlannerWeekStart !== 'undefined' ? currentPlannerWeekStart : null;

    // Set layout & state
    this.currentStep = targetStep || 1;
    this.activeRoutingStashId = null;
    this.activeNotePath = null;
    this.reviewDate = null;
    this.reviewDateValue = null;
    this.plannerQASignature = null;
    this.plannerQADoneSignature = null;
    this.step3PlannerVisible = true;
    this.plannerReviewDefaultApplied = false;
    this.step3NotePaneVisible = true;
    this.step3NotePaneWidth = this.loadStep3NotePaneWidth();
    this.originalRelatedNotesOpen = typeof relatedNotesOpen !== 'undefined' ? relatedNotesOpen : null;
    this.ignoredBlockIds = new Set();
    this.currentSuggestions = [];
    this.suggestedWorkstreams = [];
    this.summaryJustGenerated = false;
    this.isGeneratingSummaries = false;
    this.todayNotes = [];

    const sugListInit = document.getElementById('dr-ai-suggestions-list');
    if (sugListInit) sugListInit.innerHTML = '';
    const contentTextareaInit = document.getElementById('dr-ai-summary-content');
    if (contentTextareaInit) contentTextareaInit.innerHTML = '';
    const titleInputInit = document.getElementById('dr-ai-summary-title');
    if (titleInputInit) titleInputInit.value = '';

    const defaultReviewDate = new Date();
    this.setReviewDate(reviewDateValue || defaultReviewDate, { rerender: false });
    
    // Hide main edit overlay if open
    const editOverlay = document.getElementById('note-edit-overlay');
    if (editOverlay) editOverlay.style.display = 'none';

    this.bindStep3ResizeHandle();
    this.initOpenNotesListener();

    // Localize UI & load first step
    this.localizeUI();

    const startScreen = document.getElementById('dr-start-screen');
    const shell = document.getElementById('dr-shell');
    if (startScreen) startScreen.style.display = 'none';
    if (shell) shell.style.display = 'flex';

    if (this.currentStep === 5) {
      this.todayNotes = this.collectTodayNotes();
    }

    await switchTab('daily-review');
    await this.loadStep(this.currentStep);

    // Auto-trigger guided tour if first time entering Daily Review
    setTimeout(() => {
      try {
        if (localStorage.getItem('secretary_daily_review_guided_seen') !== 'true') {
          this.startGuidedTour();
        }
      } catch (e) {}
    }, 400);
  },

  /**
   * Interactive 4-step guided tour for Daily Review
   */
  startGuidedTour() {
    const steps = [
      {
        title: (typeof t === 'function' && t('tutorial.dailyReviewGuide.step1Title')) || '1/4 Inbox & Stash Triage',
        text: (typeof t === 'function' && t('tutorial.dailyReviewGuide.step1Text')) || 'Passez en revue les notes rapides du stash. Transformez-les en tâches, notes de réunion ou classez-les.',
      },
      {
        title: (typeof t === 'function' && t('tutorial.dailyReviewGuide.step2Title')) || '2/4 Planner & Calendar Audit',
        text: (typeof t === 'function' && t('tutorial.dailyReviewGuide.step2Text')) || 'Ajustez l\'emploi du temps d\'aujourd\'hui selon la réalité. Validez les réunions effectuées et planifiez demain.',
      },
      {
        title: (typeof t === 'function' && t('tutorial.dailyReviewGuide.step3Title')) || '3/4 AI Notes & Decisions Extraction',
        text: (typeof t === 'function' && t('tutorial.dailyReviewGuide.step3Text')) || 'Générez des résumés IA pour vos notes du jour et extrayez automatiquement les décisions stratégiques.',
      },
      {
        title: (typeof t === 'function' && t('tutorial.dailyReviewGuide.step4Title')) || '4/4 Day Wrap-Up & Clear Slate',
        text: (typeof t === 'function' && t('tutorial.dailyReviewGuide.step4Text')) || 'Confirmez vos priorités pour demain et terminez votre journée avec une boîte de réception vide et l\'esprit serein.',
      }
    ];

    let tourIndex = 0;
    const renderTourModal = () => {
      let modalEl = document.getElementById('dr-guided-tour-modal');
      if (!modalEl) {
        modalEl = document.createElement('div');
        modalEl.id = 'dr-guided-tour-modal';
        modalEl.className = 'dr-tour-modal';
        document.body.appendChild(modalEl);
      }
      const st = steps[tourIndex];
      const badgeText = (typeof t === 'function' && t('tutorial.dailyReviewGuide.badge')) || 'Daily Review Guide';
      const closeLabel = (typeof t === 'function' && (t('tutorial.dailyReviewGuide.closeTooltip') || t('common.close'))) || 'Close';
      const prevLabel = (typeof t === 'function' && t('dailyreview.prevBtn')) || 'Previous';
      const prevTooltip = (typeof t === 'function' && t('tutorial.dailyReviewGuide.prevTooltip')) || prevLabel;
      const isLast = tourIndex === steps.length - 1;
      const nextLabel = isLast
        ? ((typeof t === 'function' && t('tutorial.dailyReviewGuide.startReviewBtn')) || 'Start Review')
        : ((typeof t === 'function' && t('dailyreview.nextBtn')) || 'Next');
      const nextTooltip = isLast
        ? ((typeof t === 'function' && t('tutorial.dailyReviewGuide.startReviewTooltip')) || nextLabel)
        : ((typeof t === 'function' && t('tutorial.dailyReviewGuide.nextTooltip')) || nextLabel);

      const escHFn = typeof escH === 'function' ? escH : (s => String(s || ''));
      const escAFn = typeof escA === 'function' ? escA : (s => String(s || '').replace(/"/g, '&quot;'));

      modalEl.innerHTML = `
        <div class="dr-tour-modal-card">
          <div class="dr-tour-header">
            <span class="dr-tour-badge"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -1px; margin-right: 5px;"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>${escHFn(badgeText)}</span>
            <button class="dr-tour-close" onclick="document.getElementById('dr-guided-tour-modal')?.remove()" aria-label="${escAFn(closeLabel)}" title="${escAFn(closeLabel)}">✕</button>
          </div>
          <h3 class="dr-tour-title">${escHFn(st.title)}</h3>
          <p class="dr-tour-text">${escHFn(st.text)}</p>
          <div class="dr-tour-footer">
            <div class="dr-tour-dots">
              ${steps.map((_, i) => `<span class="dr-tour-dot ${i === tourIndex ? 'active' : ''}"></span>`).join('')}
            </div>
            <div class="dr-tour-actions">
              ${tourIndex > 0 ? `<button class="btn" id="dr-tour-prev" title="${escAFn(prevTooltip)}">${escHFn(prevLabel)}</button>` : ''}
              <button class="btn btn-primary" id="dr-tour-next" title="${escAFn(nextTooltip)}">${escHFn(nextLabel)}</button>
            </div>
          </div>
        </div>
      `;
      
      const prevBtn = modalEl.querySelector('#dr-tour-prev');
      const nextBtn = modalEl.querySelector('#dr-tour-next');
      if (prevBtn) {
        prevBtn.onclick = () => {
          if (tourIndex > 0) {
            tourIndex--;
            renderTourModal();
          }
        };
      }
      if (nextBtn) {
        nextBtn.onclick = () => {
          if (tourIndex < steps.length - 1) {
            tourIndex++;
            renderTourModal();
          } else {
            modalEl.remove();
            try { localStorage.setItem('secretary_daily_review_guided_seen', 'true'); } catch(e){}
          }
        };
      }
    };
    renderTourModal();
  },

  /**
   * Quit the wizard with confirmation
   */
  async confirmQuit() {
    const confirmed = await showConfirmDialog(t('dailyreview.quitConfirm'), {
      title: t('dailyreview.quitTitle'),
      confirmLabel: t('dailyreview.quitBtn'),
      isDanger: true
    });
    if (confirmed) {
      await this.close();
    }
  },

  /**
   * Pause the wizard and restore DOM state
   */
  pause() {
    this.cancelBatchPerfectNotes();
    this.switchToRawEditor();
    this.restoreStep3NoteEditor();

    if (typeof relatedNotesOpen !== 'undefined' && this.originalRelatedNotesOpen !== null) {
      relatedNotesOpen = this.originalRelatedNotesOpen;
    }

    // Restore planner to its original parent
    const planner = document.getElementById('planner-panel');
    if (planner && this.plannerOriginalParent) {
      this.plannerOriginalParent.appendChild(planner);
      
      const currentTab = typeof activeTab !== 'undefined' ? activeTab : 'notes';
      planner.style.display = (currentTab === 'planner') ? 'flex' : 'none';
      
      // Restore planner view mode & week start date
      if (typeof setPlannerViewMode === 'function') {
        setPlannerViewMode(this.originalPlannerViewMode);
      }
      if (typeof currentPlannerWeekStart !== 'undefined') {
        currentPlannerWeekStart = this.originalPlannerWeekStart;
      }
      if (typeof renderPlanner === 'function') {
        renderPlanner();
      }
    }

    // Unhook interceptors
    this.unhookInterceptors();
  },

  /**
   * Close the wizard, reset state and restore DOM
   */
  async close() {
    this.pause();

    const overlay = document.getElementById('daily-review-overlay');
    if (overlay) overlay.style.display = 'none';
    document.body.classList.remove('dr-step3-resizing');
    this.plannerReviewDefaultApplied = false;

    plannerDisplayDateOverride = null;
    plannerInitialFocusDate = null;
    if (typeof window !== 'undefined') window._plannerInitialScrollDone = false;

    // Reset state
    this.currentStep = 0;
    this.activeRoutingStashId = null;
    this.activeNotePath = null;
    this.todayNotes = [];
    this.isClosingDay = false;

    const todayReviewValue = formatLocalDateValue(new Date());
    this.reviewDate = parseLocalDateValue(todayReviewValue) || new Date();
    this.reviewDateValue = todayReviewValue;
    this.syncReviewDateUI();
    
    const btnDr = document.getElementById('tab-daily-review-btn');
    if (btnDr) btnDr.classList.remove('active');

    if (typeof renderPlanner === 'function') {
      try { renderPlanner(); } catch (_e) {}
    }

    const startScreen = document.getElementById('dr-start-screen');
    const shell = document.getElementById('dr-shell');
    if (startScreen) startScreen.style.display = 'flex';
    if (shell) shell.style.display = 'none';
    this.currentStep = 0;
    this.activeRoutingStashId = null;
    this.activeNotePath = null;
    this.todayNotes = [];

    const returnTab = (this.originalTab && this.originalTab !== 'daily-review') ? this.originalTab : 'retro';
    this.originalTab = null;

    if (typeof updateUrlHash === 'function') updateUrlHash();
    if (typeof switchTab === 'function') {
      await switchTab(returnTab);
    }
    if (typeof window.updateRetroFlashAndHoverState === 'function') {
      window.updateRetroFlashAndHoverState();
    }
  },

  /**
   * Resume the wizard
   */
  async resume() {
    const overlay = document.getElementById('daily-review-overlay');
    if (overlay) overlay.style.display = 'flex';

    try {
      if (typeof loadManifest === 'function') await loadManifest();
    } catch (e) {}

    const startScreen = document.getElementById('dr-start-screen');
    const shell = document.getElementById('dr-shell');
    if (startScreen) startScreen.style.display = 'none';
    if (shell) shell.style.display = 'flex';

    if (this.currentStep === 0) {
      this.currentStep = 1;
    }
    this.syncReviewDateUI();
    this.hookInterceptors();
    await this.loadStep(this.currentStep);
  },

  mountStep3NoteEditor() {
    const editorContainer = document.getElementById('dr-note-review-editor-container');
    const headerContainer = document.querySelector('.overlay-header-container');
    const metaWrap = document.getElementById('edit-meta-wrap');
    const overlayMain = document.querySelector('.overlay-main-layout');
    const inspectorPanel = document.getElementById('overlay-right-panel');
    if (!editorContainer || !metaWrap || !overlayMain || !inspectorPanel) return;

    if (headerContainer && !this.overlayHeaderOriginalParent) {
      this.overlayHeaderOriginalParent = headerContainer.parentElement;
      this.overlayHeaderOriginalNextSibling = headerContainer.nextSibling;
    }
    if (!this.editorMetaOriginalParent) {
      this.editorMetaOriginalParent = metaWrap.parentElement;
      this.editorMetaOriginalNextSibling = metaWrap.nextSibling;
    }
    if (!this.overlayMainOriginalParent) {
      this.overlayMainOriginalParent = overlayMain.parentElement;
      this.overlayMainOriginalNextSibling = overlayMain.nextSibling;
    }

    editorContainer.style.display = 'flex';
    editorContainer.style.flexDirection = 'column';
    editorContainer.style.minHeight = '0';
    editorContainer.style.gap = '0';
    editorContainer.innerHTML = '';

    if (headerContainer) {
      headerContainer.style.display = 'block';
      headerContainer.style.width = '100%';
      editorContainer.appendChild(headerContainer);
    }
    metaWrap.style.display = '';
    metaWrap.style.width = '100%';
    editorContainer.appendChild(metaWrap);

    overlayMain.style.display = 'flex';
    overlayMain.style.flex = '1 1 auto';
    overlayMain.style.minHeight = '0';
    overlayMain.style.width = '100%';
    editorContainer.appendChild(overlayMain);

    if (typeof relatedNotesOpen !== 'undefined') {
      relatedNotesOpen = false;
    }
    inspectorPanel.classList.add('collapsed');
    this.setStep3OverlayActionMode(true);
    this.hideStep3NotePreviewPane();
    if (typeof updateLLMToolbarVisibility === 'function') updateLLMToolbarVisibility();
  },

  restoreStep3NoteEditor() {
    const headerContainer = document.querySelector('.overlay-header-container');
    const metaWrap = document.getElementById('edit-meta-wrap');
    const overlayMain = document.querySelector('.overlay-main-layout');
    const overlayPanel = document.querySelector('#note-edit-overlay .overlay-panel');
    const noteEdit = document.getElementById('note-edit');

    if (headerContainer) headerContainer.style.display = '';
    if (metaWrap) metaWrap.style.display = '';
    if (overlayMain) overlayMain.style.display = '';
    if (typeof updateLLMToolbarVisibility === 'function') updateLLMToolbarVisibility();

    if (headerContainer && overlayPanel && headerContainer.parentElement !== overlayPanel) {
      overlayPanel.insertBefore(headerContainer, overlayPanel.firstChild);
    }
    if (overlayMain && overlayPanel && overlayMain.parentElement !== overlayPanel) {
      overlayPanel.appendChild(overlayMain);
    }
    if (metaWrap && noteEdit && metaWrap.parentElement !== noteEdit) {
      noteEdit.insertBefore(metaWrap, noteEdit.firstChild);
    }

    this.updateNoteEditorLockState(null);
    this.setStep3OverlayActionMode(false);
  },

  initOpenNotesListener() {
    if (this._openNotesListenerBound) return;
    this._openNotesListenerBound = true;
    if (window.AppBridge?.noteWindow?.onOpenNotesChanged) {
      window.AppBridge.noteWindow.onOpenNotesChanged(() => {
        this.handleOpenNotesChanged();
      });
    }
  },

  handleOpenNotesChanged() {
    if (this.currentStep === 4) {
      this.updateStep3NotesListBadges();
      this.updateNoteEditorLockState(this.activeNotePath);
    } else if (this.currentStep === 5) {
      const reviewDateStr = this.getReviewDateValue();
      const summaryPath = `notes/daily-summary-${reviewDateStr}.html`;
      this.updateNoteEditorLockState(summaryPath, 'dr-step5-editor-container');
    }
  },

  updateStep3NotesListBadges() {
    const listContainer = document.getElementById('dr-notes-to-review-list');
    if (!listContainer) return;
    listContainer.querySelectorAll('.dr-note-item-btn').forEach(btn => {
      const path = btn.dataset.notePath;
      const note = (this.todayNotes || []).find(n => n.path === path) || (typeof manifest !== 'undefined' ? manifest.find(n => n.path === path) : null);
      const isOpen = window.AppBridge?.noteWindow ? window.AppBridge.noteWindow.isNoteOpen(note?.id, path) : false;
      btn.classList.toggle('has-open-window', isOpen);
      let badge = btn.querySelector('.dr-note-open-window-badge');
      if (isOpen) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'dr-note-open-window-badge';
          badge.title = (typeof t === 'function' && t('dailyreview.noteOpenInWindowBadgeTooltip')) || 'Cette note est ouverte dans une fenêtre dédiée';
          badge.textContent = `🪟 ${(typeof t === 'function' && t('dailyreview.noteOpenInWindowBadge')) || 'Ouverte en fenêtre'}`;
          const cb = btn.querySelector('.dr-note-checkbox-indicator');
          if (cb) {
            btn.insertBefore(badge, cb);
          } else {
            btn.appendChild(badge);
          }
        }
      } else if (badge) {
        badge.remove();
      }
    });
  },

  updateNoteSummaryBadge(notePath, summaryText = '') {
    if (!notePath) return;
    const cleanText = (summaryText || '').replace(/<[^>]*>/g, '').trim();
    const hasSummary = cleanText.length > 0;

    if (Array.isArray(this.todayNotes)) {
      const targetNote = this.todayNotes.find(n => n.path === notePath || n.id === notePath);
      if (targetNote) {
        targetNote.summary = summaryText;
      }
    }

    const noteBtn = document.querySelector(`.dr-note-item-btn[data-note-path="${notePath}"]`);
    if (!noteBtn) return;

    let summaryBadge = noteBtn.querySelector('.dr-note-has-summary-badge');
    if (hasSummary) {
      noteBtn.classList.remove('no-summary');
      if (!summaryBadge) {
        summaryBadge = document.createElement('span');
        summaryBadge.className = 'dr-note-has-summary-badge';
        summaryBadge.textContent = `📝 ${typeof t === 'function' ? (t('dailyreview.hasSummaryBadge') || 'Summary') : 'Summary'}`;
        summaryBadge.title = typeof t === 'function' ? (t('dailyreview.hasSummaryTooltip') || 'This note has a summary') : 'This note has a summary';
        const cb = noteBtn.querySelector('.dr-note-checkbox-indicator');
        if (cb) {
          noteBtn.insertBefore(summaryBadge, cb);
        } else {
          noteBtn.appendChild(summaryBadge);
        }
      }
    } else if (summaryBadge) {
      summaryBadge.remove();
    }
  },

  updateNoteEditorLockState(notePath, targetContainerId = 'dr-note-review-editor-container') {
    const editorContainer = document.getElementById(targetContainerId);
    const noteEdit = document.getElementById('note-edit');
    const textarea = document.getElementById('edit-textarea');
    const summaryArea = document.getElementById('edit-summary');
    const titleInput = document.getElementById('edit-title');

    if (!notePath || !editorContainer) {
      if (editorContainer) editorContainer.classList.remove('dr-note-locked-external');
      if (noteEdit) noteEdit.classList.remove('dr-note-locked-external');
      const banner = document.getElementById('dr-note-open-window-banner');
      if (banner) banner.remove();
      if (textarea) textarea.contentEditable = 'true';
      if (summaryArea) summaryArea.contentEditable = 'true';
      if (titleInput) {
        titleInput.readOnly = false;
        titleInput.removeAttribute('disabled');
      }
      return;
    }

    const note = (this.todayNotes || []).find(n => n.path === notePath) || (typeof manifest !== 'undefined' ? manifest.find(n => n.path === notePath) : null) || { path: notePath };
    const isNoteOpen = window.AppBridge?.noteWindow ? window.AppBridge.noteWindow.isNoteOpen(note?.id, notePath) : false;

    if (isNoteOpen) {
      editorContainer.classList.add('dr-note-locked-external');
      if (noteEdit) noteEdit.classList.add('dr-note-locked-external');
      if (textarea) textarea.contentEditable = 'false';
      if (summaryArea) summaryArea.contentEditable = 'false';
      if (titleInput) {
        titleInput.readOnly = true;
        titleInput.setAttribute('disabled', 'true');
      }

      let banner = document.getElementById('dr-note-open-window-banner');
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'dr-note-open-window-banner';
        banner.className = 'dr-note-open-window-banner';
        banner.innerHTML = `
          <div class="dr-note-open-banner-icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
          </div>
          <div class="dr-note-open-banner-body">
            <div class="dr-note-open-banner-title">${(typeof t === 'function' && t('dailyreview.noteOpenInWindowBannerTitle')) || 'Note ouverte dans une fenêtre dédiée'}</div>
            <div class="dr-note-open-banner-msg">${(typeof t === 'function' && t('dailyreview.noteOpenInWindowBannerMsg')) || 'Cette note est actuellement ouverte dans une autre fenêtre. L\'édition est verrouillée ici pour éviter les conflits.'}</div>
          </div>
          <button type="button" class="btn btn-secondary dr-note-open-focus-btn" id="dr-note-focus-window-btn" title="${(typeof t === 'function' && t('dailyreview.noteOpenInWindowFocusBtnTooltip')) || 'Mettre au premier plan la fenêtre où cette note est ouverte'}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
            <span>${(typeof t === 'function' && t('dailyreview.noteOpenInWindowFocusBtn')) || 'Basculer vers la fenêtre'}</span>
          </button>
        `;
        const focusBtn = banner.querySelector('#dr-note-focus-window-btn');
        if (focusBtn) {
          focusBtn.onclick = (e) => {
            e.preventDefault();
            if (window.AppBridge?.noteWindow) {
              window.AppBridge.noteWindow.open(note?.id, notePath);
            }
          };
        }
        const metaWrap = document.getElementById('edit-meta-wrap');
        if (metaWrap && metaWrap.parentElement === editorContainer) {
          editorContainer.insertBefore(banner, metaWrap);
        } else if (editorContainer.firstChild) {
          editorContainer.insertBefore(banner, editorContainer.firstChild);
        } else {
          editorContainer.appendChild(banner);
        }
      }
    } else {
      editorContainer.classList.remove('dr-note-locked-external');
      if (noteEdit) noteEdit.classList.remove('dr-note-locked-external');
      const banner = document.getElementById('dr-note-open-window-banner');
      if (banner) banner.remove();
      if (textarea) textarea.contentEditable = 'true';
      if (summaryArea) summaryArea.contentEditable = 'true';
      if (titleInput) {
        titleInput.readOnly = false;
        titleInput.removeAttribute('disabled');
      }
    }
  },

  isCurrentNoteLocked(path) {
    if (!path) path = this.activeNotePath;
    if (!path) return false;
    if (this.currentStep !== 4 && this.currentStep !== 5) return false;
    const note = (this.todayNotes || []).find(n => n.path === path) || (typeof manifest !== 'undefined' ? manifest.find(n => n.path === path) : null);
    return window.AppBridge?.noteWindow ? window.AppBridge.noteWindow.isNoteOpen(note?.id, path) : false;
  },

  getDefaultDailySummaryTitle() {
    const dateDisplay = this.getReviewDateDisplay();
    const prefix = (typeof t === 'function' ? t('notes.dailySummary') : null) || 'Résumé quotidien';
    return `${prefix} - ${dateDisplay}`;
  },

  isMeetingTitle(title) {
    if (!title) return false;
    const norm = String(title).trim().toLowerCase();
    const notes = (this.todayNotes && this.todayNotes.length > 0) ? this.todayNotes : this.collectTodayNotes();
    return (notes || []).some(n => n && n.title && String(n.title).trim().toLowerCase() === norm);
  },

  collectTodayNotes(reviewDateStr) {
    if (!reviewDateStr) reviewDateStr = this.getReviewDateValue();
    const allNotes = (typeof manifest !== 'undefined' && Array.isArray(manifest)) ? manifest : [];

    // Collect all note IDs linked to today's planner events (primary or secondary)
    const linkedNoteIds = new Set();
    const evToday = (Array.isArray(plannerEvents) ? plannerEvents : [])
      .filter(ev => ev && ev.date === reviewDateStr && ev.type !== 'ooo');

    for (const ev of evToday) {
      if (ev.noteId) linkedNoteIds.add(String(ev.noteId).trim());
      if (Array.isArray(ev.linkedNoteIds)) {
        for (const id of ev.linkedNoteIds) {
          if (id) linkedNoteIds.add(String(id).trim());
        }
      }
    }

    const todayNotesRaw = allNotes.filter(note => {
      if (!note || !note.id) return false;
      const noteId = String(note.id).trim();
      const notePath = String(note.path || '');
      if (noteId.startsWith('retro-') || noteId.startsWith('summary-')) return false;
      if (notePath.startsWith('notes/daily-summary-') || notePath.startsWith('notes/summary-')) return false;
      if (Array.isArray(note.major_topic_tags) && note.major_topic_tags.includes("Daily Summary")) return false;
      if (Array.isArray(note.group_tags) && note.group_tags.includes("Summary")) return false;

      const isDateMatch = (note.date === reviewDateStr);
      const isUpdatedToday = (typeof note.updatedAt === 'string' && note.updatedAt.startsWith(reviewDateStr));
      const isModifiedToday = (typeof note.modified === 'string' && note.modified.startsWith(reviewDateStr));
      const isLinkedToTodayEvent = linkedNoteIds.has(noteId);

      return isDateMatch || isUpdatedToday || isModifiedToday || isLinkedToTodayEvent;
    });

    const orderByNoteId = new Map();
    evToday
      .slice()
      .sort((a, b) =>
        (a.date || '').localeCompare(b.date || '')
        || (a.startTime || '').localeCompare(b.startTime || '')
        || (a.endTime || '').localeCompare(b.endTime || '')
      )
      .forEach((ev, idx) => {
        if (ev.noteId && !orderByNoteId.has(String(ev.noteId).trim())) {
          orderByNoteId.set(String(ev.noteId).trim(), idx);
        }
        if (Array.isArray(ev.linkedNoteIds)) {
          for (const lid of ev.linkedNoteIds) {
            const trimmed = String(lid).trim();
            if (trimmed && !orderByNoteId.has(trimmed)) {
              orderByNoteId.set(trimmed, idx);
            }
          }
        }
      });

    return todayNotesRaw.slice().sort((a, b) => {
      const ia = orderByNoteId.has(String(a.id).trim()) ? orderByNoteId.get(String(a.id).trim()) : Number.POSITIVE_INFINITY;
      const ib = orderByNoteId.has(String(b.id).trim()) ? orderByNoteId.get(String(b.id).trim()) : Number.POSITIVE_INFINITY;
      if (ia !== ib) return ia - ib;
      return (a.title || '').localeCompare(b.title || '');
    });
  },

  async ensureDailySummaryNoteExists() {
    const reviewDateStr = this.getReviewDateValue();
    const summaryPath = `notes/daily-summary-${reviewDateStr}.html`;
    const allNotes = typeof manifest !== 'undefined' ? manifest : [];
    const existing = allNotes.find(n => n.path === summaryPath || n.id === `summary-${reviewDateStr}`);
    const defaultTitle = this.getDefaultDailySummaryTitle();
    
    if (!existing) {
      let fileAlreadyOnDisk = false;
      try {
        if (typeof StorageAPI !== 'undefined' && typeof StorageAPI.readNoteContent === 'function') {
          const diskContent = await StorageAPI.readNoteContent(summaryPath);
          if (diskContent && diskContent.trim() && diskContent.trim() !== '<p><br></p>') {
            fileAlreadyOnDisk = true;
          }
        }
      } catch (e) {}

      if (!fileAlreadyOnDisk) {
        const defaultHTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="group-tags" content="Summary">
  <meta name="major-topic-tags" content="Daily Summary">
  <meta name="topic-tags" content="">
  <meta name="extra-tags" content="">
  <title>${defaultTitle}</title>
</head>
<body>
  <main>
    <p><br></p>
  </main>
</body>
</html>`;
        try {
          if (typeof StorageAPI !== 'undefined' && typeof StorageAPI.writeNoteContent === 'function') {
            await StorageAPI.writeNoteContent(summaryPath, defaultHTML);
          }
        } catch (err) {
          console.warn("Could not auto-create daily summary note", err);
        }
      }
      const manifestItem = {
        id: `summary-${reviewDateStr}`,
        path: summaryPath,
        title: defaultTitle,
        date: reviewDateStr,
        group_tags: ["Summary"],
        major_topic_tags: ["Daily Summary"],
        topic_tags: [],
        extra_tags: [],
        summary: "",
        preview: "",
        reviewed: true,
        updatedAt: new Date().toISOString()
      };
      if (typeof manifest !== 'undefined') {
        const idx = manifest.findIndex(m => m.path === summaryPath || m.id === `summary-${reviewDateStr}`);
        if (idx !== -1) manifest[idx] = manifestItem;
        else manifest.push(manifestItem);
      }
    } else {
      // If summary note exists but has corrupted meeting title from prior title bleed, sanitize it back
      if (existing.title && this.isMeetingTitle(existing.title)) {
        existing.title = defaultTitle;
        if (typeof saveManifest === 'function') {
          saveManifest().catch(e => console.warn("Could not sanitize summary manifest title", e));
        }
      }
    }
    return summaryPath;
  },

  async compileManualDailySummary() {
    const dateDisplay = this.getReviewDateDisplay();
    const notes = this.todayNotes || [];
    const summaryHeading = (typeof t === 'function' ? t('notes.dailySummary') : null) || 'Résumé quotidien';
    const daySecHeading = (typeof t === 'function' ? t('dailyreview.summarySectionDay') : null) || 'Résumé de la journée';
    const projSecHeading = (typeof t === 'function' ? t('dailyreview.summarySectionProjects') : null) || 'Progrès par projet';
    const pendSecHeading = (typeof t === 'function' ? t('dailyreview.summarySectionPending') : null) || 'Sujets en attente ou nouveaux à aborder';
    const reviewedNotesHeading = (typeof t === 'function' ? t('dailyreview.summarySectionReviewedNotes', { count: notes.length }) : null) || `Notes et activités révisées (${notes.length})`;
    const timeSpentHeading = (typeof t === 'function' ? t('dailyreview.summarySectionTimeSpent') : null) || 'Temps passé par sujet';
    const noNotesText = (typeof t === 'function' ? t('dailyreview.noNotesReviewedToday') : null) || 'Aucune note créée ou révisée aujourd\'hui.';
    const largeBlockText = (typeof t === 'function' ? t('dailyreview.summaryLargeBlockFlag') : null) || 'bloc de temps important';

    let html = `<h2>${summaryHeading} — ${dateDisplay}</h2>\n\n`;

    html += `<h3>${daySecHeading}</h3>\n<p></p>\n\n`;
    html += `<h3>${projSecHeading}</h3>\n<p></p>\n\n`;
    html += `<h3>${pendSecHeading}</h3>\n<ul>\n  <li></li>\n</ul>\n\n`;

    html += `<h3>${reviewedNotesHeading}</h3>\n`;
    if (notes.length === 0) {
      html += `<p><em>${noNotesText}</em></p>\n\n`;
    } else {
      html += `<ul>\n`;
      for (const n of notes) {
        let plainSummary = (n.summary || '').replace(/<[^>]*>/g, '').trim();
        if (!plainSummary && n.path && typeof StorageAPI !== 'undefined' && typeof StorageAPI.readNoteContent === 'function') {
          try {
            const rawHtml = await StorageAPI.readNoteContent(n.path);
            const parsed = (typeof parseNoteHTML === 'function') ? parseNoteHTML(rawHtml) : null;
            if (parsed && parsed.summary) {
              plainSummary = parsed.summary.replace(/<[^>]*>/g, '').trim();
            }
            if (!plainSummary && parsed && parsed.mainHTML) {
              const text = parsed.mainHTML.replace(/<[^>]*>/g, '').trim();
              if (text) plainSummary = text.slice(0, 300) + (text.length > 300 ? '...' : '');
            }
          } catch (e) {
            console.warn('Failed to load note summary for manual daily summary compile', e);
          }
        }
        const nId = n.id || (n.path ? n.path.replace(/^notes\//i, '').replace(/\.html$/i, '') : '');
        const isDummy = (t, id) => !t || t === id || t === 'Untitled' || t === 'Untitled Note' || /^\d{4}-\d{2}-\d{2}(-\d+)?$/.test(t) || /^note[-_]/.test(t);
        const displayTitle = (!isDummy(n.title, nId) ? n.title : (parsed?.title && !isDummy(parsed.title, nId) ? parsed.title : (n.title || n.path)));
        if (!plainSummary) {
          plainSummary = displayTitle;
        }
        html += `  <li><strong>${escH(displayTitle)}</strong>: ${escH(plainSummary)}</li>\n`;
      }
      html += `</ul>\n\n`;
    }

    // Time spent per topic (from planner blocs) — parity with the AI summary path.
    const reviewDateStr = this.getReviewDateValue();
    const parseHM = (s) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(s || '')); return m ? (parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) : null; };
    const blocMinutes = (ev) => { const a = parseHM(ev.startTime), b = parseHM(ev.endTime); if (a != null && b != null && b >= a) return b - a; const d = Number(ev.duration); return Number.isFinite(d) && d > 0 ? d : 0; };
    const fmtDur = (mins) => { const h = Math.floor(mins / 60), m = mins % 60; return h > 0 ? (m > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`) : `${m}min`; };
    const evToday = (Array.isArray(plannerEvents) ? plannerEvents : []).filter(ev => ev && ev.date === reviewDateStr && ev.type !== 'ooo' && ev.type !== 'custom');
    const rowsByLabel = new Map();
    for (const ev of evToday) {
      const note = ev.noteId ? notes.find(n => n.id === ev.noteId) : null;
      const noteId = note ? (note.id || (note.path ? note.path.replace(/^notes\//i, '').replace(/\.html$/i, '') : '')) : '';
      const isDummy = (t, id) => !t || t === id || t === 'Untitled' || t === 'Untitled Note' || /^\d{4}-\d{2}-\d{2}(-\d+)?$/.test(t) || /^note[-_]/.test(t);
      const noteTitle = note ? (!isDummy(note.title, noteId) ? note.title : (note.title || note.path)) : null;
      const label = noteTitle || String(ev.title || ev.type || 'Untitled block').trim();
      rowsByLabel.set(label, (rowsByLabel.get(label) || 0) + blocMinutes(ev));
    }
    const timeRows = Array.from(rowsByLabel.entries()).filter(([, mins]) => mins > 0).sort((a, b) => b[1] - a[1]);
    if (timeRows.length) {
      html += `<h3>${timeSpentHeading}</h3>\n<ul>\n`;
      for (const [label, mins] of timeRows) {
        const flag = mins >= 90 ? ` — ${largeBlockText}` : '';
        html += `  <li><strong>${escH(label)}</strong>: ${escH(fmtDur(mins))}${escH(flag)}</li>\n`;
      }
      html += `</ul>\n`;
    }

    return html;
  },

  async mountStep5NoteEditor() {
    const editorContainer = document.getElementById('dr-step5-editor-container');
    const headerContainer = document.querySelector('.overlay-header-container');
    const metaWrap = document.getElementById('edit-meta-wrap');
    const overlayMain = document.querySelector('.overlay-main-layout');
    const inspectorPanel = document.getElementById('overlay-right-panel');
    if (!editorContainer || !metaWrap || !overlayMain || !inspectorPanel) return;

    if (headerContainer && !this.overlayHeaderOriginalParent) {
      this.overlayHeaderOriginalParent = headerContainer.parentElement;
      this.overlayHeaderOriginalNextSibling = headerContainer.nextSibling;
    }
    if (!this.editorMetaOriginalParent) {
      this.editorMetaOriginalParent = metaWrap.parentElement;
      this.editorMetaOriginalNextSibling = metaWrap.nextSibling;
    }
    if (!this.overlayMainOriginalParent) {
      this.overlayMainOriginalParent = overlayMain.parentElement;
      this.overlayMainOriginalNextSibling = overlayMain.nextSibling;
    }

    editorContainer.style.display = 'flex';
    editorContainer.style.flexDirection = 'column';
    editorContainer.style.minHeight = '0';
    editorContainer.style.gap = '0';
    editorContainer.innerHTML = '';

    if (headerContainer) {
      headerContainer.style.display = 'none';
      headerContainer.style.width = '100%';
      editorContainer.appendChild(headerContainer);
    }
    // Hide metadata bar in Step 5 so metadata is auto-filled behind the scenes
    metaWrap.style.display = 'none';
    metaWrap.style.width = '100%';
    editorContainer.appendChild(metaWrap);

    overlayMain.style.display = 'flex';
    overlayMain.style.flex = '1 1 auto';
    overlayMain.style.minHeight = '0';
    overlayMain.style.width = '100%';
    editorContainer.appendChild(overlayMain);

    if (typeof relatedNotesOpen !== 'undefined') {
      relatedNotesOpen = false;
    }
    inspectorPanel.classList.add('collapsed');
    this.setStep3OverlayActionMode(false);

    // Hide validate note button specifically in Step 5
    const validateBtn = document.getElementById('overlay-validate-note-btn');
    if (validateBtn) {
      validateBtn.style.setProperty('display', 'none', 'important');
    }

    if (!this.todayNotes || this.todayNotes.length === 0) {
      this.todayNotes = this.collectTodayNotes();
    }

    // Ensure Daily Summary Note file exists before calling openNoteOverlay
    const reviewDateStr = this.getReviewDateValue();
    const summaryPath = await this.ensureDailySummaryNoteExists();
    if (typeof openNoteOverlay === 'function') {
      await openNoteOverlay(summaryPath, null, null, false, null, { sameWindow: true, embeddedInDailyReview: true });
      if (typeof setOverlayViewMode === 'function') setOverlayViewMode(false);
      if (typeof metadataCollapsed !== 'undefined') {
        metadataCollapsed = true;
        if (typeof _applyMetadataCollapseState === 'function') _applyMetadataCollapseState();
        if (typeof _updateMetaTitlePreview === 'function') _updateMetaTitlePreview();
      }
    }

    // Ensure validate button stays hidden after openNoteOverlay runs
    if (validateBtn) {
      validateBtn.style.setProperty('display', 'none', 'important');
    }

    // Auto-fill summary content if note is empty or AI is disabled
    const isAIEnabled = typeof LLMService !== 'undefined' && LLMService.isEnabled();
    const editArea = document.getElementById('edit-textarea');
    const contentTextarea = document.getElementById('dr-ai-summary-content');
    const isDefaultTemplate = editArea && (
      (typeof getDefaultNoteTemplateHTML === 'function' && editArea.innerHTML.trim() === getDefaultNoteTemplateHTML().trim()) ||
      (typeof getDefaultNoteTemplateHTML === 'function' && typeof DOMParser !== 'undefined' && (editArea.textContent.replace(/\s+/g, ' ').trim() === (new DOMParser().parseFromString(getDefaultNoteTemplateHTML(), 'text/html').body.textContent || '').replace(/\s+/g, ' ').trim()))
    );
    const isCurrentEmpty = !editArea || !editArea.textContent.trim() || editArea.innerHTML === '<p><br></p>' || editArea.innerHTML === '<p></p>' || isDefaultTemplate;

    const isCurrentNoteSummary = typeof currentNote !== 'undefined' && currentNote && 
      (currentNote.id === `summary-${reviewDateStr}` || currentNote.path === summaryPath);

    if (isCurrentEmpty && isCurrentNoteSummary) {
      const summaryHTML = await this.compileManualDailySummary();
      if (editArea) {
        editArea.innerHTML = summaryHTML;
      }
      if (contentTextarea) {
        contentTextarea.innerHTML = summaryHTML;
      }
      if (currentNote) {
        currentNote.mainHTML = summaryHTML;
      }
      await this.autosaveAISummaryNote();
    }

    // Hide the standalone overlay popover dialog wrapper so it doesn't cover Step 5 as a white screen
    const overlay = document.getElementById('note-edit-overlay');
    if (overlay) {
      overlay.style.display = 'none';
    }
  },

  async openStandaloneNoteReader(notePath) {
    if (!notePath || typeof openNoteOverlay !== 'function') return;
    this.restoreStep3NoteEditor();
    await openNoteOverlay(notePath, null, null, false, null, { viewMode: true, sameWindow: true });
    if (typeof setOverlayViewMode === 'function') setOverlayViewMode(true);
    const overlay = document.getElementById('note-edit-overlay');
    if (overlay) overlay.style.display = 'flex';
  },

  async insertNoteIntoSummary(notePath) {
    if (!notePath) return;
    const note = (this.todayNotes || []).find(n => n.path === notePath) ||
      (typeof manifest !== 'undefined' && Array.isArray(manifest) ? manifest.find(n => n.path === notePath) : null);
    if (!note) return;

    let summaryText = (note.summary || '').replace(/<[^>]*>/g, '').trim();
    if (!summaryText && note.path && typeof StorageAPI !== 'undefined' && typeof StorageAPI.readNoteContent === 'function') {
      try {
        const raw = await StorageAPI.readNoteContent(note.path);
        const parsed = (typeof parseNoteHTML === 'function') ? parseNoteHTML(raw) : null;
        if (parsed?.summary) summaryText = parsed.summary.replace(/<[^>]*>/g, '').trim();
        else if (parsed?.mainHTML) {
          const t = parsed.mainHTML.replace(/<[^>]*>/g, '').trim();
          if (t) summaryText = t.slice(0, 300) + (t.length > 300 ? '...' : '');
        }
      } catch (e) {}
    }

    const editArea = document.getElementById('edit-textarea');
    const contentTextarea = document.getElementById('dr-ai-summary-content');
    const noteId = note.id || (note.path ? note.path.replace(/^notes\//i, '').replace(/\.html$/i, '') : '');
    const isDummy = (t, id) => !t || t === id || t === 'Untitled' || t === 'Untitled Note' || /^\d{4}-\d{2}-\d{2}(-\d+)?$/.test(t) || /^note[-_]/.test(t);
    const displayTitle = (!isDummy(note.title, noteId) ? note.title : (parsed?.title && !isDummy(parsed.title, noteId) ? parsed.title : (note.title || note.path)));
    const itemHTML = `<li><strong>${escH(displayTitle)}</strong>: ${escH(summaryText || displayTitle || '')}</li>`;

    if (editArea) {
      const ul = editArea.querySelector('ul');
      if (ul) {
        ul.insertAdjacentHTML('beforeend', itemHTML);
      } else {
        editArea.insertAdjacentHTML('beforeend', `<ul>${itemHTML}</ul>`);
      }
    }
    if (contentTextarea) {
      const ul = contentTextarea.querySelector('ul');
      if (ul) {
        ul.insertAdjacentHTML('beforeend', itemHTML);
      } else {
        contentTextarea.insertAdjacentHTML('beforeend', `<ul>${itemHTML}</ul>`);
      }
    }

    const reviewDateStr = this.getReviewDateValue();
    const isCurrentNoteSummary = (typeof currentNote !== 'undefined' && currentNote && 
      (currentNote.id === `summary-${reviewDateStr}` || currentNote.path === `notes/daily-summary-${reviewDateStr}.html`));
    if (isCurrentNoteSummary && editArea) {
      currentNote.mainHTML = editArea.innerHTML;
    }

    await this.autosaveAISummaryNote();
    if (typeof toast === 'function') {
      toast(t('dailyreview.noteInsertedToast') || 'Note insérée dans le résumé');
    }
  },

  switchStep5Tab(tabName) {
    const tabNoteBtn = document.getElementById('dr-tab-summary-note');
    const tabListBtn = document.getElementById('dr-tab-summaries-list');
    const tabWsBtn = document.getElementById('dr-tab-workstream-updates');
    const noteContent = document.getElementById('dr-step5-tab-note');
    const listContent = document.getElementById('dr-step5-tab-list');
    const wsContent = document.getElementById('dr-step5-tab-workstreams');

    if (tabNoteBtn) tabNoteBtn.classList.toggle('active', tabName === 'note');
    if (tabListBtn) tabListBtn.classList.toggle('active', tabName === 'list');
    if (tabWsBtn) tabWsBtn.classList.toggle('active', tabName === 'workstreams');

    if (noteContent) noteContent.style.display = (tabName === 'note') ? 'flex' : 'none';
    if (listContent) listContent.style.display = (tabName === 'list') ? 'flex' : 'none';
    if (wsContent) wsContent.style.display = (tabName === 'workstreams') ? 'flex' : 'none';

    if (tabName === 'note') {
      this.mountStep5NoteEditor();
    } else if (tabName === 'list') {
      this.refreshStep5SummariesList();
    } else if (tabName === 'workstreams') {
      this.renderStep5WorkstreamUpdatesList();
    }
  },

  openWorkstreamDossier(wsName) {
    if (!wsName) return;
    if (typeof switchTab === 'function') {
      switchTab('decisions');
    }
    if (typeof openTopicMemoryModal === 'function') {
      openTopicMemoryModal(wsName);
    }
  },

  renderStep5WorkstreamUpdatesList() {
    const container = document.getElementById('dr-ai-workstream-updates-list');
    const countBadge = document.getElementById('dr-step5-ws-count');
    if (!container) return;

    container.innerHTML = '';
    const list = this.workstreamUpdateStatuses || [];
    if (countBadge) countBadge.textContent = list.length;

    if (list.length === 0) {
      container.innerHTML = `<div style="font-size:0.82rem; color:var(--text-muted); text-align:center; padding:1.5rem;">${t('dailyreview.noWorkstreamUpdates') || 'No workstream updates extracted from today\'s notes.'}</div>`;
      return;
    }

    list.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'retro-item-card';
      card.style.padding = '0.9rem';
      card.style.display = 'flex';
      card.style.flexDirection = 'column';
      card.style.gap = '0.5rem';
      card.style.border = '1px solid var(--card-border)';
      card.style.borderRadius = 'var(--radius-sm)';
      card.style.background = 'var(--card-bg-alt)';

      const wsIcon = (typeof AppIcons !== 'undefined' && AppIcons.get)
        ? AppIcons.get('workstream', { size: 12 })
        : '<svg class="app-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 9v12"/><path d="M18 9a9 9 0 0 0-9 9"/></svg>';
      const isUntaggedTag = item.is_untagged_source ? `<span style="font-size:0.7rem; background:color-mix(in srgb, var(--accent) 15%, transparent); color:var(--accent); padding:2px 6px; border-radius:4px; font-weight:600; display:inline-flex; align-items:center; gap:4px;" title="${escA(t('dailyreview.workstreamExtractedFromUntagged') || 'Extracted from non-workstream tagged note')}">${wsIcon} <span>${escH(t('dailyreview.workstreamExtractedFromUntagged') || 'Extracted from non-workstream tagged note')}</span></span>` : '';

      let statusHTML = '';
      if (item.status === 'syncing') {
        statusHTML = `<span style="font-size:0.75rem; color:var(--text-muted); display:flex; align-items:center; gap:4px;"><span class="spinner" style="width:12px; height:12px; border-width:2px;"></span> ${escH(t('dailyreview.workstreamAgentSyncing') || 'Updating Workstream Agent in background...')}</span>`;
      } else if (item.status === 'synced') {
        statusHTML = `<span style="font-size:0.75rem; color:var(--color-low, #10b981); font-weight:600;">✓ ${escH(t('dailyreview.workstreamAgentSynced') || 'Synced with Workstream Agent')}</span>`;
      } else if (item.status === 'cancelled') {
        statusHTML = `<span style="font-size:0.75rem; color:var(--text-muted);">🚫 ${escH(t('dailyreview.workstreamAgentCancelled') || 'Sync cancelled')}</span>`;
      } else {
        statusHTML = `<span style="font-size:0.75rem; color:var(--color-high, #ef4444);">⚠️ Sync error</span>`;
      }

      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
          <div style="font-size:0.9rem; font-weight:700; color:var(--text); display:flex; align-items:center; gap:6px;">
            <span>⚖️ ${escH(item.workstream)}</span>
          </div>
          ${isUntaggedTag}
        </div>
        <div style="font-size:0.83rem; color:var(--text-secondary); line-height:1.4; white-space:pre-wrap;">${escH(item.updates)}</div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:0.3rem;">
          ${statusHTML}
          <button class="btn btn-secondary" onclick="DailyReviewController.openWorkstreamDossier(${jq(item.workstream)})" style="padding:3px 8px; font-size:0.73rem;" title="${escA(t('dailyreview.openWorkstreamDossier') || 'Open Workstream')}">
            ${escH(t('dailyreview.openWorkstreamDossier') || 'Open Workstream')}
          </button>
        </div>
      `;
      container.appendChild(card);
    });
  },

  updateStep5SyncBanner(options = {}) {
    const banner = document.getElementById('dr-workstream-sync-banner');
    const statusText = document.getElementById('dr-ws-sync-status-text');
    const progressBar = document.getElementById('dr-ws-sync-progress-bar');
    const spinner = document.getElementById('dr-ws-sync-spinner');
    if (!banner) return;

    if (options.hide || !this.workstreamUpdateStatuses || this.workstreamUpdateStatuses.length === 0) {
      banner.style.display = 'none';
      banner.classList.remove('dr-ws-sync-complete');
      return;
    }

    const total = this.workstreamUpdateStatuses.length;
    const syncedCount = this.workstreamUpdateStatuses.filter(s => s.status === 'synced').length;
    const isFinished = (syncedCount >= total) || options.complete;
    const currentItem = options.currentItem || this.workstreamUpdateStatuses.find(s => s.status === 'syncing');

    banner.style.display = 'flex';
    if (isFinished) {
      banner.classList.add('dr-ws-sync-complete');
      if (progressBar) progressBar.style.width = '100%';
      if (statusText) {
        statusText.textContent = (typeof t === 'function' 
          ? t('dailyreview.workstreamSyncComplete', { total }) 
          : `Tous les ${total} dossiers thématiques ont été actualisés`);
      }
      if (spinner) spinner.style.display = 'none';
    } else {
      banner.classList.remove('dr-ws-sync-complete');
      const currentIdx = currentItem ? this.workstreamUpdateStatuses.indexOf(currentItem) + 1 : Math.min(syncedCount + 1, total);
      const progressPercent = total > 0 ? Math.round(((currentIdx - 1) / total) * 100) : 0;
      if (progressBar) progressBar.style.width = `${progressPercent}%`;
      const name = currentItem?.workstream || '';
      if (statusText) {
        statusText.textContent = (typeof t === 'function' 
          ? t('dailyreview.workstreamSyncingProgress', { current: currentIdx, total, name }) 
          : `Mise à jour du dossier thématique (${currentIdx}/${total}) : "${name}"...`);
      }
      if (spinner) spinner.style.display = '';
    }

    const nextBtn = document.getElementById('btn-dr-next');
    if (this.currentStep === 5 && nextBtn && !this.isClosingDay) {
      if (!isFinished && !options.hide) {
        nextBtn.innerHTML = '<span class="spinner" style="width:13px;height:13px;display:inline-block;vertical-align:middle;margin-right:6px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;"></span>' + escH(t('dailyreview.workstreamSyncingBtn') || 'Mise à jour des dossiers...');
        nextBtn.title = t('dailyreview.workstreamSyncingTooltip') || 'Les dossiers thématiques sont en cours d\'actualisation en arrière-plan. Cliquez pour finaliser et clôturer la journée.';
      } else {
        const lang = (typeof getAppLanguage === 'function') ? getAppLanguage() : 'fr';
        nextBtn.innerHTML = '✓ ' + escH(t('dailyreview.commitBtn') || (lang === 'fr' ? 'Clôturer la journée' : (lang === 'de' ? 'Tag abschließen' : 'Close Day')));
        nextBtn.title = t('dailyreview.commitBtnTooltip') || (lang === 'fr' ? 'Enregistrer le bilan quotidien et clôturer la journée' : 'Save daily summary and close day');
      }
    }
  },

  processWorkstreamUpdatesInBackground(updates = []) {
    this.cancelWorkstreamUpdates();
    if (!Array.isArray(updates) || updates.length === 0) {
      this.workstreamUpdateStatuses = [];
      this.renderStep5WorkstreamUpdatesList();
      this.updateStep5SyncBanner({ hide: true });
      return;
    }

    // Filter updates against known active workstreams to avoid rogue syncs
    let validWorkstreams = new Set();
    if (typeof _topicMemoriesIndexCache !== 'undefined' && _topicMemoriesIndexCache?.topics) {
      _topicMemoriesIndexCache.topics.filter(t => t && t.status !== 'archived').forEach(t => {
        const name = (t.topicName || t.key || '').trim().toLowerCase();
        if (name) validWorkstreams.add(name);
      });
    }
    if (validWorkstreams.size === 0 && typeof getKnownWorkstreamsList === 'function') {
      const knownList = getKnownWorkstreamsList(typeof manifest !== 'undefined' ? manifest : []);
      knownList.forEach(w => {
        const name = String(w || '').trim().toLowerCase();
        if (name) validWorkstreams.add(name);
      });
    }

    const filteredUpdates = (validWorkstreams.size > 0)
      ? updates.filter(u => u && u.workstream && validWorkstreams.has(String(u.workstream).trim().toLowerCase()))
      : updates;

    if (filteredUpdates.length === 0) {
      this.workstreamUpdateStatuses = [];
      this.renderStep5WorkstreamUpdatesList();
      this.updateStep5SyncBanner({ hide: true });
      return;
    }

    this.workstreamUpdatesAbortController = new AbortController();
    const signal = this.workstreamUpdatesAbortController.signal;

    this.workstreamUpdateStatuses = filteredUpdates.map(u => ({
      workstream: u.workstream || 'Workstream',
      updates: u.updates || '',
      is_untagged_source: !!u.is_untagged_source,
      status: 'syncing'
    }));

    this.renderStep5WorkstreamUpdatesList();
    this.updateStep5SyncBanner();

    this.workstreamSyncPromise = this.runBackgroundWorkstreamSync(signal).catch(err => {
      if (err.name !== 'AbortError') {
        console.error('Error in background workstream sync:', err);
      }
    });
  },

  async runBackgroundWorkstreamSync(signal) {
    if (!Array.isArray(this.workstreamUpdateStatuses) || this.workstreamUpdateStatuses.length === 0) return;

    for (let i = 0; i < this.workstreamUpdateStatuses.length; i++) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const item = this.workstreamUpdateStatuses[i];
      if (!item.workstream || !item.updates) continue;

      this.updateStep5SyncBanner({ currentItem: item });

      try {
        const engine = (typeof WorkstreamMemoryEngine !== 'undefined' && WorkstreamMemoryEngine) || (typeof window !== 'undefined' && window.WorkstreamMemoryEngine);
        if (engine && typeof engine.synthesizeWorkstreamMemoryWithAI === 'function') {
          await engine.synthesizeWorkstreamMemoryWithAI(item.workstream, {
            prompt: item.updates,
            mode: 'incremental',
            signal: signal
          });
        }
        if (!signal.aborted) {
          item.status = 'synced';
          this.renderStep5WorkstreamUpdatesList();
          this.updateStep5SyncBanner();
        }
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        console.warn(`Workstream Agent background update failed for "${item.workstream}":`, err);
        item.status = 'failed';
        this.renderStep5WorkstreamUpdatesList();
        this.updateStep5SyncBanner();
      }
    }

    if (!signal.aborted) {
      this.updateStep5SyncBanner({ complete: true });
    }
  },

  cancelWorkstreamUpdates() {
    if (this.workstreamUpdatesAbortController) {
      this.workstreamUpdatesAbortController.abort();
      this.workstreamUpdatesAbortController = null;
    }
    this.workstreamSyncPromise = null;
    if (Array.isArray(this.workstreamUpdateStatuses)) {
      this.workstreamUpdateStatuses.forEach(u => {
        if (u.status === 'syncing') u.status = 'cancelled';
      });
      this.renderStep5WorkstreamUpdatesList();
    }
    this.updateStep5SyncBanner({ hide: true });
  },

  async refreshStep5SummariesList() {
    const refList = document.getElementById('dr-ai-meeting-summaries-list');
    const countBadge = document.getElementById('dr-step5-notes-count');
    if (!refList) return;

    refList.innerHTML = '';
    const activeLang = (typeof getAppLanguage === 'function') ? getAppLanguage() : 'fr';

    const dateStr = this.getReviewDateValue();
    const targetNotes = this.collectTodayNotes(dateStr);
    this.todayNotes = targetNotes;

    if (countBadge) countBadge.textContent = targetNotes.length;

    if (targetNotes.length > 0) {
      for (const n of targetNotes) {
        const card = document.createElement('div');
        card.className = 'dr-meeting-summary-card';
        
        const header = document.createElement('div');
        header.className = 'dr-card-header';
        
        const titleLink = document.createElement('a');
        titleLink.className = 'dr-card-title';
        titleLink.href = '#';
        titleLink.textContent = n.title || (typeof t === 'function' ? t('common.untitled') : 'Sans titre');
        titleLink.title = (typeof t === 'function' ? t('editor.openNoteTooltip') : null) || 'Ouvrir cette note en mode lecture';
        titleLink.onclick = (e) => {
          e.preventDefault();
          this.openStandaloneNoteReader(n.path);
        };
        header.appendChild(titleLink);

        if (n.group) {
          const badge = document.createElement('span');
          badge.className = 'dr-card-group-tag';
          badge.textContent = n.group;
          header.appendChild(badge);
        }

        card.appendChild(header);

        let summaryText = n.summary || '';
        if (!summaryText && n.path && typeof StorageAPI !== 'undefined' && typeof StorageAPI.readNoteContent === 'function') {
          try {
            const rawHtml = await StorageAPI.readNoteContent(n.path);
            const parsed = (typeof parseNoteHTML === 'function') ? parseNoteHTML(rawHtml) : null;
            if (parsed && parsed.summaryHTML) summaryText = parsed.summaryHTML;
            else if (parsed && parsed.previewText) summaryText = parsed.previewText;
          } catch(err) {}
        }

        const body = document.createElement('div');
        body.className = 'dr-card-body';
        if (summaryText) {
          body.innerHTML = summaryText;
        } else {
          body.innerHTML = `<p><em>${escH((typeof t === 'function' ? t('dailyreview.noSummaryAvailable') : null) || 'Aucun résumé disponible.')}</em></p>`;
        }
        card.appendChild(body);

        const footer = document.createElement('div');
        footer.className = 'dr-card-footer';
        footer.style.display = 'flex';
        footer.style.gap = '0.5rem';

        const openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className = 'btn btn-secondary btn-sm dr-open-note-btn';
        openBtn.innerHTML = `📖 ${escH((typeof t === 'function' ? t('dailyreview.readNoteBtn') : null) || 'Lire la note')}`;
        openBtn.title = (typeof t === 'function' ? t('dailyreview.readNoteBtnTooltip') : null) || 'Ouvrir cette note en mode lecture dans une fenêtre séparée';
        openBtn.onclick = (e) => {
          e.preventDefault();
          this.openStandaloneNoteReader(n.path);
        };
        footer.appendChild(openBtn);

        const insertBtn = document.createElement('button');
        insertBtn.type = 'button';
        insertBtn.className = 'btn btn-secondary btn-sm dr-insert-note-btn';
        insertBtn.innerHTML = `+ 📝 ${escH((typeof t === 'function' ? t('dailyreview.insertIntoSummaryBtn') : null) || 'Insérer dans le résumé')}`;
        insertBtn.title = (typeof t === 'function' ? t('dailyreview.insertIntoSummaryTooltip') : null) || 'Insérer le titre et le résumé de cette note dans votre note journalière';
        insertBtn.onclick = async (e) => {
          e.preventDefault();
          await this.insertNoteIntoSummary(n.path);
        };
        footer.appendChild(insertBtn);

        card.appendChild(footer);

        refList.appendChild(card);
      }
    } else {
      const noNotesText = (typeof t === 'function' ? t('dailyreview.noNotesReviewedToday') : null) || 'Aucune note créée ou révisée aujourd\'hui.';
      refList.innerHTML = `<div style="padding:16px; text-align:center; color:var(--text-muted); font-style:italic;">${escH(noNotesText)}</div>`;
    }
  },

  setStep3OverlayActionMode(reviewMode) {
    const validateBtn = document.getElementById('overlay-validate-note-btn');
    const closeBtn = document.getElementById('overlay-close-note-btn');
    if (!validateBtn || !closeBtn) return;

    if (!validateBtn.dataset.originalTitle) validateBtn.dataset.originalTitle = validateBtn.title || 'Validate note';
    if (!closeBtn.dataset.originalTitle) closeBtn.dataset.originalTitle = closeBtn.title || 'Close (ESC)';

    validateBtn.style.display = reviewMode ? '' : 'none';
    closeBtn.style.display = reviewMode ? 'none' : '';
    validateBtn.title = reviewMode ? (t('dailyreview.markReviewed') || validateBtn.dataset.originalTitle) : validateBtn.dataset.originalTitle;
    closeBtn.title = closeBtn.dataset.originalTitle;
  },

  revealStep3NotePreviewPane() {},
  hideStep3NotePreviewPane() {},

  getReviewDateValue() {
    return this.reviewDateValue || this.reviewDate || formatLocalDateValue(new Date());
  },

  getReviewDate() {
    const parsed = parseLocalDateValue(this.getReviewDateValue());
    const fallback = new Date();
    const date = parsed || fallback;
    date.setHours(0, 0, 0, 0);
    return date;
  },

  getReviewDateDisplay() {
    const date = this.getReviewDate();
    return new Intl.DateTimeFormat(getAppLocale(), {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    }).format(date);
  },

  loadIgnoredBlocks() {
    const reviewDateStr = this.getReviewDateValue();
    try {
      const stored = localStorage.getItem(`secretary_ignored_blocks_${reviewDateStr}`);
      if (stored) {
        this.ignoredBlockIds = new Set(JSON.parse(stored));
      } else {
        this.ignoredBlockIds = new Set();
      }
    } catch (e) {
      console.warn('Failed to load ignored blocks from localStorage', e);
      this.ignoredBlockIds = new Set();
    }
  },

  saveIgnoredBlocks() {
    const reviewDateStr = this.getReviewDateValue();
    try {
      localStorage.setItem(`secretary_ignored_blocks_${reviewDateStr}`, JSON.stringify([...this.ignoredBlockIds]));
    } catch (e) {
      console.warn('Failed to save ignored blocks to localStorage', e);
    }
  },

  getPlannerReviewDates(daysCount = 3) {
    const base = this.getReviewDate();
    const dates = [];
    for (let i = 0; i < daysCount; i++) {
      const date = new Date(base);
      date.setDate(base.getDate() + i);
      dates.push(formatLocalDateValue(date));
    }
    return dates.filter(Boolean);
  },

  getStep3NotePaneDefaultWidth() {
    return 320;
  },

  getStep3NotePaneBounds(splitWidth) {
    const safeWidth = Math.max(360, Math.floor(splitWidth || 0));
    const minW = 0;
    const maxByRatio = Math.floor(safeWidth * 0.48);
    const maxByContainer = Math.max(0, safeWidth - 360);
    const maxW = Math.max(minW, Math.min(maxByRatio, maxByContainer));
    return { minW, maxW };
  },

  loadStep3NotePaneWidth() {
    try {
      const stored = localStorage.getItem('secretary_dr_step3_left_width');
      if (stored) {
        const val = parseInt(stored, 10);
        if (!isNaN(val) && val >= 180 && val <= 600) return val;
      }
    } catch (_e) {}
    const sess = typeof sessionStorage !== 'undefined' ? parseInt(sessionStorage.getItem('secretaryDailyReviewStep3NotePaneWidth') || '', 10) : NaN;
    return (Number.isFinite(sess) && sess >= 180 && sess <= 600) ? sess : this.getStep3NotePaneDefaultWidth();
  },

  saveStep3NotePaneWidth(width) {
    const numericWidth = Math.round(width);
    if (!Number.isFinite(numericWidth) || numericWidth < 180 || numericWidth > 600) return;
    this.step3NotePaneWidth = numericWidth;
    try {
      localStorage.setItem('secretary_dr_step3_left_width', String(numericWidth));
      sessionStorage.setItem('secretaryDailyReviewStep3NotePaneWidth', String(numericWidth));
    } catch (e) {}
  },

  setStepTitle(stepNum) {
    const titleEl = document.getElementById('dr-step-title');
    if (!titleEl) return;

    const titleKeys = {
      1: 'dailyreview.step1Title',
      2: 'dailyreview.step2Title',
      3: 'dailyreview.step3Title',
      4: 'dailyreview.step4Title',
      5: 'dailyreview.stepAITitle'
    };

    const key = titleKeys[stepNum];
    let title = '';
    if (key === 'dailyreview.stepAITitle') {
      const isAIEnabled = typeof LLMService !== 'undefined' && LLMService.isEnabled();
      title = isAIEnabled ? (t('dailyreview.stepAITitle') || 'Résumé quotidien (IA)') : (t('dailyreview.stepManualSummaryTitle') || 'Résumé quotidien');
    } else {
      title = t(key || 'dailyreview.dateTitle', { date: this.getReviewDateDisplay() });
    }
    titleEl.textContent = title;
  },

  applyStep3NotePaneWidth() {
    const split = document.getElementById('dr-step3-split-container');
    const pane = document.getElementById('dr-step3-notes-pane');
    const handle = document.getElementById('dr-step3-resize-handle');
    if (!split || !pane || !handle) return;

    const visible = this.step3NotePaneVisible !== false;
    pane.classList.toggle('collapsed', !visible);
    pane.style.display = visible ? 'flex' : 'none';
    handle.style.display = visible ? 'block' : 'none';
    if (!visible) return;

    const bodyWidth = split.getBoundingClientRect().width;
    if (!bodyWidth) return;
    const desiredWidth = this.step3NotePaneWidth || this.getStep3NotePaneDefaultWidth();
    const bounds = this.getStep3NotePaneBounds(bodyWidth);
    const clampedWidth = Math.max(bounds.minW, Math.min(bounds.maxW, desiredWidth));
    pane.style.flex = `0 0 ${clampedWidth}px`;
    pane.style.width = `${clampedWidth}px`;
    this.step3NotePaneWidth = clampedWidth;
  },

  bindStep3ResizeHandle() {
    if (this._step3ResizeBound) return;
    const self = this;

    function doBind(handleEl) {
      if (!handleEl) return false;
      let dragging = false;
      let startX = 0;
      let startWidth = 0;

      const moveHandler = (event) => {
        if (!dragging) return;
        const split = document.getElementById('dr-step3-split-container');
        const pane = document.getElementById('dr-step3-notes-pane');
        if (!split || !pane) return;

        const splitWidth = split.getBoundingClientRect().width;
        const bounds = self.getStep3NotePaneBounds(splitWidth);
        const nextWidth = Math.max(bounds.minW, Math.min(bounds.maxW, startWidth + (event.clientX - startX)));
        pane.style.flex = `0 0 ${nextWidth}px`;
        pane.style.width = `${nextWidth}px`;
        self.step3NotePaneWidth = nextWidth;
      };

      const upHandler = () => {
        if (!dragging) return;
        dragging = false;
        handleEl.classList.remove('dragging');
        const pane = document.getElementById('dr-step3-notes-pane');
        const width = pane ? pane.getBoundingClientRect().width : 0;
        if (width > 0) self.saveStep3NotePaneWidth(width);
        document.body.classList.remove('dr-step3-resizing');
      };

      handleEl.addEventListener('mousedown', event => {
        if (self.step3NotePaneVisible === false) return;
        const pane = document.getElementById('dr-step3-notes-pane');
        const split = document.getElementById('dr-step3-split-container');
        if (!pane || !split) return;

        dragging = true;
        startX = event.clientX;
        startWidth = pane.getBoundingClientRect().width;
        handleEl.classList.add('dragging');
        document.body.classList.add('dr-step3-resizing');
        event.preventDefault();
      });

      document.addEventListener('mousemove', moveHandler);
      document.addEventListener('mouseup', upHandler);
      self._step3ResizeBound = true;
      return true;
    }

    const handle = document.getElementById('dr-step3-resize-handle');
    if (handle) { doBind(handle); return; }

    // If the handle isn't present yet, observe DOM and bind when it appears
    if (typeof MutationObserver !== 'undefined' && document.body) {
      const mo = new MutationObserver((mutations, obs) => {
        const h = document.getElementById('dr-step3-resize-handle');
        if (h) {
          doBind(h);
          obs.disconnect();
        }
      });
      mo.observe(document.body, { childList: true, subtree: true });
    }
  },

  toggleStep3EditorPane(forceVisible = null) {
    const visible = forceVisible === null ? !this.step3NotePaneVisible : !!forceVisible;
    this.step3NotePaneVisible = visible;
    const toggleBtn = document.getElementById('btn-dr-step3-note-toggle');
    if (toggleBtn) {
      toggleBtn.textContent = visible ? '-' : '+';
      toggleBtn.title = visible ? t('dailyreview.step3EditorCollapseTitle') : t('dailyreview.step3EditorExpandTitle');
    }
    const split = document.getElementById('dr-step3-split-container');
    if (split) {
      split.classList.toggle('left-collapsed', !visible);
    }
    this.applyStep3NotePaneWidth();
  },

  ensureStep3EditorPaneVisible() {
    if (this.step3NotePaneVisible === false) {
      this.step3NotePaneVisible = true;
      const toggleBtn = document.getElementById('btn-dr-step3-note-toggle');
      if (toggleBtn) {
        toggleBtn.textContent = '-';
        toggleBtn.title = t('dailyreview.step3EditorCollapseTitle');
      }
      const split = document.getElementById('dr-step3-split-container');
      if (split) {
        split.classList.remove('left-collapsed');
      }
    }
    this.applyStep3NotePaneWidth();
  },

  syncReviewDateUI() {
    const dateInput = document.getElementById('dr-target-date') || document.getElementById('dr-review-date');
    if (dateInput && dateInput.value !== this.getReviewDateValue()) {
      dateInput.value = this.getReviewDateValue();
    }

    const dateTitle = document.getElementById('dr-date-title');
    if (dateTitle) {
      dateTitle.textContent = this.getReviewDateDisplay();
      dateTitle.title = t('dailyreview.dateTitle', { date: this.getReviewDateDisplay() });
    }
  },

  updateDailyReviewButtonBadge() {
    // Safe no-op hook for button state/badge sync
    const btnDr = document.getElementById('tab-daily-review-btn');
    if (btnDr && this.currentStep === 0) {
      btnDr.classList.remove('active');
    }
  },

  syncPlannerForReviewDate() {
    plannerDisplayDateOverride = null;
    plannerInitialFocusDate = this.getReviewDateValue();
    if (typeof window !== 'undefined') window._plannerInitialScrollDone = false;

    if (typeof currentPlannerWeekStart !== 'undefined') {
      const reviewDate = this.getReviewDate();
      currentPlannerWeekStart = new Date(reviewDate);
    }
  },

  async setReviewDate(reviewDateValue, { rerender = true } = {}) {
    const parsed = parseLocalDateValue(reviewDateValue) || new Date();
    parsed.setHours(0, 0, 0, 0);
    const normalizedValue = formatLocalDateValue(parsed);
    const changed = normalizedValue !== this.reviewDateValue;

    this.reviewDate = parsed;
    this.reviewDateValue = normalizedValue;
    this.loadIgnoredBlocks();
    this.syncReviewDateUI();

    if (changed) {
      this.plannerQADoneSignature = null;
      this.activeNotePath = null;
      this.todayNotes = [];
      this.currentSuggestions = [];
      this.suggestedWorkstreams = [];
      this.summaryJustGenerated = false;
      this.isGeneratingSummaries = false;

      const sugList = document.getElementById('dr-ai-suggestions-list');
      if (sugList) sugList.innerHTML = '';
      const contentTextarea = document.getElementById('dr-ai-summary-content');
      if (contentTextarea) contentTextarea.innerHTML = '';
      const titleInput = document.getElementById('dr-ai-summary-title');
      if (titleInput) titleInput.value = '';
    }

    if (rerender && this.currentStep) {
      await this.loadStep(this.currentStep);
    }

    if (typeof updateUrlHash === 'function') updateUrlHash();
  },

  buildPlannerQASignature() {
    const reviewDate = this.getReviewDate();
    const nextDate = new Date(reviewDate);
    nextDate.setDate(reviewDate.getDate() + 1);
    const daySet = new Set([formatLocalDateValue(reviewDate), formatLocalDateValue(nextDate)]);

    const relevant = (Array.isArray(plannerEvents) ? plannerEvents : [])
      .filter(ev => ev && daySet.has(ev.date))
      .map(ev => ({
        id: ev.id || '',
        date: ev.date || '',
        start: ev.startTime || '',
        end: ev.endTime || '',
        type: ev.type || '',
        title: ev.title || '',
        todoId: ev.todoId || '',
        noteId: ev.noteId || '',
        prepForEventId: ev.prepForEventId || '',
        recurrenceId: ev.recurrenceId || ''
      }))
      .sort((a, b) =>
        a.date.localeCompare(b.date)
        || a.start.localeCompare(b.start)
        || a.end.localeCompare(b.end)
        || a.type.localeCompare(b.type)
        || a.title.localeCompare(b.title)
        || a.id.localeCompare(b.id)
      );

    return JSON.stringify(relevant);
  },

  updatePlannerQAStatusUI() {
    const statusEl = document.getElementById('dr-planner-qa-status');
    const doneBtn = document.getElementById('btn-dr-planner-qa-done');
    const currentSig = this.buildPlannerQASignature();
    this.plannerQASignature = currentSig;

    const changedAfterDone = !!this.plannerQADoneSignature && this.plannerQADoneSignature !== currentSig;
    const isDone = !!this.plannerQADoneSignature && !changedAfterDone;

    if (statusEl) {
      if (!this.plannerQADoneSignature) statusEl.textContent = t('dailyreview.plannerQaPending');
      else if (changedAfterDone) statusEl.textContent = t('dailyreview.plannerQaChanged');
      else statusEl.textContent = t('dailyreview.plannerQaValidated');
    }

    if (doneBtn) {
      doneBtn.textContent = isDone ? t('dailyreview.plannerQaDone') : t('dailyreview.plannerQaDoneBtn');
      doneBtn.classList.toggle('btn-save', true);
    }
  },

  markPlannerQAComplete() {
    this.plannerQADoneSignature = this.buildPlannerQASignature();
    this.updatePlannerQAStatusUI();
    toast(t('dailyreview.plannerQaMarkedToast'));
  },

  isPlannerQASatisfied() {
    const currentSig = this.buildPlannerQASignature();
    return !!this.plannerQADoneSignature && this.plannerQADoneSignature === currentSig;
  },

  /**
   * Hook global save handlers to auto-delete routed stash items on success
   */
  hookInterceptors() {
    if (this.interceptorsHooked) return;
    
    // Wrap createNewTodo
    if (window.createNewTodo) {
      this.originalCreateNewTodo = window.createNewTodo;
      window.createNewTodo = async (...args) => {
        const res = await this.originalCreateNewTodo.apply(window, args);
        const modal = document.getElementById('modal-new-todo');
        if (this.activeRoutingStashId && (!modal || modal.style.display === 'none')) {
          await this.onRoutingSuccess();
        }
        return res;
      };
    }

    // Wrap createNewNote
    if (window.createNewNote) {
      this.originalCreateNewNote = window.createNewNote;
      window.createNewNote = async (...args) => {
        const res = await this.originalCreateNewNote.apply(window, args);
        const modal = document.getElementById('modal-new-note');
        if (this.activeRoutingStashId && (!modal || modal.style.display === 'none')) {
          await this.onRoutingSuccess();
        }
        return res;
      };
    }

    // Wrap openPlannerModal callback
    if (window.openPlannerModal) {
      this.originalOpenPlannerModal = window.openPlannerModal;
      window.openPlannerModal = (titleText, htmlContent, onSave) => {
        const wrappedOnSave = async (...saveArgs) => {
          const res = await onSave.apply(this, saveArgs);
          if (this.activeRoutingStashId) {
            await this.onRoutingSuccess();
          }
          return res;
        };
        return this.originalOpenPlannerModal.call(window, titleText, htmlContent, wrappedOnSave);
      };
    }

    // Wrap openPlanEventModal to auto-delete routed stash item on block save
    if (window.openPlanEventModal) {
      this.originalOpenPlanEventModal = window.openPlanEventModal;
      window.openPlanEventModal = (...args) => {
        const res = this.originalOpenPlanEventModal.apply(window, args);
        setTimeout(() => {
          const modal = document.getElementById('planner-dynamic-modal');
          if (modal) {
            const saveBtn = modal.querySelector('.btn-save');
            if (saveBtn && !saveBtn.dataset.drHooked) {
              saveBtn.dataset.drHooked = 'true';
              const origOnClick = saveBtn.onclick;
              saveBtn.onclick = async (e) => {
                let saveRes;
                if (origOnClick) saveRes = await origOnClick.call(saveBtn, e);
                if (this.activeRoutingStashId && (!modal || modal.style.display === 'none')) {
                  await this.onRoutingSuccess();
                }
                return saveRes;
              };
            }
          }
        }, 50);
        return res;
      };
    }

    this.interceptorsHooked = true;
  },

  unhookInterceptors() {
    if (!this.interceptorsHooked) return;
    if (this.originalCreateNewTodo) window.createNewTodo = this.originalCreateNewTodo;
    if (this.originalCreateNewNote) window.createNewNote = this.originalCreateNewNote;
    if (this.originalOpenPlannerModal) window.openPlannerModal = this.originalOpenPlannerModal;
    if (this.originalOpenPlanEventModal) window.openPlanEventModal = this.originalOpenPlanEventModal;
    this.interceptorsHooked = false;
  },

  /**
   * Action trigger when routing successfully completes
   */
  async onRoutingSuccess() {
    if (!this.activeRoutingStashId) return;
    await StashService.delete(this.activeRoutingStashId);
    this.activeRoutingStashId = null;
    toast(t('common.saved') || 'Saved');
    await this.loadStep(2);
  },

  /**
   * Move between steps with validation
   */
  async navigateStep(dir) {
    if (this.isGeneratingSummaries) {
      return;
    }
    const totalSteps = 5;
    if (this.currentStep === 5 && dir === 1) {
      if (this.isClosingDay) return;
      this.isClosingDay = true;
      const nextBtn = document.getElementById('btn-dr-next');
      const prevBtn = document.getElementById('btn-dr-prev');
      if (nextBtn) {
        nextBtn.disabled = true;
      }
      if (prevBtn) {
        prevBtn.disabled = true;
      }

      const lang = (typeof getAppLanguage === 'function') ? getAppLanguage() : 'fr';
      const commitFallback = lang === 'fr' ? 'Clôturer la journée' : (lang === 'de' ? 'Tag abschließen' : 'Close Day');
      const commitTooltipFallback = lang === 'fr' ? 'Enregistrer le bilan quotidien et clôturer la journée' : 'Save daily summary and close day';

      try {
        // If workstreams are still syncing in the background, wait for them to finish (with a safety timeout)
        const isSyncing = Array.isArray(this.workstreamUpdateStatuses) && this.workstreamUpdateStatuses.some(u => u.status === 'syncing');
        if (isSyncing && this.workstreamSyncPromise) {
          if (nextBtn) {
            nextBtn.innerHTML = '<span class="spinner" style="width:13px;height:13px;display:inline-block;vertical-align:middle;margin-right:6px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;"></span>' + escH(t('dailyreview.workstreamWaitingBtn') || 'Finalisation des dossiers thématiques...');
            nextBtn.title = t('dailyreview.workstreamWaitingBtn') || 'Finalisation des dossiers thématiques...';
          }
          await Promise.race([
            this.workstreamSyncPromise,
            new Promise(resolve => setTimeout(resolve, 20000))
          ]);
        }

        if (nextBtn) {
          nextBtn.innerHTML = '<span class="spinner" style="width:13px;height:13px;display:inline-block;vertical-align:middle;margin-right:6px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;"></span>' + escH(t('dailyreview.closingDay') || 'Clôture de la journée...');
          nextBtn.title = t('dailyreview.closingDay') || 'Clôture de la journée...';
        }

        // Step 5 -> Finish: save daily summary and commit
        const saved = await this.saveAISummaryNote();
        if (!saved) {
          this.isClosingDay = false;
          if (nextBtn) {
            nextBtn.disabled = false;
            nextBtn.innerHTML = '✓ ' + escH(t('dailyreview.commitBtn') || commitFallback);
            nextBtn.title = t('dailyreview.commitBtnTooltip') || commitTooltipFallback;
          }
          if (prevBtn) prevBtn.disabled = false;
          return; // Stop navigation if saving failed
        }
        await this.commitFinal();
      } catch (err) {
        console.error('Error closing daily review:', err);
        toast(err.message, true);
        this.isClosingDay = false;
        if (nextBtn) {
          nextBtn.disabled = false;
          nextBtn.innerHTML = '✓ ' + escH(t('dailyreview.commitBtn') || commitFallback);
          nextBtn.title = t('dailyreview.commitBtnTooltip') || commitTooltipFallback;
        }
        if (prevBtn) prevBtn.disabled = false;
      }
      return; // Close overlay and finish review
    }
    const targetStep = this.currentStep + dir;
    if (targetStep < 1 || targetStep > totalSteps) return;

    // Step 2 -> Step 3 transition validation: stash must be empty
    if (this.currentStep === 2 && dir === 1) {
      this.stashItems = await StashService.list();
      if (this.stashItems.length > 0) {
        toast(t('dailyreview.emptyStashWarning'), true);
        return;
      }
    }

    // Step 3 -> Step 4 transition: mark planner QA complete
    if (this.currentStep === 3 && dir === 1) {
      this.markPlannerQAComplete();
    }

    // Step 4 -> Step 5 transition: notes review and summaries generation
    if (this.currentStep === 4 && dir === 1) {
      const pending = this.todayNotes.filter(note => {
        const found = (typeof manifest !== 'undefined' ? manifest : []).find(n => n.path === note.path);
        return !(found && found.reviewed);
      });
      if (pending.length > 0) {
        toast(t('dailyreview.notesReviewedWarning'), true);
        return;
      }

      // Validate unassociated blocks are either associated or ignored
      const reviewDateStr = this.getReviewDateValue();
      const unassociatedEvents = (Array.isArray(plannerEvents) ? plannerEvents : [])
        .filter(ev => ev && ev.date === reviewDateStr && !ev.noteId && ev.type !== 'custom' && ev.type !== 'ooo');
      const unresolvedBlock = unassociatedEvents.find(ev => !this.ignoredBlockIds.has(ev.id));
      if (unresolvedBlock) {
        toast(t('dailyreview.unresolvedBlocksWarning') || 'Veuillez associer, créer ou ignorer une note pour tous les blocs horaires.', true);
        return;
      }

      await this.loadStep(5);
      return;
    }

    await this.loadStep(targetStep);
  },

  getStepMapping(stepNum) {
    const mapping = {
      1: { domId: 'dr-step-date-select', render: () => this.renderDateSelectStep(), descKey: 'dailyreview.step1Desc' },
      2: { domId: 'dr-step-1', render: () => this.renderStep1(), descKey: 'dailyreview.step2Desc' },
      3: { domId: 'dr-step-2', render: () => this.renderStep2(), descKey: 'dailyreview.step3Desc' },
      4: { domId: 'dr-step-3', render: () => this.renderStep3(), descKey: 'dailyreview.step4Desc' },
      5: { domId: 'dr-step-ai', render: () => this.renderAISummaryStep(), descKey: 'dailyreview.stepAIDesc' }
    };
    return mapping[stepNum] || null;
  },

  /**
   * Load and render a specific step
   */
  async loadStep(stepNum) {
    if (stepNum === 2) {
      this.stashItems = await StashService.list();
      if (this.stashItems.length === 0) {
        const nextStep = (this.currentStep <= 2) ? 3 : 1;
        return this.loadStep(nextStep);
      }
    }

    if (stepNum !== 4 && stepNum !== 5) {
      this.restoreStep3NoteEditor();
    }
    this.currentStep = stepNum;
    this.setStepTitle(stepNum);

    const stepInfo = this.getStepMapping(stepNum);

    // Set step description in header
    const headerDesc = document.getElementById('dr-header-desc');
    if (headerDesc && stepInfo) {
      if (stepInfo.descKey === 'dailyreview.stepAIDesc') {
        const isAIEnabled = typeof LLMService !== 'undefined' && LLMService.isEnabled();
        headerDesc.textContent = isAIEnabled ? (t('dailyreview.stepAIDesc') || 'Review and edit the summary of your day\'s notes and activities.') : (t('dailyreview.stepManualSummaryDesc') || 'Write a summary of your day\'s notes and activities.');
      } else {
        headerDesc.textContent = t(stepInfo.descKey) || '';
      }
    }

    // Toggle container active classes and dot indicators
    const allDomIds = ['dr-step-date-select', 'dr-step-1', 'dr-step-2', 'dr-step-3', 'dr-step-ai'];
    allDomIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        const isActive = (stepInfo && stepInfo.domId === id);
        el.style.display = isActive ? 'flex' : 'none';
        el.classList.toggle('active', isActive);
      }
    });

    for (let i = 1; i <= 5; i++) {
      const dot = document.getElementById(`dr-dot-${i}`);
      if (dot) {
        dot.classList.toggle('active', i === stepNum);
        dot.classList.toggle('completed', i < stepNum);
      }
    }

    // Step indicators & footer buttons
    const indicatorText = document.getElementById('dr-step-indicator-text');
    if (indicatorText) {
      indicatorText.textContent = t('dailyreview.stepIndicator', { current: stepNum, total: 5 }) || `Étape ${stepNum} sur 5`;
    }

    const prevBtn = document.getElementById('btn-dr-prev');
    if (prevBtn) {
      prevBtn.style.display = (stepNum === 1) ? 'none' : '';
      prevBtn.disabled = (stepNum === 1);
    }
    const nextBtn = document.getElementById('btn-dr-next');
    if (nextBtn) {
      nextBtn.style.display = (stepNum === 1) ? 'none' : '';
      nextBtn.disabled = false; // Ensure button is not left disabled from async transitions
      const lang = (typeof getAppLanguage === 'function') ? getAppLanguage() : 'fr';
      const confirmNextFallback = lang === 'fr' ? 'Confirmer & Suivant' : (lang === 'de' ? 'Bestätigen & Weiter' : 'Confirm & Next');
      const nextFallback = lang === 'fr' ? 'Suivant' : (lang === 'de' ? 'Weiter' : 'Next');

      if (stepNum === 5) {
        const isSyncing = Array.isArray(this.workstreamUpdateStatuses) && this.workstreamUpdateStatuses.some(u => u.status === 'syncing');
        if (isSyncing) {
          nextBtn.innerHTML = '<span class="spinner" style="width:13px;height:13px;display:inline-block;vertical-align:middle;margin-right:6px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;"></span>' + escH(t('dailyreview.workstreamSyncingBtn') || 'Mise à jour des dossiers...');
          nextBtn.title = t('dailyreview.workstreamSyncingTooltip') || 'Les dossiers thématiques sont en cours d\'actualisation en arrière-plan. Cliquez pour finaliser et clôturer la journée.';
        } else {
          nextBtn.innerHTML = '✓ ' + escH(t('dailyreview.commitBtn') || (lang === 'fr' ? 'Clôturer la journée' : (lang === 'de' ? 'Tag abschließen' : 'Close Day')));
          nextBtn.title = t('dailyreview.commitBtnTooltip') || (lang === 'fr' ? 'Enregistrer le bilan quotidien et clôturer la journée' : 'Save daily summary and close day');
        }
      } else if (stepNum === 4) {
        nextBtn.textContent = t('dailyreview.confirmNextBtn') || confirmNextFallback;
        nextBtn.title = t('dailyreview.confirmNextBtn') || confirmNextFallback;
      } else {
        nextBtn.textContent = t('dailyreview.nextBtn') || nextFallback;
        nextBtn.title = t('dailyreview.nextBtn') || nextFallback;
      }
    }
    const regenWrap = document.getElementById('dr-ai-regenerate-wrap');
    if (regenWrap && stepNum !== 5) {
      regenWrap.style.display = 'none';
    }

    // Run step specific render action
    if (stepInfo) {
      await stepInfo.render();
    }
  },

  async renderDateSelectStep() {
    this.syncReviewDateUI();
    const dateInput = document.getElementById('dr-target-date') || document.getElementById('dr-review-date');
    if (dateInput && !dateInput._hasChangeListener) {
      dateInput._hasChangeListener = true;
      dateInput.addEventListener('change', (e) => {
        if (e.target.value) {
          this.setReviewDate(e.target.value, { rerender: false });
        }
      });
    }
  },

  async startForSelectedDate() {
    const dateInput = document.getElementById('dr-target-date') || document.getElementById('dr-review-date');
    const selectedDate = dateInput?.value || this.getReviewDateValue();
    if (typeof isDateCoveredByOoo === 'function' && isDateCoveredByOoo(selectedDate)) {
      const oooEv = typeof getCoveringOooEvent === 'function' ? getCoveringOooEvent(selectedDate) : null;
      const oooTitle = oooEv?.title || (typeof t === 'function' ? t('planner.ooo') : null) || 'Out of Office';
      const msg = typeof t === 'function'
        ? t('dailyreview.oooDayAutoReviewed', { title: oooTitle })
        : `${oooTitle}: This day is marked as Out of Office and is already automatically reviewed.`;
      if (typeof toast === 'function') toast(msg);
      return;
    }
    await this.setReviewDate(selectedDate);
    await this.loadStep(2);
  },

  /**
   * Render Step 2: Stash routing list (Inbox)
   */
  async renderStep1() {
    const grid = document.getElementById('stash-routing-grid');
    if (!grid) return;
    grid.innerHTML = '';

    this.stashItems = await StashService.list();

    if (this.stashItems.length === 0) {
      await this.loadStep(3);
      return;
    }

    this.stashItems.forEach(item => {
      const card = document.createElement('div');
      card.className = 'stash-routing-card';
      
      const textDiv = document.createElement('div');
      textDiv.className = 'stash-routing-text';
      textDiv.textContent = item.text;
      card.appendChild(textDiv);

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'stash-routing-actions';

      // Discard button
      const discardBtn = document.createElement('button');
      discardBtn.className = 'discard';
      discardBtn.textContent = t('dailyreview.discardBtn');
      discardBtn.onclick = () => this.discardStashItem(item.id);
      
      // -> Todo button
      const todoBtn = document.createElement('button');
      todoBtn.textContent = t('dailyreview.toTodoBtn');
      todoBtn.onclick = () => this.routeStashToTodo(item.id, item.text);

      // -> Note button
      const noteBtn = document.createElement('button');
      noteBtn.textContent = t('dailyreview.toNoteBtn');
      noteBtn.onclick = () => this.routeStashToNote(item.id, item.text);

      // -> Block button
      const blocBtn = document.createElement('button');
      blocBtn.textContent = t('dailyreview.toBlocBtn');
      blocBtn.onclick = () => this.routeStashToBloc(item.id, item.text);

      actionsDiv.appendChild(todoBtn);
      actionsDiv.appendChild(noteBtn);
      actionsDiv.appendChild(blocBtn);
      actionsDiv.appendChild(discardBtn);
      card.appendChild(actionsDiv);

      grid.appendChild(card);
    });
  },

  /**
   * Actions for Step 1
   */
  async discardStashItem(id) {
    if (!this._pendingStashDeletes) this._pendingStashDeletes = new Set();
    if (this._pendingStashDeletes.has(id)) return;
    this._pendingStashDeletes.add(id);

    try {
      const confirmed = await showConfirmDialog(t('dailyreview.deleteItemConfirm'), { isDanger: true });
      if (confirmed) {
        await StashService.delete(id);
        await this.renderStep1();
      }
    } finally {
      this._pendingStashDeletes.delete(id);
    }
  },

  routeStashToTodo(id, text) {
    this.activeRoutingStashId = id;
    
    // Prefill dialog fields
    const textInput = document.getElementById('nt-text');
    const titleInput = document.getElementById('nt-title');
    if (textInput) textInput.value = text;
    if (titleInput) titleInput.value = '';

    openModal('modal-new-todo');
  },

  routeStashToNote(id, text) {
    this.activeRoutingStashId = id;

    const contentInput = document.getElementById('nn-content');
    const dateInput = document.getElementById('nn-date');
    const titleInput = document.getElementById('nn-title');
    
    if (contentInput) contentInput.value = text;
    if (dateInput) dateInput.value = this.getReviewDateValue();
    if (titleInput) titleInput.value = '';

    openModal('modal-new-note');
  },

  routeStashToBloc(id, text) {
    this.activeRoutingStashId = id;
    if (typeof openPlanEventModal === 'function') {
      openPlanEventModal({ title: text });
    }
  },

  /**
   * Render Step 2: Calendar adjustments
   */
  renderStep2() {
    const container = document.getElementById('dr-planner-qa-content');
    const planner = document.getElementById('planner-panel');
    if (!container || !planner) return;

    // Move planner inside container
    container.appendChild(planner);
    planner.style.display = 'flex';
    planner.style.flex = '1 1 auto';
    planner.style.minHeight = '0';

    // Collapse right sidebar by default in Daily Review Step 3 for maximum calendar space
    if (typeof plannerRightSidebarCollapsed !== 'undefined') {
      plannerRightSidebarCollapsed = true;
    }

    // Switch planner view to 3 days and anchor on the selected review date.
    if (typeof setPlannerViewMode === 'function') {
      setPlannerViewMode('3days');
    }
    this.syncPlannerForReviewDate();
    if (typeof renderPlanner === 'function') {
      renderPlanner();
    }

    this.updatePlannerQAStatusUI();
  },

  async createNoteForUnassociatedBlock(eventId) {
    const event = (Array.isArray(plannerEvents) ? plannerEvents : []).find(e => e.id === eventId);
    if (!event) return;

    if (typeof generateNoteId !== 'function') {
      toast("Error: generateNoteId is not defined", true);
      return;
    }

    const noteId = generateNoteId();
    const notePath = getCanonicalNotePath(noteId);
    const noteTitle = event.title || 'Untitled Session';

    const markdown = await generateEventNoteMarkdown(event, event.type);
    const mainHTML = mdToPreviewHTML(markdown);
    const note = {
      id: noteId,
      path: notePath,
      title: noteTitle,
      date: event.date,
      group_tags: event.group_tags || [],
      major_topic_tags: event.major_topic_tags || [],
      topic_tags: event.topic_tags || [],
      extra_tags: [],
      mainHTML
    };

    try {
      await StorageAPI.writeNoteContent(notePath, buildNewNoteHTML(note));
      upsertManifest(note);
      await saveManifest({ force: true });
      await rebuildIndexHTML();

      event.noteId = noteId;

      // Propagate noteId to linked prep events
      if (event.type === 'call' || event.type === 'sync') {
        (Array.isArray(plannerEvents) ? plannerEvents : []).forEach(pe => {
          if (pe.type === 'prep' && pe.prepForEventId === event.id) {
            pe.noteId = noteId;
          }
        });
      }

      savePlanner();
      if (typeof renderPlanner === 'function') renderPlanner();

      toast(t('common.saved') || 'Saved');
      await this.renderStep3();
    } catch (err) {
      console.error('Failed to create note for unassociated block:', err);
      toast('Failed to create note: ' + err.message, true);
    }
  },

  async associateNoteToBlock(eventId, noteId) {
    const event = (Array.isArray(plannerEvents) ? plannerEvents : []).find(e => e.id === eventId);
    if (!event) return;

    // If unlinking, just save
    if (!noteId) {
      event.noteId = '';
      savePlanner();
      if (typeof renderPlanner === 'function') renderPlanner();
      toast(t('common.saved') || 'Saved');
      await this.renderStep3();
      return;
    }

    // Warn if the note date differs from block date and align it
    const noteEntry = (typeof manifest !== 'undefined' ? manifest : []).find(n => n.id === noteId);
    if (noteEntry && event.date && noteEntry.date !== event.date) {
      const warningMsg = (t('dailyreview.assocModalDateWarning') || "The note's date will be updated to match the block date ({date}). Do you want to continue?")
        .replace('{date}', event.date);
      const confirmed = await showConfirmDialog(warningMsg, {
        confirmLabel: t('dailyreview.assocModalConfirmBtn') || 'Associate note',
      });
      if (!confirmed) return;

      // Update note date in HTML file
      try {
        const originalHTML = await StorageAPI.readNoteContent(noteEntry.path);
        const changes = {
          title: noteEntry.title ?? '',
          date: event.date,
          group_tags: noteEntry.group_tags ?? [],
          major_topic_tags: noteEntry.major_topic_tags ?? [],
          topic_tags: noteEntry.topic_tags ?? [],
          extra_tags: noteEntry.extra_tags ?? [],
          summary: noteEntry.summary ?? '',
        };
        const updatedHTML = applyNoteEdits(originalHTML, changes);
        await StorageAPI.writeNoteContent(noteEntry.path, updatedHTML);
        upsertManifest({ ...noteEntry, date: event.date, modified: new Date().toISOString() });
        await saveManifest({ force: true });
        toast((t('dailyreview.assocModalDateAdjusted') || 'Note date updated to {date}.').replace('{date}', event.date));
      } catch (err) {
        console.error('Failed to update note date:', err);
      }
    }

    event.noteId = noteId;
    if (noteEntry && typeof syncTagsBetweenBlocAndNote === 'function') {
      await syncTagsBetweenBlocAndNote(event, noteEntry);
    }
    savePlanner();
    if (typeof renderPlanner === 'function') renderPlanner();

    toast(t('common.saved') || 'Saved');
    await this.renderStep3();
  },


  openBlockAssociationModal(eventId) {
    const event = (Array.isArray(plannerEvents) ? plannerEvents : []).find(e => e.id === eventId);
    if (!event) return;

    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.style.zIndex = '2000';
    
    const box = document.createElement('div');
    box.className = 'dialog-box';
    box.style.width = '420px';
    box.style.maxWidth = '90vw';
    box.style.display = 'flex';
    box.style.flexDirection = 'column';
    box.style.gap = '1rem';
    box.style.padding = '1.5rem';
    
    const titleEl = document.createElement('h3');
    titleEl.style.margin = '0';
    titleEl.style.fontSize = '1.1rem';
    titleEl.style.fontWeight = '600';
    titleEl.textContent = t('dailyreview.assocModalTitle', { title: event.title || 'Session' }) || `Link note: ${event.title || 'Session'}`;
    box.appendChild(titleEl);
    
    const subtext = document.createElement('div');
    subtext.style.fontSize = '0.8rem';
    subtext.style.color = 'var(--text-muted)';
    subtext.textContent = `${this.getReviewDateDisplay()} | ${event.startTime || ''} - ${event.endTime || ''}`;
    box.appendChild(subtext);

    // Option 1: Create Note Button
    const createBtn = document.createElement('button');
    createBtn.type = 'button';
    createBtn.className = 'btn btn-primary';
    createBtn.style.padding = '10px';
    createBtn.style.display = 'flex';
    createBtn.style.justifyContent = 'center';
    createBtn.style.alignItems = 'center';
    createBtn.style.gap = '8px';
    createBtn.innerHTML = `📝 ${t('dailyreview.assocModalCreateBtn') || 'Create a new note'}`;
    createBtn.onclick = async () => {
      overlay.remove();
      await this.createNoteForUnassociatedBlock(event.id);
    };
    box.appendChild(createBtn);

    // Option 2: Ignore Option
    const ignoreBtn = document.createElement('button');
    ignoreBtn.type = 'button';
    ignoreBtn.className = 'btn btn-secondary';
    ignoreBtn.style.padding = '10px';
    ignoreBtn.style.display = 'flex';
    ignoreBtn.style.justifyContent = 'center';
    ignoreBtn.style.alignItems = 'center';
    ignoreBtn.style.gap = '8px';
    ignoreBtn.innerHTML = `🚫 ${t('dailyreview.assocModalIgnoreBtn') || 'Ignore (No note needed)'}`;
    ignoreBtn.onclick = () => {
      this.ignoredBlockIds.add(event.id);
      this.saveIgnoredBlocks();
      overlay.remove();
      this.renderStep3();
    };
    box.appendChild(ignoreBtn);

    const hr = document.createElement('hr');
    hr.style.border = '0';
    hr.style.borderTop = '1px solid var(--card-border)';
    hr.style.margin = '4px 0';
    box.appendChild(hr);

    // Option 3: Associate Existing Note Section
    const searchLabel = document.createElement('label');
    searchLabel.id = 'dr-modal-search-label';
    searchLabel.style.fontSize = '0.8rem';
    searchLabel.style.fontWeight = '600';
    searchLabel.style.color = 'var(--text-muted)';
    searchLabel.textContent = t('dailyreview.assocModalSearchLabel') || 'Associate an existing note:';
    box.appendChild(searchLabel);

    // Positioned wrapper so dropdown sits flush below the input
    const searchWrap = document.createElement('div');
    searchWrap.className = 'dr-modal-search-wrap';
    box.appendChild(searchWrap);

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.id = 'dr-modal-note-search';
    searchInput.name = 'dr-modal-note-search';
    searchInput.className = 'dr-modal-search-input';
    searchInput.placeholder = t('planner.searchNotePlaceholder') || 'Search note by title...';
    searchWrap.appendChild(searchInput);

    const resultsList = document.createElement('div');
    resultsList.className = 'planner-dropdown-list dr-modal-dropdown';
    resultsList.style.display = 'none';
    searchWrap.appendChild(resultsList);

    // Confirmation pill (hidden initially)
    const confirmPill = document.createElement('div');
    confirmPill.className = 'dr-assoc-confirm-pill';
    confirmPill.style.display = 'none';
    box.appendChild(confirmPill);

    // Find if any notes are already linked to other planner events (primary note check)
    const currentEventId = String(event.id || '').trim();
    const linkedNoteMap = new Map(); // noteId -> event
    (Array.isArray(plannerEvents) ? plannerEvents : []).forEach(pe => {
      if (pe && pe.noteId && String(pe.id || '').trim() !== currentEventId) {
        linkedNoteMap.set(String(pe.noteId).trim(), pe);
      }
    });

    const reviewDateStr = this.getReviewDateValue
      ? this.getReviewDateValue()
      : (event.date || '');

    let selectedNote = null;

    const showSearchView = () => {
      confirmPill.style.display = 'none';
      searchWrap.style.display = 'block';
      searchInput.value = '';
      resultsList.style.display = 'none';
      selectedNote = null;
      setTimeout(() => searchInput.focus(), 50);
    };

    const showConfirmView = (note) => {
      selectedNote = note;
      searchWrap.style.display = 'none';
      resultsList.style.display = 'none';

      confirmPill.innerHTML = '';
      confirmPill.style.display = 'flex';

      const confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.className = 'btn btn-primary dr-assoc-confirm-action';
      confirmBtn.innerHTML = `
        <span class="dr-assoc-confirm-label">${t('dailyreview.assocModalConfirmBtn') || 'Associate note'}</span>
        <span class="dr-assoc-confirm-title">${escH(note.title)}</span>
      `;
      confirmBtn.onclick = async () => {
        const isLinked = linkedNoteMap.has(String(note.id).trim());
        if (isLinked) {
          const ownerEvent = linkedNoteMap.get(String(note.id).trim());
          const ownerTitle = ownerEvent.title || `Block ${ownerEvent.id || ''}`;
          const msg = t('planner.noteAlreadyLinkedToOtherMeeting', {
            noteTitle: note.title || 'Untitled',
            blockTitle: ownerTitle,
            date: ownerEvent.date || ''
          }) || `The note "${note.title || 'Untitled'}" is already linked as primary note to "${ownerTitle}" (${ownerEvent.date || ''}). Unlink it from that block and use it here?`;

          const confirmed = await showConfirmDialog(msg, {
            confirmLabel: t('planner.unlinkFromOtherMeeting') || 'Unlink from other meeting',
          });
          if (!confirmed) return;

          ownerEvent.noteId = '';
          savePlanner();
        }

        overlay.remove();
        await this.associateNoteToBlock(event.id, note.id);
      };
      confirmPill.appendChild(confirmBtn);

      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'btn dr-assoc-confirm-clear';
      clearBtn.title = t('common.clearSelection') || 'Clear selection';
      clearBtn.textContent = '✕';
      clearBtn.onclick = () => showSearchView();
      confirmPill.appendChild(clearBtn);
    };

    const addSectionHeader = (text) => {
      const hdr = document.createElement('div');
      hdr.className = 'dr-dropdown-section-header';
      hdr.textContent = text;
      resultsList.appendChild(hdr);
    };

    const addNoteItem = (note) => {
      const item = document.createElement('div');
      item.className = 'planner-dropdown-item';
      item.style.flexDirection = 'column';
      item.style.alignItems = 'flex-start';
      item.style.gap = '2px';

      const isLinked = linkedNoteMap.has(String(note.id).trim());

      const rowDiv = document.createElement('div');
      rowDiv.style.cssText = 'display:flex; justify-content:space-between; align-items:center; width:100%;';

      const tSpan = document.createElement('span');
      tSpan.style.fontWeight = '500';
      tSpan.style.overflow = 'hidden';
      tSpan.style.textOverflow = 'ellipsis';
      tSpan.style.whiteSpace = 'nowrap';
      tSpan.textContent = note.title;
      rowDiv.appendChild(tSpan);

      if (isLinked) {
        const ownerEvent = linkedNoteMap.get(String(note.id).trim());
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = t('planner.linkedNote') || 'Linked';
        badge.title = `Linked to: ${ownerEvent.title || ownerEvent.id}`;
        badge.style.cssText = 'background:var(--warning-bg,#fef3c7); color:var(--warning-text,#d97706); padding:2px 6px; border-radius:4px; font-size:0.7rem; font-weight:600; margin-left:8px; flex-shrink:0;';
        rowDiv.appendChild(badge);
        item.classList.add('linked');
      }
      item.appendChild(rowDiv);

      const dSpan = document.createElement('span');
      dSpan.style.fontSize = '0.7rem';
      dSpan.style.color = 'var(--text-muted)';
      dSpan.textContent = note.date || '';
      item.appendChild(dSpan);

      item.onclick = () => {
        resultsList.style.display = 'none';
        showConfirmView(note);
      };
      resultsList.appendChild(item);
    };

    const renderResults = (query = '') => {
      const q = query.toLowerCase().trim();
      const isSearching = q.length > 0;

      // 5-day cutoff for default view
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 5);
      const cutoffStr = cutoffDate.toISOString().slice(0, 10);

      let allNotes = (typeof manifest !== 'undefined' ? manifest : [])
        .filter(n => n.id && n.title && !n.id.startsWith('retro-') && !n.id.startsWith('summary-') && !(n.major_topic_tags || []).includes("Daily Summary"));

      if (isSearching) {
        allNotes = allNotes.filter(n => n.title.toLowerCase().includes(q));
      } else {
        allNotes = allNotes.filter(n => !n.date || n.date >= cutoffStr);
      }

      allNotes.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

      resultsList.innerHTML = '';

      if (allNotes.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'padding:8px 12px; font-size:0.8rem; color:var(--text-muted);';
        empty.textContent = t('common.noResults') || 'No results';
        resultsList.appendChild(empty);
        resultsList.style.display = 'block';
        return;
      }

      const todayNotes = allNotes.filter(n => n.date === reviewDateStr);
      const otherNotes = allNotes.filter(n => n.date !== reviewDateStr);

      if (todayNotes.length > 0) {
        addSectionHeader(t('dailyreview.assocModalTodaySection') || 'Today');
        todayNotes.forEach(addNoteItem);
      }

      if (otherNotes.length > 0) {
        const sectionLabel = isSearching
          ? (t('dailyreview.assocModalAllSection') || 'All notes')
          : (t('dailyreview.assocModalRecentSection') || 'Recent notes');
        addSectionHeader(sectionLabel);
        otherNotes.forEach(addNoteItem);
      }

      resultsList.style.display = 'block';
    };

    searchInput.onfocus = () => renderResults(searchInput.value);
    searchInput.oninput = () => renderResults(searchInput.value);

    // Close dropdown on outside click
    const outsideClickHandler = (e) => {
      if (!searchWrap.contains(e.target)) {
        resultsList.style.display = 'none';
      }
    };
    document.addEventListener('mousedown', outsideClickHandler);
    overlay.addEventListener('remove', () => document.removeEventListener('mousedown', outsideClickHandler));

    const actions = document.createElement('div');
    actions.className = 'dialog-actions';
    
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn';
    cancelBtn.textContent = t('editor.cancel') || 'Cancel';
    cancelBtn.onclick = () => {
      overlay.remove();
    };
    actions.appendChild(cancelBtn);
    box.appendChild(actions);

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const keyHandler = (e) => {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', keyHandler);
      }
    };
    document.addEventListener('keydown', keyHandler);
  },

  /**
   * Render Step 4: Split-screen note normalizer
   */
  async renderStep3() {
    const listContainer = document.getElementById('dr-notes-to-review-list');
    if (!listContainer) return;
    listContainer.innerHTML = '';
    this.bindStep3ResizeHandle();
    this.toggleStep3EditorPane(this.step3NotePaneVisible !== false);

    const reviewDateStr = this.getReviewDateValue();

    this.todayNotes = this.collectTodayNotes(reviewDateStr);

    const unassociatedEvents = (Array.isArray(plannerEvents) ? plannerEvents : [])
      .filter(ev => ev && ev.date === reviewDateStr && !ev.noteId && ev.type !== 'custom' && ev.type !== 'ooo');

    if (this.todayNotes.length === 0 && unassociatedEvents.length === 0) {
      this.ensureStep3EditorPaneVisible();
      this.restoreStep3NoteEditor();
      listContainer.innerHTML = `
        <div style="padding: 24px; text-align: center; color: var(--text-muted);">
          ${t('dailyreview.noNotesToReview')}
        </div>
      `;
      const editorContainer = document.getElementById('dr-note-review-editor-container');
      const overlayMain = document.querySelector('.overlay-main-layout');
      const headerContainer = document.querySelector('.overlay-header-container');
      const metaWrap = document.getElementById('edit-meta-wrap');
      if (headerContainer && this.overlayHeaderOriginalParent && editorContainer && editorContainer.contains(headerContainer)) {
        const next = this.overlayHeaderOriginalNextSibling;
        if (next && next.parentNode === this.overlayHeaderOriginalParent) {
          this.overlayHeaderOriginalParent.insertBefore(headerContainer, next);
        } else {
          this.overlayHeaderOriginalParent.appendChild(headerContainer);
        }
      }
      if (metaWrap && this.editorMetaOriginalParent && editorContainer && editorContainer.contains(metaWrap)) {
        const next = this.editorMetaOriginalNextSibling;
        if (next && next.parentNode === this.editorMetaOriginalParent) {
          this.editorMetaOriginalParent.insertBefore(metaWrap, next);
        } else {
          this.editorMetaOriginalParent.appendChild(metaWrap);
        }
      }
      if (overlayMain && this.overlayMainOriginalParent && editorContainer && editorContainer.contains(overlayMain)) {
        const next = this.overlayMainOriginalNextSibling;
        if (next && next.parentNode === this.overlayMainOriginalParent) {
          this.overlayMainOriginalParent.insertBefore(overlayMain, next);
        } else {
          this.overlayMainOriginalParent.appendChild(overlayMain);
        }
      }
      if (editorContainer) {
        editorContainer.innerHTML = `
          <div style="display:flex; flex:1; align-items:center; justify-content:center; color:var(--text-muted); font-size:1.1rem; padding: 24px; text-align: center;">
            ${t('dailyreview.noNotesToReview')}
          </div>
        `;
      }
      
      this.updateStep3DeleteButtonState();
      return;
    }

    const plannerWrap = document.getElementById('dr-step3-planner-wrap');
    if (plannerWrap) plannerWrap.style.display = 'none';

    if (this.todayNotes.length > 0) {
      this.mountStep3NoteEditor();

      this.todayNotes.forEach(note => {
        const summaryText = (note.summary || '').replace(/<[^>]*>/g, '').trim();
        const hasSummary = summaryText.length > 0;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.notePath = note.path;
        btn.className = `dr-note-item-btn${this.activeNotePath === note.path ? ' active' : ''}${note.reviewed ? ' reviewed' : ''}`;
        
        const titleSpan = document.createElement('span');
        titleSpan.style.overflow = 'hidden';
        titleSpan.style.textOverflow = 'ellipsis';
        titleSpan.style.whiteSpace = 'nowrap';
        titleSpan.style.flex = '1';
        const noteId = note.id || (note.path ? note.path.replace(/^notes\//i, '').replace(/\.html$/i, '') : '');
        const isDummy = (t, id) => !t || t === id || t === 'Untitled' || t === 'Untitled Note' || /^\d{4}-\d{2}-\d{2}(-\d+)?$/.test(t) || /^note[-_]/.test(t);
        let displayTitle = note.title;
        if (isDummy(displayTitle, noteId)) {
          const cachedHtml = (typeof StorageAPI !== 'undefined' && StorageAPI.getNoteFromCache) ? StorageAPI.getNoteFromCache(note.path || noteId) : null;
          if (cachedHtml && typeof parseNoteHTML === 'function') {
            const parsed = parseNoteHTML(cachedHtml);
            if (parsed.title && !isDummy(parsed.title, noteId)) {
              displayTitle = parsed.title;
            }
          }
        }
        titleSpan.textContent = displayTitle || note.title || t('common.untitledNote');
        btn.appendChild(titleSpan);

        if (hasSummary) {
          const summaryBadge = document.createElement('span');
          summaryBadge.className = 'dr-note-has-summary-badge';
          summaryBadge.textContent = `📝 ${t('dailyreview.hasSummaryBadge') || 'Summary'}`;
          summaryBadge.title = t('dailyreview.hasSummaryTooltip') || 'This note has a summary';
          btn.appendChild(summaryBadge);
        }

        const isOpenInWindow = window.AppBridge?.noteWindow ? window.AppBridge.noteWindow.isNoteOpen(note.id, note.path) : false;
        if (isOpenInWindow) {
          btn.classList.add('has-open-window');
          const openBadge = document.createElement('span');
          openBadge.className = 'dr-note-open-window-badge';
          openBadge.title = (typeof t === 'function' && t('dailyreview.noteOpenInWindowBadgeTooltip')) || 'Cette note est ouverte dans une fenêtre dédiée';
          openBadge.textContent = `🪟 ${(typeof t === 'function' && t('dailyreview.noteOpenInWindowBadge')) || 'Ouverte en fenêtre'}`;
          btn.appendChild(openBadge);
        }

        const prop = this.noteProposals && this.noteProposals[note.path];
        if (prop && prop.status && prop.status !== 'idle') {
          const propBadge = document.createElement('span');
          propBadge.className = `dr-batch-badge status-${prop.status}`;
          if (prop.status === 'queued') {
            propBadge.textContent = t('dailyreview.statusQueued') || 'Queued';
            propBadge.title = t('dailyreview.statusQueued') || 'In queue';
          } else if (prop.status === 'processing') {
            propBadge.innerHTML = `<span class="spinner" style="display:inline-block; width:10px; height:10px; border:2px solid currentColor; border-right-color:transparent; border-radius:50%; animation:spin 0.8s linear infinite; margin-right:3px;"></span> ${t('dailyreview.statusProcessing') || 'Processing...'}`;
            propBadge.title = t('dailyreview.statusProcessing') || 'Processing';
          } else if (prop.status === 'ready') {
            propBadge.textContent = `✨ ${t('dailyreview.statusReady') || 'Ready'}`;
            propBadge.title = t('dailyreview.viewProposalTooltip') || 'Perfect Note ready';
          } else if (prop.status === 'error') {
            propBadge.textContent = `⚠️ Error`;
            propBadge.title = (typeof t === 'function' && t('dailyreview.aiConversionFailedTooltip')) || 'AI conversion failed';
          }
          btn.appendChild(propBadge);
        }

        const cb = document.createElement('span');
        cb.className = 'dr-note-checkbox-indicator';
        cb.title = note.reviewed ? (t('dailyreview.reviewedState') || 'Note revue') : (t('dailyreview.markReviewed') || 'Marquer comme revue');
        btn.appendChild(cb);

        cb.onclick = (e) => {
          e.stopPropagation();
          this.toggleNoteReviewed(note.path, !note.reviewed);
        };

        btn.onclick = () => this.selectNoteForReview(note.path);
        listContainer.appendChild(btn);
      });

      // Auto-select first note if none active
      if (this.todayNotes.length > 0 && !this.activeNotePath) {
        this.selectNoteForReview(this.todayNotes[0].path);
      } else if (this.activeNotePath) {
        // Re-evaluate active note selection
        const exists = this.todayNotes.some(n => n.path === this.activeNotePath);
        if (!exists) {
          this.selectNoteForReview(this.todayNotes[0].path);
        } else {
          this.selectNoteForReview(this.activeNotePath);
        }
      }
    } else {
      // If there are no today's notes but we have unassociated blocks
      listContainer.innerHTML = `
        <div style="padding: 16px 8px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
          ${t('dailyreview.noNotesToReview')}
        </div>
      `;
      const editorContainer = document.getElementById('dr-note-review-editor-container');
      if (editorContainer) {
        editorContainer.innerHTML = `
          <div style="display:flex; flex:1; align-items:center; justify-content:center; color:var(--text-muted); font-size:1.1rem; padding: 24px; text-align: center;">
            ${t('dailyreview.noNotesToReview')}
          </div>
        `;
      }
    }

    // Append unassociated calendar blocks section at the bottom of the list container
    if (unassociatedEvents.length > 0) {
      const heading = document.createElement('h4');
      heading.className = 'dr-unassociated-blocks-heading';
      heading.style.margin = '16px 0 8px 0';
      heading.style.padding = '0 8px';
      heading.style.fontSize = '0.85rem';
      heading.style.fontWeight = '600';
      heading.style.color = 'var(--text-muted)';
      heading.textContent = t('dailyreview.unassociatedBlocksTitle') || 'Blocs sans notes';
      listContainer.appendChild(heading);

      unassociatedEvents.forEach(ev => {
        const card = document.createElement('div');
        card.className = 'dr-unassociated-block-card';
        
        const isAssociated = !!ev.noteId;
        const isIgnored = this.ignoredBlockIds.has(ev.id);
        const isResolved = isAssociated || isIgnored;
        
        card.classList.toggle('resolved', isResolved);
        card.classList.toggle('ignored', isIgnored);
        card.classList.toggle('associated', isAssociated);

        const headerDiv = document.createElement('div');
        headerDiv.className = 'dr-unassociated-card-header';
        
        const titleDiv = document.createElement('div');
        titleDiv.className = 'dr-unassociated-card-title';
        
        const textSpan = document.createElement('span');
        textSpan.textContent = `${ev.title || 'Untitled Session'} (${ev.startTime || ''} - ${ev.endTime || ''})`;
        titleDiv.appendChild(textSpan);
        if (ev.context) {
          const ctxDiv = document.createElement('div');
          ctxDiv.style.cssText = 'font-size: 0.75rem; color: var(--text-muted); margin-top: 2px; line-height: 1.3; font-weight: normal;';
          ctxDiv.textContent = `🎯 ${ev.context}`;
          titleDiv.appendChild(ctxDiv);
        }
        headerDiv.appendChild(titleDiv);

        // Checkbox status indicator on the right side of header (positioned like dr-note-checkbox-indicator)
        const cbIcon = document.createElement('span');
        cbIcon.className = `dr-block-checkbox-indicator ${isResolved ? 'checked' : ''} ${isIgnored ? 'ignored' : ''}`;
        cbIcon.title = isIgnored ? (t('dailyreview.blockIgnoredLabel') || 'Ignored (No note needed)') : (t('dailyreview.assocModalIgnoreBtn') || 'Ignore');
        cbIcon.onclick = (e) => {
          e.stopPropagation();
          this.toggleBlockIgnored(ev.id);
        };
        headerDiv.appendChild(cbIcon);
        card.appendChild(headerDiv);

        const detailsDiv = document.createElement('div');
        detailsDiv.className = 'dr-unassociated-card-actions';

        if (isAssociated) {
          const note = (typeof manifest !== 'undefined' ? manifest : []).find(n => n.id === ev.noteId);
          const linkSpan = document.createElement('span');
          linkSpan.style.cssText = 'font-size:0.75rem; color:var(--accent); text-decoration:underline; cursor:pointer; font-weight: 500; flex:1;';
          linkSpan.textContent = `🔗 ${note ? note.title : (t('planner.noteLinked') || 'Note linked')}`;
          linkSpan.onclick = async () => {
            if (note && note.path) {
              if (typeof syncTagsBetweenBlocAndNote === 'function') {
                await syncTagsBetweenBlocAndNote(ev, note);
              }
              openNoteOverlay(note.path, null, null, false, null, { collapseMetadata: true, fromBloc: true, sourceEvent: ev, sameWindow: true });
            }
          };
          detailsDiv.appendChild(linkSpan);

          const unlinkBtn = document.createElement('button');
          unlinkBtn.type = 'button';
          unlinkBtn.className = 'btn btn-secondary';
          unlinkBtn.style.cssText = 'padding:2px 8px; font-size:0.7rem; margin-left: 8px;';
          unlinkBtn.textContent = '×';
          unlinkBtn.title = t('planner.unlinkNote') || 'Unlink note';
          unlinkBtn.onclick = () => this.associateNoteToBlock(ev.id, '');
          detailsDiv.appendChild(unlinkBtn);
        } else if (isIgnored) {
          const ignoredSpan = document.createElement('span');
          ignoredSpan.style.cssText = 'font-size:0.75rem; color:var(--text-muted); font-style:italic; flex:1;';
          ignoredSpan.textContent = t('dailyreview.blockIgnoredLabel') || 'Ignored (No note needed)';
          detailsDiv.appendChild(ignoredSpan);

          const changeBtn = document.createElement('button');
          changeBtn.type = 'button';
          changeBtn.className = 'btn btn-secondary';
          changeBtn.style.cssText = 'padding:2px 8px; font-size:0.7rem;';
          changeBtn.textContent = t('dailyreview.changeBtn') || 'Change';
          changeBtn.onclick = () => this.toggleBlockIgnored(ev.id);
          detailsDiv.appendChild(changeBtn);
        } else {
          const actionBtn = document.createElement('button');
          actionBtn.type = 'button';
          actionBtn.className = 'btn btn-primary';
          actionBtn.style.cssText = 'padding:4px 10px; font-size:0.75rem; font-weight:600; flex:1;';
          actionBtn.textContent = t('dailyreview.linkOrCreateNoteBtn') || 'Link / Create Note';
          actionBtn.onclick = () => this.openBlockAssociationModal(ev.id);
          detailsDiv.appendChild(actionBtn);

          const ignoreBtn = document.createElement('button');
          ignoreBtn.type = 'button';
          ignoreBtn.className = 'btn btn-secondary btn-dr-direct-ignore';
          ignoreBtn.textContent = t('dailyreview.ignoreBtn') || 'Ignorer';
          ignoreBtn.onclick = () => this.toggleBlockIgnored(ev.id);
          detailsDiv.appendChild(ignoreBtn);
        }
        card.appendChild(detailsDiv);
        listContainer.appendChild(card);
      });
    }

    this.updateStep3DeleteButtonState();
  },

  toggleBlockIgnored(eventId) {
    if (this.ignoredBlockIds.has(eventId)) {
      this.ignoredBlockIds.delete(eventId);
    } else {
      this.ignoredBlockIds.add(eventId);
    }
    this.saveIgnoredBlocks();
    this.renderStep3();
  },

  renderStep3PlannerSidebar() {
    const plannerPane = document.getElementById('dr-step3-planner-pane');
    const planner = document.getElementById('planner-panel');
    if (!plannerPane || !planner) return;

    this.step3PlannerVisible = false;
    plannerPane.innerHTML = '';
    plannerPane.style.display = 'none';
  },

  toggleStep3PlannerSidebar() {
    const plannerWrap = document.getElementById('dr-step3-planner-wrap');
    if (plannerWrap) plannerWrap.style.display = 'none';
    this.step3PlannerVisible = false;
  },

  async deleteCurrentNote() {
    const deletedPath = this.activeNotePath || (typeof currentNote !== 'undefined' && currentNote ? currentNote.path : null);
    if (!deletedPath) return;

    const currentIndex = this.todayNotes.findIndex(note => note.path === deletedPath);
    await deleteCurrentNote();

    if (currentIndex >= 0) {
      const fallbackNote = this.todayNotes[currentIndex + 1] || this.todayNotes[currentIndex - 1] || null;
      this.activeNotePath = fallbackNote ? fallbackNote.path : null;
    } else {
      this.activeNotePath = null;
    }

    await this.renderStep3();
  },

  /**
   * Select a note inside the Step 3 Split Screen View
   */
  async selectNoteForReview(path) {
    this.activeNotePath = path;

    // Update active highlight classes
    document.querySelectorAll('.dr-note-item-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.notePath === path);
    });

    // Call openNoteOverlay to populate it
    if (typeof openNoteOverlay === 'function') {
      await openNoteOverlay(path, null, null, false, null, { sameWindow: true, embeddedInDailyReview: true });
      if (typeof setOverlayViewMode === 'function') setOverlayViewMode(false);
      if (typeof metadataCollapsed !== 'undefined') {
        metadataCollapsed = true;
        if (typeof _applyMetadataCollapseState === 'function') _applyMetadataCollapseState();
        if (typeof _updateMetaTitlePreview === 'function') _updateMetaTitlePreview();
      }

      this.mountStep3NoteEditor();
      this.hideStep3NotePreviewPane();
      this.updateNoteEditorLockState(path);
      
      // Intercept overlay and force it to stay hidden as overlay dialog
      const overlay = document.getElementById('note-edit-overlay');
      if (overlay) overlay.style.display = 'none';
    }

    // If this note already has a ready proposal, show integrated proposal review
    const proposal = this.noteProposals && this.noteProposals[path];
    if (proposal && proposal.status === 'ready') {
      await this.renderIntegratedProposalView(path);
    } else {
      this.switchToRawEditor();
    }

    // Refresh mark reviewed button state
    this.updateMarkReviewedButtonState();
    this.updateStep3DeleteButtonState();
  },

  updateStep3DeleteButtonState() {
    const deleteBtn = document.getElementById('btn-dr-delete-note');
    if (!deleteBtn) return;
    deleteBtn.disabled = !(this.activeNotePath && typeof currentNote !== 'undefined' && currentNote && currentNote.path);
  },

  setStep3NoteItemState(notePath, { finalizing = false, reviewed = null } = {}) {
    if (!notePath) return;

    let noteBtn = null;
    document.querySelectorAll('.dr-note-item-btn').forEach(btn => {
      if (btn.dataset.notePath === notePath) noteBtn = btn;
    });
    if (!noteBtn) return;

    if (finalizing) {
      noteBtn.classList.add('finalizing');
    } else {
      noteBtn.classList.remove('finalizing');
    }

    if (reviewed === true) {
      noteBtn.classList.add('reviewed');
    } else if (reviewed === false) {
      noteBtn.classList.remove('reviewed');
    }
  },

  isNoteReviewed(note) {
    if (!note) return false;
    if (typeof note === 'object' && note.reviewed === true) return true;
    const path = typeof note === 'string' ? note : note.path;
    const id = typeof note === 'object' ? note.id : null;
    const allNotes = (typeof manifest !== 'undefined' && Array.isArray(manifest)) ? manifest : (Array.isArray(this.todayNotes) ? this.todayNotes : []);
    const found = allNotes.find(m => (path && m.path === path) || (id && m.id === id));
    return !!(found && found.reviewed);
  },

  updateMarkReviewedButtonState() {
    const markReviewedBtn = document.getElementById('btn-dr-mark-reviewed');
    if (!markReviewedBtn) return;

    const allReviewed = this.todayNotes.every(note => this.isNoteReviewed(note));

    if (allReviewed) {
      markReviewedBtn.textContent = t('dailyreview.nextBtn');
      markReviewedBtn.disabled = false;
    } else {
      markReviewedBtn.textContent = t('dailyreview.markReviewed');
      const currentNoteObj = (typeof manifest !== 'undefined' ? manifest : []).find(n => n.path === this.activeNotePath);
      if (currentNoteObj && currentNoteObj.reviewed) {
        markReviewedBtn.disabled = true;
      } else {
        markReviewedBtn.disabled = false;
      }
    }
  },

  async toggleNoteReviewed(notePath, isReviewed) {
    const activeNote = typeof currentNote !== 'undefined' ? currentNote : null;
    let noteSnapshot;
    
    if (activeNote && activeNote.path === notePath) {
      noteSnapshot = { ...activeNote, reviewed: isReviewed };
      activeNote.reviewed = isReviewed;
    } else {
      const found = (typeof manifest !== 'undefined' ? manifest : []).find(n => n.path === notePath);
      if (!found) return;
      noteSnapshot = { ...found, reviewed: isReviewed };
    }

    this.setStep3NoteItemState(notePath, { finalizing: true });

    try {
      const originalHTML = await StorageAPI.readNoteContent(notePath);
      const parsed = (typeof parseNoteHTML === 'function') ? parseNoteHTML(originalHTML) : null;
      const changes = {
        title: noteSnapshot.title ?? parsed?.title ?? '',
        date: noteSnapshot.date ?? parsed?.date ?? '',
        group_tags: noteSnapshot.group_tags ?? parsed?.group_tags ?? [],
        major_topic_tags: noteSnapshot.major_topic_tags ?? parsed?.major_topic_tags ?? [],
        topic_tags: noteSnapshot.topic_tags ?? parsed?.topic_tags ?? [],
        extra_tags: noteSnapshot.extra_tags ?? parsed?.extra_tags ?? [],
        mainHTML: noteSnapshot.mainHTML ?? parsed?.mainHTML ?? '<p></p>',
        summary: noteSnapshot.summary ?? parsed?.summary ?? '',
        reviewed: isReviewed
      };

      const updatedHTML = applyNoteEdits(originalHTML, changes);
      await StorageAPI.writeNoteContent(notePath, updatedHTML);

      const modified = new Date().toISOString();
      upsertManifest({
        ...noteSnapshot,
        ...changes,
        reviewed: isReviewed,
        originalHTML: updatedHTML,
        modified
      });
      await saveManifest({ force: true });

      if (typeof renderPlanner === 'function') {
        renderPlanner();
      }

      broadcastSync({
        type: 'NOTE_SAVED',
        noteId: noteSnapshot.id || '',
        path: notePath,
        modified: new Date().toISOString()
      });

      const noteEntry = this.todayNotes.find(n => n.path === notePath);
      if (noteEntry) noteEntry.reviewed = isReviewed;
      
      this.setStep3NoteItemState(notePath, { finalizing: false, reviewed: isReviewed });
      this.updateMarkReviewedButtonState();
      
      if (activeNote && activeNote.path === notePath) {
        const validateBtn = document.getElementById('overlay-validate-note-btn');
        if (validateBtn) {
          if (isReviewed) {
            validateBtn.classList.add('reviewed');
          } else {
            validateBtn.classList.remove('reviewed');
          }
        }
      }

      toast(isReviewed ? (t('dailyreview.noteValidatedToast') || 'Note validated') : 'Note unvalidated');
    } catch (e) {
      console.error('Toggle note reviewed failed:', e);
      this.setStep3NoteItemState(notePath, { finalizing: false, reviewed: !isReviewed });
      toast(t('dailyreview.noteReviewSaveFailed') || 'Save failed', true);
    }
  },

  /**
   * Mark current active note as reviewed
   */
  async markCurrentNoteAsReviewed() {
    const allReviewed = this.todayNotes.every(note => this.isNoteReviewed(note));

    if (allReviewed) {
      this.navigateStep(1);
      return;
    }

    const activeNote = typeof currentNote !== 'undefined' ? currentNote : null;
    if (!this.activeNotePath || !activeNote) return;

    const notePath = this.activeNotePath;
    const noteSnapshot = { ...activeNote, reviewed: true };

    activeNote.reviewed = true;
    this.setStep3NoteItemState(notePath, { finalizing: true });

    const savePromise = typeof finalizeReviewedNoteSnapshot === 'function'
      ? finalizeReviewedNoteSnapshot(noteSnapshot)
      : Promise.resolve(false);

    // Switch to the next note sequentially if available
    const currentIndex = this.todayNotes.findIndex(n => n.path === this.activeNotePath);
    if (currentIndex >= 0 && currentIndex < this.todayNotes.length - 1) {
      const nextNote = this.todayNotes[currentIndex + 1];
      this.activeNotePath = nextNote.path;
      await this.selectNoteForReview(nextNote.path);
    }

    const saved = await savePromise;
    this.setStep3NoteItemState(notePath, { finalizing: false, reviewed: saved ? true : false });
    if (saved) {
      const noteEntry = this.todayNotes.find(n => n.path === notePath);
      if (noteEntry) noteEntry.reviewed = true;
      toast(t('dailyreview.noteValidatedToast'));
    } else {
      activeNote.reviewed = false;
      const noteEntry = this.todayNotes.find(n => n.path === notePath);
      if (noteEntry) noteEntry.reviewed = false;
      toast(t('dailyreview.noteReviewSaveFailed'), true);
    }
  },

  /* ── 🌟 Batch Perfect Notes & Integrated Proposal Review ── */
  async startBatchPerfectNotes() {
    if (this.batchState && this.batchState.active) {
      toast((typeof t === 'function' && t('dailyreview.statusProcessing')) || 'Batch conversion is already running.');
      return;
    }

    if (!Array.isArray(this.todayNotes) || this.todayNotes.length === 0) {
      toast((typeof t === 'function' && t('dailyreview.noNotesToReview')) || 'No notes to review.');
      return;
    }

    // Filter out notes that are already reviewed
    const unreviewedNotes = this.todayNotes.filter(n => !this.isNoteReviewed(n));
    if (unreviewedNotes.length === 0) {
      toast((typeof t === 'function' && t('dailyreview.allNotesAlreadyReviewed')) || 'All notes have already been reviewed.');
      return;
    }

    if (this.batchState && this.batchState.abortController) {
      try { this.batchState.abortController.abort(); } catch (_e) {}
    }

    this.batchState = {
      active: true,
      cancelled: false,
      currentIndex: 0,
      totalCount: unreviewedNotes.length,
      abortController: new AbortController()
    };

    // Mark all uncompleted unreviewed notes as queued
    unreviewedNotes.forEach(n => {
      if (!this.noteProposals[n.path] || this.noteProposals[n.path].status !== 'ready') {
        this.noteProposals[n.path] = { status: 'queued', note: n };
      }
    });

    const progressContainer = document.getElementById('dr-batch-progress-container');
    if (progressContainer) progressContainer.style.display = 'block';

    const batchBtn = document.getElementById('btn-dr-batch-perfect');
    if (batchBtn) {
      batchBtn.disabled = true;
      batchBtn.classList.add('loading');
    }

    this.renderStep3ListBadges();

    const total = unreviewedNotes.length;
    let completedCount = 0;

    for (let i = 0; i < total; i++) {
      if (this.batchState.cancelled) break;
      const note = unreviewedNotes[i];
      if (!note || !note.path) continue;

      if (this.isNoteReviewed(note)) continue;

      if (this.noteProposals[note.path]?.status === 'ready') {
        completedCount++;
        continue;
      }

      this.batchState.currentIndex = i;
      this.noteProposals[note.path] = { ...(this.noteProposals[note.path] || {}), status: 'processing', note };
      this.renderStep3ListBadges();

      const noteTitle = note.title || (typeof t === 'function' ? t('common.untitledNote') : 'Untitled Note') || 'Untitled Note';
      this.updateBatchProgress(i, total, 10, `${(typeof t === 'function' && t('dailyreview.statusProcessing')) || 'Processing'}: "${noteTitle}"`);

      try {
        let noteHtml = '';
        if (this.activeNotePath === note.path) {
          const editor = document.getElementById('edit-textarea');
          noteHtml = editor?.innerHTML || (typeof currentNote !== 'undefined' ? currentNote?.mainHTML : '') || '';
        }
        if (!noteHtml && typeof StorageAPI !== 'undefined' && typeof StorageAPI.readNoteContent === 'function') {
          try {
            noteHtml = await StorageAPI.readNoteContent(note.path);
          } catch (e) {
            console.warn('Failed reading note content for batch refactor', e);
          }
        }
        if (!noteHtml && note.content) {
          noteHtml = note.content;
        }

        const noteContent = typeof htmlToPlainText === 'function' ? htmlToPlainText(noteHtml) : (noteHtml || '').replace(/<[^>]*>/g, ' ');

        const currentUserName = (typeof settings !== 'undefined' && settings && settings.username) ? settings.username : (typeof getDefaultMeLabel === 'function' ? getDefaultMeLabel() : 'Me');

        const result = await LLMService.runRefactorAgentLoop(note, noteContent, {
          noteHtml: noteHtml,
          controller: this.batchState.abortController,
          onProgress: (pct, msg) => {
            this.updateBatchProgress(i, total, pct, `${noteTitle}: ${msg}`);
          }
        });

        if (this.batchState.cancelled) break;

        const rawA = cleanProposalHtml(result.proposalA);
        const rawB = cleanProposalHtml(result.proposalB);
        const hasImagesA = (noteHtml && (noteHtml.includes('<img') || noteHtml.includes('NIMGTK') || noteHtml.includes('!['))) || /\[\s*IMAGE[_\s]\d+/i.test(rawA);
        const hasImagesB = (noteHtml && (noteHtml.includes('<img') || noteHtml.includes('NIMGTK') || noteHtml.includes('!['))) || /\[\s*IMAGE[_\s]\d+/i.test(rawB);

        const propA = hasImagesA ? restoreOriginalImagesToProposal(noteHtml, rawA) : rawA;
        const propB = hasImagesB ? restoreOriginalImagesToProposal(noteHtml, rawB) : rawB;

        this.noteProposals[note.path] = {
          status: 'ready',
          note: note,
          originalHtml: noteHtml,
          originalHtmlSnapshot: noteHtml,
          proposalA: propA,
          proposalB: propB,
          proposalC: '',
          proposalActionsA: extractProposedActionsFromProposal(propA, { proposed_decisions: result.proposedDecisionsA, proposed_todos: result.proposedTodosA, proposed_colleague_links: result.proposedColleaguesA, proposed_note_links: result.proposedNotesA }),
          proposalActionsB: extractProposedActionsFromProposal(propB, { proposed_decisions: result.proposedDecisionsB, proposed_todos: result.proposedTodosB, proposed_colleague_links: result.proposedColleaguesB, proposed_note_links: result.proposedNotesB }),
          proposalActionsC: null,
          meetingSummary: cleanMeetingSummaryHtml(result.meetingSummary || '', currentUserName),
          meetingSummaryA: cleanMeetingSummaryHtml(result.meetingSummaryA || result.meetingSummary || '', currentUserName),
          meetingSummaryB: cleanMeetingSummaryHtml(result.meetingSummaryB || result.meetingSummary || '', currentUserName),
          meetingSummaryC: '',
          scratchpad: result.scratchpad,
          scratchpadLog: result.scratchpadLog,
          topicMemories: result.topicMemories,
          proposedWorkstreams: result.proposedWorkstreams || [],
          proposedGroup: result.proposedGroup || null,
          proposedTopic: result.proposedTopic || null,
          tagChangeReason: result.tagChangeReason || '',
          acceptedTagChanges: false,
          questions: result.questions || [],
          activeTab: 'A'
        };

        completedCount++;
        this.renderStep3ListBadges();

        // If this note is currently selected on screen, immediately show integrated proposal
        if (this.activeNotePath === note.path) {
          await this.renderIntegratedProposalView(note.path);
        }
      } catch (err) {
        if (err && err.name === 'AbortError') break;
        console.error('Batch refactor failed for note', note.path, err);
        if (this.noteProposals[note.path]) {
          this.noteProposals[note.path].status = 'error';
        }
        this.renderStep3ListBadges();
      }
    }

    this.batchState.active = false;
    if (batchBtn) {
      batchBtn.disabled = false;
      batchBtn.classList.remove('loading');
    }

    if (!this.batchState.cancelled) {
      this.updateBatchProgress(total, total, 100, (typeof t === 'function' && t('dailyreview.batchCompleteToast')) || 'All notes converted!');
      toast((typeof t === 'function' && t('dailyreview.batchCompleteToast')) || 'All notes converted to Perfect Notes! You can now review them note-by-note.');
      setTimeout(() => {
        if (!this.batchState.active && progressContainer) {
          progressContainer.style.display = 'none';
        }
      }, 4000);
    }
  },

  cancelBatchPerfectNotes() {
    if (this.batchState && this.batchState.abortController) {
      try { this.batchState.abortController.abort(); } catch (_e) {}
    }
    this.batchState.active = false;
    this.batchState.cancelled = true;

    // Reset any still queued or processing notes
    Object.keys(this.noteProposals).forEach(p => {
      if (this.noteProposals[p].status === 'queued' || this.noteProposals[p].status === 'processing') {
        delete this.noteProposals[p];
      }
    });

    const progressContainer = document.getElementById('dr-batch-progress-container');
    if (progressContainer) progressContainer.style.display = 'none';

    const batchBtn = document.getElementById('btn-dr-batch-perfect');
    if (batchBtn) {
      batchBtn.disabled = false;
      batchBtn.classList.remove('loading');
    }

    this.renderStep3ListBadges();
    toast((typeof t === 'function' && t('dailyreview.cancelBatch')) || 'Batch conversion cancelled.');
  },

  updateBatchProgress(currentIndex, totalCount, stepPct, statusText) {
    const bar = document.getElementById('dr-batch-progress-bar');
    const statusEl = document.getElementById('dr-batch-progress-status');
    const total = Math.max(1, totalCount || 1);
    const overallPct = Math.min(100, Math.round(((currentIndex + (Math.max(0, Math.min(100, stepPct || 0)) / 100)) / total) * 100));

    if (bar) bar.style.width = `${overallPct}%`;
    if (statusEl) {
      const template = (typeof t === 'function' && t('dailyreview.batchProgress')) || 'Converting notes to Perfect Notes... ({current}/{total})';
      const countStr = template.replace('{current}', String(Math.min(currentIndex + 1, total))).replace('{total}', String(total));
      statusEl.textContent = statusText ? `${countStr} — ${statusText}` : countStr;
    }
  },

  renderStep3ListBadges() {
    document.querySelectorAll('.dr-note-item-btn').forEach(btn => {
      const path = btn.dataset.notePath;
      if (!path) return;
      let badge = btn.querySelector('.dr-batch-badge');
      const prop = this.noteProposals && this.noteProposals[path];

      if (!prop || !prop.status || prop.status === 'idle') {
        if (badge) badge.remove();
        return;
      }

      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'dr-batch-badge';
        const cb = btn.querySelector('.dr-note-checkbox-indicator');
        if (cb) btn.insertBefore(badge, cb);
        else btn.appendChild(badge);
      }

      badge.className = `dr-batch-badge status-${prop.status}`;
      if (prop.status === 'queued') {
        badge.textContent = (typeof t === 'function' && t('dailyreview.statusQueued')) || 'Queued';
        badge.title = (typeof t === 'function' && t('dailyreview.statusQueued')) || 'In queue';
      } else if (prop.status === 'processing') {
        badge.innerHTML = `<span class="spinner" style="display:inline-block; width:10px; height:10px; border:2px solid currentColor; border-right-color:transparent; border-radius:50%; animation:spin 0.8s linear infinite; margin-right:3px;"></span> ${(typeof t === 'function' && t('dailyreview.statusProcessing')) || 'Processing...'}`;
        badge.title = (typeof t === 'function' && t('dailyreview.statusProcessing')) || 'Processing';
      } else if (prop.status === 'ready') {
        badge.textContent = `✨ ${(typeof t === 'function' && t('dailyreview.statusReady')) || 'Ready'}`;
        badge.title = (typeof t === 'function' && t('dailyreview.viewProposalTooltip')) || 'Perfect Note ready';
      } else if (prop.status === 'error') {
        badge.textContent = `⚠️ Error`;
        badge.title = (typeof t === 'function' && t('dailyreview.aiConversionFailedTooltip')) || 'AI conversion failed';
      }
    });
  },

  async renderIntegratedProposalView(notePath) {
    if (notePath) this.activeNotePath = notePath;
    const proposal = this.noteProposals && this.noteProposals[this.activeNotePath];
    if (!proposal || proposal.status !== 'ready') {
      this.switchToRawEditor();
      return;
    }

    this.viewingIntegratedProposal = true;
    const rawEditorContainer = document.getElementById('dr-note-review-editor-container');
    const integratedContainer = document.getElementById('dr-integrated-proposal-container');

    if (rawEditorContainer) rawEditorContainer.style.display = 'none';
    if (integratedContainer) integratedContainer.style.display = 'flex';

    // Workstream & Tags recommendation banner
    const tagsContainer = document.getElementById('dr-integrated-tags-container');
    if (tagsContainer) {
      if (typeof RefactorModalController !== 'undefined' && typeof RefactorModalController.renderTagsBanner === 'function') {
        const activeNoteObj = (typeof currentNote !== 'undefined' && currentNote && currentNote.path === this.activeNotePath)
          ? currentNote
          : (typeof manifest !== 'undefined' && Array.isArray(manifest) ? manifest.find(n => n.path === this.activeNotePath) : null);
        RefactorModalController.renderTagsBanner(tagsContainer, {
          note: activeNoteObj,
          proposal,
          accepted: proposal.acceptedTagChanges,
          onToggle: 'DailyReviewController.toggleIntegratedAcceptTags(this)'
        });
      }
    }

    // Clarification Questions banner (if agent raised questions)
    const questionsContainer = document.getElementById('dr-integrated-questions-container');
    if (questionsContainer) {
      if (Array.isArray(proposal.questions) && proposal.questions.length > 0) {
        questionsContainer.style.display = 'block';
        questionsContainer.innerHTML = `
          <div style="font-weight:700; color:#b45309; font-size:0.85rem; margin-bottom:4px;">⚠️ Points of Clarification:</div>
          <ul style="margin:0; padding-left:18px; font-size:0.82rem; color:var(--text);">
            ${proposal.questions.map(q => `<li><strong>${escH(q.question || '')}</strong>${q.context ? ` <em style="color:var(--text-muted);">("${escH(q.context)}")</em>` : ''}</li>`).join('')}
          </ul>
        `;
      } else {
        questionsContainer.style.display = 'none';
      }
    }

    const previewPane = document.getElementById('dr-integrated-preview-pane');
    if (previewPane && typeof attachRichTextShortcutsAndToolbar === 'function') {
      attachRichTextShortcutsAndToolbar(previewPane);
    }

    const tabC = document.getElementById('dr-tab-proposal-c');
    if (tabC) tabC.style.display = proposal.proposalC ? 'inline-flex' : 'none';

    this.toggleIntegratedFeedbackDrawer(false);
    this.integratedActiveTab = null;
    this.switchIntegratedTab(proposal.activeTab || 'A');
  },

  toggleIntegratedAcceptTags(btn) {
    const proposal = this.noteProposals && this.noteProposals[this.activeNotePath];
    if (!proposal) return;
    proposal.acceptedTagChanges = !proposal.acceptedTagChanges;
    if (btn) {
      btn.textContent = proposal.acceptedTagChanges
        ? '✓ ' + ((typeof t === 'function' && t('common.accepted')) || 'Accepted')
        : '+ ' + ((typeof t === 'function' && t('dailyreview.acceptTagSuggestions')) || 'Accept Suggestions');
      btn.classList.toggle('btn-primary', proposal.acceptedTagChanges);
      btn.classList.toggle('btn-secondary', !proposal.acceptedTagChanges);
    }
    if (proposal.acceptedTagChanges) {
      toast((typeof t === 'function' && t('dailyreview.tagsAcceptedToast')) || 'Workstream & tag suggestions selected');
    }
  },

  formatProposal(cmd) {
    const previewPane = document.getElementById('dr-integrated-preview-pane');
    if (!previewPane) return;
    previewPane.focus();
    if (typeof formatRichTextInEditor === 'function') {
      formatRichTextInEditor(previewPane, cmd);
    } else if (typeof formatRichText === 'function') {
      formatRichText(cmd);
    }
  },

  switchIntegratedTab(tabKey) {
    const proposal = this.noteProposals && this.noteProposals[this.activeNotePath];
    if (!proposal) return;

    // Save any inline edits from previous tab if switching away
    const currentContainer = document.getElementById('dr-integrated-proposal-html');
    if (currentContainer && this.integratedActiveTab && this.integratedActiveTab !== 'scratchpad' && this.integratedActiveTab !== tabKey) {
      if (this.integratedActiveTab === 'A') proposal.proposalA = currentContainer.innerHTML;
      else if (this.integratedActiveTab === 'B') proposal.proposalB = currentContainer.innerHTML;
      else if (this.integratedActiveTab === 'C') proposal.proposalC = currentContainer.innerHTML;
      else if (this.integratedActiveTab === 'original') proposal.originalHtml = currentContainer.innerHTML;
    }

    proposal.activeTab = tabKey;
    this.integratedActiveTab = tabKey;

    const tabs = ['A', 'B', 'C', 'original', 'scratchpad'];
    tabs.forEach(k => {
      let btnId = '';
      if (k === 'scratchpad') btnId = 'dr-tab-scratchpad';
      else if (k === 'original') btnId = 'dr-tab-original';
      else btnId = `dr-tab-proposal-${k.toLowerCase()}`;
      const btn = document.getElementById(btnId);
      if (btn) btn.classList.toggle('active', k === tabKey);
    });

    const previewPane = document.getElementById('dr-integrated-preview-pane');
    const scratchpadPane = document.getElementById('dr-integrated-scratchpad-pane');
    const toolbarEl = document.getElementById('dr-integrated-toolbar');
    const descEl = document.getElementById('dr-integrated-tab-desc');
    const applyBtn = document.getElementById('btn-dr-integrated-apply');

    if (tabKey === 'scratchpad') {
      if (previewPane) previewPane.style.display = 'none';
      if (scratchpadPane) scratchpadPane.style.display = 'block';
      if (toolbarEl) toolbarEl.style.display = 'none';
      if (descEl) descEl.textContent = (typeof t === 'function' && t('refactor.scratchpadDesc')) || 'Internal agent research log, retrieved topic context, and structuring rationale.';
      if (applyBtn) applyBtn.style.display = 'none';
      this.renderIntegratedScratchpadView(proposal);
    } else {
      if (previewPane) previewPane.style.display = 'block';
      if (scratchpadPane) scratchpadPane.style.display = 'none';
      if (toolbarEl) toolbarEl.style.display = 'flex';
      if (applyBtn) applyBtn.style.display = '';

      let html = '';
      let descText = '';
      if (tabKey === 'A') {
        html = proposal.proposalA;
        descText = (typeof t === 'function' && t('refactor.proposalADesc')) || 'Action-oriented structure with clear headings, bold takeaways, and bulleted decisions.';
      } else if (tabKey === 'B') {
        html = proposal.proposalB;
        descText = (typeof t === 'function' && t('refactor.proposalBDesc')) || 'Comprehensive discussion flow preserving all context, nuance, and thematic details.';
      } else if (tabKey === 'C') {
        html = proposal.proposalC;
        descText = (typeof t === 'function' && t('refactor.proposalCDesc')) || 'Custom synthesized version incorporating your specific feedback and instructions.';
      } else if (tabKey === 'original') {
        html = proposal.originalHtml;
        descText = (typeof t === 'function' && t('refactor.originalDesc')) || 'Original raw note before AI refactoring.';
      }

      // Compute word count & read metrics
      const rawWords = (typeof htmlToPlainText === 'function' ? htmlToPlainText(proposal.originalHtml || '') : (proposal.originalHtml || '').replace(/<[^>]*>/g, ' ')).trim().split(/\s+/).filter(Boolean).length;
      const strippedProposal = (html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      const proposalWords = strippedProposal ? strippedProposal.split(' ').filter(Boolean).length : 0;
      const diffPercent = rawWords > 0 ? Math.round(((proposalWords - rawWords) / rawWords) * 100) : 0;
      const readMin = Math.max(1, Math.round(proposalWords / 200));

      const metricsHtml = `<span style="display:inline-flex; align-items:center; gap:6px; margin-left:8px; font-size:0.78rem; font-weight:600; opacity:0.85;"><span>📊 ${proposalWords} words (${diffPercent > 0 ? '+' : ''}${diffPercent}%)</span> • <span>⏱ ~${readMin} min read</span></span>`;
      if (descEl) descEl.innerHTML = `${escH(descText)} ${metricsHtml}`;

      const htmlContainer = document.getElementById('dr-integrated-proposal-html');
      if (htmlContainer) {
        const syncResolved = (typeof resolveNoteImagesSync === 'function') ? resolveNoteImagesSync(html) : html;
        htmlContainer.innerHTML = syncResolved;

        if (typeof resolveNoteImages === 'function' && html.includes('_assets/')) {
          resolveNoteImages(html).then(resolved => {
            if (htmlContainer && DailyReviewController.integratedActiveTab === tabKey) {
              htmlContainer.innerHTML = resolved;
              if (typeof setupUncertaintyHoverCards === 'function') {
                setupUncertaintyHoverCards(previewPane || htmlContainer);
              }
            }
          });
        }
      }

      // Attach uncertainty hover card popovers
      if (typeof setupUncertaintyHoverCards === 'function') {
        setupUncertaintyHoverCards(previewPane || htmlContainer);
      }

      this.renderIntegratedActionsReviewPanel(proposal, tabKey);
    }
  },

  renderIntegratedScratchpadView(proposal) {
    const container = document.getElementById('dr-integrated-scratchpad-content');
    if (!container || !proposal) return;

    let markup = '';
    if (proposal.scratchpad && typeof LLMService !== 'undefined' && typeof LLMService.renderThinkingAccordionHTML === 'function') {
      markup += LLMService.renderThinkingAccordionHTML(proposal.scratchpad, { isOpen: true, title: (typeof t === 'function' && t('chat.thinkingProcess')) || 'Thought Process' });
    }

    if (Array.isArray(proposal.scratchpadLog) && proposal.scratchpadLog.length > 0) {
      proposal.scratchpadLog.forEach(log => {
        if (!log) return;
        markup += `
          <div class="scratchpad-log-entry" style="margin-bottom:8px; padding:8px; border:1px solid var(--card-border); border-radius:6px; background:var(--card-bg);">
            <div style="font-weight:600; font-size:0.84rem; color:var(--accent);">Step ${log.step}: ${escH(log.title || '')}</div>
            <div style="color:var(--text); font-size:0.82rem; white-space:pre-wrap;">${escH(typeof log.content === 'string' ? log.content : JSON.stringify(log.content, null, 2))}</div>
          </div>
        `;
      });
    }

    container.innerHTML = markup || '<div style="color:var(--text-muted); font-size:0.85rem;">No scratchpad details.</div>';
  },

  renderIntegratedActionsReviewPanel(proposal, tabKey) {
    const container = document.getElementById('dr-integrated-actions-container');
    if (!container) return;

    if (tabKey === 'original') {
      container.style.display = 'none';
      container.innerHTML = '';
      return;
    }

    let actions = null;
    if (tabKey === 'A') actions = proposal.proposalActionsA;
    else if (tabKey === 'B') actions = proposal.proposalActionsB;
    else if (tabKey === 'C') actions = proposal.proposalActionsC;

    if (!actions) {
      const html = tabKey === 'A' ? proposal.proposalA : (tabKey === 'B' ? proposal.proposalB : proposal.proposalC);
      actions = extractProposedActionsFromProposal(html);
      if (tabKey === 'A') proposal.proposalActionsA = actions;
      else if (tabKey === 'B') proposal.proposalActionsB = actions;
      else if (tabKey === 'C') proposal.proposalActionsC = actions;
    }

    const { decisions = [], todos = [] } = actions || {};

    if (decisions.length === 0 && todos.length === 0) {
      container.style.display = 'none';
      container.innerHTML = '';
      return;
    }

    container.style.display = 'block';
    let markup = `
      <div class="refactor-actions-review-panel" contenteditable="false" style="background:var(--card-bg-alt); border:1px solid var(--card-border); border-radius:10px; padding:12px 14px;">
        <div style="font-weight:700; font-size:0.88rem; color:var(--accent); margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;" contenteditable="false">
          <span contenteditable="false">⚡ ${(typeof t === 'function' && t('refactor.proposedActionsHeader')) || 'Proposed Actions & Decisions'}</span>
        </div>
    `;

    if (decisions.length > 0) {
      markup += `
        <div style="margin-bottom:10px;" contenteditable="false">
          <div style="font-weight:700; font-size:0.8rem; color:var(--text); margin-bottom:6px;" contenteditable="false">🎯 ${(typeof t === 'function' && t('refactor.proposedDecisions')) || 'Decisions'} (${decisions.length})</div>
          <div style="display:flex; flex-direction:column; gap:6px;" contenteditable="false">
      `;
      decisions.forEach((dec, idx) => {
        markup += `
          <div style="display:flex; align-items:center; gap:8px; background:var(--card-bg); border:1px solid var(--card-border); border-radius:6px; padding:6px 10px;" contenteditable="false">
            <input type="checkbox" class="dr-int-check-dec" data-idx="${idx}" checked id="dr-int-dec-${tabKey}-${idx}" style="cursor:pointer;" />
            <span class="note-decision-badge" contenteditable="false" style="font-size:0.68rem;">🎯 Decision</span>
            <input type="text" class="dr-int-dec-input field-input" data-idx="${idx}" value="${escA(dec.text || '')}" style="flex:1; font-size:0.82rem; padding:2px 6px; border:1px solid var(--card-border); border-radius:4px; background:var(--card-bg-alt); color:var(--text);" />
          </div>
        `;
      });
      markup += `</div></div>`;
    }

    if (todos.length > 0) {
      markup += `
        <div style="margin-bottom:10px;" contenteditable="false">
          <div style="font-weight:700; font-size:0.8rem; color:var(--text); margin-bottom:6px;" contenteditable="false">📋 ${(typeof t === 'function' && t('refactor.proposedTodos')) || 'Todos & Tasks'} (${todos.length})</div>
          <div style="display:flex; flex-direction:column; gap:6px;" contenteditable="false">
      `;
      todos.forEach((todo, idx) => {
        markup += `
          <div style="display:flex; align-items:center; gap:8px; background:var(--card-bg); border:1px solid var(--card-border); border-radius:6px; padding:6px 10px;" contenteditable="false">
            <input type="checkbox" class="dr-int-check-todo" data-idx="${idx}" checked id="dr-int-todo-${tabKey}-${idx}" style="cursor:pointer;" />
            <input type="text" class="dr-int-todo-title field-input" data-idx="${idx}" value="${escA(todo.title || '')}" style="flex:1; font-size:0.82rem; padding:2px 6px; border:1px solid var(--card-border); border-radius:4px; background:var(--card-bg-alt); color:var(--text);" />
          </div>
        `;
      });
      markup += `</div></div>`;
    }

    markup += `</div>`;
    container.innerHTML = markup;
  },

  switchToRawEditor() {
    this.viewingIntegratedProposal = false;
    const rawEditorContainer = document.getElementById('dr-note-review-editor-container');
    const integratedContainer = document.getElementById('dr-integrated-proposal-container');

    if (integratedContainer) integratedContainer.style.display = 'none';
    if (rawEditorContainer) rawEditorContainer.style.display = 'flex';

    // If proposal ready, add toggle banner at the top of raw editor
    const proposal = this.noteProposals && this.noteProposals[this.activeNotePath];
    let toggleBanner = document.getElementById('dr-switch-to-proposal-banner');
    if (proposal && proposal.status === 'ready') {
      if (!toggleBanner && rawEditorContainer) {
        toggleBanner = document.createElement('div');
        toggleBanner.id = 'dr-switch-to-proposal-banner';
        toggleBanner.style.cssText = 'background:rgba(99,102,241,0.12); border-bottom:1px solid rgba(99,102,241,0.3); padding:8px 12px; display:flex; justify-content:space-between; align-items:center; gap:8px; font-size:0.84rem; font-weight:600;';
        rawEditorContainer.insertBefore(toggleBanner, rawEditorContainer.firstChild);
      }
      if (toggleBanner) {
        toggleBanner.style.display = 'flex';
        toggleBanner.innerHTML = `
          <span style="color:var(--accent);">✨ ${(typeof t === 'function' && t('dailyreview.statusReady')) || 'Perfect Note proposal ready'}</span>
          <button type="button" class="btn btn-primary" style="font-size:0.75rem; padding:3px 10px;" onclick="DailyReviewController.renderIntegratedProposalView(DailyReviewController.activeNotePath)" data-i18n-title="dailyreview.viewProposalTooltip" title="${escA((typeof t === 'function' && t('dailyreview.viewProposalTooltip')) || 'Switch to Perfect Note proposal')}">
            ${(typeof t === 'function' && t('dailyreview.viewProposalBtn')) || 'View Perfect Note Proposal'}
          </button>
        `;
      }
    } else if (toggleBanner) {
      toggleBanner.style.display = 'none';
    }
  },

  async applyIntegratedProposal() {
    const notePath = this.activeNotePath;
    const proposal = this.noteProposals && this.noteProposals[notePath];
    if (!proposal) return;

    let chosenHtml = '';
    const currentContainer = document.getElementById('dr-integrated-proposal-html');
    if (currentContainer && currentContainer.innerHTML) {
      chosenHtml = currentContainer.innerHTML;
    } else {
      chosenHtml = (proposal.activeTab === 'B' ? proposal.proposalB : (proposal.activeTab === 'C' ? proposal.proposalC : (proposal.activeTab === 'original' ? proposal.originalHtml : proposal.proposalA))) || '';
    }

    // Auto-save snapshot
    if (notePath && typeof StorageAPI !== 'undefined' && typeof StorageAPI.saveSnapshot === 'function') {
      try {
        const pre = proposal.originalHtmlSnapshot || '';
        if (pre) await StorageAPI.saveSnapshot(notePath, pre, 'pre-ai-refactor');
      } catch (_e) {}
    }

    // Apply workstream & tags if accepted
    if (typeof RefactorModalController !== 'undefined' && typeof RefactorModalController.commitWorkstreamAndTagChanges === 'function') {
      const activeNoteObj = (typeof currentNote !== 'undefined' && currentNote && currentNote.path === notePath)
        ? currentNote
        : (typeof manifest !== 'undefined' && Array.isArray(manifest) ? manifest.find(n => n.path === notePath) : null);
      await RefactorModalController.commitWorkstreamAndTagChanges(activeNoteObj, proposal);
    }

    // Unroll any lingering uncertainty spans before saving so note stays clean
    chosenHtml = chosenHtml.replace(/<span class="inline-uncertain-text"[^>]*>(.*?)<\/span>/gi, '$1');

    const chosenSummary = (proposal.activeTab === 'A' ? proposal.meetingSummaryA : proposal.activeTab === 'B' ? proposal.meetingSummaryB : proposal.activeTab === 'C' ? proposal.meetingSummaryC : proposal.meetingSummary) || proposal.meetingSummary;

    // Update active in-memory currentNote if open
    const editor = document.getElementById('edit-textarea');
    if (typeof currentNote !== 'undefined' && currentNote && currentNote.path === notePath) {
      currentNote.mainHTML = chosenHtml;
      if (chosenSummary) {
        currentNote.summary = chosenSummary;
        if (typeof writeSummaryMetadataHTML === 'function') writeSummaryMetadataHTML(chosenSummary);
        this.updateNoteSummaryBadge(notePath, chosenSummary);
      }
      if (editor) {
        editor.innerHTML = chosenHtml;
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (typeof autoSaveNote === 'function') autoSaveNote({ silent: false });
      else if (typeof saveCurrentNote === 'function') saveCurrentNote();
      if (typeof syncPreview === 'function') syncPreview();
    } else if (typeof StorageAPI !== 'undefined' && typeof StorageAPI.writeNoteContent === 'function') {
      try {
        const rawContent = await StorageAPI.readNoteContent(notePath);
        const parsed = (typeof parseNoteHTML === 'function') ? parseNoteHTML(rawContent) : null;
        const changes = {
          title: parsed?.title ?? '',
          date: parsed?.date ?? '',
          group_tags: parsed?.group_tags ?? [],
          major_topic_tags: parsed?.major_topic_tags ?? [],
          topic_tags: parsed?.topic_tags ?? [],
          extra_tags: parsed?.extra_tags ?? [],
          mainHTML: chosenHtml,
          summary: chosenSummary || parsed?.summary || '',
          reviewed: true
        };
        const updatedHTML = (typeof applyNoteEdits === 'function') ? applyNoteEdits(rawContent, changes) : chosenHtml;
        await StorageAPI.writeNoteContent(notePath, updatedHTML);
      } catch (e) {
        await StorageAPI.writeNoteContent(notePath, chosenHtml);
      }
    }

    // Mark note as reviewed
    await this.toggleNoteReviewed(notePath, true);

    // Remove the proposal entry and update badges so "Ready" tag is removed
    if (this.noteProposals) {
      delete this.noteProposals[notePath];
    }
    this.renderStep3ListBadges();

    toast(`🎉 ${(typeof t === 'function' ? t('refactor.successToast') : null) || 'Note successfully refactored!'}`);

    // Advance to next note
    this.advanceToNextNote();
  },

  async keepOriginalNote() {
    const notePath = this.activeNotePath;
    // Remove the proposal entry and update badges so "Ready" tag is removed
    if (this.noteProposals && notePath) {
      delete this.noteProposals[notePath];
    }
    this.renderStep3ListBadges();

    if (notePath) {
      await this.toggleNoteReviewed(notePath, true);
    }
    toast((typeof t === 'function' && t('refactor.keptOriginal')) || 'Kept original note.');
    this.advanceToNextNote();
  },

  async advanceToNextNote() {
    if (!Array.isArray(this.todayNotes) || this.todayNotes.length === 0) return;
    const currentIndex = this.todayNotes.findIndex(n => n.path === this.activeNotePath);
    let nextNote = null;

    // Search forward from currentIndex + 1
    for (let i = currentIndex + 1; i < this.todayNotes.length; i++) {
      const n = this.todayNotes[i];
      const found = (typeof manifest !== 'undefined' ? manifest : []).find(m => m.path === n.path);
      if (!found || !found.reviewed) {
        nextNote = n;
        break;
      }
    }

    // If not found forward, search from start
    if (!nextNote && currentIndex > 0) {
      for (let i = 0; i < currentIndex; i++) {
        const n = this.todayNotes[i];
        const found = (typeof manifest !== 'undefined' ? manifest : []).find(m => m.path === n.path);
        if (!found || !found.reviewed) {
          nextNote = n;
          break;
        }
      }
    }

    if (nextNote) {
      await this.selectNoteForReview(nextNote.path);
    } else {
      // All notes reviewed: switch to raw editor view and update reviewed button
      this.switchToRawEditor();
      this.updateMarkReviewedButtonState();
    }
  },

  toggleIntegratedFeedbackDrawer(show) {
    const drawer = document.getElementById('dr-integrated-feedback-drawer');
    if (!drawer) return;
    if (show === undefined) {
      drawer.style.display = drawer.style.display !== 'none' ? 'none' : 'flex';
    } else {
      drawer.style.display = show ? 'flex' : 'none';
    }
  },

  async generateIntegratedOptionC() {
    const input = document.getElementById('dr-integrated-feedback-input');
    const feedback = (input?.value || '').trim();
    if (!feedback) {
      toast((typeof t === 'function' && t('refactor.enterFeedbackPrompt')) || 'Please enter instructions for Option C.', true);
      return;
    }

    const proposal = this.noteProposals && this.noteProposals[this.activeNotePath];
    if (!proposal) return;

    const btn = document.getElementById('btn-dr-integrated-gen-c');
    if (btn) {
      btn.disabled = true;
      btn.textContent = (typeof t === 'function' && t('refactor.generatingOptionC')) || 'Generating Option C...';
    }

    try {
      const currentUserName = (typeof settings !== 'undefined' && settings && settings.username) ? settings.username : (typeof getDefaultMeLabel === 'function' ? getDefaultMeLabel() : 'Me');
      const baseHtml = proposal.proposalA || proposal.originalHtml || '';
      const result = await LLMService.refineAmendedProposal(
        proposal.note,
        proposal.originalHtml,
        baseHtml,
        feedback
      );

      proposal.proposalC = cleanProposalHtml(result.proposalC);
      proposal.meetingSummaryC = cleanMeetingSummaryHtml(result.meetingSummary || proposal.meetingSummary, currentUserName);
      proposal.proposalActionsC = extractProposedActionsFromProposal(proposal.proposalC, { proposed_decisions: result.proposedDecisions, proposed_todos: result.proposedTodos, proposed_colleague_links: result.proposedColleagues, proposed_note_links: result.proposedNotes });

      const tabC = document.getElementById('dr-tab-proposal-c');
      if (tabC) tabC.style.display = 'inline-flex';

      this.toggleIntegratedFeedbackDrawer(false);
      this.switchIntegratedTab('C');
      toast((typeof t === 'function' && t('refactor.reperfectReady')) || 'Option C generated!');
    } catch (err) {
      console.error('Failed generating Option C in integrated review', err);
      toast(`Error: ${err.message}`, true);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = (typeof t === 'function' && t('refactor.generateOptionC')) || 'Generate Option C';
      }
    }
  },

  copyIntegratedProposal() {
    const htmlContainer = document.getElementById('dr-integrated-proposal-html');
    const html = htmlContainer ? htmlContainer.innerHTML : '';
    if (!html) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(html).then(() => {
        toast((typeof t === 'function' && t('common.copied')) || 'Proposal copied to clipboard!');
      });
    }
  },

  /**
   * Render Step 4: Final commit screen
   */
  renderStep4() {
    // Nothing special to render dynamically for step 4, button action handles final commit.
  },

  /**
   * Final commit button click
   */
  async commitFinal() {
    markDailyReviewDateReviewed(this.getReviewDateValue());
    // Auto-update Workstream Memories for all notes reviewed on this day
    try {
      const dayNotes = (typeof manifest !== 'undefined' ? manifest : []).filter(n => n && n.date === this.getReviewDateValue());
      for (const n of dayNotes) {
        const noteWsList = (typeof getNoteWorkstreams === 'function') ? getNoteWorkstreams(n) : (n.workstream ? [n.workstream] : []);
        for (const ws of noteWsList) {
          if (typeof saveMajorTopicMemory === 'function' && ws) {
            await saveMajorTopicMemory(ws, {
              status: 'active',
              lastNoteId: n.id || '',
              lastNoteTitle: n.title || ''
            });
          }
        }
      }
    } catch (_e) {}
    if (this.reviewSessionStartTime) {
      try {
        const durationMs = Date.now() - this.reviewSessionStartTime;
        const durationMinutes = durationMs / (60 * 1000);
        const dayNotes = (typeof manifest !== 'undefined' ? manifest : []).filter(n => n && n.date === this.getReviewDateValue());
        if (typeof window.DailyReviewTimeTracker !== 'undefined' && typeof window.DailyReviewTimeTracker.recordSession === 'function') {
          window.DailyReviewTimeTracker.recordSession(this.getReviewDateValue(), durationMinutes, dayNotes.length);
        }
      } catch (_eTrack) {
        console.warn('Failed to record Daily Review duration', _eTrack);
      }
    }
    toast(t('dailyreview.dayClosedToast'));
    await this.close();
  },

  /**
   * Translate all dynamic daily review fields using the i18n t() system
   */
  localizeUI() {
    const elementsToLocalize = [
      { id: 'dr-start-title', key: 'dailyreview.startTitle' },
      { id: 'dr-start-desc', key: 'dailyreview.startDesc' },
      { id: 'dr-start-date-label', key: 'dailyreview.startDateLabel' },
      { id: 'btn-dr-start', key: 'dailyreview.startBtn' },
      { id: 'btn-dr-start-review', key: 'dailyreview.startBtn' },
      { selector: 'button[onclick="confirmQuitDailyReview()"]', key: 'dailyreview.quitBtn' },
      { id: 'dr-step-1-desc', key: 'dailyreview.step1Desc' },
      { id: 'dr-step-2-desc', key: 'dailyreview.step2Desc' },
      { id: 'dr-step-3-desc', key: 'dailyreview.step3Desc' },
      { id: 'btn-dr-prev', key: 'dailyreview.prevBtn' },
      { id: 'btn-dr-ai-regenerate', key: 'dailyreview.regenerateBtn' },
      { id: 'dr-ai-loading-text', key: 'dailyreview.aiLoadingText' },
      { id: 'dr-ai-loading-title', key: 'dailyreview.aiLoadingText' },
      { id: 'dr-ai-meeting-summaries-label', key: 'dailyreview.meetingSummariesLabel' },
      { id: 'dr-ai-suggestions-title', key: 'dailyreview.aiSuggestionsTitle' },
      { id: 'dr-ai-suggestions-desc', key: 'dailyreview.aiSuggestionsDesc' }
    ];

    elementsToLocalize.forEach(item => {
      let el = null;
      if (item.id) {
        el = document.getElementById(item.id);
      } else if (item.selector) {
        el = document.querySelector(item.selector);
      }

      if (el) {
        let txt = t(item.key);
        el.textContent = txt;
      }
    });

    const deleteBtn = document.getElementById('btn-dr-delete-note');
    if (deleteBtn) {
      deleteBtn.title = t('editor.deleteNoteTooltip') || deleteBtn.title;
    }

    const guideBtn = document.getElementById('btn-dr-guide');
    if (guideBtn) {
      guideBtn.title = t('tutorial.dailyReviewGuide.guideBtnTooltip') || 'Launch interactive Daily Review guide';
      const guideText = document.getElementById('btn-dr-guide-text') || guideBtn.querySelector('span');
      if (guideText) {
        guideText.textContent = t('tutorial.dailyReviewGuide.guideBtn') || 'Guide';
      }
    }

    const quitBtn = document.querySelector('button[onclick="confirmQuitDailyReview()"]');
    if (quitBtn) quitBtn.title = t('dailyreview.quitTooltip') || t('dailyreview.quitTitle');

    const dateInput = document.getElementById('dr-target-date') || document.getElementById('dr-review-date');
    if (dateInput) {
      dateInput.title = t('dailyreview.reviewDateTitle') || 'Choose the date to review';
      dateInput.setAttribute('aria-label', t('dailyreview.reviewDateAria') || 'Choose the date to review');
    }

    const startBtn = document.getElementById('btn-dr-start') || document.getElementById('btn-dr-start-review');
    if (startBtn) {
      startBtn.title = t('dailyreview.startBtnTooltip') || 'Démarrer la Daily Review pour la date sélectionnée';
    }

    const titleInput = document.getElementById('dr-ai-summary-title');
    if (titleInput) {
      titleInput.placeholder = t('dailyreview.noteTitlePlaceholder') || 'Titre de la note...';
    }
    const contentTextarea = document.getElementById('dr-ai-summary-content');
    if (contentTextarea) {
      const placeholderText = t('dailyreview.markdownContentPlaceholder') || 'Contenu du résumé...';
      contentTextarea.setAttribute('data-placeholder', placeholderText);
    }

    const popoverLabel = document.getElementById('dr-ai-regenerate-label');
    if (popoverLabel) {
      popoverLabel.textContent = t('dailyreview.regeneratePopoverLabel') || 'Ajouter des instructions de style / contexte :';
    }

    const popoverTextarea = document.getElementById('dr-ai-regenerate-context');
    if (popoverTextarea) {
      popoverTextarea.placeholder = t('dailyreview.regeneratePopoverPlaceholder') || 'Ex : Rendre plus formel, insister sur le budget...';
    }

    const isAIEnabled = typeof LLMService !== 'undefined' && LLMService.isEnabled();
    const titleEl = document.getElementById('dr-step5-title') || document.getElementById('dr-ai-title');
    if (titleEl) {
      titleEl.textContent = isAIEnabled ? (t('dailyreview.stepAITitle') || "Synthèse Quotidienne par l'IA") : (t('dailyreview.stepManualSummaryTitle') || "Résumé quotidien");
    }
    const descEl = document.getElementById('dr-step5-desc');
    if (descEl) {
      descEl.textContent = isAIEnabled ? (t('dailyreview.stepAIDesc') || "L'IA a agrégé les notes de toutes vos réunions du jour dans une note journalière structurée.") : (t('dailyreview.stepManualSummaryDesc') || "Rédigez un résumé de votre journée. Les résumés de réunions sont affichés dans l'onglet dédié.");
    }

    const cancelBtn = document.getElementById('btn-dr-ai-cancel');
    if (cancelBtn) {
      cancelBtn.title = t('dailyreview.cancelAISummaryTooltip') || 'Annuler la génération du résumé quotidien';
      const cancelSpan = cancelBtn.querySelector('span');
      if (cancelSpan) {
        cancelSpan.textContent = t('dailyreview.cancelAISummaryBtn') || 'Annuler';
      } else {
        cancelBtn.textContent = t('dailyreview.cancelAISummaryBtn') || 'Annuler';
      }
    }

    const tabNoteBtn = document.getElementById('dr-tab-summary-note');
    if (tabNoteBtn) {
      tabNoteBtn.title = t('dailyreview.summaryNoteTooltip') || 'Éditer le résumé quotidien';
      const label = document.getElementById('dr-tab-summary-note-label') || tabNoteBtn.querySelector('span');
      if (label) label.textContent = t('dailyreview.summaryNoteTab') || 'Résumé quotidien';
    }

    const tabListBtn = document.getElementById('dr-tab-summaries-list');
    if (tabListBtn) {
      tabListBtn.title = t('dailyreview.summariesListTooltip') || 'Afficher la liste des synthèses de notes';
      const label = document.getElementById('dr-tab-summaries-list-label');
      if (label) label.textContent = t('dailyreview.summariesListTab') || 'Résumés des notes';
    }

    const tabWsBtn = document.getElementById('dr-tab-workstream-updates');
    if (tabWsBtn) {
      tabWsBtn.title = t('dailyreview.workstreamUpdatesTabTooltip') || 'Mises à jour des Workstreams extraites des notes';
      const label = document.getElementById('dr-tab-workstream-updates-label');
      if (label) label.textContent = t('dailyreview.workstreamUpdatesTab') || 'Workstreams';
    }

    this.syncReviewDateUI();
  },

  async generateNoteSummaries(signal) {
    const isAIEnabled = typeof LLMService !== 'undefined' && LLMService.isEnabled();
    if (!isAIEnabled) return;

    if (!this.todayNotes || this.todayNotes.length === 0) {
      this.todayNotes = this.collectTodayNotes();
    }

    // First, sync any existing summaries from the HTML files into todayNotes.
    for (const n of this.todayNotes) {
      if (signal && signal.aborted) return;
      const summaryPlaintext = (n.summary || '').replace(/<[^>]*>/g, '').trim();
      const summaryIsEmpty = !summaryPlaintext || n.summary === '<p></p>' || n.summary === '<p><br></p>';
      if (summaryIsEmpty) {
        try {
          const html = await StorageAPI.readNoteContent(n.path);
          const parsed = (typeof parseNoteHTML === 'function') ? parseNoteHTML(html) : null;
          if (parsed && parsed.summary) {
            const parsedPlain = parsed.summary.replace(/<[^>]*>/g, '').trim();
            if (parsedPlain) {
              n.summary = parsed.summary;
              const mfIdx = (typeof manifest !== 'undefined' ? manifest : []).findIndex(item => item.path === n.path);
              if (mfIdx !== -1) manifest[mfIdx].summary = parsed.summary;
            }
          }
        } catch (e) {
          console.warn('Failed to pre-check summary for note', n.path, e);
        }
      }
    }

    const notesToSummarize = this.todayNotes.filter(n => !n.summary || n.summary.trim() === '' || n.summary === '<p></p>' || n.summary === '<p><br></p>');

    if (notesToSummarize.length > 0) {
      const container = document.getElementById('dr-step3-progress-container');
      const bar = document.getElementById('dr-step3-progress-bar');
      const status = document.getElementById('dr-step3-progress-status');
      const mainContent = document.getElementById('dr-step3-main-content');
      const details = document.getElementById('dr-ai-loading-details');

      if (container && bar && status) {
        container.style.display = 'flex';
        if (mainContent) mainContent.style.opacity = '0.3';
      }

      if (typeof AIChatController !== 'undefined' && typeof AIChatController.generateNoteSummaries === 'function') {
        await AIChatController.generateNoteSummaries(notesToSummarize, (n, completed, total) => {
          const progressMsg = (typeof t === 'function' ? t('dailyreview.generatingForNote', { title: n.title, current: completed + 1, total: total }) : '')
            || `Génération pour "${n.title}" (${completed + 1} / ${total})...`;
          if (details) details.textContent = progressMsg;
          if (status) status.textContent = progressMsg;
          if (bar) bar.style.width = `${((completed / total) * 100).toFixed(1)}%`;
        }, signal);
      }

      if (container) {
        container.style.display = 'none';
        if (mainContent) mainContent.style.opacity = '1';
      }
    }

    // Only after AI summarization, fall back to mainHTML excerpt for any remaining notes that still have no summary
    for (const n of this.todayNotes) {
      if (!n.summary || !n.summary.replace(/<[^>]*>/g, '').trim()) {
        try {
          const html = await StorageAPI.readNoteContent(n.path);
          const parsed = (typeof parseNoteHTML === 'function') ? parseNoteHTML(html) : null;
          if (parsed && parsed.mainHTML) {
            const plain = parsed.mainHTML.replace(/<[^>]*>/g, '').trim();
            if (plain) {
              n.summary = `<p>${plain.slice(0, 500)}</p>`;
            }
          }
        } catch (_err) {}
      }
    }
  },

  async renderAISummaryStep() {
    const isAIEnabled = typeof LLMService !== 'undefined' && LLMService.isEnabled();

    // Ensure today's notes are resolved
    const reviewDateStr = this.getReviewDateValue();
    if (!this.todayNotes || this.todayNotes.length === 0) {
      this.todayNotes = this.collectTodayNotes(reviewDateStr);
    }

    // Set headers
    const titleEl = document.getElementById('dr-step5-title') || document.getElementById('dr-ai-title');
    if (titleEl) {
      titleEl.textContent = isAIEnabled ? (t('dailyreview.stepAITitle') || "Synthèse Quotidienne par l'IA") : (t('dailyreview.stepManualSummaryTitle') || "Résumé quotidien");
    }
    const descEl = document.getElementById('dr-step5-desc');
    if (descEl) {
      descEl.textContent = isAIEnabled ? (t('dailyreview.stepAIDesc') || "L'IA a agrégé les notes de toutes vos réunions du jour dans une note journalière structurée.") : (t('dailyreview.stepManualSummaryDesc') || "Rédigez un résumé de votre journée. Les résumés de réunions sont affichés dans l'onglet dédié.");
    }

    const regenerateBtn = document.getElementById('btn-dr-ai-regenerate');
    if (regenerateBtn) {
      regenerateBtn.style.display = isAIEnabled ? '' : 'none';
    }

    const suggestionsPanel = document.getElementById('dr-ai-suggestions-panel');
    if (suggestionsPanel) {
      suggestionsPanel.style.display = isAIEnabled ? 'flex' : 'none';
    }

    // Check if we have an existing daily summary note
    const summaryPath = `notes/daily-summary-${reviewDateStr}.html`;
    let existingNote = (typeof manifest !== 'undefined' ? manifest : []).find(n => n.path === summaryPath || n.id === `summary-${reviewDateStr}`);

    const titleInput = document.getElementById('dr-ai-summary-title');
    const contentTextarea = document.getElementById('dr-ai-summary-content');
    const loading = document.getElementById('dr-ai-loading');
    const editor = document.getElementById('dr-ai-editor');

    // If AI is enabled and we do not have an existing daily summary compiled, run the compiler flow here
    // Also skip if generation just completed (summaryJustGenerated flag) to avoid re-entry from loadStep(5)
    if (isAIEnabled && !existingNote && !this.isGeneratingSummaries && !this.summaryJustGenerated) {
      this.isGeneratingSummaries = true;

      // Mount Step 5 Note Editor immediately so currentNote is switched to the daily summary note
      await this.mountStep5NoteEditor();

      const prevBtn = document.getElementById('btn-dr-prev');
      const nextBtn = document.getElementById('btn-dr-next');
      if (prevBtn) prevBtn.disabled = true;
      if (nextBtn) nextBtn.disabled = true;

      if (loading) {
        loading.style.display = 'flex';
        const progressBar = document.getElementById('dr-ai-loading-progress-bar') || document.getElementById('dr-ai-progress-bar');
        if (progressBar) progressBar.style.width = '0%';
        const details = document.getElementById('dr-ai-loading-details');
        if (details) details.textContent = '';
      }
      const regenWrap = document.getElementById('dr-ai-regenerate-wrap');
      if (regenWrap) regenWrap.style.display = 'none';
      if (editor) editor.style.display = 'none';
      if (suggestionsPanel) suggestionsPanel.style.display = 'none';

      const progressText = document.getElementById('dr-ai-loading-title') || document.getElementById('dr-ai-loading-text');

      const proceed = async () => {
        try {
          this.aiAbortController = new AbortController();
          const signal = this.aiAbortController.signal;

          if (progressText) progressText.textContent = t('dailyreview.aiGeneratingNoteSummaries') || "Génération des résumés des réunions...";
          const progressBar = document.getElementById('dr-ai-loading-progress-bar') || document.getElementById('dr-ai-progress-bar');
          if (progressBar) progressBar.style.width = '20%';

          await this.generateNoteSummaries(signal);

          if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

          if (progressBar) progressBar.style.width = '60%';
          if (progressText) progressText.textContent = t('dailyreview.aiGeneratingDailySummary') || "Génération du résumé de la journée par l'IA...";
          const details = document.getElementById('dr-ai-loading-details');
          if (details) {
            details.textContent = t('dailyreview.aiAnalyzingAndPrioritizing') 
              || "Synthèse des activités, priorisation des demandes des managers et structuration des recommandations...";
          }

          await this.generateAISummary({ force: true, signal: signal });

          if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

          if (progressBar) progressBar.style.width = '100%';
          this.isGeneratingSummaries = false;
          this.summaryJustGenerated = true; // prevent double-generation if renderAISummaryStep is re-entered

          // Reveal the editor directly — generateAISummary already wrote all content to the DOM.
          // Calling loadStep(5) here would wipe the editor content before existingNote is in manifest.

          // Set title before saving (autosaveAISummaryNote guards on empty title)
          const titleInputEl = document.getElementById('dr-ai-summary-title');
          if (titleInputEl && !titleInputEl.value.trim()) {
            titleInputEl.value = this.getDefaultDailySummaryTitle();
            titleInputEl.oninput = () => this.scheduleAutosaveAISummaryNote();
          }

          if (loading) loading.style.display = 'none';
          if (editor) {
            editor.style.display = 'flex';
            editor.style.opacity = '1';
          }
          const suggestionsPanel2 = document.getElementById('dr-ai-suggestions-panel');
          if (suggestionsPanel2) suggestionsPanel2.style.display = 'flex';
          const regenWrap2 = document.getElementById('dr-ai-regenerate-wrap');
          if (regenWrap2) regenWrap2.style.display = 'block';

          // Mount Note Editor in Step 5 and refresh meeting summaries list
          await this.mountStep5NoteEditor();
          await this.refreshStep5SummariesList();
          this.updateStep5SyncBanner();
        } catch (e) {
          this.isGeneratingSummaries = false;
          if (e.name === 'AbortError') {
            console.log("Daily Review Step 5 AI compilation cancelled by user.");
            toast(t('dailyreview.compilationCancelled') || "Génération annulée.");
          } else {
            console.error("Error during Daily Review Step 5 AI compilation:", e);
            toast("Erreur lors de la génération du résumé: " + e.message, true);
          }
          if (loading) loading.style.display = 'none';
          if (editor) {
            editor.style.display = 'flex';
            editor.style.opacity = '1';
          }
          await this.mountStep5NoteEditor();
          await this.refreshStep5SummariesList();
        } finally {
          this.aiAbortController = null;
          if (prevBtn) prevBtn.disabled = false;
          if (nextBtn) nextBtn.disabled = false;
        }
      };

      setTimeout(proceed, 50);
      return;
    }

    // Default view setup when compilation is finished/disabled
    if (loading) loading.style.display = 'none';
    const regenWrap = document.getElementById('dr-ai-regenerate-wrap');
    // Show regenerate only when AI is enabled AND there's an existing summary or it was just generated
    if (regenWrap) regenWrap.style.display = (isAIEnabled && (existingNote || this.summaryJustGenerated)) ? 'block' : 'none';
    if (editor) {
      editor.style.display = 'flex';
      editor.style.opacity = '1';
    }
    if (suggestionsPanel) {
      suggestionsPanel.style.display = isAIEnabled ? 'flex' : 'none';
    }
    const tabWsBtn = document.getElementById('dr-tab-workstream-updates');
    if (tabWsBtn) {
      tabWsBtn.style.display = isAIEnabled ? '' : 'none';
      if (!isAIEnabled && tabWsBtn.classList.contains('active')) {
        this.switchStep5Tab('note');
      }
    }
    const leftPanel = document.getElementById('dr-ai-left-panel');
    if (leftPanel) {
      leftPanel.style.flex = isAIEnabled ? '1.8' : '1 1 100%';
    }

    // Mount Note Editor in Step 5 and refresh meeting summaries list
    await this.mountStep5NoteEditor();
    await this.refreshStep5SummariesList();
    this.updateStep5SyncBanner();
    
    if (isAIEnabled) {
      // If AI is enabled, auto-generate if content is currently empty,
      // but skip if generation was just completed by proceed() to avoid a double-call.
      const justGenerated = this.summaryJustGenerated;
      this.summaryJustGenerated = false; // consume the flag
      if (!justGenerated && (!contentTextarea || !contentTextarea.textContent.trim())) {
        await this.generateAISummary({ force: true });
      } else {
        // Render prompt to regenerate suggestions
        const sugList = document.getElementById('dr-ai-suggestions-list');
        if (sugList && (!this.currentSuggestions || this.currentSuggestions.length === 0)) {
          sugList.innerHTML = `<div style="font-size:0.82rem; color:var(--text-muted); text-align:center; padding:1rem;">Cliquez sur Régénérer pour rafraîchir les suggestions d'actions.</div>`;
        }
      }
    }
  },

  async generateAISummary(options = {}) {
    const isAIEnabled = typeof LLMService !== 'undefined' && LLMService.isEnabled();
    if (!isAIEnabled) return;
    
    const loading = document.getElementById('dr-ai-loading');
    const editor = document.getElementById('dr-ai-editor');
    const contentTextarea = document.getElementById('dr-ai-summary-content');
    const sugList = document.getElementById('dr-ai-suggestions-list');
    
    if (loading) loading.style.display = 'flex';
    if (editor) editor.style.opacity = '0.3';
    
    try {
      const suggestWorkstreams = options.suggestWorkstreams !== undefined
        ? !!options.suggestWorkstreams
        : (window.settings?.ai?.suggestWorkstreams !== false);

      const headerToggle = document.getElementById('dr-toggle-suggest-ws');
      if (headerToggle) headerToggle.checked = suggestWorkstreams;
      const popoverToggle = document.getElementById('dr-ai-regen-suggest-workstreams');
      if (popoverToggle) popoverToggle.checked = suggestWorkstreams;

      const reviewDateStr = this.getReviewDateValue();
      const reviewDateDisplay = this.getReviewDateDisplay();

      if (!this.todayNotes || this.todayNotes.length === 0) {
        this.todayNotes = this.collectTodayNotes(reviewDateStr);
      }
      
      // Get managers list for boss priority logic
      const managerChainIds = (typeof getColleagueManagerChain === 'function') ? getColleagueManagerChain('me') : [];
      const managersList = managerChainIds.map(id => (typeof getColleagueLabelById === 'function' ? getColleagueLabelById(id, id) : id)).join(', ');
      
      // Resolve output language: honour the AI language setting if explicitly set,
      // otherwise fall back to the app UI language.
      const aiLangSetting = (typeof settings !== 'undefined' && settings?.ai?.language && settings.ai.language !== 'auto')
        ? settings.ai.language
        : null;
      const activeLang = aiLangSetting
        ? (typeof normalizeLanguageCode === 'function' ? normalizeLanguageCode(aiLangSetting) : aiLangSetting)
        : ((typeof getAppLanguage === 'function') ? getAppLanguage() : 'fr');

      let existingSummaryText = '';
      if (options.context && contentTextarea) {
        existingSummaryText = (typeof turndownService !== 'undefined')
          ? turndownService.turndown(contentTextarea.innerHTML).trim()
          : contentTextarea.textContent.trim();
      }

      let workstreamCatalogContext = '';
      try {
        let knownWsNames = [];
        if (typeof WorkstreamMemoryEngine !== 'undefined' && typeof WorkstreamMemoryEngine.getTopicMemoriesCatalog === 'function') {
          const catalog = await WorkstreamMemoryEngine.getTopicMemoriesCatalog({ includeArchived: false });
          knownWsNames = (catalog || []).map(t => t.topicName || t.key).filter(Boolean);
        }
        if (!knownWsNames.length && typeof getKnownWorkstreamsList === 'function') {
          knownWsNames = getKnownWorkstreamsList(typeof manifest !== 'undefined' ? manifest : []);
        }

        const wsScopeDetails = [];
        for (const wsName of knownWsNames) {
          let mem = null;
          if (typeof WorkstreamMemoryEngine !== 'undefined' && typeof WorkstreamMemoryEngine.getMajorTopicMemory === 'function') {
            mem = await WorkstreamMemoryEngine.getMajorTopicMemory(wsName, { skipAutoArchive: true });
          }
          const oneSentence = mem?.oneSentenceSummary || '';
          const summaryHTML = mem?.summary || '';
          const cleanSummary = summaryHTML ? summaryHTML.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : '';
          wsScopeDetails.push(`- Workstream "${wsName}": Objective/Scope: ${oneSentence || cleanSummary || 'Active workstream'}`);
        }

        if (wsScopeDetails.length > 0) {
          workstreamCatalogContext = `Known Active Workstreams & Scopes:\n${wsScopeDetails.join('\n')}\n`;
        }
      } catch (wsErr) {
        console.warn('Failed to build workstream scope context', wsErr);
      }

      // Fetch open/active todos from manifest to avoid duplicates, allow task edits, priority boosting & dependencies
      let existingTodosContext = '';
      try {
        const openTodos = (typeof todosManifest !== 'undefined' && Array.isArray(todosManifest))
          ? todosManifest.filter(t => t && t.priority !== 'Done')
          : [];
        if (openTodos.length > 0) {
          const todosListStr = openTodos.map(t => {
            const p = t.priority || 'Medium';
            const q = t.eisenhowerQuadrant || '';
            const ws = t.workstream || '';
            const owner = t.owner || 'me';
            const deps = Array.isArray(t.depends_on) && t.depends_on.length > 0 ? t.depends_on.join(', ') : 'none';
            return `- [ID: ${t.id}] "${t.title}" (Priority: ${p}${q ? `, Quadrant: ${q}` : ''}${ws ? `, Workstream: "${ws}"` : ''}, Owner: @${owner}, Dependencies: [${deps}])`;
          }).join('\n');
          existingTodosContext = `Existing Active Tasks / Todos in Board:\n${todosListStr}\n`;
        }
      } catch (tdErr) {
        console.warn('Failed to build existing todos context', tdErr);
      }

      // Fetch recent previous daily summaries (up to 3 previous summaries) for tracking project progress and pending items
      let prevSummariesContext = '';
      try {
        const allNotesList = (typeof manifest !== 'undefined' && Array.isArray(manifest)) ? manifest : [];
        const prevSummaryNotes = allNotesList
          .filter(n => {
            if (!n || !n.date || n.date >= reviewDateStr) return false;
            const isDailySummary = (n.major_topic_tags || []).includes("Daily Summary") ||
                                   (n.group_tags || []).includes("Summary") ||
                                   /^notes\/daily-summary-\d{4}-\d{2}-\d{2}\.html$/.test(n.path || '') ||
                                   (typeof n.id === 'string' && n.id.startsWith('summary-'));
            return isDailySummary;
          })
          .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
          .slice(0, 3);

        if (prevSummaryNotes.length > 0) {
          const summariesSnippets = [];
          for (const sn of prevSummaryNotes) {
            let summaryText = '';
            if (sn.path && typeof StorageAPI !== 'undefined' && typeof StorageAPI.readNoteContent === 'function') {
              try {
                const rawHtml = await StorageAPI.readNoteContent(sn.path);
                if (rawHtml) {
                  if (typeof parseNoteHTML === 'function') {
                    const parsed = parseNoteHTML(rawHtml);
                    summaryText = (typeof turndownService !== 'undefined')
                      ? turndownService.turndown(parsed.mainHTML || '').trim()
                      : (parsed.mainHTML || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
                  } else {
                    summaryText = rawHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
                  }
                }
              } catch (e) {
                console.warn('Could not read previous summary note content', sn.path, e);
              }
            }
            if (!summaryText) {
              summaryText = (sn.summary || sn.preview || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
            }
            if (summaryText) {
              const truncated = summaryText.length > 1500 ? summaryText.slice(0, 1500) + '...' : summaryText;
              summariesSnippets.push(`[${sn.date}] "${sn.title || 'Daily Summary'}":\n${truncated}`);
            }
          }
          if (summariesSnippets.length > 0) {
            prevSummariesContext = summariesSnippets.join('\n\n');
          }
        }
      } catch (sumErr) {
        console.warn('Failed to build previous summaries context', sumErr);
      }

      // ── SYSTEM INSTRUCTIONS ──
      let systemInstruction = "";
      if (activeLang === 'de') {
        systemInstruction = `Du bist ein hochentwickelter KI-Synthese-Agent. Deine Aufgabe ist es, eine tägliche Zusammenfassung der beruflichen Aktivitäten des Benutzers zu verfassen.
Du arbeitest mit einem internen Scratchpad (Notizblock). Nutze das Scratchpad, um:
1. Notizen zu machen über das, was du bereits weißt und was noch unbekannt/unklar ist.
2. Den Entwurf der Zusammenfassung ("draft_summary") und die Aufgabenempfehlungen ("draft_suggestions") Schritt für Schritt zu aktualisieren.

Richtlinien zur Struktur der Zusammenfassung:
Die endgültige Zusammenfassung MUSS die folgende Struktur in Markdown verwenden, ohne Haupttitel oder Datumsüberschrift am Anfang (kein H1, kein Datum):

### Zusammenfassung des Tages
[Fließtext-Zusammenfassung der heutigen Aktivitäten]

### Fortschritt nach Projekt
[Fortschritt aufgeteilt nach Projekt. Konsultiere die im Prompt bereitgestellten Zusammenfassungen der Vortage, um den Projektstatus zu verfolgen, zu prüfen, was ausstehend ("pending") war, und den Fortschritt zu beschreiben]

### Offene/Neue Themen anzugehen
- [Liste offene oder neue Themen auf, die in Zukunft angegangen werden müssen]

Zeit-Schwerpunkt:
- Der Prompt enthält einen Abschnitt "Aufgewendete Zeit pro Thema / Arbeitsblöcke" aus dem Planer. Wenn ein erheblicher Teil des Tages auf ein Thema entfiel (ein großer Zeitblock), MUSST du dies deutlich in "### Zusammenfassung des Tages" erwähnen und unter "### Fortschritt nach Projekt" widerspiegeln.

Bestehende Aufgaben / Deduplizierung & Prioritätsanpassung:
- Der Prompt enthält unter "Existing Active Tasks / Todos in Board" die Liste der bereits existierenden offenen Aufgaben.
- Prüfe neue Aufgaben gegen diese Liste:
  * Erstelle KEINE doppelten neuen Aufgaben, wenn ein Thema bereits in der Liste existiert.
  * Wenn eine bestehende Aufgabe heute als besonders kritisch oder dringlich hervorgehoben wurde, kannst du vorschlagen, ihre Wichtigkeit/Priorität zu erhöhen (z.B. auf "High" oder Q1).
  * Wenn die bestehende Aufgabe bereits erfasst ist und unverändert weiterläuft, schlage sie nicht erneut vor.

Workstream-Aktualisierungen & Scope-Matching:
- Analysiere alle Notizen des Tages (sowohl mit als auch OHNE Workstream-Tag).
- Vergleiche den Inhalt der Notizen mit den im Prompt angegebenen aktiven Workstream-Scopes.
- Wenn eine Notiz relevante Entscheidungen, Fortschritte oder Fakten für einen aktiven Workstream enthält (selbst wenn die Notiz NICHT mit einem Workstream-Tag versehen ist), extrahiere ein Aktualisierungselement für diesen Workstream in "workstream_updates".

${suggestWorkstreams ? `Vorschlag neuer Workstreams bei wachsenden Themen:
- Wenn du feststellst, dass ein Thema an Dynamik gewinnt oder immer größer wird (mehrere Notizen, intensive Diskussionen, wiederkehrende Aufgaben oder viel Zeitaufwand) und noch KEINEM bestehenden aktiven Workstream entspricht, schlage die Erstellung eines neuen Workstreams in "suggested_workstreams" vor.
- Gib für jeden Vorschlag an:
  * topic_name: Prägnanter Name des Themenfelds
  * scope: Vorgeschlagener Umfang, Hauptziele und Kontext
  * reason: Warum dieses Thema größer wird und ein eigener Workstream empfohlen wird
  * tags: Vorgeschlagene Tags {"group": "...", "major": "...", "topic": "..."} für die Tag-Auswahl.` : `Vorschlag neuer Workstreams bei wachsenden Themen:
- Workstreams vorschlagen ist DEAKTIVIERT. Schlage KEINE neuen Workstreams vor (lasse "suggested_workstreams" und "draft_suggested_workstreams" als leeres Array []). Konzentriere dich nur auf Aufgaben und Planungsblöcke.`}

Bestehende Aufgaben / Deduplizierung, Aufgaben-Updates & Abhängigkeiten:
- Der Prompt enthält den Abschnitt "Existing Active Tasks / Todos in Board" mit bereits offenen Aufgaben auf dem Board.
- Gleiche neue Aufgaben mit dieser Liste ab:
  * Erstelle KEINE Duplikate von Aufgaben, die bereits existieren.
  * Wenn eine bestehende Aufgabe heute als besonders wichtig hervorgehoben wurde oder eine Abhängigkeit zu einer anderen Aufgabe benötigt, schlage eine AKTUALISIERUNG vor (Priorität "High", Abhängigkeit hinzufügen):
    - [UPDATE: <todo_id>] [Titel der Aufgabe] (Priorität: High, Abhängig von: <prerequisite_todo_id>, Grund: <grund>)
  * Wenn eine bestehende Aufgabe bereits korrekt erfasst ist und keine Änderung nötig ist, schlage sie nicht erneut vor.

Vorgehensweise:
- Du kannst in jedem Schritt entweder weitere Details zu einer Notiz anfordern ("read_note_detail"), dein Scratchpad aktualisieren ("update_scratchpad") oder die Zusammenfassung finalisieren ("finalize_summary").
- Versuche, so effizient wie möglich zu sein. Wenn die bereitgestellten Meeting-Zusammenfassungen bereits ausreichen, kannst du direkt finalisieren.

Aufgaben (Suggestions) Format:
Jede vorgeschlagene Aktion muss eines dieser Formate aufweisen:
- Für NEUE Aufgaben:
  - [Beschreibung der Aufgabe] (Dauer: [Dauer in Minuten] min, Priorität: [High|Medium|Low], Abhängig von: <prerequisite_todo_id>)
- Für AKTUALISIERUNGEN bestehender Aufgaben:
  - [UPDATE: <todo_id>] [Titel der Aufgabe] (Dauer: [Dauer in Minuten] min, Priorität: High, Abhängig von: <prerequisite_todo_id>, Grund: <grund>)

Prioritätsrichtlinien für Aufgaben:
- Der Benutzer hat die folgenden Vorgesetzten in seiner Berichtslinie: ${managersList || 'Keine Vorgesetzten angegeben'}.
- Aufgaben von Vorgesetzten erhalten Priorität "High" oder "Medium". Andere Kollegen "Medium" oder "Low".`;
      } else if (activeLang === 'en') {
        systemInstruction = `You are an advanced AI Daily Review Synthesis Agent. Your goal is to construct a daily review summary.
You work with an internal scratchpad. Use the scratchpad to:
1. Take notes of what you already know and what is still unknown/unclear.
2. Progressively update the draft summary ("draft_summary") and suggested actions ("draft_suggestions").

Summary Structure Guidelines:
The final summary MUST use the following exact structure in Markdown, without any main title or date header at the top (no H1, no date):

### Summary of the Day
[Fluid narrative summary of today's activities and achievements]

### Progress by Project
[Progress detailed by project. Consult the previous days' summaries provided in the prompt to track project status, check what was pending, and report on progress]

### Pending/New Topics to Tackle
- [List pending or new topics that need to be tackled in the future]

Time Emphasis:
- The prompt includes a "Time spent per topic / work blocks" section derived from the day's planner. If a significant amount of time was spent on one topic (a large time block, e.g. a long work slot on a release review), you MUST mention it prominently in "### Summary of the Day" and reflect it under "### Progress by Project".

Existing Tasks / Deduplication, Task Updates & Dependencies:
- The prompt includes an "Existing Active Tasks / Todos in Board" section listing open tasks already present in the workspace.
- Cross-check all action items against this list:
  * Do NOT generate duplicate new tasks if an item is already tracked in the existing tasks list.
  * If an existing task was highlighted today as particularly critical or reinforced in importance, or if it requires a dependency on another task, suggest an UPDATE to the existing task instead of creating a new one:
    - [UPDATE: <todo_id>] [Task title] (Priority: High, Depends on: <prerequisite_todo_id>, Reason: <explanation>)
  * If an existing task is already appropriately tracked with no change in urgency, importance, or dependencies, do not re-suggest it.

Workstream Updates & Scope Matching:
- Analyze all notes of the day (both WITH and WITHOUT workstream tags).
- Compare note content against the active workstream scopes listed in the prompt.
- If a note contains relevant decisions, progress, or facts for an active workstream (even if not explicitly tagged), extract an update item for that workstream in "workstream_updates".

${suggestWorkstreams ? `New Workstream Suggestions for Expanding Topics:
- If you notice a topic or theme that is growing significantly or getting larger and larger (multiple notes, substantial discussions, recurring tasks, or heavy time spent) that is NOT yet covered by any existing active workstream, suggest creating a new workstream in "suggested_workstreams".
- For each suggestion provide:
  * topic_name: Clear, concise workstream name
  * scope: Proposed initial scope, objective, and context
  * reason: Explanation of why this topic is expanding and warrants its own dedicated workstream
  * tags: Suggested tag dictionary {"group": "...", "major": "...", "topic": "..."} to configure the label selector.` : `New Workstream Suggestions for Expanding Topics:
- Workstream suggestions are DISABLED. Do NOT suggest new workstreams (leave "suggested_workstreams" and "draft_suggested_workstreams" as an empty array []). Focus only on tasks and planner blocks.`}

Instructions:
- In each turn, you can either request full text of a note ("read_note_detail"), update your scratchpad and drafts ("update_scratchpad"), or declare completion and finalize ("finalize_summary").
- Be efficient. If the meeting summaries provided are sufficient, you can finalize directly.

Suggestions Format:
Each suggested action must have one of these exact formats:
- For NEW tasks:
  - [Description of task] (Duration: [duration in minutes] min, Priority: [High|Medium|Low], Depends on: <prerequisite_todo_id>)
- For UPDATING an existing task:
  - [UPDATE: <todo_id>] [Task title] (Duration: [duration in minutes] min, Priority: High, Depends on: <prerequisite_todo_id>, Reason: <reason>)

Priority Guidelines:
- Direct managers: ${managersList || 'None specified'}. Action items from managers must be "High" or "Medium". Other colleagues: "Medium" or "Low".`;
      } else {
        systemInstruction = `Tu es un agent IA de synthèse. Ton but est de rédiger le résumé quotidien de l'utilisateur.
Tu disposes d'un scratchpad (brouillon/bloc-notes) interne. Utilise le scratchpad pour :
1. Noter ce que tu sais déjà et ce qui reste inconnu ou à clarifier.
2. Mettre à jour au fur et à mesure le brouillon du résumé ("draft_summary") et des suggestions d'actions ("draft_suggestions").

Directives de structure du résumé :
Le résumé final DOIT obligatoirement utiliser la structure suivante en Markdown, sans titre principal ni date en en-tête (pas de H1, pas de date) :

### Résumé de la journée
[Rédige ici un résumé fluide des activités et événements de la journée]

### Progrès par projet
[Détaille ici l'avancement par projet. Consulte les résumés des jours précédents fournis dans le prompt pour suivre les projets et voir ce qui était en attente ("pending") et comment cela a progressé]

### Sujets en attente/nouveaux à aborder
- [Indique ici les sujets en attente ou nouveaux à aborder identifiés dans la journée]

Mise en avant du temps :
- Le prompt inclut une section "Temps passé par sujet / blocs de travail" issue du planificateur. Si une part importante de la journée a été consacrée à un sujet (un bloc de temps important, p. ex. une longue plage de travail sur une revue de release), tu DOIS le mentionner clairement dans "### Résumé de la journée" et le refléter dans "### Progrès par projet".

Tâches existantes / Déduplication, Mises à jour & Dépendances :
- Le prompt contient une section "Tâches actives existantes sur le Board" listant les tâches déjà ouvertes.
- Vérifie les nouvelles actions par rapport à cette liste :
  * Ne crée PAS de tâche en doublon si une tâche identique ou similaire existe déjà.
  * Si une tâche existante a été soulignée aujourd'hui comme particulièrement critique ou urgente, ou si elle dépend d'une autre tâche, suggère une MISE À JOUR de la tâche existante plutôt que de créer un doublon :
    - [UPDATE: <todo_id>] [Titre de la tâche] (Priorité : High, Dépend de : <prerequisite_todo_id>, Raison : <explication>)
  * Si la tâche existante est déjà suivie avec la bonne priorité et sans nouvelles dépendances, ne la re-suggère pas.

Mises à jour des Workstreams & Correspondance de périmètre :
- Analyse toutes les notes de la journée (avec ou SANS étiquette de workstream).
- Compare le contenu des notes avec les périmètres des workstreams actifs indiqués dans le prompt.
- Si une note contient des décisions, progrès ou faits pertinents pour un workstream actif (même non étiqueté), extrais un élément de mise à jour pour ce workstream dans "workstream_updates".

${suggestWorkstreams ? `Suggestions de nouveaux axes de travail (Workstreams) pour les sujets en expansion :
- Si tu constates qu'un sujet ou une thématique prend de plus en plus d'ampleur (plusieurs notes, discussions substantielles, tâches récurrentes ou temps passé important) et n'est PAS encore couvert par un axe de travail actif, suggère la création d'un nouvel axe de travail dans "suggested_workstreams".
- Fournis pour chaque suggestion :
  * topic_name : Nom clair et concis de l'axe de travail
  * scope : Périmètre initial, objectifs et contexte proposés
  * reason : Explication de pourquoi ce sujet prend de l'ampleur et justifie un axe dédié
  * tags : Dictionnaire d'étiquettes suggérées {"group": "...", "major": "...", "topic": "..."} pour configurer le sélecteur de labels.` : `Suggestions de nouveaux axes de travail (Workstreams) pour les sujets en expansion :
- Les suggestions de création de nouveaux axes de travail sont DÉSACTIVÉES. Ne propose AUCUN nouvel axe de travail (laisse "suggested_workstreams" et "draft_suggested_workstreams" sous forme de tableau vide []). Concentre-toi uniquement sur les tâches et blocs de planification.`}

Directives :
- À chaque tour, tu peux soit demander le contenu complet d'une note ("read_note_detail"), soit mettre à jour le scratchpad et tes brouillons ("update_scratchpad"), soit finaliser la synthèse ("finalize_summary").
- Sois efficace. Si les résumés des réunions fournis suffisent, tu peux finaliser directement.

Format des suggestions :
Chaque action suggérée doit respecter l'un de ces formats :
- Pour une NOUVELLE tâche :
  - [Description de la tâche] (Durée : [durée en minutes] min, Priorité : [High|Medium|Low], Dépend de : <prerequisite_todo_id>)
- Pour METTRE À JOUR une tâche existante :
  - [UPDATE: <todo_id>] [Titre de la tâche] (Durée : [durée en minutes] min, Priorité : High, Dépend de : <prerequisite_todo_id>, Raison : <explication>)

Directives de priorité :
- Managers directs : ${managersList || 'Aucun'}. Les tâches venant des managers doivent être prioritaires "High" ou "Medium". Autres collègues : "Medium" ou "Low".`;
      }

      let scratchpad = "Initial scratchpad: Starting daily review synthesis. Analyze notes to extract tasks and daily achievements.";
      let draftSummary = "";
      let draftSuggestions = "";
      let draftWorkstreamUpdates = [];
      let draftSuggestedWorkstreams = [];
      let iteration = 0;
      const maxResearchIterations = 4; // research turns (read/update)
      let completed = false;
      let activeNoteDetails = {};
      let finalResult = null;

      while (iteration < maxResearchIterations && !completed) {
        iteration++;
        const isLastResearchTurn = (iteration === maxResearchIterations);
        
        // Check abort signal
        if (options.signal && options.signal.aborted) throw new DOMException('Aborted', 'AbortError');

        // Show progress details
        const details = document.getElementById('dr-ai-loading-details');
        if (details) {
          if (activeLang === 'de') {
            details.textContent = `Analysiere und aktualisiere Notizblock (Schritt ${iteration} / ${maxResearchIterations + 1})...`;
          } else if (activeLang === 'en') {
            details.textContent = `Analyzing and updating scratchpad (Step ${iteration} / ${maxResearchIterations + 1})...`;
          } else {
            details.textContent = `Analyse et mise à jour du scratchpad (Étape ${iteration} / ${maxResearchIterations + 1})...`;
          }
        }

        // Build history / user prompt
        let userContent = "";

        // ── TIME SPENT PER TOPIC (from planner blocs) ──
        const _parseHM = (s) => {
          const m = /^(\d{1,2}):(\d{2})/.exec(String(s || ''));
          return m ? (parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) : null;
        };
        const _blocMinutes = (ev) => {
          const a = _parseHM(ev.startTime), b = _parseHM(ev.endTime);
          if (a != null && b != null && b >= a) return b - a;
          const d = Number(ev.duration);
          return Number.isFinite(d) && d > 0 ? d : 0;
        };
        const _fmtDur = (mins) => {
          const h = Math.floor(mins / 60), m = mins % 60;
          return h > 0 ? (m > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`) : `${m}min`;
        };
        const _evToday = (Array.isArray(plannerEvents) ? plannerEvents : [])
          .filter(ev => ev && ev.date === reviewDateStr && ev.type !== 'ooo');
        const minutesByNoteId = new Map();
        for (const ev of _evToday) {
          if (!ev.noteId) continue;
          minutesByNoteId.set(ev.noteId, (minutesByNoteId.get(ev.noteId) || 0) + _blocMinutes(ev));
        }
        const timeRows = [];
        for (const [noteId, mins] of minutesByNoteId.entries()) {
          if (mins <= 0) continue;
          const note = this.todayNotes.find(n => n.id === noteId);
          const label = note ? note.title : ((typeof getNoteById === 'function' && getNoteById(noteId)?.title) || noteId);
          timeRows.push({ label, mins });
        }
        const _unassocByTitle = new Map();
        for (const ev of _evToday) {
          if (ev.noteId || ev.type === 'custom') continue;
          const key = String(ev.title || ev.type || 'Untitled block').trim();
          _unassocByTitle.set(key, (_unassocByTitle.get(key) || 0) + _blocMinutes(ev));
        }
        for (const [label, mins] of _unassocByTitle.entries()) {
          if (mins > 0) timeRows.push({ label, mins });
        }
        timeRows.sort((a, b) => b.mins - a.mins);
        const totalBookedMins = timeRows.reduce((s, r) => s + r.mins, 0);
        const BIG_SLOT_MIN = 90; // ~1.5h counts as a large, worth-mentioning block
        const bigSlotFlag = activeLang === 'de' ? ' (großer Zeitblock)'
          : activeLang === 'en' ? ' (large time block)'
          : ' (bloc de temps important)';
        const timeBlocksFormatted = timeRows
          .map(r => `- ${r.label}: ${_fmtDur(r.mins)}${r.mins >= BIG_SLOT_MIN ? bigSlotFlag : ''}`)
          .join('\n');
        const timeBlocksLabel = activeLang === 'de' ? 'Aufgewendete Zeit pro Thema / Arbeitsblöcke'
          : activeLang === 'en' ? 'Time spent per topic / work blocks'
          : 'Temps passé par sujet / blocs de travail';
        const timeBlocksSection = timeBlocksFormatted
          ? `\n${timeBlocksLabel} (${_fmtDur(totalBookedMins)} total):\n${timeBlocksFormatted}\n`
          : '';

        const meetingsListFormatted = this.todayNotes.map((n, idx) => {
          const mins = minutesByNoteId.get(n.id) || 0;
          const timeTag = mins > 0 ? `  ⏱ ${_fmtDur(mins)} booked` : '';
          const noteWsList = (typeof getNoteWorkstreams === 'function') ? getNoteWorkstreams(n) : (n.workstream ? [n.workstream] : []);
          const wsTagStr = noteWsList.join(', ');
          const wsTagInfo = wsTagStr ? ` [Workstream: "${wsTagStr}"]` : ' [Untagged Workstream]';
          return `[${idx}] Titel/Title: "${n.title}"${wsTagInfo}${timeTag}\n    Preview/Summary: ${(n.summary || n.preview || 'No summary.').replace(/<[^>]*>/g, '').trim()}`;
        }).join('\n\n');

        const calendarEventsFormatted = _evToday.map(ev => {
          const typeStr = (ev.type || 'block').toUpperCase();
          const titleStr = ev.title || 'Untitled Session';
          const timeStr = (ev.startTime && ev.endTime) ? ` (${ev.startTime} - ${ev.endTime})` : '';
          const contextStr = ev.context ? ` | Context/Purpose: "${ev.context}"` : '';
          const collabsStr = (Array.isArray(ev.collaborators) && ev.collaborators.length) ? ` | With: ${ev.collaborators.join(', ')}` : '';
          return `- [${typeStr}] "${titleStr}"${timeStr}${collabsStr}${contextStr}`;
        }).join('\n');

        const eventsSectionLabel = activeLang === 'de' ? 'Geplante Kalenderblöcke & Anrufkontexte'
          : activeLang === 'en' ? 'Scheduled Calendar Blocks & Call/Meeting Contexts'
          : 'Blocs de calendrier programmés & Contextes d\'appel/réunion';
        const calendarEventsSection = calendarEventsFormatted
          ? `\n${eventsSectionLabel}:\n${calendarEventsFormatted}\n`
          : '';

        if (activeLang === 'de') {
          userContent = `Tageszusammenfassung für den: ${reviewDateDisplay}
Hier ist die Liste der Besprechungen heute:
${meetingsListFormatted || 'Keine Besprechungen heute.'}
${calendarEventsSection}
${timeBlocksSection}
${workstreamCatalogContext}
${existingTodosContext ? `${existingTodosContext}\n` : ''}
${prevSummariesContext ? `Zusammenfassungen der Vortage (zur Verfolgung des Projektfortschritts und offener Themen):\n${prevSummariesContext}\n` : ''}

Bisheriges Scratchpad:
${scratchpad}

Aktueller Entwurf der Zusammenfassung:
${draftSummary || 'Noch kein Entwurf.'}

Aktueller Entwurf der Aufgaben (Suggestions):
${draftSuggestions || 'Noch keine Entwürfe.'}

Zusätzliche Detaildaten gelesener Notizen:
${Object.keys(activeNoteDetails).length > 0 ? Object.entries(activeNoteDetails).map(([idx, text]) => `Note [${idx}] Details:\n${text}`).join('\n\n') : 'Keine zusätzlichen Notizen eingelesen.'}`;

          if (options.context) {
            userContent += `\n\nBestehende Zusammenfassung: ${existingSummaryText}\nBenutzeranweisungen: ${options.context}`;
          }

          if (isLastResearchTurn) {
            userContent += `\n\n⚠️ WICHTIG: Dies ist dein LETZTER Erkundungsschritt. Im nächsten Schritt wirst du zwingend gebeten, die Zusammenfassung zu finalisieren. Nutze diesen Schritt, um dein Scratchpad und deine Entwürfe final zu konsolidieren.`;
          }

          userContent += `\n\nAntworte mit einem einzigen JSON-Objekt in einem der folgenden Formate:
1. Um mehr Details zu einer Notiz zu lesen:
{"action": "read_note_detail", "properties": {"note_index": Index}}

2. Um dein Scratchpad und deine Entwürfe zu aktualisieren:
{"action": "update_scratchpad", "properties": {"scratchpad_content": "Deine Notizen", "draft_summary": "Entwurf Zusammenfassung", "draft_suggestions": "Entwurf Suggestions", "draft_workstream_updates": [{"workstream": "Workstream-Name", "updates": "Extrahierte Fakten...", "is_untagged_source": boolean}], "draft_suggested_workstreams": [{"topic_name": "Name", "scope": "Périmètre...", "reason": "Warum...", "tags": {"group": "...", "major": "...", "topic": "..."}}]}}

3. Um die Zusammenfassung abzuschließen:
{"action": "finalize_summary", "properties": {"final_summary": "Endgültige Zusammenfassung (in Markdown)", "final_suggestions": "Endgültige Suggestions", "workstream_updates": [{"workstream": "Workstream-Name", "updates": "Extrahierte Fakten...", "is_untagged_source": boolean}], "suggested_workstreams": [{"topic_name": "Name", "scope": "Périmètre...", "reason": "Warum...", "tags": {"group": "...", "major": "...", "topic": "..."}}]}}`;
        } else if (activeLang === 'en') {
          userContent = `Daily summary for date: ${reviewDateDisplay}
Meetings list:
${meetingsListFormatted || 'No meetings today.'}
${calendarEventsSection}
${timeBlocksSection}
${workstreamCatalogContext}
${existingTodosContext ? `${existingTodosContext}\n` : ''}
${prevSummariesContext ? `Previous daily summaries (for tracking project progress and pending items):\n${prevSummariesContext}\n` : ''}

Current Scratchpad:
${scratchpad}

Current Draft Summary:
${draftSummary || 'None.'}

Current Draft Suggestions:
${draftSuggestions || 'None.'}

Additional note texts read:
${Object.keys(activeNoteDetails).length > 0 ? Object.entries(activeNoteDetails).map(([idx, text]) => `Note [${idx}] Details:\n${text}`).join('\n\n') : 'No additional note content loaded.'}`;

          if (options.context) {
            userContent += `\n\nExisting summary: ${existingSummaryText}\nUser instructions: ${options.context}`;
          }

          if (isLastResearchTurn) {
            userContent += `\n\n⚠️ IMPORTANT: This is your LAST research step. On the next step, you will be required to finalize the summary. Use this step to consolidate your draft into its final form.`;
          }

          userContent += `\n\nRespond with a single JSON object using one of these formats:
1. To read full text of a note:
{"action": "read_note_detail", "properties": {"note_index": index}}

2. To update scratchpad and drafts:
{"action": "update_scratchpad", "properties": {"scratchpad_content": "Your notes", "draft_summary": "Draft summary", "draft_suggestions": "Draft suggestions", "draft_workstream_updates": [{"workstream": "Workstream Name", "updates": "Extracted facts...", "is_untagged_source": boolean}], "draft_suggested_workstreams": [{"topic_name": "Name", "scope": "Périmètre...", "reason": "Why...", "tags": {"group": "...", "major": "...", "topic": "..."}}]}}

3. To finalize summary:
{"action": "finalize_summary", "properties": {"final_summary": "Final daily summary (in Markdown)", "final_suggestions": "Final suggestions", "workstream_updates": [{"workstream": "Workstream Name", "updates": "Extracted facts...", "is_untagged_source": boolean}], "suggested_workstreams": [{"topic_name": "Name", "scope": "Périmètre...", "reason": "Why...", "tags": {"group": "...", "major": "...", "topic": "..."}}]}}`;
        } else {
          userContent = `Résumé quotidien de la journée : ${reviewDateDisplay}
Liste des réunions de la journée :
${meetingsListFormatted || 'Aucune réunion aujourd\'hui.'}
${calendarEventsSection}
${timeBlocksSection}
${workstreamCatalogContext}
${existingTodosContext ? `${existingTodosContext}\n` : ''}
${prevSummariesContext ? `Résumés quotidiens des jours précédents (pour suivre le progrès des projets et les sujets en attente) :\n${prevSummariesContext}\n` : ''}

Scratchpad actuel :
${scratchpad}

Brouillon du résumé actuel :
${draftSummary || 'Aucun.'}

Brouillon des suggestions actuel :
${draftSuggestions || 'Aucun.'}

Contenus détaillés des notes lues :
${Object.keys(activeNoteDetails).length > 0 ? Object.entries(activeNoteDetails).map(([idx, text]) => `Note [${idx}] Détails :\n${text}`).join('\n\n') : 'Aucun contenu additionnel lu.'}`;

          if (options.context) {
            userContent += `\n\nRésumé existant : ${existingSummaryText}\nInstructions de l'utilisateur : ${options.context}`;
          }

          if (isLastResearchTurn) {
            userContent += `\n\n⚠️ IMPORTANT : Ceci est ton DERNIER tour d'exploration. Au prochain tour, tu devras obligatoirement finaliser le résumé. Profite de ce tour pour consolider tes brouillons dans leur forme finale.`;
          }

          userContent += `\n\nRéponds avec un unique objet JSON dans l'un de ces formats :
1. Pour lire le texte complet d'une note :
{"action": "read_note_detail", "properties": {"note_index": index}}

2. Pour mettre à jour le scratchpad et les brouillons :
{"action": "update_scratchpad", "properties": {"scratchpad_content": "Vos notes", "draft_summary": "Brouillon du résumé", "draft_suggestions": "Brouillon des suggestions", "draft_workstream_updates": [{"workstream": "Nom Workstream", "updates": "Faits extraits...", "is_untagged_source": boolean}], "draft_suggested_workstreams": [{"topic_name": "Nom", "scope": "Périmètre...", "reason": "Pourquoi...", "tags": {"group": "...", "major": "...", "topic": "..."}}]}}

3. Pour finaliser le résumé :
{"action": "finalize_summary", "properties": {"final_summary": "Résumé final en Markdown", "final_suggestions": "Suggestions finales", "workstream_updates": [{"workstream": "Nom Workstream", "updates": "Faits extraits...", "is_untagged_source": boolean}], "suggested_workstreams": [{"topic_name": "Nom", "scope": "Périmètre...", "reason": "Pourquoi...", "tags": {"group": "...", "major": "...", "topic": "..."}}]}}`;
        }

        const messages = [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: userContent }
        ];

        const response = await LLMService.chat(messages, {
          temperature: 0.3,
          reasoningEffort: 'low',
          signal: options.signal
        });

        if (options.signal && options.signal.aborted) throw new DOMException('Aborted', 'AbortError');

        let parsed = response.parsed;
        if (!parsed && response.reply) {
          const extracted = LLMService.extractJsonPayloadFromText(response.reply);
          parsed = extracted.parsed;
        }

        if (!parsed) {
          console.warn("Agent returned invalid JSON, skipping iteration", response.reply);
          continue;
        }

        const action = String(parsed.action || parsed.type || parsed.command || '').toLowerCase().trim();
        const props = parsed.properties || parsed.args || parsed.parameters || parsed || {};

        if (action === 'read_note_detail' || action === 'read_note' || action === 'read') {
          const rawIdx = props.note_index !== undefined ? props.note_index : (props.index !== undefined ? props.index : props.idx);
          const idx = parseInt(rawIdx, 10);
          if (Number.isInteger(idx) && idx >= 0 && idx < this.todayNotes.length) {
            const note = this.todayNotes[idx];
            const detailsEl = document.getElementById('dr-ai-loading-details');
            if (detailsEl) {
              detailsEl.textContent = activeLang === 'de' ? `Lese Details der Notiz "${note.title}"...` : (activeLang === 'en' ? `Reading details of note "${note.title}"...` : `Lecture des détails de la note "${note.title}"...`);
            }
            try {
              const html = await StorageAPI.readNoteContent(note.path);
              const parsedHtml = (typeof parseNoteHTML === 'function') ? parseNoteHTML(html) : { mainHTML: html };
              const mainH = parsedHtml?.mainHTML || html || '';
              const noteText = (typeof DOMParser !== 'undefined')
                ? (new DOMParser().parseFromString('<div>' + mainH + '</div>', 'text/html').body?.textContent || '')
                : String(mainH).replace(/<[^>]*>/g, ' ');
              activeNoteDetails[idx] = noteText.slice(0, 3000);
              scratchpad += `\n- Read full note [${idx}] "${note.title}".`;
            } catch (err) {
              activeNoteDetails[idx] = `Error reading note: ${err.message}`;
            }
          } else {
            console.warn("Invalid note_index requested by agent", props.note_index);
          }
        } else if (action === 'update_scratchpad' || action === 'scratchpad' || action === 'update') {
          scratchpad = typeof props.scratchpad_content === 'string' ? props.scratchpad_content : (typeof props.scratchpad === 'string' ? props.scratchpad : scratchpad);
          draftSummary = typeof props.draft_summary === 'string' ? props.draft_summary : (typeof props.summary === 'string' ? props.summary : draftSummary);
          draftSuggestions = typeof props.draft_suggestions === 'string' ? props.draft_suggestions : (Array.isArray(props.draft_suggestions) ? props.draft_suggestions.join('\n') : draftSuggestions);
          if (Array.isArray(props.draft_workstream_updates) || Array.isArray(props.workstream_updates)) {
            draftWorkstreamUpdates = props.draft_workstream_updates || props.workstream_updates;
          }
          if (Array.isArray(props.draft_suggested_workstreams) || Array.isArray(props.suggested_workstreams)) {
            draftSuggestedWorkstreams = props.draft_suggested_workstreams || props.suggested_workstreams;
          }
        } else if (action === 'finalize_summary' || action === 'finalize' || action === 'final_step' || action === 'finalstep' || action === 'finish' || action === 'finish_summary' || action === 'complete_summary') {
          finalResult = {
            summary: props.final_summary || props.summary || draftSummary,
            suggestions: props.final_suggestions !== undefined ? props.final_suggestions : (props.suggestions !== undefined ? props.suggestions : draftSuggestions),
            workstream_updates: props.workstream_updates || props.draft_workstream_updates || draftWorkstreamUpdates || [],
            suggested_workstreams: props.suggested_workstreams || props.draft_suggested_workstreams || draftSuggestedWorkstreams || []
          };
          completed = true;
        }
      }

      // ── MANDATORY FINALIZATION TURN ──
      // If the agent hasn't finalized yet after all research turns, force a last call
      if (!completed) {
        if (options.signal && options.signal.aborted) throw new DOMException('Aborted', 'AbortError');

        const finalDetails = document.getElementById('dr-ai-loading-details');
        if (finalDetails) {
          if (activeLang === 'de') {
            finalDetails.textContent = `Erstelle die endgültige Zusammenfassung (Schritt ${maxResearchIterations + 1} / ${maxResearchIterations + 1})...`;
          } else if (activeLang === 'en') {
            finalDetails.textContent = `Generating final summary (Step ${maxResearchIterations + 1} / ${maxResearchIterations + 1})...`;
          } else {
            finalDetails.textContent = `Rédaction du résumé final (Étape ${maxResearchIterations + 1} / ${maxResearchIterations + 1})...`;
          }
        }

        // Build a forced finalization prompt
        let finalUserContent = "";
        if (activeLang === 'de') {
          finalUserContent = `Du hast alle Erkundungsschritte abgeschlossen.

Letzter Stand deines Scratchpads:
${scratchpad}

Letzter Entwurf der Zusammenfassung:
${draftSummary || 'Kein Entwurf vorhanden.'}

Letzter Entwurf der Suggestions:
${draftSuggestions || 'Keine Suggestions vorhanden.'}

🚨 OBLIGATORISCH: Dies ist dein LETZTER Schritt. Du MUSST jetzt die Zusammenfassung abschließen. Andere Aktionen sind nicht mehr erlaubt.

Antworte NUR mit:
{"action": "finalize_summary", "properties": {"final_summary": "Vollständige Zusammenfassung in Markdown", "final_suggestions": "Alle vorgeschlagenen Aufgaben", "workstream_updates": [{"workstream": "Workstream-Name", "updates": "Fakten...", "is_untagged_source": boolean}], "suggested_workstreams": [{"topic_name": "Name", "scope": "Périmètre...", "reason": "Warum...", "tags": {"group": "...", "major": "...", "topic": "..."}}]}}`;
        } else if (activeLang === 'en') {
          finalUserContent = `You have completed all research steps.

Final scratchpad state:
${scratchpad}

Final draft summary:
${draftSummary || 'No draft available.'}

Final draft suggestions:
${draftSuggestions || 'No suggestions yet.'}

🚨 MANDATORY: This is your LAST step. You MUST now finalize the summary. No other actions are permitted.

Respond ONLY with:
{"action": "finalize_summary", "properties": {"final_summary": "Complete summary in Markdown", "final_suggestions": "All suggested tasks", "workstream_updates": [{"workstream": "Workstream Name", "updates": "Facts...", "is_untagged_source": boolean}], "suggested_workstreams": [{"topic_name": "Name", "scope": "Périmètre...", "reason": "Why...", "tags": {"group": "...", "major": "...", "topic": "..."}}]}}`;
        } else {
          finalUserContent = `Tu as terminé tous les tours d'exploration.

État final de ton scratchpad :
${scratchpad}

Brouillon final du résumé :
${draftSummary || 'Aucun brouillon disponible.'}

Brouillon final des suggestions :
${draftSuggestions || 'Aucune suggestion encore.'}

🚨 OBLIGATOIRE : Ceci est ton DERNIER tour. Tu DOIS maintenant finaliser le résumé. Aucune autre action n'est autorisée.

Réponds UNIQUEMENT avec :
{"action": "finalize_summary", "properties": {"final_summary": "Résumé complet en Markdown", "final_suggestions": "Toutes les suggestions de tâches", "workstream_updates": [{"workstream": "Nom Workstream", "updates": "Faits...", "is_untagged_source": boolean}], "suggested_workstreams": [{"topic_name": "Nom", "scope": "Périmètre...", "reason": "Pourquoi...", "tags": {"group": "...", "major": "...", "topic": "..."}}]}}`;
        }

        const finalResponse = await LLMService.chat(
          [{ role: 'system', content: systemInstruction }, { role: 'user', content: finalUserContent }],
          { temperature: 0.3, reasoningEffort: 'low', signal: options.signal }
        );

        if (options.signal && options.signal.aborted) throw new DOMException('Aborted', 'AbortError');

        let finalParsed = finalResponse.parsed;
        if (!finalParsed && finalResponse.reply) {
          const extracted = LLMService.extractJsonPayloadFromText(finalResponse.reply);
          finalParsed = extracted.parsed;
        }

        const actionName = String(finalParsed?.action || finalParsed?.type || finalParsed?.command || '').toLowerCase().trim();
        const isFinalAction = !finalParsed?.action ||
          actionName === 'finalize_summary' ||
          actionName === 'final_step' ||
          actionName === 'finalstep' ||
          actionName === 'finalize' ||
          actionName === 'finish_summary' ||
          actionName === 'finish' ||
          actionName === 'complete_summary' ||
          actionName === 'complete';

        if (finalParsed && isFinalAction) {
          const fp = finalParsed.properties || finalParsed.args || finalParsed.parameters || finalParsed || {};
          finalResult = {
            summary: fp.final_summary || fp.summary || fp.draft_summary || draftSummary,
            suggestions: fp.final_suggestions !== undefined ? fp.final_suggestions : (fp.suggestions !== undefined ? fp.suggestions : (fp.draft_suggestions !== undefined ? fp.draft_suggestions : draftSuggestions)),
            workstream_updates: fp.workstream_updates || fp.draft_workstream_updates || draftWorkstreamUpdates || [],
            suggested_workstreams: fp.suggested_workstreams || fp.draft_suggested_workstreams || draftSuggestedWorkstreams || []
          };
        }
      }

      if (!finalResult) {
        finalResult = {
          summary: draftSummary || "Daily review synthesis incomplete.",
          suggestions: draftSuggestions || "",
          workstream_updates: draftWorkstreamUpdates || [],
          suggested_workstreams: draftSuggestedWorkstreams || []
        };
      }

      this.extractedWorkstreamUpdates = Array.isArray(finalResult.workstream_updates)
        ? finalResult.workstream_updates
        : (Array.isArray(draftWorkstreamUpdates) ? draftWorkstreamUpdates : []);
      this.suggestedWorkstreams = suggestWorkstreams
        ? (Array.isArray(finalResult.suggested_workstreams) ? finalResult.suggested_workstreams : (Array.isArray(draftSuggestedWorkstreams) ? draftSuggestedWorkstreams : []))
        : [];

      // Normalize summary to a safe string without throwing .trim is not a function
      let rawSummary = finalResult.summary;
      let reply = '';
      if (typeof rawSummary === 'string') {
        reply = rawSummary.trim();
      } else if (rawSummary && typeof rawSummary === 'object') {
        if (Array.isArray(rawSummary)) {
          reply = rawSummary.map(s => typeof s === 'string' ? s : JSON.stringify(s)).join('\n\n').trim();
        } else {
          reply = (rawSummary.summary || rawSummary.final_summary || rawSummary.text ||
            Object.values(rawSummary).map(v => typeof v === 'string' ? v : JSON.stringify(v)).join('\n\n')
          ).trim();
        }
      } else {
        reply = String(rawSummary || draftSummary || '').trim();
      }

      if (scratchpad && typeof LLMService !== 'undefined' && typeof LLMService.renderThinkingAccordionHTML === 'function') {
        const thinkingAccordion = LLMService.renderThinkingAccordionHTML(scratchpad, { title: (typeof t === 'function' ? t('chat.thinkingProcess') : null) || 'Thought process' });
        if (thinkingAccordion) {
          reply = thinkingAccordion + '\n\n' + reply;
        }
      }

      // Normalize suggestions to a safe string without throwing .trim is not a function
      let rawSuggestions = finalResult.suggestions;
      let cleanSuggestions = '';
      if (typeof rawSuggestions === 'string') {
        cleanSuggestions = rawSuggestions.trim();
      } else if (Array.isArray(rawSuggestions)) {
        cleanSuggestions = rawSuggestions.map(item => {
          if (typeof item === 'string') return item;
          if (item && typeof item === 'object') {
            const taskTitle = item.title || item.task || item.description || '';
            const taskDur = item.duration ? ` (Duration: ${item.duration} min)` : '';
            const taskPrio = item.priority ? ` (Priority: ${item.priority})` : '';
            const taskDep = item.dependsOn ? ` (Depends on: ${item.dependsOn})` : '';
            return `- ${taskTitle}${taskDur}${taskPrio}${taskDep}`;
          }
          return String(item || '');
        }).filter(Boolean).join('\n').trim();
      } else if (rawSuggestions && typeof rawSuggestions === 'object') {
        cleanSuggestions = Object.values(rawSuggestions)
          .map(v => typeof v === 'string' ? v : (Array.isArray(v) ? v.join('\n') : JSON.stringify(v)))
          .join('\n').trim();
      } else if (rawSuggestions != null) {
        cleanSuggestions = String(rawSuggestions).trim();
      }

      if (cleanSuggestions) {
        if (!cleanSuggestions.includes('[SUGGESTIONS]')) {
          reply += `\n\n[SUGGESTIONS]\n${cleanSuggestions}\n[/SUGGESTIONS]`;
        } else {
          reply += `\n\n${cleanSuggestions}`;
        }
      }

      if (reply) {
        // Extract suggestions block
        const suggestionsMatch = reply.match(/\[SUGGESTIONS\]([\s\S]*?)\[\/SUGGESTIONS\]/);
        let suggestionsText = '';
        this.currentSuggestions = [];
        
        if (suggestionsMatch) {
          suggestionsText = suggestionsMatch[1];
          reply = reply.replace(/\[SUGGESTIONS\][\s\S]*?\[\/SUGGESTIONS\]/, '').trim();
          
          // Parse lines in suggestions
          const lines = suggestionsText.split('\n');
          lines.forEach(line => {
            const cleaned = line.replace(/^[\s*\-\+\d\.)\]]*/, '').trim();
            if (cleaned) {
              // Check for [UPDATE: <todo_id>] or [UPDATE: todo-xxx]
              let isUpdate = false;
              let targetTodoId = null;
              const updateMatch = cleaned.match(/\[UPDATE:\s*([^\]]+)\]/i);
              if (updateMatch) {
                isUpdate = true;
                targetTodoId = updateMatch[1].trim();
              }

              // Extract duration
              let duration = 30; // default
              const durationMatch = cleaned.match(/\((?:durée\s*estimée|durée|duration|time|estimé|est)\s*:\s*(\d+)\s*(?:min|minutes|m)?\)/i)
                || cleaned.match(/(\d+)\s*(?:min|minutes|m)\b/i);
              if (durationMatch) {
                duration = parseInt(durationMatch[1], 10);
              }
              
              // Extract priority
              let priority = "Medium";
              const priorityMatch = cleaned.match(/\b(High|Medium|Low|Haute|Moyenne|Basse)\b/i);
              if (priorityMatch) {
                const pStr = priorityMatch[1].toLowerCase();
                if (pStr === 'high' || pStr === 'haute') priority = 'High';
                else if (pStr === 'low' || pStr === 'basse') priority = 'Low';
              }

              // Extract dependencies: Depends on: <id> / Dépend de: <id> / Abhängig von: <id>
              let dependsOn = null;
              const depMatch = cleaned.match(/(?:depends\s*on|dépend\s*de|abhängig\s*von)\s*:\s*([a-zA-Z0-9_\-]+)/i);
              if (depMatch) {
                dependsOn = depMatch[1].trim();
              }

              // Extract reason if present
              let reason = '';
              const reasonMatch = cleaned.match(/(?:reason|raison|grund)\s*:\s*([^)]+)/i);
              if (reasonMatch) {
                reason = reasonMatch[1].trim();
              }
              
              // Strip metadata patterns to construct clean title
              let cleanTitle = cleaned
                .replace(/\[UPDATE:\s*[^\]]+\]/gi, '')
                .replace(/\((?:durée\s*estimée|durée|duration|time|estimé|est)\s*:\s*\d+\s*(?:min|minutes|m)?.*?\)/i, '')
                .replace(/\b\d+\s*(?:min|minutes|m)\b/gi, '')
                .replace(/\b(High|Medium|Low|Haute|Moyenne|Basse)\b/gi, '')
                .replace(/(?:depends\s*on|dépend\s*de|abhängig\s*von)\s*:\s*[a-zA-Z0-9_\-]+/gi, '')
                .replace(/(?:reason|raison|grund)\s*:\s*[^,)]+/gi, '')
                .replace(/,\s*priorité\s*:\s*/i, '')
                .replace(/,\s*priorité\s*/i, '')
                .replace(/\bPriorité\s*:\s*/gi, '')
                .replace(/\bPriority\s*:\s*/gi, '')
                .replace(/[()]/g, '')
                .replace(/^[\s,;\-:]+|[\s,;\-:]+$/g, '')
                .trim();

              // If not already marked as update, check if an existing open todo matches the title
              const manifestList = (typeof todosManifest !== 'undefined' && Array.isArray(todosManifest)) ? todosManifest : [];
              if (!isUpdate && cleanTitle) {
                const cleanLow = cleanTitle.toLowerCase();
                const matchedExisting = manifestList.find(t => t && t.priority !== 'Done' && t.title && t.title.trim().toLowerCase() === cleanLow);
                if (matchedExisting) {
                  isUpdate = true;
                  targetTodoId = matchedExisting.id;
                  priority = 'High';
                }
              }
                
              if (cleanTitle) {
                this.currentSuggestions.push({
                  title: cleanTitle,
                  duration: duration,
                  priority: priority,
                  isUpdate: isUpdate,
                  targetTodoId: targetTodoId,
                  dependsOn: dependsOn,
                  reason: reason
                });
              }
            }
          });
        }
        
        const contentHTML = (typeof mdToPreviewHTML === 'function') ? mdToPreviewHTML(reply) : `<p>${reply.replace(/\n/g, '<br>')}</p>`;
        if (contentTextarea) {
          contentTextarea.innerHTML = contentHTML;
        }
        const editArea = document.getElementById('edit-textarea');
        if (editArea) {
          editArea.innerHTML = contentHTML;
        }
        if (typeof currentNote !== 'undefined' && currentNote &&
            (currentNote.id === `summary-${reviewDateStr}` || currentNote.path === `notes/daily-summary-${reviewDateStr}.html`)) {
          currentNote.mainHTML = contentHTML;
        }
        
        // Render suggestion cards
        if (sugList) {
          sugList.innerHTML = '';

          // Render suggested workstreams for growing topics first
          const isWsSuggestEnabled = (window.settings?.ai?.suggestWorkstreams !== false);
          const headerToggle = document.getElementById('dr-toggle-suggest-ws');
          if (headerToggle) headerToggle.checked = isWsSuggestEnabled;

          if (Array.isArray(this.suggestedWorkstreams) && this.suggestedWorkstreams.length > 0) {
            const wsSection = document.createElement('div');
            wsSection.className = 'dr-suggested-workstreams-section';
            wsSection.style.display = isWsSuggestEnabled ? 'flex' : 'none';
            wsSection.style.flexDirection = 'column';
            wsSection.style.gap = '0.5rem';
            wsSection.style.marginBottom = '0.8rem';
            wsSection.style.paddingBottom = '0.8rem';
            wsSection.style.borderBottom = '1px dashed var(--card-border)';

            const secTitle = document.createElement('div');
            secTitle.style.fontSize = '0.8rem';
            secTitle.style.fontWeight = '700';
            secTitle.style.color = 'var(--accent)';
            secTitle.style.display = 'flex';
            secTitle.style.alignItems = 'center';
            secTitle.style.gap = '0.4rem';
            secTitle.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> <span>${escH(t('dailyreview.suggestedWorkstreamsTitle') || 'Suggested New Workstreams (Growing Topics)')}</span>`;
            wsSection.appendChild(secTitle);

            this.suggestedWorkstreams.forEach((wsItem, wsIdx) => {
              const card = document.createElement('div');
              card.className = 'retro-item-card dr-suggested-ws-card';
              card.id = `dr-suggested-ws-${wsIdx}`;
              card.style.padding = '0.8rem';
              card.style.display = 'flex';
              card.style.flexDirection = 'column';
              card.style.gap = '0.5rem';
              card.style.border = '1px solid var(--accent, #6366f1)';
              card.style.borderRadius = 'var(--radius-sm)';
              card.style.background = 'var(--card-bg-alt)';

              const topicName = wsItem.createdName || wsItem.topic_name || wsItem.workstream || wsItem.title || 'Workstream';
              const reason = wsItem.reason || '';
              const scope = wsItem.scope || '';
              const tags = wsItem.tags || {};
              const tagDisplay = [tags.group, tags.major, tags.topic].filter(Boolean).join(' / ');

              if (wsItem.created) {
                const createdBadge = t('dailyreview.workstreamCreatedBadge') || 'Workstream Created';
                const openTooltip = t('dailyreview.openCreatedWorkstreamTooltip') || 'Click to open this workstream dossier';
                const taskTooltip = t('dailyreview.createTaskForWorkstreamTooltip') || 'Create a task linked to this workstream';
                const planTooltip = t('dailyreview.planEventForWorkstreamTooltip') || 'Plan a time block in the planner for this workstream';

                card.innerHTML = `
                  <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:0.4rem;">
                    <div style="font-size:0.85rem; font-weight:700; color:var(--text); line-height:1.3; cursor:pointer;" 
                         onclick="DailyReviewController.openWorkstreamDossier(${JSON.stringify(topicName)})"
                         title="${escA(openTooltip)}">
                      <span style="color:var(--accent);">📂</span> ${escH(topicName)}
                    </div>
                    <span class="badge" style="font-size:0.65rem; background:rgba(34, 197, 94, 0.15); color:#22c55e; border:1px solid rgba(34, 197, 94, 0.4); padding:2px 6px; border-radius:3px; font-weight:600; white-space:nowrap;">
                      ✓ ${escH(createdBadge)}
                    </span>
                  </div>
                  ${scope ? `<div style="font-size:0.75rem; color:var(--text-muted); line-height:1.3;">${escH(scope)}</div>` : ''}
                  <div style="display:flex; align-items:center; justify-content:flex-end; gap:0.4rem; margin-top:0.2rem;">
                    <button class="btn btn-secondary" onclick="DailyReviewController.createTodoForWorkstream(${JSON.stringify(topicName)})" style="padding:3px 8px; font-size:0.72rem; display:flex; align-items:center; gap:0.25rem;" title="${escA(taskTooltip)}">
                      + 📋 ${escH(t('dailyreview.aiSuggestionBoardBtn') || 'Task')}
                    </button>
                    <button class="btn btn-secondary" onclick="DailyReviewController.planEventForWorkstream(${JSON.stringify(topicName)})" style="padding:3px 8px; font-size:0.72rem; display:flex; align-items:center; gap:0.25rem;" title="${escA(planTooltip)}">
                      + 📅 ${escH(t('dailyreview.aiSuggestionPlannerBtn') || 'Plan')}
                    </button>
                  </div>
                `;
              } else {
                card.innerHTML = `
                  <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:0.4rem;">
                    <div style="font-size:0.85rem; font-weight:700; color:var(--text); line-height:1.3;">${escH(topicName)}</div>
                    <span class="badge" style="font-size:0.65rem; background:rgba(245, 158, 11, 0.15); color:#f59e0b; border:1px solid rgba(245, 158, 11, 0.4); padding:2px 6px; border-radius:3px; text-transform:uppercase; font-weight:600; white-space:nowrap;">${escH(t('dailyreview.growingTopicBadge') || 'Growing Topic')}</span>
                  </div>
                  ${reason ? `<div style="font-size:0.75rem; color:var(--text-muted); font-style:italic; line-height:1.3;">${escH(reason)}</div>` : ''}
                  ${scope ? `<div style="font-size:0.75rem; color:var(--text); line-height:1.3; background:var(--card-bg); padding:4px 6px; border-radius:4px; border:1px solid var(--card-border);"><strong>Scope:</strong> ${escH(scope)}</div>` : ''}
                  ${tagDisplay ? `<div style="font-size:0.7rem; color:var(--accent); font-weight:600;">🏷️ ${escH(tagDisplay)}</div>` : ''}
                  <div style="display:flex; justify-content:flex-end; margin-top:0.2rem;">
                    <button class="btn btn-primary" onclick="DailyReviewController.openCreateWorkstreamFromSuggestion(${wsIdx})" id="btn-dr-create-ws-${wsIdx}" style="padding:4px 10px; font-size:0.75rem; display:flex; align-items:center; gap:0.3rem;" title="${escA(t('dailyreview.createWorkstreamTooltip') || 'Create a dedicated workstream for this growing topic with pre-filled scope and tags')}">
                      + ${escH(t('dailyreview.createWorkstreamBtn') || 'Create Workstream')}
                    </button>
                  </div>
                `;
              }
              wsSection.appendChild(card);
            });
            sugList.appendChild(wsSection);
          }

          this.renderAISuggestionsList();
        }
      }
    } catch (e) {
      console.error('Failed to generate daily summary AI', e);
      toast("La génération du résumé par l'IA a échoué: " + e.message, true);
    } finally {
      if (loading) loading.style.display = 'none';
      if (editor) editor.style.opacity = '1';
      await this.autosaveAISummaryNote();
      await this.mountStep5NoteEditor();
      await this.refreshStep5SummariesList();
      this.processWorkstreamUpdatesInBackground(this.extractedWorkstreamUpdates || []);
    }
  },

  // ── FINAL STEP AGENT ALIASES ──
  // Ensures that calls to finalStep, finalstep, finalizeStep, or finalizeSummary
  // are always defined functions on DailyReviewController and route to the final agent.
  async finalStep(options = {}) {
    return this.generateAISummary(options);
  },

  async finalstep(options = {}) {
    return this.generateAISummary(options);
  },

  async finalizeStep(options = {}) {
    return this.generateAISummary(options);
  },

  async finalizeSummary(options = {}) {
    return this.generateAISummary(options);
  },

  renderAISuggestionsList() {
    const sugList = document.getElementById('dr-ai-suggestions-list');
    if (!sugList) return;

    // Check if workstream suggestions exist
    const isWsSuggestEnabled = window.settings?.ai?.workstreamSuggestions !== false;
    const hasWsSuggestions = isWsSuggestEnabled && Array.isArray(this.suggestedWorkstreams) && this.suggestedWorkstreams.length > 0;

    if (!Array.isArray(this.currentSuggestions) || this.currentSuggestions.length === 0) {
      if (!hasWsSuggestions) {
        sugList.innerHTML = `<div style="font-size:0.82rem; color:var(--text-muted); text-align:center; padding:1rem;">${t('dailyreview.noAISuggestions') || 'No action suggestions generated by AI.'}</div>`;
      }
      return;
    }

    this.currentSuggestions.forEach((item, index) => {
      const card = document.createElement('div');
      card.className = 'retro-item-card' + (item.isUpdate ? ' is-update' : '');
      card.id = `dr-ai-suggestion-card-${index}`;
      card.style.padding = '0.8rem';
      card.style.display = 'flex';
      card.style.flexDirection = 'column';
      card.style.gap = '0.6rem';
      card.style.border = item.isUpdate ? '1px solid var(--accent, #6366f1)' : '1px solid var(--card-border)';
      card.style.borderRadius = 'var(--radius-sm)';
      card.style.background = item.isUpdate ? 'var(--card-bg, #fff)' : 'var(--card-bg-alt)';
      
      const priorityBadgeColor = item.priority === 'High' ? 'var(--color-high, #ef4444)' : (item.priority === 'Low' ? 'var(--color-low, #10b981)' : 'var(--color-medium, #f59e0b)');
      
      const updateBadgeHtml = item.isUpdate
        ? `<span class="badge" style="font-size:0.65rem; background:rgba(99, 102, 241, 0.15); color:var(--accent, #6366f1); border:1px solid rgba(99, 102, 241, 0.35); padding:2px 6px; border-radius:3px; text-transform:uppercase; font-weight:700; white-space:nowrap;">${escH(t('dailyreview.updateTask') || 'Update Task')}</span>`
        : '';
      const depHtml = item.dependsOn
        ? `<div style="font-size:0.72rem; color:var(--text-muted);">${escH(t('dailyreview.dependsOnLabel') || 'Depends on:')} <code>${escH(item.dependsOn)}</code></div>`
        : '';
      const reasonHtml = item.reason
        ? `<div style="font-size:0.72rem; color:var(--text-muted); font-style:italic;">${escH(item.reason)}</div>`
        : '';
      const btnLabel = item.isUpdate
        ? (t('dailyreview.updateTaskBtn') || 'Update Task')
        : (t('dailyreview.aiSuggestionBoardBtn') || '📋 Board');
      const btnTooltip = item.isUpdate
        ? (t('dailyreview.updateTaskTooltip') || 'Update existing task on the board with elevated priority and dependencies')
        : (t('dailyreview.aiSuggestionBoardBtn') || '📋 Board');

      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:0.5rem;">
          <div style="font-size:0.85rem; font-weight:600; color:var(--text); line-height:1.3; flex:1;">${escH(item.title)}</div>
          ${updateBadgeHtml}
        </div>
        ${depHtml}
        ${reasonHtml}
        <div style="font-size:0.75rem; color:var(--text-muted); display:flex; justify-content:space-between; align-items:center;">
          <span>⏱ ${item.duration} min</span>
          <span style="color:${priorityBadgeColor}; font-weight:bold; font-size:0.7rem; border:1px solid ${priorityBadgeColor}; padding:2px 6px; border-radius:3px; text-transform:uppercase;">${escH(item.priority)}</span>
        </div>
        <div id="btn-dr-ai-actions-${index}" style="display:flex; gap:0.5rem; margin-top:0.2rem;">
          <button class="btn ${item.isUpdate ? 'btn-primary' : 'btn-secondary'}" onclick="DailyReviewController.createTodoFromSuggestion(${index})" id="btn-dr-ai-todo-${index}" style="padding:4px 8px; font-size:0.72rem; flex:1; display:flex; align-items:center; justify-content:center; gap:0.2rem;" title="${escA(btnTooltip)}">
            ${escH(btnLabel)}
          </button>
          <button class="btn btn-secondary" onclick="DailyReviewController.planTimeFromSuggestion(${index})" id="btn-dr-ai-plan-${index}" style="padding:4px 8px; font-size:0.72rem; flex:1; display:flex; align-items:center; justify-content:center; gap:0.2rem;" title="${escA(t('dailyreview.aiSuggestionPlannerBtn') || '📅 Planner')}">
            ${escH(t('dailyreview.aiSuggestionPlannerBtn') || '📅 Planner')}
          </button>
        </div>
      `;
      sugList.appendChild(card);
    });
  },

  appendSuggestionToSummaryText(title, type) {
    const contentEl = document.getElementById('dr-ai-summary-content');
    const editArea = document.getElementById('edit-textarea');
    if (!contentEl) return;

    let html = contentEl.innerHTML;
    
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;

    const headings = Array.from(tempDiv.querySelectorAll('h3, h4, h2, p strong, p b, strong, b'));
    let pendingHeading = null;
    
    for (const h of headings) {
      const text = h.textContent.toLowerCase();
      if (text.includes('pending/new topics') || 
          text.includes('sujets en attente') || 
          text.includes('offene/neue themen') || 
          text.includes('en attente/nouveaux') ||
          text.includes('topics to tackle')) {
        pendingHeading = h;
        break;
      }
    }

    const activeLang = (typeof getAppLanguage === 'function') ? getAppLanguage() : 'fr';
    let typeLabel = 'Tâche';
    if (type === 'workstream') {
      typeLabel = activeLang === 'fr' ? 'Axe de travail' : activeLang === 'de' ? 'Themenfeld' : 'Workstream';
    } else if (type === 'session') {
      typeLabel = activeLang === 'fr' ? 'Session de travail' : activeLang === 'de' ? 'Arbeitssitzung' : 'Work session';
    } else {
      typeLabel = activeLang === 'fr' ? 'Tâche' : activeLang === 'de' ? 'Aufgabe' : 'Todo';
    }

    const newListItemHtml = `<li><strong>${typeLabel}</strong> : ${title}</li>`;

    if (pendingHeading) {
      let nextSibling = pendingHeading.nextElementSibling;
      if (!nextSibling && pendingHeading.parentElement && pendingHeading.parentElement !== tempDiv) {
        nextSibling = pendingHeading.parentElement.nextElementSibling;
      }

      let listEl = null;
      let siblingToCheck = nextSibling;
      for (let i = 0; i < 3 && siblingToCheck; i++) {
        if (siblingToCheck.tagName === 'UL' || siblingToCheck.tagName === 'OL') {
          listEl = siblingToCheck;
          break;
        }
        siblingToCheck = siblingToCheck.nextElementSibling;
      }

      if (listEl) {
        listEl.innerHTML += `\n${newListItemHtml}`;
      } else {
        const newList = document.createElement('ul');
        newList.innerHTML = newListItemHtml;
        pendingHeading.insertAdjacentElement('afterend', newList);
      }
    } else {
      const sectionHeading = activeLang === 'fr' ? 'Sujets en attente/nouveaux à aborder' : activeLang === 'de' ? 'Offene/Neue Themen anzugehen' : 'Pending/New Topics to Tackle';
      
      const newSection = document.createElement('div');
      newSection.innerHTML = `<h3 style="margin-top: 1rem; margin-bottom: 0.5rem;">${sectionHeading}</h3><ul>${newListItemHtml}</ul>`;
      tempDiv.appendChild(newSection);
    }

    const updatedHTML = tempDiv.innerHTML;
    if (contentEl) contentEl.innerHTML = updatedHTML;
    if (editArea) editArea.innerHTML = updatedHTML;
    const reviewDateStr = this.getReviewDateValue();
    const isCurrentNoteSummary = (typeof currentNote !== 'undefined' && currentNote && 
      (currentNote.id === `summary-${reviewDateStr}` || currentNote.path === `notes/daily-summary-${reviewDateStr}.html`));
    if (isCurrentNoteSummary) {
      currentNote.mainHTML = updatedHTML;
    }
    this.scheduleAutosaveAISummaryNote();
  },

  scheduleAutosaveAISummaryNote(delay = 1500) {
    if (this._autosaveSummaryTimer) clearTimeout(this._autosaveSummaryTimer);
    this._autosaveSummaryTimer = setTimeout(() => {
      this._autosaveSummaryTimer = null;
      this.autosaveAISummaryNote();
    }, delay);
  },

  async autosaveAISummaryNote() {
    const editArea = document.getElementById('edit-textarea');
    const contentTextarea = document.getElementById('dr-ai-summary-content');
    const titleInput = document.getElementById('dr-ai-summary-title');
    
    const reviewDateStr = this.getReviewDateValue();
    const defaultTitle = this.getDefaultDailySummaryTitle();
    const isCurrentNoteSummary = (typeof currentNote !== 'undefined' && currentNote && 
      (currentNote.id === `summary-${reviewDateStr}` || currentNote.path === `notes/daily-summary-${reviewDateStr}.html`));

    const rawTitle = (titleInput && titleInput.value.trim()) 
      || (isCurrentNoteSummary && currentNote.title ? currentNote.title : null)
      || defaultTitle;
    const title = this.isMeetingTitle(rawTitle) ? defaultTitle : rawTitle;

    const contentHTML = (editArea && editArea.innerHTML.trim()) 
      || (isCurrentNoteSummary && currentNote.mainHTML ? currentNote.mainHTML : '')
      || (contentTextarea ? contentTextarea.innerHTML.trim() : '');
    
    if (!contentHTML || contentHTML === '<p><br></p>' || contentHTML === '<p></p>') {
      return;
    }

    try {
      const summaryPath = `notes/daily-summary-${reviewDateStr}.html`;
      
      const newHTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="group-tags" content="Summary">
  <meta name="major-topic-tags" content="Daily Summary">
  <meta name="topic-tags" content="">
  <meta name="extra-tags" content="">
  <title>${title}</title>
</head>
<body>
  <main>
    ${contentHTML}
  </main>
</body>
</html>`;

      if (typeof StorageAPI !== 'undefined' && typeof StorageAPI.writeNoteContent === 'function') {
        await StorageAPI.writeNoteContent(summaryPath, newHTML);
      }
      
      const manifestItem = {
        id: `summary-${reviewDateStr}`,
        path: summaryPath,
        title: title,
        date: reviewDateStr,
        group_tags: ["Summary"],
        major_topic_tags: ["Daily Summary"],
        topic_tags: [],
        extra_tags: [],
        summary: contentHTML.slice(0, 500),
        preview: (typeof htmlToPlainText === 'function' ? htmlToPlainText(contentHTML) : contentHTML.replace(/<[^>]*>/g, '')).slice(0, 300),
        reviewed: true,
        modified: new Date().toISOString()
      };

      if (typeof manifest !== 'undefined' && Array.isArray(manifest)) {
        const mfIdx = manifest.findIndex(item => item.path === summaryPath);
        if (mfIdx !== -1) {
          manifest[mfIdx] = { ...manifest[mfIdx], ...manifestItem };
        } else {
          manifest.push(manifestItem);
        }
      }
      
      if (typeof saveManifest === 'function') {
        await saveManifest();
      }
    } catch (err) {
      console.warn('Autosave daily summary note failed:', err);
    }
  },

  handleRegenerateClick() {
    const contentEl = document.getElementById('dr-ai-summary-content');
    const editArea = document.getElementById('edit-textarea');
    const hasSummary = (editArea && editArea.textContent.trim().length > 0) || (contentEl && contentEl.textContent.trim().length > 0);
    
    if (hasSummary) {
      const popover = document.getElementById('dr-ai-regenerate-popover');
      if (popover) {
        popover.style.display = 'flex';
        const textarea = document.getElementById('dr-ai-regenerate-context');
        if (textarea) {
          textarea.value = '';
          textarea.focus();
        }
        const wsCb = document.getElementById('dr-ai-regen-suggest-workstreams');
        if (wsCb) {
          wsCb.checked = window.settings?.ai?.suggestWorkstreams !== false;
        }
      }
    } else {
      this.generateAISummary({ force: true });
    }
  },
  
  hideRegeneratePopover() {
    const popover = document.getElementById('dr-ai-regenerate-popover');
    if (popover) {
      popover.style.display = 'none';
    }
  },
  
  async submitRegenerateWithContext() {
    this.cancelWorkstreamUpdates();
    const textarea = document.getElementById('dr-ai-regenerate-context');
    const context = textarea ? textarea.value.trim() : '';
    const wsCb = document.getElementById('dr-ai-regen-suggest-workstreams');
    const suggestWs = wsCb ? wsCb.checked : (window.settings?.ai?.suggestWorkstreams !== false);
    this.hideRegeneratePopover();
    await this.generateAISummary({ force: true, context: context, suggestWorkstreams: suggestWs });
  },

  cancelAISummaryGeneration() {
    this.cancelWorkstreamUpdates();
    if (this.aiAbortController) {
      this.aiAbortController.abort();
    }
  },

  async saveAISummaryNote() {
    const editArea = document.getElementById('edit-textarea');
    const contentTextarea = document.getElementById('dr-ai-summary-content');
    const titleInput = document.getElementById('dr-ai-summary-title');
    
    const reviewDateStr = this.getReviewDateValue();
    const defaultTitle = this.getDefaultDailySummaryTitle();
    const isCurrentNoteSummary = (typeof currentNote !== 'undefined' && currentNote && 
      (currentNote.id === `summary-${reviewDateStr}` || currentNote.path === `notes/daily-summary-${reviewDateStr}.html`));

    const rawTitle = (titleInput && titleInput.value.trim()) 
      || (isCurrentNoteSummary && currentNote.title ? currentNote.title : null)
      || defaultTitle;
    const title = this.isMeetingTitle(rawTitle) ? defaultTitle : rawTitle;

    const contentHTML = (editArea && editArea.innerHTML.trim()) 
      || (isCurrentNoteSummary && currentNote.mainHTML ? currentNote.mainHTML : '')
      || (contentTextarea ? contentTextarea.innerHTML.trim() : '');
    
    if (!contentHTML || contentHTML === '<p><br></p>' || contentHTML === '<p></p>') {
      toast(t('dailyreview.emptySummaryWarning') || "Veuillez saisir un contenu pour le résumé quotidien.", true);
      return false;
    }
    
    const summaryPath = `notes/daily-summary-${reviewDateStr}.html`;
    
    try {
      const newHTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="group-tags" content="Summary">
  <meta name="major-topic-tags" content="Daily Summary">
  <meta name="topic-tags" content="">
  <meta name="extra-tags" content="">
  <title>${title}</title>
</head>
<body>
  <main>
    ${contentHTML}
  </main>
</body>
</html>`;
      
      if (typeof StorageAPI !== 'undefined' && typeof StorageAPI.writeNoteContent === 'function') {
        await StorageAPI.writeNoteContent(summaryPath, newHTML);
      }
      
      const date = this.getReviewDateValue();
      const manifestItem = {
        id: `summary-${date}`,
        path: summaryPath,
        title: title,
        date: date,
        group_tags: ["Summary"],
        major_topic_tags: ["Daily Summary"],
        topic_tags: [],
        extra_tags: [],
        summary: contentHTML.slice(0, 500),
        preview: (typeof htmlToPlainText === 'function' ? htmlToPlainText(contentHTML) : contentHTML.replace(/<[^>]*>/g, '')).slice(0, 300),
        reviewed: true,
        modified: new Date().toISOString()
      };
      
      const mfIdx = manifest.findIndex(item => item.path === summaryPath);
      if (mfIdx !== -1) {
        manifest[mfIdx] = { ...manifest[mfIdx], ...manifestItem };
      } else {
        manifest.push(manifestItem);
      }
      
      await saveManifest({ force: true });
      await rebuildIndexHTML();
      
      if (typeof notifyDailyReviewNoteChanged === 'function') {
        notifyDailyReviewNoteChanged(summaryPath, { date, noteId: manifestItem.id });
      }
      
      toast(t('dailyreview.summarySavedToast') || "Résumé quotidien enregistré avec succès !");
      return true;
    } catch (e) {
      console.error('Failed to save daily summary note', e);
      toast("Erreur lors de la sauvegarde du résumé quotidien : " + e.message, true);
      return false;
    }
  },

  async createTodoFromSuggestion(index) {
    if (!Array.isArray(this.currentSuggestions) || !this.currentSuggestions[index]) return;
    const item = this.currentSuggestions[index];
    const manifestList = (typeof todosManifest !== 'undefined' && Array.isArray(todosManifest)) ? todosManifest : [];
    const date = new Date().toISOString().slice(0, 10);
    const cleanTitle = (item.title || '').trim();
    const cleanTitleLow = cleanTitle.toLowerCase();

    // Check if a matching open todo already exists in the manifest
    const existingTodo = manifestList.find(t =>
      t && t.priority !== 'Done' && (
        (item.targetTodoId && t.id === item.targetTodoId) ||
        (item.todoId && t.id === item.todoId) ||
        (t.title && t.title.trim().toLowerCase() === cleanTitleLow)
      )
    );

    if (existingTodo) {
      item.todoId = existingTodo.id;
      existingTodo.priority = 'High';
      existingTodo.eisenhowerQuadrant = 'Q1';
      if (typeof existingTodo.eisenhowerY === 'number') {
        existingTodo.eisenhowerY = Math.min(existingTodo.eisenhowerY, 25);
      }
      // Add dependency if specified and not circular
      if (item.dependsOn) {
        if (!Array.isArray(existingTodo.depends_on)) existingTodo.depends_on = [];
        const candidatePrereqId = item.dependsOn;
        let isValid = true;
        if (typeof TaskGraphEngine !== 'undefined' && typeof TaskGraphEngine.validateNoCircularDependency === 'function') {
          const res = TaskGraphEngine.validateNoCircularDependency(existingTodo.id, candidatePrereqId);
          if (res && res.valid === false) isValid = false;
        }
        if (isValid && !existingTodo.depends_on.includes(candidatePrereqId)) {
          existingTodo.depends_on.push(candidatePrereqId);
        }
      }
      existingTodo.modified = date;
      if (typeof saveTodosManifest === 'function') await saveTodosManifest();
      if (typeof refreshTodoViews === 'function') refreshTodoViews();

      // Trigger targeted event that daily review note / item changed
      const reviewDateStr = this.getReviewDateValue();
      const summaryPath = `notes/daily-summary-${reviewDateStr}.html`;
      if (typeof notifyDailyReviewNoteChanged === 'function') {
        notifyDailyReviewNoteChanged(summaryPath, { todoId: existingTodo.id, date: reviewDateStr });
      }

      const actionsRow = document.getElementById(`btn-dr-ai-actions-${index}`);
      if (actionsRow) {
        const elevatedLabel = t('dailyreview.aiSuggestionUpdated') || '✓ Priority Elevated';
        const openLabel = t('dailyreview.aiSuggestionOpenTask') || 'Click to open task';
        actionsRow.innerHTML = `
          <div style="display:flex; align-items:center; gap:0.5rem; width:100%; background:var(--card-bg); border:1px solid var(--card-border); border-radius:var(--radius-sm); padding:5px 8px; cursor:pointer; font-size:0.78rem;" 
               title="${escA(openLabel)}"
               role="button"
               tabindex="0"
               onclick="if(typeof openTodoOverlay === 'function') openTodoOverlay(${JSON.stringify(existingTodo.id)})">
            <span style="color:var(--color-high, #ef4444); font-weight:700;">${escH(elevatedLabel)}</span>
            <span style="color:var(--text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;">⭐ 📋 ${escH(existingTodo.title)}</span>
            <span style="font-size:0.65rem; color:var(--text-muted); flex-shrink:0;">${escH(openLabel)}</span>
          </div>
        `;
      }
      toast(t('dailyreview.aiSuggestionUpdatedToast', { title: existingTodo.title }) || `Importance & priority elevated for: ${existingTodo.title}`);
      this.appendSuggestionToSummaryText(existingTodo.title, 'todo');
      return;
    }
    
    const todoId = item.todoId || 'todo-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    item.todoId = todoId;

    let x = null;
    let y = null;

    if (typeof item.eisenhowerX === 'number' && Number.isFinite(item.eisenhowerX)) {
      x = Math.max(0, Math.min(100, item.eisenhowerX));
    } else if (typeof item.urgencyPct === 'number' && Number.isFinite(item.urgencyPct)) {
      x = Math.max(0, Math.min(100, 100 - item.urgencyPct));
    }

    if (typeof item.eisenhowerY === 'number' && Number.isFinite(item.eisenhowerY)) {
      y = Math.max(0, Math.min(100, item.eisenhowerY));
    } else if (typeof item.importancePct === 'number' && Number.isFinite(item.importancePct)) {
      y = Math.max(0, Math.min(100, 100 - item.importancePct));
    }

    let quadrant = item.quadrant || item.eisenhowerQuadrant;
    if (!quadrant && x !== null && y !== null && typeof EisenhowerUtils !== 'undefined' && EisenhowerUtils.getQuadrantFromCoords) {
      quadrant = EisenhowerUtils.getQuadrantFromCoords(x, y);
    }
    if (!quadrant) quadrant = (item.priority === "High" ? "Q1" : (item.askedBy ? "Q2" : (item.priority === "Low" ? "Q3" : "Q2")));

    if (x === null || y === null) {
      const def = (typeof EisenhowerUtils !== 'undefined' && EisenhowerUtils.getDefaultCoordsForQuadrant)
        ? EisenhowerUtils.getDefaultCoordsForQuadrant(quadrant, todoId || item.title)
        : { x: quadrant === 'Q1' || quadrant === 'Q3' ? 25 : 75, y: quadrant === 'Q1' || quadrant === 'Q2' ? 25 : 75 };
      if (x === null) x = def.x;
      if (y === null) y = def.y;
    }

    const priority = (typeof EisenhowerUtils !== 'undefined' && EisenhowerUtils.getPriorityForQuadrant)
      ? EisenhowerUtils.getPriorityForQuadrant(quadrant)
      : (item.priority || "Medium");

    const ownerUser = item.owner || item.assignee || window.settings?.username || 'me';
    const reporterUser = item.askedBy || item.reporter || '';

    const todo = {
      id: todoId,
      title: (item.title || '').slice(0, 120),
      priority: priority,
      eisenhowerQuadrant: quadrant,
      eisenhowerX: Math.round(x * 10) / 10,
      eisenhowerY: Math.round(y * 10) / 10,
      ownerId: (typeof resolveColleagueId === 'function' ? resolveColleagueId(ownerUser, { allowMe: true }) : 'me') || "me",
      owner: ownerUser,
      askedById: (typeof resolveColleagueId === 'function' ? resolveColleagueId(reporterUser) : '') || "",
      askedBy: reporterUser,
      dueDate: item.dueDate || "",
      noteId: item.noteId || "",
      noteTodoMarkerId: todoId,
      depends_on: item.dependsOn ? [item.dependsOn] : [],
      context: item.context || "Daily review suggestion",
      created: date,
      modified: date
    };
    
    try {
      if (!manifestList.some(t => t && t.id === todoId)) {
        manifestList.push(todo);
        if (typeof saveTodosManifest === 'function') await saveTodosManifest();
      }
      if (typeof refreshTodoViews === 'function') refreshTodoViews();
      
      const reviewDateStr = this.getReviewDateValue();
      const summaryPath = `notes/daily-summary-${reviewDateStr}.html`;
      if (typeof notifyDailyReviewNoteChanged === 'function') {
        notifyDailyReviewNoteChanged(summaryPath, { todoId: todo.id, date: reviewDateStr });
      }
      
      // Replace action buttons with an interactive task chip
      const actionsRow = document.getElementById(`btn-dr-ai-actions-${index}`);
      if (actionsRow) {
        const createdLabel = t('dailyreview.aiSuggestionCreated') || '✓ Created';
        const openLabel = t('dailyreview.aiSuggestionOpenTask') || 'Click to open task';
        actionsRow.innerHTML = `
          <div style="display:flex; align-items:center; gap:0.5rem; width:100%; background:var(--card-bg); border:1px solid var(--card-border); border-radius:var(--radius-sm); padding:5px 8px; cursor:pointer; font-size:0.78rem;" 
               title="${escA(openLabel)}"
               role="button"
               tabindex="0"
               onclick="if(typeof openTodoOverlay === 'function') openTodoOverlay(${JSON.stringify(item.todoId)})">
            <span style="color:var(--accent); font-weight:600;">${escH(createdLabel)}</span>
            <span style="color:var(--text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;">📋 ${escH(item.title)}</span>
            <span style="font-size:0.65rem; color:var(--text-muted); flex-shrink:0;">${escH(openLabel)}</span>
          </div>
        `;
      }
      toast(t('dailyreview.aiSuggestionBoardBtn') ? (t('dailyreview.aiSuggestionCreated') + ' — ' + item.title).slice(0, 80) : '✓ Task added to Board');
      this.appendSuggestionToSummaryText(item.title, 'todo');
    } catch (e) {
      toast(e.message, true);
    }
  },
  
  async planTimeFromSuggestion(index) {
    if (!Array.isArray(this.currentSuggestions) || !this.currentSuggestions[index]) return;
    const item = this.currentSuggestions[index];
    const manifestList = (typeof todosManifest !== 'undefined' && Array.isArray(todosManifest)) ? todosManifest : [];
    const date = new Date().toISOString().slice(0, 10);
    const cleanTitle = (item.title || '').trim();
    const cleanTitleLow = cleanTitle.toLowerCase();

    try {
      const targetDate = new Date(this.getReviewDateValue());
      targetDate.setDate(targetDate.getDate() + 1);
      
      const jsDay = targetDate.getDay();
      if (jsDay === 6) targetDate.setDate(targetDate.getDate() + 2);
      else if (jsDay === 0) targetDate.setDate(targetDate.getDate() + 1);
      
      const dateStr = formatLocalDateValue(targetDate);
      
      const workStart = window.settings?.ui?.workStartTime || "09:00";
      const workEnd = window.settings?.ui?.workEndTime || "17:00";
      
      const [startH, startM] = workStart.split(':').map(Number);
      const [endH, endM] = workEnd.split(':').map(Number);
      
      let startMin = (startH || 9) * 60 + (startM || 0);
      const endMin = (endH || 17) * 60 + (endM || 0);
      const durationMinutes = item.duration || 30;
      
      const eventsList = (typeof plannerEvents !== 'undefined' && Array.isArray(plannerEvents)) ? plannerEvents : [];
      const dayEvents = eventsList.filter(e => e && e.date === dateStr);
      
      const parseMin = (tStr, isEnd = false) => {
        if (typeof timeToMinutes === 'function') return timeToMinutes(tStr, isEnd);
        if (!tStr) return NaN;
        const parts = tStr.split(':').map(Number);
        return parts[0] * 60 + (parts[1] || 0);
      };

      const busySlots = dayEvents.map(e => {
        const start = parseMin(e.startTime);
        const end = (isNaN(parseMin(e.endTime, true)) ? start + Number(e.duration || 30) : parseMin(e.endTime, true));
        return { start, end };
      }).filter(s => !isNaN(s.start) && !isNaN(s.end))
        .sort((a, b) => a.start - b.start);
      
      let chosenStart = startMin;
      for (const slot of busySlots) {
        if (chosenStart + durationMinutes <= slot.start) {
          break;
        }
        chosenStart = Math.max(chosenStart, slot.end);
      }
      
      if (chosenStart + durationMinutes > endMin) {
        chosenStart = busySlots.length > 0 ? busySlots[busySlots.length - 1].end : startMin;
      }
      
      const startTime = formatMinutesToHHMM(chosenStart);
      const endTime = formatMinutesToHHMM(chosenStart + durationMinutes);
      
      // Check if a matching open todo already exists in the manifest
      let existingTodo = manifestList.find(t =>
        t && t.priority !== 'Done' && (
          (item.todoId && t.id === item.todoId) ||
          (t.title && t.title.trim().toLowerCase() === cleanTitleLow)
        )
      );

      let todoId;
      if (existingTodo) {
        existingTodo.priority = 'High';
        existingTodo.eisenhowerQuadrant = 'Q1';
        if (typeof existingTodo.eisenhowerY === 'number') {
          existingTodo.eisenhowerY = Math.min(existingTodo.eisenhowerY, 25);
        }
        existingTodo.dueDate = dateStr;
        existingTodo.modified = date;
        if (typeof saveTodosManifest === 'function') await saveTodosManifest();
        if (typeof refreshTodoViews === 'function') refreshTodoViews();
        todoId = existingTodo.id;
        item.todoId = todoId;
      } else {
        todoId = item.todoId || (typeof generateUniqueId === 'function' ? generateUniqueId('todo') : ('todo-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)));
        item.todoId = todoId;

        const quadrant = item.quadrant || item.eisenhowerQuadrant || (item.priority === "High" ? "Q1" : "Q2");
        const priority = (typeof EisenhowerUtils !== 'undefined' && EisenhowerUtils.getPriorityForQuadrant)
          ? EisenhowerUtils.getPriorityForQuadrant(quadrant)
          : (item.priority || "Medium");

        const ownerUser = item.owner || item.assignee || window.settings?.username || 'me';
        const reporterUser = item.askedBy || item.reporter || '';

        const todo = {
          id: todoId,
          title: (item.title || '').slice(0, 120),
          priority: priority,
          eisenhowerQuadrant: quadrant,
          ownerId: (typeof resolveColleagueId === 'function' ? resolveColleagueId(ownerUser, { allowMe: true }) : 'me') || "me",
          owner: ownerUser,
          askedById: (typeof resolveColleagueId === 'function' ? resolveColleagueId(reporterUser) : '') || "",
          askedBy: reporterUser,
          dueDate: dateStr,
          noteId: item.noteId || "",
          noteTodoMarkerId: todoId,
          context: item.context || "Daily review suggestion",
          created: date,
          modified: date
        };

        if (!manifestList.some(t => t && t.id === todoId)) {
          manifestList.push(todo);
          if (typeof saveTodosManifest === 'function') await saveTodosManifest();
        }
        if (typeof refreshTodoViews === 'function') refreshTodoViews();
      }

      const newEvent = {
        id: 'evt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        type: 'todo',
        title: item.title,
        date: dateStr,
        startTime: startTime,
        endTime: endTime,
        duration: durationMinutes,
        description: 'Suggested action from Daily Review.',
        todoId: todoId
      };
      item.eventId = newEvent.id;
      
      eventsList.push(newEvent);
      if (typeof savePlanner === 'function') await savePlanner();
      if (typeof renderPlanner === 'function') renderPlanner();

      // Replace action buttons with a planner confirmation chip
      const actionsRow = document.getElementById(`btn-dr-ai-actions-${index}`);
      if (actionsRow) {
        const createdLabel = existingTodo ? (t('dailyreview.aiSuggestionUpdated') || '✓ Priority Elevated') : (t('dailyreview.aiSuggestionCreated') || '✓ Created');
        const openBlockTooltip = t('dailyreview.aiSuggestionOpenBlock') || 'Click to edit planned block';
        actionsRow.innerHTML = `
          <div style="display:flex; align-items:center; gap:0.5rem; width:100%; background:var(--card-bg); border:1px solid var(--card-border); border-radius:var(--radius-sm); padding:5px 8px; cursor:pointer; font-size:0.78rem;"
               title="${escA(openBlockTooltip)}"
               role="button"
               tabindex="0"
               onclick="DailyReviewController.openPlanEventFromSuggestion(${JSON.stringify(newEvent.id)}, ${JSON.stringify(item.todoId || '')}, ${index})">
            <span style="color:var(--accent); font-weight:600;">${escH(createdLabel)}</span>
            <span id="dr-ai-planned-text-${index}" style="color:var(--text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;">📅 ${escH(startTime)}–${escH(endTime)}: ${escH(item.title)}</span>
            <span style="font-size:0.75rem; color:var(--text-muted); flex-shrink:0;">✏️</span>
          </div>
        `;
      }
      const activeLang = (typeof getAppLanguage === 'function') ? getAppLanguage() : 'fr';
      const toastPlanText = activeLang === 'fr'
        ? `Planifié le ${dateStr} de ${startTime} à ${endTime}`
        : (activeLang === 'de' ? `Geplant am ${dateStr} von ${startTime} bis ${endTime}` : `Planned on ${dateStr} from ${startTime} to ${endTime}`);
      toast(toastPlanText);
      this.appendSuggestionToSummaryText(item.title, 'session');
    } catch (e) {
      toast(e.message, true);
    }
  },

  openPlanEventFromSuggestion(eventId, todoId, index) {
    if (!eventId) {
      if (todoId && typeof openTodoOverlay === 'function') {
        openTodoOverlay(todoId);
      }
      return;
    }
    const ev = (Array.isArray(plannerEvents) ? plannerEvents.find(e => e && e.id === eventId) : null)
      || (typeof window !== 'undefined' && Array.isArray(window.plannerEvents) ? window.plannerEvents.find(e => e && e.id === eventId) : null);
    if (ev && typeof openPlanEventModal === 'function') {
      openPlanEventModal(ev);
      if (index !== undefined && index !== null) {
        const checkInterval = setInterval(() => {
          const modal = document.getElementById('planner-dynamic-modal');
          if (!modal) {
            clearInterval(checkInterval);
            const updatedEv = (Array.isArray(plannerEvents) ? plannerEvents.find(e => e && e.id === eventId) : null)
              || (typeof window !== 'undefined' && Array.isArray(window.plannerEvents) ? window.plannerEvents.find(e => e && e.id === eventId) : null);
            if (updatedEv) {
              const chipTextEl = document.getElementById(`dr-ai-planned-text-${index}`);
              if (chipTextEl) {
                const sTime = updatedEv.startTime || '';
                const eTime = updatedEv.endTime || '';
                const timing = (sTime && eTime) ? `${sTime}–${eTime}: ` : '';
                chipTextEl.textContent = `📅 ${timing}${updatedEv.title || ''}`;
              }
            }
          }
        }, 400);
      }
      return;
    }
    if (todoId && typeof openTodoOverlay === 'function') {
      openTodoOverlay(todoId);
    }
  },

  openCreateWorkstreamFromSuggestion(index) {
    if (!Array.isArray(this.suggestedWorkstreams) || !this.suggestedWorkstreams[index]) return;
    const item = this.suggestedWorkstreams[index];
    const initialData = {
      topicName: item.topic_name || item.workstream || item.title || '',
      scope: item.scope || '',
      tags: item.tags || {},
      onCreated: (createdName) => this.onWorkstreamCreatedFromSuggestion(index, createdName)
    };
    if (typeof openCreateWorkstreamModal === 'function') {
      openCreateWorkstreamModal(initialData);
    } else {
      console.warn('openCreateWorkstreamModal function not found');
    }
  },

  onWorkstreamCreatedFromSuggestion(index, createdName) {
    if (!Array.isArray(this.suggestedWorkstreams) || !this.suggestedWorkstreams[index]) return;
    const item = this.suggestedWorkstreams[index];
    const finalName = createdName || item.topic_name || item.workstream || item.title || 'Workstream';
    item.created = true;
    item.createdName = finalName;

    // 1. Refresh suggestion card to interactive confirmation chip
    const cardEl = document.getElementById(`dr-suggested-ws-${index}`);
    if (cardEl) {
      const createdBadge = t('dailyreview.workstreamCreatedBadge') || 'Workstream Created';
      const openTooltip = t('dailyreview.openCreatedWorkstreamTooltip') || 'Click to open this workstream dossier';
      const taskTooltip = t('dailyreview.createTaskForWorkstreamTooltip') || 'Create a task linked to this workstream';
      const planTooltip = t('dailyreview.planEventForWorkstreamTooltip') || 'Plan a time block in the planner for this workstream';

      cardEl.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:0.4rem;">
          <div style="font-size:0.85rem; font-weight:700; color:var(--text); line-height:1.3; cursor:pointer;" 
               onclick="DailyReviewController.openWorkstreamDossier(${JSON.stringify(finalName)})"
               title="${escA(openTooltip)}">
            <span style="color:var(--accent);">📂</span> ${escH(finalName)}
          </div>
          <span class="badge" style="font-size:0.65rem; background:rgba(34, 197, 94, 0.15); color:#22c55e; border:1px solid rgba(34, 197, 94, 0.4); padding:2px 6px; border-radius:3px; font-weight:600; white-space:nowrap;">
            ✓ ${escH(createdBadge)}
          </span>
        </div>
        ${item.scope ? `<div style="font-size:0.75rem; color:var(--text-muted); line-height:1.3;">${escH(item.scope)}</div>` : ''}
        <div style="display:flex; align-items:center; justify-content:flex-end; gap:0.4rem; margin-top:0.2rem;">
          <button class="btn btn-secondary" onclick="DailyReviewController.createTodoForWorkstream(${JSON.stringify(finalName)})" style="padding:3px 8px; font-size:0.72rem; display:flex; align-items:center; gap:0.25rem;" title="${escA(taskTooltip)}">
            + 📋 ${escH(t('dailyreview.aiSuggestionBoardBtn') || 'Task')}
          </button>
          <button class="btn btn-secondary" onclick="DailyReviewController.planEventForWorkstream(${JSON.stringify(finalName)})" style="padding:3px 8px; font-size:0.72rem; display:flex; align-items:center; gap:0.25rem;" title="${escA(planTooltip)}">
            + 📅 ${escH(t('dailyreview.aiSuggestionPlannerBtn') || 'Plan')}
          </button>
        </div>
      `;
    }

    // 2. Append to daily review summary text
    this.appendSuggestionToSummaryText(finalName, 'workstream');

    // 3. Refresh Step 5 Workstreams tab & count badge
    if (!this.workstreamUpdateStatuses) {
      this.workstreamUpdateStatuses = [];
    }
    const alreadyPresent = this.workstreamUpdateStatuses.some(w => (w.workstream || w.name) === finalName);
    if (!alreadyPresent) {
      this.workstreamUpdateStatuses.push({
        workstream: finalName,
        status: 'synced',
        summary: item.scope || `Workstream created from daily review suggestion.`
      });
    }
    this.renderStep5WorkstreamUpdatesList();

    // 4. Force reload topic memory catalogs
    if (typeof WorkstreamMemoryEngine !== 'undefined' && typeof WorkstreamMemoryEngine.getTopicMemoriesCatalog === 'function') {
      WorkstreamMemoryEngine.getTopicMemoriesCatalog({ force: true }).catch(() => {});
    }
  },

  async createTodoForWorkstream(wsName) {
    if (!wsName) return;
    const todoId = 'todo_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const date = new Date().toISOString().slice(0, 10);
    const title = `${wsName}: Follow-up`;
    const todo = {
      id: todoId,
      title: title,
      priority: 'Medium',
      eisenhowerQuadrant: 'Q2',
      eisenhowerX: 75,
      eisenhowerY: 25,
      ownerId: (typeof resolveColleagueId === 'function' ? resolveColleagueId('me', { allowMe: true }) : 'me') || "me",
      owner: window.settings?.username || 'me',
      askedById: '',
      askedBy: '',
      dueDate: '',
      context: `Workstream: ${wsName}`,
      created: date,
      modified: date
    };
    const manifestList = (typeof todosManifest !== 'undefined' && Array.isArray(todosManifest)) ? todosManifest : [];
    manifestList.push(todo);
    if (typeof saveTodosManifest === 'function') await saveTodosManifest();
    if (typeof refreshTodoViews === 'function') refreshTodoViews();
    toast(`✓ ${t('dailyreview.aiSuggestionCreated') || 'Task created'}: "${title}"`);
    if (typeof openTodoOverlay === 'function') {
      openTodoOverlay(todoId);
    }
  },

  async planEventForWorkstream(wsName) {
    if (!wsName) return;
    const item = {
      title: `${wsName}: Deep Work`,
      duration: 45,
      priority: 'High',
      quadrant: 'Q2',
      workstream: wsName
    };
    if (!this.currentSuggestions) this.currentSuggestions = [];
    const idx = this.currentSuggestions.length;
    this.currentSuggestions.push(item);
    await this.planTimeFromSuggestion(idx);
  },

  toggleSuggestWorkstreams(enabled) {
    if (!window.settings) window.settings = {};
    if (!window.settings.ai) window.settings.ai = {};
    window.settings.ai.suggestWorkstreams = !!enabled;

    const prefsCb = document.getElementById('prefs-ai-suggest-workstreams');
    if (prefsCb) prefsCb.checked = !!enabled;

    const headerCb = document.getElementById('dr-toggle-suggest-ws');
    if (headerCb) headerCb.checked = !!enabled;

    const regenCb = document.getElementById('dr-ai-regen-suggest-workstreams');
    if (regenCb) regenCb.checked = !!enabled;

    const wsSection = document.querySelector('.dr-suggested-workstreams-section');
    if (wsSection) {
      wsSection.style.display = enabled ? 'flex' : 'none';
    }

    if (typeof saveLocalSettings === 'function') saveLocalSettings();
    if (typeof saveFolderSettingsDebounced === 'function') saveFolderSettingsDebounced();
  }
};

// Expose functions globally for app.html event handlers
window.startDailyReview = (reviewDateValue = null, targetStep = 0) => DailyReviewController.start(reviewDateValue, targetStep);
window.startDailyReviewForSelectedDate = () => DailyReviewController.startForSelectedDate();
window.confirmQuitDailyReview = () => DailyReviewController.confirmQuit();
window.navigateDailyReviewStep = (dir) => DailyReviewController.navigateStep(dir);
window.commitDailyReviewFinal = () => DailyReviewController.commitFinal();
window.switchStep5Tab = (tabName) => DailyReviewController.switchStep5Tab(tabName);
window.refreshStep5SummariesList = () => DailyReviewController.refreshStep5SummariesList();
window.openStandaloneNoteReader = (path) => DailyReviewController.openStandaloneNoteReader(path);
window.DailyReviewController = DailyReviewController;
window.toggleSuggestWorkstreams = (enabled) => DailyReviewController.toggleSuggestWorkstreams(enabled);
window.finalStep = (options) => DailyReviewController.finalStep(options);
window.finalstep = (options) => DailyReviewController.finalstep(options);
window.finalizeStep = (options) => DailyReviewController.finalizeStep(options);
window.finalizeSummary = (options) => DailyReviewController.finalizeSummary(options);
