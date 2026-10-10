function renderAiOnboardingHTML(customTitle) {
  const headerText = customTitle || (typeof t === 'function' ? t('chat.tabTitle') : '') || 'AI Chat';
  const introText = (typeof t === 'function' ? t('chat.onboardingIntro') : '') || 'Local LLM features are currently disabled. You can easily enable a local LLM from the settings panel to chat, fetch contexts, and orchestrate planner events.';
  const stepsTitle = (typeof t === 'function' ? t('chat.onboardingStepsTitle') : '') || 'How to setup your local AI Agent';
  const btnText = (typeof t === 'function' ? t('chat.goToPreferences') : '') || 'Go to Preferences';
  const btnTooltip = (typeof t === 'function' ? t('chat.goToPreferencesTooltip') : '') || 'Open AI configuration settings';

  return `
    <div class="chat-onboarding">
      <h2>💬 ${escH(headerText)}</h2>
      <p>${escH(introText)}</p>
      
      <div class="chat-onboarding-steps">
        <h3>🛠️ ${escH(stepsTitle)}</h3>
        <ol>
          <li><strong>LM Studio</strong>:
            <ul>
              <li>Download and open LM Studio.</li>
              <li>Download a model (e.g. <code>qwen2.5-coder-7b-instruct</code>).</li>
              <li>Go to the Local Server tab and click "Start Server" (runs on <code>http://localhost:1234/v1</code>).</li>
            </ul>
          </li>
          <li><strong>Ollama</strong>:
            <ul>
              <li>Install Ollama and run <code>ollama run qwen2.5-coder:7b</code> in your terminal.</li>
              <li>Ollama exposes an OpenAI-compatible endpoint at <code>http://localhost:11434/v1</code>.</li>
            </ul>
          </li>
          <li><strong>Jan</strong>:
            <ul>
              <li>Open Jan, download a model, and click "Start Server" on the Local API page (runs on <code>http://localhost:1337/v1</code>).</li>
            </ul>
          </li>
        </ol>
      </div>

      <button class="btn btn-primary" onclick="if (typeof switchTab === 'function') switchTab('prefs'); if (typeof switchPrefsTab === 'function') switchPrefsTab('ai');" title="${escA(btnTooltip)}" style="margin-top: 1rem; padding: var(--space-3) var(--space-6);">
        ⚙️ ${escH(btnText)}
      </button>
    </div>
  `;
}
window.renderAiOnboardingHTML = renderAiOnboardingHTML;
if (typeof globalThis !== 'undefined') globalThis.renderAiOnboardingHTML = renderAiOnboardingHTML;

/**
 * Secretary - AI Chat & Agentic Tool Resolver Controller
 */
const AIChatController = {
  messages: [],
  attachedNotes: [], // Array of note paths
  attachedTasks: [], // Array of task IDs
  attachedEvents: [], // Array of event IDs
  
  // Note-specific chat state
  noteMessages: [],
  noteAttachedNotes: [], // Array of note paths
  noteAttachedTasks: [], // Array of task IDs
  isNoteThinking: false,
  noteThinkingMessage: '',
  currentNoteChatId: '',
  
  // Multiple conversations state
  conversations: [],
  currentConversationId: '',
  historySearchQuery: '',
  
  // Autocomplete state
  autocompleteOpen: false,
  autocompleteIndex: 0,
  autocompleteFilteredNotes: [],
  
  // Attach Context Modal state
  modalTab: 'notes', // 'notes' | 'tasks'
  modalSearchQuery: '',
  
  // Agent loop state
  isThinking: false,
  thinkingMessage: '',
  currentRequestController: null,

  init() {
    try {
      this.leftSidebarCollapsed = localStorage.getItem('secretaryChatLeftSidebarCollapsed') === '1';
    } catch (e) {
      this.leftSidebarCollapsed = true;
    }
    try {
      this.rightSidebarCollapsed = localStorage.getItem('secretaryChatRightSidebarCollapsed') === '1';
    } catch (e) {
      this.rightSidebarCollapsed = true;
    }
    try {
      const savedLeftW = parseInt(localStorage.getItem('secretaryChatHistoryPaneWidth'), 10);
      this.leftSidebarWidth = (!isNaN(savedLeftW) && savedLeftW >= 180 && savedLeftW <= 600) ? savedLeftW : 260;
    } catch (e) {
      this.leftSidebarWidth = 260;
    }
    try {
      const savedRightW = parseInt(localStorage.getItem('secretaryChatCommandsPaneWidth'), 10);
      this.rightSidebarWidth = (!isNaN(savedRightW) && savedRightW >= 180 && savedRightW <= 600) ? savedRightW : 240;
    } catch (e) {
      this.rightSidebarWidth = 240;
    }

    // Load conversations list
    try {
      this.conversations = JSON.parse(localStorage.getItem('secretaryConversationsList') || '[]');
    } catch (e) {
      console.warn('Failed parsing secretaryConversationsList', e);
      this.conversations = [];
    }
    if (!Array.isArray(this.conversations)) {
      this.conversations = [];
    }

    try {
      this.currentConversationId = localStorage.getItem('secretaryCurrentConversationId') || '';
    } catch (e) {
      this.currentConversationId = '';
    }

    // Legacy migration
    let legacyHistoryStr = null;
    try {
      legacyHistoryStr = localStorage.getItem('secretaryChatHistory');
    } catch (e) {}

    if (this.conversations.length === 0 && legacyHistoryStr) {
      try {
        const legacyMessages = JSON.parse(legacyHistoryStr);
        if (Array.isArray(legacyMessages) && legacyMessages.length > 0) {
          const legacyId = 'chat_legacy';
          const firstUserMsg = legacyMessages.find(m => m.role === 'user');
          const title = firstUserMsg ? (firstUserMsg.content.slice(0, 30) + (firstUserMsg.content.length > 30 ? '...' : '')) : (t('chat.untitledChat') || 'New Conversation');
          
          const legacyConv = {
            id: legacyId,
            title: title,
            created: new Date().toISOString(),
            lastModified: new Date().toISOString()
          };
          this.conversations.push(legacyConv);
          this.currentConversationId = legacyId;
          
          localStorage.setItem('secretary_conv_messages_' + legacyId, JSON.stringify(legacyMessages));
          // Migrate any current attachments
          localStorage.setItem('secretary_conv_notes_' + legacyId, JSON.stringify(this.attachedNotes || []));
          localStorage.setItem('secretary_conv_tasks_' + legacyId, JSON.stringify(this.attachedTasks || []));
          this.saveConversationsList();
        }
      } catch (e) {
        console.warn('Failed legacy chat migration', e);
      }
    }

    // Ensure we have at least one active conversation
    if (this.conversations.length === 0) {
      this.newConversation(false);
    } else if (!this.currentConversationId || !this.conversations.some(c => c.id === this.currentConversationId)) {
      this.currentConversationId = this.conversations[0] ? this.conversations[0].id : '';
    }

    // Load active conversation messages and attachments
    const id = this.currentConversationId;
    if (id) {
      try {
        this.messages = JSON.parse(localStorage.getItem('secretary_conv_messages_' + id) || '[]');
      } catch (e) {
        this.messages = [];
      }
      try {
        this.attachedNotes = JSON.parse(localStorage.getItem('secretary_conv_notes_' + id) || '[]');
      } catch (e) {
        this.attachedNotes = [];
      }
      try {
        this.attachedTasks = JSON.parse(localStorage.getItem('secretary_conv_tasks_' + id) || '[]');
      } catch (e) {
        this.attachedTasks = [];
      }
      try {
        this.attachedEvents = JSON.parse(localStorage.getItem('secretary_conv_events_' + id) || '[]');
      } catch (e) {
        this.attachedEvents = [];
      }
    } else {
      this.messages = [];
      this.attachedNotes = [];
      this.attachedTasks = [];
      this.attachedEvents = [];
    }
  },

  render() {
    let panel = document.getElementById('floating-chat-body');
    if (!panel || panel.style.display === 'none') {
      panel = document.getElementById('chat-panel');
    }
    if (!panel) return;

    if (typeof LLMService !== 'undefined' && typeof LLMService.isSetup === 'function' ? !LLMService.isSetup() : !LLMService.isEnabled()) {
      panel.innerHTML = this.renderOnboardingHTML();
      return;
    }

    const currentConv = this.conversations.find(c => c.id === this.currentConversationId);
    const convTitle = currentConv ? currentConv.title : (t('chat.untitledChat') || 'New Conversation');

    const leftCollapsed = this.leftSidebarCollapsed;
    const rightCollapsed = this.rightSidebarCollapsed;
    const leftWidth = this.leftSidebarWidth || 260;
    const rightWidth = this.rightSidebarWidth || 240;

    panel.innerHTML = `
      <!-- Column 1: Conversations History Left Sidebar -->
      <div class="chat-history-sidebar collapsible-sidebar ${leftCollapsed ? 'collapsed' : ''}" id="chat-history-sidebar" style="${leftCollapsed ? '' : `width:${leftWidth}px; min-width:180px; max-width:${Math.max(leftWidth, 600)}px;`}" onclick="${leftCollapsed ? 'AIChatController.toggleLeftSidebar(event)' : ''}" title="${escA(leftCollapsed ? (t('common.expandSidebar') || 'Click to expand sidebar') : '')}">
        <div class="collab-sidebar-toggle-header" onclick="AIChatController.toggleLeftSidebar(event)" title="${escA(leftCollapsed ? (t('common.expandSidebar') || 'Click to expand sidebar') : (t('common.collapseSidebar') || 'Click to collapse sidebar'))}">
          <span class="collab-sidebar-toggle-label">${escH(t('chat.historySidebarTitle') || 'History')}</span>
          <span class="collab-sidebar-toggle-chevron">${leftCollapsed ? '›' : '‹'}</span>
        </div>
        <div class="chat-sidebar-content" onclick="event.stopPropagation()">
          <button class="btn btn-primary new-chat-btn" onclick="AIChatController.newConversation()">
            ➕ ${escH(t('chat.newConversation') || 'New Chat')}
          </button>
          <div class="chat-history-search-wrap">
            <input 
              type="text" 
              id="chat-history-search-input" 
              class="prefs-input chat-history-search-input" 
              placeholder="${escA(t('chat.searchConversations') || 'Search chats...')}"
              value="${escA(this.historySearchQuery || '')}"
              oninput="AIChatController.handleHistorySearch(event)"
            >
          </div>
          <div class="chat-history-list" id="chat-history-list">
            <!-- Rendered by renderHistoryList() -->
          </div>
        </div>
      </div>

      <!-- Left Resize Handle -->
      <div class="chat-sidebar-resize-handle history-resize-handle ${leftCollapsed ? 'collapsed-handle' : ''}" id="chat-history-resize-handle" title="${escA(t('chat.resizeHistorySidebarTooltip') || 'Resize conversation history')}"></div>

      <!-- Column 2: Chat Main Workspace -->
      <div class="chat-main" id="chat-main-workspace">
        <div class="chat-header">
          <div class="chat-header-left">
            <button class="chat-history-toggle-btn btn" onclick="AIChatController.toggleLeftSidebar(event)" title="${escA(t('chat.historySidebarTitle') || 'History')}" style="padding:.2rem .4rem; margin-right:4px;">📜</button>
            <h2 style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:400px;" title="${escA(convTitle)}">💬 ${escH(convTitle)}</h2>
            <button class="chat-header-title-edit-btn" onclick="AIChatController.promptRenameConversation('${escA(this.currentConversationId)}')" title="${escA(t('chat.renameChatTooltip') || 'Rename')}">✏️</button>
          </div>
          <button class="btn" style="padding:.3rem .7rem; font-size:.78rem;" onclick="AIChatController.clearChat()" title="${escA(t('chat.clearTooltip') || 'Open a new chat (current chat is saved to history)')}">
            ➕ ${escH(t('chat.newConversation') || 'New Chat')}
          </button>
        </div>

        <div class="chat-messages" id="chat-messages-container">
          <!-- Rendered by renderMessages() -->
        </div>

        <div class="chat-input-wrap">
          <div class="chat-autocomplete-popup" id="chat-autocomplete-popup" style="display:none;">
            <!-- Rendered dynamically -->
          </div>
          <div class="chat-questions-popup" id="chat-questions-popup" style="display:none;">
            <!-- Rendered dynamically -->
          </div>
          <div class="chat-input-container">
            <div class="chat-input-top-bar">
              <!-- + Context Native Select Dropdown -->
              <div class="chat-input-context-select-wrap">
                <span class="chat-context-label">${escH(t('chat.addContext') || 'Context')}</span>
                <select class="chat-context-select" onchange="AIChatController.handleContextSelectChange(this)" title="${escA(t('chat.addContext') || 'Add context')}">
                  <option value="" disabled selected>➕ Add</option>
                  <option value="notes">📝 ${escH(t('chat.attachNote') || 'Attach Note')}</option>
                  <option value="tasks">📋 ${escH(t('chat.attachTask') || 'Attach Task')}</option>
                  <option value="events">📅 ${escH(t('chat.attachEvent') || 'Attach Event')}</option>
                  <option value="decisions">⚖️ ${escH(t('chat.attachDecision') || 'Attach Decision')}</option>
                </select>
              </div>
              <!-- Attached context chips (on the right) -->
              <div class="chat-input-attachments" id="chat-attachments-container"></div>
            </div>

            <textarea 
              id="chat-input-textarea" 
              class="chat-textarea" 
              placeholder="${escA(t('chat.placeholder') || 'Ask anything to the AI...')}"
              oninput="AIChatController.handleInput(event)"
              onkeydown="AIChatController.handleKeyDown(event)"
              onblur="setTimeout(() => AIChatController.closeAutocomplete(), 200)"
            ></textarea>

            <div class="chat-input-bottom-bar">
              <!-- Effort Native Select on bottom left of bottom row -->
              <div class="chat-input-effort-select-wrap" id="chat-effort-select-wrap">
                <span class="chat-effort-label">Effort</span>
                <select id="chat-thinking-effort-select" class="chat-effort-select" onchange="setPromptThinkingEffort('chat', this.value)"></select>
              </div>

              <button 
                id="chat-send-btn" 
                class="chat-send-btn" 
                onclick="AIChatController.submitMessage()"
                title="${escA(t('chat.send') || 'Send')}"
              >
                ✈️
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Right Resize Handle -->
      <div class="chat-sidebar-resize-handle commands-resize-handle ${rightCollapsed ? 'collapsed-handle' : ''}" id="chat-commands-resize-handle" title="${escA(t('chat.resizeCommandsSidebarTooltip') || 'Resize quick commands')}"></div>

      <!-- Column 3: Context Actions Sidebar -->
      <div class="chat-sidebar collapsible-sidebar ${rightCollapsed ? 'collapsed' : ''}" id="chat-commands-sidebar" style="${rightCollapsed ? '' : `width:${rightWidth}px; min-width:180px; max-width:${Math.max(rightWidth, 600)}px;`}" onclick="${rightCollapsed ? 'AIChatController.toggleRightSidebar(event)' : ''}" title="${escA(rightCollapsed ? (t('common.expandSidebar') || 'Click to expand sidebar') : '')}">
        <div class="collab-sidebar-toggle-header" onclick="AIChatController.toggleRightSidebar(event)" title="${escA(rightCollapsed ? (t('common.expandSidebar') || 'Click to expand sidebar') : (t('common.collapseSidebar') || 'Click to collapse sidebar'))}">
          <span class="collab-sidebar-toggle-label">${escH(t('chat.quickCommands') || 'Quick Commands')}</span>
          <span class="collab-sidebar-toggle-chevron">${rightCollapsed ? '‹' : '›'}</span>
        </div>
        <div class="chat-sidebar-content" onclick="event.stopPropagation()">
          <!-- Section 1: Notes & Decisions -->
          <div class="chat-sidebar-section">
            <h3 style="font-size:0.75rem; text-transform:uppercase; letter-spacing:0.5px; opacity:0.75; margin-bottom:6px;">📝 ${escH(t('chat.notesTab') || 'Notes')} & ⚖️ ${escH(t('chat.decisionsTab') || 'Decisions')}</h3>
            <button class="chat-sidebar-btn" data-cmd="search-notes" onclick="AIChatController.triggerQuickCommand('search-notes')" title="${escA(t('chat.cmdSearchNotesTooltip') || 'Search across notes')}">
              🔍 ${escH(t('chat.cmdSearchNotes') || 'Search Notes')}
            </button>
            <button class="chat-sidebar-btn" data-cmd="find-decisions" onclick="AIChatController.triggerQuickCommand('find-decisions')" title="${escA(t('chat.cmdFindDecisionsTooltip') || 'Find decisions')}">
              ⚖️ ${escH(t('chat.cmdFindDecisions') || 'Find Decisions')}
            </button>
            <button class="chat-sidebar-btn" data-cmd="review-notes" onclick="AIChatController.triggerQuickCommand('review-notes')" title="${escA(t('chat.cmdReviewNotesTooltip') || 'Review unreviewed notes')}">
              📋 ${escH(t('chat.cmdReviewNotes') || 'Review Notes')}
            </button>
          </div>

          <!-- Section 2: Tasks & Agenda -->
          <div class="chat-sidebar-section">
            <h3 style="font-size:0.75rem; text-transform:uppercase; letter-spacing:0.5px; opacity:0.75; margin-bottom:6px;">📋 ${escH(t('chat.tasksTab') || 'Tasks')} & 📅 ${escH(t('chat.eventsTab') || 'Events')}</h3>
            <button class="chat-sidebar-btn" data-cmd="list-tasks" onclick="AIChatController.triggerQuickCommand('list-tasks')" title="${escA(t('chat.cmdListTasksTooltip') || 'List pending tasks')}">
              ✅ ${escH(t('chat.cmdListTasks') || 'Pending Tasks')}
            </button>
            <button class="chat-sidebar-btn" data-cmd="create-task" onclick="AIChatController.triggerQuickCommand('create-task')" title="${escA(t('chat.cmdCreateTaskTooltip') || 'Create new task')}">
              ➕ ${escH(t('chat.cmdCreateTask') || 'Create Task')}
            </button>
            <button class="chat-sidebar-btn" data-cmd="check-schedule" onclick="AIChatController.triggerQuickCommand('check-schedule')" title="${escA(t('chat.cmdCheckScheduleTooltip') || 'Check schedule')}">
              📅 ${escH(t('chat.cmdCheckSchedule') || 'Check Schedule')}
            </button>
            <button class="chat-sidebar-btn" data-cmd="schedule-meeting" onclick="AIChatController.triggerQuickCommand('schedule-meeting')" title="${escA(t('chat.cmdScheduleMeetingTooltip') || 'Schedule meeting')}">
              🤝 ${escH(t('chat.cmdScheduleMeeting') || 'Schedule Meeting')}
            </button>
          </div>

          <!-- Section 3: Team & Workstreams -->
          <div class="chat-sidebar-section">
            <h3 style="font-size:0.75rem; text-transform:uppercase; letter-spacing:0.5px; opacity:0.75; margin-bottom:6px;">👥 ${escH(t('chat.cmdSearchColleagues') || 'Team')} & 🌊 ${escH(t('chat.cmdExploreWorkstreams') || 'Workstreams')}</h3>
            <button class="chat-sidebar-btn" data-cmd="search-colleagues" onclick="AIChatController.triggerQuickCommand('search-colleagues')" title="${escA(t('chat.cmdSearchColleaguesTooltip') || 'Search colleagues and org')}">
              👥 ${escH(t('chat.cmdSearchColleagues') || 'Colleagues & Org')}
            </button>
            <button class="chat-sidebar-btn" data-cmd="explore-workstreams" onclick="AIChatController.triggerQuickCommand('explore-workstreams')" title="${escA(t('chat.cmdExploreWorkstreamsTooltip') || 'Explore active workstreams')}">
              🌊 ${escH(t('chat.cmdExploreWorkstreams') || 'Explore Workstreams')}
            </button>
            <button class="chat-sidebar-btn" data-cmd="synthesize-memory" onclick="AIChatController.triggerQuickCommand('synthesize-memory')" title="${escA(t('chat.cmdSynthesizeMemoryTooltip') || 'Synthesize workstream memory')}">
              🧠 ${escH(t('chat.cmdSynthesizeMemory') || 'Synthesize Memory')}
            </button>
          </div>

          <!-- Section 4: Reports & Summaries -->
          <div class="chat-sidebar-section">
            <h3 style="font-size:0.75rem; text-transform:uppercase; letter-spacing:0.5px; opacity:0.75; margin-bottom:6px;">📊 ${escH(t('chat.quickCommands') || 'Reports')}</h3>
            <button class="chat-sidebar-btn" data-cmd="summarize-3" onclick="AIChatController.triggerQuickCommand('summarize-3')" title="${escA(t('chat.cmdSummarize3') || 'Summarize Last 3 Days')}">
              📅 ${escH(t('chat.cmdSummarize3') || 'Summarize 3 Days')}
            </button>
            <button class="chat-sidebar-btn" data-cmd="summarize-7" onclick="AIChatController.triggerQuickCommand('summarize-7')" title="${escA(t('chat.cmdSummarize7') || 'Summarize Last 7 Days')}">
              📅 ${escH(t('chat.cmdSummarize7') || 'Summarize 7 Days')}
            </button>
            <button class="chat-sidebar-btn" data-cmd="prep-call" onclick="AIChatController.triggerQuickCommand('prep-call')" title="${escA(t('chat.cmdPrepCall') || 'Prepare Meeting Call')}">
              📞 ${escH(t('chat.cmdPrepCall') || 'Prepare Call')}
            </button>
            <button class="chat-sidebar-btn" data-cmd="weekly-report" onclick="AIChatController.triggerQuickCommand('weekly-report')" title="${escA(t('chat.cmdWeeklyReport') || 'Draft Weekly Report')}">
              📊 ${escH(t('chat.cmdWeeklyReport') || 'Weekly Report')}
            </button>
          </div>
        </div>
      </div>
    `;

    this.renderHistoryList();
    this.renderMessages();
    this.renderAttachments();
    this.syncThinkingControls();
    this.bindResizeHandles();
  },

  bindResizeHandles() {
    const leftHandle = document.getElementById('chat-history-resize-handle');
    const leftSidebar = document.getElementById('chat-history-sidebar');
    const rightHandle = document.getElementById('chat-commands-resize-handle');
    const rightSidebar = document.getElementById('chat-commands-sidebar');
    const container = document.getElementById('floating-chat-body') || document.getElementById('chat-panel');

    if (leftHandle && leftSidebar && container) {
      leftHandle.onmousedown = (e) => {
        if (this.leftSidebarCollapsed) return;
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startWidth = this.leftSidebarWidth || leftSidebar.getBoundingClientRect().width;
        leftHandle.classList.add('dragging');
        document.body.classList.add('chat-history-resizing');

        const onMouseMove = (moveEvent) => {
          const containerRect = container.getBoundingClientRect();
          const containerW = (containerRect && containerRect.width > 0) ? containerRect.width : 1000;
          const rightRect = rightSidebar ? rightSidebar.getBoundingClientRect() : null;
          const otherW = (rightRect && rightRect.width > 0)
            ? rightRect.width
            : (this.rightSidebarCollapsed ? 36 : (this.rightSidebarWidth || 240));
          const minMainW = 160;
          const minW = 180;
          const maxAvailable = Math.floor(containerW - otherW - minMainW - 32);
          const maxW = Math.max(minW, Math.min(600, maxAvailable));
          const nextWidth = Math.max(minW, Math.min(maxW, startWidth + (moveEvent.clientX - startX)));
          this.leftSidebarWidth = Math.round(nextWidth);
          leftSidebar.style.width = `${this.leftSidebarWidth}px`;
          leftSidebar.style.minWidth = `${minW}px`;
          leftSidebar.style.maxWidth = `${Math.max(this.leftSidebarWidth, 600)}px`;
        };

        const onMouseUp = () => {
          leftHandle.classList.remove('dragging');
          document.body.classList.remove('chat-history-resizing');
          window.removeEventListener('mousemove', onMouseMove);
          window.removeEventListener('mouseup', onMouseUp);
          try {
            localStorage.setItem('secretaryChatHistoryPaneWidth', String(this.leftSidebarWidth));
          } catch (err) {}
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
      };
    }

    if (rightHandle && rightSidebar && container) {
      rightHandle.onmousedown = (e) => {
        if (this.rightSidebarCollapsed) return;
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startWidth = this.rightSidebarWidth || rightSidebar.getBoundingClientRect().width;
        rightHandle.classList.add('dragging');
        document.body.classList.add('chat-commands-resizing');

        const onMouseMove = (moveEvent) => {
          const containerRect = container.getBoundingClientRect();
          const containerW = (containerRect && containerRect.width > 0) ? containerRect.width : 1000;
          const leftRect = leftSidebar ? leftSidebar.getBoundingClientRect() : null;
          const otherW = (leftRect && leftRect.width > 0)
            ? leftRect.width
            : (this.leftSidebarCollapsed ? 36 : (this.leftSidebarWidth || 260));
          const minMainW = 160;
          const minW = 180;
          const maxAvailable = Math.floor(containerW - otherW - minMainW - 32);
          const maxW = Math.max(minW, Math.min(600, maxAvailable));
          const nextWidth = Math.max(minW, Math.min(maxW, startWidth - (moveEvent.clientX - startX)));
          this.rightSidebarWidth = Math.round(nextWidth);
          rightSidebar.style.width = `${this.rightSidebarWidth}px`;
          rightSidebar.style.minWidth = `${minW}px`;
          rightSidebar.style.maxWidth = `${Math.max(this.rightSidebarWidth, 600)}px`;
        };

        const onMouseUp = () => {
          rightHandle.classList.remove('dragging');
          document.body.classList.remove('chat-commands-resizing');
          window.removeEventListener('mousemove', onMouseMove);
          window.removeEventListener('mouseup', onMouseUp);
          try {
            localStorage.setItem('secretaryChatCommandsPaneWidth', String(this.rightSidebarWidth));
          } catch (err) {}
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
      };
    }
  },

  syncThinkingControls() {
    const effortSelect = document.getElementById('chat-thinking-effort-select');
    const supportsEffort = typeof supportsThinkingEffort === 'function' ? supportsThinkingEffort() : true;
    const wrap = document.getElementById('chat-effort-select-wrap');
    if (wrap) {
      wrap.style.display = supportsEffort ? 'inline-block' : 'none';
    }
    if (effortSelect && typeof populateThinkingEffortSelect === 'function' && supportsEffort) {
      const scopeKey = typeof getPromptThinkingEffortScopeKeyForChat === 'function'
        ? getPromptThinkingEffortScopeKeyForChat(this.currentConversationId)
        : `chat:${this.currentConversationId || 'global'}`;
      populateThinkingEffortSelect(effortSelect, scopeKey, 'high');
      effortSelect.value = typeof getStoredPromptThinkingEffort === 'function'
        ? getStoredPromptThinkingEffort(scopeKey, 'high')
        : effortSelect.value;
    }

    const sendBtn = document.getElementById('chat-send-btn');
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.textContent = this.isThinking ? (t('llm.stop') || 'Stop') : (t('chat.send') || 'Send');
      sendBtn.onclick = this.isThinking ? () => this.stopCurrentRequest() : () => this.submitMessage();
    }
  },

  stopCurrentRequest() {
    if (!this.currentRequestController) return;
    this.thinkingMessage = t('chat.stopping') || 'Stopping...';
    this.syncThinkingControls();
    this.renderMessages();
    try {
      this.currentRequestController.abort();
    } catch (e) {
      console.warn('Could not abort active chat request', e);
    }
  },

  toggleLeftSidebar(event) {
    if (event) {
      event.stopPropagation();
    }
    this.leftSidebarCollapsed = !this.leftSidebarCollapsed;
    try {
      localStorage.setItem('secretaryChatLeftSidebarCollapsed', this.leftSidebarCollapsed ? '1' : '0');
    } catch (e) {}
    this.render();
  },

  toggleRightSidebar(event) {
    if (event) {
      event.stopPropagation();
    }
    this.rightSidebarCollapsed = !this.rightSidebarCollapsed;
    try {
      localStorage.setItem('secretaryChatRightSidebarCollapsed', this.rightSidebarCollapsed ? '1' : '0');
    } catch (e) {}
    this.render();
  },

  handleContextSelectChange(select) {
    const val = select.value;
    if (!val) return;
    select.value = "";
    this.openAttachModal(val);
  },

  renderOnboardingHTML(customTitle) {
    return renderAiOnboardingHTML(customTitle);
  },

  showAgentGuide() {
    let guideModal = document.getElementById('agent-guided-tour-modal');
    if (guideModal) {
      guideModal.remove();
      return;
    }
    guideModal = document.createElement('div');
    guideModal.id = 'agent-guided-tour-modal';
    guideModal.className = 'agent-guide-card';
    
    const title = (typeof t === 'function' && t('tutorial.agentGuide.title')) || '🤖 How to Use Your AI Assistant';
    const subtitle = (typeof t === 'function' && t('tutorial.agentGuide.subtitle')) || 'Privacy-first intelligence in your workspace';
    const tipContext = (typeof t === 'function' && t('tutorial.agentGuide.tipContext')) || '📎 Attach Context: Type "@" or click the attachment icon to include notes, tasks, or calendar events.';
    const tipPrompts = (typeof t === 'function' && t('tutorial.agentGuide.tipPrompts')) || '⚡ Quick Prompts: Click prompt pills to summarize today\'s work, extract decisions, or write meeting notes.';
    const tipTools = (typeof t === 'function' && t('tutorial.agentGuide.tipTools')) || '🛠️ Agentic Actions: The assistant can search notes, create tasks, and schedule events directly on disk.';

    guideModal.innerHTML = `
      <div class="agent-guide-header">
        <div>
          <h4 class="agent-guide-title">${escH(title)}</h4>
          <span class="agent-guide-sub">${escH(subtitle)}</span>
        </div>
        <button class="agent-guide-close" onclick="document.getElementById('agent-guided-tour-modal')?.remove()" aria-label="Close">✕</button>
      </div>
      <div class="agent-guide-body">
        <div class="agent-guide-tip">${tipContext}</div>
        <div class="agent-guide-tip">${tipPrompts}</div>
        <div class="agent-guide-tip">${tipTools}</div>
      </div>
      <div class="agent-guide-footer">
        <button class="btn btn-primary" style="width:100%" onclick="document.getElementById('agent-guided-tour-modal')?.remove(); try { localStorage.setItem('secretary_agent_guided_seen', 'true'); } catch(e){}">Got it!</button>
      </div>
    `;

    const chatBody = document.getElementById('floating-chat-body') || document.getElementById('chat-messages-container');
    if (chatBody) {
      chatBody.prepend(guideModal);
    }
  },

  popoutToWindow() {
    if (window.AppBridge?.chatWindow) {
      window.AppBridge.chatWindow.open();
      const floating = document.getElementById('floating-secretary-chat');
      if (floating && !document.body.classList.contains('chat-window-mode')) {
        floating.classList.remove('is-open');
      }
    }
  },

  renderMessages() {
    const container = document.getElementById('chat-messages-container');
    if (!container) return;

    if (this.messages.length === 0) {
      container.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:center; height:100%; color:var(--text-muted); font-size:var(--font-size-ui);">
          ${escH(t('chat.noMessagesYet') || 'No messages yet. Ask Secretary anything!')}
        </div>
      `;
      return;
    }

    let html = '';
    this.messages.forEach((msg, idx) => {
      const contentStr = String(msg.content || '');
      if (msg.role === 'system') return; // Hide internal system prompts
      if (msg.role === 'user' && contentStr.startsWith('[SYSTEM]')) return; // Hide internal tool responses

      const isUser = msg.role === 'user';
      const bubbleClass = isUser ? 'user' : 'assistant';
      const senderName = isUser ? (t('chat.you') || 'You') : (t('chat.assistant') || 'Assistant');
      
      let bodyHTML = '';
      if (isUser) {
        bodyHTML = escH(contentStr).replace(/\n/g, '<br>');
      } else {
        // Parse markdown & format tool calls & thinking accordion for assistant replies
        bodyHTML = this.formatToolCallsToHTML(contentStr, msg.thoughtLogs || msg.reasoningText);
        
        // Append execution suggestion cards if available
        if (msg.parsed && Array.isArray(msg.parsed.suggested_actions)) {
          bodyHTML += this.renderSuggestionCardsHTML(msg.parsed.suggested_actions, idx);
        }
      }

      let copyButtonHTML = '';
      if (!isUser) {
        const copySvg = (typeof AppIcons !== 'undefined' && typeof AppIcons.get === 'function')
          ? AppIcons.get('copy', { size: 14 })
          : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
        copyButtonHTML = `
          <button class="chat-msg-copy-btn" onclick="AIChatController.copyMessageText(this, ${idx})" title="${escA(t('common.copy') || 'Copy response')}">
            ${copySvg}
          </button>
        `;
      }

      html += `
        <div class="chat-message-bubble ${bubbleClass}">
          <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.75rem; font-weight:600; margin-bottom:6px; opacity:0.8;">
            <span>${escH(senderName)}</span>
            ${copyButtonHTML}
          </div>
          <div class="chat-message-body">${bodyHTML}</div>
          <span class="chat-message-time">${escH(msg.date || '')}</span>
        </div>
      `;
    });

    if (this.isThinking) {
      const botSvg = (typeof AppIcons !== 'undefined' && typeof AppIcons.get === 'function')
        ? AppIcons.get('bot', { size: 14 })
        : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/></svg>`;
      html += `
        <div class="chat-thinking">
          <div class="chat-thinking-indicator">
            <span style="display:inline-flex; align-items:center; gap:4px;">${botSvg} ${escH(t('chat.assistant') || 'Assistant')}</span>
            <div class="chat-thinking-dots">
              <span>.</span><span>.</span><span>.</span>
            </div>
          </div>
          ${this.thinkingMessage ? `<div class="chat-thinking-subtext">${escH(this.thinkingMessage)}</div>` : ''}
        </div>
      `;
    }

    container.innerHTML = html;
    container.scrollTop = container.scrollHeight;

    if (!container._chatDelegatedClicksBound) {
      container._chatDelegatedClicksBound = true;
      container.addEventListener('click', (e) => {
        const noteLink = e.target.closest('.chat-note-link');
        if (noteLink) {
          e.preventDefault();
          e.stopPropagation();
          const notePath = noteLink.getAttribute('data-note-path');
          const noteTitle = noteLink.getAttribute('data-note-title') || noteLink.textContent;
          AIChatController.openNoteFromChat(notePath, noteTitle);
          return;
        }

        const todoLink = e.target.closest('.chat-todo-link');
        if (todoLink) {
          e.preventDefault();
          e.stopPropagation();
          const todoId = todoLink.getAttribute('data-todo-id');
          AIChatController.openTodoFromChat(todoId);
          return;
        }

        const decisionChip = e.target.closest('.chat-decision-chip');
        if (decisionChip) {
          e.preventDefault();
          e.stopPropagation();
          const decisionText = decisionChip.getAttribute('data-decision-text');
          AIChatController.openDecisionFromChat(decisionText);
          return;
        }
      });
    }
  },

  formatToolCallsToHTML(text, extraThoughtLogs = '') {
    let rawText = String(text || '').trim();
    let thinkingHTML = '';

    if (typeof LLMService !== 'undefined' && typeof LLMService.extractReasoningAndContent === 'function') {
      const extracted = LLMService.extractReasoningAndContent(rawText);
      let combinedReasoning = extracted.reasoningText;
      const logsStr = Array.isArray(extraThoughtLogs) ? extraThoughtLogs.join('\n') : String(extraThoughtLogs || '').trim();
      if (logsStr) {
        combinedReasoning = (combinedReasoning ? combinedReasoning + '\n\n' : '') + logsStr;
      }
      if (combinedReasoning) {
        thinkingHTML = LLMService.renderThinkingAccordionHTML(combinedReasoning);
        rawText = extracted.cleanContent;
      }
    }

    let result = rawText;
    if (!result && thinkingHTML) return thinkingHTML;
    if (!result) return '';
    const placeholders = [];

    const addPlaceholder = (action, propsJson) => {
      const idx = placeholders.length;
      let formattedProps = propsJson;
      if (typeof formattedProps === 'object' && formattedProps !== null) {
        formattedProps = JSON.stringify(formattedProps, null, 2);
      } else if (typeof formattedProps === 'string') {
        try {
          const parsed = JSON.parse(formattedProps);
          formattedProps = JSON.stringify(parsed, null, 2);
        } catch (e) {}
      }
      const label = t('chat.tool') || 'Tool';
      const wrenchSvg = (typeof AppIcons !== 'undefined' && typeof AppIcons.get === 'function')
        ? AppIcons.get('wrench', { size: 14 })
        : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`;
      placeholders.push(`
        <div class="chat-tool-call-block">
          <div><span class="chat-tool-call-icon">${wrenchSvg}</span> <span class="chat-tool-call-action">${escH(label)}: <strong>${escH(action)}</strong></span></div>
          <pre class="chat-tool-call-props">${escH(String(formattedProps || '').trim())}</pre>
        </div>
      `);
      return `__TOOL_CALL_PLACEHOLDER_${idx}__`;
    };

    // 1. Tag based: <|tool_call|>: ... or <tool_call>...</tool_call> or <|toolcall|>: ... or <|tool_call>...<tool_call|>
    const tagRegex = /<\|?tool_?call\|?>:?\s*([\s\S]*?)(?:<\|?\/?tool_?call\|?>|$)/gi;
    result = result.replace(tagRegex, (match, content) => {
      let trimmed = String(content || '').trim();
      if (!trimmed) return '';

      const callSyntax = /^call:([a-zA-Z0-9_]+)\s*([{\(][\s\S]*[}\)])/i.exec(trimmed);
      if (callSyntax) {
        return addPlaceholder(callSyntax[1], callSyntax[2]);
      }

      if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
        trimmed = '{' + trimmed.slice(1, -1) + '}';
      }

      try {
        const cleanJson = trimmed.replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":');
        const parsed = JSON.parse(cleanJson);
        if (Array.isArray(parsed)) {
          return parsed.map(p => {
            const action = p.action || p.name || p.function?.name || 'tool';
            const props = p.properties || p.arguments || p.parameters || p.props || p;
            return addPlaceholder(action, props);
          }).join('\n');
        }
        const action = parsed.action || parsed.name || parsed.function?.name || 'tool';
        const props = parsed.properties || parsed.arguments || parsed.parameters || parsed.props || parsed;
        return addPlaceholder(action, props);
      } catch (e) {
        return addPlaceholder('tool', trimmed);
      }
    });

    // 2. [TOOL_CALLS] block
    result = result.replace(/\[TOOL_CALLS\]\s*(\[[\s\S]*?\]|\{[\s\S]*?\})/gi, (match, jsonStr) => {
      try {
        const parsed = JSON.parse(jsonStr);
        if (Array.isArray(parsed)) {
          return parsed.map(p => {
            const action = p.action || p.name || p.function?.name || 'tool';
            const props = p.properties || p.arguments || p.parameters || p;
            return addPlaceholder(action, props);
          }).join('\n');
        } else {
          const action = parsed.action || parsed.name || parsed.function?.name || 'tool';
          const props = parsed.properties || parsed.arguments || parsed.parameters || parsed;
          return addPlaceholder(action, props);
        }
      } catch (e) {
        return addPlaceholder('tool', jsonStr);
      }
    });

    // 3. Standalone call:toolName{...} or call:toolName(...)
    result = result.replace(/call:([a-zA-Z0-9_]+)\s*([{\(][\s\S]*?[}\)])/gi, (match, action, props) => {
      return addPlaceholder(action, props);
    });

    // Parse markdown (safe fallback if marked is not available)
    let bodyHTML = (typeof marked !== 'undefined' && typeof marked.parse === 'function')
      ? marked.parse(typeof preprocessLatexMath === 'function' ? preprocessLatexMath(result) : result)
      : (typeof preprocessLatexMath === 'function' ? preprocessLatexMath(result) : result);

    // Linkify Notes in HTML and markdown
    bodyHTML = bodyHTML.replace(/<a\s+([^>]*?)href=["'](notes\/[^"']+|note:[^"']+)["']([^>]*?)>(.*?)<\/a>/gi, (match, pre, href, post, text) => {
      const cleanPath = href.replace(/^note:/i, '');
      return `<a href="#" class="chat-item-link chat-note-link" data-note-path="${escA(cleanPath)}" data-note-title="${escA(text)}" title="${escA(t('chat.openNoteTooltip') || 'Open note in editor')}">📝 ${text} ↗</a>`;
    });
    bodyHTML = bodyHTML.replace(/\[([^\]]+)\]\((?:notes\/|note:)([^\)\s]+)\)/g, (match, title, path) => {
      const fullPath = path.startsWith('notes/') ? path : `notes/${path}`;
      return `<a href="#" class="chat-item-link chat-note-link" data-note-path="${escA(fullPath)}" data-note-title="${escA(title)}" title="${escA(t('chat.openNoteTooltip') || 'Open note in editor')}">📝 ${escH(title)} ↗</a>`;
    });

    // Linkify Tasks / Todos
    bodyHTML = bodyHTML.replace(/(?:#todo:([a-zA-Z0-9_-]+)|todo-([a-zA-Z0-9_-]+))/g, (match, id1, id2) => {
      const id = id1 || id2;
      const todoId = `todo-${id.replace(/^todo-/, '')}`;
      return `<a href="#" class="chat-item-link chat-todo-link" data-todo-id="${escA(todoId)}" title="${escA(t('chat.openTaskTooltip') || 'Open task details')}">📋 ${escH(match)} ↗</a>`;
    });

    // Linkify Decisions: !decision:active ... or !decision:proposed ... or !decision:superseded ...
    bodyHTML = bodyHTML.replace(/!decision:(active|proposed|superseded)\s+([^\n\r<]+)/gi, (match, status, decText) => {
      const cleanDec = decText.trim();
      const statusClass = status.toLowerCase();
      return `<span class="chat-decision-chip pill-decision pill-decision-${statusClass}" data-decision-status="${escA(statusClass)}" data-decision-text="${escA(cleanDec)}" title="${escA(t('chat.openDecisionNoteTooltip') || 'Open note containing this decision')}" role="button" tabindex="0">⚖️ <span class="decision-status-tag">!decision:${statusClass}</span> <span class="decision-content-text">${escH(cleanDec)}</span> ↗</span>`;
    });

    // Restore placeholders
    placeholders.forEach((htmlBlock, idx) => {
      bodyHTML = bodyHTML.replace(`<p>__TOOL_CALL_PLACEHOLDER_${idx}__</p>`, htmlBlock);
      bodyHTML = bodyHTML.replace(`__TOOL_CALL_PLACEHOLDER_${idx}__`, htmlBlock);
    });

    return thinkingHTML + bodyHTML;
  },

  extractToolRequests(response) {
    if (!response) return [];
    const requests = [];

    const canonicalToolMap = {
      'find_relevant_notes': 'find_relevant_notes',
      'search_relevant_notes': 'find_relevant_notes',
      'get_relevant_notes': 'find_relevant_notes',
      'retrieve_relevant_notes': 'find_relevant_notes',
      'get_planner_events': 'get_planner_events',
      'get_events': 'get_planner_events',
      'get_planner': 'get_planner_events',
      'planner_events': 'get_planner_events',
      'list_events': 'get_planner_events',
      'get_note_content': 'get_note_content',
      'read_note': 'get_note_content',
      'get_note': 'get_note_content',
      'read_note_content': 'get_note_content',
      'get_tasks': 'get_tasks',
      'get_todos': 'get_tasks',
      'list_tasks': 'get_tasks',
      'list_todos': 'get_tasks',
      'search_notes': 'search_notes',
      'find_notes': 'search_notes',
      'query_notes': 'search_notes',
      'get_colleague_org_relationship': 'get_colleague_org_relationship',
      'get_colleague_relationship': 'get_colleague_org_relationship',
      'get_colleague_org': 'get_colleague_org_relationship',
      'get_org_relationship': 'get_colleague_org_relationship',
      'colleague_org_relationship': 'get_colleague_org_relationship',
      'mark_note_reviewed': 'mark_note_reviewed',
      'set_note_reviewed': 'mark_note_reviewed',
      'review_note': 'mark_note_reviewed',
      'search_colleagues': 'search_colleagues',
      'find_colleagues': 'search_colleagues',
      'get_colleagues': 'search_colleagues',
      'search_colleague': 'search_colleagues',
      'find_colleague': 'search_colleagues',
      'list_colleagues': 'search_colleagues',
      'colleagues': 'search_colleagues',
      'colleague_search': 'search_colleagues',
      'get_workstream_catalog': 'get_workstream_catalog',
      'list_workstreams': 'get_workstream_catalog',
      'get_workstreams': 'get_workstream_catalog',
      'get_workstream_memory': 'get_workstream_memory',
      'read_workstream_memory': 'get_workstream_memory',
      'get_topic_memory': 'get_workstream_memory',
      'search_workstream_memories': 'search_workstream_memories',
      'find_workstream_memories': 'search_workstream_memories',
      'synthesize_workstream_memory': 'synthesize_workstream_memory',
      'generate_workstream_memory': 'synthesize_workstream_memory'
    };

    const normalizeToolItem = (item) => {
      if (!item || typeof item !== 'object') return null;
      const rawName = String(
        item.action ||
        item.name ||
        item.function?.name ||
        item.tool ||
        item.tool_name ||
        ''
      ).trim().toLowerCase();

      const action = canonicalToolMap[rawName];
      if (!action) return null;

      let rawProps = item.properties || item.arguments || item.parameters || item.props || item.params || item.function?.arguments || {};
      if (typeof rawProps === 'string') {
        try {
          rawProps = JSON.parse(rawProps);
        } catch (e) {
          rawProps = {};
        }
      }
      if (!rawProps || typeof rawProps !== 'object') rawProps = {};
      return { action, properties: rawProps };
    };

    // 1. Direct tool_calls from API envelope
    if (Array.isArray(response.tool_calls)) {
      response.tool_calls.forEach(tc => {
        const norm = normalizeToolItem(tc);
        if (norm) requests.push(norm);
      });
    }

    // 2. response.parsed objects or arrays
    if (response.parsed) {
      if (Array.isArray(response.parsed)) {
        response.parsed.forEach(p => {
          const norm = normalizeToolItem(p);
          if (norm) requests.push(norm);
        });
      } else if (typeof response.parsed === 'object') {
        const norm = normalizeToolItem(response.parsed);
        if (norm) {
          requests.push(norm);
        }
        if (Array.isArray(response.parsed.requests)) {
          response.parsed.requests.forEach(p => {
            const n = normalizeToolItem(p);
            if (n) requests.push(n);
          });
        }
        if (Array.isArray(response.parsed.tool_calls)) {
          response.parsed.tool_calls.forEach(p => {
            const n = normalizeToolItem(p);
            if (n) requests.push(n);
          });
        }
        if (Array.isArray(response.parsed.calls)) {
          response.parsed.calls.forEach(p => {
            const n = normalizeToolItem(p);
            if (n) requests.push(n);
          });
        }
      }
    }

    // 3. Parse reply text with regex / patterns
    const replyText = String(response.reply || '').trim();
    if (requests.length === 0 && replyText) {
      // Pattern A: <|tool_call|>: ... or <|toolcall|>: ... or <tool_call>...</tool_call> or <|tool_call>...<tool_call|>
      const tagRegex = /<\|?tool_?call\|?>:?\s*([\s\S]*?)(?:<\|?\/?tool_?call\|?>|$)/gi;
      let tagMatch;
      while ((tagMatch = tagRegex.exec(replyText)) !== null) {
        let block = String(tagMatch[1] || '').trim();
        if (!block) continue;

        // Check for call:actionName{...} or call:actionName(...)
        const callSyntax = /^call:([a-zA-Z0-9_]+)\s*([{\(][\s\S]*[}\)])/i.exec(block);
        if (callSyntax) {
          const rawAction = callSyntax[1];
          let rawBody = callSyntax[2].trim();
          if (rawBody.startsWith('(') && rawBody.endsWith(')')) {
            rawBody = '{' + rawBody.slice(1, -1) + '}';
          }
          try {
            const cleanJson = rawBody.replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":');
            const parsedProps = JSON.parse(cleanJson);
            const norm = normalizeToolItem({ action: rawAction, properties: parsedProps });
            if (norm) requests.push(norm);
          } catch (e) {
            const norm = normalizeToolItem({ action: rawAction, properties: {} });
            if (norm) requests.push(norm);
          }
          continue;
        }

        // Check for (action: ..., properties: ...) pseudo-syntax
        if (block.startsWith('(') && block.endsWith(')')) {
          block = '{' + block.slice(1, -1) + '}';
        }

        try {
          const parsed = JSON.parse(block);
          if (Array.isArray(parsed)) {
            parsed.forEach(p => {
              const n = normalizeToolItem(p);
              if (n) requests.push(n);
            });
          } else {
            const n = normalizeToolItem(parsed);
            if (n) requests.push(n);
          }
        } catch (e) {
          const firstBrace = block.indexOf('{');
          const lastBrace = block.lastIndexOf('}');
          if (firstBrace >= 0 && lastBrace > firstBrace) {
            const sub = block.slice(firstBrace, lastBrace + 1);
            try {
              const cleanSub = sub.replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":');
              const parsed = JSON.parse(cleanSub);
              const n = normalizeToolItem(parsed);
              if (n) requests.push(n);
            } catch (e2) {}
          }
        }
      }

      // Pattern B: [TOOL_CALLS] [...]
      if (requests.length === 0) {
        const toolCallsBlock = /\[TOOL_CALLS\]\s*(\[[\s\S]*?\]|\{[\s\S]*?\})/i.exec(replyText);
        if (toolCallsBlock) {
          try {
            const parsed = JSON.parse(toolCallsBlock[1]);
            if (Array.isArray(parsed)) {
              parsed.forEach(p => {
                const n = normalizeToolItem(p);
                if (n) requests.push(n);
              });
            } else {
              const n = normalizeToolItem(parsed);
              if (n) requests.push(n);
            }
          } catch (e) {}
        }
      }

      // Pattern C: standalone call:toolName{...} or call:toolName(...)
      if (requests.length === 0) {
        const standaloneCall = /call:([a-zA-Z0-9_]+)\s*([{\(][\s\S]*?[}\)])/gi;
        let scMatch;
        while ((scMatch = standaloneCall.exec(replyText)) !== null) {
          const rawAction = scMatch[1];
          let rawBody = scMatch[2].trim();
          if (rawBody.startsWith('(') && rawBody.endsWith(')')) {
            rawBody = '{' + rawBody.slice(1, -1) + '}';
          }
          try {
            const cleanJson = rawBody.replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":');
            const parsed = JSON.parse(cleanJson);
            const norm = normalizeToolItem({ action: rawAction, properties: parsed });
            if (norm) requests.push(norm);
          } catch (e) {
            const norm = normalizeToolItem({ action: rawAction, properties: {} });
            if (norm) requests.push(norm);
          }
        }
      }

      // Pattern D: Markdown code blocks ```json ... ``` or ``` ... ```
      if (requests.length === 0) {
        const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
        let cbMatch;
        while ((cbMatch = codeBlockRegex.exec(replyText)) !== null) {
          const block = String(cbMatch[1] || '').trim();
          if (!block) continue;
          try {
            const parsed = JSON.parse(block);
            if (Array.isArray(parsed)) {
              parsed.forEach(p => {
                const n = normalizeToolItem(p);
                if (n) requests.push(n);
              });
            } else {
              const n = normalizeToolItem(parsed);
              if (n) requests.push(n);
            }
          } catch (e) {
            const firstBrace = block.indexOf('{');
            const lastBrace = block.lastIndexOf('}');
            if (firstBrace >= 0 && lastBrace > firstBrace) {
              try {
                const cleanSub = block.slice(firstBrace, lastBrace + 1).replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":');
                const parsed = JSON.parse(cleanSub);
                const n = normalizeToolItem(parsed);
                if (n) requests.push(n);
              } catch (e2) {}
            }
          }
        }
      }

      // Pattern E: standalone JSON object or array containing an action
      if (requests.length === 0) {
        const firstBrace = replyText.indexOf('{');
        const lastBrace = replyText.lastIndexOf('}');
        if (firstBrace >= 0 && lastBrace > firstBrace) {
          try {
            const parsed = JSON.parse(replyText.slice(firstBrace, lastBrace + 1));
            const n = normalizeToolItem(parsed);
            if (n) requests.push(n);
          } catch (e) {}
        }
        if (requests.length === 0) {
          const firstBracket = replyText.indexOf('[');
          const lastBracket = replyText.lastIndexOf(']');
          if (firstBracket >= 0 && lastBracket > firstBracket) {
            try {
              const parsed = JSON.parse(replyText.slice(firstBracket, lastBracket + 1));
              if (Array.isArray(parsed)) {
                parsed.forEach(p => {
                  const n = normalizeToolItem(p);
                  if (n) requests.push(n);
                });
              }
            } catch (e) {}
          }
        }
      }
    }

    return requests;
  },

  async copyMessageText(btn, idx) {
    const msg = this.messages[idx];
    if (!msg) return;

    try {
      await navigator.clipboard.writeText(msg.content || '');
      
      const oldText = btn.textContent;
      btn.textContent = '✓ ' + (t('common.copied') || 'Copied');
      btn.style.color = 'var(--success, #10b981)';
      
      setTimeout(() => {
        btn.textContent = '📋';
        btn.style.color = '';
      }, 1800);
      
      toast(t('common.copied') || 'Copied to clipboard.');
    } catch (err) {
      console.error('Could not copy message text', err);
      toast(t('common.copyFailed') || 'Copy failed.', true);
    }
  },

  renderAttachments() {
    const container = document.getElementById('chat-attachments-container');
    if (!container) return;

    if (!this.attachedNotes) this.attachedNotes = [];
    if (!this.attachedTasks) this.attachedTasks = [];
    if (!this.attachedEvents) this.attachedEvents = [];

    // Gather active suggestions
    const isNoteOpen = document.getElementById('note-edit-overlay')?.style.display !== 'none';
    const suggestedNote = (isNoteOpen && typeof currentNote !== 'undefined' && currentNote && currentNote.path && !this.attachedNotes.includes(currentNote.path)) ? currentNote : null;

    const isPlannerActive = typeof activeTab !== 'undefined' && activeTab === 'planner';
    const selectedEvent = (isPlannerActive && typeof selectedPlannerEventId !== 'undefined' && selectedPlannerEventId) ? plannerEvents.find(e => e.id === selectedPlannerEventId) : null;
    const suggestedEvent = (selectedEvent && !this.attachedEvents.includes(selectedPlannerEventId)) ? selectedEvent : null;

    if (this.attachedNotes.length === 0 && this.attachedTasks.length === 0 && this.attachedEvents.length === 0 && !suggestedNote && !suggestedEvent) {
      container.innerHTML = '';
      container.style.display = 'none';
      return;
    }

    container.style.display = 'flex';
    let html = '';

    // Render attached notes
    this.attachedNotes.forEach(path => {
      const note = manifest.find(n => n.path === path);
      const title = note ? note.title : path.split('/').pop();
      html += `
        <div class="chat-attachment-chip">
          <span>📝 ${escH(title)}</span>
          <button onclick="AIChatController.toggleAttachNote('${escA(path)}', event)">&times;</button>
        </div>
      `;
    });

    // Render attached tasks
    this.attachedTasks.forEach(id => {
      const todo = todosManifest.find(t => t.id === id);
      const title = todo ? todo.title : id;
      html += `
        <div class="chat-attachment-chip">
          <span>📋 ${escH(title)}</span>
          <button onclick="AIChatController.toggleAttachTask('${escA(id)}', event)">&times;</button>
        </div>
      `;
    });

    // Render attached events
    this.attachedEvents.forEach(id => {
      const ev = plannerEvents.find(e => e.id === id);
      const title = ev ? ev.title : id;
      html += `
        <div class="chat-attachment-chip">
          <span>📅 ${escH(title)}</span>
          <button onclick="AIChatController.toggleAttachEvent('${escA(id)}', event)">&times;</button>
        </div>
      `;
    });

    // Render suggested note chip
    if (suggestedNote) {
      html += `
        <div class="chat-attachment-chip suggested-chip" onclick="AIChatController.toggleAttachNote('${escA(suggestedNote.path)}', event)" style="border: 1px dashed var(--accent); background: rgba(59, 130, 246, 0.08); color: var(--accent); cursor: pointer; font-weight: 500;" title="Attach current note context">
          <span>➕ 📝 ${escH(suggestedNote.title)}</span>
        </div>
      `;
    }

    // Render suggested event chip
    if (suggestedEvent) {
      html += `
        <div class="chat-attachment-chip suggested-chip" onclick="AIChatController.toggleAttachEvent('${escA(suggestedEvent.id)}', event)" style="border: 1px dashed var(--accent); background: rgba(59, 130, 246, 0.08); color: var(--accent); cursor: pointer; font-weight: 500;" title="Attach selected block context">
          <span>➕ 📅 ${escH(suggestedEvent.title)}</span>
        </div>
      `;
    }

    container.innerHTML = html;
  },

  renderSuggestionCardsHTML(actions, msgIdx) {
    let html = '<div class="chat-suggestion-cards">';
    actions.forEach((act, actIdx) => {
      const actionType = String(act.action || '').toLowerCase();
      let icon = '💡';
      let title = act.action;
      let bodyText = '';
      
      if (actionType === 'create_todo') {
        icon = '📋';
        title = t('chat.suggCreateTodo') || 'Create Task';
        bodyText = `<strong>${escH(act.properties?.title || '')}</strong> (Priority: ${escH(act.properties?.priority || 'Medium')})`;
      } else if (actionType === 'update_todo' || actionType === 'modify_todo') {
        icon = '📋✏️';
        title = t('chat.suggUpdateTodo') || 'Update Task';
        bodyText = `<strong>${escH(act.properties?.title || '')}</strong> (Priority: ${escH(act.properties?.priority || '')})`;
      } else if (actionType === 'create_note') {
        icon = '📝';
        title = t('chat.suggCreateNote') || 'Create Note';
        bodyText = `<strong>${escH(act.properties?.title || '')}</strong> (Group: ${escH(act.properties?.group || 'Daily')})`;
      } else if (actionType === 'create_event') {
        icon = '📅';
        title = t('chat.suggCreateEvent') || 'Schedule Meeting';
        bodyText = `<strong>${escH(act.properties?.title || '')}</strong> on ${escH(act.properties?.date || '')} at ${escH(act.properties?.time || '')}`;
        const collabs = AIChatController.extractCollaboratorsFromProps(act.properties);
        if (collabs.collaborators && collabs.collaborators.length > 0) {
          bodyText += ` with ${escH(collabs.collaborators.join(', '))}`;
        }
        if (act.properties?.noteTitle) {
          bodyText += `<br><small style="color:var(--text-muted); font-style:italic;">📝 Note: "${escH(act.properties.noteTitle)}"</small>`;
        }
      } else if (actionType === 'update_event' || actionType === 'modify_event' || actionType === 'update_block' || actionType === 'modify_block') {
        icon = '📅✏️';
        title = t('chat.suggUpdateEvent') || 'Update Event';
        bodyText = `<strong>${escH(act.properties?.title || '')}</strong> on ${escH(act.properties?.date || '')}`;
        const collabs = AIChatController.extractCollaboratorsFromProps(act.properties);
        if (collabs.collaborators && collabs.collaborators.length > 0) {
          bodyText += ` with ${escH(collabs.collaborators.join(', '))}`;
        }
        if (act.properties?.noteTitle) {
          bodyText += `<br><small style="color:var(--text-muted); font-style:italic;">📝 Note: "${escH(act.properties.noteTitle)}"</small>`;
        }
      } else if (actionType === 'schedule_task') {
        icon = '📅';
        title = t('chat.suggScheduleTask') || 'Planifier Tâche';
        bodyText = `<strong>${escH(act.properties?.title || '')}</strong> (Durée: ${escH(act.properties?.duration || 30)} min, Date: ${escH(act.properties?.date || 'tomorrow')})`;
        const collabs = AIChatController.extractCollaboratorsFromProps(act.properties);
        if (collabs.collaborators && collabs.collaborators.length > 0) {
          bodyText += ` with ${escH(collabs.collaborators.join(', '))}`;
        }
        if (act.properties?.noteTitle) {
          bodyText += `<br><small style="color:var(--text-muted); font-style:italic;">📝 Note: "${escH(act.properties.noteTitle)}"</small>`;
        }
      } else if (actionType === 'create_colleague') {
        icon = '👥';
        title = t('chat.suggCreateColleague') || 'Create Colleague';
        bodyText = `<strong>${escH(act.properties?.name || act.properties?.label || '')}</strong>`;
      } else if (actionType === 'update_colleague' || actionType === 'modify_colleague') {
        icon = '👥✏️';
        title = t('chat.suggUpdateColleague') || 'Update Colleague';
        bodyText = `<strong>${escH(act.properties?.name || act.properties?.label || '')}</strong>`;
      } else if (actionType === 'ask_questions') {
        icon = '❓';
        title = 'Précisions requises';
        const numQ = Array.isArray(act.properties?.questions) ? act.properties.questions.length : 0;
        bodyText = `L'assistant a besoin de précisions (${numQ} question(s) en attente).`;
      } else {
        bodyText = escH(JSON.stringify(act.properties));
      }

      const isAccepted = !!act.accepted;
      const isDismissed = !!act.dismissed;
      const isDisabled = isAccepted || isDismissed;
      const cardStyle = isDisabled ? ' style="opacity: 0.65; cursor: pointer;"' : ' style="cursor: pointer;"';
      
      let buttonsHTML = '';
      if (isAccepted) {
        buttonsHTML = `<span style="font-size:0.72rem; color:var(--success, #10b981); font-weight:600;">Status: Acceptée</span>
          <button class="btn btn-sm" style="padding:.2rem .5rem; font-size:.72rem; margin-left:6px;" onclick="event.stopPropagation(); AIChatController.handleSuggestionDblClick(${msgIdx}, ${actIdx})" title="${escA(t('chat.openNoteTooltip') || 'Open created item')}">👁️ ${escH(t('common.open') || 'Open')}</button>`;
      } else if (isDismissed) {
        buttonsHTML = `<span style="font-size:0.72rem; color:var(--text-muted); font-weight:600;">Status: Ignorée</span>`;
      } else {
        const acceptLabel = actionType === 'ask_questions' ? '📝 Répondre' : `✅ ${t('chat.accept') || 'Accept'}`;
        buttonsHTML = `
          <button class="btn btn-primary" style="padding:.2rem .6rem; font-size:.72rem;" onclick="event.stopPropagation(); AIChatController.acceptSuggestion(${msgIdx}, ${actIdx})">
            ${escH(acceptLabel)}
          </button>
          <button class="btn" style="padding:.2rem .6rem; font-size:.72rem;" onclick="event.stopPropagation(); AIChatController.dismissSuggestion(${msgIdx}, ${actIdx})">
            ❌ ${escH(t('chat.dismiss') || 'Dismiss')}
          </button>
        `;
      }

      html += `
        <div class="chat-suggestion-card" id="sugg-${msgIdx}-${actIdx}"${cardStyle} ondblclick="AIChatController.handleSuggestionDblClick(${msgIdx}, ${actIdx})">
          <div class="chat-suggestion-header">
            <span class="chat-suggestion-type">${icon} ${escH(title)}</span>
          </div>
          <div style="font-size: var(--font-size-ui); margin-top: 4px;">${bodyText}</div>
          <div class="chat-suggestion-actions">
            ${buttonsHTML}
          </div>
        </div>
      `;
    });
    html += '</div>';
    return html;
  },

  acceptSuggestion(msgIdx, actIdx) {
    const msg = this.messages[msgIdx];
    if (!msg || !msg.parsed || !Array.isArray(msg.parsed.suggested_actions)) return;
    const action = msg.parsed.suggested_actions[actIdx];
    if (!action) return;

    action.accepted = true;
    this.saveCurrentConversation();
    this.executeSuggestion(action);
    this.renderMessages();
  },

  dismissSuggestion(msgIdx, actIdx) {
    const msg = this.messages[msgIdx];
    if (!msg || !msg.parsed || !Array.isArray(msg.parsed.suggested_actions)) return;
    const action = msg.parsed.suggested_actions[actIdx];
    if (action) {
      action.dismissed = true;
    }
    this.saveCurrentConversation();
    this.renderMessages();
  },

  extractCollaboratorsFromProps(props) {
    let rawWithWhom = props.withWhom || props.collaborators || props.collaboratorIds;
    if (!rawWithWhom) {
      // Fallback scan: search description and title for existing colleague labels or IDs
      const searchSource = `${props.title || ''} ${props.description || ''} ${props.details || ''}`;
      const foundIds = [];
      const db = (typeof window !== 'undefined' && window.colleaguesDb) || (typeof colleaguesDb !== 'undefined' ? colleaguesDb : null);
      if (db && Array.isArray(db.colleagues)) {
        db.colleagues.forEach(c => {
          if (!c.id || c.id === 'me') return;
          // Check for ID match
          if (searchSource.includes(c.id)) {
            foundIds.push(c.id);
            return;
          }
          // Check for label match (case-insensitive with word boundaries or simple name match)
          const cleanLabel = String(c.label || '').trim();
          if (cleanLabel.length > 2) {
            const regex = new RegExp(`\\b${cleanLabel}\\b`, 'i');
            if (regex.test(searchSource)) {
              foundIds.push(c.id);
            }
          }
        });
      }
      if (foundIds.length > 0) {
        rawWithWhom = foundIds;
      }
    }
    
    let collaboratorIds = [];
    let collaborators = [];
    if (rawWithWhom) {
      const collabArray = Array.isArray(rawWithWhom) ? rawWithWhom : [rawWithWhom];
      const resolvedList = [];
      const dbColleagues = (typeof window !== 'undefined' && window.colleaguesDb && Array.isArray(window.colleaguesDb.colleagues))
        ? window.colleaguesDb.colleagues
        : ((typeof colleaguesDb !== 'undefined' && colleaguesDb && Array.isArray(colleaguesDb.colleagues)) ? colleaguesDb.colleagues : []);
      
      collabArray.forEach(val => {
        const cleanVal = String(val || '').trim();
        if (!cleanVal || cleanVal === 'me') return;
        
        // 1. Direct ID match in dbColleagues
        const matchById = dbColleagues.find(c => c.id === cleanVal);
        if (matchById) {
          resolvedList.push({ id: matchById.id, label: matchById.label });
          return;
        }
        
        // 2. Label match in dbColleagues
        const matchByLabel = dbColleagues.find(c => String(c.label || '').toLowerCase() === cleanVal.toLowerCase());
        if (matchByLabel) {
          resolvedList.push({ id: matchByLabel.id, label: matchByLabel.label });
          return;
        }
        
        // 3. Fallback to global resolveColleagueId
        if (typeof resolveColleagueId === 'function') {
          const resolvedId = resolveColleagueId(cleanVal, { allowCreate: true, allowMe: false });
          if (resolvedId && resolvedId !== 'me') {
            const label = (typeof getColleagueLabelById === 'function')
              ? getColleagueLabelById(resolvedId, cleanVal)
              : cleanVal;
            resolvedList.push({ id: resolvedId, label });
          }
        } else {
          resolvedList.push({ id: cleanVal, label: cleanVal });
        }
      });
      
      // Deduplicate by ID
      const seenIds = new Set();
      const uniqueResolved = [];
      resolvedList.forEach(item => {
        if (!seenIds.has(item.id)) {
          seenIds.add(item.id);
          uniqueResolved.push(item);
        }
      });
      
      collaboratorIds = uniqueResolved.map(item => item.id);
      collaborators = uniqueResolved.map(item => item.label);
    }
    return { collaboratorIds, collaborators };
  },

  async executeSuggestion(act) {
    try {
      const type = String(act.action || '').toLowerCase();
      const props = act.properties || {};

      if (type === 'ask_questions') {
        let foundMsgIdx = -1;
        let foundActIdx = -1;
        for (let i = 0; i < this.messages.length; i++) {
          const m = this.messages[i];
          if (m.parsed && Array.isArray(m.parsed.suggested_actions)) {
            const idx = m.parsed.suggested_actions.indexOf(act);
            if (idx !== -1) {
              foundMsgIdx = i;
              foundActIdx = idx;
              break;
            }
          }
        }
        if (foundMsgIdx !== -1 && foundActIdx !== -1) {
          this.openQuestionsPopup(foundMsgIdx, foundActIdx);
        }
      }
      else if (type === 'create_todo') {
        const date = new Date().toISOString().slice(0, 10);
        const todoId = props.id || props.todoId || ('todo-' + Date.now());

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
            ? EisenhowerUtils.getDefaultCoordsForQuadrant(quadrant, todoId || props.title)
            : { x: quadrant === 'Q1' || quadrant === 'Q3' ? 25 : 75, y: quadrant === 'Q1' || quadrant === 'Q2' ? 25 : 75 };
          if (x === null) x = def.x;
          if (y === null) y = def.y;
        }

        const priority = (typeof EisenhowerUtils !== 'undefined' && EisenhowerUtils.getPriorityForQuadrant)
          ? EisenhowerUtils.getPriorityForQuadrant(quadrant)
          : (props.priority || 'Medium');

        const assignedUser = props.owner || props.assignee || (typeof settings !== 'undefined' && settings ? settings.username : '') || 'me';
        const reporterUser = props.reporter || props.askedBy || '';
        const isExternalAssignee = assignedUser !== 'me' && assignedUser !== (typeof settings !== 'undefined' && settings ? settings.username : '');

        const targetNoteId = props.context_link || (typeof currentNote !== 'undefined' && currentNote ? currentNote.id : '') || (typeof window !== 'undefined' && window.currentNote ? window.currentNote.id : '') || (typeof globalThis !== 'undefined' && globalThis.currentNote ? globalThis.currentNote.id : '');
        const targetNote = targetNoteId
          ? ((typeof getNoteById === 'function' ? getNoteById(targetNoteId) : null)
             || ((typeof manifest !== 'undefined' && Array.isArray(manifest)) ? manifest.find(n => n && (n.id === targetNoteId || n.path === targetNoteId)) : null)
             || ((typeof window !== 'undefined' && Array.isArray(window.manifest)) ? window.manifest.find(n => n && (n.id === targetNoteId || n.path === targetNoteId)) : null)
             || ((typeof globalThis !== 'undefined' && Array.isArray(globalThis.manifest)) ? globalThis.manifest.find(n => n && (n.id === targetNoteId || n.path === targetNoteId)) : null)
             || ((typeof currentNote !== 'undefined' && currentNote && (currentNote.id === targetNoteId || currentNote.path === targetNoteId)) ? currentNote : null)
             || ((typeof window !== 'undefined' && window.currentNote && (window.currentNote.id === targetNoteId || window.currentNote.path === targetNoteId)) ? window.currentNote : null)
             || ((typeof globalThis !== 'undefined' && globalThis.currentNote && (globalThis.currentNote.id === targetNoteId || globalThis.currentNote.path === targetNoteId)) ? globalThis.currentNote : null))
          : ((typeof currentNote !== 'undefined' && currentNote) ? currentNote : ((typeof window !== 'undefined' && window.currentNote) ? window.currentNote : ((typeof globalThis !== 'undefined' && globalThis.currentNote) ? globalThis.currentNote : null)));
        const resolvedWs = props.workstream || (targetNote
          ? ((typeof getNoteWorkstreamName === 'function' ? getNoteWorkstreamName(targetNote) : '')
             || (typeof window !== 'undefined' && typeof window.getNoteWorkstreamName === 'function' ? window.getNoteWorkstreamName(targetNote) : '')
             || (typeof globalThis !== 'undefined' && typeof globalThis.getNoteWorkstreamName === 'function' ? globalThis.getNoteWorkstreamName(targetNote) : '')
             || targetNote.workstream
             || (Array.isArray(targetNote.workstreams) ? targetNote.workstreams[0] : '') || '')
          : '');

        const todo = {
          id: todoId,
          title: String(props.title || 'Task from Chat').slice(0, 120),
          priority: priority,
          eisenhowerQuadrant: quadrant,
          eisenhowerX: Math.round(x * 10) / 10,
          eisenhowerY: Math.round(y * 10) / 10,
          isHighPriority: quadrant === 'Q1',
          owner: assignedUser,
          ownerId: (typeof resolveColleagueId === 'function') ? (resolveColleagueId(assignedUser, { allowCreate: true, allowMe: true }) || 'me') : assignedUser,
          askedBy: reporterUser,
          askedById: (typeof resolveColleagueId === 'function') ? (resolveColleagueId(reporterUser, { allowCreate: true }) || '') : '',
          assignmentStatus: isExternalAssignee ? 'pending_communication' : 'unassigned',
          assignmentConfirmed: !isExternalAssignee,
          dueDate: props.dueDate || props.due_date || '',
          noteId: targetNoteId,
          noteTodoMarkerId: todoId,
          workstream: resolvedWs || '',
          major_topic_tags: resolvedWs ? [resolvedWs] : [],
          context: props.context || props.description || props.title || '',
          created: date,
          modified: date
        };

        const existingIdx = Array.isArray(todosManifest) ? todosManifest.findIndex(t => t.id === todoId) : -1;
        if (existingIdx !== -1) {
          todosManifest[existingIdx] = { ...todosManifest[existingIdx], ...todo };
        } else if (Array.isArray(todosManifest)) {
          todosManifest.push(todo);
        }
        await saveTodosManifest();
        if (typeof refreshTodoViews === 'function') {
          refreshTodoViews();
        } else if (typeof renderBoard === 'function') {
          renderBoard();
        }
        act.createdId = todoId;
        this.saveCurrentConversation();
        const toastMsg = isExternalAssignee
          ? `${t('chat.suggTodoCreated') || 'Task created!'} (Pending Communication with ${todo.owner})`
          : (t('chat.suggTodoCreated') || 'Task created successfully!');
        toast(toastMsg);
      } 
      else if (type === 'update_todo' || type === 'modify_todo') {
        const todoId = props.id || props.todoId;
        const todo = getTodoById(todoId);
        if (todo) {
          if (props.title !== undefined) todo.title = String(props.title).slice(0, 120);
          if (props.quadrant !== undefined || props.eisenhowerQuadrant !== undefined) {
            todo.eisenhowerQuadrant = props.quadrant || props.eisenhowerQuadrant;
          }
          if (props.isHighPriority !== undefined) {
            todo.isHighPriority = Boolean(props.isHighPriority);
          }
          if (props.priority !== undefined) {
            const newPriority = props.priority;
            if (newPriority !== todo.priority) {
              changeTodoPriority(todoId, newPriority);
            }
          }
          if (props.assignee !== undefined || props.owner !== undefined) {
            const ownerId = props.assignee || props.owner;
            const resolvedOwnerId = (typeof resolveColleagueId === 'function')
              ? (resolveColleagueId(ownerId, { allowCreate: true, allowMe: true }) || 'me')
              : ownerId;
            todo.ownerId = resolvedOwnerId;
            todo.owner = (typeof getColleagueLabelById === 'function')
              ? getColleagueLabelById(resolvedOwnerId, resolvedOwnerId)
              : resolvedOwnerId;
            const isExternal = resolvedOwnerId !== 'me' && resolvedOwnerId !== (typeof settings !== 'undefined' && settings ? settings.username : '');
            if (isExternal) {
              todo.assignmentStatus = 'pending_communication';
              todo.assignmentConfirmed = false;
            } else {
              todo.assignmentStatus = 'unassigned';
              todo.assignmentConfirmed = true;
            }
          }
          if (props.dueDate !== undefined || props.due_date !== undefined) {
            todo.dueDate = props.dueDate || props.due_date;
          }
          if (props.context !== undefined || props.description !== undefined) {
            todo.context = props.context || props.description;
          }
          if (props.status !== undefined) {
            if ((todo.status || '') !== props.status) {
              changeTodoStatus(todoId, props.status);
            }
          }
          todo.modified = new Date().toISOString().slice(0, 10);
          await saveTodosManifest();
          if (typeof refreshTodoViews === 'function') {
            refreshTodoViews();
          } else if (typeof renderBoard === 'function') {
            renderBoard();
          }
          act.createdId = todoId;
          this.saveCurrentConversation();
          toast(t('chat.suggTodoUpdated') || 'Task updated successfully!');
        } else {
          throw new Error('Todo not found');
        }
      }
      else if (type === 'create_note') {
        const noteId = generateNoteId();
        const path = getCanonicalNotePath(noteId);
        const todayStr = new Date().toISOString().slice(0, 10);
        const rawContent = props.content || props.noteContent || props.note_content || '';
        const mainHTML = (typeof mdToPreviewHTML === 'function' && rawContent)
          ? mdToPreviewHTML(rawContent)
          : (typeof getDefaultNoteTemplateHTML === 'function' ? getDefaultNoteTemplateHTML() : '<p></p>');
        const newNote = {
          id: noteId,
          path: path,
          title: props.title || 'Note from Chat',
          date: todayStr,
          group_tags: [props.group || 'Daily'],
          major_topic_tags: [],
          topic_tags: [],
          extra_tags: [],
          mainHTML: mainHTML
        };
        
        const html = buildNewNoteHTML(newNote);
        await StorageAPI.writeNoteContent(path, html);
        upsertManifest(newNote);
        await saveManifest();
        await rebuildIndexHTML();
        if (typeof renderBoard === 'function') renderBoard();
        act.createdId = noteId;
        this.saveCurrentConversation();
        toast(t('chat.suggNoteCreated') || 'Note created successfully!');
      } 
      else if (type === 'create_event') {
        const eventId = 'evt-' + Date.now();
        const duration = parseInt(props.duration) || 30;
        const startTime = props.time || props.startTime || '';
        let startMin = NaN;
        if (startTime && startTime.includes(':')) {
          const [h, m] = startTime.split(':').map(Number);
          if (!isNaN(h) && !isNaN(m)) startMin = h * 60 + m;
        }
        const endTime = isNaN(startMin) ? '' : formatMinutesToHHMM(startMin + duration);

        if (typeof plannerEvents === 'undefined' || !Array.isArray(plannerEvents)) {
          window.plannerEvents = [];
        }

        // Support dynamic note creation
        let noteId = props.noteId || '';
        if (props.noteTitle || props.noteContent || props.note_title || props.note_content) {
          const newNoteId = generateNoteId();
          const path = getCanonicalNotePath(newNoteId);
          const todayStr = new Date().toISOString().slice(0, 10);
          const rawNoteContent = props.noteContent || props.note_content || '';
          const noteMainHTML = (typeof mdToPreviewHTML === 'function' && rawNoteContent)
            ? mdToPreviewHTML(rawNoteContent)
            : (typeof getDefaultNoteTemplateHTML === 'function' ? getDefaultNoteTemplateHTML() : '<p></p>');
          const newNote = {
            id: newNoteId,
            path: path,
            title: props.noteTitle || props.note_title || (props.title ? `Note: ${props.title}` : 'Note from Chat'),
            date: props.date || todayStr,
            group_tags: ['Daily'],
            major_topic_tags: [],
            topic_tags: [],
            extra_tags: [],
            mainHTML: noteMainHTML
          };
          const noteHtml = buildNewNoteHTML(newNote);
          await StorageAPI.writeNoteContent(path, noteHtml);
          upsertManifest(newNote);
          await saveManifest();
          await rebuildIndexHTML();
          noteId = newNoteId;
        }

        // Support withWhom/collaborators
        const { collaboratorIds, collaborators } = this.extractCollaboratorsFromProps(props);

        const validPlannerTypes = new Set(['call', 'sync', 'prep', 'todo', 'work', 'ooo', 'custom']);
        const eventType = (props.type && validPlannerTypes.has(String(props.type).toLowerCase()))
          ? String(props.type).toLowerCase()
          : (typeof inferPlannerEventType === 'function' ? inferPlannerEventType(props.title, props.description) : 'call');

        const event = {
          id: eventId,
          title: props.title || 'Meeting from Chat',
          date: props.date || new Date().toISOString().slice(0, 10),
          startTime: startTime,
          endTime: endTime,
          duration: duration,
          type: eventType,
          description: props.description || '',
          noteId: noteId,
          linkedNoteIds: noteId ? [noteId] : [],
          collaboratorIds: collaboratorIds,
          collaborators: collaborators
        };
        
        plannerEvents.push(event);
        if (typeof savePlanner === 'function') {
          await savePlanner();
        } else {
          await StorageAPI.writePlanner({ events: plannerEvents });
        }
        if (typeof renderPlanner === 'function') renderPlanner();
        if (typeof renderBoard === 'function') renderBoard();
        act.createdId = eventId;
        this.saveCurrentConversation();
        toast(t('chat.suggEventCreated') || 'Event scheduled successfully!');
      } 
      else if (type === 'update_event' || type === 'modify_event' || type === 'update_block' || type === 'modify_block') {
        const eventId = props.id || props.eventId;
        if (typeof plannerEvents === 'undefined' || !Array.isArray(plannerEvents)) {
          window.plannerEvents = [];
        }
        const event = plannerEvents.find(e => e.id === eventId);
        if (event) {
          if (props.title !== undefined) event.title = props.title;
          if (props.date !== undefined) event.date = props.date;
          
          let startTime = event.startTime;
          if (props.startTime !== undefined || props.time !== undefined) {
            startTime = props.startTime || props.time;
            event.startTime = startTime;
          }
          let duration = event.duration || 30;
          if (props.duration !== undefined) {
            duration = parseInt(props.duration) || 30;
            event.duration = duration;
          }
          if (props.endTime !== undefined) {
            event.endTime = props.endTime;
          } else if (props.duration !== undefined || props.startTime !== undefined || props.time !== undefined) {
            let startMin = 600;
            if (startTime && startTime.includes(':')) {
              const [h, m] = startTime.split(':').map(Number);
              if (!isNaN(h) && !isNaN(m)) startMin = h * 60 + m;
            }
            const endMin = startMin + duration;
            event.endTime = formatMinutesToHHMM(endMin);
          }
          
          if (props.type !== undefined) event.type = props.type;
          if (props.description !== undefined || props.details !== undefined) {
            event.description = props.description || props.details;
          }
          
          // Support note update/creation in update_event too!
          if (props.noteId !== undefined) {
            event.noteId = props.noteId;
            event.linkedNoteIds = normalizePlannerLinkedNoteIds([props.noteId, ...(event.linkedNoteIds || [])], props.noteId);
          }
          
          if (props.noteTitle || props.noteContent || props.note_title || props.note_content) {
            const newNoteId = generateNoteId();
            const path = getCanonicalNotePath(newNoteId);
            const todayStr = new Date().toISOString().slice(0, 10);
            const rawNoteContent = props.noteContent || props.note_content || '';
            const noteMainHTML = (typeof mdToPreviewHTML === 'function' && rawNoteContent)
              ? mdToPreviewHTML(rawNoteContent)
              : (typeof getDefaultNoteTemplateHTML === 'function' ? getDefaultNoteTemplateHTML() : '<p></p>');
            const newNote = {
              id: newNoteId,
              path: path,
              title: props.noteTitle || props.note_title || `Note: ${event.title}`,
              date: props.date || event.date || todayStr,
              group_tags: ['Daily'],
              major_topic_tags: [],
              topic_tags: [],
              extra_tags: [],
              mainHTML: noteMainHTML
            };
            const noteHtml = buildNewNoteHTML(newNote);
            await StorageAPI.writeNoteContent(path, noteHtml);
            upsertManifest(newNote);
            await saveManifest();
            await rebuildIndexHTML();
            event.noteId = newNoteId;
            event.linkedNoteIds = normalizePlannerLinkedNoteIds([newNoteId, ...(event.linkedNoteIds || [])], newNoteId);
          }

          // Support withWhom/collaborators update
          const { collaboratorIds, collaborators } = this.extractCollaboratorsFromProps(props);
          event.collaboratorIds = collaboratorIds;
          event.collaborators = collaborators;
          
          if (typeof savePlanner === 'function') {
            await savePlanner();
          } else {
            await StorageAPI.writePlanner({ events: plannerEvents });
          }
          if (typeof renderPlanner === 'function') renderPlanner();
          if (typeof renderBoard === 'function') renderBoard();
          act.createdId = eventId;
          this.saveCurrentConversation();
          toast(t('chat.suggEventUpdated') || 'Event updated successfully!');
        } else {
          throw new Error('Event not found');
        }
      }
      else if (type === 'schedule_task') {
        const title = String(props.title || 'Task from Chat').slice(0, 120);
        const dateInput = props.date || 'tomorrow';
        const dateStr = this.resolveScheduleDate(dateInput);
        const duration = parseInt(props.duration) || 30;
        const desc = props.description || 'Tâche planifiée via l\'assistant IA.';
        
        // Support creating a note!
        let noteId = props.noteId || '';
        if (props.noteTitle || props.noteContent || props.note_title || props.note_content) {
          const newNoteId = generateNoteId();
          const path = getCanonicalNotePath(newNoteId);
          const rawNoteContent = props.noteContent || props.note_content || '';
          const noteMainHTML = (typeof mdToPreviewHTML === 'function' && rawNoteContent)
            ? mdToPreviewHTML(rawNoteContent)
            : (typeof getDefaultNoteTemplateHTML === 'function' ? getDefaultNoteTemplateHTML() : '<p></p>');
          const newNote = {
            id: newNoteId,
            path: path,
            title: props.noteTitle || props.note_title || `Note: ${title}`,
            date: dateStr,
            group_tags: ['Daily'],
            major_topic_tags: [],
            topic_tags: [],
            extra_tags: [],
            mainHTML: noteMainHTML
          };
          const noteHtml = buildNewNoteHTML(newNote);
          await StorageAPI.writeNoteContent(path, noteHtml);
          upsertManifest(newNote);
          await saveManifest();
          await rebuildIndexHTML();
          noteId = newNoteId;
        }

        // Support withWhom/collaborators
        const { collaboratorIds, collaborators } = this.extractCollaboratorsFromProps(props);

        const result = await this.scheduleTaskInPlanner(title, dateStr, duration, desc, {
          noteId,
          collaboratorIds,
          collaborators
        });
        act.createdId = result.id;
        this.saveCurrentConversation();
        toast(`Planifié le ${result.date} de ${result.startTime} à ${result.endTime}`);
      }
      else if (type === 'create_colleague') {
        const name = props.name || props.label || 'New Colleague';
        const cleanName = name.trim();
        if (!cleanName) throw new Error('Colleague name/label is required');
        
        const normName = cleanName.toLowerCase();
        if (typeof colleaguesByNormLabel !== 'undefined' && colleaguesByNormLabel && colleaguesByNormLabel.has(normName)) {
          throw new Error(`Colleague "${cleanName}" already exists`);
        }

        const id = (typeof resolveColleagueId === 'function') ? resolveColleagueId(cleanName, { allowCreate: true }) : '';
        if (id) {
          if (typeof colleaguesDb !== 'undefined' && colleaguesDb) {
            const colRecord = colleaguesDb.colleagues.find(c => c.id === id);
            if (colRecord) {
              if (props.team || props.teamId) {
                const proposedTeam = props.team || props.teamId;
                let teamRecord = colleaguesDb.teams.find(t => t.id === proposedTeam || t.name.toLowerCase() === String(proposedTeam).toLowerCase());
                if (!teamRecord && proposedTeam) {
                  const newTeamId = 'team-' + proposedTeam.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                  teamRecord = {
                    id: newTeamId,
                    name: proposedTeam,
                    managerId: ''
                  };
                  colleaguesDb.teams.push(teamRecord);
                }
                if (teamRecord) {
                  colRecord.teamId = teamRecord.id;
                }
              }

              const proposedManagerName = props.reportsTo || props.reports_to || props.manager;
              if (proposedManagerName) {
                const managerId = (typeof resolveColleagueId === 'function')
                  ? resolveColleagueId(proposedManagerName, { allowCreate: true, allowMe: true })
                  : '';
                if (managerId) {
                  let teamRecord = colleaguesDb.teams.find(t => t.managerId === managerId);
                  if (!teamRecord) {
                    const managerLabel = (typeof getColleagueLabelById === 'function')
                      ? getColleagueLabelById(managerId, proposedManagerName)
                      : proposedManagerName;
                    const newTeamId = 'team-' + managerId.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                    teamRecord = {
                      id: newTeamId,
                      name: `Team ${managerLabel}`,
                      managerId: managerId
                    };
                    colleaguesDb.teams.push(teamRecord);
                  }
                  colRecord.teamId = teamRecord.id;
                }
              }

              if (props.isManager !== undefined || props.is_manager !== undefined) {
                const isManager = !!(props.isManager !== undefined ? props.isManager : props.is_manager);
                const teamRecord = colleaguesDb.teams.find(t => t.id === colRecord.teamId);
                if (teamRecord && teamRecord.id !== 'team-other-bucket') {
                  if (isManager) {
                    teamRecord.managerId = id;
                  } else if (teamRecord.managerId === id) {
                    teamRecord.managerId = '';
                  }
                }
              }
            }
          }

          if (props.tags || props.labels) {
            const tags = Array.isArray(props.tags || props.labels)
              ? (props.tags || props.labels)
              : String(props.tags || props.labels).split(',').map(t => t.trim()).filter(Boolean);
            if (typeof setCollaboratorLabels === 'function') {
              setCollaboratorLabels(cleanName, tags);
            }
          }

          if (typeof saveColleaguesDb === 'function') await saveColleaguesDb();
          if (typeof reindexColleaguesDb === 'function') reindexColleaguesDb();
          if (typeof dedupeColleaguesWorkspaceData === 'function') await dedupeColleaguesWorkspaceData({ persist: true });
          
          if (typeof renderTeamPanel === 'function') renderTeamPanel();
          if (typeof renderBoard === 'function') renderBoard();

          act.createdId = id;
          this.saveCurrentConversation();
          toast(t('team.colleagueCreated', { name: cleanName }) || `Colleague "${cleanName}" created!`);
        }
      }
      else if (type === 'update_colleague' || type === 'modify_colleague') {
        const id = props.id || (typeof resolveColleagueId === 'function' ? resolveColleagueId(props.oldName || props.name || props.label, { allowCreate: false, allowMe: false }) : '');
        if (!id) throw new Error('Colleague not found');

        if (typeof colleaguesDb === 'undefined' || !colleaguesDb) {
          throw new Error('Colleagues database not initialized');
        }

        const colRecord = (id === 'me') ? colleaguesDb.me : colleaguesDb.colleagues.find(c => c.id === id);
        if (!colRecord) throw new Error('Colleague record not found');

        const oldName = colRecord.label;
        const newName = props.name || props.label;

        if (newName && newName.trim() !== '' && newName !== oldName) {
          const cleanNewName = newName.trim();
          if (id === 'me') {
            colleaguesDb.me.label = cleanNewName;
            if (typeof remapCollaboratorKeyAcrossSettings === 'function') remapCollaboratorKeyAcrossSettings(oldName, cleanNewName);
            if (typeof updateCollaboratorInAllNotes === 'function') await updateCollaboratorInAllNotes(oldName, cleanNewName);
          } else {
            colRecord.label = cleanNewName;
            if (typeof remapCollaboratorKeyAcrossSettings === 'function') remapCollaboratorKeyAcrossSettings(oldName, cleanNewName);
            if (typeof updateCollaboratorInAllNotes === 'function') await updateCollaboratorInAllNotes(oldName, cleanNewName);
            
            if (Array.isArray(todosManifest)) {
              todosManifest.forEach(todo => {
                if (!todo || typeof todo !== 'object') return;
                const ownerId = (typeof resolveColleagueId === 'function')
                  ? (resolveColleagueId(todo.ownerId || todo.owner || 'me', { allowCreate: false, allowMe: true }) || 'me')
                  : 'me';
                if (ownerId === id) {
                  todo.owner = cleanNewName;
                }
              });
            }

            if (Array.isArray(plannerEvents)) {
              plannerEvents.forEach(event => {
                if (!event || typeof event !== 'object') return;
                if (Array.isArray(event.collaborators)) {
                  const idx = event.collaborators.findIndex(c => normalizeCollaboratorKey(c) === normalizeCollaboratorKey(oldName));
                  if (idx !== -1) {
                    event.collaborators[idx] = cleanNewName;
                  }
                }
              });
            }
          }
        }

        const activeName = colRecord.label;

        if (props.team !== undefined || props.teamId !== undefined) {
          const proposedTeam = props.team !== undefined ? props.team : props.teamId;
          let teamRecord = colleaguesDb.teams.find(t => t.id === proposedTeam || t.name.toLowerCase() === String(proposedTeam).toLowerCase());
          if (!teamRecord && proposedTeam) {
            const newTeamId = 'team-' + String(proposedTeam).toLowerCase().replace(/[^a-z0-9]+/g, '-');
            teamRecord = {
              id: newTeamId,
              name: String(proposedTeam),
              managerId: ''
            };
            colleaguesDb.teams.push(teamRecord);
          }
          if (teamRecord) {
            colRecord.teamId = teamRecord.id;
          }
        }

        const proposedManagerName = props.reportsTo || props.reports_to || props.manager;
        if (proposedManagerName !== undefined) {
          if (proposedManagerName) {
            const managerId = (typeof resolveColleagueId === 'function')
              ? resolveColleagueId(proposedManagerName, { allowCreate: true, allowMe: true })
              : '';
            if (managerId) {
              let teamRecord = colleaguesDb.teams.find(t => t.managerId === managerId);
              if (!teamRecord) {
                const managerLabel = (typeof getColleagueLabelById === 'function')
                  ? getColleagueLabelById(managerId, proposedManagerName)
                  : proposedManagerName;
                const newTeamId = 'team-' + managerId.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                teamRecord = {
                  id: newTeamId,
                  name: `Team ${managerLabel}`,
                  managerId: managerId
                };
                colleaguesDb.teams.push(teamRecord);
              }
              colRecord.teamId = teamRecord.id;
            }
          }
        }

        if (props.isManager !== undefined || props.is_manager !== undefined) {
          const isManager = !!(props.isManager !== undefined ? props.isManager : props.is_manager);
          const teamRecord = colleaguesDb.teams.find(t => t.id === colRecord.teamId);
          if (teamRecord && teamRecord.id !== 'team-other-bucket') {
            if (isManager) {
              teamRecord.managerId = id;
            } else if (teamRecord.managerId === id) {
              teamRecord.managerId = '';
            }
          }
        }

        if (props.tags !== undefined || props.labels !== undefined) {
          const tags = Array.isArray(props.tags || props.labels)
            ? (props.tags || props.labels)
            : String(props.tags || props.labels).split(',').map(t => t.trim()).filter(Boolean);
          if (typeof setCollaboratorLabels === 'function') {
            setCollaboratorLabels(activeName, tags);
          }
        }

        if (typeof saveColleaguesDb === 'function') await saveColleaguesDb();
        if (typeof reindexColleaguesDb === 'function') reindexColleaguesDb();
        if (typeof dedupeColleaguesWorkspaceData === 'function') await dedupeColleaguesWorkspaceData({ persist: true });
        
        if (Array.isArray(todosManifest) && (newName && newName.trim() !== '' && newName !== oldName)) {
          if (typeof saveTodosManifest === 'function') await saveTodosManifest();
        }
        if (Array.isArray(plannerEvents) && (newName && newName.trim() !== '' && newName !== oldName)) {
          if (typeof savePlanner === 'function') await savePlanner();
        }

        if (typeof renderTeamPanel === 'function') renderTeamPanel();
        if (typeof renderBoard === 'function') renderBoard();

        act.createdId = id;
        this.saveCurrentConversation();
        toast(t('chat.suggColleagueUpdated') || `Colleague "${activeName}" updated!`);
      }
      else if (type === 'text_correction' || type === 'text_mutation' || type === 'correction') {
        const target = props.target_string || props.target || props.original || '';
        const replacement = props.replacement_text || props.replacement || props.corrected || target;
        
        const ta = document.getElementById('edit-textarea');
        let applied = false;

        if (ta && target) {
          const rawHTML = ta.innerHTML;
          const rawText = ta.innerText || ta.textContent || '';
          let formattedReplacement = (typeof convertMentionsToPills === 'function')
            ? convertMentionsToPills(replacement)
            : replacement;
          formattedReplacement = formattedReplacement.replace(/\[\[([^\]]+)\]\]/g, (_m, rawTitle) => {
            const trimmed = rawTitle.trim();
            let nEntry = null;
            if (typeof manifest !== 'undefined' && Array.isArray(manifest)) {
              nEntry = manifest.find(n => (n.title || '').toLowerCase() === trimmed.toLowerCase() || n.id === trimmed);
            }
            const nId = nEntry?.id || '';
            const nPath = nEntry?.path || '';
            const dTitle = nEntry?.title || trimmed;
            const tooltip = (typeof t === 'function' ? t('editor.openNoteLinkTooltip') || 'Open note' : 'Open note') + ': ' + dTitle;
            return `<a href="#" class="note-link wiki-link" data-note-id="${escA(nId)}" data-note-path="${escA(nPath)}" title="${escA(tooltip)}">📝 ${escH(dTitle)}</a>&nbsp;`;
          });

          if (rawHTML.includes(target)) {
            ta.innerHTML = rawHTML.replace(target, formattedReplacement);
            applied = true;
          } else if (rawText.includes(target)) {
            const escapedTarget = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            ta.innerHTML = rawHTML.replace(new RegExp(escapedTarget, 'g'), formattedReplacement);
            applied = true;
          }
        }

        if (!applied && typeof currentNote !== 'undefined' && currentNote) {
          let mainHTML = currentNote.mainHTML || '';
          if (mainHTML && target && mainHTML.includes(target)) {
            let formattedReplacement = (typeof convertMentionsToPills === 'function')
              ? convertMentionsToPills(replacement)
              : replacement;
            formattedReplacement = formattedReplacement.replace(/\[\[([^\]]+)\]\]/g, (_m, rawTitle) => {
              const trimmed = rawTitle.trim();
              let nEntry = null;
              if (typeof manifest !== 'undefined' && Array.isArray(manifest)) {
                nEntry = manifest.find(n => (n.title || '').toLowerCase() === trimmed.toLowerCase() || n.id === trimmed);
              }
              const nId = nEntry?.id || '';
              const nPath = nEntry?.path || '';
              const dTitle = nEntry?.title || trimmed;
              const tooltip = (typeof t === 'function' ? t('editor.openNoteLinkTooltip') || 'Open note' : 'Open note') + ': ' + dTitle;
              return `<a href="#" class="note-link wiki-link" data-note-id="${escA(nId)}" data-note-path="${escA(nPath)}" title="${escA(tooltip)}">📝 ${escH(dTitle)}</a>&nbsp;`;
            });
            currentNote.mainHTML = mainHTML.replace(target, formattedReplacement);
            applied = true;
            if (ta) ta.innerHTML = currentNote.mainHTML;
          }
        }

        if (ta) {
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
        }

        act.createdId = 'corr-' + Date.now();
        this.saveCurrentConversation();
        toast(t('chat.suggCorrectionApplied') || 'Correction de texte appliquée !');
      }
      else if (type === 'log_decision' || type === 'create_decision' || type === 'decision') {
        const title = String(props.title || props.text || props.decision || 'Décision').slice(0, 150);
        const status = props.status || 'active';
        const owner = props.owner || '';
        const reporter = props.reporter || '';
        const topic = props.major_topic || props.topic || '';
        const context = props.context || '';

        const badgeHTML = `<strong class="pill-decision pill-decision-${escH(status)}" contenteditable="false">!decision:${escH(status)}</strong>`;
        const decisionHTML = `<span class="note-decision-wrapper note-decision-draft" data-decision-status="${escH(status)}" data-decision-text="${escH(title)}" data-decision-owner="${escH(owner)}" data-decision-reporter="${escH(reporter)}" data-decision-topic="${escH(topic)}" data-decision-context="${escH(context)}" contenteditable="false">${badgeHTML} <span class="note-decision-text" contenteditable="true">${escH(title)}</span></span>`;

        const ta = document.getElementById('edit-textarea');
        if (ta) {
          if (typeof appendHTMLToEditor === 'function') {
            appendHTMLToEditor(ta, `<p>${decisionHTML}</p>`);
          } else {
            ta.innerHTML += `<p>${decisionHTML}</p>`;
          }
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
        }

        act.createdId = 'dec-' + Date.now();
        this.saveCurrentConversation();
        toast(t('chat.suggDecisionLogged') || 'Décision enregistrée !');
      }
      else if (type === 'link_note' || type === 'note_link' || type === 'insert_note_link') {
        const noteTitle = props.title || props.note_title || props.name || '';
        const notePath = props.path || props.note_path || '';
        const noteId = props.id || props.note_id || '';
        let targetNote = null;
        if (typeof manifest !== 'undefined' && Array.isArray(manifest)) {
          targetNote = (noteId ? manifest.find(n => n.id === noteId) : null) ||
                      (notePath ? manifest.find(n => n.path === notePath) : null) ||
                      (noteTitle ? manifest.find(n => (n.title || '').toLowerCase() === noteTitle.toLowerCase()) : null);
        }
        const finalTitle = targetNote?.title || noteTitle || 'Linked Note';
        const finalPath = targetNote?.path || notePath;
        const finalId = targetNote?.id || noteId;

        if (typeof insertLinkedNoteWikiLink === 'function') {
          insertLinkedNoteWikiLink({ id: finalId, path: finalPath, title: finalTitle });
        } else {
          const ta = document.getElementById('edit-textarea');
          if (ta) {
            const openTooltip = (typeof t === 'function' ? t('editor.openNoteLinkTooltip') || 'Open linked note' : 'Open linked note') + ': ' + finalTitle;
            const linkHtml = `<a href="#" class="note-link wiki-link" data-note-id="${escA(finalId)}" data-note-path="${escA(finalPath)}" title="${escA(openTooltip)}">📝 ${escH(finalTitle)}</a>&nbsp;`;
            if (typeof appendHTMLToEditor === 'function') {
              appendHTMLToEditor(ta, `<p>${linkHtml}</p>`);
            } else {
              ta.innerHTML += `<p>${linkHtml}</p>`;
            }
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
          }
        }

        if (typeof currentNote !== 'undefined' && currentNote?.id && typeof syncPlannerAssociationsFromNote === 'function' && finalId) {
          syncPlannerAssociationsFromNote(currentNote.id, { addedNoteId: finalId }).catch(err => console.warn(err));
        }

        act.createdId = 'note-link-' + Date.now();
        this.saveCurrentConversation();
        toast(t('editor.linkNote') || 'Note linked');
      }
    } catch (e) {
      console.error('Execute suggestion failed', e);
      toast((t('chat.suggExecuteError') || 'Could not execute suggestion: ') + e.message, true);
    }
  },

  async scheduleTaskInPlanner(title, dateStr, durationMinutes, description = '', extra = {}) {
    const workStart = window.settings?.ui?.workStartTime || "09:00";
    const workEnd = window.settings?.ui?.workEndTime || "17:00";
    
    const [startH, startM] = workStart.split(':').map(Number);
    const [endH, endM] = workEnd.split(':').map(Number);
    
    let startMin = startH * 60 + startM;
    const endMin = endH * 60 + endM;
    
    if (typeof plannerEvents === 'undefined' || !Array.isArray(plannerEvents)) {
      window.plannerEvents = [];
    }
    
    const dayEvents = plannerEvents.filter(e => e.date === dateStr);
    
    const timeToMin = (t) => {
      if (!t || typeof t !== 'string') return NaN;
      const parts = t.split(':');
      if (parts.length < 2) return NaN;
      const h = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      return isNaN(h) || isNaN(m) ? NaN : h * 60 + m;
    };
    
    const busySlots = dayEvents.map(e => {
      const start = timeToMin(e.startTime);
      const end = timeToMin(e.endTime || e.startTime) + Number(e.duration || 30);
      return { start, end };
    }).filter(s => !isNaN(s.start) && !isNaN(s.end))
      .sort((a, b) => a.start - b.start);
    
    let chosenStart = startMin;
    for (const slot of busySlots) {
      if (chosenStart + durationMinutes <= slot.start) {
        break;
      }
      chosenStart = Math.max(chosenStart, slot.end);
    }
    
    if (chosenStart + durationMinutes > endMin) {
      chosenStart = busySlots.length > 0 ? busySlots[busySlots.length - 1].end : startMin;
    }
    
    const startTime = formatMinutesToHHMM(chosenStart);
    const endTime = formatMinutesToHHMM(chosenStart + durationMinutes);
    
    const newEvent = {
      id: typeof generateUniqueId === 'function' ? generateUniqueId('evt') : ('evt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)),
      type: 'todo',
      title: title,
      date: dateStr,
      startTime: startTime,
      endTime: endTime,
      duration: durationMinutes,
      description: description || 'Tâche planifiée via l\'assistant IA.',
      noteId: extra.noteId || '',
      linkedNoteIds: extra.noteId ? [extra.noteId] : [],
      collaboratorIds: extra.collaboratorIds || [],
      collaborators: extra.collaborators || []
    };
    
    plannerEvents.push(newEvent);
    if (typeof savePlanner === 'function') {
      await savePlanner();
    } else {
      await StorageAPI.writePlanner({ events: plannerEvents });
    }
    if (typeof renderPlanner === 'function') renderPlanner();
    
    return { date: dateStr, startTime, endTime, id: newEvent.id };
  },

  resolveScheduleDate(dateInput) {
    const today = new Date();
    let target = new Date();
    
    const inputStr = String(dateInput || '').toLowerCase().trim();
    
    if (!inputStr || inputStr === 'tomorrow' || inputStr === 'demain') {
      target.setDate(today.getDate() + 1);
      const jsDay = target.getDay();
      if (jsDay === 6) target.setDate(target.getDate() + 2);
      else if (jsDay === 0) target.setDate(target.getDate() + 1);
    } else if (inputStr === 'today' || inputStr === "aujourd'hui") {
      // keep today
    } else if (inputStr === 'yesterday' || inputStr === 'hier') {
      target.setDate(today.getDate() - 1);
    } else {
      const parts = inputStr.split('-');
      if (parts.length === 3) {
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10) - 1;
        const d = parseInt(parts[2], 10);
        target = new Date(y, m, d);
      }
    }
    
    return typeof formatLocalDateValue === 'function' ? formatLocalDateValue(target) : target.toISOString().slice(0, 10);
  },

  handleSuggestionDblClick(msgIdx, actIdx) {
    const msg = this.messages[msgIdx];
    if (!msg || !msg.parsed || !Array.isArray(msg.parsed.suggested_actions)) return;
    const action = msg.parsed.suggested_actions[actIdx];
    if (!action) return;

    const isAccepted = !!action.accepted;
    const type = String(action.action || '').toLowerCase();
    const props = action.properties || {};

    if (isAccepted) {
      // The suggestion was already accepted, open the created item's modal for editing
      const createdId = action.createdId;
      if (!createdId) {
        toast("No created item ID found for this suggestion.", true);
        return;
      }
      if (type === 'create_todo' || type === 'update_todo' || type === 'modify_todo') {
        this.openTodoFromChat(createdId);
      } else if (type === 'create_event' || type === 'schedule_task' || type === 'update_event' || type === 'modify_event' || type === 'update_block' || type === 'modify_block') {
        if (typeof editPlannerEvent === 'function') {
          editPlannerEvent(createdId);
        } else {
          toast("Planner event edit function not found.", true);
        }
      } else if (type === 'create_note') {
        const manifestList = (typeof manifest !== 'undefined' && Array.isArray(manifest)) ? manifest : [];
        const note = manifestList.find(n => n.id === createdId || n.path === createdId);
        this.openNoteFromChat(note ? note.path : createdId, note ? note.title : '');
      } else if (type === 'create_colleague' || type === 'update_colleague' || type === 'modify_colleague') {
        const name = (typeof getColleagueLabelById === 'function' ? getColleagueLabelById(createdId) : '') || props.name || props.label;
        if (name && typeof showCollaboratorModal === 'function') {
          showCollaboratorModal(name);
        } else {
          toast("Colleague details modal not found or name invalid.", true);
        }
      }
    } else {
      // The suggestion is not yet accepted, open the creation modal with prefilled data
      if (type === 'create_todo') {
        if (typeof openNewTodoDialog === 'function') {
          AIChatController.activeSuggestionRoute = { msgIdx, actIdx };
          openNewTodoDialog({
            priority: props.priority || 'Medium',
            ownerId: props.assignee || props.owner || (typeof settings !== 'undefined' && settings ? settings.username : '') || 'me',
            focusTitle: true
          });
          const titleInput = document.getElementById('nt-title');
          const textInput = document.getElementById('nt-text');
          const contextInput = document.getElementById('nt-context');
          const dueDateInput = document.getElementById('nt-due-date');
          if (titleInput) titleInput.value = props.title || '';
          if (textInput) textInput.value = props.title || '';
          if (contextInput) contextInput.value = props.context || props.description || '';
          if (dueDateInput && (props.dueDate || props.due_date)) {
            dueDateInput.value = props.dueDate || props.due_date;
          }
        } else {
          toast("New todo dialog function not found.", true);
        }
      } else if (type === 'create_event' || type === 'schedule_task') {
        if (typeof openPlanEventModal === 'function') {
          AIChatController.activeSuggestionRoute = { msgIdx, actIdx };
          
          const { collaboratorIds, collaborators } = this.extractCollaboratorsFromProps(props);

          let prefill = {};
          if (type === 'create_event') {
            const duration = parseInt(props.duration) || 30;
            const startTime = props.time || props.startTime || '';
            let startMin = NaN;
            if (startTime && startTime.includes(':')) {
              const [h, m] = startTime.split(':').map(Number);
              if (!isNaN(h) && !isNaN(m)) startMin = h * 60 + m;
            }
            const endTime = isNaN(startMin) ? '' : formatMinutesToHHMM(startMin + duration);

            const validPlannerTypes = new Set(['call', 'sync', 'prep', 'todo', 'work', 'ooo', 'custom']);
            const eventType = (props.type && validPlannerTypes.has(String(props.type).toLowerCase()))
              ? String(props.type).toLowerCase()
              : (typeof inferPlannerEventType === 'function' ? inferPlannerEventType(props.title, props.description || props.details) : 'call');

            prefill = {
              title: props.title || 'Meeting from Chat',
              date: props.date || new Date().toISOString().slice(0, 10),
              startTime: startTime,
              endTime: endTime,
              duration: duration,
              type: eventType,
              description: props.description || props.details || '',
              collaboratorIds: collaboratorIds,
              collaborators: collaborators,
              noteId: props.noteId || ''
            };
          } else { // schedule_task
            const title = String(props.title || 'Task from Chat').slice(0, 120);
            const dateInput = props.date || 'tomorrow';
            const dateStr = this.resolveScheduleDate(dateInput);
            const duration = parseInt(props.duration) || 30;
            const desc = props.description || props.details || 'Tâche planifiée via l\'assistant IA.';
            prefill = {
              title: title,
              date: dateStr,
              duration: duration,
              description: desc,
              type: 'todo',
              collaboratorIds: collaboratorIds,
              collaborators: collaborators,
              noteId: props.noteId || ''
            };
          }
          openPlanEventModal(prefill);
        } else {
          toast("Planner event dialog function not found.", true);
        }
      } else if (type === 'create_colleague') {
        const name = props.name || props.label;
        if (name) {
          const id = (typeof resolveColleagueId === 'function') ? resolveColleagueId(name, { allowCreate: true }) : '';
          if (id) {
            // Apply proposed properties
            if (typeof colleaguesDb !== 'undefined' && colleaguesDb) {
              const colRecord = colleaguesDb.colleagues.find(c => c.id === id);
              if (colRecord) {
                if (props.team || props.teamId) {
                  const proposedTeam = props.team || props.teamId;
                  let teamRecord = colleaguesDb.teams.find(t => t.id === proposedTeam || t.name.toLowerCase() === String(proposedTeam).toLowerCase());
                  if (!teamRecord && proposedTeam) {
                    const newTeamId = 'team-' + proposedTeam.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                    teamRecord = {
                      id: newTeamId,
                      name: proposedTeam,
                      managerId: ''
                    };
                    colleaguesDb.teams.push(teamRecord);
                  }
                  if (teamRecord) colRecord.teamId = teamRecord.id;
                }

                const proposedManagerName = props.reportsTo || props.reports_to || props.manager;
                if (proposedManagerName) {
                  const managerId = (typeof resolveColleagueId === 'function')
                    ? resolveColleagueId(proposedManagerName, { allowCreate: true, allowMe: true })
                    : '';
                  if (managerId) {
                    let teamRecord = colleaguesDb.teams.find(t => t.managerId === managerId);
                    if (!teamRecord) {
                      const managerLabel = (typeof getColleagueLabelById === 'function')
                        ? getColleagueLabelById(managerId, proposedManagerName)
                        : proposedManagerName;
                      const newTeamId = 'team-' + managerId.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                      teamRecord = {
                        id: newTeamId,
                        name: `Team ${managerLabel}`,
                        managerId: managerId
                      };
                      colleaguesDb.teams.push(teamRecord);
                    }
                    colRecord.teamId = teamRecord.id;
                  }
                }

                if (props.isManager !== undefined || props.is_manager !== undefined) {
                  const isManager = !!(props.isManager !== undefined ? props.isManager : props.is_manager);
                  const teamRecord = colleaguesDb.teams.find(t => t.id === colRecord.teamId);
                  if (teamRecord && teamRecord.id !== 'team-other-bucket') {
                    if (isManager) teamRecord.managerId = id;
                  }
                }
              }
            }
            if (props.tags || props.labels) {
              const tags = Array.isArray(props.tags || props.labels)
                ? (props.tags || props.labels)
                : String(props.tags || props.labels).split(',').map(t => t.trim()).filter(Boolean);
              if (typeof setCollaboratorLabels === 'function') {
                setCollaboratorLabels(name, tags);
              }
            }
            
            if (typeof saveColleaguesDb === 'function') saveColleaguesDb();
            if (typeof reindexColleaguesDb === 'function') reindexColleaguesDb();
            if (typeof dedupeColleaguesWorkspaceData === 'function') dedupeColleaguesWorkspaceData({ persist: true });
            
            if (typeof renderTeamPanel === 'function') renderTeamPanel();
            if (typeof renderBoard === 'function') renderBoard();
            
            if (typeof showCollaboratorModal === 'function') {
              showCollaboratorModal(name);
            }
            
            action.accepted = true;
            action.createdId = id;
            AIChatController.saveCurrentConversation();
            AIChatController.renderMessages();
            toast(t('team.colleagueCreated', { name }) || `Colleague "${name}" created!`);
          } else {
            toast("Could not create colleague.", true);
          }
        } else {
          toast("Colleague name/label property is missing.", true);
        }
      } else if (type === 'update_colleague' || type === 'modify_colleague') {
        const id = props.id || (typeof resolveColleagueId === 'function' ? resolveColleagueId(props.oldName || props.name || props.label, { allowCreate: false, allowMe: false }) : '');
        if (id) {
          const colRecord = (id === 'me') ? colleaguesDb?.me : colleaguesDb?.colleagues?.find(c => c.id === id);
          if (colRecord) {
            if (props.name && id !== 'me') {
              colRecord.label = props.name;
            }
            if (props.team || props.teamId) {
              const proposedTeam = props.team || props.teamId;
              let teamRecord = colleaguesDb.teams.find(t => t.id === proposedTeam || t.name.toLowerCase() === String(proposedTeam).toLowerCase());
              if (!teamRecord && proposedTeam) {
                const newTeamId = 'team-' + proposedTeam.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                teamRecord = {
                  id: newTeamId,
                  name: proposedTeam,
                  managerId: ''
                };
                colleaguesDb.teams.push(teamRecord);
              }
              if (teamRecord) colRecord.teamId = teamRecord.id;
            }

            const proposedManagerName = props.reportsTo || props.reports_to || props.manager;
            if (proposedManagerName !== undefined) {
              if (!proposedManagerName) {
                colRecord.reportsTo = '';
                colRecord.managerId = '';
              } else {
                const managerId = (typeof resolveColleagueId === 'function')
                  ? resolveColleagueId(proposedManagerName, { allowCreate: true, allowMe: true })
                  : '';
                if (managerId) {
                  colRecord.reportsTo = proposedManagerName;
                  colRecord.managerId = managerId;
                  
                  let teamRecord = colleaguesDb.teams.find(t => t.managerId === managerId);
                  if (!teamRecord) {
                    const managerLabel = (typeof getColleagueLabelById === 'function')
                      ? getColleagueLabelById(managerId, proposedManagerName)
                      : proposedManagerName;
                    const newTeamId = 'team-' + managerId.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                    teamRecord = {
                      id: newTeamId,
                      name: `Team ${managerLabel}`,
                      managerId: managerId
                    };
                    colleaguesDb.teams.push(teamRecord);
                  }
                  colRecord.teamId = teamRecord.id;
                }
              }
            }

            if (props.isManager !== undefined || props.is_manager !== undefined) {
              const isManager = !!(props.isManager !== undefined ? props.isManager : props.is_manager);
              colRecord.isManager = isManager;
              const teamRecord = colleaguesDb.teams.find(t => t.id === colRecord.teamId);
              if (teamRecord && teamRecord.id !== 'team-other-bucket') {
                if (isManager) teamRecord.managerId = id;
                else if (teamRecord.managerId === id) teamRecord.managerId = '';
              }
            }
            
            if (props.tags || props.labels) {
              const tags = Array.isArray(props.tags || props.labels)
                ? (props.tags || props.labels)
                : String(props.tags || props.labels).split(',').map(t => t.trim()).filter(Boolean);
              if (typeof setCollaboratorLabels === 'function') {
                setCollaboratorLabels(colRecord.label, tags);
              }
            }

            if (typeof saveColleaguesDb === 'function') saveColleaguesDb();
            if (typeof reindexColleaguesDb === 'function') reindexColleaguesDb();
            if (typeof dedupeColleaguesWorkspaceData === 'function') dedupeColleaguesWorkspaceData({ persist: true });
            
            if (typeof renderTeamPanel === 'function') renderTeamPanel();
            if (typeof renderBoard === 'function') renderBoard();
            
            const activeName = colRecord.label;
            if (typeof showCollaboratorModal === 'function') {
              showCollaboratorModal(activeName);
            }
            
            action.accepted = true;
            AIChatController.saveCurrentConversation();
            AIChatController.renderMessages();
            toast(`Colleague "${activeName}" updated!`);
          }
        } else {
          toast("Colleague not found for editing.", true);
        }
      }
    }
  },

  openNoteFromChat(pathOrId, title = '') {
    if (!pathOrId) return;
    let resolvedPath = pathOrId;
    let resolvedId = '';

    const manifestList = (typeof manifest !== 'undefined' && Array.isArray(manifest)) ? manifest : [];
    const foundByPath = manifestList.find(n => n && n.path === pathOrId);
    const foundById = !foundByPath ? manifestList.find(n => n && (n.id === pathOrId || n.id === String(pathOrId))) : null;

    if (foundByPath) {
      resolvedPath = foundByPath.path;
      resolvedId = foundByPath.id || '';
    } else if (foundById) {
      resolvedPath = foundById.path;
      resolvedId = foundById.id;
    }

    if (window.AppBridge?.noteWindow?.open && (resolvedId || resolvedPath)) {
      window.AppBridge.noteWindow.open(resolvedId || resolvedPath, resolvedPath);
      return;
    }

    if (typeof openNoteOverlay === 'function') {
      openNoteOverlay(resolvedPath);
      return;
    }

    if (typeof toast === 'function') {
      toast(t('chat.noNotesFound') || 'Could not open note', true);
    }
  },

  openTodoFromChat(todoId) {
    if (!todoId) return;
    const cleanId = String(todoId).replace(/^#?todo:/i, '');
    if (typeof openTodoOverlay === 'function') {
      openTodoOverlay(cleanId);
      return;
    }
    if (typeof toast === 'function') {
      toast(t('chat.noTasksFound') || 'Could not open task', true);
    }
  },

  async openDecisionFromChat(decisionText) {
    if (!decisionText) return;
    const cleanText = String(decisionText).trim().toLowerCase();
    const manifestList = (typeof manifest !== 'undefined' && Array.isArray(manifest)) ? manifest : [];
    
    // Check manifest notes decisions array or notes containing the text
    let targetNote = manifestList.find(n => {
      if (Array.isArray(n.decisions) && n.decisions.some(d => String(d || '').toLowerCase().includes(cleanText))) {
        return true;
      }
      return false;
    });

    if (!targetNote && typeof noteContentCache !== 'undefined' && noteContentCache) {
      for (const [path, content] of Object.entries(noteContentCache)) {
        if (typeof content === 'string' && content.toLowerCase().includes(cleanText)) {
          targetNote = manifestList.find(n => n.path === path) || { path, title: path };
          break;
        }
      }
    }

    if (targetNote && targetNote.path) {
      this.openNoteFromChat(targetNote.path, targetNote.title);
      if (typeof toast === 'function') {
        toast((t('chat.openDecisionNoteTooltip') || 'Opening note for decision: ') + ' ' + (targetNote.title || targetNote.path));
      }
    } else {
      if (typeof toast === 'function') {
        toast(t('chat.noDecisionsFound') || 'No note found containing this decision', true);
      }
    }
  },

  toggleAttachNote(path, event) {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    const idx = this.attachedNotes.indexOf(path);
    if (idx >= 0) {
      this.attachedNotes.splice(idx, 1);
    } else {
      this.attachedNotes.push(path);
    }
    this.renderAttachments();
    this.renderModalSearchResults();
    this.saveCurrentConversation();
  },

  toggleAttachTask(id, event) {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    const idx = this.attachedTasks.indexOf(id);
    if (idx >= 0) {
      this.attachedTasks.splice(idx, 1);
    } else {
      this.attachedTasks.push(id);
    }
    this.renderAttachments();
    this.renderModalSearchResults();
    this.saveCurrentConversation();
  },

  toggleAttachEvent(id, event) {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    if (!this.attachedEvents) this.attachedEvents = [];
    const idx = this.attachedEvents.indexOf(id);
    if (idx >= 0) {
      this.attachedEvents.splice(idx, 1);
    } else {
      this.attachedEvents.push(id);
    }
    this.renderAttachments();
    this.saveCurrentConversation();
  },

  // Floating note link autocomplete triggered by '['
  handleInput(e) {
    const textarea = e.target;
    
    // Auto-grow textarea height
    textarea.style.height = 'auto';
    textarea.style.height = (textarea.scrollHeight) + 'px';

    const value = textarea.value;
    const selectionEnd = textarea.selectionEnd;
    const textBeforeCursor = value.slice(0, selectionEnd);
    
    // Check if cursor is directly preceded by '[' plus optional query text
    const match = textBeforeCursor.match(/\[([^\]]*)$/);
    if (match) {
      const query = match[1].toLowerCase();
      this.autocompleteFilteredNotes = manifest
        .filter(n => n.title.toLowerCase().includes(query))
        .slice(0, 10);
        
      if (this.autocompleteFilteredNotes.length > 0) {
        this.autocompleteOpen = true;
        this.autocompleteIndex = Math.min(this.autocompleteIndex, this.autocompleteFilteredNotes.length - 1);
        this.renderAutocompletePopup();
        return;
      }
    }
    
    this.closeAutocomplete();
  },

  handleKeyDown(e) {
    const textarea = e.target;
    
    if (this.autocompleteOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.autocompleteIndex = (this.autocompleteIndex + 1) % this.autocompleteFilteredNotes.length;
        this.renderAutocompletePopup();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.autocompleteIndex = (this.autocompleteIndex - 1 + this.autocompleteFilteredNotes.length) % this.autocompleteFilteredNotes.length;
        this.renderAutocompletePopup();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this.selectAutocompleteItem();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.closeAutocomplete();
      }
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (this.isThinking) this.stopCurrentRequest();
      else this.submitMessage();
    }
  },

  renderAutocompletePopup() {
    const popup = document.getElementById('chat-autocomplete-popup');
    if (!popup) return;

    popup.style.display = 'block';
    
    let html = '';
    this.autocompleteFilteredNotes.forEach((n, idx) => {
      const isActive = idx === this.autocompleteIndex;
      html += `
        <div class="chat-autocomplete-item ${isActive ? 'active' : ''}" onclick="AIChatController.selectAutocompleteItemIdx(${idx})">
          <span>📝 ${escH(n.title)}</span>
          <span class="chat-autocomplete-meta">${escH(n.date || '')}</span>
        </div>
      `;
    });
    
    popup.innerHTML = html;
  },

  closeAutocomplete() {
    this.autocompleteOpen = false;
    const popup = document.getElementById('chat-autocomplete-popup');
    if (popup) popup.style.display = 'none';
  },

  selectAutocompleteItem() {
    this.selectAutocompleteItemIdx(this.autocompleteIndex);
  },

  selectAutocompleteItemIdx(idx) {
    const textarea = document.getElementById('chat-input-textarea');
    if (!textarea) return;

    const note = this.autocompleteFilteredNotes[idx];
    if (!note) return;

    const value = textarea.value;
    const selectionEnd = textarea.selectionEnd;
    const textBeforeCursor = value.slice(0, selectionEnd);
    const textAfterCursor = value.slice(selectionEnd);
    
    const match = textBeforeCursor.match(/\[([^\]]*)$/);
    if (match) {
      const matchIndex = match.index;
      // Insert markdown link format [Note Title](note-path)
      const replacement = `[${note.title}](${note.path}) `;
      textarea.value = value.slice(0, matchIndex) + replacement + textAfterCursor;
      textarea.selectionEnd = matchIndex + replacement.length;
    }

    // Auto attach notes selected in autocomplete popup
    if (!this.attachedNotes.includes(note.path)) {
      this.attachedNotes.push(note.path);
      this.renderAttachments();
      this.saveCurrentConversation();
    }

    this.closeAutocomplete();
    textarea.focus();
  },

  async askFromOmnibar(query) {
    await switchTab('chat');
    if (this.messages.length > 0) {
      this.newConversation(true);
    }
    const textarea = document.getElementById('chat-input-textarea');
    if (textarea) {
      textarea.value = query;
      this.submitMessage();
    }
  },

  async submitMessage() {
    const textarea = document.getElementById('chat-input-textarea');
    if (!textarea) return;

    const text = textarea.value.trim();
    if (!text) return;

    const reasoningEffort = typeof getPromptThinkingEffort === 'function'
      ? getPromptThinkingEffort('chat-thinking-effort-select', 'chat', 'high')
      : 'high';

    textarea.value = '';
    textarea.style.height = '';
    this.closeAutocomplete();

    // Check if we need to auto-title this conversation
    const currentConv = this.conversations.find(c => c.id === this.currentConversationId);
    const isUntitled = currentConv && (currentConv.title === (t('chat.untitledChat') || 'New Conversation') || currentConv.title === 'Nouvelle conversation' || currentConv.title === 'New Conversation');

    const timestamp = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    this.messages.push({
      role: 'user',
      content: text,
      date: timestamp
    });

    if (isUntitled) {
      const generatedTitle = text.slice(0, 30) + (text.length > 30 ? '...' : '');
      this.renameConversation(this.currentConversationId, generatedTitle);
    }

    const requestController = new AbortController();
    this.currentRequestController = requestController;
    this.isThinking = true;
    this.thinkingMessage = t('chat.thinkingSearch') || 'Analyzing prompt...';
    this.syncThinkingControls();
    this.renderMessages();

    try {
      await this.runAgentLoop(text, requestController, reasoningEffort);
    } catch (e) {
      if (e && e.name === 'AbortError') {
        this.messages.push({
          role: 'assistant',
          content: `⏹ ${t('chat.stopped') || 'Generation stopped.'}`,
          date: new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
        });
      } else {
        console.error('Agent loop failed', e);
        this.messages.push({
          role: 'assistant',
          content: `❌ ${t('chat.errorPrefix') || 'Error'}: ${e.message}`,
          date: new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
        });
      }
    } finally {
      this.currentRequestController = null;
      this.isThinking = false;
      this.thinkingMessage = '';
      this.syncThinkingControls();
      this.renderMessages();
      this.saveCurrentConversation();
    }
  },

  // Recursive agent resolver loop (max 5 iterations)
  async runAgentLoop(originalPrompt, requestController = null, reasoningEffort = 'high') {
    const MAX_ITERATIONS = 5;
    let iteration = 0;
    
    // Copy the original conversation array to build prompt context
    const currentSessionMessages = this.messages.map(m => ({ role: m.role, content: m.content }));
    
    // Inject attached notes/tasks content as initial system block
    let attachedContextText = '';
    
    for (const path of this.attachedNotes) {
      try {
        const html = await StorageAPI.readNoteContent(path);
        let md = html;
        if (typeof turndownService !== 'undefined') {
          md = turndownService.turndown(html);
        }
        const note = manifest.find(n => n.path === path);
        if (typeof formatNoteContextForAI === 'function') {
          attachedContextText += formatNoteContextForAI(note || { path }, md);
        } else {
          attachedContextText += `Note attachée: "${note ? note.title : path}"\nContenu:\n${md}\n\n`;
        }
      } catch (err) {
        console.warn(`Could not read attached note ${path}`, err);
      }
    }

    for (const id of this.attachedTasks) {
      const todo = todosManifest.find(t => t.id === id);
      if (todo) {
        if (typeof formatTaskContextForAI === 'function') {
          attachedContextText += formatTaskContextForAI(todo);
        } else {
          attachedContextText += `Tâche attachée: [${todo.priority}] [Status: ${todo.status || 'Todo'}] "${todo.title}" (Assigné: ${todo.owner})\n\n`;
        }
      }
    }

    for (const id of this.attachedEvents || []) {
      const ev = plannerEvents.find(e => e.id === id);
      if (ev) {
        if (typeof formatPlannerEventContextForAI === 'function') {
          attachedContextText += formatPlannerEventContextForAI(ev);
        } else {
          attachedContextText += `Événement planifié attaché: [${ev.date}] ${ev.startTime || ''}-${ev.endTime || ''} "${ev.title}" (Description: ${ev.description || ''})\n\n`;
        }
      }
    }

    // Inject planner active week context if planner is active
    if (typeof activeTab !== 'undefined' && activeTab === 'planner' && typeof getPlannerDaysToDisplay === 'function') {
      try {
        const days = getPlannerDaysToDisplay();
        if (days && days.length > 0) {
          const rangeTitle = document.getElementById('planner-week-range-title')?.textContent || '';
          let plannerContext = `Planner actif - ${rangeTitle || 'Période active'}:\n`;
          
          const formattedDays = days.map(d => formatLocalDateValue(d));
          const minDateStr = formattedDays[0];
          const maxDateStr = formattedDays[formattedDays.length - 1];
          
          plannerContext += `Jours affichés: ${formattedDays.join(', ')}\n`;
          
          // Filter and serialize planner events in the visible range
          const visibleEvents = plannerEvents.filter(e => e.date >= minDateStr && e.date <= maxDateStr);
          if (visibleEvents.length > 0) {
            plannerContext += "Événements affichés dans le Planner:\n";
            visibleEvents.forEach(e => {
              plannerContext += `- [${e.date}] ${e.startTime || ''}-${e.endTime || ''} : "${e.title}" (Type: ${e.type || 'task'})\n`;
            });
          } else {
            plannerContext += "Aucun événement planifié pour cette période.\n";
          }
          attachedContextText += `${plannerContext}\n`;
        }
      } catch (err) {
        console.warn('Could not inject planner active context', err);
      }
    }

    if (attachedContextText) {
      currentSessionMessages.unshift({
        role: 'system',
        content: `Context initial attaché par l'utilisateur:\n${attachedContextText}`
      });
    }
    let workstreamCatalogStr = '';
    try {
      if (typeof WorkstreamMemoryEngine !== 'undefined' && WorkstreamMemoryEngine.getTopicMemoriesCatalog) {
        const catalog = await WorkstreamMemoryEngine.getTopicMemoriesCatalog({ includeArchived: true });
        if (catalog && catalog.length > 0) {
          workstreamCatalogStr = catalog.map(t => `- Workstream: "${t.topicName}" (Status: ${t.status}, Key: ${t.key}) | Summary: ${t.summary} | Facts: ${t.factsCount}, Decisions: ${t.decisionsCount}`).join('\n');
        }
      }
    } catch (_e) {}

    const activeChatLang = (typeof settings !== 'undefined' && settings?.ai?.language && settings.ai.language !== 'auto')
      ? settings.ai.language
      : (typeof getAppLanguage === 'function' ? getAppLanguage() : 'en');
    const chatLangName = (typeof AppPrompts !== 'undefined') ? AppPrompts.getLanguageName(activeChatLang) : 'Français';

    const systemPrompt = `Tu es l'assistant local "Secretary".
Tu es un assistant IA utile et réactif pour gérer les notes, tâches (todos), réunions du planner et mémoires de Workstreams.
Date/heure actuelle: ${new Date().toLocaleString()} (Aujourd'hui).

CATALOGUE DES MÉMOIRES DE WORKSTREAM EXISTANTES:
${workstreamCatalogStr || 'Aucune mémoire de workstream enregistrée pour le moment.'}

Tu as accès à des outils pour récupérer des informations. Pour appeler des outils, renvoie soit un bloc JSON unique sous cette forme :
{"action": "nom_de_l_outil", "properties": { ... }}
soit un tableau JSON contenant plusieurs appels d'outils si tu as besoin de faire plusieurs requêtes à la fois pour économiser des tours (fortement conseillé pour paralléliser et accélérer la réponse) :
[{"action": "outil_1", "properties": {...}}, {"action": "outil_2", "properties": {...}}]

Actions/Outils disponibles:
1. {"action": "find_relevant_notes", "properties": {"query": "ta question ou sujet précis"}} :
   Récupération intelligente (RAG multi-étapes) dans les notes. UTILISE EN PRIORITÉ pour toute question sur des activités passées, réunions, projets, personnes, ou périodes de temps. Cet outil identifie les notes les plus pertinentes, lit leurs résumés et inclut automatiquement les notes associées.

2. {"action": "get_planner_events", "properties": {"date": "yesterday" | "today" | "tomorrow" | "YYYY-MM-DD"}} :
   Récupère les réunions et appels du planner pour une date.

3. {"action": "get_note_content", "properties": {"path": "notes/..."}} :
   Récupère le texte complet d'une note. Utilise uniquement si tu connais déjà le chemin exact.

4. {"action": "get_tasks", "properties": {"status": "pending" | "done" | "all", "note_ids": ["id1", "id2"]}} :
   Récupère les tâches. Le champ note_ids (optionnel) filtre les tâches liées à des notes spécifiques.

5. {"action": "search_notes", "properties": {"query": "mots-clés optionnels", "colleague": "nom de collègue optionnel", "tag": "tag optionnel", "group": "groupe optionnel", "workstream": "workstream optionnel", "offset": 0, "limit": 15}} :
   Recherche paginée de notes par mots-clés (dans le titre, les tags ou le contenu complet de la note), collègue, tag, groupe ou workstream. Pour explorer l'ensemble des résultats de 1 à n, puis n+1 à n+x, utilise "offset" (ex: 0, puis 15, 30...) et "limit".

6. {"action": "get_colleague_org_relationship", "properties": {"colleague": "nom de collègue"}} :
   Permet de savoir où se trouve un collègue dans la structure organisationnelle par rapport à vous (manager direct N+1, responsable supérieur, pair, collaborateur direct N-1, etc.).

7. {"action": "mark_note_reviewed", "properties": {"path": "chemin de la note", "reviewed": true | false}} :
   Marque une note comme validée (reviewed: true) ou non validée (reviewed: false) dans le système.

8. {"action": "search_colleagues", "properties": {"query": "nom ou partie du nom de collègue"}} :
   Recherche dans l'annuaire des collègues pour retrouver l'ID exact (ex: "colleague-alex-g"), l'équipe ou le rôle d'un collègue.

9. {"action": "get_workstream_catalog", "properties": {"include_archived": boolean}} :
   Récupère la liste catalogue de tous les dossiers de mémoire de Workstream/Sujets majeurs avec leurs résumés en 1 phrase, leur nombre de faits et décisions, et leur statut.

10. {"action": "get_workstream_memory", "properties": {"workstream": "nom ou clé du workstream"}} :
   Récupère le dossier complet de mémoire d'un Workstream (résumé exécutif, faits clés, jalons actifs, décisions, sujets ouverts, participants, notes associées).

11. {"action": "search_workstream_memories", "properties": {"query": "terme ou regex de recherche"}} :
   Recherche dans l'ensemble des mémoires de Workstreams actifs et archivés.

12. {"action": "synthesize_workstream_memory", "properties": {"workstream": "nom du workstream", "prompt": "instructions optionnelles"}} :
   Déclenche la synthèse automatique approfondie d'un Workstream par l'agent IA spécialisé.

Directives importantes:
- Si tu suggères d'attribuer une tâche à un collègue spécifique, appelle TOUJOURS l'outil "search_colleagues" au préalable pour retrouver son ID exact (ex: "colleague-alex-g"). Renseigne ensuite cet ID exact dans la propriété "assignee" de tes suggestions de tâches.
- Si l'utilisateur te demande de rajouter, créer ou enregistrer un nouveau collègue (avec éventuellement son équipe, le responsable/manager auquel il reporte, son statut de manager ou des tags), suggère l'action "create_colleague". Si l'utilisateur précise que le nouveau collègue reporte à (ou est géré par) un autre collègue/collaborateur (ex: "reports to Alex" ou "sous la responsabilité de Alex"), utilise d'abord "search_colleagues" pour vérifier si ce responsable gère/dirige une équipe. Si ce responsable gère/dirige une équipe existante, cela implique que le nouveau collègue doit être ajouté à cette équipe : renseigne alors le "teamId" avec l'ID de cette équipe et le champ "reportsTo" avec le nom du responsable.
- Si l'utilisateur te demande de modifier, renommer ou changer les informations d'un collègue existant (ex: changer son équipe, le définir comme manager, ajouter un responsable/manager auquel il reporte, ou ajouter des tags/labels), suggère l'action "update_colleague" / "modify_colleague". Si le responsable mentionné gère/dirige une équipe, renseigne le "teamId" avec l'ID de cette équipe et le champ "reportsTo" avec le nom du responsable.
- Si tu as un doute ou si le nom du collègue ou les informations sont incomplètes, ou si tu as besoin de plus de contexte (background/what happened), suggère l'action "ask_questions" avec une ou plusieurs questions. Propose des options de réponse et/ou laisse un champ libre pour que l'utilisateur puisse saisir sa propre réponse s'il a un autre avis ou veut donner du background.
- Si l'utilisateur te demande de configurer, ajouter ou définir le responsable/boss d'un collègue (ex: "please setup his boss"), mais que l'identité ou les informations de ce boss ne sont pas mentionnées dans la conversation, tu DOIS arrêter d'appeler des outils et immédiatement renvoyer l'action "ask_questions" pour lui demander qui est ce boss.
- Limite tes appels d'outils: max 4 tours. Dès que tu as assez d'informations, réponds directement.
- Si tu proposes de créer ou modifier des éléments, utilise ce format JSON de réponse finale:
  {
    "general_comment": "Ton commentaire ou résumé final pour l'utilisateur en texte Markdown.",
    "suggested_actions": [
      {
        "action": "create_todo",
        "properties": {
          "title": "Titre court de la tâche",
          "quadrant": "Q1 | Q2 | Q3 | Q4 (Q1=Urgent&Important, Q2=Important, Q3=Urgent, Q4=Eliminate)",
          "assignee": "me" | "ID du collègue résolu (ex: colleague-alex-g)",
          "dueDate": "YYYY-MM-DD (optionnel)",
          "context": "Description / contexte détaillé (optionnel)"
        }
      },
      {
        "action": "update_todo",
        "properties": {
          "id": "ID de la tâche à modifier (ex: todo-123456789)",
          "title": "Nouveau titre (optionnel)",
          "quadrant": "Q1 | Q2 | Q3 | Q4 (optionnel)",
          "assignee": "me" | "ID du collègue résolu" (optionnel),
          "dueDate": "YYYY-MM-DD" (optionnel),
          "context": "Nouvelle description" (optionnel),
          "status": "WIP" | "" | "Done" (optionnel)
        }
      },
      {
        "action": "schedule_task",
        "properties": {
          "title": "Sujet/Titre du bloc de travail",
          "date": "YYYY-MM-DD" ou "tomorrow" ou "today",
          "duration": 30,
          "description": "Description ou détails",
          "withWhom": "Nom ou ID de collègue (optionnel)",
          "noteTitle": "Titre d'une nouvelle note à créer et lier au bloc (optionnel)",
          "noteContent": "Contenu initial de la note à créer (optionnel)"
        }
      },
      {
        "action": "create_note",
        "properties": {
          "title": "Titre de la note",
          "group": "Daily" | "Calls" | "Work",
          "content": "Contenu initial de la note en Markdown"
        }
      },
      {
        "action": "create_event",
        "properties": {
          "title": "Sujet de la réunion",
          "date": "YYYY-MM-DD",
          "time": "HH:MM",
          "duration": 30,
          "type": "event" | "call" | "sync",
          "description": "Détails",
          "withWhom": "Nom, ID ou liste de noms/IDs de collègues (optionnel)",
          "noteTitle": "Titre d'une nouvelle note à créer et lier au bloc (optionnel)",
          "noteContent": "Contenu de la note à créer (optionnel)"
        }
      },
      {
        "action": "update_event",
        "properties": {
          "id": "ID du bloc/réunion à modifier (ex: evt-123456789)",
          "title": "Nouveau sujet (optionnel)",
          "date": "YYYY-MM-DD" (optionnel),
          "time": "HH:MM" (optionnel),
          "duration": 30 (optionnel),
          "type": "event" | "call" | "sync" | "work" (optionnel),
          "description": "Nouvelle description" (optionnel),
          "withWhom": "Nom, ID ou liste de noms/IDs de collègues (optionnel)",
          "noteTitle": "Titre d'une nouvelle note à créer et lier au bloc (optionnel)",
          "noteContent": "Contenu de la note à créer (optionnel)"
        }
      },
      {
        "action": "create_colleague",
        "properties": {
          "name": "Nom complet du collègue (requis)",
          "teamId": "team-my-team (directs) | team-my-own-team (peers) | team-other-bucket (autre) (optionnel)",
          "reportsTo": "Nom ou ID du responsable/manager auquel il reporte (optionnel)",
          "isManager": true | false (optionnel, true si manager de son équipe),
          "tags": ["tag1", "tag2"] (optionnel)
        }
      },
      {
        "action": "ask_questions",
        "properties": {
          "questions": [
            {
              "id": "identifiant_unique (ex: name_check, background_info)",
              "text": "Texte de la question à poser (ex: Quel est le nom de famille de Jean ?)",
              "options": ["Choix A", "Choix B"] (optionnel, si tu proposes des choix),
              "allow_custom": true | false (optionnel, true par défaut, pour autoriser une réponse libre)
            }
          ]
        }
      },
      {
        "action": "update_colleague",
        "properties": {
          "id": "ID du collègue (ex: colleague-alex-g) ou 'me' (optionnel si oldName fourni)",
          "oldName": "Nom actuel du collègue (optionnel si id fourni)",
          "name": "Nouveau nom/label si renommage (optionnel)",
          "teamId": "Nouveau teamId (optionnel)",
          "reportsTo": "Nom ou ID du nouveau responsable/manager auquel il reporte (optionnel)",
          "isManager": true | false (optionnel),
          "tags": ["tag1", "tag2"] (optionnel)
        }
      }
    ]
  }
- Si tu n'as pas besoin d'actions de création, de modification, ou de poser des questions à l'utilisateur (via l'action ask_questions), réponds en TEXTE SIMPLE directement.
- Si l'utilisateur te demande de lui poser une question (ex: "pose-moi une question", "ask me a question"), ou si tu as un doute ou besoin de clarifications/contextes, tu DOIS TOUJOURS renvoyer un objet JSON contenant l'action "ask_questions" dans "suggested_actions", et ne surtout pas juste répondre en texte simple.
- Directive de langue: Tu DOIS formuler toutes tes réponses, explications, questions et propositions strictement en ${chatLangName} (${activeChatLang}).`;

    currentSessionMessages.unshift({ role: 'system', content: systemPrompt });

    while (iteration < MAX_ITERATIONS) {
      iteration++;

      if (iteration === MAX_ITERATIONS) {
        currentSessionMessages.push({
          role: 'system',
          content: `Attention: L'exécution des outils a atteint sa limite maximale. Réponds directement à l'utilisateur maintenant sous forme de texte simple en ${chatLangName}, en synthétisant et en concluant avec les informations récoltées jusqu'ici. N'appelle plus d'outils.`
        });
      }

      const response = await LLMService.chat(currentSessionMessages, {
        controller: requestController,
        timeoutMs: 0,
        reasoningEffort
      });
      
      let toolRequests = [];
      
      if (iteration < MAX_ITERATIONS) {
        toolRequests = this.extractToolRequests(response);
      }

      if (toolRequests.length > 0) {
        let resultParts = [];
        
        for (const req of toolRequests) {
          const actionType = String(req.action || req.name || req.function?.name || '').toLowerCase();
          let props = req.properties || req.arguments || req.parameters || req.props || req.params || {};
          if (typeof props === 'string') {
            try { props = JSON.parse(props); } catch (e) { props = {}; }
          }
          if (!props || typeof props !== 'object') props = {};
          let resultText = '';
          
          if (actionType === 'get_planner_events' || actionType === 'get_events' || actionType === 'get_planner' || actionType === 'planner_events' || actionType === 'list_events') {
            const relDate = props.date || props.day || props.target_date || 'today';
            const resolved = this.resolveRelativeDate(relDate);
            this.thinkingMessage = `Retrieving meetings for ${relDate} (${resolved})...`;
            this.renderMessages();
            
            const evtsList = Array.isArray(plannerEvents) ? plannerEvents : (plannerEvents?.events || []);
            const evts = evtsList.filter(e => e.date === resolved);
            if (evts.length === 0) {
              resultText = `Aucun événement dans le planner le ${resolved}.`;
            } else {
              resultText = evts.map(e => {
                return `- Event: "${e.title}" (${e.time || e.startTime || ''}, Duration: ${e.duration || ''}m, Type: ${e.type || 'meeting'})\n  Description: ${e.description || 'none'}\n  Linked notes paths: ${JSON.stringify(e.linkedNoteIds || [])}`;
              }).join('\n');
            }
          } 
          else if (actionType === 'get_note_content' || actionType === 'read_note' || actionType === 'get_note' || actionType === 'read_note_content') {
            let path = props.path || props.note_path || props.id || props.note_id || props.noteId || '';
            this.thinkingMessage = `Reading note content: ${path.split('/').pop()}...`;
            this.renderMessages();
            
            if (!path) {
              resultText = `Erreur: Chemin de note vide.`;
            } else {
              // Resolve note IDs or short names to correct paths from manifest
              if (!path.startsWith('notes/') && !path.endsWith('.html')) {
                const noteEntry = manifest.find(n => n.id === path || n.path.includes(path));
                if (noteEntry) {
                  path = noteEntry.path;
                } else {
                  path = 'notes/' + path + '.html';
                }
              }

              try {
                const html = await StorageAPI.readNoteContent(path);
                let md = html;
                if (typeof turndownService !== 'undefined') {
                  md = turndownService.turndown(html);
                }
                resultText = `Contenu de la note "${path}":\n${md}`;
              } catch (err) {
                resultText = `Erreur lors de la lecture de la note "${path}": ${err.message}`;
              }
            }
          } 
          else if (actionType === 'find_relevant_notes' || actionType === 'search_relevant_notes' || actionType === 'get_relevant_notes' || actionType === 'retrieve_relevant_notes') {
            const query = String(props.query || props.question || props.prompt || props.search || originalPrompt || '').trim();
            this.thinkingMessage = t('chat.searchingContext') || 'Identifying relevant notes...';
            this.renderMessages();
            try {
              const context = await LLMService.retrieveRelevantNotesContext(query, {
                controller: requestController
              });
              resultText = context || `Aucune note pertinente trouvée pour la question: "${query}".`;
            } catch (err) {
              console.error('find_relevant_notes tool failed', err);
              resultText = `Erreur lors de la récupération intelligente des notes: ${err.message}`;
            }
          }
          else if (actionType === 'get_tasks' || actionType === 'get_todos' || actionType === 'list_tasks' || actionType === 'list_todos') {
            const status = props.status || props.filter || 'all';
            const rawNoteIds = props.note_ids || props.noteIds || props.note_id || props.noteId;
            const noteIds = Array.isArray(rawNoteIds) ? rawNoteIds : (rawNoteIds ? [rawNoteIds] : null);
            this.thinkingMessage = `Fetching tasks (status: ${status}${noteIds ? ', filtered by notes' : ''})...`;
            this.renderMessages();
            
            let evts = todosManifest;
            if (status === 'pending') {
              evts = evts.filter(t => t.priority !== 'Done');
            } else if (status === 'done') {
              evts = evts.filter(t => t.priority === 'Done');
            }
            if (noteIds) {
              evts = evts.filter(t => noteIds.includes(t.noteId));
            }
            if (evts.length === 0) {
              resultText = noteIds
                ? `Aucune tâche trouvée pour les notes spécifiées.`
                : `Aucune tâche trouvée (status: ${status}).`;
            } else {
              resultText = evts.slice(0, 40).map(t => `- [${t.priority}] "${t.title}" (Assigné: ${t.owner || 'me'}, NoteId: ${t.noteId || 'none'})`).join('\n');
            }
          } 
          else if (actionType === 'search_notes' || actionType === 'find_notes' || actionType === 'query_notes') {
            this.thinkingMessage = `Searching notes...`;
            this.renderMessages();
            resultText = await this.executeSearchNotesTool(props);
          }
          else if (actionType === 'get_colleague_org_relationship' || actionType === 'get_colleague_relationship' || actionType === 'get_colleague_org' || actionType === 'get_org_relationship' || actionType === 'colleague_org_relationship') {
            const colleague = String(props.colleague || props.name || props.colleague_name || props.person || props.user || '').trim();
            this.thinkingMessage = `Recherche de la relation pour "${colleague}"...`;
            this.renderMessages();
            
            const cleanColleagueName = colleague.replace(/^@/, '').trim();
            const colleagueId = (typeof resolveColleagueId === 'function')
              ? resolveColleagueId(cleanColleagueName, { allowCreate: false, allowMe: true })
              : '';
              
            if (!colleagueId) {
              resultText = `Collègue "${colleague}" non trouvé dans la base de données de l'organisation.`;
            } else {
              let relationship = '';
              const myManagerChain = (typeof getColleagueManagerChain === 'function') ? getColleagueManagerChain('me') : [];
              const indexInChain = myManagerChain.indexOf(colleagueId);
              const isManager = (indexInChain === 0);
              const isGrandManager = (indexInChain > 0);
              
              const myDirects = (typeof getColleagueDirects === 'function') ? getColleagueDirects('me') : [];
              const isDirectReport = myDirects.some(c => c.id === colleagueId);
              
              const myPeers = (typeof getColleaguePeers === 'function') ? getColleaguePeers('me') : [];
              const isPeer = myPeers.some(c => c.id === colleagueId);
              
              const colleagueChain = (typeof getColleagueManagerChain === 'function') ? getColleagueManagerChain(colleagueId) : [];
              const reportsToMeIndirectly = colleagueChain.includes('me') && !isDirectReport;
              
              if (colleagueId === 'me') {
                relationship = 'C\'est vous (Moi).';
              } else if (isManager) {
                relationship = 'Votre manager direct (N+1).';
              } else if (isGrandManager) {
                relationship = `Votre responsable de niveau supérieur (N+${indexInChain + 1}) dans votre ligne hiérarchique directe.`;
              } else if (isDirectReport) {
                relationship = 'Votre collaborateur direct (N-1).';
              } else if (isPeer) {
                relationship = 'Votre pair (collègue dans la même équipe).';
              } else if (reportsToMeIndirectly) {
                relationship = 'Un collaborateur indirect sous votre direction dans la structure.';
              } else {
                relationship = 'Membre de l\'organisation hors de votre ligne de reporting direct.';
              }
              
              const db = (typeof window !== 'undefined' && window.colleaguesDb) || (typeof colleaguesDb !== 'undefined' ? colleaguesDb : null);
              const rec = (typeof colleaguesById !== 'undefined') ? colleaguesById.get(colleagueId) : (db?.colleagues?.find(c => c.id === colleagueId) || (colleagueId === 'me' ? db?.me : null));
              const team = (rec && rec.teamId && db?.teams) ? db.teams.find(t => t.id === rec.teamId) : null;
              const teamName = team ? team.name : 'Inconnu';
              const managerId = (typeof getColleagueManagerId === 'function') ? getColleagueManagerId(colleagueId) : '';
              const managerLabel = managerId ? (typeof getColleagueLabelById === 'function' ? getColleagueLabelById(managerId, 'Inconnu') : managerId) : 'Aucun';
              
              resultText = `Relation organisationnelle pour "${cleanColleagueName}" :
- ID : ${colleagueId}
- Nom complet : ${rec ? rec.label : cleanColleagueName}
- Relation avec vous : ${relationship}
- Équipe : ${teamName}
- Manager direct : ${managerLabel}
- Ligne hiérarchique du collègue : ${colleagueChain.map(id => (typeof getColleagueLabelById === 'function' ? getColleagueLabelById(id, id) : id)).join(' -> ') || 'Aucune'}`;
            }
          }
          else if (actionType === 'mark_note_reviewed' || actionType === 'set_note_reviewed' || actionType === 'review_note') {
            const path = props.path || props.note_path || props.id || props.note_id || '';
            const reviewed = props.reviewed !== false && props.is_reviewed !== false;
            this.thinkingMessage = `Validation de la note...`;
            this.renderMessages();
            
            if (!path) {
              resultText = `Erreur: Chemin de note vide.`;
            } else {
              let resolvedPath = path;
              if (!resolvedPath.startsWith('notes/') && !resolvedPath.endsWith('.html')) {
                const noteEntry = manifest.find(n => n.id === resolvedPath || n.path.includes(resolvedPath));
                if (noteEntry) {
                  resolvedPath = noteEntry.path;
                } else {
                  resolvedPath = 'notes/' + resolvedPath + '.html';
                }
              }
              
              try {
                if (window.DailyReviewController && typeof window.DailyReviewController.toggleNoteReviewed === 'function') {
                  await window.DailyReviewController.toggleNoteReviewed(resolvedPath, reviewed);
                } else {
                  const originalHTML = await StorageAPI.readNoteContent(resolvedPath);
                  const parsed = parseNoteHTML(originalHTML);
                  const entry = manifest.find(n => n.path === resolvedPath);
                  const base = buildEditableNoteData(parsed, entry);
                  const changes = { ...base, reviewed };
                  const updatedHTML = applyNoteEdits(originalHTML, changes);
                  await StorageAPI.writeNoteContent(resolvedPath, updatedHTML);
                  upsertManifest({ ...entry, ...changes, reviewed, originalHTML: updatedHTML, modified: new Date().toISOString() });
                  await saveManifest({ force: true });
                }
                resultText = `Note "${resolvedPath}" marquée comme ${reviewed ? 'validée (reviewed)' : 'non validée'}.`;
              } catch (err) {
                resultText = `Erreur lors de la validation de la note "${resolvedPath}": ${err.message}`;
              }
            }
          }
          else if (actionType === 'search_colleagues' || actionType === 'find_colleagues' || actionType === 'get_colleagues' || actionType === 'search_colleague' || actionType === 'find_colleague' || actionType === 'list_colleagues' || actionType === 'colleagues' || actionType === 'colleague_search') {
            const query = String(props.query || props.name || props.colleague || props.collaborator || props.person || props.user || props.search || '').trim().toLowerCase();
            this.thinkingMessage = t('chat.searchingColleague') || 'Searching colleagues...';
            this.renderMessages();
            
            const db = (typeof window !== 'undefined' && window.colleaguesDb) || (typeof colleaguesDb !== 'undefined' ? colleaguesDb : null);
            if (!db || !Array.isArray(db.colleagues)) {
              resultText = "Base de données des collègues non disponible.";
            } else {
              let matches = [];
              if (!query || query === 'all' || query === '*' || query === 'tous') {
                if (db.me) matches.push(db.me);
                matches.push(...db.colleagues);
              } else if (query === 'me' || query === 'moi' || query === 'myself') {
                if (db.me) {
                  matches.push(db.me);
                }
              } else {
                matches = db.colleagues.filter(c => {
                  const label = (c.label || '').toLowerCase();
                  const id = (c.id || '').toLowerCase();
                  const role = (c.role || '').toLowerCase();
                  const teamId = (c.teamId || '').toLowerCase();
                  const team = db.teams?.find(t => t.id === c.teamId);
                  const teamName = (team?.name || '').toLowerCase();
                  const tags = Array.isArray(c.tags) ? c.tags.map(t => String(t).toLowerCase()) : [];
                  const matchesTeam = query.length > 1 ? (teamId.includes(query) || teamName.includes(query)) : false;
                  const matchesTags = tags.some(t => t.includes(query));
                  return label.includes(query) || id.includes(query) || role.includes(query) || matchesTeam || matchesTags;
                });
                if (db.me && ((db.me.label || '').toLowerCase().includes(query) || (db.me.role || '').toLowerCase().includes(query))) {
                  matches.unshift(db.me);
                }
              }
              
              if (matches.length === 0) {
                resultText = `Aucun collègue ne correspond à la recherche "${query}".`;
              } else {
                resultText = `Collègues trouvés (${matches.length}) :\n` + matches.map(c => {
                  const team = db.teams?.find(t => t.id === c.teamId);
                  const managedTeams = db.teams?.filter(t => t.managerId === c.id) || [];
                  const managesText = managedTeams.length > 0
                    ? `dirige l'équipe : ${managedTeams.map(t => `${t.name} (${t.id})`).join(', ')}`
                    : 'ne dirige aucune équipe';
                  const tagsText = Array.isArray(c.tags) && c.tags.length > 0 ? ` (Tags: ${c.tags.join(', ')})` : '';
                  return `- Nom: ${c.label}\n  ID: ${c.id}\n  Rôle: ${c.role || 'non spécifié'}${tagsText}\n  Équipe: ${team ? team.name : 'sans équipe'}\n  Management: ${managesText}`;
                }).join('\n\n');
              }
            }
          }
          else if (actionType === 'get_workstream_catalog' || actionType === 'list_workstreams' || actionType === 'get_workstreams') {
            this.thinkingMessage = 'Loading workstream memory catalog...';
            this.renderMessages();
            if (typeof WorkstreamMemoryEngine !== 'undefined' && WorkstreamMemoryEngine.getTopicMemoriesCatalog) {
              const catalog = await WorkstreamMemoryEngine.getTopicMemoriesCatalog({ includeArchived: props.include_archived !== false });
              if (catalog.length === 0) {
                resultText = 'Aucune mémoire de workstream trouvée dans le catalogue.';
              } else {
                resultText = `Mémoires de Workstream disponibles (${catalog.length}) :\n` + catalog.map(t =>
                  `- Workstream: "${t.topicName}" (Key: ${t.key}, Statut: ${t.status})\n  Résumé: ${t.summary}\n  Faits: ${t.factsCount}, Décisions: ${t.decisionsCount}, Notes associées: ${t.associatedNotesCount}`
                ).join('\n\n');
              }
            } else {
              resultText = 'WorkstreamMemoryEngine indisponible.';
            }
          }
          else if (actionType === 'get_workstream_memory' || actionType === 'read_workstream_memory' || actionType === 'get_topic_memory') {
            const wsName = props.workstream || props.topic || props.key || props.name || '';
            this.thinkingMessage = `Loading workstream dossier for "${wsName}"...`;
            this.renderMessages();
            if (typeof WorkstreamMemoryEngine !== 'undefined' && WorkstreamMemoryEngine.getMajorTopicMemory) {
              const mem = await WorkstreamMemoryEngine.getMajorTopicMemory(wsName);
              if (!mem) {
                resultText = `Aucun dossier de mémoire trouvé pour le workstream "${wsName}".`;
              } else {
                resultText = `Dossier de mémoire pour "${mem.topicName || wsName}" (Statut: ${mem.status || 'active'}, Pinned: ${!!mem.pinned}) :
- Résumé exécutif: ${mem.summary || 'Aucun'}
- Résumé 1-phrase: ${mem.oneSentenceSummary || 'Aucun'}
- Faits clés (${(mem.keyFacts || []).length}): ${(mem.keyFacts || []).join(' | ')}
- Jalons actifs (${(mem.activeMilestones || []).length}): ${(mem.activeMilestones || []).map(m => typeof m === 'string' ? m : `${m.title} [${m.status || 'pending'}]`).join(' | ')}
- Décisions prises (${(mem.decisions || []).length}): ${(mem.decisions || []).map(d => typeof d === 'string' ? d : (d.text || JSON.stringify(d))).join(' | ')}
- Sujets ouverts (${(mem.openThreads || []).length}): ${(mem.openThreads || []).join(' | ')}
- Participants (${(mem.participants || []).length}): ${(mem.participants || []).join(', ')}
- Notes associées (${(mem.associatedNotes || []).length}): ${(mem.associatedNotes || []).map(n => typeof n === 'string' ? n : n.title).join(', ')}`;
              }
            } else {
              resultText = 'WorkstreamMemoryEngine indisponible.';
            }
          }
          else if (actionType === 'search_workstream_memories' || actionType === 'find_workstream_memories') {
            const query = String(props.query || props.search || '').trim();
            this.thinkingMessage = `Searching workstream memories for "${query}"...`;
            this.renderMessages();
            if (typeof WorkstreamMemoryEngine !== 'undefined' && WorkstreamMemoryEngine.searchTopicMemories) {
              const results = await WorkstreamMemoryEngine.searchTopicMemories(query);
              if (results.length === 0) {
                resultText = `Aucun résultat dans les mémoires de workstream pour "${query}".`;
              } else {
                resultText = `Résultats de recherche dans les mémoires de workstream (${results.length}) :\n` + results.map(r =>
                  `--- Workstream: "${r.topicName}" (${r.status}) ---\nRésumé: ${r.summary}\nMatches: ${r.snippets.map(s => s.match).join(' | ')}`
                ).join('\n\n');
              }
            } else {
              resultText = 'WorkstreamMemoryEngine indisponible.';
            }
          }
          else if (actionType === 'synthesize_workstream_memory' || actionType === 'generate_workstream_memory') {
            const wsName = props.workstream || props.topic || props.name || '';
            const prompt = props.prompt || props.instructions || '';
            this.thinkingMessage = `Synthesizing workstream memory with AI for "${wsName}"...`;
            this.renderMessages();
            if (typeof WorkstreamMemoryEngine !== 'undefined' && WorkstreamMemoryEngine.synthesizeWorkstreamMemoryWithAI) {
              const mem = await WorkstreamMemoryEngine.synthesizeWorkstreamMemoryWithAI(wsName, { prompt });
              if (!mem) {
                resultText = `Échec de la synthèse IA de la mémoire de workstream pour "${wsName}".`;
              } else {
                resultText = `✨ Mémoire de workstream pour "${mem.topicName}" synthétisée avec succès par l'agent IA !\n- Résumé exécutif: ${mem.summary}\n- Faits clés: ${(mem.keyFacts || []).length}\n- Jalons: ${(mem.activeMilestones || []).length}\n- Décisions: ${(mem.decisions || []).length}`;
              }
            } else {
              resultText = 'WorkstreamMemoryEngine indisponible.';
            }
          } else {
            resultText = `Outil inconnu ou non supporté: ${actionType}`;
          }

          resultParts.push(`Tool execution result for ${actionType}:\n${resultText}`);
        }

        // Push the tool request turn and system response turn to conversation history
        currentSessionMessages.push({
          role: 'assistant',
          content: response.reply || JSON.stringify(toolRequests)
        });
        currentSessionMessages.push({
          role: 'user',
          content: `[SYSTEM] ${resultParts.join('\n\n')}`
        });
        
        continue; // Run next iteration
      }

      // If the LLM didn't request a tool or it returned a final response JSON/text:
      let replyContent = response.reply;
      let parsed = null;
      if (response.parsed && (response.parsed.general_comment || response.parsed.suggested_actions)) {
        replyContent = response.parsed.general_comment || '';
        parsed = response.parsed;
      }
      
      const timestamp = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      this.messages.push({
        role: 'assistant',
        content: replyContent,
        parsed: parsed,
        date: timestamp
      });
      
      if (parsed && Array.isArray(parsed.suggested_actions)) {
        const askActIdx = parsed.suggested_actions.findIndex(act => String(act.action || '').toLowerCase() === 'ask_questions');
        if (askActIdx !== -1) {
          const msgIdx = this.messages.length - 1;
          setTimeout(() => {
            this.openQuestionsPopup(msgIdx, askActIdx);
          }, 100);
        }
      }
      
      break;
    }
  },

  resolveRelativeDate(dateStr) {
    const today = new Date();
    const normalized = String(dateStr || '').trim().toLowerCase();
    
    if (normalized === 'today' || normalized === 'aujourd\'hui' || normalized === 'aujourd’hui') {
      return today.toISOString().slice(0, 10);
    }
    if (normalized === 'yesterday' || normalized === 'hier') {
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      return yesterday.toISOString().slice(0, 10);
    }
    if (normalized === 'tomorrow' || normalized === 'demain') {
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);
      return tomorrow.toISOString().slice(0, 10);
    }
    if (normalized.includes('thursday') || normalized.includes('jeudi')) {
      const res = new Date(today);
      while (res.getDay() !== 4) res.setDate(res.getDate() - 1);
      return res.toISOString().slice(0, 10);
    }
    if (normalized.includes('wednesday') || normalized.includes('mercredi')) {
      const res = new Date(today);
      while (res.getDay() !== 3) res.setDate(res.getDate() - 1);
      return res.toISOString().slice(0, 10);
    }
    if (normalized.includes('tuesday') || normalized.includes('mardi')) {
      const res = new Date(today);
      while (res.getDay() !== 2) res.setDate(res.getDate() - 1);
      return res.toISOString().slice(0, 10);
    }
    if (normalized.includes('monday') || normalized.includes('lundi')) {
      const res = new Date(today);
      while (res.getDay() !== 1) res.setDate(res.getDate() - 1);
      return res.toISOString().slice(0, 10);
    }
    if (normalized.includes('friday') || normalized.includes('vendredi')) {
      const res = new Date(today);
      while (res.getDay() !== 5) res.setDate(res.getDate() - 1);
      return res.toISOString().slice(0, 10);
    }
    if (normalized.includes('saturday') || normalized.includes('samedi')) {
      const res = new Date(today);
      while (res.getDay() !== 6) res.setDate(res.getDate() - 1);
      return res.toISOString().slice(0, 10);
    }
    if (normalized.includes('sunday') || normalized.includes('dimanche')) {
      const res = new Date(today);
      while (res.getDay() !== 0) res.setDate(res.getDate() - 1);
      return res.toISOString().slice(0, 10);
    }
    
    const matched = normalized.match(/\d{4}-\d{2}-\d{2}/);
    if (matched) return matched[0];
    return dateStr;
  },

  triggerQuickCommand(cmd) {
    const textarea = document.getElementById('chat-input-textarea');
    if (!textarea) return;

    if (cmd === 'summarize-3') {
      textarea.value = "Résume le travail des 3 derniers jours.";
    } else if (cmd === 'summarize-7') {
      textarea.value = "Résume le travail des 7 derniers jours.";
    } else if (cmd === 'prep-call') {
      textarea.value = "Prépare l'ordre du jour d'une réunion avec...";
    } else if (cmd === 'weekly-report') {
      textarea.value = "Rédige mon rapport d'activité hebdomadaire basé sur mes tâches et mes réunions.";
    } else if (cmd === 'search-notes') {
      textarea.value = "Search notes regarding...";
    } else if (cmd === 'find-decisions') {
      textarea.value = "Find all decisions recorded across my notes.";
    } else if (cmd === 'review-notes') {
      textarea.value = "Check unreviewed notes and extract action items and decisions.";
    } else if (cmd === 'list-tasks') {
      textarea.value = "List all my pending tasks grouped by priority.";
    } else if (cmd === 'create-task') {
      textarea.value = "Create a new task: [title], priority: High/Medium/Low, due: [date]";
    } else if (cmd === 'check-schedule') {
      textarea.value = "What is my schedule and planned meetings for today?";
    } else if (cmd === 'schedule-meeting') {
      textarea.value = "Schedule a meeting titled '[Topic]' on [YYYY-MM-DD] at [HH:MM] with [Colleague].";
    } else if (cmd === 'search-colleagues') {
      textarea.value = "Lookup colleague and organizational relationship for [Name].";
    } else if (cmd === 'explore-workstreams') {
      textarea.value = "Show all active workstreams, their milestones and linked notes.";
    } else if (cmd === 'synthesize-memory') {
      textarea.value = "Synthesize working memory and key takeaways for workstream [Name].";
    }
    
    // Auto-grow textarea
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
    textarea.focus();
  },

  clearChat() {
    this.newConversation(true);
  },

  newConversation(shouldRender = true) {
    // Save current active conversation first if it has messages
    if (this.currentConversationId && this.messages && this.messages.length > 0) {
      this.saveCurrentConversation();
    }
    
    // Reuse current conversation if it is already empty
    const currentConv = this.conversations.find(c => c.id === this.currentConversationId);
    if (currentConv && (!this.messages || this.messages.length === 0)) {
      this.attachedNotes = [];
      this.attachedTasks = [];
      this.attachedEvents = [];
      if (shouldRender) {
        this.render();
        setTimeout(() => {
          const textarea = document.getElementById('chat-input-textarea');
          if (textarea) textarea.focus();
        }, 50);
      }
      return;
    }

    const id = 'chat_' + Date.now();
    const newConv = {
      id: id,
      title: t('chat.untitledChat') || 'New Conversation',
      created: new Date().toISOString(),
      lastModified: new Date().toISOString()
    };
    
    this.conversations.unshift(newConv);
    this.currentConversationId = id;
    this.messages = [];
    this.attachedNotes = [];
    this.attachedTasks = [];
    this.attachedEvents = [];
    
    this.saveConversationsList();
    this.saveCurrentConversation();
    
    if (shouldRender) {
      this.render();
      // Focus on the input area automatically
      setTimeout(() => {
        const textarea = document.getElementById('chat-input-textarea');
        if (textarea) textarea.focus();
      }, 50);
    }
  },

  selectConversation(id) {
    if (id === this.currentConversationId) return;
    
    // Save current active one first
    this.saveCurrentConversation();
    
    this.currentConversationId = id;
    this.messages = JSON.parse(localStorage.getItem('secretary_conv_messages_' + id) || '[]');
    this.attachedNotes = JSON.parse(localStorage.getItem('secretary_conv_notes_' + id) || '[]');
    this.attachedTasks = JSON.parse(localStorage.getItem('secretary_conv_tasks_' + id) || '[]');
    this.attachedEvents = JSON.parse(localStorage.getItem('secretary_conv_events_' + id) || '[]');
    
    this.saveConversationsList();
    this.render();
  },

  async deleteConversation(id) {
    const confirmMsg = t('chat.deleteConfirm') || 'Are you sure you want to delete this conversation?';
    const confirmed = await showConfirmDialog(confirmMsg, { isDanger: true, confirmLabel: t('common.delete') || 'Delete' });
    if (!confirmed) return;
    
    this.conversations = this.conversations.filter(c => c.id !== id);
    
    localStorage.removeItem('secretary_conv_messages_' + id);
    localStorage.removeItem('secretary_conv_notes_' + id);
    localStorage.removeItem('secretary_conv_tasks_' + id);
    localStorage.removeItem('secretary_conv_events_' + id);
    
    if (this.currentConversationId === id) {
      if (this.conversations.length > 0) {
        this.currentConversationId = this.conversations[0].id;
        this.messages = JSON.parse(localStorage.getItem('secretary_conv_messages_' + this.currentConversationId) || '[]');
        this.attachedNotes = JSON.parse(localStorage.getItem('secretary_conv_notes_' + this.currentConversationId) || '[]');
        this.attachedTasks = JSON.parse(localStorage.getItem('secretary_conv_tasks_' + this.currentConversationId) || '[]');
        this.attachedEvents = JSON.parse(localStorage.getItem('secretary_conv_events_' + this.currentConversationId) || '[]');
      } else {
        this.newConversation(false);
      }
    }
    
    this.saveConversationsList();
    this.render();
  },

  async promptRenameConversation(id) {
    const conv = this.conversations.find(c => c.id === id);
    if (!conv) return;
    
    const newTitle = await showPromptDialog(t('chat.renameChatPrompt') || 'Enter new title for this conversation:', conv.title);
    if (newTitle === null) return; // Cancelled
    
    const cleanTitle = newTitle.trim() || t('chat.untitledChat') || 'New Conversation';
    this.renameConversation(id, cleanTitle);
  },

  renameConversation(id, newTitle) {
    const conv = this.conversations.find(c => c.id === id);
    if (conv) {
      conv.title = newTitle;
      this.saveConversationsList();
      
      // Update header title in DOM immediately if active
      if (this.currentConversationId === id) {
        const headerH2 = document.querySelector('.chat-header-left h2');
        if (headerH2) {
          headerH2.textContent = '💬 ' + newTitle;
          headerH2.title = newTitle;
        }
      }
      
      // Update history list in DOM
      this.renderHistoryList();
    }
  },

  saveCurrentConversation() {
    if (!this.currentConversationId) return;
    
    try {
      localStorage.setItem('secretary_conv_messages_' + this.currentConversationId, JSON.stringify(this.messages.slice(-50)));
      localStorage.setItem('secretary_conv_notes_' + this.currentConversationId, JSON.stringify(this.attachedNotes));
      localStorage.setItem('secretary_conv_tasks_' + this.currentConversationId, JSON.stringify(this.attachedTasks));
      localStorage.setItem('secretary_conv_events_' + this.currentConversationId, JSON.stringify(this.attachedEvents || []));
      
      const conv = this.conversations.find(c => c.id === this.currentConversationId);
      if (conv) {
        conv.lastModified = new Date().toISOString();
        this.saveConversationsList();
        this.renderHistoryList();
      }
    } catch (e) {
      console.warn('Failed saving conversation', e);
    }
  },

  saveConversationsList() {
    try {
      localStorage.setItem('secretaryConversationsList', JSON.stringify(this.conversations));
      localStorage.setItem('secretaryCurrentConversationId', this.currentConversationId);
      this.saveChatHistoryToFolder();
    } catch (e) {
      console.warn('Failed saving conversations list', e);
    }
  },

  async saveChatHistoryToFolder() {
    const isStorageReady = Boolean((typeof rootHandle !== 'undefined' && rootHandle) || (typeof StorageAPI !== 'undefined' && typeof StorageAPI.getStorageEngine === 'function' && StorageAPI.getStorageEngine() === 'firebase'));
    if (!isStorageReady) return;
    try {
      const data = {
        conversations: this.conversations,
        currentConversationId: this.currentConversationId,
        messages: {},
        attachments: {}
      };
      
      for (const conv of this.conversations) {
        const messagesStr = localStorage.getItem('secretary_conv_messages_' + conv.id);
        if (messagesStr) {
          data.messages[conv.id] = JSON.parse(messagesStr);
        }
        const notesStr = localStorage.getItem('secretary_conv_notes_' + conv.id);
        const tasksStr = localStorage.getItem('secretary_conv_tasks_' + conv.id);
        if (notesStr || tasksStr) {
          data.attachments[conv.id] = {
            notes: notesStr ? JSON.parse(notesStr) : [],
            tasks: tasksStr ? JSON.parse(tasksStr) : []
          };
        }
      }
      
      await StorageAPI.writeChatHistory(data);
      if (typeof broadcastSync === 'function') {
        broadcastSync({ type: 'AI_CHAT_UPDATED' });
      }
    } catch (e) {
      console.warn('Failed saving chat history to folder', e);
    }
  },

  async loadChatHistoryFromFolder() {
    const isStorageReady = Boolean((typeof rootHandle !== 'undefined' && rootHandle) || (typeof StorageAPI !== 'undefined' && typeof StorageAPI.getStorageEngine === 'function' && StorageAPI.getStorageEngine() === 'firebase'));
    if (!isStorageReady) return;
    try {
      const data = await StorageAPI.readChatHistory();
      if (data && Array.isArray(data.conversations)) {
        this.conversations = data.conversations;
        
        localStorage.setItem('secretaryConversationsList', JSON.stringify(this.conversations));
        
        if (data.messages) {
          for (const [id, messages] of Object.entries(data.messages)) {
            localStorage.setItem('secretary_conv_messages_' + id, JSON.stringify(messages));
          }
        }
        if (data.attachments) {
          for (const [id, attach] of Object.entries(data.attachments)) {
            if (attach.notes) localStorage.setItem('secretary_conv_notes_' + id, JSON.stringify(attach.notes));
            if (attach.tasks) localStorage.setItem('secretary_conv_tasks_' + id, JSON.stringify(attach.tasks));
          }
        }
        
        if (data.currentConversationId && this.conversations.some(c => c.id === data.currentConversationId)) {
          this.currentConversationId = data.currentConversationId;
        } else if (this.conversations.length > 0) {
          this.currentConversationId = this.conversations[0].id;
        }
        localStorage.setItem('secretaryCurrentConversationId', this.currentConversationId);
        
        const id = this.currentConversationId;
        if (id) {
          this.messages = JSON.parse(localStorage.getItem('secretary_conv_messages_' + id) || '[]');
          this.attachedNotes = JSON.parse(localStorage.getItem('secretary_conv_notes_' + id) || '[]');
          this.attachedTasks = JSON.parse(localStorage.getItem('secretary_conv_tasks_' + id) || '[]');
        }
        
        this.render();
      }
    } catch (e) {
      console.warn('Failed to load chat history from folder', e);
    }
  },

  handleHistorySearch(e) {
    this.historySearchQuery = e.target.value;
    this.renderHistoryList();
  },

  renderHistoryList() {
    const container = document.getElementById('chat-history-list');
    if (!container) return;

    const query = (this.historySearchQuery || '').toLowerCase().trim();
    const filtered = this.conversations.filter(c => 
      c.title.toLowerCase().includes(query)
    );

    if (filtered.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; color:var(--text-muted); font-size:var(--font-size-caption); padding: var(--space-4);">
          ${escH(t('chat.noConversationsFound') || 'No conversations found')}
        </div>
      `;
      return;
    }

    let html = '';
    filtered.forEach(conv => {
      const isActive = conv.id === this.currentConversationId;
      const date = new Date(conv.lastModified || conv.created);
      const formattedDate = this.formatConversationDate(date);

      html += `
        <div class="chat-history-item ${isActive ? 'active' : ''}" onclick="AIChatController.selectConversation('${escA(conv.id)}')" title="${escA(t('chat.openChatTooltip') || 'Click to open this conversation')}">
          <div class="chat-history-item-content">
            <span class="chat-history-item-title" title="${escA(conv.title)}">${escH(conv.title)}</span>
            <span class="chat-history-item-meta">${escH(formattedDate)}</span>
          </div>
          <div class="chat-history-item-actions">
            <button class="chat-history-action-btn" onclick="event.stopPropagation(); AIChatController.promptRenameConversation('${escA(conv.id)}')" title="${escA(t('chat.renameChatTooltip') || 'Rename')}">
              ✏️
            </button>
            <button class="chat-history-action-btn" onclick="event.stopPropagation(); AIChatController.deleteConversation('${escA(conv.id)}')" title="${escA(t('chat.deleteChatTooltip') || 'Delete')}">
              🗑️
            </button>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
  },

  formatConversationDate(date) {
    if (!date || isNaN(date.getTime())) {
      return '';
    }
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    const isToday = now.toDateString() === date.toDateString();
    if (isToday) {
      return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday = yesterday.toDateString() === date.toDateString();
    if (isYesterday) {
      return t('chat.yesterday') || 'Yesterday';
    }

    if (diffDays < 7) {
      return date.toLocaleDateString(undefined, { weekday: 'long' });
    }

    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  },

  // Modal selector for attachments
  openAttachModal(tab) {
    this.modalTab = tab;
    this.modalSearchQuery = '';
    
    // Ensure modal exists in DOM and display active
    openModal('modal-attach-context');
    this.renderAttachModalContents();
  },

  closeAttachModal() {
    closeModal('modal-attach-context');
  },

  switchModalTab(tab) {
    this.modalTab = tab;
    this.renderAttachModalContents();
  },

  handleModalSearchInput(e) {
    this.modalSearchQuery = e.target.value;
    this.renderModalSearchResults();
  },

  renderAttachModalContents() {
    const container = document.getElementById('attach-modal-content');
    if (!container) return;

    const notesActive = this.modalTab === 'notes' ? 'active' : '';
    const tasksActive = this.modalTab === 'tasks' ? 'active' : '';
    const eventsActive = this.modalTab === 'events' ? 'active' : '';
    const decisionsActive = this.modalTab === 'decisions' ? 'active' : '';

    container.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:var(--space-4);">
        <h2>${escH(t('chat.modalTitle') || 'Attach Context to Chat')}</h2>
        <button class="btn" onclick="AIChatController.closeAttachModal()">&times;</button>
      </div>

      <div class="md-tabs" style="margin-bottom:var(--space-3); display:flex; flex-wrap:wrap; gap:4px;">
        <button class="md-tab ${notesActive}" onclick="AIChatController.switchModalTab('notes')">
          📝 ${escH(t('chat.notesTab') || 'Notes')}
        </button>
        <button class="md-tab ${tasksActive}" onclick="AIChatController.switchModalTab('tasks')">
          📋 ${escH(t('chat.tasksTab') || 'Tasks')}
        </button>
        <button class="md-tab ${eventsActive}" onclick="AIChatController.switchModalTab('events')">
          📅 ${escH(t('chat.eventsTab') || 'Events')}
        </button>
        <button class="md-tab ${decisionsActive}" onclick="AIChatController.switchModalTab('decisions')">
          ⚖️ ${escH(t('chat.decisionsTab') || 'Decisions')}
        </button>
      </div>

      <div style="margin-bottom:var(--space-3);">
        <input 
          type="text" 
          id="attach-modal-search" 
          class="prefs-input" 
          placeholder="${escA(t('chat.searchPlaceholder') || 'Search notes, tasks, events, decisions...')}"
          value="${escA(this.modalSearchQuery)}"
          oninput="AIChatController.handleModalSearchInput(event)"
          style="width:100%; max-width:none;"
        >
      </div>

      <div id="attach-modal-results-list" style="max-height:300px; overflow-y:auto; display:flex; flex-direction:column; gap:var(--space-2);">
        <!-- Results rendered here -->
      </div>
    `;

    this.renderModalSearchResults();
    setTimeout(() => {
      const inp = document.getElementById('attach-modal-search');
      if (inp) inp.focus();
    }, 50);
  },

  renderModalSearchResults() {
    const container = document.getElementById('attach-modal-results-list');
    if (!container) return;

    const query = this.modalSearchQuery.toLowerCase().trim();
    let html = '';

    if (this.modalTab === 'notes') {
      const filteredNotes = (typeof manifest !== 'undefined' && Array.isArray(manifest) ? manifest : []).filter(n => 
        (n.title && n.title.toLowerCase().includes(query)) || 
        (Array.isArray(n.group_tags) && n.group_tags.some(t => t.toLowerCase().includes(query)))
      );

      if (filteredNotes.length === 0) {
        html = `<div style="text-align:center; color:var(--text-muted); padding:var(--space-4);">${escH(t('chat.noNotesFound') || 'No notes found')}</div>`;
      } else {
        filteredNotes.forEach(note => {
          const isAttached = this.attachedNotes.includes(note.path);
          const checked = isAttached ? 'checked' : '';
          html += `
            <div style="display:flex; align-items:center; justify-content:space-between; padding:var(--space-2) var(--space-3); background:var(--card-bg-alt); border:1px solid var(--card-border); border-radius:var(--radius-sm); cursor:pointer;" onclick="AIChatController.toggleAttachNote('${escA(note.path)}')">
              <div>
                <strong style="font-size:var(--font-size-ui);">${escH(note.title)}</strong>
                <div style="font-size:var(--font-size-caption); color:var(--text-muted);">${escH(note.date || '')} - ${(note.group_tags || []).join(', ')}</div>
              </div>
              <input type="checkbox" ${checked} style="pointer-events:none;">
            </div>
          `;
        });
      }
    } else if (this.modalTab === 'tasks') {
      const filteredTasks = (typeof todosManifest !== 'undefined' && Array.isArray(todosManifest) ? todosManifest : []).filter(t => 
        (t.title && t.title.toLowerCase().includes(query)) || 
        (t.owner && t.owner.toLowerCase().includes(query))
      );

      if (filteredTasks.length === 0) {
        html = `<div style="text-align:center; color:var(--text-muted); padding:var(--space-4);">${escH(t('chat.noTasksFound') || 'No tasks found')}</div>`;
      } else {
        filteredTasks.forEach(todo => {
          const isAttached = this.attachedTasks.includes(todo.id);
          const checked = isAttached ? 'checked' : '';
          html += `
            <div style="display:flex; align-items:center; justify-content:space-between; padding:var(--space-2) var(--space-3); background:var(--card-bg-alt); border:1px solid var(--card-border); border-radius:var(--radius-sm); cursor:pointer;" onclick="AIChatController.toggleAttachTask('${escA(todo.id)}')">
              <div>
                <strong style="font-size:var(--font-size-ui);">${escH(todo.title)}</strong>
                <div style="font-size:var(--font-size-caption); color:var(--text-muted);">${escH(todo.priority)} - ${escH(todo.owner || '')}</div>
              </div>
              <input type="checkbox" ${checked} style="pointer-events:none;">
            </div>
          `;
        });
      }
    } else if (this.modalTab === 'events') {
      const eventsList = (typeof plannerEvents !== 'undefined' && Array.isArray(plannerEvents) ? plannerEvents : []);
      const filteredEvents = eventsList.filter(e =>
        (e.title && e.title.toLowerCase().includes(query)) ||
        (e.date && e.date.toLowerCase().includes(query)) ||
        (Array.isArray(e.collaborators) && e.collaborators.some(c => String(c).toLowerCase().includes(query)))
      );

      if (filteredEvents.length === 0) {
        html = `<div style="text-align:center; color:var(--text-muted); padding:var(--space-4);">${escH(t('chat.noEventsFound') || 'No events found')}</div>`;
      } else {
        filteredEvents.forEach(ev => {
          const isAttached = (this.attachedEvents || []).includes(ev.id);
          const checked = isAttached ? 'checked' : '';
          html += `
            <div style="display:flex; align-items:center; justify-content:space-between; padding:var(--space-2) var(--space-3); background:var(--card-bg-alt); border:1px solid var(--card-border); border-radius:var(--radius-sm); cursor:pointer;" onclick="AIChatController.toggleAttachEvent('${escA(ev.id)}')">
              <div>
                <strong style="font-size:var(--font-size-ui);">${escH(ev.title)}</strong>
                <div style="font-size:var(--font-size-caption); color:var(--text-muted);">${escH(ev.date || '')} ${escH(ev.startTime || '')} - ${escH(ev.type || 'call')}</div>
              </div>
              <input type="checkbox" ${checked} style="pointer-events:none;">
            </div>
          `;
        });
      }
    } else if (this.modalTab === 'decisions') {
      const manifestList = (typeof manifest !== 'undefined' && Array.isArray(manifest) ? manifest : []);
      const decisionItems = [];
      manifestList.forEach(n => {
        if (Array.isArray(n.decisions)) {
          n.decisions.forEach(d => {
            const decStr = String(d || '').trim();
            if (decStr && (!query || decStr.toLowerCase().includes(query) || (n.title && n.title.toLowerCase().includes(query)))) {
              decisionItems.push({ text: decStr, notePath: n.path, noteTitle: n.title });
            }
          });
        }
      });

      if (decisionItems.length === 0) {
        html = `<div style="text-align:center; color:var(--text-muted); padding:var(--space-4);">${escH(t('chat.noDecisionsFound') || 'No decisions found')}</div>`;
      } else {
        decisionItems.forEach(item => {
          const isAttached = this.attachedNotes.includes(item.notePath);
          const checked = isAttached ? 'checked' : '';
          html += `
            <div style="display:flex; align-items:center; justify-content:space-between; padding:var(--space-2) var(--space-3); background:var(--card-bg-alt); border:1px solid var(--card-border); border-radius:var(--radius-sm); cursor:pointer;" onclick="AIChatController.toggleAttachNote('${escA(item.notePath)}')">
              <div>
                <strong style="font-size:var(--font-size-ui);">⚖️ ${escH(item.text)}</strong>
                <div style="font-size:var(--font-size-caption); color:var(--text-muted);">📝 ${escH(item.noteTitle || item.notePath)}</div>
              </div>
              <input type="checkbox" ${checked} style="pointer-events:none;">
            </div>
          `;
        });
      }
    }

    container.innerHTML = html;
  },

  async generateNoteSummaries(notes, onProgress, signal) {
    let completed = 0;
    const total = notes.length;
    for (const n of notes) {
      if (signal && signal.aborted) break;
      if (onProgress) onProgress(n, completed, total);
      
      try {
        const html = await StorageAPI.readNoteContent(n.path);
        const parsed = parseNoteHTML(html);
        
        // Skip calling the LLM if the HTML already has a valid summary
        const hasSummary = typeof hasValidNoteSummary === 'function'
          ? hasValidNoteSummary(parsed.summary)
          : (parsed.summary && parsed.summary.trim() !== '' && parsed.summary !== '<p></p>' && parsed.summary !== '<p><br></p>');
        if (hasSummary) {
          n.summary = parsed.summary;
          const mfIdx = manifest.findIndex(item => item.path === n.path);
          if (mfIdx !== -1) {
            manifest[mfIdx].summary = parsed.summary;
            manifest[mfIdx].modified = new Date().toISOString();
          }
          completed++;
          continue;
        }
        
        const noteText = new DOMParser().parseFromString('<div>' + (parsed.mainHTML || '') + '</div>', 'text/html').body.textContent || '';
        
        if (noteText.trim().length > 10) {
          const activeLang = (typeof getAppLanguage === 'function') ? getAppLanguage() : 'fr';
          let messages = [];
          if (activeLang === 'de') {
            messages = [
              {
                role: 'system',
                content: `Du bist ein Analyse-KI-Assistent. Verfasse eine sehr kurze Zusammenfassung (maximal 2-3 Sätze) der folgenden Besprechungsnotiz auf Deutsch.
Gib kurz den Zweck der Besprechung, die erwähnten Teilnehmer und die wichtigsten Entscheidungen oder Maßnahmen an.
Gib nur die Zusammenfassung auf Deutsch zurück, ohne Einleitung oder Schlussbemerkung.`
              },
              {
                role: 'user',
                content: `Notiz: "${n.title}"\nInhalt:\n${noteText.slice(0, 3000)}`
              }
            ];
          } else if (activeLang === 'en') {
            messages = [
              {
                role: 'system',
                content: `You are an AI analysis assistant. Write a very short summary (maximum 2-3 sentences) of the meeting note below in English.
Briefly state the purpose of the meeting, the participants mentioned, and key decisions or action items.
Return only the summary in English, without any introduction or conclusion.`
              },
              {
                role: 'user',
                content: `Note: "${n.title}"\nContent:\n${noteText.slice(0, 3000)}`
              }
            ];
          } else {
            messages = [
              {
                role: 'system',
                content: `Tu es un assistant IA d'analyse. Rédige un résumé très court (2-3 phrases maximum) de la note de réunion ci-dessous en français.
Indique brièvement l'objet de la réunion, les participants mentionnés et les décisions ou actions clés.
Renvoie uniquement le résumé en français, sans introduction ni conclusion.`
              },
              {
                role: 'user',
                content: `Note: "${n.title}"\nContenu:\n${noteText.slice(0, 3000)}`
              }
            ];
          }
          const response = await LLMService.chat(messages, {
            temperature: 0.3,
            reasoningEffort: 'low',
            signal: signal
          });
          
          if (response && response.reply) {
            const summaryHTML = `<p>${response.reply.trim().replace(/\n/g, '<br>')}</p>`;
            const changes = {
              ...n,
              summary: summaryHTML
            };
            const updatedHTML = applyNoteEdits(html, changes);
            await StorageAPI.writeNoteContent(n.path, updatedHTML);
            
            // Update in-memory manifest object
            const mfIdx = manifest.findIndex(item => item.path === n.path);
            if (mfIdx !== -1) {
              manifest[mfIdx].summary = summaryHTML;
              manifest[mfIdx].modified = new Date().toISOString();
            }
          }
        }
      } catch (e) {
        if (e.name === 'AbortError') {
          console.log('Summary generation aborted for', n.path);
          break;
        }
        console.error('Failed to generate summary for note', n.path, e);
      }
      completed++;
    }
    
    try {
      await saveManifest({ force: true });
      await rebuildIndexHTML();
      if (typeof renderBoard === 'function') renderBoard();
    } catch (e) {
      console.warn('Failed to save manifest after note summaries generation', e);
    }
  },

  // ── Note specific chat functions ──
  loadNoteConversation(note) {
    this.currentNoteChatId = 'note_chat_' + note.id;
    this.noteMessages = JSON.parse(localStorage.getItem('secretary_conv_messages_' + this.currentNoteChatId) || '[]');
    this.noteAttachedNotes = JSON.parse(localStorage.getItem('secretary_conv_notes_' + this.currentNoteChatId) || '[]');
    this.noteAttachedTasks = JSON.parse(localStorage.getItem('secretary_conv_tasks_' + this.currentNoteChatId) || '[]');
    
    this.renderNoteMessages();
    this.renderNoteAttachments();
    this.syncNoteThinkingControls();
  },

  syncNoteThinkingControls() {
    const effortSelect = document.getElementById('inspector-thinking-effort-select');
    const supportsEffort = typeof supportsThinkingEffort === 'function' ? supportsThinkingEffort() : true;
    const wrap = document.getElementById('inspector-effort-select-wrap');
    if (wrap) {
      wrap.style.display = supportsEffort ? 'inline-block' : 'none';
    }
    if (effortSelect && typeof populateThinkingEffortSelect === 'function' && supportsEffort) {
      const scopeKey = typeof getPromptThinkingEffortScopeKeyForChat === 'function'
        ? getPromptThinkingEffortScopeKeyForChat(this.currentNoteChatId)
        : `chat:${this.currentNoteChatId || 'global'}`;
      populateThinkingEffortSelect(effortSelect, scopeKey, 'medium');
      effortSelect.value = typeof getStoredPromptThinkingEffort === 'function'
        ? getStoredPromptThinkingEffort(scopeKey, 'medium')
        : effortSelect.value;
    }
  },
  
  saveNoteConversation() {
    if (!this.currentNoteChatId) return;
    localStorage.setItem('secretary_conv_messages_' + this.currentNoteChatId, JSON.stringify(this.noteMessages));
    localStorage.setItem('secretary_conv_notes_' + this.currentNoteChatId, JSON.stringify(this.noteAttachedNotes));
    localStorage.setItem('secretary_conv_tasks_' + this.currentNoteChatId, JSON.stringify(this.noteAttachedTasks));
  },

  clearNoteChat() {
    this.noteMessages = [];
    this.noteAttachedNotes = [];
    this.noteAttachedTasks = [];
    this.saveNoteConversation();
    this.renderNoteMessages();
    this.renderNoteAttachments();
  },

  triggerNoteReview() {
    const textarea = document.getElementById('inspector-chat-textarea');
    if (textarea) {
      textarea.value = "Fais-moi un résumé de cette réunion s'il te plaît. Relis le texte, analyse son contenu pour en faire une synthèse claire des points clés, et propose-moi des corrections, tâches à créer ou décisions à enregistrer si nécessaire.";
      this.submitInspectorMessage();
    }
  },

  handleInspectorKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.submitInspectorMessage();
    }
  },

  async submitInspectorMessage() {
    const textarea = document.getElementById('inspector-chat-textarea');
    if (!textarea) return;

    const text = textarea.value.trim();
    if (!text) return;

    const scopeKey = typeof getPromptThinkingEffortScopeKeyForChat === 'function'
      ? getPromptThinkingEffortScopeKeyForChat(this.currentNoteChatId)
      : `chat:${this.currentNoteChatId || 'global'}`;
    const reasoningEffort = typeof getStoredPromptThinkingEffort === 'function'
      ? getStoredPromptThinkingEffort(scopeKey, 'medium')
      : 'medium';

    textarea.value = '';
    textarea.style.height = '';

    const timestamp = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    this.noteMessages.push({
      role: 'user',
      content: text,
      date: timestamp
    });

    const requestController = new AbortController();
    this.currentRequestController = requestController;
    this.isNoteThinking = true;
    this.noteThinkingMessage = 'Analyse de la demande...';
    this.renderNoteMessages();

    try {
      await this.runNoteAgentLoop(text, requestController, reasoningEffort);
    } catch (e) {
      if (e && e.name === 'AbortError') {
        this.noteMessages.push({
          role: 'assistant',
          content: `⏹ Génération interrompue.`,
          date: new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
        });
      } else {
        console.error('Agent loop failed for note chat', e);
        this.noteMessages.push({
          role: 'assistant',
          content: `❌ Erreur: ${e.message}`,
          date: new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
        });
      }
    } finally {
      this.currentRequestController = null;
      this.isNoteThinking = false;
      this.noteThinkingMessage = '';
      this.renderNoteMessages();
      this.saveNoteConversation();
    }
  },

  async runNoteAgentLoop(originalPrompt, requestController = null, reasoningEffort = 'medium') {
    // Simplified note-chat: corrections + suggestions only.
    // This agent does NOT have tools. For general queries (planner, other notes, etc.)
    // the user should use the main Secretary chat.

    const note = (typeof currentNote !== 'undefined') ? currentNote : null;

    // Build note content from the live editor
    const textArea = document.getElementById('edit-textarea');
    const noteContent = (textArea?.innerText || textArea?.textContent || '').trim();

    // Build minimal conversation history for context (last 6 turns, no system messages)
    const historyMessages = this.noteMessages
      .filter(m => m.role !== 'system' && !String(m.content || '').startsWith('[SYSTEM]'))
      .slice(-6)
      .map(m => ({ role: m.role, content: m.content }));

    // Collect colleague names for @ correction hint
    let colleagueNames = [];
    try {
      if (typeof colleaguesDb !== 'undefined' && Array.isArray(colleaguesDb.colleagues)) {
        colleagueNames = colleaguesDb.colleagues.map(c => c.label || '').filter(Boolean);
      }
    } catch (_e) { /* ignore */ }

    // Build a focused correction/suggestion system prompt
    const noteSection = note
      ? `NOTE ACTUELLE (ID: ${note.id}, Titre: "${note.title}", Date: ${note.date}):\n${noteContent}`
      : `CONTENU DE LA NOTE:\n${noteContent}`;

    const actionSchemas = `{
  "action": "text_correction",
  "properties": {
    "target_string": "Texte brut exact à remplacer (sans balises HTML)",
    "replacement_text": "Texte brut de remplacement",
    "annotation": "Raison de la correction"
  }
},
{
  "action": "create_todo",
  "properties": {
    "target_string": "Extrait exact du paragraphe de la note auquel se rapporte la tâche",
    "title": "Titre clair et explicite de la tâche",
    "quadrant": "Q1 | Q2 | Q3 | Q4 (Q1=Do First, Q2=Schedule, Q3=Delegate, Q4=Eliminate)",
    "owner": "Nom d'un collègue ou 'me'",
    "reporter": "Nom du collègue ayant demandé ou rapporté la tâche",
    "context": "Explication ou contexte de la tâche",
    "dueDate": "YYYY-MM-DD ou vide"
  }
},
{
  "action": "log_decision",
  "properties": {
    "target_string": "Extrait exact du paragraphe de la note auquel se rapporte la décision",
    "title": "Titre clair et explicite de la décision",
    "status": "active | superseded",
    "owner": "Nom du collègue porteur de la décision",
    "reporter": "Nom du collègue ayant sollicité la décision",
    "context": "Raison ou contexte de la décision",
    "major_topic": "Sujet ou catégorie associé",
    "supersedes": "ID ou texte de la décision remplacée (ou null)"
  }
},
{
  "action": "link_note",
  "properties": {
    "target_string": "Extrait exact du paragraphe de la note auquel rattacher le lien",
    "title": "Titre exact de la note à lier",
    "path": "Chemin de la note (si connu) ou vide",
    "id": "ID de la note (si connu) ou vide"
  }
}`;

    const systemPrompt = `Tu es l'assistant local de révision, mise en forme et correction de notes "Secretary".
Ta mission est de :
1) Corriger les fautes d'orthographe, de grammaire et de style (action: "text_correction").
2) Améliorer la mise en forme et la lisibilité du texte (action: "text_correction") :
   - Mettre en GRAS (<strong>...</strong>) ou en ITALIQUE (<em>...</em>) les éléments importants, décisions clés, échéances et chiffres importants de la réunion.
   - Surligner (<mark>...</mark>) les informations critiques de la réunion.
   - Structurer les informations en listes à puces (<ul><li>...</li></ul>) ou listes numérotées (<ol><li>...</li></ol>) pour rendre la lecture plus fluide.
   - Insérer des mentions de collègues sous la forme '@NomDuCollègue' (ex: @John, @Sarah) lorsqu'un collègue est désigné ou mentionné (${colleagueNames.join(', ')}).
3) Tu DOIS extraire TOUTES les tâches et actions à accomplir mentionnées dans la note (particulièrement sous les rubriques comme 'Actions', 'Tâches', 'A faire' ou les puces) et proposer de les ajouter sous forme de todo (action: "create_todo").
4) Tu DOIS extraire TOUTES les décisions actées ou convenues dans la note (particulièrement sous les rubriques comme 'Decisions', 'Décisions' ou les puces) et proposer de les enregistrer (action: "log_decision").
5) Proposer de lier des notes connexes existantes lorsqu'elles sont pertinentes ou mentionnées (action: "link_note").
6) Répondre aux questions directes de l'utilisateur sur le contenu de la note.

RÈGLE ABSOLUE DE SORTIE :
- Tu DOIS TOUJOURS répondre avec un objet JSON strict et uniquement ça.
- N'écris jamais de texte avant ou après le JSON. Pas de bloc markdown (\`\`\`json).
- Format obligatoire :
{
  "general_comment": "Ta réponse ou commentaire en texte Markdown. Laisse vide (\"\") si tu n'as rien à dire au-delà des propositions.",
  "suggested_actions": [
    ${actionSchemas}
  ]
}
- Si tu n'as pas de propositions à faire, retourne "suggested_actions": [].

RÈGLES MÉTIER :
- Tu DOIS extraire TOUTES les tâches et actions à effectuer mentionnées sous des rubriques comme 'Actions', 'Tâches' ou dans le texte brut de la note et proposer une action "create_todo" pour chacune.
- Tu DOIS extraire TOUTES les décisions convenues mentionnées sous des rubriques comme 'Decisions', 'Décisions' ou dans le texte brut de la note et proposer une action "log_decision" pour chacune.
- Ne propose PAS de créer un todo ou une décision si le texte est DÉJÀ converti en élément interactif todo (<span class="note-todo">) ou pill de décision (<span class="note-decision-wrapper">) dans l'éditeur.
- Dans 'target_string', copie le texte brut exact du paragraphe ou de la ligne tel qu'il apparaît dans la note.
- Dans 'replacement_text', tu peux inclure du HTML enrichi (<strong>, <em>, <mark>, <ul>, <li>, @NomDuCollègue) pour mettre en valeur et mieux structurer les informations importantes de la réunion.
- Fournis assez de contexte dans 'target_string' pour repérer le paragraphe correspondant.
- Tu DOIS repérer toute mention textuelle brute des collaborateurs (${colleagueNames.join(', ')}) dans la note qui N'EST PAS encore précédée du symbole '@'. Propose une action "text_correction" pour ajouter le '@' devant son prénom/nom dans 'replacement_text'.
- ATTENTION : Si le nom du collègue est DÉJÀ précédé d'un symbole '@' (ex: '@Balint'), NE propose PAS de correction pour ce nom afin d'éviter les doublons (ex: pas de '@@Balint').
- Ne propose PAS de corrections ou tâches/décisions déjà appliquées dans la note.
- Réponds toujours en français.

${noteSection}`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...historyMessages,
      { role: 'user', content: originalPrompt }
    ];

    const response = await LLMService.chat(messages, {
      controller: requestController,
      timeoutMs: 0,
      reasoningEffort
    });

    // Parse the response — always expect the JSON envelope
    let replyContent = response.reply || '';
    let parsed = response.parsed || null;

    // Normalise: if parsed doesn't have the expected shape, try to wrap it
    if (parsed && !parsed.general_comment && !parsed.suggested_actions) {
      // Maybe it's a single action object or an array
      if (Array.isArray(parsed)) {
        parsed = { general_comment: '', suggested_actions: parsed };
      } else if (parsed.action) {
        parsed = { general_comment: '', suggested_actions: [parsed] };
      } else {
        parsed = null;
      }
    }

    if (parsed && (parsed.general_comment || Array.isArray(parsed.suggested_actions))) {
      replyContent = parsed.general_comment || '';
      // Apply corrections to the note editor via renderAiSuggestions
      if (typeof renderAiSuggestions === 'function') {
        renderAiSuggestions(parsed, note);
      }
    }

    const timestamp = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    this.noteMessages.push({
      role: 'assistant',
      content: replyContent || (parsed ? '✅ Corrections proposées ci-dessus.' : response.reply || ''),
      parsed: parsed,
      date: timestamp
    });
  },

  renderNoteMessages() {
    const container = document.getElementById('inspector-chat-messages');
    if (!container) return;

    if (this.noteMessages.length === 0) {
      container.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:center; height:100%; color:var(--text-muted); font-size:var(--font-size-ui); text-align:center; padding:1rem; flex-direction:column; gap:10px;">
          <span>Aucun message pour le moment. Demandez à Secretary de corriger la note ou d'en commenter le contenu.</span>
        </div>
      `;
      return;
    }

    let html = '';
    this.noteMessages.forEach((msg, idx) => {
      const contentStr = String(msg.content || '');
      if (msg.role === 'system') return;
      if (msg.role === 'user' && contentStr.startsWith('[SYSTEM]')) return;

      const isUser = msg.role === 'user';
      const bubbleClass = isUser ? 'user' : 'assistant';
      const senderName = isUser ? (t('chat.you') || 'You') : (t('chat.assistant') || 'Assistant');
      
      let bodyHTML = '';
      if (isUser) {
        bodyHTML = escH(contentStr).replace(/\n/g, '<br>');
      } else {
        bodyHTML = this.formatToolCallsToHTML(contentStr);
        if (msg.parsed && Array.isArray(msg.parsed.suggested_actions)) {
          bodyHTML += this.renderNoteSuggestionCardsHTML(msg.parsed.suggested_actions, idx);
        }
      }

      let copyButtonHTML = '';
      if (!isUser) {
        copyButtonHTML = `
          <button class="chat-msg-copy-btn" onclick="AIChatController.copyNoteMessageText(this, ${idx})" title="${escA(t('common.copy') || 'Copy response')}">
            📋
          </button>
        `;
      }

      html += `
        <div class="chat-message-bubble ${bubbleClass}">
          <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.75rem; font-weight:600; margin-bottom:6px; opacity:0.8;">
            <span>${escH(senderName)}</span>
            ${copyButtonHTML}
          </div>
          <div class="chat-message-body">${bodyHTML}</div>
          <span class="chat-message-time">${escH(msg.date || '')}</span>
        </div>
      `;
    });

    if (this.isNoteThinking) {
      html += `
        <div class="chat-thinking">
          <div class="chat-thinking-indicator">
            <span>🤖 Assistant</span>
            <div class="chat-thinking-dots">
              <span>.</span><span>.</span><span>.</span>
            </div>
          </div>
          ${this.noteThinkingMessage ? `<div class="chat-thinking-subtext">${escH(this.noteThinkingMessage)}</div>` : ''}
        </div>
      `;
    }

    container.innerHTML = html;
    container.scrollTop = container.scrollHeight;
  },

  async copyNoteMessageText(btn, idx) {
    const msg = this.noteMessages[idx];
    if (!msg) return;
    try {
      await navigator.clipboard.writeText(msg.content || '');
      const oldText = btn.textContent;
      btn.textContent = '✓ ' + (t('common.copied') || 'Copied');
      btn.style.color = 'var(--success, #10b981)';
      setTimeout(() => { btn.textContent = '📋'; btn.style.color = ''; }, 1800);
      toast(t('common.copied') || 'Copied to clipboard.');
    } catch (err) {
      console.error('Could not copy message text', err);
      toast(t('common.copyFailed') || 'Copy failed.', true);
    }
  },

  renderNoteSuggestionCardsHTML(actions, msgIdx) {
    let html = '<div class="chat-suggestion-cards">';
    let renderedCount = 0;
    actions.forEach((act, actIdx) => {
      const actionType = String(act.action || '').toLowerCase();
      if (actionType === 'text_correction' || actionType === 'log_decision') {
        return; // Handled globally by the editor pane
      }
      renderedCount++;
      
      let icon = '💡';
      let title = act.action;
      let bodyText = '';
      
      if (actionType === 'create_todo') {
        icon = '📋';
        title = t('chat.suggCreateTodo') || 'Create Task';
        bodyText = `<strong>${escH(act.properties?.title || '')}</strong> (Priority: ${escH(act.properties?.priority || 'Medium')})`;
      } else if (actionType === 'create_note') {
        icon = '📝';
        title = t('chat.suggCreateNote') || 'Create Note';
        bodyText = `<strong>${escH(act.properties?.title || '')}</strong> (Group: ${escH(act.properties?.group || 'Daily')})`;
      } else if (actionType === 'create_event') {
        icon = '📅';
        title = t('chat.suggCreateEvent') || 'Schedule Meeting';
        bodyText = `<strong>${escH(act.properties?.title || '')}</strong> on ${escH(act.properties?.date || '')} at ${escH(act.properties?.time || '')}`;
        const collabs = AIChatController.extractCollaboratorsFromProps(act.properties);
        if (collabs.collaborators && collabs.collaborators.length > 0) {
          bodyText += ` with ${escH(collabs.collaborators.join(', '))}`;
        }
        if (act.properties?.noteTitle) {
          bodyText += `<br><small style="color:var(--text-muted); font-style:italic;">📝 Note: "${escH(act.properties.noteTitle)}"</small>`;
        }
      } else if (actionType === 'schedule_task') {
        icon = '📅';
        title = t('chat.suggScheduleTask') || 'Planifier Tâche';
        bodyText = `<strong>${escH(act.properties?.title || '')}</strong> (Durée: ${escH(act.properties?.duration || 30)} min, Date: ${escH(act.properties?.date || 'tomorrow')})`;
        const collabs = AIChatController.extractCollaboratorsFromProps(act.properties);
        if (collabs.collaborators && collabs.collaborators.length > 0) {
          bodyText += ` with ${escH(collabs.collaborators.join(', '))}`;
        }
        if (act.properties?.noteTitle) {
          bodyText += `<br><small style="color:var(--text-muted); font-style:italic;">📝 Note: "${escH(act.properties.noteTitle)}"</small>`;
        }
      } else {
        bodyText = escH(JSON.stringify(act.properties));
      }

      const isAccepted = !!act.accepted;
      const isDismissed = !!act.dismissed;
      const isDisabled = isAccepted || isDismissed;
      const cardStyle = isDisabled ? ' style="opacity: 0.5; pointer-events: none;"' : '';
      
      let buttonsHTML = '';
      if (isAccepted) {
        buttonsHTML = `<span style="font-size:0.72rem; color:var(--success, #10b981); font-weight:600;">Status: Acceptée</span>`;
      } else if (isDismissed) {
        buttonsHTML = `<span style="font-size:0.72rem; color:var(--text-muted); font-weight:600;">Status: Ignorée</span>`;
      } else {
        buttonsHTML = `
          <button class="btn btn-primary" style="padding:.2rem .6rem; font-size:.72rem;" onclick="AIChatController.acceptNoteSuggestion(${msgIdx}, ${actIdx})">
            ✅ ${escH(t('chat.accept') || 'Accept')}
          </button>
          <button class="btn" style="padding:.2rem .6rem; font-size:.72rem;" onclick="AIChatController.dismissNoteSuggestion(${msgIdx}, ${actIdx})">
            ❌ ${escH(t('chat.dismiss') || 'Dismiss')}
          </button>
        `;
      }

      html += `
        <div class="chat-suggestion-card" id="note-sugg-${msgIdx}-${actIdx}"${cardStyle}>
          <div class="chat-suggestion-header">
            <span class="chat-suggestion-type">${icon} ${escH(title)}</span>
          </div>
          <div style="font-size: var(--font-size-ui); margin-top: 4px;">${bodyText}</div>
          <div class="chat-suggestion-actions">
            ${buttonsHTML}
          </div>
        </div>
      `;
    });
    html += '</div>';
    return renderedCount > 0 ? html : '';
  },

  acceptNoteSuggestion(msgIdx, actIdx) {
    const msg = this.noteMessages[msgIdx];
    if (!msg || !msg.parsed || !Array.isArray(msg.parsed.suggested_actions)) return;
    const action = msg.parsed.suggested_actions[actIdx];
    if (!action) return;

    action.accepted = true;
    this.saveNoteConversation();
    this.executeSuggestion(action);
    this.renderNoteMessages();
  },

  dismissNoteSuggestion(msgIdx, actIdx) {
    const msg = this.noteMessages[msgIdx];
    if (!msg || !msg.parsed || !Array.isArray(msg.parsed.suggested_actions)) return;
    const action = msg.parsed.suggested_actions[actIdx];
    if (action) {
      action.dismissed = true;
    }
    this.saveNoteConversation();
    this.renderNoteMessages();
  },

  renderNoteAttachments() {
    const container = document.getElementById('inspector-chat-attachments');
    if (!container) return;

    let html = `
      <span class="inspector-chat-context-label">Context:</span>
      <span class="chat-attachment-chip">
        📄 ${escH(typeof currentNote !== 'undefined' && currentNote ? currentNote.title : (typeof t === 'function' ? t('chat.currentNote') : 'Current Note'))}
      </span>
    `;

    this.noteAttachedNotes.forEach(path => {
      const note = manifest.find(n => n.path === path);
      const title = note ? note.title : path.split('/').pop();
      html += `
        <span class="chat-attachment-chip">
          📝 ${escH(title)}
          <button onclick="AIChatController.toggleAttachNoteToNoteChat('${escA(path)}')" style="border:none; background:none; cursor:pointer; color:var(--text-muted); padding:0 2px; font-size:0.75rem; font-weight:bold;">&times;</button>
        </span>
      `;
    });

    html += `
      <button id="btn-inspector-attach-note" class="inspector-chat-attach-btn" onclick="AIChatController.pickNoteToAttachToNoteChat(this)">
        ➕ Attacher note
      </button>
    `;

    container.innerHTML = html;
  },

  pickNoteToAttachToNoteChat(btn) {
    if (typeof openLinkNotePicker === 'function') {
      openLinkNotePicker(btn, {
        activeNoteId: typeof currentNote !== 'undefined' ? currentNote?.id : undefined,
        excludeNoteIds: this.noteAttachedNotes,
        placeholder: typeof t === 'function' ? t('chat.searchNoteAttachPlaceholder') : 'Search note to attach…',
        emptyText: typeof t === 'function' ? t('editor.noMatchingNotes') : 'No matching notes.',
        onSelect: async (note) => {
          if (!this.noteAttachedNotes.includes(note.path)) {
            this.noteAttachedNotes.push(note.path);
            this.saveNoteConversation();
            this.renderNoteAttachments();
          }
        }
      });
    }
  },

  toggleAttachNoteToNoteChat(path) {
    const idx = this.noteAttachedNotes.indexOf(path);
    if (idx >= 0) {
      this.noteAttachedNotes.splice(idx, 1);
    } else {
      this.noteAttachedNotes.push(path);
    }
    this.saveNoteConversation();
    this.renderNoteAttachments();
  },

  openQuestionsPopup(msgIdx, actIdx) {
    const msg = this.messages[msgIdx];
    if (!msg || !msg.parsed || !Array.isArray(msg.parsed.suggested_actions)) return;
    const act = msg.parsed.suggested_actions[actIdx];
    if (!act || !act.properties || !Array.isArray(act.properties.questions)) return;

    const popup = document.getElementById('chat-questions-popup');
    if (!popup) return;

    let html = `
      <h4>
        <span>❓ Clarifications / Questions</span>
        <button type="button" class="chat-questions-close" onclick="AIChatController.closeQuestionsPopup()">&times;</button>
      </h4>
      <div style="display:flex; flex-direction:column; gap:12px; margin-top:8px; max-height:240px; overflow-y:auto; padding-right:4px;">
    `;

    act.properties.questions.forEach((q, qIdx) => {
      const qId = q.id || `q_${qIdx}`;
      const qText = q.text || '';
      const qOptions = q.options || [];
      const allowCustom = q.allow_custom !== false;
      const placeholder = q.placeholder || 'Votre réponse...';

      let optionsHTML = '';
      if (qOptions.length > 0) {
        optionsHTML = `<div class="chat-question-options">`;
        qOptions.forEach(opt => {
          optionsHTML += `
            <button type="button" class="chat-question-option-btn" onclick="AIChatController.selectQuestionOption(this, ${qIdx}, '${escA(opt)}')">
              ${escH(opt)}
            </button>
          `;
        });
        optionsHTML += `</div>`;
      }

      let customInputHTML = '';
      if (allowCustom || qOptions.length === 0) {
        customInputHTML = `
          <input 
            type="text" 
            class="chat-question-input" 
            id="chat-q-input-${qIdx}" 
            placeholder="${escA(placeholder)}"
            oninput="AIChatController.handleQuestionInput(${qIdx})"
          >
        `;
      }

      html += `
        <div class="chat-question-item" data-question-id="${escA(qId)}">
          <div class="chat-question-text">${escH(qText)}</div>
          ${optionsHTML}
          ${customInputHTML}
        </div>
      `;
    });

    html += `
      </div>
      <button type="button" class="chat-questions-submit-btn" style="margin-top:10px;" onclick="AIChatController.submitQuestions(${msgIdx}, ${actIdx})">
        Envoyer
      </button>
    `;

    popup.innerHTML = html;
    popup.style.display = 'flex';
    
    // Store selected options/values state temporarily on the controller
    this.currentQuestionsState = {
      answers: act.properties.questions.map(() => '')
    };
  },

  selectQuestionOption(btn, qIdx, value) {
    const container = btn.parentElement;
    container.querySelectorAll('.chat-question-option-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');

    if (this.currentQuestionsState) {
      this.currentQuestionsState.answers[qIdx] = value;
    }

    const input = document.getElementById(`chat-q-input-${qIdx}`);
    if (input) {
      input.value = value;
    }
  },

  handleQuestionInput(qIdx) {
    const input = document.getElementById(`chat-q-input-${qIdx}`);
    if (input && this.currentQuestionsState) {
      this.currentQuestionsState.answers[qIdx] = input.value;
    }
  },

  closeQuestionsPopup() {
    const popup = document.getElementById('chat-questions-popup');
    if (popup) {
      popup.style.display = 'none';
      popup.innerHTML = '';
    }
    this.currentQuestionsState = null;
  },

  async submitQuestions(msgIdx, actIdx) {
    if (!this.currentQuestionsState) return;
    
    const msg = this.messages[msgIdx];
    if (!msg || !msg.parsed || !Array.isArray(msg.parsed.suggested_actions)) return;
    const act = msg.parsed.suggested_actions[actIdx];
    if (!act || !act.properties || !Array.isArray(act.properties.questions)) return;

    let answersText = '';
    act.properties.questions.forEach((q, qIdx) => {
      const qText = q.text;
      const answer = (this.currentQuestionsState.answers[qIdx] || '').trim();
      if (answer) {
        answersText += `- **${qText}** : ${answer}\n`;
      }
    });

    if (!answersText.trim()) {
      toast("Veuillez répondre à au moins une question.", true);
      return;
    }

    act.accepted = true;
    this.saveCurrentConversation();
    this.closeQuestionsPopup();

    const textarea = document.getElementById('chat-input-textarea');
    if (textarea) {
      textarea.value = `Voici mes réponses :\n${answersText}`;
      this.submitMessage();
    }
  },

  async executeSearchNotesTool(props = {}) {
    const query = String(props.query || props.keywords || props.search || '').trim();
    const colleague = String(props.colleague || props.collaborator || props.author || props.mention || '').trim();
    const tagFilter = String(props.tag || props.topic || '').trim().toLowerCase();
    const groupFilter = String(props.group || '').trim().toLowerCase();
    const workstreamFilter = String(props.workstream || '').trim().toLowerCase();

    // Pagination settings
    const limit = Math.max(1, Math.min(100, parseInt(props.limit || props.page_size || props.count, 10) || 15));
    let offset = Math.max(0, parseInt(props.offset || props.skip, 10) || 0);
    if (props.page && !props.offset) {
      const pageNum = Math.max(1, parseInt(props.page, 10) || 1);
      offset = (pageNum - 1) * limit;
    }

    let sourceNotes = (typeof manifest !== 'undefined' && Array.isArray(manifest) && manifest.length > 0)
      ? manifest
      : ((typeof getAllNotes === 'function') ? await getAllNotes() : []);
    if ((!sourceNotes || sourceNotes.length === 0) && typeof StorageAPI !== 'undefined' && typeof StorageAPI.readNotesManifest === 'function') {
      try {
        sourceNotes = await StorageAPI.readNotesManifest();
      } catch (e) {
        sourceNotes = [];
      }
    }
    if (typeof normalizeManifestEntries === 'function') {
      sourceNotes = normalizeManifestEntries(sourceNotes);
    }

    let matches = [];

    // 1. Resolve colleague if specified
    let colleagueLabel = '';
    let cleanColleagueName = '';
    if (colleague) {
      cleanColleagueName = colleague.replace(/^@/, '').trim();
      const colleagueId = (typeof resolveColleagueId === 'function')
        ? resolveColleagueId(cleanColleagueName, { allowCreate: false, allowMe: true })
        : '';
      colleagueLabel = colleagueId
        ? (typeof getColleagueLabelById === 'function' ? getColleagueLabelById(colleagueId, cleanColleagueName) : cleanColleagueName)
        : cleanColleagueName;
    }

    // 2. Perform search on manifest items
    const queryLower = query.toLowerCase();
    const colleagueLower = cleanColleagueName.toLowerCase();
    const colleagueLabelLower = colleagueLabel.toLowerCase();

    for (const n of sourceNotes) {
      if (!n || !n.path) continue;

      if (tagFilter) {
        const allTags = [...(n.group_tags || []), ...(n.major_topic_tags || []), ...(n.topic_tags || []), ...(n.extra_tags || [])];
        const hasTag = allTags.some(t => t.toLowerCase() === tagFilter || t.toLowerCase().includes(tagFilter));
        if (!hasTag) continue;
      }
      if (groupFilter) {
        const grpTags = n.group_tags || [];
        const hasGroup = grpTags.some(g => g.toLowerCase() === groupFilter || g.toLowerCase().includes(groupFilter));
        if (!hasGroup) continue;
      }
      if (workstreamFilter) {
        const noteWsList = (typeof getNoteWorkstreams === 'function') ? getNoteWorkstreams(n) : (n.workstream ? [n.workstream] : []);
        const wsName = (typeof getNoteWorkstreamName === 'function') ? getNoteWorkstreamName(n) : (n.workstream || '');
        const hasWs = noteWsList.some(w => w.toLowerCase() === workstreamFilter || w.toLowerCase().includes(workstreamFilter)) ||
                      (wsName && (wsName.toLowerCase() === workstreamFilter || wsName.toLowerCase().includes(workstreamFilter)));
        if (!hasWs) continue;
      }

      let colleagueMatches = true;
      if (colleague) {
        const cached = (typeof collaborativeDataCache !== 'undefined') ? collaborativeDataCache[n.path] : null;
        const hasMention = cached && (
          (cached.mentions || []).some(m => {
            const ml = m.collaborator.toLowerCase();
            return ml === colleagueLower || ml === colleagueLabelLower;
          }) ||
          (cached.delegations || []).some(d => {
            const dl = d.collaborator.toLowerCase();
            return dl === colleagueLower || dl === colleagueLabelLower;
          })
        );

        let hasPlannerCollab = false;
        if (typeof plannerEvents !== 'undefined' && Array.isArray(plannerEvents)) {
          hasPlannerCollab = plannerEvents.some(e => {
            const isLinked = (e.noteId === n.id) || (Array.isArray(e.linkedNoteIds) && e.linkedNoteIds.includes(n.id));
            if (!isLinked) return false;

            const eventCollabs = (typeof extractPlannerCollaborators === 'function') ? extractPlannerCollaborators(e) : [];
            return eventCollabs.some(c => {
              const cl = c.toLowerCase();
              return cl === colleagueLower || cl === colleagueLabelLower;
            });
          });
        }

        colleagueMatches = hasMention || hasPlannerCollab;
      }

      if (!colleagueMatches) continue;

      let keywordMatches = true;
      if (query) {
        const titleMatch = (n.title || '').toLowerCase().includes(queryLower);
        const tagsMatch = [
          ...(n.group_tags || []),
          ...(n.major_topic_tags || []),
          ...(n.topic_tags || []),
          ...(n.extra_tags || [])
        ].some(t => t.toLowerCase().includes(queryLower));
        const summaryMatch = (n.summary || '').toLowerCase().includes(queryLower);
        const previewMatch = (n.preview || '').toLowerCase().includes(queryLower);

        let matchesMetadata = titleMatch || tagsMatch || summaryMatch || previewMatch;

        if (!matchesMetadata && typeof StorageAPI !== 'undefined' && typeof StorageAPI.readNoteContent === 'function') {
          try {
            let text = '';
            const cachedContent = (typeof noteContentCache !== 'undefined') ? noteContentCache[n.path] : null;
            if (cachedContent && cachedContent.modified === n.modified) {
              text = cachedContent.text;
            } else {
              const html = await StorageAPI.readNoteContent(n.path);
              const parsedHtml = (typeof parseNoteHTML === 'function') ? parseNoteHTML(html) : { mainHTML: html };
              if (typeof DOMParser !== 'undefined') {
                text = new DOMParser().parseFromString('<div>' + (parsedHtml.mainHTML || '') + '</div>', 'text/html').body.textContent || '';
              } else {
                text = String(parsedHtml.mainHTML || '').replace(/<[^>]+>/g, ' ');
              }

              if (typeof noteContentCache !== 'undefined') {
                noteContentCache[n.path] = {
                  modified: n.modified || '',
                  text: text
                };
              }
            }
            matchesMetadata = text.toLowerCase().includes(queryLower);
          } catch (e) {
            // non-fatal content read error
          }
        }
        keywordMatches = matchesMetadata;
      }

      if (keywordMatches) {
        matches.push(n);
      }
    }

    // Sort by modified date descending
    matches.sort((a, b) => (b.modified || b.date || '').localeCompare(a.modified || a.date || ''));

    const totalMatches = matches.length;
    const slicedMatches = matches.slice(offset, offset + limit);
    const startIdx = totalMatches === 0 ? 0 : offset + 1;
    const endIdx = offset + slicedMatches.length;
    const hasNextPage = endIdx < totalMatches;
    const nextOffset = offset + limit;

    if (totalMatches === 0) {
      let filterDesc = [];
      if (query) filterDesc.push(`mots-clés "${query}"`);
      if (colleague) filterDesc.push(`collègue "${colleague}"`);
      if (tagFilter) filterDesc.push(`tag "${tagFilter}"`);
      if (groupFilter) filterDesc.push(`groupe "${groupFilter}"`);
      if (workstreamFilter) filterDesc.push(`workstream "${workstreamFilter}"`);
      return filterDesc.length
        ? `Aucune note ne correspond aux critères de recherche: ${filterDesc.join(' et ')}.`
        : `Aucune note trouvée dans le carnet.`;
    }

    let resultText = `Résultats de la recherche (notes ${startIdx} à ${endIdx} sur ${totalMatches} au total) :\n` +
      slicedMatches.map((n, i) => {
        const tags = [
          ...(n.group_tags || []),
          ...(n.major_topic_tags || []),
          ...(n.topic_tags || [])
        ];
        const snippet = (n.summary || n.preview || '').slice(0, 150).replace(/\n/g, ' ');
        return `- Note #${offset + i + 1}: "${n.title}"\n  Path: ${n.path}\n  ID: ${n.id || ''}\n  Date: ${n.date || 'Inconnue'}\n  Tags: ${JSON.stringify(tags)}\n  Aperçu: ${snippet}...`;
      }).join('\n\n');

    if (hasNextPage) {
      const remaining = totalMatches - endIdx;
      resultText += `\n\n[Page suivante disponible: ${remaining} note(s) restante(s). Pour voir la suite (notes ${endIdx + 1} à ${Math.min(totalMatches, endIdx + limit)}), appelle "search_notes" avec "offset": ${nextOffset}, "limit": ${limit}.]`;
    }

    return resultText;
  }
};

window.AIChatController = AIChatController;

window.mountAiConversationLaneInInspector = function(container) {
  if (!container) return;
  container.innerHTML = `
    <div class="inspector-chat-container">
      <div class="inspector-chat-header">
        <span>🤖 Secretary</span>
        <div style="display:flex; gap: 6px;">
          <button class="btn btn-secondary" onclick="AIChatController.triggerNoteReview()" style="padding: 2px 6px; font-size: 0.7rem; border-radius: 4px; display: flex; align-items: center; gap: 2px;" title="Demander à Secretary d'analyser cette note et d'extraire des tâches">⚡ Revoir la note</button>
          <button class="btn" onclick="AIChatController.clearNoteChat()" style="padding: 2px 4px; font-size: 0.7rem; border-radius: 4px;" title="Effacer la conversation">🗑️</button>
        </div>
      </div>
      <div class="inspector-chat-messages" id="inspector-chat-messages">
        <!-- Messages -->
      </div>
      <div class="inspector-chat-input-container">
        <div class="inspector-chat-top-bar" id="inspector-chat-attachments">
          <!-- Rendered by renderNoteAttachments() -->
        </div>

        <textarea id="inspector-chat-textarea" placeholder="Demander à Secretary..." onkeydown="AIChatController.handleInspectorKeyDown(event)"></textarea>

        <div class="inspector-chat-bottom-bar">
          <!-- Effort Native Select on bottom left of bottom row -->
          <div class="inspector-chat-effort-select-wrap" id="inspector-effort-select-wrap">
            <span class="inspector-chat-effort-label">Effort</span>
            <select id="inspector-thinking-effort-select" class="inspector-chat-effort-select" onchange="setPromptThinkingEffort('chat', this.value, AIChatController.currentNoteChatId); AIChatController.syncNoteThinkingControls();"></select>
          </div>

          <button class="inspector-chat-send-btn" onclick="AIChatController.submitInspectorMessage()">✈️</button>
        </div>
      </div>
    </div>
  `;
};

window.renderAiConversationLane = function(note) {
  if (!note) return;
  AIChatController.loadNoteConversation(note);
};

window.unmountAiLane = function() {
  if (AIChatController.isNoteThinking) {
    AIChatController.stopCurrentRequest();
  }
};

let bulkSummaryAbortController = null;

window.runBulkAISummaries = async function() {
  const weeksInput = document.getElementById('bulk-summary-weeks');
  const numWeeks = parseInt(weeksInput ? weeksInput.value : '4') || 4;
  
  const isAIEnabled = typeof LLMService !== 'undefined' && LLMService.isEnabled();
  if (!isAIEnabled) {
    toast("L'assistant IA local est désactivé. Veuillez l'activer dans les Préférences.", true);
    return;
  }

  const controls = document.getElementById('bulk-summary-controls');
  const progressContainer = document.getElementById('bulk-summary-progress-container');
  const progressBar = document.getElementById('bulk-summary-progress-bar');
  const progressText = document.getElementById('bulk-summary-progress-text');

  // Filter notes from manifest
  const now = new Date();
  const cutoffTime = now.getTime() - numWeeks * 7 * 24 * 60 * 60 * 1000;
  
  const notesToProcess = manifest.filter(n => {
    const hasSummary = typeof hasValidNoteSummary === 'function'
      ? hasValidNoteSummary(n.summary)
      : (n.summary && n.summary.trim() !== '' && n.summary !== '<p></p>' && n.summary !== '<p><br></p>');
    if (hasSummary) return false;
    
    let noteTime = 0;
    if (n.date) {
      noteTime = new Date(n.date).getTime();
    } else if (n.modified) {
      noteTime = new Date(n.modified).getTime();
    }
    return noteTime >= cutoffTime;
  });

  if (notesToProcess.length === 0) {
    toast(`Aucune note sans résumé trouvée pour les dernières ${numWeeks} semaines.`);
    return;
  }

  if (controls) controls.style.display = 'none';
  if (progressContainer) progressContainer.style.display = 'flex';
  if (progressBar) progressBar.style.width = '0%';

  bulkSummaryAbortController = new AbortController();

  await AIChatController.generateNoteSummaries(notesToProcess, (n, completed, total) => {
    if (progressText) progressText.textContent = `Génération pour "${n.title}" (${completed + 1} / ${total})...`;
    if (progressBar) progressBar.style.width = `${(completed / total) * 100}%`;
  }, bulkSummaryAbortController.signal);

  if (bulkSummaryAbortController && bulkSummaryAbortController.signal.aborted) {
    toast("Génération en bloc annulée.");
  } else {
    toast("Génération des résumés terminée avec succès !");
  }

  bulkSummaryAbortController = null;
  if (controls) controls.style.display = 'flex';
  if (progressContainer) progressContainer.style.display = 'none';
};

window.cancelBulkAISummaries = function() {
  if (bulkSummaryAbortController) {
    bulkSummaryAbortController.abort();
  }
};

function getActiveAiButton() {
  const overlay = document.getElementById('note-edit-overlay');
  const overlayAi = document.getElementById('btn-overlay-ai');
  if (overlay && overlay.style.display !== 'none' && overlayAi && overlayAi.getBoundingClientRect().width > 0) {
    return overlayAi;
  }
  return document.getElementById('btn-topbar-ai') || overlayAi;
}

function animateFloatingChatToButton(el, callback) {
  const btn = getActiveAiButton();
  if (!btn || !el) {
    if (callback) callback();
    return;
  }
  const btnRect = btn.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();

  const btnCenterX = btnRect.left + btnRect.width / 2;
  const btnCenterY = btnRect.top + btnRect.height / 2;
  const elCenterX = elRect.left + elRect.width / 2;
  const elCenterY = elRect.top + elRect.height / 2;

  const translateX = btnCenterX - elCenterX;
  const translateY = btnCenterY - elCenterY;

  el.style.transition = 'transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.32s ease-in';
  el.style.transformOrigin = 'center center';
  el.style.transform = `translate(${translateX}px, ${translateY}px) scale(0.05)`;
  el.style.opacity = '0';
  el.style.pointerEvents = 'none';

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    el.removeEventListener('transitionend', finish);
    el.style.removeProperty('transition');
    el.style.removeProperty('transform');
    el.style.removeProperty('transform-origin');
    el.style.removeProperty('opacity');
    el.style.removeProperty('pointer-events');
    if (callback) callback();
  };
  el.addEventListener('transitionend', finish, { once: true });
  setTimeout(finish, 380);
}

function animateFloatingChatFromButton(el) {
  const btn = getActiveAiButton();
  if (!btn || !el) return;

  const btnRect = btn.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();

  const btnCenterX = btnRect.left + btnRect.width / 2;
  const btnCenterY = btnRect.top + btnRect.height / 2;
  const elCenterX = elRect.left + elRect.width / 2;
  const elCenterY = elRect.top + elRect.height / 2;

  const translateX = btnCenterX - elCenterX;
  const translateY = btnCenterY - elCenterY;

  el.style.transition = 'none';
  el.style.transformOrigin = 'center center';
  el.style.transform = `translate(${translateX}px, ${translateY}px) scale(0.05)`;
  el.style.opacity = '0';

  void el.offsetWidth; // Force reflow

  el.style.transition = 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.35s ease-out';
  el.style.transform = 'translate(0px, 0px) scale(1)';
  el.style.opacity = '1';

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    el.removeEventListener('transitionend', finish);
    el.style.removeProperty('transition');
    el.style.removeProperty('transform');
    el.style.removeProperty('transform-origin');
    el.style.removeProperty('opacity');
  };
  el.addEventListener('transitionend', finish, { once: true });
  setTimeout(finish, 420);
}

function updateAiButtons(active) {
  document.querySelectorAll('#btn-topbar-ai, #btn-overlay-ai, .topbar-ai-btn').forEach(b => {
    b.classList.toggle('active', !!active);
  });
}

function triggerChatFlashUpward() {
  const el = document.getElementById('floating-secretary-chat');
  if (!el) return;

  el.classList.remove('chat-flash-upward');
  void el.offsetWidth; // Force CSS reflow so animation restarts cleanly
  el.classList.add('chat-flash-upward');

  setTimeout(() => {
    if (el) el.classList.remove('chat-flash-upward');
  }, 1400);
}

function toggleFloatingChat() {
  const el = document.getElementById('floating-secretary-chat');

  // If in chat window mode, clicking close inside the header closes the window!
  if (document.body.classList.contains('chat-window-mode') || document.body.classList.contains('secretary-window-standalone')) {
    if (window.electronAPI?.closeWindow) {
      window.electronAPI.closeWindow();
      return;
    }
    try { window.close(); } catch (e) {}
    return;
  }

  // If running inside Electron, AI agent always opens in a dedicated window!
  if (window.AppBridge?.isElectron) {
    if (window.AppBridge?.chatWindow) {
      window.AppBridge.chatWindow.open();
      // Ensure in-page floating chat modal is not kept open
      if (el && el.classList.contains('is-open')) {
        el.classList.remove('is-open');
        el.style.removeProperty('display');
      }
      updateAiButtons(true);
      return;
    }
  }

  if (!el) return;

  const isMinimized = el.classList.contains('minimized');
  const isOpen = el.classList.contains('is-open');

  if (isOpen && !isMinimized) {
    animateFloatingChatToButton(el, () => {
      el.classList.remove('is-open');
      el.style.removeProperty('display');
      updateAiButtons(false);
    });
  } else {
    const body = document.getElementById('floating-chat-body');
    if (body) body.style.display = 'flex';

    if (isMinimized) {
      el.classList.remove('minimized');
      el.style.height = el.dataset.prevHeight || '680px';
      el.style.minHeight = '440px';
    }

    AIChatController.leftSidebarCollapsed = true;
    AIChatController.rightSidebarCollapsed = true;

    el.classList.add('is-open');
    el.style.removeProperty('display');

    updateAiButtons(true);

    if (!el.style.top && !el.style.left) {
      const initialWidth = Math.min(880, Math.floor(window.innerWidth * 0.9));
      const initialHeight = Math.min(680, Math.floor(window.innerHeight * 0.85));
      el.style.width = `${initialWidth}px`;
      el.style.height = `${initialHeight}px`;
      el.style.top = `${Math.max(40, Math.floor((window.innerHeight - initialHeight) / 2))}px`;
      el.style.left = `${Math.max(20, Math.floor((window.innerWidth - initialWidth) / 2))}px`;
      el.style.right = 'auto';
    }

    const header = document.getElementById('floating-chat-header');
    if (header && typeof window.makeDraggable === 'function') {
      window.makeDraggable(el, header);
    }
    if (typeof window.makeResizable === 'function') {
      window.makeResizable(el);
    }

    try {
      AIChatController.render();
      AIChatController.renderAttachments();
    } catch (e) {
      console.error('Error rendering AIChatController in floating chat:', e);
    }

    animateFloatingChatFromButton(el);

    // Auto-trigger agent guide if first time opening floating chat
    setTimeout(() => {
      try {
        if (localStorage.getItem('secretary_agent_guided_seen') !== 'true') {
          AIChatController.showAgentGuide();
        }
      } catch (e) {}
    }, 450);
  }
}

function minimizeFloatingChat() {
  if (document.body.classList.contains('chat-window-mode') || document.body.classList.contains('secretary-window-standalone')) {
    if (window.electronAPI?.minimizeWindow) {
      window.electronAPI.minimizeWindow();
      return;
    }
  }

  const el = document.getElementById('floating-secretary-chat');
  if (!el) return;

  const isMinimized = !el.classList.contains('minimized');
  const body = document.getElementById('floating-chat-body');

  if (isMinimized) {
    animateFloatingChatToButton(el, () => {
      el.classList.add('minimized');
      el.dataset.prevHeight = el.style.height || '680px';
      el.style.height = '40px';
      el.style.minHeight = '40px';
      el.style.boxShadow = 'none';
      if (body) body.style.display = 'none';
      el.style.transform = 'none';
      el.style.opacity = '1';
    });
  } else {
    el.classList.remove('minimized');
    el.style.height = el.dataset.prevHeight || '680px';
    el.style.minHeight = '440px';
    el.style.boxShadow = 'var(--shadow-lg)';
    if (body) body.style.display = 'flex';
    
    // Rerender on restore
    AIChatController.render();
    animateFloatingChatFromButton(el);
  }
}

function toggleMaximizeFloatingChat(el) {
  if (document.body.classList.contains('chat-window-mode') || document.body.classList.contains('secretary-window-standalone')) {
    if (window.AppBridge?.windowControls?.toggleMaximize) {
      window.AppBridge.windowControls.toggleMaximize();
      return;
    }
    if (window.electronAPI?.toggleMaximizeWindow) {
      window.electronAPI.toggleMaximizeWindow();
      return;
    }
  }

  if (!el) el = document.getElementById('floating-secretary-chat');
  if (!el) return;

  if (el.classList.contains('minimized')) {
    el.classList.remove('minimized');
    el.style.height = el.dataset.prevHeight || '680px';
    el.style.minHeight = '440px';
    el.style.boxShadow = 'var(--shadow-lg)';
    const body = document.getElementById('floating-chat-body');
    if (body) body.style.display = 'flex';
  }

  const isMaximized = el.classList.contains('is-maximized');
  if (isMaximized) {
    el.classList.remove('is-maximized');
    el.style.width = el.dataset.prevWidth || '880px';
    el.style.height = el.dataset.prevHeight || '680px';
    el.style.top = el.dataset.prevTop || '40px';
    el.style.left = el.dataset.prevLeft || '40px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  } else {
    el.dataset.prevWidth = el.style.width || (el.offsetWidth + 'px');
    el.dataset.prevHeight = el.style.height || (el.offsetHeight + 'px');
    el.dataset.prevTop = el.style.top || (el.offsetTop + 'px');
    el.dataset.prevLeft = el.style.left || (el.offsetLeft + 'px');

    el.classList.add('is-maximized');
    const margin = 10;
    el.style.top = `${margin}px`;
    el.style.left = `${margin}px`;
    el.style.width = `calc(100vw - ${margin * 2}px)`;
    el.style.height = `calc(100vh - ${margin * 2}px)`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  }
}

function openFloatingChatFromOmnibar() {
  // Close omnibar modal first
  const omnibarOverlay = document.getElementById('omnibar-overlay');
  if (omnibarOverlay) {
    omnibarOverlay.style.display = 'none';
    if (typeof OmnibarController !== 'undefined' && typeof OmnibarController.close === 'function') {
      OmnibarController.close();
    }
  }
  
  // Show floating chat if not already visible
  const el = document.getElementById('floating-secretary-chat');
  if (el && el.style.display === 'none') {
    toggleFloatingChat();
  }
}

function syncFloatingChatContext() {
  if (typeof AIChatController !== 'undefined' && typeof AIChatController.renderAttachments === 'function') {
    const el = document.getElementById('floating-secretary-chat');
    if (el && el.style.display !== 'none') {
      AIChatController.renderAttachments();
    }
  }
}

// Bind to window for programmatic calls
window.updateAiButtons = updateAiButtons;
window.triggerChatFlashUpward = triggerChatFlashUpward;
window.toggleFloatingChat = toggleFloatingChat;
window.minimizeFloatingChat = minimizeFloatingChat;
window.toggleMaximizeFloatingChat = toggleMaximizeFloatingChat;
window.openFloatingChatFromOmnibar = openFloatingChatFromOmnibar;
window.syncFloatingChatContext = syncFloatingChatContext;

window._realToggleFloatingChat = toggleFloatingChat;
window._realMinimizeFloatingChat = minimizeFloatingChat;
window._realToggleMaximizeFloatingChat = toggleMaximizeFloatingChat;
window._realOpenFloatingChatFromOmnibar = openFloatingChatFromOmnibar;

// Listen for Electron IPC events for upward flashing & state sync
if (typeof window !== 'undefined' && window.electronAPI) {
  if (typeof window.electronAPI.onFlashWindowUpward === 'function') {
    window.electronAPI.onFlashWindowUpward(() => {
      triggerChatFlashUpward();
    });
  }
  if (typeof window.electronAPI.onChatWindowStateChange === 'function') {
    window.electronAPI.onChatWindowStateChange((isOpen) => {
      updateAiButtons(isOpen);
    });
  }
  if (typeof window.electronAPI.isChatWindowOpen === 'function') {
    window.electronAPI.isChatWindowOpen().then((isOpen) => {
      updateAiButtons(isOpen);
    }).catch(() => {});
  }
}

function makeResizable(el) {
  if (!el || el._isResizableBound) return;
  el._isResizableBound = true;

  const handles = el.querySelectorAll('.chat-resize-handle');
  const minW = 440;
  const minH = 320;
  const margin = 8;

  handles.forEach(handle => {
    handle.addEventListener('mousedown', (e) => {
      if (el.classList.contains('minimized') || document.body.classList.contains('chat-window-mode')) return;
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startY = e.clientY;
      const rect = el.getBoundingClientRect();
      const startWidth = rect.width;
      const startHeight = rect.height;
      const startTop = rect.top;
      const startLeft = rect.left;

      const isN = handle.classList.contains('resize-n') || handle.classList.contains('resize-nw') || handle.classList.contains('resize-ne');
      const isS = handle.classList.contains('resize-s') || handle.classList.contains('resize-sw') || handle.classList.contains('resize-se');
      const isW = handle.classList.contains('resize-w') || handle.classList.contains('resize-nw') || handle.classList.contains('resize-sw');
      const isE = handle.classList.contains('resize-e') || handle.classList.contains('resize-ne') || handle.classList.contains('resize-se');

      const prevUserSelect = document.body.style.userSelect;
      document.body.style.userSelect = 'none';

      function doResize(me) {
        me.preventDefault();
        const dx = me.clientX - startX;
        const dy = me.clientY - startY;

        let newW = startWidth;
        let newH = startHeight;
        let newT = startTop;
        let newL = startLeft;

        if (isE) {
          const maxW = window.innerWidth - startLeft - margin;
          newW = Math.min(Math.max(startWidth + dx, minW), maxW);
        }
        if (isW) {
          const maxW = startLeft + startWidth - margin;
          const potentialW = startWidth - dx;
          newW = Math.min(Math.max(potentialW, minW), maxW);
          newL = startLeft + (startWidth - newW);
        }
        if (isS) {
          const maxH = window.innerHeight - startTop - margin;
          newH = Math.min(Math.max(startHeight + dy, minH), maxH);
        }
        if (isN) {
          const maxH = startTop + startHeight - margin;
          const potentialH = startHeight - dy;
          newH = Math.min(Math.max(potentialH, minH), maxH);
          newT = startTop + (startHeight - newH);
        }

        el.style.width = `${newW}px`;
        el.style.height = `${newH}px`;
        el.style.top = `${newT}px`;
        el.style.left = `${newL}px`;
        el.style.right = 'auto';
        el.style.bottom = 'auto';
      }

      function stopResize() {
        document.body.style.userSelect = prevUserSelect;
        window.removeEventListener('mousemove', doResize);
        window.removeEventListener('mouseup', stopResize);
      }

      window.addEventListener('mousemove', doResize);
      window.addEventListener('mouseup', stopResize);
    });
  });
}

window.makeResizable = makeResizable;

try {
  AIChatController.init();
} catch (e) {
  console.error("Failed to initialize AIChatController:", e);
}




