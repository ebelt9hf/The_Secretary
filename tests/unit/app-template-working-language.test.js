import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Note Templates Working Language & Header Preview Engine', () => {
  beforeAll(() => {
    globalThis.window = globalThis.window || {};
    globalThis.escH = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    globalThis.escA = (s) => String(s || '');
    globalThis.toast = vi.fn();
    globalThis.syncPreview = vi.fn();
    globalThis.scheduleAutoSave = vi.fn();
    globalThis.openModal = vi.fn();
    globalThis.closeModal = vi.fn();
    globalThis.broadcastSync = vi.fn();
    globalThis.saveLocalSettings = vi.fn();
    globalThis.saveFolderSettingsDebounced = vi.fn();
    globalThis.renderPrefs = vi.fn();
    globalThis.renderBoard = vi.fn();
    globalThis.setAppLanguage = vi.fn();
    globalThis.mdToPreviewHTML = (md) => `<div>${md}</div>`;
    globalThis.generateNoteId = () => 'note-12345';
    globalThis.getCanonicalNotePath = (id) => `notes/${id}.html`;
    globalThis.buildNewNoteHTML = (note) => note.mainHTML;
    globalThis.upsertManifest = vi.fn();
    globalThis.saveManifest = vi.fn();
    globalThis.rebuildIndexHTML = vi.fn();
    globalThis.renderFilterChips = vi.fn();
    globalThis.openNoteOverlay = vi.fn();
    globalThis.switchTab = vi.fn();
    globalThis.showPlannerNoteGenerationProgress = () => vi.fn();
    globalThis.savePlanner = vi.fn();
    globalThis.renderPlanner = vi.fn();
    globalThis.showMdTab = vi.fn();

    globalThis.StorageAPI = {
      saveSnapshot: vi.fn(),
      writeNoteContent: vi.fn().mockResolvedValue(true)
    };

    loadScriptsIntoGlobal([
      'js/app-utils.js',
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-notes.js',
      'js/app-overlay.js',
      'js/app-collab.js',
      'js/app-planner.js'
    ]);
  });

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="modal-template-picker">
        <select id="template-picker-lang-select"></select>
        <div id="template-picker-grid"></div>
        <div id="template-picker-merge-container">
          <input type="checkbox" id="template-picker-merge-checkbox" checked>
        </div>
      </div>
      <div class="modal-overlay" id="modal-new-note">
        <input id="nn-title" value="" />
        <input id="nn-date" value="" />
        <input id="nn-group" value="" />
        <input id="nn-major" value="" />
        <input id="nn-topic" value="" />
        <textarea id="nn-content"></textarea>
      </div>
      <div id="edit-textarea" contenteditable="true"></div>
    `;

    globalThis.settings = {
      ui: { theme: 'system', colors: {} },
      folder: { last: null },
      language: 'fr',
      workingLanguage: 'en'
    };
    globalThis.currentNote = {
      id: 'test-note-1',
      path: 'notes/test-note-1.html',
      mainHTML: ''
    };
    globalThis.StorageAPI.saveSnapshot.mockClear();
    globalThis.StorageAPI.writeNoteContent.mockClear();
  });

  describe('Working Language Setting & Resolution', () => {
    it('returns workingLanguage from settings when set', () => {
      globalThis.settings.workingLanguage = 'de';
      expect(getWorkingLanguage()).toBe('de');

      globalThis.settings.workingLanguage = 'fr';
      expect(getWorkingLanguage()).toBe('fr');
    });

    it('falls back to "en" when workingLanguage is missing or invalid', () => {
      globalThis.settings.workingLanguage = null;
      expect(getWorkingLanguage()).toBe('en');

      globalThis.settings.workingLanguage = 'invalid-lang-code';
      expect(getWorkingLanguage()).toBe('en');
    });

    it('prioritizes workingLanguage in getNoteLanguage()', () => {
      globalThis.settings.language = 'fr';
      globalThis.settings.workingLanguage = 'en';
      expect(getNoteLanguage()).toBe('en');

      globalThis.settings.workingLanguage = 'de';
      expect(getNoteLanguage()).toBe('de');
    });
  });

  describe('Template Manager Localization & Header Previews', () => {
    it('returns templates with localized headers preview for English', () => {
      const templates = NoteTemplateManager.getTemplates('en');
      const meeting1on1 = templates.find(t => t.id === 'meeting_1on1');
      expect(meeting1on1).toBeDefined();
      expect(meeting1on1.name).toBe('1-on-1 Meeting');
      expect(Array.isArray(meeting1on1.headers)).toBe(true);
      expect(meeting1on1.headers).toContain('Personal & Context Check-in');
      expect(meeting1on1.headers).toContain('Agenda & Priorities');
      expect(meeting1on1.headers).toContain('Feedback & Discussion Topics');
      expect(meeting1on1.headers).toContain('Agreed Decisions');
      expect(meeting1on1.headers).toContain('Action Items');
    });

    it('returns templates with localized headers preview for French', () => {
      const templates = NoteTemplateManager.getTemplates('fr');
      const meeting1on1 = templates.find(t => t.id === 'meeting_1on1');
      expect(meeting1on1).toBeDefined();
      expect(meeting1on1.name).toBe('Réunion 1-à-1');
      expect(meeting1on1.headers).toContain('Prise de contact personnelle et contexte');
      expect(meeting1on1.headers).toContain('Ordre du jour et priorités');
      expect(meeting1on1.headers).toContain('Retours et thèmes de discussion');
      expect(meeting1on1.headers).toContain('Décisions convenues');
      expect(meeting1on1.headers).toContain('Actions à mener');
    });

    it('generates HTML with localized headers for meeting_1on1 in different languages', () => {
      const enHtml = NoteTemplateManager.getTemplateHTML('meeting_1on1', 'en');
      expect(enHtml).toContain('<h2>Personal &amp; Context Check-in</h2>');
      expect(enHtml).toContain('<h2>Agenda &amp; Priorities</h2>');

      const frHtml = NoteTemplateManager.getTemplateHTML('meeting_1on1', 'fr');
      expect(frHtml).toContain('<h2>Prise de contact personnelle et contexte</h2>');
      expect(frHtml).toContain('<h2>Ordre du jour et priorités</h2>');

      const deHtml = NoteTemplateManager.getTemplateHTML('meeting_1on1', 'de');
      expect(deHtml).toContain('<h2>Persönlicher Check-in und Kontext</h2>');
      expect(deHtml).toContain('<h2>Agenda und Prioritäten</h2>');
    });

    it('generates HTML with localized headers for project_kickoff and postmortem', () => {
      const enKickoff = NoteTemplateManager.getTemplateHTML('project_kickoff', 'en');
      expect(enKickoff).toContain('Problem Statement &amp; Objectives');

      const frPostmortem = NoteTemplateManager.getTemplateHTML('postmortem', 'fr');
      expect(frPostmortem).toContain('Résumé exécutif de l\'incident');
    });
  });

  describe('Template Picker UI & Header Rendering', () => {
    it('renders template cards with header pills in selected language', () => {
      renderTemplatePickerGrid('en');
      const grid = document.getElementById('template-picker-grid');
      expect(grid.children.length).toBeGreaterThanOrEqual(5);

      const pills = grid.querySelectorAll('.template-header-pill');
      expect(pills.length).toBeGreaterThan(0);
      const pillTexts = Array.from(pills).map(p => p.textContent);
      expect(pillTexts).toContain('Personal & Context Check-in');
    });

    it('switches template header language live when onTemplatePickerLanguageChange is called', () => {
      renderTemplatePickerGrid('en');
      let grid = document.getElementById('template-picker-grid');
      expect(grid.textContent).toContain('1-on-1 Meeting');

      onTemplatePickerLanguageChange('fr');
      grid = document.getElementById('template-picker-grid');
      expect(grid.textContent).toContain('Réunion 1-à-1');
      expect(grid.textContent).toContain('Prise de contact personnelle et contexte');
    });
  });

  describe('Note Merging vs Replacement Behavior', () => {
    it('replaces content when note is empty or merge is disabled', () => {
      const ta = document.getElementById('edit-textarea');
      ta.innerHTML = '';

      applyTemplateToCurrentNote('meeting_1on1', 'en', { merge: false });
      expect(ta.innerHTML).toContain('<h2>Personal &amp; Context Check-in</h2>');
      expect(globalThis.StorageAPI.saveSnapshot).not.toHaveBeenCalled();
    });

    it('appends template below existing content when merge is enabled', () => {
      const ta = document.getElementById('edit-textarea');
      ta.innerHTML = '<p>Initial notes taken before meeting starts.</p>';

      applyTemplateToCurrentNote('meeting_1on1', 'en', { merge: true });
      expect(ta.innerHTML).toContain('<p>Initial notes taken before meeting starts.</p>');
      expect(ta.innerHTML).toContain('<h2>Personal &amp; Context Check-in</h2>');
      expect(globalThis.StorageAPI.saveSnapshot).toHaveBeenCalledWith(
        'notes/test-note-1.html',
        '<p>Initial notes taken before meeting starts.</p>',
        'pre-template'
      );
    });

    it('works with plain textarea when not in contentEditable mode', () => {
      const ta = document.getElementById('edit-textarea');
      ta.contentEditable = 'false';
      ta.value = 'Existing plain text notes';

      applyTemplateToCurrentNote('decision_rfc', 'en', { merge: true });
      expect(ta.value).toContain('Existing plain text notes\n\n');
      expect(ta.value).toContain('<h2>Context &amp; Background</h2>');
    });
  });

  describe('Collaborator Sync Note Generation in Working Language', () => {
    it('generates 1-on-1 sync note in configured working language (English)', async () => {
      globalThis.settings.workingLanguage = 'en';
      globalThis.collaboratorsMap = {
        Alice: { agenda: [{ text: 'Review sprint deliverables', noteTitle: 'Sprint 42' }], delegations: [] }
      };

      await createSyncNoteForCollaborator('Alice');

      const contentEl = document.getElementById('nn-content');
      expect(contentEl.value).toContain('# Agenda / Points to Discuss');
      expect(contentEl.value).toContain('# Meeting Notes');
      expect(contentEl.value).toContain('@Alice Review sprint deliverables');
    });

    it('generates 1-on-1 sync note in configured working language (French)', async () => {
      globalThis.settings.workingLanguage = 'fr';
      globalThis.collaboratorsMap = {
        Bob: { agenda: [{ text: 'Points roadmap', noteTitle: 'Roadmap Q4' }], delegations: [] }
      };

      await createSyncNoteForCollaborator('Bob');

      const contentEl = document.getElementById('nn-content');
      expect(contentEl.value).toContain('# Ordre du jour / Points à discuter');
      expect(contentEl.value).toContain('# Notes de réunion');
    });
  });

  describe('Planner Sync Event Note Generation in Working Language', () => {
    it('automatically uses meeting_1on1 template in working language for sync event', async () => {
      globalThis.settings.workingLanguage = 'en';
      const event = {
        id: 'evt-sync-1',
        title: 'Weekly Sync with Sarah',
        type: 'sync',
        date: '2026-09-24'
      };

      await openNoteForEvent(event);

      expect(globalThis.StorageAPI.writeNoteContent).toHaveBeenCalled();
      const writtenHTML = globalThis.StorageAPI.writeNoteContent.mock.calls[0][1];
      expect(writtenHTML).toContain('<h2>Personal &amp; Context Check-in</h2>');
      expect(writtenHTML).toContain('<h2>Agenda &amp; Priorities</h2>');
      expect(writtenHTML).toContain('<h2>Action Items</h2>');
    });
  });
});
