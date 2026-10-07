'use strict';

/**
 * Secretary: Image Compression & Quality Engine (js/app-image-optimizer.js)
 *
 * Provides client-side image compression, format conversion (WebP),
 * quality selection (Standard 1080p vs High 4K vs Original), and smart routing
 * between inline Firestore documents (< 500KB) and Firebase Storage Blobs (> 500KB).
 */
const ImageOptimizer = {
  QUALITY_PRESETS: {
    standard: {
      maxWidth: 1920,
      maxHeight: 1080,
      quality: 0.85,
      mimeType: 'image/webp'
    },
    high: {
      maxWidth: 3840,
      maxHeight: 2160,
      quality: 0.95,
      mimeType: 'image/webp'
    },
    original: {
      maxWidth: Infinity,
      maxHeight: Infinity,
      quality: 1.0,
      mimeType: 'original'
    }
  },

  INLINE_DOC_LIMIT_BYTES: 500 * 1024, // 500 KB limit for inline Firestore docs

  /**
   * Calculates scaled dimensions maintaining aspect ratio.
   */
  calculateDimensions(origWidth, origHeight, maxWidth, maxHeight) {
    const w = Number(origWidth);
    const h = Number(origHeight);
    if (!w || !h || w <= 0 || h <= 0 || isNaN(w) || isNaN(h)) {
      return {
        width: Math.min(Number(maxWidth) || 1920, 1920),
        height: Math.min(Number(maxHeight) || 1080, 1080)
      };
    }
    const maxW = Number(maxWidth);
    const maxH = Number(maxHeight);
    // Guard against Infinity or unconstrained dimensions to prevent canvas crash
    if (!isFinite(maxW) && !isFinite(maxH)) {
      return {
        width: Math.min(Math.round(w), 16384),
        height: Math.min(Math.round(h), 16384)
      };
    }
    const effectiveMaxW = isFinite(maxW) ? maxW : 16384;
    const effectiveMaxH = isFinite(maxH) ? maxH : 16384;

    if (w <= effectiveMaxW && h <= effectiveMaxH) {
      return { width: Math.round(w), height: Math.round(h) };
    }
    const ratio = Math.min(effectiveMaxW / w, effectiveMaxH / h);
    return {
      width: Math.max(1, Math.round(w * ratio)),
      height: Math.max(1, Math.round(h * ratio))
    };
  },

  /**
   * Determines if a dataUrl or binary blob should be stored in Cloud Storage rather than inline in Firestore.
   */
  shouldRouteToBlobStorage(payload, thresholdBytes = ImageOptimizer.INLINE_DOC_LIMIT_BYTES) {
    if (!payload) return false;
    let sizeInBytes = 0;
    if (typeof payload === 'string') {
      if (payload.startsWith('data:')) {
        const commaIdx = payload.indexOf(',');
        const base64Len = commaIdx >= 0 ? payload.length - commaIdx - 1 : payload.length;
        sizeInBytes = Math.round((base64Len * 3) / 4);
      } else {
        sizeInBytes = payload.length;
      }
    } else if (payload && typeof payload.size === 'number') {
      sizeInBytes = payload.size;
    } else if (payload && payload.byteLength) {
      sizeInBytes = payload.byteLength;
    }
    return sizeInBytes > thresholdBytes;
  },

  /**
   * Compresses an image element, Data URL, or Blob/File using HTML5 Canvas.
   */
  async compressImage(imageSource, qualityMode = 'standard') {
    const preset = this.QUALITY_PRESETS[qualityMode] || this.QUALITY_PRESETS.standard;
    if (qualityMode === 'original') {
      if (typeof imageSource === 'string') return imageSource;
      if (imageSource instanceof Blob) return await this.blobToDataUrl(imageSource);
      if (typeof HTMLElement !== 'undefined' && imageSource instanceof HTMLElement && imageSource.tagName === 'IMG') {
        return imageSource.src;
      }
    }

    const img = await this._loadImage(imageSource);
    const { width, height } = this.calculateDimensions(
      img.naturalWidth || img.width,
      img.naturalHeight || img.height,
      preset.maxWidth,
      preset.maxHeight
    );

    let canvas;
    if (typeof document !== 'undefined') {
      canvas = document.createElement('canvas');
    } else if (typeof OffscreenCanvas !== 'undefined') {
      canvas = new OffscreenCanvas(width, height);
    } else {
      // Fallback in node environment without DOM
      return typeof imageSource === 'string' ? imageSource : await this.blobToDataUrl(imageSource);
    }

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return typeof imageSource === 'string' ? imageSource : await this.blobToDataUrl(imageSource);
    }

    ctx.drawImage(img, 0, 0, width, height);

    if (canvas.toDataURL) {
      return canvas.toDataURL(preset.mimeType, preset.quality);
    } else if (canvas.convertToBlob) {
      const blob = await canvas.convertToBlob({ type: preset.mimeType, quality: preset.quality });
      return await this.blobToDataUrl(blob);
    }

    return typeof imageSource === 'string' ? imageSource : '';
  },

  _loadImage(source) {
    return new Promise((resolve, reject) => {
      if (typeof source === 'string' && source.startsWith('data:image/svg+xml')) {
        try {
          const decoded = decodeURIComponent(source).toLowerCase();
          if (decoded.includes('<script') || decoded.includes('javascript:')) {
            return reject(new Error('SVG with active scripts is rejected for security'));
          }
        } catch (e) {}
      }

      if (typeof Image === 'undefined') {
        // Mock image object for node/test environment
        return resolve({
          width: source?.width || 1920,
          height: source?.height || 1080,
          naturalWidth: source?.naturalWidth || 1920,
          naturalHeight: source?.naturalHeight || 1080
        });
      }

      if (typeof HTMLElement !== 'undefined' && source instanceof HTMLElement && source.tagName === 'IMG' && source.complete && source.naturalWidth) {
        return resolve(source);
      }

      const img = new Image();
      let createdUrl = null;
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (createdUrl && typeof URL !== 'undefined' && URL.revokeObjectURL) {
          URL.revokeObjectURL(createdUrl);
        }
        resolve(img);
      };
      img.onerror = (err) => {
        if (createdUrl && typeof URL !== 'undefined' && URL.revokeObjectURL) {
          URL.revokeObjectURL(createdUrl);
        }
        reject(new Error('Failed to load image for compression: ' + err));
      };

      if (typeof source === 'string') {
        img.src = source;
      } else if (source instanceof Blob) {
        if (typeof URL !== 'undefined' && URL.createObjectURL) {
          createdUrl = URL.createObjectURL(source);
          img.src = createdUrl;
        } else {
          reject(new Error('URL.createObjectURL not supported'));
        }
      } else if (source && source.src) {
        img.src = source.src;
      } else {
        reject(new Error('Unsupported image source type'));
      }
    });
  },

  blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      if (typeof FileReader === 'undefined') {
        return resolve('data:image/webp;base64,mock');
      }
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
};

if (typeof window !== 'undefined') {
  window.ImageOptimizer = ImageOptimizer;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ImageOptimizer };
}
