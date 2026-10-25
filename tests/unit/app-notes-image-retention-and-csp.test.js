import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Note Image Retention, Externalization & CSP Safeguards', () => {
  const rootDir = path.resolve(__dirname, '../../');
  let origFetch;

  beforeEach(() => {
    origFetch = globalThis.fetch;
    document.body.innerHTML = `
      <div id="note-edit-overlay">
        <div id="note-edit">
          <input id="edit-title" value="Test Note" />
          <input id="edit-date" value="2026-10-21" />
          <div id="edit-summary" contenteditable="true"></div>
          <div id="edit-textarea" contenteditable="true"></div>
        </div>
      </div>
    `;

    global.toast = vi.fn();
    global.t = (k) => k;

    loadScriptsIntoGlobal([
      'js/app-idb.js',
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

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  /**
   * 1. Protected Behavior: Confirms HTML CSP <meta> tags allow data: and blob: in connect-src.
   * 2. Regression Target: Accidental removal of data: or blob:, causing browser to block local fetch/streaming.
   * 3. Coverage Overlap / Redundancy: None; other CSP tests verify frame/script-src, not connect-src data/blob.
   * 4. Production Code Footprint: None; inspects production HTML <meta> tags.
   */
  it('connect-src in app.html, note-window.html, and secretary-window.html whitelists data: and blob:', () => {
    const htmlFiles = ['app.html', 'note-window.html', 'secretary-window.html'];
    for (const file of htmlFiles) {
      const fullPath = path.join(rootDir, file);
      expect(fs.existsSync(fullPath)).toBe(true);
      const content = fs.readFileSync(fullPath, 'utf8');

      // CSP connect-src must allow data: and blob: so local fetches and streaming do not get blocked
      expect(content).toMatch(/connect-src[^;]*\bdata:\s/);
      expect(content).toMatch(/connect-src[^;]*\bblob:\s/);
    }
  });

  /**
   * 1. Protected Behavior: Ensures _writeFileDirect uses atob/Uint8Array instead of fetch() to avoid CSP errors.
   * 2. Regression Target: Reverting to fetch('data:...') which throws TypeError under restrictive CSP.
   * 3. Coverage Overlap / Redundancy: None; only test validating CSP-safe binary conversion in filesystem layer.
   * 4. Production Code Footprint: None; validates production _writeFileDirect method.
   */
  it('_writeFileDirect converts data URLs to Blobs without calling fetch (CSP safe)', async () => {
    // Simulate browser CSP blocking fetch('data:...')
    globalThis.fetch = vi.fn().mockImplementation((url) => {
      if (typeof url === 'string' && url.startsWith('data:')) {
        return Promise.reject(new TypeError("Failed to fetch: CSP connect-src directive blocked 'data:'"));
      }
      return Promise.resolve(new Response('ok'));
    });

    let writtenData = null;
    let streamClosed = false;
    const mockWritable = {
      write: vi.fn(async (chunk) => {
        writtenData = chunk;
      }),
      close: vi.fn(async () => {
        streamClosed = true;
      }),
      abort: vi.fn()
    };

    const mockFileHandle = {
      createWritable: vi.fn(async () => mockWritable)
    };

    const mockDirHandle = {
      getFileHandle: vi.fn(async () => mockFileHandle)
    };

    globalThis.getOrCreateDirHandle = vi.fn(async () => mockDirHandle);
    globalThis.rootHandle = mockDirHandle;

    const sampleBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    
    // Should NOT throw, and should NOT invoke globalThis.fetch
    await _writeFileDirect('notes/_assets/img-test-csp.png', sampleBase64);

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(writtenData).toBeTruthy();
    expect(streamClosed).toBe(true);
  });

  /**
   * 1. Protected Behavior: Ensures duplicate/restored images with data-asset-path are still written to disk.
   * 2. Regression Target: Skipping writeAsset when data-asset-path exists, causing orphaned image links.
   * 3. Coverage Overlap / Redundancy: None; app-notes-image-paste tests initial paste without pre-existing path.
   * 4. Production Code Footprint: None; exercises production processAndExternalizeImages.
   */
  it('processAndExternalizeImages ensures assets with existing data-asset-path are written to StorageAPI', async () => {
    const writtenAssets = [];
    StorageAPI.writeAsset = vi.fn(async (relPath, dataUrl) => {
      writtenAssets.push({ relPath, dataUrl });
      return true;
    });

    const sampleBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const assetPath = 'notes/_assets/img-1792502973570-h26qq.png';
    const inputHtml = `<p>Test</p><img data-id="img-1" data-asset-path="${assetPath}" src="${sampleBase64}"><p>Done</p>`;

    const resultHtml = await processAndExternalizeImages(inputHtml);

    // StorageAPI.writeAsset MUST have been called so the asset is actually saved
    expect(writtenAssets.some(a => a.relPath === assetPath)).toBe(true);
    // Result HTML should now reference the asset path
    expect(resultHtml).toContain(`src="${assetPath}"`);
    expect(resultHtml).not.toContain(sampleBase64);
  });

  /**
   * 1. Protected Behavior: Zero data-loss guarantee; retains inline base64 in HTML if storage write fails.
   * 2. Regression Target: Swallowing writeAsset failure and stripping base64 data, causing permanent image loss.
   * 3. Coverage Overlap / Redundancy: None; unique failure resilience test for image externalization.
   * 4. Production Code Footprint: None.
   */
  it('processAndExternalizeImages retains inline data URL if storage write fails, preventing data loss', async () => {
    // Simulate storage failure (disk full or write error)
    StorageAPI.writeAsset = vi.fn(async () => {
      throw new Error('Disk write failed: No space left on device');
    });

    const sampleBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const inputHtml = `<p>Important diagram</p><img src="${sampleBase64}"><p>End</p>`;

    const resultHtml = await processAndExternalizeImages(inputHtml);

    // CRITICAL: Base64 data MUST be retained in the note so the user never loses their diagram!
    expect(resultHtml).toContain(sampleBase64);
  });

  /**
   * 1. Protected Behavior: Prevents browser 404 network requests by injecting SVG placeholder for missing assets.
   * 2. Regression Target: Leaving raw missing asset path in src, which triggers browser HTTP 404 error.
   * 3. Coverage Overlap / Redundancy: None; only test verifying missing image placeholder resolution.
   * 4. Production Code Footprint: None.
   */
  it('resolveNoteImages uses placeholder SVG when asset is missing to prevent 404 HTTP requests', async () => {
    StorageAPI.readAsset = vi.fn(async () => null);
    globalThis.readAssetAsDataUrl = vi.fn(async () => null);

    const assetPath = 'notes/_assets/img-missing.png';
    const inputHtml = `<p>Note content</p><img src="${assetPath}"><p>After</p>`;

    const resolvedHtml = await resolveNoteImages(inputHtml);

    // Must NOT keep raw src="notes/_assets/img-missing.png" which would fire a 404 network request
    expect(resolvedHtml).not.toContain(`src="${assetPath}"`);
    expect(resolvedHtml).toContain('data:image/svg+xml');
    expect(resolvedHtml).toContain(`data-pending-asset="${assetPath}"`);
  });

  /**
   * 1. Protected Behavior: Prevents overwriting real disk assets with placeholder SVG when saving a note.
   * 2. Regression Target: Overwriting valid disk assets with placeholder SVG or saving placeholder into note HTML.
   * 3. Coverage Overlap / Redundancy: None; critical anti-corruption protection for notes containing unloaded images.
   * 4. Production Code Footprint: None.
   */
  it('processAndExternalizeImages NEVER overwrites disk asset with placeholder SVG and restores asset path in HTML', async () => {
    const writtenAssets = [];
    StorageAPI.writeAsset = vi.fn(async (relPath, dataUrl) => {
      writtenAssets.push({ relPath, dataUrl });
      return true;
    });

    const realAssetPath = 'notes/_assets/critical-architecture-diagram.png';
    const rawSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150" viewBox="0 0 300 150"><rect width="300" height="150" fill="%231e1b4b" rx="8"/><text x="150" y="75" fill="%23a5b4fc" font-family="sans-serif" font-size="13" text-anchor="middle" dominant-baseline="middle">🖼️ [Image not loaded or locked]</text></svg>`;
    const placeholderSvg = `data:image/svg+xml;utf8,${encodeURIComponent(rawSvg)}`;
    const noteHtmlWithPlaceholder = `<p>Architecture:</p><img src="${placeholderSvg}" data-asset-path="${realAssetPath}" data-pending-asset="${realAssetPath}"><p>Notes continue</p>`;

    const savedHtml = await processAndExternalizeImages(noteHtmlWithPlaceholder);

    // 1. MUST NOT have attempted to write the placeholder SVG to storage!
    expect(writtenAssets.some(a => a.dataUrl.includes('data:image/svg+xml'))).toBe(false);
    expect(writtenAssets.some(a => a.relPath === realAssetPath)).toBe(false);

    // 2. Saved HTML must restore the original asset path, stripping the placeholder dataUrl and data-pending-asset
    expect(savedHtml).toContain(`src="${realAssetPath}"`);
    expect(savedHtml).not.toContain('data:image/svg+xml');
    expect(savedHtml).not.toContain('data-pending-asset');
  });

  /**
   * 1. Protected Behavior: Defense-in-depth storage guard; StorageAPI.writeAsset rejects placeholder SVGs.
   * 2. Regression Target: Regression in StorageAPI.writeAsset allowing placeholder SVG writes to corrupt disk/IDB.
   * 3. Coverage Overlap / Redundancy: Intentional defense-in-depth at storage API layer complementing editor layer.
   * 4. Production Code Footprint: None.
   */
  it('StorageAPI.writeAsset refuses to write placeholder SVGs to disk or IndexedDB', async () => {
    const putRecordSpy = vi.spyOn(VaultIDBStorage, 'putRecord');
    const realAssetPath = 'notes/_assets/my-diagram.png';
    const placeholderSvg = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"><text>🖼️ [Image not loaded or locked]</text></svg>`;

    await StorageAPI.writeAsset(realAssetPath, placeholderSvg);

    // Should NOT have called putRecord with placeholder
    const wasCalledWithPlaceholder = putRecordSpy.mock.calls.some(call => 
      call[0] === 'assets' && (String(call[1]?.data).includes('Image not loaded') || String(call[1]?.data).includes('locked'))
    );
    expect(wasCalledWithPlaceholder).toBe(false);
  });
});
