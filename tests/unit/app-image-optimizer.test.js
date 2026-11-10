import { describe, it, expect, beforeAll } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('ImageOptimizer Engine (js/app-image-optimizer.js)', () => {
  beforeAll(() => {
    loadScriptsIntoGlobal(['js/app-image-optimizer.js']);
  });

  it('calculates scaled dimensions correctly preserving aspect ratio', () => {
    // 1. Within bounds
    const dim1 = window.ImageOptimizer.calculateDimensions(1000, 800, 1920, 1080);
    expect(dim1).toEqual({ width: 1000, height: 800 });

    // 2. Exceeding width
    const dim2 = window.ImageOptimizer.calculateDimensions(3840, 2160, 1920, 1080);
    expect(dim2).toEqual({ width: 1920, height: 1080 });

    // 3. Vertical photo
    const dim3 = window.ImageOptimizer.calculateDimensions(3000, 4000, 1920, 1080);
    expect(dim3.height).toBe(1080);
    expect(dim3.width).toBe(810);
  });

  it('routes payloads > 500KB to Firebase Storage Blobs rather than inline documents', () => {
    // 100 KB payload -> Inline
    const smallPayload = 'data:image/webp;base64,' + 'A'.repeat(100 * 1024);
    expect(window.ImageOptimizer.shouldRouteToBlobStorage(smallPayload)).toBe(false);

    // 800 KB payload -> Storage Blob
    const largePayload = 'data:image/webp;base64,' + 'A'.repeat(800 * 1024);
    expect(window.ImageOptimizer.shouldRouteToBlobStorage(largePayload)).toBe(true);

    // Raw blob object mock
    expect(window.ImageOptimizer.shouldRouteToBlobStorage({ size: 200 * 1024 })).toBe(false);
    expect(window.ImageOptimizer.shouldRouteToBlobStorage({ size: 1024 * 1024 })).toBe(true);
  });

  it('provides configured presets for standard, high and original modes', () => {
    const presets = window.ImageOptimizer.QUALITY_PRESETS;
    expect(presets.standard.maxWidth).toBe(1920);
    expect(presets.standard.quality).toBe(0.85);

    expect(presets.high.maxWidth).toBe(3840);
    expect(presets.high.quality).toBe(0.95);

    expect(presets.original.maxWidth).toBe(Infinity);
  });

  it('handles zero, negative, and NaN dimensions safely without crashing or returning NaN', () => {
    const dimZero = window.ImageOptimizer.calculateDimensions(0, 0, 1920, 1080);
    expect(dimZero.width).toBe(1920);
    expect(dimZero.height).toBe(1080);
    expect(Number.isFinite(dimZero.width)).toBe(true);
    expect(Number.isFinite(dimZero.height)).toBe(true);

    const dimNaN = window.ImageOptimizer.calculateDimensions(NaN, undefined, 1920, 1080);
    expect(Number.isFinite(dimNaN.width)).toBe(true);
    expect(Number.isFinite(dimNaN.height)).toBe(true);

    const dimNeg = window.ImageOptimizer.calculateDimensions(-100, -200, 1920, 1080);
    expect(dimNeg.width).toBeGreaterThan(0);
    expect(dimNeg.height).toBeGreaterThan(0);
  });

  /**
   * 1. Protected Behavior: compressImage falls back to original source if canvas export yields empty or data:,.
   * 2. Regression Target: If canvas.toDataURL returns data:, (e.g. unsupported WebP on Safari),
   *    compressImage returned broken data:,, rendering the image invisible in notes.
   * 3. Coverage Overlap: Protects compressImage data integrity contract.
   * 4. Production Footprint: Authentic ImageOptimizer.compressImage execution.
   */
  it('compressImage returns original source if canvas export produces invalid data:,', async () => {
    const rawData = 'data:image/png;base64,ORIGINAL_DATA_SOURCE';

    const origCreateElement = document.createElement.bind(document);
    document.createElement = (tag) => {
      const el = origCreateElement(tag);
      if (tag === 'canvas') {
        el.getContext = () => ({
          drawImage: () => {}
        });
        el.toDataURL = () => 'data:,';
      }
      return el;
    };

    const res = await window.ImageOptimizer.compressImage(rawData, 'standard');
    expect(res).toBe(rawData);

    document.createElement = origCreateElement;
  });

  /**
   * 1. Protected Behavior: _loadImage does not set crossOrigin on data: or blob: URIs to avoid CORS failures.
   * 2. Regression Target: Setting crossOrigin on data: URIs taints canvas or triggers error in strict WebKit/Blink.
   * 3. Coverage Overlap: Image loading origin safety.
   * 4. Production Footprint: Authentic ImageOptimizer._loadImage.
   */
  it('_loadImage avoids setting crossOrigin on data: and blob: URIs', async () => {
    const originalImage = global.Image;
    let assignedCrossOrigin = null;
    let assignedSrc = null;

    global.Image = class {
      set crossOrigin(val) { assignedCrossOrigin = val; }
      get crossOrigin() { return assignedCrossOrigin; }
      set src(val) {
        assignedSrc = val;
        setTimeout(() => { if (this.onload) this.onload(); }, 5);
      }
      get src() { return assignedSrc; }
      get naturalWidth() { return 100; }
      get naturalHeight() { return 100; }
    };

    const dataUri = 'data:image/png;base64,MOCK_DATA';
    await window.ImageOptimizer._loadImage(dataUri);
    expect(assignedCrossOrigin).toBeNull();

    // But for remote http/https URLs, crossOrigin should be anonymous
    assignedCrossOrigin = null;
    await window.ImageOptimizer._loadImage('https://example.com/photo.png');
    expect(assignedCrossOrigin).toBe('anonymous');

    global.Image = originalImage;
  });
});
