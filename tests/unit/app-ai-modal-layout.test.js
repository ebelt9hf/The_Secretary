import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('AI Modal Layout & Left Bar Hidden When Not Setup', () => {
  beforeAll(() => {
    globalThis.t = (key) => key;
    globalThis.escH = (s) => String(s || '');
    globalThis.escA = (s) => String(s || '');
    globalThis.toast = vi.fn();
    globalThis.manifest = [];
    globalThis.settings = {
      ai: {
        enabled: false,
        provider: 'custom',
        endpoint: '',
        model: ''
      }
    };

    loadScriptsIntoGlobal([
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-utils.js',
      'js/app-bridge.js',
      'js/app-chat.js'
    ]);
  });

  beforeEach(() => {
    document.body.innerHTML = `
      <button id="btn-topbar-ai" class="topbar-ai-btn">AI</button>
      <div id="floating-secretary-chat" class="floating-chat-window">
        <div id="floating-chat-header" class="floating-chat-header">
          <button class="close-btn" onclick="toggleFloatingChat()">&times;</button>
        </div>
        <div id="floating-chat-body" class="floating-chat-body chat-panel"></div>
      </div>
    `;

    window.AppBridge = { isElectron: false };
    window.innerWidth = 1440;
    window.innerHeight = 900;
  });

  it('hides left history sidebar when AI is not setup and renders onboarding notice', () => {
    globalThis.LLMService = {
      isEnabled: () => false,
      isSetup: () => false
    };

    toggleFloatingChat();

    const el = document.getElementById('floating-secretary-chat');
    expect(el.classList.contains('is-open')).toBe(true);

    const body = document.getElementById('floating-chat-body');
    expect(body.querySelector('.chat-onboarding')).not.toBeNull();
    expect(body.querySelector('#chat-history-sidebar')).toBeNull();
    expect(body.querySelector('#chat-history-resize-handle')).toBeNull();
  });

  it('renders history left sidebar when AI is configured and setup', () => {
    globalThis.LLMService = {
      isEnabled: () => true,
      isSetup: () => true
    };

    toggleFloatingChat();

    const el = document.getElementById('floating-secretary-chat');
    expect(el.classList.contains('is-open')).toBe(true);

    const body = document.getElementById('floating-chat-body');
    expect(body.querySelector('.chat-onboarding')).toBeNull();
    expect(body.querySelector('#chat-history-sidebar')).not.toBeNull();
  });

  it('initializes floating chat modal with enlarged dimensions (>= 1000px width, >= 700px height)', () => {
    globalThis.LLMService = {
      isEnabled: () => true,
      isSetup: () => true
    };

    const el = document.getElementById('floating-secretary-chat');
    el.style.top = '';
    el.style.left = '';
    el.style.width = '';
    el.style.height = '';

    toggleFloatingChat();

    const w = parseInt(el.style.width, 10);
    const h = parseInt(el.style.height, 10);
    expect(w).toBeGreaterThanOrEqual(1000);
    expect(h).toBeGreaterThanOrEqual(700);
  });

  it('specifies enlarged default width of 1040px and height of 740px in app-chat.css', () => {
    const cssPath = path.resolve(__dirname, '../../css/app-chat.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    expect(css).toMatch(/\.floating-chat-window\s*\{[^}]*width:\s*1040px;/);
    expect(css).toMatch(/\.floating-chat-window\s*\{[^}]*height:\s*740px;/);
  });
});
