import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Storage Logic & Image Saving Engine Quality Verification', () => {
  let emittedEvents = [];
  let unsubscribeEvent = null;

  beforeEach(() => {
    emittedEvents = [];
    document.body.innerHTML = `
      <div id="note-edit-overlay">
        <div id="note-edit">
          <input id="edit-title" value="Test Note" />
          <input id="edit-date" value="2026-11-06" />
          <div id="edit-summary" contenteditable="true"></div>
          <div id="edit-textarea" contenteditable="true"></div>
          <div class="active-image-toolbar" style="display:none;">
            <button class="img-quality-btn" data-quality="standard">Standard</button>
            <button class="img-quality-btn" data-quality="high">High</button>
            <button class="img-quality-btn" data-quality="original">Original</button>
          </div>
        </div>
      </div>
    `;

    loadScriptsIntoGlobal([
      'js/app-idb.js',
      'js/app-fs.js',
      'js/app-image-optimizer.js',
      'js/app-storage.js',
      'js/app-overlay.js'
    ]);

    globalThis.toast = vi.fn();
    globalThis.t = (k) => k;
    globalThis.writeFile = vi.fn().mockResolvedValue(true);
    window.writeFile = globalThis.writeFile;
    globalThis.deleteFile = vi.fn().mockResolvedValue(true);
    window.deleteFile = globalThis.deleteFile;
    globalThis.readFile = vi.fn().mockResolvedValue('');
    window.readFile = globalThis.readFile;

    if (window.StorageAPI?.on) {
      unsubscribeEvent = window.StorageAPI.on('storage:change', (eventData) => {
        emittedEvents.push(eventData);
      });
    }

    if (globalThis._savedAssetPaths) globalThis._savedAssetPaths.clear();
    if (globalThis._assetDataUrlCache) globalThis._assetDataUrlCache.clear();
  });

  afterEach(() => {
    if (typeof unsubscribeEvent === 'function') {
      unsubscribeEvent();
      unsubscribeEvent = null;
    }
    vi.restoreAllMocks();
  });

  /**
   * 1. Protected Behavior: `StorageAPI.deleteAsset(relPath)` and `StorageAPI.assets.delete(relPath)`
   *    atomically purge assets across Tier 1 (RAM & IndexedDB) and Tier 2 (Filesystem & Firebase).
   * 2. Regression Target: If `deleteAsset` is missing or fails to clear IDB/RAM, deleted images remain
   *    in local memory and get re-served on subsequent accesses.
   * 3. Coverage Overlap: Unique test covering complete asset deletion across cache, IDB, and storage layers.
   * 4. Production Footprint: Exercises authentic `StorageAPI.deleteAsset` and `StorageAPI.assets.delete`.
   */
  it('StorageAPI.deleteAsset purges assets from RAM cache and IndexedDB and emits storage:change event', async () => {
    const assetPath = 'notes/_assets/img-del-target.png';
    const sampleData = 'data:image/png;base64,SAMPLE_IMAGE_DATA_123';

    // 1. Write asset first
    await StorageAPI.writeAsset(assetPath, sampleData);

    // Verify it exists in RAM and IDB
    const inRamBefore = window._assetDataUrlCache.get('img-del-target.png');
    expect(inRamBefore).toBe(sampleData);
    const inIdbBefore = await VaultIDBStorage.getRecord('assets', 'img-del-target.png');
    expect(inIdbBefore?.data).toBe(sampleData);

    // 2. Delete asset via StorageAPI.assets.delete
    const deleted = await StorageAPI.assets.delete(assetPath);
    expect(deleted).toBe(true);

    // 3. Confirm purged from RAM cache
    expect(window._assetDataUrlCache.get(assetPath)).toBeUndefined();
    expect(window._assetDataUrlCache.get('img-del-target.png')).toBeUndefined();

    // 4. Confirm purged from IndexedDB
    const inIdbAfter = await VaultIDBStorage.getRecord('assets', 'img-del-target.png');
    expect(inIdbAfter).toBeNull();

    // 5. Confirm storage:change event emitted
    const deleteEvent = emittedEvents.find(e => e.entity === 'assets' && e.action === 'delete');
    expect(deleteEvent).toBeDefined();
    expect(deleteEvent.id).toBe(assetPath);
  });

  /**
   * 1. Protected Behavior: In Firebase storage mode, `writeAsset` gracefully handles web environments
   *    without local directory handles loaded without throwing false-alarm connector errors.
   * 2. Regression Target: Calling `writeFile` directly in Firebase web mode throws `NotFoundError: No root folder handle loaded`,
   *    triggering a spurious permission denied error toast and aborting asset saves.
   * 3. Coverage Overlap: Unique test validating cloud-only web mode asset persistence resilience.
   * 4. Production Footprint: Tests authentic `StorageAPI.writeAsset` with Firebase engine mode.
   */
  it('writeAsset in Firebase mode persists to cloud and Tier 1 without failing if local folder handle is absent', async () => {
    StorageAPI.setStorageEngine('firebase');

    let cloudSavedAsset = null;
    window.FirebaseSyncService = {
      state: { engine: 'firebase', isUnlocked: true },
      saveAsset: vi.fn(async (relPath, dataUrl) => {
        cloudSavedAsset = { relPath, dataUrl };
        return true;
      }),
      getStatus: vi.fn().mockReturnValue({ status: 'synced', engine: 'firebase' })
    };

    // Simulate pure web mode where disk write throws No root folder handle loaded
    globalThis.writeFile = vi.fn().mockRejectedValue(new Error('No root folder handle loaded'));
    window.writeFile = globalThis.writeFile;

    const assetPath = 'notes/_assets/cloud-only-photo.webp';
    const sampleData = 'data:image/webp;base64,CLOUD_MOCK_WEBP_DATA';

    // Must NOT throw
    await expect(StorageAPI.writeAsset(assetPath, sampleData)).resolves.not.toThrow();

    // Must have saved to Firebase
    expect(cloudSavedAsset).not.toBeNull();
    expect(cloudSavedAsset.relPath).toBe(assetPath);
    expect(cloudSavedAsset.dataUrl).toBe(sampleData);

    // Connector status must remain healthy ('synced')
    const status = StorageAPI.getConnectorStatus();
    expect(status.status).toBe('synced');

    // Clean up
    StorageAPI.setStorageEngine('filesystem');
  });

  /**
   * 1. Protected Behavior: `StorageAPI.readAsset` caches AppBridge native filesystem results in both
   *    RAM cache and IndexedDB for immediate 0ms subsequent access.
   * 2. Regression Target: Uncached AppBridge reads forced IPC bridge round-trips for every image render.
   * 3. Coverage Overlap: Validates Tier-1 caching promotion for Electron/AppBridge assets.
   * 4. Production Footprint: Tests authentic `StorageAPI.readAsset` with `window.AppBridge.fs.readAsset`.
   */
  it('readAsset retrieves via AppBridge and promotes to Tier 1 RAM and IndexedDB cache', async () => {
    const assetPath = 'notes/_assets/app-bridge-diagram.png';
    const sampleData = 'data:image/png;base64,APP_BRIDGE_BYTES';

    window.AppBridge = {
      fs: {
        hasNativeFS: vi.fn().mockReturnValue(true),
        readAsset: vi.fn().mockResolvedValue(sampleData)
      }
    };

    const firstRead = await StorageAPI.readAsset(assetPath);
    expect(firstRead).toBe(sampleData);
    expect(window.AppBridge.fs.readAsset).toHaveBeenCalledTimes(1);

    // 2nd read must hit RAM cache immediately without invoking AppBridge
    const secondRead = await StorageAPI.readAsset(assetPath);
    expect(secondRead).toBe(sampleData);
    expect(window.AppBridge.fs.readAsset).toHaveBeenCalledTimes(1);

    // Must also be persisted in IndexedDB
    const inIdb = await VaultIDBStorage.getRecord('assets', 'app-bridge-diagram.png');
    expect(inIdb?.data).toBe(sampleData);

    delete window.AppBridge;
  });

  /**
   * 1. Protected Behavior: `_dataUrlToBlob` correctly converts both base64 and UTF-8 / URL-encoded SVG data URLs.
   * 2. Regression Target: Non-base64 SVG data URLs threw `atob` DOMException and fell back to raw strings.
   * 3. Coverage Overlap: Unique test covering non-base64 SVG binary serialization.
   * 4. Production Footprint: Tests authentic `_dataUrlToBlob` helper.
   */
  it('_dataUrlToBlob converts both base64 images and UTF-8/URL-encoded SVG data URLs into valid Blobs', async () => {
    // 1. Standard base64 PNG
    const base64Url = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const blob1 = _dataUrlToBlob(base64Url);
    expect(blob1).toBeInstanceOf(Blob);
    expect(blob1.type).toBe('image/png');
    expect(blob1.size).toBeGreaterThan(0);

    // 2. UTF-8 SVG data URL
    const svgUtf8 = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="40"/></svg>';
    const blob2 = _dataUrlToBlob(svgUtf8);
    expect(blob2).toBeInstanceOf(Blob);
    expect(blob2.type).toBe('image/svg+xml');
    const text2 = await blob2.text();
    expect(text2).toContain('<circle cx="50"');

    // 3. URL-encoded SVG data URL
    const svgEncoded = 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Ctext%3EHello%3C%2Ftext%3E%3C%2Fsvg%3E';
    const blob3 = _dataUrlToBlob(svgEncoded);
    expect(blob3).toBeInstanceOf(Blob);
    expect(blob3.type).toBe('image/svg+xml');
    const text3 = await blob3.text();
    expect(text3).toContain('<text>Hello</text>');
  });

  /**
   * 1. Protected Behavior: `StorageAPI._readJSON` safely returns the fallback without throwing
   *    `SyntaxError` when reading empty or whitespace-only files.
   * 2. Regression Target: `JSON.parse("")` previously threw `SyntaxError: Unexpected end of JSON input`.
   * 3. Coverage Overlap: Validates boundary robustness of generic JSON storage helper.
   * 4. Production Footprint: Tests authentic `StorageAPI._readJSON`.
   */
  it('_readJSON safely returns fallback for empty or whitespace-only files without throwing SyntaxError', async () => {
    globalThis.readFile = vi.fn().mockResolvedValue('');
    window.readFile = globalThis.readFile;
    const res1 = await StorageAPI._readJSON('empty.json', { default: true });
    expect(res1).toEqual({ default: true });

    globalThis.readFile = vi.fn().mockResolvedValue('   \n  \t  ');
    window.readFile = globalThis.readFile;
    const res2 = await StorageAPI._readJSON('whitespace.json', []);
    expect(res2).toEqual([]);
  });

  /**
   * 1. Protected Behavior: Modifying image quality on an existing image invalidates the deduplication cache
   *    and ensures the updated image data is saved to storage.
   * 2. Regression Target: If `_savedAssetPaths` only stored the path key without tracking content changes,
   *    re-compressing an image skipped saving to disk.
   * 3. Coverage Overlap: Unique test covering quality adjustment and cache invalidation lifecycle.
   * 4. Production Footprint: Tests authentic `_ensureAssetSaved` and `processAndExternalizeImages`.
   */
  it('_ensureAssetSaved detects content changes for an existing asset path and persists updated data', async () => {
    const writtenAssets = [];
    StorageAPI.writeAsset = vi.fn(async (relPath, dataUrl) => {
      writtenAssets.push({ relPath, dataUrl });
      return true;
    });

    const assetPath = 'notes/_assets/img-diagram.webp';
    const originalData = 'data:image/webp;base64,ORIGINAL_LOW_RES_DATA';
    const highQualityData = 'data:image/webp;base64,UPDATED_HIGH_RES_DATA_DIFFERENT';

    // 1. Initial save
    const firstSave = await _ensureAssetSaved(assetPath, originalData);
    expect(firstSave).toBe(true);
    expect(writtenAssets.length).toBe(1);
    expect(writtenAssets[0].dataUrl).toBe(originalData);

    // 2. Redundant save with identical data -> skipped (no duplicate I/O)
    const redundantSave = await _ensureAssetSaved(assetPath, originalData);
    expect(redundantSave).toBe(true);
    expect(writtenAssets.length).toBe(1);

    // 3. User changed quality mode -> dataUrl is modified
    const updatedSave = await _ensureAssetSaved(assetPath, highQualityData);
    expect(updatedSave).toBe(true);
    expect(writtenAssets.length).toBe(2);
    expect(writtenAssets[1].dataUrl).toBe(highQualityData);
  });

  /**
   * 1. Protected Behavior: `handleImageDrop` runs dropped images through `ImageOptimizer.compressImage`,
   *    sets localized tooltip `img.title`, and establishes the correct file extension.
   * 2. Regression Target: Dropped images bypassed `ImageOptimizer.compressImage`, leading to oversized raw images
   *    and missing hover tooltips.
   * 3. Coverage Overlap: Unique test covering drop compression and accessibility parity with paste.
   * 4. Production Footprint: Tests authentic `handleImageDrop` and `ImageOptimizer`.
   */
  it('handleImageDrop applies ImageOptimizer compression and sets localized title tooltip', async () => {
    const editArea = document.getElementById('edit-textarea');
    const rawData = 'data:image/png;base64,RAW_LARGE_UNCOMPRESSED_DATA';
    const compressedData = 'data:image/webp;base64,OPTIMIZED_WEBP_DATA';

    const compressSpy = vi.spyOn(ImageOptimizer, 'compressImage').mockResolvedValue(compressedData);

    const blob = new Blob(['large drop mock'], { type: 'image/png' });
    const file = new File([blob], 'photo.png', { type: 'image/png' });

    const originalFileReader = global.FileReader;
    global.FileReader = class {
      readAsDataURL() {
        setTimeout(() => {
          this.result = rawData;
          if (this.onload) this.onload();
        }, 5);
      }
    };

    const dropEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: { files: [file] },
      currentTarget: editArea,
      target: editArea,
      clientX: 50,
      clientY: 50
    };

    handleImageDrop(dropEvent);
    await new Promise(r => setTimeout(r, 30));

    expect(compressSpy).toHaveBeenCalledWith(rawData, 'standard');

    const img = editArea.querySelector('img');
    expect(img).not.toBeNull();
    expect(img.src).toBe(compressedData);
    // Ext updated to webp
    expect(img.dataset.assetPath).toMatch(/\.webp$/);
    // Hover tooltip set according to UI guidelines
    expect(img.title).toBe(t('editor.imageDblClickFullscreen'));

    global.FileReader = originalFileReader;
  });
});
