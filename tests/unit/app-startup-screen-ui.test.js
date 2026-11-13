import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Unit Tests: Startup Screen Centering, Focused Layout & Early Theme Application
 *
 * 4-Point Audit:
 * 1. Protected Behavior:
 *    - #screen-connect centers #screen-connect-card vertically and horizontally (including <=750px viewport height).
 *    - #landing-step-welcome omits redundant .landing-badge and .landing-features clutter while keeping #connect-version-hint.
 *    - app.html declares <meta name="color-scheme" content="light dark"> and applies stored theme synchronously in <head> before first paint.
 *    - css/app-base.css maps meta[name="color-scheme"] on :root and defines dark tokens on :root[data-theme='dark'].
 * 2. Regression Target:
 *    - Fails if #screen-connect reverts to flex-start or margin: 0.25rem auto pins the card to the top, if redundant pills return, or if FOUC prevention is removed.
 * 3. Coverage Overlap & Redundancy:
 *    - Distinct from app-landing-onboarding-flow.test.js (which tests step navigation & actions).
 * 4. Production Code Footprint:
 *    - Zero test-only code; inspects authentic app.html and css/app-base.css.
 */
describe('Startup Screen UI: Centering, Focus & Smooth Theme Application', () => {
  const rootDir = path.resolve(process.cwd());
  const appHtml = fs.readFileSync(path.join(rootDir, 'app.html'), 'utf8');
  const appBaseCss = fs.readFileSync(path.join(rootDir, 'css/app-base.css'), 'utf8');

  it('centers #screen-connect-card vertically and does not pin it to the top at max-height: 750px', () => {
    const connectBlockMatch = appBaseCss.match(/#screen-connect\s*\{[\s\S]*?\}/);
    expect(connectBlockMatch).not.toBeNull();
    expect(connectBlockMatch[0]).toMatch(/justify-content:\s*safe center/);
    expect(connectBlockMatch[0]).toMatch(/align-items:\s*center/);

    const maxH750Match = appBaseCss.match(/@media\s*\(max-height:\s*750px\)\s*\{[\s\S]*?#screen-connect-card\s*\{[\s\S]*?\}/);
    expect(maxH750Match).not.toBeNull();
    expect(maxH750Match[0]).toMatch(/margin:\s*auto;/);
    expect(maxH750Match[0]).not.toMatch(/margin:\s*0\.25rem\s+auto/);
  });

  it('keeps #landing-step-welcome focused without redundant badge or feature pill clutter', () => {
    const welcomeStart = appHtml.indexOf('<div id="landing-step-welcome"');
    const setupStart = appHtml.indexOf('<div id="landing-step-setup"');
    expect(welcomeStart).toBeGreaterThan(-1);
    expect(setupStart).toBeGreaterThan(welcomeStart);
    const welcomeHtml = appHtml.slice(welcomeStart, setupStart);

    expect(welcomeHtml).not.toContain('class="landing-badge"');
    expect(welcomeHtml).not.toContain('class="landing-features"');
    expect(welcomeHtml).toContain('id="connect-version-hint"');
  });

  it('declares color-scheme meta and applies stored theme synchronously in <head> to prevent FOUC', () => {
    const headEnd = appHtml.indexOf('</head>');
    const headHtml = appHtml.slice(0, headEnd);

    expect(headHtml).toContain('<meta name="color-scheme" content="light dark">');
    expect(headHtml).toContain("localStorage.getItem('secretaryLocalSettings')");
    expect(headHtml).toContain("document.documentElement.setAttribute('data-theme'");
    expect(appBaseCss).toContain(':root[data-theme=\'dark\']');
    expect(appBaseCss).toContain('meta[name="color-scheme"][content="dark"]');
  });
});

