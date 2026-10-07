// ── Secretary: Focus / Lane Expanded View ──
function openLaneFocus(laneVal) {
  expandedLaneVal    = laneVal;
  focusModeFullScreen = false;
  focusSelectedPaths = null;   // reset → all selected
  focusNoteCache     = {};
  focusSaveTimers    = {};
  // Ensure both tag-bank drawer and notes list are collapsed when opening focus view
  focusNotesListCollapsed = true;
  focusDrawerOpen = false;
  focusDrawerMode = null;
  persistFocusPaneState();
  renderBoard();
  // Ensure the new focus view starts at the top, especially when opening from deep week lanes.
  setTimeout(() => {
    const main = document.getElementById('app-main');
    if (main) main.scrollTop = 0;
    const focusScroll = document.querySelector('#swimlane-board .fl-right');
    if (focusScroll) focusScroll.scrollTop = 0;
  }, 0);
  updateUrlHash();
}

function closeLaneFocus() {
  flushAllFocusTextareas();
  expandedLaneVal    = null;
  focusModeFullScreen = false;
  renderBoard();
  updateUrlHash();
}

function toggleFocusFullScreen() {
  focusModeFullScreen = !focusModeFullScreen;
  // Let the renderer update the UI consistently — avoid direct innerHTML manipulation
  renderBoard();
}

function persistFocusPaneState() {
  try {
    localStorage.setItem('secretaryFocusNotesListCollapsed', focusNotesListCollapsed ? '1' : '0');
    localStorage.setItem('secretaryFocusDrawerOpen', focusDrawerOpen ? '1' : '0');
    localStorage.setItem('secretaryFocusDrawerMode', focusDrawerMode || '');
  } catch (e) {}
}

function getFocusSidePaneMode() {
  if (focusDrawerOpen && focusDrawerMode === 'tags') return 'tags';
  if (!focusNotesListCollapsed) return 'notes';
  return null;
}

function openFocusSidePane(mode) {
  if (mode === 'notes') {
    focusNotesListCollapsed = false;
    focusDrawerOpen = false;
    focusDrawerMode = null;
  } else if (mode === 'tags') {
    focusNotesListCollapsed = true;
    focusDrawerOpen = true;
    focusDrawerMode = 'tags';
  }
  persistFocusPaneState();
  renderBoard();
}

function closeFocusSidePane() {
  focusNotesListCollapsed = true;
  focusDrawerOpen = false;
  focusDrawerMode = null;
  persistFocusPaneState();
  renderBoard();
}

/** Capture textarea values into cache before any re-render */
function flushAllFocusTextareas() {
  // No-op: inline editing removed from reading view; editing uses the overlay dialog
}

function getFocusLaneNotes(items, laneVal) {
  if (laneAxis === 'week') {
    const today = getStartOfDay();
    const cutoffDate = addDays(today, -weekCutoffWeeks * 7);
    return items.filter(n => {
      if (!n.date) return laneVal === '__older__';
      const d = parseLocalDateValue(n.date);
      if (!d || isNaN(d) || d < cutoffDate) return laneVal === '__older__';
      return getNoteWeekKey(n.date).key === laneVal;
    });
  }
  const field = laneAxis === 'group' ? 'group_tags' : 'major_topic_tags';
  return items.filter(n => ((n[field] || [])[0] || '(Untagged)') === laneVal);
}

function getFocusLaneTitle(laneVal) {
  if (laneAxis !== 'week') return laneVal;
  if (laneVal === '__older__') return t('board.olderNotesLane');
  if (!/^\d{4}-W\d{2}$/.test(String(laneVal || ''))) return laneVal;
  const today = getStartOfDay();
  const currentWeekKey = getNoteWeekKey(today).key;
  const lastWeekKey = getNoteWeekKey(addDays(today, -7)).key;
  return getWeekLaneLabel(laneVal, currentWeekKey, lastWeekKey);
}

function buildFocusNotesTreeHTML(laneNotes) {
  if (!laneNotes || !laneNotes.length) return `<span style="color:#aaa;font-size:.8rem;padding:.3rem .4rem">${escH(t('focus.noNotesInLane'))}</span>`;
  const groups = {};
  for (const n of laneNotes) {
    const g = ((n.group_tags||[])[0]) || '(Untagged)';
    const m = ((n.major_topic_tags||[])[0]) || '(Untagged)';
    const tt = ((n.topic_tags||[])[0]) || '(Untagged)';
    if (!groups[g]) groups[g] = {};
    if (!groups[g][m]) groups[g][m] = {};
    if (!groups[g][m][tt]) groups[g][m][tt] = [];
    groups[g][m][tt].push(n);
  }

  let html = '<div class="fl-tree-root">';
  for (const g of Object.keys(groups).sort((a,b)=>a.localeCompare(b))) {
    const groupNotesArr = Object.values(groups[g]).flatMap(m=>Object.values(m).flat());
    const groupCount = groupNotesArr.length;
    const gKey = 'group::' + g;
    const gOpen = focusTreeOpenNodes.has(gKey);
    html += `<div class="fl-tree-node fl-tree-node-group" data-type="group" data-value="${escA(g)}">
      <div class="fl-tree-header" data-type="group" data-value="${escA(g)}" oncontextmenu="return onLabelNavContextMenu(event, ${jq('group')}, ${jq(g)})">
        <button class="fl-tree-toggle" aria-expanded="${gOpen ? 'true' : 'false'}" title="${escA(t('focus.toggleSection'))}">▸</button>
        <span class="fl-tree-label" draggable="true" data-type="group" data-value="${escA(g)}">${escH(g)}</span>
        <button class="fl-tree-check" onclick="event.stopPropagation(); focusToggleTreeNode('group', ${jq(g)})" title="${escA(t('focus.toggleAllNotesNode'))}">☑</button>
        <span class="fl-tree-count">${groupCount}</span>
      </div>
      <div class="fl-tree-children ${gOpen ? '' : 'collapsed'}">`;
    for (const m of Object.keys(groups[g]).sort((a,b)=>a.localeCompare(b))) {
      const majorNotesArr = Object.values(groups[g][m]).flatMap(arr=>arr);
      const majorCount = majorNotesArr.length;
      const mKey = 'major::' + m;
      const mOpen = focusTreeOpenNodes.has(mKey);
      html += `<div class="fl-tree-node fl-tree-node-major" data-type="major" data-value="${escA(m)}">
        <div class="fl-tree-header" data-type="major" data-value="${escA(m)}" oncontextmenu="return onLabelNavContextMenu(event, ${jq('major')}, ${jq(m)})">
          <button class="fl-tree-toggle" aria-expanded="${mOpen ? 'true' : 'false'}" title="${escA(t('focus.toggleSection'))}">▸</button>
          <span class="fl-tree-label" draggable="true" data-type="major" data-value="${escA(m)}">${escH(m)}</span>
          <button class="fl-tree-check" onclick="event.stopPropagation(); focusToggleTreeNode('major', ${jq(m)})" title="${escA(t('focus.toggleAllNotesNode'))}">☑</button>
          <span class="fl-tree-count">${majorCount}</span>
        </div>
        <div class="fl-tree-children ${mOpen ? '' : 'collapsed'}">`;
      for (const tt of Object.keys(groups[g][m]).sort((a,b)=>a.localeCompare(b))) {
        const notes = groups[g][m][tt];
        const ttKey = 'topic::' + tt;
        const ttOpen = focusTreeOpenNodes.has(ttKey);
        html += `<div class="fl-tree-node fl-tree-node-topic" data-type="topic" data-value="${escA(tt)}">
          <div class="fl-tree-header" data-type="topic" data-value="${escA(tt)}" oncontextmenu="return onLabelNavContextMenu(event, ${jq('topic')}, ${jq(tt)})">
            <button class="fl-tree-toggle" aria-expanded="${ttOpen ? 'true' : 'false'}" title="${escA(t('focus.toggleSection'))}">▸</button>
            <span class="fl-tree-label" draggable="true" data-type="topic" data-value="${escA(tt)}">${escH(tt)}</span>
            <button class="fl-tree-check" onclick="event.stopPropagation(); focusToggleTreeNode('topic', ${jq(tt)})" title="${escA(t('focus.toggleAllNotesNode'))}">☑</button>
            <span class="fl-tree-count">${notes.length}</span>
          </div>
          <div class="fl-tree-children ${ttOpen ? '' : 'collapsed'}">`;
        for (const n of notes) {
          const checked = focusSelectedPaths ? focusSelectedPaths.has(n.path) : true;
          html += `<div class="fl-tree-leaf${checked ? ' checked' : ''}" data-path="${escA(n.path)}" onclick="focusNoteToggle(${jq(n.path)})" oncontextmenu="onNoteCardContextMenu(event, ${jq(n.path)})"><span class="fl-note-item-title">${escH(n.title || n.path.split('/').pop())}</span><span class="fl-note-item-date">${escH(n.date || '')}</span></div>`;
        }
        html += `</div></div>`;
      }
      html += `</div></div>`;
    }
    html += `</div></div>`;
  }
  html += '</div>';
  return html;
}

// Initialize dynamic event handlers for the rebuilt tree (single/double click, expand/collapse)
function initFocusTreeEvents() {
  const board = document.getElementById('swimlane-board');
  if (!board) return;
  board.querySelectorAll('.fl-tree-header').forEach(hdr => {
    const node = hdr.closest('.fl-tree-node');
    const type = hdr.dataset.type || (node && node.dataset.type);
    const value = hdr.dataset.value || (node && node.dataset.value);
    const key = type + '::' + value;

    // click / dblclick: expand/collapse or apply filter
    hdr.addEventListener('click', (e) => {
      e.stopPropagation();
      clearTimeout(focusTreeClickTimers[key]);
      focusTreeClickTimers[key] = setTimeout(() => {
        delete focusTreeClickTimers[key];
        const children = node.querySelector('.fl-tree-children');
        if (!children) return;
        const isCollapsed = children.classList.contains('collapsed');
        const toggleBtn = hdr.querySelector('.fl-tree-toggle');
        if (isCollapsed) {
          children.classList.remove('collapsed');
          if (toggleBtn) toggleBtn.setAttribute('aria-expanded','true');
          focusTreeOpenNodes.add(key);
        } else {
          children.classList.add('collapsed');
          if (toggleBtn) toggleBtn.setAttribute('aria-expanded','false');
          focusTreeOpenNodes.delete(key);
        }
      }, 260);
    });
    hdr.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      clearTimeout(focusTreeClickTimers[key]);
      focusApplyFilter(type, value);
    });

    // drag/drop from tag bank or other labels
    hdr.addEventListener('dragover', (e) => {
      if (!e.dataTransfer) return;
      const types = Array.from(e.dataTransfer.types || []);
      if (!types.includes('text/plain') && !types.includes('application/x-secretary-label')) return;
      e.preventDefault();
      hdr.classList.add('fl-drop-active');
      e.dataTransfer.dropEffect = 'copy';
    });
    hdr.addEventListener('dragleave', (e) => {
      hdr.classList.remove('fl-drop-active');
    });
    hdr.addEventListener('drop', async (e) => {
      e.preventDefault();
      hdr.classList.remove('fl-drop-active');
      try {
        // Label dragged from tree (move/merge) - custom mime
        if (e.dataTransfer.types.includes('application/x-secretary-label')) {
          const payload = JSON.parse(e.dataTransfer.getData('application/x-secretary-label'));
          if (payload && payload.type && payload.value) {
            // If same type, open label manager on target to allow edit / merge
            if (payload.type === type) {
              openLabelManager(type, value);
            } else {
              toast(t('common.cannotMoveBetweenTagTypes'));
            }
            return;
          }
        }
        // Tag chip dropped from tag bank (text/plain)
        if (e.dataTransfer.types.includes('text/plain')) {
          const { tag, tagType } = JSON.parse(e.dataTransfer.getData('text/plain'));
          await focusApplyTagToNode(type, value, tag, tagType);
          return;
        }
      } catch(err) {
        console.warn('Tree drop error', err);
        toast(t('common.couldNotAddTag'), true);
      }
    });
  });

  // make tree labels draggable (for label-to-label operations)
  board.querySelectorAll('.fl-tree-label[draggable="true"]').forEach(lbl => {
    lbl.addEventListener('dragstart', (e) => {
      const type = lbl.dataset.type || lbl.getAttribute('data-type');
      const value = lbl.dataset.value || lbl.getAttribute('data-value');
      e.dataTransfer.setData('application/x-secretary-label', JSON.stringify({ type, value }));
      e.dataTransfer.effectAllowed = 'move';
    });
  });

  // clicking a leaf should scroll corresponding note card into view
  board.querySelectorAll('.fl-tree-leaf').forEach(leaf => {
    leaf.addEventListener('click', (e) => {
      // Allow the existing onclick handler to toggle selection, then scroll after re-render
      setTimeout(() => {
        const path = leaf.dataset.path;
        if (!path) return;
        const card = document.querySelector(`.fl-note-card[data-path="${CSS.escape(path)}"]`);
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 80);
    });
  });
}

async function renderExpandedLaneView() {
  const board = document.getElementById('swimlane-board');
  if (!board) return;

  const laneVal = expandedLaneVal;

  // Build both the full and filtered item sets so the left tree remains visible
  const itemsFiltered = await getFilteredNotes();
  const itemsAll = await getAllNotes();

  const laneNotesFiltered = getFocusLaneNotes(itemsFiltered, laneVal)
    .slice().sort((a, b) => {
      const da = a.date || '';
      const db = b.date || '';
      if (db !== da) return db.localeCompare(da);
      return (a.title || '').localeCompare(b.title || '');
    });

  const laneNotesAll = getFocusLaneNotes(itemsAll, laneVal)
    .slice().sort((a, b) => {
      const da = a.date || '';
      const db = b.date || '';
      if (db !== da) return db.localeCompare(da);
      return (a.title || '').localeCompare(b.title || '');
    });

  // Init selection on first open — keep selection aligned with filtered set
  if (focusSelectedPaths === null) {
    focusSelectedPaths = new Set(laneNotesFiltered.map(n => n.path));
  }

  // ── Left panel: note list (flat and tree modes) built from full set
  const flatNoteListHTML = laneNotesAll.map(n => {
    const checked = focusSelectedPaths.has(n.path);
    return `<div class="fl-note-item${checked ? ' checked' : ''}" onclick="focusNoteToggle(${jq(n.path)})" title="${escA(t('focus.expandNotes'))}">
      <span class="fl-check">${checked ? '☑' : '☐'}</span>
      <span class="fl-note-item-title">${escH(n.title || n.path.split('/').pop())}</span>
      <span class="fl-note-item-date">${escH(n.date || '')}</span>
    </div>`;
  }).join('') || `<span style="color:#aaa;font-size:.8rem;padding:.3rem .4rem">${escH(t('focus.noNotesInLane'))}</span>`;

  const treeNoteListHTML = buildFocusNotesTreeHTML(laneNotesAll);
  const noteListHTML = (focusNotesTreeEnabled ? treeNoteListHTML : flatNoteListHTML);

  // ── Tag bank (right pane)
  const allGroups = [...new Set(manifest.flatMap(n => n.group_tags || []))].sort();
  const allMajors = [...new Set(manifest.flatMap(n => n.major_topic_tags || []))].sort();
  const allTopics = [...new Set(manifest.flatMap(n => n.topic_tags || []))].sort();
  const mkSection = (label, tags, type) => !tags.length ? '' :
    `<div class="fl-tagbank-section">
      <div class="fl-tagbank-label">${escH(label)}</div>
      <div class="fl-tagbank-chips">${tags.map(t =>
        `<span class="fl-tagbank-chip fl-tagbank-${type}" draggable="true" data-tag="${escA(t)}" data-tag-type="${escA(type)}">${escH(t)}</span>`
      ).join('')}</div>
    </div>`;
  const tagBankHTML = mkSection(t('week.group'), allGroups, 'group')
    + mkSection(t('week.major'), allMajors, 'major')
    + mkSection(t('week.topic'), allTopics, 'topic');
  const tagBankDrawerHTML = `<div class="fl-tagbank">${tagBankHTML || `<span style="color:#aaa;font-size:.8rem">${escH(t('board.noTagsYet'))}</span>`}</div>`;

  // Right notes panel HTML (moved to right)
  const sidePaneMode = getFocusSidePaneMode();
  const sidePaneHTML = sidePaneMode ? `<aside class="fl-sidepane">
      <div class="fl-sidepane-header">
        <div class="fl-sidepane-tabs" role="tablist" aria-label="${escA(t('focus.sidePane') || 'Side pane')}">
          <button class="fl-sidepane-tab${sidePaneMode === 'notes' ? ' active' : ''}" onclick="openFocusSidePane('notes')" title="${escA(t('focus.notes'))}" aria-selected="${sidePaneMode === 'notes' ? 'true' : 'false'}">🗂 ${escH(t('focus.notes'))} <span class="fl-notes-toggle-count">${laneNotesAll.length}</span></button>
          <button class="fl-sidepane-tab${sidePaneMode === 'tags' ? ' active' : ''}" onclick="openFocusSidePane('tags')" title="${escA(t('focus.tagBank'))}" aria-selected="${sidePaneMode === 'tags' ? 'true' : 'false'}">🏷️ ${escH(t('focus.tagBank'))}</button>
        </div>
        <button class="fl-toolbar-btn fl-pane-close" onclick="closeFocusSidePane()" aria-label="${escA(t('common.close'))}" title="${escA(t('common.close'))}">✕</button>
      </div>
      <div class="fl-sidepane-body mode-${sidePaneMode}">
        ${sidePaneMode === 'notes'
          ? `<div class="fl-note-list-shell"><div class="fl-note-list">${noteListHTML}</div></div>`
          : tagBankDrawerHTML}
      </div>
    </aside>` : '';

  // ── Note cards (filtered visible set)
  const visibleNotes = laneNotesFiltered.filter(n => focusSelectedPaths.has(n.path));
  const noteCardsHTML = visibleNotes.map(n => {
    const isCollapsed = focusCollapsedNotes.has(n.path);
    const groupTagSpans = (n.group_tags || []).map(t => `<span class="fl-note-tag fl-nt-group">${escH(t)}</span>`).join('');
    const majorTagSpans = (n.major_topic_tags || []).map(t => `<span class="fl-note-tag fl-nt-major">${escH(t)}</span>`).join('');
    const topicTagSpans = (n.topic_tags || []).map(t => {
      const tc = colorForGroup(t);
      return `<span class="fl-note-tag" style="background:${tc.bg};color:${tc.text}">${escH(t)}</span>`;
    }).join('');
    const tid = pathToId(n.path);
    const tagsHTML = [groupTagSpans, majorTagSpans, topicTagSpans].filter(Boolean).join('');

    // Get scheduled planner blocks
    const linkedBlocks = (typeof getPlannerEventsForNote === 'function' && n.id)
      ? getPlannerEventsForNote(n.id)
      : [];

    let blocksHTML = '';
    if (linkedBlocks.length > 0) {
      blocksHTML = `
        <div class="fl-note-planner-blocks" onclick="event.stopPropagation(); openNoteOverlay(${jq(n.path)}, null, null, false, null, { collapseMetadata: true, fromBloc: true })">
          ${linkedBlocks.map(ev => `
            <span class="sl-card-planner-chip sl-card-planner-chip-${ev.type}" title="${escA(ev.date)} ${ev.startTime}–${ev.endTime}">
              📅 ${ev.date} ${ev.startTime}${ev.type === 'prep' ? ' (prep)' : ''}${ev.recurrenceId ? ' (part of series)' : ''}
            </span>
          `).join('')}
        </div>
      `;
    }

    return `<div class="fl-note-card" data-path="${escA(n.path)}" oncontextmenu="onNoteCardContextMenu(event, ${jq(n.path)})">
      <div class="fl-note-header" onclick="toggleFocusNoteCard(event,${jq(n.path)})" ondblclick="event.stopPropagation();openNoteOverlayInEditMode(${jq(n.path)})" title="${escA(t('focus.clickToCollapseOrEdit'))}">
        <div class="fl-note-header-left">
          <div class="fl-note-title">${escH(n.title || n.path.split('/').pop())}</div>
          <div class="fl-note-date">${escH(n.date || '')}</div>
          ${blocksHTML}
        </div>
        ${tagsHTML ? `<div class="fl-note-tags-display fl-note-tags-area" data-path="${escA(n.path)}" onclick="event.stopPropagation()">${tagsHTML}</div>` : ''}
        <button class="fl-topbar-btn fl-note-open-btn" onclick="event.stopPropagation();openNoteOverlayInEditMode(${jq(n.path)})" title="${escA(t('focus.openInEditor'))}">${escH(t('editor.editNote'))}</button>
        <span class="fl-note-toggle-icon${isCollapsed ? ' collapsed' : ''}"></span>
      </div>
      <div class="fl-note-card-body"${isCollapsed ? ' style="display:none"' : ''} ondblclick="event.stopPropagation();openNoteOverlayInEditMode(${jq(n.path)})" title="${escA(t('focus.doubleClickToEdit'))}">
        <div class="fl-note-preview" id="${tid}-preview" data-path="${escA(n.path)}">
          <em style="color:#aaa;font-size:.8rem">${escH(t('focus.loading'))}</em>
        </div>
      </div>
    </div>`;
  }).join('') || `<div style="color:#9ca3af;padding:2rem;text-align:center;font-size:.85rem">${escH(t('focus.noNotesSelected'))}</div>`;

  const containerClass = `fl-container${focusModeFullScreen ? ' fl-fullscreen' : ''}${sidePaneMode ? ' pane-open' : ''}${sidePaneMode === 'tags' ? ' tags-open' : ''}${sidePaneMode === 'notes' ? ' notes-open' : ''}`;

  board.innerHTML = `
    <div class="${containerClass}">
      <div class="fl-topbar">
        <button class="fl-topbar-btn" onclick="closeLaneFocus()" title="${escA(t('focus.backToBoard'))}">${escH(t('focus.backToBoard'))}</button>
        <span class="fl-lane-name">📖 ${escH(getFocusLaneTitle(laneVal))}</span>
        <span class="fl-note-count-badge">${laneNotesAll.length} note${laneNotesAll.length !== 1 ? 's' : ''}</span>
        <span style="flex:1"></span>
        <button class="fl-topbar-btn" onclick="toggleFocusNotesList()" data-target="notes" title="${escA(t('focus.notes'))}">🗂 ${escH(t('focus.notes'))}</button>
        <button class="fl-topbar-btn" onclick="toggleFocusDrawer('tags')" data-target="tags" title="${escA(t('focus.tagBank'))}">🏷️ ${escH(t('focus.tagBank'))}</button>
        <button class="fl-topbar-btn fl-pip-btn" onclick="openFocusPipMode()" title="${escA(t('focus.popoutTooltip'))}">🪟 ${escH(t('focus.miniHud'))}</button>
        <button class="fl-topbar-btn fl-fs-btn" data-fs="1" onclick="toggleFocusFullScreen()" title="${focusModeFullScreen ? escA(t('focus.exitFullScreen')) : escA(t('focus.fullScreen'))}">${focusModeFullScreen ? '⤫' : '⤢'}</button>
      </div>
      <div class="fl-body">
        <div class="fl-right-main">
          <div class="fl-right">
            ${noteCardsHTML}
          </div>
        </div>
        ${sidePaneHTML}
      </div>
    </div>`;

  wireFocusPreviewTodoClicks();
  initFocusTreeEvents();

  // Wire up drag events
  board.querySelectorAll('.fl-tagbank-chip').forEach(chip => {
    chip.addEventListener('dragstart', focusTagDragStart);
  });
  board.querySelectorAll('.fl-note-tags-area').forEach(zone => {
    zone.addEventListener('dragover',  focusTagDropOver);
    zone.addEventListener('dragleave', focusTagDropLeave);
    zone.addEventListener('drop',      focusTagDrop);
  });
  // Extend drop region to full note card so users can drop tags anywhere on a card
  board.querySelectorAll('.fl-note-card').forEach(card => {
    card.addEventListener('dragover',  focusTagDropOver);
    card.addEventListener('dragleave', focusTagDropLeave);
    card.addEventListener('drop',      focusTagDrop);
  });

  // Load note content async
  await loadFocusNoteContents(visibleNotes);
  setTimeout(adjustTagButtonAnimation, 60);
}

async function loadFocusNoteContents(notes) {
  for (const n of notes) {
    const el = document.getElementById(pathToId(n.path) + '-preview');
    if (!el) continue;
    try {
      let mainHTML;
      let previewData;
      let summaryHTML = '';
      if (focusNoteCache[n.path]?.mainHTML != null) {
        mainHTML = focusNoteCache[n.path].mainHTML;
        summaryHTML = focusNoteCache[n.path].summaryHTML || '';
        previewData = focusNoteCache[n.path].previewData || extractNotePreviewData(mainHTML || '');
      } else {
        const rawHtml = await StorageAPI.readNoteContent(n.path);
        const parsed = parseNoteHTML(rawHtml);
        summaryHTML = parsed.summary || '';
        mainHTML = parsed.mainHTML || `<p><em style="color:#aaa">${escH(t('focus.emptyNote'))}</em></p>`;
        if (typeof resolveNoteImages === 'function') {
          mainHTML = await resolveNoteImages(mainHTML);
          if (summaryHTML) summaryHTML = await resolveNoteImages(summaryHTML);
        }
        previewData = extractNotePreviewData(mainHTML || '');
        focusNoteCache[n.path] = { html: rawHtml, mainHTML, summaryHTML, previewData };
      }
      notePreviewCache[n.path] = previewData || { text: '', highlights: [] };
      if (el.isConnected) {
        const highlightHTML = buildNoteHighlightSectionHTML(previewData?.highlights || [], { compact: false });
        const summaryBlock = summaryHTML ? `<div class="fl-note-summary" style="font-style:italic;color:var(--text);margin-bottom:0.75rem;padding:0.5rem 0.75rem;background:var(--card-bg-alt);border-left:3px solid var(--accent);border-radius:var(--radius-sm);">${summaryHTML}</div>` : '';
        el.innerHTML = `${summaryBlock}${highlightHTML}${mainHTML}`;
      }
    } catch(e) {
      if (el.isConnected) el.innerHTML = `<em style="color:#b91c1c;font-size:.8rem">${escH(t('focus.couldNotLoadNote'))}</em>`;
    }
  }
}

function wireFocusPreviewTodoClicks() {
  const board = document.getElementById('swimlane-board');
  if (!board || board.dataset.focusTodoClicksBound === '1') return;
  board.dataset.focusTodoClicksBound = '1';
  board.addEventListener('click', e => {
    const marker = e.target.closest('.note-todo[data-todo-id]');
    if (!marker || !marker.closest('.fl-note-preview')) return;
    const todoId = marker.getAttribute('data-todo-id');
    if (!todoId || typeof openTodoFromMarker !== 'function') return;
    e.preventDefault();
    e.stopPropagation();
    openTodoFromMarker(todoId);
  });
}

function adjustTagButtonAnimation() {
  const container = document.querySelector('#swimlane-board .fl-container');
  if (!container) return;
  const tagsBtn = container.querySelector('.fl-topbar-btn[data-target="tags"]');
  const notesBtn = container.querySelector('.fl-topbar-btn[data-target="notes"]');
  if (tagsBtn) tagsBtn.style.transform = '';
  if (notesBtn) notesBtn.style.transform = '';
}
function toggleFocusNotesList() {
  if (getFocusSidePaneMode() === 'notes') closeFocusSidePane();
  else openFocusSidePane('notes');
}

function toggleFocusDrawer(mode) {
  if (mode !== 'tags') {
    closeFocusSidePane();
    return;
  }
  if (getFocusSidePaneMode() === 'tags') closeFocusSidePane();
  else openFocusSidePane('tags');
}

let focusTreeClickTimers = {};
function focusTreeNodeClick(e, type, value) {
  e.stopPropagation();
  const key = type + '::' + value;
  clearTimeout(focusTreeClickTimers[key]);
  focusTreeClickTimers[key] = setTimeout(() => {
    delete focusTreeClickTimers[key];
    const summary = e.currentTarget;
    const details = summary.closest('details');
    if (details) details.open = !details.open;
  }, 260);
}
function focusTreeNodeDblClick(e, type, value) {
  e.stopPropagation();
  const key = type + '::' + value;
  clearTimeout(focusTreeClickTimers[key]);
  focusApplyFilter(type, value);
}
function focusApplyFilter(type, value) {
  if (!type) return;
  activeFilter = { type: type === 'group' ? 'group' : type === 'major' ? 'major' : 'topic', value };
  try { localStorage.setItem('secretaryActiveFilter', JSON.stringify(activeFilter)); } catch(e) {}
  toast(t('common.filterApplied', { value }));
  renderBoard();
}

async function focusToggleTreeNode(type, value) {
  if (!expandedLaneVal) return;
  const items = await getFilteredNotes();
  const laneNotes = getFocusLaneNotes(items, expandedLaneVal);
  if (focusSelectedPaths === null) focusSelectedPaths = new Set(laneNotes.map(n => n.path));
  const paths = laneNotes.filter(n => {
    if (type === 'group') return ((n.group_tags || [])[0] || '(Untagged)') === value;
    if (type === 'major') return ((n.major_topic_tags || [])[0] || '(Untagged)') === value;
    return ((n.topic_tags || [])[0] || '(Untagged)') === value;
  }).map(n => n.path);
  const allSelected = paths.length > 0 && paths.every(p => focusSelectedPaths.has(p));
  if (allSelected) {
    for (const p of paths) focusSelectedPaths.delete(p);
  } else {
    for (const p of paths) focusSelectedPaths.add(p);
  }
  renderBoard();
}

// ═══ Focus-view note card: toggle minimize ═══
function toggleFocusNoteCard(event, path) {
  event.stopPropagation();
  // Always clear any pending single-click timer first
  clearTimeout(cardClickTimers['fl-' + path]);
  delete cardClickTimers['fl-' + path];
  // For double-click, let ondblclick handle it — don't toggle collapse
  if (event.detail >= 2) return;
  // Single click: debounce so it won't fire if a second click follows
  cardClickTimers['fl-' + path] = setTimeout(() => {
    delete cardClickTimers['fl-' + path];
    const card = document.querySelector(`.fl-note-card[data-path="${CSS.escape(path)}"]`);
    if (!card) return;
    const body = card.querySelector('.fl-note-card-body');
    const icon = card.querySelector('.fl-note-toggle-icon');
    if (focusCollapsedNotes.has(path)) {
      focusCollapsedNotes.delete(path);
      if (body) body.classList.remove('collapsed');
      if (icon) icon.classList.remove('collapsed');
    } else {
      focusCollapsedNotes.add(path);
      if (body) body.classList.add('collapsed');
      if (icon) icon.classList.add('collapsed');
    }
  }, 260);
}

// ═══ Focus-view inline tag input ═══
function openFocusTagInput(event, path, type) {
  event.stopPropagation();
  const span = event.currentTarget;
  const row  = span.closest('.fl-note-tag-row');
  if (!row || row.querySelector('.sl-card-tag-input')) return;
  _showInlineTagInput(row, span, path, type);
}

// Recompute button animations on resize (bind once)
if (!window._secretary_focus_resize_bound) {
  window.addEventListener('resize', () => setTimeout(() => {
    if (document.getElementById('swimlane-board')?.querySelector('.fl-container')) adjustTagButtonAnimation();
  }, 80));
  window._secretary_focus_resize_bound = true;
}

// ═══ Board note card: single vs double click on header ═══
function handleCardHeaderClick(event, path) {
  event.stopPropagation();
  const header = event.currentTarget;
  if (event.detail >= 2) {
    clearTimeout(cardClickTimers[path]);
    delete cardClickTimers[path];
    openNoteOverlay(path);
    return;
  }
  clearTimeout(cardClickTimers[path]);
  cardClickTimers[path] = setTimeout(() => {
    delete cardClickTimers[path];
    const card = header.closest('.sl-card');
    if (!card) return;
    const body = card.querySelector('.sl-card-body');
    const icon = card.querySelector('.sl-card-toggle-icon');
    if (collapsedCards.has(path)) {
      collapsedCards.delete(path);
      if (body) body.style.display = '';
      if (icon) icon.classList.remove('collapsed');
    } else {
      collapsedCards.add(path);
      if (body) body.style.display = 'none';
      if (icon) icon.classList.add('collapsed');
    }
    try { localStorage.setItem('secretaryCollapsedCards', JSON.stringify([...collapsedCards])); } catch(e) {}
  }, 230);
}

function applyBoardCardPreviewData(card, previewAreaEl, data) {
  if (!card || !previewAreaEl) return;
  const path = card.dataset.path || previewAreaEl.dataset.path;
  const n = path ? getNoteByPath(path) : null;
  const highlightsContainer = previewAreaEl.querySelector('.sl-card-highlights-container');
  const previewTextEl = previewAreaEl.querySelector('.sl-card-preview-text');

  if (n && n.summary) {
    if (highlightsContainer) highlightsContainer.innerHTML = '';
    if (previewTextEl) {
      previewTextEl.innerHTML = n.summary;
      previewTextEl.style.fontStyle = 'italic';
      previewTextEl.style.color = 'var(--text)';
    }
    const plainTextSummary = typeof htmlToPlainText === 'function' ? htmlToPlainText(n.summary) : n.summary;
    card.title = plainTextSummary ? t('board.openNoteWithSummary', { summary: plainTextSummary }) : t('board.openNoteAction');
    return;
  }

  const hasHighlights = !!(data?.highlights && data.highlights.length);
  if (highlightsContainer) {
    highlightsContainer.innerHTML = hasHighlights ? buildNoteHighlightSectionHTML(data.highlights, { compact: true, showAll: false }) : '';
  }
  const previewFallback = data?.text || n?.preview || '';
  if (previewTextEl) {
    previewTextEl.innerHTML = previewFallback;
    previewTextEl.style.fontStyle = '';
    previewTextEl.style.color = '';
  }
  if (card) {
    const plainTextSummary = typeof htmlToPlainText === 'function' ? htmlToPlainText(previewFallback) : previewFallback;
    card.title = plainTextSummary ? t('board.openNoteWithSummary', { summary: plainTextSummary }) : t('board.openNoteAction');
  }
}

// ═══ Board note card: inline +tag ═══
function openCardTagInput(event, path, type) {
  event.stopPropagation();
  const btn = event.currentTarget;
  const row = btn.closest('.sl-card-tag-row');
  if (!row || row.querySelector('.sl-card-tag-input')) return;
  _showInlineTagInput(row, btn, path, type);
}

/** Shared helper: render an inline tag <input> with autocomplete before `refEl` inside `row`. */
function _showInlineTagInput(row, refEl, path, type) {
  const listId = 'sl-tag-list-' + type + '-' + Date.now();
  const list   = document.createElement('datalist');
  list.id      = listId;
  knownTagsForType(type).forEach(t => {
    const opt = document.createElement('option');
    opt.value = t;
    list.appendChild(opt);
  });
  const input = document.createElement('input');
  input.type      = 'text';
  input.className = 'sl-card-tag-input';
  input.placeholder = t('focus.addTagPlaceholder');
  input.setAttribute('list', listId);
  row.insertBefore(list, refEl);
  row.insertBefore(input, refEl);
  input.focus();
  const cleanup = () => {
    if (input.parentNode) input.remove();
    if (list.parentNode)  list.remove();
  };
  input.addEventListener('keydown', async e => {
    if (e.key === 'Enter') {
      const val = input.value.trim();
      cleanup();
      if (val) await addTagToNote(path, type, val);
    } else if (e.key === 'Escape') {
      cleanup();
    }
  });
  input.addEventListener('blur', () => setTimeout(cleanup, 200));
}

async function addTagToNote(path, type, tagValue) {
  try {
    const html   = await StorageAPI.readNoteContent(path);
    const parsed = parseNoteHTML(html);
    const field  = type === 'group' ? 'group_tags' : type === 'major' ? 'major_topic_tags' : 'topic_tags';
    const existing = parsed[field] || [];
    if (existing.includes(tagValue)) return;
    const changes = {
      title:            parsed.title || '',
      date:             manifest.find(m => m.path === path)?.date || '',
      group_tags:       [...(parsed.group_tags        || [])],
      major_topic_tags: [...(parsed.major_topic_tags  || [])],
      topic_tags:       [...(parsed.topic_tags        || [])],
      extra_tags:       [...(parsed.extra_tags        || [])],
      mainHTML:         parsed.mainHTML || '',
    };
    changes[field] = [...existing, tagValue];
    const updated = applyNoteEdits(html, changes);
    await StorageAPI.writeNoteContent(path, updated);
    const entry = manifest.find(m => m.path === path);
    if (entry) entry[field] = changes[field];
    await saveManifest();
    renderFilterChips();
    toast(t('common.tagAdded', { tag: tagValue }));
    renderBoard();
  } catch(e) {
    toast(t('common.couldNotSaveTag', { message: e.message }));
  }
}

// ═══ Lazy card-preview loading ═══
function initCardPreviews() {
  if (!('IntersectionObserver' in window)) return;
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const el   = entry.target;
      const path = el.dataset.path;
      if (!path) continue;
      observer.unobserve(el);
      const cached = lruGet(previewLRUCache, path, { hitScope: 'caches', hitKey: 'previewHits', missKey: 'previewMisses' }) || notePreviewCache[path];
      if (cached != null) {
        const data = typeof cached === 'object' ? cached : { text: cached || '', highlights: [] };
        const card = el.closest('.sl-card');
        applyBoardCardPreviewData(card, el, data);
      } else {
        loadCardPreview(path, el);
      }
    }
  }, { rootMargin: '400px 0px' });

  document.querySelectorAll('.sl-card-preview-area[data-path]').forEach(el => {
    const cached = lruGet(previewLRUCache, el.dataset.path, { hitScope: 'caches', hitKey: 'previewHits', missKey: 'previewMisses' }) || notePreviewCache[el.dataset.path];
    if (cached != null) {
      const data = typeof cached === 'object' ? cached : { text: cached || '', highlights: [] };
      const card = el.closest('.sl-card');
      applyBoardCardPreviewData(card, el, data);
    } else {
      observer.observe(el);
    }
  });
}

async function loadCardPreview(path, el) {
  try {
    const html   = await StorageAPI.readNoteContent(path);
    const parsed = parseNoteHTML(html);
    const data   = extractNotePreviewData(parsed.mainHTML || '');
    notePreviewCache[path] = data;
    lruSet(previewLRUCache, path, data, PREVIEW_LRU_LIMIT);
    if (el.isConnected) {
      const card = el.closest('.sl-card');
      applyBoardCardPreviewData(card, el, data);
    }
  } catch(e) {
    notePreviewCache[path] = { text: '', highlights: [] };
    lruSet(previewLRUCache, path, notePreviewCache[path], PREVIEW_LRU_LIMIT);
    if (el.isConnected) {
      const card = el.closest('.sl-card');
      applyBoardCardPreviewData(card, el, { text: '', highlights: [] });
    }
  }
}

function autoResizeFocusTextarea(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.max(80, ta.scrollHeight) + 'px';
}

function onFocusNoteInput(path) {
  const ta = document.getElementById(pathToId(path));
  if (ta) { autoResizeFocusTextarea(ta); if (focusNoteCache[path]) focusNoteCache[path].md = ta.value; }
  const ind = document.getElementById(pathToId(path) + '-save');
  if (ind) { ind.textContent = t('common.saveIndicatorSaving'); ind.className = 'fl-save-ind fl-si-saving'; }
  clearTimeout(focusSaveTimers[path]);
  focusSaveTimers[path] = setTimeout(() => saveFocusNote(path), 600);
}

async function saveFocusNote(path) {
  const ta  = document.getElementById(pathToId(path));
  const ind = document.getElementById(pathToId(path) + '-save');
  const cache = focusNoteCache[path];
  if (!cache) return;
  const md = ta ? ta.value : cache.md;
  const parsed = parseNoteHTML(cache.html);
  const entry  = manifest.find(m => m.path === path);
  const changes = {
    title:             parsed.title || entry?.title || '',
    date:              entry?.date || '',
    group_tags:        parsed.group_tags        || [],
    major_topic_tags:  parsed.major_topic_tags  || [],
    topic_tags:        parsed.topic_tags        || [],
    extra_tags:        parsed.extra_tags        || [],
    mainHTML:          ta ? ta.innerHTML : (parsed.mainHTML || ''),
  };
  try {
    const updated = applyNoteEdits(cache.html, changes);
    await StorageAPI.writeNoteContent(path, updated);
    cache.html = updated;
    if (entry) { entry.modified = new Date().toISOString(); }
    await saveManifest();
    if (ind) { ind.textContent = t('common.saveIndicatorSaved'); ind.className = 'fl-save-ind fl-si-saved'; }
    setTimeout(() => { const el = document.getElementById(pathToId(path) + '-save'); if (el) el.textContent = ''; }, 2000);
  } catch(e) {
    if (ind) { ind.textContent = t('common.saveIndicatorError'); ind.className = 'fl-save-ind fl-si-error'; }
  }
}

function insertFocusMd(path, type) {
  const ta = document.getElementById(pathToId(path));
  if (!ta) return;
  const s = ta.selectionStart, e = ta.selectionEnd;
  const sel = ta.value.slice(s, e);
  const pre = ta.value.slice(0, s), post = ta.value.slice(e);
  let ins = '';
  switch(type) {
    case 'bold':   ins = `**${sel || 'text'}**`; break;
    case 'italic': ins = `*${sel || 'text'}*`;   break;
    case 'h3':     ins = `\n### ${sel || 'Heading'}\n`; break;
    case 'ul':     ins = `\n- ${sel || 'item'}`;  break;
    case 'hr':     ins = `\n---\n`;               break;
  }
  ta.value = pre + ins + post;
  const cursor = pre.length + ins.length;
  ta.setSelectionRange(cursor, cursor);
  ta.focus();
  onFocusNoteInput(path);
}

async function focusNoteToggle(path) {
  if (focusSelectedPaths.has(path)) focusSelectedPaths.delete(path);
  else focusSelectedPaths.add(path);
  renderBoard();
}
// Tag bank DnD
function focusTagDragStart(e) {
  const chip = e.currentTarget;
  e.dataTransfer.setData('text/plain', JSON.stringify({ tag: chip.dataset.tag, tagType: chip.dataset.tagType }));
  e.dataTransfer.effectAllowed = 'copy';
}
function focusTagDropOver(e) {
  if (!e.dataTransfer.types.includes('text/plain')) return;
  e.preventDefault();
  e.currentTarget.classList.add('fl-drop-active');
  e.dataTransfer.dropEffect = 'copy';
}
function focusTagDropLeave(e) {
  e.currentTarget.classList.remove('fl-drop-active');
}
async function focusTagDrop(e) {
  e.preventDefault();
  let zone = e.currentTarget;
  zone.classList.remove('fl-drop-active');
  let path = zone.dataset.path;
  if (!path) {
    const card = zone.closest('.fl-note-card');
    if (card) { path = card.dataset.path; zone = card; }
  }
  if (!path) return;
  try {
    const { tag, tagType } = JSON.parse(e.dataTransfer.getData('text/plain'));
    // Ensure note is in cache
    if (!focusNoteCache[path]) {
      const html = await StorageAPI.readNoteContent(path);
      const mainHTML = parseNoteHTML(html).mainHTML || '';
      focusNoteCache[path] = { html, mainHTML };
    }
    const cache = focusNoteCache[path];
    const parsed = parseNoteHTML(cache.html);
    const entry  = manifest.find(m => m.path === path);
    const ta     = document.getElementById(pathToId(path));
    const changes = {
      title:            parsed.title || entry?.title || '',
      date:             entry?.date || '',
      group_tags:       [...(parsed.group_tags        || [])],
      major_topic_tags: [...(parsed.major_topic_tags  || [])],
      topic_tags:       [...(parsed.topic_tags        || [])],
      extra_tags:       [...(parsed.extra_tags        || [])],
      mainHTML:         ta ? ta.innerHTML : (parsed.mainHTML || ''),
    };
    if      (tagType === 'group'  && !changes.group_tags.includes(tag))       changes.group_tags.push(tag);
    else if (tagType === 'major'  && !changes.major_topic_tags.includes(tag)) changes.major_topic_tags.push(tag);
    else if (tagType === 'topic'  && !changes.topic_tags.includes(tag))       changes.topic_tags.push(tag);
    else { toast(t('common.tagAlreadySet', { tag })); return; }

    const updated = applyNoteEdits(cache.html, changes);
    await StorageAPI.writeNoteContent(path, updated);
    cache.html = updated;
    if (entry) { Object.assign(entry, { group_tags: changes.group_tags, major_topic_tags: changes.major_topic_tags, topic_tags: changes.topic_tags, modified: new Date().toISOString() }); }
    await saveManifest();
    toast(t('common.tagAdded', { tag }));

    // Patch just the tags area in the DOM (avoid full re-render)
    const cardEl = document.querySelector(`.fl-note-card[data-path="${CSS.escape(path)}"]`);
    if (cardEl) {
      const tagsArea = cardEl.querySelector('.fl-note-tags-display') || cardEl.querySelector('.fl-note-tags-area');
      if (tagsArea) {
        const tagSpans = [
          ...changes.group_tags.map(t =>       `<span class="fl-note-tag fl-nt-group">${escH(t)}</span>`),
          ...changes.major_topic_tags.map(t => `<span class="fl-note-tag fl-nt-major">${escH(t)}</span>`),
          ...changes.topic_tags.map(t =>       `<span class="fl-note-tag fl-nt-topic">${escH(t)}</span>`),
        ].join('');
        tagsArea.innerHTML = tagSpans + `<span class="fl-note-tag-drop">+ tag</span>`;
        tagsArea.addEventListener('dragover',  focusTagDropOver);
        tagsArea.addEventListener('dragleave', focusTagDropLeave);
        tagsArea.addEventListener('drop',      focusTagDrop);
      }
    }
  } catch(err) { console.warn('Focus tag drop error', err); toast(t('common.couldNotAddTag'), true); }
}

// Apply a tag (from the tag bank) to all notes under a given tree node (group/major/topic)
async function focusApplyTagToNode(targetType, targetValue, tagValue, tagType) {
  if (!expandedLaneVal) return;
  const items = await getAllNotes();
  const laneNotes = getFocusLaneNotes(items, expandedLaneVal);
  const paths = laneNotes.filter(n => {
    if (targetType === 'group') return ((n.group_tags || [])[0] || '(Untagged)') === targetValue;
    if (targetType === 'major') return ((n.major_topic_tags || [])[0] || '(Untagged)') === targetValue;
    return ((n.topic_tags || [])[0] || '(Untagged)') === targetValue;
  }).map(n => n.path);
  if (!paths.length) { toast(t('focus.noNotesInNode') || 'No notes found'); return; }
  let changed = 0;
  for (const path of paths) {
    try {
      const html = await StorageAPI.readNoteContent(path);
      const parsed = parseNoteHTML(html);
      const entry = manifest.find(m => m.path === path);
      const field = tagType === 'group' ? 'group_tags' : tagType === 'major' ? 'major_topic_tags' : 'topic_tags';
      const existing = parsed[field] || [];
      if (existing.includes(tagValue)) continue;
      const changes = {
        title: parsed.title || entry?.title || '',
        date: entry?.date || '',
        group_tags: [...(parsed.group_tags || [])],
        major_topic_tags: [...(parsed.major_topic_tags || [])],
        topic_tags: [...(parsed.topic_tags || [])],
        extra_tags: [...(parsed.extra_tags || [])],
        mainHTML: parsed.mainHTML || '',
      };
      if (field === 'group_tags') changes.group_tags.push(tagValue);
      else if (field === 'major_topic_tags') changes.major_topic_tags.push(tagValue);
      else changes.topic_tags.push(tagValue);
      const updated = applyNoteEdits(html, changes);
      await StorageAPI.writeNoteContent(path, updated);
      if (entry) { Object.assign(entry, { group_tags: changes.group_tags, major_topic_tags: changes.major_topic_tags, topic_tags: changes.topic_tags, modified: new Date().toISOString() }); }
      changed++;
    } catch(err) { console.warn('focusApplyTagToNode error', err); }
  }
  if (changed) {
    await saveManifest();
    toast(t('common.tagAdded', { tag: tagValue }));
    renderBoard();
  } else {
    toast(t('common.tagAlreadySet', { tag: tagValue }));
  }
}

// ── Focus Mode Mini PiP HUD Window Controller ──
let _pipTimerInterval = null;
let _pipSecondsRemaining = 25 * 60;
let _pipIsRunning = false;

function openFocusPipMode() {
  if (window.AppBridge?.focusWindow) {
    window.AppBridge.focusWindow.openPip();
  }
}

function renderFocusPipHud() {
  const hud = document.getElementById('focus-pip-hud');
  if (!hud) return;

  const titleEl = document.getElementById('focus-pip-hud-title');
  if (titleEl) titleEl.textContent = `⏱️ ${t('focus.session') || 'Focus Session'}`;

  const taskLabelEl = document.getElementById('focus-pip-task-label');
  if (taskLabelEl) {
    const activeTitle = (typeof currentFocusNote !== 'undefined' && currentFocusNote?.title)
      ? currentFocusNote.title
      : ((typeof activeFocusLaneVal !== 'undefined' && activeFocusLaneVal) ? getFocusLaneTitle(activeFocusLaneVal) : null);
    taskLabelEl.textContent = activeTitle || t('focus.deepWork') || 'Deep Work Focus';
  }

  const toggleBtn = document.getElementById('btn-pip-toggle-timer');
  if (toggleBtn) {
    toggleBtn.title = t('focus.pauseResume') || 'Pause or resume timer';
  }
  const closeBtn = document.getElementById('btn-pip-close');
  if (closeBtn) {
    closeBtn.title = t('focus.closeHud') || 'Close Mini HUD';
  }

  _pipIsRunning = true;
  _updateFocusPipDigits();
  if (!_pipTimerInterval) {
    _pipTimerInterval = setInterval(() => {
      if (_pipIsRunning && _pipSecondsRemaining > 0) {
        _pipSecondsRemaining--;
        _updateFocusPipDigits();
        if (_pipSecondsRemaining === 0) {
          _pipIsRunning = false;
          _triggerFocusCelebration();
        }
      }
    }, 1000);
  }

  window.addEventListener('beforeunload', () => {
    if (_pipTimerInterval) {
      clearInterval(_pipTimerInterval);
      _pipTimerInterval = null;
    }
  }, { once: true });
}

function _updateFocusPipDigits() {
  const digitsEl = document.getElementById('focus-pip-digits');
  if (!digitsEl) return;
  const mins = Math.floor(_pipSecondsRemaining / 60);
  const secs = _pipSecondsRemaining % 60;
  digitsEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function toggleFocusPipTimer() {
  _pipIsRunning = !_pipIsRunning;
  const btn = document.getElementById('btn-pip-toggle-timer');
  if (btn) btn.textContent = _pipIsRunning ? '⏸' : '▶';
}

function closeFocusPipWindow() {
  if (_pipTimerInterval) {
    clearInterval(_pipTimerInterval);
    _pipTimerInterval = null;
  }
  if (window.AppBridge?.windowControls?.close) {
    window.AppBridge.windowControls.close();
  } else {
    window.close();
  }
}

function _triggerFocusCelebration() {
  const digitsEl = document.getElementById('focus-pip-digits');
  if (digitsEl) {
    digitsEl.style.color = '#10b981';
  }

  if (window.AppBridge?.notifications?.show) {
    window.AppBridge.notifications.show('Secretary', {
      body: typeof t === 'function' ? (t('focus.completedNotification') || 'Focus session complete! Take a break.') : 'Focus session complete! Take a break.'
    });
  }

  const hud = document.getElementById('focus-pip-hud');
  if (hud) {
    const burst = document.createElement('div');
    burst.className = 'focus-celebration-burst';
    const celebrationText = (typeof t === 'function' ? t('focus.cycleComplete') : null) || 'Cycle Complete!';
    burst.innerHTML = `🎉 <span style="font-weight:bold;margin-left:4px;">${escH(celebrationText)}</span>`;
    hud.appendChild(burst);
    setTimeout(() => burst.remove(), 2000);
  }
}

