import { describe, it, expect, beforeEach, beforeAll, afterEach, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Etienne Firebase Invite Code Limit & Verification', () => {
  let originalSyncService;

  beforeAll(() => {
    globalThis.window = globalThis.window || {};
    globalThis.t = (key) => key;
    globalThis.escH = (s) => String(s || '');
    globalThis.escA = (s) => String(s || '');
    globalThis.normalizeLanguageCode = (c) => c || 'en';
    globalThis.applyLocalizedUI = () => {};

    loadScriptsIntoGlobal([
      'js/firebase-config.js',
      'js/app-utils.js',
      'js/app-firebase-sync.js',
      'js/app-init.js'
    ]);
    originalSyncService = window.FirebaseSyncService;
  });

  beforeEach(() => {
    window.FirebaseSyncService = originalSyncService;
    window.FirebaseSyncService?.clearCustomFirebaseConfig?.();
    window.FirebaseSyncService?.clearInviteCode?.();
    localStorage.clear();
    globalThis.settings = {};

    document.body.innerHTML = `
      <div class="modal-overlay" id="modal-cloud-sync-setup" style="display:none;">
        <button id="btn-sync-step-back" style="display:none;"></button>
        <h2 id="sync-setup-modal-title"></h2>
        <p id="sync-setup-modal-desc"></p>

        <div id="sync-active-backend-bar" style="display:none;">
          <strong id="sync-active-backend-name"></strong>
          <span id="sync-invite-verified-badge" style="display:none;"></span>
          <span id="sync-invite-required-badge" style="display:none;"></span>
          <button id="btn-sync-change-backend" style="display:none;"></button>
        </div>

        <!-- Step Invite -->
        <div id="sync-step-invite" class="sync-step-view" style="display:none;">
          <div id="sync-invite-error-alert" style="display:none;">
            <span id="sync-invite-error-text"></span>
          </div>
          <input type="text" id="sync-invite-code-input" value="">
          <button id="btn-submit-invite-code"></button>
          <button id="btn-invite-use-custom-firebase"></button>
        </div>

        <!-- Step 1: Config -->
        <div id="sync-step-config" class="sync-step-view" style="display:none;">
          <div id="sync-custom-firebase-body">
            <textarea id="sync-custom-firebase-json"></textarea>
          </div>
        </div>

        <!-- Step 2: Intent -->
        <div id="sync-step-intent" class="sync-step-view" style="display:none;">
          <div id="card-intent-existing"></div>
          <div id="card-intent-new"></div>
        </div>

        <!-- Step 3: Auth -->
        <div id="sync-step-auth" class="sync-step-view" style="display:none;">
          <form id="form-cloud-sync-setup">
            <input type="email" id="sync-setup-email" value="test@example.com">
            <input type="password" id="sync-setup-auth-password" value="password123">
            <input type="password" id="sync-setup-passphrase" value="a-very-long-master-passphrase">
            <button id="btn-submit-cloud-sync" data-mode="signin">Sign In</button>
          </form>
        </div>
      </div>
    `;
  });

  afterEach(() => {
    window.FirebaseSyncService?.clearCustomFirebaseConfig?.();
    window.FirebaseSyncService?.clearInviteCode?.();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe('Core Service Invite Code Validation & Persistence', () => {
    it('detects default configuration as Etienne Firebase', () => {
      expect(window.FirebaseSyncService.isEtienneFirebase()).toBe(true);
    });

    it('identifies custom Firebase configuration as non-Etienne Firebase', () => {
      window.FirebaseSyncService.setCustomFirebaseConfig({
        apiKey: 'custom-api-key',
        projectId: 'user-private-project'
      });
      expect(window.FirebaseSyncService.isEtienneFirebase()).toBe(false);
    });

    it('validates known official invite codes regardless of case or whitespace', () => {
      expect(window.FirebaseSyncService.validateInviteCode('ETIENNE-BETA')).toBe(true);
      expect(window.FirebaseSyncService.validateInviteCode('  etienne-beta  ')).toBe(true);
      expect(window.FirebaseSyncService.validateInviteCode('SECRETARY-2026')).toBe(true);
      expect(window.FirebaseSyncService.validateInviteCode('etienne-vip')).toBe(true);
      expect(window.FirebaseSyncService.validateInviteCode('SEC-INV-PRO99')).toBe(true);
      expect(window.FirebaseSyncService.validateInviteCode('ETN-VIP-2026')).toBe(true);
    });

    it('rejects invalid or empty invite codes', () => {
      expect(window.FirebaseSyncService.validateInviteCode('')).toBe(false);
      expect(window.FirebaseSyncService.validateInviteCode('random-invalid-code')).toBe(false);
      expect(window.FirebaseSyncService.validateInviteCode('12345')).toBe(false);
      expect(window.FirebaseSyncService.validateInviteCode(null)).toBe(false);
    });

    it('sets and retrieves valid invite code in localStorage and settings', () => {
      const success = window.FirebaseSyncService.setInviteCode('ETIENNE-BETA');
      expect(success).toBe(true);
      expect(window.FirebaseSyncService.getInviteCode()).toBe('ETIENNE-BETA');
      expect(window.FirebaseSyncService.hasValidInviteCode()).toBe(true);
      expect(localStorage.getItem('secretary_etienne_invite_code')).toBe('ETIENNE-BETA');
      expect(globalThis.settings.etienneInviteCode).toBe('ETIENNE-BETA');
    });

    it('clears stored invite code', () => {
      window.FirebaseSyncService.setInviteCode('ETIENNE-BETA');
      expect(window.FirebaseSyncService.hasValidInviteCode()).toBe(true);

      window.FirebaseSyncService.clearInviteCode();
      expect(window.FirebaseSyncService.hasValidInviteCode()).toBe(false);
      expect(window.FirebaseSyncService.getInviteCode()).toBeNull();
      expect(localStorage.getItem('secretary_etienne_invite_code')).toBeNull();
    });

    it('evaluates requiresInviteCode correctly based on backend and code status', () => {
      // 1. Etienne Firebase without code -> requires code
      expect(window.FirebaseSyncService.requiresInviteCode()).toBe(true);

      // 2. Etienne Firebase with valid code -> does not require code
      window.FirebaseSyncService.setInviteCode('ETIENNE-BETA');
      expect(window.FirebaseSyncService.requiresInviteCode()).toBe(false);

      // 3. Custom Firebase -> never requires invite code
      window.FirebaseSyncService.clearInviteCode();
      window.FirebaseSyncService.setCustomFirebaseConfig({
        apiKey: 'custom-key',
        projectId: 'my-own-firebase'
      });
      expect(window.FirebaseSyncService.requiresInviteCode()).toBe(false);
    });
  });

  describe('UI Flow & Gating for Etienne Firebase', () => {
    it('openManagedFirebaseSetupFromLanding routes to invite step when no invite code is present', () => {
      window.openManagedFirebaseSetupFromLanding();
      expect(document.getElementById('sync-step-invite').style.display).toBe('block');
      expect(document.getElementById('sync-step-intent').style.display).toBe('none');
    });

    it('openManagedFirebaseSetupFromLanding routes to intent step when valid invite code is present', () => {
      window.FirebaseSyncService.setInviteCode('ETIENNE-BETA');
      window.openManagedFirebaseSetupFromLanding();
      expect(document.getElementById('sync-step-intent').style.display).toBe('block');
      expect(document.getElementById('sync-step-invite').style.display).toBe('none');
    });

    it('verifyAndApplyInviteCodeUI shows error alert and toast for invalid code', async () => {
      window.setCloudSyncStep('invite');
      const input = document.getElementById('sync-invite-code-input');
      input.value = 'invalid-code-xyz';
      const toastMock = vi.fn();
      globalThis.showToast = toastMock;

      await window.verifyAndApplyInviteCodeUI();

      const alertEl = document.getElementById('sync-invite-error-alert');
      expect(alertEl.style.display).toBe('block');
      expect(toastMock).toHaveBeenCalledWith('sync.invalidInviteCode', true);
      expect(document.getElementById('sync-step-invite').style.display).toBe('block');
    });

    it('verifyAndApplyInviteCodeUI unlocks vault and transitions to intent step for valid code', async () => {
      window.setCloudSyncStep('invite');
      const input = document.getElementById('sync-invite-code-input');
      input.value = 'ETIENNE-BETA';
      const toastMock = vi.fn();
      globalThis.showToast = toastMock;

      await window.verifyAndApplyInviteCodeUI();

      expect(window.FirebaseSyncService.hasValidInviteCode()).toBe(true);
      expect(toastMock).toHaveBeenCalledWith('sync.inviteCodeAccepted');
      expect(document.getElementById('sync-step-intent').style.display).toBe('block');
      expect(document.getElementById('sync-step-invite').style.display).toBe('none');
    });

    it('submitCloudSyncSetup prevents authentication and redirects to invite step if code missing on Etienne Firebase', async () => {
      const toastMock = vi.fn();
      globalThis.showToast = toastMock;

      // User somehow triggers submit without invite code on Etienne Firebase
      await window.submitCloudSyncSetup();

      expect(toastMock).toHaveBeenCalledWith('sync.inviteCodeRequired', true);
      expect(document.getElementById('sync-step-invite').style.display).toBe('block');
    });
  });
});
