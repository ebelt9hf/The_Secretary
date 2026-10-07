import { describe, it, expect, beforeAll } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('App Utilities (app-utils.js)', () => {
  beforeAll(() => {
    loadScriptsIntoGlobal(['js/app-utils.js']);
    globalThis.settings = { username: 'Etienne' };
  });

  describe('isUserCollaborator & Collaborator Logic', () => {
    it('returns true for empty or "me" owner names', () => {
      expect(isUserCollaborator('')).toBe(true);
      expect(isUserCollaborator(null)).toBe(true);
      expect(isUserCollaborator('me')).toBe(true);
      expect(isUserCollaborator('ME')).toBe(true);
    });

    it('identifies owner matching current user settings', () => {
      expect(isUserCollaborator('Etienne')).toBe(true);
      expect(isUserCollaborator('etienne')).toBe(true);
      expect(isUserCollaborator('John Doe')).toBe(false);
    });

    it('evaluates isSameCollaborator correctly', () => {
      expect(isSameCollaborator('', '')).toBe(true);
      expect(isSameCollaborator('me', 'Etienne')).toBe(true);
      expect(isSameCollaborator('Alice', 'alice')).toBe(true);
      expect(isSameCollaborator('Alice', 'Bob')).toBe(false);
    });
  });

  describe('Todo Owner & Priority Utilities', () => {
    it('retrieves owner ID for todo objects', () => {
      expect(getTodoOwnerId(null)).toBe('me');
      expect(getTodoOwnerId({})).toBe('me');
      expect(getTodoOwnerId({ ownerId: 'user_123' })).toBe('user_123');
      expect(getTodoOwnerId({ owner: 'Alice' })).toBe('Alice');
    });

    it('identifies WIP todos', () => {
      expect(isTodoWip(null)).toBe(false);
      expect(isTodoWip({ status: 'WIP' })).toBe(true);
      expect(isTodoWip({ priority: 'WIP' })).toBe(true);
      expect(isTodoWip({ status: 'Done', priority: 'High' })).toBe(false);
    });

    it('calculates effective priority', () => {
      expect(getTodoEffectivePriority({ priority: 'High' })).toBe('High');
      expect(getTodoEffectivePriority({ priority: 'WIP', originalPriority: 'High' })).toBe('High');
      expect(getTodoEffectivePriority({ priority: 'WIP' })).toBe('Medium');
    });
  });

  describe('Eisenhower Matrix Utilities', () => {
    it('determines quadrant based on priority', () => {
      expect(EisenhowerUtils.getQuadrant({ priority: 'High' })).toBe('Q1');
      expect(EisenhowerUtils.getQuadrant({ priority: 'Medium' })).toBe('Q2');
      expect(EisenhowerUtils.getQuadrant({ priority: 'Low' })).toBe('Q3');
      expect(EisenhowerUtils.getQuadrant({ eisenhowerQuadrant: 'Q4' })).toBe('Q4');
    });

    it('derives quadrant from coordinates', () => {
      expect(EisenhowerUtils.getQuadrantFromCoords(20, 20)).toBe('Q1');
      expect(EisenhowerUtils.getQuadrantFromCoords(80, 20)).toBe('Q2');
      expect(EisenhowerUtils.getQuadrantFromCoords(20, 80)).toBe('Q3');
      expect(EisenhowerUtils.getQuadrantFromCoords(80, 80)).toBe('Q4');
    });

    it('parses quadrant tags correctly', () => {
      expect(EisenhowerUtils.parseQuadrantTag('Q1')).toEqual({ quadrant: 'Q1', priority: 'High' });
      expect(EisenhowerUtils.parseQuadrantTag('High')).toEqual({ quadrant: 'Q1', priority: 'High' });
      expect(EisenhowerUtils.parseQuadrantTag('Medium')).toEqual({ quadrant: 'Q2', priority: 'Medium' });
      expect(EisenhowerUtils.parseQuadrantTag('Low')).toEqual({ quadrant: 'Q3', priority: 'Low' });
      expect(EisenhowerUtils.parseQuadrantTag('Q4')).toEqual({ quadrant: 'Q4', priority: 'Low' });
    });

    it('cleans task title from HTML tags and urgency prefixes', () => {
      expect(EisenhowerUtils.cleanTaskTitle({ title: '<b>Fix Bug</b>' })).toBe('Fix Bug');
      expect(EisenhowerUtils.cleanTaskTitle({ title: 'todo urgency: High Refactor Module' })).toBe('Refactor Module');
      expect(cleanTaskTitleText('Medium Medium Etienne Write quarterly report')).toBe('Write quarterly report');
      expect(cleanTaskTitleText('High High Sarah Fix production database leak')).toBe('Fix production database leak');
      expect(cleanTaskTitleText('Medium Low Alex Update API endpoints')).toBe('Update API endpoints');
      expect(cleanTaskTitleText('⚡ Medium ⏳ Medium 👤 Etienne Prepare roadmap')).toBe('Prepare roadmap');
      expect(cleanTaskTitleText('Medium Etienne Review pull request')).toBe('Review pull request');
      expect(cleanTaskTitleText('High Etienne Follow up with client')).toBe('Follow up with client');
    });
  });

  describe('formatMinutesToHHMM & Time Formatting', () => {
    it('formats standard minute values correctly into HH:MM', () => {
      expect(formatMinutesToHHMM(0)).toBe('00:00');
      expect(formatMinutesToHHMM(90)).toBe('01:30');
      expect(formatMinutesToHHMM(540)).toBe('09:00');
      expect(formatMinutesToHHMM(1439)).toBe('23:59');
    });

    it('handles wrap-around and negative minute values', () => {
      expect(formatMinutesToHHMM(1440)).toBe('00:00');
      expect(formatMinutesToHHMM(1500)).toBe('01:00');
      expect(formatMinutesToHHMM(-60)).toBe('23:00');
    });

    it('handles floating numbers by rounding down', () => {
      expect(formatMinutesToHHMM(90.8)).toBe('01:30');
    });

    it('returns empty string for null, undefined, NaN, or non-numeric inputs', () => {
      expect(formatMinutesToHHMM(null)).toBe('');
      expect(formatMinutesToHHMM(undefined)).toBe('');
      expect(formatMinutesToHHMM('')).toBe('');
      expect(formatMinutesToHHMM(NaN)).toBe('');
      expect(formatMinutesToHHMM('invalid')).toBe('');
    });

    it('aliases formatTime to formatMinutesToHHMM', () => {
      expect(formatTime(120)).toBe('02:00');
    });
  });

  describe('compareTodoDates Utility', () => {
    it('sorts todo items descending by modified or created date', () => {
      const older = { modified: '2026-08-01T10:00:00Z' };
      const newer = { modified: '2026-08-27T10:00:00Z' };
      expect(compareTodoDates(newer, older)).toBeLessThan(0);
      expect(compareTodoDates(older, newer)).toBeGreaterThan(0);
      expect(compareTodoDates(newer, newer)).toBe(0);
    });

    it('falls back to created or date property if modified is missing', () => {
      const itemA = { created: '2026-08-20' };
      const itemB = { date: '2026-08-10' };
      expect(compareTodoDates(itemA, itemB)).toBeLessThan(0);
    });

    it('handles null or missing objects gracefully', () => {
      expect(compareTodoDates(null, null)).toBe(0);
      expect(compareTodoDates({}, null)).toBeLessThan(0);
      expect(compareTodoDates(null, {})).toBeGreaterThan(0);
    });
  });

  describe('Tag Matching & Verification Utilities', () => {
    it('verifies tagArrayContains with case and space tolerance', () => {
      expect(tagArrayContains(['Frontend', 'Backend'], 'frontend')).toBe(true);
      expect(tagArrayContains(['  Bug  '], 'bug')).toBe(true);
      expect(tagArrayContains(null, 'test')).toBe(false);
      expect(tagArrayContains(['A'], null)).toBe(false);
    });

    it('checks noteHasTag across all tag categories of a note', () => {
      const note = {
        group_tags: ['Work'],
        major_topic_tags: ['Core'],
        topic_tags: ['UI'],
        extra_tags: ['Urgent']
      };
      expect(noteHasTag(note, 'work')).toBe(true);
      expect(noteHasTag(note, 'core')).toBe(true);
      expect(noteHasTag(note, 'ui')).toBe(true);
      expect(noteHasTag(note, 'urgent')).toBe(true);
      expect(noteHasTag(note, 'missing')).toBe(false);
      expect(noteHasTag(null, 'work')).toBe(false);
    });

    it('checks noteHasAnyTag against a list of tags', () => {
      const note = { topic_tags: ['JS', 'CSS'] };
      expect(noteHasAnyTag(note, ['HTML', 'JS'])).toBe(true);
      expect(noteHasAnyTag(note, ['Python', 'Ruby'])).toBe(false);
      expect(noteHasAnyTag(note, [])).toBe(false);
    });
  });

  describe('Text Processing & Unique ID Utilities', () => {
    it('strips HTML tags and normalizes spaces with stripHtmlTags', () => {
      expect(stripHtmlTags('<p>Hello <b>World</b>!</p>')).toBe('Hello World !');
      expect(stripHtmlTags(null)).toBe('');
      expect(stripHtmlTags(undefined)).toBe('');
    });

    it('truncates text safely with truncateText', () => {
      expect(truncateText('Short text', 20)).toBe('Short text');
      expect(truncateText('This is a longer text string', 10)).toBe('This is a...');
      expect(truncateText(null)).toBe('');
    });

    it('generates unique collision-resistant IDs', () => {
      const id1 = generateUniqueId('test');
      const id2 = generateUniqueId('test');
      expect(id1).toMatch(/^test-\d+-[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });
  });

  describe('Tag Editor UI Component Helpers', () => {
    it('creates tag pill DOM element with createTagPill', () => {
      let removed = false;
      const pill = createTagPill('Frontend', {
        type: 'group',
        cssClass: 'custom-cls',
        onRemove: () => { removed = true; }
      });
      expect(pill.className).toContain('tag-pill');
      expect(pill.className).toContain('group-tag');
      expect(pill.dataset.tag).toBe('Frontend');
      expect(pill.getAttribute('title')).not.toBeNull();

      const btn = pill.querySelector('.rm');
      expect(btn).not.toBeNull();
      btn.click();
      expect(removed).toBe(true);
    });

    it('creates tag chip DOM element with makeTagChip', () => {
      let selected = false;
      const chip = makeTagChip('Core', {
        isAssigned: false,
        isMatch: true,
        onSelect: () => { selected = true; }
      });
      expect(chip.className).toContain('tag-suggest-chip');
      expect(chip.className).toContain('matching-highlight');
      expect(chip.getAttribute('title')).not.toBeNull();

      const evt = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      chip.dispatchEvent(evt);
      expect(selected).toBe(true);
    });
  });

  describe('Planner Block (Event) Entity Relationship Utilities', () => {
    it('normalizes linked note IDs correctly', () => {
      expect(normalizePlannerLinkedNoteIds([' note1 ', 'note2', 'note1'], 'primaryNote')).toEqual(['primaryNote', 'note1', 'note2']);
      expect(normalizePlannerLinkedNoteIds(null)).toEqual([]);
    });

    it('normalizes linked todo IDs correctly', () => {
      expect(normalizePlannerLinkedTodoIds(['todo_1', 'todo_2'], 'todo_1')).toEqual(['todo_1', 'todo_2']);
      expect(normalizePlannerLinkedTodoIds(undefined)).toEqual([]);
    });

    it('resolves linked note IDs for a planner event block', () => {
      const event = {
        noteId: 'note_main',
        linkedNoteIds: ['note_sec_1', 'note_sec_2']
      };
      expect(getPlannerEventLinkedNoteIds(event)).toEqual(['note_main', 'note_sec_1', 'note_sec_2']);
      expect(getPlannerEventLinkedNoteIds(event, { includePrimary: false })).toEqual(['note_sec_1', 'note_sec_2']);
      expect(getPlannerEventLinkedNoteIds(null)).toEqual([]);
    });

    it('resolves linked todo IDs for a planner event block', () => {
      const event = {
        todoId: 'todo_main',
        linkedTodoIds: ['todo_link_1']
      };
      expect(getPlannerEventLinkedTodoIds(event)).toEqual(['todo_main', 'todo_link_1']);
      expect(getPlannerEventLinkedTodoIds(event, { includePrimary: false })).toEqual(['todo_link_1']);
      expect(getPlannerEventLinkedTodoIds(null)).toEqual([]);
    });

    it('retrieves todo planner associations', () => {
      globalThis.plannerEvents = [
        { id: 'ev1', todoId: 'target_todo', title: 'Work Session' },
        { id: 'ev2', linkedTodoIds: ['target_todo'], title: 'Sync Call', type: 'meeting' }
      ];

      const associations = getTodoPlannerAssociations('target_todo');
      expect(associations.workSessions.length).toBe(1);
      expect(associations.meetings.length).toBe(1);
      expect(getTodoPlannerAssociations(null)).toEqual({ workSessions: [], meetings: [] });
    });
  });

  describe('AI Prompt & Context Builder Utilities', () => {
    it('formats note context for AI system prompts', () => {
      const note = { title: 'Project Overview', path: 'notes/overview.md' };
      const content = '# High Level Plan';
      const formatted = formatNoteContextForAI(note, content);
      expect(formatted).toContain('Note attachée: "Project Overview"');
      expect(formatted).toContain('[Path: notes/overview.md]');
      expect(formatted).toContain('# High Level Plan');
      expect(formatNoteContextForAI(null, '')).toBe('');
    });

    it('formats task/todo context for AI system prompts', () => {
      const todo = { id: 't1', title: 'Refactor Modules', priority: 'High', status: 'WIP', owner: 'Etienne' };
      const formatted = formatTaskContextForAI(todo);
      expect(formatted).toContain('Tâche attachée: [High] [Status: WIP] "Refactor Modules" (Assigné: Etienne)');
      expect(formatTaskContextForAI(null)).toBe('');
    });

    it('formats planner block event context for AI system prompts', () => {
      const event = { date: '2026-08-27', startTime: '09:00', endTime: '10:00', title: 'Sprint Review', type: 'meeting', description: 'Weekly sync' };
      const formatted = formatPlannerEventContextForAI(event);
      expect(formatted).toContain('Événement planifié attaché: [2026-08-27] 09:00-10:00 "Sprint Review" (Type: meeting) (Description: Weekly sync)');
      expect(formatPlannerEventContextForAI(null)).toBe('');
    });
  });

  describe('Sync Tags Between Planner Block and Note Utility', () => {
    it('handles null event gracefully without throwing errors', async () => {
      const result = await syncTagsBetweenBlocAndNote(null, null);
      expect(result).toBe(false);
    });

    it('syncs tags between event and note objects', async () => {
      const event = { group_tags: ['GroupA'], major_topic_tags: ['MajorA'], topic_tags: [] };
      const note = { id: 'n1', group_tags: [], major_topic_tags: [], topic_tags: ['TopicA'] };
      globalThis.manifest = [note];
      globalThis.plannerEvents = [event];

      const result = await syncTagsBetweenBlocAndNote(event, note);
      expect(result).toBe(true);
      expect(note.group_tags).toContain('GroupA');
      expect(note.topic_tags).toContain('TopicA');
      expect(event.topic_tags).toContain('TopicA');
    });
  });
});


