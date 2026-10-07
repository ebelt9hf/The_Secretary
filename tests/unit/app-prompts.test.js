import { describe, it, expect, beforeEach } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('AppPrompts Module (app-prompts.js)', () => {
  beforeEach(() => {
    loadScriptsIntoGlobal(['js/app-prompts.js']);
  });

  const ALL_15_LANGUAGES = [
    'en', 'de', 'fr', 'cs', 'es', 'hu', 'it', 'nl', 'pl', 'pt', 'ro', 'ru', 'sv', 'tr', 'uk'
  ];

  describe('Supported Languages & Language Directives', () => {
    it('supports exactly the 15 European languages of Secretary', () => {
      expect(AppPrompts.SUPPORTED_LANGUAGES).toEqual(ALL_15_LANGUAGES);
    });

    it('returns the correct display name for each language', () => {
      const expectedNames = {
        en: 'English',
        de: 'Deutsch (German)',
        fr: 'Français (French)',
        cs: 'Čeština (Czech)',
        es: 'Español (Spanish)',
        hu: 'Magyar (Hungarian)',
        it: 'Italiano (Italian)',
        nl: 'Nederlands (Dutch)',
        pl: 'Polski (Polish)',
        pt: 'Português (Portuguese)',
        ro: 'Română (Romanian)',
        ru: 'Русский (Russian)',
        sv: 'Svenska (Swedish)',
        tr: 'Türkçe (Turkish)',
        uk: 'Українська (Ukrainian)'
      };

      for (const lang of ALL_15_LANGUAGES) {
        expect(AppPrompts.getLanguageName(lang)).toBe(expectedNames[lang]);
      }
    });

    it('falls back to English for unknown or missing language codes', () => {
      expect(AppPrompts.getLanguageName('xx')).toBe('English');
      expect(AppPrompts.getLanguageName('')).toBe('English');
      expect(AppPrompts.getLanguageName(null)).toBe('English');
      expect(AppPrompts.getLanguageName(undefined)).toBe('English');
    });

    it('generates specific language directives for all 15 languages', () => {
      for (const lang of ALL_15_LANGUAGES) {
        const directive = AppPrompts.getLanguageDirective(lang);
        expect(directive).toBeTruthy();
        expect(directive).toContain('LANGUAGE REQUIREMENT');
        const langName = AppPrompts.getLanguageName(lang);
        expect(directive).toContain(langName);
      }
    });

    it('supports custom context keys in language directives', () => {
      const directive = AppPrompts.getLanguageDirective('de', 'action_items');
      expect(directive).toContain('Deutsch (German)');
      expect(directive).toContain('action_items');
    });
  });

  describe('buildNoteReviewPrompt', () => {
    it('generates prompt with full schema for default/full preset', () => {
      const prompt = AppPrompts.buildNoteReviewPrompt('full', 'en');
      expect(prompt).toContain('"summary"');
      expect(prompt).toContain('"actions"');
      expect(prompt).toContain('"corrections"');
      expect(prompt).toContain('CRITICAL OUTPUT INSTRUCTIONS: Respond with ONLY a valid, parseable JSON object');
    });

    it('generates prompt with only summary for summary_only preset', () => {
      const prompt = AppPrompts.buildNoteReviewPrompt('summary_only', 'fr');
      expect(prompt).toContain('"summary"');
      expect(prompt).not.toContain('"actions"');
      expect(prompt).not.toContain('"corrections"');
      expect(prompt).toContain('Français (French)');
    });

    it('generates prompt with only actions for actions_only preset', () => {
      const prompt = AppPrompts.buildNoteReviewPrompt('actions_only', 'de');
      expect(prompt).not.toContain('"summary"');
      expect(prompt).toContain('"actions"');
      expect(prompt).not.toContain('"corrections"');
      expect(prompt).toContain('Deutsch (German)');
    });

    it('generates prompt with only corrections for corrections_only preset', () => {
      const prompt = AppPrompts.buildNoteReviewPrompt('corrections_only', 'es');
      expect(prompt).not.toContain('"summary"');
      expect(prompt).not.toContain('"actions"');
      expect(prompt).toContain('"corrections"');
      expect(prompt).toContain('Español (Spanish)');
    });

    it('generates prompt with summary and actions for summary_actions preset', () => {
      const prompt = AppPrompts.buildNoteReviewPrompt('summary_actions', 'it');
      expect(prompt).toContain('"summary"');
      expect(prompt).toContain('"actions"');
      expect(prompt).not.toContain('"corrections"');
      expect(prompt).toContain('Italiano (Italian)');
    });

    it('applies the appropriate language directive for all 15 languages', () => {
      for (const lang of ALL_15_LANGUAGES) {
        const prompt = AppPrompts.buildNoteReviewPrompt('full', lang);
        expect(prompt).toContain(AppPrompts.getLanguageName(lang));
      }
    });

    it('contains standard vision & multimodal analysis directives', () => {
      const prompt = AppPrompts.buildNoteReviewPrompt('full', 'en');
      expect(prompt).toContain('VISION & MULTIMODAL ANALYSIS (STANDARD)');
      expect(prompt).toContain('Extract & Transcribe');
      expect(prompt).toContain('Add Explanations');
      expect(prompt).toContain('Extend the Note');
    });

    it('contains strict output and JSON escaping harness', () => {
      const prompt = AppPrompts.buildNoteReviewPrompt('full', 'en');
      expect(prompt).toContain('Strict Output Rules & Syntax Harness');
      expect(prompt).toContain('JSON ESCAPING HARNESS');
      expect(prompt).toContain('HTML CLEANLINESS');
    });
  });

  describe('buildSummaryPrompt', () => {
    it('generates a concise summary instruction with language directive for any language', () => {
      for (const lang of ALL_15_LANGUAGES) {
        const prompt = AppPrompts.buildSummaryPrompt(lang);
        expect(prompt).toContain('executive summary');
        expect(prompt).toContain(AppPrompts.getLanguageName(lang));
        expect(prompt).toContain('VISION & MULTIMODAL INTEGRATION (STANDARD)');
      }
    });

    it('contains output and escaping harness for summary', () => {
      const prompt = AppPrompts.buildSummaryPrompt('en');
      expect(prompt).toContain('Important rules & Syntax Harness');
      expect(prompt).toContain('JSON ESCAPING');
    });
  });

  describe('buildPerfectNotePrompt', () => {
    it('generates comprehensive system prompt containing core principles, harness and tools', () => {
      const prompt = AppPrompts.buildPerfectNotePrompt({
        lang: 'en',
        currentUserName: 'me',
        colleagueNames: ['Alice', 'Bob'],
        availableWorkstreams: ['Engineering', 'Design']
      });

      // Principles
      expect(prompt).toContain('Secretary Perfect Note Agent');
      expect(prompt).toContain('PRESERVE FACTUAL INTEGRITY');
      expect(prompt).toContain('CLEAN, STRUCTURED HTML');
      expect(prompt).toContain('TASK EXTRACTION');
      expect(prompt).toContain('TOPIC & WORKSTREAM RESOLUTION');

      // Vision & Image Placement Directives
      expect(prompt).toContain('VISION & MULTIMODAL ANALYSIS (STANDARD)');
      expect(prompt).toContain('Extract & Transcribe');
      expect(prompt).toContain('Add Explanations');
      expect(prompt).toContain('Extend the Note');
      expect(prompt).toContain('INLINE IMAGE PLACEMENT IN PROPOSALS (PRESERVE POSITIONING)');
      expect(prompt).toContain('Proposal B (Strict In-Situ Preservation)');
      expect(prompt).toContain('Proposal A (Executive Placement)');

      // Critical Output & Escaping Harness
      expect(prompt).toContain('CRITICAL OUTPUT FORMAT & JSON ESCAPING HARNESS');
      expect(prompt).toContain('ZERO PREAMBLE / ZERO CODEBLOCKS');
      expect(prompt).toContain('JSON ESCAPING INTEGRITY');
      expect(prompt).toContain('HTML PURITY & DISALLOWED ELEMENTS');
      expect(prompt).toContain('LIST STRUCTURE INTEGRITY');

      // Tools
      expect(prompt).toContain('update_content');
      expect(prompt).toContain('create_topic');
      expect(prompt).toContain('create_todos');
      expect(prompt).toContain('create_contacts');
      expect(prompt).toContain('append_log');
      expect(prompt).toContain('add_bookmark');

      // Available workstreams context
      expect(prompt).toContain('Engineering, Design');
    });

    it('injects language directive across all 15 languages', () => {
      for (const lang of ALL_15_LANGUAGES) {
        const prompt = AppPrompts.buildPerfectNotePrompt({ lang });
        expect(prompt).toContain(AppPrompts.getLanguageName(lang));
      }
    });
  });

  describe('buildRefinePerfectNotePrompt', () => {
    it('incorporates user feedback, amended proposal, vision directive, and language directive', () => {
      const prompt = AppPrompts.buildRefinePerfectNotePrompt(
        '<p>Initial note</p>',
        'Make the tone more professional and add deadlines.',
        { html: '<p>Proposed content</p>', actions: [] },
        'nl'
      );

      expect(prompt).toContain('Make the tone more professional and add deadlines.');
      expect(prompt).toContain('<p>Initial note</p>');
      expect(prompt).toContain('VISION & MULTIMODAL INTEGRATION (STANDARD)');
      expect(prompt).toContain('Nederlands (Dutch)');
    });
  });

  describe('buildOptionCWithFeedbackPrompt', () => {
    it('generates system prompt for Option C synthesizing from feedback across all 15 languages', () => {
      for (const lang of ALL_15_LANGUAGES) {
        const prompt = AppPrompts.buildOptionCWithFeedbackPrompt({
          targetLang: lang,
          currentUserName: 'Sarah',
          feedback: 'Make it more executive and highlight Q4 targets.'
        });

        expect(prompt).toContain('Make it more executive and highlight Q4 targets.');
        expect(prompt).toContain('@Sarah');
        expect(prompt).toContain('proposal_c_html');
        expect(prompt).toContain('proposed_todos');
        expect(prompt).toContain('proposed_decisions');
        expect(prompt).toContain('VISION & INLINE IMAGES (STANDARD)');
        expect(prompt).toContain(AppPrompts.getLanguageName(lang));
      }
    });
  });

  describe('buildNoteContextChatPrompt', () => {
    it('generates system prompt for note conversational lane across all 15 languages with vision understanding', () => {
      for (const lang of ALL_15_LANGUAGES) {
        const prompt = AppPrompts.buildNoteContextChatPrompt({ targetLang: lang });
        expect(prompt).toContain('Secretary\'s integrated AI assistant');
        expect(prompt).toContain(AppPrompts.getLanguageName(lang));
        expect(prompt).toContain('create_todo');
        expect(prompt).toContain('VISION & MULTIMODAL UNDERSTANDING (STANDARD)');
      }
    });
  });

  describe('buildScopingQuestionsPrompt & SystemPrompt', () => {
    it('builds system prompt and user prompt with language directives', () => {
      const sysPrompt = AppPrompts.buildScopingQuestionsSystemPrompt('pl');
      expect(sysPrompt).toContain('Polski (Polish)');
      expect(sysPrompt).toContain('JSON array of question objects');

      const userPrompt = AppPrompts.buildScopingQuestionsPrompt('Meeting with client about Q4 delivery', 4, 'pl');
      expect(userPrompt).toContain('Meeting with client about Q4 delivery');
      expect(userPrompt).toContain('4 questions');
      expect(userPrompt).toContain('Polski (Polish)');
    });
  });

  describe('buildWorkstreamMemoryPrompt & SystemPrompt', () => {
    it('builds memory synthesis prompts with language directive across all 15 languages', () => {
      for (const lang of ALL_15_LANGUAGES) {
        const sysPrompt = AppPrompts.buildWorkstreamMemorySystemPrompt(lang);
        expect(sysPrompt).toContain(AppPrompts.getLanguageName(lang));
        expect(sysPrompt).toContain('Workstream Memory Agent');

        const userPrompt = AppPrompts.buildWorkstreamMemoryUserPrompt({
          workstreamName: 'Product Launch',
          existingMemory: '',
          recentNotesText: 'Discussed launch blockers and timeline.'
        }, lang);

        expect(userPrompt).toContain('Product Launch');
        expect(userPrompt).toContain('Discussed launch blockers and timeline.');
        expect(userPrompt).toContain(AppPrompts.getLanguageName(lang));
      }
    });
  });

  describe('buildExternalAgentEmailProposalPrompt', () => {
    it('generates complete guidelines for external AI agents proposing planner events from email', () => {
      const prompt = AppPrompts.buildExternalAgentEmailProposalPrompt();
      expect(prompt).toContain('# External AI Agent Guidelines: Extracting Calendar Events from Email into Secretary');
      expect(prompt).toContain('planner-proposals.json');
      expect(prompt).toContain('Append-Only Rule');
      expect(prompt).toContain('Which email program or mailbox should I inspect');
      expect(prompt).toContain('"proposals"');
      expect(prompt).toContain('"status": "pending"');

      // Verify all 8 supported event types are explicitly explained
      const supportedTypes = ['call', 'sync', 'prep', 'work', 'todo', 'personal', 'ooo', 'custom'];
      supportedTypes.forEach(type => {
        expect(prompt).toContain(`"${type}"`);
      });
      expect(prompt).toContain('Voice or video call');
      expect(prompt).toContain('Team synchronization');
      expect(prompt).toContain('Meeting preparation');
      expect(prompt).toContain('Dedicated deep work');
      expect(prompt).toContain('Scheduled work session');
      expect(prompt).toContain('Personal event, break');
      expect(prompt).toContain('Out of Office');
      expect(prompt).toContain('Flexible or uncategorized');
    });

    it('customizes prompt with user name when provided', () => {
      const prompt = AppPrompts.buildExternalAgentEmailProposalPrompt({ userName: 'Etienne' });
      expect(prompt).toContain('on behalf of user "Etienne"');
    });

    it('customizes prompt with exact workspace path when provided', () => {
      const prompt = AppPrompts.buildExternalAgentEmailProposalPrompt({
        userName: 'Etienne',
        workspacePath: '/Users/etienne/Projects/Secretary'
      });
      expect(prompt).toContain('/Users/etienne/Projects/Secretary/planner-proposals.json');
      expect(prompt).toContain('./planner-proposals.json');
      expect(prompt).toContain('FULLY IMPLEMENTED');
    });
  });
});
