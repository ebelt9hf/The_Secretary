import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Demo workspace isolation & Unlock modal cancel workflow', () => {
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
      <div id="screen-main"></div>
      <div id="screen-connect" style="display:none;"></div>
      <div id="folder-name"></div>
      <div id="startup-progress-wrap" style="display:none;"></div>
      <div id="startup-progress-fill"></div>
      <div id="startup-progress-pct"></div>
      <div id="startup-progress-step"></div>
    `;
    globalThis.openModal = vi.fn();
    globalThis.closeModal = vi.fn();
    globalThis.showToast = vi.fn();
  });

  it('createDemoVirtualDirectoryHandle creates an isolated virtual handle with filesystem storage settings', async () => {
    const handle = window.createDemoVirtualDirectoryHandle();
    expect(handle).toBeDefined();
    expect(handle.kind).toBe('directory');
    expect(handle.name).toBe('Demo Workspace (Sandbox)');
    expect(handle.isVirtual).toBe(true);
    expect(handle.isDemo).toBe(true);

    const settingsFileHandle = await handle.getFileHandle('secretary-settings.json');
    const file = await settingsFileHandle.getFile();
    const content = JSON.parse(await file.text());
    expect(content.storageEngine).toBe('filesystem');
  });

  it('launching demo workspace when previous state was firebase resets storageEngine to filesystem without opening unlock modal', async () => {
    globalThis.settings = {
      storageEngine: 'firebase',
      rememberPassphrase: false
    };
    window.StorageAPI = {
      setStorageEngine: vi.fn(),
      getStorageEngine: () => 'firebase',
      clearNoteCache: vi.fn()
    };
    window.FirebaseSyncService = {
      state: { engine: 'firebase', isUnlocked: false },
      STATUS: { DISCONNECTED: 'disconnected', LOCKED: 'locked' }
    };

    let mountedHandle = null;
    globalThis.mountFolder = vi.fn(async (h) => {
      mountedHandle = h;
    });

    await window.startDemoWorkspaceFromLanding();

    expect(globalThis.settings.storageEngine).toBe('filesystem');
    expect(window.StorageAPI.setStorageEngine).toHaveBeenCalledWith('filesystem');
    expect(window.FirebaseSyncService.state.engine).toBe('filesystem');
    expect(globalThis.openModal).not.toHaveBeenCalledWith('modal-cloud-sync-unlock');
    expect(mountedHandle).toBeDefined();
    expect(mountedHandle.isVirtual).toBe(true);
  });

  it('cancelCloudSyncUnlock safely closes modal and returns user to connect/welcome screen when vault is locked', async () => {
    window.FirebaseSyncService = {
      state: { engine: 'firebase', isUnlocked: false }
    };
    const mainScreen = document.getElementById('screen-main');
    const connectScreen = document.getElementById('screen-connect');
    mainScreen.classList.add('active');
    connectScreen.style.display = 'none';

    globalThis.handleLogOffUI = vi.fn(async () => {
      mainScreen.classList.remove('active');
      connectScreen.style.display = '';
    });

    await window.cancelCloudSyncUnlock();

    expect(globalThis.closeModal).toHaveBeenCalledWith('modal-cloud-sync-unlock');
    expect(globalThis.handleLogOffUI).toHaveBeenCalled();
    expect(mainScreen.classList.contains('active')).toBe(false);
    expect(connectScreen.style.display).toBe('');
  });
});
