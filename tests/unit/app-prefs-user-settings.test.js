import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Preferences User Settings Tab & User Info Promotion', () => {
  beforeAll(() => {
    globalThis.window = globalThis.window || {};
    globalThis.normalizeLanguageCode = (c) => c || 'en';
    globalThis.applyLocalizedUI = () => {};
    loadScriptsIntoGlobal([
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-utils.js',
      'js/app-init.js'
    ]);
  });

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="prefs-panel">
        <button id="prefs-tab-general-btn" class="active">User Settings</button>
        <button id="prefs-tab-sync-btn">Cloud Sync</button>
        <div id="prefs-sec-user-info" style="display:none;"></div>
        <div id="prefs-sec-profile" style="display:none;"></div>
        <div id="prefs-sec-language" style="display:none;"></div>
        <div id="prefs-sec-sync" style="display:none;"></div>
        <div id="prefs-sec-storage" style="display:none;"></div>
        <div id="prefs-sec-display" style="display:none;"></div>
      </div>
    `;
    globalThis.activePrefsTab = 'general';
    globalThis.settings = { storageEngine: 'filesystem' };
    window.FirebaseSyncService = { state: { engine: 'filesystem' } };
  });

  it('translates prefs.tabGeneral to "User Settings" across all 15 supported languages', () => {
    expect(globalThis.t('prefs.tabGeneral')).toBe('User Settings');
    const bundle = window.APP_TRANSLATIONS_BUNDLE?.translations;
    expect(bundle).toBeDefined();
    const supportedLangs = ['en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'cs', 'hu', 'pl', 'ro', 'ru', 'sv', 'tr', 'uk'];
    supportedLangs.forEach(lang => {
      const val = bundle['prefs.tabGeneral']?.[lang];
      expect(val).toBeDefined();
      expect(typeof val).toBe('string');
      expect(val.length).toBeGreaterThan(0);
      expect(val).not.toBe('General');
    });
  });

  it('switchPrefsTab("general") shows user info, profile, and language sections in general tab', () => {
    switchPrefsTab('general');

    const userInfo = document.getElementById('prefs-sec-user-info');
    const profile = document.getElementById('prefs-sec-profile');
    const lang = document.getElementById('prefs-sec-language');
    const sync = document.getElementById('prefs-sec-sync');

    expect(userInfo.style.display).toBe('block');
    expect(profile.style.display).toBe('block');
    expect(lang.style.display).toBe('block');
    expect(sync.style.display).toBe('none');
  });

  it('switchPrefsTab switches cleanly between general (user settings) and sync tabs', () => {
    // In local mode, sync tab only shows sync section, not cloud user info
    switchPrefsTab('sync');
    const userInfo = document.getElementById('prefs-sec-user-info');
    const sync = document.getElementById('prefs-sec-sync');
    const profile = document.getElementById('prefs-sec-profile');

    expect(sync.style.display).toBe('block');
    expect(userInfo.style.display).toBe('none');
    expect(profile.style.display).toBe('none');

    // In firebase mode, sync tab also shows user info
    window.FirebaseSyncService = { state: { engine: 'firebase' } };
    switchPrefsTab('sync');
    expect(userInfo.style.display).toBe('block');

    // Switching back to general always shows user info
    switchPrefsTab('general');
    expect(sync.style.display).toBe('none');
    expect(userInfo.style.display).toBe('block');
    expect(profile.style.display).toBe('block');
  });

  it('positions prefs-sec-user-info before prefs-sec-profile in app.html DOM structure', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const appHtmlPath = path.resolve(__dirname, '../../app.html');
    const htmlContent = fs.readFileSync(appHtmlPath, 'utf8');

    const userInfoIdx = htmlContent.indexOf('id="prefs-sec-user-info"');
    const profileIdx = htmlContent.indexOf('id="prefs-sec-profile"');

    expect(userInfoIdx).toBeGreaterThan(-1);
    expect(profileIdx).toBeGreaterThan(-1);
    expect(userInfoIdx).toBeLessThan(profileIdx);
  });
});
