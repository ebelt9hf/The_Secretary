import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Retrospective Header & Week Navigation Styling Parity', () => {
  const collabCss = fs.readFileSync(path.resolve(__dirname, '../../css/app-collab.css'), 'utf8');
  const plannerCss = fs.readFileSync(path.resolve(__dirname, '../../css/app-planner.css'), 'utf8');
  const translationsJs = fs.readFileSync(path.resolve(__dirname, '../../js/translations.js'), 'utf8');

  // Parse translations
  const fakeWindow = {};
  const transRunner = new Function('window', `
    ${translationsJs}
    return window.APP_TRANSLATIONS_BUNDLE.translations;
  `);
  const translationsObj = transRunner(fakeWindow);

  const supportedLanguages = [
    'cs', 'de', 'en', 'es', 'fr', 'hu', 'it', 'nl', 'pl', 'pt', 'ro', 'ru', 'sv', 'tr', 'uk'
  ];

  it('retro-week-title styling matches planner-week-title and removes misplaced drop-shadow', () => {
    // Extract retro-week-title rule
    const retroMatch = collabCss.match(/\.retro-week-title\s*\{([^}]+)\}/);
    expect(retroMatch).toBeTruthy();
    const retroRule = retroMatch[1];

    // Extract planner-week-title rule
    const plannerMatch = plannerCss.match(/\.planner-week-title\s*\{([^}]+)\}/);
    expect(plannerMatch).toBeTruthy();
    const plannerRule = plannerMatch[1];

    // Should not contain the old oversized 30px / 12px drop shadow
    expect(retroRule).not.toContain('0 12px 30px');

    expect(retroRule).toContain('box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);');
    expect(plannerRule).toContain('box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);');
    expect(retroRule).toContain('background: var(--card-bg);');
    expect(retroRule).toContain('border-radius: var(--radius-md, 8px);');
  });

  it('retro-nav-btn and retro-nav-group styling match planner-nav-btn and planner-nav-group', () => {
    const retroNavBtnMatch = collabCss.match(/\.retro-nav-btn\s*\{([^}]+)\}/);
    expect(retroNavBtnMatch).toBeTruthy();
    const retroNavBtnRule = retroNavBtnMatch[1];

    expect(retroNavBtnRule).toContain('border-radius: var(--radius-sm);');
    expect(retroNavBtnRule).toContain('font-size: 0.8rem;');
    expect(retroNavBtnRule).toContain('padding: 0.25rem 0.75rem;');

    const retroNavGroupMatch = collabCss.match(/\.retro-nav-group\s*\{([^}]+)\}/);
    expect(retroNavGroupMatch).toBeTruthy();
    const retroNavGroupRule = retroNavGroupMatch[1];
    expect(retroNavGroupRule).toContain('gap: 0.35rem;');
  });

  it('retro.prevWeek and retro.nextWeek translation keys omit "Week" across all 15 languages', () => {
    expect(translationsObj['retro.prevWeek']).toBeDefined();
    expect(translationsObj['retro.nextWeek']).toBeDefined();

    for (const lang of supportedLanguages) {
      const prevVal = translationsObj['retro.prevWeek'][lang];
      const nextVal = translationsObj['retro.nextWeek'][lang];

      expect(typeof prevVal).toBe('string');
      expect(typeof nextVal).toBe('string');
      expect(prevVal.trim().length).toBeGreaterThan(0);
      expect(nextVal.trim().length).toBeGreaterThan(0);

      // Verify chevrons exist
      expect(prevVal).toContain('‹');
      expect(nextVal).toContain('›');

      // Verify redundant week words are removed in key languages
      if (lang === 'en') {
        expect(prevVal).toBe('‹ Previous');
        expect(nextVal).toBe('Next ›');
      }
      if (lang === 'fr') {
        expect(prevVal).toBe('‹ Précédent');
        expect(nextVal).toBe('Suivant ›');
      }
      if (lang === 'de') {
        expect(prevVal).toBe('‹ Vorherige');
        expect(nextVal).toBe('Nächste ›');
      }
    }
  });
});
