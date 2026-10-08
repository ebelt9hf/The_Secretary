'use strict';

// ── Secretary: Internationalization ──

const APP_LANGUAGE_NAMES = {};
const APP_LANGUAGE_LOCALES = {};
const APP_LANGUAGE_PACKS = {};

let _translationsLoaded = false;

function setNestedValue(obj, compositeKey, value) {
  const parts = compositeKey.split('.');
  let curr = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!curr[part] || typeof curr[part] !== 'object') {
      curr[part] = {};
    }
    curr = curr[part];
  }
  curr[parts[parts.length - 1]] = value;
}

function processTranslationsBundle(bundle) {
  if (!bundle) return;
  if (bundle.metadata) {
    if (bundle.metadata.language_names) {
      Object.assign(APP_LANGUAGE_NAMES, bundle.metadata.language_names);
    }
    if (bundle.metadata.language_locales) {
      Object.assign(APP_LANGUAGE_LOCALES, bundle.metadata.language_locales);
    }
  }
  const languages = (bundle.metadata && bundle.metadata.languages) || Object.keys(APP_LANGUAGE_NAMES);
  languages.forEach(lang => {
    if (!APP_LANGUAGE_PACKS[lang]) {
      APP_LANGUAGE_PACKS[lang] = {};
    }
  });

  if (bundle.translations) {
    for (const [compositeKey, langMap] of Object.entries(bundle.translations)) {
      if (!langMap || typeof langMap !== 'object') continue;
      for (const [lang, val] of Object.entries(langMap)) {
        if (!APP_LANGUAGE_PACKS[lang]) APP_LANGUAGE_PACKS[lang] = {};
        setNestedValue(APP_LANGUAGE_PACKS[lang], compositeKey, val);
      }
    }
  }
  _translationsLoaded = true;
  if (typeof document !== 'undefined' && document.body) {
    applyLocalizedUI();
  }
}

async function initTranslations() {
  if (_translationsLoaded) return;

  // Primary: translations injected as a global via <script src="js/translations.js">.
  // This works universally across file://, http://, Vite, and Electron.
  if (typeof window !== 'undefined' && window.APP_TRANSLATIONS_BUNDLE) {
    await Promise.resolve();
    processTranslationsBundle(window.APP_TRANSLATIONS_BUNDLE);
    return;
  }

  // Fallback for Node test environments
  if (typeof require !== 'undefined') {
    try {
      const fs = require('fs');
      const path = require('path');
      const jsPath = path.join(__dirname, 'translations.js');
      if (fs.existsSync(jsPath)) {
        const content = fs.readFileSync(jsPath, 'utf8');
        const match = content.match(/window\.APP_TRANSLATIONS_BUNDLE\s*=\s*(\{[\s\S]*\});?\s*$/);
        if (match) {
          processTranslationsBundle(JSON.parse(match[1]));
          return;
        }
      }
    } catch (e) {
      console.error('Node fallback for translations loading failed:', e);
    }
  }
}

if (typeof window !== 'undefined') {
  window.initTranslationsPromise = initTranslations();
} else {
  initTranslations();
}

function normalizeLanguageCode(lang) {
  const value = String(lang || '').trim().toLowerCase();
  if (!value) return 'en';
  if (APP_LANGUAGE_PACKS[value]) return value;
  const prefix = value.slice(0, 2);
  if (APP_LANGUAGE_PACKS[prefix]) return prefix;
  return 'en';
}

function getBrowserLanguageCode() {
  const nav = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en']);
  for (const raw of nav) {
    const code = normalizeLanguageCode(raw);
    if (APP_LANGUAGE_PACKS[code]) return code;
  }
  return 'en';
}

function getAppLanguage() {
  return normalizeLanguageCode((typeof appLanguage !== 'undefined' && appLanguage) || (typeof settings !== 'undefined' && settings?.language) || 'en');
}

function getAppLocale(lang = getAppLanguage()) {
  return APP_LANGUAGE_LOCALES[normalizeLanguageCode(lang)] || 'en-US';
}

function getLanguagePack(lang = getAppLanguage()) {
  return APP_LANGUAGE_PACKS[normalizeLanguageCode(lang)] || APP_LANGUAGE_PACKS.en;
}

function getNestedValue(obj, path) {
  return String(path || '').split('.').reduce((acc, key) => (acc && Object.prototype.hasOwnProperty.call(acc, key)) ? acc[key] : undefined, obj);
}

function interpolate(template, vars = {}) {
  return String(template || '').replace(/\{(\w+)\}/g, (_, key) => {
    const value = vars[key];
    return value == null ? '' : String(value);
  });
}

function t(key, vars = {}) {
  if (typeof vars === 'string') {
    vars = { fallback: vars };
  }
  const targetLang = vars && vars.lang ? vars.lang : null;
  const langPack = targetLang ? getLanguagePack(targetLang) : getLanguagePack();
  const fallbackPack = APP_LANGUAGE_PACKS.en;
  let value = getNestedValue(langPack, key);
  if (value == null) value = getNestedValue(fallbackPack, key);
  if (value == null && vars && vars.fallback !== undefined) value = vars.fallback;
  if (Array.isArray(value)) return value;
  if (typeof value === 'function') return value(vars);
  const result = value != null ? value : (vars && vars.fallback ? vars.fallback : key);
  return interpolate(result, vars);
}

function word(nounKey, count) {
  const pack = getLanguagePack();
  const entry = getNestedValue(pack, `nouns.${nounKey}`) || getNestedValue(APP_LANGUAGE_PACKS.en, `nouns.${nounKey}`) || [nounKey, nounKey + 's'];
  return Array.isArray(entry) ? (count === 1 ? entry[0] : entry[1]) : String(entry);
}

function formatMonthShort(date) {
  return new Intl.DateTimeFormat(getAppLocale(), { month: 'short' }).format(date);
}

function getDayName(index) {
  const days = t('week.dayNames');
  return Array.isArray(days) ? (days[index] || t('week.unknown')) : t('week.unknown');
}

function setElementText(selector, value) {
  const el = document.querySelector(selector);
  if (el) el.textContent = value;
}

function setElementHTML(selector, value) {
  const el = document.querySelector(selector);
  if (el) el.innerHTML = value;
}

function setElementTitle(selector, value) {
  const el = document.querySelector(selector);
  if (el) el.title = value;
}

function setElementPlaceholder(selector, value) {
  const el = document.querySelector(selector);
  if (el) el.placeholder = value;
}

let _autoHoverObserver = null;
let _autoHoverTimer = null;

function deriveAutoHoverTitle(el) {
  if (!el || typeof el.getAttribute !== 'function') return '';

  // Skip container elements that contain child buttons or interactive elements
  if (el.children && el.children.length > 0) {
    const interactiveChildren = el.querySelectorAll('button, a, input, select, textarea, [role="button"], [role="link"], [onclick]');
    if (interactiveChildren.length > 0) return '';
  }

  // Skip container elements whose onclick is purely stopping propagation
  const onclickAttr = String(el.getAttribute('onclick') || '');
  if (onclickAttr && (onclickAttr.includes('stopPropagation()') || onclickAttr.includes('event.stopPropagation()')) && !onclickAttr.includes('open') && !onclickAttr.includes('set') && !onclickAttr.includes('toggle') && !onclickAttr.includes('click(')) {
    return '';
  }

  // Skip known lane/board container elements
  if (el.matches && el.matches('.sl-lane-actions, .sl-card-header, .sl-lane-header, .sl-card-body, .sl-card-preview-area, .sl-card-tag-row, .sl-subtabs, .sl-card-content, .sl-card-planner-blocks')) {
    return '';
  }

  const ariaLabel = String(el.getAttribute('aria-label') || '').trim();
  if (ariaLabel) return ariaLabel;

  const i18nTitleKey = String(el.getAttribute('data-i18n-title') || '').trim();
  if (i18nTitleKey) return String(t(i18nTitleKey)).trim();

  const text = String(el.textContent || '').replace(/\s+/g, ' ').trim();
  if (text) {
    // Avoid setting titles that are purely action icon symbols like "✎ ▢ —" or "⠿"
    if (/^[^\w\s\u00C0-\u024F\u0400-\u04FF]+$/.test(text)) return '';
    return text.length > 140 ? text.slice(0, 137).trimEnd() + '...' : text;
  }

  const value = String(el.getAttribute('value') || '').trim();
  if (value) return value;

  return '';
}

function ensureLocalizedHoverText(root = document) {
  if (!root || typeof root.querySelectorAll !== 'function') return;

  const clickableSelector = [
    'button',
    'a',
    '[onclick]',
    '[role="button"]',
    '[role="link"]',
    '.planner-day-toggle',
    '.planner-related-note-item',
    '.retro-item-card',
    '.pill-mention',
    '.pill-delegation',
    '.note-decision-wrapper',
    '.wiki-link',
  ].join(',');

  root.querySelectorAll(clickableSelector).forEach(el => {
    if (!el || el.hasAttribute('data-no-auto-title')) return;
    const existing = String(el.getAttribute('title') || '').trim();
    if (existing) return;
    const computed = deriveAutoHoverTitle(el);
    if (computed) el.setAttribute('title', computed);
  });
}

function scheduleLocalizedHoverTitles(root = document) {
  if (_autoHoverTimer) clearTimeout(_autoHoverTimer);
  _autoHoverTimer = setTimeout(() => {
    _autoHoverTimer = null;
    ensureLocalizedHoverText(root);
  }, 0);
}

function initLocalizedHoverObserver() {
  if (_autoHoverObserver || typeof MutationObserver === 'undefined' || !document.body) return;
  _autoHoverObserver = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList' && mutation.addedNodes && mutation.addedNodes.length) {
        scheduleLocalizedHoverTitles(document);
        return;
      }
    }
  });
  _autoHoverObserver.observe(document.body, { childList: true, subtree: true });
}

function setSelectOptionText(selector, values) {
  const el = document.querySelector(selector);
  if (!el) return;
  [...el.options].forEach((opt, index) => {
    if (values[index] != null) opt.textContent = values[index];
  });
}

function syncLanguageSelector() {
  const currentLang = getAppLanguage();

  const landingSelect = document.getElementById('landing-language-select');
  if (landingSelect) {
    landingSelect.innerHTML = '';
    for (const [code, name] of Object.entries(APP_LANGUAGE_NAMES)) {
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = name;
      landingSelect.appendChild(opt);
    }
    landingSelect.value = currentLang;
  }

  const select = document.getElementById('prefs-language');
  if (select) {
    select.innerHTML = '';
    for (const [code, name] of Object.entries(APP_LANGUAGE_NAMES)) {
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = name;
      select.appendChild(opt);
    }
    select.value = currentLang;
  }

  const aiSelect = document.getElementById('prefs-ai-language');
  if (aiSelect) {
    const currentAiVal = aiSelect.value;
    aiSelect.innerHTML = '';
    const autoOpt = document.createElement('option');
    autoOpt.value = 'auto';
    autoOpt.textContent = t('prefs.aiLanguageAuto') || 'Auto (Language of the note/prompt)';
    aiSelect.appendChild(autoOpt);

    for (const [code, name] of Object.entries(APP_LANGUAGE_NAMES)) {
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = name;
      aiSelect.appendChild(opt);
    }
    aiSelect.value = currentAiVal || 'auto';
  }
}

function applyLocalizedUI() {
  if (typeof document === 'undefined' || !document.body || !_translationsLoaded) return;
  const lang = getAppLanguage();
  if (document.documentElement) document.documentElement.lang = lang;

  // Generic data-i18n, data-i18n-title, data-i18n-placeholder auto-scan
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (key) {
      const val = t(key);
      if (val && val !== key) {
        if (el.children.length === 0) {
          el.textContent = val;
        } else {
          const textNode = Array.from(el.childNodes).find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
          if (textNode) {
            textNode.textContent = val;
          }
        }
      }
    }
  });

  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    if (key) {
      const val = t(key);
      if (val && val !== key) {
        el.setAttribute('title', val);
      }
    }
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key) {
      const val = t(key);
      if (val && val !== key) {
        el.setAttribute('placeholder', val);
      }
    }
  });

  setElementTitle('#win-min', t('window.minimize'));
  setElementTitle('#win-max', t('window.maximize'));
  setElementTitle('#win-close', t('window.close'));

  setElementText('#screen-connect h1', t('landing.title'));
  setElementText('#screen-connect .landing-desc', t('landing.description'));
  const resumeLabel = document.getElementById('btn-resume-folder-label');
  if (resumeLabel) resumeLabel.textContent = t('landing.resumeAction') || t('landing.resume');
  setElementTitle('#btn-resume-folder', t('landing.resumeTitle'));
  setElementText('#landing-divider span', t('landing.dividerOr'));

  const openText = document.getElementById('btn-open-folder-text');
  const resumeWrap = document.getElementById('landing-resume-wrap');
  const isResumeVisible = resumeWrap && resumeWrap.style.display !== 'none';
  if (openText) {
    openText.textContent = isResumeVisible ? (t('landing.openDifferent') || t('landing.open')) : (t('landing.localOptionBtn') || t('landing.open'));
  }
  setElementTitle('#btn-open-folder', t('landing.localOptionTooltip') || t('landing.openTitle'));
  setElementText('#screen-connect > p:nth-of-type(3)', t('landing.chromeOnly'));
  const versionHintEl = document.getElementById('connect-version-hint');
  if (versionHintEl) {
    const version = versionHintEl.getAttribute('data-version') || '';
    versionHintEl.textContent = t('landing.versionHint', { version });
  }
  setElementText('#landing-pill-local .landing-pill-text', t('landing.pillLocalFirst'));
  setElementText('#landing-pill-rich-text .landing-pill-text', t('landing.pillRichText'));
  setElementText('#landing-pill-private .landing-pill-text', t('landing.pillPrivate'));

  const setTabLabel = (id, iconName, label) => {
    const el = document.getElementById(id);
    if (!el) return;
    const iconHtml = window.AppIcons ? window.AppIcons.get(iconName, { size: 15 }) : '';
    el.innerHTML = `<span class="tab-btn-icon">${iconHtml}</span><span class="tab-btn-label">${escH(label)}</span>`;
  };

  setTabLabel('tab-planner', 'planner', t('topbar.planner'));
  setElementTitle('#tab-planner', t('topbar.plannerTooltip'));

  setTabLabel('tab-todos-mode', 'todos', t('topbar.todos'));
  setElementTitle('#tab-todos-mode', t('topbar.todosTooltip'));

  setTabLabel('tab-retro', 'retro', t('topbar.retro'));
  setElementTitle('#tab-retro', t('topbar.retroTooltip'));

  setTabLabel('tab-notes', 'notes', t('topbar.notes'));
  setElementTitle('#tab-notes', t('topbar.notesTooltip'));

  setTabLabel('tab-decisions', 'workstreams', t('topbar.workstreams'));
  setElementTitle('#tab-decisions', t('topbar.workstreamsTooltip'));

  setTabLabel('tab-team', 'team', t('topbar.team'));
  setElementTitle('#tab-team', t('topbar.teamTooltip'));

  setTabLabel('tab-daily-review-btn', 'dailyReview', t('topbar.dailyReview') || 'Daily Review');
  setElementTitle('#tab-daily-review-btn', t('topbar.dailyReview') || 'Daily Review');

  const btnTutorial = document.getElementById('btn-tutorial-icon');
  if (btnTutorial && window.AppIcons) {
    btnTutorial.innerHTML = window.AppIcons.get('tutorial', { size: 15 });
  }
  const btnPrefs = document.getElementById('btn-prefs-icon');
  if (btnPrefs && window.AppIcons) {
    btnPrefs.innerHTML = window.AppIcons.get('prefs', { size: 15 });
  }

  setElementPlaceholder('#note-search', t('topbar.searchPlaceholder'));
  setElementTitle('#note-search', t('topbar.searchTitle'));
  setElementTitle('#search-content-toggle', t('topbar.searchContentTooltip'));
  setElementTitle('#search-case-toggle', t('topbar.searchCaseTooltip'));
  setElementTitle('#search-regex-toggle', t('topbar.searchRegexTooltip'));
  setElementTitle('#btn-prefs-icon', t('topbar.prefsTooltip'));
  // Notes View Switcher & Zoom Pills
  if (window.AppIcons) {
    const btnMap = document.getElementById('btn-notes-view-map');
    if (btnMap) btnMap.innerHTML = window.AppIcons.wrap('map', t('notes.mapView'), { size: 13 });
    const btnTree = document.getElementById('btn-notes-view-tree');
    if (btnTree) btnTree.innerHTML = window.AppIcons.wrap('grid', t('notes.treeView'), { size: 13 });
    const btnReader = document.getElementById('btn-notes-view-reader');
    if (btnReader) btnReader.innerHTML = window.AppIcons.wrap('bookOpen', t('notes.readerView'), { size: 13 });
  } else {
    setElementText('#btn-notes-view-map', t('notes.mapView'));
    setElementText('#btn-notes-view-tree', t('notes.treeView'));
    setElementText('#btn-notes-view-reader', t('notes.readerView'));
  }
  setElementTitle('#btn-notes-view-map', t('notes.mapViewTooltip'));
  setElementTitle('#btn-notes-view-tree', t('notes.treeViewTooltip'));
  setElementTitle('#btn-notes-view-reader', t('notes.readerViewTooltip'));

  setElementText('#zoom-pill-weeks', t('notes.zoomWeeks'));
  setElementText('#zoom-pill-months', t('notes.zoomMonths'));
  setElementText('#zoom-pill-years', t('notes.zoomYears'));
  setElementTitle('#zoom-pill-weeks', t('notes.zoomTooltip'));
  setElementTitle('#zoom-pill-months', t('notes.zoomTooltip'));
  setElementTitle('#zoom-pill-years', t('notes.zoomTooltip'));

  setElementText('#axis-pill-group', t('axis.groups'));
  setElementTitle('#axis-pill-group', t('axis.groupsTitle'));
  setElementText('#axis-pill-major', t('axis.topics'));
  setElementTitle('#axis-pill-major', t('axis.topicsTitle'));
  setElementText('#axis-pill-week', t('axis.weeks'));
  setElementTitle('#axis-pill-week', t('axis.weeksTitle'));

  setElementText('#week-subgroup-select option[value="day"]', t('week.day'));
  setElementText('#week-subgroup-select option[value="group"]', t('week.group'));
  setElementText('#week-subgroup-select option[value="major"]', t('week.major'));
  setElementText('#week-subgroup-select option[value="topic"]', t('week.topic'));
  setElementTitle('#week-subgroup-select', `${t('week.by')} ${t('axis.weeks').toLowerCase()}`);

  setElementText('#btn-show-done', t('subrow.showDone'));
  setElementText('#btn-clear-done', t('subrow.clearDone'));
  setElementTitle('#btn-clear-done', t('subrow.clearDoneTooltip'));

  const btnFilter = document.getElementById('btn-filter-bar');
  if (btnFilter && window.AppIcons) {
    btnFilter.innerHTML = window.AppIcons.wrap('filter', t('subrow.filter'), { size: 13 });
  } else {
    setElementText('#btn-filter-bar', t('subrow.filter'));
  }
  setElementTitle('#btn-filter-bar', t('subrow.filterTooltip'));

  setElementText('#prefs-panel h2', t('prefs.title'));
  if (window.AppIcons) {
    setElementHTML('#prefs-tab-general-btn', window.AppIcons.wrap('user', t('prefs.tabGeneral'), { size: 14 }));
    setElementHTML('#prefs-tab-appearance-btn', window.AppIcons.wrap('palette', t('prefs.tabAppearance'), { size: 14 }));
    setElementHTML('#prefs-tab-schedule-btn', window.AppIcons.wrap('planner', t('prefs.tabSchedule'), { size: 14 }));
    setElementHTML('#prefs-tab-ai-btn', window.AppIcons.wrap('ai', t('prefs.tabAi'), { size: 14 }));
    setElementHTML('#prefs-tab-system-btn', window.AppIcons.wrap('prefs', t('prefs.tabSystem'), { size: 14 }));
  } else {
    setElementText('#prefs-tab-general-btn', t('prefs.tabGeneral'));
    setElementText('#prefs-tab-appearance-btn', t('prefs.tabAppearance'));
    setElementText('#prefs-tab-schedule-btn', t('prefs.tabSchedule'));
    setElementText('#prefs-tab-ai-btn', t('prefs.tabAi'));
    setElementText('#prefs-tab-system-btn', t('prefs.tabSystem'));
  }
  setElementText('#prefs-sec-appearance h3', t('prefs.appearance'));

  // Theme
  const themeRow = document.getElementById('prefs-theme')?.closest('.prefs-row');
  if (themeRow) {
    const label = themeRow.querySelector('.prefs-label');
    if (label) label.textContent = t('prefs.theme');
  }
  setElementText('#prefs-sec-appearance .prefs-subtitle', t('prefs.colors'));

  // Lane sorting
  const sortRow = document.getElementById('prefs-lane-sorting')?.closest('.prefs-row');
  if (sortRow) {
    const label = sortRow.querySelector('.prefs-label');
    if (label) label.textContent = t('prefs.laneSorting');
    const small = sortRow.querySelector('small');
    if (small) small.textContent = t('prefs.laneSortingHint');
  }

  // Older notes threshold
  const cutoffRow = document.getElementById('prefs-week-cutoff')?.closest('.prefs-row');
  if (cutoffRow) {
    const label = cutoffRow.querySelector('.prefs-label');
    if (label) label.textContent = t('prefs.olderNotesThreshold');
    const small = cutoffRow.querySelector('small');
    if (small) small.textContent = t('prefs.olderNotesHint');
  }

  setElementTitle('#prefs-theme', t('prefs.themeHint'));
  setElementTitle('#prefs-lane-sorting', t('prefs.laneSorting'));
  setElementTitle('#prefs-week-cutoff', t('prefs.olderNotesThreshold'));
  setElementText('#prefs-sec-appearance .prefs-subsection small', t('prefs.colorsHint'));

  setElementText('#prefs-sec-schedule h3', t('prefs.workSchedule'));

  const workStartRow = document.getElementById('prefs-work-start')?.closest('.prefs-row');
  if (workStartRow) {
    const label = workStartRow.querySelector('.prefs-label');
    if (label) label.textContent = t('prefs.workStart');
  }
  const workEndRow = document.getElementById('prefs-work-end')?.closest('.prefs-row');
  if (workEndRow) {
    const label = workEndRow.querySelector('.prefs-label');
    if (label) label.textContent = t('prefs.workEnd');
  }

  setElementText('#prefs-default-duration-label', t('prefs.defaultPlannerDuration'));
  setElementText('#prefs-sec-schedule small', t('prefs.workScheduleHint'));
  setElementTitle('#prefs-default-duration', t('prefs.defaultPlannerDuration'));

  setElementText('#prefs-sec-language h3', t('prefs.language'));
  setElementText('#prefs-sec-language .prefs-label', t('prefs.language'));
  setElementTitle('#prefs-language', t('prefs.chooseLanguage'));

  setElementText('#prefs-sec-help h3', t('prefs.helpAndTutorial'));
  setElementText('#prefs-setup-wizard-label', t('prefs.setupWizardLabel'));
  setElementText('#prefs-setup-wizard-btn', t('prefs.runSetupWizardBtn'));
  setElementTitle('#prefs-setup-wizard-btn', t('prefs.runSetupWizardTooltip'));
  setElementText('#prefs-setup-wizard-desc', t('prefs.setupWizardDesc'));
  setElementText('#prefs-tutorial-label', t('prefs.interactiveTutorial'));
  setElementText('#prefs-tutorial-btn', t('prefs.startTour'));
  setElementTitle('#prefs-tutorial-btn', t('prefs.startTourTooltip'));
  setElementText('#prefs-tutorial-desc', t('prefs.tutorialDesc'));

  setElementText('#prefs-sec-maintenance h3', t('prefs.maintenanceTitle'));
  setElementText('#prefs-rebuild-index-label', t('prefs.rebuildIndexLabel'));
  setElementText('#prefs-rebuild-index-desc', t('prefs.rebuildIndexDesc'));

  setElementText('#prefs-sec-folder h3', t('prefs.folder'));
  const folderRow = document.getElementById('prefs-folder-name')?.closest('.prefs-row');
  if (folderRow) {
    const label = folderRow.querySelector('.prefs-label');
    if (label) label.textContent = t('prefs.savedFolder');
  }

  const changeBtn = document.querySelector('button[onclick="changeFolderFromPrefs()"]');
  if (changeBtn) {
    changeBtn.textContent = t('prefs.change');
    changeBtn.title = t('prefs.pickFolder');
  }
  const forgetBtn = document.querySelector('button[onclick="clearSavedFolder()"]');
  if (forgetBtn) {
    forgetBtn.textContent = t('prefs.forget');
    forgetBtn.title = t('prefs.forgetFolder');
  }

  const loadBtn = document.querySelector('button[onclick="loadSettingsFromFolderUI()"]');
  if (loadBtn) {
    loadBtn.textContent = t('prefs.load');
    loadBtn.title = t('prefs.loadSettings');
  }
  const saveBtn = document.querySelector('button[onclick="savePrefs()"]');
  if (saveBtn) {
    saveBtn.textContent = t('prefs.save');
    saveBtn.title = t('prefs.saveSettings');
  }
  const rebuildBtn = document.querySelector('button[onclick="rebuildAll()"]');
  if (rebuildBtn) {
    const labelSpan = rebuildBtn.querySelector('[data-i18n]');
    if (labelSpan) {
      labelSpan.textContent = t('prefs.rebuild');
    } else {
      rebuildBtn.textContent = t('prefs.rebuild');
    }
    rebuildBtn.title = t('prefs.rebuildIndexes');
  }
  setElementText('#prefs-ai-language-label', t('prefs.aiLanguage'));
  setElementTitle('#prefs-ai-language', t('prefs.aiLanguageHint'));
  syncLanguageSelector();

  setElementText('#prefs-ai-return-preset-label', t('prefs.aiReturnPreset'));
  setElementTitle('#prefs-ai-return-preset', t('prefs.aiReturnPresetHint'));
  setSelectOptionText('#prefs-ai-return-preset', [
    t('prefs.aiPresetFull'),
    t('prefs.aiPresetSummaryActions'),
    t('prefs.aiPresetSummaryOnly'),
    t('prefs.aiPresetActionsOnly'),
    t('prefs.aiPresetCorrectionsOnly')
  ]);

  setElementText('#prefs-ai-schema-label', t('prefs.aiSchemaLabel'));
  const copyBtn = document.getElementById('btn-copy-ai-schema');
  if (copyBtn) {
    copyBtn.textContent = '📋 ' + (t('prefs.copySchema') || 'Copy Schema');
  }

  setElementText('#prefs-ai-connection-label', t('prefs.aiConnection'));
  setElementText('#btn-test-ai-connection', '🧪 ' + (t('llm.testConnection') || 'Test connection'));
  setElementTitle('#btn-test-ai-connection', t('llm.testConnectionTitle'));
  const aiStatusEl = document.getElementById('prefs-ai-test-status');
  if (aiStatusEl && !aiStatusEl.classList.contains('prefs-ai-status-badge--success') && !aiStatusEl.classList.contains('prefs-ai-status-badge--error') && !aiStatusEl.classList.contains('prefs-ai-status-badge--testing')) {
    aiStatusEl.textContent = t('llm.testStatusNotTested') || 'Not tested';
  }

  syncLanguageSelector();

  setElementTitle('#overlay-edit-btn', t('editor.editNoteTooltip'));
  setElementTitle('#overlay-delete-note-btn', t('editor.deleteNoteTooltip'));
  setElementTitle('#overlay-newwindow-btn', t('editor.openWindowTooltip'));
  setElementTitle('#overlay-back-btn', t('editor.backTooltip'));
  setElementTitle('.overlay-icon-btn--close', t('editor.closeTooltip'));
  const metaToggleBtn = document.getElementById('btn-overlay-toggle-meta');
  if (metaToggleBtn) {
    const isCollapsed = typeof metadataCollapsed !== 'undefined' ? metadataCollapsed : true;
    metaToggleBtn.title = isCollapsed ? (t('editor.editInfo') || 'Edit Info') : (t('editor.hideInfo') || 'Hide Info');
  }
  setElementText('#btn-overlay-toggle-meta .overlay-meta-btn-text', t('editor.metaInfoLabel') || 'Info');
  setElementTitle('#btn-overlay-ai', t('editor.aiFloatingBtnTooltip'));

  // Reload banner
  setElementText('#overlay-reload-warn-text', t('editor.reloadWarningText'));
  setElementTitle('#overlay-reload-banner button[onclick="reloadNoteFromDisk()"]', t('editor.reloadTooltip'));
  setElementTitle('#overlay-reload-banner button[onclick="dismissReloadBanner()"]', t('editor.dismissTooltip'));
  setElementText('#overlay-reload-banner button[onclick="reloadNoteFromDisk()"]', '↩ ' + (t('editor.reload') || 'Reload'));
  setElementText('#overlay-reload-banner button[onclick="dismissReloadBanner()"]', t('editor.dismiss') || 'Dismiss');

  // Markdown Action Bar & Panes
  setElementTitle('#todo-btn-add', t('editor.insertTodoTooltip'));
  setElementTitle('#decision-btn-add', t('editor.insertDecisionTooltip'));
  setElementTitle('#hr-btn-add', t('editor.hrTooltip'));
  setElementText('#hr-btn-add .popover-action-title', t('editor.insertLineTitle'));
  setElementText('#hr-btn-add .popover-action-desc', t('editor.insertLineDesc'));
  setElementTitle('#todo-link-btn', t('editor.linkTodoTooltip'));
  setElementText('#md-highlight-btn span', t('editor.keyIdeaBlock'));
  setElementTitle('#editor-zoom-out-btn', t('editor.zoomOutTooltip'));
  setElementTitle('#editor-zoom-in-btn', t('editor.zoomInTooltip'));
  setElementTitle('#editor-zoom-label', t('editor.resetZoomTooltip'));
  setElementTitle('#btn-format-aa', t('editor.formatAaTooltip'));
  setElementTitle('#fmt-btn-p', t('editor.paragraphTooltip'));
  setElementTitle('#md-format-toolbar button[onclick="insertMd(\'underline\')"]', t('editor.underlineTooltip'));

  setElementTitle('#md-format-toolbar button[onclick="insertMd(\'h1set\')"]', t('editor.h1Tooltip'));
  setElementTitle('#md-format-toolbar button[onclick="insertMd(\'h2set\')"]', t('editor.h2Tooltip'));
  setElementTitle('#md-format-toolbar button[onclick="insertMd(\'h3\')"]', t('editor.h3Tooltip'));
  setElementTitle('#md-format-toolbar button[onclick="insertMd(\'bold\')"]', t('editor.boldTooltip'));
  setElementTitle('#md-format-toolbar button[onclick="insertMd(\'italic\')"]', t('editor.italicTooltip'));
  setElementTitle('#md-format-toolbar button[onclick="insertMd(\'strike\')"]', t('editor.strikeTooltip'));
  setElementTitle('#md-highlight-btn', t('editor.highlightTooltip'));
  setElementTitle('#md-format-toolbar button[onclick="insertMd(\'code\')"]', t('editor.codeTooltip'));
  setElementTitle('#md-format-toolbar button[onclick="insertMd(\'codeblock\')"]', t('editor.codeblockTooltip'));
  setElementTitle('#md-format-toolbar button[onclick="insertMd(\'blockquote\')"]', t('editor.blockquoteTooltip'));
  setElementTitle('#md-format-toolbar button[onclick="insertMd(\'ul\')"]', t('editor.ulTooltip'));
  setElementTitle('#md-format-toolbar button[onclick="insertMd(\'ol\')"]', t('editor.olTooltip'));
  setElementTitle('#md-format-toolbar button[onclick="insertMd(\'checklist\')"]', t('editor.checklistTooltip'));
  setElementTitle('#md-format-toolbar button[onclick="insertMd(\'hr\')"]', t('editor.hrTooltip'));
  setElementTitle('#md-format-toolbar button[onclick="insertMd(\'link\')"]', t('editor.linkTooltip'));
  setElementTitle('#fmt-link-note-btn', t('editor.linkNoteTooltip'));
  setElementTitle('#md-format-toolbar button[onclick="insertMd(\'table\')"]', t('editor.tableTooltip'));
  setElementTitle('#md-format-toolbar button[onclick="insertMd(\'math\')"]', t('editor.mathTooltip'));
  setElementTitle('#md-format-toolbar button[onclick="insertMd(\'clear\')"]', t('editor.clearFormattingTooltip') || 'Clear formatting');

  setElementTitle('#dr-integrated-format-toolbar button[onclick*="formatProposal(\'underline\')"], #refactor-modal-format-toolbar button[onclick*="formatProposal(\'underline\')"]', t('editor.underlineTooltip'));
  setElementTitle('#dr-integrated-format-toolbar button[onclick*="formatProposal(\'h1set\')"], #refactor-modal-format-toolbar button[onclick*="formatProposal(\'h1set\')"]', t('editor.h1Tooltip'));
  setElementTitle('#dr-integrated-format-toolbar button[onclick*="formatProposal(\'h2set\')"], #refactor-modal-format-toolbar button[onclick*="formatProposal(\'h2set\')"]', t('editor.h2Tooltip'));
  setElementTitle('#dr-integrated-format-toolbar button[onclick*="formatProposal(\'h3\')"], #refactor-modal-format-toolbar button[onclick*="formatProposal(\'h3\')"]', t('editor.h3Tooltip'));
  setElementTitle('#dr-integrated-format-toolbar button[onclick*="formatProposal(\'bold\')"], #refactor-modal-format-toolbar button[onclick*="formatProposal(\'bold\')"]', t('editor.boldTooltip'));
  setElementTitle('#dr-integrated-format-toolbar button[onclick*="formatProposal(\'italic\')"], #refactor-modal-format-toolbar button[onclick*="formatProposal(\'italic\')"]', t('editor.italicTooltip'));
  setElementTitle('#dr-integrated-format-toolbar button[onclick*="formatProposal(\'strike\')"], #refactor-modal-format-toolbar button[onclick*="formatProposal(\'strike\')"]', t('editor.strikeTooltip'));
  setElementTitle('#dr-integrated-format-toolbar button[onclick*="formatProposal(\'mark\')"], #refactor-modal-format-toolbar button[onclick*="formatProposal(\'mark\')"]', t('editor.highlightTooltip'));
  setElementTitle('#dr-integrated-format-toolbar button[onclick*="formatProposal(\'code\')"], #refactor-modal-format-toolbar button[onclick*="formatProposal(\'code\')"]', t('editor.codeTooltip'));
  setElementTitle('#dr-integrated-format-toolbar button[onclick*="formatProposal(\'codeblock\')"], #refactor-modal-format-toolbar button[onclick*="formatProposal(\'codeblock\')"]', t('editor.codeblockTooltip'));
  setElementTitle('#dr-integrated-format-toolbar button[onclick*="formatProposal(\'blockquote\')"], #refactor-modal-format-toolbar button[onclick*="formatProposal(\'blockquote\')"]', t('editor.blockquoteTooltip'));
  setElementTitle('#dr-integrated-format-toolbar button[onclick*="formatProposal(\'ul\')"], #refactor-modal-format-toolbar button[onclick*="formatProposal(\'ul\')"]', t('editor.ulTooltip'));
  setElementTitle('#dr-integrated-format-toolbar button[onclick*="formatProposal(\'ol\')"], #refactor-modal-format-toolbar button[onclick*="formatProposal(\'ol\')"]', t('editor.olTooltip'));
  setElementTitle('#dr-integrated-format-toolbar button[onclick*="formatProposal(\'checklist\')"], #refactor-modal-format-toolbar button[onclick*="formatProposal(\'checklist\')"]', t('editor.checklistTooltip'));
  setElementTitle('#dr-integrated-format-toolbar button[onclick*="formatProposal(\'hr\')"], #refactor-modal-format-toolbar button[onclick*="formatProposal(\'hr\')"]', t('editor.hrTooltip'));
  setElementTitle('#dr-integrated-format-toolbar button[onclick*="formatProposal(\'link\')"], #refactor-modal-format-toolbar button[onclick*="formatProposal(\'link\')"]', t('editor.linkTooltip'));
  setElementTitle('#dr-integrated-format-toolbar button[onclick*="formatProposal(\'table\')"], #refactor-modal-format-toolbar button[onclick*="formatProposal(\'table\')"]', t('editor.tableTooltip'));
  setElementTitle('#dr-integrated-format-toolbar button[onclick*="formatProposal(\'math\')"], #refactor-modal-format-toolbar button[onclick*="formatProposal(\'math\')"]', t('editor.mathTooltip'));
  setElementTitle('#dr-integrated-format-toolbar button[onclick*="formatProposal(\'clear\')"], #refactor-modal-format-toolbar button[onclick*="formatProposal(\'clear\')"]', t('editor.clearFormattingTooltip') || 'Clear formatting');

  setElementTitle('#title-rename-hint span', t('editor.titleRenameHint'));
  setElementTitle('#edit-title', t('editor.clickAndTypeTitle'));
  setElementTitle('#edit-date', t('editor.clickAndChooseDate'));
  setElementTitle('#edit-textarea', t('editor.clickAndTypeContent'));
  setElementPlaceholder('#edit-textarea', t('editor.writePlaceholder'));
  setElementText('#note-summary-block .note-summary-title', t('editor.summary') || 'Summary');
  setElementText('.note-body-header .note-summary-title', t('editor.noteSectionTitle') || 'Note');

  setElementText('#label-edit-title', t('editor.titleLabel') || 'Title');
  setElementText('#label-edit-date', t('editor.dateLabel') || 'Date');
  setElementText('#label-edit-main-block', t('editor.mainBlockLabel') || 'Main Block');
  setElementText('#label-edit-group', t('editor.groupLabel') || 'Group');
  setElementText('#label-edit-workstream', t('editor.workstreamLabel') || 'Workstream');
  setElementText('#label-edit-major', t('editor.majorLabel') || 'Major');
  setElementText('#label-edit-topic', t('editor.topicLabel') || 'Topic');
  setElementText('#label-edit-associated-blocks', t('editor.associatedBlocksLabel') || 'Associated Blocks');
  setElementText('#label-edit-images', t('editor.imagesLabel') || 'Images');

  setElementTitle('#btn-insert-items', t('editor.insertItemsTooltip'));
  setElementText('#btn-insert-items .insert-label', t('editor.insertMenu') || 'Insert');

  const todoAddBtn = document.getElementById('todo-btn-add');
  if (todoAddBtn) {
    todoAddBtn.title = t('editor.insertTodoTooltip');
    const titleEl = todoAddBtn.querySelector('.popover-action-title');
    const descEl = todoAddBtn.querySelector('.popover-action-desc');
    if (titleEl && descEl) {
      titleEl.textContent = t('editor.insertTodoTitle') || 'Task / Todo';
      descEl.textContent = t('editor.insertTodoDesc') || 'Insert actionable task marker';
    } else {
      setElementHTML('#todo-btn-add', `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg> <span>${escH(t('editor.addTodoBtn') || '+ Todo')}</span>`);
    }
  }

  const decisionAddBtn = document.getElementById('decision-btn-add');
  if (decisionAddBtn) {
    decisionAddBtn.title = t('editor.insertDecisionTooltip');
    const titleEl = decisionAddBtn.querySelector('.popover-action-title');
    const descEl = decisionAddBtn.querySelector('.popover-action-desc');
    if (titleEl && descEl) {
      titleEl.textContent = t('editor.insertDecisionTitle') || 'Decision';
      descEl.textContent = t('editor.insertDecisionDesc') || 'Record an architectural or team decision';
    } else {
      setElementHTML('#decision-btn-add', `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m14 13-8.3 8.3c-.9.9-2.5.9-3.4 0-.9-.9-.9-2.5 0-3.4L10.6 9.6"/><path d="m16 15 4-4"/><path d="m20.7 5.3-5.4 5.4-2.8-2.8 5.4-5.4c.8-.8 2-.8 2.8 0 .8.8.8 2.1 0 2.8z"/></svg> <span>${escH(t('editor.addDecisionBtn') || '+ Decision')}</span>`);
    }
  }

  const todoLinkBtn = document.getElementById('todo-link-btn');
  if (todoLinkBtn) {
    todoLinkBtn.title = t('editor.linkTodoTooltip');
    const titleEl = todoLinkBtn.querySelector('.popover-action-title');
    const descEl = todoLinkBtn.querySelector('.popover-action-desc');
    if (titleEl && descEl) {
      titleEl.textContent = t('editor.linkTodoTitle') || 'Link Existing Todo';
      descEl.textContent = t('editor.linkTodoDesc') || 'Reference an existing todo at cursor';
    } else {
      setElementHTML('#todo-link-btn', `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> ${escH(t('editor.linkTodoAction') || 'Link')}`);
    }
  }

  const templateApplyBtn = document.getElementById('btn-apply-template');
  if (templateApplyBtn) {
    templateApplyBtn.title = t('templates.openPickerTooltip');
    const titleEl = templateApplyBtn.querySelector('.popover-action-title');
    const descEl = templateApplyBtn.querySelector('.popover-action-desc');
    if (titleEl && descEl) {
      titleEl.textContent = t('templates.templateBtn') || 'Template';
      descEl.textContent = t('templates.templateDesc') || 'Apply a structured meeting or planning template';
    }
  }

  setElementTitle('#link-todo-inspector-btn', t('editor.linkTodoInspectorTooltip') || 'Link an existing task to this note');

  const summaryEditor = document.getElementById('edit-summary');
  if (summaryEditor) {
    summaryEditor.setAttribute('data-placeholder', t('editor.summaryPlaceholder') || 'Summary of the call...');
    summaryEditor.title = t('editor.summaryTitle') || 'Summary of the call';
  }

  setElementText('#todo-overlay-edit-btn', t('todo.editTodo'));
  setElementTitle('#todo-overlay-edit-btn', t('todo.editTodo'));
  setElementTitle('#todo-edit-overlay .overlay-close-btn', t('todo.closeOverlay'));
  setElementText('#todo-done-banner span', t('todo.doneBanner'));
  setElementText('#todo-view-done-btn', t('todo.setDone'));
  setElementTitle('#todo-view-done-btn', t('todo.setDone'));
  setElementText('#todo-view-reopen-btn', t('todo.reopenAs'));
  setElementTitle('#todo-view-reopen-btn', t('todo.reopenAs'));
  setElementTitle('#todo-view-reopen-priority', t('todo.choosePriority'));
  setSelectOptionText('#todo-view-reopen-priority', [t('todo.high'), t('todo.medium'), t('todo.low')]);
  setElementText('#todo-view-body .btn[onclick="closeTodoOverlay()"]', t('todo.close'));
  setElementText('#todo-view-blocks-label', t('todo.plannedBlocks'));
  setElementTitle('#todo-edit-title', t('todo.clickToTypeTitle'));
  setElementTitle('#todo-edit-priority', t('todo.clickToChoosePriority'));
  setElementTitle('#todo-edit-owner', t('todo.clickToTypeOwner'));
  setElementTitle('#todo-edit-context', t('todo.clickToTypeContext'));
  setSelectOptionText('#todo-edit-priority', [t('todo.high'), t('todo.medium'), t('todo.low'), t('todo.done')]);
  setElementHTML('#todo-edit-body .todo-edit-label:nth-of-type(1)', t('todo.title'));
  setElementHTML('#todo-edit-body .todo-edit-label:nth-of-type(2)', t('todo.priority'));
  setElementHTML('#todo-edit-workstream-label', `${t('todo.workstreamLabel')} <span class="todo-field-hint">(${t('todo.optional')})</span>`);
  setElementTitle('#todo-edit-workstream', t('todo.workstreamTooltip'));
  setElementHTML('#todo-edit-body .todo-edit-label:nth-of-type(3)', `${t('todo.owner')} <span class="todo-field-hint">${t('todo.optional')}</span>`);
  setElementHTML('#todo-edit-body .todo-edit-label:nth-of-type(4)', t('todo.status'));
  setElementHTML('#todo-edit-body .todo-edit-label:nth-of-type(5)', t('todo.context'));
  setElementText('#todo-edit-body .todo-status-toggle span', t('todo.inProgress'));
  setElementText('#todo-edit-body .btn-danger', `🗑 ${t('todo.delete')}`);
  setElementText('#todo-edit-body .todo-edit-actions-right .btn:not(.btn-save)', t('todo.cancel'));
  setElementTitle('#todo-edit-body .todo-edit-actions-right .btn:not(.btn-save)', t('todo.cancelChangesTooltip'));
  setElementText('#todo-edit-body .todo-edit-actions-right .btn.btn-save', t('todo.save'));
  setElementTitle('#todo-edit-body .todo-edit-actions-right .btn.btn-save', t('todo.saveTodoTooltip'));
  setElementTitle('#todo-matrix-picker-btn', t('todo.applyPositionTooltip'));
  setElementText('#todo-matrix-picker-cancel-btn', t('todo.cancel'));
  setElementTitle('#todo-matrix-picker-cancel-btn', t('todo.cancelMatrixPickerTooltip'));
  setElementText('#todo-matrix-picker-confirm-btn', t('todo.applyPosition'));
  setElementTitle('#todo-matrix-picker-confirm-btn', t('todo.applyPositionTooltip'));
  setElementText('#todo-matrix-picker-title', t('todo.positionInMatrix') || 'Position in Eisenhower Matrix');
  setElementText('#btn-accept-summary-proposal', t('refactor.acceptSummaryProposal'));
  setElementTitle('#btn-accept-summary-proposal', t('refactor.acceptSummaryTooltip'));
  setElementText('#btn-reject-summary-proposal', t('refactor.rejectSummaryProposal'));
  setElementTitle('#btn-reject-summary-proposal', t('refactor.rejectSummaryTooltip'));

  const newNoteTitleEl = document.querySelector('#modal-new-note h2 span') || document.querySelector('#modal-new-note h2');
  if (newNoteTitleEl) newNoteTitleEl.textContent = t('editor.newNoteTitle');
  setElementText('#modal-new-note .form-field:nth-of-type(1) > label', t('editor.noteTitle'));
  setElementText('#modal-new-note .form-field:nth-of-type(2) > label', t('editor.noteDate'));
  setElementText('#modal-new-note .form-field:nth-of-type(3) > label', t('editor.groupTag'));
  setElementText('#modal-new-note .form-field:nth-of-type(3) .form-hint', t('editor.firstLevelFolder'));
  setElementText('#modal-new-note .form-field:nth-of-type(4) > label', t('editor.majorTopicTag'));
  setElementText('#modal-new-note .form-field:nth-of-type(5) > label', t('editor.topicTag'));
  setElementText('#modal-new-note .form-field:nth-of-type(5) .form-hint', t('editor.secondLevelFolder'));
  setElementText('#modal-new-note .form-field:nth-of-type(6) > label', t('editor.content'));
  setElementText('#md-tab-write', t('editor.mdWrite'));
  setElementText('#md-tab-preview', t('editor.mdPreview'));
  setElementText('#md-tab-write', t('editor.mdWrite'));
  setElementText('#md-tab-preview', t('editor.mdPreview'));
  setElementText('#md-tab-write', t('editor.mdWrite'));
  setElementText('#md-tab-preview', t('editor.mdPreview'));
  setElementText('#md-tab-preview + .md-tab-hint', t('editor.mdHint'));
  setElementTitle('#md-highlight-btn', t('editor.highlightSelection'));
  setElementPlaceholder('#nn-title', t('editor.clickAndTypeTitle'));
  setElementPlaceholder('#nn-date', '');
  setElementPlaceholder('#nn-group', t('editor.clickAndTypeGroup'));
  setElementPlaceholder('#nn-major', t('editor.clickAndTypeMajor'));
  setElementPlaceholder('#nn-topic', t('editor.clickAndTypeTopic'));
  setElementPlaceholder('#nn-content', t('editor.noteContentPlaceholder'));
  setElementTitle('#nn-title', t('editor.clickAndTypeTitle'));
  setElementTitle('#nn-date', t('editor.clickAndChooseDate'));
  setElementTitle('#nn-group', t('editor.clickAndTypeGroup'));
  setElementTitle('#nn-major', t('editor.clickAndTypeMajor'));
  setElementTitle('#nn-topic', t('editor.clickAndTypeTopic'));
  setElementTitle('#nn-content', t('editor.clickAndTypeContent'));
  setElementText('#modal-new-note .modal-actions button:nth-of-type(1)', t('editor.cancel'));
  setElementTitle('#modal-new-note .modal-actions button:nth-of-type(1)', t('editor.cancelNoteModalTooltip'));
  setElementText('#modal-new-note .modal-actions button:nth-of-type(2)', t('editor.createNote'));
  setElementTitle('#modal-new-note .modal-actions button:nth-of-type(2)', t('editor.createNoteTooltip'));

  setElementText('#label-manager-title', t('editor.labelManager'));

  setElementText('#nt-dialog-title', t('todo.newTodo'));
  setElementHTML('#modal-new-todo .form-field:nth-of-type(1) > label', `${t('todo.title')} <span style="color:#bbb;font-weight:normal">${t('todo.usedAsFileName')}</span>`);
  setElementText('#modal-new-todo .form-field:nth-of-type(2) > label', t('todo.description'));
  setElementText('#modal-new-todo .form-field:nth-of-type(3) > label', t('todo.priority'));
  setElementHTML('#modal-new-todo .form-field:nth-of-type(4) > label', `${t('todo.dueDate')} <span style="color:#bbb;font-weight:normal">${t('todo.optional')}</span>`);
  setElementHTML('#modal-new-todo .form-field:nth-of-type(5) > label', `${t('todo.owner')} <span style="color:#bbb;font-weight:normal">${t('todo.optional')}</span>`);
  setElementHTML('#modal-new-todo .form-field:nth-of-type(6) > label', `${t('todo.context')} <span style="color:#bbb;font-weight:normal">${t('todo.optional')}</span>`);
  setElementText('#nt-priority option[value="WIP"]', `🟣 ${t('todo.wip')}`);
  setElementText('#nt-priority option[value="High"]', `🔴 ${t('todo.high')}`);
  setElementText('#nt-priority option[value="Medium"]', `🟡 ${t('todo.medium')}`);
  setElementText('#nt-priority option[value="Low"]', `🟢 ${t('todo.low')}`);
  setElementPlaceholder('#nt-title', t('todo.todoTitlePlaceholder'));
  setElementPlaceholder('#nt-text', t('todo.todoDescriptionPlaceholder'));
  setElementTitle('#nt-due-date', t('todo.todoDueDatePlaceholder'));
  setElementTitle('#nt-owner-picker', t('todo.clickToTypeOwner'));
  setElementPlaceholder('#nt-context', t('todo.todoContextPlaceholder'));
  setElementTitle('#nt-title', t('todo.clickToTypeTitle'));
  setElementTitle('#nt-text', t('todo.todoDescriptionPlaceholder'));
  setElementTitle('#nt-context', t('todo.clickToTypeContext'));
  setElementText('#modal-new-todo .modal-actions button:nth-of-type(1)', t('todo.cancel'));
  setElementTitle('#modal-new-todo .modal-actions button:nth-of-type(1)', t('todo.cancelTodoModalTooltip'));
  setElementText('#modal-new-todo .modal-actions button:nth-of-type(2)', t('todo.save'));
  setElementTitle('#modal-new-todo .modal-actions button:nth-of-type(2)', t('todo.saveTodoModalTooltip'));
  setElementText('#nt-schedule-label', t('todo.scheduleLabel'));
  setElementText('#nt-schedule option[value="next-slot"]', t('todo.scheduleNextSlot'));
  setElementText('#nt-schedule option[value="open-modal"]', t('todo.scheduleOpenModal'));
  setElementText('#nt-schedule option[value="none"]', t('todo.scheduleNone'));

  // Omnibar
  setElementPlaceholder('#omnibar-input', t('omnibar.inputPlaceholder'));
  setElementTitle('#omnibar-ai-btn', t('omnibar.hintSecretary') || "Appeler l'assistant");
  setElementText('#omnibar-lbl-select', t('omnibar.footerSelect') || 'Sélectionner');
  setElementText('#omnibar-lbl-nav', t('omnibar.footerNavigate') || 'Naviguer');
  setElementText('#omnibar-lbl-auto', t('omnibar.footerAutocomplete') || 'Compléter');
  setElementText('#omnibar-lbl-close', t('omnibar.footerClose') || 'Fermer');
  const hintsContainer = document.querySelector('.omnibar-hints');
  if (hintsContainer) {
    const cmdTodo = t('omnibar.cmdTodo') || '/todo';
    const cmdBlock = t('omnibar.cmdBlock') || '/block';
    const cmdCall = t('omnibar.cmdCall') || '/call';
    const cmdDec = t('omnibar.cmdDec') || '/dec';
    const cmdNote = t('omnibar.cmdNote') || '/note';
    const cmdStash = t('omnibar.cmdStash') || '/stash';
    const cmdSec = t('omnibar.cmdSecretary') || '/secretary';

    hintsContainer.innerHTML = `
      <span class="omnibar-hint-pill" onclick="OmnibarController.setCommandPrefix('${cmdTodo}')"><code>${cmdTodo}</code> ${t('omnibar.hintTodo') || 'Create a task'}</span>
      <span class="omnibar-hint-pill" onclick="OmnibarController.setCommandPrefix('${cmdBlock}')"><code>${cmdBlock}</code> ${t('omnibar.hintBlock') || 'Create planner block'}</span>
      <span class="omnibar-hint-pill" onclick="OmnibarController.setCommandPrefix('${cmdCall}')"><code>${cmdCall}</code> ${t('omnibar.hintCall') || 'Create call & note'}</span>
      <span class="omnibar-hint-pill" onclick="OmnibarController.setCommandPrefix('${cmdDec}')"><code>${cmdDec}</code> ${t('omnibar.hintDec') || 'Record decision'}</span>
      <span class="omnibar-hint-pill" onclick="OmnibarController.setCommandPrefix('${cmdNote}')"><code>${cmdNote}</code> ${t('omnibar.hintNote') || 'New note'}</span>
      <span class="omnibar-hint-pill" onclick="OmnibarController.setCommandPrefix('${cmdStash}')"><code>${cmdStash}</code> ${t('omnibar.hintStash') || 'Capture thought'}</span>
      <span class="omnibar-hint-pill" onclick="OmnibarController.setCommandPrefix('${cmdSec}')"><code>${cmdSec}</code> ${t('omnibar.hintSecretary') || 'Ask assistant'}</span>
    `;
  }

  initLocalizedHoverObserver();
  scheduleLocalizedHoverTitles(document);
  if (window.DailyReviewController) {
    try { window.DailyReviewController.localizeUI(); } catch (e) { }
  }
  if (typeof updateLLMToolbarVisibility === 'function') {
    try { updateLLMToolbarVisibility(); } catch (e) { }
  }
}

function setAppLanguage(lang, { persist = true } = {}) {
  const normalized = normalizeLanguageCode(lang);
  appLanguage = normalized;
  if (typeof settings !== 'undefined' && settings) {
    settings.language = normalized;
    if (persist && typeof saveLocalSettings === 'function') saveLocalSettings();
  }
  applyLocalizedUI();
  return normalized;
}

const setLanguage = setAppLanguage;

if (typeof window !== 'undefined') {
  window.setAppLanguage = setAppLanguage;
  window.setLanguage = setLanguage;
}

