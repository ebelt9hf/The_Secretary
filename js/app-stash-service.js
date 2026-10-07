'use strict';

/**
 * Secretary - Stash Data Service Layer
 * Encapsulates all read/write logic for raw captured thoughts.
 * Uses StorageAPI layer for data access, allowing easy transition to a database in the future.
 */
const StashService = {
  /**
   * Retrieves all items currently in the stash.
   * @returns {Promise<Array<{id: string, filename: string, text: string, created: string}>>}
   */
  async list() {
    try {
      const isStorageReady = Boolean((typeof rootHandle !== 'undefined' && rootHandle) || (typeof StorageAPI !== 'undefined' && typeof StorageAPI.getStorageEngine === 'function' && StorageAPI.getStorageEngine() === 'firebase'));
      if (!isStorageReady) return [];
      const files = await StorageAPI.listStashFiles();
      const items = [];
      for (const name of files) {
        try {
          const content = await StorageAPI.readStashContent(name);
          const tsMatch = name.match(/capture-(\d+)\.(txt|md)/);
          const timestamp = tsMatch ? parseInt(tsMatch[1], 10) : Date.now();
          items.push({
            id: name,
            filename: name,
            text: content,
            created: new Date(timestamp).toISOString()
          });
        } catch (fileErr) {
          console.warn(`Could not read stash file: ${name}`, fileErr);
        }
      }
      // Sort older first (FIFO processing)
      return items.sort((a, b) => a.id.localeCompare(b.id));
    } catch (e) {
      console.warn('StashService.list failed', e);
      return [];
    }
  },

  /**
   * Adds a raw thought to the stash.
   * @param {string} text - Raw text to store.
   * @returns {Promise<{id: string, filename: string, text: string, created: string}>}
   */
  async add(text) {
    if (!text || !text.trim()) return null;
    const timestamp = Date.now();
    const filename = `capture-${timestamp}.txt`;
    await StorageAPI.writeStashContent(filename, text.trim());
    return {
      id: filename,
      filename: filename,
      text: text.trim(),
      created: new Date(timestamp).toISOString()
    };
  },

  /**
   * Deletes a specific item from the stash by its ID/filename.
   * @param {string} id - The ID of the stash item to remove.
   * @returns {Promise<void>}
   */
  async delete(id) {
    if (!id) return;
    await StorageAPI.deleteStashFile(id);
  },

  /**
   * Clears all items in the stash directory.
   * @returns {Promise<void>}
   */
  async clear() {
    try {
      const isStorageReady = Boolean((typeof rootHandle !== 'undefined' && rootHandle) || (typeof StorageAPI !== 'undefined' && typeof StorageAPI.getStorageEngine === 'function' && StorageAPI.getStorageEngine() === 'firebase'));
      if (!isStorageReady) return;
      const files = await StorageAPI.listStashFiles();
      if (!files || !files.length) return;
      await Promise.allSettled(files.map(name => StorageAPI.deleteStashFile(name)));
    } catch (e) {
      console.warn('StashService.clear failed', e);
    }
  }
};
window.StashService = StashService;

/**
 * Secretary - Global Quick Stash Controller
 * Handles global shortcut Cmd+Shift+S / Ctrl+Shift+S and transient quick capture modal.
 */
const QuickStashController = {
  isQuickStashShortcut(e) {
    if (!e) return false;
    const isS = e.key === 's' || e.key === 'S';
    const isMod = !!(e.metaKey || e.ctrlKey);
    const isShift = !!e.shiftKey;
    return isS && isMod && isShift;
  },

  processRawInput(raw) {
    const text = String(raw || '').trim();
    if (!text) return { text: '', tags: [] };

    const tags = [];
    const cleanText = text.replace(/#([a-zA-Z0-9_-]+)/g, (match, tag) => {
      tags.push(tag);
      return '';
    }).replace(/[ \t]+/g, ' ').replace(/[ \t]+\n/g, '\n').trim();

    return {
      text: cleanText || text,
      tags
    };
  },

  openModal() {
    const modal = document.getElementById('modal-quick-stash');
    if (!modal) return;
    const ta = document.getElementById('quick-stash-textarea');
    if (ta) {
      ta.value = '';
    }
    openModal('modal-quick-stash');
    setTimeout(() => {
      if (ta) ta.focus();
    }, 50);
  },

  closeModal() {
    closeModal('modal-quick-stash');
  },

  async saveFromUI() {
    const ta = document.getElementById('quick-stash-textarea');
    if (!ta) return;
    const raw = ta.value.trim();
    if (!raw) return;

    const processed = this.processRawInput(raw);
    const contentToSave = processed.tags.length > 0 
      ? `${processed.text}\n\nTags: ${processed.tags.map(t => '#' + t).join(' ')}`
      : processed.text;

    try {
      await StashService.add(contentToSave);
      this.closeModal();
      if (typeof toast === 'function') {
        toast(t('stash.quickStashSuccess') || 'Saved to Stash!');
      }
      if (typeof renderStashList === 'function') {
        renderStashList();
      }
    } catch (err) {
      if (typeof toast === 'function') {
        toast(err.message || 'Failed to save quick stash', true);
      }
    }
  },

  init() {
    window.addEventListener('keydown', (e) => {
      if (this.isQuickStashShortcut(e)) {
        e.preventDefault();
        this.openModal();
      }
    });
  }
};

if (typeof window !== 'undefined') {
  window.QuickStashController = QuickStashController;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => QuickStashController.init());
    } else {
      QuickStashController.init();
    }
  }
}
