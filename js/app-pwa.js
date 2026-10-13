// ── Secretary: Progressive Web App (PWA) Manager ──
// Manages web app manifest lifecycle, beforeinstallprompt event handling, service worker registration,
// and UI install button visibility across supported browsers.

(function(global) {
  'use strict';

  let deferredPrompt = null;
  let isRegistered = false;

  const PwaManager = {
    get isElectron() {
      return !!(
        global.AppBridge?.isElectron ||
        global.electronAPI?.isElectron ||
        (typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent))
      );
    },

    get isStandalone() {
      if (typeof window === 'undefined') return false;
      const displayModeStandalone = !!(
        window.matchMedia &&
        window.matchMedia('(display-mode: standalone)').matches
      );
      const navigatorStandalone = !!(
        typeof navigator !== 'undefined' &&
        navigator.standalone === true
      );
      return displayModeStandalone || navigatorStandalone;
    },

    get isIOS() {
      if (typeof navigator === 'undefined') return false;
      return (
        /iPad|iPhone|iPod/.test(navigator.userAgent) &&
        !(typeof window !== 'undefined' && window.MSStream)
      );
    },

    get canPrompt() {
      return !!deferredPrompt;
    },

    get deferredPrompt() {
      return deferredPrompt;
    },

    setDeferredPrompt(e) {
      deferredPrompt = e;
      this.updateUI();
    },

    isInstallable() {
      if (this.isElectron || this.isStandalone) {
        return false;
      }
      return !!deferredPrompt || this.isIOS;
    },

    init() {
      if (typeof window === 'undefined') return;

      // Never activate PWA install prompts inside native Electron desktop builds
      if (this.isElectron) {
        this.updateUI();
        return;
      }

      // If already installed and launched in standalone mode, hide buttons
      if (this.isStandalone) {
        this.updateUI();
        return;
      }

      // Listen for Chromium install prompt event
      window.addEventListener('beforeinstallprompt', (e) => {
        try {
          e.preventDefault();
        } catch (err) {}
        deferredPrompt = e;
        this.updateUI();
        window.dispatchEvent(new CustomEvent('secretary:pwa-installable', { detail: { canPrompt: true } }));
      });

      // Listen for completed installation event
      window.addEventListener('appinstalled', () => {
        deferredPrompt = null;
        this.updateUI();
        window.dispatchEvent(new CustomEvent('secretary:pwa-installed'));
      });

      // Register Service Worker in supported web environments
      this.registerServiceWorker();

      // Initial UI update (handles iOS detection or restored state)
      this.updateUI();
    },

    async registerServiceWorker() {
      if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
      if (isRegistered || this.isElectron) return;

      if ('serviceWorker' in navigator) {
        const isSecure = (
          window.location.protocol === 'https:' ||
          window.location.hostname === 'localhost' ||
          window.location.hostname === '127.0.0.1'
        );

        if (isSecure) {
          try {
            const registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
            isRegistered = true;

            // Check for service worker updates
            registration.addEventListener('updatefound', () => {
              const installingWorker = registration.installing;
              if (installingWorker) {
                installingWorker.addEventListener('statechange', () => {
                  if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                    console.log('[Secretary PWA] New update available.');
                  }
                });
              }
            });
          } catch (err) {
            console.warn('[Secretary PWA] Service worker registration notice:', err?.message || err);
          }
        }
      }
    },

    async promptInstall() {
      if (this.isElectron || this.isStandalone) {
        return { outcome: 'unsupported' };
      }

      if (deferredPrompt) {
        try {
          deferredPrompt.prompt();
          const choiceResult = await deferredPrompt.userChoice;
          deferredPrompt = null;
          this.updateUI();
          return choiceResult;
        } catch (err) {
          console.error('[Secretary PWA] Error displaying install prompt:', err);
          return { outcome: 'dismissed', error: err };
        }
      }

      // iOS Safari fallback: show instructional modal/toast
      if (this.isIOS) {
        this.showIOSInstallInstructions();
        return { outcome: 'ios_instructions' };
      }

      return { outcome: 'unavailable' };
    },

    showIOSInstallInstructions() {
      if (typeof window === 'undefined') return;
      const msg = typeof window.t === 'function'
        ? window.t('pwa.iosInstructions')
        : "To install Secretary on iOS, tap the Share button in Safari and select 'Add to Home Screen'.";
      if (typeof window.showToast === 'function') {
        window.showToast(msg, 6000);
      } else {
        alert(msg);
      }
    },

    updateUI() {
      if (typeof document === 'undefined') return;

      const shouldShow = this.isInstallable();

      // 1. Topbar install button
      const topbarBtn = document.getElementById('btn-install-app');
      if (topbarBtn) {
        topbarBtn.style.display = shouldShow ? 'inline-flex' : 'none';
      }

      // 2. Landing / Welcome screen install button
      const landingBtn = document.getElementById('btn-landing-install');
      if (landingBtn) {
        landingBtn.style.display = shouldShow ? 'inline-flex' : 'none';
      }

      // 3. Preferences install action card/button
      const prefsBtn = document.getElementById('btn-prefs-pwa-install');
      if (prefsBtn) {
        prefsBtn.style.display = shouldShow ? 'inline-flex' : 'none';
      }

      const prefsInstalledStatus = document.getElementById('prefs-pwa-installed-status');
      if (prefsInstalledStatus) {
        prefsInstalledStatus.style.display = this.isStandalone ? 'block' : 'none';
      }
    }
  };

  // Expose globally
  global.PwaManager = PwaManager;

  // Auto-init on page load if in browser
  if (typeof window !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => PwaManager.init());
    } else {
      PwaManager.init();
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PwaManager;
  }
})(typeof window !== 'undefined' ? window : globalThis);
