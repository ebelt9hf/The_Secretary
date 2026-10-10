import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { Window } from 'happy-dom';

describe('Web Log Off & Cloud Login Security Notice (tests/unit/app-web-logoff-and-security-notice.test.js)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('contains the security notice in translations for all 15 languages', () => {
    const translationsCode = fs.readFileSync(path.join(process.cwd(), 'js/translations.js'), 'utf-8');
    const fn = new Function('window', translationsCode + '; return window.APP_TRANSLATIONS_BUNDLE;');
    const mockWin = {};
    const bundle = fn(mockWin);
    const tMap = bundle.translations;

    expect(tMap['sync.localEnvMachineWarning']).toBeDefined();
    expect(tMap['confirm.logOffNotPossibleTitle']).toBeDefined();
    expect(tMap['confirm.logOffNotPossibleMessage']).toBeDefined();
    expect(tMap['confirm.logOffNotPossibleToast']).toBeDefined();
    expect(tMap['sync.logOffBtn']).toBeDefined();
    expect(tMap['sync.logOffTooltip']).toBeDefined();

    const expectedLangs = ['cs', 'de', 'en', 'es', 'fr', 'hu', 'it', 'nl', 'pl', 'pt', 'ro', 'ru', 'sv', 'tr', 'uk'];
    for (const lang of expectedLangs) {
      expect(tMap['sync.localEnvMachineWarning'][lang]).toBeTruthy();
      expect(tMap['confirm.logOffNotPossibleTitle'][lang]).toBeTruthy();
      expect(tMap['confirm.logOffNotPossibleMessage'][lang]).toBeTruthy();
      expect(tMap['confirm.logOffNotPossibleToast'][lang]).toBeTruthy();
      expect(tMap['sync.logOffBtn'][lang]).toBeTruthy();
      expect(tMap['sync.logOffTooltip'][lang]).toBeTruthy();
    }
  });

  it('includes cloud login security notice in modal-cloud-sync-setup and landing setup screen', () => {
    const modalsHtml = fs.readFileSync(path.join(process.cwd(), 'templates/modals.html'), 'utf-8');
    const appHtml = fs.readFileSync(path.join(process.cwd(), 'app.html'), 'utf-8');

    // Cloud setup modal should display the security notice
    expect(modalsHtml).toContain('data-i18n="sync.localEnvMachineWarning"');
    expect(modalsHtml).toContain('id="modal-logoff-local-warning"');

    // Landing setup options should display the security notice
    expect(appHtml).toContain('data-i18n="sync.localEnvMachineWarning"');
    // Topbar should have logoff button
    expect(appHtml).toContain('id="btn-topbar-logoff"');
  });

  it('prevents log off when data is saved locally and warns user with modal and toast', async () => {
    const window = new Window();
    globalThis.window = window;
    globalThis.document = window.document;

    const modalEl = window.document.createElement('div');
    modalEl.id = 'modal-logoff-local-warning';
    window.document.body.appendChild(modalEl);

    const openedModals = [];
    const toasts = [];

    globalThis.openModal = vi.fn((id) => openedModals.push(id));
    globalThis.showToast = vi.fn((msg, isErr) => toasts.push({ msg, isErr }));
    globalThis.t = vi.fn((key) => key);
    globalThis.rootHandle = { name: 'my-local-notes' };
    globalThis.StorageAPI = {
      getStorageEngine: vi.fn(() => 'filesystem')
    };

    // Extract handleLogOffUI definition from app-init.js
    const appInitCode = fs.readFileSync(path.join(process.cwd(), 'js/app-init.js'), 'utf-8');
    const match = appInitCode.match(/async function handleLogOffUI\(\)\s*\{[\s\S]*?\n\}\nwindow\.handleLogOffUI = handleLogOffUI;/);
    expect(match).not.toBeNull();

    const evalFn = new Function(match[0] + '; return handleLogOffUI;');
    const handleLogOffUI = evalFn();

    const result = await handleLogOffUI();
    expect(result).toBe(false);
    expect(openedModals).toContain('modal-logoff-local-warning');
    expect(toasts.length).toBeGreaterThan(0);
    expect(toasts[0].isErr).toBe(true);
    expect(toasts[0].msg).toBe('confirm.logOffNotPossibleToast');
  });

  it('allows log off when data is in cloud vault (not saved locally), signing out and resetting view', async () => {
    const window = new Window();
    globalThis.window = window;
    globalThis.document = window.document;

    const screenMain = window.document.createElement('div');
    screenMain.id = 'screen-main';
    screenMain.classList.add('active');
    window.document.body.appendChild(screenMain);

    const screenConnect = window.document.createElement('div');
    screenConnect.id = 'screen-connect';
    screenConnect.style.display = 'none';
    window.document.body.appendChild(screenConnect);

    const toasts = [];
    globalThis.showToast = vi.fn((msg, isErr) => toasts.push({ msg, isErr }));
    globalThis.t = vi.fn((key) => key);
    globalThis.showLandingStep = vi.fn();
    globalThis.updateCloudSyncUI = vi.fn();
    globalThis.rootHandle = null;
    globalThis.StorageAPI = {
      getStorageEngine: vi.fn(() => 'firebase')
    };
    globalThis.FirebaseSyncService = {
      signOut: vi.fn(async () => true),
      lockVault: vi.fn()
    };
    globalThis.window.FirebaseSyncService = globalThis.FirebaseSyncService;

    const appInitCode = fs.readFileSync(path.join(process.cwd(), 'js/app-init.js'), 'utf-8');
    const match = appInitCode.match(/async function handleLogOffUI\(\)\s*\{[\s\S]*?\n\}\nwindow\.handleLogOffUI = handleLogOffUI;/);
    const evalFn = new Function(match[0] + '; return handleLogOffUI;');
    const handleLogOffUI = evalFn();

    const result = await handleLogOffUI();
    expect(result).toBe(true);
    expect(globalThis.FirebaseSyncService.signOut).toHaveBeenCalled();
    expect(globalThis.FirebaseSyncService.lockVault).toHaveBeenCalled();
    expect(screenMain.classList.contains('active')).toBe(false);
    expect(screenConnect.style.display).toBe('');
    expect(globalThis.showLandingStep).toHaveBeenCalledWith('welcome');
    expect(toasts.some(t => t.msg === 'sync.signOutSuccessToast')).toBe(true);
  });
});
