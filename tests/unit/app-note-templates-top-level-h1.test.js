import { describe, it, expect, beforeAll, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Note Templates Top-Level Headers (H1) Contract', () => {
  beforeAll(() => {
    globalThis.window = globalThis.window || {};
    globalThis.escH = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    globalThis.escA = (s) => String(s || '');
    globalThis.toast = vi.fn();
    globalThis.syncPreview = vi.fn();
    globalThis.scheduleAutoSave = vi.fn();
    globalThis.openModal = vi.fn();
    globalThis.closeModal = vi.fn();

    loadScriptsIntoGlobal([
      'js/app-utils.js',
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-notes.js',
      'js/app-overlay.js'
    ]);
  });

  it('ensures getDefaultNoteTemplateHTML uses H1 for all top-level sections', () => {
    const defaultHtml = globalThis.getDefaultNoteTemplateHTML('en');
    expect(defaultHtml).toContain('<h1>Goal</h1>');
    expect(defaultHtml).toContain('<h1>Notes</h1>');
    expect(defaultHtml).toContain('<h1>Decisions</h1>');
    expect(defaultHtml).toContain('<h1>Action Items</h1>');
    expect(defaultHtml).not.toContain('<h2');
  });

  it('ensures all NoteTemplateManager templates use H1 for top-level section headers', () => {
    const templateIds = ['meeting_1on1', 'project_kickoff', 'decision_rfc', 'postmortem', 'daily_standup', 'standard'];

    templateIds.forEach(id => {
      const htmlWithContext = globalThis.NoteTemplateManager.getTemplateHTML(id, 'en', { context: 'Test project context' });
      const htmlWithoutContext = globalThis.NoteTemplateManager.getTemplateHTML(id, 'en');

      // Top level headers must be H1
      expect(htmlWithContext).toContain('<h1>');
      expect(htmlWithoutContext).toContain('<h1>');

      // No top-level sections should be rendered as H2
      expect(htmlWithContext).not.toContain('<h2');
      expect(htmlWithoutContext).not.toContain('<h2');
    });
  });
});
