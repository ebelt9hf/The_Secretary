import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Passphrase Autofill & Remember Integration', () => {
  let modalsHtml = '';
  let appHtml = '';

  beforeAll(() => {
    loadScriptsIntoGlobal([
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-utils.js',
      'js/firebase-config.js',
      'js/app-crypto.js',
      'js/app-firebase-sync.js',
      'js/app-overlay.js',
      'js/app-init.js'
    ]);

    const rootDir = process.cwd();
    modalsHtml = fs.readFileSync(path.join(rootDir, 'templates/modals.html'), 'utf-8');
    appHtml = fs.readFileSync(path.join(rootDir, 'app.html'), 'utf-8');
  });

  beforeEach(() => {
    const cleanedAppHtml = appHtml.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    document.body.innerHTML = `
      ${modalsHtml}
      ${cleanedAppHtml}
    `;

    window.settings = {
      storageEngine: 'firebase',
      rememberPassphrase: true,
      vaultMeta: null
    };

    window.FirebaseSyncService.state = {
      engine: 'firebase',
      status: 'locked',
      config: null,
      vaultMeta: null,
      userId: 'test_user',
      isUnlocked: false,
      masterKey: null,
      pendingQueue: new Map(),
      localCache: new Map(),
      manifestCache: new Map()
    };
  });

  describe('Password Manager / Password Filler Autofill DOM Structure', () => {
    it('provides standard form wrapper and attributes for Unlock Modal', () => {
      const form = document.getElementById('form-cloud-sync-unlock');
      expect(form).not.toBeNull();
      expect(form.tagName.toLowerCase()).toBe('form');

      const username = document.getElementById('sync-unlock-username');
      expect(username).not.toBeNull();
      expect(username.getAttribute('name')).toBe('username');
      expect(username.getAttribute('autocomplete')).toBe('username');

      const pass = document.getElementById('sync-unlock-passphrase');
      expect(pass).not.toBeNull();
      expect(pass.getAttribute('name')).toBe('password');
      expect(pass.getAttribute('autocomplete')).toBe('current-password');
      expect(pass.type).toBe('password');

      const submitBtn = document.getElementById('btn-sync-unlock-submit');
      expect(submitBtn).not.toBeNull();
      expect(submitBtn.type).toBe('submit');

      const saveBtn = document.getElementById('btn-sync-unlock-save');
      expect(saveBtn).not.toBeNull();
      expect(saveBtn.getAttribute('title')).toBeDefined();

      const rememberCb = document.getElementById('sync-unlock-remember-pass');
      expect(rememberCb).not.toBeNull();
      expect(rememberCb.type).toBe('checkbox');
    });

    it('provides standard form wrapper and attributes for Setup & Link Modal', () => {
      const form = document.getElementById('form-cloud-sync-setup');
      expect(form).not.toBeNull();
      expect(form.tagName.toLowerCase()).toBe('form');

      const username = document.getElementById('sync-setup-username');
      expect(username).not.toBeNull();
      expect(username.getAttribute('autocomplete')).toBe('username');

      const pass = document.getElementById('sync-setup-passphrase');
      expect(pass).not.toBeNull();
      expect(pass.getAttribute('name')).toBe('password');
      expect(pass.getAttribute('autocomplete')).toBe('new-password');

      const submitBtn = document.getElementById('btn-submit-cloud-sync');
      expect(submitBtn).not.toBeNull();
      expect(submitBtn.type).toBe('submit');

      const rememberCb = document.getElementById('sync-setup-remember-pass');
      expect(rememberCb).not.toBeNull();
      expect(rememberCb.type).toBe('checkbox');
    });

    it('provides standard form wrapper and attributes for Password Rotate Modal', () => {
      const form = document.getElementById('form-cloud-sync-rotate');
      expect(form).not.toBeNull();
      expect(form.tagName.toLowerCase()).toBe('form');

      const username = document.getElementById('sync-rotate-username');
      expect(username).not.toBeNull();
      expect(username.getAttribute('autocomplete')).toBe('username');

      const curPass = document.getElementById('sync-rotate-current-pass');
      expect(curPass).not.toBeNull();
      expect(curPass.getAttribute('autocomplete')).toBe('current-password');

      const newPass = document.getElementById('sync-rotate-new-pass');
      expect(newPass).not.toBeNull();
      expect(newPass.getAttribute('autocomplete')).toBe('new-password');

      const confirmPass = document.getElementById('sync-rotate-confirm-pass');
      expect(confirmPass).not.toBeNull();
      expect(confirmPass.getAttribute('autocomplete')).toBe('new-password');
    });

    it('includes remember passphrase option in Preferences sync section', () => {
      const rememberRow = document.getElementById('prefs-sync-remember-row');
      expect(rememberRow).not.toBeNull();

      const rememberCb = document.getElementById('prefs-sync-remember-pass');
      expect(rememberCb).not.toBeNull();
      expect(rememberCb.type).toBe('checkbox');
      expect(rememberCb.getAttribute('title')).toBeDefined();
    });
  });


  describe('Passphrase persistence via OS keychain (Electron safeStorage bridge)', () => {
    let keychain;
    let api;

    beforeEach(() => {
      keychain = { value: null, available: true, failClear: false };
      api = {
        isAvailable: vi.fn(async () => keychain.available),
        save: vi.fn(async (p) => { if (!keychain.available) return false; keychain.value = p; return true; }),
        get: vi.fn(async () => keychain.value),
        clear: vi.fn(async () => { if (keychain.failClear) return false; keychain.value = null; return true; })
      };
      window.electronAPI = { securePassphrase: api };
      localStorage.clear();
      window.settings.rememberPassphrase = false;
    });

    it('never writes the passphrase to localStorage or IndexedDB', async () => {
      const saved = await window.FirebaseSyncService.savePassphraseLocally('super-secret-passphrase');
      expect(saved).toBe(true);
      expect(keychain.value).toBe('super-secret-passphrase');
      const dump = JSON.stringify(Object.entries(localStorage));
      expect(dump).not.toContain('super-secret-passphrase');
      expect(localStorage.getItem('secretary_saved_passphrase')).toBeNull();
    });

    it('does not keep the passphrase in service memory and exposes no XOR helpers', async () => {
      await window.FirebaseSyncService.setupVault('memory-test-passphrase-1');
      expect(JSON.stringify(Object.keys(window.FirebaseSyncService.state))).not.toContain('assphrase');
      expect(Object.values(window.FirebaseSyncService.state)).not.toContain('memory-test-passphrase-1');
      expect(window.FirebaseSyncService._PASSPHRASE_FIXED_KEY).toBeUndefined();
      expect(window.FirebaseSyncService.encodePassphrase).toBeUndefined();
    });

    it('refuses to save (returns false) when no secure storage exists, e.g. plain browser', async () => {
      delete window.electronAPI;
      expect(await window.FirebaseSyncService.isPassphraseStorageAvailable()).toBe(false);
      expect(await window.FirebaseSyncService.savePassphraseLocally('x-pass-1234')).toBe(false);
      expect(window.settings.rememberPassphrase).toBe(false);
      expect(localStorage.length).toBe(0);
    });

    it('does not flag rememberPassphrase when the keychain save fails', async () => {
      keychain.available = false;
      expect(await window.FirebaseSyncService.savePassphraseLocally('x-pass-1234')).toBe(false);
      expect(window.settings.rememberPassphrase).toBe(false);
    });

    it('defaults to off: hasSavedPassphrase is false unless the setting is explicitly true', async () => {
      keychain.value = 'stored';
      delete window.settings.rememberPassphrase;
      expect(await window.FirebaseSyncService.hasSavedPassphrase()).toBe(false);
      window.settings.rememberPassphrase = true;
      expect(await window.FirebaseSyncService.hasSavedPassphrase()).toBe(true);
    });

    it('purges legacy XOR-obfuscated passphrases from localStorage', async () => {
      localStorage.setItem('secretary_saved_passphrase', 'enc:v1:abcd');
      expect(await window.FirebaseSyncService.purgeLegacyPassphraseStorage()).toBe(true);
      expect(localStorage.getItem('secretary_saved_passphrase')).toBeNull();
    });

    it('reports failure honestly when the keychain entry cannot be deleted', async () => {
      keychain.value = 'stored';
      keychain.failClear = true;
      expect(await window.FirebaseSyncService.clearSavedPassphrase()).toBe(false);
    });

    it('saves to keychain when unlocking with remember checked', async () => {
      const testPass = 'unlock-remember-test-passphrase-1234';
      const { vaultMeta } = await window.FirebaseSyncService.setupVault(testPass);
      window.FirebaseSyncService.state.vaultMeta = vaultMeta;
      window.FirebaseSyncService.lockVault();
      keychain.value = null;

      document.getElementById('sync-unlock-passphrase').value = testPass;
      document.getElementById('sync-unlock-remember-pass').checked = true;
      await window.submitCloudSyncUnlock();

      expect(window.FirebaseSyncService.state.isUnlocked).toBe(true);
      expect(keychain.value).toBe(testPass);
      expect(window.settings.rememberPassphrase).toBe(true);
    });

    it('does not save and clears any saved passphrase when remember is unchecked', async () => {
      const testPass = 'unlock-no-remember-passphrase-1234';
      const { vaultMeta } = await window.FirebaseSyncService.setupVault(testPass);
      window.FirebaseSyncService.state.vaultMeta = vaultMeta;
      window.FirebaseSyncService.lockVault();
      keychain.value = 'old-value';

      document.getElementById('sync-unlock-passphrase').value = testPass;
      document.getElementById('sync-unlock-remember-pass').checked = false;
      await window.submitCloudSyncUnlock();

      expect(window.FirebaseSyncService.state.isUnlocked).toBe(true);
      expect(keychain.value).toBeNull();
      expect(window.settings.rememberPassphrase).toBe(false);
    });

    it('Save & Unlock saves even when checkbox is unchecked', async () => {
      const testPass = 'unlock-explicit-save-passphrase-1234';
      const { vaultMeta } = await window.FirebaseSyncService.setupVault(testPass);
      window.FirebaseSyncService.state.vaultMeta = vaultMeta;
      window.FirebaseSyncService.lockVault();
      keychain.value = null;

      document.getElementById('sync-unlock-passphrase').value = testPass;
      document.getElementById('sync-unlock-remember-pass').checked = false;
      await window.submitCloudSyncUnlock(true);

      expect(keychain.value).toBe(testPass);
      expect(window.settings.rememberPassphrase).toBe(true);
    });

    it('unchecking in Settings clears keychain and setting', async () => {
      await window.FirebaseSyncService.savePassphraseLocally('settings-toggle-passphrase-1234');
      await window.toggleRememberPassphraseUI(false);
      expect(window.settings.rememberPassphrase).toBe(false);
      expect(keychain.value).toBeNull();
      expect(await window.FirebaseSyncService.hasSavedPassphrase()).toBe(false);
    });

    it('unchecking in Settings keeps checkbox checked when deletion fails', async () => {
      await window.FirebaseSyncService.savePassphraseLocally('settings-toggle-passphrase-1234');
      keychain.failClear = true;
      const cb = document.getElementById('prefs-sync-remember-pass');
      cb.checked = false;
      await window.toggleRememberPassphraseUI(false);
      expect(cb.checked).toBe(true);
    });

    it('checking in Settings never stores anything; it asks for the passphrase again', async () => {
      await window.toggleRememberPassphraseUI(true);
      expect(keychain.value).toBeNull();
      expect(window.settings.rememberPassphrase).toBe(false);
      expect(document.getElementById('modal-cloud-sync-unlock').classList.contains('active')).toBe(true);
      expect(document.getElementById('sync-unlock-remember-pass').checked).toBe(true);
    });

    it('checking in Settings without secure storage unchecks the box', async () => {
      keychain.available = false;
      const cb = document.getElementById('prefs-sync-remember-pass');
      cb.checked = true;
      await window.toggleRememberPassphraseUI(true);
      expect(cb.checked).toBe(false);
      expect(window.settings.rememberPassphrase).toBe(false);
    });

    it('re-saves the new passphrase after rotation only when remembered, and drops it if re-save fails', async () => {
      await window.FirebaseSyncService.setupVault('rotate-old-pass-1234');
      await window.FirebaseSyncService.savePassphraseLocally('rotate-old-pass-1234');
      await window.FirebaseSyncService.rotatePassphrase('rotate-old-pass-1234', 'rotate-new-pass-5678');
      expect(keychain.value).toBe('rotate-new-pass-5678');

      api.save.mockResolvedValueOnce(false);
      await window.FirebaseSyncService.rotatePassphrase('rotate-new-pass-5678', 'rotate-third-pass-9012');
      expect(keychain.value).toBeNull();
      expect(window.settings.rememberPassphrase).toBe(false);
    });
  });
});
