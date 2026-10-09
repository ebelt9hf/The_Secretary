import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Note Editor Format Bar & Context Menu Resolution', () => {
  beforeAll(() => {
    loadScriptsIntoGlobal([
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-utils.js',
      'js/app-notes.js',
      'js/app-overlay.js'
    ]);
  });

  it('ensures .edit-toolbar does NOT have flex: 1 causing half-screen expansion', () => {
    const cssPath = path.resolve(__dirname, '../../css/app-editor.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');

    // Extract standalone .edit-toolbar declaration blocks
    const editToolbarMatches = [...cssContent.matchAll(/(?:^|\n)\.edit-toolbar\s*\{([^}]+)\}/g)];
    expect(editToolbarMatches.length).toBeGreaterThan(0);

    for (const match of editToolbarMatches) {
      const block = match[1];
      // It should NOT have standalone `flex: 1;` which causes 50% vertical height allocation
      expect(block).not.toMatch(/\bflex:\s*1\s*;/);
      // It should specify flex: 0 0 auto
      expect(block).toMatch(/flex:\s*0\s+0\s+auto/);
    }
  });

  it('ensures edit-textarea does not intercept contextmenu so native Copy/Paste is available', () => {
    const jsPath = path.resolve(__dirname, '../../js/app-overlay.js');
    const jsContent = fs.readFileSync(jsPath, 'utf8');

    // edit-textarea should not have a contextmenu listener that calls showEditorContextMenu
    const hasEditTaContextMenu = /document\.getElementById\(['"]edit-textarea['"]\)\?\.addEventListener\(['"]contextmenu['"]/.test(jsContent);
    expect(hasEditTaContextMenu).toBe(false);
  });

  it('ensures selection floating toolbar includes all formats (checklist, blockquote, etc.) with localized tooltips', async () => {
    const jsPath = path.resolve(__dirname, '../../js/app-overlay.js');
    const jsContent = fs.readFileSync(jsPath, 'utf8');

    // Check that showFloatingFormatToolbarForSelection includes checklist and blockquote
    expect(jsContent).toMatch(/formatRichTextInEditor\(targetEditor,\s*['"]checklist['"]\)/);
    expect(jsContent).toMatch(/formatRichTextInEditor\(targetEditor,\s*['"]blockquote['"]\)/);
  });

  it('renders floating selection format toolbar with valid titles and action buttons when selection exists', () => {
    document.body.innerHTML = `
      <div id="edit-textarea" contenteditable="true">
        <p id="test-paragraph">Selected text content for formatting</p>
      </div>
    `;

    const editor = document.getElementById('edit-textarea');
    const p = document.getElementById('test-paragraph');

    // Create a mock selection in the editor
    const range = document.createRange();
    range.selectNodeContents(p);
    // In jsdom layout rects default to 0x0; mock bounding rect for test
    range.getBoundingClientRect = () => ({ width: 120, height: 20, top: 50, left: 50, bottom: 70, right: 170 });
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    showFloatingFormatToolbarForSelection(editor);

    const toolbar = document.querySelector('.floating-format-toolbar');
    expect(toolbar).not.toBeNull();

    const buttons = toolbar.querySelectorAll('.floating-fmt-btn');
    expect(buttons.length).toBeGreaterThanOrEqual(16);

    // Verify all buttons have localized title attributes
    buttons.forEach(btn => {
      expect(btn.getAttribute('title')).toBeTruthy();
      expect(btn.getAttribute('aria-label')).toBeTruthy();
    });

    // Check presence of specific action buttons
    const titles = Array.from(buttons).map(b => b.title);
    expect(titles.some(t => /checklist/i.test(t) || /liste/i.test(t))).toBe(true);
    expect(titles.some(t => /quote|citation/i.test(t))).toBe(true);
    expect(titles.some(t => /bold|gras/i.test(t))).toBe(true);
    expect(titles.some(t => /italic|italique/i.test(t))).toBe(true);
    expect(titles.some(t => /clear|effacer|nettoyer/i.test(t))).toBe(true);

    hideFloatingFormatToolbar();
  });
});
