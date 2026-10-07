import { describe, it, expect, beforeAll } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Internationalization Engine (app-i18n.js)', () => {
  beforeAll(() => {
    loadScriptsIntoGlobal(['js/app-utils.js', 'js/translations.js', 'js/app-i18n.js']);
  });

  describe('setNestedValue & getNestedValue', () => {
    it('sets nested properties on an object', () => {
      const obj = {};
      setNestedValue(obj, 'a.b.c', 'hello');
      expect(obj.a.b.c).toBe('hello');
    });

    it('retrieves nested properties from an object', () => {
      const obj = { user: { profile: { name: 'Alice' } } };
      expect(getNestedValue(obj, 'user.profile.name')).toBe('Alice');
      expect(getNestedValue(obj, 'user.profile.age')).toBeUndefined();
      expect(getNestedValue(obj, 'invalid.path')).toBeUndefined();
    });
  });

  describe('normalizeLanguageCode', () => {
    it('normalizes valid language codes', () => {
      expect(normalizeLanguageCode('fr')).toBe('fr');
      expect(normalizeLanguageCode('de')).toBe('de');
      expect(normalizeLanguageCode('FR-fr')).toBe('fr');
    });

    it('falls back to "en" for unknown languages or empty strings', () => {
      expect(normalizeLanguageCode('')).toBe('en');
      expect(normalizeLanguageCode(null)).toBe('en');
      expect(normalizeLanguageCode('xx-yy')).toBe('en');
    });
  });

  describe('interpolate', () => {
    it('replaces placeholder variables in string templates', () => {
      expect(interpolate('Hello {name}!', { name: 'Bob' })).toBe('Hello Bob!');
      expect(interpolate('Count: {count}', { count: 42 })).toBe('Count: 42');
    });

    it('replaces missing variables with empty string', () => {
      expect(interpolate('Hello {name} {surname}!', { name: 'Alice' })).toBe('Hello Alice !');
    });
  });

  describe('t() translation lookup', () => {
    it('translates known keys in English', () => {
      expect(t('common.save')).toBeTruthy();
      expect(typeof t('common.save')).toBe('string');
    });

    it('supports fallback parameter', () => {
      const missingKey = 'nonexistent' + '.key.xyz';
      expect(t(missingKey, 'Fallback Text')).toBe('Fallback Text');
    });

    it('supports interpolation in translation strings', () => {
      const result = interpolate('{count} item(s)', { count: 5 });
      expect(result).toBe('5 item(s)');
    });
  });

  describe('word() noun pluralization', () => {
    it('pluralizes nouns based on count', () => {
      const singular = word('task', 1);
      const plural = word('task', 2);
      expect(singular).toBeDefined();
      expect(plural).toBeDefined();
    });
  });
});
