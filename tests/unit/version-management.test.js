import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

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
});
