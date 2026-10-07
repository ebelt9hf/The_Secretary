// ── Secretary: Notes Board ──
// ═══ Notes Board DnD ═══

let _draggingFromLane = null; // set on dragstart, used to block same-lane hover

function attachNotesBoardDnD() {
  // Drag events on the handle only — card itself is not draggable so dblclick works normally
  document.querySelectorAll('#swimlane-board .sl-card-drag-handle').forEach(handle => {
    handle.addEventListener('dragstart', noteBoardDragStart);
    handle.addEventListener('dragend',   noteBoardDragEnd);
  });
  document.querySelectorAll('#swimlane-board .sl-cards[data-lane-val]').forEach(lane => {
    lane.addEventListener('dragover',  noteBoardLaneDragOver);
    lane.addEventListener('dragleave', noteBoardLaneDragLeave);
    lane.addEventListener('drop',      noteBoardLaneDrop);
  });
}

function noteBoardDragStart(e) {
  const card = e.currentTarget.closest('.sl-card');
  _draggingFromLane = card.dataset.laneVal;
  e.dataTransfer.setData('text/plain', JSON.stringify({
    path:    card.dataset.path,
    laneVal: card.dataset.laneVal
  }));
  e.dataTransfer.effectAllowed = 'copyMove';
  card.classList.add('note-dragging');
}

function noteBoardDragEnd(e) {
  _draggingFromLane = null;
  const card = e.currentTarget.closest('.sl-card');
  if (card) card.classList.remove('note-dragging');
  document.querySelectorAll('.sl-cards.note-drag-over').forEach(el => el.classList.remove('note-drag-over'));
}

// ─── Event delegation: board-level click listener (one-time setup) ────────────
let _boardInteractionsReady = false;
function setupBoardInteractions() {
  const board = document.getElementById('swimlane-board');
  if (typeof initNotesScrollIndicator === 'function') {
    initNotesScrollIndicator();
  }
  if (!board || _boardInteractionsReady) return;
  _boardInteractionsReady = true;
}

// Right-click context menu on note cards — offers quick actions (edit/open/create/copy/delete)
function onNoteCardContextMenu(e, path) {
  try {
    e.preventDefault();
    document.querySelectorAll('.note-card-context-menu, .label-nav-context-menu').forEach(el => el.remove());
    const menu = document.createElement('div');
    menu.id = 'note-card-context-menu';
    menu.className = 'note-card-context-menu';
    menu.style.position = 'absolute';
    menu.style.top = (e.pageY) + 'px';
    menu.style.left = (e.pageX) + 'px';
    menu.style.zIndex = 4000;
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    const clampedX = Math.max(12, Math.min(e.pageX, window.innerWidth + window.scrollX - rect.width - 12));
    const clampedY = Math.max(12, Math.min(e.pageY, window.innerHeight + window.scrollY - rect.height - 12));
    menu.style.left = `${clampedX}px`;
    menu.style.top = `${clampedY}px`;
    // Build buttons with listeners so path is captured safely
    const makeBtn = (text, tooltip, fn) => { const b = document.createElement('button'); b.className = 'ctx-btn'; b.innerHTML = text; b.title = tooltip; b.addEventListener('click', async (ev) => { ev.stopPropagation(); try { await fn(); } catch(err) { console.warn(err); } menu.remove(); }); return b; };
    menu.appendChild(makeBtn(btnLabel('✏️', 'editor.editNote', 'Edit Note'), t('editor.editNoteTooltip'), async () => openNoteOverlayInEditMode(path)));
    menu.appendChild(makeBtn(btnLabel('📝', 'board.openNote', 'Open Note'), t('board.openNoteTooltip'), async () => openNoteOverlay(path)));
    menu.appendChild(makeBtn(btnLabel('⧉', 'board.openInNewWindow', 'Open in New Window'), t('editor.openInNewWindowTooltip'), async () => openNoteOverlay(path, null, null, false, null, { openInNewWindow: true })));
    menu.appendChild(makeBtn(btnLabel('📝', 'board.newNoteFromThis', 'New Note from This'), t('board.newNoteFromThisTooltip'), async () => createNewNoteFromNote(path)));
    menu.appendChild(makeBtn(btnLabel('📋', 'board.copyTags', 'Copy Tags'), t('board.copyTagsTooltip'), async () => copyNoteTagsToClipboard(path)));
    menu.appendChild(makeBtn(btnLabel('🗑️', 'editor.deleteNote', 'Delete Note'), t('editor.deleteNoteTooltip'), async () => deleteNoteFromCard(path)));
    setTimeout(() => {
      const closer = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', closer); } };
      document.addEventListener('click', closer);
    }, 0);
  } catch (e) { console.warn('Context menu failed', e); }
}

function onNoteCardClick(e, path) {
  if (!e || e.defaultPrevented) return;
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    e.stopPropagation();
    openNoteOverlay(path, null, null, false, null, { openInNewWindow: true });
  }
}

function onNoteCardAuxClick(e, path) {
  if (e && e.button === 1) {
    e.preventDefault();
    e.stopPropagation();
    openNoteOverlay(path, null, null, false, null, { openInNewWindow: true });
  }
}

function onLabelNavContextMenu(e, type, label) {
  try {
    e.preventDefault();
    if (!label || label === '(Untagged)' || type === 'week') return false;
    document.querySelectorAll('.note-card-context-menu, .label-nav-context-menu').forEach(el => el.remove());
    const typeTitle = getLabelTypeTitle(type);
    const menu = document.createElement('div');
    menu.id = 'label-nav-context-menu';
    menu.className = 'note-card-context-menu label-nav-context-menu';
    menu.style.position = 'absolute';
    menu.style.top = (e.pageY) + 'px';
    menu.style.left = (e.pageX) + 'px';
    menu.style.zIndex = 2000;
    const makeBtn = (text, tooltip, fn) => {
      const b = document.createElement('button');
      b.className = 'ctx-btn';
      b.innerHTML = text;
      b.title = tooltip;
      b.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        try { await fn(); } catch (err) { console.warn(err); }
        menu.remove();
      });
      return b;
    };
    menu.appendChild(makeBtn(`${btnLabel('✏️', 'board.editLabel', 'Edit Label')}: ${escH(label)}`, t('board.editLabelTooltip', { value: label }), async () => openLabelManager(type, label)));
    document.body.appendChild(menu);
    setTimeout(() => {
      const closer = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', closer); } };
      document.addEventListener('click', closer);
    }, 0);
    return false;
  } catch (err) {
    console.warn('Label context menu failed', err);
    return false;
  }
}

// Delete a note by path with confirmation dialog (no delayed delete/undo)
async function deleteNoteFromCard(path) {
  try {
    const meta = (typeof getNoteByPath === 'function' ? getNoteByPath(path) : null)
      || (manifest && manifest.find(m => m && (m.path === path || m.path?.replace(/\\/g, '/') === String(path).replace(/\\/g, '/'))));
    if (!meta) return;
    const name = meta.title || path.split(/[\/\\]/).pop();
    const confirmed = await showConfirmDialog(t('confirm.deleteNote', { name }), { isDanger: true, confirmLabel: t('common.delete') || 'Delete' });
    if (!confirmed) return;

    // Move to Trash
    const deletedNoteId = meta.id || null;
    const targetPath = meta.path || String(path).replace(/\\/g, '/');
    await StorageAPI.moveToTrash(targetPath, { title: meta.title });
    const idx = manifest.findIndex(m => m && (m.path === targetPath || m.path === path || m.id === meta.id));
    if (idx >= 0) manifest.splice(idx, 1);
    await saveManifest();

    // Close overlay if open for this note
    try {
      const curP = currentNote?.path ? currentNote.path.replace(/\\/g, '/') : null;
      if (curP && (curP === targetPath || currentNote?.id === meta.id)) {
        await closeNoteOverlay();
        currentNote = null;
      }
    } catch(e) {}

    broadcastSync({ type: 'NOTE_DELETED', noteId: deletedNoteId, path: targetPath });
    toast(t('trash.noteMovedToTrash') || t('common.noteDeleted'));
    renderBoard();
  } catch (e) { toast(t('common.deleteFailed', { message: e.message }), true); }
}

async function createNewNoteFromNote(path) {
  try {
    const html = await StorageAPI.readNoteContent(path);
    const parsed = parseNoteHTML(html);
    const grp = parsed.group_tags && parsed.group_tags[0] ? parsed.group_tags[0] : null;
    const maj = parsed.major_topic_tags && parsed.major_topic_tags[0] ? parsed.major_topic_tags[0] : null;
    await openNoteOverlay(null, grp, maj);
    // populate topic + extra tags
    try { populateTagEditor('editor-topic', parsed.topic_tags || [], 'topic'); } catch(e) {}
    try { populateTagEditor('editor-extra', parsed.extra_tags || [], 'extra'); } catch(e) {}
    const editTitleEl = document.getElementById('edit-title');
    if (editTitleEl) editTitleEl.value = t('common.copyOf', { value: parsed.title || t('common.untitledNote') });
    const ta = document.getElementById('edit-textarea');
    if (ta) {
      if (ta.contentEditable === 'true') ta.innerHTML = '<p><br></p>';
      else ta.value = '';
    }
    updateTitleRenameHint(); syncPreview();
  } catch (e) { toast(t('common.couldNotCreateNote', { message: e.message }), true); }
}

async function copyNoteTagsToClipboard(path) {
  try {
    const html = await StorageAPI.readNoteContent(path);
    const parsed = parseNoteHTML(html);
    const parts = [];
    if ((parsed.group_tags||[]).length) parts.push(`${t('axis.groups')}: ` + parsed.group_tags.join(', '));
    if ((parsed.major_topic_tags||[]).length) parts.push(`${t('week.major')}: ` + parsed.major_topic_tags.join(', '));
    if ((parsed.topic_tags||[]).length) parts.push(`${t('axis.topics')}: ` + parsed.topic_tags.join(', '));
    if ((parsed.extra_tags||[]).length) parts.push(`${t('editor.extra')}: ` + parsed.extra_tags.join(', '));
    const txt = parts.join(' | ') || '';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(txt);
      toast(t('common.copyTagsSuccess'));
    } else {
      await showPromptDialog(t('prompt.copyTags'), txt);
    }
  } catch (e) { toast(t('common.copyFailed', { message: e.message }), true); }
}

// Duplicate definition removed — the undo-capable deleteNoteFromCard above is the only implementation.

// ═══ Trash Bin UI Handlers ═══
async function openTrashBinModal() {
  await renderTrashBinList();
  openModal('modal-trash-bin');
}
window.openTrashBinModal = openTrashBinModal;

async function renderTrashBinList() {
  const container = document.getElementById('trash-bin-list');
  const emptyHint = document.getElementById('trash-bin-empty-hint');
  const emptyBtn = document.getElementById('btn-empty-trash');
  if (!container) return;

  container.innerHTML = '';
  const list = await StorageAPI.listTrash();

  if (!list || list.length === 0) {
    if (emptyHint) emptyHint.style.display = 'block';
    if (emptyBtn) emptyBtn.style.display = 'none';
    return;
  }

  if (emptyHint) emptyHint.style.display = 'none';
  if (emptyBtn) emptyBtn.style.display = '';

  list.forEach(item => {
    const card = document.createElement('div');
    card.style.display = 'flex';
    card.style.justifyContent = 'space-between';
    card.style.alignItems = 'center';
    card.style.padding = '8px 12px';
    card.style.borderRadius = '6px';
    card.style.background = 'var(--card-bg-alt)';
    card.style.border = '1px solid var(--card-border)';

    const info = document.createElement('div');
    info.style.display = 'flex';
    info.style.flexDirection = 'column';
    info.style.gap = '2px';
    info.style.overflow = 'hidden';

    const title = document.createElement('span');
    title.style.fontWeight = '600';
    title.style.fontSize = '0.9rem';
    title.style.color = 'var(--text)';
    title.textContent = item.title || item.filename;

    const date = document.createElement('span');
    date.style.fontSize = '0.75rem';
    date.style.color = 'var(--text-muted)';
    const dateStr = item.deletedAt ? new Date(item.deletedAt).toLocaleDateString() : '';
    date.textContent = `${t('trash.deletedOn') || 'Deleted'}: ${dateStr} • ${item.originalPath || item.filename}`;

    info.appendChild(title);
    info.appendChild(date);

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '6px';
    actions.style.flexShrink = '0';

    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'btn btn-secondary btn-sm';
    restoreBtn.title = t('trash.restoreTooltip') || 'Restore this note';
    restoreBtn.textContent = t('trash.restore') || 'Restore';
    restoreBtn.onclick = async () => {
      await restoreNoteFromTrashUI(item.filename);
    };

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-danger btn-sm';
    deleteBtn.title = t('trash.deletePermanentTooltip') || 'Delete permanently';
    deleteBtn.textContent = t('trash.deletePermanent') || 'Delete';
    deleteBtn.onclick = async () => {
      await permanentDeleteTrashUI(item.filename);
    };

    actions.appendChild(restoreBtn);
    actions.appendChild(deleteBtn);

    card.appendChild(info);
    card.appendChild(actions);
    container.appendChild(card);
  });
}
window.renderTrashBinList = renderTrashBinList;

async function restoreNoteFromTrashUI(filename) {
  try {
    await StorageAPI.restoreFromTrash(filename);
    await rebuildAll();
    await renderTrashBinList();
    toast(t('trash.noteRestored') || 'Note restored successfully!');
    renderBoard();
  } catch (err) {
    toast(t('common.saveFailed', { message: err.message }), true);
  }
}
window.restoreNoteFromTrashUI = restoreNoteFromTrashUI;

async function permanentDeleteTrashUI(filename) {
  const confirmed = await showConfirmDialog(t('confirm.permanentDelete') || 'Permanently delete this note? This action cannot be undone.', { isDanger: true });
  if (!confirmed) return;
  try {
    await StorageAPI.permanentDeleteFromTrash(filename);
    await renderTrashBinList();
    toast(t('trash.permanentlyDeleted') || 'Note permanently deleted.');
  } catch (err) {
    toast(err.message, true);
  }
}
window.permanentDeleteTrashUI = permanentDeleteTrashUI;

async function emptyTrashFromUI() {
  const confirmed = await showConfirmDialog(t('confirm.emptyTrash') || 'Permanently empty the entire trash bin? This action cannot be undone.', { isDanger: true });
  if (!confirmed) return;
  try {
    await StorageAPI.emptyTrash();
    await renderTrashBinList();
    toast(t('trash.trashEmptied') || 'Trash emptied.');
  } catch (err) {
    toast(err.message, true);
  }
}
window.emptyTrashFromUI = emptyTrashFromUI;

function noteBoardLaneDragOver(e) {
  if (!e.dataTransfer.types.includes('text/plain')) return;
  if (e.currentTarget.dataset.laneVal === _draggingFromLane) return; // same lane — no highlight, no drop
  e.preventDefault();
  e.currentTarget.classList.add('note-drag-over');
  e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move';
}

function noteBoardLaneDragLeave(e) {
  e.currentTarget.classList.remove('note-drag-over');
}

async function noteBoardLaneDrop(e) {
  e.preventDefault();
  const lane = e.currentTarget;
  lane.classList.remove('note-drag-over');
  try {
    const data = JSON.parse(e.dataTransfer.getData('text/plain'));
    const { path, laneVal: fromVal } = data;
    const toVal = lane.dataset.laneVal;
    if (!toVal || toVal === fromVal) return;
    await retagNoteForLane(path, fromVal, toVal, e.ctrlKey);
  } catch(err) { console.warn('Note drop error', err); }
}

/**
 * Update a note's lane tag (group or major, based on laneAxis).
 * addOnly=true (Ctrl): adds toVal without removing fromVal.
 * addOnly=false: replaces fromVal with toVal.
 */
async function retagNoteForLane(path, fromVal, toVal, addOnly) {
  const entry = (typeof getNoteByPath === 'function' ? getNoteByPath(path) : null)
    || (manifest && manifest.find(m => m && (m.path === path || m.path?.replace(/\\/g, '/') === String(path).replace(/\\/g, '/'))));
  if (!entry) return;
  const targetPath = entry.path || String(path).replace(/\\/g, '/');
  let html;
  try { html = await StorageAPI.readNoteContent(targetPath); }
  catch(e) { toast(t('common.couldNotReadNote'), true); return; }

  const parsed = parseNoteHTML(html);
  const field = laneAxis === 'group' ? 'group_tags' : 'major_topic_tags';
  let tags = [...(parsed[field] || [])];

  if (addOnly) {
    if (toVal !== '(Untagged)' && !tags.includes(toVal)) tags.push(toVal);
    else return; // nothing to do
  } else {
    tags = tags.filter(t => t !== fromVal);
    if (toVal !== '(Untagged)' && !tags.includes(toVal)) tags.push(toVal);
  }

  const changes = {
    title:             parsed.title || entry.title,
    date:              entry.date || '',
    group_tags:        field === 'group_tags'        ? tags : (parsed.group_tags || []),
    major_topic_tags:  field === 'major_topic_tags'  ? tags : (parsed.major_topic_tags || []),
    topic_tags:        parsed.topic_tags || [],
    extra_tags:        parsed.extra_tags || [],
    mainHTML:          parsed.mainHTML || '',
  };

  const updatedHTML = applyNoteEdits(html, changes);
  await StorageAPI.writeNoteContent(path, updatedHTML);
  Object.assign(entry, {
    group_tags:       changes.group_tags,
    major_topic_tags: changes.major_topic_tags,
    modified:         new Date().toISOString(),
  });
  await saveManifest();
  toast(addOnly ? t('common.tagAdded', { tag: toVal }) : t('board.movedTo', { value: toVal }));
  renderBoard();
}
function renderGroupFilterChips() { /* groups rendered in the right filter panel via renderFilterChips() */ }

function clearGroupFilter() {
  activeGroup = 'All';
  renderBoard();
}

function renderHierarchicalNotes() { /* removed — replaced by renderBoard() */ }

// ─── ISO-week helper ───────────────────────────────────────────────────────
function getNoteWeekKey(dateStr) {
  if (!dateStr) return { key: '0000-W00', label: t('week.unknown') };
  const d = parseLocalDateValue(dateStr);
  if (!d || isNaN(d)) return { key: '0000-W00', label: t('week.unknown') };
  // Monday of the week
  const daysFromMon = (d.getDay() + 6) % 7;
  const monday = new Date(d); monday.setDate(d.getDate() - daysFromMon);
  // ISO week & year (based on Thursday)
  const thu = new Date(monday); thu.setDate(monday.getDate() + 3);
  const jan4 = new Date(thu.getFullYear(), 0, 4);
  const jan4Mon = new Date(jan4); jan4Mon.setDate(jan4.getDate() - (jan4.getDay() + 6) % 7);
  const weekNum = Math.round((monday - jan4Mon) / (7 * 86400000)) + 1;
  const isoYear = thu.getFullYear();
  const monthName = formatMonthShort(monday);
  const year = monday.getFullYear();
  return {
    key: `${isoYear}-W${String(weekNum).padStart(2,'0')}`,
    label: `W${weekNum} – ${monthName} ${year}`
  };
}

// ─── Week axis helpers ────────────────────────────────────────────────────────
function getWeekLaneColor(index, total) {
  // Gradient: newest = green (hue 140) → oldest = amber/red (hue 30)
  const isDark = document.body && document.body.getAttribute('data-theme') === 'dark';
  if (total <= 1) {
    return isDark
      ? { bg: 'hsl(140,40%,18%)', text: 'hsl(140,85%,75%)' }
      : { bg: 'hsl(140,55%,94%)', text: 'hsl(140,45%,28%)' };
  }
  const hue = Math.round(140 - (index / (total - 1)) * 110);
  if (isDark) {
    return { bg: `hsl(${hue},40%,18%)`, text: `hsl(${hue},85%,75%)` };
  }
  return { bg: `hsl(${hue},55%,94%)`, text: `hsl(${hue},45%,28%)` };
}

function getWeekLaneLabel(isoKey, currentWeekKey, lastWeekKey) {
  if (isoKey === '__older__') return t('board.olderNotesLane');
  const [yearStr, wPart] = isoKey.split('-W');
  const weekNum = parseInt(wPart, 10);
  const year    = parseInt(yearStr, 10);
  // Compute Monday of the given ISO week
  const jan4    = new Date(year, 0, 4);
  const jan4Mon = new Date(jan4);
  jan4Mon.setDate(jan4.getDate() - (jan4.getDay() + 6) % 7);
  const monday  = new Date(jan4Mon);
  monday.setDate(jan4Mon.getDate() + (weekNum - 1) * 7);
  const monthName  = formatMonthShort(monday);
  const thisYear   = new Date().getFullYear();
  const yearSuffix = year !== thisYear ? ` ${year}` : '';
  let label = `W${weekNum} – ${monthName}${yearSuffix}`;
  if (isoKey === currentWeekKey)   label += ` · ${t('board.currentWeek')}`;
  else if (isoKey === lastWeekKey) label += ` · ${t('board.lastWeek')}`;
  return label;
}

const _DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function getNoteSubGroupKey(n) {
  switch (weekSubGrouping) {
    case 'day': {
      if (!n.date) return '7'; // unknown → sort to end
      const d = new Date(n.date);
      if (isNaN(d)) return '7';
      return String((d.getDay() + 6) % 7); // Mon=0 … Sun=6, unknown=7
    }
    case 'group': return (n.group_tags         && n.group_tags[0])         || '(Untagged)';
    case 'major': return (n.major_topic_tags   && n.major_topic_tags[0])   || '(Untagged)';
    case 'topic': return (n.topic_tags         && n.topic_tags[0])         || '(Untagged)';
    default:      return '?';
  }
}

function getNoteSubGroupLabel(key) {
  if (weekSubGrouping === 'day') {
    const idx = parseInt(key, 10);
    return isNaN(idx) ? t('week.unknown') : getDayName(idx);
  }
  return key;
}

// ─── Week-axis lane rendering ─────────────────────────────────────────────────
function renderWeekLaneHTML(laneKey, laneLabel, laneNotes, color) {
  const isCollapsed = collapsedLanes.has(laneKey);
  const isMax       = maximizedLanes.has(laneKey);

  // Sub-group notes by the selected weekSubGrouping
  const subGroupMap   = new Map();
  const subGroupOrder = [];
  const sorted = laneNotes.slice().sort((a, b) => (b.date || '') > (a.date || '') ? 1 : -1);
  const currentLimit = laneLimits[laneKey] || 30;
  const sliced = sorted.slice(0, currentLimit);
  for (const n of sliced) {
    const subKey = getNoteSubGroupKey(n);
    if (!subGroupMap.has(subKey)) { subGroupMap.set(subKey, []); subGroupOrder.push(subKey); }
    subGroupMap.get(subKey).push(n);
  }
  if (weekSubGrouping === 'day') {
    subGroupOrder.sort((a, b) => parseInt(a) - parseInt(b));
  } else {
    subGroupOrder.sort((a, b) => {
      if (a === '(Untagged)') return 1;
      if (b === '(Untagged)') return -1;
      return a.localeCompare(b);
    });
  }

  // Build horizontal strip: [sub-group] [sep] [sub-group] …
  const subParts = [];
  for (const subKey of subGroupOrder) {
    if (subParts.length) subParts.push('<div class="sl-week-sep"></div>');
    const subLabel   = getNoteSubGroupLabel(subKey);
    const groupCards = subGroupMap.get(subKey)
      .map(n => renderNoteCard(n, laneKey, { showDragHandle: false, showContextTags: true }))
      .join('');
    subParts.push(
      `<div class="sl-week-group">` +
      `<div class="sl-week-lbl">${escH(subLabel)}</div>` +
      `<div class="sl-week-cards">${groupCards}</div>` +
      `</div>`
    );
  }
  if (sorted.length > currentLimit) {
    const remaining = sorted.length - currentLimit;
    if (subParts.length) subParts.push('<div class="sl-week-sep"></div>');
    subParts.push(
      `<div class="sl-week-group sl-load-more-group">` +
      `<div class="sl-week-lbl" style="visibility:hidden">&nbsp;</div>` +
      `<div class="sl-week-cards">` +
      `<div class="sl-card load-more-card sl-lane-loading-sentinel" data-lane-load-sentinel="${escA(laneKey)}" onclick="loadMoreNotesInLane(${jq(laneKey)})" title="${escA(t('board.loadMoreTooltip'))}">` +
      `<div class="load-more-content">` +
      `<span class="load-more-icon">📥</span>` +
      `<span class="load-more-text">${escH(t('board.loadMore'))}</span>` +
      `<span class="load-more-remaining">(${remaining} ${escH(t('board.remaining'))})</span>` +
      `</div>` +
      `</div>` +
      `</div>` +
      `</div>`
    );
  }
  const cards        = subParts.join('');
  const swatchStyle  = `background:${color.text};`;

  return `
    <div class="sl-lane${isMax ? ' maximized' : ''}" data-lane="${escA(laneKey)}" style="--lane-color:${color.text};--lane-surface:${hslWithAlpha(color.text, 0.08)};--lane-surface-hover:${hslWithAlpha(color.text, 0.13)};">
      <div class="sl-lane-header" onclick="toggleLane(${jq(laneKey)})" title="${escA(t('board.collapseHint'))}">
        <span class="sl-lane-swatch" style="${swatchStyle}"></span>
        <span class="sl-lane-name" style="color:${color.text}" title="${escA(laneLabel)}">${escH(laneLabel)}</span>
        <span class="sl-lane-count">(${laneNotes.length})</span>
        <button class="sl-lane-focus-btn" onclick="event.stopPropagation();openLaneFocus(${jq(laneKey)})" title="${escA(t('board.openFocus'))}">📖</button>
        <div class="sl-lane-actions" onclick="event.stopPropagation()">
          <button class="sl-lane-action-btn sl-lane-max-btn${isMax ? ' active' : ''}" onclick="event.stopPropagation();toggleMaximizedLane(${jq(laneKey)})" title="${escA(t('board.maximize'))}" aria-label="${escA(t('board.maximize'))}">▢</button>
          <button class="sl-lane-action-btn sl-lane-min-btn${!isMax ? ' active' : ''}" onclick="event.stopPropagation();restoreDefaultLaneHeight(${jq(laneKey)})" title="${escA(t('board.restore'))}" aria-label="${escA(t('board.restore'))}">—</button>
        </div>
      </div>
      ${isCollapsed ? '' : `<div class="sl-cards" data-lane-val="${escA(laneKey)}">${cards || `<span style="color:#aaa;font-size:.78rem;padding:.3rem">${escH(t('board.noNotesInLane'))}</span>`}</div>`}
    </div>
  `;
}

async function renderWeekAxisBoard(board, items) {
  const today       = getStartOfDay();
  const cutoffDate  = addDays(today, -weekCutoffWeeks * 7);
  const { key: currentWeekKey } = getNoteWeekKey(today);
  const { key: lastWeekKey }    = getNoteWeekKey(addDays(today, -7));

  const weekMap    = new Map(); // isoKey → notes[]
  const olderNotes = [];
  for (const n of items) {
    if (!n.date) { olderNotes.push(n); continue; }
    const d = parseLocalDateValue(n.date);
    if (!d || isNaN(d) || d < cutoffDate) { olderNotes.push(n); continue; }
    const { key } = getNoteWeekKey(n.date);
    if (!weekMap.has(key)) weekMap.set(key, []);
    weekMap.get(key).push(n);
  }

  const weekKeys   = [...weekMap.keys()].sort((a, b) => b.localeCompare(a)); // newest first
  const total      = weekKeys.length;
  const html_parts = [];


  weekKeys.forEach((weekKey, index) => {
    const label = getWeekLaneLabel(weekKey, currentWeekKey, lastWeekKey);
    const color = getWeekLaneColor(index, total);
    html_parts.push(renderWeekLaneHTML(weekKey, label, weekMap.get(weekKey), color));
  });

  if (olderNotes.length > 0) {
    const olderColor = { bg: 'hsl(220, 14%, 96%)', text: 'hsl(215, 16%, 47%)' };
    html_parts.push(renderWeekLaneHTML('__older__', t('board.olderNotesLane'), olderNotes, olderColor));
  }

  if (!html_parts.length) {
    board.innerHTML = `<div style="color:#9ca3af;padding:2rem;text-align:center">${escH(t('board.noNotesMatchFilter'))}</div>`;
    renderGroupNav();
    return;
  }

  // Preserve horizontal scroll positions across renders
  const savedScrollPositions = new Map();
  board.querySelectorAll('.sl-cards[data-lane-val]').forEach(el => {
    const laneVal = el.getAttribute('data-lane-val');
    if (laneVal != null) savedScrollPositions.set(laneVal, el.scrollLeft);
  });

  board.innerHTML = html_parts.join('');

  savedScrollPositions.forEach((scrollLeft, laneVal) => {
    const el = board.querySelector(`.sl-cards[data-lane-val="${CSS.escape(laneVal)}"]`);
    if (el) el.scrollLeft = scrollLeft;
  });

  if (maximizedLanes.size > 0) {
    board.classList.add('has-maximized');
  } else {
    board.classList.remove('has-maximized');
  }
  setupBoardInteractions();
  // Week axis: no DnD — date is read-only via week lane
  initLaneHScroll();
  initCardPreviews();
  updateActiveFilterChip();
  const filterBar = document.getElementById('filter-bar');
  if (filterBar && filterBar.style.display !== 'none') renderFilterBarChips();
  renderGroupNav();
}


// ─── Lane scroll helpers & infinite loading ────────────────────────────────────
let _laneLoadingTimers = {};
let _laneSentinelObserver = null;

function triggerInfiniteLaneLoad(laneVal) {
  if (!laneVal || _laneLoadingTimers[laneVal]) return;
  _laneLoadingTimers[laneVal] = setTimeout(() => {
    delete _laneLoadingTimers[laneVal];
    const currentLimit = laneLimits[laneVal] || 30;
    laneLimits[laneVal] = currentLimit + 30;
    renderBoard();
  }, 40);
}

function initLaneHScroll() {
  const board = document.getElementById('swimlane-board');
  if (!board) return;

  if (_laneSentinelObserver) {
    _laneSentinelObserver.disconnect();
    _laneSentinelObserver = null;
  }

  // IntersectionObserver to auto-load when sentinel approaches view
  if (typeof IntersectionObserver !== 'undefined') {
    _laneSentinelObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const laneVal = entry.target.getAttribute('data-lane-load-sentinel');
          if (laneVal) triggerInfiniteLaneLoad(laneVal);
        }
      }
    }, {
      rootMargin: '0px 350px 0px 0px',
      threshold: 0.01
    });

    board.querySelectorAll('.sl-lane-loading-sentinel').forEach(el => {
      _laneSentinelObserver.observe(el);
    });
  }

  // Horizontal scroll listener on each lane's card container as a seamless endless scroll stream
  board.querySelectorAll('.sl-cards[data-lane-val]').forEach(container => {
    container.addEventListener('scroll', () => {
      if (container.scrollLeft + container.clientWidth >= container.scrollWidth - 350) {
        const laneVal = container.getAttribute('data-lane-val');
        const sentinel = container.querySelector('.sl-lane-loading-sentinel');
        if (laneVal && sentinel) {
          triggerInfiniteLaneLoad(laneVal);
        }
      }
    }, { passive: true });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
async function filterNotes() {
  searchQuery = document.getElementById('note-search')?.value || '';
  await renderBoard();
}

function toggleSearchOption(opt) {
  if (opt === 'content') {
    searchInContent = !searchInContent;
    document.getElementById('search-content-toggle')?.classList.toggle('on', searchInContent);
  } else if (opt === 'case') {
    searchCaseSensitive = !searchCaseSensitive;
    document.getElementById('search-case-toggle')?.classList.toggle('on', searchCaseSensitive);
  } else if (opt === 'regex') {
    searchRegex = !searchRegex;
    document.getElementById('search-regex-toggle')?.classList.toggle('on', searchRegex);
  }
  filterNotes();
}

function updateSearchControlsUI() {
  const c = document.getElementById('search-content-toggle');
  const cs = document.getElementById('search-case-toggle');
  const rx = document.getElementById('search-regex-toggle');
  if (c) c.classList.toggle('on', !!searchInContent);
  if (cs) cs.classList.toggle('on', !!searchCaseSensitive);
  if (rx) rx.classList.toggle('on', !!searchRegex);
}

function setFilter(type, value) {
  if (typeof mapMilestonesLimit !== 'undefined') mapMilestonesLimit = 8;
  if (type === 'group') {
    if ((activeFilter?.type === 'group' && activeFilter?.value === value) || (activeGroup === value && !activeFilter)) {
      activeFilter = null;
      activeGroup = 'All';
    } else {
      activeFilter = { type: 'group', value };
      activeGroup = value;
    }
  } else {
    activeGroup = 'All';
    activeFilter = (activeFilter?.type === type && activeFilter?.value === value) ? null : { type, value };
  }
  if (typeof renderNotesWorkstreamBar === 'function') renderNotesWorkstreamBar();
  renderFilterBarChips();
  updateActiveFilterChip();
  return renderBoard();
}

function toggleGroupsMode() { /* removed — no left sidebar in swimlane design */ }

// ═══ Filter Bar ═══
function compareLaneOrderValues(a, b, latestByValue = new Map()) {
  if (a === '(Untagged)') return 1;
  if (b === '(Untagged)') return -1;
  if (laneSortMode === 'recent') {
    const da = latestByValue.get(a) || '';
    const db = latestByValue.get(b) || '';
    if (da === db) return a.localeCompare(b);
    return db.localeCompare(da);
  }
  return a.localeCompare(b);
}

function getOrderedTagsFromNotes(notes, getTags) {
  const latestByValue = new Map();
  const values = new Set();
  for (const note of notes || []) {
    const date = formatLocalDateValue(note?.date || '');
    for (const rawValue of (getTags(note) || [])) {
      const value = String(rawValue || '').trim();
      if (!value) continue;
      values.add(value);
      if (!latestByValue.has(value) || date > latestByValue.get(value)) latestByValue.set(value, date);
    }
  }
  return [...values].sort((a, b) => compareLaneOrderValues(a, b, latestByValue));
}

function getLanePrimaryValue(note, axis = laneAxis) {
  const values = axis === 'group' ? (note?.group_tags || []) : (note?.major_topic_tags || []);
  return values[0] || '(Untagged)';
}

function getOrderedLaneValues(notes, axis = laneAxis) {
  return getOrderedTagsFromNotes(notes, note => [getLanePrimaryValue(note, axis)]);
}

function setLaneHover(laneVal) {
  const board = document.getElementById('swimlane-board');
  if (!board) return;
  board.querySelectorAll('.sl-lane.lane-hovered').forEach(el => el.classList.remove('lane-hovered'));
  if (!laneVal) return;
  board.querySelectorAll('.sl-lane').forEach(el => {
    if (el.dataset.lane === laneVal) el.classList.add('lane-hovered');
  });
}

function clearLaneHover() {
  setLaneHover(null);
}

function renderFilterChips() {
  const groups = getOrderedTagsFromNotes(manifest, n => n.group_tags || []);
  const majors = getOrderedTagsFromNotes(manifest, n => n.major_topic_tags || []);
  const topics = getOrderedTagsFromNotes(manifest, n => n.topic_tags || []);
  const listGroups = document.getElementById('list-groups');
  const listMajors = document.getElementById('list-majors');
  const listTopics = document.getElementById('list-topics');
  if (listGroups) listGroups.innerHTML = groups.map(g => `<option value="${escA(g)}">`).join('');
  if (listMajors) listMajors.innerHTML = majors.map(m => `<option value="${escA(m)}">`).join('');
  if (listTopics) listTopics.innerHTML = topics.map(t => `<option value="${escA(t)}">`).join('');
  renderBoard();
}

function renderSidebarGroups() { /* removed — groups are now swimlane headers */ }

function clearFilter() {
  if (typeof mapMilestonesLimit !== 'undefined') mapMilestonesLimit = 8;
  activeGroup = 'All';
  activeFilter = null;
  if (typeof renderNotesWorkstreamBar === 'function') renderNotesWorkstreamBar();
  renderFilterBarChips();
  updateActiveFilterChip();
  renderBoard();
}

// ═══ Swimlane board ═══

async function getAllNotes() {
  const byPath = new Map();
  for (const note of manifest) {
    if (!note?.path) continue;
    const current = byPath.get(note.path);
    if (!current) {
      byPath.set(note.path, { ...note });
      continue;
    }
    const preferred = ((note.group_tags || []).length + (note.major_topic_tags || []).length + (note.topic_tags || []).length + (note.extra_tags || []).length) >=
      ((current.group_tags || []).length + (current.major_topic_tags || []).length + (current.topic_tags || []).length + (current.extra_tags || []).length)
      ? note
      : current;
    byPath.set(note.path, {
      ...current,
      ...note,
      id: preferred.id || current.id || note.id || '',
      title: preferred.title || current.title || note.title || '',
      path: preferred.path || current.path || note.path,
      group_tags: [...new Set([...(current.group_tags || []), ...(note.group_tags || [])])],
      major_topic_tags: [...new Set([...(current.major_topic_tags || []), ...(note.major_topic_tags || [])])],
      topic_tags: [...new Set([...(current.topic_tags || []), ...(note.topic_tags || [])])],
      extra_tags: [...new Set([...(current.extra_tags || []), ...(note.extra_tags || [])])],
      date: preferred.date || current.date || note.date || '',
      modified: preferred.modified || current.modified || note.modified || '',
    });
  }
  return [...byPath.values()];
}

async function batchPromises(items, batchSize, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

async function getFilteredNotes() {
  let items = await getAllNotes();
  if (activeGroup && activeGroup !== 'All') {
    if (activeGroup === '(Untagged)') {
      items = items.filter(n => !n.group_tags || !n.group_tags.length || n.group_tags.includes('(Untagged)'));
    } else {
      items = items.filter(n => n.group_tags?.includes(activeGroup));
    }
  }
  if (activeFilter) {
    const { type, value } = activeFilter;
    items = items.filter(n => {
      if (type === 'workstream') {
        const wsName = getNoteWorkstreamName(n);
        const wsList = (typeof getNoteWorkstreams === 'function' ? getNoteWorkstreams(n) : []);
        return wsName === value ||
               wsList.includes(value) ||
               (n.workstream && n.workstream === value);
      }
      if (type === 'group') {
        return value === '(Untagged)'
          ? (!n.group_tags || !n.group_tags.length || n.group_tags.includes('(Untagged)'))
          : n.group_tags?.includes(value);
      }
      if (type === 'major') {
        return value === '(Untagged)'
          ? (!n.major_topic_tags || !n.major_topic_tags.length || n.major_topic_tags.includes('(Untagged)'))
          : n.major_topic_tags?.includes(value);
      }
      return value === '(Untagged)'
        ? (!n.topic_tags || !n.topic_tags.length || n.topic_tags.includes('(Untagged)'))
        : n.topic_tags?.includes(value);
    });
  }
  if (searchQuery) {
    const q = String(searchQuery || '').trim();
    const qLower = q.toLowerCase();
    let re = null;
    if (searchRegex) {
      try { re = new RegExp(q, searchCaseSensitive ? '' : 'i'); } catch(e) { re = null; }
    }
    const metaMatches = items.filter(n => {
      const title = n.title || '';
      const tags = [...(n.group_tags||[]), ...(n.major_topic_tags||[]), ...(n.topic_tags||[]), ...(n.extra_tags||[])];
      if (re) return re.test(title) || tags.some(t => re.test(t));
      if (searchCaseSensitive) return title.includes(q) || tags.some(t => t.includes(q));
      return title.toLowerCase().includes(qLower) || tags.some(t => t.toLowerCase().includes(qLower));
    });
    if (searchInContent) {
      const toCheck = items.filter(n => !metaMatches.includes(n));
      const results = await batchPromises(toCheck, 25, async n => {
        try {
          let text = '';
          const cached = lruGet(htmlLRUCache, n.path, { hitScope: 'caches', hitKey: 'htmlHits', missKey: 'htmlMisses' }) || noteContentCache[n.path];
          if (cached && cached.modified === n.modified) {
            text = cached.text;
          } else {
            const html = await StorageAPI.readNoteContent(n.path);
            const p = parseNoteHTML(html);
            text = new DOMParser().parseFromString('<div>'+(p.mainHTML||'')+'</div>','text/html').body.textContent||'';
            const payload = {
              modified: n.modified || '',
              text: text
            };
            noteContentCache[n.path] = payload;
            lruSet(htmlLRUCache, n.path, payload, HTML_LRU_LIMIT);
          }
          if (re) return re.test(text) ? n : null;
          if (searchCaseSensitive) return text.includes(q) ? n : null;
          return text.toLowerCase().includes(qLower) ? n : null;
        } catch(e) { return null; }
      });
      items = [...metaMatches, ...results.filter(Boolean)];
    } else {
      items = metaMatches;
    }
  }
  return items;
}

function getNoteWorkstreams(n) {
  if (!n) return [];
  const results = new Set();
  if (Array.isArray(n.workstreams)) {
    n.workstreams.forEach(w => {
      const trimmed = String(w || '').trim();
      if (trimmed) results.add(trimmed);
    });
  }
  if (typeof n.workstream === 'string' && n.workstream.trim()) {
    n.workstream.split(',').forEach(w => {
      const trimmed = w.trim();
      if (trimmed) results.add(trimmed);
    });
  }
  return [...results];
}
window.getNoteWorkstreams = getNoteWorkstreams;
if (typeof globalThis !== 'undefined') globalThis.getNoteWorkstreams = getNoteWorkstreams;

function getNoteWorkstreamName(n) {
  if (!n) return '';
  if (n.workstream && typeof n.workstream === 'string' && n.workstream.trim()) {
    return n.workstream.trim();
  }
  if (Array.isArray(n.workstreams) && n.workstreams.length && String(n.workstreams[0] || '').trim()) {
    return String(n.workstreams[0]).trim();
  }
  if (typeof detectWorkstreamsForNote === 'function') {
    try {
      const wsList = detectWorkstreamsForNote(n);
      if (Array.isArray(wsList) && wsList.length && wsList[0]) return String(wsList[0]).trim();
    } catch (e) {}
  }
  const catalog = (typeof _topicMemoriesIndexCache !== 'undefined' && _topicMemoriesIndexCache && Array.isArray(_topicMemoriesIndexCache.topics))
    ? _topicMemoriesIndexCache.topics
    : [];
  const activeWsNames = catalog.filter(t => t && t.status !== 'archived').map(t => t.topicName || t.key).filter(Boolean);
  const allTags = [...(n.group_tags || []), ...(n.major_topic_tags || []), ...(n.topic_tags || [])];
  for (const tag of allTags) {
    const cleanTag = String(tag || '').trim().toLowerCase();
    const match = activeWsNames.find(ws => ws.toLowerCase() === cleanTag);
    if (match) return match;
  }
  return '';
}
window.getNoteWorkstreamName = getNoteWorkstreamName;
if (typeof globalThis !== 'undefined') globalThis.getNoteWorkstreamName = getNoteWorkstreamName;

function getKnownWorkstreamsList(notes = []) {
  const wsSet = new Set();
  const archivedSet = new Set();
  const ignoredSet = new Set(['other', 'autre', '(untagged)', '*', 'uncategorized', 'non classé', 'non catégorisé']);

  const isValidWs = (name) => {
    if (!name || typeof name !== 'string') return false;
    const clean = name.trim();
    return clean.length > 0 && !ignoredSet.has(clean.toLowerCase()) && !archivedSet.has(clean.toLowerCase());
  };

  // 1. In-memory topic memories cache or fallback to localStorage (Authoritative source: Workstreams tab)
  let hasAuthoritativeIndex = false;
  if (typeof _topicMemoriesIndexCache !== 'undefined' && _topicMemoriesIndexCache && Array.isArray(_topicMemoriesIndexCache.topics)) {
    hasAuthoritativeIndex = true;
    for (const t of _topicMemoriesIndexCache.topics) {
      if (t) {
        const name = (t.topicName || t.key || '').trim();
        if (name) {
          if (t.status === 'archived') {
            archivedSet.add(name.toLowerCase());
          } else if (isValidWs(name)) {
            wsSet.add(name);
          }
        }
      }
    }
  } else if (typeof localStorage !== 'undefined') {
    try {
      const cached = localStorage.getItem('secretary_topic_memories_index_v1') || localStorage.getItem('secretary_topic_memories_index');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && Array.isArray(parsed.topics)) {
          hasAuthoritativeIndex = true;
          if (typeof _topicMemoriesIndexCache !== 'undefined' && !_topicMemoriesIndexCache) {
            _topicMemoriesIndexCache = parsed;
          }
          for (const t of parsed.topics) {
            if (t) {
              const name = (t.topicName || t.key || '').trim();
              if (name) {
                if (t.status === 'archived') {
                  archivedSet.add(name.toLowerCase());
                } else if (isValidWs(name)) {
                  wsSet.add(name);
                }
              }
            }
          }
        }
      }
    } catch (_) {}
  }

  // 2. Preloaded file cache in WorkstreamMemoryEngine
  if (typeof _topicMemoryFileCache !== 'undefined' && _topicMemoryFileCache instanceof Map && _topicMemoryFileCache.size > 0) {
    hasAuthoritativeIndex = true;
    for (const [k, mem] of _topicMemoryFileCache.entries()) {
      if (mem) {
        const name = (mem.topicName || k || '').trim();
        if (name) {
          if (mem.status === 'archived') {
            archivedSet.add(name.toLowerCase());
          } else if (isValidWs(name)) {
            wsSet.add(name);
          }
        }
      }
    }
  }

  // 3. Fallback candidate notes ONLY if no authoritative topic memories index exists at all
  if (!hasAuthoritativeIndex && wsSet.size === 0) {
    const candidateNotes = (Array.isArray(notes) && notes.length > 0)
      ? notes
      : ((typeof manifest !== 'undefined' && Array.isArray(manifest)) ? manifest : []);

    for (const n of candidateNotes) {
      if (!n) continue;
      if (typeof n.workstream === 'string' && n.workstream.trim()) {
        n.workstream.split(',').forEach(w => {
          const trimmed = w.trim();
          if (isValidWs(trimmed)) wsSet.add(trimmed);
        });
      }
      if (Array.isArray(n.workstreams)) {
        n.workstreams.forEach(w => {
          const trimmed = String(w || '').trim();
          if (isValidWs(trimmed)) wsSet.add(trimmed);
        });
      }
    }
  }

  // Ensure all archived or ignored entries are pruned
  for (const item of wsSet) {
    if (!isValidWs(item)) {
      wsSet.delete(item);
    }
  }

  const customOrder = (typeof workstreamCustomOrder !== 'undefined' && Array.isArray(workstreamCustomOrder))
    ? workstreamCustomOrder
    : (() => {
        try {
          if (typeof localStorage !== 'undefined') {
            const co = localStorage.getItem('secretary_workstream_custom_order');
            if (co) return JSON.parse(co);
          }
        } catch (_) {}
        return [];
      })();

  const favs = (typeof favoriteRegistryProjects !== 'undefined' && favoriteRegistryProjects instanceof Set)
    ? favoriteRegistryProjects
    : (() => {
        try {
          if (typeof localStorage !== 'undefined') {
            const f = localStorage.getItem('secretary_favorite_registry_projects');
            if (f) return new Set(JSON.parse(f));
          }
        } catch (_) {}
        return new Set();
      })();

  return [...wsSet].filter(Boolean).sort((a, b) => {
    const idxA = customOrder.indexOf(a);
    const idxB = customOrder.indexOf(b);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;

    const isPinnedA = favs.has(a) || (typeof _topicMemoriesIndexCache !== 'undefined' && _topicMemoriesIndexCache?.topics?.find(t => (t.topicName === a || t.key === a) && t.status !== 'archived')?.pinned);
    const isPinnedB = favs.has(b) || (typeof _topicMemoriesIndexCache !== 'undefined' && _topicMemoriesIndexCache?.topics?.find(t => (t.topicName === b || t.key === b) && t.status !== 'archived')?.pinned);
    if (isPinnedA && !isPinnedB) return -1;
    if (!isPinnedA && isPinnedB) return 1;

    return a.localeCompare(b);
  });
}
window.getKnownWorkstreamsList = getKnownWorkstreamsList;

// ═══ Notes Board ═══
function renderNoteCard(n, laneVal, opts = {}) {
  const isPlannedNote   = !!n.isPlannedNote;
  const isSelected     = !isPlannedNote && currentNote?.path === n.path;
  const showDragHandle  = opts.showDragHandle  !== false && !isPlannedNote; // default true
  const showContextTags = opts.showContextTags === true;  // default false
  const hideTags        = opts.hideTags === true;

  const wsName = getNoteWorkstreamName(n);
  let topHeaderTagsHTML = '';

  const workstreamIcon = (typeof AppIcons !== 'undefined' && AppIcons.get) ? AppIcons.get('workstream', { size: 12 }) : '';
  const calendarIcon   = (typeof AppIcons !== 'undefined' && AppIcons.get) ? AppIcons.get('calendar', { size: 11 }) : '';
  const sparklesIcon   = (typeof AppIcons !== 'undefined' && AppIcons.get) ? AppIcons.get('sparkles', { size: 12 }) : '';

  if (!hideTags) {
    if (wsName) {
      // If note is part of a workstream: do not show standard tags, show workstream pill
      topHeaderTagsHTML = `<div class="sl-card-workstream-pill" title="${escA(t('topbar.workstreamsTooltip') || 'Workstream')}">${workstreamIcon} <span class="ws-name">${escH(wsName)}</span></div>`;
    } else {
      // Tag chips — display only, no click interaction
      const groupTags = (n.group_tags || []).map(t =>
        `<span class="tag group-tag">${escH(t)}</span>`
      ).join('');
      const majorTags = (n.major_topic_tags || []).map(t =>
        `<span class="tag major-tag">${escH(t)}</span>`
      ).join('');
      const topicTags = (n.topic_tags || []).map(t => {
        const tc = colorForGroup(t);
        return `<span class="tag" style="background:${tc.bg};color:${tc.text}">${escH(t)}</span>`;
      }).join('');

      const tagsHTML = showContextTags
        ? [groupTags, majorTags, topicTags].filter(Boolean).join('')
        : topicTags;

      if (tagsHTML) {
        topHeaderTagsHTML = `<div class="sl-card-tag-row sl-card-tags-top">${tagsHTML}</div>`;
      }
    }
  }

  const badges = [];
  const extra  = n.extra_tags || [];
  if (extra.includes('TODO HIGH')) badges.push('<span class="sl-badge sl-badge-high">Q1</span>');
  if (extra.includes('TODO MED'))  badges.push('<span class="sl-badge sl-badge-med">Q2</span>');
  if (extra.includes('TODO WIP'))  badges.push('<span class="sl-badge sl-badge-wip">WIP</span>');
  if (extra.includes('TODO LOW'))  badges.push('<span class="sl-badge sl-badge-low">Q3</span>');

  let blockTypeName = 'Block';
  if (n.event && n.event.type) {
    const rawType = String(n.event.type).toLowerCase();
    if (rawType === 'sync') blockTypeName = 'Sync';
    else if (rawType === 'call') blockTypeName = 'Call';
    else if (rawType === 'prep') blockTypeName = 'Prep';
    else if (rawType === 'todo') blockTypeName = 'Todo';
    else if (rawType === 'meeting') blockTypeName = 'Meeting';
    else blockTypeName = rawType.charAt(0).toUpperCase() + rawType.slice(1);
  } else if (n.title && n.title.toLowerCase().includes('sync')) {
    blockTypeName = 'Sync';
  } else if (n.title && n.title.toLowerCase().includes('call')) {
    blockTypeName = 'Call';
  } else if (n.title && n.title.toLowerCase().includes('prep')) {
    blockTypeName = 'Prep';
  }
  const typeOhneNotizText = t('board.typeOhneNotiz', { type: blockTypeName }) || `${blockTypeName} ohne Notiz`;

  const laneAttr      = laneVal != null ? ` data-lane-val="${escA(laneVal)}"` : '';
  const previewData   = notePreviewCache[n.path];
  const cachedPreview = previewData && typeof previewData === 'object' ? previewData.text : (previewData != null ? previewData : (n.preview || ''));
  const highlights    = previewData && typeof previewData === 'object' && Array.isArray(previewData.highlights) ? previewData.highlights : [];
  const hasHighlights  = highlights.length > 0;

  const summaryVal = n.summary || cachedPreview || '';
  const plainTextSummary = typeof htmlToPlainText === 'function' ? htmlToPlainText(summaryVal) : summaryVal;
  const cardTitle = isPlannedNote
    ? (t('board.uncreatedNoteTooltip') || 'Planned note from bloc. Double-click to create.')
    : (plainTextSummary
      ? t('board.openNoteWithSummary', { summary: plainTextSummary })
      : t('board.openNoteAction'));

  const dragHandleHTML = showDragHandle
    ? `<span class="sl-card-drag-handle" draggable="true" ondblclick="event.stopPropagation()" title="${escA(t('board.dragToMoveTooltip'))}">⠿</span>`
    : `<span class="sl-card-drag-handle" style="opacity:0;pointer-events:none;cursor:default">⠿</span>`;

  // Get scheduled planner blocks
  const linkedBlocks = (!isPlannedNote && typeof getPlannerEventsForNote === 'function' && n.id)
    ? getPlannerEventsForNote(n.id)
    : (n.event ? [n.event] : []);

  let blocksHTML = '';
  if (!opts.hideTimeBadge && linkedBlocks.length > 0) {
    blocksHTML = `
      <div class="sl-card-planner-blocks" onclick="event.stopPropagation(); ${isPlannedNote ? `if(typeof openNoteForEvent === 'function') openNoteForEvent(plannerEvents?.find(e => e.id === ${jq(n.event?.id)}) || ${jq(n.event)});` : `openNoteOverlay(${jq(n.path)}, null, null, false, null, { collapseMetadata: true, fromBloc: true })`}">
        ${linkedBlocks.map(ev => `
          <span class="sl-card-planner-chip sl-card-planner-chip-${ev.type}" title="${escA(ev.date)} ${ev.startTime || ''}–${ev.endTime || ''}">
            ${calendarIcon} <span>${ev.startTime || ev.date}${ev.type === 'prep' ? ' (prep)' : ''}${ev.recurrenceId ? ' (series)' : ''}</span>
          </span>
        `).join('')}
      </div>
    `;
  }

  // Soft Date under title: ONLY render if explicitly requested via opts.showCardDate
  const dateSubtleHTML = (opts.showCardDate && n.date)
    ? `<div class="sl-card-date" style="color: var(--text-muted); font-size: 0.72rem; font-weight: 500; margin-top: 2px;">${escH(n.date)}</div>`
    : '';

  const dblClickAction = isPlannedNote
    ? `event.stopPropagation(); if (typeof openNoteForEvent === 'function') openNoteForEvent(plannerEvents?.find(e => e.id === ${jq(n.event?.id)}) || ${jq(n.event)});`
    : `openNoteOverlay(${jq(n.path)})`;

  const cardClasses = `sl-card note-card${isSelected ? ' selected' : ''}${isPlannedNote ? ' planned-note-card' : ''}`;

  let tintStyle = '';
  if (opts.tintColor) {
    tintStyle = ` style="background: color-mix(in srgb, ${opts.tintColor} 6%, var(--card-bg)); border-color: color-mix(in srgb, ${opts.tintColor} 25%, var(--card-border));"`;
  }

  return `<div class="${cardClasses}" data-path="${escA(n.path)}"${laneAttr}${tintStyle}
    onclick="${isPlannedNote ? `event.stopPropagation(); if (typeof openNoteForEvent === 'function') openNoteForEvent(plannerEvents?.find(e => e.id === ${jq(n.event?.id)}) || ${jq(n.event)});` : `onNoteCardClick(event, ${jq(n.path)})`}" onauxclick="${isPlannedNote ? '' : `onNoteCardAuxClick(event, ${jq(n.path)})`}"
    ondblclick="${dblClickAction}" oncontextmenu="onNoteCardContextMenu(event, ${jq(n.path)})" title="${escA(cardTitle)}">
    ${dragHandleHTML}
    <div class="sl-card-content">
      <div class="sl-card-header">
        ${topHeaderTagsHTML}
        <div class="sl-card-title">${escH(n.title || n.path.split('/').pop())}</div>
        ${dateSubtleHTML}
      </div>
      <div class="sl-card-body">
        <div class="sl-card-preview-area" data-path="${escA(n.path)}">
          ${isPlannedNote ? `
            <div class="sl-card-preview-text" style="color: var(--text-muted); font-size:0.78rem; line-height:1.45; font-style:italic;">
              ${escH(typeOhneNotizText)}
            </div>
          ` : (n.summary ? `
            <div class="sl-card-highlights-container"></div>
            <div class="sl-card-preview-text" style="color: var(--text-muted); font-size:0.78rem; line-height:1.45;">
              ${n.summary}
            </div>
          ` : `
            <div class="sl-card-highlights-container">
              ${hasHighlights ? buildNoteHighlightSectionHTML(highlights, { compact: true, showAll: false }) : ''}
            </div>
            <div class="sl-card-preview-text" style="color: var(--text-muted); font-size:0.78rem; line-height:1.45;">
              ${cachedPreview || ''}
            </div>
          `)}
          <div class="sl-card-preview-fade"></div>
        </div>
        ${blocksHTML}
        <div class="sl-card-badges${badges.length ? '' : ' empty'}">${badges.length ? badges.join('') : ''}</div>
      </div>
    </div>
  </div>`;
}
async function renderBoard() {
  if (typeof expandedLaneVal !== 'undefined' && expandedLaneVal != null) {
    document.body.classList.add('reading-mode-active');
  } else {
    document.body.classList.remove('reading-mode-active');
  }
  if (activeTab === 'planner') {
    renderPlanner();
    return;
  }
  if (activeTab === 'chat') {
    return;
  }
  if (boardMode === 'todos' && activeTab !== 'prefs') { renderTodosBoard(); renderGroupNav(); return; }
  if (activeTab !== 'notes' && boardMode !== 'todos') { renderGroupNav(); return; }
  if (expandedLaneVal != null) { await renderExpandedLaneView(); renderGroupNav(); return; }
  const board = document.getElementById('swimlane-board');
  if (!board) return;

  let items = await getFilteredNotes();

  // Update dynamic search match count
  const countEl = document.getElementById('search-match-count');
  if (countEl) {
    if (searchQuery) {
      const matchText = t('board.notesFound', { count: items.length });
      countEl.textContent = matchText;
      countEl.style.display = 'inline';
    } else {
      countEl.textContent = '';
      countEl.style.display = 'none';
    }
  }

  // Dispatch to Notes tab view modes (Map, Tree, Reader)
  if (notesViewMode === 'map') { await renderChronologicalMapView(board, items); return; }
  if (notesViewMode === 'tree') { await renderNotesTreeView(board, items); return; }
  if (notesViewMode === 'reader') { await renderIntegratedReaderView(board, items); return; }

  // Fallback: Dispatch to week-axis renderer when axis = 'week'
  if (laneAxis === 'week') { await renderWeekAxisBoard(board, items); return; }

  const getSubVal = n => {
    const arr = laneAxis === 'group' ? (n.major_topic_tags || []) : (n.topic_tags || []);
    return arr[0] || '—';
  };

  const laneValues = getOrderedLaneValues(items, laneAxis);

  const html_parts = [];

  for (const laneVal of laneValues) {
    const laneNotes = items.filter(n => getLanePrimaryValue(n, laneAxis) === laneVal);
    const isCollapsed = collapsedLanes.has(laneVal);
    const isMax = maximizedLanes.has(laneVal);
    const canEditLane = laneAxis !== 'week' && laneVal !== '(Untagged)';
    const isDark = document.body && document.body.getAttribute('data-theme') === 'dark';
    const color = laneVal === '(Untagged)'
      ? (isDark ? { bg: 'hsl(215, 15%, 18%)', text: 'hsl(215, 20%, 75%)' } : { bg: 'hsl(215, 20%, 94%)', text: 'hsl(215, 25%, 35%)' })
      : colorForGroup(laneVal);
    const isSelectedLane = laneAxis === 'group'
      ? activeGroup === laneVal
      : laneAxis === 'major'
        ? (activeFilter?.type === 'major' && activeFilter?.value === laneVal)
        : false;
    const laneSurface = hslWithAlpha(color.text, isSelectedLane ? 0.12 : 0.07);
    const laneSurfaceHover = hslWithAlpha(color.text, isSelectedLane ? 0.18 : 0.11);

    const subVals = ['All', ...new Set(laneNotes.map(getSubVal))].filter((v,i,a) => a.indexOf(v) === i);
    const activeSubCol = laneSubcols[laneVal] || 'All';
    const visibleNotes = activeSubCol === 'All' ? laneNotes : laneNotes.filter(n => getSubVal(n) === activeSubCol);

    const subtabs = subVals.length > 1 ? `<div class="sl-subtabs">${subVals.map(v => {
      if (v === 'All') return `<button class="sl-subtab${activeSubCol===v?' active':''}" onclick="setLaneSubcol(${jq(laneVal)},${jq(v)})" title="${escA(t('board.showAllNotes'))}">${escH(v)}</button>`;
      const sc = colorForGroup(v);
      const activeStyle = activeSubCol === v ? `background:${sc.text};color:#fff;border-color:${sc.text}` : `color:${sc.text};border-color:${sc.text}`;
      const subtabTitle = v === '—' ? t('board.showNotesForUnassigned') : t('board.showNotesFor', { value: v });
      return `<button class="sl-subtab${activeSubCol===v?' active':''}" style="${activeStyle}" onclick="setLaneSubcol(${jq(laneVal)},${jq(v)})" title="${escA(subtabTitle)}">${escH(v)}</button>`;
    }).join('')}</div>` : '';

    // Group notes by ISO week, newest week first
    const sorted = visibleNotes.slice().sort((a,b) => (b.date||'') > (a.date||'') ? 1 : -1);
    const currentLimit = laneLimits[laneVal] || 30;
    const sliced = sorted.slice(0, currentLimit);
    const weekGroups = new Map();
    for (const n of sliced) {
      const { key, label } = getNoteWeekKey(n.date);
      if (!weekGroups.has(key)) weekGroups.set(key, { label, notes: [] });
      weekGroups.get(key).notes.push(n);
    }

    // Build horizontal strip: [week-group] [sep] [week-group] ...
    const weekParts = [];
    for (const [, { label, notes }] of weekGroups) {
      if (weekParts.length) weekParts.push('<div class="sl-week-sep"></div>');
      const weekCards = notes.map(n => renderNoteCard(n, laneVal)).join('');
      weekParts.push(
        `<div class="sl-week-group">` +
        `<div class="sl-week-lbl">${escH(label)}</div>` +
        `<div class="sl-week-cards">${weekCards}</div>` +
        `</div>`
      );
    }
    if (sorted.length > currentLimit) {
      const remaining = sorted.length - currentLimit;
      if (weekParts.length) weekParts.push('<div class="sl-week-sep"></div>');
      weekParts.push(
        `<div class="sl-week-group sl-load-more-group">` +
        `<div class="sl-week-lbl" style="visibility:hidden">&nbsp;</div>` +
        `<div class="sl-week-cards">` +
        `<div class="sl-card load-more-card sl-lane-loading-sentinel" data-lane-load-sentinel="${escA(laneVal)}" onclick="loadMoreNotesInLane(${jq(laneVal)})" title="${escA(t('board.loadMoreTooltip'))}">` +
        `<div class="load-more-content">` +
        `<span class="load-more-icon">📥</span>` +
        `<span class="load-more-text">${escH(t('board.loadMore'))}</span>` +
        `<span class="load-more-remaining">(${remaining} ${escH(t('board.remaining'))})</span>` +
        `</div>` +
        `</div>` +
        `</div>` +
        `</div>`
      );
    }
    const cards = weekParts.join('');

    const swatchStyle = `background:${color.text};`;
    html_parts.push(`
      <div class="sl-lane${isMax ? ' maximized' : ''}${isSelectedLane ? ' selected-lane' : ''}" data-lane="${escA(laneVal)}" style="--lane-color:${color.text};--lane-surface:${laneSurface};--lane-surface-hover:${laneSurfaceHover};">
        <div class="sl-lane-header" onclick="toggleLane(${jq(laneVal)})" oncontextmenu="${canEditLane ? `return onLabelNavContextMenu(event, ${jq(laneAxis)}, ${jq(laneVal)});` : 'return false;'}" title="${escA(t('board.collapseHint'))}">
          <span class="sl-lane-swatch" style="${swatchStyle}"></span>
          <span class="sl-lane-name" style="color:${color.text};cursor:pointer" onclick="event.stopPropagation();setFilter(${jq(laneAxis === 'group' ? 'group' : 'major')},${jq(laneVal)})" title="${escA(t('board.filterLane', { value: laneVal }))}">${escH(laneVal)}</span>
          <button class="sl-lane-add" onclick="event.stopPropagation();newNoteInLane(${jq(laneVal)})" title="${escA(t('board.createNote'))}">+ ${escH(t('board.newNoteShort'))}</button>
          <span class="sl-lane-count">(${laneNotes.length})</span>
          <button class="sl-lane-focus-btn" onclick="event.stopPropagation();openLaneFocus(${jq(laneVal)})" title="${escA(t('board.openFocus'))}">📖</button>
          <div class="sl-lane-actions" onclick="event.stopPropagation()">
            ${canEditLane ? `<button class="sl-lane-action-btn sl-lane-edit-btn" onclick="event.stopPropagation();openLabelManager(${jq(laneAxis)}, ${jq(laneVal)})" title="${escA(t('board.editLabel'))}" aria-label="${escA(t('board.editLabel'))}">✎</button>` : ''}
            <button class="sl-lane-action-btn sl-lane-max-btn${isMax ? ' active' : ''}" onclick="event.stopPropagation();toggleMaximizedLane(${jq(laneVal)})" title="${escA(t('board.maximize'))}" aria-label="${escA(t('board.maximize'))}">▢</button>
            <button class="sl-lane-action-btn sl-lane-min-btn${!isMax ? ' active' : ''}" onclick="event.stopPropagation();restoreDefaultLaneHeight(${jq(laneVal)})" title="${escA(t('board.restore'))}" aria-label="${escA(t('board.restore'))}">—</button>
          </div>
        </div>
        ${isCollapsed ? '' : subtabs + `<div class="sl-cards" data-lane-val="${escA(laneVal)}">${cards || `<span style="color:#aaa;font-size:.78rem;padding:.3rem">${escH(t('board.noNotesInLane'))}</span>`}</div>`}
      </div>
    `);
  }

  if (!laneValues.length) {
    board.innerHTML = `<div style="color:#9ca3af;padding:2rem;text-align:center">${escH(t('board.noNotesMatchFilter'))}</div>`;
    renderGroupNav();
    return;
  }

  // Preserve horizontal scroll positions across renders
  const savedScrollPositions = new Map();
  board.querySelectorAll('.sl-cards[data-lane-val]').forEach(el => {
    const laneVal = el.getAttribute('data-lane-val');
    if (laneVal != null) savedScrollPositions.set(laneVal, el.scrollLeft);
  });

  board.innerHTML = html_parts.join('');

  savedScrollPositions.forEach((scrollLeft, laneVal) => {
    const el = board.querySelector(`.sl-cards[data-lane-val="${CSS.escape(laneVal)}"]`);
    if (el) el.scrollLeft = scrollLeft;
  });

  if (maximizedLanes.size > 0) {
    board.classList.add('has-maximized');
  } else {
    board.classList.remove('has-maximized');
  }
  setupBoardInteractions(); // no-op after first call — delegation survives re-renders
  attachNotesBoardDnD();
  initLaneHScroll();
  initCardPreviews();
  updateActiveFilterChip();
  // Keep filter bar chips in sync if bar is open
  const filterBar = document.getElementById('filter-bar');
  if (filterBar && filterBar.style.display !== 'none') renderFilterBarChips();
  renderGroupNav();
}



function toggleLane(laneVal) {
  // Cycle states: collapsed -> normal -> maximized -> collapsed
  const isCollapsed = collapsedLanes.has(laneVal);
  const isMax = maximizedLanes.has(laneVal);
  if (isMax) {
    // maximized -> collapse
    maximizedLanes.delete(laneVal);
    collapsedLanes.add(laneVal);
  } else if (isCollapsed) {
    // collapsed -> normal
    collapsedLanes.delete(laneVal);
  } else {
    // normal -> maximized
    maximizedLanes.clear(); // Ensure only one lane is maximized at a time
    maximizedLanes.add(laneVal);
    collapsedLanes.delete(laneVal);
  }
  try { localStorage.setItem('secretaryCollapsedLanes', JSON.stringify([...collapsedLanes])); } catch(e) {}
  renderBoard();
  if (!isMax && !isCollapsed) {
    const main = document.getElementById('app-main');
    if (main) main.scrollTop = 0;
  }
}

function toggleMaximizedLane(laneVal) {
  if (maximizedLanes.has(laneVal)) {
    maximizedLanes.delete(laneVal);
  } else {
    maximizedLanes.clear(); // Ensure only one lane is maximized at a time
    maximizedLanes.add(laneVal);
  }
  collapsedLanes.delete(laneVal);
  try { localStorage.setItem('secretaryCollapsedLanes', JSON.stringify([...collapsedLanes])); } catch(e) {}
  renderBoard();
  if (maximizedLanes.has(laneVal)) { // scroll to top when lane becomes maximized
    const main = document.getElementById('app-main');
    if (main) main.scrollTop = 0;
  }
}

function restoreDefaultLaneHeight(laneVal) {
  maximizedLanes.delete(laneVal);
  collapsedLanes.delete(laneVal);
  try { localStorage.setItem('secretaryCollapsedLanes', JSON.stringify([...collapsedLanes])); } catch(e) {}
  renderBoard();
}

function maximizeLane(laneVal) {
  maximizedLanes.clear(); // Ensure only one lane is maximized at a time
  maximizedLanes.add(laneVal);
  collapsedLanes.delete(laneVal);
  try { localStorage.setItem('secretaryCollapsedLanes', JSON.stringify([...collapsedLanes])); } catch(e) {}
  renderBoard();
  const main = document.getElementById('app-main');
  if (main) main.scrollTop = 0;
}

function minimizeLane(laneVal) {
  maximizedLanes.delete(laneVal);
  collapsedLanes.add(laneVal);
  try { localStorage.setItem('secretaryCollapsedLanes', JSON.stringify([...collapsedLanes])); } catch(e) {}
  renderBoard();
}

function setLaneSubcol(laneVal, subVal) {
  laneSubcols[laneVal] = subVal;
  renderBoard();
}

function toggleLaneAxis() {
  if (typeof expandedLaneVal !== 'undefined' && expandedLaneVal != null) {
    if (typeof closeLaneFocus === 'function') closeLaneFocus();
  }
  // Legacy toggle: cycles group → major → week → group
  const axes = ['group', 'major', 'week'];
  laneAxis = axes[(axes.indexOf(laneAxis) + 1) % axes.length];
  laneSubcols = {};
  try { localStorage.setItem('secretaryLaneAxis', laneAxis); } catch(e) {}
  const lbl = document.getElementById('lane-axis-label');
  if (lbl) lbl.textContent = laneAxis === 'group' ? t('axis.groups') : laneAxis === 'major' ? t('axis.topics') : t('axis.weeks');
  if (typeof updateSubRowVisibility === 'function') updateSubRowVisibility();
  renderBoard();
}

function setLaneAxis(axis) {
  if (typeof expandedLaneVal !== 'undefined' && expandedLaneVal != null) {
    if (typeof closeLaneFocus === 'function') closeLaneFocus();
  }
  laneAxis = axis;
  laneSubcols = {};
  try { localStorage.setItem('secretaryLaneAxis', axis); } catch(e) {}
  const lbl = document.getElementById('lane-axis-label');
  if (lbl) lbl.textContent = axis === 'group' ? t('axis.groups') : axis === 'major' ? t('axis.topics') : t('axis.weeks');
  if (typeof updateSubRowVisibility === 'function') updateSubRowVisibility();
  renderBoard();
}

function setWeekSubGrouping(val) {
  weekSubGrouping = val;
  try { localStorage.setItem('secretaryWeekSubGrouping', val); } catch(e) {}
  renderBoard();
}




function toggleFilterBar() {
  const isNotes = (typeof activeTab === 'undefined' || activeTab === 'notes')
    && (typeof boardMode === 'undefined' || boardMode === 'notes');
  if (!isNotes) return;
  const bar = document.getElementById('filter-bar');
  if (!bar) return;
  const isOpen = bar.style.display !== 'none' && bar.style.display !== '';
  bar.style.display = isOpen ? 'none' : 'block';
  const btn = document.getElementById('btn-filter-bar');
  if (btn) btn.title = isOpen ? t('board.showFilterBarTooltip') : t('board.hideFilterBarTooltip');
  if (!isOpen) renderFilterBarChips();
}

function renderFilterBarChips() {
  const isNotes = (typeof activeTab === 'undefined' || activeTab === 'notes')
    && (typeof boardMode === 'undefined' || boardMode === 'notes');
  const bar = document.getElementById('filter-bar');
  if (bar && !isNotes) {
    bar.style.display = 'none';
    return;
  }
  const groups = getOrderedTagsFromNotes(manifest, n => n.group_tags || []);
  const workstreams = getKnownWorkstreamsList(manifest);
  const majors = getOrderedTagsFromNotes(manifest, n => n.major_topic_tags || []);
  const topics = getOrderedTagsFromNotes(manifest, n => n.topic_tags || []);
  const el = document.getElementById('filter-bar-chips');
  if (!el) return;
  const isFiltered = activeFilter || (activeGroup && activeGroup !== 'All');
  const clearBtn = isFiltered
    ? `<button class="filter-bar-chip" style="background:#fee2e2;color:#b91c1c" onclick="clearFilter()" title="${escA(t('board.clearFilterTooltip'))}">${escH(t('board.clearFilter'))}</button>` : '';
  
  const workstreamIcon = (typeof AppIcons !== 'undefined' && AppIcons.get)
    ? AppIcons.get('workstream', { size: 12 })
    : '<svg class="app-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 9v12"/><path d="M18 9a9 9 0 0 0-9 9"/></svg>';

  const workstreamRow = workstreams.length ? `<div class="filter-bar-row">
    <span class="filter-bar-section">${escH(t('board.filterWorkstream') || 'Workstream')}</span>
    ${workstreams.map(ws => `<button class="filter-bar-chip fb-workstream${activeFilter?.type==='workstream'&&activeFilter?.value===ws?' active':''}" onclick="setFilter('workstream',${jq(ws)})" title="${escA(t('board.filterLane', { value: ws }))}">${workstreamIcon} <span>${escH(ws)}</span></button>`).join('')}
  </div>` : '';

  const groupRow = groups.length ? `<div class="filter-bar-row">
    <span class="filter-bar-section">${escH(t('axis.groups') || 'Groups')}</span>
    ${groups.map(g => `<button class="filter-bar-chip fb-group${(activeFilter?.type==='group'&&activeFilter?.value===g)||(activeGroup===g&&!activeFilter)?' active':''}" onclick="setFilter('group',${jq(g)})" title="${escA(t('board.filterLane', { value: g }))}">${escH(g)}</button>`).join('')}
  </div>` : '';

  const majorRow = majors.length ? `<div class="filter-bar-row">
    <span class="filter-bar-section">${escH(t('week.major'))}</span>
    ${majors.map(m => `<button class="filter-bar-chip fb-major${activeFilter?.type==='major'&&activeFilter?.value===m?' active':''}" onclick="setFilter('major',${jq(m)})" title="${escA(t('board.filterLane', { value: m }))}">${escH(m)}</button>`).join('')}
  </div>` : '';
  
  const topicRow = topics.length ? `<div class="filter-bar-row">
    <span class="filter-bar-section">${escH(t('week.topic'))}</span>
    ${topics.map(tg => `<button class="filter-bar-chip fb-topic${activeFilter?.type==='topic'&&activeFilter?.value===tg?' active':''}" onclick="setFilter('topic',${jq(tg)})" title="${escA(t('board.filterLane', { value: tg }))}">${escH(tg)}</button>`).join('')}
    ${clearBtn}
  </div>` : clearBtn ? `<div class="filter-bar-row">${clearBtn}</div>` : '';
  el.innerHTML = workstreamRow + groupRow + majorRow + topicRow;
}

function getNotesNavFiltersOpen() {
  if (typeof window._notesNavFiltersOpen !== 'boolean') {
    let open = false;
    try { open = (localStorage.getItem('secretaryNotesNavFiltersOpen') || '0') === '1'; } catch(e) {}
    window._notesNavFiltersOpen = open;
  }
  return !!window._notesNavFiltersOpen;
}

function toggleNotesNavFilters() {
  window._notesNavFiltersOpen = !getNotesNavFiltersOpen();
  try { localStorage.setItem('secretaryNotesNavFiltersOpen', window._notesNavFiltersOpen ? '1' : '0'); } catch(e) {}
  renderGroupNav();
}

function buildGroupNavFiltersSection() {
  const groups = getOrderedTagsFromNotes(manifest, n => n.group_tags || []);
  const workstreams = getKnownWorkstreamsList(manifest);
  const majors = getOrderedTagsFromNotes(manifest, n => n.major_topic_tags || []);
  const topics = getOrderedTagsFromNotes(manifest, n => n.topic_tags || []);
  if (!groups.length && !workstreams.length && !majors.length && !topics.length && !activeFilter && activeGroup === 'All') return '';

  const open = getNotesNavFiltersOpen();
  const clearBtn = (activeFilter || activeGroup !== 'All')
    ? `<button class="group-nav-filter-chip danger" onclick="clearFilter()" title="${escA(t('board.clearFilterTooltip'))}">${escH(t('board.clearFilter'))}</button>`
    : '';

  const workstreamIcon = (typeof AppIcons !== 'undefined' && AppIcons.get)
    ? AppIcons.get('workstream', { size: 12 })
    : '<svg class="app-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 9v12"/><path d="M18 9a9 9 0 0 0-9 9"/></svg>';

  const workstreamRow = workstreams.length
    ? `<div class="group-nav-filter-row">
        <span class="group-nav-filter-label">${escH(t('board.filterWorkstream') || 'Workstream')}</span>
        <div class="group-nav-filter-chips">
          ${workstreams.map(ws => `<button class="group-nav-filter-chip${activeFilter?.type === 'workstream' && activeFilter?.value === ws ? ' active' : ''}" onclick="setFilter('workstream',${jq(ws)})" title="${escA(t('board.filterLane', { value: ws }))}">${workstreamIcon} <span>${escH(ws)}</span></button>`).join('')}
        </div>
      </div>`
    : '';

  const groupRow = groups.length
    ? `<div class="group-nav-filter-row">
        <span class="group-nav-filter-label">${escH(t('axis.groups') || 'Group')}</span>
        <div class="group-nav-filter-chips">
          ${groups.map(g => `<button class="group-nav-filter-chip${(activeFilter?.type === 'group' && activeFilter?.value === g) || (activeGroup === g && !activeFilter) ? ' active' : ''}" onclick="setFilter('group',${jq(g)})" title="${escA(t('board.filterLane', { value: g }))}">${escH(g)}</button>`).join('')}
        </div>
      </div>`
    : '';

  const majorRow = majors.length
    ? `<div class="group-nav-filter-row">
        <span class="group-nav-filter-label">${escH(t('week.major'))}</span>
        <div class="group-nav-filter-chips">
          ${majors.map(m => `<button class="group-nav-filter-chip${activeFilter?.type === 'major' && activeFilter?.value === m ? ' active' : ''}" onclick="setFilter('major',${jq(m)})" title="${escA(t('board.filterLane', { value: m }))}">${escH(m)}</button>`).join('')}
        </div>
      </div>`
    : '';

  const topicRow = topics.length
    ? `<div class="group-nav-filter-row">
        <span class="group-nav-filter-label">${escH(t('week.topic'))}</span>
        <div class="group-nav-filter-chips">
          ${topics.map(topic => `<button class="group-nav-filter-chip${activeFilter?.type === 'topic' && activeFilter?.value === topic ? ' active' : ''}" onclick="setFilter('topic',${jq(topic)})" title="${escA(t('board.filterLane', { value: topic }))}">${escH(topic)}</button>`).join('')}
        </div>
      </div>`
    : '';

  return `
    <div class="group-nav-filters${open ? '' : ' collapsed'}">
      <button class="group-nav-filters-header" onclick="toggleNotesNavFilters()" title="${escA(t('subrow.filterTooltip') || 'Toggle filters panel')}">
        <span>${escH(t('subrow.filter') || 'Filter')}</span>
        <span class="group-nav-filters-chevron">▾</span>
      </button>
      <div class="group-nav-filters-body">
        ${workstreamRow}
        ${groupRow}
        ${majorRow}
        ${topicRow}
        ${clearBtn ? `<div class="group-nav-filter-row">${clearBtn}</div>` : ''}
      </div>
    </div>
  `;
}



function defaultSplitPartitionType(type) {
  if (type === 'major') return 'group';
  if (type === 'group') return 'major';
  return 'major';
}

function defaultPromoteTargetType(type) {
  if (type === 'topic') return 'major';
  if (type === 'major') return 'group';
  return 'major';
}

function getLabelManagerTargetInputId(tab = labelManagerState?.tab) {
  if (tab === 'rename') return 'lm-rename-target';
  if (tab === 'merge') return 'lm-merge-target';
  if (tab === 'promote') return 'lm-promote-label';
  return null;
}

function getLabelManagerBadgeStyle(type, label) {
  if (type === 'group') return { bg: '#dbeafe', text: '#1e40af' };
  if (type === 'major') return { bg: '#fef3c7', text: '#92400e' };
  return colorForGroup(label);
}

function closeLabelManagerDropdown() {
  const old = document.getElementById('lm-label-picker-dropdown');
  if (old) old.remove();
}

function focusLabelManagerPrimaryInput() {
  const modal = document.getElementById('modal-label-manager');
  if (!modal || !labelManagerState) return;
  let target = null;
  target = modal.querySelector('.lm-picker-input') || modal.querySelector('.lm-split-target');
  if (!target && labelManagerState.tab === 'split') {
    target = modal.querySelector('.lm-split-target');
  }
  if (target && typeof target.focus === 'function') {
    target.focus();
    if (typeof target.select === 'function') target.select();
  }
}

function labelManagerPickSuggestion(event, label, inputId) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  if (!labelManagerState || !label) return;
  const target = (inputId && document.getElementById(inputId)) || null;
  if (!target || !(target.classList.contains('lm-picker-input') || target.classList.contains('lm-split-target'))) return;

  if (labelManagerState.tab === 'rename' && inputId === 'lm-rename-target') {
    // Pivot to merge tab immediately!
    labelManagerState.tab = 'merge';
    renderLabelManager();
    const mergeInput = document.getElementById('lm-merge-target');
    if (mergeInput) {
      mergeInput.value = label;
      mergeInput.dispatchEvent(new Event('input', { bubbles: true }));
      mergeInput.focus();
      if (typeof mergeInput.select === 'function') mergeInput.select();
    }
    toast(t('common.renamePivotedToMerge') || 'Label already exists; pivoted to merge.');
    return;
  }

  target.value = label;
  target.dispatchEvent(new Event('input', { bubbles: true }));
  target.focus();
  if (typeof target.select === 'function') target.select();
}

function getLabelManagerSuggestionType(input) {
  if (!input) return labelManagerState?.type || 'topic';
  if (input.dataset.suggestType) return input.dataset.suggestType;
  if (labelManagerState?.tab === 'promote') return labelManagerState.promoteType || defaultPromoteTargetType(labelManagerState.type);
  return labelManagerState?.type || 'topic';
}

function renderLabelManagerDropdown(input) {
  if (!input || !labelManagerState) return;
  closeLabelManagerDropdown();

  const suggestType = getLabelManagerSuggestionType(input);
  const isDirty = input.dataset.lmDirty === '1';
  const query = isDirty ? String(input.value || '').trim().toLowerCase() : '';

  let labels = [...new Set(knownTagsForType(suggestType).map(v => String(v || '').trim()).filter(Boolean))];

  labels.sort((a, b) => {
    const aq = query && a.toLowerCase().startsWith(query) ? 0 : 1;
    const bq = query && b.toLowerCase().startsWith(query) ? 0 : 1;
    if (aq !== bq) return aq - bq;
    const ae = query && a.toLowerCase() === query ? 0 : 1;
    const be = query && b.toLowerCase() === query ? 0 : 1;
    if (ae !== be) return ae - be;
    return a.localeCompare(b);
  });

  const visible = query ? labels.filter(t => t.toLowerCase().includes(query)) : labels;
  const dropdown = document.createElement('div');
  dropdown.id = 'lm-label-picker-dropdown';
  dropdown.className = 'tag-suggest-dropdown lm-label-picker-dropdown';
  dropdown.style.position = 'fixed';
  const rect = input.getBoundingClientRect();
  dropdown.style.top = (rect.bottom + 4) + 'px';
  dropdown.style.left = rect.left + 'px';
  dropdown.style.minWidth = Math.max(260, Math.round(rect.width)) + 'px';
  dropdown.style.maxWidth = Math.min(420, Math.max(260, window.innerWidth - rect.left - 16)) + 'px';

  const title = document.createElement('div');
  title.className = 'tag-suggest-section';
  title.textContent = t('common.existingLabels', { type: getLabelTypeTitle(suggestType) });
  dropdown.appendChild(title);

  if (visible.length) {
    const chips = document.createElement('div');
    chips.className = 'tag-suggest-chips';
    visible.forEach(tag => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tag-suggest-chip' + (tag === input.value.trim() ? ' assigned' : '');
      const style = getLabelManagerBadgeStyle(suggestType, tag);
      btn.style.background = style.bg;
      btn.style.color = style.text;
      btn.textContent = tag;
      btn.title = t('common.clickToFillFieldWith', { tag });
      btn.addEventListener('mousedown', e => labelManagerPickSuggestion(e, tag, input.id));
      chips.appendChild(btn);
    });
    dropdown.appendChild(chips);
  } else {
    const empty = document.createElement('div');
    empty.className = 'tag-suggest-empty';
    empty.textContent = query
      ? t('common.noLabelsMatch', { type: getLabelTypeTitle(suggestType), value: input.value.trim() })
      : t('common.noLabelsYet', { type: getLabelTypeTitle(suggestType) });
    dropdown.appendChild(empty);
    const hint = document.createElement('div');
    hint.className = 'tag-suggest-empty';
    hint.textContent = t('common.pressEnterKeep');
    dropdown.appendChild(hint);
  }

  document.body.appendChild(dropdown);
}

function initLabelManagerPickers() {
  const modal = document.getElementById('modal-label-manager');
  if (!modal) return;
  modal.querySelectorAll('.lm-picker-input, .lm-split-target').forEach(input => {
    if (input.dataset.lmPickerBound === '1') return;
    input.dataset.lmPickerBound = '1';
    input.dataset.lmDirty = '0';
    const refresh = () => renderLabelManagerDropdown(input);
    input.addEventListener('focus', refresh);
    input.addEventListener('click', refresh);
    input.addEventListener('input', () => {
      input.dataset.lmDirty = '1';
      renderLabelManagerDropdown(input);
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeLabelManagerDropdown();
      }
    });
    input.addEventListener('blur', () => {
      setTimeout(() => {
        const active = document.activeElement;
        if (active && modal.contains(active) && (active.classList.contains('lm-picker-input') || active.classList.contains('lm-split-target'))) return;
        closeLabelManagerDropdown();
      }, 120);
    });
  });
}

function closeLabelManager() {
  closeLabelManagerDropdown();
  labelManagerState = null;
  closeModal('modal-label-manager');
}

function openLabelManager(type, label, tab = 'rename') {
  if (type === 'week' || !label || label === '(Untagged)') return;
  labelManagerState = {
    type,
    label,
    tab,
    partitionType: defaultSplitPartitionType(type),
    promoteType: defaultPromoteTargetType(type),
  };
  renderLabelManager();
  openModal('modal-label-manager');
}

function setLabelManagerTab(tab) {
  if (!labelManagerState) return;
  labelManagerState.tab = tab;
  renderLabelManager();
}

function setLabelManagerPartitionType(val) {
  if (!labelManagerState) return;
  labelManagerState.partitionType = val;
  renderLabelManager();
}

function setLabelManagerPromoteType(val) {
  if (!labelManagerState) return;
  labelManagerState.promoteType = val;
  renderLabelManager();
}

function renderLabelManager() {
  const body = document.getElementById('label-manager-body');
  const titleEl = document.getElementById('label-manager-title');
  if (!body || !labelManagerState) return;
  closeLabelManagerDropdown();

  const { type, label, tab, partitionType } = labelManagerState;
  const promoteType = labelManagerState.promoteType || defaultPromoteTargetType(type);
  labelManagerState.promoteType = promoteType;
  const typeTitle = getLabelTypeTitle(type);
  const usageNotes = getNotesByLabel(type, label);
  const partitionOptions = ['group', 'major', 'topic'];
  const splitBuckets = getSplitBuckets(type, label, partitionType);
  const bucketRows = splitBuckets.length ? splitBuckets.map(([bucket, notes]) => {
    const safeBucket = `lm-bucket-${slugify(bucket || 'untagged')}-${Math.random().toString(36).slice(2, 6)}`;
    return `<div class="lm-split-row">
      <div class="lm-split-bucket">
        <div class="lm-split-bucket-name">${escH(bucket)}</div>
        <div class="lm-split-bucket-count">${notes.length} note${notes.length !== 1 ? 's' : ''}</div>
      </div>
      <input class="lm-input lm-picker-input lm-split-target" id="${safeBucket}" data-bucket="${escA(bucket)}" data-suggest-type="${escA(type)}" type="text" value="${escA(label)}" placeholder="${escA(t('common.typeOrClickSuggestion'))}" title="${escA(t('common.typeOrClickSuggestion'))}" autocomplete="off" spellcheck="false" autocapitalize="off">
    </div>`;
  }).join('') : '<div class="lm-empty">No notes match this label.</div>';

  const typeBadgeStyle = getLabelManagerBadgeStyle(type, label);
  const typeBadgeHTML = `<span class="lm-type-chip" style="background:${typeBadgeStyle.bg};color:${typeBadgeStyle.text}">${escH(typeTitle)}</span>`;

  if (titleEl) titleEl.textContent = `${typeTitle}: ${label}`;
  body.innerHTML = `
    <div class="lm-shell">
      <div class="lm-main">
        <div class="lm-hero">
          <div>
            <div class="lm-kicker">${escH(t('editor.labelManager'))}</div>
            <div class="lm-title-row">${typeBadgeHTML}<span class="lm-current-label">${escH(label)}</span></div>
            <div class="lm-summary">${escH(t('editor.labelManagerSummary', { count: usageNotes.length, noteWord: word('note', usageNotes.length) }))}</div>
          </div>
          <div class="lm-hero-tip">${escH(t('editor.labelManagerHeroTip'))}</div>
        </div>
        <div class="lm-tabs">
          <button class="pane-btn lm-tab${tab === 'rename' ? ' on' : ''}" onclick="setLabelManagerTab('rename')" title="${escA(t('editor.labelManagerRename'))}">${escH(t('editor.labelManagerRename'))}</button>
          <button class="pane-btn lm-tab${tab === 'merge' ? ' on' : ''}" onclick="setLabelManagerTab('merge')" title="${escA(t('editor.labelManagerMerge'))}">${escH(t('editor.labelManagerMerge'))}</button>
          <button class="pane-btn lm-tab${tab === 'promote' ? ' on' : ''}" onclick="setLabelManagerTab('promote')" title="${escA(t('editor.labelManagerPromote'))}">${escH(t('editor.labelManagerPromote'))}</button>
          <button class="pane-btn lm-tab${tab === 'split' ? ' on' : ''}" onclick="setLabelManagerTab('split')" title="${escA(t('editor.labelManagerSplitTooltip'))}">${escH(t('editor.labelManagerSplit'))}</button>
        </div>
        <div class="lm-panel">
          ${tab === 'rename' ? `
            <div class="lm-field-card">
              <label class="lm-field-label">${escH(t('editor.labelManagerRenameTo'))}</label>
              <input class="lm-input lm-picker-input" id="lm-rename-target" data-suggest-type="${escA(type)}" data-lm-role="rename" type="text" value="${escA(label)}" placeholder="${escA(t('common.typeOrClickSuggestion'))}" title="${escA(t('common.typeOrClickSuggestion'))}" autocomplete="off" spellcheck="false" autocapitalize="off">
              <div class="lm-field-hint">${escH(t('editor.labelManagerRenameHint', { type: typeTitle.toLowerCase() }))}</div>
            </div>
          ` : ''}
          ${tab === 'merge' ? `
            <div class="lm-field-card">
              <label class="lm-field-label">${escH(t('editor.labelManagerMergeInto'))}</label>
              <input class="lm-input lm-picker-input" id="lm-merge-target" data-suggest-type="${escA(type)}" data-lm-role="merge" type="text" placeholder="${escA(t('common.typeOrClickSuggestion'))}" title="${escA(t('common.typeOrClickSuggestion'))}" autocomplete="off" spellcheck="false" autocapitalize="off">
              <div class="lm-field-hint">${escH(t('editor.labelManagerMergeHint'))}</div>
            </div>
          ` : ''}
          ${tab === 'promote' ? `
            <div class="lm-field-card">
              <label class="lm-field-label">${escH(t('editor.labelManagerPromoteToType'))}</label>
              <select class="lm-input" id="lm-promote-type" onchange="setLabelManagerPromoteType(this.value)" title="${escA(t('editor.labelManagerPromoteToType'))}">
                ${partitionOptions.filter(t => t !== type).map(t => `<option value="${t}"${t === promoteType ? ' selected' : ''}>${getLabelTypeTitle(t)}</option>`).join('')}
              </select>
              <div class="lm-field-hint">${escH(t('editor.labelManagerPromoteHint'))}</div>
            </div>
            <div class="lm-field-card">
              <label class="lm-field-label">${escH(t('editor.labelManagerTargetLabel'))}</label>
              <input class="lm-input lm-picker-input" id="lm-promote-label" data-suggest-type="${escA(promoteType)}" data-lm-role="promote" type="text" value="${escA(label)}" placeholder="${escA(t('common.typeOrClickSuggestion'))}" title="${escA(t('common.typeOrClickSuggestion'))}" autocomplete="off" spellcheck="false" autocapitalize="off">
              <div class="lm-field-hint">${escH(t('editor.labelManagerPromoteSuggestions'))}</div>
            </div>
          ` : ''}
          ${tab === 'split' ? `
            <div class="lm-field-card">
              <label class="lm-field-label">${escH(t('editor.labelManagerSplitBy'))}</label>
              <select class="lm-input" id="lm-split-partition" onchange="setLabelManagerPartitionType(this.value)" title="${escA(t('editor.labelManagerSplitBy'))}">
                ${partitionOptions.map(t => `<option value="${t}"${t === partitionType ? ' selected' : ''}>${getLabelTypeTitle(t)}</option>`).join('')}
              </select>
              <div class="lm-field-hint">${escH(t('editor.labelManagerSplitHint', { type: typeTitle.toLowerCase() }))}</div>
            </div>
            <div class="lm-split-table">${bucketRows}</div>
          ` : ''}
        </div>
        <div class="modal-actions">
          <button class="btn" onclick="closeLabelManager()" title="${escA(t('board.cancel'))}">${escH(t('board.cancel'))}</button>
          <button class="btn btn-danger" onclick="removeLabelFromManager()" title="${escA(t('editor.labelManagerRemove'))}">${escH(t('editor.labelManagerRemove'))}</button>
          <button class="btn btn-save" onclick="applyLabelManagerAction()" title="${tab === 'rename' ? escA(t('editor.labelManagerRenameHint', { type: typeTitle.toLowerCase() })) : tab === 'merge' ? escA(t('editor.labelManagerMergeHint')) : tab === 'promote' ? escA(t('editor.labelManagerPromoteHint')) : escA(t('editor.labelManagerSplitHint', { type: typeTitle.toLowerCase() }))}">${tab === 'rename' ? escH(t('editor.labelManagerRename')) : tab === 'merge' ? escH(t('editor.labelManagerMerge')) : tab === 'promote' ? escH(t('editor.labelManagerPromote')) : escH(t('editor.labelManagerApplySplit'))}</button>
        </div>
      </div>
      <div class="lm-side">
        <div class="lm-side-title">${escH(t('editor.labelManagerHowItWorks'))}</div>
        <p class="lm-side-copy">${escH(t('editor.labelManagerHint1'))}</p>
        <p class="lm-side-copy">${escH(t('editor.labelManagerHint2'))}</p>
      </div>
    </div>
  `;
  initLabelManagerPickers();
  requestAnimationFrame(focusLabelManagerPrimaryInput);
}

async function applyLabelManagerAction() {
  if (!labelManagerState) return;
  const { type, label, tab, partitionType } = labelManagerState;
  try {
    let changed = 0;
    if (tab === 'rename') {
      const target = document.getElementById('lm-rename-target')?.value.trim();
      if (knownTagsForType(type).includes(target)) {
        // pivot to merge!
        labelManagerState.tab = 'merge';
        renderLabelManager();
        const mergeInput = document.getElementById('lm-merge-target');
        if (mergeInput) {
          mergeInput.value = target;
          mergeInput.dispatchEvent(new Event('input', { bubbles: true }));
          mergeInput.focus();
          if (typeof mergeInput.select === 'function') mergeInput.select();
        }
        toast(t('common.renamePivotedToMerge') || 'Label already exists; pivoted to merge.');
        return;
      }
      changed = await renameLabelAcrossNotes(type, label, target);
    } else if (tab === 'merge') {
      const target = document.getElementById('lm-merge-target')?.value.trim();
      changed = await mergeLabelAcrossNotes(type, label, target);
    } else if (tab === 'promote') {
      const toType = document.getElementById('lm-promote-type')?.value || type;
      const target = document.getElementById('lm-promote-label')?.value.trim() || label;
      if (toType === type) throw new Error('Choose a different target type');
      changed = await promoteLabelAcrossNotes(type, label, toType, target);
    } else if (tab === 'split') {
      const rows = [...document.querySelectorAll('.lm-split-target')];
      const mappings = {};
      rows.forEach(row => {
        mappings[row.dataset.bucket || '(Untagged)'] = row.value.trim();
      });
      changed = await splitLabelAcrossNotes(type, label, partitionType, mappings);
    }

    if (!changed) {
      toast(t('common.noChangesMade'), true);
      return;
    }
    await rebuildIndexHTML();
    renderFilterChips();
    renderBoard();
    toast(t('common.updatedNotes', { count: changed, noteWord: word('note', changed) }));
    closeLabelManager();
  } catch (e) {
    toast(t('common.labelUpdateFailed', { message: e.message }), true);
  }
}

async function removeLabelFromManager() {
  if (!labelManagerState) return;
  const { type, label } = labelManagerState;
  const count = getNotesByLabel(type, label).length;
  if (!count) {
    toast(t('common.noNotesUseLabel'), true);
    return;
  }
  const confirmed = await showConfirmDialog(t('confirm.removeLabel', { label, count, noteWord: word('note', count) }), { isDanger: true, confirmLabel: t('editor.labelManagerRemove') || 'Remove' });
  if (!confirmed) return;
  try {
    const changed = await removeLabelAcrossNotes(type, label);
    if (!changed) {
      toast(t('common.noChangesMade'), true);
      return;
    }
    await rebuildIndexHTML();
    renderFilterChips();
    renderBoard();
    toast(t('common.labelManagerRemoved', { count: changed, noteWord: word('note', changed) }));
    closeLabelManager();
  } catch (e) {
    toast(t('common.labelRemovalFailed', { message: e.message }), true);
  }
}

function cycleGroupNavState() {
  const states = ['full', 'compact'];
  groupNavState = states[(states.indexOf(groupNavState) + 1) % states.length];
  try { localStorage.setItem('secretaryGroupNavState', groupNavState); } catch(e) {}
  renderGroupNav();
}

function computeGroupNavState() {
  const w = document.getElementById('app-body')?.offsetWidth || 0;
  if (w >= 1200) return 'full';
  return 'compact';
}

let _groupNavResizeObserver = null;
function setupGroupNavResize() {
  if (_groupNavResizeObserver) _groupNavResizeObserver.disconnect();
  const appBody = document.getElementById('app-body');
  if (!appBody || typeof ResizeObserver === 'undefined') return;
  _groupNavResizeObserver = new ResizeObserver(() => {
    if (activeTab === 'planner' || activeTab === 'team' || activeTab === 'retro' || activeTab === 'prefs') return;
    const next = computeGroupNavState();
    if (next !== groupNavState) { groupNavState = next; renderGroupNav(); }
  });
  _groupNavResizeObserver.observe(appBody);
}

function toggleLaneSortMode() {
  const next = laneSortMode === 'recent' ? 'alpha' : 'recent';
  if (typeof prefsLaneSortChanged === 'function') {
    prefsLaneSortChanged(next);
  } else {
    laneSortMode = next;
    try { localStorage.setItem('secretaryLaneSort', next); } catch(e) {}
    renderBoard();
  }
}

function _applyLaneScrollAndPulse(lane) {
  if (!lane) return;
  const main = document.getElementById('app-main');
  if (main) {
    const mainRect = main.getBoundingClientRect();
    const laneRect = lane.getBoundingClientRect();
    main.scrollBy({ top: laneRect.top - mainRect.top - 8, behavior: 'smooth' });
  } else {
    lane.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  lane.classList.remove('lane-pulse-target');
  void lane.offsetWidth;
  lane.classList.add('lane-pulse-target');
  setTimeout(() => lane.classList.remove('lane-pulse-target'), 1200);
}

function scrollToLane(laneVal) {
  const lane = document.querySelector(`#swimlane-board .sl-lane[data-lane="${CSS.escape(laneVal)}"]`);
  if (!lane) {
    requestAnimationFrame(() => {
      const retryLane = document.querySelector(`#swimlane-board .sl-lane[data-lane="${CSS.escape(laneVal)}"]`);
      if (retryLane) _applyLaneScrollAndPulse(retryLane);
    });
    return;
  }
  _applyLaneScrollAndPulse(lane);
}

async function navClickLane(laneVal) {
  // If a filter is currently active and hiding this lane, reset the filter so the lane is visible
  if (laneAxis === 'group' && activeGroup !== 'All' && activeGroup !== laneVal) {
    activeGroup = 'All';
    renderFilterBarChips();
    await renderBoard();
  } else if (laneAxis === 'major' && activeFilter?.type === 'major' && activeFilter?.value !== laneVal) {
    activeFilter = null;
    renderFilterBarChips();
    await renderBoard();
  }
  scrollToLane(laneVal);
}

async function navDoubleClickLane(laneVal) {
  if (laneAxis === 'group') {
    await setFilter('group', laneVal);
  } else if (laneAxis === 'major') {
    await setFilter('major', laneVal);
  }
  scrollToLane(laneVal);
}

function updateActiveFilterChip() {
  const container = document.getElementById('active-filter-chip-container');
  if (!container) return;
  const isNotes = (typeof activeTab === 'undefined' || activeTab === 'notes')
    && (typeof boardMode === 'undefined' || boardMode === 'notes');
  if (!isNotes) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }
  if (activeFilter) {
    const typeLabel = activeFilter.type === 'group' ? (t('axis.groups') || 'Group')
      : activeFilter.type === 'major' ? (t('week.major') || 'Major')
      : activeFilter.type === 'workstream' ? (t('board.filterWorkstream') || 'Workstream')
      : (t('week.topic') || 'Topic');
    const filterLabel = `${typeLabel}: ${activeFilter.value}`;
    container.style.display = '';
    container.innerHTML = `<button class="active-filter-chip" onclick="clearFilter()" title="${escA(t('board.clearActiveFilterTooltip', { value: filterLabel }))}">${escH(activeFilter.value)} ×</button>`;
  } else if (activeGroup && activeGroup !== 'All') {
    const filterLabel = `${t('axis.groups') || 'Group'}: ${activeGroup}`;
    container.style.display = '';
    container.innerHTML = `<button class="active-filter-chip" onclick="clearFilter()" title="${escA(t('board.clearActiveFilterTooltip', { value: filterLabel }))}">${escH(activeGroup)} ×</button>`;
  } else {
    container.innerHTML = '';
    container.style.display = 'none';
  }
}

function newNoteInLane() {
  openNoteOverlay(null);
}

function loadMoreNotesInLane(laneVal) {
  triggerInfiniteLaneLoad(laneVal);
}

// ── Notes Tab View Mode State & Handlers ─────────────────────────────────────
function setNotesViewMode(mode) {
  if (mode === 'tree') mode = 'map';
  if (!['map', 'reader'].includes(mode)) return;
  notesViewMode = mode;
  try { localStorage.setItem('secretaryNotesViewMode', mode); } catch(e) {}
  if (typeof updateSubRowVisibility === 'function') updateSubRowVisibility();
  renderBoard();
}

function setMapZoomLevel(zoom) {
  if (!['weeks', 'months', 'years'].includes(zoom)) return;
  mapZoomLevel = zoom;
  try { localStorage.setItem('secretaryMapZoomLevel', zoom); } catch(e) {}
  if (typeof updateSubRowVisibility === 'function') updateSubRowVisibility();
  renderBoard();
}

function reviewTreeNode(type, value) {
  notesReaderTarget = { type, value };
  setNotesViewMode('reader');
}

function clearNotesReaderTarget() {
  notesReaderTarget = null;
  renderBoard();
}

function toggleNotesTreeNode(nodeKey) {
  if (notesTreeOpenNodes.has(nodeKey)) {
    notesTreeOpenNodes.delete(nodeKey);
  } else {
    notesTreeOpenNodes.add(nodeKey);
  }
  renderBoard();
}

function expandAllNotesTreeNodes() {
  const items = manifest || [];
  for (const n of items) {
    const g = (n.group_tags && n.group_tags[0]) || '(Untagged)';
    const m = (n.major_topic_tags && n.major_topic_tags[0]) || '(Untagged)';
    const tt = (n.topic_tags && n.topic_tags[0]) || '(Untagged)';
    notesTreeOpenNodes.add('group::' + g);
    notesTreeOpenNodes.add('major::' + g + '::' + m);
    notesTreeOpenNodes.add('topic::' + g + '::' + m + '::' + tt);
  }
  renderBoard();
}

function collapseAllNotesTreeNodes() {
  notesTreeOpenNodes.clear();
  renderBoard();
}

function getMapMilestoneInfo(dateStr, zoomLevel = mapZoomLevel) {
  if (!dateStr) return { key: '__older__', label: t('board.olderNotesLane') || 'Older Notes' };
  const d = parseLocalDateValue(dateStr);
  if (!d || isNaN(d)) return { key: '__older__', label: t('board.olderNotesLane') || 'Older Notes' };

  if (zoomLevel === 'weeks') {
    return getNoteWeekKey(dateStr);
  }

  if (zoomLevel === 'months') {
    const year = d.getFullYear();
    const monthName = typeof formatMonthShort === 'function' ? formatMonthShort(d) : String(d.getMonth() + 1);
    const key = `${year}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = `${monthName} ${year}`;
    return { key, label };
  }

  if (zoomLevel === 'years') {
    const year = d.getFullYear();
    return { key: `${year}`, label: `${year}` };
  }

  return { key: '__older__', label: t('board.olderNotesLane') || 'Older Notes' };
}

// ── Notes Breadcrumb & Navigation Scrubber ────────────────────────────────────
function renderNotesBreadcrumbBar() {
  const bar = document.getElementById('notes-breadcrumb-bar');
  if (!bar) return;

  const isNotes = boardMode === 'notes'
    && activeTab !== 'prefs'
    && activeTab !== 'planner'
    && activeTab !== 'team'
    && activeTab !== 'decisions'
    && activeTab !== 'retro'
    && activeTab !== 'daily-review'
    && activeTab !== 'chat';

  const isReaderView = notesViewMode === 'reader';
  const hasGroupFilter = activeGroup && activeGroup !== 'All';
  const hasTagFilter   = activeFilter && activeFilter.value;
  const hasTarget      = notesReaderTarget && notesReaderTarget.value;

  if (!isNotes || !isReaderView || (!hasGroupFilter && !hasTagFilter && !hasTarget)) {
    bar.style.display = 'none';
    return;
  }

  bar.style.display = 'flex';

  const iconFolder  = (typeof AppIcons !== 'undefined' && AppIcons.get) ? AppIcons.get('files', { size: 14 }) : '📁';
  const iconBook    = (typeof AppIcons !== 'undefined' && AppIcons.get) ? AppIcons.get('bookOpen', { size: 14 }) : '📖';
  const iconChevron = (typeof AppIcons !== 'undefined' && AppIcons.get) ? AppIcons.get('chevronDown', { size: 12 }) : '▾';

  const parts = [];
  parts.push(`
    <button class="breadcrumb-item" onclick="showBreadcrumbDropdown(event, 'group')" title="${escA(t('notes.breadcrumbTooltip'))}">
      ${iconFolder} <span>${escH(t('notes.allGroups'))}</span> <span style="font-size:0.7rem;opacity:0.7;margin-left:2px">${iconChevron}</span>
    </button>
  `);

  if (hasGroupFilter) {
    const color = colorForGroup(activeGroup);
    parts.push(`<span class="breadcrumb-sep">›</span>`);
    parts.push(`
      <button class="breadcrumb-item active" style="color:${color.text};cursor:pointer" onclick="showBreadcrumbDropdown(event, 'group')" title="${escA(t('notes.breadcrumbTooltip'))}">
        ${escH(activeGroup)} <span style="font-size:0.7rem;opacity:0.7;margin-left:2px">${iconChevron}</span>
      </button>
    `);
  }

  if (hasTagFilter) {
    parts.push(`<span class="breadcrumb-sep">›</span>`);
    parts.push(`
      <button class="breadcrumb-item active" style="cursor:pointer" onclick="showBreadcrumbDropdown(event, 'tag')" title="${escA(t('notes.breadcrumbTooltip'))}">
        ${escH(activeFilter.value)} <span style="font-size:0.7rem;opacity:0.7;margin-left:2px">${iconChevron}</span>
      </button>
    `);
  }

  if (hasTarget) {
    parts.push(`<span class="breadcrumb-sep">›</span>`);
    parts.push(`
      <button class="breadcrumb-item active" style="color:var(--accent);cursor:pointer" onclick="showBreadcrumbDropdown(event, 'target')" title="${escA(t('notes.breadcrumbTooltip'))}">
        ${iconBook} <span>${escH(notesReaderTarget.value)}</span> <span style="font-size:0.7rem;opacity:0.7;margin-left:2px">${iconChevron}</span>
      </button>
    `);
  }

  bar.innerHTML = parts.join('');
}

function showBreadcrumbDropdown(event, levelType) {
  event.stopPropagation();
  const triggerEl = event.currentTarget;
  if (!triggerEl) return;

  const existingPopover = document.getElementById('breadcrumb-dropdown-popover');
  if (existingPopover) {
    existingPopover.remove();
    if (triggerEl.getAttribute('data-dropdown-open') === 'true') {
      triggerEl.removeAttribute('data-dropdown-open');
      return;
    }
  }
  triggerEl.setAttribute('data-dropdown-open', 'true');

  const manifestList = (typeof manifest !== 'undefined' && Array.isArray(manifest)) ? manifest : [];
  let options = [];

  if (levelType === 'group') {
    const groups = new Set();
    manifestList.forEach(n => {
      if (n.group_tags && n.group_tags.length) n.group_tags.forEach(g => groups.add(g));
    });
    options = [{ label: t('notes.allGroups') || 'All Groups', value: 'All', icon: '📁' },
      ...[...groups].sort().map(g => ({ label: g, value: g, icon: '🏷️' }))];
  } else if (levelType === 'tag') {
    const tags = new Set();
    manifestList.forEach(n => {
      const allTags = [...(n.group_tags || []), ...(n.major_topic_tags || []), ...(n.topic_tags || []), ...(n.other_tags || [])];
      allTags.forEach(tg => tags.add(tg));
    });
    options = [...tags].sort().map(tg => ({ label: tg, value: tg, icon: '#' }));
  } else if (levelType === 'target') {
    if (notesReaderTarget && notesReaderTarget.type === 'group') {
      const groups = new Set();
      manifestList.forEach(n => {
        if (n.group_tags && n.group_tags.length) n.group_tags.forEach(g => groups.add(g));
      });
      options = [{ label: t('notes.allGroups') || 'All Groups', value: 'All', icon: '📁' },
        ...[...groups].sort().map(g => ({ label: g, value: g, icon: '🏷️' }))];
    } else if (notesReaderTarget && (notesReaderTarget.type === 'major' || notesReaderTarget.type === 'topic' || notesReaderTarget.type === 'tag')) {
      const tags = new Set();
      manifestList.forEach(n => {
        const allTags = [...(n.group_tags || []), ...(n.major_topic_tags || []), ...(n.topic_tags || []), ...(n.other_tags || [])];
        allTags.forEach(tg => tags.add(tg));
      });
      options = [...tags].sort().map(tg => ({ label: tg, value: tg, icon: '#' }));
    } else {
      const targets = new Set();
      manifestList.forEach(n => {
        if (n.date) {
          const year = n.date.slice(0, 4);
          if (/^\d{4}$/.test(year)) targets.add(year);
          const month = n.date.slice(0, 7);
          if (/^\d{4}-\d{2}$/.test(month)) targets.add(month);
        }
      });
      const sortedTargets = [...targets].sort((a, b) => b.localeCompare(a));
      options = sortedTargets.map(trg => ({ label: trg, value: trg, icon: trg.length === 4 ? '📅' : '🚩' }));
    }
  }

  if (!options.length) return;

  const rect = triggerEl.getBoundingClientRect();
  const popover = document.createElement('div');
  popover.id = 'breadcrumb-dropdown-popover';
  popover.className = 'breadcrumb-dropdown-popover';
  const popoverMaxHeight = 280;
  const popoverWidth = 240;
  const spaceBelow = window.innerHeight - rect.bottom;
  let topPos = rect.bottom + 6;
  if (spaceBelow < 200 && rect.top > 200) {
    topPos = Math.max(10, rect.top - popoverMaxHeight - 6);
  }
  const leftPos = Math.max(10, Math.min(rect.left, window.innerWidth - popoverWidth - 10));
  popover.style.cssText = `
    position: fixed;
    top: ${Math.round(topPos)}px;
    left: ${Math.round(leftPos)}px;
    z-index: 9999;
    min-width: 180px;
    max-width: 260px;
    max-height: 280px;
    overflow-y: auto;
    background: var(--card-bg);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md, 8px);
    box-shadow: var(--shadow-lg, 0 10px 25px rgba(0,0,0,0.2));
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  `;

  popover.innerHTML = options.map(opt => `
    <button type="button" class="breadcrumb-dropdown-item" style="padding:6px 10px;font-size:0.82rem;font-weight:600;color:var(--text);border-radius:4px;cursor:pointer;display:flex;align-items:center;gap:8px;transition:background 0.15s ease;background:transparent;border:none;width:100%;text-align:left;font-family:inherit"
      title="${escA(opt.label)}"
      onclick="selectBreadcrumbOption(${jq(levelType)}, ${jq(opt.value)})"
      onmouseover="this.style.background='var(--card-bg-alt)';this.style.color='var(--accent)'"
      onmouseout="this.style.background='transparent';this.style.color='var(--text)'">
      <span>${opt.icon}</span> <span>${escH(opt.label)}</span>
    </button>
  `).join('');

  document.body.appendChild(popover);

  const closeHandler = (e) => {
    if (!popover.contains(e.target) && !triggerEl.contains(e.target)) {
      popover.remove();
      triggerEl.removeAttribute('data-dropdown-open');
      window.removeEventListener('click', closeHandler);
    }
  };
  setTimeout(() => window.addEventListener('click', closeHandler), 5);
}

function selectBreadcrumbOption(levelType, value) {
  const popover = document.getElementById('breadcrumb-dropdown-popover');
  if (popover) popover.remove();

  if (levelType === 'group') {
    if (value === 'All') {
      activeGroup = 'All';
      if (notesReaderTarget && notesReaderTarget.type === 'group') {
        notesReaderTarget = null;
      }
    } else {
      activeGroup = value;
      if (notesViewMode === 'reader') {
        notesReaderTarget = { type: 'group', value };
      }
    }
    renderBoard();
  } else if (levelType === 'tag') {
    if (notesViewMode === 'reader') {
      notesReaderTarget = { type: 'topic', value };
      renderBoard();
    } else {
      setFilter('topic', value);
    }
  } else if (levelType === 'target') {
    if (notesReaderTarget && notesReaderTarget.type === 'group') {
      if (value === 'All') {
        activeGroup = 'All';
        notesReaderTarget = null;
      } else {
        activeGroup = value;
        notesReaderTarget = { type: 'group', value };
      }
    } else if (notesReaderTarget && (notesReaderTarget.type === 'major' || notesReaderTarget.type === 'topic' || notesReaderTarget.type === 'tag')) {
      notesReaderTarget = { type: 'topic', value };
    } else {
      const type = value.length === 4 ? 'year' : (value.length === 7 ? 'month' : 'milestone');
      notesReaderTarget = { type, value };
    }
    renderBoard();
  }
}

function setGroupFilter(value) {
  activeGroup = (!value || value === 'All') ? 'All' : value;
  if (notesViewMode === 'reader') {
    if (activeGroup !== 'All') {
      notesReaderTarget = { type: 'group', value: activeGroup };
    } else if (notesReaderTarget?.type === 'group') {
      notesReaderTarget = null;
    }
  }
  if (typeof renderFilterBarChips === 'function') renderFilterBarChips();
  return renderBoard();
}

function setTagFilter(type, value) {
  return setFilter(type, value);
}

function setNotesReaderTarget(type, value) {
  if (!type && !value) {
    clearNotesReaderTarget();
    return;
  }
  notesReaderTarget = { type, value };
  if (notesViewMode !== 'reader') {
    setNotesViewMode('reader');
  } else {
    renderBoard();
  }
}

function renderGroupNav() {
  renderNotesBreadcrumbBar();
}

function getPlannedNotesFromBlocs(existingItems = [], allVaultNotes = null) {
  if (typeof plannerEvents === 'undefined' || !Array.isArray(plannerEvents)) return [];

  // 1. Identify all events that are already associated with a note in the vault
  const vaultNotes = allVaultNotes || (typeof manifest !== 'undefined' && Array.isArray(manifest) ? manifest : existingItems);
  const allVaultIds = new Set(vaultNotes.map(n => n.id).filter(Boolean));
  const allVaultPaths = new Set(vaultNotes.map(n => n.path).filter(Boolean));
  const existingPaths = new Set((existingItems || []).map(n => n.path).filter(Boolean));
  const plannedNotes = [];
  const todayStr = formatLocalDateValue(new Date());

  for (const ev of plannerEvents) {
    if (!ev || !ev.date) continue;
    if (ev.type === 'custom' || ev.type === 'ooo') continue;

    // Check if event already has a note in the vault (even if filtered out from existingItems)
    const noteId = String(ev.noteId || '').trim();
    if (noteId && allVaultIds.has(noteId)) continue;

    const linkedIds = Array.isArray(ev.linkedNoteIds) ? ev.linkedNoteIds : [];
    if (linkedIds.some(id => allVaultIds.has(String(id).trim()))) continue;

    if (ev.notePath && allVaultPaths.has(ev.notePath)) continue;

    const virtualPath = `virtual:planned:${ev.id}`;
    if (existingPaths.has(virtualPath)) continue;

    const isPastBloc = ev.date < todayStr;
    const defaultTitle = isPastBloc
      ? (t('board.blocWithoutNote') || 'Bloc without Note')
      : (t('board.plannedNote') || 'Planned Note');

    const plannedNote = {
      isPlannedNote: true,
      isPastBlocWithoutNote: isPastBloc,
      id: `planned-${ev.id}`,
      path: virtualPath,
      title: ev.noteTitle || ev.title || defaultTitle,
      date: ev.date,
      group_tags: ev.group_tags || [],
      major_topic_tags: ev.major_topic_tags || [],
      topic_tags: ev.topic_tags || [],
      workstream: ev.workstream || '',
      summary: `${ev.date} ${ev.startTime || ''} – ${ev.title || ''}`,
      preview: `${defaultTitle} (${ev.date} ${ev.startTime || ''})`,
      event: ev
    };

    // 2. Filter planned notes by activeGroup
    if (typeof activeGroup !== 'undefined' && activeGroup && activeGroup !== 'All') {
      if (activeGroup === '(Untagged)') {
        if (plannedNote.group_tags && plannedNote.group_tags.length && !plannedNote.group_tags.includes('(Untagged)')) {
          continue;
        }
      } else if (!plannedNote.group_tags || !plannedNote.group_tags.includes(activeGroup)) {
        continue;
      }
    }

    // 3. Filter planned notes by activeFilter
    if (typeof activeFilter !== 'undefined' && activeFilter && activeFilter.value) {
      const { type, value } = activeFilter;
      if (type === 'workstream') {
        const matchesWs = plannedNote.workstream === value ||
          (typeof getNoteWorkstreams === 'function' && getNoteWorkstreams(plannedNote).includes(value));
        if (!matchesWs) continue;
      } else if (type === 'group') {
        if (value === '(Untagged)') {
          if (plannedNote.group_tags && plannedNote.group_tags.length && !plannedNote.group_tags.includes('(Untagged)')) continue;
        } else if (!plannedNote.group_tags || !plannedNote.group_tags.includes(value)) {
          continue;
        }
      } else if (type === 'major') {
        if (value === '(Untagged)') {
          if (plannedNote.major_topic_tags && plannedNote.major_topic_tags.length && !plannedNote.major_topic_tags.includes('(Untagged)')) continue;
        } else if (!plannedNote.major_topic_tags || !plannedNote.major_topic_tags.includes(value)) {
          continue;
        }
      } else {
        if (value === '(Untagged)') {
          if (plannedNote.topic_tags && plannedNote.topic_tags.length && !plannedNote.topic_tags.includes('(Untagged)')) continue;
        } else if (!plannedNote.topic_tags || !plannedNote.topic_tags.includes(value)) {
          continue;
        }
      }
    }

    // 4. Filter planned notes by searchQuery
    if (typeof searchQuery !== 'undefined' && searchQuery) {
      const q = String(searchQuery || '').trim();
      if (q) {
        const qLower = q.toLowerCase();
        let re = null;
        if (typeof searchRegex !== 'undefined' && searchRegex) {
          try { re = new RegExp(q, (typeof searchCaseSensitive !== 'undefined' && searchCaseSensitive) ? '' : 'i'); } catch(e) { re = null; }
        }
        const title = plannedNote.title || '';
        const tags = [...(plannedNote.group_tags || []), ...(plannedNote.major_topic_tags || []), ...(plannedNote.topic_tags || [])];
        const summary = plannedNote.summary || '';
        const preview = plannedNote.preview || '';

        let matches = false;
        if (re) {
          matches = re.test(title) || tags.some(t => re.test(t)) || re.test(summary) || re.test(preview);
        } else if (typeof searchCaseSensitive !== 'undefined' && searchCaseSensitive) {
          matches = title.includes(q) || tags.some(t => t.includes(q)) || summary.includes(q) || preview.includes(q);
        } else {
          matches = title.toLowerCase().includes(qLower) || tags.some(t => t.toLowerCase().includes(qLower)) || summary.toLowerCase().includes(qLower) || preview.toLowerCase().includes(qLower);
        }
        if (!matches) continue;
      }
    }

    plannedNotes.push(plannedNote);
  }

  return plannedNotes;
}

// ── Chronological Map View Renderer & Infinite Scroll ─────────────────────────
let mapMilestonesLimit = 8;
let _mapSentinelObserver = null;
let _mapLoadingTimer = null;

function isDailySummaryNote(n) {
  if (!n) return false;
  if (Array.isArray(n.major_topic_tags) && n.major_topic_tags.includes("Daily Summary")) return true;
  if (Array.isArray(n.group_tags) && n.group_tags.includes("Summary") && Array.isArray(n.major_topic_tags) && n.major_topic_tags.some(t => /daily|journal/i.test(t))) return true;
  if (typeof n.path === 'string' && (/daily-summary-\d{4}-\d{2}-\d{2}\.html$/.test(n.path) || /daily-review-\d{4}-\d{2}-\d{2}\.html$/.test(n.path))) return true;
  if (typeof n.id === 'string' && (n.id.startsWith('summary-') || n.id.startsWith('daily-summary-'))) return true;
  if (typeof n.title === 'string' && /^(Résumé quotidien|Daily Summary|Daily Review|Tagesrückblick|Denní přehled|Revisión diaria|Napi áttekintés|Revisione giornaliera|Dagelijkse review|Przegląd dzienny|Revizuire zilnică|Ежедневный обзор|Daglig genomgång|Günlük İnceleme|Щоденний огляд)\b/i.test(n.title)) return true;
  return false;
}
window.isDailySummaryNote = isDailySummaryNote;

function loadMoreMapMilestones() {
  if (_mapLoadingTimer) return;
  _mapLoadingTimer = setTimeout(() => {
    _mapLoadingTimer = null;
    mapMilestonesLimit += 8;
    if (typeof renderBoard === 'function') renderBoard();
  }, 40);
}

function initMapScrollObserver() {
  if (_mapSentinelObserver) {
    _mapSentinelObserver.disconnect();
    _mapSentinelObserver = null;
  }
  const sentinel = document.getElementById('map-scroll-sentinel');
  if (!sentinel) return;

  const appMain = document.getElementById('app-main');
  if (typeof IntersectionObserver !== 'undefined') {
    _mapSentinelObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          loadMoreMapMilestones();
        }
      }
    }, {
      root: appMain || null,
      rootMargin: '350px 0px 350px 0px',
      threshold: 0.01
    });
    _mapSentinelObserver.observe(sentinel);
  }

  if (appMain) {
    const onScroll = () => {
      if (appMain.scrollTop + appMain.clientHeight >= appMain.scrollHeight - 350) {
        loadMoreMapMilestones();
      }
    };
    appMain.addEventListener('scroll', onScroll, { passive: true, once: true });
  }
}

async function renderChronologicalMapView(board, items) {
  const allVaultNotes = (typeof manifest !== 'undefined' && Array.isArray(manifest) && manifest.length > 0)
    ? manifest
    : ((typeof getAllNotes === 'function') ? await getAllNotes() : (items || []));
  const plannedNotes = getPlannedNotesFromBlocs(items, allVaultNotes);
  const allItems = [...(items || []), ...plannedNotes];

  if (typeof renderNotesWorkstreamBar === 'function') renderNotesWorkstreamBar();

  if (!allItems.length) {
    board.innerHTML = `<div style="color:#9ca3af;padding:3rem 2rem;text-align:center;font-size:0.9rem">${escH(t('board.noNotesMatchFilter'))}</div>`;
    renderNotesBreadcrumbBar();
    if (typeof updateNotesScrollIndicator === 'function') updateNotesScrollIndicator();
    return;
  }

  // Milestone grouping
  const milestoneMap = new Map();
  const olderNotes = [];

  for (const n of allItems) {
    const { key, label } = getMapMilestoneInfo(n.date, mapZoomLevel);
    if (key === '__older__') {
      olderNotes.push(n);
    } else {
      if (!milestoneMap.has(key)) milestoneMap.set(key, { label, notes: [] });
      milestoneMap.get(key).notes.push(n);
    }
  }

  const milestoneKeys = [...milestoneMap.keys()].sort((a, b) => b.localeCompare(a));
  const html_parts = [];

  const todayStr = formatLocalDateValue(new Date());

  // Ensure mapMilestonesLimit is at least large enough to include today
  const todayMilestoneIdx = milestoneKeys.findIndex(k => k.includes(todayStr.slice(0, 7)) || (milestoneMap.get(k)?.notes || []).some(n => n.date === todayStr));
  if (todayMilestoneIdx >= 0 && todayMilestoneIdx >= mapMilestonesLimit) {
    mapMilestonesLimit = todayMilestoneIdx + 4;
  }

  const visibleKeys = milestoneKeys.slice(0, mapMilestonesLimit);

  for (const key of visibleKeys) {
    const { label, notes } = milestoneMap.get(key);
    // Milestone is only marked as future if ALL notes inside it have dates strictly > today
    const isFutureKey = notes.length > 0 && notes.every(n => n.date && n.date > todayStr);
    html_parts.push(renderMapMilestoneHTML(key, label, notes, { isFuture: isFutureKey }));
  }

  if (milestoneKeys.length > mapMilestonesLimit) {
    const remaining = milestoneKeys.length - mapMilestonesLimit;
    html_parts.push(`
      <div id="map-scroll-sentinel" class="map-scroll-sentinel" onclick="loadMoreMapMilestones()" title="${escA(t('board.loadMoreTooltip'))}">
        <span>📥 ${escH(t('board.loadMore'))} (${remaining} ${escH(t('board.remaining'))})</span>
      </div>
    `);
  } else if (olderNotes.length > 0) {
    html_parts.push(renderMapMilestoneHTML('__older__', t('board.olderNotesLane') || 'Older Notes', olderNotes));
  }

  const hasFutureNotes = plannedNotes.some(n => n.date && n.date > todayStr);
  const spineClass = `map-timeline-spine${hasFutureNotes ? ' map-timeline-spine-future' : ''}`;

  const appMain = document.getElementById('app-main');
  const isSearchActive = !!(typeof searchQuery !== 'undefined' && searchQuery && searchQuery.trim());
  const prevScrollTop = (!isSearchActive && appMain) ? appMain.scrollTop : null;

  board.innerHTML = `
    <div class="notes-map-view" style="display:flex;flex-direction:column;gap:1.5rem;position:relative;padding:0.5rem 0">
      <div class="${spineClass}"></div>
      ${html_parts.join('')}
    </div>
  `;

  setupBoardInteractions();
  if (typeof initCardPreviews === 'function') initCardPreviews();
  updateActiveFilterChip();
  if (typeof renderFilterBarChips === 'function') renderFilterBarChips();
  renderNotesBreadcrumbBar();
  if (typeof updateNotesScrollIndicator === 'function') updateNotesScrollIndicator();
  initMapScrollObserver();

  if (prevScrollTop !== null && prevScrollTop > 0) {
    appMain.scrollTop = prevScrollTop;
  } else {
    const todayEl = board.querySelector('.map-day-section[data-is-today="true"]')
      || board.querySelector(`.map-day-section[data-date^="${todayStr.slice(0, 7)}"]`)
      || board.querySelector(`.map-milestone[data-milestone*="${todayStr.slice(0, 7)}"]`);
    if (todayEl) {
      if (appMain) {
        const containerTop = appMain.getBoundingClientRect().top;
        const elementTop = todayEl.getBoundingClientRect().top;
        appMain.scrollTop = Math.max(0, appMain.scrollTop + (elementTop - containerTop) - 40);
      } else if (typeof todayEl.scrollIntoView === 'function') {
        todayEl.scrollIntoView({ behavior: 'instant', block: 'start' });
      }
    } else if (appMain && isSearchActive) {
      appMain.scrollTop = 0;
    }
  }
}

function formatMapDayLabel(dateStr) {
  if (!dateStr || dateStr === 'no-date' || dateStr === '__older__') return t('board.olderNotesLane') || 'Older Notes';
  const ts = (typeof parseFlexibleTimestamp === 'function')
    ? parseFlexibleTimestamp(dateStr)
    : Date.parse(dateStr);
  if (!ts) return dateStr;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return dateStr;
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dayName = dayNames[d.getDay()];
  const monthName = monthNames[d.getMonth()];
  const dayNum = d.getDate();
  const year = d.getFullYear();
  const currentYear = new Date().getFullYear();
  if (year === currentYear) {
    return `${dayName} - ${monthName} ${dayNum}`;
  }
  return `${dayName} - ${monthName} ${dayNum}, ${year}`;
}

function getItemTimeInfo(n) {
  let timeStr = '';
  if (n.event && n.event.startTime) {
    timeStr = n.event.startTime;
  } else if (n.time) {
    timeStr = n.time;
  } else if (n.date && /\d{1,2}:\d{2}/.test(n.date)) {
    const match = n.date.match(/\d{1,2}:\d{2}/);
    if (match) timeStr = match[0];
  } else if (n.summary && /\b\d{1,2}:\d{2}\b/.test(n.summary)) {
    const match = n.summary.match(/\b\d{1,2}:\d{2}\b/);
    if (match) timeStr = match[0];
  } else if (n.preview && /\b\d{1,2}:\d{2}\b/.test(n.preview)) {
    const match = n.preview.match(/\b\d{1,2}:\d{2}\b/);
    if (match) timeStr = match[0];
  }

  if (timeStr && timeStr.length === 4 && timeStr.indexOf(':') === 1) {
    timeStr = '0' + timeStr;
  }
  return timeStr;
}

function renderMapMilestoneHTML(milestoneKey, milestoneLabel, notes, opts = {}) {
  const iconRead = (typeof AppIcons !== 'undefined' && AppIcons.get) ? AppIcons.get('bookOpen', { size: 13 }) : '';
  const isFuture = !!opts.isFuture;
  const todayStr = formatLocalDateValue(new Date());

  // Group notes inside the milestone by date (YYYY-MM-DD)
  const dayGroups = new Map();
  for (const n of notes) {
    const dStr = n.date || 'no-date';
    if (!dayGroups.has(dStr)) dayGroups.set(dStr, []);
    dayGroups.get(dStr).push(n);
  }

  // Sort dates descending (newest/future first)
  const sortedDates = [...dayGroups.keys()].sort((a, b) => b.localeCompare(a));
  const daySections = [];

  let firstFutureDiff = 0;
  if (isFuture && sortedDates.length > 0 && sortedDates[0] > todayStr) {
    const ts0 = parseFlexibleTimestamp ? parseFlexibleTimestamp(sortedDates[0]) : Date.parse(sortedDates[0]);
    const tsToday = parseFlexibleTimestamp ? parseFlexibleTimestamp(todayStr) : Date.parse(todayStr);
    if (ts0 && tsToday) {
      firstFutureDiff = Math.max(1, Math.round((ts0 - tsToday) / 86400000));
    }
  }

  for (const dStr of sortedDates) {
    const dayNotes = dayGroups.get(dStr);
    const dailySummaryIndex = dayNotes.findIndex(isDailySummaryNote);
    const dailySummaryNote = dailySummaryIndex >= 0 ? dayNotes[dailySummaryIndex] : null;
    const displayDayNotes = dailySummaryNote ? dayNotes.filter((_, idx) => idx !== dailySummaryIndex) : dayNotes;

    // Sort items in strict ascending chronological time order (09:00 -> 10:00 -> 13:30 -> 15:00 -> 17:00)
    const sortedDayNotes = displayDayNotes.slice().sort((a, b) => {
      const timeA = getItemTimeInfo(a) || '99:99';
      const timeB = getItemTimeInfo(b) || '99:99';
      if (timeA !== timeB) return timeA.localeCompare(timeB);
      return (a.title || '').localeCompare(b.title || '');
    });

    const dayCardsHTML = sortedDayNotes.map(n => {
      const groupName = (n.group_tags && n.group_tags[0]) || '(Untagged)';
      const color = groupName === '(Untagged)' ? null : colorForGroup(groupName);
      const timeStr = getItemTimeInfo(n);

      const cardHTML = renderNoteCard(n, milestoneKey, {
        showDragHandle: false,
        showContextTags: true,
        showCardDate: false,
        hideTimeBadge: true,
        tintColor: color ? color.text : null
      });

      return `
        <div class="map-timeline-card-col">
          <div class="map-time-stem-header">
            <div class="map-time-label">${escH(timeStr || '—')}</div>
            <div class="map-time-bar-stem"></div>
          </div>
          ${cardHTML}
        </div>
      `;
    }).join('');

    const isDayFuture = dStr > todayStr;
    const isToday = dStr === todayStr;
    const dayDotColor = isDayFuture ? '#8b5cf6' : (isToday ? 'var(--accent)' : 'var(--accent)');
    const dayLabelText = formatMapDayLabel(dStr);

    let dayBgStyle = '';
    let dayTitleStyle = 'color: var(--text-muted); font-weight: 700;';

    if (isDayFuture) {
      const tsDay = parseFlexibleTimestamp ? parseFlexibleTimestamp(dStr) : Date.parse(dStr);
      const tsToday = parseFlexibleTimestamp ? parseFlexibleTimestamp(todayStr) : Date.parse(todayStr);
      const dayDiff = (tsDay && tsToday) ? Math.max(1, Math.round((tsDay - tsToday) / 86400000)) : 1;
      const intensity = Math.min(22, 5 + Math.round(Math.min(dayDiff, 60) * 0.28));
      dayBgStyle = `background: color-mix(in srgb, #8b5cf6 ${intensity}%, var(--card-bg)); border-radius: var(--radius-md, 8px); padding: 0.65rem 0.85rem; border: 1px dashed color-mix(in srgb, #8b5cf6 30%, transparent);`;
      dayTitleStyle = `color: #8b5cf6; font-weight: 800;`;
    } else if (isToday) {
      dayBgStyle = `background: color-mix(in srgb, var(--accent) 8%, var(--card-bg)); border-radius: var(--radius-md, 8px); padding: 0.65rem 0.85rem; border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);`;
      dayTitleStyle = `color: var(--accent); font-weight: 800;`;
    } else {
      dayBgStyle = `padding: 0.4rem 0.2rem;`;
    }

    const dailySummaryBadge = dailySummaryNote ? `
      <span class="map-day-sep" style="opacity:0.4;font-weight:400">-</span>
      <button type="button" class="map-day-daily-summary-badge" onclick="event.stopPropagation(); openNoteOverlay(${jq(dailySummaryNote.path)})" title="${escA(t('notes.openDailySummaryTooltip') || 'Open daily summary for this day')}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
        <span>${escH(t('notes.dailySummary') || 'Daily Summary')}</span>
      </button>
    ` : '';

    daySections.push(`
      <div class="map-day-section" data-date="${escA(dStr)}"${isToday ? ' data-is-today="true"' : ''} style="position:relative;margin-bottom:1.1rem;${dayBgStyle}">
        <div class="map-day-dot" style="position:absolute;left:-27px;top:6px;width:10px;height:10px;border-radius:50%;background:${dayDotColor};border:2px solid var(--bg);box-shadow:0 0 0 2px ${dayDotColor}"></div>
        <div class="map-day-header" style="font-size:0.8rem;margin-bottom:0.5rem;display:flex;align-items:center;flex-wrap:wrap;gap:6px;${dayTitleStyle}">
          <span>${escH(dayLabelText)}</span>
          ${isToday ? `<span style="font-size:0.7rem;background:var(--accent);color:var(--text-on-accent);padding:1px 6px;border-radius:8px;font-weight:700">${escH(t('planner.today') || 'Today')}</span>` : ''}
          <span style="font-size:0.72rem;opacity:0.6;font-weight:600">(${dayNotes.length})</span>
          ${dailySummaryBadge}
        </div>
        ${sortedDayNotes.length > 0 ? `<div class="sl-week-cards" style="display:flex;flex-wrap:wrap;gap:0.85rem;width:100%;max-width:100%;box-sizing:border-box">${dayCardsHTML}</div>` : ''}
      </div>
    `);
  }

  const dotColor = isFuture ? '#8b5cf6' : 'var(--accent)';

  let headerStyle = '';
  if (isFuture) {
    const intensity = Math.min(22, 5 + Math.round(Math.min(firstFutureDiff, 60) * 0.28));
    headerStyle = `style="background: color-mix(in srgb, #8b5cf6 ${intensity}%, var(--card-bg)); border-color: color-mix(in srgb, #8b5cf6 40%, var(--border-color)); border-bottom: 3px solid #8b5cf6;"`;
  }

  return `
    <div class="map-milestone" data-milestone="${escA(milestoneKey)}" style="position:relative;z-index:1;padding-left:50px">
      <div class="map-milestone-header"${headerStyle}>
        <div style="display:flex;align-items:center;gap:10px">
          <div class="map-node-dot" style="position:absolute;left:-30px;width:16px;height:16px;border-radius:50%;background:${dotColor};border:3px solid var(--bg);box-shadow:0 0 0 2px ${dotColor}"></div>
          <span style="font-size:1.05rem;font-weight:800;letter-spacing:-0.01em;color:${isFuture ? '#8b5cf6' : 'var(--text)'}">${escH(milestoneLabel)}</span>
          <span class="sl-lane-count" style="font-size:0.8rem;background:var(--card-bg-alt);padding:2px 8px;border-radius:12px;color:var(--text-muted);font-weight:600">(${notes.length})</span>
        </div>
        <button class="notes-action-btn" onclick="event.stopPropagation();reviewTreeNode('milestone', ${jq(milestoneKey)})" title="${escA(t('notes.reviewBranchTooltip'))}">
          ${iconRead} <span>${escH(t('notes.readerView'))}</span>
        </button>
      </div>
      <div class="map-milestone-content" style="padding:0.25rem 0">
        ${daySections.join('')}
      </div>
    </div>
  `;
}

// ── Modern Apple Photos-Style Visual Tree View Renderer ────────────────────
async function renderNotesTreeView(board, items) {
  if (!items || !items.length) {
    board.innerHTML = `<div style="color:#9ca3af;padding:3rem 2rem;text-align:center;font-size:0.9rem">${escH(t('board.noNotesMatchFilter'))}</div>`;
    renderNotesBreadcrumbBar();
    return;
  }

  const iconRead   = (typeof AppIcons !== 'undefined' && AppIcons.get) ? AppIcons.get('bookOpen', { size: 13 }) : '';
  const iconFolder = (typeof AppIcons !== 'undefined' && AppIcons.get) ? AppIcons.get('folder', { size: 13 }) : '';

  const groups = {};
  for (const n of items) {
    const g = (n.group_tags && n.group_tags[0]) || '(Untagged)';
    const m = (n.major_topic_tags && n.major_topic_tags[0]) || '(Untagged)';
    const tt = (n.topic_tags && n.topic_tags[0]) || '(Untagged)';
    if (!groups[g]) groups[g] = {};
    if (!groups[g][m]) groups[g][m] = {};
    if (!groups[g][m][tt]) groups[g][m][tt] = [];
    groups[g][m][tt].push(n);
  }

  let treeHTML = '<div class="notes-tree-canvas" style="display:flex;flex-direction:column;gap:1.2rem">';
  const sortedGroups = Object.keys(groups).sort((a, b) => a === '(Untagged)' ? 1 : b === '(Untagged)' ? -1 : a.localeCompare(b));

  for (const g of sortedGroups) {
    const groupNotesArr = Object.values(groups[g]).flatMap(m => Object.values(m).flat());
    const gKey = 'group::' + g;
    const color = g === '(Untagged)' ? { text: 'var(--text-muted)' } : colorForGroup(g);

    let majorHTML = '';
    const sortedMajors = Object.keys(groups[g]).sort((a, b) => a === '(Untagged)' ? 1 : b === '(Untagged)' ? -1 : a.localeCompare(b));

    for (const m of sortedMajors) {
      const majorNotesArr = Object.values(groups[g][m]).flatMap(arr => arr);

      let topicHTML = '';
      const sortedTopics = Object.keys(groups[g][m]).sort((a, b) => a === '(Untagged)' ? 1 : b === '(Untagged)' ? -1 : a.localeCompare(b));

      for (const tt of sortedTopics) {
        const topicNotes = groups[g][m][tt];
        // In Tree View: display card date and tags cleanly
        const cardsHTML = topicNotes.map(n => renderNoteCard(n, gKey, { showDragHandle: false, showContextTags: false, showCardDate: true, hideTags: false })).join('');

        topicHTML += `
          <div class="tree-topic-section" style="margin-bottom:1rem">
            ${tt !== '(Untagged)' ? `
              <div class="tree-topic-header" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem">
                <div style="display:flex;align-items:center;gap:6px">
                  <span style="font-size:0.82rem;font-weight:700;color:var(--text-muted)"># ${escH(tt)}</span>
                  <span style="font-size:0.75rem;color:var(--text-muted);background:var(--card-bg-alt);padding:1px 7px;border-radius:10px;font-weight:600">(${topicNotes.length})</span>
                </div>
                <button class="notes-action-btn" onclick="event.stopPropagation();reviewTreeNode('topic', ${jq(tt)})" title="${escA(t('notes.reviewBranchTooltip'))}">
                  ${iconRead} <span>${escH(t('notes.readerView'))}</span>
                </button>
              </div>
            ` : ''}
            <div class="sl-week-cards" style="display:flex;flex-wrap:wrap;gap:0.75rem">${cardsHTML}</div>
          </div>
        `;
      }

      majorHTML += `
        <div class="tree-major-section" style="margin-bottom:1.2rem">
          ${m !== '(Untagged)' ? `
            <div class="tree-major-header" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.6rem;padding-bottom:0.3rem;border-bottom:1px solid ${hslWithAlpha(color.text, 0.15)}">
              <div style="display:flex;align-items:center;gap:6px">
                <span style="font-size:0.9rem;font-weight:700;color:${color.text}">${iconFolder} ${escH(m)}</span>
                <span style="font-size:0.75rem;color:var(--text-muted);background:var(--card-bg-alt);padding:1px 7px;border-radius:10px;font-weight:600">(${majorNotesArr.length})</span>
              </div>
              <button class="notes-action-btn" onclick="event.stopPropagation();reviewTreeNode('major', ${jq(m)})" title="${escA(t('notes.reviewBranchTooltip'))}">
                ${iconRead} <span>${escH(t('notes.readerView'))}</span>
              </button>
            </div>
          ` : ''}
          ${topicHTML}
        </div>
      `;
    }

    treeHTML += `
      <div class="tree-group-section" style="background:var(--card-bg);border:1px solid var(--border-color);border-left:5px solid ${color.text};border-radius:var(--radius-md,10px);padding:1rem 1.2rem;box-shadow:var(--shadow-sm)">
        <!-- Apple Photos Style Sticky Group Banner -->
        <div class="tree-group-header" style="display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:10;background:color-mix(in srgb, var(--card-bg) 95%, transparent);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);padding:0.6rem 0.85rem;margin:-0.5rem -0.75rem 0.85rem -0.75rem;border-radius:var(--radius-sm);border-bottom:2px solid ${hslWithAlpha(color.text, 0.35)};box-shadow:0 4px 14px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.05)">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="width:12px;height:12px;border-radius:50%;background:${color.text};display:inline-block"></span>
            <span style="font-size:1.05rem;font-weight:800;color:${color.text}">${escH(g)}</span>
            <span style="font-size:0.8rem;background:var(--card-bg-alt);padding:2px 8px;border-radius:12px;color:var(--text-muted);font-weight:600">(${groupNotesArr.length})</span>
          </div>
          <button class="notes-action-btn" onclick="event.stopPropagation();reviewTreeNode('group', ${jq(g)})" title="${escA(t('notes.reviewBranchTooltip'))}">
            ${iconRead} <span>${escH(t('notes.readerView'))}</span>
          </button>
        </div>
        <div class="tree-group-content">
          ${majorHTML}
        </div>
      </div>
    `;
  }
  treeHTML += '</div>';

  board.innerHTML = `
    <div class="notes-tree-view" style="padding:0.5rem 0">
      ${treeHTML}
    </div>
  `;

  setupBoardInteractions();
  initCardPreviews();
  updateActiveFilterChip();
  if (typeof renderFilterBarChips === 'function') renderFilterBarChips();
  renderNotesBreadcrumbBar();
}

let isReaderProgrammaticScroll = false;
let readerScrollTimer = null;

function setReaderProgrammaticScroll(val, timeoutMs = 0) {
  isReaderProgrammaticScroll = val;
  if (typeof window !== 'undefined') window.isReaderProgrammaticScroll = val;
  if (readerScrollTimer) clearTimeout(readerScrollTimer);
  if (val && timeoutMs > 0) {
    readerScrollTimer = setTimeout(() => {
      isReaderProgrammaticScroll = false;
      if (typeof window !== 'undefined') window.isReaderProgrammaticScroll = false;
    }, timeoutMs);
  }
}

function scrollTocSidebarToItem(activeItem) {
  if (!activeItem) return;
  const sidebar = activeItem.closest('.reader-toc-sidebar');
  if (!sidebar) return;
  const itemTop = activeItem.offsetTop - sidebar.offsetTop;
  const itemBottom = itemTop + activeItem.offsetHeight;
  if (itemTop < sidebar.scrollTop) {
    sidebar.scrollTop = Math.max(0, itemTop - 10);
  } else if (itemBottom > sidebar.scrollTop + sidebar.clientHeight) {
    sidebar.scrollTop = itemBottom - sidebar.clientHeight + 10;
  }
}

function scrollToReaderNote(idx) {
  const el = document.getElementById(`reader-note-${idx}`);
  if (!el) return;
  const topOffset = 16;
  const appMain = document.getElementById('app-main');

  setReaderProgrammaticScroll(true, 700);

  document.querySelectorAll('.reader-toc-item').forEach(item => item.classList.remove('active'));
  const activeItem = document.getElementById(`reader-toc-item-${idx}`);
  if (activeItem) {
    activeItem.classList.add('active');
    scrollTocSidebarToItem(activeItem);
  }

  if (appMain) {
    const containerTop = appMain.getBoundingClientRect().top;
    const elementTop = el.getBoundingClientRect().top;
    const targetScrollTop = appMain.scrollTop + (elementTop - containerTop) - topOffset;
    appMain.scrollTo({
      top: Math.max(0, targetScrollTop),
      behavior: 'smooth'
    });
  } else {
    const elementPosition = el.getBoundingClientRect().top + window.pageYOffset;
    window.scrollTo({
      top: Math.max(0, elementPosition - topOffset),
      behavior: 'smooth'
    });
  }
}
if (typeof window !== 'undefined') {
  window.scrollToReaderNote = scrollToReaderNote;
  window.isReaderProgrammaticScroll = isReaderProgrammaticScroll;
  window.setGroupFilter = setGroupFilter;
  window.setTagFilter = setTagFilter;
  window.setNotesReaderTarget = setNotesReaderTarget;
  window.clearNotesReaderTarget = clearNotesReaderTarget;
  window.selectBreadcrumbOption = selectBreadcrumbOption;
  window.showBreadcrumbDropdown = showBreadcrumbDropdown;
}

function initReaderScrollObserver(totalNotes) {
  if (typeof IntersectionObserver === 'undefined') return;

  const appMain = document.getElementById('app-main');
  const observer = new IntersectionObserver(entries => {
    if (isReaderProgrammaticScroll) return;
    for (const entry of entries) {
      if (entry.isIntersecting) {
        const idStr = entry.target.id;
        const idx = idStr.replace('reader-note-', '');
        document.querySelectorAll('.reader-toc-item').forEach(item => item.classList.remove('active'));
        const activeItem = document.getElementById(`reader-toc-item-${idx}`);
        if (activeItem) {
          activeItem.classList.add('active');
          scrollTocSidebarToItem(activeItem);
        }
      }
    }
  }, {
    root: appMain || null,
    rootMargin: '-50px 0px -60% 0px',
    threshold: 0.1
  });

  for (let idx = 0; idx < totalNotes; idx++) {
    const card = document.getElementById(`reader-note-${idx}`);
    if (card) observer.observe(card);
  }
}

// ── Integrated Reader & Review Mode Renderer ────────────────────────────────
async function renderIntegratedReaderView(board, items) {
  let targetItems = items.slice();

  if (notesReaderTarget && notesReaderTarget.type && notesReaderTarget.value) {
    const { type, value } = notesReaderTarget;
    if (type === 'group') {
      targetItems = targetItems.filter(n => (n.group_tags || []).includes(value) || (!n.group_tags?.length && value === '(Untagged)'));
    } else if (type === 'major') {
      targetItems = targetItems.filter(n => (n.major_topic_tags || []).includes(value) || (!n.major_topic_tags?.length && value === '(Untagged)'));
    } else if (type === 'topic' || type === 'tag') {
      targetItems = targetItems.filter(n => (n.topic_tags || []).includes(value) || (n.other_tags || []).includes(value) || (!n.topic_tags?.length && value === '(Untagged)'));
    } else if (type === 'year') {
      targetItems = targetItems.filter(n => n.date && n.date.slice(0, 4) === value);
    } else if (type === 'month') {
      targetItems = targetItems.filter(n => n.date && n.date.slice(0, 7) === value);
    } else if (type === 'week') {
      targetItems = targetItems.filter(n => n.date && (typeof getNoteWeekKey === 'function' ? getNoteWeekKey(n.date).key === value : n.date.includes(value)));
    } else if (type === 'milestone') {
      targetItems = targetItems.filter(n => {
        if (!n.date) return value === '__older__';
        if (typeof getMapMilestoneInfo === 'function' && getMapMilestoneInfo(n.date, mapZoomLevel).key === value) return true;
        if (typeof getMapMilestoneInfo === 'function' && getMapMilestoneInfo(n.date, 'months').key === value) return true;
        if (typeof getMapMilestoneInfo === 'function' && getMapMilestoneInfo(n.date, 'years').key === value) return true;
        if (typeof getMapMilestoneInfo === 'function' && getMapMilestoneInfo(n.date, 'weeks').key === value) return true;
        return n.date.startsWith(value);
      });
    }
  }

  if (!targetItems.length) {
    board.innerHTML = `
      <div style="padding:3rem;text-align:center;color:var(--text-muted)">
        <p style="font-size:0.95rem">${escH(t('notes.noNotesInNode'))}</p>
        ${notesReaderTarget ? `<button class="notes-action-btn" onclick="clearNotesReaderTarget()" style="margin-top:0.75rem">${escH(t('notes.showAllNotes'))}</button>` : ''}
      </div>
    `;
    renderNotesBreadcrumbBar();
    return;
  }

  const sortedNotes = targetItems.sort((a, b) => (b.date || '') > (a.date || '') ? 1 : -1);
  const iconEdit = (typeof AppIcons !== 'undefined' && AppIcons.get) ? AppIcons.get('edit', { size: 13 }) : '✏️';

  // Aligned Table of Contents (Inhaltsverzeichnis)
  const tocListHTML = sortedNotes.map((n, idx) => {
    const num = String(idx + 1).padStart(2, '0');
    const isDaily = isDailySummaryNote(n);
    return `
      <button id="reader-toc-item-${idx}" type="button" class="reader-toc-item${idx === 0 ? ' active' : ''}${isDaily ? ' reader-toc-daily-summary' : ''}" onclick="scrollToReaderNote(${idx})" title="${escA(n.title || t('common.untitledNote'))}">
        <span class="reader-toc-num">${num}</span>
        <span class="reader-toc-title">${isDaily ? '🌙 ' : ''}${escH(n.title || t('common.untitledNote'))}</span>
      </button>
    `;
  }).join('');

  // Reader Stream with Sticky Note Title Banners
  const streamHTML = sortedNotes.map((n, idx) => {
    const isDaily = isDailySummaryNote(n);
    return `
    <div id="reader-note-${idx}" class="reader-note-card${isDaily ? ' reader-note-daily-summary' : ''}" style="background:var(--card-bg);border:1px solid var(--border-color);border-radius:var(--radius-md,10px);box-shadow:var(--shadow-sm);margin-bottom:1.5rem;position:relative">
      <!-- Sticky Note Title Banner -->
      <div class="reader-note-header">
        <div style="display:flex;align-items:center;gap:10px;overflow:hidden">
          <span style="font-size:0.75rem;font-weight:800;background:var(--accent);color:#ffffff;padding:2px 8px;border-radius:12px;flex-shrink:0">${String(idx + 1).padStart(2, '0')}</span>
          ${isDaily ? `<span class="reader-daily-summary-pill"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg> <span>${escH(t('notes.dailySummary') || 'Daily Summary')}</span></span>` : ''}
          <span style="font-weight:800;font-size:1.1rem;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escH(n.title || t('common.untitledNote'))}</span>
          ${n.date ? `<span style="font-size:0.75rem;color:var(--text-muted);background:var(--card-bg-alt);padding:2px 8px;border-radius:10px;font-weight:600;flex-shrink:0">${escH(n.date.slice(0,10))}</span>` : ''}
        </div>
        <button class="notes-action-btn" onclick="openNoteOverlayInEditMode(${jq(n.path)})" title="${escA(t('notes.editNoteTooltip'))}">
          ${iconEdit} <span>${escH(t('editor.editNote'))}</span>
        </button>
      </div>
      <div id="reader-content-${idx}" class="reader-note-body" style="padding:1.4rem;font-size:0.92rem;line-height:1.65;color:var(--text)">
        <em style="color:var(--text-muted)">Loading note content...</em>
      </div>
    </div>
  `;
  }).join('');

  let targetTypeLabel = '';
  if (notesReaderTarget && notesReaderTarget.type) {
    const tKey = notesReaderTarget.type === 'milestone' ? 'notes.targetMilestone'
      : notesReaderTarget.type === 'week' ? 'notes.targetWeek'
      : notesReaderTarget.type === 'month' ? 'notes.targetMonth'
      : notesReaderTarget.type === 'year' ? 'notes.targetYear'
      : notesReaderTarget.type === 'group' ? 'notes.targetGroup'
      : (notesReaderTarget.type === 'tag' || notesReaderTarget.type === 'topic' || notesReaderTarget.type === 'major') ? 'notes.targetTag'
      : null;
    targetTypeLabel = tKey ? t(tKey) : notesReaderTarget.type.toUpperCase();
  }

  const targetTitle = notesReaderTarget
    ? `${targetTypeLabel}: ${notesReaderTarget.value}`
    : t('notes.readerHeader');

  board.innerHTML = `
    <div class="notes-reader-container" style="display:flex;gap:1.5rem;width:100%;position:relative;align-items:flex-start">
      <!-- Left Sticky Aligned TOC Sidebar -->
      <div class="reader-toc-sidebar">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem;padding-bottom:0.5rem;border-bottom:1px solid var(--border-color)">
          <span style="font-size:0.8rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em">${escH(t('notes.readerToc'))}</span>
          <span style="font-size:0.75rem;color:var(--text-muted);font-weight:600">(${sortedNotes.length})</span>
        </div>
        <div class="reader-toc-list">
          ${tocListHTML}
        </div>
        ${notesReaderTarget ? `<button class="notes-action-btn" onclick="clearNotesReaderTarget()" style="margin-top:0.75rem;width:100%;justify-content:center;font-size:0.78rem">✕ ${escH(t('notes.clearFilter'))}</button>` : ''}
      </div>

      <!-- Main Reader Stream -->
      <div class="notes-reader-stream" style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.2rem">
          <h3 style="font-size:1.15rem;font-weight:800;color:var(--text);margin:0">${escH(targetTitle)}</h3>
        </div>
        ${streamHTML}
      </div>
    </div>
  `;

  const loadContentForIdx = async (idx) => {
    const n = sortedNotes[idx];
    if (!n) return;
    const bodyEl = document.getElementById(`reader-content-${idx}`);
    if (!bodyEl || bodyEl.dataset.loaded === 'true') return;
    bodyEl.dataset.loaded = 'true';
    try {
      const rawHtml = await StorageAPI.readNoteContent(n.path);
      const parsed = parseNoteHTML(rawHtml);
      let mainHTML = parsed.mainHTML || `<p><em style="color:var(--text-muted)">Empty note content</em></p>`;
      if (typeof resolveNoteImages === 'function') {
        mainHTML = await resolveNoteImages(mainHTML);
      }
      const summaryText = parsed.summary || n.summary || '';
      let summaryHTML = '';
      if (summaryText) {
        summaryHTML = `
          <div class="reader-note-summary" style="background:var(--card-bg-alt);border:1px solid var(--border-color);border-left:4px solid var(--accent);border-radius:var(--radius-sm);padding:0.75rem 1rem;margin-bottom:1.2rem;font-size:0.88rem;line-height:1.5;color:var(--text)">
            <div style="font-weight:700;font-size:0.78rem;color:var(--accent);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:0.35rem;display:flex;align-items:center;gap:5px">
              <span>💡</span> ${escH(t('notes.summaryHeader') || 'Summary')}
            </div>
            <div>${escH(summaryText)}</div>
          </div>
        `;
      }
      bodyEl.innerHTML = summaryHTML + mainHTML;
    } catch(e) {
      bodyEl.innerHTML = `<em style="color:#b91c1c;font-size:0.8rem">Could not load note content</em>`;
    }
  };

  const initialBatch = Math.min(sortedNotes.length, 12);
  for (let idx = 0; idx < initialBatch; idx++) {
    await loadContentForIdx(idx);
  }

  if (sortedNotes.length > initialBatch && typeof IntersectionObserver !== 'undefined') {
    const readerObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const idx = parseInt(entry.target.getAttribute('data-reader-idx'), 10);
          if (!isNaN(idx)) {
            loadContentForIdx(idx);
            readerObserver.unobserve(entry.target);
          }
        }
      }
    }, { rootMargin: '400px 0px 400px 0px' });

    for (let idx = initialBatch; idx < sortedNotes.length; idx++) {
      const cardEl = document.getElementById(`reader-note-${idx}`);
      if (cardEl) {
        cardEl.setAttribute('data-reader-idx', String(idx));
        readerObserver.observe(cardEl);
      }
    }
  }

  setupBoardInteractions();
  updateActiveFilterChip();
  if (typeof renderFilterBarChips === 'function') renderFilterBarChips();
  if (typeof renderNotesWorkstreamBar === 'function') renderNotesWorkstreamBar();
  renderNotesBreadcrumbBar();
  initReaderScrollObserver(sortedNotes.length);
}

// ── Notes Scrollbar Timeline HUD & Today Indicator ──────────────────────────
let _notesScrollIndicatorInitialized = false;
let _notesScrollHudTimer = null;

function getNotesScrollTimelineInfo() {
  const appMain = document.getElementById('app-main');
  if (!appMain) return { label: '', isToday: false, isCurrentPeriod: false };

  const now = new Date();
  const todayStr = (typeof formatLocalDateValue === 'function') ? formatLocalDateValue(now) : now.toISOString().slice(0, 10);
  const currentWeekInfo = (typeof getNoteWeekKey === 'function') ? getNoteWeekKey(todayStr) : { key: '' };
  const currentWeekKey = currentWeekInfo.key;
  const currentMonthKey = todayStr.slice(0, 7);
  const currentYearKey = todayStr.slice(0, 4);

  const mainRect = appMain.getBoundingClientRect();
  const viewportTop = mainRect.top;
  const viewportThreshold = viewportTop + Math.min(220, mainRect.height * 0.4);

  // Find candidate timeline elements
  const candidates = appMain.querySelectorAll('.map-milestone, .map-day-section, .reader-note-card, .tree-group-section, .sl-lane');
  let activeElement = null;

  for (const el of candidates) {
    const r = el.getBoundingClientRect();
    if (r.bottom > viewportTop + 10 && r.top <= viewportThreshold) {
      activeElement = el;
      break;
    }
  }

  if (!activeElement && candidates.length > 0) {
    if (appMain.scrollTop === 0) {
      activeElement = candidates[0];
    } else {
      for (const el of candidates) {
        const r = el.getBoundingClientRect();
        if (r.bottom > viewportTop) {
          activeElement = el;
          break;
        }
      }
    }
  }

  let label = '';
  let isCurrentPeriod = false;

  const currentMode = (typeof notesViewMode !== 'undefined' ? notesViewMode : 'map');
  const currentZoom = (typeof mapZoomLevel !== 'undefined' ? mapZoomLevel : 'weeks');

  if (activeElement) {
    const milestoneKey = activeElement.getAttribute('data-milestone');
    const dateStr = activeElement.getAttribute('data-date');
    const laneVal = activeElement.getAttribute('data-lane-val');

    if (currentMode === 'map') {
      if (currentZoom === 'weeks') {
        const key = milestoneKey || (dateStr && typeof getNoteWeekKey === 'function' ? getNoteWeekKey(dateStr).key : '');
        if (key === '__older__') {
          label = (typeof t === 'function' ? t('board.olderNotesLane') : null) || 'Older Notes';
        } else if (key === currentWeekKey) {
          label = (typeof t === 'function' ? t('notes.thisWeek') : null) || 'This Week';
          isCurrentPeriod = true;
        } else if (key) {
          const titleEl = activeElement.querySelector('.map-milestone-header span');
          label = (titleEl && titleEl.textContent) ? titleEl.textContent : (typeof getWeekLaneLabel === 'function' ? getWeekLaneLabel(key, currentWeekKey, '') : key);
        }
      } else if (currentZoom === 'months') {
        const key = milestoneKey || (dateStr ? dateStr.slice(0, 7) : '');
        if (key === '__older__') {
          label = (typeof t === 'function' ? t('board.olderNotesLane') : null) || 'Older Notes';
        } else if (key === currentMonthKey) {
          label = (typeof t === 'function' ? t('notes.thisMonth') : null) || 'This Month';
          isCurrentPeriod = true;
        } else if (key) {
          const titleEl = activeElement.querySelector('.map-milestone-header span');
          if (titleEl && titleEl.textContent) {
            label = titleEl.textContent;
          } else {
            const [y, m] = key.split('-');
            const d = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
            label = (typeof formatMonthShort === 'function' ? formatMonthShort(d) : m) + ' ' + y;
          }
        }
      } else if (currentZoom === 'years') {
        const key = milestoneKey || (dateStr ? dateStr.slice(0, 4) : '');
        if (key === '__older__') {
          label = (typeof t === 'function' ? t('board.olderNotesLane') : null) || 'Older Notes';
        } else if (key === currentYearKey) {
          label = (typeof t === 'function' ? t('notes.thisYear') : null) || 'This Year';
          isCurrentPeriod = true;
        } else if (key) {
          label = key;
        }
      }
    } else if (currentMode === 'reader') {
      const d = dateStr || activeElement.getAttribute('data-date');
      if (d) {
        const wKey = (typeof getNoteWeekKey === 'function') ? getNoteWeekKey(d).key : '';
        if (wKey === currentWeekKey) {
          label = (typeof t === 'function' ? t('notes.thisWeek') : null) || 'This Week';
          isCurrentPeriod = true;
        } else {
          label = (typeof getNoteWeekKey === 'function') ? getNoteWeekKey(d).label : d;
        }
      }
    } else {
      // Board or Tree mode
      if (laneVal) {
        if (laneVal === currentWeekKey) {
          label = (typeof t === 'function' ? t('notes.thisWeek') : null) || 'This Week';
          isCurrentPeriod = true;
        } else if (laneVal === '__older__') {
          label = (typeof t === 'function' ? t('board.olderNotesLane') : null) || 'Older Notes';
        } else if (laneVal.includes('-W')) {
          label = (typeof getWeekLaneLabel === 'function') ? getWeekLaneLabel(laneVal, currentWeekKey, '') : laneVal;
        } else {
          label = laneVal;
        }
      } else if (dateStr) {
        const wKey = (typeof getNoteWeekKey === 'function') ? getNoteWeekKey(dateStr).key : '';
        if (wKey === currentWeekKey) {
          label = (typeof t === 'function' ? t('notes.thisWeek') : null) || 'This Week';
          isCurrentPeriod = true;
        } else {
          label = (typeof getNoteWeekKey === 'function') ? getNoteWeekKey(dateStr).label : dateStr;
        }
      }
    }
  }

  // Determine if Today is visible in viewport
  let isToday = false;
  const todayElements = appMain.querySelectorAll('[data-is-today="true"], [data-date="' + todayStr + '"]');
  for (const tel of todayElements) {
    const tr = tel.getBoundingClientRect();
    if (tr.bottom >= mainRect.top && tr.top <= mainRect.bottom) {
      isToday = true;
      break;
    }
  }

  return { label, isToday, isCurrentPeriod };
}

function scrollToTodayNotes() {
  const appMain = document.getElementById('app-main');
  if (!appMain) return;
  const todayStr = (typeof formatLocalDateValue === 'function') ? formatLocalDateValue(new Date()) : new Date().toISOString().slice(0, 10);
  const currentWeekKey = (typeof getNoteWeekKey === 'function') ? getNoteWeekKey(todayStr).key : '';
  const currentMonthKey = todayStr.slice(0, 7);

  if (notesViewMode === 'map') {
    let target = appMain.querySelector('.map-day-section[data-is-today="true"]')
      || appMain.querySelector(`[data-date="${todayStr}"]`)
      || appMain.querySelector(`.map-milestone[data-milestone="${currentWeekKey}"]`)
      || appMain.querySelector(`.map-milestone[data-milestone="${currentMonthKey}"]`);

    if (!target && typeof mapMilestonesLimit !== 'undefined' && mapMilestonesLimit < 120) {
      mapMilestonesLimit = Math.max(mapMilestonesLimit + 16, 32);
      if (typeof renderBoard === 'function') renderBoard();
      target = appMain.querySelector('.map-day-section[data-is-today="true"]')
        || appMain.querySelector(`[data-date="${todayStr}"]`)
        || appMain.querySelector(`.map-milestone[data-milestone="${currentWeekKey}"]`)
        || appMain.querySelector(`.map-milestone[data-milestone="${currentMonthKey}"]`);
    }

    if (target) {
      const containerTop = appMain.getBoundingClientRect().top;
      const elementTop = target.getBoundingClientRect().top;
      appMain.scrollTo({
        top: Math.max(0, appMain.scrollTop + (elementTop - containerTop) - 40),
        behavior: 'smooth'
      });
      return;
    }
  }

  const target = appMain.querySelector('.map-day-section[data-is-today="true"]')
    || appMain.querySelector(`[data-date="${todayStr}"]`)
    || appMain.querySelector(`.map-milestone[data-milestone="${currentWeekKey}"]`)
    || appMain.querySelector(`.map-milestone[data-milestone="${currentMonthKey}"]`)
    || appMain.querySelector(`.reader-note-card[data-date="${todayStr}"]`)
    || appMain.querySelector(`.sl-card[data-date="${todayStr}"]`)
    || appMain.querySelector(`.sl-lane[data-lane-val="${currentWeekKey}"]`);

  if (target) {
    const containerTop = appMain.getBoundingClientRect().top;
    const elementTop = target.getBoundingClientRect().top;
    appMain.scrollTo({
      top: Math.max(0, appMain.scrollTop + (elementTop - containerTop) - 40),
      behavior: 'smooth'
    });
  } else {
    appMain.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function updateNotesScrollIndicator() {
  const appMain = document.getElementById('app-main');
  if (!appMain) return;

  let hud = document.getElementById('notes-scroll-hud');
  if (!hud) {
    hud = document.createElement('div');
    hud.id = 'notes-scroll-hud';
    hud.className = 'notes-scroll-hud';
    hud.onclick = scrollToTodayNotes;
    const tooltip = (typeof t === 'function') ? t('notes.scrollIndicatorTooltip') : 'Current timeline position. Click to jump to today.';
    hud.title = tooltip;
    hud.setAttribute('data-i18n-title', 'notes.scrollIndicatorTooltip');
    hud.innerHTML = `
      <span class="notes-scroll-hud-label" id="notes-scroll-hud-label"></span>
      <span class="notes-scroll-hud-today" id="notes-scroll-hud-today" style="display:none" data-i18n="planner.today">${(typeof t === 'function' && t('planner.today')) ? t('planner.today') : 'Today'}</span>
    `;
    appMain.parentElement ? appMain.parentElement.appendChild(hud) : document.body.appendChild(hud);
  }

  const isNotes = (typeof activeTab === 'undefined' || activeTab === 'notes')
    && (typeof boardMode === 'undefined' || boardMode === 'notes');

  if (!isNotes) {
    hud.classList.remove('visible');
    hud.style.display = 'none';
    return;
  }
  hud.style.display = 'inline-flex';

  const scrollableHeight = appMain.scrollHeight - appMain.clientHeight;
  if (scrollableHeight <= 10) {
    hud.classList.remove('visible');
    return;
  }

  const scrollRatio = Math.max(0, Math.min(1, appMain.scrollTop / scrollableHeight));
  const hudHeight = hud.offsetHeight || 30;
  const topOffset = 70;
  const bottomOffset = 40;
  const availableHeight = Math.max(50, appMain.clientHeight - topOffset - bottomOffset - hudHeight);
  const topPos = topOffset + scrollRatio * availableHeight;
  hud.style.top = `${Math.round(topPos)}px`;

  const info = getNotesScrollTimelineInfo();
  if (!info || !info.label) {
    hud.classList.remove('visible');
    return;
  }

  const labelEl = document.getElementById('notes-scroll-hud-label');
  if (labelEl && labelEl.textContent !== info.label) {
    labelEl.textContent = info.label;
  }

  const todayEl = document.getElementById('notes-scroll-hud-today');
  if (todayEl) {
    todayEl.style.display = info.isToday ? 'inline-flex' : 'none';
  }

  hud.classList.add('visible');

  if (_notesScrollHudTimer) clearTimeout(_notesScrollHudTimer);
  _notesScrollHudTimer = setTimeout(() => {
    if (hud) hud.classList.remove('visible');
  }, 1200);
}

function initNotesScrollIndicator() {
  const appMain = document.getElementById('app-main');
  if (!appMain) return;

  if (!_notesScrollIndicatorInitialized) {
    _notesScrollIndicatorInitialized = true;
    appMain.addEventListener('scroll', () => {
      updateNotesScrollIndicator();
    }, { passive: true });
    window.addEventListener('resize', () => {
      updateNotesScrollIndicator();
    }, { passive: true });
  }
}

// ── Notes Workstream Filter Bar ──────────────────────────────────────────────
function renderNotesWorkstreamBar() {
  const bar = document.getElementById('notes-workstream-bar');
  const inner = document.getElementById('notes-workstream-bar-inner');
  if (!bar || !inner) return;

  const isNotes = (typeof activeTab === 'undefined' || activeTab === 'notes')
    && (typeof boardMode === 'undefined' || boardMode === 'notes')
    && activeTab !== 'prefs'
    && activeTab !== 'planner'
    && activeTab !== 'team'
    && activeTab !== 'decisions'
    && activeTab !== 'retro'
    && activeTab !== 'daily-review'
    && activeTab !== 'todos'
    && activeTab !== 'chat';

  if (!isNotes) {
    bar.style.display = 'none';
    return;
  }

  bar.style.display = 'flex';

  const workstreams = (typeof getKnownWorkstreamsList === 'function')
    ? getKnownWorkstreamsList(manifest)
    : [];

  const workstreamIcon = (typeof AppIcons !== 'undefined' && AppIcons.get)
    ? AppIcons.get('workstream', { size: 12 })
    : '<svg class="app-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 9v12"/><path d="M18 9a9 9 0 0 0-9 9"/></svg>';

  const isAllActive = !activeFilter || activeFilter.type !== 'workstream';
  const allBtn = `
    <button class="notes-ws-chip${isAllActive ? ' active' : ''}" onclick="clearFilter()" title="${escA(t('notes.filterAllWorkstreams') || 'All Workstreams')}">
      <span>${escH(t('board.all') || 'All')}</span>
    </button>
  `;

  const wsChips = workstreams.map(ws => {
    const isActive = activeFilter?.type === 'workstream' && activeFilter?.value === ws;
    return `
      <button class="notes-ws-chip${isActive ? ' active' : ''}" onclick="setFilter('workstream', ${jq(ws)})" title="${escA(t('board.filterLane', { value: ws }))}">
        ${workstreamIcon}
        <span>${escH(ws)}</span>
      </button>
    `;
  }).join('');

  inner.innerHTML = `
    <span class="notes-ws-bar-label">${workstreamIcon} <span>${escH(t('notes.workstreamsBarTitle') || 'Workstreams')}:</span></span>
    ${allBtn}
    ${wsChips}
  `;
}

if (typeof window !== 'undefined') {
  window.initNotesScrollIndicator = initNotesScrollIndicator;
  window.updateNotesScrollIndicator = updateNotesScrollIndicator;
  window.getNotesScrollTimelineInfo = getNotesScrollTimelineInfo;
  window.scrollToTodayNotes = scrollToTodayNotes;
  window.renderNotesWorkstreamBar = renderNotesWorkstreamBar;
  window.isDailySummaryNote = isDailySummaryNote;
  window.loadMoreMapMilestones = loadMoreMapMilestones;
}

