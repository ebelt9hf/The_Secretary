import { describe, it, expect, beforeAll } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Special Letters & Multilingual Unicode Handling', () => {
  beforeAll(() => {
    loadScriptsIntoGlobal([
      'js/app-utils.js',
      'js/app-notes.js',
      'js/app-topic-memory.js',
      'js/app-llm.js'
    ]);
  });

  describe('formatTodoTitleWithMetadata - Unicode Owner Mentions', () => {
    it('strips owner mentions with accented characters, Cyrillic, and extended European letters', () => {
      expect(formatTodoTitleWithMetadata('@Étienne: Deliver final UI layout', 'Étienne', 'High')).toBe('Deliver final UI layout');
      expect(formatTodoTitleWithMetadata('@François update deployment docs', 'François', 'Medium')).toBe('update deployment docs');
      expect(formatTodoTitleWithMetadata('@Jörg: Check server metrics', 'Jörg', 'Low')).toBe('Check server metrics');
      expect(formatTodoTitleWithMetadata('@Łukasz: Finalize Polish translations', 'Łukasz', 'High')).toBe('Finalize Polish translations');
      expect(formatTodoTitleWithMetadata('@Ömer: Database migration', 'Ömer', 'High')).toBe('Database migration');
      expect(formatTodoTitleWithMetadata('@Ярослав: Review PR', 'Ярослав', 'Medium')).toBe('Review PR');
    });
  });

  describe('isMeaningfulMetadataDecisionText - Multilingual Decision Texts', () => {
    it('recognizes valid decisions in Ukrainian, Russian, Czech, Polish, Turkish, and Romanian', () => {
      expect(isMeaningfulMetadataDecisionText('Рішення прийнято одноголосно')).toBe(true); // Ukrainian
      expect(isMeaningfulMetadataDecisionText('Решение утверждено на совете')).toBe(true); // Russian
      expect(isMeaningfulMetadataDecisionText('Schválení klíčového rozpočtu č. 4')).toBe(true); // Czech (č)
      expect(isMeaningfulMetadataDecisionText('Zatwierdzenie nowego połączenia sieciowego')).toBe(true); // Polish (ł)
      expect(isMeaningfulMetadataDecisionText('Yeni Değişiklikler Kabul Edildi')).toBe(true); // Turkish (ğ, Ş)
      expect(isMeaningfulMetadataDecisionText('Decizia a fost aprobată în ședință')).toBe(true); // Romanian (ș)
    });
  });

  describe('sanitizeTopicMemoryKey - Unicode Workstream Names', () => {
    it('sanitizes workstream titles with accents into clean ASCII key names', () => {
      expect(sanitizeTopicMemoryKey('Projet Électronique')).toBe('projet_electronique');
      expect(sanitizeTopicMemoryKey('Développement Système')).toBe('developpement_systeme');
      expect(sanitizeTopicMemoryKey('Nächste Schritte & Aufgaben')).toBe('nachste_schritte_aufgaben');
    });
  });
});
