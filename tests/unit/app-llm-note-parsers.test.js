import { describe, it, expect, beforeAll } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('Note & AI Structured Parsers (Todos, Decisions, Mentions, Highlights)', () => {
  beforeAll(() => {
    loadScriptsIntoGlobal([
      'js/app-utils.js',
      'js/translations.js',
      'js/app-llm.js'
    ]);
  });

  describe('LLMService.extractTodosFromNote', () => {
    it('parses structured .note-todo HTML elements with all attributes', () => {
      const noteHtml = `
        <div class="note-body">
          <p>Meeting discussion</p>
          <span class="note-todo" data-todo-id="td_123" data-todo-priority="High" data-importance="High" data-urgency="Q1" data-owner="Sarah" data-owner-id="collab_1">
            <span class="note-todo-text">Prepare Q3 financial roadmap</span>
          </span>
          <span class="note-todo note-todo-done" data-todo-id="td_124" data-todo-priority="Low" data-owner="Alex">
            <span class="note-todo-text">Send calendar invites</span>
          </span>
        </div>
      `;

      const todos = LLMService.extractTodosFromNote(noteHtml);
      expect(todos.length).toBe(2);

      expect(todos[0].id).toBe('td_123');
      expect(todos[0].title).toBe('Prepare Q3 financial roadmap');
      expect(todos[0].priority).toBe('High');
      expect(todos[0].owner).toBe('Sarah');
      expect(todos[0].urgency).toBe('Q1');
      expect(todos[0].isDone).toBe(false);

      expect(todos[1].id).toBe('td_124');
      expect(todos[1].title).toBe('Send calendar invites');
      expect(todos[1].isDone).toBe(true);
    });

    it('extracts plain text / list item todos when no HTML spans are present', () => {
      const text = `
        <h2>Next Steps</h2>
        <ul>
          <li>[ ] Finalize API design (@Alex)</li>
          <li>Action: Update documentation</li>
          <li>TODO: Review budget with @Sarah</li>
        </ul>
      `;

      const todos = LLMService.extractTodosFromNote(text, { includeUnstructured: true });
      expect(todos.length).toBe(3);
      expect(todos[0].title).toContain('Finalize API design');
      expect(todos[0].owner).toBe('Alex');
      expect(todos[1].title).toContain('Update documentation');
      expect(todos[2].title).toContain('Review budget');
      expect(todos[2].owner).toBe('Sarah');
    });
  });

  describe('LLMService.extractDecisionsFromNote', () => {
    it('parses structured .note-decision-wrapper HTML elements', () => {
      const noteHtml = `
        <div class="note-body">
          <span class="note-decision-wrapper" data-decision-status="active" data-decision-owner="Morgan" data-decision-topic="Infrastructure" data-decision-major="Core-Tech" data-decision-context="Agreed on PostgreSQL for scalability">
            <strong class="pill-decision">!decision:active</strong>
            <span class="note-decision-text">Migrate database to PostgreSQL 16</span>
          </span>
        </div>
      `;

      const decisions = LLMService.extractDecisionsFromNote(noteHtml);
      expect(decisions.length).toBe(1);
      expect(decisions[0].text).toBe('Migrate database to PostgreSQL 16');
      expect(decisions[0].status).toBe('active');
      expect(decisions[0].owner).toBe('Morgan');
      expect(decisions[0].topic).toBe('Infrastructure');
      expect(decisions[0].majorTopic).toBe('Core-Tech');
      expect(decisions[0].context).toBe('Agreed on PostgreSQL for scalability');
    });

    it('extracts plain text decisions from headers or prefixes', () => {
      const text = `
        <h2>Decisions</h2>
        <ul>
          <li>!decision:active Approved 15% marketing budget increase</li>
          <li>Decision: Launch beta in November 2026</li>
        </ul>
      `;

      const decisions = LLMService.extractDecisionsFromNote(text, { includeUnstructured: true });
      expect(decisions.length).toBe(2);
      expect(decisions[0].text).toBe('Approved 15% marketing budget increase');
      expect(decisions[0].status).toBe('active');
      expect(decisions[1].text).toBe('Launch beta in November 2026');
    });
  });

  describe('LLMService.extractColleagueMentionsFromNote', () => {
    it('extracts unique @mentions and colleague badges', () => {
      const html = `
        <p>Met with <span class="pill-mention" data-colleague="Sarah">@Sarah</span> and @Alex to discuss the plan.</p>
        <p>Assigned task to <span class="note-todo-badge owner-tag" data-owner="Morgan">@Morgan</span>.</p>
        <p>Follow up with @Sarah tomorrow.</p>
      `;

      const colleagues = LLMService.extractColleagueMentionsFromNote(html);
      expect(colleagues).toEqual(['Sarah', 'Alex', 'Morgan']);
    });
  });

  describe('LLMService.extractHighlightsFromNote', () => {
    it('extracts and deduplicates mark highlights', () => {
      const html = `
        <p>Start of meeting. <mark>Q3 revenue exceeded forecast by 25%.</mark> Discussion followed.</p>
        <p><span class="note-highlight">New partnership signed with Acme Corp.</span></p>
        <p>Repeated: <mark>Q3 revenue exceeded forecast by 25%.</mark></p>
      `;

      const highlights = LLMService.extractHighlightsFromNote(html);
      expect(highlights.length).toBe(2);
      expect(highlights[0]).toBe('Q3 revenue exceeded forecast by 25%.');
      expect(highlights[1]).toBe('New partnership signed with Acme Corp.');
    });
  });

  describe('LLMService.parseNoteStructure', () => {
    it('parses a full note HTML into composite structured sections', () => {
      const noteHtml = `
        <title>Weekly Engineering Sync</title>
        <section id="note-summary">
          <p>Productive sprint review. <mark>Backend latency reduced by 40%.</mark></p>
        </section>
        <main>
          <h2>Key Discussion Points</h2>
          <p>Reviewed progress with @Jordan and @Taylor.</p>
          <h2>Decisions</h2>
          <span class="note-decision-wrapper" data-decision-status="active">
            <span class="note-decision-text">Adopt Vitest as primary test runner</span>
          </span>
          <h2>Next Steps & Action Items</h2>
          <span class="note-todo" data-todo-id="t1" data-todo-priority="High" data-owner="Taylor">
            <span class="note-todo-text">Configure CI pipeline for Vitest</span>
          </span>
        </main>
      `;

      const struct = LLMService.parseNoteStructure(noteHtml);
      expect(struct.title).toBe('Weekly Engineering Sync');
      expect(struct.summary).toContain('Productive sprint review');
      expect(struct.highlights).toContain('Backend latency reduced by 40%.');
      expect(struct.colleagues).toEqual(['Jordan', 'Taylor']);
      expect(struct.decisions.length).toBe(1);
      expect(struct.decisions[0].text).toBe('Adopt Vitest as primary test runner');
      expect(struct.todos.length).toBe(1);
      expect(struct.todos[0].title).toBe('Configure CI pipeline for Vitest');
      expect(struct.todos[0].owner).toBe('Taylor');
      expect(struct.sections.length).toBeGreaterThan(0);
    });
  });

  describe('LLMService.parseAiSuggestedActions', () => {
    it('normalizes various AI suggestion formats into clean structured objects', () => {
      const aiPayload = {
        general_comment: 'Reviewed note.',
        suggested_actions: [
          { action: 'create_todo', properties: { title: 'Implement feature', owner: 'Alex', priority: 'High' } },
          { action: 'log_decision', properties: { text: 'Approve design system', status: 'active', major_topic: 'UI' } },
          { action: 'text_correction', properties: { target_string: 'old typo', replacement_text: 'fixed text' } }
        ],
        proposed_todos: [
          { title: 'Write unit tests', owner: 'Sarah', importance: 'Medium', urgency: 'High' }
        ],
        proposed_decisions: [
          { text: 'Deploy to staging', status: 'active' }
        ],
        proposed_colleague_links: ['Alex', 'Sarah']
      };

      const parsed = LLMService.parseAiSuggestedActions(aiPayload);
      expect(parsed.todos.length).toBe(2);
      expect(parsed.todos[0].title).toBe('Implement feature');
      expect(parsed.todos[1].title).toBe('Write unit tests');

      expect(parsed.decisions.length).toBe(2);
      expect(parsed.decisions[0].text).toBe('Approve design system');
      expect(parsed.decisions[1].text).toBe('Deploy to staging');

      expect(parsed.corrections.length).toBe(1);
      expect(parsed.corrections[0].target_string).toBe('old typo');

      expect(parsed.colleagueLinks).toEqual(['Alex', 'Sarah']);
    });
  });
});
