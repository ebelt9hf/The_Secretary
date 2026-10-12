import { describe, it, expect, beforeEach, beforeAll, afterEach, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Firebase Multi-Step Progressive Setup & Diagnostic UI', () => {
  let mockBridge;
  let originalSyncService;

  beforeAll(() => {
    globalThis.window = globalThis.window || {};
    globalThis.t = (key) => key;
    globalThis.escH = (s) => String(s || '');
    globalThis.escA = (s) => String(s || '');
    globalThis.normalizeLanguageCode = (c) => c || 'en';
    globalThis.applyLocalizedUI = () => {};

    loadScriptsIntoGlobal([
      'js/app-utils.js',
      'js/app-firebase-sync.js',
      'js/app-init.js'
    ]);
    originalSyncService = window.FirebaseSyncService;
  });

  beforeEach(() => {
    window.FirebaseSyncService = originalSyncService;

    // Build the full modal DOM matching templates/modals.html
    document.body.innerHTML = `
      <div class="modal-overlay" id="modal-cloud-sync-setup" style="display:none;">
        <button id="btn-sync-step-back" style="display:none;"></button>
        <h2 id="sync-setup-modal-title"></h2>
        <p id="sync-setup-modal-desc"></p>

        <div id="sync-active-backend-bar" style="display:none;">
          <strong id="sync-active-backend-name"></strong>
          <button id="btn-sync-change-backend" style="display:none;"></button>
        </div>

        <!-- Step 1: Config -->
        <div id="sync-step-config" class="sync-step-view" style="display:none;">
          <div id="sync-custom-firebase-body">
            <textarea id="sync-custom-firebase-json"></textarea>
            <button id="btn-copy-firebase-gemini-prompt"></button>
            <button id="btn-copy-firebase-rules"></button>
            <button id="btn-save-custom-firebase-step"></button>
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
            <input type="text" id="sync-setup-username" name="username" value="Secretary Vault">
            
            <button id="tab-sync-signin"></button>
            <button id="tab-sync-signup" style="display:none;"></button>
            <button id="tab-sync-link"></button>
            <button id="tab-sync-guest" style="display:none;"></button>

            <!-- Diagnostic Alert Box -->
            <div id="sync-connect-error-alert" class="sync-error-alert-box" style="display:none;">
              <strong id="sync-connect-error-title"></strong>
              <div id="sync-connect-error-desc"></div>
              <div id="sync-connect-error-recovery"></div>
            </div>

            <div id="sync-setup-auth-fields" style="display:none;">
              <input type="email" id="sync-setup-email" value="">
              <a id="sync-setup-forgot-pass-link" style="display:none;"></a>
              <input type="password" id="sync-setup-auth-password" value="">
              <button id="btn-sync-setup-auth-pass-visibility"></button>
              <small id="sync-setup-auth-pass-hint"></small>
            </div>

            <div id="sync-setup-code-container" style="display:none;">
              <input type="text" id="sync-setup-sync-code" value="">
              <button id="btn-sync-setup-regen"></button>
              <button id="btn-sync-setup-copy"></button>
              <small id="sync-setup-code-hint"></small>
            </div>

            <div id="sync-setup-passphrase-container">
              <input type="password" id="sync-setup-passphrase" value="">
              <span id="sync-setup-pass-badge"></span>
              <button id="btn-sync-setup-pass-visibility"></button>
              <button id="btn-sync-setup-pass-regen"></button>
              <button id="btn-sync-setup-pass-copy"></button>
              <div id="sync-crack-time-display" style="display:none;">
                <strong id="sync-crack-time-value"></strong>
              </div>
              <div id="sync-passphrase-unrecoverable-card" style="display:none;"></div>
              <div id="sync-setup-pass-clarity-card" style="display:none;"></div>
              <small id="sync-setup-pass-hint"></small>
            </div>

            <input type="checkbox" id="sync-setup-remember-pass">
            <input type="checkbox" id="sync-setup-dont-show-again">
            <button id="btn-submit-cloud-sync" data-mode="signin">Sign In & Sync</button>
          </form>
        </div>
      </div>
    `;

    mockBridge = {
      app: {},
      auth: {},
      currentUser: null,
      init: vi.fn().mockReturnValue(true),
      ensureAuth: vi.fn().mockResolvedValue({ uid: 'user-uid-123', email: 'test@example.com', isAnonymous: false }),
      signInWithEmail: vi.fn().mockResolvedValue({ uid: 'user-uid-123', email: 'test@example.com', isAnonymous: false }),
      signUpWithEmail: vi.fn().mockResolvedValue({ uid: 'new-user-456', email: 'new@example.com', isAnonymous: false }),
      signOut: vi.fn().mockResolvedValue()
    };
    window.FirebaseSyncService._bridge = mockBridge;
    window.FirebaseSyncService?.clearCustomFirebaseConfig?.();
  });

  afterEach(() => {
    window.FirebaseSyncService?.clearCustomFirebaseConfig?.();
    vi.restoreAllMocks();
  });

  describe('Step Transitions & View Rendering', () => {
    it('switches to config step (Step 1) and shows only config view', () => {
      window.setCloudSyncStep('config');

      expect(document.getElementById('sync-step-config').style.display).toBe('block');
      expect(document.getElementById('sync-step-intent').style.display).toBe('none');
      expect(document.getElementById('sync-step-auth').style.display).toBe('none');
      expect(document.getElementById('btn-sync-step-back').style.display).toBe('none');
      expect(document.getElementById('sync-active-backend-bar').style.display).toBe('none');
      expect(document.getElementById('sync-setup-modal-title').textContent).toBe('sync.configStepTitle');
      expect(document.getElementById('sync-setup-modal-desc').textContent).toBe('sync.configStepDesc');
    });

    it('switches to intent step (Step 2) with backend bar visible', () => {
      window.setCloudSyncStep('intent');

      expect(document.getElementById('sync-step-config').style.display).toBe('none');
      expect(document.getElementById('sync-step-intent').style.display).toBe('block');
      expect(document.getElementById('sync-step-auth').style.display).toBe('none');
      expect(document.getElementById('sync-active-backend-bar').style.display).toBe('flex');
      expect(document.getElementById('sync-setup-modal-title').textContent).toBe('sync.intentStepTitle');
      expect(document.getElementById('sync-setup-modal-desc').textContent).toBe('sync.intentStepDesc');
    });

    it('switches to connect existing account (Step 3A) with signin/link tabs', () => {
      window.setCloudSyncStep('connect');

      expect(document.getElementById('sync-step-config').style.display).toBe('none');
      expect(document.getElementById('sync-step-intent').style.display).toBe('none');
      expect(document.getElementById('sync-step-auth').style.display).toBe('block');
      expect(document.getElementById('btn-sync-step-back').style.display).toBe('inline-flex');

      // Method tabs
      expect(document.getElementById('tab-sync-signin').style.display).toBe('inline-block');
      expect(document.getElementById('tab-sync-link').style.display).toBe('inline-block');
      expect(document.getElementById('tab-sync-signup').style.display).toBe('none');
      expect(document.getElementById('tab-sync-guest').style.display).toBe('none');

      // Cards
      expect(document.getElementById('sync-crack-time-display').style.display).toBe('none');
      expect(document.getElementById('sync-passphrase-unrecoverable-card').style.display).toBe('none');
      expect(document.getElementById('sync-setup-pass-clarity-card').style.display).toBe('block');

      expect(document.getElementById('sync-setup-modal-title').textContent).toBe('sync.connectStepTitle');
      expect(document.getElementById('sync-setup-modal-desc').textContent).toBe('sync.connectStepDesc');
    });

    it('switches to create new account (Step 3B) with signup/guest tabs and crack-time display', () => {
      window.setCloudSyncStep('create');

      expect(document.getElementById('sync-step-config').style.display).toBe('none');
      expect(document.getElementById('sync-step-intent').style.display).toBe('none');
      expect(document.getElementById('sync-step-auth').style.display).toBe('block');
      expect(document.getElementById('btn-sync-step-back').style.display).toBe('inline-flex');

      // Method tabs
      expect(document.getElementById('tab-sync-signin').style.display).toBe('none');
      expect(document.getElementById('tab-sync-link').style.display).toBe('none');
      expect(document.getElementById('tab-sync-signup').style.display).toBe('inline-block');
      expect(document.getElementById('tab-sync-guest').style.display).toBe('inline-block');

      // Cards
      expect(document.getElementById('sync-crack-time-display').style.display).toBe('flex');
      expect(document.getElementById('sync-passphrase-unrecoverable-card').style.display).toBe('block');
      expect(document.getElementById('sync-setup-pass-clarity-card').style.display).toBe('none');

      expect(document.getElementById('sync-setup-modal-title').textContent).toBe('sync.createStepTitle');
      expect(document.getElementById('sync-setup-modal-desc').textContent).toBe('sync.createStepDesc');
    });
  });

  describe('Back Navigation', () => {
    it('navigates from connect step back to intent step', () => {
      window.setCloudSyncStep('connect');
      expect(document.getElementById('sync-step-auth').style.display).toBe('block');

      window.navigateCloudSyncStepBack();
      expect(document.getElementById('sync-step-intent').style.display).toBe('block');
      expect(document.getElementById('sync-step-auth').style.display).toBe('none');
    });

    it('navigates from create step back to intent step', () => {
      window.setCloudSyncStep('create');
      expect(document.getElementById('sync-step-auth').style.display).toBe('block');

      window.navigateCloudSyncStepBack();
      expect(document.getElementById('sync-step-intent').style.display).toBe('block');
      expect(document.getElementById('sync-step-auth').style.display).toBe('none');
    });

    it('navigates from intent step back to config if user came from config', () => {
      window.setCloudSyncStep('config');
      window.setCloudSyncStep('intent');

      window.navigateCloudSyncStepBack();
      expect(document.getElementById('sync-step-config').style.display).toBe('block');
      expect(document.getElementById('sync-step-intent').style.display).toBe('none');
    });
  });

  describe('In-Modal Diagnostic Error Alert Box', () => {
    it('shows passphrase decryption error diagnostic alert with zero-knowledge warning', () => {
      window.showCloudSyncDiagnosticError('passphrase');

      const alertEl = document.getElementById('sync-connect-error-alert');
      const titleEl = document.getElementById('sync-connect-error-title');
      const descEl = document.getElementById('sync-connect-error-desc');

      expect(alertEl.style.display).toBe('block');
      expect(titleEl.textContent).toBe('sync.errorPassphraseTitle');
      expect(descEl.textContent).toBe('sync.errorPassphraseDesc');
    });

    it('shows authentication failure diagnostic alert with detail', () => {
      window.showCloudSyncDiagnosticError('auth', 'Firebase: Error (auth/invalid-credential).');

      const alertEl = document.getElementById('sync-connect-error-alert');
      const titleEl = document.getElementById('sync-connect-error-title');
      const recoveryEl = document.getElementById('sync-connect-error-recovery');

      expect(alertEl.style.display).toBe('block');
      expect(titleEl.textContent).toBe('sync.errorAuthTitle');
      expect(recoveryEl.textContent).toBe('Firebase: Error (auth/invalid-credential).');
    });

    it('shows sync code not found diagnostic alert', () => {
      window.showCloudSyncDiagnosticError('syncCode');

      const alertEl = document.getElementById('sync-connect-error-alert');
      const titleEl = document.getElementById('sync-connect-error-title');

      expect(alertEl.style.display).toBe('block');
      expect(titleEl.textContent).toBe('sync.errorSyncCodeTitle');
    });

    it('clears diagnostic error alert cleanly', () => {
      window.showCloudSyncDiagnosticError('network');
      expect(document.getElementById('sync-connect-error-alert').style.display).toBe('block');

      window.clearCloudSyncDiagnosticError();
      expect(document.getElementById('sync-connect-error-alert').style.display).toBe('none');
    });

    it('clears diagnostic alert when switching steps or tabs', () => {
      window.showCloudSyncDiagnosticError('auth');
      expect(document.getElementById('sync-connect-error-alert').style.display).toBe('block');

      window.setCloudSyncStep('connect');
      expect(document.getElementById('sync-connect-error-alert').style.display).toBe('none');
    });
  });

  describe('Passphrase Crack-Time Calculation', () => {
    it('rates passphrases under 10 characters as too short', () => {
      window.calculatePassphraseCrackTime('short');
      const valEl = document.getElementById('sync-crack-time-value');
      expect(valEl.textContent).toBe('sync.crackTimeTooShort');
      expect(valEl.style.color).toBe('#ef4444');
    });

    it('rates passphrases between 10 and 24 characters as supercomputer-resistant (>10,000,000 years)', () => {
      window.calculatePassphraseCrackTime('secret-passphrase-12');
      const valEl = document.getElementById('sync-crack-time-value');
      expect(valEl.textContent).toBe('sync.crackTimeMillionsYears');
      expect(valEl.style.color).toBe('#3b82f6');
    });

    it('rates passphrases 25 characters or more as trillions of years (unbreakable)', () => {
      window.calculatePassphraseCrackTime('correct-horse-battery-staple-galaxy-orbit');
      const valEl = document.getElementById('sync-crack-time-value');
      expect(valEl.textContent).toBe('sync.crackTimeTrillionsYears');
      expect(valEl.style.color).toBe('#10b981');
    });

    it('updates crack-time calculation dynamically on input event', () => {
      window.handleSetupPassphraseInput('mountain-river-forest-sun-ocean-sky');
      const valEl = document.getElementById('sync-crack-time-value');
      expect(valEl.textContent).toBe('sync.crackTimeTrillionsYears');
    });
  });

  describe('AI Setup Prompt and Security Rules', () => {
    it('copies Firebase Gemini prompt to clipboard', async () => {
      let copiedText = '';
      const mockClipboard = {
        writeText: vi.fn().mockImplementation((text) => {
          copiedText = text;
          return Promise.resolve();
        })
      };
      Object.defineProperty(navigator, 'clipboard', { value: mockClipboard, configurable: true, writable: true });

      window.copyFirebaseGeminiPrompt();
      expect(mockClipboard.writeText).toHaveBeenCalled();
      expect(copiedText).toContain('Secretary');
      expect(copiedText).toContain('Realtime Database');
      expect(copiedText).toContain('firebaseConfig');
    });

    it('copies Firebase Realtime Database security rules to clipboard', async () => {
      let copiedText = '';
      const mockClipboard = {
        writeText: vi.fn().mockImplementation((text) => {
          copiedText = text;
          return Promise.resolve();
        })
      };
      Object.defineProperty(navigator, 'clipboard', { value: mockClipboard, configurable: true, writable: true });

      window.copyFirebaseSecurityRules();
      expect(mockClipboard.writeText).toHaveBeenCalled();
      const parsed = JSON.parse(copiedText);
      expect(parsed.rules.users['$uid']['.read']).toBe('$uid === auth.uid');
      expect(parsed.rules.users['$uid']['.write']).toBe('$uid === auth.uid');
    });
  });

  describe('Custom Firebase Configuration Flow', () => {
    it('applies valid custom JSON and advances to intent step', () => {
      const textarea = document.getElementById('sync-custom-firebase-json');
      textarea.value = JSON.stringify({
        apiKey: 'AIzaSyTestApiKey12345',
        projectId: 'my-custom-vault-app',
        databaseURL: 'https://my-custom-vault-app.firebaseio.com'
      });

      window.saveCustomFirebaseConfigAndProceed();

      const customCfg = window.FirebaseSyncService.getCustomFirebaseConfig();
      expect(customCfg).toBeTruthy();
      expect(customCfg.projectId).toBe('my-custom-vault-app');

      // Advanced to intent step
      expect(document.getElementById('sync-step-intent').style.display).toBe('block');
      expect(document.getElementById('sync-step-config').style.display).toBe('none');
    });

    it('allows opening config step from intent via openCustomFirebaseConfigFromIntent', () => {
      window.setCloudSyncStep('intent');
      window.openCustomFirebaseConfigFromIntent();

      expect(document.getElementById('sync-step-config').style.display).toBe('block');
      expect(document.getElementById('sync-step-intent').style.display).toBe('none');
    });
  });

  describe('Landing Page Openers', () => {
    it('openManagedFirebaseSetupFromLanding opens modal directly to intent step', () => {
      window.openManagedFirebaseSetupFromLanding();

      expect(document.getElementById('sync-step-intent').style.display).toBe('block');
      expect(document.getElementById('sync-step-config').style.display).toBe('none');
    });

    it('openCustomFirebaseSetupFromLanding opens config step when no custom config exists', () => {
      window.FirebaseSyncService.clearCustomFirebaseConfig();
      window.openCustomFirebaseSetupFromLanding();

      expect(document.getElementById('sync-step-config').style.display).toBe('block');
      expect(document.getElementById('sync-step-intent').style.display).toBe('none');
    });
  });
});
