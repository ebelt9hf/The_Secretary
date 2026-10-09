/* ── Secretary: Eisenhower Matrix & Todos Board ── */

let matrixCollapsedCols = new Set();
let matrixCollapsedRows = new Set();
let eisenhowerViewMode = (typeof localStorage !== 'undefined' && localStorage.getItem('eisenhowerViewMode')) || 'graph';
let eisenhowerWorkstreamFilter = (typeof localStorage !== 'undefined' && localStorage.getItem('eisenhowerWorkstreamFilter')) || null;
let showDelegatedTodos = (typeof localStorage !== 'undefined' && localStorage.getItem('showDelegatedTodos') === 'true');

let delegatedWorkstreamCollapsed = new Set();
let ganttTimeScale = (typeof localStorage !== 'undefined' && localStorage.getItem('ganttTimeScale')) || '4w';
let ganttTaskScope = (typeof localStorage !== 'undefined' && localStorage.getItem('ganttTaskScope')) || 'delegated';
let _todoModalDelegatedDate = '';
let _todoModalUpdates = [];
let _selectedMergeCandidateId = null;

function setGanttTimeScale(scale) {
  ganttTimeScale = scale;
  try { if (typeof localStorage !== 'undefined') localStorage.setItem('ganttTimeScale', scale); } catch (_) {}
  renderTodosBoard();
}
window.setGanttTimeScale = setGanttTimeScale;

function setGanttTaskScope(scope) {
  ganttTaskScope = scope;
  try { if (typeof localStorage !== 'undefined') localStorage.setItem('ganttTaskScope', scope); } catch (_) {}
  renderTodosBoard();
}
window.setGanttTaskScope = setGanttTaskScope;

function isTodoDelegated(todo) {
  if (!todo) return false;
  if (todo.isDelegated || todo.delegatedTo || todo.delegated_to || todo.delegatedToColleagueId) return true;
  if (typeof isUserTask === 'function' && isUserTask(todo)) return false;
  const ownerId = typeof getTodoOwnerId === 'function' ? getTodoOwnerId(todo) : (todo.ownerId || todo.owner);
  if (ownerId && typeof isUserCollaborator === 'function' && !isUserCollaborator(ownerId)) return true;
  return false;
}

function toggleDelegatedWorkstreamGroup(wsKey) {
  if (delegatedWorkstreamCollapsed.has(wsKey)) delegatedWorkstreamCollapsed.delete(wsKey);
  else delegatedWorkstreamCollapsed.add(wsKey);
  renderTodosBoard();
}
window.toggleDelegatedWorkstreamGroup = toggleDelegatedWorkstreamGroup;

function getDefinedWorkstreamsList() {
  if (typeof getKnownWorkstreamsList === 'function') {
    return getKnownWorkstreamsList();
  }
  return [];
}

function setEisenhowerWorkstreamFilter(ws) {
  eisenhowerWorkstreamFilter = ws;
  try {
    if (ws) localStorage.setItem('eisenhowerWorkstreamFilter', ws);
    else localStorage.removeItem('eisenhowerWorkstreamFilter');
  } catch (e) {}
  renderTodosBoard();
}

function toggleShowDelegatedTodos() {
  showDelegatedTodos = !showDelegatedTodos;
  try {
    localStorage.setItem('showDelegatedTodos', String(showDelegatedTodos));
  } catch (e) {}
  renderTodosBoard();
}

function toggleMatrixColumn(colKey) {
  if (matrixCollapsedCols.has(colKey)) matrixCollapsedCols.delete(colKey);
  else matrixCollapsedCols.add(colKey);
  renderTodosBoard();
}

function toggleMatrixRow(rowKey) {
  if (matrixCollapsedRows.has(rowKey)) matrixCollapsedRows.delete(rowKey);
  else matrixCollapsedRows.add(rowKey);
  renderTodosBoard();
}

function setEisenhowerViewMode(mode) {
  eisenhowerViewMode = mode;
  try { localStorage.setItem('eisenhowerViewMode', mode); } catch (e) {}
  renderTodosBoard();
}

window.toggleMatrixColumn = toggleMatrixColumn;
window.toggleMatrixRow = toggleMatrixRow;
window.setEisenhowerViewMode = setEisenhowerViewMode;
window.isTodoDelegated = isTodoDelegated;
window.getDefinedWorkstreamsList = getDefinedWorkstreamsList;
window.setEisenhowerWorkstreamFilter = setEisenhowerWorkstreamFilter;
window.toggleShowDelegatedTodos = toggleShowDelegatedTodos;

function getTodoScatterCoordinates(todo, index, totalTodos) {
  let x = typeof todo.eisenhowerX === 'number' ? todo.eisenhowerX : null;
  let y = typeof todo.eisenhowerY === 'number' ? todo.eisenhowerY : null;

  if (x === null || y === null) {
    const quad = (typeof EisenhowerUtils !== 'undefined' && EisenhowerUtils.getQuadrant) 
      ? EisenhowerUtils.getQuadrant(todo) 
      : getTodoQuadrant(todo);
    
    if (typeof EisenhowerUtils !== 'undefined' && EisenhowerUtils.getDefaultCoordsForQuadrant) {
      const def = EisenhowerUtils.getDefaultCoordsForQuadrant(quad, todo.id || String(index));
      x = def.x;
      y = def.y;
    } else {
      if (quad === 'Q1') { x = 25; y = 25; }
      else if (quad === 'Q2') { x = 75; y = 25; }
      else if (quad === 'Q3') { x = 25; y = 75; }
      else if (quad === 'Q4') { x = 75; y = 75; }
      else { x = 50; y = 50; }
    }
  }
  return { x, y };
}

function getCleanTaskTitle(todo) {
  if (typeof EisenhowerUtils !== 'undefined' && EisenhowerUtils.cleanTaskTitle) {
    return EisenhowerUtils.cleanTaskTitle(todo);
  }
  if (typeof cleanTaskTitleText === 'function') {
    return cleanTaskTitleText(typeof todo === 'string' ? todo : (todo ? todo.title || todo.id : ''));
  }
  if (!todo) return '';
  const raw = typeof todo === 'string' ? todo : (todo.title || todo.id || '');
  return raw;
}

function truncateTaskText(text, maxLen = 20) {
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 1).trim() + '…';
}

function clusterScatterItems(scatterItems, threshold = 4.2) {
  const clusters = [];
  scatterItems.forEach((item, index) => {
    item.rank = index + 1;
    let added = false;
    for (const cluster of clusters) {
      const dx = cluster.cx - item.x;
      const dy = cluster.cy - item.y;
      if (Math.sqrt(dx * dx + dy * dy) <= threshold) {
        cluster.items.push(item);
        let sumX = 0, sumY = 0;
        cluster.items.forEach(it => { sumX += it.x; sumY += it.y; });
        cluster.cx = sumX / cluster.items.length;
        cluster.cy = sumY / cluster.items.length;
        added = true;
        break;
      }
    }
    if (!added) {
      clusters.push({
        id: `c${index}-${Math.floor(item.x)}-${Math.floor(item.y)}`,
        cx: item.x,
        cy: item.y,
        items: [item]
      });
    }
  });
  return clusters;
}

function getQuadrantMeta(qKey) {
  const defaults = {
    Q1: {
      label: t('todo.q1') || 'À faire immédiatement (Urgent & Important)',
      shortLabel: t('todo.q1Short') || 'À faire',
      actionTitle: t('todo.q1Action') || 'À FAIRE MAINTENANT',
      desc: t('todo.q1Desc') || 'Tâches qui exigent votre attention immédiate.',
      motto: t('todo.q1Motto') || '« Je la fais maintenant »',
      color: '#ef4444'
    },
    Q2: {
      label: t('todo.q2') || 'Planifier (Important, Non urgent)',
      shortLabel: t('todo.q2Short') || 'Planifier',
      actionTitle: t('todo.q2Action') || 'À PLANIFIER',
      desc: t('todo.q2Desc') || 'Cruciales pour vos objectifs à long terme.',
      motto: t('todo.q2Motto') || '« Je planifie sa réalisation »',
      color: '#f59e0b'
    },
    Q3: {
      label: t('todo.q3') || 'Déléguer (Urgent, Non important)',
      shortLabel: t('todo.q3Short') || 'Déléguer',
      actionTitle: t('todo.q3Action') || 'À DÉLÉGUER',
      desc: t('todo.q3Desc') || 'Nécessitent une action rapide sans impact profond.',
      motto: t('todo.q3Motto') || '« Je demande à quelqu\'un de le faire »',
      color: '#6366f1'
    },
    Q4: {
      label: t('todo.q4') || 'Éliminer (Non urgent & Non important)',
      shortLabel: t('todo.q4Short') || 'Éliminer',
      actionTitle: t('todo.q4Action') || 'À ÉLIMINER OU LIMITER',
      desc: t('todo.q4Desc') || 'Faible importance et aucune urgence.',
      motto: t('todo.q4Motto') || '« Je fais le minimum, ou décide de ne pas le faire »',
      color: '#14b8a6'
    }
  };
  return defaults[qKey] || defaults.Q2;
}

function renderTodosBoard() {
  const board = document.getElementById('swimlane-board');
  if (!board) return;
  closeTodoContextMenu();
  hideDotTooltip(0);
  if (typeof removeEisenhowerDraftDot === 'function') removeEisenhowerDraftDot();
  
  const overlay = document.getElementById('eisenhower-quadrant-overlay');
  if (overlay && !overlay.hasAttribute('data-user-opened')) {
    overlay.classList.remove('visible');
    overlay.style.display = 'none';
  }

  let doneLaneHtml = '';
  if (showDoneTodos) {
    let doneItems = getTodosByPriority('Done').filter(isUserTask);
    if (typeof TodoFilterEngine !== 'undefined' && TodoFilterEngine.currentFilter.query) {
      doneItems = TodoFilterEngine.filterList(doneItems);
    }
    const isCollapsed = collapsedLanes.has('todo-Done');
    const doneCards = doneItems.map(todo => renderTodoCard(todo, null)).join('');
    doneLaneHtml = `
      <div class="sl-lane todo-board-lane todo-board-lane-done${isCollapsed ? ' collapsed' : ''}" data-lane="todo-Done" data-priority="Done" style="--todo-lane-bg:var(--card-bg-alt);--todo-lane-border:var(--card-border);--todo-lane-accent:var(--text-muted); margin-top:0.75rem;"${isCollapsed ? ' onclick="toggleLane(\'todo-Done\')"' : ''}>
        <div class="sl-lane-header" onclick="toggleLane('todo-Done')" title="${escA(t('todo.clickToCollapse'))}">
          <span class="sl-lane-swatch" style="background:var(--text-muted)"></span>
          <span class="sl-lane-name">${escH(t('todo.doneSectionTitle') || t('todo.done') || 'Completed Tasks')}</span>
          <span class="sl-lane-count">(${doneItems.length})</span>
          <span class="sl-lane-toggle-icon${isCollapsed ? ' collapsed' : ''}"></span>
        </div>
        ${isCollapsed ? '' : `<div class="sl-cards todo-lane-cards" data-priority="Done">${doneCards || `<span style="color:var(--text-muted);font-size:.78rem;padding:.3rem">${escH(t('todo.empty'))}</span>`}</div>`}
      </div>`;
  }

  let activeTodos = (todosManifest || []).filter(t => t && t.priority !== 'Done' && isUserTask(t));

  if (!showDelegatedTodos) {
    activeTodos = activeTodos.filter(t => !isTodoDelegated(t));
  }

  if (eisenhowerWorkstreamFilter) {
    activeTodos = activeTodos.filter(t => {
      const ws = (t.workstream || (Array.isArray(t.major_topic_tags) && t.major_topic_tags[0]) || '').trim();
      if (eisenhowerWorkstreamFilter === 'Other' || eisenhowerWorkstreamFilter === 'Autre') {
        return !ws || ['other', 'autre'].includes(ws.toLowerCase());
      }
      return ws.toLowerCase() === eisenhowerWorkstreamFilter.toLowerCase();
    });
  }

  if (typeof TodoFilterEngine !== 'undefined' && TodoFilterEngine.currentFilter.query) {
    activeTodos = TodoFilterEngine.filterList(activeTodos);
  }

  activeTodos.sort((a, b) => {
    const ya = typeof a.eisenhowerY === 'number' ? a.eisenhowerY : 50;
    const yb = typeof b.eisenhowerY === 'number' ? b.eisenhowerY : 50;
    if (ya !== yb) return ya - yb;
    const xa = typeof a.eisenhowerX === 'number' ? a.eisenhowerX : 50;
    const xb = typeof b.eisenhowerX === 'number' ? b.eisenhowerX : 50;
    return xa - xb;
  });

  const scatterItems = activeTodos.map((t, idx) => {
    const coords = getTodoScatterCoordinates(t, idx, activeTodos.length);
    return { todo: t, x: coords.x, y: coords.y };
  });

  const todoCoordsMap = new Map();
  scatterItems.forEach(it => {
    if (it.todo && it.todo.id) {
      todoCoordsMap.set(String(it.todo.id), { x: it.x, y: it.y });
    }
  });

  const criticalPathList = (showEisenhowerCriticalPath && typeof TaskGraphEngine !== 'undefined') ? TaskGraphEngine.calculateCriticalPath() : [];
  const criticalPathSet = new Set(criticalPathList.map(String));

  const depVectorsSvg = [];
  activeTodos.forEach(depTodo => {
    if (Array.isArray(depTodo.depends_on)) {
      const toCoord = todoCoordsMap.get(String(depTodo.id));
      if (!toCoord) return;
      depTodo.depends_on.forEach(prereqId => {
        const fromCoord = todoCoordsMap.get(String(prereqId));
        if (!fromCoord) return;
        const isCritVector = criticalPathSet.has(String(prereqId)) && criticalPathSet.has(String(depTodo.id));
        const dx = toCoord.x - fromCoord.x;
        const dy = toCoord.y - fromCoord.y;
        const cx1 = (fromCoord.x + dx * 0.25).toFixed(2);
        const cy1 = (fromCoord.y + dy * 0.1).toFixed(2);
        const cx2 = (fromCoord.x + dx * 0.75).toFixed(2);
        const cy2 = (fromCoord.y + dy * 0.9).toFixed(2);

        depVectorsSvg.push(`
          <path class="eis-dep-vector${isCritVector ? ' is-critical' : ''}"
                data-from-id="${escA(prereqId)}"
                data-to-id="${escA(depTodo.id)}"
                d="M ${fromCoord.x.toFixed(2)}% ${fromCoord.y.toFixed(2)}% C ${cx1}% ${cy1}%, ${cx2}% ${cy2}%, ${toCoord.x.toFixed(2)}% ${toCoord.y.toFixed(2)}%"
                fill="none"
                stroke="${isCritVector ? '#f59e0b' : 'var(--card-border)'}"
                stroke-width="${isCritVector ? '2.5' : '1.5'}"
                stroke-dasharray="${isCritVector ? '6 3' : '4 4'}"
                stroke-opacity="${isCritVector ? '0.95' : '0.45'}"
                marker-end="url(#eis-arrow${isCritVector ? '-crit' : ''})" />
        `);
      });
    }
  });

  const countQ1 = activeTodos.filter(t => getTodoQuadrant(t) === 'Q1').length;
  const countQ2 = activeTodos.filter(t => getTodoQuadrant(t) === 'Q2').length;
  const countQ3 = activeTodos.filter(t => getTodoQuadrant(t) === 'Q3').length;
  const countQ4 = activeTodos.filter(t => getTodoQuadrant(t) === 'Q4').length;

  const clusters = clusterScatterItems(scatterItems, 4.2);
  _clusterMap = {};
  clusters.forEach(cl => { _clusterMap[cl.id] = cl; });

  const dotsHtml = clusters.map(cluster => {
    if (cluster.items.length === 1) {
      const item = cluster.items[0];
      const todo = item.todo;
      const quad = getTodoQuadrant(todo);
      const meta = getQuadrantMeta(quad);
      const isHighStar = Boolean(todo.isHighPriority);
      const isWontDo = typeof isTodoWontDo === 'function' ? isTodoWontDo(todo) : (todo.status === 'wont_do');
      const isWip = isTodoWip(todo) && !isWontDo;
      const isBlocked = typeof TaskGraphEngine !== 'undefined' && TaskGraphEngine.isBlocked(todo.id);
      const isCrit = criticalPathSet.has(String(todo.id));
      const dueInfo = typeof getTodoDueDateInfo === 'function' ? getTodoDueDateInfo(todo) : null;
      const isOverdue = dueInfo && dueInfo.urgencyClass === 'due-overdue';

      const fullTitle = getCleanTaskTitle(todo);
      const displayTitle = truncateTaskText(fullTitle, 20);

      return `
        <div class="eisenhower-task-text${isHighStar ? ' is-starred' : ''}${isWip ? ' is-wip' : ''}${isWontDo ? ' is-wontdo' : ''}${isOverdue ? ' is-overdue' : ''}${isBlocked ? ' is-blocked' : ''}${isCrit ? ' is-critical-path' : ''}"
             role="button"
             tabindex="0"
             data-todo-id="${escA(todo.id)}"
             data-base-x="${item.x.toFixed(2)}"
             data-base-y="${item.y.toFixed(2)}"
             style="position:absolute;left:${item.x.toFixed(2)}%;top:${item.y.toFixed(2)}%;--task-accent:${meta.color};color:${meta.color};z-index:10;"
             onmouseenter="handleScatterDotMouseEnter(event, '${escA(todo.id)}')"
             onmouseleave="handleScatterDotMouseLeave(event, '${escA(todo.id)}')"
             oncontextmenu="return showScatterDotContextMenu(event, '${escA(todo.id)}');"
             ondblclick="event.stopPropagation();openTodoOverlay('${escA(todo.id)}');"
             onkeydown="handleScatterDotKeyDown(event, '${escA(todo.id)}')">
          <span class="eisenhower-task-bullet" style="background-color:${meta.color};"></span>
          ${isBlocked ? '<span class="eisenhower-task-lock-badge" title="' + escA(t('todo.blockedBadgeTitle') || 'Blocked by unresolved prerequisites') + '">🔒</span>' : ''}
          ${isHighStar ? '<span class="eisenhower-task-star" title="' + escA(t('todo.starPriority') || 'High Priority') + '">⭐</span>' : ''}
          <span class="eisenhower-task-title-text">${escH(displayTitle)}</span>
        </div>`;
    } else {
      const primaryItem = cluster.items[0];
      const primaryTodo = primaryItem.todo;
      const primaryQuad = getTodoQuadrant(primaryTodo);
      const primaryMeta = getQuadrantMeta(primaryQuad);

      const count = cluster.items.length;
      const displayItems = cluster.items.slice(0, 3);
      const remainingCount = Math.max(0, count - 3);

      // Minimum radius so adjacent dots never overlap.
      // Each dot is ~140px wide × 24px tall — treat as 50px radius for chord calculation.
      const DOT_HALF = 50;
      const minFromChord = count < 2 ? 70 : Math.ceil(DOT_HALF / Math.sin(Math.PI / count));
      const fanoutRadius = Math.max(80, minFromChord);

      const isNearRight = cluster.cx > 82;
      const isNearLeft = cluster.cx < 18;
      const isNearBottom = cluster.cy > 82;
      const isNearTop = cluster.cy < 18;

      let angleOffset = count === 2 ? -Math.PI / 4 : -Math.PI / 2;
      if (isNearRight) angleOffset = Math.PI;
      else if (isNearLeft) angleOffset = 0;
      else if (isNearBottom) angleOffset = count === 2 ? -Math.PI / 4 : -Math.PI / 2;
      else if (isNearTop) angleOffset = count === 2 ? (3 * Math.PI) / 4 : Math.PI / 2;

      // Precompute angle/offset for each item (shared between radialDots and SVG connectors)
      const radialPositions = cluster.items.map((item, k) => ({
        item,
        angle: (k / count) * 2 * Math.PI + angleOffset,
        offsetX: Math.cos((k / count) * 2 * Math.PI + angleOffset) * fanoutRadius,
        offsetY: Math.sin((k / count) * 2 * Math.PI + angleOffset) * fanoutRadius,
      }));

      const radialDotsHtml = radialPositions.map(({ item, offsetX, offsetY }) => {
        const todo = item.todo;
        const quad = getTodoQuadrant(todo);
        const meta = getQuadrantMeta(quad);
        const isHighStar = Boolean(todo.isHighPriority);
        const isWontDo = typeof isTodoWontDo === 'function' ? isTodoWontDo(todo) : (todo.status === 'wont_do');
        const isBlocked = typeof TaskGraphEngine !== 'undefined' && TaskGraphEngine.isBlocked(todo.id);
        const isCrit = criticalPathSet.has(String(todo.id));
        const fullTitle = getCleanTaskTitle(todo);
        const displayTitle = truncateTaskText(fullTitle, 18);

        return `
          <div class="eisenhower-task-text eisenhower-radial-dot${isHighStar ? ' is-starred' : ''}${isWontDo ? ' is-wontdo' : ''}${isBlocked ? ' is-blocked' : ''}${isCrit ? ' is-critical-path' : ''}"
               role="button"
               tabindex="0"
               data-todo-id="${escA(todo.id)}"
               data-base-x="${item.x.toFixed(2)}"
               data-base-y="${item.y.toFixed(2)}"
               style="--tx:${offsetX.toFixed(1)}px; --ty:${offsetY.toFixed(1)}px; --task-accent:${meta.color}; color:${meta.color};"
               onmouseenter="handleScatterDotMouseEnter(event, '${escA(todo.id)}')"
               onmouseleave="handleScatterDotMouseLeave(event, '${escA(todo.id)}')"
               oncontextmenu="return showScatterDotContextMenu(event, '${escA(todo.id)}');"
               ondblclick="event.stopPropagation();openTodoOverlay('${escA(todo.id)}');"
               onkeydown="handleScatterDotKeyDown(event, '${escA(todo.id)}')">
            <span class="eisenhower-task-bullet" style="background-color:${meta.color};"></span>
            ${isBlocked ? '<span class="eisenhower-task-lock-badge" title="' + escA(t('todo.blockedBadgeTitle') || 'Blocked by unresolved prerequisites') + '">🔒</span>' : ''}
            ${isHighStar ? '<span class="eisenhower-task-star" title="' + escA(t('todo.starPriority') || 'High Priority') + '">⭐</span>' : ''}
            <span class="eisenhower-task-title-text">${escH(displayTitle)}</span>
          </div>`;
      }).join('');

      // SVG overlay: a dashed ring + connector lines from center to each radial dot.
      // Shown only when cluster is expanded, so membership is immediately obvious.
      const svgPad = 55;
      const svgD = (fanoutRadius + svgPad) * 2;
      const scx = svgD / 2, scy = svgD / 2;
      const connectorLines = radialPositions.map(({ offsetX, offsetY }) =>
        `<line x1="${scx.toFixed(1)}" y1="${scy.toFixed(1)}" x2="${(scx + offsetX).toFixed(1)}" y2="${(scy + offsetY).toFixed(1)}" stroke="${primaryMeta.color}" stroke-width="1.5" stroke-dasharray="4 4" stroke-opacity="0.55"/>`
      ).join('');
      const clusterRingSvg = `
        <svg class="eis-cluster-ring" width="${svgD}" height="${svgD}"
              style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);pointer-events:none;z-index:3;overflow:visible;"
              xmlns="http://www.w3.org/2000/svg">
          <circle cx="${scx.toFixed(1)}" cy="${scy.toFixed(1)}" r="${fanoutRadius + 18}"
                  fill="${primaryMeta.color}" fill-opacity="0.1"
                  stroke="${primaryMeta.color}" stroke-width="1.2" stroke-dasharray="5 5" stroke-opacity="0.32"/>
          ${connectorLines}
        </svg>`;

      const clusterTitlesHtml = displayItems.map(it => {
        const itemTodo = it.todo;
        const itemQuad = getTodoQuadrant(itemTodo);
        const itemMeta = getQuadrantMeta(itemQuad);
        const itemTitle = truncateTaskText(getCleanTaskTitle(itemTodo), 18);
        return `
          <span class="eisenhower-cluster-item-title" title="${escA(getCleanTaskTitle(itemTodo))}">
            <span class="eisenhower-task-bullet" style="background-color:${itemMeta.color};"></span>
            <span class="eisenhower-cluster-item-text">${escH(itemTitle)}</span>
          </span>`;
      }).join('');

      return `
        <div class="eisenhower-cluster-group"
             id="cluster-group-${cluster.id}"
             data-cluster-id="${cluster.id}"
             style="position:absolute;left:${cluster.cx.toFixed(2)}%;top:${cluster.cy.toFixed(2)}%;--fanout-radius:${fanoutRadius}px;--dot-accent:${primaryMeta.color};"
             onmouseenter="handleClusterMouseEnter(this, '${cluster.id}')"
             onmouseleave="handleClusterMouseLeave(this, '${cluster.id}')">
          ${clusterRingSvg}
          <div class="eisenhower-task-text eisenhower-cluster-dot"
               role="button"
               tabindex="0"
               data-cluster-id="${cluster.id}"
               data-base-x="${cluster.cx.toFixed(2)}"
               data-base-y="${cluster.cy.toFixed(2)}"
               title="${escA(t('todo.clusterGroupTooltip', { count }) || `Cluster of ${count} tasks. Click to expand`)}"
               style="position:absolute;left:50%;top:50%;--task-accent:${primaryMeta.color};color:${primaryMeta.color};z-index:15;"
               onclick="handleClusterClick(event, '${cluster.id}')"
               onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();handleClusterClick(event, '${cluster.id}');}">
            <div class="eisenhower-cluster-titles-stacked">
              ${clusterTitlesHtml}
            </div>
            ${remainingCount > 0 ? `<span class="eisenhower-cluster-badge" title="${escA(t('todo.clusterMoreTasksTooltip', { count: remainingCount }) || `+${remainingCount} more in cluster`)}">+${remainingCount}</span>` : ''}
          </div>
          <div class="eisenhower-radial-fanout">
            ${radialDotsHtml}
          </div>
        </div>`;
    }
  }).join('');

  const q1Meta = getQuadrantMeta('Q1');
  const q2Meta = getQuadrantMeta('Q2');
  const q3Meta = getQuadrantMeta('Q3');
  const q4Meta = getQuadrantMeta('Q4');

  const bannerHelpText = t('todo.eisenhowerHelpBanner') || 'Priorisez vos actions : L\'urgence augmente de droite à gauche, l\'importance de bas en haut. Glissez les tâches pour ajuster la priorité ou cliquez sur un quadrant pour les détails.';

  const priorityInversions = typeof TaskGraphEngine !== 'undefined' ? TaskGraphEngine.checkPriorityInversions() : [];
  let inversionBannerHtml = '';
  if (priorityInversions.length > 0) {
    const inv = priorityInversions[0];
    inversionBannerHtml = `
      <div class="eisenhower-inversion-banner" style="background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.35);border-radius:8px;padding:8px 12px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;font-size:0.85rem;color:var(--text);">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:1.1rem;">⚠️</span>
          <span><strong>${escH(t('todo.priorityInversionTitle') || 'Priority Inversion:')}</strong> ${escH(t('todo.priorityInversionDesc', { task: getCleanTaskTitle(inv.task), blocker: getCleanTaskTitle(inv.blocker) }) || `Important task "${getCleanTaskTitle(inv.task)}" is blocked by lower-priority "${getCleanTaskTitle(inv.blocker)}"`)}</span>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="changeTodoQuadrant('${escA(inv.blocker.id)}', 'Q1')" title="${escA(t('todo.promoteBlockerTooltip') || 'Promote blocker to Q1')}">⚡ ${escH(t('todo.promoteBlocker') || 'Promote Blocker')}</button>
      </div>
    `;
  }

  const definedWorkstreams = getDefinedWorkstreamsList();
  let workstreamFilterBarHtml = '';
  if (definedWorkstreams.length > 0) {
    const wsIcon = (typeof AppIcons !== 'undefined' && AppIcons.get) ? AppIcons.get('workstream', { size: 12 }) : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 9v12"/><path d="M18 9a9 9 0 0 0-9 9"/></svg>';
    const wsChips = [
      `<button class="eisenhower-ws-chip${!eisenhowerWorkstreamFilter ? ' active' : ''}" onclick="setEisenhowerWorkstreamFilter(null)" title="${escA(t('todo.filterWorkstreamAllTooltip') || 'Show tasks from all workstreams')}">${escH(t('todo.filterWorkstreamAll') || 'All Workstreams')}</button>`,
      ...definedWorkstreams.map(ws => `
        <button class="eisenhower-ws-chip${eisenhowerWorkstreamFilter && eisenhowerWorkstreamFilter.toLowerCase() === ws.toLowerCase() ? ' active' : ''}" onclick="setEisenhowerWorkstreamFilter(${jq(ws)})" title="${escA(t('todo.filterWorkstreamTooltip', { value: ws }) || `Filter tasks by workstream: ${ws}`)}">${wsIcon} <span>${escH(ws)}</span></button>
      `)
    ];

    workstreamFilterBarHtml = `
      <div class="eisenhower-workstream-filter-bar">
        <span class="eisenhower-ws-label">${wsIcon} <span>${escH(t('todo.filterWorkstreamLabel') || 'Workstream')}:</span></span>
        ${wsChips.join('')}
      </div>
    `;
  }

  board.innerHTML = `
    <div class="eisenhower-container">
      <div class="eisenhower-header-toolbar">
        <div class="eisenhower-toolbar-title" style="font-weight:700;font-size:1.05rem;display:flex;align-items:center;gap:6px;">
          <span class="ui-icon-wrap" style="color:var(--accent);display:inline-flex;align-items:center;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 12h18"/><path d="M12 3v18"/></svg></span> <span>${escH(t('todo.quadrant') || 'Quadrant Eisenhower')}</span>
        </div>
        <div class="eisenhower-toolbar-actions">
          <div class="eisenhower-search-box" style="display:inline-flex;align-items:center;margin-right:6px;">
            <input type="search" id="todos-board-search" class="topbar-search" placeholder="${escA(t('todo.searchPlaceholder') || 'Search tasks...')}" value="${escA((typeof TodoFilterEngine !== 'undefined' && TodoFilterEngine.currentFilter.query) || '')}" oninput="onTodosSearchInput(this.value)" style="height:28px;font-size:0.8rem;padding:2px 8px;width:170px;" title="${escA(t('todo.searchTooltip') || 'Search tasks by title, owner, or subtask')}">
          </div>
          <button class="eisenhower-toggle-done-btn" onclick="document.querySelector('.delegated-section-container')?.scrollIntoView({ behavior: 'smooth' })" title="${escA(t('todo.delegatedMatrixSubtitle') || 'Jump to Delegated Tasks')}">
            <span class="ui-icon-wrap"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span> <span>${escH(t('todo.delegatedMatrixTitle') || 'Delegated Tasks')}</span>
          </button>
          <button class="eisenhower-toggle-done-btn${showEisenhowerCriticalPath ? ' active' : ''}" onclick="toggleEisenhowerCriticalPath()" title="${escA(t('todo.criticalPathTooltip') || 'Highlight bottleneck dependency chain')}">
            <span class="ui-icon-wrap"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg></span> <span>${escH(t('todo.criticalPath') || 'Critical Path')}</span>
          </button>
          <button class="eisenhower-toggle-done-btn${showDoneTodos ? ' active' : ''}" onclick="toggleShowDone()" title="${escA(showDoneTodos ? (t('board.hideDoneTooltip') || 'Hide completed tasks') : (t('board.showDoneTooltip') || 'Show completed tasks'))}">
            <span class="ui-icon-wrap"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span> <span>${escH(showDoneTodos ? (t('board.hideDone') || t('todo.hideDone') || 'Hide Completed') : (t('board.showDone') || t('todo.showDone') || 'Show Completed'))}</span>
          </button>
          <button class="eisenhower-clear-done-btn" onclick="confirmClearDone()" title="${escA(t('subrow.clearDoneTooltip') || 'Delete all done todos')}">
            <span class="ui-icon-wrap"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></span> <span>${escH(t('subrow.clearDone') || 'Clear Done')}</span>
          </button>
          <button class="eisenhower-add-btn" onclick="openNewTodoDialog()" title="${escA(t('todo.newTodoTooltip') || 'Create a new task')}">+ ${escH(t('todo.newShort') || 'Nouvelle tâche')}</button>
        </div>
      </div>

      ${workstreamFilterBarHtml}

      ${inversionBannerHtml}

      <div class="eisenhower-help-banner">
        <span class="ui-icon-wrap" style="color:var(--accent);display:inline-flex;align-items:center;flex-shrink:0;">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="16" x2="12" y2="12"/>
            <line x1="12" y1="8" x2="12.01" y2="8"/>
          </svg>
        </span>
        <span>${escH(bannerHelpText)}</span>
      </div>

      <div class="eisenhower-map-container">
        <div class="eisenhower-map-canvas" id="eisenhower-map-canvas"
             tabindex="0"
             aria-label="Eisenhower Matrix Interactive Scatterplot"
             style="position:relative;width:100%;height:min(580px, 65vh);min-height:440px;user-select:none;touch-action:none;">

          <svg class="eisenhower-svg-grid" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg"
               style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;">
            <defs>
              <radialGradient id="q1-ambient-grad" cx="25%" cy="25%" r="65%">
                <stop offset="0%" stop-color="#ef4444" stop-opacity="0.18" />
                <stop offset="100%" stop-color="#ef4444" stop-opacity="0.02" />
              </radialGradient>
              <radialGradient id="q2-ambient-grad" cx="75%" cy="25%" r="65%">
                <stop offset="0%" stop-color="#f59e0b" stop-opacity="0.18" />
                <stop offset="100%" stop-color="#f59e0b" stop-opacity="0.02" />
              </radialGradient>
              <radialGradient id="q3-ambient-grad" cx="25%" cy="75%" r="65%">
                <stop offset="0%" stop-color="#6366f1" stop-opacity="0.18" />
                <stop offset="100%" stop-color="#6366f1" stop-opacity="0.02" />
              </radialGradient>
              <radialGradient id="q4-ambient-grad" cx="75%" cy="75%" r="65%">
                <stop offset="0%" stop-color="#14b8a6" stop-opacity="0.18" />
                <stop offset="100%" stop-color="#14b8a6" stop-opacity="0.02" />
              </radialGradient>
              <marker id="eis-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="var(--text-muted)" opacity="0.6" />
              </marker>
              <marker id="eis-arrow-crit" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#f59e0b" />
              </marker>
            </defs>

            <rect x="0" y="0" width="50%" height="50%" fill="url(#q1-ambient-grad)" id="rect-q1" />
            <rect x="50%" y="0" width="50%" height="50%" fill="url(#q2-ambient-grad)" id="rect-q2" />
            <rect x="0" y="50%" width="50%" height="50%" fill="url(#q3-ambient-grad)" id="rect-q3" />
            <rect x="50%" y="50%" width="50%" height="50%" fill="url(#q4-ambient-grad)" id="rect-q4" />

            <line x1="50%" y1="0" x2="50%" y2="100%" stroke="var(--card-border)" stroke-width="1.5" opacity="0.6" />
            <line x1="0" y1="50%" x2="100%" y2="50%" stroke="var(--card-border)" stroke-width="1.5" opacity="0.6" />

            <!-- Dependency Vectors -->
            ${depVectorsSvg.join('')}
          </svg>

          <!-- Q1: Top-Left (Urgent & Important) -->
          <div class="eisenhower-quadrant-bg-title"
               role="button"
               tabindex="0"
               style="position:absolute;top:18px;left:20px;color:${q1Meta.color};"
               onclick="openQuadrantDetailOverlay('Q1')"
               onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openQuadrantDetailOverlay('Q1');}"
               title="${escA(t('todo.clickToOpenQuadrantOverlay', { quadrant: q1Meta.actionTitle }) || `${q1Meta.actionTitle} - ${q1Meta.desc}`)}">
            <div class="q-title-header">
              <span class="q-title-action">${escH(q1Meta.actionTitle)}</span>
              <span class="q-title-count">(${countQ1})</span>
            </div>
            <div class="q-title-motto">${escH(q1Meta.motto)}</div>
          </div>

          <!-- Q2: Top-Right (Pas urgent & Important) -->
          <div class="eisenhower-quadrant-bg-title"
               role="button"
               tabindex="0"
               style="position:absolute;top:18px;right:20px;text-align:right;color:${q2Meta.color};"
               onclick="openQuadrantDetailOverlay('Q2')"
               onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openQuadrantDetailOverlay('Q2');}"
               title="${escA(t('todo.clickToOpenQuadrantOverlay', { quadrant: q2Meta.actionTitle }) || `${q2Meta.actionTitle} - ${q2Meta.desc}`)}">
            <div class="q-title-header" style="justify-content:flex-end;">
              <span class="q-title-action">${escH(q2Meta.actionTitle)}</span>
              <span class="q-title-count">(${countQ2})</span>
            </div>
            <div class="q-title-motto">${escH(q2Meta.motto)}</div>
          </div>

          <!-- Q3: Bottom-Left (Urgent & Pas important) -->
          <div class="eisenhower-quadrant-bg-title"
               role="button"
               tabindex="0"
               style="position:absolute;bottom:18px;left:20px;color:${q3Meta.color};"
               onclick="openQuadrantDetailOverlay('Q3')"
               onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openQuadrantDetailOverlay('Q3');}"
               title="${escA(t('todo.clickToOpenQuadrantOverlay', { quadrant: q3Meta.actionTitle }) || `${q3Meta.actionTitle} - ${q3Meta.desc}`)}">
            <div class="q-title-header">
              <span class="q-title-action">${escH(q3Meta.actionTitle)}</span>
              <span class="q-title-count">(${countQ3})</span>
            </div>
            <div class="q-title-motto">${escH(q3Meta.motto)}</div>
          </div>

          <!-- Q4: Bottom-Right (Pas urgent & Pas important) -->
          <div class="eisenhower-quadrant-bg-title"
               role="button"
               tabindex="0"
               style="position:absolute;bottom:18px;right:20px;text-align:right;color:${q4Meta.color};"
               onclick="openQuadrantDetailOverlay('Q4')"
               onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openQuadrantDetailOverlay('Q4');}"
               title="${escA(t('todo.clickToOpenQuadrantOverlay', { quadrant: q4Meta.actionTitle }) || `${q4Meta.actionTitle} - ${q4Meta.desc}`)}">
            <div class="q-title-header" style="justify-content:flex-end;">
              <span class="q-title-action">${escH(q4Meta.actionTitle)}</span>
              <span class="q-title-count">(${countQ4})</span>
            </div>
            <div class="q-title-motto">${escH(q4Meta.motto)}</div>
          </div>

          <!-- Perpendicular Dotted Axis Crosshair Lines -->
          <div class="eisenhower-guide-line eisenhower-guide-x" id="eisenhower-guide-x"></div>
          <div class="eisenhower-guide-line eisenhower-guide-y" id="eisenhower-guide-y"></div>

          <!-- Integrated Translucent Glassmorphic Axis Pills -->
          <div class="eisenhower-axis-pill-left" id="axis-pill-left">
            <span>${t('todo.urgentAxis') || '⚡ URGENT ←'}</span>
            <span class="axis-pill-pct" id="axis-pill-pct-urgent"></span>
          </div>

          <div class="eisenhower-axis-pill-right" id="axis-pill-right">
            <span>${t('todo.notUrgentAxis') || 'PAS URGENT →'}</span>
            <span class="axis-pill-pct" id="axis-pill-pct-not-urgent"></span>
          </div>

          <div class="eisenhower-axis-pill-top" id="axis-pill-top">
            <span>${t('todo.importantAxisTop') || '⭐ IMPORTANT ↑'}</span>
            <span class="axis-pill-pct" id="axis-pill-pct-important"></span>
          </div>

          <div class="eisenhower-axis-pill-bottom" id="axis-pill-bottom">
            <span>${t('todo.notImportantAxisBottom') || 'PAS IMPORTANT ↓'}</span>
            <span class="axis-pill-pct" id="axis-pill-pct-not-important"></span>
          </div>

          ${dotsHtml}
        </div>
      </div>
      ${doneLaneHtml}
      ${renderDelegatedTasksGanttHtml()}
    </div>`;

  const canvasEl = document.getElementById('eisenhower-map-canvas');
  if (canvasEl) {
    canvasEl.ondblclick = (e) => {
      if (e.target.closest('.eisenhower-task-text') || e.target.closest('.eisenhower-quadrant-bg-title')) return;
      const rect = canvasEl.getBoundingClientRect();
      const pctX = Math.max(6, Math.min(94, ((e.clientX - rect.left) / rect.width) * 100));
      const pctY = Math.max(6, Math.min(94, ((e.clientY - rect.top) / rect.height) * 100));
      const quad = (typeof EisenhowerUtils !== 'undefined' && EisenhowerUtils.getQuadrantFromCoords)
        ? EisenhowerUtils.getQuadrantFromCoords(pctX, pctY)
        : (pctX < 50 ? (pctY < 50 ? 'Q1' : 'Q3') : (pctY < 50 ? 'Q2' : 'Q4'));
      const pri = (typeof EisenhowerUtils !== 'undefined' && EisenhowerUtils.getPriorityForQuadrant)
        ? EisenhowerUtils.getPriorityForQuadrant(quad)
        : (quad === 'Q1' ? 'High' : quad === 'Q2' ? 'Medium' : 'Low');

      openNewTodoDialog({
        priority: pri,
        eisenhowerQuadrant: quad,
        eisenhowerX: Math.round(pctX * 10) / 10,
        eisenhowerY: Math.round(pctY * 10) / 10
      });
    };
  }

  initScatterplotDragAndDrop();
  if (typeof initGanttDragAndResize === 'function') initGanttDragAndResize();

  // If quick popover was active before redraw, preserve it without closing
  if (_eisenhowerQuickPopover && _activePopoverTodoId) {
    const refreshedDot = document.querySelector(`.eisenhower-task-text[data-todo-id="${_activePopoverTodoId}"]`);
    if (refreshedDot) {
      _activePopoverTargetEl = refreshedDot;
      if (typeof positionEisenhowerQuickActionPopover === 'function') {
        positionEisenhowerQuickActionPopover(_eisenhowerQuickPopover, refreshedDot);
      }
    } else {
      closeEisenhowerQuickActionPopover(true);
    }
  }
}

function handleScatterDotKeyDown(event, todoId) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    const dot = event.currentTarget || (event.target && event.target.closest ? event.target.closest('.eisenhower-task-text') : null);
    showEisenhowerQuickActionPopover(event, todoId, dot);
    return;
  }
  if (event.key === 's' || event.key === 'S') {
    event.preventDefault();
    toggleTodoHighPriority(todoId);
    return;
  }
  if (['1', '2', '3', '4'].includes(event.key)) {
    event.preventDefault();
    const todo = getTodoById(todoId);
    if (!todo) return;
    const q = 'Q' + event.key;
    todo.eisenhowerQuadrant = q;
    todo.priority = (typeof EisenhowerUtils !== 'undefined')
      ? EisenhowerUtils.getPriorityForQuadrant(q)
      : (q === 'Q1' ? 'High' : q === 'Q2' ? 'Medium' : 'Low');
    const def = (typeof EisenhowerUtils !== 'undefined' && EisenhowerUtils.getDefaultCoordsForQuadrant)
      ? EisenhowerUtils.getDefaultCoordsForQuadrant(q, todo.id)
      : { x: 50, y: 50 };
    todo.eisenhowerX = def.x;
    todo.eisenhowerY = def.y;
    if (typeof saveTodosManifest === 'function') saveTodosManifest();
    renderTodosBoard();
    return;
  }
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
    event.preventDefault();
    const todo = getTodoById(todoId);
    if (!todo) return;
    let x = typeof todo.eisenhowerX === 'number' ? todo.eisenhowerX : 50;
    let y = typeof todo.eisenhowerY === 'number' ? todo.eisenhowerY : 50;
    const step = 4;
    if (event.key === 'ArrowLeft') x = Math.max(8, x - step);
    if (event.key === 'ArrowRight') x = Math.min(92, x + step);
    if (event.key === 'ArrowUp') y = Math.max(8, y - step);
    if (event.key === 'ArrowDown') y = Math.min(92, y + step);

    todo.eisenhowerX = Math.round(x * 10) / 10;
    todo.eisenhowerY = Math.round(y * 10) / 10;
    
    const newQuad = (typeof EisenhowerUtils !== 'undefined')
      ? EisenhowerUtils.getQuadrantFromCoords(x, y)
      : (x < 50 ? (y < 50 ? 'Q1' : 'Q3') : (y < 50 ? 'Q2' : 'Q4'));
    
    todo.eisenhowerQuadrant = newQuad;
    todo.priority = (typeof EisenhowerUtils !== 'undefined')
      ? EisenhowerUtils.getPriorityForQuadrant(newQuad)
      : (newQuad === 'Q1' ? 'High' : newQuad === 'Q2' ? 'Medium' : 'Low');

    if (typeof saveTodosManifest === 'function') saveTodosManifest();
    renderTodosBoard();
  }
}

function showNewTodoInQuadrant(quadrant) {
  const priority = quadrant === 'Q1' ? 'High' : quadrant === 'Q2' ? 'Medium' : 'Low';
  openNewTodoDialog({
    priority,
    eisenhowerQuadrant: quadrant
  });
}

function renderTodoCard(todo, rank) {
  const display = getCleanTaskTitle(todo);
  const priority = todo.priority;
  const quadrant = getTodoQuadrant(todo);
  const isDone = priority === 'Done';
  const isWontDo = typeof isTodoWontDo === 'function' ? isTodoWontDo(todo) : (todo.status === 'wont_do');
  const isWip = isTodoWip(todo) && !isDone && !isWontDo;
  const isHighStar = Boolean(todo.isHighPriority);
  const badgeCls = isDone ? 'sl-badge-done' : isWontDo ? 'sl-badge-wontdo' : isWip ? 'sl-badge-wip' : quadrant === 'Q1' ? 'sl-badge-high' : quadrant === 'Q2' ? 'sl-badge-med' : 'sl-badge-low';
  const qBadgeMap = {
    Q1: `⚡ ${getQuadrantMeta('Q1').shortLabel}`,
    Q2: `☕ ${getQuadrantMeta('Q2').shortLabel}`,
    Q3: `💬 ${getQuadrantMeta('Q3').shortLabel}`,
    Q4: `🌱 ${getQuadrantMeta('Q4').shortLabel}`
  };
  const badgeText = isDone && todo.originalPriority ? `${t('todo.done').toUpperCase()} · ${qBadgeMap[quadrant] || quadrant}` : isWontDo ? (t('todo.statusWontDo') || "Won't Do") : isWip ? t('todo.wip') : (qBadgeMap[quadrant] || quadrant);
  const badgeHtml = (isWip || isDone || isWontDo) ? `<span class="sl-badge ${badgeCls} todo-priority-badge todo-priority-${(isDone ? 'done' : isWontDo ? 'wontdo' : isWip ? 'wip' : priority).toLowerCase()}" style="margin-left:auto">${escH(badgeText)}</span>` : '';

  const linkedNote = todo.noteId ? getNoteById(todo.noteId) : null;
  const dueInfo = getTodoDueDateInfo(todo);
  const isManagerTask = typeof isAskedByManagerChain === 'function' && isAskedByManagerChain(todo);

  const plannerAssoc = typeof getTodoPlannerAssociations === 'function' ? getTodoPlannerAssociations(todo.id) : { workSessions: [], meetings: [] };
  const hasWorkSession = plannerAssoc.workSessions.length > 0;
  const hasMeeting = plannerAssoc.meetings.length > 0;
  const hasNextStep = hasWorkSession || hasMeeting;

  const metaParts = [];
  const ownerLabel = getTodoOwnerLabel(todo);
  if (ownerLabel) metaParts.push(`👤 ${ownerLabel}`);
  const askedByLabel = typeof getTodoAskedByLabel === 'function' ? getTodoAskedByLabel(todo) : '';
  if (askedByLabel) metaParts.push(`⭐ ${askedByLabel}`);
  if (dueInfo) metaParts.push(`📅 ${dueInfo.date} ${dueInfo.bracket}`);
  if (linkedNote?.title) metaParts.push(`↗ ${linkedNote.title}`);
  else if (todo.noteId) metaParts.push(`↗ ${todo.noteId}`);
  const meta = metaParts.join(' · ');
  const context = todo.context ? todo.context : '';
  const rankHtml = rank ? `<span class="todo-rank-badge">#${rank}</span>` : '';

  let badgesHtml = '';
  const wsName = todo.workstream || (Array.isArray(todo.major_topic_tags) && todo.major_topic_tags[0]) || '';
  if (wsName) {
    const wsIcon = (typeof AppIcons !== 'undefined' && AppIcons.get) ? AppIcons.get('workstream', { size: 11 }) : '';
    badgesHtml += `<span class="sl-badge todo-badge-workstream" title="${escA((t('todo.workstreamLabel') || 'Workstream') + ': ' + wsName)}">${wsIcon} <span>${escH(wsName)}</span></span> `;
  }
  const isBlocked = typeof TaskGraphEngine !== 'undefined' && TaskGraphEngine.isBlocked(todo.id);
  const blockers = isBlocked ? TaskGraphEngine.getUnresolvedBlockers(todo.id) : [];
  if (isBlocked && !isDone) {
    const blockerNames = blockers.map(b => getCleanTaskTitle(b)).join(', ');
    badgesHtml += `<span class="sl-badge todo-badge-blocked" style="background:rgba(239,68,68,0.15);color:#ef4444;font-weight:600;padding:2px 6px;border-radius:4px;display:inline-flex;align-items:center;gap:3px;" title="${escA((t('todo.blockedBadgeTitle') || 'Blocked by unresolved prerequisites') + ': ' + blockerNames)}">🔒 ${escH(t('todo.blockedBy') || 'Blocked')}</span> `;
  }

  // Checklist badge
  if (Array.isArray(todo.checklist) && todo.checklist.length > 0 && typeof TodoChecklistEngine !== 'undefined') {
    const chkProgress = TodoChecklistEngine.getProgress(todo);
    const chkDone = chkProgress.completed === chkProgress.total;
    badgesHtml += `<span class="sl-badge todo-badge-checklist" style="background:${chkDone ? 'rgba(16,185,129,0.15)' : 'var(--card-border)'};color:${chkDone ? '#10b981' : 'var(--text-muted)'};font-weight:600;padding:2px 6px;border-radius:4px;display:inline-flex;align-items:center;gap:3px;" title="${escA((t('todo.checklistProgress') || 'Subtasks') + ': ' + chkProgress.text)}">☑ ${chkProgress.text}</span> `;
  }

  // Recurrence badge
  if (todo.recurrence && todo.recurrence.enabled) {
    badgesHtml += `<span class="sl-badge todo-badge-recurrence" style="background:rgba(99,102,241,0.15);color:var(--accent);font-weight:600;padding:2px 6px;border-radius:4px;display:inline-flex;align-items:center;gap:3px;" title="${escA((t('todo.recurringTask') || 'Recurring Task') + ' (' + todo.recurrence.freq + ')')}">🔄 ${escH(todo.recurrence.freq)}</span> `;
  }

  if (isManagerTask) {
    const mgrTooltip = askedByLabel ? `Requested by ${askedByLabel}` : (t('todo.fromManager') || 'Manager Requested');
    badgesHtml += `<span class="todo-badge-manager" title="${escA(mgrTooltip)}">⭐ ${escH(t('todo.fromManager') || 'Manager')}</span> `;
  }
  if (hasWorkSession) {
    const ws = plannerAssoc.workSessions[0];
    badgesHtml += `<span class="todo-badge-work-session" title="${escA(t('todo.workSessionScheduled'))}">📅 ${escH(ws.date || '')} ${escH(ws.startTime || '')}</span> `;
  }
  if (hasMeeting) {
    const mt = plannerAssoc.meetings[0];
    badgesHtml += `<span class="todo-badge-meeting" title="${escA(t('todo.meetingAssociated'))}">🤝 ${escH(mt.title || 'Meeting')}</span> `;
  }

  if (todo.assignmentStatus === 'pending_communication') {
    badgesHtml += `
      <span class="todo-badge-pending-comm" onclick="event.stopPropagation();" title="${escA(t('todo.pendingCommunication'))}">
        💬 ${escH(t('todo.pendingCommunication'))}
        <button class="btn-confirm-comm" onclick="event.stopPropagation();confirmTodoAssignment(${jq(todo.id)})" title="${escA(t('todo.confirmCommunicated'))}">✓ ${escH(t('todo.confirmCommunicated') || 'Confirm')}</button>
      </span>`;
  }

  let urgeDelegateHtml = '';
  if (quadrant === 'Q3' && !isDone && (!todo.ownerId || todo.ownerId === 'me' || !todo.owner)) {
    const directs = typeof getColleagueDirects === 'function' ? getColleagueDirects('me') : [];
    if (directs.length > 0) {
      const options = directs.map(d => `<option value="${escA(d.id)}">${escH(d.label || d.id)}</option>`).join('');
      urgeDelegateHtml = `
        <div class="todo-urge-delegate-box" onclick="event.stopPropagation();">
          <span>⚠️ ${escH(t('todo.urgeDelegate') || 'Urged to Delegate')}:</span>
          <select class="todo-delegate-select" onclick="event.stopPropagation();" onmousedown="event.stopPropagation();" onchange="event.stopPropagation();assignTodoToDirectReport(${jq(todo.id)}, this.value)" title="${escA(t('todo.assignToDirectReportTooltip') || 'Select a team member to delegate this task to')}">
            <option value="">-- ${escH(t('todo.assignToDirectReport') || 'Assign')} --</option>
            ${options}
          </select>
        </div>`;
    }
  }

  const starToggleHtml = `
    <button class="todo-star-toggle${isHighStar ? ' starred' : ''}" onclick="event.stopPropagation();toggleTodoHighPriority(${jq(todo.id)})" aria-label="${escA(t('todo.starPriority') || 'Star priority')}" aria-pressed="${isHighStar}" title="${escA(t('todo.starPriority'))}">
      ${isHighStar ? '★' : '☆'}
    </button>`;

  const askedById = typeof getTodoAskedById === 'function' ? getTodoAskedById(todo) : '';
  const isImportant = askedById && typeof isColleagueImportant === 'function' && isColleagueImportant(askedById);

  return `<div class="sl-card todo-board-card${isHighStar ? ' todo-high-priority' : ''}${hasNextStep ? ' todo-commitment-ring' : ''}${isWip ? ' todo-board-card-wip' : ''}${isWontDo ? ' todo-board-card-wontdo' : ''}${isDone ? ' todo-board-card-done' : ''}${dueInfo ? ` ${dueInfo.urgencyClass}` : ''}${isImportant ? ' todo-board-card-important' : ''}" draggable="true"
   data-todo-id="${escA(todo.id)}" data-priority="${escA(priority)}" data-quadrant="${escA(quadrant)}"
   onclick="openTodoOverlay(${jq(todo.id)})"
   oncontextmenu="return showTodoCardContextMenu(event, ${jq(todo.id)})"
   title="${escA(t('todo.clickToOpen'))}"
   >
   <div class="todo-card-header">
     <span class="grip-icon">⠿</span>
     ${starToggleHtml}
     ${rankHtml}
     ${badgeHtml}
   </div>
   <div class="todo-card-title">${escH(display)}</div>
   ${badgesHtml ? `<div style="margin-top:0.2rem; display:flex; flex-wrap:wrap; gap:3px;">${badgesHtml}</div>` : ''}
   ${urgeDelegateHtml}
   ${meta ? `<div class="todo-card-meta">${escH(meta)}</div>` : '<div class="todo-card-meta empty"></div>'}
   ${context ? `<div class="todo-card-context">${escH(context)}</div>` : '<div class="todo-card-context empty"></div>'}
  </div>`;
}

window.assignTodoToDirectReport = async function(todoId, directReportId) {
  if (!directReportId) return;
  const todo = getTodoById(todoId);
  if (!todo) return;
  todo.ownerId = directReportId;
  todo.owner = (typeof getColleagueLabelById === 'function') ? getColleagueLabelById(directReportId) : directReportId;
  if (!todo.askedById) todo.askedById = 'me';
  todo.assignmentStatus = 'pending_communication';
  todo.assignmentConfirmed = false;
  todo.modified = new Date().toISOString().slice(0, 10);
  if (typeof saveTodosManifest === 'function') await saveTodosManifest();
  if (typeof renderTodosBoard === 'function') renderTodosBoard();
  if (typeof toast === 'function') toast(`Assigned to ${todo.owner} (${t('todo.pendingCommunication') || 'Pending Comm'})`);
};

function closeTodoContextMenu() {
  if (todoContextMenuHandlers?.close) document.removeEventListener('click', todoContextMenuHandlers.close);
  if (todoContextMenuHandlers?.esc) document.removeEventListener('keydown', todoContextMenuHandlers.esc);
  todoContextMenuHandlers = null;
  if (todoContextMenu) {
   todoContextMenu.remove();
   todoContextMenu = null;
  }
}

function showTodoCardContextMenu(e, todoId) {
  e.preventDefault();
  e.stopPropagation();
  const todo = getTodoById(todoId);
  if (!todo) return false;

  closeTodoContextMenu();

  const menu = document.createElement('div');
  menu.className = 'note-card-context-menu todo-card-context-menu';
  menu.style.position = 'absolute';
  menu.style.top = `${e.pageY}px`;
  menu.style.left = `${e.pageX}px`;
  menu.style.zIndex = 2000;

  const makeBtn = (text, tooltip, fn, extraCls = '') => {
   const btn = document.createElement('button');
   btn.className = `ctx-btn${extraCls ? ' ' + extraCls : ''}`;
   btn.innerHTML = text;
   btn.title = tooltip;
   btn.addEventListener('click', async ev => {
     ev.stopPropagation();
     try {
       await fn();
     } catch (err) {
       console.warn(err);
     }
     closeTodoContextMenu();
   });
   return btn;
  };

  menu.appendChild(makeBtn(btnLabel('✏️', 'todo.editTodo', 'Edit Todo'), t('todo.editTodoTooltip'), async () => openTodoOverlayInEditMode(todoId)));
  
  menu.appendChild(makeBtn(btnLabel('📅', 'todo.scheduleWorkSession', 'Schedule Work Session'), t('todo.scheduleWorkSession'), async () => {
    const cleanTitle = typeof getCleanTaskTitle === 'function' ? getCleanTaskTitle(todo) : (todo.title || todoId);
    if (typeof quickScheduleTodo === 'function') quickScheduleTodo(todoId, cleanTitle);
    else if (typeof openPlanEventModal === 'function') openPlanEventModal({ type: 'todo', title: cleanTitle, todoId });
  }));

  menu.appendChild(makeBtn(btnLabel('🤝', 'todo.scheduleSyncCall', 'Schedule Sync / Call'), t('todo.scheduleSyncCall'), async () => {
    const cleanTitle = typeof getCleanTaskTitle === 'function' ? getCleanTaskTitle(todo) : (todo.title || todoId);
    if (typeof openPlanEventModal === 'function') {
      openPlanEventModal({
        type: 'sync',
        title: `Sync: ${cleanTitle}`,
        todoId: todo.id,
        linkedTodoIds: [todo.id],
        withWhom: todo.askedBy || todo.owner || ''
      });
    }
  }));

  const directs = typeof getColleagueDirects === 'function' ? getColleagueDirects('me') : [];
  if (directs.length > 0 && todo.priority !== 'Done') {
    directs.forEach(d => {
      menu.appendChild(makeBtn(btnLabel('👤', null, `${t('todo.assignToDirectReport') || 'Assign'}: ${d.label || d.id}`), `Assign to ${d.label || d.id}`, async () => {
        await assignTodoToDirectReport(todo.id, d.id);
      }));
    });
  }

  const isStar = Boolean(todo.isHighPriority);
  menu.appendChild(makeBtn(btnLabel(isStar ? '★' : '☆', null, isStar ? 'Unstar' : 'Star High Priority'), 'Toggle Star Priority', async () => {
    await toggleTodoHighPriority(todoId);
  }));

  if (todo.assignmentStatus === 'pending_communication') {
    menu.appendChild(makeBtn(btnLabel('💬', 'todo.confirmCommunicated', 'Confirm Communicated'), t('todo.confirmCommunicated'), async () => {
      await confirmTodoAssignment(todoId);
    }));
  }

  if (todo.priority !== 'Done') {
    menu.appendChild(makeBtn(
      btnLabel('⏳', todo.status === 'WIP' ? 'todo.clearInProgress' : 'todo.markInProgress', todo.status === 'WIP' ? 'Clear In Progress' : 'Mark In Progress'),
      t('todo.toggleInProgressTooltip'),
      async () => toggleTodoWipById(todoId)
    ));
    menu.appendChild(makeBtn(
      btnLabel('🚫', (todo.status === 'wont_do' || (typeof isTodoWontDo === 'function' && isTodoWontDo(todo))) ? 'todo.clearWontDo' : 'todo.markWontDo', (todo.status === 'wont_do' || (typeof isTodoWontDo === 'function' && isTodoWontDo(todo))) ? "Clear Won't Do" : "Won't Do"),
      t('todo.markWontDoTooltip') || "Mark this task as won't do",
      async () => setTodoQuickStatus(todoId, (todo.status === 'wont_do' || (typeof isTodoWontDo === 'function' && isTodoWontDo(todo))) ? 'pending' : 'wont_do')
    ));
  }

  if (todo.priority === 'Done') {
    const quad = getTodoQuadrant(todo);
    const lbl = `${t('todo.reopenAs') || 'Reopen in'} ${escH(quad)}`;
    menu.appendChild(makeBtn(btnLabel('↩', null, lbl), t('todo.reopenAsTooltip'), async () => await reopenTodoById(todoId, todo.originalPriority || 'Medium')));
  } else {
    menu.appendChild(makeBtn(btnLabel('✅', 'todo.setDone', 'Set Done'), t('todo.setDoneTooltip'), async () => await setTodoDoneById(todoId)));
  }
  menu.appendChild(makeBtn(btnLabel('🗑️', 'todo.delete', 'Delete'), t('todo.deleteTooltip'), async () => deleteTodoById(todoId), 'danger'));
  document.body.appendChild(menu);
  todoContextMenu = menu;

  const rect = menu.getBoundingClientRect();
  const clampedX = Math.max(12, Math.min(e.pageX, window.innerWidth + window.scrollX - rect.width - 12));
  const clampedY = Math.max(12, Math.min(e.pageY, window.innerHeight + window.scrollY - rect.height - 12));
  menu.style.left = `${clampedX}px`;
  menu.style.top = `${clampedY}px`;

  const closeOnOutsideClick = ev => {
   if (!menu.contains(ev.target)) closeTodoContextMenu();
  };
  const closeOnEsc = ev => {
   if (ev.key === 'Escape') closeTodoContextMenu();
  };
  todoContextMenuHandlers = { close: closeOnOutsideClick, esc: closeOnEsc };

  setTimeout(() => {
    if (todoContextMenu === menu) document.addEventListener('click', closeOnOutsideClick);
  }, 0);
  document.addEventListener('keydown', closeOnEsc);
  return false;
}

async function updateTodoLinkedNote(todo, newTitle, newPriority, originalPriority = '', newStatus = '') {
  if (!todo?.noteId) return;
  const linkedNote = getNoteById(todo.noteId);
  if (!linkedNote?.path) return;
  try {
   let html = await StorageAPI.readNoteContent(linkedNote.path);
   html = updateNoteTodoMarkerInHTML(html, todo.noteTodoMarkerId || todo.id, newTitle, newPriority, originalPriority, newStatus);
   await StorageAPI.writeNoteContent(linkedNote.path, html);
   if (currentNote && currentNote.path === linkedNote.path) {
     currentNote.originalHTML = html;
     currentNote.mainHTML = new DOMParser().parseFromString(html, 'text/html').querySelector('main')?.innerHTML || currentNote.mainHTML;
     syncPreview();
     const ta = document.getElementById('edit-textarea');
     if (ta) {
        if (ta.contentEditable === 'true') {
          const marker = ta.querySelector(`[data-todo-id="${todo.noteTodoMarkerId || todo.id}"]`);
          if (marker) {
            marker.setAttribute('data-todo-priority', newPriority);
            if (originalPriority) marker.setAttribute('data-todo-original-priority', originalPriority);
            else marker.removeAttribute('data-todo-original-priority');
            if (newStatus) marker.setAttribute('data-todo-status', newStatus);
            else marker.removeAttribute('data-todo-status');
            ta.dispatchEvent(new Event('input', { bubbles: true }));
          }
        } else {
          const cursorStart = ta.selectionStart;
          const cursorEnd = ta.selectionEnd;
          ta.value = patchNoteSpanInText(ta.value, todo.noteTodoMarkerId || todo.id, {
            setAttr: {
              'data-todo-priority': newPriority,
              'data-todo-original-priority': originalPriority || todo.originalPriority || '',
              'data-todo-status': newStatus
            }
          });
          ta.selectionStart = cursorStart;
          ta.selectionEnd = cursorEnd;
        }
      }
      if (typeof renderInspectorPanel === 'function') {
        renderInspectorPanel().catch(err => console.warn('Could not re-render inspector panel', err));
      }
    }
    if (typeof notifyDailyReviewNoteChanged === 'function') {
      notifyDailyReviewNoteChanged(linkedNote.path, { todoId: todo.id });
    }
  } catch (e) {
   console.warn('Could not update note span', e);
  }
}

async function removeTodoFromAllNotes(todoId, fallbackTitle = 'todo') {
  if (typeof manifest === 'undefined' || !Array.isArray(manifest) || manifest.length === 0) return;

  const totalNotes = manifest.length;
  const chunkSize = Math.max(1, Math.ceil(totalNotes / 10));
  const steps = [];
  const title = t('confirm.deleteTodoTitle') || 'Cleaning up note references...';

  for (let i = 0; i < totalNotes; i += chunkSize) {
    const chunk = manifest.slice(i, i + chunkSize);
    const percentage = Math.round(((i + chunk.length) / totalNotes) * 100);
    const label = (typeof t === 'function' && t('todo.scanningNotesProgress'))
      ? t('todo.scanningNotesProgress', { current: i + 1, total: totalNotes })
      : `Scanning notes ${i + 1} - ${Math.min(totalNotes, i + chunk.length)} of ${totalNotes}...`;

    steps.push({
      label: label,
      percentage: percentage,
      duration: 1,
      action: async () => {
        for (const entry of chunk) {
          if (!entry || !entry.path) continue;
          try {
            let html = await StorageAPI.readNoteContent(entry.path);
            if (!html || !html.includes(todoId)) continue;

            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const marker = doc.querySelector(`[data-todo-id="${todoId}"]`);
            if (marker) {
              const textSpan = marker.querySelector('.note-todo-text');
              const todoText = (textSpan ? textSpan.textContent.trim() : marker.textContent.replace(/^todo urgency:\s*(?:High|Medium|Low|Q1|Q2|Q3|Q4|\s*)*/i, '').trim()) || fallbackTitle;
              const textNode = doc.createTextNode(todoText);
              marker.parentNode.replaceChild(textNode, marker);

              const nextHtml = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
              await StorageAPI.writeNoteContent(entry.path, nextHtml);

              if (currentNote && currentNote.path === entry.path) {
                currentNote.originalHTML = nextHtml;
                currentNote.mainHTML = doc.querySelector('main')?.innerHTML || currentNote.mainHTML;

                const ta = document.getElementById('edit-textarea');
                if (ta) {
                  const isRich = ta.contentEditable === 'true';
                  if (isRich) {
                    const editorMarker = ta.querySelector(`[data-todo-id="${todoId}"]`);
                    if (editorMarker) {
                      const editorTextSpan = editorMarker.querySelector('.note-todo-text');
                      const editorTodoText = (editorTextSpan ? editorTextSpan.textContent.trim() : editorMarker.textContent.replace(/^todo urgency:\s*(?:High|Medium|Low|Q1|Q2|Q3|Q4|\s*)*/i, '').trim()) || fallbackTitle;
                      const editorTextNode = document.createTextNode(editorTodoText);
                      editorMarker.parentNode.replaceChild(editorTextNode, editorMarker);
                    }
                  } else {
                    const regex = new RegExp(`\\{todo:[a-zA-Z]+:${todoId}(?::[a-zA-Z]+)?\\|([^\\}]+)\\}`, 'g');
                    ta.value = ta.value.replace(regex, (match, text) => text);
                  }
                  ta.dispatchEvent(new Event('input', { bubbles: true }));
                }
                if (typeof syncPreview === 'function') syncPreview();
                if (typeof renderInspectorPanel === 'function') {
                  renderInspectorPanel().catch(err => console.warn('Could not re-render inspector panel', err));
                }
              }
            }
          } catch (err) {
            console.warn(`Failed to remove todo ${todoId} from note ${entry.path}:`, err);
          }
        }
      }
    });
  }

  if (typeof showProgressDialog === 'function') {
    await showProgressDialog(title, steps);
  } else {
    for (const step of steps) {
      if (step.action) await step.action();
    }
  }
}

async function deleteTodoById(todoId, { confirmDelete = true } = {}) {
  const todo = getTodoById(todoId);
  if (!todo) return false;
  if (confirmDelete) {
    const confirmed = await showConfirmDialog(t('confirm.deleteTodo', { name: todo.title || todo.id }), { isDanger: true, confirmLabel: t('todo.delete') || 'Delete' });
    if (!confirmed) return false;
  }
  
  await removeTodoFromAllNotes(todoId, todo.title || 'todo');

  todosManifest = todosManifest.filter(t => t.id !== todoId);
  await saveTodosManifest({ deletedIds: [todoId] });
  if (_todoOverlayFile === todoId) closeTodoOverlay();
  toast(t('common.todoDeleted'));
  if (typeof refreshTodoViews === 'function') refreshTodoViews();
  return true;
}

async function setTodoDoneById(todoId) {
  const todo = getTodoById(todoId);
  if (!todo || todo.priority === 'Done') return false;
  const previousPriority = todo.priority;
  const previousStatus = todo.status || '';

  // Track blocked dependents before completing
  const dependents = (typeof TaskGraphEngine !== 'undefined') ? TaskGraphEngine.getDependents(todoId) : [];
  const previouslyBlockedMap = new Map();
  dependents.forEach(dep => {
    previouslyBlockedMap.set(dep.id, TaskGraphEngine.isBlocked(dep.id));
  });

  changeTodoPriority(todoId, 'Done');
  await updateTodoLinkedNote(todo, todo.title || '', 'Done', todo.originalPriority || previousPriority || '', previousStatus);
  await saveTodosManifest();

  const undoFn = async () => {
    const tObj = getTodoById(todoId);
    if (!tObj) return;
    const restorePri = tObj.originalPriority || previousPriority || (tObj.eisenhowerQuadrant || 'Q2');
    tObj.priority = restorePri;
    tObj.status = previousStatus || '';
    tObj.modified = new Date().toISOString().slice(0, 10);
    await updateTodoLinkedNote(tObj, tObj.title, tObj.priority, tObj.originalPriority || '', 'Done');
    if (typeof saveTodosManifest === 'function') await saveTodosManifest();
    if (typeof StateBus !== 'undefined') StateBus.emit(`todo:update:${tObj.id}`, { todo: tObj });
    if (typeof refreshTodoViews === 'function') refreshTodoViews();
    else if (typeof renderTodosBoard === 'function') renderTodosBoard();
  };

  toastAction(t('common.todoMarkedDone') || 'Task marked as completed', t('common.undo') || 'Undo', undoFn, 10000);

  // Check for newly unblocked tasks
  dependents.forEach(dep => {
    const wasBlocked = previouslyBlockedMap.get(dep.id);
    const isNowBlocked = TaskGraphEngine.isBlocked(dep.id);
    if (wasBlocked && !isNowBlocked) {
      toast(t('todo.unblockedToast', { title: getCleanTaskTitle(dep) }) || `🔓 "${getCleanTaskTitle(dep)}" is now ready to begin!`);
      if (typeof StateBus !== 'undefined') StateBus.emit('todo:unblocked', { todo: dep, unblockedBy: todo });
    }
  });

  if (typeof StateBus !== 'undefined') StateBus.emit('todo:completed', { todo });
  if (typeof refreshTodoViews === 'function') refreshTodoViews();
  return true;
}

async function reopenTodoById(todoId, newPriority = 'Medium') {
  const todo = getTodoById(todoId);
  if (!todo) return false;
  changeTodoPriority(todoId, newPriority);
  
  const targetQuad = (typeof EisenhowerUtils !== 'undefined') ? EisenhowerUtils.getQuadrant(todo) : 'Q2';
  todo.eisenhowerQuadrant = targetQuad;
  
  await updateTodoLinkedNote(todo, todo.title || '', newPriority, '', todo.status || '');
  await saveTodosManifest();
  toast(t('common.todoReopened', { priority: t(`todo.${newPriority.toLowerCase()}`) }));
  if (typeof refreshTodoViews === 'function') refreshTodoViews();
  return true;
}

async function toggleTodoWipById(todoId) {
  const todo = getTodoById(todoId);
  if (!todo || todo.priority === 'Done') return false;
  const previousPriority = todo.priority;
  const nextStatus = (todo.status || '') === 'WIP' ? '' : 'WIP';
  changeTodoStatus(todoId, nextStatus);
  await updateTodoLinkedNote(todo, todo.title || '', todo.priority, todo.originalPriority || previousPriority || '', todo.status || '');
  await saveTodosManifest();
  toast(nextStatus === 'WIP' ? t('todo.markInProgress') : t('todo.clearInProgress'));
  if (typeof refreshTodoViews === 'function') refreshTodoViews();
  return true;
}

async function openTodoOverlayInEditMode(todoId) {
  await openTodoOverlay(todoId, { edit: true });
}

// ═══ Todos Board Drag & Drop ═══
let _draggingTodoId = null;

function updateNewTodoPinColor(priorityValue) {
  const pin = document.getElementById('nt-priority-pin');
  if (!pin) return;
  const q = String(priorityValue || '').toUpperCase();
  let color = '#f59e0b';
  if (q === 'Q1' || q === 'HIGH') color = '#ef4444';
  else if (q === 'Q2' || q === 'MEDIUM') color = '#f59e0b';
  else if (q === 'Q3' || q === 'LOW') color = '#6366f1';
  else if (q === 'Q4') color = '#14b8a6';
  else if (q === 'WIP') color = '#7c3aed';
  pin.style.color = color;
}
window.updateNewTodoPinColor = updateNewTodoPinColor;

async function populateTodoWorkstreamDropdown(selectedWorkstream = '') {
  const wsSel = document.getElementById('todo-edit-workstream');
  if (!wsSel) return;
  let wsOptions = (typeof getKnownWorkstreamsList === 'function')
    ? getKnownWorkstreamsList()
    : [];

  const currentWs = String(selectedWorkstream || '').trim();
  const matchedOpt = currentWs ? wsOptions.find(w => w.toLowerCase() === currentWs.toLowerCase()) : null;
  if (currentWs && !matchedOpt) {
    wsOptions = [currentWs, ...wsOptions];
  }

  const defaultLabel = t('todo.unassignedWorkstream') || '-- None / Unassigned --';
  wsSel.innerHTML = `<option value="">${escH(defaultLabel)}</option>` +
    wsOptions.map(name => `<option value="${escA(name)}">${escH(name)}</option>`).join('');
  wsSel.value = matchedOpt || currentWs;
}
window.populateTodoWorkstreamDropdown = populateTodoWorkstreamDropdown;

async function openNewTodoDialog(options = {}) {
  if (typeof removeEisenhowerDraftDot === 'function') removeEisenhowerDraftDot();
  const {
    priority = 'Medium',
    ownerId = 'me',
    owner = '',
    askedById = '',
    askedBy = '',
    focusTitle = true,
    eisenhowerQuadrant = null,
    eisenhowerX = null,
    eisenhowerY = null,
    title = '',
    context = '',
    workstream = '',
  } = options;

  _todoModalQuadrant = eisenhowerQuadrant || (priority && ['Q1','Q2','Q3','Q4'].includes(priority) ? priority : 'Q2');
  if (typeof eisenhowerX === 'number' && typeof eisenhowerY === 'number') {
    _todoModalEisenhowerX = eisenhowerX;
    _todoModalEisenhowerY = eisenhowerY;
  } else {
    const defCoords = (typeof EisenhowerUtils !== 'undefined' && EisenhowerUtils.getDefaultCoordsForQuadrant)
      ? EisenhowerUtils.getDefaultCoordsForQuadrant(_todoModalQuadrant === 'Done' ? 'Q2' : _todoModalQuadrant, 'new_todo')
      : { x: 25, y: 25 };
    _todoModalEisenhowerX = defCoords.x;
    _todoModalEisenhowerY = defCoords.y;
  }

  const overlay = document.getElementById('todo-edit-overlay');
  if (!overlay) return;

  const noteOverlay = document.getElementById('note-edit-overlay');
  const noteOverlayVisible = noteOverlay && noteOverlay.style.display !== 'none';
  const noteZ = noteOverlayVisible ? (parseInt(noteOverlay.style.zIndex || window.getComputedStyle(noteOverlay).zIndex || '1000', 10) || 1000) : 0;
  const plannerModal = document.getElementById('planner-dynamic-modal');
  const plannerVisible = plannerModal && plannerModal.style.display !== 'none' && plannerModal.classList.contains('active');
  if (noteOverlayVisible) {
    overlay.style.zIndex = String(Math.max(noteZ + 50, 4000));
  } else if (plannerVisible) {
    overlay.style.zIndex = '3000';
  } else {
    overlay.style.zIndex = '1001';
  }

  const titleInp = document.getElementById('todo-edit-title');
  if (titleInp) titleInp.value = title;

  const quadSel = document.getElementById('todo-edit-quadrant');
  if (quadSel) quadSel.value = _todoModalQuadrant;

  await populateTodoWorkstreamDropdown(workstream);

  updateTodoDueDateDisplay('');
  setTodoModalStatus('pending');

  if (typeof populateCollaboratorPicker === 'function') {
    populateCollaboratorPicker('todo-edit-owner-picker', ownerId || owner || 'me', {
      allowEmpty: false,
      includeMe: true,
      createOnType: true,
    });
    populateCollaboratorPicker('todo-edit-asked-by-picker', askedById || askedBy || '', {
      allowEmpty: true,
      includeMe: true,
      createOnType: true,
      placeholder: t('todo.askedByPlaceholder') || 'Select requester...',
    });
  }

  const contextTxt = document.getElementById('todo-edit-context');
  if (contextTxt) contextTxt.value = context;

  _todoModalDependsOn = [];
  const depSearch = document.getElementById('todo-edit-depends-search');
  if (depSearch) depSearch.value = '';
  const depList = document.getElementById('todo-edit-depends-list');
  if (depList) depList.style.display = 'none';
  renderTodoDepends('');

  _todoModalDelegatedDate = options.delegatedDate || '';
  _todoModalUpdates = [];
  const delDateInp = document.getElementById('todo-edit-delegated-date');
  if (delDateInp) delDateInp.value = _todoModalDelegatedDate;
  renderTodoUpdatesInModal();

  const mergeBtn = document.getElementById('todo-edit-merge-btn');
  if (mergeBtn) mergeBtn.style.display = 'none';
  closeTodoMergePanel();

  const deleteBtn = document.getElementById('todo-edit-delete-btn');
  if (deleteBtn) deleteBtn.style.display = 'none';

  overlay.style.display = 'flex';
  setTodoOverlayBusy(false);

  if (focusTitle && titleInp) {
    setTimeout(() => {
      titleInp.focus();
      titleInp.setSelectionRange(0, titleInp.value.length);
    }, 0);
  }
}

// ═══ Todo Overlay Edit Mode & Interactive Matrix Picker ═══
let _todoOverlayFile = null;
let _todoOverlayPriority = null;
let _todoModalStatus = 'pending';
let _todoModalDueDate = '';
let _todoModalEisenhowerX = 50;
let _todoModalEisenhowerY = 50;
let _todoModalQuadrant = 'Q2';

function setTodoOverlayBusy(isBusy, state = 'saving') {
  const overlay = document.getElementById('todo-edit-overlay');
  if (!overlay) return;
  const panel = overlay.querySelector('.overlay-panel');
  const indicator = document.getElementById('todo-overlay-indicator');
  const controls = overlay.querySelectorAll('button, input, select, textarea');

  if (panel) panel.classList.toggle('overlay-busy', !!isBusy);
  controls.forEach(el => {
    if (el.id === 'todo-overlay-indicator') return;
    if ('disabled' in el) el.disabled = !!isBusy;
  });

  if (indicator) {
    indicator.className = 'save-indicator' + (isBusy ? ` ${state}` : '');
    indicator.textContent = isBusy ? t('common.saveIndicatorSaving') : '';
  }
}

function getEisenhowerQuadrantLabel(quad) {
  const q = String(quad || 'Q2').toUpperCase();
  if (q === 'Q1') return '⚡ Q1 - Do First';
  if (q === 'Q2') return '☕ Q2 - Schedule';
  if (q === 'Q3') return '💬 Q3 - Delegate';
  if (q === 'Q4') return '🌱 Q4 - Eliminate';
  if (q === 'DONE') return '✅ Done';
  return q;
}

function updateTodoDueDateDisplay(dateStr) {
  _todoModalDueDate = dateStr || '';
  const dueInp = document.getElementById('todo-edit-due-date');
  if (dueInp) dueInp.value = _todoModalDueDate;
  const textEl = document.getElementById('todo-due-display-text');
  const clearBtn = document.getElementById('todo-due-clear-btn');
  if (textEl) {
    if (_todoModalDueDate) {
      textEl.textContent = `📅 ${t('todo.dueDate') || 'Due'}: ${_todoModalDueDate}`;
      textEl.classList.remove('is-empty');
    } else {
      textEl.textContent = t('todo.notSet') || 'Not set';
      textEl.classList.add('is-empty');
    }
  }
  if (clearBtn) {
    clearBtn.style.display = _todoModalDueDate ? 'inline-block' : 'none';
  }
}

function triggerTodoDatePicker() {
  const dueInp = document.getElementById('todo-edit-due-date');
  if (dueInp) {
    if (typeof dueInp.showPicker === 'function') {
      try { dueInp.showPicker(); } catch (e) { dueInp.focus(); }
    } else {
      dueInp.focus();
      dueInp.click();
    }
  }
}

function onTodoDueDateChanged(val) {
  updateTodoDueDateDisplay(val);
}

function clearTodoDueDate() {
  updateTodoDueDateDisplay('');
}

function setTodoModalStatus(status) {
  _todoModalStatus = status || 'pending';
  const group = document.getElementById('todo-status-segmented-group');
  if (group) {
    group.querySelectorAll('.todo-status-seg-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-status') === _todoModalStatus);
    });
  }
  const quadSel = document.getElementById('todo-edit-quadrant');
  if (_todoModalStatus === 'done') {
    if (quadSel) quadSel.value = 'Done';
  } else {
    if (quadSel && quadSel.value === 'Done') {
      quadSel.value = _todoModalQuadrant && _todoModalQuadrant !== 'Done' ? _todoModalQuadrant : 'Q2';
    }
  }
}

function onTodoModalQuadrantChanged(val) {
  _todoModalQuadrant = val;
  if (val === 'Done') {
    setTodoModalStatus('done');
  } else {
    if (_todoModalStatus === 'done') {
      setTodoModalStatus('pending');
    }
    if (['Q1', 'Q2', 'Q3', 'Q4'].includes(val) && typeof EisenhowerUtils !== 'undefined' && EisenhowerUtils.getDefaultCoordsForQuadrant) {
      const def = EisenhowerUtils.getDefaultCoordsForQuadrant(val, _todoOverlayFile || 'temp');
      _todoModalEisenhowerX = def.x;
      _todoModalEisenhowerY = def.y;
    }
  }
}

// ── Associated notes on a task (mirrors the bloc modal's linked-notes UI) ──
function _todoAssocNotesTodo() {
  return _todoOverlayFile ? getTodoById(_todoOverlayFile) : null;
}

function renderTodoAssocNotes(query = '') {
  const container = document.getElementById('todo-edit-assoc-notes-container');
  const listContainer = document.getElementById('todo-edit-assoc-notes-list');
  if (!container) return;
  const todo = _todoAssocNotesTodo();
  const ids = (todo && Array.isArray(todo.linkedNoteIds)) ? todo.linkedNoteIds.slice() : [];
  const primary = String(todo?.noteId || '').trim();

  // Chips: the task's primary/origin note (📝, not removable here) followed by associated notes (🔗).
  container.innerHTML = '';
  const chipIds = [];
  if (primary) chipIds.push(primary);
  ids.forEach(id => { if (id && !chipIds.includes(id)) chipIds.push(id); });

  chipIds.forEach(noteId => {
    const note = (typeof getNoteById === 'function') ? getNoteById(noteId) : (manifest || []).find(n => n.id === noteId);
    if (!note) return;
    const isPrimary = noteId === primary;
    const box = document.createElement('div');
    box.className = 'planner-bloc-box note-type assoc-note';
    box.title = t('planner.openNote') || 'Open Note';
    box.innerHTML = `
      <span class="bloc-icon">${isPrimary ? '📝' : '🔗'}</span>
      <span class="title-text">${escH(note.title || 'Untitled')}</span>
      <span class="meta-text">${escH(note.date || '')}</span>
      ${isPrimary ? '' : `<button type="button" class="remove-btn" title="${t('planner.removeToChange') || 'Remove'}">✕</button>`}
    `;
    box.addEventListener('click', (e) => {
      if (e.target.closest('.remove-btn')) return;
      if (note.path && typeof openNoteOverlay === 'function') openNoteOverlay(note.path);
    });
    const rm = box.querySelector('.remove-btn');
    if (rm) rm.addEventListener('click', async (e) => {
      e.stopPropagation();
      const tdo = _todoAssocNotesTodo();
      if (!tdo || !Array.isArray(tdo.linkedNoteIds)) return;
      tdo.linkedNoteIds = tdo.linkedNoteIds.filter(x => x !== noteId);
      await saveTodosManifest();
      renderTodoAssocNotes(query);
    });
    container.appendChild(box);
  });

  if (!listContainer) return;
  const fl = String(query || '').toLowerCase().trim();
  const taken = new Set(chipIds);
  const notes = (manifest || [])
    .filter(n => n && n.id && !taken.has(n.id))
    .filter(n => !fl || (n.title || '').toLowerCase().includes(fl))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, 50);
  listContainer.innerHTML = '';
  if (notes.length === 0) {
    listContainer.innerHTML = `<div style="font-size:0.75rem;color:var(--text-muted);font-style:italic;padding:0.4rem 0.6rem;">${escH(t('planner.noNotesFound') || 'No notes found.')}</div>`;
    return;
  }
  notes.forEach(note => {
    const item = document.createElement('div');
    item.className = 'planner-dropdown-item';
    const leftPart = document.createElement('div');
    leftPart.style.cssText = 'display:flex; flex-direction:column; gap:2px;';
    const title = document.createElement('span');
    title.style.cssText = 'font-weight:500;';
    title.textContent = note.title || 'Untitled';
    const meta = document.createElement('span');
    meta.className = 'item-meta';
    meta.textContent = note.date || '';
    leftPart.appendChild(title);
    leftPart.appendChild(meta);
    item.appendChild(leftPart);
    item.addEventListener('click', async () => {
      const tdo = _todoAssocNotesTodo();
      if (!tdo) return;
      if (!Array.isArray(tdo.linkedNoteIds)) tdo.linkedNoteIds = [];
      if (!tdo.linkedNoteIds.includes(note.id)) tdo.linkedNoteIds.push(note.id);
      await saveTodosManifest();
      const searchInput = document.getElementById('todo-edit-assoc-notes-search');
      if (searchInput) searchInput.value = '';
      listContainer.style.display = 'none';
      renderTodoAssocNotes('');
    });
    listContainer.appendChild(item);
  });
}
window.renderTodoAssocNotes = renderTodoAssocNotes;

function showTodoAssocNotesDropdown() {
  const listContainer = document.getElementById('todo-edit-assoc-notes-list');
  if (!listContainer) return;
  listContainer.style.display = 'block';
  const query = document.getElementById('todo-edit-assoc-notes-search')?.value || '';
  renderTodoAssocNotes(query);
}
window.showTodoAssocNotesDropdown = showTodoAssocNotesDropdown;

function filterTodoAssocNotes() {
  const query = document.getElementById('todo-edit-assoc-notes-search')?.value || '';
  renderTodoAssocNotes(query);
}
window.filterTodoAssocNotes = filterTodoAssocNotes;

// Close the associate-notes dropdown when clicking outside it.
document.addEventListener('mousedown', (e) => {
  if (!e.target.closest || !e.target.closest('#todo-edit-assoc-notes-search, #todo-edit-assoc-notes-list')) {
    const listContainer = document.getElementById('todo-edit-assoc-notes-list');
    if (listContainer) listContainer.style.display = 'none';
  }
  if (!e.target.closest || !e.target.closest('#todo-edit-depends-search, #todo-edit-depends-list')) {
    const depList = document.getElementById('todo-edit-depends-list');
    if (depList) depList.style.display = 'none';
  }
});

let _todoModalDependsOn = [];

function renderTodoDepends(query = '') {
  const container = document.getElementById('todo-edit-depends-container');
  const listContainer = document.getElementById('todo-edit-depends-list');
  if (!container) return;

  container.innerHTML = '';
  const currentTodoId = _todoOverlayFile || '';

  _todoModalDependsOn.forEach(depId => {
    const depTodo = (typeof getTodoById === 'function') ? getTodoById(depId) : (todosManifest || []).find(t => t.id === depId);
    if (!depTodo) return;
    const isDone = depTodo.priority === 'Done';
    const quad = (typeof getTodoQuadrant === 'function') ? getTodoQuadrant(depTodo) : (depTodo.eisenhowerQuadrant || 'Q2');
    const quadMeta = (typeof getQuadrantMeta === 'function') ? getQuadrantMeta(quad) : { color: '#6366f1' };

    const box = document.createElement('div');
    box.className = 'planner-bloc-box note-type assoc-note' + (isDone ? ' is-done' : '');
    box.title = `${t('todo.prerequisite') || 'Prerequisite'}: ${getCleanTaskTitle(depTodo)} (${isDone ? 'Done' : quad})`;
    box.innerHTML = `
      <span class="bloc-icon" style="color:${quadMeta.color}">${isDone ? '✅' : '🔒'}</span>
      <span class="title-text" style="${isDone ? 'text-decoration:line-through;opacity:0.7;' : ''}">${escH(getCleanTaskTitle(depTodo))}</span>
      <span class="meta-text" style="color:${quadMeta.color};font-weight:600;">${escH(quad)}</span>
      <button type="button" class="remove-btn" title="${t('planner.removeToChange') || 'Remove'}">✕</button>
    `;
    const rm = box.querySelector('.remove-btn');
    if (rm) rm.addEventListener('click', (e) => {
      e.stopPropagation();
      _todoModalDependsOn = _todoModalDependsOn.filter(x => x !== depId);
      renderTodoDepends(query);
    });
    container.appendChild(box);
  });

  if (!listContainer) return;
  const fl = String(query || '').toLowerCase().trim();
  const taken = new Set(_todoModalDependsOn);
  if (currentTodoId) taken.add(currentTodoId);

  const candidateTodos = (todosManifest || [])
    .filter(t => t && t.id && !taken.has(t.id) && (typeof isUserTask === 'function' ? isUserTask(t) : true))
    .filter(t => !fl || getCleanTaskTitle(t).toLowerCase().includes(fl))
    .filter(t => {
      if (!currentTodoId) return true;
      return typeof TaskGraphEngine !== 'undefined' ? TaskGraphEngine.validateNoCircularDependency(currentTodoId, t.id) : true;
    })
    .slice(0, 30);

  listContainer.innerHTML = '';
  if (candidateTodos.length === 0) {
    listContainer.innerHTML = `<div style="font-size:0.75rem;color:var(--text-muted);font-style:italic;padding:0.4rem 0.6rem;">${escH(t('todo.noMatchingPrereqs') || 'No available prerequisite tasks found.')}</div>`;
    return;
  }

  candidateTodos.forEach(cand => {
    const quad = (typeof getTodoQuadrant === 'function') ? getTodoQuadrant(cand) : (cand.eisenhowerQuadrant || 'Q2');
    const quadMeta = (typeof getQuadrantMeta === 'function') ? getQuadrantMeta(quad) : { color: '#6366f1' };
    const item = document.createElement('div');
    item.className = 'planner-dropdown-item';
    item.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:2px; flex:1;">
        <span style="font-weight:500;">${escH(getCleanTaskTitle(cand))}</span>
        <span class="item-meta" style="color:${quadMeta.color};font-weight:600;">${escH(quad)} · ${escH(cand.priority || 'Medium')}</span>
      </div>
    `;
    item.addEventListener('click', () => {
      if (!_todoModalDependsOn.includes(cand.id)) {
        _todoModalDependsOn.push(cand.id);
      }
      const searchInput = document.getElementById('todo-edit-depends-search');
      if (searchInput) searchInput.value = '';
      listContainer.style.display = 'none';
      renderTodoDepends('');
    });
    listContainer.appendChild(item);
  });
}
window.renderTodoDepends = renderTodoDepends;

function showTodoDependsDropdown() {
  const listContainer = document.getElementById('todo-edit-depends-list');
  if (!listContainer) return;
  listContainer.style.display = 'block';
  const query = document.getElementById('todo-edit-depends-search')?.value || '';
  renderTodoDepends(query);
}
window.showTodoDependsDropdown = showTodoDependsDropdown;

function filterTodoDepends() {
  const query = document.getElementById('todo-edit-depends-search')?.value || '';
  renderTodoDepends(query);
}
window.filterTodoDepends = filterTodoDepends;

function handleTodoDependsSearchKeydown(e) {
  const listContainer = document.getElementById('todo-edit-depends-list');
  if (!listContainer) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    listContainer.style.display = 'block';
    const firstItem = listContainer.querySelector('.planner-dropdown-item');
    if (firstItem) {
      firstItem.focus();
      firstItem.scrollIntoView({ block: 'nearest' });
    }
  } else if (e.key === 'Escape') {
    listContainer.style.display = 'none';
  }
}
window.handleTodoDependsSearchKeydown = handleTodoDependsSearchKeydown;

async function openTodoOverlay(todoId, maybeOptions = {}) {
  closeTodoContextMenu();
  const todo = getTodoById(todoId);
  if (!todo) { toast(t('common.todoNotFound'), true); return; }
  _todoOverlayFile = todoId;
  _todoOverlayPriority = todo.priority;
  _todoModalQuadrant = todo.priority === 'Done' ? 'Done' : (getTodoQuadrant(todo) || 'Q2');
  if (typeof todo.eisenhowerX === 'number' && typeof todo.eisenhowerY === 'number') {
    _todoModalEisenhowerX = todo.eisenhowerX;
    _todoModalEisenhowerY = todo.eisenhowerY;
  } else {
    const defCoords = (typeof EisenhowerUtils !== 'undefined' && EisenhowerUtils.getDefaultCoordsForQuadrant)
      ? EisenhowerUtils.getDefaultCoordsForQuadrant(_todoModalQuadrant === 'Done' ? 'Q2' : _todoModalQuadrant, todo.id)
      : { x: 25, y: 25 };
    _todoModalEisenhowerX = defCoords.x;
    _todoModalEisenhowerY = defCoords.y;
  }
  _todoModalDependsOn = Array.isArray(todo.depends_on) ? [...todo.depends_on] : [];

  const overlay = document.getElementById('todo-edit-overlay');
  if (!overlay) return;

  const noteOverlay = document.getElementById('note-edit-overlay');
  const noteOverlayVisible = noteOverlay && noteOverlay.style.display !== 'none';
  const noteZ = noteOverlayVisible ? (parseInt(noteOverlay.style.zIndex || window.getComputedStyle(noteOverlay).zIndex || '1000', 10) || 1000) : 0;
  const plannerModal = document.getElementById('planner-dynamic-modal');
  const plannerVisible = plannerModal && plannerModal.style.display !== 'none' && plannerModal.classList.contains('active');
  if (noteOverlayVisible) {
    overlay.style.zIndex = String(Math.max(noteZ + 50, 4000));
  } else if (plannerVisible) {
    overlay.style.zIndex = '3000';
  } else {
    overlay.style.zIndex = '1001';
  }

  const titleInp = document.getElementById('todo-edit-title');
  if (titleInp) titleInp.value = getCleanTaskTitle(todo);

  const quadSel = document.getElementById('todo-edit-quadrant');
  if (quadSel) quadSel.value = _todoModalQuadrant;

  const currentWorkstream = todo.workstream || (Array.isArray(todo.major_topic_tags) && todo.major_topic_tags[0]) || '';
  await populateTodoWorkstreamDropdown(currentWorkstream);

  updateTodoDueDateDisplay(todo.dueDate || '');
  const isDone = todo.priority === 'Done';
  const isWontDo = typeof isTodoWontDo === 'function' ? isTodoWontDo(todo) : (todo.status === 'wont_do');
  const isWip = isTodoWip(todo);
  setTodoModalStatus(isDone ? 'done' : isWontDo ? 'wont_do' : isWip ? 'wip' : 'pending');

  if (typeof populateCollaboratorPicker === 'function') {
    populateCollaboratorPicker('todo-edit-owner-picker', todo.ownerId || todo.owner || 'me', {
      allowEmpty: false,
      includeMe: true,
      createOnType: true,
    });
    populateCollaboratorPicker('todo-edit-asked-by-picker', todo.askedById || todo.askedBy || '', {
      allowEmpty: true,
      includeMe: true,
      createOnType: true,
      placeholder: t('todo.askedByPlaceholder') || 'Select requester...',
    });
  }

  const contextTxt = document.getElementById('todo-edit-context');
  if (contextTxt) contextTxt.value = todo.context || '';

  const assocSearch = document.getElementById('todo-edit-assoc-notes-search');
  if (assocSearch) assocSearch.value = '';
  const assocList = document.getElementById('todo-edit-assoc-notes-list');
  if (assocList) assocList.style.display = 'none';
  renderTodoAssocNotes('');

  const depSearch = document.getElementById('todo-edit-depends-search');
  if (depSearch) depSearch.value = '';
  const depList = document.getElementById('todo-edit-depends-list');
  if (depList) depList.style.display = 'none';
  renderTodoDepends('');

  const deleteBtn = document.getElementById('todo-edit-delete-btn');
  if (deleteBtn) deleteBtn.style.display = 'inline-flex';

  // Populate Checklist & Recurrence
  renderTodoChecklistInModal(todo);
  const recToggle = document.getElementById('todo-edit-recurrence-enabled');
  const recControls = document.getElementById('todo-edit-recurrence-controls');
  const recFreq = document.getElementById('todo-edit-recurrence-freq');
  if (recToggle) {
    const hasRec = !!(todo.recurrence && todo.recurrence.enabled);
    recToggle.checked = hasRec;
    if (recControls) recControls.style.display = hasRec ? 'inline-flex' : 'none';
    if (recFreq && todo.recurrence?.freq) recFreq.value = todo.recurrence.freq;
  }

  // Populate Delegation & Dated Updates
  _todoModalDelegatedDate = todo.delegatedDate || '';
  _todoModalUpdates = Array.isArray(todo.updates) ? JSON.parse(JSON.stringify(todo.updates)) : [];
  const delDateInp = document.getElementById('todo-edit-delegated-date');
  if (delDateInp) delDateInp.value = _todoModalDelegatedDate;
  renderTodoUpdatesInModal();

  const mergeBtn = document.getElementById('todo-edit-merge-btn');
  if (mergeBtn) mergeBtn.style.display = 'inline-flex';
  closeTodoMergePanel();

  overlay.style.display = 'flex';
  setTodoOverlayBusy(false);

  if (titleInp) {
    setTimeout(() => {
      titleInp.focus();
      titleInp.setSelectionRange(0, titleInp.value.length);
    }, 0);
  }
}

function renderTodoChecklistInModal(todo) {
  const container = document.getElementById('todo-edit-checklist-items');
  const badge = document.getElementById('todo-edit-checklist-badge');
  if (!container) return;

  container.innerHTML = '';
  const list = Array.isArray(todo?.checklist) ? todo.checklist : [];
  const progress = typeof TodoChecklistEngine !== 'undefined' ? TodoChecklistEngine.getProgress(todo) : { total: 0, completed: 0, text: '0/0' };

  if (badge) {
    badge.textContent = progress.total > 0 ? `(${progress.text})` : '';
  }

  list.forEach(item => {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '8px';
    row.style.padding = '4px 6px';
    row.style.borderRadius = '4px';
    row.style.background = 'var(--card-bg)';
    row.style.border = '1px solid var(--card-border)';

    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = !!item.done;
    chk.title = t('todo.toggleSubtask') || 'Toggle subtask';
    chk.onchange = () => {
      if (typeof TodoChecklistEngine !== 'undefined') {
        TodoChecklistEngine.toggleItem(todo.id, item.id, chk.checked);
        renderTodoChecklistInModal(todo);
      }
    };

    const span = document.createElement('span');
    span.style.flex = '1';
    span.style.fontSize = '0.84rem';
    span.style.color = 'var(--text)';
    if (item.done) {
      span.style.textDecoration = 'line-through';
      span.style.color = 'var(--text-muted)';
    }
    span.textContent = item.text;

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-secondary btn-sm';
    delBtn.style.padding = '1px 6px';
    delBtn.style.fontSize = '0.7rem';
    delBtn.title = t('common.delete') || 'Delete';
    delBtn.textContent = '✕';
    delBtn.onclick = () => {
      if (typeof TodoChecklistEngine !== 'undefined') {
        TodoChecklistEngine.removeItem(todo.id, item.id);
        renderTodoChecklistInModal(todo);
      }
    };

    row.appendChild(chk);
    row.appendChild(span);
    row.appendChild(delBtn);
    container.appendChild(row);
  });
}
window.renderTodoChecklistInModal = renderTodoChecklistInModal;

function addTodoChecklistItemFromUI() {
  const input = document.getElementById('todo-edit-new-checklist-input');
  if (!input || !input.value.trim() || !_todoOverlayFile) return;
  if (typeof TodoChecklistEngine !== 'undefined') {
    TodoChecklistEngine.addItem(_todoOverlayFile, input.value.trim());
    input.value = '';
    const todo = getTodoById(_todoOverlayFile);
    if (todo) renderTodoChecklistInModal(todo);
  }
}
window.addTodoChecklistItemFromUI = addTodoChecklistItemFromUI;

function onTodoRecurrenceToggle(enabled) {
  const controls = document.getElementById('todo-edit-recurrence-controls');
  if (controls) controls.style.display = enabled ? 'inline-flex' : 'none';
}
window.onTodoRecurrenceToggle = onTodoRecurrenceToggle;

async function markTodoDoneFromOverlay() {
  if (!_todoOverlayFile) return;
  const todoId = _todoOverlayFile;
  const success = await setTodoDoneById(todoId);
  if (success) closeTodoOverlay();
}

async function toggleWipFromOverlay() {
  if (!_todoOverlayFile) return;
  const todoId = _todoOverlayFile;
  await toggleTodoWipById(todoId);
  if (_todoOverlayFile === todoId) await openTodoOverlay(todoId);
}

async function reopenTodoFromOverlay() {
  if (!_todoOverlayFile) return;
  const todoId = _todoOverlayFile;
  const success = await reopenTodoById(todoId, 'Q2');
  if (success && _todoOverlayFile === todoId) await openTodoOverlay(todoId);
}

async function deleteTodoFromOverlay() {
  if (!_todoOverlayFile) return;
  const todoId = _todoOverlayFile;
  await deleteTodoById(todoId);
}

function enterTodoEditMode() {
  // Direct edit mode is always active.
}

async function saveTodoFromOverlay() {
  const titleInp = document.getElementById('todo-edit-title');
  const quadSel = document.getElementById('todo-edit-quadrant');
  const wsSel = document.getElementById('todo-edit-workstream');
  const contextTxt = document.getElementById('todo-edit-context');
  const ownerPicker = document.getElementById('todo-edit-owner-picker');
  const askedByPicker = document.getElementById('todo-edit-asked-by-picker');

  const rawTitleVal = titleInp ? titleInp.value.trim() : '';
  const titleVal = (typeof cleanTaskTitleText === 'function') ? cleanTaskTitleText(rawTitleVal) : rawTitleVal;
  if (!titleVal) {
    toast(t('common.titleRequired') || 'Title is required', true);
    if (titleInp) titleInp.focus();
    return;
  }

  setTodoOverlayBusy(true);
  try {
    const selectedQuad = quadSel ? quadSel.value : 'Q2';
    const selectedWs = wsSel ? wsSel.value.trim() : '';
    const isDone = _todoModalStatus === 'done' || selectedQuad === 'Done';
    const isWontDo = _todoModalStatus === 'wont_do';
    const isWip = _todoModalStatus === 'wip' && !isDone && !isWontDo;

    const finalPriority = isDone ? 'Done' : (selectedQuad === 'Done' ? 'Q2' : selectedQuad);
    const finalQuad = isDone ? (selectedQuad !== 'Done' ? selectedQuad : 'Q2') : finalPriority;

    if (_todoOverlayFile) {
      const todo = getTodoById(_todoOverlayFile);
      if (!todo) return;
      const previousPriority = todo.priority;
      const previousStatus = todo.status || '';

      todo.title = titleVal;
      todo.priority = finalPriority;
      todo.eisenhowerQuadrant = finalQuad;
      if (typeof _todoModalEisenhowerX === 'number') todo.eisenhowerX = _todoModalEisenhowerX;
      if (typeof _todoModalEisenhowerY === 'number') todo.eisenhowerY = _todoModalEisenhowerY;
      todo.dueDate = _todoModalDueDate;
      todo.status = isWontDo ? 'wont_do' : (isWip ? 'WIP' : '');
      todo.context = contextTxt ? contextTxt.value : '';
      todo.depends_on = Array.from(new Set(_todoModalDependsOn));

      todo.workstream = selectedWs;
      if (selectedWs) {
        if (!Array.isArray(todo.major_topic_tags)) todo.major_topic_tags = [];
        if (!todo.major_topic_tags.includes(selectedWs)) todo.major_topic_tags.push(selectedWs);
      } else {
        todo.major_topic_tags = (todo.major_topic_tags || []).filter(t => t !== todo.workstream);
      }

      const getPickerVal = (typeof readCollaboratorPicker === 'function')
        ? readCollaboratorPicker
        : (typeof getCollaboratorPickerValue === 'function' ? getCollaboratorPickerValue : null);

      if (ownerPicker && getPickerVal) {
        const nextOwnerId = getPickerVal('todo-edit-owner-picker') || 'me';
        todo.ownerId = nextOwnerId;
        todo.owner = (typeof getColleagueLabelById === 'function')
          ? getColleagueLabelById(nextOwnerId, nextOwnerId === 'me' ? (typeof getDefaultMeLabel === 'function' ? getDefaultMeLabel() : 'me') : nextOwnerId)
          : nextOwnerId;
      }
      if (askedByPicker && getPickerVal) {
        const val = getPickerVal('todo-edit-asked-by-picker');
        if (val) {
          todo.askedById = val;
          todo.askedBy = (typeof getColleagueLabelById === 'function')
            ? getColleagueLabelById(val, val)
            : val;
        } else {
          delete todo.askedBy;
          delete todo.askedById;
        }
      }

      // Recurrence settings
      const recToggle = document.getElementById('todo-edit-recurrence-enabled');
      const recFreq = document.getElementById('todo-edit-recurrence-freq');
      if (recToggle && recToggle.checked) {
        todo.recurrence = {
          enabled: true,
          freq: recFreq ? recFreq.value : 'weekly',
          interval: 1
        };
      } else {
        delete todo.recurrence;
      }

      // Delegation & Dated Updates
      const delegatedDateInput = document.getElementById('todo-edit-delegated-date');
      if (delegatedDateInput && delegatedDateInput.value) {
        todo.delegatedDate = delegatedDateInput.value;
      } else if (_todoModalDelegatedDate) {
        todo.delegatedDate = _todoModalDelegatedDate;
      } else if (isTodoDelegated(todo) && !todo.delegatedDate) {
        todo.delegatedDate = todo.created || new Date().toISOString().slice(0, 10);
      }
      todo.updates = Array.isArray(_todoModalUpdates) ? [..._todoModalUpdates] : [];

      todo.modified = new Date().toISOString().slice(0, 10);
      await updateTodoLinkedNote(todo, todo.title, todo.priority, todo.originalPriority || previousPriority, previousStatus);
      await saveTodosManifest();

      // If marked as done and recurrence is enabled, spawn the next recurring task!
      if (isDone && todo.recurrence?.enabled && previousPriority !== 'Done' && typeof TodoRecurrenceEngine !== 'undefined') {
        TodoRecurrenceEngine.completeAndSpawnNext(todo.id);
      }

      if (typeof StateBus !== 'undefined') StateBus.emit(`todo:update:${todo.id}`, { todo });
      toast(t('common.todoUpdated') || 'Todo updated');
    } else {
      const newId = 'todo-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7);
      const getPickerVal = (typeof readCollaboratorPicker === 'function')
        ? readCollaboratorPicker
        : (typeof getCollaboratorPickerValue === 'function' ? getCollaboratorPickerValue : null);

      const ownerPickerId = (ownerPicker && getPickerVal) ? (getPickerVal('todo-edit-owner-picker') || 'me') : 'me';
      const ownerLabel = (typeof getColleagueLabelById === 'function')
        ? getColleagueLabelById(ownerPickerId, ownerPickerId === 'me' ? (typeof getDefaultMeLabel === 'function' ? getDefaultMeLabel() : 'me') : ownerPickerId)
        : ownerPickerId;

      const askedByPickerId = (askedByPicker && getPickerVal) ? (getPickerVal('todo-edit-asked-by-picker') || '') : '';
      const askedByLabel = askedByPickerId && (typeof getColleagueLabelById === 'function')
        ? getColleagueLabelById(askedByPickerId, askedByPickerId)
        : askedByPickerId;

      const newTodo = {
        id: newId,
        title: titleVal,
        priority: finalPriority,
        eisenhowerQuadrant: finalQuad,
        eisenhowerX: typeof _todoModalEisenhowerX === 'number' ? _todoModalEisenhowerX : 50,
        eisenhowerY: typeof _todoModalEisenhowerY === 'number' ? _todoModalEisenhowerY : 50,
        owner: ownerLabel,
        ownerId: ownerPickerId,
        dueDate: _todoModalDueDate,
        status: isWontDo ? 'wont_do' : (isWip ? 'WIP' : ''),
        workstream: selectedWs,
        major_topic_tags: selectedWs ? [selectedWs] : [],
        context: contextTxt ? contextTxt.value : '',
        depends_on: Array.from(new Set(_todoModalDependsOn)),
        created: new Date().toISOString().slice(0, 10),
      };
      if (askedByLabel) {
        newTodo.askedBy = askedByLabel;
        newTodo.askedById = askedByPickerId;
      }

      const delegatedDateInput = document.getElementById('todo-edit-delegated-date');
      const delDateVal = (delegatedDateInput && delegatedDateInput.value) ? delegatedDateInput.value : (_todoModalDelegatedDate || '');
      if (delDateVal) {
        newTodo.delegatedDate = delDateVal;
      } else if (isTodoDelegated(newTodo)) {
        newTodo.delegatedDate = newTodo.created;
      }
      if (Array.isArray(_todoModalUpdates) && _todoModalUpdates.length > 0) {
        newTodo.updates = [..._todoModalUpdates];
      }

      const recToggle = document.getElementById('todo-edit-recurrence-enabled');
      const recFreq = document.getElementById('todo-edit-recurrence-freq');
      if (recToggle && recToggle.checked) {
        newTodo.recurrence = {
          enabled: true,
          freq: recFreq ? recFreq.value : 'weekly',
          interval: 1
        };
      }

      todosManifest.push(newTodo);
      await saveTodosManifest();
      if (typeof StateBus !== 'undefined') StateBus.emit('todo:created', { todo: newTodo });
      toast(t('common.todoCreated') || 'Todo created');
    }

    closeTodoOverlay();
  } catch (err) {
    console.error(err);
    toast(t('common.errorSaving') || 'Error saving todo', true);
  } finally {
    setTodoOverlayBusy(false);
  }
}

// ═══ Modal Delegation & Dated Updates Handlers ═══
function onTodoDelegatedDateChanged(val) {
  _todoModalDelegatedDate = val;
}
window.onTodoDelegatedDateChanged = onTodoDelegatedDateChanged;

function renderTodoUpdatesInModal() {
  const container = document.getElementById('todo-edit-updates-container');
  const delegatedDateInp = document.getElementById('todo-edit-delegated-date');
  const updateDateInp = document.getElementById('todo-edit-update-date');
  if (delegatedDateInp) {
    delegatedDateInp.value = _todoModalDelegatedDate || '';
  }
  if (updateDateInp && !updateDateInp.value) {
    updateDateInp.value = new Date().toISOString().slice(0, 10);
  }
  if (!container) return;

  container.innerHTML = '';
  if (!_todoModalUpdates || _todoModalUpdates.length === 0) {
    container.innerHTML = `<div style="font-size:0.78rem; color:var(--text-muted); padding:4px;">${escH(t('todo.noUpdatesLogged') || 'No updates logged yet.')}</div>`;
    return;
  }

  _todoModalUpdates.forEach((upd, idx) => {
    const row = document.createElement('div');
    row.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 8px;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 6px;
      font-size: 0.8rem;
    `;

    let badgeColor = 'var(--accent)';
    let badgeText = t('todo.updateTypeGeneral') || 'Update';
    if (upd.type === 'feedback_received') {
      badgeColor = '#10b981';
      badgeText = t('todo.updateTypeFeedbackReceived') || 'Feedback';
    } else if (upd.type === 'awaiting_feedback') {
      badgeColor = '#f59e0b';
      badgeText = t('todo.updateTypeAwaitingFeedback') || 'Awaiting';
    } else if (upd.type === 'sync_meeting') {
      badgeColor = '#8b5cf6';
      badgeText = t('todo.updateTypeSyncMeeting') || '1-on-1 Sync';
    }

    row.innerHTML = `
      <span style="font-size:0.75rem; color:var(--text-muted);">${escH(upd.date || '—')}</span>
      <span style="font-size:0.72rem; padding:1px 5px; border-radius:4px; background:${badgeColor}22; color:${badgeColor}; font-weight:600;">${escH(badgeText)}</span>
      <span style="flex:1; color:var(--text);">${escH(upd.text || '')}</span>
      <button type="button" class="btn btn-secondary btn-sm" style="padding:0px 5px; font-size:0.7rem;" onclick="removeTodoDatedUpdate(${idx})" title="${escA(t('common.delete') || 'Delete')}">✕</button>
    `;

    container.appendChild(row);
  });
}
window.renderTodoUpdatesInModal = renderTodoUpdatesInModal;

function addTodoDatedUpdateFromUI() {
  const dateInp = document.getElementById('todo-edit-update-date');
  const typeInp = document.getElementById('todo-edit-update-type');
  const textInp = document.getElementById('todo-edit-update-text');

  const uDate = dateInp ? dateInp.value : '';
  const uType = typeInp ? typeInp.value : 'general_update';
  const uText = textInp ? textInp.value.trim() : '';

  if (!uText) {
    toast(t('common.fillRequiredFields') || 'Please enter update details', true);
    return;
  }

  if (!Array.isArray(_todoModalUpdates)) _todoModalUpdates = [];
  _todoModalUpdates.push({
    id: 'upd-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    date: uDate || new Date().toISOString().slice(0, 10),
    type: uType,
    text: uText,
    created: new Date().toISOString()
  });

  if (textInp) textInp.value = '';
  renderTodoUpdatesInModal();
}
window.addTodoDatedUpdateFromUI = addTodoDatedUpdateFromUI;

function removeTodoDatedUpdate(idx) {
  if (Array.isArray(_todoModalUpdates) && idx >= 0 && idx < _todoModalUpdates.length) {
    _todoModalUpdates.splice(idx, 1);
    renderTodoUpdatesInModal();
  }
}
window.removeTodoDatedUpdate = removeTodoDatedUpdate;

// ═══ Todo Fusion Engine ═══
function openTodoMergePanel() {
  const panel = document.getElementById('todo-edit-merge-panel');
  const searchInp = document.getElementById('todo-edit-merge-search');
  const preview = document.getElementById('todo-edit-merge-preview');
  _selectedMergeCandidateId = null;
  if (panel) {
    panel.style.display = 'block';
    if (preview) preview.style.display = 'none';
    if (searchInp) {
      searchInp.value = '';
      searchInp.focus();
    }
    filterTodoMergeCandidates('');
  }
}
window.openTodoMergePanel = openTodoMergePanel;

function closeTodoMergePanel() {
  const panel = document.getElementById('todo-edit-merge-panel');
  const preview = document.getElementById('todo-edit-merge-preview');
  _selectedMergeCandidateId = null;
  if (panel) panel.style.display = 'none';
  if (preview) preview.style.display = 'none';
}
window.closeTodoMergePanel = closeTodoMergePanel;

function filterTodoMergeCandidates(query = '') {
  const listEl = document.getElementById('todo-edit-merge-candidates-list');
  if (!listEl) return;
  const currentId = _todoOverlayFile;
  const q = (query || '').toLowerCase().trim();

  const candidates = (todosManifest || []).filter(t => t && t.id !== currentId && (
    !q ||
    (t.title || '').toLowerCase().includes(q) ||
    (t.owner || '').toLowerCase().includes(q) ||
    (t.workstream || '').toLowerCase().includes(q)
  )).slice(0, 15);

  if (candidates.length === 0) {
    listEl.innerHTML = `<div style="padding:6px 10px; font-size:0.78rem; color:var(--text-muted);">${escH(t('todo.mergeNoCandidates') || 'No matching tasks found')}</div>`;
    return;
  }

  listEl.innerHTML = candidates.map(c => `
    <div class="planner-dropdown-item" style="padding:6px 10px; font-size:0.8rem; cursor:pointer; display:flex; justify-content:space-between; align-items:center;" onclick="selectTodoMergeCandidate('${escA(c.id)}')">
      <div style="display:flex; flex-direction:column; gap:2px;">
        <span style="font-weight:600; color:var(--text);">${escH(getCleanTaskTitle(c))}</span>
        <span style="font-size:0.72rem; color:var(--text-muted);">@${escH(c.owner || 'me')} • ${escH(c.priority || 'Medium')} ${c.workstream ? '• ' + escH(c.workstream) : ''}</span>
      </div>
      <button type="button" class="btn btn-secondary btn-sm" style="font-size:0.72rem; padding:2px 6px;" title="${escA(t('todo.mergeSelectTooltip') || 'Select for merge')}">${escH(t('todo.mergeSelect') || 'Select')}</button>
    </div>
  `).join('');
}
window.filterTodoMergeCandidates = filterTodoMergeCandidates;

function selectTodoMergeCandidate(candidateId) {
  const candidate = getTodoById(candidateId);
  const currentTodo = getTodoById(_todoOverlayFile);
  if (!candidate || !currentTodo) return;

  _selectedMergeCandidateId = candidateId;
  const preview = document.getElementById('todo-edit-merge-preview');
  const previewContent = document.getElementById('todo-edit-merge-preview-content');

  if (preview && previewContent) {
    const combinedChecklistCount = (Array.isArray(currentTodo.checklist) ? currentTodo.checklist.length : 0) + (Array.isArray(candidate.checklist) ? candidate.checklist.length : 0);
    const combinedUpdatesCount = (Array.isArray(_todoModalUpdates) ? _todoModalUpdates.length : 0) + (Array.isArray(candidate.updates) ? candidate.updates.length : 0);

    previewContent.innerHTML = `
      <div><strong>${escH(t('todo.mergeSourceTask') || 'Merging:')}</strong> "${escH(getCleanTaskTitle(candidate))}"</div>
      <div><strong>${escH(t('todo.mergeTargetTask') || 'Into:')}</strong> "${escH(getCleanTaskTitle(currentTodo))}"</div>
      <div style="margin-top:4px;">✓ ${combinedChecklistCount} ${escH(t('todo.mergeChecklistCombined') || 'subtasks combined')} • ✓ ${combinedUpdatesCount} ${escH(t('todo.mergeUpdatesCombined') || 'updates combined')} • ✓ ${escH(t('todo.mergeNotesRewritten') || 'Vault notes & calendar links updated')}</div>
    `;
    preview.style.display = 'block';
  }
}
window.selectTodoMergeCandidate = selectTodoMergeCandidate;

async function confirmExecuteTodoMerge() {
  if (!_selectedMergeCandidateId || !_todoOverlayFile) return;
  const primaryId = _todoOverlayFile;
  const secondaryId = _selectedMergeCandidateId;

  const primaryTodo = getTodoById(primaryId);
  const secondaryTodo = getTodoById(secondaryId);

  if (!primaryTodo || !secondaryTodo) return;

  setTodoOverlayBusy(true);
  try {
    // 1. Merge checklists
    if (Array.isArray(secondaryTodo.checklist) && secondaryTodo.checklist.length > 0) {
      if (!Array.isArray(primaryTodo.checklist)) primaryTodo.checklist = [];
      const existingTexts = new Set(primaryTodo.checklist.map(c => (c.text || '').trim().toLowerCase()));
      secondaryTodo.checklist.forEach(item => {
        if (item && item.text && !existingTexts.has(item.text.trim().toLowerCase())) {
          primaryTodo.checklist.push({
            id: 'chk-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
            text: item.text,
            done: !!item.done
          });
        }
      });
    }

    // 2. Merge context / description
    if (secondaryTodo.context && secondaryTodo.context.trim()) {
      if (!primaryTodo.context) primaryTodo.context = secondaryTodo.context;
      else if (!primaryTodo.context.includes(secondaryTodo.context)) {
        primaryTodo.context = `${primaryTodo.context}\n\n---\nMerged from [${getCleanTaskTitle(secondaryTodo)}]:\n${secondaryTodo.context}`;
      }
      const contextTxt = document.getElementById('todo-edit-context');
      if (contextTxt) contextTxt.value = primaryTodo.context;
    }

    // 3. Merge updates
    if (Array.isArray(secondaryTodo.updates) && secondaryTodo.updates.length > 0) {
      if (!Array.isArray(_todoModalUpdates)) _todoModalUpdates = [];
      secondaryTodo.updates.forEach(u => {
        _todoModalUpdates.push({
          ...u,
          id: 'upd-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
          text: `[Merged]: ${u.text || ''}`
        });
      });
    }

    // 4. Merge tags & dependencies
    if (Array.isArray(secondaryTodo.major_topic_tags)) {
      if (!Array.isArray(primaryTodo.major_topic_tags)) primaryTodo.major_topic_tags = [];
      secondaryTodo.major_topic_tags.forEach(tag => {
        if (!primaryTodo.major_topic_tags.includes(tag)) primaryTodo.major_topic_tags.push(tag);
      });
    }
    if (Array.isArray(secondaryTodo.depends_on)) {
      secondaryTodo.depends_on.forEach(depId => {
        if (depId !== primaryId && !_todoModalDependsOn.includes(depId)) {
          _todoModalDependsOn.push(depId);
        }
      });
    }

    // 5. Rewrite vault-wide Note HTML files referencing secondaryId in data-todo-id
    if (typeof StorageAPI !== 'undefined' && typeof manifest !== 'undefined' && Array.isArray(manifest)) {
      for (const note of manifest) {
        if (note && note.path) {
          try {
            const content = await StorageAPI.readNoteContent(note.path);
            if (content && (content.includes(`data-todo-id="${secondaryId}"`) || content.includes(`data-todo-id='${secondaryId}'`))) {
              const updatedContent = content
                .split(`data-todo-id="${secondaryId}"`).join(`data-todo-id="${primaryId}"`)
                .split(`data-todo-id='${secondaryId}'`).join(`data-todo-id='${primaryId}'`);
              await StorageAPI.writeNoteContent(note.path, updatedContent);
            }
          } catch (e) {
            console.warn(`Could not update note content for ${note.path}:`, e);
          }
        }
      }
    }

    // 6. Rewrite Planner calendar events linking to secondaryId
    if (typeof window.plannerEvents !== 'undefined' && Array.isArray(window.plannerEvents)) {
      let plannerChanged = false;
      window.plannerEvents.forEach(evt => {
        if (evt.todoId === secondaryId) {
          evt.todoId = primaryId;
          plannerChanged = true;
        }
        if (Array.isArray(evt.linkedTodoIds) && evt.linkedTodoIds.includes(secondaryId)) {
          evt.linkedTodoIds = evt.linkedTodoIds.map(id => id === secondaryId ? primaryId : id);
          plannerChanged = true;
        }
      });
      if (plannerChanged && typeof StorageAPI !== 'undefined' && StorageAPI.writePlanner) {
        await StorageAPI.writePlanner({ events: window.plannerEvents });
      }
    }

    // 7. Rewrite depends_on in other tasks
    (todosManifest || []).forEach(t => {
      if (t && Array.isArray(t.depends_on) && t.depends_on.includes(secondaryId)) {
        t.depends_on = t.depends_on.map(id => id === secondaryId ? primaryId : id).filter(id => id !== t.id);
      }
    });

    // 8. Remove secondary todo from manifest
    const secIdx = todosManifest.findIndex(t => t && t.id === secondaryId);
    if (secIdx !== -1) {
      todosManifest.splice(secIdx, 1);
    }

    // 9. Save and refresh modal
    await saveTodosManifest();
    renderTodoChecklistInModal(primaryTodo);
    renderTodoUpdatesInModal();
    closeTodoMergePanel();

    if (typeof StateBus !== 'undefined') {
      StateBus.emit(`todo:update:${primaryId}`, { todo: primaryTodo });
      StateBus.emit(`todo:deleted`, { id: secondaryId });
    }

    toast(t('todo.mergeSuccess') || 'Tasks merged successfully');
  } catch (err) {
    console.error('Error during todo fusion:', err);
    toast(t('common.errorMerging') || 'Error during task fusion', true);
  } finally {
    setTodoOverlayBusy(false);
  }
}
window.confirmExecuteTodoMerge = confirmExecuteTodoMerge;

// ═══ Delegated & Follow-up Tasks Gantt Engine & Actions ═══

function getGanttFilteredTasks(manifest = (typeof todosManifest !== 'undefined' ? todosManifest : []), scope = (typeof ganttTaskScope !== 'undefined' ? ganttTaskScope : 'delegated'), wsFilter = (typeof eisenhowerWorkstreamFilter !== 'undefined' ? eisenhowerWorkstreamFilter : null)) {
  if (typeof manifest === 'string') {
    wsFilter = scope;
    scope = manifest;
    manifest = (typeof globalThis !== 'undefined' && Array.isArray(globalThis.todosManifest))
      ? globalThis.todosManifest
      : (typeof todosManifest !== 'undefined' ? todosManifest : []);
  }
  if (!manifest && typeof globalThis !== 'undefined' && Array.isArray(globalThis.todosManifest)) {
    manifest = globalThis.todosManifest;
  } else if (!manifest && typeof todosManifest !== 'undefined') {
    manifest = todosManifest;
  }
  if (!scope) scope = typeof ganttTaskScope !== 'undefined' ? ganttTaskScope : 'delegated';
  if (wsFilter === undefined && typeof eisenhowerWorkstreamFilter !== 'undefined') {
    wsFilter = eisenhowerWorkstreamFilter;
  }

  let list = (manifest || []).filter(t => t && t.priority !== 'Done');
  if (scope === 'delegated') {
    list = list.filter(isTodoDelegated);
  } else {
    list = list.filter(t => isTodoDelegated(t) || t.dueDate || t.delegatedDate || t.startDate || (Array.isArray(t.updates) && t.updates.length > 0));
  }

  if (wsFilter) {
    list = list.filter(t => {
      const ws = (t.workstream || (Array.isArray(t.major_topic_tags) && t.major_topic_tags[0]) || '').trim();
      if (wsFilter === 'Other' || wsFilter === 'Autre') {
        return !ws || ['other', 'autre'].includes(ws.toLowerCase());
      }
      return ws.toLowerCase() === wsFilter.toLowerCase();
    });
  }

  if (typeof TodoFilterEngine !== 'undefined' && TodoFilterEngine.currentFilter.query) {
    list = TodoFilterEngine.filterList(list);
  }
  return list;
}
window.getGanttFilteredTasks = getGanttFilteredTasks;

function calculateGanttTimeBounds(todos = [], scale = (typeof ganttTimeScale !== 'undefined' ? ganttTimeScale : '8w'), baseNow = new Date()) {
  if (todos instanceof Date) {
    const tempTodos = Array.isArray(baseNow) ? baseNow : (typeof baseNow === 'object' && baseNow !== null && !(baseNow instanceof Date) ? [baseNow] : []);
    baseNow = todos;
    todos = tempTodos;
  } else if (!Array.isArray(todos) && typeof todos === 'object' && todos !== null) {
    todos = [todos];
  }

  const now = new Date(baseNow);
  const todayStr = now.toISOString().slice(0, 10);
  const todayTs = now.getTime();

  // Monday of current week
  const currentMon = new Date(now);
  const curDayOffset = (currentMon.getDay() + 6) % 7;
  currentMon.setDate(currentMon.getDate() - curDayOffset);
  currentMon.setHours(0, 0, 0, 0);
  const currentMonTs = currentMon.getTime();

  let minWeeksBefore = 1;
  let maxWeeksAfter = 2;

  if (scale === '8w') {
    minWeeksBefore = 2;
    maxWeeksAfter = 5;
  } else if (scale === '12w') {
    minWeeksBefore = 2;
    maxWeeksAfter = 9;
  } else if (scale === 'fit') {
    minWeeksBefore = 1;
    maxWeeksAfter = 2;
  }

  let minCalendarTs = currentMonTs - minWeeksBefore * 7 * 86400000;
  let maxCalendarTs = currentMonTs + maxWeeksAfter * 7 * 86400000;

  (todos || []).forEach(t => {
    const dDate = t.delegatedDate ? new Date(t.delegatedDate).getTime() : (t.created ? new Date(t.created).getTime() : todayTs);
    if (!isNaN(dDate) && dDate < minCalendarTs) minCalendarTs = dDate;
    if (t.dueDate) {
      const due = new Date(t.dueDate).getTime();
      if (!isNaN(due) && due > maxCalendarTs) maxCalendarTs = due;
    }
    if (Array.isArray(t.updates)) {
      t.updates.forEach(u => {
        if (u && u.date) {
          const uDate = new Date(u.date).getTime();
          if (!isNaN(uDate)) {
            if (uDate < minCalendarTs) minCalendarTs = uDate;
            if (uDate > maxCalendarTs) maxCalendarTs = uDate;
          }
        }
      });
    }
  });

  // Snap minCalendarTs to Monday (00:00)
  const minDateObj = new Date(minCalendarTs);
  const minDayOffset = (minDateObj.getDay() + 6) % 7;
  minDateObj.setDate(minDateObj.getDate() - minDayOffset);
  minDateObj.setHours(0, 0, 0, 0);
  const minTime = minDateObj.getTime();

  // Snap maxCalendarTs to Sunday (23:59:59.999)
  const maxDateObj = new Date(maxCalendarTs);
  const maxDayOffset = (7 - ((maxDateObj.getDay() + 6) % 7) - 1);
  maxDateObj.setDate(maxDateObj.getDate() + maxDayOffset);
  maxDateObj.setHours(23, 59, 59, 999);
  let maxTime = maxDateObj.getTime();

  let minSpanWeeks = scale === '8w' ? 8 : (scale === '12w' ? 12 : 4);
  if (scale === 'fit') minSpanWeeks = 4;
  if ((maxTime - minTime) < minSpanWeeks * 7 * 86400000) {
    maxTime = minTime + minSpanWeeks * 7 * 86400000 - 1;
  }

  const numWeeks = Math.max(1, Math.round((maxTime - minTime) / (7 * 86400000)));
  const totalDuration = Math.max(1, maxTime - minTime);

  const getPercent = (time) => Math.max(0, Math.min(100, ((time - minTime) / totalDuration) * 100));
  const getTimeFromPercent = (pct) => minTime + (Math.max(0, Math.min(100, pct)) / 100) * totalDuration;

  // Build weeks metadata
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const weeks = [];
  for (let i = 0; i < numWeeks; i++) {
    const wStart = new Date(minTime + i * 7 * 86400000);
    const wEnd = new Date(wStart.getTime() + 6 * 86400000);

    const thu = new Date(wStart);
    thu.setDate(wStart.getDate() + 3);
    const firstThursday = new Date(thu.getFullYear(), 0, 4);
    const weekNum = Math.ceil((((thu - firstThursday) / 86400000) + firstThursday.getDay() + 1) / 7);

    const startMonth = monthNames[wStart.getMonth()];
    const endMonth = monthNames[wEnd.getMonth()];
    const startDay = wStart.getDate();
    const endDay = wEnd.getDate();
    const dateRangeStr = (startMonth === endMonth)
      ? `${startDay}–${endDay} ${startMonth}`
      : `${startDay} ${startMonth}–${endDay} ${endMonth}`;

    const isCurrent = (todayTs >= wStart.getTime() && todayTs <= wEnd.getTime() + 86400000 - 1);

    weeks.push({
      index: i,
      weekNum,
      dateLabel: dateRangeStr,
      dateRangeStr,
      startTs: wStart.getTime(),
      endTs: wEnd.getTime() + 86400000 - 1,
      startDateStr: wStart.toISOString().slice(0, 10),
      endDateStr: wEnd.toISOString().slice(0, 10),
      isCurrent,
      isCurrentWeek: isCurrent,
      key: `W${weekNum}`
    });
  }

  return {
    minTime,
    maxTime,
    startMs: minTime,
    endMs: maxTime,
    numWeeks,
    totalDuration,
    todayTs,
    todayStr,
    todayPct: getPercent(todayTs),
    getPercent,
    getTimeFromPercent,
    weeks
  };
}
window.calculateGanttTimeBounds = calculateGanttTimeBounds;

function calculateGanttTimeShift(todo, arg2, arg3) {
  let deltaDays = arg2;
  if (typeof todo === 'string' || todo === null) {
    todo = { delegatedDate: todo, dueDate: arg2 };
    deltaDays = arg3;
  }
  if (!todo || deltaDays === undefined || deltaDays === null || isNaN(deltaDays)) return { updated: false, todo };

  let newStartStr = null;
  if (todo.delegatedDate || todo.created) {
    const initialStartStr = todo.delegatedDate || todo.created;
    const initialStartTs = new Date(initialStartStr).getTime();
    if (!isNaN(initialStartTs)) {
      const newStartTs = initialStartTs + deltaDays * 86400000;
      newStartStr = new Date(newStartTs).toISOString().slice(0, 10);
    }
  }

  let newDueStr = null;
  if (todo.dueDate) {
    const initialDueTs = new Date(todo.dueDate).getTime();
    if (!isNaN(initialDueTs)) {
      const newDueTs = initialDueTs + deltaDays * 86400000;
      newDueStr = new Date(newDueTs).toISOString().slice(0, 10);
    }
  }

  const updatedTodo = {
    ...todo,
    ...(newStartStr ? { delegatedDate: newStartStr } : {}),
    ...(newDueStr ? { dueDate: newDueStr } : {})
  };

  return {
    updated: true,
    startDate: newStartStr,
    dueDate: newDueStr,
    deltaDays,
    todo: updatedTodo
  };
}
window.calculateGanttTimeShift = calculateGanttTimeShift;

function calculateGanttDurationResize(todo, handle, deltaDays, arg4) {
  if (typeof todo === 'string' || todo === null) {
    const origStart = todo;
    const origDue = handle;
    const handleType = deltaDays;
    deltaDays = arg4;
    todo = { delegatedDate: origStart, dueDate: origDue };
    handle = handleType;
  }
  if (typeof handle === 'string' && handle.startsWith('handle-')) {
    handle = handle.replace('handle-', '');
  }
  if (!todo || !handle || deltaDays === undefined || deltaDays === null || deltaDays === 0 || isNaN(deltaDays)) return { updated: false, todo };
  const dToday = new Date().toISOString().slice(0, 10);
  const initialStartStr = todo.delegatedDate || todo.created || dToday;
  const initialStartTs = new Date(initialStartStr).getTime();
  if (isNaN(initialStartTs)) return { updated: false, todo };

  const initialDueTs = todo.dueDate ? new Date(todo.dueDate).getTime() : (initialStartTs + 7 * 86400000);

  let newStartStr = todo.delegatedDate || todo.created || dToday;
  let newDueStr = todo.dueDate || '';

  if (handle === 'start') {
    let newStartTs = initialStartTs + deltaDays * 86400000;
    if (!isNaN(initialDueTs) && newStartTs >= initialDueTs) {
      newStartTs = initialDueTs;
    }
    newStartStr = new Date(newStartTs).toISOString().slice(0, 10);
  } else if (handle === 'end') {
    let newDueTs = initialDueTs + deltaDays * 86400000;
    if (newDueTs <= initialStartTs) {
      newDueTs = initialStartTs;
    }
    newDueStr = new Date(newDueTs).toISOString().slice(0, 10);
  }

  const finalStartTs = new Date(newStartStr).getTime();
  const finalDueTs = new Date(newDueStr).getTime();
  const durationDays = (!isNaN(finalStartTs) && !isNaN(finalDueTs))
    ? Math.max(1, Math.round((finalDueTs - finalStartTs) / 86400000))
    : 1;

  const updatedTodo = {
    ...todo,
    delegatedDate: newStartStr,
    dueDate: newDueStr
  };

  return {
    updated: true,
    startDate: newStartStr,
    dueDate: newDueStr,
    durationDays,
    handle,
    deltaDays,
    todo: updatedTodo
  };
}
window.calculateGanttDurationResize = calculateGanttDurationResize;

function buildGanttHoverCardData(todo, now = new Date()) {
  if (!todo) return null;
  const todayStr = now.toISOString().slice(0, 10);
  const todayTs = now.getTime();

  const dCreated = todo.created || '';
  const dDelegated = todo.delegatedDate || todo.created || todayStr;
  const dDue = todo.dueDate || '';
  const quad = getTodoQuadrant(todo);
  const meta = getQuadrantMeta(quad);
  const ownerName = todo.owner || (typeof getColleagueLabelById === 'function' ? getColleagueLabelById(todo.ownerId, todo.ownerId) : todo.ownerId) || (isTodoDelegated(todo) ? 'Colleague' : 'Me');
  const isDelegated = isTodoDelegated(todo);
  const cleanTitle = getCleanTaskTitle(todo);
  const ws = (todo.workstream || (Array.isArray(todo.major_topic_tags) && todo.major_topic_tags[0]) || '').trim();

  const startTs = new Date(dDelegated).getTime();
  const dueTs = dDue ? new Date(dDue).getTime() : NaN;
  const isBounded = !isNaN(dueTs);
  const isOverdue = isBounded && dueTs < todayTs;

  let elapsedDays = 0;
  if (!isNaN(startTs)) elapsedDays = Math.max(0, Math.floor((todayTs - startTs) / 86400000));

  let totalDurationDays = 0;
  let remainingDays = 0;
  let progressPct = 0;

  if (isBounded && !isNaN(startTs)) {
    totalDurationDays = Math.max(1, Math.round((dueTs - startTs) / 86400000) + 1);
    if (isOverdue) {
      remainingDays = Math.floor((todayTs - dueTs) / 86400000);
      progressPct = 100;
    } else {
      remainingDays = Math.max(0, Math.ceil((dueTs - todayTs) / 86400000));
      progressPct = Math.min(100, Math.max(0, Math.round((elapsedDays / totalDurationDays) * 100)));
    }
  }

  let checklistTotal = 0;
  let checklistDone = 0;
  if (Array.isArray(todo.checklist)) {
    todo.checklist.forEach(it => {
      checklistTotal++;
      if (it && it.done) checklistDone++;
    });
  } else if (Array.isArray(todo.checklists)) {
    todo.checklists.forEach(ch => {
      if (ch && Array.isArray(ch.items)) {
        ch.items.forEach(it => {
          checklistTotal++;
          if (it && it.done) checklistDone++;
        });
      }
    });
  } else if (Array.isArray(todo.subtasks)) {
    todo.subtasks.forEach(st => {
      checklistTotal++;
      if (st && st.done) checklistDone++;
    });
  }

  const rawUpdates = Array.isArray(todo.updates) ? todo.updates.filter(u => u && (u.text || u.date)) : [];
  const latestUpdate = rawUpdates.length > 0 ? rawUpdates[rawUpdates.length - 1] : null;

  return {
    id: todo.id,
    title: cleanTitle,
    quad,
    quadMeta: meta,
    owner: ownerName,
    ownerName,
    isDelegated,
    askedBy: todo.askedBy || '',
    workstream: ws,
    createdDate: dCreated,
    delegatedDate: dDelegated,
    dueDate: dDue,
    isBounded,
    isOverdue,
    elapsedDays,
    remainingDays,
    totalDurationDays,
    durationDays: isBounded ? totalDurationDays : null,
    progressPct,
    checklistTotal,
    checklistDone,
    checklistPct: checklistTotal > 0 ? Math.round((checklistDone / checklistTotal) * 100) : 0,
    updates: rawUpdates.slice(-3).reverse(),
    updatesCount: rawUpdates.length,
    latestUpdate
  };
}
window.buildGanttHoverCardData = buildGanttHoverCardData;

let _ganttHoverCardEl = null;
let _ganttHoverTimeout = null;
let _isGanttDragging = false;

function hideGanttHoverCard(immediate = false) {
  if (_ganttHoverTimeout) {
    clearTimeout(_ganttHoverTimeout);
    _ganttHoverTimeout = null;
  }
  if (_ganttHoverCardEl) {
    const el = _ganttHoverCardEl;
    if (immediate) {
      if (el && el.parentNode) el.remove();
    } else {
      el.style.opacity = '0';
      el.style.transform = 'translateY(4px) scale(0.98)';
      setTimeout(() => {
        if (el && el.parentNode) {
          el.remove();
        }
      }, 150);
    }
    _ganttHoverCardEl = null;
  }
}
window.hideGanttHoverCard = hideGanttHoverCard;

function showGanttHoverCard(event, todoId, immediate = false) {
  if (_isGanttDragging) return;
  if (_ganttHoverTimeout) clearTimeout(_ganttHoverTimeout);

  const targetEl = event.currentTarget || event.target;

  const renderCard = () => {
    if (_isGanttDragging) return;
    const todo = typeof getTodoById === 'function' ? getTodoById(todoId) : (todosManifest || []).find(x => x && x.id === todoId);
    if (!todo) return;
    const data = buildGanttHoverCardData(todo);
    if (!data) return;

    if (_ganttHoverCardEl) _ganttHoverCardEl.remove();

    const card = document.createElement('div');
    card.id = 'gantt-hover-card';
    card.className = 'gantt-hover-card';

    let updatesHtml = '';
    if (data.updates.length > 0) {
      updatesHtml = `
        <div class="ghc-updates-section">
          <div class="ghc-section-title">${escH(t('todo.delegatedUpdatesSectionTitle') || 'Recent Updates')}</div>
          <div class="ghc-updates-list">
            ${data.updates.map(u => {
              const uType = u.type || 'general_update';
              let badgeIcon = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
              if (uType === 'feedback_received') {
                badgeIcon = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
              } else if (uType === 'awaiting_feedback') {
                badgeIcon = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 14 14"/></svg>';
              } else if (uType === 'sync_meeting') {
                badgeIcon = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
              }
              return `
                <div class="ghc-update-item">
                  <span class="ghc-upd-icon">${badgeIcon}</span>
                  <div class="ghc-upd-body">
                    <span class="ghc-upd-date">${escH(u.date || '')}</span>
                    <span class="ghc-upd-text">${escH(u.text || '')}</span>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }

    let checklistHtml = '';
    if (data.checklistTotal > 0) {
      checklistHtml = `
        <div class="ghc-checklist-bar-wrap">
          <div class="ghc-checklist-header">
            <span>${escH(t('todo.ganttSubtasksProgress', { done: data.checklistDone, total: data.checklistTotal, pct: data.checklistPct }))}</span>
          </div>
          <div class="ghc-progress-track">
            <div class="ghc-progress-fill" style="width:${data.checklistPct}%;"></div>
          </div>
        </div>
      `;
    }

    let statusBadgeHtml = '';
    if (data.isBounded) {
      if (data.isOverdue) {
        statusBadgeHtml = `<span class="ghc-badge is-danger">${escH(t('todo.overdue') || 'Overdue')} (${data.remainingDays}d)</span>`;
      } else {
        statusBadgeHtml = `<span class="ghc-badge is-active">${escH(t('todo.inProgress') || 'In Progress')} (${data.remainingDays}d left)</span>`;
      }
    } else {
      statusBadgeHtml = `<span class="ghc-badge is-open">${escH(t('todo.delegatedNoDueDate') || 'Open-ended')} (${data.elapsedDays}d)</span>`;
    }

    card.innerHTML = `
      <div class="ghc-header">
        <span class="ghc-quad-badge" style="background:${data.quadMeta.color};" title="${escA(data.quadMeta.actionTitle)}">${escH(data.quad)}</span>
        <div class="ghc-title">${escH(data.title)}</div>
      </div>
      <div class="ghc-meta-row">
        <span class="ghc-owner-pill" title="${escA(t('todo.ownerLabel') || 'Assignee')}: @${escA(data.ownerName)}">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          @${escH(data.ownerName)}
        </span>
        ${data.workstream ? `<span class="ghc-ws-pill" title="${escA(t('todo.filterWorkstreamLabel') || 'Workstream')}: ${escA(data.workstream)}">${escH(data.workstream)}</span>` : ''}
        ${statusBadgeHtml}
      </div>
      <div class="ghc-dates-grid">
        <div class="ghc-date-col">
          <span class="ghc-date-lbl">${escH(t('todo.delegatedDateLabel') || 'Start')}:</span>
          <span class="ghc-date-val">${escH(data.delegatedDate)}</span>
        </div>
        <div class="ghc-date-col">
          <span class="ghc-date-lbl">${escH(t('todo.dueShort') || 'Due')}:</span>
          <span class="ghc-date-val ${data.isOverdue ? 'is-overdue' : ''}">${escH(data.dueDate || '—')}</span>
        </div>
        <div class="ghc-date-col">
          <span class="ghc-date-lbl">${escH(t('common.duration') || 'Duration')}:</span>
          <span class="ghc-date-val">${data.isBounded ? `${data.totalDurationDays}d` : `${data.elapsedDays}d`}</span>
        </div>
      </div>
      ${checklistHtml}
      ${updatesHtml}
      <div class="ghc-actions-row">
        <button type="button" class="ghc-btn" onclick="hideGanttHoverCard();toggleTodoDoneFromGantt('${escA(data.id)}')" title="${escA(t('todo.markDoneTooltip') || 'Mark completed')}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          <span>${escH(t('todo.done') || 'Done')}</span>
        </button>
        <button type="button" class="ghc-btn" onclick="hideGanttHoverCard();openQuickUpdatePopover('${escA(data.id)}', event)" title="${escA(t('todo.quickUpdateTooltip') || 'Log checkpoint')}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <span>${escH(t('todo.quickUpdateTitle') || 'Log Checkpoint')}</span>
        </button>
        <button type="button" class="ghc-btn" onclick="hideGanttHoverCard();openTodoOverlay('${escA(data.id)}')" title="${escA(t('todo.editTodoTooltip') || 'Edit full details')}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          <span>${escH(t('common.edit') || 'Edit')}</span>
        </button>
      </div>
    `;

    document.body.appendChild(card);
    _ganttHoverCardEl = card;

    if (typeof targetEl.getBoundingClientRect === 'function') {
      const targetRect = targetEl.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();

      let posX = targetRect.left + targetRect.width / 2 - cardRect.width / 2;
      let posY = targetRect.top - cardRect.height - 10;

      if (posY < 10) posY = targetRect.bottom + 10;
      if (posX < 10) posX = 10;
      if (posX + cardRect.width > window.innerWidth - 10) posX = window.innerWidth - cardRect.width - 10;

      card.style.left = `${posX}px`;
      card.style.top = `${posY}px`;

      requestAnimationFrame(() => {
        if (card) {
          card.style.opacity = '1';
          card.style.transform = 'translateY(0) scale(1)';
        }
      });
    }
  };

  if (immediate) {
    renderCard();
  } else {
    _ganttHoverTimeout = setTimeout(renderCard, 120);
  }
}
window.showGanttHoverCard = showGanttHoverCard;

function showGanttMilestoneHoverCard(event, todoId, updateIdx) {
  if (_isGanttDragging) return;
  if (_ganttHoverTimeout) clearTimeout(_ganttHoverTimeout);

  const targetEl = event.currentTarget || event.target;
  _ganttHoverTimeout = setTimeout(() => {
    if (_isGanttDragging) return;
    const todo = typeof getTodoById === 'function' ? getTodoById(todoId) : (todosManifest || []).find(x => x && x.id === todoId);
    if (!todo || !Array.isArray(todo.updates) || !todo.updates[updateIdx]) return;
    const u = todo.updates[updateIdx];

    if (_ganttHoverCardEl) _ganttHoverCardEl.remove();

    const card = document.createElement('div');
    card.id = 'gantt-hover-card';
    card.className = 'gantt-hover-card ghc-milestone-card';

    const uType = u.type || 'general_update';
    let typeLabel = t('todo.updateTypeGeneral') || 'Progress update';
    let iconSvg = '📝';
    if (uType === 'feedback_received') {
      typeLabel = t('todo.updateTypeFeedbackReceived') || 'Feedback received';
      iconSvg = '✅';
    } else if (uType === 'awaiting_feedback') {
      typeLabel = t('todo.updateTypeAwaitingFeedback') || 'Awaiting feedback';
      iconSvg = '⏳';
    } else if (uType === 'sync_meeting') {
      typeLabel = t('todo.updateTypeSyncMeeting') || '1-on-1 Sync meeting';
      iconSvg = '🤝';
    }

    card.innerHTML = `
      <div class="ghc-header" style="margin-bottom:6px;">
        <span style="font-size:1.1rem;margin-right:6px;">${iconSvg}</span>
        <div class="ghc-title">${escH(typeLabel)}</div>
      </div>
      <div class="ghc-milestone-date">📅 ${escH(u.date || '')}</div>
      <div class="ghc-milestone-text">${escH(u.text || '')}</div>
      <div class="ghc-milestone-task">${escH(getCleanTaskTitle(todo))}</div>
    `;

    document.body.appendChild(card);
    _ganttHoverCardEl = card;

    if (typeof targetEl.getBoundingClientRect === 'function') {
      const targetRect = targetEl.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();

      let posX = targetRect.left + targetRect.width / 2 - cardRect.width / 2;
      let posY = targetRect.top - cardRect.height - 8;

      if (posY < 10) posY = targetRect.bottom + 8;
      if (posX < 10) posX = 10;
      if (posX + cardRect.width > window.innerWidth - 10) posX = window.innerWidth - cardRect.width - 10;

      card.style.left = `${posX}px`;
      card.style.top = `${posY}px`;

      requestAnimationFrame(() => {
        if (card) {
          card.style.opacity = '1';
          card.style.transform = 'translateY(0) scale(1)';
        }
      });
    }
  }, 100);
}
window.showGanttMilestoneHoverCard = showGanttMilestoneHoverCard;

function initGanttDragAndResize() {
  if (typeof document === 'undefined') return;
  const ganttSection = document.getElementById('delegated-tasks-gantt-section');
  if (!ganttSection) return;

  const barEls = ganttSection.querySelectorAll('.delegated-gantt-bar-wrap');
  barEls.forEach(barEl => {
    barEl.onmousedown = (e) => {
      if (e.target.closest('.btn-delegated-action, .delegated-flag-pin, button, input, textarea, a')) return;
      
      const handleEl = e.target.closest('.gantt-resize-handle');
      const isResize = Boolean(handleEl);
      const resizeHandleType = isResize ? handleEl.getAttribute('data-handle') : null;

      const todoId = barEl.getAttribute('data-todo-id');
      const todo = typeof getTodoById === 'function' ? getTodoById(todoId) : (todosManifest || []).find(x => x && x.id === todoId);
      if (!todo) return;

      e.preventDefault();
      e.stopPropagation();
      hideGanttHoverCard();
      _isGanttDragging = true;

      const timelineCol = barEl.closest('.delegated-timeline-col');
      if (!timelineCol) return;
      const timelineRect = timelineCol.getBoundingClientRect();

      const initialMouseX = e.clientX;
      const dToday = new Date().toISOString().slice(0, 10);
      const initialStartStr = todo.delegatedDate || todo.created || dToday;
      const initialStartTs = new Date(initialStartStr).getTime();
      const isBounded = Boolean(todo.dueDate);

      const allActive = getGanttFilteredTasks();
      const bounds = calculateGanttTimeBounds(allActive, ganttTimeScale);

      let feedbackBadge = document.getElementById('gantt-drag-feedback-badge');
      if (!feedbackBadge) {
        feedbackBadge = document.createElement('div');
        feedbackBadge.id = 'gantt-drag-feedback-badge';
        feedbackBadge.className = 'gantt-drag-feedback-badge';
        document.body.appendChild(feedbackBadge);
      }
      feedbackBadge.style.display = 'flex';

      barEl.classList.add('is-dragging');
      document.body.style.cursor = isResize ? 'ew-resize' : 'grabbing';
      document.body.style.userSelect = 'none';

      let lastDeltaDays = 0;
      let finalStartStr = initialStartStr;
      let finalDueStr = todo.dueDate || '';

      const onMouseMove = (moveEv) => {
        const deltaPx = moveEv.clientX - initialMouseX;
        const deltaPct = (deltaPx / timelineRect.width) * 100;
        const deltaMs = (deltaPct / 100) * bounds.totalDuration;
        const deltaDays = Math.round(deltaMs / 86400000);
        lastDeltaDays = deltaDays;

        if (isResize) {
          const res = calculateGanttDurationResize(todo, resizeHandleType, deltaDays);
          finalStartStr = res.startDate;
          finalDueStr = res.dueDate;

          const startPct = bounds.getPercent(new Date(finalStartStr).getTime());
          const endPct = bounds.getPercent(new Date(finalDueStr).getTime());
          const newLeft = Math.min(startPct, endPct);
          const newWidth = Math.max(2.5, Math.abs(endPct - startPct));

          barEl.style.left = `${newLeft.toFixed(2)}%`;
          barEl.style.width = `${newWidth.toFixed(2)}%`;

          feedbackBadge.textContent = `${resizeHandleType === 'start' ? 'Start: ' + finalStartStr : 'Due: ' + finalDueStr} (${res.durationDays}d)`;
        } else {
          const res = calculateGanttTimeShift(todo, deltaDays);
          finalStartStr = res.startDate;
          finalDueStr = res.dueDate;

          const startPct = bounds.getPercent(new Date(finalStartStr).getTime());
          let endPct = startPct;
          if (finalDueStr) {
            endPct = bounds.getPercent(new Date(finalDueStr).getTime());
          } else {
            endPct = bounds.getPercent(new Date(finalStartStr).getTime() + (bounds.todayTs - initialStartTs));
          }

          const newLeft = Math.min(startPct, endPct);
          const newWidth = Math.max(isBounded ? 2.5 : 4, Math.abs(endPct - startPct));

          barEl.style.left = `${newLeft.toFixed(2)}%`;
          barEl.style.width = `${newWidth.toFixed(2)}%`;

          const daysLabel = deltaDays >= 0 ? `+${deltaDays}d` : `${deltaDays}d`;
          feedbackBadge.textContent = `${finalStartStr} → ${finalDueStr || '...'} (${daysLabel})`;
        }

        feedbackBadge.style.left = `${moveEv.clientX + 14}px`;
        feedbackBadge.style.top = `${moveEv.clientY - 28}px`;
      };

      const onMouseUp = async () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        _isGanttDragging = false;
        barEl.classList.remove('is-dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        if (feedbackBadge) feedbackBadge.style.display = 'none';

        if (lastDeltaDays !== 0) {
          todo.delegatedDate = finalStartStr;
          if (finalDueStr) todo.dueDate = finalDueStr;
          if (typeof saveTodosManifest === 'function') await saveTodosManifest();
          if (isResize) {
            const finalStartTs = new Date(finalStartStr).getTime();
            const finalDueTs = new Date(finalDueStr).getTime();
            const dur = Math.max(1, Math.round((finalDueTs - finalStartTs) / 86400000));
            if (typeof toast === 'function') toast(t('todo.ganttDurationUpdated', { duration: dur }) || `Task schedule updated (${dur}d duration)`);
          } else {
            if (typeof toast === 'function') toast(t('todo.ganttTimeShifted', { days: lastDeltaDays }) || `Task timeline shifted by ${lastDeltaDays} day(s)`);
          }
          renderTodosBoard();
        } else {
          renderTodosBoard();
        }
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    };
  });
}
window.initGanttDragAndResize = initGanttDragAndResize;

async function scheduleTodoAtDateFromGantt(todoId, dateStr) {
  const todo = typeof getTodoById === 'function' ? getTodoById(todoId) : (todosManifest || []).find(x => x && x.id === todoId);
  if (!todo) return;
  todo.dueDate = dateStr;
  if (typeof saveTodosManifest === 'function') await saveTodosManifest();
  if (typeof toast === 'function') toast(t('todo.ganttDurationUpdated', { duration: 7 }) || 'Due date scheduled');
  renderTodosBoard();
}
window.scheduleTodoAtDateFromGantt = scheduleTodoAtDateFromGantt;

function addQuickTaskToWorkstream(wsName) {
  if (typeof openNewTodoDialog === 'function') {
    openNewTodoDialog({
      workstream: wsName,
      ownerId: 'colleague'
    });
  }
}
window.addQuickTaskToWorkstream = addQuickTaskToWorkstream;

function renderDelegatedTasksGanttHtml() {
  const filtered = getGanttFilteredTasks(todosManifest, ganttTaskScope, eisenhowerWorkstreamFilter);

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const todayTs = now.getTime();

  // Compute KPI counts
  let overdueCount = 0;
  let inProgressCount = 0;
  let awaitingFeedbackCount = 0;

  filtered.forEach(todo => {
    if (todo.dueDate) {
      const dueTs = new Date(todo.dueDate).getTime();
      if (!isNaN(dueTs) && dueTs < todayTs) overdueCount++;
      else inProgressCount++;
    } else {
      inProgressCount++;
    }

    if (Array.isArray(todo.updates)) {
      const hasAwaiting = todo.updates.some(u => u && u.type === 'awaiting_feedback');
      if (hasAwaiting) awaitingFeedbackCount++;
    }
  });

  // Group by workstream
  const wsGroups = new Map();
  filtered.forEach(todo => {
    const ws = (todo.workstream || (Array.isArray(todo.major_topic_tags) && todo.major_topic_tags[0]) || t('todo.delegatedWorkstreamOther') || 'General').trim();
    if (!wsGroups.has(ws)) wsGroups.set(ws, []);
    wsGroups.get(ws).push(todo);
  });

  const emptyStateHtml = `
    <div class="delegated-empty-state">
      <div class="delegated-empty-icon">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
      </div>
      <div class="delegated-empty-title">${escH(t('todo.noDelegatedTasks') || 'No delegated tasks')}</div>
      <div class="delegated-empty-desc">${escH(t('todo.noDelegatedTasksDesc') || 'Tasks assigned to colleagues or delegated will appear here in a visual Gantt timeline.')}</div>
    </div>
  `;

  // Compute time bounds using the active scale
  const bounds = calculateGanttTimeBounds(filtered, ganttTimeScale, now);
  const { weeks, todayPct, getPercent } = bounds;

  // Week scale header HTML
  const weekScaleHtml = weeks.map(w => `
    <div class="delegated-week-col-header${w.isCurrentWeek ? ' is-current-week' : ''}" style="flex:1;">
      <div class="week-title-row">
        <span class="week-num">${escH(w.key)}</span>
        ${w.isCurrentWeek ? `<span class="current-week-badge">${escH(t('todo.todayMarker') || 'Today')}</span>` : ''}
      </div>
      <div class="week-date-range">${escH(w.dateLabel)}</div>
    </div>
  `).join('');

  let groupsHtml = '';
  if (filtered.length === 0) {
    groupsHtml = emptyStateHtml;
  } else {
    for (const [wsName, todos] of wsGroups.entries()) {
      const isCollapsed = delegatedWorkstreamCollapsed.has(wsName);
      const rowsHtml = todos.map(todo => {
        const dCreated = todo.created || '';
        const dDelegated = todo.delegatedDate || todo.created || todayStr;
        const dDue = todo.dueDate || '';
        const quad = getTodoQuadrant(todo);
        const meta = getQuadrantMeta(quad);
        const ownerName = todo.owner || (typeof getColleagueLabelById === 'function' ? getColleagueLabelById(todo.ownerId, todo.ownerId) : todo.ownerId) || (isTodoDelegated(todo) ? 'Colleague' : 'Me');
        const askedByName = todo.askedBy || '';
        const cleanTitle = getCleanTaskTitle(todo);

        const startTs = new Date(dDelegated).getTime();
        const startPct = !isNaN(startTs) ? getPercent(startTs) : todayPct;

        let endPct = todayPct;
        let isBounded = false;
        let isOverdue = false;

        if (dDue) {
          const dueTs = new Date(dDue).getTime();
          if (!isNaN(dueTs)) {
            endPct = getPercent(dueTs);
            isBounded = true;
            if (dueTs < todayTs) isOverdue = true;
          }
        }

        let barLeft = Math.min(startPct, endPct);
        let barWidth = Math.max(2.5, Math.abs(endPct - startPct));
        if (!isBounded) {
          barLeft = Math.min(startPct, todayPct);
          barWidth = Math.max(4, Math.abs(todayPct - startPct));
        }

        // SVG Milestone flags along the timeline
        let flagsHtml = '';
        if (Array.isArray(todo.updates) && todo.updates.length > 0) {
          flagsHtml = todo.updates.map((u, uIdx) => {
            if (!u || !u.date) return '';
            const uTs = new Date(u.date).getTime();
            if (isNaN(uTs)) return '';
            const flagPct = getPercent(uTs);
            const uType = u.type || 'general_update';
            let flagClass = 'flag-update';
            let svgIcon = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

            if (uType === 'feedback_received') {
              flagClass = 'flag-feedback-received';
              svgIcon = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
            } else if (uType === 'awaiting_feedback') {
              flagClass = 'flag-awaiting-feedback';
              svgIcon = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 14 14"/></svg>';
            } else if (uType === 'sync_meeting') {
              flagClass = 'flag-sync-meeting';
              svgIcon = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
            }

            const flagTitle = `[${escA(u.date)}] ${escA(u.type || '')}: ${escA(u.text || '')}`;

            return `
              <div class="delegated-flag-pin ${flagClass}"
                   style="left:${flagPct.toFixed(2)}%;"
                   title="${flagTitle}"
                   onmouseenter="showGanttMilestoneHoverCard(event, '${escA(todo.id)}', ${uIdx})"
                   onmouseleave="hideGanttHoverCard()"
                   onclick="event.stopPropagation();openTodoOverlay('${escA(todo.id)}');">
                <span class="flag-icon">${svgIcon}</span>
              </div>
            `;
          }).join('');
        }

        // Latest status text
        let latestUpdateText = '';
        if (Array.isArray(todo.updates) && todo.updates.length > 0) {
          const lastU = todo.updates[todo.updates.length - 1];
          latestUpdateText = `${lastU.date ? lastU.date + ': ' : ''}${lastU.text || ''}`;
        }

        let daysDelegatedCount = 0;
        if (!isNaN(startTs)) {
          daysDelegatedCount = Math.max(0, Math.floor((todayTs - startTs) / 86400000));
        }

        const barClass = isOverdue ? 'is-overdue' : (isBounded ? 'is-bounded' : 'is-open-ended');

        // Row background grid cells with double-click quick schedule
        const rowGridBgsHtml = weeks.map(w => `
          <div class="delegated-week-grid-cell${w.isCurrentWeek ? ' is-current-week' : ''}"
               style="flex:1;"
               title="${escA(t('todo.ganttQuickSchedule') || 'Double-click to set due date for this week')}"
               ondblclick="scheduleTodoAtDateFromGantt('${escA(todo.id)}', '${escA(w.startDateStr)}')"></div>
        `).join('');

        return `
          <div class="delegated-task-row" data-todo-id="${escA(todo.id)}" ondblclick="openTodoOverlay('${escA(todo.id)}')">
            <!-- Left: Task Info & Checkbox -->
            <div class="delegated-task-info-col">
              <input type="checkbox" class="delegated-task-done-chk" title="${escA(t('todo.markDoneTooltip') || 'Mark task as completed')}" onchange="toggleTodoDoneFromGantt('${escA(todo.id)}')">
              <span class="delegated-quad-badge" style="background:${meta.color};" title="${escA(meta.actionTitle)}">${escH(quad)}</span>
              <div class="delegated-task-title-group" title="${escA(cleanTitle)}">
                <div class="delegated-task-title-text">${escH(cleanTitle)}</div>
                <div class="delegated-task-meta-pills">
                  <span class="delegated-owner-pill" title="${escA(t('todo.ownerLabel') || 'Assignee')}: @${escA(ownerName)}">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                    @${escH(ownerName)}
                  </span>
                  ${askedByName ? `
                    <span class="delegated-askedby-pill" title="${escA(t('todo.askedByLabel') || 'Asked by')}: ${escA(askedByName)}">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 14 14"/></svg>
                      ${escH(askedByName)}
                    </span>
                  ` : ''}
                </div>
              </div>
              <div class="delegated-task-actions">
                <button type="button" class="btn-delegated-action" onclick="pushTodoTo1on1('${escA(todo.id)}')" title="${escA(t('todo.pushTo1on1Tooltip') || 'Add follow-up to 1-on-1 sync notes')}">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                </button>
                <button type="button" class="btn-delegated-action" onclick="openQuickUpdatePopover('${escA(todo.id)}', event)" title="${escA(t('todo.quickUpdateTooltip') || 'Log a quick status update or checkpoint')}">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                </button>
                <button type="button" class="btn-delegated-action" onclick="openTodoOverlay('${escA(todo.id)}')" title="${escA(t('todo.editTodoTooltip') || 'Edit full task details')}">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
              </div>
            </div>

            <!-- Middle: Dates Lifecycle -->
            <div class="delegated-lifecycle-col">
              <div class="delegated-date-chip" title="${escA(t('todo.createdDateTooltip') || 'Created date')}">
                <span class="date-lbl">${escH(t('todo.createdShort') || 'Cr:')}</span>
                <span class="date-val">${escH(dCreated || '—')}</span>
              </div>
              <div class="delegated-date-chip" title="${escA(t('todo.delegatedDateTooltip') || 'Date delegated')}">
                <span class="date-lbl">${escH(t('todo.delegatedShort') || 'Del:')}</span>
                <span class="date-val">${escH(dDelegated)}</span>
              </div>
              ${dDue ? `
                <div class="delegated-date-chip ${isOverdue ? 'date-overdue' : 'date-due'}" title="${escA(t('todo.dueDateTooltip') || 'Expected return date')}">
                  <span class="date-lbl">${escH(t('todo.dueShort') || 'Due:')}</span>
                  <span class="date-val">${escH(dDue)}</span>
                </div>
              ` : `
                <button type="button" class="btn-set-ret-date" onclick="setDelegatedReturnDateInline('${escA(todo.id)}')" title="${escA(t('todo.setDueDateTooltip') || 'Set expected return date')}">+ ${escH(t('todo.setReturnDate') || 'Due Date')}</button>
              `}
            </div>

            <!-- Right: Gantt Bar & Milestone Flags with Week Grid -->
            <div class="delegated-timeline-col">
              <div class="delegated-timeline-grid-bg">${rowGridBgsHtml}</div>
              <div class="delegated-today-marker-line" style="left:${todayPct.toFixed(2)}%;" title="${escA(t('todo.todayMarker') || 'Today')}">
                <span class="delegated-today-marker-label">${escH(t('todo.todayMarker') || 'Today')}</span>
              </div>
              <div class="delegated-gantt-bar-wrap ${barClass}"
                   data-todo-id="${escA(todo.id)}"
                   data-start-date="${escA(dDelegated)}"
                   data-due-date="${escA(dDue)}"
                   style="left:${barLeft.toFixed(2)}%; width:${barWidth.toFixed(2)}%; --bar-bg:${meta.color || 'var(--accent)'};"
                   onmouseenter="showGanttHoverCard(event, '${escA(todo.id)}')"
                   onmouseleave="hideGanttHoverCard()"
                   title="${escA(cleanTitle)} (${isBounded ? (isOverdue ? t('todo.overdue') || 'Overdue' : t('todo.inProgress') || 'In Progress') : `${daysDelegatedCount}d waiting`})">
                <!-- Left duration resize handle -->
                <div class="gantt-resize-handle handle-start" data-handle="start" title="${escA(t('todo.ganttResizeStartTooltip') || 'Drag to change start date')}"></div>
                <div class="delegated-bar-fill"></div>
                <div class="delegated-bar-inner-label">
                  <span class="bar-title-text">${escH(cleanTitle)}</span>
                  <span class="bar-duration-badge">${isBounded ? (isOverdue ? escH(t('todo.overdue') || 'Overdue') : `${Math.ceil((new Date(dDue).getTime() - startTs) / 86400000)}d`) : `${daysDelegatedCount}d`}</span>
                </div>
                ${!isBounded ? `<div class="delegated-open-ended-arrow">➔</div>` : ''}
                <!-- Right duration resize handle -->
                <div class="gantt-resize-handle handle-end" data-handle="end" title="${escA(t('todo.ganttResizeEndTooltip') || 'Drag to change due date / duration')}"></div>
              </div>
              ${flagsHtml}
              ${latestUpdateText ? `<div class="delegated-inline-status" style="left:${Math.min(92, Math.max(barLeft + barWidth + 1, 10)).toFixed(2)}%;" title="${escA(latestUpdateText)}">${escH(latestUpdateText)}</div>` : ''}
            </div>
          </div>
        `;
      }).join('');

      groupsHtml += `
        <div class="delegated-workstream-group">
          <div class="delegated-group-header" onclick="toggleDelegatedWorkstreamGroup(${jq(wsName)})" title="${escA(t('todo.toggleWorkstreamGroupTooltip') || 'Toggle workstream group')}">
            <div class="delegated-group-header-left">
              <span class="delegated-group-swatch"></span>
              <span class="delegated-group-name">${escH(wsName)}</span>
              <span class="delegated-group-count">(${todos.length})</span>
            </div>
            <div class="delegated-group-header-right">
              <button type="button" class="btn-add-ws-task" onclick="event.stopPropagation();addQuickTaskToWorkstream(${jq(wsName)})" title="${escA(t('todo.ganttAddTaskToWorkstreamTooltip') || 'Add task to workstream')}">+ ${escH(t('todo.ganttAddTaskToWorkstream') || 'Add task')}</button>
              <span class="delegated-group-toggle-icon ${isCollapsed ? 'collapsed' : ''}">▼</span>
            </div>
          </div>
          ${!isCollapsed ? `<div class="delegated-group-rows">${rowsHtml}</div>` : ''}
        </div>
      `;
    }
  }

  return `
    <div class="delegated-section-container" id="delegated-tasks-gantt-section">
      <div class="delegated-section-header">
        <div class="delegated-section-header-left">
          <span class="ui-icon-wrap" style="color:var(--accent);"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span>
          <div>
            <h3 class="delegated-section-title">${escH(t('todo.delegatedMatrixTitle') || 'Delegated & Follow-up Tasks')} <span class="delegated-total-count">(${filtered.length})</span></h3>
            <p class="delegated-section-subtitle">${escH(t('todo.delegatedMatrixSubtitle') || 'Visual Gantt view grouped by workstream for tasks owned by or delegated to team members.')}</p>
          </div>
        </div>
        <div class="delegated-section-header-right">
          <!-- Scope Segmented Switcher (Delegated vs All Scheduled) -->
          <div class="gantt-segmented-ctrl gantt-scope-segmented" title="${escA(t('todo.ganttScopeTooltip') || 'Filter Gantt view')}">
            <button type="button" class="gantt-seg-btn${ganttTaskScope === 'delegated' ? ' active' : ''}" onclick="setGanttTaskScope('delegated')" title="${escA(t('todo.ganttScopeTooltip'))}">${escH(t('todo.ganttScopeDelegated') || 'Delegated')}</button>
            <button type="button" class="gantt-seg-btn${ganttTaskScope === 'all' ? ' active' : ''}" onclick="setGanttTaskScope('all')" title="${escA(t('todo.ganttScopeTooltip'))}">${escH(t('todo.ganttScopeAll') || 'All Tasks')}</button>
          </div>

          <!-- Scale / Zoom Segmented Switcher (4w / 8w / 12w / Fit) -->
          <div class="gantt-segmented-ctrl gantt-scale-segmented" title="${escA(t('todo.ganttScaleTooltip') || 'Timeline zoom and scale')}">
            <button type="button" class="gantt-seg-btn${ganttTimeScale === '4w' ? ' active' : ''}" onclick="setGanttTimeScale('4w')" title="${escA(t('todo.ganttScaleTooltip'))}">${escH(t('todo.ganttScale4w') || '4w')}</button>
            <button type="button" class="gantt-seg-btn${ganttTimeScale === '8w' ? ' active' : ''}" onclick="setGanttTimeScale('8w')" title="${escA(t('todo.ganttScaleTooltip'))}">${escH(t('todo.ganttScale8w') || '8w')}</button>
            <button type="button" class="gantt-seg-btn${ganttTimeScale === '12w' ? ' active' : ''}" onclick="setGanttTimeScale('12w')" title="${escA(t('todo.ganttScaleTooltip'))}">${escH(t('todo.ganttScale12w') || '12w')}</button>
            <button type="button" class="gantt-seg-btn${ganttTimeScale === 'fit' ? ' active' : ''}" onclick="setGanttTimeScale('fit')" title="${escA(t('todo.ganttScaleTooltip'))}">${escH(t('todo.ganttScaleFit') || 'Fit')}</button>
          </div>

          <div class="delegated-kpi-chips">
            <span class="delegated-kpi-chip" title="${escA(t('todo.delegatedSummaryCount', { count: filtered.length, workstreams: wsGroups.size }))}">
              <strong>${filtered.length}</strong> ${escH(t('todo.delegatedMatrixTitle') || 'Delegated')}
            </span>
            ${overdueCount > 0 ? `
              <span class="delegated-kpi-chip is-danger" title="${escA(t('todo.delegatedOverdueCount', { count: overdueCount }))}">
                <strong>${overdueCount}</strong> ${escH(t('todo.overdue') || 'Overdue')}
              </span>
            ` : ''}
            ${awaitingFeedbackCount > 0 ? `
              <span class="delegated-kpi-chip is-warning" title="${escA(t('todo.delegatedAwaitingFeedbackCount', { count: awaitingFeedbackCount }))}">
                <strong>${awaitingFeedbackCount}</strong> ⏳ ${escH(t('todo.awaitingFeedback') || 'Awaiting')}
              </span>
            ` : ''}
          </div>
          <button type="button" class="btn btn-secondary btn-sm" onclick="openNewTodoDialog({ ownerId: 'colleague' })" title="${escA(t('todo.newDelegatedTaskTooltip') || 'Create a new delegated task')}">+ ${escH(t('todo.newDelegatedTask') || 'New Delegated Task')}</button>
        </div>
      </div>
      <div class="delegated-timeline-canvas-card">
        <div class="delegated-timeline-canvas-header">
          <div class="col-lbl col-task">${escH(t('todo.colTask') || 'Task & Assignee')}</div>
          <div class="col-lbl col-dates">${escH(t('todo.colDates') || 'Lifecycle Dates')}</div>
          <div class="col-lbl col-gantt">
            <div class="delegated-week-scale-wrap">${weekScaleHtml}</div>
          </div>
        </div>
        <div class="delegated-groups-container">
          ${groupsHtml}
        </div>
      </div>
    </div>
  `;
}
window.renderDelegatedTasksGanttHtml = renderDelegatedTasksGanttHtml;

async function toggleTodoDoneFromGantt(todoId) {
  const todo = typeof getTodoById === 'function' ? getTodoById(todoId) : (todosManifest || []).find(x => x && x.id === todoId);
  if (!todo) return;
  if (typeof setTodoDoneById === 'function') await setTodoDoneById(todoId);
  else todo.priority = 'Done';
  renderTodosBoard();
}
window.toggleTodoDoneFromGantt = toggleTodoDoneFromGantt;

async function setDelegatedReturnDateInline(todoId) {
  const todo = typeof getTodoById === 'function' ? getTodoById(todoId) : (todosManifest || []).find(x => x && x.id === todoId);
  if (!todo) return;
  const newDate = prompt(t('todo.promptReturnDate') || 'Enter expected return date (YYYY-MM-DD):', new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
  if (newDate && /^\d{4}-\d{2}-\d{2}$/.test(newDate.trim())) {
    todo.dueDate = newDate.trim();
    if (typeof saveTodosManifest === 'function') await saveTodosManifest();
    renderTodosBoard();
  }
}
window.setDelegatedReturnDateInline = setDelegatedReturnDateInline;

async function pushTodoTo1on1(todoId) {
  const todo = typeof getTodoById === 'function' ? getTodoById(todoId) : (todosManifest || []).find(x => x && x.id === todoId);
  if (!todo) return;
  const ownerName = todo.owner || (typeof getColleagueLabelById === 'function' ? getColleagueLabelById(todo.ownerId, todo.ownerId) : todo.ownerId) || 'Colleague';
  if (typeof createSyncNoteForCollaborator === 'function') {
    await createSyncNoteForCollaborator(ownerName);
  } else {
    if (typeof toast === 'function') toast(t('common.featureNotAvailable') || 'Sync note feature not available', true);
  }
}
window.pushTodoTo1on1 = pushTodoTo1on1;

let _quickUpdatePopoverEl = null;

function closeQuickUpdatePopover() {
  if (_quickUpdatePopoverEl) {
    _quickUpdatePopoverEl.remove();
    _quickUpdatePopoverEl = null;
  }
}
window.closeQuickUpdatePopover = closeQuickUpdatePopover;

function openQuickUpdatePopover(todoId, event) {
  if (event) event.stopPropagation();
  closeQuickUpdatePopover();
  const todo = getTodoById(todoId);
  if (!todo) return;

  const todayStr = new Date().toISOString().slice(0, 10);
  const popover = document.createElement('div');
  popover.className = 'quick-update-popover';
  popover.style.cssText = `
    position: fixed;
    z-index: 5000;
    background: var(--card-bg);
    border: 1px solid var(--accent);
    border-radius: 8px;
    padding: 12px;
    box-shadow: 0 10px 25px rgba(0,0,0,0.35);
    width: 300px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  `;

  popover.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <div style="font-weight:700; font-size:0.85rem; color:var(--accent); display:flex; align-items:center; gap:6px;">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <span>${escH(t('todo.quickUpdateTitle') || 'Log Checkpoint / Update')}</span>
      </div>
      <button type="button" class="btn btn-secondary btn-sm" style="padding:1px 6px; font-size:0.75rem;" onclick="closeQuickUpdatePopover()" title="${escA(t('common.close') || 'Close')}">✕</button>
    </div>
    <div style="display:flex; gap:6px;">
      <input type="date" id="quick-update-date" class="todo-edit-input" value="${todayStr}" style="font-size:0.78rem; padding:2px 6px; width:120px;" title="${escA(t('todo.updateDateTooltip') || 'Update date')}">
      <select id="quick-update-type" class="todo-edit-input" style="font-size:0.78rem; padding:2px 6px; flex:1;" title="${escA(t('todo.updateTypeTooltip') || 'Update type')}">
        <option value="general_update">${escH(t('todo.updateTypeGeneral') || 'Progress update')}</option>
        <option value="feedback_received">${escH(t('todo.updateTypeFeedbackReceived') || 'Feedback received')}</option>
        <option value="awaiting_feedback">${escH(t('todo.updateTypeAwaitingFeedback') || 'Awaiting feedback')}</option>
        <option value="sync_meeting">${escH(t('todo.updateTypeSyncMeeting') || '1-on-1 Sync meeting')}</option>
      </select>
    </div>
    <textarea id="quick-update-text" class="todo-edit-input" placeholder="${escA(t('todo.updateTextPlaceholder') || 'What was done or discussed?')}" rows="2" style="font-size:0.8rem; padding:4px 6px; resize:none;" title="${escA(t('todo.updateTextTooltip') || 'Update text')}"></textarea>
    <div style="display:flex; justify-content:flex-end; gap:6px;">
      <button type="button" class="btn btn-secondary btn-sm" onclick="closeQuickUpdatePopover()" title="${escA(t('common.cancel') || 'Cancel')}">${escH(t('common.cancel') || 'Cancel')}</button>
      <button type="button" class="btn btn-save btn-sm" onclick="saveQuickUpdateFromPopover('${escA(todo.id)}')" title="${escA(t('todo.saveUpdateTooltip') || 'Save update')}">${escH(t('todo.saveUpdate') || 'Save Update')}</button>
    </div>
  `;

  document.body.appendChild(popover);
  _quickUpdatePopoverEl = popover;

  const clickX = event.clientX;
  const clickY = event.clientY;
  const popRect = popover.getBoundingClientRect();
  let posX = clickX + 10;
  let posY = clickY + 10;
  if (posX + popRect.width > window.innerWidth - 10) posX = window.innerWidth - popRect.width - 15;
  if (posY + popRect.height > window.innerHeight - 10) posY = window.innerHeight - popRect.height - 15;
  posX = Math.max(10, posX);
  posY = Math.max(10, posY);

  popover.style.left = `${posX}px`;
  popover.style.top = `${posY}px`;

  setTimeout(() => {
    if (typeof document !== 'undefined') {
      const txt = document.getElementById('quick-update-text');
      if (txt) txt.focus();
    }
  }, 50);
}
window.openQuickUpdatePopover = openQuickUpdatePopover;

async function saveQuickUpdateFromPopover(todoId) {
  const todo = getTodoById(todoId);
  if (!todo) return;
  const dateInp = document.getElementById('quick-update-date');
  const typeInp = document.getElementById('quick-update-type');
  const textInp = document.getElementById('quick-update-text');

  const uDate = dateInp ? dateInp.value : '';
  const uType = typeInp ? typeInp.value : 'general_update';
  const uText = textInp ? textInp.value.trim() : '';

  if (!uText) {
    toast(t('common.fillRequiredFields') || 'Please enter update text', true);
    return;
  }

  if (!Array.isArray(todo.updates)) todo.updates = [];
  todo.updates.push({
    id: 'upd-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    date: uDate || new Date().toISOString().slice(0, 10),
    type: uType,
    text: uText,
    created: new Date().toISOString()
  });

  await saveTodosManifest();
  closeQuickUpdatePopover();
  toast(t('common.updateSaved') || 'Update logged successfully');
  renderTodosBoard();
}
window.saveQuickUpdateFromPopover = saveQuickUpdateFromPopover;

// Single-Todo Interactive Matrix Picker Modal Logic
let _tempMatrixX = 50;
let _tempMatrixY = 50;
let _tempMatrixQuad = 'Q2';
let _matrixPickerDragging = false;

function openSingleTodoMatrixPicker() {
  const overlay = document.getElementById('todo-matrix-picker-overlay');
  if (!overlay) return;

  const currentQuad = _todoModalQuadrant && _todoModalQuadrant !== 'Done' ? _todoModalQuadrant : 'Q2';
  if (typeof _todoModalEisenhowerX === 'number' && typeof _todoModalEisenhowerY === 'number') {
    _tempMatrixX = _todoModalEisenhowerX;
    _tempMatrixY = _todoModalEisenhowerY;
  } else {
    const defCoords = (typeof EisenhowerUtils !== 'undefined' && EisenhowerUtils.getDefaultCoordsForQuadrant)
      ? EisenhowerUtils.getDefaultCoordsForQuadrant(currentQuad, _todoOverlayFile || 'temp')
      : { x: 25, y: 25 };
    _tempMatrixX = defCoords.x;
    _tempMatrixY = defCoords.y;
  }

  const modalTitle = document.getElementById('todo-matrix-picker-title');
  if (modalTitle) modalTitle.textContent = t('todo.positionInMatrix') || 'Position in Eisenhower Matrix';

  const pickerBtn = document.getElementById('todo-matrix-picker-btn');
  if (pickerBtn) {
    pickerBtn.textContent = `📍 ${t('todo.interactiveMatrixPicker') || 'Interactive Matrix'}`;
    pickerBtn.title = t('todo.positionInMatrix') || 'Position in Eisenhower Matrix';
  }

  const confirmBtn = document.getElementById('todo-matrix-picker-confirm-btn');
  if (confirmBtn) {
    confirmBtn.textContent = t('todo.applyPosition') || 'Apply Position';
    confirmBtn.title = t('todo.applyPositionTooltip') || 'Apply position and Eisenhower quadrant';
  }

  const cancelBtn = document.getElementById('todo-matrix-picker-cancel-btn');
  if (cancelBtn) {
    cancelBtn.textContent = t('common.cancel') || 'Cancel';
    cancelBtn.title = t('todo.cancelMatrixPickerTooltip') || 'Cancel position changes and close matrix picker';
  }

  const closeBtn = document.getElementById('todo-matrix-picker-close-btn');
  if (closeBtn) {
    closeBtn.title = t('todo.closeMatrixPickerTooltip') || 'Close matrix picker';
  }

  const q1Label = document.getElementById('mp-q1-label');
  if (q1Label) q1Label.textContent = `⚡ Q1 - ${getQuadrantMeta('Q1').shortLabel}`;
  const q2Label = document.getElementById('mp-q2-label');
  if (q2Label) q2Label.textContent = `☕ Q2 - ${getQuadrantMeta('Q2').shortLabel}`;
  const q3Label = document.getElementById('mp-q3-label');
  if (q3Label) q3Label.textContent = `💬 Q3 - ${getQuadrantMeta('Q3').shortLabel}`;
  const q4Label = document.getElementById('mp-q4-label');
  if (q4Label) q4Label.textContent = `🌱 Q4 - ${getQuadrantMeta('Q4').shortLabel}`;

  const titleInp = document.getElementById('todo-edit-title');
  const taskTitle = (titleInp ? titleInp.value.trim() : '') || (t('todo.tasks') || 'Task');

  const labelEl = document.getElementById('todo-matrix-picker-label');
  if (labelEl) labelEl.textContent = truncateTaskText(taskTitle, 20);

  updateSingleTodoMatrixPickerDisplay();
  initSingleTodoMatrixCanvasEvents();

  overlay.style.zIndex = '9999';
  overlay.classList.add('visible');
  overlay.style.display = 'flex';
}

function updateSingleTodoMatrixPickerDisplay() {
  const canvas = document.getElementById('todo-matrix-picker-canvas');
  const dot = document.getElementById('todo-matrix-picker-dot');
  const bullet = document.getElementById('todo-matrix-picker-bullet');
  const coordsText = document.getElementById('todo-matrix-picker-coords-text');
  if (!canvas || !dot) return;

  _tempMatrixQuad = (_tempMatrixX < 50) ? (_tempMatrixY < 50 ? 'Q1' : 'Q3') : (_tempMatrixY < 50 ? 'Q2' : 'Q4');
  const meta = getQuadrantMeta(_tempMatrixQuad);

  dot.style.left = `${_tempMatrixX.toFixed(1)}%`;
  dot.style.top = `${_tempMatrixY.toFixed(1)}%`;
  dot.style.color = meta.color;
  if (bullet) bullet.style.backgroundColor = meta.color;

  if (coordsText) {
    const uLabel = t('todo.urgency') || 'Urgency';
    const iLabel = t('todo.important') || 'Importance';
    coordsText.textContent = `${_tempMatrixQuad} (${meta.actionTitle}) — ${uLabel}: ${(100 - _tempMatrixX).toFixed(0)}%, ${iLabel}: ${(100 - _tempMatrixY).toFixed(0)}%`;
  }
}

function initSingleTodoMatrixCanvasEvents() {
  const canvas = document.getElementById('todo-matrix-picker-canvas');
  if (!canvas || canvas.hasAttribute('data-events-bound')) return;
  canvas.setAttribute('data-events-bound', 'true');

  const handlePointerMove = (e) => {
    if (!_matrixPickerDragging) return;
    const rect = canvas.getBoundingClientRect();
    const px = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const py = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    _tempMatrixX = Math.max(5, Math.min(95, (px / rect.width) * 100));
    _tempMatrixY = Math.max(5, Math.min(95, (py / rect.height) * 100));
    updateSingleTodoMatrixPickerDisplay();
  };

  const handlePointerUp = () => {
    _matrixPickerDragging = false;
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);

    // Magnetic snap to quadrant center if close (< 6%)
    const snapCenters = [25, 75];
    let didSnap = false;
    for (const cx of snapCenters) {
      if (Math.abs(_tempMatrixX - cx) < 6) {
        if (_tempMatrixX !== cx) didSnap = true;
        _tempMatrixX = cx;
      }
    }
    for (const cy of snapCenters) {
      if (Math.abs(_tempMatrixY - cy) < 6) {
        if (_tempMatrixY !== cy) didSnap = true;
        _tempMatrixY = cy;
      }
    }
    updateSingleTodoMatrixPickerDisplay();

    if (didSnap) {
      const dot = document.getElementById('todo-matrix-picker-dot');
      if (dot) {
        dot.classList.remove('snapped');
        void dot.offsetWidth;
        dot.classList.add('snapped');
        setTimeout(() => dot.classList.remove('snapped'), 400);
      }
    }
  };

  canvas.addEventListener('pointerdown', (e) => {
    _matrixPickerDragging = true;
    const rect = canvas.getBoundingClientRect();
    const px = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const py = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    _tempMatrixX = Math.max(5, Math.min(95, (px / rect.width) * 100));
    _tempMatrixY = Math.max(5, Math.min(95, (py / rect.height) * 100));
    updateSingleTodoMatrixPickerDisplay();

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  });
}

function confirmSingleTodoMatrixPicker() {
  _todoModalEisenhowerX = _tempMatrixX;
  _todoModalEisenhowerY = _tempMatrixY;
  _todoModalQuadrant = _tempMatrixQuad;

  const quadSel = document.getElementById('todo-edit-quadrant');
  if (quadSel) quadSel.value = _tempMatrixQuad;

  closeSingleTodoMatrixPicker();
}

function closeSingleTodoMatrixPicker() {
  const overlay = document.getElementById('todo-matrix-picker-overlay');
  if (overlay) {
    overlay.classList.remove('visible');
    overlay.style.display = 'none';
  }
  _matrixPickerDragging = false;
}

function requestCloseTodoOverlay() {
  closeTodoOverlay();
}

// Track whether a mousedown started inside overlay panels to prevent
// text-selection or drag gestures from accidentally closing overlays on mouseup.
let _todoOverlayPanelMouseDown = false;
let _matrixPickerPanelMouseDown = false;
let _quadrantOverlayPanelMouseDown = false;

document.addEventListener('mousedown', (e) => {
  const todoPanel = document.querySelector('#todo-edit-overlay .overlay-panel');
  _todoOverlayPanelMouseDown = !!(todoPanel && todoPanel.contains(e.target));

  const pickerPanel = document.querySelector('#todo-matrix-picker-overlay .overlay-panel');
  _matrixPickerPanelMouseDown = !!(pickerPanel && pickerPanel.contains(e.target));

  const quadrantPanel = document.querySelector('#eisenhower-quadrant-overlay .overlay-panel');
  _quadrantOverlayPanelMouseDown = !!(quadrantPanel && quadrantPanel.contains(e.target));
}, true);

function todoOverlayBackdropClick(event) {
  if (event.target === event.currentTarget && !_todoOverlayPanelMouseDown) {
    closeTodoOverlay();
  }
  _todoOverlayPanelMouseDown = false;
}

function todoMatrixPickerBackdropClick(event) {
  if (event.target === event.currentTarget && !_matrixPickerPanelMouseDown) {
    closeSingleTodoMatrixPicker();
  }
  _matrixPickerPanelMouseDown = false;
}

function closeTodoOverlay() {
  closeTodoContextMenu();
  setTodoOverlayBusy(false);
  const overlay = document.getElementById('todo-edit-overlay');
  if (overlay) {
    overlay.style.display = 'none';
    overlay.style.zIndex = '';
  }
  _todoOverlayFile = null;
  _todoOverlayPriority = null;
  if (typeof refreshTodoViews === 'function') refreshTodoViews();
}

window.updateTodoDueDateDisplay = updateTodoDueDateDisplay;
window.triggerTodoDatePicker = triggerTodoDatePicker;
window.onTodoDueDateChanged = onTodoDueDateChanged;
window.clearTodoDueDate = clearTodoDueDate;
window.setTodoModalStatus = setTodoModalStatus;
window.onTodoModalQuadrantChanged = onTodoModalQuadrantChanged;
window.openSingleTodoMatrixPicker = openSingleTodoMatrixPicker;
window.confirmSingleTodoMatrixPicker = confirmSingleTodoMatrixPicker;
window.closeSingleTodoMatrixPicker = closeSingleTodoMatrixPicker;
window.todoMatrixPickerBackdropClick = todoMatrixPickerBackdropClick;
window.markTodoDoneFromOverlay = markTodoDoneFromOverlay;
window.toggleWipFromOverlay = toggleWipFromOverlay;
window.reopenTodoFromOverlay = reopenTodoFromOverlay;
window.deleteTodoFromOverlay = deleteTodoFromOverlay;
window.enterTodoEditMode = enterTodoEditMode;
window.saveTodoFromOverlay = saveTodoFromOverlay;
window.requestCloseTodoOverlay = requestCloseTodoOverlay;
window.closeTodoOverlay = closeTodoOverlay;
window.todoOverlayBackdropClick = todoOverlayBackdropClick;

/* ═══ Scatterplot Pointer Drag & Drop, Live Percentages & Ghost Dot ═══ */

let _scatterplotInitialized = false;
let activeDot = null;
let activeTodoId = null;
let isDragging = false;
let ghostDot = null;
let _clusterMap = {};
let activeClusterId = null;
let activeIsClusterCenter = false;
let activeIsRadialDot = false;
let clusterInitialTodos = [];
let radialDotProxy = null;
let _eisenhowerDraftDot = null;
let _draftDotX = 50;
let _draftDotY = 50;
let activeIsDraftDot = false;
let wasAlreadyDraftDot = false;

function removeEisenhowerDraftDot() {
  if (_eisenhowerDraftDot) {
    if (_eisenhowerDraftDot.parentElement) {
      _eisenhowerDraftDot.parentElement.removeChild(_eisenhowerDraftDot);
    }
    _eisenhowerDraftDot = null;
  }
}
window.removeEisenhowerDraftDot = removeEisenhowerDraftDot;

function createOrUpdateEisenhowerDraftDot(canvas, pctX, pctY) {
  const minPct = (typeof EisenhowerUtils !== 'undefined' && EisenhowerUtils.MIN_SCATTER_PCT) ? EisenhowerUtils.MIN_SCATTER_PCT : 6;
  const maxPct = (typeof EisenhowerUtils !== 'undefined' && EisenhowerUtils.MAX_SCATTER_PCT) ? EisenhowerUtils.MAX_SCATTER_PCT : 94;
  pctX = Math.max(minPct, Math.min(maxPct, pctX));
  pctY = Math.max(minPct, Math.min(maxPct, pctY));

  _draftDotX = pctX;
  _draftDotY = pctY;

  const quad = (typeof EisenhowerUtils !== 'undefined' && EisenhowerUtils.getQuadrantFromCoords)
    ? EisenhowerUtils.getQuadrantFromCoords(pctX, pctY)
    : (pctX < 50 ? (pctY < 50 ? 'Q1' : 'Q3') : (pctY < 50 ? 'Q2' : 'Q4'));
  const meta = (typeof getQuadrantMeta === 'function') ? getQuadrantMeta(quad) : { color: '#f59e0b' };

  if (!_eisenhowerDraftDot || !_eisenhowerDraftDot.parentElement) {
    _eisenhowerDraftDot = document.createElement('div');
    _eisenhowerDraftDot.className = 'eisenhower-task-text eisenhower-draft-dot';
    _eisenhowerDraftDot.id = 'eisenhower-draft-dot';
    _eisenhowerDraftDot.setAttribute('role', 'button');
    _eisenhowerDraftDot.setAttribute('tabindex', '0');
    _eisenhowerDraftDot.setAttribute('title', (typeof t === 'function' ? (t('todo.newTodoTooltip') || 'Create a new task') : 'Create a new task'));
    _eisenhowerDraftDot.innerHTML = `
      <span class="eisenhower-task-bullet" style="background-color:${meta.color};"></span>
      <span class="eisenhower-task-title-text">+ ${escH(typeof t === 'function' ? (t('todo.newShort') || 'Nouvelle tâche') : 'Nouvelle tâche')}</span>
    `;
    _eisenhowerDraftDot.onkeydown = (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        const curX = _draftDotX;
        const curY = _draftDotY;
        const curQuad = (typeof EisenhowerUtils !== 'undefined' && EisenhowerUtils.getQuadrantFromCoords)
          ? EisenhowerUtils.getQuadrantFromCoords(curX, curY)
          : (curX < 50 ? (curY < 50 ? 'Q1' : 'Q3') : (curY < 50 ? 'Q2' : 'Q4'));
        const curPri = (typeof EisenhowerUtils !== 'undefined' && EisenhowerUtils.getPriorityForQuadrant)
          ? EisenhowerUtils.getPriorityForQuadrant(curQuad)
          : (curQuad === 'Q1' ? 'High' : curQuad === 'Q2' ? 'Medium' : 'Low');
        removeEisenhowerDraftDot();
        openNewTodoDialog({
          priority: curPri,
          eisenhowerQuadrant: curQuad,
          eisenhowerX: Math.round(curX * 10) / 10,
          eisenhowerY: Math.round(curY * 10) / 10
        });
      }
    };
    canvas.appendChild(_eisenhowerDraftDot);
  }

  _eisenhowerDraftDot.style.left = `${pctX.toFixed(2)}%`;
  _eisenhowerDraftDot.style.top = `${pctY.toFixed(2)}%`;
  _eisenhowerDraftDot.style.setProperty('--task-accent', meta.color);
  _eisenhowerDraftDot.style.color = meta.color;
  const bullet = _eisenhowerDraftDot.querySelector('.eisenhower-task-bullet');
  if (bullet) bullet.style.backgroundColor = meta.color;

  return _eisenhowerDraftDot;
}
window.createOrUpdateEisenhowerDraftDot = createOrUpdateEisenhowerDraftDot;

function initScatterplotDragAndDrop() {
  const canvas = document.getElementById('eisenhower-map-canvas');
  if (!canvas) return;

  let startX = 0, startY = 0;
  let dotInitialLeft = 0, dotInitialTop = 0;
  let origPctX = 50, origPctY = 50;

  const guideX = document.getElementById('eisenhower-guide-x');
  const guideY = document.getElementById('eisenhower-guide-y');
  const pillPctUrgent = document.getElementById('axis-pill-pct-urgent');
  const pillPctNotUrgent = document.getElementById('axis-pill-pct-not-urgent');
  const pillPctImportant = document.getElementById('axis-pill-pct-important');
  const pillPctNotImportant = document.getElementById('axis-pill-pct-not-important');

  function getEventCoords(e) {
    const clientX = e.clientX ?? (e.touches && e.touches[0] && e.touches[0].clientX) ?? (e.changedTouches && e.changedTouches[0] && e.changedTouches[0].clientX) ?? 0;
    const clientY = e.clientY ?? (e.touches && e.touches[0] && e.touches[0].clientY) ?? (e.changedTouches && e.changedTouches[0] && e.changedTouches[0].clientY) ?? 0;
    return { clientX, clientY };
  }

  function cleanupGhostDot() {
    if (ghostDot && ghostDot.parentElement) {
      ghostDot.parentElement.removeChild(ghostDot);
    }
    ghostDot = null;
  }

  function resetQuadrantHighlights() {
    ['rect-q1','rect-q2','rect-q3','rect-q4'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.setAttribute('fill-opacity', '1');
    });
  }

  function highlightActiveQuadrant(quad) {
    const quadMap = { Q1: 'rect-q1', Q2: 'rect-q2', Q3: 'rect-q3', Q4: 'rect-q4' };
    ['rect-q1','rect-q2','rect-q3','rect-q4'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        if (id === quadMap[quad]) el.setAttribute('fill-opacity', '1.8');
        else el.setAttribute('fill-opacity', '0.4');
      }
    });
  }

  function cancelDragState() {
    if (activeDot) {
      activeDot.classList.remove('dragging');
      if (activeIsRadialDot) {
        activeDot.style.opacity = '';
        activeDot.style.pointerEvents = '';
      }
    }
    if (radialDotProxy && radialDotProxy.parentElement) {
      radialDotProxy.parentElement.removeChild(radialDotProxy);
    }
    radialDotProxy = null;
    cleanupGhostDot();
    resetQuadrantHighlights();
    if (guideX) guideX.style.display = 'none';
    if (guideY) guideY.style.display = 'none';

    [pillPctUrgent, pillPctNotUrgent, pillPctImportant, pillPctNotImportant].forEach(el => {
      if (el) { el.textContent = ''; el.style.display = 'none'; }
    });

    activeDot = null;
    activeTodoId = null;
    activeClusterId = null;
    activeIsClusterCenter = false;
    activeIsRadialDot = false;
    activeIsDraftDot = false;
    wasAlreadyDraftDot = false;
    clusterInitialTodos = [];
    isDragging = false;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
  }

  function onPointerDown(e) {
    if (_eisenhowerQuickPopover && _eisenhowerQuickPopover.contains(e.target)) return;
    if (e.target.closest('.eisenhower-quadrant-bg-title')) return;

    const draftDotEl = e.target.closest('.eisenhower-draft-dot');
    const dot = e.target.closest('.eisenhower-task-text');

    // Immediately hide hover popover when clicking/interacting with matrix
    closeEisenhowerQuickActionPopover(true);
    hideDotTooltip(0);

    const coords = getEventCoords(e);
    startX = coords.clientX;
    startY = coords.clientY;

    const rect = canvas.getBoundingClientRect();

    if (draftDotEl) {
      // User clicked on existing draft dot
      activeDot = draftDotEl;
      activeIsDraftDot = true;
      wasAlreadyDraftDot = true;
      activeIsClusterCenter = false;
      activeIsRadialDot = false;
      activeTodoId = null;
      activeClusterId = null;

      const dotRect = draftDotEl.getBoundingClientRect();
      dotInitialLeft = dotRect.left - rect.left + dotRect.width / 2;
      dotInitialTop = dotRect.top - rect.top + dotRect.height / 2;

      origPctX = _draftDotX;
      origPctY = _draftDotY;
      isDragging = false;

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      return;
    }

    if (dot) {
      // User clicked on existing task / cluster dot
      removeEisenhowerDraftDot();

      activeDot = dot;
      activeIsDraftDot = false;
      wasAlreadyDraftDot = false;
      activeIsClusterCenter = dot.classList.contains('eisenhower-cluster-dot');
      activeIsRadialDot = dot.classList.contains('eisenhower-radial-dot');
      activeTodoId = dot.getAttribute('data-todo-id');

      const clusterGroupEl = dot.closest('.eisenhower-cluster-group');
      activeClusterId = activeIsClusterCenter
        ? dot.getAttribute('data-cluster-id')
        : (clusterGroupEl?.dataset.clusterId || null);

      const dotRect = dot.getBoundingClientRect();
      dotInitialLeft = dotRect.left - rect.left + dotRect.width / 2;
      dotInitialTop = dotRect.top - rect.top + dotRect.height / 2;

      origPctX = Math.max(6, Math.min(94, (dotInitialLeft / (rect.width || 1)) * 100));
      origPctY = Math.max(6, Math.min(94, (dotInitialTop / (rect.height || 1)) * 100));

      isDragging = false;

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      return;
    }

    // Clicked on empty/non-used canvas space: spawn or relocate draft dot
    const clickPxX = coords.clientX - rect.left;
    const clickPxY = coords.clientY - rect.top;
    const pctX = Math.max(6, Math.min(94, (clickPxX / (rect.width || 1)) * 100));
    const pctY = Math.max(6, Math.min(94, (clickPxY / (rect.height || 1)) * 100));

    const draftDot = createOrUpdateEisenhowerDraftDot(canvas, pctX, pctY);
    activeDot = draftDot;
    activeIsDraftDot = true;
    wasAlreadyDraftDot = false;
    activeIsClusterCenter = false;
    activeIsRadialDot = false;
    activeTodoId = null;
    activeClusterId = null;

    dotInitialLeft = clickPxX;
    dotInitialTop = clickPxY;
    origPctX = pctX;
    origPctY = pctY;

    isDragging = false;

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }

  function onPointerMove(e) {
    if (!activeDot) return;
    const coords = getEventCoords(e);
    const dx = coords.clientX - startX;
    const dy = coords.clientY - startY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (!isDragging && dist > 4) {
      isDragging = true;
      hideDotTooltip(0);
      if (guideX) guideX.style.display = 'block';
      if (guideY) guideY.style.display = 'block';

      if (activeIsDraftDot) {
        activeDot.classList.add('dragging');
      } else if (activeIsRadialDot) {
        // Promote radial dot into a freely-positionable canvas proxy
        const taskAccent = getComputedStyle(activeDot).getPropertyValue('--task-accent').trim() || activeDot.style.color || '';
        radialDotProxy = document.createElement('div');
        radialDotProxy.className = 'eisenhower-task-text dragging';
        radialDotProxy.innerHTML = activeDot.innerHTML;
        radialDotProxy.style.cssText = `position:absolute;left:${dotInitialLeft}px;top:${dotInitialTop}px;transform:translate(-50%,-50%);z-index:100;pointer-events:none;--task-accent:${taskAccent};color:${activeDot.style.color || taskAccent};`;
        canvas.appendChild(radialDotProxy);

        // Ghost at original fanout position
        cleanupGhostDot();
        ghostDot = document.createElement('div');
        ghostDot.className = 'eisenhower-task-text eisenhower-task-text-ghost';
        ghostDot.innerHTML = activeDot.innerHTML;
        ghostDot.style.cssText = `position:absolute;left:${dotInitialLeft}px;top:${dotInitialTop}px;transform:translate(-50%,-50%);z-index:5;pointer-events:none;--task-accent:${taskAccent};color:${activeDot.style.color || taskAccent};`;
        canvas.appendChild(ghostDot);

        // Hide the original slot inside the fanout
        activeDot.style.opacity = '0';
        activeDot.style.pointerEvents = 'none';

      } else if (activeIsClusterCenter) {
        // Snapshot all cluster todos for batch move
        const cluster = _clusterMap[activeClusterId];
        if (cluster) {
          clusterInitialTodos = cluster.items.map(it => ({
            todo: it.todo,
            origX: typeof it.todo.eisenhowerX === 'number' ? it.todo.eisenhowerX : it.x,
            origY: typeof it.todo.eisenhowerY === 'number' ? it.todo.eisenhowerY : it.y,
          }));
        }
        activeDot.classList.add('dragging');
        const taskAccent = getComputedStyle(activeDot).getPropertyValue('--task-accent').trim() || activeDot.style.color || '';
        cleanupGhostDot();
        ghostDot = document.createElement('div');
        ghostDot.className = 'eisenhower-task-text eisenhower-task-text-ghost';
        ghostDot.innerHTML = activeDot.innerHTML;
        ghostDot.style.cssText = `position:absolute;left:${dotInitialLeft}px;top:${dotInitialTop}px;transform:translate(-50%,-50%);z-index:5;pointer-events:none;--task-accent:${taskAccent};color:${activeDot.style.color || taskAccent};`;
        canvas.appendChild(ghostDot);

      } else {
        // Solo dot drag
        activeDot.classList.add('dragging');
        cleanupGhostDot();
        ghostDot = activeDot.cloneNode(true);
        ghostDot.className = 'eisenhower-task-text eisenhower-task-text-ghost';
        ghostDot.style.pointerEvents = 'none';
        ghostDot.style.zIndex = '5';
        canvas.appendChild(ghostDot);
      }
    }

    if (isDragging) {
      const rect = canvas.getBoundingClientRect();
      let newPxX = dotInitialLeft + dx;
      let newPxY = dotInitialTop + dy;
      newPxX = Math.max(20, Math.min(rect.width - 20, newPxX));
      newPxY = Math.max(20, Math.min(rect.height - 20, newPxY));
      const pctX = (newPxX / (rect.width || 1)) * 100;
      const pctY = (newPxY / (rect.height || 1)) * 100;

      if (activeIsDraftDot) {
        _draftDotX = pctX;
        _draftDotY = pctY;
        activeDot.style.left = `${pctX}%`;
        activeDot.style.top = `${pctY}%`;

        // Live quadrant color update for draft dot
        const currentQuad = (typeof EisenhowerUtils !== 'undefined')
          ? EisenhowerUtils.getQuadrantFromCoords(pctX, pctY)
          : (pctX < 50 ? (pctY < 50 ? 'Q1' : 'Q3') : (pctY < 50 ? 'Q2' : 'Q4'));
        const meta = (typeof getQuadrantMeta === 'function') ? getQuadrantMeta(currentQuad) : { color: '#f59e0b' };
        activeDot.style.setProperty('--task-accent', meta.color);
        activeDot.style.color = meta.color;
        const bullet = activeDot.querySelector('.eisenhower-task-bullet');
        if (bullet) bullet.style.backgroundColor = meta.color;

      } else if (activeIsRadialDot && radialDotProxy) {
        // Move free proxy
        radialDotProxy.style.left = `${newPxX}px`;
        radialDotProxy.style.top = `${newPxY}px`;
      } else if (activeIsClusterCenter) {
        // Slide whole cluster group
        const clGroupEl = document.getElementById(`cluster-group-${activeClusterId}`);
        if (clGroupEl) { clGroupEl.style.left = `${pctX}%`; clGroupEl.style.top = `${pctY}%`; }
      } else {
        activeDot.style.left = `${pctX}%`;
        activeDot.style.top = `${pctY}%`;
      }

      // Quadrant highlight & axis pill readouts (common to all modes)
      const origUrgency = Math.round(100 - origPctX);
      const currUrgency = Math.round(100 - pctX);
      const deltaUrgency = currUrgency - origUrgency;
      const origImportance = Math.round(100 - origPctY);
      const currImportance = Math.round(100 - pctY);
      const deltaImportance = currImportance - origImportance;

      const currentQuad = (typeof EisenhowerUtils !== 'undefined')
        ? EisenhowerUtils.getQuadrantFromCoords(pctX, pctY)
        : (pctX < 50 ? (pctY < 50 ? 'Q1' : 'Q3') : (pctY < 50 ? 'Q2' : 'Q4'));
      highlightActiveQuadrant(currentQuad);

      if (guideX) { guideX.style.top = `${pctY}%`; guideX.style.left = '0%'; guideX.style.width = '100%'; }
      if (guideY) { guideY.style.left = `${pctX}%`; guideY.style.top = '0%'; guideY.style.height = '100%'; }

      const deltaUStr = deltaUrgency > 0 ? `+${deltaUrgency}%` : `${deltaUrgency}%`;
      const deltaIStr = deltaImportance > 0 ? `+${deltaImportance}%` : `${deltaImportance}%`;
      if (pctX < 50) {
        if (pillPctUrgent) { pillPctUrgent.textContent = `${currUrgency}% (orig: ${origUrgency}%, ${deltaUStr})`; pillPctUrgent.style.display = 'inline-block'; }
        if (pillPctNotUrgent) pillPctNotUrgent.style.display = 'none';
      } else {
        if (pillPctNotUrgent) { pillPctNotUrgent.textContent = `${100 - currUrgency}% (orig: ${100 - origUrgency}%, ${-deltaUrgency > 0 ? '+' : ''}${-deltaUrgency}%)`; pillPctNotUrgent.style.display = 'inline-block'; }
        if (pillPctUrgent) pillPctUrgent.style.display = 'none';
      }
      if (pctY < 50) {
        if (pillPctImportant) { pillPctImportant.textContent = `${currImportance}% (orig: ${origImportance}%, ${deltaIStr})`; pillPctImportant.style.display = 'inline-block'; }
        if (pillPctNotImportant) pillPctNotImportant.style.display = 'none';
      } else {
        if (pillPctNotImportant) { pillPctNotImportant.textContent = `${100 - currImportance}% (orig: ${100 - origImportance}%, ${-deltaImportance > 0 ? '+' : ''}${-deltaImportance}%)`; pillPctNotImportant.style.display = 'inline-block'; }
        if (pillPctImportant) pillPctImportant.style.display = 'none';
      }
    }
  }

  async function onPointerUp(e) {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);

    if (!activeDot) return;

    const coords = getEventCoords(e);
    const dx = coords.clientX - startX;
    const dy = coords.clientY - startY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (guideX) guideX.style.display = 'none';
    if (guideY) guideY.style.display = 'none';
    [pillPctUrgent, pillPctNotUrgent, pillPctImportant, pillPctNotImportant].forEach(el => {
      if (el) { el.textContent = ''; el.style.display = 'none'; }
    });
    resetQuadrantHighlights();
    cleanupGhostDot();
    if (radialDotProxy && radialDotProxy.parentElement) {
      radialDotProxy.parentElement.removeChild(radialDotProxy);
    }
    radialDotProxy = null;

    const minPct = (typeof EisenhowerUtils !== 'undefined' && EisenhowerUtils.MIN_SCATTER_PCT) ? EisenhowerUtils.MIN_SCATTER_PCT : 6;
    const maxPct = (typeof EisenhowerUtils !== 'undefined' && EisenhowerUtils.MAX_SCATTER_PCT) ? EisenhowerUtils.MAX_SCATTER_PCT : 94;

    if (activeIsDraftDot) {
      if (dist > 4 && isDragging) {
        // Dragged draft dot across matrix and released -> open modal with final coords
        const rect = canvas.getBoundingClientRect();
        const finalPxX = Math.max(20, Math.min(rect.width - 20, dotInitialLeft + dx));
        const finalPxY = Math.max(20, Math.min(rect.height - 20, dotInitialTop + dy));
        const pctX = Math.max(minPct, Math.min(maxPct, (finalPxX / (rect.width || 1)) * 100));
        const pctY = Math.max(minPct, Math.min(maxPct, (finalPxY / (rect.height || 1)) * 100));

        const quad = (typeof EisenhowerUtils !== 'undefined' && EisenhowerUtils.getQuadrantFromCoords)
          ? EisenhowerUtils.getQuadrantFromCoords(pctX, pctY)
          : (pctX < 50 ? (pctY < 50 ? 'Q1' : 'Q3') : (pctY < 50 ? 'Q2' : 'Q4'));
        const pri = (typeof EisenhowerUtils !== 'undefined' && EisenhowerUtils.getPriorityForQuadrant)
          ? EisenhowerUtils.getPriorityForQuadrant(quad)
          : (quad === 'Q1' ? 'High' : quad === 'Q2' ? 'Medium' : 'Low');

        removeEisenhowerDraftDot();
        openNewTodoDialog({
          priority: pri,
          eisenhowerQuadrant: quad,
          eisenhowerX: Math.round(pctX * 10) / 10,
          eisenhowerY: Math.round(pctY * 10) / 10
        });

      } else if (wasAlreadyDraftDot) {
        // Second click on already-existing draft dot -> open modal with its coords
        const pctX = Math.max(minPct, Math.min(maxPct, _draftDotX));
        const pctY = Math.max(minPct, Math.min(maxPct, _draftDotY));

        const quad = (typeof EisenhowerUtils !== 'undefined' && EisenhowerUtils.getQuadrantFromCoords)
          ? EisenhowerUtils.getQuadrantFromCoords(pctX, pctY)
          : (pctX < 50 ? (pctY < 50 ? 'Q1' : 'Q3') : (pctY < 50 ? 'Q2' : 'Q4'));
        const pri = (typeof EisenhowerUtils !== 'undefined' && EisenhowerUtils.getPriorityForQuadrant)
          ? EisenhowerUtils.getPriorityForQuadrant(quad)
          : (quad === 'Q1' ? 'High' : quad === 'Q2' ? 'Medium' : 'Low');

        removeEisenhowerDraftDot();
        openNewTodoDialog({
          priority: pri,
          eisenhowerQuadrant: quad,
          eisenhowerX: Math.round(pctX * 10) / 10,
          eisenhowerY: Math.round(pctY * 10) / 10
        });

      } else {
        // First click on empty location: keep draft dot visible on canvas
        activeDot.classList.remove('dragging');
      }

      activeDot = null;
      activeTodoId = null;
      activeClusterId = null;
      activeIsClusterCenter = false;
      activeIsRadialDot = false;
      activeIsDraftDot = false;
      wasAlreadyDraftDot = false;
      clusterInitialTodos = [];
      isDragging = false;
      return;
    }

    if (dist > 4 && isDragging) {
      const rect = canvas.getBoundingClientRect();

      if (activeIsRadialDot) {
        // Radial dot dragged out of cluster — save individual position
        const finalPxX = Math.max(20, Math.min(rect.width - 20, dotInitialLeft + dx));
        const finalPxY = Math.max(20, Math.min(rect.height - 20, dotInitialTop + dy));
        const pctX = Math.max(minPct, Math.min(maxPct, (finalPxX / (rect.width || 1)) * 100));
        const pctY = Math.max(minPct, Math.min(maxPct, (finalPxY / (rect.height || 1)) * 100));

        const todo = (todosManifest || []).find(t => t.id === activeTodoId);
        if (todo) {
          todo.eisenhowerX = Math.round(pctX * 10) / 10;
          todo.eisenhowerY = Math.round(pctY * 10) / 10;
          const newQuad = (typeof EisenhowerUtils !== 'undefined')
            ? EisenhowerUtils.getQuadrantFromCoords(pctX, pctY)
            : (pctX < 50 ? (pctY < 50 ? 'Q1' : 'Q3') : (pctY < 50 ? 'Q2' : 'Q4'));
          todo.eisenhowerQuadrant = newQuad;
          todo.priority = (typeof EisenhowerUtils !== 'undefined')
            ? EisenhowerUtils.getPriorityForQuadrant(newQuad)
            : (newQuad === 'Q1' ? 'High' : newQuad === 'Q2' ? 'Medium' : 'Low');
          try {
            if (typeof StorageAPI !== 'undefined' && StorageAPI.writeTodosManifest) {
              await StorageAPI.writeTodosManifest(todosManifest);
            }
          } catch (err) {
            console.warn('Could not write todos manifest', err);
            if (typeof toast === 'function') toast(t('common.saveFailed', { message: err.message }), true);
          }
        }

      } else if (activeIsClusterCenter && clusterInitialTodos.length > 0) {
        // Cluster center drag — apply same delta to every member todo
        const finalPxX = Math.max(20, Math.min(rect.width - 20, dotInitialLeft + dx));
        const finalPxY = Math.max(20, Math.min(rect.height - 20, dotInitialTop + dy));
        const finalPctX = Math.max(minPct, Math.min(maxPct, (finalPxX / (rect.width || 1)) * 100));
        const finalPctY = Math.max(minPct, Math.min(maxPct, (finalPxY / (rect.height || 1)) * 100));
        const deltaPctX = finalPctX - origPctX;
        const deltaPctY = finalPctY - origPctY;

        for (const snap of clusterInitialTodos) {
          const newX = Math.max(minPct, Math.min(maxPct, snap.origX + deltaPctX));
          const newY = Math.max(minPct, Math.min(maxPct, snap.origY + deltaPctY));
          snap.todo.eisenhowerX = Math.round(newX * 10) / 10;
          snap.todo.eisenhowerY = Math.round(newY * 10) / 10;
          const newQuad = (typeof EisenhowerUtils !== 'undefined')
            ? EisenhowerUtils.getQuadrantFromCoords(newX, newY)
            : (newX < 50 ? (newY < 50 ? 'Q1' : 'Q3') : (newY < 50 ? 'Q2' : 'Q4'));
          snap.todo.eisenhowerQuadrant = newQuad;
          snap.todo.priority = (typeof EisenhowerUtils !== 'undefined')
            ? EisenhowerUtils.getPriorityForQuadrant(newQuad)
            : (newQuad === 'Q1' ? 'High' : newQuad === 'Q2' ? 'Medium' : 'Low');
        }
        try {
          if (typeof StorageAPI !== 'undefined' && StorageAPI.writeTodosManifest) {
            await StorageAPI.writeTodosManifest(todosManifest);
          }
        } catch (err) {
          console.warn('Could not write todos manifest', err);
          if (typeof toast === 'function') toast(t('common.saveFailed', { message: err.message }), true);
        }

      } else if (!activeIsClusterCenter) {
        // Solo dot drag (unchanged behaviour)
        activeDot.classList.remove('dragging');
        const dotRect = activeDot.getBoundingClientRect();
        const newPxX = dotRect.left - rect.left + dotRect.width / 2;
        const newPxY = dotRect.top - rect.top + dotRect.height / 2;
        const pctX = Math.max(minPct, Math.min(maxPct, (newPxX / (rect.width || 1)) * 100));
        const pctY = Math.max(minPct, Math.min(maxPct, (newPxY / (rect.height || 1)) * 100));

        const todo = (todosManifest || []).find(t => t.id === activeTodoId);
        if (todo) {
          todo.eisenhowerX = Math.round(pctX * 10) / 10;
          todo.eisenhowerY = Math.round(pctY * 10) / 10;
          const newQuad = (typeof EisenhowerUtils !== 'undefined')
            ? EisenhowerUtils.getQuadrantFromCoords(pctX, pctY)
            : (pctX < 50 ? (pctY < 50 ? 'Q1' : 'Q3') : (pctY < 50 ? 'Q2' : 'Q4'));
          todo.eisenhowerQuadrant = newQuad;
          todo.priority = (typeof EisenhowerUtils !== 'undefined')
            ? EisenhowerUtils.getPriorityForQuadrant(newQuad)
            : (newQuad === 'Q1' ? 'High' : newQuad === 'Q2' ? 'Medium' : 'Low');
          try {
            if (typeof StorageAPI !== 'undefined' && StorageAPI.writeTodosManifest) {
              await StorageAPI.writeTodosManifest(todosManifest);
            }
          } catch (err) {
            console.warn('Could not write todos manifest', err);
            if (typeof toast === 'function') toast(t('common.saveFailed', { message: err.message }), true);
          }
        }
      }

      renderTodosBoard();

      // After drag and drop, show hover again for the dropped task
      const droppedDot = document.querySelector(`.eisenhower-task-text[data-todo-id="${activeTodoId}"]`);
      if (droppedDot) {
        showEisenhowerQuickActionPopover(null, activeTodoId, droppedDot);
      }

    } else {
      // Clean click — no drag
      activeDot.classList.remove('dragging');
      if (activeIsRadialDot) {
        activeDot.style.opacity = '';
        activeDot.style.pointerEvents = '';
      }
    }

    activeDot = null;
    activeTodoId = null;
    activeClusterId = null;
    activeIsClusterCenter = false;
    activeIsRadialDot = false;
    activeIsDraftDot = false;
    wasAlreadyDraftDot = false;
    clusterInitialTodos = [];
    isDragging = false;
  }

  if (canvas._onPointerDown) {
    canvas.removeEventListener('pointerdown', canvas._onPointerDown);
  }
  canvas._onPointerDown = onPointerDown;
  canvas.addEventListener('pointerdown', onPointerDown);

  if (!_scatterplotInitialized) {
    window.addEventListener('blur', () => { cancelDragState(); closeEisenhowerQuickActionPopover(); removeEisenhowerDraftDot(); });
    window.addEventListener('scroll', () => { hideDotTooltip(0); closeEisenhowerQuickActionPopover(); }, { passive: true });
    window.addEventListener('resize', () => { hideDotTooltip(0); closeEisenhowerQuickActionPopover(); }, { passive: true });
    
    window.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        closeQuadrantDetailOverlay();
        closeEisenhowerQuickActionPopover();
        removeEisenhowerDraftDot();
      }
    });
    
    _scatterplotInitialized = true;
  }
}

// ═══ Eisenhower Quick Action Popover ═══
let _eisenhowerQuickPopover = null;
let _eisenhowerQuickPopoverHandlers = null;
let _quickPopoverHideTimer = null;
let _activePopoverTargetEl = null;
let _activePopoverTodoId = null;

function checkDirectionalHover(e) {
  if (!_eisenhowerQuickPopover || _eisenhowerQuickPopover.classList.contains('is-closing')) return;

  const mouseX = e.clientX;
  const mouseY = e.clientY;

  // 1. If mouse is directly over the popover itself, keep open
  if (_eisenhowerQuickPopover.contains(e.target)) {
    if (_quickPopoverHideTimer) {
      clearTimeout(_quickPopoverHideTimer);
      _quickPopoverHideTimer = null;
    }
    return;
  }

  // 2. If mouse is directly over the originating task dot, keep open
  const currentHoveredDot = e.target && e.target.closest ? e.target.closest('.eisenhower-task-text') : null;
  if (currentHoveredDot && _activePopoverTodoId && currentHoveredDot.getAttribute('data-todo-id') === String(_activePopoverTodoId)) {
    if (_quickPopoverHideTimer) {
      clearTimeout(_quickPopoverHideTimer);
      _quickPopoverHideTimer = null;
    }
    return;
  }

  // 3. If mouse entered a different task dot, handleScatterDotMouseEnter will handle switching immediately
  if (currentHoveredDot && _activePopoverTodoId && currentHoveredDot.getAttribute('data-todo-id') !== String(_activePopoverTodoId)) {
    return;
  }

  // 4. Check if mouse is in the space (bridge corridor) between the task and the popover
  const popRect = _eisenhowerQuickPopover.getBoundingClientRect();
  const taskRect = _activePopoverTargetEl ? _activePopoverTargetEl.getBoundingClientRect() : null;

  if (taskRect) {
    const pad = 18; // Generous corridor tolerance around the task and popover
    const unionMinX = Math.min(popRect.left, taskRect.left) - pad;
    const unionMaxX = Math.max(popRect.right, taskRect.right) + pad;
    const unionMinY = Math.min(popRect.top, taskRect.top) - pad;
    const unionMaxY = Math.max(popRect.bottom, taskRect.bottom) + pad;

    const inBridge = (mouseX >= unionMinX && mouseX <= unionMaxX && mouseY >= unionMinY && mouseY <= unionMaxY);
    if (inBridge) {
      if (_quickPopoverHideTimer) {
        clearTimeout(_quickPopoverHideTimer);
        _quickPopoverHideTimer = null;
      }
      return;
    }
  }

  // 5. Mouse has left the task, the hover, and the space between them -> close
  if (!_quickPopoverHideTimer) {
    _quickPopoverHideTimer = setTimeout(() => {
      closeEisenhowerQuickActionPopover();
    }, 80);
  }
}

function closeEisenhowerQuickActionPopover(immediate = false) {
  if (_quickPopoverHideTimer) {
    clearTimeout(_quickPopoverHideTimer);
    _quickPopoverHideTimer = null;
  }
  if (_eisenhowerQuickPopoverHandlers?.close) {
    document.removeEventListener('click', _eisenhowerQuickPopoverHandlers.close);
  }
  if (_eisenhowerQuickPopoverHandlers?.esc) {
    document.removeEventListener('keydown', _eisenhowerQuickPopoverHandlers.esc);
  }
  if (_eisenhowerQuickPopoverHandlers?.pointermove) {
    window.removeEventListener('pointermove', _eisenhowerQuickPopoverHandlers.pointermove);
  }
  _eisenhowerQuickPopoverHandlers = null;
  _activePopoverTargetEl = null;
  _activePopoverTodoId = null;

  const pop = _eisenhowerQuickPopover;
  _eisenhowerQuickPopover = null;

  if (pop) {
    if (immediate) {
      pop.remove();
    } else {
      pop.classList.add('is-closing');
      setTimeout(() => {
        pop.remove();
      }, 150);
    }
  }
}
window.closeEisenhowerQuickActionPopover = closeEisenhowerQuickActionPopover;

async function setTodoQuickStatus(todoId, newStatus) {
  const todo = getTodoById(todoId);
  if (!todo) return;

  const prevPriority = todo.priority;
  const prevStatus = todo.status || '';

  if (newStatus === 'wip') {
    todo.status = 'WIP';
    if (todo.priority === 'Done') {
      todo.priority = todo.originalPriority || (todo.eisenhowerQuadrant || 'Q2');
    }
  } else if (newStatus === 'done') {
    if (todo.priority !== 'Done') {
      todo.originalPriority = todo.priority;
    }
    todo.priority = 'Done';
    todo.status = '';
  } else if (newStatus === 'wont_do') {
    todo.status = 'wont_do';
    if (todo.priority === 'Done') {
      todo.priority = todo.originalPriority || (todo.eisenhowerQuadrant || 'Q2');
    }
  } else if (newStatus === 'pending') {
    todo.status = '';
    if (todo.priority === 'Done') {
      todo.priority = todo.originalPriority || (todo.eisenhowerQuadrant || 'Q2');
    }
  }

  todo.modified = new Date().toISOString().slice(0, 10);
  await updateTodoLinkedNote(todo, todo.title, todo.priority, todo.originalPriority || prevPriority, prevStatus);
  if (typeof saveTodosManifest === 'function') await saveTodosManifest();
  if (typeof StateBus !== 'undefined') StateBus.emit(`todo:update:${todo.id}`, { todo });

  renderTodosBoard();

  const statusLabel = newStatus === 'wip'
    ? (t('todo.quickStatusWip') || 'In Progress')
    : newStatus === 'done'
    ? (t('todo.quickStatusDone') || 'Done')
    : newStatus === 'wont_do'
    ? (t('todo.statusWontDo') || "Won't Do")
    : (t('todo.quickStatusPending') || 'Pending');

  if (newStatus === 'done') {
    closeEisenhowerQuickActionPopover(true);
    const undoFn = async () => {
      const tObj = getTodoById(todoId);
      if (!tObj) return;
      const restorePri = tObj.originalPriority || prevPriority || (tObj.eisenhowerQuadrant || 'Q2');
      tObj.priority = restorePri;
      tObj.status = prevStatus || '';
      tObj.modified = new Date().toISOString().slice(0, 10);
      await updateTodoLinkedNote(tObj, tObj.title, tObj.priority, tObj.originalPriority || '', 'Done');
      if (typeof saveTodosManifest === 'function') await saveTodosManifest();
      if (typeof StateBus !== 'undefined') StateBus.emit(`todo:update:${tObj.id}`, { todo: tObj });
      if (typeof refreshTodoViews === 'function') refreshTodoViews();
      else if (typeof renderTodosBoard === 'function') renderTodosBoard();
      const restoredDot = document.querySelector(`.eisenhower-task-text[data-todo-id="${todoId}"]`);
      if (restoredDot) showEisenhowerQuickActionPopover(null, todoId, restoredDot);
    };
    toastAction(t('common.todoMarkedDone') || 'Task marked as completed', t('common.undo') || 'Undo', undoFn, 10000);
  } else {
    const refreshedDot = document.querySelector(`.eisenhower-task-text[data-todo-id="${todoId}"]`);
    if (refreshedDot) {
      showEisenhowerQuickActionPopover(null, todoId, refreshedDot);
    } else {
      closeEisenhowerQuickActionPopover(true);
    }
    toast(t('todo.quickStatusUpdated', { status: statusLabel }) || `Status: ${statusLabel}`);
  }
}
window.setTodoQuickStatus = setTodoQuickStatus;

function positionEisenhowerQuickActionPopover(popover, targetEl, e = null) {
  if (!popover) return;
  const popRect = popover.getBoundingClientRect();
  const popWidth = popRect.width || 290;
  const popHeight = popRect.height || 180;

  const viewportWidth = window.innerWidth || 1024;
  const viewportHeight = window.innerHeight || 768;

  const pad = 12;
  const minX = pad;
  const maxX = Math.max(pad, viewportWidth - popWidth - pad);
  const minY = pad;
  const maxY = Math.max(pad, viewportHeight - popHeight - pad);

  if (!targetEl && e && (typeof e.clientX === 'number' || typeof e.pageX === 'number')) {
    const rawX = typeof e.clientX === 'number' ? e.clientX : e.pageX;
    const rawY = typeof e.clientY === 'number' ? e.clientY : e.pageY;
    let posX = rawX - popWidth / 2;
    let posY = rawY + 10;
    posX = Math.max(minX, Math.min(maxX, posX));
    posY = Math.max(minY, Math.min(maxY, posY));
    popover.style.left = `${Math.round(posX)}px`;
    popover.style.top = `${Math.round(posY)}px`;
    return;
  }

  if (!targetEl) {
    let posX = viewportWidth / 2 - popWidth / 2;
    let posY = viewportHeight / 2 - popHeight / 2;
    posX = Math.max(minX, Math.min(maxX, posX));
    posY = Math.max(minY, Math.min(maxY, posY));
    popover.style.left = `${Math.round(posX)}px`;
    popover.style.top = `${Math.round(posY)}px`;
    return;
  }

  const r = targetEl.getBoundingClientRect();
  const targetCenterX = r.left + r.width / 2;
  const targetCenterY = r.top + r.height / 2;

  // Sibling dots bounding boxes for collision checking (tie-breaker only)
  const siblingRects = [];
  const mapCanvas = document.getElementById('eisenhower-map-canvas');
  if (mapCanvas) {
    const dots = mapCanvas.querySelectorAll('.eisenhower-task-text');
    dots.forEach(d => {
      if (d !== targetEl && !targetEl.contains(d)) {
        siblingRects.push(d.getBoundingClientRect());
      }
    });
  }

  // Candidate placements:
  // Primary axis: Vertical (down preferred, up as primary flip when bottom overflows)
  // Secondary axis: Horizontal (right/left only as last resort when vertical space is completely constrained)
  const candidates = [
    {
      dir: 'down',
      x: targetCenterX - popWidth / 2,
      y: r.bottom + 8,
      penalty: 0
    },
    {
      dir: 'up',
      x: targetCenterX - popWidth / 2,
      y: r.top - popHeight - 8,
      penalty: 2
    },
    {
      dir: 'right',
      x: r.right + 8,
      y: targetCenterY - popHeight / 2,
      penalty: 200
    },
    {
      dir: 'left',
      x: r.left - popWidth - 8,
      y: targetCenterY - popHeight / 2,
      penalty: 220
    }
  ];

  let bestCandidate = null;
  let minScore = Infinity;

  candidates.forEach(cand => {
    let clampedX = Math.max(minX, Math.min(maxX, cand.x));
    let clampedY = Math.max(minY, Math.min(maxY, cand.y));

    // Viewport overflow penalty (heavily penalize positions that clip out of viewport)
    let overflowScore = 0;
    if (cand.x < minX) overflowScore += (minX - cand.x) * 4;
    if (cand.x > maxX) overflowScore += (cand.x - maxX) * 4;
    if (cand.y < minY) overflowScore += (minY - cand.y) * 4;
    if (cand.y > maxY) overflowScore += (cand.y - maxY) * 4;

    // Small sibling collision tie-breaker (never enough to trigger horizontal jump over vertical flip)
    const candScreenLeft = clampedX;
    const candScreenTop = clampedY;
    const candScreenRight = candScreenLeft + popWidth;
    const candScreenBottom = candScreenTop + popHeight;

    let collisionScore = 0;
    for (const sib of siblingRects) {
      const noOverlap = (
        candScreenRight <= sib.left ||
        candScreenLeft >= sib.right ||
        candScreenBottom <= sib.top ||
        candScreenTop >= sib.bottom
      );
      if (!noOverlap) {
        const overlapW = Math.min(candScreenRight, sib.right) - Math.max(candScreenLeft, sib.left);
        const overlapH = Math.min(candScreenBottom, sib.bottom) - Math.max(candScreenTop, sib.top);
        collisionScore += (overlapW * overlapH) / 1000;
      }
    }

    const totalScore = cand.penalty + overflowScore + collisionScore;
    if (totalScore < minScore) {
      minScore = totalScore;
      bestCandidate = { x: clampedX, y: clampedY, dir: cand.dir };
    }
  });

  const finalX = bestCandidate ? bestCandidate.x : Math.max(minX, Math.min(maxX, targetCenterX - popWidth / 2));
  const finalY = bestCandidate ? bestCandidate.y : Math.max(minY, Math.min(maxY, r.bottom + 8));

  popover.style.left = `${Math.round(finalX)}px`;
  popover.style.top = `${Math.round(finalY)}px`;
}
window.positionEisenhowerQuickActionPopover = positionEisenhowerQuickActionPopover;

function showScatterDotContextMenu(e, todoId) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  const dotEl = e ? (e.currentTarget || (e.target && e.target.closest ? e.target.closest('.eisenhower-task-text') : null)) : null;
  showEisenhowerQuickActionPopover(e, todoId, dotEl);
  return false;
}
window.showScatterDotContextMenu = showScatterDotContextMenu;

function showEisenhowerQuickActionPopover(e, todoId, targetEl) {
  if (e && e.preventDefault && e.type === 'contextmenu') e.preventDefault();
  if (e && e.stopPropagation) e.stopPropagation();

  if (_quickPopoverHideTimer) {
    clearTimeout(_quickPopoverHideTimer);
    _quickPopoverHideTimer = null;
  }

  closeEisenhowerQuickActionPopover(true);
  hideDotTooltip(0);

  const todo = getTodoById(todoId);
  if (!todo) return;

  const quad = getTodoQuadrant(todo);
  const meta = getQuadrantMeta(quad);
  const isDone = todo.priority === 'Done';
  const isWontDo = typeof isTodoWontDo === 'function' ? isTodoWontDo(todo) : (todo.status === 'wont_do');
  const isWip = isTodoWip(todo) && !isDone && !isWontDo;
  const isPending = !isDone && !isWip && !isWontDo;
  const isHighStar = Boolean(todo.isHighPriority);
  const cleanTitle = getCleanTaskTitle(todo);
  const ownerLabel = typeof getTodoOwnerLabel === 'function' ? getTodoOwnerLabel(todo) : null;
  const dueInfo = typeof getTodoDueDateInfo === 'function' ? getTodoDueDateInfo(todo) : null;
  const wsName = todo.workstream || (Array.isArray(todo.major_topic_tags) && todo.major_topic_tags[0]) || '';
  const blockers = typeof TaskGraphEngine !== 'undefined' ? TaskGraphEngine.getUnresolvedBlockers(todo.id) : [];
  const dependents = typeof TaskGraphEngine !== 'undefined' ? TaskGraphEngine.getDependents(todo.id) : [];
  const badgeTextColor = (quad === 'Q2' || meta.color === '#f59e0b') ? '#0f172a' : '#ffffff';

  const popover = document.createElement('div');
  popover.className = 'eisenhower-quick-popover';
  popover.setAttribute('data-todo-id', todoId);

  // Prevent popover clicks and presses from closing the popover
  popover.onpointerdown = (ev) => ev.stopPropagation();
  popover.onmousedown = (ev) => ev.stopPropagation();
  popover.onclick = (ev) => ev.stopPropagation();

  popover.innerHTML = `
    <div class="eq-popover-header">
      <span class="sl-badge" style="background:${meta.color};color:${badgeTextColor};font-weight:800;padding:3px 8px;border-radius:4px;font-size:0.75rem;">${escH(quad)} · ${escH(meta.shortLabel)}</span>
      <div class="eq-header-actions">
        <button type="button" class="eq-header-btn${isHighStar ? ' is-starred' : ''}" id="eq-star-btn" title="${escA(t('todo.starPriority') || 'Toggle Star Priority')}">
          ${isHighStar ? '⭐' : '☆'}
        </button>
        <button type="button" class="eq-header-btn" id="eq-close-btn" title="${escA(t('todo.closeOverlay') || 'Close')}">✕</button>
      </div>
    </div>
    <div class="eq-popover-title">${escH(cleanTitle)}</div>
    ${(ownerLabel || dueInfo || wsName) ? `
      <div class="eq-popover-meta">
        ${wsName ? `<span class="todo-badge-workstream" title="${escA((t('todo.workstreamLabel') || 'Workstream') + ': ' + wsName)}">${(typeof AppIcons !== 'undefined' && AppIcons.get) ? AppIcons.get('workstream', { size: 11 }) : ''} <span>${escH(wsName)}</span></span>` : ''}
        ${ownerLabel ? `<span>👤 ${escH(ownerLabel)}</span>` : ''}
        ${dueInfo ? `<span>📅 ${escH(dueInfo.date)}</span>` : ''}
      </div>
    ` : ''}
    ${blockers.length > 0 ? `
      <div class="eq-popover-blockers">
        🔒 <strong>${escH(t('todo.blockedBy') || 'Blocked by')}:</strong> ${escH(blockers.map(b => getCleanTaskTitle(b)).join(', '))}
      </div>
    ` : ''}
    ${dependents.length > 0 ? `
      <div class="eq-popover-dependents">
        🔗 <strong>${escH(t('todo.blocks') || 'Blocks')}:</strong> ${escH(dependents.map(d => getCleanTaskTitle(d)).join(', '))}
      </div>
    ` : ''}
    <div class="eq-status-strip">
      <button type="button" class="eq-status-btn status-pending${isPending ? ' active' : ''}" id="eq-status-pending" title="${escA(t('todo.quickStatusPendingTooltip') || 'Set task status to Pending (To Do)')}">
        📋 ${escH(t('todo.quickStatusPending') || 'Pending')}
      </button>
      <button type="button" class="eq-status-btn status-wip${isWip ? ' active' : ''}" id="eq-status-wip" title="${escA(t('todo.quickStatusWipTooltip') || 'Set task status to Work in Progress (WIP)')}">
        ⏳ ${escH(t('todo.quickStatusWip') || 'In Progress')}
      </button>
      <button type="button" class="eq-status-btn status-done${isDone ? ' active' : ''}" id="eq-status-done" title="${escA(t('todo.quickStatusDoneTooltip') || 'Mark this task as completed')}">
        ✅ ${escH(t('todo.quickStatusDone') || 'Done')}
      </button>
      <button type="button" class="eq-status-btn status-wontdo${isWontDo ? ' active' : ''}" id="eq-status-wontdo" title="${escA(t('todo.quickStatusWontDoTooltip') || "Set task status to Won't Do")}">
        🚫 ${escH(t('todo.statusWontDo') || "Won't Do")}
      </button>
    </div>
    <div class="eq-popover-actions">
      <button type="button" class="eq-action-btn-main" id="eq-edit-btn" title="${escA(t('todo.editTodoTooltip') || 'Open full modal to edit task details')}">
        ✏️ ${escH(t('todo.editTodo') || 'Edit Todo')}
      </button>
      <button type="button" class="eq-action-icon-btn" id="eq-sched-btn" title="${escA(t('todo.scheduleWorkSession') || 'Schedule Work Session')}">
        📅
      </button>
      <button type="button" class="eq-action-icon-btn btn-danger" id="eq-del-btn" title="${escA(t('todo.deleteTooltip') || 'Delete')}">
        🗑️
      </button>
    </div>
  `;

  document.body.appendChild(popover);
  _eisenhowerQuickPopover = popover;

  // Hover persistence: keep open when mouse enters popover
  popover.addEventListener('mouseenter', () => {
    if (_quickPopoverHideTimer) {
      clearTimeout(_quickPopoverHideTimer);
      _quickPopoverHideTimer = null;
    }
  });

  popover.addEventListener('mouseleave', () => {
    if (!_quickPopoverHideTimer) {
      _quickPopoverHideTimer = setTimeout(() => {
        closeEisenhowerQuickActionPopover();
      }, 100);
    }
  });

  // Target element resolution
  if (!targetEl) {
    targetEl = (e && e.target && e.target.closest) ? e.target.closest('.eisenhower-task-text') : null;
  }
  if (!targetEl) {
    targetEl = document.querySelector(`.eisenhower-task-text[data-todo-id="${todoId}"]`);
  }

  positionEisenhowerQuickActionPopover(popover, targetEl, e);

  // Attach button events
  popover.querySelector('#eq-close-btn')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    closeEisenhowerQuickActionPopover();
  });

  popover.querySelector('#eq-star-btn')?.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    await toggleTodoHighPriority(todoId);
    const refreshedDot = document.querySelector(`.eisenhower-task-text[data-todo-id="${todoId}"]`);
    showEisenhowerQuickActionPopover(null, todoId, refreshedDot);
  });

  popover.querySelector('#eq-status-pending')?.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    await setTodoQuickStatus(todoId, 'pending');
  });

  popover.querySelector('#eq-status-wip')?.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    await setTodoQuickStatus(todoId, 'wip');
  });

  popover.querySelector('#eq-status-done')?.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    await setTodoQuickStatus(todoId, 'done');
  });

  popover.querySelector('#eq-status-wontdo')?.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    await setTodoQuickStatus(todoId, 'wont_do');
  });

  popover.querySelector('#eq-edit-btn')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    closeEisenhowerQuickActionPopover(true);
    openTodoOverlay(todoId);
  });

  popover.querySelector('#eq-sched-btn')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    closeEisenhowerQuickActionPopover(true);
    const cleanTitle = typeof getCleanTaskTitle === 'function' ? getCleanTaskTitle(todo) : (todo.title || todoId);
    if (typeof quickScheduleTodo === 'function') quickScheduleTodo(todoId, cleanTitle);
    else if (typeof openPlanEventModal === 'function') openPlanEventModal({ type: 'todo', title: cleanTitle, todoId });
  });

  popover.querySelector('#eq-del-btn')?.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    closeEisenhowerQuickActionPopover(true);
    await deleteTodoById(todoId);
  });

  // Clicking outside or pressing escape closes it
  const closeOnOutsideClick = (ev) => {
    if (_eisenhowerQuickPopover && !_eisenhowerQuickPopover.contains(ev.target)) {
      if (_activePopoverTargetEl && _activePopoverTargetEl.contains(ev.target)) return;
      closeEisenhowerQuickActionPopover();
    }
  };
  const closeOnEsc = (ev) => {
    if (ev.key === 'Escape') {
      closeEisenhowerQuickActionPopover();
    }
  };

  _activePopoverTargetEl = targetEl;
  _activePopoverTodoId = todoId;

  window.addEventListener('pointermove', checkDirectionalHover, { passive: true });
  _eisenhowerQuickPopoverHandlers = { 
    close: closeOnOutsideClick, 
    esc: closeOnEsc,
    pointermove: checkDirectionalHover
  };

  setTimeout(() => {
    if (_eisenhowerQuickPopover === popover) {
      document.addEventListener('click', closeOnOutsideClick);
    }
  }, 0);
  document.addEventListener('keydown', closeOnEsc);
}
window.showEisenhowerQuickActionPopover = showEisenhowerQuickActionPopover;

// ═══ Non-Blocking Top-Attached Tooltips ═══
let _tooltipHideTimer = null;

function positionDotTooltipAboveTarget(dotEl) {
  const tooltip = document.getElementById('eisenhower-dot-tooltip');
  if (!tooltip || !dotEl) return;

  const dotRect = dotEl.getBoundingClientRect();
  const ttWidth = tooltip.offsetWidth || 260;
  const ttHeight = tooltip.offsetHeight || 90;

  // Position directly above the task element
  let left = dotRect.left + dotRect.width / 2 - ttWidth / 2;
  let top = dotRect.top - ttHeight - 10;

  let isFlipped = false;
  if (top < 12) {
    top = dotRect.bottom + 10;
    isFlipped = true;
  }
  if (top + ttHeight > window.innerHeight - 12) {
    top = Math.max(12, window.innerHeight - ttHeight - 12);
  }
  if (left < 12) left = 12;
  if (left + ttWidth > window.innerWidth - 12) left = Math.max(12, window.innerWidth - ttWidth - 12);

  tooltip.style.left = `${Math.round(left)}px`;
  tooltip.style.top = `${Math.round(top)}px`;

  if (isFlipped) tooltip.classList.add('tooltip-south');
  else tooltip.classList.remove('tooltip-south');
}

function toggleEisenhowerCriticalPath() {
  showEisenhowerCriticalPath = !showEisenhowerCriticalPath;
  renderTodosBoard();
}
window.toggleEisenhowerCriticalPath = toggleEisenhowerCriticalPath;

function handleScatterDotMouseEnter(e, todoId) {
  if (isDragging) return;
  if (_quickPopoverHideTimer) {
    clearTimeout(_quickPopoverHideTimer);
    _quickPopoverHideTimer = null;
  }

  const dotEl = e ? (e.currentTarget || (e.target && e.target.closest ? e.target.closest('.eisenhower-task-text') : null)) : null;

  if (!_eisenhowerQuickPopover || _eisenhowerQuickPopover.getAttribute('data-todo-id') !== String(todoId)) {
    showEisenhowerQuickActionPopover(e, todoId, dotEl);
  }

  const canvas = document.getElementById('eisenhower-map-canvas');
  if (!canvas || !todoId || typeof TaskGraphEngine === 'undefined') return;

  const prereqIds = new Set(TaskGraphEngine.getPrerequisites(todoId).map(t => String(t.id)));
  const depIds = new Set(TaskGraphEngine.getDependents(todoId).map(t => String(t.id)));

  if (prereqIds.size === 0 && depIds.size === 0) return;

  canvas.classList.add('has-dependency-hover');

  canvas.querySelectorAll('.eisenhower-task-text').forEach(dot => {
    const id = dot.getAttribute('data-todo-id');
    if (!id) return;
    if (id === String(todoId)) {
      dot.classList.add('is-hover-focus');
    } else if (prereqIds.has(id)) {
      dot.classList.add('is-upstream-blocker');
    } else if (depIds.has(id)) {
      dot.classList.add('is-downstream-dependent');
    }
  });

  canvas.querySelectorAll('.eis-dep-vector').forEach(vec => {
    const fromId = vec.getAttribute('data-from-id');
    const toId = vec.getAttribute('data-to-id');
    if (fromId === String(todoId) || toId === String(todoId)) {
      vec.classList.add('is-highlighted-vector');
    }
  });
}
window.handleScatterDotMouseEnter = handleScatterDotMouseEnter;

function handleScatterDotMouseLeave(e, todoId) {
  if (_eisenhowerQuickPopover && _activePopoverTodoId === String(todoId)) {
    if (!_quickPopoverHideTimer) {
      _quickPopoverHideTimer = setTimeout(() => {
        closeEisenhowerQuickActionPopover();
      }, 120);
    }
  }

  const canvas = document.getElementById('eisenhower-map-canvas');
  if (!canvas) return;
  canvas.classList.remove('has-dependency-hover');
  canvas.querySelectorAll('.eisenhower-task-text').forEach(dot => {
    dot.classList.remove('is-hover-focus', 'is-upstream-blocker', 'is-downstream-dependent');
  });
  canvas.querySelectorAll('.eis-dep-vector').forEach(vec => {
    vec.classList.remove('is-highlighted-vector');
  });
}
window.handleScatterDotMouseLeave = handleScatterDotMouseLeave;

function showDotTooltip(e, todoId) {
  const dotEl = e ? (e.currentTarget || (e.target && e.target.closest ? e.target.closest('.eisenhower-task-text') : null)) : null;
  showEisenhowerQuickActionPopover(e, todoId, dotEl);
}
window.showDotTooltip = showDotTooltip;

function showClusterTooltip(e, count, primaryQuad, shortLabel) {
  // Overlapping cluster dot hover suppressed per requirement
}
window.showClusterTooltip = showClusterTooltip;

function hideDotTooltip(delay = 80) {
  if (delay > 0) {
    if (_tooltipHideTimer) clearTimeout(_tooltipHideTimer);
    _tooltipHideTimer = setTimeout(() => {
      const tooltip = document.getElementById('eisenhower-dot-tooltip');
      if (tooltip) {
        tooltip.classList.remove('visible');
        tooltip.style.display = 'none';
      }
    }, delay);
  } else {
    if (_tooltipHideTimer) {
      clearTimeout(_tooltipHideTimer);
      _tooltipHideTimer = null;
    }
    const tooltip = document.getElementById('eisenhower-dot-tooltip');
    if (tooltip) {
      tooltip.classList.remove('visible');
      tooltip.style.display = 'none';
    }
  }
}

const _clusterTimeouts = new Map();

function handleClusterMouseEnter(groupEl, clusterId) {
  if (_clusterTimeouts.has(clusterId)) {
    clearTimeout(_clusterTimeouts.get(clusterId));
    _clusterTimeouts.delete(clusterId);
  }
  if (groupEl) groupEl.classList.add('is-expanded');
}

function handleClusterMouseLeave(groupEl, clusterId) {
  if (_clusterTimeouts.has(clusterId)) {
    clearTimeout(_clusterTimeouts.get(clusterId));
  }
  const timer = setTimeout(() => {
    if (groupEl && !groupEl.classList.contains('is-pinned')) {
      groupEl.classList.remove('is-expanded');
    }
    _clusterTimeouts.delete(clusterId);
  }, 220);
  _clusterTimeouts.set(clusterId, timer);
}

function handleClusterClick(event, clusterId) {
  if (event) event.stopPropagation();
  const group = document.getElementById(`cluster-group-${clusterId}`);
  if (!group) return;
  const isPinned = group.classList.toggle('is-pinned');
  if (isPinned) {
    group.classList.add('is-expanded');
  } else {
    group.classList.remove('is-expanded');
  }
}

function expandRadialCluster(clusterId) {
  const group = document.getElementById(`cluster-group-${clusterId}`);
  if (group) group.classList.add('is-expanded');
}

function collapseRadialCluster(clusterId) {
  const group = document.getElementById(`cluster-group-${clusterId}`);
  if (group) {
    group.classList.remove('is-expanded');
    group.classList.remove('is-pinned');
  }
}

function toggleRadialCluster(clusterId) {
  handleClusterClick(null, clusterId);
}

window.handleClusterMouseEnter = handleClusterMouseEnter;
window.handleClusterMouseLeave = handleClusterMouseLeave;
window.handleClusterClick = handleClusterClick;
window.expandRadialCluster = expandRadialCluster;
window.collapseRadialCluster = collapseRadialCluster;
window.toggleRadialCluster = toggleRadialCluster;

document.addEventListener('click', (e) => {
  if (!e.target.closest('.eisenhower-cluster-group')) {
    document.querySelectorAll('.eisenhower-cluster-group.is-pinned, .eisenhower-cluster-group.is-expanded').forEach(group => {
      group.classList.remove('is-pinned', 'is-expanded');
    });
  }
});

function openQuadrantDetailOverlay(qKey) {
  hideDotTooltip(0);
  const meta = getQuadrantMeta(qKey);

  let items = (todosManifest || []).filter(t => t && t.priority !== 'Done' && isUserTask(t) && getTodoQuadrant(t) === qKey);

  if (!showDelegatedTodos) {
    items = items.filter(t => !isTodoDelegated(t));
  }

  if (eisenhowerWorkstreamFilter) {
    items = items.filter(t => {
      const ws = (t.workstream || (Array.isArray(t.major_topic_tags) && t.major_topic_tags[0]) || '').trim();
      if (eisenhowerWorkstreamFilter === 'Other' || eisenhowerWorkstreamFilter === 'Autre') {
        return !ws || ['other', 'autre'].includes(ws.toLowerCase());
      }
      return ws.toLowerCase() === eisenhowerWorkstreamFilter.toLowerCase();
    });
  }

  items.sort((a, b) => {
    const ya = typeof a.eisenhowerY === 'number' ? a.eisenhowerY : 50;
    const yb = typeof b.eisenhowerY === 'number' ? b.eisenhowerY : 50;
    if (ya !== yb) return ya - yb;
    const xa = typeof a.eisenhowerX === 'number' ? a.eisenhowerX : 50;
    const xb = typeof b.eisenhowerX === 'number' ? b.eisenhowerX : 50;
    return xa - xb;
  });

  let overlay = document.getElementById('eisenhower-quadrant-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'eisenhower-quadrant-overlay';
    overlay.className = 'eisenhower-quadrant-overlay-backdrop';
    document.body.appendChild(overlay);
  }

  overlay.setAttribute('data-user-opened', 'true');

  let accRank = 1;
  const cardsHtml = items.map(todo => renderTodoCard(todo, accRank++)).join('');
  const tasksLabel = t('todo.tasks') || 'tâches';

  overlay.innerHTML = `
    <div class="overlay-panel eisenhower-quadrant-panel" onclick="event.stopPropagation()">
      <div class="overlay-header eisenhower-quadrant-header" style="border-left: 6px solid ${meta.color}">
        <div class="overlay-title-group" style="display:flex; align-items:center; gap:10px;">
          <span class="sl-badge" style="background:${meta.color}; color:#ffffff; font-weight:800; font-size:0.82rem; padding:4px 10px; border-radius:6px;">${escH(qKey)}</span>
          <h2 style="margin:0; font-size:1.2rem; font-weight:700; color:var(--text);">${escH(meta.actionTitle)}</h2>
          <span class="sl-lane-count" style="font-size:0.9rem; color:var(--text-muted); font-weight:600;">(${items.length} ${escH(tasksLabel)})</span>
        </div>
        <div class="overlay-actions" style="display:flex; align-items:center; gap:10px;">
          <button class="btn btn-sm btn-accent" onclick="closeQuadrantDetailOverlay();showNewTodoInQuadrant(${jq(qKey)})" title="${escA(t('todo.newTodoTooltip') || 'Create a new task')}">+ ${escH(t('todo.newShort') || 'Nouvelle tâche')}</button>
          <button class="overlay-close-btn" onclick="closeQuadrantDetailOverlay()" title="${escA(t('todo.closeOverlay') || 'Fermer')}" aria-label="Close">✕</button>
        </div>
      </div>
      <div class="overlay-body eisenhower-quadrant-body" id="eisenhower-quadrant-modal-body">
        ${cardsHtml || `
          <div class="eisenhower-overlay-empty">
            <div style="font-size:1rem;font-weight:600;margin-bottom:0.6rem;">${escH(t('todo.empty') || 'Aucune tâche dans ce quadrant')}</div>
            <button class="btn btn-sm btn-accent" onclick="closeQuadrantDetailOverlay();showNewTodoInQuadrant(${jq(qKey)})" title="${escA(t('todo.newTodoTooltip') || 'Create a new task')}">+ ${escH(t('todo.addFirstTask') || 'Ajouter une tâche')}</button>
          </div>`}
      </div>
    </div>`;

  overlay.onclick = (e) => {
    if (e.target === overlay && !_quadrantOverlayPanelMouseDown) closeQuadrantDetailOverlay();
    _quadrantOverlayPanelMouseDown = false;
  };

  const bodyEl = document.getElementById('eisenhower-quadrant-modal-body');
  if (bodyEl) bodyEl.scrollTop = 0;

  overlay.style.display = 'flex';
  overlay.classList.add('visible');
}

function closeQuadrantDetailOverlay() {
  const overlay = document.getElementById('eisenhower-quadrant-overlay');
  if (overlay) {
    overlay.removeAttribute('data-user-opened');
    overlay.classList.remove('visible');
    overlay.style.display = 'none';
  }
}

window.showDotTooltip = showDotTooltip;
window.hideDotTooltip = hideDotTooltip;
window.openQuadrantDetailOverlay = openQuadrantDetailOverlay;
window.closeQuadrantDetailOverlay = closeQuadrantDetailOverlay;
window.handleScatterDotKeyDown = handleScatterDotKeyDown;

window.EisenhowerBoard = {
  render: renderTodosBoard,
  setMode: setEisenhowerViewMode,
  toggleColumn: toggleMatrixColumn,
  toggleRow: toggleMatrixRow,
  openDetail: openQuadrantDetailOverlay,
  closeDetail: closeQuadrantDetailOverlay
};

// ═══ Todos In-Task Checklist Engine ═══
const TodoChecklistEngine = {
  getProgress(todo) {
    const list = Array.isArray(todo?.checklist) ? todo.checklist : [];
    const total = list.length;
    if (total === 0) return { total: 0, completed: 0, percentage: 0, text: '0/0' };
    const completed = list.filter(item => Boolean(item.done)).length;
    const percentage = (completed / total) * 100;
    return {
      total,
      completed,
      percentage,
      text: `${completed}/${total}`
    };
  },

  addItem(todoId, text) {
    if (!text || !text.trim()) return null;
    const manifest = globalThis.todosManifest || (typeof todosManifest !== 'undefined' ? todosManifest : []);
    const todo = manifest.find(t => String(t.id) === String(todoId));
    if (!todo) return null;
    if (!Array.isArray(todo.checklist)) todo.checklist = [];
    const newItem = {
      id: 'chk-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      text: text.trim(),
      done: false
    };
    todo.checklist.push(newItem);
    if (typeof saveTodosManifest === 'function') saveTodosManifest();
    return newItem;
  },

  toggleItem(todoId, itemId, done) {
    const manifest = globalThis.todosManifest || (typeof todosManifest !== 'undefined' ? todosManifest : []);
    const todo = manifest.find(t => String(t.id) === String(todoId));
    if (!todo || !Array.isArray(todo.checklist)) return false;
    const item = todo.checklist.find(i => String(i.id) === String(itemId));
    if (!item) return false;
    item.done = done !== undefined ? Boolean(done) : !item.done;
    if (typeof saveTodosManifest === 'function') saveTodosManifest();
    return true;
  },

  removeItem(todoId, itemId) {
    const manifest = globalThis.todosManifest || (typeof todosManifest !== 'undefined' ? todosManifest : []);
    const todo = manifest.find(t => String(t.id) === String(todoId));
    if (!todo || !Array.isArray(todo.checklist)) return false;
    const idx = todo.checklist.findIndex(i => String(i.id) === String(itemId));
    if (idx === -1) return false;
    todo.checklist.splice(idx, 1);
    if (typeof saveTodosManifest === 'function') saveTodosManifest();
    return true;
  }
};
window.TodoChecklistEngine = TodoChecklistEngine;

// ═══ Recurring Tasks Engine ═══
const TodoRecurrenceEngine = {
  calculateNextDueDate(baseDateStr, freq, interval = 1) {
    const base = baseDateStr ? new Date(baseDateStr) : new Date();
    if (isNaN(base.getTime())) return new Date().toISOString().slice(0, 10);

    const next = new Date(base.getTime());
    const intv = Math.max(1, parseInt(interval, 10) || 1);

    if (freq === 'daily') {
      next.setDate(next.getDate() + intv);
    } else if (freq === 'weekly') {
      next.setDate(next.getDate() + (7 * intv));
    } else if (freq === 'biweekly') {
      next.setDate(next.getDate() + (14 * intv));
    } else if (freq === 'monthly') {
      next.setMonth(next.getMonth() + intv);
    } else {
      next.setDate(next.getDate() + (7 * intv));
    }

    return next.toISOString().slice(0, 10);
  },

  completeAndSpawnNext(todoId) {
    const manifest = globalThis.todosManifest || (typeof todosManifest !== 'undefined' ? todosManifest : []);
    const todo = manifest.find(t => String(t.id) === String(todoId));
    if (!todo) return null;

    todo.status = 'Done';

    if (!todo.recurrence || !todo.recurrence.enabled) {
      if (typeof saveTodosManifest === 'function') saveTodosManifest();
      return null;
    }

    const rec = todo.recurrence;
    const nextDueDate = this.calculateNextDueDate(todo.dueDate, rec.freq, rec.interval);

    const clonedChecklist = Array.isArray(todo.checklist)
      ? todo.checklist.map(c => ({ ...c, id: 'chk-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), done: false }))
      : [];

    const newTodoId = 'todo-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    const spawnedTodo = {
      ...todo,
      id: newTodoId,
      status: 'To Do',
      dueDate: nextDueDate,
      checklist: clonedChecklist,
      created_at: new Date().toISOString(),
      recurrence: { ...rec }
    };

    manifest.push(spawnedTodo);
    if (typeof saveTodosManifest === 'function') saveTodosManifest();
    return spawnedTodo;
  }
};
window.TodoRecurrenceEngine = TodoRecurrenceEngine;

// ═══ Todos Filter & Search Engine ═══
const TodoFilterEngine = {
  currentFilter: {
    query: '',
    assignee: 'all',
    priority: 'all',
    status: 'all',
    workstream: 'all'
  },

  filterList(list, criteria = {}) {
    if (!Array.isArray(list)) return [];
    const q = (criteria.query !== undefined ? criteria.query : this.currentFilter.query || '').trim().toLowerCase();
    const assignee = criteria.assignee !== undefined ? criteria.assignee : this.currentFilter.assignee;
    const priority = criteria.priority !== undefined ? criteria.priority : this.currentFilter.priority;
    const status = criteria.status !== undefined ? criteria.status : this.currentFilter.status;
    const workstream = criteria.workstream !== undefined ? criteria.workstream : this.currentFilter.workstream;

    return list.filter(item => {
      if (!item) return false;

      if (q) {
        const title = (item.title || '').toLowerCase();
        const owner = (item.owner || '').toLowerCase();
        const ws = (item.workstream || '').toLowerCase();
        const tags = Array.isArray(item.tags) ? item.tags.join(' ').toLowerCase() : '';
        const chkText = Array.isArray(item.checklist) ? item.checklist.map(c => c.text).join(' ').toLowerCase() : '';
        const match = title.includes(q) || owner.includes(q) || ws.includes(q) || tags.includes(q) || chkText.includes(q);
        if (!match) return false;
      }

      if (assignee && assignee !== 'all') {
        const itemOwner = item.owner || '';
        if (assignee === 'me') {
          const username = (typeof currentUsername !== 'undefined' && currentUsername) ? currentUsername : 'me';
          if (itemOwner.toLowerCase() !== username.toLowerCase() && itemOwner.toLowerCase() !== 'me') return false;
        } else if (itemOwner.toLowerCase() !== assignee.toLowerCase()) {
          return false;
        }
      }

      if (priority && priority !== 'all') {
        if (item.priority !== priority && item.eisenhowerQuadrant !== priority) return false;
      }

      if (status && status !== 'all') {
        const itemStatus = (item.status || '').toLowerCase();
        const normFilterStatus = String(status).toLowerCase();
        if (normFilterStatus === 'wont_do' || normFilterStatus === "won't do" || normFilterStatus === 'wontdo') {
          if (typeof isTodoWontDo === 'function') {
            if (!isTodoWontDo(item)) return false;
          } else if (item.status !== 'wont_do') {
            return false;
          }
        } else if (normFilterStatus === 'wip') {
          if (typeof isTodoWip === 'function') {
            if (!isTodoWip(item)) return false;
          } else if (item.status !== 'WIP') {
            return false;
          }
        } else if (normFilterStatus === 'done') {
          if (item.priority !== 'Done' && itemStatus !== 'done') return false;
        } else if (normFilterStatus === 'pending') {
          const isDoneItem = item.priority === 'Done';
          const isWipItem = typeof isTodoWip === 'function' ? isTodoWip(item) : item.status === 'WIP';
          const isWontDoItem = typeof isTodoWontDo === 'function' ? isTodoWontDo(item) : item.status === 'wont_do';
          if (isDoneItem || isWipItem || isWontDoItem) return false;
        } else if (item.status !== status) {
          return false;
        }
      }

      if (workstream && workstream !== 'all') {
        if (item.workstream !== workstream) return false;
      }

      return true;
    });
  }
};
window.TodoFilterEngine = TodoFilterEngine;

function onTodosSearchInput(val) {
  if (typeof TodoFilterEngine !== 'undefined') {
    TodoFilterEngine.currentFilter.query = val;
  }
  renderTodosBoard();
  const inp = document.getElementById('todos-board-search');
  if (inp) {
    inp.focus();
    inp.setSelectionRange(inp.value.length, inp.value.length);
  }
}
window.onTodosSearchInput = onTodosSearchInput;

