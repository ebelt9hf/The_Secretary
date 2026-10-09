import { describe, it, expect, beforeEach, beforeAll, afterEach, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Firebase Email & Password Authentication and Account UI', () => {
  let mockBridge;
  let originalSyncService;
  let originalUpdateCloudSyncUI;

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
    originalUpdateCloudSyncUI = globalThis.updateCloudSyncUI;
  });

  beforeEach(() => {
    window.FirebaseSyncService = originalSyncService;
    globalThis.updateCloudSyncUI = originalUpdateCloudSyncUI;
    // Set up basic DOM structure
    document.body.innerHTML = `
      <div class="modal-overlay" id="modal-cloud-sync-setup" style="display:none;">
        <input type="text" id="sync-setup-username" name="username" autocomplete="username" value="Secretary Vault">
        <button id="tab-sync-signin"></button>
        <button id="tab-sync-signup"></button>
        <button id="tab-sync-link"></button>
        <button id="tab-sync-guest"></button>
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
          <div id="sync-setup-pass-clarity-card"></div>
          <small id="sync-setup-pass-hint"></small>
        </div>
        <input type="checkbox" id="sync-setup-remember-pass">
        <input type="checkbox" id="sync-setup-dont-show-again">
        <button id="btn-submit-cloud-sync" data-mode="signin">Sign In & Sync</button>
      </div>

      <div class="modal-overlay" id="modal-cloud-password-reset" style="display:none;">
        <input type="email" id="sync-reset-password-email" value="">
        <div id="sync-reset-password-msg" style="display:none;"></div>
        <button id="btn-submit-password-reset"></button>
      </div>

      <div id="prefs-sec-sync">
        <div id="prefs-sync-account-row">
          <span id="prefs-sync-account-email">Not Signed In</span>
          <div id="prefs-sync-account-actions">
            <button id="btn-prefs-sync-signin">Sign In / Switch User</button>
            <button id="btn-prefs-sync-reset-pass" style="display:none;">Reset Password</button>
            <button id="btn-prefs-sync-signout" style="display:none;">Sign Out</button>
          </div>
        </div>
        <span id="prefs-sync-status-text"></span>
        <span id="prefs-sync-count-text"></span>
        <select id="prefs-storage-engine-select">
          <option value="filesystem">Local</option>
          <option value="firebase">Firebase</option>
        </select>
        <div id="prefs-sync-code-row" style="display:none;">
          <input id="prefs-sync-code-input">
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
      signOut: vi.fn().mockResolvedValue(),
      sendPasswordReset: vi.fn().mockResolvedValue(),
      getUser: vi.fn().mockImplementation(() => mockBridge.currentUser),
      getUserId: vi.fn().mockImplementation(() => (mockBridge.currentUser ? mockBridge.currentUser.uid : null)),
      listenVault: vi.fn().mockReturnValue(() => {}),
      listenDocs: vi.fn().mockReturnValue(() => {})
    };

    globalThis.FirebaseBridge = mockBridge;
    window.FirebaseBridge = mockBridge;

    globalThis.showToast = vi.fn();
    globalThis.openModal = vi.fn((id) => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'block';
    });
    globalThis.closeModal = vi.fn((id) => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    globalThis.renderBoard = vi.fn();
    globalThis.settings = { storageEngine: 'filesystem' };
    globalThis.DEFAULT_FIREBASE_CONFIG = { apiKey: 'mock-key', projectId: 'test-proj' };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('FirebaseSyncService supports email/password signIn, signUp, signOut, and reset', async () => {
    const svc = window.FirebaseSyncService;
    expect(svc).toBeDefined();

    // 1. Sign In With Email
    const user = await svc.signInWithEmail('test@example.com', 'password123');
    expect(mockBridge.signInWithEmail).toHaveBeenCalledWith('test@example.com', 'password123');
    expect(user.email).toBe('test@example.com');
    expect(svc.state.userEmail).toBe('test@example.com');
    expect(svc.state.userId).toBe('user-uid-123');
    expect(svc.state.isAnonymous).toBe(false);

    // 2. getAuthUser and getStatus
    const authUser = svc.getAuthUser();
    expect(authUser.email).toBe('test@example.com');
    expect(authUser.uid).toBe('user-uid-123');
    expect(authUser.isAnonymous).toBe(false);

    const status = svc.getStatus();
    expect(status.userEmail).toBe('test@example.com');
    expect(status.userId).toBe('user-uid-123');
    expect(status.isAnonymous).toBe(false);

    // 3. Sign Up With Email
    const newUser = await svc.signUpWithEmail('new@example.com', 'secretpass678');
    expect(mockBridge.signUpWithEmail).toHaveBeenCalledWith('new@example.com', 'secretpass678');
    expect(newUser.email).toBe('new@example.com');
    expect(svc.state.userEmail).toBe('new@example.com');

    // 4. Send Password Reset
    await svc.sendPasswordReset('test@example.com');
    expect(mockBridge.sendPasswordReset).toHaveBeenCalledWith('test@example.com');

    // 5. Sign Out
    await svc.signOut();
    expect(mockBridge.signOut).toHaveBeenCalled();
    expect(svc.state.userEmail).toBeNull();
    expect(svc.state.userId).toBe('default_user');
    expect(svc.state.isAnonymous).toBe(false);
  });

  it('switchSyncSetupTab switches fields correctly between signin, signup, link, and guest', () => {
    // Test signin mode
    globalThis.switchSyncSetupTab('signin');
    expect(document.getElementById('sync-setup-auth-fields').style.display).toBe('block');
    expect(document.getElementById('sync-setup-forgot-pass-link').style.display).toBe('inline');
    expect(document.getElementById('sync-setup-code-container').style.display).toBe('none');
    expect(document.getElementById('btn-submit-cloud-sync').getAttribute('data-mode')).toBe('signin');
    expect(document.getElementById('sync-setup-email').getAttribute('autocomplete')).toBe('username');
    expect(document.getElementById('sync-setup-auth-password').getAttribute('autocomplete')).toBe('current-password');
    expect(document.getElementById('sync-setup-username').disabled).toBe(true);

    // Test signup mode
    globalThis.switchSyncSetupTab('signup');
    expect(document.getElementById('sync-setup-auth-fields').style.display).toBe('block');
    expect(document.getElementById('sync-setup-forgot-pass-link').style.display).toBe('none');
    expect(document.getElementById('sync-setup-code-container').style.display).toBe('none');
    expect(document.getElementById('btn-submit-cloud-sync').getAttribute('data-mode')).toBe('signup');
    expect(document.getElementById('sync-setup-email').getAttribute('autocomplete')).toBe('username');
    expect(document.getElementById('sync-setup-auth-password').getAttribute('autocomplete')).toBe('new-password');
    expect(document.getElementById('sync-setup-username').disabled).toBe(true);

    // Test link mode
    globalThis.switchSyncSetupTab('link');
    expect(document.getElementById('sync-setup-auth-fields').style.display).toBe('none');
    expect(document.getElementById('sync-setup-code-container').style.display).toBe('block');
    expect(document.getElementById('btn-submit-cloud-sync').getAttribute('data-mode')).toBe('link');
    expect(document.getElementById('sync-setup-username').disabled).toBe(false);

    // Test guest mode
    globalThis.switchSyncSetupTab('guest');
    expect(document.getElementById('sync-setup-auth-fields').style.display).toBe('none');
    expect(document.getElementById('sync-setup-code-container').style.display).toBe('block');
    expect(document.getElementById('btn-submit-cloud-sync').getAttribute('data-mode')).toBe('guest');
    expect(document.getElementById('sync-setup-username').disabled).toBe(false);
  });

  it('updateCloudSyncUI updates preferences account display and buttons for signed-in, guest, and logged-out states', () => {
    const emailEl = document.getElementById('prefs-sync-account-email');
    const btnSignIn = document.getElementById('btn-prefs-sync-signin');
    const btnSignOut = document.getElementById('btn-prefs-sync-signout');
    const btnResetPass = document.getElementById('btn-prefs-sync-reset-pass');

    // 1. Signed in with email
    window.FirebaseSyncService = {
      getStatus: () => ({ status: 'synced', engine: 'firebase', notesCount: 5 }),
      getAuthUser: () => ({ uid: 'uid-1', email: 'user@vault.com', isAnonymous: false }),
      getSyncCode: () => 'SEC-ABCD-1234'
    };

    globalThis.updateCloudSyncUI();
    expect(emailEl.textContent).toContain('user@vault.com');
    expect(btnSignOut.style.display).toBe('inline-flex');
    expect(btnResetPass.style.display).toBe('inline-flex');

    // 2. Anonymous / Guest Session
    window.FirebaseSyncService.getAuthUser = () => ({ uid: 'anon-1', email: null, isAnonymous: true });
    globalThis.updateCloudSyncUI();
    expect(emailEl.textContent).toBe('sync.accountGuestSession');
    expect(btnSignOut.style.display).toBe('inline-flex');
    expect(btnResetPass.style.display).toBe('none');

    // 3. Not signed in / local
    window.FirebaseSyncService.getAuthUser = () => ({ uid: null, email: null, isAnonymous: false });
    globalThis.updateCloudSyncUI();
    expect(emailEl.textContent).toBe('sync.accountNotSignedIn');
    expect(btnSignOut.style.display).toBe('none');
    expect(btnResetPass.style.display).toBe('none');
  });

  it('password reset helper UI sends reset email and updates UI', async () => {
    window.FirebaseSyncService = {
      sendPasswordReset: vi.fn().mockResolvedValue(true)
    };

    document.getElementById('sync-reset-password-email').value = 'forgot@example.com';
    await globalThis.submitPasswordResetUI();

    expect(window.FirebaseSyncService.sendPasswordReset).toHaveBeenCalledWith('forgot@example.com');
    expect(globalThis.showToast).toHaveBeenCalled();
  });

  it('submitCloudSyncGoogle authenticates with Google, unlocks vault, and updates UI', async () => {
    window.FirebaseSyncService = {
      signInWithGoogle: vi.fn().mockResolvedValue({ uid: 'google-user-123', email: 'etienne@google.com' }),
      generateDefaultPassphrase: () => 'my-super-strong-passphrase-123',
      unlockVault: vi.fn().mockResolvedValue(true)
    };
    globalThis.closeModal = vi.fn();
    globalThis.showToast = vi.fn();
    globalThis.updateCloudSyncUI = vi.fn();

    await globalThis.submitCloudSyncGoogle();

    expect(window.FirebaseSyncService.signInWithGoogle).toHaveBeenCalled();
    expect(window.FirebaseSyncService.unlockVault).toHaveBeenCalledWith('my-super-strong-passphrase-123', false);
    expect(globalThis.closeModal).toHaveBeenCalledWith('modal-cloud-sync-setup');
    expect(globalThis.showToast).toHaveBeenCalled();
    expect(globalThis.updateCloudSyncUI).toHaveBeenCalled();
  });

  it('submitCloudSyncMagicLink validates email and triggers sendSignInLink', async () => {
    window.FirebaseSyncService = {
      sendSignInLink: vi.fn().mockResolvedValue(true)
    };
    globalThis.showToast = vi.fn();

    // Invalid email
    document.getElementById('sync-setup-email').value = 'invalid';
    await globalThis.submitCloudSyncMagicLink();
    expect(window.FirebaseSyncService.sendSignInLink).not.toHaveBeenCalled();

    // Valid email
    document.getElementById('sync-setup-email').value = 'magic@example.com';
    await globalThis.submitCloudSyncMagicLink();
    expect(window.FirebaseSyncService.sendSignInLink).toHaveBeenCalledWith('magic@example.com');
    expect(globalThis.showToast).toHaveBeenCalled();
  });

  it('checkPendingEmailLinkAuth detects email link in URL and signs in', async () => {
    window.FirebaseSyncService = {
      isSignInWithEmailLink: vi.fn().mockReturnValue(true),
      signInWithEmailLink: vi.fn().mockResolvedValue({ uid: 'link-user-1', email: 'magic@example.com' }),
      unlockVault: vi.fn().mockResolvedValue(true)
    };
    localStorage.setItem('secretary_email_link_email', 'magic@example.com');
    localStorage.setItem('secretary_magic_link_pending_pass', 'my-vault-pass-123');
    globalThis.showToast = vi.fn();
    globalThis.updateCloudSyncUI = vi.fn();

    await globalThis.checkPendingEmailLinkAuth();

    expect(window.FirebaseSyncService.signInWithEmailLink).toHaveBeenCalledWith('magic@example.com', window.location.href);
    expect(window.FirebaseSyncService.unlockVault).toHaveBeenCalledWith('my-vault-pass-123', true);
    expect(globalThis.showToast).toHaveBeenCalled();
    expect(globalThis.updateCloudSyncUI).toHaveBeenCalled();
  });

  it('window.showToast is defined globally and forwards to toast helper', () => {
    expect(typeof window.showToast).toBe('function');
  });

  it('submitCloudSyncSetup in link mode validates inputs and shows toast error', async () => {
    const toastSpy = vi.fn();
    window.showToast = toastSpy;
    document.getElementById('btn-submit-cloud-sync').setAttribute('data-mode', 'link');

    // Missing sync code
    document.getElementById('sync-setup-sync-code').value = '';
    document.getElementById('sync-setup-passphrase').value = 'valid-passphrase-123';
    await globalThis.submitCloudSyncSetup();
    expect(toastSpy).toHaveBeenCalledWith('sync.syncCodeRequired', true);

    // Short passphrase
    toastSpy.mockClear();
    document.getElementById('sync-setup-sync-code').value = 'SEC-TEST-1234';
    document.getElementById('sync-setup-passphrase').value = 'short';
    await globalThis.submitCloudSyncSetup();
    expect(toastSpy).toHaveBeenCalledWith('sync.passphraseTooShort', true);
  });

  it('submitCloudSyncSetup in link mode links existing vault and displays error toast on failure', async () => {
    const toastSpy = vi.fn();
    window.showToast = toastSpy;
    document.getElementById('btn-submit-cloud-sync').setAttribute('data-mode', 'link');
    document.getElementById('sync-setup-sync-code').value = 'SEC-TEST-9999';
    document.getElementById('sync-setup-passphrase').value = 'super-secret-passphrase';

    window.FirebaseSyncService = {
      linkExistingVault: vi.fn().mockRejectedValue(new Error('Sync Code not found in cloud'))
    };

    await globalThis.submitCloudSyncSetup();
    expect(window.FirebaseSyncService.linkExistingVault).toHaveBeenCalledWith(
      'SEC-TEST-9999',
      'super-secret-passphrase',
      expect.any(Object),
      expect.any(Function)
    );
    expect(toastSpy).toHaveBeenCalledWith('sync.setupFailed: Sync Code not found in cloud', true);
  });

  it('submitCloudSyncSetup auto-applies custom Firebase config from textarea', async () => {
    const customTextarea = document.createElement('textarea');
    customTextarea.id = 'sync-custom-firebase-json';
    customTextarea.value = '{"apiKey": "AIzaSyCustomKey", "projectId": "custom-vault"}';
    document.body.appendChild(customTextarea);

    window.FirebaseSyncService = {
      parseFirebaseConfigString: vi.fn().mockReturnValue({ apiKey: 'AIzaSyCustomKey', projectId: 'custom-vault' }),
      setCustomFirebaseConfig: vi.fn().mockReturnValue(true),
      linkExistingVault: vi.fn().mockResolvedValue(true)
    };
    globalThis.closeModal = vi.fn();
    globalThis.updateCloudSyncUI = vi.fn();
    window.showToast = vi.fn();

    document.getElementById('btn-submit-cloud-sync').setAttribute('data-mode', 'link');
    document.getElementById('sync-setup-sync-code').value = 'SEC-CUSTOM-111';
    document.getElementById('sync-setup-passphrase').value = 'valid-passphrase-123';

    await globalThis.submitCloudSyncSetup();

    expect(window.FirebaseSyncService.parseFirebaseConfigString).toHaveBeenCalledWith('{"apiKey": "AIzaSyCustomKey", "projectId": "custom-vault"}');
    expect(window.FirebaseSyncService.setCustomFirebaseConfig).toHaveBeenCalledWith({ apiKey: 'AIzaSyCustomKey', projectId: 'custom-vault' });
    expect(window.FirebaseSyncService.linkExistingVault).toHaveBeenCalledWith(
      'SEC-CUSTOM-111',
      'valid-passphrase-123',
      expect.any(Object),
      expect.any(Function)
    );
  });

  it('submitCloudSyncSetup displays migration progress dialog during link operation', async () => {
    const dialogUpdateSpy = vi.fn();
    const dialogCloseSpy = vi.fn();
    globalThis.showMigrationProgressDialog = vi.fn().mockReturnValue({
      update: dialogUpdateSpy,
      close: dialogCloseSpy
    });

    window.FirebaseSyncService = {
      linkExistingVault: vi.fn().mockImplementation(async (code, pass, config, onProgress) => {
        if (typeof onProgress === 'function') {
          onProgress('Connecting...', 20);
          onProgress('Downloading...', 70);
        }
        return { linkedCount: 5, syncCode: code };
      })
    };
    globalThis.closeModal = vi.fn();
    globalThis.updateCloudSyncUI = vi.fn();
    window.showToast = vi.fn();

    document.getElementById('btn-submit-cloud-sync').setAttribute('data-mode', 'link');
    document.getElementById('sync-setup-sync-code').value = 'SEC-PROG-123';
    document.getElementById('sync-setup-passphrase').value = 'valid-passphrase-123';

    await globalThis.submitCloudSyncSetup();

    expect(globalThis.showMigrationProgressDialog).toHaveBeenCalled();
    expect(dialogUpdateSpy).toHaveBeenCalledWith('Connecting...', 20);
    expect(dialogUpdateSpy).toHaveBeenCalledWith('Downloading...', 70);
    expect(dialogUpdateSpy).toHaveBeenCalledWith(expect.any(String), 100);
    expect(dialogCloseSpy).toHaveBeenCalled();
  });

  it('submitCloudSyncSetup in signin mode advances to 100% and closes progress dialog before mount', async () => {
    const dialogUpdateSpy = vi.fn();
    const dialogCloseSpy = vi.fn();
    globalThis.showMigrationProgressDialog = vi.fn().mockReturnValue({
      update: dialogUpdateSpy,
      close: dialogCloseSpy
    });

    window.FirebaseSyncService = {
      signInWithEmail: vi.fn().mockResolvedValue({ uid: 'test-uid' }),
      unlockVault: vi.fn().mockResolvedValue(true)
    };
    window.StorageAPI = {
      detectSyncConflict: vi.fn().mockResolvedValue(null)
    };
    globalThis.closeModal = vi.fn();
    globalThis.updateCloudSyncUI = vi.fn();
    window.showToast = vi.fn();

    document.getElementById('btn-submit-cloud-sync').setAttribute('data-mode', 'signin');
    document.getElementById('sync-setup-email').value = 'user@test.com';
    document.getElementById('sync-setup-auth-password').value = 'secure-password';
    document.getElementById('sync-setup-passphrase').value = 'valid-passphrase-123';

    await globalThis.submitCloudSyncSetup();

    expect(dialogUpdateSpy).toHaveBeenCalledWith(expect.any(String), 95);
    expect(dialogUpdateSpy).toHaveBeenCalledWith(expect.any(String), 100);
    expect(dialogCloseSpy).toHaveBeenCalled();
  });

  it('submitCloudSyncSetup in signup mode advances to 100% and closes progress dialog before mount', async () => {
    const dialogUpdateSpy = vi.fn();
    const dialogCloseSpy = vi.fn();
    globalThis.showMigrationProgressDialog = vi.fn().mockReturnValue({
      update: dialogUpdateSpy,
      close: dialogCloseSpy
    });

    window.FirebaseSyncService = {
      signUpWithEmail: vi.fn().mockResolvedValue({ uid: 'test-new-uid' })
    };
    window.StorageAPI = {
      migrateToFirebase: vi.fn().mockImplementation(async (pass, config, onProgress) => {
        if (typeof onProgress === 'function') {
          onProgress({ message: 'Encrypting...', percent: 50 });
        }
      })
    };
    globalThis.closeModal = vi.fn();
    globalThis.updateCloudSyncUI = vi.fn();
    window.showToast = vi.fn();

    document.getElementById('btn-submit-cloud-sync').setAttribute('data-mode', 'signup');
    document.getElementById('sync-setup-email').value = 'newuser@test.com';
    document.getElementById('sync-setup-auth-password').value = 'secure-password';
    document.getElementById('sync-setup-passphrase').value = 'valid-passphrase-123';

    await globalThis.submitCloudSyncSetup();

    expect(dialogUpdateSpy).toHaveBeenCalledWith('Encrypting...', 50);
    expect(dialogUpdateSpy).toHaveBeenCalledWith(expect.any(String), 100);
    expect(dialogCloseSpy).toHaveBeenCalled();
  });

  describe('Multi-Provider Linking & Account Management', () => {
    it('FirebaseSyncService.linkGoogle calls bridge.linkGoogle and records provider', async () => {
      mockBridge.linkGoogle = vi.fn().mockResolvedValue({
        uid: 'user-uid-123',
        email: 'googleuser@gmail.com',
        providerData: [{ providerId: 'google.com', email: 'googleuser@gmail.com' }]
      });
      window.FirebaseBridge = mockBridge;
      window.FirebaseSyncService.bridge = mockBridge;

      const user = await window.FirebaseSyncService.linkGoogle();
      expect(mockBridge.linkGoogle).toHaveBeenCalled();
      expect(user.email).toBe('googleuser@gmail.com');
      expect(user.uid).toBe('user-uid-123');
    });

    it('FirebaseSyncService.linkEmail calls bridge.linkEmail and records provider', async () => {
      mockBridge.linkEmail = vi.fn().mockResolvedValue({
        uid: 'user-uid-123',
        email: 'linked@example.com',
        providerData: [{ providerId: 'password', email: 'linked@example.com' }]
      });
      window.FirebaseBridge = mockBridge;
      window.FirebaseSyncService.bridge = mockBridge;

      const user = await window.FirebaseSyncService.linkEmail('linked@example.com', 'secret123');
      expect(mockBridge.linkEmail).toHaveBeenCalledWith('linked@example.com', 'secret123');
      expect(user.email).toBe('linked@example.com');
    });

    it('FirebaseSyncService.unlinkProvider calls bridge.unlinkProvider', async () => {
      mockBridge.unlinkProvider = vi.fn().mockResolvedValue({
        uid: 'user-uid-123',
        providerData: []
      });
      window.FirebaseBridge = mockBridge;
      window.FirebaseSyncService.bridge = mockBridge;

      await window.FirebaseSyncService.unlinkProvider('google.com');
      expect(mockBridge.unlinkProvider).toHaveBeenCalledWith('google.com');
    });

    it('linkCloudSyncGoogleUI triggers linkGoogle and updates UI', async () => {
      window.FirebaseSyncService.linkGoogle = vi.fn().mockResolvedValue({});
      globalThis.updateCloudSyncUI = vi.fn();
      window.showToast = vi.fn();

      await globalThis.linkCloudSyncGoogleUI();
      expect(window.FirebaseSyncService.linkGoogle).toHaveBeenCalled();
      expect(globalThis.updateCloudSyncUI).toHaveBeenCalled();
      expect(window.showToast).toHaveBeenCalled();
    });

    it('submitLinkEmailUI validates inputs and calls linkEmail', async () => {
      // Add modal inputs to document
      const container = document.createElement('div');
      container.innerHTML = `
        <input id="link-email-input" value="test@example.com">
        <input id="link-password-input" value="123456">
      `;
      document.body.appendChild(container);

      window.FirebaseSyncService.linkEmail = vi.fn().mockResolvedValue({});
      globalThis.closeModal = vi.fn();
      globalThis.updateCloudSyncUI = vi.fn();
      window.showToast = vi.fn();

      await globalThis.submitLinkEmailUI();
      expect(window.FirebaseSyncService.linkEmail).toHaveBeenCalledWith('test@example.com', '123456');
      expect(globalThis.closeModal).toHaveBeenCalledWith('modal-cloud-link-email');
      expect(globalThis.updateCloudSyncUI).toHaveBeenCalled();
      expect(window.showToast).toHaveBeenCalled();
    });

    it('updateCloudSyncUI displays user info section when engine is firebase and hides when filesystem', () => {
      const userInfoSection = document.createElement('div');
      userInfoSection.id = 'prefs-sec-user-info';
      userInfoSection.style.display = 'none';
      document.body.appendChild(userInfoSection);

      window.FirebaseSyncService.getAuthUser = vi.fn().mockReturnValue({
        uid: 'user-abc',
        email: 'user@example.com',
        isAnonymous: false,
        linkedProviders: [{ providerId: 'google.com' }]
      });

      if (typeof globalThis.switchPrefsTab === 'function') {
        globalThis.switchPrefsTab('sync');
      }

      // Firebase mode
      globalThis.updateCloudSyncUI({ engine: 'firebase', status: 'connected' });
      expect(userInfoSection.style.display).toBe('block');

      // Local filesystem mode
      globalThis.updateCloudSyncUI({ engine: 'filesystem', status: 'idle' });
      expect(userInfoSection.style.display).toBe('none');
    });
  });
});


