'use strict';

/**
 * Secretary - Super Modern Omnibar & Command Palette Engine
 * Features:
 * - Raycast/Spotlight-grade live workspace search (Notes, Tasks, Decisions, Planner Events, Tabs).
 * - Full command palette (/todo, /block, /note, /call, /dec, /stash, /secretary, /nav).
 * - Inline dynamic ghost suggestions with synchronized horizontal scroll.
 * - Bidirectional Tab / Shift+Tab option cycling.
 * - Keyboard navigation (↑/↓/Enter/Cmd+Enter/Esc) with smooth spring micro-animations.
 * - Multi-lingual natural date, time, and duration parser.
 * - Command history navigation.
 * - Full ARIA combobox accessibility.
 */
const OmnibarController = {
  isOpen: false,
  results: [],
  selectedIndex: 0,
  history: [],
  historyIndex: -1,
  currentQuery: '',
  searchDebounceTimer: null,
  tabCycle: {
    active: false,
    tokenType: '',
    options: [],
    index: 0
  },

  init() {
    if (this._initialized) return;
    this._initialized = true;

    // Global keyboard shortcut listeners (Cmd+K, Ctrl+K, Ctrl+Shift+Space, Cmd+Shift+Space)
    document.addEventListener('keydown', (e) => {
      const isCmdK = (e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K' || e.code === 'KeyK');
      const isOmniShortcut = (e.ctrlKey || e.metaKey) && e.shiftKey && (e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar' || e.keyCode === 32);
      
      const shouldTrigger = isOmniShortcut || (isCmdK && !this.isEditingInsideRichText(e));
      if (shouldTrigger) {
        e.preventDefault();
        this.toggle();
      } else if (e.key === 'Escape' && this.isOpen) {
        e.preventDefault();
        this.close();
      }
    });

    // Listen for Electron global shortcut (Cmd/Ctrl+Shift+Space)
    if (window.AppBridge?.omnibar?.onTrigger) {
      window.AppBridge.omnibar.onTrigger(() => {
        this.open();
      });
    }

    const overlay = document.getElementById('omnibar-overlay');
    if (overlay) {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          this.close();
        }
      });
    }

    const input = document.getElementById('omnibar-input');
    const container = document.getElementById('omnibar-container');
    const ghostLayer = document.getElementById('omnibar-ghost-layer');

    if (input) {
      // Sync horizontal scroll between input and ghost overlay layer
      input.addEventListener('scroll', () => {
        if (ghostLayer) ghostLayer.scrollLeft = input.scrollLeft;
      });

      input.addEventListener('input', () => {
        if (input.value.trim().length > 30) {
          if (container) container.classList.add('wide');
        } else {
          if (container) container.classList.remove('wide');
        }
        this.tabCycle.active = false;
        this.historyIndex = -1;
        this.updateGhostSuggestion();
        this.scheduleLiveSearch();
      });

      // Track cursor position changes (arrow keys, click, selection)
      ['keyup', 'click', 'selectionchange'].forEach(evt => {
        input.addEventListener(evt, () => {
          this.updateParamIndicator();
        });
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          this.navigateResults(1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (this.results.length > 0) {
            this.navigateResults(-1);
          } else if (input.value === '') {
            this.navigateHistory();
          }
        } else if (e.key === 'Enter') {
          e.preventDefault();
          this.executeSelected(e.metaKey || e.ctrlKey);
        } else if (e.key === 'Tab') {
          e.preventDefault();
          this.handleTabCompletion(e.shiftKey);
        } else if (e.key === 'ArrowRight' && input.selectionStart === input.value.length) {
          const ghostInfo = this.getGhostSuggestionInfo(input.value);
          if (ghostInfo && ghostInfo.tabComplete) {
            e.preventDefault();
            this.handleTabCompletion(false);
          }
        }
      });
    }
  },

  isEditingInsideRichText(e) {
    const active = document.activeElement;
    if (!active) return false;
    const isModalOpen = document.getElementById('note-edit-overlay')?.style.display === 'flex';
    // If inside note edit overlay text editor, allow Cmd+K for link insertion
    if (isModalOpen && (active.id === 'edit-textarea' || active.isContentEditable)) {
      return true;
    }
    return false;
  },

  open() {
    const isStorageReady = Boolean((typeof rootHandle !== 'undefined' && rootHandle) || (typeof StorageAPI !== 'undefined' && typeof StorageAPI.getStorageEngine === 'function' && StorageAPI.getStorageEngine() === 'firebase'));
    if (!isStorageReady) {
      toast(t('omnibar.openFolderFirst'), true);
      return;
    }
    const overlay = document.getElementById('omnibar-overlay');
    const input = document.getElementById('omnibar-input');
    const container = document.getElementById('omnibar-container');
    const results = document.getElementById('omnibar-results');

    if (overlay && input) {
      if (overlay._closeTimer) {
        clearTimeout(overlay._closeTimer);
        overlay._closeTimer = null;
      }
      overlay.classList.remove('closing');
      overlay.classList.add('active');
      overlay.style.display = 'flex';
      input.value = '';
      input.placeholder = (typeof t === 'function' && t('omnibar.inputPlaceholder')) ? t('omnibar.inputPlaceholder') : 'What do you want to do?';
      const aiBtn = document.getElementById('omnibar-ai-btn');
      if (aiBtn) {
        aiBtn.setAttribute('title', (typeof t === 'function' && t('omnibar.aiChatTitle')) ? t('omnibar.aiChatTitle') : 'Open Secretary Chat');
      }
      if (container) container.classList.remove('wide');
      if (results) results.style.display = 'none';
      
      this.isOpen = true;
      this.results = [];
      this.selectedIndex = 0;
      this.tabCycle.active = false;
      this.historyIndex = -1;
      
      // Prevent background scrolling while modal is open
      document.body.style.overflow = 'hidden';

      this.updateGhostSuggestion();
      this.renderDefaultHints();

      setTimeout(() => {
        input.focus();
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
      }, 50);
    }
  },

  close() {
    const overlay = document.getElementById('omnibar-overlay');
    const container = document.getElementById('omnibar-container');
    const results = document.getElementById('omnibar-results');
    const input = document.getElementById('omnibar-input');

    if (overlay) {
      if (overlay.classList.contains('closing')) return;
      if (overlay._closeTimer) clearTimeout(overlay._closeTimer);
      overlay.classList.add('closing');
      overlay._closeTimer = setTimeout(() => {
        overlay.style.display = 'none';
        overlay.classList.remove('active', 'closing');
        overlay._closeTimer = null;
        if (container) container.classList.remove('wide');
        if (results) results.style.display = 'none';
      }, 150);
      
      if (input) {
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
      }
      
      this.isOpen = false;
      this.results = [];
      this.tabCycle.active = false;
      this.clearGhostSuggestion();
      this.clearParamIndicator();
      
      // Restore background scrolling
      document.body.style.overflow = '';
    }
  },

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  },

  getLocalizedCommand(cmdOrType) {
    if (!cmdOrType) return t('omnibar.cmdTodo') || '/todo';
    const clean = String(cmdOrType).replace(/^\//, '').toLowerCase();
    const map = {
      todo: t('omnibar.cmdTodo') || '/todo',
      task: t('omnibar.cmdTodo') || '/todo',
      block: t('omnibar.cmdBlock') || '/block',
      event: t('omnibar.cmdBlock') || '/block',
      call: t('omnibar.cmdCall') || '/call',
      dec: t('omnibar.cmdDec') || '/dec',
      decision: t('omnibar.cmdDec') || '/dec',
      note: t('omnibar.cmdNote') || '/note',
      stash: t('omnibar.cmdStash') || '/stash',
      thought: t('omnibar.cmdStash') || '/stash',
      secretary: t('omnibar.cmdSecretary') || '/secretary'
    };
    if (map[clean]) return map[clean];
    const match = this.matchCommandType(cmdOrType.startsWith('/') ? cmdOrType : '/' + cmdOrType);
    if (match && map[match.type]) return map[match.type];
    return cmdOrType.startsWith('/') ? cmdOrType : '/' + cmdOrType;
  },

  setCommandPrefix(prefix) {
    const input = document.getElementById('omnibar-input');
    const locCmd = this.getLocalizedCommand(prefix);
    if (input) {
      input.value = locCmd + ' ';
    }
    const match = this.matchCommandType(prefix.startsWith('/') ? prefix : '/' + prefix);
    if (match && ['todo', 'dec', 'block', 'note', 'call'].includes(match.type)) {
      this.initSegmentedMode(match.type);
      return;
    }
    if (input) {
      input.focus();
      this.tabCycle.active = false;
      this.updateGhostSuggestion();
      this.scheduleLiveSearch();
    }
  },

  appendToken(token) {
    const input = document.getElementById('omnibar-input');
    if (!input) return;
    let val = input.value.trim();
    if (val.length > 0) {
      input.value = val + ' ' + token + ' ';
    } else {
      input.value = token + ' ';
    }
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    this.tabCycle.active = false;
    this.updateGhostSuggestion();
    this.scheduleLiveSearch();
  },

  scheduleLiveSearch() {
    if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);
    this.searchDebounceTimer = setTimeout(() => {
      this.performLiveSearch();
    }, 40);
  },

  /**
   * Calculates a relevance score (0-100+) for search items based on Apple Spotlight ranking heuristics
   */
  calculateRelevanceScore(query, title, subtitle = '', tags = []) {
    if (!query || !title) return 0;
    const cleanQ = query.trim().toLowerCase();
    const cleanTitle = String(title).toLowerCase();
    const cleanSub = String(subtitle || '').toLowerCase();
    const cleanTags = (Array.isArray(tags) ? tags : []).map(t => String(t).toLowerCase());

    if (cleanTitle === cleanQ) return 100;

    let score = 0;
    if (cleanTitle.startsWith(cleanQ)) {
      score += 60;
    } else {
      const words = cleanTitle.split(/[\s\-_.,;:/()[\]]+/);
      if (words.some(w => w.startsWith(cleanQ))) {
        score += 45;
      } else if (cleanTitle.includes(cleanQ)) {
        score += 25;
      }
    }

    if (cleanSub.includes(cleanQ)) {
      score += 15;
    }

    if (cleanTags.some(tg => tg.startsWith(cleanQ))) {
      score += 20;
    } else if (cleanTags.some(tg => tg.includes(cleanQ))) {
      score += 10;
    }

    return score;
  },

  /**
   * Performs Live Fuzzy Search across workspace objects and commands
   */
  performLiveSearch() {
    const input = document.getElementById('omnibar-input');
    const resultsContainer = document.getElementById('omnibar-results');
    if (!input || !resultsContainer) return;

    const query = input.value.trim();
    this.currentQuery = query;

    if (!query) {
      resultsContainer.style.display = 'none';
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      this.results = [];
      this.renderDefaultHints();
      return;
    }

    // If typing a specific command with arguments (e.g. /todo Buy milk, /appel Point client, /call Sync), render live preview card!
    const cmdMatch = this.matchCommandType(query);
    if (cmdMatch && query.length > cmdMatch.cmdLen && /\s/.test(query.slice(0, cmdMatch.cmdLen + 1))) {
      this.renderRawCommandLivePreview(cmdMatch, query);
      return;
    } else {
      const container = document.getElementById('omnibar-container');
      if (container && !this.segmentedState.active) {
        container.classList.remove('theme-decision', 'theme-todo', 'theme-block', 'theme-note', 'theme-call');
        container.removeAttribute('data-urgency');
      }
    }

    const lower = query.toLowerCase();

    // 1. Navigation Targets
    const navs = [
      { id: 'nav-notes', label: t('topbar.notes'), tab: 'notes', icon: typeof AppIcons !== 'undefined' ? AppIcons.get('notes', { size: 16 }) : '📝', cat: t('omnibar.sectionNavigation') },
      { id: 'nav-planner', label: t('topbar.planner'), tab: 'planner', icon: typeof AppIcons !== 'undefined' ? AppIcons.get('planner', { size: 16 }) : '📅', cat: t('omnibar.sectionNavigation') },
      { id: 'nav-todos', label: t('topbar.todos'), tab: 'todos-mode', icon: typeof AppIcons !== 'undefined' ? AppIcons.get('todos', { size: 16 }) : '✅', cat: t('omnibar.sectionNavigation') },
      { id: 'nav-decisions', label: t('topbar.workstreams'), tab: 'decisions', icon: typeof AppIcons !== 'undefined' ? AppIcons.get('workstream', { size: 16 }) : '⚖️', cat: t('omnibar.sectionNavigation') },
      { id: 'nav-retro', label: t('topbar.retro'), tab: 'retro', icon: typeof AppIcons !== 'undefined' ? AppIcons.get('retro', { size: 16 }) : '🔄', cat: t('omnibar.sectionNavigation') },
      { id: 'nav-review', label: t('topbar.dailyReview'), tab: 'daily-review', icon: typeof AppIcons !== 'undefined' ? AppIcons.get('dailyReview', { size: 16 }) : '🌅', cat: t('omnibar.sectionNavigation') },
      { id: 'nav-chat', label: t('topbar.chat'), tab: 'chat', icon: typeof AppIcons !== 'undefined' ? AppIcons.get('ai', { size: 16 }) : '🤖', cat: t('omnibar.sectionNavigation') },
      { id: 'nav-team', label: t('topbar.team'), tab: 'team', icon: typeof AppIcons !== 'undefined' ? AppIcons.get('team', { size: 16 }) : '👥', cat: t('omnibar.sectionNavigation') },
      { id: 'nav-prefs', label: t('topbar.prefsTitle'), tab: 'prefs', icon: typeof AppIcons !== 'undefined' ? AppIcons.get('prefs', { size: 16 }) : '⚙️', cat: t('omnibar.sectionNavigation') }
    ];

    const matchedNavs = [];
    navs.forEach(nav => {
      const score = this.calculateRelevanceScore(lower, nav.label, nav.tab);
      if (score > 0 || nav.label.toLowerCase().includes(lower) || nav.tab.includes(lower)) {
        matchedNavs.push({
          type: 'nav',
          id: nav.id,
          title: nav.label,
          meta: `→ ${nav.label}`,
          icon: nav.icon,
          tab: nav.tab,
          cat: nav.cat,
          score: score || 10
        });
      }
    });
    matchedNavs.sort((a, b) => b.score - a.score);

    // 2. Command Palette Actions
    const cmdTodo = t('omnibar.cmdTodo') || '/todo';
    const cmdBlock = t('omnibar.cmdBlock') || '/block';
    const cmdCall = t('omnibar.cmdCall') || '/call';
    const cmdNote = t('omnibar.cmdNote') || '/note';
    const cmdDec = t('omnibar.cmdDec') || '/dec';
    const cmdStash = t('omnibar.cmdStash') || '/stash';
    const cmdSec = t('omnibar.cmdSecretary') || '/secretary';

    const cmds = [
      { cmd: cmdTodo, alt: '/todo', type: 'todo', syntaxText: `${cmdTodo} [now|plan|del|later] ${t('omnibar.paramLabel') || '<title>'}`, meta: t('omnibar.hintTodo') || 'Create a task', icon: '✅' },
      { cmd: cmdBlock, alt: '/block', type: 'block', syntaxText: `${cmdBlock} ${t('omnibar.paramLabel') || '<title>'} [${t('omnibar.paramDate') || 'date'}] [${t('omnibar.paramTime') || 'time'}] [${t('omnibar.paramDuration') || 'duration'}]`, meta: t('omnibar.hintBlock') || 'Create planner block', icon: '📅' },
      { cmd: cmdCall, alt: '/call', type: 'call', syntaxText: `${cmdCall} ${t('omnibar.paramLabel') || '<title>'}`, meta: t('omnibar.hintCall') || 'Create call & note', icon: '📞' },
      { cmd: cmdNote, alt: '/note', type: 'note', syntaxText: `${cmdNote} [${t('omnibar.paramGroup') || 'group'}] ${t('omnibar.paramLabel') || '<title>'}`, meta: t('omnibar.hintNote') || 'New note', icon: '📝' },
      { cmd: cmdDec, alt: '/dec', type: 'dec', syntaxText: `${cmdDec} [${t('omnibar.paramTopic') || 'topic'}] ${t('omnibar.paramLabel') || '<text>'}`, meta: t('omnibar.hintDec') || 'Record decision', icon: '⚖️' },
      { cmd: cmdStash, alt: '/stash', type: 'stash', syntaxText: `${cmdStash} ${t('omnibar.paramThought') || '<thought>'}`, meta: t('omnibar.hintStash') || 'Capture thought', icon: '📥' },
      { cmd: cmdSec, alt: '/secretary', type: 'secretary', syntaxText: `${cmdSec} ${t('omnibar.paramQuery') || '<query>'}`, meta: t('omnibar.hintSecretary') || 'Ask assistant', icon: '🤖' }
    ];

    const allKnown = this.getKnownCommands();
    const matchedCmds = [];
    cmds.forEach(c => {
      const aliases = allKnown[c.type] || [c.cmd, c.alt];
      const matchesAlias = aliases.some(a => a.toLowerCase().includes(lower));
      const score = Math.max(
        ...aliases.map(a => this.calculateRelevanceScore(lower, a)),
        this.calculateRelevanceScore(lower, c.syntaxText, c.meta)
      );
      if (matchesAlias || score > 0 || c.syntaxText.toLowerCase().includes(lower) || c.meta.toLowerCase().includes(lower)) {
        matchedCmds.push({
          type: 'cmd',
          id: 'cmd-' + c.cmd,
          title: c.syntaxText,
          meta: c.meta,
          icon: c.icon,
          cmd: c.cmd,
          cat: t('omnibar.sectionCommands') || 'Commands',
          score: score || 10
        });
      }
    });
    matchedCmds.sort((a, b) => b.score - a.score);

    // 3. Notes (from Manifest)
    const matchedNotes = [];
    if (typeof manifest !== 'undefined' && Array.isArray(manifest)) {
      manifest.forEach(n => {
        if (!n || !n.title) return;
        const score = this.calculateRelevanceScore(lower, n.title, n.date, [...(n.group_tags || []), ...(n.major_topic_tags || [])]);
        if (score > 0 || n.title.toLowerCase().includes(lower) || (n.group_tags && n.group_tags.some(g => g.toLowerCase().includes(lower))) || (n.major_topic_tags && n.major_topic_tags.some(t => t.toLowerCase().includes(lower))) || (n.date && n.date.includes(lower))) {
          const groups = (n.group_tags || []).join(', ') || 'Note';
          matchedNotes.push({
            type: 'note',
            id: n.id || n.path,
            title: n.title,
            meta: `${groups} · ${n.date || ''}`,
            icon: '📝',
            path: n.path,
            cat: t('omnibar.sectionNotes') || 'Notes',
            score: score || 10
          });
        }
      });
      matchedNotes.sort((a, b) => b.score - a.score);
    }

    // 4. Tasks (from TodosManifest)
    const matchedTodos = [];
    if (typeof todosManifest !== 'undefined' && Array.isArray(todosManifest)) {
      todosManifest.forEach(td => {
        if (!td || !td.title) return;
        const score = this.calculateRelevanceScore(lower, td.title, td.context, [td.eisenhowerQuadrant, td.priority]);
        if (score > 0 || td.title.toLowerCase().includes(lower) || (td.context && td.context.toLowerCase().includes(lower))) {
          const p = td.eisenhowerQuadrant || td.priority || 'Task';
          matchedTodos.push({
            type: 'todo',
            id: td.id,
            title: td.title,
            meta: `${p} · ${td.created || ''}`,
            icon: td.status === 'DONE' ? '✔️' : '✅',
            todo: td,
            cat: t('omnibar.sectionTodos') || 'Tasks',
            score: score || 10
          });
        }
      });
      matchedTodos.sort((a, b) => b.score - a.score);
    }

    // 5. Planner Events (from PlannerEvents)
    const matchedEvents = [];
    if (typeof plannerEvents !== 'undefined' && Array.isArray(plannerEvents)) {
      plannerEvents.forEach(ev => {
        if (!ev || !ev.title) return;
        const score = this.calculateRelevanceScore(lower, ev.title, `${ev.startTime || ''} ${ev.endTime || ''} ${ev.date || ''}`);
        if (score > 0 || ev.title.toLowerCase().includes(lower) || (ev.date && ev.date.includes(lower))) {
          matchedEvents.push({
            type: 'event',
            id: ev.id,
            title: ev.title,
            meta: `${ev.date || ''} · ${ev.startTime || ''} - ${ev.endTime || ''}`,
            icon: ev.type === 'call' ? '📞' : '📅',
            event: ev,
            cat: t('omnibar.sectionEvents') || 'Planner & Calls',
            score: score || 10
          });
        }
      });
      matchedEvents.sort((a, b) => b.score - a.score);
    }

    // Combine items
    const items = [
      ...matchedNavs.slice(0, 5),
      ...matchedCmds.slice(0, 5),
      ...matchedNotes.slice(0, 8),
      ...matchedTodos.slice(0, 6),
      ...matchedEvents.slice(0, 5)
    ];

    // 6. Always include Stash Quick Capture Option at the end
    const stashActionText = (t('omnibar.actionCaptureStash') || 'Capture in Stash: "{query}"').replace('{query}', query);
    items.push({
      type: 'stash',
      id: 'action-stash',
      title: stashActionText,
      meta: t('omnibar.hintStash') || 'Save raw thought to .secretary/stash/',
      icon: '📥',
      text: query,
      cat: t('omnibar.sectionCommands') || 'Commands',
      score: 1
    });

    this.results = items;
    this.selectedIndex = 0;
    this.renderResults(query);
  },

  highlightMatch(text, query) {
    if (!text || !query) return escH(text || '');
    const cleanQ = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!cleanQ) return escH(text);
    const regex = new RegExp(`(${cleanQ})`, 'gi');
    return escH(text).replace(regex, '<mark>$1</mark>');
  },

  renderResults(query) {
    const resultsContainer = document.getElementById('omnibar-results');
    const input = document.getElementById('omnibar-input');
    if (!resultsContainer || !input) return;

    if (this.results.length === 0) {
      resultsContainer.style.display = 'block';
      input.setAttribute('aria-expanded', 'true');
      input.removeAttribute('aria-activedescendant');
      resultsContainer.innerHTML = `
        <div class="omnibar-empty-state">
          <div class="omnibar-empty-state-icon">🔍</div>
          <div>${escH(t('omnibar.noResults') || 'No matching notes or actions found')}</div>
        </div>
      `;
      return;
    }

    resultsContainer.style.display = 'block';
    input.setAttribute('aria-expanded', 'true');

    // Group items by category
    const categories = {};
    this.results.forEach((item, index) => {
      const cat = item.cat || 'Results';
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push({ item, index });
    });

    let html = '';
    for (const [catName, catItems] of Object.entries(categories)) {
      html += `<div class="omnibar-section-header">${escH(catName)}</div>`;
      catItems.forEach(({ item, index }) => {
        const isSelected = index === this.selectedIndex;
        const selectedClass = isSelected ? ' selected' : '';
        const titleHtml = this.highlightMatch(item.title, query);
        
        let actionBadge = '<span class="omnibar-result-kbd">↩</span>';
        if (item.type === 'cmd') {
          actionBadge = '<span class="omnibar-result-kbd">⇥</span>';
        }

        html += `
          <div class="omnibar-result-item${selectedClass}" id="omnibar-item-${index}" data-index="${index}" onclick="OmnibarController.selectResultIndex(${index})" role="option" aria-selected="${isSelected}">
            <div class="omnibar-result-icon">${item.icon || '📝'}</div>
            <div class="omnibar-result-content">
              <div class="omnibar-result-title">${titleHtml}</div>
              <div class="omnibar-result-meta">${escH(item.meta || '')}</div>
            </div>
            <div class="omnibar-result-action">${actionBadge}</div>
          </div>
        `;
      });
    }

    resultsContainer.innerHTML = html;
    if (this.results[this.selectedIndex]) {
      input.setAttribute('aria-activedescendant', `omnibar-item-${this.selectedIndex}`);
    } else {
      input.removeAttribute('aria-activedescendant');
    }
    this.ensureSelectedVisible();
  },

  navigateResults(delta) {
    if (this.results.length === 0) return;
    this.selectedIndex = (this.selectedIndex + delta + this.results.length) % this.results.length;
    const input = document.getElementById('omnibar-input');
    if (input) {
      input.setAttribute('aria-activedescendant', `omnibar-item-${this.selectedIndex}`);
    }
    this.renderResults(this.currentQuery);
  },

  selectResultIndex(index) {
    if (index >= 0 && index < this.results.length) {
      this.selectedIndex = index;
      this.executeSelected();
    }
  },

  ensureSelectedVisible() {
    const resultsContainer = document.getElementById('omnibar-results');
    if (!resultsContainer) return;
    const selectedEl = resultsContainer.querySelector('.omnibar-result-item.selected');
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  },

  navigateHistory() {
    if (this.history.length === 0) return;
    this.historyIndex = (this.historyIndex + 1) % this.history.length;
    const pastCmd = this.history[this.historyIndex];
    const input = document.getElementById('omnibar-input');
    if (input && pastCmd) {
      input.value = pastCmd;
      input.setSelectionRange(input.value.length, input.value.length);
      this.updateGhostSuggestion();
      this.scheduleLiveSearch();
    }
  },

  async executeSelected(isMeta = false) {
    const input = document.getElementById('omnibar-input');
    if (!input) return;
    const val = input.value.trim();

    // If dropdown results are open and an item is highlighted
    if (this.results.length > 0 && this.results[this.selectedIndex]) {
      const item = this.results[this.selectedIndex];
      this.recordHistory(val);
      this.close();

      try {
        if (item.type === 'note') {
          if (typeof openNoteOverlay === 'function') {
            await openNoteOverlay(item.path);
          }
        } else if (item.type === 'nav') {
          if (typeof switchTab === 'function') {
            await switchTab(item.tab);
          }
        } else if (item.type === 'cmd') {
          this.open();
          this.setCommandPrefix(item.cmd);
        } else if (item.type === 'todo') {
          if (typeof switchTab === 'function') {
            await switchTab('todos-mode');
          }
        } else if (item.type === 'event') {
          if (item.event && item.event.noteId) {
            const p = getCanonicalNotePath(item.event.noteId);
            if (typeof openNoteOverlay === 'function') await openNoteOverlay(p);
          } else if (typeof switchTab === 'function') {
            await switchTab('planner');
          }
        } else if (item.type === 'stash') {
          await StashService.add(item.text || val);
          toast(t('omnibar.stashSuccess'));
        }
      } catch (err) {
        console.error('Omnibar action failed', err);
        toast(err.message, true);
      }
      return;
    }

    // Direct submit fallback
    await this.submit();
  },

  recordHistory(cmd) {
    if (!cmd || !cmd.trim()) return;
    this.history = [cmd.trim(), ...this.history.filter(c => c !== cmd.trim())].slice(0, 30);
  },

  getKnownCommands() {
    const tCmdTodo = (t('omnibar.cmdTodo') || '/todo').toLowerCase();
    const tCmdBlock = (t('omnibar.cmdBlock') || '/block').toLowerCase();
    const tCmdCall = (t('omnibar.cmdCall') || '/call').toLowerCase();
    const tCmdDec = (t('omnibar.cmdDec') || '/dec').toLowerCase();
    const tCmdNote = (t('omnibar.cmdNote') || '/note').toLowerCase();
    const tCmdStash = (t('omnibar.cmdStash') || '/stash').toLowerCase();
    const tCmdSec = (t('omnibar.cmdSecretary') || '/secretary').toLowerCase();

    return {
      todo: Array.from(new Set(['/todo', '/tache', '/tâche', '/tarea', '/actividad', '/aufgabe', '/úkol', '/ukol', '/taak', '/zadanie', '/tarefa', '/sarcină', '/sarcina', '/задача', '/uppgift', '/görev', '/gorev', '/завдання', '/task', tCmdTodo])),
      block: Array.from(new Set(['/block', '/bloc', '/bloque', '/blocco', '/blok', '/blokk', '/bloco', '/блок', '/event', '/evento', '/evenement', '/wydarzenie', '/esemény', '/händelse', '/etkinlik', '/подія', tCmdBlock])),
      call: Array.from(new Set(['/call', '/appel', '/appell', '/appelle', '/appeler', '/llamada', '/llamar', '/anruf', '/anrufen', '/chiamata', '/chiama', '/chiamare', '/hovor', '/volat', '/hívás', '/hivas', '/oproep', '/bellen', '/rozmowa', '/zadzwoń', '/zadzwon', '/chamada', '/chamar', '/apel', '/apell', '/apelare', '/звонок', '/позвонить', '/вызов', '/samtal', '/ringa', '/arama', '/ara', '/дзвінок', '/дзвонити', '/виклик', '/adhoc', tCmdCall])),
      dec: Array.from(new Set(['/dec', '/déc', '/decision', '/décision', '/decisión', '/decisione', '/entscheidung', '/rozhodnutí', '/rozhodnuti', '/döntés', '/dontes', '/besluit', '/decyzja', '/decisão', '/decisao', '/decizie', '/решение', '/beslut', '/karar', '/рішення', tCmdDec])),
      note: Array.from(new Set(['/note', '/nota', '/notiz', '/poznámka', '/poznamka', '/jegyzet', '/notitie', '/notatka', '/notă', '/заметка', '/anteckning', '/not', '/нотатка', tCmdNote])),
      stash: Array.from(new Set(['/stash', '/pensee', '/pensée', '/gedanke', '/pensamiento', '/myšlenka', '/myslenka', '/gondolat', '/pensiero', '/gedachte', '/myśl', '/mysl', '/gând', '/gand', '/мысль', '/tanke', '/düşünce', '/dusunce', '/думка', '/thought', tCmdStash])),
      secretary: Array.from(new Set(['/secretary', '/secretaire', '/secrétaire', '/sekretär', '/sekretaer', '/secretario', '/secretaria', '/segretario', '/segretaria', '/sekretář', '/sekretar', '/titkár', '/titkar', '/secretaris', '/sekretarz', '/secretário', '/secretario', '/secretar', '/секретарь', '/sekreterare', '/sekreter', '/секретар', '@secretary', tCmdSec]))
    };
  },

  matchCommandType(val) {
    if (!val || typeof val !== 'string') return null;
    const lower = val.toLowerCase().trimStart();
    const firstWord = lower.split(/\s+/)[0];
    const cmds = this.getKnownCommands();

    for (const [type, aliases] of Object.entries(cmds)) {
      if (aliases.includes(firstWord) || aliases.some(a => lower.startsWith(a + ' ') || lower === a)) {
        const matchedAlias = aliases.find(a => lower.startsWith(a)) || firstWord;
        return { type, matchedAlias, cmdLen: matchedAlias.length };
      }
    }
    return null;
  },

  /**
   * Calculates ghost text suggestions and Tab completion options
   */
  getGhostSuggestionInfo(val) {
    if (!val || typeof val !== 'string') {
      return { ghostSuffix: '', tabComplete: '', options: [], tokenType: '' };
    }

    const trimmed = val.trim();
    const hasTrailingSpace = val.endsWith(' ');
    const lower = val.toLowerCase();

    const pLabel = t('omnibar.paramLabel') || '<label>';
    const pDate = t('omnibar.paramDate') || '<date>';
    const pTime = t('omnibar.paramTime') || '<time>';
    const pDuration = t('omnibar.paramDuration') || '<duration>';
    const pTopic = t('omnibar.paramTopic') || '<topic>';
    const pGroup = t('omnibar.paramGroup') || '<group>';
    const pThought = t('omnibar.paramThought') || '<thought>';
    const pQuery = t('omnibar.paramQuery') || '<query>';

    const cmdTodo = t('omnibar.cmdTodo') || '/todo';
    const cmdBlock = t('omnibar.cmdBlock') || '/block';
    const cmdCall = t('omnibar.cmdCall') || '/call';
    const cmdDec = t('omnibar.cmdDec') || '/dec';
    const cmdNote = t('omnibar.cmdNote') || '/note';
    const cmdStash = t('omnibar.cmdStash') || '/stash';
    const cmdSec = t('omnibar.cmdSecretary') || '/secretary';

    const commands = [
      { name: cmdTodo, alt: '/todo', type: 'todo', hint: `[now|plan|del|later] ${pLabel}`, options: ['now', 'plan', 'delegate', 'later'] },
      { name: cmdBlock, alt: '/block', type: 'block', hint: `${pLabel} [today|tomorrow] [14:00] [30m|1h]`, options: ['today', 'tomorrow', '09:00', '10:00', '14:00', '15:00', '30m', '45m', '1h', '2h'] },
      { name: cmdCall, alt: '/call', type: 'call', hint: `${pLabel}`, options: [] },
      { name: cmdDec, alt: '/dec', type: 'dec', hint: `[Topic] ${pLabel}`, options: this.getExistingTopics() },
      { name: cmdNote, alt: '/note', type: 'note', hint: `[Group] ${pLabel}`, options: this.getExistingGroups() },
      { name: cmdStash, alt: '/stash', type: 'stash', hint: `${pThought}`, options: [] },
      { name: cmdSec, alt: '/secretary', type: 'secretary', hint: `${pQuery}`, options: [] }
    ];

    // 1. User typed only "/"
    if (val === '/') {
      return {
        ghostSuffix: commands.map((c, i) => i === 0 ? c.name.slice(1) : c.name).join(' | '),
        tabComplete: cmdTodo + ' ',
        options: commands.map(c => c.name + ' '),
        tokenType: 'cmd'
      };
    }

    // 2. User is typing the command name without space (e.g. "/bl", "/to", "/n", "/tâ")
    if (val.startsWith('/') && !val.includes(' ')) {
      const allKnown = this.getKnownCommands();
      const matchEntry = commands.find(c => {
        const aliases = allKnown[c.type] || [c.name, c.alt];
        return aliases.some(a => a.startsWith(lower));
      });

      if (matchEntry) {
        const allAliases = allKnown[matchEntry.type] || [matchEntry.name, matchEntry.alt];
        const matchedAlias = allAliases.find(a => a.startsWith(lower)) || matchEntry.name;
        const remainingCmd = matchedAlias.slice(val.length);
        return {
          ghostSuffix: remainingCmd + ' ' + matchEntry.hint,
          tabComplete: matchedAlias + ' ',
          options: commands.map(c => c.name + ' '),
          tokenType: 'cmd'
        };
      }
    }

    // 3. Command specific parsing
    const match = this.matchCommandType(val);
    if (match) {
      const content = val.substring(match.cmdLen).replace(/^\s+/, '');
      const priorities = ['now', 'plan', 'delegate', 'del', 'later', 'q1', 'q2', 'q3', 'q4', 'high', 'medium', 'med', 'low', 'maintenant', 'sofort', 'ahora', 'subito', 'hned', 'teraz', 'most', 'acum', 'сейчас', 'şimdi', 'simdi', 'зараз', 'planifier', 'planen', 'planear', 'pianifica', 'plannen', 'zaplanuj', 'planejar', 'naplanovat', 'tervez', 'programeaza', 'запланировать', 'planera', 'planla', 'запланувати', 'deleguer', 'déléguer', 'delegieren', 'delegare', 'delega', 'delegeren', 'oddeleguj', 'delegovat', 'delegál', 'delegera', 'devret', 'делегировать', 'деврет', 'делегувати', 'tard', 'plustard', 'später', 'spaeter', 'luego', 'despues', 'dopo', 'tardi', 'depois', 'pozdeji', 'później', 'pozniej', 'később', 'kesobb', 'maitârziu', 'tarziu', 'позже', 'senare', 'sonra', 'пізніше'];

      if (match.type === 'todo') {
        if (!content || (!hasTrailingSpace && content.length === 0)) {
          return {
            ghostSuffix: hasTrailingSpace ? `[now|plan|del|later] ${pLabel}` : ` [now|plan|del|later] ${pLabel}`,
            tabComplete: val.endsWith(' ') ? val + 'now ' : val + ' now ',
            options: ['now', 'plan', 'delegate', 'later'],
            tokenType: 'todoPriority'
          };
        }
        const firstToken = content.split(' ')[0].toLowerCase();
        if (priorities.includes(firstToken)) {
          if (!content.includes(' ') || content.endsWith(' ')) {
            return {
              ghostSuffix: ` ${pLabel}`,
              tabComplete: '',
              options: [],
              tokenType: ''
            };
          }
        }
      } else if (match.type === 'block') {
        if (!content) {
          return {
            ghostSuffix: hasTrailingSpace ? `${pLabel} [today|tomorrow] [14:00] [30m|1h]` : ` ${pLabel} [today|tomorrow] [14:00] [30m|1h]`,
            tabComplete: val.endsWith(' ') ? val + 'today ' : val + ' today ',
            options: ['today', 'tomorrow', '14:00', '30m', '1h'],
            tokenType: 'block'
          };
        }

        const hasDate = /(today|tomorrow|demain|hier|heute|morgen|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2})/i.test(content);
        const hasTime = /\b([01]?\d|2[0-3])[:h]([0-5]\d)?\b/i.test(content);
        const hasDuration = /\b(\d+)\s*(m|min|h|hr)\b/i.test(content);

        if (!hasDate) {
          return {
            ghostSuffix: ' [today|tomorrow|YYYY-MM-DD] [14:00] [30m|1h]',
            tabComplete: val + (hasTrailingSpace ? 'today ' : ' today '),
            options: ['today', 'tomorrow', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
            tokenType: 'blockDate'
          };
        } else if (!hasTime) {
          const nextHour = this.getNextRoundHour();
          return {
            ghostSuffix: ` [${nextHour}] [30m|1h]`,
            tabComplete: val + (hasTrailingSpace ? `${nextHour} ` : ` ${nextHour} `),
            options: ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00', '17:00'],
            tokenType: 'blockTime'
          };
        } else if (!hasDuration) {
          return {
            ghostSuffix: ' [30m|45m|1h|2h]',
            tabComplete: val + (hasTrailingSpace ? '30m ' : ' 30m '),
            options: ['30m', '45m', '1h', '1h30', '2h'],
            tokenType: 'blockDuration'
          };
        }
      } else if (match.type === 'note') {
        const groups = this.getExistingGroups();
        if (!content || !content.trim()) {
          const firstGroup = groups[0] || 'Inbox';
          return {
            ghostSuffix: hasTrailingSpace ? `[${firstGroup}] ${pLabel}` : ` [${firstGroup}] ${pLabel}`,
            tabComplete: val.endsWith(' ') ? val + `[${firstGroup}] ` : val + ` [${firstGroup}] `,
            options: groups.map(g => `[${g}]`),
            tokenType: 'noteGroup'
          };
        }
      } else if (match.type === 'dec') {
        const topics = this.getExistingTopics();
        if (!content || !content.trim()) {
          const firstTopic = topics[0] || 'General';
          return {
            ghostSuffix: hasTrailingSpace ? `[${firstTopic}] ${pLabel}` : ` [${firstTopic}] ${pLabel}`,
            tabComplete: val.endsWith(' ') ? val + `[${firstTopic}] ` : val + ` [${firstTopic}] `,
            options: topics.map(t => `[${t}]`),
            tokenType: 'decTopic'
          };
        }
      } else if (match.type === 'call') {
        if (!content) {
          return {
            ghostSuffix: hasTrailingSpace ? `${pLabel}` : ` ${pLabel}`,
            tabComplete: '',
            options: [],
            tokenType: ''
          };
        }
      }
    }

    return { ghostSuffix: '', tabComplete: '', options: [], tokenType: '' };
  },

  getExistingGroups() {
    const groups = (typeof manifest !== 'undefined' && Array.isArray(manifest))
      ? Array.from(new Set(manifest.flatMap(n => n.group_tags || []).filter(Boolean)))
      : [];
    return groups.length ? groups : ['Inbox', 'Daily', 'Work', 'Projects'];
  },

  getExistingTopics() {
    const topics = (typeof manifest !== 'undefined' && Array.isArray(manifest))
      ? Array.from(new Set(manifest.flatMap(n => n.major_topic_tags || []).filter(Boolean)))
      : [];
    return topics.length ? topics : ['Architecture', 'Product', 'Process', 'Tech'];
  },

  getKnownWorkstreams() {
    const list = new Set();
    if (typeof manifest !== 'undefined' && Array.isArray(manifest)) {
      manifest.forEach(n => {
        if (n && n.workstream) list.add(n.workstream);
        if (n && Array.isArray(n.major_topic_tags)) n.major_topic_tags.forEach(t => t && list.add(t));
      });
    }
    if (typeof settings !== 'undefined' && settings && Array.isArray(settings.workstreams)) {
      settings.workstreams.forEach(w => w && list.add(w));
    }
    const arr = Array.from(list).filter(Boolean);
    return arr.length ? arr : ['General', 'Architecture', 'Product', 'Tech'];
  },

  getMostUsedTagsForWorkstream(workstreamName) {
    if (!workstreamName) return [];
    const counts = {};
    if (typeof manifest !== 'undefined' && Array.isArray(manifest)) {
      manifest.forEach(n => {
        if (!n) return;
        const matchWs = n.workstream === workstreamName || (Array.isArray(n.major_topic_tags) && n.major_topic_tags.includes(workstreamName));
        if (matchWs) {
          const tags = [...(n.topic_tags || []), ...(n.extra_tags || [])];
          tags.forEach(t => {
            if (t) counts[t] = (counts[t] || 0) + 1;
          });
        }
      });
    }
    const sorted = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    return sorted.slice(0, 2);
  },

  // ── Segmented Sectional Omnibar Architecture ──
  segmentedState: {
    active: false,
    action: 'todo',
    activeSectionIndex: 1,
    comboOpen: false,
    comboSectionIndex: -1,
    calOpen: false,
    calMonth: new Date().getMonth(),
    calYear: new Date().getFullYear(),
    comboSelectedIndex: 0,
    data: {
      action: 'todo',
      priority: 'plan',
      workstream: 'General',
      status: 'active',
      type: 'work',
      date: 'today',
      time: '14:00',
      duration: '30m',
      title: '',
      colleague: ''
    }
  },

  initSegmentedMode(action = 'todo', initialText = '') {
    const segmentedBar = document.getElementById('omnibar-segmented-bar');
    const input = document.getElementById('omnibar-input');
    const ghost = document.getElementById('omnibar-ghost-layer');
    const container = document.getElementById('omnibar-container');
    if (!segmentedBar) return;

    this.segmentedState.active = true;
    this.segmentedState.action = action;
    this.segmentedState.data.action = action;
    if (initialText) this.segmentedState.data.title = initialText;
    if (!this.segmentedState.data.workstream) {
      const known = this.getKnownWorkstreams();
      this.segmentedState.data.workstream = known[0] || 'General';
    }
    if (!this.segmentedState.data.time) {
      this.segmentedState.data.time = this.getNextRoundHour();
    }
    if (!this.segmentedState.data.duration) {
      this.segmentedState.data.duration = (typeof settings !== 'undefined' && settings?.plannerDefaultDuration) ? `${settings.plannerDefaultDuration}m` : '30m';
    }

    if (input) input.style.display = 'none';
    if (ghost) ghost.style.display = 'none';
    segmentedBar.style.display = 'flex';
    if (container) container.classList.add('wide');

    this.applyTheme();
    this.renderSegmentedBar();
    this.renderLivePreview();

    setTimeout(() => {
      this.focusSection(1);
    }, 40);
  },

  exitSegmentedMode() {
    const segmentedBar = document.getElementById('omnibar-segmented-bar');
    const input = document.getElementById('omnibar-input');
    const ghost = document.getElementById('omnibar-ghost-layer');
    const container = document.getElementById('omnibar-container');
    const results = document.getElementById('omnibar-results');

    this.segmentedState.active = false;
    this.segmentedState.comboOpen = false;
    this.segmentedState.calOpen = false;

    if (segmentedBar) segmentedBar.style.display = 'none';
    if (input) {
      input.style.display = '';
      input.value = '';
      input.focus();
    }
    if (ghost) ghost.style.display = '';
    if (container) {
      container.classList.remove('theme-decision', 'theme-todo', 'theme-block', 'theme-note', 'theme-call', 'wide');
      container.removeAttribute('data-urgency');
    }
    if (results) results.style.display = 'none';

    this.updateGhostSuggestion();
    this.renderDefaultHints();
  },

  translateSectionState(newAction) {
    const oldAction = this.segmentedState.action;
    if (oldAction === newAction) return;

    const data = this.segmentedState.data;
    data.action = newAction;
    this.segmentedState.action = newAction;

    // Preserved across all transitions: data.title and data.workstream
    if (newAction === 'todo') {
      if (!data.priority) data.priority = 'plan';
    } else if (newAction === 'dec') {
      if (!data.status) data.status = 'active';
    } else if (newAction === 'block') {
      if (!data.type) data.type = 'work';
      if (!data.date) data.date = 'today';
      if (!data.time) data.time = this.getNextRoundHour();
      if (!data.duration) data.duration = (typeof settings !== 'undefined' && settings?.plannerDefaultDuration) ? `${settings.plannerDefaultDuration}m` : '30m';
    } else if (newAction === 'call') {
      if (!data.date) data.date = 'today';
      if (!data.time) data.time = this.getNextRoundHour();
    }

    this.segmentedState.comboOpen = false;
    this.segmentedState.calOpen = false;
    this.segmentedState.activeSectionIndex = 1;
    this.applyTheme();
    this.renderSegmentedBar();
    this.renderLivePreview();
  },

  applyTheme() {
    const container = document.getElementById('omnibar-container');
    if (!container) return;

    container.classList.remove('theme-decision', 'theme-todo', 'theme-block', 'theme-note', 'theme-call');
    container.removeAttribute('data-urgency');

    if (!this.segmentedState.active) return;

    const action = this.segmentedState.action;
    if (action === 'dec') {
      container.classList.add('theme-decision');
    } else if (action === 'todo') {
      container.classList.add('theme-todo');
      container.setAttribute('data-urgency', this.segmentedState.data.priority || 'plan');
    } else if (action === 'block') {
      container.classList.add('theme-block');
    } else if (action === 'note') {
      container.classList.add('theme-note');
    } else if (action === 'call') {
      container.classList.add('theme-call');
    }
  },

  getSectionDefinitions() {
    const action = this.segmentedState.action;
    const data = this.segmentedState.data;

    // Section 0 is always Action
    const actionSec = {
      type: 'action',
      label: t('omnibar.sectionAction') || 'Action',
      value: '/' + action,
      icon: { todo: '✅', dec: '⚖️', block: '📅', note: '📝', call: '📞' }[action] || '⚡',
      isSelective: true,
      options: [
        { id: 'todo', label: t('omnibar.cmdTodo') || '/todo', meta: t('omnibar.previewTodo') || 'Task', icon: '✅' },
        { id: 'dec', label: t('omnibar.cmdDec') || '/dec', meta: t('omnibar.previewDec') || 'Decision', icon: '⚖️' },
        { id: 'block', label: t('omnibar.cmdBlock') || '/block', meta: t('omnibar.previewBlock') || 'Block', icon: '📅' },
        { id: 'note', label: t('omnibar.cmdNote') || '/note', meta: t('omnibar.previewNote') || 'Note', icon: '📝' },
        { id: 'call', label: t('omnibar.cmdCall') || '/call', meta: t('omnibar.previewCall') || 'Call', icon: '📞' }
      ]
    };

    if (action === 'todo') {
      return [
        actionSec,
        {
          type: 'priority',
          label: t('omnibar.sectionPriority') || 'Priority',
          value: data.priority,
          displayValue: { now: 'NOW', plan: 'PLAN', delegate: 'DEL', later: 'LATER' }[data.priority] || data.priority,
          badgeClass: `badge-urgency badge-${data.priority}`,
          isSelective: true,
          options: [
            { id: 'now', label: 'now', meta: t('omnibar.tokenNow') || 'Do Now (Urgent & Important)', icon: '🔴' },
            { id: 'plan', label: 'plan', meta: t('omnibar.tokenPlan') || 'Schedule (Important)', icon: '🟡' },
            { id: 'delegate', label: 'delegate', meta: t('omnibar.tokenDelegate') || 'Delegate (Urgent)', icon: '🟣' },
            { id: 'later', label: 'later', meta: t('omnibar.tokenLater') || 'Later (Low priority)', icon: '🟢' }
          ]
        },
        {
          type: 'workstream',
          label: t('omnibar.sectionWorkstream') || 'Workstream',
          value: data.workstream,
          isSelective: true,
          options: this.getKnownWorkstreams().map(ws => ({ id: ws, label: ws, icon: '📁' }))
        },
        {
          type: 'text',
          label: t('omnibar.sectionTitle') || 'Title',
          value: data.title,
          placeholder: t('omnibar.placeholderTask') || 'What needs to be done?',
          isSelective: false
        }
      ];
    } else if (action === 'dec') {
      return [
        actionSec,
        {
          type: 'workstream',
          label: t('omnibar.sectionWorkstream') || 'Workstream',
          value: data.workstream,
          isSelective: true,
          options: this.getKnownWorkstreams().map(ws => ({ id: ws, label: ws, icon: '📁' }))
        },
        {
          type: 'status',
          label: t('omnibar.sectionStatus') || 'Status',
          value: data.status,
          displayValue: { active: t('omnibar.statusActive') || 'Active', draft: t('omnibar.statusDraft') || 'Draft', blocked: t('omnibar.statusBlocked') || 'Blocked' }[data.status] || data.status,
          isSelective: true,
          options: [
            { id: 'active', label: t('omnibar.statusActive') || 'Active', icon: '🟢' },
            { id: 'draft', label: t('omnibar.statusDraft') || 'Draft', icon: '🟡' },
            { id: 'blocked', label: t('omnibar.statusBlocked') || 'Blocked', icon: '🔴' }
          ]
        },
        {
          type: 'text',
          label: t('omnibar.sectionTitle') || 'Summary',
          value: data.title,
          placeholder: t('omnibar.placeholderDecision') || 'Decision summary...',
          isSelective: false
        }
      ];
    } else if (action === 'block') {
      return [
        actionSec,
        {
          type: 'type',
          label: t('omnibar.sectionType') || 'Type',
          value: data.type,
          displayValue: { work: t('omnibar.typeWork') || 'Deep Work', sync: t('omnibar.typeSync') || 'Team Sync', call: t('omnibar.typeCall') || 'Call', prep: t('omnibar.typePrep') || 'Preparation', personal: t('omnibar.typePersonal') || 'Personal' }[data.type] || data.type,
          isSelective: true,
          options: [
            { id: 'work', label: t('omnibar.typeWork') || 'Deep Work', icon: '🔷' },
            { id: 'sync', label: t('omnibar.typeSync') || 'Team Sync', icon: '🟣' },
            { id: 'call', label: t('omnibar.typeCall') || 'Call', icon: '🟢' },
            { id: 'prep', label: t('omnibar.typePrep') || 'Preparation', icon: '🟠' },
            { id: 'personal', label: t('omnibar.typePersonal') || 'Personal', icon: '🟡' }
          ]
        },
        {
          type: 'workstream',
          label: t('omnibar.sectionWorkstream') || 'Workstream',
          value: data.workstream,
          isSelective: true,
          options: this.getKnownWorkstreams().map(ws => ({ id: ws, label: ws, icon: '📁' }))
        },
        {
          type: 'text',
          label: t('omnibar.sectionTitle') || 'Title',
          value: data.title,
          placeholder: t('omnibar.placeholderBlock') || 'Event title...',
          isSelective: false
        },
        {
          type: 'date',
          label: t('omnibar.sectionDate') || 'Date',
          value: data.date,
          displayValue: data.date === 'today' ? (t('omnibar.calToday') || 'Today') : data.date === 'tomorrow' ? (t('omnibar.calTomorrow') || 'Tomorrow') : data.date,
          isSelective: true,
          options: [
            { id: 'today', label: t('omnibar.calToday') || 'Today', icon: '📅' },
            { id: 'tomorrow', label: t('omnibar.calTomorrow') || 'Tomorrow', icon: '📅' },
            { id: 'calendar', label: t('omnibar.calPickDate') || 'Pick date...', icon: '🗓️' }
          ]
        },
        {
          type: 'time',
          label: t('omnibar.sectionTime') || 'Time & Dur',
          value: `${data.time} (${data.duration})`,
          isSelective: true,
          options: [
            { id: '15m', label: t('omnibar.dur15m') || '15 min', icon: '⏱️' },
            { id: '30m', label: t('omnibar.token30m') || '30 min', icon: '⏱️' },
            { id: '45m', label: t('omnibar.dur45m') || '45 min', icon: '⏱️' },
            { id: '1h', label: t('omnibar.token1h') || '1 hour', icon: '⏱️' },
            { id: '2h', label: t('omnibar.token2h') || '2 hours', icon: '⏱️' }
          ]
        }
      ];
    } else if (action === 'note') {
      return [
        actionSec,
        {
          type: 'workstream',
          label: t('omnibar.sectionWorkstream') || 'Workstream',
          value: data.workstream,
          isSelective: true,
          options: this.getKnownWorkstreams().map(ws => ({ id: ws, label: ws, icon: '📁' }))
        },
        {
          type: 'text',
          label: t('omnibar.sectionTitle') || 'Title',
          value: data.title,
          placeholder: t('omnibar.placeholderNote') || 'Note title...',
          isSelective: false
        }
      ];
    } else if (action === 'call') {
      return [
        actionSec,
        {
          type: 'colleague',
          label: t('omnibar.sectionContact') || 'Contact',
          value: data.colleague || 'Team',
          isSelective: true,
          options: ['Team', 'Alice', 'Bob', 'Client'].map(c => ({ id: c, label: c, icon: '👤' }))
        },
        {
          type: 'text',
          label: t('omnibar.sectionTitle') || 'Subject',
          value: data.title,
          placeholder: t('omnibar.placeholderCall') || 'Subject or participant...',
          isSelective: false
        }
      ];
    }

    return [actionSec];
  },

  renderSegmentedBar() {
    const segmentedBar = document.getElementById('omnibar-segmented-bar');
    if (!segmentedBar) return;

    const defs = this.getSectionDefinitions();
    const activeIdx = this.segmentedState.activeSectionIndex;

    let html = '';
    defs.forEach((sec, idx) => {
      const isActive = idx === activeIdx;
      const isComboOpen = this.segmentedState.comboOpen && this.segmentedState.comboSectionIndex === idx;
      const isCalOpen = this.segmentedState.calOpen && this.segmentedState.comboSectionIndex === idx;

      if (!sec.isSelective) {
        // Free-text section
        html += `
          <div class="omnibar-section omnibar-section-freetext${isActive ? ' active' : ''}" data-section-index="${idx}" onclick="OmnibarController.onSectionClick(${idx})" role="textbox">
            <input type="text" class="omnibar-section-input" id="omnibar-section-input-text" value="${escH(sec.value || '')}" placeholder="${escH(sec.placeholder || '')}" autocomplete="off" spellcheck="false" oninput="OmnibarController.onFreeTextInput(this.value)" onkeydown="OmnibarController.onSectionKeyDown(event, ${idx})">
          </div>
        `;
      } else {
        // Selective combo section
        let valDisplay = escH(sec.displayValue || sec.value || '');
        if (sec.badgeClass) {
          valDisplay = `<span class="${sec.badgeClass}">${valDisplay}</span>`;
        }
        if (sec.icon) {
          valDisplay = `<span style="margin-right:2px;">${sec.icon}</span> ${valDisplay}`;
        }

        // Dropdown HTML if active
        let dropdownHtml = '';
        if (isComboOpen) {
          const items = sec.options || [];
          dropdownHtml = `
            <div class="omnibar-section-combo" id="omnibar-combo-${idx}">
              ${items.map((opt, oIdx) => `
                <div class="omnibar-combo-item${oIdx === this.segmentedState.comboSelectedIndex ? ' selected' : ''}" onclick="event.stopPropagation(); OmnibarController.selectComboOption(${idx}, '${escH(opt.id)}')">
                  <span>${opt.icon || '•'}</span>
                  <span>${escH(opt.label)}</span>
                  ${opt.meta ? `<span class="omnibar-combo-item-meta">${escH(opt.meta)}</span>` : ''}
                </div>
              `).join('')}
              ${idx === 0 ? `
                <div class="omnibar-combo-item" style="border-top: 1px solid var(--card-border); margin-top: 4px;" onclick="event.stopPropagation(); OmnibarController.exitSegmentedMode()">
                  <span>🔍</span>
                  <span>${escH(t('omnibar.backToSearch') || 'Back to search')}</span>
                </div>
              ` : ''}
            </div>
          `;
        } else if (isCalOpen) {
          dropdownHtml = this.renderCalendarPopoverHtml(idx);
        }

        html += `
          <div class="omnibar-section${isActive ? ' active' : ''}" data-section-index="${idx}" data-section-type="${sec.type}" onclick="OmnibarController.onSectionClick(${idx})" tabindex="0" onkeydown="OmnibarController.onSectionKeyDown(event, ${idx})">
            ${sec.type !== 'action' ? `<span class="omnibar-section-label">${escH(sec.label)}:</span>` : ''}
            <span class="omnibar-section-value">${valDisplay}</span>
            <span class="omnibar-section-arrow">▾</span>
            ${dropdownHtml}
          </div>
        `;
      }
    });

    segmentedBar.innerHTML = html;
  },

  renderCalendarPopoverHtml(secIndex) {
    const year = this.segmentedState.calYear;
    const month = this.segmentedState.calMonth;
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDay = new Date(year, month, 1).getDay(); // 0 is Sunday
    const startOffset = (firstDay + 6) % 7; // Convert to Mon=0

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    let cellsHtml = '';
    for (let i = 0; i < startOffset; i++) {
      cellsHtml += `<div class="omnibar-cal-day" style="opacity:0.2;"></div>`;
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const dStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const isToday = dStr === todayStr;
      const isSelected = this.segmentedState.data.date === dStr;
      cellsHtml += `
        <div class="omnibar-cal-day${isToday ? ' today' : ''}${isSelected ? ' selected' : ''}" onclick="event.stopPropagation(); OmnibarController.selectCalDate('${dStr}')">
          ${d}
        </div>
      `;
    }

    return `
      <div class="omnibar-calendar-popover" id="omnibar-cal-${secIndex}">
        <div class="omnibar-cal-header">
          <button class="omnibar-cal-btn" onclick="event.stopPropagation(); OmnibarController.changeCalMonth(-1)">‹</button>
          <span>${monthNames[month]} ${year}</span>
          <button class="omnibar-cal-btn" onclick="event.stopPropagation(); OmnibarController.changeCalMonth(1)">›</button>
        </div>
        <div class="omnibar-cal-grid">
          <div class="omnibar-cal-day-label">Mo</div>
          <div class="omnibar-cal-day-label">Tu</div>
          <div class="omnibar-cal-day-label">We</div>
          <div class="omnibar-cal-day-label">Th</div>
          <div class="omnibar-cal-day-label">Fr</div>
          <div class="omnibar-cal-day-label">Sa</div>
          <div class="omnibar-cal-day-label">Su</div>
          ${cellsHtml}
        </div>
      </div>
    `;
  },

  changeCalMonth(delta) {
    let m = this.segmentedState.calMonth + delta;
    let y = this.segmentedState.calYear;
    if (m < 0) { m = 11; y--; }
    else if (m > 11) { m = 0; y++; }
    this.segmentedState.calMonth = m;
    this.segmentedState.calYear = y;
    this.renderSegmentedBar();
  },

  selectCalDate(dateStr) {
    this.segmentedState.data.date = dateStr;
    this.segmentedState.calOpen = false;
    this.segmentedState.comboOpen = false;
    this.renderSegmentedBar();
    this.renderLivePreview();
    this.focusSection(this.segmentedState.activeSectionIndex + 1);
  },

  onSectionClick(index) {
    const defs = this.getSectionDefinitions();
    const sec = defs[index];
    if (!sec) return;

    this.segmentedState.activeSectionIndex = index;
    if (sec.isSelective) {
      if (sec.type === 'date' && this.segmentedState.calOpen) {
        this.segmentedState.calOpen = false;
      } else if (this.segmentedState.comboOpen && this.segmentedState.comboSectionIndex === index) {
        this.closeCombo();
      } else {
        this.openCombo(index);
      }
    } else {
      this.closeCombo();
      this.renderSegmentedBar();
      const inputEl = document.getElementById('omnibar-section-input-text');
      if (inputEl) inputEl.focus();
    }
  },

  openCombo(index) {
    const defs = this.getSectionDefinitions();
    const sec = defs[index];
    if (!sec || !sec.isSelective) return;

    this.segmentedState.comboOpen = true;
    this.segmentedState.calOpen = false;
    this.segmentedState.comboSectionIndex = index;
    this.segmentedState.comboSelectedIndex = 0;
    this.renderSegmentedBar();
  },

  closeCombo() {
    this.segmentedState.comboOpen = false;
    this.segmentedState.calOpen = false;
    this.segmentedState.comboSectionIndex = -1;
    this.renderSegmentedBar();
  },

  navigateCombo(delta) {
    const defs = this.getSectionDefinitions();
    const sec = defs[this.segmentedState.comboSectionIndex];
    if (!sec || !sec.options) return;

    const len = sec.options.length;
    this.segmentedState.comboSelectedIndex = (this.segmentedState.comboSelectedIndex + delta + len) % len;
    this.renderSegmentedBar();
  },

  confirmComboSelection() {
    const defs = this.getSectionDefinitions();
    const sec = defs[this.segmentedState.comboSectionIndex];
    if (!sec || !sec.options) return;

    const opt = sec.options[this.segmentedState.comboSelectedIndex];
    if (opt) {
      this.selectComboOption(this.segmentedState.comboSectionIndex, opt.id);
    }
  },

  selectComboOption(sectionIndex, value) {
    const defs = this.getSectionDefinitions();
    const sec = defs[sectionIndex];
    if (!sec) return;

    if (sec.type === 'action') {
      this.translateSectionState(value);
      return;
    }

    if (sec.type === 'priority') {
      this.segmentedState.data.priority = value;
      this.applyTheme();
    } else if (sec.type === 'workstream') {
      this.segmentedState.data.workstream = value;
    } else if (sec.type === 'status') {
      this.segmentedState.data.status = value;
    } else if (sec.type === 'type') {
      this.segmentedState.data.type = value;
    } else if (sec.type === 'date') {
      if (value === 'calendar') {
        this.segmentedState.calOpen = true;
        this.segmentedState.comboOpen = false;
        this.renderSegmentedBar();
        return;
      } else {
        this.segmentedState.data.date = value;
      }
    } else if (sec.type === 'time') {
      this.segmentedState.data.duration = value;
    } else if (sec.type === 'colleague') {
      this.segmentedState.data.colleague = value;
    }

    this.segmentedState.comboOpen = false;
    this.segmentedState.calOpen = false;
    this.renderSegmentedBar();
    this.renderLivePreview();

    // Advance to next section automatically
    const nextIdx = (sectionIndex + 1) % defs.length;
    this.focusSection(nextIdx);
  },

  onFreeTextInput(value) {
    this.segmentedState.data.title = value;
    this.renderLivePreview();
  },

  onSectionKeyDown(e, sectionIndex) {
    const defs = this.getSectionDefinitions();

    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        const nextIdx = (sectionIndex - 1 + defs.length) % defs.length;
        this.focusSection(nextIdx);
      } else {
        const nextIdx = (sectionIndex + 1) % defs.length;
        this.focusSection(nextIdx);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (this.segmentedState.comboOpen) {
        this.confirmComboSelection();
      } else {
        this.submitSegmented();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (this.segmentedState.comboOpen || this.segmentedState.calOpen) {
        this.closeCombo();
      } else {
        this.exitSegmentedMode();
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!this.segmentedState.comboOpen) {
        this.openCombo(sectionIndex);
      } else {
        this.navigateCombo(1);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (this.segmentedState.comboOpen) {
        this.navigateCombo(-1);
      }
    }
  },

  focusSection(index) {
    const defs = this.getSectionDefinitions();
    if (index < 0 || index >= defs.length) return;

    this.segmentedState.activeSectionIndex = index;
    const sec = defs[index];

    if (!sec.isSelective) {
      this.closeCombo();
      this.renderSegmentedBar();
      const inputEl = document.getElementById('omnibar-section-input-text');
      if (inputEl) {
        inputEl.focus();
        inputEl.selectionStart = inputEl.selectionEnd = inputEl.value.length;
      }
    } else {
      this.openCombo(index);
    }
  },

  renderLivePreview() {
    const resultsContainer = document.getElementById('omnibar-results');
    const input = document.getElementById('omnibar-input');
    if (!resultsContainer) return;

    if (!this.segmentedState.active) return;

    const action = this.segmentedState.action;
    const data = this.segmentedState.data;
    const title = (data.title || '').trim();

    resultsContainer.style.display = 'block';
    if (input) input.setAttribute('aria-expanded', 'true');

    let previewHtml = '';

    if (action === 'todo') {
      const fallbackPlan = { label: t('omnibar.tokenPlan'), badge: 'badge-plan', text: 'PLAN' };
      const qMeta = {
        now: { label: t('omnibar.tokenNow') || 'Do Now (Urgent & Important)', badge: 'badge-now', text: 'NOW' },
        plan: { label: t('omnibar.tokenPlan') || 'Schedule (Important)', badge: 'badge-plan', text: 'PLAN' },
        delegate: { label: t('omnibar.tokenDelegate') || 'Delegate (Urgent)', badge: 'badge-delegate', text: 'DELEGATE' },
        later: { label: t('omnibar.tokenLater') || 'Later (Low priority)', badge: 'badge-later', text: 'LATER' }
      }[data.priority] || fallbackPlan;

      const displayTitle = title || t('omnibar.placeholderTask') || 'What needs to be done?';
      const ws = data.workstream || 'General';

      previewHtml = `
        <div class="omnibar-preview-card">
          <div class="omnibar-preview-header">
            <span class="omnibar-preview-type">✅ ${escH(t('omnibar.previewTodo') || 'New Task')}</span>
            <span class="badge-urgency ${qMeta.badge}">${qMeta.text}</span>
          </div>
          <div class="omnibar-preview-title">${escH(displayTitle)}</div>
          <div class="omnibar-preview-meta">
            <span class="omnibar-preview-tag">📁 ${escH(ws)}</span>
            <span class="omnibar-preview-tag">👤 ${escH(data.assignee || 'Me')}</span>
            <span>${escH(qMeta.label)}</span>
            <span class="omnibar-preview-kbd"><kbd>↵</kbd> ${escH(t('omnibar.enterToCreate') || 'Press Enter to create')}</span>
          </div>
        </div>
      `;
    } else if (action === 'dec') {
      const fallbackActive = { icon: '🟢', label: t('omnibar.statusActive') };
      const statusMeta = {
        active: { icon: '🟢', label: t('omnibar.statusActive') || 'Active' },
        draft: { icon: '🟡', label: t('omnibar.statusDraft') || 'Draft' },
        blocked: { icon: '🔴', label: t('omnibar.statusBlocked') || 'Blocked' }
      }[data.status] || fallbackActive;

      const displayTitle = title || t('omnibar.placeholderDecision') || 'Decision summary...';
      const ws = data.workstream || 'General';
      const inheritedTags = this.getMostUsedTagsForWorkstream(ws);
      const tagsStr = inheritedTags.length > 0 ? inheritedTags.map(tg => `<span class="omnibar-preview-tag">#${escH(tg)}</span>`).join(' ') : '';

      previewHtml = `
        <div class="omnibar-preview-card">
          <div class="omnibar-preview-header">
            <span class="omnibar-preview-type">⚖️ ${escH(t('omnibar.previewDec') || 'Record Decision')}</span>
            <span class="omnibar-preview-tag">${statusMeta.icon} ${escH(statusMeta.label)}</span>
          </div>
          <div class="omnibar-preview-title">${escH(displayTitle)}</div>
          <div class="omnibar-preview-meta">
            <span class="omnibar-preview-tag">📁 ${escH(ws)}</span>
            ${tagsStr}
            <span>→ ${escH(t('omnibar.calToday') || 'Today')}</span>
            <span class="omnibar-preview-kbd"><kbd>↵</kbd> ${escH(t('omnibar.enterToCreate') || 'Press Enter to create')}</span>
          </div>
        </div>
      `;
    } else if (action === 'block') {
      const typeIcons = { work: '🔷', sync: '🟣', call: '🟢', prep: '🟠', personal: '🟡' };
      const displayTitle = title || t('omnibar.placeholderBlock') || 'Event title...';
      const dur = data.duration || '30m';
      const time = data.time || this.getNextRoundHour();

      previewHtml = `
        <div class="omnibar-preview-card">
          <div class="omnibar-preview-header">
            <span class="omnibar-preview-type">📅 ${escH(t('omnibar.previewBlock') || 'Schedule Block')}</span>
            <span class="omnibar-preview-tag">${typeIcons[data.type] || '🔷'} ${escH(data.type)}</span>
          </div>
          <div class="omnibar-preview-title">${escH(displayTitle)}</div>
          <div class="omnibar-preview-meta">
            <span class="omnibar-preview-tag">📁 ${escH(data.workstream || 'General')}</span>
            <span>🕒 ${escH(data.date)} · ${escH(time)} (${escH(dur)})</span>
            <span class="omnibar-preview-kbd"><kbd>↵</kbd> ${escH(t('omnibar.enterToCreate') || 'Press Enter to create')}</span>
          </div>
        </div>
      `;
    } else if (action === 'note') {
      const displayTitle = title || t('omnibar.placeholderNote') || 'Note title...';
      previewHtml = `
        <div class="omnibar-preview-card">
          <div class="omnibar-preview-header">
            <span class="omnibar-preview-type">📝 ${escH(t('omnibar.previewNote') || 'Create Note')}</span>
          </div>
          <div class="omnibar-preview-title">${escH(displayTitle)}</div>
          <div class="omnibar-preview-meta">
            <span class="omnibar-preview-tag">📁 ${escH(data.workstream || 'General')}</span>
            <span>${escH(t('omnibar.calToday') || 'Today')}</span>
            <span class="omnibar-preview-kbd"><kbd>↵</kbd> ${escH(t('omnibar.enterToCreate') || 'Press Enter to create')}</span>
          </div>
        </div>
      `;
    } else if (action === 'call') {
      const displayTitle = title || t('omnibar.placeholderCall') || 'Subject or participant...';
      previewHtml = `
        <div class="omnibar-preview-card">
          <div class="omnibar-preview-header">
            <span class="omnibar-preview-type">📞 ${escH(t('omnibar.previewCall') || 'Call & Note')}</span>
          </div>
          <div class="omnibar-preview-title">${escH(displayTitle)}</div>
          <div class="omnibar-preview-meta">
            <span class="omnibar-preview-tag">👤 ${escH(data.colleague || 'Team')}</span>
            <span>${escH(data.date || 'today')} · ${escH(data.time || this.getNextRoundHour())}</span>
            <span class="omnibar-preview-kbd"><kbd>↵</kbd> ${escH(t('omnibar.enterToCreate') || 'Press Enter to create')}</span>
          </div>
        </div>
      `;
    }

    resultsContainer.innerHTML = previewHtml;
  },

  renderRawCommandLivePreview(cmdMatch, query) {
    const resultsContainer = document.getElementById('omnibar-results');
    const input = document.getElementById('omnibar-input');
    const container = document.getElementById('omnibar-container');
    if (!resultsContainer || !cmdMatch) return;

    const rest = query.substring(cmdMatch.cmdLen).trim();
    const type = cmdMatch.type;

    if (container) {
      container.classList.remove('theme-decision', 'theme-todo', 'theme-block', 'theme-note', 'theme-call');
      container.removeAttribute('data-urgency');
    }

    resultsContainer.style.display = 'block';
    if (input) input.setAttribute('aria-expanded', 'true');

    if (type === 'todo') {
      const match = rest.match(/^(now|plan|delegate|del|later|q1|q2|q3|q4|high|medium|med|low)\s+(.+)$/i);
      let pKey = 'plan';
      let taskTitle = rest;
      if (match) {
        const rawTag = match[1].toLowerCase();
        if (['now', 'q1', 'high'].includes(rawTag)) pKey = 'now';
        else if (['plan', 'q2', 'medium', 'med'].includes(rawTag)) pKey = 'plan';
        else if (['delegate', 'del', 'q3', 'low'].includes(rawTag)) pKey = 'delegate';
        else if (['later', 'q4'].includes(rawTag)) pKey = 'later';
        taskTitle = match[2].trim();
      }
      if (container) {
        container.classList.add('theme-todo');
        container.setAttribute('data-urgency', pKey);
      }
      const fallbackPlanRaw = { label: t('omnibar.tokenPlan'), badge: 'badge-plan', text: 'PLAN' };
      const qMeta = {
        now: { label: t('omnibar.tokenNow') || 'Do Now (Urgent & Important)', badge: 'badge-now', text: 'NOW' },
        plan: { label: t('omnibar.tokenPlan') || 'Schedule (Important)', badge: 'badge-plan', text: 'PLAN' },
        delegate: { label: t('omnibar.tokenDelegate') || 'Delegate (Urgent)', badge: 'badge-delegate', text: 'DELEGATE' },
        later: { label: t('omnibar.tokenLater') || 'Later (Low priority)', badge: 'badge-later', text: 'LATER' }
      }[pKey] || fallbackPlanRaw;

      resultsContainer.innerHTML = `
        <div class="omnibar-preview-card">
          <div class="omnibar-preview-header">
            <span class="omnibar-preview-type">✅ ${escH(t('omnibar.previewTodo') || 'New Task')}</span>
            <span class="badge-urgency ${qMeta.badge}">${qMeta.text}</span>
          </div>
          <div class="omnibar-preview-title">${escH(taskTitle || t('omnibar.placeholderTask') || 'What needs to be done?')}</div>
          <div class="omnibar-preview-meta">
            <span>${escH(qMeta.label)}</span>
            <span class="omnibar-preview-kbd"><kbd>↵</kbd> ${escH(t('omnibar.enterToCreate') || 'Press Enter to create')}</span>
          </div>
        </div>
      `;
    } else if (type === 'dec') {
      if (container) container.classList.add('theme-decision');
      resultsContainer.innerHTML = `
        <div class="omnibar-preview-card">
          <div class="omnibar-preview-header">
            <span class="omnibar-preview-type">⚖️ ${escH(t('omnibar.previewDec') || 'Record Decision')}</span>
          </div>
          <div class="omnibar-preview-title">${escH(rest || t('omnibar.placeholderDecision') || 'Decision summary...')}</div>
          <div class="omnibar-preview-meta">
            <span>→ ${escH(t('omnibar.calToday') || 'Today')}</span>
            <span class="omnibar-preview-kbd"><kbd>↵</kbd> ${escH(t('omnibar.enterToCreate') || 'Press Enter to create')}</span>
          </div>
        </div>
      `;
    } else if (type === 'block') {
      if (container) container.classList.add('theme-block');
      resultsContainer.innerHTML = `
        <div class="omnibar-preview-card">
          <div class="omnibar-preview-header">
            <span class="omnibar-preview-type">📅 ${escH(t('omnibar.previewBlock') || 'Schedule Block')}</span>
          </div>
          <div class="omnibar-preview-title">${escH(rest || t('omnibar.placeholderBlock') || 'Event title...')}</div>
          <div class="omnibar-preview-meta">
            <span class="omnibar-preview-kbd"><kbd>↵</kbd> ${escH(t('omnibar.enterToCreate') || 'Press Enter to create')}</span>
          </div>
        </div>
      `;
    } else if (type === 'note') {
      if (container) container.classList.add('theme-note');
      resultsContainer.innerHTML = `
        <div class="omnibar-preview-card">
          <div class="omnibar-preview-header">
            <span class="omnibar-preview-type">📝 ${escH(t('omnibar.previewNote') || 'Create Note')}</span>
          </div>
          <div class="omnibar-preview-title">${escH(rest || t('omnibar.placeholderNote') || 'Note title...')}</div>
          <div class="omnibar-preview-meta">
            <span class="omnibar-preview-kbd"><kbd>↵</kbd> ${escH(t('omnibar.enterToCreate') || 'Press Enter to create')}</span>
          </div>
        </div>
      `;
    } else if (type === 'call') {
      if (container) container.classList.add('theme-call');
      resultsContainer.innerHTML = `
        <div class="omnibar-preview-card">
          <div class="omnibar-preview-header">
            <span class="omnibar-preview-type">📞 ${escH(t('omnibar.previewCall') || 'Call & Note')}</span>
          </div>
          <div class="omnibar-preview-title">${escH(rest || t('omnibar.placeholderCall') || 'Subject or participant...')}</div>
          <div class="omnibar-preview-meta">
            <span class="omnibar-preview-kbd"><kbd>↵</kbd> ${escH(t('omnibar.enterToCreate') || 'Press Enter to create')}</span>
          </div>
        </div>
      `;
    }
  },

  async submitSegmented() {
    const data = this.segmentedState.data;
    const action = this.segmentedState.action;
    this.close();

    try {
      if (action === 'todo') {
        await this.handleTodoCommand(`/todo ${data.priority} ${data.title}`);
      } else if (action === 'dec') {
        await this.handleDecisionCommand(`/dec [${data.workstream}] ${data.title}`);
      } else if (action === 'block') {
        const dur = data.duration || '30m';
        const date = data.date || 'today';
        const time = data.time || this.getNextRoundHour();
        await this.handleBlockCommand(`/block ${data.title} ${date} ${time} ${dur}`);
      } else if (action === 'note') {
        await this.handleNoteCommand(`/note [${data.workstream}] ${data.title}`);
      } else if (action === 'call') {
        await this.handleCallCommand(data.title);
      }
    } catch (err) {
      console.error('Segmented submit failed', err);
      toast(t('omnibar.captureError', { message: err.message }), true);
    }
  },


  getNextRoundHour() {
    const now = new Date();
    const nextH = (now.getHours() + 1) % 24;
    return `${String(nextH).padStart(2, '0')}:00`;
  },

  updateGhostSuggestion() {
    const input = document.getElementById('omnibar-input');
    const ghostLayer = document.getElementById('omnibar-ghost-layer');
    if (!input || !ghostLayer) return;

    const val = input.value;
    if (!val) {
      this.clearGhostSuggestion();
      this.renderDefaultHints();
      return;
    }

    const info = this.getGhostSuggestionInfo(val);
    if (info && info.ghostSuffix) {
      ghostLayer.innerHTML = `<span class="omnibar-ghost-prefix">${escH(val)}</span><span class="omnibar-ghost-suggestion">${escH(info.ghostSuffix)}</span><span class="omnibar-ghost-tab-hint">Tab ⇥</span>`;
    } else {
      this.clearGhostSuggestion();
    }

    this.renderDynamicHints(val, info);
    this.updateParamIndicator();
  },

  clearGhostSuggestion() {
    const ghostLayer = document.getElementById('omnibar-ghost-layer');
    if (ghostLayer) ghostLayer.innerHTML = '';
    this.clearParamIndicator();
  },

  measureTextWidth(text) {
    let measurer = this._paramMeasurerEl;
    if (!measurer) {
      measurer = document.createElement('span');
      measurer.className = 'omnibar-param-measure';
      const area = document.getElementById('omnibar-input-area');
      if (area) {
        area.appendChild(measurer);
      } else {
        document.body.appendChild(measurer);
      }
      this._paramMeasurerEl = measurer;
    }
    measurer.textContent = text;
    return measurer.getBoundingClientRect().width;
  },

  updateParamIndicator() {
    const input = document.getElementById('omnibar-input');
    const indicator = document.getElementById('omnibar-param-indicator');
    if (!input || !indicator) return;

    const val = input.value;
    if (!val || !val.startsWith('/')) {
      indicator.innerHTML = '';
      indicator.classList.remove('active');
      return;
    }

    const cursorPos = input.selectionStart || 0;
    const params = this.getParamBreakdown(val, cursorPos);

    if (!params || params.length === 0) {
      indicator.innerHTML = '';
      indicator.classList.remove('active');
      return;
    }

    indicator.classList.add('active');

    let html = '';
    params.forEach(p => {
      const activeClass = p.isActive ? ' is-active' : (p.isFilled ? ' is-filled' : '');
      const titleText = p.title || p.label || '';
      const labelText = escH(p.label);

      html += `<span class="omnibar-param-badge${activeClass}" title="${escH(titleText)}">${labelText}</span>`;
    });

    indicator.innerHTML = html;
  },

  clearParamIndicator() {
    const indicator = document.getElementById('omnibar-param-indicator');
    if (indicator) {
      indicator.innerHTML = '';
      indicator.classList.remove('active');
    }
  },

  getParamBreakdown(val, cursorPos) {
    if (!val || !val.startsWith('/')) return [];
    const lower = val.toLowerCase();

    // 1. Single slash or command being typed without spaces (e.g. "/to", "/tâ", "/bl")
    if (!val.includes(' ')) {
      const cmds = this.getKnownCommands();
      const pUrgency = t('omnibar.paramUrgency') || '<urgency>';
      const pLabel = t('omnibar.paramLabel') || '<label>';
      const pTopic = t('omnibar.paramTopic') || '<topic>';
      const pGroup = t('omnibar.paramGroup') || '<group>';
      const pThought = t('omnibar.paramThought') || '<thought>';
      const pQuery = t('omnibar.paramQuery') || '<query>';

      for (const [type, aliases] of Object.entries(cmds)) {
        if (aliases.some(a => a.startsWith(lower))) {
          let label = pLabel;
          if (type === 'todo') label = pUrgency;
          else if (type === 'dec') label = pTopic;
          else if (type === 'note') label = pGroup;
          else if (type === 'stash') label = pThought;
          else if (type === 'secretary') label = pQuery;

          return [{
            label,
            startIndex: val.length + 1,
            isActive: true,
            isFilled: false,
            title: label
          }];
        }
      }
      return [];
    }

    const match = this.matchCommandType(val);
    if (!match) return [];

    const cmdLen = match.cmdLen;
    const { type } = match;

    // 2. /todo [priority] <title>
    if (type === 'todo') {
      const content = val.substring(cmdLen);
      const priorities = ['NOW', 'PLAN', 'DELEGATE', 'DEL', 'LATER', 'Q1', 'Q2', 'Q3', 'Q4', 'HIGH', 'MEDIUM', 'MED', 'LOW', 'MAINTENANT', 'SOFORT', 'AHORA', 'SUBITO', 'HNED', 'TERAZ', 'MOST', 'ACUM', 'СЕЙЧАС', 'ŞİMDİ', 'SIMDI', 'ЗАРАЗ', 'PLANIFIER', 'PLANEN', 'PLANEAR', 'PIANIFICA', 'PLANNEN', 'ZAPLANUJ', 'PLANEJAR', 'NAPLANOVAT', 'TERVEZ', 'PROGRAMEAZA', 'ЗАПЛАНИРОВАТЬ', 'PLANERA', 'PLANLA', 'ЗАПЛАНУВАТИ', 'DELEGUER', 'DÉLÉGUER', 'DELEGIEREN', 'DELEGAR', 'DELEGARE', 'DELEGA', 'DELEGEREN', 'ODDELEGUJ', 'DELEGOVAT', 'DELEGÁL', 'DELEGERA', 'DEVRET', 'ДЕЛЕГИРОВАТЬ', 'ДЕВРЕТ', 'ДЕЛЕГУВАТИ', 'TARD', 'PLUSTARD', 'SPÄTER', 'SPAETER', 'LUEGO', 'DESPUES', 'DOPO', 'TARDI', 'DEPOIS', 'POZDEJI', 'PÓŹNIEJ', 'POZNIEJ', 'KÉSŐBB', 'KESOBB', 'MAITÂRZIU', 'TARZIU', 'ПОЗЖЕ', 'SENARE', 'SONRA', 'ПІЗНІШЕ'];

      const matchSpaces = content.match(/^(\s*)/);
      const leadingSpaceLen = matchSpaces ? matchSpaces[1].length : 0;
      const firstWordIndex = cmdLen + leadingSpaceLen;

      const restTrimmed = content.trimStart();
      const firstWordMatch = restTrimmed.match(/^(\S+)/);

      if (firstWordMatch && priorities.includes(firstWordMatch[1].toUpperCase())) {
        const urgencyWord = firstWordMatch[1];
        const urgencyEnd = firstWordIndex + urgencyWord.length;

        const contentAfterUrgency = val.substring(urgencyEnd);
        const spaceAfterUrgencyMatch = contentAfterUrgency.match(/^(\s*)/);
        const labelStartIndex = urgencyEnd + (spaceAfterUrgencyMatch ? spaceAfterUrgencyMatch[1].length : 0);
        const labelText = val.substring(labelStartIndex);

        const urgencyParam = {
          label: t('omnibar.paramUrgency') || '<urgency>',
          startIndex: firstWordIndex,
          endIndex: urgencyEnd,
          isFilled: true,
          isActive: cursorPos >= firstWordIndex && cursorPos <= urgencyEnd,
          title: t('omnibar.paramUrgency') || '<urgency>'
        };

        const labelParam = {
          label: t('omnibar.paramLabel') || '<label>',
          startIndex: labelStartIndex,
          endIndex: val.length,
          isFilled: labelText.trim().length > 0,
          isActive: cursorPos >= labelStartIndex,
          title: t('omnibar.paramLabel') || '<label>'
        };

        return [urgencyParam, labelParam];
      } else {
        const labelStartIndex = firstWordIndex;
        const labelText = val.substring(labelStartIndex);

        const labelParam = {
          label: t('omnibar.paramLabel') || '<label>',
          startIndex: labelStartIndex,
          endIndex: val.length,
          isFilled: labelText.trim().length > 0,
          isActive: true,
          title: t('omnibar.paramLabel') || '<label>'
        };

        if (!labelText) {
          const urgencyParam = {
            label: t('omnibar.paramUrgency') || '<urgency>',
            startIndex: firstWordIndex,
            endIndex: firstWordIndex,
            isFilled: false,
            isActive: cursorPos >= cmdLen && cursorPos <= firstWordIndex,
            title: t('omnibar.paramUrgency') || '<urgency>'
          };
          return [urgencyParam, labelParam];
        }

        return [labelParam];
      }
    }

    // 3. /block <title> [date] [time] [duration]
    if (type === 'block') {
      const content = val.substring(cmdLen);
      const matchSpaces = content.match(/^(\s*)/);
      const firstWordIndex = cmdLen + (matchSpaces ? matchSpaces[1].length : 0);

      const dateRegex = /\b(today|tomorrow|demain|hier|heute|morgen|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2})\b/gi;
      const timeRegex = /\b([01]?\d|2[0-3])[:h]([0-5]\d)?\b/gi;
      const durationRegex = /\b(\d+)\s*(m|min|h|hr)\b/gi;

      const dateMatch = dateRegex.exec(content);
      const timeMatch = timeRegex.exec(content);
      const durationMatch = durationRegex.exec(content);

      let labelStartIndex = firstWordIndex;
      const tokenRegex = /\S+/g;
      let tok;
      while ((tok = tokenRegex.exec(content)) !== null) {
        const isDate = dateMatch && tok.index === dateMatch.index;
        const isTime = timeMatch && tok.index === timeMatch.index;
        const isDuration = durationMatch && tok.index === durationMatch.index;
        if (!isDate && !isTime && !isDuration) {
          labelStartIndex = cmdLen + tok.index;
          break;
        }
      }

      const params = [];

      params.push({
        label: t('omnibar.paramLabel') || '<label>',
        startIndex: labelStartIndex,
        isFilled: content.trim().length > 0,
        isActive: cursorPos >= labelStartIndex && (!dateMatch || cursorPos < cmdLen + dateMatch.index),
        title: t('omnibar.paramLabel') || '<label>'
      });

      if (dateMatch) {
        const idx = cmdLen + dateMatch.index;
        params.push({
          label: t('omnibar.paramDate') || '<date>',
          startIndex: idx,
          isFilled: true,
          isActive: cursorPos >= idx && cursorPos <= idx + dateMatch[0].length,
          title: t('omnibar.paramDate') || '<date>'
        });
      } else if (content.trim().length > 0) {
        params.push({
          label: t('omnibar.paramDate') || '<date>',
          startIndex: val.length + 1,
          isFilled: false,
          isActive: false,
          title: t('omnibar.paramDate') || '<date>'
        });
      }

      if (timeMatch) {
        const idx = cmdLen + timeMatch.index;
        params.push({
          label: t('omnibar.paramTime') || '<time>',
          startIndex: idx,
          isFilled: true,
          isActive: cursorPos >= idx && cursorPos <= idx + timeMatch[0].length,
          title: t('omnibar.paramTime') || '<time>'
        });
      } else if (dateMatch) {
        params.push({
          label: t('omnibar.paramTime') || '<time>',
          startIndex: val.length + 1,
          isFilled: false,
          isActive: false,
          title: t('omnibar.paramTime') || '<time>'
        });
      }

      if (durationMatch) {
        const idx = cmdLen + durationMatch.index;
        params.push({
          label: t('omnibar.paramDuration') || '<duration>',
          startIndex: idx,
          isFilled: true,
          isActive: cursorPos >= idx && cursorPos <= idx + durationMatch[0].length,
          title: t('omnibar.paramDuration') || '<duration>'
        });
      } else if (timeMatch) {
        params.push({
          label: t('omnibar.paramDuration') || '<duration>',
          startIndex: val.length + 1,
          isFilled: false,
          isActive: false,
          title: t('omnibar.paramDuration') || '<duration>'
        });
      }

      return params;
    }

    // 4. /note [group] <title>
    if (type === 'note') {
      const content = val.substring(cmdLen);
      const matchSpaces = content.match(/^(\s*)/);
      const firstWordIndex = cmdLen + (matchSpaces ? matchSpaces[1].length : 0);

      const contentTrimmed = content.trimStart();
      const groupMatch = contentTrimmed.match(/^\[([^\]]+)\]/);
      if (groupMatch) {
        const groupEnd = firstWordIndex + groupMatch[0].length;
        const contentAfterGroup = val.substring(groupEnd);
        const spaceAfterGroup = contentAfterGroup.match(/^(\s*)/);
        const titleStart = groupEnd + (spaceAfterGroup ? spaceAfterGroup[1].length : 0);

        return [
          {
            label: t('omnibar.paramGroup') || '<group>',
            startIndex: firstWordIndex,
            isFilled: true,
            isActive: cursorPos >= firstWordIndex && cursorPos <= groupEnd,
            title: t('omnibar.paramGroup') || '<group>'
          },
          {
            label: t('omnibar.paramLabel') || '<label>',
            startIndex: titleStart,
            isFilled: val.substring(titleStart).trim().length > 0,
            isActive: cursorPos >= titleStart,
            title: t('omnibar.paramLabel') || '<label>'
          }
        ];
      } else {
        return [
          {
            label: t('omnibar.paramGroup') || '<group>',
            startIndex: firstWordIndex,
            isFilled: false,
            isActive: false,
            title: t('omnibar.paramGroup') || '<group>'
          },
          {
            label: t('omnibar.paramLabel') || '<label>',
            startIndex: firstWordIndex,
            isFilled: val.substring(firstWordIndex).trim().length > 0,
            isActive: cursorPos >= firstWordIndex,
            title: t('omnibar.paramLabel') || '<label>'
          }
        ];
      }
    }

    // 5. /dec [topic] <text>
    if (type === 'dec') {
      const content = val.substring(cmdLen);
      const matchSpaces = content.match(/^(\s*)/);
      const firstWordIndex = cmdLen + (matchSpaces ? matchSpaces[1].length : 0);

      const contentTrimmed = content.trimStart();
      const topicMatch = contentTrimmed.match(/^\[([^\]]+)\]/);
      if (topicMatch) {
        const topicEnd = firstWordIndex + topicMatch[0].length;
        const contentAfterTopic = val.substring(topicEnd);
        const spaceAfterTopic = contentAfterTopic.match(/^(\s*)/);
        const textStart = topicEnd + (spaceAfterTopic ? spaceAfterTopic[1].length : 0);

        return [
          {
            label: t('omnibar.paramTopic') || '<topic>',
            startIndex: firstWordIndex,
            isFilled: true,
            isActive: cursorPos >= firstWordIndex && cursorPos <= topicEnd,
            title: t('omnibar.paramTopic') || '<topic>'
          },
          {
            label: t('omnibar.paramLabel') || '<label>',
            startIndex: textStart,
            isFilled: val.substring(textStart).trim().length > 0,
            isActive: cursorPos >= textStart,
            title: t('omnibar.paramLabel') || '<label>'
          }
        ];
      } else {
        return [
          {
            label: t('omnibar.paramTopic') || '<topic>',
            startIndex: firstWordIndex,
            isFilled: false,
            isActive: false,
            title: t('omnibar.paramTopic') || '<topic>'
          },
          {
            label: t('omnibar.paramLabel') || '<label>',
            startIndex: firstWordIndex,
            isFilled: val.substring(firstWordIndex).trim().length > 0,
            isActive: cursorPos >= firstWordIndex,
            title: t('omnibar.paramLabel') || '<label>'
          }
        ];
      }
    }

    // 6. /call [title]
    if (type === 'call') {
      const content = val.substring(cmdLen);
      const matchSpaces = content.match(/^(\s*)/);
      const firstWordIndex = cmdLen + (matchSpaces ? matchSpaces[1].length : 0);

      return [{
        label: t('omnibar.paramLabel') || '<label>',
        startIndex: firstWordIndex,
        isFilled: content.trim().length > 0,
        isActive: cursorPos >= firstWordIndex,
        title: t('omnibar.paramLabel') || '<label>'
      }];
    }

    // 7. /stash <thought>
    if (type === 'stash') {
      const content = val.substring(cmdLen);
      const matchSpaces = content.match(/^(\s*)/);
      const firstWordIndex = cmdLen + (matchSpaces ? matchSpaces[1].length : 0);

      return [{
        label: t('omnibar.paramThought') || '<thought>',
        startIndex: firstWordIndex,
        isFilled: content.trim().length > 0,
        isActive: cursorPos >= firstWordIndex,
        title: t('omnibar.paramThought') || '<thought>'
      }];
    }

    // 8. /secretary <query>
    if (type === 'secretary') {
      const content = val.substring(cmdLen);
      const matchSpaces = content.match(/^(\s*)/);
      const firstWordIndex = cmdLen + (matchSpaces ? matchSpaces[1].length : 0);

      return [{
        label: t('omnibar.paramQuery') || '<query>',
        startIndex: firstWordIndex,
        isFilled: content.trim().length > 0,
        isActive: cursorPos >= firstWordIndex,
        title: t('omnibar.paramQuery') || '<query>'
      }];
    }

    return [];
  },

  handleTabCompletion(isReverse = false) {
    const input = document.getElementById('omnibar-input');
    if (!input) return;

    const val = input.value;
    const info = this.getGhostSuggestionInfo(val);

    // If options are available for cycling
    if (info && info.options && info.options.length > 0) {
      if (!this.tabCycle.active || this.tabCycle.tokenType !== info.tokenType) {
        this.tabCycle = {
          active: true,
          tokenType: info.tokenType,
          options: info.options,
          index: 0,
          baseVal: val
        };
      }

      if (isReverse) {
        this.tabCycle.index = (this.tabCycle.index - 1 + this.tabCycle.options.length) % this.tabCycle.options.length;
      }

      const opt = this.tabCycle.options[this.tabCycle.index];
      
      if (!isReverse) {
        this.tabCycle.index = (this.tabCycle.index + 1) % this.tabCycle.options.length;
      }

      if (info.tokenType === 'cmd') {
        input.value = opt;
      } else if (info.tokenType === 'todoPriority') {
        const activeCmd = this.matchCommandType(val)?.matchedAlias || cmdTodo;
        input.value = `${activeCmd} ${opt} `;
      } else if (info.tokenType === 'noteGroup') {
        const activeCmd = this.matchCommandType(val)?.matchedAlias || cmdNote;
        input.value = `${activeCmd} ${opt} `;
      } else if (info.tokenType === 'decTopic') {
        const activeCmd = this.matchCommandType(val)?.matchedAlias || cmdDec;
        input.value = `${activeCmd} ${opt} `;
      } else if (info.tokenType.startsWith('block')) {
        const cleanBase = val.trimEnd();
        input.value = cleanBase + ' ' + opt + ' ';
      } else {
        input.value = (info.tabComplete || val) + ' ';
      }

      input.setSelectionRange(input.value.length, input.value.length);
      this.updateGhostSuggestion();
      this.scheduleLiveSearch();
      return;
    }

    if (info && info.tabComplete) {
      input.value = info.tabComplete;
      input.setSelectionRange(input.value.length, input.value.length);
      this.tabCycle.active = false;
      this.updateGhostSuggestion();
      this.scheduleLiveSearch();
    }
  },

  renderDefaultHints() {
    const hintsContainer = document.querySelector('.omnibar-hints');
    if (!hintsContainer) return;

    const cmdTodo = t('omnibar.cmdTodo') || '/todo';
    const cmdBlock = t('omnibar.cmdBlock') || '/block';
    const cmdCall = t('omnibar.cmdCall') || '/call';
    const cmdDec = t('omnibar.cmdDec') || '/dec';
    const cmdNote = t('omnibar.cmdNote') || '/note';
    const cmdStash = t('omnibar.cmdStash') || '/stash';
    const cmdSec = t('omnibar.cmdSecretary') || '/secretary';

    const hTodo = t('omnibar.hintTodo') || 'Create a task';
    const hBlock = t('omnibar.hintBlock') || 'Create planner block';
    const hCall = t('omnibar.hintCall') || 'Create call & note';
    const hDec = t('omnibar.hintDec') || 'Record decision';
    const hNote = t('omnibar.hintNote') || 'New note';
    const hStash = t('omnibar.hintStash') || 'Capture thought';
    const hSec = t('omnibar.hintSecretary') || 'Ask assistant';

    hintsContainer.innerHTML = `
      <span class="omnibar-hint-pill" onclick="OmnibarController.setCommandPrefix('${cmdTodo}')" title="${escH(hTodo)}"><code>${cmdTodo}</code> ${hTodo}</span>
      <span class="omnibar-hint-pill" onclick="OmnibarController.setCommandPrefix('${cmdBlock}')" title="${escH(hBlock)}"><code>${cmdBlock}</code> ${hBlock}</span>
      <span class="omnibar-hint-pill" onclick="OmnibarController.setCommandPrefix('${cmdCall}')" title="${escH(hCall)}"><code>${cmdCall}</code> ${hCall}</span>
      <span class="omnibar-hint-pill" onclick="OmnibarController.setCommandPrefix('${cmdDec}')" title="${escH(hDec)}"><code>${cmdDec}</code> ${hDec}</span>
      <span class="omnibar-hint-pill" onclick="OmnibarController.setCommandPrefix('${cmdNote}')" title="${escH(hNote)}"><code>${cmdNote}</code> ${hNote}</span>
      <span class="omnibar-hint-pill" onclick="OmnibarController.setCommandPrefix('${cmdStash}')" title="${escH(hStash)}"><code>${cmdStash}</code> ${hStash}</span>
      <span class="omnibar-hint-pill" onclick="OmnibarController.setCommandPrefix('${cmdSec}')" title="${escH(hSec)}"><code>${cmdSec}</code> ${hSec}</span>
    `;
  },

  renderDynamicHints(val, info) {
    const hintsContainer = document.querySelector('.omnibar-hints');
    if (!hintsContainer) return;

    const match = this.matchCommandType(val);
    if (!match) {
      if (val === '/' || !val.includes(' ')) {
        this.renderDefaultHints();
      }
      return;
    }

    if (match.type === 'todo') {
      const tNow = t('omnibar.tokenNow') || 'Do Now (Urgent & Important)';
      const tPlan = t('omnibar.tokenPlan') || 'Schedule (Important)';
      const tDel = t('omnibar.tokenDelegate') || 'Delegate (Urgent)';
      const tLater = t('omnibar.tokenLater') || 'Later (Low priority)';
      hintsContainer.innerHTML = `
        <span class="omnibar-hint-pill" onclick="OmnibarController.appendToken('now')" title="${escH(tNow)}"><span class="badge-urgency badge-now">now</span> ${tNow}</span>
        <span class="omnibar-hint-pill" onclick="OmnibarController.appendToken('plan')" title="${escH(tPlan)}"><span class="badge-urgency badge-plan">plan</span> ${tPlan}</span>
        <span class="omnibar-hint-pill" onclick="OmnibarController.appendToken('delegate')" title="${escH(tDel)}"><span class="badge-urgency badge-delegate">del</span> ${tDel}</span>
        <span class="omnibar-hint-pill" onclick="OmnibarController.appendToken('later')" title="${escH(tLater)}"><span class="badge-urgency badge-later">later</span> ${tLater}</span>
      `;
    } else if (match.type === 'block') {
      const nextHour = this.getNextRoundHour();
      const tToday = t('omnibar.tokenToday') || 'Today';
      const tTomorrow = t('omnibar.tokenTomorrow') || 'Tomorrow';
      const tHour = t('omnibar.tokenHour') || 'Time';
      const t30m = t('omnibar.token30m') || '30 min';
      const t1h = t('omnibar.token1h') || '1 hour';
      const t2h = t('omnibar.token2h') || '2 hours';
      hintsContainer.innerHTML = `
        <span class="omnibar-hint-pill" onclick="OmnibarController.appendToken('today')" title="${escH(tToday)}"><code>today</code> ${tToday}</span>
        <span class="omnibar-hint-pill" onclick="OmnibarController.appendToken('tomorrow')" title="${escH(tTomorrow)}"><code>tomorrow</code> ${tTomorrow}</span>
        <span class="omnibar-hint-pill" onclick="OmnibarController.appendToken('${nextHour}')" title="${escH(tHour)}"><code>${nextHour}</code> ${tHour}</span>
        <span class="omnibar-hint-pill" onclick="OmnibarController.appendToken('30m')" title="${escH(t30m)}"><code>30m</code> ${t30m}</span>
        <span class="omnibar-hint-pill" onclick="OmnibarController.appendToken('1h')" title="${escH(t1h)}"><code>1h</code> ${t1h}</span>
        <span class="omnibar-hint-pill" onclick="OmnibarController.appendToken('2h')" title="${escH(t2h)}"><code>2h</code> ${t2h}</span>
      `;
    } else if (match.type === 'note') {
      const groups = this.getExistingGroups().slice(0, 5);
      const tGrp = t('omnibar.tokenGroup') || 'Group';
      hintsContainer.innerHTML = groups.map(g => 
        `<span class="omnibar-hint-pill" onclick="OmnibarController.appendToken('[${escH(g)}]')" title="${escH(g)}"><code>[${escH(g)}]</code> ${tGrp}</span>`
      ).join('');
    } else if (match.type === 'dec') {
      const topics = this.getExistingTopics().slice(0, 5);
      const tTop = t('omnibar.tokenTopic') || 'Topic';
      hintsContainer.innerHTML = topics.map(tp => 
        `<span class="omnibar-hint-pill" onclick="OmnibarController.appendToken('[${escH(tp)}]')" title="${escH(tp)}"><code>[${escH(tp)}]</code> ${tTop}</span>`
      ).join('');
    }
  },

  async submit() {
    const input = document.getElementById('omnibar-input');
    if (!input) return;
    const value = input.value.trim();
    if (!value) return;

    this.recordHistory(value);
    this.close();

    try {
      const lowerVal = value.toLowerCase();
      const match = this.matchCommandType(value);

      if (
        lowerVal === 'secretary' || lowerVal === '@secretary' ||
        lowerVal.startsWith('secretary ') || lowerVal.startsWith('@secretary ') ||
        match?.type === 'secretary'
      ) {
        const query = value.replace(/^(\/|@)?\S+\s*/i, '').trim();
        if (query && window.AIChatController) {
          await window.AIChatController.askFromOmnibar(query);
        } else {
          await switchTab('chat');
        }
      } else if (match?.type === 'todo') {
        await this.handleTodoCommand(value);
      } else if (match?.type === 'block') {
        await this.handleBlockCommand(value);
      } else if (match?.type === 'dec') {
        await this.handleDecisionCommand(value);
      } else if (match?.type === 'note') {
        await this.handleNoteCommand(value);
      } else if (match?.type === 'call') {
        await this.handleCallCommand(value);
      } else {
        // Raw captures (Saisie Libre)
        let stashText = value;
        if (match?.type === 'stash') {
          stashText = value.replace(/^\/\S+\s*/i, '');
        }
        await StashService.add(stashText);
        toast(t('omnibar.stashSuccess'));
      }
    } catch (err) {
      console.error('Omnibar submit failed', err);
      toast(t('omnibar.captureError', { message: err.message }), true);
    }
  },

  async handleTodoCommand(cmdStr) {
    const content = cmdStr.replace(/^\/\S+\s*/i, '').trim();
    if (!content) {
      toast(t('omnibar.todoSyntax'), true);
      return;
    }

    const match = content.match(/^(now|plan|delegate|del|later|q1|q2|q3|q4|high|medium|med|low|maintenant|sofort|ahora|subito|hned|teraz|most|acum|сейчас|şimdi|simdi|зараз|planifier|planen|planear|pianifica|plannen|zaplanuj|planejar|naplanovat|tervez|programeaza|запланировать|planera|planla|запланувати|deleguer|déléguer|delegieren|delegare|delega|delegeren|oddeleguj|delegovat|delegál|delegera|devret|делегировать|деврет|делегувати|tard|plustard|später|spaeter|luego|despues|dopo|tardi|depois|pozdeji|później|pozniej|később|kesobb|maitârziu|tarziu|позже|senare|sonra|пізніше)\s+(.+)$/i);
    let quadrant = 'Q2';
    let priority = 'Medium';
    let text = content;

    if (match) {
      const tag = match[1].toUpperCase();
      if (typeof EisenhowerUtils !== 'undefined' && EisenhowerUtils.parseQuadrantTag) {
        const parsed = EisenhowerUtils.parseQuadrantTag(tag);
        quadrant = parsed.quadrant;
        priority = parsed.priority;
      } else {
        if (tag === 'NOW' || tag === 'Q1' || tag === 'HIGH') { quadrant = 'Q1'; priority = 'High'; }
        else if (tag === 'PLAN' || tag === 'Q2' || tag === 'MEDIUM' || tag === 'MED') { quadrant = 'Q2'; priority = 'Medium'; }
        else if (tag === 'DELEGATE' || tag === 'DEL' || tag === 'Q3' || tag === 'LOW') { quadrant = 'Q3'; priority = 'Low'; }
        else if (tag === 'LATER' || tag === 'Q4') { quadrant = 'Q4'; priority = 'Low'; }
      }
      text = match[2].trim();
    }

    const date = new Date().toISOString().slice(0, 10);
    const todoId = 'todo-' + Date.now();
    const todo = {
      id: todoId,
      title: text.slice(0, 120),
      priority: priority === 'WIP' ? 'Medium' : priority,
      eisenhowerQuadrant: quadrant,
      owner: (typeof settings !== 'undefined' && settings && settings.username) ? settings.username : 'me',
      dueDate: '',
      noteId: '',
      noteTodoMarkerId: todoId,
      context: text,
      created: date,
      modified: date
    };



    if (typeof todosManifest === 'undefined' || !Array.isArray(todosManifest)) {
      window.todosManifest = [];
    }

    todosManifest.push(todo);
    if (typeof saveTodosManifest === 'function') await saveTodosManifest();
    if (typeof renderBoard === 'function') renderBoard();
    if (typeof renderTodosBoard === 'function') renderTodosBoard();
    if (typeof renderPlanner === 'function' && typeof activeTab !== 'undefined' && activeTab === 'planner') renderPlanner();
    toast(t('omnibar.todoSuccess', { title: todo.title, priority: quadrant }));
  },

  async handleBlockCommand(cmdStr) {
    let content = cmdStr.replace(/^\/\S+\s*/i, '').trim();
    if (!content) {
      toast(t('omnibar.blockSyntax') || 'Syntax: /block [title] [today|tomorrow|YYYY-MM-DD] [14:00] [30m|1h]', true);
      return;
    }

    const now = new Date();
    let dateStr = typeof formatLocalDateValue === 'function' ? formatLocalDateValue(now) : now.toISOString().slice(0, 10);
    let startTimeStr = '';
    let durationMins = (typeof settings !== 'undefined' && settings?.plannerDefaultDuration) ? parseInt(settings.plannerDefaultDuration, 10) : 30;

    // 1. Extract Duration (e.g. 30m, 45min, 1h, 1h30, 2h)
    const durMatch = content.match(/\b(\d+)\s*(h|hr|hrs|heures?|m|min|mins|minutes?)\s*(\d+)?\b/i);
    if (durMatch) {
      const unit = durMatch[2].toLowerCase();
      const val1 = parseInt(durMatch[1], 10);
      const val2 = durMatch[3] ? parseInt(durMatch[3], 10) : 0;
      if (unit.startsWith('h')) {
        durationMins = val1 * 60 + val2;
      } else {
        durationMins = val1;
      }
      content = content.replace(durMatch[0], '').trim();
    }

    // 2. Extract Time (e.g. 14:00, 14h30, 9am, 2pm)
    const timeMatch = content.match(/\b([01]?\d|2[0-3])[:h]([0-5]\d)?\b/i) || content.match(/\b([1-9]|1[0-2])\s*(am|pm)\b/i);
    if (timeMatch) {
      if (timeMatch[0].toLowerCase().includes('am') || timeMatch[0].toLowerCase().includes('pm')) {
        let h = parseInt(timeMatch[1], 10);
        if (timeMatch[2].toLowerCase() === 'pm' && h < 12) h += 12;
        if (timeMatch[2].toLowerCase() === 'am' && h === 12) h = 0;
        startTimeStr = `${String(h).padStart(2, '0')}:00`;
      } else {
        const h = parseInt(timeMatch[1], 10);
        const m = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
        startTimeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      }
      content = content.replace(timeMatch[0], '').trim();
    } else {
      const nextH = (now.getHours() + 1) % 24;
      startTimeStr = `${String(nextH).padStart(2, '0')}:00`;
    }

    // 3. Extract Date (e.g. today, tomorrow, demain, hier, YYYY-MM-DD, DD/MM/YYYY)
    const lowerContent = content.toLowerCase();
    if (lowerContent.includes('today') || lowerContent.includes("aujourd'hui") || lowerContent.includes('heute') || lowerContent.includes('hoy') || lowerContent.includes('oggi')) {
      content = content.replace(/today|aujourd'hui|heute|hoy|oggi/gi, '').trim();
    } else if (lowerContent.includes('tomorrow') || lowerContent.includes('demain') || lowerContent.includes('morgen') || lowerContent.includes('mañana') || lowerContent.includes('domani')) {
      const tom = new Date(now);
      tom.setDate(tom.getDate() + 1);
      dateStr = typeof formatLocalDateValue === 'function' ? formatLocalDateValue(tom) : tom.toISOString().slice(0, 10);
      content = content.replace(/tomorrow|demain|morgen|mañana|domani/gi, '').trim();
    } else {
      const dateMatch = content.match(/\b(\d{4})-(\d{2})-(\d{2})\b/) || content.match(/\b(\d{1,2})[\/\.](\d{1,2})([\/\.](\d{4}))?\b/);
      if (dateMatch) {
        if (dateMatch[0].includes('-')) {
          dateStr = dateMatch[0];
        } else {
          const d = String(dateMatch[1]).padStart(2, '0');
          const m = String(dateMatch[2]).padStart(2, '0');
          const y = dateMatch[4] || String(now.getFullYear());
          dateStr = `${y}-${m}-${d}`;
        }
        content = content.replace(dateMatch[0], '').trim();
      }
    }

    // Clean title
    const title = content.replace(/\s+/g, ' ').trim() || 'Planner Block';

    // Compute end time
    const startParts = startTimeStr.split(':').map(Number);
    const startMins = startParts[0] * 60 + startParts[1];
    const endMins = startMins + durationMins;
    const endH = Math.floor(endMins / 60) % 24;
    const endM = endMins % 60;
    const endTimeStr = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

    const eventId = 'evt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    const eventType = (typeof inferPlannerEventType === 'function')
      ? inferPlannerEventType(title, '')
      : (title.toLowerCase().includes('call') ? 'call' : 'work');
    const newEvent = {
      id: eventId,
      type: eventType,
      title: title,
      date: dateStr,
      startTime: startTimeStr,
      endTime: endTimeStr,
      noteId: ''
    };

    if (typeof plannerEvents === 'undefined' || !Array.isArray(plannerEvents)) {
      window.plannerEvents = [];
    }

    plannerEvents.push(newEvent);
    if (typeof savePlanner === 'function') await savePlanner();
    if (typeof renderPlanner === 'function') renderPlanner();
    if (typeof renderFilterChips === 'function') renderFilterChips();

    toast(t('omnibar.blockSuccess', { title, date: dateStr, time: startTimeStr }) || `Block scheduled: ${title} (${dateStr} ${startTimeStr})`);
  },

  async handleDecisionCommand(cmdStr) {
    const content = cmdStr.replace(/^\/\S+\s*/i, '').trim();
    if (!content) {
      toast(t('omnibar.decSyntax'), true);
      return;
    }

    let majorTopic = 'General';
    let decisionText = content;

    const bracketMatch = content.match(/^\[([^\]]+)\]\s*(.+)$/);
    const colonMatch = content.match(/^([\w-]+):\s*(.+)$/);

    if (bracketMatch) {
      majorTopic = bracketMatch[1].trim();
      decisionText = bracketMatch[2].trim();
    } else if (colonMatch) {
      majorTopic = colonMatch[1].trim();
      decisionText = colonMatch[2].trim();
    } else {
      const spaceIdx = content.indexOf(' ');
      if (spaceIdx !== -1) {
        const candidateTopic = content.substring(0, spaceIdx).trim();
        const allMajorTopics = typeof manifest !== 'undefined' && Array.isArray(manifest)
          ? Array.from(new Set(manifest.flatMap(n => n.major_topic_tags || []).filter(Boolean)))
          : [];
        const found = allMajorTopics.find(t => t.toLowerCase() === candidateTopic.toLowerCase());
        if (found) {
          majorTopic = found;
          decisionText = content.substring(spaceIdx + 1).trim();
        } else {
          majorTopic = candidateTopic;
          decisionText = content.substring(spaceIdx + 1).trim();
        }
      }
    }

    if (!decisionText) {
      decisionText = content;
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    let todayNote = typeof manifest !== 'undefined' && Array.isArray(manifest)
      ? manifest.find(n => n.date === todayStr && !n.id.startsWith('retro-'))
      : null;

    const decisionItemHtml = `<li><span class="note-decision-wrapper note-decision-draft" data-decision-status="active" data-decision-text="${escH(decisionText)}" contenteditable="false"><strong class="pill-decision pill-decision-active" contenteditable="false">!decision:active</strong> <span class="note-decision-text" contenteditable="true">${escH(decisionText)}</span></span></li>`;

    if (!todayNote) {
      const noteId = generateNoteId();
      const path = getCanonicalNotePath(noteId);
      const newNote = {
        id: noteId,
        path: path,
        title: `Notes du ${todayStr}`,
        date: todayStr,
        group_tags: ['Daily'],
        major_topic_tags: [majorTopic],
        topic_tags: (typeof OmnibarController !== 'undefined') ? OmnibarController.getMostUsedTagsForWorkstream(majorTopic) : [],
        extra_tags: [],
        workstream: majorTopic,
        mainHTML: `<ul>${decisionItemHtml}</ul>`
      };
      
      const html = buildNewNoteHTML(newNote);
      newNote.originalHTML = html;
      await StorageAPI.writeNoteContent(path, html);
      upsertManifest(newNote);
      await saveManifest({ force: true });
      await rebuildIndexHTML();
    } else {
      let html = await StorageAPI.readNoteContent(todayNote.path);
      const parsed = parseNoteHTML(html);
      let mainHTML = parsed.mainHTML || '';
      
      // Append list item to note body
      if (mainHTML.includes('</ul>')) {
        mainHTML = mainHTML.replace(/<\/ul>([^(<\/ul>)]*)$/, `${decisionItemHtml}</ul>$1`);
      } else {
        mainHTML += `\n<ul>${decisionItemHtml}</ul>`;
      }
      
      const changes = {
        title: todayNote.title || parsed.title,
        date: todayNote.date || parsed.date,
        group_tags: todayNote.group_tags || parsed.group_tags || [],
        major_topic_tags: todayNote.major_topic_tags ? Array.from(new Set([...todayNote.major_topic_tags, majorTopic])) : [majorTopic],
        topic_tags: Array.from(new Set([...(todayNote.topic_tags || parsed.topic_tags || []), ...(typeof OmnibarController !== 'undefined' ? OmnibarController.getMostUsedTagsForWorkstream(majorTopic) : [])])),
        extra_tags: todayNote.extra_tags || [],
        workstream: todayNote.workstream || majorTopic,
        mainHTML: mainHTML
      };
      
      const updatedHTML = applyNoteEdits(html, changes);
      await StorageAPI.writeNoteContent(todayNote.path, updatedHTML);
      Object.assign(todayNote, changes, { originalHTML: updatedHTML });
      upsertManifest(todayNote);
      await saveManifest({ force: true });
    }

    // Force rehydration of metadata buffer so decision is indexed
    if (typeof hydrateMetadataFromManifestIncremental === 'function') {
      await hydrateMetadataFromManifestIncremental({ chunkSize: 50 });
    }

    if (typeof renderBoard === 'function') renderBoard();
    toast(t('omnibar.decSuccess', { topic: majorTopic }));
  },

  async handleNoteCommand(cmdStr) {
    const content = cmdStr.replace(/^\/\S+\s*/i, '').trim();
    
    // If no content passed, immediately open the note overlay in creation mode
    if (!content) {
      if (typeof openNoteOverlay === 'function') {
        await openNoteOverlay(null);
        if (typeof enterOverlayEditMode === 'function') {
          enterOverlayEditMode();
        }
      }
      return;
    }

    let group = (typeof settings !== 'undefined' && settings && settings.defaultGroup) 
      ? settings.defaultGroup 
      : (typeof activeGroup !== 'undefined' && activeGroup && activeGroup !== '__ALL__' && activeGroup !== '__NONE__' ? activeGroup : 'Inbox');
    let title = content;

    const bracketMatch = content.match(/^\[([^\]]+)\]\s*(.+)$/);
    const colonMatch = content.match(/^([\w-]+):\s*(.+)$/);

    if (bracketMatch) {
      group = bracketMatch[1].trim();
      title = bracketMatch[2].trim();
    } else if (colonMatch) {
      group = colonMatch[1].trim();
      title = colonMatch[2].trim();
    } else {
      const spaceIdx = content.indexOf(' ');
      if (spaceIdx !== -1) {
        const firstWord = content.substring(0, spaceIdx).trim();
        const allGroups = typeof manifest !== 'undefined' && Array.isArray(manifest)
          ? Array.from(new Set(manifest.flatMap(n => n.group_tags || []).filter(Boolean)))
          : [];
        const found = allGroups.find(g => g.toLowerCase() === firstWord.toLowerCase());
        if (found) {
          group = found;
          title = content.substring(spaceIdx + 1).trim();
        }
      }
    }

    const noteId = generateNoteId();
    const path = getCanonicalNotePath(noteId);
    const todayStr = new Date().toISOString().slice(0, 10);
    const newNote = {
      id: noteId,
      path: path,
      title: title,
      date: todayStr,
      group_tags: [group],
      major_topic_tags: [],
      topic_tags: [],
      extra_tags: [],
      mainHTML: '<p></p>'
    };

    const html = buildNewNoteHTML(newNote);
    newNote.originalHTML = html;
    await StorageAPI.writeNoteContent(path, html);
    upsertManifest(newNote);
    await saveManifest({ force: true });
    await rebuildIndexHTML();

    if (typeof renderBoard === 'function') renderBoard();
    if (typeof renderFilterChips === 'function') renderFilterChips();
    
    // Open the note overlay directly for editing
    if (typeof openNoteOverlay === 'function') {
      await openNoteOverlay(path);
      if (typeof enterOverlayEditMode === 'function') {
        enterOverlayEditMode();
      }
    }

    toast(t('omnibar.noteSuccess', { title: title }));
  },

  async handleCallCommand(cmdStr) {
    const title = cmdStr.replace(/^\/\S+\s*/i, '').trim();
    if (typeof window.quickCreateCallAndOpenNote === 'function') {
      await window.quickCreateCallAndOpenNote(title);
    } else {
      toast('Planner module not available', true);
    }
  },

  async handleAdhocCommand(cmdStr) {
    const content = cmdStr.replace(/^\/\S+\s*/i, '').trim();
    const title = content.replace(/^call\b\s*/i, '').trim();
    if (typeof window.quickCreateCallAndOpenNote === 'function') {
      await window.quickCreateCallAndOpenNote(title);
    } else {
      toast('Planner module not available', true);
    }
  }
};

window.OmnibarController = OmnibarController;
OmnibarController.init();
