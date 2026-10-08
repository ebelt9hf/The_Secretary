// ── Secretary: Platform & Application Bridge (Electron + Browser Dual-Mode) ──

(function(global) {
  'use strict';

  const isElectron = !!(global.electronAPI?.isElectron || /Electron/i.test(navigator.userAgent));
  const platform = global.electronAPI?.platform || (
    /Mac/i.test(navigator.userAgent) || /Mac/i.test(navigator.platform) ? 'darwin' :
    /Win/i.test(navigator.userAgent) || /Win/i.test(navigator.platform) ? 'win32' : 'linux'
  );

  const isMac = platform === 'darwin';
  const isWin = platform === 'win32';
  const isLinux = platform === 'linux';

  const AppBridge = {
    get isElectron() {
      return !!(global.electronAPI?.isElectron || /Electron/i.test(navigator.userAgent) || this._isElectron);
    },
    set isElectron(val) {
      this._isElectron = val;
    },
    get platform() {
      return global.electronAPI?.platform || this._platform || (
        /Mac/i.test(navigator.userAgent) || /Mac/i.test(navigator.platform) ? 'darwin' :
        /Win/i.test(navigator.userAgent) || /Win/i.test(navigator.platform) ? 'win32' : 'linux'
      );
    },
    set platform(val) {
      this._platform = val;
    },
    get isMac() {
      return this.platform === 'darwin';
    },
    get isWin() {
      return this.platform === 'win32';
    },
    get isLinux() {
      return this.platform === 'linux';
    },

    // ═══ Window Controls ═══
    windowControls: {
      minimize() {
        if (global.electronAPI?.minimizeWindow) {
          global.electronAPI.minimizeWindow();
        }
      },
      maximize() {
        if (global.electronAPI?.maximizeWindow) {
          global.electronAPI.maximizeWindow();
        }
      },
      unmaximize() {
        if (global.electronAPI?.unmaximizeWindow) {
          global.electronAPI.unmaximizeWindow();
        }
      },
      _lastToggle: 0,
      toggleMaximize() {
        const now = Date.now();
        if (now - (this._lastToggle || 0) < 300) return;
        this._lastToggle = now;
        if (global.electronAPI?.toggleMaximizeWindow) {
          global.electronAPI.toggleMaximizeWindow();
        } else if (document.fullscreenElement) {
          if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
        } else {
          if (document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen().catch(() => {});
          }
        }
      },
      async close() {
        const isStandaloneChild = !document.getElementById('topbar-main-row') && (
          (AppBridge.isStandaloneChildWindow && AppBridge.isStandaloneChildWindow()) ||
          document.body.classList.contains('note-window-standalone') ||
          document.body.classList.contains('secretary-window-standalone') ||
          document.body.classList.contains('chat-window-mode') ||
          document.body.classList.contains('focus-pip-mode') ||
          (typeof location !== 'undefined' && location.pathname && (location.pathname.includes('secretary-window') || location.pathname.includes('note-window')))
        );

        if (!isStandaloneChild && typeof window.handleMainWindowCloseRequest === 'function') {
          return await window.handleMainWindowCloseRequest();
        }

        try {
          if (typeof hasUnsavedNoteOverlayChanges === 'function' && hasUnsavedNoteOverlayChanges()) {
            if (typeof autoSaveNote === 'function') {
              await Promise.race([
                autoSaveNote({ silent: true, isFinal: true }),
                new Promise(r => setTimeout(r, 2500))
              ]);
            }
          }
        } catch (e) {
          console.warn('Pre-close note save error:', e);
        }
        if (global.electronAPI?.closeWindow) {
          global.electronAPI.closeWindow();
          return true;
        }
        try {
          global.close();
          return true;
        } catch (e) {
          return false;
        }
      },
      closeAppConfirmed() {
        if (global.electronAPI?.closeAppConfirmed) {
          global.electronAPI.closeAppConfirmed();
        } else {
          try { global.close(); } catch (e) {}
        }
      },
      isMaximized() {
        if (global.electronAPI?.isWindowMaximized) {
          return Promise.resolve(global.electronAPI.isWindowMaximized());
        }
        return Promise.resolve(!!document.fullscreenElement);
      },
      onMaximizeChange(callback) {
        if (typeof callback !== 'function') return () => {};
        let unlistenIpc = null;
        if (global.electronAPI?.onWindowMaximizeChange) {
          unlistenIpc = global.electronAPI.onWindowMaximizeChange(callback);
        }
        const domHandler = () => {
          if (!global.electronAPI?.onWindowMaximizeChange) {
            callback(!!document.fullscreenElement);
          }
        };
        document.addEventListener('fullscreenchange', domHandler);
        return () => {
          if (typeof unlistenIpc === 'function') {
            try { unlistenIpc(); } catch (e) {}
          }
          document.removeEventListener('fullscreenchange', domHandler);
        };
      },
      onFullscreenChange(callback) {
        if (typeof callback !== 'function') return () => {};
        let unlistenIpc = null;
        if (global.electronAPI?.onFullscreenChange) {
          unlistenIpc = global.electronAPI.onFullscreenChange(callback);
        }
        const domHandler = () => {
          if (!global.electronAPI?.onFullscreenChange) {
            callback(!!document.fullscreenElement);
          }
        };
        document.addEventListener('fullscreenchange', domHandler);
        return () => {
          if (typeof unlistenIpc === 'function') {
            try { unlistenIpc(); } catch (e) {}
          }
          document.removeEventListener('fullscreenchange', domHandler);
        };
      },
      // Windows Taskbar & System Integration
      getSystemAccentColor() {
        if (global.electronAPI?.getSystemAccentColor) {
          return global.electronAPI.getSystemAccentColor();
        }
        return Promise.resolve(null);
      },
      onSystemAccentColorChanged(callback) {
        if (typeof callback !== 'function') return () => {};
        if (global.electronAPI?.onSystemAccentColorChanged) {
          return global.electronAPI.onSystemAccentColorChanged(callback);
        }
        return () => {};
      },
      setProgressBar(progress, options) {
        if (global.electronAPI?.setProgressBar) {
          global.electronAPI.setProgressBar(progress, options);
        }
      },
      onAppAction(callback) {
        if (typeof callback !== 'function') return () => {};
        if (global.electronAPI?.onAppAction) {
          return global.electronAPI.onAppAction(callback);
        }
        return () => {};
      }
    },

    // ═══ Unified Window & Titlebar Manager ═══
    windowManager: {
      isInitialized: false,

      init() {
        this.applyEnvironmentClasses();
        this.setupWindowControls();
        this.setupTitlebarDblClick();
        this.setupContrastObserver();
        this.setupSystemAccentSync();
        this.updateContrast();
        this.isInitialized = true;
      },

      setupSystemAccentSync() {
        if (AppBridge.isWin && AppBridge.isElectron && AppBridge.windowControls?.getSystemAccentColor) {
          AppBridge.windowControls.getSystemAccentColor().then((color) => {
            if (color && typeof document !== 'undefined') {
              document.documentElement?.style.setProperty('--win-system-accent', color);
            }
          }).catch(() => {});

          AppBridge.windowControls.onSystemAccentColorChanged((color) => {
            if (color && typeof document !== 'undefined') {
              document.documentElement?.style.setProperty('--win-system-accent', color);
            }
          });
        }
      },

      applyEnvironmentClasses() {
        if (typeof document === 'undefined' || (!document.documentElement && !document.body)) return;
        if (AppBridge.isElectron) {
          document.documentElement?.classList.add('is-electron');
          document.body?.classList.add('is-electron');
          if (AppBridge.isMac) {
            document.documentElement?.classList.add('is-electron-mac');
            document.body?.classList.add('is-electron-mac');
          } else if (AppBridge.isWin) {
            document.documentElement?.classList.add('is-electron-win');
            document.body?.classList.add('is-electron-win');
          } else if (AppBridge.isLinux) {
            document.documentElement?.classList.add('is-electron-linux');
            document.body?.classList.add('is-electron-linux');
          }
        }
      },

      setupWindowControls() {
        if (!AppBridge.windowControls || typeof document === 'undefined') return;

        AppBridge.windowControls.onFullscreenChange((isFullScreen) => {
          if (isFullScreen) {
            document.body?.classList.add('is-fullscreen');
          } else {
            document.body?.classList.remove('is-fullscreen');
          }
          this.updateContrast();
        });

        if ((AppBridge.isWin || AppBridge.isLinux) && AppBridge.isElectron) {
          const winControls = document.getElementById('win-controls');
          const minBtn = document.getElementById('win-min');
          const maxBtn = document.getElementById('win-max');
          const closeBtn = document.getElementById('win-close');

          if (minBtn && !minBtn._bound) {
            minBtn._bound = true;
            minBtn.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              AppBridge.windowControls.minimize();
            });
          }
          if (maxBtn && !maxBtn._bound) {
            maxBtn._bound = true;
            maxBtn.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              AppBridge.windowControls.toggleMaximize();
            });
          }
          if (closeBtn && !closeBtn._bound) {
            closeBtn._bound = true;
            closeBtn.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              AppBridge.windowControls.close();
            });
          }

          const setMaxState = (isMaximized) => {
            if (winControls) winControls.classList.toggle('is-maximized', !!isMaximized);
            if (maxBtn) {
              const key = isMaximized ? 'window.restore' : 'window.maximize';
              const label = typeof t === 'function' ? t(key) : (isMaximized ? 'Restore window' : 'Maximize window');
              maxBtn.title = label;
              maxBtn.setAttribute('data-i18n-title', key);
              maxBtn.setAttribute('aria-label', label);
            }
          };

          AppBridge.windowControls.onMaximizeChange(setMaxState);
          AppBridge.windowControls.isMaximized()
            .then(setMaxState)
            .catch(() => {});
        }
      },

      setupTitlebarDblClick() {
        if (typeof document === 'undefined') return;
        if (this._dblClickBound) return;
        this._dblClickBound = true;
        document.addEventListener('dblclick', (e) => {
          const header = e.target.closest('.topbar-main-row, .overlay-header, .floating-chat-header, .daily-review-header');
          if (!header) return;
          if (e.target.closest('button, input, select, textarea, a, .tab-item, [role="button"], .win-controls')) {
            return;
          }
          if (AppBridge.isElectron && AppBridge.windowControls?.toggleMaximize) {
            AppBridge.windowControls.toggleMaximize();
          }
        });
      },

      hasDarkHeader() {
        if (typeof document === 'undefined' || !document.body) return false;
        if (document.body.classList.contains('focused-note-mode') ||
            document.body.classList.contains('note-window-standalone') ||
            document.body.classList.contains('secretary-window-standalone') ||
            document.body.classList.contains('chat-window-mode') ||
            document.body.classList.contains('daily-review-active')) {
          return true;
        }
        const screenMain = document.getElementById('screen-main');
        if (screenMain && screenMain.classList.contains('active')) {
          return true;
        }
        const noteOverlay = document.getElementById('note-edit-overlay');
        if (noteOverlay && (noteOverlay.classList.contains('active') || (noteOverlay.style.display && noteOverlay.style.display !== 'none'))) {
          return true;
        }
        const todoOverlay = document.getElementById('todo-edit-overlay');
        if (todoOverlay && (todoOverlay.classList.contains('active') || (todoOverlay.style.display && todoOverlay.style.display !== 'none'))) {
          return true;
        }
        return false;
      },

      updateContrast() {
        if (typeof document === 'undefined') return;
        const winControls = document.getElementById('win-controls');
        if (!winControls) return;
        const isDark = this.hasDarkHeader();
        winControls.classList.toggle('on-dark-header', isDark);
        winControls.classList.toggle('on-light-surface', !isDark);
      },

      setupContrastObserver() {
        if (typeof document === 'undefined' || !document.body || typeof MutationObserver === 'undefined') return;
        const observer = new MutationObserver(() => {
          this.updateContrast();
        });
        try {
          observer.observe(document.body, {
            attributes: true,
            attributeFilter: ['class', 'style'],
            subtree: false
          });
          const screenMain = document.getElementById('screen-main');
          if (screenMain) {
            observer.observe(screenMain, { attributes: true, attributeFilter: ['class', 'style'] });
          }
          const noteOverlay = document.getElementById('note-edit-overlay');
          if (noteOverlay) {
            observer.observe(noteOverlay, { attributes: true, attributeFilter: ['class', 'style'] });
          }
        } catch (e) {}
      }
    },

    // ═══ File System & Workspace IPC Helpers ═══
    fs: {
      hasNativeFS() {
        return !!(global.electronAPI?.readFile || global.electronAPI?.selectFolder);
      },
      async selectFolder() {
        if (global.electronAPI?.selectFolder) {
          return await global.electronAPI.selectFolder();
        }
        return null; // Signals caller to fall back to Web File System Access API
      },
      async getWorkspacePath() {
        if (global.electronAPI?.getWorkspacePath) {
          return await global.electronAPI.getWorkspacePath();
        }
        return null;
      },
      async setWorkspacePath(folderPath) {
        if (global.electronAPI?.setWorkspacePath) {
          return await global.electronAPI.setWorkspacePath(folderPath);
        }
        return null;
      },
      async readFile(relativePath) {
        if (global.electronAPI?.readFile) {
          try {
            return await global.electronAPI.readFile(relativePath);
          } catch (e) {
            console.warn('Native readFile failed for:', relativePath, e.message);
            return null;
          }
        }
        return null; // Fall back to Web FS handle
      },
      async readAsset(relativePath) {
        if (global.electronAPI?.readAsset) {
          return await global.electronAPI.readAsset(relativePath);
        }
        return null;
      },
      async writeFile(relativePath, content) {
        if (global.electronAPI?.writeFile) {
          return await global.electronAPI.writeFile(relativePath, content);
        }
        return null; // Fall back to Web FS handle
      },
      async deleteFile(relativePath) {
        if (global.electronAPI?.deleteFile) {
          return await global.electronAPI.deleteFile(relativePath);
        }
        return null; // Fall back to Web FS handle
      },
      async fileExists(relativePath) {
        if (global.electronAPI?.fileExists) {
          return await global.electronAPI.fileExists(relativePath);
        }
        return null; // Fall back to Web FS handle
      },
      async listFiles(subDir) {
        if (global.electronAPI?.listFiles) {
          return await global.electronAPI.listFiles(subDir);
        }
        return null; // Fall back to Web FS handle
      }
    },

    // ═══ Cross-Window Broadcast & Sync ═══
    sync: {
      broadcast(msg) {
        if (global.electronAPI?.broadcastSync) {
          try { global.electronAPI.broadcastSync(msg); } catch (e) {}
        }
      },
      onMessage(callback) {
        if (typeof callback !== 'function') return () => {};
        if (global.electronAPI?.onSyncMessage) {
          return global.electronAPI.onSyncMessage(callback);
        }
        return () => {};
      }
    },

    // ═══ Note Window Popout & Open State Tracking ═══
    noteWindow: {
      _cachedOpenNotes: new Set(),
      _listeners: new Set(),
      _initialized: false,

      init() {
        if (this._initialized) return;
        this._initialized = true;

        if (global.electronAPI?.getOpenNotes) {
          global.electronAPI.getOpenNotes().then(notes => {
            if (Array.isArray(notes)) {
              this._cachedOpenNotes = new Set(notes);
              this._notifyListeners();
            }
          }).catch(() => {});
        }

        if (global.electronAPI?.onOpenNotesChanged) {
          global.electronAPI.onOpenNotesChanged((notes) => {
            if (Array.isArray(notes)) {
              this._cachedOpenNotes = new Set(notes);
              this._notifyListeners();
            }
          });
        }

        // Web mode fallback via BroadcastChannel
        if (typeof BroadcastChannel !== 'undefined') {
          try {
            this._channel = new BroadcastChannel('secretary-open-notes');
            this._channel.onmessage = (e) => {
              if (e.data?.type === 'OPEN_NOTE_ANNOUNCE') {
                if (e.data.noteId) this._cachedOpenNotes.add(e.data.noteId);
                if (e.data.path) this._cachedOpenNotes.add(this._norm(e.data.path));
                this._notifyListeners();
              } else if (e.data?.type === 'CLOSE_NOTE_ANNOUNCE') {
                if (e.data.noteId) this._cachedOpenNotes.delete(e.data.noteId);
                if (e.data.path) this._cachedOpenNotes.delete(this._norm(e.data.path));
                this._notifyListeners();
              }
            };
          } catch (e) {}
        }
      },

      _norm(p) {
        if (!p) return '';
        return String(p).replace(/\\/g, '/').replace(/^\/+/, '').trim();
      },

      _notifyListeners() {
        const notes = Array.from(this._cachedOpenNotes);
        for (const cb of Array.from(this._listeners)) {
          try { cb(notes); } catch (err) { console.warn('AppBridge.noteWindow listener error:', err); }
        }
      },

      async getOpenNotes() {
        if (global.electronAPI?.getOpenNotes) {
          try {
            const list = await global.electronAPI.getOpenNotes();
            if (Array.isArray(list)) {
              this._cachedOpenNotes = new Set(list);
            }
          } catch (e) {}
        }
        return Array.from(this._cachedOpenNotes);
      },

      isNoteOpen(noteId, path) {
        const targetId = noteId && typeof noteId === 'string' ? noteId.trim() : '';
        const targetPath = this._norm(path);
        if (targetId && this._cachedOpenNotes.has(targetId)) return true;
        if (targetPath && this._cachedOpenNotes.has(targetPath)) return true;
        return false;
      },

      onOpenNotesChanged(callback) {
        if (typeof callback !== 'function') return () => {};
        this._listeners.add(callback);
        return () => this._listeners.delete(callback);
      },

      open(noteId, path) {
        if (global.electronAPI?.openNoteWindow) {
          global.electronAPI.openNoteWindow(noteId, path);
          return true;
        }
        try {
          const url = new URL(global.location.href);
          if (noteId) {
            url.hash = `note=${encodeURIComponent(noteId)}`;
          } else if (path) {
            url.hash = `path=${encodeURIComponent(path)}`;
          }
          global.open(url.toString(), '_blank', 'noopener');
          return true;
        } catch (e) {
          console.warn('AppBridge.noteWindow.open failed', e);
          return false;
        }
      },

      notifyActiveNote(noteId, path) {
        const isStandalone = typeof document !== 'undefined' && (
          document.body.classList.contains('note-window-standalone') ||
          (typeof _isFocusedMode !== 'undefined' && _isFocusedMode) ||
          AppBridge.isFocusedNoteMode()
        );
        if (isStandalone) {
          if (global.electronAPI?.notifyActiveNoteChanged) {
            global.electronAPI.notifyActiveNoteChanged(noteId, path);
          }
          if (this._channel) {
            try {
              this._channel.postMessage({
                type: 'OPEN_NOTE_ANNOUNCE',
                noteId: noteId || '',
                path: path || ''
              });
            } catch (e) {}
          }
        }
      }
    },

    // ═══ AI Chat Window Popout ═══
    chatWindow: {
      open() {
        if (global.electronAPI?.openChatWindow) {
          global.electronAPI.openChatWindow();
          return true;
        }
        try {
          const url = new URL(global.location.href);
          url.hash = 'chat-window=true';
          global.open(url.toString(), '_blank', 'noopener,width=480,height=720');
          return true;
        } catch (e) {
          console.warn('AppBridge.chatWindow.open failed', e);
          return false;
        }
      }
    },

    // ═══ Focus Mode PiP HUD Window Popout ═══
    focusWindow: {
      openPip() {
        if (global.electronAPI?.openFocusPipWindow) {
          global.electronAPI.openFocusPipWindow();
          return true;
        }
        try {
          const url = new URL(global.location.href);
          url.hash = 'focus-pip=true';
          global.open(url.toString(), '_blank', 'noopener,width=320,height=150');
          return true;
        } catch (e) {
          console.warn('AppBridge.focusWindow.openPip failed', e);
          return false;
        }
      }
    },

    // ═══ Native Dialogs ═══
    dialogs: {
      async showSaveDialog(options) {
        if (global.electronAPI?.showSaveDialog) {
          return await global.electronAPI.showSaveDialog(options);
        }
        return null;
      }
    },

    // ═══ Omnibar Global Trigger ═══
    omnibar: {
      onTrigger(callback) {
        if (typeof callback !== 'function') return;
        if (global.electronAPI?.onOmnibarTrigger) {
          global.electronAPI.onOmnibarTrigger(callback);
        }
      }
    },

    // ═══ Theme Notification ═══
    theme: {
      notifyChanged(theme) {
        if (global.electronAPI?.notifyThemeChanged) {
          try { global.electronAPI.notifyThemeChanged(theme); } catch (e) {}
        }
      }
    },

    // ═══ Mode & Environment Helpers ═══
    isFocusedNoteMode() {
      if (typeof _isFocusedMode !== 'undefined' && _isFocusedMode) return true;
      if (typeof document !== 'undefined' && document.body?.classList?.contains('focused-note-mode')) return true;
      if (typeof location !== 'undefined' && location.hash) {
        const hash = location.hash.replace(/^#/, '');
        if (hash.startsWith('note=') || hash.startsWith('path=') || hash.startsWith('preloaded=true') || hash === 'preloaded=true') {
          return true;
        }
      }
      return false;
    },
    isStandaloneChildWindow() {
      if (typeof document !== 'undefined' && document.body) {
        if (document.body.classList.contains('note-window-standalone') ||
            document.body.classList.contains('secretary-window-standalone') ||
            document.body.classList.contains('chat-window-mode') ||
            document.body.classList.contains('focus-pip-mode') ||
            document.body.classList.contains('focused-note-mode')) {
          return true;
        }
        if (document.getElementById('topbar-main-row')) {
          return false;
        }
      }
      if (typeof location !== 'undefined') {
        if (location.pathname && (location.pathname.includes('secretary-window') || location.pathname.includes('note-window'))) {
          return true;
        }
        if (location.hash && (location.hash.includes('chat-window') || location.hash.includes('focus-pip'))) {
          return true;
        }
      }
      return false;
    },
    isNoteModal() {
      return !this.isFocusedNoteMode();
    },

    // ═══ Desktop Notifications ═══
    notifications: {
      async isSupported() {
        if (global.electronAPI?.showNotification) return true;
        if (typeof Notification !== 'undefined') return true;
        return false;
      },
      async requestPermission() {
        if (typeof Notification !== 'undefined' && Notification.requestPermission) {
          try {
            return await Notification.requestPermission();
          } catch (e) {
            return 'denied';
          }
        }
        return 'granted';
      },
      show(title, options = {}) {
        if (global.electronAPI?.showNotification) {
          try {
            global.electronAPI.showNotification(title, options);
            return true;
          } catch (e) {}
        }
        if (typeof Notification !== 'undefined') {
          if (Notification.permission === 'granted') {
            try {
              new Notification(title, {
                body: options.body || '',
                icon: options.icon || undefined
              });
              return true;
            } catch (e) {
              console.warn('Native browser notification error', e);
            }
          } else if (Notification.permission !== 'denied' && Notification.requestPermission) {
            Notification.requestPermission().then(p => {
              if (p === 'granted') {
                try {
                  new Notification(title, {
                    body: options.body || '',
                    icon: options.icon || undefined
                  });
                } catch (e) {}
              }
            });
          }
        }
        return false;
      }
    }
  };

  AppBridge.getSystemAccentColor = (...args) => AppBridge.windowControls.getSystemAccentColor(...args);
  AppBridge.onSystemAccentColorChanged = (...args) => AppBridge.windowControls.onSystemAccentColorChanged(...args);
  AppBridge.setProgressBar = (...args) => AppBridge.windowControls.setProgressBar(...args);
  AppBridge.onAppAction = (...args) => AppBridge.windowControls.onAppAction(...args);

  global.AppBridge = AppBridge;
  global.AppWindowManager = AppBridge.windowManager;
  global.isElectron = () => AppBridge.isElectron;
  global.isFocusedNoteWindow = () => AppBridge.isFocusedNoteMode();
  global.isNoteEditorModal = () => AppBridge.isNoteModal();

  try {
    AppBridge.noteWindow.init();
    if (typeof window !== 'undefined') {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => AppBridge.windowManager.init());
      } else {
        AppBridge.windowManager.init();
      }

      const handleUnload = () => {
        if (typeof currentNote !== 'undefined' && currentNote && AppBridge.isFocusedNoteMode() && AppBridge.noteWindow._channel) {
          try {
            AppBridge.noteWindow._channel.postMessage({
              type: 'CLOSE_NOTE_ANNOUNCE',
              noteId: currentNote.id || '',
              path: currentNote.path || ''
            });
          } catch (e) {}
        }
      };
      window.addEventListener('pagehide', handleUnload);
      window.addEventListener('beforeunload', handleUnload);
    }
  } catch (e) {}
})(typeof window !== 'undefined' ? window : this);

