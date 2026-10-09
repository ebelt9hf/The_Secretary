import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Workstream and Tag Logic Helpers (app-utils.js & app-board.js)', () => {
  let cleanTagList;
  let mergeTagLists;
  let normalizeWorkstreamKey;
  let getAllEntityTags;
  let getAllNoteTags;
  let findWorkstreamByNameOrKey;
  let extractEntityWorkstreams;
  let isWorkstreamTag;
  let tagArrayContains;
  let noteHasTag;
  let noteHasAnyTag;
  let normalizeItemTagSets;
  let syncTagsBetweenBlocAndNote;

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();

    const utilsCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-utils.js'), 'utf8');

    const env = new Function(`
      var window = globalThis;
      globalThis.window = globalThis;
      var t = (k, params) => k;
      var manifest = [];
      var plannerEvents = [];
      ${utilsCode}
      return {
        cleanTagList: globalThis.cleanTagList,
        mergeTagLists: globalThis.mergeTagLists,
        normalizeWorkstreamKey: globalThis.normalizeWorkstreamKey,
        getAllEntityTags: globalThis.getAllEntityTags,
        getAllNoteTags: globalThis.getAllNoteTags,
        findWorkstreamByNameOrKey: globalThis.findWorkstreamByNameOrKey,
        extractEntityWorkstreams: globalThis.extractEntityWorkstreams,
        isWorkstreamTag: globalThis.isWorkstreamTag,
        tagArrayContains: globalThis.tagArrayContains,
        noteHasTag: globalThis.noteHasTag,
        noteHasAnyTag: globalThis.noteHasAnyTag,
        normalizeItemTagSets: globalThis.normalizeItemTagSets,
        syncTagsBetweenBlocAndNote: globalThis.syncTagsBetweenBlocAndNote
      };
    `)();

    cleanTagList = env.cleanTagList;
    mergeTagLists = env.mergeTagLists;
    normalizeWorkstreamKey = env.normalizeWorkstreamKey;
    getAllEntityTags = env.getAllEntityTags;
    getAllNoteTags = env.getAllNoteTags;
    findWorkstreamByNameOrKey = env.findWorkstreamByNameOrKey;
    extractEntityWorkstreams = env.extractEntityWorkstreams;
    isWorkstreamTag = env.isWorkstreamTag;
    tagArrayContains = env.tagArrayContains;
    noteHasTag = env.noteHasTag;
    noteHasAnyTag = env.noteHasAnyTag;
    normalizeItemTagSets = env.normalizeItemTagSets;
    syncTagsBetweenBlocAndNote = env.syncTagsBetweenBlocAndNote;
  });

  describe('cleanTagList', () => {
    it('handles empty, null, and undefined values cleanly', () => {
      expect(cleanTagList(null)).toEqual([]);
      expect(cleanTagList(undefined)).toEqual([]);
      expect(cleanTagList([])).toEqual([]);
      expect(cleanTagList('')).toEqual([]);
    });

    it('trims whitespace and removes empty strings', () => {
      const input = ['  Alpha  ', '', '   ', 'Beta', null, undefined, 'Gamma  '];
      expect(cleanTagList(input)).toEqual(['Alpha', 'Beta', 'Gamma']);
    });

    it('deduplicates case-insensitively while preserving first seen casing by default', () => {
      const input = ['Frontend', 'frontend', 'FRONTEND', 'Backend', 'backend'];
      expect(cleanTagList(input)).toEqual(['Frontend', 'Backend']);
    });

    it('supports lowercasing all tags when toLowerCase option is true', () => {
      const input = ['Marketing Strategy', 'Operations'];
      expect(cleanTagList(input, { toLowerCase: true })).toEqual(['marketing strategy', 'operations']);
    });

    it('handles Set and comma-separated strings as inputs', () => {
      const setInput = new Set([' Tag1 ', 'Tag2', 'tag1']);
      expect(cleanTagList(setInput)).toEqual(['Tag1', 'Tag2']);

      const commaString = '  Finance, HR ,  Operations , HR  ';
      expect(cleanTagList(commaString)).toEqual(['Finance', 'HR', 'Operations']);
    });
  });

  describe('mergeTagLists', () => {
    it('merges multiple tag sources and eliminates duplicates', () => {
      const listA = ['Core', 'Infra'];
      const listB = ['infra', 'DevOps'];
      const listC = 'Cloud, core';

      const merged = mergeTagLists(listA, listB, listC);
      expect(merged).toEqual(['Core', 'Infra', 'DevOps', 'Cloud']);
    });

    it('handles null and undefined arguments gracefully', () => {
      expect(mergeTagLists(null, ['TagA'], undefined, 'TagB')).toEqual(['TagA', 'TagB']);
    });
  });

  describe('normalizeWorkstreamKey', () => {
    it('normalizes accents, casing, and separators into a canonical underscore key', () => {
      expect(normalizeWorkstreamKey('Développement Produit')).toBe('developpement_produit');
      expect(normalizeWorkstreamKey('  Customer-Support & Operations  ')).toBe('customer_support_operations');
      expect(normalizeWorkstreamKey('Multi   Spaced---Name')).toBe('multi_spaced_name');
    });

    it('returns empty string for invalid or blank inputs', () => {
      expect(normalizeWorkstreamKey(null)).toBe('');
      expect(normalizeWorkstreamKey('')).toBe('');
      expect(normalizeWorkstreamKey(123)).toBe('');
    });
  });

  describe('getAllEntityTags & getAllNoteTags', () => {
    it('aggregates tags across all entity tag properties and deduplicates them', () => {
      const note = {
        group_tags: ['Leadership'],
        major_topic_tags: ['Strategy'],
        topic_tags: ['Roadmap', 'strategy'],
        extra_tags: ['Q3'],
        other_tags: ['urgent'],
        workstream: 'Product Growth',
        workstreams: ['Product Growth', 'Infra']
      };

      const tags = getAllEntityTags(note);
      expect(tags).toContain('Leadership');
      expect(tags).toContain('Strategy');
      expect(tags).toContain('Roadmap');
      expect(tags).toContain('Q3');
      expect(tags).toContain('urgent');
      expect(tags).toContain('Product Growth');
      expect(tags).toContain('Infra');
      // Case-insensitively deduplicated: 'strategy' not duplicated
      expect(tags.filter(t => t.toLowerCase() === 'strategy')).toHaveLength(1);
    });

    it('respects includeWorkstreams: false option', () => {
      const note = {
        group_tags: ['Engineering'],
        workstream: 'Platform'
      };
      const tags = getAllEntityTags(note, { includeWorkstreams: false });
      expect(tags).toEqual(['Engineering']);
      expect(tags).not.toContain('Platform');
    });

    it('getAllNoteTags is an alias for getAllEntityTags', () => {
      expect(getAllNoteTags).toBe(getAllEntityTags);
    });
  });

  describe('findWorkstreamByNameOrKey & extractEntityWorkstreams', () => {
    it('finds workstreams by name or normalized key', () => {
      const topics = [
        { topicName: 'Customer Support', key: 'customer_support', status: 'active' },
        { topicName: 'Infrastructure', key: 'infra', status: 'active' }
      ];

      expect(findWorkstreamByNameOrKey('Customer Support', topics)).toEqual(topics[0]);
      expect(findWorkstreamByNameOrKey('customer_support', topics)).toEqual(topics[0]);
      expect(findWorkstreamByNameOrKey('CUSTOMER-SUPPORT', topics)).toEqual(topics[0]);
      expect(findWorkstreamByNameOrKey('infra', topics)).toEqual(topics[1]);
      expect(findWorkstreamByNameOrKey('NonExistent', topics)).toBeNull();
    });

    it('extracts deduplicated workstreams from note or todo objects', () => {
      const entity = {
        workstream: 'Growth, Infra',
        workstreams: ['Growth', 'Security']
      };
      const ws = extractEntityWorkstreams(entity);
      expect(ws).toEqual(['Growth', 'Security', 'Infra']);
    });
  });

  describe('isWorkstreamTag', () => {
    it('matches workstream tags using canonical key normalization', () => {
      globalThis._topicMemoriesIndexCache = {
        topics: [
          { topicName: 'Engineering & DevOps', key: 'engineering_devops', status: 'active' }
        ]
      };

      expect(isWorkstreamTag('Engineering & DevOps')).toBe(true);
      expect(isWorkstreamTag('engineering_devops')).toBe(true);
      expect(isWorkstreamTag('engineering-devops')).toBe(true);
      expect(isWorkstreamTag('Random Tag')).toBe(false);
    });
  });

  describe('tagArrayContains, noteHasTag, and noteHasAnyTag', () => {
    it('checks tag existence across Arrays, Sets, and comma strings', () => {
      expect(tagArrayContains(['Design', 'UX'], 'ux')).toBe(true);
      expect(tagArrayContains(new Set(['Design', 'UX']), 'DESIGN')).toBe(true);
      expect(tagArrayContains('Design, UX', 'ux')).toBe(true);
      expect(tagArrayContains(['Design'], 'Code')).toBe(false);
    });

    it('noteHasTag checks all tag fields and workstreams on note', () => {
      const note = {
        group_tags: ['General'],
        major_topic_tags: ['Architecture'],
        workstream: 'Platform'
      };

      expect(noteHasTag(note, 'general')).toBe(true);
      expect(noteHasTag(note, 'ARCHITECTURE')).toBe(true);
      expect(noteHasTag(note, 'platform')).toBe(true);
      expect(noteHasTag(note, 'finance')).toBe(false);
      expect(noteHasAnyTag(note, ['finance', 'platform'])).toBe(true);
      expect(noteHasAnyTag(note, ['finance', 'hr'])).toBe(false);
    });
  });

  describe('normalizeItemTagSets', () => {
    it('normalizes item tag sets using cleanTagList', () => {
      const item = {
        group_tags: [' Group 1 ', 'group 1'],
        major_topic_tags: [' Major 1 '],
        topic_tags: [' Topic 1 ']
      };
      const result = normalizeItemTagSets(item);
      expect(result.groups).toEqual(['group 1']);
      expect(result.majors).toEqual(['major 1']);
      expect(result.topics).toEqual(['topic 1']);
    });
  });

  describe('syncTagsBetweenBlocAndNote', () => {
    it('merges event and note tags cleanly without duplicates', async () => {
      const note = {
        id: 'note_123',
        path: 'notes/123.html',
        group_tags: ['Sprint'],
        major_topic_tags: ['Planning'],
        topic_tags: ['Q3']
      };
      const event = {
        noteId: 'note_123',
        group_tags: ['sprint', 'Leadership'],
        major_topic_tags: ['planning', 'Strategy'],
        topic_tags: ['Q3', 'H2']
      };

      globalThis.manifest = [note];
      globalThis.plannerEvents = [event];

      const changed = await syncTagsBetweenBlocAndNote(event, note);
      expect(changed).toBe(true);
      expect(note.group_tags).toEqual(['Sprint', 'Leadership']);
      expect(note.major_topic_tags).toEqual(['Planning', 'Strategy']);
      expect(note.topic_tags).toEqual(['Q3', 'H2']);
      expect(event.tags).toEqual(['Sprint', 'Leadership', 'Planning', 'Strategy', 'Q3', 'H2']);
    });
  });
});
