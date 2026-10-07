import { describe, it, expect, beforeAll } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('App Icons & SVG Registry (app-icons.js)', () => {
  beforeAll(() => {
    loadScriptsIntoGlobal(['js/app-utils.js', 'js/translations.js', 'js/app-i18n.js', 'js/app-icons.js']);
  });

  describe('AppIcons.has', () => {
    it.each([
      ['planner', true],
      ['todos', true],
      ['notes', true],
      ['target', true],
      ['⭐', true],
      ['nonexistent-icon-xyz', false],
      ['', false],
      [null, false],
    ])('checks if icon/emoji "%s" is recognized -> %s', (name, expected) => {
      expect(AppIcons.has(name)).toBe(expected);
    });
  });

  describe('AppIcons.get & getAppIcon', () => {
    it('returns SVG string with requested size and class', () => {
      const svg = AppIcons.get('planner', { size: 24, className: 'custom-icon' });
      expect(svg).toContain('<svg');
      expect(svg).toContain('width="24"');
      expect(svg).toContain('height="24"');
      expect(svg).toContain('class="custom-icon"');
    });

    it('resolves mapped emojis to proper SVGs', () => {
      const svg = AppIcons.get('🎯', { size: 18 });
      expect(svg).toContain('<svg');
      expect(svg).toContain('width="18"');
    });

    it('falls back gracefully to default icon for unknown names', () => {
      const svg = AppIcons.get('unknown-random-name');
      expect(svg).toContain('<svg');
    });

    it('returns empty string for empty/null keys', () => {
      expect(AppIcons.get('')).toBe('');
      expect(AppIcons.get(null)).toBe('');
    });

    it('global getAppIcon matches AppIcons.get', () => {
      const direct = AppIcons.get('notes', { size: 16, className: 'test-cls' });
      const helper = getAppIcon('notes', 16, 'test-cls');
      expect(helper).toBe(direct);
    });
  });

  describe('AppIcons.wrap & AppIcons.btn', () => {
    it('wraps an icon and text in a structured ui-icon-wrap container', () => {
      const html = AppIcons.wrap('tag', 'Marketing', { iconClass: 'my-icon', textClass: 'my-text' });
      expect(html).toContain('class="ui-icon-wrap my-icon"');
      expect(html).toContain('class="my-text">Marketing</span>');
    });

    it('creates button inner markup with translated labels and escaping', () => {
      const html = AppIcons.btn('plus', 'common.save', 'Save Note');
      expect(html).toContain('ui-icon-wrap');
      expect(html).toContain('planner-ctx-text');
    });
  });
});
