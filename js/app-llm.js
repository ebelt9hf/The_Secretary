/**
 * Secretary - Local Model Auto-Discovery Engine
 * Probes local endpoints (Ollama /api/tags, LM Studio /v1/models) to discover installed models.
 */
const LLMModelDiscoveryEngine = {
  parseOllamaModels(responseData) {
    if (!responseData || !Array.isArray(responseData.models)) return [];
    return responseData.models.map(m => m.name || m.model).filter(Boolean);
  },

  parseOpenAICompatibleModels(responseData) {
    if (!responseData || !Array.isArray(responseData.data)) return [];
    return responseData.data.map(m => m.id).filter(Boolean);
  },

  async discoverModels(endpoint, apiKey = '') {
    const cleanUrl = String(endpoint || '').trim().replace(/\/+$/, '');
    if (!cleanUrl) throw new Error('Endpoint URL is required');

    const headers = {};
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    // 1. Try Ollama /api/tags
    try {
      const ollamaUrl = cleanUrl.includes('/api/tags') ? cleanUrl : `${cleanUrl}/api/tags`;
      const res = await fetch(ollamaUrl, { method: 'GET', headers, signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const data = await res.json();
        const models = this.parseOllamaModels(data);
        if (models.length > 0) return { provider: 'ollama', models };
      }
    } catch (e) {}

    // 2. Try standard /v1/models (LM Studio, OpenAI, etc.)
    try {
      const v1Url = cleanUrl.endsWith('/v1') ? `${cleanUrl}/models` : (cleanUrl.includes('/v1/models') ? cleanUrl : `${cleanUrl}/v1/models`);
      const res = await fetch(v1Url, { method: 'GET', headers, signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const data = await res.json();
        const models = this.parseOpenAICompatibleModels(data);
        if (models.length > 0) return { provider: 'openai-compatible', models };
      }
    } catch (e) {}

    throw new Error('No models found. Check endpoint connectivity.');
  }
};
if (typeof window !== 'undefined') {
  window.LLMModelDiscoveryEngine = LLMModelDiscoveryEngine;
}

async function scanLocalModelsFromUI() {
  const endpoint = (document.getElementById('prefs-ai-endpoint')?.value || '').trim();
  const apiKey = (document.getElementById('prefs-ai-key')?.value || '').trim();
  const listEl = document.getElementById('prefs-ai-model-list');
  const btn = document.getElementById('btn-scan-models');

  if (!endpoint) {
    if (typeof toast === 'function') toast(t('setupWizard.endpointRequired') || 'Endpoint URL required to scan models.', true);
    return;
  }

  if (btn) btn.disabled = true;
  try {
    const res = await LLMModelDiscoveryEngine.discoverModels(endpoint, apiKey);
    if (res.models && res.models.length > 0) {
      if (listEl) {
        listEl.innerHTML = '';
        listEl.style.display = 'block';
        res.models.forEach(modelName => {
          const item = document.createElement('div');
          item.style.padding = '3px 6px';
          item.style.cursor = 'pointer';
          item.style.fontSize = '0.78rem';
          item.style.borderRadius = '3px';
          item.textContent = modelName;
          item.onmouseover = () => item.style.background = 'var(--card-bg-hover, rgba(255,255,255,0.08))';
          item.onmouseout = () => item.style.background = 'transparent';
          item.onclick = () => {
            const input = document.getElementById('prefs-ai-model');
            if (input) {
              input.value = modelName;
              if (typeof prefsAiSettingChanged === 'function') prefsAiSettingChanged();
            }
            listEl.style.display = 'none';
          };
          listEl.appendChild(item);
        });
      }
      if (typeof toast === 'function') toast((t('setupWizard.modelsDiscovered') || 'Discovered {n} models.').replace('{n}', res.models.length));
    }
  } catch (err) {
    if (typeof toast === 'function') toast(err.message || 'Failed to scan models.', true);
  } finally {
    if (btn) btn.disabled = false;
  }
}
if (typeof window !== 'undefined') {
  window.scanLocalModelsFromUI = scanLocalModelsFromUI;
}

/**
 * Secretary - Local LLM & Mini-RAG Service Layer
 */
const LLMService = {
  isEnabled() {
    return !!(settings && settings.ai && settings.ai.enabled);
  },

  isSetup() {
    if (!this.isEnabled()) return false;
    const ai = settings && settings.ai;
    if (!ai) return false;
    const provider = String(ai.provider || 'custom').toLowerCase();
    const endpoint = String(ai.endpoint || '').trim();
    const model = String(ai.model || '').trim();
    const apiKey = String(ai.apiKey || '').trim();
    if (['openai', 'anthropic', 'groq', 'google'].includes(provider)) {
      return !!apiKey;
    }
    return !!(endpoint || model);
  },

  normalizeEndpoint(endpointRaw, provider) {
    const raw = String(endpointRaw || '').trim();
    const withoutTrailingSlash = raw.endsWith('/') ? raw.slice(0, -1) : raw;
    if (!withoutTrailingSlash) return '';

    if (/\/chat\/completions$/i.test(withoutTrailingSlash)) return withoutTrailingSlash;

    // Automatically append /v1 for LM Studio and Ollama local ports if not present
    const isLocalPort = withoutTrailingSlash.includes('localhost:') || withoutTrailingSlash.includes('127.0.0.1:');
    if ((provider === 'lmstudio' || isLocalPort) && !/\/v1(?:\/|$)/i.test(withoutTrailingSlash)) {
      return `${withoutTrailingSlash}/v1`;
    }
    return withoutTrailingSlash;
  },

  getChatCompletionsUrl(cfg) {
    const endpoint = String(cfg?.endpoint || '').trim();
    if (!endpoint) return '';
    const provider = String(cfg?.provider || '').toLowerCase();
    if (provider === 'anthropic') {
      if (endpoint.endsWith('/v1/messages')) return endpoint;
      if (endpoint.endsWith('/v1')) return `${endpoint}/messages`;
      return `${endpoint}/v1/messages`;
    }
    if (/\/chat\/completions$/i.test(endpoint) || /\/api\/chat$/i.test(endpoint) || /\/api\/generate$/i.test(endpoint)) {
      return endpoint;
    }
    return `${endpoint}/chat/completions`;
  },

  getConfig() {
    const aiSettings = settings.ai || {};
    const provider = String(aiSettings.provider || '').toLowerCase();
    const defaultEndpoint = provider === 'lmstudio' ? 'http://127.0.0.1:1234/v1' : 'http://localhost:1234/v1';
    const defaultModel = provider === 'lmstudio' ? 'local-model' : 'qwen2.5-coder-7b-instruct';
    const endpointRaw = aiSettings.endpoint || defaultEndpoint;
    const endpoint = this.normalizeEndpoint(endpointRaw, provider);
    const model = aiSettings.model || defaultModel;
    return {
      provider,
      endpoint,
      model,
      apiKey: aiSettings.apiKey || ''
    };
  },

  ensureReadyForCalls() {
    if (!this.isEnabled()) {
      throw new Error('Local LLM is disabled. Enable it in Preferences first.');
    }
    const cfg = this.getConfig();
    if (!cfg.endpoint) {
      throw new Error('No local LLM endpoint configured.');
    }
    if (!cfg.model) {
      throw new Error('No LLM model configured.');
    }
    return cfg;
  },

  getReasoningEffort(overrideValue = '') {
    const configured = String(overrideValue || (settings.ai || {}).reasoningEffort || (settings.ai || {}).thinkingEffort || '').trim().toLowerCase();

    if (configured === 'off' || configured === 'disabled' || configured === 'false' || configured === '0') {
      return '';
    }
    if (configured === 'mid') {
      return 'medium';
    }
    if (configured === 'low' || configured === 'medium' || configured === 'high') {
      return configured;
    }
    return 'high';
  },

  applyReasoningPayload(payload, provider, effortOverride = '') {
    const effort = this.getReasoningEffort(effortOverride);
    if (!effort) return payload;

    const normalizedProvider = String(provider || '').toLowerCase();
    if (normalizedProvider === 'custom' || normalizedProvider === 'lmstudio') {
      payload.reasoning = { effort };
    }
    return payload;
  },

  getAiSettingNumber(settingKeys, fallback, allowZero = false) {
    const keys = Array.isArray(settingKeys) ? settingKeys : [settingKeys];
    const aiSettings = settings.ai || {};

    for (const key of keys) {
      const rawValue = aiSettings[key];
      const numericValue = Number(rawValue);
      if (!Number.isFinite(numericValue)) continue;
      if (allowZero && numericValue === 0) return 0;
      if (numericValue > 0) return Math.floor(numericValue);
    }

    return fallback;
  },

  /**
   * Builds headers for the LLM request, adding Authorization if an API key is set.
   * @returns {Object}
   */
  getHeaders(overrideApiKey, overrideProvider) {
    const aiSettings = settings.ai || {};
    const apiKey = overrideApiKey !== undefined ? String(overrideApiKey || '').trim() : String(aiSettings.apiKey || '').trim();
    const provider = overrideProvider !== undefined ? String(overrideProvider || '').toLowerCase() : String(aiSettings.provider || '').toLowerCase();

    const headers = {
      'Content-Type': 'application/json'
    };

    if (provider === 'anthropic') {
      if (apiKey) {
        headers['x-api-key'] = apiKey;
      }
      headers['anthropic-version'] = '2023-06-01';
      headers['dangerously-allow-developer-user-headers'] = 'true';
    } else {
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }
    }
    return headers;
  },

  formatPayload(provider, model, messages, temperature, maxTokens) {
    const isAnthropic = String(provider || '').toLowerCase() === 'anthropic';

    let systemContent = '';
    const filteredMessages = [];

    messages.forEach(msg => {
      if (msg.role === 'system') {
        const textContent = typeof msg.content === 'string'
          ? msg.content
          : (Array.isArray(msg.content) ? msg.content.filter(p => p.type === 'text').map(p => p.text).join('\n') : String(msg.content || ''));
        if (systemContent) systemContent += '\n' + textContent;
        else systemContent = textContent;
      } else {
        let role = msg.role;
        if (role === 'system' || role === 'developer') {
          role = 'user';
        }
        filteredMessages.push({
          role: role,
          content: msg.content
        });
      }
    });

    let finalMessages = filteredMessages;
    if (isAnthropic) {
      finalMessages = [];
      let expectedRole = 'user';
      filteredMessages.forEach(msg => {
        let formattedContent = msg.content;
        if (Array.isArray(formattedContent)) {
          formattedContent = formattedContent.map(part => {
            if (part.type === 'image_url' && part.image_url?.url) {
              const url = part.image_url.url;
              if (url.startsWith('data:image/')) {
                const match = url.match(/^data:(image\/[a-zA-Z0-9+\-]+);base64,(.+)$/);
                if (match) {
                  let mime = match[1].toLowerCase();
                  if (mime === 'image/jpg') mime = 'image/jpeg';
                  const supportedMimes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
                  if (supportedMimes.has(mime)) {
                    return {
                      type: 'image',
                      source: {
                        type: 'base64',
                        media_type: mime,
                        data: match[2].trim()
                      }
                    };
                  }
                }
              } else if (/^https?:\/\//.test(url)) {
                return {
                  type: 'image',
                  source: {
                    type: 'url',
                    url: url
                  }
                };
              }
            }
            return part;
          });
        }

        if (msg.role === expectedRole) {
          finalMessages.push({ role: msg.role, content: formattedContent });
          expectedRole = expectedRole === 'user' ? 'assistant' : 'user';
        } else {
          const lastMsg = finalMessages[finalMessages.length - 1];
          if (lastMsg && lastMsg.role === msg.role) {
            if (Array.isArray(lastMsg.content) || Array.isArray(formattedContent)) {
              const normLast = Array.isArray(lastMsg.content) ? lastMsg.content : [{ type: 'text', text: String(lastMsg.content || '') }];
              const normNext = Array.isArray(formattedContent) ? formattedContent : [{ type: 'text', text: String(formattedContent || '') }];
              lastMsg.content = normLast.concat(normNext);
            } else {
              lastMsg.content += '\n' + formattedContent;
            }
          } else if (msg.role === 'user') {
            finalMessages.push({ role: 'assistant', content: '...' });
            finalMessages.push({ role: 'user', content: formattedContent });
            expectedRole = 'assistant';
          }
        }
      });
      if (finalMessages.length === 0) {
        finalMessages.push({ role: 'user', content: 'Hello' });
      } else if (finalMessages[0].role !== 'user') {
        finalMessages.unshift({ role: 'user', content: 'Hello' });
      }
    }

    if (isAnthropic) {
      const payload = {
        model,
        messages: finalMessages,
        temperature: temperature !== undefined ? temperature : 0.7,
        max_tokens: maxTokens || 4000
      };
      if (systemContent) {
        payload.system = systemContent;
      }
      return payload;
    } else {
      // Re-insert system message cleanly at index 0 for standard OpenAI-style local API formats
      const standardMessages = [];
      if (systemContent) {
        standardMessages.push({ role: 'system', content: systemContent });
      }
      filteredMessages.forEach(msg => standardMessages.push(msg));

      const payload = {
        model,
        messages: standardMessages,
        temperature: temperature !== undefined ? temperature : 0.7
      };
      if (maxTokens) {
        payload.max_tokens = maxTokens;
      }
      return payload;
    }
  },

  async extractNoteImageUrls(note, noteContent, options = {}) {
    const images = [];
    const seen = new Set();

    const sources = [
      options.noteHtml,
      options.html,
      typeof getCleanEditorText === 'function' ? (document.getElementById('edit-textarea')?.innerHTML || '') : '',
      noteContent,
      note?.content,
      note?.summary,
      note?.html
    ];

    const tokenMap = typeof _imgTokenMap !== 'undefined' ? _imgTokenMap : (window._imgTokenMap || {});
    if (tokenMap && typeof tokenMap === 'object') {
      Object.values(tokenMap).forEach(tag => {
        if (typeof tag === 'string') sources.push(tag);
      });
    }

    if (Array.isArray(note?.images)) {
      note.images.forEach(img => {
        if (typeof img === 'string') sources.push(img);
        else if (img?.url || img?.src || img?.path) sources.push(img.url || img.src || img.path);
      });
    }
    if (Array.isArray(note?.attachments)) {
      note.attachments.forEach(att => {
        if (typeof att === 'string') sources.push(att);
        else if (att?.url || att?.src || att?.path) sources.push(att.url || att.src || att.path);
      });
    }

    const combinedRaw = sources.filter(s => typeof s === 'string' && s.length > 0).join('\n');

    // Extract inline base64 data URLs
    const dataUrlRegex = /data:image\/(?:png|jpeg|jpg|webp|gif|svg\+xml);base64,[^"'\s>\)]+/gi;
    let match;
    while ((match = dataUrlRegex.exec(combinedRaw)) !== null) {
      const dataUrl = match[0];
      if (!seen.has(dataUrl)) {
        seen.add(dataUrl);
        images.push(dataUrl);
      }
    }

    // Extract relative asset paths (notes/_assets/img_... or _assets/img_...)
    const assetRegex = /(?:notes\/)?_assets\/[^\s"'<>\(\)]+/gi;
    while ((match = assetRegex.exec(combinedRaw)) !== null) {
      const relPath = match[0].replace(/['"\)]+$/, '');
      const normPath = relPath.startsWith('notes/') ? relPath : `notes/${relPath}`;
      if (!seen.has(normPath)) {
        seen.add(normPath);
        try {
          let dataUrl = null;
          if (typeof readAssetAsDataUrl === 'function') {
            dataUrl = await readAssetAsDataUrl(normPath);
          } else if (window._assetDataUrlCache?.get(normPath)) {
            dataUrl = window._assetDataUrlCache.get(normPath);
          }
          if (dataUrl && !seen.has(dataUrl)) {
            seen.add(dataUrl);
            images.push(dataUrl);
          }
        } catch (e) {
          console.warn('Failed to resolve note asset image for LLM vision:', normPath, e);
        }
      }
    }

    // Extract HTTP/HTTPS image URLs
    const httpRegex = /https?:\/\/[^\s"'<>\(\)]+\.(?:png|jpg|jpeg|webp|gif)/gi;
    while ((match = httpRegex.exec(combinedRaw)) !== null) {
      const url = match[0].replace(/['"\)]+$/, '');
      if (!seen.has(url)) {
        seen.add(url);
        images.push(url);
      }
    }

    return images.slice(0, 8);
  },

  prepareNoteContentForLLM(noteContent) {
    let imageIndex = 0;
    const nextPlaceholder = (kind) => `[IMAGE_${++imageIndex}: ${kind} (see attached vision payload)]`;
    let text = String(noteContent || '');

    // Tokenized editor images restored in preview (e.g. NIMGTK0X) should not be sent raw.
    text = text.replace(/\bNIMGTK\d+X\b/g, () => nextPlaceholder('embedded image'));

    // Safe, active clean up of markdown image wrappers
    text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt) => {
      const cleanAlt = String(alt || '').trim();
      return cleanAlt ? nextPlaceholder(`markdown image: ${cleanAlt}`) : nextPlaceholder('markdown image');
    });

    // HTML img tags
    text = text.replace(/<img\b[^>]*>/gi, (imgTag) => {
      const altMatch = imgTag.match(/\balt\s*=\s*(["'])(.*?)\1/i);
      const cleanAlt = altMatch ? String(altMatch[2] || '').trim() : '';
      return cleanAlt ? nextPlaceholder(`html image: ${cleanAlt}`) : nextPlaceholder('html image');
    });

    return text;
  },

  truncateTextForLLM(text, maxChars, suffix = ' ...') {
    const value = String(text || '');
    if (!Number.isFinite(maxChars) || maxChars <= 0 || value.length <= maxChars) return value;
    const keep = Math.max(0, maxChars - suffix.length);
    return value.slice(0, keep).trimEnd() + suffix;
  },

  async persistAnalyzeTrace(trace) {
    // Truncate large fields before writing to localStorage to prevent QuotaExceededError (~5 MB limit).
    // Full trace is still written to the raw/ file system path below.
    try {
      const slim = Object.assign({}, trace, {
        responseRaw: typeof trace.responseRaw === 'string' ? trace.responseRaw.slice(0, 1500) + (trace.responseRaw.length > 1500 ? '…[truncated]' : '') : trace.responseRaw,
        reply: typeof trace.reply === 'string' ? trace.reply.slice(0, 1500) + (trace.reply.length > 1500 ? '…[truncated]' : '') : trace.reply
      });
      localStorage.setItem('secretaryLastLLMAnalyzeTrace', JSON.stringify(slim));
    } catch (err) {
      console.warn('Could not persist LLM trace to localStorage', err);
    }

    // Persist full trace files under raw/ for later troubleshooting.
    if (typeof rootHandle === 'undefined' || !rootHandle || typeof writeFile !== 'function') return;

    try {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const noteStem = String(trace?.noteId || trace?.noteTitle || 'note').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40) || 'note';
      const fileName = `raw/llm-traces/${ts}-${noteStem}.json`;
      await writeFile(fileName, JSON.stringify(trace, null, 2));
    } catch (err) {
      console.warn('Could not persist LLM trace file', err);
    }
  },

  extractReplyInfoFromEnvelope(json) {
    if (Array.isArray(json?.content)) {
      const textBlock = json.content.find(block => block.type === 'text');
      const replyFromContent = String(textBlock?.text || '').trim();
      const toolBlocks = json.content.filter(block => block.type === 'tool_use' || block.type === 'tool_call');
      const tool_calls = toolBlocks.length > 0 ? toolBlocks.map(b => ({
        id: b.id,
        action: b.name || b.action,
        name: b.name || b.action,
        properties: b.input || b.parameters || b.properties || {}
      })) : null;
      return {
        replyFromContent,
        replyFromReasoning: '',
        replySource: 'content[].text',
        replyText: replyFromContent,
        tool_calls
      };
    }

    const firstChoice = json?.choices?.[0] || {};
    const messageObj = firstChoice?.message || {};

    const replyFromContent = String(messageObj?.content || '').trim();
    const replyFromReasoning = String(messageObj?.reasoning_content || firstChoice?.reasoning_content || '').trim();

    if (!replyFromContent && replyFromReasoning) {
      console.warn("Empty content. reasoning_content captured:",
        replyFromReasoning.slice(0, 500)
      );
    }

    return {
      replyFromContent,
      replyFromReasoning,
      replySource: replyFromContent ? 'message.content' : (replyFromReasoning ? 'message.reasoning_content' : 'none'),
      replyText: replyFromContent || replyFromReasoning,
      tool_calls: messageObj?.tool_calls || json?.tool_calls || null
    };
  },

  extractReasoningAndContent(text, options = {}) {
    const isStreaming = options.isStreaming || false;
    let str = String(text || '');
    if (!str) return { reasoningText: '', cleanContent: '' };

    let reasoningText = '';
    let cleanContent = str;

    // 1. Check for closed tags: <think>...</think>, <thought>...</thought>, [THOUGHT]...[/THOUGHT]
    const closedRegex = /<(?:think|thought)>([\s\S]*?)<\/(?:think|thought)>|\[THOUGHT\]([\s\S]*?)\[\/THOUGHT\]/gi;
    const reasoningParts = [];
    
    cleanContent = str.replace(closedRegex, (fullMatch, g1, g2) => {
      const found = (g1 || g2 || '').trim();
      if (found) reasoningParts.push(found);
      return '';
    });

    if (reasoningParts.length > 0) {
      reasoningText = reasoningParts.join('\n\n');
    } else if (isStreaming) {
      // Handle unclosed tag during active streaming: <think>... or <thought>...
      const unclosedRegex = /<(?:think|thought)>([\s\S]*)$/i;
      const unclosedMatch = unclosedRegex.exec(cleanContent);
      if (unclosedMatch) {
        reasoningText = (unclosedMatch[1] || '').trim();
        cleanContent = cleanContent.slice(0, unclosedMatch.index).trim();
      }
    }

    return {
      reasoningText: reasoningText.trim(),
      cleanContent: cleanContent.trim()
    };
  },

  renderThinkingAccordionHTML(reasoningText, options = {}) {
    const text = String(reasoningText || '').trim();
    if (!text) return '';

    const label = options.title || (typeof t === 'function' ? t('chat.thinkingProcess') : 'Thought process');
    const toggleHint = typeof t === 'function' ? t('chat.toggleThinking') : 'Click to expand or collapse thought process';
    const copyLabel = typeof t === 'function' ? t('chat.copyThinking') : 'Copy thought process';
    const isDefaultOpen = options.isOpen ? 'open' : '';

    const escFn = typeof escH === 'function' ? escH : (s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
    const escAttr = typeof escA === 'function' ? escA : escFn;

    const formattedContent = escFn(text).replace(/\n/g, '<br>');

    const brainSvg = (typeof AppIcons !== 'undefined' && typeof AppIcons.get === 'function')
      ? AppIcons.get('brain', { size: 14, className: 'chat-thinking-svg' })
      : `<svg class="chat-thinking-svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-2.04z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-2.04z"/></svg>`;

    const copySvg = (typeof AppIcons !== 'undefined' && typeof AppIcons.get === 'function')
      ? AppIcons.get('copy', { size: 13, className: 'chat-thinking-copy-icon' })
      : `<svg class="chat-thinking-copy-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

    const chevronSvg = (typeof AppIcons !== 'undefined' && typeof AppIcons.get === 'function')
      ? AppIcons.get('chevronDown', { size: 12, className: 'chat-thinking-chevron-icon' })
      : `<svg class="chat-thinking-chevron-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;

    return `
      <details class="chat-thinking-accordion" ${isDefaultOpen} title="${escAttr(toggleHint)}">
        <summary class="chat-thinking-accordion-summary" title="${escAttr(toggleHint)}">
          <div class="chat-thinking-summary-left">
            <span class="chat-thinking-icon">${brainSvg}</span>
            <span class="chat-thinking-title">${escFn(label)}</span>
          </div>
          <div class="chat-thinking-summary-right">
            <button type="button" class="chat-thinking-copy-btn" onclick="LLMService.copyThinkingText(this, event)" title="${escAttr(copyLabel)}">
              ${copySvg}
            </button>
            <span class="chat-thinking-chevron">${chevronSvg}</span>
          </div>
        </summary>
        <div class="chat-thinking-content-body">${formattedContent}</div>
      </details>
    `;
  },

  copyThinkingText(btn, evt) {
    if (evt) evt.stopPropagation();
    const accordion = btn.closest('.chat-thinking-accordion');
    const content = accordion?.querySelector('.chat-thinking-content-body')?.innerText || '';
    if (content && typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(content).then(() => {
        const checkSvg = (typeof AppIcons !== 'undefined' && typeof AppIcons.get === 'function')
          ? AppIcons.get('check', { size: 13, className: 'chat-thinking-check-icon' })
          : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`;
        const origHTML = btn.innerHTML;
        btn.innerHTML = checkSvg;
        setTimeout(() => { btn.innerHTML = origHTML; }, 1500);
      }).catch(err => {
        console.warn('Failed to copy thinking text:', err);
      });
    }
  },

  formatThoughtLogStep(stepName, detail) {
    const name = String(stepName || '').trim();
    const info = String(detail || '').trim();
    return `- **${name}**: ${info}`;
  },

  repairJsonString(str) {
    let result = '';
    let inString = false;
    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      if (char === '"') {
        let backslashes = 0;
        let j = i - 1;
        while (j >= 0 && str[j] === '\\') {
          backslashes++;
          j--;
        }
        const isEscaped = (backslashes % 2) === 1;

        if (!isEscaped) {
          if (inString) {
            let nextNonWS = '';
            for (let k = i + 1; k < str.length; k++) {
              if (!/\s/.test(str[k])) {
                nextNonWS = str[k];
                break;
              }
            }
            if (nextNonWS === ':' || nextNonWS === ',' || nextNonWS === '}' || nextNonWS === ']' || nextNonWS === '') {
              inString = false;
              result += '"';
            } else {
              result += '\\"';
            }
          } else {
            inString = true;
            result += '"';
          }
        } else {
          result += '"';
        }
      } else {
        result += char;
      }
    }
    return result;
  },

  extractJsonPayloadFromText(text) {
    const reply = String(text || '').trim();
    if (!reply) return { parsed: null, extractedJsonPayload: '' };

    // 1. Try parsing the whole reply as JSON directly.
    try {
      const parsedVal = JSON.parse(reply);
      if (Array.isArray(parsedVal)) {
        return {
          parsed: { general_comment: '', suggested_actions: parsedVal },
          extractedJsonPayload: reply
        };
      }
      return { parsed: parsedVal, extractedJsonPayload: '' };
    } catch (_err) { /* fall through */ }

    const firstBrace = reply.indexOf('{');
    const lastBrace = reply.lastIndexOf('}');
    const firstBracket = reply.indexOf('[');
    const lastBracket = reply.lastIndexOf(']');

    // If an array bracket precedes braces or no brace exists, try array parsing first
    if (firstBracket >= 0 && lastBracket > firstBracket && (firstBrace < 0 || firstBracket < firstBrace)) {
      const extractedJsonPayload = reply.slice(firstBracket, lastBracket + 1).trim();
      try {
        const arr = JSON.parse(extractedJsonPayload);
        if (Array.isArray(arr)) {
          return {
            parsed: { general_comment: '', suggested_actions: arr },
            extractedJsonPayload
          };
        }
      } catch (_ignored) {
        try {
          const repaired = this.repairJsonString(extractedJsonPayload);
          const arr = JSON.parse(repaired);
          if (Array.isArray(arr)) {
            return {
              parsed: { general_comment: '', suggested_actions: arr },
              extractedJsonPayload: repaired
            };
          }
        } catch (_secondIgnored) { /* fall through */ }
      }
    }

    // 2. Extract the outermost {...} object.
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const extractedJsonPayload = reply.slice(firstBrace, lastBrace + 1).trim();
      try {
        return { parsed: JSON.parse(extractedJsonPayload), extractedJsonPayload };
      } catch (_ignored) {
        try {
          const repaired = this.repairJsonString(extractedJsonPayload);
          return { parsed: JSON.parse(repaired), extractedJsonPayload: repaired };
        } catch (_secondIgnored) {
          // Object found but invalid — return it for tracing
          return { parsed: null, extractedJsonPayload };
        }
      }
    }

    // 3. Fallback: LLM returned a bare array [...] after text.
    if (firstBracket >= 0 && lastBracket > firstBracket) {
      const extractedJsonPayload = reply.slice(firstBracket, lastBracket + 1).trim();
      try {
        const arr = JSON.parse(extractedJsonPayload);
        if (Array.isArray(arr)) {
          return {
            parsed: { general_comment: '', suggested_actions: arr },
            extractedJsonPayload
          };
        }
      } catch (_ignored) {
        try {
          const repaired = this.repairJsonString(extractedJsonPayload);
          const arr = JSON.parse(repaired);
          if (Array.isArray(arr)) {
            return {
              parsed: { general_comment: '', suggested_actions: arr },
              extractedJsonPayload: repaired
            };
          }
        } catch (_secondIgnored) { /* fall through */ }
      }
    }

    return { parsed: null, extractedJsonPayload: '' };
  },

  getFinishReason(json) {
    if (json?.stop_reason) {
      const reason = String(json.stop_reason).toLowerCase();
      if (reason === 'max_tokens') return 'length';
      return reason;
    }
    return String(json?.choices?.[0]?.finish_reason || '').trim().toLowerCase();
  },

  isTruncatedCompletion(json) {
    return this.getFinishReason(json) === 'length';
  },

  /**
   * Structured error classifier for LLM API errors and HTTP responses.
   * Categorizes errors into technical issues (fast retry), slowdown/rate-limits (exponential backoff),
   * token limit exceeded (user guidance), or client/abort errors.
   */
  classifyLlmError(error, response = null, responseBody = '') {
    const errName = String(error?.name || '');
    const errMsg = String(error?.message || '');
    const bodyStr = typeof responseBody === 'object' ? JSON.stringify(responseBody) : String(responseBody || '');
    const combinedMsg = `${errMsg} ${bodyStr}`.toLowerCase();
    const status = Number(response?.status || error?.status || 0);

    // 1. Abort / User cancellation
    if (errName === 'AbortError' || error?.isAborted || combinedMsg.includes('abort') || combinedMsg.includes('cancelled')) {
      return {
        category: 'cancelled',
        retryable: false,
        strategy: 'none',
        messageKey: 'llm.stopped',
        userMessage: typeof t === 'function' ? t('llm.stopped', 'Generation stopped.') : 'Generation stopped.',
        status: status || 499
      };
    }

    // 2. Token Limit Reached (Context window exceeded / max tokens / payload too large)
    const isFinishReasonLength = error?.finishReason === 'length' || (typeof responseBody === 'object' && responseBody?.choices?.[0]?.finish_reason === 'length');
    const isTokenLimitStatus = status === 413 || (status === 400 && (
      combinedMsg.includes('context_length_exceeded') ||
      combinedMsg.includes('maximum context length') ||
      combinedMsg.includes('max_tokens') ||
      combinedMsg.includes('token limit') ||
      (combinedMsg.includes('tokens') && (combinedMsg.includes('exceed') || combinedMsg.includes('maximum') || combinedMsg.includes('limit') || combinedMsg.includes('too long'))) ||
      combinedMsg.includes('n_ctx') ||
      combinedMsg.includes('payload too large') ||
      combinedMsg.includes('prompt is too long') ||
      combinedMsg.includes('input too long')
    ));
    const isTokenLimitText = combinedMsg.includes('context_length_exceeded') ||
      combinedMsg.includes('maximum context length') ||
      combinedMsg.includes('token limit reached') ||
      isFinishReasonLength;

    if (isTokenLimitStatus || isTokenLimitText) {
      return {
        category: 'token_limit',
        retryable: false,
        strategy: 'user_guidance',
        messageKey: 'llm.errorTokenLimit',
        userMessage: typeof t === 'function'
          ? t('llm.errorTokenLimit', "Token limit reached: the note or conversation exceeds the model's context window. Please shorten the note, reduce conversation history, or select a model with a larger context size.")
          : "Token limit reached: the note or conversation exceeds the model's context window. Please shorten the note, reduce conversation history, or select a model with a larger context size.",
        status: status || 400
      };
    }

    // 3. Slow Down / Rate Limit / Server Overload
    let retryAfterMs = 0;
    if (response?.headers) {
      const retryAfterHeader = response.headers.get ? response.headers.get('retry-after') : response.headers['retry-after'];
      if (retryAfterHeader) {
        const sec = parseFloat(retryAfterHeader);
        if (!isNaN(sec) && sec > 0) {
          retryAfterMs = Math.round(sec * 1000);
        } else {
          const dateMs = Date.parse(retryAfterHeader);
          if (!isNaN(dateMs)) {
            retryAfterMs = Math.max(0, dateMs - Date.now());
          }
        }
      }
    }

    const isSlowDownStatus = status === 429 || status === 529;
    const isSlowDownText = combinedMsg.includes('rate limit') ||
      combinedMsg.includes('too many requests') ||
      combinedMsg.includes('slow down') ||
      combinedMsg.includes('overloaded') ||
      combinedMsg.includes('server is busy') ||
      combinedMsg.includes('server busy') ||
      combinedMsg.includes('concurrency limit') ||
      combinedMsg.includes('resource exhausted') ||
      combinedMsg.includes('quota exceeded');

    if (isSlowDownStatus || isSlowDownText) {
      return {
        category: 'slow_down',
        retryable: true,
        strategy: 'exponential_backoff',
        retryAfterMs: retryAfterMs || 0,
        messageKey: 'llm.errorSlowDown',
        userMessage: typeof t === 'function'
          ? t('llm.errorSlowDown', 'Server is busy or rate limit reached. Waiting and retrying automatically...')
          : 'Server is busy or rate limit reached. Waiting and retrying automatically...',
        status: status || 429
      };
    }

    // 4. Technical Issues (Transient Network Drops, Bad Gateways, 500, 502, 503, 504)
    const is5xx = status >= 500 && status <= 599 && status !== 529;
    const isNetError = /Failed to fetch|NetworkError|fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|socket hang up|connection reset/i.test(errMsg) || error instanceof TypeError;

    if (is5xx || isNetError) {
      return {
        category: 'technical_issue',
        retryable: true,
        strategy: 'fast_retry',
        messageKey: 'llm.errorTechnicalRetry',
        userMessage: typeof t === 'function'
          ? t('llm.errorTechnicalRetry', 'Connection glitch detected. Retrying request quickly...')
          : 'Connection glitch detected. Retrying request quickly...',
        status: status || 503
      };
    }

    // 5. Auth / Client error fallback
    if (status === 401 || status === 403) {
      return {
        category: 'auth_error',
        retryable: false,
        strategy: 'none',
        userMessage: `Authentication error (HTTP ${status}). Please check your API key.`,
        status
      };
    }

    return {
      category: 'client_error',
      retryable: false,
      strategy: 'none',
      userMessage: errMsg || `HTTP ${status || 'Error'}`,
      status
    };
  },

  /**
   * Helper to safely parse and extract JSON from LLM text output.
   * Strips markdown fences, extracts objects or arrays, and attempts quote/character repair.
   */
  parseJson(text, options = {}) {
    const raw = String(text || '').trim();
    if (!raw) return { ok: false, data: null, raw: '', error: 'Empty text' };

    const res = this.extractJsonPayloadFromText(raw);
    if (res && res.parsed !== null && res.parsed !== undefined) {
      return {
        ok: true,
        data: res.parsed,
        raw: res.extractedJsonPayload || raw
      };
    }

    return {
      ok: false,
      data: null,
      raw,
      error: 'Could not parse JSON from response'
    };
  },

  /**
   * Centralized HTTP connection & multi-tier retry dispatcher for all Secretary AI operations.
   * Handles timeout, abort signals, token limits, fast retries on glitches, and exponential backoff on slowdowns.
   */
  async executeRequest(params = {}) {
    const cfg = params.options?.overrideConfig || this.ensureReadyForCalls();
    const requestUrl = this.getChatCompletionsUrl(cfg);
    const options = params.options || {};
    const messages = params.messages || [];

    const temperature = Number.isFinite(options.temperature) ? options.temperature : 0.7;
    const requestedReasoning = String(options.reasoningEffort || '').trim().toLowerCase();
    const reasoningEffort = ['off', 'disabled', 'false', '0'].includes(requestedReasoning)
      ? ''
      : (requestedReasoning || this.getReasoningEffort());

    const maxFastRetries = Number.isInteger(options.maxFastRetries) ? options.maxFastRetries : (options.retries !== undefined ? options.retries : 2);
    const fastRetryDelayMs = Number.isInteger(options.fastRetryDelayMs) ? options.fastRetryDelayMs : (options.retryDelayMs !== undefined ? options.retryDelayMs : 500);
    const maxSlowDownRetries = Number.isInteger(options.maxSlowDownRetries) ? options.maxSlowDownRetries : 3;
    const baseSlowDownDelayMs = Number.isInteger(options.baseSlowDownDelayMs) ? options.baseSlowDownDelayMs : 1500;

    const controller = options.controller || (options.signal ? null : new AbortController());
    const requestSignal = options.signal || controller?.signal;
    const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(0, Math.floor(options.timeoutMs)) : 0;

    let attempt = 0;
    let fastRetryCount = 0;
    let slowDownRetryCount = 0;
    const startedAt = Date.now();

    while (true) {
      attempt++;
      let timeoutId = null;
      let isTimedOut = false;

      if (timeoutMs > 0 && controller) {
        timeoutId = setTimeout(() => {
          isTimedOut = true;
          controller.abort();
        }, timeoutMs);
      }

      try {
        let requestPayload = params.payload;
        if (!requestPayload) {
          requestPayload = this.formatPayload(cfg.provider, cfg.model, messages, temperature, options.maxTokens);
          if (reasoningEffort) {
            if (String(cfg.provider || '').toLowerCase() === 'custom' || String(cfg.provider || '').toLowerCase() === 'lmstudio') {
              requestPayload.reasoning = { effort: reasoningEffort };
            }
          }
        }

        const response = await fetch(requestUrl, {
          method: 'POST',
          headers: this.getHeaders(cfg.apiKey, cfg.provider),
          signal: requestSignal,
          body: JSON.stringify(requestPayload)
        });

        if (timeoutId) clearTimeout(timeoutId);

        const responseRaw = await response.text();

        if (!response.ok) {
          const classified = this.classifyLlmError(new Error(`HTTP ${response.status}`), response, responseRaw);
          if (classified.category === 'token_limit') {
            const tokenErr = new Error(classified.userMessage);
            tokenErr.isTokenLimit = true;
            tokenErr.category = 'token_limit';
            tokenErr.status = response.status;
            tokenErr.responseRaw = responseRaw;
            throw tokenErr;
          }

          if (classified.category === 'cancelled') {
            const cancelErr = new Error(classified.userMessage);
            cancelErr.name = 'AbortError';
            throw cancelErr;
          }

          if (classified.category === 'technical_issue' && fastRetryCount < maxFastRetries && !requestSignal?.aborted) {
            fastRetryCount++;
            const delay = Math.round(fastRetryDelayMs * (1 + (fastRetryCount - 1) * 0.5));
            if (typeof options.onRetry === 'function') {
              options.onRetry({
                attempt,
                fastRetryCount,
                category: classified.category,
                strategy: 'fast_retry',
                delayMs: delay,
                userMessage: classified.userMessage,
                error: new Error(`HTTP ${response.status}: ${responseRaw}`)
              });
            }
            await new Promise(r => setTimeout(r, delay));
            continue;
          }

          if (classified.category === 'slow_down' && slowDownRetryCount < maxSlowDownRetries && !requestSignal?.aborted) {
            slowDownRetryCount++;
            const delay = classified.retryAfterMs > 0
              ? classified.retryAfterMs
              : Math.round(baseSlowDownDelayMs * Math.pow(2, slowDownRetryCount - 1) + Math.random() * 200);
            if (typeof options.onRetry === 'function') {
              options.onRetry({
                attempt,
                slowDownRetryCount,
                category: classified.category,
                strategy: 'exponential_backoff',
                delayMs: delay,
                userMessage: classified.userMessage,
                error: new Error(`HTTP ${response.status}: ${responseRaw}`)
              });
            }
            await new Promise(r => setTimeout(r, delay));
            continue;
          }

          const httpErr = new Error(`Local LLM returned HTTP ${response.status}: ${responseRaw}`);
          httpErr.status = response.status;
          httpErr.category = classified.category;
          httpErr.responseRaw = responseRaw;
          throw httpErr;
        }

        let json;
        try {
          json = JSON.parse(responseRaw || '{}');
        } catch (parseErr) {
          throw new Error('Local LLM returned invalid JSON.');
        }

        const replyInfo = this.extractReplyInfoFromEnvelope(json);
        const rawReplyText = String(replyInfo.replyText || '').trim();
        const reasoningFromEnvelope = replyInfo.replyFromReasoning || '';
        const finishReason = this.getFinishReason(json);

        if (finishReason === 'length' && !rawReplyText) {
          const classified = this.classifyLlmError(new Error('Token limit reached: finish_reason length'), response, json);
          const tokenErr = new Error(classified.userMessage);
          tokenErr.isTokenLimit = true;
          tokenErr.category = 'token_limit';
          throw tokenErr;
        }

        const extractedReasoningObj = this.extractReasoningAndContent(rawReplyText);
        const combinedReasoning = (reasoningFromEnvelope + (reasoningFromEnvelope && extractedReasoningObj.reasoningText ? '\n' : '') + (extractedReasoningObj.reasoningText || '')).trim();
        const cleanContent = extractedReasoningObj.cleanContent || rawReplyText;
        const parsedInfo = this.extractJsonPayloadFromText(cleanContent);

        return {
          ok: true,
          reply: cleanContent,
          rawReply: rawReplyText,
          parsed: parsedInfo.parsed,
          extractedJsonPayload: parsedInfo.extractedJsonPayload,
          tool_calls: replyInfo.tool_calls || null,
          reasoningText: combinedReasoning,
          finishReason,
          rawJson: json,
          elapsedMs: Date.now() - startedAt
        };
      } catch (err) {
        if (timeoutId) clearTimeout(timeoutId);
        if (isTimedOut || (err && err.name === 'AbortError' && isTimedOut)) {
          throw new Error('LLM request timed out.');
        }

        const isAbort = err && (err.name === 'AbortError' || requestSignal?.aborted);
        if (isAbort || err?.isTokenLimit || err?.category === 'token_limit') {
          throw err;
        }

        const classified = this.classifyLlmError(err);
        if (classified.category === 'technical_issue' && fastRetryCount < maxFastRetries && !requestSignal?.aborted) {
          fastRetryCount++;
          const delay = Math.round(fastRetryDelayMs * (1 + (fastRetryCount - 1) * 0.5));
          if (typeof options.onRetry === 'function') {
            options.onRetry({
              attempt,
              fastRetryCount,
              category: classified.category,
              strategy: 'fast_retry',
              delayMs: delay,
              userMessage: classified.userMessage,
              error: err
            });
          }
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        if (classified.category === 'slow_down' && slowDownRetryCount < maxSlowDownRetries && !requestSignal?.aborted) {
          slowDownRetryCount++;
          const delay = classified.retryAfterMs > 0
            ? classified.retryAfterMs
            : Math.round(baseSlowDownDelayMs * Math.pow(2, slowDownRetryCount - 1) + Math.random() * 200);
          if (typeof options.onRetry === 'function') {
            options.onRetry({
              attempt,
              slowDownRetryCount,
              category: classified.category,
              strategy: 'exponential_backoff',
              delayMs: delay,
              userMessage: classified.userMessage,
              error: err
            });
          }
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        throw err;
      }
    }
  },

  // ── Note & AI Content Parsers (Todos, Decisions, Mentions, Highlights) ──

  /**
   * Parses and extracts structured todos from note HTML or text.
   * Extracts attributes from .note-todo spans (id, title, priority, importance, urgency, owner, isDone)
   * and optionally parses unstructured list items / action lines.
   */
  extractTodosFromNote(htmlOrDoc, options = {}) {
    if (!htmlOrDoc) return [];
    let doc = null;
    if (typeof htmlOrDoc === 'string') {
      if (typeof DOMParser !== 'undefined') {
        doc = new DOMParser().parseFromString(`<div>${htmlOrDoc}</div>`, 'text/html');
      }
    } else if (htmlOrDoc.querySelector || htmlOrDoc.querySelectorAll) {
      doc = htmlOrDoc;
    }

    const todos = [];
    const seenTitles = new Set();

    if (doc) {
      const markers = doc.querySelectorAll('.note-todo, [data-todo-id]');
      markers.forEach(el => {
        const textSpan = el.querySelector('.note-todo-text');
        let title = (textSpan ? textSpan.textContent : el.textContent || '').trim();
        title = title.replace(/^todo urgency:\s*(high|medium|low|q1|q2|q3|q4)\s*/i, '').trim();
        title = title.replace(/^👤\s*[^:]+:\s*/, '').trim();
        if (!title) return;

        const id = el.getAttribute('data-todo-id') || '';
        const priority = el.getAttribute('data-todo-priority') || el.getAttribute('data-importance') || 'Medium';
        const importance = el.getAttribute('data-importance') || priority;
        const urgency = el.getAttribute('data-urgency') || el.getAttribute('data-todo-quadrant') || 'Medium';
        const owner = el.getAttribute('data-owner') || '';
        const ownerId = el.getAttribute('data-owner-id') || '';
        const isDone = el.classList.contains('note-todo-done') || el.getAttribute('data-todo-status') === 'Done';
        const isWip = el.classList.contains('note-todo-wip') || el.getAttribute('data-todo-status') === 'WIP';
        const status = isDone ? 'Done' : (isWip ? 'WIP' : (el.getAttribute('data-todo-status') || 'Open'));

        todos.push({
          id,
          title,
          priority,
          importance,
          urgency,
          owner,
          ownerId,
          status,
          isDone,
          isWip
        });
        seenTitles.add(title.toLowerCase());
      });
    }

    if (options.includeUnstructured && typeof htmlOrDoc === 'string') {
      const lines = htmlOrDoc.replace(/<[^>]+>/g, '\n').split('\n');
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        const todoMatch = line.match(/^(?:[-*•]\s*)?(?:\[\s*[xX ]?\s*\]|TODO:|Action\s*(?:item)?\s*:|Tâche\s*:)\s*(.+)$/i);
        if (todoMatch) {
          let taskText = todoMatch[1].trim();
          let owner = '';
          const ownerMatch = taskText.match(/(?:@|\((?:assignee|owner|for|responsable):\s*@?)([A-Z][a-zA-Z0-9_-]+)\)?/i);
          if (ownerMatch) {
            owner = ownerMatch[1];
            taskText = taskText.replace(ownerMatch[0], '').replace(/\(\s*\)/g, '').trim();
          }
          if (taskText && !seenTitles.has(taskText.toLowerCase())) {
            seenTitles.add(taskText.toLowerCase());
            todos.push({
              id: '',
              title: taskText,
              priority: 'Medium',
              importance: 'Medium',
              urgency: 'Medium',
              owner,
              ownerId: '',
              status: line.includes('[x]') || line.includes('[X]') ? 'Done' : 'Open',
              isDone: line.includes('[x]') || line.includes('[X]'),
              isWip: false,
              isUnstructured: true
            });
          }
        }
      }
    }

    return todos;
  },

  /**
   * Parses and extracts decisions from note HTML or text.
   * Extracts attributes from .note-decision-wrapper spans (status, text, owner, topic, context)
   * and optionally parses unstructured decision lines.
   */
  extractDecisionsFromNote(htmlOrDoc, options = {}) {
    if (!htmlOrDoc) return [];
    let doc = null;
    if (typeof htmlOrDoc === 'string') {
      if (typeof DOMParser !== 'undefined') {
        doc = new DOMParser().parseFromString(`<div>${htmlOrDoc}</div>`, 'text/html');
      }
    } else if (htmlOrDoc.querySelector || htmlOrDoc.querySelectorAll) {
      doc = htmlOrDoc;
    }

    const decisions = [];
    const seenTexts = new Set();

    if (doc) {
      const markers = doc.querySelectorAll('.note-decision-wrapper, [data-decision-status]');
      markers.forEach(el => {
        const textSpan = el.querySelector('.note-decision-text');
        let text = (textSpan ? textSpan.textContent : (el.getAttribute('data-decision-text') || el.textContent || '')).trim();
        text = text.replace(/^!decision:[a-z-]+\s*/i, '').trim();
        text = text.replace(/^🎯\s*decision\s*/i, '').trim();
        if (!text) return;

        const status = el.getAttribute('data-decision-status') || 'active';
        const owner = el.getAttribute('data-decision-owner') || '';
        const reporter = el.getAttribute('data-decision-reporter') || '';
        const topic = el.getAttribute('data-decision-topic') || '';
        const majorTopic = el.getAttribute('data-decision-major') || '';
        const authority = el.getAttribute('data-decision-authority') || '';
        const impact = el.getAttribute('data-decision-impact') || '';
        const context = el.getAttribute('data-decision-context') || '';

        decisions.push({
          text,
          status,
          owner,
          reporter,
          topic,
          majorTopic,
          authority,
          impact,
          context
        });
        seenTexts.add(text.toLowerCase());
      });
    }

    if (options.includeUnstructured && typeof htmlOrDoc === 'string') {
      const lines = htmlOrDoc.replace(/<[^>]+>/g, '\n').split('\n');
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        const decMatch = line.match(/^(?:[-*•]\s*)?(?:!decision:([a-z-]+)|Decision\s*:|Décision\s*:)\s*(.+)$/i);
        if (decMatch) {
          const status = decMatch[1] ? decMatch[1].toLowerCase() : 'active';
          const text = decMatch[2].trim();
          if (text && !seenTexts.has(text.toLowerCase())) {
            seenTexts.add(text.toLowerCase());
            decisions.push({
              text,
              status,
              owner: '',
              reporter: '',
              topic: '',
              majorTopic: '',
              authority: '',
              impact: '',
              context: '',
              isUnstructured: true
            });
          }
        }
      }
    }

    return decisions;
  },

  /**
   * Extracts unique colleague @mentions, mention pills, and owner tags from note HTML/text.
   */
  extractColleagueMentionsFromNote(htmlOrDoc, options = {}) {
    if (!htmlOrDoc) return [];
    const names = [];
    const seen = new Set();
    const addName = (raw) => {
      const clean = String(raw || '').replace(/^[@👤\s]+/, '').trim();
      if (clean && clean.length >= 2 && !seen.has(clean)) {
        seen.add(clean);
        names.push(clean);
      }
    };

    let doc = null;
    let textContent = '';
    let rawHtml = '';
    if (typeof htmlOrDoc === 'string') {
      rawHtml = htmlOrDoc;
      if (typeof DOMParser !== 'undefined') {
        doc = new DOMParser().parseFromString(`<div>${htmlOrDoc}</div>`, 'text/html');
      }
      textContent = doc ? (doc.body?.textContent || doc.textContent || '') : htmlOrDoc;
    } else if (htmlOrDoc.querySelector || htmlOrDoc.querySelectorAll) {
      doc = htmlOrDoc;
      textContent = doc.body?.textContent || doc.documentElement?.textContent || doc.textContent || '';
      rawHtml = doc.body?.innerHTML || doc.innerHTML || '';
    }

    const regex = /@([A-Z][a-zA-Z0-9_-]+)/g;
    let match;
    while ((match = regex.exec(textContent || rawHtml)) !== null) {
      addName(match[1]);
    }

    if (doc) {
      doc.querySelectorAll('.pill-mention, [data-colleague], [data-owner], .inline-reassign-owner, .owner-tag').forEach(el => {
        const name = el.getAttribute('data-colleague') || el.getAttribute('data-owner') || el.textContent || '';
        addName(name);
      });
    }

    return names;
  },

  /**
   * Extracts highlights (<mark>, .note-highlight) from note HTML.
   */
  extractHighlightsFromNote(htmlOrDoc, options = {}) {
    if (!htmlOrDoc) return [];
    let doc = null;
    if (typeof htmlOrDoc === 'string') {
      if (typeof DOMParser !== 'undefined') {
        doc = new DOMParser().parseFromString(`<div>${htmlOrDoc}</div>`, 'text/html');
      }
    } else if (htmlOrDoc.querySelector || htmlOrDoc.querySelectorAll) {
      doc = htmlOrDoc;
    }

    if (!doc) return [];
    const highlights = [];
    const seen = new Set();
    doc.querySelectorAll('mark, .note-highlight, .note-highlight-chip').forEach(el => {
      const text = String(el.textContent || '').replace(/\s+/g, ' ').trim();
      if (text && text.length > 2 && !seen.has(text)) {
        seen.add(text);
        highlights.push(text);
      }
    });

    return highlights;
  },

  /**
   * Parses full note HTML or structure into a unified composite object.
   */
  parseNoteStructure(htmlOrDoc, options = {}) {
    if (!htmlOrDoc) {
      return {
        title: '',
        summary: '',
        todos: [],
        decisions: [],
        colleagues: [],
        highlights: [],
        sections: [],
        rawText: ''
      };
    }

    let doc = null;
    let rawHtml = '';
    if (typeof htmlOrDoc === 'string') {
      rawHtml = htmlOrDoc;
      if (typeof DOMParser !== 'undefined') {
        doc = new DOMParser().parseFromString(`<div>${htmlOrDoc}</div>`, 'text/html');
      }
    } else if (htmlOrDoc.querySelector || htmlOrDoc.querySelectorAll) {
      doc = htmlOrDoc;
      rawHtml = doc.body?.innerHTML || doc.innerHTML || '';
    }

    const title = doc?.querySelector('title')?.textContent?.trim() || '';
    const summarySection = doc?.querySelector('section#note-summary, #note-summary');
    const summary = summarySection ? summarySection.innerHTML.trim() : (doc?.querySelector('meta[name="summary"]')?.getAttribute('content') || '');

    const todos = this.extractTodosFromNote(doc || rawHtml, { includeUnstructured: true });
    const decisions = this.extractDecisionsFromNote(doc || rawHtml, { includeUnstructured: true });
    const colleagues = this.extractColleagueMentionsFromNote(doc || rawHtml);
    const highlights = this.extractHighlightsFromNote(doc || rawHtml);

    const sections = [];
    if (doc) {
      doc.querySelectorAll('h1, h2, h3').forEach(heading => {
        sections.push({
          level: heading.tagName.toLowerCase(),
          title: heading.textContent?.trim() || '',
          element: heading
        });
      });
    }

    const rawText = doc ? (doc.body?.textContent || doc.textContent || '').trim() : '';

    return {
      title,
      summary,
      todos,
      decisions,
      colleagues,
      highlights,
      sections,
      rawText
    };
  },

  /**
   * Parses and normalizes AI suggestions and proposed actions from an AI response or parsed payload.
   */
  parseAiSuggestedActions(payloadOrReply, options = {}) {
    let payload = payloadOrReply;
    if (typeof payloadOrReply === 'string') {
      payload = this.parseJson(payloadOrReply) || {};
    }
    if (!payload || typeof payload !== 'object') {
      return {
        summary: '',
        todos: [],
        decisions: [],
        corrections: [],
        colleagueLinks: [],
        noteLinks: [],
        rawActions: []
      };
    }

    const summary = String(payload.general_comment || payload.summary || payload.comment || '').trim();
    const todos = [];
    const decisions = [];
    const corrections = [];
    const colleagueLinks = [];
    const noteLinks = [];

    // Parse actions from suggested_actions / actions / suggestions
    const rawActions = [];
    const actionArrays = [payload.suggested_actions, payload.actions, payload.suggestions, payload.proposed_actions];
    for (const arr of actionArrays) {
      if (Array.isArray(arr)) {
        rawActions.push(...arr);
      }
    }

    for (const action of rawActions) {
      if (!action || typeof action !== 'object') continue;
      const name = String(action.action || action.name || action.type || '').trim().toLowerCase();
      const props = action.properties || action.args || action.params || action;

      if (name === 'create_todo' || name === 'todo' || name === 'task') {
        todos.push({
          title: props.title || props.text || props.task || '',
          owner: props.owner || props.assignee || '',
          priority: props.priority || props.importance || 'Medium',
          importance: props.importance || props.priority || 'Medium',
          urgency: props.urgency || props.priority || 'Medium',
          deadline: props.deadline || null
        });
      } else if (name === 'log_decision' || name === 'decision') {
        decisions.push({
          text: props.text || props.title || props.decision || '',
          status: props.status || 'active',
          majorTopic: props.major_topic || props.majorTopic || '',
          topic: props.topic || '',
          context: props.context || props.rationale || ''
        });
      } else if (name === 'text_correction' || name === 'correction' || name === 'edit') {
        corrections.push({
          target_string: props.target_string || props.target || props.original || '',
          replacement_text: props.replacement_text || props.replacement || props.new_text || '',
          annotation: props.annotation || props.explanation || props.reason || ''
        });
      }
    }

    // Parse top-level proposed arrays
    if (Array.isArray(payload.proposed_todos)) {
      payload.proposed_todos.forEach(t => {
        if (t && typeof t === 'object') {
          todos.push({
            title: t.title || t.text || t.task || '',
            owner: t.owner || t.assignee || '',
            priority: t.priority || t.importance || 'Medium',
            importance: t.importance || t.priority || 'Medium',
            urgency: t.urgency || t.priority || 'Medium',
            deadline: t.deadline || null
          });
        }
      });
    }

    if (Array.isArray(payload.proposed_decisions)) {
      payload.proposed_decisions.forEach(d => {
        if (d && typeof d === 'object') {
          decisions.push({
            text: d.text || d.title || d.decision || '',
            status: d.status || 'active',
            majorTopic: d.major_topic || d.majorTopic || '',
            topic: d.topic || '',
            context: d.context || d.rationale || ''
          });
        }
      });
    }

    if (Array.isArray(payload.proposed_colleague_links)) {
      payload.proposed_colleague_links.forEach(c => {
        const name = typeof c === 'string' ? c : (c?.name || c?.label || '');
        if (name) colleagueLinks.push(name.replace(/^@/, ''));
      });
    }

    if (Array.isArray(payload.proposed_note_links)) {
      payload.proposed_note_links.forEach(l => {
        if (l && typeof l === 'object') {
          noteLinks.push({ title: l.title || '', id: l.id || '' });
        }
      });
    }

    return {
      summary,
      todos,
      decisions,
      corrections,
      colleagueLinks: Array.from(new Set(colleagueLinks)),
      noteLinks,
      rawActions
    };
  },

  async getSeriesContextForLLM(note) {
    if (!note) return '';

    const currentNoteId = String(note.id || '').trim();
    if (!currentNoteId || !Array.isArray(plannerEvents)) return '';

    const associatedIds = new Set();

    // Primary note side: note is bloc note, use manual associated notes.
    plannerEvents.forEach(ev => {
      if (!ev || String(ev.noteId || '').trim() !== currentNoteId) return;
      const linkedIds = (Array.isArray(ev.linkedNoteIds) ? ev.linkedNoteIds : [])
        .map(v => String(v || '').trim())
        .filter(Boolean);
      linkedIds.forEach(id => {
        if (id !== currentNoteId) associatedIds.add(id);
      });
    });

    // Associated note side: note is linked in a bloc, include that bloc primary note.
    plannerEvents.forEach(ev => {
      if (!ev) return;
      const linkedIds = (Array.isArray(ev.linkedNoteIds) ? ev.linkedNoteIds : [])
        .map(v => String(v || '').trim())
        .filter(Boolean);
      if (linkedIds.includes(currentNoteId)) {
        const primary = String(ev.noteId || '').trim();
        if (primary && primary !== currentNoteId) associatedIds.add(primary);
      }
    });

    if (!associatedIds.size) return '';

    const relatedNotes = Array.from(associatedIds)
      .map(id => (typeof getNoteById === 'function' ? getNoteById(id) : null))
      .filter(Boolean)
      .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));

    if (!relatedNotes.length) return '';

    let contextStr = '\n=========================================\n';
    contextStr += 'MANUALLY ASSOCIATED NOTES (PLANNER):\n';

    for (const rn of relatedNotes.slice(-5)) {
      contextStr += `\n- Date: ${rn.date || 'Unknown'}\n`;
      contextStr += `  Title: ${rn.title || 'Untitled'}\n`;

      let summaryVal = String(rn.summary || '').trim();
      if (!summaryVal) {
        try {
          const html = (typeof StorageAPI !== 'undefined' && typeof StorageAPI.readNoteContent === 'function') ? await StorageAPI.readNoteContent(rn.path) : await readFile(rn.path);
          const parsed = parseNoteHTML(html);
          const doc = new DOMParser().parseFromString('<div>' + (parsed.mainHTML || '') + '</div>', 'text/html');
          const plain = (doc.body.textContent || '').trim().replace(/\s+/g, ' ');
          if (plain.length > 1000) summaryVal = plain.slice(0, 1000) + '+++truncated';
          else summaryVal = plain || '(Empty note)';
        } catch (_e) {
          summaryVal = '(Could not read note content)';
        }
      }

      summaryVal = this.truncateTextForLLM(summaryVal, 700);
      contextStr += `  Summary: ${summaryVal}\n`;
    }

    contextStr += '=========================================\n';
    return this.truncateTextForLLM(contextStr, 2500);
  },

  async generateNoteSummary(note, noteContent) {
    const cfg = this.ensureReadyForCalls();
    const { model } = cfg;
    const preparedNoteContent = this.prepareNoteContentForLLM(noteContent);
    const trimmedNoteContent = preparedNoteContent.slice(0, 18000);

    const safeNote = note || {};
    const aiSettings = (typeof settings !== 'undefined' && settings.ai) ? settings.ai : {};
    let aiLanguage = aiSettings.language || 'auto';
    if (aiLanguage === 'auto') {
      const sampleText = ((safeNote.title || '') + ' ' + (noteContent || ''));
      aiLanguage = (typeof detectTextLanguage === 'function')
        ? detectTextLanguage(sampleText, typeof getAppLanguage === 'function' ? getAppLanguage() : 'en')
        : (typeof getAppLanguage === 'function' ? getAppLanguage() : 'en');
    }

    const pack = (typeof APP_LANGUAGE_PACKS !== 'undefined' && APP_LANGUAGE_PACKS[aiLanguage]) ? APP_LANGUAGE_PACKS[aiLanguage] : (typeof APP_LANGUAGE_PACKS !== 'undefined' ? APP_LANGUAGE_PACKS.en : null);
    const systemPrompt = (typeof AppPrompts !== 'undefined' && AppPrompts.buildSummaryPrompt)
      ? AppPrompts.buildSummaryPrompt({ targetLang: aiLanguage })
      : ((pack && pack.llm && pack.llm.summarySystemPrompt) ? pack.llm.summarySystemPrompt : `You are Secretary's local artificial intelligence.
Write a structured summary of the meeting, ready to be inserted into the summary section of the note.
Respond with a strict JSON containing only the "general_comment" field.
Do not write any text before or after the JSON. Do not use markdown code blocks (no \`\`\`json).

Important rules:
- You MUST write the entire text in English.
- Do NOT include any titles or headers (such as "Call Summary", "Main Points", "Decisions", etc.) in the HTML fragment.
- The "general_comment" field must contain only the following HTML structure:
  1. A paragraph <p> with the global summary in 2 to 4 sentences. Wrap only complete sentences (important facts) in <mark>...</mark>, never isolated words.
  2. A bulleted list <ul> containing the main points as simple <li> elements (do not nesting <li> tags).
  3. If applicable, a bulleted list <ul> containing decisions taken as simple <li> elements.
- Ensure that the <ul> lists contain valid and simple <li> elements, without nested tags (NEVER write <li><li> or <li><li >).
- Use only these allowed HTML tags: <p>, <ul>, <li>, <strong>, <em>, <mark>.
- Do not use Markdown syntax.

Mandatory JSON schema:
{
  "general_comment": "<p>The meeting aimed to discuss... <mark>The team expressed high satisfaction.</mark></p><ul><li>Review of outstanding tasks and actions</li><li>Evaluation of work progress</li></ul>"
}`);
    const userPromptTemplate = (pack && pack.llm && pack.llm.activeNotePrompt) ? pack.llm.activeNotePrompt : `Here is the active note:\nTitle: {title}\nDate: {date}\nContent:\n{content}`;
    const userPrompt = userPromptTemplate
      .replace('{title}', safeNote.title || '')
      .replace('{date}', safeNote.date || '')
      .replace('{content}', trimmedNoteContent);

    const extractedImages = await this.extractNoteImageUrls(safeNote, noteContent);
    let userMessageContent = userPrompt;
    if (extractedImages && extractedImages.length > 0) {
      userMessageContent = [
        { type: 'text', text: userPrompt },
        ...extractedImages.map(url => ({
          type: 'image_url',
          image_url: { url }
        }))
      ];
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessageContent }
    ];

    try {
      const result = await this.executeRequest({
        messages,
        options: {
          temperature: 0.1,
          timeoutMs: 60000
        }
      });

      const parsedJson = result.parsed;
      if (parsedJson && parsedJson.general_comment) {
        const comment = parsedJson.general_comment || '';
        const cleaned = cleanSummaryHtml(comment);
        return normalizeHighlightsToSentenceFacts(cleaned);
      }

      if (result.reply && (result.reply.includes('<p>') || result.reply.includes('<ul>') || result.reply.includes('<strong>'))) {
        return normalizeHighlightsToSentenceFacts(cleanSummaryHtml(result.reply));
      }
      return '';
    } catch (err) {
      throw err;
    }
  },

  /**
   * Multi-stage intelligent RAG retrieval for the Secretary chat.
   *
   * Pipeline:
   *  1. Keyword pre-filter: scores all manifest notes against query words → top 40 candidates.
   *  2. Sub-LLM selection: a lightweight LLM call picks the truly relevant paths (max 6).
   *  3. Summary enrichment: uses stored note.summary, or falls back to a content snippet.
   *  4. Association expansion: one level deep via plannerEvents.linkedNoteIds (max 2 per primary).
   *
   * @param {string} query - The user's question or topic to retrieve context for.
   * @returns {Promise<string>} A formatted context block ready to inject into the chat.
   */
  async retrieveRelevantNotesContext(query, options = {}) {
    if (!query || !Array.isArray(manifest) || manifest.length === 0) return '';

    // ── Step 1: Keyword pre-filter ─────────────────────────────────────────
    const STOP_WORDS = new Set([
      'avec', 'pour', 'dans', 'les', 'des', 'une', 'que', 'qui', 'est', 'sur',
      'par', 'pas', 'mais', 'son', 'ses', 'leur', 'tout', 'plus', 'bien', 'aussi',
      'the', 'and', 'for', 'what', 'with', 'this', 'that', 'from', 'have', 'are',
      'was', 'not', 'about', 'when', 'how', 'can', 'you', 'did', 'all', 'has'
    ]);
    const queryWords = (query.toLowerCase().match(/\b\w{3,}\b/g) || [])
      .filter(w => !STOP_WORDS.has(w));

    const scored = manifest.map(note => {
      if (!note || !note.path) return null;
      const searchable = [
        note.title || '',
        note.date || '',
        ...(note.group_tags || []),
        ...(note.major_topic_tags || []),
        ...(note.topic_tags || []),
        (note.summary || '').slice(0, 300),
        (note.preview || '').slice(0, 200)
      ].join(' ').toLowerCase();
      let score = 0;
      for (const w of queryWords) {
        if (searchable.includes(w)) score++;
      }
      return score > 0 ? { note, score } : null;
    }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 40);

    if (scored.length === 0) {
      // Fallback: check cached note content or note text when metadata search yields 0 matches
      for (const note of manifest) {
        if (!note || !note.path) continue;
        const cached = (typeof noteContentCache !== 'undefined') ? noteContentCache[note.path] : null;
        if (cached && cached.text) {
          const textLower = cached.text.toLowerCase();
          let cScore = 0;
          for (const w of queryWords) {
            if (textLower.includes(w)) cScore++;
          }
          if (cScore > 0) scored.push({ note, score: cScore });
        }
      }
      scored.sort((a, b) => b.score - a.score);
    }

    if (scored.length === 0) return '';

    // ── Step 2: Sub-LLM relevance selection ───────────────────────────────
    const candidateIndex = scored.map(({ note }) => ({
      path: note.path,
      title: note.title || '',
      date: note.date || '',
      tags: [...(note.group_tags || []), ...(note.major_topic_tags || [])].slice(0, 5).join(', '),
      snippet: (note.summary || note.preview || '').slice(0, 180)
    }));

    let selectedPaths = [];
    try {
      const subRes = await this.chat([
        {
          role: 'system',
          content: `Tu es un assistant de récupération documentaire.
Parmi les notes ci-dessous, identifie celles qui sont pertinentes pour répondre à la question de l'utilisateur.
Réponds UNIQUEMENT avec un tableau JSON de chemins (ex: ["notes/note1.html"]). Maximum 6 notes. Si aucune n'est pertinente, retourne [].`
        },
        {
          role: 'user',
          content: `Question: ${this.truncateTextForLLM(query, 2000)}\n\nNotes candidates:\n${JSON.stringify(candidateIndex, null, 2)}`
        }
      ], {
        temperature: 0.1,
        reasoningEffort: 'low',
        controller: options.controller,
        timeoutMs: 0
      });
      const replyText = String(subRes.reply || '').trim();
      const jsonMatch = replyText.match(/\[[\s\S]*?\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed)) {
          selectedPaths = parsed.filter(p => typeof p === 'string');
        }
      }
    } catch (err) {
      console.warn('Secretary RAG: sub-agent selection failed, falling back to top-scored notes:', err);
      selectedPaths = scored.slice(0, 4).map(x => x.note.path);
    }

    // Validate selected paths against manifest
    selectedPaths = selectedPaths
      .filter(p => manifest.some(n => n.path === p))
      .slice(0, 6);

    // Fallback to top-scored if sub-LLM returned nothing valid
    if (selectedPaths.length === 0) {
      selectedPaths = scored.slice(0, 3).map(x => x.note.path);
    }

    // ── Step 3 & 4: Enrich + expand one association level ─────────────────
    const contextParts = [];
    const processedIds = new Set();

    const enrichNote = async (notePath, depth = 0) => {
      const note = manifest.find(n => n.path === notePath);
      if (!note) return;
      const noteKey = note.id || note.path;
      if (processedIds.has(noteKey)) return;
      processedIds.add(noteKey);

      // Prefer stored summary; fall back to a content text snippet
      let summaryVal = this.truncateTextForLLM(String(note.summary || '').trim(), 1000);
      if (!summaryVal) {
        try {
          const html = (typeof StorageAPI !== 'undefined' && typeof StorageAPI.readNoteContent === 'function') ? await StorageAPI.readNoteContent(note.path) : await readFile(note.path);
          const parsed = (typeof parseNoteHTML === 'function') ? parseNoteHTML(html) : { mainHTML: html };
          const doc = new DOMParser().parseFromString('<div>' + (parsed.mainHTML || '') + '</div>', 'text/html');
          const plain = (doc.body.textContent || '').trim().replace(/\s+/g, ' ');
          summaryVal = this.truncateTextForLLM(plain, 1000);
        } catch (_e) {
          summaryVal = '(Contenu non disponible)';
        }
      }

      const indent = depth > 0 ? '    ' : '   ';
      const label = depth > 0 ? '  └─ [Note associée] ' : '📄 ';
      contextParts.push(`${label}"${(note && (note.title || note.path)) || ''}" (${(note && note.date) || '?'})\n${indent}Résumé: ${summaryVal}`);

      // Expand associated notes one level (only for primary notes)
      if (depth === 0 && Array.isArray(plannerEvents)) {
        const assocIds = new Set();
        const noteId = String(note.id || '').trim();
        plannerEvents.forEach(ev => {
          if (String(ev.noteId || '').trim() === noteId) {
            (ev.linkedNoteIds || []).forEach(id => {
              const tid = String(id || '').trim();
              if (tid && tid !== noteId) assocIds.add(tid);
            });
          }
          if ((ev.linkedNoteIds || []).map(v => String(v || '').trim()).includes(noteId)) {
            const primary = String(ev.noteId || '').trim();
            if (primary && primary !== noteId) assocIds.add(primary);
          }
        });

        let assocCount = 0;
        for (const assocId of Array.from(assocIds)) {
          if (assocCount >= 2) break;
          const assocNote = manifest.find(n => String(n.id || '').trim() === assocId);
          if (assocNote && !processedIds.has(assocNote.id || assocNote.path)) {
            await enrichNote(assocNote.path, 1);
            assocCount++;
          }
        }
      }
    };

    for (const path of selectedPaths) {
      await enrichNote(path, 0);
    }

    if (contextParts.length === 0) return '';

    const count = processedIds.size;
    return [
      '\n=========================================',
      `NOTES PERTINENTES RÉCUPÉRÉES (${count} note${count > 1 ? 's' : ''}):`,
      contextParts.join('\n\n'),
      '=========================================\n'
    ].join('\n');
  },

  /**
   * Analyzes the note text with local Mini-RAG context and structured outputs.
   * @param {Object} note - The active note metadata.
   * @param {string} noteContent - The markdown text of the note.
   * @returns {Promise<Object>} Structured actions JSON.
   */
  async analyzeNote(note, noteContent, options = {}) {
    const MAX_INPUT_CHARS = 18000;

    const cfg = this.ensureReadyForCalls();
    const { model } = cfg;
    const requestUrl = this.getChatCompletionsUrl(cfg);

    // 1. Gather Mini-RAG local context

    // A. Decisions
    const activeDecisions = [];
    const majors = note.major_topic_tags || [];
    if (majors.length > 0 && typeof getAllMetadataDecisionEntries === 'function') {
      const allDec = getAllMetadataDecisionEntries();
      for (const d of allDec) {
        if (d.status === 'active') {
          const dMajors = d.major_topic_tags || [];
          if (dMajors.some(m => majors.includes(m))) {
            activeDecisions.push({ noteId: d.noteId, text: d.text });
          }
        }
      }
    }

    // B. Active Todos for topics (collaborators)
    const activeTodos = [];
    const topics = note.topic_tags || [];
    if (topics.length > 0 && Array.isArray(todosManifest)) {
      for (const t of todosManifest) {
        if (t.priority !== 'Done' && t.owner && topics.includes(t.owner)) {
          activeTodos.push({ id: t.id, title: t.title, priority: t.priority, owner: t.owner });
        }
      }
    }

    // C. Backlinks
    let backlinks = [];
    if (typeof getBacklinksForNote === 'function') {
      try {
        backlinks = await getBacklinksForNote(note);
      } catch (err) {
        console.warn('Mini-RAG: Could not retrieve backlinks', err);
      }
    }
    const backlinksTitles = backlinks.map(b => b.title || b.path.split('/').pop().replace('.html', ''));

    let seriesContext = '';
    try {
      seriesContext = await this.getSeriesContextForLLM(note);
    } catch (err) {
      console.warn('Mini-RAG: Could not retrieve series context', err);
    }
    seriesContext = this.truncateTextForLLM(seriesContext, 2500);

    const colleagueNames = (typeof colleaguesDb !== 'undefined' && colleaguesDb && Array.isArray(colleaguesDb.colleagues))
      ? colleaguesDb.colleagues.map(c => c.label)
      : [];

    // 2. Build system prompt with RAG context
    const contextPrompt = this.truncateTextForLLM(`
CONTEXTE LOCAL (RAG LOCAL) DE LA NOTE EN COURS:
- Décisions actives pour le Major Topic (${majors.join(', ') || 'Aucun'}):
${activeDecisions.map(d => `  * [Decision] "${d.text}" (dans la note: "${d.noteId}")`).join('\n') || '  (Aucune)'}

- Tâches actives assignées aux Topics/Intervenants (${topics.join(', ') || 'Aucun'}):
${activeTodos.map(t => `  * [Todo] "${t.title}" (Priorité: ${t.priority}, Assigné à: ${t.owner})`).join('\n') || '  (Aucune)'}

- Liste complète des collaborateurs de l'équipe (collègues disponibles) :
${colleagueNames.map(name => `  * ${name}`).join('\n')}

- Backlinks pointant vers cette note:
${backlinksTitles.map(t => `  * Note: "${t}"`).join('\n') || '  (Aucun)'}
${seriesContext}
`, 3500);

    const aiSettings = settings.ai || {};
    const aiLanguage = aiSettings.language || 'auto';
    const returnPreset = aiSettings.returnPreset || 'full';

    const safeNote = note || {};
    let targetLang = aiLanguage;
    if (targetLang === 'auto') {
      const sampleText = ((safeNote.title || '') + ' ' + (noteContent || ''));
      targetLang = (typeof detectTextLanguage === 'function')
        ? detectTextLanguage(sampleText, typeof getAppLanguage === 'function' ? getAppLanguage() : 'en')
        : (typeof getAppLanguage === 'function' ? getAppLanguage() : 'en');
    }

    const pack = (typeof APP_LANGUAGE_PACKS !== 'undefined' && APP_LANGUAGE_PACKS[targetLang]) ? APP_LANGUAGE_PACKS[targetLang] : (typeof APP_LANGUAGE_PACKS !== 'undefined' ? APP_LANGUAGE_PACKS.en : null);

    const systemPrompt = (typeof AppPrompts !== 'undefined' && AppPrompts.buildNoteReviewPrompt)
      ? AppPrompts.buildNoteReviewPrompt({
          targetLang,
          returnPreset,
          contextPrompt,
          colleagueNames
        })
      : '';

    const preparedNoteContent = this.prepareNoteContentForLLM(noteContent);
    // Get length of note
    const noteLength = preparedNoteContent.length;
    if (noteLength > MAX_INPUT_CHARS) {
      console.log(`Note truncated: ${noteLength} to ${MAX_INPUT_CHARS} characters`);
    }
    const trimmedNoteContent = preparedNoteContent.slice(0, MAX_INPUT_CHARS);
    const startedAt = Date.now();
    const userPromptTemplate = (pack && pack.llm && pack.llm.activeNotePrompt) ? pack.llm.activeNotePrompt : `Here is the active note:\nTitle: {title}\nDate: {date}\nContent:\n{content}`;
    const userPrompt = userPromptTemplate
      .replace('{title}', (note && note.title) || '')
      .replace('{date}', (note && note.date) || '')
      .replace('{content}', trimmedNoteContent);

    const extractedImages = await this.extractNoteImageUrls(note, noteContent);
    let userMessageContent = userPrompt;
    if (extractedImages && extractedImages.length > 0) {
      userMessageContent = [
        { type: 'text', text: userPrompt },
        ...extractedImages.map(url => ({
          type: 'image_url',
          image_url: { url }
        }))
      ];
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessageContent }
    ];

    const traceBase = {
      kind: 'analyze-note',
      timestamp: new Date().toISOString(),
      endpoint: cfg.endpoint,
      requestUrl,
      model,
      noteId: note?.id || '',
      noteTitle: note?.title || '',
      inputCharsOriginal: String(noteContent || '').length,
      inputCharsPrepared: preparedNoteContent.length,
      inputCharsSent: trimmedNoteContent.length,
      timeoutMs: (options && options.timeoutMs > 0) ? options.timeoutMs : 0
    };

    let result;
    try {
      result = await this.executeRequest({
        messages,
        options: {
          controller: options.controller,
          signal: options.signal,
          timeoutMs: options.timeoutMs || 0,
          temperature: 0.1,
          reasoningEffort: options.reasoningEffort || 'medium',
          onRetry: (retryInfo) => {
            if (typeof options.onProgress === 'function') {
              options.onProgress(null, retryInfo.userMessage || 'Retrying...');
            }
          }
        }
      });
    } catch (err) {
      if (err && err.name === 'AbortError') {
        throw err;
      }
      const isTokenLimit = err.isTokenLimit || err.category === 'token_limit';
      await this.persistAnalyzeTrace({
        ...traceBase,
        status: isTokenLimit ? 'token_limit_exceeded' : 'http_error',
        elapsedMs: Date.now() - startedAt,
        httpStatus: err.status || 0,
        errorMessage: err.message,
        responseRaw: err.responseRaw || ''
      });
      err._llmTracePersisted = true;
      throw err;
    }

    const reply = (result.reply || '').trim();
    const parsed = result.parsed;
    const extractedJsonPayload = result.extractedJsonPayload || '';
    const finishReason = result.finishReason;

    if (!parsed || typeof parsed !== 'object') {
      await this.persistAnalyzeTrace({
        ...traceBase,
        status: 'content_parse_error',
        elapsedMs: Date.now() - startedAt,
        errorMessage: 'Could not parse response content as JSON object',
        responseRaw: result.rawReply || '',
        reply,
        extractedJsonPayload,
        replyLength: reply.length,
        finishReason
      });
      const err = new Error('Le LLM a répondu, mais le contenu ne respecte pas le JSON attendu.');
      err._llmTracePersisted = true;
      throw err;
    }

    await this.persistAnalyzeTrace({
      ...traceBase,
      status: 'ok',
      elapsedMs: Date.now() - startedAt,
      httpStatus: 200,
      responseRaw: result.rawReply,
      reply,
      finishReason,
      suggestedActionsCount: Array.isArray(parsed?.suggested_actions) ? parsed.suggested_actions.length : 0
    });

    const reasoningObj = this.extractReasoningAndContent(reply);
    const combinedReasoning = (result.reasoningText || reasoningObj.reasoningText || '').trim();

    return {
      parsed,
      reply: reasoningObj.cleanContent || reply,
      reasoningText: combinedReasoning,
      replySource: 'message.content',
      responseRaw: result.rawReply
    };
  },

  async replyInConversationLane(note, noteContent, conversationTurns, userMessage, options = {}) {
    const MAX_INPUT_CHARS = 18000;

    const cfg = this.ensureReadyForCalls();
    const { model } = cfg;
    const requestUrl = this.getChatCompletionsUrl(cfg);
    const preparedNoteContent = this.prepareNoteContentForLLM(noteContent || '');
    const trimmedNoteContent = preparedNoteContent.slice(0, MAX_INPUT_CHARS);

    const aiSettings = settings.ai || {};
    const aiLanguage = aiSettings.language || 'auto';

    const langNames = {
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

    let laneLanguageInstruction = '';
    if (aiLanguage && aiLanguage !== 'auto' && langNames[aiLanguage]) {
      laneLanguageInstruction = `- Toujours répondre en ${langNames[aiLanguage]}. Si tu produis du JSON, tous les champs textuels doivent être rédigés en ${langNames[aiLanguage]}.`;
    } else {
      laneLanguageInstruction = '- Répondre dans la même langue que la question de l’utilisateur (ou celle de la note).';
    }

    let seriesContext = '';
    try {
      seriesContext = await this.getSeriesContextForLLM(note);
    } catch (err) {
      console.warn('Mini-RAG: Could not retrieve series context for conversation', err);
    }
    seriesContext = this.truncateTextForLLM(seriesContext, 2000);

    const systemPrompt = (typeof AppPrompts !== 'undefined' && AppPrompts.buildNoteContextChatPrompt)
      ? AppPrompts.buildNoteContextChatPrompt({ targetLang: aiLanguage })
      : `Tu es l'assistant IA intégré de Secretary, un outil professionnel de prise de notes de réunion.
Tu réponds à l'utilisateur dans le volet conversationnel lié à la note active.
${laneLanguageInstruction}

RÈGLES IMPORTANTES :
- Sois concis, direct, professionnel et factuel.
- Tu peux analyser le contenu de la note, répondre aux questions, synthétiser, ou proposer des améliorations.
- Si l'utilisateur demande explicitement des actions/tâches ou des décisions, tu peux inclure un bloc JSON avec le format standard :
\`\`\`json
{
  "general_comment": "Texte de ta réponse...",
  "suggested_actions": [
    { "action": "create_todo", "title": "Titre", "owner": "Nom", "priority": "Q1" }
  ]
}
\`\`\`
- Si aucune action structurée n'est requise, réponds simplement en texte clair (Markdown léger autorisé : **gras**, listes à puces).
- N'invente pas de faits absents de la note.`;

    const priorMessages = [];
    if (Array.isArray(conversationTurns)) {
      conversationTurns.slice(-8).forEach(turn => {
        if (!turn || !turn.role || !turn.content) return;
        const role = turn.role === 'assistant' ? 'assistant' : 'user';
        priorMessages.push({ role, content: String(turn.content).slice(0, 4000) });
      });
    }

    const trimmedUserMessage = String(userMessage || '').trim().slice(0, 4000);
    const extractedImages = await this.extractNoteImageUrls(note, noteContent);
    const noteContextText = `Contexte note active:\nTitre: ${note?.title || ''}\nDate: ${note?.date || ''}\nContenu:\n${trimmedNoteContent}\n\n${seriesContext}`;

    let noteContextContent = noteContextText;
    if (extractedImages && extractedImages.length > 0) {
      noteContextContent = [
        { type: 'text', text: noteContextText },
        ...extractedImages.map(url => ({
          type: 'image_url',
          image_url: { url }
        }))
      ];
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: noteContextContent
      },
      ...priorMessages,
      { role: 'user', content: trimmedUserMessage }
    ];

    const startedAt = Date.now();
    const traceBase = {
      kind: 'chat-lane',
      timestamp: new Date().toISOString(),
      endpoint: cfg.endpoint,
      requestUrl,
      model,
      noteId: note?.id || '',
      noteTitle: note?.title || '',
      inputCharsPrepared: preparedNoteContent.length,
      inputCharsSent: trimmedNoteContent.length,
      timeoutMs: (options && options.timeoutMs > 0) ? options.timeoutMs : 0
    };

    let result;
    try {
      result = await this.executeRequest({
        messages,
        options: {
          controller: options.controller,
          signal: options.signal,
          timeoutMs: options.timeoutMs || 0,
          temperature: 0.7,
          reasoningEffort: options.reasoningEffort || 'medium',
          onRetry: (retryInfo) => {
            if (typeof options.onProgress === 'function') {
              options.onProgress(null, retryInfo.userMessage || 'Retrying...');
            }
          }
        }
      });
    } catch (err) {
      if (err && err.name === 'AbortError') {
        throw err;
      }
      const isTokenLimit = err.isTokenLimit || err.category === 'token_limit';
      await this.persistAnalyzeTrace({
        ...traceBase,
        status: isTokenLimit ? 'token_limit_exceeded' : 'http_error',
        elapsedMs: Date.now() - startedAt,
        httpStatus: err.status || 0,
        errorMessage: err.message,
        responseRaw: err.responseRaw || ''
      });
      throw err;
    }

    const reply = (result.reply || '').trim();
    const parsed = result.parsed;

    await this.persistAnalyzeTrace({
      ...traceBase,
      status: 'ok',
      elapsedMs: Date.now() - startedAt,
      httpStatus: 200,
      responseRaw: result.rawReply,
      reply,
      replySource: 'message.content',
      parsedAsJson: !!parsed,
      finishReason: result.finishReason,
      suggestedActionsCount: (parsed && Array.isArray(parsed.suggested_actions)) ? parsed.suggested_actions.length : 0
    });

    return {
      reply,
      replySource: 'message.content',
      parsed: parsed || null,
      reasoningText: result.reasoningText,
      responseRaw: result.rawReply
    };
  },

  async chat(messages, options = {}) {
    const result = await this.executeRequest({
      messages,
      options
    });
    return {
      reply: result.reply,
      rawReply: result.rawReply,
      parsed: result.parsed,
      tool_calls: result.tool_calls,
      reasoningText: result.reasoningText
    };
  },

  async testConnection(options = {}) {
    const formProvider = (typeof document !== 'undefined' && document.getElementById('prefs-ai-provider')?.value)?.trim();
    const formEndpoint = (typeof document !== 'undefined' && document.getElementById('prefs-ai-endpoint')?.value)?.trim();
    const formModel = (typeof document !== 'undefined' && document.getElementById('prefs-ai-model')?.value)?.trim();
    const formApiKey = (typeof document !== 'undefined' && document.getElementById('prefs-ai-key')?.value)?.trim();

    const aiSettings = (typeof settings !== 'undefined' && settings.ai) ? settings.ai : {};
    const provider = String(formProvider || aiSettings.provider || 'custom').toLowerCase();
    const defaultEndpoint = provider === 'lmstudio' ? 'http://127.0.0.1:1234/v1' : 'http://localhost:1234/v1';
    const defaultModel = provider === 'lmstudio' ? 'local-model' : 'qwen2.5-coder-7b-instruct';

    const endpointRaw = formEndpoint || aiSettings.endpoint || defaultEndpoint;
    const endpoint = this.normalizeEndpoint(endpointRaw, provider);
    const model = formModel || aiSettings.model || defaultModel;
    const apiKey = formApiKey !== undefined && formApiKey !== '' ? formApiKey : (aiSettings.apiKey || '');

    const cfg = { provider, endpoint, model, apiKey };

    if (!cfg.endpoint) {
      throw new Error('No LLM endpoint configured.');
    }
    if (!cfg.model) {
      throw new Error('No LLM model configured.');
    }

    const requestUrl = this.getChatCompletionsUrl(cfg);
    const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : 15000;

    const startedAt = Date.now();
    try {
      const res = await this.executeRequest({
        messages: [{ role: 'user', content: 'Say OK' }],
        options: {
          overrideConfig: cfg,
          temperature: 0,
          maxTokens: 100,
          timeoutMs,
          maxFastRetries: 0,
          maxSlowDownRetries: 0
        }
      });

      return {
        ok: true,
        elapsedMs: Date.now() - startedAt,
        endpoint,
        requestUrl,
        model,
        provider,
        reply: String(res.reply || '').trim()
      };
    } catch (err) {
      if (err && err.name === 'AbortError') {
        const timeoutErr = new Error(`Connection test timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
        timeoutErr.isTimeout = true;
        timeoutErr.endpoint = endpoint;
        timeoutErr.model = model;
        timeoutErr.provider = provider;
        timeoutErr.requestUrl = requestUrl;
        throw timeoutErr;
      }
      if (err && err.message && /Failed to fetch|NetworkError|fetch failed|ECONNREFUSED|ENOTFOUND/i.test(err.message)) {
        const netErr = new Error(`Network error: Unable to connect to ${endpoint} (${err.message}).`);
        netErr.isNetworkError = true;
        netErr.endpoint = endpoint;
        netErr.model = model;
        netErr.provider = provider;
        netErr.requestUrl = requestUrl;
        throw netErr;
      }
      if (!err.endpoint) {
        err.endpoint = endpoint;
        err.model = model;
        err.provider = provider;
        err.requestUrl = requestUrl;
      }
      throw err;
    }
  },

  findSimilarAndAssociatedNotes(note, noteContent, limit = 5) {
    if (typeof manifest === 'undefined' || !Array.isArray(manifest)) return [];
    const targetId = note?.id;
    const targetPath = note?.path;
    const majorTags = (note?.major_topic_tags || []).map(t => String(t).toLowerCase());
    const groupTags = (note?.group_tags || []).map(t => String(t).toLowerCase());
    const topicTags = (note?.topic_tags || []).map(t => String(t).toLowerCase());
    const titleWords = (note?.title || '').toLowerCase().split(/\s+/).filter(w => w.length > 3);

    const matches = [];

    for (const n of manifest) {
      if (!n || n.id === targetId || n.path === targetPath) continue;

      let score = 0;
      const nMajors = (n.major_topic_tags || []).map(t => String(t).toLowerCase());
      const nGroups = (n.group_tags || []).map(t => String(t).toLowerCase());
      const nTopics = (n.topic_tags || []).map(t => String(t).toLowerCase());
      const nTitle = (n.title || '').toLowerCase();

      for (const m of majorTags) {
        if (nMajors.includes(m)) score += 5;
      }
      for (const g of groupTags) {
        if (nGroups.includes(g)) score += 3;
      }
      for (const t of topicTags) {
        if (nTopics.includes(t)) score += 2;
      }
      for (const w of titleWords) {
        if (nTitle.includes(w)) score += 1;
      }

      if (score > 0) {
        matches.push({
          id: n.id,
          title: n.title,
          date: n.date,
          major_topic_tags: n.major_topic_tags || [],
          summary: n.summary || '',
          score: score
        });
      }
    }

    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, limit);
  },

  async runRefactorAgentLoop(note, noteContent, options = {}) {
    const cfg = this.ensureReadyForCalls();
    const activeLang = (settings.ai && settings.ai.language && settings.ai.language !== 'auto') ? settings.ai.language : (typeof getAppLanguage === 'function' ? getAppLanguage() : 'en');
    const reasoningEffort = options.reasoningEffort || 'high';

    // 1. Gather all related context
    const majorTags = Array.isArray(note?.major_topic_tags) ? note.major_topic_tags : [];
    const groupTags = Array.isArray(note?.group_tags) ? note.group_tags : [];
    const topicTags = Array.isArray(note?.topic_tags) ? note.topic_tags : [];

    // Load topic memory dossiers for all major tags
    const topicMemories = [];
    for (const mt of majorTags) {
      if (typeof getMajorTopicMemory === 'function') {
        const mem = await getMajorTopicMemory(mt);
        if (mem) topicMemories.push(mem);
      }
    }

    // Load compact 1-sentence summary catalog for all active and archived topic memories
    let topicCatalog = [];
    if (typeof WorkstreamMemoryEngine !== 'undefined' && WorkstreamMemoryEngine.getTopicMemoriesCatalog) {
      topicCatalog = await WorkstreamMemoryEngine.getTopicMemoriesCatalog({ includeArchived: true });
    }

    // Proactively find associated previous notes
    const associatedNotes = this.findSimilarAndAssociatedNotes(note, noteContent, 5);

    // Active colleagues
    let colleagueNames = [];
    try {
      if (typeof colleaguesDb !== 'undefined' && Array.isArray(colleaguesDb.colleagues)) {
        colleagueNames = colleaguesDb.colleagues.map(c => c.label || '').filter(Boolean);
      }
    } catch (_e) {}

    // Active decisions
    const activeDecisions = [];
    if (majorTags.length > 0 && typeof getAllMetadataDecisionEntries === 'function') {
      const allDec = getAllMetadataDecisionEntries();
      for (const d of allDec) {
        if (d.status === 'active' && (d.major_topic_tags || []).some(m => majorTags.includes(m))) {
          activeDecisions.push({ noteId: d.noteId, text: d.text });
        }
      }
    }

    // Active todos across the workspace
    const activeTodos = [];
    if (Array.isArray(todosManifest)) {
      for (const t of todosManifest) {
        if (t && t.priority !== 'Done') {
          activeTodos.push({ id: t.id, title: t.title, priority: t.priority || 'Medium', owner: t.owner || 'me' });
        }
      }
    }

    // Extract embedded / attached image URLs for LLM vision analysis
    const extractedImages = await this.extractNoteImageUrls(note, noteContent, options);

    let scratchpad = options.initialScratchpad || `Initial scratchpad: Starting note refactoring for "${note?.title || 'Note'}".\n- Raw note length: ${noteContent.length} chars.\n- Major Topics: ${majorTags.join(', ') || 'None'}\n- Attached Vision Images: ${extractedImages.length}\n- Goal: Convert raw notes into perfectly formatted, structured, readable notes without hallucinating facts.`;
    const scratchpadLog = options.initialLog ? [...options.initialLog] : [
      { step: 1, title: t('refactor.stepIngest') || 'Note Ingestion & Local Context Gathering', content: `Ingested note with ${noteContent.length} characters and ${extractedImages.length} vision images. Loaded ${topicMemories.length} Major Topic memory dossiers, ${associatedNotes.length} associated historical notes, and ${activeDecisions.length} active decisions.` }
    ];
    const proposedTopicSplits = [];

    if (typeof options.onProgress === 'function') {
      options.onProgress(20, t('refactor.stepIngest') || 'Ingestion et contexte local...');
    }

    const maxIterations = 3;
    let iteration = 0;
    let completed = false;
    let proposalsResult = null;

    let userAnswersText = '';
    if (options.clarificationAnswers && Object.keys(options.clarificationAnswers).length > 0) {
      userAnswersText = '\n\nUSER CLARIFICATION ANSWERS:\n' + Object.entries(options.clarificationAnswers)
        .map(([qId, ans]) => `- Question [${qId}]: "${ans}"`)
        .join('\n');
    }

    const currentUserName = (typeof settings !== 'undefined' && settings && settings.username) ? settings.username : (typeof getDefaultMeLabel === 'function' ? getDefaultMeLabel() : 'Me');

    const rawNoteTextPrepared = this.prepareNoteContentForLLM(noteContent);
    const availableWorkstreams = (typeof getKnownWorkstreamsList === 'function')
      ? getKnownWorkstreamsList(typeof manifest !== 'undefined' ? manifest : [])
      : [];
    const currentWorkstreams = (typeof getNoteWorkstreams === 'function' && note)
      ? getNoteWorkstreams(note)
      : (note?.workstreams || (typeof note?.workstream === 'string' ? note.workstream.split(',').map(s => s.trim()).filter(Boolean) : []));
    const currentGroup = note?.group || (Array.isArray(note?.group_tags) ? note.group_tags.join(', ') : '') || '';
    const currentTopic = note?.topic || (Array.isArray(note?.topic_tags) ? note.topic_tags.join(', ') : '') || '';

    const userPromptText = `NOTE TO REFACTOR:
Title: "${note?.title || 'Untitled'}"
Date: ${note?.date || 'N/A'}
Workstreams: ${currentWorkstreams.join(', ') || 'None'}
Group Tags: ${groupTags.join(', ') || currentGroup || 'None'}
Major Topic Tags: ${majorTags.join(', ') || 'None'}
Topic Tags: ${topicTags.join(', ') || currentTopic || 'None'}
CURRENT ACTIVE USER: "${currentUserName}"

RAW NOTE CONTENT:
${rawNoteTextPrepared}

EXISTING WORKSTREAM / TOPIC MEMORY CATALOG (1-Sentence Summaries):
${topicCatalog.length ? topicCatalog.map(t => `- [${t.topicName}] (${t.status}): "${t.summary}" [Tags: ${(t.mappedTags?.major_topic_tags || []).join(', ')}]`).join('\n') : 'No topic memories cataloged.'}

ASSOCIATED PREVIOUS NOTES CONTEXT:
${associatedNotes.length ? associatedNotes.map(n => `- Note [${n.id}]: "${n.title}" (${n.date}) - Major Tags: ${n.major_topic_tags.join(', ')} - Summary: ${n.summary}`).join('\n') : 'No directly associated previous notes found.'}

ACTIVE DECISIONS & TODOS IN THIS SCOPE:
- Decisions: ${activeDecisions.map(d => d.text).join(' | ') || 'None'}
- Open Todos: ${activeTodos.map(t => `[ID: ${t.id}] "${t.title}" (@${t.owner}, Priority: ${t.priority})`).join(' | ') || 'None'}
${userAnswersText}

Current Scratchpad:
${scratchpad}`;

    let userMessageContent = userPromptText;
    if (extractedImages && extractedImages.length > 0) {
      userMessageContent = [
        { type: 'text', text: userPromptText },
        ...extractedImages.map(url => ({
          type: 'image_url',
          image_url: { url }
        }))
      ];
    }

    const messages = [
      {
        role: 'system',
        content: (typeof AppPrompts !== 'undefined' && AppPrompts.buildPerfectNotePrompt)
          ? AppPrompts.buildPerfectNotePrompt({
              targetLang: activeLang,
              currentUserName,
              colleagueNames,
              availableWorkstreams,
              currentWorkstreams,
              currentGroup,
              currentTopic
            })
          : `You are Secretary's elite Note Refactoring & Structuring Agent.`
      },
      {
        role: 'user',
        content: userMessageContent
      }
    ];

    while (iteration < maxIterations && !completed) {
      iteration++;
      if (options.controller && options.controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');

      if (typeof options.onProgress === 'function') {
        options.onProgress(25 + iteration * 20, t('refactor.stepScratchpad') || 'Analyse et structuration...');
      }

      const response = await this.chat(messages, {
        controller: options.controller,
        timeoutMs: 0,
        reasoningEffort
      });

      if (response.reasoningText && typeof options.onProgress === 'function') {
        options.onProgress(25 + iteration * 20, t('refactor.stepScratchpad') || 'Analyse et structuration...', response.reasoningText);
      }

      let parsed = response.parsed;
      if (!parsed && response.reply) {
        const parsedInfo = this.extractJsonPayloadFromText(response.reply);
        parsed = parsedInfo?.parsed || null;
      }

      if (!parsed || !parsed.action) {
        if (parsed && (parsed.proposal_a_html || parsed.proposal_a || parsed.proposalA)) {
          const rawMeetingSummary = parsed.meeting_summary_html || parsed.summary_html || parsed.meeting_summary || parsed.general_comment || parsed.summary || '';
          let meetingSummaryClean = (typeof cleanMeetingSummaryHtml === 'function') ? cleanMeetingSummaryHtml(rawMeetingSummary, currentUserName) : rawMeetingSummary;
          if (!meetingSummaryClean && (parsed.proposal_a_html || parsed.proposal_a || parsed.proposalA)) {
            const pA = parsed.proposal_a_html || parsed.proposal_a || parsed.proposalA || '';
            const match = pA.match(/<h[2-4][^>]*>(?:Summary|Résumé|Zusammenfassung|Resumen|Sommario)[^<]*<\/h[2-4]>([\s\S]*?)(?=<h[2-4]|$)/i);
            if (match && match[1] && typeof cleanMeetingSummaryHtml === 'function') {
              meetingSummaryClean = cleanMeetingSummaryHtml(match[1], currentUserName);
            }
          }
          proposalsResult = {
            proposalA: parsed.proposal_a_html || parsed.proposal_a || parsed.proposalA || '',
            proposalB: parsed.proposal_b_html || parsed.proposal_b || parsed.proposalB || '',
            meetingSummary: meetingSummaryClean,
            meetingSummaryA: meetingSummaryClean,
            meetingSummaryB: meetingSummaryClean,
            rationale: parsed.summary_rationale || parsed.rationale || ''
          };
          completed = true;
          break;
        }
        break;
      }

      const action = String(parsed.action || '').toLowerCase();
      const props = parsed.properties || parsed;

      if (action === 'ask_clarifications' && !options.skipClarifications && (!options.clarificationAnswers || Object.keys(options.clarificationAnswers).length === 0)) {
        const questions = Array.isArray(props.questions) ? props.questions : [];
        if (questions.length > 0) {
          scratchpadLog.push({ step: iteration + 1, title: t('refactor.stepClarifications') || 'Clarifications Requested', content: `Agent identified ${questions.length} points requiring clarification.` });
          return {
            status: 'clarifications_needed',
            questions,
            scratchpad,
            scratchpadLog,
            topicMemories,
            proposedTopicSplits
          };
        }
      }

      if (action === 'save_major_topic_memory') {
        const mt = props.major_topic || (majorTags[0] || '');
        if (mt && typeof saveMajorTopicMemory === 'function') {
          const savedMem = await saveMajorTopicMemory(mt, props);
          topicMemories.push(savedMem);
          scratchpadLog.push({ step: iteration + 1, title: `${t('refactor.topicMemoryUpdated') || 'Major Topic Memory updated'} (${mt})`, content: props.summary || 'Updated topic knowledge.' });
        }
        messages.push({ role: 'assistant', content: JSON.stringify(parsed) });
        messages.push({ role: 'user', content: `Topic memory for "${mt}" saved successfully. Now proceed with scratchpad update or finalize_refactoring.` });
      } else if (action === 'search_topic_memory') {
        const query = props.query || props.pattern || '';
        let searchResults = [];
        if (typeof WorkstreamMemoryEngine !== 'undefined' && WorkstreamMemoryEngine.searchTopicMemories) {
          searchResults = await WorkstreamMemoryEngine.searchTopicMemories(query);
        }
        const resStr = searchResults.length
          ? searchResults.map(r => `[Key: ${r.memoryKey}] "${r.topicName}" (${r.status}):\n` + r.snippets.map(s => `   ... ${s.prev ? s.prev + ' | ' : ''}MATCH: ${s.match}${s.next ? ' | ' + s.next : ''} ...`).join('\n')).join('\n\n')
          : 'No matching topic memories found for regex search.';

        scratchpadLog.push({ step: iteration + 1, title: `Searched Topic Memories ("${query}")`, content: `Found ${searchResults.length} matching memory files.` });
        messages.push({ role: 'assistant', content: JSON.stringify(parsed) });
        messages.push({ role: 'user', content: `Topic Memory Search Results:\n${resStr}\n\nUse read_topic_memory for full dossier or proceed with refactoring.` });
      } else if (action === 'read_topic_memory') {
        const targetTopic = props.major_topic || props.topic || props.key || '';
        let memoryDossier = null;
        if (typeof getMajorTopicMemory === 'function') {
          memoryDossier = await getMajorTopicMemory(targetTopic);
        }
        const resStr = memoryDossier
          ? `Topic Memory Dossier for "${memoryDossier.topicName}":\nSummary: ${memoryDossier.summary}\nKey Facts: ${(memoryDossier.keyFacts || []).join('; ')}\nDecisions: ${JSON.stringify(memoryDossier.decisions || [])}`
          : `No topic memory found for "${targetTopic}".`;

        scratchpadLog.push({ step: iteration + 1, title: `Read Topic Memory (${targetTopic})`, content: `Retrieved dossier for "${targetTopic}".` });
        messages.push({ role: 'assistant', content: JSON.stringify(parsed) });
        messages.push({ role: 'user', content: `${resStr}\n\nUpdate your scratchpad or finalize_refactoring.` });
      } else if (action === 'propose_new_topic_split') {
        const topicName = props.topic_name || props.title || '';
        const reason = props.reason || props.explanation || '';
        const initialSummary = props.initial_summary || props.summary || '';
        if (topicName) {
          proposedTopicSplits.push({ topicName, reason, initialSummary });
          scratchpadLog.push({ step: iteration + 1, title: `Proposed New Topic Split: "${topicName}"`, content: reason });
        }
        messages.push({ role: 'assistant', content: JSON.stringify(parsed) });
        messages.push({ role: 'user', content: `Proposed new topic split "${topicName}" recorded. Proceed with finalize_refactoring.` });
      } else if (action === 'search_topic_notes' || action === 'find_notes') {
        const query = (props.query || '').toLowerCase();
        const matches = (typeof manifest !== 'undefined' ? manifest : []).filter(n => {
          if (!n || n.id === note?.id) return false;
          const matchTitle = (n.title || '').toLowerCase().includes(query);
          const matchTags = (n.major_topic_tags || []).some(t => t.toLowerCase().includes(query)) || (n.group_tags || []).some(t => t.toLowerCase().includes(query));
          return matchTitle || matchTags;
        }).slice(0, 3);

        const resultStr = matches.length
          ? matches.map(m => `- Note [${m.id}]: "${m.title}" (${m.date}) - Summary: ${m.summary || '(no summary)'}`).join('\n')
          : 'No additional notes found matching query.';

        scratchpadLog.push({ step: iteration + 1, title: `Searched Topic Notes ("${query}")`, content: `Found ${matches.length} matching related notes.` });
        messages.push({ role: 'assistant', content: JSON.stringify(parsed) });
        messages.push({ role: 'user', content: `Search Results:\n${resultStr}\n\nUpdate your scratchpad or finalize_refactoring.` });
      } else if (action === 'read_note_detail') {
        const targetId = props.note_id || props.id || '';
        let detailContent = 'Note not found';
        const found = (typeof manifest !== 'undefined' ? manifest : []).find(n => n && (n.id === targetId || n.path === targetId));
        if (found && typeof StorageAPI !== 'undefined' && StorageAPI.readNoteContent) {
          try {
            const rawContent = await StorageAPI.readNoteContent(found.path);
            const parsedNote = parseNoteHTML(rawContent);
            detailContent = parsedNote.mainHTML || rawContent;
          } catch (_e) {
            detailContent = found.summary || 'Could not load note content';
          }
        }
        scratchpadLog.push({ step: iteration + 1, title: `Read Note Detail [${targetId}]`, content: `Loaded context for note "${found?.title || targetId}".` });
        messages.push({ role: 'assistant', content: JSON.stringify(parsed) });
        messages.push({ role: 'user', content: `Note Content for [${targetId}]:\n${this.truncateTextForLLM(detailContent, 2000)}\n\nUpdate your scratchpad or finalize_refactoring.` });
      } else if (action === 'get_active_decisions') {
        const majorScope = props.major_topic || (majorTags[0] || '');
        const decs = [];
        if (typeof getAllMetadataDecisionEntries === 'function') {
          const all = getAllMetadataDecisionEntries();
          all.filter(d => d.status === 'active' && (!majorScope || (d.major_topic_tags || []).includes(majorScope))).forEach(d => decs.push(`- ${d.text} (Impact: ${d.impact || 'standard'})`));
        }
        const decStr = decs.length ? decs.join('\n') : 'No additional active decisions recorded.';
        scratchpadLog.push({ step: iteration + 1, title: `Fetched Active Decisions (${majorScope || 'all'})`, content: `Retrieved ${decs.length} decisions.` });
        messages.push({ role: 'assistant', content: JSON.stringify(parsed) });
        messages.push({ role: 'user', content: `Decisions in scope:\n${decStr}\n\nUpdate your scratchpad or finalize_refactoring.` });
      } else if (action === 'update_scratchpad') {
        scratchpad = props.scratchpad_content || scratchpad;
        scratchpadLog.push({ step: iteration + 1, title: t('refactor.stepScratchpad') || 'Scratchpad Updated', content: props.findings || props.scratchpad_content || 'Refined outline and structure.' });
        messages.push({ role: 'assistant', content: JSON.stringify(parsed) });
        messages.push({ role: 'user', content: `Scratchpad updated. Now generate finalize_refactoring with proposal_a_html, proposal_b_html, and meeting_summary_html.` });
      } else if (action === 'finalize_refactoring') {
        const rawMeetingSummary = props.meeting_summary_html || props.summary_html || props.meeting_summary || props.general_comment || props.summary || '';
        let meetingSummaryClean = (typeof cleanMeetingSummaryHtml === 'function') ? cleanMeetingSummaryHtml(rawMeetingSummary, currentUserName) : rawMeetingSummary;
        if (!meetingSummaryClean && (props.proposal_a_html || props.proposal_a)) {
          const pA = props.proposal_a_html || props.proposal_a || '';
          const match = pA.match(/<h[2-4][^>]*>(?:Summary|Résumé|Zusammenfassung|Resumen|Sommario)[^<]*<\/h[2-4]>([\s\S]*?)(?=<h[2-4]|$)/i);
          if (match && match[1] && typeof cleanMeetingSummaryHtml === 'function') {
            meetingSummaryClean = cleanMeetingSummaryHtml(match[1], currentUserName);
          }
        }
        const proposedWorkstreams = Array.isArray(props.proposed_workstreams)
          ? props.proposed_workstreams
          : (Array.isArray(props.workstreams) ? props.workstreams : (typeof props.proposed_workstream === 'string' && props.proposed_workstream ? [props.proposed_workstream] : []));
        const proposedGroup = props.proposed_group || props.group || null;
        const proposedTopic = props.proposed_topic || props.topic || null;
        const tagChangeReason = props.tag_change_reason || props.tags_reason || props.workstream_reason || '';
        const questions = Array.isArray(props.questions) ? props.questions : [];

        proposalsResult = {
          proposalA: cleanRefactoredProposalHtml(props.proposal_a_html || props.proposal_a || '', currentUserName),
          proposalB: cleanRefactoredProposalHtml(props.proposal_b_html || props.proposal_b || '', currentUserName),
          meetingSummary: meetingSummaryClean,
          meetingSummaryA: (typeof cleanMeetingSummaryHtml === 'function') ? cleanMeetingSummaryHtml(props.proposal_a_summary_html || meetingSummaryClean, currentUserName) : meetingSummaryClean,
          meetingSummaryB: (typeof cleanMeetingSummaryHtml === 'function') ? cleanMeetingSummaryHtml(props.proposal_b_summary_html || meetingSummaryClean, currentUserName) : meetingSummaryClean,
          rationale: cleanRefactoredProposalHtml(props.summary_rationale || '', currentUserName),
          proposedDecisionsA: props.proposed_decisions || [],
          proposedTodosA: props.proposed_todos || [],
          proposedColleaguesA: props.proposed_colleagues || [],
          proposedNotesA: props.proposed_notes || [],
          proposedDecisionsB: props.proposed_decisions_b || props.proposed_decisions || [],
          proposedTodosB: props.proposed_todos_b || props.proposed_todos || [],
          proposedColleaguesB: props.proposed_colleagues_b || props.proposed_colleagues || [],
          proposedNotesB: props.proposed_notes_b || props.proposed_notes || [],
          proposedWorkstreams,
          proposedGroup,
          proposedTopic,
          tagChangeReason,
          questions
        };
        scratchpadLog.push({ step: iteration + 1, title: t('refactor.stepFinalized') || 'Proposals Finalized', content: props.summary_rationale || 'Generated Executive (A) and Comprehensive (B) proposals.' });
        completed = true;
      }
    }

    if (!proposalsResult) {
      if (typeof options.onProgress === 'function') {
        options.onProgress(85, t('refactor.stepFinalized') || 'Génération des propositions...');
      }
      const fallbackPrompt = `Please now output the final refactored proposals in strict JSON:
{"action": "finalize_refactoring", "properties": {"proposal_a_html": "<p>...</p>", "proposal_b_html": "<p>...</p>", "meeting_summary_html": "<p>...</p><ul><li>...</li></ul>", "summary_rationale": "..."}}`;
      messages.push({ role: 'user', content: fallbackPrompt });
      const fallbackResp = await this.chat(messages, {
        controller: options.controller,
        timeoutMs: 0,
        reasoningEffort
      });
      const parsedFallbackInfo = fallbackResp.parsed ? { parsed: fallbackResp.parsed } : this.extractJsonPayloadFromText(fallbackResp.reply);
      const parsedFallback = parsedFallbackInfo?.parsed || {};
      const p = parsedFallback?.properties || parsedFallback || {};
      const rawMeetingSummaryFallback = p.meeting_summary_html || p.summary_html || p.meeting_summary || p.general_comment || p.summary || '';
      let meetingSummaryCleanFallback = (typeof cleanMeetingSummaryHtml === 'function') ? cleanMeetingSummaryHtml(rawMeetingSummaryFallback, currentUserName) : rawMeetingSummaryFallback;
      if (!meetingSummaryCleanFallback && (p.proposal_a_html || p.proposal_a)) {
        const pA = p.proposal_a_html || p.proposal_a || '';
        const match = pA.match(/<h[2-4][^>]*>(?:Summary|Résumé|Zusammenfassung|Resumen|Sommario)[^<]*<\/h[2-4]>([\s\S]*?)(?=<h[2-4]|$)/i);
        if (match && match[1] && typeof cleanMeetingSummaryHtml === 'function') {
          meetingSummaryCleanFallback = cleanMeetingSummaryHtml(match[1], currentUserName);
        }
      }
      const proposedWorkstreamsFallback = Array.isArray(p.proposed_workstreams)
        ? p.proposed_workstreams
        : (Array.isArray(p.workstreams) ? p.workstreams : (typeof p.proposed_workstream === 'string' && p.proposed_workstream ? [p.proposed_workstream] : []));
      const proposedGroupFallback = p.proposed_group || p.group || null;
      const proposedTopicFallback = p.proposed_topic || p.topic || null;
      const tagChangeReasonFallback = p.tag_change_reason || p.tags_reason || p.workstream_reason || '';
      const questionsFallback = Array.isArray(p.questions) ? p.questions : [];

      proposalsResult = {
        proposalA: cleanRefactoredProposalHtml(p.proposal_a_html || p.proposal_a || `<p><strong>${note?.title || 'Note'}</strong></p><p>${noteContent.replace(/\n/g, '<br>')}</p>`, currentUserName),
        proposalB: cleanRefactoredProposalHtml(p.proposal_b_html || p.proposal_b || `<p><strong>${note?.title || 'Note'}</strong></p><p>${noteContent.replace(/\n/g, '<br>')}</p>`, currentUserName),
        meetingSummary: meetingSummaryCleanFallback,
        meetingSummaryA: meetingSummaryCleanFallback,
        meetingSummaryB: meetingSummaryCleanFallback,
        rationale: cleanRefactoredProposalHtml(p.summary_rationale || 'Direct structuring applied.', currentUserName),
        proposedDecisionsA: p.proposed_decisions || [],
        proposedTodosA: p.proposed_todos || [],
        proposedColleaguesA: p.proposed_colleagues || [],
        proposedNotesA: p.proposed_notes || [],
        proposedDecisionsB: p.proposed_decisions_b || p.proposed_decisions || [],
        proposedTodosB: p.proposed_todos_b || p.proposed_todos || [],
        proposedColleaguesB: p.proposed_colleagues_b || p.proposed_colleagues || [],
        proposedNotesB: p.proposed_notes_b || p.proposed_notes || [],
        proposedWorkstreams: proposedWorkstreamsFallback,
        proposedGroup: proposedGroupFallback,
        proposedTopic: proposedTopicFallback,
        tagChangeReason: tagChangeReasonFallback,
        questions: questionsFallback
      };
    }

    if (typeof options.onProgress === 'function') {
      options.onProgress(100, t('refactor.stepFinalized') || 'Propositions prêtes !');
    }

    return {
      status: 'proposals_ready',
      proposalA: proposalsResult.proposalA,
      proposalB: proposalsResult.proposalB,
      meetingSummary: proposalsResult.meetingSummary || '',
      meetingSummaryA: proposalsResult.meetingSummaryA || proposalsResult.meetingSummary || '',
      meetingSummaryB: proposalsResult.meetingSummaryB || proposalsResult.meetingSummary || '',
      rationale: proposalsResult.rationale,
      proposedDecisionsA: proposalsResult.proposedDecisionsA || [],
      proposedTodosA: proposalsResult.proposedTodosA || [],
      proposedColleaguesA: proposalsResult.proposedColleaguesA || [],
      proposedNotesA: proposalsResult.proposedNotesA || [],
      proposedDecisionsB: proposalsResult.proposedDecisionsB || [],
      proposedTodosB: proposalsResult.proposedTodosB || [],
      proposedColleaguesB: proposalsResult.proposedColleaguesB || [],
      proposedNotesB: proposalsResult.proposedNotesB || [],
      proposedWorkstreams: proposalsResult.proposedWorkstreams || [],
      proposedGroup: proposalsResult.proposedGroup || null,
      proposedTopic: proposalsResult.proposedTopic || null,
      tagChangeReason: proposalsResult.tagChangeReason || '',
      questions: proposalsResult.questions || [],
      scratchpad,
      scratchpadLog,
      topicMemories,
      proposedTopicSplits
    };
  },

  async refineAmendedProposal(note, originalNoteContent, userAmendedHtml, feedback, options = {}) {
    const cfg = this.ensureReadyForCalls();
    const activeLang = (settings.ai && settings.ai.language && settings.ai.language !== 'auto') ? settings.ai.language : (typeof getAppLanguage === 'function' ? getAppLanguage() : 'en');
    const reasoningEffort = options.reasoningEffort || 'high';

    const currentUserName = (typeof settings !== 'undefined' && settings && settings.username) ? settings.username : (typeof getDefaultMeLabel === 'function' ? getDefaultMeLabel() : 'Me');
    const extractedImages = await this.extractNoteImageUrls(note, originalNoteContent, options);
    const userTextPrompt = `RAW NOTE ORIGINAL CONTENT:
${originalNoteContent}

USER AMENDED PROPOSAL DRAFT:
${userAmendedHtml}

USER SPECIFIC INSTRUCTIONS / FEEDBACK:
${feedback || 'Please re-perfect this draft while preserving all my edits.'}`;

    let userMessageContent = userTextPrompt;
    if (extractedImages && extractedImages.length > 0) {
      userMessageContent = [
        { type: 'text', text: userTextPrompt },
        ...extractedImages.map(url => ({
          type: 'image_url',
          image_url: { url }
        }))
      ];
    }

    const messages = [
      {
        role: 'system',
        content: (typeof AppPrompts !== 'undefined' && AppPrompts.buildRefinePerfectNotePrompt)
          ? AppPrompts.buildRefinePerfectNotePrompt({
              targetLang: activeLang,
              currentUserName
            })
          : `You are Secretary's Note Refactoring & Structuring Agent.`
      },
      {
        role: 'user',
        content: userMessageContent
      }
    ];

    const response = await this.chat(messages, {
      controller: options.controller,
      timeoutMs: 0,
      reasoningEffort
    });

    let parsed = response.parsed;
    if (!parsed && response.reply) {
      const parsedInfo = this.extractJsonPayloadFromText(response.reply);
      parsed = parsedInfo?.parsed || null;
    }
    const props = parsed?.properties || parsed || {};
    const rawMeetingSummary = props.meeting_summary_html || props.summary_html || props.meeting_summary || props.general_comment || props.summary || '';
    return {
      proposalC: cleanRefactoredProposalHtml(props.proposal_c_html || props.proposal_a_html || response.reply || userAmendedHtml, currentUserName),
      meetingSummary: (typeof cleanMeetingSummaryHtml === 'function') ? cleanMeetingSummaryHtml(rawMeetingSummary, currentUserName) : rawMeetingSummary,
      rationale: cleanRefactoredProposalHtml(props.summary_rationale || 'Refined based on user amendments.', currentUserName)
    };
  },

  async generateOptionCWithFeedback(note, noteContent, scratchpad, feedback, options = {}) {
    const cfg = this.ensureReadyForCalls();
    const activeLang = (settings.ai && settings.ai.language && settings.ai.language !== 'auto') ? settings.ai.language : (typeof getAppLanguage === 'function' ? getAppLanguage() : 'en');
    const reasoningEffort = options.reasoningEffort || 'high';
    const currentUserName = (typeof settings !== 'undefined' && settings && settings.username) ? settings.username : (typeof getDefaultMeLabel === 'function' ? getDefaultMeLabel() : 'Me');

    const extractedImages = await this.extractNoteImageUrls(note, noteContent, options);
    const rawNoteTextPrepared = this.prepareNoteContentForLLM(noteContent);
    let openTodosContext = '';
    if (typeof todosManifest !== 'undefined' && Array.isArray(todosManifest)) {
      const open = todosManifest.filter(t => t && t.priority !== 'Done');
      if (open.length > 0) {
        openTodosContext = '\n\nACTIVE OPEN TODOS IN WORKSPACE:\n' + open.map(t => `- [ID: ${t.id}] "${t.title}" (@${t.owner || 'me'}, Priority: ${t.priority || 'Medium'})`).join('\n');
      }
    }

    const userPromptText = `RAW NOTE CONTENT:
${rawNoteTextPrepared}

AGENT SCRATCHPAD LOG & KNOWLEDGE:
${scratchpad}
${openTodosContext}

USER FEEDBACK:
${feedback}`;

    let userMessageContent = userPromptText;
    if (extractedImages && extractedImages.length > 0) {
      userMessageContent = [
        { type: 'text', text: userPromptText },
        ...extractedImages.map(url => ({
          type: 'image_url',
          image_url: { url }
        }))
      ];
    }

    const messages = [
      {
        role: 'system',
        content: (typeof AppPrompts !== 'undefined' && AppPrompts.buildOptionCWithFeedbackPrompt)
          ? AppPrompts.buildOptionCWithFeedbackPrompt({
              targetLang: activeLang,
              currentUserName,
              feedback
            })
          : `You are Secretary's elite Note Refactoring Agent.
The user declined proposals A and B and provided specific instructions for Option C.
Current Active User is "${currentUserName}". Format user mentions as '@${currentUserName}' or 'me', NEVER '@User'.
Do NOT include square bracketed urgency tags like '[Urgent]', '[High]', '[Medium]', '[Low]' in the HTML text.

USER FEEDBACK / INSTRUCTIONS:
"${feedback}"

STRICT GUIDELINES:
1. Re-structure the note following the user's specific desires (e.g. more concise, more bullet points, chronological flow, highlight specific parts).
2. NEVER INVENT FACTS: Preserve authentic facts from the note and scratchpad.
3. Clean semantic HTML: <h3>, <p>, <ul>, <li>, <strong>, <em>, <mark>, @Colleague. Use <mark>...</mark> VERY SPARINGLY (max 2-4 key takeaways per note), never highlight entire paragraphs or list items. Format list items directly as <li>...</li> without inner <p>/<div> wrappers, without internal <br>, and without bullet markers (-/*).
4. MANDATORY: Preserve informal notes and personal updates (e.g. colleague life events, family news) under <h2>Informal Notes</h2>.
5. INLINE IMAGES: If the note contains image markers (e.g. [IMAGE_1]), place them in appropriate locations inside Proposal C where the visual belongs.
6. Generate a structured meeting summary ('meeting_summary_html') without section headers.
7. TASK DEDUPLICATION & LINKING: Check the active open todos list. Do NOT propose duplicate tasks in 'proposed_todos' if an item is already on the board. Instead, link to existing tasks in the note HTML under <h2>Next Steps & Action Items</h2> using <a href="#todo-\${id}" class="note-todo-link" data-todo-id="\${id}" title="\${title}">📋 \${title}</a>. Only include genuinely new action items in 'proposed_todos'.
8. Output STRICT RAW JSON: {"proposal_c_html": "<p>...</p>", "meeting_summary_html": "<p>...</p><ul><li>...</li></ul>", "summary_rationale": "Explanation of changes made in response to user feedback.", "proposed_decisions": [{"text": "Decision statement", "status": "active"}], "proposed_todos": [{"title": "Task title", "owner": "ColleagueName", "importance": "High", "urgency": "Medium"}], "proposed_colleague_links": ["ColleagueName"], "proposed_note_links": [{"title": "Note Title"}]}
Do NOT wrap in markdown codeblocks (no \`\`\`json). Do NOT add text before or after the JSON. Ensure all HTML quotes and newlines inside the JSON string values are properly escaped.`
      },
      {
        role: 'user',
        content: userMessageContent
      }
    ];

    const response = await this.chat(messages, {
      controller: options.controller,
      timeoutMs: 0,
      reasoningEffort
    });

    let parsed = response.parsed;
    if (!parsed && response.reply) {
      const parsedInfo = this.extractJsonPayloadFromText(response.reply);
      parsed = parsedInfo?.parsed || null;
    }
    const props = parsed?.properties || parsed || {};
    const rawMeetingSummaryC = props.meeting_summary_html || props.summary_html || props.meeting_summary || props.general_comment || props.summary || '';

    return {
      proposalC: cleanRefactoredProposalHtml(props.proposal_c_html || props.proposal_c || props.proposalC || props.proposal_html || props.html || '', currentUserName),
      meetingSummary: (typeof cleanMeetingSummaryHtml === 'function') ? cleanMeetingSummaryHtml(rawMeetingSummaryC, currentUserName) : rawMeetingSummaryC,
      rationale: cleanRefactoredProposalHtml(props.summary_rationale || 'Synthesized custom proposal based on user feedback.', currentUserName),
      proposedDecisions: Array.isArray(props.proposed_decisions) ? props.proposed_decisions : [],
      proposedTodos: Array.isArray(props.proposed_todos) ? props.proposed_todos : [],
      proposedColleagues: Array.isArray(props.proposed_colleague_links) ? props.proposed_colleague_links : [],
      proposedNotes: Array.isArray(props.proposed_note_links) ? props.proposed_note_links : []
    };
  },

  async generateWorkstreamClarifyingQuestions(topicName, context = {}) {
    const aiSettings = (typeof settings !== 'undefined' && settings.ai) ? settings.ai : {};
    let targetLang = (aiSettings.language && aiSettings.language !== 'auto') ? aiSettings.language : 'auto';
    if (targetLang === 'auto') {
      const sampleText = ((topicName || '') + ' ' + (context.notes || []).map(n => (n.title || '') + ' ' + (n.summary || '') + ' ' + (n.contentSnippet || '')).join(' ') + ' ' + (context.userPrompt || ''));
      targetLang = (typeof detectTextLanguage === 'function')
        ? detectTextLanguage(sampleText, typeof getAppLanguage === 'function' ? getAppLanguage() : 'en')
        : (typeof getAppLanguage === 'function' ? getAppLanguage() : 'en');
    }

    const recentNotes = (context.notes || []).slice(0, 10);
    const candidateTitles = recentNotes.map(n => n.title).filter(Boolean);
    const decisionsCount = (context.decisions || []).length;
    const tasksCount = (context.tasks || []).length;

    const langPack = (typeof getLanguagePack === 'function') ? getLanguagePack(targetLang) : (typeof APP_LANGUAGE_PACKS !== 'undefined' ? APP_LANGUAGE_PACKS[targetLang] : null);
    const getTr = (key, fallback) => {
      const val = langPack ? getNestedValue(langPack, key) : null;
      return val || (typeof t === 'function' ? t(key, fallback) : fallback);
    };

    // Default intelligent scoping questions localized to target AI language
    const fallbackQuestions = [
      {
        id: 'scope_focus',
        question: getTr('workstream.scopeQuestionFocus', `Which core dimensions should define the scope of "${topicName}"?`),
        multiSelect: true,
        options: [
          { id: 'deliverables', label: getTr('workstream.optDeliverables', 'Key deliverables, milestones & active deadlines'), selectedByDefault: true },
          { id: 'decisions_impact', label: getTr('workstream.optDecisions', 'Strategic decisions taken & their direct impacts'), selectedByDefault: true },
          { id: 'dependencies', label: getTr('workstream.optDependencies', 'Cross-workstream dependencies & external blockers'), selectedByDefault: true },
          { id: 'stakeholders', label: getTr('workstream.optStakeholders', 'Key stakeholders, ownership & team governance'), selectedByDefault: false }
        ]
      },
      {
        id: 'scope_boundaries',
        question: getTr('workstream.scopeQuestionBoundaries', 'How should historical context and boundaries be recorded?'),
        multiSelect: true,
        options: [
          { id: 'explicit_non_goals', label: getTr('workstream.optNonGoals', 'Define explicit Out-of-Scope / Non-Goals to avoid scope creep'), selectedByDefault: true },
          { id: 'include_escalations', label: getTr('workstream.optEscalations', 'Document past escalations, critical incidents & resolved conflicts'), selectedByDefault: true },
          { id: 'strict_recent', label: getTr('workstream.optRecentOnly', 'Focus primarily on recent notes from the last 30 days'), selectedByDefault: false }
        ]
      }
    ];

    if (!this.isEnabled()) {
      return { isAiGenerated: false, questions: fallbackQuestions };
    }

    try {
      const sysContent = (typeof AppPrompts !== 'undefined' && AppPrompts.buildScopingQuestionsSystemPrompt)
        ? AppPrompts.buildScopingQuestionsSystemPrompt({ targetLang })
        : `You are an expert strategic project scoping assistant. Respond strictly in JSON format.`;

      const prompt = (typeof AppPrompts !== 'undefined' && AppPrompts.buildScopingQuestionsPrompt)
        ? AppPrompts.buildScopingQuestionsPrompt({ targetLang, topicName, candidateTitles, decisionsCount, tasksCount })
        : `You are the Secretary AI agent. The user is configuring the Workstream "${topicName}".`;

      const res = await this.chat([
        { role: 'system', content: sysContent },
        { role: 'user', content: prompt }
      ], { temperature: 0.2 });

      let parsed = res?.parsed;
      if (!parsed && res?.reply) {
        const parsedInfo = this.extractJsonPayloadFromText(res.reply);
        parsed = parsedInfo?.parsed || null;
      }
      if (parsed && Array.isArray(parsed.questions) && parsed.questions.length > 0) {
        return { isAiGenerated: true, questions: parsed.questions };
      }
    } catch (_err) {
      console.warn('Clarifying questions generation failed, using fallback:', _err);
    }

    return { isAiGenerated: false, questions: fallbackQuestions };
  },

  async synthesizeWorkstreamMemory(topicName, context = {}) {
    if (!this.isEnabled()) return null;

    const notesSummaryStr = (context.notes || []).map((n, i) => `--- Note ${i+1}: "${n.title}" (ID: ${n.id}, Path: ${n.path || ''}, Date: ${n.date || 'N/A'}) ---
Tags: Major: ${(n.tags?.major || []).join(', ') || 'None'} | Group: ${(n.tags?.group || []).join(', ') || 'None'} | Topic: ${(n.tags?.topic || []).join(', ') || 'None'}
Summary: ${n.summary || 'No summary available.'}
${n.contentSnippet ? `Content Excerpt:\n${n.contentSnippet}` : ''}`).join('\n\n');

    const decisionsStr = (context.decisions || []).map(d => `- [${d.status || 'active'}] ${d.text || d.title || ''} (Impact: ${d.impact || 'normal'})`).join('\n');
    const tasksStr = (context.tasks || []).map(t => `- [${t.completed ? 'completed' : 'pending'}] ${t.title || t.text || ''} ${t.dueDate ? `(Due: ${t.dueDate})` : ''}`).join('\n');
    const eventsStr = (context.events || []).map(e => `- [${(e.type || 'event').toUpperCase()}] "${e.title}" (Date: ${e.date || 'N/A'}${e.startTime ? ' ' + e.startTime : ''})${e.collaborators?.length ? ' With: @' + e.collaborators.join(', @') : ''}${e.context ? ` | Context/Purpose: "${e.context}"` : ''}`).join('\n');
    const synthesisMode = context.synthesisMode || (context.existingMemory ? 'incremental' : 'reset');
    const isReset = synthesisMode === 'reset' || synthesisMode === 'scratch' || synthesisMode === 'start_0';

    const existingStr = (!isReset && context.existingMemory) ? JSON.stringify(context.existingMemory, null, 2) : 'None (Start from 0)';
    const userPromptStr = context.userPrompt ? `User instructions / initial prompt: "${context.userPrompt}"` : '';
    const userScopeStr = context.userScopeAnswers ? `User Scope Clarifications & Refinements:\n${typeof context.userScopeAnswers === 'string' ? context.userScopeAnswers : JSON.stringify(context.userScopeAnswers, null, 2)}` : '';
    const scratchpadStr = (!isReset && context.existingMemory?.scratchpad) ? `Existing Agent Scratchpad Memory:\n${context.existingMemory.scratchpad}` : '';
    const modeHeader = isReset
      ? `MODE: START FROM 0 (Clean slate synthesis - ignore previous dossier state)`
      : `MODE: INCREMENTAL UPDATE (Use current state as baseline & review against notes)`;

    const aiSettings = (typeof settings !== 'undefined' && settings.ai) ? settings.ai : {};
    let targetLang = (aiSettings.language && aiSettings.language !== 'auto') ? aiSettings.language : 'auto';
    if (targetLang === 'auto') {
      const sampleText = ((topicName || '') + ' ' + (context.notes || []).map(n => (n.title || '') + ' ' + (n.summary || '') + ' ' + (n.contentSnippet || '')).join(' ') + ' ' + (context.userPrompt || ''));
      targetLang = (typeof detectTextLanguage === 'function')
        ? detectTextLanguage(sampleText, typeof getAppLanguage === 'function' ? getAppLanguage() : 'en')
        : (typeof getAppLanguage === 'function' ? getAppLanguage() : 'en');
    }

    const langName = (typeof APP_LANGUAGE_NAMES !== 'undefined' && APP_LANGUAGE_NAMES[targetLang]) ? APP_LANGUAGE_NAMES[targetLang] : (targetLang === 'fr' ? 'French' : targetLang === 'de' ? 'German' : targetLang === 'es' ? 'Spanish' : targetLang === 'it' ? 'Italian' : 'English');

    const systemPrompt = (typeof AppPrompts !== 'undefined' && AppPrompts.buildWorkstreamMemorySystemPrompt)
      ? AppPrompts.buildWorkstreamMemorySystemPrompt({ targetLang, topicName })
      : `You are the Secretary AI agent specializing in strategic knowledge management, project scoping, and Workstream memory synthesis.`;

    const userMsg = (typeof AppPrompts !== 'undefined' && AppPrompts.buildWorkstreamMemoryUserPrompt)
      ? AppPrompts.buildWorkstreamMemoryUserPrompt({
          targetLang,
          topicName,
          userPromptStr,
          userScopeStr,
          scratchpadStr,
          existingStr,
          decisionsStr,
          tasksStr,
          eventsStr,
          notesSummaryStr,
          notesCount: (context.notes || []).length
        })
      : `Workstream: "${topicName}"\nGenerate the complete structured JSON memory dossier...`;

    try {
      const response = await this.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMsg }
      ], { temperature: 0.2, signal: context.signal });

      if (response && response.reasoningText && typeof context.onProgress === 'function') {
        try { context.onProgress('thinking', { thinkingText: response.reasoningText }); } catch (_e) {}
      }

      let parsed = response.parsed;
      if (!parsed && response.reply) {
        const parsedInfo = this.extractJsonPayloadFromText(response.reply);
        parsed = parsedInfo?.parsed || null;
      }
      if (!parsed && response.reply) {
        try {
          const cleanJson = response.reply.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
          parsed = JSON.parse(cleanJson);
        } catch (_e) {}
      }
      const props = parsed?.properties || parsed || {};

      // Normalize summary and scratchpad to guarantee clean HTML
      const convertMdToHtmlIfNeeded = (text) => {
        if (!text || typeof text !== 'string') return '';
        let s = text.trim();
        s = s.replace(/^```(?:html|markdown)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
        const hasHtmlTags = /<[a-z][\s\S]*>/i.test(s);
        if (!hasHtmlTags) {
          if (typeof marked !== 'undefined' && typeof marked.parse === 'function') {
            return marked.parse(s).trim();
          }
          const escFn = typeof escH === 'function' ? escH : (str => String(str || ''));
          return `<p>${escFn(s).replace(/\n\n+/g, '</p><p>').replace(/\n/g, '<br>')}</p>`;
        }
        return s;
      };

      if (props.summary) {
        props.summary = convertMdToHtmlIfNeeded(props.summary);
      }
      if (props.scratchpad) {
        props.scratchpad = convertMdToHtmlIfNeeded(props.scratchpad);
      }
      if (!props.oneSentenceSummary && props.summary) {
        const plain = props.summary.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        props.oneSentenceSummary = plain.split(/(?<=[.!?])\s+/)[0].trim();
      } else if (props.oneSentenceSummary) {
        props.oneSentenceSummary = props.oneSentenceSummary.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      }

      return props;
    } catch (_err) {
      console.warn('Failed to synthesize workstream memory via LLM:', _err);
      return null;
    }
  }
};

function llmText(key, fallback, params = {}) {
  const value = typeof t === 'function' ? t(key, params) : '';
  return (!value || value === key) ? fallback : value;
}

function getPromptThinkingEffortStorage() {
  if (!window._promptThinkingEffortByScope || typeof window._promptThinkingEffortByScope !== 'object') {
    try {
      window._promptThinkingEffortByScope = JSON.parse(localStorage.getItem('secretaryPromptThinkingEffortByScope') || '{}') || {};
    } catch (_err) {
      window._promptThinkingEffortByScope = {};
    }
  }
  return window._promptThinkingEffortByScope;
}

function savePromptThinkingEffortStorage() {
  try {
    localStorage.setItem('secretaryPromptThinkingEffortByScope', JSON.stringify(getPromptThinkingEffortStorage()));
  } catch (err) {
    console.warn('Could not persist prompt thinking effort storage', err);
  }
}

function getPromptThinkingEffortScopeKey(scopeType, scopeId) {
  const kind = String(scopeType || 'note').trim().toLowerCase() === 'chat' ? 'chat' : 'note';
  const id = String(scopeId || 'global').trim() || 'global';
  return `${kind}:${id}`;
}

function getPromptThinkingEffortScopeKeyForEditor(note = currentNote) {
  return getPromptThinkingEffortScopeKey('note', getAiStateKey(note));
}

function getPromptThinkingEffortScopeKeyForChat(conversationId) {
  return getPromptThinkingEffortScopeKey('chat', conversationId || (typeof AIChatController !== 'undefined' && AIChatController ? AIChatController.currentConversationId : 'global'));
}

function supportsThinkingEffort(provider = undefined) {
  const normalizedProvider = String(provider !== undefined ? provider : (settings.ai || {}).provider || '').trim().toLowerCase();
  return normalizedProvider === 'custom' || normalizedProvider === 'lmstudio';
}

function normalizeThinkingEffortValue(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'off' || raw === 'no' || raw === 'none' || raw === 'disabled' || raw === 'false' || raw === '0') return 'off';
  if (raw === 'low') return 'low';
  if (raw === 'mid' || raw === 'medium') return 'medium';
  if (raw === 'high') return 'high';
  return 'high';
}

function getThinkingEffortOptions() {
  return [
    { value: 'off', label: llmText('llm.thinkingEffortOff', 'No') },
    { value: 'low', label: llmText('llm.thinkingEffortLow', 'Low') },
    { value: 'medium', label: llmText('llm.thinkingEffortMedium', 'Mid') },
    { value: 'high', label: llmText('llm.thinkingEffortHigh', 'High') },
  ];
}

function getStoredPromptThinkingEffort(scopeKey, fallback = 'high') {
  const stored = getPromptThinkingEffortStorage()[scopeKey];
  if (stored !== undefined && stored !== null && String(stored).trim() !== '') {
    return normalizeThinkingEffortValue(stored);
  }
  return normalizeThinkingEffortValue(fallback);
}

function setStoredPromptThinkingEffort(scopeKey, value) {
  const normalized = normalizeThinkingEffortValue(value);
  const storage = getPromptThinkingEffortStorage();
  storage[scopeKey] = normalized;
  savePromptThinkingEffortStorage();
  return normalized;
}

function populateThinkingEffortSelect(selectEl, scopeKey, fallback = 'high') {
  if (!selectEl) return;
  selectEl.innerHTML = getThinkingEffortOptions()
    .map((option) => `<option value="${escA(option.value)}">${escH(option.label)}</option>`)
    .join('');
  selectEl.value = getStoredPromptThinkingEffort(scopeKey, fallback);
}

function getDefaultThinkingEffortValue() {
  const aiSettings = settings.ai || {};
  return normalizeThinkingEffortValue(aiSettings.reasoningEffort || aiSettings.thinkingEffort || 'high');
}

function setPromptThinkingEffort(scopeType, value, scopeId = undefined) {
  const scopeKey = String(scopeType || 'note').trim().toLowerCase() === 'chat'
    ? getPromptThinkingEffortScopeKeyForChat(scopeId)
    : getPromptThinkingEffortScopeKeyForEditor();
  const normalized = setStoredPromptThinkingEffort(scopeKey, value);

  const selectEl = document.getElementById(String(scopeType || 'note').trim().toLowerCase() === 'chat'
    ? 'chat-thinking-effort-select'
    : 'edit-ai-thinking-effort-select');
  if (selectEl) selectEl.value = normalized;

  return normalized;
}

function getPromptThinkingEffort(selectId, scopeType = 'note', fallback = 'high') {
  const selectEl = document.getElementById(selectId);
  if (selectEl && String(selectEl.value || '').trim() !== '') {
    return normalizeThinkingEffortValue(selectEl.value);
  }
  const scopeKey = String(scopeType || 'note').trim().toLowerCase() === 'chat'
    ? getPromptThinkingEffortScopeKeyForChat()
    : getPromptThinkingEffortScopeKeyForEditor();
  return getStoredPromptThinkingEffort(scopeKey, fallback);
}

function fillReviewNotePrompt(note = currentNote) {
  const input = document.getElementById('edit-ai-lane-input');
  if (!input) return;

  const promptText = llmText(
    'llm.reviewNotePrompt',
    'Fais un résumé de la note, et propose des améliorations, corrections ou questions si nécessaire.'
  );

  input.value = promptText;
  input.focus();
  input.selectionStart = promptText.length;
  input.selectionEnd = promptText.length;
  input.style.height = 'auto';
  input.style.height = `${input.scrollHeight}px`;
}

function syncLLMEditorControls() {
  const laneTitle = document.getElementById('edit-ai-lane-title');
  if (laneTitle) laneTitle.textContent = llmText('llm.conversationTitle', 'LLM conversation');

  const closeBtn = document.getElementById('edit-ai-lane-close-btn');
  if (closeBtn) closeBtn.textContent = llmText('llm.close', 'Close');

  const reviewBtn = document.getElementById('edit-ai-review-prompt-btn');
  if (reviewBtn) {
    reviewBtn.textContent = llmText('llm.reviewNote', 'Revoir la note');
    reviewBtn.title = llmText('llm.reviewNoteTooltip', 'Insert a prompt to review this note');
    reviewBtn.onclick = () => fillReviewNotePrompt();
  }

  const effortSelect = document.getElementById('edit-ai-thinking-effort-select');
  const effortTools = document.querySelector('.edit-ai-lane-tools');
  const editorScopeKey = getPromptThinkingEffortScopeKeyForEditor();
  if (effortTools) effortTools.style.display = supportsThinkingEffort() ? '' : 'none';
  if (effortSelect && supportsThinkingEffort()) {
    populateThinkingEffortSelect(effortSelect, editorScopeKey, getDefaultThinkingEffortValue());
  }

  const input = document.getElementById('edit-ai-lane-input');
  if (input) {
    input.placeholder = llmText('llm.followUpPlaceholder', 'Ask a follow-up to local LLM...');
    if (!input._hasAutoGrowListener) {
      input._hasAutoGrowListener = true;
      input.addEventListener('input', (e) => {
        const textarea = e.target;
        textarea.style.height = 'auto';
        textarea.style.height = `${textarea.scrollHeight}px`;
      });
    }
    if (!input._hasEnterListener) {
      input._hasEnterListener = true;
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (getActiveAiRequest()) stopActiveAiRequest();
          else sendAiConversationReply();
        }
      });
    }
  }

  const sendBtn = document.getElementById('edit-ai-lane-send');
  if (sendBtn) {
    sendBtn.textContent = getActiveAiRequest() ? llmText('llm.stop', 'Stop') : llmText('llm.send', 'Send');
  }

  const suggestionsCloseBtn = document.getElementById('edit-ai-suggestions-close-btn');
  if (suggestionsCloseBtn) suggestionsCloseBtn.textContent = llmText('llm.close', 'Close');
}


function getAiLaneContainer() {
  return document.getElementById('edit-ai-lane');
}

function getAiLaneMessagesContainer() {
  return document.getElementById('edit-ai-lane-messages');
}

function getAiStateKey(note = currentNote) {
  const targetNote = note || (typeof currentNote !== 'undefined' ? currentNote : null);
  const key = String(targetNote?.id || targetNote?.path || targetNote?.title || 'global').trim();
  return key || 'global';
}

function getAiStateStore() {
  if (!window._llmStateByNote || typeof window._llmStateByNote !== 'object') {
    window._llmStateByNote = {};
  }
  return window._llmStateByNote;
}

function getAiState(note = currentNote) {
  const key = getAiStateKey(note);
  const store = getAiStateStore();
  if (!store[key]) {
    store[key] = {
      conversationTurns: [],
      lastPayload: null,
      proposalCards: [],
      proposalStates: [],
      activeRequest: null
    };
  }
  return store[key];
}

function getActiveAiRequest(note = currentNote) {
  const state = getAiState(note);
  return state.activeRequest || null;
}

function setActiveAiRequest(note = currentNote, request = null) {
  const state = getAiState(note);
  state.activeRequest = request ? { ...request } : null;
  updateAiRequestControls(note);
  return state.activeRequest;
}

function clearActiveAiRequest(note = currentNote) {
  const state = getAiState(note);
  state.activeRequest = null;
  updateAiRequestControls(note);
}

function stopActiveAiRequest(note = currentNote) {
  const activeRequest = getActiveAiRequest(note);
  if (!activeRequest || !activeRequest.controller) return;

  activeRequest.thinkingMessage = llmText('llm.stopping', 'Stopping...');
  updateAiRequestControls(note);
  if (isSameAiNote(note)) {
    renderAiConversationLane(note);
  }

  try {
    activeRequest.controller.abort();
  } catch (err) {
    console.warn('Could not abort active AI request', err);
  }
}

function updateAiRequestControls(note = currentNote) {
  const active = !!getActiveAiRequest(note);

  const sendBtn = document.getElementById('edit-ai-lane-send');
  if (sendBtn) {
    sendBtn.textContent = active ? llmText('llm.stop', 'Stop') : llmText('llm.send', 'Send');
    sendBtn.onclick = active ? () => stopActiveAiRequest(note) : () => sendAiConversationReply();
  }
}

function isSameAiNote(noteA, noteB = currentNote) {
  return getAiStateKey(noteA) === getAiStateKey(noteB);
}

function ensurePreviewPaneOpen() {}

function mountAiConversationLaneInInspector() {}

function unmountAiLane() {}

function openAiConversationInInspector() {
  if (typeof toggleFloatingChat === 'function') {
    const el = document.getElementById('floating-secretary-chat');
    if (!el || !el.classList.contains('is-open')) {
      toggleFloatingChat();
    }
  }
}

function getAiConversationTurns(note = currentNote) {
  return getAiState(note).conversationTurns;
}

function tryNormalizeParsedPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const actions = Array.isArray(payload.suggested_actions) ? payload.suggested_actions : [];
  const normalized = {
    general_comment: normalizeHighlightsToSentenceFacts(String(payload.general_comment || '').trim()),
    suggested_actions: actions
  };
  return normalized;
}

function cleanSummaryHtml(html) {
  if (!html) return '';
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const wrapper = doc.body;

    const titleKeywords = [
      'summary', 'call', 'meeting', 'résumé', 'synthese', 'synthèse', 'zusammenfassung', 
      'points', 'decisions', 'décisions', 'action', 'task', 'agenda'
    ];

    const elements = Array.from(wrapper.children);
    for (const el of elements) {
      const tag = el.tagName.toLowerCase();
      const text = el.textContent.trim().toLowerCase();
      
      const isHeading = /h[1-6]/.test(tag);
      const isStrongOnly = (tag === 'p' || tag === 'div') && el.children.length === 1 && el.firstElementChild?.tagName.toLowerCase() === 'strong';
      
      if (isHeading || isStrongOnly || tag === 'strong') {
        const match = titleKeywords.some(keyword => text.includes(keyword));
        if (match && text.length < 40) {
          el.remove();
        }
      }
    }

    let cleanHtml = wrapper.innerHTML;
    // Regex cleaning for plain text or markdown headers
    cleanHtml = cleanHtml.replace(/^(?:\s*|\*|#|-)*(?:call\s+|meeting\s+)?summary\s*:\s*/gim, '');
    cleanHtml = cleanHtml.replace(/^(?:\s*|\*|#|-)*(?:call\s+|meeting\s+)?summary\s*$/gim, '');
    cleanHtml = cleanHtml.replace(/^(?:\s*|\*|#|-)*résumé\s*:\s*/gim, '');
    cleanHtml = cleanHtml.replace(/^(?:\s*|\*|#|-)*résumé\s*$/gim, '');
    cleanHtml = cleanHtml.replace(/^(?:\s*|\*|#|-)*zusammenfassung\s*:\s*/gim, '');
    cleanHtml = cleanHtml.replace(/^(?:\s*|\*|#|-)*zusammenfassung\s*$/gim, '');
    cleanHtml = cleanHtml.replace(/^(?:\s*|\*|#|-)*main\s+points\s*:\s*/gim, '');
    cleanHtml = cleanHtml.replace(/^(?:\s*|\*|#|-)*main\s+points\s*$/gim, '');
    cleanHtml = cleanHtml.replace(/^(?:\s*|\*|#|-)*décisions?\s*:\s*/gim, '');
    cleanHtml = cleanHtml.replace(/^(?:\s*|\*|#|-)*décisions?\s*$/gim, '');
    cleanHtml = cleanHtml.replace(/^(?:\s*|\*|#|-)*decisions?\s*:\s*/gim, '');
    cleanHtml = cleanHtml.replace(/^(?:\s*|\*|#|-)*decisions?\s*$/gim, '');
    return cleanHtml.trim();
  } catch (e) {
    console.warn('Failed to clean summary HTML:', e);
    return html;
  }
}

function normalizeHighlightsToSentenceFacts(value) {
  let text = String(value || '');
  if (!text || !/<mark\b[^>]*>/i.test(text)) return text;

  const minSentenceWords = 3;
  const maxSentenceChars = 320;

  const findSentenceStart = (source, index) => {
    for (let i = index - 1; i >= 0; i--) {
      const ch = source[i];
      if (ch === '\n' || ch === '.' || ch === '!' || ch === '?' || ch === ':' || ch === ';') {
        return i + 1;
      }
      if (ch === '<') {
        const sub = source.slice(i, i + 4).toLowerCase();
        if (sub.startsWith('<p') || sub.startsWith('<li') || sub.startsWith('<ul') || sub.startsWith('<br') || sub.startsWith('<h') || sub.startsWith('<div')) {
          return i + sub.indexOf('>') + 1;
        }
      }
      if (ch === '>') {
        const openIdx = source.lastIndexOf('<', i);
        if (openIdx !== -1) {
          const sub = source.slice(openIdx, i + 1).toLowerCase();
          if (sub.startsWith('</p') || sub.startsWith('</li') || sub.startsWith('</ul') || sub.startsWith('</div') || sub.startsWith('</h')) {
            return i + 1;
          }
        }
      }
    }
    return 0;
  };

  const findSentenceEnd = (source, index) => {
    for (let i = index; i < source.length; i++) {
      const ch = source[i];
      if (ch === '\n' || ch === '.' || ch === '!' || ch === '?' || ch === ':' || ch === ';') {
        return (ch === '\n') ? i : i + 1;
      }
      if (ch === '<') {
        const sub = source.slice(i, i + 4).toLowerCase();
        if (sub.startsWith('<p') || sub.startsWith('<li') || sub.startsWith('<ul') || sub.startsWith('<br') || sub.startsWith('<h') || sub.startsWith('<div') ||
            sub.startsWith('</p') || sub.startsWith('</li') || sub.startsWith('</ul') || sub.startsWith('</div') || sub.startsWith('</h')) {
          return i;
        }
      }
    }
    return source.length;
  };

  const cleanMarkText = s => String(s || '')
    .replace(/<\/?mark\b[^>]*>/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  const countWords = s => cleanMarkText(s).split(/\s+/).filter(Boolean).length;

  const processedMarks = [];

  for (let i = 0; i < 60; i++) {
    const match = text.match(/<mark\b[^>]*>([\s\S]*?)<\/mark>/i);
    if (!match || match.index == null) break;

    const fullMatch = match[0];
    const inner = cleanMarkText(match[1]);
    const start = match.index;
    const end = start + fullMatch.length;

    if (!inner) {
      text = text.slice(0, start) + text.slice(end);
      continue;
    }

    const sentenceStart = findSentenceStart(text, start);
    const sentenceEnd = findSentenceEnd(text, end);
    const sentenceCandidate = cleanMarkText(text.slice(sentenceStart, sentenceEnd));

    const sentenceWordCount = countWords(sentenceCandidate);
    const containsInner = sentenceCandidate.toLowerCase().includes(inner.toLowerCase());
    const shouldExpand =
      sentenceCandidate &&
      containsInner &&
      sentenceCandidate.length <= maxSentenceChars &&
      sentenceWordCount >= Math.max(minSentenceWords, countWords(inner));

    let processedText = inner;
    let keepHighlight = false;
    let replaceStart = start;
    let replaceEnd = end;

    if (shouldExpand) {
      processedText = sentenceCandidate;
      keepHighlight = true;
      replaceStart = sentenceStart;
      replaceEnd = sentenceEnd;
    } else if (countWords(inner) >= minSentenceWords) {
      processedText = inner;
      keepHighlight = true;
    }

    const placeholder = `__MARK_PLACEHOLDER_${processedMarks.length}__`;
    processedMarks.push({
      placeholder,
      content: keepHighlight ? `<mark>${processedText}</mark>` : processedText
    });

    text = text.slice(0, replaceStart) + placeholder + text.slice(replaceEnd);
  }

  // Replace in reverse order so that nested placeholders resolve correctly
  for (let idx = processedMarks.length - 1; idx >= 0; idx--) {
    const item = processedMarks[idx];
    text = text.split(item.placeholder).join(item.content);
  }

  return text
    .replace(/<mark\b[^>]*>\s*<\/mark>/gi, '')
    .replace(/<\/mark>\s*<mark\b[^>]*>/gi, ' ');
}

function getLastLLMPayload(note = currentNote) {
  const payload = getAiState(note).lastPayload;
  return payload && typeof payload === 'object' ? payload : null;
}

function buildLLMSuggestionCards(payload) {
  const cards = [];
  if (!payload || typeof payload !== 'object') return cards;

  const summary = String(payload.general_comment || payload.summary || payload.comment || '').trim();
  if (summary) {
    cards.push({
      kind: 'summary',
      title: (typeof t === 'function' ? t('editor.meetingSummary') : null) || 'Meeting summary',
      body: summary,
      insertMode: 'post-call'
    });
  }

  // Gather raw actions from suggested_actions, actions, suggestions, proposed_actions
  let rawActions = [];
  const actionArrays = [
    payload.suggested_actions,
    payload.actions,
    payload.suggestions,
    payload.proposed_actions
  ];
  for (const arr of actionArrays) {
    if (Array.isArray(arr)) {
      rawActions = rawActions.concat(arr);
    }
  }

  // Gather top-level corrections
  const correctionKeys = ['text_correction', 'text_corrections', 'corrections', 'correction'];
  for (const key of correctionKeys) {
    const val = payload[key];
    if (val) {
      if (Array.isArray(val)) {
        for (const item of val) {
          if (item && typeof item === 'object') {
            if (!item.action) item.action = 'text_correction';
            rawActions.push(item);
          }
        }
      } else if (typeof val === 'object') {
        if (!val.action) val.action = 'text_correction';
        rawActions.push(val);
      }
    }
  }

  for (const action of rawActions) {
    if (!action || typeof action !== 'object') continue;

    const actionName = String(action.action || action.action_name || action.name || action.type || '').trim().toLowerCase();

    // Extract properties (nested or flat)
    let properties = {};
    const propsObj = action.properties || action.args || action.arguments || action.params || action.parameters || action.props;
    if (propsObj && typeof propsObj === 'object' && !Array.isArray(propsObj)) {
      properties = { ...propsObj };
    } else {
      // Flat structure: copy everything except metadata keys
      for (const k of Object.keys(action)) {
        if (!['action', 'action_name', 'name', 'type', 'properties', 'args', 'arguments', 'params', 'parameters', 'props'].includes(k)) {
          properties[k] = action[k];
        }
      }
    }

    if (actionName === 'text_correction' || actionName === 'text_mutation' || actionName === 'correction' || actionName === 'edit') {
      cards.push({
        kind: 'text_correction',
        action: 'text_correction',
        properties: properties,
        insertMode: 'note-text'
      });
    } else {
      let normalizedAction = action.action || action.action_name || action.name || 'unknown';
      if (actionName === 'create_todo' || actionName === 'todo') {
        normalizedAction = 'create_todo';
      } else if (actionName === 'log_decision' || actionName === 'decision') {
        normalizedAction = 'log_decision';
      }

      const card = {
        kind: 'action',
        action: normalizedAction,
        properties: properties,
        insertMode: 'post-call'
      };
      if (card.action === 'create_todo') {
        card.todoId = typeof generateTodoId === 'function'
          ? generateTodoId()
          : `ntodo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      }
      cards.push(card);
    }
  }

  return cards;
}

function highlightWordDiff(orig, repl) {
  const cleanOrig = String(orig || '');
  const cleanRepl = String(repl || '');
  const origWords = cleanOrig.split(/(\s+)/);
  const replWords = cleanRepl.split(/(\s+)/);

  const a = origWords.filter(x => x.length > 0);
  const b = replWords.filter(x => x.length > 0);

  const dp = Array(a.length + 1).fill(null).map(() => Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  let i = a.length, j = b.length;
  const aMatches = Array(a.length).fill(false);
  const bMatches = Array(b.length).fill(false);
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      aMatches[i - 1] = true;
      bMatches[j - 1] = true;
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  let origHTML = '';
  for (let k = 0; k < a.length; k++) {
    if (aMatches[k]) {
      origHTML += escH(a[k]);
    } else {
      if (a[k].trim() === '') {
        const visible = escH(a[k]).replace(/ /g, '·').replace(/\t/g, '⟶\t');
        origHTML += `<span class="diff-change-del diff-change-whitespace">${visible}</span>`;
      } else {
        origHTML += `<span class="diff-change-del">${escH(a[k])}</span>`;
      }
    }
  }

  let replHTML = '';
  for (let k = 0; k < b.length; k++) {
    if (bMatches[k]) {
      replHTML += escH(b[k]);
    } else {
      if (b[k].trim() === '') {
        const visible = escH(b[k]).replace(/ /g, '·').replace(/\t/g, '⟶\t');
        replHTML += `<span class="diff-change-ins diff-change-whitespace">${visible}</span>`;
      } else {
        replHTML += `<span class="diff-change-ins">${escH(b[k])}</span>`;
      }
    }
  }

  return { originalHTML: origHTML, replacementHTML: replHTML };
}

function parseUnifiedDiff(diffText) {
  const lines = String(diffText || '').split('\n');
  const originalLines = [];
  const replacementLines = [];

  for (const line of lines) {
    if (line.startsWith('@@') || line.startsWith('---') || line.startsWith('+++')) {
      continue;
    }
    if (line.startsWith('-')) {
      const content = line.startsWith('- ') ? line.slice(2) : line.slice(1);
      originalLines.push(content);
    } else if (line.startsWith('+')) {
      const content = line.startsWith('+ ') ? line.slice(2) : line.slice(1);
      replacementLines.push(content);
    } else {
      const content = line.startsWith(' ') ? line.slice(1) : line;
      originalLines.push(content);
      replacementLines.push(content);
    }
  }

  return {
    original: originalLines.join('\n').trim(),
    replacement: replacementLines.join('\n').trim()
  };
}

function normalizeTextCorrectionProps(props) {
  const source = props && typeof props === 'object' ? props : {};
  let target = '';
  let replacement = '';
  if (source.diff) {
    const parsed = parseUnifiedDiff(source.diff);
    target = parsed.original;
    replacement = parsed.replacement;
  } else {
    target = String(source.target_string || source.original_text || '').trim();
    replacement = String(source.replacement_text || source.corrected_text || '').trim();
  }
  const contextBefore = String(source.context_before || source.surrounding_before || '').trim();
  const contextAfter = String(source.context_after || source.surrounding_after || '').trim();
  const annotation = String(source.annotation || '').trim();
  return {
    target_string: target,
    replacement_text: replacement,
    context_before: contextBefore,
    context_after: contextAfter,
    annotation
  };
}

function getTextCorrectionPreviewMeta(card) {
  const props = normalizeTextCorrectionProps(card?.properties);
  const textarea = document.getElementById('edit-textarea');
  // Search against visible text (innerText) so the LLM's plain-text target_string matches
  const source = (textarea?.textContent || textarea?.innerText || '').replace(/\r\n/g, '\n');
  const match = findTextCorrectionMatch(source, props);
  if (!source || !match) {
    return { props, source, match: null, lineNumber: null, lineText: '' };
  }

  const lineStart = source.lastIndexOf('\n', match.index - 1) + 1;
  const lineBreakIndex = source.indexOf('\n', match.index + match.length);
  const lineEnd = lineBreakIndex === -1 ? source.length : lineBreakIndex;
  const lineText = source.slice(lineStart, lineEnd);
  const lineNumber = source.slice(0, lineStart).split('\n').length;
  return { props, source, match, lineNumber, lineText };
}

function renderTextCorrectionHTML(card) {
  const meta = getTextCorrectionPreviewMeta(card);
  const diffText = card.properties?.diff || '';
  const annotation = card.properties?.annotation || '';
  const lineLabel = meta.lineNumber ? `Line ${meta.lineNumber}` : 'Correction';

  let formattedLinesHTML = '';
  if (diffText) {
    const lines = diffText.split('\n');
    formattedLinesHTML = lines.map(line => {
      if (line.startsWith('-')) {
        return `
          <div style="display:flex;background:color-mix(in srgb, var(--danger,#dc2626) 10%, transparent);color:var(--danger,#dc2626);border-left:3px solid var(--danger,#dc2626);padding:2px 8px;align-items:flex-start;gap:8px;">
            <span style="user-select:none;width:12px;font-weight:bold;opacity:0.6;text-align:center;">-</span>
            <span style="white-space:pre-wrap;word-break:break-all;font-weight:500;">${escH(line.slice(1))}</span>
          </div>`;
      } else if (line.startsWith('+')) {
        return `
          <div style="display:flex;background:color-mix(in srgb, var(--ok,#10b981) 10%, transparent);color:var(--ok,#10b981);border-left:3px solid var(--ok,#10b981);padding:2px 8px;align-items:flex-start;gap:8px;">
            <span style="user-select:none;width:12px;font-weight:bold;opacity:0.6;text-align:center;">+</span>
            <span style="white-space:pre-wrap;word-break:break-all;font-weight:500;">${escH(line.slice(1))}</span>
          </div>`;
      } else {
        return `
          <div style="display:flex;color:var(--text-muted);padding:2px 8px 2px 11px;align-items:flex-start;gap:8px;opacity:0.85;">
            <span style="user-select:none;width:12px;"></span>
            <span style="white-space:pre-wrap;word-break:break-all;">${escH(line.startsWith(' ') ? line.slice(1) : line)}</span>
          </div>`;
      }
    }).join('');
  } else {
    // Fallback display if LLM returned target_string and replacement_text old-style
    const props = meta.props;
    const target = props.target_string;
    const replacement = props.replacement_text;
    const before = props.context_before;
    const after = props.context_after;

    // Explicitly escape sliced text chunks before template interpolation
    const linePrefix = safeEscH(meta.match ? meta.source.slice(Math.max(0, meta.match.index - before.length), meta.match.index) : before);
    const lineSuffix = safeEscH(meta.match ? meta.source.slice(meta.match.index + meta.match.length, meta.match.index + meta.match.length + after.length) : after);
    const escapedTarget = safeEscH(target || llmText('llm.missingTarget', '(missing target)'));
    const escapedReplacement = safeEscH(replacement || target || '');

    formattedLinesHTML = `
      <div style="display:flex;background:color-mix(in srgb, var(--danger,#dc2626) 10%, transparent);color:var(--danger,#dc2626);border-left:3px solid var(--danger,#dc2626);padding:2px 8px;align-items:flex-start;gap:8px;">
        <span style="user-select:none;width:12px;font-weight:bold;opacity:0.6;text-align:center;">-</span>
        <span style="white-space:pre-wrap;word-break:break-all;font-weight:500;">${linePrefix}<span style="font-weight:700;text-decoration:line-through;background:color-mix(in srgb, var(--danger,#dc2626) 18%, transparent);padding:0 2px;border-radius:2px;">${escapedTarget}</span>${lineSuffix}</span>
      </div>
      <div style="display:flex;background:color-mix(in srgb, var(--ok,#10b981) 10%, transparent);color:var(--ok,#10b981);border-left:3px solid var(--ok,#10b981);padding:2px 8px;align-items:flex-start;gap:8px;">
        <span style="user-select:none;width:12px;font-weight:bold;opacity:0.6;text-align:center;">+</span>
        <span style="white-space:pre-wrap;word-break:break-all;font-weight:500;">${linePrefix}<span style="font-weight:700;background:color-mix(in srgb, var(--ok,#10b981) 22%, transparent);padding:0 2px;border-radius:2px;">${escapedReplacement}</span>${lineSuffix}</span>
      </div>
    `;
  }
}

function findDecisionText(query) {
  if (!query) return '';
  if (typeof getAllMetadataDecisionEntries !== 'function') return query;
  const allDec = getAllMetadataDecisionEntries();
  const matchById = allDec.find(d => String(d.noteId || '') === String(query) || String(d.id || '') === String(query));
  if (matchById) return matchById.text || '';
  const matchByText = allDec.find(d => String(d.text || '').toLowerCase().includes(String(query).toLowerCase()));
  if (matchByText) return matchByText.text || '';
  return query;
}

function findMatchingTodo(title) {
  if (!title || typeof todosManifest === 'undefined' || !Array.isArray(todosManifest)) return null;
  const cleanTitle = String(title).toLowerCase().trim();
  return todosManifest.find(t => t.priority !== 'Done' && String(t.title || '').toLowerCase().trim() === cleanTitle);
}

function renderLLMSuggestionCardBodyHTML(card) {
  if (!card) return '';

  if (card.kind === 'summary') {
    const rawBody = card.body || '';
    let htmlContent = '';
    if (typeof marked !== 'undefined' && typeof marked.parse === 'function') {
      const processed = typeof preprocessLatexMath === 'function' ? preprocessLatexMath(rawBody) : rawBody;
      htmlContent = marked.parse(processed);
    } else {
      htmlContent = escH(rawBody).replace(/\n/g, '<br>');
    }
    return `
      <style>
      .ai-summary-markdown-body h1 {
        font-size: 0.95rem !important;
        margin: 0.4rem 0 0.2rem 0 !important;
        color: var(--accent) !important;
        font-weight: 700 !important;
        border-bottom: 1px solid var(--card-border) !important;
        padding-bottom: 2px !important;
      }
      .ai-summary-markdown-body h2 {
        font-size: 0.85rem !important;
        margin: 0.6rem 0 0.2rem 0 !important;
        color: var(--text) !important;
        font-weight: 600 !important;
      }
      .ai-summary-markdown-body p {
        margin: 0.3rem 0 !important;
      }
      .ai-summary-markdown-body ul, .ai-summary-markdown-body ol {
        margin: 0.3rem 0 !important;
        padding-left: 1.1rem !important;
      }
      .ai-summary-markdown-body li {
        margin: 0.15rem 0 !important;
      }
      </style>
      <div class="ai-summary-markdown-body" style="font-size:.78rem;line-height:1.45;color:var(--text)">
        ${htmlContent}
      </div>
    `;
  }

  if (card.kind === 'text_correction') {
    return renderTextCorrectionHTML(card);
  }

  const props = card.properties || {};
  if (card.action === 'create_todo') {
    const title = String(props.title || llmText('llm.untitledTask', 'Untitled task')).trim();
    const priority = String(props.priority || 'Medium').trim();
    const assignee = String(props.assignee || '').trim();
    const contextLink = String(props.context_link || '').trim();

    const existingTodo = findMatchingTodo(title);
    if (existingTodo) {
      const oldPriority = existingTodo.priority || 'Medium';
      const oldAssignee = existingTodo.owner || 'Unassigned';
      return `
        <div style="display:flex;flex-direction:column;gap:.5rem;font-size:.75rem;line-height:1.4">
          <div class="ai-suggestion-diff-box">
            <div class="ai-suggestion-diff-del">
              <strong>Existing Todo:</strong> "${escH(title)}" (${escH(oldPriority)}) - Assigned to: ${escH(oldAssignee)}
            </div>
            <div class="ai-suggestion-diff-ins" style="border-top:1px solid var(--card-border)">
              <strong>Proposed Update:</strong> "${escH(title)}" (${escH(priority)}) - Assigned to: ${escH(assignee || 'Unassigned')}
            </div>
          </div>
        </div>
      `;
    }

    return `
      <div style="display:grid;grid-template-columns:auto 1fr;gap:.35rem .6rem;align-items:start;font-size:.75rem;line-height:1.4">
        <div style="color:var(--text-muted)">${escH(llmText('llm.fieldTitle', 'Title'))}</div><div style="color:var(--text);font-weight:500;">${escH(title)}</div>
        <div style="color:var(--text-muted)">${escH(llmText('llm.fieldPriority', 'Priority'))}</div><div style="color:var(--text)">${escH(priority)}</div>
        <div style="color:var(--text-muted)">${escH(llmText('llm.fieldAssignee', 'Assignee'))}</div><div style="color:var(--text)">${escH(assignee || llmText('llm.unassigned', 'Unassigned'))}</div>
        ${contextLink ? `<div style="color:var(--text-muted)">${escH(llmText('llm.fieldContext', 'Context'))}</div><div style="color:var(--text)">${escH(contextLink)}</div>` : ''}
      </div>
    `;
  }

  if (card.action === 'log_decision') {
    const text = String(props.text || '').trim();
    const majorTopic = String(props.major_topic || '').trim();
    const supersedesRaw = String(props.supersedes || '').trim();
    const supersedesText = findDecisionText(supersedesRaw);

    if (supersedesText) {
      const { originalHTML, replacementHTML } = highlightWordDiff(supersedesText, text);
      return `
        <div style="display:flex;flex-direction:column;gap:.5rem;font-size:.75rem;line-height:1.4">
          <div class="ai-suggestion-diff-box">
            <div class="ai-suggestion-diff-del">
              <strong>Replaced Decision:</strong> ${originalHTML}
            </div>
            <div class="ai-suggestion-diff-ins" style="border-top:1px solid var(--card-border)">
              <strong>Proposed Decision:</strong> ${replacementHTML}
            </div>
          </div>
          ${majorTopic ? `<div style="font-size:.7rem;color:var(--text-muted)">Topic: <strong>${escH(majorTopic)}</strong></div>` : ''}
        </div>
      `;
    }

    return `
      <div style="display:flex;flex-direction:column;gap:.35rem;font-size:.75rem;line-height:1.4">
        <div style="color:var(--text);font-weight:500;">💡 ${escH(text || llmText('llm.emptyDecision', '(empty decision)'))}</div>
        <div style="display:flex;flex-wrap:wrap;gap:.35rem">
          ${majorTopic ? `<span style="padding:.12rem .4rem;border:1px solid var(--card-border);border-radius:999px;color:var(--text-muted)">Topic: ${escH(majorTopic)}</span>` : ''}
          ${supersedesRaw ? `<span style="padding:.12rem .4rem;border:1px solid var(--card-border);border-radius:999px;color:var(--text-muted)">Supersedes: ${escH(supersedesRaw)}</span>` : ''}
        </div>
      </div>
    `;
  }

  const entries = Object.entries(props);
  if (!entries.length) {
    return `<div style="font-size:.75rem;color:var(--text-muted)">${escH(llmText('llm.noDetailsReturned', 'No details returned.'))}</div>`;
  }
  return `
    <div style="display:flex;flex-direction:column;gap:.25rem;font-size:.75rem;line-height:1.4">
      ${entries.map(([key, value]) => `
        <div style="display:grid;grid-template-columns:auto 1fr;gap:.35rem .6rem;align-items:start;">
          <div style="color:var(--text-muted)">${escH(key)}</div>
          <div style="color:var(--text)">${escH(value == null ? '' : String(value))}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function formatSuggestionCardBody(card) {
  if (!card) return '';
  if (card.kind === 'summary') {
    return card.body;
  }
  if (card.kind === 'text_mutation_group') {
    return (card.mutations || []).map((mutation, idx) => {
      const target = String(mutation?.properties?.target_string || '').trim() || '(missing target)';
      const wrapTag = String(mutation?.properties?.wrap_tag || 'mark').trim();
      const annotation = String(mutation?.properties?.annotation || '').trim();
      return `${idx + 1}. ${target}${wrapTag ? ` -> <${wrapTag}>` : ''}${annotation ? ` (${annotation})` : ''}`;
    }).join('\n');
  }
  const props = card.properties || {};
  if (card.action === 'create_todo') {
    const title = String(props.title || 'Untitled task').trim();
    const priority = String(props.priority || 'Medium').trim();
    const assignee = String(props.assignee || '').trim();
    return [
      `Marker: {todo:${priority}:${card.todoId || 'ntodo-...'}|${title}}`,
      `Title: ${title}`,
      `Priority: ${priority}`,
      assignee ? `Assignee: ${assignee}` : ''
    ].filter(Boolean).join('\n');
  }
  if (card.action === 'log_decision') {
    const text = String(props.text || '').trim();
    const quoted = text.replace(/\"/g, '\\\"');
    return [
      `Decision: !decision:active "${quoted}"`,
      String(props.major_topic || '').trim() ? `Major topic: ${String(props.major_topic || '').trim()}` : '',
      String(props.supersedes || '').trim() ? `Supersedes: ${String(props.supersedes || '').trim()}` : ''
    ].filter(Boolean).join('\n');
  }
  return Object.entries(props)
    .map(([key, value]) => `${key}: ${value == null ? '' : String(value)}`)
    .join('\n');
}

function formatPostCallNoteBlock(card) {
  if (!card) return '';
  if (card.kind === 'summary') {
    // body is already HTML from the LLM
    return String(card.body || '').trim();
  }
  const props = card.properties || {};
  if (card.action === 'create_todo') {
    const title = String(props.title || 'Untitled task').trim();
    const priority = String(props.priority || 'Medium').trim();
    const todoId = String(card.todoId || '').trim() || (typeof generateTodoId === 'function'
      ? generateTodoId()
      : `ntodo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
    // Exact structure matching the editor's own todo insertion
    return (
      `<span class="note-todo note-todo-draft" data-todo-id="${escH(todoId)}" data-todo-priority="${escH(priority)}" contenteditable="false">` +
      `<span class="note-todo-text" contenteditable="true">${escH(title)}</span>` +
      `</span>`
    );
  }
  if (card.action === 'log_decision') {
    const text = String(props.text || '').trim();
    if (!text) return '';
    const status = 'active';
    const badgeHTML = `<strong class="pill-decision pill-decision-${status}" contenteditable="false">!decision:${status}</strong>`;
    // Exact structure matching the editor's own decision insertion (app-collab.js)
    return (
      `<span class="note-decision-wrapper note-decision-draft" data-decision-status="${status}" data-decision-text="" contenteditable="false">` +
      `${badgeHTML} <span class="note-decision-text" contenteditable="true">${escH(text)}</span>` +
      `</span>`
    );
  }
  return '';
}

function formatTextMutationBlock(card) {
  const mutations = Array.isArray(card?.mutations) ? card.mutations : [];
  return mutations.map((mutation, idx) => {
    const props = mutation?.properties || {};
    const target = String(props.target_string || '').trim();
    const wrapTag = String(props.wrap_tag || 'mark').trim();
    const annotation = String(props.annotation || '').trim();
    return `- ${idx + 1}. ${target}${wrapTag ? ` -> <${wrapTag}>` : ''}${annotation ? ` (${annotation})` : ''}`;
  }).filter(Boolean).join('\n');
}

/**
 * Sanitize LLM-generated HTML before writing to innerHTML.
 * Uses an allowlist of safe tags and attributes only — removes anything dangerous
 * (script, img with onerror, onclick, javascript: href, etc.).
 *
 * Allowed tags: structural content + the editor's own todo/decision span structure.
 * Allowed attributes: class, data-* (editor data attrs), contenteditable, href (https only).
 */
function sanitizeLLMHTML(html) {
  if (!html || typeof html !== 'string') return '';

  const ALLOWED_TAGS = new Set([
    'p', 'ul', 'ol', 'li', 'strong', 'em', 'mark', 'br', 'hr',
    'h1', 'h2', 'h3', 'h4', 'span', 'div', 'code', 'pre', 'blockquote', 'a'
  ]);

  // Attributes allowed globally (data-* handled separately below)
  const ALLOWED_ATTRS = new Set(['class', 'contenteditable']);
  // Attribute-to-tag restrictions
  const ALLOWED_HREF_SCHEMES = /^https?:\/\//i;

  try {
    const doc = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html');

    function walkAndClean(node) {
      const children = Array.from(node.childNodes);
      for (const child of children) {
        if (child.nodeType === Node.TEXT_NODE) continue;
        if (child.nodeType !== Node.ELEMENT_NODE) {
          child.remove(); // strip comments, processing instructions, etc.
          continue;
        }
        const tag = child.tagName.toLowerCase();
        if (!ALLOWED_TAGS.has(tag)) {
          // Replace disallowed element with its children (unwrap, don't remove text)
          while (child.firstChild) child.before(child.firstChild);
          child.remove();
          continue;
        }
        // Strip disallowed attributes
        const attrNames = Array.from(child.attributes).map(a => a.name);
        for (const attr of attrNames) {
          const isAllowedAttr = ALLOWED_ATTRS.has(attr) || attr.startsWith('data-');
          if (!isAllowedAttr) {
            child.removeAttribute(attr);
            continue;
          }
          // Validate href: only allow http/https
          if (attr === 'href' && !ALLOWED_HREF_SCHEMES.test(child.getAttribute('href') || '')) {
            child.removeAttribute('href');
          }
        }
        // Remove all event handler attributes (extra safety net)
        const eventAttrs = Array.from(child.attributes).filter(a => /^on/i.test(a.name));
        eventAttrs.forEach(a => child.removeAttribute(a.name));

        walkAndClean(child);
      }
    }

    walkAndClean(doc.body);
    return doc.body.innerHTML;
  } catch (e) {
    // If DOMParser fails (e.g., in a non-browser context), strip all tags as a hard fallback
    console.warn('sanitizeLLMHTML: DOMParser failed, stripping all tags', e);
    return String(html).replace(/<[^>]*>/g, '');
  }
}

/**
 * Append an HTML block to the editor (contenteditable div).
 * Finds or creates a <h2>Call Summary</h2> section and appends the block inside it.
 * @param {HTMLElement} editorEl - The contenteditable div.
 * @param {string} htmlBlock - The HTML fragment to append.
 * @returns {boolean} Whether anything was inserted.
 */
function appendHTMLToEditor(editorEl, htmlBlock) {
  if (!editorEl || !htmlBlock) return false;

  // Find existing Call Summary heading
  let summaryHeading = null;
  editorEl.querySelectorAll('h1, h2, h3').forEach(el => {
    if (/call\s+summary/i.test(el.textContent)) summaryHeading = el;
  });

  if (!summaryHeading) {
    // Create a Call Summary section at the bottom
    const h = document.createElement('h2');
    h.textContent = t('editor.callSummary') || 'Call Summary';
    editorEl.appendChild(h);
    summaryHeading = h;
  }

  // Insert after the heading (and any content that follows until the next heading)
  const wrapper = document.createElement('div');
  // Sanitize before injecting — guards against any LLM-generated XSS payloads
  wrapper.innerHTML = sanitizeLLMHTML(htmlBlock);
  const nodeToInsert = wrapper.firstChild || wrapper;

  // Find the last element in this section (before next sibling heading)
  let insertAfter = summaryHeading;
  let sibling = summaryHeading.nextSibling;
  while (sibling) {
    if (sibling.nodeType === 1 && /^H[1-3]$/.test(sibling.tagName)) break;
    insertAfter = sibling;
    sibling = sibling.nextSibling;
  }

  // Insert the block right after insertAfter
  if (insertAfter.nextSibling) {
    editorEl.insertBefore(nodeToInsert, insertAfter.nextSibling);
  } else {
    editorEl.appendChild(nodeToInsert);
  }

  editorEl.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

/** Read the editor's current HTML content. */
function getEditorHTML(textarea) {
  if (!textarea) return '';
  return textarea.innerHTML || '';
}

/** Write HTML into the editor. */
function writeEditorHTML(textarea, htmlValue) {
  if (!textarea) return false;
  textarea.innerHTML = htmlValue || '';
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

/**
 * Write an HTML value into the summary contenteditable div.
 * The LLM summary is already HTML (no Markdown conversion needed).
 */
function writeSummaryMetadataHTML(htmlValue) {
  const summaryEl = document.getElementById('edit-summary');
  if (!summaryEl) return false;
  const cleaned = sanitizeLLMHTML(String(htmlValue || '').trim());
  if (summaryEl.innerHTML === cleaned) return true;

  summaryEl.innerHTML = cleaned;
  if (currentNote && typeof currentNote === 'object') {
    currentNote.summary = cleaned;
  }
  summaryEl.dispatchEvent(new Event('input', { bubbles: true }));
  if (typeof syncPreview === 'function') {
    syncPreview();
  }
  return true;
}

// Legacy aliases kept for any remaining callers in the codebase
function getEditorMarkdown(textarea) { return getEditorHTML(textarea); }
function writeEditorMarkdown(textarea, v) { return writeEditorHTML(textarea, v); }
function writeSummaryMetadataMarkdown(v) { return writeSummaryMetadataHTML(v); }

function appendMarkdownToSection(markdown, contentBlock, sectionHeader) {
  const text = (markdown || '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');

  // Find heading index matching sectionHeader (e.g. "Actions" or "Decisions")
  const headingPattern = new RegExp(`^#{1,6}\\s+${sectionHeader}\\s*$`, 'i');
  let headingIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (headingPattern.test(line)) {
      headingIndex = i;
      break;
    }
    if (line.toLowerCase() === sectionHeader.toLowerCase() && i + 1 < lines.length) {
      const nextLine = lines[i + 1].trim();
      if (/^={3,}$/.test(nextLine) || /^-{3,}$/.test(nextLine)) {
        headingIndex = i;
        break;
      }
    }
  }

  // If section header is not found, try to find "Call Summary" or append to the end
  if (headingIndex === -1) {
    const fallbackPattern = /^#{1,6}\s+Call\s+Summary\s*$/i;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (fallbackPattern.test(line)) {
        headingIndex = i;
        break;
      }
      if (line.toLowerCase() === 'call summary' && i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim();
        if (/^={3,}$/.test(nextLine) || /^-{3,}$/.test(nextLine)) {
          headingIndex = i;
          break;
        }
      }
    }
  }

  if (headingIndex === -1) {
    // Create section at the bottom
    const base = text.trimEnd();
    const formattedBlock = (sectionHeader.toLowerCase() === 'actions' && !contentBlock.trim().startsWith('-'))
      ? `- ${contentBlock}`
      : contentBlock;
    return `${base ? `${base}\n\n` : ''}# ${sectionHeader}\n\n${formattedBlock}\n`;
  }

  const isSetext = headingIndex !== -1 && headingIndex + 1 < lines.length && /^[=-]{3,}$/.test(lines[headingIndex + 1].trim()) && (lines[headingIndex].trim().toLowerCase() === sectionHeader.toLowerCase() || lines[headingIndex].trim().toLowerCase() === 'call summary');
  const contentStartIndex = isSetext ? headingIndex + 2 : headingIndex + 1;

  // Find end of this section (next heading)
  let sectionEnd = lines.length;
  for (let i = contentStartIndex; i < lines.length; i++) {
    if (/^#{1,6}\s+/.test(lines[i].trim())) {
      sectionEnd = i;
      break;
    }
    if (i + 1 < lines.length && /^[=-]{3,}$/.test(lines[i + 1].trim())) {
      sectionEnd = i;
      break;
    }
  }

  // Get lines of the section
  const sectionLines = lines.slice(contentStartIndex, sectionEnd);
  const cleanedSection = [...sectionLines];

  // Determine if the section consists of list items
  const hasListItems = cleanedSection.some(line => /^\s*[-\*+]\s+/.test(line));

  let formattedBlock = contentBlock;
  if (hasListItems && !contentBlock.trim().startsWith('-')) {
    formattedBlock = `- ${contentBlock}`;
  }

  // Filter out empty lines at the end of the section
  while (cleanedSection.length && !cleanedSection[cleanedSection.length - 1].trim()) {
    cleanedSection.pop();
  }

  // Append the block
  if (hasListItems) {
    cleanedSection.push(formattedBlock);
  } else {
    if (cleanedSection.length) {
      cleanedSection.push('');
    }
    cleanedSection.push(formattedBlock);
  }

  cleanedSection.push(''); // trailing spacer

  const rebuilt = [
    ...lines.slice(0, contentStartIndex),
    ...cleanedSection,
    ...lines.slice(sectionEnd)
  ].join('\n');

  return rebuilt.replace(/\s*$/, '\n');
}

function appendToPostCallNotes(textarea, contentBlock) {
  if (!textarea) return false;
  const source = getEditorMarkdown(textarea);
  const nextValue = appendMarkdownToPostCallNotes(source, contentBlock);
  if (nextValue === source) return false;
  return writeEditorMarkdown(textarea, nextValue);
}

/**
 * Build a flat map of every Text node inside `root`, recording each node's
 * absolute character-start and character-end offsets relative to the
 * concatenated visible text string. Block-level elements (div, p, br) inject
 * a virtual \n into the offset counter so indices stay in sync with any
 * markdown representation the LLM targets.
 *
 * @param {Element} root
 * @returns {Array<{node: Text, start: number, end: number}>}
 */
function buildTextNodeMap(root) {
  const map = [];
  let offset = 0;

  // Tags whose presence represents a structural newline in the visible text.
  const BLOCK_TAGS = new Set(['DIV', 'P', 'BR', 'LI', 'TR', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const len = node.nodeValue.length;
      if (len > 0) {
        map.push({ node, start: offset, end: offset + len });
        offset += len;
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const tag = node.tagName;
    // <br> is self-closing — just emit the newline and return.
    if (tag === 'BR') {
      offset += 1;
      return;
    }

    // For block containers, emit a leading newline before their children
    // (but only when we are not at the very start, to avoid a spurious leading \n).
    const isBlock = BLOCK_TAGS.has(tag);
    if (isBlock && offset > 0) {
      offset += 1;
    }

    for (const child of node.childNodes) {
      walk(child);
    }

    // Emit a trailing newline after block containers so the next sibling starts
    // on a fresh line, mirroring how the browser renders block separation.
    if (isBlock) {
      offset += 1;
    }
  }

  walk(root);
  return map;
}

/**
 * Given a text-node map (from buildTextNodeMap) and a [startIdx, startIdx+length)
 * window, return the exact list of Text nodes that cover that window — splitting
 * nodes at the boundaries with splitText() so every returned node maps to exactly
 * the target characters.
 *
 * @param {Array<{node: Text, start: number, end: number}>} map
 * @param {number} startIdx  Absolute start offset (inclusive)
 * @param {number} length    Number of characters to capture
 * @returns {Text[]}  The isolated text nodes spanning the target, or [] on failure.
 */
function collectTargetNodes(map, startIdx, length) {
  if (length <= 0) return [];
  const endIdx = startIdx + length;
  const result = [];

  for (const entry of map) {
    if (entry.end <= startIdx) continue;   // entirely before target
    if (entry.start >= endIdx) break;       // entirely after target

    let { node } = entry;
    let nodeStart = entry.start;

    // Trim leading characters that precede the target window.
    if (nodeStart < startIdx) {
      const splitAt = startIdx - nodeStart;
      // splitText(n) splits node into [0..n) and [n..end); we want the right half.
      const rightHalf = node.splitText(splitAt);
      // Update the entry's own node reference (for trailing trim below).
      node = rightHalf;
      nodeStart = startIdx;
    }

    // Trim trailing characters that extend beyond the target window.
    const nodeEnd = nodeStart + node.nodeValue.length;
    if (nodeEnd > endIdx) {
      const splitAt = endIdx - nodeStart;
      node.splitText(splitAt); // left half stays in `node`, right half discarded here
    }

    if (node.nodeValue.length > 0) {
      result.push(node);
    }
  }

  return result;
}

/**
 * Reconstruct the visible text string from a buildTextNodeMap result,
 * padding any gaps between entries with '\n' characters so that every
 * entry's start/end offset aligns exactly with the corresponding
 * position in the returned string. This is the inverse of the virtual
 * newlines injected by buildTextNodeMap for <br>, <div>, <p>, etc.
 *
 * @param {Array<{node: Text, start: number, end: number}>} map
 * @returns {string}
 */
function getSyncedFullText(map) {
  let fullText = '';
  let lastEnd = 0;
  for (const entry of map) {
    if (entry.start > lastEnd) {
      // Fill the virtual-newline gap so string indices match map offsets.
      fullText += '\n'.repeat(entry.start - lastEnd);
    }
    fullText += entry.node.nodeValue;
    lastEnd = entry.end;
  }
  return fullText;
}

function applyTextMutationGroupToEditor(textarea, mutations) {
  if (!textarea || !mutations.length) return false;
  let changed = false;

  // Build the map once. getSyncedFullText pads the gaps with the same
  // virtual newlines that buildTextNodeMap injected, so indexOf() returns
  // indices that are perfectly aligned with map entry start/end offsets.
  const map = buildTextNodeMap(textarea);
  const fullText = getSyncedFullText(map);

  // Collect all valid matches and sort them in descending order by index.
  // Processing bottom-to-top means that splitText() calls at lower offsets
  // never disturb the node references for higher-offset entries.
  const matches = [];
  for (const mutation of mutations) {
    const target = String(mutation?.properties?.target_string || '').trim();
    if (!target) continue;
    const idx = fullText.indexOf(target);
    if (idx !== -1) {
      matches.push({ mutation, idx, length: target.length });
    }
  }
  matches.sort((a, b) => b.idx - a.idx);

  for (const match of matches) {
    const wrapTag = String(match.mutation.properties?.wrap_tag || 'mark').trim() || 'mark';
    const nodes = collectTargetNodes(map, match.idx, match.length);
    if (nodes.length === 0) continue;

    // Wrap each isolated text node individually — no cross-boundary Range needed.
    for (const textNode of nodes) {
      const wrapper = document.createElement(wrapTag);
      textNode.parentNode.insertBefore(wrapper, textNode);
      wrapper.appendChild(textNode);
    }
    changed = true;
  }

  if (changed) textarea.dispatchEvent(new Event('input', { bubbles: true }));
  return changed;
}


function findTextCorrectionMatch(source, correction) {
  const text = String(source || '').replace(/\r\n/g, '\n');
  const target = String(correction?.target_string || '').replace(/\r\n/g, '\n').trim();
  if (!text || !target) return null;

  // ReDoS guard: very long targets or whitespace-dense strings can cause catastrophic backtracking.
  // Fall back to a safe literal indexOf match in those cases.
  if (target.length > 500 || /\s{8,}/.test(target)) {
    const idx = text.indexOf(target);
    return idx !== -1 ? { index: idx, length: target.length } : null;
  }

  // Escape special regex characters and replace whitespace sequences with fuzzy matches
  const escapedTarget = target.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  const fuzzyTargetPattern = escapedTarget.replace(/\s+/g, '\\s+');
  let regex;
  try {
    regex = new RegExp(fuzzyTargetPattern, 'gi');
  } catch (e) {
    const idx = text.indexOf(target);
    if (idx !== -1) {
      return { index: idx, length: target.length };
    }
    return null;
  }

  const cleanStr = (s) => s.toLowerCase().replace(/\s+/g, '');
  const before = cleanStr(correction?.context_before || '');
  const after = cleanStr(correction?.context_after || '');

  const candidates = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const idx = match.index;
    const len = match[0].length;

    const lookbackZone = cleanStr(text.slice(Math.max(0, idx - 100), idx));
    const lookaheadZone = cleanStr(text.slice(idx + len, idx + len + 100));

    const beforeOk = !before || lookbackZone.includes(before);
    const afterOk = !after || lookaheadZone.includes(after);

    candidates.push({
      index: idx,
      length: len,
      beforeOk,
      afterOk,
      score: (beforeOk ? 1 : 0) + (afterOk ? 1 : 0)
    });

    if (len === 0) {
      regex.lastIndex++;
    }
  }

  if (candidates.length === 0) return null;

  // 1. Return the candidate with perfect context match (score === 2)
  const perfect = candidates.find(c => c.score === 2);
  if (perfect) return { index: perfect.index, length: perfect.length };

  // 2. Return the candidate with partial context match (score === 1)
  const partial = candidates.find(c => c.score === 1);
  if (partial) return { index: partial.index, length: partial.length };

  // 3. Fallback: if there is exactly one match in the entire note,
  // return it even if context checks failed (since there is no ambiguity).
  if (candidates.length === 1) {
    return { index: candidates[0].index, length: candidates[0].length };
  }

  return null;
}

/**
 * Apply a text correction directly to the editor's DOM.
 * Uses buildTextNodeMap + collectTargetNodes (node-splitting strategy) to
 * locate and isolate the exact Text nodes that span target_string, then
 * removes them and inserts a single replacement Text node in their place.
 * No Range.surroundContents() or cross-boundary DOM operations are used.
 */
function applyTextCorrectionToEditor(textarea, correction) {
  if (!textarea) return false;
  const props = normalizeTextCorrectionProps(correction);
  const target = props.target_string;
  const replacement = String(props.replacement_text ?? '');
  if (!target) return false;

  // Build the node map and derive the synced text from it.
  // getSyncedFullText pads the virtual-newline gaps so that findTextCorrectionMatch
  // returns indices perfectly aligned with the map's start/end offsets.
  const map = buildTextNodeMap(textarea);
  const fullText = getSyncedFullText(map);
  const cleanTarget = target.replace(/\r\n/g, '\n');
  const match = findTextCorrectionMatch(fullText, { ...props, target_string: cleanTarget });
  if (!match) return false;

  // Isolate the exact text nodes that span [match.index, match.index+match.length).
  const nodes = collectTargetNodes(map, match.index, match.length);
  if (nodes.length === 0) return false;

  // Insert the replacement before the first matched node, then remove all matched nodes.
  const anchor = nodes[0];
  const parent = anchor.parentNode;
  if (!parent) return false;

  if (replacement) {
    parent.insertBefore(document.createTextNode(replacement), anchor);
  }
  for (const n of nodes) {
    n.parentNode.removeChild(n);
  }

  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

function getPostCallNotesApplyLabel(card) {
  if (!card) return 'Apply';
  if (card.kind === 'text_correction') return llmText('llm.acceptCorrection', 'Accept correction');
  if (card.kind === 'text_mutation_group') return llmText('llm.applyToNote', 'Apply to note');
  return llmText('llm.applyToPostCallNotes', 'Apply to post-call notes');
}

function getPostCallNotesDropLabel() {
  return llmText('llm.drop', 'Drop');
}

function ensureAiLaneVisible() {
  const lane = getAiLaneContainer();
  if (!lane) return;
  lane.style.display = 'flex';

  const panel = document.getElementById('overlay-right-panel');
  const isCollapsed = panel ? panel.classList.contains('collapsed') : false;

  if (activeInspectorTab !== 'D' || isCollapsed) {
    openAiConversationInInspector();
  }
}

function closeAiConversationLane() {
  const lane = getAiLaneContainer();
  if (!lane) return;
  stopActiveAiRequest();
  const panel = document.getElementById('overlay-right-panel');
  if (panel && panel.contains(lane)) {
    activeInspectorTab = 'A';
    if (typeof renderInspectorPanel === 'function') {
      renderInspectorPanel();
    }
    return;
  }
  lane.style.display = 'none';
}

function appendAiConversationTurn(role, text, parsedPayload, note = currentNote) {
  const state = getAiState(note);
  const turns = state.conversationTurns;
  const normalizedRole = role === 'assistant' ? 'assistant' : 'user';
  turns.push({
    role: normalizedRole,
    text: String(text || '').trim(),
    parsedPayload: tryNormalizeParsedPayload(parsedPayload)
  });
  state.conversationTurns = turns.slice(-20);
}

function applyAiConversationPayload(index, note = currentNote) {
  const turns = getAiConversationTurns(note);
  const turn = turns[index];
  const payload = tryNormalizeParsedPayload(turn?.parsedPayload);
  if (!payload) {
    toast(llmText('llm.noValidJsonToast', 'No valid JSON payload available on this response.'), true);
    return;
  }
  renderAiSuggestions(payload);
  toast(llmText('llm.jsonLoadedToast', 'JSON payload loaded into suggestions panel.'));
}

function stripJsonFromText(text) {
  let clean = String(text || '').trim();

  // Remove markdown json code blocks: ```json ... ```
  clean = clean.replace(/```json[\s\S]*?```/gi, '');
  clean = clean.replace(/```[\s\S]*?```/gi, (match) => {
    try {
      const inner = match.slice(3, -3).trim();
      JSON.parse(inner);
      return '';
    } catch (e) {
      return match;
    }
  });

  // Remove raw JSON object if it's there without markdown wrappers
  const firstBrace = clean.indexOf('{');
  const lastBrace = clean.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = clean.slice(firstBrace, lastBrace + 1).trim();
    try {
      JSON.parse(candidate);
      clean = clean.slice(0, firstBrace) + clean.slice(lastBrace + 1);
    } catch (e) {
      // not valid JSON
    }
  }

  clean = clean.trim();
  if (!clean) {
    return llmText('llm.inlineImprovementsLoaded', 'I analyzed the note and loaded improvements inline in the preview.');
  }
  return clean;
}

function renderAiConversationTurnBodyHTML(turn) {
  const rawText = turn?.text || '';
  let text = stripJsonFromText(rawText);

  const payload = turn?.parsedPayload;
  if (payload && payload.general_comment) {
    const comment = String(payload.general_comment || '').trim();
    if (comment) {
      text = comment + '\n\n' + text;
    }
  }

  if (typeof marked !== 'undefined' && typeof marked.parse === 'function') {
    const processed = typeof preprocessLatexMath === 'function' ? preprocessLatexMath(text) : text;
    return `<div class="edit-ai-lane-msg-body">${marked.parse(processed)}</div>`;
  }
  return `<div class="edit-ai-lane-msg-body">${escH(text).replace(/\n/g, '<br>')}</div>`;
}

function renderAiConversationLane(note = currentNote) {
  const lane = getAiLaneContainer();
  const messagesEl = getAiLaneMessagesContainer();
  if (!lane || !messagesEl) return;

  const turns = getAiConversationTurns(note);
  const activeRequest = getActiveAiRequest(note);
  ensureAiLaneVisible();
  syncLLMEditorControls();

  if (!turns.length && !activeRequest) {
    messagesEl.innerHTML = `<div class="edit-ai-lane-msg"><div class="edit-ai-lane-msg-role">${escH(llmText('llm.assistant', 'Assistant'))}</div><div class="edit-ai-lane-msg-body">${escH(llmText('llm.noMessagesYet', 'No messages yet. Run Analyze or ask a follow-up.'))}</div></div>`;
    return;
  }

  let html = turns.map((turn, idx) => {
    const roleLabel = turn.role === 'assistant' ? llmText('llm.assistant', 'Assistant') : llmText('llm.you', 'You');
    const laneClass = turn.role === 'assistant' ? 'edit-ai-lane-msg assistant' : 'edit-ai-lane-msg user';
    return `
      <div class="${laneClass}">
        <div class="edit-ai-lane-msg-role">${roleLabel}</div>
        ${turn.role === 'assistant' ? renderAiConversationTurnBodyHTML(turn) : `<div class="edit-ai-lane-msg-body">${escH(turn.text || '')}</div>`}
      </div>
    `;
  }).join('');

  if (activeRequest) {
    const thinkingText = activeRequest.thinkingMessage || llmText('llm.thinking', 'Thinking');
    html += `
      <div class="edit-ai-lane-msg assistant" style="opacity:0.8;">
        <div class="edit-ai-lane-msg-role">${escH(llmText('llm.assistant', 'Assistant'))}</div>
        <div class="edit-ai-lane-msg-body">
          <span class="thinking-dots">${escH(thinkingText)}</span>
        </div>
      </div>
    `;
  }

  messagesEl.innerHTML = html;

  messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function sendAiConversationReply() {
  let note = currentNote;
  try {
    if (!LLMService.isEnabled()) {
      toast(llmText('llm.disabledToast', 'Local LLM is disabled. Enable it in Preferences first.'), true);
      return;
    }
    if (!currentNote) {
      toast(llmText('llm.noActiveNote', 'No active note to analyze.'), true);
      return;
    }

    const inputEl = document.getElementById('edit-ai-lane-input');
    const effort = 'medium';
    const sendBtn = document.getElementById('edit-ai-lane-send');
    const userMessage = String(inputEl?.value || '').trim();
    if (!userMessage) return;

    const textArea = document.getElementById('edit-textarea');
    // Send plain text to LLM so target_string in corrections matches what the user sees
    const noteContent = (textArea?.innerText || textArea?.textContent || '').trim();

    appendAiConversationTurn('user', userMessage, null, note);
    // Record last conversation payload so it can be retried if the LLM call fails
    try {
      const state = getAiState(note);
      state.lastPayload = { type: 'conversation', message: userMessage };
    } catch (e) { }
    openAiConversationInInspector();
    if (inputEl) inputEl.value = '';

    const requestController = new AbortController();
    setActiveAiRequest(note, {
      controller: requestController,
      kind: 'conversation',
      thinkingMessage: llmText('llm.thinking', 'Thinking')
    });
    renderAiConversationLane(note);

    const response = await LLMService.replyInConversationLane(
      note,
      noteContent,
      getAiConversationTurns(note),
      userMessage,
      {
        controller: requestController,
        timeoutMs: 0,
        reasoningEffort: effort
      }
    );
    appendAiConversationTurn('assistant', response.reply || '', response.parsed || null, note);
    // Clear last payload on success
    try { getAiState(note).lastPayload = null; } catch (e) { }
    if (response.parsed) {
      renderAiSuggestions(response.parsed, note);
    }
  } catch (err) {
    if (err && err.name === 'AbortError') {
      appendAiConversationTurn('assistant', llmText('llm.stopped', 'Generation stopped.'), null, note);
      return;
    }
    console.error('LLM lane reply failed', err);
    const isTokenLimit = err?.isTokenLimit || err?.category === 'token_limit';
    const errorMsg = isTokenLimit
      ? llmText('llm.errorTokenLimit', "Token limit reached: the note or conversation exceeds the model's context window. Please shorten the note, reduce conversation history, or select a model with a larger context size.")
      : `${llmText('llm.errorPrefix', 'Error')}: ${err?.message || llmText('llm.unknownError', 'Unknown LLM error')}`;

    appendAiConversationTurn('assistant', errorMsg, null, note);
    if (!isTokenLimit) {
      try {
        const connectionTest = await LLMService.runPostFailureConnectionTest();
        if (connectionTest.ok) {
          appendAiConversationTurn(
            'assistant',
            `Connection check passed in ${connectionTest.elapsedMs} ms. The endpoint is reachable, but the request or model settings may still be the issue.`,
            null,
            note
          );
        } else {
          appendAiConversationTurn(
            'assistant',
            `Connection check failed: ${connectionTest.errorMessage || 'unknown error'}. Check the endpoint, local server, or network access.`,
            null,
            note
          );
        }
      } catch (probeErr) {
        console.warn('Could not run post-failure connection check', probeErr);
      }
    }
    renderAiErrorPanel(errorMsg);
    toast(isTokenLimit ? errorMsg : llmText('llm.replyFailed', 'LLM reply failed: {message}').replace('{message}', err.message), true);
  } finally {
    clearActiveAiRequest(note);
    if (isSameAiNote(note)) {
      renderAiConversationLane(note);
    }
    const sendBtn = document.getElementById('edit-ai-lane-send');
    if (sendBtn) sendBtn.disabled = false;
    const inputEl = document.getElementById('edit-ai-lane-input');
    if (inputEl) {
      inputEl.style.height = 'auto';
      inputEl.style.height = `${inputEl.scrollHeight}px`;
    }
  }
}

function renderAiErrorPanel(message) {
  toast((llmText('llm.localErrorTitle', 'Local LLM error') + ': ' + (message || llmText('llm.unknownError', 'Unknown LLM error'))), true);
}

// Retry helper for the last AI request performed in the current note context.
async function retryLastAiAction(note = currentNote) {
  try {
    const state = getAiState(note);
    const last = state && state.lastPayload ? state.lastPayload : null;
    if (!last) {
      toast(llmText('llm.noRetryPayload', 'No recent LLM request to retry.'), true);
      return;
    }



    if (last.type === 'analyze') {
      await analyzeCurrentNoteWithLLM();
      return;
    }

    if (last.type === 'conversation') {
      // Restore the message into the input so sendAiConversationReply reuses it.
      const inputEl = document.getElementById('edit-ai-lane-input');
      if (inputEl) inputEl.value = String(last.message || '');
      await sendAiConversationReply();
      return;
    }

    toast(llmText('llm.cannotRetry', 'Cannot retry last LLM action.'), true);
  } catch (err) {
    console.error('Retry last AI action failed', err);
    toast(llmText('llm.retryFailed', 'Retry failed: {message}').replace('{message}', err.message), true);
  }
}

let currentAiActionState = 'idle'; // 'idle' | 'analyzing' | 'summarizing' | 'refactoring'

function setAiActionState(actionState) {
  currentAiActionState = actionState;
  syncAiEditorButtonState();
}
window.setAiActionState = setAiActionState;
window.getAiActionState = function() { return currentAiActionState; };

function syncAiEditorButtonState() {
  const btn = document.getElementById('btn-ai-analyze');
  const fbtn = document.getElementById('btn-ai-analyze-floating');
  const refactorBtn = document.getElementById('btn-ai-refactor');
  const cancelRefactorBtn = document.getElementById('btn-note-editor-ai-cancel') || document.getElementById('btn-dr-step3-cancel-refactor') || document.getElementById('btn-ai-cancel-refactor');
  const summaryBtn = document.getElementById('btn-generate-summary-ai');

  const checkIconSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;
  const sparkIconSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>`;

  const enabled = typeof LLMService !== 'undefined' && LLMService.isEnabled();
  if (!enabled) {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `${checkIconSvg} ${llmText('llm.enableButton', 'Enable AI')}`;
      btn.title = llmText('llm.enableButtonTitle', 'Enable local LLM first');
      btn.style.opacity = '0.9';
      btn.style.cursor = '';
      btn.onclick = async () => {
        if (typeof toggleAiFeatureEnabled === 'function') {
          await toggleAiFeatureEnabled();
          syncAiEditorButtonState();
          updateLLMToolbarVisibility();
          return;
        }
        toast(llmText('llm.enableInPreferencesFirst', 'Enable Local LLM in Preferences first.'), true);
      };
    }
    if (fbtn) {
      fbtn.disabled = false;
      fbtn.innerHTML = `${checkIconSvg} ${t('editor.aiCheck') || 'AI Check'}`;
      fbtn.title = llmText('llm.enableButtonTitle', 'Enable local LLM first');
    }
    if (refactorBtn) {
      refactorBtn.style.display = 'none';
    }
    if (summaryBtn) {
      summaryBtn.style.display = 'none';
    }
    return;
  }

  // Local AI is enabled
  if (currentAiActionState === 'analyzing') {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner" style="display:inline-block; width:12px; height:12px; border:2px solid currentColor; border-right-color:transparent; border-radius:50%; animation:spin 0.8s linear infinite; margin-right:4px;"></span> ${llmText('llm.analyzingButton', 'Analyzing...')}`;
      btn.title = t('editor.aiCheckInProgressTooltip') || 'AI note verification in progress...';
      btn.style.opacity = '0.85';
      btn.style.cursor = 'wait';
    }
    if (fbtn) {
      fbtn.disabled = true;
      fbtn.innerHTML = `<span class="spinner" style="display:inline-block; width:12px; height:12px; border:2px solid currentColor; border-right-color:transparent; border-radius:50%; animation:spin 0.8s linear infinite; margin-right:4px;"></span> ${llmText('llm.analyzingButton', 'Analyzing...')}`;
      fbtn.title = t('editor.aiCheckInProgressTooltip') || 'AI note verification in progress...';
    }
    if (refactorBtn) {
      refactorBtn.disabled = true;
      refactorBtn.innerHTML = `${sparkIconSvg} ${t('editor.aiRefactorNote') || 'Perfect Note'}`;
      refactorBtn.title = t('editor.aiRefactorDisabledDuringCheck') || 'Disabled during note verification';
      refactorBtn.style.opacity = '0.5';
      refactorBtn.style.cursor = 'not-allowed';
    }
    if (cancelRefactorBtn) {
      cancelRefactorBtn.style.display = 'none';
    }
    if (summaryBtn) {
      summaryBtn.disabled = true;
      summaryBtn.innerHTML = `<span class="spinner" style="display:inline-block; width:12px; height:12px; border:2px solid currentColor; border-right-color:transparent; border-radius:50%; animation:spin 0.8s linear infinite; margin-right:4px;"></span> ${t('editor.aiSummaryQueued') || 'Queued...'}`;
      summaryBtn.title = t('editor.aiSummaryQueuedTooltip') || 'Summary will automatically generate after verification completes';
      summaryBtn.style.opacity = '0.7';
      summaryBtn.style.cursor = 'wait';
    }
  } else if (currentAiActionState === 'summarizing') {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `${checkIconSvg} ${t('editor.aiCheck') || 'AI Check'}`;
      btn.title = t('editor.aiAnalyzeDisabledDuringSummary') || 'Disabled during summary generation';
      btn.style.opacity = '0.5';
      btn.style.cursor = 'not-allowed';
    }
    if (fbtn) {
      fbtn.disabled = true;
      fbtn.innerHTML = `${checkIconSvg} ${t('editor.aiCheck') || 'AI Check'}`;
      fbtn.title = t('editor.aiAnalyzeDisabledDuringSummary') || 'Disabled during summary generation';
    }
    if (refactorBtn) {
      refactorBtn.disabled = true;
      refactorBtn.innerHTML = `${sparkIconSvg} ${t('editor.aiRefactorNote') || 'Perfect Note'}`;
      refactorBtn.title = t('editor.aiRefactorDisabledDuringSummary') || 'Disabled during summary generation';
      refactorBtn.style.opacity = '0.5';
      refactorBtn.style.cursor = 'not-allowed';
    }
    if (cancelRefactorBtn) {
      cancelRefactorBtn.style.display = 'none';
    }
    if (summaryBtn) {
      summaryBtn.disabled = true;
      summaryBtn.innerHTML = `<span class="spinner" style="display:inline-block; width:12px; height:12px; border:2px solid currentColor; border-right-color:transparent; border-radius:50%; animation:spin 0.8s linear infinite; margin-right:4px;"></span> ${t('editor.aiSummaryGenerating') || 'Generating...'}`;
      summaryBtn.title = t('editor.aiSummaryGeneratingTooltip') || 'Generating meeting summary with AI...';
      summaryBtn.style.opacity = '0.85';
      summaryBtn.style.cursor = 'wait';
    }
  } else if (currentAiActionState === 'refactoring') {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `${checkIconSvg} ${t('editor.aiCheck') || 'AI Check'}`;
      btn.title = t('editor.aiAnalyzeDisabledDuringRefactor') || 'Disabled during note refactoring';
      btn.style.opacity = '0.5';
      btn.style.cursor = 'not-allowed';
    }
    if (fbtn) {
      fbtn.disabled = true;
      fbtn.innerHTML = `${checkIconSvg} ${t('editor.aiCheck') || 'AI Check'}`;
      fbtn.title = t('editor.aiAnalyzeDisabledDuringRefactor') || 'Disabled during note refactoring';
    }
    if (refactorBtn) {
      refactorBtn.disabled = true;
      refactorBtn.innerHTML = `<span class="spinner" style="display:inline-block; width:12px; height:12px; border:2px solid currentColor; border-right-color:transparent; border-radius:50%; animation:spin 0.8s linear infinite; margin-right:4px;"></span> ${t('refactor.refactoringInProgress') || 'Refactoring...'}`;
      refactorBtn.title = t('refactor.refactoringInProgressTooltip') || 'Refactoring note with AI...';
      refactorBtn.style.opacity = '0.85';
      refactorBtn.style.cursor = 'wait';
    }
    if (cancelRefactorBtn) {
      cancelRefactorBtn.style.display = 'none';
    }
    if (summaryBtn) {
      summaryBtn.disabled = true;
      summaryBtn.innerHTML = `${sparkIconSvg} ${t('editor.aiSummaryShort') || 'AI'}`;
      summaryBtn.title = t('editor.aiSummaryDisabledDuringRefactor') || 'Disabled during note refactoring';
      summaryBtn.style.opacity = '0.5';
      summaryBtn.style.cursor = 'not-allowed';
    }
  } else {
    // idle state
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `${checkIconSvg} ${t('editor.aiCheck') || 'AI Check'}`;
      btn.title = t('editor.aiCheckTooltip') || 'Check grammar, typos, and extract tasks & decisions without altering the note structure';
      btn.style.opacity = '1';
      btn.style.cursor = '';
      btn.onclick = analyzeCurrentNoteWithLLM;
    }
    if (fbtn) {
      fbtn.disabled = false;
      fbtn.innerHTML = `${checkIconSvg} ${t('editor.aiCheck') || 'AI Check'}`;
      fbtn.title = t('editor.aiFloatingBtnTooltip') || 'Open Secretary AI floating assistant';
    }
    if (refactorBtn) {
      refactorBtn.disabled = false;
      refactorBtn.innerHTML = `${sparkIconSvg} ${t('editor.aiRefactorNote') || 'Perfect Note'}`;
      refactorBtn.title = t('editor.aiRefactorTooltip') || 'Refactor into a perfectly structured note with A/B proposals, rich formatting, and clarification questions';
      refactorBtn.style.opacity = '1';
      refactorBtn.style.cursor = '';
      refactorBtn.onclick = refactorCurrentNoteWithLLM;
    }
    if (cancelRefactorBtn) {
      cancelRefactorBtn.style.display = 'none';
    }
    if (summaryBtn) {
      summaryBtn.disabled = false;
      summaryBtn.innerHTML = `${sparkIconSvg} ${t('editor.aiSummaryShort') || 'AI'}`;
      summaryBtn.title = t('editor.aiSummaryTooltip') || 'Generate summary with AI';
      summaryBtn.style.opacity = '1';
      summaryBtn.style.cursor = '';
      summaryBtn.onclick = () => {
        if (typeof generateNoteSummaryWithAI === 'function') generateNoteSummaryWithAI();
      };
    }
  }
}

function updateLLMToolbarVisibility() {
  const btn = document.getElementById('btn-ai-analyze');
  const refactorBtn = document.getElementById('btn-ai-refactor');
  const summaryBtn = document.getElementById('btn-generate-summary-ai');
  if (!btn && !refactorBtn && !summaryBtn) return;
  const overlay = document.getElementById('note-edit-overlay');
  const inOverlay = overlay && (
    overlay.style.display === 'flex' ||
    overlay.classList.contains('active') ||
    document.body.classList.contains('focused-note-mode') ||
    document.body.classList.contains('note-window-standalone') ||
    (typeof currentNote !== 'undefined' && currentNote && overlay.style.display !== 'none')
  );
  const inDailyReview = document.getElementById('daily-review-panel')?.style.display === 'flex';
  const isViewMode = document.querySelector('.overlay-panel')?.classList.contains('overlay-view-mode');
  const isAiEnabled = typeof LLMService !== 'undefined' && LLMService.isEnabled();
  const shouldShow = !!((inOverlay || inDailyReview) && !isViewMode);

  syncAiEditorButtonState();
  if (btn) btn.style.display = shouldShow ? 'inline-flex' : 'none';
  if (refactorBtn) refactorBtn.style.display = (shouldShow && isAiEnabled) ? 'inline-flex' : 'none';
  if (summaryBtn) summaryBtn.style.display = (shouldShow && isAiEnabled) ? 'inline-flex' : 'none';

  // Toggle editor preview tabs based on whether LLM service is enabled
  const tabsHeader = document.querySelector('.inspector-tabs');
  if (tabsHeader) {
    tabsHeader.style.display = (isAiEnabled || !isViewMode) ? 'flex' : 'none';
  }

  if (typeof syncLLMEditorControls === 'function') {
    syncLLMEditorControls();
  }
  if (typeof AIChatController !== 'undefined' && AIChatController && typeof AIChatController.syncThinkingControls === 'function') {
    AIChatController.syncThinkingControls();
  }
}

function getPendingSummaryProposal(note = currentNote) {
  if (!note) return null;
  const state = getAiState(note);
  const cards = Array.isArray(state.proposalCards) ? state.proposalCards : [];
  const states = Array.isArray(state.proposalStates) ? state.proposalStates : [];
  const idx = cards.findIndex((card, i) => card.kind === 'summary' && (states[i] || 'pending') === 'pending');
  if (idx !== -1) {
    return { card: cards[idx], index: idx };
  }
  return null;
}

function updateMetadataSummaryProposalUI(note = currentNote) {
  const proposal = getPendingSummaryProposal(note);
  const proposalEl = document.getElementById('metadata-summary-proposal');
  const indicatorEl = document.getElementById('edit-meta-proposal-indicator');

  if (!proposalEl) return;

  if (proposal) {
    const bodyEl = proposalEl.querySelector('.proposal-body');
    if (bodyEl) {
      bodyEl.textContent = proposal.card.body || '';
    }
    const acceptBtn = document.getElementById('btn-accept-summary-proposal');
    if (acceptBtn) {
      acceptBtn.onclick = (e) => {
        e.stopPropagation();
        applyMetadataSummaryProposal(proposal.index);
      };
    }
    const rejectBtn = document.getElementById('btn-reject-summary-proposal');
    if (rejectBtn) {
      rejectBtn.onclick = (e) => {
        e.stopPropagation();
        rejectMetadataSummaryProposal(proposal.index);
      };
    }
    proposalEl.style.display = 'block';
  } else {
    proposalEl.style.display = 'none';
  }

  if (indicatorEl) {
    indicatorEl.style.display = 'none';
    indicatorEl.innerHTML = '';
  }
}

function applyMetadataSummaryProposal(index) {
  setAiSuggestionProposalState(index, 'applied');
}

function rejectMetadataSummaryProposal(index) {
  setAiSuggestionProposalState(index, 'dropped');
}

function renderLeftPaneSuggestions(note = currentNote) {
  if (typeof updateMetadataSummaryProposalUI === 'function') {
    updateMetadataSummaryProposalUI(note);
  }
}

function renderAiSuggestions(result, note = currentNote) {
  const parsedPayload = result?.parsed && typeof result.parsed === 'object' ? result.parsed : (result || {});
  const payload = tryNormalizeParsedPayload(parsedPayload) || parsedPayload;
  const cards = buildLLMSuggestionCards(payload);
  const state = getAiState(note);
  const previousCards = Array.isArray(state.proposalCards) ? state.proposalCards : [];
  const previousStates = Array.isArray(state.proposalStates) ? state.proposalStates : [];
  const proposalStates = cards.map((card, idx) => {
    const sameAsBefore = previousCards[idx] && JSON.stringify(previousCards[idx]) === JSON.stringify(card);
    return sameAsBefore ? (previousStates[idx] || 'pending') : 'pending';
  });

  state.lastPayload = payload;
  state.proposalCards = cards;
  state.proposalStates = proposalStates;

  // Insert the suggestions inline in the note text!
  if (typeof insertInlineProposals === 'function') {
    insertInlineProposals(note);
  }

  // Render left pane suggestions (like the summary proposal)
  renderLeftPaneSuggestions(note);

  if (typeof syncPreview === 'function') {
    syncPreview();
  }
}

function setAiSuggestionProposalState(index, nextState, note = currentNote) {
  const state = getAiState(note);
  const cards = Array.isArray(state.proposalCards) ? state.proposalCards : [];
  const states = Array.isArray(state.proposalStates) ? state.proposalStates : [];
  const card = cards[index];
  if (!card) return;
  if (!['pending', 'applied', 'dropped'].includes(nextState)) return;

  if (nextState === 'applied') {
    if (!applyAiSuggestion(index, note)) return;
  }

  states[index] = nextState;
  state.proposalStates = states;

  // Render both panes to remove the card or update state
  renderLeftPaneSuggestions(note);
  if (typeof refreshEditorAndPreviewWithCorrections === 'function') {
    refreshEditorAndPreviewWithCorrections(note);
  } else if (typeof syncPreview === 'function') {
    syncPreview();
  }
}

function updateAiSuggestionReplacement(index, newText, note = currentNote) {
  const state = getAiState(note);
  const cards = Array.isArray(state.proposalCards) ? state.proposalCards : [];
  const card = cards[index];
  if (!card) return;

  const value = String(newText || '');
  if (card.properties) {
    card.properties.replacement_text = value;
    if (card.properties.diff) {
      const props = normalizeTextCorrectionProps(card.properties);
      const target = props.target_string;
      card.properties.diff = `-${target}\n+${value}`;
    }
  }

  state.proposalCards = cards;

  // Render both panes to sync the updated correction
  renderLeftPaneSuggestions(note);
  if (typeof refreshEditorAndPreviewWithCorrections === 'function') {
    refreshEditorAndPreviewWithCorrections(note);
  } else if (typeof syncPreview === 'function') {
    syncPreview();
  }
}

function setAiSuggestionAssignee(index, assignee, note = currentNote) {
  const state = getAiState(note);
  const cards = Array.isArray(state.proposalCards) ? state.proposalCards : [];
  const card = cards[index];
  if (!card || card.kind !== 'action' || card.action !== 'create_todo') return;
  if (!card.properties || typeof card.properties !== 'object') card.properties = {};

  const value = String(assignee || '').trim();
  card.properties.assignee = value || null;
  state.proposalCards = cards;
  renderLeftPaneSuggestions(note);
  if (typeof syncPreview === 'function') {
    syncPreview();
  }
}

function insertAiSuggestionIntoNote(index) {
  return applyAiSuggestion(index);
}

function applyAiSuggestion(index, note = currentNote) {
  const state = getAiState(note);
  const cards = Array.isArray(state.proposalCards) ? state.proposalCards : [];
  const card = cards[index];
  const textarea = document.getElementById('edit-textarea');
  if (!card || !textarea) return false;

  try {
    if (card.kind === 'summary') {
      const block = formatPostCallNoteBlock(card);
      if (!writeSummaryMetadataHTML(block)) {
        toast(llmText('llm.summaryApplyFailed', 'Summary could not be applied to metadata summary.'), true);
        return false;
      }
      toast(llmText('llm.summaryApplied', 'Meeting summary applied to metadata summary.'));
      return true;
    }

    if (card.kind === 'action') {
      if (card.action === 'create_todo') {
        const props = card.properties || {};
        const title = String(props.title || 'Untitled task').trim();
        const priority = String(props.priority || 'Medium').trim();
        const todoId = String(card.todoId || '').trim() || (typeof generateTodoId === 'function'
          ? generateTodoId()
          : `ntodo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
        
        card.todoId = todoId; // ensure formatting function uses this ID!

        const date = new Date().toISOString().slice(0, 10);
        const noteWs = (note && typeof getNoteWorkstreamName === 'function')
          ? getNoteWorkstreamName(note)
          : (note?.workstream || (Array.isArray(note?.workstreams) ? note.workstreams[0] : '') || '');
        const newTodo = {
          id: todoId,
          title: title,
          priority: priority,
          status: undefined,
          owner: 'me',
          noteId: note.id || '',
          noteTodoMarkerId: todoId,
          workstream: noteWs || '',
          major_topic_tags: noteWs ? [noteWs] : [],
          context: '',
          created: date,
          modified: date,
        };

        if (!todosManifest.some(t => t.id === todoId)) {
          todosManifest.push(newTodo);
          if (typeof saveTodosManifest === 'function') {
            saveTodosManifest().then(() => {
              if (typeof renderBoard === 'function') renderBoard();
            });
          }
        }
      }

      const block = formatPostCallNoteBlock(card);
      if (!block) {
        toast(llmText('llm.suggestionNotConvertible', 'Suggestion could not be converted to post-call notes.'), true);
        return false;
      }
      if (!appendHTMLToEditor(textarea, block)) {
        toast(llmText('llm.suggestionNotAdded', 'Suggestion could not be added to post-call notes.'), true);
        return false;
      }
      if (card.action === 'create_todo') {
        toast(llmText('llm.todoAddedToPostCallNotes', 'Todo added to post-call notes.'));
      } else if (card.action === 'log_decision') {
        toast(llmText('llm.decisionAddedToPostCallNotes', 'Decision added to post-call notes.'));
      } else {
        toast(llmText('llm.suggestionAddedToPostCallNotes', 'Suggestion added to post-call notes.'));
      }
      return true;
    }

    if (card.kind === 'text_correction') {
      if (!applyTextCorrectionToEditor(textarea, card.properties || {})) {
        toast(llmText('llm.correctionNotApplied', 'Correction could not be applied to the note.'), true);
        return false;
      }
      toast(llmText('llm.correctionApplied', 'Correction applied to the note.'));
      return true;
    }

    if (card.kind === 'text_mutation_group') {
      const mutations = Array.isArray(card.mutations) ? card.mutations : [];
      if (!mutations.length) {
        toast(llmText('llm.noTextMutations', 'No text mutations to apply.'), true);
        return false;
      }
      if (!applyTextMutationGroupToEditor(textarea, mutations)) {
        toast(llmText('llm.textMutationsNotApplied', 'Text mutations could not be applied to the note.'), true);
        return false;
      }
      toast(llmText('llm.textMutationsApplied', 'Text mutations applied to the note.'));
      return true;
    }

    toast(llmText('llm.unsupportedSuggestionType', 'Unsupported suggestion type.'), true);
    return false;
  } catch (err) {
    console.error('Apply AI suggestion failed', err);
    toast(llmText('llm.couldNotApplySuggestion', 'Could not apply suggestion: {message}').replace('{message}', err.message), true);
    return false;
  }
}

function dropAiSuggestion(index) {
  const state = getAiState();
  const states = Array.isArray(state.proposalStates) ? state.proposalStates : [];
  if (typeof states[index] === 'undefined') return;
  states[index] = 'dropped';
  state.proposalStates = states;

  if (typeof syncPreview === 'function') {
    syncPreview();
  }
}

async function analyzeCurrentNoteWithLLM() {
  let note = currentNote;
  let summaryQueued = false;
  try {
    if (!LLMService.isEnabled()) {
      toast(llmText('llm.disabledToast', 'Local LLM is disabled. Enable it in Preferences first.'), true);
      return;
    }
    if (!currentNote) {
      toast(llmText('llm.noActiveNote', 'No active note to analyze.'), true);
      return;
    }

    const textArea = document.getElementById('edit-textarea');
    // Send plain text to LLM so target_string in corrections matches what the user sees
    discardAllPendingProposals(note);
    let noteContent = getCleanEditorText();
    const effort = 'medium';
    if (!noteContent || noteContent.trim().length < 3) {
      const titleStr = note.title || 'Untitled Note';
      const groupStr = (note.group_tags || []).join(', ');
      const topicStr = (note.topic_tags || []).join(', ');
      noteContent = `Title: ${titleStr}. ${groupStr ? 'Group: ' + groupStr + '. ' : ''}${topicStr ? 'Topics: ' + topicStr + '. ' : ''}Draft structured meeting notes, decisions, and action items.`;
    }

    if (typeof setAiActionState === 'function') {
      setAiActionState('analyzing');
    }

    const reviewTitle = llmText('llm.reviewingNote', 'Reviewing note...');
    if (typeof RefactorModalController !== 'undefined' && typeof RefactorModalController.updateRefactorProgress === 'function') {
      RefactorModalController.updateRefactorProgress(25, reviewTitle, '', reviewTitle);
    }

    const requestController = new AbortController();
    setActiveAiRequest(note, {
      controller: requestController,
      kind: 'analysis',
      thinkingMessage: reviewTitle
    });
    renderAiConversationLane(note);

    // Record last analyze request for retry support
    try { getAiState(note).lastPayload = { type: 'analyze' }; } catch (e) { }
    const result = await LLMService.analyzeNote(note, noteContent, {
      controller: requestController,
      timeoutMs: 0,
      reasoningEffort: effort
    });

    if (typeof RefactorModalController !== 'undefined' && typeof RefactorModalController.updateRefactorProgress === 'function') {
      RefactorModalController.updateRefactorProgress(85, llmText('llm.analysisComplete', 'Local LLM analysis complete.'), result.reasoningText || '', reviewTitle);
    }

    if (isSameAiNote(note)) {
      renderAiSuggestions(result.parsed || result, note);
    }
    appendAiConversationTurn('user', llmText('llm.analyzePrompt', 'Analyze this note and propose improvements/actions.'), null, note);
    appendAiConversationTurn('assistant', result.reply || JSON.stringify(result.parsed || {}, null, 2), result.parsed || null, note);
    // Clear last payload on successful analyze
    try { getAiState(note).lastPayload = null; } catch (e) { }
    toast(llmText('llm.analysisComplete', 'Local LLM analysis complete.'));
  } catch (err) {
    if (err && err.name === 'AbortError') {
      appendAiConversationTurn('assistant', llmText('llm.stopped', 'Generation stopped.'), null, note);
      return;
    }
    console.error('LLM analyze failed', err);
    const isTokenLimit = err?.isTokenLimit || err?.category === 'token_limit';
    const errorMsg = isTokenLimit
      ? llmText('llm.errorTokenLimit', "Token limit reached: the note or conversation exceeds the model's context window. Please shorten the note, reduce conversation history, or select a model with a larger context size.")
      : `${llmText('llm.errorPrefix', 'Error')}: ${err?.message || llmText('llm.unknownError', 'Unknown LLM error')}`;

    appendAiConversationTurn('assistant', errorMsg, null, note);
    renderAiErrorPanel(errorMsg);
    toast(isTokenLimit ? errorMsg : `${llmText('llm.analysisFailed', 'LLM analysis failed')}: ${err.message}`, true);
  } finally {
    if (typeof RefactorModalController !== 'undefined' && typeof RefactorModalController.updateRefactorProgress === 'function') {
      RefactorModalController.updateRefactorProgress(false);
    }
    clearActiveAiRequest(note);
    if (isSameAiNote(note)) {
      if (typeof renderAiConversationLane === 'function') {
        renderAiConversationLane(note);
      }
    }
    if (typeof setAiActionState === 'function') {
      setAiActionState('idle');
    }
  }
}

async function testLocalLLMConnection() {
  const btn = document.getElementById('btn-test-ai-connection');
  const statusEl = document.getElementById('prefs-ai-test-status');
  const resultContainer = document.getElementById('prefs-ai-test-result');

  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ ' + (t('llm.testStatusTesting') || 'Testing...');
  }
  if (statusEl) {
    statusEl.className = 'prefs-ai-status-badge prefs-ai-status-badge--testing';
    statusEl.textContent = '⏳ ' + (t('llm.testStatusTesting') || 'Testing...');
  }
  if (resultContainer) {
    resultContainer.style.display = 'none';
    resultContainer.innerHTML = '';
  }

  try {
    const result = await LLMService.testConnection();

    if (statusEl) {
      statusEl.className = 'prefs-ai-status-badge prefs-ai-status-badge--success';
      statusEl.textContent = '✓ ' + (t('llm.connectionOkMs') || 'OK in {ms} ms').replace('{ms}', String(result.elapsedMs));
    }

    if (resultContainer) {
      resultContainer.style.display = 'block';
      const successTitle = escH(t('llm.testSuccessTitle') || 'Connection Successful');
      const responseTimeLabel = escH(t('llm.testResponseTime') || 'Response time');
      const endpointLabel = escH(t('llm.testEndpoint') || 'Endpoint');
      const modelLabel = escH(t('llm.testModel') || 'Model');
      const providerLabel = escH(t('llm.testProvider') || 'Provider');
      const replyLabel = escH(t('llm.testReply') || 'Response');

      resultContainer.innerHTML = `
        <div class="prefs-ai-test-card prefs-ai-test-card--success">
          <div class="prefs-ai-test-card-header">
            <div class="prefs-ai-test-card-title">
              <span>✓</span>
              <span>${successTitle}</span>
            </div>
            <span class="prefs-ai-test-card-badge">${result.elapsedMs} ms</span>
          </div>
          <div class="prefs-ai-test-card-grid">
            <span class="grid-label">${endpointLabel}:</span>
            <span class="grid-value">${escH(result.endpoint || '-')}</span>
            <span class="grid-label">${modelLabel}:</span>
            <span class="grid-value">${escH(result.model || '-')}</span>
            <span class="grid-label">${providerLabel}:</span>
            <span class="grid-value">${escH(result.provider || '-')}</span>
            ${result.reply ? `
            <span class="grid-label">${replyLabel}:</span>
            <span class="grid-value">"${escH(result.reply.slice(0, 150))}"</span>
            ` : ''}
          </div>
        </div>
      `;
    }

    toast(llmText('llm.localReachableMs', 'Local LLM reachable ({ms} ms).').replace('{ms}', String(result.elapsedMs)));
  } catch (err) {
    const errorMsg = (err && err.message) ? err.message : String(err);
    if (statusEl) {
      statusEl.className = 'prefs-ai-status-badge prefs-ai-status-badge--error';
      statusEl.textContent = '✕ ' + (t('llm.testStatusFailed') || 'Connection failed');
    }

    // Determine actionable suggestion
    let suggestionText = '';
    const status = err?.status;
    if (err?.isNetworkError || /Network error|Failed to fetch|fetch failed|ECONNREFUSED|ENOTFOUND/i.test(errorMsg)) {
      suggestionText = t('llm.hintNetwork') || 'Make sure your server is running and accessible (check URL and CORS).';
    } else if (status === 401 || status === 403 || /unauthorized|forbidden|api key|key invalid|incorrect api key/i.test(errorMsg)) {
      suggestionText = t('llm.hintAuth') || 'Check that your API key is correctly entered in the settings above.';
    } else if (status === 404 || /not found|unknown model|model not found/i.test(errorMsg)) {
      suggestionText = t('llm.hintNotFound') || 'Check if the endpoint route or model name is correct for this provider.';
    } else if (err?.isTimeout || /timed out/i.test(errorMsg)) {
      suggestionText = t('llm.hintTimeout') || 'The server did not respond in time. Verify the model is loaded and ready.';
    }

    if (resultContainer) {
      resultContainer.style.display = 'block';
      const failedTitle = escH(t('llm.testFailedTitle') || 'Connection Error');
      const endpointLabel = escH(t('llm.testEndpoint') || 'Endpoint');
      const modelLabel = escH(t('llm.testModel') || 'Model');
      const suggestionLabel = escH(t('llm.suggestion') || 'Suggestion');
      const copyBtnText = escH(t('llm.copyError') || 'Copy error details');
      const copyBtnTooltip = escH(t('llm.copyErrorTooltip') || 'Copy error message and details to clipboard');

      resultContainer.innerHTML = `
        <div class="prefs-ai-test-card prefs-ai-test-card--error">
          <div class="prefs-ai-test-card-header">
            <div class="prefs-ai-test-card-title">
              <span>✕</span>
              <span>${failedTitle}</span>
            </div>
            ${err?.status ? `<span class="prefs-ai-test-card-badge">HTTP ${err.status}</span>` : ''}
          </div>
          <div class="prefs-ai-test-error-box">${escH(errorMsg)}</div>
          <div class="prefs-ai-test-card-grid">
            <span class="grid-label">${endpointLabel}:</span>
            <span class="grid-value">${escH(err?.endpoint || '-')}</span>
            <span class="grid-label">${modelLabel}:</span>
            <span class="grid-value">${escH(err?.model || '-')}</span>
          </div>
          ${suggestionText ? `
          <div class="prefs-ai-test-suggestion">
            <span>💡</span>
            <div><strong>${suggestionLabel}:</strong> ${escH(suggestionText)}</div>
          </div>
          ` : ''}
          <div class="prefs-ai-test-card-actions">
            <button class="btn" id="btn-copy-ai-test-error" onclick="copyAiTestError(this)" title="${copyBtnTooltip}" style="padding:.25rem .6rem;font-size:.74rem;">
              📋 ${copyBtnText}
            </button>
          </div>
        </div>
      `;
      // Store full error on element for copying
      resultContainer._lastErrorDetails = `Error: ${errorMsg}\nEndpoint: ${err?.endpoint || '-'}\nModel: ${err?.model || '-'}\nProvider: ${err?.provider || '-'}\nRequest URL: ${err?.requestUrl || '-'}`;
    }

    toast(llmText('llm.localTestFailedMessage', 'Local LLM test failed: {message}').replace('{message}', errorMsg), true);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🧪 ' + (t('llm.testConnection') || 'Test connection');
    }
  }
}

function copyAiTestError(btnEl) {
  const resultContainer = document.getElementById('prefs-ai-test-result');
  const details = resultContainer?._lastErrorDetails || '';
  if (details) {
    navigator.clipboard.writeText(details).then(() => {
      toast(t('llm.errorCopied') || 'Error copied to clipboard!');
      if (btnEl) {
        const originalText = btnEl.innerHTML;
        btnEl.textContent = '✓ ' + (t('llm.errorCopied') || 'Copied');
        setTimeout(() => {
          if (btnEl) btnEl.innerHTML = originalText;
        }, 2000);
      }
    }).catch(() => {
      toast(t('llm.errorCopied') || 'Error copied to clipboard!');
    });
  }
}
window.copyAiTestError = copyAiTestError;

let _cancelBulkSummaries = false;

async function runBulkAISummaries() {
  if (!LLMService.isEnabled()) {
    toast(llmText('llm.bulkDisabled', 'Local AI is disabled. Enable it in Preferences.'), true);
    return;
  }

  const weeksInput = document.getElementById('bulk-summary-weeks');
  const weeks = parseInt(weeksInput?.value || '4');
  if (isNaN(weeks) || weeks < 1) {
    toast(llmText('llm.bulkInvalidWeeks', 'Invalid number of weeks.'), true);
    return;
  }

  // Calculate Date Cutoff
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - (weeks * 7));
  const cutoffStr = cutoffDate.toISOString().slice(0, 10); // YYYY-MM-DD

  // Filter notes from manifest
  const candidateNotes = manifest.filter(note => {
    if (!note.date || !note.path) return false;
    const hasSummary = typeof note.summary === 'string' && note.summary.trim().length > 0;
    return note.date >= cutoffStr && !hasSummary;
  });

  if (candidateNotes.length === 0) {
    toast(llmText('llm.bulkNoNotes', 'No notes without summary found in the specified period.'));
    return;
  }

  const msg = llmText('llm.bulkConfirm', 'Do you want to generate AI summaries for {count} notes?', { count: candidateNotes.length });
  const confirmLabel = llmText('llm.bulkConfirmLabel', 'Generate');
  const cancelLabel = llmText('llm.bulkCancelLabel', 'Cancel');

  const confirmed = await showConfirmDialog(msg, { confirmLabel, cancelLabel });
  if (!confirmed) return;

  const controlsEl = document.getElementById('bulk-summary-controls');
  const progressContainerEl = document.getElementById('bulk-summary-progress-container');
  const progressTextEl = document.getElementById('bulk-summary-progress-text');
  const progressBarEl = document.getElementById('bulk-summary-progress-bar');

  if (controlsEl) controlsEl.style.display = 'none';
  if (progressContainerEl) progressContainerEl.style.display = 'flex';
  if (progressBarEl) progressBarEl.style.width = '0%';

  _cancelBulkSummaries = false;
  let processedCount = 0;
  let successCount = 0;

  for (const note of candidateNotes) {
    if (_cancelBulkSummaries) {
      break;
    }

    if (progressTextEl) {
      progressTextEl.textContent = llmText('llm.bulkGeneratingProgress', 'Generating: {processed}/{total} ({title})', {
        processed: processedCount,
        total: candidateNotes.length,
        title: note.title || llmText('llm.untitled', 'Untitled')
      });
    }

    try {
      const html = (typeof StorageAPI !== 'undefined' && typeof StorageAPI.readNoteContent === 'function') ? await StorageAPI.readNoteContent(note.path) : await readFile(note.path);
      const parsed = parseNoteHTML(html);
      const summary = await LLMService.generateNoteSummary(note, parsed.mainHTML || '');

      if (summary && summary.trim().length > 0) {
        await updateNoteAtPath(note.path, async (data) => {
          data.summary = summary;
          return data;
        });
        successCount++;
      }
    } catch (err) {
      console.error(`Failed to generate bulk summary for note ${note.path}:`, err);
    }

    processedCount++;
    const pct = Math.round((processedCount / candidateNotes.length) * 100);
    if (progressBarEl) progressBarEl.style.width = `${pct}%`;
  }

  if (successCount > 0) {
    await saveManifest();
    await rebuildIndexHTML();
    if (typeof renderBoard === 'function') {
      renderBoard();
    }
  }

  if (controlsEl) controlsEl.style.display = 'flex';
  if (progressContainerEl) progressContainerEl.style.display = 'none';

  if (_cancelBulkSummaries) {
    toast(llmText('llm.bulkCancelledToast', 'Generation cancelled. {count} summaries generated.', { count: successCount }));
  } else {
    toast(llmText('llm.bulkCompleteToast', 'Generation complete. {count} summaries successfully generated.', { count: successCount }));
  }
}

function cancelBulkAISummaries() {
  _cancelBulkSummaries = true;
  const progressTextEl = document.getElementById('bulk-summary-progress-text');
  if (progressTextEl) progressTextEl.textContent = llmText('llm.bulkCancelling', 'Cancelling...');
}

function applyInlineDiffsToMarkdown(md, note) {
  const state = getAiState(note);
  const cards = Array.isArray(state.proposalCards) ? state.proposalCards : [];
  const states = Array.isArray(state.proposalStates) ? state.proposalStates : [];

  let nextMd = md;

  // Find all match locations first to avoid index shifting during edits
  const matches = [];
  cards.forEach((card, idx) => {
    const s = states[idx] || 'pending';
    if (s !== 'pending') return;

    if (card.kind === 'text_correction') {
      const props = normalizeTextCorrectionProps(card.properties);
      const target = props.target_string;
      if (!target) return;

      const match = findTextCorrectionMatch(nextMd, props);
      if (match) {
        matches.push({
          card,
          idx,
          props,
          index: match.index,
          length: match.length
        });
      }
    }
  });

  // Sort matches by index descending (bottom to top)
  matches.sort((a, b) => b.index - a.index);

  const processedRanges = [];

  // Apply replacements from bottom to top
  for (const m of matches) {
    const start = m.index;
    const end = m.index + m.length;

    // Safety check: skip if this correction overlaps with an already processed range
    const hasOverlap = processedRanges.some(r => !(end <= r.start || start >= r.end));
    if (hasOverlap) continue;
    processedRanges.push({ start, end });

    const target = m.props.target_string;
    const replacement = m.props.replacement_text;
    const { originalHTML, replacementHTML } = highlightWordDiff(target, replacement);

    // Render the inline correction wrapper (red and green lines with a hover accept/decline menu)
    const inlineHTML = `
<span class="inline-correction-wrapper" data-card-index="${m.idx}" contenteditable="false">
  <span class="inline-correction-del-line">${originalHTML}</span>
  <span class="inline-correction-ins-line">${replacementHTML}</span>
  <span class="inline-correction-hover-actions">
    <button class="inline-hover-btn btn-accept" onclick="event.stopPropagation(); window.applyInlineCorrectionFromMenu(${m.idx})">✓ Accept</button>
    <button class="inline-hover-btn btn-reject" onclick="event.stopPropagation(); window.rejectInlineCorrectionFromMenu(${m.idx})">✗ Decline</button>
  </span>
</span>`.replace(/\n/g, ' ').trim();

    nextMd = nextMd.slice(0, m.index) + inlineHTML + nextMd.slice(m.index + m.length);
  }

  // Recognize and append new action proposals inline
  let additions = '';
  cards.forEach((card, idx) => {
    const s = states[idx] || 'pending';
    if (s !== 'pending') return;

    if (card.kind === 'action') {
      if (card.action === 'create_todo') {
        const text = card.properties?.title || card.properties?.text || card.properties?.context || 'Todo';
        const priority = card.properties?.priority || 'Medium';
        const owner = card.properties?.owner || card.properties?.colleague || card.properties?.person || 'me';
        const ownerLabel = owner === 'me' ? '@me' : `@${owner.replace(/^@/, '')}`;
        const reassignTooltip = typeof t === 'function' ? (t('todo.reassignColleagueTooltip') || 'Click to reassign colleague') : 'Click to reassign colleague';
        const todoId = card.todoId || card.properties?.id || 'proposed-' + idx;
        const optionsHTML = `<span class="todo-urgency-options"><span class="todo-urgency-opt" onclick="event.stopPropagation(); window.setTodoUrgencyInline(this, 'High')">High</span><span class="todo-urgency-opt" onclick="event.stopPropagation(); window.setTodoUrgencyInline(this, 'Medium')">Medium</span><span class="todo-urgency-opt" onclick="event.stopPropagation(); window.setTodoUrgencyInline(this, 'Low')">Low</span></span>`;
        const todoHTML = `<span class="note-todo note-todo-proposed" data-todo-id="${todoId}" data-todo-priority="${priority}" data-owner="${escA(owner)}" contenteditable="false"><span class="todo-urgency-label" contenteditable="false">todo urgency: <span class="todo-urgency-value-wrapper"><span class="todo-urgency-value">${priority}</span>${optionsHTML}</span></span> <span class="note-todo-badge owner-tag inline-reassign-owner" contenteditable="false" title="${escA(reassignTooltip)}">👤 ${escH(ownerLabel)}</span> <span class="note-todo-text" contenteditable="false">${text}</span></span>`;

        additions += `\n\n<span class="inline-proposal-wrapper inline-proposal-todo inline-todo-proposal" data-proposal-type="todo" data-todo-title="${escA(text)}" data-todo-priority="${escA(priority)}" data-todo-owner="${escA(owner)}" data-card-index="${idx}" contenteditable="false">${todoHTML}<span class="inline-proposal-hover-actions"><button class="inline-hover-btn btn-accept" type="button" onclick="event.stopPropagation(); event.preventDefault(); window.acceptInlineProposal(this)">✓ Accept</button><button class="inline-hover-btn btn-reject" type="button" onclick="event.stopPropagation(); event.preventDefault(); window.rejectInlineProposal(this)">✕ Decline</button></span></span>`;
      } else if (card.action === 'log_decision') {
        const text = card.properties?.text || card.properties?.title || 'Decision';
        const status = card.properties?.status || 'active';
        const badgeHTML = `<strong class="pill-decision pill-decision-${status}" contenteditable="false">!decision:${status}</strong>`;
        const decisionHTML = `<span class="note-decision-wrapper note-decision-proposed" data-decision-status="${status}" data-decision-text="" contenteditable="false">${badgeHTML} <span class="note-decision-text" contenteditable="false">${text}</span></span>`;

        additions += `\n\n<span class="inline-proposal-wrapper inline-proposal-decision inline-decision-proposal" data-proposal-type="decision" data-decision-title="${escA(text)}" data-decision-status="${escA(status)}" data-card-index="${idx}" contenteditable="false">${decisionHTML}<span class="inline-proposal-hover-actions"><button class="inline-hover-btn btn-accept" type="button" onclick="event.stopPropagation(); event.preventDefault(); window.acceptInlineProposal(this)">✓ Accept</button><button class="inline-hover-btn btn-reject" type="button" onclick="event.stopPropagation(); event.preventDefault(); window.rejectInlineProposal(this)">✕ Decline</button></span></span>`;
      }
    }
  });

  if (additions) {
    nextMd = nextMd.trim() + additions;
  }

  return nextMd;
}

function refreshEditorAndPreviewWithCorrections(note = currentNote) {
  const ta = document.getElementById('edit-textarea');
  if (ta) {
    // 1. Remove existing inline-correction-wrapper elements to revert to clean text state
    ta.querySelectorAll('.inline-correction-wrapper').forEach(el => {
      // Replaces the element with its children nodes to preserve editor content editable text.
      const children = Array.from(el.childNodes);
      // Keep only text nodes or valid content elements inside
      const fragment = document.createDocumentFragment();
      for (const child of children) {
        // Skip hover-actions or metadata indicators
        if (child.classList && (child.classList.contains('inline-correction-hover-actions') || child.classList.contains('inline-correction-del-line'))) {
          continue;
        }
        if (child.classList && child.classList.contains('inline-correction-ins-line')) {
          // If the correction was previously applied/visible, we keep the replacement or original text.
          // Wait, if it is pending, we keep the original text nodes from del-line if we are resetting to base state.
          // The cleanest revert is extracting the text content or child elements from original node if available.
          continue;
        }
        fragment.appendChild(child);
      }
      
      // Let's get the original text node inside del-line to revert back to original state
      const delLine = el.querySelector('.inline-correction-del-line');
      if (delLine) {
        // Append all child nodes of delLine to revert back to original text state
        const originalNodes = Array.from(delLine.childNodes);
        for (const on of originalNodes) {
          fragment.appendChild(on);
        }
      }
      
      el.replaceWith(fragment);
    });

    // Remove existing action proposals inline
    ta.querySelectorAll('.inline-proposal-wrapper').forEach(el => el.remove());

    // 2. Scan pending corrections and overlay them
    const state = getAiState(note);
    const cards = Array.isArray(state.proposalCards) ? state.proposalCards : [];
    const states = Array.isArray(state.proposalStates) ? state.proposalStates : [];

    const map = buildTextNodeMap(ta);
    const fullText = getSyncedFullText(map);

    const matches = [];
    cards.forEach((card, idx) => {
      const s = states[idx] || 'pending';
      if (s !== 'pending') return;

      if (card.kind === 'text_correction') {
        const props = normalizeTextCorrectionProps(card.properties);
        const target = props.target_string;
        if (!target) return;

        const match = findTextCorrectionMatch(fullText, props);
        if (match) {
          matches.push({
            card,
            idx,
            props,
            index: match.index,
            length: match.length
          });
        }
      }
    });

    // Sort matches descending by index to process bottom-to-top without offset desync
    matches.sort((a, b) => b.index - a.index);

    const processedRanges = [];

    for (const m of matches) {
      const start = m.index;
      const end = m.index + m.length;

      const hasOverlap = processedRanges.some(r => !(end <= r.start || start >= r.end));
      if (hasOverlap) continue;
      processedRanges.push({ start, end });

      const nodes = collectTargetNodes(map, m.index, m.length);
      if (nodes.length === 0) continue;

      const target = m.props.target_string;
      const replacement = m.props.replacement_text;
      const { originalHTML, replacementHTML } = highlightWordDiff(target, replacement);

      // Create inline correction wrapper element safely using DOM API
      const wrapper = document.createElement('span');
      wrapper.className = 'inline-correction-wrapper';
      wrapper.setAttribute('data-card-index', m.idx);
      wrapper.setAttribute('contenteditable', 'false');

      wrapper.innerHTML = `
        <span class="inline-correction-del-line">${originalHTML}</span>
        <span class="inline-correction-ins-line">${replacementHTML}</span>
        <span class="inline-correction-hover-actions">
          <button class="inline-hover-btn btn-accept" onclick="event.stopPropagation(); window.applyInlineCorrectionFromMenu(${m.idx})">✓ Accept</button>
          <button class="inline-hover-btn btn-reject" onclick="event.stopPropagation(); window.rejectInlineCorrectionFromMenu(${m.idx})">✗ Decline</button>
        </span>
      `;

      // Insert wrapper before first targeted text node
      const firstNode = nodes[0];
      firstNode.parentNode.insertBefore(wrapper, firstNode);

      // Move target nodes into the del-line wrapper to preserve them but keep them grouped, or remove them.
      // We will place them inside .inline-correction-del-line so they are clean when reverting.
      const delLineEl = wrapper.querySelector('.inline-correction-del-line');
      delLineEl.innerHTML = ''; // replace placeholder word diff with the actual text nodes
      for (const n of nodes) {
        delLineEl.appendChild(n);
      }
    }

    // 3. For new proposals (todos/decisions), append safely using insertAdjacentHTML
    cards.forEach((card, idx) => {
      const s = states[idx] || 'pending';
      if (s !== 'pending') return;

      if (card.kind === 'action') {
        if (card.action === 'create_todo') {
          const text = card.properties?.title || card.properties?.text || card.properties?.context || 'Todo';
          const priority = card.properties?.priority || 'Medium';
          const owner = card.properties?.owner || card.properties?.colleague || card.properties?.person || 'me';
          const ownerLabel = owner === 'me' ? '@me' : `@${owner.replace(/^@/, '')}`;
          const reassignTooltip = typeof t === 'function' ? (t('todo.reassignColleagueTooltip') || 'Click to reassign colleague') : 'Click to reassign colleague';
          const todoId = card.todoId || card.properties?.id || 'proposed-' + idx;
          const optionsHTML = `<span class="todo-urgency-options"><span class="todo-urgency-opt" onclick="event.stopPropagation(); window.setTodoUrgencyInline(this, 'High')">High</span><span class="todo-urgency-opt" onclick="event.stopPropagation(); window.setTodoUrgencyInline(this, 'Medium')">Medium</span><span class="todo-urgency-opt" onclick="event.stopPropagation(); window.setTodoUrgencyInline(this, 'Low')">Low</span></span>`;
          const todoHTML = `<span class="note-todo note-todo-proposed" data-todo-id="${todoId}" data-todo-priority="${priority}" data-owner="${escA(owner)}" contenteditable="false"><span class="todo-urgency-label" contenteditable="false">todo urgency: <span class="todo-urgency-value-wrapper"><span class="todo-urgency-value">${priority}</span>${optionsHTML}</span></span> <span class="note-todo-badge owner-tag inline-reassign-owner" contenteditable="false" title="${escA(reassignTooltip)}">👤 ${escH(ownerLabel)}</span> <span class="note-todo-text" contenteditable="false">${escH(text)}</span></span>`;

          const additions = `\n\n<span class="inline-proposal-wrapper inline-proposal-todo inline-todo-proposal" data-proposal-type="todo" data-todo-title="${escA(text)}" data-todo-priority="${escA(priority)}" data-todo-owner="${escA(owner)}" data-card-index="${idx}" contenteditable="false">${todoHTML}<span class="inline-proposal-hover-actions"><button class="inline-hover-btn btn-accept" type="button" onclick="event.stopPropagation(); event.preventDefault(); window.acceptInlineProposal(this)">✓ Accept</button><button class="inline-hover-btn btn-reject" type="button" onclick="event.stopPropagation(); event.preventDefault(); window.rejectInlineProposal(this)">✕ Decline</button></span></span>`;
          ta.insertAdjacentHTML('beforeend', additions);
        } else if (card.action === 'log_decision') {
          const text = card.properties?.text || card.properties?.title || 'Decision';
          const status = card.properties?.status || 'active';
          const badgeHTML = `<strong class="pill-decision pill-decision-${status}" contenteditable="false">!decision:${status}</strong>`;
          const decisionHTML = `<span class="note-decision-wrapper note-decision-proposed" data-decision-status="${status}" data-decision-text="" contenteditable="false">${badgeHTML} <span class="note-decision-text" contenteditable="false">${escH(text)}</span></span>`;

          const additions = `\n\n<span class="inline-proposal-wrapper inline-proposal-decision inline-decision-proposal" data-proposal-type="decision" data-decision-title="${escA(text)}" data-decision-status="${escA(status)}" data-card-index="${idx}" contenteditable="false">${decisionHTML}<span class="inline-proposal-hover-actions"><button class="inline-hover-btn btn-accept" type="button" onclick="event.stopPropagation(); event.preventDefault(); window.acceptInlineProposal(this)">✓ Accept</button><button class="inline-hover-btn btn-reject" type="button" onclick="event.stopPropagation(); event.preventDefault(); window.rejectInlineProposal(this)">✕ Decline</button></span></span>`;
          ta.insertAdjacentHTML('beforeend', additions);
        }
      }
    });

    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (typeof syncPreview === 'function') {
    syncPreview();
  }
}

function renderInlineAdditionsHTML(note = currentNote) {
  const state = getAiState(note);
  const cards = Array.isArray(state.proposalCards) ? state.proposalCards : [];
  const states = Array.isArray(state.proposalStates) ? state.proposalStates : [];

  let html = '';

  cards.forEach((card, idx) => {
    const s = states[idx] || 'pending';
    if (s !== 'pending') return;

    if (card.kind === 'action') {
      const block = formatPostCallNoteBlock(card);
      if (!block) return;

      // block is already HTML — render it directly
      html += `
<div class="inline-addition-simple" data-card-index="${idx}" onclick="event.stopPropagation(); window.showInlineCorrectionMenu(this, event)">
  ${block}
</div>
      `;
    }
  });

  return html;
}


let _activeInlineCorrectionMenu = null;

function closeInlineCorrectionMenu() {
  if (_activeInlineCorrectionMenu) {
    _activeInlineCorrectionMenu.remove();
    _activeInlineCorrectionMenu = null;
  }
  document.removeEventListener('click', _dismissInlineCorrectionMenu);
  document.removeEventListener('keydown', _escInlineCorrectionMenu);
}

function _dismissInlineCorrectionMenu(e) {
  if (_activeInlineCorrectionMenu && !_activeInlineCorrectionMenu.contains(e.target)) {
    closeInlineCorrectionMenu();
  }
}

function _escInlineCorrectionMenu(e) {
  if (e.key === 'Escape') closeInlineCorrectionMenu();
}

function showInlineCorrectionMenu(element, event) {
  event.preventDefault();
  event.stopPropagation();
  closeInlineCorrectionMenu();

  const cardIdx = parseInt(element.getAttribute('data-card-index'));
  const state = getAiState(currentNote);
  const cards = Array.isArray(state.proposalCards) ? state.proposalCards : [];
  const card = cards[cardIdx];
  if (!card) return;
  if (card.kind === 'summary') return;

  const props = normalizeTextCorrectionProps(card.properties);
  const annotation = props.annotation || card.properties?.annotation || '';

  const menu = document.createElement('div');
  menu.className = 'inline-correction-popup-menu';
  menu.style.position = 'absolute';
  menu.style.zIndex = 3000;

  const rect = element.getBoundingClientRect();
  const top = window.scrollY + rect.bottom + 5;
  const left = window.scrollX + rect.left;
  menu.style.top = top + 'px';
  menu.style.left = left + 'px';

  menu.innerHTML = `
    <div class="inline-correction-popup-content">
      ${annotation ? `<div class="inline-correction-popup-annotation">💡 ${escH(annotation)}</div>` : ''}
      <div class="inline-correction-popup-actions">
        <button class="inline-correction-btn inline-correction-accept" onclick="event.stopPropagation(); window.applyInlineCorrectionFromMenu(${cardIdx})">
          ✓ Accept
        </button>
        <button class="inline-correction-btn inline-correction-reject" onclick="event.stopPropagation(); window.rejectInlineCorrectionFromMenu(${cardIdx})">
          ✕ Reject
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(menu);
  _activeInlineCorrectionMenu = menu;

  setTimeout(() => {
    document.addEventListener('click', _dismissInlineCorrectionMenu);
    document.addEventListener('keydown', _escInlineCorrectionMenu);
  }, 0);
}

function applyInlineCorrectionFromMenu(index) {
  closeInlineCorrectionMenu();
  setAiSuggestionProposalState(index, 'applied');
}

function rejectInlineCorrectionFromMenu(index) {
  closeInlineCorrectionMenu();
  setAiSuggestionProposalState(index, 'dropped');
}

window.applyInlineProposal = function (index, note = currentNote) {
  const state = getAiState(note);
  const cards = Array.isArray(state.proposalCards) ? state.proposalCards : [];
  const states = Array.isArray(state.proposalStates) ? state.proposalStates : [];
  const card = cards[index];
  if (!card) return;

  states[index] = 'applied';
  state.proposalStates = states;

  const ta = document.getElementById('edit-textarea');
  if (ta) {
    let htmlBlock = '';
    if (card.action === 'create_todo') {
      const props = card.properties || {};
      let x = null;
      let y = null;

      if (typeof props.eisenhowerX === 'number' && Number.isFinite(props.eisenhowerX)) {
        x = Math.max(0, Math.min(100, props.eisenhowerX));
      } else if (typeof props.urgencyPct === 'number' && Number.isFinite(props.urgencyPct)) {
        x = Math.max(0, Math.min(100, 100 - props.urgencyPct));
      }

      if (typeof props.eisenhowerY === 'number' && Number.isFinite(props.eisenhowerY)) {
        y = Math.max(0, Math.min(100, props.eisenhowerY));
      } else if (typeof props.importancePct === 'number' && Number.isFinite(props.importancePct)) {
        y = Math.max(0, Math.min(100, 100 - props.importancePct));
      }

      let quadrant = props.quadrant || props.eisenhowerQuadrant;
      if (!quadrant && x !== null && y !== null && typeof EisenhowerUtils !== 'undefined' && EisenhowerUtils.getQuadrantFromCoords) {
        quadrant = EisenhowerUtils.getQuadrantFromCoords(x, y);
      }
      if (!quadrant) quadrant = 'Q2';

      if (x === null || y === null) {
        const def = (typeof EisenhowerUtils !== 'undefined' && EisenhowerUtils.getDefaultCoordsForQuadrant)
          ? EisenhowerUtils.getDefaultCoordsForQuadrant(quadrant, card.todoId || props.id || props.title)
          : { x: quadrant === 'Q1' || quadrant === 'Q3' ? 25 : 75, y: quadrant === 'Q1' || quadrant === 'Q2' ? 25 : 75 };
        if (x === null) x = def.x;
        if (y === null) y = def.y;
      }

      const priority = (typeof EisenhowerUtils !== 'undefined' && EisenhowerUtils.getPriorityForQuadrant)
        ? EisenhowerUtils.getPriorityForQuadrant(quadrant)
        : (props.priority || 'Medium');
      const text = props.title || props.text || props.context || 'Todo';
      const todoId = card.todoId || props.id || 'todo-' + Math.random().toString(36).slice(2, 9);

      const date = new Date().toISOString().slice(0, 10);
      const noteWs = (note && typeof getNoteWorkstreamName === 'function')
        ? getNoteWorkstreamName(note)
        : (note?.workstream || (Array.isArray(note?.workstreams) ? note.workstreams[0] : '') || '');
      const newTodo = {
        id: todoId,
        title: text,
        priority,
        eisenhowerQuadrant: quadrant,
        eisenhowerX: Math.round(x * 10) / 10,
        eisenhowerY: Math.round(y * 10) / 10,
        status: undefined,
        owner: 'me',
        noteId: note ? note.id || '' : '',
        noteTodoMarkerId: todoId,
        workstream: noteWs || '',
        major_topic_tags: noteWs ? [noteWs] : [],
        context: props.context || '',
        created: date,
        modified: date,
      };
      if (!todosManifest.some(t => t.id === todoId)) {
        todosManifest.push(newTodo);
        if (typeof saveTodosManifest === 'function') {
          saveTodosManifest().then(() => {
            if (typeof renderBoard === 'function') renderBoard();
          });
        }
      }
      // Exact structure matching the editor's own todo insertion
      htmlBlock = (
        `<span class="note-todo note-todo-draft" data-todo-id="${escH(todoId)}" data-todo-quadrant="${escH(quadrant)}" data-todo-priority="${escH(priority)}" contenteditable="false">` +
        `<span class="note-todo-text" contenteditable="true">${escH(text)}</span>` +
        `</span>`
      );
    } else if (card.action === 'log_decision') {
      const status = card.properties?.status || 'active';
      const text = card.properties?.text || card.properties?.title || 'Decision';
      const owner = card.properties?.owner || '';
      const reporter = card.properties?.reporter || '';
      const topic = card.properties?.major_topic || card.properties?.topic || '';
      const context = card.properties?.context || '';

      const badgeHTML = `<strong class="pill-decision pill-decision-${escH(status)}" contenteditable="false">!decision:${escH(status)}</strong>`;
      // Exact structure matching the editor's own decision insertion
      htmlBlock = (
        `<span class="note-decision-wrapper note-decision-draft" data-decision-status="${escH(status)}" data-decision-text="${escH(text)}" data-decision-owner="${escH(owner)}" data-decision-reporter="${escH(reporter)}" data-decision-topic="${escH(topic)}" data-decision-context="${escH(context)}" contenteditable="false">` +
        `${badgeHTML} <span class="note-decision-text" contenteditable="true">${escH(text)}</span>` +
        `</span>`
      );
    }

    if (htmlBlock) {
      appendHTMLToEditor(ta, htmlBlock);
    }
    if (typeof refreshEditorAndPreviewWithCorrections === 'function') {
      refreshEditorAndPreviewWithCorrections(note);
    } else if (typeof syncPreview === 'function') {
      syncPreview();
    }
  }
};

window.rejectInlineProposal = function (index, note = currentNote) {
  const state = getAiState(note);
  const states = Array.isArray(state.proposalStates) ? state.proposalStates : [];
  if (typeof states[index] === 'undefined') return;
  states[index] = 'dropped';
  state.proposalStates = states;

  const ta = document.getElementById('edit-textarea');
  if (ta) {
    const isRich = ta.contentEditable === 'true';
    if (isRich) {
      if (typeof refreshEditorAndPreviewWithCorrections === 'function') {
        refreshEditorAndPreviewWithCorrections(note);
      } else if (typeof syncPreview === 'function') {
        syncPreview();
      }
    } else {
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
};

function renderProposedAdditionsHTML(note = currentNote) {
  return '';
}

const DUMMY_SIMULATION_DOMAINS = [
  {
    id: 'software_engineering',
    domainName: 'Cloud & Distributed Software Engineering',
    roles: ['Backend Lead', 'Frontend Architect', 'DevOps / SRE Lead', 'QA Automation Engineer', 'Application Security Specialist'],
    bossTitle: 'VP of Engineering',
    pmTitle: 'Technical Project Manager',
    defaultProjects: [
      { name: 'Microservices & GraphQL Migration', leadRole: 'Backend Lead' },
      { name: 'Zero-Trust Authentication & SSO', leadRole: 'Application Security Specialist' },
      { name: 'Mobile App v3.0 Redesign', leadRole: 'Frontend Architect' },
      { name: 'CI/CD Pipeline Acceleration', leadRole: 'DevOps / SRE Lead' },
      { name: 'Payment Gateway Resilience', leadRole: 'Backend Lead' },
      { name: 'Cloud Infrastructure FinOps', leadRole: 'DevOps / SRE Lead' }
    ],
    sampleHotspot: 'A production latency spike and database connection pool exhaustion caused a severe checkout degradation during peak hours.'
  },
  {
    id: 'product_design',
    domainName: 'Product Management & UX Architecture',
    roles: ['Senior Product Manager', 'UX Lead Researcher', 'Principal Interaction Designer', 'Design Systems Architect', 'Technical Product Writer'],
    bossTitle: 'Chief Product Officer',
    pmTitle: 'Agile Delivery Lead',
    defaultProjects: [
      { name: 'User Onboarding Funnel Revamp', leadRole: 'Senior Product Manager' },
      { name: 'Enterprise Multi-Tenant Workspace', leadRole: 'Principal Interaction Designer' },
      { name: 'Design System 2.0 Tokens', leadRole: 'Design Systems Architect' },
      { name: 'Self-Serve Billing & Tier Upgrades', leadRole: 'Senior Product Manager' },
      { name: 'Accessibility WCAG 2.2 Compliance', leadRole: 'UX Lead Researcher' },
      { name: 'In-App Feedback & Telemetry Engine', leadRole: 'Technical Product Writer' }
    ],
    sampleHotspot: 'User drop-off surged 28% after a major checkout redesign due to an unintuitive modal step on mobile Safari.'
  },
  {
    id: 'growth_marketing',
    domainName: 'Marketing, Growth & Lifecycle Operations',
    roles: ['Performance Marketing Lead', 'Lifecycle & CRM Strategist', 'SEO & Content Strategist', 'Brand & Visual Designer', 'Marketing Analytics Specialist'],
    bossTitle: 'VP of Growth & Marketing',
    pmTitle: 'Campaign Project Lead',
    defaultProjects: [
      { name: 'Global Q4 Omnichannel Campaign', leadRole: 'Performance Marketing Lead' },
      { name: 'Automated Lifecycle Drip Sequences', leadRole: 'Lifecycle & CRM Strategist' },
      { name: 'High-Intent SEO Topic Cluster', leadRole: 'SEO & Content Strategist' },
      { name: 'Influencer & Affiliate Partner Portal', leadRole: 'Brand & Visual Designer' },
      { name: 'Multi-Touch Attribution Overhaul', leadRole: 'Marketing Analytics Specialist' },
      { name: 'Product Hunt & Press Launch', leadRole: 'Performance Marketing Lead' }
    ],
    sampleHotspot: 'Ad network policy suspension on key acquisition ad sets caused an immediate 40% lead velocity drop.'
  },
  {
    id: 'supply_chain',
    domainName: 'Supply Chain, Logistics & Manufacturing Operations',
    roles: ['Strategic Procurement Lead', 'Inventory Optimization Analyst', 'Logistics Routing Coordinator', 'Supplier Quality Engineer', 'Warehouse Automation Specialist'],
    bossTitle: 'VP of Supply Chain & Operations',
    pmTitle: 'Operations Program Manager',
    defaultProjects: [
      { name: 'Supplier Multi-Sourcing Program', leadRole: 'Strategic Procurement Lead' },
      { name: 'RFID Real-Time Inventory Tracking', leadRole: 'Warehouse Automation Specialist' },
      { name: 'Automated Cross-Docking System', leadRole: 'Logistics Routing Coordinator' },
      { name: 'Cold-Chain Fleet Telemetry', leadRole: 'Supplier Quality Engineer' },
      { name: 'Sustainable Packaging Overhaul', leadRole: 'Strategic Procurement Lead' },
      { name: 'Freight Carrier Rate Renegotiation', leadRole: 'Inventory Optimization Analyst' }
    ],
    sampleHotspot: 'A key overseas component supplier suffered a factory power outage, risking a 3-week assembly line shutdown.'
  },
  {
    id: 'clinical_research',
    domainName: 'Clinical Operations & Healthcare Research',
    roles: ['Clinical Trial Coordinator', 'Senior Biostatistician', 'Regulatory Affairs Specialist', 'Medical Safety Writer', 'Clinical Data Manager'],
    bossTitle: 'Director of Clinical Development',
    pmTitle: 'Clinical Project Manager',
    defaultProjects: [
      { name: 'Phase II Multi-Center Oncology Protocol', leadRole: 'Clinical Trial Coordinator' },
      { name: 'Decentralized Patient Telehealth Flow', leadRole: 'Clinical Data Manager' },
      { name: 'FDA eCTD Submission Dossier', leadRole: 'Regulatory Affairs Specialist' },
      { name: 'Adverse Event Signal Detection', leadRole: 'Senior Biostatistician' },
      { name: 'Site Monitoring Optimization', leadRole: 'Medical Safety Writer' },
      { name: 'EHR Interoperability Pipeline', leadRole: 'Clinical Data Manager' }
    ],
    sampleHotspot: 'An audit finding at a major regional hospital site flagged missing patient consent timestamps requiring immediate remediation.'
  },
  {
    id: 'renewable_energy',
    domainName: 'Renewable Energy & Smart Grid Engineering',
    roles: ['Grid Interconnection Engineer', 'Solar Farm Project Lead', 'Battery Storage Specialist', 'Environmental Compliance Officer', 'SCADA Systems Architect'],
    bossTitle: 'VP of Grid Infrastructure',
    pmTitle: 'Infrastructure Delivery Manager',
    defaultProjects: [
      { name: '50MW Utility Solar Interconnection', leadRole: 'Solar Farm Project Lead' },
      { name: 'BESS Peak-Shaving Deployment', leadRole: 'Battery Storage Specialist' },
      { name: 'Substation Automation Overhaul', leadRole: 'SCADA Systems Architect' },
      { name: 'Wildlife & Wetland Impact Mitigation', leadRole: 'Environmental Compliance Officer' },
      { name: 'Microgrid Resiliency Pilot', leadRole: 'Grid Interconnection Engineer' },
      { name: 'Asset Predictive Maintenance', leadRole: 'SCADA Systems Architect' }
    ],
    sampleHotspot: 'A high-voltage transformer substation failure during grid synchronization triggered emergency curtailment protocols.'
  },
  {
    id: 'fintech_risk',
    domainName: 'FinTech, Payments & Risk Analytics',
    roles: ['Quantitative Risk Analyst', 'Fraud Prevention Specialist', 'Compliance & AML Officer', 'Portfolio Strategist', 'Payments Settlement Engineer'],
    bossTitle: 'Head of Risk & Compliance',
    pmTitle: 'FinTech Delivery Lead',
    defaultProjects: [
      { name: 'Real-Time Fraud Scoring Engine', leadRole: 'Fraud Prevention Specialist' },
      { name: 'Basel III Capital Adequacy Model', leadRole: 'Quantitative Risk Analyst' },
      { name: 'Automated AML Transaction Monitoring', leadRole: 'Compliance & AML Officer' },
      { name: 'FX Hedging Automation', leadRole: 'Portfolio Strategist' },
      { name: 'Credit Underwriting API', leadRole: 'Payments Settlement Engineer' },
      { name: 'Open Banking PSD2 Integration', leadRole: 'Payments Settlement Engineer' }
    ],
    sampleHotspot: 'A sudden wave of synthetic identity fraud targeted the instant loan approval endpoint, requiring tightening model thresholds.'
  },
  {
    id: 'data_science',
    domainName: 'Data Science & Applied AI Systems',
    roles: ['Senior Data Scientist', 'AI / LLM Engineer', 'Machine Learning Researcher', 'Data Platform Engineer', 'MLOps Specialist'],
    bossTitle: 'VP of Data & AI',
    pmTitle: 'Data Science Project Lead',
    defaultProjects: [
      { name: 'Customer Churn Prediction Model', leadRole: 'Senior Data Scientist' },
      { name: 'Real-Time Recommendation Engine', leadRole: 'AI / LLM Engineer' },
      { name: 'LLM Text Classification Pipeline', leadRole: 'Machine Learning Researcher' },
      { name: 'Automated Survey Sampling Pipeline', leadRole: 'Data Platform Engineer' },
      { name: 'Anomaly Detection Service', leadRole: 'MLOps Specialist' },
      { name: 'Enterprise Feature Store Migration', leadRole: 'Data Platform Engineer' }
    ],
    sampleHotspot: 'A severe data drift in production feature embeddings degraded churn model precision by 35% overnight.'
  }
];

async function generateDummyWorkWeek(baseDateOrOptions = new Date(), concurrencyOrOptions = 1, maybeOptions = {}) {
  const cfg = LLMService.getConfig();
  if (!LLMService.isEnabled() || !cfg.endpoint) {
    throw new Error('Local LLM is not enabled or configured.');
  }

  let baseDate = new Date();
  let concurrency = 1;
  let options = {};

  if (baseDateOrOptions && typeof baseDateOrOptions === 'object' && !(baseDateOrOptions instanceof Date)) {
    options = baseDateOrOptions;
    baseDate = options.baseDate ? new Date(options.baseDate) : new Date();
    concurrency = Number(options.concurrency) || 1;
  } else {
    baseDate = baseDateOrOptions ? new Date(baseDateOrOptions) : new Date();
    if (typeof concurrencyOrOptions === 'object') {
      options = concurrencyOrOptions;
      concurrency = Number(options.concurrency) || 1;
    } else {
      concurrency = Number(concurrencyOrOptions) || 1;
      if (maybeOptions && typeof maybeOptions === 'object') {
        options = maybeOptions;
      }
    }
  }

  const selectedDomain = (options.domain && DUMMY_SIMULATION_DOMAINS.find(d => d.id === options.domain || d.domainName.toLowerCase().includes(String(options.domain).toLowerCase())))
    || DUMMY_SIMULATION_DOMAINS[Math.floor(Math.random() * DUMMY_SIMULATION_DOMAINS.length)];

  const today = new Date(baseDate);
  const day = today.getDay();
  const diff = today.getDate() - day + (day === 0 ? -6 : 1);
  const currentMon = new Date(today.setDate(diff));
  currentMon.setHours(0, 0, 0, 0);

  const lastMon = new Date(currentMon);
  lastMon.setDate(lastMon.getDate() - 7);
  const nextMon = new Date(currentMon);
  nextMon.setDate(currentMon.getDate() + 7);

  const formatDate = (d) => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  const getWeekDays = (mon) => {
    const arr = [];
    const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    for (let i = 0; i < 7; i++) {
      const d = new Date(mon);
      d.setDate(mon.getDate() + i);
      arr.push({ date: formatDate(d), day: weekdays[i] });
    }
    return arr;
  };

  const currentWeekDays = getWeekDays(currentMon);
  const lastWeekDays = getWeekDays(lastMon);
  const nextWeekDays = getWeekDays(nextMon);

  const endCurrentWeekDate = new Date(currentMon);
  endCurrentWeekDate.setDate(endCurrentWeekDate.getDate() + 6);
  const endCurrentWeekStr = formatDate(endCurrentWeekDate);

  const db = (typeof window !== 'undefined' && window.colleaguesDb) || (typeof colleaguesDb !== 'undefined' ? colleaguesDb : null);

  // Extract genuine colleagues from colleaguesDb, strictly excluding "me" or user identity
  const userChecker = typeof isUserCollaborator === 'function' ? isUserCollaborator : (name) => {
    if (!name) return true;
    const l = String(name).trim().toLowerCase();
    return l === 'me' || l === 'myself' || (typeof settings !== 'undefined' && settings?.username && l === settings.username.toLowerCase());
  };

  const rawColleagues = (db && Array.isArray(db.colleagues))
    ? db.colleagues
        .filter(c => c && c.id !== 'me' && !c.isMe && !userChecker(c.label || c.name || ''))
        .map(c => (c.label || c.name || '').trim())
        .filter(Boolean)
    : [];

  // Filter out any duplicates case-insensitively while preserving colleague order
  const seenColleagueNames = new Set();
  const existingColleagues = [];
  for (const name of rawColleagues) {
    const low = name.toLowerCase();
    if (!seenColleagueNames.has(low) && !userChecker(name)) {
      seenColleagueNames.add(low);
      existingColleagues.push(name);
    }
  }

  // Fallback synthetic colleague names if the user's database has fewer than needed for all roles
  const fallbackNames = ["Alex", "Jordan", "Taylor", "Casey", "Morgan", "Riley", "Jamie", "Sam", "Drew", "Avery"];
  for (const name of fallbackNames) {
    const low = name.toLowerCase();
    if (!seenColleagueNames.has(low) && !userChecker(name)) {
      seenColleagueNames.add(low);
      existingColleagues.push(name);
    }
  }

  const colleagueNames = existingColleagues;

  // Helper for retrying top-level async LLM operations with exponential backoff
  const withRetry = async (fn, description, maxRetries = 3, initialDelay = 1500) => {
    let lastError = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn(attempt);
      } catch (err) {
        lastError = err;
        console.warn(`[generateDummyWorkWeek] ${description} attempt ${attempt}/${maxRetries} failed: ${err.message || err}`);
        if (attempt < maxRetries) {
          const delay = initialDelay * Math.pow(2, attempt - 1);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }
    throw lastError || new Error(`${description} failed after ${maxRetries} retries.`);
  };

  // Step 1: Generate the story and explain direct reports, projects, high/low performer, budget, escalations, and mistakes
  const storyPrompt = `You are a creative writer and manager simulation designer.
We need a highly detailed, realistic work story for an anonymous manager of a ${selectedDomain.domainName} team spanning three weeks:

Last Week:
${lastWeekDays.map(w => `- ${w.day}: ${w.date}`).join('\n')}

Current Week:
${currentWeekDays.map(w => `- ${w.day}: ${w.date}`).join('\n')}

Next Week: 
${nextWeekDays.map(w => `- ${w.day}: ${w.date}`).join('\n')}

Available team colleagues to collaborate with:
${colleagueNames.join(', ')}

ANONYMITY & IDENTITY RULES:
- The active user / manager whose calendar and workspace this is must remain completely anonymous as the first-person manager ("Me" / "I" / "the team leader"). Do NOT assign any personal name to the manager or connect the simulation to any real personal identity or real company information.
- ALL named individuals listed above (${colleagueNames.join(', ')}) are team colleagues (direct reports, boss, Vice President, Project Manager).

Please structure the story with the following requirements:
1. Choose 5 direct reports from the available colleagues list. Assign each of them one of the domain roles: ${selectedDomain.roles.join(', ')}. Also assign one colleague from the list to act as the Boss (${selectedDomain.bossTitle}), one colleague as the Vice President, and one colleague as the Project Manager (${selectedDomain.pmTitle}).
2. Clearly identify at least one high performer and at least one low performer among the 5 direct reports, describing their current status, achievements, or struggles.
3. Outline 6 parallel projects the team is currently working on in the ${selectedDomain.domainName} domain (e.g., ${selectedDomain.defaultProjects.map(p => p.name).join(', ')}).
4. Describe a major customer/project escalation (a "hotspot") that occurred last week and impacts the current and next week. (Example scenario: ${selectedDomain.sampleHotspot})
   - The sequence of events MUST be: Escalation hits -> Urgent 1:1 with the Boss -> Daily report-outs to the Leadership Team/Vice President -> Catchups with the Project Manager.
   - Because of this hotspot, the Project Manager has to take a project delay on another workstream. People (including stakeholders) are initially unhappy, but understand and accept it after the leadership team explicitly communicates the re-prioritization.
5. Describe a budget talk/situation that the manager has to discuss with their boss:
   - Define the boss's character: The boss is a non-native English speaker. Choose a native language for the boss between French, German, or Italian.
   - The boss sometimes replaces English words with their native ones (e.g., "lavoro", "capo", "accordo", etc.).
   - The boss makes typical grammatical and spelling mistakes when writing or speaking.
6. Crucially, define 3 to 5 specific, intentional mistakes or contradictions to be introduced in the upcoming meeting notes. For example:
   - Mistake A: A task or decision assigned to the wrong owner.
   - Mistake B: Factual contradictions across different meetings (e.g., varying metrics, contradictory launch dates, or budget discrepancies).
   - Mistake C: Inconsistent details, such as typo-laden/wrong name references in task lists.

Explain the whole narrative thoroughly so that it feels like a real, deep story. Explain the context, the team members' tasks, the boss's language background/style, the hotspot flow, and the specific contradictions to introduce.`;

  console.log(`Step 1: Generating detailed work story for domain "${selectedDomain.domainName}" via LLM Service...`);
  const storyRes = await withRetry(
    () => LLMService.chat([{ role: 'system', content: storyPrompt }], { retries: 2, retryDelayMs: 1500 }),
    'Story Generation'
  );
  const story = storyRes.reply || '';
  if (!story.trim()) {
    throw new Error('Story generation returned empty output.');
  }
  console.log('Story generated:\n', story);

  // Step 2: Initialize Workstream Topic Memories for the 6 simulated projects
  const generatedWorkstreams = selectedDomain.defaultProjects.map((p, idx) => {
    const isHotspot = idx === 0;
    const isArchived = idx === 5; // Archive the 6th project to test archive filtering
    return {
      name: p.name,
      leadRole: p.leadRole,
      status: isArchived ? 'archived' : 'active',
      pinned: isHotspot,
      oneSentenceSummary: `${p.name} initiative in ${selectedDomain.domainName} led by ${p.leadRole}.`,
      scopeHtml: `<p>Strategic workstream for <strong>${p.name}</strong> within ${selectedDomain.domainName}.</p><ul><li><strong>In-scope:</strong> Architecture design, iterative delivery, core milestone rollout, team collaboration.</li><li><strong>Out-of-scope:</strong> Unapproved peripheral features and non-essential third-party dependencies.</li></ul>`,
      scratchpadHtml: `<h2>🎯 Objectives & Key Deliverables</h2><p>Deliver robust milestone capabilities for ${p.name}.</p><h2>⚖️ Decisions Taken & Direct Impact</h2><p>Scope agreed with leadership and resources allocated.</p><h2>🧱 Active Dependencies & Blockers</h2><p>Cross-team coordination with infrastructure and security.</p><h2>👥 Stakeholder Map & Governance</h2><p>Lead role: ${p.leadRole}. Regular syncs scheduled.</p><h2>⚠️ Risks, Escalations & Non-Goals</h2><p>${isHotspot ? 'Active hotspot escalation currently being triaged.' : 'Standard delivery timeline monitored.'}</p>`
    };
  });

  if (typeof WorkstreamMemoryEngine !== 'undefined' && typeof WorkstreamMemoryEngine.saveMajorTopicMemory === 'function') {
    console.log('Step 2: Creating rich Workstream Topic Memories for testing...');
    for (const ws of generatedWorkstreams) {
      try {
        await WorkstreamMemoryEngine.saveMajorTopicMemory(ws.name, {
          summary: ws.scopeHtml,
          oneSentenceSummary: ws.oneSentenceSummary,
          scratchpad: ws.scratchpadHtml,
          status: ws.status,
          pinned: ws.pinned,
          mappedTags: {
            tagGroups: [{ group: 'Workstreams', major: ws.name, topic: '' }],
            major_topic_tags: [ws.name]
          },
          participants: colleagueNames.slice(0, 3)
        });
      } catch (err) {
        console.warn(`Could not save workstream memory for ${ws.name}:`, err);
      }
    }
    if (typeof WorkstreamMemoryEngine.preloadAllWorkstreamMemories === 'function') {
      try { await WorkstreamMemoryEngine.preloadAllWorkstreamMemories(); } catch (_) {}
    }
  }

  // Step 3: Generate the calendar agenda events based on the story
  const agendaPrompt = `You are a dummy work week agenda generator.
Based on the following detailed background story and narrative:
${story}

Generate a comprehensive, very busy calendar schedule for the team leader spanning the THREE weeks:

Last Week:
${lastWeekDays.map(w => `- ${w.day}: ${w.date}`).join('\n')}

Current Week:
${currentWeekDays.map(w => `- ${w.day}: ${w.date}`).join('\n')}

Next Week (future planned blocks):
${nextWeekDays.map(w => `- ${w.day}: ${w.date}`).join('\n')}

Constraints:
1. As a team leader, the manager is extremely busy. Generate AT LEAST 5 events/calls per day (this should total around 75 events across the three weeks).
2. The schedule MUST include:
   - Individual 1:1 catchup meetings with each of the 5 direct reports (at least once per week).
   - The Hotspot Cascade: An initial urgent call with the Boss, followed by daily 15-30 min "Daily Report-Out" syncs with the Vice President/Leadership, and alignment syncs with the Project Manager.
   - Weekly sync updates with the manager's boss (covering budget, project updates, high/low performer updates).
   - Team meetings and project-specific meetings for the 6 parallel ${selectedDomain.domainName} projects: ${selectedDomain.defaultProjects.map(p => p.name).join(', ')}.
   - Future planning blocks and upcoming alignment meetings scheduled in Next Week.
3. Every scheduled event MUST have a distinct startTime and endTime during typical business hours (e.g., 09:00 to 18:00).
4. NO event should span the entire day.
5. Working sessions/topics ('work' type) must be a maximum of 2 hours.
6. Call/sync meetings ('call' or 'sync' type) must be a maximum of 1 hour, usually 30 minutes.
7. The "collaborators" field must ONLY list the colleague names participating in that meeting (chosen from: ${colleagueNames.join(', ')}). Never put "Me" or the user in collaborators.
8. The "workstream" field must contain one of the 6 project names: ${selectedDomain.defaultProjects.map(p => `"${p.name}"`).join(', ')}.

Return ONLY a raw JSON object conforming exactly to this schema (no markdown wrapping, no explanation):
{
  "events": [
    {
      "id": "evt-xxxxxx-xxxx",
      "type": "call" | "sync" | "prep" | "todo" | "work" | "ooo" | "custom",
      "title": "Meeting Title",
      "date": "YYYY-MM-DD",
      "startTime": "HH:MM",
      "endTime": "HH:MM",
      "workstream": "${selectedDomain.defaultProjects[0].name}",
      "collaborators": ["ColleagueName"], 
      "description": "1 to 2 sentences describing what happened in this specific meeting/session, aligning with the story."
    }
  ]
}`;

  console.log('Step 3: Generating agenda schedule structure via LLM Service...');
  const agendaRes = await withRetry(
    async () => {
      const res = await LLMService.chat([{ role: 'system', content: agendaPrompt }], { retries: 2, retryDelayMs: 1500 });
      if (!res.parsed || !Array.isArray(res.parsed.events)) {
        throw new Error('LLM did not return a valid events array.');
      }
      return res;
    },
    'Agenda Structure Generation'
  );

  const events = agendaRes.parsed.events;
  console.log(`Step 3 complete. Generated ${events.length} events.`);

  const startLastWeekStr = formatDate(lastMon);
  const endNextWeekStr = formatDate(new Date(nextMon.getTime() + 6 * 24 * 60 * 60 * 1000));

  let pEvents = (typeof plannerEvents !== 'undefined' && Array.isArray(plannerEvents))
    ? plannerEvents
    : ((typeof window !== 'undefined' && Array.isArray(window.plannerEvents)) ? window.plannerEvents : []);

  // Filter out existing events within this 3-week boundary to overwrite with the new simulation
  pEvents = pEvents.filter(e => {
    return !e || !e.date || e.date < startLastWeekStr || e.date > endNextWeekStr;
  });

  if (typeof plannerEvents !== 'undefined') {
    plannerEvents = pEvents;
  }
  if (typeof window !== 'undefined') {
    window.plannerEvents = pEvents;
  }

  // Assign IDs to events upfront so they are ready for the planner array
  for (const event of events) {
    if (!event.id) {
      event.id = 'evt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    }
  }

  // Helper for safe function resolution
  const safeGenerateNoteId = typeof generateNoteId === 'function' ? generateNoteId : () => ('note-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
  const safeGetCanonicalNotePath = typeof getCanonicalNotePath === 'function' ? getCanonicalNotePath : (id) => ('notes/' + id + '.html');
  const safeMdToHTML = typeof mdToPreviewHTML === 'function' ? mdToPreviewHTML : (m) => m;

  // Track created notes to attach to todos
  const createdNoteIdsByWorkstream = new Map();

  // Step 4: Generate meeting notes for Last Week and Current Week ONLY (Next Week is future scheduled blocks only)
  console.log(`Step 4: Generating meeting notes for past/present events with concurrency ${concurrency}... (Next week events will only have calendar blocks)`);

  const processEvent = async (event, workerIdx) => {
    // Only generate meeting notes for past/present days (Last Week & Current Week), never for Next Week
    const isFutureNextWeek = Boolean(event.date && event.date > endCurrentWeekStr);

    if (!isFutureNextWeek && (event.type === 'call' || event.type === 'sync')) {
      const safeCollaborators = (Array.isArray(event.collaborators) ? event.collaborators : [])
        .filter(c => c && !userChecker(c) && String(c).toLowerCase() !== 'me');

      const eventWorkstream = event.workstream || selectedDomain.defaultProjects[0].name;

      const notePrompt = `You are a meeting notes writer.
Write detailed markdown meeting notes for the following event:
Title: ${event.title}
Date: ${event.date}
Time: ${event.startTime || ''} - ${event.endTime || ''}
Type: ${event.type}
Workstream: ${eventWorkstream}
Participants: ${safeCollaborators.length > 0 ? safeCollaborators.join(', ') : 'None'}
What happened in this meeting: ${event.description || 'Discussed project updates.'}

Context/Background Story:
${story}

Guidelines:
1. ANONYMITY & ROLES: The author/manager is the anonymous team manager ("I" / "Me"). Do NOT invent or use any personal name for the manager. All named participants (${safeCollaborators.length > 0 ? safeCollaborators.join(', ') : 'None'}) are colleagues.
2. Crucially, if this meeting is relevant to any of the intentional mistakes defined in the story (e.g., contradictory model accuracy, wrong assignee, inconsistent dates), make sure to naturally and explicitly weave those mistakes into the notes.
3. If this meeting involves the boss, write the note text and actions using the boss's non-native style:
   - Mix in some native words based on their chosen language instead of their English equivalents.
   - Introduce typical spelling and grammatical errors (like "he do", "we has decided").
4. For meetings involving the Project Manager and the Vice President around the hotspot escalation, reflect the shifting tones (frustration shifting to acceptance of the reprioritization).
5. The output must be in professional meeting notes Markdown format.
6. Include these standard sections with ## headings and avoid any dummy placeholder links:
## Goal
(A brief explanation of the meeting's objective)

## Notes
(Detailed bullet points describing the discussion, status updates, findings, or technical details)

## Decisions
(Bullet points of key decisions made)

## Actions
(Bullet points of next steps or tasks, format colleague action items with @ColleagueName such as ${safeCollaborators.length > 0 ? safeCollaborators.map(c => '@' + c).join(', ') : '@Colleague'}, and manager action items without any personal name)

Return ONLY the raw markdown content. Do not wrap the response in markdown blocks like \`\`\`markdown.`;

      const maxAttempts = 4;
      let attempt = 0;
      let noteCreated = false;

      while (attempt < maxAttempts && !noteCreated) {
        attempt++;
        try {
          const noteRes = await LLMService.chat([
            { role: 'system', content: notePrompt }
          ], { reasoningEffort: 'low', retries: 2, retryDelayMs: 1000 });

          const markdown = noteRes.reply || '';
          if (markdown.trim()) {
            const noteId = safeGenerateNoteId();
            const notePath = safeGetCanonicalNotePath(noteId);
            const note = {
              id: noteId,
              path: notePath,
              title: event.title,
              date: event.date,
              group_tags: ['Calls'],
              major_topic_tags: [],
              topic_tags: safeCollaborators,
              workstream: eventWorkstream,
              extra_tags: [],
              mainHTML: safeMdToHTML(markdown)
            };

            if (typeof StorageAPI !== 'undefined' && typeof StorageAPI.writeNoteContent === 'function' && typeof buildNewNoteHTML === 'function') {
              await StorageAPI.writeNoteContent(notePath, buildNewNoteHTML(note));
            }
            if (typeof upsertManifest === 'function') {
              upsertManifest(note);
            }

            event.noteId = noteId;
            event.linkedNoteIds = [noteId];
            noteCreated = true;

            if (!createdNoteIdsByWorkstream.has(eventWorkstream)) {
              createdNoteIdsByWorkstream.set(eventWorkstream, []);
            }
            createdNoteIdsByWorkstream.get(eventWorkstream).push(noteId);
          } else {
            console.warn(`[Worker ${workerIdx}] Note generation returned empty content for ${event.title} (attempt ${attempt}/${maxAttempts})`);
            if (attempt < maxAttempts) {
              await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
            }
          }
        } catch (err) {
          console.warn(`[Worker ${workerIdx}] Failed attempt ${attempt}/${maxAttempts} to generate note for ${event.title}: ${err.message || err}`);
          if (attempt < maxAttempts) {
            const delay = 1000 * Math.pow(2, attempt - 1);
            await new Promise(r => setTimeout(r, delay));
          } else {
            console.error(`[Worker ${workerIdx}] Permanently failed to generate note for ${event.title} after ${maxAttempts} attempts:`, err);
          }
        }
      }
    }

    if (typeof plannerEvents !== 'undefined' && Array.isArray(plannerEvents)) {
      plannerEvents.push(event);
    } else if (typeof window !== 'undefined' && Array.isArray(window.plannerEvents)) {
      window.plannerEvents.push(event);
    }
  };

  // Implement the worker queue (will process sequentially if concurrency === 1)
  const queue = [...events];
  const workers = [];

  for (let i = 0; i < concurrency; i++) {
    workers.push((async () => {
      while (queue.length > 0) {
        const event = queue.shift();
        console.log(`[Worker ${i}] Processing event: ${event.title} (${event.date}). Remaining: ${queue.length}`);
        await processEvent(event, i);
      }
    })());
  }

  // Wait for all workers to finish depleting the queue
  await Promise.all(workers);

  // Step 5: Generate full-lifecycle Todos (Done, In-Progress, Pending, Delegated, Dependent/DAG)
  console.log('Step 5: Synthesizing full-lifecycle todos for feature testing (Done, In-Progress, Delegated, DAG Blockers)...');
  const genTodoId = (prefix) => `todo-gen-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const lastWeekMidStr = lastWeekDays[2]?.date || formatDate(lastMon);
  const currentWeekMidStr = currentWeekDays[2]?.date || formatDate(currentMon);
  const nextWeekMidStr = nextWeekDays[2]?.date || formatDate(nextMon);

  const leadColleague = colleagueNames[0] || 'Alex';
  const secondColleague = colleagueNames[1] || 'Jordan';
  const thirdColleague = colleagueNames[2] || 'Taylor';

  const ws1 = selectedDomain.defaultProjects[0].name;
  const ws2 = selectedDomain.defaultProjects[1].name;
  const ws3 = selectedDomain.defaultProjects[2].name;
  const ws4 = selectedDomain.defaultProjects[3].name;

  // Prerequisite base tasks
  const taskA_Id = genTodoId('dag-a');
  const taskB_Id = genTodoId('dag-b');
  const taskC_Id = genTodoId('dag-c');

  const synthesizedTodos = [
    // 1. Completed / Done tasks (Last Week & early Current Week)
    {
      id: taskA_Id,
      title: `Complete initial architecture review for ${ws1}`,
      owner: 'me',
      ownerId: 'me',
      priority: 'Done',
      originalPriority: 'High',
      eisenhowerQuadrant: 'Q1',
      status: 'Done',
      done: true,
      isHighPriority: true,
      workstream: ws1,
      date: lastWeekMidStr,
      dueDate: lastWeekMidStr,
      depends_on: [],
      noteId: (createdNoteIdsByWorkstream.get(ws1) || [])[0] || ''
    },
    {
      id: genTodoId('done-1'),
      title: `Publish Q3 milestone sign-off for ${ws2}`,
      owner: 'me',
      ownerId: 'me',
      priority: 'Done',
      originalPriority: 'Medium',
      eisenhowerQuadrant: 'Q2',
      status: 'Done',
      done: true,
      isHighPriority: false,
      workstream: ws2,
      date: lastWeekDays[4]?.date || lastWeekMidStr,
      dueDate: lastWeekDays[4]?.date || lastWeekMidStr,
      depends_on: [],
      noteId: (createdNoteIdsByWorkstream.get(ws2) || [])[0] || ''
    },
    {
      id: genTodoId('done-2'),
      title: `Submit budget forecast revision to boss`,
      owner: 'me',
      ownerId: 'me',
      priority: 'Done',
      originalPriority: 'High',
      eisenhowerQuadrant: 'Q1',
      status: 'Done',
      done: true,
      isHighPriority: true,
      workstream: ws1,
      date: currentWeekDays[0]?.date || currentWeekMidStr,
      dueDate: currentWeekDays[0]?.date || currentWeekMidStr,
      depends_on: []
    },

    // 2. High-Priority Urgent (Q1) active tasks
    {
      id: genTodoId('q1-hotspot'),
      title: `Triage root cause escalation for ${ws1} with VP and lead`,
      owner: 'me',
      ownerId: 'me',
      priority: 'High',
      eisenhowerQuadrant: 'Q1',
      status: 'Pending',
      done: false,
      isHighPriority: true,
      workstream: ws1,
      date: currentWeekDays[1]?.date || currentWeekMidStr,
      dueDate: currentWeekDays[3]?.date || currentWeekMidStr,
      depends_on: [taskA_Id] // Unblocked because taskA is Done!
    },

    // 3. Strategic (Q2) In-Progress (WIP) tasks
    {
      id: taskB_Id,
      title: `Draft cross-functional roadmap v2 for ${ws3}`,
      owner: 'me',
      ownerId: 'me',
      priority: 'Medium',
      eisenhowerQuadrant: 'Q2',
      status: 'In Progress',
      done: false,
      isHighPriority: false,
      workstream: ws3,
      date: currentWeekMidStr,
      dueDate: currentWeekDays[4]?.date || currentWeekMidStr,
      depends_on: []
    },

    // 4. Blocked Task (DAG dependency on WIP taskB)
    {
      id: genTodoId('dag-blocked'),
      title: `Run executive alignment workshop on ${ws3} roadmap`,
      owner: 'me',
      ownerId: 'me',
      priority: 'High',
      eisenhowerQuadrant: 'Q2',
      status: 'Pending',
      done: false,
      isHighPriority: true,
      workstream: ws3,
      date: currentWeekDays[3]?.date || currentWeekMidStr,
      dueDate: nextWeekMidStr,
      depends_on: [taskB_Id] // Blocked because taskB is still In Progress!
    },

    // 5. Delegated (Q3) tasks to team colleagues
    {
      id: taskC_Id,
      title: `Implement telemetry health probe metrics for ${ws1}`,
      owner: leadColleague,
      ownerId: leadColleague,
      delegatedTo: leadColleague,
      isDelegated: true,
      priority: 'Medium',
      eisenhowerQuadrant: 'Q3',
      status: 'In Progress',
      done: false,
      isHighPriority: false,
      workstream: ws1,
      date: currentWeekMidStr,
      dueDate: currentWeekDays[4]?.date || currentWeekMidStr,
      depends_on: []
    },
    {
      id: genTodoId('delegated-2'),
      title: `Benchmark load testing performance for ${ws2}`,
      owner: secondColleague,
      ownerId: secondColleague,
      delegatedTo: secondColleague,
      isDelegated: true,
      priority: 'Medium',
      eisenhowerQuadrant: 'Q3',
      status: 'Pending',
      done: false,
      isHighPriority: false,
      workstream: ws2,
      date: currentWeekMidStr,
      dueDate: nextWeekDays[1]?.date || nextWeekMidStr,
      depends_on: []
    },
    {
      id: genTodoId('delegated-3'),
      title: `Compile automated regression suite results for ${ws4}`,
      owner: thirdColleague,
      ownerId: thirdColleague,
      delegatedTo: thirdColleague,
      isDelegated: true,
      priority: 'Low',
      eisenhowerQuadrant: 'Q3',
      status: 'Pending',
      done: false,
      isHighPriority: false,
      workstream: ws4,
      date: currentWeekDays[3]?.date || currentWeekMidStr,
      dueDate: nextWeekDays[2]?.date || nextWeekMidStr,
      depends_on: []
    },

    // 6. Backlog (Q4) low-priority items
    {
      id: genTodoId('q4-backlog-1'),
      title: `Evaluate optional third-party dashboard tooling`,
      owner: 'me',
      ownerId: 'me',
      priority: 'Low',
      eisenhowerQuadrant: 'Q4',
      status: 'Pending',
      done: false,
      isHighPriority: false,
      workstream: ws4,
      date: currentWeekMidStr,
      dueDate: nextWeekDays[4]?.date || nextWeekMidStr,
      depends_on: []
    },
    {
      id: genTodoId('q4-backlog-2'),
      title: `Clean up legacy sandbox environment storage`,
      owner: 'me',
      ownerId: 'me',
      priority: 'Low',
      eisenhowerQuadrant: 'Q4',
      status: 'Pending',
      done: false,
      isHighPriority: false,
      workstream: ws2,
      date: lastWeekMidStr,
      dueDate: nextWeekMidStr,
      depends_on: []
    }
  ];

  if (typeof todosManifest !== 'undefined' && Array.isArray(todosManifest)) {
    for (const todo of synthesizedTodos) {
      if (!todosManifest.some(t => t.id === todo.id)) {
        todosManifest.push(todo);
      }
    }
  } else if (typeof window !== 'undefined' && Array.isArray(window.todosManifest)) {
    for (const todo of synthesizedTodos) {
      if (!window.todosManifest.some(t => t.id === todo.id)) {
        window.todosManifest.push(todo);
      }
    }
  }

  // Step 6: Persist state and trigger UI refreshes
  if (typeof saveManifest === 'function') {
    await saveManifest({ force: true });
  }
  if (typeof rebuildIndexHTML === 'function') {
    await rebuildIndexHTML();
  }
  if (typeof saveTodosManifest === 'function') {
    await saveTodosManifest();
  }
  if (typeof renderFilterChips === 'function') {
    renderFilterChips();
  }
  if (typeof savePlanner === 'function') {
    await savePlanner();
  }
  if (typeof renderPlanner === 'function') {
    renderPlanner();
  }
  if (typeof renderBoard === 'function') {
    renderBoard();
  }
  if (typeof renderEisenhowerMatrix === 'function') {
    renderEisenhowerMatrix();
  }

  console.log(`Successfully generated dummy 3-week simulation for domain "${selectedDomain.domainName}"!`);
  return {
    domain: selectedDomain,
    events,
    workstreams: generatedWorkstreams,
    todos: synthesizedTodos
  };
}

window.DUMMY_SIMULATION_DOMAINS = DUMMY_SIMULATION_DOMAINS;
LLMService.simulationDomains = DUMMY_SIMULATION_DOMAINS;

window.LLMService = LLMService;
window.renderLeftPaneSuggestions = renderLeftPaneSuggestions;
window.updateLLMToolbarVisibility = updateLLMToolbarVisibility;
window.openAiConversationInInspector = openAiConversationInInspector;
window.mountAiConversationLaneInInspector = mountAiConversationLaneInInspector;
window.unmountAiLane = unmountAiLane;
window.analyzeCurrentNoteWithLLM = analyzeCurrentNoteWithLLM;
window._realAnalyzeCurrentNoteWithLLM = analyzeCurrentNoteWithLLM;
window.insertAiSuggestionIntoNote = insertAiSuggestionIntoNote;
window.applyAiSuggestion = applyAiSuggestion;
window.updateAiSuggestionReplacement = updateAiSuggestionReplacement;
window.dropAiSuggestion = dropAiSuggestion;
window.setAiSuggestionProposalState = setAiSuggestionProposalState;
window.setAiSuggestionAssignee = setAiSuggestionAssignee;
window.testLocalLLMConnection = testLocalLLMConnection;
window.runBulkAISummaries = runBulkAISummaries;
window.cancelBulkAISummaries = cancelBulkAISummaries;
window.sendAiConversationReply = sendAiConversationReply;
window.closeAiConversationLane = closeAiConversationLane;
window.applyAiConversationPayload = applyAiConversationPayload;
window.applyInlineDiffsToMarkdown = applyInlineDiffsToMarkdown;
window.refreshEditorAndPreviewWithCorrections = refreshEditorAndPreviewWithCorrections;
window.renderInlineAdditionsHTML = renderInlineAdditionsHTML;
window.retryLastAiAction = retryLastAiAction;
window.showInlineCorrectionMenu = showInlineCorrectionMenu;
window.applyInlineCorrectionFromMenu = applyInlineCorrectionFromMenu;
window.rejectInlineCorrectionFromMenu = rejectInlineCorrectionFromMenu;
window.renderProposedAdditionsHTML = renderProposedAdditionsHTML;
window.generateDummyWorkWeek = generateDummyWorkWeek;
window.createDummyWorkWeek = generateDummyWorkWeek;
window.getPendingSummaryProposal = getPendingSummaryProposal;
window.updateMetadataSummaryProposalUI = updateMetadataSummaryProposalUI;
window.applyMetadataSummaryProposal = applyMetadataSummaryProposal;
window.rejectMetadataSummaryProposal = rejectMetadataSummaryProposal;

function getCleanEditorText() {
  const ta = document.getElementById('edit-textarea');
  if (!ta) return '';
  const clone = ta.cloneNode(true);
  
  const corrections = clone.querySelectorAll('.inline-correction-wrapper');
  corrections.forEach(wrapper => {
    const delSpan = wrapper.querySelector('.inline-correction-del-line');
    if (delSpan) {
      const parent = wrapper.parentNode;
      while (delSpan.firstChild) {
        parent.insertBefore(delSpan.firstChild, wrapper);
      }
      wrapper.remove();
    } else {
      wrapper.remove();
    }
  });

  const proposals = clone.querySelectorAll('.inline-proposal-wrapper');
  proposals.forEach(wrapper => {
    wrapper.remove();
  });

  // Insert explicit line breaks for block tags in detached DOM clone
  clone.querySelectorAll('h1, h2, h3, h4, h5, h6, p, div, tr, br').forEach(el => {
    el.prepend(document.createTextNode('\n'));
    el.append(document.createTextNode('\n'));
  });
  clone.querySelectorAll('li').forEach(el => {
    el.prepend(document.createTextNode('\n- '));
  });

  const rawText = clone.textContent || clone.innerText || '';
  return rawText.replace(/\n{3,}/g, '\n\n').trim();
}
window.getCleanEditorText = getCleanEditorText;

function discardAllPendingProposals(note = currentNote) {
  const textarea = document.getElementById('edit-textarea');
  if (!textarea) return;
  
  const state = getAiState(note);
  const cards = Array.isArray(state.proposalCards) ? state.proposalCards : [];
  const states = Array.isArray(state.proposalStates) ? state.proposalStates : [];
  
  const wrappers = textarea.querySelectorAll('.inline-correction-wrapper, .inline-proposal-wrapper');
  wrappers.forEach(wrapper => {
    const cardIndexAttr = wrapper.getAttribute('data-card-index');
    if (cardIndexAttr !== null) {
      const idx = parseInt(cardIndexAttr, 10);
      if (!isNaN(idx) && states[idx] === 'inline-rendered') {
        states[idx] = 'dropped';
      }
    }
    
    if (wrapper.classList.contains('inline-correction-wrapper')) {
      const delSpan = wrapper.querySelector('.inline-correction-del-line');
      if (delSpan) {
        const parent = wrapper.parentNode;
        while (delSpan.firstChild) {
          parent.insertBefore(delSpan.firstChild, wrapper);
        }
      }
    }
    wrapper.remove();
  });
  
  state.proposalStates = states;
}
window.discardAllPendingProposals = discardAllPendingProposals;

function insertInlineProposals(note = currentNote) {
  const textarea = document.getElementById('edit-textarea');
  if (!textarea) return;

  const state = getAiState(note);
  const cards = Array.isArray(state.proposalCards) ? state.proposalCards : [];
  const states = Array.isArray(state.proposalStates) ? state.proposalStates : [];

  cards.forEach((card, idx) => {
    if (states[idx] !== 'pending') return;

    if (card.kind === 'text_correction') {
      const props = normalizeTextCorrectionProps(card.properties);
      const map = buildTextNodeMap(textarea);
      const fullText = getSyncedFullText(map);
      const match = findTextCorrectionMatch(fullText, props);
      if (!match) return;

      const nodes = collectTargetNodes(map, match.index, match.length);
      if (nodes.length === 0) return;

      const wrapper = document.createElement('span');
      wrapper.className = 'inline-correction-wrapper';
      wrapper.setAttribute('data-card-index', idx);
      wrapper.setAttribute('contenteditable', 'false');

      const delSpan = document.createElement('span');
      delSpan.className = 'inline-correction-del-line';
      const firstNode = nodes[0];
      const parent = firstNode.parentNode;
      if (!parent) return;

      parent.insertBefore(wrapper, firstNode);
      nodes.forEach(n => delSpan.appendChild(n));
      wrapper.appendChild(delSpan);

      const insSpan = document.createElement('span');
      insSpan.className = 'inline-correction-ins-line';
      insSpan.textContent = props.replacement_text || '';
      wrapper.appendChild(insSpan);

      const actionsSpan = document.createElement('span');
      actionsSpan.className = 'inline-correction-hover-actions';
      actionsSpan.innerHTML = `
        <button class="inline-hover-btn btn-accept" type="button" onclick="event.stopPropagation(); if (typeof window.acceptInlineProposal === 'function') window.acceptInlineProposal(${idx});">✓ Accept</button>
        <button class="inline-hover-btn btn-reject" type="button" onclick="event.stopPropagation(); if (typeof window.rejectInlineProposal === 'function') window.rejectInlineProposal(${idx});">✕ Reject</button>
      `;
      wrapper.appendChild(actionsSpan);
      
      states[idx] = 'inline-rendered';
    }
    else if (card.kind === 'action') {
      const props = card.properties || {};
      const targetText = String(props.target_string || props.context || props.task || '').trim();
      if (!targetText) return;

      const map = buildTextNodeMap(textarea);
      const fullText = getSyncedFullText(map);
      const match = findTextCorrectionMatch(fullText, { target_string: targetText });
      if (!match) return;

      const nodes = collectTargetNodes(map, match.index, match.length);
      if (nodes.length === 0) return;

      const lastNode = nodes[nodes.length - 1];
      const parent = lastNode.parentNode;
      if (!parent) return;

      const wrapper = document.createElement('div');
      wrapper.className = 'inline-proposal-wrapper';
      wrapper.setAttribute('data-card-index', idx);
      wrapper.setAttribute('contenteditable', 'false');

      let label = 'Tâche proposée';
      let bodyHTML = '';
      if (card.action === 'create_todo') {
        const title = props.title || props.text || props.context || 'Nouvelle tâche';
        const priority = props.priority || 'Medium';
        const owner = props.owner || props.colleague || props.person || 'me';
        const ownerLabel = owner === 'me' ? '@me' : `@${owner.replace(/^@/, '')}`;
        const reassignTooltip = typeof t === 'function' ? (t('todo.reassignColleagueTooltip') || 'Click to reassign colleague') : 'Click to reassign colleague';

        label = 'Tâche proposée';
        bodyHTML = `📋 <strong>${escH(title)}</strong> (Priorité: ${escH(priority)}) <span class="note-todo-badge owner-tag inline-reassign-owner" data-owner="${escA(owner)}" contenteditable="false" title="${escA(reassignTooltip)}" style="cursor:pointer; margin-left:6px;">👤 ${escH(ownerLabel)}</span>`;
        wrapper.setAttribute('data-proposal-type', 'todo');
        wrapper.setAttribute('data-todo-title', title);
        wrapper.setAttribute('data-todo-priority', priority);
        wrapper.setAttribute('data-todo-owner', owner);
        wrapper.classList.add('inline-todo-proposal');
      } else if (card.action === 'log_decision') {
        const title = props.text || props.title || 'Nouvelle décision';
        const status = props.status || 'active';
        label = 'Décision proposée';
        bodyHTML = `⚖️ <strong>${escH(title)}</strong>`;
        wrapper.setAttribute('data-proposal-type', 'decision');
        wrapper.setAttribute('data-decision-title', title);
        wrapper.setAttribute('data-decision-status', status);
        wrapper.classList.add('inline-decision-proposal');
      } else if (card.action === 'create_delegation' || card.action === 'delegate_task' || card.action === 'mention_colleague') {
        label = 'Collègue / Délégation';
        const name = props.colleague || props.name || props.person || 'Collègue';
        const task = props.task || props.context || 'Action requise';
        const reassignTooltip = typeof t === 'function' ? (t('todo.reassignColleagueTooltip') || 'Click to reassign colleague') : 'Click to reassign colleague';
        bodyHTML = `👤 <span class="note-todo-badge owner-tag pill-delegation inline-reassign-owner" data-owner="${escA(name)}" contenteditable="false" title="${escA(reassignTooltip)}" style="cursor:pointer;">@${escH(name)}</span>: ${escH(task)}`;
        wrapper.setAttribute('data-proposal-type', 'colleague');
        wrapper.setAttribute('data-colleague-name', name);
        wrapper.setAttribute('data-colleague-task', task);
        wrapper.classList.add('inline-colleague-proposal');
      }

      wrapper.innerHTML = `
        <div class="inline-proposal-header">${label}</div>
        <div class="inline-proposal-body" style="font-size: 0.8rem; margin: 4px 0;">${bodyHTML}</div>
        <div class="inline-proposal-hover-actions">
          <button class="inline-hover-btn btn-accept" type="button" onclick="event.stopPropagation(); event.preventDefault(); window.acceptInlineProposal(this);">✓ Accept</button>
          <button class="inline-hover-btn btn-reject" type="button" onclick="event.stopPropagation(); event.preventDefault(); window.rejectInlineProposal(this);">✕ Reject</button>
        </div>
      `;

      if (lastNode.nextSibling) {
        parent.insertBefore(wrapper, lastNode.nextSibling);
      } else {
        parent.appendChild(wrapper);
      }

      states[idx] = 'inline-rendered';
    }
  });

  state.proposalStates = states;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}
window.insertInlineProposals = insertInlineProposals;

window.acceptInlineProposal = function(target, note = currentNote) {
  if (target && target.nodeType === 1 && typeof acceptInlineCorrection === 'function') {
    const wrapper = target.closest('.inline-proposal-wrapper, .inline-correction-wrapper');
    if (wrapper) return acceptInlineCorrection(wrapper);
  }

  const index = typeof target === 'number' ? target : parseInt(target?.getAttribute?.('data-card-index') || target, 10);
  if (isNaN(index)) return;

  const textarea = document.getElementById('edit-textarea');
  if (!textarea) return;

  const state = getAiState(note);
  const cards = Array.isArray(state.proposalCards) ? state.proposalCards : [];
  const states = Array.isArray(state.proposalStates) ? state.proposalStates : [];
  const card = cards[index];
  if (!card) return;

  const wrapper = textarea.querySelector(`[data-card-index="${index}"]`);
  if (!wrapper) return;

  try {
    if (card.kind === 'text_correction') {
      const props = normalizeTextCorrectionProps(card.properties);
      const replacementText = props.replacement_text || '';
      
      const textNode = document.createTextNode(replacementText);
      wrapper.parentNode.replaceChild(textNode, wrapper);
      states[index] = 'applied';
      toast(llmText('llm.correctionApplied', 'Correction appliquée.'));
    } 
    else if (card.kind === 'action') {
      if (card.action === 'create_todo') {
        const props = card.properties || {};
        const title = String(props.title || 'Untitled task').trim();
        const priority = String(props.priority || 'Medium').trim();
        const todoId = String(card.todoId || '').trim() || `ntodo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        card.todoId = todoId;

        const date = new Date().toISOString().slice(0, 10);
        const noteWs = (note && typeof getNoteWorkstreamName === 'function')
          ? getNoteWorkstreamName(note)
          : (note?.workstream || (Array.isArray(note?.workstreams) ? note.workstreams[0] : '') || '');
        const newTodo = {
          id: todoId,
          title: title,
          priority: priority,
          owner: 'me',
          noteId: note.id || '',
          noteTodoMarkerId: todoId,
          workstream: noteWs || '',
          major_topic_tags: noteWs ? [noteWs] : [],
          context: '',
          created: date,
          modified: date
        };

        if (!todosManifest.some(t => t.id === todoId)) {
          todosManifest.push(newTodo);
          if (typeof saveTodosManifest === 'function') {
            saveTodosManifest().then(() => {
              if (typeof renderBoard === 'function') renderBoard();
            });
          }
        }

        const blockHTML = formatPostCallNoteBlock(card);
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = blockHTML;
        const finalEl = tempDiv.firstElementChild;
        wrapper.parentNode.replaceChild(finalEl, wrapper);
        states[index] = 'applied';
        toast(llmText('llm.todoAddedInline', 'Tâche ajoutée en ligne.'));
      }
      else if (card.action === 'log_decision') {
        const blockHTML = formatPostCallNoteBlock(card);
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = blockHTML;
        const finalEl = tempDiv.firstElementChild;
        wrapper.parentNode.replaceChild(finalEl, wrapper);
        states[index] = 'applied';
        toast(llmText('llm.decisionAddedInline', 'Décision consignée en ligne.'));
      }
    }
  } catch (err) {
    console.error('Accept inline proposal failed', err);
    toast('Error: ' + err.message, true);
  } finally {
    state.proposalStates = states;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    if (typeof syncPreview === 'function') {
      syncPreview();
    }
  }
};

window.rejectInlineProposal = function(target, note = currentNote) {
  if (target && target.nodeType === 1 && typeof rejectInlineCorrection === 'function') {
    const wrapper = target.closest('.inline-proposal-wrapper, .inline-correction-wrapper');
    if (wrapper) return rejectInlineCorrection(wrapper);
  }

  const index = typeof target === 'number' ? target : parseInt(target?.getAttribute?.('data-card-index') || target, 10);
  if (isNaN(index)) return;

  const textarea = document.getElementById('edit-textarea');
  if (!textarea) return;

  const state = getAiState(note);
  const cards = Array.isArray(state.proposalCards) ? state.proposalCards : [];
  const states = Array.isArray(state.proposalStates) ? state.proposalStates : [];
  const card = cards[index];
  if (!card) return;

  const wrapper = textarea.querySelector(`[data-card-index="${index}"]`);
  if (!wrapper) return;

  try {
    if (card.kind === 'text_correction') {
      const delSpan = wrapper.querySelector('.inline-correction-del-line');
      if (delSpan) {
        const fragment = document.createDocumentFragment();
        while (delSpan.firstChild) {
          fragment.appendChild(delSpan.firstChild);
        }
        wrapper.parentNode.replaceChild(fragment, wrapper);
      } else {
        wrapper.remove();
      }
    } else {
      wrapper.remove();
    }
    states[index] = 'dropped';
    toast('Suggestion ignorée.');
  } catch (err) {
    console.error('Reject inline proposal failed', err);
    toast('Error: ' + err.message, true);
  } finally {
    state.proposalStates = states;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    if (typeof syncPreview === 'function') {
      syncPreview();
    }
  }
};

/* ── 🌟 Major Topic Knowledge / Memory Persistence ── */
function getTopicMemoryKey(majorTopic) {
  if (!majorTopic || typeof majorTopic !== 'string') return '';
  const clean = majorTopic.trim();
  if (!clean) return '';
  return encodeURIComponent(clean.toLowerCase()).replace(/%/g, '_');
}

async function getMajorTopicMemory(majorTopic, options = {}) {
  if (typeof WorkstreamMemoryEngine !== 'undefined' && typeof WorkstreamMemoryEngine.getMajorTopicMemory === 'function') {
    return await WorkstreamMemoryEngine.getMajorTopicMemory(majorTopic, options);
  }
  const sanitized = (typeof getTopicMemoryKey === 'function') ? getTopicMemoryKey(majorTopic) : String(majorTopic || '').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  if (!sanitized) return null;

  if (typeof StorageAPI !== 'undefined' && StorageAPI.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
    try {
      const remoteMem = await window.FirebaseSyncService.getDoc('topic_memories', sanitized);
      if (remoteMem) return remoteMem;
    } catch (_e) {}
  }

  const filePath = `raw/topic-memories/${sanitized}.json`;
  try {
    if (typeof readFile === 'function') {
      const content = await readFile(filePath);
      if (content) {
        return JSON.parse(content);
      }
    }
  } catch (_e) {}

  try {
    const cached = localStorage.getItem(`secretary_topic_memory_${sanitized}`);
    if (cached) return JSON.parse(cached);
  } catch (_e) {}

  return null;
}
if (!window.getMajorTopicMemory) window.getMajorTopicMemory = getMajorTopicMemory;

async function saveMajorTopicMemory(majorTopic, data, options = {}) {
  if (typeof WorkstreamMemoryEngine !== 'undefined' && typeof WorkstreamMemoryEngine.saveMajorTopicMemory === 'function') {
    return await WorkstreamMemoryEngine.saveMajorTopicMemory(majorTopic, data, options);
  }
  if (!majorTopic || typeof majorTopic !== 'string' || !data) return null;
  const clean = majorTopic.trim();
  const sanitized = getTopicMemoryKey(majorTopic);
  if (!clean || !sanitized) return null;
  const filePath = `raw/topic-memories/${sanitized}.json`;

  const payload = {
    majorTopic: clean,
    lastUpdated: new Date().toISOString(),
    summary: data.summary || '',
    keyFacts: Array.isArray(data.keyFacts) ? data.keyFacts : (Array.isArray(data.key_facts) ? data.key_facts : []),
    activeMilestones: Array.isArray(data.activeMilestones) ? data.activeMilestones : (Array.isArray(data.milestones) ? data.milestones : []),
    decisions: Array.isArray(data.decisions) ? data.decisions : []
  };

  try {
    localStorage.setItem(`secretary_topic_memory_${sanitized}`, JSON.stringify(payload));
  } catch (_e) {}

  try {
    if (typeof writeFile === 'function') {
      await writeFile(filePath, JSON.stringify(payload, null, 2));
    }
  } catch (_e) {}

  return payload;
}
if (!window.saveMajorTopicMemory) window.saveMajorTopicMemory = saveMajorTopicMemory;

function cleanProposalHtml(raw) {
  if (!raw) return '';
  let text = String(raw).trim();
  
  // 1. Strip markdown code fences (```json, ```html, ```markdown, ```xml, ```)
  text = text.replace(/^```(?:json|html|markdown|xml)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

  // 2. If it is JSON or wrapped in JSON { ... }
  if (text.startsWith('{') || text.includes('"proposal_c_html"') || text.includes('"proposal_a_html"') || text.includes('"proposal_b_html"') || text.includes('"proposal_html"')) {
    try {
      const parsed = JSON.parse(text);
      const props = parsed.properties || parsed;
      const htmlCandidate = props.proposal_c_html || props.proposal_a_html || props.proposal_b_html || props.proposal_html || props.proposalC || props.proposalA || props.proposalB || props.html || props.content;
      if (htmlCandidate && typeof htmlCandidate === 'string') {
        text = htmlCandidate.trim();
      }
    } catch (_err) {
      // Regex extraction fallback for unescaped JSON strings
      const fieldMatch = text.match(/"(?:proposal_c_html|proposal_a_html|proposal_b_html|proposal_html|proposalC|proposalA|proposalB|html|content)"\s*:\s*"((?:[^"\\]|\\.)*)"/s);
      if (fieldMatch && fieldMatch[1]) {
        try {
          text = JSON.parse(`"${fieldMatch[1]}"`).trim();
        } catch (_jsonErr) {
          text = fieldMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\r/g, '').replace(/\\t/g, '\t').replace(/\\\//g, '/').trim();
        }
      } else {
        const relaxedMatch = text.match(/"proposal_[abc]_html"\s*:\s*"(.*?)"\s*,\s*"(?:summary_rationale|rationale|topic)/s);
        if (relaxedMatch && relaxedMatch[1]) {
          text = relaxedMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\r/g, '').replace(/\\t/g, '\t').replace(/\\\//g, '/').trim();
        }
      }
    }
  }

  // 3. Strip any residual code fences from extracted content
  text = text.replace(/^```(?:json|html|markdown|xml)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

  // 4. If model returned markdown headers/lists instead of HTML, convert safely
  if ((text.startsWith('#') || text.includes('\n#') || text.includes('\n- ')) && !text.includes('<h') && !text.includes('<p>')) {
    if (typeof mdToPreviewHTML === 'function') {
      text = mdToPreviewHTML(text);
    }
  }

  // 5. Normalize header structure: convert any <h1> to <h2>
  text = text.replace(/<h1(\b[^>]*)>(.*?)<\/h1>/gi, '<h2$1>$2</h2>');

  // 6. Strip non-usable/placeholder hyperlinks or empty/dummy hrefs (convert to text, preserve valid links)
  text = text.replace(/<a\b[^>]*href=["'](?:#|javascript:[^"']*|https?:\/\/(?:example\.com|placeholder|localhost)[^"']*)["'][^>]*>(.*?)<\/a>/gi, '$1');
  text = text.replace(/<a(?:\s+(?!href\b)[^>]+)*>(.*?)<\/a>/gi, '$1');

  // 7. Clean unusable raw bracket syntax in headings or body
  text = text.replace(/<h([2-6])([^>]*)>(.*?)<\/h\1>/gi, (_m, level, attrs, inner) => {
    const cleanInner = inner.replace(/\[\[(.*?)\]\]/g, '$1');
    return `<h${level}${attrs}>${cleanInner}</h${level}>`;
  });
  text = text.replace(/\s*\(ref:\s*\[\[\s*\]\]\)/gi, '');
  text = text.replace(/\s*\(ref:\s*\[\[(.*?)\]\]\)/gi, ' (from: "$1")');

  // 8. Strip unusable placeholder tags like [TBD], [Link], [Insert ...]
  text = text.replace(/\[(?:Insert [^\]]+|TBD|Placeholder|Link|URL)\]/gi, '');

  // 9. Remove empty header tags
  text = text.replace(/<h[1-6]>\s*<\/h[1-6]>/gi, '');

  // 10. Clean up list item bullet points (strip inner <p>/<div> wrappers, internal <br> tags, and redundant bullet markers)
  text = text.replace(/<li(\b[^>]*)>([\s\S]*?)<\/li>/gi, (_match, attrs, content) => {
    let cleanContent = content
      .replace(/<\/?(?:p|div)\b[^>]*>/gi, ' ')
      .replace(/(?:<br\s*\/?>\s*)+/gi, ' ')
      .replace(/^\s*(?:[\-\*•\u2022\u2013\u2014]|\d+[\.\)])\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();
    return `<li${attrs}>${cleanContent}</li>`;
  });
  text = text.replace(/<li(\b[^>]*)>\s*<\/li>/gi, '');

  // 11. Normalize whitespace and collapse stacked line breaks
  text = text.replace(/(?:<br\s*\/?>\s*){2,}/gi, '<br>');
  text = text.replace(/<\/li>\s*(?:<br\s*\/?>\s*)+/gi, '</li>');
  text = text.replace(/<li(\b[^>]*)>\s*(?:<br\s*\/?>\s*)+/gi, '<li$1>');
  text = text.replace(/<ul(\b[^>]*)>\s*(?:<br\s*\/?>\s*)+/gi, '<ul$1>');
  text = text.replace(/(?:<br\s*\/?>\s*)+\s*<\/ul>/gi, '</ul>');
  text = text.replace(/<ol(\b[^>]*)>\s*(?:<br\s*\/?>\s*)+/gi, '<ol$1>');
  text = text.replace(/(?:<br\s*\/?>\s*)+\s*<\/ol>/gi, '</ol>');
  text = text.replace(/<\/h[1-6]>\s*(?:<br\s*\/?>\s*)+/gi, (m) => m.replace(/(?:<br\s*\/?>\s*)+/gi, ''));

  // 12. Normalize & prune excessive highlighting so only key takeaways remain highlighted
  text = text.replace(/<mark\b[^>]*>\s*(<(?:h[1-6]|ul|ol|li|p)\b[\s\S]*?<\/(?:h[1-6]|ul|ol|li|p)>)\s*<\/mark>/gi, '$1');
  const markMatches = text.match(/<mark\b[^>]*>[\s\S]*?<\/mark>/gi);
  if (markMatches && markMatches.length > 4) {
    let markCount = 0;
    text = text.replace(/<mark\b[^>]*>([\s\S]*?)<\/mark>/gi, (_m, inner) => {
      markCount++;
      if (markCount <= 4) return `<mark>${inner}</mark>`;
      return inner;
    });
  }

  if (typeof normalizeHighlightsToSentenceFacts === 'function') {
    text = normalizeHighlightsToSentenceFacts(text);
  }

  return text;
}

function restoreOriginalImagesToProposal(originalHtml, proposalHtml) {
  if (!originalHtml || typeof originalHtml !== 'string') return proposalHtml;
  if (!proposalHtml || typeof proposalHtml !== 'string') return proposalHtml;

  const originalImageEntries = [];
  const tokenMap = typeof _imgTokenMap !== 'undefined' ? _imgTokenMap : (window._imgTokenMap || {});

  // Extract images in document order: <img> tags, NIMGTK tokens, or markdown images along with surrounding context
  const itemRegex = /(?:<img\b[^>]*>)|(?:\bNIMGTK\d+X\b)|(?:!\[([^\]]*)\]\(([^)]+)\))/gi;
  let match;
  let imgCount = 0;
  while ((match = itemRegex.exec(originalHtml)) !== null) {
    const fullMatch = match[0];
    let tag = '';
    if (fullMatch.startsWith('<img') || fullMatch.startsWith('<IMG')) {
      tag = fullMatch;
    } else if (fullMatch.startsWith('NIMGTK')) {
      const mapped = tokenMap && tokenMap[fullMatch];
      if (typeof mapped === 'string' && mapped.includes('<img')) {
        tag = mapped;
      }
    } else if (match[2]) {
      const alt = match[1] || '';
      const src = match[2] || '';
      tag = `<img src="${src}" alt="${typeof escH === 'function' ? escH(alt) : alt}" style="max-width: 100%; border-radius: 6px;" />`;
    }

    if (tag && !originalImageEntries.some(e => e.tag === tag)) {
      imgCount++;
      const matchIndex = match.index;
      const matchEnd = matchIndex + fullMatch.length;

      // Extract preceding text (up to 250 chars)
      const rawBefore = originalHtml.slice(Math.max(0, matchIndex - 250), matchIndex);
      const precedingText = rawBefore.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

      // Extract following text (up to 250 chars)
      const rawAfter = originalHtml.slice(matchEnd, Math.min(originalHtml.length, matchEnd + 250));
      const followingText = rawAfter.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

      const positionRatio = matchIndex / Math.max(1, originalHtml.length);

      originalImageEntries.push({
        tag,
        index: imgCount - 1,
        precedingText,
        followingText,
        positionRatio
      });
    }
  }

  // Also include any other img tags from tokenMap that might not have been matched
  if (tokenMap && typeof tokenMap === 'object') {
    Object.values(tokenMap).forEach(t => {
      if (typeof t === 'string' && t.includes('<img') && !originalImageEntries.some(e => e.tag === t)) {
        originalImageEntries.push({
          tag: t,
          index: originalImageEntries.length,
          precedingText: '',
          followingText: '',
          positionRatio: 1.0
        });
      }
    });
  }

  if (originalImageEntries.length === 0) {
    // If no images to inject, clean up any residual placeholder tags like [IMAGE_1]
    return proposalHtml.replace(/(?:<p>\s*)?\[\s*IMAGE[_\s]\d+(?::[^\]]*)?\s*\](?:\s*<\/p>)?/gi, '');
  }

  let resultHtml = proposalHtml;
  const usedImgs = new Set();

  // Track any images already directly present in proposalHtml
  originalImageEntries.forEach(entry => {
    if (resultHtml.includes(entry.tag)) {
      usedImgs.add(entry.tag);
    }
  });

  // 1. Replace explicit [IMAGE_X] placeholders inline (handling both inside <p> and standalone)
  resultHtml = resultHtml.replace(/(?:<p>\s*)?\[\s*IMAGE[_\s](\d+)(?::[^\]]*)?\s*\](?:\s*<\/p>)?/gi, (fullMatch, idxStr) => {
    const idx = parseInt(idxStr, 10) - 1;
    let chosenEntry = null;
    if (idx >= 0 && idx < originalImageEntries.length) {
      chosenEntry = originalImageEntries[idx];
    } else {
      chosenEntry = originalImageEntries.find(e => !usedImgs.has(e.tag)) || null;
    }

    if (chosenEntry) {
      usedImgs.add(chosenEntry.tag);
      return `\n<div class="note-embedded-image-wrap" style="margin: 14px 0; max-width: 100%; text-align: center;">${chosenEntry.tag}</div>\n`;
    }
    return '';
  });

  // Replace any generic [IMAGE] placeholders
  resultHtml = resultHtml.replace(/(?:<p>\s*)?\[\s*IMAGE(?::[^\]]*)?\s*\](?:\s*<\/p>)?/gi, () => {
    const chosenEntry = originalImageEntries.find(e => !usedImgs.has(e.tag)) || null;
    if (chosenEntry) {
      usedImgs.add(chosenEntry.tag);
      return `\n<div class="note-embedded-image-wrap" style="margin: 14px 0; max-width: 100%; text-align: center;">${chosenEntry.tag}</div>\n`;
    }
    return '';
  });

  // 2. Contextual in-situ placement for any remaining unplaced images
  const unplacedEntries = originalImageEntries.filter(e => !usedImgs.has(e.tag) && !resultHtml.includes(e.tag));

  if (unplacedEntries.length > 0) {
    const extractKeywords = (str) => {
      if (!str) return [];
      const words = str.toLowerCase().replace(/[^a-z0-9\u00C0-\u024F\u0400-\u04FF]+/gi, ' ').split(/\s+/).filter(w => w.length >= 4);
      const stopWords = new Set(['this', 'that', 'with', 'from', 'have', 'were', 'which', 'there', 'their', 'about', 'would', 'could', 'should', 'these', 'those', 'also', 'after', 'before', 'where', 'when', 'what', 'some', 'than', 'then', 'into', 'only', 'other', 'such', 'more', 'even', 'most', 'been', 'being', 'here', 'note', 'meeting', 'discussion']);
      return words.filter(w => !stopWords.has(w));
    };

    const blockEndRegex = /<\/(p|h2|h3|h4|ul|ol|blockquote|div)>/gi;
    const blocks = [];
    let bMatch;
    let lastEnd = 0;
    while ((bMatch = blockEndRegex.exec(resultHtml)) !== null) {
      const endPos = bMatch.index + bMatch[0].length;
      const blockSlice = resultHtml.slice(lastEnd, endPos);
      const cleanText = blockSlice.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      blocks.push({
        tag: bMatch[1].toLowerCase(),
        endPos,
        text: cleanText,
        keywords: extractKeywords(cleanText)
      });
      lastEnd = endPos;
    }

    if (blocks.length > 0) {
      unplacedEntries.forEach(entry => {
        const imageWrapHtml = `\n<div class="note-embedded-image-wrap" style="margin: 14px 0; max-width: 100%; text-align: center;">${entry.tag}</div>\n`;
        const preKeywords = extractKeywords(entry.precedingText);
        const postKeywords = extractKeywords(entry.followingText);

        let bestBlock = null;
        let bestScore = 0;

        if (preKeywords.length > 0) {
          blocks.forEach(b => {
            if (b.tag === 'h2' && !b.text) return;
            let score = 0;
            preKeywords.forEach(kw => {
              if (b.keywords.includes(kw)) score += 2;
              else if (b.text.toLowerCase().includes(kw)) score += 1;
            });
            if (score > bestScore) {
              bestScore = score;
              bestBlock = b;
            }
          });
        }

        if (bestScore < 2 && postKeywords.length > 0) {
          blocks.forEach(b => {
            let score = 0;
            postKeywords.forEach(kw => {
              if (b.keywords.includes(kw)) score += 2;
              else if (b.text.toLowerCase().includes(kw)) score += 1;
            });
            if (score > bestScore) {
              bestScore = score;
              bestBlock = b;
            }
          });
        }

        if (!bestBlock || bestScore === 0) {
          const targetIndex = Math.min(blocks.length - 1, Math.max(0, Math.floor(entry.positionRatio * blocks.length)));
          bestBlock = blocks[targetIndex];
        }

        if (bestBlock) {
          usedImgs.add(entry.tag);
          const insertIdx = bestBlock.endPos;
          resultHtml = resultHtml.slice(0, insertIdx) + imageWrapHtml + resultHtml.slice(insertIdx);

          const addedLen = imageWrapHtml.length;
          blocks.forEach(b => {
            if (b.endPos >= insertIdx) {
              b.endPos += addedLen;
            }
          });
        }
      });
    }
  }

  // 3. Fallback for any still-unplaced images (e.g. 0 blocks in resultHtml)
  const remaining = originalImageEntries.filter(e => !usedImgs.has(e.tag) && !resultHtml.includes(e.tag));
  if (remaining.length > 0) {
    const lang = typeof getAppLanguage === 'function' ? getAppLanguage() : 'en';
    const sectionTitle = lang === 'fr' ? 'Images & Captures jointes' : lang === 'de' ? 'Angehängte Bilder & Screenshots' : lang === 'es' ? 'Imágenes y capturas adjuntas' : lang === 'it' ? 'Immagini e screenshot allegati' : 'Attached Images & Screenshots';
    resultHtml += `\n<h2>${typeof escH === 'function' ? escH(sectionTitle) : sectionTitle}</h2>\n<div class="note-attached-images-gallery" style="display:flex; flex-wrap:wrap; gap:12px; margin-top:8px;">\n${remaining.map(e => `<div style="max-width:100%; margin-bottom:8px;">${e.tag}</div>`).join('\n')}\n</div>`;
  }

  return resultHtml;
}

function cleanRefactoredProposalHtml(html = '', currentUserName = '') {
  if (!html || typeof html !== 'string') return html;

  let cleaned = html;

  // Replace generic @User or @UserX placeholder mentions with the actual active username if set
  if (currentUserName && currentUserName.toLowerCase() !== 'me') {
    const userTag = `@${currentUserName.replace(/^@/, '')}`;
    cleaned = cleaned.replace(/@User\b/gi, userTag);
  }

  // Strip square bracketed urgency/importance tags (e.g. [Urgent], [High], [Medium], [Low], [ASAP], [Critical], [High Urgency], [Low Urgency])
  cleaned = cleaned.replace(/\[\s*(urgent|high|medium|low|critical|asap|\w+\s+urgency|\w+\s+priority)\s*\]/gi, '').trim();

  // Clean up any spaces left before punctuation marks (e.g. " execution ." -> " execution.")
  cleaned = cleaned.replace(/\s+([.,;:!?])/g, '$1');

  // Clean up any multiple consecutive spaces left behind
  cleaned = cleaned.replace(/  +/g, ' ');

  return cleaned;
}

function cleanMeetingSummaryHtml(raw = '', currentUserName = '') {
  if (!raw) return '';
  let text = String(raw).trim();

  // 1. Strip markdown code fences
  text = text.replace(/^```(?:json|html|markdown|xml)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

  // 2. If it is JSON or wrapped in JSON { ... }
  if (text.startsWith('{') || text.includes('"meeting_summary_html"') || text.includes('"summary_html"') || text.includes('"general_comment"')) {
    try {
      const parsed = JSON.parse(text);
      const props = parsed.properties || parsed;
      const htmlCand = props.meeting_summary_html || props.summary_html || props.meeting_summary || props.general_comment || props.summary || props.html;
      if (htmlCand && typeof htmlCand === 'string') {
        text = htmlCand.trim();
      }
    } catch (_err) {
      const fieldMatch = text.match(/"(?:meeting_summary_html|summary_html|meeting_summary|general_comment|summary)"\s*:\s*"((?:[^"\\]|\\.)*)"/s);
      if (fieldMatch && fieldMatch[1]) {
        try {
          text = JSON.parse(`"${fieldMatch[1]}"`).trim();
        } catch (_jsonErr) {
          text = fieldMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\r/g, '').replace(/\\t/g, '\t').replace(/\\\//g, '/').trim();
        }
      }
    }
  }

  // 3. Strip code fences from extracted content
  text = text.replace(/^```(?:json|html|markdown|xml)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

  // 4. Convert markdown if needed
  if ((text.startsWith('#') || text.includes('\n#') || text.includes('\n- ') || text.includes('\n* ')) && !text.includes('<p>') && !text.includes('<ul>')) {
    if (typeof mdToPreviewHTML === 'function') {
      text = mdToPreviewHTML(text);
    }
  }

  // 5. Strip any header tags from summary fragment and convert to bold paragraph
  text = text.replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, '<p><strong>$1</strong></p>');

  // 6. Clean unusable hyperlinks or placeholder text
  text = text.replace(/<a\b[^>]*href=["'](?:#|javascript:[^"']*|https?:\/\/(?:example\.com|placeholder|localhost)[^"']*)["'][^>]*>(.*?)<\/a>/gi, '$1');
  text = text.replace(/<a(?:\s+(?!href\b)[^>]+)*>(.*?)<\/a>/gi, '$1');
  text = text.replace(/\[\[(.*?)\]\]/g, '$1');
  text = text.replace(/\[(?:Insert [^\]]+|TBD|Placeholder|Link|URL)\]/gi, '');

  // 7. Clean up list items
  text = text.replace(/<li(\b[^>]*)>([\s\S]*?)<\/li>/gi, (_match, attrs, content) => {
    let cleanContent = content
      .replace(/<\/?(?:p|div)\b[^>]*>/gi, ' ')
      .replace(/(?:<br\s*\/?>\s*)+/gi, ' ')
      .replace(/^\s*(?:[\-\*•\u2022\u2013\u2014]|\d+[\.\)])\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();
    return `<li${attrs}>${cleanContent}</li>`;
  });
  text = text.replace(/<li(\b[^>]*)>\s*<\/li>/gi, '');

  // 8. Collapse whitespace and line breaks
  text = text.replace(/(?:<br\s*\/?>\s*){2,}/gi, '<br>');
  text = text.replace(/<\/li>\s*(?:<br\s*\/?>\s*)+/gi, '</li>');
  text = text.replace(/<p>\s*<\/p>/gi, '');

  // 9. Clean up username mentions & bracketed urgency
  if (typeof cleanRefactoredProposalHtml === 'function') {
    text = cleanRefactoredProposalHtml(text, currentUserName);
  }

  if (typeof sanitizeLLMHTML === 'function') {
    text = sanitizeLLMHTML(text.trim());
  }

  return text.trim();
}
window.cleanMeetingSummaryHtml = cleanMeetingSummaryHtml;

function formatTodoTitleWithMetadata(title = '', owner = '', urgency = '') {
  if (typeof cleanTaskTitleText === 'function') {
    return cleanTaskTitleText(title);
  }
  let cleanTitle = (title || '').trim();
  if (!cleanTitle) return '';

  // Remove leading bullet point markers / checkbox markers
  cleanTitle = cleanTitle.replace(/^[-*•\d+\.]+\s*/, '').replace(/^\[[ xX]?\]\s*/, '').trim();

  // Remove leading owner mentions (e.g. "@Sarah: ", "@Étienne ", "@Ярослав: ")
  cleanTitle = cleanTitle.replace(/^@[\p{L}\p{N}_\-]+\s*:?\s*/iu, '');

  // Remove any remaining inline @Colleague mentions
  cleanTitle = cleanTitle.replace(/@[\p{L}\p{N}_\-]+/gu, '').trim();

  // Remove urgency/importance/priority brackets (e.g. [Urgent], [High Urgency], [Medium Urgency], [Low Urgency], [High], [Medium], [Low], [ASAP], [Critical])
  cleanTitle = cleanTitle.replace(/\[\s*(urgent|high|medium|low|critical|asap|\w+\s+urgency|\w+\s+priority)\s*\]/gi, '').trim();

  // Clean up any multiple consecutive spaces left behind
  cleanTitle = cleanTitle.replace(/\s+/g, ' ').trim();

  return cleanTitle;
}

function extractProposedActionsFromProposal(proposalHtml, rawProps = {}) {
  const decisions = Array.isArray(rawProps.proposed_decisions) ? [...rawProps.proposed_decisions] : [];
  const todos = Array.isArray(rawProps.proposed_todos) ? [...rawProps.proposed_todos] : [];
  const colleagues = Array.isArray(rawProps.proposed_colleague_links) ? [...rawProps.proposed_colleague_links] : [];
  const notes = Array.isArray(rawProps.proposed_note_links) ? [...rawProps.proposed_note_links] : [];

  todos.forEach(t => {
    if (t && typeof t === 'object') {
      const imp = t.importance || t.priority || 'Medium';
      const urg = t.urgency || 'Medium';
      t.title = formatTodoTitleWithMetadata(t.title, t.owner, urg || imp);
    }
  });

  if (!proposalHtml || typeof proposalHtml !== 'string') {
    return { decisions, todos, colleagues, notes };
  }

  // 1. Extract @Colleague mentions from HTML text
  const colleagueRegex = /@([A-Z][a-zA-Z0-9_\-]+)/g;
  let match;
  while ((match = colleagueRegex.exec(proposalHtml)) !== null) {
    const name = match[1];
    if (!colleagues.includes(name)) colleagues.push(name);
  }

  // 2. Extract [[Note Title]] links from HTML text
  const noteRegex = /\[\[([^\]]+)\]\]/g;
  while ((match = noteRegex.exec(proposalHtml)) !== null) {
    const title = match[1].trim();
    if (!notes.some(n => (typeof n === 'string' ? n : n.title) === title)) {
      notes.push({ title, id: '' });
    }
  }

  // 3. Extract decisions from <h2>Decisions</h2> section HTML if not in proposed_decisions array
  if (decisions.length === 0) {
    const decSectionMatch = proposalHtml.match(/<h[2-4][^>]*>(?:Décisions|Decisions|Entscheidungen)[^<]*<\/h[2-4]>\s*<ul[^>]*>(.*?)<\/ul>/is);
    if (decSectionMatch && decSectionMatch[1]) {
      const liMatches = decSectionMatch[1].match(/<li[^>]*>(.*?)<\/li>/gi);
      if (liMatches) {
        liMatches.forEach(li => {
          const text = li.replace(/<[^>]+>/g, '').trim();
          if (text) {
            decisions.push({ text, status: 'active', major_topic: '', context: '' });
          }
        });
      }
    }
  }

  // 4. Extract action items from <h2>Next Steps & Action Items</h2> section HTML if not in proposed_todos array
  if (todos.length === 0) {
    const actionSectionMatch = proposalHtml.match(/<h[2-4][^>]*>(?:Next Steps|Prochaines étapes|Nächste Schritte|Action Items)[^<]*<\/h[2-4]>\s*<ul[^>]*>(.*?)<\/ul>/is);
    if (actionSectionMatch && actionSectionMatch[1]) {
      const liMatches = actionSectionMatch[1].match(/<li[^>]*>(.*?)<\/li>/gi);
      if (liMatches) {
        liMatches.forEach(li => {
          const text = li.replace(/<[^>]+>/g, '').trim();
          if (text) {
            const ownerMatch = text.match(/@([A-Z][a-zA-Z0-9_\-]+)/);
            const owner = ownerMatch ? ownerMatch[1] : '';
            const imp = text.toLowerCase().includes('urgent') || text.toLowerCase().includes('high') ? 'High' : (text.toLowerCase().includes('low') ? 'Low' : 'Medium');
            const urg = text.toLowerCase().includes('asap') || text.toLowerCase().includes('today') || text.toLowerCase().includes('urgent') ? 'High' : 'Medium';
            const formattedTitle = formatTodoTitleWithMetadata(text, owner, urg);
            todos.push({
              title: formattedTitle || text,
              owner,
              importance: imp,
              urgency: urg,
              priority: imp,
              deadline: ''
            });
          }
        });
      }
    }
  }

  const manifestList = (typeof todosManifest !== 'undefined' && Array.isArray(todosManifest))
    ? todosManifest
    : ((typeof window !== 'undefined' && Array.isArray(window.todosManifest)) ? window.todosManifest : []);

  const deduplicatedTodos = todos.filter(t => {
    if (!t || !t.title) return false;
    const cleanT = String(t.title).trim().toLowerCase();
    const isExisting = manifestList.some(m => m && m.priority !== 'Done' && (
      (t.id && m.id === t.id) ||
      (m.title && m.title.trim().toLowerCase() === cleanT)
    ));
    return !isExisting;
  });

  return { decisions, todos: deduplicatedTodos, colleagues, notes };
}

/* ── 🌟 Inline Uncertainty Highlight & Hover Actions Engine ── */
window.acceptInlineUncertainty = function(target) {
  let span = null;
  if (target && target.nodeType === 1) {
    span = target.classList.contains('inline-uncertain-text') ? target : target.closest('.inline-uncertain-text');
  } else if (typeof target === 'string') {
    span = document.querySelector(target);
  }
  if (!span) return;
  const parent = span.parentNode;
  if (!parent) return;

  const text = span.textContent;
  const textNode = document.createTextNode(text);
  parent.replaceChild(textNode, span);
  parent.dispatchEvent(new Event('input', { bubbles: true }));

  const popover = document.getElementById('uncertainty-hover-popover');
  if (popover) popover.style.display = 'none';

  if (typeof toast === 'function') {
    toast(typeof t === 'function' ? (t('dailyreview.inferenceAcceptedToast') || 'Inférence acceptée.') : 'Inference accepted.');
  }
};

window.revertInlineUncertainty = function(target) {
  let span = null;
  if (target && target.nodeType === 1) {
    span = target.classList.contains('inline-uncertain-text') ? target : target.closest('.inline-uncertain-text');
  } else if (typeof target === 'string') {
    span = document.querySelector(target);
  }
  if (!span) return;
  const parent = span.parentNode;
  if (!parent) return;

  const origText = span.getAttribute('data-original-text') || '';
  if (origText && origText.trim() && origText.toLowerCase() !== 'omitted' && origText.toLowerCase() !== 'null') {
    const textNode = document.createTextNode(origText);
    parent.replaceChild(textNode, span);
  } else {
    span.remove();
  }
  parent.dispatchEvent(new Event('input', { bubbles: true }));

  const popover = document.getElementById('uncertainty-hover-popover');
  if (popover) popover.style.display = 'none';

  if (typeof toast === 'function') {
    toast(typeof t === 'function' ? (t('dailyreview.inferenceRevertedToast') || 'Rétabli selon la note brute.') : 'Reverted to raw note.');
  }
};

window.setupUncertaintyHoverCards = function(containerEl) {
  if (!containerEl || typeof document === 'undefined') return;

  let popover = document.getElementById('uncertainty-hover-popover');
  if (!popover && document.body) {
    popover = document.createElement('div');
    popover.id = 'uncertainty-hover-popover';
    popover.className = 'uncertainty-hover-card';
    popover.style.display = 'none';
    document.body.appendChild(popover);
  }

  let hideTimeout = null;

  if (popover) {
    popover.onmouseenter = () => {
      if (hideTimeout) clearTimeout(hideTimeout);
    };
    popover.onmouseleave = () => {
      popover.style.display = 'none';
    };
  }

  const spans = containerEl.querySelectorAll('.inline-uncertain-text');
  spans.forEach(span => {
    if (span._hasHoverListener) return;
    span._hasHoverListener = true;

    span.addEventListener('mouseenter', () => {
      if (hideTimeout) clearTimeout(hideTimeout);
      if (!popover) return;

      const reason = span.getAttribute('data-uncertainty-reason') || ((typeof t === 'function' && t('dailyreview.uncertainDetail')) || 'Détail inféré / incertain');
      const orig = span.getAttribute('data-original-text') || '';

      const acceptLabel = (typeof t === 'function' && t('dailyreview.acceptInference')) || 'Accepter';
      const revertLabel = (typeof t === 'function' && t('dailyreview.revertInference')) || 'Rétablir';
      const titleLabel = (typeof t === 'function' && t('dailyreview.uncertainDetail')) || 'Point incertain / Inférence';

      popover.innerHTML = `
        <div class="uncertainty-hover-header">
          <span class="uncertainty-hover-icon">⚠️</span>
          <span class="uncertainty-hover-title">${escH(titleLabel)}</span>
        </div>
        <div class="uncertainty-hover-body">
          <div class="uncertainty-hover-reason">${escH(reason)}</div>
          ${orig && orig !== 'omitted' && orig !== 'null' ? `<div class="uncertainty-hover-orig"><strong>Note brute :</strong> <em>"${escH(orig)}"</em></div>` : ''}
        </div>
        <div class="uncertainty-hover-actions">
          <button type="button" class="btn btn-secondary btn-uncertain-revert" onclick="event.stopPropagation(); window.revertInlineUncertainty(window._activeUncertainSpan);" title="${escA(revertLabel)}">✕ ${escH(revertLabel)}</button>
          <button type="button" class="btn btn-primary btn-uncertain-accept" onclick="event.stopPropagation(); window.acceptInlineUncertainty(window._activeUncertainSpan);" title="${escA(acceptLabel)}">✓ ${escH(acceptLabel)}</button>
        </div>
      `;

      window._activeUncertainSpan = span;
      popover.style.display = 'flex';

      if (typeof span.getBoundingClientRect === 'function') {
        const rect = span.getBoundingClientRect();
        const popRect = popover.getBoundingClientRect ? popover.getBoundingClientRect() : { width: 260, height: 110 };
        let top = rect.bottom + 6;
        let left = rect.left + (rect.width / 2) - (popRect.width / 2);

        if (left < 10) left = 10;
        if (typeof window !== 'undefined' && left + popRect.width > window.innerWidth - 10) {
          left = window.innerWidth - popRect.width - 10;
        }
        if (typeof window !== 'undefined' && top + popRect.height > window.innerHeight - 10) {
          top = rect.top - popRect.height - 6;
        }

        popover.style.top = `${Math.round(top)}px`;
        popover.style.left = `${Math.round(left)}px`;
      }
    });

    span.addEventListener('mouseleave', () => {
      hideTimeout = setTimeout(() => {
        if (popover) popover.style.display = 'none';
      }, 250);
    });
  });
};

/* ── 🌟 Perfect Note Refactoring Controller & Modals ── */
const RefactorModalController = {
  activeNote: null,
  activeNoteContent: '',
  originalHtmlSnapshot: '',
  originalHtml: '',
  activeTab: null,
  proposalA: '',
  proposalB: '',
  proposalC: '',
  proposalActionsA: null,
  proposalActionsB: null,
  proposalActionsC: null,
  meetingSummary: '',
  meetingSummaryA: '',
  meetingSummaryB: '',
  meetingSummaryC: '',
  proposedWorkstreams: [],
  proposedGroup: null,
  proposedTopic: null,
  tagChangeReason: '',
  acceptedTagChanges: false,
  tabBaselineHtml: { A: '', B: '', C: '', original: '' },
  scratchpad: '',
  scratchpadLog: [],
  topicMemories: [],
  proposedTopicSplits: [],
  clarificationQuestions: [],
  clarificationAnswers: {},
  currentAbortController: null,
  _boundKeyHandler: null,

  toggleAcceptTags(btn) {
    this.acceptedTagChanges = !this.acceptedTagChanges;
    if (btn) {
      btn.textContent = this.acceptedTagChanges
        ? '✓ ' + ((typeof t === 'function' && t('common.accepted')) || 'Accepted')
        : '+ ' + ((typeof t === 'function' && t('dailyreview.acceptTagSuggestions')) || 'Accept Suggestions');
      btn.classList.toggle('btn-primary', this.acceptedTagChanges);
      btn.classList.toggle('btn-secondary', !this.acceptedTagChanges);
    }
    if (this.acceptedTagChanges) {
      toast(typeof t === 'function' ? (t('dailyreview.tagsAcceptedToast') || 'Suggestions de dossiers et tags sélectionnées pour validation') : 'Workstream & tag suggestions selected');
    }
  },

  renderTagsBanner(container, options = {}) {
    if (!container) return;
    const note = options.note || this.activeNote || (typeof currentNote !== 'undefined' ? currentNote : null);
    const proposal = options.proposal || this;
    const isAccepted = !!(options.accepted ?? proposal.acceptedTagChanges ?? this.acceptedTagChanges);
    const onToggle = options.onToggle || 'RefactorModalController.toggleAcceptTags(this)';

    const proposedWorkstreams = Array.isArray(proposal.proposedWorkstreams) ? proposal.proposedWorkstreams : [];
    const proposedGroup = proposal.proposedGroup || null;
    const proposedTopic = proposal.proposedTopic || null;
    const tagChangeReason = proposal.tagChangeReason || '';

    if (proposedWorkstreams.length === 0 && !proposedGroup && !proposedTopic) {
      container.style.display = 'none';
      container.innerHTML = '';
      return;
    }

    container.style.display = 'block';

    // Extract current tags from note
    const currentWorkstreams = (typeof getNoteWorkstreams === 'function' && note)
      ? getNoteWorkstreams(note)
      : (note?.workstreams || (typeof note?.workstream === 'string' ? note.workstream.split(',').map(s => s.trim()).filter(Boolean) : []));
    const currentGroup = note?.group || (Array.isArray(note?.group_tags) && note.group_tags.length ? note.group_tags.join(', ') : '') || '';
    const currentTopic = note?.topic || (Array.isArray(note?.topic_tags) && note.topic_tags.length ? note.topic_tags.join(', ') : '') || '';

    const noneLabel = (typeof t === 'function' && t('refactor.noTagsAssigned')) || 'None';
    const currentLabel = (typeof t === 'function' && t('refactor.currentTags')) || 'Currently Assigned';
    const proposedLabel = (typeof t === 'function' && t('refactor.proposedTags')) || 'Proposed Changes';
    const groupLabel = (typeof t === 'function' && t('refactor.groupLabel')) || 'Group';
    const topicLabel = (typeof t === 'function' && t('refactor.topicLabel')) || 'Topic';

    // Current tags layout
    const currentWsHtml = currentWorkstreams.length > 0
      ? currentWorkstreams.map(w => `<span class="workstream-chip" style="font-size:0.75rem; opacity:0.85;">${escH(w)}</span>`).join(' ')
      : `<span style="color:var(--text-muted); font-size:0.78rem;">${escH(noneLabel)}</span>`;

    const currentMetaParts = [];
    if (currentGroup) currentMetaParts.push(`${escH(groupLabel)}: <strong>${escH(currentGroup)}</strong>`);
    if (currentTopic) currentMetaParts.push(`${escH(topicLabel)}: <strong>${escH(currentTopic)}</strong>`);
    const currentMetaHtml = currentMetaParts.length ? currentMetaParts.join(' • ') : '';

    // Proposed tags layout
    const proposedWsHtml = proposedWorkstreams.length > 0
      ? proposedWorkstreams.map(w => `<span class="workstream-chip active-workstream-chip" style="font-size:0.78rem; font-weight:600;">${escH(w)}</span>`).join(' ')
      : `<span style="color:var(--text-muted); font-size:0.78rem;">${escH(noneLabel)}</span>`;

    const proposedMetaParts = [];
    if (proposedGroup) proposedMetaParts.push(`${escH(groupLabel)}: <strong>${escH(proposedGroup)}</strong>`);
    if (proposedTopic) proposedMetaParts.push(`${escH(topicLabel)}: <strong>${escH(proposedTopic)}</strong>`);
    const proposedMetaHtml = proposedMetaParts.join(' • ');

    const toggleHandlerAttr = typeof onToggle === 'function' ? '' : `onclick="${onToggle}"`;

    container.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap;">
        <div style="flex:1; min-width:240px; display:flex; flex-direction:column; gap:4px;">
          <div style="display:flex; align-items:center; gap:8px; font-size:0.82rem; flex-wrap:wrap;">
            <div style="display:inline-flex; align-items:center; gap:4px; color:var(--text-muted);">
              <span style="font-weight:600;">${escH(currentLabel)}:</span>
              <span style="display:inline-flex; gap:3px; align-items:center;">${currentWsHtml}</span>
              ${currentMetaHtml ? `<span style="font-size:0.76rem;">(${currentMetaHtml})</span>` : ''}
            </div>
            <span style="color:var(--accent); font-weight:700; opacity:0.8;">➔</span>
            <div style="display:inline-flex; align-items:center; gap:4px;">
              <span style="font-weight:700; color:var(--accent);">🏷️ ${escH(proposedLabel)}:</span>
              <span style="display:inline-flex; gap:3px; align-items:center;">${proposedWsHtml}</span>
              ${proposedMetaHtml ? `<span style="font-size:0.78rem; color:var(--text-muted);">(${proposedMetaHtml})</span>` : ''}
            </div>
          </div>
          ${tagChangeReason ? `<div style="font-size:0.78rem; color:var(--text-muted); font-style:italic; line-height:1.3; margin-top:2px;">"${escH(tagChangeReason)}"</div>` : ''}
        </div>
        <button type="button" class="btn ${isAccepted ? 'btn-primary' : 'btn-secondary'} refactor-accept-tags-btn" style="font-size:0.75rem; padding:4px 10px; white-space:nowrap; align-self:center;" ${toggleHandlerAttr} title="${escA((typeof t === 'function' && t('dailyreview.acceptTagSuggestions')) || 'Accept Workstream & Tag suggestions')}">
          ${isAccepted ? '✓ ' + ((typeof t === 'function' && t('common.accepted')) || 'Accepted') : '+ ' + ((typeof t === 'function' && t('dailyreview.acceptTagSuggestions')) || 'Accept Suggestions')}
        </button>
      </div>
    `;

    if (typeof onToggle === 'function') {
      const btn = container.querySelector('.refactor-accept-tags-btn');
      if (btn) btn.onclick = (e) => onToggle(btn, e);
    }
  },

  async commitWorkstreamAndTagChanges(note, proposal) {
    if (!proposal) return;
    const isAccepted = proposal.acceptedTagChanges ?? this.acceptedTagChanges;
    if (!isAccepted) return;

    const targetNote = note || this.activeNote || (typeof currentNote !== 'undefined' ? currentNote : null);
    const proposedWorkstreams = Array.isArray(proposal.proposedWorkstreams) ? proposal.proposedWorkstreams : (this.proposedWorkstreams || []);
    const proposedGroup = proposal.proposedGroup || this.proposedGroup;
    const proposedTopic = proposal.proposedTopic || this.proposedTopic;

    if (Array.isArray(proposedWorkstreams) && proposedWorkstreams.length > 0) {
      for (const ws of proposedWorkstreams) {
        if (typeof assignNoteToWorkstream === 'function') {
          try { await assignNoteToWorkstream(ws); } catch (e) { console.warn('Failed to assign note to workstream', e); }
        }
      }
    }

    if (proposedGroup && typeof populateTagEditor === 'function') {
      populateTagEditor('editor-group', [proposedGroup], 'group');
      if (typeof currentNote !== 'undefined' && currentNote) currentNote.group_tags = [proposedGroup];
      if (targetNote) targetNote.group_tags = [proposedGroup];
    }

    if (proposedTopic && typeof populateTagEditor === 'function') {
      populateTagEditor('editor-topic', [proposedTopic], 'topic');
      if (typeof currentNote !== 'undefined' && currentNote) currentNote.topic_tags = [proposedTopic];
      if (targetNote) targetNote.topic_tags = [proposedTopic];
    }

    if (targetNote && Array.isArray(proposedWorkstreams) && proposedWorkstreams.length > 0) {
      targetNote.workstreams = [...proposedWorkstreams];
      targetNote.workstream = proposedWorkstreams.join(', ');
    }
  },

  popoutAuxiliaryWindow() {
    const note = this.activeNote || (typeof currentNote !== 'undefined' ? currentNote : null);
    if (note && window.AppBridge?.noteWindow) {
      window.AppBridge.noteWindow.open(note.id, note.path);
    }
  },

  setRefactorLockState(locked) {
    const editor = document.getElementById('edit-textarea');
    if (editor && typeof editor.setAttribute === 'function') {
      if (locked) {
        editor.setAttribute('contenteditable', 'false');
        if (editor.classList && typeof editor.classList.add === 'function') editor.classList.add('editor-locked');
      } else {
        editor.setAttribute('contenteditable', 'true');
        if (editor.classList && typeof editor.classList.remove === 'function') editor.classList.remove('editor-locked');
      }
    }
    const summaryEditor = document.getElementById('edit-summary');
    if (summaryEditor && typeof summaryEditor.setAttribute === 'function') {
      if (locked) {
        summaryEditor.setAttribute('contenteditable', 'false');
        if (summaryEditor.classList && typeof summaryEditor.classList.add === 'function') summaryEditor.classList.add('editor-locked');
      } else {
        summaryEditor.setAttribute('contenteditable', 'true');
        if (summaryEditor.classList && typeof summaryEditor.classList.remove === 'function') summaryEditor.classList.remove('editor-locked');
      }
    }
    const titleInput = document.getElementById('edit-title');
    if (titleInput) titleInput.disabled = locked;
    const dateInput = document.getElementById('edit-date');
    if (dateInput) dateInput.disabled = locked;

    // When calling an agent in the perfect note, the info tab can be hidden
    if (locked) {
      if (typeof metadataCollapsed !== 'undefined' && !metadataCollapsed) {
        if (typeof toggleMetadataCollapse === 'function') {
          toggleMetadataCollapse();
        } else if (typeof _applyMetadataCollapseState === 'function') {
          metadataCollapsed = true;
          _applyMetadataCollapseState();
        }
      }
    }

    const validateBtn = document.getElementById('overlay-validate-note-btn');
    if (validateBtn) {
      validateBtn.disabled = locked;
      validateBtn.style.pointerEvents = locked ? 'none' : '';
      validateBtn.style.opacity = locked ? '0.45' : '';
    }

    const drNextBtn = document.getElementById('btn-dr-next');
    if (drNextBtn) drNextBtn.disabled = locked;
    const drPrevBtn = document.getElementById('btn-dr-prev');
    if (drPrevBtn) {
      const isStep1OrInactive = typeof DailyReviewController !== 'undefined' ? DailyReviewController.currentStep <= 1 : true;
      drPrevBtn.disabled = locked || isStep1OrInactive;
    }
  },

  updateRefactorProgress(pct, statusMsg, thinkingText = '', customTitle = null) {
    const editorProgressWrap = document.getElementById('note-editor-ai-progress');
    const editorProgressBar = document.getElementById('note-editor-ai-progress-bar');
    const editorStatusEl = document.getElementById('note-editor-ai-progress-status');
    const editorTitleEl = document.getElementById('note-editor-ai-progress-title');
    const editorPctEl = document.getElementById('note-editor-ai-progress-pct');
    const editorCancelBtn = document.getElementById('btn-note-editor-ai-cancel');
    const editorThinkingEl = document.getElementById('note-editor-ai-progress-thinking');

    const drProgressWrap = document.getElementById('dr-step3-progress-container');
    const drProgressBar = document.getElementById('dr-step3-progress-bar');
    const drStatusEl = document.getElementById('dr-step3-progress-status');
    const drTitleEl = document.getElementById('dr-step3-progress-title');
    const drCancelBtn = document.getElementById('btn-dr-step3-cancel-refactor');

    const modalBanner = document.getElementById('refactor-modal-progress-banner');
    const modalText = document.getElementById('refactor-modal-progress-text');
    const modalBar = document.getElementById('refactor-modal-progress-bar');

    const modalEl = document.getElementById('modal-refactor-proposals');
    const isModalVisible = !!(modalEl && modalEl.style.display !== 'none' && (modalEl.classList.contains('active') || modalEl.style.visibility !== 'hidden'));

    if (pct === false || pct === null) {
      if (modalBanner) modalBanner.style.display = 'none';
      if (editorProgressWrap) editorProgressWrap.style.display = 'none';
      if (editorThinkingEl) {
        editorThinkingEl.style.display = 'none';
        editorThinkingEl.innerHTML = '';
      }
      if (drProgressWrap) drProgressWrap.style.display = 'none';
      return;
    }

    const clampedPct = Math.max(0, Math.min(100, Math.round(pct)));
    const titleText = customTitle || t('refactor.refactoringInProgress') || "Restructuration en cours par l'IA (Perfect Note)...";
    const cancelText = t('refactor.cancelButton') || 'Annuler';
    const cancelTooltip = t('refactor.cancelRefactorTooltip') || 'Cancel note refactoring process';

    if (modalBanner) {
      if (isModalVisible) {
        modalBanner.style.display = 'flex';
        if (modalText && statusMsg) modalText.textContent = statusMsg;
        if (modalBar) modalBar.style.width = `${clampedPct}%`;
      } else {
        modalBanner.style.display = 'none';
      }
    }

    if (editorProgressWrap) {
      if (isModalVisible) {
        editorProgressWrap.style.display = 'none';
        if (editorThinkingEl) {
          editorThinkingEl.style.display = 'none';
          editorThinkingEl.innerHTML = '';
        }
      } else {
        editorProgressWrap.style.display = 'flex';
        if (editorTitleEl) editorTitleEl.textContent = titleText;
        if (editorProgressBar) editorProgressBar.style.width = `${clampedPct}%`;
        if (editorPctEl) editorPctEl.textContent = `${clampedPct}%`;
        if (editorStatusEl && statusMsg) editorStatusEl.textContent = statusMsg;
        if (editorCancelBtn) {
          editorCancelBtn.textContent = `✕ ${cancelText}`;
          editorCancelBtn.title = cancelTooltip;
        }
        if (editorThinkingEl) {
          if (thinkingText && String(thinkingText).trim()) {
            editorThinkingEl.style.display = 'block';
            if (typeof LLMService !== 'undefined' && typeof LLMService.renderThinkingAccordionHTML === 'function') {
              editorThinkingEl.innerHTML = LLMService.renderThinkingAccordionHTML(thinkingText, {
                isOpen: false,
                title: t('chat.thinkingProcess') || 'Thought process'
              });
            } else {
              editorThinkingEl.textContent = thinkingText;
            }
          } else {
            editorThinkingEl.style.display = 'none';
            editorThinkingEl.innerHTML = '';
          }
        }
      }
    }

    if (drProgressWrap) {
      if (isModalVisible) {
        drProgressWrap.style.display = 'none';
      } else {
        drProgressWrap.style.display = 'block';
        if (drTitleEl) drTitleEl.textContent = titleText;
        if (drStatusEl && statusMsg) drStatusEl.textContent = statusMsg;
        if (drProgressBar) drProgressBar.style.width = `${clampedPct}%`;
        if (drCancelBtn) {
          drCancelBtn.textContent = `✕ ${cancelText}`;
          drCancelBtn.title = cancelTooltip;
        }
      }
    }
  },

  cancelRefactor() {
    if (this.currentAbortController) {
      try {
        this.currentAbortController.abort();
      } catch (_e) {}
    }
    if (typeof currentNote !== 'undefined' && currentNote) {
      const activeAiState = typeof getAiState === 'function' ? getAiState(currentNote) : null;
      if (activeAiState && activeAiState.controller) {
        try { activeAiState.controller.abort(); } catch (_e) {}
      }
    }
    this.closeClarificationsModal();
    this.closeProposalsModal();
    this.setRefactorLockState(false);
    this.updateRefactorProgress(false);
    if (typeof setAiActionState === 'function') {
      setAiActionState('idle');
    }
    toast(t('refactor.generationStopped') || 'Generation stopped.');
  },

  async startRefactor(note = currentNote) {
    if (!LLMService.isEnabled()) {
      toast(llmText('llm.disabledToast', 'Local LLM is disabled. Enable it in Preferences first.'), true);
      return;
    }
    if (!note) {
      toast(llmText('llm.noActiveNote', 'No active note to analyze.'), true);
      return;
    }

    const editor = document.getElementById('edit-textarea');
    this.originalHtmlSnapshot = editor ? editor.innerHTML : '';
    this.originalHtml = this.originalHtmlSnapshot;
    this.activeNote = note;
    this.activeNoteContent = getCleanEditorText();
    if (!this.activeNoteContent || this.activeNoteContent.trim().length < 3) {
      toast(t('refactor.noteTooShort') || 'Note is too short to refactor.', true);
      return;
    }

    const currentUserName = (typeof settings !== 'undefined' && settings && settings.username) ? settings.username : (typeof getDefaultMeLabel === 'function' ? getDefaultMeLabel() : 'Me');

    this.activeTab = null;
    this.proposalA = '';
    this.proposalB = '';
    this.proposalC = '';
    this.proposalActionsA = null;
    this.proposalActionsB = null;
    this.proposalActionsC = null;
    this.meetingSummary = '';
    this.meetingSummaryA = '';
    this.meetingSummaryB = '';
    this.meetingSummaryC = '';
    this.scratchpad = '';
    this.scratchpadLog = [];
    this.topicMemories = [];
    this.proposedTopicSplits = [];
    this.clarificationQuestions = [];
    this.clarificationAnswers = {};

    const feedbackInput = document.getElementById('refactor-feedback-input');
    if (feedbackInput) feedbackInput.value = '';
    this.toggleFeedbackDrawer(false);

    const pEl = document.getElementById('refactor-proposal-html');
    if (pEl) pEl.innerHTML = '';

    const tabCBtn = document.getElementById('tab-proposal-c');
    if (tabCBtn) tabCBtn.style.display = 'none';

    const refactorBtn = document.getElementById('btn-ai-refactor');
    const oldBtnHtml = refactorBtn ? refactorBtn.innerHTML : '';
    if (refactorBtn) {
      refactorBtn.disabled = true;
      refactorBtn.innerHTML = `<span class="spinner" style="display:inline-block; width:12px; height:12px; border:2px solid currentColor; border-right-color:transparent; border-radius:50%; animation:spin 0.8s linear infinite; margin-right:4px;"></span> ${t('refactor.refactoringInProgress') || 'Refactoring...'}`;
    }

    if (this.currentAbortController) {
      this.currentAbortController.abort();
    }
    this.currentAbortController = new AbortController();

    this.setRefactorLockState(true);
    if (typeof setAiActionState === 'function') {
      setAiActionState('refactoring');
    }
    this.updateRefactorProgress(15, t('refactor.stepIngest') || 'Analyse de la note et contexte...');

    try {
      toast(`✨ ${t('refactor.refactoringInProgress') || 'Analyzing note...'}`);
      const result = await LLMService.runRefactorAgentLoop(note, this.activeNoteContent, {
        noteHtml: this.originalHtmlSnapshot || note?.content || '',
        controller: this.currentAbortController,
        onProgress: (pct, msg) => this.updateRefactorProgress(pct, msg)
      });

      if (result.status === 'clarifications_needed') {
        this.scratchpad = result.scratchpad;
        this.scratchpadLog = result.scratchpadLog;
        this.topicMemories = result.topicMemories;
        this.showClarificationsModal(result.questions);
      } else if (result.status === 'proposals_ready') {
        const rawA = cleanProposalHtml(result.proposalA);
        const rawB = cleanProposalHtml(result.proposalB);
        const hasImagesA = (this.originalHtmlSnapshot && (this.originalHtmlSnapshot.includes('<img') || this.originalHtmlSnapshot.includes('NIMGTK') || this.originalHtmlSnapshot.includes('!['))) || /\[\s*IMAGE[_\s]\d+/i.test(rawA);
        const hasImagesB = (this.originalHtmlSnapshot && (this.originalHtmlSnapshot.includes('<img') || this.originalHtmlSnapshot.includes('NIMGTK') || this.originalHtmlSnapshot.includes('!['))) || /\[\s*IMAGE[_\s]\d+/i.test(rawB);
        this.proposalA = hasImagesA
          ? restoreOriginalImagesToProposal(this.originalHtmlSnapshot, rawA)
          : rawA;
        this.proposalB = hasImagesB
          ? restoreOriginalImagesToProposal(this.originalHtmlSnapshot, rawB)
          : rawB;
        this.meetingSummary = cleanMeetingSummaryHtml(result.meetingSummary || '', currentUserName);
        this.meetingSummaryA = cleanMeetingSummaryHtml(result.meetingSummaryA || this.meetingSummary, currentUserName);
        this.meetingSummaryB = cleanMeetingSummaryHtml(result.meetingSummaryB || this.meetingSummary, currentUserName);
        this.meetingSummaryC = '';
        this.proposalActionsA = extractProposedActionsFromProposal(this.proposalA, { proposed_decisions: result.proposedDecisionsA, proposed_todos: result.proposedTodosA, proposed_colleague_links: result.proposedColleaguesA, proposed_note_links: result.proposedNotesA });
        this.proposalActionsB = extractProposedActionsFromProposal(this.proposalB, { proposed_decisions: result.proposedDecisionsB, proposed_todos: result.proposedTodosB, proposed_colleague_links: result.proposedColleaguesB, proposed_note_links: result.proposedNotesB });
        this.scratchpad = result.scratchpad;
        this.scratchpadLog = result.scratchpadLog;
        this.topicMemories = result.topicMemories;
        this.proposedWorkstreams = result.proposedWorkstreams || [];
        this.proposedGroup = result.proposedGroup || null;
        this.proposedTopic = result.proposedTopic || null;
        this.tagChangeReason = result.tagChangeReason || '';
        this.acceptedTagChanges = false;
        this._presentProposals(note);
      }
    } catch (err) {
      if (err && err.name === 'AbortError') {
        toast(t('refactor.generationStopped') || 'Generation stopped.');
        if (typeof setAiActionState === 'function') setAiActionState('idle');
        return;
      }
      console.error('Refactor failed', err);
      toast(`Refactor failed: ${err.message}`, true);
      if (typeof setAiActionState === 'function') setAiActionState('idle');
    } finally {
      const isModalActive = (document.getElementById('modal-refactor-proposals')?.style.display !== 'none' && document.getElementById('modal-refactor-proposals')?.classList.contains('active')) ||
        (document.getElementById('modal-refactor-clarifications')?.style.display !== 'none' && document.getElementById('modal-refactor-clarifications')?.classList.contains('active'));
      if (!isModalActive) {
        this.setRefactorLockState(false);
      }
      this.updateRefactorProgress(false);
      if (refactorBtn) {
        refactorBtn.disabled = false;
        refactorBtn.innerHTML = oldBtnHtml || `✨ ${t('editor.aiRefactorNote') || 'Perfect Note'}`;
      }
    }
  },

  _presentProposals(note = this.activeNote) {
    const targetNote = note || this.activeNote || (typeof currentNote !== 'undefined' ? currentNote : null);
    const isInsideDailyReview = typeof DailyReviewController !== 'undefined' &&
                                DailyReviewController.active &&
                                DailyReviewController.currentStep === 3 &&
                                targetNote?.path;
    if (isInsideDailyReview) {
      if (!DailyReviewController.noteProposals) DailyReviewController.noteProposals = {};
      DailyReviewController.noteProposals[targetNote.path] = {
        status: 'ready',
        note: targetNote,
        originalHtml: this.originalHtmlSnapshot || targetNote.content || '',
        originalHtmlSnapshot: this.originalHtmlSnapshot || targetNote.content || '',
        proposalA: this.proposalA,
        proposalB: this.proposalB,
        proposalC: this.proposalC || '',
        proposalActionsA: this.proposalActionsA,
        proposalActionsB: this.proposalActionsB,
        proposalActionsC: this.proposalActionsC || null,
        meetingSummary: this.meetingSummary,
        meetingSummaryA: this.meetingSummaryA,
        meetingSummaryB: this.meetingSummaryB,
        meetingSummaryC: this.meetingSummaryC || '',
        scratchpad: this.scratchpad,
        scratchpadLog: this.scratchpadLog,
        topicMemories: this.topicMemories,
        proposedWorkstreams: this.proposedWorkstreams,
        proposedGroup: this.proposedGroup,
        proposedTopic: this.proposedTopic,
        tagChangeReason: this.tagChangeReason,
        acceptedTagChanges: this.acceptedTagChanges || false,
        questions: this.clarificationQuestions || [],
        activeTab: 'A'
      };
      if (typeof DailyReviewController.renderStep3ListBadges === 'function') {
        DailyReviewController.renderStep3ListBadges();
      }
      if (typeof DailyReviewController.renderIntegratedProposalView === 'function') {
        DailyReviewController.renderIntegratedProposalView(targetNote.path);
      }
    } else {
      this.showProposalsModal();
    }
  },

  showClarificationsModal(questions) {
    this.clarificationQuestions = Array.isArray(questions) ? questions : [];
    const listContainer = document.getElementById('refactor-questions-list');
    if (!listContainer) return;

    listContainer.innerHTML = '';
    this.clarificationQuestions.forEach((q, idx) => {
      if (!q) return;
      const card = document.createElement('div');
      card.className = 'refactor-question-card';
      const qId = q.id || `q_${idx}`;

      card.innerHTML = `
        <div class="refactor-question-title">
          <span style="color:var(--accent); font-weight:700;">#${idx + 1}</span>
          <span>${escH(q.question || '')}</span>
        </div>
        ${q.context ? `<div class="refactor-question-context">"${escH(q.context)}"</div>` : ''}
        <input type="text" class="refactor-question-input" data-question-id="${escA(qId)}" placeholder="${escA(t('refactor.answerPlaceholder') || 'Type clarification details or answer...')}" title="${escA(t('refactor.answerTooltip') || 'Enter additional context or clarification for this point')}" />
      `;
      const inputEl = card.querySelector('input');
      if (inputEl) {
        inputEl.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
            ev.preventDefault();
            RefactorModalController.submitClarifications();
          }
        });
      }
      listContainer.appendChild(card);
    });

    const titleEl = document.getElementById('refactor-clarifications-title-text');
    if (titleEl) titleEl.textContent = t('refactor.clarificationTitle') || 'Points of Clarification';
    const descEl = document.getElementById('refactor-clarifications-desc');
    if (descEl) descEl.textContent = t('refactor.clarificationSubtitle') || 'The assistant detected some points that need clarification to build the perfect note:';
    const skipBtn = document.getElementById('btn-refactor-skip');
    if (skipBtn) {
      skipBtn.textContent = t('refactor.skipClarifications') || '⏭ Skip & Refactor directly';
      skipBtn.title = t('refactor.skipClarificationsTooltip') || 'Proceed directly to structured proposals without providing additional details';
    }
    const submitBtn = document.getElementById('btn-refactor-submit');
    if (submitBtn) {
      submitBtn.textContent = t('refactor.submitAnswers') || '✓ Submit Answers & Refactor';
      submitBtn.title = t('refactor.submitAnswersTooltip') || 'Submit your answers to refine and generate structured proposals';
    }

    const modal = document.getElementById('modal-refactor-clarifications');
    if (modal) {
      modal.style.display = 'flex';
      modal.classList.add('active');
      this._bindModalKeys(modal, () => this.closeClarificationsModal(), () => this.submitClarifications());
      const firstInp = modal.querySelector('input');
      if (firstInp) setTimeout(() => firstInp.focus(), 80);
    }
  },

  closeClarificationsModal() {
    const modal = document.getElementById('modal-refactor-clarifications');
    if (modal) {
      modal.style.display = 'none';
      modal.classList.remove('active');
    }
    this._unbindModalKeys();
    const isProposalsActive = document.getElementById('modal-refactor-proposals')?.classList.contains('active');
    if (!isProposalsActive) {
      this.setRefactorLockState(false);
    }
  },

  async submitClarifications() {
    const answers = {};
    const inputs = document.querySelectorAll('#refactor-questions-list .refactor-question-input');
    inputs.forEach(inp => {
      const qId = inp.dataset.questionId;
      const val = (inp.value || '').trim();
      if (qId && val) answers[qId] = val;
    });

    this.closeClarificationsModal();
    toast(`✨ ${t('refactor.refactoringInProgress') || 'Refactoring with your answers...'}`);

    this.setRefactorLockState(true);
    if (typeof setAiActionState === 'function') {
      setAiActionState('refactoring');
    }
    this.updateRefactorProgress(35, t('refactor.stepScratchpad') || 'Intégration des réponses...');

    const currentUserName = (typeof settings !== 'undefined' && settings && settings.username) ? settings.username : (typeof getDefaultMeLabel === 'function' ? getDefaultMeLabel() : 'Me');
    this.currentAbortController = new AbortController();
    try {
      const result = await LLMService.runRefactorAgentLoop(this.activeNote, this.activeNoteContent, {
        noteHtml: this.originalHtmlSnapshot || this.activeNote?.content || '',
        controller: this.currentAbortController,
        initialScratchpad: this.scratchpad,
        initialLog: this.scratchpadLog,
        clarificationAnswers: answers,
        skipClarifications: true,
        onProgress: (pct, msg) => this.updateRefactorProgress(pct, msg)
      });

      this.proposalA = cleanProposalHtml(result.proposalA);
      this.proposalB = cleanProposalHtml(result.proposalB);
      this.meetingSummary = cleanMeetingSummaryHtml(result.meetingSummary || '', currentUserName);
      this.meetingSummaryA = cleanMeetingSummaryHtml(result.meetingSummaryA || this.meetingSummary, currentUserName);
      this.meetingSummaryB = cleanMeetingSummaryHtml(result.meetingSummaryB || this.meetingSummary, currentUserName);
      this.meetingSummaryC = '';
      this.proposalActionsA = extractProposedActionsFromProposal(this.proposalA, { proposed_decisions: result.proposedDecisionsA, proposed_todos: result.proposedTodosA, proposed_colleague_links: result.proposedColleaguesA, proposed_note_links: result.proposedNotesA });
      this.proposalActionsB = extractProposedActionsFromProposal(this.proposalB, { proposed_decisions: result.proposedDecisionsB, proposed_todos: result.proposedTodosB, proposed_colleague_links: result.proposedColleaguesB, proposed_note_links: result.proposedNotesB });
      this.scratchpad = result.scratchpad;
      this.scratchpadLog = result.scratchpadLog;
      this.topicMemories = result.topicMemories;
      this.proposedWorkstreams = result.proposedWorkstreams || [];
      this.proposedGroup = result.proposedGroup || null;
      this.proposedTopic = result.proposedTopic || null;
      this.tagChangeReason = result.tagChangeReason || '';
      this.acceptedTagChanges = false;
      this._presentProposals(this.activeNote);
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      console.error('Error submitting clarifications', err);
      toast(`Refactor failed: ${err.message}`, true);
    } finally {
      this.setRefactorLockState(false);
      this.updateRefactorProgress(false);
      if (typeof setAiActionState === 'function') {
        setAiActionState('idle');
      }
    }
  },

  async skipClarifications() {
    this.closeClarificationsModal();
    toast(`✨ ${t('refactor.refactoringInProgress') || 'Refactoring directly...'}`);

    this.setRefactorLockState(true);
    if (typeof setAiActionState === 'function') {
      setAiActionState('refactoring');
    }
    this.updateRefactorProgress(35, t('refactor.stepScratchpad') || 'Finalisation directe...');

    const currentUserName = (typeof settings !== 'undefined' && settings && settings.username) ? settings.username : (typeof getDefaultMeLabel === 'function' ? getDefaultMeLabel() : 'Me');
    this.currentAbortController = new AbortController();
    try {
      const result = await LLMService.runRefactorAgentLoop(this.activeNote, this.activeNoteContent, {
        noteHtml: this.originalHtmlSnapshot || this.activeNote?.content || '',
        controller: this.currentAbortController,
        initialScratchpad: this.scratchpad,
        initialLog: this.scratchpadLog,
        skipClarifications: true,
        onProgress: (pct, msg) => this.updateRefactorProgress(pct, msg)
      });

      this.proposalA = cleanProposalHtml(result.proposalA);
      this.proposalB = cleanProposalHtml(result.proposalB);
      this.meetingSummary = cleanMeetingSummaryHtml(result.meetingSummary || '', currentUserName);
      this.meetingSummaryA = cleanMeetingSummaryHtml(result.meetingSummaryA || this.meetingSummary, currentUserName);
      this.meetingSummaryB = cleanMeetingSummaryHtml(result.meetingSummaryB || this.meetingSummary, currentUserName);
      this.meetingSummaryC = '';
      this.proposalActionsA = extractProposedActionsFromProposal(this.proposalA, { proposed_decisions: result.proposedDecisionsA, proposed_todos: result.proposedTodosA, proposed_colleague_links: result.proposedColleaguesA, proposed_note_links: result.proposedNotesA });
      this.proposalActionsB = extractProposedActionsFromProposal(this.proposalB, { proposed_decisions: result.proposedDecisionsB, proposed_todos: result.proposedTodosB, proposed_colleague_links: result.proposedColleaguesB, proposed_note_links: result.proposedNotesB });
      this.scratchpad = result.scratchpad;
      this.scratchpadLog = result.scratchpadLog;
      this.topicMemories = result.topicMemories;
      this.proposedWorkstreams = result.proposedWorkstreams || [];
      this.proposedGroup = result.proposedGroup || null;
      this.proposedTopic = result.proposedTopic || null;
      this.tagChangeReason = result.tagChangeReason || '';
      this.acceptedTagChanges = false;
      this._presentProposals(this.activeNote);
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      console.error('Error skipping clarifications', err);
      toast(`Refactor failed: ${err.message}`, true);
    } finally {
      this.setRefactorLockState(false);
      this.updateRefactorProgress(false);
      if (typeof setAiActionState === 'function') {
        setAiActionState('idle');
      }
    }
  },

  showProposalsModal() {
    const modal = document.getElementById('modal-refactor-proposals');
    if (!modal) return;

    // Set topic memory badge
    const badge = document.getElementById('refactor-topic-memory-badge');
    if (badge) {
      if (this.topicMemories && this.topicMemories.length > 0) {
        const brainIcon = typeof AppIcons !== 'undefined' ? AppIcons.get('brain', { size: 13 }) : '';
        badge.style.display = 'inline-flex';
        badge.style.alignItems = 'center';
        badge.style.gap = '4px';
        badge.innerHTML = `${brainIcon} ${escH(this.topicMemories.map(m => m.topicName || m.majorTopic).join(', '))}`;
        badge.title = t('refactor.topicMemoryTooltip') || 'Loaded persistent topic memory from prior notes in this topic';
      } else {
        badge.style.display = 'none';
      }
    }

    // Render Proposed Workstream & Tags Recommendations Banner
    const tagsContainer = document.getElementById('refactor-tags-container');
    if (tagsContainer) {
      this.renderTagsBanner(tagsContainer, {
        note: this.activeNote,
        proposal: this,
        accepted: this.acceptedTagChanges,
        onToggle: 'RefactorModalController.toggleAcceptTags(this)'
      });
    }

    // Render New Topic Split Callout Banner if detected
    const bannerWrap = document.getElementById('refactor-topic-split-container');
    if (bannerWrap) {
      bannerWrap.innerHTML = '';
      if (this.proposedTopicSplits && this.proposedTopicSplits.length > 0) {
        bannerWrap.style.display = 'block';
        const lightbulbIcon = typeof AppIcons !== 'undefined' ? AppIcons.get('lightbulb', { size: 14 }) : '';
        this.proposedTopicSplits.forEach(split => {
          if (!split || !split.topicName) return;
          const card = document.createElement('div');
          card.style.cssText = 'background:rgba(99,102,241,0.08); border:1px solid rgba(99,102,241,0.3); border-radius:8px; padding:8px 12px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; gap:8px; font-size:0.83rem;';
          card.innerHTML = `
            <div style="display:flex; align-items:center; gap:6px;">
              <span style="font-weight:700; color:var(--accent); display:inline-flex; align-items:center; gap:4px;">${lightbulbIcon} ${t('refactor.newTopicDetected') || 'New Major Workstream Detected'}:</span>
              <span>"${escH(split.topicName)}" — ${escH(split.reason || split.initialSummary || '')}</span>
            </div>
            <button type="button" class="btn btn-secondary" style="font-size:0.75rem; padding:3px 10px; white-space:nowrap;" onclick="RefactorModalController.confirmCreateTopicSplit('${escA(split.topicName)}', '${escA(split.initialSummary || '')}')" title="${escA(t('refactor.confirmTopicSplitTooltip') || 'Split this out into a separate Workstream Memory file upon applying')}">
              ✓ ${t('refactor.createTopicMemory') || 'Create Workstream Memory'}
            </button>
          `;
          bannerWrap.appendChild(card);
        });
      } else {
        bannerWrap.style.display = 'none';
      }
    }

    // Set labels & localized tooltips
    const titleEl = document.getElementById('refactor-proposals-title-text');
    if (titleEl) titleEl.textContent = t('refactor.proposalsTitle') || 'Perfect Note Proposals';
    const tabABtn = document.getElementById('tab-proposal-a');
    if (tabABtn) {
      const targetIcon = typeof AppIcons !== 'undefined' ? AppIcons.get('target', { size: 13 }) : '';
      tabABtn.innerHTML = `${targetIcon} <span>${escH(t('refactor.proposalA') || 'Proposal A (Executive)')}</span>`;
      tabABtn.title = t('refactor.proposalATooltip') || 'View Executive / Action-Oriented proposal with clear headings and bulleted decisions';
    }
    const tabBBtn = document.getElementById('tab-proposal-b');
    if (tabBBtn) {
      const fileTextIcon = typeof AppIcons !== 'undefined' ? AppIcons.get('fileText', { size: 13 }) : '';
      tabBBtn.innerHTML = `${fileTextIcon} <span>${escH(t('refactor.proposalB') || 'Proposal B (Comprehensive)')}</span>`;
      tabBBtn.title = t('refactor.proposalBTooltip') || 'View Comprehensive / Contextual proposal preserving all nuances and discussion detail';
    }
    const tabCBtn = document.getElementById('tab-proposal-c');
    if (tabCBtn) {
      const sparklesIcon = typeof AppIcons !== 'undefined' ? AppIcons.get('sparkles', { size: 13 }) : '';
      tabCBtn.innerHTML = `${sparklesIcon} <span>${escH(t('refactor.proposalC') || 'Option C (Custom)')}</span>`;
      tabCBtn.title = t('refactor.proposalCTooltip') || 'View Custom synthesized version incorporating your specific feedback';
      tabCBtn.style.display = this.proposalC ? 'inline-flex' : 'none';
    }
    const tabOrigBtn = document.getElementById('tab-original');
    if (tabOrigBtn) {
      const notesIcon = typeof AppIcons !== 'undefined' ? AppIcons.get('notes', { size: 13 }) : '';
      tabOrigBtn.innerHTML = `${notesIcon} <span>${escH(t('refactor.tabOriginal') || 'Original Note')}</span>`;
      tabOrigBtn.title = t('refactor.tabOriginalTooltip') || 'View and edit original note before AI refactoring';
    }
    const tabScratchpadBtn = document.getElementById('tab-scratchpad');
    if (tabScratchpadBtn) {
      const brainIcon = typeof AppIcons !== 'undefined' ? AppIcons.get('brain', { size: 13 }) : '';
      tabScratchpadBtn.innerHTML = `${brainIcon} <span>${escH(t('refactor.scratchpadTab') || 'Agent Scratchpad')}</span>`;
      tabScratchpadBtn.title = t('refactor.scratchpadTooltip') || 'View internal agent research log, retrieved topic context, and structuring rationale';
    }

    const declineBtn = document.getElementById('btn-refactor-decline');
    if (declineBtn) {
      declineBtn.textContent = t('refactor.declineBoth') || 'Request Option C';
      declineBtn.title = t('refactor.declineBothTooltip') || 'Decline these proposals and provide custom instructions for Option C';
    }
    const copyBtn = document.getElementById('btn-refactor-copy');
    if (copyBtn) {
      copyBtn.textContent = t('refactor.copyProposal') || 'Copy';
      copyBtn.title = t('refactor.copyProposalTooltip') || 'Copy selected proposal to clipboard';
    }
    const reperfectBtn = document.getElementById('btn-refactor-reperfect');
    if (reperfectBtn) {
      reperfectBtn.textContent = t('refactor.reperfectProposal') || 'Re-perfect with Edits';
      reperfectBtn.title = t('refactor.reperfectProposalTooltip') || 'Re-perfect this proposal incorporating your manual edits';
    }
    const feedbackLabel = document.getElementById('refactor-feedback-label');
    if (feedbackLabel) feedbackLabel.textContent = t('refactor.feedbackTitle') || 'Option C Instructions:';
    const feedbackInput = document.getElementById('refactor-feedback-input');
    if (feedbackInput) {
      feedbackInput.placeholder = t('refactor.feedbackPlaceholder') || 'e.g., Make it more concise, emphasize deadlines...';
      if (!feedbackInput._boundEnter) {
        feedbackInput._boundEnter = true;
        feedbackInput.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') {
            ev.preventDefault();
            this.generateOptionC();
          }
        });
      }
    }
    const presetSelect = document.getElementById('refactor-feedback-preset');
    if (presetSelect) {
      presetSelect.title = t('refactor.presetTooltip') || 'Choose a quick refinement preset or customize below';
      const promptOpt = presetSelect.querySelector('option[value=""]');
      if (promptOpt) promptOpt.textContent = t('refactor.presetPrompt') || '⚡ Quick refinement preset...';
      const optConcise = presetSelect.querySelector('option[value="More concise & shorter bullets"]');
      if (optConcise) optConcise.textContent = t('refactor.presetConcise') || '⚡ More concise & shorter bullets';
      const optDeadlines = presetSelect.querySelector('option[value="Emphasize deadlines, owners & dates"]');
      if (optDeadlines) optDeadlines.textContent = t('refactor.presetDeadlines') || '🎯 Emphasize deadlines & owners';
      const optChronological = presetSelect.querySelector('option[value="Organize chronologically by agenda"]');
      if (optChronological) optChronological.textContent = t('refactor.presetChronological') || '📅 Chronological meeting flow';
      const optDecisions = presetSelect.querySelector('option[value="Highlight strategic decisions and blockers"]');
      if (optDecisions) optDecisions.textContent = t('refactor.presetDecisions') || '⚖️ Focus on strategic decisions';
      const optBullets = presetSelect.querySelector('option[value="Bullet points only (no paragraphs)"]');
      if (optBullets) optBullets.textContent = t('refactor.presetBulletsOnly') || '📋 Bullet points only';
      const optExec = presetSelect.querySelector('option[value="Executive tone with bold takeaways"]');
      if (optExec) optExec.textContent = t('refactor.presetExecutive') || '👔 Executive summary tone';
    }
    const genCBtn = document.getElementById('btn-generate-option-c');
    if (genCBtn) {
      genCBtn.textContent = `✨ ${t('refactor.generateOptionC') || 'Generate Option C'}`;
      genCBtn.title = t('refactor.generateOptionCTooltip') || 'Generate custom Option C according to your instructions';
    }

    const previewPane = document.getElementById('refactor-proposal-preview-pane');
    if (previewPane && !previewPane._boundRefactorInput) {
      previewPane._boundRefactorInput = true;
      previewPane.addEventListener('input', () => {
        if (this.hasUserEditedTab && this.activeTab) {
          this.hasUserEditedTab[this.activeTab] = true;
        }
        const htmlContainer = document.getElementById('refactor-proposal-html');
        const html = htmlContainer ? htmlContainer.innerHTML : previewPane.innerHTML;
        if (this.activeTab === 'A') this.proposalA = html;
        else if (this.activeTab === 'B') this.proposalB = html;
        else if (this.activeTab === 'C') this.proposalC = html;
        else if (this.activeTab === 'original') this.originalHtml = html;
        this.updateReperfectButtonState();
        if (this.activeTab === 'original') {
          this.updateApplyButtonState();
        }
      });
      if (typeof attachRichTextShortcutsAndToolbar === 'function') {
        attachRichTextShortcutsAndToolbar(previewPane);
      }
    }

    this.hasUserEditedTab = {
      A: false,
      B: false,
      C: false,
      original: false
    };

    this.tabBaselineHtml = {
      A: this.proposalA || '',
      B: this.proposalB || '',
      C: this.proposalC || '',
      original: this.originalHtmlSnapshot || ''
    };

    this.activeTab = null;
    this.toggleFeedbackDrawer(false);
    this.switchTab('A');
    modal.style.display = 'flex';
    modal.classList.add('active');
    this._bindModalKeys(modal, () => this.closeProposalsModal(), () => this.applyCurrentProposal());
  },

  async confirmCreateTopicSplit(topicName, initialSummary) {
    if (!topicName || typeof saveMajorTopicMemory !== 'function') return;
    await saveMajorTopicMemory(topicName, {
      summary: initialSummary || `${t('refactor.workstreamCreatedFromNote') || 'Workstream created from note'} "${this.activeNote?.title || 'Note'}"`,
      status: 'active',
      lastNoteId: this.activeNote?.id || '',
      lastNoteTitle: this.activeNote?.title || ''
    });
    toast(`✨ ${t('refactor.topicMemoryCreated') || 'Workstream Memory created'}: "${topicName}"`);
    this.proposedTopicSplits = (this.proposedTopicSplits || []).filter(s => s.topicName !== topicName);
    this.showProposalsModal();
  },

  async reperfectWithEdits() {
    const htmlContainer = document.getElementById('refactor-proposal-html') || document.getElementById('refactor-proposal-preview-pane');
    const editedHtml = htmlContainer ? htmlContainer.innerHTML : '';
    if (!editedHtml || !editedHtml.trim()) {
      toast(t('refactor.noProposalSelected') || 'No content to refine.', true);
      return;
    }

    const input = document.getElementById('refactor-feedback-input');
    const feedback = (input?.value || '').trim();

    const reperfectBtn = document.getElementById('btn-refactor-reperfect');
    const declineBtn = document.getElementById('btn-refactor-decline');
    const applyBtn = document.getElementById('btn-refactor-apply');
    const copyBtn = document.getElementById('btn-refactor-copy');

    if (reperfectBtn) {
      reperfectBtn.disabled = true;
      reperfectBtn.innerHTML = `<span class="spinner" style="display:inline-block; width:12px; height:12px; border:2px solid currentColor; border-right-color:transparent; border-radius:50%; animation:spin 0.8s linear infinite; margin-right:4px;"></span> ${t('refactor.refiningAmended') || 'Re-perfecting...'}`;
    }
    if (declineBtn) declineBtn.disabled = true;
    if (applyBtn) applyBtn.disabled = true;
    if (copyBtn) copyBtn.disabled = true;

    toast(`✨ ${t('refactor.refiningAmended') || 'Re-perfecting proposal with your edits...'}`);
    this.setRefactorLockState(true);
    this.updateRefactorProgress(45, t('refactor.refiningAmended') || 'Re-perfecting proposal with your edits...');

    const currentUserName = (typeof settings !== 'undefined' && settings && settings.username) ? settings.username : (typeof getDefaultMeLabel === 'function' ? getDefaultMeLabel() : 'Me');
    if (this.currentAbortController) this.currentAbortController.abort();
    this.currentAbortController = new AbortController();

    try {
      const result = await LLMService.refineAmendedProposal(
        this.activeNote,
        this.activeNoteContent,
        editedHtml,
        feedback,
        { controller: this.currentAbortController }
      );

      this.proposalC = cleanProposalHtml(result.proposalC);
      this.meetingSummaryC = cleanMeetingSummaryHtml(result.meetingSummary || this.meetingSummary, currentUserName);
      this.proposalActionsC = extractProposedActionsFromProposal(this.proposalC, { proposed_decisions: result.proposedDecisions, proposed_todos: result.proposedTodos, proposed_colleague_links: result.proposedColleagues, proposed_note_links: result.proposedNotes });
      this.scratchpadLog.push({ step: this.scratchpadLog.length + 1, title: t('refactor.stepReperfect') || 'Proposal Re-perfected', content: 'Incorporated direct user manual edits and feedback.' });

      if (this.tabBaselineHtml) {
        this.tabBaselineHtml.C = this.proposalC;
      }
      if (this.hasUserEditedTab) {
        this.hasUserEditedTab.C = false;
      }

      const tabC = document.getElementById('tab-proposal-c');
      if (tabC) tabC.style.display = 'inline-flex';

      this.toggleFeedbackDrawer(false);
      this.switchTab('C');
      toast(t('refactor.reperfectReady') || '🎉 Proposal re-perfected with edits!');
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      console.error('Failed to re-perfect proposal', err);
      toast(`${t('common.error') || 'Error'}: ${err.message}`, true);
    } finally {
      this.setRefactorLockState(false);
      this.updateRefactorProgress(false);
      if (reperfectBtn) {
        reperfectBtn.disabled = false;
        reperfectBtn.textContent = t('refactor.reperfectProposal') || 'Re-perfect with Edits';
      }
      if (declineBtn) declineBtn.disabled = false;
      if (applyBtn) applyBtn.disabled = false;
      if (copyBtn) copyBtn.disabled = false;
      this.updateReperfectButtonState();
    }
  },

  closeProposalsModal() {
    if (this.currentAbortController) {
      try { this.currentAbortController.abort(); } catch (_e) {}
    }
    this._unbindModalKeys();
    const modal = document.getElementById('modal-refactor-proposals');
    if (modal) {
      modal.style.display = 'none';
      modal.classList.remove('active');
    }
    const feedbackInput = document.getElementById('refactor-feedback-input');
    if (feedbackInput) feedbackInput.value = '';
    this.toggleFeedbackDrawer(false);
    this.proposalC = '';
    this.proposalActionsC = null;
    this.meetingSummary = '';
    this.meetingSummaryA = '';
    this.meetingSummaryB = '';
    this.meetingSummaryC = '';
    this.hasUserEditedTab = { A: false, B: false, C: false, original: false };
    const tabCBtn = document.getElementById('tab-proposal-c');
    if (tabCBtn) tabCBtn.style.display = 'none';

    const pEl = document.getElementById('refactor-proposal-html');
    if (pEl) pEl.innerHTML = '';
    this.activeTab = null;
    this.setRefactorLockState(false);
    if (typeof setAiActionState === 'function') {
      setAiActionState('idle');
    }
  },

  _bindModalKeys(modalEl, onEscape, onCtrlEnter) {
    this._unbindModalKeys();
    this._boundKeyHandler = (e) => {
      const isEditing = e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);

      if (e.key === 'Escape') {
        e.preventDefault();
        if (onEscape) onEscape();
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (onCtrlEnter) onCtrlEnter();
      } else if (modalEl && modalEl.id === 'modal-refactor-proposals' && !isEditing) {
        if (e.key === '1' || e.key === 'a' || e.key === 'A') {
          this.switchTab('A');
        } else if (e.key === '2' || e.key === 'b' || e.key === 'B') {
          this.switchTab('B');
        } else if ((e.key === '3' || e.key === 'c' || e.key === 'C') && this.proposalC) {
          this.switchTab('C');
        } else if (e.key === '0' || e.key === 'o' || e.key === 'O') {
          this.switchTab('original');
        } else if (e.key === 's' || e.key === 'S') {
          this.switchTab('scratchpad');
        }
      }
    };
    window.addEventListener('keydown', this._boundKeyHandler);

    if (modalEl) {
      modalEl.onclick = (e) => {
        if (e.target === modalEl) {
          if (onEscape) onEscape();
        }
      };
    }
  },

  _unbindModalKeys() {
    if (this._boundKeyHandler) {
      window.removeEventListener('keydown', this._boundKeyHandler);
      this._boundKeyHandler = null;
    }
  },

  isCurrentTabEdited() {
    if (!this.activeTab || this.activeTab === 'scratchpad') return false;
    if (!this.hasUserEditedTab || !this.hasUserEditedTab[this.activeTab]) return false;
    const currentContainer = document.getElementById('refactor-proposal-html') || document.getElementById('refactor-proposal-preview-pane');
    const currentHtml = currentContainer ? currentContainer.innerHTML : '';
    let baseline = '';
    if (this.tabBaselineHtml && typeof this.tabBaselineHtml === 'object') {
      baseline = this.tabBaselineHtml[this.activeTab] || '';
    }
    return (currentHtml || '').trim() !== (baseline || '').trim();
  },

  updateReperfectButtonState() {
    const reperfectBtn = document.getElementById('btn-refactor-reperfect');
    if (!reperfectBtn) return;
    if (this.activeTab === 'scratchpad' || !this.isCurrentTabEdited()) {
      reperfectBtn.style.display = 'none';
    } else {
      reperfectBtn.style.display = 'inline-flex';
      reperfectBtn.textContent = t('refactor.reperfectProposal') || 'Re-perfect with Edits';
      reperfectBtn.title = t('refactor.reperfectProposalTooltip') || 'Re-perfect this proposal incorporating your manual edits';
    }
  },

  updateDeclineButtonLabel() {
    const declineBtn = document.getElementById('btn-refactor-decline');
    if (!declineBtn) return;
    if (this.activeTab === 'C') {
      declineBtn.textContent = t('refactor.regenerateOptionC') || 'Refine Option C';
      declineBtn.title = t('refactor.regenerateOptionCTooltip') || 'Open guidance panel to regenerate Option C';
    } else {
      declineBtn.textContent = t('refactor.declineBoth') || 'Request Option C';
      declineBtn.title = t('refactor.declineBothTooltip') || 'Decline these proposals and provide custom instructions for Option C';
    }
  },

  updateApplyButtonState() {
    const applyBtn = document.getElementById('btn-refactor-apply');
    if (!applyBtn) return;

    if (this.activeTab === 'original') {
      if (this.isCurrentTabEdited()) {
        applyBtn.textContent = t('refactor.applyOriginal') || '✓ Apply Original';
        applyBtn.title = t('refactor.applyOriginalTooltip') || 'Apply modified original note to editor';
      } else {
        applyBtn.textContent = t('refactor.keepOriginal') || '✓ Keep Original';
        applyBtn.title = t('refactor.keepOriginalTooltip') || 'Keep original note unchanged and close dialog';
      }
    } else {
      applyBtn.textContent = t('refactor.applyProposal') || '✓ Apply Proposal';
      applyBtn.title = t('refactor.applyProposalTooltip') || 'Apply selected proposal to note editor (creates automatic backup snapshot)';
    }
  },

  switchTab(tabKey) {
    // Preserve any manual edits made to the current preview HTML before switching
    const currentHtmlContainer = document.getElementById('refactor-proposal-html') || document.getElementById('refactor-proposal-preview-pane');
    if (currentHtmlContainer && this.activeTab && this.activeTab !== 'scratchpad') {
      if (this.activeTab === 'A') this.proposalA = currentHtmlContainer.innerHTML;
      else if (this.activeTab === 'B') this.proposalB = currentHtmlContainer.innerHTML;
      else if (this.activeTab === 'C') this.proposalC = currentHtmlContainer.innerHTML;
      else if (this.activeTab === 'original') this.originalHtml = currentHtmlContainer.innerHTML;
    }

    this.activeTab = tabKey;

    const tabs = ['A', 'B', 'C', 'original', 'scratchpad'];
    tabs.forEach(k => {
      let btnId = '';
      if (k === 'scratchpad') btnId = 'tab-scratchpad';
      else if (k === 'original') btnId = 'tab-original';
      else btnId = `tab-proposal-${k.toLowerCase()}`;
      const btn = document.getElementById(btnId);
      if (btn) btn.classList.toggle('active', k === tabKey);
    });

    const previewPane = document.getElementById('refactor-proposal-preview-pane');
    const scratchpadPane = document.getElementById('refactor-scratchpad-pane');
    const toolbarEl = document.getElementById('refactor-modal-toolbar');
    const descEl = document.getElementById('refactor-tab-desc');
    const applyBtn = document.getElementById('btn-refactor-apply');

    if (tabKey === 'scratchpad') {
      if (previewPane) previewPane.style.display = 'none';
      if (scratchpadPane) scratchpadPane.style.display = 'block';
      if (toolbarEl) toolbarEl.style.display = 'none';
      if (descEl) descEl.textContent = t('refactor.scratchpadDesc') || 'Internal agent research log, retrieved topic context, and structuring rationale.';
      if (applyBtn) applyBtn.style.display = 'none';
      this.updateReperfectButtonState();
      this.renderScratchpadView();
    } else {
      if (previewPane) previewPane.style.display = 'block';
      if (scratchpadPane) scratchpadPane.style.display = 'none';
      if (toolbarEl) toolbarEl.style.display = 'flex';
      if (applyBtn) applyBtn.style.display = '';

      let html = '';
      let descText = '';
      if (tabKey === 'A') {
        html = this.proposalA;
        descText = t('refactor.proposalADesc') || 'Action-oriented structure with clear headings, bold takeaways, and bulleted decisions.';
      } else if (tabKey === 'B') {
        html = this.proposalB;
        descText = t('refactor.proposalBDesc') || 'Comprehensive discussion flow preserving all context, nuance, and thematic details.';
      } else if (tabKey === 'C') {
        html = this.proposalC;
        descText = t('refactor.proposalCDesc') || 'Custom synthesized version incorporating your specific feedback and instructions.';
      } else if (tabKey === 'original') {
        html = this.originalHtml !== undefined && this.originalHtml !== null ? this.originalHtml : this.originalHtmlSnapshot;
        descText = t('refactor.originalDesc') || 'Original raw note before AI refactoring. You can edit, copy, or restore.';
      }

      // Populate HTML into container
      const htmlContainer = document.getElementById('refactor-proposal-html');
      if (htmlContainer) {
        const syncResolved = (typeof resolveNoteImagesSync === 'function') ? resolveNoteImagesSync(html) : html;
        htmlContainer.innerHTML = syncResolved;

        // If user hasn't edited this tab, establish exact DOM baseline
        if (!this.hasUserEditedTab?.[tabKey] && this.tabBaselineHtml) {
          this.tabBaselineHtml[tabKey] = htmlContainer.innerHTML;
        }

        if (typeof resolveNoteImages === 'function' && html && html.includes('_assets/')) {
          resolveNoteImages(html).then(resolved => {
            if (htmlContainer && LLMService.activeTab === tabKey) {
              htmlContainer.innerHTML = resolved;
              if (!this.hasUserEditedTab?.[tabKey] && this.tabBaselineHtml) {
                this.tabBaselineHtml[tabKey] = resolved;
              }
              if (typeof setupUncertaintyHoverCards === 'function') {
                setupUncertaintyHoverCards(previewPane || htmlContainer);
              }
            }
          });
        }
      }

      this.updateApplyButtonState();
      this.updateReperfectButtonState();
      this.updateDeclineButtonLabel();

      // Compute word count comparison metrics
      const rawWords = (this.activeNoteContent || '').trim().split(/\s+/).filter(Boolean).length;
      const strippedProposal = (html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      const proposalWords = strippedProposal ? strippedProposal.split(' ').filter(Boolean).length : 0;
      const diffPercent = rawWords > 0 ? Math.round(((proposalWords - rawWords) / rawWords) * 100) : 0;
      const readMin = Math.max(1, Math.round(proposalWords / 200));

      const metricsHtml = `<span style="display:inline-flex; align-items:center; gap:6px; margin-left:8px; font-size:0.78rem; font-weight:600; opacity:0.85;"><span>📊 ${proposalWords} words (${diffPercent > 0 ? '+' : ''}${diffPercent}%)</span> • <span>⏱ ~${readMin} min read</span></span>`;

      if (descEl) descEl.innerHTML = `${escH(descText)} ${metricsHtml}`;

      if (typeof setupUncertaintyHoverCards === 'function') {
        setupUncertaintyHoverCards(previewPane || htmlContainer);
      }

      this.renderActionsReviewPanel(tabKey);
    }
  },

  renderActionsReviewPanel(tabKey) {
    const container = document.getElementById('refactor-actions-review-container');
    if (!container) return;

    if (tabKey === 'original') {
      container.style.display = 'none';
      container.innerHTML = '';
      return;
    }

    let actions = null;
    if (tabKey === 'A') actions = this.proposalActionsA;
    else if (tabKey === 'B') actions = this.proposalActionsB;
    else if (tabKey === 'C') actions = this.proposalActionsC;

    if (!actions) {
      const html = tabKey === 'A' ? this.proposalA : (tabKey === 'B' ? this.proposalB : this.proposalC);
      actions = extractProposedActionsFromProposal(html);
      if (tabKey === 'A') this.proposalActionsA = actions;
      else if (tabKey === 'B') this.proposalActionsB = actions;
      else if (tabKey === 'C') this.proposalActionsC = actions;
    }

    const { decisions = [], todos = [], colleagues = [], notes = [] } = actions || {};

    if (decisions.length === 0 && todos.length === 0 && colleagues.length === 0 && notes.length === 0) {
      container.style.display = 'none';
      container.innerHTML = '';
      return;
    }

    container.style.display = 'block';

    let markup = `
      <div class="refactor-actions-review-panel" contenteditable="false" style="background:var(--card-bg-alt); border:1px solid var(--card-border); border-radius:10px; padding:12px 14px;">
        <div style="font-weight:700; font-size:0.88rem; color:var(--accent); margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;" contenteditable="false">
          <span contenteditable="false">⚡ ${t('refactor.proposedActionsHeader') || 'Proposed Actions & Decisions Review'}</span>
          <span style="font-size:0.75rem; color:var(--text-muted); font-weight:normal;" contenteditable="false">${t('refactor.reviewBeforeApplying') || 'Review & edit before applying'}</span>
        </div>
    `;

    // Decisions List
    if (decisions.length > 0) {
      markup += `
        <div style="margin-bottom:12px;" contenteditable="false">
          <div style="font-weight:700; font-size:0.8rem; color:var(--text); margin-bottom:6px;" contenteditable="false">🎯 ${t('refactor.proposedDecisions') || 'Proposed Decisions'} (${decisions.length})</div>
          <div style="display:flex; flex-direction:column; gap:6px;" contenteditable="false">
      `;
      decisions.forEach((dec, idx) => {
        markup += `
          <div style="display:flex; align-items:center; gap:8px; background:var(--card-bg); border:1px solid var(--card-border); border-radius:6px; padding:6px 10px;" contenteditable="false">
            <input type="checkbox" class="refactor-check-dec" data-idx="${idx}" checked id="refactor-dec-chk-${tabKey}-${idx}" style="cursor:pointer;" />
            <span class="note-decision-badge" contenteditable="false" style="font-size:0.68rem;">🎯 Decision</span>
            <input type="text" class="refactor-dec-input field-input" data-idx="${idx}" value="${escA(dec.text || '')}" style="flex:1; font-size:0.82rem; padding:2px 6px; border:1px solid var(--card-border); border-radius:4px; background:var(--card-bg-alt); color:var(--text);" />
          </div>
        `;
      });
      markup += `</div></div>`;
    }

    // Todos List
    if (todos.length > 0) {
      markup += `
        <div style="margin-bottom:12px;" contenteditable="false">
          <div style="font-weight:700; font-size:0.8rem; color:var(--text); margin-bottom:6px;" contenteditable="false">📋 ${t('refactor.proposedTodos') || 'Proposed Todos & Action Items'} (${todos.length})</div>
          <div style="display:flex; flex-direction:column; gap:8px;" contenteditable="false">
      `;
      todos.forEach((todo, idx) => {
        const imp = todo.importance || todo.priority || 'Medium';
        const urg = todo.urgency || 'Medium';

        markup += `
          <div style="display:flex; flex-wrap:wrap; align-items:center; gap:8px; background:var(--card-bg); border:1px solid var(--card-border); border-radius:8px; padding:8px 10px;" contenteditable="false">
            <input type="checkbox" class="refactor-check-todo" data-idx="${idx}" checked id="refactor-todo-chk-${tabKey}-${idx}" style="cursor:pointer;" />
            <input type="text" class="refactor-todo-title field-input" data-idx="${idx}" value="${escA(todo.title || '')}" placeholder="Action item title..." style="flex:2; min-width:180px; font-size:0.82rem; padding:4px 8px; border:1px solid var(--card-border); border-radius:4px; background:var(--card-bg-alt); color:var(--text);" />
            
            <div style="display:flex; align-items:center; gap:4px;" contenteditable="false">
              <span style="font-size:0.72rem; color:var(--text-muted); font-weight:600;" contenteditable="false">👤</span>
              <div id="refactor-todo-owner-picker-${tabKey}-${idx}" class="tag-input-container refactor-todo-owner-picker" data-idx="${idx}" style="min-width:140px; font-size:0.78rem; padding:2px 4px; border:1px solid var(--card-border); border-radius:4px; background:var(--card-bg-alt); color:var(--text); display:inline-flex; align-items:center;"></div>
            </div>

            <div style="display:flex; align-items:center; gap:4px;" contenteditable="false">
              <span style="font-size:0.72rem; color:var(--text-muted); font-weight:600;" contenteditable="false">⚡ Imp:</span>
              <select class="refactor-todo-imp field-select" data-idx="${idx}" style="font-size:0.78rem; padding:3px 6px; border-radius:4px; border:1px solid var(--card-border); background:var(--card-bg); color:var(--text);">
                <option value="High" ${imp === 'High' ? 'selected' : ''}>High</option>
                <option value="Medium" ${imp === 'Medium' ? 'selected' : ''}>Medium</option>
                <option value="Low" ${imp === 'Low' ? 'selected' : ''}>Low</option>
              </select>
            </div>

            <div style="display:flex; align-items:center; gap:4px;" contenteditable="false">
              <span style="font-size:0.72rem; color:var(--text-muted); font-weight:600;" contenteditable="false">⏳ Urg:</span>
              <select class="refactor-todo-urg field-select" data-idx="${idx}" style="font-size:0.78rem; padding:3px 6px; border-radius:4px; border:1px solid var(--card-border); background:var(--card-bg); color:var(--text);">
                <option value="High" ${urg === 'High' ? 'selected' : ''}>High</option>
                <option value="Medium" ${urg === 'Medium' ? 'selected' : ''}>Medium</option>
                <option value="Low" ${urg === 'Low' ? 'selected' : ''}>Low</option>
              </select>
            </div>
          </div>
        `;
      });
      markup += `</div></div>`;
    }

    // Linked Colleagues & Notes
    if (colleagues.length > 0 || notes.length > 0) {
      markup += `<div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center; border-top:1px dashed var(--card-border); padding-top:8px; margin-top:6px;" contenteditable="false">`;
      if (colleagues.length > 0) {
        markup += `<span style="font-size:0.78rem; font-weight:600; color:var(--text-muted);" contenteditable="false">👤 ${t('refactor.linkedColleagues') || 'Colleagues'}:</span>`;
        colleagues.forEach(c => {
          const name = typeof c === 'string' ? c : c.name;
          markup += `<span class="note-todo-badge owner-tag" style="font-size:0.72rem;" contenteditable="false">@${escH(name.replace(/^@/, ''))}</span>`;
        });
      }
      if (notes.length > 0) {
        markup += `<span style="font-size:0.78rem; font-weight:600; color:var(--text-muted); margin-left:8px;" contenteditable="false">📝 ${t('refactor.linkedNotes') || 'Notes'}:</span>`;
        notes.forEach(n => {
          const title = typeof n === 'string' ? n : n.title;
          markup += `<span class="badge" style="font-size:0.72rem; background:var(--card-bg); border:1px solid var(--card-border); border-radius:10px; padding:1px 7px;" contenteditable="false">[[${escH(title)}]]</span>`;
        });
      }
      markup += `</div>`;
    }

    markup += `</div>`;
    container.innerHTML = markup;

    // Populate collaborator pickers for proposed todos
    if (todos.length > 0 && typeof populateCollaboratorPicker === 'function') {
      todos.forEach((todo, idx) => {
        const pickerId = `refactor-todo-owner-picker-${tabKey}-${idx}`;
        const initialOwner = (typeof resolveColleagueId === 'function')
          ? (resolveColleagueId(todo.owner, { allowCreate: false, allowMe: true }) || 'me')
          : (todo.owner || 'me');
        populateCollaboratorPicker(pickerId, initialOwner, {
          allowEmpty: false,
          includeMe: true,
          createOnType: true,
          placeholder: t('todo.todoOwnerPlaceholder') || 'Select collaborator...',
          title: t('todo.clickToTypeOwner') || 'Select collaborator'
        });
      });
    }
  },

  renderScratchpadView() {
    const container = document.getElementById('refactor-scratchpad-content');
    if (!container) return;

    let markup = '';

    if (this.scratchpad) {
      markup += LLMService.renderThinkingAccordionHTML(this.scratchpad, { isOpen: true, title: t('chat.thinkingProcess') || 'Thought Process' });
    }

    if (this.topicMemories && this.topicMemories.length > 0) {
      const brainIcon = typeof AppIcons !== 'undefined' ? AppIcons.get('brain', { size: 14 }) : '';
      this.topicMemories.forEach(tm => {
        if (!tm) return;
        const facts = Array.isArray(tm.keyFacts) ? tm.keyFacts : [];
        markup += `
          <div class="scratchpad-topic-memory-box">
            <div style="font-weight:700; color:var(--accent); margin-bottom:4px; font-size:0.9rem; display:flex; align-items:center; gap:6px;">${brainIcon} Persistent Major Topic Memory: "${escH(tm.majorTopic || '')}"</div>
            <div style="margin-bottom:4px; font-size:0.84rem;"><strong>Summary:</strong> ${escH(tm.summary || 'No summary recorded')}</div>
            ${facts.length ? `<div style="font-size:0.8rem; color:var(--text-muted);"><strong>Key Facts:</strong> ${escH(facts.map(f => typeof f === 'string' ? f : JSON.stringify(f)).join(' • '))}</div>` : ''}
          </div>
        `;
      });
    }

    if (Array.isArray(this.scratchpadLog) && this.scratchpadLog.length > 0) {
      this.scratchpadLog.forEach(log => {
        if (!log) return;
        markup += `
          <div class="scratchpad-log-entry">
            <div class="scratchpad-log-header">
              <span>Step ${log.step}: ${escH(log.title || '')}</span>
            </div>
            <div style="color:var(--text); font-size:0.83rem; white-space:pre-wrap;">${escH(typeof log.content === 'string' ? log.content : JSON.stringify(log.content, null, 2))}</div>
          </div>
        `;
      });
    }

    if (this.scratchpad) {
      const copyIcon = typeof AppIcons !== 'undefined' ? AppIcons.get('copy', { size: 12 }) : '';
      markup += `
        <div style="margin-top:12px; padding:10px; background:var(--card-bg); border-radius:6px; border:1px solid var(--card-border);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <span style="font-weight:700; font-size:0.82rem; color:var(--text-muted);">Current Agent Scratchpad Buffer:</span>
            <button type="button" class="btn" style="padding:2px 8px; font-size:0.75rem; display:inline-flex; align-items:center; gap:4px;" onclick="RefactorModalController.copyScratchpadBuffer()" title="${escA(t('refactor.copyScratchpad') || 'Copy Scratchpad to Clipboard')}">${copyIcon} Copy</button>
          </div>
          <pre id="scratchpad-raw-buffer" style="margin:0; font-size:0.8rem; white-space:pre-wrap; color:var(--text); font-family:monospace; max-height:220px; overflow-y:auto;">${escH(this.scratchpad)}</pre>
        </div>
      `;
    }

    container.innerHTML = markup;
  },

  copyScratchpadBuffer() {
    if (!this.scratchpad) return;
    navigator.clipboard.writeText(this.scratchpad).then(() => {
      toast('📋 Scratchpad buffer copied to clipboard!');
    }).catch(err => {
      console.error('Failed copying scratchpad', err);
    });
  },

  copyCurrentProposal() {
    const htmlContainer = document.getElementById('refactor-proposal-html');
    const html = htmlContainer ? htmlContainer.innerHTML : (this.activeTab === 'A' ? this.proposalA : (this.activeTab === 'B' ? this.proposalB : this.proposalC));
    if (!html) return;

    if (navigator.clipboard && navigator.clipboard.write) {
      const blob = new Blob([html], { type: 'text/html' });
      const textBlob = new Blob([html.replace(/<[^>]*>/g, '')], { type: 'text/plain' });
      const item = new ClipboardItem({ 'text/html': blob, 'text/plain': textBlob });
      navigator.clipboard.write([item]).then(() => {
        toast(t('common.copied') || '📋 Proposal copied to clipboard!');
      }).catch(_e => {
        navigator.clipboard.writeText(html);
        toast(t('common.copied') || '📋 Proposal copied to clipboard!');
      });
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(html);
      toast(t('common.copied') || '📋 Proposal copied to clipboard!');
    }
  },

  toggleFeedbackDrawer(show) {
    const drawer = document.getElementById('refactor-feedback-drawer');
    if (!drawer) return;
    if (show === undefined) {
      const isVisible = drawer.style.display !== 'none';
      drawer.style.display = isVisible ? 'none' : 'flex';
    } else {
      drawer.style.display = show ? 'flex' : 'none';
    }
    if (drawer.style.display !== 'none') {
      const input = document.getElementById('refactor-feedback-input');
      if (input) input.focus();
      const feedbackLabel = document.getElementById('refactor-feedback-label');
      const genCBtn = document.getElementById('btn-generate-option-c');
      if (this.activeTab === 'C') {
        if (feedbackLabel) feedbackLabel.textContent = t('refactor.feedbackTitleC') || 'Option C Refinement:';
        if (genCBtn) {
          genCBtn.textContent = `✨ ${t('refactor.regenerateOptionC') || 'Update Option C'}`;
          genCBtn.title = t('refactor.regenerateOptionCTooltip') || 'Regenerate Option C according to your updated instructions';
        }
      } else {
        if (feedbackLabel) feedbackLabel.textContent = t('refactor.feedbackTitle') || 'Option C Instructions:';
        if (genCBtn) {
          genCBtn.textContent = `✨ ${t('refactor.generateOptionC') || 'Generate Option C'}`;
          genCBtn.title = t('refactor.generateOptionCTooltip') || 'Generate custom Option C according to your instructions';
        }
      }
    }
  },

  onFeedbackPresetSelected(presetValue) {
    if (!presetValue) return;
    const input = document.getElementById('refactor-feedback-input');
    if (!input) return;
    const current = (input.value || '').trim();
    if (!current) {
      input.value = presetValue;
    } else if (!current.includes(presetValue)) {
      input.value = `${current}, ${presetValue}`;
    }
    input.focus();
  },

  async generateOptionC() {
    const input = document.getElementById('refactor-feedback-input');
    const feedback = (input?.value || '').trim();
    if (!feedback) {
      toast(t('refactor.enterFeedbackPrompt') || 'Please enter some feedback or select guidance chips.', true);
      return;
    }

    const genBtn = document.getElementById('btn-generate-option-c');
    const reperfectBtn = document.getElementById('btn-refactor-reperfect');
    const declineBtn = document.getElementById('btn-refactor-decline');
    const applyBtn = document.getElementById('btn-refactor-apply');
    const copyBtn = document.getElementById('btn-refactor-copy');

    if (genBtn) {
      genBtn.disabled = true;
      genBtn.textContent = `⏳ ${t('refactor.generatingOptionC') || 'Generating Option C...'}`;
    }
    if (reperfectBtn) reperfectBtn.disabled = true;
    if (declineBtn) declineBtn.disabled = true;
    if (applyBtn) applyBtn.disabled = true;
    if (copyBtn) copyBtn.disabled = true;

    if (this.currentAbortController) {
      this.currentAbortController.abort();
    }
    this.currentAbortController = new AbortController();

    this.setRefactorLockState(true);
    this.updateRefactorProgress(40, t('refactor.generatingOptionC') || 'Generating Option C...');

    const currentUserName = (typeof settings !== 'undefined' && settings && settings.username) ? settings.username : (typeof getDefaultMeLabel === 'function' ? getDefaultMeLabel() : 'Me');
    try {
      toast(`✨ ${t('refactor.refactoringInProgress') || 'Generating Option C...'}`);
      const result = await LLMService.generateOptionCWithFeedback(
        this.activeNote,
        this.activeNoteContent,
        this.scratchpad,
        feedback,
        { controller: this.currentAbortController }
      );

      const rawC = cleanProposalHtml(result.proposalC);
      const hasImagesC = (this.originalHtmlSnapshot && (this.originalHtmlSnapshot.includes('<img') || this.originalHtmlSnapshot.includes('NIMGTK') || this.originalHtmlSnapshot.includes('!['))) || /\[\s*IMAGE[_\s]\d+/i.test(rawC);
      this.proposalC = hasImagesC
        ? restoreOriginalImagesToProposal(this.originalHtmlSnapshot, rawC)
        : rawC;
      this.meetingSummaryC = cleanMeetingSummaryHtml(result.meetingSummary || this.meetingSummary, currentUserName);
      this.proposalActionsC = extractProposedActionsFromProposal(this.proposalC, { proposed_decisions: result.proposedDecisions, proposed_todos: result.proposedTodos, proposed_colleague_links: result.proposedColleagues, proposed_note_links: result.proposedNotes });
      this.scratchpadLog.push({ step: this.scratchpadLog.length + 1, title: t('refactor.stepOptionC') || 'Option C Generated', content: `Generated custom proposal based on feedback: "${feedback}"` });

      if (this.tabBaselineHtml) {
        this.tabBaselineHtml.C = this.proposalC;
      }

      const tabC = document.getElementById('tab-proposal-c');
      if (tabC) tabC.style.display = 'inline-flex';

      this.toggleFeedbackDrawer(false);
      if (input) input.value = '';
      this.switchTab('C');
      toast('✨ Option C is ready!');
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      console.error('Failed generating Option C', err);
      toast(`Failed to generate Option C: ${err.message}`, true);
    } finally {
      this.setRefactorLockState(false);
      this.updateRefactorProgress(false);
      if (genBtn) {
        genBtn.disabled = false;
        if (this.activeTab === 'C') {
          genBtn.textContent = `✨ ${t('refactor.regenerateOptionC') || 'Update Option C'}`;
        } else {
          genBtn.textContent = `✨ ${t('refactor.generateOptionC') || 'Generate Option C'}`;
        }
      }
      if (reperfectBtn) reperfectBtn.disabled = false;
      if (declineBtn) declineBtn.disabled = false;
      if (applyBtn) applyBtn.disabled = false;
      if (copyBtn) copyBtn.disabled = false;
      this.updateReperfectButtonState();
    }
  },

  formatProposal(cmd) {
    const previewPane = document.getElementById('refactor-proposal-preview-pane');
    if (!previewPane) return;
    if (typeof formatRichTextInEditor === 'function') {
      formatRichTextInEditor(previewPane, cmd);
      if (this.hasUserEditedTab && this.activeTab) {
        this.hasUserEditedTab[this.activeTab] = true;
      }
      const htmlContainer = document.getElementById('refactor-proposal-html');
      const html = htmlContainer ? htmlContainer.innerHTML : previewPane.innerHTML;
      if (this.activeTab === 'A') this.proposalA = html;
      else if (this.activeTab === 'B') this.proposalB = html;
      else if (this.activeTab === 'C') this.proposalC = html;
      else if (this.activeTab === 'original') this.originalHtml = html;
      this.updateReperfectButtonState();
      if (this.activeTab === 'original') {
        this.updateApplyButtonState();
      }
    }
  },

  async applyCurrentProposal() {
    let chosenHtml = '';
    const htmlContainer = document.getElementById('refactor-proposal-html');
    if (htmlContainer && htmlContainer.innerHTML) {
      chosenHtml = htmlContainer.innerHTML;
      if (this.activeTab === 'A') this.proposalA = chosenHtml;
      else if (this.activeTab === 'B') this.proposalB = chosenHtml;
      else if (this.activeTab === 'C') this.proposalC = chosenHtml;
      else if (this.activeTab === 'original') this.originalHtml = chosenHtml;
    } else {
      if (this.activeTab === 'A') chosenHtml = this.proposalA;
      else if (this.activeTab === 'B') chosenHtml = this.proposalB;
      else if (this.activeTab === 'C') chosenHtml = this.proposalC;
      else if (this.activeTab === 'original') chosenHtml = this.originalHtml || this.originalHtmlSnapshot;
    }

    if (this.activeTab === 'original') {
      const isModified = (chosenHtml || '').trim() !== (this.originalHtmlSnapshot || '').trim();
      if (!isModified) {
        toast(t('refactor.keptOriginal') || 'Kept original note.');
        this.closeProposalsModal();
        return;
      }
    }

    // Auto-save pre-refactor snapshot in .history/
    if (typeof currentNote !== 'undefined' && currentNote && currentNote.path && typeof StorageAPI !== 'undefined' && StorageAPI.saveSnapshot) {
      try {
        const preContent = this.originalHtmlSnapshot || (currentNote && currentNote.mainHTML) || '';
        if (preContent) {
          await StorageAPI.saveSnapshot(currentNote.path, preContent, 'pre-ai-refactor');
        }
      } catch (e) {}
    }

    if (!chosenHtml || !chosenHtml.trim()) {
      toast(t('refactor.noProposalSelected') || 'No proposal selected.', true);
      return;
    }

    if (this.activeNote?.path && typeof currentNote !== 'undefined' && currentNote?.path && this.activeNote.path !== currentNote.path) {
      toast('Active note changed since refactoring started. Please re-open the note to refactor.', true);
      this.closeProposalsModal();
      return;
    }

    const editor = document.getElementById('edit-textarea');
    if (editor) {
      this.lastAppliedSnapshot = {
        notePath: this.activeNote?.path || (typeof currentNote !== 'undefined' ? currentNote?.path : ''),
        html: editor.innerHTML,
        timestamp: Date.now()
      };

      if ((this.originalHtmlSnapshot && (this.originalHtmlSnapshot.includes('<img') || this.originalHtmlSnapshot.includes('NIMGTK') || this.originalHtmlSnapshot.includes('!['))) || /\[\s*IMAGE[_\s]\d+/i.test(chosenHtml)) {
        chosenHtml = restoreOriginalImagesToProposal(this.originalHtmlSnapshot, chosenHtml);
      }

      if (this.activeTab === 'original') {
        editor.innerHTML = chosenHtml;
        editor.dispatchEvent(new Event('input', { bubbles: true }));

        if (typeof autoSaveNote === 'function') {
          autoSaveNote({ silent: false });
        } else if (typeof saveCurrentNote === 'function') {
          saveCurrentNote();
        }

        if (typeof syncPreview === 'function') {
          syncPreview();
        }

        toast(`🎉 ${t('refactor.originalAppliedWithEdits') || 'Original note applied with edits!'}`);
        this.closeProposalsModal();
        return;
      }

      // Convert decisions and todos into interactive DOM elements inside chosenHtml
      const parser = new DOMParser();
      const doc = parser.parseFromString(`<div>${chosenHtml}</div>`, 'text/html');
      const rootDiv = doc.body.firstElementChild || doc.body;

      // Process user-reviewed Decisions and Todos from current proposal tab
      let createdDecisionsCount = 0;
      let createdTodosCount = 0;

      const noteMajorTags = Array.isArray(this.activeNote?.major_topic_tags) ? this.activeNote.major_topic_tags : (typeof currentNote !== 'undefined' && Array.isArray(currentNote?.major_topic_tags) ? currentNote.major_topic_tags : []);
      const majorAttr = (typeof encodeTagListToStorage === 'function' && noteMajorTags.length) ? encodeTagListToStorage(noteMajorTags) : noteMajorTags.join(', ');
      const primaryTopic = noteMajorTags[0] || (this.topicMemories && this.topicMemories[0]?.majorTopic) || '';

      const decChecks = document.querySelectorAll('#refactor-actions-review-container .refactor-check-dec');
      decChecks.forEach(chk => {
        if (!chk.checked) return;
        const idx = chk.dataset.idx;
        const input = document.querySelector(`#refactor-actions-review-container .refactor-dec-input[data-idx="${idx}"]`);
        const decText = input ? (input.value || '').trim() : '';
        if (decText) {
          createdDecisionsCount++;
          const chipHtml = `<span class="note-decision-wrapper note-decision-draft" data-decision-status="active" data-decision-text="${escA(decText)}"${majorAttr ? ` data-decision-major="${escA(majorAttr)}"` : ''}${primaryTopic ? ` data-decision-topic="${escA(primaryTopic)}"` : ''} contenteditable="false"><strong class="pill-decision pill-decision-active" contenteditable="false">!decision:active</strong> <span class="note-decision-text" contenteditable="true">${escH(decText)}</span></span>`;

          // Check if an existing decision wrapper exists
          const existingWrapper = Array.from(rootDiv.querySelectorAll('.note-decision-wrapper')).find(w => {
            const t = (w.querySelector('.note-decision-text')?.textContent || w.getAttribute('data-decision-text') || '').trim();
            return t === decText || t.toLowerCase() === decText.toLowerCase();
          });

          if (existingWrapper) {
            existingWrapper.outerHTML = chipHtml;
          } else {
            // Find a matching <li> or <p> whose text matches or contains decText
            const allItems = Array.from(rootDiv.querySelectorAll('li, p'));
            const matchingItem = allItems.find(el => {
              const elText = el.textContent.trim();
              return elText === decText || (elText.length < decText.length + 40 && elText.includes(decText));
            });

            if (matchingItem) {
              matchingItem.innerHTML = chipHtml;
            } else {
              // Look for decisions section header
              const headers = Array.from(rootDiv.querySelectorAll('h2, h3, h4'));
              const decHeader = headers.find(h => /decisions|décisions|entscheidungen|decisiones/i.test(h.textContent));
              if (decHeader && decHeader.nextElementSibling && (decHeader.nextElementSibling.tagName === 'UL' || decHeader.nextElementSibling.tagName === 'OL')) {
                const li = doc.createElement('li');
                li.innerHTML = chipHtml;
                decHeader.nextElementSibling.appendChild(li);
              } else {
                const p = doc.createElement('p');
                p.innerHTML = chipHtml;
                rootDiv.appendChild(p);
              }
            }
          }
        }
      });

      const todoChecks = document.querySelectorAll('#refactor-actions-review-container .refactor-check-todo');
      todoChecks.forEach(chk => {
        if (!chk.checked) return;
        const idx = chk.dataset.idx;
        const titleInp = document.querySelector(`#refactor-actions-review-container .refactor-todo-title[data-idx="${idx}"]`);
        const impSel = document.querySelector(`#refactor-actions-review-container .refactor-todo-imp[data-idx="${idx}"]`);
        const urgSel = document.querySelector(`#refactor-actions-review-container .refactor-todo-urg[data-idx="${idx}"]`);

        const pickerContainerId = `refactor-todo-owner-picker-${this.activeTab}-${idx}`;
        const ownerVal = (typeof readCollaboratorPicker === 'function') ? readCollaboratorPicker(pickerContainerId) : '';
        const fallbackOwnerInp = document.querySelector(`#refactor-actions-review-container .refactor-todo-owner[data-idx="${idx}"]`);
        const ownerRaw = ownerVal || (fallbackOwnerInp ? fallbackOwnerInp.value : '') || 'me';

        const rawTitle = titleInp ? (titleInp.value || '').trim() : '';
        if (rawTitle) {
          createdTodosCount++;
          const ownerId = (typeof resolveColleagueId === 'function') ? (resolveColleagueId(ownerRaw, { allowCreate: false, allowMe: true }) || 'me') : ownerRaw;
          const ownerDisplayName = (typeof getColleagueLabelById === 'function') ? getColleagueLabelById(ownerId, ownerId === 'me' ? 'me' : ownerRaw) : (ownerId === 'me' ? 'me' : ownerRaw);
          const ownerBadgeLabel = ownerDisplayName ? (ownerDisplayName === 'me' ? '@me' : `@${ownerDisplayName.replace(/^@/, '')}`) : '';

          const imp = impSel ? impSel.value : 'Medium';
          const urg = urgSel ? urgSel.value : 'Medium';
          const title = formatTodoTitleWithMetadata(rawTitle, ownerDisplayName, urg);
          // Check if an existing open todo already matches by ID or clean title
          let matchedManifestTodo = null;
          if (typeof todosManifest !== 'undefined' && Array.isArray(todosManifest)) {
            const rawClean = (rawTitle || '').trim().toLowerCase();
            matchedManifestTodo = todosManifest.find(t =>
              t && t.priority !== 'Done' && (
                (t.title && t.title.trim().toLowerCase() === rawClean)
              )
            );
          }
          const todoId = matchedManifestTodo ? matchedManifestTodo.id : `td_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

          const impClass = imp.toLowerCase();
          const urgClass = urg.toLowerCase();

          const todoChipHtml = `<span class="note-todo" data-todo-id="${escA(todoId)}" data-importance="${escA(imp)}" data-urgency="${escA(urg)}" data-owner="${escA(ownerDisplayName)}" data-owner-id="${escA(ownerId)}" data-todo-priority="${escA(imp)}" contenteditable="false">` +
            `<span class="note-todo-badge imp-${escA(impClass)}" contenteditable="false" title="Importance: ${escA(imp)}">⚡ ${escH(imp)}</span> ` +
            `<span class="note-todo-badge urg-${escA(urgClass)}" contenteditable="false" title="Urgency: ${escA(urg)}">⏳ ${escH(urg)}</span> ` +
            (ownerBadgeLabel ? `<span class="note-todo-badge owner-tag inline-reassign-owner" contenteditable="false" title="${escA(t('todo.reassignColleagueTooltip') || 'Click to reassign colleague')}">👤 ${escH(ownerBadgeLabel)}</span> ` : '') +
            `<span class="note-todo-text" contenteditable="true">${escH(title)}</span>` +
            `</span>`;

          // Check if an existing todo element exists with matching ID or text
          const existingTodo = Array.from(rootDiv.querySelectorAll('.note-todo')).find(td => {
            const t = (typeof getTodoMarkerTitleText === 'function') ? getTodoMarkerTitleText(td) : (td.querySelector('.note-todo-text')?.textContent || td.textContent || '').trim();
            return t === title || t.toLowerCase() === title.toLowerCase();
          });

          if (existingTodo) {
            existingTodo.outerHTML = todoChipHtml;
          } else {
            // Find a matching <li> or <p> whose text matches or contains title / owner
            const allItems = Array.from(rootDiv.querySelectorAll('li, p'));
            const matchingItem = allItems.find(el => {
              if (el.querySelector('.note-decision-wrapper')) return false;
              const elText = el.textContent.trim();
              return elText === title || elText.includes(title) || (ownerDisplayName && elText.includes(`@${ownerDisplayName}`) && elText.includes(title.slice(0, 15)));
            });

            if (matchingItem) {
              matchingItem.innerHTML = todoChipHtml;
            } else {
              // Look for Next Steps / Action Items section header
              const headers = Array.from(rootDiv.querySelectorAll('h2, h3, h4'));
              const actionHeader = headers.find(h => /next steps|action items|actions|prochaines étapes|nächste schritte|aufgaben/i.test(h.textContent));
              if (actionHeader && actionHeader.nextElementSibling && (actionHeader.nextElementSibling.tagName === 'UL' || actionHeader.nextElementSibling.tagName === 'OL')) {
                const li = doc.createElement('li');
                li.innerHTML = todoChipHtml;
                actionHeader.nextElementSibling.appendChild(li);
              } else {
                const p = doc.createElement('p');
                p.innerHTML = todoChipHtml;
                rootDiv.appendChild(p);
              }
            }
          }

          if (typeof todosManifest !== 'undefined' && Array.isArray(todosManifest)) {
            if (matchedManifestTodo) {
              matchedManifestTodo.importance = imp;
              matchedManifestTodo.priority = imp;
              matchedManifestTodo.urgency = urg;
              matchedManifestTodo.owner = ownerDisplayName || matchedManifestTodo.owner || 'me';
              matchedManifestTodo.ownerId = ownerId || matchedManifestTodo.ownerId || 'me';
              matchedManifestTodo.modified = new Date().toISOString().split('T')[0];
              if (typeof saveTodosManifest === 'function') {
                saveTodosManifest();
              }
            } else if (!todosManifest.some(t => t.id === todoId)) {
              todosManifest.push({
                id: todoId,
                title: title,
                owner: ownerDisplayName || 'me',
                ownerId: ownerId || 'me',
                importance: imp,
                urgency: urg,
                priority: imp,
                status: 'Pending',
                date: new Date().toISOString().split('T')[0],
                noteId: this.activeNote?.id || ''
              });
              if (typeof saveTodosManifest === 'function') {
                saveTodosManifest();
              }
            }
          }
        }
      });

      // Unroll any lingering uncertainty spans before saving so note stays clean
      chosenHtml = rootDiv.innerHTML.replace(/<span class="inline-uncertain-text"[^>]*>(.*?)<\/span>/gi, '$1');

      editor.innerHTML = chosenHtml;
      editor.dispatchEvent(new Event('input', { bubbles: true }));

      // Populate meeting summary in the respective field directly from the perfect note agent
      const chosenSummary = (this.activeTab === 'A' ? this.meetingSummaryA : this.activeTab === 'B' ? this.meetingSummaryB : this.activeTab === 'C' ? this.meetingSummaryC : this.meetingSummary) || this.meetingSummary;
      if (chosenSummary) {
        if (typeof writeSummaryMetadataHTML === 'function') {
          writeSummaryMetadataHTML(chosenSummary);
        } else {
          const summaryEl = document.getElementById('edit-summary');
          if (summaryEl) {
            summaryEl.innerHTML = chosenSummary;
            summaryEl.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
        if (this.activeNote) {
          this.activeNote.summary = chosenSummary;
        }
        if (typeof currentNote !== 'undefined' && currentNote) {
          currentNote.summary = chosenSummary;
        }
        const notePath = this.activeNote?.path || (typeof currentNote !== 'undefined' && currentNote?.path) || '';
        if (typeof DailyReviewController !== 'undefined' && typeof DailyReviewController.updateNoteSummaryBadge === 'function') {
          DailyReviewController.updateNoteSummaryBadge(notePath, chosenSummary);
        }
      }

      if (typeof autoSaveNote === 'function') {
        autoSaveNote({ silent: false });
      } else if (typeof saveCurrentNote === 'function') {
        saveCurrentNote();
      }

      if (typeof syncPreview === 'function') {
        syncPreview();
      }

      // Commit Workstream & Tag changes if accepted by the user
      await this.commitWorkstreamAndTagChanges(this.activeNote, this);

      // Commit Workstream Memory updates to disk upon apply
      const majorTags = Array.isArray(this.activeNote?.major_topic_tags) ? this.activeNote.major_topic_tags : [];
      for (const mt of majorTags) {
        if (typeof saveMajorTopicMemory === 'function') {
          await saveMajorTopicMemory(mt, {
            status: 'active',
            lastNoteId: this.activeNote?.id || '',
            lastNoteTitle: this.activeNote?.title || ''
          });
        }
      }

      // Remove the proposal entry and update badges so "Ready" tag is removed
      const notePath = this.activeNote?.path || (typeof currentNote !== 'undefined' && currentNote?.path) || '';
      if (typeof DailyReviewController !== 'undefined') {
        if (DailyReviewController.noteProposals && notePath) {
          delete DailyReviewController.noteProposals[notePath];
        }
        if (typeof DailyReviewController.renderStep3ListBadges === 'function') {
          DailyReviewController.renderStep3ListBadges();
        }
      }

      toast(`🎉 ${(typeof t === 'function' ? t('refactor.successToast') : null) || 'Note successfully refactored!'}${createdDecisionsCount > 0 || createdTodosCount > 0 ? ` (Created ${createdDecisionsCount} decisions, ${createdTodosCount} action items)` : ''}`);
    }

    this.closeProposalsModal();
  },

  revertLastRefactor() {
    if (!this.lastAppliedSnapshot || !this.lastAppliedSnapshot.html) {
      toast(t('refactor.noSnapshotFound') || 'No previous snapshot found to revert.', true);
      return;
    }

    if (this.lastAppliedSnapshot.notePath && typeof currentNote !== 'undefined' && currentNote?.path && this.lastAppliedSnapshot.notePath !== currentNote.path) {
      toast('Cannot revert: snapshot belongs to a different note.', true);
      return;
    }

    const editor = document.getElementById('edit-textarea');
    if (editor) {
      editor.innerHTML = this.lastAppliedSnapshot.html;
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      if (typeof autoSaveNote === 'function') autoSaveNote({ silent: false });
      if (typeof syncPreview === 'function') syncPreview();
      toast(t('refactor.revertedToast') || 'Reverted to previous version before refactoring.');
    }
  }
};

window.RefactorModalController = RefactorModalController;

async function refactorCurrentNoteWithLLM() {
  await RefactorModalController.startRefactor(currentNote);
}
window.refactorCurrentNoteWithLLM = refactorCurrentNoteWithLLM;
window._realRefactorCurrentNoteWithLLM = refactorCurrentNoteWithLLM;
