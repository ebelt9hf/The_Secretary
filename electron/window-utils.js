import fs from 'fs';
import path from 'path';

/**
 * Canonical Application User Model ID (AUMID) matching package.json build.appId.
 * Required for Windows Taskbar grouping, jump lists, notifications, and pinned shortcuts.
 */
export const APP_ID = 'com.secretary.app';

/**
 * Resolves the platform-appropriate application icon path.
 * On Windows, prefers .ico multi-resolution format, falling back to .png.
 *
 * @param {string} platform - Node platform string (e.g. 'win32', 'darwin', 'linux')
 * @param {string} baseDir - Directory path (typically __dirname of electron)
 * @returns {string} Absolute path to resolved icon file
 */
export function resolveAppIconPath(platform = process.platform, baseDir = '') {
  const isWin = platform === 'win32';
  const iconFilename = isWin ? 'icon.ico' : 'icon.png';
  let appIconPath = path.join(baseDir, '..', iconFilename);
  if (!fs.existsSync(appIconPath)) {
    appIconPath = path.join(baseDir, iconFilename);
  }
  if (!fs.existsSync(appIconPath) && isWin) {
    const fallbackPath = path.join(baseDir, '..', 'icon.png');
    if (fs.existsSync(fallbackPath)) {
      appIconPath = fallbackPath;
    }
  }
  return appIconPath;
}

/**
 * Configures the explicit process-level AppUserModelID on Windows.
 * Ensures the running process and all spawned windows map to the pinned taskbar shortcut.
 *
 * @param {object} app - Electron app instance
 * @param {string} platform - Node platform string
 * @returns {boolean} True if successfully applied
 */
export function configureAppUserModelId(app, platform = process.platform) {
  if (platform === 'win32' && app && typeof app.setAppUserModelId === 'function') {
    try {
      app.setAppUserModelId(APP_ID);
      return true;
    } catch (e) {
      console.warn('[Secretary Main] Failed to set AppUserModelId:', e);
      return false;
    }
  }
  return false;
}

/**
 * Applies window-level AppDetails (appId and icon) on Windows BrowserWindow instances.
 * Ensures all windows (main, editor notes, AI companion chat, etc.) strictly group
 * under the single pinned taskbar icon instead of separating.
 *
 * @param {object} win - Electron BrowserWindow instance
 * @param {string} platform - Node platform string
 * @param {string} iconPath - Optional path to application icon
 * @returns {boolean} True if successfully applied
 */
export function applyWindowAppDetails(win, platform = process.platform, iconPath = '') {
  if (!win || win.isDestroyed?.()) return false;
  if (platform === 'win32' && typeof win.setAppDetails === 'function') {
    try {
      const details = { appId: APP_ID };
      if (iconPath) {
        details.appIconPath = iconPath;
      }
      win.setAppDetails(details);
      return true;
    } catch (e) {
      console.warn('[Secretary Main] Failed to setAppDetails on window:', e);
      return false;
    }
  }
  return false;
}

/**
 * Returns Window Controls Overlay (WCO) titlebar configuration options.
 * Matches Secretary caption colors dynamically to active UI themes.
 *
 * @param {boolean} isDark - Whether the current theme is dark
 * @returns {object} TitleBarOverlay options for Electron BrowserWindow
 */
export function getTitleBarOverlayOptions(isDark = false) {
  return {
    color: isDark ? '#090e18' : '#1e1b4b',
    symbolColor: '#ffffff',
    height: 40
  };
}

/**
 * Generates platform-specific window frame and DWM material options.
 * On Windows: Enables native Window Controls Overlay (WCO) for Snap Layouts flyout,
 * and enables Windows 11 Mica background material.
 * On macOS: Enables hiddenInset titleBarStyle with traffic light positioning.
 *
 * @param {string} platform - Node platform string (e.g. 'win32', 'darwin', 'linux')
 * @param {boolean} isDark - Whether dark theme is active
 * @returns {object} BrowserWindow frame options
 */
export function getWindowFrameOptions(platform = process.platform, isDark = false) {
  if (platform === 'darwin') {
    return {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 14 }
    };
  }
  if (platform === 'win32') {
    return {
      titleBarStyle: 'hidden',
      autoHideMenuBar: true,
      backgroundMaterial: 'mica'
    };
  }
  return {
    titleBarStyle: 'hidden',
    autoHideMenuBar: true
  };
}

/**
 * Formats Windows system accent color into standard #RRGGBB hex string.
 *
 * @param {string} rawColor - Raw accent hex string from Electron systemPreferences
 * @returns {string|null} Formatted hex string or null
 */
export function formatSystemAccentColor(rawColor) {
  if (!rawColor || typeof rawColor !== 'string') return null;
  const clean = rawColor.replace(/^#/, '').trim();
  if (clean.length >= 6) {
    return `#${clean.slice(0, 6)}`;
  }
  return null;
}

/**
 * Applies taskbar progress indicator on a BrowserWindow instance.
 *
 * @param {object} win - BrowserWindow instance
 * @param {number} progress - Progress fraction (0 to 1, or -1 to clear)
 * @param {object} [options] - Optional Windows taskbar progress mode ({ mode: 'none'|'normal'|'indeterminate'|'error'|'paused' })
 * @returns {boolean} True if successfully applied
 */
export function applyWindowProgressBar(win, progress = -1, options = null) {
  if (!win || win.isDestroyed?.()) return false;
  if (typeof win.setProgressBar !== 'function') return false;
  try {
    const val = typeof progress === 'number' && !Number.isNaN(progress) ? progress : -1;
    if (options && typeof options === 'object') {
      win.setProgressBar(val, options);
    } else {
      win.setProgressBar(val);
    }
    return true;
  } catch (e) {
    console.warn('[Secretary Main] Failed to set window progress bar:', e);
    return false;
  }
}

/**
 * Configures the Windows Taskbar Jump List with quick productivity actions.
 *
 * @param {object} app - Electron app instance
 * @param {string} platform - Node platform string
 * @param {string} execPath - Path to executable (default process.execPath)
 * @returns {boolean} True if successfully applied
 */
export function configureWindowsJumpList(app, platform = process.platform, execPath = process.execPath) {
  if (platform !== 'win32' || !app || typeof app.setJumpList !== 'function') return false;
  try {
    app.setJumpList([
      {
        type: 'tasks',
        items: [
          {
            type: 'task',
            title: 'New Note',
            description: 'Create a new note in Secretary',
            program: execPath,
            args: '--action=new-note',
            iconPath: execPath,
            iconIndex: 0
          },
          {
            type: 'task',
            title: 'Planner',
            description: 'Open Secretary Planner',
            program: execPath,
            args: '--action=planner',
            iconPath: execPath,
            iconIndex: 0
          }
        ]
      },
      {
        type: 'frequent'
      }
    ]);
    return true;
  } catch (e) {
    console.warn('[Secretary Main] Failed to configure Windows Jump List:', e);
    return false;
  }
}

/**
 * Parses application action passed via command-line arguments (e.g. from Windows Jump List).
 *
 * @param {string[]} args - Process command-line argument array
 * @returns {string|null} Parsed action name or null
 */
export function parseCommandLineAction(args) {
  if (!Array.isArray(args)) return null;
  const match = args.find(a => typeof a === 'string' && a.startsWith('--action='));
  if (match) {
    return match.split('=')[1].trim();
  }
  return null;
}

