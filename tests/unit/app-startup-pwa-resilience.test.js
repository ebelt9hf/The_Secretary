import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

/**
 * Unit Tests: PWA & Startup Resilience
 *
 * 4-Point Audit:
 * 1. Protected Behavior:
 *    - openIDB() rejects on `onblocked` and on open timeout instead of hanging indefinitely.
 *    - loadHandleIDB() resolves to null when IndexedDB open is blocked or times out.
 *    - checkSavedFolder() clears landing busy state (setLandingBusy(false)) when mountFolder throws or when queryPermission stalls.
 *    - PwaManager.init() registers the service worker even when running in standalone PWA mode.
 *    - sw.js same-origin offline fallback checks ignoreSearch and returns Response.error() rather than undefined.
 * 2. Regression Target:
 *    - Fails if #screen-connect remains stuck in `.loading` with `#startup-progress-wrap` hidden during PWA startup stalls or errors.
 * 3. Coverage Overlap & Redundancy:
 *    - Distinct from app-pwa.test.js (install prompt/WCO) and app-startup-screen-ui.test.js (CSS centering/FOUC).
 * 4. Production Code Footprint:
 *    - Zero test-only code; exercises authentic functions in js/app-fs.js, js/app-init.js, js/app-pwa.js, and sw.js.
 */
describe('PWA & Startup Resilience', () => {
  const rootDir = path.resolve(process.cwd());

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('rejects openIDB on blocked event and resolves loadHandleIDB to null without hanging', async () => {
    vi.useFakeTimers();
    const appFsCode = fs.readFileSync(path.join(rootDir, 'js/app-fs.js'), 'utf8');
    const mockReq = { onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
    const sandbox = {
      console,
      setTimeout,
      clearTimeout,
      Promise,
      Error,
      indexedDB: {
        open: vi.fn(() => mockReq)
      }
    };
    vm.createContext(sandbox);
    vm.runInContext(appFsCode, sandbox);

    const loadPromise = sandbox.loadHandleIDB();
    expect(sandbox.indexedDB.open).toHaveBeenCalledWith('secretary-app', 1);
    expect(typeof mockReq.onblocked).toBe('function');

    mockReq.onblocked();
    const result = await loadPromise;
    expect(result).toBeNull();
  });

  it('times out openIDB when IndexedDB neither succeeds nor errors', async () => {
    vi.useFakeTimers();
    const appFsCode = fs.readFileSync(path.join(rootDir, 'js/app-fs.js'), 'utf8');
    const mockReq = { onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
    const sandbox = {
      console,
      setTimeout,
      clearTimeout,
      Promise,
      Error,
      indexedDB: {
        open: vi.fn(() => mockReq)
      }
    };
    vm.createContext(sandbox);
    vm.runInContext(appFsCode, sandbox);

    const openPromise = sandbox.openIDB();
    const assertion = expect(openPromise).rejects.toThrow('Timed out opening IndexedDB');
    await vi.advanceTimersByTimeAsync(4100);
    await assertion;
  });

  it('recovers landing screen from loading state when mountFolder throws during checkSavedFolder', async () => {
    const appInitCode = fs.readFileSync(path.join(rootDir, 'js/app-init.js'), 'utf8');
    const startIdx = appInitCode.indexOf('function _withStartupTimeout(');
    const endIdx = appInitCode.indexOf('document.addEventListener(\'click\', async e => {');
    expect(startIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(startIdx);

    const setLandingBusy = vi.fn();
    const sandbox = {
      console,
      setTimeout,
      clearTimeout,
      Promise,
      Error,
      window: {
        initTranslationsPromise: Promise.resolve(),
        AppBridge: { fs: { getWorkspacePath: vi.fn().mockResolvedValue(null) }, isElectron: false },
        opener: null
      },
      document: {
        body: { classList: { contains: () => false } },
        getElementById: () => null
      },
      location: { hash: '' },
      settings: { storageEngine: 'firebase', folder: {} },
      applyLocalizedUI: vi.fn(),
      setLandingBusy,
      mountFolder: vi.fn().mockRejectedValue(new Error('Simulated mount failure')),
      loadHandleIDB: vi.fn().mockResolvedValue(null),
      saveHandleIDB: vi.fn().mockResolvedValue(undefined),
      saveLocalSettings: vi.fn(),
      updateStartupProgress: vi.fn(),
      rememberedFolderHandle: null,
      _isFocusedMode: false,
      t: (k) => k
    };
    vm.createContext(sandbox);
    vm.runInContext(appInitCode.slice(startIdx, endIdx), sandbox);

    await sandbox.checkSavedFolder();
    expect(sandbox.mountFolder).toHaveBeenCalledWith({ name: 'Firebase Cloud Vault' });
    expect(setLandingBusy).toHaveBeenCalledWith(false);
  });

  it('falls back to resume button when handle.queryPermission stalls past startup timeout', async () => {
    vi.useFakeTimers();
    const appInitCode = fs.readFileSync(path.join(rootDir, 'js/app-init.js'), 'utf8');
    const startIdx = appInitCode.indexOf('function _withStartupTimeout(');
    const endIdx = appInitCode.indexOf('document.addEventListener(\'click\', async e => {');

    const setLandingBusy = vi.fn();
    const resumeWrap = { style: { display: 'none' } };
    const btn = { title: '', onclick: null };
    const elements = {
      'landing-resume-wrap': resumeWrap,
      'btn-resume-folder': btn,
      'btn-resume-folder-label': { textContent: '' },
      'btn-resume-folder-name': { textContent: '' },
      'landing-divider': { style: { display: 'none' } },
      'btn-open-folder': { classList: { remove: vi.fn() } },
      'btn-open-folder-text': { textContent: '' }
    };

    const sandbox = {
      console,
      setTimeout,
      clearTimeout,
      Promise,
      Error,
      window: {
        initTranslationsPromise: Promise.resolve(),
        AppBridge: { fs: null, isElectron: false },
        opener: null
      },
      document: {
        body: { classList: { contains: () => false } },
        getElementById: (id) => elements[id] || null
      },
      location: { hash: '' },
      settings: { storageEngine: 'filesystem', folder: {} },
      applyLocalizedUI: vi.fn(),
      setLandingBusy,
      mountFolder: vi.fn(),
      loadHandleIDB: vi.fn().mockResolvedValue({
        name: 'MyNotes',
        queryPermission: () => new Promise(() => {})
      }),
      saveHandleIDB: vi.fn(),
      saveLocalSettings: vi.fn(),
      updateStartupProgress: vi.fn(),
      rememberedFolderHandle: null,
      _isFocusedMode: false,
      t: (k) => k
    };
    vm.createContext(sandbox);
    vm.runInContext(appInitCode.slice(startIdx, endIdx), sandbox);

    const runPromise = sandbox.checkSavedFolder();
    await vi.advanceTimersByTimeAsync(3100);
    await runPromise;

    expect(sandbox.mountFolder).not.toHaveBeenCalled();
    expect(setLandingBusy).toHaveBeenCalledWith(false);
    expect(resumeWrap.style.display).toBe('');
    expect(elements['btn-resume-folder-name'].textContent).toBe('MyNotes');
  });

  it('registers service worker in PwaManager.init even when running in standalone mode', () => {
    const pwaCode = fs.readFileSync(path.join(rootDir, 'js/app-pwa.js'), 'utf8');
    const registerSpy = vi.fn().mockResolvedValue({ addEventListener: vi.fn() });
    const sandbox = {
      console,
      CustomEvent: class {},
      document: {
        readyState: 'complete',
        documentElement: { classList: { toggle: vi.fn() }, getAttribute: () => 'light' },
        body: { classList: { toggle: vi.fn() } },
        querySelector: () => null,
        getElementById: () => null
      },
      navigator: {
        userAgent: 'Mozilla/5.0 Chrome/130.0.0.0',
        serviceWorker: { register: registerSpy }
      },
      window: {
        location: { protocol: 'https:', hostname: 'example.github.io' },
        matchMedia: () => ({ matches: true }),
        addEventListener: vi.fn(),
        dispatchEvent: vi.fn()
      }
    };
    sandbox.window.navigator = sandbox.navigator;
    sandbox.window.document = sandbox.document;
    vm.createContext(sandbox);
    vm.runInContext(pwaCode, sandbox);

    expect(sandbox.window.PwaManager.isStandalone).toBe(true);
    expect(registerSpy).toHaveBeenCalledWith('./sw.js', { scope: './' });
  });

  it('ensures sw.js offline fallback uses ignoreSearch and returns Response.error() instead of undefined', () => {
    const swCode = fs.readFileSync(path.join(rootDir, 'sw.js'), 'utf8');
    expect(swCode).toContain('ignoreSearch: true');
    expect(swCode).toContain('Response.error()');
  });
});
