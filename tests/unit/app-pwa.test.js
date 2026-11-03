import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Progressive Web App (PWA) Implementation (tests/unit/app-pwa.test.js)', () => {
  beforeAll(() => {
    globalThis.window = globalThis.window || {};
    globalThis.t = (key) => key;
    globalThis.showToast = vi.fn();

    loadScriptsIntoGlobal([
      'js/app-bridge.js',
      'js/app-pwa.js'
    ]);
  });

  beforeEach(() => {
    document.body.innerHTML = `
      <button id="btn-install-app" style="display:none;"></button>
      <button id="btn-landing-install" style="display:none;"></button>
      <button id="btn-prefs-pwa-install" style="display:none;"></button>
      <span id="prefs-pwa-installed-status" style="display:none;"></span>
    `;

    // Reset PwaManager state
    window.AppBridge.isElectron = false;
    window.PwaManager.setDeferredPrompt(null);
  });

  it('validates manifest.webmanifest syntax, structure, and required PWA fields', () => {
    const manifestPath = path.resolve(__dirname, '../../manifest.webmanifest');
    expect(fs.existsSync(manifestPath)).toBe(true);

    const raw = fs.readFileSync(manifestPath, 'utf-8');
    const manifest = JSON.parse(raw);

    expect(manifest.name).toBe('Secretary');
    expect(manifest.short_name).toBe('Secretary');
    expect(manifest.start_url).toBe('./app.html');
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toBe('#1e1b4b');
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);

    const icon192 = manifest.icons.find((i) => i.sizes === '192x192');
    const icon512 = manifest.icons.find((i) => i.sizes === '512x512');
    expect(icon192).toBeDefined();
    expect(icon512).toBeDefined();
  });

  it('verifies app.html contains link to manifest.webmanifest and theme-color meta tags', () => {
    const appHtmlPath = path.resolve(__dirname, '../../app.html');
    const appHtml = fs.readFileSync(appHtmlPath, 'utf-8');

    expect(appHtml).toContain('<link rel="manifest" href="manifest.webmanifest">');
    expect(appHtml).toContain('<meta name="theme-color" content="#1e1b4b">');
    expect(appHtml).toContain('<link rel="apple-touch-icon" href="icon-192.png">');
    expect(appHtml).toContain('id="btn-install-app"');
    expect(appHtml).toContain('id="btn-landing-install"');
    expect(appHtml).toContain('id="btn-prefs-pwa-install"');
    expect(appHtml).toContain('js/app-pwa.js');
  });

  it('verifies sw.js exists and defines install and fetch event listeners', () => {
    const swPath = path.resolve(__dirname, '../../sw.js');
    expect(fs.existsSync(swPath)).toBe(true);

    const swContent = fs.readFileSync(swPath, 'utf-8');
    expect(swContent).toContain("addEventListener('install'");
    expect(swContent).toContain("addEventListener('fetch'");
    expect(swContent).toContain("addEventListener('activate'");
  });

  it('disables PWA installability and hides buttons when running inside Electron', () => {
    window.AppBridge.isElectron = true;

    // Simulate deferredPrompt available
    const mockPrompt = {
      preventDefault: vi.fn(),
      prompt: vi.fn(),
      userChoice: Promise.resolve({ outcome: 'accepted' })
    };
    window.PwaManager.setDeferredPrompt(mockPrompt);

    expect(window.PwaManager.isInstallable()).toBe(false);
    expect(document.getElementById('btn-install-app').style.display).toBe('none');
    expect(document.getElementById('btn-landing-install').style.display).toBe('none');
  });

  it('shows install buttons when a beforeinstallprompt event is captured in browser', () => {
    window.AppBridge.isElectron = false;

    const mockPrompt = {
      preventDefault: vi.fn(),
      prompt: vi.fn(),
      userChoice: Promise.resolve({ outcome: 'accepted' })
    };

    window.PwaManager.setDeferredPrompt(mockPrompt);

    expect(window.PwaManager.isInstallable()).toBe(true);
    expect(window.PwaManager.canPrompt).toBe(true);

    const topbarBtn = document.getElementById('btn-install-app');
    const landingBtn = document.getElementById('btn-landing-install');
    const prefsBtn = document.getElementById('btn-prefs-pwa-install');

    expect(topbarBtn.style.display).toBe('inline-flex');
    expect(landingBtn.style.display).toBe('inline-flex');
    expect(prefsBtn.style.display).toBe('inline-flex');
  });

  it('invokes deferredPrompt.prompt() and hides buttons on successful installation', async () => {
    window.AppBridge.isElectron = false;

    const promptSpy = vi.fn();
    const mockPrompt = {
      preventDefault: vi.fn(),
      prompt: promptSpy,
      userChoice: Promise.resolve({ outcome: 'accepted' })
    };

    window.PwaManager.setDeferredPrompt(mockPrompt);
    expect(window.PwaManager.canPrompt).toBe(true);

    const result = await window.PwaManager.promptInstall();

    expect(promptSpy).toHaveBeenCalledTimes(1);
    expect(result.outcome).toBe('accepted');
    expect(window.PwaManager.canPrompt).toBe(false);
    expect(document.getElementById('btn-install-app').style.display).toBe('none');
  });

  it('handles appinstalled event by resetting prompt and hiding buttons', () => {
    window.AppBridge.isElectron = false;
    const mockPrompt = { prompt: vi.fn(), userChoice: Promise.resolve({}) };
    window.PwaManager.setDeferredPrompt(mockPrompt);

    expect(document.getElementById('btn-install-app').style.display).toBe('inline-flex');

    // Trigger appinstalled window event
    window.dispatchEvent(new Event('appinstalled'));

    expect(window.PwaManager.canPrompt).toBe(false);
    expect(document.getElementById('btn-install-app').style.display).toBe('none');
  });

  it('ensures dist/app.html references root manifest.webmanifest to prevent Chrome start_url 404 in assets directory', () => {
    const distHtmlPath = path.resolve(__dirname, '../../dist/app.html');
    if (!fs.existsSync(distHtmlPath)) {
      return; // Skip if dist hasn't been built yet
    }
    const distHtml = fs.readFileSync(distHtmlPath, 'utf-8');

    // Regression check: Vite bundling manifest into assets/ causes Chrome to resolve start_url ("./app.html")
    // relative to manifest URL, requesting "/assets/app.html" which 404s and aborts PWA installation.
    expect(distHtml).not.toMatch(/href=["']\.\/assets\/manifest-[^"']+\.webmanifest["']/);
    expect(distHtml).toMatch(/<link\s+rel=["']manifest["']\s+href=["']\.\/manifest\.webmanifest["']/);
  });

  it('ensures sw.js CACHE_NAME matches package.json version and precaches root shell assets', () => {
    const swPath = path.resolve(__dirname, '../../sw.js');
    const pkgPath = path.resolve(__dirname, '../../package.json');
    const swContent = fs.readFileSync(swPath, 'utf-8');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

    expect(swContent).toContain(`secretary-pwa-v${pkg.version}`);
    expect(swContent).toContain("'./app.html'");
    expect(swContent).toContain("'./manifest.webmanifest'");
  });

  it('ensures sw.js fetch logic provides fallback when server returns 404 for app.html', () => {
    const swPath = path.resolve(__dirname, '../../sw.js');
    const swContent = fs.readFileSync(swPath, 'utf-8');

    // sw.js must handle 404 responses for app shell and fall back to cached app.html
    expect(swContent).toMatch(/response\.status === 404[\s\S]*app\.html/);
  });
});
