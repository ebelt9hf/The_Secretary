'use strict';

// ── Secretary: Retrospective & Analytics Mode ──

let selectedRetroDate = new Date();
window._lastScannedHighlights = [];
window._lastScannedVelocity = [];
window._lastScannedDebt = [];
window._lastRetroTimeStats = null;

// ── Helper Utilities ──

function retroHoursBetween(start, end) {
  const s = timeToMinutes(start || '00:00');
  const e = timeToMinutes(end || '00:00');
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return 0;
  return (e - s) / 60;
}

function retroCategorizeEvent(event) {
  const type = String(event?.type || '').toLowerCase();
  if (type === 'work' || type === 'deep') return 'deep';
  if (type === 'sync') return 'sync';
  if (type === 'call') return 'call';
  if (type === 'ooo') return 'ooo';
  return 'admin';
}

function retroComputeTimeAllocation(events) {
  const totals = { deep: 0, sync: 0, call: 0, ooo: 0, admin: 0 };
  (events || []).forEach(ev => {
    const bucket = retroCategorizeEvent(ev);
    totals[bucket] += retroHoursBetween(ev.startTime, ev.endTime);
  });
  const total = totals.deep + totals.sync + totals.call + totals.ooo + totals.admin;
  return { ...totals, total };
}

function getRetroWeekBounds(baseDate) {
  const d = new Date(baseDate);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const weekMonday = new Date(d.setDate(diff));

  const weekSunday = new Date(weekMonday);
  weekSunday.setDate(weekMonday.getDate() + 6);
  weekSunday.setHours(23, 59, 59, 999);

  // Calculate Thursday for ISO Year accuracy
  const targetThursday = new Date(weekMonday);
  targetThursday.setDate(weekMonday.getDate() + 3);
  const year = targetThursday.getFullYear();

  const target = new Date(weekMonday.valueOf());
  const dayNr = (weekMonday.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay() + 7) % 7));
  }
  const weekNumber = 1 + Math.ceil((firstThursday - target) / 604800000);

  const locale = getAppLocale();
  const options = { day: 'numeric', month: 'long' };
  const startStr = new Intl.DateTimeFormat(locale, options).format(weekMonday);
  const endStr = new Intl.DateTimeFormat(locale, options).format(weekSunday);

  const weekStr = `${year}-W${String(weekNumber).padStart(2, '0')}`;
  const rangeLabel = t('retro.rangeLabel', { start: startStr, end: endStr }) || `Week of ${startStr} to ${endStr}`;
  const sundayDateStr = formatLocalDateValue(weekSunday);

  return { weekMonday, weekSunday, weekNumber, year, weekStr, startStr, endStr, rangeLabel, sundayDateStr };
}

function getPriorityBadgeClass(priority) {
  const p = String(priority || '').toLowerCase();
  if (p === 'p0' || p === 'urgent' || p === 'high') return 'sl-badge sl-badge-high';
  if (p === 'p1' || p === 'medium' || p === 'normal' || p === 'med') return 'sl-badge sl-badge-med';
  if (p === 'p2' || p === 'wip') return 'sl-badge sl-badge-wip';
  if (p === 'p3' || p === 'low') return 'sl-badge sl-badge-low';
  if (p === 'done') return 'sl-badge sl-badge-done';
  return 'sl-badge sl-badge-med';
}

async function scanWeekHighlights(notesThisWeek) {
  const highlights = [];
  let count = 0;

  for (const n of notesThisWeek) {
    try {
      const html = await StorageAPI.readNoteContent(n.path);
      const parsed = parseNoteHTML(html);
      const doc = new DOMParser().parseFromString(html || '', 'text/html');

      // Remove non-content elements before scanning
      doc.querySelectorAll('header, nav, script, style').forEach(el => el.remove());

      const items = [];
      const markElements = Array.from(doc.querySelectorAll('mark, .note-highlight'));
      markElements.forEach(m => {
        if (m.parentElement && m.parentElement.closest('mark, .note-highlight')) return;

        const lis = m.querySelectorAll('li');
        if (lis.length > 0) {
          const listItems = Array.from(lis).map(li => li.textContent.trim()).filter(Boolean);
          if (listItems.length > 0) {
            items.push({ type: 'mark-list', items: listItems, text: m.textContent.trim() });
          }
        } else {
          const text = m.textContent.trim();
          if (text) items.push({ type: 'mark', text });
        }
      });

      const textContent = doc.body ? (doc.body.textContent || '') : '';
      textContent.split('\n').forEach(line => {
        if (line.toLowerCase().includes('#important')) {
          const cleanLine = line.replace(/#important/gi, '').replace(/^[\s*\-\+\[\]\d\.]*(?:\[[ xX]\])?\s*/, '').trim();
          if (cleanLine) items.push({ type: 'important', text: cleanLine });
        }
      });

      if (items.length > 0) {
        highlights.push({
          noteTitle: n.title || parsed.title || n.path.split('/').pop().replace('.html', ''),
          notePath: n.path,
          date: n.date,
          items
        });
        count += items.length;
      }
    } catch(e) {
      console.warn('Failed to scan note for highlights', n.path, e);
    }
  }

  return { highlights, count };
}

function renderRetroColumn({ id, title, icon, badgeCount = 0, emptyText = '', contentHtml = '', isGrid = false }) {
  const listStyle = isGrid
    ? 'display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 0.8rem;'
    : 'display: flex; flex-direction: column; gap: 0.8rem; overflow-y: auto; max-height: 800px; padding-right: 4px;';

  const bodyContent = contentHtml
    ? `<div class="retro-list" style="${listStyle}">${contentHtml}</div>`
    : `<div style="color:var(--text-muted); font-size:0.88rem; text-align:center; padding:2rem;">${escH(emptyText)}</div>`;

  return `
    <div class="retro-col-header">
      <h3 class="retro-col-title">${icon} ${escH(title)}</h3>
      <span class="retro-col-badge" id="badge-${id}">${badgeCount}</span>
    </div>
    ${bodyContent}
  `;
}

// ── Action Handlers ──

window.renderRetroPanel = renderRetroPanel;
window.navigateRetroWeek = function(offset) {
  if (offset === 0) {
    selectedRetroDate = new Date();
  } else {
    const nextDate = new Date(selectedRetroDate);
    nextDate.setDate(selectedRetroDate.getDate() + offset);
    selectedRetroDate = nextDate;
  }
  renderRetroPanel({ isWeekNavigation: true });
};

window.freezeRetroAction = async function(year, week, startStr, endStr, sundayDateStr) {
  const weekStr = `${year}-W${String(week).padStart(2, '0')}`;
  const existingPath = `notes/retro-${weekStr}.html`;
  const noteId = `retro-${weekStr}`;

  const alreadyExists = (typeof manifest !== 'undefined' && Array.isArray(manifest))
    ? manifest.some(n => n.id === noteId || n.path === existingPath)
    : false;

  const confirmMsg = alreadyExists
    ? (t('retro.freezeConfirmReplace', { week: weekStr }) || `A retrospective note already exists for week ${weekStr}. Replace it?`)
    : (t('retro.freezeConfirmNew', { week: weekStr }) || `Do you want to freeze the retrospective for week ${weekStr}?`);

  if (typeof showConfirmModal === 'function') {
    const ok = await showConfirmModal({
      title: t('retro.freezeConfirmLabel') || 'Freeze',
      message: confirmMsg,
      confirmText: t('retro.freezeConfirmLabel') || 'Freeze',
      cancelText: t('common.cancel') || 'Cancel'
    });
    if (!ok) return;
  } else if (!window.confirm(confirmMsg)) {
    return;
  }

  const rangeLabel = t('retro.rangeLabel', { start: startStr, end: endStr }) || `Week of ${startStr} to ${endStr}`;
  const cleanTabRetro = (t('topbar.retro') || 'Retrospective').replace('📊', '').trim();
  const downloadFilename = sanitizeFilename(`${cleanTabRetro} - ${rangeLabel}`) + '.md';

  let fileHandle = null;
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      fileHandle = await window.showSaveFilePicker({
        suggestedName: downloadFilename,
        types: [{ description: 'Markdown Files', accept: { 'text/markdown': ['.md'] } }]
      });
    } catch (err) {
      console.log('Save picker cancelled by user:', err);
      return;
    }
  }

  let md = '';
  let note = null;

  const steps = [
    {
      label: t('retro.progressScanning') || 'Scanning notes and velocity...',
      percentage: 35,
      duration: 400,
      action: async () => {}
    },
    {
      label: t('retro.progressGenerating') || 'Generating Markdown report...',
      percentage: 70,
      duration: 450,
      action: async () => {
        md = (t('retro.reportTitle', { week: weekStr, start: startStr, end: endStr }) || `# Retrospective - Week ${weekStr} (${startStr} to ${endStr})`) + '\n\n';

        const stats = window._lastRetroTimeStats || { allocation: { deep: 0, sync: 0, call: 0, ooo: 0, admin: 0, total: 0 }, focusRate: 0, interruptionIndex: 0, stashEntriesWeek: 0 };
        md += `## ${t('retro.reportTimeAllocation') || 'Time Allocation'}\n`;
        md += `- ${t('retro.deepWorkLabel') || 'Deep Work'}: ${stats.allocation.deep.toFixed(1)}h\n`;
        md += `- ${t('retro.syncLabel') || 'Sync'}: ${stats.allocation.sync.toFixed(1)}h\n`;
        md += `- ${t('retro.callLabel') || 'Call/Meeting'}: ${stats.allocation.call.toFixed(1)}h\n`;
        md += `- ${t('retro.oooLabel') || 'OOO'}: ${stats.allocation.ooo.toFixed(1)}h\n`;
        md += `- ${t('retro.adminLabel') || 'Admin'}: ${stats.allocation.admin.toFixed(1)}h\n`;
        md += `- Total: ${stats.allocation.total.toFixed(1)}h\n\n`;

        md += `## ${t('retro.reportDerivedMetrics') || 'Derived Metrics'}\n`;
        md += `- ${t('retro.focusRate') || 'Focus Rate'}: ${stats.focusRate.toFixed(1)}%\n`;
        md += `- ${t('retro.interruptionIndex') || 'Interruption Index'}: ${stats.allocation.deep > 0 ? stats.interruptionIndex.toFixed(2) : 'n/a'}\n`;
        md += `- ${t('retro.stashEntries') || 'Stash Entries (week)'}: ${stats.stashEntriesWeek}\n\n`;

        md += `## ${t('retro.reportHighlights') || 'Highlights'}\n`;
        const activeHighlights = window._lastScannedHighlights || [];
        if (activeHighlights.length === 0) {
          md += `${t('retro.noHighlights') || 'No highlights for this week.'}\n\n`;
        } else {
          activeHighlights.forEach(h => {
            md += `### ${h.noteTitle} (${h.date})\n`;
            h.items.forEach(item => {
              if (item.type === 'mark-list') {
                item.items.forEach(sub => {
                  md += `  - ==${sub}==\n`;
                });
              } else if (item.type === 'mark') {
                md += `- ==${item.text}==\n`;
              } else {
                md += `- ⚠️ ${item.text}\n`;
              }
            });
            md += `\n`;
          });
        }

        md += `## ${t('retro.reportSummaries') || 'Daily Summaries'}\n`;
        const weekSunday = new Date(sundayDateStr + 'T23:59:59.999');
        const weekMonday = new Date(weekSunday);
        weekMonday.setDate(weekSunday.getDate() - 6);
        weekMonday.setHours(0, 0, 0, 0);

        const dailySummariesThisWeek = manifest.filter(n => {
          if (!n.date || !(n.major_topic_tags || []).includes("Daily Summary")) return false;
          const noteDate = new Date(n.date + 'T00:00:00');
          return noteDate >= weekMonday && noteDate <= weekSunday;
        });

        const dayNames = t('week.dayNames') || ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        let summariesReport = '';

        for (let i = 0; i < 7; i++) {
          const colDate = new Date(weekMonday);
          colDate.setDate(weekMonday.getDate() + i);
          const colDateStr = formatLocalDateValue(colDate);
          const jsDay = colDate.getDay();
          const isWorkingDay = (window.settings?.ui?.workingDays || [1, 2, 3, 4, 5]).includes(jsDay);
          const summaryNote = dailySummariesThisWeek.find(n => n.date === colDateStr);
          const hasBlockSchedule = plannerEvents.some(ev => ev.date === colDateStr);

          if (!isWorkingDay && !hasBlockSchedule) continue;

          const dayName = dayNames[jsDay === 0 ? 6 : jsDay - 1] || '';
          if (summaryNote) {
            summariesReport += `### ${dayName} (${summaryNote.date}) - ${summaryNote.title}\n`;
            try {
              const html = await StorageAPI.readNoteContent(summaryNote.path);
              const text = new DOMParser().parseFromString(parseNoteHTML(html).mainHTML || '', 'text/html').body.textContent || '';
              summariesReport += `${text.trim()}\n\n`;
            } catch (err) {
              summariesReport += `*Error reading summary: ${err.message}*\n\n`;
            }
          } else {
            summariesReport += `### ${dayName} (${colDateStr})\n*${t('retro.noSummaries') || 'No daily summary.'}*\n\n`;
          }
        }
        md += summariesReport || `*${t('retro.noSummaries') || 'No daily summaries for this week.'}*\n\n`;

        md += `## ${t('retro.reportVelocity') || 'Velocity'}\n`;
        const activeVelocity = window._lastScannedVelocity || [];
        if (activeVelocity.length === 0) {
          md += `${t('retro.noVelocity') || 'No tasks completed this week.'}\n`;
        } else {
          activeVelocity.forEach(todo => { md += `- [x] ${todo.title} (${todo.priority})\n`; });
        }

        md += `\n## ${t('retro.reportDebt') || 'Debt'}\n`;
        const activeDebt = window._lastScannedDebt || [];
        if (activeDebt.length === 0) {
          md += `${t('retro.noDebt') || 'No active debt.'}\n`;
        } else {
          activeDebt.forEach(todo => { md += `- [ ] ${todo.title} (${t('todo.priority') || 'Priority'}: ${todo.priority})\n`; });
        }

        const defaultTitle = t('retro.defaultNoteTitle', { week: weekStr }) || `Retrospective - Week ${weekStr}`;
        note = {
          id: noteId,
          path: existingPath,
          title: defaultTitle,
          date: sundayDateStr,
          group_tags: ['Retrospective'],
          major_topic_tags: [],
          topic_tags: [],
          extra_tags: [],
          mainHTML: mdToPreviewHTML(md)
        };
      }
    },
    {
      label: t('retro.progressSaving') || 'Saving retrospective note...',
      percentage: 100,
      duration: 400,
      action: async () => {
        if (!note) return;
        const html = buildNewNoteHTML(note);
        await StorageAPI.writeNoteContent(existingPath, html);
        upsertManifest(note);
        await saveManifest();
        await rebuildIndexHTML();

        if (fileHandle) {
          try {
            const writable = await fileHandle.createWritable();
            await writable.write(md);
            await writable.close();
          } catch (err) {
            console.error('Failed to write file handle:', err);
            toast(t('retro.writeMarkdownError') || 'Error while writing the Markdown file.', true);
          }
        } else {
          downloadTextFile(downloadFilename, md);
        }
      }
    }
  ];

  try {
    await showProgressDialog(t('retro.progressTitle') || 'Freeze Retrospective', steps);
    toast(t('common.noteSaved') || 'Retrospective frozen successfully!');
    if (typeof renderBoard === 'function') renderBoard();
  } catch(e) {
    toast((t('common.saveFailed', { message: e.message }) || 'Error while saving: ' + e.message), true);
  }
};

// ── Re-entrancy Guard & Main Render Function ──

let _retroRenderInProgress = false;
let _retroRenderPending = false;

async function renderRetroPanel(options = {}) {
  if (_retroRenderInProgress) {
    _retroRenderPending = true;
    return;
  }

  const panel = document.getElementById('retro-panel');
  if (!panel) return;

  _retroRenderInProgress = true;
  _retroRenderPending = false;

  const currentRenderTargetDateStr = selectedRetroDate.toISOString();

  const isWeekNav = !!options.isWeekNavigation;
  const savedPanelScrollTop = isWeekNav ? 0 : panel.scrollTop;
  const savedColScrollTops = {};
  if (!isWeekNav) {
    ['velocity', 'debt'].forEach(id => {
      const el = panel.querySelector(`#retro-col-${id} .retro-list`);
      if (el) savedColScrollTops[id] = el.scrollTop;
    });
  }

  try {
    const { weekMonday, weekSunday, weekNumber, year, weekStr, startStr, endStr, rangeLabel } = getRetroWeekBounds(selectedRetroDate);

    const isSameWeekRender = panel.dataset.renderedWeek === weekStr && panel.querySelector('.retro-header') && !isWeekNav;

    if (!isSameWeekRender) {
      panel.dataset.renderedWeek = weekStr;
      // Initial Skeleton Render
      panel.innerHTML = `
        <div class="retro-header">
          <div class="retro-title-row">
            <h2 class="retro-title">${t('topbar.retro')}</h2>
            <div class="retro-week-title">${rangeLabel} (${weekStr})</div>
          </div>
          <div class="retro-nav-group">
            <button class="retro-nav-btn" onclick="navigateRetroWeek(-7)" title="${escA(t('retro.prevWeekTooltip'))}">${t('retro.prevWeek')}</button>
            <button class="retro-nav-btn" onclick="navigateRetroWeek(0)" title="${escA(t('retro.todayTooltip'))}">${t('retro.today')}</button>
            <button class="retro-nav-btn" onclick="navigateRetroWeek(7)" title="${escA(t('retro.nextWeekTooltip'))}">${t('retro.nextWeek')}</button>
            <button class="retro-nav-btn primary" onclick="freezeRetroAction('${year}', '${weekNumber}', '${escA(startStr)}', '${escA(endStr)}', '${formatLocalDateValue(weekSunday)}')" title="${escA(t('retro.freezeTooltip'))}">${t('retro.freeze')}</button>
          </div>
        </div>

        <!-- Combined Tageszusammenfassungen & Checklist Section -->
        <div class="retro-summaries-section" id="retro-summaries-section">
          <!-- 1. Tageszusammenfassung Header -->
          <div class="retro-summaries-header">
            <div style="display:flex; align-items:center; gap:0.6rem;">
              <span style="font-size:1.2rem;">📝</span>
              <h3 class="retro-col-title">${escH(t('retro.columnSummaries') || 'Daily Summaries')}</h3>
              <span class="retro-col-badge" id="badge-summaries">0</span>
            </div>
            <div id="retro-checklist-trophy" style="display:none; font-size:1.2rem; cursor:help;">🏆</div>
          </div>

          <!-- 2. Thin Barplot on Complete Width -->
          <div class="retro-allocation-bar-container">
            <div class="retro-stack-bar thin" id="retro-stack-bar" title="${escA(t('retro.timeAllocationTooltip') || 'Distribution of time spent across different activity categories this week.')}">
              <div class="retro-stack-seg deep" style="width:25%" title="${escA(t('retro.deepWorkDesc'))}"></div>
              <div class="retro-stack-seg sync" style="width:25%" title="${escA(t('retro.syncDesc'))}"></div>
              <div class="retro-stack-seg call" style="width:25%" title="${escA(t('retro.callDesc'))}"></div>
              <div class="retro-stack-seg admin" style="width:25%" title="${escA(t('retro.adminDesc'))}"></div>
            </div>
            <div class="retro-stack-legend thin-legend" id="retro-stack-legend"></div>
          </div>

          <!-- 3. Workdays with Summaries on Complete Width -->
          <div class="retro-workdays-list" id="retro-workdays-list">
            <div style="text-align:center; padding:2rem; color:var(--text-muted);" class="retro-loading">${escH(t('retro.scanProgress') || 'Loading...')}</div>
          </div>
        </div>

        <!-- 4. Bottom Grid: Debt (1/2) and Velocity (1/2) -->
        <div class="retro-bottom-grid">
          <div class="retro-col" id="retro-col-debt">
            ${renderRetroColumn({ id: 'debt', title: t('retro.columnDebt') || 'Debt', icon: '⚠️', emptyText: t('retro.loadDebtProgress') || 'Loading...', isGrid: true })}
          </div>
          <div class="retro-col" id="retro-col-velocity">
            ${renderRetroColumn({ id: 'velocity', title: t('retro.columnVelocity') || 'Velocity', icon: '⚡', emptyText: t('retro.loadCompletedProgress') || 'Loading...' })}
          </div>
        </div>
      `;
    }

    // 1. Async Highlight Scan
    const notesThisWeek = manifest.filter(n => n.date && new Date(n.date + 'T00:00:00') >= weekMonday && new Date(n.date + 'T00:00:00') <= weekSunday);
    const { highlights, count: highlightsCount } = await scanWeekHighlights(notesThisWeek);

    // 2. Compute Velocity & Debt
    const completedTodos = todosManifest.filter(todo => {
      if (todo.priority !== 'Done' || !todo.modified) return false;
      const modDate = new Date(todo.modified + 'T00:00:00');
      return modDate >= weekMonday && modDate <= weekSunday;
    });

    const scheduledThisWeek = plannerEvents.filter(e => {
      if (!e.date) return false;
      return weekSunday >= new Date(e.date + 'T00:00:00') && weekMonday <= new Date((e.endDate || e.date) + 'T23:59:59');
    });

    const debtTodos = [];
    const seenTodoIds = new Set();
    plannerEvents.filter(e => e.date && new Date(e.date + 'T00:00:00') <= weekSunday).forEach(e => {
      if (e.todoId && !seenTodoIds.has(e.todoId)) {
        seenTodoIds.add(e.todoId);
        const todo = todosManifest.find(tItem => tItem.id === e.todoId);
        if (todo && todo.priority !== 'Done') debtTodos.push(todo);
      }
    });

    todosManifest.forEach(todo => {
      if (todo.priority !== 'Done' && !seenTodoIds.has(todo.id)) {
        const createdDate = todo.created ? new Date(todo.created + 'T00:00:00') : null;
        if (!createdDate || createdDate <= weekSunday) {
          seenTodoIds.add(todo.id);
          debtTodos.push(todo);
        }
      }
    });

    // 3. Compute Metrics
    const allocation = retroComputeTimeAllocation(scheduledThisWeek);
    let stashEntriesWeek = 0;
    try {
      const stashItems = await StashService.list();
      stashEntriesWeek = stashItems.filter(item => new Date(item.created) >= weekMonday && new Date(item.created) <= weekSunday).length;
    } catch (e) {
      console.warn('Weekly stash count error', e);
    }

    const focusRate = allocation.total > 0 ? (allocation.deep / allocation.total) * 100 : 0;
    const interruptionIndex = allocation.deep > 0 ? (stashEntriesWeek / allocation.deep) : 0;
    window._lastRetroTimeStats = { allocation, stashEntriesWeek, focusRate, interruptionIndex };
    window._lastScannedHighlights = highlights;
    window._lastScannedVelocity = completedTodos;
    window._lastScannedDebt = debtTodos;

    // 4. Update Time Allocation Bar & Legend
    const stackBar = document.getElementById('retro-stack-bar');
    if (stackBar && allocation.total > 0) {
      stackBar.innerHTML = ['deep', 'sync', 'call', 'ooo', 'admin']
        .filter(cat => allocation[cat] > 0)
        .map(cat => `<div class="retro-stack-seg ${cat}" style="width:${((allocation[cat] / allocation.total) * 100).toFixed(2)}%" title="${escA(t(`retro.${cat}Label`) || t(`retro.${cat}WorkLabel`) || cat)}: ${allocation[cat].toFixed(1)}h"></div>`)
        .join('');
    }

    const legend = document.getElementById('retro-stack-legend');
    if (legend && allocation.total > 0) {
      legend.innerHTML = ['deep', 'sync', 'call', 'ooo', 'admin']
        .filter(cat => allocation[cat] > 0)
        .map(cat => `<span class="retro-legend-item" title="${escA(t(`retro.${cat}Desc`) || t(`retro.${cat}WorkDesc`))}"><span class="retro-legend-dot ${cat}"></span>${escH(t(`retro.${cat}Label`) || cat)}: ${allocation[cat].toFixed(1)}h</span>`)
        .join('');
    }

    // 5. Render Combined Workdays Checklist & Summaries
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayNames = t('week.dayNames') || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    let allReviewed = true;
    let count = 0;
    let workdaysHtml = '';

    const dailySummariesThisWeek = manifest.filter(n => {
      if (!n.date) return false;
      const d = new Date(n.date + 'T00:00:00');
      if (d < weekMonday || d > weekSunday) return false;
      if (Array.isArray(n.major_topic_tags) && n.major_topic_tags.includes("Daily Summary")) return true;
      if (typeof isDailySummaryNote === 'function') return isDailySummaryNote(n);
      if (typeof n.title === 'string' && /^(Résumé quotidien|Daily Summary|Daily Review|Tagesrückblick|Denní přehled|Revisión diaria|Napi áttekintés|Revisione giornaliera|Dagelijkse review|Przegląd dzienny|Revizuire zilnică|Ежедневный обзор|Daglig genomgång|Günlük İnceleme|Щоденний огляд)\b/i.test(n.title)) return true;
      return false;
    });

    for (let i = 0; i < 7; i++) {
      const colDate = new Date(weekMonday);
      colDate.setDate(weekMonday.getDate() + i);
      const colDateStr = formatLocalDateValue(colDate);
      const isFuture = colDate > today;
      const isReviewed = isDailyReviewDateReviewed(colDateStr);
      const jsDay = colDate.getDay();
      const isWorkingDay = (window.settings?.ui?.workingDays || [1, 2, 3, 4, 5]).includes(jsDay);
      const summaryNote = dailySummariesThisWeek.find(n => n.date === colDateStr);

      const coveringOoo = (typeof getCoveringOooEvent === 'function')
        ? getCoveringOooEvent(colDateStr)
        : plannerEvents.find(ev => ev.type === 'ooo' && (ev.allDay || (!ev.startTime && !ev.endTime)) && colDateStr >= ev.date && colDateStr <= (ev.endDate || ev.date));
      const isOooDay = !!coveringOoo;

      if (!isReviewed && !isFuture && isWorkingDay && !isOooDay) allReviewed = false;

      // Skip weekend if not a working day and no planner events and no summary note
      if (!isWorkingDay && !summaryNote && !plannerEvents.some(ev => ev.date === colDateStr)) {
        continue;
      }

      const dayName = dayNames[jsDay === 0 ? 6 : jsDay - 1] || '';

      const dayEvents = plannerEvents.filter(ev => ev.date && colDateStr >= ev.date && colDateStr <= (ev.endDate || ev.date));
      const dayTotals = { deep: 0, sync: 0, call: 0, ooo: 0, admin: 0 };
      dayEvents.forEach(ev => { dayTotals[retroCategorizeEvent(ev)] += retroHoursBetween(ev.startTime, ev.endTime); });

      const plannedTotal = dayTotals.deep + dayTotals.sync + dayTotals.call + dayTotals.ooo + dayTotals.admin;
      const { availableMins } = (typeof _getDayCapacity === 'function' ? _getDayCapacity : () => ({ availableMins: 570 }))(colDateStr);
      const availableHours = availableMins / 60;
      const dayDenominator = Math.max(availableHours, plannedTotal);

      let dayStackedBarHtml = ['deep', 'sync', 'call', 'ooo', 'admin']
        .filter(cat => dayTotals[cat] > 0)
        .map(cat => `<div class="retro-day-bar-seg ${cat}" style="width:${((dayTotals[cat] / dayDenominator) * 100).toFixed(2)}%" title="${cat}: ${dayTotals[cat].toFixed(1)}h"></div>`)
        .join('');

      let completedCount = !isFuture ? todosManifest.filter(tItem => tItem.priority === 'Done' && tItem.modified === colDateStr).length : 0;

      let statsLabelHtml = isFuture
        ? `${t('retro.plannedLabel') || 'Planned'}: ${plannedTotal.toFixed(1)}h`
        : (coveringOoo ? `🏖️ ${escH(coveringOoo.title || t('retro.oooLabel') || 'OOO')}` : `${completedCount} ${getAppLanguage() === 'fr' ? 'tâche' + (completedCount !== 1 ? 's' : '') : 'task' + (completedCount !== 1 ? 's' : '')}`);

      let cellCls = `planner-header-cell retro-day-cell${isFuture ? ' future-day' : (isOooDay ? ' ooo-day' : ' reviewable')}${colDateStr === formatLocalDateValue(today) ? ' today' : ''}${isReviewed ? ' reviewed' : ''}${isOooDay ? ' is-ooo' : ''}`;
      let clickAttr = (!isFuture && !isOooDay)
        ? `onclick="window.startDailyReview('${colDateStr}')"`
        : (isOooDay && coveringOoo?.id ? `onclick="event.stopPropagation(); if (typeof selectPlannerEvent === 'function') selectPlannerEvent(${typeof jq === 'function' ? jq(coveringOoo.id) : JSON.stringify(coveringOoo.id).replace(/"/g, '&quot;')});"` : '');
      let tooltipAttr = isOooDay
        ? `title="${escA(t('retro.oooAutoReviewedTooltip') || 'Out of Office: automatically reviewed, no review needed')}"`
        : `title="${escA(t(isFuture ? 'retro.futureDayTooltip' : (isReviewed ? 'retro.reopenReviewTooltip' : 'retro.reviewDayTooltip')))}"`;

      const dayCellHtml = `
        <div class="${cellCls}" ${clickAttr} ${tooltipAttr}>
          ${(isReviewed || !isFuture) ? `<span class="planner-header-reviewed" title="${isReviewed ? 'Reviewed' : 'Review'}">✓</span>` : ''}
          <span class="planner-header-day">${escH(dayName)}</span>
          <span class="planner-header-date">${colDate.getDate()}</span>
          <div class="retro-day-stacked-bar">${dayStackedBarHtml || `<div class="retro-day-bar-seg unplanned" style="width:100%"></div>`}</div>
          <div class="retro-day-stats-label">${statsLabelHtml}</div>
        </div>
      `;

      let summaryContentHtml = '';
      if (summaryNote) {
        count++;
        let noteFullHtml = '';
        try {
          const raw = (typeof StorageAPI !== 'undefined' && StorageAPI.getNoteFromCache && StorageAPI.getNoteFromCache(summaryNote.path))
            || (typeof StorageAPI !== 'undefined' && StorageAPI.readNoteContent ? await StorageAPI.readNoteContent(summaryNote.path) : '');
          if (raw) {
            if (typeof parseNoteHTML === 'function') {
              const parsed = parseNoteHTML(raw);
              noteFullHtml = parsed.mainHTML || parsed.html || raw;
            } else {
              noteFullHtml = raw;
            }
          }
        } catch (e) {
          console.warn('Failed to read note HTML for daily summary', e);
        }
        if (!noteFullHtml) {
          noteFullHtml = summaryNote.preview || summaryNote.summary || `<p><em>${escH(t('retro.noSummaries') || 'No daily summary.')}</em></p>`;
        }

        summaryContentHtml = `
          <div class="retro-day-summary-card has-note" data-note-path="${escA(summaryNote.path)}" data-note-id="${escA(summaryNote.id || '')}" data-date="${escA(colDateStr)}">
            <div class="retro-day-summary-top">
              <div class="retro-day-summary-title-row" onclick="openNoteOverlay('${escA(summaryNote.path)}')" title="${escA(t('editor.openNoteTooltip') || 'Open note')}">
                <span class="retro-day-summary-icon">📄</span>
                <strong class="retro-day-summary-title">${escH(summaryNote.title || dayName)}</strong>
                <span class="retro-day-summary-date">${summaryNote.date}</span>
              </div>
              <button class="retro-open-note-btn" onclick="openNoteOverlay('${escA(summaryNote.path)}')" title="${escA(t('editor.openNoteTooltip') || 'Open note')}">
                ${t('common.open') || 'Open'} ↗
              </button>
            </div>
            <div class="retro-summary-full-html note-content prose" data-note-path="${escA(summaryNote.path)}" data-note-id="${escA(summaryNote.id || '')}" data-date="${escA(colDateStr)}">
              ${noteFullHtml}
            </div>
          </div>
        `;
      } else if (isOooDay) {
        summaryContentHtml = `
          <div class="retro-day-summary-card is-ooo" title="${escA(t('retro.oooAutoReviewedTooltip') || 'Out of Office: automatically reviewed, no review needed')}">
            <div class="retro-ooo-summary-content">
              <div class="retro-ooo-badge-row">
                <span class="retro-ooo-icon">🏖️</span>
                <strong class="retro-ooo-title">${escH(coveringOoo.title || t('planner.ooo') || 'Out of Office')}</strong>
                <span class="retro-ooo-chip">${escH(t('retro.oooAutoReviewedBadge') || 'Auto-reviewed')}</span>
              </div>
              <div class="retro-ooo-desc">${escH(t('retro.oooNoReviewNeeded') || 'No daily review or agent synthesis needed for absence days.')}</div>
            </div>
          </div>
        `;
      } else {
        summaryContentHtml = `
          <div class="retro-day-summary-card no-note">
            <div class="retro-day-summary-empty-inner">
              <div style="font-size:0.88rem; color:var(--text-muted); font-style:italic;">
                ${t('retro.noSummaries') || 'No daily summary.'}
              </div>
              ${!isFuture ? `
                <button class="retro-start-day-review-btn" onclick="window.startDailyReview('${colDateStr}')" title="${escA(t('retro.startReviewTooltip') || t('retro.reviewDayTooltip'))}">
                  ${t('retro.startDayReview') || 'Start Daily Review'}
                </button>
              ` : ''}
            </div>
          </div>
        `;
      }

      workdaysHtml += `
        <div class="retro-day-summary-row${(isOooDay && !summaryNote) ? ' is-ooo' : ''}">
          <div class="retro-day-summary-col-left">
            ${dayCellHtml}
          </div>
          <div class="retro-day-summary-col-right">
            ${summaryContentHtml}
          </div>
        </div>
      `;
    }

    const workdaysListEl = document.getElementById('retro-workdays-list');
    if (workdaysListEl) {
      workdaysListEl.innerHTML = workdaysHtml || `<div style="text-align:center; padding:2rem; color:var(--text-muted); font-style:italic;">${escH(t('retro.noSummaries') || 'No daily summaries for this week.')}</div>`;
      if (typeof attachRetroDailyReviewNoteChangeListener === 'function') {
        attachRetroDailyReviewNoteChangeListener();
      }
    }

    const summariesBadge = document.getElementById('badge-summaries');
    if (summariesBadge) {
      summariesBadge.textContent = count;
    }

    const trophyEl = document.getElementById('retro-checklist-trophy');
    if (trophyEl) {
      if (allReviewed) {
        trophyEl.style.display = 'block';
        trophyEl.title = escA(t('retro.weekFullyReviewedTooltip', { completed: completedTodos.length, deep: allocation.deep.toFixed(1), rate: focusRate.toFixed(1) }));
      } else {
        trophyEl.style.display = 'none';
      }
    }

    // Guard against race conditions
    if (_retroRenderPending || selectedRetroDate.toISOString() !== currentRenderTargetDateStr) return;

    // 6. Update Debt and Velocity Columns
    const colVelocity = document.getElementById('retro-col-velocity');
    const colDebt = document.getElementById('retro-col-debt');

    // Velocity Column
    if (colVelocity) {
      const qColorMap = { Q1: '#ef4444', Q2: '#f59e0b', Q3: '#6366f1', Q4: '#14b8a6' };
      let velocityHtml = completedTodos.map(todo => {
        const q = typeof getTodoQuadrant === 'function' ? getTodoQuadrant(todo) : 'Q2';
        const qBg = qColorMap[q] || '#f59e0b';
        return `
        <div class="retro-item-card" onclick="openTodoOverlay('${escA(todo.id)}')" title="${escA(t('common.clickToOpenTodo') || 'Open todo')}">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong style="color:var(--text);">${todo.isHighPriority ? '★ ' : ''}${escH(todo.title)}</strong>
            <span style="font-size:0.7rem; padding:1px 5px; border-radius:3px; background:color-mix(in srgb, ${qBg} 15%, var(--card-bg)); color:${qBg}; border:1px solid color-mix(in srgb, ${qBg} 40%, transparent); font-weight:700;">${escH(q)} (${escH(todo.priority)})</span>
          </div>
          <div class="retro-item-meta">${t('retro.completedOn') || 'Completed on'} ${escH(todo.modified)}</div>
        </div>
      `;
      }).join('');
      colVelocity.innerHTML = renderRetroColumn({ id: 'velocity', title: t('retro.columnVelocity') || 'Velocity', icon: '⚡', badgeCount: completedTodos.length, emptyText: t('retro.noVelocity') || 'No tasks completed this week.', contentHtml: velocityHtml });
      if (savedColScrollTops.velocity) {
        const listEl = colVelocity.querySelector('.retro-list');
        if (listEl) listEl.scrollTop = savedColScrollTops.velocity;
      }
    }

    // Debt Column
    if (colDebt) {
      const qColorMap = { Q1: '#ef4444', Q2: '#f59e0b', Q3: '#6366f1', Q4: '#14b8a6' };
      let debtHtml = debtTodos.map(todo => {
        const q = typeof getTodoQuadrant === 'function' ? getTodoQuadrant(todo) : 'Q2';
        const qBg = qColorMap[q] || '#f59e0b';
        const commStatus = todo.assignmentStatus === 'pending_communication' ? ' 💬 Pending Comm' : '';
        return `
        <div class="retro-item-card" onclick="openTodoOverlay('${escA(todo.id)}')" title="${escA(t('common.clickToOpenTodo') || 'Open todo')}">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong style="color:var(--text);">${todo.isHighPriority ? '★ ' : ''}${escH(todo.title)}</strong>
            <span style="font-size:0.7rem; padding:1px 5px; border-radius:3px; background:color-mix(in srgb, ${qBg} 15%, var(--card-bg)); color:${qBg}; border:1px solid color-mix(in srgb, ${qBg} 40%, transparent); font-weight:700;">${escH(q)} (${escH(todo.priority)})</span>
          </div>
          <div class="retro-item-meta">${t('retro.owner') || 'Owner'}: ${escH(todo.owner || t('retro.notAssigned') || 'Not assigned')}${escH(commStatus)}</div>
        </div>
      `;
      }).join('');
      colDebt.innerHTML = renderRetroColumn({ id: 'debt', title: t('retro.columnDebt') || 'Debt', icon: '⚠️', badgeCount: debtTodos.length, emptyText: t('retro.noDebt') || 'No active debt.', contentHtml: debtHtml, isGrid: true });
      if (savedColScrollTops.debt) {
        const listEl = colDebt.querySelector('.retro-list');
        if (listEl) listEl.scrollTop = savedColScrollTops.debt;
      }
    }

    if (!isWeekNav && savedPanelScrollTop > 0) {
      panel.scrollTop = savedPanelScrollTop;
      requestAnimationFrame(() => {
        if (panel && savedPanelScrollTop > 0) panel.scrollTop = savedPanelScrollTop;
      });
    }

  } finally {
    _retroRenderInProgress = false;
    if (_retroRenderPending) renderRetroPanel();
  }
}

// ── Secretary: Daily Review Adaptive Time Tracker & End-Of-Day Notification ──

window.DailyReviewTimeTracker = {
  STORAGE_KEY: 'secretary_daily_review_time_history',

  getHistory() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_e) {
      return [];
    }
  },

  recordSession(dateStr, durationMinutes, noteCount) {
    if (typeof durationMinutes !== 'number' || durationMinutes <= 0 || !Number.isFinite(durationMinutes)) return;
    const history = this.getHistory();
    const cleanNoteCount = Math.max(0, parseInt(noteCount, 10) || 0);
    const timePerNote = cleanNoteCount > 0 ? (durationMinutes / cleanNoteCount) : durationMinutes;

    const existingIndex = history.findIndex(h => h.date === dateStr);
    const entry = {
      date: dateStr,
      durationMinutes: parseFloat(durationMinutes.toFixed(2)),
      noteCount: cleanNoteCount,
      timePerNote: parseFloat(timePerNote.toFixed(2)),
      timestamp: Date.now()
    };

    if (existingIndex >= 0) {
      history[existingIndex] = entry;
    } else {
      history.push(entry);
    }

    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(history.slice(-50)));
    } catch (_e) {}

    if (typeof window.updateRetroFlashAndHoverState === 'function') {
      window.updateRetroFlashAndHoverState();
    }
  },

  getEstimate(todayNoteCount = 0) {
    const rawHistory = this.getHistory();
    if (!rawHistory || rawHistory.length < 3) {
      return null;
    }

    // Filter valid positive entries
    let validEntries = rawHistory.filter(e => typeof e.durationMinutes === 'number' && e.durationMinutes >= 0.2);

    // Outlier removal when enough data points exist:
    // If the user takes more than 30 minutes, he was probably doing something else when he started,
    // so remove outliers when there are enough data points (e.g. >= 4 entries with at least 3 <= 30 mins).
    const countUnder30 = validEntries.filter(e => e.durationMinutes <= 30).length;
    if (validEntries.length >= 4 && countUnder30 >= 3) {
      validEntries = validEntries.filter(e => e.durationMinutes <= 30);
    }

    if (validEntries.length < 3) {
      return null;
    }

    // Check variance of time rate per note
    const rates = validEntries.map(e => {
      const n = Math.max(1, e.noteCount || 1);
      return e.durationMinutes / n;
    });

    const meanRate = rates.reduce((sum, val) => sum + val, 0) / rates.length;
    const variance = rates.reduce((sum, val) => sum + Math.pow(val - meanRate, 2), 0) / rates.length;
    const stdDev = Math.sqrt(variance);
    const cv = meanRate > 0 ? (stdDev / meanRate) : 0;

    // If variance is too extreme (e.g. CV > 1.25 and stdDev > 10 min), do not show estimate yet
    if (cv > 1.25 && stdDev > 10) {
      return null;
    }

    const notesCount = Math.max(0, parseInt(todayNoteCount, 10) || 0);
    let estimatedMinutes = 0;

    if (notesCount > 0) {
      // Divide total time by number of notes and adapt estimated time based on current notes count
      estimatedMinutes = Math.round(meanRate * notesCount);
      if (estimatedMinutes < 1) estimatedMinutes = 1;
    } else {
      const avgTotalDuration = validEntries.reduce((sum, e) => sum + e.durationMinutes, 0) / validEntries.length;
      const zeroNoteSessions = validEntries.filter(e => e.noteCount === 0);
      if (zeroNoteSessions.length > 0) {
        estimatedMinutes = Math.round(zeroNoteSessions.reduce((s, e) => s + e.durationMinutes, 0) / zeroNoteSessions.length);
      } else {
        estimatedMinutes = Math.max(1, Math.round(avgTotalDuration * 0.4));
      }
    }

    // User rule: "dont show the estimate if it is bigger than 30 minutes"
    if (estimatedMinutes > 30) {
      return null;
    }

    return {
      minutes: estimatedMinutes,
      sampleCount: validEntries.length,
      meanRate: parseFloat(meanRate.toFixed(2))
    };
  }
};

window.isEndOfDayReviewWindow = function() {
  // Do not show pulse while currently inside Daily Review
  if (typeof activeTab !== 'undefined' && activeTab === 'daily-review') {
    return false;
  }
  const drOverlay = document.getElementById('daily-review-overlay');
  if (drOverlay && drOverlay.style.display !== 'none' && window.DailyReviewController && DailyReviewController.currentStep > 0) {
    return false;
  }

  const now = new Date();
  const todayStr = formatLocalDateValue(now);
  if (typeof isDailyReviewDateReviewed === 'function' && isDailyReviewDateReviewed(todayStr)) {
    return false;
  }

  // Check working day vs note presence: on a non-working day without a note, do not show
  const workingDays = (window.settings?.ui?.workingDays || (typeof plannerWorkingDays !== 'undefined' ? plannerWorkingDays : [1, 2, 3, 4, 5]));
  const isWorkingDay = Array.isArray(workingDays) ? workingDays.includes(now.getDay()) : true;
  const todayNotesCount = (typeof manifest !== 'undefined' ? manifest : []).filter(n => n && n.date === todayStr).length;

  if (!isWorkingDay && todayNotesCount === 0) {
    return false;
  }

  const workEndStr = (window.settings?.ui?.workEndTime || (typeof workEndTime !== 'undefined' ? workEndTime : '18:30'));
  const workEndMins = (typeof timeToMinutes === 'function') ? timeToMinutes(workEndStr) : 1110;
  if (!Number.isFinite(workEndMins)) return false;

  const windowStartMins = Math.max(0, workEndMins - 60); // 1 hour before closing
  const currentMins = now.getHours() * 60 + now.getMinutes();

  return currentMins >= windowStartMins;
};

let _retroHoverCardHideTimer = null;

window.updateRetroFlashAndHoverState = function() {
  const tabBtn = document.getElementById('tab-retro');
  const hoverCard = document.getElementById('retro-hover-card');
  if (!tabBtn) return;

  const inWindow = window.isEndOfDayReviewWindow();

  if (inWindow) {
    tabBtn.classList.add('retro-flash-active');
  } else {
    tabBtn.classList.remove('retro-flash-active');
    if (hoverCard && hoverCard.style.display !== 'none') {
      hoverCard.style.display = 'none';
    }
  }
};

window.showRetroHoverCard = function() {
  if (_retroHoverCardHideTimer) {
    clearTimeout(_retroHoverCardHideTimer);
    _retroHoverCardHideTimer = null;
  }

  const tabBtn = document.getElementById('tab-retro');
  const hoverCard = document.getElementById('retro-hover-card');
  if (!tabBtn || !hoverCard) return;

  if (!window.isEndOfDayReviewWindow()) {
    hoverCard.style.display = 'none';
    return;
  }

  const todayStr = formatLocalDateValue(new Date());
  const todayNotes = (typeof manifest !== 'undefined' ? manifest : []).filter(n => n && n.date === todayStr);
  const estimate = window.DailyReviewTimeTracker.getEstimate(todayNotes.length);

  const titleText = t('retro.reviewTodayHoverTitle') || 'Review Today';
  const descText = t('retro.reviewTodayHoverDesc') || 'Complete your end-of-day walkthrough & organize thoughts';
  const notesText = todayNotes.length > 0
    ? (t('retro.notesToReviewCount', { count: todayNotes.length }) || `${todayNotes.length} note(s) to review today`)
    : (t('retro.noNotesToReview') || 'No notes to review today');
  const ctaText = t('retro.startDailyReviewBtn') || 'Review Today';
  const ctaTooltip = t('retro.startDailyReviewBtnTooltip') || 'Launch the end-of-day Daily Review wizard for today';

  let estimateHtml = '';
  if (estimate && typeof estimate.minutes === 'number' && estimate.minutes <= 30) {
    const estText = t('retro.estimatedTimeMin', { count: estimate.minutes }) || `⏱️ ~${estimate.minutes} min`;
    estimateHtml = `<span class="retro-hover-badge estimate-badge" title="${escA(estText)}">${escH(estText)}</span>`;
  }

  hoverCard.innerHTML = `
    <div class="retro-hover-header">
      <div class="retro-hover-title"><span>🌙</span><span>${escH(titleText)}</span></div>
      ${estimateHtml}
    </div>
    <div class="retro-hover-desc">${escH(descText)}</div>
    <div class="retro-hover-meta">
      <span class="retro-hover-badge" title="${escA(notesText)}">📝 ${escH(notesText)}</span>
    </div>
    <button class="retro-hover-cta-btn" onclick="event.stopPropagation(); window.startDailyReview('${todayStr}');" title="${escA(ctaTooltip)}">
      <span>${escH(ctaText)}</span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
    </button>
  `;

  const rect = tabBtn.getBoundingClientRect();
  const cardWidth = hoverCard.offsetWidth || 300;
  const clampedLeft = Math.max(10, Math.min(window.innerWidth - cardWidth - 10, Math.round(rect.left)));
  hoverCard.style.top = Math.round(rect.bottom + 8) + 'px';
  hoverCard.style.left = clampedLeft + 'px';
  hoverCard.style.display = 'flex';
};

window.hideRetroHoverCard = function() {
  if (_retroHoverCardHideTimer) clearTimeout(_retroHoverCardHideTimer);
  _retroHoverCardHideTimer = setTimeout(() => {
    const hoverCard = document.getElementById('retro-hover-card');
    if (hoverCard) hoverCard.style.display = 'none';
  }, 220);
};

// ─── Retrospective Interactive Items & Targeted Note Synchronization ───

function handleRetroItemActivation(e, isDblClick = false) {
  const container = e.target?.closest ? e.target.closest('.retro-summary-full-html') : null;
  if (!container) return;

  // 1. Todo marker / chip: .note-todo, .note-todo-link, [data-todo-id]
  const todoEl = e.target.closest('.note-todo, .note-todo-link, [data-todo-id]');
  if (todoEl) {
    e.preventDefault();
    e.stopPropagation();
    let id = todoEl.getAttribute('data-todo-id');
    if (!id && todoEl.tagName === 'A') {
      const href = todoEl.getAttribute('href') || '';
      if (href.startsWith('#todo-')) id = href.replace('#todo-', '');
    }
    if (id) {
      if (typeof openTodoOverlay === 'function') {
        openTodoOverlay(id);
      } else if (typeof openTodoFromMarker === 'function') {
        openTodoFromMarker(id);
      }
      return;
    }
  }

  // 2. Decision marker: .note-decision-wrapper, .note-decision-badge, .pill-decision, [data-decision-id]
  const decisionEl = e.target.closest('.note-decision-wrapper, .note-decision-badge, .pill-decision, [data-decision-id]');
  if (decisionEl) {
    e.preventDefault();
    e.stopPropagation();
    const wrapper = decisionEl.closest('.note-decision-wrapper') || decisionEl;
    if (typeof handleDecisionClick === 'function') {
      handleDecisionClick(wrapper, e);
      return;
    }
  }

  // 3. Note link: .note-link, .wiki-link, [data-note-path], [data-note-id]
  const linkEl = e.target.closest('a, .wiki-link, .note-link');
  if (linkEl) {
    const isNoteLink = linkEl.classList.contains('note-link') ||
                       linkEl.classList.contains('wiki-link') ||
                       linkEl.hasAttribute('data-note-id') ||
                       linkEl.hasAttribute('data-note-path');
    if (isNoteLink) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof openNoteFromLink === 'function') {
        openNoteFromLink(linkEl);
      } else {
        const path = linkEl.getAttribute('data-note-path') || linkEl.getAttribute('data-note-id');
        if (path && typeof openNoteOverlay === 'function') openNoteOverlay(path);
      }
      return;
    }

    const href = linkEl.getAttribute('href');
    if (href && href !== '#' && !href.startsWith('javascript:')) {
      if (isDblClick || e.metaKey || e.ctrlKey || linkEl.classList.contains('retro-open-link')) {
        e.preventDefault();
        e.stopPropagation();
        if (/^https?:\/\//i.test(href)) {
          if (typeof openExternalLink === 'function') {
            openExternalLink(href);
          } else if (window.AppBridge?.isElectron && window.AppBridge?.shell?.openExternal) {
            window.AppBridge.shell.openExternal(href);
          } else {
            window.open(href, '_blank');
          }
        } else if (/\.html($|\?|#)/i.test(href) || href.startsWith('notes/')) {
          if (typeof openNoteOverlay === 'function') openNoteOverlay(href);
        } else if (typeof openExternalLink === 'function') {
          openExternalLink(href);
        }
        return;
      }
    }
  }

  // Double clicking non-interactive text in retrospective: stop bubbling so it doesn't trigger card opening,
  // and do NOT open note editor (read-only in retrospective).
  if (isDblClick) {
    e.stopPropagation();
  }
}

function notifyDailyReviewNoteChanged(pathOrId, detail = {}) {
  if (!pathOrId) return;
  const path = (typeof pathOrId === 'string') ? pathOrId : (pathOrId.path || null);
  const noteId = (typeof pathOrId === 'string' && !pathOrId.includes('/')) ? pathOrId : (pathOrId.id || null);

  let isDaily = false;
  if (path && (/daily-summary-\d{4}-\d{2}-\d{2}\.html$/.test(path) || /daily-review-\d{4}-\d{2}-\d{2}\.html$/.test(path) || /summary-\d{4}-\d{2}-\d{2}\.html$/.test(path))) {
    isDaily = true;
  }
  if (noteId && (noteId.startsWith('summary-') || noteId.startsWith('daily-summary-'))) {
    isDaily = true;
  }
  if (!isDaily && typeof manifest !== 'undefined' && Array.isArray(manifest)) {
    const meta = manifest.find(m => (path && m.path === path) || (noteId && m.id === noteId));
    if (meta && typeof isDailySummaryNote === 'function' && isDailySummaryNote(meta)) {
      isDaily = true;
    }
  }

  if (isDaily && typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('daily-review-note-changed', {
      detail: { path, noteId, ...detail }
    }));
  }
}

let _retroDailyReviewNoteChangeListenerAttached = false;

function attachRetroDailyReviewNoteChangeListener() {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  if (_retroDailyReviewNoteChangeListenerAttached) return;
  _retroDailyReviewNoteChangeListenerAttached = true;

  // Single-click and double-click delegation on retrospective items
  document.addEventListener('dblclick', e => handleRetroItemActivation(e, true));
  document.addEventListener('click', e => handleRetroItemActivation(e, false));

  // Targeted listener: updates only the specific daily review note card when changed
  window.addEventListener('daily-review-note-changed', async (event) => {
    const detail = event?.detail || {};
    const changedPath = detail.path;
    const changedNoteId = detail.noteId;
    const changedDate = detail.date || detail.reviewDate;

    if (!changedPath && !changedNoteId && !changedDate) return;

    const cards = document.querySelectorAll('.retro-day-summary-card.has-note');
    if (!cards || cards.length === 0) return;

    for (const card of cards) {
      const cardPath = card.getAttribute('data-note-path');
      const cardNoteId = card.getAttribute('data-note-id');
      const cardDate = card.getAttribute('data-date');

      const isMatch = (changedPath && cardPath && (changedPath === cardPath || changedPath.endsWith(cardPath) || cardPath.endsWith(changedPath)))
        || (changedNoteId && cardNoteId && changedNoteId === cardNoteId)
        || (changedDate && cardDate && changedDate === cardDate);

      if (isMatch && cardPath) {
        try {
          let raw = '';
          if (typeof StorageAPI !== 'undefined' && typeof StorageAPI.readNoteContent === 'function') {
            raw = await StorageAPI.readNoteContent(cardPath);
          }
          if (raw) {
            let noteFullHtml = '';
            if (typeof parseNoteHTML === 'function') {
              const parsed = parseNoteHTML(raw);
              noteFullHtml = parsed.mainHTML || parsed.html || raw;
            } else {
              noteFullHtml = raw;
            }
            const htmlContainer = card.querySelector('.retro-summary-full-html');
            if (htmlContainer && noteFullHtml) {
              htmlContainer.innerHTML = noteFullHtml;
            }
          }
        } catch (err) {
          console.warn('Failed to dynamically refresh daily review note in retrospective', cardPath, err);
        }
      }
    }
  });
}

window.notifyDailyReviewNoteChanged = notifyDailyReviewNoteChanged;
window.handleRetroItemActivation = handleRetroItemActivation;
window.attachRetroDailyReviewNoteChangeListener = attachRetroDailyReviewNoteChangeListener;

// Bind hover and periodic state checker
(function initRetroFlashEvents() {
  function setup() {
    const wrapper = document.getElementById('tab-retro-wrapper');
    const hoverCard = document.getElementById('retro-hover-card');
    const tabBtn = document.getElementById('tab-retro');

    if (wrapper) {
      wrapper.addEventListener('mouseenter', () => window.showRetroHoverCard());
      wrapper.addEventListener('mouseleave', () => window.hideRetroHoverCard());
    } else if (tabBtn) {
      tabBtn.addEventListener('mouseenter', () => window.showRetroHoverCard());
      tabBtn.addEventListener('mouseleave', () => window.hideRetroHoverCard());
    }

    if (hoverCard) {
      hoverCard.addEventListener('mouseenter', () => {
        if (_retroHoverCardHideTimer) {
          clearTimeout(_retroHoverCardHideTimer);
          _retroHoverCardHideTimer = null;
        }
      });
      hoverCard.addEventListener('mouseleave', () => window.hideRetroHoverCard());
    }

    attachRetroDailyReviewNoteChangeListener();
    window.updateRetroFlashAndHoverState();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setTimeout(setup, 100);
  }

  // Check state periodically (every 30 seconds)
  setInterval(() => {
    try { window.updateRetroFlashAndHoverState(); } catch(_e) {}
  }, 30000);
})();

