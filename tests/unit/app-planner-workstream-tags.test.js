import { describe, it, expect, beforeEach, vi } from 'vitest';

// Load translations and core dependencies
import '../../js/translations.js';
import '../../js/app-utils.js';
import '../../js/app-board.js';
import '../../js/app-overlay.js';
import '../../js/app-planner.js';

describe('Planner Bloc Workstream & Major Topic Tags', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    globalThis.manifest = [
      { id: 'note-1', title: 'Note 1', group_tags: ['Engineering'], major_topic_tags: ['Architecture'], topic_tags: ['Frontend'] },
      { id: 'note-2', title: 'Note 2', group_tags: ['Product'], major_topic_tags: ['Roadmap'], topic_tags: ['Q3'] }
    ];
    globalThis.plannerEvents = [
      { id: 'ev-1', title: 'Bloc 1', group_tags: ['Engineering'], major_topic_tags: ['Architecture'], topic_tags: ['Backend'] },
      { id: 'ev-2', title: 'Bloc 2', group_tags: ['Design'], major_topic_tags: ['UI System'], topic_tags: ['Components'] }
    ];
    globalThis.todosManifest = [
      { id: 'todo-1', title: 'Task 1', group_tags: ['Sales'], major_topic_tags: ['Outreach'], topic_tags: ['Leads'] }
    ];
    globalThis._topicMemoriesIndexCache = {
      topics: [
        { topicName: 'Core Workstream', status: 'active' },
        { topicName: 'Growth Workstream', status: 'active' }
      ]
    };
  });

  it('knownTagsForType("major") returns actual major topic tags, not only workstreams', () => {
    const majors = knownTagsForType('major');
    expect(majors).toContain('Architecture');
    expect(majors).toContain('Roadmap');
    expect(majors).toContain('UI System');
    expect(majors).toContain('Outreach');
    // Ensure it does not force workstreams
    expect(majors).not.toContain('Core Workstream');
  });

  it('detects workstream when planner event tags match a selection group', () => {
    const memory = {
      topicName: 'Core Platform',
      mappedTags: {
        tagGroups: [
          { group: 'Engineering', major: 'Architecture', topic: 'Frontend' },
          { group: 'Design', major: 'UI System', topic: '*' }
        ]
      }
    };
    globalThis._topicMemoryByTopicName = {
      'Core Platform': memory
    };
    globalThis._topicMemoriesIndexCache = {
      topics: [{ topicName: 'Core Platform', status: 'active' }]
    };

    const plannerBloc = {
      id: 'bloc-test',
      group_tags: ['Design'],
      major_topic_tags: ['UI System'],
      topic_tags: ['Tokens']
    };

    const detected = detectWorkstreamDetailsForNote(plannerBloc, {
      group_tags: ['Design'],
      major_topic_tags: ['UI System'],
      topic_tags: ['Tokens']
    });

    expect(detected.length).toBe(1);
    expect(detected[0].name).toBe('Core Platform');
    expect(detected[0].isSelectionGroupMatch).toBe(true);
    expect(detected[0].matchedGroupIndex).toBe(1);
  });

  it('favors most used selection group when assigning a workstream with multiple tag groups', () => {
    const memory = {
      topicName: 'Platform WS',
      mappedTags: {
        tagGroups: [
          { group: 'Engineering', major: 'Rare Topic', topic: 'Rare' },
          { group: 'Engineering', major: 'Popular Topic', topic: 'Popular' }
        ]
      }
    };

    // Note 1 and Note 2 match group index 1 ("Popular Topic")
    globalThis.manifest = [
      { id: 'n1', group_tags: ['Engineering'], major_topic_tags: ['Popular Topic'], topic_tags: ['Popular'] },
      { id: 'n2', group_tags: ['Engineering'], major_topic_tags: ['Popular Topic'], topic_tags: ['Popular'] },
      { id: 'n3', group_tags: ['Engineering'], major_topic_tags: ['Rare Topic'], topic_tags: ['Rare'] }
    ];

    const favored = getMostUsedSelectionGroup('Platform WS', memory);
    expect(favored.major).toBe('Popular Topic');
    expect(favored.topic).toBe('Popular');
  });

  it('removes workstream auto-detection when user removes tags that satisfy the selection group', () => {
    const memory = {
      topicName: 'Mobile App',
      mappedTags: {
        tagGroups: [
          { group: 'Mobile', major: 'iOS', topic: 'Swift' }
        ]
      }
    };
    globalThis._topicMemoryByTopicName = {
      'Mobile App': memory
    };
    globalThis._topicMemoriesIndexCache = {
      topics: [{ topicName: 'Mobile App', status: 'active' }]
    };

    const plannerBloc = {
      id: 'bloc-mobile',
      group_tags: ['Mobile'],
      major_topic_tags: ['iOS'],
      topic_tags: ['Swift']
    };

    // With all tags matching
    let detected = detectWorkstreamDetailsForNote(plannerBloc, {
      group_tags: ['Mobile'],
      major_topic_tags: ['iOS'],
      topic_tags: ['Swift']
    });
    expect(detected.length).toBe(1);
    expect(detected[0].name).toBe('Mobile App');

    // Remove topic tag 'Swift' -> no longer meets the selection group
    detected = detectWorkstreamDetailsForNote(plannerBloc, {
      group_tags: ['Mobile'],
      major_topic_tags: ['iOS'],
      topic_tags: []
    });
    expect(detected.length).toBe(0);
  });

  it('isTagFromWorkstream identifies tags originating from active workstream', () => {
    globalThis._topicMemoryByTopicName = {
      'Cloud Infra': {
        topicName: 'Cloud Infra',
        mappedTags: {
          tagGroups: [{ group: 'DevOps', major: 'Kubernetes', topic: 'Cluster' }]
        }
      }
    };
    globalThis._topicMemoriesIndexCache = {
      topics: [{ topicName: 'Cloud Infra', status: 'active' }]
    };

    // Container with active workstream chip
    const container = document.createElement('div');
    container.id = 'pe-major-tags';
    document.body.appendChild(container);

    const wsBox = document.createElement('div');
    wsBox.id = 'pe-workstream-chip-selector';
    wsBox.innerHTML = '<span class="active-workstream-chip">Cloud Infra</span>';
    document.body.appendChild(wsBox);

    expect(isTagFromWorkstream('Kubernetes', 'major', 'pe-major-tags')).toBe(true);
    expect(isTagFromWorkstream('Random Major', 'major', 'pe-major-tags')).toBe(false);
  });

  describe('Unified matchTagsToSelectionGroup & matchTagsToWorkstreamSelectionGroups Utils', () => {
    it('normalizeItemTagSets handles objects, arrays, and extra tags', () => {
      const normObj = normalizeItemTagSets({
        group_tags: [' Engineering '],
        major_topic_tags: ['Platform '],
        topic_tags: ['API']
      });
      expect(normObj.groups).toEqual(['engineering']);
      expect(normObj.majors).toEqual(['platform']);
      expect(normObj.topics).toEqual(['api']);

      const normArr = normalizeItemTagSets(['DevOps', 'CI/CD']);
      expect(normArr.groups).toEqual(['devops', 'ci/cd']);
      expect(normArr.majors).toEqual(['devops', 'ci/cd']);
    });

    it('matchTagsToSelectionGroup accurately evaluates tag combinations with wildcards', () => {
      const item = {
        group_tags: ['Engineering'],
        major_topic_tags: ['Security'],
        topic_tags: ['Auth']
      };

      // Exact match
      expect(matchTagsToSelectionGroup(item, { group: 'Engineering', major: 'Security', topic: 'Auth' })).toBe(true);

      // Wildcards
      expect(matchTagsToSelectionGroup(item, { group: 'Engineering', major: '*', topic: 'Auth' })).toBe(true);
      expect(matchTagsToSelectionGroup(item, { group: '*', major: 'Security', topic: '*' })).toBe(true);
      expect(matchTagsToSelectionGroup(item, { group: '*', major: '*', topic: '*' })).toBe(true);
      expect(matchTagsToSelectionGroup(item, { group: '', major: 'Security', topic: '' })).toBe(true);

      // Non-matching
      expect(matchTagsToSelectionGroup(item, { group: 'Design', major: 'Security', topic: 'Auth' })).toBe(false);
      expect(matchTagsToSelectionGroup(item, { group: 'Engineering', major: 'Mobile', topic: 'Auth' })).toBe(false);
      expect(matchTagsToSelectionGroup(item, { group: 'Engineering', major: 'Security', topic: 'Billing' })).toBe(false);
    });

    it('matchTagsToWorkstreamSelectionGroups matches against tagGroups arrays and memories', () => {
      const item = {
        group_tags: ['Product'],
        major_topic_tags: ['Roadmap'],
        topic_tags: ['Q4']
      };

      const tagGroups = [
        { group: 'Engineering', major: 'Backend', topic: 'Database' },
        { group: 'Product', major: 'Roadmap', topic: 'Q4' }
      ];

      const res = matchTagsToWorkstreamSelectionGroups(item, tagGroups);
      expect(res.matched).toBe(true);
      expect(res.matchedGroupIndex).toBe(1);
      expect(res.matchedGroup.major).toBe('Roadmap');

      const noMatch = matchTagsToWorkstreamSelectionGroups(item, [
        { group: 'Sales', major: 'Enterprise', topic: 'Deals' }
      ]);
      expect(noMatch.matched).toBe(false);
      expect(noMatch.matchedGroupIndex).toBe(-1);
    });
  });
});
