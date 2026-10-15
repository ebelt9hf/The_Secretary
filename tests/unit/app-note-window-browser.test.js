import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';
import fs from 'fs';
import path from 'path';

describe('Note Window in Browser Environment', () => {
  beforeAll(() => {
    globalThis.t = (key) => key;
    globalThis.normalizeLanguageCode = (code) => code || 'en';
    globalThis.escH = (s) => String(s || '');
    globalThis.escA = (s) => String(s || '');
    globalThis.renderPlanner = vi.fn();

    loadScriptsIntoGlobal([
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-utils.js',
      'js/app-fs.js',
      'js/app-state.js',
      'js/app-notes.js',
      'js/app-bridge.js',
      'js/app-init.js'
    ]);
  });

  beforeEach(() => {
    delete window.electronAPI;
    window.AppBridge.isElectron = false;
    document.body.className = '';
    document.body.innerHTML = `
      <div id="screen-connect"></div>
      <div id="screen-main">
        <div id="note-edit-overlay" style="display:none">
          <div class="overlay-panel">
            <input id="edit-title" />
            <div id="edit-textarea"></div>
          </div>
        </div>
      </div>
    `;
  });

  it('AppBridge.noteWindow.open preserves window.opener in browser mode (no "noopener")', () => {
    const openSpy = vi.fn();
    window.open = openSpy;
    window.location.href = 'http://localhost:5173/app.html#tab=planner';

    window.AppBridge.noteWindow.open('welcome-note', 'notes/welcome.html');

    expect(openSpy).toHaveBeenCalledTimes(1);
    const [targetUrl, targetName, targetFeatures] = openSpy.mock.calls[0];
    expect(targetUrl).toContain('#note=welcome-note');
    expect(targetName).toBe('_blank');
    // Crucial: features must NOT specify noopener so window.opener is preserved
    if (targetFeatures) {
      expect(targetFeatures).not.toContain('noopener');
    }
  });

  it('checkSavedFolder adopts rootHandle from window.opener if available', async () => {
    const mockRootHandle = {
      name: 'Test Workspace',
      isVirtual: true,
      queryPermission: vi.fn().mockResolvedValue('granted')
    };

    window.opener = {
      closed: false,
      rootHandle: mockRootHandle,
      manifest: [{ id: 'note-1', path: 'notes/note-1.html', title: 'Note 1' }],
      settings: { theme: 'light' }
    };

    // Simulate checkSavedFolder
    window.loadHandleIDB = vi.fn().mockResolvedValue(null);
    window.mountFolder = vi.fn().mockResolvedValue(true);

    await window.checkSavedFolder();

    expect(window.mountFolder).toHaveBeenCalledWith(mockRootHandle);
  });

  it('CSS does not permanently hide #screen-connect in focused-note-mode when #screen-main is not active', () => {
    const cssPath = path.resolve(process.cwd(), 'css/app-misc.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    // body.focused-note-mode should not unilaterally hide #screen-connect without #screen-main.active
    const unwantedRule = 'body.focused-note-mode #screen-connect,';
    expect(css).not.toContain(unwantedRule);
  });

  it('queueBackgroundHydration executes without ReferenceError on isVirtualWorkspace', async () => {
    window.rootHandle = { isVirtual: true, name: 'Demo Workspace (Sandbox)' };
    window.ensureNoteStoragePaths = vi.fn().mockResolvedValue(true);
    window.ensureTodosManifestFullyLoaded = vi.fn().mockResolvedValue(true);
    window.hydrateMetadataFromManifestIncremental = vi.fn().mockResolvedValue(true);
    window.indexCollaborativeData = vi.fn().mockResolvedValue(true);
    window.migrateFavicons = vi.fn().mockResolvedValue(true);

    expect(() => {
      window.queueBackgroundHydration();
    }).not.toThrow();
  });

  it('applyHashState successfully mounts opener handle and opens note overlay', async () => {
    const mockRootHandle = {
      name: 'Demo Workspace',
      isVirtual: true,
      queryPermission: vi.fn().mockResolvedValue('granted')
    };

    window.rootHandle = null;
    window.manifest = [];
    window.currentNote = null;
    window.location.hash = '#note=note-demo-42';

    window.opener = {
      closed: false,
      rootHandle: mockRootHandle,
      manifest: [{ id: 'note-demo-42', path: 'notes/demo-42.html', title: 'Demo Note 42' }],
      currentNote: {
        id: 'note-demo-42',
        path: 'notes/demo-42.html',
        title: 'Demo Note 42',
        mainHTML: '<p>Content of demo note 42</p>'
      }
    };

    window.mountFolder = vi.fn().mockImplementation(async (h) => {
      rootHandle = h;
      window.rootHandle = h;
    });

    globalThis.openNoteOverlay = vi.fn().mockImplementation(async (path) => {
      window.currentNote = window.opener.currentNote;
    });

    await window.applyHashState();

    expect(window.mountFolder).toHaveBeenCalledWith(mockRootHandle);
    expect(window.rootHandle).toBe(mockRootHandle);
    expect(globalThis.openNoteOverlay).toHaveBeenCalledWith('notes/demo-42.html', null, null, false, null, { sameWindow: true });
    expect(window.currentNote.title).toBe('Demo Note 42');
  });
});
