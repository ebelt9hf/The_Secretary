/* ── Secretary: Unified Popover & Modal Manager ── */

(function () {
  'use strict';

  class PopoverManager {
    constructor() {
      this.activePopovers = new Map();
      this.initListeners();
    }

    initListeners() {
      document.addEventListener('click', (e) => this.handleOutsideClick(e), true);
      document.addEventListener('keydown', (e) => this.handleKeyDown(e), true);
    }

    register(id, element, options = {}) {
      if (!element) return;
      this.activePopovers.set(id, {
        element,
        onClose: options.onClose || null,
        onSave: options.onSave || null,
        closingClass: options.closingClass || null,
        closingDuration: options.closingDuration || 0,
        ignoreElements: options.ignoreElements || []
      });
    }

    unregister(id) {
      this.activePopovers.delete(id);
    }

    close(id) {
      const popover = this.activePopovers.get(id);
      if (!popover) return;

      if (typeof popover.onSave === 'function') {
        try { popover.onSave(); } catch (err) { console.error('Error in popover onSave:', err); }
      }
      if (typeof popover.onClose === 'function') {
        try { popover.onClose(); } catch (err) { console.error('Error in popover onClose:', err); }
      } else if (popover.element) {
        if (popover.closingClass && popover.closingDuration > 0) {
          popover.element.classList.add(popover.closingClass);
          setTimeout(() => {
            if (popover.element) {
              popover.element.style.display = 'none';
              popover.element.classList.remove(popover.closingClass);
            }
          }, popover.closingDuration);
        } else {
          popover.element.style.display = 'none';
        }
      }

      this.unregister(id);
    }

    closeAll() {
      const ids = Array.from(this.activePopovers.keys());
      ids.forEach((id) => this.close(id));
    }

    handleOutsideClick(e) {
      if (this.activePopovers.size === 0) return;

      const targetEl = e.target && e.target.nodeType === 1 ? e.target : (e.target ? e.target.parentNode : null);
      if (!targetEl || typeof targetEl.closest !== 'function') return;

      this.activePopovers.forEach((popover, id) => {
        if (!popover.element || !popover.element.isConnected) {
          this.unregister(id);
          return;
        }

        const isInsidePopover = popover.element.contains(targetEl);
        const isIgnored = popover.ignoreElements.some((el) => {
          if (typeof el === 'string') {
            return targetEl.closest(el) !== null;
          }
          return el && el.contains && el.contains(targetEl);
        });

        if (!isInsidePopover && !isIgnored) {
          this.close(id);
        }
      });
    }

    handleKeyDown(e) {
      if (e.key === 'Escape' && this.activePopovers.size > 0) {
        e.preventDefault();
        e.stopPropagation();
        this.closeAll();
      }
    }
  }

  window.PopoverManager = new PopoverManager();
})();
