import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../');

describe('Perfect Note Modal Window Boundaries & Responsive Layout', () => {
  it('ensures modal-refactor-proposals in templates/modals.html does not hardcode full screen 100vw/100vh', () => {
    const modalsHtml = fs.readFileSync(path.join(rootDir, 'templates/modals.html'), 'utf-8');
    const modalRefactorProposalsMatch = modalsHtml.match(/<div class="modal-overlay"[^>]*id="modal-refactor-proposals"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/);
    expect(modalRefactorProposalsMatch).toBeTruthy();

    const snippet = modalRefactorProposalsMatch[0];
    expect(snippet).not.toContain('width: 100vw; max-width: 100vw; height: 100vh; max-height: 100vh');
    expect(snippet).not.toContain('border-radius: 0; border: none; box-shadow: none');
    expect(snippet).toContain('max-width: 94vw');
    expect(snippet).toContain('max-height: 90vh');
  });

  it('ensures css/app-dailyreview.css does not force full-screen 100vw/100vh on modal-refactor-proposals', () => {
    const dailyReviewCss = fs.readFileSync(path.join(rootDir, 'css/app-dailyreview.css'), 'utf-8');
    
    // Look for #modal-refactor-proposals.modal-overlay or .refactor-proposals-modal
    expect(dailyReviewCss).not.toMatch(/#modal-refactor-proposals\.modal-overlay\s*\{[^}]*width:\s*100vw\s*!important/);
    expect(dailyReviewCss).not.toMatch(/#modal-refactor-proposals\.modal-overlay\s*\{[^}]*height:\s*100vh\s*!important/);
    expect(dailyReviewCss).not.toMatch(/\.refactor-proposals-modal[^}]*\{[^}]*width:\s*100vw\s*!important/);
    expect(dailyReviewCss).not.toMatch(/\.refactor-proposals-modal[^}]*\{[^}]*height:\s*100vh\s*!important/);
  });
});
