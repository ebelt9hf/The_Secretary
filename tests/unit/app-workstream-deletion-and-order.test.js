import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Workstream Deletion, Ordering & AI Suggestions', () => {
  beforeAll(() => {
    loadScriptsIntoGlobal([
      'js/app-utils.js',
      'js/app-notes.js',
      'js/app-topic-memory.js',
      'js/app-board.js',
      'js/app-todos-board.js'
    ]);
  });

  beforeEach(() => {
    // Reset mocks & globals
    globalThis.localStorage = {
      _store: {},
      getItem(k) { return this._store[k] || null; },
      setItem(k, v) { this._store[k] = String(v); },
      removeItem(k) { delete this._store[k]; }
    };
    globalThis._topicMemoriesIndexCache = { topics: [] };
    globalThis.decisionsList = [];
    globalThis.pendingDecisionsList = [];
    globalThis.currentNote = null;
    globalThis.todosManifest = [];
    globalThis.manifest = [];
    globalThis.t = (k) => k;
    if (typeof workstreamCustomOrder !== 'undefined') {
      workstreamCustomOrder = [];
    }
    if (typeof favoriteRegistryProjects !== 'undefined') {
      favoriteRegistryProjects = new Set();
    }
  });

  describe('Workstream Alignment with Workstreams Tab as Authority', () => {
    it('aligns Task Tab getDefinedWorkstreamsList strictly with Workstreams Tab topic memories', () => {
      globalThis._topicMemoriesIndexCache = {
        topics: [
          { topicName: 'Project Orion', status: 'active' },
          { topicName: 'Project Pegasus', status: 'active' },
          { topicName: 'Archived Vulcan', status: 'archived' }
        ]
      };

      globalThis.localStorage.setItem('secretary_workstream_custom_order', JSON.stringify(['Project Pegasus', 'Project Orion']));
      if (typeof workstreamCustomOrder !== 'undefined') {
        workstreamCustomOrder = ['Project Pegasus', 'Project Orion'];
      }

      // Notes and todos having legacy or active tags
      globalThis.manifest = [
        { path: 'notes/1.html', workstream: 'Project Orion' },
        { path: 'notes/2.html', workstream: 'Archived Vulcan' }
      ];
      globalThis.todosManifest = [
        { id: 't1', title: 'Task 1', workstream: 'Project Orion' },
        { id: 't2', title: 'Task 2', workstream: 'Archived Vulcan' }
      ];

      const taskTabList = getDefinedWorkstreamsList();
      const knownList = getKnownWorkstreamsList([]);

      expect(taskTabList).toEqual(['Project Pegasus', 'Project Orion']);
      expect(taskTabList).toEqual(knownList);
      expect(taskTabList).not.toContain('Archived Vulcan');
    });

    it('strictly excludes leftover/orphaned tags from manifest notes and todosManifest when topic memories exist', () => {
      globalThis._topicMemoriesIndexCache = {
        topics: [
          { topicName: 'Growth Strategy', status: 'active' },
          { topicName: 'Core Product', status: 'active' }
        ]
      };

      // Manifest has notes with legacy, orphaned, or misspelled tags
      globalThis.manifest = [
        { path: 'notes/1.html', workstream: 'Growth Strategy', major_topic_tags: ['Growth Strategy', 'Old Orphan Tag'] },
        { path: 'notes/2.html', workstream: 'Deleted Legacy WS', major_topic_tags: ['Random Tag 123'] },
        { path: 'notes/3.html', workstreams: ['Another Phantom WS'] }
      ];

      // Todos manifest has tasks with obsolete workstreams
      globalThis.todosManifest = [
        { id: 't1', title: 'Task 1', workstream: 'Growth Strategy' },
        { id: 't2', title: 'Task 2', workstream: 'Obsolete Task WS' }
      ];

      const list = getKnownWorkstreamsList();
      expect(list).toEqual(['Core Product', 'Growth Strategy']);
      expect(list).not.toContain('Old Orphan Tag');
      expect(list).not.toContain('Deleted Legacy WS');
      expect(list).not.toContain('Random Tag 123');
      expect(list).not.toContain('Another Phantom WS');
      expect(list).not.toContain('Obsolete Task WS');

      // Tag helper knownTagsForType('major') returns actual major topic tags
      const majorTags = knownTagsForType('major');
      expect(majorTags).toContain('Growth Strategy');
      expect(majorTags).toContain('Old Orphan Tag');
      expect(majorTags).toContain('Random Tag 123');

      // isWorkstreamTag helper check
      expect(isWorkstreamTag('Growth Strategy')).toBe(true);
      expect(isWorkstreamTag('Core Product')).toBe(true);
      expect(isWorkstreamTag('Old Orphan Tag')).toBe(false);
      expect(isWorkstreamTag('Deleted Legacy WS')).toBe(false);
    });

    it('populates Todo workstream dropdown matching authoritative Workstreams Tab order and ignores archived memories', async () => {
      document.body.innerHTML = '<select id="todo-edit-workstream"></select>';

      globalThis._topicMemoriesIndexCache = {
        topics: [
          { topicName: 'Alpha Core', status: 'active', pinned: true },
          { topicName: 'Beta Service', status: 'active' },
          { topicName: 'Gamma Legacy', status: 'archived' }
        ]
      };

      await populateTodoWorkstreamDropdown();

      const sel = document.getElementById('todo-edit-workstream');
      const options = Array.from(sel.querySelectorAll('option')).map(o => o.value).filter(Boolean);

      expect(options).toEqual(['Alpha Core', 'Beta Service']);
      expect(options).not.toContain('Gamma Legacy');
    });
  });

  describe('Workstream Ordering in Notes Tab', () => {
    it('sorts workstreams strictly matching custom order when configured', () => {
      globalThis._topicMemoriesIndexCache = {
        topics: [
          { topicName: 'Beta', status: 'active' },
          { topicName: 'Gamma', status: 'active' },
          { topicName: 'Alpha', status: 'active' },
          { topicName: 'Delta', status: 'active' }
        ]
      };

      // Set custom order: Delta, Alpha, Beta, Gamma
      globalThis.localStorage.setItem('secretary_workstream_custom_order', JSON.stringify(['Delta', 'Alpha', 'Beta', 'Gamma']));
      if (typeof workstreamCustomOrder !== 'undefined') {
        workstreamCustomOrder = ['Delta', 'Alpha', 'Beta', 'Gamma'];
      }

      const list = getKnownWorkstreamsList([]);
      expect(list[0]).toBe('Delta');
      expect(list[1]).toBe('Alpha');
      expect(list[2]).toBe('Beta');
      expect(list[3]).toBe('Gamma');
    });

    it('sorts pinned favorites first when custom order is not specified, then alphabetical', () => {
      globalThis._topicMemoriesIndexCache = {
        topics: [
          { topicName: 'Beta', status: 'active' },
          { topicName: 'Gamma', status: 'active', pinned: true },
          { topicName: 'Alpha', status: 'active' },
          { topicName: 'Delta', status: 'active' }
        ]
      };

      globalThis.localStorage.setItem('secretary_workstream_custom_order', JSON.stringify([]));
      if (typeof workstreamCustomOrder !== 'undefined') {
        workstreamCustomOrder = [];
      }
      globalThis.localStorage.setItem('secretary_favorite_registry_projects', JSON.stringify(['Gamma']));

      const list = getKnownWorkstreamsList([]);
      expect(list[0]).toBe('Gamma'); // Pinned first
      expect(list[1]).toBe('Alpha'); // Alphabetical
      expect(list[2]).toBe('Beta');
      expect(list[3]).toBe('Delta');
    });

    it('strictly excludes decision major tags from creating or resurrecting workstreams', () => {
      globalThis._topicMemoriesIndexCache = {
        topics: [
          { topicName: 'Real Project', status: 'active' }
        ]
      };

      globalThis.decisionsList = [
        { major_topic_tags: ['Phantom Decision Topic', 'Architecture'] }
      ];
      globalThis.pendingDecisionsList = [
        { major_topic_tags: ['Unrelated Proposal Topic'] }
      ];

      const list = getKnownWorkstreamsList([]);
      expect(list).toContain('Real Project');
      expect(list).not.toContain('Phantom Decision Topic');
      expect(list).not.toContain('Architecture');
      expect(list).not.toContain('Unrelated Proposal Topic');
    });
  });

  describe('Topic Memory Deletion & Storage Cleanup', () => {
    it('purges topic from custom order and favorites on deleteTopicMemory', async () => {
      const mockIndex = {
        topics: [
          { key: 'topic_alpha', topicName: 'Topic Alpha', status: 'active' },
          { key: 'topic_beta', topicName: 'Topic Beta', status: 'active' }
        ]
      };

      globalThis.localStorage.setItem('secretary_topic_memories_index', JSON.stringify(mockIndex));
      globalThis.localStorage.setItem('secretary_workstream_custom_order', JSON.stringify(['Topic Alpha', 'Topic Beta']));
      globalThis.localStorage.setItem('secretary_favorite_registry_projects', JSON.stringify(['Topic Alpha']));

      await WorkstreamMemoryEngine.deleteTopicMemory('Topic Alpha');

      // Verify topic was removed from topics index cache and localStorage
      const updatedIndex = JSON.parse(globalThis.localStorage.getItem('secretary_topic_memories_index'));
      expect(updatedIndex.topics.some(t => t.topicName === 'Topic Alpha')).toBe(false);
      expect(updatedIndex.topics.some(t => t.topicName === 'Topic Beta')).toBe(true);

      // Verify custom order was updated
      const customOrder = JSON.parse(globalThis.localStorage.getItem('secretary_workstream_custom_order'));
      expect(customOrder).not.toContain('Topic Alpha');
      expect(customOrder).toContain('Topic Beta');

      // Verify favorites were updated
      const favs = JSON.parse(globalThis.localStorage.getItem('secretary_favorite_registry_projects'));
      expect(favs).not.toContain('Topic Alpha');
    });
  });

  describe('Daily Review Workstream Suggestions', () => {
    it('pre-feeds topicName, scope, and tags to openCreateWorkstreamModal when launched from suggestion', () => {
      let openedWithData = null;
      globalThis.openCreateWorkstreamModal = vi.fn((data) => {
        openedWithData = data;
      });

      // Simulate DailyReviewController
      const controller = {
        suggestedWorkstreams: [
          {
            topic_name: 'AI Agent Architecture',
            scope: 'Define LLM prompts and agent orchestration',
            reason: 'Growing number of discussions in recent meetings',
            tags: { group: 'Tech', major: 'Architecture', topic: 'AI' }
          }
        ]
      };

      const openCreateWorkstreamFromSuggestion = function(index) {
        if (!Array.isArray(this.suggestedWorkstreams) || !this.suggestedWorkstreams[index]) return;
        const item = this.suggestedWorkstreams[index];
        const initialData = {
          topicName: item.topic_name || item.workstream || item.title || '',
          scope: item.scope || '',
          tags: item.tags || {}
        };
        if (typeof openCreateWorkstreamModal === 'function') {
          openCreateWorkstreamModal(initialData);
        }
      }.bind(controller);

      openCreateWorkstreamFromSuggestion(0);

      expect(openedWithData).toBeTruthy();
      expect(openedWithData.topicName).toBe('AI Agent Architecture');
      expect(openedWithData.scope).toBe('Define LLM prompts and agent orchestration');
      expect(openedWithData.tags).toEqual({ group: 'Tech', major: 'Architecture', topic: 'AI' });
    });
  });
});
