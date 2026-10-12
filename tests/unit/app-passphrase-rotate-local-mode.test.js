import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

/**
 * Regression: in local filesystem mode (e.g. after reverting from Firebase),
 * the "Master Passphrase (Zero-Knowledge)" row was always shown as "Active" and
 * its "Change Passphrase" button failed with "Vault must be unlocked to rotate passphrase".
 */
describe('Master passphrase UI in local filesystem mode', () => {
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
      <div id="prefs-sec-user-info">
        <div id="auth-method-row-passphrase">
          <span id="auth-method-passphrase-badge">Active</span>
        </div>
      </div>
      <div id="prefs-sync-pass-row" style="display:flex;"><input id="prefs-sync-pass-input"></div>
      <div id="sync-rotate-error" style="display:none;"></div>
      <input id="sync-rotate-current-pass" value="old-passphrase-123">
      <input id="sync-rotate-new-pass" value="new-passphrase-456">
      <input id="sync-rotate-confirm-pass" value="new-passphrase-456">
    `;
    globalThis.activePrefsTab = 'general';
    globalThis.openModal = vi.fn();
    globalThis.closeModal = vi.fn();
    globalThis.showToast = vi.fn();
  });

  it('hides the master passphrase rows when the local filesystem engine is active', () => {
    window.FirebaseSyncService = {
      state: { engine: 'filesystem', isUnlocked: false },
      getStatus: () => ({ status: 'disconnected', engine: 'filesystem' }),
      getAuthUser: () => null,
      getSyncCode: () => null,
      getActivePassphrase: () => Promise.resolve(null)
    };
    updateCloudSyncUI();
    expect(document.getElementById('auth-method-row-passphrase').style.display).toBe('none');
    expect(document.getElementById('prefs-sync-pass-row').style.display).toBe('none');
  });

  it('shows the passphrase row with a locked badge when the Firebase vault is locked', () => {
    window.FirebaseSyncService = {
      state: { engine: 'firebase', isUnlocked: false },
      getStatus: () => ({ status: 'locked', engine: 'firebase' }),
      getAuthUser: () => null,
      getSyncCode: () => 'SEC-1234',
      getActivePassphrase: () => Promise.resolve(null)
    };
    updateCloudSyncUI();
    expect(document.getElementById('auth-method-row-passphrase').style.display).not.toBe('none');
    expect(document.getElementById('auth-method-passphrase-badge').textContent).toBe(t('sync.statusLocked'));
  });

  it('openPassphraseRotateUI opens the unlock modal instead of the rotate modal when the vault is locked', () => {
    window.FirebaseSyncService = { state: { engine: 'firebase', isUnlocked: false } };
    openPassphraseRotateUI();
    expect(globalThis.openModal).toHaveBeenCalledWith('modal-cloud-sync-unlock');
    expect(globalThis.openModal).not.toHaveBeenCalledWith('modal-cloud-sync-password-rotate');
  });

  it('openPassphraseRotateUI opens the rotate modal when the Firebase vault is unlocked', () => {
    window.FirebaseSyncService = { state: { engine: 'firebase', isUnlocked: true } };
    openPassphraseRotateUI();
    expect(globalThis.openModal).toHaveBeenCalledWith('modal-cloud-sync-password-rotate');
  });

  it('openPassphraseRotateUI does not open any modal in local filesystem mode', () => {
    window.FirebaseSyncService = { state: { engine: 'filesystem', isUnlocked: false } };
    openPassphraseRotateUI();
    expect(globalThis.openModal).not.toHaveBeenCalled();
    expect(globalThis.showToast).toHaveBeenCalledWith(t('sync.rotateRequiresCloudVault'), true);
  });

  it('submitCloudSyncPasswordRotate shows a localized message instead of calling rotate in local mode', async () => {
    const rotate = vi.fn();
    window.FirebaseSyncService = { state: { engine: 'filesystem', isUnlocked: false }, rotatePassphrase: rotate };
    await submitCloudSyncPasswordRotate();
    expect(rotate).not.toHaveBeenCalled();
    const errEl = document.getElementById('sync-rotate-error');
    expect(errEl.style.display).toBe('block');
    expect(errEl.textContent).toBe(t('sync.rotateRequiresCloudVault'));
  });

  it('wires every Change Passphrase button in app.html through openPassphraseRotateUI', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const html = fs.readFileSync(path.resolve(__dirname, '../../app.html'), 'utf8');
    expect(html).not.toContain(`onclick="openModal('modal-cloud-sync-password-rotate')"`);
    expect(html).toContain('id="auth-method-row-passphrase"');
    expect(html).toContain('id="auth-method-passphrase-badge"');
  });
});
