import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Note Editor Image Paste & Externalization (app-overlay.js)', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="note-edit-overlay">
        <div id="note-edit">
          <input id="edit-title" value="Test Note" />
          <input id="edit-date" value="2026-10-05" />
          <div id="edit-summary" contenteditable="true"></div>
          <div id="edit-textarea" contenteditable="true"><p>Initial text</p></div>
          <textarea id="nn-content"></textarea>
          <div id="edit-fields-collapsible">
            <div id="overlay-planner-blocks-row"></div>
          </div>
        </div>
      </div>
    `;

    global.toast = vi.fn();
    global.t = (k) => k;
    global.writeFile = vi.fn().mockResolvedValue(true);
    global.currentNote = {
      path: 'notes/test.html',
      title: 'Test Note',
      date: '2026-10-05',
      mainHTML: '<p>Initial text</p>',
      originalHTML: '<!DOCTYPE html><html><body><main><p>Initial text</p></main></body></html>'
    };

    loadScriptsIntoGlobal([
      'js/app-state.js',
      'js/app-utils.js',
      'js/app-fs.js',
      'js/app-storage.js',
      'js/app-image-optimizer.js',
      'js/app-overlay.js'
    ]);
  });

  it('inserts an img element into contenteditable editor on image paste', async () => {
    const editArea = document.getElementById('edit-textarea');
    expect(editArea).toBeTruthy();

    const sampleBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const blob = new Blob(['mock image data'], { type: 'image/png' });
    const file = new File([blob], 'test.png', { type: 'image/png' });

    // Mock FileReader to return sampleBase64
    const originalFileReader = global.FileReader;
    global.FileReader = class {
      readAsDataURL() {
        setTimeout(() => {
          this.result = sampleBase64;
          if (this.onload) this.onload();
        }, 5);
      }
    };

    const pasteEvent = {
      preventDefault: vi.fn(),
      clipboardData: {
        items: [
          {
            type: 'image/png',
            getAsFile: () => file
          }
        ]
      },
      currentTarget: editArea,
      target: editArea
    };

    window.handleImagePaste(pasteEvent);

    await new Promise(r => setTimeout(r, 20));

    const imgs = editArea.querySelectorAll('img');
    expect(imgs.length).toBe(1);
    expect(imgs[0].src).toBe(sampleBase64);
    expect(imgs[0].dataset.assetPath).toContain('notes/_assets/img-');
    expect(imgs[0].dataset.id).toBeTruthy();

    global.FileReader = originalFileReader;
  });

  it('inserts img tag string into textarea element (nn-content) on image paste', async () => {
    const nnContent = document.getElementById('nn-content');
    nnContent.value = 'Existing memo';
    nnContent.selectionStart = nnContent.selectionEnd = nnContent.value.length;

    const sampleBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const blob = new Blob(['mock image data'], { type: 'image/png' });
    const file = new File([blob], 'test.png', { type: 'image/png' });

    const originalFileReader = global.FileReader;
    global.FileReader = class {
      readAsDataURL() {
        setTimeout(() => {
          this.result = sampleBase64;
          if (this.onload) this.onload();
        }, 5);
      }
    };

    const pasteEvent = {
      preventDefault: vi.fn(),
      clipboardData: {
        items: [
          {
            type: 'image/png',
            getAsFile: () => file
          }
        ]
      },
      currentTarget: nnContent,
      target: nnContent
    };

    window.handleImagePaste(pasteEvent);

    await new Promise(r => setTimeout(r, 20));

    expect(nnContent.value).toContain('<img data-id=');
    expect(nnContent.value).toContain('data-asset-path="notes/_assets/img-');
    expect(nnContent.value).toContain(`src="${sampleBase64}"`);

    global.FileReader = originalFileReader;
  });

  it('processAndExternalizeImages externalizes data URLs and resolves them via resolveNoteImagesSync and resolveNoteImages', async () => {
    const sampleBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const rawHtml = `<p>Note content</p><img data-id="img-1" src="${sampleBase64}" style="width:600px">`;

    const externalized = await window.processAndExternalizeImages(rawHtml);
    expect(externalized).toContain('src="notes/_assets/img_');
    expect(externalized).not.toContain(sampleBase64);

    // Sync resolution should replace relative asset path with cached dataUrl
    const syncResolved = window.resolveNoteImagesSync(externalized);
    expect(syncResolved).toContain(`src="${sampleBase64}"`);

    // Async resolution
    const asyncResolved = await window.resolveNoteImages(externalized);
    expect(asyncResolved).toContain(`src="${sampleBase64}"`);
  });
});
