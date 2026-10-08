import { describe, it, expect, beforeEach, beforeAll, afterEach, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Firebase Email & Password Authentication and Account UI', () => {
  let mockBridge;

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
  });

  beforeEach(() => {
    // Set up basic DOM structure
    document.body.innerHTML = `
      <div class="modal-overlay" id="modal-cloud-sync-setup" style="display:none;">
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

    // Test signup mode
    globalThis.switchSyncSetupTab('signup');
    expect(document.getElementById('sync-setup-auth-fields').style.display).toBe('block');
    expect(document.getElementById('sync-setup-forgot-pass-link').style.display).toBe('none');
    expect(document.getElementById('sync-setup-code-container').style.display).toBe('none');
    expect(document.getElementById('btn-submit-cloud-sync').getAttribute('data-mode')).toBe('signup');

    // Test link mode
    globalThis.switchSyncSetupTab('link');
    expect(document.getElementById('sync-setup-auth-fields').style.display).toBe('none');
    expect(document.getElementById('sync-setup-code-container').style.display).toBe('block');
    expect(document.getElementById('btn-submit-cloud-sync').getAttribute('data-mode')).toBe('link');

    // Test guest mode
    globalThis.switchSyncSetupTab('guest');
    expect(document.getElementById('sync-setup-auth-fields').style.display).toBe('none');
    expect(document.getElementById('sync-setup-code-container').style.display).toBe('block');
    expect(document.getElementById('btn-submit-cloud-sync').getAttribute('data-mode')).toBe('guest');
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
});
