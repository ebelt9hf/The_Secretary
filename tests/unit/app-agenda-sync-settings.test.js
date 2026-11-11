import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * 4-Point Unit Test Audit:
 * 1. Protected Behavior:
 *    - Validates watched folder resolution across storage engines (local filesystem notes folder vs Firebase cloud).
 *    - Validates script placement (.ps1 / .sh) in the watched folder and terminal/PowerShell command generation.
 *    - Validates external AI agent prompt formulation specifically targeting the watched folder and Outlook integration.
 *    - Validates multi-way Agenda synchronization UI tab switching between feeds, watched folder, and external agent.
 * 2. Regression Target:
 *    - Prevents regression where Firebase mode falsely assumes local notes folder exists.
 *    - Prevents regression where sync command fails to target the script inside the watched folder.
 *    - Prevents regression where external AI agent prompt omits Outlook or writes to an outdated workspace path.
 * 3. Coverage Overlap:
 *    - Complements app-calendar-sync.test.js (which tests iCal parsing) and app-planner-proposals.test.js (which tests JSON normalization).
 * 4. Production Code Footprint:
 *    - Exercises public interfaces of CalendarSyncService, AppPrompts, switchCalendarSyncTab, and updateExternalAgentPromptDisplay without test-only flags.
 */

describe('Streamlined Agenda Calendar Synchronization & Watched Folder Engine', () => {
  let CalendarSyncService;
  let AppPrompts;

  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';

    window.settings = {
      username: 'Alice',
      storageEngine: 'filesystem',
      calendarSync: {
        enabled: true,
        feeds: [],
        pollIntervalMinutes: 15
      }
    };
    window.t = (key, params) => {
      if (params && params.folder) return `${key}:${params.folder}`;
      if (params && params.count !== undefined) return `${key}:${params.count}`;
      return key;
    };
    window.normalizeLanguageCode = (c) => c || 'en';
    window.applyLocalizedUI = () => {};
    window.deepMerge = (a, b) => Object.assign({}, a, b);
    window.rootHandle = {
      name: 'AliceNotesWorkspace',
      getFileHandle: vi.fn()
    };
    window.StorageAPI = {
      getStorageEngine: vi.fn().mockReturnValue('filesystem')
    };

    const calendarSyncCode = fs.readFileSync(
      path.resolve(__dirname, '../../js/app-calendar-sync.js'),
      'utf8'
    );
    const promptsCode = fs.readFileSync(
      path.resolve(__dirname, '../../js/app-prompts.js'),
      'utf8'
    );

    const fnSync = new Function('window', 'globalThis', 'settings', 't', `${calendarSyncCode}; return window.CalendarSyncService;`);
    CalendarSyncService = fnSync(window, window, window.settings, window.t);

    const fnPrompts = new Function('window', 'globalThis', 'settings', 't', `${promptsCode}; return window.AppPrompts;`);
    AppPrompts = fnPrompts(window, window, window.settings, window.t);
  });

  afterEach(() => {
    delete window.rootHandle;
    delete window.StorageAPI;
    delete window.settings;
    delete window.CalendarSyncService;
    delete window.AppPrompts;
    document.body.innerHTML = '';
  });

  describe('Pillar 1: Watched Folder Detection Across Storage Modes', () => {
    it('defaults watched folder to local notes workspace in filesystem mode', () => {
      window.StorageAPI.getStorageEngine.mockReturnValue('filesystem');
      window.rootHandle = { name: 'MyLocalProjectNotes' };

      const info = CalendarSyncService.getWatchedFolderInfo();

      expect(info.type).toBe('notes');
      expect(info.name).toBe('MyLocalProjectNotes');
      expect(info.isDefault).toBe(true);
      expect(info.mode).toBe('local');
    });

    it('requires explicit folder selection in Firebase mode when no folder is connected', () => {
      window.StorageAPI.getStorageEngine.mockReturnValue('firebase');
      CalendarSyncService._externalFolderHandle = null;

      const info = CalendarSyncService.getWatchedFolderInfo();

      expect(info.type).toBe('none');
      expect(info.name).toBe('');
      expect(info.isDefault).toBe(false);
      expect(info.mode).toBe('firebase');
    });

    it('returns custom watched folder when external folder handle is linked in Firebase mode', () => {
      window.StorageAPI.getStorageEngine.mockReturnValue('firebase');
      CalendarSyncService._externalFolderHandle = { name: 'CorporateSyncFolder' };

      const info = CalendarSyncService.getWatchedFolderInfo();

      expect(info.type).toBe('custom');
      expect(info.name).toBe('CorporateSyncFolder');
      expect(info.isDefault).toBe(false);
      expect(info.mode).toBe('firebase');
    });

    it('allows reverting custom watched folder back to default notes workspace in local mode', () => {
      window.StorageAPI.getStorageEngine.mockReturnValue('filesystem');
      window.rootHandle = { name: 'DefaultNotes' };
      CalendarSyncService._externalFolderHandle = { name: 'CustomTemp' };

      expect(CalendarSyncService.getWatchedFolderInfo().name).toBe('CustomTemp');

      CalendarSyncService.resetWatchedFolderToDefault();

      const reverted = CalendarSyncService.getWatchedFolderInfo();
      expect(reverted.type).toBe('notes');
      expect(reverted.name).toBe('DefaultNotes');
      expect(reverted.isDefault).toBe(true);
    });
  });

  describe('Pillar 2: Sync Script Placement & Command Formatting', () => {
    it('generates PowerShell command with absolute path targeting sync_local_calendar.ps1 in the watched folder on Windows and hides command when no path is observed', () => {
      CalendarSyncService._platformOverride = 'win';
      window.rootHandle = { name: 'NotesFolder' };

      // Explicit workspace path
      const cmdWithWs = CalendarSyncService.getLocalSyncCommand('C:\\Users\\alice\\Notes', 'win', true);
      expect(cmdWithWs).toBe('powershell.exe -ExecutionPolicy Bypass -File "C:\\Users\\alice\\Notes\\sync_local_calendar.ps1"');

      // When no absolute folder path is observed, returns empty string to protect user from dummy C:\path\to placeholders
      const defaultCmd = CalendarSyncService.getLocalSyncCommand('', 'win', true);
      expect(defaultCmd).toBe('');
    });

    it('generates bash command with absolute path targeting sync_local_calendar.sh in the watched folder on macOS / Linux and hides command when no path is observed', () => {
      CalendarSyncService._platformOverride = 'mac';
      window.rootHandle = { name: 'NotesFolder' };

      // Explicit workspace path
      const cmdWithWs = CalendarSyncService.getLocalSyncCommand('/Users/alice/Notes', 'mac', true);
      expect(cmdWithWs).toBe('bash "/Users/alice/Notes/sync_local_calendar.sh"');

      // When no absolute folder path is observed, returns empty string to protect user from dummy /path/to placeholders
      const defaultCmd = CalendarSyncService.getLocalSyncCommand('', 'mac', true);
      expect(defaultCmd).toBe('');
    });

    it('updates absolute path and command dynamically when custom watched folder path is entered', async () => {
      CalendarSyncService._platformOverride = 'win';
      document.body.innerHTML = `
        <input id="prefs-watched-folder-path-input" value="" />
        <input id="prefs-local-sync-cmd" value="" />
      `;

      await CalendarSyncService.setWatchedFolderPath('D:\\Shared\\CorporateNotes');
      expect(CalendarSyncService.getWatchedFolderPath()).toBe('D:\\Shared\\CorporateNotes');

      const cmd = CalendarSyncService.getLocalSyncCommand('', 'win', true);
      expect(cmd).toBe('powershell.exe -ExecutionPolicy Bypass -File "D:\\Shared\\CorporateNotes\\sync_local_calendar.ps1"');

      // Test live input typing
      CalendarSyncService.handleCustomFolderPathInput('E:\\Projects\\Notes');
      expect(document.getElementById('prefs-local-sync-cmd').value).toBe('powershell.exe -ExecutionPolicy Bypass -File "E:\\Projects\\Notes\\sync_local_calendar.ps1"');
    });

    it('places sync_local_calendar.ps1 and sync_local_calendar.sh directly into watched folder handle', async () => {
      const mockWritablePs1 = { write: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) };
      const mockFileHandlePs1 = { createWritable: vi.fn().mockResolvedValue(mockWritablePs1) };

      const mockWritableSh = { write: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) };
      const mockFileHandleSh = { createWritable: vi.fn().mockResolvedValue(mockWritableSh) };

      const mockFolderHandle = {
        name: 'TargetWatchedFolder',
        getFileHandle: vi.fn().mockImplementation((fileName) => {
          if (fileName === 'sync_local_calendar.ps1') return Promise.resolve(mockFileHandlePs1);
          if (fileName === 'sync_local_calendar.sh') return Promise.resolve(mockFileHandleSh);
          return Promise.reject(new Error('File not found'));
        })
      };

      CalendarSyncService._externalFolderHandle = mockFolderHandle;
      window.toast = vi.fn();

      const success = await CalendarSyncService.placeSyncScriptInWatchedFolder('win');

      expect(success).toBe(true);
      expect(mockFolderHandle.getFileHandle).toHaveBeenCalledWith('sync_local_calendar.ps1', { create: true });
      expect(mockFolderHandle.getFileHandle).toHaveBeenCalledWith('sync_local_calendar.sh', { create: true });
      expect(mockWritablePs1.write).toHaveBeenCalledWith(expect.stringContaining('Secretary Local Calendar Sync Helper for Windows'));
      expect(mockWritableSh.write).toHaveBeenCalledWith(expect.stringContaining('Secretary Local Calendar Sync Helper'));
      expect(window.toast).toHaveBeenCalled();
    });
  });

  describe('Pillar 3: External AI Agent Guidelines Targeting Watched Folder & Outlook', () => {
    it('instructs external AI agent to extract Outlook meetings and write directly to watched folder', () => {
      const prompt = AppPrompts.buildExternalAgentEmailProposalPrompt({
        userName: 'Etienne',
        watchedFolderName: 'SecretariatProject',
        timezone: 'Europe/Paris'
      });

      expect(prompt).toContain('Microsoft Outlook (Desktop or Web)');
      expect(prompt).toContain('on behalf of user "Etienne"');
      expect(prompt).toContain('- **Target Watched Folder**: `SecretariatProject`');
      expect(prompt).toContain('- **Target File**: `planner-proposals.json`');
      expect(prompt).toContain('`Europe/Paris`');
      expect(prompt).toContain('watched folder "SecretariatProject"');
      expect(prompt).toContain('Secretary continuously watches this folder for `planner-proposals.json`');
    });

    it('falls back to workspace root when no custom watched folder name is provided', () => {
      const prompt = AppPrompts.buildExternalAgentEmailProposalPrompt({
        userName: '',
        watchedFolderName: ''
      });

      expect(prompt).toContain('- **Target Watched Folder**: `Secretary Workspace / Notes Folder`');
      expect(prompt).toContain('root Secretary workspace folder');
    });
  });

  describe('Pillar 4: Streamlined Agenda Tab Multi-Method Switching & UI Parity', () => {
    it('switches between feeds, folder, and agent tabs while updating aria-selected and display', () => {
      const initCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-init.js'), 'utf8');

      // Create tab buttons and panes
      document.body.innerHTML = `
        <button id="prefs-sync-tab-feeds" class="setup-wizard-tab-btn active" role="tab" aria-selected="true"></button>
        <button id="prefs-sync-tab-folder" class="setup-wizard-tab-btn" role="tab" aria-selected="false"></button>
        <button id="prefs-sync-tab-agent" class="setup-wizard-tab-btn" role="tab" aria-selected="false"></button>
        <div id="prefs-cal-pane-feeds" style="display:block;"></div>
        <div id="prefs-cal-pane-folder" style="display:none;"></div>
        <div id="prefs-cal-pane-agent" style="display:none;"></div>
        <textarea id="prefs-external-agent-prompt"></textarea>
      `;

      window.CalendarSyncService = CalendarSyncService;
      window.AppPrompts = AppPrompts;
      const fnInit = new Function('window', 'globalThis', `${initCode}; return window;`);
      const initScope = fnInit(window, window);

      // Switch to folder tab
      initScope.switchCalendarSyncTab('folder');

      expect(document.getElementById('prefs-sync-tab-folder').classList.contains('active')).toBe(true);
      expect(document.getElementById('prefs-sync-tab-folder').getAttribute('aria-selected')).toBe('true');
      expect(document.getElementById('prefs-sync-tab-feeds').classList.contains('active')).toBe(false);
      expect(document.getElementById('prefs-cal-pane-folder').style.display).toBe('block');
      expect(document.getElementById('prefs-cal-pane-feeds').style.display).toBe('none');

      // Switch to agent tab
      initScope.switchCalendarSyncTab('agent');

      expect(document.getElementById('prefs-sync-tab-agent').classList.contains('active')).toBe(true);
      expect(document.getElementById('prefs-cal-pane-agent').style.display).toBe('block');
      expect(document.getElementById('prefs-cal-pane-folder').style.display).toBe('none');

      const textarea = document.getElementById('prefs-external-agent-prompt');
      expect(textarea.value).toContain('Microsoft Outlook');
      expect(textarea.value).toContain('planner-proposals.json');
    });

    it('updates watched folder UI labels when status changes', () => {
      document.body.innerHTML = `
        <div id="prefs-watched-folder-name"></div>
        <div id="prefs-watched-folder-badge"></div>
        <div id="prefs-watched-folder-desc"></div>
        <button id="btn-reset-watched-folder" style="display:none;"></button>
        <button id="btn-change-watched-folder"><span>Change</span></button>
        <input id="prefs-watched-folder-path-input" value="" />
        <input id="prefs-local-sync-cmd" value="" />
        <div id="prefs-agent-watched-folder-notice"></div>
        <button id="btn-cmd-platform-win"></button>
        <button id="btn-cmd-platform-mac"></button>
      `;

      window.StorageAPI.getStorageEngine.mockReturnValue('filesystem');
      window.rootHandle = { name: 'MainVault' };
      CalendarSyncService._externalFolderHandle = null;

      CalendarSyncService.updateExternalStatusUI();

      expect(document.getElementById('prefs-watched-folder-name').textContent).toBe('📁 MainVault');
      expect(document.getElementById('btn-reset-watched-folder').style.display).toBe('none');

      // Now set custom folder
      CalendarSyncService._externalFolderHandle = { name: 'CustomWatch' };
      CalendarSyncService.updateExternalStatusUI();

      expect(document.getElementById('prefs-watched-folder-name').textContent).toBe('📁 CustomWatch');
      expect(document.getElementById('btn-reset-watched-folder').style.display).toBe('inline-flex');
    });
  });
});
