import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Retrospective Flash / Pulse Indicator Logic (app-retro.js)', () => {
  beforeEach(() => {
    loadScriptsIntoGlobal([
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-utils.js',
      'js/app-retro.js'
    ]);

    document.body.innerHTML = `
      <div id="tab-retro-wrapper">
        <button id="tab-retro" class="tab-btn">Retrospective</button>
        <div id="retro-hover-card" style="display:none;"></div>
      </div>
    `;

    globalThis.settings = {
      ui: {
        workingDays: [1, 2, 3, 4, 5],
        workEndTime: '18:30'
      }
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does NOT pulse or blink when there are no notes to review for today', () => {
    // Mock time to 18:00 (within 1 hour before 18:30 closing on a Friday)
    const mockFriday = new Date(2026, 9, 9, 18, 0, 0); // 2026-10-09 is a Friday
    vi.setSystemTime(mockFriday);

    // Empty manifest -> 0 notes to review
    globalThis.manifest = [];

    const inWindow = window.isEndOfDayReviewWindow();
    expect(inWindow).toBe(false);

    window.updateRetroFlashAndHoverState();
    const tabBtn = document.getElementById('tab-retro');
    expect(tabBtn.classList.contains('retro-flash-active')).toBe(false);
  });

  it('does NOT pulse or blink when all notes for today are already reviewed', () => {
    const mockFriday = new Date(2026, 9, 9, 18, 0, 0);
    vi.setSystemTime(mockFriday);

    globalThis.manifest = [
      { id: 'note-1', date: '2026-10-09', path: 'notes/note1.html', reviewed: true },
      { id: 'note-2', date: '2026-10-09', path: 'notes/note2.html', reviewed: true }
    ];

    const inWindow = window.isEndOfDayReviewWindow();
    expect(inWindow).toBe(false);

    window.updateRetroFlashAndHoverState();
    const tabBtn = document.getElementById('tab-retro');
    expect(tabBtn.classList.contains('retro-flash-active')).toBe(false);
  });

  it('pulses and blinks when there are unreviewed notes to review within the review window', () => {
    const mockFriday = new Date(2026, 9, 9, 18, 0, 0);
    vi.setSystemTime(mockFriday);

    globalThis.manifest = [
      { id: 'note-1', date: '2026-10-09', path: 'notes/note1.html', reviewed: false }
    ];

    const inWindow = window.isEndOfDayReviewWindow();
    expect(inWindow).toBe(true);

    window.updateRetroFlashAndHoverState();
    const tabBtn = document.getElementById('tab-retro');
    expect(tabBtn.classList.contains('retro-flash-active')).toBe(true);
  });

  it('does NOT pulse outside the review window even if unreviewed notes exist', () => {
    // 10:00 AM
    const mockFridayMorning = new Date(2026, 9, 9, 10, 0, 0);
    vi.setSystemTime(mockFridayMorning);

    globalThis.manifest = [
      { id: 'note-1', date: '2026-10-09', path: 'notes/note1.html', reviewed: false }
    ];

    const inWindow = window.isEndOfDayReviewWindow();
    expect(inWindow).toBe(false);

    window.updateRetroFlashAndHoverState();
    const tabBtn = document.getElementById('tab-retro');
    expect(tabBtn.classList.contains('retro-flash-active')).toBe(false);
  });
});
