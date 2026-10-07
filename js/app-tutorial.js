'use strict';

// ── Secretary: Interactive Tutorial Controller ──

const TutorialController = {
  currentStep: 0,
  isActive: false,
  overlayEl: null,
  focusRingEl: null,
  popoverEl: null,
  resizeObserver: null,

  steps: [
    {
      titleKey: 'tutorial.step1Title',
      textKey: 'tutorial.step1Text',
      selector: null,
      tab: null
    },
    {
      titleKey: 'tutorial.step2Title',
      textKey: 'tutorial.step2Text',
      selector: '#tab-planner',
      tab: 'planner'
    },
    {
      titleKey: 'tutorial.step3Title',
      textKey: 'tutorial.step3Text',
      selector: '#tab-notes',
      tab: 'notes'
    },
    {
      titleKey: 'tutorial.step4Title',
      textKey: 'tutorial.step4Text',
      selector: '.topbar-title-wrap',
      tab: null
    },
    {
      titleKey: 'tutorial.step5Title',
      textKey: 'tutorial.step5Text',
      selector: '#tab-todos-mode',
      tab: 'todos'
    },
    {
      titleKey: 'tutorial.step6Title',
      textKey: 'tutorial.step6Text',
      selector: '#tab-team',
      tab: 'team'
    },
    {
      titleKey: 'tutorial.step7Title',
      textKey: 'tutorial.step7Text',
      selector: '#tab-retro',
      tab: 'retro'
    },
    {
      titleKey: 'tutorial.step8Title',
      textKey: 'tutorial.step8Text',
      selector: '#tab-daily-review-btn',
      tab: null
    },
    {
      titleKey: 'tutorial.step9Title',
      textKey: 'tutorial.step9Text',
      selector: '#btn-topbar-ai',
      tab: null
    },
    {
      titleKey: 'tutorial.aiSetupTitle',
      textKey: 'tutorial.aiSetupText',
      selector: '#prefs-sec-ai',
      tab: 'prefs',
      onShow: () => {
        if (typeof switchPrefsTab === 'function') switchPrefsTab('ai');
      }
    },
    {
      titleKey: 'tutorial.step11Title',
      textKey: 'tutorial.step11Text',
      selector: null,
      tab: null
    }
  ],

  startDayOnboarding() {
    this.start();
  },

  start() {
    if (this.isActive) return;
    this.isActive = true;
    this.currentStep = 0;
    
    // Set active class on tutorial button
    const btn = document.getElementById('btn-tutorial-icon');
    if (btn) btn.classList.add('active');

    // Create DOM structure
    this.createDomElements();
    this.goToStep(0);

    // Watch for window resize to adjust highlight positioning
    window.addEventListener('resize', this.boundUpdatePosition);
  },

  stop() {
    if (!this.isActive) return;
    this.isActive = false;

    const btn = document.getElementById('btn-tutorial-icon');
    if (btn) btn.classList.remove('active');

    window.removeEventListener('resize', this.boundUpdatePosition);

    if (this.overlayEl) {
      this.overlayEl.classList.remove('active');
      setTimeout(() => {
        if (this.overlayEl && this.overlayEl.parentNode) {
          this.overlayEl.parentNode.removeChild(this.overlayEl);
        }
        this.overlayEl = null;
        this.focusRingEl = null;
        this.popoverEl = null;
      }, 300);
    }
  },

  createDomElements() {
    // Parent overlay container
    this.overlayEl = document.createElement('div');
    this.overlayEl.className = 'tutorial-overlay';
    document.body.appendChild(this.overlayEl);

    // Dynamic focus ring
    this.focusRingEl = document.createElement('div');
    this.focusRingEl.className = 'tutorial-focus-ring';
    this.overlayEl.appendChild(this.focusRingEl);

    // Popover card
    this.popoverEl = document.createElement('div');
    this.popoverEl.className = 'tutorial-popover';
    this.overlayEl.appendChild(this.popoverEl);

    // Force layout update and transition in
    void this.overlayEl.offsetWidth;
    this.overlayEl.classList.add('active');
  },

  async goToStep(index) {
    if (index < 0 || index >= this.steps.length) return;
    this.currentStep = index;

    const step = this.steps[index];

    // If step requires switching tab programmatically
    if (step.tab && typeof switchTab === 'function') {
      await switchTab(step.tab);
    }
    if (step.onShow && typeof step.onShow === 'function') {
      step.onShow();
    }

    this.renderStepContent(step);
    
    // Wait briefly for tab layout to render before positioning
    setTimeout(() => {
      this.updatePosition();
    }, step.tab ? 150 : 0);
  },

  next() {
    if (this.currentStep < this.steps.length - 1) {
      this.goToStep(this.currentStep + 1);
    } else {
      // Mark as complete in localStorage
      try {
        localStorage.setItem('secretary_tutorial_completed', 'true');
      } catch (e) {}
      this.stop();
    }
  },

  prev() {
    if (this.currentStep > 0) {
      this.goToStep(this.currentStep - 1);
    }
  },

  skip() {
    this.stop();
  },

  renderStepContent(step) {
    if (!this.popoverEl) return;

    const totalSteps = this.steps.length;
    const isFirst = this.currentStep === 0;
    const isLast = this.currentStep === totalSteps - 1;

    // Render dot indicators
    let dotsHtml = '<div class="tutorial-dots">';
    for (let i = 0; i < totalSteps; i++) {
      dotsHtml += `<div class="tutorial-dot ${i === this.currentStep ? 'active' : ''}"></div>`;
    }
    dotsHtml += '</div>';

    // Buttons depending on step
    let actionButtons = '';
    if (isFirst) {
      actionButtons = `
        <div class="tutorial-actions-row">
          <button class="tutorial-btn tutorial-btn-text" onclick="TutorialController.skip()" title="${t('tutorial.skipTooltip') || 'Skip this tutorial tour'}">${t('tutorial.skipBtn') || 'Skip'}</button>
          <button class="tutorial-btn tutorial-btn-primary" onclick="TutorialController.next()" title="${t('tutorial.startTooltip') || 'Begin the interactive tour'}">${t('tutorial.startBtn') || 'Start Tour'}</button>
        </div>
      `;
    } else {
      actionButtons = `
        <div class="tutorial-actions-row">
          <button class="tutorial-btn tutorial-btn-text" onclick="TutorialController.skip()" title="${t('tutorial.skipTooltip') || 'Skip this tutorial tour'}">${t('tutorial.skipBtn') || 'Skip'}</button>
          <div class="tutorial-actions-right">
            <button class="tutorial-btn" onclick="TutorialController.prev()" title="${t('tutorial.prevTooltip') || 'Return to the previous step'}">${t('tutorial.prevBtn') || 'Back'}</button>
            <button class="tutorial-btn tutorial-btn-primary" onclick="TutorialController.next()" title="${isLast ? (t('tutorial.finishTooltip') || 'Finish the tour') : (t('tutorial.nextTooltip') || 'Go to the next step')}">${isLast ? (t('tutorial.finishBtn') || 'Finish') : (t('tutorial.nextBtn') || 'Next')}</button>
          </div>
        </div>
      `;
    }

    this.popoverEl.innerHTML = `
      <div class="tutorial-popover-header">
        <h4 class="tutorial-popover-title">${t(step.titleKey)}</h4>
        <button class="tutorial-popover-close" onclick="TutorialController.stop()" title="${t('editor.closeTooltip') || 'Close'}" aria-label="Close">✕</button>
      </div>
      <div class="tutorial-popover-body">
        ${t(step.textKey)}
      </div>
      <div class="tutorial-popover-footer">
        <div class="tutorial-dots-row">
          ${dotsHtml}
        </div>
        ${actionButtons}
      </div>
    `;
  },

  updatePosition() {
    if (!this.isActive || !this.popoverEl || !this.focusRingEl) return;

    const step = this.steps[this.currentStep];
    const targetEl = step.selector ? document.querySelector(step.selector) : null;

    // Remove centered style from popover by default
    this.popoverEl.classList.remove('tutorial-popover-centered');

    // Check if target element exists and is visible
    const isVisible = targetEl && targetEl.getBoundingClientRect().width > 0 && targetEl.offsetParent !== null;

    if (isVisible) {
      const rect = targetEl.getBoundingClientRect();
      const padding = 6;

      // Position the highlight ring
      this.focusRingEl.style.display = 'block';
      this.focusRingEl.style.top = `${rect.top - padding}px`;
      this.focusRingEl.style.left = `${rect.left - padding}px`;
      this.focusRingEl.style.width = `${rect.width + padding * 2}px`;
      this.focusRingEl.style.height = `${rect.height + padding * 2}px`;

      // Position the popover card
      const popoverWidth = 320;
      const popoverHeight = this.popoverEl.offsetHeight || 160;
      let top, left;

      // Try placing it below the target
      if (rect.bottom + popoverHeight + 15 < window.innerHeight) {
        top = rect.bottom + 10;
      } else {
        // Place it above target
        top = rect.top - popoverHeight - 10;
      }

      // Horizontally center it relative to the target
      left = rect.left + rect.width / 2 - popoverWidth / 2;

      // Keep it within screen boundaries
      left = Math.max(12, Math.min(left, window.innerWidth - popoverWidth - 12));
      top = Math.max(12, Math.min(top, window.innerHeight - popoverHeight - 12));

      this.popoverEl.style.top = `${top}px`;
      this.popoverEl.style.left = `${left}px`;
    } else {
      // No target or hidden element: center popover and hide focus ring
      this.focusRingEl.style.display = 'none';
      this.popoverEl.classList.add('tutorial-popover-centered');
      this.popoverEl.style.top = '';
      this.popoverEl.style.left = '';
    }
  }
};

// Bound method for window resize listener to maintain correct context
TutorialController.boundUpdatePosition = TutorialController.updatePosition.bind(TutorialController);

// Expose startTutorial helper globally
window.startTutorial = function() {
  TutorialController.start();
};

// ── Secretary: First Startup Setup Wizard Controller ──

const SetupWizardController = {
  currentStep: 0,
  lastStep: -1,
  isOpen: false,
  overlayEl: null,
  isTestingConnection: false,
  testStatusMessage: '',
  testStatusType: '', // 'success' | 'error' | 'testing' | ''

  state: {
    username: '',
    language: 'en',
    theme: 'system',
    accent: '#4f46e5',
    workStartTime: '08:30',
    workEndTime: '18:30',
    workingDays: [1, 2, 3, 4, 5],
    defaultDuration: 30,
    aiEnabled: false,
    aiProvider: 'lmstudio',
    aiEndpoint: 'http://127.0.0.1:1234/v1',
    aiApiKey: '',
    aiModel: 'qwen2.5-coder-7b-instruct'
  },

  providers: [
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
  ],

  accentPresets: [
    { color: '#4f46e5', name: 'Indigo' },
    { color: '#2563eb', name: 'Blue' },
    { color: '#059669', name: 'Emerald' },
    { color: '#d97706', name: 'Amber' },
    { color: '#e11d48', name: 'Rose' },
    { color: '#7c3aed', name: 'Violet' },
    { color: '#06b6d4', name: 'Cyan' }
  ],

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.currentStep = 0;
    this.lastStep = -1;
    this.testStatusMessage = '';
    this.testStatusType = '';

    // Initialize state from existing settings
    const curUi = (typeof settings === 'object' && settings?.ui) || {};
    const curAi = (typeof settings === 'object' && settings?.ai) || {};

    this.state = {
      username: (settings && settings.username) || '',
      language: (settings && settings.language) || (typeof appLanguage !== 'undefined' ? appLanguage : 'en'),
      theme: (settings && settings.theme) || curUi.theme || 'system',
      accent: (curUi.colors && curUi.colors.accent) || '#4f46e5',
      workStartTime: curUi.workStartTime || '08:30',
      workEndTime: curUi.workEndTime || '18:30',
      workingDays: Array.isArray(curUi.workingDays) ? [...curUi.workingDays] : [1, 2, 3, 4, 5],
      defaultDuration: curUi.defaultPlannerDuration || 30,
      aiEnabled: !!curAi.enabled,
      aiProvider: curAi.provider || 'lmstudio',
      aiEndpoint: curAi.endpoint || 'http://127.0.0.1:1234/v1',
      aiApiKey: curAi.apiKey || '',
      aiModel: curAi.model || 'qwen2.5-coder-7b-instruct'
    };

    this.createDomElements();
    this.render();

    // Escape listener
    this.boundKeyHandler = this.handleKeyDown.bind(this);
    window.addEventListener('keydown', this.boundKeyHandler);
  },

  handleKeyDown(e) {
    if (e.key === 'Escape' && this.isOpen) {
      this.close();
    }
  },

  createDomElements() {
    if (this.overlayEl && this.overlayEl.parentNode) {
      this.overlayEl.parentNode.removeChild(this.overlayEl);
    }
    this.overlayEl = document.createElement('div');
    this.overlayEl.id = 'setup-wizard-overlay';
    this.overlayEl.className = 'setup-wizard-overlay';
    document.body.appendChild(this.overlayEl);

    void this.overlayEl.offsetWidth;
    this.overlayEl.classList.add('active');
  },

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.lastStep = -1;
    window.removeEventListener('keydown', this.boundKeyHandler);

    if (this.overlayEl) {
      this.overlayEl.classList.remove('active');
      setTimeout(() => {
        if (this.overlayEl && this.overlayEl.parentNode) {
          this.overlayEl.parentNode.removeChild(this.overlayEl);
        }
        this.overlayEl = null;
      }, 300);
    }
  },

  syncInputsToState() {
    const nameEl = document.getElementById('wizard-username-input');
    if (nameEl) this.state.username = nameEl.value;

    const wsStartEl = document.getElementById('wizard-work-start');
    if (wsStartEl) this.state.workStartTime = wsStartEl.value;

    const wsEndEl = document.getElementById('wizard-work-end');
    if (wsEndEl) this.state.workEndTime = wsEndEl.value;

    const durEl = document.getElementById('wizard-default-duration');
    if (durEl) this.state.defaultDuration = parseInt(durEl.value, 10) || 30;

    const epEl = document.getElementById('wizard-ai-endpoint');
    if (epEl) this.state.aiEndpoint = epEl.value;

    const modelEl = document.getElementById('wizard-ai-model');
    if (modelEl) this.state.aiModel = modelEl.value;

    const keyEl = document.getElementById('wizard-ai-key');
    if (keyEl) this.state.aiApiKey = keyEl.value;
  },

  goToStep(index) {
    if (index < 0 || index > 3) return;
    this.syncInputsToState();
    this.currentStep = index;
    this.testStatusMessage = '';
    this.testStatusType = '';
    this.render();
  },

  next() {
    this.syncInputsToState();
    if (this.currentStep < 3) {
      this.goToStep(this.currentStep + 1);
    } else {
      this.finish(false);
    }
  },

  prev() {
    this.syncInputsToState();
    if (this.currentStep > 0) {
      this.goToStep(this.currentStep - 1);
    }
  },

  skip() {
    if (typeof settings === 'object' && settings) {
      settings.firstRunSetupDone = true;
      settings.folderInitialized = true;
      if (typeof saveLocalSettings === 'function') saveLocalSettings();
      if (typeof saveFolderSettingsDebounced === 'function') saveFolderSettingsDebounced();
    }
    this.close();
  },

  finish(startTour = false) {
    this.syncInputsToState();
    if (typeof settings === 'object' && settings) {
      if (!settings.ui) settings.ui = {};
      if (!settings.ui.colors) settings.ui.colors = {};
      if (!settings.ai) settings.ai = {};

      settings.username = this.state.username.trim();
      settings.language = this.state.language;
      settings.theme = this.state.theme;
      settings.ui.theme = this.state.theme;
      settings.ui.colors.accent = this.state.accent;
      settings.ui.workStartTime = this.state.workStartTime;
      settings.ui.workEndTime = this.state.workEndTime;
      settings.ui.workingDays = [...this.state.workingDays];
      settings.ui.defaultPlannerDuration = parseInt(this.state.defaultDuration, 10) || 30;

      settings.ai.enabled = this.state.aiEnabled;
      settings.ai.provider = this.state.aiProvider;
      settings.ai.endpoint = this.state.aiEndpoint.trim();
      settings.ai.apiKey = this.state.aiApiKey.trim();
      settings.ai.model = this.state.aiModel.trim();
      settings.ai.language = this.state.language;

      settings.firstRunSetupDone = true;
      settings.folderInitialized = true;

      // Update global runtime vars
      if (typeof appLanguage !== 'undefined') appLanguage = this.state.language;
      if (typeof workStartTime !== 'undefined') workStartTime = this.state.workStartTime;
      if (typeof workEndTime !== 'undefined') workEndTime = this.state.workEndTime;
      if (typeof defaultPlannerDuration !== 'undefined') defaultPlannerDuration = settings.ui.defaultPlannerDuration;

      try {
        localStorage.setItem('secretaryWorkStart', this.state.workStartTime);
        localStorage.setItem('secretaryWorkEnd', this.state.workEndTime);
        localStorage.setItem('secretaryDefaultDuration', String(settings.ui.defaultPlannerDuration));
      } catch (e) {}

      if (typeof applyTheme === 'function') applyTheme(this.state.theme);
      if (typeof applyAccentColor === 'function') applyAccentColor(this.state.accent);
      if (typeof applyLocalizedUI === 'function') applyLocalizedUI();
      if (typeof saveLocalSettings === 'function') saveLocalSettings();
      if (typeof saveFolderSettingsDebounced === 'function') saveFolderSettingsDebounced();
      if (typeof updateLLMToolbarVisibility === 'function') updateLLMToolbarVisibility();
      if (typeof renderPrefs === 'function') renderPrefs();
      if (typeof rebuildCollaborativeAggregates === 'function') rebuildCollaborativeAggregates();
    }

    const folderName = (typeof rootHandle !== 'undefined' && rootHandle && rootHandle.name) ? rootHandle.name : 'default';
    try { localStorage.setItem('secretary_folder_init_' + folderName, 'true'); } catch (e) {}

    this.close();

    if (startTour && typeof TutorialController !== 'undefined') {
      setTimeout(() => {
        TutorialController.start();
      }, 350);
    }
  },

  selectProvider(providerId) {
    this.syncInputsToState();
    const found = this.providers.find(p => p.id === providerId);
    if (!found) return;

    this.state.aiProvider = found.id;
    this.state.aiEndpoint = found.endpoint;
    this.state.aiModel = found.model;
    if (found.apiKey) {
      this.state.aiApiKey = found.apiKey;
    }
    this.testStatusMessage = '';
    this.testStatusType = '';
    this.render();
  },

  openProviderLink(providerId) {
    const found = this.providers.find(p => p.id === providerId);
    if (found && found.linkUrl) {
      window.open(found.linkUrl, '_blank', 'noopener,noreferrer');
    }
  },

  onLanguageChange(newLang) {
    this.syncInputsToState();
    this.state.language = newLang;
    if (typeof appLanguage !== 'undefined') appLanguage = newLang;
    if (typeof settings === 'object' && settings) settings.language = newLang;
    if (typeof applyLocalizedUI === 'function') applyLocalizedUI();
    this.render();
  },

  onThemeChange(newTheme) {
    this.syncInputsToState();
    this.state.theme = newTheme;
    if (typeof applyTheme === 'function') {
      applyTheme(newTheme);
    } else {
      document.body.setAttribute('data-theme', newTheme === 'system' ? '' : newTheme);
    }
    this.render();
  },

  onAccentChange(newColor) {
    this.syncInputsToState();
    this.state.accent = newColor;
    if (typeof applyAccentColor === 'function') {
      applyAccentColor(newColor);
    } else {
      document.documentElement.style.setProperty('--accent', newColor);
    }
    this.render();
  },

  toggleWorkingDay(day) {
    this.syncInputsToState();
    const idx = this.state.workingDays.indexOf(day);
    if (idx >= 0) {
      if (this.state.workingDays.length > 1) {
        this.state.workingDays.splice(idx, 1);
      }
    } else {
      this.state.workingDays.push(day);
      this.state.workingDays.sort((a, b) => a - b);
    }
    this.render();
  },

  toggleAi(enabled) {
    this.syncInputsToState();
    this.state.aiEnabled = enabled;
    this.render();
  },

  async testConnection() {
    this.syncInputsToState();
    if (this.isTestingConnection) return;
    this.isTestingConnection = true;
    this.testStatusType = 'testing';
    this.testStatusMessage = t('setupWizard.testConnectionTesting') || 'Connecting…';

    const testBtn = this.overlayEl ? this.overlayEl.querySelector('.setup-wizard-btn-test') : null;
    const testRow = this.overlayEl ? this.overlayEl.querySelector('.setup-wizard-test-row') : null;

    const updateTestUi = (type, message, isTesting) => {
      if (testBtn) {
        testBtn.disabled = isTesting;
        testBtn.innerHTML = isTesting
          ? '⏳ ' + (t('setupWizard.testConnectionTesting') || 'Testing…')
          : '⚡ ' + (t('setupWizard.testConnectionBtn') || 'Test Connection');
      }
      if (testRow) {
        let badgeEl = testRow.querySelector('.setup-wizard-test-badge');
        if (type) {
          if (!badgeEl) {
            badgeEl = document.createElement('div');
            testRow.appendChild(badgeEl);
          }
          badgeEl.className = `setup-wizard-test-badge setup-wizard-test-badge--${type}`;
          const icon = type === 'testing' ? '⏳ ' : (type === 'success' ? '✓ ' : '⚠️ ');
          badgeEl.textContent = icon + message;
        } else if (badgeEl) {
          badgeEl.remove();
        }
      }
    };

    updateTestUi(this.testStatusType, this.testStatusMessage, true);

    try {
      const endpoint = this.state.aiEndpoint.trim();
      const apiKey = this.state.aiApiKey.trim();
      const model = this.state.aiModel.trim();
      const provider = this.state.aiProvider;

      if (!endpoint) throw new Error('Endpoint URL is empty');
      if (!model) throw new Error('Model name is empty');

      if (typeof LLMService !== 'undefined' && typeof LLMService.testConnection === 'function') {
        // Temporarily prepare form fields for LLMService or direct fetch
        const requestUrl = (typeof LLMService.normalizeEndpoint === 'function')
          ? LLMService.normalizeEndpoint(endpoint, provider)
          : endpoint;
        const completionsUrl = requestUrl.replace(/\/+$/, '') + '/chat/completions';

        const headers = { 'Content-Type': 'application/json' };
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
        if (provider === 'anthropic') headers['x-api-key'] = apiKey;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000);

        const res = await fetch(completionsUrl, {
          method: 'POST',
          headers,
          signal: controller.signal,
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: 'Ping' }],
            max_tokens: 10
          })
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          this.testStatusType = 'success';
          this.testStatusMessage = t('setupWizard.testConnectionSuccess') || 'Connection successful! AI assistant is ready.';
        } else {
          const raw = await res.text();
          throw new Error(`HTTP ${res.status}: ${raw.slice(0, 100)}`);
        }
      } else {
        // Basic connectivity fallback ping
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(endpoint.replace(/\/+$/, '') + '/models', {
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (res.ok) {
          this.testStatusType = 'success';
          this.testStatusMessage = t('setupWizard.testConnectionSuccess') || 'Connection successful! AI assistant is ready.';
        } else {
          throw new Error(`HTTP ${res.status}`);
        }
      }
    } catch (err) {
      this.testStatusType = 'error';
      this.testStatusMessage = (t('setupWizard.testConnectionFail') || 'Connection failed.') + (err?.message ? ` (${err.message})` : '');
    } finally {
      this.isTestingConnection = false;
      updateTestUi(this.testStatusType, this.testStatusMessage, false);
    }
  },

  render() {
    if (!this.overlayEl) return;

    const existingBody = this.overlayEl.querySelector('.setup-wizard-body');
    const prevScrollTop = existingBody ? existingBody.scrollTop : 0;
    const isStepChange = this.lastStep !== this.currentStep;

    const stepTitles = [
      { num: 1, label: t('setupWizard.step1Title') || 'Profile & Theme', icon: '👤' },
      { num: 2, label: t('setupWizard.step2Title') || 'Schedule', icon: '📅' },
      { num: 3, label: t('setupWizard.step3Title') || 'AI Assistant', icon: '🤖' },
      { num: 4, label: t('setupWizard.step4Title') || 'Ready!', icon: '✨' }
    ];

    let stepperHtml = '<div class="setup-wizard-stepper">';
    stepTitles.forEach((st, idx) => {
      const isDone = idx < this.currentStep;
      const isActive = idx === this.currentStep;
      const stepClass = isActive ? 'active' : (isDone ? 'completed' : '');
      stepperHtml += `
        <div class="setup-wizard-step-pill ${stepClass}" onclick="SetupWizardController.goToStep(${idx})" title="${st.label}">
          <span class="setup-wizard-step-badge">${isDone ? '✓' : st.num}</span>
          <span class="setup-wizard-step-name">${st.label}</span>
        </div>
      `;
      if (idx < stepTitles.length - 1) {
        stepperHtml += `<div class="setup-wizard-step-line ${isDone ? 'completed' : ''}"></div>`;
      }
    });
    stepperHtml += '</div>';

    let bodyHtml = '';
    if (this.currentStep === 0) {
      bodyHtml = this.renderStep1();
    } else if (this.currentStep === 1) {
      bodyHtml = this.renderStep2();
    } else if (this.currentStep === 2) {
      bodyHtml = this.renderStep3();
    } else if (this.currentStep === 3) {
      bodyHtml = this.renderStep4();
    }

    if (!isStepChange) {
      bodyHtml = bodyHtml.replace('class="setup-wizard-step-pane"', 'class="setup-wizard-step-pane" style="animation:none;"');
    }

    // Footer actions
    let footerActionsHtml = '';
    if (this.currentStep === 0) {
      footerActionsHtml = `
        <button class="setup-wizard-btn setup-wizard-btn-subtle" onclick="SetupWizardController.skip()" title="${t('setupWizard.skipTooltip') || 'Skip setup and use default settings'}">${t('setupWizard.skipBtn') || 'Skip Setup'}</button>
        <div class="setup-wizard-footer-right">
          <button class="setup-wizard-btn setup-wizard-btn-primary" onclick="SetupWizardController.next()" title="${t('setupWizard.nextTooltip') || 'Proceed to the next setup step'}">${t('setupWizard.nextBtn') || 'Next →'}</button>
        </div>
      `;
    } else if (this.currentStep === 1 || this.currentStep === 2) {
      footerActionsHtml = `
        <button class="setup-wizard-btn setup-wizard-btn-subtle" onclick="SetupWizardController.skip()" title="${t('setupWizard.skipTooltip') || 'Skip setup and use default settings'}">${t('setupWizard.skipBtn') || 'Skip Setup'}</button>
        <div class="setup-wizard-footer-right">
          <button class="setup-wizard-btn" onclick="SetupWizardController.prev()" title="${t('setupWizard.backTooltip') || 'Return to the previous step'}">${t('setupWizard.backBtn') || '← Back'}</button>
          <button class="setup-wizard-btn setup-wizard-btn-primary" onclick="SetupWizardController.next()" title="${t('setupWizard.nextTooltip') || 'Proceed to the next setup step'}">${t('setupWizard.nextBtn') || 'Next →'}</button>
        </div>
      `;
    } else {
      footerActionsHtml = `
        <button class="setup-wizard-btn" onclick="SetupWizardController.prev()" title="${t('setupWizard.backTooltip') || 'Return to the previous step'}">${t('setupWizard.backBtn') || '← Back'}</button>
        <div class="setup-wizard-footer-right">
          <button class="setup-wizard-btn setup-wizard-btn-secondary" onclick="SetupWizardController.finish(true)" title="${t('setupWizard.startTourTooltip') || 'Start interactive tour'}">🚀 ${t('setupWizard.startTourBtn') || 'Take Interactive Tour'}</button>
          <button class="setup-wizard-btn setup-wizard-btn-primary" onclick="SetupWizardController.finish(false)" title="${t('setupWizard.enterWorkspaceTooltip') || 'Finish setup and enter workspace'}">✨ ${t('setupWizard.enterWorkspaceBtn') || 'Enter Workspace'}</button>
        </div>
      `;
    }

    let modalEl = this.overlayEl.querySelector('.setup-wizard-modal');
    if (!modalEl) {
      modalEl = document.createElement('div');
      modalEl.className = 'setup-wizard-modal';
      modalEl.setAttribute('role', 'dialog');
      modalEl.setAttribute('aria-modal', 'true');
      modalEl.setAttribute('aria-labelledby', 'setup-wizard-header-title');
      this.overlayEl.appendChild(modalEl);
    }

    modalEl.innerHTML = `
      <div class="setup-wizard-header">
        <div class="setup-wizard-brand">
          <img class="setup-wizard-logo" src="icon.svg" alt="Secretary Logo">
          <div>
            <h2 id="setup-wizard-header-title" class="setup-wizard-title">${t('setupWizard.modalTitle') || 'Secretary Setup Wizard'}</h2>
            <p class="setup-wizard-subtitle">${stepTitles[this.currentStep].label}</p>
          </div>
        </div>
        <button class="setup-wizard-close" onclick="SetupWizardController.skip()" title="${t('editor.closeTooltip') || 'Close'}" aria-label="Close">✕</button>
      </div>

      ${stepperHtml}

      <div class="setup-wizard-body">
        ${bodyHtml}
      </div>

      <div class="setup-wizard-footer">
        ${footerActionsHtml}
      </div>
    `;

    const newBody = modalEl.querySelector('.setup-wizard-body');
    if (newBody) {
      if (!isStepChange) {
        newBody.scrollTop = prevScrollTop;
      } else {
        newBody.scrollTop = 0;
      }
    }

    this.lastStep = this.currentStep;
  },

  renderStep1() {
    const langNames = (typeof APP_LANGUAGE_NAMES === 'object' && Object.keys(APP_LANGUAGE_NAMES).length > 0)
      ? APP_LANGUAGE_NAMES
      : {
          en: 'English', de: 'Deutsch', fr: 'Français', es: 'Español', it: 'Italiano',
          pt: 'Português', nl: 'Nederlands', pl: 'Polski', ru: 'Русский', uk: 'Українська',
          sv: 'Svenska', tr: 'Türkçe', cs: 'Čeština', ro: 'Română', hu: 'Magyar'
        };

    const langFlags = {
      en: '🇬🇧', de: '🇩🇪', fr: '🇫🇷', es: '🇪🇸', it: '🇮🇹', pt: '🇵🇹', nl: '🇳🇱',
      pl: '🇵🇱', ru: '🇷🇺', uk: '🇺🇦', sv: '🇸🇪', tr: '🇹🇷', cs: '🇨🇿', ro: '🇷🇴', hu: '🇭🇺'
    };

    let langOptions = '';
    for (const [code, name] of Object.entries(langNames)) {
      const flag = langFlags[code] || '🌐';
      const isSelected = this.state.language === code ? 'selected' : '';
      langOptions += `<option value="${code}" ${isSelected}>${flag} ${name}</option>`;
    }

    let accentOptions = '<div class="setup-wizard-accent-grid">';
    this.accentPresets.forEach(acc => {
      const isCur = this.state.accent.toLowerCase() === acc.color.toLowerCase();
      accentOptions += `
        <button type="button" class="setup-wizard-accent-dot ${isCur ? 'active' : ''}" style="background-color:${acc.color}" onclick="SetupWizardController.onAccentChange('${acc.color}')" title="${acc.name} (${acc.color})">
          ${isCur ? '✓' : ''}
        </button>
      `;
    });
    accentOptions += `
      <input type="color" class="setup-wizard-accent-picker" value="${this.state.accent}" onchange="SetupWizardController.onAccentChange(this.value)" title="${t('setupWizard.accentTooltip') || 'Custom accent color'}">
    </div>`;

    return `
      <div class="setup-wizard-step-pane">
        <p class="setup-wizard-step-intro">${t('setupWizard.step1Desc') || 'Personalize your workspace identity, language, and theme.'}</p>
        
        <div class="setup-wizard-form-group">
          <label class="setup-wizard-label" for="wizard-username-input">${t('setupWizard.userNameLabel') || 'Your Name'}</label>
          <div class="setup-wizard-input-wrap">
            <span class="setup-wizard-input-icon">👤</span>
            <input type="text" id="wizard-username-input" class="setup-wizard-input" value="${escH(this.state.username)}" placeholder="${t('setupWizard.userNamePlaceholder') || 'e.g. Alex'}" oninput="SetupWizardController.state.username = this.value" title="${t('setupWizard.userNameTooltip') || 'Your name for notes and collaborative attribution'}">
          </div>
        </div>

        <div class="setup-wizard-form-row">
          <div class="setup-wizard-form-group" style="flex:1">
            <label class="setup-wizard-label" for="wizard-language-select">${t('setupWizard.languageLabel') || 'Interface Language'}</label>
            <div class="setup-wizard-input-wrap">
              <select id="wizard-language-select" class="setup-wizard-select" onchange="SetupWizardController.onLanguageChange(this.value)" title="${t('setupWizard.languageTooltip') || 'Select your preferred application language'}">
                ${langOptions}
              </select>
            </div>
          </div>

          <div class="setup-wizard-form-group" style="flex:1">
            <label class="setup-wizard-label">${t('setupWizard.themeLabel') || 'App Theme'}</label>
            <div class="setup-wizard-theme-toggle">
              <button type="button" class="setup-wizard-theme-btn ${this.state.theme === 'system' ? 'active' : ''}" onclick="SetupWizardController.onThemeChange('system')" title="${t('setupWizard.themeSystem') || 'System'}">💻 ${t('setupWizard.themeSystem') || 'System'}</button>
              <button type="button" class="setup-wizard-theme-btn ${this.state.theme === 'light' ? 'active' : ''}" onclick="SetupWizardController.onThemeChange('light')" title="${t('setupWizard.themeLight') || 'Light'}">☀️ ${t('setupWizard.themeLight') || 'Light'}</button>
              <button type="button" class="setup-wizard-theme-btn ${this.state.theme === 'dark' ? 'active' : ''}" onclick="SetupWizardController.onThemeChange('dark')" title="${t('setupWizard.themeDark') || 'Dark'}">🌙 ${t('setupWizard.themeDark') || 'Dark'}</button>
            </div>
          </div>
        </div>

        <div class="setup-wizard-form-group">
          <label class="setup-wizard-label">${t('setupWizard.accentLabel') || 'Accent Color'}</label>
          ${accentOptions}
        </div>
      </div>
    `;
  },

  renderStep2() {
    const days = [
      { id: 1, key: 'setupWizard.dayMon', fullKey: 'setupWizard.dayMonFull', num: 1 },
      { id: 2, key: 'setupWizard.dayTue', fullKey: 'setupWizard.dayTueFull', num: 2 },
      { id: 3, key: 'setupWizard.dayWed', fullKey: 'setupWizard.dayWedFull', num: 3 },
      { id: 4, key: 'setupWizard.dayThu', fullKey: 'setupWizard.dayThuFull', num: 4 },
      { id: 5, key: 'setupWizard.dayFri', fullKey: 'setupWizard.dayFriFull', num: 5 },
      { id: 6, key: 'setupWizard.daySat', fullKey: 'setupWizard.daySatFull', num: 6 },
      { id: 7, key: 'setupWizard.daySun', fullKey: 'setupWizard.daySunFull', num: 7 }
    ];

    let dayChips = '<div class="setup-wizard-days-grid">';
    days.forEach(d => {
      const active = this.state.workingDays.includes(d.num);
      const shortLabel = t(d.key);
      const fullLabel = t(d.fullKey);
      dayChips += `
        <button type="button" class="setup-wizard-day-chip ${active ? 'active' : ''}" onclick="SetupWizardController.toggleWorkingDay(${d.num})" title="${fullLabel}">
          ${shortLabel}
        </button>
      `;
    });
    dayChips += '</div>';

    return `
      <div class="setup-wizard-step-pane">
        <p class="setup-wizard-step-intro">${t('setupWizard.step2Desc') || 'Configure your working hours and planning preferences.'}</p>

        <div class="setup-wizard-form-row">
          <div class="setup-wizard-form-group" style="flex:1">
            <label class="setup-wizard-label" for="wizard-work-start">${t('setupWizard.workHoursLabel') || 'Working Hours'} (Start)</label>
            <input type="time" id="wizard-work-start" class="setup-wizard-input" value="${this.state.workStartTime}" onchange="SetupWizardController.state.workStartTime = this.value" title="${t('setupWizard.workStartTooltip') || 'Start time of your regular work day'}">
          </div>
          <div class="setup-wizard-form-group" style="flex:1">
            <label class="setup-wizard-label" for="wizard-work-end">${t('setupWizard.workHoursLabel') || 'Working Hours'} (End)</label>
            <input type="time" id="wizard-work-end" class="setup-wizard-input" value="${this.state.workEndTime}" onchange="SetupWizardController.state.workEndTime = this.value" title="${t('setupWizard.workEndTooltip') || 'End time of your regular work day'}">
          </div>
        </div>

        <div class="setup-wizard-form-group">
          <label class="setup-wizard-label">${t('setupWizard.workingDaysLabel') || 'Working Days'}</label>
          ${dayChips}
        </div>

        <div class="setup-wizard-form-group">
          <label class="setup-wizard-label" for="wizard-default-duration">${t('setupWizard.defaultDurationLabel') || 'Default Block Duration'}</label>
          <select id="wizard-default-duration" class="setup-wizard-select" onchange="SetupWizardController.state.defaultDuration = parseInt(this.value, 10)" title="${t('setupWizard.defaultDurationTooltip') || 'Default duration when adding new planner blocks'}">
            <option value="15" ${this.state.defaultDuration === 15 ? 'selected' : ''}>15 min</option>
            <option value="30" ${this.state.defaultDuration === 30 ? 'selected' : ''}>30 min</option>
            <option value="45" ${this.state.defaultDuration === 45 ? 'selected' : ''}>45 min</option>
            <option value="60" ${this.state.defaultDuration === 60 ? 'selected' : ''}>60 min (1h)</option>
          </select>
        </div>
      </div>
    `;
  },

  renderStep3() {
    let providersCardsHtml = '<div class="setup-wizard-providers-grid">';
    this.providers.forEach(p => {
      const isSelected = this.state.aiProvider === p.id;
      providersCardsHtml += `
        <div class="setup-wizard-provider-card ${isSelected ? 'selected' : ''}" onclick="SetupWizardController.selectProvider('${p.id}')">
          <div class="setup-wizard-provider-header">
            <span class="setup-wizard-provider-icon">${p.icon}</span>
            <div class="setup-wizard-provider-info">
              <span class="setup-wizard-provider-name">${p.name}</span>
              <span class="setup-wizard-provider-tag">${p.tag}</span>
            </div>
            ${isSelected ? '<span class="setup-wizard-provider-check">✓</span>' : ''}
          </div>
          <p class="setup-wizard-provider-desc">${t(p.descKey)}</p>
          <div class="setup-wizard-provider-footer">
            <button type="button" class="setup-wizard-provider-link" onclick="event.stopPropagation(); SetupWizardController.openProviderLink('${p.id}')" title="${t('setupWizard.providerLinkTooltip') || 'Open provider website in a new tab'}">
              ${t('setupWizard.providerLinkBtn') || 'Provider Portal ↗'}
            </button>
          </div>
        </div>
      `;
    });
    providersCardsHtml += '</div>';

    let testFeedbackHtml = '';
    if (this.testStatusType) {
      testFeedbackHtml = `
        <div class="setup-wizard-test-badge setup-wizard-test-badge--${this.testStatusType}">
          ${this.testStatusType === 'testing' ? '⏳ ' : (this.testStatusType === 'success' ? '✓ ' : '⚠️ ')}
          ${escH(this.testStatusMessage)}
        </div>
      `;
    }

    return `
      <div class="setup-wizard-step-pane">
        <p class="setup-wizard-step-intro">${t('setupWizard.step3Desc') || 'Connect a local or cloud AI provider for smart summaries, task extraction, and chat.'}</p>

        <div class="setup-wizard-toggle-row">
          <label class="setup-wizard-toggle-label" for="wizard-ai-enable-switch">
            <input type="checkbox" id="wizard-ai-enable-switch" class="setup-wizard-checkbox" ${this.state.aiEnabled ? 'checked' : ''} onchange="SetupWizardController.toggleAi(this.checked)" title="${t('setupWizard.enableAiTooltip') || 'Toggle AI features in workspace'}">
            <span class="setup-wizard-toggle-slider"></span>
            <span class="setup-wizard-toggle-text">${t('setupWizard.enableAiLabel') || 'Enable AI Assistant'}</span>
          </label>
        </div>

        <div class="setup-wizard-providers-container ${!this.state.aiEnabled ? 'is-disabled' : ''}">
          <label class="setup-wizard-label">${t('setupWizard.providerLabel') || 'AI Provider'}</label>
          ${providersCardsHtml}

          <div class="setup-wizard-form-row" style="margin-top:1rem">
            <div class="setup-wizard-form-group" style="flex:2">
              <label class="setup-wizard-label" for="wizard-ai-endpoint">${t('setupWizard.endpointLabel') || 'API Endpoint'}</label>
              <input type="text" id="wizard-ai-endpoint" class="setup-wizard-input" value="${escH(this.state.aiEndpoint)}" placeholder="${t('setupWizard.endpointPlaceholder') || 'e.g. http://127.0.0.1:1234/v1'}" oninput="SetupWizardController.state.aiEndpoint = this.value" title="${t('setupWizard.endpointTooltip') || 'Base URL of the OpenAI-compatible API endpoint'}">
            </div>
            <div class="setup-wizard-form-group" style="flex:1">
              <label class="setup-wizard-label" for="wizard-ai-model">${t('setupWizard.modelLabel') || 'Model Name'}</label>
              <input type="text" id="wizard-ai-model" class="setup-wizard-input" value="${escH(this.state.aiModel)}" placeholder="${t('setupWizard.modelPlaceholder') || 'e.g. gpt-4o'}" oninput="SetupWizardController.state.aiModel = this.value" title="${t('setupWizard.modelTooltip') || 'Model identifier to send with requests'}">
            </div>
          </div>

          <div class="setup-wizard-form-group">
            <label class="setup-wizard-label" for="wizard-ai-key">${t('setupWizard.apiKeyLabel') || 'API Key / Token'}</label>
            <input type="password" id="wizard-ai-key" class="setup-wizard-input" value="${escH(this.state.aiApiKey)}" placeholder="${t('setupWizard.apiKeyPlaceholder') || 'Enter API key if required...'}" oninput="SetupWizardController.state.aiApiKey = this.value" title="${t('setupWizard.apiKeyTooltip') || 'API key for authentication with this provider'}">
          </div>

          <div class="setup-wizard-test-row">
            <button type="button" class="setup-wizard-btn setup-wizard-btn-test" onclick="SetupWizardController.testConnection()" ${this.isTestingConnection ? 'disabled' : ''} title="${t('setupWizard.testConnectionTooltip') || 'Check if Secretary can communicate with the AI endpoint'}">
              ${this.isTestingConnection ? '⏳ ' + (t('setupWizard.testConnectionTesting') || 'Testing…') : '⚡ ' + (t('setupWizard.testConnectionBtn') || 'Test Connection')}
            </button>
            ${testFeedbackHtml}
          </div>
        </div>
      </div>
    `;
  },

  renderStep4() {
    const curProvider = this.providers.find(p => p.id === this.state.aiProvider);
    const providerName = curProvider ? curProvider.name : this.state.aiProvider;
    const aiSummaryText = this.state.aiEnabled
      ? (t('setupWizard.summaryAiEnabled') || 'Enabled ({provider})').replace('{provider}', providerName)
      : (t('setupWizard.summaryAiDisabled') || 'Disabled');

    const dayCount = this.state.workingDays.length;
    const scheduleSummary = `${this.state.workStartTime} - ${this.state.workEndTime} (${dayCount} ${dayCount > 1 ? 'days' : 'day'}/wk, ${this.state.defaultDuration}m blocks)`;

    return `
      <div class="setup-wizard-step-pane">
        <div class="setup-wizard-celebrate-wrap">
          <div class="setup-wizard-celebrate-badge">🎉</div>
          <h3 class="setup-wizard-celebrate-title">${t('setupWizard.step4Title') || "You're All Set!"}</h3>
          <p class="setup-wizard-step-intro">${t('setupWizard.step4Desc') || 'Your Secretary workspace is personalized and ready for your daily workflow.'}</p>
        </div>

        <div class="setup-wizard-summary-cards">
          <div class="setup-wizard-summary-card">
            <div class="setup-wizard-summary-icon">👤</div>
            <div class="setup-wizard-summary-content">
              <span class="setup-wizard-summary-label">${t('setupWizard.summaryProfile') || 'Profile & Theme'}</span>
              <span class="setup-wizard-summary-value">${escH(this.state.username || 'Secretary User')} · ${this.state.language.toUpperCase()} · ${this.state.theme}</span>
            </div>
          </div>

          <div class="setup-wizard-summary-card">
            <div class="setup-wizard-summary-icon">📅</div>
            <div class="setup-wizard-summary-content">
              <span class="setup-wizard-summary-label">${t('setupWizard.summarySchedule') || 'Working Schedule'}</span>
              <span class="setup-wizard-summary-value">${scheduleSummary}</span>
            </div>
          </div>

          <div class="setup-wizard-summary-card">
            <div class="setup-wizard-summary-icon">${this.state.aiEnabled ? '🤖' : '⚪'}</div>
            <div class="setup-wizard-summary-content">
              <span class="setup-wizard-summary-label">${t('setupWizard.summaryAi') || 'AI Assistant'}</span>
              <span class="setup-wizard-summary-value">${aiSummaryText}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }
};

// Expose SetupWizardController globally
window.SetupWizardController = SetupWizardController;

