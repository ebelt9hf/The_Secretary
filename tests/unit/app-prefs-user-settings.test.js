import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Preferences User Settings Tab & Section Promotion', () => {
  beforeAll(() => {
    document.body.innerHTML = `
      <div id="prefs-panel">
        <div class="prefs-tabs" role="tablist">
          <button class="prefs-tab-btn active" id="prefs-tab-general-btn" data-tab="general" onclick="switchPrefsTab('general')" role="tab" aria-selected="true">
            <span data-i18n="prefs.tabGeneral">User Settings</span>
          </button>
          <button class="prefs-tab-btn" id="prefs-tab-appearance-btn" data-tab="appearance" onclick="switchPrefsTab('appearance')" role="tab" aria-selected="false">Appearance</button>
          <button class="prefs-tab-btn" id="prefs-tab-sync-btn" data-tab="sync" onclick="switchPrefsTab('sync')" role="tab" aria-selected="false">Cloud Sync</button>
        </div>

        <div class="prefs-section" id="prefs-sec-user-info" style="display:none;"></div>
        <div class="prefs-section" id="prefs-sec-profile" style="display:block;"></div>
        <div class="prefs-section" id="prefs-sec-language" style="display:block;"></div>
        <div class="prefs-section" id="prefs-sec-appearance" style="display:none;"></div>
        <div class="prefs-section" id="prefs-sec-sync" style="display:none;"></div>
      </div>
    `;

    loadScriptsIntoGlobal([
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-utils.js',
      'js/app-firebase-sync.js',
      'js/app-init.js'
    ]);
  });

  it('translates prefs.tabGeneral to User Settings in English and localized in all languages', () => {
    const bundle = window.APP_TRANSLATIONS_BUNDLE.translations['prefs.tabGeneral'];
    expect(bundle.en).toBe('User Settings');
    expect(bundle.fr).toBe('Paramètres utilisateur');
    expect(bundle.de).toBe('Benutzereinstellungen');
    expect(bundle.es).toBe('Ajustes de usuario');
    expect(bundle.it).toBe('Impostazioni utente');
  });

  it('promotes prefs-sec-user-info into general tab in switchPrefsTab', () => {
    window.FirebaseSyncService.state.engine = 'firebase';
    const userInfoSec = document.getElementById('prefs-sec-user-info');
    const profileSec = document.getElementById('prefs-sec-profile');
    const appSec = document.getElementById('prefs-sec-appearance');

    // Switch to appearance
    window.switchPrefsTab('appearance');
    expect(userInfoSec.style.display).toBe('none');
    expect(profileSec.style.display).toBe('none');
    expect(appSec.style.display).toBe('block');

    // Switch to general (User Settings)
    window.switchPrefsTab('general');
    expect(userInfoSec.style.display).toBe('block');
    expect(profileSec.style.display).toBe('block');
    expect(appSec.style.display).toBe('none');
  });

  it('positions prefs-sec-user-info before prefs-sec-profile in app.html DOM structure', () => {
    const appHtmlPath = path.resolve(__dirname, '../../app.html');
    const htmlContent = fs.readFileSync(appHtmlPath, 'utf8');

    const userInfoIdx = htmlContent.indexOf('id="prefs-sec-user-info"');
    const profileIdx = htmlContent.indexOf('id="prefs-sec-profile"');

    expect(userInfoIdx).toBeGreaterThan(-1);
    expect(profileIdx).toBeGreaterThan(-1);
    expect(userInfoIdx).toBeLessThan(profileIdx);
  });
});
