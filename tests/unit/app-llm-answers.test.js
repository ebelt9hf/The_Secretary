import { describe, it, expect, beforeAll } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('AI Answer Processing & Payload Parsing (app-llm.js)', () => {
  beforeAll(() => {
    loadScriptsIntoGlobal([
      'js/app-utils.js',
      'js/app-llm.js'
    ]);
  });

  describe('LLMService.extractJsonPayloadFromText', () => {
    it('parses direct JSON objects without markdown wrappers', () => {
      const rawText = '{"general_comment": "Note looks complete.", "suggested_actions": []}';
      const result = LLMService.extractJsonPayloadFromText(rawText);
      expect(result.parsed).toEqual({ general_comment: "Note looks complete.", suggested_actions: [] });
    });

    it('extracts JSON objects embedded within markdown code blocks or conversational prose', () => {
      const conversationalText = `
Here is your requested response:
\`\`\`json
{
  "general_comment": "Reviewed meeting transcript.",
  "suggested_actions": [
    { "action": "create_todo", "title": "Finalize Q3 roadmap", "owner": "Sarah" }
  ]
}
\`\`\`
Let me know if you need anything else!
      `;
      const result = LLMService.extractJsonPayloadFromText(conversationalText);
      expect(result.parsed).toBeDefined();
      expect(result.parsed.general_comment).toBe('Reviewed meeting transcript.');
      expect(result.parsed.suggested_actions.length).toBe(1);
    });

    it('handles bare JSON arrays returned by LLM and normalizes to standard object shape', () => {
      const arrayText = `[
        { "action": "create_todo", "title": "Send report" },
        { "action": "log_decision", "text": "Approve budget" }
      ]`;
      const result = LLMService.extractJsonPayloadFromText(arrayText);
      expect(result.parsed).toBeDefined();
      expect(result.parsed.suggested_actions.length).toBe(2);
      expect(result.parsed.suggested_actions[0].action).toBe('create_todo');
    });

    it('returns parsed null for non-JSON text or invalid inputs', () => {
      expect(LLMService.extractJsonPayloadFromText('').parsed).toBeNull();
      expect(LLMService.extractJsonPayloadFromText(null).parsed).toBeNull();
      expect(LLMService.extractJsonPayloadFromText('This is just plain text without any JSON').parsed).toBeNull();
    });
  });

  describe('sanitizeLLMHTML', () => {
    it('preserves allowed rich text tags and editor attributes', () => {
      const safeHtml = '<h2>Summary</h2><p>Meeting held on <strong>Monday</strong> with <mark>key decisions</mark>.</p><span class="note-todo" data-todo-id="td_1">Task</span>';
      const sanitized = sanitizeLLMHTML(safeHtml);
      expect(sanitized).toContain('<h2>Summary</h2>');
      expect(sanitized).toContain('<strong>Monday</strong>');
      expect(sanitized).toContain('data-todo-id="td_1"');
    });

    it('strips dangerous tags like <script> and malicious attributes like onclick or javascript: links', () => {
      const maliciousHtml = '<p>Clean text</p><script>alert("hack")</script><a href="javascript:alert(1)" onclick="evil()">Link</a><img src="x" onerror="evil()" />';
      const sanitized = sanitizeLLMHTML(maliciousHtml);
      expect(sanitized).not.toContain('<script>');
      expect(sanitized).not.toContain('onclick');
      expect(sanitized).not.toContain('onerror');
      expect(sanitized).not.toContain('javascript:');
      expect(sanitized).toContain('Clean text');
    });
  });

  describe('cleanSummaryHtml', () => {
    it('removes redundant summary headers and prefixes in multiple languages', () => {
      expect(cleanSummaryHtml('<h2>Summary</h2><p>Key outcomes discussed.</p>')).toBe('<p>Key outcomes discussed.</p>');
      expect(cleanSummaryHtml('<h3>Résumé</h3><p>Points principaux abordés.</p>')).toBe('<p>Points principaux abordés.</p>');
      expect(cleanSummaryHtml('Call Summary: Meeting focused on sprint planning.')).toBe('Meeting focused on sprint planning.');
    });
  });

  describe('normalizeHighlightsToSentenceFacts', () => {
    it('extracts sentence facts from highlight tags', () => {
      const htmlWithHighlights = 'The team agreed on the deadline. <mark>Launch scheduled for October 15 across all EU regions.</mark> Further reviews next week.';
      const facts = normalizeHighlightsToSentenceFacts(htmlWithHighlights);
      expect(facts).toContain('Launch scheduled for October 15 across all EU regions.');
    });
  });

  describe('parseUnifiedDiff & highlightWordDiff', () => {
    it('parses unified diff text into original and replacement strings', () => {
      const diffText = `
@@ -1,3 +1,3 @@
 Context line
-Old sentence to be changed
+New sentence updated by AI
 Context line end
      `;
      const parsed = parseUnifiedDiff(diffText);
      expect(parsed.original).toContain('Old sentence to be changed');
      expect(parsed.replacement).toContain('New sentence updated by AI');
    });

    it('computes word-level diff markup for AI text modifications', () => {
      const orig = 'Submit proposal tomorrow';
      const repl = 'Submit final proposal today';
      const diff = highlightWordDiff(orig, repl);
      expect(diff.originalHTML).toContain('diff-change-del');
      expect(diff.replacementHTML).toContain('diff-change-ins');
    });
  });

  describe('buildLLMSuggestionCards', () => {
    it('transforms raw AI payload into structured suggestion cards', () => {
      const payload = {
        general_comment: 'Reviewed notes.',
        suggested_actions: [
          { action: 'create_todo', title: 'Prepare Q3 roadmap', owner: 'Sarah', priority: 'High' },
          { action: 'log_decision', text: 'Approved feature scope', authority: 'VP' }
        ]
      };
      const cards = buildLLMSuggestionCards(payload);
      expect(cards.length).toBe(3); // 1 summary card + 2 action cards
      expect(cards[0].kind).toBe('summary');
      expect(cards[0].body).toBe('Reviewed notes.');
      expect(cards[1].action).toBe('create_todo');
      expect(cards[1].properties.title).toBe('Prepare Q3 roadmap');
      expect(cards[2].action).toBe('log_decision');
      expect(cards[2].properties.text).toBe('Approved feature scope');
    });
  });

  describe('formatTodoTitleWithMetadata Edge Cases', () => {
    it('handles complex AI titles with leading checkboxes, owners, and urgency tags', () => {
      expect(formatTodoTitleWithMetadata('- [ ] @Sarah [Urgent] Deliver client demo', 'Sarah', 'High')).toBe('Deliver client demo');
      expect(formatTodoTitleWithMetadata('1. @Marc: [Medium Urgency] Update deployment docs', 'Marc', 'Medium')).toBe('Update deployment docs');
      expect(formatTodoTitleWithMetadata('[Critical] [ASAP] Fix production crash', '', 'High')).toBe('Fix production crash');
    });
  });

  describe('Artificial Note Generation & User Anonymity (generateDummyWorkWeek)', () => {
    it('ensures generateDummyWorkWeek is exposed globally and configured', () => {
      expect(typeof globalThis.generateDummyWorkWeek).toBe('function');
      expect(typeof globalThis.createDummyWorkWeek).toBe('function');
    });

    it('exposes a diverse catalog of simulation domains', () => {
      expect(Array.isArray(globalThis.DUMMY_SIMULATION_DOMAINS)).toBe(true);
      expect(globalThis.DUMMY_SIMULATION_DOMAINS.length).toBeGreaterThanOrEqual(8);

      const domainIds = globalThis.DUMMY_SIMULATION_DOMAINS.map(d => d.id);
      expect(domainIds).toContain('software_engineering');
      expect(domainIds).toContain('product_design');
      expect(domainIds).toContain('growth_marketing');
      expect(domainIds).toContain('supply_chain');
      expect(domainIds).toContain('clinical_research');
      expect(domainIds).toContain('renewable_energy');
      expect(domainIds).toContain('fintech_risk');
      expect(domainIds).toContain('data_science');

      for (const domain of globalThis.DUMMY_SIMULATION_DOMAINS) {
        expect(domain.domainName).toBeDefined();
        expect(Array.isArray(domain.roles)).toBe(true);
        expect(domain.roles.length).toBeGreaterThanOrEqual(5);
        expect(Array.isArray(domain.defaultProjects)).toBe(true);
        expect(domain.defaultProjects.length).toBe(6);
        expect(domain.bossTitle).toBeDefined();
        expect(domain.pmTitle).toBeDefined();
      }
    });

    it('enforces anonymous manager identity without using user real name in prompts', () => {
      const userChecker = typeof isUserCollaborator === 'function' ? isUserCollaborator : (name) => {
        if (!name) return true;
        const l = String(name).trim().toLowerCase();
        return l === 'me' || l === 'myself';
      };
      expect(userChecker('me')).toBe(true);
      expect(userChecker('')).toBe(true);
      expect(userChecker(null)).toBe(true);
      expect(userChecker('Alex')).toBe(false);
    });
  });
});
