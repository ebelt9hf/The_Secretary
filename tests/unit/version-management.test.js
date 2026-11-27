import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../../');

describe('Version Management and Main Branch Parity', () => {
  it('verifies bump_version.py --check passes cleanly', () => {
    const output = execSync('python3 development/bump_version.py --check', {
      cwd: ROOT,
      encoding: 'utf-8'
    });
    expect(output).toContain('All files consistent with version');
  });

  it('ensures package.json, package-lock.json, and app.html have identical version numbers', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const pkgLock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
    const appHtml = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8');

    const expectedVersion = pkg.version;
    expect(expectedVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkgLock.version).toBe(expectedVersion);
    expect(pkgLock.packages[''].version).toBe(expectedVersion);

    // Landing hint element in app.html
    const hintMatch = appHtml.match(/id="connect-version-hint"\s+data-version="([^"]+)"/);
    expect(hintMatch).not.toBeNull();
    expect(hintMatch[1]).toBe(expectedVersion);

    // Cache-busting queries in app.html
    const cacheBusters = [...appHtml.matchAll(/\?v=([0-9]+\.[0-9]+\.[0-9]+)/g)].map(m => m[1]);
    expect(cacheBusters.length).toBeGreaterThan(0);
    const staleTags = cacheBusters.filter(v => v !== expectedVersion);
    expect(staleTags).toEqual([]);
  });

  it('ensures .githooks/pre-commit exists and is executable', () => {
    const hookPath = path.join(ROOT, '.githooks/pre-commit');
    expect(fs.existsSync(hookPath)).toBe(true);

    const stat = fs.statSync(hookPath);
    // Bit 0o111 means executable
    expect((stat.mode & 0o111) !== 0).toBe(true);

    const hookContent = fs.readFileSync(hookPath, 'utf8');
    expect(hookContent).toContain('bump_version.py');
    expect(hookContent).toContain('CURRENT_BRANCH');
  });

  it('ensures package.json exposes version verification and bump scripts', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts['check:version']).toBeDefined();
    expect(pkg.scripts['bump:patch']).toBeDefined();
    expect(pkg.scripts['test']).toContain('npm run check:version');
  });

  it('includes an About section in settings and populates version in switchPrefsTab', () => {
    const appHtml = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8');
    expect(appHtml).toContain('id="prefs-sec-about"');
    expect(appHtml).toContain('id="prefs-about-version"');

    document.body.innerHTML = `
      <span id="connect-version-hint" data-version="4.0.101">Version 4.0.101</span>
      <button class="prefs-tab-btn" data-tab="general"></button>
      <button class="prefs-tab-btn" data-tab="system"></button>
      <div id="prefs-sec-about" style="display:none">
        <span id="prefs-about-version"></span>
      </div>
    `;
    globalThis.t = globalThis.t || ((k) => k);
    globalThis.normalizeLanguageCode = globalThis.normalizeLanguageCode || ((c) => c || 'en');
    loadScriptsIntoGlobal([
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-utils.js',
      'js/app-fs.js',
      'js/app-state.js',
      'js/app-bridge.js',
      'js/app-init.js'
    ]);

    window.switchPrefsTab('system');
    expect(document.getElementById('prefs-sec-about').style.display).toBe('block');
    expect(document.getElementById('prefs-about-version').textContent).toBe('4.0.101');

    window.switchPrefsTab('general');
    expect(document.getElementById('prefs-sec-about').style.display).toBe('none');
  });
});
