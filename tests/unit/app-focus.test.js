import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Board Focus & Lane Expanded View (app-focus.js)', () => {
  beforeEach(() => {
    // Setup required global mocks for app-focus
    globalThis._isApplyingHash = false;
    globalThis.expandedLaneVal = null;
    globalThis.focusModeFullScreen = false;
    globalThis.focusNotesListCollapsed = true;
    globalThis.focusDrawerOpen = false;
    globalThis.focusDrawerMode = null;
    globalThis.laneAxis = 'week';
    globalThis.weekCutoffWeeks = 4;
    globalThis.renderBoard = vi.fn();
    globalThis.updateUrlHash = vi.fn();

    loadScriptsIntoGlobal([
      'js/app-utils.js',
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-focus.js'
    ]);
    globalThis.renderBoard = vi.fn();
    globalThis.updateUrlHash = vi.fn();
  });

  describe('Focus View Lifecycle', () => {
    it('opens lane focus, resets collapsed state, and triggers board rendering', () => {
      openLaneFocus('2026-W38');
      expect(expandedLaneVal).toBe('2026-W38');
      expect(focusModeFullScreen).toBe(false);
      expect(focusNotesListCollapsed).toBe(true);
      expect(focusDrawerOpen).toBe(false);
      expect(renderBoard).toHaveBeenCalled();
      expect(updateUrlHash).toHaveBeenCalled();
    });

    it('closes lane focus and resets full-screen mode', () => {
      openLaneFocus('2026-W38');
      closeLaneFocus();
      expect(expandedLaneVal).toBeNull();
      expect(focusModeFullScreen).toBe(false);
      expect(renderBoard).toHaveBeenCalled();
      expect(updateUrlHash).toHaveBeenCalled();
    });

    it('toggles focus full screen flag', () => {
      expect(focusModeFullScreen).toBe(false);
      toggleFocusFullScreen();
      expect(focusModeFullScreen).toBe(true);
      toggleFocusFullScreen();
      expect(focusModeFullScreen).toBe(false);
    });
  });

  describe('Side Pane State & Persistence', () => {
    it('manages side pane modes between notes and tags', () => {
      openFocusSidePane('notes');
      expect(getFocusSidePaneMode()).toBe('notes');
      expect(focusNotesListCollapsed).toBe(false);

      openFocusSidePane('tags');
      expect(getFocusSidePaneMode()).toBe('tags');
      expect(focusNotesListCollapsed).toBe(true);
      expect(focusDrawerOpen).toBe(true);

      closeFocusSidePane();
      expect(getFocusSidePaneMode()).toBeNull();
      expect(focusNotesListCollapsed).toBe(true);
      expect(focusDrawerOpen).toBe(false);
    });
  });

  describe('Lane Notes Filtering', () => {
    it('filters notes by major topic tag when laneAxis is topic', () => {
      globalThis.laneAxis = 'topic';
      const notes = [
        { id: '1', major_topic_tags: ['Architecture'] },
        { id: '2', major_topic_tags: ['Frontend'] },
        { id: '3', major_topic_tags: [] }
      ];

      const archNotes = getFocusLaneNotes(notes, 'Architecture');
      expect(archNotes.length).toBe(1);
      expect(archNotes[0].id).toBe('1');

      const untaggedNotes = getFocusLaneNotes(notes, '(Untagged)');
      expect(untaggedNotes.length).toBe(1);
      expect(untaggedNotes[0].id).toBe('3');
    });
  });
});
