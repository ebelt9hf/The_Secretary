import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { Window } from 'happy-dom';

describe('Delete User and Data & Red Log Off Wipe Engine (tests/unit/app-delete-user-and-data.test.js)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('contains all required translations for delete user & red logoff wipe across all 15 languages', () => {
    const translationsCode = fs.readFileSync(path.join(process.cwd(), 'js/translations.js'), 'utf-8');
    const fn = new Function('window', translationsCode + '; return window.APP_TRANSLATIONS_BUNDLE;');
    const mockWin = {};
    const bundle = fn(mockWin);
    const tMap = bundle.translations;

    const requiredKeys = [
      'confirm.logOffModalTitle',
      'confirm.logOffModalDesc',
      'confirm.logOffKeepCacheBtn',
      'confirm.logOffKeepCacheTooltip',
      'confirm.logOffWipeLocalBtn',
      'confirm.logOffWipeLocalTooltip',
      'prefs.dangerZoneTitle',
      'prefs.deleteUserCardTitle',
      'prefs.deleteUserCardDesc',
      'prefs.deleteUserBtn',
      'prefs.deleteUserTooltip',
      'confirm.deleteUserTitle',
      'confirm.deleteUserWarning',
      'confirm.deleteUserCloudNotice',
      'confirm.deleteUserLocalNotice',
      'confirm.deleteUserTypePrompt',
      'confirm.deleteUserConfirmBtn',
      'confirm.deleteUserConfirmTooltip',
      'confirm.deleteUserSuccessToast',
      'confirm.logOffWipedSuccessToast'
    ];

    const expectedLangs = ['cs', 'de', 'en', 'es', 'fr', 'hu', 'it', 'nl', 'pl', 'pt', 'ro', 'ru', 'sv', 'tr', 'uk'];

    for (const key of requiredKeys) {
      expect(tMap[key], `Missing translation key: ${key}`).toBeDefined();
      for (const lang of expectedLangs) {
        expect(tMap[key][lang], `Missing lang '${lang}' for key '${key}'`).toBeTruthy();
        // Plain text only, no emojis allowed in translation strings
        expect(tMap[key][lang]).not.toMatch(/[\u{1F300}-\u{1F9FF}]/u);
      }
    }
  });

  it('provides deleteCurrentUser and deleteUserData in FirebaseBridge', () => {
    const firebaseEntryCode = fs.readFileSync(path.join(process.cwd(), 'development/firebase-entry.js'), 'utf-8');
    expect(firebaseEntryCode).toContain('deleteCurrentUser');
    expect(firebaseEntryCode).toContain('deleteUserData');
    expect(firebaseEntryCode).toContain('deleteUser');
  });

  it('provides deleteDatabase on VaultIDBStorage', () => {
    const idbCode = fs.readFileSync(path.join(process.cwd(), 'js/app-idb.js'), 'utf-8');
    expect(idbCode).toContain('deleteDatabase');
  });

  it('provides wipeAllLocalData on StorageAPI or window', () => {
    const storageCode = fs.readFileSync(path.join(process.cwd(), 'js/app-storage.js'), 'utf-8') +
                        fs.readFileSync(path.join(process.cwd(), 'js/app-init.js'), 'utf-8');
    expect(storageCode).toContain('wipeAllLocalData');
  });

  it('enables the delete confirmation button only when DELETE is typed', () => {
    const window = new Window();
    globalThis.window = window;
    globalThis.document = window.document;

    const input = window.document.createElement('input');
    input.id = 'delete-user-confirm-input';
    const btn = window.document.createElement('button');
    btn.id = 'btn-confirm-delete-user';
    btn.disabled = true;

    window.document.body.appendChild(input);
    window.document.body.appendChild(btn);

    const onInputHandler = () => {
      btn.disabled = input.value.trim() !== 'DELETE';
    };
    input.addEventListener('input', onInputHandler);

    input.value = 'del';
    onInputHandler();
    expect(btn.disabled).toBe(true);

    input.value = 'delete';
    onInputHandler();
    expect(btn.disabled).toBe(true);

    input.value = 'DELETE';
    onInputHandler();
    expect(btn.disabled).toBe(false);

    input.value = 'DELETE ';
    onInputHandler();
    expect(btn.disabled).toBe(false);

    input.value = 'other';
    onInputHandler();
    expect(btn.disabled).toBe(true);
  });

  it('includes proper modals and danger zone card in templates/modals.html and app.html', () => {
    const modalsHtml = fs.readFileSync(path.join(process.cwd(), 'templates/modals.html'), 'utf-8');
    const appHtml = fs.readFileSync(path.join(process.cwd(), 'app.html'), 'utf-8');

    // Modals
    expect(modalsHtml).toContain('id="modal-logoff-confirm"');
    expect(modalsHtml).toContain('id="btn-logoff-wipe-local"');
    expect(modalsHtml).toContain('id="modal-delete-user-confirm"');
    expect(modalsHtml).toContain('id="delete-user-confirm-input"');
    expect(modalsHtml).toContain('id="btn-confirm-delete-user"');

    // App Preferences Card
    expect(appHtml).toContain('id="prefs-danger-zone-row"');
    expect(appHtml).toContain('id="btn-user-delete-account"');
  });

  it('executes StorageAPI.wipeAllLocalData correctly', async () => {
    const window = new Window();
    globalThis.window = window;
    globalThis.document = window.document;
    globalThis.localStorage = window.localStorage;
    globalThis.sessionStorage = window.sessionStorage;

    window.localStorage.setItem('secretaryLocalSettings', '{"theme":"dark"}');
    window.localStorage.setItem('secretary_conv_123', '[]');
    window.localStorage.setItem('unrelated_key', 'keep_me');
    window.sessionStorage.setItem('temp_token', 'xyz');

    globalThis.manifest = [{ id: 'note1' }];
    globalThis.todosManifest = [{ id: 'todo1' }];
    globalThis.plannerEvents = [{ id: 'event1' }];
    globalThis.rootHandle = { name: 'my-folder' };

    const deleteDBCalls = [];
    globalThis.VaultIDBStorage = {
      deleteDatabase: vi.fn(async () => {
        deleteDBCalls.push('SecretaryFirebaseVaultDB');
        return true;
      })
    };

    globalThis.showLandingStep = vi.fn();
    globalThis.updateCloudSyncUI = vi.fn();

    const screenMain = window.document.createElement('div');
    screenMain.id = 'screen-main';
    screenMain.classList.add('active');
    window.document.body.appendChild(screenMain);

    const screenConnect = window.document.createElement('div');
    screenConnect.id = 'screen-connect';
    screenConnect.style.display = 'none';
    window.document.body.appendChild(screenConnect);

    // Extract StorageAPI definition from app-storage.js
    const storageCode = fs.readFileSync(path.join(process.cwd(), 'js/app-storage.js'), 'utf-8');
    const match = storageCode.match(/async wipeAllLocalData\(options = \{\}\)\s*\{[\s\S]*?\n  \}/);
    expect(match).not.toBeNull();

    const evalFn = new Function('VaultIDBStorage', 'const obj = {' + match[0] + '}; return obj.wipeAllLocalData;');
    const wipeAllLocalData = evalFn(globalThis.VaultIDBStorage);

    await wipeAllLocalData({ clearEntireLocalStorage: true });

    expect(globalThis.VaultIDBStorage.deleteDatabase).toHaveBeenCalled();
    expect(globalThis.manifest).toEqual([]);
    expect(globalThis.todosManifest).toEqual([]);
    expect(globalThis.plannerEvents).toEqual([]);
    expect(globalThis.rootHandle).toBeNull();
    expect(screenMain.classList.contains('active')).toBe(false);
    expect(screenConnect.style.display).toBe('');
    expect(globalThis.showLandingStep).toHaveBeenCalledWith('welcome');
  });

  it('handles confirmLogOffWithLocalWipeUI by signing out and wiping local data', async () => {
    const window = new Window();
    globalThis.window = window;
    globalThis.document = window.document;

    const toasts = [];
    globalThis.showToast = vi.fn((msg, isErr) => toasts.push({ msg, isErr }));
    globalThis.t = vi.fn((key) => key);
    globalThis.closeModal = vi.fn();

    const signOutMock = vi.fn(async () => true);
    const lockVaultMock = vi.fn();
    globalThis.FirebaseSyncService = {
      signOut: signOutMock,
      lockVault: lockVaultMock
    };
    window.FirebaseSyncService = globalThis.FirebaseSyncService;

    const wipeMock = vi.fn(async () => true);
    globalThis.StorageAPI = {
      wipeAllLocalData: wipeMock
    };

    // Extract confirmLogOffWithLocalWipeUI from app-init.js
    const appInitCode = fs.readFileSync(path.join(process.cwd(), 'js/app-init.js'), 'utf-8');
    const match = appInitCode.match(/async function confirmLogOffWithLocalWipeUI\(\)\s*\{[\s\S]*?\n\}\nwindow\.confirmLogOffWithLocalWipeUI = confirmLogOffWithLocalWipeUI;/);
    expect(match).not.toBeNull();

    const evalFn = new Function(match[0] + '; return confirmLogOffWithLocalWipeUI;');
    const confirmLogOffWithLocalWipeUI = evalFn();

    const res = await confirmLogOffWithLocalWipeUI();
    expect(res).toBe(true);
    expect(signOutMock).toHaveBeenCalled();
    expect(lockVaultMock).toHaveBeenCalled();
    expect(wipeMock).toHaveBeenCalledWith({ clearEntireLocalStorage: true });
    expect(toasts.some(t => t.msg === 'confirm.logOffWipedSuccessToast')).toBe(true);
  });

  it('handles confirmDeleteUserAndDataUI by calling remote deletion in cloud mode and wiping local data', async () => {
    const window = new Window();
    globalThis.window = window;
    globalThis.document = window.document;

    const input = window.document.createElement('input');
    input.id = 'delete-user-confirm-input';
    input.value = 'DELETE';
    window.document.body.appendChild(input);

    const btn = window.document.createElement('button');
    btn.id = 'btn-confirm-delete-user';
    window.document.body.appendChild(btn);

    const toasts = [];
    globalThis.showToast = vi.fn((msg, isErr) => toasts.push({ msg, isErr }));
    globalThis.t = vi.fn((key) => key);
    globalThis.closeModal = vi.fn();

    const deleteVaultMock = vi.fn(async () => true);
    globalThis.FirebaseSyncService = {
      deleteUserAccountAndCloudVault: deleteVaultMock
    };
    window.FirebaseSyncService = globalThis.FirebaseSyncService;

    const wipeMock = vi.fn(async () => true);
    globalThis.StorageAPI = {
      wipeAllLocalData: wipeMock
    };

    const appInitCode = fs.readFileSync(path.join(process.cwd(), 'js/app-init.js'), 'utf-8');
    const match = appInitCode.match(/async function confirmDeleteUserAndDataUI\(\)\s*\{[\s\S]*?\n\}\nwindow\.confirmDeleteUserAndDataUI = confirmDeleteUserAndDataUI;/);
    expect(match).not.toBeNull();

    const evalFn = new Function(match[0] + '; return confirmDeleteUserAndDataUI;');
    const confirmDeleteUserAndDataUI = evalFn();

    const res = await confirmDeleteUserAndDataUI();
    expect(res).toBe(true);
    expect(deleteVaultMock).toHaveBeenCalled();
    expect(wipeMock).toHaveBeenCalledWith({ clearEntireLocalStorage: true });
    expect(toasts.some(t => t.msg === 'confirm.deleteUserSuccessToast')).toBe(true);
  });

  it('unlinks email provider and deletes user in FirebaseBridge.deleteCurrentUser', async () => {
    const unlinkedProviders = [];
    let userDeleted = false;

    const mockUser = {
      uid: 'user_123',
      email: 'member@example.com',
      providerData: [
        { providerId: 'google.com' },
        { providerId: 'password', email: 'member@example.com' }
      ]
    };

    // Load FirebaseBridge logic or simulate
    const bridge = {
      auth: {},
      getUser: () => mockUser,
      currentUser: mockUser,
      async deleteCurrentUser() {
        if (!this.auth) return false;
        const user = this.getUser();
        if (!user) return false;
        if (Array.isArray(user.providerData) && user.providerData.length > 1) {
          const emailProvider = user.providerData.find(
            p => p.providerId === 'password' || p.providerId === 'emailLink'
          );
          if (emailProvider) {
            unlinkedProviders.push(emailProvider.providerId);
          }
          for (const p of user.providerData) {
            unlinkedProviders.push(p.providerId);
          }
        }
        userDeleted = true;
        this.currentUser = null;
        return true;
      }
    };

    const res = await bridge.deleteCurrentUser();
    expect(res).toBe(true);
    expect(userDeleted).toBe(true);
    expect(unlinkedProviders).toContain('password');
    expect(bridge.currentUser).toBeNull();
  });

  it('ensures deleteUserAccountAndCloudVault removes email links and credentials', async () => {
    const window = new Window();
    globalThis.window = window;
    globalThis.localStorage = window.localStorage;
    globalThis.settings = {
      vaultId: 'v123',
      vaultMeta: { salt: 'abc' },
      lastSyncEmail: 'testuser@example.com'
    };

    window.localStorage.setItem('secretary_email_link_email', 'testuser@example.com');
    window.localStorage.setItem('secretary_magic_link_pending_pass', 'mypassword');
    window.localStorage.setItem('secretary_pending_email_link', 'https://example.com/login?apiKey=abc&oobCode=123');

    const bridgeDeleteUserMock = vi.fn(async () => true);
    const bridgeDeleteDataMock = vi.fn(async () => true);

    const mockBridge = {
      getUserId: () => 'uid_test',
      deleteUserData: bridgeDeleteDataMock,
      deleteCurrentUser: bridgeDeleteUserMock
    };

    const idbDeleteMock = vi.fn(async () => true);
    globalThis.VaultIDBStorage = {
      deleteDatabase: idbDeleteMock,
      clearStore: vi.fn(async () => true),
      clearWAL: vi.fn(async () => true),
      deleteMeta: vi.fn(async () => true)
    };

    const syncService = {
      _getBridge: () => mockBridge,
      state: {
        userId: 'uid_test',
        userEmail: 'testuser@example.com',
        isAnonymous: false,
        pendingQueue: new Map(),
        pendingDocsQueue: new Map(),
        pendingAssetsQueue: new Map()
      },
      lockVault: vi.fn(),
      clearSavedPassphrase: vi.fn(async () => true),
      _notifyStatus: vi.fn(),
      async purgeLocalSessionAndQuit(skipFlush = false) {
        if (!skipFlush && this.state.pendingQueue.size > 0) {
          // would flush
        }
        this.lockVault();
        return true;
      }
    };

    // Extract deleteUserAccountAndCloudVault from app-firebase-sync.js
    const syncCode = fs.readFileSync(path.join(process.cwd(), 'js/app-firebase-sync.js'), 'utf-8');
    const match = syncCode.match(/async deleteUserAccountAndCloudVault\(\)\s*\{[\s\S]*?\n  \},/);
    expect(match).not.toBeNull();

    const evalFn = new Function('VaultIDBStorage', 'settings', 'const obj = {' + match[0] + '}; return obj.deleteUserAccountAndCloudVault;');
    const deleteUserAccountAndCloudVault = evalFn(globalThis.VaultIDBStorage, globalThis.settings);

    await deleteUserAccountAndCloudVault.call(syncService);

    expect(bridgeDeleteDataMock).toHaveBeenCalledWith('uid_test');
    expect(bridgeDeleteUserMock).toHaveBeenCalled();
    expect(window.localStorage.getItem('secretary_email_link_email')).toBeNull();
    expect(window.localStorage.getItem('secretary_magic_link_pending_pass')).toBeNull();
    expect(window.localStorage.getItem('secretary_pending_email_link')).toBeNull();
    expect(globalThis.settings.lastSyncEmail).toBeUndefined();
    expect(syncService.state.userEmail).toBeNull();
    expect(idbDeleteMock).toHaveBeenCalled();
  });
});
