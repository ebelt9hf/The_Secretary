import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Popover & Modal Manager (app-popover-manager.js)', () => {
  beforeEach(() => {
    loadScriptsIntoGlobal(['js/app-popover-manager.js']);
    document.body.innerHTML = '';
    window.PopoverManager.closeAll();
  });

  it('registers and tracks active popover elements', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);

    window.PopoverManager.register('test-popover', el);
    expect(window.PopoverManager.activePopovers.has('test-popover')).toBe(true);
  });

  it('closes popover and invokes lifecycle callbacks (onClose, onSave)', () => {
    const el = document.createElement('div');
    el.style.display = 'block';
    document.body.appendChild(el);

    const onSave = vi.fn();
    const onClose = vi.fn();

    window.PopoverManager.register('test-popover', el, { onSave, onClose });
    window.PopoverManager.close('test-popover');

    expect(onSave).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
    expect(window.PopoverManager.activePopovers.has('test-popover')).toBe(false);
  });

  it('closes active popovers when Escape key is pressed', () => {
    const el1 = document.createElement('div');
    const el2 = document.createElement('div');
    document.body.appendChild(el1);
    document.body.appendChild(el2);

    const onClose1 = vi.fn();
    const onClose2 = vi.fn();

    window.PopoverManager.register('pop1', el1, { onClose: onClose1 });
    window.PopoverManager.register('pop2', el2, { onClose: onClose2 });

    const escEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    document.dispatchEvent(escEvent);

    expect(onClose1).toHaveBeenCalled();
    expect(onClose2).toHaveBeenCalled();
    expect(window.PopoverManager.activePopovers.size).toBe(0);
  });

  it('closes popover on outside click unless target is inside or ignored', () => {
    const popoverEl = document.createElement('div');
    const insideBtn = document.createElement('button');
    popoverEl.appendChild(insideBtn);

    const outsideBtn = document.createElement('button');
    outsideBtn.className = 'ignore-toggle-btn';

    const randomOutsideEl = document.createElement('div');

    document.body.appendChild(popoverEl);
    document.body.appendChild(outsideBtn);
    document.body.appendChild(randomOutsideEl);

    const onClose = vi.fn();
    window.PopoverManager.register('pop-outside', popoverEl, {
      onClose,
      ignoreElements: ['.ignore-toggle-btn'],
    });

    // 1. Click inside popover -> should NOT close
    insideBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();

    // 2. Click ignored button -> should NOT close
    outsideBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();

    // 3. Click random outside element -> SHOULD close
    randomOutsideEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
