import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Workstream Points, Milestones & Selection Groups', () => {
  let renderWorkstreamOverviewTab;
  let openAssignTagModal;
  let saveMajorTopicMemory;
  let savedMemoryStore;

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    savedMemoryStore = new Map();

    window.escH = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    window.escA = (s) => String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    window.escapeHtml = window.escH;
    window.toast = vi.fn();
    window.renderRegisterView = vi.fn();

    saveMajorTopicMemory = vi.fn(async (topicName, mem) => {
      savedMemoryStore.set(topicName, mem);
    });
    window.saveMajorTopicMemory = saveMajorTopicMemory;
    window.getMajorTopicMemorySync = (topicName) => savedMemoryStore.get(topicName) || null;

    // Load app-utils
    const utilsCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-utils.js'), 'utf8');
    const loadUtils = new Function('window', 'document', `
      ${utilsCode}
      return { createTagPill, makeTagChip };
    `);
    const utils = loadUtils(window, document);
    window.createTagPill = utils.createTagPill;
    window.makeTagChip = utils.makeTagChip;

    const mockT = (key, params) => {
      if (key === 'workstream.bulletPoint') return 'Bullet Point';
      if (key === 'workstream.milestone') return 'Milestone';
      if (key === 'workstream.matchingNotes') return 'Notes';
      if (key === 'workstream.matchingDecisions') return 'Decisions';
      if (key === 'workstream.matchingTasks') return 'Tasks';
      if (key === 'workstream.wildcardWarning') return 'Warning: This wildcard rule matches all notes, decisions, and tasks across your entire workspace.';
      if (key === 'workstream.saveWildcardSelection') return 'Match All Content (Wildcard)';
      if (key === 'workstream.saveWildcardSelectionTooltip') return 'Save selection group that matches all notes across workspace';
      if (key === 'workstream.wildcardConfirm') return 'This selection group will match ALL notes, decisions, and tasks in your workspace. Are you sure you want to save this wildcard selection?';
      if (key === 'workstream.notesCount') return `${params?.count ?? 0} note(s)`;
      if (key === 'workstream.coveredCount') return `${params?.count ?? 0} covered`;
      if (key === 'workstream.partOfWorkstream') return `Part of workstream: ${params?.workstream}: ${params?.tags}`;
      if (key === 'workstream.includesWorkstream') return `Includes workstream: ${params?.workstream}: ${params?.tags}`;
      if (key === 'workstream.matchesWorkstream') return `Matches workstream: ${params?.workstream}: ${params?.tags}`;
      if (key === 'workstream.clickToEditPoint') return 'Click to edit this point';
      if (key === 'workstream.clickToEditThread') return 'Click to edit this question';
      if (key === 'workstream.pointUpdatedToast') return 'Point updated';
      if (key === 'workstream.questionUpdatedToast') return 'Question updated';
      return key;
    };
    window.t = mockT;

    // Load app-collab helper functions
    const collabCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-collab.js'), 'utf8');
    const loadCollab = new Function('window', 'document', 't', 'escH', 'escA', 'toast', `
      ${collabCode}
      return { renderWorkstreamOverviewTab, openAssignTagModal, setupWorkstreamSelectionTagEditor, getWsIcon, openCreateWorkstreamModal, detectTagGroupHierarchy, formatTagGroupSummary };
    `);

    const collab = loadCollab(window, document, mockT, window.escH, window.escA, window.toast);
    renderWorkstreamOverviewTab = collab.renderWorkstreamOverviewTab;
    openAssignTagModal = collab.openAssignTagModal;
    window.openCreateWorkstreamModal = collab.openCreateWorkstreamModal;
    window.detectTagGroupHierarchy = collab.detectTagGroupHierarchy;
    window.formatTagGroupSummary = collab.formatTagGroupSummary;
  });

  describe('Main Points & Milestones Card', () => {
    it('renders initial facts and milestones with remove buttons', async () => {
      const parent = document.createElement('div');
      document.body.appendChild(parent);

      const mem = {
        topicName: 'Project Alpha',
        keyFacts: ['Fact 1', 'Fact 2'],
        activeMilestones: ['Launch Q3'],
        openThreads: ['Budget approval?'],
        mappedTags: { major_topic_tags: ['Project Alpha'] }
      };

      await renderWorkstreamOverviewTab('Project Alpha', parent, mem);

      const factRows = parent.querySelectorAll('.ws-btn-rm-fact');
      expect(factRows.length).toBe(2);

      const milestoneRows = parent.querySelectorAll('.ws-btn-rm-milestone');
      expect(milestoneRows.length).toBe(1);

      const threadRows = parent.querySelectorAll('.ws-btn-rm-thread');
      expect(threadRows.length).toBe(1);
    });

    it('adds a new bullet point when type is fact', async () => {
      const parent = document.createElement('div');
      document.body.appendChild(parent);

      const mem = {
        topicName: 'Project Alpha',
        keyFacts: ['Existing fact'],
        activeMilestones: [],
        openThreads: [],
        mappedTags: { major_topic_tags: ['Project Alpha'] }
      };

      await renderWorkstreamOverviewTab('Project Alpha', parent, mem);

      const form = parent.querySelector('#form-add-main-point');
      const input = parent.querySelector('#ws-main-point-input');
      const typeSelect = parent.querySelector('#ws-main-point-type');

      typeSelect.value = 'fact';
      input.value = 'New key insight';

      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      expect(saveMajorTopicMemory).toHaveBeenCalled();
      const saved = savedMemoryStore.get('Project Alpha');
      expect(saved.keyFacts).toEqual(['Existing fact', 'New key insight']);
    });

    it('adds a new milestone when type is milestone', async () => {
      const parent = document.createElement('div');
      document.body.appendChild(parent);

      const mem = {
        topicName: 'Project Alpha',
        keyFacts: [],
        activeMilestones: ['V1 Beta'],
        openThreads: [],
        mappedTags: { major_topic_tags: ['Project Alpha'] }
      };

      await renderWorkstreamOverviewTab('Project Alpha', parent, mem);

      const form = parent.querySelector('#form-add-main-point');
      const input = parent.querySelector('#ws-main-point-input');
      const typeSelect = parent.querySelector('#ws-main-point-type');

      typeSelect.value = 'milestone';
      input.value = 'Release 2.0';

      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      expect(saveMajorTopicMemory).toHaveBeenCalled();
      const saved = savedMemoryStore.get('Project Alpha');
      expect(saved.activeMilestones).toEqual(['V1 Beta', 'Release 2.0']);
    });

    it('removes a bullet point on click', async () => {
      const parent = document.createElement('div');
      document.body.appendChild(parent);

      const mem = {
        topicName: 'Project Alpha',
        keyFacts: ['Point A', 'Point B'],
        activeMilestones: [],
        openThreads: []
      };

      await renderWorkstreamOverviewTab('Project Alpha', parent, mem);

      const rmBtn = parent.querySelector('.ws-btn-rm-fact[data-fact-idx="0"]');
      expect(rmBtn).not.toBeNull();
      rmBtn.click();

      expect(saveMajorTopicMemory).toHaveBeenCalled();
      const saved = savedMemoryStore.get('Project Alpha');
      expect(saved.keyFacts).toEqual(['Point B']);
    });

    it('removes an open thread on click', async () => {
      const parent = document.createElement('div');
      document.body.appendChild(parent);

      const mem = {
        topicName: 'Project Alpha',
        keyFacts: [],
        activeMilestones: [],
        openThreads: ['Question 1', 'Question 2']
      };

      await renderWorkstreamOverviewTab('Project Alpha', parent, mem);

      const rmBtn = parent.querySelector('.ws-btn-rm-thread[data-thread-idx="0"]');
      expect(rmBtn).not.toBeNull();
      rmBtn.click();

      expect(saveMajorTopicMemory).toHaveBeenCalled();
      const saved = savedMemoryStore.get('Project Alpha');
      expect(saved.openThreads).toEqual(['Question 2']);
    });

    it('adds an open topic on form submit', async () => {
      const parent = document.createElement('div');
      document.body.appendChild(parent);

      const mem = {
        topicName: 'Project Alpha',
        keyFacts: [],
        activeMilestones: [],
        openThreads: []
      };

      await renderWorkstreamOverviewTab('Project Alpha', parent, mem);

      const form = parent.querySelector('#form-add-open-topic');
      const input = parent.querySelector('#ws-open-topic-input');
      input.value = 'What about compliance?';

      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      expect(saveMajorTopicMemory).toHaveBeenCalled();
      const saved = savedMemoryStore.get('Project Alpha');
      expect(saved.openThreads).toEqual(['What about compliance?']);
    });
  });

  describe('Selection Group Modal Multi-Entity Live Preview', () => {
    it('shows all notes, decisions, and tasks when fields are empty', () => {
      window.manifest = [
        { id: 'n1', title: 'Note 1', group_tags: ['team'], major_topic_tags: ['alpha'] },
        { id: 'n2', title: 'Note 2', group_tags: ['ops'], major_topic_tags: ['beta'] }
      ];
      window.decisionsList = [
        { id: 'd1', text: 'Adopt GraphQL', group_tags: ['team'], major_topic_tags: ['alpha'] },
        { id: 'd2', text: 'Migrate DB', group_tags: ['ops'], major_topic_tags: ['beta'] }
      ];
      window.pendingDecisionsList = [];
      window.todosManifest = [
        { id: 't1', title: 'Implement auth', group_tags: ['team'], major_topic_tags: ['alpha'] },
        { id: 't2', title: 'Setup CI', group_tags: ['ops'], major_topic_tags: ['beta'] }
      ];

      const mem = {
        topicName: 'Project Alpha',
        mappedTags: { tagGroups: [] }
      };

      openAssignTagModal('Project Alpha', mem, -1);

      const overlay = document.getElementById('modal-assign-tag');
      expect(overlay).not.toBeNull();

      const noteNum = overlay.querySelector('#ws-matching-notes-num');
      const decNum = overlay.querySelector('#ws-matching-decisions-num');
      const taskNum = overlay.querySelector('#ws-matching-tasks-num');

      expect(noteNum.textContent).toBe('2');
      expect(decNum.textContent).toBe('2');
      expect(taskNum.textContent).toBe('2');

      // Check switching preview tabs
      const decTab = overlay.querySelector('.ws-preview-segmented-tab[data-tab="decisions"]');
      expect(decTab).not.toBeNull();
      decTab.click();

      expect(decTab.classList.contains('active')).toBe(true);

      const taskTab = overlay.querySelector('.ws-preview-segmented-tab[data-tab="tasks"]');
      expect(taskTab).not.toBeNull();
      taskTab.click();

      expect(taskTab.classList.contains('active')).toBe(true);

      overlay.remove();
    });

    it('displays wildcard warning and warning button styling when rule is a wildcard', () => {
      window.manifest = [{ id: 'n1', title: 'Note 1' }];
      window.decisionsList = [];
      window.pendingDecisionsList = [];
      window.todosManifest = [];

      const mem = {
        topicName: 'Project Alpha',
        mappedTags: { tagGroups: [] }
      };

      openAssignTagModal('Project Alpha', mem, -1);

      const overlay = document.getElementById('modal-assign-tag');
      expect(overlay).not.toBeNull();

      const warnBox = overlay.querySelector('#ws-wildcard-warning-box');
      expect(warnBox).not.toBeNull();
      expect(warnBox.style.display).toBe('flex');

      const submitBtn = overlay.querySelector('#btn-assign-group-submit');
      expect(submitBtn.innerHTML).toContain('Match All Content (Wildcard)');
      expect(['#d97706', 'rgb(217, 119, 6)']).toContain(submitBtn.style.background || submitBtn.style.backgroundColor);

      overlay.remove();
    });

    it('requires confirmation before saving a wildcard rule', () => {
      window.manifest = [];
      window.decisionsList = [];
      window.pendingDecisionsList = [];
      window.todosManifest = [];

      const mem = {
        topicName: 'Project Alpha',
        mappedTags: { tagGroups: [] }
      };

      let confirmCalled = false;
      window.confirm = vi.fn((msg) => {
        confirmCalled = true;
        return false; // User cancels
      });

      openAssignTagModal('Project Alpha', mem, -1);
      const overlay = document.getElementById('modal-assign-tag');
      const submitBtn = overlay.querySelector('#btn-assign-group-submit');

      submitBtn.click();

      expect(window.confirm).toHaveBeenCalled();
      expect(saveMajorTopicMemory).not.toHaveBeenCalled();

      // Now user accepts
      window.confirm = vi.fn(() => true);
      submitBtn.click();

      expect(saveMajorTopicMemory).toHaveBeenCalled();
      const saved = savedMemoryStore.get('Project Alpha');
      expect(saved.mappedTags.tagGroups.length).toBe(1);

      overlay.remove();
    });

    it('matches tasks via workstream property and displays completed tasks with strikethrough', () => {
      window.manifest = [];
      window.decisionsList = [];
      window.pendingDecisionsList = [];
      window.todosManifest = [
        { id: 't1', title: 'Task with workstream', workstream: 'Alpha', priority: 'Done' },
        { id: 't2', title: 'Task other', workstream: 'Beta', priority: 'High' }
      ];

      const mem = {
        topicName: 'Project Alpha',
        mappedTags: { tagGroups: [{ id: 'r1', group: '', major: 'Alpha', topic: '' }] }
      };

      openAssignTagModal('Project Alpha', mem, 0);
      const overlay = document.getElementById('modal-assign-tag');

      const taskTab = overlay.querySelector('.ws-preview-segmented-tab[data-tab="tasks"]');
      taskTab.click();

      const taskCards = overlay.querySelectorAll('#ws-assign-matching-content-list .workstream-note-card');
      expect(taskCards.length).toBe(1);
      expect(taskCards[0].textContent).toContain('Task with workstream');

      // Verify strikethrough styling is applied to Done task
      const titleSpan = taskCards[0].querySelector('span[style*="line-through"]');
      expect(titleSpan).not.toBeNull();

      overlay.remove();
    });

    it('allows deleting an existing selection group in edit mode', () => {
      window.manifest = [];
      window.decisionsList = [];
      window.pendingDecisionsList = [];
      window.todosManifest = [];

      const mem = {
        topicName: 'Project Alpha',
        mappedTags: {
          tagGroups: [
            { id: 'r1', group: 'Engineering', major: 'Alpha', topic: '' },
            { id: 'r2', group: 'Design', major: 'Alpha', topic: '' }
          ]
        }
      };

      window.confirm = vi.fn(() => true);

      openAssignTagModal('Project Alpha', mem, 0);
      const overlay = document.getElementById('modal-assign-tag');
      const deleteBtn = overlay.querySelector('#btn-delete-selection-group');
      expect(deleteBtn).not.toBeNull();

      deleteBtn.click();

      expect(saveMajorTopicMemory).toHaveBeenCalled();
      const saved = savedMemoryStore.get('Project Alpha');
      expect(saved.mappedTags.tagGroups.length).toBe(1);
      expect(saved.mappedTags.tagGroups[0].group).toBe('Design');

      overlay.remove();
    });
  });

  describe('Inline Editing of Points, Milestones & Open Threads', () => {
    it('transforms bullet point into inline input on click and saves on Enter', async () => {
      const parent = document.createElement('div');
      document.body.appendChild(parent);

      const mem = {
        topicName: 'Project Alpha',
        keyFacts: ['Initial Fact'],
        activeMilestones: [],
        openThreads: []
      };

      await renderWorkstreamOverviewTab('Project Alpha', parent, mem);

      const factSpan = parent.querySelector('.ws-point-fact-text');
      expect(factSpan).not.toBeNull();
      expect(factSpan.textContent).toBe('Initial Fact');

      // Click to edit
      factSpan.click();

      const input = factSpan.querySelector('input.ws-point-inline-edit');
      expect(input).not.toBeNull();
      expect(input.value).toBe('Initial Fact');

      // Change text and press Enter
      input.value = 'Updated Insight Fact';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await new Promise((r) => setTimeout(r, 20));

      expect(saveMajorTopicMemory).toHaveBeenCalled();
      const saved = savedMemoryStore.get('Project Alpha');
      expect(saved.keyFacts).toEqual(['Updated Insight Fact']);
      expect(window.toast).toHaveBeenCalledWith('Point updated');
    });

    it('transforms milestone into inline input on click and saves on blur', async () => {
      const parent = document.createElement('div');
      document.body.appendChild(parent);

      const mem = {
        topicName: 'Project Alpha',
        keyFacts: [],
        activeMilestones: ['Launch Q3'],
        openThreads: []
      };

      await renderWorkstreamOverviewTab('Project Alpha', parent, mem);

      const milestoneSpan = parent.querySelector('.ws-point-milestone-text');
      expect(milestoneSpan).not.toBeNull();

      milestoneSpan.click();
      const input = milestoneSpan.querySelector('input.ws-point-inline-edit');
      expect(input).not.toBeNull();

      input.value = 'Launch Q4 Final';
      input.dispatchEvent(new Event('blur'));

      expect(saveMajorTopicMemory).toHaveBeenCalled();
      const saved = savedMemoryStore.get('Project Alpha');
      expect(saved.activeMilestones).toEqual(['Launch Q4 Final']);
    });

    it('transforms open thread into inline input and cancels on Escape without saving', async () => {
      const parent = document.createElement('div');
      document.body.appendChild(parent);

      const mem = {
        topicName: 'Project Alpha',
        keyFacts: [],
        activeMilestones: [],
        openThreads: ['Needs budget approval?']
      };

      await renderWorkstreamOverviewTab('Project Alpha', parent, mem);

      const threadSpan = parent.querySelector('.ws-point-thread-text');
      expect(threadSpan).not.toBeNull();

      threadSpan.click();
      const input = threadSpan.querySelector('input.ws-point-inline-edit');
      expect(input).not.toBeNull();

      input.value = 'Cancelled text change';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      // Text should revert and save should not be called with the modified text
      expect(threadSpan.textContent).toBe('Needs budget approval?');
    });
  });

  describe('Tag Selection Hierarchy & Containment Detection', () => {
    beforeEach(() => {
      window._topicMemoriesIndexCache = {
        topics: [
          {
            key: 'calls',
            topicName: 'Calls',
            mappedTags: {
              tagGroups: [{ group: 'Calls', major: '', topic: '' }]
            }
          },
          {
            key: 'mobile_team',
            topicName: 'Mobile Team',
            mappedTags: {
              tagGroups: [{ group: 'Engineering', major: 'Mobile', topic: 'iOS' }]
            }
          }
        ]
      };
    });

    it('detects when current rule is a subset (part_of) of a broader workstream', () => {
      const currentRule = { group: 'Calls', major: '', topic: 'Leo' };
      const relations = window.detectTagGroupHierarchy(currentRule, 'Workstream Leo');

      expect(relations.length).toBeGreaterThan(0);
      expect(relations[0].type).toBe('part_of');
      expect(relations[0].workstream).toBe('Calls');
      expect(relations[0].summary).toBe('Calls: Calls');
    });

    it('detects when current rule is broader (contains) than another workstream', () => {
      const currentRule = { group: 'Engineering', major: 'Mobile', topic: '' };
      const relations = window.detectTagGroupHierarchy(currentRule, 'Engineering Core');

      expect(relations.length).toBeGreaterThan(0);
      expect(relations[0].type).toBe('contains');
      expect(relations[0].workstream).toBe('Mobile Team');
      expect(relations[0].summary).toBe('Mobile Team: Engineering / Mobile / iOS');
    });

    it('detects exact matching workstream rule', () => {
      const currentRule = { group: 'Calls', major: '', topic: '' };
      const relations = window.detectTagGroupHierarchy(currentRule, 'New Calls');

      expect(relations.length).toBeGreaterThan(0);
      expect(relations[0].type).toBe('matches');
      expect(relations[0].workstream).toBe('Calls');
    });

    it('displays awareness banner in openAssignTagModal when rule overlaps', () => {
      window.manifest = [
        { id: 'note-1', title: 'Call 1', group_tags: ['Calls'], major_topic_tags: [], topic_tags: [] }
      ];
      const mem = { topicName: 'Workstream Leo', mappedTags: { tagGroups: [] } };
      openAssignTagModal('Workstream Leo', mem, -1);

      const overlay = document.getElementById('modal-assign-tag');
      const groupInput = overlay.querySelector('#ws-tag-group input');
      expect(groupInput).not.toBeNull();

      // Trigger selection of Calls tag
      groupInput.value = 'Calls';
      groupInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      const hierarchyBox = overlay.querySelector('#ws-assign-tag-hierarchy-box');
      expect(hierarchyBox).not.toBeNull();
      expect(hierarchyBox.style.display).toBe('flex');
      expect(hierarchyBox.textContent).toContain('Calls');

      overlay.remove();
    });

    it('displays hierarchy indicator on workstream selection chips', async () => {
      const parent = document.createElement('div');
      document.body.appendChild(parent);

      const mem = {
        topicName: 'Workstream Leo',
        keyFacts: [],
        activeMilestones: [],
        openThreads: [],
        mappedTags: {
          tagGroups: [{ group: 'Calls', major: '', topic: 'Leo' }]
        }
      };

      await renderWorkstreamOverviewTab('Workstream Leo', parent, mem);

      const chip = parent.querySelector('.workstream-selection-chip');
      expect(chip).not.toBeNull();
      const hint = chip.querySelector('.workstream-hierarchy-chip-hint');
      expect(hint).not.toBeNull();
      expect(hint.textContent).toContain('Calls: Calls');
    });
  });

  describe('Workstream Creation Wizard Tag Defaulting Fix & Translation', () => {
    it('translates notes count badge in create workstream modal', () => {
      window.manifest = [
        { id: 'n1', title: 'Note 1', group_tags: ['Calls'], topic_tags: ['Leo'] },
        { id: 'n2', title: 'Note 2', group_tags: ['Calls'], topic_tags: ['Leo'] }
      ];

      window.openCreateWorkstreamModal();

      const overlay = document.getElementById('modal-create-workstream');
      expect(overlay).not.toBeNull();

      const badge = overlay.querySelector('#ws-create-matching-badge');
      expect(badge).not.toBeNull();
      expect(badge.textContent).toContain('note(s)');

      overlay.remove();
    });

    it('does not replace empty Major topic with workstream name and matches notes automatically', async () => {
      window.manifest = [
        { id: 'n1', title: 'Note 1', group_tags: ['Calls'], topic_tags: ['Leo'] },
        { id: 'n2', title: 'Note 2', group_tags: ['Calls'], topic_tags: ['Leo'] }
      ];

      window.WorkstreamMemoryEngine = {
        saveMajorTopicMemory: vi.fn(async (name, payload) => {
          savedMemoryStore.set(name, payload);
        })
      };

      window.openCreateWorkstreamModal();
      const overlay = document.getElementById('modal-create-workstream');

      const nameInput = overlay.querySelector('#ws-modal-topic-name');
      nameInput.value = 'Workstream Leo';

      const groupInput = overlay.querySelector('#ws-create-tag-group input');
      groupInput.value = 'Calls';
      groupInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      const topicInput = overlay.querySelector('#ws-create-tag-topic input');
      topicInput.value = 'Leo';
      topicInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      // Major topic is left empty!
      // Verify notes match: 2 notes should match Calls + Leo
      const badge = overlay.querySelector('#ws-create-matching-badge');
      expect(badge.textContent).toBe('2 note(s)');

      // Create Empty workstream
      const emptyBtn = overlay.querySelector('#btn-ws-create-empty');
      emptyBtn.click();

      // Verify payload saved by WorkstreamMemoryEngine
      expect(window.WorkstreamMemoryEngine.saveMajorTopicMemory).toHaveBeenCalled();
      const saved = savedMemoryStore.get('Workstream Leo');
      expect(saved).not.toBeNull();
      // Major tags must be empty, NOT 'Workstream Leo'!
      expect(saved.mappedTags.major_topic_tags).toEqual([]);
      expect(saved.mappedTags.tagGroups[0].group).toBe('Calls');
      expect(saved.mappedTags.tagGroups[0].major).toBe('');
      expect(saved.mappedTags.tagGroups[0].topic).toBe('Leo');
    });
  });
});
