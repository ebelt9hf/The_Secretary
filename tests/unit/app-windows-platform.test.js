import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  getTitleBarOverlayOptions,
  getWindowFrameOptions,
  formatSystemAccentColor,
  applyWindowProgressBar,
  configureWindowsJumpList,
  parseCommandLineAction
} from '../../electron/window-utils.js';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Windows 11 Platform Integration & DWM Ergonomics (electron/window-utils.js & AppBridge)', () => {
  describe('Window Frame Options & Custom Controls', () => {
    it('returns theme-aware WCO titleBarOverlay options', () => {
      const darkOverlay = getTitleBarOverlayOptions(true);
      expect(darkOverlay.color).toBe('#090e18');
      expect(darkOverlay.symbolColor).toBe('#ffffff');
      expect(darkOverlay.height).toBe(40);

      const lightOverlay = getTitleBarOverlayOptions(false);
      expect(lightOverlay.color).toBe('#1e1b4b');
      expect(lightOverlay.symbolColor).toBe('#ffffff');
      expect(lightOverlay.height).toBe(40);
    });

    it('enables Mica material and custom borderless window on Windows (win32) for custom drawn window controls', () => {
      const winOpts = getWindowFrameOptions('win32', true);
      expect(winOpts.titleBarStyle).toBe('hidden');
      expect(winOpts.autoHideMenuBar).toBe(true);
      expect(winOpts.backgroundMaterial).toBe('mica');
      expect(winOpts.titleBarOverlay).toBeUndefined();
    });

    it('enables hiddenInset and traffic lights on macOS (darwin)', () => {
      const macOpts = getWindowFrameOptions('darwin', false);
      expect(macOpts.titleBarStyle).toBe('hiddenInset');
      expect(macOpts.trafficLightPosition).toEqual({ x: 16, y: 14 });
      expect(macOpts.titleBarOverlay).toBeUndefined();
      expect(macOpts.backgroundMaterial).toBeUndefined();
    });

    it('provides standard hidden titleBarStyle on Linux without WCO', () => {
      const linuxOpts = getWindowFrameOptions('linux', false);
      expect(linuxOpts.titleBarStyle).toBe('hidden');
      expect(linuxOpts.autoHideMenuBar).toBe(true);
      expect(linuxOpts.titleBarOverlay).toBeUndefined();
    });
  });

  describe('System Accent Color Formatting', () => {
    it('formats raw Windows system accent hex string to #RRGGBB', () => {
      expect(formatSystemAccentColor('0078d4')).toBe('#0078d4');
      expect(formatSystemAccentColor('#0078d4')).toBe('#0078d4');
      expect(formatSystemAccentColor('0078d4ff')).toBe('#0078d4');
      expect(formatSystemAccentColor('  4f46e5  ')).toBe('#4f46e5');
    });

    it('returns null for empty or invalid accent color strings', () => {
      expect(formatSystemAccentColor('')).toBeNull();
      expect(formatSystemAccentColor(null)).toBeNull();
      expect(formatSystemAccentColor(undefined)).toBeNull();
      expect(formatSystemAccentColor('123')).toBeNull();
    });
  });

  describe('Taskbar Progress Reporting', () => {
    it('applies numeric progress fraction and options to window', () => {
      const mockWin = {
        isDestroyed: () => false,
        setProgressBar: vi.fn()
      };

      const ok = applyWindowProgressBar(mockWin, 0.45, { mode: 'normal' });
      expect(ok).toBe(true);
      expect(mockWin.setProgressBar).toHaveBeenCalledWith(0.45, { mode: 'normal' });
    });

    it('clears progress bar when progress is -1 or invalid', () => {
      const mockWin = {
        isDestroyed: () => false,
        setProgressBar: vi.fn()
      };

      applyWindowProgressBar(mockWin, -1);
      expect(mockWin.setProgressBar).toHaveBeenCalledWith(-1);

      applyWindowProgressBar(mockWin, NaN);
      expect(mockWin.setProgressBar).toHaveBeenCalledWith(-1);
    });

    it('handles destroyed or invalid window instances safely', () => {
      const mockDestroyedWin = {
        isDestroyed: () => true,
        setProgressBar: vi.fn()
      };
      expect(applyWindowProgressBar(mockDestroyedWin, 0.5)).toBe(false);
      expect(mockDestroyedWin.setProgressBar).not.toHaveBeenCalled();

      expect(applyWindowProgressBar(null, 0.5)).toBe(false);
    });
  });

  describe('Windows Jump Lists & Action Parsing', () => {
    it('configures taskbar jump list with New Note and Planner actions on Windows', () => {
      const mockApp = {
        setJumpList: vi.fn()
      };

      const result = configureWindowsJumpList(mockApp, 'win32', 'C:\\Secretary\\Secretary.exe');
      expect(result).toBe(true);
      expect(mockApp.setJumpList).toHaveBeenCalledTimes(1);

      const categories = mockApp.setJumpList.mock.calls[0][0];
      const tasksCategory = categories.find(c => c.type === 'tasks');
      expect(tasksCategory).toBeDefined();
      expect(tasksCategory.items).toHaveLength(2);
      expect(tasksCategory.items[0].title).toBe('New Note');
      expect(tasksCategory.items[0].args).toBe('--action=new-note');
      expect(tasksCategory.items[1].title).toBe('Planner');
      expect(tasksCategory.items[1].args).toBe('--action=planner');
    });

    it('does not set jump list on non-Windows platforms', () => {
      const mockApp = { setJumpList: vi.fn() };
      expect(configureWindowsJumpList(mockApp, 'darwin')).toBe(false);
      expect(configureWindowsJumpList(mockApp, 'linux')).toBe(false);
      expect(mockApp.setJumpList).not.toHaveBeenCalled();
    });

    it('parses --action argument from process arguments', () => {
      expect(parseCommandLineAction(['node', 'main.js', '--action=new-note'])).toBe('new-note');
      expect(parseCommandLineAction(['secretary.exe', '--action=planner'])).toBe('planner');
      expect(parseCommandLineAction(['secretary.exe', '--other-flag'])).toBeNull();
      expect(parseCommandLineAction(null)).toBeNull();
    });
  });

  describe('Renderer AppBridge Windows Integration & WCO Support', () => {
    beforeEach(() => {
      document.documentElement.className = '';
      document.body.className = '';
      document.documentElement.style.cssText = '';

      loadScriptsIntoGlobal([
        'js/app-bridge.js'
      ]);
    });

    it('exposes Windows integration methods on AppBridge.windowControls and AppBridge shorthand', () => {
      expect(window.AppBridge).toBeDefined();
      expect(window.AppBridge.windowControls.getSystemAccentColor).toBeDefined();
      expect(window.AppBridge.windowControls.onSystemAccentColorChanged).toBeDefined();
      expect(window.AppBridge.windowControls.setProgressBar).toBeDefined();
      expect(window.AppBridge.windowControls.onAppAction).toBeDefined();

      expect(window.AppBridge.getSystemAccentColor).toBeDefined();
      expect(window.AppBridge.onSystemAccentColorChanged).toBeDefined();
      expect(window.AppBridge.setProgressBar).toBeDefined();
      expect(window.AppBridge.onAppAction).toBeDefined();
    });

    it('invokes electronAPI methods when available for accent color and progress bar', async () => {
      const setProgressSpy = vi.fn();
      const getAccentSpy = vi.fn().mockResolvedValue('#0078d4');
      const onAccentSpy = vi.fn((cb) => { cb('#2563eb'); return () => {}; });

      window.electronAPI = {
        isElectron: true,
        platform: 'win32',
        setProgressBar: setProgressSpy,
        getSystemAccentColor: getAccentSpy,
        onSystemAccentColorChanged: onAccentSpy
      };

      window.AppBridge.setProgressBar(0.75, { mode: 'normal' });
      expect(setProgressSpy).toHaveBeenCalledWith(0.75, { mode: 'normal' });

      const color = await window.AppBridge.getSystemAccentColor();
      expect(color).toBe('#0078d4');
      expect(getAccentSpy).toHaveBeenCalled();
    });

    it('applies --win-system-accent dynamically in setupSystemAccentSync', async () => {
      window.electronAPI = {
        isElectron: true,
        platform: 'win32',
        getSystemAccentColor: vi.fn().mockResolvedValue('#107c41'),
        onSystemAccentColorChanged: vi.fn((cb) => {
          setTimeout(() => cb('#0078d4'), 10);
          return () => {};
        })
      };

      window.AppBridge.platform = 'win32';
      window.AppBridge.isElectron = true;
      window.AppBridge.windowManager.setupSystemAccentSync();

      await new Promise(r => setTimeout(r, 20));
      expect(document.documentElement.style.getPropertyValue('--win-system-accent')).toBe('#0078d4');
    });

    it('wires custom window controls (#win-controls) for minimize, maximize, and close', () => {
      document.body.innerHTML = `
        <div id="win-controls" class="win-controls">
          <button class="win-ctrl-btn" id="win-min" title="Minimize window">Min</button>
          <button class="win-ctrl-btn" id="win-max" title="Maximize window">Max</button>
          <button class="win-ctrl-btn win-ctrl-close" id="win-close" title="Close window">Close</button>
        </div>
      `;

      const minSpy = vi.fn();
      const maxSpy = vi.fn();
      const closeSpy = vi.fn();

      window.electronAPI = {
        isElectron: true,
        platform: 'win32',
        minimizeWindow: minSpy,
        toggleMaximizeWindow: maxSpy,
        closeWindow: closeSpy,
        isWindowMaximized: () => false,
        onWindowMaximizeChange: vi.fn(() => () => {})
      };

      window.AppBridge.platform = 'win32';
      window.AppBridge.isElectron = true;
      window.AppBridge.windowManager.setupWindowControls();

      document.getElementById('win-min').click();
      expect(minSpy).toHaveBeenCalledTimes(1);

      document.getElementById('win-max').click();
      expect(maxSpy).toHaveBeenCalledTimes(1);

      document.getElementById('win-close').click();
      expect(closeSpy).toHaveBeenCalledTimes(1);
    });

    it('triggers switchTab("prefs") on Ctrl+, or Cmd+, shortcut', () => {
      globalThis.t = (key) => key;
      globalThis.normalizeLanguageCode = (code) => code || 'en';
      globalThis.escH = (s) => String(s || '');
      globalThis.escA = (s) => String(s || '');

      loadScriptsIntoGlobal([
        'js/translations.js',
        'js/app-i18n.js',
        'js/app-init.js'
      ]);
      const switchTabSpy = vi.fn();
      window.switchTab = switchTabSpy;

      const event = new KeyboardEvent('keydown', {
        key: ',',
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      });
      document.dispatchEvent(event);

      expect(switchTabSpy).toHaveBeenCalledWith('prefs');
      expect(event.defaultPrevented).toBe(true);
    });
  });

  describe('Multi-Window Note Opening & Windows Path Normalization', () => {
    beforeEach(() => {
      globalThis.metadataBuffer = [
        { id: 'note-1', path: 'notes/2026-10-05-standup.html', title: 'Standup', decisionsReady: true },
        { id: 'note-2', path: 'notes/2026-10-05-planning.html', title: 'Planning', decisionsReady: true }
      ];
      globalThis.manifest = [...globalThis.metadataBuffer];

      loadScriptsIntoGlobal([
        'js/app-notes.js',
        'js/app-bridge.js'
      ]);
      if (typeof syncMetadataIndexes === 'function') {
        syncMetadataIndexes();
      }
    });

    it('resolves note metadata with Windows backslash paths in getMetaByPath and getNoteByPath', () => {
      expect(globalThis.getMetaByPath('notes\\2026-10-05-standup.html')).not.toBeNull();
      expect(globalThis.getMetaByPath('notes\\2026-10-05-standup.html').id).toBe('note-1');

      expect(globalThis.getNoteByPath('notes\\2026-10-05-planning.html')).not.toBeNull();
      expect(globalThis.getNoteByPath('notes\\2026-10-05-planning.html').id).toBe('note-2');

      expect(globalThis.getNoteById('notes\\2026-10-05-standup.html')).not.toBeNull();
      expect(globalThis.getNoteById('notes\\2026-10-05-standup.html').id).toBe('note-1');
    });

    it('allows opening multiple distinct notes in separate windows via AppBridge.noteWindow.open', () => {
      const openSpy = vi.fn();
      window.electronAPI = {
        isElectron: true,
        platform: 'win32',
        openNoteWindow: openSpy
      };
      window.AppBridge.platform = 'win32';
      window.AppBridge.isElectron = true;

      // Open Note 1
      window.AppBridge.noteWindow.open('note-1', 'notes/2026-10-05-standup.html');
      expect(openSpy).toHaveBeenCalledWith('note-1', 'notes/2026-10-05-standup.html');

      // Open Note 2 simultaneously in another window
      window.AppBridge.noteWindow.open('note-2', 'notes/2026-10-05-planning.html');
      expect(openSpy).toHaveBeenCalledWith('note-2', 'notes/2026-10-05-planning.html');

      expect(openSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('CSS Layer Architecture Verification (app-base.css)', () => {
    it('verifies Fluent elevation tokens, Segoe UI Variable, ClearType, and forced-colors in app-base.css', () => {
      const cssPath = path.resolve(process.cwd(), 'css/app-base.css');
      const css = fs.readFileSync(cssPath, 'utf8');

      // Token definitions
      expect(css).toContain('--win-system-accent: #0078d4;');
      expect(css).toContain('--win-elevation-1:');
      expect(css).toContain('--win-elevation-4:');
      expect(css).toContain('--win-surface-card:');

      // Strict tabular-nums for numeric metrics
      expect(css).toContain('font-variant-numeric: tabular-nums;');
      expect(css).toContain('font-feature-settings: "tnum" 1;');

      // Segoe UI Variable typography stack & ClearType
      expect(css).toContain('"Segoe UI Variable Text"');
      expect(css).toContain('"Segoe UI Variable Display"');
      expect(css).toContain('-webkit-font-smoothing: subpixel-antialiased;');

      // Forced colors / High Contrast theme
      expect(css).toContain('@media (forced-colors: active)');
      expect(css).toContain('ButtonBorder');
      expect(css).toContain('Highlight');
    });
  });
});
