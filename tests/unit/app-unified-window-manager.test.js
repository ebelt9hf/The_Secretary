import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';
import fs from 'fs';
import path from 'path';

describe('Unified Window Manager and Topbar Across All Windows', () => {
  beforeAll(() => {
    globalThis.t = (key) => {
      const dict = {
        'window.minimize': 'Minimize window',
        'window.maximize': 'Maximize window',
        'window.restore': 'Restore window',
        'window.close': 'Close window'
      };
      return dict[key] || key;
    };

    globalThis.normalizeLanguageCode = (code) => code || 'en';
    globalThis.escH = (s) => String(s || '');
    globalThis.escA = (s) => String(s || '');

    loadScriptsIntoGlobal([
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-bridge.js',
      'js/app-init.js'
    ]);
  });

  beforeEach(() => {
    document.documentElement.className = '';
    document.body.className = '';
    document.body.innerHTML = `
      <div id="win-controls" class="win-controls">
        <button class="win-ctrl-btn" id="win-min" title="Minimize window" data-i18n-title="window.minimize">Min</button>
        <button class="win-ctrl-btn" id="win-max" title="Maximize window" data-i18n-title="window.maximize">Max</button>
        <button class="win-ctrl-btn win-ctrl-close" id="win-close" title="Close window" data-i18n-title="window.close">Close</button>
      </div>
      <div id="screen-connect"></div>
      <div id="screen-main">
        <div class="topbar-row topbar-main-row" id="topbar-main-row">
          <span class="topbar-title">Secretary</span>
          <button id="btn-topbar-test">Action</button>
        </div>
      </div>
      <div id="note-edit-overlay" style="display:none">
        <div class="overlay-header-container">
          <div class="overlay-header" id="overlay-header"></div>
        </div>
      </div>
    `;
  });

  it('exposes AppBridge.windowManager and window.AppWindowManager', () => {
    expect(window.AppBridge).toBeDefined();
    expect(window.AppBridge.windowManager).toBeDefined();
    expect(window.AppWindowManager).toBe(window.AppBridge.windowManager);
  });

  it('applies correct contrast classes based on active header (dark header vs light surface)', () => {
    const wm = window.AppBridge.windowManager;
    const winControls = document.getElementById('win-controls');
    const screenMain = document.getElementById('screen-main');

    // Initially #screen-connect is active, #screen-main is not
    wm.updateContrast();
    expect(wm.hasDarkHeader()).toBe(false);
    expect(winControls.classList.contains('on-light-surface')).toBe(true);
    expect(winControls.classList.contains('on-dark-header')).toBe(false);

    // When main workspace becomes active (#screen-main.active)
    screenMain.classList.add('active');
    wm.updateContrast();
    expect(wm.hasDarkHeader()).toBe(true);
    expect(winControls.classList.contains('on-dark-header')).toBe(true);
    expect(winControls.classList.contains('on-light-surface')).toBe(false);

    // In focused note mode (standalone note window)
    screenMain.classList.remove('active');
    document.body.classList.add('focused-note-mode');
    wm.updateContrast();
    expect(wm.hasDarkHeader()).toBe(true);
    expect(winControls.classList.contains('on-dark-header')).toBe(true);

    // In secretary standalone companion window
    document.body.classList.remove('focused-note-mode');
    document.body.classList.add('secretary-window-standalone');
    wm.updateContrast();
    expect(wm.hasDarkHeader()).toBe(true);
    expect(winControls.classList.contains('on-dark-header')).toBe(true);
  });

  it('wires win-controls minimize, toggleMaximize, and close properly on Windows/Linux', () => {
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

    window.handleMainWindowCloseRequest = vi.fn(async () => {
      closeSpy();
      return true;
    });

    window.AppBridge.windowControls._lastToggle = 0;
    window.AppBridge.windowManager.isInitialized = false;
    window.AppBridge.windowManager.init();

    const minBtn = document.getElementById('win-min');
    const maxBtn = document.getElementById('win-max');
    const closeBtn = document.getElementById('win-close');

    minBtn.click();
    expect(minSpy).toHaveBeenCalledTimes(1);

    maxBtn.click();
    expect(maxSpy).toHaveBeenCalledTimes(1);

    closeBtn.click();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('triggers toggleMaximize on topbar double-click unless clicking interactive child', () => {
    const maxSpy = vi.fn();
    window.electronAPI = {
      isElectron: true,
      platform: 'darwin',
      toggleMaximizeWindow: maxSpy
    };
    window.AppBridge.isElectron = true;
    window.AppBridge.windowControls._lastToggle = 0;

    const topbar = document.getElementById('topbar-main-row');
    const button = document.getElementById('btn-topbar-test');

    // Double clicking on button should not toggle maximize
    button.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(maxSpy).not.toHaveBeenCalled();

    // Double clicking on the titlebar background triggers maximize
    topbar.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(maxSpy).toHaveBeenCalledTimes(1);
  });

  it('verifies stylesheet contrast rules in app-misc.css for all three windows', () => {
    const cssPath = path.resolve(__dirname, '../../css/app-misc.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    // on-dark-header and standalone classes enforce #ffffff
    expect(css).toContain('.win-controls.on-dark-header');
    expect(css).toContain('body.is-electron.focused-note-mode .win-controls');
    expect(css).toContain('body.is-electron.note-window-standalone .win-controls');
    expect(css).toContain('body.is-electron.secretary-window-standalone .win-controls');
    expect(css).toContain('body.is-electron.chat-window-mode .win-controls');
    expect(css).toContain('color: #ffffff !important;');

    // on-light-surface maintains adaptive var(--text)
    expect(css).toContain('.win-controls.on-light-surface');
    expect(css).toContain('color: var(--text) !important;');
  });

  it('verifies all 3 HTML files include early OS detection scripts in head', () => {
    const appHtml = fs.readFileSync(path.resolve(__dirname, '../../app.html'), 'utf8');
    const noteHtml = fs.readFileSync(path.resolve(__dirname, '../../note-window.html'), 'utf8');
    const secretaryHtml = fs.readFileSync(path.resolve(__dirname, '../../secretary-window.html'), 'utf8');

    for (const [name, content] of [['app.html', appHtml], ['note-window.html', noteHtml], ['secretary-window.html', secretaryHtml]]) {
      expect(content).toContain('is-electron-mac');
      expect(content).toContain('is-electron-win');
      expect(content).toContain('is-electron-linux');
    }
  });
});
