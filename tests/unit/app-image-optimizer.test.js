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
});
