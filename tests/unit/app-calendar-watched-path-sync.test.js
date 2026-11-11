import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Calendar Observed Folder Path & Script Command Engine', () => {
  let CalendarSyncService;
  let copyWatchedFolderPath;
  let copyLocalCalendarSyncCmd;
  let updateExternalAgentPromptDisplay;

  beforeEach(() => {
    vi.restoreAllMocks();

    // DOM Setup mimicking app.html Settings tabs
    document.body.innerHTML = `
      <!-- Tab 2: Watched Folder & Script -->
      <div id="prefs-cal-pane-folder">
        <span id="prefs-watched-folder-badge" class="badge"></span>
        <div id="prefs-watched-folder-name"></div>
        <p id="prefs-watched-folder-desc"></p>
        <div id="prefs-watched-folder-path-container" style="display:none;">
          <div id="prefs-watched-folder-path-display"></div>
          <button type="button" id="btn-copy-watched-folder-path"></button>
        </div>
        <div id="prefs-watched-folder-empty-notice" style="display:none;"></div>
        <button id="btn-change-watched-folder"><span>Change</span></button>
        <button id="btn-reset-watched-folder" style="display:none;"><span>Reset</span></button>

        <div id="prefs-sync-script-empty-notice" style="display:none;"></div>
        <div id="prefs-sync-script-content-box" style="display:none;">
          <button id="btn-cmd-platform-win"></button>
          <button id="btn-cmd-platform-mac"></button>
          <div id="prefs-local-sync-cmd"></div>
          <button id="btn-copy-local-sync-cmd"></button>
        </div>
      </div>

      <!-- Tab 3: External AI Agent -->
      <div id="prefs-cal-pane-agent">
        <span id="prefs-agent-watched-folder-badge" class="badge"></span>
        <div id="prefs-agent-watched-folder-path-container" style="display:none;">
          <div id="prefs-agent-watched-folder-path-display"></div>
          <button type="button" id="btn-copy-agent-watched-folder-path"></button>
        </div>
        <div id="prefs-agent-watched-folder-empty-notice" style="display:none;"></div>
        <button id="btn-change-agent-watched-folder"><span>Change</span></button>

        <div id="prefs-agent-instructions-empty-notice" style="display:none;"></div>
        <div id="prefs-agent-instructions-content-box" style="display:none;">
          <div id="prefs-agent-watched-folder-notice"></div>
          <textarea id="prefs-external-agent-prompt"></textarea>
          <button id="btn-copy-agent-prompt"></button>
        </div>
      </div>
    `;

    window.settings = {
      calendarSync: {
        enabled: true,
        feeds: [],
        pollIntervalMinutes: 15,
        mode: 'proposals'
      },
      folder: {}
    };

    window.t = (key, params) => {
      const strings = {
        'prefs.watchedFolderNotesDefault': 'Notes Folder (Default)',
        'prefs.watchedFolderCustomLabel': 'Custom Watched Folder',
        'prefs.watchedFolderNoneLabel': 'No local folder connected',
        'prefs.watchedFolderNoneBadge': 'Selection required',
        'prefs.folderPathCopied': 'Observed folder path copied to clipboard!',
        'prefs.noObservedFolderToast': 'No observed folder configured',
        'prefs.localScriptCopied': 'Command copied to clipboard!'
      };
      return strings[key] || key;
    };

    window.toast = vi.fn();

    // Load AppPrompts
    const promptsCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-prompts.js'), 'utf8');
    const promptsFn = new Function('window', 'globalThis', `${promptsCode}; return window.AppPrompts;`);
    window.AppPrompts = promptsFn(window, window);

    // Load CalendarSyncService
    const calendarSyncCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-calendar-sync.js'), 'utf8');
    const calFn = new Function('window', 'globalThis', 'settings', 't', `${calendarSyncCode}; return window.CalendarSyncService;`);
    CalendarSyncService = calFn(window, window, window.settings, window.t);
    window.CalendarSyncService = CalendarSyncService;

    // Define helper copy functions as implemented in js/app-init.js
    copyWatchedFolderPath = async () => {
      const folderPath = CalendarSyncService.getWatchedFolderPath();
      if (!folderPath) {
        window.toast(window.t('prefs.noObservedFolderToast'), true);
        return;
      }
      try {
        await navigator.clipboard.writeText(folderPath);
        window.toast(window.t('prefs.folderPathCopied'));
      } catch (err) {
        window.toast(`Copy failed: ${err.message}`, true);
      }
    };
    window.copyWatchedFolderPath = copyWatchedFolderPath;

    copyLocalCalendarSyncCmd = async () => {
      const cmdEl = document.getElementById('prefs-local-sync-cmd');
      if (!cmdEl) return;
      const cmd = (cmdEl.value || cmdEl.textContent || cmdEl.dataset?.cmd || '').trim();
      if (!cmd) {
        window.toast(window.t('prefs.noObservedFolderToast'), true);
        return;
      }
      try {
        await navigator.clipboard.writeText(cmd);
        window.toast(window.t('prefs.localScriptCopied'));
      } catch (err) {
        window.toast(`Copy failed: ${err.message}`, true);
      }
    };
    window.copyLocalCalendarSyncCmd = copyLocalCalendarSyncCmd;

    updateExternalAgentPromptDisplay = () => {
      const textarea = document.getElementById('prefs-external-agent-prompt');
      if (!textarea) return;
      const wsPath = CalendarSyncService.getWatchedFolderPath();
      const watchedInfo = CalendarSyncService.getWatchedFolderInfo();
      textarea.value = window.AppPrompts.buildExternalAgentEmailProposalPrompt({
        workspacePath: wsPath,
        watchedFolderName: wsPath || watchedInfo?.name || '',
        isDefaultLocal: Boolean(watchedInfo?.isDefault)
      });
    };
    window.updateExternalAgentPromptDisplay = updateExternalAgentPromptDisplay;

    // Mock clipboard API
    if (!navigator.clipboard) {
      navigator.clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    } else {
      vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Copying Observed Folder Path Button', () => {
    it('successfully copies the active observed folder path to clipboard and displays localized toast', async () => {
      CalendarSyncService.setDetectedWorkspacePath('/Users/etienne/Notes');
      expect(CalendarSyncService.getWatchedFolderPath()).toBe('/Users/etienne/Notes');

      await copyWatchedFolderPath();

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('/Users/etienne/Notes');
      expect(window.toast).toHaveBeenCalledWith('Observed folder path copied to clipboard!');
    });

    it('prevents clipboard copy and displays localized warning toast when no folder is observed', async () => {
      window.rootHandle = null;
      CalendarSyncService._customFolderPath = null;
      CalendarSyncService._detectedWorkspacePath = null;
      window.settings.folder = {};

      expect(CalendarSyncService.getWatchedFolderPath()).toBe('');

      await copyWatchedFolderPath();

      expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
      expect(window.toast).toHaveBeenCalledWith('No observed folder configured', true);
    });
  });

  describe('2. Hidden Paths & Safe State When No Path is Observed', () => {
    it('hides both script path and agent disk path when no folder path is observed', () => {
      window.rootHandle = null;
      CalendarSyncService._customFolderPath = null;
      CalendarSyncService._detectedWorkspacePath = null;
      window.settings.folder = {};

      CalendarSyncService.updateExternalStatusUI();

      // Tab 2 assertions: Script content box is hidden, empty notice shown
      const scriptBox = document.getElementById('prefs-sync-script-content-box');
      const scriptNotice = document.getElementById('prefs-sync-script-empty-notice');
      expect(scriptBox.style.display).toBe('none');
      expect(scriptNotice.style.display).toBe('block');

      // Tab 3 assertions: Agent instructions box is hidden, empty notice shown
      const agentBox = document.getElementById('prefs-agent-instructions-content-box');
      const agentNotice = document.getElementById('prefs-agent-instructions-empty-notice');
      expect(agentBox.style.display).toBe('none');
      expect(agentNotice.style.display).toBe('block');

      // Path containers are hidden in both tabs
      expect(document.getElementById('prefs-watched-folder-path-container').style.display).toBe('none');
      expect(document.getElementById('prefs-agent-watched-folder-path-container').style.display).toBe('none');

      // Empty notices are visible in both tabs
      expect(document.getElementById('prefs-watched-folder-empty-notice').style.display).toBe('block');
      expect(document.getElementById('prefs-agent-watched-folder-empty-notice').style.display).toBe('block');

      // getLocalSyncCommand returns empty string to protect user from fake C:\path\to placeholders
      expect(CalendarSyncService.getLocalSyncCommand('', 'win', true)).toBe('');
      expect(CalendarSyncService.getLocalSyncCommand('', 'mac', true)).toBe('');
    });
  });

  describe('3. Real Script & Agent Disk Path Display When Path is Observed', () => {
    it('displays authentic Windows path without fake C:\\path\\to placeholders when observed folder is set', () => {
      CalendarSyncService.setDetectedWorkspacePath('C:\\Users\\Etienne\\SecretaryWorkspace');
      CalendarSyncService.setPlatformOverride('win');

      CalendarSyncService.updateExternalStatusUI();

      // Path containers are visible in both tabs
      expect(document.getElementById('prefs-watched-folder-path-container').style.display).toBe('flex');
      expect(document.getElementById('prefs-agent-watched-folder-path-container').style.display).toBe('flex');

      expect(document.getElementById('prefs-watched-folder-path-display').textContent).toBe('📁 C:\\Users\\Etienne\\SecretaryWorkspace');
      expect(document.getElementById('prefs-agent-watched-folder-path-display').textContent).toBe('📁 C:\\Users\\Etienne\\SecretaryWorkspace');

      // Tab 2 displays real PowerShell execution command targeting sync_local_calendar.ps1 in observed folder
      const cmdEl = document.getElementById('prefs-local-sync-cmd');
      expect(cmdEl.textContent).toBe('powershell.exe -ExecutionPolicy Bypass -File "C:\\Users\\Etienne\\SecretaryWorkspace\\sync_local_calendar.ps1"');
      expect(cmdEl.textContent).not.toContain('C:\\path\\to');

      // Tab 3 textarea contains exact disk path targeting planner-proposals.json
      const textarea = document.getElementById('prefs-external-agent-prompt');
      expect(textarea.value).toContain('Exact Path on Disk**: `C:\\Users\\Etienne\\SecretaryWorkspace\\planner-proposals.json`');
      expect(textarea.value).not.toContain('Secretary/planner-proposals.json');
    });

    it('displays authentic macOS Bash path when observed folder is set', () => {
      CalendarSyncService.setDetectedWorkspacePath('/Users/etienne/Projects/Secretary');
      CalendarSyncService.setPlatformOverride('mac');

      CalendarSyncService.updateExternalStatusUI();

      const cmdEl = document.getElementById('prefs-local-sync-cmd');
      expect(cmdEl.textContent).toBe('bash "/Users/etienne/Projects/Secretary/sync_local_calendar.sh"');
      expect(cmdEl.textContent).not.toContain('/path/to/Secretary');

      const textarea = document.getElementById('prefs-external-agent-prompt');
      expect(textarea.value).toContain('Exact Path on Disk**: `/Users/etienne/Projects/Secretary/planner-proposals.json`');
    });

    it('uses authentic script location on disk when Electron detected script path is present', () => {
      CalendarSyncService.setDetectedWorkspacePath('/Users/etienne/MyNotes');
      CalendarSyncService.setDetectedScriptPath('/Applications/Secretary.app/Contents/Resources/development/sync_local_calendar.sh');
      CalendarSyncService.setPlatformOverride('mac');

      const cmd = CalendarSyncService.getLocalSyncCommand('', 'mac', true);
      expect(cmd).toBe('bash "/Applications/Secretary.app/Contents/Resources/development/sync_local_calendar.sh" "/Users/etienne/MyNotes"');
    });
  });

  describe('4. Dual-Tab Synchronization & Non-Editable Terminal Command Copying', () => {
    it('synchronizes observed path across both Tab 2 and Tab 3 simultaneously when path changes', async () => {
      await CalendarSyncService.setWatchedFolderPath('/Volumes/Encrypted/PersonalNotes');

      expect(document.getElementById('prefs-watched-folder-path-display').textContent).toBe('📁 /Volumes/Encrypted/PersonalNotes');
      expect(document.getElementById('prefs-agent-watched-folder-path-display').textContent).toBe('📁 /Volumes/Encrypted/PersonalNotes');

      expect(document.getElementById('prefs-watched-folder-empty-notice').style.display).toBe('none');
      expect(document.getElementById('prefs-agent-watched-folder-empty-notice').style.display).toBe('none');
    });

    it('copies the command cleanly from non-editable text content and triggers copy toast', async () => {
      CalendarSyncService.setDetectedWorkspacePath('/Users/etienne/Notes');
      CalendarSyncService.setPlatformOverride('mac');
      CalendarSyncService.updateExternalStatusUI();

      await copyLocalCalendarSyncCmd();

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('bash "/Users/etienne/Notes/sync_local_calendar.sh"');
      expect(window.toast).toHaveBeenCalledWith('Command copied to clipboard!');
    });
  });
});
