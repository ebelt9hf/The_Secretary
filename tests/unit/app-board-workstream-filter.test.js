import { describe, it, expect, beforeAll } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Board Workstream Filter, Redesigned Note Ships & Planned Notes', () => {
  beforeAll(() => {
    loadScriptsIntoGlobal([
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-utils.js',
      'js/app-state.js',
      'js/app-notes.js',
      'js/app-board.js'
    ]);
  });

  describe('Workstream Identification on Notes', () => {
    it('detects explicit workstream property on a note', () => {
      const note = { path: 'notes/1.html', title: 'Test Note', workstream: 'Marketing Campaign' };
      expect(getNoteWorkstreamName(note)).toBe('Marketing Campaign');
    });

    it('detects workstream from matching topic memory index cache', () => {
      global._topicMemoriesIndexCache = {
        topics: [
          { topicName: 'Q3 Product Strategy', status: 'active', key: 'q3_product_strategy' }
        ]
      };
      const note = {
        path: 'notes/2.html',
        title: 'Strategy Meeting',
        major_topic_tags: ['Q3 Product Strategy']
      };
      expect(getNoteWorkstreamName(note)).toBe('Q3 Product Strategy');
    });
  });

  describe('Redesigned Note Ships (renderNoteCard)', () => {
    it('renders workstream pill and suppresses standard tags when note belongs to a workstream', () => {
      const note = {
        id: 'n1',
        path: 'notes/ws.html',
        title: 'Workstream Note',
        workstream: 'Core Architecture',
        topic_tags: ['TopicA'],
        major_topic_tags: ['MajorB']
      };
      const html = renderNoteCard(note, null, { showContextTags: true });
      expect(html).toContain('sl-card-workstream-pill');
      expect(html).toContain('Core Architecture');
      // Standard tags should be suppressed when part of a workstream
      expect(html).not.toContain('class="tag group-tag"');
      expect(html).not.toContain('class="tag major-tag"');
    });

    it('renders standard tags when note is not part of a workstream', () => {
      const note = {
        id: 'n2',
        path: 'notes/standard.html',
        title: 'Standard Note',
        topic_tags: ['UI Redesign']
      };
      const html = renderNoteCard(note, null, { showContextTags: true });
      expect(html).toContain('UI Redesign');
      expect(html).not.toContain('sl-card-workstream-pill');
    });

    it('binds double click to openNoteOverlay for regular notes', () => {
      const note = {
        id: 'n3',
        path: 'notes/regular.html',
        title: 'Regular Note'
      };
      const html = renderNoteCard(note);
      expect(html).toContain('ondblclick="openNoteOverlay');
    });

    it('suppresses all tag rendering when hideTags: true is passed (Tree view)', () => {
      const note = {
        id: 'n-tree',
        path: 'notes/tree.html',
        title: 'Tree View Note',
        topic_tags: ['UI Tag']
      };
      const html = renderNoteCard(note, null, { hideTags: true });
      expect(html).not.toContain('UI Tag');
      expect(html).not.toContain('sl-card-tags-top');
    });

    it('applies group color tinting when tintColor is provided (Map view)', () => {
      const note = {
        id: 'n-map',
        path: 'notes/map.html',
        title: 'Map View Note'
      };
      const html = renderNoteCard(note, null, { tintColor: 'hsl(140, 60%, 40%)' });
      expect(html).toContain('background: color-mix(in srgb, hsl(140, 60%, 40%) 6%, var(--card-bg))');
    });

    it('renders planned note card with typeOhneNotiz text and double click action', () => {
      const note = {
        isPlannedNote: true,
        id: 'planned-evt1',
        path: 'virtual:planned:evt1',
        title: 'Future Sprint Note',
        date: '2026-09-01',
        event: { id: 'evt1', title: 'Future Sprint' }
      };
      const html = renderNoteCard(note);
      expect(html).toContain('planned-note-card');
      expect(html).toContain('openNoteForEvent');
    });

    it('renders typeOhneNotiz preview text for past blocs without notes', () => {
      const note = {
        isPlannedNote: true,
        isPastBlocWithoutNote: true,
        id: 'planned-evt2',
        path: 'virtual:planned:evt2',
        title: 'Bloc without Note',
        date: '2026-08-01',
        event: { id: 'evt2', title: 'Past Sync', type: 'sync' }
      };
      const html = renderNoteCard(note);
      expect(html).toContain('planned-note-card');
      expect(html).toContain('Sync');
    });
  });

  describe('Daily Sub-grouping in Map View (renderMapMilestoneHTML)', () => {
    it('formats date strings into friendly day labels', () => {
      expect(formatMapDayLabel('2026-08-28')).toContain('Aug 28');
    });

    it('groups notes inside milestone into separate daily sections with axis points', () => {
      const notes = [
        { id: '1', path: 'n1.html', title: 'Note 1', date: '2026-08-28' },
        { id: '2', path: 'n2.html', title: 'Note 2', date: '2026-08-27' }
      ];
      const html = renderMapMilestoneHTML('W35', 'W35 – Aug 2026', notes);
      expect(html).toContain('map-day-section');
      expect(html).toContain('map-day-dot');
      expect(html).toContain('Aug 28');
      expect(html).toContain('Aug 27');
    });
  });

  describe('Planned Notes Aggregation from Planner Blocs', () => {
    it('returns planned note objects for unlinked planner events', () => {
      const existingItems = [{ id: 'created-note-1', path: 'notes/created.html' }];
      global.manifest = existingItems;
      global.plannerEvents = [
        { id: 'evt-100', title: 'Q4 Roadmap Discussion', date: '2026-09-10', startTime: '14:00' },
        { id: 'evt-101', title: 'Existing Note Event', date: '2026-08-20', noteId: 'created-note-1' }
      ];
      const planned = getPlannedNotesFromBlocs(existingItems, existingItems);
      expect(planned.length).toBe(1);
      expect(planned[0].id).toBe('planned-evt-100');
      expect(planned[0].title).toBe('Q4 Roadmap Discussion');
      expect(planned[0].isPlannedNote).toBe(true);
    });
  });
});
