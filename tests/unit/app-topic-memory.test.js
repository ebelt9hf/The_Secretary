import { describe, it, expect, beforeAll } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Workstream & Topic Memory Engine (app-topic-memory.js)', () => {
  beforeAll(() => {
    loadScriptsIntoGlobal([
      'js/app-utils.js',
      'js/app-notes.js',
      'js/app-topic-memory.js'
    ]);
  });

  describe('sanitizeTopicMemoryKey', () => {
    it('sanitizes topic strings into safe key names', () => {
      expect(sanitizeTopicMemoryKey('Project Alpha')).toBe('project_alpha');
      expect(sanitizeTopicMemoryKey('  UI/UX Design  ')).toBe('ui_ux_design');
      expect(sanitizeTopicMemoryKey('')).toBe('');
      expect(sanitizeTopicMemoryKey(null)).toBe('');
    });
  });

  describe('Workstream Chat Paths & Storage Keys', () => {
    it('generates correct storage file paths and localStorage keys for Workstream AI chats', () => {
      expect(getWorkstreamChatPath('Project Alpha')).toBe('raw/topic-memories/project_alpha_chat.json');
      expect(getWorkstreamChatPath('')).toBe('');

      expect(getWorkstreamChatLsKey('Project Alpha')).toBe('secretary_ws_chat_project_alpha');
      expect(getWorkstreamChatLsKey(null)).toBe('');
    });
  });

  describe('getWorkstreamMeetings', () => {
    beforeAll(() => {
      globalThis.plannerEvents = [
        {
          id: 'evt_1',
          title: 'Sprint Planning: Project Alpha',
          workstream: 'Project Alpha',
          date: '2026-12-01',
          startTime: '10:00'
        },
        {
          id: 'evt_2',
          title: 'Architecture Sync',
          major_topic_tags: ['project alpha'],
          date: '2026-01-10',
          startTime: '14:00'
        },
        {
          id: 'evt_3',
          title: 'Unrelated Sales Call',
          workstream: 'Sales',
          date: '2026-12-05',
          startTime: '11:00'
        }
      ];
    });

    it('filters upcoming and past meetings by workstream tag or title', () => {
      const result = getWorkstreamMeetings('Project Alpha');
      expect(result.all.length).toBe(2);
      expect(result.upcoming.length).toBe(1);
      expect(result.upcoming[0].id).toBe('evt_1');
      expect(result.past.length).toBe(1);
      expect(result.past[0].id).toBe('evt_2');
    });

    it('returns empty lists for unknown workstreams or null inputs', () => {
      const result = getWorkstreamMeetings('');
      expect(result.upcoming).toEqual([]);
      expect(result.past).toEqual([]);
    });
  });

  describe('getWorkstreamAiLanguageInfo', () => {
    it('resolves AI language settings for workstreams', () => {
      globalThis.settings = { ai: { language: 'fr' } };
      const frInfo = getWorkstreamAiLanguageInfo();
      expect(frInfo.code).toBe('fr');
      expect(frInfo.name).toContain('Français');

      globalThis.settings = { ai: { language: 'auto' }, language: 'de' };
      const deInfo = getWorkstreamAiLanguageInfo();
      expect(deInfo.code).toBe('de');
      expect(deInfo.name).toContain('Deutsch');
    });
  });

  describe('parseFlexibleTimestamp', () => {
    it('parses numeric timestamps', () => {
      const now = Date.now();
      expect(parseFlexibleTimestamp(now)).toBe(now);
    });

    it('parses ISO date strings', () => {
      const iso = '2026-08-01T12:00:00.000Z';
      expect(parseFlexibleTimestamp(iso)).toBe(new Date(iso).getTime());
    });

    it('parses European format dates (DD/MM/YYYY or DD-MM-YYYY)', () => {
      const parsed = parseFlexibleTimestamp('15/08/2026');
      const expected = new Date(2026, 7, 15).getTime(); // August = 7
      expect(parsed).toBe(expected);
    });

    it('returns 0 for invalid date strings or null', () => {
      expect(parseFlexibleTimestamp(null)).toBe(0);
      expect(parseFlexibleTimestamp('invalid-date')).toBe(0);
    });
  });

  describe('isTopicMemoryStale', () => {
    it('returns false for recent timestamps', () => {
      const recent = new Date().toISOString();
      expect(isTopicMemoryStale(recent)).toBe(false);
    });

    it('returns true for timestamps older than 30 days', () => {
      const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
      expect(isTopicMemoryStale(oldDate)).toBe(true);
    });

    it('returns false for missing timestamps', () => {
      expect(isTopicMemoryStale(null)).toBe(false);
    });
  });

  describe('Workstream Task Dependencies Engine', () => {
    beforeAll(() => {
      globalThis.todosManifest = [
        { id: 'ws_task_1', title: 'Workstream Task 1', priority: 'Done', depends_on: [] },
        { id: 'ws_task_2', title: 'Workstream Task 2', priority: 'High', depends_on: ['ws_task_1'] },
        { id: 'ws_task_3', title: 'Workstream Task 3', priority: 'Medium', depends_on: ['ws_task_2'] }
      ];
    });

    it('resolves prerequisites and dependents for workstream tasks', () => {
      const prereqs = TaskGraphEngine.getPrerequisites('ws_task_2');
      expect(prereqs.length).toBe(1);
      expect(prereqs[0].id).toBe('ws_task_1');

      const dependents = TaskGraphEngine.getDependents('ws_task_2');
      expect(dependents.length).toBe(1);
      expect(dependents[0].id).toBe('ws_task_3');
    });

    it('identifies unresolved blockers in workstream tasks', () => {
      const blockers = TaskGraphEngine.getUnresolvedBlockers('ws_task_3');
      expect(blockers.length).toBe(1);
      expect(blockers[0].id).toBe('ws_task_2');
    });
  });

  describe('getMajorTopicMemorySync & Full Dossier Cache Behavior', () => {
    it('returns null when full dossier is not in _topicMemoryFileCache even if topic exists in _topicMemoriesIndexCache', () => {
      // Simulate master index loaded with a topic summary item (which lacks keyFacts, scratchpad, etc.)
      globalThis._topicMemoriesIndexCache = {
        topics: [
          { key: 'project_gamma', topicName: 'Project Gamma', summary: 'Index summary only', status: 'active', factsCount: 5 }
        ]
      };

      // Ensure full dossier cache does NOT have project_gamma
      const result = getMajorTopicMemorySync('Project Gamma');
      // Should NOT return the incomplete index item as a full topic memory dossier!
      expect(result).toBeNull();
    });
  });

  describe('Suggested Meetings Persistence & Cache', () => {
    it('persists suggestedMeetings in saveMajorTopicMemory payload', async () => {
      const suggestions = [
        {
          title: 'Architecture Review',
          targetParticipants: ['Alice', 'Bob'],
          durationMinutes: 30,
          reason: 'Unblock DB design',
          agenda: ['DB schema', 'Decisions']
        }
      ];

      const saved = await saveMajorTopicMemory('Project Delta', {
        summary: 'Delta summary',
        suggestedMeetings: suggestions
      });

      expect(saved.suggestedMeetings).toEqual(suggestions);

      const loaded = await getMajorTopicMemory('Project Delta', { skipAutoArchive: true });
      expect(loaded.suggestedMeetings).toEqual(suggestions);
    });

    it('returns cached suggestedMeetings without re-running AI when forceRefresh is false', async () => {
      let aiCalled = false;
      globalThis.LLMService = {
        isEnabled: () => true,
        chat: async () => {
          aiCalled = true;
          return { parsed: { suggestions: [{ title: 'New AI Meeting' }] } };
        }
      };

      const memory = {
        topicName: 'Project Epsilon',
        openThreads: ['Issue 1'],
        decisions: [{ text: 'Decision 1', status: 'proposed' }],
        participants: ['Alice'],
        suggestedMeetings: [{ title: 'Cached Meeting 1' }]
      };

      const result = await suggestWorkstreamMeetingsWithAI('Project Epsilon', {
        memory,
        forceRefresh: false
      });

      expect(aiCalled).toBe(false);
      expect(result).toEqual([{ title: 'Cached Meeting 1' }]);
    });

    it('re-runs AI and persists new suggestions when forceRefresh is true', async () => {
      let aiCalled = false;
      globalThis.LLMService = {
        isEnabled: () => true,
        chat: async () => {
          aiCalled = true;
          return { parsed: { suggestions: [{ title: 'Fresh AI Meeting', durationMinutes: 45 }] } };
        }
      };

      const memory = {
        topicName: 'Project Zeta',
        openThreads: ['Issue 1'],
        decisions: [{ text: 'Decision 1', status: 'proposed' }],
        participants: ['Alice'],
        suggestedMeetings: [{ title: 'Old Meeting' }]
      };

      const result = await suggestWorkstreamMeetingsWithAI('Project Zeta', {
        memory,
        forceRefresh: true
      });

      expect(aiCalled).toBe(true);
      expect(result[0].title).toBe('Fresh AI Meeting');

      const loaded = await getMajorTopicMemory('Project Zeta', { skipAutoArchive: true });
      expect(loaded.suggestedMeetings[0].title).toBe('Fresh AI Meeting');
    });

    it('generates heuristic fallback suggestions with enrich_existing when upcoming meetings exist', async () => {
      globalThis.LLMService = {
        isEnabled: () => false
      };

      globalThis.plannerEvents = [
        { id: 'evt-101', title: 'Sprint Sync', date: '2099-01-01', workstream: 'Project Heuristic', startTime: '10:00' }
      ];

      const memory = {
        topicName: 'Project Heuristic',
        openThreads: ['API Migration strategy?'],
        decisions: [{ text: 'Use v2 endpoints', status: 'proposed' }],
        participants: ['Alice', 'Bob']
      };

      const result = await suggestWorkstreamMeetingsWithAI('Project Heuristic', {
        memory,
        forceRefresh: true
      });

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].proposalType).toBe('enrich_existing');
      expect(result[0].existingMeetingId).toBe('evt-101');
      expect(result[0].title).toContain('Sprint Sync');
      expect(result[0].reason).toContain('Sprint Sync');
      expect(result[0].proposedContext).toContain('API Migration strategy?');
    });

    it('generates heuristic fallback suggestions with new_meeting when no upcoming meetings exist', async () => {
      globalThis.LLMService = {
        isEnabled: () => false
      };

      globalThis.plannerEvents = [];

      const memory = {
        topicName: 'Project Heuristic New',
        openThreads: ['Database indexing plan'],
        decisions: [],
        participants: ['Alice', 'Bob']
      };

      const result = await suggestWorkstreamMeetingsWithAI('Project Heuristic New', {
        memory,
        forceRefresh: true
      });

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].proposalType).toBe('new_meeting');
      expect(result[0].title).toContain('Project Heuristic New');
      expect(result[0].targetParticipants).toEqual(['Alice', 'Bob']);
      expect(result[0].durationMinutes).toBe(30);
      expect(result[0].reason).toContain('Database indexing plan');
    });

    it('parses and normalizes AI suggestions containing enrich_existing and new_meeting proposals', async () => {
      globalThis.LLMService = {
        isEnabled: () => true,
        chat: async (messages) => {
          // Check that prompt contains upcoming calendar info
          const userMsg = messages.find(m => m.role === 'user');
          expect(userMsg.content).toContain('Already Scheduled Upcoming Calendar Meetings');
          expect(userMsg.content).toContain('Q3 Kickoff');

          return {
            parsed: {
              suggestions: [
                {
                  proposalType: 'enrich_existing',
                  existingMeetingId: 'evt-q3',
                  existingMeetingTitle: 'Q3 Kickoff',
                  existingMeetingDate: '2099-06-01',
                  title: 'Context for Q3 Kickoff',
                  reason: 'Align on Q3 roadmap blocker',
                  proposedContext: 'Review roadmap deliverables and approve v2 scope',
                  agenda: ['1. Roadmap review', '2. Deliverables approval']
                },
                {
                  proposalType: 'new_meeting',
                  title: 'Security Architecture Review',
                  targetParticipants: ['Alice', 'Security Lead'],
                  durationMinutes: 45,
                  reason: 'Resolve auth token expiration issue',
                  agenda: ['1. Auth flow audit', '2. Token rotation spec']
                }
              ]
            }
          };
        }
      };

      globalThis.plannerEvents = [
        { id: 'evt-q3', title: 'Q3 Kickoff', date: '2099-06-01', workstream: 'Project Strategic', startTime: '14:00' }
      ];

      const memory = {
        topicName: 'Project Strategic',
        openThreads: ['Roadmap blocker', 'Auth token issue'],
        participants: ['Alice']
      };

      const result = await suggestWorkstreamMeetingsWithAI('Project Strategic', {
        memory,
        forceRefresh: true
      });

      expect(result.length).toBe(2);
      expect(result[0].proposalType).toBe('enrich_existing');
      expect(result[0].existingMeetingTitle).toBe('Q3 Kickoff');
      expect(result[0].proposedContext).toContain('Review roadmap');

      expect(result[1].proposalType).toBe('new_meeting');
      expect(result[1].title).toBe('Security Architecture Review');
      expect(result[1].durationMinutes).toBe(45);
    });
  });

  describe('Workstream Tag Group Matching (isNoteInMajorTopicWorkstream)', () => {
    it('matches notes when tagGroups contains a wildcard catch-all rule', async () => {
      const note = {
        id: 'n1',
        title: 'Random Note',
        group_tags: ['OtherGroup'],
        major_topic_tags: ['UnrelatedMajor'],
        topic_tags: ['SomeTopic']
      };

      const memoryWithWildcard = {
        topicName: 'CatchAll Workstream',
        mappedTags: {
          tagGroups: [{ group: '*', major: '*', topic: '*' }]
        }
      };

      // save topic memory
      await saveMajorTopicMemory('CatchAll Workstream', memoryWithWildcard);

      globalThis.manifest = [note];
      const result = await getMajorTopicMemory('CatchAll Workstream', { skipAutoArchive: true });
      expect(result).not.toBeNull();
    });
  });
});

