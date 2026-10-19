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

    if (globalThis._savedAssetPaths) globalThis._savedAssetPaths.clear();
    if (globalThis._assetDataUrlCache) globalThis._assetDataUrlCache.clear();
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

  it('allows adding an image twice at cursor while saving asset to storage only once', async () => {
    const editArea = document.getElementById('edit-textarea');
    editArea.innerHTML = '<p>First paragraph</p><p>Second paragraph</p>';
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

    let writeCallCount = 0;
    const origWriteAsset = StorageAPI.writeAsset;
    StorageAPI.writeAsset = vi.fn().mockImplementation(() => {
      writeCallCount++;
      return Promise.resolve(true);
    });

    const pasteEvent1 = {
      preventDefault: vi.fn(),
      clipboardData: {
        items: [{ type: 'image/png', getAsFile: () => file }]
      },
      currentTarget: editArea,
      target: editArea
    };

    window.handleImagePaste(pasteEvent1);
    await new Promise(r => setTimeout(r, 20));

    const imgs1 = editArea.querySelectorAll('img');
    expect(imgs1.length).toBe(1);
    expect(writeCallCount).toBe(1);
    const assetPath1 = imgs1[0].dataset.assetPath;
    const id1 = imgs1[0].dataset.id;

    // Paste identical image again (e.g. duplicating or pasting at cursor)
    const pasteEvent2 = {
      preventDefault: vi.fn(),
      clipboardData: {
        items: [{ type: 'image/png', getAsFile: () => file }]
      },
      currentTarget: editArea,
      target: editArea
    };

    window.handleImagePaste(pasteEvent2);
    await new Promise(r => setTimeout(r, 20));

    const imgs2 = editArea.querySelectorAll('img');
    expect(imgs2.length).toBe(2);
    // Did NOT upload twice
    expect(writeCallCount).toBe(1);
    // Both point to identical asset path
    expect(imgs2[0].dataset.assetPath).toBe(assetPath1);
    expect(imgs2[1].dataset.assetPath).toBe(assetPath1);
    // Each instance has its own unique data-id
    expect(imgs2[1].dataset.id).not.toBe(id1);

    StorageAPI.writeAsset = origWriteAsset;
    global.FileReader = originalFileReader;
  });

  it('selectEditorImage selects image in DOM selection and copy event writes HTML and plain text', () => {
    const editArea = document.getElementById('edit-textarea');
    const img = document.createElement('img');
    img.src = 'data:image/png;base64,mockImageData111';
    img.dataset.id = 'img-test-123';
    img.dataset.assetPath = 'notes/_assets/img-test-123.png';
    img.style.width = '450px';
    editArea.appendChild(img);

    window.selectEditorImage(img, editArea);

    const clipboardDataStore = {};
    const fakeClipboard = {
      setData: vi.fn((type, val) => {
        clipboardDataStore[type] = val;
      })
    };

    const copyEvent = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(copyEvent, 'clipboardData', {
      value: fakeClipboard,
      configurable: true
    });
    document.dispatchEvent(copyEvent);

    expect(clipboardDataStore['text/html']).toContain('data-asset-path="notes/_assets/img-test-123.png"');
    expect(clipboardDataStore['text/html']).toContain('data:image/png;base64,mockImageData111');
    expect(clipboardDataStore['text/plain']).toBe('data:image/png;base64,mockImageData111');

    window.hideImageActiveOverlay();
  });

  it('cut event on active editor image copies data and removes element from editor', () => {
    const editArea = document.getElementById('edit-textarea');
    const img = document.createElement('img');
    img.src = 'data:image/png;base64,mockCutImageData';
    img.dataset.id = 'img-test-cut';
    img.dataset.assetPath = 'notes/_assets/img-cut.png';
    editArea.appendChild(img);

    window.selectEditorImage(img, editArea);

    const clipboardDataStore = {};
    const cutEvent = new Event('cut', { bubbles: true, cancelable: true });
    Object.defineProperty(cutEvent, 'clipboardData', {
      value: {
        setData: vi.fn((type, val) => {
          clipboardDataStore[type] = val;
        })
      },
      configurable: true
    });

    document.dispatchEvent(cutEvent);

    expect(clipboardDataStore['text/html']).toContain('data-asset-path="notes/_assets/img-cut.png"');
    expect(editArea.contains(img)).toBe(false);

    window.hideImageActiveOverlay();
  });

  it('handleImageDrop allows dropping identical image without re-uploading', async () => {
    const editArea = document.getElementById('edit-textarea');
    const sampleBase64 = 'data:image/png;base64,mockDropData';
    const blob = new Blob(['mock drop'], { type: 'image/png' });
    const file = new File([blob], 'drop.png', { type: 'image/png' });

    const originalFileReader = global.FileReader;
    global.FileReader = class {
      readAsDataURL() {
        setTimeout(() => {
          this.result = sampleBase64;
          if (this.onload) this.onload();
        }, 5);
      }
    };

    let writeCount = 0;
    const origWriteAsset = StorageAPI.writeAsset;
    StorageAPI.writeAsset = vi.fn().mockImplementation(() => {
      writeCount++;
      return Promise.resolve(true);
    });

    const dropEvent1 = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: { files: [file] },
      currentTarget: editArea,
      target: editArea
    };

    window.handleImageDrop(dropEvent1);
    await new Promise(r => setTimeout(r, 20));

    expect(editArea.querySelectorAll('img').length).toBe(1);
    expect(writeCount).toBe(1);

    // Drop second time
    const dropEvent2 = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: { files: [file] },
      currentTarget: editArea,
      target: editArea
    };

    window.handleImageDrop(dropEvent2);
    await new Promise(r => setTimeout(r, 20));

    expect(editArea.querySelectorAll('img').length).toBe(2);
    // Did not re-upload
    expect(writeCount).toBe(1);

    StorageAPI.writeAsset = origWriteAsset;
    global.FileReader = originalFileReader;
  });
});

