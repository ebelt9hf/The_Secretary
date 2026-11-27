import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
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
    globalThis.toast = vi.fn();
    globalThis.autoSaveNote = vi.fn().mockResolvedValue(true);
    globalThis.hasUnsavedNoteOverlayChanges = vi.fn().mockReturnValue(false);
    globalThis.renderBoard = vi.fn();

    loadScriptsIntoGlobal([
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-utils.js',
      'js/app-fs.js',
      'js/app-state.js',
      'js/app-notes.js',
      'js/app-bridge.js',
      'js/app-overlay.js',
      'js/app-collab.js',
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

  afterEach(() => {
    vi.restoreAllMocks();
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

    const origOpenNoteOverlay = globalThis.openNoteOverlay;
    globalThis.openNoteOverlay = vi.fn().mockImplementation(async (path) => {
      window.currentNote = window.opener.currentNote;
    });

    try {
      await window.applyHashState();

      expect(window.mountFolder).toHaveBeenCalledWith(mockRootHandle);
      expect(window.rootHandle).toBe(mockRootHandle);
      expect(globalThis.openNoteOverlay).toHaveBeenCalledWith('notes/demo-42.html', null, null, false, null, { sameWindow: true });
      expect(window.currentNote.title).toBe('Demo Note 42');
    } finally {
      globalThis.openNoteOverlay = origOpenNoteOverlay;
    }
  });

  it('note-window.html template does not hardcode is-electron on body', () => {
    const htmlPath = path.resolve(process.cwd(), 'note-window.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    const bodyMatch = html.match(/<body[^>]*class=["']([^"']*)["']/i);
    expect(bodyMatch).not.toBeNull();
    const bodyClasses = bodyMatch[1].split(/\s+/);
    expect(bodyClasses).not.toContain('is-electron');
  });

  it('closeNoteOverlay resets _noteCloseInProgress, removes focused-note-mode and restores body overflow', async () => {
    document.body.classList.add('focused-note-mode');
    document.body.style.overflow = 'hidden';
    globalThis._isFocusedMode = true;
    globalThis.currentNote = { id: 'note-1', path: 'notes/note-1.html', title: 'Note 1' };
    
    window.close = vi.fn();
    window.AppBridge.isElectron = false;

    await globalThis.closeNoteOverlay();

    expect(globalThis._noteCloseInProgress).toBe(false);
    expect(document.body.classList.contains('focused-note-mode')).toBe(false);
    expect(document.body.style.overflow).toBe('');
    expect(globalThis._isFocusedMode).toBe(false);
  });

  it('getBacklinksForNote handles NotFoundError from StorageAPI without throwing', async () => {
    globalThis.manifest = [
      { id: 'missing-note', path: 'notes/missing.html', title: 'Missing Note', modified: '2026-01-01' }
    ];
    globalThis.noteContentCache = {};
    const notFoundErr = new Error('File not found: notes/missing.html');
    notFoundErr.name = 'NotFoundError';
    globalThis.StorageAPI = {
      readNoteContent: vi.fn().mockRejectedValue(notFoundErr)
    };

    const targetNote = { id: 'target-note', path: 'notes/target.html', title: 'Target' };
    const backlinks = await globalThis.getBacklinksForNote(targetNote);
    expect(Array.isArray(backlinks)).toBe(true);
    expect(backlinks.length).toBe(0);
    expect(globalThis.noteContentCache['notes/missing.html']).toBeDefined();
    expect(globalThis.noteContentCache['notes/missing.html'].notFound).toBe(true);
  });

  it('closeNoteOverlay does not call renderInspectorPanel during final close save and always removes the Fermeture de la note progress dialog', async () => {
    document.body.innerHTML = `
      <div id="screen-main" class="active">
        <div id="topbar-main-row"></div>
        <div id="note-edit-overlay" class="active" style="display:flex;">
          <div class="overlay-panel">
            <input id="edit-title" value="Updated Title" />
            <input id="edit-date" value="2026-11-04" />
            <div id="edit-textarea"><p>Updated content</p></div>
            <div id="edit-summary"></div>
            <div id="overlay-right-panel"></div>
          </div>
        </div>
      </div>
    `;
    globalThis._isFocusedMode = false;
    globalThis._noteCloseInProgress = false;
    globalThis._isNoteLoading = false;
    globalThis.currentNote = {
      id: 'note-close-1',
      path: 'notes/note-close-1.html',
      title: 'Original Title',
      date: '2026-11-04',
      mainHTML: '<p>Original content</p>',
      originalHTML: '<!DOCTYPE html><html><body><main><p>Original content</p></main></body></html>',
      group_tags: [],
      major_topic_tags: [],
      topic_tags: [],
      extra_tags: [],
      summary: ''
    };
    globalThis.manifest = [{ id: 'note-close-1', path: 'notes/note-close-1.html', title: 'Original Title' }];
    globalThis.hasUnsavedNoteOverlayChanges = vi.fn().mockReturnValue(true);

    const origRenderInspectorPanel = globalThis.renderInspectorPanel;
    const inspectorSpy = vi.fn().mockImplementation(async () => {
      // Simulate heavy or hung inspector backlink scan if called during close
      await new Promise(() => {});
    });
    globalThis.renderInspectorPanel = inspectorSpy;

    globalThis.StorageAPI = {
      getStorageEngine: () => 'filesystem',
      writeNoteContent: vi.fn().mockResolvedValue(true),
      writeNotesManifest: vi.fn().mockResolvedValue(true),
      writeNotesManifestJS: vi.fn().mockResolvedValue(true),
      writeMetadataBuffer: vi.fn().mockResolvedValue(true),
      hasMetadataShardsIndex: vi.fn().mockResolvedValue(false),
      hasNoteContent: vi.fn().mockResolvedValue(false)
    };

    // Restore authentic autoSaveNote from app-overlay.js
    loadScriptsIntoGlobal(['js/app-overlay.js']);
    globalThis.renderInspectorPanel = inspectorSpy;
    globalThis.hasUnsavedNoteOverlayChanges = vi.fn().mockReturnValue(true);

    try {
      await globalThis.closeNoteOverlay(true);

      expect(inspectorSpy).not.toHaveBeenCalled();
      expect(document.getElementById('note-close-progress-overlay')).toBeNull();
      expect(document.getElementById('note-edit-overlay').style.display).toBe('none');
      expect(globalThis._noteCloseInProgress).toBe(false);
    } finally {
      globalThis.renderInspectorPanel = origRenderInspectorPanel;
    }
  });

  it('applyHashState with #tab=notes&note=<id> in main app window does not set _isFocusedMode or focused-note-mode', async () => {
    document.body.className = '';
    document.body.innerHTML = `
      <div id="screen-main" class="active">
        <div id="topbar-main-row"></div>
        <div id="note-edit-overlay" style="display:none;"></div>
      </div>
    `;
    globalThis._isFocusedMode = false;
    globalThis._isApplyingHash = false;
    globalThis.activeTab = 'notes';
    globalThis.manifest = [{ id: 'note-in-app', path: 'notes/note-in-app.html', title: 'In App Note' }];
    globalThis.switchTab = vi.fn().mockResolvedValue(undefined);
    const origOpenNoteOverlay = globalThis.openNoteOverlay;
    globalThis.openNoteOverlay = vi.fn().mockResolvedValue(undefined);

    try {
      window.location.hash = '#tab=notes&note=note-in-app';
      await window.applyHashState();

      expect(globalThis._isFocusedMode).toBe(false);
      expect(document.body.classList.contains('focused-note-mode')).toBe(false);
      expect(globalThis.openNoteOverlay).toHaveBeenCalledWith('notes/note-in-app.html', null, null, false, null, { sameWindow: true });
    } finally {
      globalThis.openNoteOverlay = origOpenNoteOverlay;
    }
  });

  it('saveManifest({ force: true }) settles pending waiters even if an in-flight manifest flush rejects', async () => {
    let callCount = 0;
    let rejectFirstFlush;
    globalThis.StorageAPI = {
      getStorageEngine: () => 'filesystem',
      writeNotesManifest: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return new Promise((_, reject) => {
            rejectFirstFlush = reject;
          });
        }
        return Promise.resolve(true);
      }),
      writeNotesManifestJS: vi.fn().mockResolvedValue(true),
      writeMetadataBuffer: vi.fn().mockResolvedValue(true),
      hasMetadataShardsIndex: vi.fn().mockResolvedValue(false)
    };

    const firstSave = globalThis.saveManifest({ force: true }).catch(() => 'first-rejected');
    const secondSave = globalThis.saveManifest({ force: true });

    rejectFirstFlush(new Error('Transient write failure'));

    const [firstResult] = await Promise.all([firstSave, secondSave]);
    expect(firstResult).toBe('first-rejected');
    expect(callCount).toBe(2);
  });

  it('openNoteOverlay opens in a separate window by default in installed PWA web app mode', async () => {
    window.AppBridge.isElectron = false;
    globalThis._isFocusedMode = false;
    globalThis.activeTab = 'notes';
    window.location.hash = '#tab=notes';
    globalThis.manifest = [{ id: 'note-web-1', path: 'notes/note-web-1.html', title: 'Web Note 1' }];

    const origMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((q) => ({
      matches: q === '(display-mode: window-controls-overlay)' || q === '(display-mode: standalone)',
      media: q
    }));
    const openSpy = vi.fn().mockReturnValue({ closed: false });
    window.open = openSpy;
    const bridgeOpenSpy = vi.spyOn(window.AppBridge.noteWindow, 'open');

    try {
      await globalThis.openNoteOverlay('notes/note-web-1.html');

      expect(bridgeOpenSpy).toHaveBeenCalledWith('note-web-1', 'notes/note-web-1.html');
      expect(openSpy).toHaveBeenCalledTimes(1);
      expect(openSpy.mock.calls[0][0]).toContain('#note=note-web-1');
      expect(document.getElementById('note-edit-overlay').style.display).toBe('none');
    } finally {
      window.matchMedia = origMatchMedia;
    }
  });

  it('openNoteOverlay opens within the browser window in a regular browser tab unless openInNewWindow is set', async () => {
    window.AppBridge.isElectron = false;
    globalThis._isFocusedMode = false;
    globalThis.activeTab = 'notes';
    window.location.hash = '#tab=notes';
    globalThis.manifest = [{ id: 'note-tab-1', path: 'notes/note-tab-1.html', title: 'Tab Note 1' }];
    globalThis.StorageAPI = {
      getNoteFromCache: vi.fn().mockReturnValue(null),
      readNoteContent: vi.fn().mockResolvedValue('<!DOCTYPE html><html><body><main><p>In-tab</p></main></body></html>')
    };

    const origMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });
    const openSpy = vi.fn().mockReturnValue({ closed: false });
    window.open = openSpy;
    const bridgeOpenSpy = vi.spyOn(window.AppBridge.noteWindow, 'open');

    try {
      await globalThis.openNoteOverlay('notes/note-tab-1.html');
      expect(bridgeOpenSpy).not.toHaveBeenCalled();

      await globalThis.openNoteOverlay('notes/note-tab-1.html', null, null, false, null, { openInNewWindow: true });
      expect(bridgeOpenSpy).toHaveBeenCalledWith('note-tab-1', 'notes/note-tab-1.html');
      expect(openSpy).toHaveBeenCalledTimes(1);
    } finally {
      window.matchMedia = origMatchMedia;
    }
  });

  it('openNoteOverlay does not open a separate window when viewing a note (viewMode/previewOnly) or in daily review even in web app/Electron mode', async () => {
    window.AppBridge.isElectron = true;
    globalThis._isFocusedMode = false;
    globalThis.activeTab = 'notes';
    window.location.hash = '#tab=notes';
    globalThis.manifest = [{ id: 'note-view-1', path: 'notes/note-view-1.html', title: 'View Note 1' }];
    globalThis.StorageAPI = {
      getNoteFromCache: vi.fn().mockReturnValue(null),
      readNoteContent: vi.fn().mockResolvedValue('<!DOCTYPE html><html><body><main><p>Viewed</p></main></body></html>')
    };

    const bridgeOpenSpy = vi.spyOn(window.AppBridge.noteWindow, 'open');

    await globalThis.openNoteOverlay('notes/note-view-1.html', null, null, false, null, { viewMode: true });
    expect(bridgeOpenSpy).not.toHaveBeenCalled();

    await globalThis.openNoteOverlay('notes/note-view-1.html', null, null, false, null, { previewOnly: true });
    expect(bridgeOpenSpy).not.toHaveBeenCalled();

    globalThis.activeTab = 'daily-review';
    await globalThis.openNoteOverlay('notes/note-view-1.html');
    expect(bridgeOpenSpy).not.toHaveBeenCalled();
  });

  it('openNoteOverlay falls back to in-page overlay when popup is blocked in PWA web app mode', async () => {
    window.AppBridge.isElectron = false;
    globalThis._isFocusedMode = false;
    globalThis.activeTab = 'notes';
    window.location.hash = '#tab=notes';
    globalThis.manifest = [{ id: 'note-fallback-1', path: 'notes/note-fallback-1.html', title: 'Fallback Note' }];
    globalThis.StorageAPI = {
      getNoteFromCache: vi.fn().mockReturnValue(null),
      readNoteContent: vi.fn().mockResolvedValue('<!DOCTYPE html><html><body><main><p>Fallback</p></main></body></html>')
    };

    const origMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    window.open = vi.fn().mockReturnValue(null);

    try {
      await globalThis.openNoteOverlay('notes/note-fallback-1.html');
      expect(globalThis.StorageAPI.readNoteContent).toHaveBeenCalledWith('notes/note-fallback-1.html');
      expect(document.getElementById('note-edit-overlay').style.display).toBe('flex');
    } finally {
      window.matchMedia = origMatchMedia;
    }
  });

  it('AppBridge.noteWindow.open returns false when popup is blocked (window.open returns null)', () => {
    window.open = vi.fn().mockReturnValue(null);
    window.location.href = 'http://localhost:5173/app.html#tab=notes';

    const result = window.AppBridge.noteWindow.open('blocked-note', 'notes/blocked.html');
    expect(result).toBe(false);
  });

  it('css/app-misc.css applies WCO titlebar padding and no-drag rules to #note-edit-overlay .overlay-header', () => {
    const cssPath = path.resolve(process.cwd(), 'css/app-misc.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    expect(css).toContain('html.is-pwa-wco:not(.is-electron):not(.is-fullscreen) #note-edit-overlay .overlay-header');
    expect(css).toContain('html.is-pwa-wco:not(.is-electron):not(.is-fullscreen) #note-edit-overlay .overlay-header button');
  });
});
