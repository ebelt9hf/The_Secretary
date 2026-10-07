import { describe, it, expect, beforeAll } from 'vitest';
import { loadScriptsIntoGlobal } from '../helpers/load-globals.js';

describe('AIChatController tool extraction & workstream tools support', () => {
  beforeAll(() => {
    // Setup minimal environment globals required by app-chat.js
    if (!globalThis.document) {
      globalThis.document = window?.document || {
        createElement: () => ({ classList: { add() {}, remove() {} }, style: {}, setAttribute() {} }),
        getElementById: () => null,
        querySelectorAll: () => []
      };
    }
    if (!globalThis.localStorage) {
      globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    }
    
    loadScriptsIntoGlobal([
      'js/app-utils.js',
      'js/translations.js',
      'js/app-i18n.js',
      'js/app-chat.js'
    ]);
  });

  it('extracts search_workstream_memories from response.parsed', () => {
    const response = {
      parsed: {
        action: 'search_workstream_memories',
        properties: { query: 'Gosha' }
      }
    };
    const tools = AIChatController.extractToolRequests(response);
    expect(tools).toHaveLength(1);
    expect(tools[0].action).toBe('search_workstream_memories');
    expect(tools[0].properties).toEqual({ query: 'Gosha' });
  });

  it('extracts get_workstream_catalog and its aliases from response.parsed', () => {
    const response = {
      parsed: {
        action: 'get_workstream_catalog',
        properties: { include_archived: true }
      }
    };
    const tools = AIChatController.extractToolRequests(response);
    expect(tools).toHaveLength(1);
    expect(tools[0].action).toBe('get_workstream_catalog');
    expect(tools[0].properties).toEqual({ include_archived: true });

    const aliasResponse = {
      parsed: {
        action: 'list_workstreams',
        properties: { include_archived: false }
      }
    };
    const aliasTools = AIChatController.extractToolRequests(aliasResponse);
    expect(aliasTools).toHaveLength(1);
    expect(aliasTools[0].action).toBe('get_workstream_catalog');
  });

  it('extracts get_workstream_memory and synthesize_workstream_memory', () => {
    const memResponse = {
      parsed: {
        action: 'get_workstream_memory',
        properties: { workstream: 'Project Alpha' }
      }
    };
    const memTools = AIChatController.extractToolRequests(memResponse);
    expect(memTools).toHaveLength(1);
    expect(memTools[0].action).toBe('get_workstream_memory');
    expect(memTools[0].properties).toEqual({ workstream: 'Project Alpha' });

    const synthResponse = {
      parsed: {
        action: 'synthesize_workstream_memory',
        properties: { workstream: 'Project Alpha', prompt: 'Summarize decisions' }
      }
    };
    const synthTools = AIChatController.extractToolRequests(synthResponse);
    expect(synthTools).toHaveLength(1);
    expect(synthTools[0].action).toBe('synthesize_workstream_memory');
  });

  it('extracts workstream tool calls from raw JSON string in reply', () => {
    const response = {
      reply: '{"action": "get_workstream_catalog", "properties": {"include_archived": true}}'
    };
    const tools = AIChatController.extractToolRequests(response);
    expect(tools).toHaveLength(1);
    expect(tools[0].action).toBe('get_workstream_catalog');
  });

  it('extracts workstream tool calls from markdown json block in reply', () => {
    const response = {
      reply: 'Je vais vérifier les mémoires:\n```json\n{"action": "search_workstream_memories", "properties": {"query": "Gosha"}}\n```'
    };
    const tools = AIChatController.extractToolRequests(response);
    expect(tools).toHaveLength(1);
    expect(tools[0].action).toBe('search_workstream_memories');
    expect(tools[0].properties).toEqual({ query: 'Gosha' });
  });

  it('extracts tool calls from direct response.tool_calls array for workstream tools', () => {
    const response = {
      tool_calls: [
        {
          function: {
            name: 'search_workstream_memories',
            arguments: JSON.stringify({ query: 'Gosha' })
          }
        }
      ]
    };
    const tools = AIChatController.extractToolRequests(response);
    expect(tools).toHaveLength(1);
    expect(tools[0].action).toBe('search_workstream_memories');
    expect(tools[0].properties).toEqual({ query: 'Gosha' });
  });
});
