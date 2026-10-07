import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

// ═══════════════════════════════════════════════════
// Sourced from: app-ai-progress-thinking.test.js
// ═══════════════════════════════════════════════════
describe('AI Progress Bar & Thinking Process Integration', () => {
  beforeAll(() => {
    loadScriptsIntoGlobal([
      'js/app-utils.js',
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-llm.js',
      'js/app-collab.js'
    ]);
  });

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="note-editor-ai-progress" class="note-editor-ai-progress" style="display:none;">
        <div class="note-editor-ai-progress-header">
          <span class="note-editor-ai-progress-title" id="note-editor-ai-progress-title"></span>
          <span class="note-editor-ai-progress-pct" id="note-editor-ai-progress-pct">0%</span>
          <button id="btn-note-editor-ai-cancel">Cancel</button>
        </div>
        <div class="note-editor-ai-progress-track">
          <div id="note-editor-ai-progress-bar" style="width:0%;"></div>
        </div>
        <div class="note-editor-ai-progress-status" id="note-editor-ai-progress-status"></div>
        <div class="note-editor-ai-progress-thinking" id="note-editor-ai-progress-thinking" style="display:none;"></div>
      </div>
      <div id="ws-synthesis-console-stream"></div>
    `;
  });

  describe('RefactorModalController.updateRefactorProgress', () => {
    it('updates percentage, status message, custom title and thinking process container', () => {
      RefactorModalController.updateRefactorProgress(45, 'Parsing note details...', '<think>Extracting action items</think>', 'Reviewing note...');

      const wrap = document.getElementById('note-editor-ai-progress');
      const bar = document.getElementById('note-editor-ai-progress-bar');
      const pct = document.getElementById('note-editor-ai-progress-pct');
      const title = document.getElementById('note-editor-ai-progress-title');
      const status = document.getElementById('note-editor-ai-progress-status');
      const thinking = document.getElementById('note-editor-ai-progress-thinking');

      expect(wrap.style.display).toBe('flex');
      expect(bar.style.width).toBe('45%');
      expect(pct.textContent).toBe('45%');
      expect(title.textContent).toBe('Reviewing note...');
      expect(status.textContent).toBe('Parsing note details...');
      expect(thinking.style.display).toBe('block');
      expect(thinking.innerHTML).toContain('Extracting action items');
    });

    it('hides progress bar and thinking element when pct is false', () => {
      RefactorModalController.updateRefactorProgress(50, 'Working...', 'Thinking...');
      RefactorModalController.updateRefactorProgress(false);

      const wrap = document.getElementById('note-editor-ai-progress');
      const thinking = document.getElementById('note-editor-ai-progress-thinking');

      expect(wrap.style.display).toBe('none');
      expect(thinking.style.display).toBe('none');
      expect(thinking.innerHTML).toBe('');
    });

    it('shows in-modal progress banner and hides background note editor progress when proposals modal is active', () => {
      document.body.innerHTML += `
        <div id="modal-refactor-proposals" class="active" style="display:block;">
          <div id="refactor-modal-progress-banner" style="display:none;">
            <span id="refactor-modal-progress-text"></span>
            <div id="refactor-modal-progress-bar" style="width:0%;"></div>
          </div>
        </div>
      `;

      RefactorModalController.updateRefactorProgress(40, 'Generating Option C...');

      const modalBanner = document.getElementById('refactor-modal-progress-banner');
      const modalText = document.getElementById('refactor-modal-progress-text');
      const editorWrap = document.getElementById('note-editor-ai-progress');

      expect(modalBanner.style.display).toBe('flex');
      expect(modalText.textContent).toBe('Generating Option C...');
      expect(editorWrap.style.display).toBe('none');
    });
  });

  describe('LLM reasoningText Extraction', () => {
    it('extracts reasoningText from envelope reasoning_content and <think> tags', () => {
      const envelope = {
        choices: [{
          message: {
            reasoning_content: 'Reasoning step 1',
            content: '<think>Reasoning step 2</think>Clean reply text'
          }
        }]
      };
      const info = LLMService.extractReplyInfoFromEnvelope(envelope);
      const rawText = info.replyText;
      const reasoningObj = LLMService.extractReasoningAndContent(rawText);
      const combined = (info.replyFromReasoning + '\n' + reasoningObj.reasoningText).trim();

      expect(combined).toContain('Reasoning step 1');
      expect(combined).toContain('Reasoning step 2');
      expect(reasoningObj.cleanContent).toBe('Clean reply text');
    });
  });
});

// ═══════════════════════════════════════════════════
// Sourced from: app-thinking-helpers.test.js
// ═══════════════════════════════════════════════════
describe('AI Agent Thinking & Reasoning Process Helpers (app-llm.js)', () => {
  beforeAll(() => {
    loadScriptsIntoGlobal([
      'js/app-utils.js',
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-llm.js'
    ]);
  });

  describe('LLMService.extractReasoningAndContent', () => {
    it('extracts closed <think>...</think> tags from model output', () => {
      const input = '<think>I need to check the user schedule and notes.</think>Here is your summary for today.';
      const res = LLMService.extractReasoningAndContent(input);
      expect(res.reasoningText).toBe('I need to check the user schedule and notes.');
      expect(res.cleanContent).toBe('Here is your summary for today.');
    });

    it('extracts closed <thought>...</thought> tags', () => {
      const input = '<thought>Analyzing requested project task.</thought>\n\n- Task 1\n- Task 2';
      const res = LLMService.extractReasoningAndContent(input);
      expect(res.reasoningText).toBe('Analyzing requested project task.');
      expect(res.cleanContent).toBe('- Task 1\n- Task 2');
    });

    it('extracts [THOUGHT]...[/THOUGHT] tags', () => {
      const input = '[THOUGHT]Refactoring note content.[/THOUGHT]Updated note content.';
      const res = LLMService.extractReasoningAndContent(input);
      expect(res.reasoningText).toBe('Refactoring note content.');
      expect(res.cleanContent).toBe('Updated note content.');
    });

    it('handles unclosed streaming <think> tags', () => {
      const input = '<think>Still calculating optimal schedule for tomorrow...';
      const res = LLMService.extractReasoningAndContent(input, { isStreaming: true });
      expect(res.reasoningText).toBe('Still calculating optimal schedule for tomorrow...');
      expect(res.cleanContent).toBe('');
    });

    it('returns empty reasoningText if no thinking tags exist', () => {
      const input = 'Just a standard plain response.';
      const res = LLMService.extractReasoningAndContent(input);
      expect(res.reasoningText).toBe('');
      expect(res.cleanContent).toBe('Just a standard plain response.');
    });
  });

  describe('LLMService.renderThinkingAccordionHTML', () => {
    it('renders structured HTML disclosure accordion with tooltips and copy button', () => {
      const thoughtText = 'Checking calendar events and task list.';
      const html = LLMService.renderThinkingAccordionHTML(thoughtText, { title: 'Thought process' });
      
      expect(html).toContain('class="chat-thinking-accordion"');
      expect(html).toContain('title=');
      expect(html).toContain('Checking calendar events and task list.');
      expect(html).toContain('chat-thinking-copy-btn');
    });

    it('returns empty string if thought content is blank', () => {
      const html = LLMService.renderThinkingAccordionHTML('');
      expect(html).toBe('');
    });
  });

  describe('LLMService.formatThoughtLogStep', () => {
    it('formats step name and details into markdown bullet item', () => {
      const step = LLMService.formatThoughtLogStep('Read note', 'notes/meeting.html');
      expect(step).toContain('Read note');
      expect(step).toContain('notes/meeting.html');
    });
  });
});

// ═══════════════════════════════════════════════════
// Sourced from: app-llm-discovery.test.js
// ═══════════════════════════════════════════════════
describe('LLMModelDiscoveryEngine (Local AI Model Auto-Discovery)', () => {
  beforeAll(() => {
    globalThis.window = globalThis.window || {};
    globalThis.t = (key) => key;
    globalThis.escH = (s) => String(s || '');

    loadScriptsIntoGlobal([
      'js/app-utils.js',
      'js/app-llm.js'
    ]);
  });

  it('parses Ollama /api/tags response schema', () => {
    const ollamaResponse = {
      models: [
        { name: 'llama3:latest', model: 'llama3:latest', size: 4661224676 },
        { name: 'mistral:7b', model: 'mistral:7b', size: 4109865159 },
        { name: 'deepseek-r1:8b', model: 'deepseek-r1:8b', size: 4920756736 }
      ]
    };

    const models = LLMModelDiscoveryEngine.parseOllamaModels(ollamaResponse);
    expect(models).toEqual(['llama3:latest', 'mistral:7b', 'deepseek-r1:8b']);
  });

  it('parses OpenAI / LM Studio / vLLM /v1/models response schema', () => {
    const v1Response = {
      data: [
        { id: 'qwen2.5-coder-7b-instruct', object: 'model', owned_by: 'local' },
        { id: 'meta-llama-3.1-8b-instruct', object: 'model', owned_by: 'local' }
      ]
    };

    const models = LLMModelDiscoveryEngine.parseOpenAICompatibleModels(v1Response);
    expect(models).toEqual(['qwen2.5-coder-7b-instruct', 'meta-llama-3.1-8b-instruct']);
  });

  it('handles empty or malformed responses gracefully', () => {
    expect(LLMModelDiscoveryEngine.parseOllamaModels(null)).toEqual([]);
    expect(LLMModelDiscoveryEngine.parseOllamaModels({})).toEqual([]);
    expect(LLMModelDiscoveryEngine.parseOpenAICompatibleModels(null)).toEqual([]);
    expect(LLMModelDiscoveryEngine.parseOpenAICompatibleModels({ data: 'not an array' })).toEqual([]);
  });
});
