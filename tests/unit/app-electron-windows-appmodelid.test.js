import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  APP_ID,
  resolveAppIconPath,
  configureAppUserModelId,
  applyWindowAppDetails
} from '../../electron/window-utils.js';

describe('Windows AppUserModelID & Taskbar Window Grouping (electron/window-utils.js)', () => {
  it('has APP_ID that strictly matches package.json build.appId', () => {
    const pkgPath = path.resolve(process.cwd(), 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    expect(pkg.build?.appId).toBeDefined();
    expect(APP_ID).toBe(pkg.build.appId);
  });

  it('configures app.setAppUserModelId on Windows with the matching APP_ID', () => {
    const mockApp = {
      setAppUserModelId: vi.fn()
    };

    const winResult = configureAppUserModelId(mockApp, 'win32');
    expect(winResult).toBe(true);
    expect(mockApp.setAppUserModelId).toHaveBeenCalledWith(APP_ID);

    // Should not call on macOS or Linux
    const macMockApp = { setAppUserModelId: vi.fn() };
    const macResult = configureAppUserModelId(macMockApp, 'darwin');
    expect(macResult).toBe(false);
    expect(macMockApp.setAppUserModelId).not.toHaveBeenCalled();
  });

  it('resolves icon.ico on Windows and icon.png on other platforms', () => {
    const electronDir = path.resolve(process.cwd(), 'electron');
    const winIcon = resolveAppIconPath('win32', electronDir);
    expect(winIcon.endsWith('icon.ico')).toBe(true);
    expect(fs.existsSync(winIcon)).toBe(true);

    const macIcon = resolveAppIconPath('darwin', electronDir);
    expect(macIcon.endsWith('icon.png')).toBe(true);
    expect(fs.existsSync(macIcon)).toBe(true);
  });

  it('applies setAppDetails with APP_ID and icon path on Windows windows', () => {
    const mockWin = {
      isDestroyed: () => false,
      setAppDetails: vi.fn()
    };

    const applied = applyWindowAppDetails(mockWin, 'win32', 'C:\\path\\to\\icon.ico');
    expect(applied).toBe(true);
    expect(mockWin.setAppDetails).toHaveBeenCalledWith({
      appId: APP_ID,
      appIconPath: 'C:\\path\\to\\icon.ico'
    });

    const mockDestroyedWin = {
      isDestroyed: () => true,
      setAppDetails: vi.fn()
    };
    expect(applyWindowAppDetails(mockDestroyedWin, 'win32', 'C:\\path\\to\\icon.ico')).toBe(false);
    expect(mockDestroyedWin.setAppDetails).not.toHaveBeenCalled();
  });

  it('ensures electron/main.js invokes configureAppUserModelId and handles window app details', () => {
    const mainJsPath = path.resolve(process.cwd(), 'electron/main.js');
    const mainJsContent = fs.readFileSync(mainJsPath, 'utf8');

    expect(mainJsContent).toContain('configureAppUserModelId');
    expect(mainJsContent).toContain('applyWindowAppDetails');
  });

  it('configures Windows electron-builder build settings with signAndEditExecutable: false to avoid antivirus false-positives', () => {
    const pkgPath = path.resolve(process.cwd(), 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

    expect(pkg.build?.win?.icon).toBe('icon.png');
    expect(pkg.build?.win?.signAndEditExecutable).toBe(false);

    const pngPath = path.resolve(process.cwd(), 'icon.png');
    expect(fs.existsSync(pngPath)).toBe(true);
  });
});
