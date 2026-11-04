import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { Window } from 'happy-dom';

describe('Modal DOM Hierarchy & Tag Parity (tests/unit/app-modal-dom-hierarchy.test.js)', () => {
  function getProcessedAppHtml() {
    const rootDir = process.cwd();
    let appHtml = fs.readFileSync(path.join(rootDir, 'app.html'), 'utf-8');
    const includeRegex = /<include\s+src=["']([^"']+)["']\s*(?:\/>|><\/include>)/g;

    appHtml = appHtml.replace(includeRegex, (match, src) => {
      const filePath = path.join(rootDir, src);
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf-8');
      }
      return match;
    });
    return appHtml;
  }

  it('ensures modals are not nested inside #screen-main so they remain visible on initial screens', () => {
    const fullHtml = getProcessedAppHtml();
    const window = new Window();
    window.document.write(fullHtml);

    const screenMain = window.document.getElementById('screen-main');
    const setupModal = window.document.getElementById('modal-cloud-sync-setup');
    const unlockModal = window.document.getElementById('modal-cloud-sync-unlock');

    expect(screenMain).not.toBeNull();
    expect(setupModal).not.toBeNull();
    expect(unlockModal).not.toBeNull();

    // The modals must be top-level overlays under body, NOT inside screen-main which has display:none on landing screens
    expect(screenMain.contains(setupModal)).toBe(false);
    expect(screenMain.contains(unlockModal)).toBe(false);
  });

  it('ensures templates/modals.html has balanced div tags with no stray extra closing tags', () => {
    const modalsHtml = fs.readFileSync(path.join(process.cwd(), 'templates/modals.html'), 'utf-8');
    const lines = modalsHtml.split('\n');
    const stack = [];
    const extraClosing = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const regex = /<\/?div\b([^>]*)>/gi;
      let m;
      while ((m = regex.exec(line)) !== null) {
        if (m[0].startsWith('</')) {
          if (stack.length === 0) {
            extraClosing.push({ line: i + 1, content: line.trim() });
          } else {
            stack.pop();
          }
        } else if (!m[0].endsWith('/>')) {
          stack.push(i + 1);
        }
      }
    }

    expect(extraClosing).toEqual([]);
    expect(stack).toEqual([]);
  });

  it('ensures app.html has balanced div tags with no unclosed opening tags', () => {
    const appHtml = fs.readFileSync(path.join(process.cwd(), 'app.html'), 'utf-8');
    const lines = appHtml.split('\n');
    const stack = [];
    const extraClosing = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const regex = /<\/?div\b([^>]*)>/gi;
      let m;
      while ((m = regex.exec(line)) !== null) {
        if (m[0].startsWith('</')) {
          if (stack.length === 0) {
            extraClosing.push({ line: i + 1, content: line.trim() });
          } else {
            stack.pop();
          }
        } else if (!m[0].endsWith('/>')) {
          const idM = m[1].match(/id=[\"']([^\"']+)[\"']/);
          stack.push({ line: i + 1, id: idM ? idM[1] : null });
        }
      }
    }

    expect(extraClosing).toEqual([]);
    expect(stack).toEqual([]);
  });

  it('ensures every <label> in app.html and included templates is associated with a labelable form control', () => {
    const fullHtml = getProcessedAppHtml();
    const window = new Window();
    window.document.write(fullHtml);

    const labelableTags = new Set(['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'METER', 'OUTPUT', 'PROGRESS']);
    const labels = Array.from(window.document.querySelectorAll('label'));
    const unassociated = [];

    for (const label of labels) {
      const forAttr = label.getAttribute('for');
      const nestedControl = label.querySelector('input, select, textarea, button, meter, output, progress');
      if (forAttr) {
        const target = window.document.getElementById(forAttr);
        if (!target || !labelableTags.has(target.tagName.toUpperCase())) {
          unassociated.push(`for="${forAttr}" -> ${target ? target.tagName : 'MISSING'}`);
        }
      } else if (!nestedControl) {
        unassociated.push(label.outerHTML.replace(/\s+/g, ' ').slice(0, 80));
      }
    }

    expect(unassociated).toEqual([]);
  });

  it('ensures dynamic JS <label> markup always specifies a for attribute or wraps a form control', () => {
    const jsFiles = [
      'js/app-board.js',
      'js/app-collab.js',
      'js/app-dailyreview.js',
      'js/app-planner.js',
      'js/app-tutorial.js'
    ];
    const invalidLabels = [];

    for (const relPath of jsFiles) {
      const content = fs.readFileSync(path.join(process.cwd(), relPath), 'utf-8');
      const regex = /<label\b([^>]*)>([\s\S]*?)<\/label>/gi;
      let m;
      while ((m = regex.exec(content)) !== null) {
        const attrs = m[1];
        const inner = m[2];
        const hasFor = /\bfor\s*=\s*["'][^"']+["']/i.test(attrs);
        const hasControl = /<(input|select|textarea)\b/i.test(inner);
        const hasNonFormTarget = /\bfor\s*=\s*["']ws-dossier-summary["']/i.test(attrs);
        if (hasNonFormTarget || (!hasFor && !hasControl)) {
          const line = content.slice(0, m.index).split('\n').length;
          invalidLabels.push(`${relPath}:${line}`);
        }
      }
    }

    expect(invalidLabels).toEqual([]);
  });
});
