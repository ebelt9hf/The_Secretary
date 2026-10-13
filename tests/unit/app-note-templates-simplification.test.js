import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Note Templates Simplification and Overlap Architecture', () => {
  beforeAll(() => {
    globalThis.window = globalThis.window || {};
    globalThis.escH = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    globalThis.escA = (s) => String(s || '');
    globalThis.toast = vi.fn();
    globalThis.broadcastSync = vi.fn();
    globalThis.saveLocalSettings = vi.fn();
    globalThis.mdToPreviewHTML = (md) => `<div>${md}</div>`;
    globalThis.generateNoteId = () => 'note-simplification-001';
    globalThis.getCanonicalNotePath = (id) => `notes/${id}.html`;
    globalThis.buildNewNoteHTML = (note) => note.mainHTML;
    globalThis.upsertManifest = vi.fn();
    globalThis.saveManifest = vi.fn();
    globalThis.rebuildIndexHTML = vi.fn();
    globalThis.renderFilterChips = vi.fn();
    globalThis.openNoteOverlay = vi.fn();
    globalThis.showPlannerNoteGenerationProgress = () => vi.fn();
    globalThis.savePlanner = vi.fn();
    globalThis.renderPlanner = vi.fn();

    globalThis.manifest = [];
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
    globalThis.settings = {
      language: 'en',
      workingLanguage: 'en'
    };
    globalThis.StorageAPI.writeNoteContent.mockClear();
  });

  describe('Sync Template Simplification', () => {
    it('provides exactly 3 simplified headers for sync (meeting_1on1)', () => {
      const templates = NoteTemplateManager.getTemplates('en');
      const syncTemplate = templates.find(t => t.id === 'meeting_1on1');
      expect(syncTemplate).toBeDefined();
      expect(syncTemplate.headers).toEqual([
        'Personal Context & Checkin',
        'Feedback & Discussion Topic',
        'Action Items'
      ]);
      expect(syncTemplate.headers).not.toContain('Agenda & Priorities');
      expect(syncTemplate.headers).not.toContain('Agreed Decisions');
    });

    it('generates HTML containing only the 3 sections when no block context is provided', () => {
      const html = NoteTemplateManager.getTemplateHTML('meeting_1on1', 'en');
      expect(html).toContain('<h2>Personal Context &amp; Checkin</h2>');
      expect(html).toContain('<h2>Feedback &amp; Discussion Topic</h2>');
      expect(html).toContain('<h2>Action Items</h2>');
      expect(html).not.toContain('<h2>Goal</h2>');
      expect(html).not.toContain('<h2>Agenda &amp; Priorities</h2>');
      expect(html).not.toContain('<h2>Agreed Decisions</h2>');
    });

    it('always adds additional context in a Goal section when context is provided', () => {
      const html = NoteTemplateManager.getTemplateHTML('meeting_1on1', 'en', {
        context: 'Align on Q4 career goals and promotion timeline'
      });
      expect(html).toContain('<h2>Goal</h2>');
      expect(html).toContain('<p>Align on Q4 career goals and promotion timeline</p>');
      expect(html).toContain('<h2>Personal Context &amp; Checkin</h2>');
      expect(html).toContain('<h2>Feedback &amp; Discussion Topic</h2>');
      expect(html).toContain('<h2>Action Items</h2>');
      // Goal section should be at the top
      expect(html.indexOf('<h2>Goal</h2>')).toBeLessThan(html.indexOf('<h2>Personal Context &amp; Checkin</h2>'));
    });
  });

  describe('Remaining Templates Simplification & Overlapping Sections', () => {
    it('shares Action Items across all 6 templates', () => {
      const templates = NoteTemplateManager.getTemplates('en');
      expect(templates.length).toBe(6);
      templates.forEach(t => {
        expect(t.headers).toContain('Action Items');
      });
    });

    it('shares Decisions across Standard, Project Kickoff, Decision RFC, and Postmortem', () => {
      const templates = NoteTemplateManager.getTemplates('en');
      const standard = templates.find(t => t.id === 'standard');
      const kickoff = templates.find(t => t.id === 'project_kickoff');
      const rfc = templates.find(t => t.id === 'decision_rfc');
      const postmortem = templates.find(t => t.id === 'postmortem');

      expect(standard.headers).toContain('Decisions');
      expect(kickoff.headers).toContain('Decisions');
      expect(rfc.headers).toContain('Decisions');
      expect(postmortem.headers).toContain('Decisions');
    });

    it('shares Goal across Standard, Project Kickoff, and Daily Standup', () => {
      const templates = NoteTemplateManager.getTemplates('en');
      const standard = templates.find(t => t.id === 'standard');
      const kickoff = templates.find(t => t.id === 'project_kickoff');
      const standup = templates.find(t => t.id === 'daily_standup');

      expect(standard.headers).toContain('Goal');
      expect(kickoff.headers).toContain('Goal');
      expect(standup.headers).toContain('Goal');
    });

    it('simplifies Project Kickoff to 4 clean sections', () => {
      const templates = NoteTemplateManager.getTemplates('en');
      const kickoff = templates.find(t => t.id === 'project_kickoff');
      expect(kickoff.headers).toEqual([
        'Goal',
        'Scope & Success Criteria',
        'Decisions',
        'Action Items'
      ]);
    });

    it('simplifies Decision RFC to 4 clean sections', () => {
      const templates = NoteTemplateManager.getTemplates('en');
      const rfc = templates.find(t => t.id === 'decision_rfc');
      expect(rfc.headers).toEqual([
        'Context & Background',
        'Options Considered & Trade-offs',
        'Decisions',
        'Action Items'
      ]);
    });

    it('simplifies Incident Postmortem to 4 clean sections', () => {
      const templates = NoteTemplateManager.getTemplates('en');
      const postmortem = templates.find(t => t.id === 'postmortem');
      expect(postmortem.headers).toEqual([
        'Incident Executive Summary',
        'Root Cause Analysis',
        'Decisions',
        'Action Items'
      ]);
    });

    it('simplifies Daily Standup to 3 clean sections', () => {
      const templates = NoteTemplateManager.getTemplates('en');
      const standup = templates.find(t => t.id === 'daily_standup');
      expect(standup.headers).toEqual([
        'Goal',
        'Blockers & Impediments',
        'Action Items'
      ]);
    });
  });

  describe('Planner Event Note Generation with Block Context', () => {
    it('adds additional context in Goal section for sync block in openNoteForEvent', async () => {
      const syncBlockWithContext = {
        id: 'sync-event-99',
        title: 'Weekly 1:1 with Engineering Lead',
        type: 'sync',
        date: '2026-10-14',
        context: 'Discuss release blockers and roadmap priorities'
      };

      await openNoteForEvent(syncBlockWithContext);

      expect(globalThis.StorageAPI.writeNoteContent).toHaveBeenCalled();
      const writtenHTML = globalThis.StorageAPI.writeNoteContent.mock.calls[0][1];
      expect(writtenHTML).toContain('<h2>Goal</h2>');
      expect(writtenHTML).toContain('<p>Discuss release blockers and roadmap priorities</p>');
      expect(writtenHTML).toContain('<h2>Personal Context &amp; Checkin</h2>');
      expect(writtenHTML).toContain('<h2>Feedback &amp; Discussion Topic</h2>');
      expect(writtenHTML).toContain('<h2>Action Items</h2>');
    });

    it('injects additional context into existing Goal section for kickoff block', async () => {
      const kickoffBlock = {
        id: 'kickoff-event-101',
        title: 'Q4 Core Platform Modernization',
        type: 'work',
        noteTemplateId: 'project_kickoff',
        date: '2026-10-15',
        context: 'Migrate legacy APIs to microservices architecture'
      };

      await openNoteForEvent(kickoffBlock);

      expect(globalThis.StorageAPI.writeNoteContent).toHaveBeenCalled();
      const writtenHTML = globalThis.StorageAPI.writeNoteContent.mock.calls[0][1];
      expect(writtenHTML).toContain('<h2>Goal</h2>');
      expect(writtenHTML).toContain('<p>Migrate legacy APIs to microservices architecture</p>');
      expect(writtenHTML).toContain('<h2>Scope &amp; Success Criteria</h2>');
      expect(writtenHTML).toContain('<h2>Decisions</h2>');
      expect(writtenHTML).toContain('<h2>Action Items</h2>');
    });

    it('prepends a Goal section with context for RFC block', async () => {
      const rfcBlock = {
        id: 'rfc-event-102',
        title: 'RFC: Event Streaming Architecture',
        type: 'work',
        noteTemplateId: 'decision_rfc',
        date: '2026-10-16',
        description: 'Decide between Kafka and NATS for message bus'
      };

      await openNoteForEvent(rfcBlock);

      expect(globalThis.StorageAPI.writeNoteContent).toHaveBeenCalled();
      const writtenHTML = globalThis.StorageAPI.writeNoteContent.mock.calls[0][1];
      expect(writtenHTML).toContain('<h2>Goal</h2>');
      expect(writtenHTML).toContain('<p>Decide between Kafka and NATS for message bus</p>');
      expect(writtenHTML).toContain('<h2>Context &amp; Background</h2>');
      expect(writtenHTML).toContain('<h2>Options Considered &amp; Trade-offs</h2>');
      expect(writtenHTML).toContain('<h2>Decisions</h2>');
      expect(writtenHTML).toContain('<h2>Action Items</h2>');
    });
  });
});
