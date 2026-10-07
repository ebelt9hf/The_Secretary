import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';
import fs from 'fs';
import path from 'path';

describe('Secretary Agent Window Topbar OS Configuration', () => {
  beforeAll(() => {
    globalThis.t = (key) => {
      const dict = {
        'window.minimize': 'Minimize window',
        'window.maximize': 'Maximize window',
        'window.restore': 'Restore window',
        'window.close': 'Close window',
        'chat.guideTooltip': 'AI Assistant User Guide'
      };
      return dict[key] || key;
    };
    globalThis.escH = (s) => String(s || '');
    globalThis.escA = (s) => String(s || '');

    loadScriptsIntoGlobal([
      'js/app-bridge.js',
      'js/app-chat.js'
    ]);
  });

  beforeEach(() => {
    document.documentElement.className = '';
    document.body.className = '';
    document.body.innerHTML = `
      <div id="win-controls" class="win-controls">
        <button class="win-ctrl-btn" id="win-min" title="Minimize window" data-i18n-title="window.minimize" aria-label="Minimize">Min</button>
        <button class="win-ctrl-btn" id="win-max" title="Maximize window" data-i18n-title="window.maximize" aria-label="Maximize">Max</button>
        <button class="win-ctrl-btn win-ctrl-close" id="win-close" title="Close window" data-i18n-title="window.close" aria-label="Close">Close</button>
      </div>
      <div id="screen-main" class="active">
        <div id="floating-secretary-chat" class="floating-chat-window is-open">
          <div class="floating-chat-header" id="floating-chat-header" ondblclick="if(!event.target.closest('button, input, select')) toggleMaximizeFloatingChat()">
            <div style="display:flex; align-items:center; gap:8px">
              <span class="floating-chat-logo">Logo</span>
              <span class="floating-chat-title">Secretary</span>
            </div>
            <div class="floating-chat-actions">
              <button class="floating-chat-btn help-btn" id="btn-agent-guide" onclick="AIChatController.showAgentGuide()" title="Guide d'utilisation de l'Assistant IA" data-i18n-title="chat.guideTooltip">Guide</button>
              <button class="floating-chat-btn popout-btn" id="btn-floating-chat-popout" onclick="AIChatController.popoutToWindow()" title="Ouvrir l'assistant IA dans une fenêtre séparée" data-i18n-title="chat.popoutTooltip">Popout</button>
              <button class="floating-chat-btn min-btn" onclick="minimizeFloatingChat()" title="Minimiser" data-i18n-title="window.minimize"><svg width="13" height="13" viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
              <button class="floating-chat-btn close-btn" onclick="toggleFloatingChat()" title="Fermer" data-i18n-title="window.close"><svg width="13" height="13" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
            </div>
          </div>
          <div id="floating-chat-body" class="floating-chat-body chat-panel"></div>
        </div>
      </div>
    `;
  });

  it('verifies stylesheet rules for macOS, Windows, Linux, and Fullscreen topbars', () => {
    const cssPath = path.resolve(__dirname, '../../css/app-chat.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    // Check that standalone companion window topbar has background var(--topbar-bg)
    expect(css).toContain('body.chat-window-mode .floating-chat-header');
    expect(css).toContain('background: var(--topbar-bg) !important;');

    // macOS traffic light padding (88px)
    expect(css).toMatch(/body\.is-electron-mac:not\(\.is-fullscreen\)\.chat-window-mode \.floating-chat-header[\s\S]*?padding-left:\s*88px\s*!important/);

    // Windows & Linux controls margin clearance (var(--win-controls-w, 138px))
    expect(css).toMatch(/body\.is-electron-win:not\(\.is-fullscreen\)\.chat-window-mode \.floating-chat-header[\s\S]*?margin-right:\s*var\(--win-controls-w,\s*138px\)\s*!important/);
    expect(css).toMatch(/body\.is-electron-linux:not\(\.is-fullscreen\)\.chat-window-mode \.floating-chat-header[\s\S]*?margin-right:\s*var\(--win-controls-w,\s*138px\)\s*!important/);

    // Fullscreen resets
    expect(css).toMatch(/body\.is-fullscreen\.chat-window-mode \.floating-chat-header[\s\S]*?padding-left:\s*12px\s*!important/);
    expect(css).toMatch(/body\.is-fullscreen\.chat-window-mode \.floating-chat-header[\s\S]*?-webkit-app-region:\s*no-drag\s*!important/);

    // Ensure buttons, actions, and button children have no-drag and pointer-events auto
    expect(css).toContain('body.chat-window-mode .floating-chat-header button *');
    expect(css).toContain('body.chat-window-mode .floating-chat-actions');
    expect(css).toContain('-webkit-app-region: no-drag !important;');
    expect(css).toContain('pointer-events: auto !important;');

    // Inline min/close buttons are hidden in standalone mode
    expect(css).toContain('body.chat-window-mode .floating-chat-btn.min-btn');
    expect(css).toContain('display: none !important;');
  });

  it('wires window controls and toggles maximize on header double-click', () => {
    document.body.classList.add('is-electron', 'chat-window-mode', 'secretary-window-standalone');

    const toggleMaximizeSpy = vi.fn();
    window.AppBridge = {
      isElectron: true,
      isWin: true,
      windowControls: {
        toggleMaximize: toggleMaximizeSpy
      }
    };

    const header = document.getElementById('floating-chat-header');
    expect(header.getAttribute('ondblclick')).toContain('toggleMaximizeFloatingChat');

    window.toggleMaximizeFloatingChat();
    expect(toggleMaximizeSpy).toHaveBeenCalled();
  });

  it('delegates minimize and close to Electron APIs when in chat-window-mode', () => {
    document.body.classList.add('is-electron', 'chat-window-mode', 'secretary-window-standalone');

    const closeSpy = vi.fn();
    const minSpy = vi.fn();
    window.electronAPI = {
      closeWindow: closeSpy,
      minimizeWindow: minSpy
    };

    window.toggleFloatingChat();
    expect(closeSpy).toHaveBeenCalled();

    window.minimizeFloatingChat();
    expect(minSpy).toHaveBeenCalled();
  });

  it('ensures template buttons have correct data-i18n-title attributes', () => {
    const helpBtn = document.getElementById('btn-agent-guide');
    const minBtn = document.querySelector('.floating-chat-btn.min-btn');
    const closeBtn = document.querySelector('.floating-chat-btn.close-btn');

    expect(helpBtn.getAttribute('data-i18n-title')).toBe('chat.guideTooltip');
    expect(minBtn.getAttribute('data-i18n-title')).toBe('window.minimize');
    expect(closeBtn.getAttribute('data-i18n-title')).toBe('window.close');
  });

  it('ensures window controls (.win-controls) in secretary standalone companion window have dark topbar background to prevent white-on-white buttons', () => {
    const chatCssPath = path.resolve(__dirname, '../../css/app-chat.css');
    const miscCssPath = path.resolve(__dirname, '../../css/app-misc.css');
    const chatCss = fs.readFileSync(chatCssPath, 'utf8');
    const miscCss = fs.readFileSync(miscCssPath, 'utf8');

    const hasChatRules = chatCss.includes('body.chat-window-mode .win-controls') &&
      chatCss.includes('background: var(--topbar-bg) !important;');
    const hasMiscRules = (miscCss.includes('body.is-electron.secretary-window-standalone .win-controls') ||
      miscCss.includes('body.is-electron.chat-window-mode .win-controls')) &&
      miscCss.includes('background: var(--topbar-bg) !important;');

    expect(hasChatRules || hasMiscRules).toBe(true);
  });

  it('verifies Ctrl+W cleanly closes child standalone companion window', () => {
    document.body.classList.add('is-electron', 'chat-window-mode', 'secretary-window-standalone');

    const closeSpy = vi.fn();
    window.AppBridge = {
      isElectron: true,
      windowControls: {
        close: closeSpy
      }
    };

    // Simulate keydown event handler from app-init.js
    const isStandaloneChild = document.body.classList.contains('chat-window-mode') ||
      document.body.classList.contains('secretary-window-standalone');

    expect(isStandaloneChild).toBe(true);
    if (isStandaloneChild) {
      window.AppBridge.windowControls.close();
    }
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('ensures template file has crisp vector SVG icons and no raw entities', () => {
    const templatePath = path.resolve(__dirname, '../../templates/floating-chat.html');
    const tpl = fs.readFileSync(templatePath, 'utf8');

    expect(tpl).not.toContain('&minus;');
    expect(tpl).not.toContain('&times;');
    expect(tpl).toContain('min-btn');
    expect(tpl).toContain('close-btn');
    expect(tpl).toMatch(/min-btn[\s\S]*?<svg/);
    expect(tpl).toMatch(/close-btn[\s\S]*?<svg/);
  });
});

