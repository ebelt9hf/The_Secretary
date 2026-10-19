import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Cloud Backup Fallback, Image Asset Recovery & CSP Whitelisting', () => {
  const rootDir = path.resolve(__dirname, '../../');

  it('verifies that CSP connect-src whitelists regional firebasedatabase.app in all HTML entrypoints', () => {
    const htmlFiles = ['app.html', 'note-window.html', 'secretary-window.html'];
    for (const file of htmlFiles) {
      const fullPath = path.join(rootDir, file);
      expect(fs.existsSync(fullPath)).toBe(true);
      const content = fs.readFileSync(fullPath, 'utf8');

      expect(content).toContain('https://*.firebasedatabase.app');
      expect(content).toContain('wss://*.firebasedatabase.app');
      expect(content).toContain('https://*.firebaseio.com');
      expect(content).toContain('wss://*.firebaseio.com');
    }
  });

  describe('Web File System Access & Storage Fallbacks to _migrated_to_cloud_backup/', () => {
    let mockFileSystem;

    beforeAll(() => {
      globalThis.window = globalThis.window || {};
      globalThis.window.AppBridge = null; // simulate standard web browser (Chrome / Edge)

      loadScriptsIntoGlobal([
        'js/app-fs.js',
        'js/app-crypto.js',
        'js/app-storage.js'
      ]);
    });

    beforeEach(() => {
      mockFileSystem = new Map();

      // Mock DirectoryHandle / FileHandle for Web FileSystemAccess API
      const createMockDirHandle = (currentPath = '') => {
        return {
          async getDirectoryHandle(name) {
            const nextPath = currentPath ? `${currentPath}/${name}` : name;
            return createMockDirHandle(nextPath);
          },
          async getFileHandle(name) {
            const fullPath = currentPath ? `${currentPath}/${name}` : name;
            if (mockFileSystem.has(fullPath)) {
              const fileData = mockFileSystem.get(fullPath);
              return {
                async getFile() {
                  return {
                    text: async () => fileData,
                    size: fileData.length,
                    type: fullPath.endsWith('.png') ? 'image/png' : 'text/html'
                  };
                }
              };
            }
            const err = new Error(`File not found: ${fullPath}`);
            err.name = 'NotFoundError';
            throw err;
          }
        };
      };

      globalThis.rootHandle = createMockDirHandle('');
      if (typeof window !== 'undefined') {
        window.rootHandle = globalThis.rootHandle;
      }
      if (typeof _assetDataUrlCache !== 'undefined' && _assetDataUrlCache.clear) {
        _assetDataUrlCache.clear();
      }
    });

    it('readFile falls back to _migrated_to_cloud_backup/ when note is archived on disk', async () => {
      const noteHtml = '<html><body><h1>Archived Note</h1><p>Important meeting</p></body></html>';
      // File does NOT exist at notes/note-123.html, only in backup folder
      mockFileSystem.set('_migrated_to_cloud_backup/notes/note-123.html', noteHtml);

      const content = await readFile('notes/note-123.html');
      expect(content).toBe(noteHtml);
    });

    it('readAssetAsDataUrl falls back to _migrated_to_cloud_backup/notes/_assets/ and _migrated_to_cloud_backup/_assets/', async () => {
      const mockImgData = 'data:image/png;base64,mockImageContent12345';
      // Image is only present in _migrated_to_cloud_backup/notes/_assets/
      mockFileSystem.set('_migrated_to_cloud_backup/notes/_assets/img-screen-001.png', mockImgData);

      // FileReader mock for Node unit test environment
      const origFileReader = globalThis.FileReader;
      globalThis.FileReader = class {
        readAsDataURL(file) {
          setTimeout(() => {
            file.text().then(text => {
              this.result = text;
              if (typeof this.onload === 'function') this.onload();
            });
          }, 0);
        }
      };

      try {
        const dataUrl = await readAssetAsDataUrl('notes/_assets/img-screen-001.png');
        expect(dataUrl).toBe(mockImgData);
      } finally {
        globalThis.FileReader = origFileReader;
      }
    });

    it('StorageAPI.readNoteContent falls back to local backup when in firebase mode but note not in cloud cache', async () => {
      const noteHtml = '<html><body><h1>Cached from disk</h1></body></html>';
      mockFileSystem.set('_migrated_to_cloud_backup/notes/note-offline.html', noteHtml);

      window.FirebaseSyncService = {
        state: { isUnlocked: true, engine: 'firebase' },
        _normalizeId: (p) => p.replace(/^notes\//, '').replace(/\.html$/, ''),
        getNote: async () => null // simulate note not downloaded from cloud yet
      };

      const result = await StorageAPI.readNoteContent('notes/note-offline.html');
      expect(result).toBe(noteHtml);
    });
  });
});
