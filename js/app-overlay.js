// ── Secretary: Note Overlay / Editor ──
function _getPlannerBlocksSummaryText(noteId) {
  const plannerReady = typeof plannerLoadState !== 'undefined' ? plannerLoadState === 'ready' : true;
  if (!plannerReady) return '';
  const resolvedNoteId = noteId
    || ((currentNote?.path && typeof getMetaByPath === 'function') ? (getMetaByPath(currentNote.path)?.id || '') : '');
  if (!resolvedNoteId) return '';
  const linked = (typeof getPlannerEventsForNote === 'function')
    ? getPlannerEventsForNote(resolvedNoteId)
    : [];
  if (!linked.length) return '';
  const displayItems = _buildPlannerBlockDisplayItems(linked, currentNote?.date || '');
  const seriesCount = displayItems.filter(item => item.kind === 'series').length;
  const singleCount = displayItems.filter(item => item.kind === 'single').length;
  const parts = [];
  if (seriesCount > 0) parts.push(seriesCount === 1 ? '1 series' : `${seriesCount} series`);
  if (singleCount > 0) parts.push(singleCount === 1 ? '1 block' : `${singleCount} blocks`);
  return parts.join(' · ');
}

function _buildPlannerBlockDisplayItems(events, noteDate = '') {
  const singles = [];
  const grouped = new Map();

  (events || []).forEach(ev => {
    if (!ev) return;
    if (ev.recurrenceId) {
      if (!grouped.has(ev.recurrenceId)) grouped.set(ev.recurrenceId, []);
      grouped.get(ev.recurrenceId).push(ev);
    } else {
      singles.push({ kind: 'single', primary: ev, count: 1 });
    }
  });

  const seriesItems = Array.from(grouped.values()).map(group => {
    const sorted = group.slice().sort((a, b) => {
      const dateDiff = (a.date || '').localeCompare(b.date || '');
      if (dateDiff !== 0) return dateDiff;
      return (a.startTime || '').localeCompare(b.startTime || '');
    });
    const primary = (noteDate && sorted.find(ev => ev.date === noteDate && ev.type !== 'prep'))
      || sorted.find(ev => ev.type !== 'prep')
      || sorted[0];
    return { kind: 'series', primary, count: sorted.length, events: sorted };
  });

  return [...singles, ...seriesItems].sort((a, b) => {
    const aDate = a.primary?.date || '';
    const bDate = b.primary?.date || '';
    const dateDiff = aDate.localeCompare(bDate);
    if (dateDiff !== 0) return dateDiff;
    return (a.primary?.startTime || '').localeCompare(b.primary?.startTime || '');
  });
}

function _tryCloseCurrentWindow() {
  if (window.AppBridge?.windowControls) {
    return window.AppBridge.windowControls.close();
  }
  if (!window || (!window.opener && !window.AppBridge?.isElectron)) return false;
  try {
    window.close();
    return true;
  } catch (e) {
    return false;
  }
}

// ═══ Delete current note ═══
async function deleteCurrentNote() {
  if (!currentNote?.path) return;
  const name = currentNote.title || currentNote.path;
  const confirmed = await showConfirmDialog(t('confirm.deleteNote', { name }), { isDanger: true, confirmLabel: t('common.delete') || 'Delete' });
  if (!confirmed) return;
  const deletedId = currentNote.id;
  const deletedPath = currentNote.path;
  try {
    await StorageAPI.moveToTrash(currentNote.path, { title: currentNote.title });
    const curManifest = (typeof manifest !== 'undefined' && Array.isArray(manifest)) ? manifest : ((typeof window !== 'undefined' && Array.isArray(window.manifest)) ? window.manifest : null);
    if (curManifest) {
      const idx = curManifest.findIndex(m => m.path === currentNote.path);
      if (idx >= 0) curManifest.splice(idx, 1);
    }
    await saveManifest({ force: true });
    toast(t('trash.noteMovedToTrash') || t('common.noteDeleted'));
    broadcastSync({ type: 'NOTE_DELETED', noteId: deletedId, path: deletedPath });
    const overlay = document.getElementById('note-edit-overlay');
    if (overlay) overlay.style.display = 'none';
    editMode = false;
    currentNote = null;
    if (_isFocusedMode) {
      _tryCloseCurrentWindow();
    }
    renderBoard();
  } catch(e) { toast(t('common.deleteFailed', { message: e.message }), true); }
}
// Auto-save
let _autoSaveTimer = null;
let _autoSaveMaxWaitTimer = null;
let _editorInputRefreshTimer = null;
let _lastImageStripSignature = '';

const AUTOSAVE_DEBOUNCE_MS = 2000;
const AUTOSAVE_MAX_WAIT_MS = 15000;

// ═══ Auto-save ═══
function scheduleAutoSave() {
  if (_autoSaveTimer) {
    clearTimeout(_autoSaveTimer);
    _autoSaveTimer = null;
  }

  if (!_autoSaveMaxWaitTimer) {
    _autoSaveMaxWaitTimer = setTimeout(() => {
      _autoSaveMaxWaitTimer = null;
      if (_autoSaveTimer) {
        clearTimeout(_autoSaveTimer);
        _autoSaveTimer = null;
      }
      autoSaveNote({ silent: true }).catch(() => {});
    }, AUTOSAVE_MAX_WAIT_MS);
  }

  _autoSaveTimer = setTimeout(() => {
    _autoSaveTimer = null;
    if (_autoSaveMaxWaitTimer) {
      clearTimeout(_autoSaveMaxWaitTimer);
      _autoSaveMaxWaitTimer = null;
    }
    autoSaveNote({ silent: true }).catch(() => {});
  }, AUTOSAVE_DEBOUNCE_MS);
}

function clearAutoSave() {
  if (_autoSaveTimer) { clearTimeout(_autoSaveTimer); _autoSaveTimer = null; }
  if (_autoSaveMaxWaitTimer) { clearTimeout(_autoSaveMaxWaitTimer); _autoSaveMaxWaitTimer = null; }
}

if (typeof window !== 'undefined') {
  window.scheduleAutoSave = scheduleAutoSave;
  window.scheduleAutosave = scheduleAutoSave;
  window.clearAutoSave = clearAutoSave;
}

function scheduleEditorInputRefresh() {
  if (_editorInputRefreshTimer) return;
  _editorInputRefreshTimer = setTimeout(() => {
    _editorInputRefreshTimer = null;
    syncPreview();
    syncImageStrip();
  }, 250);
}

async function finalizeReviewedNoteSnapshot(noteSnapshot) {
  if (!noteSnapshot || !noteSnapshot.path) return false;

  try {
    const originalHTML = noteSnapshot.originalHTML || await StorageAPI.readNoteContent(noteSnapshot.path);
    const parsed = (typeof parseNoteHTML === 'function') ? parseNoteHTML(originalHTML) : null;
    const changes = {
      title: noteSnapshot.title ?? parsed?.title ?? '',
      date: noteSnapshot.date ?? parsed?.date ?? '',
      group_tags: noteSnapshot.group_tags ?? parsed?.group_tags ?? [],
      major_topic_tags: noteSnapshot.major_topic_tags ?? parsed?.major_topic_tags ?? [],
      topic_tags: noteSnapshot.topic_tags ?? parsed?.topic_tags ?? [],
      extra_tags: noteSnapshot.extra_tags ?? parsed?.extra_tags ?? [],
      mainHTML: noteSnapshot.mainHTML ?? parsed?.mainHTML ?? '<p></p>',
      summary: noteSnapshot.summary ?? parsed?.summary ?? '',
      reviewed: true
    };

    const updatedHTML = applyNoteEdits(originalHTML, changes);
    await StorageAPI.writeNoteContent(noteSnapshot.path, updatedHTML);

    const modified = new Date().toISOString();
    upsertManifest({
      ...noteSnapshot,
      ...changes,
      reviewed: true,
      originalHTML: updatedHTML,
      modified
    });
    await saveManifest({ force: true });

    if (typeof renderPlanner === 'function') {
      renderPlanner();
    }

    broadcastSync({
      type: 'NOTE_SAVED',
      noteId: noteSnapshot.id || '',
      path: noteSnapshot.path,
      modified
    });

    try { await updateNoteInCollabIndex(noteSnapshot.path); } catch (e) {}
    return true;
  } catch (e) {
    console.error('Finalize note review failed:', e);
    return false;
  }
}

function updateTitleRenameHint() {
  const hint = document.getElementById('title-rename-hint');
  if (hint) hint.style.display = 'none';
  _updateMetaTitlePreview();
}

// Update the metadata-collapsed header's title preview text
function _updateMetaTitlePreview() {
  const preview = document.getElementById('edit-meta-title-preview');
  if (!preview) return;
  const title = document.getElementById('edit-title')?.value?.trim() || '';
  const dateEl = document.getElementById('edit-date')?.value || '';
  const groupTags = readTagEditor('editor-group');
  const wsName = (typeof getNoteWorkstreamName === 'function')
    ? (getNoteWorkstreamName(currentNote) || currentNote?.workstream || '')
    : (currentNote?.workstream || '');

  const parts = [title || (typeof t === 'function' ? t('common.untitledNote') : 'Untitled Note')];
  if (dateEl) parts.push(dateEl);
  if (wsName) {
    // When a workstream is present, show workstream and do not show group tags
    parts.push(wsName);
  } else if (groupTags && groupTags.length) {
    // When no workstream is present, show group tags
    parts.push(groupTags.join(', '));
  }
  preview.textContent = parts.join(' · ');
}

// Apply current metadataCollapsed state to DOM
function _applyMetadataCollapseState() {
  const wrap    = document.getElementById('edit-meta-wrap');
  const chevron = document.getElementById('edit-meta-chevron');
  const btn     = document.getElementById('btn-overlay-toggle-meta');
  if (!wrap) return;
  const hint = document.getElementById('edit-meta-toggle-hint');
  if (metadataCollapsed) {
    wrap.classList.add('collapsed');
    if (chevron) chevron.classList.add('collapsed');
    if (hint) hint.textContent = t('editor.editInfo') || 'Edit Info';
    if (btn) {
      btn.classList.add('collapsed');
      btn.classList.remove('active');
      btn.title = t('editor.editInfo') || 'Edit Info';
      btn.setAttribute('aria-expanded', 'false');
      const textEl = btn.querySelector('.overlay-meta-btn-text');
      if (textEl) textEl.textContent = t('editor.metaInfoLabel') || 'Info';
    }
  } else {
    wrap.classList.remove('collapsed');
    if (chevron) chevron.classList.remove('collapsed');
    if (hint) hint.textContent = t('editor.hideInfo') || 'Hide Info';
    if (btn) {
      btn.classList.remove('collapsed');
      btn.classList.add('active');
      btn.title = t('editor.hideInfo') || 'Hide Info';
      btn.setAttribute('aria-expanded', 'true');
      const textEl = btn.querySelector('.overlay-meta-btn-text');
      if (textEl) textEl.textContent = t('editor.metaInfoLabel') || 'Info';
    }
  }
  if (typeof updateMetadataSummaryProposalUI === 'function') {
    updateMetadataSummaryProposalUI(currentNote);
  }
}

// Toggle metadata collapse
function toggleMetadataCollapse() {
  const panel = document.querySelector('.overlay-panel');
  if (panel && panel.classList.contains('overlay-view-mode')) return;
  metadataCollapsed = !metadataCollapsed;
  try { localStorage.setItem('secretaryMetaCollapsed', metadataCollapsed ? '1' : '0'); } catch(e) {}
  _applyMetadataCollapseState();
  if (metadataCollapsed) {
    const ta = document.getElementById('edit-textarea');
    if (ta) ta.focus();
  }
}

function setSaveIndicator(state) {
  const el = document.getElementById('overlay-save-indicator');
  if (!el) return;
  el.className = 'save-indicator' + (state ? ' '+state : '');
  if (state === 'saving') { el.textContent = t('common.saveIndicatorSaving'); }
  else if (state === 'saved') { el.textContent = t('common.saveIndicatorSaved'); setTimeout(() => { if (el.textContent === t('common.saveIndicatorSaved')) { el.textContent = ''; el.className = 'save-indicator'; }}, 2000); }
  else if (state === 'error') { el.textContent = t('common.saveIndicatorError'); }
  else { el.textContent = ''; }
}

function flushTagEditorInputs() {
  ['editor-group','editor-major','editor-topic','editor-extra'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const input = el.querySelector('input.tag-add');
    if (input && input.value.trim()) {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }
  });
}

const _savedAssetPaths = new Set();

async function processAndExternalizeImages(html) {
  if (!html || typeof html !== 'string') return html;

  // First, if any images already have a data-asset-path attribute, restore that asset path directly
  let updatedHtml = html.replace(/<img\b([^>]*?)\bsrc=["']data:image\/[^"']+["']([^>]*?)\bdata-asset-path=["']([^"']+)["']([^>]*?)>/gi, '<img$1src="$3"$2$4>')
                        .replace(/<img\b([^>]*?)\bdata-asset-path=["']([^"']+)["']([^>]*?)\bsrc=["']data:image\/[^"']+["']([^>]*?)>/gi, '<img$1src="$2"$3$4>');

  if (!updatedHtml.includes('data:image/')) return updatedHtml;
  try {
    const dataUrlRegex = /src=["'](data:image\/(png|jpeg|jpg|webp|gif|svg\+xml);base64,([^"']+))["']/gi;
    let match;
    const replacements = [];
    while ((match = dataUrlRegex.exec(updatedHtml)) !== null) {
      const fullDataUrl = match[1];
      const mimeSub = match[2].replace('+xml', '');
      const ext = mimeSub === 'jpeg' ? 'jpg' : mimeSub;
      const base64Data = match[3];
      
      let hash1 = 0xdeadbeef ^ 2166136261;
      let hash2 = 0x41c6ce57 ^ 2166136261;
      for (let i = 0; i < base64Data.length; i++) {
        const ch = base64Data.charCodeAt(i);
        hash1 = Math.imul(hash1 ^ ch, 2654435761);
        hash2 = Math.imul(hash2 ^ ch, 1597334677);
      }
      const combinedHash = ((hash1 >>> 0) + (hash2 >>> 0)).toString(16);
      const assetId = `img_${combinedHash}_${base64Data.length}.${ext}`;
      const relPath = `notes/_assets/${assetId}`;

      if (!_savedAssetPaths.has(relPath)) {
        try {
          if (typeof window !== 'undefined' && window.FirebaseSyncService?.saveAsset && window.StorageAPI?.getStorageEngine() === 'firebase') {
            await window.FirebaseSyncService.saveAsset(relPath, fullDataUrl);
          }
          await writeFile(relPath, fullDataUrl);
          _savedAssetPaths.add(relPath);
        } catch (e) {
          console.warn('Failed to save image asset:', relPath, e);
        }
      }
      if (typeof _assetDataUrlCache !== 'undefined') {
        _assetDataUrlCache.set(relPath, fullDataUrl);
        _assetDataUrlCache.set(assetId, fullDataUrl);
        _assetDataUrlCache.set(relPath.replace(/^notes\//, ''), fullDataUrl);
      }
      replacements.push({ fullDataUrl, relPath });
    }

    for (const item of replacements) {
      updatedHtml = updatedHtml.replaceAll(item.fullDataUrl, item.relPath);
    }
    return updatedHtml;
  } catch (e) {
    console.error('processAndExternalizeImages failed:', e);
    return html;
  }
}

function resolveNoteImagesSync(html) {
  if (!html || typeof html !== 'string') return html;
  if (!html.includes('_assets/')) return html;
  const cache = (typeof _assetDataUrlCache !== 'undefined' ? _assetDataUrlCache : null) || (typeof window !== 'undefined' && window._assetDataUrlCache ? window._assetDataUrlCache : null) || (typeof globalThis !== 'undefined' && globalThis._assetDataUrlCache ? globalThis._assetDataUrlCache : null);
  if (!cache || !cache.size) return html;

  try {
    const regex = /src=["']((?:(?:\.\/|\.\.\/)?(?:notes\/)?)?_assets\/[^"']+)["']/gi;
    return html.replace(regex, (fullMatch, originalSrc) => {
      const cleanPath = originalSrc.replace(/^(\.\/|\.\.\/)+/, '');
      const normalizedPath = cleanPath.startsWith('notes/') ? cleanPath : `notes/${cleanPath}`;
      const altKey = normalizedPath.startsWith('notes/') ? normalizedPath.slice(6) : `notes/${normalizedPath}`;
      const fileName = normalizedPath.split('/').pop();
      const dataUrl = cache.get(normalizedPath) || cache.get(altKey) || cache.get(fileName) || null;
      if (dataUrl) {
        return `src="${dataUrl}" data-asset-path="${normalizedPath}"`;
      }
      return fullMatch;
    });
  } catch (e) {
    return html;
  }
}

async function resolveNoteImages(html) {
  if (!html || typeof html !== 'string') return html;
  if (!html.includes('_assets/')) return html;
  const cache = (typeof _assetDataUrlCache !== 'undefined' ? _assetDataUrlCache : null) || (typeof window !== 'undefined' && window._assetDataUrlCache ? window._assetDataUrlCache : null) || (typeof globalThis !== 'undefined' && globalThis._assetDataUrlCache ? globalThis._assetDataUrlCache : null);

  try {
    const regex = /src=["']((?:(?:\.\/|\.\.\/)?(?:notes\/)?)?_assets\/[^"']+)["']/gi;
    const matches = [...html.matchAll(regex)];
    if (!matches.length) return html;

    let resolvedHtml = html;
    for (const match of matches) {
      const originalSrc = match[1];
      const cleanPath = originalSrc.replace(/^(\.\/|\.\.\/)+/, '');
      const normalizedPath = cleanPath.startsWith('notes/') ? cleanPath : `notes/${cleanPath}`;
      const altKey = normalizedPath.startsWith('notes/') ? normalizedPath.slice(6) : `notes/${normalizedPath}`;
      const fileName = normalizedPath.split('/').pop();
      const dataUrl = (typeof readAssetAsDataUrl === 'function' ? await readAssetAsDataUrl(normalizedPath) : null)
        || cache?.get(normalizedPath) || cache?.get(altKey) || cache?.get(fileName) || null;
      if (dataUrl) {
        resolvedHtml = resolvedHtml.replaceAll(`src="${originalSrc}"`, `src="${dataUrl}" data-asset-path="${normalizedPath}"`);
        resolvedHtml = resolvedHtml.replaceAll(`src='${originalSrc}'`, `src="${dataUrl}" data-asset-path="${normalizedPath}"`);
      }
    }
    return resolvedHtml;
  } catch (e) {
    console.error('resolveNoteImages failed:', e);
    return html;
  }
}

if (typeof window !== 'undefined') {
  window.resolveNoteImages = resolveNoteImages;
  window.resolveNoteImagesSync = resolveNoteImagesSync;
}

function getDefaultNoteTemplateHTML(lang) {
  const l = lang || (typeof getWorkingLanguage === 'function' ? getWorkingLanguage() : (typeof getNoteLanguage === 'function' ? getNoteLanguage() : 'en'));
  const goalHeader = t('common.goal', { lang: l }) || 'Goal';
  const notesHeader = t('common.notes', { lang: l }) || 'Notes';
  const decisionsHeader = t('common.decisions', { lang: l }) || 'Decisions';
  const actionsHeader = t('common.actions', { lang: l }) || 'Action Items';

  return `
<h2>${escH(goalHeader)}</h2>
<p></p>
<h2>${escH(notesHeader)}</h2>
<p></p>
<h2>${escH(decisionsHeader)}</h2>
<p></p>
<h2>${escH(actionsHeader)}</h2>
<p></p>
  `.trim();
}

function updateNoteWindowTitle(note = null) {
  const target = note || currentNote;
  if (!_isFocusedMode) return;
  const appName = typeof t === 'function' ? t('app.name') : 'Secretary';
  const untitledText = typeof t === 'function' ? (t('common.untitledNote') || t('common.untitled') || 'Untitled Note') : 'Untitled Note';
  const title = (target?.title || '').trim() || untitledText;
  document.title = `${title} — ${appName}`;
}

let _activeSavePromise = null;

async function autoSaveNote(options = {}) {
  while (_activeSavePromise) {
    try { await _activeSavePromise; } catch (e) {}
  }
  _activeSavePromise = _executeAutoSaveNote(options);
  try {
    return await _activeSavePromise;
  } finally {
    _activeSavePromise = null;
  }
}

async function _executeAutoSaveNote({ silent = false, isFinal = false, noteToSave = null } = {}) {
  if (_isNoteLoading) return true;
  const activeNote = noteToSave || currentNote;
  if (!activeNote) return true;

  // Do not overwrite note if editing is locked in Daily Review due to being open in another window
  if (typeof DailyReviewController !== 'undefined' && DailyReviewController?.isCurrentNoteLocked && DailyReviewController.isCurrentNoteLocked(activeNote.path)) {
    return false;
  }

  // Fast return if not a final save and no unsaved changes exist
  if (!isFinal && !hasUnsavedNoteOverlayChanges()) {
    if (!silent) setSaveIndicator('');
    return true;
  }

  flushTagEditorInputs();
  const isSavingCurrentDOM = !noteToSave || (currentNote && currentNote.path === noteToSave.path && currentNote.id === noteToSave.id);
  const ta = isSavingCurrentDOM ? document.getElementById('edit-textarea') : null;
  if (ta) {
    ta.querySelectorAll('input[type="checkbox"]').forEach(chk => {
      chk.toggleAttribute('checked', chk.checked);
    });
  }
  let mainHTML = ta ? (typeof window.cleanHtmlBeforeSave === 'function' ? window.cleanHtmlBeforeSave(ta.innerHTML) : ta.innerHTML) : (activeNote.mainHTML || '<p></p>');
  const summaryEl = isSavingCurrentDOM ? document.getElementById('edit-summary') : null;
  if (summaryEl) {
    summaryEl.querySelectorAll('input[type="checkbox"]').forEach(chk => {
      chk.toggleAttribute('checked', chk.checked);
    });
  }
  let summaryHTML = summaryEl ? summaryEl.innerHTML : (activeNote.summary || '');

  // Process & externalize base64 images so note HTML file stays lightweight
  mainHTML = await processAndExternalizeImages(mainHTML);
  summaryHTML = await processAndExternalizeImages(summaryHTML);

  let titleVal = isSavingCurrentDOM ? (document.getElementById('edit-title')?.value?.trim() || activeNote.title || '') : (activeNote.title || '');
  let dateVal  = isSavingCurrentDOM ? (document.getElementById('edit-date')?.value?.trim()  || activeNote.date  || '') : (activeNote.date || '');

  if (!titleVal) titleVal = typeof t === 'function' ? t('common.untitledNote') : 'Untitled Note';
  if (!dateVal)  dateVal  = new Date().toISOString().slice(0, 10);

  const changes = {
    title:             titleVal,
    date:              dateVal,
    workstream:        activeNote.workstream || '',
    group_tags:        isSavingCurrentDOM ? readTagEditor('editor-group') : (activeNote.group_tags || []),
    major_topic_tags:  isSavingCurrentDOM ? readTagEditor('editor-major') : (activeNote.major_topic_tags || []),
    topic_tags:        isSavingCurrentDOM ? readTagEditor('editor-topic') : (activeNote.topic_tags || []),
    extra_tags:        isSavingCurrentDOM ? readTagEditor('editor-extra') : (activeNote.extra_tags || []),
    mainHTML,
    summary:           summaryHTML,
  };
  if (activeNote.hasOwnProperty('reviewed')) {
    changes.reviewed = activeNote.reviewed;
  }

  try {
    if (!silent) setSaveIndicator('saving');
    if (activeNote.path) {
      if (isFinal) {
        await _doFullNoteSave(changes, activeNote);
      } else {
        const curManifest = (typeof manifest !== 'undefined' && Array.isArray(manifest)) ? manifest : ((typeof window !== 'undefined' && Array.isArray(window.manifest)) ? window.manifest : []);
        const knownGroups = new Set(curManifest.flatMap(n => n.group_tags || []));
        const knownMajors = new Set(curManifest.flatMap(n => n.major_topic_tags || []));
        const hasNewLane  = [...changes.group_tags, ...changes.major_topic_tags]
                              .some(t => !knownGroups.has(t) && !knownMajors.has(t));
        const updatedHTML = (typeof applyNoteEdits === 'function') ? applyNoteEdits(activeNote.originalHTML, changes) : (activeNote.originalHTML || '');
        await StorageAPI.writeNoteContent(activeNote.path, updatedHTML);
        Object.assign(activeNote, changes, { originalHTML: updatedHTML });
        upsertManifest(activeNote);
        saveManifest();
        if (hasNewLane) { renderFilterChips(); renderBoard(); }
      }
    } else {
      await _doFullNoteSave(changes, activeNote);
    }
    if (!silent) setSaveIndicator('saved');
    if (isFinal) {
      try {
        if (typeof window.registerCollaboratorsFromNoteHTML === 'function') {
          window.registerCollaboratorsFromNoteHTML(mainHTML);
        }
      } catch(e) {}
    }

    const resolvedId   = activeNote.id || currentNote?.id || '';
    const resolvedPath = activeNote.path || currentNote?.path || '';

    // Synchronize note tags back to any linked planner blocks (note -> bloc direction)
    if (resolvedId && Array.isArray(plannerEvents) && plannerEvents.length > 0) {
      let plannerEventsChanged = false;
      const noteGroupTags = Array.isArray(changes.group_tags) ? changes.group_tags : [];
      const noteMajorTags = Array.isArray(changes.major_topic_tags) ? changes.major_topic_tags : [];
      const noteTopicTags = Array.isArray(changes.topic_tags) ? changes.topic_tags : [];

      plannerEvents.forEach(e => {
        if (e && (String(e.noteId || '').trim() === resolvedId || (Array.isArray(e.linkedNoteIds) && e.linkedNoteIds.includes(resolvedId)))) {
          const eGroupTags = Array.isArray(e.group_tags) ? e.group_tags : [];
          const eMajorTags = Array.isArray(e.major_topic_tags) ? e.major_topic_tags : [];
          const eTopicTags = Array.isArray(e.topic_tags) ? e.topic_tags : [];
          if (JSON.stringify(eGroupTags) !== JSON.stringify(noteGroupTags) ||
              JSON.stringify(eMajorTags) !== JSON.stringify(noteMajorTags) ||
              JSON.stringify(eTopicTags) !== JSON.stringify(noteTopicTags)) {
            e.group_tags = [...noteGroupTags];
            e.major_topic_tags = [...noteMajorTags];
            e.topic_tags = [...noteTopicTags];
            e.tags = [...new Set([...noteGroupTags, ...noteMajorTags, ...noteTopicTags])];
            plannerEventsChanged = true;
          }
        }
      });
      if (plannerEventsChanged) {
        if (typeof savePlanner === 'function') savePlanner();
        if (typeof renderPlanner === 'function') renderPlanner();
      }
    }

    if (resolvedId || resolvedPath) {
      broadcastSync({ type: 'NOTE_SAVED', noteId: resolvedId, path: resolvedPath, modified: new Date().toISOString() });
      if (isFinal) {
        try { await updateNoteInCollabIndex(resolvedPath); } catch(e) {}
      }
      if (window.AppBridge?.noteWindow?.notifyActiveNote) {
        window.AppBridge.noteWindow.notifyActiveNote(resolvedId, resolvedPath);
      }
      if (typeof DailyReviewController !== 'undefined' && typeof DailyReviewController.updateNoteSummaryBadge === 'function') {
        DailyReviewController.updateNoteSummaryBadge(resolvedPath, activeNote?.summary || '');
      }
    }
    const isEditorActive = typeof document !== 'undefined' && document.activeElement && 
      (document.activeElement.id === 'edit-textarea' || document.activeElement.id === 'edit-summary' || document.activeElement.closest?.('#edit-textarea, #edit-summary'));
    if (isFinal || !isEditorActive) {
      const fn = (typeof globalThis !== 'undefined' && globalThis.renderInspectorPanel) || (typeof renderInspectorPanel === 'function' ? renderInspectorPanel : null);
      if (fn) await fn();
    }
    updateNoteWindowTitle(activeNote);
    return true;
  } catch(e) {
    setSaveIndicator('error');
    if (e && !e.message?.includes('No root folder handle loaded')) {
      console.error('Auto-save failed:', e);
    }
    return false;
  }
}

async function saveCurrentNote() {
  return await autoSaveNote({ silent: false, isFinal: true });
}

async function _doFullNoteSave(changes, targetNote = null) {
  const noteObj = targetNote || currentNote || {};
  const noteId = noteObj.id || (noteObj.id = generateNoteId());
  const path = getCanonicalNotePath(noteId);
  if (noteObj.path) {
    const updatedHTML = applyNoteEdits(noteObj.originalHTML, changes);
    if (noteObj.path !== path) {
      await StorageAPI.writeNoteContent(path, updatedHTML);
      try { await StorageAPI.deleteNoteContent(noteObj.path); } catch(e) {}
      noteObj.path = path;
    } else {
      await StorageAPI.writeNoteContent(path, updatedHTML);
    }
    Object.assign(noteObj, changes, { originalHTML: updatedHTML });
    upsertManifest(noteObj);
    broadcastSync({ type: 'NOTE_SAVED', noteId: noteObj.id, path: noteObj.path, modified: new Date().toISOString() });
  } else {
    if (!changes.title) changes.title = typeof t === 'function' ? t('common.untitledNote') : 'Untitled Note';
    if (!changes.date)  changes.date  = new Date().toISOString().slice(0, 10);
    const note = {
      id:               noteId,
      path,
      title:            changes.title,
      date:             changes.date,
      group_tags:       changes.group_tags,
      major_topic_tags: changes.major_topic_tags,
      topic_tags:       changes.topic_tags,
      extra_tags:       changes.extra_tags,
      mainHTML:         changes.mainHTML,
    };
    const html = buildNewNoteHTML(note);
    await StorageAPI.writeNoteContent(path, html);
    Object.assign(noteObj, { path, originalHTML: html, ...note });
    if (!currentNote || currentNote === noteObj) {
      currentNote = noteObj;
    }
    upsertManifest(noteObj);
    broadcastSync({ type: 'NOTE_SAVED', noteId: noteObj.id, path: noteObj.path, modified: new Date().toISOString() });
  }
  await saveManifest({ force: true });
  if (typeof notifyDailyReviewNoteChanged === 'function') {
    notifyDailyReviewNoteChanged(noteObj?.path, { noteId: noteObj?.id });
  }
  if (typeof lastActiveNoteForTab !== 'undefined') {
    lastActiveNoteForTab[activeTab] = noteObj?.path || null;
  }
  try { await createMissingTodosForCurrentNote(); } catch(e) {}
  if (typeof rebuildIndexHTML === 'function') await rebuildIndexHTML();
  if (typeof renderFilterChips === 'function') renderFilterChips();
  if (typeof renderBoard === 'function') renderBoard();
  if (typeof activeTab !== 'undefined' && activeTab === 'retro' && typeof renderRetroPanel === 'function') renderRetroPanel();
}
let overlayStack = [];
let activeInspectorTab = 'A';
let showDecisionPicker = false;
let decisionPickerQuery = '';
let _activeOpenNotePath = null;
let _activeOpenNotePromise = null;
let _isNoteLoading = false;

async function openNoteOverlay(path, prefillGroup, prefillMajor, isPop = false, prefillTopic = null, options = {}) {
  const normKey = String(path || '__new__');
  if (_activeOpenNotePromise && _activeOpenNotePath === normKey) {
    return await _activeOpenNotePromise;
  }
  _activeOpenNotePath = normKey;
  _activeOpenNotePromise = (async () => {
    _isNoteLoading = true;
    try {
      await _doOpenNoteOverlay(path, prefillGroup, prefillMajor, isPop, prefillTopic, options);
    } finally {
      _isNoteLoading = false;
      _activeOpenNotePromise = null;
      _activeOpenNotePath = null;
    }
  })();
  return await _activeOpenNotePromise;
}

async function _doOpenNoteOverlay(path, prefillGroup, prefillMajor, isPop = false, prefillTopic = null, options = {}) {
  const isDedicatedNoteWindow = (typeof isFocusedNoteWindow === 'function' ? isFocusedNoteWindow() : _isFocusedMode) || (location.hash && (location.hash.includes('note=') || location.hash.includes('path=') || location.hash.includes('preloaded=true')));
  const isInDailyReview = (typeof activeTab !== 'undefined' && activeTab === 'daily-review') || !!options?.embeddedInDailyReview;
  if (window.AppBridge?.isElectron && window.AppBridge?.noteWindow && (!isDedicatedNoteWindow || options?.openInNewWindow) && !options?.sameWindow && !isInDailyReview) {
    let meta = null;
    if (path) {
      meta = (typeof getMetaByPath === 'function' ? getMetaByPath(path) : null)
        || (typeof getMetaById === 'function' ? getMetaById(path) : null)
        || (manifest && manifest.find(m => m.path === path || m.id === path || m.path?.replace(/\\/g, '/') === String(path).replace(/\\/g, '/')));
    }
    const normP = path ? String(path).replace(/\\/g, '/') : '';
    const resolvedNoteId = meta?.id || (normP && !normP.includes('/') ? normP : null);
    if (resolvedNoteId || path) {
      window.AppBridge.noteWindow.open(resolvedNoteId, normP || path);
      return;
    } else {
      currentNote = { path: null, originalHTML: null, id: generateNoteId(), title: typeof t === 'function' ? t('common.untitledNote') : 'Untitled Note', date: new Date().toISOString().slice(0,10),
      group_tags: prefillGroup ? [prefillGroup] : [], major_topic_tags: prefillMajor ? [prefillMajor] : [], topic_tags: prefillTopic ? [prefillTopic] : [], extra_tags: [], mainHTML: getDefaultNoteTemplateHTML(), summary: '' };
      const savedOk = await autoSaveNote({ silent: true, isFinal: true });
      if (savedOk && currentNote?.id && currentNote?.path) {
        window.AppBridge.noteWindow.open(currentNote.id, currentNote.path.replace(/\\/g, '/'));
        return;
      }
    }
  }

  const overlay = document.getElementById('note-edit-overlay');
  if (!overlay) return;

  activeInspectorTab = 'A';
  showDecisionPicker = false;
  decisionPickerQuery = '';
  _lastImageStripSignature = '';
  document.removeEventListener('click', _dismissDecisionPicker);
  closeLinkNotePicker();

  // Always ensure editor elements are properly restored to #note-edit-overlay .overlay-panel
  if (window.DailyReviewController && typeof window.DailyReviewController.restoreStep3NoteEditor === 'function') {
    const isInsideDailyReviewStep = (typeof activeTab !== 'undefined' && activeTab === 'daily-review') &&
      (DailyReviewController.currentStep === 4 || DailyReviewController.currentStep === 5);
    if (!isInsideDailyReviewStep && !options?.embeddedInDailyReview) {
      window.DailyReviewController.restoreStep3NoteEditor();
    }
  }
  
  if (currentNote && overlay.style.display !== 'none' && path !== currentNote.path && !isPop) {
    const saveOk = await autoSaveNote({ silent: true, isFinal: true });
    if (!saveOk) {
      toast(t('common.saveFailed', { message: 'Current note could not be saved before switching.' }), true);
      return;
    }
    if (!_isFocusedMode) {
      overlayStack.push(currentNote.path);
    }
  } else if (!currentNote || overlay.style.display === 'none' || _isFocusedMode) {
    overlayStack = [];
  }

  const backBtn = document.getElementById('overlay-back-btn');
  if (backBtn) {
    backBtn.style.display = (!_isFocusedMode && overlayStack.length > 0) ? '' : 'none';
  }

  clearAutoSave();
  dismissReloadBanner(); // always hide the "updated in another window" banner on fresh open
  if (path) {
    try {
      let html = (StorageAPI && StorageAPI.getNoteFromCache(path)) || await StorageAPI.readNoteContent(path);
      const meta = (typeof getMetaByPath === 'function' ? getMetaByPath(path) : null)
        || (typeof getMetaById === 'function' ? getMetaById(path) : null)
        || (manifest && manifest.find(m => m.path === path || m.id === path))
        || {};
      if (!html) {
        html = (typeof buildNewNoteHTML === 'function') ? buildNewNoteHTML({
          id: meta.id || generateNoteId(),
          path,
          title: meta.title || '',
          date: meta.date || new Date().toISOString().slice(0, 10),
          group_tags: meta.group_tags || [],
          major_topic_tags: meta.major_topic_tags || [],
          topic_tags: meta.topic_tags || [],
          extra_tags: meta.extra_tags || [],
          mainHTML: getDefaultNoteTemplateHTML(),
          summary: meta.summary || ''
        }) : '';
      }
      const parsed = parseNoteHTML(html || '');
      currentNote = {
        path,
        originalHTML: html,
        ...parsed,
        id: meta.id || parsed.id || generateNoteId(),
        date: meta.date || parsed.date || new Date().toISOString().slice(0, 10),
        title: parsed.title || meta.title || '',
        group_tags: (parsed.group_tags && parsed.group_tags.length) ? parsed.group_tags : (meta.group_tags || []),
        major_topic_tags: (parsed.major_topic_tags && parsed.major_topic_tags.length) ? parsed.major_topic_tags : (meta.major_topic_tags || []),
        topic_tags: (parsed.topic_tags && parsed.topic_tags.length) ? parsed.topic_tags : (meta.topic_tags || []),
        extra_tags: (parsed.extra_tags && parsed.extra_tags.length) ? parsed.extra_tags : (meta.extra_tags || []),
        summary: parsed.summary || meta.summary || ''
      };
    } catch(e) {
      console.error('Could not open note content:', path, e);
      toast(t('common.couldNotOpenNote', { message: e.message }), true);
      return;
    }
  } else {
    currentNote = { path: null, originalHTML: null, id: generateNoteId(), title: typeof t === 'function' ? t('common.untitledNote') : 'Untitled Note', date: new Date().toISOString().slice(0,10),
      group_tags: prefillGroup ? [prefillGroup] : [], major_topic_tags: prefillMajor ? [prefillMajor] : [], topic_tags: prefillTopic ? [prefillTopic] : [], extra_tags: [], mainHTML: getDefaultNoteTemplateHTML(), summary: '' };
  }

  // Check if opened from a bloc with tags (or options specify sourceEvent/fromBloc/collapseMetadata)
  let openedFromBlocWithTags = false;
  let sourceBloc = options?.sourceEvent || null;
  if (!sourceBloc && currentNote?.id && Array.isArray(plannerEvents)) {
    sourceBloc = plannerEvents.find(e => e && (String(e.noteId || '').trim() === String(currentNote.id || '').trim() || (Array.isArray(e.linkedNoteIds) && e.linkedNoteIds.includes(currentNote.id)))) || null;
  }
  if (sourceBloc) {
    const sGroups = Array.isArray(sourceBloc.group_tags) ? sourceBloc.group_tags.map(t => String(t).trim()).filter(Boolean) : [];
    const sMajors = Array.isArray(sourceBloc.major_topic_tags) ? sourceBloc.major_topic_tags.map(t => String(t).trim()).filter(Boolean) : [];
    const sTopics = Array.isArray(sourceBloc.topic_tags) ? sourceBloc.topic_tags.map(t => String(t).trim()).filter(Boolean) : [];
    if (sGroups.length > 0 || sMajors.length > 0 || sTopics.length > 0) {
      openedFromBlocWithTags = true;
    }
    if (typeof syncTagsBetweenBlocAndNote === 'function') {
      await syncTagsBetweenBlocAndNote(sourceBloc, currentNote);
    }
  }

  const titleEl = document.getElementById('edit-title');
  if (titleEl) titleEl.value = currentNote.title || '';
  const dateEl = document.getElementById('edit-date');
  if (dateEl) dateEl.value = currentNote.date || '';
  const summaryEditorEl = document.getElementById('edit-summary');
  if (summaryEditorEl) {
    const sumHTML = await resolveNoteImages(currentNote.summary || '<p><br></p>');
    summaryEditorEl.innerHTML = sumHTML;
    if (typeof renderLatexInElement === 'function') renderLatexInElement(summaryEditorEl);
  }
  const btnSummaryAi = document.getElementById('btn-generate-summary-ai');
  const btnAiAnalyze = document.getElementById('btn-ai-analyze');
  const btnAiRefactor = document.getElementById('btn-ai-refactor');
  const btnAiAnalyzeFloating = document.getElementById('editor-floating-ai-controls');
  const aiEnabled = typeof LLMService !== 'undefined' && LLMService.isEnabled();
  if (btnSummaryAi) btnSummaryAi.style.display = aiEnabled ? 'inline-flex' : 'none';
  if (btnAiAnalyze) btnAiAnalyze.style.display = 'inline-flex';
  if (btnAiRefactor) btnAiRefactor.style.display = aiEnabled ? 'inline-flex' : 'none';
  if (btnAiAnalyzeFloating) btnAiAnalyzeFloating.style.display = aiEnabled ? 'flex' : 'none';
  if (typeof setAiActionState === 'function') {
    setAiActionState('idle');
  } else if (typeof syncAiEditorButtonState === 'function') {
    syncAiEditorButtonState();
  }
  
  const editArea = document.getElementById('edit-textarea');
  if (editArea) {
    let cleanHTML = currentNote.mainHTML || getDefaultNoteTemplateHTML();
    if (typeof window.cleanHtmlBeforeSave === 'function') {
      cleanHTML = window.cleanHtmlBeforeSave(cleanHTML);
    }
    if (!cleanHTML || cleanHTML.trim() === '<p><br></p>' || cleanHTML.trim() === '<p></p>') {
      cleanHTML = getDefaultNoteTemplateHTML();
    }
    cleanHTML = await resolveNoteImages(cleanHTML);
    editArea.innerHTML = cleanHTML;
    if (typeof renderLatexInElement === 'function') renderLatexInElement(editArea);
  }
  populateTagEditor('editor-group', currentNote.group_tags,       'group');
  populateTagEditor('editor-major', currentNote.major_topic_tags, 'major');
  populateTagEditor('editor-topic', currentNote.topic_tags,       'topic');
  populateTagEditor('editor-extra', currentNote.extra_tags,       'extra');

  ['editor-group', 'editor-major', 'editor-topic', 'editor-extra'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      if (el._workstreamTagChangeListener) {
        el.removeEventListener('tagchange', el._workstreamTagChangeListener);
      }
      el._workstreamTagChangeListener = () => {
        if (currentNote) {
          currentNote.group_tags = readTagEditor('editor-group');
          currentNote.major_topic_tags = readTagEditor('editor-major');
          currentNote.topic_tags = readTagEditor('editor-topic');
          currentNote.extra_tags = readTagEditor('editor-extra');
          populateWorkstreamEditor(currentNote);
          _updateMetaTitlePreview();
        }
      };
      el.addEventListener('tagchange', el._workstreamTagChangeListener);
    }
  });

  populateWorkstreamEditor(currentNote);
  syncPreview();
  const _previewContent = document.getElementById('edit-preview-content');
  syncTodoMarkersFromDOM(_previewContent).then(() => {
    // Rebuild the action bar from the now-updated DOM so priorities/done-state are current
    const existingBar = _previewContent?.querySelector('.note-todo-bar');
    if (existingBar) existingBar.remove();
    const isEdit = !document.querySelector('.overlay-panel')?.classList.contains('overlay-view-mode');
    const bar = buildTodoActionBarEl(_previewContent?.innerHTML || '', isEdit);
    if (bar && _previewContent) _previewContent.insertBefore(bar, _previewContent.firstChild);
  });
  setSaveIndicator('');
  // Notes open directly in edit mode by default unless viewMode is explicitly requested
  setOverlayViewMode(!!(options && options.viewMode));
  if (typeof updateLLMToolbarVisibility === 'function') updateLLMToolbarVisibility();
  updateTitleRenameHint();   // always hidden on open (title matches path)

  // Apply metadata collapse state: collapse if opened from a bloc with tags or explicitly requested
  if (openedFromBlocWithTags || options?.collapseMetadata || options?.fromBloc) {
    metadataCollapsed = true;
  } else {
    metadataCollapsed = window.innerHeight < 750;
  }
  const metaWrap = document.getElementById('edit-meta-wrap');
  if (metaWrap) metaWrap.classList.add('no-anim');
  _applyMetadataCollapseState();
  requestAnimationFrame(() => {
    if (metaWrap) metaWrap.classList.remove('no-anim');
  });
  // Update title preview in collapsed header
  _updateMetaTitlePreview();
  if (window.ConflictResolverController) window.ConflictResolverController.checkActiveNoteConflict();

  // Apply visual zoom levels
  applyEditorZoom();

  // Ensure editor pane is visible
  const leftPane = document.getElementById('edit-pane-left');
  if (leftPane) leftPane.style.display = 'flex';

  const plannerModal = document.getElementById('planner-dynamic-modal');
  const todoOverlay = document.getElementById('todo-edit-overlay');
  if ((plannerModal && plannerModal.classList.contains('active')) || (todoOverlay && todoOverlay.style.display !== 'none')) {
    overlay.style.zIndex = '3500';
  } else {
    overlay.style.zIndex = '1000';
  }

  overlay.classList.remove('closing');
  overlay.classList.add('active');
  overlay.style.display = 'flex';
  updateUrlHash();
  updateNoteWindowTitle(currentNote);
  if (window.AppBridge?.noteWindow?.notifyActiveNote && currentNote) {
    window.AppBridge.noteWindow.notifyActiveNote(currentNote.id, currentNote.path);
  }
  if (window.electronAPI?.notifyNoteWindowReady) {
    window.electronAPI.notifyNoteWindowReady();
  }
  const titleInputEl = document.getElementById('edit-title');
  if (titleInputEl && !titleInputEl._boundLiveTitleSync) {
    titleInputEl._boundLiveTitleSync = true;
    titleInputEl.addEventListener('input', () => {
      if (_isFocusedMode && currentNote) {
        updateNoteWindowTitle({ ...currentNote, title: titleInputEl.value });
      }
    });
  }
  if (typeof lastActiveNoteForTab !== 'undefined') {
    lastActiveNoteForTab[activeTab] = currentNote?.path || null;
  }
  editMode = true;
  if (!path) document.getElementById('edit-title')?.focus();
  document.querySelectorAll('.sl-card').forEach(el =>
    el.classList.toggle('selected', el.dataset.path === (path||''))
  );

  // Render image strip and related notes panel
  syncImageStrip();
  await renderInspectorPanel();

  // Render planner block info for this note
  _renderPlannerBlocksForNote(currentNote?.id);

  if (typeof renderLeftPaneSuggestions === 'function') {
    renderLeftPaneSuggestions(currentNote);
  }
  if (typeof _setupEditorToolbarFocusListeners === 'function') {
    _setupEditorToolbarFocusListeners();
  }
  if (typeof setupToolbarScrollButtons === 'function') {
    setupToolbarScrollButtons();
  }
  updateReviewNoteButtonState();
  if (typeof updateLLMToolbarVisibility === 'function') updateLLMToolbarVisibility();
  if (window.syncFloatingChatContext) window.syncFloatingChatContext();
}

// ═══ Note Templates UI Handlers ═══
function openNoteTemplatePicker(defaultLang) {
  const initialLang = defaultLang || (typeof getWorkingLanguage === 'function' ? getWorkingLanguage() : 'en');
  const langSel = document.getElementById('template-picker-lang-select');
  if (langSel) {
    langSel.value = initialLang;
  }

  // Detect whether note has existing text/content
  const ta = document.getElementById('edit-textarea');
  let hasExistingContent = false;
  if (ta) {
    const rawContent = ta.contentEditable === 'true' ? ta.innerHTML : (currentNote?.mainHTML || ta.value || '');
    const cleanText = rawContent.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
    hasExistingContent = cleanText.length > 0;
  }

  const mergeContainer = document.getElementById('template-picker-merge-container');
  const mergeCheckbox = document.getElementById('template-picker-merge-checkbox');
  if (mergeCheckbox) {
    mergeCheckbox.checked = hasExistingContent;
  }
  if (mergeContainer) {
    mergeContainer.style.display = hasExistingContent ? 'inline-flex' : 'none';
  }

  renderTemplatePickerGrid(initialLang);
  openModal('modal-template-picker');
}
window.openNoteTemplatePicker = openNoteTemplatePicker;

function onTemplatePickerLanguageChange(val) {
  renderTemplatePickerGrid(val);
}
window.onTemplatePickerLanguageChange = onTemplatePickerLanguageChange;

function renderTemplatePickerGrid(lang) {
  const grid = document.getElementById('template-picker-grid');
  if (!grid || typeof NoteTemplateManager === 'undefined') return;

  const activeLang = lang || document.getElementById('template-picker-lang-select')?.value || (typeof getWorkingLanguage === 'function' ? getWorkingLanguage() : 'en');
  grid.innerHTML = '';
  const templates = NoteTemplateManager.getTemplates(activeLang);

  templates.forEach(tpl => {
    const card = document.createElement('div');
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.gap = '6px';
    card.style.padding = '12px 14px';
    card.style.borderRadius = '8px';
    card.style.background = 'var(--card-bg-alt)';
    card.style.border = '1px solid var(--card-border)';
    card.style.cursor = 'pointer';
    card.style.transition = 'all 0.15s ease';

    card.onmouseenter = () => {
      card.style.borderColor = 'var(--accent)';
      card.style.transform = 'translateY(-1px)';
    };
    card.onmouseleave = () => {
      card.style.borderColor = 'var(--card-border)';
      card.style.transform = 'none';
    };

    const top = document.createElement('div');
    top.style.display = 'flex';
    top.style.alignItems = 'center';
    top.style.gap = '8px';

    const icon = document.createElement('span');
    icon.style.fontSize = '1.2rem';
    icon.textContent = tpl.icon || '📝';

    const name = document.createElement('span');
    name.style.fontWeight = '600';
    name.style.fontSize = '0.92rem';
    name.style.color = 'var(--text)';
    name.textContent = tpl.name;

    top.appendChild(icon);
    top.appendChild(name);

    const desc = document.createElement('div');
    desc.style.fontSize = '0.78rem';
    desc.style.color = 'var(--text-muted)';
    desc.style.lineHeight = '1.4';
    desc.textContent = tpl.description;

    card.appendChild(top);
    card.appendChild(desc);

    // Render Headers Preview
    if (Array.isArray(tpl.headers) && tpl.headers.length > 0) {
      const headersContainer = document.createElement('div');
      headersContainer.style.display = 'flex';
      headersContainer.style.flexWrap = 'wrap';
      headersContainer.style.alignItems = 'center';
      headersContainer.style.gap = '4px';
      headersContainer.style.marginTop = '4px';

      const label = document.createElement('span');
      label.style.fontSize = '0.72rem';
      label.style.fontWeight = '600';
      label.style.color = 'var(--text-muted)';
      label.style.marginRight = '2px';
      label.textContent = (t('templates.headersPreview', { lang: activeLang }) || 'Headers') + ':';
      headersContainer.appendChild(label);

      tpl.headers.forEach(h => {
        const pill = document.createElement('span');
        pill.className = 'template-header-pill';
        pill.style.fontSize = '0.72rem';
        pill.style.padding = '1px 6px';
        pill.style.borderRadius = '4px';
        pill.style.background = 'var(--card-bg)';
        pill.style.border = '1px solid var(--card-border)';
        pill.style.color = 'var(--text)';
        pill.textContent = h;
        headersContainer.appendChild(pill);
      });

      card.appendChild(headersContainer);
    }

    card.onclick = () => {
      const mergeCheckbox = document.getElementById('template-picker-merge-checkbox');
      const shouldMerge = mergeCheckbox ? mergeCheckbox.checked : false;
      applyTemplateToCurrentNote(tpl.id, activeLang, { merge: shouldMerge });
      closeModal('modal-template-picker');
    };

    grid.appendChild(card);
  });
}

function applyTemplateToCurrentNote(templateId, lang, options = {}) {
  if (typeof NoteTemplateManager === 'undefined') return;
  const targetLang = lang || (typeof getWorkingLanguage === 'function' ? getWorkingLanguage() : 'en');
  const tplHTML = NoteTemplateManager.getTemplateHTML(templateId, targetLang);
  const ta = document.getElementById('edit-textarea');
  if (!ta) return;

  const currentContent = ta.contentEditable === 'true' ? ta.innerHTML : (currentNote?.mainHTML || ta.value || '');
  const cleanExisting = currentContent.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
  const shouldMerge = Boolean(options.merge && cleanExisting.length > 0);

  // Auto-save pre-template snapshot
  if (currentNote && currentNote.path && typeof StorageAPI !== 'undefined' && StorageAPI.saveSnapshot) {
    try {
      if (currentContent && currentContent.trim()) {
        StorageAPI.saveSnapshot(currentNote.path, currentContent, 'pre-template');
      }
    } catch (e) {}
  }

  if (ta.contentEditable === 'true') {
    if (shouldMerge) {
      ta.innerHTML = currentContent.trim() + '<p><br></p>' + tplHTML;
    } else {
      ta.innerHTML = tplHTML;
    }
  } else {
    if (shouldMerge) {
      ta.value = currentContent.trim() + '\n\n' + tplHTML;
    } else {
      ta.value = tplHTML;
    }
  }

  if (typeof syncPreview === 'function') syncPreview();
  if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
  toast(t('templates.templateApplied', { lang: targetLang }) || 'Template applied!');
}
window.applyTemplateToCurrentNote = applyTemplateToCurrentNote;

// ═══ Note Version History UI Handlers ═══
async function openNoteHistoryModal() {
  if (!currentNote || !currentNote.path) return;
  await renderNoteHistoryList();
  openModal('modal-note-history');
}
window.openNoteHistoryModal = openNoteHistoryModal;

async function renderNoteHistoryList() {
  const container = document.getElementById('note-history-list');
  const emptyHint = document.getElementById('note-history-empty-hint');
  if (!container || !currentNote || !currentNote.path) return;

  container.innerHTML = '';
  const snapshots = await StorageAPI.listSnapshots(currentNote.path);

  if (!snapshots || snapshots.length === 0) {
    if (emptyHint) emptyHint.style.display = 'block';
    return;
  }
  if (emptyHint) emptyHint.style.display = 'none';

  snapshots.forEach(snap => {
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

    const title = document.createElement('span');
    title.style.fontWeight = '600';
    title.style.fontSize = '0.88rem';
    title.style.color = 'var(--text)';
    const dateStr = snap.timestamp ? new Date(snap.timestamp).toLocaleString() : snap.dateStr;
    let localizedReason = snap.reason || 'snapshot';
    if (snap.reason === 'conflict-declined-remote') {
      localizedReason = (typeof t === 'function' ? t('sync.historyDeclinedRemote') : null) || 'Conflict: Declined Remote';
    } else if (snap.reason === 'conflict-declined-local') {
      localizedReason = (typeof t === 'function' ? t('sync.historyDeclinedLocal') : null) || 'Conflict: Declined Local';
    }
    title.textContent = `${dateStr} (${localizedReason})`;

    const meta = document.createElement('span');
    meta.style.fontSize = '0.75rem';
    meta.style.color = 'var(--text-muted)';
    meta.textContent = `${snap.size || 0} bytes • ID: ${snap.id}`;

    info.appendChild(title);
    info.appendChild(meta);

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '6px';

    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'btn btn-secondary btn-sm';
    restoreBtn.textContent = t('history.rollbackBtn') || 'Restore Version';
    restoreBtn.title = t('history.rollbackTooltip') || 'Roll back note to this revision';
    restoreBtn.onclick = async () => {
      await restoreSnapshotFromUI(snap.id);
    };

    actions.appendChild(restoreBtn);
    card.appendChild(info);
    card.appendChild(actions);
    container.appendChild(card);
  });
}
window.renderNoteHistoryList = renderNoteHistoryList;

async function restoreSnapshotFromUI(snapshotId) {
  if (!currentNote || !currentNote.path) return;
  const confirmed = await showConfirmDialog(t('confirm.rollbackNote') || 'Roll back note to this revision? An automatic snapshot of your current content will be preserved.', { confirmLabel: t('history.restore') || 'Restore' });
  if (!confirmed) return;

  try {
    const restoredContent = await StorageAPI.restoreSnapshot(currentNote.path, snapshotId);
    const parsed = parseNoteHTML(restoredContent);

    const ta = document.getElementById('edit-textarea');
    if (ta) {
      if (ta.contentEditable === 'true') {
        ta.innerHTML = parsed.body_html || parsed.content || '';
      } else {
        ta.value = parsed.body_html || parsed.content || '';
      }
    }

    currentNote.mainHTML = parsed.body_html || parsed.content || '';
    if (typeof syncPreview === 'function') syncPreview();
    if (typeof scheduleAutoSave === 'function') scheduleAutoSave();

    await renderNoteHistoryList();
    closeModal('modal-note-history');
    toast(t('history.restoredSuccess') || 'Note restored to selected revision!');
  } catch (err) {
    toast(err.message, true);
  }
}
window.restoreSnapshotFromUI = restoreSnapshotFromUI;

async function createManualSnapshotFromUI() {
  if (!currentNote || !currentNote.path) return;
  const ta = document.getElementById('edit-textarea');
  const content = (ta && ta.contentEditable === 'true') ? ta.innerHTML : (currentNote?.mainHTML || ta?.value || '');

  try {
    await StorageAPI.saveSnapshot(currentNote.path, content, 'manual');
    await renderNoteHistoryList();
    toast(t('history.snapshotCreated') || 'Snapshot saved successfully!');
  } catch (err) {
    toast(err.message, true);
  }
}
window.createManualSnapshotFromUI = createManualSnapshotFromUI;

let _activeShareTab = 'slack';

function openNoteShareModal() {
  const defaultTitle = typeof t === 'function' ? (t('common.note') || 'Note') : 'Note';
  const noteTitle = (currentNote && currentNote.title) || document.getElementById('edit-title')?.value || defaultTitle;
  const ta = document.getElementById('edit-textarea');
  const rawHTML = (ta && ta.contentEditable === 'true') ? ta.innerHTML : (currentNote?.mainHTML || ta?.value || '');

  window._currentShareNoteData = {
    title: noteTitle,
    html: rawHTML
  };

  switchShareTab(_activeShareTab || 'slack');
  openModal('modal-note-share');
}
window.openNoteShareModal = openNoteShareModal;

function switchShareTab(tab) {
  _activeShareTab = tab;
  ['slack', 'email', 'markdown'].forEach(tKey => {
    const btn = document.getElementById(`share-tab-${tKey}-btn`);
    if (btn) btn.classList.toggle('active', tKey === tab);
  });

  const textarea = document.getElementById('share-export-text');
  const emailPreview = document.getElementById('share-export-email-preview');
  const defaultTitle = typeof t === 'function' ? (t('common.note') || 'Note') : 'Note';
  const data = window._currentShareNoteData || { title: defaultTitle, html: '' };

  if (tab === 'slack') {
    if (textarea) {
      textarea.style.display = 'block';
      textarea.value = NoteShareFormatter.formatForSlack(data.title, data.html);
    }
    if (emailPreview) emailPreview.style.display = 'none';
  } else if (tab === 'email') {
    const emailHTML = NoteShareFormatter.formatForEmail(data.title, data.html);
    if (textarea) {
      textarea.style.display = 'none';
      textarea.value = emailHTML;
    }
    if (emailPreview) {
      emailPreview.style.display = 'block';
      emailPreview.innerHTML = emailHTML;
    }
  } else if (tab === 'markdown') {
    if (textarea) {
      textarea.style.display = 'block';
      textarea.value = NoteShareFormatter.formatForMarkdown(data.title, data.html);
    }
    if (emailPreview) emailPreview.style.display = 'none';
  }
}
window.switchShareTab = switchShareTab;

async function copyFormattedShareText() {
  const textarea = document.getElementById('share-export-text');
  const hint = document.getElementById('share-copied-hint');
  const text = textarea ? textarea.value : '';

  try {
    if (_activeShareTab === 'email' && navigator.clipboard && typeof ClipboardItem !== 'undefined') {
      const blobHTML = new Blob([text], { type: 'text/html' });
      const blobText = new Blob([textarea.value], { type: 'text/plain' });
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': blobHTML,
          'text/plain': blobText
        })
      ]);
    } else {
      await navigator.clipboard.writeText(text);
    }

    if (hint) {
      hint.style.display = 'inline';
      setTimeout(() => { hint.style.display = 'none'; }, 2500);
    }
    toast(t('share.copiedSuccess') || 'Copied to clipboard!');
  } catch (err) {
    toast(t('common.copyFailed', { message: err.message }), true);
  }
}
window.copyFormattedShareText = copyFormattedShareText;



function insertTextIntoNoteEditor(text) {
  if (!text) return;
  const ta = document.getElementById('edit-textarea');
  if (!ta) return;

  if (ta.contentEditable === 'true') {
    ta.focus();
    document.execCommand('insertHTML', false, `<p>${escH(text)}</p>`);
  } else {
    const start = ta.selectionStart || ta.value.length;
    const end = ta.selectionEnd || ta.value.length;
    const before = ta.value.slice(0, start);
    const after = ta.value.slice(end);
    ta.value = `${before}\n\n${text}\n\n${after}`;
  }

  if (typeof syncPreview === 'function') syncPreview();
  if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
}
window.insertTextIntoNoteEditor = insertTextIntoNoteEditor;

function updateReviewNoteButtonState() {
  const btn = document.getElementById('btn-review-note');
  const overlayValidateBtn = document.getElementById('overlay-validate-note-btn');
  const closeBtn = document.getElementById('overlay-close-note-btn');
  if (!currentNote) return;

  const isDailyReviewActive = typeof DailyReviewController !== 'undefined'
    && DailyReviewController
    && DailyReviewController.currentStep > 0
    && typeof activeTab !== 'undefined'
    && activeTab === 'daily-review';

  const isReviewed = !!currentNote.reviewed;
  const reviewedText = typeof t === 'function' ? (t('dailyreview.reviewedState') || '✓ Note revue') : '✓ Note revue';
  const unreviewedText = typeof t === 'function' ? (t('dailyreview.markReviewed') || '✓ Marquer comme revue') : '✓ Marquer comme revue';
  const tooltipText = typeof t === 'function' ? (t('dailyreview.markReviewedTooltip') || 'Marquer cette note comme revue pour la revue quotidienne') : 'Marquer cette note comme revue pour la revue quotidienne';
  const toastTitle = typeof t === 'function' ? (t('dailyreview.noteValidatedToast') || 'Note marquée comme revue !') : 'Note marquée comme revue !';

  if (btn) {
    btn.style.display = 'none';
  }

  if (overlayValidateBtn) {
    overlayValidateBtn.style.display = isDailyReviewActive ? 'inline-flex' : 'none';
    overlayValidateBtn.classList.toggle('reviewed', isReviewed);
    overlayValidateBtn.title = isReviewed ? toastTitle : tooltipText;
    const cleanLabel = (isReviewed ? reviewedText : unreviewedText).replace(/^✓\s*/, '');
    overlayValidateBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> <span>${escH(cleanLabel)}</span>`;
  }

  if (closeBtn) {
    closeBtn.style.display = isDailyReviewActive ? 'none' : '';
  }
}

async function toggleCurrentNoteReviewed() {
  if (!currentNote || !currentNote.path) return;
  const targetState = !currentNote.reviewed;
  if (window.DailyReviewController && typeof window.DailyReviewController.toggleNoteReviewed === 'function') {
    await window.DailyReviewController.toggleNoteReviewed(currentNote.path, targetState);
  } else {
    currentNote.reviewed = targetState;
    await updateNoteAtPath(currentNote.path, data => {
      data.reviewed = targetState;
      return data;
    });
  }
  updateReviewNoteButtonState();
}
window.updateReviewNoteButtonState = updateReviewNoteButtonState;
window.toggleCurrentNoteReviewed = toggleCurrentNoteReviewed;

// Open the planner block modal (and if series, open to series parent)
function openMainBlockModal(eventId, isSeries) {
  if (!eventId) return;
  if (isSeries && typeof plannerEvents !== 'undefined') {
    const targetEv = plannerEvents.find(e => e.id === eventId);
    if (targetEv?.recurrenceId) {
      const parent = plannerEvents.find(e => e.recurrenceId === targetEv.recurrenceId && e.recurrenceRule) || targetEv;
      if (typeof editPlannerEvent === 'function') {
        editPlannerEvent(parent.id);
        return;
      }
    }
  }
  if (typeof editPlannerEvent === 'function') {
    editPlannerEvent(eventId);
  }
}
window.openMainBlockModal = openMainBlockModal;

/**
 * Formats a matched tag selection group rule for display in the note editor chip tooltip.
 * @param {Object} rule - { group, major, topic }
 * @returns {string} e.g. 'Group: "Engineering", Major: "Frontend", Topic: "UI"'
 */
function formatSelectionGroupForTooltip(rule) {
  if (!rule || typeof rule !== 'object') return '';
  const parts = [];
  const gLabel = (typeof t === 'function' && t('editor.groupLabel')) || 'Group';
  const mLabel = (typeof t === 'function' && t('editor.majorLabel')) || 'Major';
  const tLabel = (typeof t === 'function' && t('editor.topicLabel')) || 'Topic';

  if (rule.group && rule.group !== '*') parts.push(`${gLabel}: "${rule.group}"`);
  if (rule.major && rule.major !== '*') parts.push(`${mLabel}: "${rule.major}"`);
  if (rule.topic && rule.topic !== '*') parts.push(`${tLabel}: "${rule.topic}"`);

  if (parts.length === 0) {
    if (typeof formatTagGroupSummary === 'function') {
      const summary = formatTagGroupSummary(rule);
      if (summary) return summary;
    }
    return (typeof t === 'function' && t('workstream.allMatching')) || 'All matching';
  }
  return parts.join(', ');
}
window.formatSelectionGroupForTooltip = formatSelectionGroupForTooltip;

// Calculate most used selection group across workspace for a workstream
function getMostUsedSelectionGroup(wsName, memory = null) {
  if (!memory && typeof getMajorTopicMemorySync === 'function') {
    memory = getMajorTopicMemorySync(wsName);
  }
  if (!memory && typeof _topicMemoriesIndexCache !== 'undefined' && _topicMemoriesIndexCache?.topics) {
    memory = _topicMemoriesIndexCache.topics.find(t => (t.topicName || t.key || '').toLowerCase() === String(wsName || '').toLowerCase());
  }

  const mapped = memory?.mappedTags || {};
  const tagGroups = Array.isArray(mapped.tagGroups) ? mapped.tagGroups.filter(Boolean) : [];

  if (tagGroups.length === 0) {
    let g = (Array.isArray(mapped.group_tags) && mapped.group_tags.length && mapped.group_tags[0] !== '*') ? mapped.group_tags[0] : '';
    let m = (Array.isArray(mapped.major_topic_tags) && mapped.major_topic_tags.length && mapped.major_topic_tags[0] !== '*') ? mapped.major_topic_tags[0] : wsName;
    let top = (Array.isArray(mapped.topic_tags) && mapped.topic_tags.length && mapped.topic_tags[0] !== '*') ? mapped.topic_tags[0] : '';
    return { group: g, major: m, topic: top };
  }

  if (tagGroups.length === 1) {
    return tagGroups[0];
  }

  const notes = (typeof manifest !== 'undefined' && Array.isArray(manifest)) ? manifest : [];
  const events = (typeof plannerEvents !== 'undefined' && Array.isArray(plannerEvents)) ? plannerEvents : [];
  const todos = (typeof todosManifest !== 'undefined' && Array.isArray(todosManifest)) ? todosManifest : [];
  const items = [...notes, ...events, ...todos];

  let bestGroup = tagGroups[0];
  let bestCount = -1;

  for (let i = 0; i < tagGroups.length; i++) {
    const tg = tagGroups[i];
    let count = 0;
    for (const item of items) {
      if (!item) continue;
      if (typeof matchTagsToSelectionGroup === 'function') {
        if (matchTagsToSelectionGroup(item, tg)) count++;
      } else {
        const itemGroups = (item.group_tags || []).map(x => String(x || '').trim().toLowerCase());
        const itemMajors = (item.major_topic_tags || (item.major_topic ? [item.major_topic] : [])).map(x => String(x || '').trim().toLowerCase());
        const itemTopics = (item.topic_tags || []).map(x => String(x || '').trim().toLowerCase());
        const g = String(tg.group || '').trim().toLowerCase();
        const m = String(tg.major || '').trim().toLowerCase();
        const t = String(tg.topic || '').trim().toLowerCase();
        const matchG = !g || g === '*' || itemGroups.includes(g);
        const matchM = !m || m === '*' || itemMajors.includes(m);
        const matchT = !t || t === '*' || itemTopics.includes(t);
        if (matchG && matchM && matchT) count++;
      }
    }

    if (count > bestCount) {
      bestCount = count;
      bestGroup = tg;
    }
  }

  return bestGroup;
}
window.getMostUsedSelectionGroup = getMostUsedSelectionGroup;

// Check if a tag was assigned from or matches a workstream
function isTagFromWorkstream(tagName, type, containerId = '') {
  if (!tagName) return false;
  const clean = String(tagName).trim().toLowerCase();
  if (type === 'major' && typeof isWorkstreamTag === 'function' && isWorkstreamTag(tagName)) {
    return true;
  }
  let activeDetails = [];
  const isPlanner = containerId && (containerId.startsWith('pe-') || containerId.startsWith('inspector-'));
  if (isPlanner) {
    const liveGroups = (typeof readTagEditor === 'function' && document.getElementById('pe-group-tags')) ? readTagEditor('pe-group-tags') : [];
    const liveMajors = (typeof readTagEditor === 'function' && document.getElementById('pe-major-tags')) ? readTagEditor('pe-major-tags') : [];
    const liveTopics = (typeof readTagEditor === 'function' && document.getElementById('pe-topic-tags')) ? readTagEditor('pe-topic-tags') : [];

    const testGroups = type === 'group' && !liveGroups.includes(tagName) ? [...liveGroups, tagName] : liveGroups;
    const testMajors = type === 'major' && !liveMajors.includes(tagName) ? [...liveMajors, tagName] : liveMajors;
    const testTopics = type === 'topic' && !liveTopics.includes(tagName) ? [...liveTopics, tagName] : liveTopics;

    const activeChipNames = Array.from(document.querySelectorAll('#pe-workstream-chip-selector .active-workstream-chip, #pe-workstream-chip-selector .workstream-chip:not(.workstream-chip-empty)'))
      .map(el => el.textContent?.trim().replace(/✕$/, '').trim())
      .filter(Boolean);

    for (const ws of activeChipNames) {
      const mem = (typeof getMajorTopicMemorySync === 'function')
        ? getMajorTopicMemorySync(ws)
        : (typeof _topicMemoryByTopicName !== 'undefined' ? _topicMemoryByTopicName?.[ws] : null);
      const mapped = mem?.mappedTags || {};
      const tagGroups = Array.isArray(mapped.tagGroups) ? mapped.tagGroups : [];
      for (const tg of tagGroups) {
        if (!tg) continue;
        if (type === 'group' && tg.group && tg.group !== '*' && tg.group.toLowerCase() === clean) return true;
        if (type === 'major' && (tg.major && tg.major !== '*' && tg.major.toLowerCase() === clean || (!tg.major && ws.toLowerCase() === clean))) return true;
        if (type === 'topic' && tg.topic && tg.topic !== '*' && tg.topic.toLowerCase() === clean) return true;
      }
      if (type === 'major' && ws.toLowerCase() === clean) return true;
    }

    if (typeof detectWorkstreamDetailsForNote === 'function') {
      activeDetails = detectWorkstreamDetailsForNote({
        workstreams: activeChipNames,
        group_tags: testGroups,
        major_topic_tags: testMajors,
        topic_tags: testTopics
      }, { group_tags: testGroups, major_topic_tags: testMajors, topic_tags: testTopics });
    }
  } else if (typeof currentNote !== 'undefined' && currentNote) {
    if (typeof detectWorkstreamDetailsForNote === 'function') {
      activeDetails = detectWorkstreamDetailsForNote(currentNote);
    }
  }

  for (const det of activeDetails) {
    const rule = det.matchedRule;
    if (rule) {
      if (type === 'group' && rule.group && rule.group !== '*' && rule.group.toLowerCase() === clean) return true;
      if (type === 'major' && rule.major && rule.major !== '*' && rule.major.toLowerCase() === clean) return true;
      if (type === 'topic' && rule.topic && rule.topic !== '*' && rule.topic.toLowerCase() === clean) return true;
    }
    if (type === 'major' && det.name && det.name.toLowerCase() === clean) return true;
  }
  return false;
}
window.isTagFromWorkstream = isTagFromWorkstream;

// Detect all workstreams associated with this note with match details
function detectWorkstreamDetailsForNote(note = currentNote, liveTags = null) {
  if (!note && !liveTags) return [];

  const explicit = (typeof getNoteWorkstreams === 'function')
    ? getNoteWorkstreams(note)
    : (note?.workstreams || (note?.workstream ? note.workstream.split(',').map(s => s.trim()).filter(Boolean) : []));

  const domGroupTags = (typeof readTagEditor === 'function' && document.getElementById('editor-group'))
    ? readTagEditor('editor-group')
    : [];
  const groupTags = (liveTags && Array.isArray(liveTags.group_tags))
    ? liveTags.group_tags
    : (domGroupTags.length ? domGroupTags : (note?.group_tags || []));

  const domMajorTags = (typeof readTagEditor === 'function' && document.getElementById('editor-major'))
    ? readTagEditor('editor-major')
    : [];
  const majorTags = (liveTags && Array.isArray(liveTags.major_topic_tags))
    ? liveTags.major_topic_tags
    : (domMajorTags.length ? domMajorTags : (note?.major_topic_tags || []));

  const domTopicTags = (typeof readTagEditor === 'function' && document.getElementById('editor-topic'))
    ? readTagEditor('editor-topic')
    : [];
  const topicTags = (liveTags && Array.isArray(liveTags.topic_tags))
    ? liveTags.topic_tags
    : (domTopicTags.length ? domTopicTags : (note?.topic_tags || []));

  const domExtraTags = (typeof readTagEditor === 'function' && document.getElementById('editor-extra'))
    ? readTagEditor('editor-extra')
    : [];
  const extraTags = (liveTags && Array.isArray(liveTags.extra_tags))
    ? liveTags.extra_tags
    : (domExtraTags.length ? domExtraTags : (note?.extra_tags || []));

  const candidateItem = {
    path: note?.path || '',
    id: note?.id || '',
    title: note?.title || '',
    group_tags: groupTags,
    major_topic_tags: majorTags,
    topic_tags: topicTags,
    extra_tags: extraTags,
    workstream: note?.workstream || '',
    workstreams: explicit
  };

  const knownList = (typeof getKnownWorkstreamsList === 'function')
    ? getKnownWorkstreamsList(typeof manifest !== 'undefined' ? manifest : [])
    : [];

  const lowerMajors = majorTags.map(m => String(m || '').trim().toLowerCase()).filter(Boolean);
  const lowerGroups = groupTags.map(g => String(g || '').trim().toLowerCase()).filter(Boolean);
  const lowerTopics = topicTags.map(t => String(t || '').trim().toLowerCase()).filter(Boolean);

  const excludedList = (Array.isArray(note?.excluded_workstreams) ? note.excluded_workstreams : []).map(w => String(w || '').trim().toLowerCase());

  const getMemory = (wsName) => {
    let mem = null;
    if (typeof getMajorTopicMemorySync === 'function') {
      mem = getMajorTopicMemorySync(wsName);
    }
    if (!mem && typeof _topicMemoryByTopicName !== 'undefined' && _topicMemoryByTopicName?.[wsName]) {
      mem = _topicMemoryByTopicName[wsName];
    }
    if (!mem && typeof _topicMemoriesIndexCache !== 'undefined' && _topicMemoriesIndexCache?.topics) {
      mem = _topicMemoriesIndexCache.topics.find(t => (t.topicName || t.key || '').toLowerCase() === wsName.toLowerCase());
    }
    return mem;
  };

  const findMatchingSelectionRule = (wsName, memory) => {
    // 1. Check selection groups using unified matcher if available
    const matcher = (typeof matchTagsToWorkstreamSelectionGroups === 'function' ? matchTagsToWorkstreamSelectionGroups : (typeof globalThis !== 'undefined' && typeof globalThis.matchTagsToWorkstreamSelectionGroups === 'function' ? globalThis.matchTagsToWorkstreamSelectionGroups : (typeof window !== 'undefined' && typeof window.matchTagsToWorkstreamSelectionGroups === 'function' ? window.matchTagsToWorkstreamSelectionGroups : null)));
    if (matcher) {
      const matchRes = matcher(candidateItem, memory || wsName);
      if (matchRes && matchRes.matched && matchRes.matchedGroup) {
        return { rule: { ...matchRes.matchedGroup }, groupIndex: matchRes.matchedGroupIndex };
      }
    }

    const mapped = memory?.mappedTags || {};
    const tagGroups = Array.isArray(mapped.tagGroups) ? mapped.tagGroups : [];
    for (let i = 0; i < tagGroups.length; i++) {
      const tg = tagGroups[i] || {};
      const tgGroup = (tg.group || '').trim().toLowerCase();
      const tgMajor = (tg.major || '').trim().toLowerCase();
      const tgTopic = (tg.topic || '').trim().toLowerCase();

      const groupMatches = !tgGroup || tgGroup === '*' || lowerGroups.includes(tgGroup);
      const majorMatches = !tgMajor || tgMajor === '*' || lowerMajors.includes(tgMajor);
      const topicMatches = !tgTopic || tgTopic === '*' || lowerTopics.includes(tgTopic);

      if (groupMatches && majorMatches && topicMatches) {
        return {
          rule: { group: tg.group || '*', major: tg.major || '*', topic: tg.topic || '*' },
          groupIndex: i
        };
      }
    }

    const mappedMajors = (mapped.major_topic_tags || []).map(t => String(t || '').trim().toLowerCase());
    const mappedGroups = (mapped.group_tags || []).map(t => String(t || '').trim().toLowerCase());
    const mappedTopics = (mapped.topic_tags || []).map(t => String(t || '').trim().toLowerCase());

    if (mappedMajors.length > 0 || mappedGroups.length > 0 || mappedTopics.length > 0) {
      const matchMajors = mappedMajors.includes('*') || mappedMajors.some(m => lowerMajors.includes(m));
      const matchGroups = mappedGroups.includes('*') || mappedGroups.some(g => lowerGroups.includes(g));
      const matchTopics = mappedTopics.includes('*') || mappedTopics.some(t => lowerTopics.includes(t));
      if (matchMajors || matchGroups || matchTopics) {
        return {
          rule: {
            group: matchGroups ? (mapped.group_tags?.[0] || '*') : '',
            major: matchMajors ? (mapped.major_topic_tags?.[0] || '*') : '',
            topic: matchTopics ? (mapped.topic_tags?.[0] || '*') : ''
          },
          groupIndex: 0
        };
      }
    }

    if (lowerMajors.includes(wsName.toLowerCase())) {
      return { rule: { major: wsName }, groupIndex: 0 };
    }

    // Check associatedNotes in memory
    const assocList = Array.isArray(memory?.associatedNotes) ? memory.associatedNotes : [];
    const isManuallyAssoc = assocList.some(an => {
      if (!an) return false;
      const p = typeof an === 'string' ? an : (an.path || an.id);
      return p && (p === candidateItem?.path || p === candidateItem?.id || (candidateItem?.title && (an.title === candidateItem?.title || p === candidateItem?.title)));
    });
    if (isManuallyAssoc) {
      return { rule: { associatedNote: true }, groupIndex: -1 };
    }

    // Fallback match check via doesItemMatchWorkstream
    if (typeof doesItemMatchWorkstream === 'function' && doesItemMatchWorkstream(candidateItem, wsName, memory)) {
      return { rule: { group: '*', major: '*', topic: '*' }, groupIndex: -1 };
    }
    if (typeof window !== 'undefined' && typeof window.doesItemMatchWorkstream === 'function' && window.doesItemMatchWorkstream(candidateItem, wsName, memory)) {
      return { rule: { group: '*', major: '*', topic: '*' }, groupIndex: -1 };
    }

    return null;
  };

  const results = [];
  const processed = new Set();

  // 1. Process all known workstreams
  for (const ws of knownList) {
    const wsLower = ws.toLowerCase();
    if (excludedList.includes(wsLower)) continue;

    const mem = getMemory(ws);
    const matchResult = findMatchingSelectionRule(ws, mem);
    const isExplicit = explicit.some(w => w.toLowerCase() === wsLower);

    if (matchResult) {
      processed.add(wsLower);
      results.push({
        name: ws,
        isSelectionGroupMatch: true,
        matchedRule: matchResult.rule,
        matchedGroupIndex: matchResult.groupIndex !== undefined ? matchResult.groupIndex : -1,
        isManual: false
      });
    } else if (isExplicit) {
      const hasDefinedRules = Array.isArray(mem?.mappedTags?.tagGroups) && mem.mappedTags.tagGroups.length > 0;
      if (!hasDefinedRules) {
        processed.add(wsLower);
        results.push({
          name: ws,
          isSelectionGroupMatch: false,
          matchedRule: null,
          matchedGroupIndex: -1,
          isManual: true
        });
      }
    }
  }

  // 2. Process explicit workstreams not in knownList (e.g. custom assignments)
  for (const ws of explicit) {
    const wsLower = ws.toLowerCase();
    if (processed.has(wsLower) || excludedList.includes(wsLower)) continue;

    const mem = getMemory(ws);
    const matchedRule = findMatchingSelectionRule(ws, mem);
    if (matchedRule) {
      processed.add(wsLower);
      results.push({
        name: ws,
        isSelectionGroupMatch: true,
        matchedRule,
        matchedGroupIndex: matchedRule.matchedGroupIndex !== undefined ? matchedRule.matchedGroupIndex : -1,
        isManual: false
      });
    } else {
      const hasDefinedRules = Array.isArray(mem?.mappedTags?.tagGroups) && mem.mappedTags.tagGroups.length > 0;
      if (!hasDefinedRules) {
        processed.add(wsLower);
        results.push({
          name: ws,
          isSelectionGroupMatch: false,
          matchedRule: null,
          matchedGroupIndex: -1,
          isManual: true
        });
      }
    }
  }

  return results;
}
window.detectWorkstreamDetailsForNote = detectWorkstreamDetailsForNote;
window.detectWorkstreamDetailsForNote = detectWorkstreamDetailsForNote;

// Detect all workstreams associated with this note (names array)
function detectWorkstreamsForNote(note = currentNote, liveTags = null) {
  const details = detectWorkstreamDetailsForNote(note, liveTags);
  return details.map(d => d.name);
}
window.detectWorkstreamsForNote = detectWorkstreamsForNote;

// Populate workstream chip selector in info pane
function populateWorkstreamEditor(note = currentNote) {
  const container = document.getElementById('workstream-chip-selector');
  if (!container) return;

  const workstreamDetails = (typeof detectWorkstreamDetailsForNote === 'function')
    ? detectWorkstreamDetailsForNote(note)
    : (typeof detectWorkstreamsForNote === 'function' ? detectWorkstreamsForNote(note).map(n => ({ name: n, isSelectionGroupMatch: false, isManual: true })) : []);

  const activeWorkstreamNames = workstreamDetails.map(d => d.name);
  if (note) {
    note.workstreams = activeWorkstreamNames;
    note.workstream = activeWorkstreamNames.join(', ');
  }

  container.innerHTML = '';

  const chipWrapper = document.createElement('div');
  chipWrapper.className = 'workstream-chip-wrap';
  chipWrapper.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;position:relative;';

  if (workstreamDetails.length > 0) {
    workstreamDetails.forEach(wsDetail => {
      const ws = wsDetail.name;
      const isAuto = !!wsDetail.isSelectionGroupMatch;
      const chip = document.createElement('span');
      chip.className = `workstream-chip active-workstream-chip ${isAuto ? 'workstream-chip-auto' : 'workstream-chip-manual'}`;

      let tooltipText = '';
      if (isAuto && wsDetail.matchedRule) {
        const ruleSummary = typeof formatSelectionGroupForTooltip === 'function'
          ? formatSelectionGroupForTooltip(wsDetail.matchedRule)
          : (typeof formatTagGroupSummary === 'function' ? formatTagGroupSummary(wsDetail.matchedRule) : '');
        const template = (typeof t === 'function' && t('editor.workstreamMatchedSelectionGroup'))
          || 'Matched by selection group: {group} (change tags to modify)';
        tooltipText = template.replace('{group}', ruleSummary || ws);
      } else if (isAuto) {
        tooltipText = (typeof t === 'function' && t('editor.workstreamDetectedTooltip'))
          || 'Workstream hit by tag selection';
      } else {
        tooltipText = (typeof t === 'function' && t('editor.workstreamManualTooltip'))
          || 'Manually assigned workstream (click ✕ to remove)';
      }

      chip.title = tooltipText;
      chip.innerHTML = `<span>${escH(ws)}</span>`;
      chip.onclick = (e) => {
        e.stopPropagation();
        toggleWorkstreamDropdown(chipWrapper, activeWorkstreamNames);
      };

      // Only manually assigned workstreams can be directly removed via ✕ button
      if (!isAuto) {
        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'workstream-chip-clear-btn';
        clearBtn.title = (typeof t === 'function' && t('editor.clearWorkstreamTooltip')) || `Remove ${ws} from note`;
        clearBtn.innerHTML = '✕';
        clearBtn.onclick = async (e) => {
          e.stopPropagation();
          await removeWorkstreamFromNote(ws);
        };
        chip.appendChild(clearBtn);
      }

      chipWrapper.appendChild(chip);
    });

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'workstream-add-btn';
    addBtn.title = (typeof t === 'function' && t('editor.addWorkstreamTooltip')) || 'Add or select workstreams';
    addBtn.innerHTML = `<span style="font-size:0.85rem;font-weight:700;">+</span> <span style="font-size:0.65rem;opacity:0.6;">▾</span>`;
    addBtn.onclick = (e) => {
      e.stopPropagation();
      toggleWorkstreamDropdown(chipWrapper, activeWorkstreamNames);
    };
    chipWrapper.appendChild(addBtn);
  } else {
    const emptyChip = document.createElement('span');
    emptyChip.className = 'workstream-chip workstream-chip-empty';
    emptyChip.title = (typeof t === 'function' && t('editor.addWorkstreamTooltip')) || 'Assign this note to a workstream';
    emptyChip.innerHTML = `<span>${escH((typeof t === 'function' && t('editor.noWorkstream')) || 'None')}</span> <span style="font-size:0.65rem;opacity:0.6;">▾</span>`;
    emptyChip.onclick = (e) => {
      e.stopPropagation();
      toggleWorkstreamDropdown(chipWrapper, []);
    };
    chipWrapper.appendChild(emptyChip);
  }

  container.appendChild(chipWrapper);
}
window.populateWorkstreamEditor = populateWorkstreamEditor;

function toggleWorkstreamDropdown(wrapper, activeWorkstreams = []) {
  const existing = wrapper.querySelector('.workstream-dropdown-menu');
  if (existing) {
    existing.remove();
    return;
  }
  document.querySelectorAll('.workstream-dropdown-menu').forEach(m => m.remove());

  const menu = document.createElement('div');
  menu.className = 'workstream-dropdown-menu';

  const activeList = Array.isArray(activeWorkstreams)
    ? activeWorkstreams
    : (activeWorkstreams ? [activeWorkstreams] : []);

  const workstreams = (typeof getKnownWorkstreamsList === 'function' ? getKnownWorkstreamsList() : []);

  // None option (clears all workstreams)
  const noneItem = document.createElement('button');
  noneItem.type = 'button';
  const isNone = activeList.length === 0;
  noneItem.className = 'workstream-dropdown-item' + (isNone ? ' active' : '');
  noneItem.title = t('editor.clearWorkstreamTooltip') || 'Remove all workstreams from note';
  noneItem.innerHTML = `<span>${escH(t('editor.noWorkstream') || 'None')}</span>${isNone ? '<span>✓</span>' : ''}`;
  noneItem.onclick = async (e) => {
    e.stopPropagation();
    menu.remove();
    const details = (typeof detectWorkstreamDetailsForNote === 'function')
      ? detectWorkstreamDetailsForNote(currentNote)
      : [];
    const autoMatched = details.filter(d => d.isSelectionGroupMatch);
    if (autoMatched.length > 0 && typeof toast === 'function') {
      toast(t('editor.workstreamAutoMatchedCannotRemoveToast') || 'This workstream is matched by note tags. Change the note tags to remove it.');
    }
    await assignNoteToWorkstream('');
  };
  menu.appendChild(noneItem);

  if (workstreams.length > 0) {
    workstreams.forEach(ws => {
      const item = document.createElement('button');
      item.type = 'button';
      const isActive = activeList.some(w => w.toLowerCase() === ws.toLowerCase());
      item.className = 'workstream-dropdown-item' + (isActive ? ' active' : '');
      item.title = isActive
        ? (t('editor.clearWorkstreamTooltip') || `Remove ${ws}`)
        : (t('editor.addWorkstreamTooltip') || `Add ${ws}`);
      item.innerHTML = `<span>${escH(ws)}</span>${isActive ? '<span>✓</span>' : ''}`;
      item.onclick = async (e) => {
        e.stopPropagation();
        menu.remove();
        if (isActive) {
          const details = (typeof detectWorkstreamDetailsForNote === 'function')
            ? detectWorkstreamDetailsForNote(currentNote)
            : [];
          const currentDetail = details.find(d => d.name.toLowerCase() === ws.toLowerCase());
          if (currentDetail?.isSelectionGroupMatch) {
            if (typeof toast === 'function') {
              toast(t('editor.workstreamAutoMatchedCannotRemoveToast') || 'This workstream is matched by note tags. Change the note tags to remove it.');
            }
          } else {
            await removeWorkstreamFromNote(ws);
          }
        } else {
          await assignNoteToWorkstream(ws);
        }
      };
      menu.appendChild(item);
    });
  } else {
    const emptyNotice = document.createElement('div');
    emptyNotice.className = 'workstream-dropdown-empty';
    emptyNotice.style.cssText = 'padding:6px 10px;font-size:0.8rem;color:var(--text-muted);font-style:italic;';
    emptyNotice.textContent = t('editor.noKnownWorkstreams') || 'No workstreams defined yet';
    menu.appendChild(emptyNotice);
  }

  // Divider + Create New Workstream action
  const divider = document.createElement('div');
  divider.className = 'workstream-dropdown-divider';
  menu.appendChild(divider);

  const createItem = document.createElement('button');
  createItem.type = 'button';
  createItem.className = 'workstream-dropdown-item workstream-dropdown-create-btn';
  createItem.title = t('workstream.createTooltip') || 'Create new workstream memory dossier';
  createItem.innerHTML = `<span>+ ${escH(t('editor.createWorkstreamAction') || 'Create new workstream...')}</span>`;
  createItem.onclick = (e) => {
    e.stopPropagation();
    menu.remove();
    if (typeof openCreateWorkstreamModal === 'function') {
      openCreateWorkstreamModal();
    }
  };
  menu.appendChild(createItem);

  wrapper.appendChild(menu);

  const closeHandler = (e) => {
    if (!wrapper.contains(e.target)) {
      menu.remove();
      document.removeEventListener('click', closeHandler);
    }
  };
  setTimeout(() => document.addEventListener('click', closeHandler), 10);
}

// Remove workstream from note
async function removeWorkstreamFromNote(wsName) {
  if (!currentNote) return;
  const cleanTarget = String(wsName || '').trim().toLowerCase();
  const currentList = (typeof getNoteWorkstreams === 'function')
    ? getNoteWorkstreams(currentNote)
    : (currentNote.workstreams || (currentNote.workstream ? currentNote.workstream.split(',').map(s => s.trim()).filter(Boolean) : []));

  const updated = currentList.filter(w => w.toLowerCase() !== cleanTarget);
  currentNote.workstreams = updated;
  currentNote.workstream = updated.join(', ');

  if (!Array.isArray(currentNote.excluded_workstreams)) {
    currentNote.excluded_workstreams = [];
  }
  if (!currentNote.excluded_workstreams.some(w => w.toLowerCase() === cleanTarget)) {
    currentNote.excluded_workstreams.push(wsName);
  }

  // If major tags contained this workstream name, also remove from editor-major
  const domMajors = (typeof readTagEditor === 'function' && document.getElementById('editor-major'))
    ? readTagEditor('editor-major')
    : [];
  const majors = domMajors.length ? domMajors : (currentNote.major_topic_tags || []);
  const newMajors = majors.filter(m => m.toLowerCase() !== cleanTarget);
  if (Array.isArray(currentNote.major_topic_tags)) {
    currentNote.major_topic_tags = currentNote.major_topic_tags.filter(m => m.toLowerCase() !== cleanTarget);
  }
  if (typeof populateTagEditor === 'function' && document.getElementById('editor-major')) {
    populateTagEditor('editor-major', newMajors, 'major');
  }

  populateWorkstreamEditor(currentNote);
  _updateMetaTitlePreview();

  if (typeof scheduleAutoSave === 'function') {
    scheduleAutoSave();
  } else if (typeof scheduleAutosave === 'function') {
    scheduleAutosave();
  } else if (typeof saveCurrentNote === 'function') {
    saveCurrentNote(false, false);
  }
}
window.removeWorkstreamFromNote = removeWorkstreamFromNote;

// Assign note to workstream directly and fill tags from favored selection group
async function assignNoteToWorkstream(wsName) {
  if (!currentNote) return;

  if (!wsName) {
    currentNote.workstream = '';
    currentNote.workstreams = [];
    currentNote.excluded_workstreams = [];
  } else {
    const list = (typeof getNoteWorkstreams === 'function')
      ? getNoteWorkstreams(currentNote)
      : (currentNote.workstreams || (currentNote.workstream ? currentNote.workstream.split(',').map(s => s.trim()).filter(Boolean) : []));
    if (!list.some(w => w.toLowerCase() === wsName.toLowerCase())) {
      list.push(wsName);
    }
    currentNote.workstreams = list;
    currentNote.workstream = list.join(', ');

    if (Array.isArray(currentNote.excluded_workstreams)) {
      currentNote.excluded_workstreams = currentNote.excluded_workstreams.filter(w => w.toLowerCase() !== wsName.toLowerCase());
    }

    let memory = null;
    if (typeof WorkstreamMemoryEngine !== 'undefined' && typeof WorkstreamMemoryEngine.getMajorTopicMemory === 'function') {
      try {
        memory = await WorkstreamMemoryEngine.getMajorTopicMemory(wsName);
      } catch (e) {
        console.warn('Failed to load workstream memory for note assignment', e);
      }
    }

    const favGroup = (typeof getMostUsedSelectionGroup === 'function')
      ? getMostUsedSelectionGroup(wsName, memory)
      : (memory?.mappedTags?.tagGroups?.[0] || {});

    let tgGroup = (favGroup.group && favGroup.group !== '*') ? favGroup.group : '';
    let tgMajor = (favGroup.major && favGroup.major !== '*') ? favGroup.major : '';
    let tgTopic = (favGroup.topic && favGroup.topic !== '*') ? favGroup.topic : '';

    if (!tgMajor) {
      tgMajor = wsName;
    }

    if (tgGroup && typeof populateTagEditor === 'function') {
      populateTagEditor('editor-group', [tgGroup], 'group');
      currentNote.group_tags = [tgGroup];
    }
    if (tgMajor && typeof populateTagEditor === 'function') {
      populateTagEditor('editor-major', [tgMajor], 'major');
      currentNote.major_topic_tags = [tgMajor];
    }
    if (tgTopic && typeof populateTagEditor === 'function') {
      populateTagEditor('editor-topic', [tgTopic], 'topic');
      currentNote.topic_tags = [tgTopic];
    }
  }

  populateWorkstreamEditor(currentNote);
  _updateMetaTitlePreview();

  if (typeof scheduleAutoSave === 'function') {
    scheduleAutoSave();
  } else if (typeof scheduleAutosave === 'function') {
    scheduleAutosave();
  } else if (typeof saveCurrentNote === 'function') {
    saveCurrentNote(false, false);
  }
}
window.assignNoteToWorkstream = assignNoteToWorkstream;

// Show planner blocks linked to this note inside the overlay (Main block on right of Date, Associated blocks below)
function _renderPlannerBlocksForNote(noteId) {
  const bar = document.getElementById('overlay-planner-blocks');
  const row = document.getElementById('overlay-planner-blocks-row');
  const mainBlockContainer = document.getElementById('editor-main-block-container');

  const resolvedNoteId = noteId
    || ((currentNote?.path && typeof getMetaByPath === 'function') ? (getMetaByPath(currentNote.path)?.id || '') : '');
  const plannerReady = typeof plannerLoadState !== 'undefined' ? plannerLoadState === 'ready' : true;

  const linked = (plannerReady && resolvedNoteId && typeof getPlannerEventsForNote === 'function')
    ? getPlannerEventsForNote(resolvedNoteId)
    : [];

  // Separate main block (primary note) from associated blocks
  let mainBlock = null;
  const associatedEvents = [];

  linked.forEach(ev => {
    if (!ev) return;
    const isPrimary = String(ev.noteId || '').trim() === String(resolvedNoteId || '').trim();
    if (isPrimary && !mainBlock) {
      mainBlock = ev;
    } else if (isPrimary && ev.type !== 'prep' && mainBlock.type === 'prep') {
      mainBlock = ev;
    } else {
      associatedEvents.push(ev);
    }
  });

  // Render Main Block (in Row 2 right of Date)
  if (mainBlockContainer) {
    if (!plannerReady) {
      mainBlockContainer.innerHTML = `<span class="opb-loading">${escH(t('editor.loadingPlannedBlocks'))}<span class="opb-loading-dots" aria-hidden="true"></span></span>`;
    } else if (mainBlock) {
      const isSeries = !!mainBlock.recurrenceId;
      const seriesBadge = isSeries
        ? `<span class="main-block-series-badge">${escH(t('editor.seriesBadge') || 'Series')}</span>`
        : '';
      const blockTitle = (mainBlock.title || '').trim() ? ` ${escH(mainBlock.title)}` : '';
      mainBlockContainer.innerHTML = `
        <span class="main-block-chip" onclick="openMainBlockModal('${escA(mainBlock.id)}', ${isSeries})" title="${escA(t('editor.editPlannedBlockTooltip') || 'Edit planned block')}">
          <span>${escH(mainBlock.startTime || '')}–${escH(mainBlock.endTime || '')}${blockTitle}</span>
          ${seriesBadge}
        </span>
      `;
    } else {
      mainBlockContainer.innerHTML = `<span class="main-block-none">${escH(t('editor.noMainBlock') || 'No main block')}</span>`;
    }
  }

  // Render Associated Blocks (in Row 6 below)
  if (bar && row) {
    const displayAssociated = plannerReady ? _buildPlannerBlockDisplayItems(associatedEvents, currentNote?.date || '') : [];
    if (!plannerReady) {
      bar.innerHTML = `<div class="opb-chips"><span class="opb-loading">${escH(t('editor.loadingPlannedBlocks'))}<span class="opb-loading-dots" aria-hidden="true"></span></span></div>`;
      row.style.display = 'flex';
    } else if (displayAssociated.length > 0) {
      const chipsHTML = displayAssociated.map(item => {
        const ev = item.primary;
        const isSeries = !!ev.recurrenceId || item.kind === 'series';
        const seriesBadge = isSeries
          ? `<em class="opb-series-badge">${escH(t('planner.seriesInstanceLabel') || 'Instance of series')}</em>`
          : '';
        const seriesTitle = isSeries
          ? ` title="${escA(t('planner.seriesInstanceTooltip') || 'This block is one instance in a recurring series')}"`
          : '';
        const seriesSuffix = isSeries ? ` (${escH(t('planner.seriesInstanceShort') || 'series instance')})` : '';
        return `
        <span class="opb-chip opb-chip-${ev.type}${isSeries ? ' opb-chip-series' : ''}"${seriesTitle}>
          ${escH(ev.date)} ${ev.startTime}–${ev.endTime}${seriesSuffix}
          ${ev.type === 'prep' ? '<em class="opb-chip-note"> (prep)</em>' : ''}${seriesBadge}
          <button class="opb-chip-btn" onclick="event.stopPropagation(); editPlannerEvent('${ev.id}')" title="${escA(t('editor.editPlannedBlockTooltip'))}">✏️</button>
          <button class="opb-chip-btn" onclick="switchTab('planner')" title="${escA(t('editor.jumpToPlannerTooltip'))}">↗️</button>
          <button class="opb-chip-btn unlink" onclick="event.stopPropagation(); unlinkPlannerBlockFromNote('${ev.id}')" title="${escA(t('editor.unlinkBlockTooltip'))}">✕</button>
        </span>
      `;
      }).join('');
      bar.innerHTML = `
        <div class="opb-chips" style="display:flex; flex-wrap:wrap; gap:0.4rem; align-items:center;">
          ${chipsHTML}
        </div>
        <button class="opb-add-btn" onclick="event.stopPropagation(); scheduleBlockForCurrentNote()" title="${escA(t('editor.scheduleBlockTooltip'))}">${escH(t('editor.scheduleBlockLabel'))}</button>
      `;
      row.style.display = 'flex';
    } else {
      // Hide associated blocks row if there are none
      bar.innerHTML = '';
      row.style.display = 'none';
    }
  }

  // Update metadata preview
  _updateMetaTitlePreview();
}

function _renderInspectorBlocAssociatedNotesSection(container) {
  if (!container || !currentNote?.id) return;

  const section = document.createElement('div');
  section.className = 'inspector-bloc-assoc-section';

  const title = document.createElement('div');
  title.className = 'overlay-backlinks-label inspector-bloc-assoc-title';
  title.textContent = t('editor.inspectorBlocAssociationsTitle') || 'Bloc Associated Notes';
  section.appendChild(title);

  if (!Array.isArray(plannerEvents) || (typeof plannerLoadState !== 'undefined' && plannerLoadState !== 'ready')) {
    const loading = document.createElement('p');
    loading.className = 'inspector-bloc-assoc-loading';
    loading.textContent = t('editor.loadingPlannedBlocks') || 'Loading planned blocks...';
    section.appendChild(loading);
    container.appendChild(section);
    return;
  }

  const primaryEvents = plannerEvents
    .filter(ev => ev && String(ev.noteId || '').trim() === String(currentNote.id || '').trim())
    .sort((a, b) => {
      const d = String(a.date || '').localeCompare(String(b.date || ''));
      if (d !== 0) return d;
      return String(a.startTime || '').localeCompare(String(b.startTime || ''));
    });

  if (!primaryEvents.length) {
    const empty = document.createElement('p');
    empty.className = 'inspector-bloc-assoc-empty';
    empty.textContent = t('editor.inspectorBlocAssociationsNone') || 'This note is not a primary bloc note in planner.';
    section.appendChild(empty);
    container.appendChild(section);
    return;
  }

  primaryEvents.forEach(ev => {
    const row = document.createElement('div');
    row.className = 'inspector-bloc-assoc-card';

    const header = document.createElement('div');
    header.className = 'inspector-bloc-assoc-header';
    const headerLeft = document.createElement('span');
    headerLeft.className = 'inspector-bloc-assoc-meta';
    const typeLabel = t(`planner.${String(ev.type || '').toLowerCase()}`) || String(ev.type || 'bloc');
    headerLeft.textContent = `${ev.date || ''} ${ev.startTime || ''}-${ev.endTime || ''} · ${typeLabel}`;
    header.appendChild(headerLeft);
    row.appendChild(header);

    const assocIds = (typeof getPlannerEventLinkedNoteIds === 'function')
      ? getPlannerEventLinkedNoteIds(ev, { includePrimary: false }).filter(id => String(id || '').trim() !== String(currentNote.id || '').trim())
      : [];

    if (assocIds.length > 0) {
      const list = document.createElement('div');
      list.className = 'inspector-bloc-assoc-list';
      assocIds.forEach(assocId => {
        const noteMeta = manifest.find(n => String(n?.id || '').trim() === String(assocId || '').trim());
        const chip = document.createElement('div');
        chip.className = 'inspector-bloc-assoc-chip';

        const openBtn = document.createElement('button');
        openBtn.className = 'btn inspector-bloc-assoc-open';
        openBtn.textContent = noteMeta?.title || assocId;
        openBtn.title = t('editor.inspectorOpenAssociatedNoteTooltip') || 'Open associated note';
        openBtn.addEventListener('click', () => {
          if (noteMeta?.path) openNestedNote(noteMeta.path);
        });

        const removeBtn = document.createElement('button');
        removeBtn.className = 'btn inspector-bloc-assoc-remove';
        removeBtn.textContent = '✕';
        removeBtn.title = t('editor.inspectorRemoveAssociationTooltip') || 'Remove association';
        removeBtn.addEventListener('click', async (evt) => {
          evt.preventDefault();
          if (typeof setPlannerEventAssociatedNote !== 'function') return;
          await setPlannerEventAssociatedNote(ev.id, assocId, false);
          if (typeof _renderPlannerBlocksForNote === 'function') _renderPlannerBlocksForNote(currentNote.id);
          await renderInspectorPanel();
        });

        chip.appendChild(openBtn);
        chip.appendChild(removeBtn);
        list.appendChild(chip);
      });
      row.appendChild(list);
    }

    const addBtn = document.createElement('button');
    addBtn.className = 'btn inspector-bloc-assoc-add-btn';
    addBtn.style.width = '100%';
    addBtn.style.marginTop = '0.5rem';
    addBtn.textContent = t('editor.inspectorAssociateNote') || '+ Associate note';
    addBtn.title = t('editor.inspectorAddAssociationTooltip') || 'Associate another note with this bloc';
    addBtn.addEventListener('click', (evt) => {
      evt.preventDefault();
      const currentAssociated = (typeof getPlannerEventLinkedNoteIds === 'function')
        ? getPlannerEventLinkedNoteIds(ev, { includePrimary: false })
        : [];
      openLinkNotePicker(addBtn, {
        activeNoteId: currentNote.id,
        excludeNoteIds: [currentNote.id, ...currentAssociated],
        placeholder: t('editor.inspectorAssocPickerPlaceholder') || 'Search note to associate...',
        emptyText: t('editor.inspectorAssocPickerEmpty') || 'No note available to associate.',
        onSelect: async (noteMeta) => {
          if (typeof setPlannerEventAssociatedNote !== 'function') return;
          await setPlannerEventAssociatedNote(ev.id, noteMeta.id, true);
          if (typeof _renderPlannerBlocksForNote === 'function') _renderPlannerBlocksForNote(currentNote.id);
          await renderInspectorPanel();
        }
      });
    });
    row.appendChild(addBtn);

    section.appendChild(row);
  });

  container.appendChild(section);
}

async function unlinkPlannerBlockFromNote(eventId) {
  if (typeof plannerEvents === 'undefined') return;
  const evObj = plannerEvents.find(e => e.id === eventId);
  if (evObj) {
    const currentNoteId = currentNote?.id || '';
    if (!currentNoteId || String(evObj.noteId || '').trim() === String(currentNoteId).trim()) {
      evObj.noteId = '';
    }
    if (Array.isArray(evObj.linkedNoteIds) && currentNoteId) {
      evObj.linkedNoteIds = evObj.linkedNoteIds.filter(id => String(id || '').trim() !== String(currentNoteId).trim());
    }
    if (evObj.type === 'call' || evObj.type === 'sync') {
      plannerEvents.forEach(pe => {
        if (pe.type === 'prep' && pe.prepForEventId === evObj.id) {
          if (!currentNoteId || String(pe.noteId || '').trim() === String(currentNoteId).trim()) {
            pe.noteId = '';
          }
          if (Array.isArray(pe.linkedNoteIds) && currentNoteId) {
            pe.linkedNoteIds = pe.linkedNoteIds.filter(id => String(id || '').trim() !== String(currentNoteId).trim());
          }
        }
      });
    }
    if (typeof savePlanner === 'function') await savePlanner();
    if (currentNote) {
      _renderPlannerBlocksForNote(currentNote.id);
    }
    if (typeof renderPlanner === 'function') renderPlanner();
    if (typeof renderBoard === 'function') renderBoard();
    toast(t('editor.blockUnlinked'));
  }
}

async function scheduleBlockForCurrentNote() {
  if (!currentNote) return;
  const noteId = currentNote.id;
  const noteTitle = currentNote.title;
  // Open planner modal directly
  if (typeof openPlanEventModal === 'function') {
    openPlanEventModal({
      noteId: noteId,
      title: noteTitle
    });
  }
}

function setOverlayViewMode(isView) {
  const panel = document.querySelector('.overlay-panel');
  if (!panel) return;
  
  const textarea = document.getElementById('edit-textarea');
  const summaryArea = document.getElementById('edit-summary');
  const toolbar = document.querySelector('.edit-toolbar');

  if (isView) {
    panel.classList.add('overlay-view-mode');
    if (textarea) textarea.contentEditable = 'false';
    if (summaryArea) summaryArea.contentEditable = 'false';
    if (toolbar) toolbar.style.display = 'none';
    if (typeof renderLatexInElement === 'function') {
      if (textarea) renderLatexInElement(textarea);
      if (summaryArea) renderLatexInElement(summaryArea);
    }
  } else {
    panel.classList.remove('overlay-view-mode');
    if (textarea) textarea.contentEditable = 'true';
    if (summaryArea) summaryArea.contentEditable = 'true';
    if (toolbar) toolbar.style.display = '';
    if (typeof renderLatexInElement === 'function') {
      if (textarea) renderLatexInElement(textarea);
      if (summaryArea) renderLatexInElement(summaryArea);
    }
  }
  
  const editBtn   = document.getElementById('overlay-edit-btn');
  const viewHdr   = document.getElementById('overlay-view-header');
  const saveInd   = document.getElementById('overlay-save-indicator');
  if (editBtn)  editBtn.style.display  = isView ? '' : 'none';
  if (saveInd)  saveInd.style.display  = isView ? 'none' : '';
  if (viewHdr)  viewHdr.style.display  = isView ? '' : 'none';
  
  const deleteNoteBtn = document.getElementById('overlay-delete-note-btn');
  if (deleteNoteBtn) deleteNoteBtn.style.display = (currentNote?.path) ? '' : 'none';
  const newWinBtn = document.getElementById('overlay-newwindow-btn');
  if (newWinBtn) newWinBtn.style.display = (currentNote?.id && !_isFocusedMode) ? '' : 'none';
  if (typeof updateLLMToolbarVisibility === 'function') updateLLMToolbarVisibility();

  // Apply metadata collapse/view state
  _applyMetadataCollapseState();
}

function enterOverlayEditMode() {
  setOverlayViewMode(false);
  metadataCollapsed = false;
  _applyMetadataCollapseState();

  const titleInput = document.getElementById('edit-title');
  const textarea = document.getElementById('edit-textarea');

  const hasNoTitle = !currentNote || !currentNote.title || currentNote.title === t('common.untitledNote') || currentNote.title.trim() === '';
  if (hasNoTitle) {
    if (titleInput) titleInput.focus();
  } else {
    if (textarea) textarea.focus();
  }
}

async function openNoteOverlayInEditMode(path) {
  await openNoteOverlay(path);
  setOverlayViewMode(false);
}

// ═══ Todo Link Picker ═══
let _linkTodoPicker = null;
let _savedTodoRange = null;
let _savedTodoText = '';

function showLinkTodoPicker(event) {
  if (_linkTodoPicker) { closeLinkTodoPicker(); return; } // second click toggles closed
  
  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0) {
    _savedTodoRange = selection.getRangeAt(0).cloneRange();
    _savedTodoText = _savedTodoRange.toString().trim();
  } else {
    _savedTodoRange = null;
    _savedTodoText = '';
  }

  const btn = (event && (event.currentTarget || event.target)) || document.getElementById('todo-link-btn') || document.body;
  const rect = (btn && typeof btn.getBoundingClientRect === 'function')
    ? btn.getBoundingClientRect()
    : { bottom: 60, left: 100 };

  const picker = document.createElement('div');
  picker.className = 'todo-link-picker';
  picker.style.top  = (rect.bottom + 4) + 'px';
  picker.style.left = rect.left + 'px';

  const filterDiv = document.createElement('div');
  filterDiv.className = 'todo-link-picker-filter';
  const inp = document.createElement('input');
  inp.type = 'search';
  inp.placeholder = t('common.searchTodosPlaceholder');
  inp.title = t('common.filterTodoList');

  // Include done toggle
  const includeWrap = document.createElement('label');
  includeWrap.className = 'todo-link-picker-include';
  includeWrap.style.display = 'inline-flex';
  includeWrap.style.alignItems = 'center';
  includeWrap.style.gap = '6px';
  const chk = document.createElement('input');
  chk.type = 'checkbox';
  chk.id = 'todo-link-include-done';
  const chkLabel = document.createElement('span');
  chkLabel.textContent = t('todo.includeDone');
  includeWrap.appendChild(chk);
  includeWrap.appendChild(chkLabel);
  chk.addEventListener('change', () => render(inp.value.trim()));

  filterDiv.appendChild(inp);
  filterDiv.appendChild(includeWrap);
  picker.appendChild(filterDiv);

  const list = document.createElement('div');
  list.className = 'todo-link-picker-list';
  picker.appendChild(list);

  function render(filter) {
    list.innerHTML = '';
    const fl = (filter || '').toLowerCase();
    const prioOrder = { High: 0, Medium: 1, Low: 2 };
    const includeDone = !!document.getElementById('todo-link-include-done')?.checked;
    const todos = (todosManifest || [])
      .filter(t => includeDone || t.priority !== 'Done')
      .filter(t => !fl || (t.title || '').toLowerCase().includes(fl))
      .sort((a, b) => {
        const aWip = isTodoWip(a) ? 0 : 1;
        const bWip = isTodoWip(b) ? 0 : 1;
        if (aWip !== bWip) return aWip - bWip;
        return (prioOrder[a.priority] ?? 99) - (prioOrder[b.priority] ?? 99);
      });

    if (!todos.length) {
      const em = document.createElement('div');
      em.className = 'todo-link-picker-empty';
      em.textContent = fl ? t('common.noMatchingTodos') : t('common.noActiveTodosYet');
      list.appendChild(em);
      return;
    }
    todos.forEach(todo => {
      const item = document.createElement('div');
      item.className = 'todo-link-picker-item';
      item.title = t('common.clickToLinkTodo', { title: todo.title || t('common.untitled') });
      const priority = getTodoEffectivePriority(todo);
      const hasWip = isTodoWip(todo);
      const q = typeof getTodoQuadrant === 'function' ? getTodoQuadrant(todo) : priority;
      const badge = document.createElement('span');
      badge.className = `note-todo-badge p-${(hasWip ? 'wip' : priority || 'medium').toLowerCase()}`;
      badge.textContent = hasWip ? t('todo.wip') : q;
      const text = document.createElement('span');
      text.className = 'todo-link-picker-item-text';
      text.textContent = (todo.title || t('common.untitled')).slice(0, 90);
      item.appendChild(badge);
      item.appendChild(text);
      item.addEventListener('mousedown', e => {
        e.preventDefault();
        insertLinkedTodo(todo);
        closeLinkTodoPicker();
      });
      list.appendChild(item);
    });
  }

  render('');
  inp.addEventListener('input', () => render(inp.value.trim()));

  document.body.appendChild(picker);
  _linkTodoPicker = picker;
  requestAnimationFrame(() => inp.focus());
  setTimeout(() => document.addEventListener('click', _dismissLinkPicker), 0);
  document.addEventListener('keydown', _escLinkPicker);
}

function _dismissLinkPicker(e) {
  if (_linkTodoPicker && !_linkTodoPicker.contains(e.target)) closeLinkTodoPicker();
}
function _escLinkPicker(e) {
  if (e.key === 'Escape') closeLinkTodoPicker();
}
function closeLinkTodoPicker() {
  if (_linkTodoPicker) { _linkTodoPicker.remove(); _linkTodoPicker = null; }
  document.removeEventListener('click', _dismissLinkPicker);
  document.removeEventListener('keydown', _escLinkPicker);
}

async function insertLinkedTodo(todo) {
  const ta = document.getElementById('edit-textarea');
  if (!ta) return;
  ta.focus();
  const priority = getTodoEffectivePriority(todo);
  const status = todo.status || '';
  const isRich = ta.contentEditable === 'true';

  if (isRich) {
    let range = _savedTodoRange;
    const selection = window.getSelection();
    if (!range && selection && selection.rangeCount > 0) {
      const activeRange = selection.getRangeAt(0);
      if (ta.contains(activeRange.commonAncestorContainer)) {
        range = activeRange;
      }
    }
    if (!range) {
      range = document.createRange();
      range.selectNodeContents(ta);
      range.collapse(false);
    }
    if (range) {
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }

      const span = document.createElement('span');
      span.className = 'note-todo';
      span.dataset.todoId = todo.id;
      span.dataset.todoPriority = priority;
      if (status) span.dataset.todoStatus = status;
      span.setAttribute('contenteditable', 'false');

      const textSpan = document.createElement('span');
      textSpan.className = 'note-todo-text';
      textSpan.setAttribute('contenteditable', 'true');
      textSpan.textContent = _savedTodoText || todo.title || 'Todo';

      span.appendChild(textSpan);

      range.deleteContents();
      range.insertNode(span);
      
      _savedTodoRange = null;
      _savedTodoText = '';
      
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
  } else {
    const todoSyntax = `{todo:${priority}:${todo.id}${status ? `:${status}` : ''}|${_savedTodoText || todo.title || 'Todo'}}`;
    insertAtCursor(ta, todoSyntax);
    _savedTodoRange = null;
    _savedTodoText = '';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Ensure the matching TODO tag is in extra_tags
  const desiredTag = todoTagText(status === 'WIP' ? 'WIP' : priority);
  if (desiredTag) {
    const el = document.getElementById('editor-extra');
    if (el && !readTagEditor('editor-extra').includes(desiredTag)) {
      const css = 'extra-tag ' + (status === 'WIP' ? 'todo-wip' : priority === 'High' ? 'todo-high' : priority === 'Medium' ? 'todo-med' : 'todo-low');
      addTagPill(el, desiredTag, 'extra', css);
      updateTodoButtonsState();
    }
  }

  if (currentNote?.id && todo && !todo.noteId) {
    todo.noteId = currentNote.id;
    if (typeof saveTodosManifest === 'function') {
      try { await saveTodosManifest(); } catch (e) {}
    }
  }

  if (typeof renderInspectorPanel === 'function') {
    renderInspectorPanel().catch(() => {});
  }

  if (currentNote?.id && typeof syncPlannerAssociationsFromNote === 'function') {
    try {
      await syncPlannerAssociationsFromNote(currentNote.id, { addedTodoId: todo.id });
      if (typeof _renderPlannerBlocksForNote === 'function') _renderPlannerBlocksForNote(currentNote.id);
    } catch (e) {
      console.warn('Could not sync planner todo association from note link', e);
    }
  }
}

async function openNoteInNewWindow() {
  if (!currentNote) return;

  const wasEditing = !document.querySelector('.overlay-panel')?.classList.contains('overlay-view-mode');
  if (wasEditing || !currentNote.path) {
    const saveOk = await autoSaveNote({ silent: true, isFinal: true });
    if (!saveOk) {
      toast(t('common.saveFailed', { message: 'Please resolve save errors before opening in a new window.' }), true);
      return;
    }
    // Auto-create any missing todos that were embedded as markers in the note
    try { await createMissingTodosForCurrentNote(); } catch (e) { console.warn('Auto-create todos failed', e); }
  }

  const noteIdToOpen = currentNote.id;
  const notePathToOpen = currentNote.path;

  if (window.AppBridge?.noteWindow && (noteIdToOpen || notePathToOpen)) {
    window.AppBridge.noteWindow.open(noteIdToOpen, notePathToOpen);
  }
  overlayStack = []; // Clear overlay stack so popping out closes cleanly in main window without restoring older stack notes
  if (typeof closeNoteOverlay === 'function') {
    await closeNoteOverlay({ skipSave: true, forceCloseAll: true });
  }
}

async function reloadNoteFromDisk() {
  if (!currentNote?.path) return;
  try {
    const html = await StorageAPI.readNoteContent(currentNote.path);
    const parsed = parseNoteHTML(html);
    currentNote = { ...currentNote, originalHTML: html, ...parsed };
    const editTitleEl = document.getElementById('edit-title');
    if (editTitleEl) editTitleEl.value = currentNote.title || '';
    const editDateEl = document.getElementById('edit-date');
    if (editDateEl) editDateEl.value = currentNote.date || '';
    const summaryEl = document.getElementById('edit-summary');
    if (summaryEl) {
      summaryEl.innerHTML = await resolveNoteImages(currentNote.summary || '<p><br></p>');
      if (typeof renderLatexInElement === 'function') renderLatexInElement(summaryEl);
    }
    
    const ta = document.getElementById('edit-textarea');
    if (ta) {
      let cleanHTML = parsed.mainHTML || '<p><br></p>';
      if (typeof window.cleanHtmlBeforeSave === 'function') {
        cleanHTML = window.cleanHtmlBeforeSave(cleanHTML);
      }
      cleanHTML = await resolveNoteImages(cleanHTML);
      ta.innerHTML = cleanHTML;
      if (typeof renderLatexInElement === 'function') renderLatexInElement(ta);
    }
    if (typeof populateTagEditor === 'function') {
      populateTagEditor('editor-group', currentNote.group_tags, 'group');
      populateTagEditor('editor-major', currentNote.major_topic_tags, 'major');
      populateTagEditor('editor-topic', currentNote.topic_tags, 'topic');
      populateTagEditor('editor-extra', currentNote.extra_tags, 'extra');
    }
    if (typeof populateWorkstreamEditor === 'function') populateWorkstreamEditor(currentNote);
    syncPreview();
    updateNoteWindowTitle(currentNote);
    if (typeof renderInspectorPanel === 'function') renderInspectorPanel().catch(() => {});
    if (typeof syncImageStrip === 'function') syncImageStrip();
    if (typeof _renderPlannerBlocksForNote === 'function' && currentNote?.id) {
      _renderPlannerBlocksForNote(currentNote.id);
    }
    dismissReloadBanner();
    toast(t('common.noteReloaded'));
  } catch(e) { toast(t('common.reloadFailed', { message: e.message }), true); }
}

function dismissReloadBanner() {
  const banner = document.getElementById('overlay-reload-banner');
  if (banner) banner.classList.remove('visible');
}

let _noteCloseInProgress = false;

function showNoteCloseProgressDialog(message) {
  const existing = document.getElementById('note-close-progress-overlay');
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

  const overlay = document.createElement('div');
  overlay.id = 'note-close-progress-overlay';
  overlay.className = 'dialog-overlay planner-progress-overlay';
  overlay.style.zIndex = '100010';

  const box = document.createElement('div');
  box.className = 'dialog-box planner-progress-dialog';

  const title = document.createElement('div');
  title.className = 'planner-progress-title';
  title.textContent = t('editor.closingNoteTitle') || 'Closing note';

  const body = document.createElement('div');
  body.className = 'planner-progress-message';
  body.textContent = message || (t('editor.closingNoteMessage') || 'Please wait while the note is being closed...');

  const spinner = document.createElement('div');
  spinner.className = 'planner-progress-spinner';
  spinner.setAttribute('aria-hidden', 'true');

  // Progress bar container and fill
  const barContainer = document.createElement('div');
  barContainer.className = 'planner-progress-bar-container';
  barContainer.style.width = '100%';
  barContainer.style.height = '6px';
  barContainer.style.background = 'var(--card-border)';
  barContainer.style.borderRadius = '3px';
  barContainer.style.overflow = 'hidden';
  barContainer.style.marginTop = '0.5rem';

  const barFill = document.createElement('div');
  barFill.className = 'planner-progress-bar-fill';
  barFill.style.width = '0%';
  barFill.style.height = '100%';
  barFill.style.background = 'var(--accent)';
  barFill.style.transition = 'width 0.3s ease';

  barContainer.appendChild(barFill);

  box.appendChild(spinner);
  box.appendChild(title);
  box.appendChild(body);
  box.appendChild(barContainer);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  return {
    update(nextMessage, percentage) {
      if (body) body.textContent = nextMessage || body.textContent;
      if (barFill && percentage !== undefined) {
        barFill.style.width = percentage + '%';
      }
    },
    close() {
      if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
  };
}

async function closeNoteOverlay(forceCloseAll = false) {
  if (_noteCloseInProgress) return;
  _noteCloseInProgress = true;
  flushTagEditorInputs();

  const panelEl = document.querySelector('#note-edit-overlay .overlay-panel');
  if (panelEl) panelEl.classList.add('overlay-busy');
  setSaveIndicator('closing');

  let progress = null;
  let progressTimer = null;

  try {
    if (typeof unmountAiLane === 'function') {
      unmountAiLane();
    }
    const rightPanel = document.getElementById('overlay-right-panel');
    if (rightPanel) {
      delete rightPanel.dataset.currentNoteId;
      delete rightPanel.dataset.activeTab;
      delete rightPanel.dataset.aiEnabled;
    }
    let skipSave = false;
    if (typeof forceCloseAll === 'object' && forceCloseAll) {
      skipSave = !!forceCloseAll.skipSave;
      forceCloseAll = !!forceCloseAll.forceCloseAll;
    }
    if (forceCloseAll) overlayStack = [];
    closeNestedNoteOverlay();
    hideTableToolbar();
    hideResizeToolbar();
    clearAutoSave();
    showDecisionPicker = false;
    decisionPickerQuery = '';
    document.removeEventListener('click', _dismissDecisionPicker);
    closeLinkNotePicker();
    const hint = document.getElementById('title-rename-hint');
    if (hint) hint.style.display = 'none';

    // Only run final save if user was in edit mode (not just viewing) AND has unsaved changes AND note still exists
    const wasEditing = !document.querySelector('.overlay-panel')?.classList.contains('overlay-view-mode');
    const curManifest = (typeof manifest !== 'undefined' && Array.isArray(manifest)) ? manifest : ((typeof window !== 'undefined' && Array.isArray(window.manifest)) ? window.manifest : []);
    const noteStillExists = currentNote?.path ? curManifest.some(m => m.path === currentNote.path) : true;
    const hasUnsavedChanges = hasUnsavedNoteOverlayChanges();
    const closingNoteRef = currentNote;

    if (wasEditing && !skipSave && hasUnsavedChanges && noteStillExists && closingNoteRef) {
      // Only show progress dialog if save takes longer than 350ms in in-app mode
      if (!_isFocusedMode) {
        progressTimer = setTimeout(() => {
          progress = showNoteCloseProgressDialog((t('editor.closingSaveStep') || 'Saving note...') + (closingNoteRef.title ? ` "${closingNoteRef.title}"...` : '...'));
          if (progress) progress.update(t('editor.closingSaveStep') || 'Saving note...', 40);
        }, 350);
      }
      try {
        await autoSaveNote({ silent: true, isFinal: true, noteToSave: closingNoteRef });
      } catch (err) {
        console.warn('Save failed during overlay close:', err);
      }
      if (progressTimer) {
        clearTimeout(progressTimer);
        progressTimer = null;
      }
    }

    // Auto-create missing todos in background
    try {
      createMissingTodosForCurrentNote().catch(() => {});
    } catch (e) {
      console.warn('Auto-create todos failed', e);
    }
    dismissReloadBanner();

    if (overlayStack.length > 0) {
      const prevPath = overlayStack.pop();
      await openNoteOverlay(prevPath, null, null, true);
      return;
    }

    if (!_isFocusedMode) {
      const overlay = document.getElementById('note-edit-overlay');
      if (overlay) {
        overlay.style.display = 'none';
        overlay.classList.remove('active', 'closing');
        overlay.style.zIndex = '';
      }
    }
    editMode = false;
    currentNote = null;
    if (typeof lastActiveNoteForTab !== 'undefined') {
      lastActiveNoteForTab[activeTab] = null;
    }

    if (typeof DailyReviewController !== 'undefined' && DailyReviewController && typeof activeTab !== 'undefined' && activeTab === 'daily-review') {
      if (DailyReviewController.currentStep === 5 && typeof DailyReviewController.mountStep5NoteEditor === 'function') {
        DailyReviewController.mountStep5NoteEditor();
      } else if (DailyReviewController.currentStep === 4 && typeof DailyReviewController.mountStep3NoteEditor === 'function') {
        DailyReviewController.mountStep3NoteEditor();
      }
    }

    const collabReturn = window._collabReturnContext && window._collabReturnContext.restore
      ? window._collabReturnContext
      : null;
    window._collabReturnContext = null;

    if (collabReturn) {
      if (typeof switchTab === 'function') await switchTab('team');
      if (typeof activeCollabView !== 'undefined') {
        activeCollabView = collabReturn.collabView || 'team';
      }
      if (typeof renderTeamPanel === 'function') renderTeamPanel();
      if (collabReturn.collaboratorName && typeof window.showCollaboratorModal === 'function') {
        setTimeout(() => {
          window.showCollaboratorModal(collabReturn.collaboratorName);
        }, 0);
      }
    }

    updateUrlHash();
    if (_isFocusedMode) {
      document.title = (typeof t === 'function' ? t('app.name') : 'Secretary');
      _tryCloseCurrentWindow();
      if (!window.AppBridge?.isElectron) {
        _isFocusedMode = false;
        document.body.classList.remove('focused-note-mode');
        const overlay = document.getElementById('note-edit-overlay');
        if (overlay) overlay.style.display = 'none';
      }
    } else {
      if (activeTab === 'notes' || activeTab === 'todos') {
        renderBoard();
      } else if (activeTab === 'retro' && typeof renderRetroPanel === 'function') {
        renderRetroPanel();
      }
    }
  } finally {
    if (progressTimer) clearTimeout(progressTimer);
    if (progress) progress.close();
    if (panelEl) panelEl.classList.remove('overlay-busy');
    setSaveIndicator('');
    _noteCloseInProgress = false;
  }
  if (window.syncFloatingChatContext) window.syncFloatingChatContext();
}

function _noteArraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function hasUnsavedNoteOverlayChanges() {
  if (_isNoteLoading || !currentNote) return false;
  const panel = document.querySelector('.overlay-panel');
  if (panel && panel.classList.contains('overlay-view-mode')) return false;

  const title = document.getElementById('edit-title')?.value?.trim() || '';
  const date = document.getElementById('edit-date')?.value?.trim() || '';
  const groupTags = readTagEditor('editor-group');
  const majorTags = readTagEditor('editor-major');
  const topicTags = readTagEditor('editor-topic');
  const extraTags = readTagEditor('editor-extra');
  const ta = document.getElementById('edit-textarea');
  const rawHTML = ta ? ta.innerHTML : '<p></p>';
  const cleanMainHTML = typeof window.cleanHtmlBeforeSave === 'function' ? window.cleanHtmlBeforeSave(rawHTML) : rawHTML;
  const currentCleanHTML = typeof window.cleanHtmlBeforeSave === 'function' ? window.cleanHtmlBeforeSave(currentNote.mainHTML || '<p></p>') : (currentNote.mainHTML || '<p></p>');

  const summaryEl = document.getElementById('edit-summary');
  const summary = summaryEl ? summaryEl.innerHTML : '';

  if (title !== (currentNote.title || '')) return true;
  if (date !== (currentNote.date || '')) return true;
  if (!_noteArraysEqual(groupTags, currentNote.group_tags || [])) return true;
  if (!_noteArraysEqual(majorTags, currentNote.major_topic_tags || [])) return true;
  if (!_noteArraysEqual(topicTags, currentNote.topic_tags || [])) return true;
  if (!_noteArraysEqual(extraTags, currentNote.extra_tags || [])) return true;
  if (summary !== (currentNote.summary || '')) return true;
  return cleanMainHTML.trim() !== currentCleanHTML.trim();
}

async function requestCloseNoteOverlay(options = {}) {
  if (_noteCloseInProgress) return;
  const forceCloseAll = !!options.forceCloseAll;
  if (!hasUnsavedNoteOverlayChanges()) {
    await closeNoteOverlay(forceCloseAll);
    return;
  }

  const choice = await showUnsavedChangesDialog();
  if (choice === 'save') {
    await closeNoteOverlay(forceCloseAll);
  } else if (choice === 'discard') {
    await closeNoteOverlay({ forceCloseAll, skipSave: true });
  }
}

function getSelectionTagNode(tagName) {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  let parent = range.commonAncestorContainer;
  if (parent.nodeType === Node.TEXT_NODE) parent = parent.parentNode;
  return parent.closest ? parent.closest(tagName) : null;
}

function isSelectionInTag(tagName) {
  return !!getSelectionTagNode(tagName);
}

function cleanHeaderFormatting(tagName) {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  let parent = range.commonAncestorContainer;
  if (parent.nodeType === Node.TEXT_NODE) parent = parent.parentNode;
  
  const block = parent.closest(tagName);
  if (block) {
    block.removeAttribute('style');
    const children = block.querySelectorAll('[style], font');
    children.forEach(child => {
      if (child.tagName.toLowerCase() === 'font') {
        child.removeAttribute('size');
        child.removeAttribute('face');
        child.removeAttribute('color');
        if (child.attributes.length === 0) {
          _unwrapNodePreserveChildren(child);
        }
      } else {
        child.style.fontSize = '';
        child.style.fontWeight = '';
        if (!child.getAttribute('style')) {
          child.removeAttribute('style');
        }
        if (child.tagName.toLowerCase() === 'span' && child.attributes.length === 0) {
          _unwrapNodePreserveChildren(child);
        }
      }
    });
  }
}

function _unwrapNodePreserveChildren(node) {
  if (!node || !node.parentNode) return;
  const parent = node.parentNode;
  while (node.firstChild) {
    parent.insertBefore(node.firstChild, node);
  }
  parent.removeChild(node);
}

function _getEditorSelectionRange(editorEl) {
  const selection = window.getSelection();
  if (!editorEl || !selection || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  const anchorNode = selection.anchorNode;
  const focusNode = selection.focusNode;
  if (!anchorNode || !focusNode) return null;
  if (!editorEl.contains(anchorNode) || !editorEl.contains(focusNode)) return null;
  return range;
}

function _isRangeWithText(range) {
  return !!range && !range.collapsed && (range.toString() || '').trim().length > 0;
}

function _isRangeInsideEditor(editorEl, range) {
  if (!editorEl || !range) return false;
  const startNode = range.startContainer;
  const endNode = range.endContainer;
  return !!(startNode && endNode && editorEl.contains(startNode) && editorEl.contains(endNode));
}

function _isNodeWithinSelector(node, root, selector) {
  if (!node || !root) return false;
  const parent = node.nodeType === Node.TEXT_NODE ? node.parentNode : node;
  return !!(parent && parent.closest && parent.closest(selector) && root.contains(parent.closest(selector)));
}

function _getClosestTag(node, root, selector) {
  if (!node || !root) return null;
  const parent = node.nodeType === Node.TEXT_NODE ? node.parentNode : node;
  const found = parent && parent.closest ? parent.closest(selector) : null;
  return found && root.contains(found) ? found : null;
}

function _removeInlineTagFromSelection(editorEl, selector, range) {
  if (!editorEl || !range) return;
  const scope = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentNode;
  if (!scope) return;

  const nodes = [];
  if (scope.matches && scope.matches(selector) && editorEl.contains(scope)) {
    nodes.push(scope);
  }

  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!editorEl.contains(node) || !node.matches || !node.matches(selector)) continue;
    try {
      if (range.intersectsNode(node)) nodes.push(node);
    } catch (_) {
      // Ignore detached/intersection errors and continue.
    }
  }

  const containerParent = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
    ? range.commonAncestorContainer.parentNode
    : range.commonAncestorContainer;
  const containerMatch = containerParent && containerParent.closest ? containerParent.closest(selector) : null;
  if (containerMatch && editorEl.contains(containerMatch)) {
    nodes.push(containerMatch);
  }

  [...new Set(nodes)].forEach(_unwrapNodePreserveChildren);
}

function _selectionHasInlineFormat(editorEl, selector, range) {
  if (!editorEl || !range || !_isRangeInsideEditor(editorEl, range)) return false;

  const walkNode = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentNode;
  if (!walkNode) return false;

  if (walkNode.matches && walkNode.matches(selector) && editorEl.contains(walkNode)) {
    return true;
  }

  const walker = document.createTreeWalker(walkNode, NodeFilter.SHOW_ELEMENT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!editorEl.contains(node) || !node.matches || !node.matches(selector)) continue;
    try {
      if (range.intersectsNode(node)) return true;
    } catch (_) {
      // Ignore transient range errors.
    }
  }
  return false;
}

function _clearPendingInlineFormatting(cmd) {
  if (cmd === 'bold' && document.queryCommandState('bold')) {
    document.execCommand('bold', false);
  } else if (cmd === 'italic' && document.queryCommandState('italic')) {
    document.execCommand('italic', false);
  } else if (cmd === 'underline' && document.queryCommandState('underline')) {
    document.execCommand('underline', false);
  } else if (cmd === 'strike' && document.queryCommandState('strikeThrough')) {
    document.execCommand('strikeThrough', false);
  }
}

function toggleInlineTagSelection(tagName) {
  const selection = window.getSelection();
  if (!selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  
  let parent = range.commonAncestorContainer;
  if (parent.nodeType === Node.TEXT_NODE) parent = parent.parentNode;
  
  const existingTag = parent.closest(tagName);
  if (existingTag) {
    const parentNode = existingTag.parentNode;
    const textNode = document.createTextNode(existingTag.textContent);
    parentNode.replaceChild(textNode, existingTag);
    
    selection.removeAllRanges();
    const newRange = document.createRange();
    newRange.selectNodeContents(textNode);
    selection.addRange(newRange);
  } else {
    wrapSelectionInTag(tagName);
  }
}

/* ── Editor Zoom Levels & Controls ── */
const ZOOM_LEVELS = [0.5, 0.75, 0.9, 1.0, 1.1, 1.25, 1.5, 2.0];
let currentZoomIndex = 3; // 1.0 default

function initEditorZoom() {
  let savedZoom = localStorage.getItem('secretaryEditorZoom');
  if (savedZoom) {
    const parsed = parseFloat(savedZoom);
    const idx = ZOOM_LEVELS.indexOf(parsed);
    if (idx >= 0) {
      currentZoomIndex = idx;
    }
  }
  applyEditorZoom();
}

function applyEditorZoom() {
  const zoom = ZOOM_LEVELS[currentZoomIndex];
  
  // Set inline on documentElement, pane, textarea, and page wrapper to ensure inheritance
  document.documentElement.style.setProperty('--editor-zoom', String(zoom));
  
  const pane = document.getElementById('edit-pane-left');
  if (pane) pane.style.setProperty('--editor-zoom', String(zoom));
  
  const ta = document.getElementById('edit-textarea');
  if (ta) ta.style.setProperty('--editor-zoom', String(zoom));
  
  const page = document.querySelector('.editor-page');
  if (page) page.style.setProperty('--editor-zoom', String(zoom));

  const label = document.getElementById('editor-zoom-label');
  if (label) {
    label.textContent = Math.round(zoom * 100) + '%';
  }
}

function zoomEditor(direction) {
  if (direction === 0) {
    currentZoomIndex = ZOOM_LEVELS.indexOf(1.0);
  } else {
    currentZoomIndex = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, currentZoomIndex + direction));
  }
  const zoom = ZOOM_LEVELS[currentZoomIndex];
  localStorage.setItem('secretaryEditorZoom', String(zoom));
  applyEditorZoom();
}

/* ── HTML Paste Sanitizer (Merge Formatting) ── */
function sanitizePastedHTML(htmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, 'text/html');
  const container = doc.body;

  const allowedTags = new Set([
    'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'mark', 'code', 'a',
    'ul', 'ol', 'li', 'p', 'br', 'h1', 'h2', 'h3', 'blockquote',
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img', 'pre', 'input'
  ]);

  function cleanNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.cloneNode(true);
    }
    
    if (node.nodeType === Node.ELEMENT_NODE) {
      const tagName = node.tagName.toLowerCase();
      
      if (allowedTags.has(tagName)) {
        const cleanEl = document.createElement(tagName);
        
        if (tagName === 'a') {
          const href = node.getAttribute('href');
          if (href) cleanEl.setAttribute('href', href);
          cleanEl.setAttribute('target', '_blank');
        } else if (tagName === 'img') {
          const src = node.getAttribute('src');
          const alt = node.getAttribute('alt');
          const width = node.getAttribute('width');
          const height = node.getAttribute('height');
          const dataId = node.getAttribute('data-id');
          const dataAssetPath = node.getAttribute('data-asset-path');
          const style = node.getAttribute('style');
          if (src) cleanEl.setAttribute('src', src);
          if (alt) cleanEl.setAttribute('alt', alt);
          if (width) cleanEl.setAttribute('width', width);
          if (height) cleanEl.setAttribute('height', height);
          if (dataId) cleanEl.setAttribute('data-id', dataId);
          if (dataAssetPath) cleanEl.setAttribute('data-asset-path', dataAssetPath);
          if (style) cleanEl.setAttribute('style', style);
        } else if (tagName === 'input') {
          const type = node.getAttribute('type');
          if (type === 'checkbox') {
            cleanEl.setAttribute('type', 'checkbox');
            if (node.checked || node.hasAttribute('checked')) {
              cleanEl.setAttribute('checked', 'checked');
            }
          }
        }
        
        if (node.classList.contains('note-todo') || node.classList.contains('note-todo-text')) {
          cleanEl.className = node.className;
          for (const attr of node.attributes) {
            if (attr.name.startsWith('data-todo-')) {
              cleanEl.setAttribute(attr.name, attr.value);
            }
          }
        } else if (node.classList.contains('note-decision-wrapper') || node.classList.contains('note-decision-text')) {
          cleanEl.className = node.className;
          for (const attr of node.attributes) {
            if (attr.name.startsWith('data-decision-')) {
              cleanEl.setAttribute(attr.name, attr.value);
            }
          }
        } else if (node.classList.contains('note-highlight')) {
          cleanEl.className = 'note-highlight';
        } else if (node.classList.contains('pill-mention')) {
          cleanEl.className = node.className;
          const label = node.getAttribute('data-colleague-label');
          const id = node.getAttribute('data-colleague-id');
          if (label) cleanEl.setAttribute('data-colleague-label', label);
          if (id) cleanEl.setAttribute('data-colleague-id', id);
        }

        for (let i = 0; i < node.childNodes.length; i++) {
          const cleanedChild = cleanNode(node.childNodes[i]);
          if (cleanedChild) cleanEl.appendChild(cleanedChild);
        }
        
        return cleanEl;
      } else {
        const frag = document.createDocumentFragment();
        for (let i = 0; i < node.childNodes.length; i++) {
          const cleanedChild = cleanNode(node.childNodes[i]);
          if (cleanedChild) frag.appendChild(cleanedChild);
        }
        return frag;
      }
    }
    return null;
  }

  const fragment = document.createDocumentFragment();
  while (container.firstChild) {
    const cleaned = cleanNode(container.firstChild);
    if (cleaned) fragment.appendChild(cleaned);
    container.removeChild(container.firstChild);
  }
  
  const tempDiv = document.createElement('div');
  tempDiv.appendChild(fragment);
  const resultHTML = tempDiv.innerHTML;
  if (typeof sanitizeHtmlContent === 'function') {
    return sanitizeHtmlContent(resultHTML);
  }
  return resultHTML;
}

// Initialize zoom on load
initEditorZoom();

async function formatRichText(cmd) {
  const ta = _lastFocusedEditor || document.getElementById('edit-textarea');
  if (!ta) return;
  return formatRichTextInEditor(ta, cmd);
}

function wrapSelectionInTag(tagName) {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  const selectedText = range.toString();

  const el = document.createElement(tagName);
  if (selectedText) {
    const fragment = range.extractContents();
    el.appendChild(fragment);
    if (el.querySelector('ul, ol, li')) {
      el.classList.add('highlight-block');
    }
    range.insertNode(el);
    selection.removeAllRanges();
    const newRange = document.createRange();
    newRange.selectNodeContents(el);
    selection.addRange(newRange);
  } else {
    el.innerHTML = '&#8203;';
    range.deleteContents();
    range.insertNode(el);
    selection.removeAllRanges();
    const newRange = document.createRange();
    newRange.setStart(el.firstChild, 1);
    newRange.collapse(true);
    selection.addRange(newRange);
  }
}

function wrapSelectionInCodeBlock() {
  const selection = window.getSelection();
  if (!selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  const selectedText = range.toString();

  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.textContent = selectedText || '// code block';
  pre.appendChild(code);
  
  range.deleteContents();
  range.insertNode(pre);
}

function insertTableRichText() {
  const html = '<table style="border-collapse: collapse; width: 100%; border: 1px solid var(--card-border); margin: 10px 0;">' +
    '<thead><tr style="background: var(--card-bg-alt);">' +
      '<th style="border: 1px solid var(--card-border); padding: 8px;">Header 1</th>' +
      '<th style="border: 1px solid var(--card-border); padding: 8px;">Header 2</th>' +
    '</tr></thead>' +
    '<tbody><tr>' +
      '<td style="border: 1px solid var(--card-border); padding: 8px;">Cell 1</td>' +
      '<td style="border: 1px solid var(--card-border); padding: 8px;">Cell 2</td>' +
    '</tr></tbody>' +
  '</table><p><br></p>';
  document.execCommand('insertHTML', false, html);
}

// ═══ LaTeX Math Formula Editor Popover ═══
let _activeMathPopover = null;
let _mathSavedRange = null;
let _mathTargetEditor = null;
let _editingMathNode = null;

function openMathFormulaEditor(targetNode = null, editorEl = null) {
  const targetEditor = editorEl || _lastFocusedEditor || document.getElementById('edit-textarea');
  if (!targetEditor) return;
  _mathTargetEditor = targetEditor;
  _editingMathNode = targetNode && (targetNode.classList.contains('note-math') || targetNode.classList.contains('note-math-block')) ? targetNode : null;

  if (!_editingMathNode) {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      _mathSavedRange = sel.getRangeAt(0).cloneRange();
    } else {
      _mathSavedRange = null;
    }
  }

  // Remove existing popover if any
  if (_activeMathPopover) {
    _activeMathPopover.remove();
    _activeMathPopover = null;
  }

  let initialLatex = '';
  let isBlock = false;
  if (_editingMathNode) {
    initialLatex = _editingMathNode.getAttribute('data-latex') || _editingMathNode.textContent.replace(/^\$\$?|\$\$?$/g, '').trim();
    isBlock = _editingMathNode.classList.contains('note-math-block') || _editingMathNode.getAttribute('data-math-mode') === 'block';
  } else if (_mathSavedRange && !_mathSavedRange.collapsed) {
    initialLatex = _mathSavedRange.toString().trim();
  }

  const popover = document.createElement('div');
  popover.className = 'math-editor-popover';
  popover.id = 'math-formula-editor-popover';

  const modalTitle = typeof t === 'function' ? (t('editor.mathModalTitle') || 'LaTeX Formula') : 'LaTeX Formula';
  const typeInlineLabel = typeof t === 'function' ? (t('editor.mathTypeInline') || 'Inline ($...$)') : 'Inline ($...$)';
  const typeBlockLabel = typeof t === 'function' ? (t('editor.mathTypeBlock') || 'Display Block ($$...$$)') : 'Display Block ($$...$$)';
  const placeholderText = typeof t === 'function' ? (t('editor.mathPlaceholder') || 'e.g. \\frac{a}{b}, x^2 + y^2 = z^2') : 'e.g. \\frac{a}{b}, x^2 + y^2 = z^2';
  const insertLabel = _editingMathNode ? (typeof t === 'function' ? (t('editor.mathUpdate') || 'Update') : 'Update') : (typeof t === 'function' ? (t('editor.mathInsert') || 'Insert') : 'Insert');
  const cancelLabel = typeof t === 'function' ? (t('common.cancel') || 'Cancel') : 'Cancel';
  const previewLabel = typeof t === 'function' ? (t('editor.mathPreview') || 'Preview') : 'Preview';

  popover.innerHTML = `
    <div class="math-editor-header">
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="font-family:'Times New Roman',serif;font-style:italic;font-weight:700;font-size:14px;color:var(--accent);">fx</span>
        <span>${escH(modalTitle)}</span>
      </div>
      <button type="button" class="btn btn-sm btn-ghost math-close-btn" style="padding:2px 6px;line-height:1;" title="${escA(cancelLabel)}">✕</button>
    </div>
    <div class="math-editor-types">
      <button type="button" class="math-type-btn ${!isBlock ? 'active' : ''}" data-mode="inline" title="Inline math within text">${escH(typeInlineLabel)}</button>
      <button type="button" class="math-type-btn ${isBlock ? 'active' : ''}" data-mode="block" title="Centered display equation">${escH(typeBlockLabel)}</button>
    </div>
    <div class="math-quick-symbols">
      <button type="button" class="math-sym-btn" data-insert="\\frac{a}{b}" title="Fraction">\\frac{a}{b}</button>
      <button type="button" class="math-sym-btn" data-insert="\\sqrt{x}" title="Square Root">\\sqrt{x}</button>
      <button type="button" class="math-sym-btn" data-insert="x^{2}" title="Superscript / Power">x^{2}</button>
      <button type="button" class="math-sym-btn" data-insert="x_{i}" title="Subscript">x_{i}</button>
      <button type="button" class="math-sym-btn" data-insert="\\sum_{i=1}^{n} " title="Summation">\\sum</button>
      <button type="button" class="math-sym-btn" data-insert="\\int_{a}^{b} " title="Integral">\\int</button>
      <button type="button" class="math-sym-btn" data-insert="\\pm " title="Plus-minus">\\pm</button>
      <button type="button" class="math-sym-btn" data-insert="\\alpha " title="Alpha">\\alpha</button>
      <button type="button" class="math-sym-btn" data-insert="\\beta " title="Beta">\\beta</button>
      <button type="button" class="math-sym-btn" data-insert="\\theta " title="Theta">\\theta</button>
      <button type="button" class="math-sym-btn" data-insert="\\infty " title="Infinity">\\infty</button>
      <button type="button" class="math-sym-btn" data-insert="\\rightarrow " title="Right arrow">\\rightarrow</button>
    </div>
    <textarea class="math-editor-textarea" placeholder="${escA(placeholderText)}" rows="2" spellcheck="false" title="LaTeX input">${escH(initialLatex)}</textarea>
    <div style="display:flex;flex-direction:column;gap:4px;">
      <div style="font-size:0.75rem;color:var(--text-muted);font-weight:600;">${escH(previewLabel)}</div>
      <div class="math-preview-box" id="math-preview-output"></div>
    </div>
    <div class="math-editor-actions">
      <button type="button" class="btn btn-sm btn-secondary math-btn-cancel">${escH(cancelLabel)}</button>
      <button type="button" class="btn btn-sm btn-primary math-btn-apply">${escH(insertLabel)}</button>
    </div>
  `;

  document.body.appendChild(popover);
  _activeMathPopover = popover;

  const textarea = popover.querySelector('.math-editor-textarea');
  const previewBox = popover.querySelector('#math-preview-output');
  const typeBtns = popover.querySelectorAll('.math-type-btn');
  let currentMode = isBlock ? 'block' : 'inline';

  function updatePreview() {
    const val = textarea.value.trim();
    if (!val) {
      previewBox.innerHTML = `<span style="color:var(--text-muted);font-size:0.8rem;font-style:italic;">${escH(placeholderText)}</span>`;
      return;
    }
    const rendered = typeof renderLatexToString === 'function' ? renderLatexToString(val, currentMode === 'block') : val;
    previewBox.innerHTML = rendered || `<span style="color:var(--danger,#ef4444);font-size:0.8rem;">${escH(typeof t === 'function' ? t('editor.mathInvalid') || 'Syntax error' : 'Syntax error')}</span>`;
  }

  typeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      typeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentMode = btn.getAttribute('data-mode') || 'inline';
      updatePreview();
    });
  });

  popover.querySelectorAll('.math-sym-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const snippet = btn.getAttribute('data-insert') || '';
      const start = textarea.selectionStart || 0;
      const end = textarea.selectionEnd || 0;
      const val = textarea.value;
      textarea.value = val.substring(0, start) + snippet + val.substring(end);
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd = start + snippet.length;
      updatePreview();
    });
  });

  textarea.addEventListener('input', updatePreview);
  textarea.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' && (e.ctrlKey || e.metaKey)) || (e.key === 'Enter' && currentMode === 'inline' && !e.shiftKey)) {
      e.preventDefault();
      applyFormula();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeMathFormulaEditor();
    }
  });

  function closeMathFormulaEditor() {
    if (_activeMathPopover) {
      if (window.PopoverManager) window.PopoverManager.unregister('math-formula-editor');
      _activeMathPopover.remove();
      _activeMathPopover = null;
    }
  }

  function applyFormula() {
    const rawLatex = textarea.value.trim();
    if (!rawLatex) {
      if (_editingMathNode) {
        _editingMathNode.remove();
        _mathTargetEditor.dispatchEvent(new Event('input', { bubbles: true }));
      }
      closeMathFormulaEditor();
      return;
    }

    const isBlockMode = currentMode === 'block';
    const rendered = typeof renderLatexToString === 'function' ? renderLatexToString(rawLatex, isBlockMode) : rawLatex;
    const safeLatex = typeof escA === 'function' ? escA(rawLatex) : rawLatex.replace(/"/g, '&quot;');

    if (_editingMathNode) {
      if (isBlockMode && _editingMathNode.tagName.toLowerCase() !== 'div') {
        const replacement = document.createElement('div');
        replacement.className = 'note-math-block';
        replacement.setAttribute('data-math-mode', 'block');
        replacement.setAttribute('data-latex', rawLatex);
        replacement.setAttribute('contenteditable', 'false');
        replacement.setAttribute('title', `LaTeX: ${safeLatex} (Block)`);
        replacement.innerHTML = rendered;
        _editingMathNode.parentNode.replaceChild(replacement, _editingMathNode);
        _editingMathNode = replacement;
      } else if (!isBlockMode && _editingMathNode.tagName.toLowerCase() !== 'span') {
        const replacement = document.createElement('span');
        replacement.className = 'note-math';
        replacement.removeAttribute('data-math-mode');
        replacement.setAttribute('data-latex', rawLatex);
        replacement.setAttribute('contenteditable', 'false');
        replacement.setAttribute('title', `LaTeX: ${safeLatex} (Inline)`);
        replacement.innerHTML = rendered;
        _editingMathNode.parentNode.replaceChild(replacement, _editingMathNode);
        _editingMathNode = replacement;
      } else {
        _editingMathNode.className = isBlockMode ? 'note-math-block' : 'note-math';
        if (isBlockMode) _editingMathNode.setAttribute('data-math-mode', 'block');
        else _editingMathNode.removeAttribute('data-math-mode');
        _editingMathNode.setAttribute('data-latex', rawLatex);
        _editingMathNode.setAttribute('contenteditable', 'false');
        _editingMathNode.setAttribute('title', `LaTeX: ${safeLatex} (${isBlockMode ? 'Block' : 'Inline'})`);
        _editingMathNode.innerHTML = rendered;
      }
    } else {
      _mathTargetEditor.focus();
      const node = document.createElement(isBlockMode ? 'div' : 'span');
      node.className = isBlockMode ? 'note-math-block' : 'note-math';
      if (isBlockMode) node.setAttribute('data-math-mode', 'block');
      node.setAttribute('data-latex', rawLatex);
      node.setAttribute('contenteditable', 'false');
      node.setAttribute('title', `LaTeX: ${safeLatex} (${isBlockMode ? 'Block' : 'Inline'})`);
      node.innerHTML = rendered;

      const sel = window.getSelection();
      if (_mathSavedRange) {
        sel.removeAllRanges();
        sel.addRange(_mathSavedRange);
      }
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(node);
        range.setStartAfter(node);
        range.setEndAfter(node);
        sel.removeAllRanges();
        sel.addRange(range);
      } else {
        _mathTargetEditor.appendChild(node);
      }
    }

    _mathTargetEditor.dispatchEvent(new Event('input', { bubbles: true }));
    closeMathFormulaEditor();
  }

  popover.querySelector('.math-close-btn').addEventListener('click', closeMathFormulaEditor);
  popover.querySelector('.math-btn-cancel').addEventListener('click', closeMathFormulaEditor);
  popover.querySelector('.math-btn-apply').addEventListener('click', applyFormula);

  let targetRect = null;
  if (_editingMathNode) {
    targetRect = _editingMathNode.getBoundingClientRect();
  } else if (_mathSavedRange) {
    targetRect = _mathSavedRange.getBoundingClientRect();
  }

  if (targetRect && targetRect.width > 0 && targetRect.height > 0) {
    let top = targetRect.bottom + 8;
    let left = targetRect.left;
    const popoverWidth = 380;
    const popoverHeight = 280;
    if (left + popoverWidth > window.innerWidth - 16) {
      left = Math.max(16, window.innerWidth - popoverWidth - 16);
    }
    if (top + popoverHeight > window.innerHeight - 16) {
      top = Math.max(16, targetRect.top - popoverHeight - 10);
    }
    top = Math.max(16, Math.min(top, window.innerHeight - popoverHeight - 16));
    left = Math.max(16, Math.min(left, window.innerWidth - popoverWidth - 16));
    popover.style.top = top + 'px';
    popover.style.left = left + 'px';
  } else {
    popover.style.top = '50%';
    popover.style.left = '50%';
    popover.style.transform = 'translate(-50%, -50%)';
  }

  if (window.PopoverManager) {
    window.PopoverManager.register('math-formula-editor', popover, {
      onClose: () => {
        if (_activeMathPopover) {
          _activeMathPopover.remove();
          _activeMathPopover = null;
        }
      }
    });
  }

  updatePreview();
  setTimeout(() => textarea.focus(), 50);
}

function insertChecklistItemRichText() {
  const selection = window.getSelection();
  if (!selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  const selectedText = range.toString();

  const li = document.createElement('li');
  li.style.listStyleType = 'none';
  
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.style.marginRight = '6px';
  checkbox.style.verticalAlign = 'middle';
  
  li.appendChild(checkbox);
  li.appendChild(document.createTextNode(selectedText || ' Task'));

  const ul = document.createElement('ul');
  ul.style.listStyleType = 'none';
  ul.style.paddingLeft = '1.2rem';
  ul.appendChild(li);

  range.deleteContents();
  range.insertNode(ul);
}

function isSelectionInChecklist() {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return false;
  const range = selection.getRangeAt(0);
  let parent = range.commonAncestorContainer;
  if (parent.nodeType === Node.TEXT_NODE) parent = parent.parentNode;
  const li = parent.closest('li');
  return !!(li && li.querySelector('input[type="checkbox"]'));
}

function removeChecklistItemRichText() {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  let parent = range.commonAncestorContainer;
  if (parent.nodeType === Node.TEXT_NODE) parent = parent.parentNode;
  
  const li = parent.closest('li');
  if (li) {
    const checkbox = li.querySelector('input[type="checkbox"]');
    if (checkbox) checkbox.remove();
    
    const p = document.createElement('p');
    while (li.firstChild) {
      p.appendChild(li.firstChild);
    }
    
    const ul = li.closest('ul');
    if (ul) {
      ul.parentNode.insertBefore(p, ul);
      li.remove();
      if (!ul.querySelector('li')) {
        ul.remove();
      }
    } else {
      li.parentNode.replaceChild(p, li);
    }
    
    const newRange = document.createRange();
    newRange.selectNodeContents(p);
    newRange.collapse(false);
    selection.removeAllRanges();
    selection.addRange(newRange);
    p.focus();
  }
}

// Track whether a mousedown started inside the overlay panel to prevent
// text-selection drags from accidentally closing the overlay.
let _overlayPanelMouseDown = false;
document.addEventListener('mousedown', e => {
  const panel = document.querySelector('#note-edit-overlay .overlay-panel');
  _overlayPanelMouseDown = !!(panel && panel.contains(e.target));
  
  // Prevent toolbar formatting buttons from stealing focus from contenteditable editor
  const btn = e.target.closest('.fmt-btn');
  if (btn) {
    e.preventDefault();
  }
}, true);

function overlayBackdropClick(e) {
  if (e.target === document.getElementById('note-edit-overlay') && !_overlayPanelMouseDown) {
    requestCloseNoteOverlay({ forceCloseAll: true });
  }
  _overlayPanelMouseDown = false;
}

function syncPreview() {}

function closePreviewHighlightMenu() {}
function showPreviewHighlightContextMenu() { return false; }

// ═══ Note Editor Context Menu ═══
let _editorContextMenu = null;

function closeEditorContextMenu() {
  if (_editorContextMenu) {
    _editorContextMenu.remove();
    _editorContextMenu = null;
  }
  document.removeEventListener('click', _dismissEditorContextMenu);
  document.removeEventListener('mousedown', _dismissEditorContextMenu);
  document.removeEventListener('keydown', _escEditorContextMenu);
}

function _dismissEditorContextMenu(e) {
  if (_editorContextMenu && !_editorContextMenu.contains(e.target)) {
    closeEditorContextMenu();
  }
}

function _escEditorContextMenu(e) {
  if (e.key === 'Escape') {
    closeEditorContextMenu();
  }
}

function showEditorContextMenu(event) {
  const ta = document.getElementById('edit-textarea');
  if (!ta) return;

  event.preventDefault();
  event.stopPropagation();
  closeEditorContextMenu();

  const menu = document.createElement('div');
  menu.className = 'note-card-context-menu editor-text-context-menu';
  menu.style.position = 'absolute';
  menu.style.zIndex = '3000';

  const makeBtn = (icon, labelKey, defaultText, fn, tooltipKey, defaultTooltipText) => {
    const b = document.createElement('button');
    b.className = 'ctx-btn';
    const txt = typeof t === 'function' ? (t(labelKey) || defaultText) : defaultText;
    const tooltipText = tooltipKey ? (typeof t === 'function' ? (t(tooltipKey) || defaultTooltipText || txt) : (defaultTooltipText || txt)) : (defaultTooltipText || txt);
    b.title = tooltipText;
    b.innerHTML = `<span style="display:inline-block;width:1.2rem;text-align:center;">${icon}</span> ${txt}`;
    b.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      try {
        await fn();
      } catch (err) {
        console.warn(err);
      }
      closeEditorContextMenu();
    });
    return b;
  };

  const makeHeader = (labelKey, defaultText) => {
    const h = document.createElement('div');
    h.className = 'ctx-header';
    h.style.cssText = 'padding: 4px 8px; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); opacity: 0.8; border-bottom: 1px solid var(--card-border); margin-bottom: 2px;';
    const txt = typeof t === 'function' ? (t(labelKey) || defaultText) : defaultText;
    h.textContent = txt;
    return h;
  };

  const makeDivider = () => {
    const d = document.createElement('div');
    d.className = 'ctx-divider';
    d.style.cssText = 'height: 1px; background: var(--card-border); margin: 3px 0;';
    return d;
  };

  // Format section
  menu.appendChild(makeHeader('editor.formatting', 'Formatage'));
  menu.appendChild(makeBtn('<b>B</b>', 'editor.bold', 'Gras', () => formatRichText('bold'), 'editor.boldTooltip', 'Mettre la sélection en gras avec la syntaxe Markdown'));
  menu.appendChild(makeBtn('<i>I</i>', 'editor.italic', 'Italique', () => formatRichText('italic'), 'editor.italicTooltip', 'Mettre la sélection en italique avec la syntaxe Markdown'));
  menu.appendChild(makeBtn('<u>U</u>', 'editor.underline', 'Souligné', () => formatRichText('underline'), 'editor.underlineTooltip', 'Souligner le texte sélectionné'));
  menu.appendChild(makeBtn('<s>S</s>', 'editor.strike', 'Barré', () => formatRichText('strike'), 'editor.strikeTooltip', 'Barrer la sélection avec la syntaxe Markdown'));
  menu.appendChild(makeBtn('🖍️', 'editor.highlightText', 'Surligner', () => formatRichText('mark'), 'editor.highlightTextTooltip', 'Surligner le texte sélectionné'));
  menu.appendChild(makeBtn('`', 'editor.code', 'Code en ligne', () => formatRichText('code'), 'editor.codeTooltip', 'Formater la sélection en code en ligne'));
  menu.appendChild(makeBtn('<i>fx</i>', 'editor.math', 'Formule', () => formatRichText('math'), 'editor.mathTooltip', 'Insérer une formule mathématique LaTeX'));

  menu.appendChild(makeDivider());
  menu.appendChild(makeHeader('editor.structure', 'Structure'));
  menu.appendChild(makeBtn('H1', 'editor.h1', 'Titre 1', () => formatRichText('h1set'), 'editor.h1Tooltip', 'Formater la ligne comme titre de niveau 1'));
  menu.appendChild(makeBtn('H2', 'editor.h2', 'Titre 2', () => formatRichText('h2set'), 'editor.h2Tooltip', 'Formater la ligne comme titre de niveau 2'));
  menu.appendChild(makeBtn('H3', 'editor.h3', 'Titre 3', () => formatRichText('h3'), 'editor.h3Tooltip', 'Formater la ligne comme titre de niveau 3'));
  menu.appendChild(makeBtn('•', 'editor.ul', 'Liste à puces', () => formatRichText('ul'), 'editor.ulTooltip', 'Formater la ligne comme liste à puces'));
  menu.appendChild(makeBtn('1.', 'editor.ol', 'Liste numérotée', () => formatRichText('ol'), 'editor.olTooltip', 'Formater la ligne comme liste numérotée'));
  menu.appendChild(makeBtn('☑', 'editor.checklist', 'Checklist', () => formatRichText('checklist'), 'editor.checklistTooltip', 'Insérer un élément de checklist'));
  menu.appendChild(makeBtn('💬', 'editor.blockquote', 'Citation', () => formatRichText('blockquote'), 'editor.blockquoteTooltip', 'Insérer une citation en retrait'));

  if (typeof generateNoteSummaryWithAI === 'function') {
    menu.appendChild(makeDivider());
    menu.appendChild(makeHeader('editor.aiAndAssistants', 'IA & Assistants'));
    menu.appendChild(makeBtn('🤖', 'editor.aiSummary', 'Générer résumé IA', () => generateNoteSummaryWithAI(), 'editor.aiSummaryTooltip', 'Générer un résumé de la note avec l\'IA'));
  }

  document.body.appendChild(menu);

  // Position calculation with window boundary check
  const rect = menu.getBoundingClientRect();
  let top = event.pageY;
  let left = event.pageX;

  if (left + rect.width > window.innerWidth - 10) {
    left = Math.max(10, window.innerWidth - rect.width - 15);
  }
  if (top + rect.height > window.innerHeight + window.scrollY - 10) {
    top = Math.max(10, event.pageY - rect.height);
  }

  menu.style.top = top + 'px';
  menu.style.left = left + 'px';

  _editorContextMenu = menu;

  setTimeout(() => {
    document.addEventListener('click', _dismissEditorContextMenu);
    document.addEventListener('mousedown', _dismissEditorContextMenu);
    document.addEventListener('keydown', _escEditorContextMenu);
  }, 0);
}

if (typeof window !== 'undefined') {
  window.showEditorContextMenu = showEditorContextMenu;
  window.closeEditorContextMenu = closeEditorContextMenu;
}

// ═══ Floating Selection Format Toolbar & Rich Typing Shortcuts ═══
let _floatingFormatToolbar = null;

function hideFloatingFormatToolbar() {
  if (_floatingFormatToolbar) {
    _floatingFormatToolbar.style.opacity = '0';
    _floatingFormatToolbar.style.pointerEvents = 'none';
    setTimeout(() => {
      if (_floatingFormatToolbar && _floatingFormatToolbar.style.opacity === '0') {
        _floatingFormatToolbar.remove();
        _floatingFormatToolbar = null;
      }
    }, 150);
  }
}

function updateFloatingFormatToolbarPosition(targetEditor) {
  if (!_floatingFormatToolbar) return;
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount || selection.isCollapsed) {
    hideFloatingFormatToolbar();
    return;
  }
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    hideFloatingFormatToolbar();
    return;
  }

  const tbRect = _floatingFormatToolbar.getBoundingClientRect();
  let top = rect.top + window.scrollY - tbRect.height - 8;
  let left = rect.left + window.scrollX + (rect.width / 2) - (tbRect.width / 2);

  // If top is offscreen above viewport, position below selection
  if (top < window.scrollY + 8) {
    top = rect.bottom + window.scrollY + 8;
  }

  // Horizontal screen boundary safety
  if (left < 8) left = 8;
  if (left + tbRect.width > window.innerWidth - 8) {
    left = window.innerWidth - tbRect.width - 8;
  }

  _floatingFormatToolbar.style.top = `${top}px`;
  _floatingFormatToolbar.style.left = `${left}px`;
  _floatingFormatToolbar.style.opacity = '1';
  _floatingFormatToolbar.style.pointerEvents = 'auto';
}

function showFloatingFormatToolbarForSelection(targetEditor) {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount || selection.isCollapsed) {
    hideFloatingFormatToolbar();
    return;
  }

  const text = selection.toString().trim();
  if (!text) {
    hideFloatingFormatToolbar();
    return;
  }

  const range = selection.getRangeAt(0);
  if (!targetEditor || !targetEditor.contains(range.commonAncestorContainer)) {
    hideFloatingFormatToolbar();
    return;
  }

  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    hideFloatingFormatToolbar();
    return;
  }

  if (!_floatingFormatToolbar) {
    _floatingFormatToolbar = document.createElement('div');
    _floatingFormatToolbar.className = 'floating-format-toolbar';
    _floatingFormatToolbar.setAttribute('contenteditable', 'false');
    document.body.appendChild(_floatingFormatToolbar);
  }

  const makeBtn = (icon, labelKey, fallbackTitle, action) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'floating-fmt-btn';
    btn.innerHTML = icon;
    const titleText = (typeof t === 'function' ? t(labelKey) : '') || fallbackTitle;
    btn.title = titleText;
    btn.setAttribute('aria-label', titleText);
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      action();
      updateFloatingFormatToolbarPosition(targetEditor);
    });
    return btn;
  };

  _floatingFormatToolbar.innerHTML = '';
  _floatingFormatToolbar.appendChild(makeBtn('<b>B</b>', 'editor.boldTooltip', 'Bold', () => formatRichTextInEditor(targetEditor, 'bold')));
  _floatingFormatToolbar.appendChild(makeBtn('<i>I</i>', 'editor.italicTooltip', 'Italic', () => formatRichTextInEditor(targetEditor, 'italic')));
  _floatingFormatToolbar.appendChild(makeBtn('<u>U</u>', 'editor.underlineTooltip', 'Underline', () => formatRichTextInEditor(targetEditor, 'underline')));
  _floatingFormatToolbar.appendChild(makeBtn('<s>S</s>', 'editor.strikeTooltip', 'Strikethrough', () => formatRichTextInEditor(targetEditor, 'strike')));
  _floatingFormatToolbar.appendChild(makeBtn('🖍️', 'editor.highlightTextTooltip', 'Highlight', () => formatRichTextInEditor(targetEditor, 'mark')));
  _floatingFormatToolbar.appendChild(makeBtn('`', 'editor.codeTooltip', 'Code', () => formatRichTextInEditor(targetEditor, 'code')));
  _floatingFormatToolbar.appendChild(makeBtn('📋', 'editor.addTodoBtn', 'Create Todo', () => toggleTodoPriority('Medium')));
  _floatingFormatToolbar.appendChild(makeBtn('<i>fx</i>', 'editor.mathTooltip', 'Formula', () => formatRichTextInEditor(targetEditor, 'math')));
  _floatingFormatToolbar.appendChild(makeBtn('🔗', 'editor.linkTooltip', 'Link', () => formatRichTextInEditor(targetEditor, 'link')));

  const sep1 = document.createElement('span');
  sep1.className = 'floating-fmt-sep';
  _floatingFormatToolbar.appendChild(sep1);

  _floatingFormatToolbar.appendChild(makeBtn('H1', 'editor.h1Tooltip', 'Heading 1', () => formatRichTextInEditor(targetEditor, 'h1')));
  _floatingFormatToolbar.appendChild(makeBtn('H2', 'editor.h2Tooltip', 'Heading 2', () => formatRichTextInEditor(targetEditor, 'h2')));
  _floatingFormatToolbar.appendChild(makeBtn('H3', 'editor.h3Tooltip', 'Heading 3', () => formatRichTextInEditor(targetEditor, 'h3')));
  _floatingFormatToolbar.appendChild(makeBtn('•', 'editor.ulTooltip', 'Bullet List', () => formatRichTextInEditor(targetEditor, 'ul')));
  _floatingFormatToolbar.appendChild(makeBtn('1.', 'editor.olTooltip', 'Numbered List', () => formatRichTextInEditor(targetEditor, 'ol')));

  const sep2 = document.createElement('span');
  sep2.className = 'floating-fmt-sep';
  _floatingFormatToolbar.appendChild(sep2);

  _floatingFormatToolbar.appendChild(makeBtn('🧹', 'editor.clearFormattingTooltip', 'Clear Formatting', () => formatRichTextInEditor(targetEditor, 'clear')));

  updateFloatingFormatToolbarPosition(targetEditor);
}

document.addEventListener('mousedown', (e) => {
  if (_floatingFormatToolbar && !_floatingFormatToolbar.contains(e.target)) {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      hideFloatingFormatToolbar();
    }
  }
});

async function formatRichTextInEditor(editorEl, cmd) {
  if (!editorEl) return;
  _lastFocusedEditor = editorEl;
  editorEl.focus();

  if (editorEl.id === 'edit-summary') {
    if (cmd === 'h3' || cmd === 'link' || cmd === 'table' || cmd === 'checklist') {
      if (typeof toast === 'function') {
        toast(typeof t === 'function' ? (t('summary.unauthorizedAction') || "Action non autorisée dans le résumé.") : "Action non autorisée dans le résumé.", true);
      }
      return;
    }
  }

  const range = _getEditorSelectionRange(editorEl);
  const hasSelectionText = _isRangeWithText(range);

  const inlineRemoveSelectorByCmd = {
    bold: 'strong, b',
    italic: 'em, i',
    underline: 'u',
    strike: 'strike, s, del',
    mark: 'mark',
    code: 'code'
  };

  if (cmd in inlineRemoveSelectorByCmd) {
    if (hasSelectionText) {
      const selector = inlineRemoveSelectorByCmd[cmd];
      const alreadyFormatted = _selectionHasInlineFormat(editorEl, selector, range);
      if (alreadyFormatted) {
        _removeInlineTagFromSelection(editorEl, selector, range);
      } else if (cmd === 'bold') {
        document.execCommand('bold', false);
      } else if (cmd === 'italic') {
        document.execCommand('italic', false);
      } else if (cmd === 'underline') {
        document.execCommand('underline', false);
      } else if (cmd === 'strike') {
        document.execCommand('strikeThrough', false);
      } else if (cmd === 'mark') {
        wrapSelectionInTag('mark');
      } else if (cmd === 'code') {
        wrapSelectionInTag('code');
      }
    } else if (cmd === 'bold') {
      document.execCommand('bold', false);
    } else if (cmd === 'italic') {
      document.execCommand('italic', false);
    } else if (cmd === 'underline') {
      document.execCommand('underline', false);
    } else if (cmd === 'strike') {
      document.execCommand('strikeThrough', false);
    } else if (cmd === 'mark') {
      const markNode = getSelectionTagNode('mark');
      if (markNode) {
        let nextSibling = markNode.nextSibling;
        if (!nextSibling || nextSibling.nodeType !== Node.TEXT_NODE) {
          nextSibling = document.createTextNode('\u200B');
          markNode.parentNode.insertBefore(nextSibling, markNode.nextSibling);
        }
        const newRange = document.createRange();
        const targetOffset = (nextSibling.nodeValue && nextSibling.nodeValue.startsWith('\u200B')) ? 1 : 0;
        newRange.setStart(nextSibling, Math.min(targetOffset, nextSibling.length));
        newRange.collapse(true);
        const sel = window.getSelection();
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(newRange);
        }
      } else {
        wrapSelectionInTag('mark');
      }
    } else if (cmd === 'code') {
      const codeNode = getSelectionTagNode('code');
      if (codeNode) {
        let nextSibling = codeNode.nextSibling;
        if (!nextSibling || nextSibling.nodeType !== Node.TEXT_NODE) {
          nextSibling = document.createTextNode('\u200B');
          codeNode.parentNode.insertBefore(nextSibling, codeNode.nextSibling);
        }
        const newRange = document.createRange();
        const targetOffset = (nextSibling.nodeValue && nextSibling.nodeValue.startsWith('\u200B')) ? 1 : 0;
        newRange.setStart(nextSibling, Math.min(targetOffset, nextSibling.length));
        newRange.collapse(true);
        const sel = window.getSelection();
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(newRange);
        }
      } else {
        wrapSelectionInTag('code');
      }
    }

    editorEl.dispatchEvent(new Event('input', { bubbles: true }));
    if (typeof updateToolbarActiveStates === 'function') updateToolbarActiveStates();
    return;
  }

  if (cmd === 'h1' || cmd === 'h1set') {
    if (isSelectionInTag('h1')) {
      document.execCommand('formatBlock', false, '<p>');
    } else {
      document.execCommand('formatBlock', false, '<h1>');
      cleanHeaderFormatting('h1');
    }
  } else if (cmd === 'h2' || cmd === 'h2set') {
    if (isSelectionInTag('h2')) {
      document.execCommand('formatBlock', false, '<p>');
    } else {
      document.execCommand('formatBlock', false, '<h2>');
      cleanHeaderFormatting('h2');
    }
  } else if (cmd === 'h3') {
    if (isSelectionInTag('h3')) {
      document.execCommand('formatBlock', false, '<p>');
    } else {
      document.execCommand('formatBlock', false, '<h3>');
      cleanHeaderFormatting('h3');
    }
  } else if (cmd === 'p' || cmd === 'body') {
    document.execCommand('formatBlock', false, '<p>');
  } else if (cmd === 'ul') {
    document.execCommand('insertUnorderedList', false);
  } else if (cmd === 'ol') {
    document.execCommand('insertOrderedList', false);
  } else if (cmd === 'blockquote') {
    if (isSelectionInTag('blockquote')) {
      document.execCommand('formatBlock', false, '<p>');
    } else {
      document.execCommand('formatBlock', false, '<blockquote>');
    }
  } else if (cmd === 'math') {
    if (typeof openMathFormulaEditor === 'function') openMathFormulaEditor(null, editorEl);
    return;
  } else if (cmd === 'link') {
    const selection = window.getSelection();
    let savedRange = null;
    let selectedText = '';
    if (selection && selection.rangeCount > 0 && editorEl.contains(selection.anchorNode)) {
      savedRange = selection.getRangeAt(0).cloneRange();
      selectedText = selection.toString();
    }
    const url = await showPromptDialog(typeof t === 'function' ? t('prompt.enterUrl') || 'Enter URL:' : 'Enter URL:', 'https://');
    if (url && url.trim()) {
      editorEl.focus();
      if (savedRange) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(savedRange);
      }
      let finalUrl = url.trim();
      if (/^www\./i.test(finalUrl)) finalUrl = 'https://' + finalUrl;
      const textToUse = selectedText || finalUrl;
      const anchorHtml = `<a href="${escA(finalUrl)}" target="_blank" rel="noopener noreferrer">${escH(textToUse)}</a>`;
      document.execCommand('insertHTML', false, anchorHtml);
      editorEl.dispatchEvent(new Event('input', { bubbles: true }));
      if (typeof updateToolbarActiveStates === 'function') updateToolbarActiveStates();
    }
    return;
  } else if (cmd === 'hr') {
    document.execCommand('insertHorizontalRule', false);
  } else if (cmd === 'checklist') {
    if (typeof isSelectionInChecklist === 'function' && isSelectionInChecklist()) {
      if (typeof removeChecklistItemRichText === 'function') removeChecklistItemRichText();
    } else if (typeof insertChecklistItemRichText === 'function') {
      insertChecklistItemRichText();
    }
  } else if (cmd === 'codeblock') {
    if (typeof wrapSelectionInCodeBlock === 'function') wrapSelectionInCodeBlock();
  } else if (cmd === 'table') {
    if (typeof insertTableRichText === 'function') insertTableRichText();
  } else if (cmd === 'clear') {
    document.execCommand('removeFormat', false);
    document.execCommand('formatBlock', false, '<p>');

    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const marks = editorEl.querySelectorAll('mark, code');
      marks.forEach(m => {
        if (range.intersectsNode ? range.intersectsNode(m) : (selection.containsNode && selection.containsNode(m, true))) {
          const textNode = document.createTextNode(m.textContent);
          m.parentNode.replaceChild(textNode, m);
        }
      });
    }
  }

  editorEl.dispatchEvent(new Event('input', { bubbles: true }));
  if (typeof updateToolbarActiveStates === 'function') updateToolbarActiveStates();
}

function resolveLiFromBoundary(node, offset) {
  if (!node) return null;
  const base = node.nodeType === Node.TEXT_NODE ? node.parentNode : node;
  if (!base) return null;

  if (base.closest) {
    const direct = base.closest('li');
    if (direct) return direct;
  }

  if (base.nodeType === Node.ELEMENT_NODE && /^(UL|OL)$/.test(base.tagName)) {
    const candidate = base.childNodes[offset] || base.childNodes[offset - 1] || null;
    if (candidate && candidate.nodeType === Node.ELEMENT_NODE) {
      if (candidate.tagName === 'LI') return candidate;
      if (candidate.closest) {
        const li = candidate.closest('li');
        if (li) return li;
      }
    }
  }
  return null;
}

function collectSelectedListItems(selection, editorEl) {
  const items = [];
  if (!selection || !selection.rangeCount) return items;

  if (selection.isCollapsed) {
    const singleLi = resolveLiFromBoundary(selection.anchorNode, selection.anchorOffset)
      || resolveLiFromBoundary(selection.focusNode, selection.focusOffset);
    if (singleLi && editorEl.contains(singleLi)) {
      items.push(singleLi);
    }
    return items;
  }

  const range = selection.getRangeAt(0);
  const allLis = Array.from(editorEl.querySelectorAll('li'));
  for (const li of allLis) {
    try {
      if (range.intersectsNode(li)) items.push(li);
    } catch (_) {}
  }

  if (!items.length) return items;
  const itemSet = new Set(items);
  return items.filter(li => {
    const parentLi = li.parentElement ? li.parentElement.closest('li') : null;
    return !(parentLi && itemSet.has(parentLi));
  });
}

function getFirstTextNode(node) {
  if (!node) return null;
  if (node.nodeType === Node.TEXT_NODE) return node;
  for (const child of node.childNodes) {
    if (child.nodeType === Node.ELEMENT_NODE && /^(UL|OL)$/.test(child.tagName)) continue;
    const found = getFirstTextNode(child);
    if (found) return found;
  }
  return null;
}

function getLastDeepNode(node) {
  if (!node) return null;
  if (node.nodeType === Node.TEXT_NODE) return node;
  const nonListChildren = Array.from(node.childNodes).filter(c => !(c.nodeType === Node.ELEMENT_NODE && /^(UL|OL)$/.test(c.tagName)));
  if (nonListChildren.length === 0) return node;
  const lastChild = nonListChildren[nonListChildren.length - 1];
  return getLastDeepNode(lastChild);
}

function restoreCaretInLi(li, atStart = false) {
  if (!li) return;
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  
  if (atStart) {
    const firstTextNode = getFirstTextNode(li);
    if (firstTextNode) {
      range.setStart(firstTextNode, 0);
    } else {
      range.selectNodeContents(li);
    }
    range.collapse(true);
  } else {
    const lastNode = getLastDeepNode(li);
    if (lastNode) {
      if (lastNode.nodeType === Node.TEXT_NODE) {
        range.setStart(lastNode, lastNode.length);
      } else {
        range.selectNodeContents(lastNode);
        range.collapse(false);
      }
    } else {
      range.selectNodeContents(li);
      range.collapse(false);
    }
  }
  sel.removeAllRanges();
  sel.addRange(range);
}

function getCaretOffsetInLi(li) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !li.contains(sel.anchorNode)) return null;
  const range = sel.getRangeAt(0);
  
  let offset = 0;
  const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      let p = node.parentElement;
      while (p && p !== li) {
        if (/^(UL|OL)$/.test(p.tagName)) return NodeFilter.FILTER_REJECT;
        p = p.parentElement;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node === range.startContainer) {
      offset += Math.min(range.startOffset, node.length);
      break;
    } else {
      offset += node.length;
    }
  }
  return offset;
}

function setCaretOffsetInLi(li, offset) {
  if (offset === null || offset === undefined) {
    restoreCaretInLi(li);
    return;
  }
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  let current = 0;
  let set = false;
  
  const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      let p = node.parentElement;
      while (p && p !== li) {
        if (/^(UL|OL)$/.test(p.tagName)) return NodeFilter.FILTER_REJECT;
        p = p.parentElement;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (current + node.length >= offset) {
      range.setStart(node, Math.max(0, offset - current));
      range.collapse(true);
      set = true;
      break;
    }
    current += node.length;
  }
  
  if (!set) {
    restoreCaretInLi(li);
    return;
  }
  
  sel.removeAllRanges();
  sel.addRange(range);
}

function normalizeListStructure(container) {
  if (!container) return;

  // 1. Merge adjacent ULs/OLs of same type
  const lists = Array.from(container.querySelectorAll('ul, ol'));
  for (const list of lists) {
    if (!list.parentElement) continue;
    let next = list.nextElementSibling;
    while (next && next.tagName === list.tagName) {
      const siblingLis = Array.from(next.children);
      for (const child of siblingLis) {
        list.appendChild(child);
      }
      const toRemove = next;
      next = next.nextElementSibling;
      toRemove.remove();
    }
  }

  // 2. Unwrap <li> that contains only a sublist (ul/ol) and no direct text/inline content
  const lis = Array.from(container.querySelectorAll('li'));
  for (const li of lis) {
    if (!li.parentElement) continue;
    
    let hasOwnContent = false;
    for (const child of Array.from(li.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (child.textContent.replace(/[\s\u200B\u00A0]/g, '') !== '') {
          hasOwnContent = true;
          break;
        }
      } else if (child.nodeType === Node.ELEMENT_NODE && !/^(UL|OL)$/.test(child.tagName)) {
        if (child.tagName !== 'BR' || li.childNodes.length > 1) {
          hasOwnContent = true;
          break;
        }
      }
    }

    const sublists = Array.from(li.children).filter(c => /^(UL|OL)$/.test(c.tagName));
    if (!hasOwnContent && sublists.length === 1 && li.children.length === 1) {
      const sublist = sublists[0];
      const parentList = li.parentElement;
      while (sublist.firstChild) {
        parentList.insertBefore(sublist.firstChild, li);
      }
      li.remove();
    }
  }

  // 3. Clean lead bullet markers inside <li> text
  const allLis = Array.from(container.querySelectorAll('li'));
  for (const li of allLis) {
    if (li.querySelector('ul, ol')) continue;
    const firstTextNode = getFirstTextNode(li);
    if (firstTextNode && firstTextNode.nodeValue) {
      const text = firstTextNode.nodeValue;
      const cleaned = text.replace(/^[\s\u200B\u00A0]*([*+\-•]|(\d+|[a-zA-Z]+|[ivxlcdmIVXLCDM]+)[.)])\s+/, '');
      if (cleaned !== text) {
        firstTextNode.nodeValue = cleaned;
      }
    }
  }
}

function insertTextIntoListItem(li, text, editorEl) {
  const lines = text.split(/\r?\n/);
  const cleanLine0 = lines[0].replace(/^[\s\u200B\u00A0]*([*+\-•]|(\d+|[a-zA-Z]+|[ivxlcdmIVXLCDM]+)[.)])\s+/, '');
  
  if (lines.length === 1) {
    document.execCommand('insertText', false, cleanLine0);
    return;
  }

  if (cleanLine0) {
    document.execCommand('insertText', false, cleanLine0);
  }
  
  let currentLi = li;
  const parentList = li.parentElement;
  
  for (let i = 1; i < lines.length; i++) {
    let lineStr = lines[i].trim();
    if (!lineStr && i === lines.length - 1) continue;
    lineStr = lineStr.replace(/^[\s\u200B\u00A0]*([*+\-•]|(\d+|[a-zA-Z]+|[ivxlcdmIVXLCDM]+)[.)])\s+/, '');
    
    const newLi = document.createElement('li');
    if (lineStr) newLi.textContent = lineStr;
    else newLi.innerHTML = '<br>';
    
    parentList.insertBefore(newLi, currentLi.nextSibling);
    currentLi = newLi;
  }
  
  restoreCaretInLi(currentLi);
}

function insertHTMLIntoListItem(li, htmlString, editorEl) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, 'text/html');
  const pastedLis = Array.from(doc.body.querySelectorAll('li'));
  
  if (pastedLis.length === 0) {
    document.execCommand('insertHTML', false, htmlString);
    return;
  }

  for (const pLi of pastedLis) {
    const firstTextNode = getFirstTextNode(pLi);
    if (firstTextNode && firstTextNode.nodeValue) {
      firstTextNode.nodeValue = firstTextNode.nodeValue.replace(/^[\s\u200B\u00A0]*([*+\-•]|(\d+|[a-zA-Z]+|[ivxlcdmIVXLCDM]+)[.)])\s+/, '');
    }
  }

  const textOnly = li.cloneNode(true);
  const childLists = textOnly.querySelectorAll('ul, ol');
  childLists.forEach(cl => cl.remove());
  const isTargetLiEmpty = textOnly.textContent.replace(/[\s\u200B\u00A0]/g, '') === '';
  const parentList = li.parentElement;

  if (isTargetLiEmpty) {
    let refNode = li;
    let lastInserted = null;
    for (const pLi of pastedLis) {
      const newLi = document.createElement('li');
      newLi.innerHTML = pLi.innerHTML;
      parentList.insertBefore(newLi, refNode.nextSibling);
      refNode = newLi;
      lastInserted = newLi;
    }
    li.remove();
    if (lastInserted) restoreCaretInLi(lastInserted);
  } else {
    if (pastedLis.length === 1) {
      document.execCommand('insertHTML', false, pastedLis[0].innerHTML);
    } else {
      let refNode = li;
      let lastInserted = null;
      for (let i = 0; i < pastedLis.length; i++) {
        const pLi = pastedLis[i];
        if (i === 0) {
          document.execCommand('insertHTML', false, pLi.innerHTML);
        } else {
          const newLi = document.createElement('li');
          newLi.innerHTML = pLi.innerHTML;
          parentList.insertBefore(newLi, refNode.nextSibling);
          refNode = newLi;
          lastInserted = newLi;
        }
      }
      if (lastInserted) restoreCaretInLi(lastInserted);
    }
  }
}

function checkAndConvertBlockPrefix(container, offset, editorEl, selection) {
  if (!container || container.nodeType !== Node.TEXT_NODE) return false;
  const text = container.textContent;
  const beforeCursor = text.substring(0, offset).trim();

  // Check if container is inside a list item already
  const parentLi = container.parentElement ? container.parentElement.closest('li') : null;
  if (parentLi) return false;

  let block = container.parentElement;
  while (block && block !== editorEl && !/^(P|DIV|H1|H2|H3|H4|H5|H6|LI|BLOCKQUOTE)$/i.test(block.tagName)) {
    block = block.parentElement;
  }

  const isBullet = beforeCursor === '*' || beforeCursor === '-' || beforeCursor === '+' || beforeCursor === '•';
  const isNumeric = /^(\d+)[.)]$/.test(beforeCursor);
  const isAlpha = /^([a-zA-Z]+)[.)]$/.test(beforeCursor);
  const isChecklist = beforeCursor === '[]' || beforeCursor === '[ ]' || beforeCursor === '[x]' || beforeCursor === '[X]';
  const isH1 = beforeCursor === '#';
  const isH2 = beforeCursor === '##';
  const isH3 = beforeCursor === '###';
  const isH4 = beforeCursor === '####';
  const isQuote = beforeCursor === '>';

  if (isBullet || isNumeric || isAlpha || isChecklist || isH1 || isH2 || isH3 || isH4 || isQuote) {
    const remainingText = text.substring(offset).replace(/^[\s\u00A0]+/, '');

    if (isChecklist) {
      const isChecked = beforeCursor.includes('x') || beforeCursor.includes('X');
      const ul = document.createElement('ul');
      ul.style.listStyleType = 'none';
      ul.style.paddingLeft = '1.2rem';

      const li = document.createElement('li');
      li.style.listStyleType = 'none';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.style.marginRight = '6px';
      checkbox.style.verticalAlign = 'middle';
      if (isChecked) checkbox.checked = true;

      li.appendChild(checkbox);
      if (remainingText) {
        li.appendChild(document.createTextNode(remainingText));
      } else {
        li.appendChild(document.createTextNode(' '));
      }
      ul.appendChild(li);

      if (block && block !== editorEl && !/^(H1|H2|H3|H4|H5|H6|LI)$/i.test(block.tagName)) {
        block.parentNode.replaceChild(ul, block);
      } else {
        container.textContent = '';
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          range.deleteContents();
          range.insertNode(ul);
        }
      }

      restoreCaretInLi(li, true);
      editorEl.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    } else if (isBullet || isNumeric || isAlpha) {
      const listTag = isBullet ? 'ul' : 'ol';
      const listEl = document.createElement(listTag);
      if (isAlpha) {
        const firstChar = beforeCursor[0];
        listEl.setAttribute('type', firstChar === firstChar.toUpperCase() ? 'A' : 'a');
      } else if (isNumeric) {
        listEl.setAttribute('type', '1');
      }
      const liEl = document.createElement('li');

      if (block && block !== editorEl && !/^(H1|H2|H3|H4|H5|H6|LI)$/i.test(block.tagName)) {
        if (remainingText) liEl.textContent = remainingText;
        else liEl.innerHTML = '<br>';
        listEl.appendChild(liEl);
        block.parentNode.replaceChild(listEl, block);
      } else {
        container.textContent = remainingText;
        if (remainingText) liEl.textContent = remainingText;
        else liEl.innerHTML = '<br>';
        listEl.appendChild(liEl);
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          range.deleteContents();
          range.insertNode(listEl);
        }
      }

      normalizeListStructure(editorEl);
      restoreCaretInLi(liEl, true);
      editorEl.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    } else if (isH1 || isH2 || isH3 || isH4 || isQuote) {
      const tag = isH1 ? 'h1' : (isH2 ? 'h2' : (isH3 ? 'h3' : (isH4 ? 'h4' : 'blockquote')));
      const newBlock = document.createElement(tag);

      if (block && block !== editorEl) {
        if (!remainingText) newBlock.innerHTML = '<br>';
        else newBlock.textContent = remainingText;
        block.parentNode.replaceChild(newBlock, block);
      } else {
        container.textContent = remainingText;
        if (!remainingText) newBlock.innerHTML = '<br>';
        else newBlock.textContent = remainingText;
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          range.deleteContents();
          range.insertNode(newBlock);
        }
      }

      const newRange = document.createRange();
      if (newBlock.firstChild && newBlock.firstChild.nodeType === Node.TEXT_NODE) {
        newRange.setStart(newBlock.firstChild, 0);
      } else {
        newRange.selectNodeContents(newBlock);
      }
      newRange.collapse(true);
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(newRange);
      }
      editorEl.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
  }
  return false;
}

function indentListItem(li) {
  if (!li || !li.parentElement) return false;
  const listEl = li.parentElement;
  if (!listEl || !/^(UL|OL)$/.test(listEl.tagName)) return false;

  const prevLi = li.previousElementSibling;
  if (prevLi && prevLi.tagName === 'LI') {
    let nestedList = null;
    for (let i = 0; i < prevLi.children.length; i++) {
      const child = prevLi.children[i];
      if (child && child.tagName === listEl.tagName) {
        nestedList = child;
        break;
      }
    }

    if (!nestedList) {
      nestedList = document.createElement(listEl.tagName.toLowerCase());
      if (listEl.hasAttribute('type')) nestedList.setAttribute('type', listEl.getAttribute('type'));
      prevLi.appendChild(nestedList);
    }

    nestedList.appendChild(li);
    return true;
  } else {
    const wrapperLi = document.createElement('li');
    wrapperLi.style.listStyleType = 'none';
    const nestedList = document.createElement(listEl.tagName.toLowerCase());
    if (listEl.hasAttribute('type')) nestedList.setAttribute('type', listEl.getAttribute('type'));
    wrapperLi.appendChild(nestedList);
    listEl.insertBefore(wrapperLi, li);
    nestedList.appendChild(li);
    return true;
  }
}

function outdentListItem(li, editorEl) {
  if (!li || !li.parentElement) return false;
  const listEl = li.parentElement;
  if (!listEl || !/^(UL|OL)$/.test(listEl.tagName)) return false;

  const parentLi = listEl.parentElement && listEl.parentElement.tagName === 'LI'
    ? listEl.parentElement
    : null;

  if (parentLi && parentLi.parentElement) {
    const outerList = parentLi.parentElement;
    if (!/^(UL|OL)$/.test(outerList.tagName)) return false;

    // Collect trailing siblings in nested list to preserve outline hierarchy
    const trailingSiblings = [];
    let nextSib = li.nextElementSibling;
    while (nextSib) {
      trailingSiblings.push(nextSib);
      nextSib = nextSib.nextElementSibling;
    }

    // Place li immediately after parentLi in outer list
    outerList.insertBefore(li, parentLi.nextSibling);

    // If there were trailing siblings, nest them under li so visual order is preserved
    if (trailingSiblings.length > 0) {
      let liSublist = null;
      for (let i = 0; i < li.children.length; i++) {
        const child = li.children[i];
        if (child && child.tagName === listEl.tagName) {
          liSublist = child;
          break;
        }
      }
      if (!liSublist) {
        liSublist = document.createElement(listEl.tagName.toLowerCase());
        li.appendChild(liSublist);
      }
      for (const sib of trailingSiblings) {
        liSublist.appendChild(sib);
      }
    }

    // Remove empty parent sublist if needed
    let hasLi = false;
    for (let i = 0; i < listEl.children.length; i++) {
      if (listEl.children[i].tagName === 'LI') {
        hasLi = true;
        break;
      }
    }
    if (!hasLi) {
      listEl.remove();
    }

    restoreCaretInLi(li);
    return true;
  } else {
    // Root level outdent -> convert to paragraph <p>
    const p = document.createElement('p');

    // Extract any nested sublists inside li
    const sublists = [];
    const childNodes = Array.from(li.childNodes);
    for (const child of childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE && /^(UL|OL)$/.test(child.tagName)) {
        sublists.push(child);
        child.remove();
      } else {
        p.appendChild(child);
      }
    }

    if (!p.textContent.trim() && p.children.length === 0) {
      p.innerHTML = '<br>';
    }

    // Collect following sibling LIs
    const nextLis = [];
    let nextLi = li.nextElementSibling;
    while (nextLi) {
      nextLis.push(nextLi);
      nextLi = nextLi.nextElementSibling;
    }

    const listParent = listEl.parentNode;
    if (!listParent) return false;

    // Insert p after listEl
    listParent.insertBefore(p, listEl.nextSibling);
    let insertRef = p;

    // Insert sublists that were inside li
    for (const sub of sublists) {
      listParent.insertBefore(sub, insertRef.nextSibling);
      insertRef = sub;
    }

    // Move following sibling LIs to a new list
    if (nextLis.length > 0) {
      const newList = document.createElement(listEl.tagName.toLowerCase());
      for (const sib of nextLis) {
        newList.appendChild(sib);
      }
      listParent.insertBefore(newList, insertRef.nextSibling);
    }

    // Remove li
    li.remove();

    // Remove empty listEl
    let hasLi = false;
    for (let i = 0; i < listEl.children.length; i++) {
      if (listEl.children[i].tagName === 'LI') {
        hasLi = true;
        break;
      }
    }
    if (!hasLi) {
      listEl.remove();
    }

    // Place caret in p
    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      if (p.firstChild) {
        range.setStart(p.firstChild, 0);
      } else {
        range.selectNodeContents(p);
      }
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }

    return true;
  }
}

function handleRichTextInputShortcuts(e, editorEl) {
  if (!editorEl || !editorEl.isContentEditable) return false;
  if (e.defaultPrevented) return true;
  const key = e.key;

  if (key === 'Backspace' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const selection = window.getSelection();
    if (selection && selection.isCollapsed && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const li = resolveLiFromBoundary(range.startContainer, range.startOffset);
      if (li && editorEl.contains(li)) {
        const caretOffset = getCaretOffsetInLi(li);
        if (caretOffset === 0) {
          e.preventDefault();
          outdentListItem(li, editorEl);
          normalizeListStructure(editorEl);
          editorEl.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        }
      }
    }
  }

  if (key === 'ArrowRight' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
    const selection = window.getSelection();
    if (selection && selection.isCollapsed && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const node = range.startContainer;
      const mark = node.nodeType === Node.TEXT_NODE ? (node.parentNode ? node.parentNode.closest('mark, code') : null) : (node.closest ? node.closest('mark, code') : null);
      if (mark && editorEl.contains(mark)) {
        const markRange = document.createRange();
        markRange.selectNodeContents(mark);
        if (range.compareBoundaryPoints(Range.END_TO_END, markRange) >= 0) {
          e.preventDefault();
          let nextSibling = mark.nextSibling;
          if (!nextSibling || nextSibling.nodeType !== Node.TEXT_NODE) {
            nextSibling = document.createTextNode('\u200B');
            mark.parentNode.insertBefore(nextSibling, mark.nextSibling);
          }
          const newRange = document.createRange();
          const targetOffset = (nextSibling.nodeValue && nextSibling.nodeValue.startsWith('\u200B')) ? 1 : 0;
          newRange.setStart(nextSibling, Math.min(targetOffset, nextSibling.length));
          newRange.collapse(true);
          selection.removeAllRanges();
          selection.addRange(newRange);
          if (typeof updateToolbarActiveStates === 'function') updateToolbarActiveStates();
          return true;
        }
      }
    }
  }

  if (key === 'ArrowLeft' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
    const selection = window.getSelection();
    if (selection && selection.isCollapsed && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const node = range.startContainer;
      const mark = node.nodeType === Node.TEXT_NODE ? (node.parentNode ? node.parentNode.closest('mark, code') : null) : (node.closest ? node.closest('mark, code') : null);
      if (mark && editorEl.contains(mark)) {
        const markRange = document.createRange();
        markRange.selectNodeContents(mark);
        if (range.compareBoundaryPoints(Range.START_TO_START, markRange) <= 0) {
          e.preventDefault();
          let prevSibling = mark.previousSibling;
          if (!prevSibling || prevSibling.nodeType !== Node.TEXT_NODE) {
            prevSibling = document.createTextNode('\u200B');
            mark.parentNode.insertBefore(prevSibling, mark);
          }
          const newRange = document.createRange();
          const targetOffset = (prevSibling.nodeValue && prevSibling.nodeValue.endsWith('\u200B')) ? Math.max(0, prevSibling.length - 1) : prevSibling.length;
          newRange.setStart(prevSibling, targetOffset);
          newRange.collapse(true);
          selection.removeAllRanges();
          selection.addRange(newRange);
          if (typeof updateToolbarActiveStates === 'function') updateToolbarActiveStates();
          return true;
        }
      }
    }
  }

  if (key === 'Tab') {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);

      // 1. Table cell navigation
      let tableNode = range.commonAncestorContainer;
      if (tableNode.nodeType === Node.TEXT_NODE) tableNode = tableNode.parentNode;
      const cell = tableNode ? tableNode.closest('td, th') : null;
      if (cell && editorEl.contains(cell)) {
        e.preventDefault();
        const table = cell.closest('table');
        if (table) {
          const cells = Array.from(table.querySelectorAll('th, td'));
          const idx = cells.indexOf(cell);
          if (!e.shiftKey) {
            if (idx < cells.length - 1) {
              const nextCell = cells[idx + 1];
              const r = document.createRange();
              r.selectNodeContents(nextCell);
              r.collapse(true);
              selection.removeAllRanges();
              selection.addRange(r);
              nextCell.focus();
            } else if (typeof tableAddRow === 'function') {
              tableAddRow(cell, 'below');
            }
          } else {
            if (idx > 0) {
              const prevCell = cells[idx - 1];
              const r = document.createRange();
              r.selectNodeContents(prevCell);
              r.collapse(true);
              selection.removeAllRanges();
              selection.addRange(r);
              prevCell.focus();
            }
          }
          return true;
        }
      }

      // 2. Mention / delegation pills navigation
      const anchorParent = selection.anchorNode && selection.anchorNode.nodeType === Node.TEXT_NODE ? selection.anchorNode.parentNode : selection.anchorNode;
      const focusParent = selection.focusNode && selection.focusNode.nodeType === Node.TEXT_NODE ? selection.focusNode.parentNode : selection.focusNode;
      const mention = (anchorParent && anchorParent.closest ? anchorParent.closest('.pill-mention, .pill-delegation') : null)
        || (focusParent && focusParent.closest ? focusParent.closest('.pill-mention, .pill-delegation') : null);
      if (mention && editorEl.contains(mention)) {
        e.preventDefault();
        const newRange = document.createRange();
        newRange.setStartAfter(mention);
        newRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(newRange);
        return true;
      }

      // 3. List item indentation / outdentation
      const selectedLis = collectSelectedListItems(selection, editorEl);
      if (selectedLis.length > 0) {
        e.preventDefault();
        const lisInOrder = e.shiftKey ? selectedLis.slice().reverse() : selectedLis.slice();
        let anyMoved = false;

        for (const li of lisInOrder) {
          if (!editorEl.contains(li)) continue;
          const caretOffset = getCaretOffsetInLi(li);
          const ok = e.shiftKey ? outdentListItem(li, editorEl) : indentListItem(li);
          if (ok) {
            anyMoved = true;
            setCaretOffsetInLi(li, caretOffset);
          }
        }
        
        // 4. Block prefix transformation on Tab (e.g. *, -, +, 1., 1), A., A), a., a) followed by Tab)
        if (!e.shiftKey && range.startContainer.nodeType === Node.TEXT_NODE) {
          const converted = checkAndConvertBlockPrefix(range.startContainer, range.startOffset, editorEl, selection);
          if (converted) {
            e.preventDefault();
            return true;
          }
        }

        normalizeListStructure(editorEl);
        editorEl.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }
    }

    // Default Tab in rich text: insert 4 non-breaking spaces
    e.preventDefault();
    document.execCommand('insertHTML', false, '&nbsp;&nbsp;&nbsp;&nbsp;');
    editorEl.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  if (key === ' ') {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return false;
    const range = selection.getRangeAt(0);
    const container = range.startContainer;
    
    if (container.nodeType === Node.TEXT_NODE) {
      const text = container.textContent;
      const offset = range.startOffset;

      const converted = checkAndConvertBlockPrefix(container, offset, editorEl, selection);
      if (converted) {
        e.preventDefault();
        return true;
      }

      const beforeCursor = text.substring(0, offset);

      // Check if container is inside a list item already
      const parentLi = container.parentElement ? container.parentElement.closest('li') : null;
      
      // 1. Block prefix transformation at beginning of line
      if (!parentLi) {
        let block = container.parentElement;
        while (block && block !== editorEl && !/^(P|DIV|H1|H2|H3|H4|H5|H6|LI|BLOCKQUOTE)$/i.test(block.tagName)) {
          block = block.parentElement;
        }

        const isBullet = beforeCursor === '*' || beforeCursor === '-' || beforeCursor === '+' || beforeCursor === '•';
        const isNumeric = /^(\d+)[.)]$/.test(beforeCursor);
        const isAlpha = /^([a-zA-Z])[.)]$/.test(beforeCursor);
        const isChecklist = beforeCursor === '[]' || beforeCursor === '[ ]' || beforeCursor === '[x]' || beforeCursor === '[X]';
        const isH1 = beforeCursor === '#';
        const isH2 = beforeCursor === '##';
        const isH3 = beforeCursor === '###';
        const isH4 = beforeCursor === '####';
        const isQuote = beforeCursor === '>';

        if (isBullet || isNumeric || isAlpha || isChecklist || isH1 || isH2 || isH3 || isH4 || isQuote) {
          e.preventDefault();
          const remainingText = text.substring(offset);
          
          if (isChecklist) {
            const isChecked = beforeCursor.includes('x') || beforeCursor.includes('X');
            const ul = document.createElement('ul');
            ul.style.listStyleType = 'none';
            ul.style.paddingLeft = '1.2rem';

            const liEl = document.createElement('li');
            liEl.style.listStyleType = 'none';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.style.marginRight = '6px';
            checkbox.style.verticalAlign = 'middle';
            if (isChecked) checkbox.checked = true;

            liEl.appendChild(checkbox);
            if (remainingText) liEl.appendChild(document.createTextNode(remainingText));
            else liEl.appendChild(document.createTextNode(' '));
            ul.appendChild(liEl);

            if (block && block !== editorEl && !/^(H1|H2|H3|H4|H5|H6|LI)$/i.test(block.tagName)) {
              block.parentNode.replaceChild(ul, block);
            } else {
              container.textContent = '';
              range.deleteContents();
              range.insertNode(ul);
            }

            restoreCaretInLi(liEl, true);
            editorEl.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
          } else if (isBullet || isNumeric || isAlpha) {
            const listTag = isBullet ? 'ul' : 'ol';
            const listEl = document.createElement(listTag);
            if (isAlpha) {
              const firstChar = beforeCursor[0];
              listEl.setAttribute('type', firstChar === firstChar.toUpperCase() ? 'A' : 'a');
            }
            const liEl = document.createElement('li');
            container.textContent = remainingText;

            if (block && block !== editorEl && !/^(H1|H2|H3|H4|H5|H6|LI)$/i.test(block.tagName)) {
              while (block.firstChild) {
                liEl.appendChild(block.firstChild);
              }
              if (liEl.innerHTML.trim() === '') liEl.innerHTML = '<br>';
              listEl.appendChild(liEl);
              block.parentNode.replaceChild(listEl, block);
            } else {
              if (remainingText) liEl.textContent = remainingText;
              else liEl.innerHTML = '<br>';
              listEl.appendChild(liEl);
              range.deleteContents();
              range.insertNode(listEl);
            }

            const newRange = document.createRange();
            if (liEl.firstChild && liEl.firstChild.nodeType === Node.TEXT_NODE) {
              newRange.setStart(liEl.firstChild, 0);
            } else {
              newRange.selectNodeContents(liEl);
            }
            newRange.collapse(true);
            selection.removeAllRanges();
            selection.addRange(newRange);
            editorEl.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
          } else if (isH1 || isH2 || isH3 || isH4 || isQuote) {
            const tag = isH1 ? 'h1' : (isH2 ? 'h2' : (isH3 ? 'h3' : (isH4 ? 'h4' : 'blockquote')));
            const newBlock = document.createElement(tag);
            container.textContent = remainingText;

            if (block && block !== editorEl) {
              while (block.firstChild) {
                newBlock.appendChild(block.firstChild);
              }
              if (newBlock.innerHTML.trim() === '') newBlock.innerHTML = '<br>';
              block.parentNode.replaceChild(newBlock, block);
            } else {
              if (remainingText) newBlock.textContent = remainingText;
              else newBlock.innerHTML = '<br>';
              range.deleteContents();
              range.insertNode(newBlock);
            }

            const newRange = document.createRange();
            if (newBlock.firstChild && newBlock.firstChild.nodeType === Node.TEXT_NODE) {
              newRange.setStart(newBlock.firstChild, 0);
            } else {
              newRange.selectNodeContents(newBlock);
            }
            newRange.collapse(true);
            selection.removeAllRanges();
            selection.addRange(newRange);
            editorEl.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
          }
        }
      }

      // 2. Inline markdown shortcuts auto-conversion on space (e.g. **bold**, *italic*, `code`, ~~strike~~, ==mark==)
      const inlineMatch = beforeCursor.match(/(\*\*|__|\*|_|`|~~|==)([^\s\1].*?)\1$/);
      if (inlineMatch) {
        const fullMatch = inlineMatch[0];
        const delimiter = inlineMatch[1];
        const content = inlineMatch[2];
        const matchStart = offset - fullMatch.length;

        let tag = 'strong';
        if (delimiter === '*' || delimiter === '_') tag = 'em';
        else if (delimiter === '`') tag = 'code';
        else if (delimiter === '~~') tag = 's';
        else if (delimiter === '==') tag = 'mark';

        e.preventDefault();
        const beforeText = text.substring(0, matchStart);
        const afterText = text.substring(offset);

        const el = document.createElement(tag);
        el.textContent = content;
        const spaceNode = document.createTextNode('\u00A0');

        const frag = document.createDocumentFragment();
        if (beforeText) frag.appendChild(document.createTextNode(beforeText));
        frag.appendChild(el);
        frag.appendChild(spaceNode);
        if (afterText) frag.appendChild(document.createTextNode(afterText));

        const parent = container.parentNode;
        parent.replaceChild(frag, container);

        const newRange = document.createRange();
        newRange.setStartAfter(spaceNode);
        newRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(newRange);
        editorEl.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }
    }
  }

  // Handle Enter key inside list items or at end of headings
  if (key === 'Enter' && !e.shiftKey) {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const container = range.startContainer;
      const li = resolveLiFromBoundary(container, range.startOffset)
        || (container.nodeType === Node.ELEMENT_NODE ? container.closest('li') : container.parentElement?.closest('li'));

      if (li && editorEl.contains(li)) {
        const checkbox = li.querySelector('input[type="checkbox"]');
        const isChecklistLi = !!checkbox;
        const textOnly = li.cloneNode(true);
        const childLists = textOnly.querySelectorAll('ul, ol');
        childLists.forEach(cl => cl.remove());
        const hasOtherMedia = !!textOnly.querySelector('img, table, iframe, video, audio, .pill-mention, .pill-delegation');
        const liText = textOnly.textContent.replace(/[\s\u200B\u00A0]/g, '');

        if (!hasOtherMedia && (!liText || liText === '')) {
          e.preventDefault();
          if (isChecklistLi) {
            removeChecklistItemRichText();
          } else {
            outdentListItem(li, editorEl);
          }
          normalizeListStructure(editorEl);
          editorEl.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        }

        if (isChecklistLi) {
          e.preventDefault();
          const parentList = li.parentElement;
          if (parentList) {
            const nextRange = range.cloneRange();
            nextRange.selectNodeContents(li);
            try {
              nextRange.setStart(range.endContainer, range.endOffset);
            } catch (_) {}

            const fragment = nextRange.extractContents();
            const newLi = document.createElement('li');
            newLi.style.listStyleType = 'none';

            const newChk = document.createElement('input');
            newChk.type = 'checkbox';
            newChk.style.marginRight = '6px';
            newChk.style.verticalAlign = 'middle';
            newLi.appendChild(newChk);

            if (fragment && fragment.childNodes.length > 0) {
              fragment.querySelectorAll?.('input[type="checkbox"]')?.forEach(c => c.remove());
              newLi.appendChild(fragment);
            }
            if (!newLi.textContent.trim() && newLi.childNodes.length <= 1) {
              const textNode = document.createTextNode(' ');
              newLi.appendChild(textNode);
            }

            parentList.insertBefore(newLi, li.nextSibling);
            restoreCaretInLi(newLi, true);
            editorEl.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
          }
        }

        // If list item contains media (such as an image) or text, cleanly create/split next <li> in list
        if (hasOtherMedia || li.querySelector('img')) {
          e.preventDefault();
          const parentList = li.parentElement;
          if (parentList && /^(UL|OL)$/.test(parentList.tagName)) {
            const sublists = Array.from(li.children).filter(c => /^(UL|OL)$/.test(c.tagName));
            const nextRange = range.cloneRange();
            nextRange.selectNodeContents(li);
            if (sublists.length > 0) {
              try {
                nextRange.setEndBefore(sublists[0]);
              } catch (_) {}
            }
            try {
              nextRange.setStart(range.endContainer, range.endOffset);
            } catch (_) {}

            const fragment = nextRange.extractContents();
            const newLi = document.createElement('li');
            newLi.appendChild(fragment);

            if (newLi.innerHTML.trim() === '') {
              newLi.innerHTML = '<br>';
            }

            parentList.insertBefore(newLi, li.nextSibling);

            restoreCaretInLi(newLi, true);
            normalizeListStructure(editorEl);
            editorEl.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
          }
        }
      }

      // Exit heading on Enter at end
      const heading = container.nodeType === Node.ELEMENT_NODE ? container.closest('h1, h2, h3, h4') : container.parentElement?.closest('h1, h2, h3, h4');
      if (heading && editorEl.contains(heading) && range.collapsed) {
        const headingLen = heading.textContent.length;
        if (range.startOffset >= headingLen) {
          e.preventDefault();
          const p = document.createElement('p');
          p.innerHTML = '<br>';
          heading.parentNode.insertBefore(p, heading.nextSibling);

          const newRange = document.createRange();
          newRange.setStart(p, 0);
          newRange.collapse(true);
          selection.removeAllRanges();
          selection.addRange(newRange);
          p.focus();
          editorEl.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        }
      }
    }
  }

  // Keyboard shortcut formatters (Ctrl/Cmd + B, I, U, etc.)
  if (e.ctrlKey || e.metaKey) {
    const k = e.key.toLowerCase();
    if (k === 'b') {
      e.preventDefault();
      formatRichTextInEditor(editorEl, 'bold');
      return true;
    } else if (k === 'i') {
      e.preventDefault();
      formatRichTextInEditor(editorEl, 'italic');
      return true;
    } else if (k === 'u') {
      e.preventDefault();
      formatRichTextInEditor(editorEl, 'underline');
      return true;
    } else if (k === 'x' && e.shiftKey) {
      e.preventDefault();
      formatRichTextInEditor(editorEl, 'strike');
      return true;
    } else if (k === 'h' && e.shiftKey) {
      e.preventDefault();
      formatRichTextInEditor(editorEl, 'mark');
      return true;
    } else if (k === 'k') {
      e.preventDefault();
      formatRichTextInEditor(editorEl, 'link');
      return true;
    }
  }

  return false;
}

function attachRichTextShortcutsAndToolbar(editorEl, options = {}) {
  if (!editorEl || editorEl._hasRichShortcutsAttached) return;
  editorEl._hasRichShortcutsAttached = true;

  editorEl.addEventListener('keydown', (e) => {
    handleRichTextInputShortcuts(e, editorEl);
  });

  editorEl.addEventListener('paste', (e) => {
    handleImagePaste(e);
  });

  const checkSelection = () => {
    showFloatingFormatToolbarForSelection(editorEl);
  };

  editorEl.addEventListener('mouseup', () => {
    setTimeout(checkSelection, 10);
  });

  editorEl.addEventListener('keyup', (e) => {
    if (e.key === 'Shift' || e.key.startsWith('Arrow')) {
      setTimeout(checkSelection, 10);
    }
  });

  editorEl.addEventListener('blur', () => {
    setTimeout(() => {
      const activeEl = document.activeElement;
      if (!_floatingFormatToolbar || !_floatingFormatToolbar.contains(activeEl)) {
        hideFloatingFormatToolbar();
      }
    }, 200);
  });
}

if (typeof window !== 'undefined') {
  window.attachRichTextShortcutsAndToolbar = attachRichTextShortcutsAndToolbar;
  window.formatRichTextInEditor = formatRichTextInEditor;
  window.handleRichTextInputShortcuts = handleRichTextInputShortcuts;
  window.showFloatingFormatToolbarForSelection = showFloatingFormatToolbarForSelection;
  window.hideFloatingFormatToolbar = hideFloatingFormatToolbar;
}
// ═══ Image paste + resize ═══
function insertAtCursor(textarea, text) {
  const s = textarea.selectionStart, e = textarea.selectionEnd;
  textarea.value = textarea.value.substring(0, s) + text + textarea.value.substring(e);
  textarea.selectionStart = textarea.selectionEnd = s + text.length;
}

function _resolveActiveNoteEditor(e) {
  if (e?.currentTarget && e.currentTarget !== window && e.currentTarget !== document) {
    if (e.currentTarget.isContentEditable || e.currentTarget.getAttribute?.('contenteditable') === 'true' || e.currentTarget.id === 'edit-textarea' || e.currentTarget.id === 'edit-summary' || e.currentTarget.id === 'nn-content' || e.currentTarget.tagName === 'TEXTAREA') {
      return e.currentTarget;
    }
  }
  const active = document.activeElement;
  if (active) {
    const direct = active.closest?.('#edit-summary, #nn-content, #edit-textarea, [contenteditable="true"], textarea');
    if (direct) return direct;
  }
  const target = e?.target;
  if (target && target.closest) {
    const direct = target.closest('#edit-summary, #nn-content, #edit-textarea, [contenteditable="true"], textarea');
    if (direct) return direct;
  }
  const summaryEl = document.getElementById('edit-summary');
  if (summaryEl && document.activeElement === summaryEl) return summaryEl;
  return document.getElementById('edit-textarea') || document.getElementById('nn-content') || summaryEl;
}

function _findDuplicateImageInEditor(editorEl, dataUrl) {
  if (!editorEl || !dataUrl) return null;
  if (editorEl.tagName === 'TEXTAREA' || typeof editorEl.value === 'string') {
    if (editorEl.value.includes(dataUrl)) return true;
    if (typeof _assetDataUrlCache !== 'undefined') {
      for (const [path, cachedUrl] of _assetDataUrlCache.entries()) {
        if (cachedUrl === dataUrl && editorEl.value.includes(path)) return true;
      }
    }
    return null;
  }
  if (editorEl.isContentEditable || editorEl.getAttribute?.('contenteditable') === 'true' || editorEl.id === 'edit-textarea' || editorEl.id === 'edit-summary') {
    const imgs = Array.from(editorEl.querySelectorAll('img'));
    for (const img of imgs) {
      if (img.src === dataUrl) return img;
      if (img.dataset.assetPath && typeof _assetDataUrlCache !== 'undefined' && _assetDataUrlCache.get(img.dataset.assetPath) === dataUrl) return img;
      const srcAttr = img.getAttribute('src');
      if (srcAttr && typeof _assetDataUrlCache !== 'undefined' && _assetDataUrlCache.get(srcAttr) === dataUrl) return img;
    }
  }
  return null;
}

function handleImagePaste(e) {
  if (!e || e._secretaryPasteHandled) return;
  e._secretaryPasteHandled = true;

  const items = [...(e.clipboardData?.items || [])];

  const rootEditor = _resolveActiveNoteEditor(e);
  const isRich = rootEditor ? (
    (rootEditor.isContentEditable || rootEditor.getAttribute?.('contenteditable') === 'true' || rootEditor.id === 'edit-textarea' || rootEditor.id === 'edit-summary')
    && rootEditor.tagName !== 'TEXTAREA'
  ) : false;

  // Synchronously capture cursor range before async FileReader read
  let savedRange = null;
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && rootEditor && rootEditor.contains(sel.anchorNode)) {
    savedRange = sel.getRangeAt(0).cloneRange();
  }

  // Priority 1: image blob
  const imgItem = items.find(i => i.type.startsWith('image/'));
  if (imgItem) {
    e.preventDefault();
    const file = imgItem.getAsFile();
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const ext = (file.type.split('/')[1] || 'png').replace('+xml', '');
      const id  = 'img-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
      const assetPath = `notes/_assets/${id}.${ext}`;
      let dataUrl = reader.result;
      if (typeof window !== 'undefined' && window.ImageOptimizer?.compressImage) {
        try {
          dataUrl = await window.ImageOptimizer.compressImage(dataUrl, 'standard');
        } catch (compErr) {
          console.warn('ImageOptimizer paste compression fallback:', compErr);
        }
      }

      // Duplicate detection: prevent adding identical image if already present
      const duplicate = _findDuplicateImageInEditor(rootEditor, dataUrl);
      if (duplicate) {
        if (typeof duplicate === 'object' && duplicate.nodeType === Node.ELEMENT_NODE) {
          try {
            duplicate.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          } catch (_) {
            duplicate.scrollIntoView();
          }
          if (typeof selectEditorImage === 'function') {
            selectEditorImage(duplicate, rootEditor);
          }
        }
        if (typeof toast === 'function') {
          toast((typeof t === 'function' ? t('editor.imageAlreadyExists') : null) || 'Image is already in the note');
        }
        return;
      }
      
      if (typeof _assetDataUrlCache !== 'undefined') {
        _assetDataUrlCache.set(assetPath, dataUrl);
        _assetDataUrlCache.set(`${id}.${ext}`, dataUrl);
        _assetDataUrlCache.set(assetPath.replace(/^notes\//, ''), dataUrl);
      }
      
      try {
        if (typeof window !== 'undefined' && window.FirebaseSyncService?.saveAsset && window.StorageAPI?.getStorageEngine() === 'firebase') {
          await window.FirebaseSyncService.saveAsset(assetPath, dataUrl);
        }
        await writeFile(assetPath, dataUrl);
        _savedAssetPaths.add(assetPath);
      } catch (err) {
        console.warn('Failed to write pasted image asset:', err);
      }
      
      if (isRich && rootEditor) {
        const img = document.createElement('img');
        img.dataset.id = id;
        img.dataset.assetPath = assetPath;
        img.src = dataUrl;
        img.style.maxWidth = '100%';
        img.style.width = '600px';
        img.style.display = 'block';
        img.style.margin = '0.6rem 0';
        
        let inserted = false;
        if (savedRange && rootEditor.contains(savedRange.commonAncestorContainer)) {
          try {
            savedRange.deleteContents();
            savedRange.insertNode(img);
            savedRange.collapse(false);
            const space = document.createTextNode(' ');
            if (img.parentNode) {
              img.parentNode.insertBefore(space, img.nextSibling);
            }

            const newSel = window.getSelection();
            if (newSel) {
              const afterRange = document.createRange();
              afterRange.setStartAfter(space);
              afterRange.collapse(true);
              newSel.removeAllRanges();
              newSel.addRange(afterRange);
            }
            inserted = true;
          } catch (_) {}
        }

        if (!inserted) {
          const liveSel = window.getSelection();
          if (liveSel && liveSel.rangeCount > 0 && rootEditor.contains(liveSel.anchorNode)) {
            try {
              const r = liveSel.getRangeAt(0);
              r.deleteContents();
              r.insertNode(img);
              r.collapse(false);
              const space = document.createTextNode(' ');
              if (img.parentNode) {
                img.parentNode.insertBefore(space, img.nextSibling);
              }

              const afterRange = document.createRange();
              afterRange.setStartAfter(space);
              afterRange.collapse(true);
              liveSel.removeAllRanges();
              liveSel.addRange(afterRange);
              inserted = true;
            } catch (_) {}
          }
        }

        if (!inserted) {
          rootEditor.appendChild(img);
          const space = document.createTextNode(' ');
          rootEditor.appendChild(space);
        }
        
        try {
          img.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          if (typeof selectEditorImage === 'function') {
            selectEditorImage(img, rootEditor);
          }
        } catch (scrollErr) {}
      } else if (rootEditor && (rootEditor.tagName === 'TEXTAREA' || typeof rootEditor.value === 'string')) {
        const tag = `<img data-id="${id}" data-asset-path="${assetPath}" src="${dataUrl}" style="max-width:100%;width:600px">`;
        insertAtCursor(rootEditor, `\n${tag}\n`);
      }
      if (rootEditor) {
        rootEditor.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (typeof syncImageStrip === 'function') syncImageStrip();
      toast(t('common.imagePastedResizeHint'));
    };
    reader.readAsDataURL(file);
    return;
  }

  // Priority 2: Text / HTML paste sanitation for rich editor
  if (isRich) {
    e.preventDefault();
    const htmlItem = items.find(i => i.type === 'text/html');
    const textItem = items.find(i => i.type === 'text/plain');

    const selLive = window.getSelection();
    let currentLi = null;
    if (selLive && selLive.rangeCount > 0) {
      const node = selLive.getRangeAt(0).startContainer;
      currentLi = resolveLiFromBoundary(node, selLive.getRangeAt(0).startOffset);
    }

    if (htmlItem) {
      htmlItem.getAsString(html => {
        const cleanHTML = sanitizePastedHTML(html);
        if (currentLi && rootEditor.contains(currentLi)) {
          insertHTMLIntoListItem(currentLi, cleanHTML, rootEditor);
        } else {
          document.execCommand('insertHTML', false, cleanHTML);
        }
        normalizeListStructure(rootEditor);
        if (rootEditor) {
          rootEditor.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
    } else if (textItem) {
      textItem.getAsString(text => {
        if (!text) return;
        const trimmed = text.trim();
        const mdLink = trimmed.match(/^\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+|www\.[^\s)]+)\)$/i);
        const isUrl = !/\s/.test(trimmed) && (/^(?:https?:\/\/|mailto:)[^\s/$.?#].[^\s]*$/i.test(trimmed) || /^www\.[a-z0-9-]+\.[a-z0-9-.]+[^\s]*$/i.test(trimmed));

        if (mdLink) {
          let url = mdLink[2];
          if (/^www\./i.test(url)) url = 'https://' + url;
          const anchorHtml = `<a href="${escA(url)}" target="_blank" rel="noopener noreferrer">${escH(mdLink[1])}</a>`;
          if (currentLi && rootEditor.contains(currentLi)) {
            insertHTMLIntoListItem(currentLi, anchorHtml, rootEditor);
          } else {
            document.execCommand('insertHTML', false, anchorHtml);
          }
        } else if (isUrl) {
          let url = trimmed;
          if (/^www\./i.test(url)) url = 'https://' + url;
          const selection = window.getSelection();
          const hasSelection = selection && selection.rangeCount > 0 && !selection.isCollapsed && rootEditor.contains(selection.anchorNode);
          if (hasSelection) {
            const selectedText = selection.toString();
            const anchorHtml = `<a href="${escA(url)}" target="_blank" rel="noopener noreferrer">${escH(selectedText || url)}</a>`;
            document.execCommand('insertHTML', false, anchorHtml);
          } else {
            const anchorHtml = `<a href="${escA(url)}" target="_blank" rel="noopener noreferrer">${escH(url)}</a>`;
            if (currentLi && rootEditor.contains(currentLi)) {
              insertHTMLIntoListItem(currentLi, anchorHtml, rootEditor);
            } else {
              document.execCommand('insertHTML', false, anchorHtml);
            }
          }
        } else {
          if (currentLi && rootEditor.contains(currentLi)) {
            insertTextIntoListItem(currentLi, text, rootEditor);
          } else {
            document.execCommand('insertText', false, text);
          }
        }
        normalizeListStructure(rootEditor);
        if (rootEditor) {
          rootEditor.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
    }
  } else {
    // Standard textarea: fallback to default plain text paste
    const htmlItem = items.find(i => i.type === 'text/html');
    if (htmlItem && typeof turndownService !== 'undefined') {
      e.preventDefault();
      htmlItem.getAsString(html => {
        let md;
        try { md = turndownService.turndown(html); }
        catch (err) { console.warn('Paste HTML→MD failed', err); return; }
        insertAtCursor(e.target, md);
        if (rootEditor) {
          rootEditor.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
    }
  }
}

function handleImageDrop(e) {
  const dt = e.dataTransfer;
  if (!dt) return;
  const files = [...(dt.files || [])];
  const imgFile = files.find(f => f.type.startsWith('image/'));
  if (imgFile) {
    e.preventDefault();
    e.stopPropagation();
    
    const rootEditor = _resolveActiveNoteEditor(e);
    const isRich = rootEditor ? (
      (rootEditor.isContentEditable || rootEditor.getAttribute?.('contenteditable') === 'true' || rootEditor.id === 'edit-textarea' || rootEditor.id === 'edit-summary')
      && rootEditor.tagName !== 'TEXTAREA'
    ) : false;
    
    const reader = new FileReader();
    reader.onload = async () => {
      const ext = (imgFile.type.split('/')[1] || 'png').replace('+xml', '');
      const id  = 'img-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
      const assetPath = `notes/_assets/${id}.${ext}`;
      const dataUrl = reader.result;

      // Duplicate detection
      const duplicate = _findDuplicateImageInEditor(rootEditor, dataUrl);
      if (duplicate) {
        if (typeof duplicate === 'object' && duplicate.nodeType === Node.ELEMENT_NODE) {
          try {
            duplicate.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          } catch (_) {
            duplicate.scrollIntoView();
          }
          if (typeof selectEditorImage === 'function') {
            selectEditorImage(duplicate, rootEditor);
          }
        }
        if (typeof toast === 'function') {
          toast((typeof t === 'function' ? t('editor.imageAlreadyExists') : null) || 'Image is already in the note');
        }
        return;
      }
      
      if (typeof _assetDataUrlCache !== 'undefined') {
        _assetDataUrlCache.set(assetPath, dataUrl);
        _assetDataUrlCache.set(`${id}.${ext}`, dataUrl);
        _assetDataUrlCache.set(assetPath.replace(/^notes\//, ''), dataUrl);
      }
      
      try {
        if (typeof window !== 'undefined' && window.FirebaseSyncService?.saveAsset && window.StorageAPI?.getStorageEngine() === 'firebase') {
          await window.FirebaseSyncService.saveAsset(assetPath, dataUrl);
        }
        await writeFile(assetPath, dataUrl);
        _savedAssetPaths.add(assetPath);
      } catch (err) {
        console.warn('Failed to write dropped image asset:', err);
      }
      
      if (isRich && rootEditor) {
        const img = document.createElement('img');
        img.dataset.id = id;
        img.dataset.assetPath = assetPath;
        img.src = dataUrl;
        img.style.maxWidth = '100%';
        img.style.width = '600px';
        img.style.display = 'block';
        img.style.margin = '0.6rem 0';
        
        let inserted = false;
        if (document.caretRangeFromPoint) {
          const range = document.caretRangeFromPoint(e.clientX, e.clientY);
          if (range && rootEditor.contains(range.startContainer)) {
            range.insertNode(img);
            const space = document.createTextNode(' ');
            if (img.parentNode) {
              img.parentNode.insertBefore(space, img.nextSibling);
            }
            inserted = true;
          }
        } else if (document.caretPositionFromPoint) {
          const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
          if (pos && rootEditor.contains(pos.offsetNode)) {
            const range = document.createRange();
            range.setStart(pos.offsetNode, pos.offset);
            range.collapse(true);
            range.insertNode(img);
            const space = document.createTextNode(' ');
            if (img.parentNode) {
              img.parentNode.insertBefore(space, img.nextSibling);
            }
            inserted = true;
          }
        }
        if (!inserted) {
          rootEditor.appendChild(img);
          const space = document.createTextNode(' ');
          rootEditor.appendChild(space);
        }
        try {
          img.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          if (typeof selectEditorImage === 'function') {
            selectEditorImage(img, rootEditor);
          }
        } catch (scrollErr) {}
      } else if (rootEditor && (rootEditor.tagName === 'TEXTAREA' || typeof rootEditor.value === 'string')) {
        const tag = `<img data-id="${id}" data-asset-path="${assetPath}" src="${dataUrl}" style="max-width:100%;width:600px">`;
        insertAtCursor(rootEditor, `\n${tag}\n`);
      }
      if (rootEditor) {
        rootEditor.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (typeof syncImageStrip === 'function') syncImageStrip();
      toast(t('common.imagePastedResizeHint'));
    };
    reader.readAsDataURL(imgFile);
  }
}


let _tableToolbar = null;

function hideTableToolbar() {
  if (_tableToolbar) {
    _tableToolbar.remove();
    _tableToolbar = null;
  }
}

function showTableContextToolbar(cell, table) {
  // If the toolbar is already present, recreate it to ensure fresh references
  hideTableToolbar();
  
  const toolbar = document.createElement('div');
  toolbar.className = 'table-context-toolbar';
  toolbar.setAttribute('contenteditable', 'false'); // Keep the toolbar itself non-editable
  
  // Row buttons
  const btnAddRowAbove = document.createElement('button');
  btnAddRowAbove.title = (typeof t === 'function' ? t('editor.addRowAboveTooltip') : '') || 'Insert a new table row above the active row';
  btnAddRowAbove.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> <span>${(typeof t === 'function' ? t('editor.addRowAbove') : '') || 'Add Row Above'}</span>`;
  btnAddRowAbove.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    tableAddRow(cell, 'above');
  });

  const btnAddRowBelow = document.createElement('button');
  btnAddRowBelow.title = (typeof t === 'function' ? t('editor.addRowBelowTooltip') : '') || 'Insert a new table row below the active row';
  btnAddRowBelow.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> <span>${(typeof t === 'function' ? t('editor.addRowBelow') : '') || 'Add Row Below'}</span>`;
  btnAddRowBelow.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    tableAddRow(cell, 'below');
  });

  const btnDeleteRow = document.createElement('button');
  btnDeleteRow.title = (typeof t === 'function' ? t('editor.deleteRowTooltip') : '') || 'Delete the active table row';
  btnDeleteRow.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> <span>${(typeof t === 'function' ? t('editor.deleteRow') : '') || 'Delete Row'}</span>`;
  btnDeleteRow.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    tableDeleteRow(cell);
  });

  // Divider
  const sep1 = document.createElement('div');
  sep1.className = 'toolbar-sep';

  // Column buttons
  const btnAddColLeft = document.createElement('button');
  btnAddColLeft.title = (typeof t === 'function' ? t('editor.addColumnLeftTooltip') : '') || 'Insert a new table column to the left of the active cell';
  btnAddColLeft.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> <span>${(typeof t === 'function' ? t('editor.addColumnLeft') : '') || 'Add Col Left'}</span>`;
  btnAddColLeft.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    tableAddColumn(cell, 'left');
  });

  const btnAddColRight = document.createElement('button');
  btnAddColRight.title = (typeof t === 'function' ? t('editor.addColumnRightTooltip') : '') || 'Insert a new table column to the right of the active cell';
  btnAddColRight.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> <span>${(typeof t === 'function' ? t('editor.addColumnRight') : '') || 'Add Col Right'}</span>`;
  btnAddColRight.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    tableAddColumn(cell, 'right');
  });

  const btnDeleteCol = document.createElement('button');
  btnDeleteCol.title = (typeof t === 'function' ? t('editor.deleteColumnTooltip') : '') || 'Delete the active table column';
  btnDeleteCol.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> <span>${(typeof t === 'function' ? t('editor.deleteColumn') : '') || 'Delete Col'}</span>`;
  btnDeleteCol.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    tableDeleteColumn(cell);
  });

  // Divider 2
  const sep2 = document.createElement('div');
  sep2.className = 'toolbar-sep';

  // Delete Table
  const btnDeleteTable = document.createElement('button');
  btnDeleteTable.className = 'btn-danger';
  btnDeleteTable.title = (typeof t === 'function' ? t('editor.deleteTableTooltip') : '') || 'Delete the entire table';
  btnDeleteTable.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg> <span>${(typeof t === 'function' ? t('editor.deleteTable') : '') || 'Delete Table'}</span>`;
  btnDeleteTable.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const promptText = (typeof t === 'function' ? t('editor.confirmDeleteTable') : '') || 'Are you sure you want to delete this table?';
    if (await showConfirmDialog(promptText, { isDanger: true })) {
      tableDeleteTable(table);
    }
  });

  toolbar.appendChild(btnAddRowAbove);
  toolbar.appendChild(btnAddRowBelow);
  toolbar.appendChild(btnDeleteRow);
  toolbar.appendChild(sep1);
  toolbar.appendChild(btnAddColLeft);
  toolbar.appendChild(btnAddColRight);
  toolbar.appendChild(btnDeleteCol);
  toolbar.appendChild(sep2);
  toolbar.appendChild(btnDeleteTable);

  table.insertAdjacentElement('beforebegin', toolbar);
  _tableToolbar = toolbar;
}

function tableAddRow(cell, position) {
  const row = cell.closest('tr');
  if (!row) return;
  const table = row.closest('table');
  const numCells = row.cells.length;
  const newRow = document.createElement('tr');
  
  const isHeaderRow = row.parentElement && row.parentElement.tagName.toLowerCase() === 'thead';
  for (let i = 0; i < numCells; i++) {
    const isHeaderCell = row.cells[i].tagName.toLowerCase() === 'th';
    const cellTagName = (position === 'above' && isHeaderCell) ? 'th' : 'td';
    const newCell = document.createElement(cellTagName);
    newCell.style.cssText = 'border: 1px solid var(--card-border); padding: 8px;';
    newCell.innerHTML = '<br>';
    newRow.appendChild(newCell);
  }

  if (position === 'above') {
    row.parentNode.insertBefore(newRow, row);
  } else {
    if (isHeaderRow && table) {
      let tbody = table.querySelector('tbody');
      if (!tbody) {
        tbody = document.createElement('tbody');
        table.appendChild(tbody);
      }
      tbody.insertBefore(newRow, tbody.firstChild);
    } else {
      row.parentNode.insertBefore(newRow, row.nextSibling);
    }
  }

  // Focus the first new cell
  if (newRow.cells.length > 0) {
    const range = document.createRange();
    const sel = window.getSelection();
    range.selectNodeContents(newRow.cells[0]);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    newRow.cells[0].focus();
  }

  const ta = document.getElementById('edit-textarea');
  if (ta) {
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function tableDeleteRow(cell) {
  const row = cell.closest('tr');
  if (!row) return;
  const table = row.closest('table');
  
  hideTableToolbar();
  row.remove();
  
  if (table && table.rows.length === 0) {
    table.remove();
  }
  
  const ta = document.getElementById('edit-textarea');
  if (ta) {
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function tableAddColumn(cell, position) {
  const row = cell.closest('tr');
  if (!row) return;
  const colIndex = cell.cellIndex;
  const table = cell.closest('table');
  if (!table) return;

  Array.from(table.rows).forEach(r => {
    const sampleCell = r.cells[colIndex] || r.cells[r.cells.length - 1];
    const cellTagName = sampleCell ? sampleCell.tagName.toLowerCase() : 'td';
    
    const newCell = document.createElement(cellTagName);
    newCell.style.cssText = 'border: 1px solid var(--card-border); padding: 8px;';
    newCell.innerHTML = '<br>';
    
    const targetCell = r.cells[colIndex];
    if (targetCell) {
      if (position === 'left') {
        r.insertBefore(newCell, targetCell);
      } else {
        r.insertBefore(newCell, targetCell.nextSibling);
      }
    } else {
      r.appendChild(newCell);
    }
  });

  const ta = document.getElementById('edit-textarea');
  if (ta) {
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function tableDeleteColumn(cell) {
  const colIndex = cell.cellIndex;
  const table = cell.closest('table');
  if (!table) return;

  hideTableToolbar();

  Array.from(table.rows).forEach(r => {
    if (r.cells[colIndex]) {
      r.cells[colIndex].remove();
    }
  });

  let isEmpty = true;
  for (let i = 0; i < table.rows.length; i++) {
    if (table.rows[i].cells.length > 0) {
      isEmpty = false;
      break;
    }
  }
  if (isEmpty) {
    table.remove();
  }

  const ta = document.getElementById('edit-textarea');
  if (ta) {
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function tableDeleteTable(table) {
  hideTableToolbar();
  table.remove();
  const ta = document.getElementById('edit-textarea');
  if (ta) {
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function handleTableContext(e) {
  if (!editMode) return;
  if (e.target.closest('.table-context-toolbar')) return;

  const cell = e.target.closest('td, th');
  if (!cell) {
    hideTableToolbar();
    return;
  }
  const table = cell.closest('table');
  if (!table) {
    hideTableToolbar();
    return;
  }
  showTableContextToolbar(cell, table);
}

let _activeEditorImage = null;
let _activeImageOverlay = null;
let _resizeToolbar = null;
let _imageOverlayRepositionFn = null;

function hideImageActiveOverlay() {
  if (_activeImageOverlay) {
    _activeImageOverlay.remove();
    _activeImageOverlay = null;
  }
  if (_resizeToolbar) {
    _resizeToolbar.remove();
    _resizeToolbar = null;
  }
  if (_imageOverlayRepositionFn) {
    window.removeEventListener('resize', _imageOverlayRepositionFn);
    document.removeEventListener('scroll', _imageOverlayRepositionFn, true);
    _imageOverlayRepositionFn = null;
  }
  if (_activeEditorImage) {
    _activeEditorImage.classList.remove('editor-img-selected');
    _activeEditorImage = null;
  }
}
window.hideImageActiveOverlay = hideImageActiveOverlay;

function hideResizeToolbar() {
  hideImageActiveOverlay();
}
window.hideResizeToolbar = hideResizeToolbar;

function selectEditorImage(imgEl, editorEl) {
  if (!imgEl) {
    hideImageActiveOverlay();
    return;
  }
  
  hideImageActiveOverlay();
  _activeEditorImage = imgEl;
  imgEl.classList.add('editor-img-selected');
  
  if (!imgEl.dataset.id) {
    imgEl.dataset.id = 'img-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  }
  
  const targetEditor = editorEl || imgEl.closest('#edit-textarea, #edit-summary, [contenteditable="true"]') || document.getElementById('edit-textarea');
  
  // Create overlay for 4 corners and delete button
  const overlay = document.createElement('div');
  overlay.className = 'editor-img-active-overlay';
  
  // 1. Top-right 'x' delete button
  const delBtn = document.createElement('button');
  delBtn.className = 'editor-img-delete-btn';
  delBtn.type = 'button';
  delBtn.title = (typeof t === 'function' ? t('editor.removeImage') : null) || 'Remove image';
  delBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
  delBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    hideImageActiveOverlay();
    imgEl.remove();
    if (targetEditor) {
      targetEditor.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (typeof syncImageStrip === 'function') syncImageStrip();
  });
  overlay.appendChild(delBtn);
  
  // 2. Four corner resize handles
  const corners = ['nw', 'ne', 'sw', 'se'];
  corners.forEach(pos => {
    const handle = document.createElement('div');
    handle.className = `editor-img-handle ${pos}`;
    handle.dataset.corner = pos;
    handle.title = (typeof t === 'function' ? t('editor.dragResizeTooltip') : null) || 'Drag corner to resize (maintains aspect ratio)';
    
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handle.classList.add('dragging');
      
      const startX = e.clientX;
      const startY = e.clientY;
      const rect = imgEl.getBoundingClientRect();
      const startWidth = rect.width;
      const startHeight = rect.height;
      
      // Maintain aspect ratio constant
      const naturalW = imgEl.naturalWidth || startWidth;
      const naturalH = imgEl.naturalHeight || startHeight;
      const aspectRatio = (naturalW && naturalH) ? (naturalW / naturalH) : (startWidth / (startHeight || 1));
      
      const onMouseMove = (moveEvent) => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        
        let newWidth = startWidth;
        if (pos === 'se') {
          const scaleX = (startWidth + dx) / startWidth;
          const scaleY = (startHeight + dy) / startHeight;
          const scale = Math.abs(dx) >= Math.abs(dy) ? scaleX : scaleY;
          newWidth = startWidth * scale;
        } else if (pos === 'sw') {
          const scaleX = (startWidth - dx) / startWidth;
          const scaleY = (startHeight + dy) / startHeight;
          const scale = Math.abs(dx) >= Math.abs(dy) ? scaleX : scaleY;
          newWidth = startWidth * scale;
        } else if (pos === 'ne') {
          const scaleX = (startWidth + dx) / startWidth;
          const scaleY = (startHeight - dy) / startHeight;
          const scale = Math.abs(dx) >= Math.abs(dy) ? scaleX : scaleY;
          newWidth = startWidth * scale;
        } else if (pos === 'nw') {
          const scaleX = (startWidth - dx) / startWidth;
          const scaleY = (startHeight - dy) / startHeight;
          const scale = Math.abs(dx) >= Math.abs(dy) ? scaleX : scaleY;
          newWidth = startWidth * scale;
        }
        
        const minW = 60;
        const maxW = Math.max(minW, (targetEditor ? targetEditor.getBoundingClientRect().width : 1200) - 10);
        newWidth = Math.max(minW, Math.min(maxW, Math.round(newWidth)));
        
        imgEl.style.width = `${newWidth}px`;
        imgEl.style.maxWidth = '100%';
        imgEl.style.height = 'auto';
        
        updateOverlayPosition();
        updateToolbarInputs(newWidth);
      };
      
      const onMouseUp = () => {
        handle.classList.remove('dragging');
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        
        if (targetEditor) {
          targetEditor.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (typeof syncImageStrip === 'function') syncImageStrip();
      };
      
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });
    
    overlay.appendChild(handle);
  });
  
  // 3. Controls toolbar positioned BELOW the image
  const currentW = parseInt(imgEl.style.width) || Math.round(imgEl.getBoundingClientRect().width) || 600;
  const currentQuality = imgEl.dataset.quality || 'standard';
  const toolbar = document.createElement('div');
  toolbar.className = 'img-resize-toolbar';
  toolbar.innerHTML = `
    <span style="font-weight:500;">${escH(typeof t === 'function' ? t('common.width') : 'Width')}</span>
    <input type="range" min="80" max="1200" step="10" value="${currentW}">
    <input type="number" min="80" max="1200" value="${currentW}"> px
    <button type="button" class="img-preset-btn" data-preset="25" title="25% width">25%</button>
    <button type="button" class="img-preset-btn" data-preset="50" title="50% width">50%</button>
    <button type="button" class="img-preset-btn" data-preset="75" title="75% width">75%</button>
    <button type="button" class="img-preset-btn" data-preset="100" title="100% width">100%</button>
    <span style="font-weight:500;margin-left:6px;">${escH(typeof t === 'function' ? t('editor.imageQuality') : 'Quality')}:</span>
    <button type="button" class="img-quality-btn ${currentQuality === 'standard' ? 'active' : ''}" data-quality="standard" title="${escA(typeof t === 'function' ? t('editor.imageQualityStandardTooltip') : 'Compress to standard 1080p WebP (85% quality)')}">${escH(typeof t === 'function' ? t('editor.qualityStandard') : 'Standard')}</button>
    <button type="button" class="img-quality-btn ${currentQuality === 'high' ? 'active' : ''}" data-quality="high" title="${escA(typeof t === 'function' ? t('editor.imageQualityHighTooltip') : 'Compress to high quality 4K WebP (95% quality)')}">${escH(typeof t === 'function' ? t('editor.qualityHigh') : 'High (4K)')}</button>
    <button type="button" class="img-quality-btn ${currentQuality === 'original' ? 'active' : ''}" data-quality="original" title="${escA(typeof t === 'function' ? t('editor.imageQualityOriginalTooltip') : 'Keep uncompressed original image')}">${escH(typeof t === 'function' ? t('editor.qualityOriginal') : 'Original')}</button>
    <button type="button" class="img-delete-toolbar-btn" title="${escA(typeof t === 'function' ? t('editor.removeImage') : 'Remove image')}">✕ ${escH(typeof t === 'function' ? t('common.delete') : 'Delete')}</button>
  `;
  
  const rangeInput = toolbar.querySelector('input[type=range]');
  const numInput = toolbar.querySelector('input[type=number]');
  
  const applyWidth = (w) => {
    const clamped = Math.max(60, Math.min(1400, parseInt(w) || 600));
    imgEl.style.width = `${clamped}px`;
    imgEl.style.maxWidth = '100%';
    imgEl.style.height = 'auto';
    rangeInput.value = clamped;
    numInput.value = clamped;
    updateOverlayPosition();
    if (targetEditor) {
      targetEditor.dispatchEvent(new Event('input', { bubbles: true }));
    }
  };
  
  rangeInput.addEventListener('input', () => applyWidth(rangeInput.value));
  numInput.addEventListener('input', () => applyWidth(numInput.value));
  
  toolbar.querySelectorAll('.img-preset-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const pct = parseInt(btn.dataset.preset) || 100;
      const parentW = targetEditor ? targetEditor.getBoundingClientRect().width : 700;
      const targetW = Math.round((parentW - 20) * (pct / 100));
      applyWidth(targetW);
    });
  });

  toolbar.querySelectorAll('.img-quality-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const q = btn.dataset.quality;
      toolbar.querySelectorAll('.img-quality-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      imgEl.dataset.quality = q;
      if (typeof window !== 'undefined' && window.ImageOptimizer?.compressImage) {
        try {
          const newSrc = await window.ImageOptimizer.compressImage(imgEl, q);
          if (newSrc && (newSrc.startsWith('data:') || newSrc.startsWith('http') || newSrc.startsWith('blob:'))) {
            imgEl.src = newSrc;
            if (targetEditor) {
              targetEditor.dispatchEvent(new Event('input', { bubbles: true }));
            }
            updateOverlayPosition();
            if (typeof toast === 'function') {
              toast((typeof t === 'function' ? t('editor.imageQualityApplied') : 'Image quality updated') + ': ' + q);
            }
          }
        } catch (err) {
          console.warn('Failed to change image quality:', err);
        }
      }
    });
  });
  
  toolbar.querySelector('.img-delete-toolbar-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    hideImageActiveOverlay();
    imgEl.remove();
    if (targetEditor) {
      targetEditor.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (typeof syncImageStrip === 'function') syncImageStrip();
  });
  
  function updateToolbarInputs(w) {
    if (rangeInput) rangeInput.value = w;
    if (numInput) numInput.value = w;
  }
  
  function updateOverlayPosition() {
    if (!imgEl || !imgEl.isConnected) {
      hideImageActiveOverlay();
      return;
    }
    const rect = imgEl.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      hideImageActiveOverlay();
      return;
    }
    const scrollX = window.scrollX || document.documentElement.scrollLeft;
    const scrollY = window.scrollY || document.documentElement.scrollTop;
    
    overlay.style.top = `${rect.top + scrollY}px`;
    overlay.style.left = `${rect.left + scrollX}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
    
    // Position toolbar directly below image
    toolbar.style.position = 'absolute';
    toolbar.style.top = `${rect.bottom + scrollY + 8}px`;
    toolbar.style.left = `${rect.left + scrollX}px`;
  }
  
  document.body.appendChild(overlay);
  document.body.appendChild(toolbar);
  _activeImageOverlay = overlay;
  _resizeToolbar = toolbar;
  
  updateOverlayPosition();
  
  _imageOverlayRepositionFn = () => updateOverlayPosition();
  window.addEventListener('resize', _imageOverlayRepositionFn);
  document.addEventListener('scroll', _imageOverlayRepositionFn, true);
}
window.selectEditorImage = selectEditorImage;

function showImageResizeToolbar(imgEl, textareaEl) {
  selectEditorImage(imgEl, textareaEl);
}
window.showImageResizeToolbar = showImageResizeToolbar;

function applyImageResize(textarea, imgId, width) {
  if (!imgId) return;
  const isRich = textarea?.contentEditable === 'true';
  const newStyle = `style="max-width:100%;width:${width}px"`;
  
  if (isRich && textarea) {
    const imgEl = textarea.querySelector(`img[data-id="${imgId}"]`);
    if (imgEl) {
      imgEl.style.width = width + 'px';
      imgEl.style.maxWidth = '100%';
      imgEl.style.height = 'auto';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return;
  }
  
  for (const token in _imgTokenMap) {
    if (!Object.prototype.hasOwnProperty.call(_imgTokenMap, token)) continue;
    if (!_imgTokenMap[token].includes(`data-id="${imgId}"`)) continue;
    let updated = _imgTokenMap[token].replace(/style="[^"]*"/, newStyle);
    if (updated === _imgTokenMap[token]) {
      updated = _imgTokenMap[token].replace(/(\/?>)/, ` ${newStyle}$1`);
    }
    _imgTokenMap[token] = updated;
    textarea?.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  
  if (textarea && typeof textarea.value === 'string') {
    let updated = textarea.value.replace(
      new RegExp(`(<img[^>]*data-id="${imgId}"[^>]*)style="[^"]*"([^>]*>)`, 'i'),
      `$1${newStyle}$2`
    );
    if (updated === textarea.value) {
      updated = textarea.value.replace(
        new RegExp(`(<img[^>]*data-id="${imgId}")([^>]*>)`, 'i'),
        `$1 ${newStyle}$2`
      );
    }
    textarea.value = updated;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
window.applyImageResize = applyImageResize;

function handleImageClickForResize(e) {
  if (!editMode) return;
  const img = e.target.closest('img');
  if (!img) {
    // If clicking outside an active overlay/toolbar, dismiss
    if (!e.target.closest('.editor-img-active-overlay, .img-resize-toolbar, .edit-img-thumb')) {
      hideImageActiveOverlay();
    }
    return;
  }
  // Ignore clicks on strip thumbnails (they have their own locator click handler)
  if (img.closest('#overlay-images-strip, .edit-img-strip')) return;
  
  e.preventDefault();
  const editorEl = img.closest('#edit-textarea, #edit-summary, [contenteditable="true"]') || document.getElementById('edit-textarea');
  selectEditorImage(img, editorEl);
}
window.handleImageClickForResize = handleImageClickForResize;

// Global dismiss listeners
document.addEventListener('click', (e) => {
  if (!_activeEditorImage) return;
  if (e.target.closest('.editor-img-active-overlay, .img-resize-toolbar, .edit-img-thumb') || e.target === _activeEditorImage) {
    return;
  }
  hideImageActiveOverlay();
});

document.addEventListener('keydown', (e) => {
  if (!_activeEditorImage) return;
  if (e.key === 'Escape') {
    hideImageActiveOverlay();
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && !document.activeElement?.isContentEditable) {
    const img = _activeEditorImage;
    const parentEditor = img.closest('#edit-textarea, #edit-summary, [contenteditable="true"]');
    hideImageActiveOverlay();
    img.remove();
    if (parentEditor) {
      parentEditor.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (typeof syncImageStrip === 'function') syncImageStrip();
  }
});

const editPreview = document.getElementById('edit-preview');
if (editPreview) {
  editPreview.addEventListener('click', handleImageClickForResize);
  editPreview.addEventListener('scroll', syncScrollToEditor);
}
document.getElementById('edit-textarea')?.addEventListener('click', handleImageClickForResize);
document.getElementById('edit-summary')?.addEventListener('click', handleImageClickForResize);

document.getElementById('edit-textarea')?.addEventListener('input', () => { scheduleEditorInputRefresh(); scheduleAutoSave(); });
document.getElementById('edit-textarea')?.addEventListener('contextmenu', e => {
  showEditorContextMenu(e);
});
document.getElementById('edit-title')?.addEventListener('input', () => {
  scheduleAutoSave();
  updateTitleRenameHint();
  if (_isFocusedMode) {
    const val = document.getElementById('edit-title')?.value?.trim();
    document.title = (val || (typeof t === 'function' ? t('common.untitled') : 'Untitled')) + ' — ' + (typeof t === 'function' ? t('app.name') : 'Secretary');
  }
});
document.getElementById('edit-summary')?.addEventListener('input', () => { scheduleEditorInputRefresh(); scheduleAutoSave(); });



const editPreviewContent = document.getElementById('edit-preview-content');
if (editPreviewContent) {
  editPreviewContent.addEventListener('contextmenu', e => {
    showPreviewHighlightContextMenu(e);
  });
  editPreviewContent.addEventListener('click', e => {
    const ownerTag = e.target.closest('.owner-tag, .inline-reassign-owner');
    if (ownerTag) {
      e.preventDefault();
      e.stopPropagation();
      showInlineCollaboratorSelector(ownerTag);
      return;
    }
    const marker = e.target.closest('.note-todo, .note-todo-link, [data-todo-id]');
    if (marker) {
      let id = marker.getAttribute('data-todo-id');
      if (!id && marker.tagName === 'A') {
        const href = marker.getAttribute('href') || '';
        if (href.startsWith('#todo-')) id = href.replace('#todo-', '');
      }
      if (!id) return;
      const isViewMode = document.querySelector('.overlay-panel')?.classList.contains('overlay-view-mode');
      if (isViewMode) openTodoFromMarker(id);
      else openTodoFromMarkerEditMode(id);
      return;
    }

    const decisionMarker = e.target.closest('.note-decision-wrapper, .pill-decision, .note-decision-badge');
    if (decisionMarker) {
      const wrapper = decisionMarker.closest('.note-decision-wrapper') || decisionMarker;
      if (typeof handleDecisionClick === 'function') {
        handleDecisionClick(wrapper, e);
      }
    }
  });
}
// edit-textarea and edit-summary paste listeners are handled through attachRichTextShortcutsAndToolbar
document.getElementById('nn-content')?.addEventListener('paste', handleImagePaste);
document.getElementById('note-edit-overlay')?.addEventListener('paste', handleImagePaste);

['edit-textarea', 'edit-summary', 'nn-content'].forEach(id => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('dragover', e => {
      if (e.dataTransfer?.types?.includes('Files')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });
    el.addEventListener('drop', handleImageDrop);
  }
});

document.getElementById('edit-textarea')?.addEventListener('keydown', handleEditorKeydown);
document.getElementById('edit-textarea')?.addEventListener('keydown', handleRichEditorKeydown);

document.getElementById('edit-textarea')?.addEventListener('keyup', e => {
  if (typeof handleEditorAutocomplete === 'function') handleEditorAutocomplete(e);
  handleTableContext(e);
});
// ═══ Link Hover Action Menu ═══
let _editorLinkHoverMenu = null;
let _linkHoverHideTimer = null;
let _linkHoverShowTimer = null;
let _activeHoverLink = null;

function openExternalLink(url) {
  if (!url) return;
  try {
    if (window.AppBridge?.isElectron && window.AppBridge?.shell?.openExternal) {
      window.AppBridge.shell.openExternal(url);
      return;
    }
  } catch (err) {}
  window.open(url, '_blank', 'noopener,noreferrer');
}

function openNoteFromLink(linkEl) {
  if (!linkEl) return;
  const path = linkEl.getAttribute('data-note-path') || '';
  const id = linkEl.getAttribute('data-note-id') || '';
  let note = null;
  if (typeof manifest !== 'undefined' && Array.isArray(manifest)) {
    note = (path ? manifest.find(n => n.path === path) : null) || (id ? manifest.find(n => n.id === id) : null);
  }
  const targetPath = note?.path || path;
  if (!targetPath) return;

  const currentPath = typeof currentNote !== 'undefined' && currentNote?.path ? currentNote.path : '';
  if (currentPath && targetPath === currentPath) return;

  if (typeof openNestedNote === 'function') {
    openNestedNote(targetPath);
  } else if (typeof openNoteOverlay === 'function') {
    openNoteOverlay(targetPath);
  }
}

function unwrapLinkElement(linkEl, editorEl) {
  if (!linkEl || !linkEl.parentNode) return;
  const parent = linkEl.parentNode;
  while (linkEl.firstChild) {
    parent.insertBefore(linkEl.firstChild, linkEl);
  }
  linkEl.remove();
  hideEditorLinkHoverMenu();
  if (editorEl) {
    editorEl.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

async function editLinkElement(linkEl, editorEl) {
  if (!linkEl) return;
  const currentUrl = linkEl.getAttribute('href') || '';
  hideEditorLinkHoverMenu();
  const newUrl = await showPromptDialog(typeof t === 'function' ? t('editor.editLink') || 'Edit Link:' : 'Edit Link:', currentUrl);
  if (newUrl && newUrl.trim()) {
    let finalUrl = newUrl.trim();
    if (/^www\./i.test(finalUrl)) finalUrl = 'https://' + finalUrl;
    linkEl.setAttribute('href', finalUrl);
    if (linkEl.textContent === currentUrl) {
      linkEl.textContent = finalUrl;
    }
    if (editorEl) {
      editorEl.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
}

function copyLinkElementUrl(linkEl) {
  if (!linkEl) return;
  const url = linkEl.getAttribute('href') || linkEl.getAttribute('data-note-path') || linkEl.textContent || '';
  if (url && navigator?.clipboard?.writeText) {
    navigator.clipboard.writeText(url).then(() => {
      if (typeof toast === 'function') {
        toast(typeof t === 'function' ? t('editor.linkCopied') || 'Link copied to clipboard' : 'Link copied to clipboard');
      }
    }).catch(() => {});
  }
}

function hideEditorLinkHoverMenu() {
  if (_linkHoverShowTimer) { clearTimeout(_linkHoverShowTimer); _linkHoverShowTimer = null; }
  if (_editorLinkHoverMenu) {
    _editorLinkHoverMenu.classList.remove('active');
    _editorLinkHoverMenu.style.pointerEvents = 'none';
  }
  _activeHoverLink = null;
}

function showEditorLinkHoverMenu(linkEl, editorEl) {
  if (!linkEl || !linkEl.isConnected) return;
  _activeHoverLink = linkEl;
  if (!_editorLinkHoverMenu) {
    _editorLinkHoverMenu = document.createElement('div');
    _editorLinkHoverMenu.className = 'editor-link-hover-menu';
    _editorLinkHoverMenu.setAttribute('contenteditable', 'false');
    document.body.appendChild(_editorLinkHoverMenu);

    _editorLinkHoverMenu.addEventListener('mouseenter', () => {
      if (_linkHoverHideTimer) { clearTimeout(_linkHoverHideTimer); _linkHoverHideTimer = null; }
    });
    _editorLinkHoverMenu.addEventListener('mouseleave', () => {
      _linkHoverHideTimer = setTimeout(hideEditorLinkHoverMenu, 250);
    });
  }

  const isNoteLink = linkEl.classList.contains('note-link') || linkEl.classList.contains('wiki-link') || linkEl.hasAttribute('data-note-id') || linkEl.hasAttribute('data-note-path');
  const href = linkEl.getAttribute('href') || '';
  const text = linkEl.textContent.trim();

  _editorLinkHoverMenu.innerHTML = '';

  if (isNoteLink) {
    const preview = document.createElement('span');
    preview.className = 'editor-link-preview-text';
    preview.textContent = text || 'Note';
    preview.title = (typeof t === 'function' ? t('editor.openNoteLinkTooltip') : 'Open note');
    preview.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openNoteFromLink(linkEl);
      hideEditorLinkHoverMenu();
    });
    _editorLinkHoverMenu.appendChild(preview);

    const divider = document.createElement('div');
    divider.className = 'editor-link-hover-divider';
    _editorLinkHoverMenu.appendChild(divider);

    const openBtn = document.createElement('button');
    openBtn.className = 'editor-link-hover-btn';
    openBtn.title = (typeof t === 'function' ? t('editor.openNoteLinkTooltip') : 'Open note');
    openBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg><span>${escH(typeof t === 'function' ? t('editor.openLink') || 'Open' : 'Open')}</span>`;
    openBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openNoteFromLink(linkEl);
      hideEditorLinkHoverMenu();
    });
    _editorLinkHoverMenu.appendChild(openBtn);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'editor-link-hover-btn btn-remove';
    removeBtn.title = (typeof t === 'function' ? t('editor.removeLinkTooltip') : 'Remove link');
    removeBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg><span>${escH(typeof t === 'function' ? t('editor.removeLink') || 'Remove' : 'Remove')}</span>`;
    removeBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      unwrapLinkElement(linkEl, editorEl);
    });
    _editorLinkHoverMenu.appendChild(removeBtn);
  } else {
    const preview = document.createElement('span');
    preview.className = 'editor-link-preview-text';
    preview.textContent = href || text || 'Link';
    preview.title = href || text;
    preview.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openExternalLink(href);
      hideEditorLinkHoverMenu();
    });
    _editorLinkHoverMenu.appendChild(preview);

    const divider = document.createElement('div');
    divider.className = 'editor-link-hover-divider';
    _editorLinkHoverMenu.appendChild(divider);

    const openBtn = document.createElement('button');
    openBtn.className = 'editor-link-hover-btn';
    openBtn.title = (typeof t === 'function' ? t('editor.openLinkTooltip') : 'Open link in browser');
    openBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg><span>${escH(typeof t === 'function' ? t('editor.openLink') || 'Open' : 'Open')}</span>`;
    openBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openExternalLink(href);
      hideEditorLinkHoverMenu();
    });
    _editorLinkHoverMenu.appendChild(openBtn);

    const editBtn = document.createElement('button');
    editBtn.className = 'editor-link-hover-btn';
    editBtn.title = (typeof t === 'function' ? t('editor.editLinkTooltip') : 'Edit link');
    editBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg><span>${escH(typeof t === 'function' ? t('editor.editLink') || 'Edit' : 'Edit')}</span>`;
    editBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      editLinkElement(linkEl, editorEl);
    });
    _editorLinkHoverMenu.appendChild(editBtn);

    const copyBtn = document.createElement('button');
    copyBtn.className = 'editor-link-hover-btn';
    copyBtn.title = (typeof t === 'function' ? t('editor.copyLinkTooltip') : 'Copy link');
    copyBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><span>${escH(typeof t === 'function' ? t('editor.copyLink') || 'Copy' : 'Copy')}</span>`;
    copyBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      copyLinkElementUrl(linkEl);
    });
    _editorLinkHoverMenu.appendChild(copyBtn);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'editor-link-hover-btn btn-remove';
    removeBtn.title = (typeof t === 'function' ? t('editor.removeLinkTooltip') : 'Remove link');
    removeBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg><span>${escH(typeof t === 'function' ? t('editor.removeLink') || 'Remove' : 'Remove')}</span>`;
    removeBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      unwrapLinkElement(linkEl, editorEl);
    });
    _editorLinkHoverMenu.appendChild(removeBtn);
  }

  // Positioning
  _editorLinkHoverMenu.style.visibility = 'hidden';
  _editorLinkHoverMenu.style.display = 'flex';
  const rect = linkEl.getBoundingClientRect();
  const menuRect = _editorLinkHoverMenu.getBoundingClientRect();

  let top = rect.bottom + window.scrollY + 6;
  if (rect.bottom + menuRect.height + 12 > window.innerHeight && rect.top > menuRect.height + 12) {
    top = rect.top + window.scrollY - menuRect.height - 6;
  }
  const left = Math.max(10, Math.min(window.innerWidth - menuRect.width - 10, rect.left + window.scrollX));

  _editorLinkHoverMenu.style.top = `${top}px`;
  _editorLinkHoverMenu.style.left = `${left}px`;
  _editorLinkHoverMenu.style.visibility = '';
  _editorLinkHoverMenu.classList.add('active');
  _editorLinkHoverMenu.style.pointerEvents = 'auto';
}

if (typeof document !== 'undefined') {
  document.addEventListener('mouseover', (e) => {
    const linkEl = e.target.closest('#edit-textarea a, #edit-summary a, #nn-content a, .wiki-link, .note-link');
    if (!linkEl) return;
    const editorEl = linkEl.closest('#edit-textarea, #edit-summary, #nn-content');
    if (!editorEl) return;
    if (_linkHoverHideTimer) { clearTimeout(_linkHoverHideTimer); _linkHoverHideTimer = null; }
    if (_activeHoverLink === linkEl && _editorLinkHoverMenu?.classList.contains('active')) return;
    _activeHoverLink = linkEl;
    if (_linkHoverShowTimer) clearTimeout(_linkHoverShowTimer);
    _linkHoverShowTimer = setTimeout(() => {
      showEditorLinkHoverMenu(linkEl, editorEl);
    }, 120);
  });

  document.addEventListener('mouseout', (e) => {
    const linkEl = e.target.closest('#edit-textarea a, #edit-summary a, #nn-content a, .wiki-link, .note-link');
    if (!linkEl) return;
    if (_linkHoverShowTimer) { clearTimeout(_linkHoverShowTimer); _linkHoverShowTimer = null; }
    if (_linkHoverHideTimer) clearTimeout(_linkHoverHideTimer);
    _linkHoverHideTimer = setTimeout(() => {
      hideEditorLinkHoverMenu();
    }, 280);
  });

  window.addEventListener('scroll', () => {
    if (_editorLinkHoverMenu?.classList.contains('active')) {
      hideEditorLinkHoverMenu();
    }
  }, true);
}

window.openExternalLink = openExternalLink;
window.openNoteFromLink = openNoteFromLink;
window.unwrapLinkElement = unwrapLinkElement;
window.editLinkElement = editLinkElement;
window.copyLinkElementUrl = copyLinkElementUrl;
window.showEditorLinkHoverMenu = showEditorLinkHoverMenu;
window.hideEditorLinkHoverMenu = hideEditorLinkHoverMenu;

document.getElementById('edit-textarea')?.addEventListener('click', e => {
  if (typeof closeAutocomplete === 'function') closeAutocomplete(e);
  handleTableContext(e);

  const linkEl = e.target.closest('a, .wiki-link, .note-link');
  if (linkEl) {
    const isNoteLink = linkEl.classList.contains('note-link') || linkEl.classList.contains('wiki-link') || linkEl.hasAttribute('data-note-id') || linkEl.hasAttribute('data-note-path');
    if (isNoteLink) {
      e.preventDefault();
      e.stopPropagation();
      openNoteFromLink(linkEl);
      return;
    }
    const href = linkEl.getAttribute('href');
    if (href && href !== '#' && !href.startsWith('javascript:')) {
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        e.stopPropagation();
        openExternalLink(href);
        return;
      }
    }
  }

  const mathMarker = e.target.closest('.note-math, .note-math-block');
  if (mathMarker) {
    const isView = document.querySelector('.overlay-panel')?.classList.contains('overlay-view-mode');
    if (!isView) {
      e.stopPropagation();
      e.preventDefault();
      openMathFormulaEditor(mathMarker, document.getElementById('edit-textarea'));
      return;
    }
  }

  const todoMarker = e.target.closest('.note-todo, .note-todo-link, [data-todo-id]');
  if (todoMarker) {
    let id = todoMarker.getAttribute('data-todo-id');
    if (!id && todoMarker.tagName === 'A') {
      const href = todoMarker.getAttribute('href') || '';
      if (href.startsWith('#todo-')) id = href.replace('#todo-', '');
    }
    if (id && typeof openTodoFromMarkerEditMode === 'function') {
      openTodoFromMarkerEditMode(id);
      return;
    }
  }

  const decisionMarker = e.target.closest('.note-decision-wrapper, .pill-decision, .note-decision-badge');
  if (decisionMarker) {
    const wrapper = decisionMarker.closest('.note-decision-wrapper') || decisionMarker;
    if (typeof handleDecisionClick === 'function') {
      handleDecisionClick(wrapper, e);
      return;
    }
  }

  const isViewMode = document.querySelector('.overlay-panel')?.classList.contains('overlay-view-mode');
  if (isViewMode) {
    if (e.target.closest('a, .note-todo, .note-decision-wrapper, button, .fmt-btn')) return;
    enterOverlayEditMode();
  }
});
document.getElementById('edit-summary')?.addEventListener('click', e => {
  const linkEl = e.target.closest('a, .wiki-link, .note-link');
  if (linkEl) {
    const isNoteLink = linkEl.classList.contains('note-link') || linkEl.classList.contains('wiki-link') || linkEl.hasAttribute('data-note-id') || linkEl.hasAttribute('data-note-path');
    if (isNoteLink) {
      e.preventDefault();
      e.stopPropagation();
      openNoteFromLink(linkEl);
      return;
    }
    const href = linkEl.getAttribute('href');
    if (href && href !== '#' && !href.startsWith('javascript:')) {
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        e.stopPropagation();
        openExternalLink(href);
        return;
      }
    }
  }

  const mathMarker = e.target.closest('.note-math, .note-math-block');
  if (mathMarker) {
    const isView = document.querySelector('.overlay-panel')?.classList.contains('overlay-view-mode');
    if (!isView) {
      e.stopPropagation();
      e.preventDefault();
      openMathFormulaEditor(mathMarker, document.getElementById('edit-summary'));
      return;
    }
  }

  const isViewMode = document.querySelector('.overlay-panel')?.classList.contains('overlay-view-mode');
  if (isViewMode) {
    if (e.target.closest('a, .note-todo, button')) return;
    enterOverlayEditMode();
  }
});

function getCaretRangeFromPoint(x, y) {
  if (document.caretRangeFromPoint) {
    return document.caretRangeFromPoint(x, y);
  }
  if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(x, y);
    if (pos && pos.offsetNode) {
      const range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.collapse(true);
      return range;
    }
  }
  return null;
}

function handleEditorRowRightClick(e) {
  // Only primary mouse button (left-click), no keyboard modifiers, single click
  if (e.button !== 0 || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return;
  if (e.detail > 1) return;

  // Ignore interactive UI elements inside or above the editor
  if (e.target.closest('a, button, input, select, textarea, .summary-ai-btn, .fmt-btn, .img-resize-toolbar, .table-context-toolbar, .metadata-summary-proposal-box, .note-card-context-menu, .note-todo, .note-decision-wrapper, .pill-decision, .pill-mention, .pill-delegation, .note-summary-header, .note-body-header')) {
    return;
  }

  // Find target editor
  let targetEditor = null;
  if (e.target.closest('#edit-summary')) {
    targetEditor = document.getElementById('edit-summary');
  } else if (e.target.closest('#refactor-proposal-preview-pane')) {
    targetEditor = document.getElementById('refactor-proposal-preview-pane');
  } else if (e.target.closest('#edit-textarea, .editor-page, #edit-pane-left, .edit-editor-pane, .edit-body')) {
    targetEditor = document.getElementById('edit-textarea');
  }

  if (!targetEditor) return;

  // If the user clicked DIRECTLY inside the editor, let native browser contenteditable handle caret placement!
  if (targetEditor.contains(e.target)) {
    return;
  }

  // If in view mode, switch to edit mode first
  const isViewMode = document.querySelector('.overlay-panel')?.classList.contains('overlay-view-mode');
  if (isViewMode) {
    if (typeof enterOverlayEditMode === 'function') {
      enterOverlayEditMode();
    }
  }

  if (targetEditor.contentEditable !== 'true' && !targetEditor.isContentEditable) {
    targetEditor.setAttribute('contenteditable', 'true');
  }

  const editorRect = targetEditor.getBoundingClientRect();
  if (!editorRect.width || !editorRect.height) return;

  // User clicked in empty margin or below targetEditor
  if (e.clientY > editorRect.bottom) {
    // Clicked below editor content -> place caret at the end of editor
    e.preventDefault();
    targetEditor.focus();
    if (typeof _lastFocusedEditor !== 'undefined') _lastFocusedEditor = targetEditor;
    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.selectNodeContents(targetEditor);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    return;
  }

  const style = window.getComputedStyle(targetEditor);
  const paddingRight = parseFloat(style.paddingRight) || 16;
  const paddingLeft = parseFloat(style.paddingLeft) || 16;
  const rightEdge = editorRect.right - paddingRight;
  const leftEdge = editorRect.left + paddingLeft;

  // Clamped Y inside editor bounds
  const clampedY = Math.max(editorRect.top + 4, Math.min(editorRect.bottom - 4, e.clientY));
  const probeX = e.clientX < editorRect.left ? leftEdge + 2 : rightEdge - 2;
  const range = getCaretRangeFromPoint(probeX, clampedY);

  if (range && targetEditor.contains(range.startContainer)) {
    e.preventDefault();
    targetEditor.focus();
    if (typeof _lastFocusedEditor !== 'undefined') _lastFocusedEditor = targetEditor;
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }
}

document.addEventListener('mousedown', handleEditorRowRightClick);
document.getElementById('nn-content')?.addEventListener('keyup', e => {
  if (typeof handleEditorAutocomplete === 'function') handleEditorAutocomplete(e);
});
document.getElementById('nn-content')?.addEventListener('click', e => {
  if (typeof closeAutocomplete === 'function') closeAutocomplete(e);
});
document.getElementById('nn-content')?.addEventListener('keydown', e => {
  if (typeof handleAutocompleteKeydown === 'function' && handleAutocompleteKeydown(e)) {
    return;
  }
});

// Inline urgency selection handler
window.setTodoUrgencyInline = function(optEl, priority) {
  const todoSpan = optEl.closest('.note-todo');
  if (!todoSpan) return;
  todoSpan.setAttribute('data-todo-priority', priority);
  const valEl = todoSpan.querySelector('.todo-urgency-value');
  if (valEl) {
    valEl.textContent = priority;
  }
  
  // Update todo in global manifest if exists
  const todoId = todoSpan.getAttribute('data-todo-id');
  if (todoId && !todoId.startsWith('temp-')) {
    const existing = todosManifest.find(t => t.id === todoId);
    if (existing) {
      existing.priority = priority;
      existing.modified = new Date().toISOString().slice(0, 10);
      if (typeof saveTodosManifest === 'function') {
        saveTodosManifest().then(() => {
          if (typeof renderBoard === 'function') renderBoard();
        });
      }
    }
  }

  // Trigger input to sync and save
  const ta = document.getElementById('edit-textarea');
  if (ta) ta.dispatchEvent(new Event('input', { bubbles: true }));
};

function showInlineCollaboratorSelector(pill) {
  const existing = document.getElementById('inline-collab-selector');
  if (existing) existing.remove();
  
  const dropdown = document.createElement('div');
  dropdown.id = 'inline-collab-selector';
  dropdown.className = 'note-card-context-menu editor-text-context-menu';
  dropdown.style.position = 'absolute';
  dropdown.style.zIndex = 3000;
  
  const rect = pill.getBoundingClientRect();
  dropdown.style.top = (window.scrollY + rect.bottom) + 'px';
  dropdown.style.left = (window.scrollX + rect.left) + 'px';
  
  const collaborators = typeof getVisibleCollaboratorNames === 'function' ? getVisibleCollaboratorNames() : [];
  if (!collaborators.length) return;
  
  collaborators.forEach(name => {
    const btn = document.createElement('button');
    btn.className = 'ctx-btn';
    btn.textContent = name;
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      
      const mentionData = typeof resolveMentionRenderData === 'function' ? resolveMentionRenderData(name) : { id: '', label: name };
      const isDelegation = pill.classList.contains('pill-delegation');
      const isOwnerTag = pill.classList.contains('owner-tag') || pill.classList.contains('inline-reassign-owner');
      const selectedName = mentionData.label || name;
      const ownerId = mentionData.id || selectedName;
      
      if (mentionData.id) {
        pill.setAttribute('data-colleague-id', mentionData.id);
      } else {
        pill.removeAttribute('data-colleague-id');
      }
      pill.setAttribute('data-colleague-label', selectedName);
      pill.setAttribute('data-owner', selectedName);
      
      if (isOwnerTag) {
        const badgeLabel = selectedName === 'me' ? '@me' : `@${selectedName.replace(/^@/, '')}`;
        pill.textContent = `👤 ${badgeLabel}`;
        const reassignTooltip = typeof t === 'function' ? (t('todo.reassignColleagueTooltip') || 'Click to reassign colleague') : 'Click to reassign colleague';
        pill.title = reassignTooltip;

        const todoSpan = pill.closest('.note-todo');
        if (todoSpan) {
          todoSpan.setAttribute('data-owner', selectedName);
          todoSpan.setAttribute('data-owner-id', ownerId);

          const todoId = todoSpan.getAttribute('data-todo-id');
          if (todoId && typeof todosManifest !== 'undefined' && Array.isArray(todosManifest)) {
            const existing = todosManifest.find(t => t.id === todoId);
            if (existing) {
              existing.owner = selectedName;
              existing.ownerId = ownerId;
              existing.modified = new Date().toISOString().slice(0, 10);
              if (typeof saveTodosManifest === 'function') {
                saveTodosManifest().then(() => {
                  if (typeof renderBoard === 'function') renderBoard();
                });
              }
            }
          }
        }

        const wrapper = pill.closest('.inline-proposal-wrapper');
        if (wrapper) {
          wrapper.setAttribute('data-todo-owner', selectedName);
          wrapper.setAttribute('data-colleague-name', selectedName);
          wrapper.setAttribute('data-owner', selectedName);
        }
      } else if (isDelegation) {
        pill.textContent = `⏳ Delegated to @${selectedName}`;
      } else {
        pill.textContent = `@${selectedName}`;
      }
      
      const ta = document.getElementById('edit-textarea');
      if (ta) ta.dispatchEvent(new Event('input', { bubbles: true }));
      
      dropdown.remove();
    });
    dropdown.appendChild(btn);
  });
  
  document.body.appendChild(dropdown);
  
  const dismiss = (ev) => {
    if (!dropdown.contains(ev.target)) {
      dropdown.remove();
      document.removeEventListener('click', dismiss, true);
    }
  };
  setTimeout(() => {
    document.addEventListener('click', dismiss, true);
  }, 0);
}

document.getElementById('edit-textarea')?.addEventListener('click', e => {
  const pill = e.target.closest('.pill-mention, .pill-delegation, .owner-tag, .inline-reassign-owner');
  if (!pill) return;
  
  const ta = document.getElementById('edit-textarea');
  if (!ta || ta.contentEditable !== 'true') return;
  
  e.preventDefault();
  e.stopPropagation();
  
  showInlineCollaboratorSelector(pill);
});

// Double-click to open edit todo or decision modal dialog
document.getElementById('edit-textarea')?.addEventListener('dblclick', e => {
  const marker = e.target.closest('.note-todo, .note-todo-link, [data-todo-id]');
  if (marker) {
    let id = marker.getAttribute('data-todo-id');
    if (!id && marker.tagName === 'A') {
      const href = marker.getAttribute('href') || '';
      if (href.startsWith('#todo-')) id = href.replace('#todo-', '');
    }
    if (id && typeof openTodoFromMarkerEditMode === 'function') {
      openTodoFromMarkerEditMode(id);
      return;
    }
  }
  const decisionMarker = e.target.closest('.note-decision-wrapper');
  if (decisionMarker) {
    if (typeof handleDecisionClick === 'function') {
      handleDecisionClick(decisionMarker, e);
      return;
    }
  }
});

// Delegate blur handler for draft element committing
document.getElementById('edit-textarea')?.addEventListener('blur', e => {
  const target = e.target;
  if (!target) return;
  const isTodoText = target.classList.contains('note-todo-text');
  const isDecisionText = target.classList.contains('note-decision-text');
  if (!isTodoText && !isDecisionText) return;

  const wrapper = target.closest('.note-todo, .note-decision-wrapper');
  if (wrapper) {
    if (wrapper.classList.contains('note-todo-draft') || wrapper.classList.contains('note-decision-draft')) {
      wrapper.classList.remove('note-todo-draft');
      wrapper.classList.remove('note-decision-draft');
      
      const ta = document.getElementById('edit-textarea');
      if (ta) ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
}, true); // Capture phase is required because blur does not bubble

// Update active states of formatting toolbar buttons on selection change
function updateToolbarActiveStates() {
  const ta = _lastFocusedEditor || document.getElementById('edit-textarea');
  if (!ta) return;

  const selection = window.getSelection();
  const anchorNode = selection?.anchorNode || null;
  const focusNode = selection?.focusNode || null;
  const inEditor = !!(selection && selection.rangeCount > 0 && anchorNode && focusNode && ta.contains(anchorNode) && ta.contains(focusNode));

  if (!inEditor) {
    document.querySelectorAll('.md-format-toolbar .fmt-btn.on').forEach(btn => btn.classList.remove('on'));
    return;
  }

  const isCollapsed = !!selection.isCollapsed;
  const anchorBold = _isNodeWithinSelector(anchorNode, ta, 'strong, b');
  const focusBold = _isNodeWithinSelector(focusNode, ta, 'strong, b');
  const anchorItalic = _isNodeWithinSelector(anchorNode, ta, 'em, i');
  const focusItalic = _isNodeWithinSelector(focusNode, ta, 'em, i');
  const anchorUnderline = _isNodeWithinSelector(anchorNode, ta, 'u');
  const focusUnderline = _isNodeWithinSelector(focusNode, ta, 'u');
  const anchorStrike = _isNodeWithinSelector(anchorNode, ta, 'strike, s, del');
  const focusStrike = _isNodeWithinSelector(focusNode, ta, 'strike, s, del');
  const anchorCode = _isNodeWithinSelector(anchorNode, ta, 'code');
  const focusCode = _isNodeWithinSelector(focusNode, ta, 'code');
  const anchorMark = _isNodeWithinSelector(anchorNode, ta, 'mark');
  const focusMark = _isNodeWithinSelector(focusNode, ta, 'mark');

  const hasQueryCmd = typeof document.queryCommandState === 'function';
  const isBold = isCollapsed ? ((hasQueryCmd && document.queryCommandState('bold')) || anchorBold) : (anchorBold && focusBold);
  const isItalic = isCollapsed ? ((hasQueryCmd && document.queryCommandState('italic')) || anchorItalic) : (anchorItalic && focusItalic);
  const isUnderline = isCollapsed ? ((hasQueryCmd && document.queryCommandState('underline')) || anchorUnderline) : (anchorUnderline && focusUnderline);
  const isStrike = isCollapsed ? ((hasQueryCmd && document.queryCommandState('strikeThrough')) || anchorStrike) : (anchorStrike && focusStrike);

  document.querySelector('.fmt-btn.fmt-bold')?.classList.toggle('on', !!isBold);
  document.querySelector('.fmt-btn.fmt-italic')?.classList.toggle('on', !!isItalic);
  document.querySelector('.fmt-btn.fmt-underline')?.classList.toggle('on', !!isUnderline);
  document.querySelector('.fmt-btn.fmt-strike')?.classList.toggle('on', !!isStrike);

  // 2. Traverse up from anchor to check container tags
  let isH1 = false;
  let isH2 = false;
  let isH3 = false;
  let isBlockquote = false;
  let isCode = isCollapsed ? anchorCode : (anchorCode && focusCode);
  let isMark = isCollapsed ? anchorMark : (anchorMark && focusMark);
  let isUl = false;
  let isOl = false;
  let isChecklist = isSelectionInChecklist();

  const anchorH1 = _getClosestTag(anchorNode, ta, 'h1');
  const focusH1 = _getClosestTag(focusNode, ta, 'h1');
  const anchorH2 = _getClosestTag(anchorNode, ta, 'h2');
  const focusH2 = _getClosestTag(focusNode, ta, 'h2');
  const anchorH3 = _getClosestTag(anchorNode, ta, 'h3');
  const focusH3 = _getClosestTag(focusNode, ta, 'h3');
  const anchorQuote = _getClosestTag(anchorNode, ta, 'blockquote');
  const focusQuote = _getClosestTag(focusNode, ta, 'blockquote');
  const anchorUl = _getClosestTag(anchorNode, ta, 'ul');
  const focusUl = _getClosestTag(focusNode, ta, 'ul');
  const anchorOl = _getClosestTag(anchorNode, ta, 'ol');
  const focusOl = _getClosestTag(focusNode, ta, 'ol');

  isH1 = isCollapsed ? !!anchorH1 : !!anchorH1 && !!focusH1 && anchorH1 === focusH1;
  isH2 = isCollapsed ? !!anchorH2 : !!anchorH2 && !!focusH2 && anchorH2 === focusH2;
  isH3 = isCollapsed ? !!anchorH3 : !!anchorH3 && !!focusH3 && anchorH3 === focusH3;
  isBlockquote = isCollapsed ? !!anchorQuote : !!anchorQuote && !!focusQuote && anchorQuote === focusQuote;
  isUl = isCollapsed ? !!anchorUl : !!anchorUl && !!focusUl && anchorUl === focusUl;
  isOl = isCollapsed ? !!anchorOl : !!anchorOl && !!focusOl && anchorOl === focusOl;

  document.querySelector('.fmt-btn.fmt-h1')?.classList.toggle('on', isH1);
  document.querySelector('.fmt-btn.fmt-h2')?.classList.toggle('on', isH2);
  document.querySelector('.fmt-btn.fmt-h3')?.classList.toggle('on', isH3);
  document.querySelector('.fmt-btn.fmt-p')?.classList.toggle('on', !isH1 && !isH2 && !isH3 && !isBlockquote && inEditor);
  document.querySelector('.fmt-btn.fmt-quote')?.classList.toggle('on', isBlockquote);
  document.querySelector('.fmt-btn.fmt-code')?.classList.toggle('on', isCode);
  document.querySelector('.fmt-btn.fmt-highlight')?.classList.toggle('on', isMark);
  document.getElementById('fmt-btn-ul')?.classList.toggle('on', isUl);
  document.getElementById('fmt-btn-ol')?.classList.toggle('on', isOl);
  document.querySelector('.fmt-btn.fmt-checklist')?.classList.toggle('on', isChecklist);

  const hasFormatActive = isH1 || isH2 || isH3 || isBold || isItalic || isUnderline || isStrike || isCode || isMark || isBlockquote;
  document.getElementById('btn-format-aa')?.classList.toggle('has-active-style', hasFormatActive);
}

function toggleFormatAaPopover(event) {
  if (event) {
    if (typeof event.preventDefault === 'function') event.preventDefault();
    if (typeof event.stopPropagation === 'function') event.stopPropagation();
  }
  const popover = document.getElementById('format-aa-popover');
  const btn = document.getElementById('btn-format-aa');
  if (!popover || !btn) return;

  const isVisible = popover.style.display !== 'none';
  if (isVisible) {
    if (window.PopoverManager) {
      window.PopoverManager.close('format-aa-popover');
    } else {
      popover.style.display = 'none';
    }
    btn.classList.remove('active');
    btn.setAttribute('aria-expanded', 'false');
    return;
  }

  // Position popover directly below the 'Aa' button
  const rect = btn.getBoundingClientRect();
  popover.style.position = 'fixed';
  popover.style.top = `${rect.bottom + 6}px`;
  popover.style.left = `${Math.max(12, rect.left)}px`;
  popover.style.display = 'flex';
  btn.classList.add('active');
  btn.setAttribute('aria-expanded', 'true');

  if (window.PopoverManager) {
    window.PopoverManager.register('format-aa-popover', popover, {
      ignoreElements: [btn],
      onClose: () => {
        popover.style.display = 'none';
        btn.classList.remove('active');
        btn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  if (typeof updateToolbarActiveStates === 'function') {
    updateToolbarActiveStates();
  }
}

if (typeof window !== 'undefined') {
  window.toggleFormatAaPopover = toggleFormatAaPopover;
}

function toggleInsertItemsPopover(event) {
  if (event) {
    if (typeof event.preventDefault === 'function') event.preventDefault();
    if (typeof event.stopPropagation === 'function') event.stopPropagation();
  }
  const popover = document.getElementById('insert-items-popover');
  const btn = document.getElementById('btn-insert-items');
  if (!popover || !btn) return;

  const isVisible = popover.style.display !== 'none';
  if (isVisible) {
    closeInsertItemsPopover();
    return;
  }

  // Close format Aa popover if open
  const aaPopover = document.getElementById('format-aa-popover');
  if (aaPopover && aaPopover.style.display !== 'none') {
    if (window.PopoverManager) {
      window.PopoverManager.close('format-aa-popover');
    } else {
      aaPopover.style.display = 'none';
      document.getElementById('btn-format-aa')?.classList.remove('active');
    }
  }

  // Position popover directly below the 'Insert' button
  const rect = btn.getBoundingClientRect();
  popover.style.position = 'fixed';
  popover.style.top = `${rect.bottom + 6}px`;
  const popoverWidth = 270;
  const left = Math.min(window.innerWidth - popoverWidth - 12, Math.max(12, rect.left));
  popover.style.left = `${left}px`;
  popover.style.display = 'flex';
  btn.classList.add('active');
  btn.setAttribute('aria-expanded', 'true');

  if (window.PopoverManager) {
    window.PopoverManager.register('insert-items-popover', popover, {
      ignoreElements: [btn],
      onClose: () => {
        closeInsertItemsPopover();
      }
    });
  }
}

function closeInsertItemsPopover() {
  const popover = document.getElementById('insert-items-popover');
  const btn = document.getElementById('btn-insert-items');
  if (popover) popover.style.display = 'none';
  if (btn) {
    btn.classList.remove('active');
    btn.setAttribute('aria-expanded', 'false');
  }
  if (window.PopoverManager && typeof window.PopoverManager.close === 'function') {
    window.PopoverManager.close('insert-items-popover');
  }
}

if (typeof window !== 'undefined') {
  window.toggleInsertItemsPopover = toggleInsertItemsPopover;
  window.closeInsertItemsPopover = closeInsertItemsPopover;
}

let _lastFocusedEditor = null;

function updateToolbarForFocusedElement(focusedEl) {
  const isSummary = focusedEl && focusedEl.id === 'edit-summary';
  
  // 1. Todo priority toolbar
  const todoToolbar = document.getElementById('todo-priority-toolbar');
  if (todoToolbar) {
    if (isSummary) {
      todoToolbar.style.opacity = '0.4';
      todoToolbar.style.pointerEvents = 'none';
      todoToolbar.querySelectorAll('button').forEach(btn => btn.disabled = true);
    } else {
      todoToolbar.style.opacity = '';
      todoToolbar.style.pointerEvents = '';
      todoToolbar.querySelectorAll('button').forEach(btn => btn.disabled = false);
    }
  }

  // 2. Format toolbar restricted buttons: H3, Link, Table, Checklist
  const restrictedSelectors = ['.fmt-btn.fmt-h3', '.md-format-toolbar button[onclick*="link"]', '.md-format-toolbar button[onclick*="table"]', '.fmt-btn.fmt-checklist'];
  restrictedSelectors.forEach(selector => {
    const el = document.querySelector(selector);
    if (el) {
      if (isSummary) {
        el.style.opacity = '0.4';
        el.style.pointerEvents = 'none';
        el.disabled = true;
      } else {
        el.style.opacity = '';
        el.style.pointerEvents = '';
        el.disabled = false;
      }
    }
  });
}

document.addEventListener('selectionchange', () => {
  const selection = window.getSelection();
  const anchorNode = selection?.anchorNode || null;
  const ta = document.getElementById('edit-textarea');
  const summary = document.getElementById('edit-summary');
  const wsSummary = document.getElementById('ws-dossier-summary');
  const scratchEditor = document.getElementById('scratchpad-modal-editor');
  const refactorEditor = document.getElementById('refactor-proposal-preview-pane');

  if (ta && anchorNode && ta.contains(anchorNode)) {
    _lastFocusedEditor = ta;
    updateToolbarForFocusedElement(ta);
    updateToolbarActiveStates();
    if (!selection.isCollapsed && (selection.toString() || '').trim().length > 0) {
      showFloatingFormatToolbarForSelection(ta);
    } else {
      hideFloatingFormatToolbar();
    }
  } else if (summary && anchorNode && summary.contains(anchorNode)) {
    _lastFocusedEditor = summary;
    updateToolbarForFocusedElement(summary);
    updateToolbarActiveStates();
    if (!selection.isCollapsed && (selection.toString() || '').trim().length > 0) {
      showFloatingFormatToolbarForSelection(summary);
    } else {
      hideFloatingFormatToolbar();
    }
  } else if (wsSummary && anchorNode && wsSummary.contains(anchorNode)) {
    _lastFocusedEditor = wsSummary;
    if (!selection.isCollapsed && (selection.toString() || '').trim().length > 0) {
      showFloatingFormatToolbarForSelection(wsSummary);
    } else {
      hideFloatingFormatToolbar();
    }
  } else if (scratchEditor && anchorNode && scratchEditor.contains(anchorNode)) {
    _lastFocusedEditor = scratchEditor;
    if (!selection.isCollapsed && (selection.toString() || '').trim().length > 0) {
      showFloatingFormatToolbarForSelection(scratchEditor);
    } else {
      hideFloatingFormatToolbar();
    }
  } else if (refactorEditor && anchorNode && refactorEditor.contains(anchorNode)) {
    _lastFocusedEditor = refactorEditor;
    if (!selection.isCollapsed && (selection.toString() || '').trim().length > 0) {
      showFloatingFormatToolbarForSelection(refactorEditor);
    } else {
      hideFloatingFormatToolbar();
    }
  } else {
    // Selection outside any editor
    const activeEl = document.activeElement;
    if (!_floatingFormatToolbar || (!_floatingFormatToolbar.contains(activeEl) && !_floatingFormatToolbar.contains(anchorNode))) {
      hideFloatingFormatToolbar();
    }
  }
});

// Focus listeners
(function() {
  const setupFocusListeners = () => {
    if (typeof document === 'undefined') return;
    const ta = document.getElementById('edit-textarea');
    const summary = document.getElementById('edit-summary');
    if (ta) {
      if (!ta._hasToolbarFocusListener) {
        ta._hasToolbarFocusListener = true;
        ta.addEventListener('focus', () => {
          _lastFocusedEditor = ta;
          updateToolbarForFocusedElement(ta);
          updateToolbarActiveStates();
        });
        ta.addEventListener('keyup', () => updateToolbarActiveStates());
        ta.addEventListener('mouseup', () => updateToolbarActiveStates());
        ta.addEventListener('blur', () => {
          document.querySelectorAll('.md-format-toolbar .fmt-btn.on').forEach(btn => btn.classList.remove('on'));
        }, true);
        attachRichTextShortcutsAndToolbar(ta);
      }
    }
    if (summary) {
      if (!summary._hasToolbarFocusListener) {
        summary._hasToolbarFocusListener = true;
        summary.addEventListener('focus', () => {
          _lastFocusedEditor = summary;
          updateToolbarForFocusedElement(summary);
          updateToolbarActiveStates();
        });
        summary.addEventListener('keyup', () => updateToolbarActiveStates());
        summary.addEventListener('mouseup', () => updateToolbarActiveStates());
        summary.addEventListener('blur', () => {
          document.querySelectorAll('.md-format-toolbar .fmt-btn.on').forEach(btn => btn.classList.remove('on'));
        }, true);
        attachRichTextShortcutsAndToolbar(summary);
      }
    }
  };
  
  // Set them up initially and whenever note is opened
  setTimeout(setupFocusListeners, 100);
  window._setupEditorToolbarFocusListeners = setupFocusListeners;
})();

function handleEditorKeydown(e) {
  const ta = document.getElementById('edit-textarea');
  if (!ta || !ta.contains(e.target)) return;
  
  const isRich = ta.isContentEditable;
  const key = e.key;

  if (e.defaultPrevented) return;

  // Zoom shortcuts (Ctrl+=, Ctrl+-, Ctrl+0)
  if ((e.ctrlKey || e.metaKey) && (key === '=' || key === '+' || key === '-' || key === '0')) {
    e.preventDefault();
    if (key === '=' || key === '+') {
      zoomEditor(1);
    } else if (key === '-') {
      zoomEditor(-1);
    } else if (key === '0') {
      zoomEditor(0);
    }
    return;
  }

  // Autocomplete keydown handler
  if (typeof handleAutocompleteKeydown === 'function' && handleAutocompleteKeydown(e)) {
    return;
  }

  // Delegate rich text shortcuts (Tab, Space auto-lists, etc.)
  if (isRich) {
    if (typeof handleRichTextInputShortcuts === 'function' && handleRichTextInputShortcuts(e, ta)) {
      return;
    }
  }

  // Enter -> continue lists
  if (key === 'Enter') {
    if (isRich) {
      const selection = window.getSelection();
      if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        let node = range.commonAncestorContainer;
        if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
        
        // 0. Enter inside code block (<pre>)
        const codePre = node.closest('pre');
        if (codePre) {
          const text = codePre.textContent;
          if (text.endsWith('\n\n') || text.trim() === '') {
            e.preventDefault();
            const p = document.createElement('p');
            p.innerHTML = '<br>';
            codePre.parentNode.insertBefore(p, codePre.nextSibling);
            const newRange = document.createRange();
            newRange.selectNodeContents(p);
            newRange.collapse(true);
            selection.removeAllRanges();
            selection.addRange(newRange);
            p.focus();
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            return;
          }
        }

        // 1. Enter inside colleague text (.pill-mention) -> close element (put cursor after it)
        const mention = node.closest('.pill-mention');
        if (mention) {
          e.preventDefault();
          const br = document.createElement('br');
          const rangeAfter = document.createRange();
          rangeAfter.setStartAfter(mention);
          rangeAfter.collapse(true);
          rangeAfter.insertNode(br);
          
          const newRange = document.createRange();
          newRange.setStartAfter(br);
          newRange.collapse(true);
          selection.removeAllRanges();
          selection.addRange(newRange);
          
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          return;
        }

        // 2. Enter inside marked text (<mark>, <code>, etc.) -> close / end the format (type clean text next)
        const markOrInlineFmt = node.closest('mark, code, strong, em, strike, u, a');
        if (markOrInlineFmt) {
          e.preventDefault();
          
          let p = markOrInlineFmt.closest('p, li, h1, h2, h3, div');
          if (p === ta) {
            p = null;
          }
          const pBlock = p || markOrInlineFmt;
          
          // Find everything after the caret inside pBlock
          const nextRange = range.cloneRange();
          nextRange.selectNodeContents(pBlock);
          nextRange.setStart(range.endContainer, range.endOffset);
          const fragment = nextRange.extractContents();
          
          // Re-create next block
          const isInlineBlock = /^(MARK|CODE|STRONG|EM|STRIKE|U|A)$/i.test(pBlock.tagName);
          const nextBlockTag = isInlineBlock ? 'P' : pBlock.tagName;
          const nextBlock = document.createElement(nextBlockTag);
          nextBlock.appendChild(fragment);
          
          // Clean up empty formatting elements in the new block
          const inlineTags = nextBlock.querySelectorAll('mark, code, strong, em, strike, u, a');
          inlineTags.forEach(tagEl => {
            if (tagEl.textContent === '') {
              tagEl.remove();
            }
          });
          
          if (nextBlock.innerHTML.trim() === '') {
            nextBlock.innerHTML = '<br>';
          }
          
          pBlock.parentNode.insertBefore(nextBlock, pBlock.nextSibling);
          
          // Place caret at start of nextBlock
          const newRange = document.createRange();
          newRange.selectNodeContents(nextBlock);
          newRange.collapse(true);
          selection.removeAllRanges();
          selection.addRange(newRange);
          nextBlock.focus();
          
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          return;
        }

        // 3. Enter inside quote (blockquote)
        const blockquote = node.closest('blockquote');
        if (blockquote) {
          // If the blockquote contains only an empty line or is empty, convert it to standard paragraph
          if (blockquote.textContent.trim() === '') {
            e.preventDefault();
            const p = document.createElement('p');
            p.innerHTML = '<br>';
            blockquote.parentNode.replaceChild(p, blockquote);
            
            const newRange = document.createRange();
            newRange.selectNodeContents(p);
            newRange.collapse(true);
            selection.removeAllRanges();
            selection.addRange(newRange);
            p.focus();
            
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            return;
          }
        }

        // 4. Enter inside a header element -> split/end the format (make the next block a <p>)
        const header = node.closest('h1, h2, h3, h4, h5, h6');
        if (header && ta.contains(header)) {
          e.preventDefault();
          if (!range.collapsed) {
            range.deleteContents();
          }
          
          // Find everything after the caret inside the header
          const nextRange = range.cloneRange();
          nextRange.selectNodeContents(header);
          nextRange.setStart(range.endContainer, range.endOffset);
          const fragment = nextRange.extractContents();
          
          // The next block should be a <p> (format to text)
          const nextBlock = document.createElement('p');
          nextBlock.appendChild(fragment);
          
          if (nextBlock.innerHTML.trim() === '') {
            nextBlock.innerHTML = '<br>';
          }
          
          header.parentNode.insertBefore(nextBlock, header.nextSibling);
          
          if (header.innerHTML.trim() === '') {
            header.innerHTML = '<br>';
          }
          
          // Place caret at start of nextBlock
          const newRange = document.createRange();
          newRange.selectNodeContents(nextBlock);
          newRange.collapse(true);
          selection.removeAllRanges();
          selection.addRange(newRange);
          nextBlock.focus();
          
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          updateToolbarActiveStates();
          return;
        }
      }
      return;
    }
    const val = ta.value;
    const start = ta.selectionStart;
    const lineStart = val.lastIndexOf('\n', start - 1) + 1;
    const lineEndIdx = val.indexOf('\n', start);
    const lineEnd = (lineEndIdx === -1) ? val.length : lineEndIdx;
    const lineText = val.slice(lineStart, lineEnd);

    const ul = lineText.match(/^(\s*)([-*+])(\s+)(.*)$/);
    if (ul) {
      e.preventDefault();
      const indent = ul[1] || '';
      const marker = ul[2];
      const after = ul[4] || '';
      if (after.trim() === '') {
        const insert = '\n' + indent;
        const newVal = val.slice(0, start) + insert + val.slice(ta.selectionEnd);
        ta.value = newVal;
        const pos = start + insert.length;
        ta.selectionStart = ta.selectionEnd = pos;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      } else {
        const insert = '\n' + indent + marker + ' ';
        const newVal = val.slice(0, start) + insert + val.slice(ta.selectionEnd);
        ta.value = newVal;
        const pos = start + insert.length;
        ta.selectionStart = ta.selectionEnd = pos;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
    }

    const ol = lineText.match(/^(\s*)(\d+)\.(\s*)(.*)$/);
    if (ol) {
      e.preventDefault();
      const indent = ol[1] || '';
      const num = parseInt(ol[2], 10) || 0;
      const after = ol[4] || '';
      if (after.trim() === '') {
        const insert = '\n' + indent;
        const newVal = val.slice(0, start) + insert + val.slice(ta.selectionEnd);
        ta.value = newVal;
        const pos = start + insert.length;
        ta.selectionStart = ta.selectionEnd = pos;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      } else {
        const next = num + 1;
        const insert = '\n' + indent + next + '. ';
        const newVal = val.slice(0, start) + insert + val.slice(ta.selectionEnd);
        ta.value = newVal;
        const pos = start + insert.length;
        ta.selectionStart = ta.selectionEnd = pos;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
    }
  }
}
// Legacy split-view stubs (retained for backward compatibility)
let paneEditorOn = true;
let panePreviewOn = false;
function applyNotePaneSessionWidth() {}
function togglePane() {}
function _initNotePaneResizeHandle() {}

if (typeof window !== 'undefined') {
  window.togglePane = togglePane;
  window.applyNotePaneSessionWidth = applyNotePaneSessionWidth;
  window.initNotePaneResizeHandle = _initNotePaneResizeHandle;
  window.insertMd = formatRichText;
  window.saveCurrentNote = saveCurrentNote;
  window.zoomEditor = zoomEditor;
  window.toggleDecision = toggleDecision;
}
// ═══ Tag Editor ═══
const TAG_CSS  = { group:'group-tag', major:'major-tag', topic:'topic-tag', extra:'extra-tag' };
const TAG_BG   = { group:'#bfdbfe', major:'#fde68a', topic:'#bbf7d0', extra:'#e5e7eb' };
const TAG_TEXT = { group:'#1d4ed8', major:'#9a3412', topic:'#166534', extra:'#111827' };


function populateTagEditor(containerId, tags, type, onChange = null) {
  const el  = document.getElementById(containerId);
  if (!el) return;
  const css = TAG_CSS[type] || 'extra-tag';
  el.innerHTML = '';

  // ── input element ──────────────────────────────────────────────────────────
  const input = document.createElement('input');
  input.className   = 'tag-add';
  input.placeholder = t('common.addTagPlaceholder');
  input.title = t('common.clickAndTypeToAddTag');

  if (onChange) {
    if (el._tagChangeListener) {
      el.removeEventListener('tagchange', el._tagChangeListener);
    }
    el._tagChangeListener = onChange;
    el.addEventListener('tagchange', onChange);
  }

  if (el._tagClickListener) {
    el.removeEventListener('click', el._tagClickListener);
  }
  el._tagClickListener = () => input.focus();
  el.addEventListener('click', el._tagClickListener);

  tags.forEach(t => {
    let cls = css;
    const todoCls = getTodoClassForTag(t);
    if (todoCls) cls += ' ' + todoCls;
    addTagPill(el, t, type, cls, false);
  });

  const bg   = TAG_BG[type]   || TAG_BG.extra;
  const fg   = TAG_TEXT[type] || TAG_TEXT.extra;
  let dropdown = null;

  // ── dropdown renderer ──────────────────────────────────────────────────────
  function renderDropdown(filter) {
    if (!dropdown) {
      dropdown = document.createElement('div');
      dropdown.className = 'tag-suggest-dropdown';
      document.body.appendChild(dropdown);
    }
    dropdown.innerHTML  = '';

    const isPlanner = containerId.startsWith('pe-') || containerId.startsWith('inspector-');
    const groupContainerId = isPlanner ? (containerId.startsWith('pe-') ? 'pe-group-tags' : 'inspector-group-tags') : 'editor-group';
    const majorContainerId = isPlanner ? (containerId.startsWith('pe-') ? 'pe-major-tags' : 'inspector-major-tags') : 'editor-major';
    const topicContainerId = isPlanner ? (containerId.startsWith('pe-') ? 'pe-topic-tags' : 'inspector-topic-tags') : 'editor-topic';
    const extraContainerId = isPlanner ? null : 'editor-extra';

    const selectedGroups = groupContainerId && document.getElementById(groupContainerId) ? readTagEditor(groupContainerId) : [];
    const selectedMajors = majorContainerId && document.getElementById(majorContainerId) ? readTagEditor(majorContainerId) : [];
    const selectedTopics = topicContainerId && document.getElementById(topicContainerId) ? readTagEditor(topicContainerId) : [];
    const selectedExtras = extraContainerId && document.getElementById(extraContainerId) ? readTagEditor(extraContainerId) : [];

    const otherSelectedTags = [
      ...selectedGroups,
      ...selectedMajors,
      ...selectedTopics,
      ...selectedExtras
    ];

    const associatedTags = new Set();
    if (isPlanner) {
      const todoId = document.getElementById('pe-todo-id')?.value;
      if (todoId && typeof todosManifest !== 'undefined' && Array.isArray(todosManifest)) {
        const todoObj = todosManifest.find(t => t && String(t.id) === String(todoId));
        if (todoObj) {
          if (todoObj.major_topic) associatedTags.add(String(todoObj.major_topic).trim().toLowerCase());
          if (Array.isArray(todoObj.major_topic_tags)) todoObj.major_topic_tags.forEach(t => associatedTags.add(String(t).trim().toLowerCase()));
          if (Array.isArray(todoObj.group_tags)) todoObj.group_tags.forEach(t => associatedTags.add(String(t).trim().toLowerCase()));
          if (Array.isArray(todoObj.topic_tags)) todoObj.topic_tags.forEach(t => associatedTags.add(String(t).trim().toLowerCase()));
        }
      }
      const mainNoteId = document.getElementById('pe-note-id')?.value;
      const linkedNoteIdsRaw = document.getElementById('pe-linked-note-ids')?.value || '';
      const noteIds = [mainNoteId, ...linkedNoteIdsRaw.split(',')].map(v => String(v || '').trim()).filter(Boolean);
      if (noteIds.length && typeof manifest !== 'undefined' && Array.isArray(manifest)) {
        manifest.forEach(n => {
          if (n && noteIds.includes(String(n.id))) {
            (n.group_tags || []).forEach(t => associatedTags.add(String(t).trim().toLowerCase()));
            (n.major_topic_tags || []).forEach(t => associatedTags.add(String(t).trim().toLowerCase()));
            (n.topic_tags || []).forEach(t => associatedTags.add(String(t).trim().toLowerCase()));
            (n.extra_tags || []).forEach(t => associatedTags.add(String(t).trim().toLowerCase()));
          }
        });
      }
    } else if (typeof currentNote !== 'undefined' && currentNote) {
      (currentNote.group_tags || []).forEach(t => associatedTags.add(String(t).trim().toLowerCase()));
      (currentNote.major_topic_tags || []).forEach(t => associatedTags.add(String(t).trim().toLowerCase()));
      (currentNote.topic_tags || []).forEach(t => associatedTags.add(String(t).trim().toLowerCase()));
      (currentNote.extra_tags || []).forEach(t => associatedTags.add(String(t).trim().toLowerCase()));

      if (typeof todosManifest !== 'undefined' && Array.isArray(todosManifest)) {
        todosManifest.forEach(t => {
          if (t && (t.noteId === currentNote.id || t.notePath === currentNote.path)) {
            if (t.major_topic) associatedTags.add(String(t.major_topic).trim().toLowerCase());
            (t.major_topic_tags || []).forEach(x => associatedTags.add(String(x).trim().toLowerCase()));
            (t.group_tags || []).forEach(x => associatedTags.add(String(x).trim().toLowerCase()));
            (t.topic_tags || []).forEach(x => associatedTags.add(String(x).trim().toLowerCase()));
          }
        });
      }
    }

    let activeTitle = '';
    if (isPlanner) {
      activeTitle = document.getElementById('pe-title')?.value || '';
    } else {
      activeTitle = document.getElementById('edit-title')?.value
        || (typeof currentNote !== 'undefined' && currentNote ? (currentNote.title || '') : '')
        || '';
    }

    const assigned = readTagEditor(containerId);
    const all = [...new Set([...knownTagsForType(type), ...(assigned || [])])];
    const scores = typeof window.computeTagScores === 'function'
      ? window.computeTagScores({
          type,
          candidates: all,
          title: activeTitle,
          selectedTags: otherSelectedTags,
          associatedTags,
          manifest: typeof manifest !== 'undefined' && Array.isArray(manifest) ? manifest : [],
          todosManifest: typeof todosManifest !== 'undefined' && Array.isArray(todosManifest) ? todosManifest : []
        })
      : {};

    function localNoteHasTag(n, tag) {
      if (typeof window.noteHasTag === 'function') return window.noteHasTag(n, tag);
      const lower = String(tag).toLowerCase();
      const check = arr => (arr || []).some(t => String(t).toLowerCase() === lower);
      return check(n.group_tags) || check(n.major_topic_tags) || check(n.topic_tags) || check(n.extra_tags);
    }

    function suggestionMatches(tag) {
      if (!otherSelectedTags.length) return false;
      const lowerTag = String(tag).toLowerCase();
      return manifest.some(n => {
        const tagsOfThisType = type === 'group'
          ? (n.group_tags || [])
          : type === 'major'
            ? (n.major_topic_tags || [])
            : type === 'topic'
              ? (n.topic_tags || [])
              : (n.extra_tags || []);
        const hasTagOfType = tagsOfThisType.some(t => String(t).toLowerCase() === lowerTag);
        if (!hasTagOfType) return false;
        return otherSelectedTags.every(o => localNoteHasTag(n, o));
      });
    }

    function sortScoredTags(arr) {
      const isWs = t => (typeof isWorkstreamTag === 'function' ? isWorkstreamTag(t) : false);
      return [...arr].sort((a, b) => {
        const scoreA = scores[a] || 0;
        const scoreB = scores[b] || 0;
        if (scoreB !== scoreA) {
          return scoreB - scoreA;
        }
        if (type === 'major') {
          const wsA = isWs(a);
          const wsB = isWs(b);
          if (wsA && !wsB) return -1;
          if (!wsA && wsB) return 1;
        }
        return a.localeCompare(b);
      });
    }

    function sortTagsWithWorkstream(arr) {
      if (type !== 'major') return arr;
      const isWs = t => (typeof isWorkstreamTag === 'function' ? isWorkstreamTag(t) : false);
      return [...arr].sort((a, b) => {
        const wsA = isWs(a);
        const wsB = isWs(b);
        if (wsA && !wsB) return -1;
        if (!wsA && wsB) return 1;
        return a.localeCompare(b);
      });
    }

    const fl       = (filter || '').toLowerCase();
    let yes        = all.filter(t =>  assigned.includes(t) && (!fl || t.toLowerCase().includes(fl)));
    let unassigned = all.filter(t => !assigned.includes(t) && (!fl || t.toLowerCase().includes(fl)));

    const inGroupSet = new Set(
      selectedGroups.length
        ? manifest
            .filter(n => (n.group_tags || []).some(g => selectedGroups.includes(g)))
            .flatMap(n => type === 'group' ? (n.group_tags||[]) : type === 'major' ? (n.major_topic_tags||[]) : type === 'topic' ? (n.topic_tags||[]) : (n.extra_tags||[]))
        : []
    );
    let inGroup = unassigned.filter(t =>  inGroupSet.has(t));
    let no      = unassigned.filter(t => !inGroupSet.has(t));

    yes = sortTagsWithWorkstream(yes);
    inGroup = sortScoredTags(inGroup);
    no = sortScoredTags(no);

    function makeChip(tag, isAssigned, extraClass) {
      const tagScore = scores[tag] || 0;
      let isMatch = !isAssigned && (tagScore >= 20 || suggestionMatches(tag));
      let isAssociated = !isAssigned && (associatedTags.has(String(tag).trim().toLowerCase()) || tagScore >= 40);
      let isWorkstream = type === 'major' && (typeof isWorkstreamTag === 'function' ? isWorkstreamTag(tag) : false);

      if (typeof window.makeTagChip === 'function') {
        return window.makeTagChip(tag, {
          isAssigned,
          extraClass,
          isMatch,
          isAssociated,
          isWorkstream,
          bg,
          fg,
          onRemove: (tName) => {
            const pill = [...el.querySelectorAll('.tag-pill')].find(p => p.dataset.tag === tName);
            if (pill) {
              pill.remove();
              el.dispatchEvent(new CustomEvent('tagchange'));
            }
            input.value = '';
            updateTodoButtonsState();
            renderDropdown('');
          },
          onSelect: (tName) => {
            if (!readTagEditor(containerId).includes(tName)) addTagPill(el, tName, type, css);
            input.value = '';
            updateTodoButtonsState();
            renderDropdown('');
          }
        });
      }

      const chip       = document.createElement('button');
      chip.type        = 'button';

      let cls = 'tag-suggest-chip ' + (isAssigned ? 'assigned' : (extraClass || 'suggestion'));
      if (isMatch) cls += ' matching-highlight';
      if (isAssociated) cls += ' associated-highlight';
      if (isWorkstream) cls += ' workstream-tag';

      chip.className   = cls;
      chip.textContent = (isAssigned ? '✓ ' : '') + tag;
      chip.style.background = bg;
      chip.style.color      = fg;
      chip.title = isAssigned ? t('common.clickToRemoveTag', { tag }) : t('common.clickToAddTag', { tag });
      const handleTrigger = e => {
        e.preventDefault();
        if (isAssigned) {
          const pill = [...el.querySelectorAll('.tag-pill')].find(p => p.dataset.tag === tag);
          if (pill) {
            pill.remove();
            el.dispatchEvent(new CustomEvent('tagchange'));
          }
        } else {
          if (!readTagEditor(containerId).includes(tag)) addTagPill(el, tag, type, css);
        }
        input.value = '';
        updateTodoButtonsState();
        renderDropdown('');
      };
      chip.addEventListener('pointerdown', handleTrigger);
      chip.addEventListener('mousedown', handleTrigger);
      return chip;
    }

    function addSection(label, items, isAssigned, extraClass) {
      if (!items.length) return;
      const sec = document.createElement('div');
      sec.className   = 'tag-suggest-section';
      sec.textContent = label;
      dropdown.appendChild(sec);
      const row = document.createElement('div');
      row.className   = 'tag-suggest-chips';
      items.forEach(t => row.appendChild(makeChip(t, isAssigned, extraClass)));
      dropdown.appendChild(row);
    }

    addSection(t('common.assigned'), yes, true);
    addSection(t('common.inThisGroup'), inGroup, false, 'in-group');
    addSection(t('common.other'), no, false);

    if (!yes.length && !inGroup.length && !no.length) {
      const em = document.createElement('div');
      em.className   = 'tag-suggest-empty';
      em.textContent = fl ? t('common.pressEnterToAdd', { value: filter }) : t('common.noExistingTagsYet');
      dropdown.appendChild(em);
    }

    if (typeof window.positionTagDropdown === 'function') {
      window.positionTagDropdown(dropdown, el);
    } else {
      const rect = el.getBoundingClientRect();
      const dropdownHeight = dropdown.offsetHeight || 180;
      const spaceBelow = window.innerHeight - rect.bottom;
      
      if (spaceBelow < dropdownHeight && rect.top > dropdownHeight) {
        dropdown.style.top = (rect.top - dropdownHeight - 4) + 'px';
      } else {
        dropdown.style.top = (rect.bottom + 4) + 'px';
      }
      dropdown.style.left = rect.left + 'px';
    }
  }

  function closeDropdown() {
    if (dropdown) { dropdown.remove(); dropdown = null; }
  }

  // ── input event listeners ───────────────────────────────────────────────
  input.addEventListener('focus',  () => renderDropdown(input.value.trim()));
  input.addEventListener('input',  () => renderDropdown(input.value.trim()));
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      let val = input.value.replace(/,$/, '').trim();
      if (val) {
        const lowerVal = val.toLowerCase();
        const existing = knownTagsForType(type).find(t => String(t).toLowerCase() === lowerVal);
        if (existing) val = existing;
        if (!readTagEditor(containerId).includes(val)) {
          addTagPill(el, val, type, css);
          input.value = '';
          updateTodoButtonsState();
          if (dropdown) renderDropdown('');
        }
      }
    } else if (e.key === 'Backspace' && !input.value) {
      const pills = el.querySelectorAll('.tag-pill');
      if (pills.length) {
        const last = pills[pills.length - 1];
        const tagText = last.dataset.tag || last.textContent.replace(/×$/, '').trim();
        last.remove();
        input.value = tagText;
        input.select();
        el.dispatchEvent(new CustomEvent('tagchange'));
        renderDropdown(input.value.trim());
      }
      updateTodoButtonsState();
    } else if (e.key === 'Escape') {
      closeDropdown();
    }
  });
  input.addEventListener('blur', () => {
    setTimeout(() => {
      let val = input.value.trim();
      if (val) {
        const lowerVal = val.toLowerCase();
        const existing = knownTagsForType(type).find(t => String(t).toLowerCase() === lowerVal);
        if (existing) val = existing;
        if (!readTagEditor(containerId).includes(val)) {
          addTagPill(el, val, type, css);
          input.value = '';
          updateTodoButtonsState();
        }
      }
      closeDropdown();
    }, 200);
  });

  el.appendChild(input);
  updateTodoButtonsState();
}

function addTagPill(container, text, type, css, triggerEvent = true) {
  const pill = document.createElement('span');
  let finalCss = css || '';
  if (type === 'major' && typeof isWorkstreamTag === 'function' && isWorkstreamTag(text)) {
    if (!finalCss.includes('workstream-tag')) finalCss += ' workstream-tag';
  }
  if (typeof isTagFromWorkstream === 'function' && isTagFromWorkstream(text, type, container?.id)) {
    if (!finalCss.includes('tag-from-workstream')) finalCss += ' tag-from-workstream';
  }
  pill.className = `tag-pill tag ${finalCss}`.trim();
  pill.dataset.tag = text;
  const rm = document.createElement('button');
  rm.className = 'rm';
  rm.textContent = '×';
  rm.title = typeof t === 'function' ? t('common.clickToRemoveTag', { tag: text }) : 'Click to remove tag';
  const handleRemove = e => {
    e.stopPropagation();
    e.preventDefault();
    pill.remove();
    container.dispatchEvent(new CustomEvent('tagchange'));
  };
  rm.addEventListener('click', handleRemove);
  rm.addEventListener('pointerdown', handleRemove);

  // Clicking the pill text pops it back into the input field to fix typos easily
  pill.title = typeof t === 'function' ? (t('common.clickToEditTag', { tag: text }) || 'Click to edit tag') : 'Click to edit tag';
  pill.addEventListener('click', e => {
    if (e.target === rm) return;
    const input = container.querySelector('.tag-add');
    if (input) {
      pill.remove();
      input.value = text;
      input.focus();
      input.select();
      container.dispatchEvent(new CustomEvent('tagchange'));
    }
  });

  pill.appendChild(document.createTextNode(text + ' '));
  pill.appendChild(rm);
  const input = container.querySelector('.tag-add');
  container.insertBefore(pill, input || null);
  if (triggerEvent) {
    container.dispatchEvent(new CustomEvent('tagchange'));
  }
}

function readTagEditor(containerId) {
  const raw = [...document.querySelectorAll(`#${containerId} .tag-pill`)].map(p => p.dataset.tag || p.textContent.replace(/×$/, '').trim());
  return [...new Set(raw.filter(Boolean))];
}

function getDelegationCollaborators(options = {}) {
  const includeMe = options.includeMe === true;
  const records = (typeof getAllColleagueRecords === 'function')
    ? getAllColleagueRecords({ includeMe: true, includeHidden: false })
    : [];

  // Single source of truth: only the colleague DB records.
  return records
    .filter(rec => includeMe || rec.id !== 'me')
    .map(rec => ({ id: rec.id, label: rec.label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function normalizeCollaboratorSelection(value, options = {}) {
  const includeMe = options.includeMe === true;
  const allowCreate = options.allowCreate === true;
  const clean = String(value || '').trim();
  if (!clean) return includeMe ? { id: 'me', label: getCollaboratorDisplayName('me') || 'Me' } : null;

  const known = getDelegationCollaborators({ includeMe });
  const exactById = known.find(item => item.id === clean);
  if (exactById) return exactById;

  const exactByLabel = known.find(item => item.label.toLowerCase() === clean.toLowerCase());
  if (exactByLabel) return exactByLabel;

  const resolvedId = (typeof resolveColleagueId === 'function')
    ? resolveColleagueId(clean, { allowCreate, allowMe: includeMe })
    : '';
  if (resolvedId) {
    const label = typeof getColleagueLabelById === 'function'
      ? getColleagueLabelById(resolvedId, clean)
      : clean;
    return { id: resolvedId, label };
  }

  if (includeMe && isUserCollaborator(clean)) {
    return { id: 'me', label: getCollaboratorDisplayName('me') || 'Me' };
  }
  return null;
}

function readCollaboratorPicker(containerId) {
  const pill = document.querySelector(`#${containerId} .tag-pill`);
  if (!pill) return '';
  const directId = String(pill.dataset.colleagueId || '').trim();
  if (directId) return directId;
  const fallback = String(pill.dataset.tag || '').trim();
  if (!fallback) return '';
  if (typeof resolveColleagueId === 'function') {
    return resolveColleagueId(fallback, { allowCreate: false, allowMe: true }) || '';
  }
  return fallback;
}

function getCollaboratorPickerValue(containerId) {
  return readCollaboratorPicker(containerId);
}

if (typeof window !== 'undefined') {
  window.readCollaboratorPicker = readCollaboratorPicker;
  window.getCollaboratorPickerValue = getCollaboratorPickerValue;
  window.populateCollaboratorPicker = populateCollaboratorPicker;
}

function populateCollaboratorPicker(containerId, selectedOwner = '', options = {}) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const allowEmpty = options.allowEmpty === true;
  const includeMe = options.includeMe !== false;
  const createOnType = options.createOnType !== false;
  const onChange = typeof options.onChange === 'function' ? options.onChange : null;
  const getCurrentCollaborators = () => getDelegationCollaborators({ includeMe });
  const selected = normalizeCollaboratorSelection(selectedOwner, { includeMe, allowCreate: false })
    || (!allowEmpty ? normalizeCollaboratorSelection('me', { includeMe, allowCreate: false }) : null);

  el.innerHTML = '';
  let dropdown = null;
  let activeIndex = -1;
  let dropdownItems = [];

  const notify = () => {
    const value = readCollaboratorPicker(containerId);
    if (onChange) onChange(value || '');
  };

  function setSelection(value, setOptions = {}) {
    const normalized = normalizeCollaboratorSelection(value, {
      includeMe,
      allowCreate: setOptions.allowCreate === true && createOnType,
    });
    [...el.querySelectorAll('.tag-pill')].forEach(pill => pill.remove());
    if (normalized && (includeMe || normalized.id !== 'me')) {
      const pill = document.createElement('span');
      pill.className = 'tag-pill tag topic-tag';
      pill.dataset.tag = normalized.label;
      pill.dataset.colleagueId = normalized.id;
      const rm = document.createElement('button');
      rm.className = 'rm';
      rm.textContent = '×';
      rm.title = t('common.removeTag', { tag: normalized.label });
      rm.addEventListener('click', (e) => {
        e.stopPropagation();
        pill.remove();
        notify();
      });
      pill.appendChild(document.createTextNode(normalized.label + ' '));
      pill.appendChild(rm);
      el.insertBefore(pill, inputWrap);
    }
    input.value = '';
    updateGhostText('');
    notify();
  }

  function closeDropdown() {
    if (dropdown) {
      dropdown.remove();
      dropdown = null;
    }
    activeIndex = -1;
    dropdownItems = [];
  }

  const getSortedMatches = (filterRaw = '') => {
    const filter = String(filterRaw || '').trim().toLowerCase();
    const collaborators = getCurrentCollaborators();
    if (!filter) return collaborators;
    const filtered = collaborators.filter(item => item.label.toLowerCase().includes(filter));
    return filtered.sort((a, b) => {
      const aStarts = a.label.toLowerCase().startsWith(filter);
      const bStarts = b.label.toLowerCase().startsWith(filter);
      if (aStarts !== bStarts) return aStarts ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
  };

  const getTabCandidate = (query) => {
    const clean = String(query || '').trim().toLowerCase();
    if (!clean) return null;
    const sorted = getSortedMatches(clean);
    return sorted[0] || null;
  };

  const updateGhostText = (filterVal = '', overrideLabel = null) => {
    const typed = String(filterVal || '');
    const clean = typed.trim().toLowerCase();
    const targetLabel = overrideLabel || (clean ? getTabCandidate(clean)?.label : null);

    if (!clean || !targetLabel) {
      ghostPrefix.textContent = '';
      ghostSuffix.textContent = '';
      ghostBadge.style.display = 'none';
      return;
    }

    if (targetLabel.toLowerCase().startsWith(clean)) {
      ghostPrefix.textContent = typed;
      ghostSuffix.textContent = targetLabel.slice(clean.length);
      ghostBadge.style.display = 'inline-flex';
    } else {
      ghostPrefix.textContent = typed;
      ghostSuffix.textContent = ` (${targetLabel})`;
      ghostBadge.style.display = 'inline-flex';
    }
  };

  const updateActiveHighlight = () => {
    dropdownItems.forEach((it, idx) => {
      if (!it.element) return;
      const isAct = idx === activeIndex;
      it.element.classList.toggle('tab-candidate', isAct);
      it.element.classList.toggle('active', isAct);
      const hint = it.element.querySelector('.tag-tab-hint');
      if (hint) hint.style.display = isAct ? 'inline-flex' : 'none';
      else if (isAct && it.type === 'colleague') {
        const tabHint = document.createElement('kbd');
        tabHint.className = 'tag-tab-hint';
        tabHint.textContent = `${t('common.tabKey') || 'Tab'} ⇥`;
        it.element.appendChild(tabHint);
      }
    });

    if (activeIndex >= 0 && dropdownItems[activeIndex]) {
      const activeIt = dropdownItems[activeIndex];
      activeIt.element?.scrollIntoView({ block: 'nearest' });
      updateGhostText(input.value, activeIt.label);
    } else {
      updateGhostText(input.value);
    }
  };

  function renderDropdown(filterRaw = '') {
    const filter = String(filterRaw || '').trim().toLowerCase();
    const currentId = readCollaboratorPicker(containerId);
    const collaborators = getCurrentCollaborators();
    const optionsList = getSortedMatches(filter);
    dropdownItems = [];

    if (!dropdown) {
      dropdown = document.createElement('div');
      dropdown.className = 'tag-suggest-dropdown';
      document.body.appendChild(dropdown);
    }
    dropdown.innerHTML = '';

    const sec = document.createElement('div');
    sec.className = 'tag-suggest-section';
    sec.textContent = t('team.collaboratorsLabel') || 'Collaborators';
    dropdown.appendChild(sec);

    if (allowEmpty && !filter) {
      const row = document.createElement('div');
      row.className = 'tag-suggest-chips';
      const meBtn = document.createElement('button');
      meBtn.type = 'button';
      meBtn.className = 'tag-suggest-chip' + (!currentId ? ' assigned' : '');
      meBtn.textContent = t('team.unassignedLabel') || 'Unassigned';
      meBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        setSelection('');
        closeDropdown();
      });
      dropdownItems.push({
        type: 'unassigned',
        label: t('team.unassignedLabel') || 'Unassigned',
        element: meBtn
      });
      row.appendChild(meBtn);
      dropdown.appendChild(row);
    }

    if (optionsList.length) {
      const chips = document.createElement('div');
      chips.className = 'tag-suggest-chips';
      optionsList.forEach(item => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tag-suggest-chip' + (currentId === item.id ? ' assigned' : '');
        btn.textContent = item.label;
        btn.addEventListener('mousedown', (e) => {
          e.preventDefault();
          setSelection(item.id);
          closeDropdown();
        });
        dropdownItems.push({
          type: 'colleague',
          data: item,
          label: item.label,
          element: btn
        });
        chips.appendChild(btn);
      });
      dropdown.appendChild(chips);
    }

    if (createOnType && filter && !collaborators.some(item => item.label.toLowerCase() === filter)) {
      const createBtn = document.createElement('button');
      createBtn.type = 'button';
      createBtn.className = 'tag-suggest-chip suggestion';
      createBtn.textContent = `+ ${filterRaw.trim()}`;
      createBtn.title = t('common.pressEnterToAdd', { value: filterRaw.trim() }) || `Create ${filterRaw.trim()}`;
      createBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        setSelection(filterRaw.trim(), { allowCreate: true });
        closeDropdown();
      });
      dropdownItems.push({
        type: 'create',
        label: filterRaw.trim(),
        element: createBtn
      });
      const createRow = document.createElement('div');
      createRow.className = 'tag-suggest-chips';
      createRow.style.marginTop = '4px';
      createRow.appendChild(createBtn);
      dropdown.appendChild(createRow);
    }

    if (!dropdownItems.length) {
      const empty = document.createElement('div');
      empty.className = 'tag-suggest-empty';
      empty.textContent = t('team.noKnownCollaborators') || 'No known collaborators.';
      dropdown.appendChild(empty);
      activeIndex = -1;
    } else {
      const bestIdx = dropdownItems.findIndex(it => it.type === 'colleague');
      activeIndex = bestIdx >= 0 ? bestIdx : 0;
      updateActiveHighlight();
    }

    const rect = el.getBoundingClientRect();
    const dropdownHeight = dropdown.offsetHeight || 180;
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < dropdownHeight && rect.top > dropdownHeight) {
      dropdown.style.top = (rect.top - dropdownHeight - 4) + 'px';
    } else {
      dropdown.style.top = (rect.bottom + 4) + 'px';
    }
    dropdown.style.left = rect.left + 'px';
    dropdown.style.minWidth = Math.max(260, rect.width) + 'px';
  }

  const inputWrap = document.createElement('span');
  inputWrap.className = 'tag-input-wrap';

  const ghostSpan = document.createElement('span');
  ghostSpan.className = 'tag-ghost-text';
  ghostSpan.setAttribute('aria-hidden', 'true');

  const ghostPrefix = document.createElement('span');
  ghostPrefix.className = 'tag-ghost-prefix';

  const ghostSuffix = document.createElement('span');
  ghostSuffix.className = 'tag-ghost-suffix';

  const ghostBadge = document.createElement('kbd');
  ghostBadge.className = 'tag-ghost-tab-badge';
  ghostBadge.textContent = `${t('common.tabKey') || 'Tab'} ⇥`;
  ghostBadge.style.display = 'none';

  ghostSpan.appendChild(ghostPrefix);
  ghostSpan.appendChild(ghostSuffix);
  ghostSpan.appendChild(ghostBadge);

  const input = document.createElement('input');
  input.className = 'tag-add';
  input.placeholder = options.placeholder || (t('todo.todoOwnerPlaceholder') || 'Select collaborator...');
  input.title = options.title || (t('todo.clickToTypeOwner') || 'Select collaborator');

  inputWrap.appendChild(ghostSpan);
  inputWrap.appendChild(input);

  input.addEventListener('focus', () => renderDropdown(''));
  input.addEventListener('click', () => {
    updateGhostText(input.value);
    renderDropdown(input.value);
  });
  input.addEventListener('input', () => {
    updateGhostText(input.value);
    renderDropdown(input.value);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeDropdown();
      updateGhostText('');
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      if (!dropdown || !dropdownItems.length) renderDropdown(input.value);
      if (dropdownItems.length > 0) {
        e.preventDefault();
        activeIndex = activeIndex < 0 ? 0 : (activeIndex + 1) % dropdownItems.length;
        updateActiveHighlight();
      }
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      if (!dropdown || !dropdownItems.length) renderDropdown(input.value);
      if (dropdownItems.length > 0) {
        e.preventDefault();
        activeIndex = activeIndex < 0 ? dropdownItems.length - 1 : (activeIndex - 1 + dropdownItems.length) % dropdownItems.length;
        updateActiveHighlight();
      }
      return;
    }
    if (e.key === 'Tab') {
      const typed = input.value.trim();
      let chosen = null;
      if (activeIndex >= 0 && dropdownItems[activeIndex]) {
        chosen = dropdownItems[activeIndex];
      } else if (typed) {
        const cand = getTabCandidate(typed);
        if (cand) chosen = { type: 'colleague', data: cand, label: cand.label };
        else if (createOnType) chosen = { type: 'create', label: typed };
      }

      if (chosen) {
        e.preventDefault();
        e.stopPropagation();
        if (chosen.type === 'colleague') setSelection(chosen.data.id);
        else if (chosen.type === 'unassigned') setSelection('');
        else if (chosen.type === 'create') setSelection(chosen.label, { allowCreate: true });
        closeDropdown();
        return;
      }
      closeDropdown();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const typed = input.value.trim();
      let chosen = null;
      if (activeIndex >= 0 && dropdownItems[activeIndex]) {
        chosen = dropdownItems[activeIndex];
      } else if (typed) {
        const cand = getTabCandidate(typed);
        if (cand) chosen = { type: 'colleague', data: cand, label: cand.label };
        else if (createOnType) chosen = { type: 'create', label: typed };
      }

      if (chosen) {
        if (chosen.type === 'colleague') setSelection(chosen.data.id);
        else if (chosen.type === 'unassigned') setSelection('');
        else if (chosen.type === 'create') setSelection(chosen.label, { allowCreate: true });
      } else if (!typed && allowEmpty) {
        setSelection('');
      }
      closeDropdown();
    }
  });

  input.addEventListener('blur', () => {
    setTimeout(() => {
      const typed = input.value.trim();
      if (typed) {
        const cand = getTabCandidate(typed);
        if (cand) setSelection(cand.id);
        else if (createOnType) setSelection(typed, { allowCreate: true });
      }
      closeDropdown();
    }, 130);
  });

  el.appendChild(inputWrap);
  if (selected) setSelection(selected.id);
}

function getKnownCollaboratorRecords(options = {}) {
  const includeMe = options.includeMe !== false;
  const includeHidden = options.includeHidden !== false;

  if (typeof getAllColleagueRecords === 'function') {
    return getAllColleagueRecords({ includeMe, includeHidden })
      .map(rec => ({
        id: String(rec.id || '').trim(),
        label: String(rec.label || rec.id || '').trim()
      }))
      .filter(rec => rec.label)
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  if (typeof getAllKnownCollaboratorNames === 'function') {
    return getAllKnownCollaboratorNames()
      .filter(Boolean)
      .map(label => ({ id: label, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  return [];
}

function resolveCollaboratorPickerEntry(value, options = {}) {
  const includeMe = options.includeMe !== false;
  const allowCreate = options.allowCreate === true;
  const allowEphemeral = options.allowEphemeral === true;
  const clean = String(value || '').trim();
  if (!clean) return null;

  const known = getKnownCollaboratorRecords({ includeMe, includeHidden: true });
  const exactById = known.find(item => item.id === clean);
  if (exactById) return exactById;

  const exactByLabel = known.find(item => item.label.toLowerCase() === clean.toLowerCase());
  if (exactByLabel) return exactByLabel;

  const resolvedId = (typeof resolveColleagueId === 'function')
    ? resolveColleagueId(clean, { allowCreate, allowMe: includeMe })
    : '';
  if (resolvedId) {
    const label = typeof getColleagueLabelById === 'function'
      ? getColleagueLabelById(resolvedId, clean)
      : clean;
    return { id: resolvedId, label };
  }

  const prefixMatch = known.find(item => item.label.toLowerCase().startsWith(clean.toLowerCase()));
  if (prefixMatch && !allowCreate) return prefixMatch;

  const subMatch = known.find(item => item.label.toLowerCase().includes(clean.toLowerCase()));
  if (subMatch && !allowCreate) return subMatch;

  if (allowCreate || allowEphemeral) return { id: clean, label: clean };
  return null;
}

function readCollaboratorMultiPicker(containerId) {
  return [...document.querySelectorAll(`#${containerId} .tag-pill`)]
    .map(pill => String(pill.dataset.colleagueId || pill.dataset.tag || '').trim())
    .filter(Boolean);
}

function populateCollaboratorMultiPicker(containerId, selectedValues = [], options = {}) {
  const el = document.getElementById(containerId);
  if (!el) return;

  const includeMe = options.includeMe !== false;
  const allowEmpty = options.allowEmpty === true;
  const createOnType = options.createOnType !== false;
  const onChange = typeof options.onChange === 'function' ? options.onChange : null;
  const placeholder = options.placeholder || (t('planner.addNewNamePlaceholder') || 'Add new name...');
  const title = options.title || (t('planner.peopleInputTitle') || t('common.typeOrClickSuggestion') || 'Type or click a suggestion');
  const selectedKeys = new Set();
  let dropdown = null;
  let activeIndex = -1;
  let dropdownItems = [];
  let _tabNavigating = false;

  el.innerHTML = '';

  const notify = () => {
    if (onChange) onChange(readCollaboratorMultiPicker(containerId));
  };

  const closeDropdown = () => {
    if (dropdown) {
      dropdown.remove();
      dropdown = null;
    }
    activeIndex = -1;
    dropdownItems = [];
  };

  const getSortedMatches = (filterRaw = '') => {
    const filter = String(filterRaw || '').trim().toLowerCase();
    const known = getKnownCollaboratorRecords({ includeMe, includeHidden: true });
    if (!filter) {
      return [...known].sort((a, b) => {
        const aSel = selectedKeys.has(a.id || a.label.toLowerCase());
        const bSel = selectedKeys.has(b.id || b.label.toLowerCase());
        if (aSel !== bSel) return aSel ? 1 : -1;
        return a.label.localeCompare(b.label);
      });
    }
    const filtered = known.filter(item => item.label.toLowerCase().includes(filter));
    return filtered.sort((a, b) => {
      const aKey = a.id || a.label.toLowerCase();
      const bKey = b.id || b.label.toLowerCase();
      const aSel = selectedKeys.has(aKey);
      const bSel = selectedKeys.has(bKey);
      if (aSel !== bSel) return aSel ? 1 : -1;
      const aLower = a.label.toLowerCase();
      const bLower = b.label.toLowerCase();
      const aStarts = aLower.startsWith(filter);
      const bStarts = bLower.startsWith(filter);
      if (aStarts !== bStarts) return aStarts ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
  };

  const getTabCandidate = (query) => {
    const clean = String(query || '').trim().toLowerCase();
    if (!clean) return null;
    const sorted = getSortedMatches(clean);
    const unselected = sorted.find(item => !selectedKeys.has(item.id || item.label.toLowerCase()));
    if (unselected) return unselected;
    return sorted[0] || null;
  };

  const removeSelectionByKey = (key) => {
    selectedKeys.delete(key);
    [...el.querySelectorAll('.tag-pill')].forEach(pill => {
      const pillKey = String(pill.dataset.colleagueId || pill.dataset.tag || '').trim();
      if (pillKey === key) pill.remove();
    });
  };

  const inputWrap = document.createElement('span');
  inputWrap.className = 'tag-input-wrap';

  const ghostSpan = document.createElement('span');
  ghostSpan.className = 'tag-ghost-text';
  ghostSpan.setAttribute('aria-hidden', 'true');

  const ghostPrefix = document.createElement('span');
  ghostPrefix.className = 'tag-ghost-prefix';

  const ghostSuffix = document.createElement('span');
  ghostSuffix.className = 'tag-ghost-suffix';

  const ghostBadge = document.createElement('kbd');
  ghostBadge.className = 'tag-ghost-tab-badge';
  ghostBadge.textContent = `${t('common.tabKey') || 'Tab'} ⇥`;
  ghostBadge.style.display = 'none';

  ghostSpan.appendChild(ghostPrefix);
  ghostSpan.appendChild(ghostSuffix);
  ghostSpan.appendChild(ghostBadge);

  const input = document.createElement('input');
  input.className = 'tag-add';
  input.placeholder = placeholder;
  input.title = title;

  inputWrap.appendChild(ghostSpan);
  inputWrap.appendChild(input);

  const updateGhostText = (filterVal = '', overrideLabel = null) => {
    const typed = String(filterVal || '');
    const clean = typed.trim().toLowerCase();
    const targetLabel = overrideLabel || (clean ? getTabCandidate(clean)?.label : null);

    if (!clean || !targetLabel) {
      ghostPrefix.textContent = '';
      ghostSuffix.textContent = '';
      ghostBadge.style.display = 'none';
      return;
    }

    if (targetLabel.toLowerCase().startsWith(clean)) {
      ghostPrefix.textContent = typed;
      ghostSuffix.textContent = targetLabel.slice(clean.length);
      ghostBadge.style.display = 'inline-flex';
    } else {
      ghostPrefix.textContent = typed;
      ghostSuffix.textContent = ` (${targetLabel})`;
      ghostBadge.style.display = 'inline-flex';
    }
  };

  const updateActiveHighlight = () => {
    dropdownItems.forEach((it, idx) => {
      if (!it.element) return;
      const isAct = idx === activeIndex;
      it.element.classList.toggle('tab-candidate', isAct);
      it.element.classList.toggle('active', isAct);
      const hint = it.element.querySelector('.tag-tab-hint');
      if (hint) {
        hint.style.display = isAct ? 'inline-flex' : 'none';
      } else if (isAct && it.type === 'colleague' && !selectedKeys.has(it.data.id || it.data.label.toLowerCase())) {
        const tabHint = document.createElement('kbd');
        tabHint.className = 'tag-tab-hint';
        tabHint.textContent = `${t('common.tabKey') || 'Tab'} ⇥`;
        tabHint.title = t('common.tabToAutofill', { name: it.label }) || `Press Tab to autofill ${it.label}`;
        it.element.appendChild(tabHint);
      }
    });

    if (activeIndex >= 0 && dropdownItems[activeIndex]) {
      const activeIt = dropdownItems[activeIndex];
      activeIt.element?.scrollIntoView({ block: 'nearest' });
      updateGhostText(input.value, activeIt.label);
    } else {
      updateGhostText(input.value);
    }
  };

  const addSelection = (value, { allowCreate = false, silent = false } = {}) => {
    const normalized = resolveCollaboratorPickerEntry(value, {
      includeMe,
      allowCreate: false, // In multi-picker UI, defer DB creation until the form is saved
      allowEphemeral: createOnType,
    });
    if (!normalized) return false;

    const key = normalized.id || normalized.label.toLowerCase();
    if (selectedKeys.has(key)) return false;
    selectedKeys.add(key);

    const pill = document.createElement('span');
    pill.className = 'tag-pill tag topic-tag';
    pill.dataset.tag = normalized.label;
    pill.dataset.colleagueId = normalized.id;

    const rm = document.createElement('button');
    rm.className = 'rm';
    rm.type = 'button';
    rm.textContent = '×';
    rm.title = t('common.removeTag', { tag: normalized.label });
    rm.addEventListener('click', e => {
      e.stopPropagation();
      removeSelectionByKey(key);
      notify();
    });

    // Clicking the pill text pops it back into the input field to fix typos easily
    pill.addEventListener('click', e => {
      if (e.target === rm) return;
      const text = normalized.label;
      removeSelectionByKey(key);
      input.value = text;
      input.focus();
      input.select();
      notify();
      updateGhostText(input.value);
      renderDropdown(input.value);
    });

    pill.appendChild(document.createTextNode(`${normalized.label} `));
    pill.appendChild(rm);
    el.insertBefore(pill, inputWrap);
    if (!silent) notify();
    return true;
  };

  const renderDropdown = (filterRaw = '') => {
    const filter = String(filterRaw || '').trim().toLowerCase();
    const known = getKnownCollaboratorRecords({ includeMe, includeHidden: true });
    const matches = getSortedMatches(filter);
    dropdownItems = [];

    if (!dropdown) {
      dropdown = document.createElement('div');
      dropdown.className = 'tag-suggest-dropdown';
      document.body.appendChild(dropdown);
    }
    dropdown.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'tag-suggest-section';
    header.textContent = t('team.collaboratorsLabel') || 'Collaborators';
    dropdown.appendChild(header);

    const chips = document.createElement('div');
    chips.className = 'tag-suggest-chips';
    matches.forEach(item => {
      const itemKey = item.id || item.label.toLowerCase();
      const isSelected = selectedKeys.has(itemKey);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `tag-suggest-chip${isSelected ? ' assigned' : ''}`;
      btn.textContent = `${isSelected ? '✓ ' : ''}${item.label}`;
      btn.title = isSelected
        ? t('common.removeTag', { tag: item.label })
        : (t('common.clickToAddTag', { tag: item.label }) || `Add ${item.label}`);

      dropdownItems.push({
        type: 'colleague',
        data: item,
        label: item.label,
        element: btn
      });

      btn.addEventListener('mousedown', e => {
        e.preventDefault();
        if (isSelected) {
          removeSelectionByKey(itemKey);
          notify();
        } else {
          addSelection(item.id || item.label);
        }
        input.value = '';
        updateGhostText('');
        renderDropdown('');
      });
      chips.appendChild(btn);
    });

    if (chips.childElementCount > 0) {
      dropdown.appendChild(chips);
    }

    if (createOnType && filter && !known.some(item => item.label.toLowerCase() === filter)) {
      const createBtn = document.createElement('button');
      createBtn.type = 'button';
      createBtn.className = 'tag-suggest-chip suggestion';
      createBtn.textContent = `+ ${filterRaw.trim()}`;
      createBtn.title = t('common.pressEnterToAdd', { value: filterRaw.trim() }) || `Create ${filterRaw.trim()}`;
      createBtn.addEventListener('mousedown', e => {
        e.preventDefault();
        addSelection(filterRaw.trim(), { allowCreate: false });
        input.value = '';
        updateGhostText('');
        closeDropdown();
      });
      dropdownItems.push({
        type: 'create',
        label: filterRaw.trim(),
        element: createBtn
      });
      const createRow = document.createElement('div');
      createRow.className = 'tag-suggest-chips';
      createRow.style.marginTop = '4px';
      createRow.appendChild(createBtn);
      dropdown.appendChild(createRow);
    }

    if (!dropdownItems.length) {
      const empty = document.createElement('div');
      empty.className = 'tag-suggest-empty';
      empty.textContent = filter
        ? (t('common.pressEnterToAdd', { value: filterRaw.trim() }) || `Press Enter to add "${filterRaw.trim()}"`)
        : (t('team.noKnownCollaborators') || 'No known collaborators.');
      dropdown.appendChild(empty);
      activeIndex = -1;
    } else {
      const bestIdx = dropdownItems.findIndex(it => it.type === 'colleague' && !selectedKeys.has(it.data.id || it.data.label.toLowerCase()));
      if (bestIdx >= 0) {
        activeIndex = bestIdx;
        updateActiveHighlight();
      } else {
        const anyColleagueIdx = dropdownItems.findIndex(it => it.type === 'colleague');
        if (anyColleagueIdx >= 0 && filter) {
          activeIndex = anyColleagueIdx;
          updateActiveHighlight();
        } else {
          activeIndex = -1;
          updateActiveHighlight();
        }
      }
    }

    const rect = el.getBoundingClientRect();
    const dropdownHeight = dropdown.offsetHeight || 180;
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < dropdownHeight && rect.top > dropdownHeight) {
      dropdown.style.top = `${rect.top - dropdownHeight - 4}px`;
    } else {
      dropdown.style.top = `${rect.bottom + 4}px`;
    }
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.minWidth = `${Math.max(260, rect.width)}px`;
  };

  input.addEventListener('focus', () => renderDropdown(''));
  input.addEventListener('click', () => {
    updateGhostText(input.value);
    renderDropdown(input.value);
  });
  input.addEventListener('input', () => {
    updateGhostText(input.value);
    renderDropdown(input.value);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeDropdown();
      updateGhostText('');
      activeIndex = -1;
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      if (!dropdown || !dropdownItems.length) {
        renderDropdown(input.value);
      }
      if (dropdownItems.length > 0) {
        e.preventDefault();
        activeIndex = activeIndex < 0 ? 0 : (activeIndex + 1) % dropdownItems.length;
        updateActiveHighlight();
      }
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      if (!dropdown || !dropdownItems.length) {
        renderDropdown(input.value);
      }
      if (dropdownItems.length > 0) {
        e.preventDefault();
        activeIndex = activeIndex < 0 ? dropdownItems.length - 1 : (activeIndex - 1 + dropdownItems.length) % dropdownItems.length;
        updateActiveHighlight();
      }
      return;
    }
    if (e.key === 'Backspace' && !input.value) {
      const pills = el.querySelectorAll('.tag-pill');
      const last = pills[pills.length - 1];
      if (last) {
        const text = String(last.dataset.tag || last.dataset.colleagueId || '').replace(/×$/, '').trim();
        removeSelectionByKey(String(last.dataset.colleagueId || last.dataset.tag || '').trim());
        input.value = text;
        input.focus();
        input.select();
        notify();
        updateGhostText(input.value);
        renderDropdown(input.value);
      }
      return;
    }
    if (e.key === 'Tab') {
      const typed = input.value.trim();
      let chosen = null;

      if (activeIndex >= 0 && dropdownItems[activeIndex]) {
        chosen = dropdownItems[activeIndex];
      } else if (typed) {
        const cand = getTabCandidate(typed);
        if (cand) chosen = { type: 'colleague', data: cand, label: cand.label };
      }

      if (chosen && chosen.type === 'colleague') {
        e.preventDefault();
        e.stopPropagation();
        const itemKey = chosen.data.id || chosen.data.label.toLowerCase();
        if (selectedKeys.has(itemKey)) {
          removeSelectionByKey(itemKey);
          notify();
        } else {
          addSelection(chosen.data.id || chosen.data.label);
        }
        input.value = '';
        updateGhostText('');
        closeDropdown();
        input.focus();
        return;
      } else if (chosen && chosen.type === 'create') {
        e.preventDefault();
        e.stopPropagation();
        addSelection(chosen.label, { allowCreate: false });
        input.value = '';
        updateGhostText('');
        closeDropdown();
        input.focus();
        return;
      }

      _tabNavigating = true;
      closeDropdown();
      updateGhostText('');
      return;
    }
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      e.stopPropagation();
      const typed = input.value.replace(/,$/, '').trim();
      let chosen = null;

      if (activeIndex >= 0 && dropdownItems[activeIndex]) {
        chosen = dropdownItems[activeIndex];
      } else if (typed) {
        const cand = getTabCandidate(typed);
        if (cand) chosen = { type: 'colleague', data: cand, label: cand.label };
        else if (createOnType) chosen = { type: 'create', label: typed };
      }

      if (chosen) {
        if (chosen.type === 'colleague') {
          const itemKey = chosen.data.id || chosen.data.label.toLowerCase();
          if (selectedKeys.has(itemKey)) {
            removeSelectionByKey(itemKey);
            notify();
          } else {
            addSelection(chosen.data.id || chosen.data.label);
          }
        } else if (chosen.type === 'create') {
          addSelection(chosen.label, { allowCreate: false });
        }
      } else if (!typed && allowEmpty) {
        notify();
      }

      input.value = '';
      updateGhostText('');
      closeDropdown();
      input.focus();
      return;
    }
  });

  input.addEventListener('blur', () => {
    setTimeout(() => {
      const typed = input.value.trim();
      if (typed && !_tabNavigating) {
        const cand = getTabCandidate(typed);
        if (cand) {
          addSelection(cand.id || cand.label, { allowCreate: false });
        } else {
          const resolved = resolveCollaboratorPickerEntry(typed, {
            includeMe,
            allowCreate: false,
            allowEphemeral: createOnType,
          });
          if (resolved) addSelection(resolved.id, { allowCreate: false });
        }
      }
      _tabNavigating = false;
      input.value = '';
      updateGhostText('');
      closeDropdown();
    }, 140);
  });

  el.appendChild(inputWrap);
  (Array.isArray(selectedValues) ? selectedValues : []).forEach(value => addSelection(value, { allowCreate: false, silent: true }));
  notify();
  el.addEventListener('click', () => input.focus());
}

function todoTagText(level) {
  if (!level) return null;
  if (level === 'High') return 'TODO HIGH';
  if (level === 'Medium') return 'TODO MED';
  if (level === 'WIP') return 'TODO WIP';
  if (level === 'Low') return 'TODO LOW';
  return null;
}

function getTodoMarkerState(marker) {
  let rawPriority = marker?.getAttribute('data-todo-priority') || 'Medium';
  rawPriority = rawPriority.charAt(0).toUpperCase() + rawPriority.slice(1).toLowerCase();
  if (rawPriority === 'Med') rawPriority = 'Medium';
  if (rawPriority === 'Wip') rawPriority = 'WIP';
  
  const status = marker?.getAttribute('data-todo-status') || (rawPriority === 'WIP' ? 'WIP' : '');
  const priority = rawPriority === 'WIP'
    ? (marker?.getAttribute('data-todo-base-priority') || 'Medium')
    : rawPriority;
  return { priority, status, rawPriority };
}

async function toggleTodoPriority(level) {
  const containerId = 'editor-extra';
  const el = document.getElementById(containerId);
  if (!el) return;
  const desired = todoTagText(level);

  // If there's an active selection in the editor, wrap it as an inline todo marker
  const ta = document.getElementById('edit-textarea');
  if (ta) ta.focus();
  try {
    const isRich = ta && ta.contentEditable === 'true';
    const hasSelection = isRich ? (window.getSelection().rangeCount && window.getSelection().toString().trim() !== '') : (ta && ta.selectionStart !== ta.selectionEnd);
    if (hasSelection) {
      if (await wrapSelectionWithTodo(level)) { toast(t('common.selectionMarkedTodo', { level: level === 'WIP' ? t('todo.wip') : t(`todo.${level.toLowerCase()}`) })); return; }
    }
  } catch (e) { /* ignore selection errors */ }

  const existing = readTagEditor(containerId);
  const allTodoTags = ['TODO HIGH', 'TODO MED', 'TODO WIP', 'TODO LOW'];
  if (existing.includes(desired)) {
    [...el.querySelectorAll('.tag-pill')].forEach(p => { if (p.dataset.tag === desired) p.remove(); });
    updateTodoButtonsState();
    return;
  }
  [...el.querySelectorAll('.tag-pill')].forEach(p => { if (allTodoTags.includes(p.dataset.tag)) p.remove(); });
  const css = 'extra-tag ' + (level === 'High' ? 'todo-high' : level === 'Medium' ? 'todo-med' : level === 'WIP' ? 'todo-wip' : 'todo-low');
  addTagPill(el, desired, 'extra', css);
  updateTodoButtonsState();
}

function updateTodoButtonsState() {
  const existing = readTagEditor('editor-extra');
  const btnAdd = document.getElementById('todo-btn-add');
  if (btnAdd) {
    const hasTodo = existing.some(t => t.startsWith('TODO '));
    btnAdd.classList.toggle('active', hasTodo);
  }
  const btnHigh = document.getElementById('todo-btn-high');
  const btnMed = document.getElementById('todo-btn-med');
  const btnWip = document.getElementById('todo-btn-wip');
  const btnLow = document.getElementById('todo-btn-low');
  if (btnHigh) btnHigh.classList.toggle('active', existing.includes('TODO HIGH'));
  if (btnMed) btnMed.classList.toggle('active', existing.includes('TODO MED'));
  if (btnWip) btnWip.classList.toggle('active', existing.includes('TODO WIP'));
  if (btnLow) btnLow.classList.toggle('active', existing.includes('TODO LOW'));
}
async function toggleDecision() {
  const ta = document.getElementById('edit-textarea');
  if (ta) ta.focus();
  try {
    const isRich = ta && ta.contentEditable === 'true';
    const hasSelection = isRich ? (window.getSelection().rangeCount && window.getSelection().toString().trim() !== '') : (ta && ta.selectionStart !== ta.selectionEnd);
    if (hasSelection) {
      if (await wrapSelectionWithDecision()) {
        toast(t('common.selectionMarkedDecision') || 'Selection marked as Decision');
        return;
      }
    } else {
      if (await wrapSelectionWithDecision()) {
        return;
      }
    }
  } catch (e) { console.error('Decision insertion failed:', e); }
}

async function wrapSelectionWithDecision() {
  const ta = document.getElementById('edit-textarea');
  if (!ta) return false;
  const isRich = ta.contentEditable === 'true';

  let range = null;
  let selectedText = 'New Decision';
  let start = null, end = null;

  if (isRich) {
    const selection = window.getSelection();
    if (selection.rangeCount) {
      range = selection.getRangeAt(0).cloneRange();
      selectedText = range.toString().trim() || 'New Decision';
    }
  } else {
    start = ta.selectionStart;
    end = ta.selectionEnd;
  }

  const status = 'active';
  const badgeText = `!decision:${status}`;

  if (isRich) {
    if (!range) return false;
    const containerNode = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentNode;
    if (containerNode && containerNode.closest('.note-decision-wrapper')) {
      const textSpan = containerNode.closest('.note-decision-wrapper').querySelector('.note-decision-text');
      if (textSpan) {
        textSpan.focus();
        return true;
      }
    }
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    const span = document.createElement('span');
    span.className = 'note-decision-wrapper note-decision-draft';
    span.dataset.decisionStatus = status;
    span.dataset.decisionText = '';
    span.setAttribute('contenteditable', 'false');

    const badge = document.createElement('strong');
    badge.className = `pill-decision pill-decision-${status}`;
    badge.setAttribute('contenteditable', 'false');
    badge.textContent = badgeText;

    const textSpan = document.createElement('span');
    textSpan.className = 'note-decision-text';
    textSpan.setAttribute('contenteditable', 'true');
    textSpan.textContent = selectedText;

    span.appendChild(badge);
    span.appendChild(document.createTextNode(' '));
    span.appendChild(textSpan);

    range.deleteContents();
    range.insertNode(span);

    if (typeof window.focusAndSelectElementContents === 'function') {
      window.focusAndSelectElementContents(textSpan);
    } else {
      textSpan.focus();
    }

    ta.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    const template = `!decision:${status} "${selectedText}"`;
    const before = ta.value.slice(0, start);
    const after = ta.value.slice(end);
    ta.value = before + template + after;
    ta.selectionStart = start;
    ta.selectionEnd = start + template.length;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  return true;
}

async function wrapSelectionWithTodo(level) {
  const ta = document.getElementById('edit-textarea');
  if (!ta) return false;
  const isRich = ta.contentEditable === 'true';
  const id = generateTodoId();

  let range = null;
  let selectedText = 'New Todo';
  let start = null, end = null;

  if (isRich) {
    const selection = window.getSelection();
    if (selection.rangeCount) {
      range = selection.getRangeAt(0).cloneRange();
      selectedText = range.toString().trim() || 'New Todo';
    }
  } else {
    start = ta.selectionStart;
    end = ta.selectionEnd;
  }

  const statusAttr = level === 'WIP' ? 'WIP' : '';
  const priorityAttr = level === 'WIP' ? 'Medium' : (level || 'Medium');
  const imp = level === 'WIP' ? 'Medium' : priorityAttr;
  const impClass = imp.toLowerCase();
  const quadrant = priorityAttr === 'High' ? 'Q1' : priorityAttr === 'Low' ? 'Q3' : 'Q2';

  const date = new Date().toISOString().slice(0, 10);
  const noteWs = (typeof currentNote !== 'undefined' && currentNote)
    ? ((typeof getNoteWorkstreamName === 'function' ? getNoteWorkstreamName(currentNote) : '') || currentNote.workstream || (Array.isArray(currentNote.workstreams) ? currentNote.workstreams[0] : '') || '')
    : '';
  const todo = {
    id: id,
    title: selectedText,
    priority: priorityAttr,
    status: statusAttr || undefined,
    eisenhowerQuadrant: quadrant,
    owner: 'me',
    noteId: (typeof currentNote !== 'undefined' && currentNote) ? currentNote.id || '' : '',
    noteTodoMarkerId: id,
    workstream: noteWs || '',
    major_topic_tags: noteWs ? [noteWs] : [],
    context: '',
    created: date,
    modified: date,
  };
  if (typeof todosManifest !== 'undefined' && Array.isArray(todosManifest)) {
    if (!todosManifest.some(t => t.id === id)) {
      todosManifest.push(todo);
      if (typeof saveTodosManifest === 'function') {
        await saveTodosManifest();
      }
    }
  }

  if (isRich) {
    if (!range) return false;
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    const span = document.createElement('span');
    span.className = 'note-todo';
    span.dataset.todoId = id;
    span.dataset.todoPriority = priorityAttr;
    span.dataset.importance = imp;
    span.dataset.todoQuadrant = quadrant;
    if (statusAttr) span.dataset.todoStatus = statusAttr;
    span.setAttribute('contenteditable', 'false');

    const badge = document.createElement('span');
    badge.className = `note-todo-badge imp-${impClass}`;
    badge.setAttribute('contenteditable', 'false');
    badge.title = `Importance: ${imp}`;
    badge.textContent = `⚡ ${statusAttr === 'WIP' ? 'WIP' : imp.toUpperCase()}`;
    span.appendChild(badge);

    span.appendChild(document.createTextNode(' '));

    const textSpan = document.createElement('span');
    textSpan.className = 'note-todo-text';
    textSpan.setAttribute('contenteditable', 'true');
    textSpan.textContent = selectedText;

    span.appendChild(textSpan);

    range.deleteContents();
    range.insertNode(span);

    if (typeof window.focusAndSelectElementContents === 'function') {
      window.focusAndSelectElementContents(textSpan);
    } else {
      textSpan.focus();
    }

    ta.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    if (typeof start !== 'number' || typeof end !== 'number' || start === end) return false;
    const sel = ta.value.slice(start, end);
    const todoSyntax = `{todo:${priorityAttr}:${id}${statusAttr ? `:${statusAttr}` : ''}|${sel}}`;
    const newVal = ta.value.slice(0, start) + todoSyntax + ta.value.slice(end);
    ta.value = newVal;
    ta.selectionStart = ta.selectionEnd = start + todoSyntax.length;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // ensure extra tag present
  const containerId = 'editor-extra';
  const el = document.getElementById(containerId);
  const desired = todoTagText(level);
  if (el && !readTagEditor(containerId).includes(desired)) {
    const css = 'extra-tag ' + (level === 'High' ? 'todo-high' : level === 'Medium' ? 'todo-med' : level === 'WIP' ? 'todo-wip' : 'todo-low');
    addTagPill(el, desired, 'extra', css);
  }
  updateTodoButtonsState();
  if (typeof renderBoard === 'function') renderBoard();
  if (typeof syncPreview === 'function') syncPreview();

  // Directly open the interactive todo overlay modal instead of old prompt dialog
  if (typeof openTodoOverlay === 'function') {
    setTimeout(() => {
      openTodoOverlay(id);
    }, 50);
  }

  return true;
}

async function createTodoFromMarker(todoId) {
  try {
    if (typeof currentNote === 'undefined' || !currentNote || !currentNote.path) { 
      const msg = (typeof t === 'function') ? t('common.noNoteSelected') : 'No note selected';
      toast(msg, true); return; 
    }
    const doc = new DOMParser().parseFromString(currentNote.originalHTML || '<!doctype html><html><head></head><body></body></html>', 'text/html');
    const marker = doc.querySelector(`[data-todo-id="${todoId}"]`);
    if (!marker) { 
      const msg = (typeof t === 'function') ? t('common.markerNotFound') : 'Marker not found';
      toast(msg, true); return; 
    }
    // Title should be the selected text (inner text). Description can be supplied via data-todo-desc
    const textSpan = marker.querySelector('.note-todo-text');
    const titleText = (typeof getTodoMarkerTitleText === 'function') ? getTodoMarkerTitleText(marker).slice(0, 120) : ((textSpan ? textSpan.textContent : marker.textContent) || '').replace(/^todo urgency:\s*(?:High|Medium|Low|Q1|Q2|Q3|Q4|\s*)*/i, '').trim().slice(0, 120);
    const descAttr = marker.getAttribute('data-todo-desc');
    const context = (descAttr && descAttr.trim()) ? descAttr.trim() : '';
    const markerState = getTodoMarkerState(marker);
    const date = new Date().toISOString().slice(0, 10);
    const noteWs = (typeof currentNote !== 'undefined' && currentNote)
      ? ((typeof getNoteWorkstreamName === 'function' ? getNoteWorkstreamName(currentNote) : '') || currentNote.workstream || (Array.isArray(currentNote.workstreams) ? currentNote.workstreams[0] : '') || '')
      : '';
    // Create manifest entry — use the marker's data-todo-id as the todo id
    const todo = {
      id:               todoId,
      title:            titleText || `${typeof t === 'function' ? t('todo.newShort') : 'New Todo'} ${date}`,
      priority:         markerState.priority,
      status:           markerState.status || undefined,
      owner:            'me',
      noteId:           currentNote.id || '',
      noteTodoMarkerId: todoId,
      workstream:       noteWs || '',
      major_topic_tags: noteWs ? [noteWs] : [],
      context:          context,
      created:          date,
      modified:         date,
    };
    todosManifest.push(todo);
    await saveTodosManifest();
    renderBoard();
    // Add extra-tags meta in note HTML
    const desiredTag = todoTagText(markerState.status === 'WIP' ? 'WIP' : markerState.priority);
    let meta = doc.querySelector('meta[name="extra-tags"]');
    if (!meta) {
      meta = doc.createElement('meta');
      meta.setAttribute('name', 'extra-tags');
      doc.head.appendChild(meta);
    }
    const existing = decodeTagListFromStorage(meta.getAttribute('content') || '');
    if (desiredTag && !existing.includes(desiredTag)) existing.push(desiredTag);
    meta.setAttribute('content', encodeTagListToStorage(existing));
    const newHTML = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
    await StorageAPI.writeNoteContent(currentNote.path, newHTML);
    currentNote.originalHTML = newHTML;
    currentNote.mainHTML = doc.querySelector('main')?.innerHTML || currentNote.mainHTML;
    upsertManifest(currentNote);
    await saveManifest();
    syncPreview();
    renderBoard();
    const msg = (typeof t === 'function') ? t('common.todoCreatedWithPriority', { priority: markerState.status === 'WIP' ? t('todo.wip') : t(`todo.${markerState.priority.toLowerCase()}`) }) : 'Todo created';
    toast(msg);
  } catch (e) { 
    const msg = (typeof t === 'function') ? t('common.createTodoFailed', { message: e.message }) : 'Failed to create todo';
    toast(msg, true); 
  }
}
async function openTodoFromMarker(todoId) {
  const activeModal = document.getElementById('modal-refactor-proposals');
  if (activeModal && activeModal.style.display !== 'none' && activeModal.classList.contains('active')) {
    return;
  }
  let todo = getTodoById(todoId);
  if (!todo) {
    await createTodoFromMarker(todoId);
    todo = getTodoById(todoId);
  }
  if (todo) {
    await openTodoOverlay(todoId);
  }
}
window.openTodoFromMarker = openTodoFromMarker;

async function openTodoFileInModal(path) {
  try {
    const parts = path.split('/');
    if (parts.length < 3) { 
      const msg = (typeof t === 'function') ? t('common.invalidPath') : 'Invalid path';
      toast(msg, true); return; 
    }
    const priority = parts[1];
    const filename = parts.slice(2).join('/');
    await openTodoOverlay(filename, priority);
  } catch (e) { 
    const msg = (typeof t === 'function') ? t('common.couldNotOpenTodo', { message: e.message }) : 'Could not open todo';
    toast(msg, true); 
  }
}

async function markTodoDoneFromMarker(todoId) {
  try {
    if (typeof currentNote === 'undefined' || !currentNote) return;
    const todo = getTodoById(todoId);
    if (!todo) { 
      const msg = (typeof t === 'function') ? t('common.todoNotFoundManifest') : 'Todo not found in manifest';
      toast(msg, true); return; 
    }
    changeTodoPriority(todoId, 'Done');
    await saveTodosManifest();
    // Update span in the saved note
    const doc = new DOMParser().parseFromString(currentNote.originalHTML || '', 'text/html');
    const marker = doc.querySelector(`[data-todo-id="${todoId}"]`);
    if (marker) {
      marker.setAttribute('data-todo-priority', 'Done');
      marker.setAttribute('data-todo-original-priority', todo.originalPriority || todo.priority || '');
      if (todo.status === 'WIP') marker.setAttribute('data-todo-status', 'WIP');
      else marker.removeAttribute('data-todo-status');
      applyTodoPriorityToMarker(marker, 'Done', todo.originalPriority || todo.priority || '', todo.status || '');
      const newHTML = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
      await StorageAPI.writeNoteContent(currentNote.path, newHTML);
      currentNote.originalHTML = newHTML;
      currentNote.mainHTML = doc.querySelector('main')?.innerHTML || currentNote.mainHTML;
      upsertManifest(currentNote);
      await saveManifest();
      syncPreview();
    }
    toast((typeof t === 'function') ? t('common.todoMarkedDone') : 'Todo marked done');
  } catch(e) { 
    const msg = (typeof t === 'function') ? t('common.failed', { message: e.message }) : 'Failed';
    toast(msg, true); 
  }
}

// ─── Shared helpers for inline note-todo features ────────────────────────────

// Auto-create todos for any note-todo markers present in the saved note that
// don't yet have a corresponding todo in the todos manifest. Called after a
// final save when closing the overlay.
async function createMissingTodosForCurrentNote() {
  if (typeof currentNote === 'undefined' || !currentNote || !currentNote.path) return;
  try {
    const activeHTML = document.getElementById('edit-textarea')?.innerHTML || currentNote.mainHTML || currentNote.originalHTML || '';
    const doc = new DOMParser().parseFromString(`<div>${activeHTML}</div>`, 'text/html');
    const markers = doc.querySelectorAll('.note-todo[data-todo-id]');
    let created = 0;
    for (const m of markers) {
      const id = m.getAttribute('data-todo-id');
      if (!id) continue;
      const title = ((typeof getTodoMarkerTitleText === 'function')
        ? getTodoMarkerTitleText(m).slice(0, 120)
        : ((typeof cleanTaskTitleText === 'function') ? cleanTaskTitleText(m.textContent || '') : (m.textContent || '').trim().slice(0, 120))) || `Todo ${new Date().toISOString().slice(0, 10)}`;
      const descAttr = m.getAttribute('data-todo-desc');
      const context = (descAttr && descAttr.trim()) ? descAttr.trim() : ((typeof getTodoMarkerTitleText === 'function') ? getTodoMarkerTitleText(m).slice(0, 400) : (m.textContent || '').trim().slice(0, 400));
      const date = new Date().toISOString().slice(0, 10);
      const markerState = getTodoMarkerState(m);
      
      const existing = getTodoById(id);
      if (existing) {
        let modified = false;
        if (title && existing.title !== title) {
          existing.title = title;
          modified = true;
        }
        if (markerState.priority && existing.priority !== markerState.priority) {
          existing.priority = markerState.priority;
          modified = true;
        }
        if (existing.status !== (markerState.status || undefined)) {
          existing.status = markerState.status || undefined;
          modified = true;
        }
        if (modified) {
          existing.modified = date;
          created++;
        }
        continue;
      }
      
      const noteWs = (typeof currentNote !== 'undefined' && currentNote)
        ? ((typeof getNoteWorkstreamName === 'function' ? getNoteWorkstreamName(currentNote) : '') || currentNote.workstream || (Array.isArray(currentNote.workstreams) ? currentNote.workstreams[0] : '') || '')
        : '';
      const todo = {
        id,
        title,
        priority: markerState.priority,
        status: markerState.status || undefined,
        owner: 'me',
        noteId: currentNote.id || '',
        noteTodoMarkerId: id,
        workstream: noteWs || '',
        major_topic_tags: noteWs ? [noteWs] : [],
        context,
        created: date,
        modified: date,
      };
      todosManifest.push(todo);
      created++;
    }
    if (created) {
      await saveTodosManifest();
      renderBoard();
      const msg = (typeof t === 'function') ? t('common.todoCreatedFromMarkers', { count: created }) : `Created ${created} todos from markers`;
      toast(msg);
    }
  } catch (e) { console.error('createMissingTodosForCurrentNote failed', e); }
}


function applyTodoPriorityToMarker(marker, priority, originalPriority = '', status = '') {
  if (!marker) return;
  marker.setAttribute('data-todo-priority', priority);
  if (status === 'WIP') marker.setAttribute('data-todo-status', 'WIP');
  else marker.removeAttribute('data-todo-status');
  if (originalPriority) marker.setAttribute('data-todo-original-priority', originalPriority);
  else marker.removeAttribute('data-todo-original-priority');
  if (priority === 'Done') marker.classList.add('note-todo-done');
  else marker.classList.remove('note-todo-done');
  if (status === 'WIP') marker.classList.add('note-todo-wip');
  else marker.classList.remove('note-todo-wip');
  if (!marker.title) marker.title = (typeof t === 'function' ? t('common.clickToOpenTodo') : '') || 'Click to open todo';

  const impBadge = marker.querySelector('.note-todo-badge[class*="imp-"]');
  if (impBadge) {
    const impClass = (priority || 'medium').toLowerCase();
    impBadge.className = `note-todo-badge imp-${impClass}`;
    impBadge.title = `Importance: ${priority}`;
    impBadge.textContent = `⚡ ${status === 'WIP' ? 'WIP' : (priority || 'MEDIUM').toUpperCase()}`;
  }
}

function getTodoMarkerTitleText(marker) {
  if (!marker) return '';
  const textSpan = marker.querySelector('.note-todo-text');
  if (textSpan) {
    return (typeof cleanTaskTitleText === 'function') ? cleanTaskTitleText(textSpan.textContent) : textSpan.textContent.trim();
  }
  const clone = marker.cloneNode(true);
  clone.querySelectorAll('.note-todo-badge, .todo-urgency-label, .owner-tag, .inline-reassign-owner').forEach(el => el.remove());
  const raw = clone.textContent || '';
  return (typeof cleanTaskTitleText === 'function') ? cleanTaskTitleText(raw) : raw.trim();
}
window.getTodoMarkerTitleText = getTodoMarkerTitleText;

// Update a note-todo span's text + priority inside a full note HTML string (disk)
function updateNoteTodoMarkerInHTML(html, todoId, newText, newPriority, originalPriority = '', status = '') {
  if (!todoId) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const marker = doc.querySelector(`[data-todo-id="${CSS.escape(todoId)}"]`);
  if (!marker) return html;
  if (newText) {
    const cleanText = (typeof cleanTaskTitleText === 'function') ? cleanTaskTitleText(newText) : newText;
    const textSpan = marker.querySelector('.note-todo-text');
    if (textSpan) textSpan.textContent = cleanText;
    else marker.textContent = cleanText;
  }
  if (newPriority) applyTodoPriorityToMarker(marker, newPriority, originalPriority, status);
  return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
}

// Patch the opening tag of a note-todo span inside a raw markdown+html string (textarea)
function patchNoteSpanInText(text, todoId, { setAttr = {} } = {}) {
  const escapedId = todoId.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  const re = new RegExp(`\\{todo:([a-zA-Z]+):(${escapedId})(?::([a-zA-Z]+))?\\|([^\\}]+)\\}`, 'g');
  return text.replace(re, (match, priority, id, status, contentText) => {
    const nextPriority = setAttr['data-todo-priority'] || priority;
    const nextStatus = setAttr['data-todo-status'] !== undefined ? setAttr['data-todo-status'] : (status || '');
    return `{todo:${nextPriority}:${id}${nextStatus ? `:${nextStatus}` : ''}|${contentText}}`;
  });
}
// Forward-sync: refresh span text + priority in a rendered container from the manifest
async function syncTodoMarkersFromDOM(container) {
  if (!container) return;
  const markers = container.querySelectorAll('.note-todo[data-todo-id]');
  for (const m of markers) {
    const todoId = m.getAttribute('data-todo-id');
    if (!todoId) continue;
    const todo = getTodoById(todoId);
    if (!todo) continue;
    
    const cleanTitle = (typeof getCleanTaskTitle === 'function') ? getCleanTaskTitle(todo) : (todo.title || todoId);
    const textSpan = m.querySelector('.note-todo-text');
    if (textSpan) textSpan.textContent = cleanTitle;
    else m.textContent = cleanTitle;
    
    m.title = t('common.clickToOpenTodo');
    applyTodoPriorityToMarker(m, todo.priority, todo.originalPriority || '', todo.status || '');
  }
}

// Build the compact todo action bar DOM element from a HTML string
// isEditMode: true → actions operate on textarea content; false → operate on saved note
function buildTodoActionBarEl(htmlString, isEditMode) {
  const tmp = new DOMParser().parseFromString('<div>' + (htmlString || '') + '</div>', 'text/html');
  const markers = tmp.querySelectorAll('.note-todo');
  if (!markers.length) return null;

  const bar = document.createElement('div');
  bar.className = 'note-todo-bar';
  const lbl = document.createElement('span');
  lbl.className = 'note-todo-bar-label';
  lbl.textContent = t('todo.actionBarLabel');
  bar.appendChild(lbl);

  markers.forEach(m => {
    const id       = m.getAttribute('data-todo-id');
    // Look up live state from manifest
    const todo     = id ? getTodoById(id) : null;
    const markerState = getTodoMarkerState(m);
    const priority = todo ? getTodoEffectivePriority(todo) : markerState.priority;
    const status = todo ? todo.status || markerState.status : markerState.status;
    const originalPriority = todo ? (todo.originalPriority || m.getAttribute('data-todo-original-priority') || priority) : (m.getAttribute('data-todo-original-priority') || priority);
    const isDone   = todo ? todo.priority === 'Done' : (m.classList.contains('note-todo-done') || m.getAttribute('data-todo-priority') === 'Done');
    const rawText = todo ? (typeof getCleanTaskTitle === 'function' ? getCleanTaskTitle(todo) : todo.title) : getTodoMarkerTitleText(m);
    const text = ((typeof cleanTaskTitleText === 'function') ? cleanTaskTitleText(rawText) : (rawText || '')).slice(0, 70);
    const hasLinkedTodo = !!todo;
    const itemLabel = text || t('common.thisTodo');

    const item = document.createElement('span');
    item.className = 'note-todo-bar-item';
    item.title = hasLinkedTodo ? t('common.clickToOpenNamed', { value: itemLabel }) : t('common.clickToCreateNamed', { value: itemLabel });

    const qStr = typeof getTodoQuadrant === 'function' ? getTodoQuadrant(todo) : priority;
    const badge = document.createElement('span');
    badge.className = `note-todo-badge p-${(isDone ? 'done' : status === 'WIP' ? 'wip' : priority).toLowerCase()}`;
    badge.textContent = isDone
      ? `${t('todo.done').toUpperCase()} · ${qStr}`
      : status === 'WIP'
        ? `${t('todo.wip')} · ${qStr}`
        : qStr;
    item.appendChild(badge);

    const textSpan = document.createElement('span');
    textSpan.textContent = text;
    item.appendChild(textSpan);

    if (isDone) {
      // nothing extra
    } else if (!hasLinkedTodo) {
      const btn = document.createElement('button');
      btn.className = 'note-todo-action-btn';
      btn.textContent = t('todo.createAction');
      btn.title = t('common.clickToCreateNamed', { value: itemLabel });
      btn.onclick = () => isEditMode ? createTodoFromMarkerEditMode(id) : createTodoFromMarker(id);
      item.appendChild(btn);
    } else {
      const btnOpen = document.createElement('button');
      btnOpen.className = 'note-todo-action-btn';
      btnOpen.textContent = t('todo.openAction');
      btnOpen.title = t('todo.openDetailsAction');
      btnOpen.onclick = () => isEditMode ? openTodoFromMarkerEditMode(id) : openTodoFromMarker(id);
      item.appendChild(btnOpen);
      const btnDone = document.createElement('button');
      btnDone.className = 'note-todo-action-btn';
      btnDone.textContent = t('todo.doneAction');
      btnDone.title = t('todo.markDoneAction');
      btnDone.onclick = () => isEditMode ? markTodoDoneFromMarkerEditMode(id) : markTodoDoneFromMarker(id);
      item.appendChild(btnDone);
    }
    bar.appendChild(item);
  });
  return bar;
}

// Edit-mode versions of the three todo actions (work on textarea content, not saved HTML)
async function createTodoFromMarkerEditMode(todoId) {
  const ta = document.getElementById('edit-textarea');
  if (!ta) return;
  const marker = ta.querySelector(`[data-todo-id="${todoId}"]`);
  if (!marker) { toast(t('common.markerNotFound'), true); return; }
  if (!currentNote || !currentNote.path) { toast(t('common.saveTheNoteFirst'), true); return; }
  const titleText = (typeof getTodoMarkerTitleText === 'function') ? getTodoMarkerTitleText(marker).slice(0, 120) : ((marker.querySelector('.note-todo-text')?.textContent || marker.textContent) || '').trim().slice(0, 120);
  const descAttr = marker.getAttribute('data-todo-desc');
  const context = (descAttr && descAttr.trim()) ? descAttr.trim() : '';
  const markerState = getTodoMarkerState(marker);
  const date = new Date().toISOString().slice(0, 10);
  const noteWs = (typeof currentNote !== 'undefined' && currentNote)
    ? ((typeof getNoteWorkstreamName === 'function' ? getNoteWorkstreamName(currentNote) : '') || currentNote.workstream || (Array.isArray(currentNote.workstreams) ? currentNote.workstreams[0] : '') || '')
    : '';
  const todo = {
      id:               todoId,
      title:            titleText || `${t('todo.newShort')} ${date}`,
      priority:         markerState.priority,
      status:           markerState.status || undefined,
    owner:            'me',
    noteId:           currentNote.id || '',
    noteTodoMarkerId: todoId,
    workstream:       noteWs || '',
    major_topic_tags: noteWs ? [noteWs] : [],
    context:          context,
    created:          date,
    modified:         date,
  };
  if (!getTodoById(todoId)) {
    todosManifest.push(todo);
    await saveTodosManifest();
  }
  renderBoard();
  ta.dispatchEvent(new Event('input'));
  toast(t('common.todoCreatedWithPriority', { priority: markerState.status === 'WIP' ? t('todo.wip') : t(`todo.${markerState.priority.toLowerCase()}`) }));
}

async function openTodoFromMarkerEditMode(todoId) {
  const activeModal = document.getElementById('modal-refactor-proposals');
  if (activeModal && activeModal.style.display !== 'none' && activeModal.classList.contains('active')) {
    return;
  }
  let todo = getTodoById(todoId);
  if (!todo) {
    await createTodoFromMarkerEditMode(todoId);
    todo = getTodoById(todoId);
  }
  if (todo) {
    await openTodoOverlay(todoId);
  }
}
window.openTodoFromMarkerEditMode = openTodoFromMarkerEditMode;

async function markTodoDoneFromMarkerEditMode(todoId) {
  const ta = document.getElementById('edit-textarea');
  if (!ta) return;
  const todo = getTodoById(todoId);
  if (!todo) { toast(t('common.todoNotFoundManifest'), true); return; }
  changeTodoPriority(todoId, 'Done');
  await saveTodosManifest();
  const isRich = ta.contentEditable === 'true';
  if (isRich) {
    const marker = ta.querySelector(`[data-todo-id="${todoId}"]`);
    if (marker) {
      marker.setAttribute('data-todo-priority', 'Done');
      marker.setAttribute('data-todo-original-priority', todo.originalPriority || todo.priority || '');
      marker.removeAttribute('data-todo-status');
      marker.classList.add('note-todo-done');
      marker.classList.remove('note-todo-wip');
    }
  } else {
    ta.value = patchNoteSpanInText(ta.value, todoId, {
      setAttr: {
        'data-todo-priority': 'Done',
        'data-todo-original-priority': todo.originalPriority || todo.priority || '',
        'data-todo-status': todo.status || ''
      },
      addClass: ['note-todo-done']
    });
  }
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  syncPreview();
  await renderInspectorPanel();
  toast(t('common.todoMarkedDone'));
}


// New Note modal tab stub for backward compatibility
function showMdTab(tab) {}

async function showNewNote() {
  await openNoteOverlay(null);
  if (activeTab !== 'notes') await switchTab('notes');
}


async function createNewNote() {
  const title = document.getElementById('nn-title')?.value?.trim() || '';
  const date  = document.getElementById('nn-date')?.value?.trim() || '';
  const group = document.getElementById('nn-group')?.value?.trim() || '';
  const major = document.getElementById('nn-major')?.value?.trim() || '';
  const topic = document.getElementById('nn-topic')?.value?.trim() || '';
  const nnContent = document.getElementById('nn-content');
  if (nnContent) {
    normalizeRawTodoTagsInTextAndAdjustCursor(nnContent);
    await processDoneCommandsInText(nnContent.value, nnContent);
  }
  const md    = nnContent ? nnContent.value.trim() : '';

  if (!title) { toast(t('common.titleRequired'), true); return; }
  if (!date)  { toast(t('common.dateRequired'),  true); return; }

  // Convert markdown → HTML for storage
  let mainHTML = md ? mdToPreviewHTML(md) : '<p></p>';
  for (const token in _imgTokenMap) {
    if (Object.prototype.hasOwnProperty.call(_imgTokenMap, token) && mainHTML.includes(token)) {
      mainHTML = mainHTML.replaceAll(token, _imgTokenMap[token]);
    }
  }
  mainHTML = await processAndExternalizeImages(mainHTML);

  const id        = generateNoteId();
  const path      = getCanonicalNotePath(id);

  const note = {
    id,
    path, title, date,
    group_tags:       group ? [group] : [],
    major_topic_tags: major ? [major] : [],
    topic_tags:       topic ? [topic] : [],
    extra_tags:       [],
    mainHTML,
  };

  try {
    await StorageAPI.writeNoteContent(path, buildNewNoteHTML(note));
    upsertManifest(note);
    await saveManifest();
    await rebuildIndexHTML();
    renderFilterChips();
    await renderBoard();

    // Link newly created sync note to the collaborator's next scheduled sync planner event
    if (group && group.toLowerCase() === 'sync' && topic && typeof plannerEvents !== 'undefined' && Array.isArray(plannerEvents)) {
      const key = topic.trim().toLowerCase();
      const unsyncedSyncEv = plannerEvents.find(ev => {
        if ((ev.type || '').toLowerCase() !== 'sync') return false;
        if (ev.noteId) return false;
        const names = typeof extractPlannerCollaborators === 'function' ? extractPlannerCollaborators(ev) : [ev.title];
        return names.some(n => n.trim().toLowerCase() === key);
      });

      if (unsyncedSyncEv) {
        unsyncedSyncEv.noteId = id;
        if (typeof normalizePlannerLinkedNoteIds === 'function') {
          unsyncedSyncEv.linkedNoteIds = normalizePlannerLinkedNoteIds([id, ...(unsyncedSyncEv.linkedNoteIds || [])], id);
        }
        if (typeof savePlanner === 'function') {
          await savePlanner();
        }
        if (typeof renderPlanner === 'function') {
          renderPlanner();
        }
      }
    }

    closeModal('modal-new-note');
    ['nn-title','nn-content','nn-major'].forEach(id => document.getElementById(id).value = '');
    await openNoteOverlay(path);
    if (activeTab !== 'notes') await switchTab('notes');
    toast(t('common.noteCreated'));
  } catch (e) { toast(t('common.couldNotCreateNote', { message: e.message }), true); }
}
// ═══ Modals ═══
/** Hides "remember passphrase" controls when the OS keychain is unavailable (e.g. plain browser). */
async function applyPassphraseStorageAvailability(elementIds) {
  let available = false;
  try {
    available = !!(window.FirebaseSyncService && await window.FirebaseSyncService.isPassphraseStorageAvailable());
  } catch (e) {
    available = false;
  }
  elementIds.forEach((elId) => {
    const el = document.getElementById(elId);
    if (!el) return;
    const target = el.tagName === 'INPUT' ? (el.closest('label') || el) : el;
    target.style.display = available ? '' : 'none';
    if (!available && el.type === 'checkbox') el.checked = false;
  });
}

function openModal(id)  {
  const modal = document.getElementById(id);
  if (!modal) return;
  if (modal._closeTimer) {
    clearTimeout(modal._closeTimer);
    modal._closeTimer = null;
  }
  modal.style.display = 'flex';
  modal.classList.remove('closing');
  modal.classList.add('active');
  if (id === 'modal-cloud-sync-setup') {
    if (typeof switchSyncSetupTab === 'function') switchSyncSetupTab('signin');
    const syncInput = document.getElementById('sync-setup-sync-code');
    if (syncInput && (!syncInput.value || syncInput.getAttribute('data-linked') === 'true')) {
      syncInput.value = window.FirebaseSyncService?.getSyncCode() || window.FirebaseSyncService?.generateSyncCode() || '';
      syncInput.removeAttribute('data-linked');
    }
    const userInput = document.getElementById('sync-setup-username');
    if (userInput) {
      userInput.value = window.FirebaseSyncService?.getSyncCode() || 'Secretary Vault';
    }
    applyPassphraseStorageAvailability(['sync-setup-remember-pass']);
    if (typeof updateCustomFirebaseStatusUI === 'function') updateCustomFirebaseStatusUI();
  }
  if (id === 'modal-cloud-sync-unlock') {
    const userInput = document.getElementById('sync-unlock-username');
    if (userInput) {
      userInput.value = window.FirebaseSyncService?.getSyncCode() || 'Secretary Vault';
    }
    const remCb = document.getElementById('sync-unlock-remember-pass');
    if (remCb) {
      remCb.checked = typeof settings === 'object' && settings?.rememberPassphrase === true;
    }
    applyPassphraseStorageAvailability(['sync-unlock-remember-pass', 'btn-sync-unlock-save']);
    const passInput = document.getElementById('sync-unlock-passphrase');
    if (passInput) {
      setTimeout(() => passInput.focus(), 60);
    }
  }
  if (id === 'modal-cloud-sync-password-rotate') {
    const userInput = document.getElementById('sync-rotate-username');
    if (userInput) {
      userInput.value = window.FirebaseSyncService?.getSyncCode() || 'Secretary Vault';
    }
    const curPass = document.getElementById('sync-rotate-current-pass');
    if (curPass) {
      setTimeout(() => curPass.focus(), 60);
    }
  }
  if (typeof rememberDialogFormState === 'function') rememberDialogFormState(modal);
}
window.openModal = openModal;

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  if (id === 'modal-cloud-exit-confirm' && typeof resolveCloudExitDialog === 'function' && typeof _cloudExitResolver === 'function') {
    resolveCloudExitDialog('cancel');
  }
  if (modal.classList.contains('closing')) return;
  if (modal._closeTimer) clearTimeout(modal._closeTimer);
  modal.classList.add('closing');
  modal._closeTimer = setTimeout(() => {
    modal.classList.remove('active', 'closing');
    modal.style.display = '';
    modal._closeTimer = null;
    if (typeof clearDialogFormState === 'function') clearDialogFormState(modal);
    if (window.AIChatController) {
      AIChatController.activeSuggestionRoute = null;
    }
  }, 160);
}
window.closeModal = closeModal;

function _closeModalOverlayElement(overlay) {
  if (!overlay) return;
  if (overlay.id === 'modal-cloud-exit-confirm' && typeof resolveCloudExitDialog === 'function' && typeof _cloudExitResolver === 'function') {
    resolveCloudExitDialog('cancel');
  }
  if (typeof removePlannerCreatePreview === 'function') removePlannerCreatePreview();
  if (overlay.classList.contains('closing')) return;
  if (overlay._closeTimer) clearTimeout(overlay._closeTimer);
  overlay.classList.add('closing');
  overlay._closeTimer = setTimeout(() => {
    overlay.classList.remove('active', 'closing');
    overlay.style.display = '';
    overlay._closeTimer = null;
    if (typeof clearDialogFormState === 'function') clearDialogFormState(overlay);
  }, 160);
}

function _findPrimarySaveButton(overlay) {
  if (!overlay) return null;
  return overlay.querySelector('.modal-actions .btn-save, .btn-save');
}

async function _requestCloseModalOverlay(overlay) {
  if (!overlay) return;
  const saveBtn = _findPrimarySaveButton(overlay);
  const requiresGuard = !!saveBtn;
  const dirty = requiresGuard && typeof hasDialogUnsavedChanges === 'function' && hasDialogUnsavedChanges(overlay);

  if (!dirty) {
    _closeModalOverlayElement(overlay);
    return;
  }

  const choice = await showUnsavedChangesDialog();
  if (choice === 'discard') {
    _closeModalOverlayElement(overlay);
    return;
  }
  if (choice === 'save' && saveBtn) {
    saveBtn.click();
  }
}

let _modalPanelMouseDown = false;
document.addEventListener('mousedown', e => {
  const activeOverlay = e.target.closest('.modal-overlay.active');
  if (!activeOverlay) {
    _modalPanelMouseDown = false;
    return;
  }
  _modalPanelMouseDown = !!e.target.closest('.modal');
}, true);

document.addEventListener('click', e => {
  const overlay = e.target.closest('.modal-overlay.active');
  if (!overlay || e.target !== overlay) return;
  if (_modalPanelMouseDown) {
    _modalPanelMouseDown = false;
    return;
  }
  if (e.button !== 0) return;
  _modalPanelMouseDown = false;
  _requestCloseModalOverlay(overlay);
});

// ── Image thumbnail strip in editor (inside info section below blocs) ─────────
function syncImageStrip() {
  const noteEdit = document.getElementById('note-edit');
  if (!noteEdit) return;

  // Clean up any legacy strip outside info section if present
  noteEdit.querySelector(':scope > .edit-img-strip')?.remove();

  // Collect images from rich editor, summary, as well as token map
  const ta = document.getElementById('edit-textarea');
  const sum = document.getElementById('edit-summary');
  const domImgsTa = ta ? Array.from(ta.querySelectorAll('img')).map(img => img.outerHTML) : [];
  const domImgsSum = sum ? Array.from(sum.querySelectorAll('img')).map(img => img.outerHTML) : [];
  const tokenImgs = typeof _imgTokenMap !== 'undefined' ? Object.values(_imgTokenMap || {}) : [];
  const imgs = [...new Set([...domImgsTa, ...domImgsSum, ...tokenImgs])];
  const signature = imgs.join('\u0001');
  if (signature === _lastImageStripSignature) return;
  _lastImageStripSignature = signature;

  const fieldsContainer = document.getElementById('edit-fields-collapsible');
  let imagesRow = document.getElementById('overlay-images-row');
  let imagesStrip = document.getElementById('overlay-images-strip');

  if (!imagesRow && fieldsContainer) {
    imagesRow = document.createElement('div');
    imagesRow.className = 'field-row';
    imagesRow.id = 'overlay-images-row';
    imagesRow.style.cssText = 'align-items:flex-start; display:none; margin-top:0.6rem; padding-top:0.6rem; border-top:1px solid var(--card-border)';

    const label = document.createElement('span');
    label.className = 'field-label';
    label.style.marginTop = '4px';
    label.textContent = (typeof t === 'function' ? t('editor.imagesLabel') : null) || 'Images';
    imagesRow.appendChild(label);

    imagesStrip = document.createElement('div');
    imagesStrip.id = 'overlay-images-strip';
    imagesStrip.className = 'overlay-images-strip';
    imagesStrip.style.cssText = 'display:flex; flex-wrap:wrap; gap:0.4rem; align-items:center; flex:1';
    imagesRow.appendChild(imagesStrip);

    const blocksRow = document.getElementById('overlay-planner-blocks-row');
    if (blocksRow && blocksRow.nextSibling) {
      fieldsContainer.insertBefore(imagesRow, blocksRow.nextSibling);
    } else {
      fieldsContainer.appendChild(imagesRow);
    }
  }

  if (!imagesRow || !imagesStrip) return;

  if (!imgs.length) {
    imagesRow.style.display = 'none';
    imagesStrip.innerHTML = '';
    return;
  }

  imagesRow.style.display = 'flex';
  imagesStrip.innerHTML = '';

  imgs.forEach(tagHtml => {
    // Extract src from the img tag
    const srcMatch = tagHtml.match(/src="([^"]+)"/);
    if (!srcMatch) return;
    const src = srcMatch[1];
    
    // Extract data-id or data-asset-path if available
    const idMatch = tagHtml.match(/data-id="([^"]+)"/);
    const id = idMatch ? idMatch[1] : null;
    const assetMatch = tagHtml.match(/data-asset-path="([^"]+)"/);
    const assetPath = assetMatch ? assetMatch[1] : null;
    
    const wrap = document.createElement('div');
    wrap.className = 'edit-img-thumb-wrap';

    const thumb = document.createElement('img');
    thumb.className = 'edit-img-thumb';
    thumb.src = src;
    thumb.alt = 'Image';
    thumb.title = (typeof t === 'function' ? t('editor.locateImageTooltip') : null) || 'Scroll to and select image in note';

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'edit-img-thumb-del';
    delBtn.title = (typeof t === 'function' ? t('editor.removeImageTooltip') : null) || 'Remove this image from note';
    delBtn.innerHTML = '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

    const findImageInElement = (container) => {
      if (!container) return null;
      if (id) {
        const byId = container.querySelector(`img[data-id="${id}"]`);
        if (byId) return byId;
      }
      if (assetPath) {
        const byAsset = container.querySelector(`img[data-asset-path="${assetPath}"]`);
        if (byAsset) return byAsset;
      }
      return Array.from(container.querySelectorAll('img')).find(img => img.src === src || img.getAttribute('src') === src);
    };

    delBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      let targetImg = null;
      let targetEditor = null;
      if (ta) {
        targetImg = findImageInElement(ta);
        if (targetImg) targetEditor = ta;
      }
      if (!targetImg && sum) {
        targetImg = findImageInElement(sum);
        if (targetImg) targetEditor = sum;
      }

      if (typeof hideImageActiveOverlay === 'function') {
        hideImageActiveOverlay();
      }

      if (targetImg) {
        targetImg.remove();
        if (targetEditor) {
          targetEditor.dispatchEvent(new Event('input', { bubbles: true }));
        }
      } else {
        if (typeof _imgTokenMap !== 'undefined') {
          for (const k in _imgTokenMap) {
            if (_imgTokenMap[k]?.includes(src) || (id && _imgTokenMap[k]?.includes(id))) {
              delete _imgTokenMap[k];
            }
          }
        }
        if (ta && typeof ta.value === 'string') {
          const regex = new RegExp(`<img[^>]*(${id ? `data-id="${id}"|` : ''}src="${src.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}")[^>]*>`, 'g');
          ta.value = ta.value.replace(regex, '');
          ta.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }

      wrap.remove();
      _lastImageStripSignature = '';
      syncImageStrip();
    });
    
    thumb.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      let targetImg = null;
      let targetEditor = null;
      
      if (ta) {
        targetImg = findImageInElement(ta);
        if (targetImg) targetEditor = ta;
      }
      if (!targetImg && sum) {
        targetImg = findImageInElement(sum);
        if (targetImg) targetEditor = sum;
      }
      
      if (targetImg && targetEditor) {
        try {
          targetImg.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch (err) {
          targetImg.scrollIntoView();
        }
        if (typeof selectEditorImage === 'function') {
          selectEditorImage(targetImg, targetEditor);
        }
      } else {
        const win = window.open();
        if (win) {
          win.document.write(`<img src="${src}" style="max-width:100%;display:block;margin:auto;background:#000;min-height:100vh">`);
          win.document.title = (typeof t === 'function' ? t('editor.imagePreview') : null) || 'Image preview';
        }
      }
    });
    
    wrap.appendChild(thumb);
    wrap.appendChild(delBtn);
    imagesStrip.appendChild(wrap);
  });
}

// ── Right Inspector Panel ──────────────────────────────────────────────────
function _getInspectorPaneBounds(containerWidth) {
  const safeWidth = Math.max(320, Math.floor(containerWidth || 0));
  const minW = 180;
  const maxByRatio = Math.max(minW, Math.floor(safeWidth * 0.5));
  const maxByContainer = Math.max(minW, safeWidth - 140);
  const maxW = Math.max(minW, Math.min(560, maxByRatio, maxByContainer));
  return { minW: Math.min(minW, maxW), maxW };
}

function _ensureInspectorResizeHandle(panel) {
  if (!panel || !panel.parentElement) return null;
  const parent = panel.parentElement;
  let handle = document.getElementById('overlay-inspector-resize-handle');
  if (!handle) {
    handle = document.createElement('div');
    handle.id = 'overlay-inspector-resize-handle';
    handle.className = 'edit-resize-handle inspector-resize-handle';
    handle.title = t('editor.resizeInspectorTooltip') || 'Resize inspector pane';
  }
  if (handle.parentElement !== parent) {
    parent.insertBefore(handle, panel);
  }
  return handle;
}

function _applyInspectorPaneWidth() {
  const panel = document.getElementById('overlay-right-panel');
  const main = document.querySelector('.overlay-main-layout');
  if (!panel || !main || panel.classList.contains('collapsed') || panel.style.display === 'none') return;

  const mainW = main.getBoundingClientRect().width;
  if (!mainW) return;
  const { minW, maxW } = _getInspectorPaneBounds(mainW);
  const desired = (typeof noteInspectorPaneWidth === 'number' && !isNaN(noteInspectorPaneWidth))
    ? noteInspectorPaneWidth
    : (panel.getBoundingClientRect().width || 320);
  const clamped = Math.max(minW, Math.min(maxW, desired));

  panel.style.width = `${Math.round(clamped)}px`;
  panel.style.minWidth = `${Math.round(minW)}px`;
  panel.style.maxWidth = `${Math.round(maxW)}px`;
  noteInspectorPaneWidth = Math.round(clamped);
}

function _initInspectorPaneResizeHandle() {
  const panel = document.getElementById('overlay-right-panel');
  const main = document.querySelector('.overlay-main-layout');
  const handle = document.getElementById('overlay-inspector-resize-handle');
  if (!panel || !main || !handle) return;

  const st = window._inspectorPaneResizeState || {
    dragging: false,
    mainRect: null,
    panel: null,
    handle: null,
    bound: false
  };

  st.panel = panel;
  st.handle = handle;
  window._inspectorPaneResizeState = st;

  handle.onmousedown = e => {
    if (st.panel.classList.contains('collapsed') || st.panel.style.display === 'none') return;
    st.dragging = true;
    st.mainRect = main.getBoundingClientRect();
    st.handle.classList.add('dragging');
    document.body.classList.add('note-inspector-resizing');
    e.preventDefault();
  };

  if (st.bound) return;
  st.bound = true;

  document.addEventListener('mousemove', e => {
    if (!st.dragging || !st.mainRect || !st.panel) return;
    const { minW, maxW } = _getInspectorPaneBounds(st.mainRect.width);
    const next = st.mainRect.right - e.clientX;
    const width = Math.max(minW, Math.min(maxW, next));
    noteInspectorPaneWidth = Math.round(width);
    st.panel.style.width = `${noteInspectorPaneWidth}px`;
    st.panel.style.minWidth = `${Math.round(minW)}px`;
    st.panel.style.maxWidth = `${Math.round(maxW)}px`;
  });

  document.addEventListener('mouseup', () => {
    if (!st.dragging) return;
    st.dragging = false;
    if (st.handle) st.handle.classList.remove('dragging');
    document.body.classList.remove('note-inspector-resizing');
    if (typeof noteInspectorPaneWidth === 'number' && noteInspectorPaneWidth > 0) {
      try { localStorage.setItem('secretaryNoteInspectorPaneWidth', String(noteInspectorPaneWidth)); } catch (e) {}
    }
  });

  window.addEventListener('resize', () => {
    if (st.dragging) return;
    _applyInspectorPaneWidth();
  });
}

async function renderInspectorPanel() {
  const panel = document.getElementById('overlay-right-panel');
  if (!panel) return;

  const currentNoteId = currentNote ? currentNote.id : null;
  const aiEnabled = typeof LLMService !== 'undefined' && LLMService.isEnabled();
  const isCollapsed = panel.classList.contains('collapsed') || !relatedNotesOpen;

  panel.dataset.currentNoteId = currentNoteId || '';
  panel.dataset.activeTab = activeInspectorTab || '';
  panel.dataset.aiEnabled = String(aiEnabled);

  if (typeof unmountAiLane === 'function') {
    unmountAiLane();
  }

  panel.innerHTML = '';
  if (!currentNote) {
    panel.style.display = 'none';
    const resizeHandle = document.getElementById('overlay-inspector-resize-handle');
    if (resizeHandle) resizeHandle.classList.add('hidden');
    return;
  }

  panel.classList.toggle('ai-enabled', aiEnabled);
  panel.style.display = '';
  const resizeHandle = _ensureInspectorResizeHandle(panel);

  const header = document.createElement('div');
  header.className = 'overlay-related-notes-header';

  const labelEl = document.createElement('span');
  labelEl.className = 'overlay-related-notes-label';
  labelEl.textContent = t('editor.inspector') || 'Inspector';

  const chevronEl = document.createElement('span');
  chevronEl.className = 'overlay-related-notes-chevron';
  chevronEl.textContent = '▾';

  header.appendChild(labelEl);
  header.appendChild(chevronEl);
  panel.appendChild(header);

  // Restore collapse state from persisted "open" flag.
  panel.classList.toggle('collapsed', !relatedNotesOpen);
  if (resizeHandle) resizeHandle.classList.toggle('hidden', panel.classList.contains('collapsed'));

  if (panel.classList.contains('collapsed')) {
    // Clear any previously injected inline width from drag-resize so collapsed CSS can apply.
    panel.style.width = '';
    panel.style.minWidth = '';
    panel.style.maxWidth = '';
    const expandTooltip = t('editor.expandInspectorTooltip') || 'Click or drag to expand inspector';
    panel.title = expandTooltip;
    header.title = expandTooltip;

    let downX = 0;
    let isMouseDown = false;
    let didDrag = false;

    panel.onmousedown = e => {
      if (e.button !== 0) return;
      downX = e.clientX;
      isMouseDown = true;
      didDrag = false;

      const onMouseMove = moveEvt => {
        if (!isMouseDown) return;
        const diff = downX - moveEvt.clientX;
        if (diff > 6) {
          didDrag = true;
          isMouseDown = false;
          window.removeEventListener('mousemove', onMouseMove);
          window.removeEventListener('mouseup', onMouseUp);

          relatedNotesOpen = true;
          try { localStorage.setItem('secretaryRelatedNotesOpen', '1'); } catch(err) {}
          renderInspectorPanel();

          const main = document.querySelector('.overlay-main-layout');
          if (main) {
            const mainRect = main.getBoundingClientRect();
            const { minW, maxW } = _getInspectorPaneBounds(mainRect.width);
            const next = mainRect.right - moveEvt.clientX;
            const width = Math.max(minW, Math.min(maxW, next));
            noteInspectorPaneWidth = Math.round(width);
            panel.style.width = `${noteInspectorPaneWidth}px`;
            panel.style.minWidth = `${Math.round(minW)}px`;
            panel.style.maxWidth = `${Math.round(maxW)}px`;

            const st = window._inspectorPaneResizeState;
            if (st) {
              st.dragging = true;
              st.mainRect = mainRect;
              if (st.handle) st.handle.classList.add('dragging');
              document.body.classList.add('note-inspector-resizing');
            }
          }
        }
      };

      const onMouseUp = () => {
        isMouseDown = false;
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        if (!didDrag) {
          relatedNotesOpen = true;
          try { localStorage.setItem('secretaryRelatedNotesOpen', '1'); } catch(err) {}
          renderInspectorPanel();
        }
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    };

    return;
  }

  panel.onmousedown = null;
  panel.title = '';
  header.title = t('editor.collapseInspectorTooltip') || 'Collapse inspector pane';

  header.onclick = e => {
    e.stopPropagation();
    panel.classList.toggle('collapsed');
    relatedNotesOpen = !panel.classList.contains('collapsed');
    try { localStorage.setItem('secretaryRelatedNotesOpen', relatedNotesOpen ? '1' : '0'); } catch(err) {}
    renderInspectorPanel();
  };

  // Reset collapsed inline constraints before re-applying persisted expanded width.
  panel.style.minWidth = '';
  panel.style.maxWidth = '';
  _applyInspectorPaneWidth();
  _initInspectorPaneResizeHandle();

  // Render Tabs
  const tabsRow = document.createElement('div');
  tabsRow.className = 'inspector-tabs';
  tabsRow.style.display = 'flex';
  tabsRow.style.borderBottom = '1px solid var(--card-border)';
  tabsRow.style.background = 'var(--card-bg)';

  const tabs = [
    { id: 'A', label: t('editor.inspectorTabA') || 'Notes Liées', tooltip: t('editor.inspectorTabATooltip') },
    { id: 'B', label: t('editor.inspectorTabB') || 'Décisions', tooltip: t('editor.inspectorTabBTooltip') },
    { id: 'C', label: t('editor.inspectorTabC') || 'Tâches', tooltip: t('editor.inspectorTabCTooltip') }
  ];

  tabs.forEach(tab => {
    const btn = document.createElement('button');
    btn.className = `inspector-tab-btn tab-${tab.id}${activeInspectorTab === tab.id ? ' active' : ''}`;
    btn.style.cssText = `
      flex: 1;
      border: none;
      background: none;
      padding: 8px 4px;
      font-size: 0.72rem;
      cursor: pointer;
      color: ${activeInspectorTab === tab.id ? 'var(--accent)' : 'var(--text-muted)'};
      font-weight: 600;
      text-align: center;
      border-bottom: 2px solid ${activeInspectorTab === tab.id ? 'var(--accent)' : 'transparent'};
      transition: all var(--transition);
    `;
    btn.innerHTML = tab.label;
    btn.title = tab.tooltip;
    btn.addEventListener('click', () => {
      window.switchInspectorTab(tab.id);
    });
    tabsRow.appendChild(btn);
  });
  panel.appendChild(tabsRow);

  const body = document.createElement('div');
  body.className = 'overlay-related-notes-body';
  panel.appendChild(body);

  if (activeInspectorTab === 'A') {
    // NOTES LIÉES
    const linkNoteWrap = document.createElement('div');
    linkNoteWrap.style.marginBottom = '1.2rem';
    linkNoteWrap.style.display = 'flex';
    linkNoteWrap.style.justifyContent = 'stretch';
    
    const linkNoteBtn = document.createElement('button');
    linkNoteBtn.className = 'btn link-note-btn';
    linkNoteBtn.style.padding = '0.4rem 0.8rem';
    linkNoteBtn.style.fontSize = '0.78rem';
    linkNoteBtn.style.width = '100%';
    linkNoteBtn.innerHTML = `🔗 Lier une note...`;
    linkNoteBtn.addEventListener('click', () => {
      openLinkNotePicker(linkNoteBtn);
    });
    linkNoteWrap.appendChild(linkNoteBtn);
    body.appendChild(linkNoteWrap);

    // 0b. Planner bloc associated notes management
    _renderInspectorBlocAssociatedNotesSection(body);

    // 1. Backlinks
    let backlinks = [];
    try {
      backlinks = await getBacklinksForNote(currentNote);
    } catch(e) {
      console.warn(e);
    }

    const backlinksLabel = document.createElement('div');
    backlinksLabel.className = 'overlay-backlinks-label';
    backlinksLabel.textContent = `Backlinks (${backlinks.length})`;
    body.appendChild(backlinksLabel);

    if (backlinks.length > 0) {
      const backlinksList = document.createElement('div');
      backlinksList.className = 'backlink-list';
      backlinksList.style.marginBottom = '1.2rem';
      backlinksList.style.display = 'flex';
      backlinksList.style.flexDirection = 'column';
      backlinksList.style.gap = '0.4rem';

      backlinks.forEach(note => {
        const chip = document.createElement('button');
        chip.className = 'backlink-chip';
        chip.title = t('editor.backlinkTooltip', { title: note.title || note.path });
        chip.innerHTML = `🔗 <strong>${escH(note.title)}</strong> <span style="font-size:0.7rem;color:var(--text-muted)">(${escH(note.date)})</span>`;
        chip.addEventListener('click', () => {
          openNestedNote(note.path);
        });
        backlinksList.appendChild(chip);
      });
      body.appendChild(backlinksList);
    } else {
      const p = document.createElement('p');
      p.style.cssText = 'color:var(--text-muted); font-size:0.8rem; margin:0 0 1.2rem 0;';
      p.textContent = typeof t === 'function' ? (t('editor.noBacklinks') || 'No backlinks.') : 'No backlinks.';
      body.appendChild(p);
    }

    // 2. Mentions (outgoing links)
    const ta = document.getElementById('edit-textarea');
    const textVal = ta ? (ta.contentEditable === 'true' ? ta.textContent : ta.value) : (currentNote.mainHTML || '');
    const outgoingMatches = [];
    const wikiLinkRegex = /\[\[([^\]]+)\]\]/g;
    let match;
    while ((match = wikiLinkRegex.exec(textVal)) !== null) {
      outgoingMatches.push(match[1].trim());
    }
    const curManifest = (typeof manifest !== 'undefined' && Array.isArray(manifest)) ? manifest : ((typeof window !== 'undefined' && Array.isArray(window.manifest)) ? window.manifest : []);
    if (ta && ta.querySelectorAll) {
      ta.querySelectorAll('.note-link, .wiki-link, a[data-note-path], a[data-note-id]').forEach(a => {
        const id = a.getAttribute('data-note-id');
        const path = a.getAttribute('data-note-path');
        const resolved = (id ? curManifest.find(n => n.id === id) : null) || (path ? curManifest.find(n => n.path === path) : null);
        const title = resolved?.title || a.textContent.replace(/^📝\s*/, '').trim();
        if (title) outgoingMatches.push(title);
      });
    }
    const uniqueOutgoing = Array.from(new Set(outgoingMatches));

    const mentionsLabel = document.createElement('div');
    mentionsLabel.className = 'overlay-backlinks-label';
    mentionsLabel.textContent = `Outgoing Mentions (${uniqueOutgoing.length})`;
    body.appendChild(mentionsLabel);

    if (uniqueOutgoing.length > 0) {
      const list = document.createElement('div');
      list.style.marginBottom = '1.2rem';
      list.style.display = 'flex';
      list.style.flexDirection = 'column';
      list.style.gap = '0.4rem';
      uniqueOutgoing.forEach(title => {
        const found = curManifest.find(n => (n.title || '').toLowerCase() === title.toLowerCase());
        const btn = document.createElement('button');
        btn.className = 'backlink-chip';
        if (found) {
          btn.innerHTML = `🔗 <strong>${escH(title)}</strong>`;
          btn.title = t('editor.outgoingMentionTooltip', { title });
          btn.addEventListener('click', () => {
            openNestedNote(found.path);
          });
        } else {
          btn.innerHTML = `⚠️ <strong style="color:var(--text-muted); text-decoration:dashed underline;">${escH(title)}</strong>`;
          btn.title = t('editor.createMentionTooltip', { title });
          btn.addEventListener('click', () => {
            if (typeof createNoteFromBacklink === 'function') {
              createNoteFromBacklink(title);
            }
          });
        }
        list.appendChild(btn);
      });
      body.appendChild(list);
    } else {
      const p = document.createElement('p');
      p.style.cssText = 'color:var(--text-muted); font-size:0.8rem; margin:0 0 1.2rem 0;';
      p.textContent = typeof t === 'function' ? (t('editor.noOutgoingMentions') || 'No outgoing mentions.') : 'No outgoing mentions.';
      body.appendChild(p);
    }

    // 2b. Unlinked Mentions
    let unlinkedMentions = [];
    try {
      if (typeof getUnlinkedMentionsForNote === 'function') {
        unlinkedMentions = await getUnlinkedMentionsForNote(currentNote);
      }
    } catch (e) {
      console.warn('Could not compute unlinked mentions', e);
    }

    const unlinkedLabel = document.createElement('div');
    unlinkedLabel.className = 'overlay-backlinks-label';
    unlinkedLabel.textContent = `${t('editor.unlinkedMentions') || 'Unlinked Mentions'} (${unlinkedMentions.length})`;
    body.appendChild(unlinkedLabel);

    if (unlinkedMentions.length > 0) {
      const uList = document.createElement('div');
      uList.style.marginBottom = '1.2rem';
      uList.style.display = 'flex';
      uList.style.flexDirection = 'column';
      uList.style.gap = '0.4rem';

      unlinkedMentions.forEach(({ note: mNote, snippet }) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:6px; background:var(--card-bg-alt); padding:4px 8px; border-radius:6px; border:1px solid var(--card-border);';
        
        const info = document.createElement('div');
        info.style.cssText = 'display:flex; flex-direction:column; overflow:hidden; font-size:0.75rem;';
        info.innerHTML = `
          <strong style="color:var(--text); cursor:pointer;" title="${escA(t('editor.openNoteTitleTooltip', { title: mNote.title }))}">${escH(mNote.title)}</strong>
          <span style="color:var(--text-muted); font-size:0.7rem; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${escH(snippet)}</span>
        `;
        info.querySelector('strong').addEventListener('click', () => openNestedNote(mNote.path));

        const linkifyBtn = document.createElement('button');
        linkifyBtn.className = 'btn btn-secondary btn-sm';
        linkifyBtn.style.cssText = 'padding:2px 6px; font-size:0.72rem; white-space:nowrap;';
        linkifyBtn.title = t('editor.linkifyTooltip') || 'Convert mention to a wikilink';
        linkifyBtn.innerHTML = `🔗 ${escH(t('editor.linkify') || 'Link')}`;
        linkifyBtn.addEventListener('click', async () => {
          try {
            let noteText = (htmlLRUCache.get(mNote.path)?.text) || (noteContentCache[mNote.path]?.text);
            if (!noteText && StorageAPI && StorageAPI.readNoteContent) {
              const raw = await StorageAPI.readNoteContent(mNote.path);
              noteText = typeof raw === 'string' ? raw : (raw?.text || '');
            }
            if (noteText && currentNote.title) {
              const escapeReg = str => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const parser = new DOMParser();
              const doc = parser.parseFromString(noteText, 'text/html');
              const mainEl = doc.querySelector('main') || doc.body;
              
              let modified = false;
              const textNodes = [];
              const walk = node => {
                if (node.nodeType === Node.TEXT_NODE) {
                  if (node.parentNode && !['SCRIPT', 'STYLE', 'A', 'CODE', 'PRE'].includes(node.parentNode.tagName)) {
                    textNodes.push(node);
                  }
                } else if (node.nodeType === Node.ELEMENT_NODE) {
                  Array.from(node.childNodes).forEach(walk);
                }
              };
              walk(mainEl);

              const regex = new RegExp(`(^|[^[\\w])(${escapeReg(currentNote.title)})(?=[^\\]\\w]|$)`, 'i');
              for (const tNode of textNodes) {
                if (regex.test(tNode.nodeValue)) {
                  tNode.nodeValue = tNode.nodeValue.replace(regex, `$1[[${currentNote.title}]]`);
                  modified = true;
                  break;
                }
              }

              if (modified) {
                const nextText = doc.documentElement.outerHTML;
                await StorageAPI.writeNoteContent(mNote.path, nextText);
                if (noteContentCache[mNote.path]) noteContentCache[mNote.path].text = nextText;
                toast(t('editor.mentionLinkified') || 'Mention linked successfully!');
                if (typeof rebuildNoteGraphIndex === 'function') await rebuildNoteGraphIndex();
                if (typeof renderInspectorPanel === 'function') renderInspectorPanel();
              }
            }
          } catch(err) {
            console.warn('Could not linkify mention', err);
          }
        });

        row.appendChild(info);
        row.appendChild(linkifyBtn);
        uList.appendChild(row);
      });
      body.appendChild(uList);
    }

    // 3. Connected meeting notes from the same recurring series
    let pastSeriesNotes = [];
    try {
      pastSeriesNotes = getPastSeriesNotesForNote(currentNote);
    } catch(e) {
      console.warn(e);
    }

    const seriesNotesLabel = document.createElement('div');
    seriesNotesLabel.className = 'overlay-backlinks-label';
    seriesNotesLabel.textContent = `Connected meeting notes (${pastSeriesNotes.length})`;
    body.appendChild(seriesNotesLabel);

    if (pastSeriesNotes.length > 0) {
      const seriesList = document.createElement('div');
      seriesList.className = 'backlink-list';
      seriesList.style.marginBottom = '1.2rem';
      seriesList.style.display = 'flex';
      seriesList.style.flexDirection = 'column';
      seriesList.style.gap = '0.4rem';

      pastSeriesNotes.forEach(note => {
        const chip = document.createElement('button');
        chip.className = 'backlink-chip';
        chip.title = typeof t === 'function' ? (t('editor.openSeriesNoteTooltip', { date: note.date }) || `Open meeting note from series for ${note.date}`) : `Open meeting note from series for ${note.date}`;
        chip.innerHTML = `📅 <strong>${escH(note.title)}</strong> <span style="font-size:0.7rem;color:var(--text-muted)">(${escH(note.date)})</span>`;
        chip.addEventListener('click', () => {
          openNestedNote(note.path);
        });
        seriesList.appendChild(chip);
      });
      body.appendChild(seriesList);
    } else {
      const p = document.createElement('p');
      p.style.cssText = 'color:var(--text-muted); font-size:0.8rem; margin:0 0 1.2rem 0;';
      p.textContent = typeof t === 'function' ? (t('editor.noConnectedMeetingNotes') || 'No connected meeting notes.') : 'No connected meeting notes.';
      body.appendChild(p);
    }

    // 4. Notes similaires (mêmes tags)
    let similarNotes = [];
    try {
      similarNotes = getNotesSharingTags(currentNote);
    } catch(e) {
      console.warn(e);
    }

    const similarNotesLabel = document.createElement('div');
    similarNotesLabel.className = 'overlay-backlinks-label';
    similarNotesLabel.textContent = typeof t === 'function' ? (t('editor.similarNotesTitle', { count: similarNotes.length }) || `Notes similaires (${similarNotes.length})`) : `Notes similaires (${similarNotes.length})`;
    body.appendChild(similarNotesLabel);

    if (similarNotes.length > 0) {
      const similarList = document.createElement('div');
      similarList.className = 'backlink-list';
      similarList.style.marginBottom = '1.2rem';
      similarList.style.display = 'flex';
      similarList.style.flexDirection = 'column';
      similarList.style.gap = '0.4rem';

      similarNotes.forEach(note => {
        const chip = document.createElement('button');
        chip.className = 'backlink-chip';
        chip.title = typeof t === 'function' ? (t('editor.openNoteTitleTooltip', { title: note.title }) || `Open note ${note.title}`) : `Open note ${note.title}`;
        chip.innerHTML = `🏷️ <strong>${escH(note.title)}</strong> <span style="font-size:0.7rem;color:var(--text-muted)">(${escH(note.date)})</span>`;
        chip.addEventListener('click', () => {
          openNestedNote(note.path);
        });
        similarList.appendChild(chip);
      });
      body.appendChild(similarList);
    } else {
      const p = document.createElement('p');
      p.style.cssText = 'color:var(--text-muted); font-size:0.8rem; margin:0;';
      p.textContent = typeof t === 'function' ? (t('editor.noSimilarNotes') || 'No similar notes.') : 'No similar notes.';
      body.appendChild(p);
    }

  } else if (activeInspectorTab === 'B') {
    // DÉCISIONS
    const activeMajor = (currentNote.major_topic_tags || [])[0];
    const decisionMetadataReady = (typeof isNoteDecisionMetadataReady === 'function')
      ? isNoteDecisionMetadataReady(currentNote)
      : false;
    const isDecisionMetadataLoading = !decisionMetadataReady && !!metadataHydrationProgress?.running;
    const noteDecisionSource = (decisionMetadataReady && typeof getMetadataDecisionEntriesForNote === 'function')
      ? getMetadataDecisionEntriesForNote(currentNote)
      : [];
    const majorDecisionSource = (decisionMetadataReady && typeof getMetadataDecisionEntriesForMajor === 'function')
      ? getMetadataDecisionEntriesForMajor(activeMajor)
      : [];

    const decisionSource = (() => {
      if (!(decisionMetadataReady && typeof getMetadataDecisionEntriesForNote === 'function')) {
        return isDecisionMetadataLoading ? [] : decisionsList;
      }
      const seen = new Set();
      const merged = [];
      for (const d of [...noteDecisionSource, ...majorDecisionSource]) {
        const key = `${d.status || 'active'}::${d.notePath || ''}::${d.text || ''}::${d.isLinked ? '1' : '0'}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(d);
      }
      return merged;
    })();

    // Search and link decisions button
    const linkBtn = document.createElement('button');
    linkBtn.className = 'btn btn-primary';
    linkBtn.style.cssText = 'width:100%; font-size:0.8rem; margin-bottom:1rem; padding:6px 12px; font-weight:600; display:flex; align-items:center; justify-content:center; gap:0.25rem;';
    linkBtn.innerHTML = `<span>${t('editor.linkDecision') || '🔗 Lier Décision'}</span>`;
    linkBtn.title = t('editor.linkDecisionTooltip');
    linkBtn.addEventListener('click', () => {
      window.toggleDecisionPicker();
    });
    body.appendChild(linkBtn);

    // Decision picker dropdown
    if (showDecisionPicker) {
      const pickerWrap = document.createElement('div');
      pickerWrap.className = 'decision-picker-dropdown';
      pickerWrap.style.cssText = 'border:1px solid var(--card-border); border-radius:6px; background:var(--card-bg-alt); padding:0.5rem; margin-bottom:1rem; box-shadow:var(--shadow-lg);';

      const searchInput = document.createElement('input');
      searchInput.type = 'text';
      searchInput.placeholder = t('editor.searchDecisionPlaceholder') || 'Search decisions...';
      searchInput.value = decisionPickerQuery;
      searchInput.style.cssText = 'width:100%; box-sizing:border-box; margin-bottom:0.5rem; padding:4px 8px; border:1px solid var(--card-border); border-radius:4px; font-family:inherit; font-size:0.85rem; background:var(--card-bg); color:var(--text);';
      searchInput.addEventListener('input', (e) => {
        window.updateDecisionPickerQuery(e.target.value);
      });
      pickerWrap.appendChild(searchInput);

      const explainer = document.createElement('div');
      explainer.style.cssText = 'font-size:0.7rem; color:var(--text-muted); line-height:1.3; margin-bottom:0.6rem; border-bottom: 1px dashed var(--card-border); padding-bottom:0.4rem;';
      explainer.textContent = t('editor.decisionHelpText') || 'Sélectionnez une décision. Remplacer marquera l\'ancienne décision comme inactive et liera la nouvelle. Référencer liera la décision sans modifier son statut.';
      pickerWrap.appendChild(explainer);

      const listContainer = document.createElement('div');
      listContainer.style.cssText = 'max-height: 200px; overflow-y: auto; display:flex; flex-direction:column; gap:0.4rem;';

      const query = decisionPickerQuery.toLowerCase().trim();
      let optionsList = decisionSource;
      if (decisionMetadataReady && typeof searchMetadataDecisionEntries === 'function') {
        optionsList = query
          ? searchMetadataDecisionEntries(query, { major: activeMajor })
          : (activeMajor ? getMetadataDecisionEntriesForMajor(activeMajor) : getAllMetadataDecisionEntries());
      } else if (query) {
        optionsList = decisionSource.filter(d => d.text.toLowerCase().includes(query) || d.noteTitle.toLowerCase().includes(query));
      }

      if (optionsList.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'font-size:0.8rem; color:var(--text-muted); text-align:center; padding:0.5rem;';
        empty.textContent = t('editor.noDecisionsFilter') || 'No decisions match filter.';
        listContainer.appendChild(empty);
      } else {
        optionsList.forEach(d => {
          const item = document.createElement('div');
          item.style.cssText = 'border-bottom:1px solid var(--card-border); padding:0.4rem 0; font-size:0.8rem;';
          
          const title = document.createElement('div');
          title.style.cssText = 'font-weight:500; color:var(--text); margin-bottom:0.25rem;';
          title.innerHTML = `${escH(d.text)} <span style="font-size:0.7rem; color:var(--text-muted)">(${escH(d.noteTitle)})</span>`;
          item.appendChild(title);

          const btnRow = document.createElement('div');
          btnRow.style.cssText = 'display:flex; gap:0.5rem;';

          const replaceBtn = document.createElement('button');
          replaceBtn.className = 'btn';
          replaceBtn.style.cssText = 'font-size:0.7rem; padding:2px 6px; background:#fee2e2; color:#b91c1c; border-color:#fca5a5;';
          replaceBtn.textContent = t('editor.replaceDecision') || 'Remplacer (Supersede)';
          replaceBtn.title = t('editor.replaceTooltip') || 'Marquer l\'ancienne décision comme remplacée et lier la nouvelle ici';
          replaceBtn.addEventListener('click', () => {
            window.linkDecisionAction(d.notePath, d.text, 'replace');
          });

          const refBtn = document.createElement('button');
          refBtn.className = 'btn';
          refBtn.style.cssText = 'font-size:0.7rem; padding:2px 6px; background:#eff6ff; color:#1d4ed8; border-color:#93c5fd;';
          refBtn.textContent = t('editor.referenceDecision') || 'Référencer';
          refBtn.title = t('editor.referenceTooltip') || 'Lier cette décision comme référence dans le texte sans modifier son statut';
          refBtn.addEventListener('click', () => {
            window.linkDecisionAction(d.notePath, d.text, 'reference');
          });

          btnRow.appendChild(replaceBtn);
          btnRow.appendChild(refBtn);
          item.appendChild(btnRow);
          listContainer.appendChild(item);
        });
      }
      pickerWrap.appendChild(listContainer);
      body.appendChild(pickerWrap);
    }


    // List existing decisions on this project (Major Topic) and current note/meeting
    const activeDecs = decisionSource.filter(d => {
      if (d.status !== 'active') return false;
      const isFromCurrentNote = (currentNote.id && d.noteId === currentNote.id) || (currentNote.path && d.notePath === currentNote.path);
      const hasSameMajor = (currentNote.major_topic_tags || []).some(major => 
        (d.major_topic_tags || []).map(x=>x.toLowerCase()).includes(major.toLowerCase())
      );
      return isFromCurrentNote || hasSameMajor;
    });

    const supersededDecs = decisionSource.filter(d => {
      if (d.status !== 'superseded') return false;
      const isFromCurrentNote = (currentNote.id && d.noteId === currentNote.id) || (currentNote.path && d.notePath === currentNote.path);
      const hasSameMajor = (currentNote.major_topic_tags || []).some(major => 
        (d.major_topic_tags || []).map(x=>x.toLowerCase()).includes(major.toLowerCase())
      );
      return isFromCurrentNote || hasSameMajor;
    });

    if (isDecisionMetadataLoading) {
      const loading = document.createElement('div');
      loading.style.cssText = 'color:var(--text-muted); font-size:0.8rem; margin:0 0 0.8rem 0; font-style:italic;';
      loading.innerHTML = `${escH(t('editor.loadingDecisions'))}<span class="opb-loading-dots" aria-hidden="true"></span>`;
      body.appendChild(loading);
    }

    const activeLabel = document.createElement('div');
    activeLabel.className = 'overlay-backlinks-label';
    activeLabel.textContent = `${t('editor.activeDecisions') || 'Décisions actives'} (${activeDecs.length})`;
    body.appendChild(activeLabel);

    if (activeDecs.length > 0) {
      const list = document.createElement('div');
      list.style.cssText = 'display:flex; flex-direction:column; gap:0.5rem; margin-bottom:1.5rem;';
      activeDecs.forEach(d => {
        const item = document.createElement('div');
        item.className = 'collab-item-card';
        item.style.cssText = 'padding: 0.6rem; gap: 0.25rem; font-size:0.85rem; display:flex; flex-direction:column;';
        
        const badgeRow = document.createElement('div');
        badgeRow.style.cssText = 'display:flex; align-items:center; gap:0.4rem;';
        badgeRow.innerHTML = `<span class="pill-decision pill-decision-active" style="margin:0; font-size: 0.72rem; padding: 1px 5px;">!decision:active</span> <strong style="color:var(--text);">${escH(d.text)}</strong>`;
        item.appendChild(badgeRow);

        const metaRow = document.createElement('div');
        metaRow.style.cssText = 'font-size:0.72rem; color:var(--text-muted);';
        metaRow.innerHTML = `Note: <a style="cursor:pointer; text-decoration:underline;" onclick="openNestedNote('${escA(d.notePath)}')" title="${escA(t('editor.openNoteTooltip'))}">${escH(d.noteTitle)}</a> (${escH(d.date)})`;
        item.appendChild(metaRow);

        list.appendChild(item);
      });
      body.appendChild(list);
    } else if (!isDecisionMetadataLoading) {
      const p = document.createElement('p');
      p.style.cssText = 'color:var(--text-muted); font-size:0.8rem; margin:0 0 1.5rem 0;';
      p.textContent = t('editor.noDecisions') || 'Aucune décision active.';
      body.appendChild(p);
    }

    const supersededLabel = document.createElement('div');
    supersededLabel.className = 'overlay-backlinks-label';
    supersededLabel.textContent = `${t('editor.supersededDecisions') || 'Décisions remplacées'} (${supersededDecs.length})`;
    body.appendChild(supersededLabel);

    if (supersededDecs.length > 0) {
      const list = document.createElement('div');
      list.style.cssText = 'display:flex; flex-direction:column; gap:0.5rem;';
      supersededDecs.forEach(d => {
        const item = document.createElement('div');
        item.className = 'collab-item-card';
        item.style.cssText = 'padding: 0.6rem; gap: 0.25rem; font-size:0.85rem; display:flex; flex-direction:column; opacity:0.7;';
        
        const badgeRow = document.createElement('div');
        badgeRow.style.cssText = 'display:flex; align-items:center; gap:0.4rem;';
        badgeRow.innerHTML = `<span class="pill-decision pill-decision-superseded" style="margin:0; font-size: 0.72rem; padding: 1px 5px; text-decoration:line-through;">!decision:superseded</span> <span style="color:var(--text-muted); text-decoration:line-through;">${escH(d.text)}</span>`;
        item.appendChild(badgeRow);

        const metaRow = document.createElement('div');
        metaRow.style.cssText = 'font-size:0.72rem; color:var(--text-muted);';
        metaRow.innerHTML = `Note: <a style="cursor:pointer; text-decoration:underline;" onclick="openNestedNote('${escA(d.notePath)}')" title="${escA(t('editor.openNoteTooltip'))}">${escH(d.noteTitle)}</a> (${escH(d.date)})`;
        item.appendChild(metaRow);

        list.appendChild(item);
      });
      body.appendChild(list);
    } else if (!isDecisionMetadataLoading) {
      const p = document.createElement('p');
      p.style.cssText = 'color:var(--text-muted); font-size:0.8rem; margin:0;';
      p.textContent = t('editor.noSupersededDecisions') || 'Aucune décision remplacée.';
      body.appendChild(p);
    }

  } else if (activeInspectorTab === 'C') {
    // TÂCHES ET PERSONNES (Workload)
    const linkTodoWrap = document.createElement('div');
    linkTodoWrap.style.marginBottom = '1.2rem';
    linkTodoWrap.style.display = 'flex';
    linkTodoWrap.style.justifyContent = 'stretch';

    const linkTodoBtn = document.createElement('button');
    linkTodoBtn.id = 'link-todo-inspector-btn';
    linkTodoBtn.className = 'btn link-note-btn link-todo-inspector-btn';
    linkTodoBtn.style.padding = '0.4rem 0.8rem';
    linkTodoBtn.style.fontSize = '0.78rem';
    linkTodoBtn.style.width = '100%';
    linkTodoBtn.style.display = 'flex';
    linkTodoBtn.style.alignItems = 'center';
    linkTodoBtn.style.justifyContent = 'center';
    linkTodoBtn.style.gap = '0.4rem';
    linkTodoBtn.title = t('editor.linkTodoInspectorTooltip') || 'Link an existing task to this note';
    linkTodoBtn.innerHTML = `🔗 <span>${escH(t('editor.linkTodoInspector') || 'Aufgabe verknüpfen...')}</span>`;
    linkTodoBtn.addEventListener('click', (e) => {
      showLinkTodoPicker(e);
    });
    linkTodoWrap.appendChild(linkTodoBtn);
    body.appendChild(linkTodoWrap);

    const linkedTodos = (todosManifest || [])
      .filter(todo => todo && todo.priority !== 'Done' && todo.noteId === currentNote?.id)
      .sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));

    const createDelegatePicker = (pickerId, currentOwner, onSelect) => {
      const picker = document.createElement('div');
      picker.id = pickerId;
      picker.className = 'todo-owner-picker inspector-delegate-picker';
      picker.style.width = '100%';
      let isHydrating = true;

      requestAnimationFrame(() => {
        if (typeof populateCollaboratorPicker === 'function') {
          populateCollaboratorPicker(pickerId, currentOwner || 'me', {
            allowEmpty: false,
            includeMe: true,
            createOnType: true,
            onChange: (nextOwnerId) => {
              if (isHydrating) return;
              onSelect(nextOwnerId || '');
            },
          });
        }
        isHydrating = false;
      });

      return picker;
    };

    const quickDelegationTitle = document.createElement('div');
    quickDelegationTitle.className = 'overlay-backlinks-label';
    quickDelegationTitle.textContent = t('editor.quickDelegation') || 'Quick Delegation';
    body.appendChild(quickDelegationTitle);

    const aiSuggestions = Array.isArray(window._lastLLMSuggestions) ? window._lastLLMSuggestions : [];
    const aiStates = Array.isArray(window._lastLLMProposalStates) ? window._lastLLMProposalStates : [];
    const aiTodoSuggestions = aiSuggestions
      .map((item, idx) => ({ item, idx, state: aiStates[idx] || 'pending' }))
      .filter(entry => entry.item?.action === 'create_todo' && entry.state !== 'rejected');

    const aiSectionLabel = document.createElement('div');
    aiSectionLabel.className = 'inspector-delegate-subtitle';
    aiSectionLabel.textContent = `AI proposals (${aiTodoSuggestions.length})`;
    body.appendChild(aiSectionLabel);

    if (aiTodoSuggestions.length === 0) {
      const emptyAi = document.createElement('div');
      emptyAi.className = 'inspector-delegate-empty';
      emptyAi.textContent = t('editor.noAiTodoProposals') || 'No AI todo proposal.';
      body.appendChild(emptyAi);
    } else {
      aiTodoSuggestions.forEach(({ item, idx, state }) => {
        const row = document.createElement('div');
        row.className = 'inspector-delegate-row';

        const left = document.createElement('div');
        left.className = 'inspector-delegate-main';
        const title = document.createElement('div');
        title.className = 'inspector-delegate-title';
        title.textContent = String(item?.properties?.title || t('common.untitled') || 'Untitled').trim();
        const meta = document.createElement('div');
        meta.className = 'inspector-delegate-meta';
        meta.textContent = `${item?.properties?.priority || 'Medium'} • ${state}`;
        left.appendChild(title);
        left.appendChild(meta);

        const pickerId = `inspector-ai-assignee-${idx}`;
        const picker = createDelegatePicker(pickerId, item?.properties?.assignee || '', (nextAssigneeId) => {
          if (typeof window.setAiSuggestionAssignee === 'function') {
            const assigneeLabel = (typeof getColleagueLabelById === 'function')
              ? getColleagueLabelById(nextAssigneeId || '', nextAssigneeId || '')
              : (nextAssigneeId || '');
            window.setAiSuggestionAssignee(idx, assigneeLabel || '');
            toast(t('editor.delegationUpdatedOnProposal'));
          }
        });

        row.appendChild(left);
        row.appendChild(picker);
        body.appendChild(row);
      });
    }

    const linkedSectionLabel = document.createElement('div');
    linkedSectionLabel.className = 'inspector-delegate-subtitle';
    linkedSectionLabel.textContent = `Linked todos (${linkedTodos.length})`;
    body.appendChild(linkedSectionLabel);

    if (linkedTodos.length === 0) {
      const emptyLinked = document.createElement('div');
      emptyLinked.className = 'inspector-delegate-empty';
      emptyLinked.textContent = t('editor.noLinkedTodos') || 'No active todo linked to this note.';
      body.appendChild(emptyLinked);
    } else {
      linkedTodos.forEach(todo => {
        const row = document.createElement('div');
        row.className = 'inspector-delegate-row';
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.gap = '0.5rem';

        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.style.cursor = 'pointer';
        chk.style.width = '16px';
        chk.style.height = '16px';
        chk.style.flexShrink = '0';
        chk.addEventListener('change', async () => {
          if (chk.checked) {
            changeTodoPriority(todo.id, 'Done');
            await saveTodosManifest();
            
            // Update editor visual span
            const ta = document.getElementById('edit-textarea');
            if (ta) {
              const isRich = ta.contentEditable === 'true';
              if (isRich) {
                const marker = ta.querySelector(`[data-todo-id="${todo.id}"]`);
                if (marker) {
                  marker.setAttribute('data-todo-priority', 'Done');
                  marker.removeAttribute('data-todo-status');
                  marker.classList.add('note-todo-done');
                  marker.classList.remove('note-todo-wip');
                }
              } else {
                ta.value = patchNoteSpanInText(ta.value, todo.id, {
                  setAttr: {
                    'data-todo-priority': 'Done',
                    'data-todo-original-priority': todo.originalPriority || todo.priority || '',
                    'data-todo-status': todo.status || ''
                  },
                  addClass: ['note-todo-done']
                });
              }
              ta.dispatchEvent(new Event('input', { bubbles: true }));
            }
            
            syncPreview();
            if (typeof renderBoard === 'function') renderBoard();
            await renderInspectorPanel();
            toast(t('common.todoMarkedDone'));
          }
        });
        row.appendChild(chk);

        const left = document.createElement('div');
        left.className = 'inspector-delegate-main';
        left.style.flexGrow = '1';
        const title = document.createElement('div');
        title.className = 'inspector-delegate-title';
        title.textContent = String(todo.title || '').trim() || (t('common.untitled') || 'Untitled');
        const meta = document.createElement('div');
        meta.className = 'inspector-delegate-meta';
        meta.textContent = `${todo.priority || 'Medium'} • #${todo.id}`;
        left.appendChild(title);
        left.appendChild(meta);

        const pickerId = `inspector-todo-assignee-${todo.id}`;
        const picker = createDelegatePicker(pickerId, todo.ownerId || todo.owner || 'me', async (nextOwnerId) => {
          const targetOwnerId = String(nextOwnerId || '').trim() || 'me';
          if ((todo.ownerId || todo.owner || 'me') === targetOwnerId) return;
          todo.ownerId = targetOwnerId;
          todo.owner = (typeof getColleagueLabelById === 'function')
            ? getColleagueLabelById(targetOwnerId, targetOwnerId)
            : targetOwnerId;
          todo.modified = new Date().toISOString().slice(0, 10);
          if (typeof saveTodosManifest === 'function') await saveTodosManifest();
          if (typeof renderBoard === 'function') renderBoard();
          toast(t('editor.todoDelegationSaved'));
        });

        row.appendChild(left);
        row.appendChild(picker);
        body.appendChild(row);
      });
    }

    const knownCollaborators = typeof getAllKnownCollaboratorNames === 'function'
      ? getAllKnownCollaboratorNames()
      : (typeof collaboratorsMap !== 'undefined' ? Object.keys(collaboratorsMap) : []);
    const knownByKey = new Map(
      knownCollaborators.map(name => [String(name || '').trim().toLowerCase(), name])
    );
    const resolveCollaboratorName = (name) => {
      const clean = String(name || '').trim();
      if (!clean || isUserCollaborator(clean)) return '';
      const lower = clean.toLowerCase();
      if (knownByKey.has(lower)) return knownByKey.get(lower);
      if (typeof getCollaboratorDisplayName === 'function') return getCollaboratorDisplayName(clean);
      return clean.charAt(0).toUpperCase() + clean.slice(1);
    };

    const noteCollaborators = new Set();
    const topics = currentNote.topic_tags || [];
    topics.forEach(tag => {
      const matched = resolveCollaboratorName(tag);
      if (matched) noteCollaborators.add(matched);
    });

    if (typeof plannerEvents !== 'undefined') {
      const attachedCallEvents = plannerEvents.filter(e =>
        e.noteId === currentNote.id && ((e.type || '').toLowerCase() === 'call' || (e.type || '').toLowerCase() === 'sync')
      );
      attachedCallEvents.forEach(evt => {
        if (evt.collaborators && Array.isArray(evt.collaborators)) {
          evt.collaborators.forEach(collab => {
            const matched = resolveCollaboratorName(collab);
            if (matched) noteCollaborators.add(matched);
          });
        }
      });
    }

    let foundCollaborators = noteCollaborators.size > 0;

    noteCollaborators.forEach(tag => {
      const colTitle = document.createElement('h4');
      colTitle.style.cssText = 'margin: 0.8rem 0 0.4rem 0; font-size:0.92rem; color:var(--accent); text-transform:capitalize;';
      colTitle.textContent = tag;
      body.appendChild(colTitle);

      const activeTasks = todosManifest.filter(t => 
        t.priority !== 'Done' && 
        t.owner && 
        t.owner.trim().toLowerCase() === tag.toLowerCase()
      );

      if (activeTasks.length === 0) {
        const p = document.createElement('p');
        p.style.cssText = 'color:var(--text-muted); font-size:0.8rem; margin: 0 0 1rem 0;';
        p.textContent = t('editor.noTasks') || 'Aucune tâche active.';
        body.appendChild(p);
      } else {
        const list = document.createElement('ul');
        list.style.cssText = 'list-style:none; padding:0; margin:0 0 1rem 0; display:flex; flex-direction:column; gap:0.4rem;';

        activeTasks.forEach(task => {
          const priorityBadgeClass = `sl-badge sl-badge-${task.priority.toLowerCase()}`;
          const item = document.createElement('li');
          item.className = 'collab-item-card';
          item.style.cssText = 'padding:0.5rem 0.75rem; cursor:pointer; display:flex; justify-content:space-between; align-items:center;';
          item.title = t('todo.editTodoTooltip');
          item.addEventListener('click', () => {
            openTodoOverlay(task.id);
          });

          const titleSpan = document.createElement('span');
          titleSpan.style.cssText = 'font-size:0.85rem; font-weight:500;';
          titleSpan.textContent = task.title;

          const badgeSpan = document.createElement('span');
          badgeSpan.className = priorityBadgeClass;
          badgeSpan.style.cssText = 'font-size:0.7rem; padding:1px 5px; border-radius:3px;';
          badgeSpan.textContent = task.priority;

          item.appendChild(titleSpan);
          item.appendChild(badgeSpan);
          list.appendChild(item);
        });
        body.appendChild(list);
      }
    });

    if (!foundCollaborators) {
      const p = document.createElement('p');
      p.style.cssText = 'color:var(--text-muted); font-size:0.85rem; padding: 0.5rem; text-align:center; margin-bottom: 0.5rem;';
      p.textContent = t('editor.notOneToOne') || 'Non identifié comme un 1-à-1.';
      body.appendChild(p);

      const known = knownCollaborators.filter(name => !isUserCollaborator(name)).sort();

      if (known.length > 0) {
        const convertDiv = document.createElement('div');
        convertDiv.style.cssText = 'margin-top: 1rem; border-top: 1px solid var(--card-border); padding-top: 0.8rem;';
        
        const label = document.createElement('span');
        label.style.cssText = 'font-size: 0.68rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); display: block; margin-bottom: 0.5rem;';
        label.textContent = t('editor.defineAsSyncWith') || 'Définir comme Sync Call avec :';
        convertDiv.appendChild(label);

        const btnGrid = document.createElement('div');
        btnGrid.style.cssText = 'display:flex; flex-wrap:wrap; gap:0.4rem;';

        known.forEach(name => {
          const btn = document.createElement('button');
          btn.className = 'btn';
          btn.style.cssText = 'font-size: 0.72rem; padding: 4px 8px; display: flex; align-items: center; gap: 4px; cursor: pointer;';
          const color = colorForGroup(name);
          btn.innerHTML = `<span style="background:${color.bg}; color:${color.text}; width:16px; height:16px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-weight:700; font-size:0.55rem;">${name.slice(0, 2).toUpperCase()}</span> ${name}`;
          btn.title = t('editor.defineAsSyncWithTooltip', { name });
          btn.addEventListener('click', () => {
            window.convertToSyncCall(name);
          });
          btnGrid.appendChild(btn);
        });

        convertDiv.appendChild(btnGrid);
        body.appendChild(convertDiv);
      }
    }

  }

  // Lazy load card previews for the newly created cards
  if (typeof initCardPreviews === 'function') {
    initCardPreviews();
  }
}

function _dismissDecisionPicker(e) {
  const pickerEl = document.querySelector('.decision-picker-dropdown');
  if (!pickerEl) {
    document.removeEventListener('click', _dismissDecisionPicker);
    return;
  }
  const linkBtn = e.target.closest('button');
  const isLinkBtn = linkBtn && (linkBtn.title === t('editor.linkDecisionTooltip') || linkBtn.textContent.includes('Lier Décision'));
  if (!pickerEl.contains(e.target) && !isLinkBtn) {
    showDecisionPicker = false;
    decisionPickerQuery = '';
    document.removeEventListener('click', _dismissDecisionPicker);
    renderInspectorPanel();
  }
}

window.switchInspectorTab = function(tab) {
  activeInspectorTab = tab;
  showDecisionPicker = false;
  decisionPickerQuery = '';
  document.removeEventListener('click', _dismissDecisionPicker);
  closeLinkNotePicker();
  renderInspectorPanel();
};

window.toggleDecisionPicker = function() {
  showDecisionPicker = !showDecisionPicker;
  if (showDecisionPicker) {
    setTimeout(() => document.addEventListener('click', _dismissDecisionPicker), 0);
  } else {
    document.removeEventListener('click', _dismissDecisionPicker);
  }
  renderInspectorPanel();
};

window.updateDecisionPickerQuery = function(q) {
  decisionPickerQuery = q;
  renderInspectorPanel();
};
window.linkDecisionAction = async function(notePath, decisionText, actionType) {
  const ta = document.getElementById('edit-textarea');
  if (!ta) return;
  
  if (actionType === 'replace') {
    await updateDecisionStatusInFile(notePath, decisionText, 'superseded');
    const template = t('editor.supersedesText') || '(remplace: "{value}")';
    const insertText = `!decision:active "${decisionText}" ${template.replace('{value}', decisionText)}`;
    insertAtCursor(ta, insertText);
  } else if (actionType === 'reference') {
    const template = t('editor.referencesText') || '(référence: "{value}")';
    const insertText = `!decision:active "${decisionText}" ${template.replace('{value}', decisionText)}`;
    insertAtCursor(ta, insertText);
  }
  
  showDecisionPicker = false;
  decisionPickerQuery = '';
  
  syncPreview();
  scheduleAutoSave();
  await renderInspectorPanel();
};

window.convertToSyncCall = async function(collaboratorName) {
  if (!currentNote) return;

  // 1. Pre-populate group tags in editor UI with 'Sync'
  const currentGroups = readTagEditor('editor-group') || [];
  if (!currentGroups.includes('Sync')) {
    currentGroups.push('Sync');
  }
  populateTagEditor('editor-group', currentGroups, 'group');

  // 2. Pre-populate topic tags in editor UI with collaboratorName
  const currentTopics = readTagEditor('editor-topic') || [];
  const cleanName = collaboratorName.trim().charAt(0).toUpperCase() + collaboratorName.trim().slice(1);
  if (!currentTopics.includes(cleanName)) {
    currentTopics.push(cleanName);
  }
  populateTagEditor('editor-topic', currentTopics, 'topic');

  // 3. Save the note
  await saveCurrentNote();

  // Link newly created/converted sync note to the collaborator's next scheduled sync planner event
  if (typeof plannerEvents !== 'undefined' && Array.isArray(plannerEvents)) {
    const key = cleanName.trim().toLowerCase();
    const unsyncedSyncEv = plannerEvents.find(ev => {
      if ((ev.type || '').toLowerCase() !== 'sync') return false;
      if (ev.noteId) return false;
      const names = typeof extractPlannerCollaborators === 'function' ? extractPlannerCollaborators(ev) : [ev.title];
      return names.some(n => n.trim().toLowerCase() === key);
    });

    if (unsyncedSyncEv) {
      unsyncedSyncEv.noteId = currentNote.id;
      if (typeof normalizePlannerLinkedNoteIds === 'function') {
        unsyncedSyncEv.linkedNoteIds = normalizePlannerLinkedNoteIds([currentNote.id, ...(unsyncedSyncEv.linkedNoteIds || [])], currentNote.id);
      }
      if (typeof savePlanner === 'function') {
        await savePlanner();
      }
      if (typeof renderPlanner === 'function') {
        renderPlanner();
      }
    }
  }

  // 4. Update view metadata elements just in case we are in view mode
  const isViewMode = document.querySelector('.overlay-panel')?.classList.contains('overlay-view-mode');
  if (isViewMode) {
    setOverlayViewMode(true);
  }

  // 5. Re-render the inspector panel
  await renderInspectorPanel();
};


async function updateDecisionStatusInFile(notePath, decisionText, newStatus) {
  try {
    const originalHTML = await StorageAPI.readNoteContent(notePath);
    const parsed = parseNoteHTML(originalHTML);
    // Update the decision status attribute directly in the DOM
    const doc2 = new DOMParser().parseFromString(originalHTML, 'text/html');
    let modified = false;
    doc2.querySelectorAll('.note-decision-wrapper').forEach(el => {
      const textEl = el.querySelector('.note-decision-text');
      const text = (textEl ? textEl.textContent : (el.getAttribute('data-decision-text') || el.textContent || '')).trim();
      if (text === decisionText) {
        el.setAttribute('data-decision-status', newStatus);
        const badge = el.querySelector('.pill-decision');
        if (badge) {
          badge.className = `pill-decision pill-decision-${newStatus}`;
          badge.textContent = `!decision:${newStatus}`;
        }
        modified = true;
      }
    });
    if (modified) {
      const newMainHTML = doc2.querySelector('main')?.innerHTML || parsed.mainHTML || '';
      const changes = {
        title: parsed.title,
        date: parsed.date || '',
        group_tags: parsed.group_tags || [],
        major_topic_tags: parsed.major_topic_tags || [],
        topic_tags: parsed.topic_tags || [],
        extra_tags: parsed.extra_tags || [],
        mainHTML: newMainHTML
      };
      const updatedHTML = applyNoteEdits(originalHTML, changes);
      await StorageAPI.writeNoteContent(notePath, updatedHTML);
      
      const meta = manifest.find(m => m.path === notePath);
      if (meta) {
        meta.modified = new Date().toISOString();
      }
      
      if (typeof collaborativeDataCache !== 'undefined' && collaborativeDataCache[notePath]) {
        const entry = parseNoteContentForCollab(updatedHTML, notePath);
        collaborativeDataCache[notePath] = entry;
        rebuildCollaborativeAggregates();
      }
      if (typeof broadcastSync === 'function') {
        broadcastSync({ type: 'NOTE_SAVED', noteId: meta?.id || '', path: notePath, modified: new Date().toISOString() });
        broadcastSync({ type: 'DECISIONS_UPDATED' });
      }
    }
  } catch (e) {
    console.error('Failed to update decision status in file:', notePath, e);
  }
}

// Persist edits to a note-backed decision (matched by its original text) into the note file:
// status, authority, impact, per-decision major topics (data-decision-major), rationale, and optionally a new text.
window.updateDecisionInFile = async function(notePath, matchText, fields = {}) {
  const target = String(matchText || '').trim();
  if (!notePath || !target) return false;
  try {
    const originalHTML = await StorageAPI.readNoteContent(notePath);
    const parsed = parseNoteHTML(originalHTML);
    const doc2 = new DOMParser().parseFromString(originalHTML, 'text/html');
    let modified = false;
    doc2.querySelectorAll('.note-decision-wrapper').forEach(el => {
      const textEl = el.querySelector('.note-decision-text');
      const text = (textEl ? textEl.textContent : (el.getAttribute('data-decision-text') || el.textContent || '')).trim();
      if (text !== target) return;

      if (typeof fields.status === 'string') {
        el.setAttribute('data-decision-status', fields.status);
        const badge = el.querySelector('.pill-decision');
        if (badge) {
          badge.className = `pill-decision pill-decision-${fields.status}`;
          badge.textContent = `!decision:${fields.status}`;
        }
      }
      if (typeof fields.authority === 'string') {
        if (fields.authority) el.setAttribute('data-decision-authority', fields.authority);
        else el.removeAttribute('data-decision-authority');
      }
      if (typeof fields.impact === 'string') {
        if (fields.impact) el.setAttribute('data-decision-impact', fields.impact);
        else el.removeAttribute('data-decision-impact');
      }
      if (Array.isArray(fields.major)) {
        if (fields.major.length) el.setAttribute('data-decision-major', encodeTagListToStorage(fields.major));
        else el.removeAttribute('data-decision-major');
      }
      if (typeof fields.rationale === 'string') {
        if (fields.rationale) el.setAttribute('data-decision-context', fields.rationale);
        else el.removeAttribute('data-decision-context');
      }
      if (typeof fields.newText === 'string' && fields.newText.trim() && fields.newText.trim() !== target) {
        const nt = fields.newText.trim();
        el.setAttribute('data-decision-text', nt);
        if (textEl) textEl.textContent = nt;
      }
      modified = true;
    });
    if (!modified) return false;

    const newMainHTML = doc2.querySelector('main')?.innerHTML || parsed.mainHTML || '';
    const changes = {
      title: parsed.title,
      date: parsed.date || '',
      group_tags: parsed.group_tags || [],
      major_topic_tags: parsed.major_topic_tags || [],
      topic_tags: parsed.topic_tags || [],
      extra_tags: parsed.extra_tags || [],
      mainHTML: newMainHTML
    };
    const updatedHTML = applyNoteEdits(originalHTML, changes);
    await StorageAPI.writeNoteContent(notePath, updatedHTML);

    const meta = (typeof getMetaByPath === 'function') ? getMetaByPath(notePath) : null;
    if (meta && typeof extractDecisionsFromHTML === 'function' && typeof upsertMeta === 'function') {
      const decisions = extractDecisionsFromHTML(newMainHTML);
      upsertMeta({ ...meta, decisions, decisionsReady: true, modified: new Date().toISOString() });
    }
    if (typeof collaborativeDataCache !== 'undefined' && collaborativeDataCache[notePath] && typeof parseNoteContentForCollab === 'function') {
      collaborativeDataCache[notePath] = parseNoteContentForCollab(updatedHTML, notePath);
      if (typeof rebuildCollaborativeAggregates === 'function') rebuildCollaborativeAggregates();
    }
    if (typeof broadcastSync === 'function') {
      broadcastSync({ type: 'NOTE_SAVED', noteId: meta?.id || '', path: notePath, modified: new Date().toISOString() });
      broadcastSync({ type: 'DECISIONS_UPDATED' });
    }
    return true;
  } catch (e) {
    console.error('Failed to update decision in file:', notePath, e);
    return false;
  }
};

// Nested Note Overlay Slide-over (related notes)
let currentNestedNotePath = null;

async function openNestedNote(path) {
  const overlay = document.getElementById('nested-note-overlay');
  const titleEl = document.getElementById('nested-note-title');
  const bodyEl  = document.getElementById('nested-note-body');
  if (!overlay || !titleEl || !bodyEl) return;

  currentNestedNotePath = path;
  titleEl.textContent = t('common.loading') || 'Loading…';
  bodyEl.innerHTML = '';
  overlay.style.display = 'flex';
  overlay.classList.add('active');

  try {
    const html = await StorageAPI.readNoteContent(path);
    const parsed = parseNoteHTML(html);
    
    // Resolve any pasted images/tokens
    let finalHTML = parsed.mainHTML || '';
    if (parsed.images) {
      Object.keys(parsed.images).forEach(tok => {
        finalHTML = finalHTML.replaceAll(tok, parsed.images[tok]);
      });
    }
    finalHTML = await resolveNoteImages(finalHTML);

    titleEl.textContent = parsed.title || path.split('/').pop();
    bodyEl.innerHTML = `
      <div class="nested-note-meta-row" style="margin-bottom: 1rem; display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center;">
        ${parsed.date ? `<span class="nested-meta-item" style="font-size: 0.8rem; color: var(--text-muted);">📅 ${escH(parsed.date)}</span>` : ''}
        ${[...(parsed.group_tags||[]), ...(parsed.major_topic_tags||[]), ...(parsed.topic_tags||[])].map(t => {
          const tc = colorForGroup(t);
          return `<span class="tag" style="background:${tc.bg};color:${tc.text};font-size: 0.75rem;padding: 2px 6px;border-radius: 4px;">${escH(t)}</span>`;
        }).join(' ')}
      </div>
      <div class="md-preview edit-preview-content">
        ${finalHTML}
      </div>
    `;
    
    if (typeof renderLatexInElement === 'function') renderLatexInElement(bodyEl);
    bodyEl.scrollTop = 0;
  } catch (e) {
    titleEl.textContent = t('common.couldNotLoadNote') || 'Error';
    bodyEl.innerHTML = `<div style="color:red;padding:1rem;">${escH(e.message)}</div>`;
  }
}

function closeNestedNoteOverlay() {
  const overlay = document.getElementById('nested-note-overlay');
  if (overlay) {
    overlay.style.display = 'none';
    overlay.classList.remove('active');
  }
  currentNestedNotePath = null;
}

function popoutNestedNoteToWindow() {
  if (!currentNestedNotePath) return;
  if (editMode && typeof saveCurrentNote === 'function') {
    saveCurrentNote(true);
  }
  const path = currentNestedNotePath;
  const note = (manifest || []).find(n => n.path === path);
  const noteId = note ? note.id : null;
  if (window.AppBridge?.noteWindow) {
    window.AppBridge.noteWindow.open(noteId, path);
    closeNestedNoteOverlay();
  }
}
window.popoutNestedNoteToWindow = popoutNestedNoteToWindow;

// Helpers for normalized raw todo tags in textarea
function normalizeRawTodoTagsInText(text) {
  return text.replace(/\{todo:(high|medium|med|low|wip)\|([^\}]+)\}/gi, (match, priority, contentText) => {
    let pr = priority.charAt(0).toUpperCase() + priority.slice(1).toLowerCase();
    if (pr === 'Med') pr = 'Medium';
    let status = '';
    if (pr === 'Wip') {
      pr = 'Medium';
      status = 'WIP';
    }
    const id = generateTodoId();
    return `{todo:${pr}:${id}${status ? `:${status}` : ''}|${contentText}}`;
  });
}

function normalizeRawTodoTagsInTextAndAdjustCursor(ta) {
  if (!ta) return;
  const val = ta.value;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  
  let newVal = '';
  let lastIdx = 0;
  let cursorShiftStart = 0;
  let cursorShiftEnd = 0;
  
  const regex = /\{todo:(high|medium|med|low|wip)\|([^\}]+)\}/gi;
  let match;
  
  while ((match = regex.exec(val)) !== null) {
    const matchIdx = match.index;
    const matchLen = match[0].length;
    
    let pr = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
    if (pr === 'Med') pr = 'Medium';
    let status = '';
    if (pr === 'Wip') {
      pr = 'Medium';
      status = 'WIP';
    }
    const id = generateTodoId();
    const replacement = `{todo:${pr}:${id}${status ? `:${status}` : ''}|${match[2]}}`;
    
    newVal += val.substring(lastIdx, matchIdx) + replacement;
    
    const diff = replacement.length - matchLen;
    if (matchIdx < start) {
      cursorShiftStart += diff;
    }
    if (matchIdx < end) {
      cursorShiftEnd += diff;
    }
    
    lastIdx = matchIdx + matchLen;
  }
  
  if (lastIdx === 0) return; // No matches found
  
  newVal += val.substring(lastIdx);
  ta.value = newVal;
  ta.selectionStart = start + cursorShiftStart;
  ta.selectionEnd = end + cursorShiftEnd;
}

async function processDoneCommandsInText(text, taElement = null) {
  if (!text) return;
  const regex = /!done\s*(?:@([a-zA-ZÀ-ÿ0-9_-]+)\s*)?"([^"]+)"/gi;
  let match;
  let modifiedManifest = false;
  
  while ((match = regex.exec(text)) !== null) {
    const employee = match[1];
    const taskTitle = match[2].trim().toLowerCase();
    
    // Find the todo in todosManifest
    const matchedTodo = todosManifest.find(todo => {
      if (todo.priority === 'Done') return false; // already done
      const titleMatch = (todo.title || '').trim().toLowerCase() === taskTitle;
      if (!titleMatch) return false;
      
      if (employee) {
        return isSameCollaborator(todo.owner, employee);
      }
      return isUserTask(todo);
    });
    
    if (matchedTodo) {
      const prevPriority = matchedTodo.priority;
      const prevStatus = matchedTodo.status || '';
      changeTodoPriority(matchedTodo.id, 'Done');
      const updatedTodo = getTodoById(matchedTodo.id) || matchedTodo;
      
      // Update linked note if applicable
      await updateTodoLinkedNote(updatedTodo, updatedTodo.title, 'Done', updatedTodo.originalPriority || prevPriority || '', prevStatus);
      
      // If we have a textarea, update its content directly
      if (taElement) {
        const cursorStart = taElement.selectionStart;
        const cursorEnd = taElement.selectionEnd;
        taElement.value = patchNoteSpanInText(taElement.value, matchedTodo.noteTodoMarkerId || matchedTodo.id, {
          setAttr: {
            'data-todo-priority': 'Done',
            'data-todo-original-priority': updatedTodo.originalPriority || prevPriority || '',
            'data-todo-status': prevStatus
          }
        });
        taElement.selectionStart = cursorStart;
        taElement.selectionEnd = cursorEnd;
      }
      modifiedManifest = true;
    }
  }
  
  if (modifiedManifest) {
    await saveTodosManifest();
    if (typeof refreshTodoViews === 'function') refreshTodoViews();
  }
}

// ─── Interactive Decisions Modal & Status Editing ───
let activeDecisionElement = null;

window.handleDecisionClick = function(element, event) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }
  if (!element) return;

  // Suppress opening global decision modal if clicked inside Perfect Note (Refactor) modal
  if (element.closest('#modal-refactor-proposals, .refactor-proposals-modal')) {
    return;
  }

  activeDecisionElement = element;

  const status = element.getAttribute('data-decision-status') || 'active';
  const textSpan = element.querySelector('.note-decision-text');
  let text = element.getAttribute('data-decision-text') || (textSpan ? textSpan.textContent.trim() : element.textContent.trim());
  text = String(text || '').replace(/^!decision:\w+\s*/i, '').trim();

  // Major topics: use the decision's own if set, else default to the note's major topics.
  let majors = decodeTagListFromStorage(element.getAttribute('data-decision-major') || '');
  if (!majors.length && typeof readTagEditor === 'function' && document.getElementById('editor-major')) {
    majors = readTagEditor('editor-major');
  }

  const normText = text.toLowerCase();
  const existsInRegistry = (typeof decisionsList !== 'undefined' && Array.isArray(decisionsList) && decisionsList.some(d => (d.text || '').trim().toLowerCase() === normText)) ||
                           (typeof pendingDecisionsList !== 'undefined' && Array.isArray(pendingDecisionsList) && pendingDecisionsList.some(d => (d.text || '').trim().toLowerCase() === normText)) ||
                           (typeof getAllMetadataDecisionEntries === 'function' && getAllMetadataDecisionEntries().some(d => (d.text || '').trim().toLowerCase() === normText));

  const dec = {
    id: text,
    text,
    status,
    authority: element.getAttribute('data-decision-authority') || 'team',
    impact: element.getAttribute('data-decision-impact') || 'high',
    major_topic_tags: majors,
    rationale: element.getAttribute('data-decision-context') || '',
    isNoteDecision: true,
    isNew: !existsInRegistry
  };

  if (typeof openEditDecisionModal === 'function') {
    openEditDecisionModal(dec, { element, mode: 'note' });
  }
};

// Write the good decision modal's values back onto an inline note-decision span, then persist through
// the editor's autosave (the cleanNode serializer preserves all data-decision-* attributes on save).
window.saveDecisionModalToNote = function(element, v) {
  if (!element) return;
  const status = v.status || 'active';

  element.setAttribute('data-decision-status', status);
  element.setAttribute('data-decision-text', v.text || '');
  if (v.authority) element.setAttribute('data-decision-authority', v.authority);
  else element.removeAttribute('data-decision-authority');
  if (v.impact) element.setAttribute('data-decision-impact', v.impact);
  else element.removeAttribute('data-decision-impact');
  if (Array.isArray(v.major_topic_tags) && v.major_topic_tags.length) {
    element.setAttribute('data-decision-major', encodeTagListToStorage(v.major_topic_tags));
  } else {
    element.removeAttribute('data-decision-major');
  }
  if (v.rationale) element.setAttribute('data-decision-context', v.rationale);
  else element.removeAttribute('data-decision-context');

  const textSpan = element.querySelector('.note-decision-text');
  if (textSpan) textSpan.textContent = v.text || '';

  const badge = element.querySelector('.pill-decision');
  if (badge) {
    badge.className = `pill-decision pill-decision-${status}`;
    badge.textContent = `!decision:${status}`;
  }

  const editTa = document.getElementById('edit-textarea');
  if (editTa) {
    editTa.dispatchEvent(new Event('input', { bubbles: true }));
    if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
  }
  const cardEl = element?.closest('[data-note-path]');
  const targetPath = cardEl?.getAttribute('data-note-path') || (typeof currentNote !== 'undefined' ? currentNote?.path : null);
  if (targetPath && typeof notifyDailyReviewNoteChanged === 'function') {
    notifyDailyReviewNoteChanged(targetPath, { decisionText: v.text });
  }
  toast(t('common.noteSaved') || 'Saved ✓');
};

// Remove a decision (matched by text) from a note. If the note is currently open in the editor, edit
// the live DOM and let autosave persist; otherwise rewrite the note file directly and refresh metadata.
window.removeDecisionFromNoteFile = async function(notePath, decisionText) {
  const target = String(decisionText || '').trim();
  if (!notePath || !target) return;
  if (typeof notifyDailyReviewNoteChanged === 'function') {
    notifyDailyReviewNoteChanged(notePath, { decisionText });
  }

  const matchesText = (el) => {
    const textEl = el.querySelector('.note-decision-text');
    const text = (textEl ? textEl.textContent : (el.getAttribute('data-decision-text') || el.textContent || '')).trim();
    return text === target;
  };

  // Currently-open note: mutate live DOM + autosave to avoid racing a direct file write.
  if (typeof currentNote !== 'undefined' && currentNote && currentNote.path === notePath) {
    let removed = false;
    document.querySelectorAll('.note-decision-wrapper').forEach(el => {
      if (matchesText(el)) { el.remove(); removed = true; }
    });
    if (removed) {
      const editTa = document.getElementById('edit-textarea');
      if (editTa) {
        editTa.dispatchEvent(new Event('input', { bubbles: true }));
        if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
      }
      toast(t('common.noteSaved') || 'Saved ✓');
    }
    return;
  }

  try {
    const originalHTML = await StorageAPI.readNoteContent(notePath);
    const parsed = parseNoteHTML(originalHTML);
    const doc2 = new DOMParser().parseFromString(originalHTML, 'text/html');
    let modified = false;
    doc2.querySelectorAll('.note-decision-wrapper').forEach(el => {
      if (matchesText(el)) { el.remove(); modified = true; }
    });
    if (!modified) return;

    const newMainHTML = doc2.querySelector('main')?.innerHTML || parsed.mainHTML || '';
    const changes = {
      title: parsed.title,
      date: parsed.date || '',
      group_tags: parsed.group_tags || [],
      major_topic_tags: parsed.major_topic_tags || [],
      topic_tags: parsed.topic_tags || [],
      extra_tags: parsed.extra_tags || [],
      mainHTML: newMainHTML
    };
    const updatedHTML = applyNoteEdits(originalHTML, changes);
    await StorageAPI.writeNoteContent(notePath, updatedHTML);

    // Refresh metadata decisions for this note so the registry reflects the removal.
    const meta = (typeof getMetaByPath === 'function') ? getMetaByPath(notePath) : null;
    if (meta && typeof extractDecisionsFromHTML === 'function' && typeof upsertMeta === 'function') {
      const decisions = extractDecisionsFromHTML(newMainHTML);
      upsertMeta({ ...meta, decisions, decisionsReady: true, modified: new Date().toISOString() });
    }
    if (typeof collaborativeDataCache !== 'undefined' && collaborativeDataCache[notePath] && typeof parseNoteContentForCollab === 'function') {
      collaborativeDataCache[notePath] = parseNoteContentForCollab(updatedHTML, notePath);
      if (typeof rebuildCollaborativeAggregates === 'function') rebuildCollaborativeAggregates();
    }
    toast(t('common.noteSaved') || 'Saved ✓');
  } catch (e) {
    console.error('Failed to remove decision from note:', notePath, e);
  }
};

window.closeDecisionPopover = function() {
  const popover = document.getElementById('decision-action-popover');
  if (popover) {
    popover.style.display = 'none';
  }
  if (window.PopoverManager) {
    window.PopoverManager.unregister('decision-action-popover');
  }
  activeDecisionElement = null;
};

window.saveDecisionFromPopover = async function() {
  if (!activeDecisionElement) return;

  const newStatus = document.getElementById('decision-popover-status')?.value || 'active';
  const newText = document.getElementById('decision-popover-text')?.value.trim() || '';
  const newOwner = document.getElementById('decision-popover-owner')?.value.trim() || '';
  const newReporter = document.getElementById('decision-popover-reporter')?.value.trim() || '';
  const newTopic = document.getElementById('decision-popover-topic')?.value.trim() || '';
  const newContext = document.getElementById('decision-popover-context')?.value.trim() || '';

  if (!newText) {
    toast(t('editor.decisionTextEmpty') || 'Le texte de la décision ne peut pas être vide.', true);
    return;
  }

  activeDecisionElement.setAttribute('data-decision-status', newStatus);
  activeDecisionElement.setAttribute('data-decision-text', newText);
  if (newOwner) activeDecisionElement.setAttribute('data-decision-owner', newOwner);
  else activeDecisionElement.removeAttribute('data-decision-owner');
  if (newReporter) activeDecisionElement.setAttribute('data-decision-reporter', newReporter);
  else activeDecisionElement.removeAttribute('data-decision-reporter');
  if (newTopic) activeDecisionElement.setAttribute('data-decision-topic', newTopic);
  else activeDecisionElement.removeAttribute('data-decision-topic');
  if (newContext) activeDecisionElement.setAttribute('data-decision-context', newContext);
  else activeDecisionElement.removeAttribute('data-decision-context');

  const textSpan = activeDecisionElement.querySelector('.note-decision-text');
  if (textSpan) textSpan.textContent = newText;

  const badge = activeDecisionElement.querySelector('.pill-decision');
  if (badge) {
    badge.className = `pill-decision pill-decision-${newStatus}`;
    badge.textContent = `!decision:${newStatus}`;
  }

  const editTa = document.getElementById('edit-textarea');
  if (editTa) {
    editTa.dispatchEvent(new Event('input', { bubbles: true }));
    if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
  }

  const cardEl = activeDecisionElement?.closest('[data-note-path]');
  const targetPath = cardEl?.getAttribute('data-note-path') || (typeof currentNote !== 'undefined' ? currentNote?.path : null);
  if (targetPath && typeof notifyDailyReviewNoteChanged === 'function') {
    notifyDailyReviewNoteChanged(targetPath, { decisionText: newText });
  }

  toast(t('common.noteSaved') || 'Saved ✓');
  closeDecisionPopover();
};

window.deleteDecisionFromNote = async function() {
  if (!activeDecisionElement) return;
  
  const oldText = activeDecisionElement.getAttribute('data-decision-text');
  
  const editTa = document.getElementById('edit-textarea');
  const nnTa = document.getElementById('nn-content');
  let ta = null;
  if (editTa && editTa.offsetParent !== null) {
    ta = editTa;
  } else if (nnTa && nnTa.offsetParent !== null) {
    ta = nnTa;
  } else {
    ta = editTa || nnTa;
  }
  
  if (!ta) {
    closeDecisionPopover();
    return;
  }
  
  const lines = ta.value.split('\n');
  const oldTextEsc = escapeRegex(oldText);
  const lineRegex = new RegExp('!decision(?::(?:active|superseded))?\\s*(?:"' + oldTextEsc + '"|' + oldTextEsc + ')', 'i');
  const index = lines.findIndex(line => lineRegex.test(line));
  
  if (index !== -1) {
    lines.splice(index, 1);
    ta.value = lines.join('\n');
    ta.dispatchEvent(new Event('input'));
    
    if (ta.id === 'nn-content') {
      const previewEl = document.getElementById('nn-preview');
      if (previewEl && previewEl.style.display !== 'none') {
        previewEl.innerHTML = ta.value ? mdToPreviewHTML(ta.value) : `<em style="color:#aaa">${escH(t('common.nothingToPreviewYet'))}</em>`;
      }
    } else {
      syncPreview();
      scheduleAutoSave();
      await renderInspectorPanel();
    }
    
    toast(t('common.noteSaved') || 'Saved ✓');
  } else {
    toast(t('editor.decisionNotFoundInEditor'), true);
  }
  
  closeDecisionPopover();
};

function getPastSeriesNotesForNote(note) {
  if (!note || !note.id || !plannerEvents) return [];
  const readLinkedIds = (event) => {
    if (typeof getPlannerEventLinkedNoteIds === 'function') {
      return getPlannerEventLinkedNoteIds(event, { includePrimary: false });
    }
    return Array.isArray(event?.linkedNoteIds)
      ? event.linkedNoteIds.map(v => String(v || '').trim()).filter(Boolean)
      : [];
  };

  const primaryLinkedEvents = (typeof getPlannerEventsForNote === 'function')
    ? getPlannerEventsForNote(note.id)
    : plannerEvents.filter(e => e.noteId === note.id || (Array.isArray(e.linkedNoteIds) && e.linkedNoteIds.includes(note.id)));
  const recurrenceIds = [...new Set(
    primaryLinkedEvents
      .filter(e => e && e.recurrenceId && e.type !== 'prep')
      .map(e => e.recurrenceId)
  )];
  const connectedNoteIds = new Set();

  primaryLinkedEvents.forEach(e => {
    if (!e || e.type === 'prep') return;
    if (e.noteId && e.noteId !== note.id) connectedNoteIds.add(e.noteId);
    const linked = readLinkedIds(e);
    linked.forEach(id => {
      if (id && id !== note.id) connectedNoteIds.add(id);
    });
  });

  plannerEvents
    .filter(e => e && e.recurrenceId && recurrenceIds.includes(e.recurrenceId) && e.type !== 'prep')
    .forEach(e => {
      if (e.noteId && e.noteId !== note.id) connectedNoteIds.add(e.noteId);
      const linked = readLinkedIds(e);
      linked.forEach(id => {
        if (id && id !== note.id) connectedNoteIds.add(id);
      });
    });

  if (connectedNoteIds.size === 0) return [];

  const pastNotes = [];
  connectedNoteIds.forEach(id => {
    const n = getNoteById(id);
    if (n) pastNotes.push(n);
  });
  return pastNotes.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

function getNotesSharingTags(note) {
  if (!note) return [];
  const noteGroup = new Set(note.group_tags || []);
  const noteMajor = new Set(note.major_topic_tags || []);
  const noteTopic = new Set(note.topic_tags || []);
  const curManifest = (typeof manifest !== 'undefined' && Array.isArray(manifest)) ? manifest : ((typeof window !== 'undefined' && Array.isArray(window.manifest)) ? window.manifest : []);

  const results = [];
  for (const n of curManifest) {
    if (n.id === note.id) continue;
    const hasSharedGroup = (n.group_tags || []).some(t => noteGroup.has(t));
    const hasSharedMajor = (n.major_topic_tags || []).some(t => noteMajor.has(t));
    const hasSharedTopic = (n.topic_tags || []).some(t => noteTopic.has(t));
    if (hasSharedGroup || hasSharedMajor || hasSharedTopic) {
      results.push(n);
    }
  }
  return results.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

let _linkNotePicker = null;
let _linkNotePickerAnchor = null;

function closeLinkNotePicker() {
  if (_linkNotePicker) {
    _linkNotePicker.remove();
    _linkNotePicker = null;
  }
  if (_linkNotePickerAnchor) {
    _linkNotePickerAnchor.removeAttribute('data-link-note-anchor');
    _linkNotePickerAnchor = null;
  }
  document.removeEventListener('click', _dismissNoteLinkPicker);
  document.removeEventListener('keydown', _escNoteLinkPicker);
}

function _dismissNoteLinkPicker(e) {
  const isAnchor = !!(_linkNotePickerAnchor && (_linkNotePickerAnchor === e.target || _linkNotePickerAnchor.contains(e.target)));
  if (_linkNotePicker && !_linkNotePicker.contains(e.target) && !isAnchor) {
    closeLinkNotePicker();
  }
}

function _escNoteLinkPicker(e) {
  if (e.key === 'Escape') closeLinkNotePicker();
}

function openLinkNotePicker(anchorBtn, options = {}) {
  if (_linkNotePicker && _linkNotePickerAnchor === anchorBtn) {
    closeLinkNotePicker();
    return;
  }
  closeLinkNotePicker();
  _linkNotePickerAnchor = anchorBtn || null;
  if (_linkNotePickerAnchor) {
    _linkNotePickerAnchor.setAttribute('data-link-note-anchor', '1');
  }
  const activeNoteId = String(options.activeNoteId || currentNote?.id || '').trim();
  const onSelect = typeof options.onSelect === 'function' ? options.onSelect : null;
  const excluded = new Set((Array.isArray(options.excludeNoteIds) ? options.excludeNoteIds : [])
    .map(v => String(v || '').trim())
    .filter(Boolean));
  if (activeNoteId) excluded.add(activeNoteId);
  const rect = anchorBtn.getBoundingClientRect();
  
  const picker = document.createElement('div');
  picker.className = 'todo-link-picker';
  picker.style.position = 'fixed';
  
  const spaceBelow = window.innerHeight - rect.bottom;
  const pickerHeightEstimate = 280;
  let topPos = rect.bottom + 6;
  if (spaceBelow < pickerHeightEstimate && rect.top > pickerHeightEstimate) {
    topPos = rect.top - pickerHeightEstimate - 6;
  }
  picker.style.top = topPos + 'px';
  const pickerWidth = 360;
  const leftPos = Math.max(10, Math.min(window.innerWidth - pickerWidth - 10, rect.left - 100));
  picker.style.left = leftPos + 'px';
  picker.style.zIndex = '10050';

  const filterDiv = document.createElement('div');
  filterDiv.className = 'todo-link-picker-filter';
  
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'todo-link-picker-input';
  inp.placeholder = options.placeholder || t('planner.searchNotePlaceholder') || 'Search note...';
  filterDiv.appendChild(inp);
  picker.appendChild(filterDiv);

  const list = document.createElement('div');
  list.className = 'todo-link-picker-list';
  picker.appendChild(list);

  function render(filter) {
    list.innerHTML = '';
    const fl = (filter || '').toLowerCase();
    const curManifest = (typeof manifest !== 'undefined' && Array.isArray(manifest)) ? manifest : ((typeof window !== 'undefined' && Array.isArray(window.manifest)) ? window.manifest : []);
    const notes = curManifest
      .filter(n => !excluded.has(String(n.id || '').trim()))
      .filter(n => !fl || (n.title || '').toLowerCase().includes(fl))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    if (!notes.length) {
      const em = document.createElement('div');
      em.className = 'todo-link-picker-empty';
      em.textContent = options.emptyText || t('editor.noMatchingNotes') || 'No matching note.';
      list.appendChild(em);
      return;
    }
    
    notes.forEach(note => {
      const item = document.createElement('div');
      item.className = 'todo-link-picker-item';
      item.title = t('overlay.linkNoteTitleTooltip', { title: note.title || t('common.untitledNote') });
      
      const badge = document.createElement('span');
      badge.className = 'note-todo-badge';
      badge.style.background = 'var(--card-bg-alt)';
      badge.style.color = 'var(--text-muted)';
      badge.style.border = '1px solid var(--card-border)';
      badge.textContent = 'NOTE';
      
      const text = document.createElement('span');
      text.className = 'todo-link-picker-item-text';
      text.textContent = `${note.title || 'Untitled'} (${note.date || ''})`.slice(0, 90);
      
      item.appendChild(badge);
      item.appendChild(text);
      
      item.addEventListener('mousedown', async e => {
        e.preventDefault();
        if (onSelect) {
          await onSelect(note);
        } else {
          insertLinkedNoteWikiLink(note);
        }
        closeLinkNotePicker();
      });
      list.appendChild(item);
    });
  }

  render('');
  inp.addEventListener('input', () => render(inp.value.trim()));

  document.body.appendChild(picker);
  _linkNotePicker = picker;
  requestAnimationFrame(() => inp.focus());
  setTimeout(() => document.addEventListener('click', _dismissNoteLinkPicker), 0);
  document.addEventListener('keydown', _escNoteLinkPicker);
}

function insertLinkedNoteWikiLink(note) {
  const ta = document.getElementById('edit-textarea');
  if (!ta) return;
  
  const isViewMode = document.querySelector('.overlay-panel')?.classList.contains('overlay-view-mode');
  if (isViewMode) {
    enterOverlayEditMode();
  }
  
  ta.focus();
  
  const linkHtml = `<a href="#" class="note-link wiki-link" data-note-id="${escA(note.id || '')}" data-note-path="${escA(note.path || '')}" title="${escA(typeof t === 'function' ? t('editor.openNoteLinkTooltip') || 'Open note' : 'Open note')}: ${escA(note.title || '')}">📝 ${escH(note.title || 'Untitled')}</a>&nbsp;`;
  const isRich = ta.contentEditable === 'true';
  if (isRich) {
    const selection = window.getSelection();
    let inserted = false;
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (ta.contains(range.commonAncestorContainer)) {
        document.execCommand('insertHTML', false, linkHtml);
        inserted = true;
      }
    }
    if (!inserted) {
      const p = document.createElement('p');
      p.innerHTML = linkHtml;
      ta.appendChild(p);
    }
  } else {
    const linkText = `[[${note.title}]] `;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const val = ta.value || '';
    let newVal;
    if (start !== undefined) {
      newVal = val.slice(0, start) + linkText + val.slice(end);
      ta.value = newVal;
      ta.selectionStart = ta.selectionEnd = start + linkText.length;
    } else {
      newVal = val + (val.endsWith('\n') ? '' : '\n') + '\n' + linkText;
      ta.value = newVal;
    }
  }
  
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  if (currentNote?.id && typeof syncPlannerAssociationsFromNote === 'function') {
    syncPlannerAssociationsFromNote(currentNote.id, { addedNoteId: note.id })
      .then(() => {
        if (typeof _renderPlannerBlocksForNote === 'function') _renderPlannerBlocksForNote(currentNote.id);
      })
      .catch(err => console.warn('Could not sync planner note association from note link', err));
  }
  if (typeof renderInspectorPanel === 'function') renderInspectorPanel();
}

window.insertLinkedNoteWikiLink = insertLinkedNoteWikiLink;
window.insertNoteLink = function(anchorBtn) {
  const btn = anchorBtn || document.getElementById('fmt-link-note-btn');
  if (btn) {
    openLinkNotePicker(btn, { activeNoteId: currentNote?.id });
  }
};

window.focusAndSelectElementContents = function(el) {
  if (!el) return;
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
};

function handleRichEditorKeydown(e) {
  const target = e.target;
  const isTodoText = target.classList.contains('note-todo-text');
  const isDecisionText = target.classList.contains('note-decision-text');
  
  if (!isTodoText && !isDecisionText) return;
  
  if (e.key === 'Enter') {
    e.preventDefault();
    e.stopPropagation();
    
    const wrapper = target.closest('.note-todo, .note-decision-wrapper');
    if (!wrapper) return;
    
    const p = document.createElement('p');
    p.innerHTML = '<br>';
    wrapper.insertAdjacentElement('afterend', p);
    
    const range = document.createRange();
    const selection = window.getSelection();
    range.setStart(p, 0);
    range.setEnd(p, 0);
    selection.removeAllRanges();
    selection.addRange(range);
    p.focus();
    
    const ta = document.getElementById('edit-textarea');
    if (ta) ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  
  if (e.key === 'Backspace') {
    if (target.textContent === '') {
      e.preventDefault();
      e.stopPropagation();
      const wrapper = target.closest('.note-todo, .note-decision-wrapper');
      if (wrapper) {
        const range = document.createRange();
        const selection = window.getSelection();
        range.setStartBefore(wrapper);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        
        wrapper.remove();
        
        const ta = document.getElementById('edit-textarea');
        if (ta) ta.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  }
}



async function generateNoteSummaryWithAI() {
  if (typeof LLMService === 'undefined' || !LLMService.isEnabled()) {
    toast(typeof t === 'function' ? t('llm.disabledToast') || 'AI is not enabled' : 'AI is not enabled', true);
    if (typeof setAiActionState === 'function') setAiActionState('idle');
    return;
  }
  
  const ta = document.getElementById('edit-textarea');
  if (!ta) {
    if (typeof setAiActionState === 'function') setAiActionState('idle');
    return;
  }
  
  const summaryEl = document.getElementById('edit-summary');
  if (!summaryEl) {
    if (typeof setAiActionState === 'function') setAiActionState('idle');
    return;
  }

  // Strictly capture the target note context
  const targetNote = (typeof currentNote !== 'undefined' && currentNote) ? { ...currentNote } : null;
  const targetPath = targetNote?.path || (typeof currentNote !== 'undefined' ? currentNote?.path : '');
  const targetId = targetNote?.id || (typeof currentNote !== 'undefined' ? currentNote?.id : '');
  const targetTitle = targetNote?.title || '';
  if (!targetNote || !targetPath) {
    if (typeof setAiActionState === 'function') setAiActionState('idle');
    return;
  }
  
  if (typeof setAiActionState === 'function') {
    setAiActionState('summarizing');
  } else {
    const btn = document.getElementById('btn-generate-summary-ai');
    if (btn) {
      btn.disabled = true;
      btn.classList.add('loading');
      btn.innerHTML = `✨ ${typeof t === 'function' ? t('editor.aiSummaryGenerating') || 'Generating...' : 'Generating...'}`;
      btn.title = typeof t === 'function' ? t('editor.aiSummaryGeneratingTooltip') || 'Generating meeting summary with AI...' : 'Generating meeting summary with AI...';
    }
  }
  
  try {
    const mainHTML = ta.innerHTML;
    const summaryResult = await LLMService.generateNoteSummary(targetNote, mainHTML);
    if (summaryResult) {
      const isCurrent = typeof currentNote !== 'undefined' && currentNote && (currentNote.path === targetPath || (targetId && currentNote.id === targetId));
      
      if (isCurrent) {
        summaryEl.innerHTML = summaryResult;
        currentNote.summary = summaryResult;
        summaryEl.dispatchEvent(new Event('input', { bubbles: true }));
        if (typeof autoSaveNote === 'function') {
          autoSaveNote({ silent: false });
        } else if (typeof saveCurrentNote === 'function') {
          saveCurrentNote();
        }
        if (typeof syncPreview === 'function') {
          syncPreview();
        }
      } else {
        // User switched to a different note while AI was summarizing — persist directly to target note file & manifest
        try {
          const originalHTML = await StorageAPI.readNoteContent(targetPath);
          const parsed = (typeof parseNoteHTML === 'function') ? parseNoteHTML(originalHTML) : null;
          const changes = {
            title: targetNote.title ?? parsed?.title ?? '',
            date: targetNote.date ?? parsed?.date ?? '',
            group_tags: targetNote.group_tags ?? parsed?.group_tags ?? [],
            major_topic_tags: targetNote.major_topic_tags ?? parsed?.major_topic_tags ?? [],
            topic_tags: targetNote.topic_tags ?? parsed?.topic_tags ?? [],
            extra_tags: targetNote.extra_tags ?? parsed?.extra_tags ?? [],
            mainHTML: targetNote.mainHTML ?? parsed?.mainHTML ?? '<p></p>',
            summary: summaryResult,
            reviewed: targetNote.reviewed ?? parsed?.reviewed ?? false
          };
          const updatedHTML = applyNoteEdits(originalHTML, changes);
          await StorageAPI.writeNoteContent(targetPath, updatedHTML);
          upsertManifest({ ...targetNote, ...changes, summary: summaryResult, modified: new Date().toISOString() });
          await saveManifest({ force: true });
        } catch (saveErr) {
          console.warn('Failed to background-save summary for target note:', targetPath, saveErr);
        }
      }

      // Update Daily Review note list state if active
      if (typeof DailyReviewController !== 'undefined' && typeof DailyReviewController.updateNoteSummaryBadge === 'function') {
        DailyReviewController.updateNoteSummaryBadge(targetPath, summaryResult);
      }

      toast(typeof t === 'function' ? t('common.summaryGenerated') || 'Summary generated!' : 'Summary generated!');
    } else {
      toast('Could not generate summary (empty response)', true);
    }
  } catch (e) {
    console.error('AI Summary generation failed:', e);
    toast('Failed to generate summary: ' + e.message, true);
  } finally {
    if (typeof setAiActionState === 'function') {
      setAiActionState('idle');
    } else {
      const btn = document.getElementById('btn-generate-summary-ai');
      if (btn) {
        btn.disabled = false;
        btn.classList.remove('loading');
        btn.innerHTML = `✨ ${typeof t === 'function' ? t('editor.aiSummaryShort') || 'AI' : 'AI'}`;
        btn.title = typeof t === 'function' ? t('editor.aiSummaryTooltip') || 'Generate summary with AI' : 'Generate summary with AI';
      }
    }
  }
}

function setupToolbarScrollButtons() {
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return;
  const toolbar = document.querySelector('.edit-toolbar');
  if (!toolbar) return;
  
  // Wrap in container if not already wrapped
  let wrapper = toolbar.parentElement;
  if (!wrapper.classList.contains('edit-toolbar-wrapper')) {
    wrapper = document.createElement('div');
    wrapper.className = 'edit-toolbar-wrapper';
    
    toolbar.parentNode.insertBefore(wrapper, toolbar);
    wrapper.appendChild(toolbar);
    
    // Create scroll left button
    const btnLeft = document.createElement('button');
    btnLeft.id = 'toolbar-scroll-left-btn';
    btnLeft.className = 'toolbar-scroll-btn scroll-left';
    btnLeft.type = 'button';
    btnLeft.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;
    btnLeft.title = t('editor.scrollLeft') || 'Scroll left';
    
    // Create scroll right button
    const btnRight = document.createElement('button');
    btnRight.id = 'toolbar-scroll-right-btn';
    btnRight.className = 'toolbar-scroll-btn scroll-right';
    btnRight.type = 'button';
    btnRight.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
    btnRight.title = t('editor.scrollRight') || 'Scroll right';
    
    wrapper.appendChild(btnLeft);
    wrapper.appendChild(btnRight);
    
    // Wire click events
    btnLeft.addEventListener('click', () => {
      toolbar.scrollBy({ left: -150, behavior: 'smooth' });
    });
    btnRight.addEventListener('click', () => {
      toolbar.scrollBy({ left: 150, behavior: 'smooth' });
    });
    
    // Map vertical mouse wheel down to scroll right, and up to scroll left
    toolbar.addEventListener('wheel', (e) => {
      if (e.deltaY !== 0) {
        e.preventDefault();
        toolbar.scrollLeft += e.deltaY;
      }
    }, { passive: false });
  }
  
  const btnLeft = wrapper.querySelector('#toolbar-scroll-left-btn');
  const btnRight = wrapper.querySelector('#toolbar-scroll-right-btn');
  
  const updateButtons = () => {
    const scrollLeft = toolbar.scrollLeft;
    const scrollWidth = toolbar.scrollWidth;
    const clientWidth = toolbar.clientWidth;
    
    const canScrollLeft = scrollLeft > 2;
    const canScrollRight = scrollLeft < scrollWidth - clientWidth - 2;
    const hasOverflow = scrollWidth > clientWidth;
    
    if (hasOverflow && canScrollLeft) {
      btnLeft.classList.add('visible');
    } else {
      btnLeft.classList.remove('visible');
    }
    
    if (hasOverflow && canScrollRight) {
      btnRight.classList.add('visible');
    } else {
      btnRight.classList.remove('visible');
    }
  };
  
  toolbar.addEventListener('scroll', updateButtons);
  
  // Use ResizeObserver to detect layout size changes
  if (window.ResizeObserver) {
    const observer = new ResizeObserver(updateButtons);
    observer.observe(toolbar);
  } else {
    window.addEventListener('resize', updateButtons);
  }
  
  // Run once initially
  setTimeout(updateButtons, 50);
}

// Initialize toolbar scroll buttons initially
setTimeout(setupToolbarScrollButtons, 100);

function cleanHtmlBeforeSave(html) {
  if (!html) return html;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
    const container = doc.body.firstElementChild;
    if (!container) return html;

    // Ensure interactive checkboxes sync checked state to HTML attributes
    container.querySelectorAll('input[type="checkbox"]').forEach(chk => {
      chk.toggleAttribute('checked', chk.checked);
    });

    // Clean corrections
    const corrections = container.querySelectorAll('.inline-correction-wrapper');
    corrections.forEach(wrapper => {
      const delSpan = wrapper.querySelector('.inline-correction-del-line');
      if (delSpan) {
        // Remove diff change tags inside delSpan before unwrapping
        delSpan.querySelectorAll('.diff-change-del').forEach(d => {
          const parentNode = d.parentNode;
          while (d.firstChild) parentNode.insertBefore(d.firstChild, d);
          d.remove();
        });
        delSpan.querySelectorAll('.inline-correction-hover-actions, .diff-change-ins').forEach(el => el.remove());
        const parent = wrapper.parentNode;
        while (delSpan.firstChild) {
          parent.insertBefore(delSpan.firstChild, wrapper);
        }
      }
      wrapper.remove();
    });

    // Clean proposals
    const proposals = container.querySelectorAll('.inline-proposal-wrapper');
    proposals.forEach(wrapper => {
      wrapper.remove();
    });

    // Clean KaTeX rendered elements so math stays clean
    container.querySelectorAll('.katex-rendered, [data-latex]').forEach(mathEl => {
      const rawFormula = mathEl.getAttribute('data-latex') || mathEl.getAttribute('data-formula') || '';
      if (rawFormula) {
        mathEl.innerHTML = '';
        mathEl.removeAttribute('data-katex-rendered');
      }
    });
    container.querySelectorAll('.katex, .katex-html').forEach(k => {
      const parentMath = k.closest('[data-latex], .katex-math-span');
      if (!parentMath) k.remove();
    });

    const cleanedHtml = container.innerHTML;
    if (typeof sanitizeHtmlContent === 'function') {
      return sanitizeHtmlContent(cleanedHtml);
    }
    return cleanedHtml;
  } catch(e) {
    console.error('cleanHtmlBeforeSave failed', e);
    return typeof sanitizeHtmlContent === 'function' ? sanitizeHtmlContent(html) : html;
  }
}
window.cleanHtmlBeforeSave = cleanHtmlBeforeSave;

function convertMentionsToPills(html) {
  return html || '';
}
window.convertMentionsToPills = convertMentionsToPills;

function computeWordDiffHtml(oldStr, newStr) {
  const oldText = String(oldStr || '').trim();
  const newText = String(newStr || '').trim();
  if (!oldText) {
    return {
      redHTML: '',
      greenHTML: `<span class="diff-change-ins">${convertMentionsToPills(escH(newText))}</span>`
    };
  }
  if (!newText) {
    return {
      redHTML: `<span class="diff-change-del">${escH(oldText)}</span>`,
      greenHTML: ''
    };
  }

  const tokenize = (str) => String(str || '').match(/\S+|\s+/g) || [];
  const oldTokens = tokenize(oldText);
  const newTokens = tokenize(newText);

  const n = oldTokens.length;
  const m = newTokens.length;

  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      if (oldTokens[i] === newTokens[j]) {
        dp[i + 1][j + 1] = dp[i][j] + 1;
      } else {
        dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  let i = n, j = m;
  const delTokens = [];
  const insTokens = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldTokens[i - 1] === newTokens[j - 1]) {
      delTokens.unshift({ type: 'same', text: oldTokens[i - 1] });
      insTokens.unshift({ type: 'same', text: newTokens[j - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      insTokens.unshift({ type: 'ins', text: newTokens[j - 1] });
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      delTokens.unshift({ type: 'del', text: oldTokens[i - 1] });
      i--;
    }
  }

  let redHTML = '';
  let curDel = '';
  for (const tok of delTokens) {
    if (tok.type === 'del') {
      curDel += tok.text;
    } else {
      if (curDel) {
        redHTML += `<span class="diff-change-del">${escH(curDel)}</span>`;
        curDel = '';
      }
      redHTML += escH(tok.text);
    }
  }
  if (curDel) {
    redHTML += `<span class="diff-change-del">${escH(curDel)}</span>`;
  }

  let greenHTML = '';
  let curIns = '';
  for (const tok of insTokens) {
    if (tok.type === 'ins') {
      curIns += tok.text;
    } else {
      if (curIns) {
        greenHTML += `<span class="diff-change-ins">${convertMentionsToPills(escH(curIns))}</span>`;
        curIns = '';
      }
      greenHTML += convertMentionsToPills(escH(tok.text));
    }
  }
  if (curIns) {
    greenHTML += `<span class="diff-change-ins">${convertMentionsToPills(escH(curIns))}</span>`;
  }

  return { redHTML, greenHTML };
}
window.computeWordDiffHtml = computeWordDiffHtml;

function acceptInlineCorrection(wrapper) {
  if (!wrapper) return;
  const parent = wrapper.parentNode;
  if (!parent) return;

  let proposalType = wrapper.getAttribute('data-proposal-type');
  if (!proposalType) {
    if (wrapper.classList.contains('inline-todo-proposal') || wrapper.classList.contains('inline-proposal-todo')) proposalType = 'todo';
    else if (wrapper.classList.contains('inline-decision-proposal') || wrapper.classList.contains('inline-proposal-decision')) proposalType = 'decision';
    else if (wrapper.classList.contains('inline-colleague-proposal') || wrapper.classList.contains('inline-proposal-colleague') || wrapper.classList.contains('inline-proposal-delegation')) proposalType = 'colleague';
    else if (wrapper.classList.contains('inline-note-proposal') || wrapper.classList.contains('inline-proposal-note')) proposalType = 'note';
  }

  if (proposalType === 'todo') {
    const todoId = wrapper.getAttribute('data-todo-id') || (typeof generateTodoId === 'function' ? generateTodoId() : ('todo-' + Date.now() + Math.random().toString(36).slice(2, 6)));
    let title = wrapper.getAttribute('data-todo-title');
    if (!title) {
      title = (typeof getTodoMarkerTitleText === 'function') ? getTodoMarkerTitleText(wrapper) : 'New Task';
    }
    title = (typeof cleanTaskTitleText === 'function') ? cleanTaskTitleText(title) : (title || 'New Task');
    const priority = wrapper.getAttribute('data-todo-priority') || wrapper.querySelector('.todo-urgency-value')?.textContent?.trim() || 'Medium';
    const ownerEl = wrapper.querySelector('.owner-tag, [data-owner]');
    const rawOwner = wrapper.getAttribute('data-todo-owner') || wrapper.getAttribute('data-owner') || (ownerEl ? ownerEl.getAttribute('data-owner') || ownerEl.textContent.replace(/^[👤@\s]+/, '').trim() : '') || 'me';
    const ownerId = (typeof resolveColleagueId === 'function') ? (resolveColleagueId(rawOwner, { allowCreate: false, allowMe: true }) || 'me') : rawOwner;
    const ownerDisplayName = (typeof getColleagueLabelById === 'function') ? getColleagueLabelById(ownerId, ownerId === 'me' ? 'me' : rawOwner) : (ownerId === 'me' ? 'me' : rawOwner);
    const ownerBadgeLabel = ownerDisplayName ? (ownerDisplayName === 'me' ? '@me' : `@${ownerDisplayName.replace(/^@/, '')}`) : '';
    const reassignTooltip = typeof t === 'function' ? (t('todo.reassignColleagueTooltip') || 'Click to reassign colleague') : 'Click to reassign colleague';

    const todoChipHtml = `<span class="note-todo" data-todo-id="${escA(todoId)}" data-importance="${escA(priority)}" data-urgency="Medium" data-owner="${escA(ownerDisplayName)}" data-owner-id="${escA(ownerId)}" data-todo-priority="${escA(priority)}" contenteditable="false">` +
      `<span class="note-todo-badge imp-${escA(priority.toLowerCase())}" contenteditable="false" title="Importance: ${escA(priority)}">⚡ ${escH(priority)}</span> ` +
      (ownerBadgeLabel ? `<span class="note-todo-badge owner-tag inline-reassign-owner" contenteditable="false" title="${escA(reassignTooltip)}">👤 ${escH(ownerBadgeLabel)}</span> ` : '') +
      `<span class="note-todo-text" contenteditable="true">${escH(title)}</span>` +
      `</span>`;

    const isInsideList = parent.tagName === 'UL' || parent.tagName === 'OL';
    const containerEl = document.createElement(isInsideList ? 'li' : 'p');
    containerEl.innerHTML = convertMentionsToPills(todoChipHtml);

    parent.replaceChild(containerEl, wrapper);

    if (typeof AIChatController !== 'undefined' && typeof AIChatController.executeSuggestion === 'function') {
      const noteWs = (typeof currentNote !== 'undefined' && currentNote)
        ? ((typeof getNoteWorkstreamName === 'function' ? getNoteWorkstreamName(currentNote) : '') || currentNote.workstream || (Array.isArray(currentNote.workstreams) ? currentNote.workstreams[0] : '') || '')
        : '';
      AIChatController.executeSuggestion({
        action: 'create_todo',
        properties: { id: todoId, title, priority, context: title, workstream: noteWs }
      });
    }
  } else if (proposalType === 'decision') {
    let title = wrapper.getAttribute('data-decision-title');
    if (!title) {
      const textEl = wrapper.querySelector('.note-decision-text, strong, .inline-proposal-body');
      title = textEl ? textEl.textContent.trim() : 'New Decision';
    }
    const status = wrapper.getAttribute('data-decision-status') || 'active';
    const badgeText = `!decision:${status}`;

    const isInsideList = parent.tagName === 'UL' || parent.tagName === 'OL';
    const containerEl = document.createElement(isInsideList ? 'li' : 'p');
    containerEl.innerHTML = convertMentionsToPills(`<span class="note-decision-wrapper note-decision-draft" data-decision-status="${status}" data-decision-text="${escH(title)}" contenteditable="false"><strong class="pill-decision pill-decision-${status}" contenteditable="false">${escH(badgeText)}</strong> <span class="note-decision-text" contenteditable="true">${escH(title)}</span></span>`);

    parent.replaceChild(containerEl, wrapper);
  } else if (proposalType === 'colleague') {
    let name = wrapper.getAttribute('data-colleague-name');
    let task = wrapper.getAttribute('data-colleague-task') || '';
    if (!name) {
      const textEl = wrapper.querySelector('strong');
      name = textEl ? textEl.textContent.replace(/^@/, '').trim() : 'Colleague';
    }

    const isInsideList = parent.tagName === 'UL' || parent.tagName === 'OL';
    const containerEl = document.createElement(isInsideList ? 'li' : 'p');
    containerEl.innerHTML = convertMentionsToPills(`<span class="pill-delegation" data-owner="${escH(name)}" contenteditable="false">@${escH(name)}</span> ${escH(task)}`);

    parent.replaceChild(containerEl, wrapper);
  } else if (proposalType === 'note') {
    let noteTitle = wrapper.getAttribute('data-note-title');
    let notePath = wrapper.getAttribute('data-note-path') || '';
    let noteId = wrapper.getAttribute('data-note-id') || '';
    let noteEntry = null;
    if (typeof manifest !== 'undefined' && Array.isArray(manifest)) {
      noteEntry = (noteId ? manifest.find(n => n.id === noteId) : null) ||
                  (notePath ? manifest.find(n => n.path === notePath) : null) ||
                  (noteTitle ? manifest.find(n => (n.title || '').toLowerCase() === (noteTitle || '').toLowerCase()) : null);
    }
    const finalTitle = noteEntry?.title || noteTitle || 'Untitled';
    const finalPath = noteEntry?.path || notePath;
    const finalId = noteEntry?.id || noteId;
    const openTooltip = (typeof t === 'function' ? t('editor.openNoteLinkTooltip') || 'Open linked note' : 'Open linked note') + ': ' + finalTitle;

    const linkHtml = `<a href="#" class="note-link wiki-link" data-note-id="${escA(finalId)}" data-note-path="${escA(finalPath)}" title="${escA(openTooltip)}">📝 ${escH(finalTitle)}</a>&nbsp;`;

    const isInsideList = parent.tagName === 'UL' || parent.tagName === 'OL';
    const containerEl = document.createElement(isInsideList ? 'li' : 'p');
    containerEl.innerHTML = linkHtml;

    parent.replaceChild(containerEl, wrapper);

    if (typeof currentNote !== 'undefined' && currentNote?.id && typeof syncPlannerAssociationsFromNote === 'function' && finalId) {
      syncPlannerAssociationsFromNote(currentNote.id, { addedNoteId: finalId }).catch(err => console.warn(err));
    }
  } else {
    const insSpan = wrapper.querySelector('.inline-correction-ins-line');
    if (insSpan) {
      const temp = document.createElement('div');
      temp.innerHTML = insSpan.innerHTML;

      temp.querySelectorAll('.inline-correction-hover-actions, .inline-diff-gutter, .diff-change-del').forEach(el => el.remove());

      temp.querySelectorAll('.diff-change-ins').forEach(span => {
        const frag = document.createDocumentFragment();
        const div = document.createElement('div');
        div.innerHTML = span.innerHTML;
        while (div.firstChild) {
          frag.appendChild(div.firstChild);
        }
        span.parentNode.replaceChild(frag, span);
      });

      const origTag = wrapper.getAttribute('data-original-tag');
      if (origTag) {
        const elem = document.createElement(origTag);
        elem.innerHTML = convertMentionsToPills(temp.innerHTML);
        parent.replaceChild(elem, wrapper);
      } else {
        const span = document.createElement('span');
        span.innerHTML = convertMentionsToPills(temp.innerHTML);
        const frag = document.createDocumentFragment();
        while (span.firstChild) {
          frag.appendChild(span.firstChild);
        }
        parent.replaceChild(frag, wrapper);
      }
    } else {
      wrapper.remove();
    }
  }

  const cardIndexAttr = wrapper.getAttribute('data-card-index');
  if (cardIndexAttr !== null && typeof currentNote !== 'undefined' && currentNote && typeof getAiState === 'function') {
    const idx = parseInt(cardIndexAttr, 10);
    if (!isNaN(idx)) {
      const state = getAiState(currentNote);
      if (state) {
        if (!Array.isArray(state.proposalStates)) state.proposalStates = [];
        state.proposalStates[idx] = 'applied';
      }
    }
  }

  const ta = document.getElementById('edit-textarea');
  if (ta) {
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
  }
}

function rejectInlineCorrection(wrapper) {
  if (!wrapper) return;
  const parent = wrapper.parentNode;
  if (!parent) return;

  let proposalType = wrapper.getAttribute('data-proposal-type');
  if (!proposalType) {
    if (wrapper.classList.contains('inline-todo-proposal') || wrapper.classList.contains('inline-proposal-todo')) proposalType = 'todo';
    else if (wrapper.classList.contains('inline-decision-proposal') || wrapper.classList.contains('inline-proposal-decision')) proposalType = 'decision';
    else if (wrapper.classList.contains('inline-colleague-proposal') || wrapper.classList.contains('inline-proposal-colleague') || wrapper.classList.contains('inline-proposal-delegation')) proposalType = 'colleague';
  }

  if (proposalType === 'todo' || proposalType === 'decision' || proposalType === 'colleague') {
    wrapper.remove();
  } else {
    const delSpan = wrapper.querySelector('.inline-correction-del-line');
    if (delSpan) {
      const temp = document.createElement('div');
      temp.innerHTML = delSpan.innerHTML;

      temp.querySelectorAll('.inline-correction-hover-actions, .inline-diff-gutter, .diff-change-ins').forEach(el => el.remove());

      temp.querySelectorAll('.diff-change-del').forEach(span => {
        const frag = document.createDocumentFragment();
        const div = document.createElement('div');
        div.innerHTML = span.innerHTML;
        while (div.firstChild) {
          frag.appendChild(div.firstChild);
        }
        span.parentNode.replaceChild(frag, span);
      });

      const origTag = wrapper.getAttribute('data-original-tag');
      if (origTag) {
        const elem = document.createElement(origTag);
        elem.innerHTML = convertMentionsToPills(temp.innerHTML);
        parent.replaceChild(elem, wrapper);
      } else {
        const span = document.createElement('span');
        span.innerHTML = convertMentionsToPills(temp.innerHTML);
        const frag = document.createDocumentFragment();
        while (span.firstChild) {
          frag.appendChild(span.firstChild);
        }
        parent.replaceChild(frag, wrapper);
      }
    } else {
      wrapper.remove();
    }
  }

  const cardIndexAttr = wrapper.getAttribute('data-card-index');
  if (cardIndexAttr !== null && typeof currentNote !== 'undefined' && currentNote && typeof getAiState === 'function') {
    const idx = parseInt(cardIndexAttr, 10);
    if (!isNaN(idx)) {
      const state = getAiState(currentNote);
      if (state) {
        if (!Array.isArray(state.proposalStates)) state.proposalStates = [];
        state.proposalStates[idx] = 'dropped';
      }
    }
  }

  const ta = document.getElementById('edit-textarea');
  if (ta) {
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
  }
}

function renderAiSuggestions(parsedData, note) {
  if (!parsedData || !Array.isArray(parsedData.suggested_actions)) return;

  const editor = document.getElementById('edit-textarea');
  if (!editor) return;

  let blocks = Array.from(editor.querySelectorAll('p, li, blockquote, h1, h2, h3, h4, h5, h6, div.note-block'));
  if (blocks.length === 0 && editor.children.length === 0 && editor.textContent.trim()) {
    const p = document.createElement('p');
    p.innerHTML = editor.innerHTML;
    editor.innerHTML = '';
    editor.appendChild(p);
    blocks = [p];
  }

  let cardIndex = Date.now() + Math.floor(Math.random() * 1000);

  const blockCorrectionsMap = new Map();
  const otherActions = [];

  parsedData.suggested_actions.forEach(act => {
    const actionType = String(act.action || act.kind || '').toLowerCase();
    const props = act.properties || act;
    const target = props.target_string || props.target || props.original || '';

    if (actionType === 'text_correction' || actionType === 'text_mutation' || actionType === 'correction') {
      if (!target) return;
      const block = blocks.find(b => b.isConnected && !b.closest('.inline-correction-wrapper, .inline-proposal-wrapper') && (b.innerText || b.textContent || '').includes(target));
      if (block) {
        if (!blockCorrectionsMap.has(block)) {
          blockCorrectionsMap.set(block, []);
        }
        const replacement = props.replacement_text || props.replacement || props.corrected || target;
        blockCorrectionsMap.get(block).push({ act, target, replacement });
      }
    } else {
      otherActions.push({ act, actionType, props, target });
    }
  });

  // Render merged text corrections per block
  blockCorrectionsMap.forEach((corrections, block) => {
    if (!block.parentNode) return;

    const originalTag = block.tagName ? block.tagName.toLowerCase() : 'p';
    const originalText = (block.innerText || block.textContent || '').trim();
    let updatedText = originalText;

    corrections.forEach(c => {
      if (c.target && c.replacement && c.target !== c.replacement) {
        const escaped = c.target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        updatedText = updatedText.replace(new RegExp(escaped, 'g'), c.replacement);
      }
    });

    if (updatedText !== originalText) {
      const { redHTML, greenHTML } = computeWordDiffHtml(originalText, updatedText);

      const wrapper = document.createElement('div');
      wrapper.className = 'inline-correction-wrapper';
      wrapper.setAttribute('data-card-index', cardIndex++);
      wrapper.setAttribute('data-original-tag', originalTag);
      wrapper.setAttribute('contenteditable', 'false');

      wrapper.innerHTML = `
        <div class="inline-correction-hover-actions" contenteditable="false">
          <button class="inline-hover-btn btn-accept" type="button" onclick="event.stopPropagation(); event.preventDefault(); window.acceptInlineProposal(this);" title="Accept changes">✓ Accept</button>
          <button class="inline-hover-btn btn-reject" type="button" onclick="event.stopPropagation(); event.preventDefault(); window.rejectInlineProposal(this);" title="Reject changes">✕ Reject</button>
        </div>
        <div class="inline-correction-del-line" contenteditable="false">${redHTML}</div>
        <div class="inline-correction-ins-line" contenteditable="true">${greenHTML}</div>
      `;

      block.parentNode.replaceChild(wrapper, block);
    }
  });

  // Render non-correction proposal cards (todos, decisions, colleagues)
  otherActions.forEach(({ act, actionType, props, target }) => {
    if (actionType === 'create_todo') {
      const title = props.title || target || 'New Task';
      const priority = props.priority || 'Medium';

      let targetBlock = null;
      if (target) {
        targetBlock = blocks.find(b => b.isConnected && (b.innerText || b.textContent || '').includes(target));
      }
      if (!targetBlock && blocks.length > 0) {
        targetBlock = blocks[blocks.length - 1];
      }
      if (!targetBlock || !targetBlock.parentNode) return;

      const ownerName = props.owner || props.colleague || props.person || 'me';
      const ownerLabel = ownerName === 'me' ? '@me' : `@${ownerName.replace(/^@/, '')}`;
      const reassignTooltip = typeof t === 'function' ? (t('todo.reassignColleagueTooltip') || 'Click to reassign colleague') : 'Click to reassign colleague';

      const wrapper = document.createElement('div');
      wrapper.className = 'inline-proposal-wrapper inline-todo-proposal';
      wrapper.setAttribute('data-card-index', cardIndex++);
      wrapper.setAttribute('data-proposal-type', 'todo');
      wrapper.setAttribute('data-todo-title', title);
      wrapper.setAttribute('data-todo-priority', priority);
      wrapper.setAttribute('data-todo-owner', ownerName);
      wrapper.setAttribute('contenteditable', 'false');
      wrapper.innerHTML = `
        <div class="inline-proposal-hover-actions" contenteditable="false">
          <button class="inline-hover-btn btn-accept" type="button" onclick="event.stopPropagation(); event.preventDefault(); window.acceptInlineProposal(this);" title="Accept todo">✓ Accept</button>
          <button class="inline-hover-btn btn-reject" type="button" onclick="event.stopPropagation(); event.preventDefault(); window.rejectInlineProposal(this);" title="Reject todo">✕ Reject</button>
        </div>
        <div class="inline-proposal-content" style="padding: 6px 10px; font-size: 0.85rem; background: var(--bg-hover, rgba(16,185,129,0.08)); border-left: 3px solid #10b981; border-radius: 4px; margin: 4px 0;">
          <span style="font-weight:600; color:#059669;">📋 Proposed Task:</span> <strong>${escH(title)}</strong> (${escH(priority)}) <span class="note-todo-badge owner-tag inline-reassign-owner" data-owner="${escA(ownerName)}" contenteditable="false" title="${escA(reassignTooltip)}" style="cursor:pointer; margin-left:6px;">👤 ${escH(ownerLabel)}</span>
        </div>
      `;

      if (targetBlock.nextSibling) {
        targetBlock.parentNode.insertBefore(wrapper, targetBlock.nextSibling);
      } else {
        targetBlock.parentNode.appendChild(wrapper);
      }
    }
    else if (actionType === 'log_decision' || actionType === 'create_decision') {
      const title = props.title || props.text || target || 'New Decision';
      const status = props.status || 'active';

      let targetBlock = null;
      if (target) {
        targetBlock = blocks.find(b => b.isConnected && (b.innerText || b.textContent || '').includes(target));
      }
      if (!targetBlock && blocks.length > 0) {
        targetBlock = blocks[blocks.length - 1];
      }
      if (!targetBlock || !targetBlock.parentNode) return;

      const wrapper = document.createElement('div');
      wrapper.className = 'inline-proposal-wrapper inline-decision-proposal';
      wrapper.setAttribute('data-card-index', cardIndex++);
      wrapper.setAttribute('data-proposal-type', 'decision');
      wrapper.setAttribute('data-decision-title', title);
      wrapper.setAttribute('data-decision-status', status);
      wrapper.setAttribute('contenteditable', 'false');
      wrapper.innerHTML = `
        <div class="inline-proposal-hover-actions" contenteditable="false">
          <button class="inline-hover-btn btn-accept" type="button" onclick="event.stopPropagation(); event.preventDefault(); window.acceptInlineProposal(this);" title="Accept decision">✓ Accept</button>
          <button class="inline-hover-btn btn-reject" type="button" onclick="event.stopPropagation(); event.preventDefault(); window.rejectInlineProposal(this);" title="Reject decision">✕ Reject</button>
        </div>
        <div class="inline-proposal-content" style="padding: 6px 10px; font-size: 0.85rem; background: var(--bg-hover, rgba(59,130,246,0.08)); border-left: 3px solid #3b82f6; border-radius: 4px; margin: 4px 0;">
          <span style="font-weight:600; color:#2563eb;">⚖️ Proposed Decision:</span> <strong>${escH(title)}</strong>
        </div>
      `;

      if (targetBlock.nextSibling) {
        targetBlock.parentNode.insertBefore(wrapper, targetBlock.nextSibling);
      } else {
        targetBlock.parentNode.appendChild(wrapper);
      }
    }
    else if (actionType === 'create_colleague_mention' || actionType === 'mention_colleague') {
      const colleagueName = props.name || props.colleague || 'Colleague';
      const taskText = props.context || props.title || '';
      const reassignTooltip = typeof t === 'function' ? (t('todo.reassignColleagueTooltip') || 'Click to reassign colleague') : 'Click to reassign colleague';

      let targetBlock = null;
      if (target) {
        targetBlock = blocks.find(b => b.isConnected && (b.innerText || b.textContent || '').includes(target));
      }
      if (!targetBlock && blocks.length > 0) {
        targetBlock = blocks[blocks.length - 1];
      }
      if (!targetBlock || !targetBlock.parentNode) return;

      const wrapper = document.createElement('div');
      wrapper.className = 'inline-proposal-wrapper inline-colleague-proposal';
      wrapper.setAttribute('data-card-index', cardIndex++);
      wrapper.setAttribute('data-proposal-type', 'colleague');
      wrapper.setAttribute('data-colleague-name', colleagueName);
      wrapper.setAttribute('data-colleague-task', taskText);
      wrapper.setAttribute('contenteditable', 'false');

      wrapper.innerHTML = `
        <div class="inline-proposal-hover-actions" contenteditable="false">
          <button class="inline-hover-btn btn-accept" type="button" onclick="event.stopPropagation(); event.preventDefault(); window.acceptInlineProposal(this);" title="Accept colleague mention">✓ Accept</button>
          <button class="inline-hover-btn btn-reject" type="button" onclick="event.stopPropagation(); event.preventDefault(); window.rejectInlineProposal(this);" title="Reject colleague mention">✕ Reject</button>
        </div>
        <div class="inline-proposal-content" style="padding: 6px 10px; font-size: 0.85rem; background: var(--bg-hover, rgba(168,85,247,0.08)); border-left: 3px solid #a855f7; border-radius: 4px; margin: 4px 0;">
          <span style="font-weight:600; color:#9333ea;">👤 Proposed Colleague:</span> <span class="note-todo-badge owner-tag pill-delegation inline-reassign-owner" data-owner="${escA(colleagueName)}" contenteditable="false" title="${escA(reassignTooltip)}" style="cursor:pointer;">@${escH(colleagueName)}</span> <span style="font-size:0.75rem; opacity:0.8;">(${escH(taskText)})</span>
        </div>
      `;

      if (targetBlock.nextSibling) {
        targetBlock.parentNode.insertBefore(wrapper, targetBlock.nextSibling);
      } else {
        targetBlock.parentNode.appendChild(wrapper);
      }
    } else if (actionType === 'link_note' || actionType === 'note_link' || actionType === 'propose_note_link') {
      const noteTitle = props.title || props.note_title || target || 'Linked Note';
      const notePath = props.path || props.note_path || '';
      const noteId = props.id || props.note_id || '';
      let noteEntry = null;
      if (typeof manifest !== 'undefined' && Array.isArray(manifest)) {
        noteEntry = (noteId ? manifest.find(n => n.id === noteId) : null) ||
                    (notePath ? manifest.find(n => n.path === notePath) : null) ||
                    (noteTitle ? manifest.find(n => (n.title || '').toLowerCase() === noteTitle.toLowerCase()) : null);
      }
      const finalTitle = noteEntry?.title || noteTitle;
      const finalPath = noteEntry?.path || notePath;
      const finalId = noteEntry?.id || noteId;

      let targetBlock = null;
      if (target) {
        targetBlock = blocks.find(b => b.isConnected && (b.innerText || b.textContent || '').includes(target));
      }
      if (!targetBlock && blocks.length > 0) {
        targetBlock = blocks[blocks.length - 1];
      }
      if (!targetBlock || !targetBlock.parentNode) return;

      const acceptTooltip = typeof t === 'function' ? (t('editor.acceptNoteLinkTooltip') || 'Accept note link') : 'Accept note link';
      const rejectTooltip = typeof t === 'function' ? (t('editor.rejectNoteLinkTooltip') || 'Reject note link') : 'Reject note link';

      const wrapper = document.createElement('div');
      wrapper.className = 'inline-proposal-wrapper inline-note-proposal';
      wrapper.setAttribute('data-card-index', cardIndex++);
      wrapper.setAttribute('data-proposal-type', 'note');
      wrapper.setAttribute('data-note-title', finalTitle);
      wrapper.setAttribute('data-note-path', finalPath);
      wrapper.setAttribute('data-note-id', finalId);
      wrapper.setAttribute('contenteditable', 'false');

      wrapper.innerHTML = `
        <div class="inline-proposal-hover-actions" contenteditable="false">
          <button class="inline-hover-btn btn-accept" type="button" onclick="event.stopPropagation(); event.preventDefault(); window.acceptInlineProposal(this);" title="${escA(acceptTooltip)}">✓ Accept</button>
          <button class="inline-hover-btn btn-reject" type="button" onclick="event.stopPropagation(); event.preventDefault(); window.rejectInlineProposal(this);" title="${escA(rejectTooltip)}">✕ Reject</button>
        </div>
        <div class="inline-proposal-content" style="padding: 6px 10px; font-size: 0.85rem; background: var(--bg-hover, rgba(59,130,246,0.08)); border-left: 3px solid #3b82f6; border-radius: 4px; margin: 4px 0;">
          <span style="font-weight:600; color:#2563eb;">📝 Proposed Note Link:</span> <strong>${escH(finalTitle)}</strong>
        </div>
      `;

      if (targetBlock.nextSibling) {
        targetBlock.parentNode.insertBefore(wrapper, targetBlock.nextSibling);
      } else {
        targetBlock.parentNode.appendChild(wrapper);
      }
    }
  });

  editor.dispatchEvent(new Event('input', { bubbles: true }));
}

window.renderAiSuggestions = renderAiSuggestions;
window.acceptInlineCorrection = acceptInlineCorrection;
window.rejectInlineCorrection = rejectInlineCorrection;

window.acceptInlineProposal = function(target) {
  let wrapper = null;
  if (target && target.nodeType === 1) {
    wrapper = target.closest('.inline-proposal-wrapper, .inline-correction-wrapper');
  } else if (typeof target === 'string' || typeof target === 'number') {
    wrapper = document.querySelector(`.inline-correction-wrapper[data-card-index="${target}"], .inline-proposal-wrapper[data-card-index="${target}"]`);
  }

  if (wrapper) {
    acceptInlineCorrection(wrapper);
  } else if (typeof target === 'number' || typeof target === 'string') {
    if (typeof currentNote !== 'undefined' && currentNote && typeof getAiState === 'function') {
      const state = getAiState(currentNote);
      if (state && Array.isArray(state.proposalCards)) {
        const card = state.proposalCards[target];
        if (card) {
          if (!Array.isArray(state.proposalStates)) state.proposalStates = [];
          state.proposalStates[target] = 'applied';
          if (typeof AIChatController !== 'undefined' && typeof AIChatController.executeSuggestion === 'function') {
            AIChatController.executeSuggestion(card);
          }
        }
      }
    }
  }
};

window.rejectInlineProposal = function(target) {
  let wrapper = null;
  if (target && target.nodeType === 1) {
    wrapper = target.closest('.inline-proposal-wrapper, .inline-correction-wrapper');
  } else if (typeof target === 'string' || typeof target === 'number') {
    wrapper = document.querySelector(`.inline-correction-wrapper[data-card-index="${target}"], .inline-proposal-wrapper[data-card-index="${target}"]`);
  }

  if (wrapper) {
    rejectInlineCorrection(wrapper);
  } else if (typeof target === 'number' || typeof target === 'string') {
    if (typeof currentNote !== 'undefined' && currentNote && typeof getAiState === 'function') {
      const state = getAiState(currentNote);
      if (state && Array.isArray(state.proposalCards)) {
        if (!Array.isArray(state.proposalStates)) state.proposalStates = [];
        state.proposalStates[target] = 'dropped';
      }
    }
  }
};

window.applyInlineProposal = window.acceptInlineProposal;

// Delegate Accept/Reject button clicks inside the editor (using capture phase for robust click handling)
const handleInlineProposalButtonClick = (e) => {
  const btn = e.target && e.target.closest ? e.target.closest('.inline-hover-btn, .btn-accept, .btn-reject') : null;
  if (!btn) return;

  const wrapper = btn.closest('.inline-proposal-wrapper, .inline-correction-wrapper');
  if (!wrapper) return;

  e.preventDefault();
  e.stopPropagation();

  if (btn.classList.contains('btn-accept')) {
    acceptInlineCorrection(wrapper);
  } else if (btn.classList.contains('btn-reject')) {
    rejectInlineCorrection(wrapper);
  }
};

document.addEventListener('click', handleInlineProposalButtonClick, true);
document.addEventListener('mousedown', handleInlineProposalButtonClick, true);

// Cmd+Enter / Ctrl+Enter shortcut to accept inline line-level correction or proposal
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    let wrapper = null;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const container = sel.getRangeAt(0).commonAncestorContainer;
      const node = container && container.nodeType === 1 ? container : (container ? container.parentNode : null);
      wrapper = node ? node.closest('.inline-correction-wrapper, .inline-proposal-wrapper') : null;
    }
    if (!wrapper && document.activeElement) {
      wrapper = document.activeElement.closest('.inline-correction-wrapper, .inline-proposal-wrapper');
    }
    if (wrapper) {
      e.preventDefault();
      e.stopPropagation();
      acceptInlineCorrection(wrapper);
    }
  }
}, true);

window.generateNoteSummaryWithAI = generateNoteSummaryWithAI;
window._realGenerateNoteSummaryWithAI = generateNoteSummaryWithAI;

window.openNote = openNoteOverlay;
window._realCloseNoteOverlay = closeNoteOverlay;
window.openMathFormulaEditor = openMathFormulaEditor;

// ═══ Window-Level Drag & Drop Navigation Safety ═══
window.addEventListener('dragover', (e) => {
  e.preventDefault();
}, false);

window.addEventListener('drop', (e) => {
  // If drop occurred outside an explicit text editor or file drop area, prevent BrowserWindow from navigating
  if (!e.target || !(e.target.closest && e.target.closest('#edit-textarea, .dropzone, input[type="file"], .attachment-drop-area'))) {
    e.preventDefault();
  }
}, false);

// Hide floating table toolbars on window resize
window.addEventListener('resize', () => {
  if (typeof hideTableToolbar === 'function') hideTableToolbar();
  if (typeof hideResizeToolbar === 'function') hideResizeToolbar();
});

// ── ConflictResolverController ──
const ConflictResolverController = {
  activeConflict: null,

  onConflictDetected(conflict) {
    if (!conflict) return;
    if (typeof currentNote !== 'undefined' && currentNote) {
      const currentId = String(currentNote.id || currentNote.path || '').replace(/^notes\//, '').replace(/\.html$/, '');
      if (currentId === conflict.id) {
        this.showBanner();
      }
    }
  },

  checkActiveNoteConflict() {
    if (typeof currentNote === 'undefined' || !currentNote) {
      this.hideBanner();
      return;
    }
    const currentId = String(currentNote.id || currentNote.path || '').replace(/^notes\//, '').replace(/\.html$/, '');
    if (window.FirebaseSyncService?.hasConflict(currentId)) {
      this.showBanner();
    } else {
      this.hideBanner();
    }
  },

  showBanner() {
    const banner = document.getElementById('overlay-conflict-banner');
    if (banner) banner.style.display = 'flex';
  },

  hideBanner() {
    const banner = document.getElementById('overlay-conflict-banner');
    if (banner) banner.style.display = 'none';
  },

  dismissBanner() {
    this.hideBanner();
  },

  openModalForCurrentNote() {
    if (typeof currentNote === 'undefined' || !currentNote) return;
    const currentId = String(currentNote.id || currentNote.path || '').replace(/^notes\//, '').replace(/\.html$/, '');
    const conflict = window.FirebaseSyncService?.getConflict(currentId);
    if (conflict) {
      this.openModal(conflict);
    }
  },

  openModal(conflict) {
    if (!conflict) return;
    this.activeConflict = conflict;

    const modal = document.getElementById('modal-sync-conflict');
    if (!modal) return;

    // Local info
    const localMetaEl = document.getElementById('conflict-local-meta');
    const localPreviewEl = document.getElementById('conflict-local-preview');
    if (localMetaEl) {
      const localDate = conflict.localNote.updatedAt ? new Date(conflict.localNote.updatedAt).toLocaleString() : '';
      localMetaEl.textContent = localDate;
    }
    const safeSanitize = (raw) => {
      if (typeof sanitizeHtmlContent === 'function') {
        return sanitizeHtmlContent(raw);
      }
      if (typeof escH === 'function') {
        return `<pre style="white-space:pre-wrap;margin:0;font-family:inherit;">${escH(raw)}</pre>`;
      }
      const div = document.createElement('div');
      div.textContent = String(raw || '');
      return `<pre style="white-space:pre-wrap;margin:0;font-family:inherit;">${div.innerHTML}</pre>`;
    };

    const rawLocal = conflict.localNote.contentHtml || conflict.localNote.html || '<p><em>Empty</em></p>';
    if (localPreviewEl) {
      localPreviewEl.innerHTML = safeSanitize(rawLocal);
    }

    // Remote info
    const remoteMetaEl = document.getElementById('conflict-remote-meta');
    const remotePreviewEl = document.getElementById('conflict-remote-preview');
    if (remoteMetaEl) {
      const remoteDate = conflict.remoteNote.updatedAt ? new Date(conflict.remoteNote.updatedAt).toLocaleString() : '';
      remoteMetaEl.textContent = remoteDate;
    }
    const rawRemote = conflict.remoteNote.contentHtml || conflict.remoteNote.html || '<p><em>Empty</em></p>';
    if (remotePreviewEl) {
      remotePreviewEl.innerHTML = safeSanitize(rawRemote);
    }

    if (typeof openModal === 'function') {
      openModal('modal-sync-conflict');
    } else {
      modal.style.display = 'flex';
    }
  },

  async resolve(choice) {
    if (!this.activeConflict) return;
    const noteId = this.activeConflict.id;
    try {
      const res = await window.FirebaseSyncService.resolveConflict(noteId, choice);
      if (!res.resolved) {
        if (typeof toast === 'function') toast(res.error || 'Failed to resolve conflict', true);
        return;
      }

      this.hideBanner();
      if (typeof closeModal === 'function') {
        closeModal('modal-sync-conflict');
      } else {
        const modal = document.getElementById('modal-sync-conflict');
        if (modal) modal.style.display = 'none';
      }

      if (choice === 'keep_remote') {
        if (typeof reloadNoteFromDisk === 'function') {
          await reloadNoteFromDisk();
        }
      }

      if (choice === 'keep_both') {
        if (typeof renderNotesList === 'function') {
          renderNotesList();
        }
      }

      const toastMsg = (typeof t === 'function' ? t('sync.conflictResolvedToast') : null) || 'Conflict resolved! The unselected version has been saved to Note History.';
      if (typeof toast === 'function') toast(toastMsg);
    } catch (err) {
      console.error('Failed to resolve conflict', err);
      if (typeof toast === 'function') toast(err.message, true);
    }
  }
};
window.ConflictResolverController = ConflictResolverController;




