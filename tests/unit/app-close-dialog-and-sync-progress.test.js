import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('App Close Dialog & Sync Progress Engine (app-init.js)', () => {
  beforeAll(() => {
    globalThis.window = globalThis.window || {};
    globalThis.t = (key) => key;
    globalThis.getNoteById = vi.fn().mockReturnValue(null);
    globalThis.openNoteOverlay = vi.fn();

    loadScriptsIntoGlobal([
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-utils.js',
      'js/app-state.js',
      'js/app-bridge.js',
      'js/app-init.js'
    ]);
  });

  beforeEach(() => {
    document.body.className = '';
    document.body.innerHTML = `
      <div id="screen-main">
        <div class="topbar-row topbar-main-row" id="topbar-main-row">
          <button id="tab-planner">Planner</button>
          <button id="tab-notes">Notes</button>
        </div>
      </div>
      <div id="modal-cloud-exit-confirm" class="modal-overlay" style="display:none;"></div>
    `;
    window.location.hash = '#tab=notes&note=note-test-123';
    window._isExiting = false;
    window._isClosePromptActive = false;
  });

  it('opens confirmation dialog on main window even when location.hash contains note=id', async () => {
    const showConfirmSpy = vi.fn().mockResolvedValue(false);
    window.showConfirmDialog = showConfirmSpy;

    // Simulate storage engine as filesystem
    window.FirebaseSyncService = {
      state: { engine: 'filesystem', status: 'synced', pendingQueue: new Map() },
      hasPendingCloudWrites: () => false
    };

    const result = await window.handleMainWindowCloseRequest();

    // Confirm dialog should be shown, not skipped as standalone
    expect(showConfirmSpy).toHaveBeenCalled();
    expect(result).toBe(false); // user clicked cancel
  });

  it('opens progress bar dialog when syncing is in progress upon confirmed exit', async () => {
    window.showConfirmDialog = vi.fn().mockResolvedValue(true);

    const flushQueueSpy = vi.fn().mockImplementation(async () => {
      window.FirebaseSyncService.state.status = 'synced';
      return true;
    });
    window.FirebaseSyncService = {
      state: { engine: 'filesystem', status: 'syncing', pendingQueue: new Map([['note-1', {}]]) },
      hasPendingCloudWrites: () => true,
      flushQueue: flushQueueSpy
    };

    let progressBarOpened = false;
    const origShowProgress = window.showAppCloseProgressDialog;
    window.showAppCloseProgressDialog = vi.fn((msg) => {
      progressBarOpened = true;
      return {
        update: vi.fn(),
        close: vi.fn()
      };
    });

    window.electronAPI = {
      closeAppConfirmed: vi.fn()
    };

    await window.handleMainWindowCloseRequest();

    expect(window.showAppCloseProgressDialog).toHaveBeenCalled();
    expect(flushQueueSpy).toHaveBeenCalled();
    expect(window.electronAPI.closeAppConfirmed).toHaveBeenCalled();
  });

  it('opens cloud exit modal in cloud mode and resolves cleanly when cancelled', async () => {
    window.openModal = vi.fn();
    window.closeModal = vi.fn();

    window.FirebaseSyncService = {
      state: { engine: 'firebase', status: 'synced', pendingQueue: new Map() },
      hasPendingCloudWrites: () => false
    };

    const closePromise = window.handleMainWindowCloseRequest();

    expect(window.openModal).toHaveBeenCalledWith('modal-cloud-exit-confirm');

    // Simulate clicking cancel
    window.resolveCloudExitDialog('cancel');

    const result = await closePromise;
    expect(result).toBe(false);

    // Verify subsequent close request can run immediately (not blocked by _isClosePromptActive)
    const secondClosePromise = window.handleMainWindowCloseRequest();
    expect(window.openModal).toHaveBeenCalledTimes(2);
    window.resolveCloudExitDialog('cancel');
    await secondClosePromise;
  });
});
