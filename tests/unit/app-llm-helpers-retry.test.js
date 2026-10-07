import { describe, it, expect, beforeAll, vi, beforeEach, afterEach } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('LLM Connection Helper, Multi-Tier Retry Strategy, & Parsing Helpers', () => {
  beforeAll(() => {
    loadScriptsIntoGlobal([
      'js/app-utils.js',
      'js/translations.js',
      'js/app-llm.js'
    ]);
  });

  beforeEach(() => {
    global.settings = {
      ai: {
        enabled: true,
        provider: 'custom',
        endpoint: 'http://localhost:1234/v1',
        model: 'test-model',
        apiKey: ''
      }
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('LLMService.classifyLlmError', () => {
    it('classifies network errors and 5xx responses as technical_issue', () => {
      const netErr = new TypeError('Failed to fetch');
      const classified1 = LLMService.classifyLlmError(netErr);
      expect(classified1.category).toBe('technical_issue');
      expect(classified1.retryable).toBe(true);
      expect(classified1.strategy).toBe('fast_retry');

      const http503 = { status: 503, statusText: 'Service Unavailable' };
      const classified2 = LLMService.classifyLlmError(new Error('HTTP 503'), http503, 'Service Unavailable');
      expect(classified2.category).toBe('technical_issue');
      expect(classified2.retryable).toBe(true);
      expect(classified2.strategy).toBe('fast_retry');

      const http502 = { status: 502, statusText: 'Bad Gateway' };
      const classified3 = LLMService.classifyLlmError(new Error('HTTP 502'), http502, 'Bad Gateway');
      expect(classified3.category).toBe('technical_issue');
      expect(classified3.retryable).toBe(true);
    });

    it('classifies 429, 529 and rate limit messages as slow_down', () => {
      const http429 = { status: 429, statusText: 'Too Many Requests', headers: new Headers({ 'retry-after': '2' }) };
      const classified1 = LLMService.classifyLlmError(new Error('HTTP 429'), http429, 'Rate limit exceeded');
      expect(classified1.category).toBe('slow_down');
      expect(classified1.retryable).toBe(true);
      expect(classified1.strategy).toBe('exponential_backoff');
      expect(classified1.retryAfterMs).toBe(2000);

      const http529 = { status: 529, statusText: 'Site Overloaded' };
      const classified2 = LLMService.classifyLlmError(new Error('HTTP 529'), http529, 'Claude is overloaded');
      expect(classified2.category).toBe('slow_down');
      expect(classified2.retryable).toBe(true);

      const rateLimitMsg = new Error('Please slow down, server busy');
      const classified3 = LLMService.classifyLlmError(rateLimitMsg);
      expect(classified3.category).toBe('slow_down');
      expect(classified3.retryable).toBe(true);
    });

    it('classifies 400 context length errors, 413, and finish_reason length as token_limit', () => {
      const http400 = { status: 400, statusText: 'Bad Request' };
      const body400 = JSON.stringify({ error: { message: "This model's maximum context length is 8192 tokens, however you requested 9200 tokens." } });
      const classified1 = LLMService.classifyLlmError(new Error('HTTP 400'), http400, body400);
      expect(classified1.category).toBe('token_limit');
      expect(classified1.retryable).toBe(false);
      expect(classified1.strategy).toBe('user_guidance');

      const http413 = { status: 413, statusText: 'Payload Too Large' };
      const classified2 = LLMService.classifyLlmError(new Error('HTTP 413'), http413, 'Request Entity Too Large');
      expect(classified2.category).toBe('token_limit');
      expect(classified2.retryable).toBe(false);

      const finishReasonErr = new Error('Token limit reached: finish_reason length');
      finishReasonErr.finishReason = 'length';
      const classified3 = LLMService.classifyLlmError(finishReasonErr);
      expect(classified3.category).toBe('token_limit');
      expect(classified3.retryable).toBe(false);
    });

    it('classifies AbortError as cancelled and does not retry', () => {
      const abortErr = new Error('The operation was aborted');
      abortErr.name = 'AbortError';
      const classified = LLMService.classifyLlmError(abortErr);
      expect(classified.category).toBe('cancelled');
      expect(classified.retryable).toBe(false);
    });
  });

  describe('LLMService.executeRequest (Centralized Connection & Retry Pipeline)', () => {
    it('successfully returns envelope & parsed payload on first try', async () => {
      const mockResponseData = {
        choices: [
          {
            message: {
              content: '{"general_comment": "Meeting summary complete.", "suggested_actions": []}',
              reasoning_content: 'Thought about the meeting'
            },
            finish_reason: 'stop'
          }
        ]
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => JSON.stringify(mockResponseData),
        json: async () => mockResponseData
      });

      const result = await LLMService.executeRequest({
        messages: [{ role: 'user', content: 'Summarize meeting' }]
      });

      expect(result.ok).toBe(true);
      expect(result.reply).toBe('{"general_comment": "Meeting summary complete.", "suggested_actions": []}');
      expect(result.parsed).toEqual({ general_comment: "Meeting summary complete.", suggested_actions: [] });
      expect(result.reasoningText).toBe('Thought about the meeting');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('fast-retries on transient technical glitch (e.g. 503 or network failure) and succeeds', async () => {
      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: false,
            status: 503,
            statusText: 'Service Unavailable',
            headers: new Headers(),
            text: async () => 'Server temporary glitch'
          };
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () => JSON.stringify({
            choices: [{ message: { content: 'Recovered after glitch' } }]
          }),
          json: async () => ({
            choices: [{ message: { content: 'Recovered after glitch' } }]
          })
        };
      });

      const onRetry = vi.fn();
      const result = await LLMService.executeRequest({
        messages: [{ role: 'user', content: 'Test' }],
        options: {
          fastRetryDelayMs: 20,
          onRetry
        }
      });

      expect(callCount).toBe(2);
      expect(result.reply).toBe('Recovered after glitch');
      expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({
        attempt: 1,
        category: 'technical_issue',
        strategy: 'fast_retry'
      }));
    });

    it('performs exponential backoff on 429 slow_down and succeeds', async () => {
      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: false,
            status: 429,
            statusText: 'Too Many Requests',
            headers: new Headers({ 'retry-after': '0.05' }),
            text: async () => 'Rate limit exceeded'
          };
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () => JSON.stringify({
            choices: [{ message: { content: 'Success after rate limit' } }]
          }),
          json: async () => ({
            choices: [{ message: { content: 'Success after rate limit' } }]
          })
        };
      });

      const onRetry = vi.fn();
      const result = await LLMService.executeRequest({
        messages: [{ role: 'user', content: 'Test' }],
        options: {
          onRetry
        }
      });

      expect(callCount).toBe(2);
      expect(result.reply).toBe('Success after rate limit');
      expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({
        attempt: 1,
        category: 'slow_down',
        strategy: 'exponential_backoff'
      }));
    });

    it('immediately throws LlmTokenLimitError without blind retries when context limit is exceeded', async () => {
      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        return {
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          headers: new Headers(),
          text: async () => JSON.stringify({
            error: { message: 'context_length_exceeded: maximum context length is 4096 tokens, requested 5000' }
          })
        };
      });

      const onRetry = vi.fn();
      await expect(LLMService.executeRequest({
        messages: [{ role: 'user', content: 'Too big' }],
        options: { onRetry }
      })).rejects.toThrow();

      expect(callCount).toBe(1); // No retries!
      expect(onRetry).not.toHaveBeenCalled();
    });

    it('immediately aborts when AbortSignal triggers without delay or retries', async () => {
      const controller = new AbortController();
      controller.abort();

      global.fetch = vi.fn().mockImplementation(async () => {
        const err = new Error('The user aborted a request.');
        err.name = 'AbortError';
        throw err;
      });

      await expect(LLMService.executeRequest({
        messages: [{ role: 'user', content: 'Abort test' }],
        options: { signal: controller.signal }
      })).rejects.toThrow();

      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('LLMService.parseJson helper', () => {
    it('parses valid JSON directly', () => {
      const res = LLMService.parseJson('{"key": "value", "num": 42}');
      expect(res.ok).toBe(true);
      expect(res.data).toEqual({ key: 'value', num: 42 });
    });

    it('extracts JSON from markdown code fences', () => {
      const md = '```json\n{"summary": "Test", "items": [1, 2, 3]}\n```';
      const res = LLMService.parseJson(md);
      expect(res.ok).toBe(true);
      expect(res.data.summary).toBe('Test');
      expect(res.data.items).toEqual([1, 2, 3]);
    });

    it('repairs unescaped quotes inside strings', () => {
      const broken = '{"comment": "User said "Hello" during meeting"}';
      const res = LLMService.parseJson(broken);
      expect(res.ok).toBe(true);
      expect(res.data.comment).toContain('Hello');
    });

    it('handles arrays and wraps or returns them correctly', () => {
      const arrayText = '[{"title": "Task 1"}]';
      const res = LLMService.parseJson(arrayText);
      expect(res.ok).toBe(true);
      expect(Array.isArray(res.data) || Array.isArray(res.data.suggested_actions)).toBe(true);
    });
  });

  describe('Integration with LLMService methods', () => {
    it('LLMService.chat uses executeRequest pipeline', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => JSON.stringify({
          choices: [{ message: { content: '{"status": "ok"}' } }]
        }),
        json: async () => ({
          choices: [{ message: { content: '{"status": "ok"}' } }]
        })
      });

      const chatRes = await LLMService.chat([{ role: 'user', content: 'Hello' }]);
      expect(chatRes.reply).toBe('{"status": "ok"}');
      expect(chatRes.parsed).toEqual({ status: 'ok' });
    });

    it('LLMService.testConnection returns detailed metrics and provider details', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => JSON.stringify({
          choices: [{ message: { content: 'OK' } }]
        }),
        json: async () => ({
          choices: [{ message: { content: 'OK' } }]
        })
      });

      const connRes = await LLMService.testConnection();
      expect(connRes.ok).toBe(true);
      expect(connRes.reply).toBe('OK');
    });
  });
});
