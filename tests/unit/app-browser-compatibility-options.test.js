import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Browser Compatibility & 3 Storage Options (tests/unit/app-browser-compatibility-options.test.js)', () => {
  beforeAll(() => {
    globalThis.window = globalThis.window || {};
    globalThis.t = (key) => key;
    globalThis.escH = (s) => String(s || '');
    globalThis.escA = (s) => String(s || '');
    globalThis.normalizeLanguageCode = (c) => c || 'en';
    globalThis.applyLocalizedUI = () => {};
    globalThis.toast = vi.fn();
    globalThis.showToast = vi.fn();

    loadScriptsIntoGlobal([
      'js/firebase-config.js',
      'js/app-crypto.js',
      'js/app-storage.js',
      'js/app-firebase-sync.js',
      'js/app-utils.js',
      'js/app-init.js'
    ]);
  });

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="screen-connect" class="loading">
        <div id="screen-connect-card">
          <div id="landing-resume-wrap" style="display:none">
            <button id="btn-resume-folder"></button>
          </div>
          <div id="landing-divider" style="display:none"></div>
          <button id="btn-open-folder"></button>
          <p id="connect-status-hint"></p>
        </div>
      </div>
      <div id="screen-main"></div>
      <div class="modal-overlay" id="modal-cloud-sync-setup" style="display:none">
        <div id="sync-custom-firebase-body" style="display:none">
          <textarea id="sync-custom-firebase-json"></textarea>
        </div>
        <input type="password" id="sync-setup-passphrase" />
        <input type="text" id="sync-setup-sync-code" />
        <button id="btn-submit-cloud-sync" data-mode="new"></button>
      </div>
    `;

    globalThis.openModal = vi.fn((id) => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'flex';
    });
    globalThis.closeModal = vi.fn((id) => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  });

  it('renders 3 distinct options when File System Access API is unavailable in Safari/Firefox', () => {
    window.renderBrowserCompatibilityOptions();

    const optionsContainer = document.getElementById('browser-compatibility-options');
    expect(optionsContainer).not.toBeNull();

    // Option A: Chrome / Desktop
    const optionA = document.getElementById('landing-option-chrome');
    expect(optionA).not.toBeNull();
    expect(optionA.textContent).toContain('landing.optionChromeTitle');

    // Option B: Own Firebase
    const optionB = document.getElementById('landing-option-own-firebase');
    expect(optionB).not.toBeNull();
    expect(optionB.textContent).toContain('landing.optionOwnFirebaseTitle');

    // Option C: Etienne's Managed Firebase
    const optionC = document.getElementById('landing-option-managed-firebase');
    expect(optionC).not.toBeNull();
    expect(optionC.textContent).toContain('landing.optionManagedFirebaseTitle');

    // Container should be attached to card
    const card = document.getElementById('screen-connect-card');
    expect(card.contains(optionsContainer)).toBe(true);
  });

  it('openCustomFirebaseSetupFromLanding opens setup modal and expands custom Firebase JSON body', () => {
    window.renderBrowserCompatibilityOptions();
    window.openCustomFirebaseSetupFromLanding();

    expect(globalThis.openModal).toHaveBeenCalledWith('modal-cloud-sync-setup');
    const customBody = document.getElementById('sync-custom-firebase-body');
    expect(customBody.style.display).toBe('block');
  });

  it('openManagedFirebaseSetupFromLanding opens setup modal with default Etienne managed Firebase configuration', () => {
    window.renderBrowserCompatibilityOptions();
    window.openManagedFirebaseSetupFromLanding();

    expect(globalThis.openModal).toHaveBeenCalledWith('modal-cloud-sync-setup');
    const customBody = document.getElementById('sync-custom-firebase-body');
    expect(customBody.style.display).toBe('none');
  });

  it('copyWebAppUrl copies current URL and updates button state', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: writeTextMock
      },
      configurable: true
    });

    const btn = document.createElement('button');
    btn.id = 'btn-copy-app-url';
    document.body.appendChild(btn);

    await window.copyWebAppUrl(btn);
    expect(writeTextMock).toHaveBeenCalled();
  });
});
