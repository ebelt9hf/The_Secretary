import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Electron AI Agent Window & Upward Flashing (app-chat.js & app-bridge.js)', () => {
  beforeAll(() => {
    globalThis.t = (key) => key;
    globalThis.escH = (s) => String(s || '');
    globalThis.escA = (s) => String(s || '');
    globalThis.toast = vi.fn();
    globalThis.manifest = [];

    document.body.innerHTML = `
      <button id="btn-topbar-ai" class="topbar-ai-btn">AI</button>
      <button id="btn-overlay-ai" class="topbar-ai-btn">AI</button>
      <div id="floating-secretary-chat" class="floating-chat-window">
        <div id="floating-chat-header" class="floating-chat-header">
          <button class="close-btn" onclick="toggleFloatingChat()">&times;</button>
        </div>
        <div id="floating-chat-body" class="floating-chat-body">
          <div id="chat-messages-container"></div>
          <div id="chat-attachments-container"></div>
          <textarea id="chat-input-textarea"></textarea>
        </div>
      </div>
    `;

    loadScriptsIntoGlobal([
      'js/app-bridge.js',
      'js/app-chat.js'
    ]);
  });

  beforeEach(() => {
    document.body.className = '';
    const el = document.getElementById('floating-secretary-chat');
    if (el) {
      el.className = 'floating-chat-window';
      el.style.display = '';
    }
    document.querySelectorAll('.topbar-ai-btn').forEach(b => b.classList.remove('active'));
  });

  it('delegates to AppBridge.chatWindow.open() in Electron environment', () => {
    window.AppBridge = window.AppBridge || {};
    window.AppBridge.isElectron = true;
    window.AppBridge.chatWindow = {
      open: vi.fn().mockReturnValue(true)
    };

    toggleFloatingChat();

    expect(window.AppBridge.chatWindow.open).toHaveBeenCalled();
    const el = document.getElementById('floating-secretary-chat');
    // Ensure in-page floating modal is not kept open
    expect(el.classList.contains('is-open')).toBe(false);
  });

  it('closes Electron window when toggleFloatingChat is clicked in chat-window-mode', () => {
    document.body.classList.add('chat-window-mode');
    window.electronAPI = {
      closeWindow: vi.fn(),
      minimizeWindow: vi.fn()
    };

    toggleFloatingChat();
    expect(window.electronAPI.closeWindow).toHaveBeenCalled();
  });

  it('minimizes Electron window when minimizeFloatingChat is called in chat-window-mode', () => {
    document.body.classList.add('chat-window-mode');
    window.electronAPI = {
      closeWindow: vi.fn(),
      minimizeWindow: vi.fn()
    };

    minimizeFloatingChat();
    expect(window.electronAPI.minimizeWindow).toHaveBeenCalled();
  });

  it('triggers upward flash animation on #floating-secretary-chat', () => {
    const el = document.getElementById('floating-secretary-chat');
    expect(typeof triggerChatFlashUpward).toBe('function');

    triggerChatFlashUpward();
    expect(el.classList.contains('chat-flash-upward')).toBe(true);
  });

  it('synchronizes AI button active state across windows', () => {
    const btnTopbar = document.getElementById('btn-topbar-ai');
    const btnOverlay = document.getElementById('btn-overlay-ai');

    expect(typeof updateAiButtons).toBe('function');

    updateAiButtons(true);
    expect(btnTopbar.classList.contains('active')).toBe(true);
    expect(btnOverlay.classList.contains('active')).toBe(true);

    updateAiButtons(false);
    expect(btnTopbar.classList.contains('active')).toBe(false);
    expect(btnOverlay.classList.contains('active')).toBe(false);
  });

  it('closes standalone secretary window directly without triggering handleMainWindowCloseRequest or quitting entire app', async () => {
    document.body.className = 'is-electron chat-window-mode secretary-window-standalone';
    const closeWindowSpy = vi.fn();
    const mainWindowCloseSpy = vi.fn();

    window.electronAPI = {
      closeWindow: closeWindowSpy
    };
    window.handleMainWindowCloseRequest = mainWindowCloseSpy;

    await window.AppBridge.windowControls.close();

    // Must NOT prompt or call main window exit routine
    expect(mainWindowCloseSpy).not.toHaveBeenCalled();
    // Must close the individual window directly
    expect(closeWindowSpy).toHaveBeenCalledTimes(1);
  });
});

