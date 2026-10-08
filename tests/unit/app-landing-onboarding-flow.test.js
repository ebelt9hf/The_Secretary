import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Landing Screen Onboarding & Language Flow', () => {
  beforeAll(() => {
    loadScriptsIntoGlobal([
      'js/app-state.js',
      'js/app-utils.js',
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-bridge.js',
      'js/app-fs.js',
      'js/app-storage.js',
      'js/app-init.js'
    ]);
  });

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="screen-connect" class="loading">
        <div id="screen-connect-card">
          <div class="landing-topbar" id="landing-topbar">
            <button type="button" class="landing-btn-back" id="btn-landing-back" onclick="showLandingStep('welcome')" style="display:none;">Back</button>
            <div class="landing-lang-wrapper" id="landing-lang-wrapper">
              <select id="landing-language-select" class="landing-lang-select" onchange="changeLandingLanguage(this.value)"></select>
            </div>
          </div>
          <div id="landing-step-welcome" class="landing-step-view">
            <h1>Secretary</h1>
            <p class="landing-desc" data-i18n="landing.description">Browse, edit, and manage your notes</p>
            <button id="btn-landing-setup" onclick="showLandingStep('setup')"><span data-i18n="landing.getStarted">Set Up Workspace</span></button>
            <div id="landing-resume-wrap" style="display:none">
              <button id="btn-resume-folder"><span id="btn-resume-folder-label">Resume workspace</span><span id="btn-resume-folder-name"></span></button>
            </div>
          </div>
          <div id="landing-step-setup" class="landing-step-view landing-step-setup" style="display:none;">
            <h2 class="landing-setup-title" data-i18n="landing.setupTitle">Choose Workspace Storage</h2>
            <p class="landing-setup-subtitle" data-i18n="landing.setupDesc">Select how and where you want Secretary to store and sync your notes</p>
            <div class="landing-storage-grid">
              <div class="landing-storage-card landing-storage-card-local">
                <h3 data-i18n="landing.localOptionTitle">Local Folder</h3>
                <p data-i18n="landing.localOptionDesc">Direct disk access</p>
                <button id="btn-open-folder"><span id="btn-open-folder-text" data-i18n="landing.localOptionBtn">Open Local Folder</span></button>
              </div>
              <div class="landing-storage-card landing-storage-card-cloud">
                <h3 data-i18n="landing.cloudOptionTitle">Encrypted Cloud Vault</h3>
                <p data-i18n="landing.cloudOptionDesc">End-to-end encrypted storage</p>
                <button id="btn-landing-cloud-link"><span data-i18n="landing.cloudOptionBtn">Connect Cloud Vault</span></button>
              </div>
              <div class="landing-storage-card landing-storage-card-demo">
                <h3 data-i18n="landing.sandboxOptionTitle">Quick Start / Demo</h3>
                <p data-i18n="landing.sandboxOptionDesc">Explore sample notes</p>
                <button id="btn-landing-sandbox"><span data-i18n="landing.sandboxOptionBtn">Launch Demo Workspace</span></button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <select id="prefs-language"></select>
    `;
    localStorage.clear();
  });

  describe('Default Language & Localization', () => {
    it('defaults appLanguage to browser language or "en", not hardcoded "fr"', () => {
      expect(typeof getBrowserLanguageCode).toBe('function');
      const browserCode = getBrowserLanguageCode();
      expect(browserCode).toBeTruthy();
      expect(typeof browserCode).toBe('string');
      // normalizeLanguageCode with undefined/empty should be 'en'
      expect(normalizeLanguageCode('')).toBe('en');
    });

    it('populates landing language selector with all 15 supported languages', () => {
      syncLanguageSelector();
      const select = document.getElementById('landing-language-select');
      expect(select).toBeTruthy();
      expect(select.options.length).toBe(15);
      
      const optionCodes = Array.from(select.options).map(o => o.value);
      expect(optionCodes).toContain('en');
      expect(optionCodes).toContain('fr');
      expect(optionCodes).toContain('de');
      expect(optionCodes).toContain('es');
      expect(optionCodes).toContain('it');
      expect(optionCodes).toContain('uk');
    });

    it('changes language immediately upon selecting another language and applies to UI', () => {
      syncLanguageSelector();
      changeLandingLanguage('de');
      expect(getAppLanguage()).toBe('de');
      expect(settings.language).toBe('de');
      
      const welcomeBtn = document.querySelector('#btn-landing-setup span');
      expect(welcomeBtn.textContent).toBe(t('landing.getStarted', { lang: 'de' }));
      expect(welcomeBtn.textContent).not.toBe('Set Up Workspace'); // Should be German: 'Arbeitsbereich einrichten'
    });

    it('syncs both landing and prefs language selectors simultaneously', () => {
      changeLandingLanguage('es');
      const landingSelect = document.getElementById('landing-language-select');
      const prefsSelect = document.getElementById('prefs-language');
      expect(landingSelect.value).toBe('es');
      expect(prefsSelect.value).toBe('es');
    });
  });

  describe('2-Step Landing Navigation', () => {
    it('initializes on Step 1 (Welcome Screen)', () => {
      const welcomeStep = document.getElementById('landing-step-welcome');
      const setupStep = document.getElementById('landing-step-setup');
      const btnBack = document.getElementById('btn-landing-back');
      
      expect(welcomeStep.style.display).not.toBe('none');
      expect(setupStep.style.display).toBe('none');
      expect(btnBack.style.display).toBe('none');
    });

    it('transitions to Step 2 (Setup Screen) when showLandingStep("setup") is called', () => {
      showLandingStep('setup');
      const welcomeStep = document.getElementById('landing-step-welcome');
      const setupStep = document.getElementById('landing-step-setup');
      const btnBack = document.getElementById('btn-landing-back');
      const card = document.getElementById('screen-connect-card');
      
      expect(welcomeStep.style.display).toBe('none');
      expect(setupStep.style.display).toBe('flex');
      expect(btnBack.style.display).toBe('inline-flex');
      expect(card.classList.contains('is-setup-step')).toBe(true);
    });

    it('returns to Step 1 (Welcome Screen) when showLandingStep("welcome") is called', () => {
      showLandingStep('setup');
      showLandingStep('welcome');
      const welcomeStep = document.getElementById('landing-step-welcome');
      const setupStep = document.getElementById('landing-step-setup');
      const btnBack = document.getElementById('btn-landing-back');
      const card = document.getElementById('screen-connect-card');
      
      expect(welcomeStep.style.display).toBe('flex');
      expect(setupStep.style.display).toBe('none');
      expect(btnBack.style.display).toBe('none');
      expect(card.classList.contains('is-setup-step')).toBe(false);
    });
  });

  describe('Workspace Storage Options in Step 2', () => {
    it('presents 3 distinct storage options on Step 2', () => {
      showLandingStep('setup');
      const localCard = document.querySelector('.landing-storage-card-local');
      const cloudCard = document.querySelector('.landing-storage-card-cloud');
      const demoCard = document.querySelector('.landing-storage-card-demo');
      
      expect(localCard).toBeTruthy();
      expect(cloudCard).toBeTruthy();
      expect(demoCard).toBeTruthy();

      expect(document.getElementById('btn-open-folder')).toBeTruthy();
      expect(document.getElementById('btn-landing-cloud-link')).toBeTruthy();
      expect(document.getElementById('btn-landing-sandbox')).toBeTruthy();
    });

    it('localizes all storage option card titles and descriptions across languages', () => {
      changeLandingLanguage('fr');
      const setupTitle = document.querySelector('.landing-setup-title');
      const localBtn = document.getElementById('btn-open-folder-text');
      
      expect(setupTitle.textContent).toBe('Choisir le stockage de l\'espace de travail');
      expect(localBtn.textContent).toBe('Ouvrir un dossier local');
    });
  });
});
