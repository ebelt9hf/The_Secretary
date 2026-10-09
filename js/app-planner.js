'use strict';

// ── Secretary: Planner Mode ──

// ── Clipboard & Clone State ──
let _plannerClipboard = null;   // copied event object
let _plannerCloneState = null;  // { event, ghostEl } for clone-drag
let _customRecurrenceDates = [];
let _plannerCurrentTimeRefreshTimer = null;
let _plannerCurrentTimeRefreshKickoff = null;

// ── 150 Points Usability & Search State ──
let _plannerSideSearchQuery = '';
let _plannerSidePriorityFilter = 'All';
let _plannerHudVisible = false;

// ── Planner Usability State & Helper Stack ──
let _plannerUndoStack = [];
let _plannerRedoStack = [];
let _plannerCategoryFilters = new Set();
let _plannerQuietHoursCollapsed = true;
let _plannerSelectedEventIds = new Set();
// ── External Agent Planner Proposals State ──
let plannerProposals = [];
let showPlannerProposals = false;
let _lastProposalsJSON = '';

function togglePlannerHudOverlay() {
  _plannerHudVisible = !_plannerHudVisible;
  let hud = document.getElementById('planner-hud-bar');
  if (hud) hud.remove();
  if (_plannerHudVisible) {
    hud = document.createElement('div');
    hud.id = 'planner-hud-bar';
    hud.className = 'planner-hud-overlay';
    hud.innerHTML = `
      <div class="planner-hud-item"><span class="planner-hud-key">Cmd+D</span> Duplicate</div>
      <div class="planner-hud-item"><span class="planner-hud-key">Cmd+↑/↓</span> Nudge 15m</div>
      <div class="planner-hud-item"><span class="planner-hud-key">Cmd+←/→</span> Shift Day</div>
      <div class="planner-hud-item"><span class="planner-hud-key">Cmd+Z</span> Undo</div>
      <div class="planner-hud-item"><span class="planner-hud-key">Del</span> Delete</div>
      <div class="planner-hud-item"><span class="planner-hud-key">T</span> Today</div>
    `;
    document.body.appendChild(hud);
    setTimeout(() => { if (hud) { hud.remove(); _plannerHudVisible = false; } }, 4500);
  }
}

// ═══ Smart Planner Timeline Collision Detector & Auto-Balancing Engine ═══
const PlannerScheduler = {
  detectCollisions(dateStr, eventsList = plannerEvents) {
    if (!dateStr || !Array.isArray(eventsList)) return new Map();
    const dayEvents = eventsList.filter(e => e && e.date === dateStr && !e.allDay && e.startTime && e.endTime);
    const intervals = dayEvents.map(e => ({
      event: e,
      start: timeToMinutes(e.startTime),
      end: timeToMinutes(e.endTime)
    })).filter(it => it.start !== null && it.end !== null && it.end > it.start);

    const collisionMap = new Map();

    for (let i = 0; i < intervals.length; i++) {
      for (let j = i + 1; j < intervals.length; j++) {
        const a = intervals[i];
        const b = intervals[j];
        if (Math.max(a.start, b.start) < Math.min(a.end, b.end)) {
          if (!collisionMap.has(a.event.id)) collisionMap.set(a.event.id, []);
          if (!collisionMap.has(b.event.id)) collisionMap.set(b.event.id, []);
          collisionMap.get(a.event.id).push(b.event);
          collisionMap.get(b.event.id).push(a.event);
        }
      }
    }
    return collisionMap;
  },

  findAvailableGaps(dateStr, workStart = (typeof workStartTime !== 'undefined' ? workStartTime : '09:00'), workEnd = (typeof workEndTime !== 'undefined' ? workEndTime : '18:30'), eventsList = plannerEvents, options = {}) {
    if (!dateStr) return [];
    const futureOnly = options?.futureOnly !== false;
    const now = options?.now || new Date();
    const todayStr = typeof formatLocalDateValue === 'function'
      ? formatLocalDateValue(now)
      : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    if (futureOnly && dateStr < todayStr) {
      return [];
    }

    const startMins = timeToMinutes(workStart) || 540;
    const endMins = timeToMinutes(workEnd) || 1110;
    if (endMins <= startMins) return [];

    let effectiveStartMins = startMins;
    if (futureOnly && dateStr === todayStr) {
      const nowMins = now.getHours() * 60 + now.getMinutes();
      const nextSlotMins = Math.ceil(nowMins / 15) * 15;
      effectiveStartMins = Math.max(startMins, nextSlotMins);
    }

    if (effectiveStartMins >= endMins) return [];

    const dayEvents = (eventsList || []).filter(e => e && e.date === dateStr && !e.allDay && e.startTime && e.endTime);
    const busyIntervals = dayEvents.map(e => ({
      start: Math.max(effectiveStartMins, timeToMinutes(e.startTime) || effectiveStartMins),
      end: Math.min(endMins, timeToMinutes(e.endTime) || endMins)
    })).filter(it => it.end > it.start)
      .sort((a, b) => a.start - b.start);

    const mergedBusy = [];
    busyIntervals.forEach(curr => {
      if (mergedBusy.length === 0) {
        mergedBusy.push({ ...curr });
      } else {
        const last = mergedBusy[mergedBusy.length - 1];
        if (curr.start <= last.end) {
          last.end = Math.max(last.end, curr.end);
        } else {
          mergedBusy.push({ ...curr });
        }
      }
    });

    const gaps = [];
    let currentPointer = effectiveStartMins;

    mergedBusy.forEach(busy => {
      if (busy.start > currentPointer) {
        const gapDuration = busy.start - currentPointer;
        if (gapDuration >= 15) {
          gaps.push({
            date: dateStr,
            startMins: currentPointer,
            endMins: busy.start,
            duration: gapDuration,
            startTime: minutesToTime(currentPointer),
            endTime: minutesToTime(busy.start)
          });
        }
      }
      currentPointer = Math.max(currentPointer, busy.end);
    });

    if (currentPointer < endMins) {
      const gapDuration = endMins - currentPointer;
      if (gapDuration >= 15) {
        gaps.push({
          date: dateStr,
          startMins: currentPointer,
          endMins: endMins,
          duration: gapDuration,
          startTime: minutesToTime(currentPointer),
          endTime: minutesToTime(endMins)
        });
      }
    }

    return gaps;
  },

  simulateSchedule({
    candidateTodos = [],
    targetDays = [],
    workStart = (typeof workStartTime !== 'undefined' ? workStartTime : '09:00'),
    workEnd = (typeof workEndTime !== 'undefined' ? workEndTime : '18:30'),
    eventsList = plannerEvents,
    bufferRatio = 0,
    options = {}
  } = {}) {
    const dates = Array.isArray(targetDays) ? targetDays : (targetDays ? [targetDays] : []);
    if (!dates.length || !candidateTodos.length) return [];

    const allGaps = [];
    for (const d of dates) {
      if (!d) continue;
      const dayGaps = this.findAvailableGaps(d, workStart, workEnd, eventsList, options);
      for (const g of dayGaps) {
        const usableDuration = bufferRatio > 0
          ? Math.max(15, Math.floor(g.duration * (1 - bufferRatio) / 15) * 15)
          : g.duration;
        allGaps.push({
          ...g,
          usableDuration,
          currentOffset: 0
        });
      }
    }

    if (!allGaps.length) return [];

    const assignments = [];
    let gapIdx = 0;

    for (const todo of candidateTodos) {
      const taskDuration = Math.max(15, todo.durationMins || (typeof defaultPlannerDuration !== 'undefined' ? defaultPlannerDuration : 30));

      while (gapIdx < allGaps.length) {
        const gap = allGaps[gapIdx];
        const remainingInGap = gap.usableDuration - gap.currentOffset;

        if (remainingInGap >= taskDuration) {
          const startMins = gap.startMins + gap.currentOffset;
          const endMins = startMins + taskDuration;

          assignments.push({
            todo,
            date: gap.date,
            startTime: minutesToTime(startMins),
            endTime: minutesToTime(endMins),
            startMins,
            endMins,
            durationMins: taskDuration
          });

          gap.currentOffset += taskDuration;
          if (gap.currentOffset + 15 > gap.usableDuration) {
            gapIdx++;
          }
          break;
        } else {
          gapIdx++;
        }
      }

      if (gapIdx >= allGaps.length) break;
    }

    return assignments;
  },

  async autoBalanceSchedule(targetDays, options = {}) {
    const dates = Array.isArray(targetDays) ? targetDays : (targetDays ? [targetDays] : []);
    if (!dates.length) {
      toast(t('planner.noFutureSlotsInView') || 'Cannot schedule in the past. Please navigate to today or a future date.', true);
      return 0;
    }

    const scheduledTodoIds = new Set(
      (plannerEvents || []).filter(e => e && e.todoId).map(e => String(e.todoId))
    );

    const candidateTodos = (typeof todosManifest !== 'undefined' ? todosManifest : []).filter(t => {
      if (!t || t.priority === 'Done' || (typeof isUserTask === 'function' && !isUserTask(t))) return false;
      if (scheduledTodoIds.has(String(t.id))) return false;
      if (typeof TaskGraphEngine !== 'undefined' && TaskGraphEngine.isBlocked(t.id)) return false;
      return true;
    }).sort((a, b) => {
      const quadRank = { Q1: 4, Q2: 3, Q3: 2, Q4: 1 };
      const qA = quadRank[typeof getTodoQuadrant === 'function' ? getTodoQuadrant(a) : (a.eisenhowerQuadrant || 'Q2')] || 2;
      const qB = quadRank[typeof getTodoQuadrant === 'function' ? getTodoQuadrant(b) : (b.eisenhowerQuadrant || 'Q2')] || 2;
      return qB - qA;
    });

    if (!candidateTodos.length) {
      toast(t('planner.noTasksToAutoSchedule') || 'All actionable tasks are already scheduled or completed!');
      return 0;
    }

    const assignments = this.simulateSchedule({
      candidateTodos,
      targetDays: dates,
      bufferRatio: options.bufferRatio || 0,
      options
    });

    if (!assignments.length) {
      toast(t('planner.noFreeGapsFound') || 'No free time slots available during working hours for this day.', true);
      return 0;
    }

    return this.applyAssignments(assignments, dates);
  },

  async applyAssignments(assignments, targetDates = []) {
    if (!assignments || !assignments.length) return 0;
    pushPlannerUndoState('Auto-balance schedule');

    for (const item of assignments) {
      const todo = item.todo;
      const newEvent = {
        id: 'evt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        title: typeof getCleanTaskTitle === 'function' ? getCleanTaskTitle(todo) : (todo.title || 'Task'),
        date: item.date,
        startTime: item.startTime,
        endTime: item.endTime,
        todoId: todo.id,
        allDay: false,
        color: (typeof getQuadrantMeta === 'function' && typeof getTodoQuadrant === 'function' ? getQuadrantMeta(getTodoQuadrant(todo))?.color : '#3b82f6') || '#3b82f6'
      };
      plannerEvents.push(newEvent);
    }

    await savePlanner();
    renderPlanner();
    if (typeof StateBus !== 'undefined') {
      StateBus.emit('planner:autobalanced', {
        date: assignments[0]?.date,
        dates: targetDates,
        count: assignments.length
      });
    }
    toast(t('planner.autoBalanceSuccess', { count: assignments.length }) || `Scheduled ${assignments.length} tasks into open calendar slots!`);
    return assignments.length;
  },

  async autoBalanceDaySchedule(dateStr, options = {}) {
    return this.autoBalanceSchedule([dateStr], options);
  }
};

window.PlannerScheduler = PlannerScheduler;

function openPlannerAutoBalanceModal() {
  const existingModal = document.getElementById('planner-autobalance-modal');
  if (existingModal) existingModal.remove();

  const now = new Date();
  const todayStr = typeof formatLocalDateValue === 'function' ? formatLocalDateValue(now) : now.toISOString().slice(0, 10);
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const workEndMins = timeToMinutes(typeof workEndTime !== 'undefined' ? workEndTime : '18:30') || 1110;
  const todayHasRemainingHours = nowMins + 15 < workEndMins;

  const activeWorkingDays = (typeof plannerWorkingDays !== 'undefined' && plannerWorkingDays.length > 0) ? plannerWorkingDays : [1, 2, 3, 4, 5];

  // Compute scopes
  function getNextWorkingDays(count, startFromDate) {
    const days = [];
    let curr = new Date(startFromDate);
    let guard = 0;
    while (days.length < count && guard < 30) {
      guard++;
      if (activeWorkingDays.includes(curr.getDay())) {
        days.push(formatLocalDateValue(curr));
      }
      curr.setDate(curr.getDate() + 1);
    }
    return days;
  }

  const startDateForScope = todayHasRemainingHours ? new Date(now) : new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  const scopeTodayDays = todayHasRemainingHours ? [todayStr] : getNextWorkingDays(1, startDateForScope);
  const scopeNext3Days = getNextWorkingDays(3, startDateForScope);

  const getDaysFn = (typeof window !== 'undefined' && typeof window.getPlannerDaysToDisplay === 'function')
    ? window.getPlannerDaysToDisplay
    : (typeof getPlannerDaysToDisplay === 'function' ? getPlannerDaysToDisplay : null);
  const displayedDays = getDaysFn ? getDaysFn().map(d => formatLocalDateValue(d)) : [];
  const weekDays = displayedDays.filter(d => d >= todayStr);
  const scopeWeekDays = weekDays.length > 0 ? weekDays : scopeNext3Days;

  let currentScope = 'today';
  let currentLimit = 'top3';
  let meetingBufferEnabled = true;

  const scheduledTodoIds = new Set(
    (plannerEvents || []).filter(e => e && e.todoId).map(e => String(e.todoId))
  );

  const allCandidateTodos = (typeof todosManifest !== 'undefined' ? todosManifest : []).filter(t => {
    if (!t || t.priority === 'Done' || (typeof isUserTask === 'function' && !isUserTask(t))) return false;
    if (scheduledTodoIds.has(String(t.id))) return false;
    if (typeof TaskGraphEngine !== 'undefined' && TaskGraphEngine.isBlocked(t.id)) return false;
    return true;
  }).sort((a, b) => {
    const quadRank = { Q1: 4, Q2: 3, Q3: 2, Q4: 1 };
    const qA = quadRank[typeof getTodoQuadrant === 'function' ? getTodoQuadrant(a) : (a.eisenhowerQuadrant || 'Q2')] || 2;
    const qB = quadRank[typeof getTodoQuadrant === 'function' ? getTodoQuadrant(b) : (b.eisenhowerQuadrant || 'Q2')] || 2;
    return qB - qA;
  });

  const selectedTodoIds = new Set();
  function syncSelectedIdsToLimit() {
    selectedTodoIds.clear();
    let candidatesToSelect = [];
    if (currentLimit === 'top3') {
      candidatesToSelect = allCandidateTodos.slice(0, 3);
    } else if (currentLimit === 'top5') {
      candidatesToSelect = allCandidateTodos.slice(0, 5);
    } else if (currentLimit === 'q1q2') {
      candidatesToSelect = allCandidateTodos.filter(t => {
        const q = typeof getTodoQuadrant === 'function' ? getTodoQuadrant(t) : (t.eisenhowerQuadrant || 'Q2');
        return q === 'Q1' || q === 'Q2';
      });
    } else {
      candidatesToSelect = allCandidateTodos;
    }
    candidatesToSelect.forEach(t => selectedTodoIds.add(t.id));
  }
  syncSelectedIdsToLimit();

  const overlay = document.createElement('div');
  overlay.id = 'planner-autobalance-modal';
  overlay.className = 'planner-modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', t('planner.autoBalanceTitle') || 'Auto-Balance Schedule');

  function getActiveScopeDays() {
    if (currentScope === 'today') return scopeTodayDays;
    if (currentScope === 'next3days') return scopeNext3Days;
    return scopeWeekDays;
  }

  function renderModalInner() {
    const activeDays = getActiveScopeDays();
    const checkedTodos = allCandidateTodos.filter(t => selectedTodoIds.has(t.id));
    const bufferRatio = meetingBufferEnabled ? 0.3 : 0;

    const simulatedAssignments = PlannerScheduler.simulateSchedule({
      candidateTodos: checkedTodos,
      targetDays: activeDays,
      bufferRatio,
      options: { futureOnly: true, now }
    });

    const assignmentMap = new Map();
    simulatedAssignments.forEach(a => assignmentMap.set(a.todo.id, a));

    const fitCount = simulatedAssignments.length;

    overlay.innerHTML = `
      <div class="planner-autobalance-card" onclick="event.stopPropagation()">
        <div class="planner-autobalance-header">
          <div class="planner-autobalance-title-wrap">
            <span class="planner-autobalance-header-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/></svg>
            </span>
            <h3 class="planner-autobalance-title">${escH(t('planner.autoBalanceTitle') || 'Auto-Balance Schedule')}</h3>
          </div>
          <button type="button" class="planner-modal-close" id="autobalance-modal-close" title="${escA(t('common.close') || 'Close')}">✕</button>
        </div>

        <div class="planner-autobalance-body">
          <!-- Control Row 1: Scope -->
          <div class="planner-autobalance-section">
            <div class="planner-autobalance-section-label">${escH(t('planner.autoBalanceScope') || 'Schedule Scope')}</div>
            <div class="planner-autobalance-pill-group" role="group" aria-label="${escA(t('planner.autoBalanceScope') || 'Schedule Scope')}">
              <button type="button" class="planner-autobalance-pill${currentScope === 'today' ? ' active' : ''}" data-scope="today" title="${escA(todayHasRemainingHours ? (t('planner.autoBalanceScopeToday') || 'Today') : (t('planner.nextWorkingDay') || 'Next Working Day'))}">
                ${escH(todayHasRemainingHours ? (t('planner.autoBalanceScopeToday') || 'Today') : (t('planner.nextWorkingDay') || 'Next Day'))}
              </button>
              <button type="button" class="planner-autobalance-pill${currentScope === 'next3days' ? ' active' : ''}" data-scope="next3days" title="${escA(t('planner.autoBalanceScopeNext3Days') || 'Next 3 Days')}">
                ${escH(t('planner.autoBalanceScopeNext3Days') || 'Next 3 Days')}
              </button>
              <button type="button" class="planner-autobalance-pill${currentScope === 'week' ? ' active' : ''}" data-scope="week" title="${escA(t('planner.autoBalanceScopeWeek') || 'Rest of Week')}">
                ${escH(t('planner.autoBalanceScopeWeek') || 'Rest of Week')}
              </button>
            </div>
          </div>

          <!-- Control Row 2: Limit & Meeting Buffer -->
          <div class="planner-autobalance-controls-row">
            <div class="planner-autobalance-section" style="margin-bottom:0;">
              <div class="planner-autobalance-section-label">${escH(t('planner.autoBalanceLimit') || 'Tasks to Plan')}</div>
              <div class="planner-autobalance-pill-group" role="group" aria-label="${escA(t('planner.autoBalanceLimit') || 'Tasks to Plan')}">
                <button type="button" class="planner-autobalance-pill${currentLimit === 'top3' ? ' active' : ''}" data-limit="top3" title="${escA(t('planner.autoBalanceTop3') || 'Top 3')}">
                  ${escH(t('planner.autoBalanceTop3') || 'Top 3')}
                </button>
                <button type="button" class="planner-autobalance-pill${currentLimit === 'top5' ? ' active' : ''}" data-limit="top5" title="${escA(t('planner.autoBalanceTop5') || 'Top 5')}">
                  ${escH(t('planner.autoBalanceTop5') || 'Top 5')}
                </button>
                <button type="button" class="planner-autobalance-pill${currentLimit === 'q1q2' ? ' active' : ''}" data-limit="q1q2" title="${escA(t('planner.autoBalanceQ1Q2') || 'Urgent (Q1/Q2)')}">
                  ${escH(t('planner.autoBalanceQ1Q2') || 'Urgent (Q1/Q2)')}
                </button>
                <button type="button" class="planner-autobalance-pill${currentLimit === 'all' ? ' active' : ''}" data-limit="all" title="${escA(t('planner.autoBalanceAll') || 'All')}">
                  ${escH(t('planner.autoBalanceAll') || 'All')}
                </button>
              </div>
            </div>

            <label class="planner-autobalance-buffer-toggle" title="${escA(t('planner.autoBalanceMeetingBufferTooltip') || 'Reserve 30% buffer in free time for unexpected meetings and calls')}">
              <input type="checkbox" id="autobalance-buffer-cb"${meetingBufferEnabled ? ' checked' : ''} />
              <span class="planner-autobalance-buffer-text">${escH(t('planner.autoBalanceMeetingBuffer') || 'Leave room for meetings')}</span>
            </label>
          </div>

          <!-- Section: Live Proposed Schedule Preview -->
          <div class="planner-autobalance-preview-section">
            <div class="planner-autobalance-preview-header">
              <span class="planner-autobalance-preview-title">${escH(t('planner.autoBalancePreviewHeading') || 'Proposed Schedule')}</span>
              <span class="planner-autobalance-count-badge">${fitCount} / ${allCandidateTodos.length}</span>
            </div>

            <div class="planner-autobalance-list" id="autobalance-items-list">
              ${allCandidateTodos.length === 0 ? `
                <div class="planner-autobalance-empty">${escH(t('planner.autoBalanceNoTasks') || 'No actionable backlog tasks available to schedule.')}</div>
              ` : `
                ${allCandidateTodos.map(todo => {
                  const isChecked = selectedTodoIds.has(todo.id);
                  const assignment = assignmentMap.get(todo.id);
                  const quad = typeof getTodoQuadrant === 'function' ? getTodoQuadrant(todo) : (todo.eisenhowerQuadrant || 'Q2');
                  const quadColor = (typeof getQuadrantMeta === 'function' ? getQuadrantMeta(quad)?.color : '#3b82f6') || '#3b82f6';
                  const taskTitle = typeof getCleanTaskTitle === 'function' ? getCleanTaskTitle(todo) : (todo.title || 'Task');
                  const dur = Math.max(15, todo.durationMins || (typeof defaultPlannerDuration !== 'undefined' ? defaultPlannerDuration : 30));

                  return `
                    <div class="planner-autobalance-item${isChecked ? ' is-selected' : ''}${assignment ? ' has-slot' : ' no-slot'}">
                      <label class="planner-autobalance-item-left" title="${escA(isChecked ? (t('planner.uncheckTaskTooltip') || 'Deselect this task from scheduling') : (t('planner.checkTaskTooltip') || 'Select this task for scheduling'))}">
                        <input type="checkbox" class="autobalance-task-cb" data-todoid="${escA(todo.id)}"${isChecked ? ' checked' : ''} />
                        <span class="planner-autobalance-quad-tag" style="background-color: ${quadColor}22; color: ${quadColor}; border-color: ${quadColor}55;">${escH(quad)}</span>
                        <div class="planner-autobalance-item-info">
                          <span class="planner-autobalance-item-title">${escH(taskTitle)}</span>
                          <span class="planner-autobalance-item-dur">${dur}m</span>
                        </div>
                      </label>

                      <div class="planner-autobalance-slot-badge">
                        ${assignment ? `
                          <span class="planner-autobalance-slot-time" title="${escA(assignment.date)} ${escA(assignment.startTime)} – ${escA(assignment.endTime)}">
                            📅 ${escH(assignment.date === todayStr ? (t('planner.autoBalanceScopeToday') || 'Today') : assignment.date)} ${escH(assignment.startTime)} – ${escH(assignment.endTime)}
                          </span>
                        ` : `
                          <span class="planner-autobalance-slot-none" title="${escA(t('planner.autoBalanceNoSlots') || 'No free time slots available')}">
                            ${escH(t('planner.autoBalanceNoSlots') || 'No free slot')}
                          </span>
                        `}
                      </div>
                    </div>
                  `;
                }).join('')}
              `}
            </div>
          </div>
        </div>

        <div class="planner-autobalance-footer">
          <button type="button" class="btn btn-secondary" id="autobalance-cancel-btn" title="${escA(t('common.cancel') || 'Cancel')}">
            ${escH(t('common.cancel') || 'Cancel')}
          </button>
          <button type="button" class="btn btn-primary" id="autobalance-apply-btn"${fitCount === 0 ? ' disabled' : ''} title="${escA(t('planner.autoBalanceApply', { count: fitCount }) || `Plan ${fitCount} Tasks`)}">
            ${escH(t('planner.autoBalanceApply', { count: fitCount }) || `Plan ${fitCount} Tasks`)}
          </button>
        </div>
      </div>
    `;

    // Bind event handlers
    const closeBtn = overlay.querySelector('#autobalance-modal-close');
    const cancelBtn = overlay.querySelector('#autobalance-cancel-btn');
    const applyBtn = overlay.querySelector('#autobalance-apply-btn');

    const closeModal = () => {
      document.removeEventListener('keydown', handleKeydown);
      overlay.remove();
    };

    if (closeBtn) closeBtn.onclick = closeModal;
    if (cancelBtn) cancelBtn.onclick = closeModal;

    overlay.onclick = (e) => {
      if (e.target === overlay) closeModal();
    };

    // Scope pills
    overlay.querySelectorAll('.planner-autobalance-pill[data-scope]').forEach(btn => {
      btn.onclick = () => {
        currentScope = btn.getAttribute('data-scope');
        renderModalInner();
      };
    });

    // Limit pills
    overlay.querySelectorAll('.planner-autobalance-pill[data-limit]').forEach(btn => {
      btn.onclick = () => {
        currentLimit = btn.getAttribute('data-limit');
        syncSelectedIdsToLimit();
        renderModalInner();
      };
    });

    // Buffer checkbox
    const bufferCb = overlay.querySelector('#autobalance-buffer-cb');
    if (bufferCb) {
      bufferCb.onchange = () => {
        meetingBufferEnabled = bufferCb.checked;
        renderModalInner();
      };
    }

    // Task checkboxes
    overlay.querySelectorAll('.autobalance-task-cb').forEach(cb => {
      cb.onchange = () => {
        const tid = cb.getAttribute('data-todoid');
        if (cb.checked) {
          selectedTodoIds.add(tid);
        } else {
          selectedTodoIds.delete(tid);
        }
        currentLimit = 'custom';
        renderModalInner();
      };
    });

    // Apply button
    if (applyBtn && fitCount > 0) {
      applyBtn.onclick = async () => {
        applyBtn.disabled = true;
        closeModal();
        await PlannerScheduler.applyAssignments(simulatedAssignments, activeDays);
      };
    }
  }

  const handleKeydown = (e) => {
    if (e.key === 'Escape') {
      document.removeEventListener('keydown', handleKeydown);
      overlay.remove();
    }
  };
  document.addEventListener('keydown', handleKeydown);

  renderModalInner();
  document.body.appendChild(overlay);
}

window.openPlannerAutoBalanceModal = openPlannerAutoBalanceModal;

async function triggerPlannerAutoBalance() {
  const getDaysFn = (typeof window !== 'undefined' && typeof window.getPlannerDaysToDisplay === 'function')
    ? window.getPlannerDaysToDisplay
    : (typeof getPlannerDaysToDisplay === 'function' ? getPlannerDaysToDisplay : null);
  const activeDays = getDaysFn ? getDaysFn().map(d => formatLocalDateValue(d)) : [];
  const todayStr = typeof formatLocalDateValue === 'function' ? formatLocalDateValue(new Date()) : new Date().toISOString().slice(0, 10);
  const futureActiveDays = activeDays.filter(d => d >= todayStr);

  if (activeDays.length > 0 && futureActiveDays.length === 0) {
    toast(t('planner.noFutureSlotsInView') || 'Cannot schedule in the past. Please navigate to today or a future date.', true);
    return;
  }

  openPlannerAutoBalanceModal();
}
window.triggerPlannerAutoBalance = triggerPlannerAutoBalance;

function duplicatePlannerSelectedEvent() {
  if (!selectedPlannerEventId) return;
  const evt = plannerEvents.find(e => e.id === selectedPlannerEventId);
  if (!evt) return;
  pushPlannerUndoState('Duplicate event');
  const clone = JSON.parse(JSON.stringify(evt));
  clone.id = 'evt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  clone.title = (clone.title || 'Event') + ' (Copy)';
  delete clone.recurrenceRule;
  delete clone.recurrenceId;
  delete clone.recurrenceExceptions;
  
  const startMin = timeToMinutes(clone.startTime) || 540;
  const endMin = timeToMinutes(clone.endTime) || 570;
  const dur = Math.max(15, endMin - startMin);
  const newStart = Math.min(1440 - dur, endMin);
  clone.startTime = minutesToTime(newStart);
  clone.endTime = minutesToTime(newStart + dur);
  
  plannerEvents.push(clone);
  selectedPlannerEventId = clone.id;
  savePlanner();
  renderPlanner();
  toast(t('planner.eventDuplicated') || 'Event duplicated (Cmd+D)');
}

function nudgePlannerSelectedEventTime(deltaMins) {
  if (!selectedPlannerEventId) return;
  const evt = plannerEvents.find(e => e.id === selectedPlannerEventId);
  if (!evt) return;
  pushPlannerUndoState('Nudge time');
  const startMins = timeToMinutes(evt.startTime) || 540;
  const endMins = timeToMinutes(evt.endTime) || 570;
  const dur = endMins - startMins;
  
  const newStart = Math.max(0, Math.min(1440 - dur, startMins + deltaMins));
  evt.startTime = minutesToTime(newStart);
  evt.endTime = minutesToTime(newStart + dur);
  
  savePlanner();
  renderPlanner();
}

function recordPlannerSeriesMoveException(evt, prevDate, newDate) {
  if (!evt || !prevDate || !newDate || prevDate === newDate) return;
  const seriesRecId = evt.recurrenceId || '';
  if (!seriesRecId && !evt.recurrenceRule) return;

  const parseFn = typeof parseLocalDateValue === 'function'
    ? parseLocalDateValue
    : (typeof window !== 'undefined' && typeof window.parseLocalDateValue === 'function' ? window.parseLocalDateValue : (s => new Date(s)));

  // If this event itself is the master parent holding recurrenceRule
  if (evt.recurrenceRule) {
    if (!evt.recurrenceRule.startDate) {
      evt.recurrenceRule.startDate = prevDate;
    }
    if (evt.recurrenceRule.unit === 'week' && (!Array.isArray(evt.recurrenceRule.weekdays) || evt.recurrenceRule.weekdays.length === 0)) {
      const prevD = parseFn(prevDate);
      if (prevD) {
        evt.recurrenceRule.weekdays = [prevD.getDay()];
      }
    }
    if (!Array.isArray(evt.recurrenceExceptions)) {
      evt.recurrenceExceptions = [];
    }
    if (typeof shouldEventOccurOnDate === 'function' && shouldEventOccurOnDate(evt, prevDate)) {
      if (!evt.recurrenceExceptions.includes(prevDate)) {
        evt.recurrenceExceptions.push(prevDate);
      }
    }
    if (evt.recurrenceExceptions.includes(newDate)) {
      evt.recurrenceExceptions = evt.recurrenceExceptions.filter(d => d !== newDate);
    }
    return;
  }

  // Otherwise, find parent event in plannerEvents
  const parent = (plannerEvents || []).find(e => e && e.recurrenceId === seriesRecId && e.recurrenceRule);
  if (parent) {
    if (!parent.recurrenceRule.startDate) {
      parent.recurrenceRule.startDate = parent.date;
    }
    if (parent.recurrenceRule.unit === 'week' && (!Array.isArray(parent.recurrenceRule.weekdays) || parent.recurrenceRule.weekdays.length === 0)) {
      const parentD = parseFn(parent.date);
      if (parentD) {
        parent.recurrenceRule.weekdays = [parentD.getDay()];
      }
    }
    if (!Array.isArray(parent.recurrenceExceptions)) {
      parent.recurrenceExceptions = [];
    }
    if (typeof shouldEventOccurOnDate === 'function' && shouldEventOccurOnDate(parent, prevDate)) {
      if (!parent.recurrenceExceptions.includes(prevDate)) {
        parent.recurrenceExceptions.push(prevDate);
      }
    }
    if (parent.recurrenceExceptions.includes(newDate)) {
      parent.recurrenceExceptions = parent.recurrenceExceptions.filter(d => d !== newDate);
    }
  }
}

function shiftPlannerSelectedEventDay(daysOffset) {
  if (!selectedPlannerEventId) return;
  const evt = plannerEvents.find(e => e.id === selectedPlannerEventId);
  if (!evt) return;
  pushPlannerUndoState('Shift day');
  const prevDate = evt.date;
  const d = parseLocalDateValue(evt.date);
  if (!d) return;
  d.setDate(d.getDate() + daysOffset);
  const newDate = formatLocalDateValue(d);
  evt.date = newDate;
  
  if (prevDate !== newDate) {
    recordPlannerSeriesMoveException(evt, prevDate, newDate);
  }

  // Shift linked prep blocks
  const prepEvents = (plannerEvents || []).filter(pe => pe && pe.prepForEventId === evt.id);
  prepEvents.forEach(pe => {
    const prevPrepDate = pe.date;
    pe.date = newDate;
    if (prevPrepDate !== newDate) {
      recordPlannerSeriesMoveException(pe, prevPrepDate, newDate);
    }
  });

  savePlanner();
  renderPlanner();
}

function deletePlannerEventWithDissolve(eventId) {
  const card = document.querySelector(`.planner-event-card[data-event-id="${eventId}"]`);
  const recordRecurrenceException = () => {
    const target = (plannerEvents || []).find(e => e && e.id === eventId);
    if (!target) return;
    if (target.recurrenceRule) {
      const otherOcc = (plannerEvents || []).find(e => e && e.id !== target.id && e.recurrenceId === target.recurrenceId && e.type === target.type);
      if (otherOcc) {
        otherOcc.recurrenceRule = JSON.parse(JSON.stringify(target.recurrenceRule));
        if (!otherOcc.recurrenceRule.startDate) otherOcc.recurrenceRule.startDate = target.date;
        if (otherOcc.recurrenceRule.unit === 'week' && (!Array.isArray(otherOcc.recurrenceRule.weekdays) || otherOcc.recurrenceRule.weekdays.length === 0)) {
          const td = parseLocalDateValue(target.date);
          if (td) otherOcc.recurrenceRule.weekdays = [td.getDay()];
        }
        otherOcc.recurrenceExceptions = Array.from(new Set([...(target.recurrenceExceptions || []), target.date]));
      }
    } else if (target.recurrenceId) {
      const parent = (plannerEvents || []).find(e => e && e.recurrenceId === target.recurrenceId && e.recurrenceRule);
      if (parent && target.date) {
        if (!Array.isArray(parent.recurrenceExceptions)) {
          parent.recurrenceExceptions = [];
        }
        if (!parent.recurrenceExceptions.includes(target.date)) {
          parent.recurrenceExceptions.push(target.date);
        }
      }
    }
  };

  if (card) {
    card.classList.add('dissolving');
    setTimeout(() => {
      pushPlannerUndoState('Delete event');
      recordRecurrenceException();
      plannerEvents = plannerEvents.filter(e => e.id !== eventId);
      if (typeof selectedPlannerEventId !== 'undefined' && selectedPlannerEventId === eventId) selectedPlannerEventId = null;
      savePlanner();
      renderPlanner();
      toast(t('planner.eventDeleted') || 'Event deleted');
    }, 220);
  } else {
    pushPlannerUndoState('Delete event');
    recordRecurrenceException();
    plannerEvents = plannerEvents.filter(e => e.id !== eventId);
    if (typeof selectedPlannerEventId !== 'undefined' && selectedPlannerEventId === eventId) selectedPlannerEventId = null;
    savePlanner();
    renderPlanner();
  }
}

function pushPlannerUndoState(actionDescription = 'Planner change') {
  if (_plannerUndoStack.length >= 30) _plannerUndoStack.shift();
  _plannerUndoStack.push({
    description: actionDescription,
    events: JSON.parse(JSON.stringify(plannerEvents || []))
  });
  _plannerRedoStack.length = 0;
}

function undoPlannerAction() {
  if (!_plannerUndoStack.length) {
    toast(t('planner.nothingToUndo') || 'Nothing to undo');
    return;
  }
  _plannerRedoStack.push({
    events: JSON.parse(JSON.stringify(plannerEvents || []))
  });
  const prev = _plannerUndoStack.pop();
  plannerEvents = prev.events;
  savePlanner();
  renderPlanner();
  toast((t('planner.undoneAction') || 'Undone: {action}').replace('{action}', prev.description));
}

function redoPlannerAction() {
  if (!_plannerRedoStack.length) {
    toast(t('planner.nothingToRedo') || 'Nothing to redo');
    return;
  }
  _plannerUndoStack.push({
    description: 'Redo',
    events: JSON.parse(JSON.stringify(plannerEvents || []))
  });
  const next = _plannerRedoStack.pop();
  plannerEvents = next.events;
  savePlanner();
  renderPlanner();
  toast(t('planner.redoneAction') || 'Action redone');
}

function detectVideoCallUrl(event) {
  if (!event) return null;
  const text = `${event.title || ''} ${event.description || ''}`;
  const match = text.match(/(https?:\/\/[^\s<"']*(?:zoom\.us|teams\.microsoft\.com|meet\.google\.com|webex\.com|jitsi\.org)[^\s<"']*)/i);
  return match ? match[1] : null;
}

function setPlannerEventDuration(eventId, durationMins) {
  const evt = plannerEvents.find(e => e.id === eventId);
  if (!evt) return;
  pushPlannerUndoState('Change duration');
  const startMin = timeToMinutes(evt.startTime);
  const endMin = Math.min(1440, startMin + durationMins);
  evt.endTime = minutesToTime(endMin);
  savePlanner();
  renderPlanner();
  toast((t('planner.durationUpdated') || 'Duration set to {mins}m').replace('{mins}', durationMins));
}

function setPlannerEventType(eventId, newType) {
  const evt = plannerEvents.find(e => e.id === eventId);
  if (!evt) return;
  pushPlannerUndoState('Change event type');
  evt.type = newType;
  savePlanner();
  renderPlanner();
  toast(t('planner.typeUpdated') || 'Event category updated');
}

function togglePlannerCategoryFilter(type) {
  if (_plannerCategoryFilters.has(type)) {
    _plannerCategoryFilters.delete(type);
  } else {
    _plannerCategoryFilters.add(type);
  }
  renderPlanner();
}

function togglePlannerQuietHours() {
  _plannerQuietHoursCollapsed = !_plannerQuietHoursCollapsed;
  renderPlanner();
}

function openPlannerShortcutsModal() {
  const shortcutsHtml = `
    <div class="planner-shortcuts-grid">
      <div class="planner-shortcut-item"><span>Navigation Today</span><span class="planner-shortcut-key">T</span></div>
      <div class="planner-shortcut-item"><span>Week View</span><span class="planner-shortcut-key">W</span></div>
      <div class="planner-shortcut-item"><span>3-Day View</span><span class="planner-shortcut-key">3</span></div>
      <div class="planner-shortcut-item"><span>5-Day View</span><span class="planner-shortcut-key">5</span></div>
      <div class="planner-shortcut-item"><span>New Event</span><span class="planner-shortcut-key">N</span></div>
      <div class="planner-shortcut-item"><span>Undo</span><span class="planner-shortcut-key">Cmd + Z</span></div>
      <div class="planner-shortcut-item"><span>Redo</span><span class="planner-shortcut-key">Cmd + Shift + Z</span></div>
      <div class="planner-shortcut-item"><span>Copy / Paste</span><span class="planner-shortcut-key">Cmd+C / Cmd+V</span></div>
      <div class="planner-shortcut-item"><span>Delete Event</span><span class="planner-shortcut-key">Delete / Backspace</span></div>
      <div class="planner-shortcut-item"><span>Jump to Now</span><span class="planner-shortcut-key">J</span></div>
    </div>
  `;
  openPlannerModal(t('planner.shortcutsTitle') || '⌨️ Keyboard Shortcuts', shortcutsHtml, () => {});
}

function unescapeICSValue(val) {
  if (!val) return '';
  return val
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .replace(/\\n/gi, '\n')
    .trim();
}

function parseICSDateTime(dtStr) {
  if (!dtStr) return null;
  const str = String(dtStr).trim();

  // 1. UTC ISO basic: 20260802T143000Z
  const utcMatch = str.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/i);
  if (utcMatch) {
    const year = parseInt(utcMatch[1], 10);
    const month = parseInt(utcMatch[2], 10) - 1;
    const day = parseInt(utcMatch[3], 10);
    const hour = parseInt(utcMatch[4], 10);
    const min = parseInt(utcMatch[5], 10);
    const sec = parseInt(utcMatch[6], 10);
    const dt = new Date(Date.UTC(year, month, day, hour, min, sec));
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    const hh = String(dt.getHours()).padStart(2, '0');
    const mm = String(dt.getMinutes()).padStart(2, '0');
    return {
      date: `${y}-${m}-${d}`,
      time: `${hh}:${mm}`,
      allDay: false
    };
  }

  // 2. Local floating date-time: 20260802T143000 or 20260802T1430
  const localMatch = str.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(?:(\d{2}))?$/i);
  if (localMatch) {
    return {
      date: `${localMatch[1]}-${localMatch[2]}-${localMatch[3]}`,
      time: `${localMatch[4]}:${localMatch[5]}`,
      allDay: false
    };
  }

  // 3. Date only (all-day event): 20260802
  const dateMatch = str.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (dateMatch) {
    return {
      date: `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`,
      time: '09:00',
      allDay: true
    };
  }

  return null;
}

function inferPlannerEventType(summary, description) {
  const text = `${summary || ''} ${description || ''}`.toLowerCase();
  if (/\b(ooo|out of office|vacation|holiday|leave|pto)\b/.test(text)) return 'ooo';
  if (/\b(prep|briefing|preparation)\b/.test(text)) return 'prep';
  if (/\b(call|sync|meeting|zoom|teams|meet|webex|conference|huddle|standup|1:1|demo)\b/.test(text)) return 'call';
  if (/\b(todo|task|action)\b/.test(text)) return 'todo';
  if (/\b(personal|lunch|gym|doctor|dentist|break|family|coffee)\b/.test(text)) return 'personal';
  return 'work';
}

function parseICSContent(icsText) {
  if (!icsText || typeof icsText !== 'string') return [];
  // RFC 5545 line unfolding: replace CRLF or LF followed by space or tab
  const unfolded = icsText.replace(/\r?\n[ \t]/g, '');
  const lines = unfolded.split(/\r?\n/);

  const events = [];
  let inEvent = false;
  let currentProps = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.toUpperCase() === 'BEGIN:VEVENT') {
      inEvent = true;
      currentProps = {};
      continue;
    }

    if (line.toUpperCase() === 'END:VEVENT') {
      if (inEvent) {
        inEvent = false;
        const summary = currentProps['SUMMARY'] || (t('planner.importedEvent') || 'Imported Event');
        const dtStartRaw = currentProps['DTSTART'];
        const dtEndRaw = currentProps['DTEND'];
        const description = currentProps['DESCRIPTION'] || '';
        const location = currentProps['LOCATION'] || '';
        const uid = currentProps['UID'] || '';

        const startParsed = parseICSDateTime(dtStartRaw);
        if (startParsed) {
          let endParsed = parseICSDateTime(dtEndRaw);
          let startTime = startParsed.time;
          let endTime = '17:00';

          if (startParsed.allDay) {
            startTime = '09:00';
            endTime = '17:00';
          } else if (endParsed && endParsed.time && endParsed.time !== startTime) {
            endTime = endParsed.time;
          } else {
            const startMins = typeof timeToMinutes === 'function' ? timeToMinutes(startTime) : 540;
            const endMins = Math.min(1439, startMins + 60);
            const h = String(Math.floor(endMins / 60)).padStart(2, '0');
            const m = String(endMins % 60).padStart(2, '0');
            endTime = `${h}:${m}`;
          }

          const evtType = inferPlannerEventType(summary, description);
          const newEvt = {
            id: 'evt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
            title: summary,
            date: startParsed.date,
            startTime: startTime,
            endTime: endTime,
            type: evtType,
            description: description,
            location: location,
            allDay: startParsed.allDay || false,
            icsUid: uid
          };
          events.push(newEvt);
        }
      }
      continue;
    }

    if (inEvent) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const keyPart = line.substring(0, colonIdx);
        const valPart = line.substring(colonIdx + 1);
        const keyName = keyPart.split(';')[0].trim().toUpperCase();
        currentProps[keyName] = unescapeICSValue(valPart);
      }
    }
  }

  return events;
}

function importPlannerICS() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.ics,text/calendar';
  input.onchange = (evt) => {
    const file = evt.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result;
        if (!text) return;
        const parsedEvents = parseICSContent(text);
        if (!parsedEvents.length) {
          toast(t('planner.icsNoEventsFound') || 'No valid events found in the ICS file', true);
          return;
        }

        let importedCount = 0;
        let skippedCount = 0;

        pushPlannerUndoState('Import ICS');

        parsedEvents.forEach(newEvent => {
          const isDuplicate = (plannerEvents || []).some(existing => 
            existing.date === newEvent.date &&
            existing.startTime === newEvent.startTime &&
            existing.endTime === newEvent.endTime &&
            String(existing.title || '').trim().toLowerCase() === String(newEvent.title || '').trim().toLowerCase()
          );

          if (isDuplicate) {
            skippedCount++;
          } else {
            plannerEvents.push(newEvent);
            importedCount++;
          }
        });

        if (importedCount > 0) {
          savePlanner();
          renderPlanner();
        }

        const msgTemplate = t('planner.icsImportedCount') || 'Imported {count} event(s) into Planner ({skipped} duplicates skipped)';
        const msg = msgTemplate
          .replace('{count}', importedCount)
          .replace('{skipped}', skippedCount);
        toast(msg);
      } catch (err) {
        console.error('Failed to import ICS:', err);
        const errTemplate = t('planner.icsImportFailed') || 'Failed to import ICS file: {error}';
        toast(errTemplate.replace('{error}', err.message), true);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

function exportPlannerWeekToICS() {
  try {
    const daysToDisplay = getPlannerDaysToDisplay().map(d => formatLocalDateValue(d));
    const eventsToExport = plannerEvents.filter(e => daysToDisplay.includes(e.date));
    
    let icsContent = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Secretary App//Planner//EN\r\nCALSCALE:GREGORIAN\r\n";
    eventsToExport.forEach(evt => {
      const linkedTodo = (evt.todoId && typeof getTodoById === 'function') ? getTodoById(evt.todoId) : null;
      const qPrefix = (linkedTodo && typeof getTodoQuadrant === 'function') ? `[${getTodoQuadrant(linkedTodo)}] ` : '';
      const summaryStr = (qPrefix + (evt.title || 'Event')).replace(/\r|\n/g, ' ');
      const descStr = (evt.description || linkedTodo?.context || '').replace(/\r|\n/g, '\\n');

      icsContent += `BEGIN:VEVENT\r\nUID:${evt.id}@secretary\r\nSUMMARY:${summaryStr}\r\n`;
      if (descStr) icsContent += `DESCRIPTION:${descStr}\r\n`;

      if (evt.allDay || evt.type === 'ooo') {
        const dtDate = (evt.date || '').replace(/-/g, '');
        icsContent += `DTSTART;VALUE=DATE:${dtDate}\r\nDTEND;VALUE=DATE:${dtDate}\r\n`;
      } else {
        const dtStart = (evt.date || '').replace(/-/g, '') + 'T' + (evt.startTime || '09:00').replace(':', '') + '00';
        const dtEnd = (evt.date || '').replace(/-/g, '') + 'T' + (evt.endTime || '09:30').replace(':', '') + '00';
        icsContent += `DTSTART:${dtStart}\r\nDTEND:${dtEnd}\r\n`;
      }
      icsContent += "END:VEVENT\r\n";
    });
    icsContent += "END:VCALENDAR\r\n";
    
    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `planner-export-${daysToDisplay[0]}-to-${daysToDisplay[daysToDisplay.length - 1]}.ics`;
    link.click();
    toast(t('planner.icsExported') || 'Calendar exported to ICS');
  } catch (err) {
    console.error('Failed to export ICS:', err);
    toast('Export failed: ' + err.message, true);
  }
}

function closePlannerMoreDropdown() {
  const existing = document.getElementById('planner-more-dropdown-menu') || document.getElementById('planner-ics-dropdown-menu');
  if (existing) {
    existing.remove();
  }
}

function closePlannerICSDropdown() {
  closePlannerMoreDropdown();
}

function togglePlannerMoreDropdown(event) {
  if (event) event.stopPropagation();
  const existing = document.getElementById('planner-more-dropdown-menu') || document.getElementById('planner-ics-dropdown-menu');
  if (existing) {
    closePlannerMoreDropdown();
    return;
  }

  const btn = event?.currentTarget || document.getElementById('planner-more-menu-btn') || document.getElementById('planner-ics-menu-btn');
  if (!btn) return;
  const rect = btn.getBoundingClientRect();

  const dropdown = document.createElement('div');
  dropdown.id = 'planner-more-dropdown-menu';
  dropdown.className = 'planner-more-dropdown-menu';
  dropdown.style.cssText = `
    position: fixed;
    top: ${rect.bottom + 4}px;
    left: ${Math.max(8, Math.min(window.innerWidth - 230, rect.left))}px;
    z-index: 10000;
  `;

  // 1. Import ICS
  const importBtn = document.createElement('button');
  importBtn.className = 'planner-more-menu-item';
  importBtn.title = escA(t('planner.importIcsTooltip') || t('planner.importIcs') || 'Import ICS file');
  importBtn.innerHTML = `
    <span class="planner-more-menu-icon">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M12 19v-5"/><polyline points="9 16 12 13 15 16"/></svg>
    </span>
    <span>${escH(t('planner.importIcs') || 'Import ICS...')}</span>
  `;
  importBtn.onclick = (e) => {
    e.stopPropagation();
    closePlannerMoreDropdown();
    importPlannerICS();
  };

  // 2. Export ICS
  const exportBtn = document.createElement('button');
  exportBtn.className = 'planner-more-menu-item';
  exportBtn.title = escA(t('planner.exportIcsTooltip') || t('planner.exportIcs') || 'Export calendar to ICS file');
  exportBtn.innerHTML = `
    <span class="planner-more-menu-icon">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M12 13v5"/><polyline points="9 16 12 19 15 16"/></svg>
    </span>
    <span>${escH(t('planner.exportIcs') || 'Export Week to ICS')}</span>
  `;
  exportBtn.onclick = (e) => {
    e.stopPropagation();
    closePlannerMoreDropdown();
    exportPlannerWeekToICS();
  };

  // 3. Keyboard Shortcuts
  const shortcutsBtn = document.createElement('button');
  shortcutsBtn.className = 'planner-more-menu-item';
  shortcutsBtn.title = escA(t('planner.shortcutsTitle') || t('shortcuts.title') || 'Keyboard Shortcuts');
  shortcutsBtn.innerHTML = `
    <span class="planner-more-menu-icon">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" ry="2"/><line x1="6" y1="8" x2="6.01" y2="8"/><line x1="10" y1="8" x2="10.01" y2="8"/><line x1="14" y1="8" x2="14.01" y2="8"/><line x1="18" y1="8" x2="18.01" y2="8"/><line x1="6" y1="12" x2="6.01" y2="12"/><line x1="18" y1="12" x2="18.01" y2="12"/><line x1="7" y1="16" x2="17" y2="16"/></svg>
    </span>
    <span>${escH(t('shortcuts.title') || 'Shortcuts')}</span>
  `;
  shortcutsBtn.onclick = (e) => {
    e.stopPropagation();
    closePlannerMoreDropdown();
    openPlannerShortcutsModal();
  };

  dropdown.appendChild(importBtn);
  dropdown.appendChild(exportBtn);
  dropdown.appendChild(shortcutsBtn);
  document.body.appendChild(dropdown);

  const outsideClickHandler = (e) => {
    if (!dropdown.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
      closePlannerMoreDropdown();
      document.removeEventListener('click', outsideClickHandler, true);
    }
  };
  setTimeout(() => {
    document.addEventListener('click', outsideClickHandler, true);
  }, 10);
}

function togglePlannerICSDropdown(event) {
  togglePlannerMoreDropdown(event);
}

function getPlannerWeeklyStats() {
  const daysToDisplay = getPlannerDaysToDisplay().map(d => formatLocalDateValue(d));
  const weekEvents = (plannerEvents || []).filter(e => daysToDisplay.includes(e.date));
  let totalMins = 0;
  let callMins = 0;
  let workMins = 0;
  let prepMins = 0;
  
  weekEvents.forEach(e => {
    const dur = Math.max(0, timeToMinutes(e.endTime) - timeToMinutes(e.startTime));
    totalMins += dur;
    if (e.type === 'call' || e.type === 'sync') callMins += dur;
    else if (e.type === 'work' || e.type === 'todo') workMins += dur;
    else if (e.type === 'prep') prepMins += dur;
  });
  
  return {
    totalHours: (totalMins / 60).toFixed(1),
    callHours: (callMins / 60).toFixed(1),
    workHours: (workMins / 60).toFixed(1),
    prepHours: (prepMins / 60).toFixed(1)
  };
}


function refreshOverlayPlannerBlocksIfOpen() {
  if (typeof _renderPlannerBlocksForNote !== 'function') return;
  if (typeof currentNote === 'undefined' || !currentNote) return;
  const overlay = document.getElementById('note-edit-overlay');
  if (!overlay || overlay.style.display === 'none') return;
  _renderPlannerBlocksForNote(currentNote.id || '');
}

function normalizePlannerEventsStrict(events) {
  const source = Array.isArray(events) ? events : [];
  const normalized = source.map(e => ({ ...(e || {}) }));
  let mutated = false;

  const validTypes = new Set(['call', 'sync', 'prep', 'todo', 'work', 'ooo', 'custom', 'personal']);
  normalized.forEach(event => {
    const rawType = String(event.type || '').trim().toLowerCase();
    if (!validTypes.has(rawType)) {
      event.type = (typeof inferPlannerEventType === 'function')
        ? inferPlannerEventType(event.title, event.context || event.description || '')
        : (rawType === 'event' ? 'call' : 'work');
      mutated = true;
    } else if (event.type !== rawType) {
      event.type = rawType;
      mutated = true;
    }
  });

  const getPrepAnchorId = (event) => {
    if (!event) return '';
    const type = String(event.type || '').toLowerCase();
    if (type === 'prep') return String(event.prepForEventId || '').trim();
    if (type === 'call' || type === 'sync') return String(event.id || '').trim();
    return '';
  };

  const sharesPrepFamily = (a, b) => {
    const aAnchor = getPrepAnchorId(a);
    const bAnchor = getPrepAnchorId(b);
    return !!aAnchor && !!bAnchor && aAnchor === bAnchor;
  };

  const noteDateById = new Map(
    (Array.isArray(manifest) ? manifest : [])
      .filter(n => n && n.id)
      .map(n => [n.id, String(n.date || '').trim()])
  );

  const dayDistance = (eventDate, noteDate) => {
    const a = parseLocalDateValue(eventDate || '');
    const b = parseLocalDateValue(noteDate || '');
    if (!a || !b || Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return Number.POSITIVE_INFINITY;
    const ms = Math.abs(a.getTime() - b.getTime());
    return Math.floor(ms / 86400000);
  };

  const sortCandidateNoteIds = (ids, eventDate, preferredId = '') => {
    return ids.slice().sort((a, b) => {
      const aDist = dayDistance(eventDate, noteDateById.get(a) || '');
      const bDist = dayDistance(eventDate, noteDateById.get(b) || '');
      if (aDist !== bDist) return aDist - bDist;
      if (preferredId) {
        if (a === preferredId && b !== preferredId) return -1;
        if (b === preferredId && a !== preferredId) return 1;
      }
      const aDate = noteDateById.get(a) || '';
      const bDate = noteDateById.get(b) || '';
      const dateCmp = bDate.localeCompare(aDate);
      if (dateCmp !== 0) return dateCmp;
      return a.localeCompare(b);
    });
  };

  const clearPrimaryForEvent = (event, noteIdToClear) => {
    if (!event) return;
    const beforePrimary = String(event.noteId || '');
    const nextLinked = normalizePlannerLinkedNoteIds(event.linkedNoteIds || []).filter(id => id !== noteIdToClear);
    if (beforePrimary) {
      event.noteId = '';
      mutated = true;
    }
    if (JSON.stringify(nextLinked) !== JSON.stringify(event.linkedNoteIds || [])) {
      event.linkedNoteIds = nextLinked;
      mutated = true;
    }
  };

  // Pass 1: normalize shape + pick a single primary note candidate per bloc by date.
  normalized.forEach(event => {
    const rawPrimary = String(event.noteId || '').trim();
    const rawLinked = normalizePlannerLinkedNoteIds(event.linkedNoteIds || []);

    if (!rawPrimary) {
      if (rawLinked.length === 0) {
        if (event.noteId || (Array.isArray(event.linkedNoteIds) && event.linkedNoteIds.length > 0)) mutated = true;
        event.noteId = '';
        event.linkedNoteIds = [];
      } else if (JSON.stringify(rawLinked) !== JSON.stringify(event.linkedNoteIds || [])) {
        event.noteId = '';
        event.linkedNoteIds = rawLinked;
        mutated = true;
      } else {
        event.noteId = '';
      }
      return;
    }

    const candidates = normalizePlannerLinkedNoteIds([rawPrimary, ...rawLinked]);

    if (candidates.length === 0) {
      if (rawPrimary || (Array.isArray(event.linkedNoteIds) && event.linkedNoteIds.length > 0)) mutated = true;
      event.noteId = '';
      event.linkedNoteIds = [];
      return;
    }

    const sorted = sortCandidateNoteIds(candidates, event.date || '', rawPrimary);
    const chosenPrimary = sorted[0] || '';
    const nextLinked = chosenPrimary
      ? normalizePlannerLinkedNoteIds([chosenPrimary, ...sorted.filter(id => id !== chosenPrimary)], chosenPrimary)
      : normalizePlannerLinkedNoteIds(sorted);

    if (event.noteId !== chosenPrimary) {
      event.noteId = chosenPrimary;
      mutated = true;
    }
    if (JSON.stringify(nextLinked) !== JSON.stringify(event.linkedNoteIds || [])) {
      event.linkedNoteIds = nextLinked;
      mutated = true;
    }
  });

  // Pass 1.5: keep prep and its parent call/sync on the same primary note when one side has it.
  normalized.forEach(event => {
    if (String(event?.type || '').toLowerCase() !== 'prep') return;
    const parentId = String(event.prepForEventId || '').trim();
    if (!parentId) return;
    const mainEv = normalized.find(e => String(e?.id || '').trim() === parentId);
    if (!mainEv) return;

    const prepNoteId = String(event.noteId || '').trim();
    const mainNoteId = String(mainEv.noteId || '').trim();
    const chosen = prepNoteId || mainNoteId;
    if (!chosen) return;

    if (prepNoteId !== chosen) {
      event.noteId = chosen;
      mutated = true;
    }
    if (mainNoteId !== chosen) {
      mainEv.noteId = chosen;
      mutated = true;
    }

    const nextPrepLinked = normalizePlannerLinkedNoteIds([chosen, ...(event.linkedNoteIds || [])], chosen);
    if (JSON.stringify(nextPrepLinked) !== JSON.stringify(event.linkedNoteIds || [])) {
      event.linkedNoteIds = nextPrepLinked;
      mutated = true;
    }

    const nextMainLinked = normalizePlannerLinkedNoteIds([chosen, ...(mainEv.linkedNoteIds || [])], chosen);
    if (JSON.stringify(nextMainLinked) !== JSON.stringify(mainEv.linkedNoteIds || [])) {
      mainEv.linkedNoteIds = nextMainLinked;
      mutated = true;
    }
  });

  // Pass 2: enforce strict uniqueness: a note can be primary for only one bloc.
  const ownerByNoteId = new Map();
  const compareOwners = (curr, next) => {
    if (next.distance !== curr.distance) return next.distance < curr.distance;
    const nextDate = next.event.date || '';
    const currDate = curr.event.date || '';
    if (nextDate !== currDate) return nextDate > currDate;
    const nextStart = next.event.startTime || '';
    const currStart = curr.event.startTime || '';
    if (nextStart !== currStart) return nextStart < currStart;
    return String(next.event.id || '').localeCompare(String(curr.event.id || '')) < 0;
  };

  normalized.forEach((event, idx) => {
    const noteId = String(event.noteId || '').trim();
    if (!noteId) return;
    const candidate = {
      idx,
      event,
      distance: dayDistance(event.date || '', noteDateById.get(noteId) || '')
    };

    const currentOwner = ownerByNoteId.get(noteId);
    if (!currentOwner) {
      ownerByNoteId.set(noteId, candidate);
      return;
    }

    if (sharesPrepFamily(currentOwner.event, candidate.event)) {
      return;
    }

    if (compareOwners(currentOwner, candidate)) {
      clearPrimaryForEvent(currentOwner.event, noteId);
      ownerByNoteId.set(noteId, candidate);
    } else {
      clearPrimaryForEvent(candidate.event, noteId);
    }
  });

  // Pass 3: final shape cleanup
  normalized.forEach(event => {
    const isCustom = String(event.type || '') === 'custom';
    const type = String(event.type || '').toLowerCase();
    const primary = isCustom ? '' : String(event.noteId || '').trim();
    const nextLinked = isCustom
      ? []
      : (primary
        ? normalizePlannerLinkedNoteIds(event.linkedNoteIds || [], primary)
        : normalizePlannerLinkedNoteIds(event.linkedNoteIds || []));

    const rawPrimaryTodo = String(event.todoId || '').trim();
    const rawLinkedTodos = normalizePlannerLinkedTodoIds(event.linkedTodoIds || []);
    let nextPrimaryTodo = rawPrimaryTodo;
    let nextLinkedTodos = rawLinkedTodos;

    if (type === 'todo') {
      nextLinkedTodos = normalizePlannerLinkedTodoIds(nextLinkedTodos.filter(id => id !== nextPrimaryTodo));
    } else if (type === 'call' || type === 'sync' || type === 'prep') {
      nextPrimaryTodo = '';
      nextLinkedTodos = normalizePlannerLinkedTodoIds(rawLinkedTodos.filter(id => id !== rawPrimaryTodo));
    } else {
      nextPrimaryTodo = '';
      nextLinkedTodos = [];
    }

    if (event.noteId !== primary) {
      event.noteId = primary;
      mutated = true;
    }
    if (JSON.stringify(nextLinked) !== JSON.stringify(event.linkedNoteIds || [])) {
      event.linkedNoteIds = nextLinked;
      mutated = true;
    }
    if ((event.todoId || '') !== nextPrimaryTodo) {
      event.todoId = nextPrimaryTodo;
      mutated = true;
    }
    if (JSON.stringify(nextLinkedTodos) !== JSON.stringify(event.linkedTodoIds || [])) {
      event.linkedTodoIds = nextLinkedTodos;
      mutated = true;
    }
  });

  // Recurrence normalization and healing pass
  const recurringParents = normalized.filter(e => e && e.recurrenceRule);
  for (const parent of recurringParents) {
    if (!parent.recurrenceId) {
      parent.recurrenceId = 'rec-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      mutated = true;
    }
    for (const other of normalized) {
      if (!other || other.id === parent.id) continue;
      if (!other.recurrenceId && other.type === parent.type && other.title === parent.title && typeof shouldEventOccurOnDate === 'function' && shouldEventOccurOnDate(parent, other.date)) {
        other.recurrenceId = parent.recurrenceId;
        mutated = true;
      }
      if (other.type === 'prep' && !other.recurrenceId) {
        if (other.prepForEventId === parent.id || (parent.recurrenceId && normalized.some(occ => occ.recurrenceId === parent.recurrenceId && occ.id === other.prepForEventId))) {
          other.recurrenceId = parent.recurrenceId;
          mutated = true;
        }
      }
    }
  }

  return { events: normalized, mutated };
}


// Load planner data from disk
async function loadPlanner() {
  if (typeof plannerLoadState !== 'undefined') {
    plannerLoadState = 'loading';
  } else if (typeof window !== 'undefined') {
    window.plannerLoadState = 'loading';
  }
  refreshOverlayPlannerBlocksIfOpen();
  try {
    if (await StorageAPI.hasPlanner()) {
      const data = await StorageAPI.readPlanner();
      const result = normalizePlannerEventsStrict(data.events || []);
      plannerEvents = result.events;
      if (result.mutated && typeof StorageAPI.writePlanner === 'function') {
        await StorageAPI.writePlanner({ events: plannerEvents });
      }
    } else {
      plannerEvents = [];
    }
    await loadPlannerProposals();
    if (typeof plannerLoadState !== 'undefined') {
      plannerLoadState = 'ready';
    } else if (typeof window !== 'undefined') {
      window.plannerLoadState = 'ready';
    }
  } catch (e) {
    console.warn('Could not load planner.json, initializing empty:', e);
    plannerEvents = [];
    if (typeof plannerLoadState !== 'undefined') {
      plannerLoadState = 'error';
    } else if (typeof window !== 'undefined') {
      window.plannerLoadState = 'error';
    }
  } finally {
    refreshOverlayPlannerBlocksIfOpen();
  }
}

// Save planner data to disk
async function savePlanner() {
  try {
    const result = normalizePlannerEventsStrict(plannerEvents);
    plannerEvents = result.events;
    if (typeof window !== 'undefined') {
      window.plannerEvents = plannerEvents;
    }
    const data = { events: plannerEvents };
    await StorageAPI.writePlanner(data);
    broadcastSync({ type: 'PLANNER_UPDATED' });
    if (typeof _renderPlannerBlocksForNote === 'function' && typeof currentNote !== 'undefined' && currentNote && currentNote.id) {
      const overlay = document.getElementById('note-edit-overlay');
      if (overlay && overlay.style.display !== 'none') {
        _renderPlannerBlocksForNote(currentNote.id);
      }
    }
  } catch (e) {
    toast('Failed to save planner data: ' + e.message, true);
  }
}

// ═══ External Agent Planner Proposals Engine ═══

/**
 * Parses flexible duration representations into total minutes.
 * Supports numbers (minutes, decimals as hours), unit strings ("45m", "1.5h", "1h 30m", "01:30"),
 * ISO 8601 strings ("PT1H30M", "P1D"), and full-day indicators ("1440", "1439", "1d", "all-day").
 * Resilient against malicious payloads (NaN, Infinity, prototype pollution, ReDoS strings, non-primitives).
 *
 * @param {number|string} raw
 * @param {number|null} [fallback=null]
 * @returns {number|null} Duration in minutes, or fallback.
 */
function parsePlannerDuration(raw, fallback = null) {
  if (raw === null || raw === undefined || raw === '' || typeof raw === 'boolean' || typeof raw === 'function' || typeof raw === 'symbol') {
    return fallback;
  }

  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || isNaN(raw) || raw <= 0) {
      return fallback;
    }
    if (!Number.isInteger(raw) && raw < 24) {
      return Math.min(1440, Math.round(raw * 60));
    }
    return Math.min(1440, Math.round(raw));
  }

  if (typeof raw !== 'string') {
    return fallback;
  }

  // Prevent ReDoS / catastrophic backtracking from oversized strings
  if (raw.length > 200) {
    return fallback;
  }

  const str = raw.trim().toLowerCase();
  if (!str) return fallback;

  // 1. All day / full day keywords & variances
  if (/^(all[- ]?day|full[- ]?day|ganzt[aä]gig|toute la journ[eé]e|day|1d|1 *day)$/i.test(str)) {
    return 1440;
  }

  // 2. ISO 8601 duration (e.g. P1D, PT1H30M, PT45M, PT2H)
  if (/^p/i.test(str)) {
    if (/^p1d$/i.test(str)) return 1440;
    const isoMatch = str.match(/^pt(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?$/i);
    if (isoMatch) {
      const h = parseFloat(isoMatch[1]) || 0;
      const m = parseFloat(isoMatch[2]) || 0;
      const s = parseFloat(isoMatch[3]) || 0;
      if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(s)) return fallback;
      const total = Math.round(h * 60 + m + s / 60);
      return (Number.isFinite(total) && total > 0) ? Math.min(1440, total) : fallback;
    }
  }

  // 3. Combined hour & minutes (e.g., "1h30", "1h 30m", "1h30min", "1 hour 30 mins", "1 hr and 30 min")
  const combinedMatch = str.match(/^(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours|stunde|stunden|heure|heures)\s*(?:and)?\s*(\d+)\s*(?:m|min|mins|minute|minutes|minuten|minutos)?$/i);
  if (combinedMatch) {
    const h = parseFloat(combinedMatch[1]) || 0;
    const m = parseFloat(combinedMatch[2]) || 0;
    if (!Number.isFinite(h) || !Number.isFinite(m)) return fallback;
    const total = Math.round(h * 60 + m);
    return (Number.isFinite(total) && total > 0) ? Math.min(1440, total) : fallback;
  }

  // 4. Hours only with units (e.g. "2h", "1.5 hrs", "0.5 hours", "3 stunden")
  const hoursOnlyMatch = str.match(/^(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours|stunde|stunden|heure|heures)$/i);
  if (hoursOnlyMatch) {
    const h = parseFloat(hoursOnlyMatch[1]);
    if (Number.isFinite(h) && h > 0) return Math.min(1440, Math.round(h * 60));
  }

  // 5. Minutes only with units (e.g. "45m", "45min", "45 mins", "90 minutes")
  const minsOnlyMatch = str.match(/^(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes|minuten|minutos)$/i);
  if (minsOnlyMatch) {
    const m = parseFloat(minsOnlyMatch[1]);
    if (Number.isFinite(m) && m > 0) return Math.min(1440, Math.round(m));
  }

  // 6. Clock format "HH:MM" or "H:MM" (e.g. "01:30" -> 90 mins, "00:45" -> 45 mins, "23:59" -> 1439 mins, "24:00" -> 1440 mins)
  const clockMatch = str.match(/^(\d{1,2}):(\d{2})$/);
  if (clockMatch) {
    const h = parseInt(clockMatch[1], 10);
    const m = parseInt(clockMatch[2], 10);
    if (!isNaN(h) && !isNaN(m) && h >= 0 && h <= 24 && m >= 0 && m < 60) {
      const total = h * 60 + m;
      return total > 0 ? Math.min(1440, total) : fallback;
    }
  }

  // 7. Pure numeric string (e.g. "45", "1440", "1439", "1.5")
  if (/^(\d+(?:\.\d+)?)$/.test(str)) {
    const num = parseFloat(str);
    if (Number.isFinite(num) && num > 0) {
      if (!Number.isInteger(num) && num < 24) {
        return Math.min(1440, Math.round(num * 60));
      }
      return Math.min(1440, Math.round(num));
    }
  }

  return fallback;
}

const MAX_PLANNER_PROPOSALS_CAP = 1000;

/**
 * Normalizes raw proposal data from planner-proposals.json.
 * Deduplicates by unique proposal ID so external agents can safely append entries.
 * Checks against existing plannerEvents to ensure already accepted proposals do not overlap or duplicate.
 * Hardened against malicious payloads (prototype pollution, SQL/XSS strings, non-array inputs, corrupt dates, DoS entry floods).
 */
function normalizePlannerProposals(rawProposals, currentPlannerEvents = []) {
  let list = [];
  if (Array.isArray(rawProposals)) {
    list = rawProposals;
  } else if (rawProposals && typeof rawProposals === 'object') {
    if (Array.isArray(rawProposals.proposals)) {
      list = rawProposals.proposals;
    } else if (Array.isArray(rawProposals.events)) {
      list = rawProposals.events;
    }
  }

  // DoS protection: cap list size to prevent memory exhaustion / long event loop blocks
  if (list.length > MAX_PLANNER_PROPOSALS_CAP) {
    list = list.slice(-MAX_PLANNER_PROPOSALS_CAP);
  }

  const existingAcceptedIds = new Set();
  (Array.isArray(currentPlannerEvents) ? currentPlannerEvents : []).forEach(e => {
    if (e && e.proposalId) {
      existingAcceptedIds.add(String(e.proposalId).trim());
    }
  });

  const validTypes = new Set(['call', 'sync', 'prep', 'todo', 'work', 'ooo', 'custom', 'personal']);
  const dedupMap = new Map();

  list.forEach((item, idx) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return;

    const rawId = (typeof item.id === 'string' || typeof item.id === 'number')
      ? String(item.id).trim()
      : ((typeof item.proposalId === 'string' || typeof item.proposalId === 'number') ? String(item.proposalId).trim() : '');
    const id = (rawId || ('prop-' + (item.date || 'date') + '-' + idx)).slice(0, 128);

    if (dedupMap.size >= MAX_PLANNER_PROPOSALS_CAP && !dedupMap.has(id)) return;

    let title = (typeof item.title === 'string' || typeof item.title === 'number')
      ? String(item.title).trim()
      : (typeof item.name === 'string' ? item.name.trim() : '');
    if (!title) title = (typeof t === 'function' ? t('planner.blockLabel') : '') || 'Proposed Event';
    title = title.slice(0, 500);

    let date = typeof item.date === 'string' ? item.date.trim() : '';
    let isValidDate = /^\d{4}-\d{2}-\d{2}$/.test(date);
    if (isValidDate) {
      const [y, m, d] = date.split('-').map(Number);
      if (m < 1 || m > 12 || d < 1 || d > 31) isValidDate = false;
    }
    if (!isValidDate) {
      date = (typeof formatLocalDateValue === 'function')
        ? formatLocalDateValue(new Date())
        : new Date().toISOString().slice(0, 10);
    }

    const rawDuration = item.duration ?? item.dur ?? item.length ?? item.durationMinutes ?? null;
    const parsedDuration = parsePlannerDuration(rawDuration, null);

    const isExplicitAllDay = (
      item.allDay === true ||
      item.isAllDay === true ||
      (typeof rawDuration === 'string' && /^(all[- ]?day|full[- ]?day|ganzt[aä]gig|toute la journ[eé]e|day|1d|1 *day)$/i.test(rawDuration.trim())) ||
      parsedDuration === 1440 ||
      parsedDuration === 1439
    );

    let startTime = typeof item.startTime === 'string' ? item.startTime.trim() : (typeof item.start === 'string' ? item.start.trim() : '');
    let isValidStartTime = /^\d{1,2}:\d{2}$/.test(startTime);
    if (isValidStartTime) {
      const [sh, sm] = startTime.split(':').map(Number);
      if (sh < 0 || sh > 24 || sm < 0 || sm > 59) isValidStartTime = false;
    }
    if (!isValidStartTime) {
      startTime = isExplicitAllDay ? '00:00' : '10:00';
    }
    if (startTime.length === 4) startTime = '0' + startTime;

    let endTime = typeof item.endTime === 'string' ? item.endTime.trim() : (typeof item.end === 'string' ? item.end.trim() : '');
    let isValidEndTime = /^\d{1,2}:\d{2}$/.test(endTime);
    if (isValidEndTime) {
      const [eh, em] = endTime.split(':').map(Number);
      if (eh < 0 || eh > 24 || em < 0 || em > 59) isValidEndTime = false;
    }
    if (!isValidEndTime) {
      endTime = '';
    }

    const startMins = typeof timeToMinutes === 'function' ? timeToMinutes(startTime, false) : 600;
    let endMins = (endTime && typeof timeToMinutes === 'function') ? timeToMinutes(endTime, true) : NaN;

    let duration = parsedDuration;

    if (isNaN(endMins) || (endMins <= startMins && !(endMins === 1440 && startMins < 1440))) {
      if (isExplicitAllDay) {
        duration = (parsedDuration === 1439) ? 1439 : 1440;
        endTime = '23:59';
      } else {
        const effectiveDur = (duration !== null && duration > 0) ? Math.min(1440, duration) : 30;
        duration = effectiveDur;
        endMins = startMins + effectiveDur;
        if (endMins >= 1439) {
          endTime = '23:59';
        } else {
          endTime = (typeof minutesToTime === 'function') ? minutesToTime(endMins) : '10:30';
        }
      }
    } else {
      if (duration === null) {
        duration = Math.max(1, Math.min(1440, endMins - startMins));
      }
    }

    if (endTime.length === 4) endTime = '0' + endTime;

    let rawType = typeof item.type === 'string' ? item.type.trim().toLowerCase() : '';
    if (!validTypes.has(rawType)) {
      rawType = (typeof inferPlannerEventType === 'function')
        ? inferPlannerEventType(title, (typeof item.description === 'string' ? item.description : (typeof item.context === 'string' ? item.context : '')))
        : 'work';
    }

    const description = typeof item.description === 'string'
      ? item.description.trim().slice(0, 5000)
      : (typeof item.context === 'string' ? item.context.trim().slice(0, 5000) : '');
    const source = (typeof item.source === 'string' ? item.source.trim().slice(0, 100) : '') || (typeof t === 'function' ? t('planner.proposedByAgent') : 'Agent');
    const collaborators = Array.isArray(item.collaborators)
      ? item.collaborators.map(c => (typeof c === 'string' || typeof c === 'number' ? String(c).trim().slice(0, 100) : '')).filter(Boolean).slice(0, 50)
      : [];

    let status = typeof item.status === 'string' ? item.status.trim().toLowerCase() : 'pending';
    if (existingAcceptedIds.has(id)) {
      status = 'accepted';
    } else if (status !== 'accepted' && status !== 'dismissed') {
      status = 'pending';
    }

    const normalized = {
      id,
      title,
      date,
      startTime,
      endTime,
      duration: Math.max(1, Math.min(1440, duration || 30)),
      type: rawType,
      description,
      source,
      collaborators,
      status
    };

    if (item.isDraft || source === 'Draft') {
      normalized.isDraft = true;
    }
    if (item.collaboratorIds) normalized.collaboratorIds = item.collaboratorIds;
    if (item.todoId) normalized.todoId = item.todoId;
    if (item.prepForEventId) normalized.prepForEventId = item.prepForEventId;
    if (item.noteId) normalized.noteId = item.noteId;
    if (item.linkedNoteIds) normalized.linkedNoteIds = item.linkedNoteIds;
    if (item.group_tags) normalized.group_tags = item.group_tags;
    if (item.major_topic_tags) normalized.major_topic_tags = item.major_topic_tags;
    if (item.topic_tags) normalized.topic_tags = item.topic_tags;

    if (isExplicitAllDay) {
      normalized.allDay = true;
    }

    // Keep the latest if duplicates exist in file
    dedupMap.set(id, normalized);
  });

  return Array.from(dedupMap.values());
}

async function loadPlannerProposals() {
  try {
    if (typeof StorageAPI !== 'undefined' && typeof StorageAPI.hasPlannerProposals === 'function' && await StorageAPI.hasPlannerProposals()) {
      const raw = await StorageAPI.readPlannerProposals();
      plannerProposals = normalizePlannerProposals(raw, plannerEvents);
    } else {
      plannerProposals = [];
      if (typeof StorageAPI !== 'undefined' && typeof StorageAPI.writePlannerProposals === 'function') {
        try {
          const defaultPayload = {
            _notice: "IMPORTANT FOR AGENTS: Do NOT delete or overwrite existing proposed events in this file. Only append new proposals. Secretary tracks processed/accepted proposals by their unique 'id' to prevent duplicate entries and calendar overlaps.",
            version: 1,
            proposals: []
          };
          await StorageAPI.writePlannerProposals(defaultPayload);
          _lastProposalsJSON = JSON.stringify(defaultPayload);
        } catch (initErr) {
          console.warn('Could not auto-create planner-proposals.json:', initErr);
        }
      }
    }
    if (typeof window !== 'undefined') {
      window.plannerProposals = plannerProposals;
    }
  } catch (err) {
    console.warn('Could not load planner-proposals.json:', err);
    plannerProposals = [];
  }
}

async function persistPlannerProposals() {
  try {
    if (typeof StorageAPI === 'undefined' || typeof StorageAPI.writePlannerProposals !== 'function') return;
    let existingRaw = null;
    if (typeof StorageAPI.hasPlannerProposals === 'function' && await StorageAPI.hasPlannerProposals()) {
      existingRaw = await StorageAPI.readPlannerProposals();
    }
    const notice = (existingRaw && existingRaw._notice) || "IMPORTANT FOR AGENTS: Do NOT delete or overwrite existing proposed events in this file. Only append new proposals. Secretary tracks processed/accepted proposals by their unique 'id' to prevent duplicate entries and calendar overlaps.";
    const version = (existingRaw && existingRaw.version) || 1;
    const payload = {
      _notice: notice,
      version,
      proposals: plannerProposals
    };
    await StorageAPI.writePlannerProposals(payload);
    _lastProposalsJSON = JSON.stringify(payload);
    broadcastSync({ type: 'PLANNER_PROPOSALS_UPDATED' });
  } catch (err) {
    console.warn('Failed to persist planner proposals:', err);
  }
}

function getPlannerProposals() {
  if (plannerProposals && plannerProposals.length > 0) return plannerProposals;
  if (typeof window !== 'undefined' && Array.isArray(window.plannerProposals) && window.plannerProposals.length > 0) {
    return window.plannerProposals;
  }
  return plannerProposals || [];
}

function setPlannerProposals(list) {
  plannerProposals = Array.isArray(list) ? list : [];
  if (typeof window !== 'undefined') {
    window.plannerProposals = plannerProposals;
  }
}

function togglePlannerProposalsView() {
  showPlannerProposals = !showPlannerProposals;
  if (typeof window !== 'undefined') {
    window.showPlannerProposals = showPlannerProposals;
  }
  if (typeof renderPlanner === 'function') {
    renderPlanner();
  }
}

function openPlanEventModalFromProposal(proposalId) {
  const proposal = getPlannerProposals().find(p => p.id === proposalId);
  if (!proposal) return;
  openPlanEventModal({
    title: proposal.title,
    date: proposal.date,
    startTime: proposal.startTime,
    endTime: proposal.endTime,
    type: proposal.type,
    context: proposal.context || proposal.description,
    collaborators: proposal.collaborators,
    collaboratorIds: proposal.collaboratorIds || [],
    todoId: proposal.todoId || '',
    prepForEventId: proposal.prepForEventId || '',
    noteId: proposal.noteId || '',
    linkedNoteIds: proposal.linkedNoteIds || [],
    group_tags: proposal.group_tags || [],
    major_topic_tags: proposal.major_topic_tags || [],
    topic_tags: proposal.topic_tags || [],
    _proposalId: proposal.id,
    _proposalSource: proposal.source,
    _isDraft: Boolean(proposal.isDraft || proposal.source === 'Draft')
  });
}

async function savePlannerProposals() {
  return await persistPlannerProposals();
}

async function quickAcceptPlannerProposal(proposalId) {
  const proposal = getPlannerProposals().find(p => p.id === proposalId);
  if (!proposal) return;
  const newEvent = {
    id: 'evt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    proposalId: proposal.id,
    title: proposal.title || 'Event',
    date: proposal.date,
    startTime: proposal.startTime,
    endTime: proposal.endTime,
    type: proposal.type || 'work',
    context: proposal.description || '',
    collaborators: proposal.collaborators ? [...proposal.collaborators] : [],
    collaboratorIds: [],
    linkedNoteIds: [],
    linkedTodoIds: []
  };
  if (typeof plannerEvents !== 'undefined' && Array.isArray(plannerEvents)) {
    plannerEvents.push(newEvent);
  }
  if (typeof window !== 'undefined' && Array.isArray(window.plannerEvents) && (!Array.isArray(plannerEvents) || window.plannerEvents !== plannerEvents)) {
    window.plannerEvents.push(newEvent);
  }
  await savePlanner();
  await markPlannerProposalAccepted(proposal.id);
  if (typeof renderPlanner === 'function') {
    renderPlanner();
  }
  toast(t('planner.proposalAccepted'));
}

async function dismissPlannerProposal(proposalId) {
  const proposals = getPlannerProposals();
  const proposal = proposals.find(p => p.id === proposalId);
  if (!proposal) return;
  const isDraft = proposal.isDraft || proposal.source === 'Draft';
  if (isDraft) {
    const idx = proposals.indexOf(proposal);
    if (idx >= 0) proposals.splice(idx, 1);
    setPlannerProposals(proposals);
    await persistPlannerProposals();
    toast(t('planner.draftDiscarded') || 'Draft discarded');
  } else {
    proposal.status = 'dismissed';
    await persistPlannerProposals();
    toast(t('planner.proposalDismissed') || 'Proposal dismissed');
  }
  if (typeof renderPlanner === 'function') {
    renderPlanner();
  }
}

async function markPlannerProposalAccepted(proposalId) {
  const proposal = getPlannerProposals().find(p => p.id === proposalId);
  if (proposal) {
    proposal.status = 'accepted';
  }
  await persistPlannerProposals();
}

// Set active start date based on view mode and given date
function initPlannerWeek(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  if (plannerViewMode === 'week') {
    const day = d.getDay();
    // Monday is 1, Sunday is 0. If Sunday, go back 6 days, otherwise go back day-1 days.
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    currentPlannerWeekStart = new Date(d.setDate(diff));
  } else {
    currentPlannerWeekStart = d;
  }
}

function getPlannerDaysToDisplay() {
  if (typeof plannerDisplayDateOverride !== 'undefined' && Array.isArray(plannerDisplayDateOverride) && plannerDisplayDateOverride.length > 0) {
    return plannerDisplayDateOverride
      .map(dateStr => parseLocalDateValue(dateStr))
      .filter(Boolean);
  }

  const startWeek = (typeof currentPlannerWeekStart !== 'undefined' && currentPlannerWeekStart) ? currentPlannerWeekStart : new Date();
  const startDate = new Date(startWeek);
  const activeWorkingDays = (typeof plannerWorkingDays !== 'undefined' && Array.isArray(plannerWorkingDays) && plannerWorkingDays.length > 0) ? plannerWorkingDays : [1, 2, 3, 4, 5];
  const viewMode = (typeof plannerViewMode !== 'undefined') ? plannerViewMode : 'week';

  if (viewMode === 'today') {
    return [new Date(startDate)];
  }

  const countNeeded = viewMode === '3days' ? 3 : viewMode === '5days' ? 5 : 7;

  if (viewMode === 'week') {
    const baseDate = new Date(startWeek);
    const weekDays = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(baseDate);
      d.setDate(baseDate.getDate() + i);
      if (!activeWorkingDays.includes(d.getDay())) continue;
      weekDays.push(d);
    }
    return weekDays;
  }

  const days = [];
  let curr = new Date(startDate);
  let iterations = 0;

  while (days.length < countNeeded && iterations < 30) {
    iterations++;
    if (activeWorkingDays.includes(curr.getDay())) {
      days.push(new Date(curr));
    }
    curr.setDate(curr.getDate() + 1);
  }
  return days;
}

function setPlannerViewMode(mode) {
  plannerViewMode = mode;
  try { localStorage.setItem('secretaryPlannerViewMode', mode); } catch (e) { }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (mode === 'today') {
    currentPlannerWeekStart = today;
  } else if (mode !== 'week') {
    // If the active week start matches the current week's Monday, default to today
    const currentWeekMon = new Date();
    const day = currentWeekMon.getDay();
    const diff = currentWeekMon.getDate() - day + (day === 0 ? -6 : 1);
    currentWeekMon.setDate(diff);
    currentWeekMon.setHours(0, 0, 0, 0);

    if (currentPlannerWeekStart && currentPlannerWeekStart.getTime() === currentWeekMon.getTime()) {
      currentPlannerWeekStart = today;
    } else if (!currentPlannerWeekStart) {
      currentPlannerWeekStart = today;
    }
  } else {
    initPlannerWeek(currentPlannerWeekStart || today);
  }
  renderPlanner();
}

function togglePlannerLeftSidebar() {
  plannerLeftSidebarCollapsed = !plannerLeftSidebarCollapsed;
  try { localStorage.setItem('secretaryPlannerLeftCollapsed', plannerLeftSidebarCollapsed ? '1' : '0'); } catch (e) { }
  renderPlanner();
}

function togglePlannerRightSidebar() {
  plannerRightSidebarCollapsed = !plannerRightSidebarCollapsed;
  try { localStorage.setItem('secretaryPlannerRightCollapsed', plannerRightSidebarCollapsed ? '1' : '0'); } catch (e) { }
  renderPlanner();
}

function setPlannerPaneTab(tab) {
  const allowed = new Set(['unassigned', 'notdone', 'details']);
  plannerActivePaneTab = allowed.has(tab) ? tab : 'unassigned';
  try { sessionStorage.setItem('secretaryPlannerActivePaneTab', plannerActivePaneTab); } catch (e) { }
  renderPlanner();
}

function _filterTodosBySideQueryAndPriority(todos) {
  return todos.filter(t => {
    if (_plannerSidePriorityFilter !== 'All') {
      if (['Q1', 'Q2', 'Q3', 'Q4'].includes(_plannerSidePriorityFilter)) {
        if (getTodoQuadrant(t) !== _plannerSidePriorityFilter) return false;
      } else if ((t.priority || 'Medium') !== _plannerSidePriorityFilter) {
        return false;
      }
    }
    if (_plannerSideSearchQuery) {
      const q = _plannerSideSearchQuery.toLowerCase();
      const title = (t.title || t.id || '').toLowerCase();
      if (!title.includes(q)) return false;
    }
    return true;
  });
}

function openPlanSyncModalForTodo(todoId) {
  const todo = (todosManifest || []).find(t => t.id === todoId);
  if (!todo) return;
  const cleanTitle = typeof getCleanTaskTitle === 'function' ? getCleanTaskTitle(todo) : (todo.title || todo.id);
  const title = `Sync: ${cleanTitle}`;
  const owner = todo.owner || '';
  openPlanEventModal({
    type: 'sync',
    title: title,
    todoId: todo.id,
    linkedTodoIds: [todo.id],
    withWhom: owner
  });
}

function _plannerTodoCardHTML(todo, { scheduledTodoIds = null, hideWhenScheduled = false, draggable = false } = {}) {
  const q = getTodoQuadrant(todo);
  const badgeCls = q === 'Q1' ? 'sl-badge-q1' : q === 'Q2' ? 'sl-badge-q2' : q === 'Q3' ? 'sl-badge-q3' : 'sl-badge-q4';
  const dueInfo = getTodoDueDateInfo(todo);
  const isScheduled = scheduledTodoIds ? scheduledTodoIds.has(todo.id) : false;
  const isHighStar = Boolean(todo.isHighPriority);
  const isManagerTask = typeof isAskedByManagerChain === 'function' && isAskedByManagerChain(todo);

  const plannerAssoc = typeof getTodoPlannerAssociations === 'function' ? getTodoPlannerAssociations(todo.id) : { workSessions: [], meetings: [] };
  const hasWorkSession = plannerAssoc.workSessions.length > 0;
  const hasMeeting = plannerAssoc.meetings.length > 0;
  const displayTitle = typeof getCleanTaskTitle === 'function' ? getCleanTaskTitle(todo) : (todo.title || todo.id);

  const dragAttrs = draggable
    ? `draggable="true" ondragstart="handlePlannerTodoDragStart(event, ${jq(todo.id)}, ${jq(displayTitle)})"`
    : '';

  const qIcons = {
    Q1: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    Q2: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>`,
    Q3: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
    Q4: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg>`
  };
  const qLabels = {
    Q1: `${t('todo.q1Short') || 'Do First'}`,
    Q2: `${t('todo.q2Short') || 'Schedule'}`,
    Q3: `${t('todo.q3Short') || 'Delegate'}`,
    Q4: `${t('todo.q4Short') || 'Eliminate'}`
  };
  const qIcon = qIcons[q] || '';
  const qLabel = qLabels[q] || q;

  const actionHtml = hideWhenScheduled && isScheduled
    ? `<span class="planner-todo-pill scheduled">${escH(_plannerText('planner.assigned', 'Assigned'))}</span>`
    : `
      <button class="planner-todo-card-btn btn-plan-work" onclick="event.stopPropagation(); quickScheduleTodo(${jq(todo.id)}, ${jq(displayTitle)})" title="${escA(t('todo.scheduleWorkSession'))}">+ Work</button>
      <button class="planner-todo-card-btn btn-plan-sync" onclick="event.stopPropagation(); openPlanSyncModalForTodo(${jq(todo.id)})" title="${escA(t('todo.scheduleSyncCall'))}">+ Sync</button>
    `;

  return `
    <div class="planner-todo-card${isHighStar ? ' todo-high-priority' : ''}${hasWorkSession || hasMeeting ? ' todo-commitment-ring' : ''}${dueInfo ? ` ${dueInfo.urgencyClass}` : ''}" ${dragAttrs}
      onclick="openTodoOverlay(${jq(todo.id)})"
      oncontextmenu="return showTodoCardContextMenu(event, ${jq(todo.id)})"
      title="${escA(t('todo.clickToOpen'))}">
      <div class="planner-todo-card-title">${isHighStar ? '<span class="planner-star-icon" title="Priority"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></span> ' : ''}${escH(displayTitle)}</div>
      ${isManagerTask ? `<div style="font-size:0.62rem; color:#92400e; font-weight:700; margin-top:2px;">${escH(t('todo.fromManager') || 'Manager Requested')}</div>` : ''}
      ${dueInfo ? `<div class="planner-todo-card-due ${escA(dueInfo.urgencyClass)}"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> ${escH(dueInfo.date)} ${escH(dueInfo.bracket)}</div>` : ''}
      <div class="planner-todo-card-footer" style="margin-top:4px;">
        <span class="planner-todo-card-badge ${badgeCls}" style="font-weight:700;">${qIcon ? `<span class="planner-side-pill-icon">${qIcon}</span> ` : ''}${escH(qLabel)}</span>
        <div style="display:flex; gap:3px;">${actionHtml}</div>
      </div>
    </div>
  `;
}

function getPlannerNotDoneTodos() {
  const base = todosManifest.filter(t => t.priority !== 'Done' && isUserTask(t));
  return _filterTodosBySideQueryAndPriority(base);
}

function getPlannerActiveScheduledTodoIds() {
  const todayStr = formatLocalDateValue(new Date());
  const ids = new Set();
  plannerEvents
    .filter(e => e && e.date && e.date >= todayStr)
    .forEach(e => {
      if (e.type === 'todo' && e.todoId) ids.add(String(e.todoId));
      getPlannerEventLinkedTodoIds(e, { includePrimary: false }).forEach(id => ids.add(String(id)));
    });
  return ids;
}

function getPlannerUnassignedTodos() {
  const scheduledTodoIds = getPlannerActiveScheduledTodoIds();
  const base = todosManifest.filter(t => t.priority !== 'Done' && isUserTask(t) && !scheduledTodoIds.has(t.id));
  return _filterTodosBySideQueryAndPriority(base);
}

function _plannerOnSideSearchInput(val) {
  _plannerSideSearchQuery = String(val || '').trim();
  renderPlannerSidePaneContent();
}

function _plannerSetSidePriority(prio) {
  _plannerSidePriorityFilter = prio;
  renderPlanner();
}

window._plannerOnSideSearchInput = _plannerOnSideSearchInput;
window._plannerSetSidePriority = _plannerSetSidePriority;

function _plannerText(key, fallback) {
  const v = t(key);
  return (!v || v === key) ? fallback : v;
}

function _plannerTabLabel(base, count) {
  return `${base} (${count})`;
}

function _initPlannerPaneResizeHandle() {
  const handle = document.getElementById('planner-pane-resize-handle');
  const panel = document.getElementById('planner-panel');
  const sidePane = document.querySelector('.planner-sidebar-right');
  if (!handle || !panel || !sidePane) return;

  if (plannerRightSidebarCollapsed) {
    handle.classList.add('collapsed-toggle');
    handle.onmousedown = null;
    handle.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (plannerRightSidebarCollapsed) {
        togglePlannerRightSidebar();
      }
    };
    return;
  }

  const st = window._plannerPaneResizeState || {
    dragging: false,
    panelRect: null,
    handle: null,
    panel: null,
    sidePane: null,
    bound: false
  };

  handle.classList.remove('collapsed-toggle');
  handle.onclick = null;
  st.handle = handle;
  st.panel = panel;
  st.sidePane = sidePane;
  window._plannerPaneResizeState = st;

  handle.onmousedown = e => {
    st.dragging = true;
    st.panelRect = st.panel.getBoundingClientRect();
    st.handle.classList.add('dragging');
    document.body.classList.add('planner-pane-resizing');
    e.preventDefault();
  };

  if (st.bound) return;
  st.bound = true;

  document.addEventListener('mousemove', e => {
    if (!st.dragging || !st.panelRect || !st.sidePane) return;
    const minW = 240;
    const maxW = Math.max(300, Math.floor(st.panelRect.width * 0.45));
    const next = st.panelRect.right - e.clientX;
    const width = Math.max(minW, Math.min(maxW, next));
    plannerRightPaneWidth = Math.round(width);
    st.sidePane.style.width = `${plannerRightPaneWidth}px`;
  });

  document.addEventListener('mouseup', () => {
    if (!st.dragging) return;
    st.dragging = false;
    if (st.handle) st.handle.classList.remove('dragging');
    document.body.classList.remove('planner-pane-resizing');
    try { sessionStorage.setItem('secretaryPlannerRightPaneWidth', String(plannerRightPaneWidth)); } catch (e) { }
  });
}

function renderPlannerSidePaneContent() {
  const unassignedContainer = document.getElementById('planner-pane-tab-unassigned');
  const notDoneContainer = document.getElementById('planner-pane-tab-notdone');
  if (unassignedContainer) renderUnscheduledTodos(unassignedContainer);
  if (notDoneContainer) renderNotDoneTodos(notDoneContainer);

  const unassignedBtn = document.getElementById('planner-tab-btn-unassigned');
  const notDoneBtn = document.getElementById('planner-tab-btn-notdone');
  if (unassignedBtn) {
    const unassigned = getPlannerUnassignedTodos();
    unassignedBtn.textContent = _plannerTabLabel(_plannerText('planner.plannedTasksTab', 'Planned Tasks'), unassigned.length);
  }
  if (notDoneBtn) {
    const notDone = getPlannerNotDoneTodos();
    notDoneBtn.textContent = _plannerTabLabel(_plannerText('planner.tasksTab', 'Tasks'), notDone.length);
  }

  renderPlannerInspector();
}

let _plannerTypeFilter = null; // null | 'call' | 'work' | 'prep'

function togglePlannerTypeFilter(type) {
  if (_plannerTypeFilter === type) {
    _plannerTypeFilter = null;
  } else {
    _plannerTypeFilter = type;
  }
  renderPlanner();
}
window.togglePlannerTypeFilter = togglePlannerTypeFilter;

function duplicatePlannerEventById(id) {
  const evt = plannerEvents.find(e => e.id === id);
  if (!evt) return;
  pushPlannerUndoState('Duplicate event');
  const clone = JSON.parse(JSON.stringify(evt));
  clone.id = 'evt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  const startMins = timeToMinutes(clone.startTime);
  const endMins = timeToMinutes(clone.endTime);
  const dur = (endMins > startMins) ? (endMins - startMins) : 30;
  clone.startTime = minutesToTime(Math.min(1440 - dur, endMins));
  clone.endTime = minutesToTime(Math.min(1440, endMins + dur));
  plannerEvents.push(clone);
  savePlanner();
  renderPlanner();
  toast(t('planner.quickDuplicate') || 'Event duplicated');
}
window.duplicatePlannerEventById = duplicatePlannerEventById;

async function openPlannerLinkedNote(noteId) {
  const note = manifest.find(n => n.id === noteId);
  if (note && typeof openNoteOverlay === 'function') {
    const linkedEvent = (Array.isArray(plannerEvents) ? plannerEvents : []).find(e => e && (String(e.noteId || '').trim() === String(noteId).trim() || (Array.isArray(e.linkedNoteIds) && e.linkedNoteIds.includes(noteId))));
    if (linkedEvent && typeof syncTagsBetweenBlocAndNote === 'function') {
      await syncTagsBetweenBlocAndNote(linkedEvent, note);
    }
    openNoteOverlay(note.path, null, null, false, null, { collapseMetadata: true, fromBloc: true, sourceEvent: linkedEvent || null });
  }
}
window.openPlannerLinkedNote = openPlannerLinkedNote;

function _getPlannerIsoWeekNumber(d) {
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setUTCMonth(0, 1);
  if (target.getUTCDay() !== 4) {
    target.setUTCMonth(0, 1 + ((4 - target.getUTCDay()) + 7) % 7);
  }
  return 1 + Math.ceil((firstThursday - target) / 604800000);
}

// Main render entry point
function renderPlanner() {
  const panel = document.getElementById('planner-panel');
  if (!panel) return;

  if (window.syncFloatingChatContext) window.syncFloatingChatContext();

  const scrollEl = document.querySelector('.planner-calendar-scroll');
  let oldScrollTop = scrollEl ? scrollEl.scrollTop : null;
  let oldScrollLeft = scrollEl ? scrollEl.scrollLeft : null;

  if (oldScrollTop === null || oldScrollTop === 0) {
    const savedTop = sessionStorage.getItem('secretaryPlannerScrollTop');
    if (savedTop) oldScrollTop = parseInt(savedTop, 10);
  }
  if (oldScrollLeft === null || oldScrollLeft === 0) {
    const savedLeft = sessionStorage.getItem('secretaryPlannerScrollLeft');
    if (savedLeft) oldScrollLeft = parseInt(savedLeft, 10);
  }

  if (typeof currentPlannerWeekStart === 'undefined' || !currentPlannerWeekStart) {
    if (typeof initPlannerWeek === 'function') initPlannerWeek();
  }

  const activeWeekStart = (typeof currentPlannerWeekStart !== 'undefined' && currentPlannerWeekStart) ? currentPlannerWeekStart : new Date();
  const daysToDisplay = getPlannerDaysToDisplay().map(d => formatLocalDateValue(d));
  precreateRecurringEventsForWeek(daysToDisplay);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const prevDate = new Date(activeWeekStart);
  prevDate.setDate(activeWeekStart.getDate() - 1);
  prevDate.setHours(0, 0, 0, 0);

  const nextDate = new Date(activeWeekStart);
  nextDate.setDate(activeWeekStart.getDate() + 1);
  nextDate.setHours(0, 0, 0, 0);

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  const locale = getAppLocale();

  let prevLabel = '';
  let nextLabel = '';
  let prevOffset = -7;
  let nextOffset = 7;
  let prevTitle = t('planner.prevWeekTooltip');
  let nextTitle = t('planner.nextWeekTooltip');

  if (plannerViewMode === 'week') {
    prevLabel = t('planner.prevWeek');
    nextLabel = t('planner.nextWeek');
  } else {
    prevOffset = -1;
    nextOffset = 1;

    if (prevDate.getTime() === today.getTime()) {
      prevLabel = `‹ ${t('planner.today')}`;
    } else if (prevDate.getTime() === yesterday.getTime()) {
      prevLabel = `‹ ${t('planner.yesterday')}`;
    } else {
      prevLabel = `‹ ${new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(prevDate)}`;
    }
    prevTitle = t('planner.prevDayTooltip');

    if (nextDate.getTime() === today.getTime()) {
      nextLabel = `${t('planner.today')} ›`;
    } else if (nextDate.getTime() === tomorrow.getTime()) {
      nextLabel = `${t('planner.tomorrow')} ›`;
    } else {
      nextLabel = `${new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(nextDate)} ›`;
    }
    nextTitle = t('planner.nextDayTooltip');
  }

  // Clear context menus
  closePlannerContextMenu();

  const rightToggleText = plannerRightSidebarCollapsed ? '‹' : '›';
  const unassigned = getPlannerUnassignedTodos();
  const notDone = getPlannerNotDoneTodos();
  const tabUnassigned = _plannerTabLabel(_plannerText('planner.plannedTasksTab', 'Planned Tasks'), unassigned.length);
  const tabNotDone = _plannerTabLabel(_plannerText('planner.tasksTab', 'Tasks'), notDone.length);
  const tabDetails = _plannerText('planner.eventDetails', 'Block Details');
  const hasSelectedBlock = !!selectedPlannerEventId && !!plannerEvents.find(e => e.id === selectedPlannerEventId);
  if (hasSelectedBlock) {
    plannerActivePaneTab = 'details';
  } else if (plannerActivePaneTab === 'details') {
    plannerActivePaneTab = 'unassigned';
  }
  const panelWidth = Math.max(0, panel.clientWidth || window.visualViewport?.width || window.innerWidth || 0);
  const paneMaxWidth = Math.max(220, Math.floor(panelWidth * 0.45));
  const paneWidth = Math.max(180, Math.min(paneMaxWidth, plannerRightPaneWidth || 320));

  const stats = getPlannerWeeklyStats();

  const pendingProposalsCount = (Array.isArray(plannerProposals) ? plannerProposals : []).filter(p => {
    if (!p || p.status !== 'pending') return false;
    if ((plannerEvents || []).some(e => e && e.proposalId === p.id)) return false;
    return true;
  }).length;

  // Create Main Calendar Area + Unified Right Sidebar (Tabbed)
  panel.innerHTML = `
    <div class="planner-main-content">
      <div class="planner-stats-bar" role="toolbar" aria-label="${escA(t('planner.totalPlanned') || 'Statistics')}">
        <div class="planner-stat-item stat-total${_plannerTypeFilter === null ? ' active' : ''}" onclick="togglePlannerTypeFilter(null)" title="${escA(t('planner.showAllFilterTooltip') || 'Show all planned events and reset category filter')}">
          <span class="planner-stat-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></span>
          <span>${escH(t('planner.totalPlanned') || 'Total')}:</span>
          <span class="planner-stat-val">${stats.totalHours}h</span>
        </div>
        <div class="planner-stat-item stat-call${_plannerTypeFilter === 'call' ? ' active' : ''}" onclick="togglePlannerTypeFilter('call')" title="${escA(t('planner.filterCallTooltip') || 'Click to highlight Calls only (or click again to show all)')}">
          <span class="planner-stat-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg></span>
          <span>${escH(t('planner.callHours') || 'Calls')}:</span>
          <span class="planner-stat-val">${stats.callHours}h</span>
        </div>
        <div class="planner-stat-item stat-work${_plannerTypeFilter === 'work' ? ' active' : ''}" onclick="togglePlannerTypeFilter('work')" title="${escA(t('planner.filterWorkTooltip') || 'Click to highlight Focus Work only (or click again to show all)')}">
          <span class="planner-stat-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="2" y1="20" x2="22" y2="20"/></svg></span>
          <span>${escH(t('planner.workHours') || 'Work')}:</span>
          <span class="planner-stat-val">${stats.workHours}h</span>
        </div>
        <div class="planner-stat-item stat-prep${_plannerTypeFilter === 'prep' ? ' active' : ''}" onclick="togglePlannerTypeFilter('prep')" title="${escA(t('planner.filterPrepTooltip') || 'Click to highlight Prep only (or click again to show all)')}">
          <span class="planner-stat-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg></span>
          <span>${escH(t('planner.prepHours') || 'Prep')}:</span>
          <span class="planner-stat-val">${stats.prepHours}h</span>
        </div>
      </div>
      <div class="planner-header">
        <div class="planner-header-left">
          <div class="planner-week-title" id="planner-week-range-title"></div>
          
          <div class="planner-view-switcher">
            <button class="planner-view-btn${plannerViewMode === 'today' ? ' active' : ''}" onclick="setPlannerViewMode('today')" title="${escA(t('planner.viewTodayTooltip'))}">${t('planner.viewToday')}</button>
            <button class="planner-view-btn${plannerViewMode === '3days' ? ' active' : ''}" onclick="setPlannerViewMode('3days')" title="${escA(t('planner.view3DaysTooltip'))}">${t('planner.view3Days')}</button>
            <button class="planner-view-btn${plannerViewMode === '5days' ? ' active' : ''}" onclick="setPlannerViewMode('5days')" title="${escA(t('planner.view5DaysTooltip'))}">${t('planner.view5Days')}</button>
            <button class="planner-view-btn${plannerViewMode === 'week' ? ' active' : ''}" onclick="setPlannerViewMode('week')" title="${escA(t('planner.viewWeekTooltip'))}">${t('planner.viewWeek')}</button>
          </div>
        </div>

        <div class="planner-nav-group">
          ${(pendingProposalsCount > 0 || showPlannerProposals) ? `
            <button type="button" class="planner-nav-btn planner-proposals-toggle-btn${showPlannerProposals ? ' active' : ''}${pendingProposalsCount > 0 && !showPlannerProposals ? ' pulsing' : ''}" onclick="togglePlannerProposalsView()" title="${escA(t('planner.toggleProposalsTooltip'))}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>
              <span class="planner-proposals-text">${escH(t('planner.proposalsLabel'))}</span>
              <span class="planner-proposals-badge-count">${pendingProposalsCount}</span>
            </button>
          ` : ''}
          <button class="planner-nav-btn" onclick="navigatePlannerWeek(${prevOffset})" title="${escA(prevTitle)}">${prevLabel}</button>
          <button class="planner-nav-btn" onclick="navigatePlannerWeek(0)" title="${escA(t('planner.todayTooltip'))}">${t('planner.today')}</button>
          <button class="planner-nav-btn" onclick="navigatePlannerWeek(${nextOffset})" title="${escA(nextTitle)}">${nextLabel}</button>
          <button class="planner-nav-btn planner-more-btn" id="planner-more-menu-btn" onclick="togglePlannerMoreDropdown(event)" title="${escA(t('planner.moreOptionsTooltip') || t('planner.moreOptions') || 'More options')}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/><circle cx="5" cy="12" r="1.5"/></svg></button>
        </div>
      </div>

      <div class="planner-calendar-scroll">
        <div class="planner-calendar-grid" id="planner-grid-body">
          <!-- Rendered by renderCalendarGrid() -->
        </div>
      </div>
    </div>

    <div class="planner-pane-resize-handle${plannerRightSidebarCollapsed ? ' collapsed-toggle' : ''}" id="planner-pane-resize-handle" title="${escA(plannerRightSidebarCollapsed ? (t('planner.reopenRightSidebarTooltip') || 'Reopen planner side pane') : _plannerText('planner.resizeSidePane', 'Resize planner side pane'))}"></div>

    <div class="planner-sidebar-right planner-sidebar-combined collapsible-sidebar${plannerRightSidebarCollapsed ? ' collapsed' : ''}"${plannerRightSidebarCollapsed ? ` onclick="togglePlannerRightSidebar()"` : ` style="width:${paneWidth}px"`} title="${escA(plannerRightSidebarCollapsed ? (t('common.expandSidebar') || 'Click to expand sidebar') : '')}">
      <div class="planner-sidebar-header">
        ${plannerRightSidebarCollapsed ? `
          <button class="planner-sidebar-toggle" onclick="event.stopPropagation(); togglePlannerRightSidebar()" title="${escA(t('common.expandSidebar') || 'Click to expand sidebar')}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span class="sidebar-header-title">${escH(_plannerText('planner.panel', 'Planner'))}</span>
        ` : `
          <button class="planner-sidebar-contract-btn" onclick="event.stopPropagation(); togglePlannerRightSidebar()" title="${escA(t('common.collapseSidebar') || 'Click to collapse sidebar')}">
            <span class="planner-sidebar-contract-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </span>
            <span class="planner-sidebar-contract-title">${escH(_plannerText('planner.panel', 'Planner'))}</span>
          </button>
          <button class="planner-sidebar-balance-btn" onclick="event.stopPropagation(); triggerPlannerAutoBalance()" title="${escA(t('planner.autoBalanceTooltip') || 'Automatically fit unassigned priority tasks into free time gaps')}">
            <span class="planner-sidebar-balance-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/></svg>
            </span>
            <span class="planner-sidebar-balance-label">${escH(t('planner.autoBalance') || 'Auto-Balance')}</span>
          </button>
        `}
      </div>
      <div class="planner-sidebar-content" onclick="event.stopPropagation()">
        <div class="md-tabs planner-pane-tabs${hasSelectedBlock ? ' single' : ' dual'}" role="tablist" aria-label="${escA(_plannerText('planner.sideTabsAriaLabel', 'Planner side tabs'))}">
          ${hasSelectedBlock
      ? `<button class="md-tab planner-pane-tab-btn active" id="planner-tab-btn-details" role="tab" aria-selected="true" onclick="setPlannerPaneTab('details')" title="${escA(t('planner.viewDetailsTabTooltip') || 'View selected event details')}">${escH(tabDetails)}</button>`
      : `<button class="md-tab planner-pane-tab-btn${plannerActivePaneTab === 'unassigned' ? ' active' : ''}" id="planner-tab-btn-unassigned" role="tab" aria-selected="${plannerActivePaneTab === 'unassigned' ? 'true' : 'false'}" onclick="setPlannerPaneTab('unassigned')" title="${escA(t('planner.viewPlannedTasksTooltip') || 'View tasks scheduled in planner')}">${escH(tabUnassigned)}</button>
               <button class="md-tab planner-pane-tab-btn${plannerActivePaneTab === 'notdone' ? ' active' : ''}" id="planner-tab-btn-notdone" role="tab" aria-selected="${plannerActivePaneTab === 'notdone' ? 'true' : 'false'}" onclick="setPlannerPaneTab('notdone')" title="${escA(t('planner.viewNotDoneTasksTooltip') || 'View unscheduled tasks backlog')}">${escH(tabNotDone)}</button>`
    }
        </div>
        ${!hasSelectedBlock ? `
          <div class="planner-side-search-wrap" style="margin-top: 0.35rem;">
            <input type="text" class="planner-side-search-input" id="planner-side-search-input"
              placeholder="${escA(t('planner.searchTodoPlaceholder') || 'Search tasks...')}" value="${escA(_plannerSideSearchQuery)}"
              oninput="_plannerOnSideSearchInput(this.value)">
            <div class="planner-side-pills" role="tablist" aria-label="${escA(t('planner.filterPriorityAllTooltip') || 'Filter tasks by priority')}">
              <button type="button" role="tab" class="planner-side-pill${_plannerSidePriorityFilter === 'All' ? ' active' : ''}" onclick="_plannerSetSidePriority('All')" title="${escA(t('planner.filterPriorityAllTooltip') || 'Show all tasks')}">${escH(t('team.filterAll') || 'All')}</button>
              <button type="button" role="tab" class="planner-side-pill pill-q1${_plannerSidePriorityFilter === 'Q1' ? ' active' : ''}" onclick="_plannerSetSidePriority('Q1')" title="${escA(t('planner.filterPriorityQ1Tooltip') || 'Filter by Q1: Do First')}"><span class="planner-side-pill-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></span> ${escH(t('todo.q1Short') || 'Do First')}</button>
              <button type="button" role="tab" class="planner-side-pill pill-q2${_plannerSidePriorityFilter === 'Q2' ? ' active' : ''}" onclick="_plannerSetSidePriority('Q2')" title="${escA(t('planner.filterPriorityQ2Tooltip') || 'Filter by Q2: Schedule')}"><span class="planner-side-pill-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg></span> ${escH(t('todo.q2Short') || 'Schedule')}</button>
              <button type="button" role="tab" class="planner-side-pill pill-q3${_plannerSidePriorityFilter === 'Q3' ? ' active' : ''}" onclick="_plannerSetSidePriority('Q3')" title="${escA(t('planner.filterPriorityQ3Tooltip') || 'Filter by Q3: Delegate')}"><span class="planner-side-pill-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></span> ${escH(t('todo.q3Short') || 'Delegate')}</button>
              <button type="button" role="tab" class="planner-side-pill pill-q4${_plannerSidePriorityFilter === 'Q4' ? ' active' : ''}" onclick="_plannerSetSidePriority('Q4')" title="${escA(t('planner.filterPriorityQ4Tooltip') || 'Filter by Q4: Eliminate')}"><span class="planner-side-pill-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg></span> ${escH(t('todo.q4Short') || 'Eliminate')}</button>
            </div>
          </div>
        ` : ''}
        <div class="planner-pane-tab-content">
          <div id="planner-pane-tab-unassigned" class="planner-pane-tab-panel${!hasSelectedBlock && plannerActivePaneTab === 'unassigned' ? ' active' : ''}"></div>
          <div id="planner-pane-tab-notdone" class="planner-pane-tab-panel${!hasSelectedBlock && plannerActivePaneTab === 'notdone' ? ' active' : ''}"></div>
          <div id="planner-right-sidebar-inspector" class="planner-pane-tab-panel${hasSelectedBlock ? ' active' : ''}"></div>
        </div>
      </div>
    </div>
  `;

  renderCalendarGrid();
  _initPlannerPaneResizeHandle();
  if (!plannerRightSidebarCollapsed) {
    renderPlannerSidePaneContent();
  }

  // Scroll to current time / today on initial render only
  if (!window._plannerInitialScrollDone) {
    requestAnimationFrame(() => {
      const focusDateStr = (typeof plannerInitialFocusDate !== 'undefined' ? plannerInitialFocusDate : null) || formatLocalDateValue(new Date());
      const focusCol = document.querySelector(`.planner-day-col[data-date="${focusDateStr}"]`);
      const scroll = document.querySelector('.planner-calendar-scroll');
      if (scroll) {
        const workStartMin = timeToMinutes(workStartTime || '09:00');
        const scrollTarget = Math.max(0, workStartMin * (80 / 60) - 20);
        scroll.scrollTop = scrollTarget;
      }
      if (focusCol) {
        focusCol.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
      window._plannerInitialScrollDone = true;
    });
  } else {
    const scroll = document.querySelector('.planner-calendar-scroll');
    if (scroll) {
      if (oldScrollTop !== null) scroll.scrollTop = oldScrollTop;
      if (oldScrollLeft !== null) scroll.scrollLeft = oldScrollLeft;
    }
  }

  // Register scroll listener to save scroll positions
  requestAnimationFrame(() => {
    const scroll = document.querySelector('.planner-calendar-scroll');
    if (scroll) {
      scroll.addEventListener('scroll', () => {
        if (scroll.scrollTop > 0) {
          sessionStorage.setItem('secretaryPlannerScrollTop', scroll.scrollTop);
        }
        if (scroll.scrollLeft > 0) {
          sessionStorage.setItem('secretaryPlannerScrollLeft', scroll.scrollLeft);
        }
      });
    }
  });
}


// Navigate week
function navigatePlannerWeek(daysOffset) {
  if (daysOffset === 0) {
    initPlannerWeek(new Date());
  } else {
    const nextStart = new Date(currentPlannerWeekStart);
    nextStart.setDate(currentPlannerWeekStart.getDate() + daysOffset);
    currentPlannerWeekStart = nextStart;
  }
  renderPlanner();
}

function _renderPlannerVirtualizedTodoList(container, todos, options = {}) {
  const rowHeight = Number(options.rowHeight || 112);
  const overscan = Number(options.overscan || 8);
  const scheduledTodoIds = options.scheduledTodoIds || null;
  const hideWhenScheduled = options.hideWhenScheduled === true;
  const draggable = options.draggable === true;

  container.innerHTML = `
    <div class="planner-virtual-list">
      <div class="planner-virtual-spacer"></div>
      <div class="planner-virtual-window"></div>
    </div>
  `;

  const listEl = container.querySelector('.planner-virtual-list');
  const spacerEl = container.querySelector('.planner-virtual-spacer');
  const windowEl = container.querySelector('.planner-virtual-window');
  if (!listEl || !spacerEl || !windowEl) return;

  const total = todos.length;
  spacerEl.style.height = `${total * rowHeight}px`;

  const renderWindow = () => {
    const scrollTop = listEl.scrollTop;
    const viewport = Math.max(200, listEl.clientHeight || 0);
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const end = Math.min(total, Math.ceil((scrollTop + viewport) / rowHeight) + overscan);
    const visible = todos.slice(start, end);

    windowEl.style.transform = `translateY(${start * rowHeight}px)`;
    windowEl.innerHTML = visible.map(todo => _plannerTodoCardHTML(todo, {
      scheduledTodoIds,
      hideWhenScheduled,
      draggable,
    })).join('');
  };

  listEl.addEventListener('scroll', renderWindow, { passive: true });
  requestAnimationFrame(renderWindow);
}

// ── Left Sidebar: Unscheduled Todos ──
function renderUnscheduledTodos(container = null) {
  if (!container) container = document.getElementById('planner-pane-tab-unassigned');
  if (!container) return;

  const uncompletedTodos = getPlannerUnassignedTodos();

  if (!uncompletedTodos.length) {
    container.innerHTML = `<div class="sidebar-empty">${escH(t('common.noMatchingTodos'))}</div>`;
    return;
  }

  const sortedTodos = [...uncompletedTodos].sort(compareTodosByDueDate);
  _renderPlannerVirtualizedTodoList(container, sortedTodos, {
    draggable: true,
    hideWhenScheduled: false,
  });
}

function renderNotDoneTodos(container = null) {
  if (!container) container = document.getElementById('planner-pane-tab-notdone');
  if (!container) return;

  const allNotDone = getPlannerNotDoneTodos();
  if (!allNotDone.length) {
    container.innerHTML = `<div class="sidebar-empty">${escH(t('common.noMatchingTodos'))}</div>`;
    return;
  }

  const scheduledTodoIds = getPlannerActiveScheduledTodoIds();

  const sortedTodos = [...allNotDone].sort(compareTodosByDueDate);
  _renderPlannerVirtualizedTodoList(container, sortedTodos, {
    scheduledTodoIds,
    hideWhenScheduled: true,
    draggable: false,
  });
}

// Quick schedule action from the sidebar list
function quickScheduleTodo(todoId, todoTitle) {
  const cleanTitle = (typeof cleanTaskTitleText === 'function') ? cleanTaskTitleText(todoTitle) : (todoTitle || '');
  // Finds the first free slot starting today or during the visible week
  const todayStr = formatLocalDateValue(new Date());
  const eventDate = todayStr; // default to today
  openPlanEventModal({
    type: 'todo',
    title: cleanTitle,
    todoId: todoId,
    date: eventDate,
    startTime: '10:00',
    endTime: '10:30'
  });
}

// ── Calendar Grid Area ──
function renderCalendarGrid() {
  const grid = document.getElementById('planner-grid-body');
  const weekTitle = document.getElementById('planner-week-range-title');
  if (!grid || !weekTitle) return;

  const days = getPlannerDaysToDisplay();
  const locale = getAppLocale();

  // Set header date range title dynamically based on days shown
  if (days.length === 0) {
    weekTitle.innerHTML = '';
  } else if (days.length === 1) {
    const d = days[0];
    const options = { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' };
    weekTitle.innerHTML = `<span>${escH(new Intl.DateTimeFormat(locale, options).format(d))}</span>`;
  } else {
    const startStr = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(days[0]);
    const endStr = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(days[days.length - 1]);
    const year = days[0].getFullYear();
    const weekNum = _getPlannerIsoWeekNumber(days[0]);
    weekTitle.innerHTML = `<span>${escH(startStr)} – ${escH(endStr)}, ${year}</span> <span class="badge badge-subtle" style="font-size:0.75rem; padding:2px 7px; border-radius:10px; font-weight:600; background:color-mix(in srgb, var(--accent) 12%, var(--card-bg)); color:var(--accent); margin-left:6px;" title="Week ${weekNum}">W${weekNum}</span>`;
  }

  // Set dynamic grid styles
  grid.style.gridTemplateColumns = `50px repeat(${days.length}, 1fr)`;
  grid.style.minWidth = `calc(50px + ${days.length} * 180px)`;

  const todayStr = formatLocalDateValue(new Date());

  // 1. Column headers
  let gridHTML = `<div class="planner-header-cell-spacer"></div>`;
  const dayNames = t('week.dayNames') || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  days.forEach(colDate => {
    const colDateStr = formatLocalDateValue(colDate);
    const isToday = colDateStr === todayStr;
    const isReviewed = isDailyReviewDateReviewed(colDateStr);
    const isFuture = colDateStr > todayStr;
    // Map Javascript day index (0=Sun, 1=Mon...) to dayNames list (0=Mon...6=Sun)
    const jsDay = colDate.getDay();
    const dayName = dayNames[jsDay === 0 ? 6 : jsDay - 1] || '';
    const dateNum = colDate.getDate();

    // Compute day capacity score
    const { plannedMins, availableMins } = _getDayCapacity(colDateStr);
    const plannedH = (plannedMins / 60).toFixed(1).replace('.0', '');
    const availableH = (availableMins / 60).toFixed(1).replace('.0', '');
    const ratio = availableMins > 0 ? Math.min(1, plannedMins / availableMins) : 0;
    const percentage = Math.round(ratio * 100);
    const hue = Math.round(120 - ratio * 120);
    const scoreCls = ratio >= 1 ? 'phc-full' : ratio >= 0.75 ? 'phc-high' : ratio >= 0.4 ? 'phc-mid' : 'phc-low';

    // Check if this day is fully covered by all-day OOO events
    const coveringOooHeaders = (typeof plannerEvents !== 'undefined' && Array.isArray(plannerEvents))
      ? plannerEvents.filter(ev => ev.type === 'ooo' && (ev.allDay || (!ev.startTime && !ev.endTime)) && colDateStr >= ev.date && colDateStr <= (ev.endDate || ev.date))
      : [];
    const isCoveredByOoo = (typeof isDateCoveredByOoo === 'function')
      ? isDateCoveredByOoo(colDateStr)
      : (coveringOooHeaders.length > 0);
    const oooHeaderBanner = coveringOooHeaders.map(coveringOooHeader => `
      <div class="planner-ooo-allday-banner" title="${escA(coveringOooHeader.title || 'Out of Office')}" onclick="event.stopPropagation(); selectPlannerEvent(${jq(coveringOooHeader.id)})" ondblclick="event.stopPropagation(); openPlanEventModal(plannerEvents.find(e => e.id === ${jq(coveringOooHeader.id)}) || {})" role="button" tabindex="0">
        <span class="ooo-banner-icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 8c0-2.76-2.46-5-5.5-5S2 5.24 2 8h11z"/><path d="M13 7.14A5.82 5.82 0 0 1 16.5 6c3.04 0 5.5 2.24 5.5 5h-11"/><path d="M5.8 15.5c1.5 1.5 3.7 2.5 6.2 2.5s4.7-1 6.2-2.5"/><path d="M12 10v12"/></svg></span> <span class="ooo-banner-label">${escH(t('planner.oooFullDayBanner') || 'Out of Office')}: ${escH(coveringOooHeader.title || 'Out of Office')}</span>
      </div>
    `).join('');

    const reviewedCheckmarkHtml = isCoveredByOoo ? `
      <button type="button" class="planner-header-reviewed ooo-reviewed"
        onclick="event.stopPropagation();"
        title="${escA(t('planner.oooDayAutoReviewedTooltip') || 'Out of Office (automatically reviewed)')}"
        aria-label="${escA(t('planner.oooDayAutoReviewedTooltip') || 'Out of Office (automatically reviewed)')}">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      </button>
    ` : ((isReviewed || !isFuture) ? `
      <button type="button" class="planner-header-reviewed${isReviewed ? '' : ' unreviewed'}"
        onclick="event.stopPropagation(); ${isReviewed ? `window.startDailyReview('${colDateStr}', 5)` : `window.startDailyReview('${colDateStr}')`}"
        title="${escA(t(isReviewed ? 'planner.openDailyReviewNoteTooltip' : 'retro.reviewDayTooltip'))}"
        aria-label="${escA(t(isReviewed ? 'planner.openDailyReviewNoteTooltip' : 'retro.reviewDayTooltip'))}">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      </button>
    ` : '');

    const cellReviewClickAttr = (!isFuture && !isCoveredByOoo) ? ` onclick="${isReviewed ? `window.startDailyReview('${colDateStr}', 5)` : `window.startDailyReview('${colDateStr}')`}"` : '';
    const cellReviewTitle = isCoveredByOoo
      ? ` title="${escA(t('planner.oooDayAutoReviewedTooltip') || 'Out of Office (automatically reviewed)')}"`
      : (!isFuture ? ` title="${escA(t(isReviewed ? 'planner.openDailyReviewNoteTooltip' : 'retro.reviewDayTooltip'))}"` : '');

    gridHTML += `
      <div class="planner-header-cell${isToday ? ' today' : ''}${isReviewed ? ' reviewed' : ''}${(!isFuture && !isCoveredByOoo) ? ' reviewable' : ''}${isCoveredByOoo ? ' is-ooo' : ''}" style="background-image: linear-gradient(to top, hsla(${hue}, 75%, 45%, 0.22) ${percentage}%, transparent ${percentage}%);"${cellReviewClickAttr}${cellReviewTitle}>
        ${reviewedCheckmarkHtml}
        <span class="planner-header-day">${escH(dayName)}</span>
        <span class="planner-header-date">${dateNum}</span>
        ${oooHeaderBanner}
        ${coveringOooHeaders.length === 0 ? `<span class="planner-header-capacity ${scoreCls}" title="${escA(t('planner.capacityTooltip', { planned: plannedH, available: availableH }))}">${plannedH}<span class="phc-sep">/</span>${availableH}h</span>` : ''}
      </div>
    `;
  });

  // 2. Vertical Hours label column
  gridHTML += `<div class="planner-time-col">`;
  for (let hour = 0; hour <= 23; hour++) {
    const hourStr = String(hour).padStart(2, '0') + ':00';
    gridHTML += `<div class="planner-time-cell">${hourStr}</div>`;
  }
  gridHTML += `</div>`;

  // 3. Day timeline columns
  days.forEach(colDate => {
    const colDateStr = formatLocalDateValue(colDate);
    const isToday = colDateStr === todayStr;

    gridHTML += `
      <div class="planner-day-col${isToday ? ' today' : ''}" data-date="${colDateStr}"
        ondragover="handlePlannerDayColDragOver(event)"
        ondrop="handlePlannerDayColDrop(event, '${colDateStr}')">
        <!-- Render Empty plannable time slots -->
        ${renderEmptyPlannerSlotsHTML(colDateStr)}
        <!-- Render Events in this column -->
        ${renderPlannerEventsForDayHTML(colDateStr)}
      </div>
    `;
  });

  grid.innerHTML = gridHTML;

  // Add off-hours zones and unplanned slots to each day column
  _renderPlannerDayZones();

  // Draw Time Indicator Line if active week is current week
  drawCurrentTimeLine();
  schedulePlannerCurrentTimeLineRefresh();

  // Wire up drag-over visual feedback
  document.querySelectorAll('.planner-day-col').forEach(col => {
    col.addEventListener('dragenter', () => col.classList.add('drag-over'));
    col.addEventListener('dragleave', e => { if (!col.contains(e.relatedTarget)) col.classList.remove('drag-over'); });
    col.addEventListener('drop', () => col.classList.remove('drag-over'));
  });

  // Wire up drag-resize handles
  _initPlannerResizeHandles();

  // If creation modal is currently open, restore/sync creation preview block in new grid
  const creationModal = document.getElementById('planner-dynamic-modal');
  if (creationModal && creationModal.getAttribute('data-is-creation') === 'true') {
    syncPlannerModalCreationPreview();
  } else {
    removePlannerCreatePreview();
  }
}
function renderEmptyPlannerSlotsHTML(dateStr) {
  let html = '';
  const pxPerMin = 80 / 60;
  const slotDuration = 30; // Standard 30m slots covering the 24h timeline

  for (let timeCursor = 0; timeCursor < 1440; timeCursor += slotDuration) {
    const startTime = minutesToTime(timeCursor);
    const endTime = minutesToTime(timeCursor + slotDuration);
    const topOffset = timeCursor * pxPerMin;
    const height = slotDuration * pxPerMin;

    html += `
      <div class="planner-empty-slot" 
        style="top: ${topOffset}px; height: ${height}px;" 
        onmousedown="handlePlannerEmptyMouseDown(event, ${jq(dateStr)}, ${timeCursor})"
        oncontextmenu="return showPlannerEmptyContextMenu(event, ${jq(dateStr)}, ${jq(startTime)}, ${jq(endTime)})"
        title="${escA(t('planner.planTimeSlot', { time: startTime }))}"
      ></div>
    `;
  }

  return html;
}

// ── Drag-to-Create & Preview Event State ──
let _dragCreateState = null;
let _activePlannerCreationPreviewEl = null;

function removePlannerCreatePreview() {
  if (_activePlannerCreationPreviewEl) {
    _activePlannerCreationPreviewEl.remove();
    _activePlannerCreationPreviewEl = null;
  }
  document.querySelectorAll('.planner-create-preview').forEach(el => el.remove());
}

function updateOrCreatePlannerCreationPreview({ dateStr, startMins, endMins, type = 'call', title = '' }) {
  if (!dateStr || isNaN(startMins) || isNaN(endMins) || endMins <= startMins) {
    removePlannerCreatePreview();
    return null;
  }

  const colEl = document.querySelector(`.planner-day-col[data-date="${dateStr}"]`);
  if (!colEl) {
    removePlannerCreatePreview();
    return null;
  }

  let preview = _activePlannerCreationPreviewEl;
  if (!preview || !preview.parentElement || preview.parentElement !== colEl) {
    removePlannerCreatePreview();
    preview = document.createElement('div');
    colEl.appendChild(preview);
    _activePlannerCreationPreviewEl = preview;
  }

  const startTime = minutesToTime(startMins);
  const endTime = minutesToTime(endMins);
  const top = startMins * (80 / 60);
  const height = Math.max(15, endMins - startMins) * (80 / 60);
  const isShort = (endMins - startMins) <= 15;

  preview.className = `planner-event-card planner-create-preview event-${type}${isShort ? ' short-event' : ''}`;
  preview.style.top = `${top}px`;
  preview.style.height = `${height}px`;
  preview.style.left = '4px';
  preview.style.width = 'calc(100% - 28px)';
  preview.style.pointerEvents = 'none';
  preview.style.zIndex = '100';
  preview.style.boxSizing = 'border-box';

  const defaultNewEventText = t('planner.newEvent') || 'New Event';
  const displayTitle = title ? title : `+ ${defaultNewEventText}`;

  preview.innerHTML = `
    <div class="planner-event-main-col">
      <div class="planner-event-title">${escH(displayTitle)}</div>
    </div>
    <div class="planner-event-time-col">
      <span class="planner-event-time-pill">${startTime}–${endTime}</span>
    </div>
  `;

  return preview;
}

function syncPlannerModalCreationPreview() {
  const modalEl = document.getElementById('planner-dynamic-modal');
  if (!modalEl || modalEl.getAttribute('data-is-creation') !== 'true') {
    removePlannerCreatePreview();
    return;
  }

  const type = document.getElementById('pe-type')?.value || 'call';
  const title = document.getElementById('pe-title')?.value?.trim() || '';
  const dateStr = document.getElementById('pe-date')?.value || '';
  const startTime = document.getElementById('pe-start-time')?.value || '';
  const endTime = document.getElementById('pe-end-time')?.value || '';
  const alldayCheckbox = document.getElementById('pe-ooo-allday');
  const isAllDay = type === 'ooo' && alldayCheckbox && alldayCheckbox.checked;

  if (isAllDay || !dateStr || !startTime || !endTime) {
    removePlannerCreatePreview();
    return;
  }

  const startMins = timeToMinutes(startTime);
  const endMins = timeToMinutes(endTime);
  if (isNaN(startMins) || isNaN(endMins) || endMins <= startMins) {
    return;
  }

  updateOrCreatePlannerCreationPreview({
    dateStr,
    startMins,
    endMins,
    type,
    title
  });
}

function handlePlannerEmptyMouseDown(e, dateStr, slotStartMins) {
  if (e.button !== 0) return; // Only left click
  if (_plannerCloneState) return; // Clone mode: let the clone placement handler deal with this click

  const duration = typeof defaultPlannerDuration === 'number' ? defaultPlannerDuration : 30;
  const maxMins = 1440; // 24:00 cap, allowing overlapping blocks anywhere

  const actualDuration = Math.min(duration, maxMins - slotStartMins);

  _dragCreateState = {
    dateStr,
    originMins: slotStartMins,
    startMins: slotStartMins,
    endMins: slotStartMins + actualDuration,
    defaultEndMins: slotStartMins + actualDuration, // used on quick click
    maxMins: maxMins,
    startY: e.clientY,
    hasDragged: false,
    colEl: e.currentTarget.closest('.planner-day-col')
  };

  updateOrCreatePlannerCreationPreview({
    dateStr,
    startMins: slotStartMins,
    endMins: slotStartMins + actualDuration,
    type: 'call',
    title: ''
  });

  document.addEventListener('mousemove', _plannerEmptyMouseMove);
  document.addEventListener('mouseup', _plannerEmptyMouseUp);
}

function _plannerEmptyMouseMove(e) {
  if (!_dragCreateState) return;

  const dist = Math.abs(e.clientY - _dragCreateState.startY);
  if (dist > 8) {
    _dragCreateState.hasDragged = true;
  }

  if (_dragCreateState.hasDragged) {
    const colRect = _dragCreateState.colEl.getBoundingClientRect();
    const y = e.clientY - colRect.top;

    const minMins = 0; // 00:00
    let currentMins = minMins + (y / (80 / 60));

    // snap to 15 mins
    currentMins = Math.round(currentMins / 15) * 15;

    const origin = _dragCreateState.originMins != null ? _dragCreateState.originMins : _dragCreateState.startMins;
    let start, end;
    if (currentMins >= origin) {
      start = origin;
      end = Math.max(origin + 15, Math.min(_dragCreateState.maxMins, currentMins));
    } else {
      start = Math.max(0, currentMins);
      end = Math.max(start + 15, origin + 30);
    }

    _dragCreateState.startMins = start;
    _dragCreateState.endMins = end;
    updateOrCreatePlannerCreationPreview({
      dateStr: _dragCreateState.dateStr,
      startMins: _dragCreateState.startMins,
      endMins: _dragCreateState.endMins,
      type: 'call',
      title: ''
    });
  }
}

function _plannerEmptyMouseUp(e) {
  if (!_dragCreateState) return;

  document.removeEventListener('mousemove', _plannerEmptyMouseMove);
  document.removeEventListener('mouseup', _plannerEmptyMouseUp);

  const state = _dragCreateState;
  _dragCreateState = null;

  // Quick click (no drag): always use the configured default duration.
  // Drag: use wherever the mouse was released.
  const resolvedStartMins = state.hasDragged ? state.startMins : state.startMins;
  const resolvedEndMins = state.hasDragged
    ? state.endMins
    : state.defaultEndMins;

  updateOrCreatePlannerCreationPreview({
    dateStr: state.dateStr,
    startMins: resolvedStartMins,
    endMins: resolvedEndMins,
    type: 'call',
    title: ''
  });

  const startHour = Math.floor(resolvedStartMins / 60);
  const startMin = resolvedStartMins % 60;
  const endHour = Math.floor(resolvedEndMins / 60);
  const endMin = resolvedEndMins % 60;

  const startTime = `${String(startHour).padStart(2, '0')}:${String(startMin).padStart(2, '0')}`;
  const endTime = `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;

  clickEmptySlot(state.dateStr, startTime, endTime);
}

// Render planned blocks in the day column
function isPlannerEventLinked(evtA, evtB) {
  if (!evtA || !evtB) return false;
  if (evtA.id === evtB.id) return true;
  if (evtA.type === 'prep' && evtA.prepForEventId === evtB.id) return true;
  if (evtB.type === 'prep' && evtB.prepForEventId === evtA.id) return true;
  if (evtA.noteId && evtB.noteId && evtA.noteId === evtB.noteId) return true;
  if (evtA.todoId && evtB.todoId && evtA.todoId === evtB.todoId) return true;
  const todosA = new Set(getPlannerEventLinkedTodoIds(evtA));
  const todosB = getPlannerEventLinkedTodoIds(evtB);
  if (todosB.some(id => todosA.has(id))) return true;
  return false;
}

function renderPlannerEventsForDayHTML(dateStr) {
  // 1. Find events that start today (excluding full-day OOO — those are shown as banners in the header)
  const startsToday = plannerEvents.filter(e => e.date === dateStr && !(e.type === 'ooo' && e.allDay));


  // 2. Find events that started yesterday but cross midnight (end on dateStr)
  let startsYesterday = [];
  try {
    const prevDate = new Date(parseLocalDateValue(dateStr));
    prevDate.setDate(prevDate.getDate() - 1);
    const prevDateStr = formatLocalDateValue(prevDate);
    startsYesterday = plannerEvents.filter(e => e.date === prevDateStr && timeToMinutes(e.endTime) < timeToMinutes(e.startTime));
  } catch (err) {
    console.error('Failed to get yesterday date:', err);
  }

  // 3. Find covering all-day OOO events
  const coveringOooEvents = (typeof plannerEvents !== 'undefined' && Array.isArray(plannerEvents))
    ? plannerEvents.filter(e => e.type === 'ooo' && e.allDay && dateStr >= e.date && dateStr <= (e.endDate || e.date))
    : [];

  // 4. Map to rendering item format: { event, start, end }
  const defaultWorkStartMins = timeToMinutes(workStartTime || '09:00');
  const defaultWorkEndMins = timeToMinutes(workEndTime || '18:30');
  const fallbackStart = !isNaN(defaultWorkStartMins) ? defaultWorkStartMins : 540;
  const fallbackEnd = (!isNaN(defaultWorkEndMins) && defaultWorkEndMins > fallbackStart) ? defaultWorkEndMins : Math.min(1440, fallbackStart + 570);

  const todayItems = startsToday.map(e => {
    let start = timeToMinutes(e.startTime, false);
    let end = timeToMinutes(e.endTime, true);
    const isTimeInvalid = isNaN(start) || isNaN(end) || (end <= start && !(end === 1440 && start < 1440));
    
    if (isTimeInvalid) {
      start = fallbackStart;
      const dur = parseInt(e.duration, 10) || 30;
      end = start + dur;
    }
    
    const crossesMidnight = !isTimeInvalid && (end < start);
    return {
      event: e,
      start: start,
      end: crossesMidnight ? 1440 : end,
      isTimeInvalid: isTimeInvalid
    };
  });

  const yesterdayItems = startsYesterday.map(e => {
    const end = timeToMinutes(e.endTime);
    return {
      event: e,
      start: 0,
      end: isNaN(end) ? 0 : end,
      isContinuationFromYesterday: true
    };
  });

  const oooItems = coveringOooEvents.map(e => ({
    event: e,
    start: fallbackStart,
    end: fallbackEnd,
    isAllDayOoo: true
  }));

  let proposalItems = [];
  const MAX_DAY_PROPOSALS_RENDERED = 50;
  const isProposalsActive = (typeof showPlannerProposals !== 'undefined' && showPlannerProposals) || (typeof window !== 'undefined' && window.showPlannerProposals);
  const currentProposals = (typeof getPlannerProposals === 'function') ? getPlannerProposals() : plannerProposals;
  if (isProposalsActive && Array.isArray(currentProposals)) {
    let dayProposals = currentProposals.filter(p => {
      if (!p || p.status !== 'pending') return false;
      if (plannerEvents.some(e => e && e.proposalId === p.id)) return false;
      return p.date === dateStr;
    });
    if (dayProposals.length > MAX_DAY_PROPOSALS_RENDERED) {
      dayProposals = dayProposals.slice(0, MAX_DAY_PROPOSALS_RENDERED);
    }
    proposalItems = dayProposals.map(p => {
      let start = timeToMinutes(p.startTime, false);
      let end = timeToMinutes(p.endTime, true);
      const isTimeInvalid = isNaN(start) || isNaN(end) || (end <= start && !(end === 1440 && start < 1440));
      if (isTimeInvalid) {
        start = fallbackStart;
        const dur = (typeof parsePlannerDuration === 'function' ? parsePlannerDuration(p.duration, 30) : (parseInt(p.duration, 10) || 30));
        end = start + dur;
      }
      return {
        event: p,
        start: start,
        end: end,
        isProposed: true,
        isTimeInvalid: isTimeInvalid
      };
    });
  }

  const allItems = [...todayItems, ...yesterdayItems, ...oooItems, ...proposalItems].filter(item => item.end > item.start);
  if (allItems.length === 0) return '';

  const selectedEvent = selectedPlannerEventId ? plannerEvents.find(e => e.id === selectedPlannerEventId) : null;

  const sortedEvents = allItems.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return b.end - a.end; // longer events first
  });

  // 2. Group into contiguous overlapping clusters
  const clusters = [];
  let currentCluster = [];
  let clusterEnd = -1;

  for (const item of sortedEvents) {
    if (currentCluster.length === 0 || item.start < clusterEnd) {
      currentCluster.push(item);
      clusterEnd = Math.max(clusterEnd, item.end);
    } else {
      clusters.push(currentCluster);
      currentCluster = [item];
      clusterEnd = item.end;
    }
  }
  if (currentCluster.length > 0) {
    clusters.push(currentCluster);
  }

  // 3. For each cluster, assign columns side-by-side
  for (const cluster of clusters) {
    const columns = []; // each column is an array of items
    for (const item of cluster) {
        let placed = false;
        for (let i = 0; i < columns.length; i++) {
          const lastInCol = columns[i][columns[i].length - 1];
          if (item.start >= lastInCol.end) {
            columns[i].push(item);
            item.colIdx = i;
            placed = true;
            break;
          }
        }
        if (!placed) {
          columns.push([item]);
          item.colIdx = columns.length - 1;
        }
      }
      const numCols = columns.length;
      for (const item of cluster) {
        item.totalCols = numCols;
      }
    }

    // 4. Render HTML
    let html = '';

    for (const item of sortedEvents) {
      const event = item.event;
      const top = item.start * (80 / 60);
      const height = (item.end - item.start) * (80 / 60);

      const isSelected = selectedPlannerEventId === event.id;
      let isHighlighted = false;
      let isDimmed = false;

      if (selectedEvent) {
        if (event.id === selectedPlannerEventId || isPlannerEventLinked(selectedEvent, event)) {
          isHighlighted = true;
        } else {
          isDimmed = true;
        }
      }

      const matchesTypeFilter = (evType, filter) => {
        if (!filter) return true;
        if (filter === 'call') return evType === 'call' || evType === 'sync';
        if (filter === 'work') return evType === 'work' || evType === 'todo';
        if (filter === 'prep') return evType === 'prep';
        return evType === filter;
      };
      const isFilteredOut = _plannerTypeFilter && !matchesTypeFilter(event.type, _plannerTypeFilter);

      const isShort = (item.end - item.start) <= 15;
      let cardClsFinal = `planner-event-card event-${event.type}`;
      if (item.isAllDayOoo) cardClsFinal += ' event-allday-ooo';
      if (isSelected) cardClsFinal += ' selected';
      if (isHighlighted) cardClsFinal += ' highlighted';
      if (isDimmed) cardClsFinal += ' dimmed';
      if (isFilteredOut) cardClsFinal += ' event-dimmed-by-filter';
      if (event.autoPlaced) cardClsFinal += ' auto-placed';
      if (isShort) cardClsFinal += ' short-event';
      if (item.isTimeInvalid) cardClsFinal += ' invalid-time';

      // Position percentages for overlapping items
      const colIdx = item.colIdx || 0;
      const totalCols = item.totalCols || 1;
      const rightGutter = 24; // Small space on right side to create new blocks
      const leftVal = totalCols > 1
        ? `calc(4px + ${colIdx} * ((100% - ${rightGutter + 4}px) / ${totalCols}))`
        : '4px';
      const widthVal = totalCols > 1
        ? `calc(((100% - ${rightGutter + 4}px) / ${totalCols}) - 3px)`
        : `calc(100% - ${rightGutter + 4}px)`;

      if (item.isProposed) {
        const isDraft = event.isDraft || event.source === 'Draft';
        const timeLabel = item.isTimeInvalid ? '??:??' : `${event.startTime} - ${event.endTime}`;
        const ariaLabel = isDraft
          ? `${escA(event.title || 'Draft Event')}, ${escA(t('planner.draftBadge') || 'Draft')}`
          : `${escA(event.title || 'Proposed Event')}, ${escA(t('planner.proposedByAgent'))}`;
        const isShort = (item.end - item.start) <= 15;
        let cardClsFinal = `planner-event-card proposed-event ${isDraft ? 'event-draft ' : ''}event-${event.type || 'work'}`;
        if (isShort) cardClsFinal += ' short-event';
        if (item.isTimeInvalid) cardClsFinal += ' invalid-time';

        const quickActionsHtml = isDraft
          ? `
            <div class="planner-event-quick-actions" onclick="event.stopPropagation()">
              <button type="button" class="planner-event-act-btn" onclick="event.stopPropagation(); openPlanEventModalFromProposal(${jq(event.id)})" title="${escA(t('planner.editDraftTooltip') || 'Edit draft')}">${_renderPlannerSvgIcon('pencil', 12)}</button>
              <button type="button" class="planner-event-act-btn planner-event-act-btn--danger" onclick="event.stopPropagation(); dismissPlannerProposal(${jq(event.id)})" title="${escA(t('planner.discardDraftTooltip') || 'Discard draft')}">${_renderPlannerSvgIcon('trash', 12)}</button>
            </div>
          `
          : `
            <div class="planner-event-quick-actions" onclick="event.stopPropagation()">
              <button type="button" class="planner-event-act-btn" onclick="event.stopPropagation(); openPlanEventModalFromProposal(${jq(event.id)})" title="${escA(t('planner.acceptProposalTooltip'))}">${_renderPlannerSvgIcon('pencil', 12)}</button>
              <button type="button" class="planner-event-act-btn" onclick="event.stopPropagation(); quickAcceptPlannerProposal(${jq(event.id)})" title="${escA(t('planner.quickAcceptProposalTooltip'))}">${_renderPlannerSvgIcon('check', 12)}</button>
              <button type="button" class="planner-event-act-btn planner-event-act-btn--danger" onclick="event.stopPropagation(); dismissPlannerProposal(${jq(event.id)})" title="${escA(t('planner.dismissProposalTooltip'))}">${_renderPlannerSvgIcon('close', 12)}</button>
            </div>
          `;

        const badgeHtml = isDraft
          ? `
            <div class="planner-proposal-badge planner-draft-badge">
              <svg class="app-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
              <span>${escH(t('planner.draftBadge') || 'Draft')}</span>
            </div>
          `
          : `
            <div class="planner-proposal-badge">
              <svg class="app-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>
              <span>${escH(event.source || t('planner.proposedBadge'))}</span>
            </div>
          `;

        html += `
          <div class="${cardClsFinal}" 
            style="top: ${top}px; height: ${height}px; left: ${leftVal}; width: ${widthVal};"
            data-event-id="${escA(event.id)}"
            data-is-proposed="true"
            ${isDraft ? 'data-is-draft="true"' : ''}
            onmousedown="event.stopPropagation()"
            onclick="event.stopPropagation(); openPlanEventModalFromProposal(${jq(event.id)})"
            title="${escA(isDraft ? (t('planner.editDraftTooltip') || 'Edit draft') : (t('planner.clickToReviewProposalTooltip')))}"
            role="button"
            tabindex="0"
            aria-label="${ariaLabel}"
          >
            ${quickActionsHtml}
            <div class="planner-event-main-col">
              <div class="planner-event-title">
                ${escH(event.title || t('planner.blockLabel') || 'Event')}
              </div>
              ${badgeHtml}
            </div>
            <div class="planner-event-time-col">
              <span class="planner-event-time-pill">${escH(timeLabel)}</span>
            </div>
          </div>
        `;
        continue;
      }

      const collabText = (event.collaborators && event.collaborators.length > 0)
        ? `<span style="font-size:0.72rem;opacity:0.85;display:block;margin-top:2px;">👥 ${escH(event.collaborators.join(', '))}</span>`
        : '';

      const contBadge = item.isContinuationFromYesterday
        ? `<span class="planner-continuation-badge">↩ cont. from yesterday</span>`
        : '';

      const timeLabel = item.isAllDayOoo ? (t('planner.allDayBadge') || 'All day') : (item.isTimeInvalid ? '??:??' : (event.startTime || '??:??'));
      const ariaLabel = `${escA(event.title || 'Event')}${item.isAllDayOoo ? `, ${escA(t('planner.allDayBadge') || 'All day')}` : (event.startTime && event.endTime ? `, ${escA(event.startTime)} to ${escA(event.endTime)}` : '')}`;

    html += `
      <div class="${cardClsFinal}" 
        style="top: ${top}px; height: ${height}px; left: ${leftVal}; width: ${widthVal};"
        draggable="true"
        data-event-id="${escA(event.id)}"
        ondragstart="handlePlannerEventDragStart(event, ${jq(event.id)})"
        onmousedown="event.stopPropagation()"
        onclick="event.stopPropagation(); selectPlannerEvent(${jq(event.id)})"
        ondblclick="event.stopPropagation(); openPlanEventModal(plannerEvents.find(e => e.id === ${jq(event.id)}) || {})"
        oncontextmenu="return showPlannerEventContextMenu(event, ${jq(event.id)})"
        role="button"
        tabindex="0"
        aria-label="${ariaLabel}"
      >
        <div class="planner-event-quick-actions" onclick="event.stopPropagation()">
          <button type="button" class="planner-event-act-btn" onclick="event.stopPropagation(); openPlanEventModal(plannerEvents.find(e => e.id === ${jq(event.id)}) || {})" title="${escA(t('planner.editBlockTooltip') || t('planner.quickEdit') || 'Edit')}">${_renderPlannerSvgIcon('pencil', 12)}</button>
          ${event.recurrenceId ? `<button type="button" class="planner-event-act-btn" onclick="event.stopPropagation(); openPlannerSeriesModal(${jq(event.recurrenceId)}, ${jq(event.id)})" title="${escA(t('planner.editSeriesTooltip') || 'Edit entire recurring series')}">${_renderPlannerSvgIcon('repeat', 12)}</button>` : ''}
          <button type="button" class="planner-event-act-btn" onclick="event.stopPropagation(); duplicatePlannerEventById(${jq(event.id)})" title="${escA(t('planner.quickDuplicate') || 'Duplicate')}">${_renderPlannerSvgIcon('copy', 12)}</button>
          ${event.noteId ? `<button type="button" class="planner-event-act-btn" onclick="event.stopPropagation(); openPlannerLinkedNote(${jq(event.noteId)})" title="${escA(t('planner.quickOpenNote') || 'Open Note')}">${_renderPlannerSvgIcon('fileText', 12)}</button>` : ''}
          <button type="button" class="planner-event-act-btn planner-event-act-btn--danger" onclick="event.stopPropagation(); deletePlannerEventWithDissolve(${jq(event.id)})" title="${escA(t('planner.quickDelete') || 'Delete')}">${_renderPlannerSvgIcon('trash', 12)}</button>
        </div>
        <div class="planner-event-main-col">
          <div class="planner-event-title">
            ${escH(event.title || t('planner.oooFullDayBanner') || 'Out of Office')}
          </div>
          ${contBadge}
          ${isShort ? '' : collabText}
        </div>
        <div class="planner-event-time-col">
          <span class="planner-event-time-pill">${escH(timeLabel)}</span>
        </div>
        <div class="planner-event-resize-handle top" data-resize-id="${escA(event.id)}"></div>
        <div class="planner-event-resize-handle bottom" data-resize-id="${escA(event.id)}"></div>
      </div>
    `;
  }

  return html;
}

// Convert "HH:MM" to absolute minutes in day
function timeToMinutes(timeStr, isEndTime = false) {
  if (!timeStr) return NaN;
  const parts = String(timeStr).split(':');
  if (parts.length < 2) return NaN;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return NaN;
  if (isEndTime && h === 0 && m === 0) return 1440;
  if (h === 24 && m === 0) return 1440;
  return h * 60 + m;
}

function plannerEventSupportsNoteAction(event) {
  return !!event && event.type !== 'custom' && event.type !== 'ooo';
}

function getPlannerEventEffectiveNoteId(event) {
  if (!event) return null;
  if (event.noteId) return event.noteId;
  if (Array.isArray(event.linkedNoteIds) && event.linkedNoteIds.length > 0) return event.linkedNoteIds[0];
  if (event.notePath) return event.notePath;
  if (event.type === 'prep' && event.prepForEventId) {
    const mainEv = (typeof plannerEvents !== 'undefined' ? plannerEvents : []).find(e => e.id === event.prepForEventId);
    if (mainEv) {
      if (mainEv.noteId) return mainEv.noteId;
      if (Array.isArray(mainEv.linkedNoteIds) && mainEv.linkedNoteIds.length > 0) return mainEv.linkedNoteIds[0];
      if (mainEv.notePath) return mainEv.notePath;
    }
  }
  if (event.type === 'todo' && event.todoId && typeof getTodoById === 'function') {
    const todo = getTodoById(event.todoId);
    if (todo) {
      if (todo.noteId) return todo.noteId;
      if (Array.isArray(todo.linkedNoteIds) && todo.linkedNoteIds.length > 0) return todo.linkedNoteIds[0];
    }
  }
  return null;
}

function getPlannerEventNoteActionLabel(event) {
  if (!event) return t('planner.openNote');
  const effectiveNoteId = getPlannerEventEffectiveNoteId(event);
  if (effectiveNoteId && (typeof getNoteById !== 'function' || getNoteById(effectiveNoteId))) {
    return t('planner.openNote');
  }
  return t('planner.generateNewNote') || 'Generate new note';
}

function showPlannerNoteGenerationProgress(message, customTitle) {
  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay planner-progress-overlay';
  overlay.style.zIndex = '99999';

  const box = document.createElement('div');
  box.className = 'dialog-box planner-progress-dialog';

  const spinner = document.createElement('div');
  spinner.className = 'planner-progress-spinner';
  spinner.setAttribute('aria-hidden', 'true');

  const title = document.createElement('div');
  title.className = 'planner-progress-title';
  title.textContent = customTitle || t('planner.generatingNoteTitle') || 'Generating note';

  const body = document.createElement('div');
  body.className = 'planner-progress-message';
  body.textContent = message || t('planner.generatingNoteMessage') || 'Please wait while the note is being generated...';

  const barContainer = document.createElement('div');
  barContainer.className = 'planner-progress-bar-container';

  const barFill = document.createElement('div');
  barFill.className = 'planner-progress-bar-fill';
  barFill.style.width = '0%';

  barContainer.appendChild(barFill);

  const detail = document.createElement('div');
  detail.className = 'planner-progress-detail';
  detail.style.display = 'none';

  box.appendChild(spinner);
  box.appendChild(title);
  box.appendChild(body);
  box.appendChild(barContainer);
  box.appendChild(detail);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  const closeFn = () => {
    if (typeof window !== 'undefined' && window.AppBridge?.setProgressBar) {
      try { window.AppBridge.setProgressBar(-1); } catch (_e) {}
    }
    if (overlay && overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }
  };

  closeFn.updateStage = (stageText, detailText, percentage) => {
    if (stageText && body) {
      body.textContent = stageText;
    }
    if (detail) {
      if (detailText) {
        detail.textContent = detailText;
        detail.style.display = 'block';
      } else {
        detail.textContent = '';
        detail.style.display = 'none';
      }
    }
    if (barFill && percentage !== undefined) {
      const pct = Math.max(0, Math.min(100, typeof percentage === 'number' ? percentage : 0));
      barFill.style.width = pct + '%';
      if (typeof window !== 'undefined' && window.AppBridge?.setProgressBar) {
        window.AppBridge.setProgressBar(pct / 100);
      }
    }
  };

  closeFn.update = (nextMessage, percentage) => {
    closeFn.updateStage(nextMessage, null, percentage);
  };

  return closeFn;
}

function showPlannerBlocCreationProgress(message, customTitle) {
  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay planner-progress-overlay';
  overlay.style.zIndex = '99999';

  const box = document.createElement('div');
  box.className = 'dialog-box planner-progress-dialog';

  const spinner = document.createElement('div');
  spinner.className = 'planner-progress-spinner';
  spinner.setAttribute('aria-hidden', 'true');

  const title = document.createElement('div');
  title.className = 'planner-progress-title';
  title.textContent = customTitle || t('planner.creatingBlocTitle') || 'Creating bloc';

  const body = document.createElement('div');
  body.className = 'planner-progress-message';
  body.textContent = message || t('planner.creatingBlocMessage') || 'Please wait while the bloc is being scheduled...';

  const barContainer = document.createElement('div');
  barContainer.className = 'planner-progress-bar-container';

  const barFill = document.createElement('div');
  barFill.className = 'planner-progress-bar-fill';
  barFill.style.width = '0%';

  barContainer.appendChild(barFill);

  const detail = document.createElement('div');
  detail.className = 'planner-progress-detail';
  detail.style.display = 'none';

  box.appendChild(spinner);
  box.appendChild(title);
  box.appendChild(body);
  box.appendChild(barContainer);
  box.appendChild(detail);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  const closeFn = () => {
    if (typeof window !== 'undefined' && window.AppBridge?.setProgressBar) {
      try { window.AppBridge.setProgressBar(-1); } catch (_e) {}
    }
    if (overlay && overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }
  };

  closeFn.updateStage = (stageText, detailText, percentage) => {
    if (stageText && body) {
      body.textContent = stageText;
    }
    if (detail) {
      if (detailText) {
        detail.textContent = detailText;
        detail.style.display = 'block';
      } else {
        detail.textContent = '';
        detail.style.display = 'none';
      }
    }
    if (barFill && percentage !== undefined) {
      const pct = Math.max(0, Math.min(100, typeof percentage === 'number' ? percentage : 0));
      barFill.style.width = pct + '%';
      if (typeof window !== 'undefined' && window.AppBridge?.setProgressBar) {
        window.AppBridge.setProgressBar(pct / 100);
      }
    }
  };

  closeFn.update = (nextMessage, percentage) => {
    closeFn.updateStage(nextMessage, null, percentage);
  };

  return closeFn;
}

function findNextAvailablePlannerSlot(durationMins) {
  const now = new Date();
  const startMins = timeToMinutes(workStartTime || '09:00');
  const endMins = timeToMinutes(workEndTime || '18:30');
  const workingDays = (plannerWorkingDays && plannerWorkingDays.length > 0) ? plannerWorkingDays : [1, 2, 3, 4, 5];

  // Try up to 14 days
  for (let i = 0; i < 14; i++) {
    const checkDate = new Date(now);
    checkDate.setDate(now.getDate() + i);

    // Check if it is a working day
    const dayOfWeek = checkDate.getDay();
    if (!workingDays.includes(dayOfWeek)) {
      continue;
    }

    const dateStr = formatLocalDateValue(checkDate);
    // Find all existing events on this date
    const dayEvents = plannerEvents.filter(e => e.date === dateStr);

    let searchStartMins = startMins;
    if (i === 0) {
      // It's today, so start searching from max(startMins, now aligned to next 15-minute boundary)
      const nowMins = now.getHours() * 60 + now.getMinutes();
      const alignedNowMins = Math.ceil(nowMins / 15) * 15;
      searchStartMins = Math.max(startMins, alignedNowMins);
    }

    for (let currentMins = searchStartMins; currentMins + durationMins <= endMins; currentMins += 15) {
      const slotStart = currentMins;
      const slotEnd = currentMins + durationMins;

      const hasOverlap = dayEvents.some(ev => {
        const evStart = timeToMinutes(ev.startTime);
        const evEnd = timeToMinutes(ev.endTime);
        return (slotStart < evEnd && slotEnd > evStart);
      });

      if (!hasOverlap) {
        return {
          date: dateStr,
          startTime: minutesToTime(slotStart),
          endTime: minutesToTime(slotEnd)
        };
      }
    }
  }

  // Fallback
  return {
    date: formatLocalDateValue(now),
    startTime: '10:00',
    endTime: minutesToTime(timeToMinutes('10:00') + durationMins)
  };
}

// Find the best available slot for a prep block before a given call.
// Priority:
//   1. Right before the call (callStart - duration) if free and within working hours
//   2. Next available slot scanning backwards through same-day working hours
//   3. Previous calendar day in working hours (future slots only)
//   4. Fallback: after working hours on the call's day
function _findSmartPrepSlot(callDate, callStartTime, prepDurationMins) {
  const workStartMin = timeToMinutes(workStartTime || '09:00');
  const workEndMin = timeToMinutes(workEndTime || '18:30');
  const callStartMin = timeToMinutes(callStartTime);

  const now = new Date();
  const nowDateStr = formatLocalDateValue(now);
  const nowMins = now.getHours() * 60 + now.getMinutes();

  function eventsOnDate(dateStr) {
    return plannerEvents.filter(e => e.date === dateStr);
  }

  function isSlotFree(dateStr, slotStart, slotEnd) {
    return !eventsOnDate(dateStr).some(ev => {
      const evStart = timeToMinutes(ev.startTime);
      const evEnd = timeToMinutes(ev.endTime);
      return slotStart < evEnd && slotEnd > evStart;
    });
  }

  function isInFuture(dateStr, slotStart) {
    if (dateStr > nowDateStr) return true;
    if (dateStr < nowDateStr) return false;
    return slotStart >= nowMins;
  }

  // Step 1: ideal slot — immediately before the call, within working hours
  const idealStart = callStartMin - prepDurationMins;
  if (idealStart >= workStartMin && isSlotFree(callDate, idealStart, callStartMin)) {
    return { date: callDate, startTime: minutesToTime(idealStart), endTime: callStartTime };
  }

  // Step 2: scan backwards through same-day working hours for any free slot before the call
  const upperBound = Math.min(callStartMin, workEndMin) - prepDurationMins;
  for (let s = upperBound; s >= workStartMin; s -= 15) {
    const e = s + prepDurationMins;
    if (e > callStartMin) continue; // must end before the call
    if (isSlotFree(callDate, s, e)) {
      return { date: callDate, startTime: minutesToTime(s), endTime: minutesToTime(e) };
    }
  }

  // Step 3: previous calendar day, working hours, future slots only
  const prevDate = new Date(callDate);
  prevDate.setDate(prevDate.getDate() - 1);
  const prevDateStr = formatLocalDateValue(prevDate);
  for (let s = workStartMin; s + prepDurationMins <= workEndMin; s += 15) {
    const e = s + prepDurationMins;
    if (!isInFuture(prevDateStr, s)) continue;
    if (isSlotFree(prevDateStr, s, e)) {
      return { date: prevDateStr, startTime: minutesToTime(s), endTime: minutesToTime(e) };
    }
  }

  // Step 4: fallback — after working hours on the call's day
  return {
    date: callDate,
    startTime: minutesToTime(workEndMin),
    endTime: minutesToTime(workEndMin + prepDurationMins),
    afterHours: true
  };
}

function _plannerUpdateSuggestions() {
  const dateEl = document.getElementById('pe-date');
  const startEl = document.getElementById('pe-start-time');
  const durEl = document.getElementById('pe-duration');
  const endEl = document.getElementById('pe-end-time');
  const container = document.getElementById('pe-time-suggestions');
  if (!dateEl || !startEl || !durEl || !container) return;

  const dateVal = dateEl.value;
  const startVal = startEl.value;
  if (!dateVal || !startVal) {
    container.innerHTML = '';
    return;
  }

  let durationMins = 30;
  if (durEl.value === 'custom') {
    if (endEl) {
      const s = timeToMinutes(startVal);
      const e = timeToMinutes(endEl.value);
      if (!isNaN(s) && !isNaN(e) && e > s) {
        durationMins = e - s;
      }
    }
  } else {
    durationMins = parseInt(durEl.value, 10) || 30;
  }

  const startMins = timeToMinutes(startVal);
  const workEndMins = timeToMinutes(workEndTime || '18:30');

  const modalEl = document.getElementById('planner-dynamic-modal');
  const currentEventId = modalEl ? modalEl.getAttribute('data-event-id') : '';

  const dayEvents = plannerEvents.filter(e => e.date === dateVal && e.id !== currentEventId);

  const slots = [];
  // Generate the next 8 slots in 15-minute increments that fit within the work day
  for (let currentMins = startMins + 15; currentMins + durationMins <= workEndMins && slots.length < 8; currentMins += 15) {
    const slotStart = currentMins;
    const slotEnd = currentMins + durationMins;

    const hasOverlap = dayEvents.some(ev => {
      const evStart = timeToMinutes(ev.startTime);
      const evEnd = timeToMinutes(ev.endTime);
      return (slotStart < evEnd && slotEnd > evStart);
    });

    slots.push({
      time: minutesToTime(slotStart),
      booked: hasOverlap
    });
  }

  if (slots.length > 0) {
    container.innerHTML = `
      <span style="color:var(--text-muted);font-weight:600;margin-right:4px;">Suggested:</span>
      ${slots.map(slot => {
      if (slot.booked) {
        return `
            <span class="planner-suggestion-btn booked" title="${escA(t('planner.alreadyBookedTooltip'))}">
              ${slot.time}
            </span>
          `;
      } else {
        return `
            <button type="button" class="planner-suggestion-btn" onclick="_plannerSelectSuggestion('${slot.time}')" title="${escA(t('planner.suggestionTimeTooltip') || 'Select this suggested start time')}">
              ${slot.time}
            </button>
          `;
      }
    }).join('')}
    `;
  } else {
    container.innerHTML = `<span style="color:var(--text-muted);font-style:italic;">No suggested times available after ${startVal}</span>`;
  }
}

function _plannerSelectSuggestion(time) {
  const startEl = document.getElementById('pe-start-time');
  if (startEl) {
    startEl.value = time;
    _plannerSyncEndFromDuration();
    _plannerUpdateSuggestions();
  }
}

window._plannerSelectSuggestion = _plannerSelectSuggestion;

// Draw red visual line for the current hour/minute
function drawCurrentTimeLine() {
  // Remove existing indicators and gutter badges
  document.querySelectorAll('.planner-current-time-indicator, .planner-current-time-gutter-badge').forEach(el => el.remove());

  const todayStr = (typeof formatLocalDateValue === 'function')
    ? formatLocalDateValue(new Date())
    : new Date().toISOString().slice(0, 10);
  const todayCol = document.querySelector(`.planner-day-col[data-date="${todayStr}"]`)
    || document.querySelector('.planner-day-col.today');
  if (!todayCol) return;

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  // Grid covers 24h
  if (currentMinutes >= 0 && currentMinutes <= 1440) {
    const top = currentMinutes * (80 / 60);
    const indicator = document.createElement('div');
    indicator.className = 'planner-current-time-indicator';
    indicator.style.top = `${top}px`;
    
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const badge = document.createElement('span');
    badge.className = 'planner-current-time-badge';
    badge.textContent = timeStr;
    indicator.appendChild(badge);

    todayCol.appendChild(indicator);

    // Also draw badge on the left time gutter column
    const timeCol = document.querySelector('.planner-time-col');
    if (timeCol) {
      const gutterBadge = document.createElement('div');
      gutterBadge.className = 'planner-current-time-gutter-badge';
      gutterBadge.style.top = `${top}px`;
      gutterBadge.textContent = timeStr;
      timeCol.appendChild(gutterBadge);
    }
  }
}
window.drawCurrentTimeLine = drawCurrentTimeLine;

function clearPlannerCurrentTimeLineRefresh() {
  if (_plannerCurrentTimeRefreshKickoff) {
    clearTimeout(_plannerCurrentTimeRefreshKickoff);
    _plannerCurrentTimeRefreshKickoff = null;
  }
  if (_plannerCurrentTimeRefreshTimer) {
    clearInterval(_plannerCurrentTimeRefreshTimer);
    _plannerCurrentTimeRefreshTimer = null;
  }
}
window.clearPlannerCurrentTimeLineRefresh = clearPlannerCurrentTimeLineRefresh;

function schedulePlannerCurrentTimeLineRefresh() {
  clearPlannerCurrentTimeLineRefresh();

  const tick = () => {
    const visiblePanel = document.getElementById('planner-panel');
    if (visiblePanel && visiblePanel.style.display !== 'none' && (typeof activeTab === 'undefined' || activeTab === 'planner')) {
      drawCurrentTimeLine();
    }
  };

  drawCurrentTimeLine();

  const now = new Date();
  const delayToNextMinute = Math.max(250, ((60 - now.getSeconds()) * 1000) - now.getMilliseconds());

  _plannerCurrentTimeRefreshKickoff = setTimeout(() => {
    tick();
    _plannerCurrentTimeRefreshTimer = setInterval(tick, 60 * 1000);
  }, delayToNextMinute);
}
window.schedulePlannerCurrentTimeLineRefresh = schedulePlannerCurrentTimeLineRefresh;

// Add off-hours dim zones and unplanned-time indicators for each day column
function _renderPlannerDayZones() {
  const workStartMin = timeToMinutes(workStartTime || '09:00');
  const workEndMin = timeToMinutes(workEndTime || '18:30');
  const gridStart = 0; // 00:00
  const gridEnd = 1440; // 24:00
  const pxPerMin = 80 / 60;

  document.querySelectorAll('.planner-day-col').forEach(col => {
    const dateStr = col.dataset.date;

    // 1. Off-hours zones (pre-work and post-work)
    const preWorkH = Math.max(0, workStartMin - gridStart);
    if (preWorkH > 0) {
      const div = document.createElement('div');
      div.className = 'planner-off-hours';
      div.style.top = '0';
      div.style.height = `${preWorkH * pxPerMin}px`;
      col.appendChild(div);
    }
    const postWorkStart = Math.min(gridEnd, workEndMin);
    const postWorkH = gridEnd - postWorkStart;
    if (postWorkH > 0) {
      const div = document.createElement('div');
      div.className = 'planner-off-hours';
      div.style.top = `${(postWorkStart - gridStart) * pxPerMin}px`;
      div.style.height = `${postWorkH * pxPerMin}px`;
      col.appendChild(div);
    }

    // 2. Unplanned work-time gaps
    const dayEvents = plannerEvents
      .filter(e => e.date === dateStr)
      .map(e => ({ s: timeToMinutes(e.startTime), en: timeToMinutes(e.endTime) }))
      .filter(e => !isNaN(e.s) && !isNaN(e.en) && e.en > e.s)
      .sort((a, b) => a.s - b.s);

    let cursor = Math.max(gridStart, workStartMin);
    const workEnd = Math.min(gridEnd, workEndMin);

    for (const ev of dayEvents) {
      const evStart = Math.max(workStartMin, ev.s);
      const evEnd = Math.min(workEndMin, ev.en);
      if (evStart > cursor && cursor < workEnd) {
        const gapStart = cursor;
        const gapEnd = Math.min(evStart, workEnd);
        if (gapEnd > gapStart) {
          const div = document.createElement('div');
          div.className = 'planner-unplanned-slot';
          div.style.pointerEvents = 'none';
          div.title = `Unplanned: ${minutesToTime(gapStart)} - ${minutesToTime(gapEnd)}`;
          div.style.top = `${(gapStart - gridStart) * pxPerMin}px`;
          div.style.height = `${(gapEnd - gapStart) * pxPerMin}px`;
          col.appendChild(div);
        }
      }
      if (evEnd > cursor) cursor = evEnd;
    }

    // Trailing unplanned gap
    if (cursor < workEnd) {
      const div = document.createElement('div');
      div.className = 'planner-unplanned-slot';
      div.style.pointerEvents = 'none';
      div.title = `Unplanned: ${minutesToTime(cursor)} - ${minutesToTime(workEnd)}`;
      div.style.top = `${(cursor - gridStart) * pxPerMin}px`;
      div.style.height = `${(workEnd - cursor) * pxPerMin}px`;
      col.appendChild(div);
    }
  });
}

// Initialise bottom-drag resize handles on rendered event cards
function _initPlannerResizeHandles() {
  // 1. Bottom-resize handles
  document.querySelectorAll('.planner-event-resize-handle.bottom').forEach(handle => {
    handle.addEventListener('mousedown', e => {
      e.stopPropagation();
      e.preventDefault();
      const eventId = handle.dataset.resizeId;
      const evObj = plannerEvents.find(ev => ev.id === eventId);
      if (!evObj) return;

      const card = handle.closest('.planner-event-card');
      const col = card?.closest('.planner-day-col');
      if (!card || !col) return;

      const colRect = col.getBoundingClientRect();
      const pxPerMin = 80 / 60;
      const gridStart = 0;

      const dateStr = evObj.date;
      const startMinRaw = timeToMinutes(evObj.startTime);
      const endMinRaw = timeToMinutes(evObj.endTime);
      const isTimeInvalid = isNaN(startMinRaw) || isNaN(endMinRaw) || endMinRaw <= startMinRaw;
      const defaultWorkStartMins = timeToMinutes(workStartTime || '09:00');
      const startMin = isTimeInvalid ? defaultWorkStartMins : startMinRaw;
      const ceilMin = 1440; // 24:00 hard cap allow resizes to overlap

      const tooltip = document.createElement('div');
      tooltip.className = 'planner-resize-tooltip';
      document.body.appendChild(tooltip);

      function onMove(mv) {
        const y = mv.clientY - colRect.top;
        const rawMin = gridStart + y / pxPerMin;
        const snapped = Math.round(rawMin / 15) * 15;
        const newEndMin = Math.max(startMin + 15, Math.min(ceilMin, snapped));
        const newEndTime = minutesToTime(newEndMin);
        card.style.height = `${(newEndMin - startMin) * pxPerMin}px`;
        const elStart = card.querySelector('.planner-event-time-start');
        const elEnd = card.querySelector('.planner-event-time-end');
        if (elStart) elStart.textContent = evObj.startTime;
        if (elEnd) elEnd.textContent = newEndTime;
        card.classList.toggle('short-event', (newEndMin - startMin) <= 15);
        card._pendingEndTime = newEndTime;

        tooltip.textContent = `${evObj.startTime} – ${newEndTime}`;
        tooltip.style.left = `${mv.clientX + 14}px`;
        tooltip.style.top = `${mv.clientY - 18}px`;
      }

      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        tooltip.remove();
        if (card._pendingEndTime && card._pendingEndTime !== evObj.endTime) {
          if (isTimeInvalid) {
            evObj.startTime = minutesToTime(startMin);
          }
          evObj.endTime = card._pendingEndTime;
          delete card._pendingEndTime;
          savePlanner();
          renderPlanner();
        }
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });

  // 2. Top-resize handles
  document.querySelectorAll('.planner-event-resize-handle.top').forEach(handle => {
    handle.addEventListener('mousedown', e => {
      e.stopPropagation();
      e.preventDefault();
      const eventId = handle.dataset.resizeId;
      const evObj = plannerEvents.find(ev => ev.id === eventId);
      if (!evObj) return;

      const card = handle.closest('.planner-event-card');
      const col = card?.closest('.planner-day-col');
      if (!card || !col) return;

      const colRect = col.getBoundingClientRect();
      const pxPerMin = 80 / 60;
      const gridStart = 0;

      const dateStr = evObj.date;
      const startMinRaw = timeToMinutes(evObj.startTime);
      const endMinRaw = timeToMinutes(evObj.endTime);
      const isTimeInvalid = isNaN(startMinRaw) || isNaN(endMinRaw) || endMinRaw <= startMinRaw;
      const defaultWorkStartMins = timeToMinutes(workStartTime || '09:00');
      const endMin = isTimeInvalid ? (defaultWorkStartMins + (parseInt(evObj.duration, 10) || 30)) : endMinRaw;
      const floorMin = 0; // 00:00 hard cap allow resizes to overlap

      const tooltip = document.createElement('div');
      tooltip.className = 'planner-resize-tooltip';
      document.body.appendChild(tooltip);

      function onMove(mv) {
        const y = mv.clientY - colRect.top;
        const rawMin = gridStart + y / pxPerMin;
        const snapped = Math.round(rawMin / 15) * 15;
        const newStartMin = Math.min(endMin - 15, Math.max(floorMin, snapped));
        const newStartTime = minutesToTime(newStartMin);

        card.style.top = `${(newStartMin - gridStart) * pxPerMin}px`;
        card.style.height = `${(endMin - newStartMin) * pxPerMin}px`;
        const elStart = card.querySelector('.planner-event-time-start');
        const elEnd = card.querySelector('.planner-event-time-end');
        if (elStart) elStart.textContent = newStartTime;
        if (elEnd) elEnd.textContent = evObj.endTime;
        card.classList.toggle('short-event', (endMin - newStartMin) <= 15);
        card._pendingStartTime = newStartTime;

        tooltip.textContent = `${newStartTime} – ${evObj.endTime}`;
        tooltip.style.left = `${mv.clientX + 14}px`;
        tooltip.style.top = `${mv.clientY - 18}px`;
      }

      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        tooltip.remove();
        if (card._pendingStartTime && card._pendingStartTime !== evObj.startTime) {
          evObj.startTime = card._pendingStartTime;
          if (isTimeInvalid) {
            evObj.endTime = minutesToTime(endMin);
          }
          delete card._pendingStartTime;
          savePlanner();
          renderPlanner();
        }
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });

  // 3. Disable parent card draggable attribute on hover to avoid dragging instead of resizing
  document.querySelectorAll('.planner-event-resize-handle').forEach(handle => {
    const card = handle.closest('.planner-event-card');
    if (card) {
      handle.addEventListener('mouseenter', () => {
        card.setAttribute('draggable', 'false');
      });
      handle.addEventListener('mouseleave', () => {
        card.setAttribute('draggable', 'true');
      });
    }
  });
}

// Select event to inspect
function selectPlannerEvent(eventId) {
  selectedPlannerEventId = selectedPlannerEventId === eventId ? null : eventId;
  if (selectedPlannerEventId) {
    plannerActivePaneTab = 'details';
    plannerRightSidebarCollapsed = false;
    try { sessionStorage.setItem('secretaryPlannerActivePaneTab', plannerActivePaneTab); } catch (e) { }
    try { localStorage.setItem('secretaryPlannerRightCollapsed', '0'); } catch (e) { }
  }
  renderPlanner();
}

// Click empty space cell to schedule
function clickEmptySlot(dateStr, startTime, endTime) {
  openPlanEventModal({
    type: 'call',
    title: '',
    date: dateStr,
    startTime: startTime,
    endTime: endTime
  });
}

// ── Right Sidebar: Inspector ──
function renderPlannerInspector() {
  const container = document.getElementById('planner-right-sidebar-inspector');
  if (!container) return;

  if (!selectedPlannerEventId) {
    container.innerHTML = `<div class="sidebar-empty">${escH(t('planner.noEventSelected'))}</div>`;
    return;
  }

  const event = plannerEvents.find(e => e.id === selectedPlannerEventId);
  if (!event) {
    container.innerHTML = `<div class="sidebar-empty">${escH(t('planner.noEventSelected'))}</div>`;
    return;
  }

  // Find tags of note/todo
  let notePath = '';
  let todoId = '';
  let hasNoteOrCustom = false;
  let eventGroupTags = [];
  let eventMajorTags = [];
  let eventTopicTags = [];
  let tags = [];

  const effectiveNoteId = getPlannerEventEffectiveNoteId(event);
  if (effectiveNoteId) {
    const note = getNoteById(effectiveNoteId);
    if (note) {
      notePath = note.path;
      hasNoteOrCustom = true;
      eventGroupTags = note.group_tags || [];
      eventMajorTags = note.major_topic_tags || [];
      eventTopicTags = note.topic_tags || [];
      tags = [...new Set([...eventGroupTags, ...eventMajorTags, ...eventTopicTags])];
    }
  } else if ((event.group_tags && event.group_tags.length) || (event.major_topic_tags && event.major_topic_tags.length) || (event.topic_tags && event.topic_tags.length)) {
    hasNoteOrCustom = true;
    eventGroupTags = event.group_tags || [];
    eventMajorTags = event.major_topic_tags || [];
    eventTopicTags = event.topic_tags || [];
    tags = [...new Set([...eventGroupTags, ...eventMajorTags, ...eventTopicTags])];
  } else if (event.type === 'todo' && event.todoId) {
    todoId = event.todoId;
    const todo = getTodoById(todoId);
    if (todo) {
      if (todo.noteId) {
        const note = getNoteById(todo.noteId);
        if (note) {
          notePath = note.path;
          hasNoteOrCustom = true;
          eventGroupTags = note.group_tags || [];
          eventMajorTags = note.major_topic_tags || [];
          eventTopicTags = note.topic_tags || [];
          tags = [...new Set([...eventGroupTags, ...eventMajorTags, ...eventTopicTags])];
        }
      } else {
        tags = [...new Set([todo.priority, todo.status].filter(Boolean))];
      }
    }
  }

  const editorGroupTags = eventGroupTags.length ? eventGroupTags : (event.group_tags || []);
  const editorMajorTags = eventMajorTags.length ? eventMajorTags : (event.major_topic_tags || []);
  const editorTopicTags = eventTopicTags.length ? eventTopicTags : (event.topic_tags || []);

  // Associated notes intrinsically linked via the same recurrence series,
  // then complemented by tag-based related notes.
  const intrinsicAssociatedNotes = getIntrinsicAssociatedNotesForPlannerEvent(event, 6);
  const relatedNotesByTags = getRelatedNotesForTags(tags, event.noteId || (todoId ? getTodoById(todoId)?.noteId : ''), 6);
  const relatedNotes = [];
  const seenRelated = new Set();
  intrinsicAssociatedNotes.forEach(n => {
    if (!n || !n.id || seenRelated.has(n.id)) return;
    seenRelated.add(n.id);
    relatedNotes.push(n);
  });
  relatedNotesByTags.forEach(n => {
    if (!n || !n.id || seenRelated.has(n.id)) return;
    seenRelated.add(n.id);
    relatedNotes.push(n);
  });

  const eventTypeLabel = t(`planner.${event.type}`) || event.type;

  let btnContainer = '';
  if (plannerEventSupportsNoteAction(event)) {
    const noteActionLabel = getPlannerEventNoteActionLabel(event);
    btnContainer += `
      <button class="planner-inspector-action-btn primary" onclick="openNoteForEvent(plannerEvents.find(e => e.id === ${jq(event.id)}))" title="${escA(noteActionLabel)}">
        ${escH(noteActionLabel)}
      </button>
    `;
  }

  const noteAssociationEntries = [];
  const noteSeenIds = new Set();
  const pushNoteEntry = (note, selected = false) => {
    if (!note || !note.id || noteSeenIds.has(note.id)) return;
    noteSeenIds.add(note.id);
    noteAssociationEntries.push({ note, selected });
  };
  if (effectiveNoteId) pushNoteEntry(getNoteById(effectiveNoteId), true);
  relatedNotes.forEach(note => pushNoteEntry(note, false));
  noteAssociationEntries.sort((a, b) => _plannerInspectorEventSortDate(a.note, b.note));

  const linkedTodoIds = getPlannerEventLinkedTodoIds(event, { includePrimary: false });
  const todoAssociationEntries = [];
  const todoSeenIds = new Set();
  const pushTodoEntry = (todo, selected = false) => {
    if (!todo || !todo.id || todoSeenIds.has(todo.id)) return;
    todoSeenIds.add(todo.id);
    todoAssociationEntries.push({ todo, selected });
  };
  if (event.todoId) pushTodoEntry(getTodoById(event.todoId), true);
  linkedTodoIds.forEach(id => pushTodoEntry(getTodoById(id), false));
  todoAssociationEntries.sort((a, b) => _plannerInspectorTodoSort(a.todo, b.todo));

  const prepAssociationEntries = (plannerEvents || [])
    .filter(pe => pe && pe.type === 'prep' && pe.prepForEventId === event.id)
    .sort((a, b) => `${a.date || ''} ${a.startTime || ''}`.localeCompare(`${b.date || ''} ${b.startTime || ''}`));

  const chainEvents = event.recurrenceId
    ? (plannerEvents || []).filter(e => e.recurrenceId === event.recurrenceId)
    : [];
  chainEvents.sort((a, b) => {
    const aTime = `${a.date || ''}T${a.startTime || '00:00'}`;
    const bTime = `${b.date || ''}T${b.startTime || '00:00'}`;
    return aTime.localeCompare(bTime);
  });

  let recurrenceChainHtml = '';
  if (chainEvents.length > 0) {
    recurrenceChainHtml = `
      <div class="planner-inspector-notes-section">
        <div class="planner-inspector-notes-label" style="display:flex; align-items:center; justify-content:space-between; width:100%;">
          <span><span class="planner-series-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></span> ${t('planner.partOfSeries') || 'Part of a series'} (${t('planner.seriesCount').replace('{count}', chainEvents.length)})</span>
          <button type="button" class="btn btn-sm" style="padding: 2px 8px; font-size: 0.75rem;" onclick="openPlannerSeriesModal(${jq(event.recurrenceId)}, ${jq(event.id)})" title="${escA(t('planner.editSeriesTooltip') || 'Edit entire recurring series')}">🔁 ${escH(t('planner.editSeries') || 'Edit Series...')}</button>
        </div>
        <div class="planner-continuation-chain">
          ${chainEvents.map(e => {
            const activeClass = e.id === event.id ? 'active' : '';
            return `
              <div class="planner-continuation-chip ${activeClass}" onclick="selectPlannerEventAndFocus(${jq(e.id)})">
                <span class="planner-continuation-chip-date">${e.date}</span>
                <span class="planner-continuation-chip-time">${e.startTime} - ${e.endTime}</span>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  const allInspectorTags = [...new Set([
    ...(eventGroupTags || []),
    ...(eventMajorTags || []),
    ...(eventTopicTags || []),
    ...(event.group_tags || []),
    ...(event.major_topic_tags || []),
    ...(event.topic_tags || [])
  ])].filter(Boolean);

  container.innerHTML = `
    <div class="planner-todo-section" style="gap: 0.6rem;">
      <div>
        <span class="planner-todo-card-badge" style="background: var(--accent); color: var(--bg);">${escH(eventTypeLabel)}</span>
      </div>
      <div class="planner-inspector-title">${escH(event.title)}</div>
      
      <div class="planner-inspector-meta">
        <div><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> <strong>${t('planner.date')}:</strong> ${event.date}${event.allDay && event.endDate && event.endDate !== event.date ? ` – ${event.endDate}` : ''}</div>
        <div><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> <strong>${event.allDay ? (t('planner.allDayBadge') || 'All day') : t('planner.startTime')}:</strong> ${event.allDay ? (t('planner.allDayBadge') || 'All day') : `${event.startTime || '??:??'} - ${event.endTime || '??:??'}`}</div>
        ${(event.collaborators && event.collaborators.length > 0) ? `<div style="margin-top:2px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> <strong>${escH(t('planner.collaboratorsLabel'))}:</strong> ${escH(event.collaborators.join(', '))}</div>` : ''}
      </div>

      <div class="planner-inspector-tags-compact" onclick="editPlannerEvent(${jq(event.id)})" role="button" tabindex="0" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();editPlannerEvent(${jq(event.id)});}" title="${escA(t('planner.clickToEditTags') || 'Click to edit tags in block editor')}">
        ${allInspectorTags.length > 0 ? allInspectorTags.map(tag => `<span class="planner-tag-badge">#${escH(tag)}</span>`).join('') : `<span class="planner-tag-badge-add">${escH(t('planner.addTags') || '+ Add tags')}</span>`}
      </div>

      ${(event.type === 'call' || event.type === 'sync' || prepAssociationEntries.length > 0) ? `
        <div class="planner-inspector-prep-section">
          <div class="planner-inspector-prep-header">
            <div class="planner-inspector-prep-title">
              <span><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg> ${t('planner.preparationSessions') || 'Preparation Sessions'}</span>
              ${prepAssociationEntries.length > 0 ? `<span class="planner-prep-count-badge">${prepAssociationEntries.length}</span>` : ''}
            </div>
            <button type="button" class="planner-inspector-prep-add-btn" onclick="schedulePrepForCall(${jq(event.id)})" title="${escA(t('planner.createPreparationSession') || 'Schedule prep session')}">
              + ${t('planner.schedulePrep') || 'Add Prep'}
            </button>
          </div>
          <div class="planner-assoc-list">
            ${prepAssociationEntries.length === 0 ? `
              <div class="planner-prep-empty-cta" onclick="schedulePrepForCall(${jq(event.id)})" role="button" tabindex="0" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();schedulePrepForCall(${jq(event.id)});}" title="${escA(t('planner.createPreparationSession') || 'Click to schedule a dedicated preparation session before this event')}">
                <div class="planner-prep-empty-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
                <div class="planner-prep-empty-text">
                  <div class="planner-prep-empty-title">${t('planner.noPrepScheduled') || 'No preparation scheduled yet'}</div>
                  <div class="planner-prep-empty-sub">${t('planner.clickToSchedulePrep') || 'Click to block dedicated prep time'}</div>
                </div>
              </div>
            ` : prepAssociationEntries.map(prep => _plannerInspectorAssocRowHtml({
              title: prep.title || 'Prep',
              subtitle: `${prep.date || ''} · ${prep.startTime || ''}-${prep.endTime || ''}`.trim(),
              rowTitle: t('planner.focusPrepSessionTooltip') || 'Click or double-click to focus preparation session',
              onClick: `selectPlannerEventAndFocus(${jq(prep.id)})`,
              onDblClick: `selectPlannerEventAndFocus(${jq(prep.id)})`,
              onRemove: `removePlannerInspectorPrepAssociation(${jq(event.id)}, ${jq(prep.id)})`,
              removeTitle: t('planner.removePreparationSession') || 'Remove preparation session'
            })).join('')}
          </div>
        </div>
      ` : ''}

      ${plannerEventSupportsNoteAction(event) ? `
        <div class="planner-inspector-notes-section">
          <div class="planner-inspector-notes-label">${t('planner.linkedNote') || 'Linked Note'}</div>
          <div class="planner-assoc-list">
            ${(!effectiveNoteId && !noteAssociationEntries.some(e => e.selected)) ? _plannerInspectorAssocRowHtml({
              title: t('planner.defaultDummyNoteLabel') || 'Create Template Note',
              subtitle: t('planner.defaultDummyNoteHint') || 'Click here to create now, remove to change',
              rowTitle: t('planner.defaultDummyNoteHint') || 'Click here to create note template',
              onClick: `openNoteForEvent(plannerEvents.find(e => e.id === ${jq(event.id)}))`,
              onDblClick: `openNoteForEvent(plannerEvents.find(e => e.id === ${jq(event.id)}))`,
              dummy: true
            }) : ''}
            ${noteAssociationEntries.map(entry => {
              const note = entry.note;
              const subtitle = _plannerNoteSubtitle(note, event);
              return _plannerInspectorAssocRowHtml({
                title: note.title || 'Untitled',
                subtitle,
                selected: !!entry.selected,
                rowTitle: t('planner.openLinkedNoteTooltip') || 'Click or double-click to open note',
                onClick: `openPlannerLinkedNote(${jq(note.id)})`,
                onDblClick: `openPlannerLinkedNote(${jq(note.id)})`,
                onRemove: `removePlannerInspectorNoteAssociation(${jq(event.id)}, ${jq(note.id)})`,
                removeTitle: t('planner.removeToChange') || 'Remove to change'
              });
            }).join('')}
          </div>
        </div>
      ` : ''}

      ${(event.type === 'todo' || todoAssociationEntries.length > 0) ? `
        <div class="planner-inspector-notes-section">
          <div class="planner-inspector-notes-label">${t('planner.associatedTasks') || 'Associated Tasks'}</div>
          <div class="planner-assoc-list">
            ${_plannerInspectorAssocRowHtml({
              title: t('planner.associateTaskToType', { type: eventTypeLabel }) || `Associate Task to this ${eventTypeLabel}`,
              subtitle: t('planner.clickHereCreateNow') || 'Click here to create now',
              rowTitle: t('planner.clickHereCreateNow') || 'Click here to create now',
              onClick: `editPlannerEvent(${jq(event.id)})`,
              onDblClick: `editPlannerEvent(${jq(event.id)})`,
              dummy: true
            })}
            ${todoAssociationEntries.map(entry => {
              const todo = entry.todo;
              return _plannerInspectorAssocRowHtml({
                title: todo.title || todo.id,
                subtitle: _plannerTodoSubtitle(todo),
                selected: !!entry.selected,
                rowTitle: t('todo.openTodoTooltip') || 'Click or double-click to open task',
                onClick: `openTodoOverlay(${jq(todo.id)})`,
                onDblClick: `openTodoOverlay(${jq(todo.id)})`,
                onRemove: `removePlannerInspectorTodoAssociation(${jq(event.id)}, ${jq(todo.id)})`,
                removeTitle: t('planner.removeToChange') || 'Remove to change'
              });
            }).join('')}
          </div>
        </div>
      ` : ''}

      <div class="planner-inspector-btn-container">
        ${event.type !== 'ooo' ? `
          <button class="planner-inspector-action-btn primary full-width" onclick="openContinueWorkModal(${jq(event.id)})" title="${escA(t('planner.continueWorkTooltip'))}">
            ${btnLabel('➕', 'planner.continueWork', 'Continue work on this')}
          </button>
        ` : ''}
        <button class="planner-inspector-action-btn secondary" onclick="editPlannerEvent(${jq(event.id)})" title="${escA(event.recurrenceId ? (t('planner.editBlockTooltip') || 'Edit this block') : (t('planner.editEventTooltip') || 'Edit Event'))}">
          ${btnLabel('✏️', event.recurrenceId ? 'planner.editBlock' : 'planner.editEvent', event.recurrenceId ? 'Edit Block' : 'Edit Event')}
        </button>
        ${event.recurrenceId ? `
          <button class="planner-inspector-action-btn secondary" onclick="openPlannerSeriesModal(${jq(event.recurrenceId)}, ${jq(event.id)})" title="${escA(t('planner.editSeriesTooltip') || 'Edit entire recurring series')}">
            ${btnLabel('🔁', 'planner.editSeries', 'Edit Series...')}
          </button>
        ` : ''}
        <button class="planner-inspector-action-btn secondary" style="color: #dc2626; border-color: #fca5a5;" onclick="deletePlannerEvent(${jq(event.id)})" title="${escA(t('planner.deleteEventTooltip'))}">
          ${btnLabel('🗑️', 'planner.deleteEvent', 'Delete Event')}
        </button>
      </div>

      ${recurrenceChainHtml}
    </div>
  `;
}

// Find notes sharing the same tags prioritised by hierarchical overlap, then sorted by date (excluding active note)
function getRelatedNotesForTags(tags, excludeNoteId, limit = 6) {
  if (!tags || !tags.length) return [];

  // Find source note if possible to extract exact tag fields
  const sourceNote = manifest.find(n => n.id === excludeNoteId || n.path === excludeNoteId);

  let sourceGroups = [];
  let sourceMajors = [];
  let sourceTopics = [];

  if (sourceNote) {
    sourceGroups = (sourceNote.group_tags || []).map(t => String(t).toLowerCase());
    sourceMajors = (sourceNote.major_topic_tags || []).map(t => String(t).toLowerCase());
    sourceTopics = (sourceNote.topic_tags || []).map(t => String(t).toLowerCase());
  } else {
    // Fallback classification
    const knownGroups = new Set(knownTagsForType('group').map(t => String(t).toLowerCase()));
    const knownMajors = new Set(knownTagsForType('major').map(t => String(t).toLowerCase()));
    const knownTopics = new Set(knownTagsForType('topic').map(t => String(t).toLowerCase()));

    tags.forEach(t => {
      const lower = String(t).toLowerCase();
      if (knownGroups.has(lower)) sourceGroups.push(lower);
      if (knownMajors.has(lower)) sourceMajors.push(lower);
      if (knownTopics.has(lower)) sourceTopics.push(lower);
    });
  }

  function noteHasTag(noteList, sourceList) {
    if (typeof window.tagArrayContains === 'function') {
      return (sourceList || []).some(srcTag => window.tagArrayContains(noteList, srcTag));
    }
    return (noteList || []).some(t => (sourceList || []).includes(String(t).toLowerCase()));
  }

  const scoredNotes = [];
  for (const n of manifest) {
    if (excludeNoteId && (n.id === excludeNoteId || n.path === excludeNoteId)) continue;

    const hasSameGroup = noteHasTag(n.group_tags, sourceGroups);
    const hasSameMajor = noteHasTag(n.major_topic_tags, sourceMajors);
    const hasSameTopic = noteHasTag(n.topic_tags, sourceTopics);

    let score = 0;
    if (hasSameGroup && hasSameMajor && hasSameTopic) {
      score = 4;
    } else if (hasSameTopic) {
      score = 3;
    } else if (hasSameMajor) {
      score = 2;
    } else if (hasSameGroup) {
      score = 1;
    }

    if (score > 0) {
      scoredNotes.push({ note: n, score });
    }
  }

  // Sort by score descending, then by date descending (newest first)
  scoredNotes.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    const dateA = a.note.date || '';
    const dateB = b.note.date || '';
    if (dateB !== dateA) {
      return dateB > dateA ? 1 : -1;
    }
    return 0;
  });

  return scoredNotes.map(x => x.note).slice(0, limit);
}

function normalizePlannerLinkedNoteIds(noteIds, primaryNoteId = '') {
  const primary = String(primaryNoteId || '').trim();
  const cleaned = Array.from(new Set((Array.isArray(noteIds) ? noteIds : [])
    .map(v => String(v || '').trim())
    .filter(Boolean)));
  if (primary && !cleaned.includes(primary)) cleaned.unshift(primary);
  return cleaned;
}

function getPlannerEventLinkedNoteIds(event, options = {}) {
  const includePrimary = options.includePrimary !== false;
  if (!event) return [];
  const primary = String(event.noteId || '').trim();
  const linked = Array.isArray(event.linkedNoteIds) ? event.linkedNoteIds : [];
  if (includePrimary) return normalizePlannerLinkedNoteIds([primary, ...linked], primary);
  return normalizePlannerLinkedNoteIds(linked).filter(id => id !== primary);
}

function normalizePlannerLinkedTodoIds(todoIds, primaryTodoId = '') {
  const primary = String(primaryTodoId || '').trim();
  const cleaned = Array.from(new Set((Array.isArray(todoIds) ? todoIds : [])
    .map(v => String(v || '').trim())
    .filter(Boolean)));
  if (primary && !cleaned.includes(primary)) cleaned.unshift(primary);
  return cleaned;
}

function getPlannerEventLinkedTodoIds(event, options = {}) {
  const includePrimary = options.includePrimary !== false;
  if (!event) return [];
  const primary = String(event.todoId || '').trim();
  const linked = Array.isArray(event.linkedTodoIds) ? event.linkedTodoIds : [];
  if (includePrimary) return normalizePlannerLinkedTodoIds([primary, ...linked], primary);
  return normalizePlannerLinkedTodoIds(linked).filter(id => id !== primary);
}

async function setPlannerEventAssociatedNote(eventId, noteId, shouldLink = true) {
  const targetEventId = String(eventId || '').trim();
  const targetNoteId = String(noteId || '').trim();
  if (!targetEventId || !targetNoteId) return false;

  const event = (plannerEvents || []).find(e => String(e?.id || '').trim() === targetEventId);
  if (!event) return false;

  const type = String(event.type || '').toLowerCase();
  if (type === 'ooo' || type === 'custom') return false;

  const primary = String(event.noteId || '').trim();
  if (shouldLink && primary && primary === targetNoteId) return false;

  const before = normalizePlannerLinkedNoteIds(event.linkedNoteIds || []);
  const next = shouldLink
    ? normalizePlannerLinkedNoteIds([...before, targetNoteId], primary).filter(id => id !== primary)
    : normalizePlannerLinkedNoteIds(before.filter(id => id !== targetNoteId), primary).filter(id => id !== primary);

  if (JSON.stringify(before) === JSON.stringify(next)) return false;
  event.linkedNoteIds = next;

  if (type === 'call' || type === 'sync') {
    (plannerEvents || []).forEach(pe => {
      if (pe.type === 'prep' && pe.prepForEventId === event.id) {
        pe.linkedNoteIds = normalizePlannerLinkedNoteIds(next, pe.noteId || '').filter(id => id !== String(pe.noteId || '').trim());
      }
    });
  }

  await savePlanner();
  if (typeof renderPlanner === 'function') renderPlanner();
  return true;
}

async function syncPlannerAssociationsFromNote(noteId, { addedNoteId = '', addedTodoId = '' } = {}) {
  const sourceNoteId = String(noteId || '').trim();
  const nextNoteId = String(addedNoteId || '').trim();
  const nextTodoId = String(addedTodoId || '').trim();
  if (!sourceNoteId) return false;

  let changed = false;
  plannerEvents.forEach(event => {
    if (!event || String(event.noteId || '').trim() !== sourceNoteId) return;
    const type = String(event.type || '').toLowerCase();

    if (nextNoteId && nextNoteId !== sourceNoteId && type !== 'ooo' && type !== 'custom') {
      const nextLinkedNotes = normalizePlannerLinkedNoteIds([...(Array.isArray(event.linkedNoteIds) ? event.linkedNoteIds : []), nextNoteId], sourceNoteId);
      if (JSON.stringify(nextLinkedNotes) !== JSON.stringify(event.linkedNoteIds || [])) {
        event.linkedNoteIds = nextLinkedNotes;
        changed = true;
      }
    }

    if (!nextTodoId) return;
    if (type === 'todo') {
      if (!event.todoId) {
        event.todoId = nextTodoId;
        changed = true;
      }
      return;
    }
    if (type === 'call' || type === 'sync' || type === 'prep') {
      const nextLinkedTodos = normalizePlannerLinkedTodoIds([...(Array.isArray(event.linkedTodoIds) ? event.linkedTodoIds : []), nextTodoId]);
      if (JSON.stringify(nextLinkedTodos) !== JSON.stringify(event.linkedTodoIds || [])) {
        event.linkedTodoIds = nextLinkedTodos;
        changed = true;
      }
    }
  });

  if (!changed) return false;
  await savePlanner();
  if (typeof renderPlanner === 'function') renderPlanner();
  return true;
}

function getIntrinsicAssociatedNotesForPlannerEvent(event, limit = 6) {
  if (!event || !Array.isArray(plannerEvents)) return [];

  const sourceNoteId = event.noteId || '';
  const sourceDate = event.date || '';
  const byNoteId = new Map();

  const explicitLinked = getPlannerEventLinkedNoteIds(event, { includePrimary: false });
  explicitLinked.forEach(id => {
    if (id === sourceNoteId) return;
    const pseudoEvent = {
      id: `linked-${id}`,
      noteId: id,
      date: sourceDate,
      startTime: event.startTime || ''
    };
    byNoteId.set(id, pseudoEvent);
  });

  if (!event.recurrenceId) {
    return Array.from(byNoteId.values())
      .map(e => getNoteById(e.noteId))
      .filter(Boolean)
      .slice(0, Math.max(0, limit));
  }

  plannerEvents
    .filter(e => e && e.recurrenceId === event.recurrenceId && e.type !== 'prep' && e.noteId && e.noteId !== sourceNoteId)
    .forEach(e => {
      const existing = byNoteId.get(e.noteId);
      if (!existing) {
        byNoteId.set(e.noteId, e);
        return;
      }
      const existingDelta = Math.abs(new Date(existing.date || 0).getTime() - new Date(sourceDate || 0).getTime());
      const nextDelta = Math.abs(new Date(e.date || 0).getTime() - new Date(sourceDate || 0).getTime());
      if (nextDelta < existingDelta || (nextDelta === existingDelta && (e.startTime || '') < (existing.startTime || ''))) {
        byNoteId.set(e.noteId, e);
      }

      const linkedIds = getPlannerEventLinkedNoteIds(e, { includePrimary: false });
      linkedIds.forEach(id => {
        if (!id || id === sourceNoteId) return;
        if (!byNoteId.has(id)) {
          byNoteId.set(id, {
            id: `linked-${id}`,
            noteId: id,
            date: e.date || sourceDate,
            startTime: e.startTime || ''
          });
        }
      });
    });

  const noteEntries = Array.from(byNoteId.values())
    .map(e => ({ event: e, note: getNoteById(e.noteId) }))
    .filter(entry => !!entry.note)
    .sort((a, b) => {
      const aDate = a.event?.date || '';
      const bDate = b.event?.date || '';
      const dateCmp = bDate.localeCompare(aDate);
      if (dateCmp !== 0) return dateCmp;
      return (a.event?.startTime || '').localeCompare(b.event?.startTime || '');
    })
    .slice(0, Math.max(0, limit));

  return noteEntries.map(entry => entry.note);
}

// ── Event Modals: Creation & Editing ──

// Schedule overlay dialog builder
function openPlannerModal(titleText, htmlContent, onSave, onCancel, onBackdropClick) {
  document.getElementById('planner-dynamic-modal')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'planner-dynamic-modal';
  overlay.className = 'modal-overlay active';
  
  const todoOverlay = document.getElementById('todo-edit-overlay');
  const drOverlay = document.getElementById('daily-review-overlay');
  if (todoOverlay && todoOverlay.style.display !== 'none') {
    overlay.style.zIndex = '3000';
  } else if (drOverlay && drOverlay.style.display !== 'none') {
    overlay.style.zIndex = '10000';
  } else {
    overlay.style.zIndex = '2100';
  }

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.maxHeight = '90vh';
  modal.style.overflowY = 'auto';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'planner-modal-close-btn';
  closeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  closeBtn.title = t('common.close') || 'Close';
  modal.appendChild(closeBtn);

  const h2 = document.createElement('h2');
  h2.innerHTML = titleText;
  modal.appendChild(h2);

  const container = document.createElement('div');
  container.innerHTML = htmlContent;
  modal.appendChild(container);

  const actions = document.createElement('div');
  actions.className = 'modal-actions';

  const closeModal = () => {
    document.removeEventListener('keydown', handleEscape);
    if (typeof removePlannerCreatePreview === 'function') removePlannerCreatePreview();
    if (typeof clearDialogFormState === 'function') clearDialogFormState(overlay);
    overlay.remove();
    if (window.AIChatController) {
      window.AIChatController.activeSuggestionRoute = null;
    }
  };

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn';
  cancelBtn.textContent = t('editor.cancel') || 'Cancel';
  cancelBtn.title = t('editor.cancelTooltip') || t('editor.cancel') || 'Cancel';
  cancelBtn.onclick = async () => {
    if (typeof onCancel === 'function') {
      try {
        await onCancel();
      } catch (err) {
        console.warn('Error during planner modal cancel:', err);
      }
    }
    closeModal();
  };
  closeBtn.onclick = async () => {
    if (typeof onCancel === 'function') {
      try {
        await onCancel();
      } catch (err) {
        console.warn('Error during planner modal close button cancel:', err);
      }
    }
    closeModal();
  };
  actions.appendChild(cancelBtn);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn-save';
  saveBtn.textContent = t('todo.save') || 'Save';
  saveBtn.title = t('planner.saveModalTooltip') || t('todo.save') || 'Save';
  saveBtn.onclick = async () => {
    try {
      const ok = await onSave();
      if (ok !== false) {
        closeModal();
      }
    } catch (e) {
      toast(e.message, true);
    }
  };
  actions.appendChild(saveBtn);
  modal.appendChild(actions);
  overlay.appendChild(modal);

  const handleEscape = async (e) => {
    if (e.key === 'Escape' && document.getElementById('planner-dynamic-modal') === overlay) {
      const openDropdown = document.querySelector('.tag-suggest-dropdown');
      if (openDropdown) return;
      if (typeof onBackdropClick === 'function') {
        try {
          const handled = await onBackdropClick();
          if (handled !== false) {
            closeModal();
            return;
          }
        } catch (err) {
          console.warn('Error during planner escape handling:', err);
        }
      }
      closeModal();
    }
  };
  document.addEventListener('keydown', handleEscape);

  // Click outside modal to close (or save draft if creating)
  overlay.addEventListener('click', async (e) => {
    if (e.target === overlay) {
      if (typeof onBackdropClick === 'function') {
        try {
          const handled = await onBackdropClick();
          if (handled !== false) {
            closeModal();
            return;
          }
        } catch (err) {
          console.warn('Error during planner backdrop click handling:', err);
        }
      }
      closeModal();
    } else {
      // Close custom dropdown lists if clicking outside their wrappers
      const noteComboWrap = document.getElementById('pe-note-combobox-wrap');
      if (noteComboWrap && !noteComboWrap.contains(e.target)) {
        const list = document.getElementById('pe-note-selector-list');
        if (list) list.style.display = 'none';
      }
      const linkedNotesWrap = document.getElementById('pe-linked-notes-search-wrap');
      if (linkedNotesWrap && !linkedNotesWrap.contains(e.target)) {
        const list = document.getElementById('pe-linked-notes-list');
        if (list) list.style.display = 'none';
      }
      const linkedTodosWrap = document.getElementById('pe-linked-todos-search-wrap');
      if (linkedTodosWrap && !linkedTodosWrap.contains(e.target)) {
        const list = document.getElementById('pe-linked-todos-list');
        if (list) list.style.display = 'none';
      }
      const todoDropdownWrap = document.getElementById('pe-todo-search-wrap');
      if (todoDropdownWrap && !todoDropdownWrap.contains(e.target)) {
        const list = document.getElementById('pe-todo-dropdown');
        if (list) list.style.display = 'none';
      }
    }
  });

  document.body.appendChild(overlay);
}

function getHeaderPrefixAndSuffix(type, lang, isEdit = false) {
  let prefix = '';
  let suffix = '';

  // Types that are grammatically feminine in French
  const feminineTypes = new Set(['sync', 'prep', 'todo', 'work']);
  const isFeminine = feminineTypes.has(type);

  if (isEdit) {
    if (type === 'ooo') {
      prefix = t('planner.headerModifyOoo');
    } else if (isFeminine) {
      prefix = t('planner.headerEditFeminine');
    } else {
      prefix = t('planner.headerEdit');
    }
    suffix = t('planner.headerSuffixEdit');
  } else {
    if (type === 'ooo') {
      prefix = t('planner.headerMarkOoo');
      suffix = t('planner.headerSuffixOoo');
    } else if (isFeminine) {
      prefix = t('planner.headerScheduleFeminine');
      suffix = t('planner.headerSuffixSchedule');
    } else {
      prefix = t('planner.headerSchedule');
      suffix = t('planner.headerSuffixSchedule');
    }
  }
  return {
    prefix: typeof prefix === 'string' ? prefix : '',
    suffix: typeof suffix === 'string' ? suffix : ''
  };
}

function getHeaderOptionsHtml(lang, currentType) {
  const isSelected = (t_val) => t_val === currentType ? 'selected' : '';
  const types = currentType === 'personal'
    ? ['call', 'sync', 'prep', 'todo', 'work', 'ooo', 'custom', 'personal']
    : ['call', 'sync', 'prep', 'todo', 'work', 'ooo', 'custom'];
  return types.map(type => {
    const label = t('planner.' + type) || type;
    // Nur das reine Label zurückgeben, da die Erklärung im separaten Info-Kasten steht
    return `<option value="${type}" ${isSelected(type)}>${escH(label)}</option>`;
  }).join('\n        ');
}

// Open Plan Event overlay
// ─── OOO full-day helpers ────────────────────────────────────────────────────

/**
 * Return an array of YYYY-MM-DD strings for every date in [startStr, endStr] inclusive.
 */
function getAllDatesInRange(startStr, endStr) {
  const dates = [];
  const start = parseLocalDateValue(startStr);
  const end = parseLocalDateValue(endStr || startStr);
  if (!start || !end) return dates;
  const cur = new Date(start);
  while (cur <= end) {
    dates.push(formatLocalDateValue(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function _setPlannerModalFieldVisible(el, visible, animate = true) {
  if (!el) return;
  if (visible) {
    const isCurrentlyHidden = el.style.display === 'none';
    el.style.display = '';
    if (animate && isCurrentlyHidden) {
      el.classList.remove('planner-field-animate-in');
      void el.offsetWidth;
      el.classList.add('planner-field-animate-in');
    }
  } else {
    el.style.display = 'none';
    el.classList.remove('planner-field-animate-in');
  }
}

/**
 * Toggle the time-fields row and end-date row visibility for OOO full-day mode.
 * Called from the allday checkbox onchange and from togglePlannerModalFields.
 */
function _plannerToggleOooAllDay(checked, animate = true) {
  // Hide/show start-time, duration, end-time wrappers (keep date wrapper visible)
  const startTimeWrapper = document.getElementById('pe-start-time')?.closest('.pe-time-field-wrapper');
  const durationWrapper = document.getElementById('pe-duration')?.closest('.pe-time-field-wrapper');
  const endTimeWrapper = document.getElementById('pe-end-time-field') || document.getElementById('pe-end-time')?.closest('.pe-time-field-wrapper');
  if (startTimeWrapper) _setPlannerModalFieldVisible(startTimeWrapper, !checked, animate);
  if (durationWrapper)  _setPlannerModalFieldVisible(durationWrapper, !checked, animate);
  if (endTimeWrapper) {
    const durEl = document.getElementById('pe-duration');
    const isCustom = durEl?.value === 'custom';
    _setPlannerModalFieldVisible(endTimeWrapper, !checked && isCustom, animate);
  }

  // Hide suggestions container as well
  const suggestionsContainer = document.getElementById('pe-time-suggestions');
  if (suggestionsContainer) _setPlannerModalFieldVisible(suggestionsContainer, !checked, animate);

  const endDateRow = document.getElementById('pe-ooo-enddate-row');
  if (endDateRow) _setPlannerModalFieldVisible(endDateRow, checked, animate);

  // Hide recurrence when full-day (recurrence doesn't make sense for multi-day OOO)
  const recurrenceBtn = document.getElementById('pe-recurrence-btn');
  if (recurrenceBtn) _setPlannerModalFieldVisible(recurrenceBtn, !checked, animate);
}

/**
 * After saving a full-day OOO event, prompt the user to remove overlapping non-OOO events.
 */
async function promptCancelOverlappingBlocs(oooEvent) {
  const dates = getAllDatesInRange(oooEvent.date, oooEvent.endDate || oooEvent.date);
  if (!dates.length) return;
  const overlapping = plannerEvents.filter(e =>
    e.id !== oooEvent.id &&
    e.type !== 'ooo' &&
    dates.includes(e.date)
  );
  if (!overlapping.length) return;

  const msgTemplate = t('planner.oooRemoveOverlappingConfirm') ||
    'This OOO period covers {count} event(s) across {days} day(s). Would you like to remove them all?';
  const msg = msgTemplate
    .replace('{count}', overlapping.length)
    .replace('{days}', dates.length);

  const confirmed = await showConfirmDialog(msg, {
    title: t('planner.oooRemoveOverlappingTitle') || 'Remove overlapping events?',
    confirmLabel: t('planner.oooRemoveOverlappingBtn') || 'Remove events',
    isDanger: true
  });
  if (!confirmed) return;

  const toRemove = new Set(overlapping.map(e => e.id));
  plannerEvents = plannerEvents.filter(e => !toRemove.has(e.id));
  await savePlanner();
  renderPlanner();
  const toastTemplate = t('planner.oooOverlappingRemovedToast') || '{count} event(s) removed.';
  toast(toastTemplate.replace('{count}', overlapping.length));
}

// ─── End OOO full-day helpers ────────────────────────────────────────────────

// Remove workstream from planner event
async function removeWorkstreamFromPlannerEvent(event, wsName) {
  if (!event) return;
  const cleanTarget = String(wsName || '').trim().toLowerCase();
  const currentList = Array.isArray(event.workstreams)
    ? [...event.workstreams]
    : (event.workstream ? event.workstream.split(',').map(s => s.trim()).filter(Boolean) : []);

  const updated = currentList.filter(w => w.toLowerCase() !== cleanTarget);
  event.workstreams = updated;
  event.workstream = updated.join(', ');

  if (!Array.isArray(event.excluded_workstreams)) {
    event.excluded_workstreams = [];
  }
  if (!event.excluded_workstreams.some(w => w.toLowerCase() === cleanTarget)) {
    event.excluded_workstreams.push(wsName);
  }

  const domMajors = (typeof readTagEditor === 'function' && document.getElementById('pe-major-tags'))
    ? readTagEditor('pe-major-tags')
    : (event.major_topic_tags || []);
  const newMajors = domMajors.filter(m => m.toLowerCase() !== cleanTarget);
  event.major_topic_tags = newMajors;
  if (typeof populateTagEditor === 'function' && document.getElementById('pe-major-tags')) {
    populateTagEditor('pe-major-tags', newMajors, 'major');
  }

  if (event.noteId && typeof syncPlannerEventTagsToLinkedNote === 'function') {
    syncPlannerEventTagsToLinkedNote(event);
  }

  populatePlannerEventWorkstreamEditor(event);
}
window.removeWorkstreamFromPlannerEvent = removeWorkstreamFromPlannerEvent;

// Assign planner event to workstream and fill tags from favored selection group
async function assignPlannerEventToWorkstream(event, wsName) {
  if (!event) return;

  if (!wsName) {
    event.workstream = '';
    event.workstreams = [];
    event.excluded_workstreams = [];
  } else {
    const list = Array.isArray(event.workstreams)
      ? [...event.workstreams]
      : (event.workstream ? event.workstream.split(',').map(s => s.trim()).filter(Boolean) : []);
    if (!list.some(w => w.toLowerCase() === wsName.toLowerCase())) {
      list.push(wsName);
    }
    event.workstreams = list;
    event.workstream = list.join(', ');

    if (Array.isArray(event.excluded_workstreams)) {
      event.excluded_workstreams = event.excluded_workstreams.filter(w => w.toLowerCase() !== wsName.toLowerCase());
    }

    let memory = null;
    if (typeof WorkstreamMemoryEngine !== 'undefined' && typeof WorkstreamMemoryEngine.getMajorTopicMemory === 'function') {
      try {
        memory = await WorkstreamMemoryEngine.getMajorTopicMemory(wsName);
      } catch (e) {
        console.warn('Failed to load workstream memory for planner event assignment', e);
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

    if (tgGroup && typeof populateTagEditor === 'function' && document.getElementById('pe-group-tags')) {
      populateTagEditor('pe-group-tags', [tgGroup], 'group');
      event.group_tags = [tgGroup];
    }
    if (tgMajor && typeof populateTagEditor === 'function' && document.getElementById('pe-major-tags')) {
      populateTagEditor('pe-major-tags', [tgMajor], 'major');
      event.major_topic_tags = [tgMajor];
    }
    if (tgTopic && typeof populateTagEditor === 'function' && document.getElementById('pe-topic-tags')) {
      populateTagEditor('pe-topic-tags', [tgTopic], 'topic');
      event.topic_tags = [tgTopic];
    }

    if (event.noteId && typeof syncPlannerEventTagsToLinkedNote === 'function') {
      syncPlannerEventTagsToLinkedNote(event);
    }
  }

  populatePlannerEventWorkstreamEditor(event);
}
window.assignPlannerEventToWorkstream = assignPlannerEventToWorkstream;

// Populate workstream chips in planner event modal
function populatePlannerEventWorkstreamEditor(event) {
  const container = document.getElementById('pe-workstream-chip-selector');
  if (!container) return;

  const liveGroups = (typeof readTagEditor === 'function' && document.getElementById('pe-group-tags'))
    ? readTagEditor('pe-group-tags')
    : (event?.group_tags || []);
  const liveMajors = (typeof readTagEditor === 'function' && document.getElementById('pe-major-tags'))
    ? readTagEditor('pe-major-tags')
    : (event?.major_topic_tags || []);
  const liveTopics = (typeof readTagEditor === 'function' && document.getElementById('pe-topic-tags'))
    ? readTagEditor('pe-topic-tags')
    : (event?.topic_tags || []);

  const tempItem = {
    ...event,
    group_tags: liveGroups,
    major_topic_tags: liveMajors,
    topic_tags: liveTopics,
    workstream: event?.workstream || '',
    workstreams: Array.isArray(event?.workstreams) ? event.workstreams : (event?.workstream ? event.workstream.split(',').map(s => s.trim()).filter(Boolean) : [])
  };

  const workstreamDetails = (typeof detectWorkstreamDetailsForNote === 'function')
    ? detectWorkstreamDetailsForNote(tempItem, { group_tags: liveGroups, major_topic_tags: liveMajors, topic_tags: liveTopics })
    : [];

  const activeWorkstreamNames = workstreamDetails.map(d => d.name);
  if (event) {
    event.workstreams = activeWorkstreamNames;
    event.workstream = activeWorkstreamNames.join(', ');
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
        togglePlannerWorkstreamDropdown(chipWrapper, activeWorkstreamNames, event);
      };

      if (!isAuto) {
        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'workstream-chip-clear-btn';
        clearBtn.title = (typeof t === 'function' && t('editor.clearWorkstreamTooltip')) || `Remove ${ws} from block`;
        clearBtn.innerHTML = '✕';
        clearBtn.onclick = async (e) => {
          e.stopPropagation();
          await removeWorkstreamFromPlannerEvent(event, ws);
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
      togglePlannerWorkstreamDropdown(chipWrapper, activeWorkstreamNames, event);
    };
    chipWrapper.appendChild(addBtn);
  } else {
    const emptyChip = document.createElement('span');
    emptyChip.className = 'workstream-chip workstream-chip-empty';
    emptyChip.title = (typeof t === 'function' && t('editor.addWorkstreamTooltip')) || 'Assign this block to a workstream';
    emptyChip.innerHTML = `<span>${escH((typeof t === 'function' && t('editor.noWorkstream')) || 'None')}</span> <span style="font-size:0.65rem;opacity:0.6;">▾</span>`;
    emptyChip.onclick = (e) => {
      e.stopPropagation();
      togglePlannerWorkstreamDropdown(chipWrapper, [], event);
    };
    chipWrapper.appendChild(emptyChip);
  }

  container.appendChild(chipWrapper);
}
window.populatePlannerEventWorkstreamEditor = populatePlannerEventWorkstreamEditor;

// Toggle dropdown for workstream selection in planner event modal
function togglePlannerWorkstreamDropdown(wrapper, activeWorkstreams = [], event = null) {
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
  noneItem.title = t('editor.clearWorkstreamTooltip') || 'Remove all workstreams from block';
  noneItem.innerHTML = `<span>${escH(t('editor.noWorkstream') || 'None')}</span>${isNone ? '<span>✓</span>' : ''}`;
  noneItem.onclick = async (e) => {
    e.stopPropagation();
    menu.remove();
    if (event) {
      const details = (typeof detectWorkstreamDetailsForNote === 'function')
        ? detectWorkstreamDetailsForNote(event)
        : [];
      const autoMatched = details.filter(d => d.isSelectionGroupMatch);
      if (autoMatched.length > 0 && typeof toast === 'function') {
        toast(t('editor.workstreamAutoMatchedCannotRemoveToast') || 'This workstream is matched by tags. Change the tags to remove it.');
      }
      await assignPlannerEventToWorkstream(event, '');
    }
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
        if (event) {
          if (isActive) {
            const details = (typeof detectWorkstreamDetailsForNote === 'function')
              ? detectWorkstreamDetailsForNote(event)
              : [];
            const currentDetail = details.find(d => d.name.toLowerCase() === ws.toLowerCase());
            if (currentDetail?.isSelectionGroupMatch) {
              if (typeof toast === 'function') {
                toast(t('editor.workstreamAutoMatchedCannotRemoveToast') || 'This workstream is matched by tags. Change the tags to remove it.');
              }
            } else {
              await removeWorkstreamFromPlannerEvent(event, ws);
            }
          } else {
            await assignPlannerEventToWorkstream(event, ws);
          }
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
window.togglePlannerWorkstreamDropdown = togglePlannerWorkstreamDropdown;

function openPlanEventModal(prefill = {}) {

  _customRecurrenceDates = [];
  const isDraft = Boolean(prefill._isDraft || prefill._proposalSource === 'Draft' || (prefill._proposalId && getPlannerProposals().some(p => p.id === prefill._proposalId && (p.isDraft || p.source === 'Draft'))));
  const currentPlannerEvents = (typeof plannerEvents !== 'undefined' && Array.isArray(plannerEvents))
    ? plannerEvents
    : ((typeof window !== 'undefined' && Array.isArray(window.plannerEvents)) ? window.plannerEvents : []);
  const isExistingEvent = Boolean(prefill.id && currentPlannerEvents.some(e => e && e.id === prefill.id));
  const isProposal = !isExistingEvent && !isDraft && Boolean(prefill._proposalId || (prefill.proposalId && !prefill.id));
  const isEdit = isExistingEvent || (!isProposal && !isDraft && !!prefill.id);
  const defDur = typeof defaultPlannerDuration === 'number' ? defaultPlannerDuration : 30;

  let nextDate = prefill.date;
  let nextStart = prefill.startTime;
  let nextEnd = prefill.endTime;

  if (!isEdit && (!nextDate || !nextStart)) {
    const slot = findNextAvailablePlannerSlot(defDur);
    if (!nextDate) nextDate = slot.date;
    if (!nextStart) nextStart = slot.startTime;
    if (!nextEnd) nextEnd = slot.endTime;
  }

  const validTypes = new Set(['call', 'sync', 'prep', 'todo', 'work', 'ooo', 'custom', 'personal']);
  let initialType = String(prefill.type || '').trim().toLowerCase();
  if (!validTypes.has(initialType)) {
    initialType = (typeof inferPlannerEventType === 'function')
      ? inferPlannerEventType(prefill.title, prefill.context || prefill.description || '')
      : 'call';
  }

  const event = isEdit ? { ...prefill } : {
    id: 'evt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    proposalId: prefill._proposalId || prefill.proposalId || '',
    _isDraft: isDraft,
    type: initialType,
    title: (typeof cleanTaskTitleText === 'function') ? cleanTaskTitleText(prefill.title || '') : (prefill.title || ''),
    date: nextDate || formatLocalDateValue(new Date()),
    startTime: nextStart || '10:00',
    endTime: nextEnd || minutesToTime(timeToMinutes(nextStart || '10:00') + defDur),
    todoId: prefill.todoId || '',
    prepForEventId: prefill.prepForEventId || '',
    noteId: prefill.noteId || '',
    collaboratorIds: prefill.collaboratorIds || [],
    collaborators: prefill.collaborators || [],
    group_tags: prefill.group_tags || [],
    major_topic_tags: prefill.major_topic_tags || [],
    topic_tags: prefill.topic_tags || [],
    context: prefill.context || prefill.description || '',
    description: prefill.description || prefill.context || '',
    linkedNoteIds: prefill.linkedNoteIds || []
  };

  if (isEdit && !validTypes.has(String(event.type || '').trim().toLowerCase())) {
    event.type = initialType;
  }

  // Preserve allDay and endDate for existing full-day OOO blocks
  if (prefill.allDay !== undefined) event.allDay = prefill.allDay;
  if (prefill.endDate !== undefined) event.endDate = prefill.endDate;
  const initialEventDate = isEdit ? String(prefill.date || event.date || '').trim() : '';

  const inferredLinkedIds = (isEdit && typeof getIntrinsicAssociatedNotesForPlannerEvent === 'function')
    ? getIntrinsicAssociatedNotesForPlannerEvent(event, 12).map(n => n.id).filter(Boolean)
    : [];
  const initialLinkedNoteIds = Array.from(new Set([
    ...(Array.isArray(event.linkedNoteIds) ? event.linkedNoteIds : []),
    ...inferredLinkedIds
  ].map(v => String(v || '').trim()).filter(Boolean))).filter(id => id !== event.noteId);
  const initialLinkedTodoIds = Array.from(new Set(
    getPlannerEventLinkedTodoIds(event, { includePrimary: false }).map(v => String(v || '').trim()).filter(Boolean)
  ));
  const pendingPrimaryNoteTransferByNoteId = new Map();

  let parentEvent = null;
  if (!event.recurrenceId && event.recurrenceRule) {
    event.recurrenceId = 'rec-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    const existing = (plannerEvents || []).find(e => e && e.id === event.id);
    if (existing) existing.recurrenceId = event.recurrenceId;
  }
  if (!event.recurrenceId && isEdit) {
    const candidateParent = (plannerEvents || []).find(p => p && p.id !== event.id && p.recurrenceRule && p.type === event.type && p.title === event.title && typeof shouldEventOccurOnDate === 'function' && shouldEventOccurOnDate(p, event.date));
    if (candidateParent) {
      if (!candidateParent.recurrenceId) {
        candidateParent.recurrenceId = 'rec-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      }
      event.recurrenceId = candidateParent.recurrenceId;
      parentEvent = candidateParent;
      const existing = (plannerEvents || []).find(e => e && e.id === event.id);
      if (existing) existing.recurrenceId = event.recurrenceId;
    }
  }
  if (event.recurrenceId && !parentEvent) {
    parentEvent = (plannerEvents || []).find(e => e && e.recurrenceId === event.recurrenceId && e.recurrenceRule);
  }
  const recRule = parentEvent ? parentEvent.recurrenceRule : (event.recurrenceRule || null);
  const recInterval = recRule ? recRule.interval : 1;
  const recUnit = recRule ? recRule.unit : 'week';
  const recNoEnd = recRule ? !recRule.until : false;

  const evDate = parseLocalDateValue(event.date) || new Date();
  const defaultUntil = new Date(evDate);
  defaultUntil.setMonth(defaultUntil.getMonth() + 6);
  const defaultUntilStr = formatLocalDateValue(defaultUntil);

  const recUntilVal = (recRule && recRule.until) ? recRule.until : defaultUntilStr;
  const recWorkdaysOnly = recRule ? !!recRule.workdaysOnly : false;
  const recWeekdays = (recRule && Array.isArray(recRule.weekdays) && recRule.weekdays.length)
    ? recRule.weekdays
    : [evDate.getDay()];
  const recMonthlyType = recRule ? (recRule.monthlyType || 'day_of_month') : 'day_of_month';
  const recMonthlyDay = recRule ? (recRule.monthlyDay || evDate.getDate()) : evDate.getDate();
  const recMonthlyNth = recRule ? (recRule.monthlyNth !== undefined ? recRule.monthlyNth : 1) : 1;
  const recMonthlyWeekday = recRule ? (recRule.monthlyWeekday !== undefined ? recRule.monthlyWeekday : evDate.getDay()) : evDate.getDay();
  const initialRecSummary = recRule ? formatPlannerRecurrenceRuleSummary(recRule, event.date) : (t('planner.repeatEvent') || 'Repeat Event...');

  if (event.noteId) {
    const note = manifest.find(n => n.id === event.noteId);
    if (note) {
      if (note.topic_tags && note.topic_tags.length > 0 && (!event.collaborators || event.collaborators.length === 0)) {
        event.collaborators = [...note.topic_tags];
      }
      if ((!Array.isArray(event.collaboratorIds) || event.collaboratorIds.length === 0) && Array.isArray(event.collaborators)) {
        event.collaboratorIds = (typeof normalizePlannerCollaboratorIds === 'function')
          ? normalizePlannerCollaboratorIds(event.collaborators, { allowCreate: false })
          : event.collaborators;
      }
      if (Array.isArray(event.collaboratorIds) && event.collaboratorIds.length > 0 && typeof getPlannerCollaboratorLabelsByIds === 'function') {
        event.collaborators = getPlannerCollaboratorLabelsByIds(event.collaboratorIds);
      }
      if (!event.group_tags || event.group_tags.length === 0) event.group_tags = note.group_tags || [];
      if (!event.major_topic_tags || event.major_topic_tags.length === 0) event.major_topic_tags = note.major_topic_tags || [];
      if (!event.topic_tags || event.topic_tags.length === 0) event.topic_tags = note.topic_tags || [];

      if (!isEdit) {
        const isSync = (note.group_tags || []).some(g => g.toLowerCase() === 'sync');
        if (isSync) {
          event.type = 'sync';
        }
      }
    }
  }

  const openTodos = todosManifest.filter(t => t.priority !== 'Done' && isUserTask(t));
  // Calls planned this week
  const activeWeekCalls = plannerEvents.filter(e => e.type === 'call');
  const defaultDummyNoteLabel = t('planner.defaultDummyNoteLabel') || 'Create Template Note';
  const defaultDummyNoteHint = t('planner.defaultDummyNoteHint') || 'Click here to create now, remove to change';

  const curDur = _calcDurationMins(event.startTime, event.endTime);
  const standardDurOpts = [15, 30, 45, 60, 90, 120, 180];
  const isCustomDur = !standardDurOpts.includes(curDur);

  const modalHtml = `
    <!-- Proposal / Draft notice banner -->
    ${isDraft ? `
      <div class="planner-draft-notice-banner">
        <svg class="app-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
        <span><strong>${escH(t('planner.draftBannerTitle') || 'Draft Block')}:</strong> ${escH(t('planner.draftBannerDesc') || 'Unsaved block draft. Click Save to confirm or Cancel to delete.')}</span>
      </div>
    ` : (isProposal ? `
      <div class="planner-proposal-notice-banner" style="display:flex;align-items:center;gap:8px;padding:8px 12px;margin-bottom:0.8rem;background:color-mix(in srgb, var(--accent) 15%, var(--card-bg));border:1.5px dashed var(--accent);border-radius:var(--radius-sm);font-size:0.85rem;color:var(--text);">
        <svg class="app-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>
        <span><strong>${escH(t('planner.reviewProposedModalTitle'))}:</strong> ${escH(prefill._proposalSource || t('planner.proposedByAgent'))}</span>
      </div>
    ` : '')}

    <!-- Series notice banner when event is part of a recurring series -->
    ${event.recurrenceId ? `
      <div class="planner-series-notice-banner">
        <span class="planner-series-notice-banner-text">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          ${escH(t('planner.partOfSeriesNotice') || 'This session is part of a recurring series. Modifying it will only affect this individual block.')}
        </span>
        <button type="button" class="btn btn-sm" style="display:inline-flex;align-items:center;gap:6px;" onclick="document.getElementById('planner-dynamic-modal')?.remove(); openPlannerSeriesModal(${jq(event.recurrenceId)}, ${jq(event.id)})" title="${escA(t('planner.editSeriesInsteadTooltip') || 'Open modal to configure the entire recurring series')}">
          ${_renderPlannerSvgIcon('repeat', 13)} <span>${escH(t('planner.editSeriesInstead') || 'Edit Series...')}</span>
        </button>
      </div>
    ` : ''}

    <!-- Card 1: Event Details & Title -->
    <div class="pe-modal-card-group" id="pe-section-details">
      <div class="pe-modal-card-group-header">
        ${_renderPlannerSvgIcon('settings', 15)} <span>${escH(t('planner.eventDetails') || 'Event Details')}</span>
      </div>
      <!-- Title (shown for Call, OOO, Custom, Work) -->
      <div class="field-row" id="pe-title-field" style="margin-bottom:0.4rem">
        <span class="field-label">${t('planner.title')}</span>
        <input type="text" id="pe-title" class="field-input" value="${escA(event.title)}" placeholder="${escA(t('planner.eventTitlePlaceholder') || 'Event title…')}">
      </div>
      <!-- Dynamic Type Explanation Box -->
      <div id="pe-type-explanation" style="font-size: 0.75rem; color: var(--text-muted); background: var(--card-bg); padding: 0.5rem 0.75rem; border-left: 3px solid var(--accent); border-radius: var(--radius-sm); margin-top: 0.4rem; margin-bottom: 0.2rem; line-height: 1.4;"></div>
    </div>

    <!-- Card 2: Schedule & Timing -->
    <div class="pe-modal-card-group" id="pe-section-schedule">
      <div class="pe-modal-card-group-header">
        ${_renderPlannerSvgIcon('clock', 15)} <span>${escH(t('planner.seriesScheduleSettings') || 'Schedule & Timing')}</span>
      </div>

      <!-- Time fields -->
      <div id="pe-time-fields-row" style="display:flex;gap:0.75rem;flex-wrap:wrap;margin-bottom:0.5rem;width:100%;">
        <div class="pe-time-field-wrapper" style="flex:1;min-width:140px;margin-bottom:0;display:flex;flex-direction:column;gap:4px;">
          <span class="field-label" style="width:auto;margin-right:0;">${t('planner.date')}</span>
          <input type="date" id="pe-date" class="field-input" value="${event.date}" style="width:100%;">
        </div>
        <div class="pe-time-field-wrapper" style="flex:1;min-width:120px;margin-bottom:0;display:flex;flex-direction:column;gap:4px;">
          <span class="field-label" style="width:auto;margin-right:0;">${t('planner.startTime')}</span>
          <input type="time" id="pe-start-time" class="field-input" value="${event.startTime}" oninput="_plannerSyncDuration()" style="width:100%;">
        </div>
        <div class="pe-time-field-wrapper" style="flex:1;min-width:110px;margin-bottom:0;display:flex;flex-direction:column;gap:4px;">
          <span class="field-label" style="width:auto;margin-right:0;">${t('planner.durationLabel') || 'Dur.'}</span>
          <select id="pe-duration" class="field-input" oninput="_plannerSyncEndFromDuration()" style="width:100%;">
            <option value="15" ${curDur === 15 ? 'selected' : ''}>${t('planner.duration15m') || '15 min'}</option>
            <option value="30" ${curDur === 30 ? 'selected' : ''}>${t('planner.duration30m') || '30 min'}</option>
            <option value="45" ${curDur === 45 ? 'selected' : ''}>${t('planner.duration45m') || '45 min'}</option>
            <option value="60" ${curDur === 60 ? 'selected' : ''}>${t('planner.duration1h') || '1 h'}</option>
            <option value="90" ${curDur === 90 ? 'selected' : ''}>${t('planner.duration1h30m') || '1 h 30'}</option>
            <option value="120" ${curDur === 120 ? 'selected' : ''}>${t('planner.duration2h') || '2 h'}</option>
            <option value="180" ${curDur === 180 ? 'selected' : ''}>${t('planner.duration3h') || '3 h'}</option>
            <option value="custom" ${isCustomDur ? 'selected' : ''}>${t('planner.customEndTime') || 'Custom end time'}</option>
          </select>
        </div>
        <div class="pe-time-field-wrapper" style="flex:1;min-width:120px;margin-bottom:0;display:${isCustomDur ? 'flex' : 'none'};flex-direction:column;gap:4px;" id="pe-end-time-field">
          <span class="field-label" style="width:auto;margin-right:0;">${t('planner.endTime')}</span>
          <input type="time" id="pe-end-time" class="field-input" value="${event.endTime}" oninput="_plannerSyncDurationFromEnd()" style="width:100%;">
        </div>
      </div>

      <!-- Preparation Option moved to Schedule/Timing! -->
      <div id="pe-call-options-group" class="field-row" style="display:none; margin-top:0.3rem; margin-bottom:0.5rem; padding: 0.35rem 0.5rem; background: color-mix(in srgb, var(--accent) 8%, transparent); border-radius: var(--radius-sm); border: 1px dashed color-mix(in srgb, var(--accent) 35%, transparent);">
        <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.82rem; cursor:pointer; font-weight: 500;">
          <input type="checkbox" id="pe-create-prep" style="width: auto; margin: 0; accent-color: var(--accent);">
          <span>${escH(t('planner.automaticallyScheduleCallPrep') || 'Automatically schedule 30m call prep beforehand')}</span>
        </label>
      </div>

      <!-- OOO Full Day controls (only visible when type=ooo) -->
      <div id="pe-ooo-controls" style="display:none; margin-bottom:0.5rem; margin-top:0.2rem;">
        <label style="display:flex; align-items:center; gap:0.5rem; cursor:pointer; font-weight:500; font-size:0.85rem; margin-bottom:0.5rem;">
          <input type="checkbox" id="pe-ooo-allday" style="width:auto;margin:0;" onchange="_plannerToggleOooAllDay(this.checked)">
          <span>${escH(t('planner.oooFullDay') || 'Full day (covers entire day)')}</span>
        </label>
        <div id="pe-ooo-enddate-row" style="display:none; align-items:center; gap:0.6rem; flex-wrap:wrap; font-size:0.85rem;">
          <span class="field-label" style="width:auto;margin-right:0;">${escH(t('planner.oooEndDate') || 'End date')}</span>
          <input type="date" id="pe-ooo-enddate" class="field-input" value="${escA(event.endDate || event.date || '')}" style="flex:1; min-width:130px;">
        </div>
      </div>

      <!-- Recurrence Trigger Button (only for standalone events) -->
      ${(!event.recurrenceId) ? `
        <button type="button" class="btn ${recRule ? 'btn-save' : ''}" id="pe-recurrence-btn" onclick="openPlannerRecurrenceOverlay(event)" title="${escA(t('planner.recurrenceTooltip'))}" style="margin-top:0.15rem; margin-bottom:0.4rem; align-self: flex-start; width: auto; max-width: max-content; display: inline-flex; align-items: center; gap: 6px;">
          <span style="display:inline-flex;align-items:center;gap:6px;">${_renderPlannerSvgIcon('repeat', 14)} <span>${escH(initialRecSummary)}</span></span>
        </button>
      ` : ''}

      <!-- Recurrence Absolute Popover Overlay -->
      <div id="pe-recurrence-overlay" class="planner-recurrence-overlay" style="display: none;">
        <h3 style="margin-top: 0; color: var(--accent); display: flex; align-items: center; gap: 8px;">${_renderPlannerSvgIcon('repeat', 16)} <span>${escH(t('planner.recurrence') || 'Recurrence')}</span></h3>
        
        <label style="display: flex; align-items: center; gap: 0.25rem; cursor: pointer; margin-bottom: 0.5rem; font-weight: 600;">
          <input type="checkbox" id="pe-recurrence-enabled" ${recRule ? 'checked' : ''} onchange="togglePlannerRecurrenceEnabled(this.checked)">
          <span>${escH(t('planner.repeatEvent') || 'Repeat this event')}</span>
        </label>

        <div id="pe-recurrence-overlay-content" style="display:flex; flex-direction:column; gap:0.75rem; font-size:0.85rem; opacity: ${recRule ? '1' : '0.5'}; pointer-events: ${recRule ? 'auto' : 'none'};">
          <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
            <span>${escH(t('planner.repeatLabel') || 'Every')}</span>
            <input type="number" id="pe-recurrence-interval" value="${recInterval}" min="1" max="99" class="field-input" oninput="updateRecurrenceButtonLabel()" style="width: 60px; text-align: center;" title="${escA(t('planner.repeatLabel') || 'Repeat interval')}">
            <span>${escH(t('planner.everyLabel') || 'unit(s)')}</span>
            <select id="pe-recurrence-unit" class="field-input" onchange="_togglePlannerRecurrenceUnit(this.value, 'pe')" style="width: 100px;" title="${escA(t('planner.everyLabel') || 'Repeat unit')}">
              <option value="day" ${recUnit === 'day' ? 'selected' : ''}>${escH(t('planner.dayLabel') || 'day(s)')}</option>
              <option value="week" ${recUnit === 'week' ? 'selected' : ''}>${escH(t('planner.weekLabel') || 'week(s)')}</option>
              <option value="month" ${recUnit === 'month' ? 'selected' : ''}>${escH(t('planner.monthLabel') || 'month(s)')}</option>
              <option value="year" ${recUnit === 'year' ? 'selected' : ''}>${escH(t('planner.yearLabel') || 'year(s)')}</option>
            </select>
          </div>

          <!-- Daily workdays only option -->
          <div id="pe-recurrence-daily-wrap" style="display: ${recUnit === 'day' ? 'flex' : 'none'}; align-items: center; gap: 0.35rem;">
            <label style="display: inline-flex; align-items: center; gap: 6px; cursor: pointer;" title="${escA(t('planner.repeatWorkdaysOnlyTooltip'))}">
              <input type="checkbox" id="pe-recurrence-workdays-only" ${recWorkdaysOnly ? 'checked' : ''} onchange="updateRecurrenceButtonLabel()" style="accent-color: var(--accent);">
              <span>${escH(t('planner.repeatWorkdaysOnly') || 'Workdays only (Mon-Fri)')}</span>
            </label>
          </div>

          <!-- Weekly days selector -->
          <div id="pe-recurrence-weekly-wrap" style="display: ${recUnit === 'week' ? 'flex' : 'none'}; flex-direction: column; gap: 0.3rem;">
            <span style="font-size: 0.78rem; color: var(--text-muted);">${escH(t('planner.repeatDaysLabel') || 'Repeat on')}:</span>
            <div id="pe-recurrence-weekdays" style="display: flex; gap: 4px; flex-wrap: wrap;">
              ${_PLANNER_WEEKDAY_DEFS.map(d => {
                const isSel = recWeekdays.includes(d.day);
                return `
                  <button type="button" class="btn btn-sm planner-weekday-pill ${isSel ? 'active' : ''}" data-day="${d.day}" onclick="_togglePlannerWeekdayPill(this)" title="${escA(t('planner.weekdayToggleTooltip'))}: ${escA(t(d.fullKey) || d.fallbackFull)}" style="min-width: 32px; padding: 2px 6px; font-size: 0.75rem; font-weight: 600; text-align: center; border-radius: var(--radius-sm, 6px); ${isSel ? 'background: var(--accent); color: #fff; border-color: var(--accent);' : ''}">
                    ${escH(t(d.key) || d.fallback)}
                  </button>
                `;
              }).join('')}
            </div>
          </div>

          <!-- Monthly pattern selector -->
          <div id="pe-recurrence-monthly-wrap" style="display: ${recUnit === 'month' ? 'flex' : 'none'}; flex-direction: column; gap: 0.4rem;">
            <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
              <span style="font-size: 0.78rem; color: var(--text-muted);">${escH(t('planner.monthlyPatternLabel') || 'Monthly pattern')}:</span>
              <select id="pe-recurrence-monthly-type" class="field-input" onchange="_togglePlannerMonthlyType(this.value, 'pe')" style="flex: 1; min-width: 170px; font-size: 0.78rem;" title="${escA(t('planner.monthlyPatternLabel') || 'Monthly pattern')}">
                <option value="day_of_month" ${recMonthlyType === 'day_of_month' ? 'selected' : ''} title="${escA(t('planner.monthlyOnDayTooltip'))}">${escH(t('planner.monthlyOnDay') || 'On day of the month')}</option>
                <option value="nth_workday" ${recMonthlyType === 'nth_workday' ? 'selected' : ''} title="${escA(t('planner.monthlyOnNthWorkdayTooltip'))}">${escH(t('planner.monthlyOnNthWorkday') || 'On the work day of the month')}</option>
                <option value="nth_weekday" ${recMonthlyType === 'nth_weekday' ? 'selected' : ''} title="${escA(t('planner.monthlyOnNthWeekdayTooltip'))}">${escH(t('planner.monthlyOnNthWeekday') || 'On the weekday of the month')}</option>
              </select>
            </div>
            <!-- Sub-options for day_of_month -->
            <div id="pe-recurrence-monthly-day-sub" style="display: ${recMonthlyType === 'day_of_month' ? 'flex' : 'none'}; align-items: center; gap: 0.5rem;">
              <span style="font-size: 0.78rem;">${escH(t('planner.onDayLabel') || 'on day')}:</span>
              <input type="number" id="pe-recurrence-monthly-day" class="field-input" value="${recMonthlyDay}" min="1" max="31" oninput="updateRecurrenceButtonLabel()" style="width: 55px; text-align: center; font-size: 0.78rem;" title="${escA(t('planner.monthlyOnDayTooltip'))}">
            </div>
            <!-- Sub-options for nth_workday -->
            <div id="pe-recurrence-monthly-nth-workday-sub" style="display: ${recMonthlyType === 'nth_workday' ? 'flex' : 'none'}; align-items: center; gap: 0.5rem;">
              <span style="font-size: 0.78rem;">${escH(t('planner.onTheLabel') || 'on the')}:</span>
              <select id="pe-recurrence-monthly-workday-nth" class="field-input" onchange="updateRecurrenceButtonLabel()" style="width: 90px; font-size: 0.78rem;" title="${escA(t('planner.monthlyOnNthWorkdayTooltip'))}">
                <option value="1" ${String(recMonthlyNth) === '1' ? 'selected' : ''}>${escH(t('planner.nthFirst') || '1st')}</option>
                <option value="2" ${String(recMonthlyNth) === '2' ? 'selected' : ''}>${escH(t('planner.nthSecond') || '2nd')}</option>
                <option value="3" ${String(recMonthlyNth) === '3' ? 'selected' : ''}>${escH(t('planner.nthThird') || '3rd')}</option>
                <option value="4" ${String(recMonthlyNth) === '4' ? 'selected' : ''}>${escH(t('planner.nthFourth') || '4th')}</option>
                <option value="-1" ${String(recMonthlyNth) === '-1' ? 'selected' : ''}>${escH(t('planner.nthLast') || 'Last')}</option>
              </select>
              <span style="font-size: 0.78rem;">${escH(t('planner.workdayLabel') || 'work day')}</span>
            </div>
            <!-- Sub-options for nth_weekday -->
            <div id="pe-recurrence-monthly-nth-weekday-sub" style="display: ${recMonthlyType === 'nth_weekday' ? 'flex' : 'none'}; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
              <span style="font-size: 0.78rem;">${escH(t('planner.onTheLabel') || 'on the')}:</span>
              <select id="pe-recurrence-monthly-weekday-nth" class="field-input" onchange="updateRecurrenceButtonLabel()" style="width: 85px; font-size: 0.78rem;" title="${escA(t('planner.monthlyOnNthWeekdayTooltip'))}">
                <option value="1" ${String(recMonthlyNth) === '1' ? 'selected' : ''}>${escH(t('planner.nthFirst') || '1st')}</option>
                <option value="2" ${String(recMonthlyNth) === '2' ? 'selected' : ''}>${escH(t('planner.nthSecond') || '2nd')}</option>
                <option value="3" ${String(recMonthlyNth) === '3' ? 'selected' : ''}>${escH(t('planner.nthThird') || '3rd')}</option>
                <option value="4" ${String(recMonthlyNth) === '4' ? 'selected' : ''}>${escH(t('planner.nthFourth') || '4th')}</option>
                <option value="-1" ${String(recMonthlyNth) === '-1' ? 'selected' : ''}>${escH(t('planner.nthLast') || 'Last')}</option>
              </select>
              <select id="pe-recurrence-monthly-weekday" class="field-input" onchange="updateRecurrenceButtonLabel()" style="flex: 1; min-width: 100px; font-size: 0.78rem;" title="${escA(t('planner.monthlyOnNthWeekdayTooltip'))}">
                ${_PLANNER_WEEKDAY_DEFS.map(d => `<option value="${d.day}" ${parseInt(recMonthlyWeekday, 10) === d.day ? 'selected' : ''}>${escH(t(d.fullKey) || d.fallbackFull)}</option>`).join('')}
              </select>
            </div>
          </div>

          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <span>${escH(t('planner.untilLabel') || 'Until')}</span>
            <input type="date" id="pe-recurrence-until" class="field-input" value="${recUntilVal}" style="width: 140px;" ${recNoEnd ? 'disabled style="opacity:0.5;"' : ''} title="${escA(t('planner.endDateTooltip') || 'Date when this recurring event stops')}">
          </div>
          <label style="display: flex; align-items: center; gap: 0.25rem; cursor: pointer;" title="${escA(t('planner.noEndDateTooltip') || 'Allow recurrence to continue indefinitely without an end date')}">
            <input type="checkbox" id="pe-recurrence-no-end" ${recNoEnd ? 'checked' : ''} onchange="togglePlannerRecurrenceNoEnd(this.checked)" style="accent-color: var(--accent);">
            <span>${escH(t('planner.noEndDateLabel') || 'No end date')}</span>
          </label>
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 1rem;">
          <button type="button" class="btn btn-save" onclick="closePlannerRecurrenceOverlay(true)" title="${escA(t('planner.applyRecurrenceTooltip') || 'Apply recurrence rule to this event')}">${escH(t('planner.recurrenceApply') || 'Apply')}</button>
          <button type="button" class="btn" onclick="closePlannerRecurrenceOverlay(false)" title="${escA(t('planner.cancelRecurrenceTooltip') || 'Cancel and discard recurrence settings')}">${escH(t('planner.recurrenceCancel') || 'Cancel')}</button>
        </div>
      </div>

      <!-- Suggested times container -->
      <div id="pe-time-suggestions" style="margin-top: 0.15rem; font-size: 0.75rem; display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; min-height: 18px;"></div>
    </div>

    <!-- Structured 2-Column Grid Layout for Planner Modal -->
    <div class="pe-modal-grid">
      <!-- Left Column: Context, Associations & Notes -->
      <div class="pe-modal-col pe-modal-col-left">
        <div class="pe-modal-card-group" id="pe-section-context">
          <div class="pe-modal-card-group-header">
            ${_renderPlannerSvgIcon('note', 15)} <span>${escH(t('planner.contextAndLinks') || 'Context & Linked Items')}</span>
          </div>

          <!-- Meeting / Call Context -->
          <div class="field-row" id="pe-context-field" style="margin-bottom:0.8rem; width: 100%;">
            <span class="field-label">${t('planner.meetingContext') || 'Meeting Context'}</span>
            <textarea id="pe-context" class="field-input" rows="3" style="width:100%; min-height:60px; resize:vertical; font-family:inherit;" placeholder="${escA(t('planner.meetingContextPlaceholder') || 'Call goal, topic, agenda items, or context...')}" title="${escA(t('planner.meetingContextTooltip') || 'Enter context or goals for this meeting/call to guide note generation and AI agents')}">${escH(event.context || '')}</textarea>
          </div>

          <!-- Linked Call Custom Selector Widget (shown for Prep) -->
          <div class="field-row" id="pe-call-field" style="margin-bottom:0.8rem; display:none; width: 100%;">
            <span class="field-label">${t('planner.selectCall')}</span>
            <div id="pe-call-selected-display" style="display: none; align-items: center; justify-content: space-between; padding: 0.4rem 0.6rem; border: 1px solid var(--card-border); border-radius: var(--radius-sm); background: color-mix(in srgb, var(--accent) 10%, var(--card-bg)); font-size: 0.85rem; width: 100%;">
              <span id="pe-call-selected-title" style="font-weight: 600; color: var(--accent);"></span>
              <button type="button" class="btn" style="padding: 2px 6px; font-size: 0.72rem; border-color: var(--accent); color: var(--accent);" onclick="clearSelectedPlannerCall()" title="${escA(t('planner.clearLinkedCallTooltip') || 'Clear linked call association')}">&times;</button>
            </div>
            <div id="pe-call-selector-search-wrap" style="width: 100%;">
              <input type="text" id="pe-call-search" class="field-input" placeholder="${escA(t('planner.searchCallPlaceholder') || 'Search call by title...')}" oninput="filterPlannerCallSelector()" style="width: 100%; margin-bottom: 0.3rem;">
              <div id="pe-call-selector-list" class="pe-call-selector-list"></div>
            </div>
            <input type="hidden" id="pe-call-id" value="${escA(event.prepForEventId)}">
          </div>

          <!-- Linked Todo Custom Selector Widget (shown for Todo Work) -->
          <div class="field-row" id="pe-todo-field" style="margin-bottom:0.8rem; display:none; width: 100%; position: relative;">
            <span class="field-label">${t('planner.selectTodo') || 'Select Todo'}</span>
            <div id="pe-todo-selected-display" style="display: none; align-items: center; justify-content: space-between; padding: 0.5rem 0.75rem; border: 1px solid var(--card-border); border-radius: var(--radius-sm); background: color-mix(in srgb, var(--accent) 10%, var(--card-bg)); font-size: 0.85rem; width: 100%; font-weight: 600; color: var(--accent);">
              <span id="pe-todo-selected-title"></span>
              <button type="button" class="btn" style="padding: 2px 6px; font-size: 0.72rem; border-color: var(--accent); color: var(--accent);" onclick="clearSelectedPlannerTodo()" title="${escA(t('planner.clearLinkedTodoTooltip') || 'Clear linked task association')}">&times;</button>
            </div>
            <div id="pe-todo-search-wrap" style="width: 100%;">
              <input type="text" id="pe-todo-search" class="field-input" placeholder="${escA(t('planner.searchToDoPlaceholder') || 'Click to select or start typing todo...')}" onfocus="showPlannerTodoDropdown()" oninput="filterPlannerTodoSelector()" style="width: 100%;">
              <div id="pe-todo-dropdown" class="planner-todo-dropdown" style="display: none;">
                <div id="pe-todo-lanes" style="display: flex; gap: 0.5rem; width: 100%; min-height: 180px; overflow-x: auto; padding: 2px;"></div>
              </div>
            </div>
            <input type="hidden" id="pe-todo-id" value="${escA(event.todoId)}">
          </div>

          <!-- Collaborators (shown for Call, Sync Up) -->
          <div class="field-row" id="pe-collaborators-field" style="margin-bottom:0.8rem; display:none;">
            <span class="field-label">${t('planner.withWhom') || 'With Whom'}</span>
            <div class="tags-editor" id="pe-collaborators-list" data-type="collaborator" style="min-height:36px; padding:2px 6px;"></div>
          </div>

          <!-- Linked Note Custom Selector Widget -->
          <div class="field-row" id="pe-note-field" style="margin-bottom:0.8rem; width: 100%;">
            <span class="field-label">${t('planner.linkedNote') || 'Linked Note'}</span>
            <div id="pe-note-block-container" style="width: 100%;"></div>
            <div id="pe-note-combobox-wrap" style="width:100%; position:relative; display: none;">
              <input type="text" id="pe-note-combobox" class="field-input" autocomplete="off" placeholder="${escA(t('planner.searchNoteReplacement') || t('planner.searchNotePlaceholder') || 'Search note by title...')}" onfocus="handlePlannerNoteComboboxFocus()" oninput="filterPlannerNoteSelector()" style="width:100%;">
              <div id="pe-note-selector-list" class="planner-dropdown-list"></div>
            </div>
            <input type="hidden" id="pe-note-id" value="${escA(event.noteId)}">
          </div>

          <!-- Related Notes -->
          <div class="field-row" id="pe-linked-notes-field" style="margin-bottom:0.8rem; width: 100%;">
            <span class="field-label">${t('planner.relatedNotes') || 'Linked Notes'}</span>
            <div id="pe-linked-notes-container" class="planner-selected-container"></div>
            <div id="pe-linked-notes-search-wrap" style="width:100%; position:relative;">
              <input type="text" id="pe-linked-notes-search" class="field-input" autocomplete="off" placeholder="${escA(t('planner.associateANote') || 'Associate a note...')}" onfocus="showPlannerLinkedNotesDropdown()" oninput="filterPlannerLinkedNotesSelector()" style="width: 100%;">
              <div id="pe-linked-notes-list" class="planner-dropdown-list"></div>
            </div>
            <input type="hidden" id="pe-linked-note-ids" value="${escA(initialLinkedNoteIds.join(','))}">
          </div>

          <!-- Associated Tasks -->
          <div class="field-row" id="pe-linked-todos-field" style="margin-bottom:0.8rem; width: 100%; display:none;">
            <span class="field-label">${t('planner.associatedTasks') || 'Associated Tasks'}</span>
            <div id="pe-linked-todos-container" class="planner-selected-container"></div>
            <div id="pe-linked-todos-search-wrap" style="width:100%; position:relative;">
              <input type="text" id="pe-linked-todos-search" class="field-input" autocomplete="off" placeholder="${escA(t('planner.associateATask') || 'Associate a task...')}" onfocus="showPlannerLinkedTodosDropdown()" oninput="filterPlannerLinkedTodosSelector()" style="width: 100%;">
              <div id="pe-linked-todos-list" class="planner-todo-dropdown" style="display: none; max-width: none;">
                <div id="pe-linked-todos-lanes" style="display: flex; gap: 0.5rem; width: 100%; min-height: 180px; overflow-x: auto; padding: 2px;"></div>
              </div>
            </div>
            <input type="hidden" id="pe-linked-todo-ids" value="${escA(initialLinkedTodoIds.join(','))}">
          </div>

          <!-- Preparation Sessions -->
          <div class="field-row" id="pe-prep-sessions-field" style="margin-bottom:0.2rem; width:100%; display:none;">
            <span class="field-label">${t('planner.preparationSessions') || 'Preparation Sessions'}</span>
            <div id="pe-prep-sessions-list" style="display:flex; flex-direction:column; gap:0.35rem; margin-bottom:0.45rem;"></div>
            <div style="display:flex; gap:0.35rem; flex-wrap:wrap;">
              <button type="button" class="btn" id="pe-prep-create-btn" onclick="createPlannerPrepSessionFromModal()" title="${escA(t('planner.createPreparationSession') || 'Schedule a dedicated preparation session before this event')}">${escH(t('planner.createPreparationSession') || 'Create preparation session')}</button>
              <button type="button" class="btn" id="pe-prep-remove-btn" onclick="removePlannerPrepSessionFromModal()" title="${escA(t('planner.removePreparationSession') || 'Remove the scheduled preparation session')}">${escH(t('planner.removePreparationSession') || 'Remove preparation session')}</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Right Column: Taxonomy, Tags & Workstreams -->
      <div class="pe-modal-col pe-modal-col-right">
        <div class="pe-modal-card-group" id="pe-section-taxonomy">
          <div class="pe-modal-card-group-header">
            ${_renderPlannerSvgIcon('tag', 15)} <span>${escH(t('planner.tagsAndWorkstreams') || 'Taxonomy & Workstreams')}</span>
          </div>

          <!-- Group & Workstream Split Row -->
          <div class="field-row field-row-split" id="pe-group-workstream-row" style="margin-bottom:0.8rem; display:flex; gap:0.75rem; width:100%;">
            <div class="field-col" style="flex:1; min-width:130px;">
              <span class="field-label" id="label-pe-group">${t('editor.groupTag')}</span>
              <div class="tags-editor" id="pe-group-tags" data-type="group" style="min-height:36px; padding:2px 6px;"></div>
            </div>
            <div class="field-col" style="flex:1; min-width:130px;">
              <span class="field-label" id="label-pe-workstream">${t('editor.workstreamLabel') || 'Workstream'}</span>
              <div class="workstream-editor-box" id="pe-workstream-box" style="min-height:36px;">
                <div class="workstream-chip-selector" id="pe-workstream-chip-selector"></div>
              </div>
            </div>
          </div>

          <!-- Major Topic tag -->
          <div class="field-row" id="pe-major-tags-field" style="margin-bottom:0.8rem">
            <span class="field-label" id="label-pe-major">${t('editor.majorTopicTag')}</span>
            <div class="tags-editor" id="pe-major-tags" data-type="major" style="min-height:36px; padding:2px 6px;"></div>
          </div>

          <!-- Topic tag -->
          <div class="field-row" id="pe-topic-tags-field" style="margin-bottom:0.2rem">
            <span class="field-label" id="label-pe-topic">${t('editor.topicTag')}</span>
            <div class="tags-editor" id="pe-topic-tags" data-type="topic" style="min-height:36px; padding:2px 6px;"></div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Define dynamic searchable todo selector in global namespace
  window.populatePlannerTodoSelector = function (selectedId, query = '') {
    const activeId = String(selectedId || '').trim();
    const displayEl = document.getElementById('pe-todo-selected-display');
    const searchWrap = document.getElementById('pe-todo-search-wrap');
    const titleEl = document.getElementById('pe-todo-selected-title');
    const dropdown = document.getElementById('pe-todo-dropdown');

    if (activeId) {
      const selectedTodo = (todosManifest || []).find(t => String(t.id) === activeId);
      if (selectedTodo) {
        if (displayEl) displayEl.style.display = 'flex';
        if (searchWrap) searchWrap.style.display = 'none';
        if (titleEl) titleEl.textContent = selectedTodo.title || selectedTodo.id;
        if (dropdown) dropdown.style.display = 'none';
        return;
      }
    }

    if (displayEl) displayEl.style.display = 'none';
    if (searchWrap) searchWrap.style.display = 'block';

    const container = document.getElementById('pe-todo-lanes');
    if (!container) return;

    const filterQuery = query.toLowerCase().trim();
    const todoPool = filterQuery
      ? (todosManifest || []).filter(t => t && isUserTask(t))
      : (todosManifest || []).filter(t => t && t.priority !== 'Done' && isUserTask(t));
    const filtered = todoPool.filter(t => !filterQuery || (t.title || '').toLowerCase().includes(filterQuery));

    const quadrants = ['Q1', 'Q2', 'Q3', 'Q4'];
    const quadrantLabels = {
      Q1: `⚡ ${t('todo.q1Short') || 'Do First'}`,
      Q2: `☕ ${t('todo.q2Short') || 'Schedule'}`,
      Q3: `💬 ${t('todo.q3Short') || 'Delegate'}`,
      Q4: `🌱 ${t('todo.q4Short') || 'Eliminate'}`
    };
    const quadrantColors = {
      Q1: '#ef4444',
      Q2: '#f59e0b',
      Q3: '#6366f1',
      Q4: '#14b8a6'
    };

    container.innerHTML = '';

    quadrants.forEach(qKey => {
      const laneTodos = filtered.filter(t => getTodoQuadrant(t) === qKey);

      const lane = document.createElement('div');
      lane.style.cssText = 'flex: 1; min-width: 135px; display: flex; flex-direction: column; gap: 0.4rem; border-right: 1px solid var(--card-border); padding-right: 0.4rem;';
      if (qKey === 'Q4') {
        lane.style.borderRight = 'none';
      }

      const header = document.createElement('div');
      header.style.cssText = `font-size: 0.72rem; font-weight: 700; text-transform: uppercase; color: ${quadrantColors[qKey]}; margin-bottom: 0.2rem; display: flex; align-items: center; gap: 4px;`;
      header.innerHTML = `<span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: ${quadrantColors[qKey]};"></span> ${quadrantLabels[qKey]} (${laneTodos.length})`;
      lane.appendChild(header);

      const list = document.createElement('div');
      list.style.cssText = 'display: flex; flex-direction: column; gap: 0.35rem;';

      if (laneTodos.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'font-size: 0.7rem; color: var(--text-muted); font-style: italic; padding: 0.2rem 0;';
        empty.textContent = t('planner.noTasksShort') || 'No tasks';
        list.appendChild(empty);
      } else {
        laneTodos.forEach(todo => {
          const isSelected = String(todo.id) === String(selectedId);
          const isHighStar = Boolean(todo.isHighPriority);

          const isDone = todo.priority === 'Done';
          const isWip = typeof isTodoWip === 'function' ? isTodoWip(todo) : (todo.status === 'WIP' || todo.priority === 'WIP');
          const statusCls = isDone ? 'status-done' : (isWip ? 'status-wip' : 'status-pending');
          const statusText = isDone
            ? (t('todo.done') || 'Done')
            : (isWip ? (t('todo.wip') || 'WIP') : (t('todo.pending') || 'Pending'));

          const card = document.createElement('div');
          card.className = 'todo-selector-card';
          card.title = t('planner.selectTodoHover') || 'Select todo for this event';
          card.style.cssText = `
            padding: 0.35rem 0.5rem;
            font-size: 0.75rem;
            border-radius: var(--radius-sm);
            background: ${isSelected ? 'color-mix(in srgb, var(--accent) 15%, var(--card-bg))' : 'var(--card-bg)'};
            border: 1px solid ${isSelected ? 'var(--accent)' : 'var(--card-border)'};
            color: var(--text);
            cursor: pointer;
            font-weight: ${isSelected ? '600' : 'normal'};
            transition: all var(--transition);
            box-shadow: ${isSelected ? '0 0 0 2px color-mix(in srgb, var(--accent) 25%, transparent)' : 'var(--shadow)'};
            word-break: break-word;
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 2px;
          `;
          card.innerHTML = `
            <div style="width: 100%;">${isHighStar ? '★ ' : ''}${escH(todo.title || todo.id)}</div>
            <span class="todo-selector-status-badge ${statusCls}" title="${escA(statusText)}">${escH(statusText)}</span>
          `;

          card.addEventListener('click', () => {
            const input = document.getElementById('pe-todo-id');
            if (input) {
              input.value = todo.id;
              window.populatePlannerTodoSelector(todo.id, query);
            }
            // Auto fill tags if bloc tags currently empty
            const currentGroups = typeof readTagEditor === 'function' ? (readTagEditor('pe-group-tags') || []) : [];
            const currentMajors = typeof readTagEditor === 'function' ? (readTagEditor('pe-major-tags') || []) : [];
            const currentTopics = typeof readTagEditor === 'function' ? (readTagEditor('pe-topic-tags') || []) : [];
            if (!currentGroups.length && !currentMajors.length && !currentTopics.length) {
              const todoMajors = todo.workstream ? [todo.workstream] : (todo.major_topic ? [todo.major_topic] : (todo.major_topic_tags || []));
              const todoGroups = todo.group_tags || [];
              const todoTopics = todo.topic_tags || [];
              if (typeof populateTagEditor === 'function') {
                if (todoGroups.length) populateTagEditor('pe-group-tags', todoGroups, 'group');
                if (todoMajors.length) populateTagEditor('pe-major-tags', todoMajors, 'major');
                if (todoTopics.length) populateTagEditor('pe-topic-tags', todoTopics, 'topic');
              }
            }
          });

          list.appendChild(card);
        });
      }

      lane.appendChild(list);
      container.appendChild(lane);
    });
  };

  window.showPlannerTodoDropdown = function () {
    const listContainer = document.getElementById('pe-todo-dropdown');
    if (listContainer) {
      listContainer.style.display = 'block';
      const selectedId = document.getElementById('pe-todo-id')?.value || '';
      const query = document.getElementById('pe-todo-search')?.value || '';
      window.populatePlannerTodoSelector(selectedId, query);
    }
  };

  window.clearSelectedPlannerTodo = function () {
    const input = document.getElementById('pe-todo-id');
    if (input) input.value = '';
    const searchInput = document.getElementById('pe-todo-search');
    if (searchInput) searchInput.value = '';
    window.populatePlannerTodoSelector('');
    const searchWrap = document.getElementById('pe-todo-search-wrap');
    if (searchWrap) searchWrap.style.display = 'block';
    const displayEl = document.getElementById('pe-todo-selected-display');
    if (displayEl) displayEl.style.display = 'none';
    const dropdown = document.getElementById('pe-todo-dropdown');
    if (dropdown) dropdown.style.display = 'block';
    if (searchInput) searchInput.focus();
  };

  window.filterPlannerTodoSelector = function () {
    const query = document.getElementById('pe-todo-search')?.value || '';
    const selectedId = document.getElementById('pe-todo-id')?.value || '';
    window.populatePlannerTodoSelector(selectedId, query);
  };

  // Define dynamic note selector helper functions in global namespace
  const _readPlannerLinkedNoteIds = () => {
    const raw = document.getElementById('pe-linked-note-ids')?.value || '';
    return normalizePlannerLinkedNoteIds(raw
      .split(',')
      .map(v => String(v || '').trim())
      .filter(Boolean));
  };

  const _updatePlannerModalNoteActionButton = (noteId = '') => {
    const btn = document.getElementById('pe-note-open-create-btn');
    if (!btn) return;
    const hasLinkedNote = !!String(noteId || '').trim();
    const label = hasLinkedNote
      ? (t('planner.openNote') || 'Open Note')
      : (t('planner.generateNewNote') || 'Generate new note');
    btn.textContent = label;
    btn.title = label;
  };

  const _writePlannerLinkedNoteIds = (ids) => {
    const hidden = document.getElementById('pe-linked-note-ids');
    if (!hidden) return;
    const unique = normalizePlannerLinkedNoteIds(ids);
    hidden.value = unique.join(',');
  };

  const _readPlannerLinkedTodoIds = () => {
    const raw = document.getElementById('pe-linked-todo-ids')?.value || '';
    return normalizePlannerLinkedTodoIds(raw
      .split(',')
      .map(v => String(v || '').trim())
      .filter(Boolean));
  };

  const _writePlannerLinkedTodoIds = (ids) => {
    const hidden = document.getElementById('pe-linked-todo-ids');
    if (!hidden) return;
    const unique = normalizePlannerLinkedTodoIds(ids);
    hidden.value = unique.join(',');
  };

  window.populatePlannerLinkedNotesSelector = function (primaryNoteId, selectedIds = null, query = '') {
    const listContainer = document.getElementById('pe-linked-notes-list');
    const container = document.getElementById('pe-linked-notes-container');
    const primary = String(primaryNoteId || document.getElementById('pe-note-id')?.value || '').trim();

    if (!container || !listContainer) return;

    // 1. Render associated boxes above
    const selected = new Set(Array.isArray(selectedIds) ? selectedIds : _readPlannerLinkedNoteIds());
    if (primary) {
      selected.delete(primary);
    }

    container.innerHTML = '';
    selected.forEach(noteId => {
      const note = manifest.find(n => n.id === noteId);
      if (note) {
        const box = document.createElement('div');
        box.className = 'planner-bloc-box note-type assoc-note';
        box.title = t('planner.openNote') || 'Open Note';
        box.innerHTML = `
          <span class="bloc-icon">${_renderPlannerSvgIcon('link', 14)}</span>
          <span class="title-text">${escH(note.title || 'Untitled')}</span>
          <span class="meta-text">${escH(note.date || '')}</span>
          <button type="button" class="remove-btn" title="${escA(t('planner.removeToChange') || 'Remove')}">${_renderPlannerSvgIcon('close', 11)}</button>
        `;

        box.addEventListener('click', (e) => {
          if (e.target.closest('.remove-btn')) return;
          if (note.path) openNoteOverlay(note.path);
        });

        box.querySelector('.remove-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          const next = new Set(_readPlannerLinkedNoteIds());
          next.delete(noteId);
          if (primary) next.delete(primary);
          _writePlannerLinkedNoteIds(Array.from(next));
          window.populatePlannerLinkedNotesSelector(primary, Array.from(next), query);
        });

        container.appendChild(box);
      }
    });

    // 2. Render dropdown items
    const fl = String(query || '').toLowerCase().trim();
    // Filter out notes already selected or primary
    const notes = manifest
      .filter(n => n && n.id && n.id !== primary && !selected.has(n.id))
      .filter(n => !fl || (n.title || '').toLowerCase().includes(fl))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

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

      item.addEventListener('click', () => {
        const next = new Set(_readPlannerLinkedNoteIds());
        next.add(note.id);
        if (primary) next.delete(primary);
        _writePlannerLinkedNoteIds(Array.from(next));

        const searchInput = document.getElementById('pe-linked-notes-search');
        if (searchInput) searchInput.value = '';

        listContainer.style.display = 'none';

        window.populatePlannerLinkedNotesSelector(primary, Array.from(next), '');
      });

      listContainer.appendChild(item);
    });
  };

  window.showPlannerLinkedNotesDropdown = function () {
    const listContainer = document.getElementById('pe-linked-notes-list');
    if (listContainer) {
      listContainer.style.display = 'block';
      const primary = document.getElementById('pe-note-id')?.value || '';
      const query = document.getElementById('pe-linked-notes-search')?.value || '';
      window.populatePlannerLinkedNotesSelector(primary, _readPlannerLinkedNoteIds(), query);
    }
  };

  window.filterPlannerLinkedNotesSelector = function () {
    const primary = document.getElementById('pe-note-id')?.value || '';
    const query = document.getElementById('pe-linked-notes-search')?.value || '';
    window.populatePlannerLinkedNotesSelector(primary, _readPlannerLinkedNoteIds(), query);
  };

  window.populatePlannerLinkedTodosSelector = function (selectedIds = null, query = '') {
    const listContainer = document.getElementById('pe-linked-todos-lanes');
    const container = document.getElementById('pe-linked-todos-container');
    const dropdown = document.getElementById('pe-linked-todos-list');
    if (!container || !listContainer) return;

    const selected = new Set(Array.isArray(selectedIds) ? selectedIds : _readPlannerLinkedTodoIds());

    // 1. Render associated boxes above
    container.innerHTML = '';
    selected.forEach(todoId => {
      const todo = (todosManifest || []).find(t => String(t?.id || '').trim() === todoId);
      if (todo) {
        const priorityLabel = todo.priority || 'Medium';
        const box = document.createElement('div');
        box.className = 'planner-bloc-box todo-type assoc-todo';
        box.title = escA(t('todo.clickToOpen') || 'Click to open task');
        box.style.cursor = 'pointer';
        box.innerHTML = `
          <span class="bloc-icon">${_renderPlannerSvgIcon('clipboard', 14)}</span>
          <span class="title-text">${escH(typeof getCleanTaskTitle === 'function' ? getCleanTaskTitle(todo) : (todo.title || todo.id))}</span>
          <span class="meta-text">${escH(t(`todo.${String(priorityLabel).toLowerCase()}`) || priorityLabel)}</span>
          <button type="button" class="remove-btn" title="${escA(t('planner.removeToChange') || 'Remove')}">${_renderPlannerSvgIcon('close', 11)}</button>
        `;

        box.addEventListener('click', (e) => {
          if (e.target.closest('.remove-btn')) return;
          openTodoOverlay(todo.id);
        });

        box.querySelector('.remove-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          const next = new Set(_readPlannerLinkedTodoIds());
          next.delete(todoId);
          _writePlannerLinkedTodoIds(Array.from(next));
          window.populatePlannerLinkedTodosSelector(Array.from(next), query);
        });

        container.appendChild(box);
      }
    });

    // 2. Render dropdown items in columns
    const fl = String(query || '').toLowerCase().trim();
    const openTodos = (todosManifest || [])
      .filter(todo => todo && todo.id && todo.priority !== 'Done' && isUserTask(todo) && !selected.has(todo.id));
    const filtered = openTodos.filter(t => {
      const cleanT = typeof getCleanTaskTitle === 'function' ? getCleanTaskTitle(t) : (t.title || '');
      return !fl || String(cleanT || '').toLowerCase().includes(fl);
    });

    const priorities = ['High', 'Medium', 'Low'];
    const priorityLabels = {
      'High': t('todo.priorityHigh') || 'High',
      'Medium': t('todo.priorityMedium') || 'Medium',
      'Low': t('todo.priorityLow') || 'Low'
    };
    const priorityColors = {
      'High': 'var(--color-high)',
      'Medium': 'var(--color-medium)',
      'Low': 'var(--color-low)'
    };

    listContainer.innerHTML = '';

    priorities.forEach(prio => {
      const laneTodos = filtered.filter(t => {
        const p = t.priority === 'WIP' ? (t.originalPriority || 'Medium') : t.priority;
        return p === prio;
      });

      const lane = document.createElement('div');
      lane.style.cssText = 'flex: 1; min-width: 130px; display: flex; flex-direction: column; gap: 0.4rem; border-right: 1px solid var(--card-border); padding-right: 0.4rem;';
      if (prio === 'Low') {
        lane.style.borderRight = 'none';
      }

      const header = document.createElement('div');
      header.style.cssText = `font-size: 0.72rem; font-weight: 700; text-transform: uppercase; color: ${priorityColors[prio]}; margin-bottom: 0.2rem; display: flex; align-items: center; gap: 4px;`;
      header.innerHTML = `<span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: ${priorityColors[prio]};"></span> ${priorityLabels[prio]} (${laneTodos.length})`;
      lane.appendChild(header);

      const list = document.createElement('div');
      list.style.cssText = 'display: flex; flex-direction: column; gap: 0.35rem; overflow-y: auto; flex: 1;';

      if (laneTodos.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'font-size: 0.7rem; color: var(--text-muted); font-style: italic; padding: 0.2rem 0;';
        empty.textContent = t('planner.noTasksShort') || 'No tasks';
        list.appendChild(empty);
      } else {
        laneTodos.forEach(todo => {
          const card = document.createElement('div');
          card.className = 'todo-selector-card';
          card.style.cssText = `
            padding: 0.35rem 0.5rem;
            font-size: 0.75rem;
            border-radius: var(--radius-sm);
            background: var(--card-bg);
            border: 1px solid var(--card-border);
            color: var(--text);
            cursor: pointer;
            transition: all var(--transition);
            word-break: break-word;
          `;
          card.textContent = typeof getCleanTaskTitle === 'function' ? getCleanTaskTitle(todo) : (todo.title || todo.id);
          card.addEventListener('click', () => {
            const next = new Set(_readPlannerLinkedTodoIds());
            next.add(todo.id);
            _writePlannerLinkedTodoIds(Array.from(next));

            const searchInput = document.getElementById('pe-linked-todos-search');
            if (searchInput) searchInput.value = '';
            if (dropdown) dropdown.style.display = 'none';

            window.populatePlannerLinkedTodosSelector(Array.from(next), '');
          });
          list.appendChild(card);
        });
      }
      lane.appendChild(list);
      listContainer.appendChild(lane);
    });
  };

  window.showPlannerLinkedTodosDropdown = function () {
    const listContainer = document.getElementById('pe-linked-todos-list');
    if (listContainer) {
      listContainer.style.display = 'block';
      const query = document.getElementById('pe-linked-todos-search')?.value || '';
      window.populatePlannerLinkedTodosSelector(_readPlannerLinkedTodoIds(), query);
    }
  };

  window.filterPlannerLinkedTodosSelector = function () {
    const query = document.getElementById('pe-linked-todos-search')?.value || '';
    window.populatePlannerLinkedTodosSelector(_readPlannerLinkedTodoIds(), query);
  };

  window.refreshPlannerLinkedTodosSummary = function () {
    // Redesigned: No-op
  };

  window.togglePlannerLinkedTodosPanel = function () {
    // Redesigned: No-op
  };

  window.updatePlannerLinkedTodosToggleLabel = function (type) {
    // Redesigned: No-op
  };

  window.populatePlannerNoteSelector = function (selectedId, query = '') {
    const comboInput = document.getElementById('pe-note-combobox');
    const hiddenInput = document.getElementById('pe-note-id');
    const listContainer = document.getElementById('pe-note-selector-list');
    const blockContainer = document.getElementById('pe-note-block-container');
    const comboWrap = document.getElementById('pe-note-combobox-wrap');

    if (!listContainer || !comboInput || !hiddenInput || !blockContainer || !comboWrap) return;

    if (selectedId !== undefined) {
      hiddenInput.value = selectedId;
    }

    const activeId = String(hiddenInput.value || '').trim();

    // Render logic for different states
    if (activeId) {
      // 1. Assigned State (Existing note)
      const note = manifest.find(n => n.id === activeId);
      if (note) {
        comboWrap.style.display = 'none';
        listContainer.style.display = 'none';
        blockContainer.style.display = 'block';

        blockContainer.innerHTML = `
          <div class="planner-bloc-box note-type" id="pe-note-active-block" title="${escA(t('planner.openNote') || 'Open Note')}">
            <span class="bloc-icon">${_renderPlannerSvgIcon('link', 14)}</span>
            <span class="title-text">${escH(note.title || 'Untitled')}</span>
            <span class="meta-text">${escH(note.date || '')}</span>
            <button type="button" class="remove-btn" id="pe-note-remove-btn" title="${escA(t('planner.removeToChange') || 'Remove to change')}">${_renderPlannerSvgIcon('close', 11)}</button>
          </div>
        `;

        // Click box -> Preview note
        document.getElementById('pe-note-active-block')?.addEventListener('click', (e) => {
          if (e.target.closest('#pe-note-remove-btn')) return; // ignore close click
          if (note.path) {
            openNoteOverlay(note.path);
          }
        });

        // Click x -> Remove
        document.getElementById('pe-note-remove-btn')?.addEventListener('click', (e) => {
          e.stopPropagation();
          window.clearSelectedPlannerNote(true); // keepEmpty = true means show search
        });

        // Sync linked notes
        const linkedQuery = document.getElementById('pe-linked-notes-search')?.value || '';
        window.populatePlannerLinkedNotesSelector(note.id, _readPlannerLinkedNoteIds(), linkedQuery);
        return;
      }
      hiddenInput.value = '';
    }

    // 2. Default State (Mode is dummy/default note) or Search Mode
    if (comboInput.dataset.mode === 'dummy' || !comboInput.dataset.mode) {
      // Default State (Square box)
      comboWrap.style.display = 'none';
      listContainer.style.display = 'none';
      blockContainer.style.display = 'block';

      blockContainer.innerHTML = `
        <div class="planner-bloc-box note-type default-note" id="pe-note-active-block" title="${escA(t('planner.clickHereCreateNow') || 'Click here to create now')}">
          <span class="bloc-icon">${_renderPlannerSvgIcon('fileText', 14)}</span>
          <span class="title-text">${escH(t('planner.newNoteToCreate') || 'New note will be created')}</span>
          <button type="button" class="remove-btn" id="pe-note-remove-btn" title="${escA(t('planner.removeToChange') || 'Remove to change')}">${_renderPlannerSvgIcon('close', 11)}</button>
        </div>
      `;

      // Click box -> Ask and Create Note
      document.getElementById('pe-note-active-block')?.addEventListener('click', async (e) => {
        if (e.target.closest('#pe-note-remove-btn')) return;
        const confirm = await showConfirmDialog(t('planner.confirmCreateNoteNow') || 'Do you really want to create the note now?');
        if (confirm) {
          openOrCreatePlannerModalNote();
        }
      });

      // Click x -> Show typing field
      document.getElementById('pe-note-remove-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        comboInput.dataset.mode = 'search';
        comboInput.value = '';
        hiddenInput.value = '';
        blockContainer.style.display = 'none';
        comboWrap.style.display = 'block';
        comboInput.focus();
        window.populatePlannerNoteSelector('', '');
      });

      window.populatePlannerLinkedNotesSelector('', []);
      return;
    }

    // 3. Search / Input mode
    blockContainer.style.display = 'none';
    comboWrap.style.display = 'block';
    window.populatePlannerLinkedNotesSelector('', []);

    const fl = query.toLowerCase().trim();
    const notes = manifest
      .filter(n => !fl || (n.title || '').toLowerCase().includes(fl))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    listContainer.innerHTML = '';
    listContainer.style.display = 'block';

    // Add Top Option: Default Note
    const defaultItem = document.createElement('div');
    defaultItem.className = 'planner-dropdown-item';
    defaultItem.innerHTML = `<span style="display:inline-flex;align-items:center;gap:6px;">${_renderPlannerSvgIcon('fileText', 13)} <span>${t('planner.defaultNoteOption') || 'Default note (will be created on demand)'}</span></span>`;
    defaultItem.addEventListener('click', () => {
      comboInput.dataset.mode = 'dummy';
      hiddenInput.value = '';
      window.populatePlannerNoteSelector('');
    });
    listContainer.appendChild(defaultItem);

    if (notes.length > 0) {
      // Find if any notes are already linked to other planner events
      const currentEventId = String(event.id || '').trim();
      const linkedNoteMap = new Map(); // noteId -> event
      (plannerEvents || []).forEach(pe => {
        if (pe && String(pe.id || '').trim() !== currentEventId && pe.noteId) {
          linkedNoteMap.set(String(pe.noteId).trim(), pe);
        }
      });

      notes.forEach(note => {
        const item = document.createElement('div');
        item.className = 'planner-dropdown-item';
        
        const textPart = document.createElement('div');
        textPart.style.cssText = 'display: flex; flex-direction: column; gap: 2px;';
        
        const titleSpan = document.createElement('span');
        titleSpan.style.cssText = 'font-weight: 500;';
        titleSpan.textContent = note.title || 'Untitled';
        textPart.appendChild(titleSpan);

        const dateSpan = document.createElement('span');
        dateSpan.className = 'item-meta';
        dateSpan.textContent = note.date || '';
        textPart.appendChild(dateSpan);

        item.appendChild(textPart);

        const isLinked = linkedNoteMap.has(String(note.id).trim());
        if (isLinked) {
          const ownerEvent = linkedNoteMap.get(String(note.id).trim());
          const badge = document.createElement('span');
          badge.className = 'badge';
          badge.textContent = t('planner.linkedNote') || 'Linked';
          badge.title = `Linked to: ${ownerEvent.title || ownerEvent.id}`;
          item.appendChild(badge);
          item.classList.add('linked');
        }

        item.addEventListener('click', async () => {
          if (isLinked) {
            const ownerEvent = linkedNoteMap.get(String(note.id).trim());
            const ownerTitle = ownerEvent.title || `${t('planner.blockLabel') || 'Block'} ${ownerEvent.id || ''}`;
            const msg = t('planner.noteAlreadyLinkedToOtherMeeting', {
              noteTitle: note.title || 'Untitled',
              blockTitle: ownerTitle,
              date: ownerEvent.date || ''
            }) || `The note "${note.title || 'Untitled'}" is already linked as primary note to "${ownerTitle}" (${ownerEvent.date || ''}). Unlink it from that block and use it here?`;
            const confirmed = await showConfirmDialog(msg, {
              confirmLabel: t('planner.unlinkFromOtherMeeting') || 'Unlink from other meeting',
            });
            if (!confirmed) return;
            pendingPrimaryNoteTransferByNoteId.set(String(note.id || '').trim(), String(ownerEvent.id || '').trim());
          }

          hiddenInput.value = note.id;

          // Auto fill collaborators and tags if note selected
          const linkedTopics = (note.topic_tags || []).map(t => t.toLowerCase());
          document.querySelectorAll('input[name="pe-collaborators"]').forEach(cb => {
            const label = (typeof getColleagueLabelById === 'function') ? getColleagueLabelById(cb.value, cb.value) : cb.value;
            cb.checked = linkedTopics.includes(String(label || '').toLowerCase());
          });

          populateTagEditor('pe-group-tags', note.group_tags || [], 'group');
          populateTagEditor('pe-major-tags', note.major_topic_tags || [], 'major');
          populateTagEditor('pe-topic-tags', note.topic_tags || [], 'topic');

          updateTagsReadonlyState(true);
          window.populatePlannerNoteSelector(note.id);
        });

        listContainer.appendChild(item);
      });
    }
  };

  window.filterPlannerNoteSelector = function () {
    const comboInput = document.getElementById('pe-note-combobox');
    if (!comboInput) return;
    if (comboInput.dataset.mode === 'dummy') {
      comboInput.value = '';
      comboInput.dataset.mode = 'search';
    }
    const hiddenInput = document.getElementById('pe-note-id');
    if (hiddenInput) hiddenInput.value = '';
    const query = comboInput.value || '';
    window.populatePlannerNoteSelector('', query);
  };

  window.handlePlannerNoteComboboxFocus = function () {
    const comboInput = document.getElementById('pe-note-combobox');
    const hiddenInput = document.getElementById('pe-note-id');
    if (!comboInput || !hiddenInput) return;
    if (hiddenInput.value) return;
    if (comboInput.dataset.mode === 'dummy') {
      comboInput.value = '';
    }
    comboInput.dataset.mode = 'search';
    window.populatePlannerNoteSelector('', comboInput.value || '');
  };

  window.clearSelectedPlannerNote = function (keepEmpty = false) {
    const hiddenInput = document.getElementById('pe-note-id');
    if (hiddenInput) {
      hiddenInput.value = '';
    }
    updateTagsReadonlyState(false);
    _writePlannerLinkedNoteIds([]);
    const comboInput = document.getElementById('pe-note-combobox');
    if (comboInput) {
      comboInput.dataset.mode = keepEmpty ? 'search' : 'dummy';
      comboInput.value = '';
    }
    window.populatePlannerNoteSelector('', '');
  };

  window.createPlannerPrepSessionFromModal = function () {
    const eventId = document.getElementById('planner-dynamic-modal')?.getAttribute('data-event-id') || event.id;
    if (!eventId) return;
    schedulePrepBeforeCall(eventId);
    if (typeof window.refreshPlannerPrepSessionsSection === 'function') {
      window.refreshPlannerPrepSessionsSection();
    }
  };

  window.removePlannerPrepSessionFromModal = async function () {
    const eventId = document.getElementById('planner-dynamic-modal')?.getAttribute('data-event-id') || event.id;
    if (!eventId) return;
    await deleteLinkedPrepSession(eventId);
    if (typeof window.refreshPlannerPrepSessionsSection === 'function') {
      window.refreshPlannerPrepSessionsSection();
    }
  };

  window.refreshPlannerPrepSessionsSection = function () {
    const field = document.getElementById('pe-prep-sessions-field');
    const list = document.getElementById('pe-prep-sessions-list');
    const createBtn = document.getElementById('pe-prep-create-btn');
    const removeBtn = document.getElementById('pe-prep-remove-btn');
    const modalEl = document.getElementById('planner-dynamic-modal');
    const currentType = document.getElementById('pe-type')?.value || event.type;
    const isCreation = modalEl ? (modalEl.getAttribute('data-is-creation') === 'true') : false;
    const eventId = modalEl?.getAttribute('data-event-id') || event.id;

    if (!field || !list || !eventId) return;
    const visible = !isCreation && (currentType === 'call' || currentType === 'sync');
    field.style.display = visible ? '' : 'none';
    if (!visible) return;

    const linkedPreps = (plannerEvents || [])
      .filter(pe => pe && pe.type === 'prep' && pe.prepForEventId === eventId)
      .sort((a, b) => `${a.date || ''} ${a.startTime || ''}`.localeCompare(`${b.date || ''} ${b.startTime || ''}`));

    if (!linkedPreps.length) {
      list.innerHTML = `<div style="font-size:0.74rem; color:var(--text-muted); font-style:italic;">${escH(t('planner.noPrepSessionsLinked') || 'No preparation session linked')}</div>`;
      if (createBtn) createBtn.disabled = false;
      if (removeBtn) removeBtn.disabled = true;
      return;
    }

    list.innerHTML = linkedPreps.map(prep => `
      <div class="planner-inline-row" style="border:1px solid var(--card-border); border-radius:var(--radius-sm); padding:0.35rem 0.55rem; background:color-mix(in srgb, var(--accent) 8%, var(--card-bg));">
        <span>${escH(prep.title || 'Prep')}</span>
        <span style="font-size:0.72rem; color:var(--text-muted);">${escH(`${prep.date || ''} ${prep.startTime || ''}-${prep.endTime || ''}`)}</span>
      </div>
    `).join('');
    if (createBtn) createBtn.disabled = true;
    if (removeBtn) removeBtn.disabled = false;
  };

  window.openOrCreatePlannerModalNote = async function () {
    const type = document.getElementById('pe-type')?.value || event.type;
    if (type === 'ooo') {
      toast(t('planner.oooNoNotes'));
      return;
    }
    if (type === 'custom' || type === 'personal') {
      toast(t('planner.customNoNotes'));
      return;
    }

    const hiddenInput = document.getElementById('pe-note-id');
    const resolvePrepMainEvent = () => {
      if (type !== 'prep') return null;
      const parentId = String(document.getElementById('pe-call-id')?.value || event.prepForEventId || '').trim();
      if (!parentId) return null;
      return plannerEvents.find(e => String(e?.id || '').trim() === parentId) || null;
    };
    const mainEv = resolvePrepMainEvent();

    const currentNoteId = String(hiddenInput?.value || '').trim();
    if (currentNoteId) {
      if (mainEv && String(mainEv.noteId || '').trim() !== currentNoteId) {
        mainEv.noteId = currentNoteId;
        mainEv.linkedNoteIds = normalizePlannerLinkedNoteIds([currentNoteId, ...(mainEv.linkedNoteIds || [])], currentNoteId);
        event.noteId = currentNoteId;
        event.linkedNoteIds = normalizePlannerLinkedNoteIds([currentNoteId, ...(event.linkedNoteIds || [])], currentNoteId);
        await savePlanner();
        renderPlanner();
      }
      const existing = manifest.find(n => String(n?.id || '').trim() === currentNoteId);
      if (existing?.path) {
        if (typeof syncTagsBetweenBlocAndNote === 'function') {
          await syncTagsBetweenBlocAndNote(event, existing);
        }
        openNoteOverlay(existing.path, null, null, false, null, { collapseMetadata: true, fromBloc: true, sourceEvent: event });
        return;
      }
    }

    if (mainEv) {
      const mainNoteId = String(mainEv.noteId || '').trim();
      if (mainNoteId) {
        event.noteId = mainNoteId;
        event.linkedNoteIds = normalizePlannerLinkedNoteIds([mainNoteId, ...(event.linkedNoteIds || [])], mainNoteId);
        if (hiddenInput) hiddenInput.value = mainNoteId;
        _updatePlannerModalNoteActionButton(mainNoteId);
        window.populatePlannerNoteSelector(mainNoteId);
        const existingMain = manifest.find(n => String(n?.id || '').trim() === mainNoteId);
        if (existingMain?.path) {
          if (typeof syncTagsBetweenBlocAndNote === 'function') {
            await syncTagsBetweenBlocAndNote(mainEv || event, existingMain);
          }
          openNoteOverlay(existingMain.path, null, null, false, null, { collapseMetadata: true, fromBloc: true, sourceEvent: mainEv || event });
          return;
        }
      }
    }

    const closeProgress = showPlannerNoteGenerationProgress(
      t('planner.preparingTemplate') || 'Preparing template and formatting content...'
    );
    closeProgress.updateStage?.(t('planner.preparingTemplate') || 'Preparing template and formatting content...', '', 15);
    await new Promise(r => setTimeout(r, 16));
    try {
      const noteId = generateNoteId();
      const notePath = getCanonicalNotePath(noteId);
      const noteDate = document.getElementById('pe-date')?.value || event.date || formatLocalDateValue(new Date());
      const noteTitle = (document.getElementById('pe-title')?.value || event.title || '').trim() || 'Untitled Session';
      const groupTags = readTagEditor('pe-group-tags') || [];
      const majorTags = readTagEditor('pe-major-tags') || [];
      const topicTags = readTagEditor('pe-topic-tags') || [];

      const markdown = await generateEventNoteMarkdown(event, type);

      closeProgress.updateStage?.(t('planner.writingNoteContent') || 'Encrypting and saving note content...', '', 45);
      await new Promise(r => setTimeout(r, 16));

      const note = {
        id: noteId,
        path: notePath,
        title: noteTitle,
        date: noteDate,
        group_tags: groupTags,
        major_topic_tags: majorTags,
        topic_tags: topicTags,
        extra_tags: [],
        mainHTML: mdToPreviewHTML(markdown)
      };

      await StorageAPI.writeNoteContent(notePath, buildNewNoteHTML(note));
      upsertManifest(note);

      closeProgress.updateStage?.(t('planner.linkingToPlanner') || 'Linking note to planner and updating indexes...', '', 75);
      await new Promise(r => setTimeout(r, 16));

      await saveManifest({ force: true });
      await rebuildIndexHTML();
      renderFilterChips();

      event.noteId = noteId;
      event.group_tags = [...groupTags];
      event.major_topic_tags = [...majorTags];
      event.topic_tags = [...topicTags];
      event.tags = [...new Set([...groupTags, ...majorTags, ...topicTags])];
      event.linkedNoteIds = normalizePlannerLinkedNoteIds([noteId, ...(event.linkedNoteIds || [])], noteId);
      if (mainEv) {
        mainEv.noteId = noteId;
        mainEv.group_tags = [...groupTags];
        mainEv.major_topic_tags = [...majorTags];
        mainEv.topic_tags = [...topicTags];
        mainEv.tags = [...new Set([...groupTags, ...majorTags, ...topicTags])];
        mainEv.linkedNoteIds = normalizePlannerLinkedNoteIds([noteId, ...(mainEv.linkedNoteIds || [])], noteId);
        await savePlanner();
        renderPlanner();
      }
      if (hiddenInput) hiddenInput.value = noteId;
      _updatePlannerModalNoteActionButton(noteId);
      window.populatePlannerNoteSelector(noteId);

      closeProgress.updateStage?.(t('planner.openingNoteEditor') || 'Opening note editor...', '', 95);
      await new Promise(r => setTimeout(r, 16));

      openNoteOverlay(notePath, null, null, false, null, { collapseMetadata: true, fromBloc: true, sourceEvent: event });
    } catch (err) {
      console.error('Failed to create planner modal note:', err);
      toast(t('planner.createNoteFailed', { message: err.message }), true);
    } finally {
      closeProgress();
    }
  };

  const updateTagsReadonlyState = (_hasNote = false) => {
    ['pe-group-tags', 'pe-major-tags', 'pe-topic-tags'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.classList.remove('readonly');
      }
    });
  };

  const lang = (typeof getAppLocale === 'function') ? getAppLocale() : 'en';
  const { prefix: initialPrefix, suffix: initialSuffix } = getHeaderPrefixAndSuffix(event.type, lang, isEdit);

  const modalTitleHtml = isProposal ? `
    <div class="pe-modal-header-container">
      <div class="pe-modal-header-top">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="pe-modal-badge-sparkle"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg></span>
          <span class="pe-modal-headline">${escH(t('planner.reviewProposedModalTitle'))}</span>
        </div>
      </div>
    </div>
  ` : `
    <div class="pe-modal-header-container">
      <div class="pe-modal-header-top">
        <span class="pe-modal-headline">${escH(isEdit ? (t('planner.editBlock') || 'Edit Block') : (t('planner.newEvent') || 'New Block'))}</span>
        <!-- Legacy compatibility elements for tests and automated scripts -->
        <div class="pe-header-legacy-compat" style="display:none;" aria-hidden="true">
          <span id="pe-header-prefix">${initialPrefix}</span>
          <select id="pe-type" class="pe-header-type-select" onchange="togglePlannerModalFields(this.value)">
            ${getHeaderOptionsHtml(lang, event.type)}
          </select>
          <span id="pe-header-suffix">${initialSuffix}</span>
        </div>
      </div>
      <div class="pe-type-segmented-control" role="radiogroup" aria-label="${escA(t('planner.type') || 'Block Type')}">
        ${_renderPlannerTypeSegmentedControl(event.type)}
      </div>
    </div>
  `;

  openPlannerModal(
    modalTitleHtml,
    modalHtml,
    async () => {
      const closeCreateProgress = !isEdit ? showPlannerBlocCreationProgress() : null;
      try {
      // Ensure any open recurrence popover is committed
      if (document.getElementById('pe-recurrence-overlay')?.style.display !== 'none') {
        if (typeof closePlannerRecurrenceOverlay === 'function') {
          closePlannerRecurrenceOverlay(true);
        }
      }

      // Validate inputs
      const type = document.getElementById('pe-type')?.value || '';
      const date = document.getElementById('pe-date')?.value || '';
      const startTime = document.getElementById('pe-start-time')?.value || '';
      const endTime = document.getElementById('pe-end-time')?.value || '';

      const alldayCheckbox = document.getElementById('pe-ooo-allday');
      const isAllDay = type === 'ooo' && alldayCheckbox ? alldayCheckbox.checked : false;

      if (isAllDay) {
        if (!date) {
          throw new Error('Please fill in Date.');
        }
      } else {
        if (!date || !startTime || !endTime) {
          throw new Error('Please fill in Date, Start Time and End Time.');
        }
        if (timeToMinutes(endTime) <= timeToMinutes(startTime)) {
          throw new Error('End Time must be after Start Time.');
        }
      }

      event.type = type;
      event.date = date;
      if (isAllDay) {
        delete event.startTime;
        delete event.endTime;
      } else {
        event.startTime = startTime;
        event.endTime = endTime;
      }

      // Parse recurrence settings
      let recurrenceRule = null;
      let recurrenceId = event.recurrenceId || '';

      const recEnabled = document.getElementById('pe-recurrence-enabled')?.checked;
      if (recEnabled && (!parentEvent || event.id === parentEvent.id)) {
        const intervalVal = parseInt(document.getElementById('pe-recurrence-interval')?.value || '1', 10) || 1;
        const unitVal = document.getElementById('pe-recurrence-unit')?.value || 'week';
        const noEndVal = document.getElementById('pe-recurrence-no-end')?.checked;
        const untilVal = noEndVal ? null : (document.getElementById('pe-recurrence-until')?.value || null);
        const workdaysOnlyVal = !!document.getElementById('pe-recurrence-workdays-only')?.checked;
        const selectedWeekdays = Array.from(document.querySelectorAll('#pe-recurrence-weekdays .planner-weekday-pill.active'))
          .map(btn => parseInt(btn.getAttribute('data-day'), 10))
          .filter(n => !isNaN(n));
        const monthlyTypeVal = document.getElementById('pe-recurrence-monthly-type')?.value || 'day_of_month';
        const monthlyDayVal = parseInt(document.getElementById('pe-recurrence-monthly-day')?.value || '1', 10) || 1;
        const monthlyWorkdayNthVal = parseInt(document.getElementById('pe-recurrence-monthly-workday-nth')?.value || '1', 10);
        const monthlyWeekdayNthVal = parseInt(document.getElementById('pe-recurrence-monthly-weekday-nth')?.value || '1', 10);
        const monthlyWeekdayVal = parseInt(document.getElementById('pe-recurrence-monthly-weekday')?.value || '1', 10);

        recurrenceRule = {
          interval: intervalVal,
          unit: unitVal,
          until: untilVal
        };

        if (unitVal === 'day' && workdaysOnlyVal) {
          recurrenceRule.workdaysOnly = true;
        }
        if (unitVal === 'week') {
          const evDate = parseLocalDateValue(date);
          const defaultDay = evDate ? evDate.getDay() : 1;
          if (selectedWeekdays.length > 1 || (selectedWeekdays.length === 1 && selectedWeekdays[0] !== defaultDay)) {
            recurrenceRule.weekdays = selectedWeekdays;
          }
        }
        if (unitVal === 'month') {
          if (monthlyTypeVal !== 'day_of_month') {
            recurrenceRule.monthlyType = monthlyTypeVal;
          }
          if (monthlyTypeVal === 'day_of_month') {
            const evDate = parseLocalDateValue(date);
            const defaultDom = evDate ? evDate.getDate() : 1;
            if (monthlyDayVal !== defaultDom) {
              recurrenceRule.monthlyDay = monthlyDayVal;
            }
          } else if (monthlyTypeVal === 'nth_workday') {
            recurrenceRule.monthlyNth = monthlyWorkdayNthVal;
          } else if (monthlyTypeVal === 'nth_weekday') {
            recurrenceRule.monthlyNth = monthlyWeekdayNthVal;
            recurrenceRule.monthlyWeekday = monthlyWeekdayVal;
          }
        }

        if (!recurrenceId) {
          recurrenceId = 'rec-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
        }
      }

      const selectedCollabIds = (typeof readCollaboratorMultiPicker === 'function')
        ? readCollaboratorMultiPicker('pe-collaborators-list')
        : [];
      const normalizedCollabIds = (typeof normalizePlannerCollaboratorIds === 'function')
        ? normalizePlannerCollaboratorIds(selectedCollabIds, { allowCreate: true })
        : Array.from(new Set(selectedCollabIds.map(v => String(v || '').trim()).filter(Boolean)));
      event.collaboratorIds = normalizedCollabIds;
      event.collaborators = (typeof getPlannerCollaboratorLabelsByIds === 'function')
        ? getPlannerCollaboratorLabelsByIds(normalizedCollabIds)
        : normalizedCollabIds.map(id => (typeof getColleagueLabelById === 'function' ? getColleagueLabelById(id, id) : id));
      event.context = document.getElementById('pe-context')?.value?.trim() || '';

      if (type === 'call' || type === 'sync') {
        const title = document.getElementById('pe-title')?.value?.trim() || '';
        event.title = title || (type === 'sync' ? (t('planner.sync') || 'Sync Up') : 'Call');
        event.todoId = '';
        event.prepForEventId = '';
      } else if (type === 'prep') {
        const callSel = document.getElementById('pe-call-id');
        const callId = callSel?.value || '';
        if (!callId) {
          throw new Error('Please select a linked Call.');
        }
        event.prepForEventId = callId;
        event.title = callSel.options[callSel.selectedIndex]?.text?.split('-')?.slice(1)?.join('-')?.trim() || 'Prep';
        event.title = `Prep: ${event.title.replace(/^Prep:\s*/i, '')}`;
        event.todoId = '';

        // Copy noteId from linked call if it exists
        const linkedCall = plannerEvents.find(c => c.id === callId);
        event.noteId = linkedCall?.noteId || '';
        event.linkedNoteIds = getPlannerEventLinkedNoteIds(linkedCall);
      } else if (type === 'todo') {
        const todoId = document.getElementById('pe-todo-id')?.value || '';
        const title = document.getElementById('pe-title')?.value?.trim() || '';
        event.todoId = todoId;
        if (title) {
          event.title = title;
        } else if (todoId) {
          const matchingTodo = (Array.isArray(todosManifest) ? todosManifest : []).find(t => String(t.id) === String(todoId));
          event.title = matchingTodo ? (typeof getCleanTaskTitle === 'function' ? getCleanTaskTitle(matchingTodo) : (matchingTodo.title || 'Todo Work')) : (t('planner.todoWork') || 'Todo Work');
        } else {
          event.title = t('planner.todoWork') || 'Todo Work';
        }
        event.prepForEventId = '';
      } else if (type === 'ooo') {
        event.title = document.getElementById('pe-title')?.value?.trim() || 'Out of Office';
        event.todoId = '';
        event.prepForEventId = '';
        // Full-day OOO fields
        const alldayCheckbox = document.getElementById('pe-ooo-allday');
        const isAllDay = alldayCheckbox ? alldayCheckbox.checked : false;
        event.allDay = isAllDay;
        if (isAllDay) {
          const endDateInput = document.getElementById('pe-ooo-enddate');
          const endDateVal = endDateInput ? endDateInput.value : '';
          event.endDate = (endDateVal && endDateVal >= event.date) ? endDateVal : event.date;
        } else {
          delete event.endDate;
        }

      } else if (type === 'work') {
        event.title = document.getElementById('pe-title')?.value?.trim() || 'Work Session';
        event.todoId = '';
        event.prepForEventId = '';
      } else {
        event.title = document.getElementById('pe-title')?.value?.trim() || 'Event';
        event.todoId = '';
        event.prepForEventId = '';
      }

      if (type !== 'prep') {
        const noteInput = document.getElementById('pe-note-id');
        event.noteId = (noteInput && type !== 'ooo' && type !== 'custom' && type !== 'personal') ? noteInput.value : '';
      }

      const supportsLinkedNotes = (type !== 'ooo' && type !== 'custom' && type !== 'personal' && type !== 'prep');

      const linkedIdsRaw = (type === 'prep')
        ? (Array.isArray(event.linkedNoteIds) ? event.linkedNoteIds : [])
        : _readPlannerLinkedNoteIds();
      event.linkedNoteIds = supportsLinkedNotes
        ? normalizePlannerLinkedNoteIds([event.noteId, ...linkedIdsRaw], event.noteId || '')
        : [];

      if (type === 'call' || type === 'sync' || type === 'prep') {
        event.linkedTodoIds = normalizePlannerLinkedTodoIds(_readPlannerLinkedTodoIds());
      } else if (type === 'todo') {
        event.linkedTodoIds = [];
      } else {
        event.linkedTodoIds = [];
      }

      if (pendingPrimaryNoteTransferByNoteId.size > 0) {
        pendingPrimaryNoteTransferByNoteId.forEach((ownerEventId, transferredNoteId) => {
          const owner = (plannerEvents || []).find(pe => String(pe?.id || '').trim() === String(ownerEventId || '').trim());
          if (!owner) return;
          if (String(owner.noteId || '').trim() !== String(transferredNoteId || '').trim()) return;
          owner.noteId = '';
          owner.linkedNoteIds = normalizePlannerLinkedNoteIds(owner.linkedNoteIds || []).filter(id => id !== transferredNoteId);
          if (owner.type === 'call' || owner.type === 'sync') {
            plannerEvents.forEach(pe => {
              if (pe.type === 'prep' && pe.prepForEventId === owner.id) {
                pe.noteId = '';
                pe.linkedNoteIds = normalizePlannerLinkedNoteIds(pe.linkedNoteIds || []).filter(id => id !== transferredNoteId);
              }
            });
          }
        });
      }

      event.group_tags = (typeof readTagEditor === 'function' ? readTagEditor('pe-group-tags') : []) || [];
      event.major_topic_tags = (typeof readTagEditor === 'function' ? readTagEditor('pe-major-tags') : []) || [];
      event.topic_tags = (typeof readTagEditor === 'function' ? readTagEditor('pe-topic-tags') : []) || [];
      event.tags = [...new Set([...event.group_tags, ...event.major_topic_tags, ...event.topic_tags])];

      if (typeof detectWorkstreamDetailsForNote === 'function') {
        const wsDetails = detectWorkstreamDetailsForNote(event, {
          group_tags: event.group_tags,
          major_topic_tags: event.major_topic_tags,
          topic_tags: event.topic_tags
        });
        const activeWsNames = wsDetails.map(d => d.name);
        event.workstreams = activeWsNames;
        event.workstream = activeWsNames.join(', ');
      }

      if (event.noteId) {
        const linkedNote = manifest.find(n => n.id === event.noteId);
        if (linkedNote) {
          linkedNote.group_tags = [...event.group_tags];
          linkedNote.major_topic_tags = [...event.major_topic_tags];
          linkedNote.topic_tags = [...event.topic_tags];
          linkedNote.workstreams = event.workstreams ? [...event.workstreams] : [];
          linkedNote.workstream = event.workstream || '';
          if (typeof saveManifest === 'function') saveManifest();
        }
      }

      if (type === 'call' || type === 'sync') {
        // Propagate noteId to linked prep events
        plannerEvents.forEach(e => {
          if (e.type === 'prep' && e.prepForEventId === event.id) {
            e.noteId = event.noteId || '';
            e.linkedNoteIds = getPlannerEventLinkedNoteIds(event);
            e.linkedTodoIds = normalizePlannerLinkedTodoIds(event.linkedTodoIds || []);
          }
        });
      }

      // Save/Update logic
      const targetList = (typeof plannerEvents !== 'undefined' && Array.isArray(plannerEvents))
        ? plannerEvents
        : ((typeof window !== 'undefined' && Array.isArray(window.plannerEvents)) ? window.plannerEvents : []);

      if (!isEdit) {
        if (recurrenceRule) {
          event.recurrenceRule = recurrenceRule;
          event.recurrenceId = recurrenceId;
        }
        targetList.push(event);

        if (window.AIChatController && AIChatController.activeSuggestionRoute) {
          const { msgIdx, actIdx } = AIChatController.activeSuggestionRoute;
          const msg = AIChatController.messages[msgIdx];
          if (msg && msg.parsed && Array.isArray(msg.parsed.suggested_actions)) {
            const action = msg.parsed.suggested_actions[actIdx];
            if (action) {
              action.accepted = true;
              action.createdId = event.id;
              AIChatController.saveCurrentConversation();
              AIChatController.renderMessages();
            }
          }
          AIChatController.activeSuggestionRoute = null;
        }

        if (prefill._proposalId) {
          event.proposalId = prefill._proposalId;
          await markPlannerProposalAccepted(prefill._proposalId);
        }

        const createPrepCheckbox = (type === 'call' || type === 'sync') && document.getElementById('pe-create-prep')?.checked;
        if (createPrepCheckbox) {
          const prepSlot = _findSmartPrepSlot(date, startTime, 30);
          const prepEvent = {
            id: 'evt-' + Date.now() + '-prep-' + Math.random().toString(36).slice(2, 6),
            type: 'prep',
            title: `Prep: ${event.title}`,
            date: prepSlot.date,
            startTime: prepSlot.startTime,
            endTime: prepSlot.endTime,
            prepForEventId: event.id,
            recurrenceId: recurrenceId || '',
            noteId: event.noteId || '',
            linkedNoteIds: getPlannerEventLinkedNoteIds(event),
            linkedTodoIds: normalizePlannerLinkedTodoIds(event.linkedTodoIds || []),
            autoPlaced: true
          };
          targetList.push(prepEvent);
        }
      } else {
        // Edit mode save
        if (recurrenceRule) {
          event.recurrenceRule = recurrenceRule;
          event.recurrenceId = recurrenceId;
        } else if (!parentEvent && event.recurrenceRule && !recEnabled) {
          delete event.recurrenceRule;
          delete event.recurrenceId;
        }
        if (isEdit && initialEventDate && initialEventDate !== date) {
          recordPlannerSeriesMoveException(event, initialEventDate, date);
        }
        const idx = targetList.findIndex(e => e && e.id === event.id);
        if (idx >= 0) targetList[idx] = event;
        if (event.noteId) {
          syncPlannerEventTagsToLinkedNote(event);
        }
      }

      if (recurrenceRule && typeof precreateRecurringEventsForWeek === 'function') {
        const getDaysFn = typeof getPlannerDaysToDisplay === 'function'
          ? getPlannerDaysToDisplay
          : (typeof window !== 'undefined' && typeof window.getPlannerDaysToDisplay === 'function' ? window.getPlannerDaysToDisplay : null);
        const formatFn = typeof formatLocalDateValue === 'function'
          ? formatLocalDateValue
          : (typeof window !== 'undefined' && typeof window.formatLocalDateValue === 'function' ? window.formatLocalDateValue : (d => d.toISOString().slice(0, 10)));
        const parseFn = typeof parseLocalDateValue === 'function'
          ? parseLocalDateValue
          : (typeof window !== 'undefined' && typeof window.parseLocalDateValue === 'function' ? window.parseLocalDateValue : (s => new Date(s)));

        const displayedDays = (getDaysFn ? getDaysFn() : []).map(d => formatFn(d));
        const horizonDays = new Set(displayedDays);
        const baseDate = parseFn(event.date) || new Date();
        for (let i = 0; i <= 60; i++) {
          const d = new Date(baseDate);
          d.setDate(baseDate.getDate() + i);
          horizonDays.add(formatFn(d));
        }
        precreateRecurringEventsForWeek(Array.from(horizonDays));
      }

      if (typeof window !== 'undefined') window.plannerEvents = targetList;
      if (typeof plannerEvents !== 'undefined') plannerEvents = targetList;
      await savePlanner();
      if (isProposal || isDraft) {
        const pId = event.proposalId || event._proposalId;
        if (pId) {
          if (typeof markPlannerProposalAccepted === 'function') {
            await markPlannerProposalAccepted(pId);
          }
          if (typeof getPlannerProposals === 'function') {
            const proposals = getPlannerProposals();
            const draftIdx = proposals.findIndex(p => p.id === pId && (p.isDraft || p.source === 'Draft'));
            if (draftIdx >= 0) {
              proposals.splice(draftIdx, 1);
              if (typeof setPlannerProposals === 'function') setPlannerProposals(proposals);
              if (typeof persistPlannerProposals === 'function') await persistPlannerProposals();
            }
          }
        }
      }
      if (typeof pruneUnusedAutoCreatedColleagues === 'function') {
        pruneUnusedAutoCreatedColleagues();
      }
      if (typeof renderPlanner === 'function') renderPlanner();
      if (typeof toast === 'function') {
        toast(isProposal ? (t('planner.proposalAccepted') || 'Proposed event added to planner') : (isEdit ? t('planner.eventUpdated') : t('planner.eventPlanned')));
      }
      // Trigger overlap-removal dialog for full-day OOO events (after modal close)
      if (type === 'ooo' && event.allDay) {
        setTimeout(() => promptCancelOverlappingBlocs(event), 150);
      }
      return true;

      } finally {
        if (typeof closeCreateProgress === 'function') {
          closeCreateProgress();
        }
      }
    },
    async () => {
      // onCancel
      const pId = event._proposalId || event.proposalId;
      if (pId) {
        const proposals = getPlannerProposals();
        const draftIdx = proposals.findIndex(p => p.id === pId && (p.isDraft || p.source === 'Draft'));
        if (draftIdx >= 0) {
          proposals.splice(draftIdx, 1);
          setPlannerProposals(proposals);
          await persistPlannerProposals();
          renderPlanner();
          toast(t('planner.draftDiscarded') || 'Draft discarded');
        }
      }
    },
    async () => {
      // onBackdropClick: save as draft if creating a new bloc (!isEdit || isDraft)
      if (isEdit && !event._isDraft) return true;

      const type = document.getElementById('pe-type')?.value || event.type || 'call';
      const date = document.getElementById('pe-date')?.value || event.date || formatLocalDateValue(new Date());
      const startTime = document.getElementById('pe-start-time')?.value || event.startTime || '10:00';
      const endTime = document.getElementById('pe-end-time')?.value || event.endTime || '10:30';
      const rawTitle = document.getElementById('pe-title')?.value?.trim() || '';
      const context = document.getElementById('pe-context')?.value?.trim() || '';
      const todoId = document.getElementById('pe-todo-id')?.value || event.todoId || '';
      const prepForEventId = document.getElementById('pe-call-id')?.value || event.prepForEventId || '';
      const noteId = document.getElementById('pe-note-id')?.value || event.noteId || '';
      const linkedNoteIds = Array.isArray(event.linkedNoteIds) ? [...event.linkedNoteIds] : [];
      const selectedCollabIds = (typeof readCollaboratorMultiPicker === 'function')
        ? readCollaboratorMultiPicker('pe-collaborators-list')
        : (event.collaboratorIds || []);
      const groupTags = (typeof readTagEditor === 'function') ? readTagEditor('pe-group-tags') : (event.group_tags || []);
      const majorTags = (typeof readTagEditor === 'function') ? readTagEditor('pe-major-tags') : (event.major_topic_tags || []);
      const topicTags = (typeof readTagEditor === 'function') ? readTagEditor('pe-topic-tags') : (event.topic_tags || []);

      const defaultTitle = type === 'sync' ? (t('planner.sync') || 'Sync Up') : (type === 'call' ? (t('planner.call') || 'Call') : (type === 'prep' ? 'Prep' : (type === 'ooo' ? (t('planner.oooFullDayBanner') || 'Out of Office') : (t('planner.blockLabel') || 'Event'))));
      const title = rawTitle || defaultTitle;
      const draftId = event._proposalId || event.proposalId || ('draft-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
      const dur = _calcDurationMins(startTime, endTime) || 30;

      const draftProposal = {
        id: draftId,
        title: title,
        date: date,
        startTime: startTime,
        endTime: endTime,
        duration: dur,
        type: type,
        description: context,
        context: context,
        collaboratorIds: selectedCollabIds,
        collaborators: (typeof getPlannerCollaboratorLabelsByIds === 'function')
          ? getPlannerCollaboratorLabelsByIds(selectedCollabIds)
          : selectedCollabIds,
        todoId: todoId,
        prepForEventId: prepForEventId,
        noteId: noteId,
        linkedNoteIds: linkedNoteIds,
        group_tags: groupTags,
        major_topic_tags: majorTags,
        topic_tags: topicTags,
        source: 'Draft',
        isDraft: true,
        status: 'pending'
      };

      const existingProposals = getPlannerProposals();
      const existingIdx = existingProposals.findIndex(p => p.id === draftId);
      if (existingIdx >= 0) {
        existingProposals[existingIdx] = draftProposal;
      } else {
        existingProposals.push(draftProposal);
      }
      setPlannerProposals(existingProposals);
      await persistPlannerProposals();
      showPlannerProposals = true;
      if (typeof window !== 'undefined') window.showPlannerProposals = true;
      renderPlanner();
      toast(t('planner.savedAsDraft') || 'Saved as draft in planner');
      return true;
    }
  );

  const typeSelect = document.getElementById('pe-type');
  if (typeSelect && event.type) {
    typeSelect.value = event.type;
  }

  // Trigger toggle fields initially
  togglePlannerModalFields(event.type, !isEdit, false);

  // Render collaborator chip picker
  const listDiv = document.getElementById('pe-collaborators-list');
  if (listDiv) {
    const eventCollabIds = Array.from(new Set([
      ...(Array.isArray(event.collaboratorIds) ? event.collaboratorIds : []),
      ...(Array.isArray(event.collaborators)
        ? event.collaborators.map(name => (typeof resolveColleagueId === 'function')
          ? resolveColleagueId(name, { allowCreate: false, allowMe: false })
          : String(name || '').trim())
        : [])
    ].filter(Boolean)));

    if (typeof populateCollaboratorMultiPicker === 'function') {
      populateCollaboratorMultiPicker('pe-collaborators-list', eventCollabIds, {
        includeMe: false,
        allowEmpty: true,
        createOnType: true,
        placeholder: t('planner.addNewNamePlaceholder') || 'Add new name...',
        title: t('planner.peopleInputTitle') || t('common.typeOrClickSuggestion') || 'Type or click a suggestion'
      });
    } else {
      listDiv.innerHTML = eventCollabIds.map(id => `
        <span class="tag-pill tag topic-tag" data-colleague-id="${escA(id)}">${escH(id)}</span>
      `).join('');
    }
  }

  const modalEl = document.getElementById('planner-dynamic-modal');
  if (modalEl) {
    modalEl.setAttribute('data-event-id', event.id);
    modalEl.setAttribute('data-is-creation', (!isEdit).toString());

    const segCtrl = modalEl.querySelector('.pe-type-segmented-control');
    if (segCtrl) {
      segCtrl.addEventListener('click', (e) => {
        const btn = e.target.closest('.pe-type-segment-btn');
        if (btn) {
          const segType = btn.getAttribute('data-type');
          if (segType && typeof _selectPlannerSegmentType === 'function') {
            _selectPlannerSegmentType(segType);
          }
        }
      });
    }

    if (isEdit && !isProposal && event.id) {
      const actionsEl = modalEl.querySelector('.modal-actions');
      if (actionsEl && !actionsEl.querySelector('.pe-modal-delete-btn')) {
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'btn btn-danger-subtle pe-modal-delete-btn';
        deleteBtn.innerHTML = `${_renderPlannerSvgIcon('trash', 14)} <span>${escH(t('planner.deleteBlock') || 'Delete')}</span>`;
        deleteBtn.title = t('planner.quickDelete') || 'Delete';
        deleteBtn.onclick = async () => {
          const confirmMsg = t('planner.deleteEventNamed', { title: event.title || 'Event' }) ||
            `Delete "${event.title || 'Event'}"?`;
          const confirmed = await showConfirmDialog(confirmMsg, {
            title: t('planner.deleteBlock') || 'Delete Block',
            confirmLabel: t('planner.deleteBlock') || 'Delete',
            isDanger: true
          });
          if (!confirmed) return;
          modalEl.remove();
          if (typeof deletePlannerEventWithDissolve === 'function') {
            deletePlannerEventWithDissolve(event.id);
          }
        };
        actionsEl.insertBefore(deleteBtn, actionsEl.firstChild);
      }
    }
  }

  if (!isEdit) {
    syncPlannerModalCreationPreview();
    const titleInput = document.getElementById('pe-title');
    const typeSelect = document.getElementById('pe-type');
    const oooAllDayCheck = document.getElementById('pe-ooo-allday');
    if (titleInput) titleInput.addEventListener('input', syncPlannerModalCreationPreview);
    if (typeSelect) typeSelect.addEventListener('change', () => setTimeout(syncPlannerModalCreationPreview, 0));
    if (oooAllDayCheck) oooAllDayCheck.addEventListener('change', syncPlannerModalCreationPreview);
  }

  let initialGroupTags = event.group_tags && event.group_tags.length
    ? [...event.group_tags]
    : (event.type === 'sync' ? ['Sync'] : []);
  let initialMajorTags = event.major_topic_tags && event.major_topic_tags.length
    ? [...event.major_topic_tags]
    : [];
  let initialTopicTags = event.topic_tags && event.topic_tags.length
    ? [...event.topic_tags]
    : [];
  if (event.noteId && (!initialGroupTags.length || !initialMajorTags.length || !initialTopicTags.length)) {
    const linkedNote = manifest.find(n => n.id === event.noteId);
    if (linkedNote) {
      if (!initialGroupTags.length) initialGroupTags = linkedNote.group_tags || initialGroupTags;
      if (!initialMajorTags.length) initialMajorTags = linkedNote.major_topic_tags || [];
      if (!initialTopicTags.length) initialTopicTags = linkedNote.topic_tags || [];
    }
  }
  if (event.todoId && (!initialGroupTags.length || !initialMajorTags.length || !initialTopicTags.length)) {
    const linkedTodo = (todosManifest || []).find(t => String(t.id) === String(event.todoId));
    if (linkedTodo) {
      if (!initialMajorTags.length && linkedTodo.workstream) {
        initialMajorTags = [linkedTodo.workstream];
      }
      if (!initialMajorTags.length && linkedTodo.major_topic) {
        initialMajorTags = [linkedTodo.major_topic];
      }
      if (!initialMajorTags.length && Array.isArray(linkedTodo.major_topic_tags)) {
        initialMajorTags = [...linkedTodo.major_topic_tags];
      }
      if (!initialGroupTags.length && Array.isArray(linkedTodo.group_tags)) {
        initialGroupTags = [...linkedTodo.group_tags];
      }
      if (!initialTopicTags.length && Array.isArray(linkedTodo.topic_tags)) {
        initialTopicTags = [...linkedTodo.topic_tags];
      }
    }
  }
  populateTagEditor('pe-group-tags', initialGroupTags, 'group');
  populateTagEditor('pe-major-tags', initialMajorTags, 'major');
  populateTagEditor('pe-topic-tags', initialTopicTags, 'topic');
  populatePlannerEventWorkstreamEditor(event);

  ['pe-group-tags', 'pe-major-tags', 'pe-topic-tags'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('tagchange', () => {
        populatePlannerEventWorkstreamEditor(event);
      });
    }
  });

  // Set up listeners for time suggestions recalculation & creation preview sync
  const dateEl = document.getElementById('pe-date');
  const startEl = document.getElementById('pe-start-time');
  const durEl = document.getElementById('pe-duration');
  const endEl = document.getElementById('pe-end-time');
  if (dateEl) {
    dateEl.addEventListener('change', _plannerUpdateSuggestions);
    if (!isEdit) dateEl.addEventListener('change', syncPlannerModalCreationPreview);
  }
  if (startEl) {
    startEl.addEventListener('input', _plannerUpdateSuggestions);
    if (!isEdit) startEl.addEventListener('input', syncPlannerModalCreationPreview);
  }
  if (durEl) {
    durEl.addEventListener('change', _plannerUpdateSuggestions);
    if (!isEdit) durEl.addEventListener('change', () => setTimeout(syncPlannerModalCreationPreview, 0));
  }
  if (endEl) {
    endEl.addEventListener('input', _plannerUpdateSuggestions);
    if (!isEdit) endEl.addEventListener('input', syncPlannerModalCreationPreview);
  }

  // Initialize custom todo selector if todo
  if (event.type === 'todo') {
    window.populatePlannerTodoSelector(event.todoId);
  }

  // Initialize custom note selector
  const noteComboInput = document.getElementById('pe-note-combobox');
  if (noteComboInput) {
    noteComboInput.dataset.mode = event.noteId ? 'selected' : 'dummy';
  }
  window.populatePlannerNoteSelector(event.noteId || '');
  window.populatePlannerLinkedNotesSelector(event.noteId, initialLinkedNoteIds, '');
  window.populatePlannerLinkedTodosSelector(initialLinkedTodoIds, '');
  if (typeof window.updatePlannerLinkedTodosToggleLabel === 'function') {
    window.updatePlannerLinkedTodosToggleLabel(event.type);
  }
  if (typeof window.refreshPlannerPrepSessionsSection === 'function') {
    window.refreshPlannerPrepSessionsSection();
  }

  updateTagsReadonlyState(!!event.noteId);

  // Initial calculation of suggestions
  _plannerUpdateSuggestions();

  if (typeof updateRecurrenceButtonLabel === 'function') {
    updateRecurrenceButtonLabel();
  }

  if (modalEl && typeof rememberDialogFormState === 'function') {
    rememberDialogFormState(modalEl);
  }
}

// Duration helpers for the event modal
function _calcDurationMins(start, end) {
  const s = timeToMinutes(start);
  const e = timeToMinutes(end);
  if (isNaN(s) || isNaN(e) || e <= s) return typeof defaultPlannerDuration === 'number' ? defaultPlannerDuration : 30;
  return e - s;
}
function _plannerSyncEndFromDuration() {
  const startEl = document.getElementById('pe-start-time');
  const durEl = document.getElementById('pe-duration');
  const endEl = document.getElementById('pe-end-time');
  const efEl = document.getElementById('pe-end-time-field');
  if (!startEl || !durEl || !endEl) return;
  if (durEl.value === 'custom') {
    if (efEl) _setPlannerModalFieldVisible(efEl, true, true);
    return;
  }
  if (efEl) _setPlannerModalFieldVisible(efEl, false, false);
  const startMin = timeToMinutes(startEl.value);
  if (isNaN(startMin)) return;
  const endMin = startMin + parseInt(durEl.value, 10);
  endEl.value = minutesToTime(endMin);
  if (typeof _plannerUpdateSuggestions === 'function') _plannerUpdateSuggestions();
}
function _plannerSyncDurationFromEnd() {
  const startEl = document.getElementById('pe-start-time');
  const durEl = document.getElementById('pe-duration');
  const endEl = document.getElementById('pe-end-time');
  const efEl = document.getElementById('pe-end-time-field');
  if (!startEl || !durEl || !endEl) return;
  const dur = _calcDurationMins(startEl.value, endEl.value);
  const opts = [15, 30, 45, 60, 90, 120, 180];
  const isCustom = !opts.includes(dur);
  durEl.value = isCustom ? 'custom' : String(dur);
  if (efEl) _setPlannerModalFieldVisible(efEl, isCustom, true);
  if (typeof _plannerUpdateSuggestions === 'function') _plannerUpdateSuggestions();
}
function _plannerSyncDuration() {
  const durEl = document.getElementById('pe-duration');
  if (durEl && durEl.value !== 'custom') {
    _plannerSyncEndFromDuration();
  } else {
    _plannerSyncDurationFromEnd();
  }
}

// Toggle fields in the schedule modal depending on type selection
function togglePlannerModalFields(type, isCreation = null, animate = true) {
  const allSegments = document.querySelectorAll('.pe-type-segment-btn');
  if (allSegments && allSegments.length > 0) {
    allSegments.forEach(btn => {
      const isMatch = btn.getAttribute('data-type') === type;
      btn.classList.toggle('active', isMatch);
      btn.setAttribute('aria-checked', isMatch ? 'true' : 'false');
    });
  }
  const peTypeSelect = document.getElementById('pe-type');
  if (peTypeSelect && peTypeSelect.value !== type) {
    peTypeSelect.value = type;
  }

  const titleField = document.getElementById('pe-title-field');
  const callField = document.getElementById('pe-call-field');
  const todoField = document.getElementById('pe-todo-field');
  const callOpts = document.getElementById('pe-call-options-group');
  const noteField = document.getElementById('pe-note-field');
  const linkedNotesField = document.getElementById('pe-linked-notes-field');
  const linkedTodosField = document.getElementById('pe-linked-todos-field');
  const collabField = document.getElementById('pe-collaborators-field');

  // Tag fields
  const groupWorkstreamRow = document.getElementById('pe-group-workstream-row');
  const groupTagsField = document.getElementById('pe-group-tags-field');
  const majorTagsField = document.getElementById('pe-major-tags-field');
  const topicTagsField = document.getElementById('pe-topic-tags-field');

  if (isCreation === null) {
    const modalEl = document.getElementById('planner-dynamic-modal');
    isCreation = modalEl ? (modalEl.getAttribute('data-is-creation') === 'true') : false;
  }

  _setPlannerModalFieldVisible(titleField, true, animate);
  _setPlannerModalFieldVisible(callField, (type === 'prep'), animate);
  _setPlannerModalFieldVisible(todoField, (type === 'todo'), animate);
  _setPlannerModalFieldVisible(callOpts, ((type === 'call' || type === 'sync') && isCreation), animate);

  // OOO full-day controls
  const oooControls = document.getElementById('pe-ooo-controls');
  if (oooControls) {
    _setPlannerModalFieldVisible(oooControls, (type === 'ooo'), animate);
    if (type === 'ooo') {
      // Sync checkbox and end-date state from the current event when editing
      const alldayCheckbox = document.getElementById('pe-ooo-allday');
      const modalEl = document.getElementById('planner-dynamic-modal');
      const evId = modalEl ? modalEl.getAttribute('data-event-id') : null;
      const currentEv = evId ? (typeof plannerEvents !== 'undefined' ? plannerEvents.find(e => e.id === evId) : null) : null;
      const isAllDay = currentEv ? !!currentEv.allDay : (alldayCheckbox ? alldayCheckbox.checked : false);
      if (alldayCheckbox) alldayCheckbox.checked = isAllDay;
      _plannerToggleOooAllDay(isAllDay, animate);
    } else {
      // Reset visibility of time fields when switching away from OOO
      _plannerToggleOooAllDay(false, animate);
    }
  }

  const hideNotes = (type === 'ooo' || type === 'prep' || type === 'custom' || type === 'personal');
  _setPlannerModalFieldVisible(noteField, !hideNotes, animate);
  _setPlannerModalFieldVisible(linkedNotesField, !hideNotes, animate);

  const showLinkedTodos = (type === 'call' || type === 'sync' || type === 'prep');
  _setPlannerModalFieldVisible(linkedTodosField, showLinkedTodos, animate);

  _setPlannerModalFieldVisible(collabField, (type === 'call' || type === 'sync'), animate);

  const contextField = document.getElementById('pe-context-field');
  _setPlannerModalFieldVisible(contextField, (type !== 'ooo'), animate);

  // Hide tags for OOO, Custom Slot, Personal and Prep
  const hideTags = (type === 'ooo' || type === 'custom' || type === 'personal' || type === 'prep');
  _setPlannerModalFieldVisible(groupWorkstreamRow || groupTagsField, !hideTags, animate);
  _setPlannerModalFieldVisible(majorTagsField, !hideTags, animate);
  _setPlannerModalFieldVisible(topicTagsField, !hideTags, animate);

  // Update the dynamic explanation box
  const explanationEl = document.getElementById('pe-type-explanation');
  if (explanationEl) {
    const explainKey = 'planner.explain' + type.charAt(0).toUpperCase() + type.slice(1);
    const newText = t(explainKey) || (type === 'personal' ? t('planner.explainCustom') : (type === 'custom' ? t('planner.explainPersonal') : '')) || '';
    if (explanationEl.textContent !== newText) {
      explanationEl.textContent = newText;
      if (animate) {
        explanationEl.classList.remove('planner-field-animate-in');
        void explanationEl.offsetWidth;
        explanationEl.classList.add('planner-field-animate-in');
      }
    }
  }

  if (type === 'todo') {
    const todoId = document.getElementById('pe-todo-id')?.value || '';
    if (typeof window.populatePlannerTodoSelector === 'function') {
      window.populatePlannerTodoSelector(todoId);
    }
  }

  const noteLabelEl = document.querySelector('#pe-note-field .field-label');
  if (noteLabelEl) {
    const typeLabel = t(`planner.${type}`) || type;
    noteLabelEl.textContent = `${typeLabel} ${t('planner.noteLabel') || 'Note'}`;
  }

  // Populate todo selector initially/when toggled
  if (type === 'todo') {
    const selectedId = document.getElementById('pe-todo-id')?.value || '';
    const query = document.getElementById('pe-todo-search')?.value || '';
    if (typeof window.populatePlannerTodoSelector === 'function') {
      window.populatePlannerTodoSelector(selectedId, query);
    }
  }

  if (type === 'call' || type === 'sync' || type === 'prep') {
    const selectedIds = normalizePlannerLinkedTodoIds((document.getElementById('pe-linked-todo-ids')?.value || '').split(','));
    const query = document.getElementById('pe-linked-todos-search')?.value || '';
    if (typeof window.populatePlannerLinkedTodosSelector === 'function') {
      window.populatePlannerLinkedTodosSelector(selectedIds, query);
    }
    if (typeof window.updatePlannerLinkedTodosToggleLabel === 'function') {
      window.updatePlannerLinkedTodosToggleLabel(type);
    }
  }

  if (typeof window.refreshPlannerPrepSessionsSection === 'function') {
    window.refreshPlannerPrepSessionsSection();
  }

  // Update header prefix/suffix based on new type
  const lang = (typeof getAppLocale === 'function') ? getAppLocale() : 'en';
  const modalEl = document.getElementById('planner-dynamic-modal');
  const isEditMode = modalEl ? (modalEl.getAttribute('data-is-creation') !== 'true') : true;
  const { prefix, suffix } = getHeaderPrefixAndSuffix(type, lang, isEditMode);
  const prefixEl = document.getElementById('pe-header-prefix');
  const suffixEl = document.getElementById('pe-header-suffix');
  if (prefixEl) prefixEl.textContent = prefix;
  if (suffixEl) suffixEl.textContent = suffix;

  // Update modal accent color class
  if (modalEl) {
    modalEl.className = modalEl.className.replace(/pe-type-\w+/g, '').trim();
    modalEl.classList.add('pe-type-' + type);
  }
}

// Edit existing planned block
function editPlannerEvent(eventId) {
  const event = plannerEvents.find(e => e.id === eventId);
  if (event) {
    openPlanEventModal(event);
  }
}

// Synchronize event tags to linked note in manifest
function syncPlannerEventTagsToLinkedNote(event) {
  const mf = (typeof window !== 'undefined' && Array.isArray(window.manifest))
    ? window.manifest
    : ((typeof manifest !== 'undefined' && Array.isArray(manifest)) ? manifest : null);
  if (!event || !event.noteId || !mf) return;
  const linkedNote = mf.find(n => n && (n.id === event.noteId || n.path === event.noteId));
  if (linkedNote) {
    linkedNote.group_tags = Array.isArray(event.group_tags) ? [...event.group_tags] : [];
    linkedNote.major_topic_tags = Array.isArray(event.major_topic_tags) ? [...event.major_topic_tags] : [];
    linkedNote.topic_tags = Array.isArray(event.topic_tags) ? [...event.topic_tags] : [];
    const saveFn = (typeof saveManifest === 'function')
      ? saveManifest
      : ((typeof window !== 'undefined' && typeof window.saveManifest === 'function') ? window.saveManifest : null);
    if (saveFn) {
      try {
        saveFn({ force: true });
      } catch (err) {
        console.warn('Error saving manifest after tag sync:', err);
      }
    }
  }
}

// Close the dedicated series modal
function closePlannerSeriesModal() {
  const modal = document.getElementById('planner-series-modal');
  if (modal) modal.remove();
  window._plannerSeriesBaseline = null;
}

// Delete an entire recurring series
async function deletePlannerSeries(recurrenceId) {
  if (!recurrenceId) return;
  const confirmMsg = t('planner.confirmDeleteSeries') || 'Are you sure you want to delete all sessions in this series?';
  const confirmed = (typeof showConfirmDialog === 'function')
    ? await showConfirmDialog(confirmMsg, { isDanger: true, confirmLabel: t('planner.deleteEvent') || 'Delete Series' })
    : confirm(confirmMsg);
  if (!confirmed) return;

  pushPlannerUndoState('Delete series');
  const removedMainIds = new Set(
    plannerEvents.filter(e => e.recurrenceId === recurrenceId && e.type !== 'prep').map(e => e.id)
  );
  plannerEvents = plannerEvents.filter(e => {
    if (e.recurrenceId !== recurrenceId) return true;
    if (e.type === 'prep') return !removedMainIds.has(e.prepForEventId);
    return !removedMainIds.has(e.id);
  });
  closePlannerSeriesModal();
  await savePlanner();
  renderPlanner();
  toast(t('planner.seriesDeletedSuccess') || 'Series deleted');
}

// Open Dedicated Series Edit Modal
function openPlannerSeriesModal(recurrenceId, initialEventId = null) {
  if (!recurrenceId) return;
  closePlannerSeriesModal();
  document.getElementById('planner-dynamic-modal')?.remove();

  // Find all series events (excluding auto prep blocks)
  const seriesEvents = (typeof plannerEvents !== 'undefined' ? plannerEvents : [])
    .filter(e => e.recurrenceId === recurrenceId && e.type !== 'prep');

  if (!seriesEvents.length) {
    toast(t('planner.eventNotFound') || 'Series events not found', true);
    return;
  }

  // Chronological order
  seriesEvents.sort((a, b) => {
    const aTime = `${a.date || ''}T${a.startTime || '00:00'}`;
    const bTime = `${b.date || ''}T${b.startTime || '00:00'}`;
    return aTime.localeCompare(bTime);
  });

  // Identify master event (has recurrenceRule or is first event)
  const masterEvent = seriesEvents.find(e => e.recurrenceRule) || seriesEvents[0];
  const recRule = masterEvent.recurrenceRule || { interval: 1, unit: 'week', until: null };
  const baseInterval = recRule.interval || 1;
  const baseUnit = recRule.unit || 'week';
  const baseUntil = recRule.until || '';
  const baseStartTime = masterEvent.startTime || '09:00';
  const baseEndTime = masterEvent.endTime || '10:00';
  const baseDuration = _calcDurationMins(baseStartTime, baseEndTime);
  const baseTemplateId = masterEvent.noteTemplateId || 'standard';
  const baseType = masterEvent.type || 'work';
  const baseTitle = masterEvent.title || '';

  const baseGroupTags = Array.isArray(masterEvent.group_tags) ? [...masterEvent.group_tags] : [];
  const baseMajorTags = Array.isArray(masterEvent.major_topic_tags) ? [...masterEvent.major_topic_tags] : [];
  const baseTopicTags = Array.isArray(masterEvent.topic_tags) ? [...masterEvent.topic_tags] : [];
  const baseTagsCanonical = [...new Set([...baseGroupTags, ...baseMajorTags, ...baseTopicTags])].map(t => String(t).trim().toLowerCase()).sort();

  const baseCollabIds = (Array.isArray(masterEvent.collaboratorIds) ? masterEvent.collaboratorIds : []).map(c => String(c).trim().toLowerCase()).sort();
  const baseCollabs = (Array.isArray(masterEvent.collaborators) ? masterEvent.collaborators : []).map(c => String(c).trim().toLowerCase()).sort();

  const todayStr = formatLocalDateValue(new Date());

  // Detect drift for each session
  const analyzedSessions = seriesEvents.map(ev => {
    const isPast = (ev.date || '') < todayStr;
    const evDuration = _calcDurationMins(ev.startTime, ev.endTime);

    // Schedule drift: check start time and occurrence date against recurrence rule
    let isScheduleDrifted = false;
    if (ev.startTime !== baseStartTime) {
      isScheduleDrifted = true;
    } else if (ev.date && masterEvent && masterEvent.recurrenceRule) {
      if (!shouldEventOccurOnDate(masterEvent, ev.date)) {
        isScheduleDrifted = true;
      }
    }
    if (ev.isRescheduled || (ev.originalDate && ev.originalDate !== ev.date)) {
      isScheduleDrifted = true;
    }

    // Duration drift
    const isDurationDrifted = (evDuration !== baseDuration);

    // Tags drift
    const evGroupTags = Array.isArray(ev.group_tags) ? ev.group_tags : [];
    const evMajorTags = Array.isArray(ev.major_topic_tags) ? ev.major_topic_tags : [];
    const evTopicTags = Array.isArray(ev.topic_tags) ? ev.topic_tags : [];
    const evAllTags = [...new Set([...evGroupTags, ...evMajorTags, ...evTopicTags, ...(ev.tags || [])])].filter(Boolean);
    const evTagsCanonical = evAllTags.map(t => String(t).trim().toLowerCase()).sort();

    const isTagsDrifted = (evTagsCanonical.length !== baseTagsCanonical.length) ||
      evTagsCanonical.some((t, i) => t !== baseTagsCanonical[i]);

    // Collabs drift
    const evCollabIds = (Array.isArray(ev.collaboratorIds) ? ev.collaboratorIds : []).map(c => String(c).trim().toLowerCase()).sort();
    const evCollabs = (Array.isArray(ev.collaborators) ? ev.collaborators : []).map(c => String(c).trim().toLowerCase()).sort();
    const isCollabDrifted = (baseCollabIds.length > 0 || evCollabIds.length > 0)
      ? (evCollabIds.length !== baseCollabIds.length || evCollabIds.some((c, i) => c !== baseCollabIds[i]))
      : (evCollabs.length !== baseCollabs.length || evCollabs.some((c, i) => c !== baseCollabs[i]));

    return {
      event: ev,
      isPast,
      duration: evDuration,
      isScheduleDrifted,
      isDurationDrifted,
      isTagsDrifted,
      isCollabDrifted,
      tags: evAllTags
    };
  });

  const availableTemplates = (typeof NoteTemplateManager !== 'undefined' && typeof NoteTemplateManager.getTemplates === 'function')
    ? NoteTemplateManager.getTemplates()
    : [
        { id: 'standard', name: 'Standard Note', icon: '📝' },
        { id: 'meeting_1on1', name: '1-on-1 Meeting', icon: '👥' },
        { id: 'project_kickoff', name: 'Project Kickoff', icon: '🚀' },
        { id: 'decision_rfc', name: 'Decision / RFC', icon: '⚖️' },
        { id: 'postmortem', name: 'Incident Postmortem', icon: '🛠️' },
        { id: 'daily_standup', name: 'Daily Standup', icon: '☀️' }
      ];

  const standardDurOpts = [15, 30, 45, 60, 90, 120, 180];
  const isCustomDur = !standardDurOpts.includes(baseDuration);

  // Recurrence rule summary text
  const masterEventDate = parseLocalDateValue(masterEvent.date);
  const ruleSummaryText = formatPlannerRecurrenceRuleSummary(recRule, masterEvent.date);

  // Store baseline snapshot for field modification detection
  window._plannerSeriesBaseline = {
    title: baseTitle,
    type: baseType,
    startTime: baseStartTime,
    endTime: baseEndTime,
    duration: baseDuration,
    templateId: baseTemplateId,
    groupTags: [...baseGroupTags],
    majorTags: [...baseMajorTags],
    topicTags: [...baseTopicTags],
    collabIds: [...baseCollabIds]
  };

  // Find index of first upcoming session for scroll target
  const firstUpcomingIndex = analyzedSessions.findIndex(s => !s.isPast);

  // Build Modal DOM
  const overlay = document.createElement('div');
  overlay.id = 'planner-series-modal';
  overlay.className = 'planner-series-modal-overlay active';

  overlay.innerHTML = `
    <div class="planner-series-modal-box" role="dialog" aria-modal="true" aria-labelledby="ps-modal-title">
      <!-- Header -->
      <div class="planner-series-modal-header">
        <div class="planner-series-modal-header-left">
          <h2 class="planner-series-modal-title" id="ps-modal-title"><span style="display:inline-flex;align-items:center;gap:6px;">${_renderPlannerSvgIcon('repeat', 18)} <span>${escH(t('planner.editSeriesTitle') || 'Edit Recurring Series')}</span></span></h2>
          <span class="planner-series-rule-badge" id="ps-rule-badge">${escH(ruleSummaryText)}</span>
        </div>
        <button type="button" class="btn-icon" onclick="closePlannerSeriesModal()" title="${escA(t('common.close') || 'Close')}" style="border:none;background:transparent;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:4px;">${_renderPlannerSvgIcon('close', 14)}</button>
      </div>

      <!-- Body: Settings (left) + Explorer (right) -->
      <div class="planner-series-modal-body">
        <!-- Settings Pane -->
        <div class="planner-series-settings-pane">
          <div style="font-weight: 700; font-size: 0.95rem; color: var(--accent); display: flex; align-items: center; gap: 6px;">
            ${_renderPlannerSvgIcon('settings', 15)} <span>${escH(t('planner.seriesPropertiesSettings') || 'Series Details')}</span>
          </div>

          <!-- Title -->
          <div class="field-row">
            <span class="field-label">${escH(t('planner.title') || 'Title')}</span>
            <input type="text" id="ps-title" class="field-input" value="${escA(baseTitle)}" placeholder="${escA(t('planner.eventTitlePlaceholder') || 'Series title…')}">
          </div>

          <!-- Type -->
          <div class="field-row">
            <span class="field-label">${escH(t('planner.type') || 'Type')}</span>
            <select id="ps-type" class="field-input">
              <option value="call" ${baseType === 'call' ? 'selected' : ''}>${escH(t('planner.call') || 'Call')}</option>
              <option value="sync" ${baseType === 'sync' ? 'selected' : ''}>${escH(t('planner.sync') || 'Sync')}</option>
              <option value="work" ${baseType === 'work' ? 'selected' : ''}>${escH(t('planner.work') || 'Work')}</option>
              <option value="custom" ${baseType === 'custom' ? 'selected' : ''}>${escH(t('planner.custom') || 'Custom')}</option>
              <option value="ooo" ${baseType === 'ooo' ? 'selected' : ''}>${escH(t('planner.ooo') || 'Out of Office')}</option>
            </select>
          </div>

          <!-- Time & Duration -->
          <div style="font-weight: 700; font-size: 0.88rem; color: var(--text); margin-top: 0.4rem; display: flex; align-items: center; gap: 6px;">
            ${_renderPlannerSvgIcon('clock', 15)} <span>${escH(t('planner.seriesScheduleSettings') || 'Schedule & Timing')}</span>
          </div>

          <div style="display: flex; gap: 0.6rem; flex-wrap: wrap; width: 100%;">
            <div style="flex: 1; min-width: 100px;">
              <span class="field-label" style="font-size: 0.78rem;">${escH(t('planner.startTime') || 'Start')}</span>
              <input type="time" id="ps-start-time" class="field-input" value="${escA(baseStartTime)}" oninput="_plannerSeriesSyncDuration()" style="width: 100%;">
            </div>
            <div style="flex: 1; min-width: 100px;">
              <span class="field-label" style="font-size: 0.78rem;">${escH(t('planner.durationLabel') || 'Duration')}</span>
              <select id="ps-duration" class="field-input" oninput="_plannerSeriesSyncEndFromDuration()" style="width: 100%;">
                <option value="15" ${baseDuration === 15 ? 'selected' : ''}>15 min</option>
                <option value="30" ${baseDuration === 30 ? 'selected' : ''}>30 min</option>
                <option value="45" ${baseDuration === 45 ? 'selected' : ''}>45 min</option>
                <option value="60" ${baseDuration === 60 ? 'selected' : ''}>1 h</option>
                <option value="90" ${baseDuration === 90 ? 'selected' : ''}>1 h 30</option>
                <option value="120" ${baseDuration === 120 ? 'selected' : ''}>2 h</option>
                <option value="180" ${baseDuration === 180 ? 'selected' : ''}>3 h</option>
                <option value="custom" ${isCustomDur ? 'selected' : ''}>${escH(t('planner.customEndTime') || 'Custom end time')}</option>
              </select>
            </div>
            <div style="flex: 1; min-width: 100px; display: ${isCustomDur ? 'block' : 'none'};" id="ps-end-time-field">
              <span class="field-label" style="font-size: 0.78rem;">${escH(t('planner.endTime') || 'End')}</span>
              <input type="time" id="ps-end-time" class="field-input" value="${escA(baseEndTime)}" oninput="_plannerSeriesSyncDurationFromEnd()" style="width: 100%;">
            </div>
          </div>

          <!-- Series Recurrence Pattern Configuration -->
          <div style="background: var(--card-bg-alt); padding: 0.65rem 0.75rem; border-radius: var(--radius-sm, 6px); border: 1px solid var(--card-border); margin-top: 0.35rem;">
            <div style="font-weight: 700; font-size: 0.85rem; color: var(--text); margin-bottom: 0.45rem; display: flex; align-items: center; gap: 6px;">
              ${_renderPlannerSvgIcon('repeat', 15)} <span>${escH(t('planner.seriesRecurrenceSettings') || 'Series Recurrence')}</span>
            </div>

            <!-- Interval & Unit -->
            <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.45rem;">
              <span style="font-size: 0.8rem;">${escH(t('planner.repeatLabel') || 'Every')}</span>
              <input type="number" id="ps-recurrence-interval" value="${baseInterval}" min="1" max="99" class="field-input" oninput="_updatePlannerSeriesRuleBadge()" style="width: 55px; text-align: center;" title="${escA(t('planner.repeatLabel') || 'Repeat interval')}">
              <select id="ps-recurrence-unit" class="field-input" onchange="_togglePlannerRecurrenceUnit(this.value, 'ps')" style="width: 105px;" title="${escA(t('planner.everyLabel') || 'Repeat unit')}">
                <option value="day" ${baseUnit === 'day' ? 'selected' : ''}>${escH(t('planner.dayLabel') || 'day(s)')}</option>
                <option value="week" ${baseUnit === 'week' ? 'selected' : ''}>${escH(t('planner.weekLabel') || 'week(s)')}</option>
                <option value="month" ${baseUnit === 'month' ? 'selected' : ''}>${escH(t('planner.monthLabel') || 'month(s)')}</option>
                <option value="year" ${baseUnit === 'year' ? 'selected' : ''}>${escH(t('planner.yearLabel') || 'year(s)')}</option>
              </select>
            </div>

            <!-- Daily workdays only -->
            <div id="ps-recurrence-daily-wrap" style="display: ${baseUnit === 'day' ? 'flex' : 'none'}; align-items: center; gap: 0.35rem; margin-bottom: 0.45rem;">
              <label style="display: inline-flex; align-items: center; gap: 6px; cursor: pointer;" title="${escA(t('planner.repeatWorkdaysOnlyTooltip'))}">
                <input type="checkbox" id="ps-recurrence-workdays-only" ${recRule.workdaysOnly ? 'checked' : ''} onchange="_updatePlannerSeriesRuleBadge()" style="accent-color: var(--accent);">
                <span style="font-size: 0.8rem;">${escH(t('planner.repeatWorkdaysOnly') || 'Workdays only (Mon-Fri)')}</span>
              </label>
            </div>

            <!-- Weekly days -->
            <div id="ps-recurrence-weekly-wrap" style="display: ${baseUnit === 'week' ? 'flex' : 'none'}; flex-direction: column; gap: 0.3rem; margin-bottom: 0.45rem;">
              <span style="font-size: 0.78rem; color: var(--text-muted);">${escH(t('planner.repeatDaysLabel') || 'Repeat on')}:</span>
              <div id="ps-recurrence-weekdays" style="display: flex; gap: 4px; flex-wrap: wrap;">
                ${_PLANNER_WEEKDAY_DEFS.map(d => {
                  const isSel = (recRule.weekdays && recRule.weekdays.length)
                    ? recRule.weekdays.includes(d.day)
                    : (masterEventDate ? masterEventDate.getDay() === d.day : d.day === 1);
                  return `
                    <button type="button" class="btn btn-sm planner-weekday-pill ${isSel ? 'active' : ''}" data-day="${d.day}" onclick="_togglePlannerWeekdayPill(this)" title="${escA(t('planner.weekdayToggleTooltip'))}: ${escA(t(d.fullKey) || d.fallbackFull)}" style="min-width: 32px; padding: 2px 6px; font-size: 0.75rem; font-weight: 600; text-align: center; border-radius: var(--radius-sm, 6px); ${isSel ? 'background: var(--accent); color: #fff; border-color: var(--accent);' : ''}">
                      ${escH(t(d.key) || d.fallback)}
                    </button>
                  `;
                }).join('')}
              </div>
            </div>

            <!-- Monthly pattern -->
            <div id="ps-recurrence-monthly-wrap" style="display: ${baseUnit === 'month' ? 'flex' : 'none'}; flex-direction: column; gap: 0.4rem; margin-bottom: 0.45rem;">
              <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                <span style="font-size: 0.78rem; color: var(--text-muted);">${escH(t('planner.monthlyPatternLabel') || 'Monthly pattern')}:</span>
                <select id="ps-recurrence-monthly-type" class="field-input" onchange="_togglePlannerMonthlyType(this.value, 'ps')" style="flex: 1; min-width: 170px; font-size: 0.78rem;" title="${escA(t('planner.monthlyPatternLabel') || 'Monthly pattern')}">
                  <option value="day_of_month" ${(recRule.monthlyType || 'day_of_month') === 'day_of_month' ? 'selected' : ''} title="${escA(t('planner.monthlyOnDayTooltip'))}">${escH(t('planner.monthlyOnDay') || 'On day of the month')}</option>
                  <option value="nth_workday" ${recRule.monthlyType === 'nth_workday' ? 'selected' : ''} title="${escA(t('planner.monthlyOnNthWorkdayTooltip'))}">${escH(t('planner.monthlyOnNthWorkday') || 'On the work day of the month')}</option>
                  <option value="nth_weekday" ${recRule.monthlyType === 'nth_weekday' ? 'selected' : ''} title="${escA(t('planner.monthlyOnNthWeekdayTooltip'))}">${escH(t('planner.monthlyOnNthWeekday') || 'On the weekday of the month')}</option>
                </select>
              </div>
              <!-- Sub-options for day_of_month -->
              <div id="ps-recurrence-monthly-day-sub" style="display: ${(recRule.monthlyType || 'day_of_month') === 'day_of_month' ? 'flex' : 'none'}; align-items: center; gap: 0.5rem;">
                <span style="font-size: 0.78rem;">${escH(t('planner.onDayLabel') || 'on day')}:</span>
                <input type="number" id="ps-recurrence-monthly-day" class="field-input" value="${recRule.monthlyDay || (masterEventDate ? masterEventDate.getDate() : 1)}" min="1" max="31" oninput="_updatePlannerSeriesRuleBadge()" style="width: 55px; text-align: center; font-size: 0.78rem;" title="${escA(t('planner.monthlyOnDayTooltip'))}">
              </div>
              <!-- Sub-options for nth_workday -->
              <div id="ps-recurrence-monthly-nth-workday-sub" style="display: ${recRule.monthlyType === 'nth_workday' ? 'flex' : 'none'}; align-items: center; gap: 0.5rem;">
                <span style="font-size: 0.78rem;">${escH(t('planner.onTheLabel') || 'on the')}:</span>
                <select id="ps-recurrence-monthly-workday-nth" class="field-input" onchange="_updatePlannerSeriesRuleBadge()" style="width: 90px; font-size: 0.78rem;" title="${escA(t('planner.monthlyOnNthWorkdayTooltip'))}">
                  <option value="1" ${String(recRule.monthlyNth || '1') === '1' ? 'selected' : ''}>${escH(t('planner.nthFirst') || '1st')}</option>
                  <option value="2" ${String(recRule.monthlyNth) === '2' ? 'selected' : ''}>${escH(t('planner.nthSecond') || '2nd')}</option>
                  <option value="3" ${String(recRule.monthlyNth) === '3' ? 'selected' : ''}>${escH(t('planner.nthThird') || '3rd')}</option>
                  <option value="4" ${String(recRule.monthlyNth) === '4' ? 'selected' : ''}>${escH(t('planner.nthFourth') || '4th')}</option>
                  <option value="-1" ${String(recRule.monthlyNth) === '-1' ? 'selected' : ''}>${escH(t('planner.nthLast') || 'Last')}</option>
                </select>
                <span style="font-size: 0.78rem;">${escH(t('planner.workdayLabel') || 'work day')}</span>
              </div>
              <!-- Sub-options for nth_weekday -->
              <div id="ps-recurrence-monthly-nth-weekday-sub" style="display: ${recRule.monthlyType === 'nth_weekday' ? 'flex' : 'none'}; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                <span style="font-size: 0.78rem;">${escH(t('planner.onTheLabel') || 'on the')}:</span>
                <select id="ps-recurrence-monthly-weekday-nth" class="field-input" onchange="_updatePlannerSeriesRuleBadge()" style="width: 85px; font-size: 0.78rem;" title="${escA(t('planner.monthlyOnNthWeekdayTooltip'))}">
                  <option value="1" ${String(recRule.monthlyNth || '1') === '1' ? 'selected' : ''}>${escH(t('planner.nthFirst') || '1st')}</option>
                  <option value="2" ${String(recRule.monthlyNth) === '2' ? 'selected' : ''}>${escH(t('planner.nthSecond') || '2nd')}</option>
                  <option value="3" ${String(recRule.monthlyNth) === '3' ? 'selected' : ''}>${escH(t('planner.nthThird') || '3rd')}</option>
                  <option value="4" ${String(recRule.monthlyNth) === '4' ? 'selected' : ''}>${escH(t('planner.nthFourth') || '4th')}</option>
                  <option value="-1" ${String(recRule.monthlyNth) === '-1' ? 'selected' : ''}>${escH(t('planner.nthLast') || 'Last')}</option>
                </select>
                <select id="ps-recurrence-monthly-weekday" class="field-input" onchange="_updatePlannerSeriesRuleBadge()" style="flex: 1; min-width: 100px; font-size: 0.78rem;" title="${escA(t('planner.monthlyOnNthWeekdayTooltip'))}">
                  ${_PLANNER_WEEKDAY_DEFS.map(d => `<option value="${d.day}" ${(recRule.monthlyWeekday !== undefined ? parseInt(recRule.monthlyWeekday, 10) : (masterEventDate ? masterEventDate.getDay() : 2)) === d.day ? 'selected' : ''}>${escH(t(d.fullKey) || d.fallbackFull)}</option>`).join('')}
                </select>
              </div>
            </div>
          </div>

          <!-- Recurrence End Date Controls -->
          <div style="background: var(--card-bg-alt); padding: 0.65rem 0.75rem; border-radius: var(--radius-sm, 6px); border: 1px solid var(--card-border); margin-top: 0.2rem;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.45rem;">
              <span style="font-size: 0.8rem; font-weight: 600; color: var(--text);">${escH(t('planner.endDateLabel') || 'End date')}</span>
              <label style="display: inline-flex; align-items: center; gap: 4px; font-size: 0.78rem; cursor: pointer;" title="${escA(t('planner.noEndDateTooltip') || 'Allow recurrence to continue indefinitely without an end date')}">
                <input type="checkbox" id="ps-no-end-date" ${!baseUntil ? 'checked' : ''} onchange="_togglePlannerSeriesNoEndDate(this.checked)" style="accent-color: var(--accent);">
                <span>${escH(t('planner.noEndDate') || 'No end date')}</span>
              </label>
            </div>
            <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
              <input type="date" id="ps-until-date" class="field-input" value="${escA(baseUntil)}" ${!baseUntil ? 'disabled style="opacity:0.5;flex:1;min-width:130px;"' : 'style="flex:1;min-width:130px;"'} title="${escA(t('planner.endDateTooltip') || 'Date when this recurring series stops')}">
              <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                <button type="button" class="btn btn-sm" onclick="_setPlannerSeriesEndDatePreset('3m')" title="${escA(t('planner.quickAdd3MonthsTooltip') || 'Set end date to 3 months from today')}">${escH(t('planner.quickAdd3Months') || '+3m')}</button>
                <button type="button" class="btn btn-sm" onclick="_setPlannerSeriesEndDatePreset('6m')" title="${escA(t('planner.quickAdd6MonthsTooltip') || 'Set end date to 6 months from today')}">${escH(t('planner.quickAdd6Months') || '+6m')}</button>
                <button type="button" class="btn btn-sm" onclick="_setPlannerSeriesEndDatePreset('1y')" title="${escA(t('planner.quickAdd1YearTooltip') || 'Set end date to 1 year from today')}">${escH(t('planner.quickAdd1Year') || '+1y')}</button>
                <button type="button" class="btn btn-sm" onclick="_setPlannerSeriesEndDatePreset('now')" title="${escA(t('planner.quickEndNowTooltip') || 'Set end date to today to end future recurrence')}">${escH(t('planner.quickEndNow') || 'End now')}</button>
              </div>
            </div>
          </div>

          <!-- Meeting Note Layout Picker -->
          <div class="field-row" style="margin-top: 0.3rem;">
            <span class="field-label" title="${escA(t('planner.meetingNoteLayoutTooltip') || 'Template used when generating notes for sessions in this series')}">
              ${escH(t('planner.meetingNoteLayout') || 'Meeting Note Layout')}
            </span>
            <select id="ps-note-template" class="field-input" title="${escA(t('planner.meetingNoteLayoutTooltip') || 'Template used when generating notes for sessions in this series')}">
              ${availableTemplates.map(tmpl => `
                <option value="${escA(tmpl.id)}" ${tmpl.id === baseTemplateId ? 'selected' : ''}>
                  ${tmpl.icon ? tmpl.icon + ' ' : ''}${escH(tmpl.name)}
                </option>
              `).join('')}
            </select>
          </div>

          <!-- Tags -->
          <div style="margin-top: 0.3rem;">
            <div style="font-weight: 700; font-size: 0.88rem; color: var(--text); margin-bottom: 0.35rem; display: flex; align-items: center; gap: 6px;">${_renderPlannerSvgIcon('tag', 15)} <span>${escH(t('planner.tags') || 'Tags')}</span></div>
            <div class="field-row" style="margin-bottom: 0.4rem;">
              <span class="field-label" style="font-size: 0.78rem;">${escH(t('planner.groupTags') || 'Groups')}</span>
              <div id="ps-group-tags" class="tag-editor-container" style="flex:1;"></div>
            </div>
            <div class="field-row" style="margin-bottom: 0.4rem;">
              <span class="field-label" style="font-size: 0.78rem;">${escH(t('planner.majorTopicTags') || 'Majors')}</span>
              <div id="ps-major-tags" class="tag-editor-container" style="flex:1;"></div>
            </div>
            <div class="field-row" style="margin-bottom: 0.4rem;">
              <span class="field-label" style="font-size: 0.78rem;">${escH(t('planner.topicTags') || 'Topics')}</span>
              <div id="ps-topic-tags" class="tag-editor-container" style="flex:1;"></div>
            </div>
          </div>

          <!-- Collaborators -->
          <div style="margin-top: 0.3rem;">
            <div style="font-weight: 700; font-size: 0.88rem; color: var(--text); margin-bottom: 0.35rem; display: flex; align-items: center; gap: 6px;">${_renderPlannerSvgIcon('users', 15)} <span>${escH(t('planner.collaborators') || 'Participants')}</span></div>
            <div id="ps-collaborators-list" style="width: 100%;"></div>
          </div>

          <!-- Propagation Scope Selection -->
          <div style="background: color-mix(in srgb, var(--accent) 8%, var(--card-bg-alt)); padding: 0.75rem 0.85rem; border-radius: var(--radius-md, 8px); border: 1px solid color-mix(in srgb, var(--accent) 25%, var(--card-border)); margin-top: 0.5rem;">
            <div style="font-weight: 700; font-size: 0.85rem; color: var(--accent); margin-bottom: 0.5rem; display: flex; align-items: center; justify-content: space-between;">
              <span style="display:inline-flex;align-items:center;gap:6px;">${_renderPlannerSvgIcon('globe', 15)} <span>${escH(t('planner.propagationOptionsTitle') || 'Apply Changes To')}</span></span>
            </div>

            <!-- Global Scope Preset Selector -->
            <select id="ps-global-scope" class="field-input" onchange="_applyPlannerSeriesGlobalScope(this.value)" style="width: 100%; margin-bottom: 0.5rem; font-weight: 600;">
              <option value="coming" selected title="${escA(t('planner.allComingSessionsTooltip'))}">${escH(t('planner.allComingSessions') || 'Upcoming sessions only')}</option>
              <option value="all_history" title="${escA(t('planner.allSessionsHistoryTooltip'))}">${escH(t('planner.allSessionsHistory') || 'All sessions (past & future)')}</option>
              <option value="unmodified" title="${escA(t('planner.onlyUnmodifiedSessionsTooltip'))}">${escH(t('planner.onlyUnmodifiedSessions') || 'Only unmodified sessions for this setting')}</option>
              <option value="selection" title="${escA(t('planner.selectedSessionsOnlyTooltip'))}">${escH(t('planner.selectedSessionsOnly') || 'Selected sessions only')}</option>
            </select>

            <!-- Granular per-dimension controls -->
            <div style="display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.78rem;">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;">
                <span style="color: var(--text-muted);">${escH(t('planner.titleAndType') || 'Title & Type')}:</span>
                <select id="ps-scope-title" class="field-input" disabled style="padding: 2px 6px; font-size: 0.75rem; width: 180px; opacity: 0.55; cursor: not-allowed;" title="${escA(t('planner.scopeDisabledNoChangesTooltip') || 'No changes made to this field')}">
                  <option value="all_history">${escH(t('planner.allSessionsHistory') || 'All sessions')}</option>
                  <option value="coming">${escH(t('planner.allComingSessions') || 'Upcoming sessions')}</option>
                  <option value="unmodified">${escH(t('planner.onlyUnmodifiedSessions') || 'Unmodified only')}</option>
                  <option value="selection">${escH(t('planner.selectedSessionsOnly') || 'Selected only')}</option>
                </select>
              </div>
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;">
                <span style="color: var(--text-muted);">${escH(t('planner.seriesScheduleSettings') || 'Schedule')}:</span>
                <select id="ps-scope-schedule" class="field-input" disabled style="padding: 2px 6px; font-size: 0.75rem; width: 180px; opacity: 0.55; cursor: not-allowed;" title="${escA(t('planner.scopeDisabledNoChangesTooltip') || 'No changes made to this field')}">
                  <option value="all_history">${escH(t('planner.allSessionsHistory') || 'All sessions')}</option>
                  <option value="coming">${escH(t('planner.allComingSessions') || 'Upcoming sessions')}</option>
                  <option value="unmodified">${escH(t('planner.onlyUnmodifiedSessions') || 'Unmodified only')}</option>
                  <option value="selection">${escH(t('planner.selectedSessionsOnly') || 'Selected only')}</option>
                </select>
              </div>
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;">
                <span style="color: var(--text-muted);">${escH(t('planner.tags') || 'Tags')}:</span>
                <select id="ps-scope-tags" class="field-input" disabled style="padding: 2px 6px; font-size: 0.75rem; width: 180px; opacity: 0.55; cursor: not-allowed;" title="${escA(t('planner.scopeDisabledNoChangesTooltip') || 'No changes made to this field')}">
                  <option value="all_history">${escH(t('planner.allSessionsHistory') || 'All sessions')}</option>
                  <option value="coming">${escH(t('planner.allComingSessions') || 'Upcoming sessions')}</option>
                  <option value="unmodified">${escH(t('planner.onlyUnmodifiedSessions') || 'Unmodified only')}</option>
                  <option value="selection">${escH(t('planner.selectedSessionsOnly') || 'Selected only')}</option>
                </select>
              </div>
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;">
                <span style="color: var(--text-muted);">${escH(t('planner.collaborators') || 'Participants')}:</span>
                <select id="ps-scope-collab" class="field-input" disabled style="padding: 2px 6px; font-size: 0.75rem; width: 180px; opacity: 0.55; cursor: not-allowed;" title="${escA(t('planner.scopeDisabledNoChangesTooltip') || 'No changes made to this field')}">
                  <option value="all_history">${escH(t('planner.allSessionsHistory') || 'All sessions')}</option>
                  <option value="coming">${escH(t('planner.allComingSessions') || 'Upcoming sessions')}</option>
                  <option value="unmodified">${escH(t('planner.onlyUnmodifiedSessions') || 'Unmodified only')}</option>
                  <option value="selection">${escH(t('planner.selectedSessionsOnly') || 'Selected only')}</option>
                </select>
              </div>
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;">
                <span style="color: var(--text-muted);">${escH(t('planner.meetingNoteLayout') || 'Layout')}:</span>
                <select id="ps-scope-template" class="field-input" disabled style="padding: 2px 6px; font-size: 0.75rem; width: 180px; opacity: 0.55; cursor: not-allowed;" title="${escA(t('planner.scopeDisabledNoChangesTooltip') || 'No changes made to this field')}">
                  <option value="all_history">${escH(t('planner.allSessionsHistory') || 'All sessions')}</option>
                  <option value="coming">${escH(t('planner.allComingSessions') || 'Upcoming sessions')}</option>
                  <option value="unmodified">${escH(t('planner.onlyUnmodifiedSessions') || 'Unmodified only')}</option>
                  <option value="selection">${escH(t('planner.selectedSessionsOnly') || 'Selected only')}</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <!-- Explorer Pane (right side) -->
        <div class="planner-series-explorer-pane">
          <!-- Explorer Header -->
          <div class="planner-series-explorer-header">
            <div style="font-weight: 700; font-size: 0.95rem; display: flex; align-items: center; gap: 8px;">
              ${_renderPlannerSvgIcon('calendar', 16)} <span>${escH(t('planner.sessionsExplorerTitle') || 'Series Sessions')}</span>
              <span style="font-size: 0.78rem; font-weight: 600; padding: 0.1rem 0.5rem; background: color-mix(in srgb, var(--accent) 15%, transparent); color: var(--accent); border-radius: 999px;">
                ${seriesEvents.length}
              </span>
            </div>
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <button type="button" class="btn btn-sm" onclick="_togglePlannerSeriesSessionSelection(true)" title="${escA(t('planner.selectAllTooltip') || t('common.selectAll') || 'Select all')}">
                ${escH(t('common.selectAll') || 'Select all')}
              </button>
              <button type="button" class="btn btn-sm" onclick="_togglePlannerSeriesSessionSelection(false)" title="${escA(t('planner.deselectAllTooltip') || t('common.deselectAll') || 'Deselect all')}">
                ${escH(t('common.deselectAll') || 'Deselect all')}
              </button>
            </div>
          </div>

          <!-- Sessions List -->
          <div class="planner-series-sessions-scroll" id="ps-sessions-scroll">
            ${analyzedSessions.map((item, idx) => {
              const ev = item.event;
              let dividerHtml = '';
              if (idx === firstUpcomingIndex && idx > 0) {
                dividerHtml = `
                  <div class="planner-series-divider planner-series-divider--upcoming" id="ps-upcoming-divider">
                    <span>${escH(t('planner.upcomingSessionsHeader') || 'Upcoming Sessions')}</span>
                  </div>
                `;
              } else if (idx === 0 && !item.isPast) {
                dividerHtml = `
                  <div class="planner-series-divider planner-series-divider--upcoming" id="ps-upcoming-divider">
                    <span>${escH(t('planner.upcomingSessionsHeader') || 'Upcoming Sessions')}</span>
                  </div>
                `;
              } else if (idx === 0 && item.isPast) {
                dividerHtml = `
                  <div class="planner-series-divider">
                    <span>${escH(t('planner.pastSessionsHeader') || 'Past Sessions')}</span>
                  </div>
                `;
              }

              const hasNote = !!ev.noteId;
              const noteBtnTitle = hasNote
                ? (t('planner.openSessionNoteTooltip') || 'Open note for this session in the note editor')
                : (t('planner.createSessionNoteTooltip') || 'Create note for this session with the series layout');

              return `
                ${dividerHtml}
                <div class="planner-series-session-card ${item.isPast ? 'is-past' : ''}" data-event-id="${escA(ev.id)}" ondblclick="_handlePlannerSeriesCardDblClick(${jq(ev.id)})" title="${escA(t('planner.doubleClickSessionToEdit') || 'Double-click to edit this session block')}">
                  <div class="planner-series-session-card-header">
                    <div class="planner-series-session-card-left">
                      <input type="checkbox" class="planner-series-session-checkbox" data-event-id="${escA(ev.id)}" checked onclick="event.stopPropagation()">
                      <span class="planner-series-session-date">${escH(ev.date)}</span>
                      <span class="planner-series-session-time">${escH(ev.startTime)} - ${escH(ev.endTime)}</span>
                      <span style="font-size:0.8rem; font-weight:500; color:var(--text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:180px;">${escH(ev.title || '')}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 6px;">
                      <button type="button" class="planner-session-note-btn ${hasNote ? 'has-note' : 'no-note'}" onclick="_handlePlannerSeriesNoteClick(event, ${jq(ev.id)})" title="${escA(noteBtnTitle)}">
                        <span style="display:inline-flex;align-items:center;gap:4px;">${hasNote ? _renderPlannerSvgIcon('fileText', 12) : (_renderPlannerSvgIcon('plus', 11) + _renderPlannerSvgIcon('fileText', 12))} <span>${escH(t('planner.noteLabel') || 'Note')}</span></span>
                      </button>
                    </div>
                  </div>

                  <!-- Drift chips -->
                  <div class="planner-drift-chips">
                    <span class="planner-drift-badge ${item.isScheduleDrifted ? 'planner-drift-badge--override' : 'planner-drift-badge--match'}">
                      <span style="display:inline-flex;align-items:center;gap:4px;">${item.isScheduleDrifted ? _renderPlannerSvgIcon('alertTriangle', 12) : _renderPlannerSvgIcon('check', 12)} <span>${item.isScheduleDrifted ? escH(t('planner.statusRescheduled') || 'Rescheduled') : escH(t('planner.statusOnSchedule') || 'On schedule')}</span></span>
                    </span>
                    <span class="planner-drift-badge ${item.isDurationDrifted ? 'planner-drift-badge--override' : 'planner-drift-badge--match'}">
                      <span style="display:inline-flex;align-items:center;gap:4px;">${_renderPlannerSvgIcon('timer', 12)} <span>${item.isDurationDrifted ? escH(t('planner.statusDurationCustom') || 'Modified duration') : escH(t('planner.statusDurationSame') || 'Same duration')} (${item.duration}m)</span></span>
                    </span>
                    <span class="planner-drift-badge ${item.isTagsDrifted ? 'planner-drift-badge--override' : 'planner-drift-badge--match'}">
                      <span style="display:inline-flex;align-items:center;gap:4px;">${_renderPlannerSvgIcon('tag', 12)} <span>${item.isTagsDrifted ? escH(t('planner.statusTagsCustom') || 'Different tags') : escH(t('planner.statusTagsSame') || 'Same tags')}</span></span>
                    </span>
                    ${item.isTagsDrifted && item.tags && item.tags.length ? item.tags.map(tag => `<span class="planner-diff-tag-pill">${escH(tag)}</span>`).join('') : ''}
                    <span class="planner-drift-badge ${item.isCollabDrifted ? 'planner-drift-badge--override' : 'planner-drift-badge--match'}">
                      <span style="display:inline-flex;align-items:center;gap:4px;">${_renderPlannerSvgIcon('users', 12)} <span>${item.isCollabDrifted ? escH(t('planner.statusCollabsCustom') || 'Modified participants') : escH(t('planner.statusCollabsSame') || 'Same participants')}</span></span>
                    </span>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="planner-series-modal-footer">
        <button type="button" class="btn" style="color: #dc2626; border-color: #fca5a5; display: inline-flex; align-items: center; gap: 6px;" onclick="deletePlannerSeries(${jq(recurrenceId)})" title="${escA(t('planner.deleteEventTooltip') || 'Delete entire recurring series')}">
          ${_renderPlannerSvgIcon('trash', 14)} <span>${escH(t('planner.deleteEvent') || 'Delete Series')}</span>
        </button>
        <div style="display: flex; align-items: center; gap: 0.6rem;">
          <button type="button" class="btn" onclick="closePlannerSeriesModal()" title="${escA(t('editor.cancel') || 'Cancel')}">
            ${escH(t('editor.cancel') || 'Cancel')}
          </button>
          <button type="button" class="btn btn-save" style="display: inline-flex; align-items: center; gap: 6px;" onclick="savePlannerSeriesFromModal(${jq(recurrenceId)})" title="${escA(t('planner.seriesModalSaveTooltip') || 'Apply changes and update recurring series')}">
            ${_renderPlannerSvgIcon('save', 14)} <span>${escH(t('planner.seriesModalSave') || 'Save Series')}</span>
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Explicitly sync select values after DOM insertion
  const typeSelect = overlay.querySelector('#ps-type');
  if (typeSelect && baseType) typeSelect.value = baseType;
  const templateSelect = overlay.querySelector('#ps-note-template');
  if (templateSelect && baseTemplateId) templateSelect.value = baseTemplateId;
  const durationSelect = overlay.querySelector('#ps-duration');
  if (durationSelect) durationSelect.value = isCustomDur ? 'custom' : String(baseDuration);
  const unitSelect = overlay.querySelector('#ps-recurrence-unit');
  if (unitSelect && baseUnit) unitSelect.value = baseUnit;

  // Initialize Tag Editors
  if (typeof populateTagEditor === 'function') {
    populateTagEditor('ps-group-tags', baseGroupTags, 'group');
    populateTagEditor('ps-major-tags', baseMajorTags, 'major');
    populateTagEditor('ps-topic-tags', baseTopicTags, 'topic');
  }

  // Initialize Collaborator Picker
  if (typeof populateCollaboratorMultiPicker === 'function') {
    const rawIds = Array.isArray(masterEvent.collaboratorIds) ? masterEvent.collaboratorIds : [];
    populateCollaboratorMultiPicker('ps-collaborators-list', rawIds, {
      includeMe: false,
      allowEmpty: true,
      createOnType: true,
      placeholder: t('planner.addNewNamePlaceholder') || 'Add new name...',
      title: t('planner.peopleInputTitle') || t('common.typeOrClickSuggestion') || 'Type or click a suggestion'
    });
  }

  // Bind change listeners to update field dirty states and propagation scope enable/disable states
  const bindSeriesFieldListeners = () => {
    const inputs = overlay.querySelectorAll('#ps-title, #ps-type, #ps-start-time, #ps-duration, #ps-end-time, #ps-note-template, #ps-recurrence-interval, #ps-recurrence-unit, #ps-recurrence-workdays-only, #ps-recurrence-monthly-type, #ps-recurrence-monthly-day, #ps-recurrence-monthly-workday-nth, #ps-recurrence-monthly-weekday-nth, #ps-recurrence-monthly-weekday, #ps-no-end-date, #ps-until-date');
    inputs.forEach(input => {
      input.addEventListener('input', _updatePlannerSeriesFieldChangeStates);
      input.addEventListener('change', _updatePlannerSeriesFieldChangeStates);
    });

    const observeTargets = overlay.querySelectorAll('#ps-group-tags, #ps-major-tags, #ps-topic-tags, #ps-collaborators-list');
    if (typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(() => {
        _updatePlannerSeriesFieldChangeStates();
      });
      observeTargets.forEach(target => {
        observer.observe(target, { childList: true, subtree: true });
      });
    }
    observeTargets.forEach(target => {
      target.addEventListener('click', () => setTimeout(_updatePlannerSeriesFieldChangeStates, 30));
      target.addEventListener('keydown', () => setTimeout(_updatePlannerSeriesFieldChangeStates, 30));
    });
  };
  bindSeriesFieldListeners();
  _updatePlannerSeriesFieldChangeStates();

  // Auto-scroll explorer pane so upcoming sessions start at the top, past sessions above
  setTimeout(() => {
    const divider = document.getElementById('ps-upcoming-divider');
    if (divider) {
      divider.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  }, 60);
}

window._updatePlannerSeriesFieldChangeStates = function() {
  const modal = document.getElementById('planner-series-modal');
  if (!modal) return;
  const baseline = window._plannerSeriesBaseline || {};

  // 1. Title / Type
  const curTitle = (document.getElementById('ps-title')?.value || '').trim();
  const curType = document.getElementById('ps-type')?.value || 'work';
  const baseTitle = (baseline.title || '').trim();
  const baseType = baseline.type || 'work';
  const isTitleDirty = (curTitle !== baseTitle) || (curType !== baseType);

  // 2. Schedule & Duration
  const curStart = document.getElementById('ps-start-time')?.value || '09:00';
  const curEnd = document.getElementById('ps-end-time')?.value || '10:00';
  const baseStart = baseline.startTime || '09:00';
  const baseEnd = baseline.endTime || '10:00';
  const isScheduleDirty = (curStart !== baseStart) || (curEnd !== baseEnd);

  // 3. Tags
  const curGroupTags = (typeof readTagEditor === 'function' ? readTagEditor('ps-group-tags') : []) || [];
  const curMajorTags = (typeof readTagEditor === 'function' ? readTagEditor('ps-major-tags') : []) || [];
  const curTopicTags = (typeof readTagEditor === 'function' ? readTagEditor('ps-topic-tags') : []) || [];
  const baseGroupCanon = (baseline.groupTags || []).map(t => String(t).trim().toLowerCase()).sort();
  const curGroupCanon = curGroupTags.map(t => String(t).trim().toLowerCase()).sort();
  const baseMajorCanon = (baseline.majorTags || []).map(t => String(t).trim().toLowerCase()).sort();
  const curMajorCanon = curMajorTags.map(t => String(t).trim().toLowerCase()).sort();
  const baseTopicCanon = (baseline.topicTags || []).map(t => String(t).trim().toLowerCase()).sort();
  const curTopicCanon = curTopicTags.map(t => String(t).trim().toLowerCase()).sort();

  const isTagsDirty = (baseGroupCanon.length !== curGroupCanon.length || baseGroupCanon.some((t, i) => t !== curGroupCanon[i])) ||
    (baseMajorCanon.length !== curMajorCanon.length || baseMajorCanon.some((t, i) => t !== curMajorCanon[i])) ||
    (baseTopicCanon.length !== curTopicCanon.length || baseTopicCanon.some((t, i) => t !== curTopicCanon[i]));

  // 4. Collaborators
  const rawCollabIds = (typeof readCollaboratorMultiPicker === 'function')
    ? readCollaboratorMultiPicker('ps-collaborators-list')
    : [];
  const curCollabIds = (typeof normalizePlannerCollaboratorIds === 'function')
    ? normalizePlannerCollaboratorIds(rawCollabIds, { allowCreate: true })
    : Array.from(new Set(rawCollabIds.map(v => String(v || '').trim()).filter(Boolean)));
  const baseCollabCanon = (baseline.collabIds || []).map(c => String(c).trim().toLowerCase()).sort();
  const curCollabCanon = curCollabIds.map(c => String(c).trim().toLowerCase()).sort();
  const isCollabDirty = (baseCollabCanon.length !== curCollabCanon.length) || baseCollabCanon.some((c, i) => c !== curCollabCanon[i]);

  // 5. Template
  const curTemplate = document.getElementById('ps-note-template')?.value || 'standard';
  const isTemplateDirty = (curTemplate !== (baseline.templateId || 'standard'));

  const dims = [
    { key: 'title', dirty: isTitleDirty },
    { key: 'schedule', dirty: isScheduleDirty },
    { key: 'tags', dirty: isTagsDirty },
    { key: 'collab', dirty: isCollabDirty },
    { key: 'template', dirty: isTemplateDirty }
  ];

  const defaultScope = document.getElementById('ps-global-scope')?.value || 'coming';

  dims.forEach(dim => {
    const el = document.getElementById(`ps-scope-${dim.key}`);
    if (el) {
      if (dim.dirty) {
        if (el.disabled) {
          el.disabled = false;
          el.value = defaultScope;
        }
        el.style.opacity = '1';
        el.style.cursor = 'pointer';
        el.title = (typeof t === 'function' ? t('planner.dimensionScopeTooltip') : '') || 'Choose how changes to this field propagate across the series';
      } else {
        el.disabled = true;
        el.style.opacity = '0.55';
        el.style.cursor = 'not-allowed';
        el.title = (typeof t === 'function' ? t('planner.scopeDisabledNoChangesTooltip') : '') || 'No changes made to this field';
      }
    }
  });
};

window._handlePlannerSeriesCardDblClick = function(eventId) {
  closePlannerSeriesModal();
  const ev = (typeof plannerEvents !== 'undefined' ? plannerEvents : []).find(e => e.id === eventId);
  if (ev && typeof openPlanEventModal === 'function') {
    openPlanEventModal(ev);
  }
};

window._handlePlannerSeriesNoteClick = function(event, eventId) {
  if (event) event.stopPropagation();
  closePlannerSeriesModal();
  const ev = (typeof plannerEvents !== 'undefined' ? plannerEvents : []).find(e => e.id === eventId);
  if (ev && typeof openNoteForEvent === 'function') {
    openNoteForEvent(ev);
  }
};

window._togglePlannerSeriesSessionSelection = function(selectAll) {
  const checkboxes = document.querySelectorAll('#planner-series-modal .planner-series-session-checkbox');
  checkboxes.forEach(cb => { cb.checked = !!selectAll; });
};

window._applyPlannerSeriesGlobalScope = function(scopeValue) {
  const scopes = ['title', 'schedule', 'tags', 'collab', 'template'];
  scopes.forEach(dim => {
    const el = document.getElementById(`ps-scope-${dim}`);
    if (el) el.value = scopeValue;
  });
};

window._togglePlannerSeriesNoEndDate = function(checked) {
  const untilInput = document.getElementById('ps-until-date');
  if (!untilInput) return;
  if (checked) {
    untilInput.disabled = true;
    untilInput.value = '';
    untilInput.style.opacity = '0.5';
  } else {
    untilInput.disabled = false;
    untilInput.style.opacity = '1';
    if (!untilInput.value) {
      const d = new Date();
      d.setMonth(d.getMonth() + 6);
      untilInput.value = formatLocalDateValue(d);
    }
  }
  if (typeof _updatePlannerSeriesFieldChangeStates === 'function') {
    _updatePlannerSeriesFieldChangeStates();
  }
};

window._setPlannerSeriesEndDatePreset = function(preset) {
  const untilInput = document.getElementById('ps-until-date');
  const noEndCb = document.getElementById('ps-no-end-date');
  if (!untilInput) return;
  if (noEndCb) noEndCb.checked = false;
  untilInput.disabled = false;
  untilInput.style.opacity = '1';

  const d = new Date();
  if (preset === '3m') {
    d.setMonth(d.getMonth() + 3);
  } else if (preset === '6m') {
    d.setMonth(d.getMonth() + 6);
  } else if (preset === '1y') {
    d.setFullYear(d.getFullYear() + 1);
  } else if (preset === 'now') {
    // today
  }
  untilInput.value = formatLocalDateValue(d);
  if (typeof _updatePlannerSeriesFieldChangeStates === 'function') {
    _updatePlannerSeriesFieldChangeStates();
  }
};

window._plannerSeriesSyncEndFromDuration = function() {
  const startEl = document.getElementById('ps-start-time');
  const durEl = document.getElementById('ps-duration');
  const endEl = document.getElementById('ps-end-time');
  const efEl = document.getElementById('ps-end-time-field');
  if (!startEl || !durEl || !endEl) return;
  if (durEl.value === 'custom') {
    if (efEl) efEl.style.display = 'block';
    if (typeof _updatePlannerSeriesFieldChangeStates === 'function') _updatePlannerSeriesFieldChangeStates();
    return;
  }
  if (efEl) efEl.style.display = 'none';
  const startMin = timeToMinutes(startEl.value);
  if (isNaN(startMin)) return;
  const endMin = startMin + parseInt(durEl.value, 10);
  endEl.value = minutesToTime(endMin);
  if (typeof _updatePlannerSeriesFieldChangeStates === 'function') {
    _updatePlannerSeriesFieldChangeStates();
  }
};

window._plannerSeriesSyncDurationFromEnd = function() {
  const startEl = document.getElementById('ps-start-time');
  const durEl = document.getElementById('ps-duration');
  const endEl = document.getElementById('ps-end-time');
  const efEl = document.getElementById('ps-end-time-field');
  if (!startEl || !durEl || !endEl) return;
  const dur = _calcDurationMins(startEl.value, endEl.value);
  const opts = [15, 30, 45, 60, 90, 120, 180];
  const isCustom = !opts.includes(dur);
  durEl.value = isCustom ? 'custom' : String(dur);
  if (efEl) efEl.style.display = isCustom ? 'block' : 'none';
  if (typeof _updatePlannerSeriesFieldChangeStates === 'function') {
    _updatePlannerSeriesFieldChangeStates();
  }
};

window._plannerSeriesSyncDuration = function() {
  const durEl = document.getElementById('ps-duration');
  if (durEl && durEl.value !== 'custom') {
    window._plannerSeriesSyncEndFromDuration();
  } else {
    window._plannerSeriesSyncDurationFromEnd();
  }
  if (typeof _updatePlannerSeriesFieldChangeStates === 'function') {
    _updatePlannerSeriesFieldChangeStates();
  }
};

// Save series modifications from modal
async function savePlannerSeriesFromModal(recurrenceId) {
  if (!recurrenceId) return;

  const seriesEvents = (typeof plannerEvents !== 'undefined' ? plannerEvents : [])
    .filter(e => e.recurrenceId === recurrenceId && e.type !== 'prep');

  if (!seriesEvents.length) {
    closePlannerSeriesModal();
    return;
  }

  seriesEvents.sort((a, b) => {
    const aTime = `${a.date || ''}T${a.startTime || '00:00'}`;
    const bTime = `${b.date || ''}T${b.startTime || '00:00'}`;
    return aTime.localeCompare(bTime);
  });

  const masterEvent = seriesEvents.find(e => e.recurrenceRule) || seriesEvents[0];
  const originalDuration = _calcDurationMins(masterEvent.startTime, masterEvent.endTime);
  const originalStartTime = masterEvent.startTime || '09:00';
  const originalEndTime = masterEvent.endTime || '10:00';
  const originalGroupTags = [...(masterEvent.group_tags || [])];
  const originalMajorTags = [...(masterEvent.major_topic_tags || [])];
  const originalTopicTags = [...(masterEvent.topic_tags || [])];
  const originalCollaboratorIds = [...(masterEvent.collaboratorIds || [])];

  // Read inputs from modal
  const newTitle = document.getElementById('ps-title')?.value?.trim() || masterEvent.title || 'Event';
  const newType = document.getElementById('ps-type')?.value || masterEvent.type || 'work';
  const newStartTime = document.getElementById('ps-start-time')?.value || masterEvent.startTime || '09:00';
  const newEndTime = document.getElementById('ps-end-time')?.value || masterEvent.endTime || '10:00';

  const noEndDate = document.getElementById('ps-no-end-date')?.checked;
  const newUntilDate = noEndDate ? null : (document.getElementById('ps-until-date')?.value || null);
  const newTemplateId = document.getElementById('ps-note-template')?.value || 'standard';

  const newGroupTags = (typeof readTagEditor === 'function' ? readTagEditor('ps-group-tags') : []) || [];
  const newMajorTags = (typeof readTagEditor === 'function' ? readTagEditor('ps-major-tags') : []) || [];
  const newTopicTags = (typeof readTagEditor === 'function' ? readTagEditor('ps-topic-tags') : []) || [];
  const newTags = [...new Set([...newGroupTags, ...newMajorTags, ...newTopicTags])];

  const rawCollabIds = (typeof readCollaboratorMultiPicker === 'function')
    ? readCollaboratorMultiPicker('ps-collaborators-list')
    : [];
  const normalizedCollabIds = (typeof normalizePlannerCollaboratorIds === 'function')
    ? normalizePlannerCollaboratorIds(rawCollabIds, { allowCreate: true })
    : Array.from(new Set(rawCollabIds.map(v => String(v || '').trim()).filter(Boolean)));
  const newCollabs = (typeof getPlannerCollaboratorLabelsByIds === 'function')
    ? getPlannerCollaboratorLabelsByIds(normalizedCollabIds)
    : normalizedCollabIds.map(id => (typeof getColleagueLabelById === 'function' ? getColleagueLabelById(id, id) : id));

  // Determine dirty state relative to baseline / masterEvent
  const isTitleDirty = (newTitle !== masterEvent.title) || (newType !== (masterEvent.type || 'work'));
  const isScheduleDirty = (newStartTime !== originalStartTime) || (newEndTime !== originalEndTime);

  const baseGroupCanon = originalGroupTags.map(t => String(t).trim().toLowerCase()).sort();
  const curGroupCanon = newGroupTags.map(t => String(t).trim().toLowerCase()).sort();
  const baseMajorCanon = originalMajorTags.map(t => String(t).trim().toLowerCase()).sort();
  const curMajorCanon = newMajorTags.map(t => String(t).trim().toLowerCase()).sort();
  const baseTopicCanon = originalTopicTags.map(t => String(t).trim().toLowerCase()).sort();
  const curTopicCanon = newTopicTags.map(t => String(t).trim().toLowerCase()).sort();

  const isTagsDirty = (baseGroupCanon.length !== curGroupCanon.length || baseGroupCanon.some((t, i) => t !== curGroupCanon[i])) ||
    (baseMajorCanon.length !== curMajorCanon.length || baseMajorCanon.some((t, i) => t !== curMajorCanon[i])) ||
    (baseTopicCanon.length !== curTopicCanon.length || baseTopicCanon.some((t, i) => t !== curTopicCanon[i]));

  const baseCollabCanon = originalCollaboratorIds.map(c => String(c).trim().toLowerCase()).sort();
  const curCollabCanon = normalizedCollabIds.map(c => String(c).trim().toLowerCase()).sort();
  const isCollabDirty = (baseCollabCanon.length !== curCollabCanon.length) || baseCollabCanon.some((c, i) => c !== curCollabCanon[i]);

  const isTemplateDirty = (newTemplateId !== (masterEvent.noteTemplateId || 'standard'));

  // Read scopes
  const scopeTitle = document.getElementById('ps-scope-title')?.value || document.getElementById('ps-scope-schedule')?.value || 'all_history';
  const scopeSchedule = document.getElementById('ps-scope-schedule')?.value || 'all_history';
  const scopeTags = document.getElementById('ps-scope-tags')?.value || 'all_history';
  const scopeCollab = document.getElementById('ps-scope-collab')?.value || 'all_history';
  const scopeTemplate = document.getElementById('ps-scope-template')?.value || 'all_history';

  // Read checked sessions in explorer
  const checkedEventIds = new Set(
    Array.from(document.querySelectorAll('#planner-series-modal .planner-series-session-checkbox:checked'))
      .map(cb => cb.getAttribute('data-event-id'))
      .filter(Boolean)
  );

  const todayStr = formatLocalDateValue(new Date());

  // Helper to determine if a session should be updated for a given dimension
  function shouldUpdateSession(ev, scope, isDimensionDrifted) {
    if (scope === 'selection') {
      return checkedEventIds.has(ev.id);
    }
    if (scope === 'coming') {
      return (ev.date || '') >= todayStr;
    }
    if (scope === 'unmodified') {
      return !isDimensionDrifted;
    }
    // 'all_history':
    return true;
  }

  // Read recurrence inputs from modal if present
  let ruleChanged = false;
  let updatedRule = masterEvent.recurrenceRule ? { ...masterEvent.recurrenceRule, until: newUntilDate } : null;
  const recIntervalEl = document.getElementById('ps-recurrence-interval');
  const recUnitEl = document.getElementById('ps-recurrence-unit');
  if (recIntervalEl && recUnitEl) {
    const newInterval = parseInt(recIntervalEl.value || '1', 10) || 1;
    const newUnit = recUnitEl.value || 'week';
    const newWorkdaysOnly = (newUnit === 'day') && !!document.getElementById('ps-recurrence-workdays-only')?.checked;

    let newWeekdays = [];
    if (newUnit === 'week') {
      const activePills = document.querySelectorAll('#ps-recurrence-weekdays button.planner-weekday-pill.active');
      newWeekdays = Array.from(activePills).map(btn => parseInt(btn.getAttribute('data-day'), 10)).filter(n => !isNaN(n));
      newWeekdays.sort((a, b) => a - b);
    }

    let newMonthlyType = 'day_of_month';
    let newMonthlyDay = 1;
    let newMonthlyNth = 1;
    let newMonthlyWeekday = 2;
    if (newUnit === 'month') {
      newMonthlyType = document.getElementById('ps-recurrence-monthly-type')?.value || 'day_of_month';
      newMonthlyDay = parseInt(document.getElementById('ps-recurrence-monthly-day')?.value || '1', 10) || 1;
      newMonthlyNth = parseInt(document.getElementById(newMonthlyType === 'nth_workday' ? 'ps-recurrence-monthly-workday-nth' : 'ps-recurrence-monthly-weekday-nth')?.value || '1', 10);
      newMonthlyWeekday = parseInt(document.getElementById('ps-recurrence-monthly-weekday')?.value || '2', 10);
    }

    const oldRule = masterEvent.recurrenceRule || {};
    const oldWeekdays = Array.isArray(oldRule.weekdays) ? [...oldRule.weekdays].sort((a, b) => a - b) : [];
    ruleChanged = (
      (oldRule.interval || 1) !== newInterval ||
      (oldRule.unit || 'week') !== newUnit ||
      Boolean(oldRule.workdaysOnly) !== Boolean(newWorkdaysOnly) ||
      JSON.stringify(oldWeekdays) !== JSON.stringify(newWeekdays) ||
      (oldRule.monthlyType || 'day_of_month') !== newMonthlyType ||
      (newUnit === 'month' && newMonthlyType === 'day_of_month' && (oldRule.monthlyDay || 1) !== newMonthlyDay) ||
      (newUnit === 'month' && newMonthlyType === 'nth_workday' && (oldRule.monthlyNth || 1) !== newMonthlyNth) ||
      (newUnit === 'month' && newMonthlyType === 'nth_weekday' && ((oldRule.monthlyNth || 1) !== newMonthlyNth || (oldRule.monthlyWeekday !== undefined ? oldRule.monthlyWeekday : -1) !== newMonthlyWeekday))
    );

    updatedRule = {
      interval: newInterval,
      unit: newUnit,
      until: newUntilDate
    };
    if (newUnit === 'day' && newWorkdaysOnly) {
      updatedRule.workdaysOnly = true;
    }
    if (newUnit === 'week' && newWeekdays.length) {
      const mDate = parseLocalDateValue(masterEvent.date);
      const defaultDay = mDate ? mDate.getDay() : 1;
      if (newWeekdays.length > 1 || (newWeekdays.length === 1 && newWeekdays[0] !== defaultDay)) {
        updatedRule.weekdays = newWeekdays;
      }
    }
    if (newUnit === 'month') {
      if (newMonthlyType !== 'day_of_month') {
        updatedRule.monthlyType = newMonthlyType;
      }
      if (newMonthlyType === 'day_of_month') {
        const mDate = parseLocalDateValue(masterEvent.date);
        const defaultDom = mDate ? mDate.getDate() : 1;
        if (newMonthlyDay !== defaultDom) {
          updatedRule.monthlyDay = newMonthlyDay;
        }
      } else if (newMonthlyType === 'nth_workday') {
        updatedRule.monthlyNth = newMonthlyNth;
      } else if (newMonthlyType === 'nth_weekday') {
        updatedRule.monthlyNth = newMonthlyNth;
        updatedRule.monthlyWeekday = newMonthlyWeekday;
      }
    }
  }
  const isMasterPast = (masterEvent.date || '') < todayStr;
  let activeMasterForRecurrence = masterEvent;

  if (scopeSchedule === 'coming' && isScheduleDirty && isMasterPast) {
    // 1. Preserve masterEvent in the past. If it held the recurrence rule, cap its until date to yesterday
    if (masterEvent.recurrenceRule) {
      const yesterday = parseLocalDateValue(todayStr);
      yesterday.setDate(yesterday.getDate() - 1);
      masterEvent.recurrenceRule = {
        ...masterEvent.recurrenceRule,
        until: formatLocalDateValue(yesterday)
      };
    }
    // 2. Establish the upcoming occurrence that becomes the recurrence anchor for future sessions
    const firstUpcoming = seriesEvents.find(e => (e.date || '') >= todayStr);
    if (firstUpcoming) {
      firstUpcoming.recurrenceRule = {
        ...(updatedRule || masterEvent.recurrenceRule || { interval: 1, unit: 'week' }),
        until: newUntilDate,
        startDate: firstUpcoming.date
      };
      activeMasterForRecurrence = firstUpcoming;
    }
  } else if (masterEvent.recurrenceRule) {
    masterEvent.recurrenceRule = updatedRule;
  }

  // Keep track of modified events and notes to synchronize
  let updatedCount = 0;
  const notesToSync = new Set();
  const upcomingEventIds = new Set(
    seriesEvents.filter(e => (e.date || '') >= todayStr).map(e => e.id)
  );

  seriesEvents.forEach(ev => {
    let touched = false;

    // 1. Basic properties (title & type) apply only if title/type was changed
    if (isTitleDirty && shouldUpdateSession(ev, scopeTitle, false)) {
      ev.title = newTitle;
      ev.type = newType;
      touched = true;
    }

    // 2. Schedule & Duration apply only if schedule was changed
    const isDurationDrifted = (_calcDurationMins(ev.startTime, ev.endTime) !== originalDuration);
    const isScheduleDrifted = (ev.startTime !== originalStartTime) || ev.isRescheduled || (ev.originalDate && ev.originalDate !== ev.date);
    if (isScheduleDirty && shouldUpdateSession(ev, scopeSchedule, isScheduleDrifted || isDurationDrifted)) {
      ev.startTime = newStartTime;
      ev.endTime = newEndTime;
      touched = true;
    }

    // 3. Tags apply only if tags were changed
    const baseGroupCanonical = originalGroupTags.map(t => String(t).trim().toLowerCase()).sort();
    const evGroupCanonical = (ev.group_tags || []).map(t => String(t).trim().toLowerCase()).sort();
    const isTagsDrifted = (baseGroupCanonical.length !== evGroupCanonical.length) ||
      baseGroupCanonical.some((t, i) => t !== evGroupCanonical[i]);

    if (isTagsDirty && shouldUpdateSession(ev, scopeTags, isTagsDrifted)) {
      ev.group_tags = [...newGroupTags];
      ev.major_topic_tags = [...newMajorTags];
      ev.topic_tags = [...newTopicTags];
      ev.tags = [...newTags];
      touched = true;
      if (ev.noteId) notesToSync.add(ev);
    }

    // 4. Participants apply only if participants were changed
    const baseCollabCanonical = originalCollaboratorIds.map(c => String(c).trim().toLowerCase()).sort();
    const evCollabCanonical = (ev.collaboratorIds || []).map(c => String(c).trim().toLowerCase()).sort();
    const isCollabDrifted = (baseCollabCanonical.length !== evCollabCanonical.length) ||
      baseCollabCanonical.some((c, i) => c !== evCollabCanonical[i]);

    if (isCollabDirty && shouldUpdateSession(ev, scopeCollab, isCollabDrifted)) {
      ev.collaboratorIds = [...normalizedCollabIds];
      ev.collaborators = [...newCollabs];
      touched = true;
    }

    // 5. Note Template applies only if template was changed
    if (isTemplateDirty && shouldUpdateSession(ev, scopeTemplate, false)) {
      ev.noteTemplateId = newTemplateId;
      touched = true;
    }

    if (touched) updatedCount++;
  });

  // Synchronize linked prep session times for affected calls/syncs
  if (isScheduleDirty) {
    const callStartMins = timeToMinutes(newStartTime);
    const newPrepStart = minutesToTime(Math.max(0, callStartMins - 30));
    const newPrepEnd = newStartTime;
    (plannerEvents || []).forEach(pe => {
      if (pe && pe.type === 'prep' && pe.prepForEventId) {
        if (scopeSchedule === 'coming') {
          if (upcomingEventIds.has(pe.prepForEventId)) {
            pe.startTime = newPrepStart;
            pe.endTime = newPrepEnd;
          }
        } else if (scopeSchedule === 'all_history') {
          if (seriesEvents.some(e => e.id === pe.prepForEventId)) {
            pe.startTime = newPrepStart;
            pe.endTime = newPrepEnd;
          }
        }
      }
    });
  }

  // Prune future occurrences if until date was set and events exist beyond it
  if (newUntilDate) {
    plannerEvents = plannerEvents.filter(e => {
      if (e.recurrenceId !== recurrenceId) return true;
      return (e.date || '') <= newUntilDate;
    });
  }

  // If recurrence rule or schedule changed and schedule scope applies to upcoming/all, prune upcoming non-master occurrences and reschedule
  if ((ruleChanged || isScheduleDirty) && (scopeSchedule === 'all_history' || scopeSchedule === 'coming')) {
    const anchorId = activeMasterForRecurrence.id;
    const removedOccIds = new Set();
    plannerEvents = plannerEvents.filter(e => {
      if (e.recurrenceId !== recurrenceId) return true;
      if (e.id === anchorId) return true;
      if ((e.date || '') < todayStr) return true; // preserve past sessions
      removedOccIds.add(e.id);
      return false;
    });
    if (removedOccIds.size > 0) {
      plannerEvents = plannerEvents.filter(e => !(e.type === 'prep' && removedOccIds.has(e.prepForEventId)));
    }

    if (typeof precreateRecurringEventsForWeek === 'function') {
      const getDaysFn = typeof getPlannerDaysToDisplay === 'function'
        ? getPlannerDaysToDisplay
        : (typeof window !== 'undefined' && typeof window.getPlannerDaysToDisplay === 'function' ? window.getPlannerDaysToDisplay : null);
      const formatFn = typeof formatLocalDateValue === 'function'
        ? formatLocalDateValue
        : (typeof window !== 'undefined' && typeof window.formatLocalDateValue === 'function' ? window.formatLocalDateValue : (d => d.toISOString().slice(0, 10)));
      const parseFn = typeof parseLocalDateValue === 'function'
        ? parseLocalDateValue
        : (typeof window !== 'undefined' && typeof window.parseLocalDateValue === 'function' ? window.parseLocalDateValue : (s => new Date(s)));

      const displayedDays = (getDaysFn ? getDaysFn() : []).map(d => formatFn(d));
      const horizonDays = new Set(displayedDays);
      const baseDate = parseFn(activeMasterForRecurrence.date) || new Date();
      for (let i = 0; i <= 60; i++) {
        const d = new Date(baseDate);
        d.setDate(baseDate.getDate() + i);
        horizonDays.add(formatFn(d));
      }
      precreateRecurringEventsForWeek(Array.from(horizonDays));
    }
  }

  // Synchronize note tags for all affected linked notes
  if (isTagsDirty) {
    notesToSync.forEach(ev => {
      syncPlannerEventTagsToLinkedNote(ev);
    });
  }

  closePlannerSeriesModal();
  await savePlanner();
  if (typeof pruneUnusedAutoCreatedColleagues === 'function') {
    pruneUnusedAutoCreatedColleagues();
  }
  renderPlanner();

  const toastMsg = (t('planner.seriesUpdatedToast') || 'Recurring series updated across {count} session(s)')
    .replace('{count}', updatedCount);
  toast(toastMsg);
}

window.openPlannerSeriesModal = openPlannerSeriesModal;
window.closePlannerSeriesModal = closePlannerSeriesModal;
window.deletePlannerSeries = deletePlannerSeries;
window.savePlannerSeriesFromModal = savePlannerSeriesFromModal;
window.syncPlannerEventTagsToLinkedNote = syncPlannerEventTagsToLinkedNote;
window.shouldEventOccurOnDate = shouldEventOccurOnDate;
window.formatPlannerRecurrenceRuleSummary = formatPlannerRecurrenceRuleSummary;
window._isPlannerWorkday = _isPlannerWorkday;
window._getNthWeekdayOfMonth = _getNthWeekdayOfMonth;
window._updatePlannerSeriesFieldChangeStates = _updatePlannerSeriesFieldChangeStates;
window._getNthWorkdayOfMonth = _getNthWorkdayOfMonth;
window._renderPlannerSvgIcon = _renderPlannerSvgIcon;
window.precreateRecurringEventsForWeek = precreateRecurringEventsForWeek;
window.recordPlannerSeriesMoveException = recordPlannerSeriesMoveException;

function _getPlannerReferencedNoteIds(events = plannerEvents) {
  const ids = new Set();
  (events || []).forEach(ev => {
    const primary = String(ev?.noteId || '').trim();
    if (primary) ids.add(primary);
    const linked = normalizePlannerLinkedNoteIds(Array.isArray(ev?.linkedNoteIds) ? ev.linkedNoteIds : []);
    linked.forEach(id => ids.add(id));
  });
  return ids;
}

async function _deletePlannerNotesById(noteIds = []) {
  const uniqueIds = Array.from(new Set((noteIds || []).map(id => String(id || '').trim()).filter(Boolean)));
  if (!uniqueIds.length) return 0;

  let deletedCount = 0;
  for (const noteId of uniqueIds) {
    const noteMeta = manifest.find(n => String(n?.id || '').trim() === noteId);
    if (!noteMeta?.path) continue;
    try {
      await StorageAPI.deleteNoteContent(noteMeta.path);
      const idx = manifest.findIndex(n => String(n?.id || '').trim() === noteId);
      if (idx >= 0) manifest.splice(idx, 1);
      broadcastSync({ type: 'NOTE_DELETED', noteId, path: noteMeta.path });
      deletedCount += 1;
    } catch (err) {
      console.warn('Planner note delete failed', noteId, err);
    }
  }

  if (deletedCount > 0) {
    await saveManifest({ force: true });
    if (currentNote && uniqueIds.includes(String(currentNote.id || '').trim())) {
      try {
        await closeNoteOverlay();
      } catch (err) {
        console.warn('Failed to close deleted note overlay', err);
      }
    }
  }
  return deletedCount;
}

function showPlannerDeleteConfirmDialog(event, scope = 'only') {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.style.zIndex = '99999';

    const box = document.createElement('div');
    box.className = 'dialog-box';

    const scopeLabel = scope === 'all'
      ? (t('planner.deleteAllInSeries') || 'Delete all in series')
      : scope === 'following'
        ? (t('planner.deleteThisAndFollowing') || 'Delete this and following')
        : (t('planner.deleteOnlyThis') || 'Delete this bloc only');

    const msg = document.createElement('div');
    msg.className = 'dialog-message';
    msg.textContent = scope === 'only'
      ? (t('planner.deleteEventNamed', { title: event?.title || '' }) || `Delete "${event?.title || ''}"?`)
      : `${scopeLabel}: ${event?.title || ''}`;
    box.appendChild(msg);

    const noteId = String(event?.noteId || '').trim();
    const noteMeta = noteId ? manifest.find(n => String(n?.id || '').trim() === noteId) : null;
    let deleteNoteCheckbox = null;
    if (noteMeta) {
      const checkboxWrap = document.createElement('label');
      checkboxWrap.style.cssText = 'display:flex; align-items:flex-start; gap:0.5rem; margin-top:0.55rem; font-size:0.82rem; color:var(--text); cursor:pointer;';

      deleteNoteCheckbox = document.createElement('input');
      deleteNoteCheckbox.type = 'checkbox';
      deleteNoteCheckbox.id = 'planner-delete-note-checkbox';
      deleteNoteCheckbox.style.marginTop = '0.15rem';

      const textWrap = document.createElement('span');
      textWrap.style.display = 'flex';
      textWrap.style.flexDirection = 'column';
      textWrap.style.gap = '2px';

      const mainText = document.createElement('span');
      mainText.textContent = t('planner.deleteBlocNoteCheckbox') || 'Also delete the bloc note from disk';
      const hintText = document.createElement('span');
      hintText.style.cssText = 'font-size:0.74rem; color:var(--text-muted);';
      hintText.textContent = t('planner.deleteBlocNoteHint', { title: noteMeta.title || noteMeta.id || noteId }) || `Note: ${noteMeta.title || noteMeta.id || noteId}`;

      textWrap.appendChild(mainText);
      textWrap.appendChild(hintText);
      checkboxWrap.appendChild(deleteNoteCheckbox);
      checkboxWrap.appendChild(textWrap);
      box.appendChild(checkboxWrap);
    }

    const actions = document.createElement('div');
    actions.className = 'dialog-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn';
    cancelBtn.textContent = t('editor.cancel') || 'Cancel';
    actions.appendChild(cancelBtn);

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'btn btn-danger';
    confirmBtn.textContent = `🗑️ ${t('common.delete') || 'Delete'}`;
    actions.appendChild(confirmBtn);

    box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const cleanup = () => {
      document.removeEventListener('keydown', keyHandler);
      overlay.remove();
    };

    const finish = (confirmed) => {
      const shouldDeleteNote = !!(confirmed && deleteNoteCheckbox && deleteNoteCheckbox.checked);
      cleanup();
      resolve({ confirmed: !!confirmed, deleteBlocNote: shouldDeleteNote });
    };

    const keyHandler = e => {
      if (e.key === 'Escape') finish(false);
      else if (e.key === 'Enter') finish(true);
    };

    cancelBtn.onclick = () => finish(false);
    confirmBtn.onclick = () => finish(true);
    document.addEventListener('keydown', keyHandler);

    overlay.addEventListener('click', e => {
      if (e.target === overlay) finish(false);
    });

    confirmBtn.focus();
  });
}

// Delete planned block — uses custom in-app confirm dialog (native confirm() conflicts with context menu listeners)
async function deletePlannerEvent(eventId) {
  const event = plannerEvents.find(e => e.id === eventId);
  if (!event) return;

  // Close the context menu first to avoid listener conflicts
  closePlannerContextMenu();

  const shouldRemoveLinkedPrep = event.type === 'call' || event.type === 'sync';
  let shouldDeleteBlocNotes = false;

  if (event.recurrenceId) {
    const scope = await showScopePromptDialog(
      t('planner.deleteEvent') || 'Delete Event',
      t('planner.deleteSeriesScope') || 'Which blocs should be deleted?',
      true
    );
    if (!scope) return; // user cancelled

    const confirmResult = await showPlannerDeleteConfirmDialog(event, scope);
    if (!confirmResult?.confirmed) return;
    shouldDeleteBlocNotes = !!confirmResult.deleteBlocNote;

    const recurrenceId = event.recurrenceId;
    if (scope === 'only') {
      plannerEvents = plannerEvents.filter(e => e.id !== eventId && !(shouldRemoveLinkedPrep && e.type === 'prep' && e.prepForEventId === event.id));
      // Mark deleted date as an exception on the parent so it won't be regenerated
      let parent = plannerEvents.find(e => e.recurrenceId === recurrenceId && e.recurrenceRule);
      if (!parent && event.recurrenceRule) {
        const nextOcc = plannerEvents.find(e => e.recurrenceId === recurrenceId && e.type === event.type);
        if (nextOcc) {
          nextOcc.recurrenceRule = JSON.parse(JSON.stringify(event.recurrenceRule));
          if (!nextOcc.recurrenceRule.startDate) nextOcc.recurrenceRule.startDate = event.date;
          if (nextOcc.recurrenceRule.unit === 'week' && (!Array.isArray(nextOcc.recurrenceRule.weekdays) || nextOcc.recurrenceRule.weekdays.length === 0)) {
            const td = parseLocalDateValue(event.date);
            if (td) nextOcc.recurrenceRule.weekdays = [td.getDay()];
          }
          parent = nextOcc;
        }
      }
      if (parent && event.date) {
        parent.recurrenceExceptions = Array.from(new Set([...(parent.recurrenceExceptions || []), event.date]));
      }
    } else if (scope === 'all') {
      const removedMainIds = new Set(
        plannerEvents
          .filter(e => e.recurrenceId === recurrenceId && e.type !== 'prep')
          .map(e => e.id)
      );
      plannerEvents = plannerEvents.filter(e => {
        if (e.recurrenceId !== recurrenceId) return true;
        if (e.type === 'prep') return !removedMainIds.has(e.prepForEventId);
        return !removedMainIds.has(e.id);
      });
    } else if (scope === 'following') {
      const targetDate = event.date;
      const removedIds = new Set(
        plannerEvents
          .filter(e => e.recurrenceId === recurrenceId && e.type !== 'prep' && e.date >= targetDate)
          .map(e => e.id)
      );
      plannerEvents = plannerEvents.filter(e => {
        if (e.recurrenceId === recurrenceId && e.type !== 'prep' && removedIds.has(e.id)) return false;
        if (e.type === 'prep' && removedIds.has(e.prepForEventId)) return false;
        return true;
      });
      // Limit the parent's recurrence rule to stop before targetDate so it won't regenerate removed occurrences
      const parent = plannerEvents.find(e => e.recurrenceId === recurrenceId && e.recurrenceRule);
      if (parent) {
        const limitDate = parseLocalDateValue(targetDate);
        limitDate.setDate(limitDate.getDate() - 1);
        parent.recurrenceRule = { ...parent.recurrenceRule, until: formatLocalDateValue(limitDate) };
      }
    }
  } else {
    const confirmResult = await showPlannerDeleteConfirmDialog(event, 'only');
    if (!confirmResult?.confirmed) return;
    shouldDeleteBlocNotes = !!confirmResult.deleteBlocNote;
    plannerEvents = plannerEvents.filter(e => e.id !== eventId && !(shouldRemoveLinkedPrep && e.type === 'prep' && e.prepForEventId === event.id));
  }

  if (shouldDeleteBlocNotes) {
    const removedPrimaryNoteIds = Array.from(new Set([String(event?.noteId || '').trim()].filter(Boolean)));
    if (removedPrimaryNoteIds.length) {
      const stillReferenced = _getPlannerReferencedNoteIds(plannerEvents);
      const deletableNoteIds = removedPrimaryNoteIds.filter(id => !stillReferenced.has(id));
      await _deletePlannerNotesById(deletableNoteIds);
    }
  }

  if (selectedPlannerEventId === eventId || (selectedPlannerEventId && !plannerEvents.find(e => e.id === selectedPlannerEventId))) {
    selectedPlannerEventId = null;
  }
  await savePlanner();
  if (typeof pruneUnusedAutoCreatedColleagues === 'function') {
    pruneUnusedAutoCreatedColleagues();
  }
  renderPlanner();
  toast(t('planner.blockDeleted'));
}

async function deleteLinkedPrepSession(eventId) {
  const event = plannerEvents.find(e => e.id === eventId);
  if (!event) return;

  const linkedPreps = plannerEvents.filter(e => e.type === 'prep' && e.prepForEventId === event.id);
  if (linkedPreps.length === 0) {
    toast(t('planner.noPrepToRemove') || 'No prep session to remove.', true);
    return;
  }

  closePlannerContextMenu();

  const confirmed = await showConfirmDialog(
    t('planner.deletePrepConfirm', { title: event.title }) || `Delete the prep session for "${event.title}"?`,
    { isDanger: true, confirmLabel: '🗑️ Delete' }
  );
  if (!confirmed) return;

  const linkedIds = new Set(linkedPreps.map(e => e.id));
  plannerEvents = plannerEvents.filter(e => !linkedIds.has(e.id));
  if (linkedIds.has(selectedPlannerEventId)) selectedPlannerEventId = null;
  await savePlanner();
  renderPlanner();
  toast(t('planner.prepDeleted') || 'Prep session deleted');
}

// ── Schedule prep session action ──
function schedulePrepBeforeCall(eventId) {
  const callEv = plannerEvents.find(e => e.id === eventId);
  if (!callEv || (callEv.type !== 'call' && callEv.type !== 'sync')) return;

  const callStartMins = timeToMinutes(callEv.startTime);
  const prepStartMins = callStartMins - 30;

  if (prepStartMins < 0) {
    toast(t('planner.prepBeforeMidnightError'), true);
    return;
  }

  const prepStartTime = minutesToTime(prepStartMins);
  const prepEndTime = callEv.startTime;

  const prepEv = {
    id: 'evt-' + Date.now() + '-prep-' + Math.random().toString(36).slice(2, 6),
    type: 'prep',
    title: `Prep: ${callEv.title}`,
    date: callEv.date,
    startTime: prepStartTime,
    endTime: prepEndTime,
    prepForEventId: callEv.id,
    noteId: callEv.noteId || '',
    linkedNoteIds: getPlannerEventLinkedNoteIds(callEv)
  };

  plannerEvents.push(prepEv);
  savePlanner();
  renderPlanner();
  toast(t('planner.prepScheduled'));
}

// Keep the old name as alias to avoid breaking inspector or other places
function schedulePrepForCall(eventId) {
  schedulePrepBeforeCall(eventId);
}

function schedulePrepAfterCall(eventId) {
  const callEv = plannerEvents.find(e => e.id === eventId);
  if (!callEv || (callEv.type !== 'call' && callEv.type !== 'sync')) return;

  const callEndMins = timeToMinutes(callEv.endTime);
  const prepEndMins = callEndMins + 30;

  if (prepEndMins > 1440) {
    toast(t('planner.prepAfterMidnightError'), true);
    return;
  }

  const prepStartTime = callEv.endTime;
  const prepEndTime = minutesToTime(prepEndMins);

  const prepEv = {
    id: 'evt-' + Date.now() + '-prep-' + Math.random().toString(36).slice(2, 6),
    type: 'prep',
    title: `Prep: ${callEv.title}`,
    date: callEv.date,
    startTime: prepStartTime,
    endTime: prepEndTime,
    prepForEventId: callEv.id,
    noteId: callEv.noteId || '',
    linkedNoteIds: getPlannerEventLinkedNoteIds(callEv)
  };

  plannerEvents.push(prepEv);
  savePlanner();
  renderPlanner();
  toast(t('planner.prepFollowupScheduled'));
}



// ── Todo Note link and creation in inspector ──
async function createNoteForPlannerTodo(todoId) {
  const todo = getTodoById(todoId);
  if (!todo) return;

  const closeProgress = showPlannerNoteGenerationProgress(
    t('planner.preparingTemplate') || 'Preparing template and formatting content...'
  );
  closeProgress.updateStage?.(t('planner.preparingTemplate') || 'Preparing template and formatting content...', '', 15);
  await new Promise(r => setTimeout(r, 16));

  const noteId = generateNoteId();
  const notePath = getCanonicalNotePath(noteId);
  const noteTitle = todo.title || 'Todo Note';

  const markdown = `# Todo Details\n\n- Todo ID: ${todo.id}\n- Priority: ${todo.priority}\n- Status: ${todo.status}\n\n# Tasks / Checklist\n\n- `;
  const mainHTML = mdToPreviewHTML(markdown);

  closeProgress.updateStage?.(t('planner.writingNoteContent') || 'Encrypting and saving note content...', '', 45);
  await new Promise(r => setTimeout(r, 16));

  const note = {
    id: noteId,
    path: notePath,
    title: noteTitle,
    date: new Date().toISOString().slice(0, 10),
    group_tags: ['Todos'], // Default group tags
    major_topic_tags: [],
    topic_tags: [],
    extra_tags: [],
    mainHTML
  };

  try {
    await StorageAPI.writeNoteContent(notePath, buildNewNoteHTML(note));
    upsertManifest(note);

    closeProgress.updateStage?.(t('planner.linkingToPlanner') || 'Linking note to planner and updating indexes...', '', 75);
    await new Promise(r => setTimeout(r, 16));

    // Link todo to note
    todo.noteId = noteId;
    // Save todos manifest
    await saveTodosManifest();

    // Link event to note too if the planner event was selected and matches
    if (selectedPlannerEventId) {
      const event = plannerEvents.find(e => e.id === selectedPlannerEventId);
      if (event && event.todoId === todoId) {
        event.noteId = noteId;
        event.linkedNoteIds = normalizePlannerLinkedNoteIds([noteId], noteId);
        if (event.type === 'call' || event.type === 'sync') {
          plannerEvents.forEach(pe => {
            if (pe.type === 'prep' && pe.prepForEventId === event.id) {
              pe.noteId = noteId;
              pe.linkedNoteIds = normalizePlannerLinkedNoteIds([noteId], noteId);
            }
          });
        }
        savePlanner();
      }
    }

    await saveManifest({ force: true });
    await rebuildIndexHTML();
    renderFilterChips();
    broadcastSync({ type: 'NOTE_SAVED', noteId, path: notePath, modified: new Date().toISOString() });

    closeProgress.updateStage?.(t('planner.openingNoteEditor') || 'Opening note editor...', '', 95);
    await new Promise(r => setTimeout(r, 16));

    toast(t('planner.noteCreatedLinkedTodo'));
    renderPlannerInspector();
    renderPlanner();
  } catch (e) {
    console.error('Failed to create note for todo:', e);
    toast(t('planner.createNoteFailed', { message: e.message }) || ('Failed to create note: ' + e.message), true);
  } finally {
    closeProgress();
  }
}

async function associateNoteWithPlannerTodo(todoId, noteId) {
  if (!noteId) {
    toast(t('planner.selectNoteToAssociate'), true);
    return;
  }
  const todo = getTodoById(todoId);
  if (!todo) return;

  todo.noteId = noteId;

  try {
    await saveTodosManifest();

    // Link event to note too if the planner event was selected and matches
    if (selectedPlannerEventId) {
      const event = plannerEvents.find(e => e.id === selectedPlannerEventId);
      if (event && event.todoId === todoId) {
        event.noteId = noteId;
        event.linkedNoteIds = normalizePlannerLinkedNoteIds([noteId], noteId);
        if (event.type === 'call' || event.type === 'sync') {
          plannerEvents.forEach(pe => {
            if (pe.type === 'prep' && pe.prepForEventId === event.id) {
              pe.noteId = noteId;
              pe.linkedNoteIds = normalizePlannerLinkedNoteIds([noteId], noteId);
            }
          });
        }
        savePlanner();
      }
    }

    toast(t('planner.noteLinkedTodo'));
    renderPlannerInspector();
    renderPlanner();
  } catch (e) {
    console.error('Failed to associate note with todo:', e);
    toast(t('planner.linkNoteFailed', { message: e.message }), true);
  }
}


// Find all planner events linked to a note by noteId
function getPlannerEventsForNote(noteId) {
  if (!noteId || !plannerEvents) return [];
  const events = plannerEvents.filter(e => {
    if (!e) return false;
    if (e.noteId === noteId) return true;
    return getPlannerEventLinkedNoteIds(e).includes(noteId);
  });
  if (events.length === 0) return [];

  const note = getNoteById(noteId);
  const noteDate = note?.date || '';
  const byRecurrence = new Map();
  const selected = [];

  const toDateObj = (dateStr) => {
    const d = parseLocalDateValue(dateStr || '');
    return Number.isNaN(d?.getTime?.()) ? null : d;
  };

  const getWeekStartKey = (dateStr) => {
    const d = toDateObj(dateStr);
    if (!d) return '';
    const day = d.getDay();
    const diff = day === 0 ? -6 : (1 - day);
    d.setDate(d.getDate() + diff);
    return formatLocalDateValue(d);
  };

  const pickPrimaryRecurringEvent = (groupEvents) => {
    const mains = (groupEvents || [])
      .filter(e => e && e.type !== 'prep')
      .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.startTime || '').localeCompare(b.startTime || ''));
    if (mains.length === 0) {
      return (groupEvents || [])[0] || null;
    }

    if (!noteDate) return mains[0];

    const sameDay = mains.find(e => e.date === noteDate);
    if (sameDay) return sameDay;

    const noteWeekKey = getWeekStartKey(noteDate);
    if (noteWeekKey) {
      const sameWeek = mains.find(e => getWeekStartKey(e.date) === noteWeekKey);
      if (sameWeek) return sameWeek;
    }

    const noteDateObj = toDateObj(noteDate);
    if (!noteDateObj) return mains[0];

    const nearest = mains.slice().sort((a, b) => {
      const aObj = toDateObj(a.date);
      const bObj = toDateObj(b.date);
      const aDiff = aObj ? Math.abs(aObj.getTime() - noteDateObj.getTime()) : Number.POSITIVE_INFINITY;
      const bDiff = bObj ? Math.abs(bObj.getTime() - noteDateObj.getTime()) : Number.POSITIVE_INFINITY;
      if (aDiff !== bDiff) return aDiff - bDiff;
      return (a.startTime || '').localeCompare(b.startTime || '');
    })[0];

    return nearest || mains[0];
  };

  events.forEach(ev => {
    if (!ev) return;
    if (!ev.recurrenceId) {
      selected.push(ev);
      return;
    }
    if (!byRecurrence.has(ev.recurrenceId)) byRecurrence.set(ev.recurrenceId, []);
    byRecurrence.get(ev.recurrenceId).push(ev);
  });

  byRecurrence.forEach(group => {
    const primary = pickPrimaryRecurringEvent(group);
    if (!primary) return;
    selected.push(primary);

    const prepEvents = group.filter(e => e && e.type === 'prep' && e.prepForEventId === primary.id);
    selected.push(...prepEvents);
  });

  const deduped = [];
  const seen = new Set();
  selected.forEach(ev => {
    if (!ev || seen.has(ev.id)) return;
    seen.add(ev.id);
    deduped.push(ev);
  });

  // Filter out prep events whose parent event is also linked to the same note
  const eventIds = new Set(deduped.map(e => e.id));
  return deduped.filter(e => {
    if (e.type === 'prep' && e.prepForEventId && eventIds.has(e.prepForEventId)) {
      return false;
    }
    return true;
  });
}

function _plannerInspectorAssocRowHtml({ title, subtitle = '', onClick = '', onDblClick = '', onRemove = '', removeTitle = '', dummy = false, selected = false, rowTitle = '' }) {
  const classes = ['planner-assoc-row'];
  if (dummy) classes.push('dummy');
  if (selected) classes.push('selected');
  const subtitleHtml = subtitle ? `<div class="planner-assoc-row-subtitle">${escH(subtitle)}</div>` : '';
  const removeHtml = onRemove ? `<button type="button" class="planner-assoc-row-remove" title="${escA(removeTitle || (t('editor.cancel') || 'Remove'))}" onclick="event.stopPropagation(); ${onRemove}">×</button>` : '';
  const clickAttr = onClick ? `onclick="${onClick}"` : '';
  const dblClickAction = onDblClick || onClick;
  const dblClickAttr = dblClickAction ? `ondblclick="event.stopPropagation(); ${dblClickAction}"` : '';
  const titleAttr = rowTitle ? `title="${escA(rowTitle)}"` : '';
  return `
    <div class="${classes.join(' ')}" ${clickAttr} ${dblClickAttr} ${titleAttr}>
      <div class="planner-assoc-row-main">
        <div class="planner-assoc-row-title">${escH(title)}</div>
        ${subtitleHtml}
      </div>
      ${removeHtml}
    </div>
  `;
}

function _plannerNoteSubtitle(note, currentEvent = null) {
  const parts = [];
  if (note?.date) parts.push(note.date);
  const linkedEvents = getPlannerEventsForNote(note?.id || '');
  const eventLabel = linkedEvents.find(ev => !currentEvent || ev.id !== currentEvent.id) || linkedEvents[0];
  if (eventLabel) {
    parts.push(`${t('planner.blockLabel') || 'Bloc'}: ${eventLabel.title || eventLabel.id || ''}`.trim());
  }
  return parts.filter(Boolean).join(' · ');
}

function _plannerTodoSubtitle(todo) {
  const parts = [];
  if (todo?.priority) parts.push(todo.priority);
  if (todo?.status) parts.push(todo.status);
  return parts.filter(Boolean).join(' · ');
}

async function removePlannerInspectorNoteAssociation(eventId, noteId) {
  const event = plannerEvents.find(e => e.id === eventId);
  const targetNoteId = String(noteId || '').trim();
  if (!event || !targetNoteId) return;

  if (String(event.noteId || '').trim() === targetNoteId) {
    event.noteId = '';
  }
  event.linkedNoteIds = normalizePlannerLinkedNoteIds((event.linkedNoteIds || []).filter(id => String(id || '').trim() !== targetNoteId), event.noteId || '');

  if (event.type === 'call' || event.type === 'sync') {
    (plannerEvents || []).forEach(pe => {
      if (pe.type === 'prep' && pe.prepForEventId === event.id) {
        pe.linkedNoteIds = normalizePlannerLinkedNoteIds((pe.linkedNoteIds || []).filter(id => String(id || '').trim() !== targetNoteId), pe.noteId || '');
      }
    });
  }

  await savePlanner();
  renderPlanner();
  renderPlannerInspector();
}

async function removePlannerInspectorTodoAssociation(eventId, todoId) {
  const event = plannerEvents.find(e => e.id === eventId);
  const targetTodoId = String(todoId || '').trim();
  if (!event || !targetTodoId) return;

  if (String(event.todoId || '').trim() === targetTodoId) {
    event.todoId = '';
  }
  event.linkedTodoIds = normalizePlannerLinkedTodoIds((event.linkedTodoIds || []).filter(id => String(id || '').trim() !== targetTodoId), event.todoId || '');

  await savePlanner();
  renderPlanner();
  renderPlannerInspector();
}

async function removePlannerInspectorPrepAssociation(eventId, prepId) {
  const event = plannerEvents.find(e => e.id === eventId);
  const targetPrepId = String(prepId || '').trim();
  if (!event || !targetPrepId) return;
  const prep = plannerEvents.find(e => e.id === targetPrepId && e.type === 'prep' && e.prepForEventId === event.id);
  if (!prep) return;
  await deletePlannerEvent(targetPrepId);
  renderPlannerInspector();
}

function _plannerInspectorEventSortDate(a, b) {
  const aDate = String(a?.date || '').trim();
  const bDate = String(b?.date || '').trim();
  const dateCmp = bDate.localeCompare(aDate);
  if (dateCmp !== 0) return dateCmp;
  const aTime = String(a?.startTime || '').trim();
  const bTime = String(b?.startTime || '').trim();
  const timeCmp = aTime.localeCompare(bTime);
  if (timeCmp !== 0) return timeCmp;
  return String(a?.title || '').localeCompare(String(b?.title || ''));
}

function _plannerInspectorTodoSort(a, b) {
  const priorityOrder = { High: 0, WIP: 1, Medium: 2, Low: 3 };
  const aPrio = priorityOrder[String(a?.priority || 'Medium')] ?? 9;
  const bPrio = priorityOrder[String(b?.priority || 'Medium')] ?? 9;
  if (aPrio !== bPrio) return aPrio - bPrio;
  return String(a?.title || a?.id || '').localeCompare(String(b?.title || b?.id || ''));
}

// ── Context Menus and Right-Clicks ──

function closePlannerContextMenu() {
  if (plannerContextMenuHandlers?.close) document.removeEventListener('click', plannerContextMenuHandlers.close);
  if (plannerContextMenuHandlers?.esc) document.removeEventListener('keydown', plannerContextMenuHandlers.esc);
  plannerContextMenuHandlers = null;
  if (plannerContextMenu) {
    plannerContextMenu.remove();
    plannerContextMenu = null;
  }
}

function _placePlannerContextMenu(menu, e) {
  const viewport = window.visualViewport;
  const viewportLeft = viewport?.offsetLeft || 0;
  const viewportTop = viewport?.offsetTop || 0;
  const viewportWidth = Math.max(0, viewport?.width || window.innerWidth || document.documentElement.clientWidth || 0);
  const viewportHeight = Math.max(0, viewport?.height || window.innerHeight || document.documentElement.clientHeight || 0);
  const margin = 8;
  const anchorX = typeof e?.clientX === 'number'
    ? e.clientX
    : (typeof e?.pageX === 'number' ? e.pageX - window.scrollX : margin);
  const anchorY = typeof e?.clientY === 'number'
    ? e.clientY
    : (typeof e?.pageY === 'number' ? e.pageY - window.scrollY : margin);

  menu.style.position = 'fixed';
  menu.style.left = '0px';
  menu.style.top = '0px';
  menu.style.visibility = 'hidden';
  menu.style.maxWidth = `calc(100vw - ${margin * 2}px)`;
  menu.style.maxHeight = `calc(100vh - ${margin * 2}px)`;
  menu.style.overflowY = 'auto';
  document.body.appendChild(menu);

  const rect = menu.getBoundingClientRect();
  const availableRight = viewportLeft + viewportWidth - margin;
  const availableBottom = viewportTop + viewportHeight - margin;

  let left = anchorX + viewportLeft;
  let top = anchorY + viewportTop;

  if (left + rect.width > availableRight) {
    left = Math.max(viewportLeft + margin, availableRight - rect.width);
  }
  if (top + rect.height > availableBottom) {
    top = Math.max(viewportTop + margin, anchorY + viewportTop - rect.height);
  }

  left = Math.min(Math.max(left, viewportLeft + margin), Math.max(viewportLeft + margin, availableRight - rect.width));
  top = Math.min(Math.max(top, viewportTop + margin), Math.max(viewportTop + margin, availableBottom - rect.height));

  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
  menu.style.visibility = 'visible';
  menu.style.transformOrigin = top > anchorY + viewportTop ? 'bottom left' : 'top left';
}

// Right click on a planned event card
function showPlannerEventContextMenu(e, eventId) {
  e.preventDefault();
  e.stopPropagation();
  const event = plannerEvents.find(evt => evt.id === eventId);
  if (!event) return false;

  // Capture click position relative to day column so we can create an overlapping event
  const _ctxDayCol = e?.target?.closest ? e.target.closest('.planner-day-col') : null;
  const _ctxClientY = e?.clientY ?? 0;

  closePlannerContextMenu();

  const menu = document.createElement('div');
  menu.className = 'planner-ctx-menu';

  const makeBtn = (text, fn, extraCls = '', title = '', shortcut = '') => {
    const btn = document.createElement('button');
    btn.className = `planner-ctx-btn${extraCls ? ' ' + extraCls : ''}`;
    let html = text;
    if (shortcut) {
      html += `<span class="planner-ctx-shortcut">${shortcut}</span>`;
    }
    btn.innerHTML = html;
    if (title) btn.title = title;
    btn.addEventListener('click', async ev => {
      ev.stopPropagation();
      try { await fn(); } catch (err) { console.warn(err); }
      closePlannerContextMenu();
    });
    return btn;
  };

  // Section 0: Video Call Quick Join (if URL detected)
  const videoUrl = detectVideoCallUrl(event);
  if (videoUrl) {
    menu.appendChild(makeBtn(`🎥 <span class="planner-ctx-text">${escH(t('planner.joinVideoCall') || 'Join Video Call')}</span>`, () => {
      window.open(videoUrl, '_blank');
    }, 'planner-ctx-video-btn', t('planner.openVideoConferenceTooltip') || 'Open video conference link in a new window'));
  }

  // Section 1: Note actions (first)
  if (plannerEventSupportsNoteAction(event)) {
    const noteActionLabel = getPlannerEventNoteActionLabel(event);
    const effectiveNoteId = getPlannerEventEffectiveNoteId(event);
    menu.appendChild(makeBtn(`
      ${effectiveNoteId ? '📝' : '✨'} <span class="planner-ctx-text">${escH(noteActionLabel)}</span>
    `, () => openNoteForEvent(event), '', noteActionLabel));
  }
  if (event.type === 'todo' && event.todoId) {
    menu.appendChild(makeBtn(btnLabel('📋', 'planner.openTodo', 'Open Todo'), () => openTodoOverlay(event.todoId), '', t('planner.openTodoTooltip')));
  }

  // Section 2: Quick Duration Selector Row
  const durTitle = document.createElement('div');
  durTitle.className = 'planner-ctx-group-title';
  durTitle.textContent = t('planner.setDuration') || 'Set Duration';
  menu.appendChild(durTitle);

  const durRow = document.createElement('div');
  durRow.className = 'planner-ctx-pill-row';
  [15, 30, 45, 60, 120].forEach(mins => {
    const pBtn = document.createElement('button');
    pBtn.className = 'planner-ctx-pill-btn';
    pBtn.textContent = `${mins}m`;
    pBtn.addEventListener('click', ev => {
      ev.stopPropagation();
      setPlannerEventDuration(eventId, mins);
      closePlannerContextMenu();
    });
    durRow.appendChild(pBtn);
  });
  menu.appendChild(durRow);

  // Section 3: Plan Section Before / After
  if (event.type === 'call' || event.type === 'sync') {
    const startMins = timeToMinutes(event.startTime);
    const prepStart = minutesToTime(Math.max(0, startMins - 30));
    const hasPrepBefore = plannerEvents.some(e => e.type === 'prep' && e.prepForEventId === event.id && timeToMinutes(e.startTime) < timeToMinutes(event.startTime));
    if (!hasPrepBefore) {
      const prepBeforeLabel = `⏱️ Plan Prep (${prepStart} - ${event.startTime})`;
      menu.appendChild(makeBtn(prepBeforeLabel, () => schedulePrepBeforeCall(eventId), '', t('planner.schedulePrepBeforeTooltip')));
    }
    const hasPrepAfter = plannerEvents.some(e => e.type === 'prep' && e.prepForEventId === event.id && timeToMinutes(e.startTime) >= timeToMinutes(event.endTime));
    if (!hasPrepAfter) {
      menu.appendChild(makeBtn(btnLabel('⏱️', 'planner.schedulePrepAfter', 'Plan Prep After'), () => schedulePrepAfterCall(eventId), '', t('planner.schedulePrepAfterTooltip')));
    }
    if (hasPrepBefore || hasPrepAfter) {
      menu.appendChild(makeBtn(btnLabel('🗑️', 'planner.removePreparationSession', 'Remove Prep Session'), () => deleteLinkedPrepSession(eventId), 'danger', t('planner.removePrepTooltip') || 'Remove the linked prep session'));
    }
  }

  // Section 4: Continue Work
  if (event.type !== 'ooo') {
    menu.appendChild(makeBtn(btnLabel('➕', 'planner.continueWork', 'Continue work'), () => openContinueWorkModal(eventId)));
  }

  // Separator
  const sepCopy = document.createElement('div');
  sepCopy.style.cssText = 'height:1px;background:var(--card-border);margin:2px 6px;';
  menu.appendChild(sepCopy);

  // Section 5: Copy, Clone, Paste
  menu.appendChild(makeBtn(btnLabel('📋', 'planner.copyEvent', 'Copy Event'), () => {
    _plannerClipboard = JSON.parse(JSON.stringify(event));
    toast(t('planner.eventCopied'));
  }, '', t('planner.copyEventTooltip'), '⌘C'));

  menu.appendChild(makeBtn(btnLabel('🔁', 'planner.cloneEvent', 'Clone Event'), () => _startPlannerClone(event), '', t('planner.cloneEventTooltip')));

  if (_plannerClipboard) {
    const pasteLabel = escH((t('planner.pasteEventHere') || 'Paste "{title}" here').replace('{title}', _plannerClipboard.title || 'Event'));
    menu.appendChild(makeBtn(`📋 <span class="planner-ctx-text">${pasteLabel}</span>`, () => _pastePlannerEvent(event.date, event.endTime), '', '', '⌘V'));
  }

  // Separator
  const sepMgmt = document.createElement('div');
  sepMgmt.style.cssText = 'height:1px;background:var(--card-border);margin:2px 6px;';
  menu.appendChild(sepMgmt);

  // Section 6: Modify and Delete
  menu.appendChild(makeBtn(btnLabel('✏️', 'planner.modifyBlock', 'Modify Block'), () => editPlannerEvent(eventId), '', t('planner.editBlockTooltip') || '', '↵'));
  let seriesRecId = event?.recurrenceId;
  if (!seriesRecId && event?.recurrenceRule) {
    event.recurrenceId = 'rec-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    seriesRecId = event.recurrenceId;
    if (typeof savePlanner === 'function') savePlanner();
  }
  if (!seriesRecId) {
    const candidateParent = (plannerEvents || []).find(p => p && p.id !== event.id && p.recurrenceRule && (
      (p.type === event.type && p.title === event.title && typeof shouldEventOccurOnDate === 'function' && shouldEventOccurOnDate(p, event.date)) ||
      (event.type === 'prep' && event.prepForEventId === p.id) ||
      (p.recurrenceId && event.type === 'prep' && (plannerEvents || []).some(occ => occ.recurrenceId === p.recurrenceId && occ.id === event.prepForEventId))
    ));
    if (candidateParent) {
      if (!candidateParent.recurrenceId) {
        candidateParent.recurrenceId = 'rec-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      }
      event.recurrenceId = candidateParent.recurrenceId;
      seriesRecId = event.recurrenceId;
      if (typeof savePlanner === 'function') savePlanner();
    }
  }
  if (seriesRecId) {
    menu.appendChild(makeBtn(btnLabel('🔁', 'planner.editSeries', 'Edit Series...'), () => openPlannerSeriesModal(seriesRecId, eventId), '', t('planner.editSeriesTooltip') || 'Edit entire recurring series'));
  } else if (event.type !== 'ooo') {
    menu.appendChild(makeBtn(btnLabel('🔁', 'planner.repeatEvent', 'Repeat Event...'), () => {
      openPlanEventModal(event, true);
      setTimeout(() => {
        openPlannerRecurrenceOverlay();
      }, 50);
    }, '', t('planner.recurrenceTooltip') || 'Toggle the repeat settings for this calendar event'));
  }
  menu.appendChild(makeBtn(btnLabel('🗑️', 'planner.deleteBlock', 'Delete Block'), () => {
    pushPlannerUndoState('Delete event');
    deletePlannerEvent(eventId);
  }, 'danger', '', '⌫'));

  plannerContextMenu = menu;
  _placePlannerContextMenu(menu, e);

  // Keyboard arrow navigation inside context menu
  const ctxButtons = Array.from(menu.querySelectorAll('.planner-ctx-btn, .planner-ctx-pill-btn'));
  let activeIndex = 0;
  if (ctxButtons[0]) ctxButtons[0].focus();

  const handleKeyNav = ev => {
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      activeIndex = (activeIndex + 1) % ctxButtons.length;
      ctxButtons[activeIndex]?.focus();
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      activeIndex = (activeIndex - 1 + ctxButtons.length) % ctxButtons.length;
      ctxButtons[activeIndex]?.focus();
    } else if (ev.key === 'Escape') {
      closePlannerContextMenu();
    }
  };

  const closeOnOutsideClick = ev => {
    if (!menu.contains(ev.target)) closePlannerContextMenu();
  };
  plannerContextMenuHandlers = { close: closeOnOutsideClick, esc: handleKeyNav };

  setTimeout(() => {
    if (plannerContextMenu === menu) document.addEventListener('click', closeOnOutsideClick);
  }, 0);
  document.addEventListener('keydown', handleKeyNav);
  return false;
}

// Right click on an empty slot in the grid
function showPlannerEmptyContextMenu(e, dateStr, startTime, endTime) {
  e.preventDefault();
  e.stopPropagation();

  closePlannerContextMenu();

  const menu = document.createElement('div');
  menu.className = 'planner-ctx-menu';

  const makeNewBtn = (text, type, withRecurrence = false, tooltipText = '') => {
    const btn = document.createElement('button');
    btn.className = 'planner-ctx-btn';
    btn.innerHTML = text;
    const defTooltip = withRecurrence
      ? (t('planner.recurrenceTooltip') || 'Toggle the repeat settings for this calendar event')
      : (t(`planner.plan${type.charAt(0).toUpperCase() + type.slice(1)}Tooltip`) || t(`planner.plan${type.charAt(0).toUpperCase() + type.slice(1)}`) || 'Plan new event');
    btn.title = tooltipText || defTooltip;
    btn.addEventListener('click', ev => {
      ev.stopPropagation();
      closePlannerContextMenu();
      openPlanEventModal({
        type: type,
        title: '',
        date: dateStr,
        startTime: startTime,
        endTime: endTime
      });
      if (withRecurrence) {
        setTimeout(() => {
          openPlannerRecurrenceOverlay();
        }, 50);
      }
    });
    return btn;
  };

  // Helper to build label with icon and translation, avoid duplicated emoji
  const newBtnLabel = (icon, key, fallback) => {
    const raw = (key ? (t(key) || fallback) : fallback) || '';
    let txt = raw.toString().trim();
    if (txt.startsWith(icon)) txt = txt.slice(icon.length).trim();
    return `${icon} <span class="planner-ctx-text">${escH(txt)}</span>`;
  };

  menu.appendChild(makeNewBtn(newBtnLabel('📞', 'planner.planCall', 'Plan Call'), 'call'));
  menu.appendChild(makeNewBtn(newBtnLabel('✏️', 'planner.planPrep', 'Plan Prep'), 'prep'));
  menu.appendChild(makeNewBtn(newBtnLabel('📋', 'planner.planTodo', 'Plan Todo'), 'todo'));
  menu.appendChild(makeNewBtn(newBtnLabel('💻', 'planner.planWork', 'Plan Work'), 'work'));
  menu.appendChild(makeNewBtn(newBtnLabel('🏖️', 'planner.markOoo', 'Mark OOO'), 'ooo'));
  menu.appendChild(makeNewBtn(newBtnLabel('⚙️', 'planner.planCustom', 'Custom'), 'custom'));
  menu.appendChild(makeNewBtn(newBtnLabel('🔁', 'planner.recurrence', 'Recurrence'), 'call', true, t('planner.recurrenceTooltip') || 'Toggle the repeat settings for this calendar event'));

  // Paste option (only when something is copied)
  if (_plannerClipboard) {
    const sep = document.createElement('div');
    sep.style.cssText = 'height:1px;background:var(--card-border);margin:2px 6px;';
    menu.appendChild(sep);
    const btn = document.createElement('button');
    btn.className = 'planner-ctx-btn';
    const pasteLabel = escH((t('planner.pasteEventHere') || 'Paste "{title}" here').replace('{title}', _plannerClipboard.title || 'Event'));
    btn.innerHTML = `📋 <span class="planner-ctx-text">${pasteLabel}</span>`;
    btn.addEventListener('click', async ev => {
      ev.stopPropagation();
      closePlannerContextMenu();
      await _pastePlannerEvent(dateStr, startTime);
    });
    menu.appendChild(btn);
  }

  const sepCancel = document.createElement('div');
  sepCancel.style.cssText = 'height:1px;background:var(--card-border);margin:2px 6px;';
  menu.appendChild(sepCancel);
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'planner-ctx-btn';
  cancelBtn.textContent = t('editor.cancel') || 'Cancel';
  cancelBtn.addEventListener('click', ev => {
    ev.stopPropagation();
    closePlannerContextMenu();
  });
  menu.appendChild(cancelBtn);

  plannerContextMenu = menu;
  _placePlannerContextMenu(menu, e);

  const closeOnOutsideClick = ev => {
    if (!menu.contains(ev.target)) closePlannerContextMenu();
  };
  const closeOnEsc = ev => {
    if (ev.key === 'Escape') closePlannerContextMenu();
  };
  plannerContextMenuHandlers = { close: closeOnOutsideClick, esc: closeOnEsc };

  setTimeout(() => {
    if (plannerContextMenu === menu) document.addEventListener('click', closeOnOutsideClick);
  }, 0);
  document.addEventListener('keydown', closeOnEsc);
  return false;
}

// ── Paste a copied event at given date/startTime ──
async function _pastePlannerEvent(dateStr, startTime) {
  if (!_plannerClipboard) return;
  const src = _plannerClipboard;
  const srcDuration = timeToMinutes(src.endTime) - timeToMinutes(src.startTime);
  const startMin = timeToMinutes(startTime);
  const endMin = startMin + Math.max(15, srcDuration);
  const endTime = minutesToTime(endMin);

  const newEvent = {
    ...JSON.parse(JSON.stringify(src)),
    id: 'evt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    date: dateStr,
    startTime,
    endTime,
    noteId: ''
  };

  // For todo events, attach an additional scheduled time reference on the todo
  if (newEvent.type === 'todo' && newEvent.todoId) {
    // Keep the todoId link — the todo is now scheduled at a second time slot
    // (both original and paste will reference the same todo)
  }

  plannerEvents.push(newEvent);
  savePlanner();
  renderPlanner();
  toast(t('planner.eventPasted'));
}

// ── Clone: attach ghost to mouse, place on left-click ──
function _startPlannerClone(sourceEvent) {
  if (_plannerCloneState) _cancelPlannerClone();

  const durationMins = timeToMinutes(sourceEvent.endTime) - timeToMinutes(sourceEvent.startTime);
  const heightPx = durationMins * (80 / 60);

  const isGhostShort = durationMins <= 15;
  // Build ghost element
  const ghost = document.createElement('div');
  ghost.className = `planner-event-card event-${sourceEvent.type} planner-clone-ghost${isGhostShort ? ' short-event' : ''}`;
  ghost.style.cssText = `
    position: fixed;
    width: 140px;
    height: ${heightPx}px;
    opacity: 0.85;
    pointer-events: none;
    z-index: 9999;
    border: 2px dashed currentColor;
    transform: rotate(-2deg);
    transition: none;
  `;
  ghost.innerHTML = `
    <div class="planner-event-main-col">
      <div class="planner-event-title">${escH(sourceEvent.title)}</div>
    </div>
    <div class="planner-event-time-col">
      <span class="planner-event-time-start">${sourceEvent.startTime}</span>
      <span class="planner-event-time-end">${sourceEvent.endTime}</span>
    </div>
  `;
  document.body.appendChild(ghost);

  _plannerCloneState = { sourceEvent, ghostEl: ghost, durationMins };

  document.addEventListener('mousemove', _plannerCloneMouseMove);
  document.addEventListener('keydown', _plannerCloneKeyDown);
  document.body.classList.add('planner-cloning');

  // Delay attaching the click listener by two frames so the current context-menu
  // click event doesn't immediately fire the clone placement handler.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (_plannerCloneState) {
      document.addEventListener('click', _plannerCloneMouseClick);
    }
  }));

  toast(t('planner.cloneHint'), false);
}

function _plannerCloneMouseMove(e) {
  if (!_plannerCloneState) return;
  const g = _plannerCloneState.ghostEl;
  g.style.left = (e.clientX + 8) + 'px';
  g.style.top = (e.clientY - 20) + 'px';
}

async function _plannerCloneMouseClick(e) {
  if (!_plannerCloneState) return;

  // Find if we clicked inside a day column
  const col = e.target.closest('.planner-day-col');
  if (!col) {
    // Clicking outside the grid cancels
    _cancelPlannerClone();
    return;
  }

  e.preventDefault();
  e.stopPropagation();

  const { sourceEvent, durationMins, offsetY = 0 } = _plannerCloneState;
  _cancelPlannerClone();

  const dateStr = col.dataset.date;
  const rect = col.getBoundingClientRect();
  const y = e.clientY - rect.top;
  const pxPerMin = 80 / 60;
  const rawMin = (y - offsetY) / pxPerMin;
  const snapped = Math.round(rawMin / 15) * 15; // 15-min snap
  const startMin = Math.max(0, Math.min(1440 - durationMins, snapped));
  const startTime = minutesToTime(startMin);
  const endTime = minutesToTime(startMin + durationMins);

  const newEvent = {
    ...JSON.parse(JSON.stringify(sourceEvent)),
    id: 'evt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    date: dateStr,
    startTime,
    endTime,
    noteId: ''
  };
  delete newEvent.recurrenceRule;
  delete newEvent.recurrenceId;
  delete newEvent.recurrenceExceptions;

  plannerEvents.push(newEvent);
  savePlanner();
  renderPlanner();
  toast(t('planner.eventCloned'));
}

function _plannerCloneKeyDown(e) {
  if (e.key === 'Escape') _cancelPlannerClone();
}

function _cancelPlannerClone() {
  if (!_plannerCloneState) return;
  _plannerCloneState.ghostEl?.remove();
  _plannerCloneState = null;
  document.body.classList.remove('planner-cloning');
  document.removeEventListener('mousemove', _plannerCloneMouseMove);
  document.removeEventListener('click', _plannerCloneMouseClick);
  document.removeEventListener('keydown', _plannerCloneKeyDown);
}

// ── HTML5 Drag and Drop Handlers ──

function handlePlannerTodoDragStart(event, todoId, todoTitle) {
  const cleanTitle = (typeof cleanTaskTitleText === 'function') ? cleanTaskTitleText(todoTitle) : todoTitle;
  const duration = typeof defaultPlannerDuration === 'number' ? defaultPlannerDuration : 30;
  window._draggedEventState = {
    type: 'todo-item',
    todoId: todoId,
    todoTitle: cleanTitle,
    duration: duration,
    offsetY: 0
  };

  event.dataTransfer.setData('text/plain', JSON.stringify({
    type: 'todo-item',
    todoId: todoId,
    todoTitle: cleanTitle
  }));
  event.dataTransfer.effectAllowed = 'copyMove';
}

function handlePlannerEventDragStart(event, eventId) {
  // Record where inside the card the user grabbed so the drop position is accurate
  const card = event.target.closest('.planner-event-card') || event.target;
  const cardRect = card.getBoundingClientRect();
  const offsetY = event.clientY - cardRect.top; // px from top of card

  const evt = plannerEvents.find(e => e.id === eventId);
  const start = evt ? timeToMinutes(evt.startTime) : NaN;
  const end = evt ? timeToMinutes(evt.endTime) : NaN;
  const duration = (!isNaN(start) && !isNaN(end) && end > start) ? (end - start) : (parseInt(evt?.duration, 10) || 30);

  window._draggedEventState = {
    type: 'event-item',
    eventId: eventId,
    offsetY: offsetY,
    duration: duration
  };

  event.dataTransfer.setData('text/plain', JSON.stringify({
    type: 'event-item',
    eventId: eventId,
    offsetY: offsetY
  }));
  event.dataTransfer.effectAllowed = 'move';
}

function handlePlannerDayColDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  if (!window._draggedEventState) return;

  // Show a visual preview of where the dragged item would land, but do
  // not create an event on every dragover (that caused many duplicates).
  const col = event.currentTarget;
  const rect = col.getBoundingClientRect();
  const y = event.clientY - rect.top;

  const pxPerMin = 80 / 60;
  const grabOffsetY = window._draggedEventState.offsetY || 0;
  const rawMin = (y - grabOffsetY) / pxPerMin;
  const snapped = Math.round(rawMin / 15) * 15; // 15-min snap
  const duration = window._draggedEventState.duration || (typeof defaultPlannerDuration === 'number' ? defaultPlannerDuration : 30);
  const startMin = Math.max(0, Math.min(1440 - duration, snapped));

  const topPx = startMin * pxPerMin;
  const heightPx = Math.max(1, duration * pxPerMin);

  // Clear any existing previews globally so only one preview exists
  document.querySelectorAll('.planner-drop-preview').forEach(el => el.remove());
  const preview = document.createElement('div');
  preview.className = 'planner-drop-preview';
  preview.style.top = topPx + 'px';
  preview.style.height = heightPx + 'px';
  col.appendChild(preview);

  // Also create a horizontal row highlight for clarity
  document.querySelectorAll('.planner-drag-row-highlight').forEach(el => el.remove());
  const row = document.createElement('div');
  row.className = 'planner-drag-row-highlight';
  row.style.top = topPx + 'px';
  row.style.height = heightPx + 'px';
  col.appendChild(row);
}

async function handlePlannerDayColDrop(e, dateStr) {
  // Guard: avoid processing duplicate drop events for same drag operation
  if (window._lastPlannerDropTs && (Date.now() - window._lastPlannerDropTs) < 300) return;
  window._lastPlannerDropTs = Date.now();
  e.preventDefault();
  try {
    const dataStr = e.dataTransfer.getData('text/plain');
    if (!dataStr) return;
    const dragData = JSON.parse(dataStr);

    // Calculate start time based on drop position relative to the day column
    const dayCol = e.currentTarget;
    const rect = dayCol.getBoundingClientRect();
    const y = e.clientY - rect.top;

    // Snap to 15-min slots (each slot = 20px at 80px/hr)
    const pxPerMin = 80 / 60;
    // Subtract the grab-offset so the card top aligns to where the user grabbed it
    const grabOffsetY = (dragData.type === 'event-item' && dragData.offsetY) ? dragData.offsetY : 0;
    const rawMin = (y - grabOffsetY) / pxPerMin;
    const snapped = Math.round(rawMin / 15) * 15; // 15-min snap
    const duration = window._draggedEventState?.duration || 30;
    const startMin = Math.max(0, Math.min(1440 - duration, snapped));
    const startTimeStr = minutesToTime(startMin);

    if (dragData.type === 'todo-item') {
      // Create a todo event at this time
      const duration = typeof defaultPlannerDuration === 'number' ? defaultPlannerDuration : 30;
      const endMin = startMin + duration;
      const endTimeStr = minutesToTime(endMin);
      const matchingTodo = (Array.isArray(todosManifest) ? todosManifest : []).find(t => String(t.id) === String(dragData.todoId));
      const rawTitle = dragData.todoTitle || matchingTodo?.title || 'Todo';
      const cleanTitle = (typeof cleanTaskTitleText === 'function') ? cleanTaskTitleText(rawTitle) : rawTitle;

      const todoNoteId = matchingTodo?.noteId || '';
      const todoLinkedNoteIds = matchingTodo?.noteId
        ? [matchingTodo.noteId]
        : (Array.isArray(matchingTodo?.linkedNoteIds) ? [...matchingTodo.linkedNoteIds] : []);
      const todoCollabIds = Array.isArray(matchingTodo?.collaboratorIds) ? [...matchingTodo.collaboratorIds] : [];
      const todoCollabs = Array.isArray(matchingTodo?.collaborators) ? [...matchingTodo.collaborators] : [];
      const todoGroupTags = Array.isArray(matchingTodo?.group_tags) ? [...matchingTodo.group_tags] : [];
      const todoMajorTags = matchingTodo?.major_topic
        ? [matchingTodo.major_topic]
        : (Array.isArray(matchingTodo?.major_topic_tags) ? [...matchingTodo.major_topic_tags] : []);
      const todoTopicTags = Array.isArray(matchingTodo?.topic_tags) ? [...matchingTodo.topic_tags] : [];
      const todoTags = Array.isArray(matchingTodo?.tags) ? [...matchingTodo.tags] : [];
      const todoContext = matchingTodo?.description || matchingTodo?.context || matchingTodo?.details || '';

      const newEvent = {
        id: 'evt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        type: 'todo',
        title: cleanTitle,
        date: dateStr,
        startTime: startTimeStr,
        endTime: endTimeStr,
        todoId: dragData.todoId || '',
        noteId: todoNoteId,
        linkedNoteIds: todoLinkedNoteIds,
        collaboratorIds: todoCollabIds,
        collaborators: todoCollabs,
        group_tags: todoGroupTags,
        major_topic_tags: todoMajorTags,
        topic_tags: todoTopicTags,
        tags: [...new Set([...todoTags, ...todoGroupTags, ...todoMajorTags, ...todoTopicTags])],
        context: todoContext
      };
      plannerEvents.push(newEvent);
      savePlanner();
      renderPlanner();
      toast(t('planner.todoScheduled'));
      // Clear drag state to avoid duplicate drops
      window._draggedEventState = null;
      return;
    } else if (dragData.type === 'event-item') {
      // Reschedule existing event
      const eventId = dragData.eventId;
      const eventIdx = plannerEvents.findIndex(evt => evt.id === eventId);
      if (eventIdx >= 0) {
        const evt = plannerEvents[eventIdx];
        const start = timeToMinutes(evt.startTime);
        const end = timeToMinutes(evt.endTime);
        const oldDuration = (!isNaN(start) && !isNaN(end) && end > start) ? (end - start) : (parseInt(evt.duration, 10) || 30);
        const newEndMin = startMin + oldDuration;
        const newEndTimeStr = minutesToTime(newEndMin);

        // Save previous date and start time for shifting preps
        const prevDate = evt.date;
        const prevStartMin = timeToMinutes(evt.startTime);

        pushPlannerUndoState('Reschedule event');

        evt.date = dateStr;
        evt.startTime = startTimeStr;
        evt.endTime = newEndTimeStr;

        if (prevDate !== dateStr) {
          recordPlannerSeriesMoveException(evt, prevDate, dateStr);
        }

        // Shift prep block linked by prepForEventId
        const prepEvents = (plannerEvents || []).filter(pe => pe && pe.prepForEventId === evt.id);
        prepEvents.forEach(pe => {
          const callDiffMin = startMin - prevStartMin;
          const peStartMin = timeToMinutes(pe.startTime) + callDiffMin;
          const peEndMin = timeToMinutes(pe.endTime) + callDiffMin;
          const prevPrepDate = pe.date;
          pe.date = dateStr;
          pe.startTime = minutesToTime(peStartMin);
          pe.endTime = minutesToTime(peEndMin);
          if (prevPrepDate !== dateStr) {
            recordPlannerSeriesMoveException(pe, prevPrepDate, dateStr);
          }
        });

        savePlanner();
        renderPlanner();
        toast(t('planner.eventRescheduled'));
        // Clear drag state to avoid duplicate drops
        window._draggedEventState = null;
      }
    }
  } catch (err) {
    console.error('Error handling planner drop:', err);
  }
}

// Helper to convert minutes back to HH:MM format
function minutesToTime(mins) {
  const clamped = Math.max(0, Math.min(1439, mins));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ── Day Capacity Score ──
// Returns { plannedMins, availableMins } for a given date string.
// availableMins = workday minutes (workStartTime to workEndTime).
// plannedMins   = total event minutes that fall within that window.
function _getDayCapacity(dateStr) {
  const workStartMin = timeToMinutes(workStartTime || '09:00');
  const workEndMin = timeToMinutes(workEndTime || '18:30');
  const availableMins = Math.max(0, workEndMin - workStartMin);

  const dayEvents = plannerEvents.filter(ev => ev.date === dateStr);
  let plannedMins = 0;
  dayEvents.forEach(ev => {
    const s = Math.max(workStartMin, timeToMinutes(ev.startTime));
    const e = Math.min(workEndMin, timeToMinutes(ev.endTime));
    if (e > s) plannedMins += (e - s);
  });

  return { plannedMins, availableMins };
}

function _renderPlannerSvgIcon(name, size = 16, className = '') {
  if (typeof AppIcons !== 'undefined' && typeof AppIcons.get === 'function') {
    return AppIcons.get(name, { size, className });
  }
  const s = size;
  if (name === 'repeat') {
    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${className}"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`;
  }
  if (name === 'calendar') {
    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${className}"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;
  }
  if (name === 'clock') {
    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${className}"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
  }
  if (name === 'timer') {
    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${className}"><line x1="10" y1="2" x2="14" y2="2"/><line x1="12" y1="14" x2="15" y2="11"/><circle cx="12" cy="14" r="8"/></svg>`;
  }
  if (name === 'settings') {
    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${className}"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
  }
  if (name === 'tag' || name === 'tags') {
    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${className}"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`;
  }
  if (name === 'users') {
    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${className}"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;
  }
  if (name === 'globe') {
    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${className}"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
  }
  if (name === 'check') {
    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="${className}"><polyline points="20 6 9 17 4 12"/></svg>`;
  }
  if (name === 'alertTriangle') {
    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${className}"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
  }
  if (name === 'fileText') {
    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${className}"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>`;
  }
  if (name === 'plus') {
    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${className}"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
  }
  if (name === 'save') {
    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${className}"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`;
  }
  if (name === 'trash') {
    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${className}"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`;
  }
  if (name === 'close' || name === 'x') {
    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="${className}"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  }
  if (name === 'pencil' || name === 'edit') {
    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${className}"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>`;
  }
  if (name === 'copy' || name === 'clipboard') {
    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${className}"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
  }
  if (name === 'phone' || name === 'call') {
    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${className}"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`;
  }
  if (name === 'coffee') {
    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${className}"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>`;
  }
  if (name === 'link') {
    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${className}"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;
  }
  if (name === 'checkSquare') {
    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${className}"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`;
  }
  if (name === 'plane') {
    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${className}"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>`;
  }
  if (name === 'sliders') {
    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${className}"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>`;
  }
  return '';
}
window._renderPlannerSvgIcon = _renderPlannerSvgIcon;

function _getPlannerEventTypeSvg(type, size = 13) {
  const s = size;
  switch (type) {
    case 'call':
      return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`;
    case 'sync':
      return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;
    case 'prep':
      return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><path d="m9 14 2 2 4-4"/></svg>`;
    case 'work':
      return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>`;
    case 'todo':
      return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`;
    case 'personal':
      return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>`;
    case 'ooo':
      return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 8c0-2.76-2.46-5-5.5-5S2 5.24 2 8h11z"/><path d="M13 7.14A5.82 5.82 0 0 1 16.5 6c3.04 0 5.5 2.24 5.5 5h-11"/><path d="M5.8 15.5c1.5 1.5 3.7 2.5 6.2 2.5s4.7-1 6.2-2.5"/><path d="M12 10v12"/></svg>`;
    case 'custom':
    default:
      return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>`;
  }
}
window._getPlannerEventTypeSvg = _getPlannerEventTypeSvg;

function _renderPlannerTypeSegmentedControl(currentType) {
  const types = ['call', 'sync', 'prep', 'work', 'todo', 'personal', 'ooo', 'custom'];
  return types.map(t_val => {
    const isSel = t_val === currentType;
    const label = t('planner.' + t_val) || t_val;
    const iconSvg = _getPlannerEventTypeSvg(t_val, 13);
    return `
      <button type="button" 
        class="pe-type-segment-btn pe-segment-${t_val}${isSel ? ' active' : ''}" 
        data-type="${t_val}" 
        role="radio" 
        aria-checked="${isSel ? 'true' : 'false'}"
        title="${escA(label)}" 
        onclick="_selectPlannerSegmentType('${t_val}')">
        <span class="pe-segment-icon">${iconSvg}</span>
        <span class="pe-segment-label">${escH(label)}</span>
      </button>
    `;
  }).join('');
}
window._renderPlannerTypeSegmentedControl = _renderPlannerTypeSegmentedControl;

function _selectPlannerSegmentType(type) {
  const selectEl = document.getElementById('pe-type');
  if (selectEl) {
    selectEl.value = type;
  }
  if (typeof togglePlannerModalFields === 'function') {
    togglePlannerModalFields(type);
  }
}
window._selectPlannerSegmentType = _selectPlannerSegmentType;

const _PLANNER_WEEKDAY_DEFS = [
  { day: 1, key: 'setupWizard.dayMon', fullKey: 'setupWizard.dayMonFull', fallback: 'Mon', fallbackFull: 'Monday' },
  { day: 2, key: 'setupWizard.dayTue', fullKey: 'setupWizard.dayTueFull', fallback: 'Tue', fallbackFull: 'Tuesday' },
  { day: 3, key: 'setupWizard.dayWed', fullKey: 'setupWizard.dayWedFull', fallback: 'Wed', fallbackFull: 'Wednesday' },
  { day: 4, key: 'setupWizard.dayThu', fullKey: 'setupWizard.dayThuFull', fallback: 'Thu', fallbackFull: 'Thursday' },
  { day: 5, key: 'setupWizard.dayFri', fullKey: 'setupWizard.dayFriFull', fallback: 'Fri', fallbackFull: 'Friday' },
  { day: 6, key: 'setupWizard.daySat', fullKey: 'setupWizard.daySatFull', fallback: 'Sat', fallbackFull: 'Saturday' },
  { day: 0, key: 'setupWizard.daySun', fullKey: 'setupWizard.daySunFull', fallback: 'Sun', fallbackFull: 'Sunday' }
];

function _isPlannerWorkday(date) {
  if (!date) return false;
  const day = date.getDay();
  return day >= 1 && day <= 5;
}

function _getNthWeekdayOfMonth(year, month, nth, weekday) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const matches = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    if (date.getDay() === weekday) {
      matches.push(d);
    }
  }
  if (!matches.length) return null;
  if (nth === -1 || nth === 'last' || String(nth) === '-1') return matches[matches.length - 1];
  const idx = parseInt(nth, 10) - 1;
  return (idx >= 0 && idx < matches.length) ? matches[idx] : null;
}

function _getNthWorkdayOfMonth(year, month, nth) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const workdays = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dayOfWeek = new Date(year, month, d).getDay();
    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
      workdays.push(d);
    }
  }
  if (!workdays.length) return null;
  if (nth === -1 || nth === 'last' || String(nth) === '-1') return workdays[workdays.length - 1];
  const idx = parseInt(nth, 10) - 1;
  return (idx >= 0 && idx < workdays.length) ? workdays[idx] : null;
}

function formatPlannerRecurrenceRuleSummary(recRule, startDate) {
  if (!recRule) return t('planner.recurrence') || 'Recurrence';
  const unit = recRule.unit || 'week';
  const interval = parseInt(recRule.interval, 10) || 1;
  const pDate = startDate ? parseLocalDateValue(startDate) : null;

  function getNthLabel(n) {
    const num = parseInt(n, 10);
    if (num === -1 || n === 'last' || String(n) === '-1') return t('planner.nthLast') || 'Last';
    if (num === 1) return t('planner.nthFirst') || '1st';
    if (num === 2) return t('planner.nthSecond') || '2nd';
    if (num === 3) return t('planner.nthThird') || '3rd';
    if (num === 4) return t('planner.nthFourth') || '4th';
    return `${num}.`;
  }

  function getWeekdayName(d) {
    const item = _PLANNER_WEEKDAY_DEFS.find(w => w.day === d);
    if (!item) return '';
    return t(item.fullKey) || item.fallbackFull;
  }

  if (unit === 'day') {
    if (recRule.workdaysOnly) {
      return t('planner.everyWorkday') || 'Every workday (Mon-Fri)';
    }
    const dayLabel = t('planner.dayLabel') || 'day(s)';
    return `${t('planner.repeatLabel') || 'Every'} ${interval > 1 ? interval + ' ' : ''}${dayLabel}`;
  }

  if (unit === 'week') {
    const weekLabel = t('planner.weekLabel') || 'week(s)';
    const prefix = `${t('planner.repeatLabel') || 'Every'} ${interval > 1 ? interval + ' ' : ''}${weekLabel}`;
    const days = (Array.isArray(recRule.weekdays) && recRule.weekdays.length > 0)
      ? recRule.weekdays
      : (pDate ? [pDate.getDay()] : []);
    if (days.length > 0) {
      const dayNames = days.map(getWeekdayName).filter(Boolean).join(', ');
      return `${prefix} ${t('planner.onTheLabel') || 'on'} ${dayNames}`;
    }
    return prefix;
  }

  if (unit === 'month') {
    const monthLabel = t('planner.monthLabel') || 'month(s)';
    const prefix = `${t('planner.repeatLabel') || 'Every'} ${interval > 1 ? interval + ' ' : ''}${monthLabel}`;
    const mType = recRule.monthlyType || 'day_of_month';
    if (mType === 'nth_workday') {
      const nthText = getNthLabel(recRule.monthlyNth !== undefined ? recRule.monthlyNth : 1);
      const wdText = t('planner.workdayLabel') || 'work day';
      return `${prefix} ${t('planner.onTheLabel') || 'on the'} ${nthText} ${wdText}`;
    }
    if (mType === 'nth_weekday') {
      const nthText = getNthLabel(recRule.monthlyNth !== undefined ? recRule.monthlyNth : 1);
      const dayNum = recRule.monthlyWeekday !== undefined ? parseInt(recRule.monthlyWeekday, 10) : (pDate ? pDate.getDay() : 2);
      const dayText = getWeekdayName(dayNum);
      return `${prefix} ${t('planner.onTheLabel') || 'on the'} ${nthText} ${dayText}`;
    }
    const dayNum = recRule.monthlyDay !== undefined ? recRule.monthlyDay : (pDate ? pDate.getDate() : 1);
    return `${prefix} ${t('planner.onDayLabel') || 'on day'} ${dayNum}`;
  }

  if (unit === 'year') {
    const yearLabel = t('planner.yearLabel') || 'year(s)';
    return `${t('planner.repeatLabel') || 'Every'} ${interval > 1 ? interval + ' ' : ''}${yearLabel}`;
  }

  return `${t('planner.repeatLabel') || 'Every'} ${interval} ${unit}`;
}

function _togglePlannerWeekdayPill(btn) {
  if (!btn) return;
  btn.classList.toggle('active');
  const isActive = btn.classList.contains('active');
  btn.style.background = isActive ? 'var(--accent)' : '';
  btn.style.color = isActive ? '#fff' : '';
  btn.style.borderColor = isActive ? 'var(--accent)' : '';

  const parentBox = btn.closest('#planner-series-modal');
  if (parentBox) {
    _updatePlannerSeriesRuleBadge();
  } else {
    updateRecurrenceButtonLabel();
  }
}

function _togglePlannerRecurrenceUnit(unit, prefix = 'pe') {
  const dailyWrap = document.getElementById(`${prefix}-recurrence-daily-wrap`);
  const weeklyWrap = document.getElementById(`${prefix}-recurrence-weekly-wrap`);
  const monthlyWrap = document.getElementById(`${prefix}-recurrence-monthly-wrap`);

  if (dailyWrap) dailyWrap.style.display = (unit === 'day') ? 'flex' : 'none';
  if (weeklyWrap) weeklyWrap.style.display = (unit === 'week') ? 'flex' : 'none';
  if (monthlyWrap) monthlyWrap.style.display = (unit === 'month') ? 'flex' : 'none';

  if (prefix === 'ps') {
    _updatePlannerSeriesRuleBadge();
  } else {
    updateRecurrenceButtonLabel();
  }
}

function _togglePlannerMonthlyType(type, prefix = 'pe') {
  const daySub = document.getElementById(`${prefix}-recurrence-monthly-day-sub`);
  const workdaySub = document.getElementById(`${prefix}-recurrence-monthly-nth-workday-sub`);
  const weekdaySub = document.getElementById(`${prefix}-recurrence-monthly-nth-weekday-sub`);

  if (daySub) daySub.style.display = (type === 'day_of_month') ? 'flex' : 'none';
  if (workdaySub) workdaySub.style.display = (type === 'nth_workday') ? 'flex' : 'none';
  if (weekdaySub) weekdaySub.style.display = (type === 'nth_weekday') ? 'flex' : 'none';

  if (prefix === 'ps') {
    _updatePlannerSeriesRuleBadge();
  } else {
    updateRecurrenceButtonLabel();
  }
}

function _updatePlannerSeriesRuleBadge() {
  const badge = document.getElementById('ps-rule-badge');
  if (!badge) return;
  const interval = parseInt(document.getElementById('ps-recurrence-interval')?.value || '1', 10) || 1;
  const unit = document.getElementById('ps-recurrence-unit')?.value || 'week';
  const workdaysOnly = !!document.getElementById('ps-recurrence-workdays-only')?.checked;
  const weekdays = Array.from(document.querySelectorAll('#ps-recurrence-weekdays .planner-weekday-pill.active'))
    .map(b => parseInt(b.getAttribute('data-day'), 10));
  const monthlyType = document.getElementById('ps-recurrence-monthly-type')?.value || 'day_of_month';
  const monthlyDay = parseInt(document.getElementById('ps-recurrence-monthly-day')?.value || '1', 10) || 1;
  const monthlyWorkdayNth = parseInt(document.getElementById('ps-recurrence-monthly-workday-nth')?.value || '1', 10);
  const monthlyWeekdayNth = parseInt(document.getElementById('ps-recurrence-monthly-weekday-nth')?.value || '1', 10);
  const monthlyWeekday = parseInt(document.getElementById('ps-recurrence-monthly-weekday')?.value || '1', 10);
  const monthlyNth = (monthlyType === 'nth_workday') ? monthlyWorkdayNth : monthlyWeekdayNth;

  const dummyRule = {
    interval,
    unit,
    workdaysOnly,
    weekdays,
    monthlyType,
    monthlyDay,
    monthlyNth,
    monthlyWeekday
  };
  badge.textContent = formatPlannerRecurrenceRuleSummary(dummyRule);
}

let _recurrenceBaselineState = null;

function openPlannerRecurrenceOverlay(e) {
  if (e) e.preventDefault();
  const overlay = document.getElementById('pe-recurrence-overlay');
  if (!overlay) return;

  // Save baseline state
  const enabled = document.getElementById('pe-recurrence-enabled')?.checked || false;
  const interval = document.getElementById('pe-recurrence-interval')?.value || '1';
  const unit = document.getElementById('pe-recurrence-unit')?.value || 'week';
  const until = document.getElementById('pe-recurrence-until')?.value || '';
  const noEnd = document.getElementById('pe-recurrence-no-end')?.checked || false;
  const workdaysOnly = document.getElementById('pe-recurrence-workdays-only')?.checked || false;
  const weekdays = Array.from(document.querySelectorAll('#pe-recurrence-weekdays .planner-weekday-pill.active'))
    .map(b => parseInt(b.getAttribute('data-day'), 10));
  const monthlyType = document.getElementById('pe-recurrence-monthly-type')?.value || 'day_of_month';
  const monthlyDay = document.getElementById('pe-recurrence-monthly-day')?.value || '1';
  const monthlyWorkdayNth = document.getElementById('pe-recurrence-monthly-workday-nth')?.value || '1';
  const monthlyWeekdayNth = document.getElementById('pe-recurrence-monthly-weekday-nth')?.value || '1';
  const monthlyWeekday = document.getElementById('pe-recurrence-monthly-weekday')?.value || '1';

  _recurrenceBaselineState = {
    enabled,
    interval,
    unit,
    until,
    noEnd,
    workdaysOnly,
    weekdays,
    monthlyType,
    monthlyDay,
    monthlyWorkdayNth,
    monthlyWeekdayNth,
    monthlyWeekday
  };

  // Add dimmed backdrop behind the overlay
  const modal = overlay.closest('.modal');
  if (modal) {
    let backdrop = modal.querySelector('.planner-recurrence-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.className = 'planner-recurrence-backdrop';
      backdrop.onclick = () => closePlannerRecurrenceOverlay(true);
      modal.appendChild(backdrop);
    }
    backdrop.style.display = 'block';
  }

  _togglePlannerRecurrenceUnit(unit, 'pe');
  _togglePlannerMonthlyType(monthlyType, 'pe');
  overlay.style.display = 'flex';
}

function closePlannerRecurrenceOverlay(apply = false) {
  const overlay = document.getElementById('pe-recurrence-overlay');
  if (!overlay) return;

  if (!apply && _recurrenceBaselineState) {
    // Restore baseline state
    const enabledInput = document.getElementById('pe-recurrence-enabled');
    if (enabledInput) {
      enabledInput.checked = _recurrenceBaselineState.enabled;
      togglePlannerRecurrenceEnabled(_recurrenceBaselineState.enabled);
    }
    const intervalInput = document.getElementById('pe-recurrence-interval');
    if (intervalInput) intervalInput.value = _recurrenceBaselineState.interval;
    const unitInput = document.getElementById('pe-recurrence-unit');
    if (unitInput) {
      unitInput.value = _recurrenceBaselineState.unit;
      _togglePlannerRecurrenceUnit(_recurrenceBaselineState.unit, 'pe');
    }
    const untilInput = document.getElementById('pe-recurrence-until');
    if (untilInput) untilInput.value = _recurrenceBaselineState.until;
    const noEndInput = document.getElementById('pe-recurrence-no-end');
    if (noEndInput) {
      noEndInput.checked = _recurrenceBaselineState.noEnd;
      togglePlannerRecurrenceNoEnd(_recurrenceBaselineState.noEnd);
    }
    const workdaysInput = document.getElementById('pe-recurrence-workdays-only');
    if (workdaysInput) workdaysInput.checked = _recurrenceBaselineState.workdaysOnly;

    const weekdayBtns = document.querySelectorAll('#pe-recurrence-weekdays .planner-weekday-pill');
    weekdayBtns.forEach(btn => {
      const d = parseInt(btn.getAttribute('data-day'), 10);
      const isSel = _recurrenceBaselineState.weekdays.includes(d);
      btn.classList.toggle('active', isSel);
      btn.style.background = isSel ? 'var(--accent)' : '';
      btn.style.color = isSel ? '#fff' : '';
      btn.style.borderColor = isSel ? 'var(--accent)' : '';
    });

    const mTypeInput = document.getElementById('pe-recurrence-monthly-type');
    if (mTypeInput) {
      mTypeInput.value = _recurrenceBaselineState.monthlyType;
      _togglePlannerMonthlyType(_recurrenceBaselineState.monthlyType, 'pe');
    }
    const mDayInput = document.getElementById('pe-recurrence-monthly-day');
    if (mDayInput) mDayInput.value = _recurrenceBaselineState.monthlyDay;
    const mWorkdayNthInput = document.getElementById('pe-recurrence-monthly-workday-nth');
    if (mWorkdayNthInput) mWorkdayNthInput.value = _recurrenceBaselineState.monthlyWorkdayNth;
    const mWeekdayNthInput = document.getElementById('pe-recurrence-monthly-weekday-nth');
    if (mWeekdayNthInput) mWeekdayNthInput.value = _recurrenceBaselineState.monthlyWeekdayNth;
    const mWeekdayInput = document.getElementById('pe-recurrence-monthly-weekday');
    if (mWeekdayInput) mWeekdayInput.value = _recurrenceBaselineState.monthlyWeekday;
  }

  overlay.style.display = 'none';

  // Remove backdrop
  const modal = overlay.closest('.modal');
  if (modal) {
    const backdrop = modal.querySelector('.planner-recurrence-backdrop');
    if (backdrop) backdrop.style.display = 'none';
  }

  _recurrenceBaselineState = null;
  updateRecurrenceButtonLabel();
}

function togglePlannerRecurrenceEnabled(enabled) {
  const content = document.getElementById('pe-recurrence-overlay-content');
  if (content) {
    content.style.opacity = enabled ? '1' : '0.5';
    content.style.pointerEvents = enabled ? 'auto' : 'none';
  }
}

function updateRecurrenceButtonLabel() {
  const btn = document.getElementById('pe-recurrence-btn');
  if (!btn) return;
  const enabled = document.getElementById('pe-recurrence-enabled')?.checked;
  const iconSvg = _renderPlannerSvgIcon('repeat', 14);
  if (enabled) {
    const interval = parseInt(document.getElementById('pe-recurrence-interval')?.value || '1', 10);
    const unit = document.getElementById('pe-recurrence-unit')?.value || 'week';
    const workdaysOnly = !!document.getElementById('pe-recurrence-workdays-only')?.checked;
    const weekdays = Array.from(document.querySelectorAll('#pe-recurrence-weekdays .planner-weekday-pill.active'))
      .map(b => parseInt(b.getAttribute('data-day'), 10));
    const monthlyType = document.getElementById('pe-recurrence-monthly-type')?.value || 'day_of_month';
    const monthlyDay = parseInt(document.getElementById('pe-recurrence-monthly-day')?.value || '1', 10);
    const monthlyWorkdayNth = parseInt(document.getElementById('pe-recurrence-monthly-workday-nth')?.value || '1', 10);
    const monthlyWeekdayNth = parseInt(document.getElementById('pe-recurrence-monthly-weekday-nth')?.value || '1', 10);
    const monthlyWeekday = parseInt(document.getElementById('pe-recurrence-monthly-weekday')?.value || '1', 10);
    const monthlyNth = (monthlyType === 'nth_workday') ? monthlyWorkdayNth : monthlyWeekdayNth;

    const dummyRule = {
      interval,
      unit,
      workdaysOnly,
      weekdays,
      monthlyType,
      monthlyDay,
      monthlyNth,
      monthlyWeekday
    };
    const summary = formatPlannerRecurrenceRuleSummary(dummyRule);
    btn.innerHTML = `<span style="display:inline-flex;align-items:center;gap:6px;">${iconSvg} <span>${escH(summary)}</span></span>`;
    btn.classList.add('btn-save');
  } else {
    btn.innerHTML = `<span style="display:inline-flex;align-items:center;gap:6px;">${iconSvg} <span>${escH(t('planner.recurrence') || 'Recurrence')}</span></span>`;
    btn.classList.remove('btn-save');
  }
}

function togglePlannerRecurrenceNoEnd(noEnd) {
  const untilInput = document.getElementById('pe-recurrence-until');
  if (untilInput) {
    untilInput.disabled = noEnd;
    untilInput.style.opacity = noEnd ? '0.5' : '1';
  }
}

function shouldEventOccurOnDate(parent, dateStr) {
  if (!parent.recurrenceRule) return false;
  const { interval, unit, until, weekdays, monthlyType, monthlyDay, monthlyNth, monthlyWeekday, workdaysOnly } = parent.recurrenceRule;
  const parseFn = typeof parseLocalDateValue === 'function'
    ? parseLocalDateValue
    : (typeof window !== 'undefined' && typeof window.parseLocalDateValue === 'function' ? window.parseLocalDateValue : (s => new Date(s)));
  const pDate = parseFn(parent.recurrenceRule?.startDate || parent.date);
  const tDate = parseFn(dateStr);
  if (!pDate || !tDate) return false;

  if (tDate < pDate) return false;

  if (until) {
    const untilDate = parseFn(until);
    if (untilDate && tDate > untilDate) return false;
  }

  const intVal = parseInt(interval, 10) || 1;

  if (unit === 'day') {
    if (workdaysOnly) {
      if (!_isPlannerWorkday(tDate)) return false;
      if (intVal === 1) return true;
      let workdaysCount = 0;
      const cur = new Date(pDate);
      while (cur < tDate) {
        if (_isPlannerWorkday(cur)) workdaysCount++;
        cur.setDate(cur.getDate() + 1);
      }
      return workdaysCount % intVal === 0;
    }
    const diffTime = tDate.getTime() - pDate.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
    return diffDays >= 0 && diffDays % intVal === 0;
  }

  if (unit === 'week') {
    const targetDay = tDate.getDay();
    const allowedDays = Array.isArray(weekdays) && weekdays.length > 0
      ? weekdays
      : [pDate.getDay()];

    if (!allowedDays.includes(targetDay)) return false;

    const pMonday = new Date(pDate);
    const pDay = pMonday.getDay();
    pMonday.setDate(pMonday.getDate() + (pDay === 0 ? -6 : 1 - pDay));
    pMonday.setHours(0, 0, 0, 0);

    const tMonday = new Date(tDate);
    const tDay = tMonday.getDay();
    tMonday.setDate(tMonday.getDate() + (tDay === 0 ? -6 : 1 - tDay));
    tMonday.setHours(0, 0, 0, 0);

    const weeksDiff = Math.round((tMonday - pMonday) / (7 * 24 * 60 * 60 * 1000));
    return weeksDiff >= 0 && weeksDiff % intVal === 0;
  }

  if (unit === 'month') {
    const monthsDiff = (tDate.getFullYear() - pDate.getFullYear()) * 12 + (tDate.getMonth() - pDate.getMonth());
    if (monthsDiff < 0 || monthsDiff % intVal !== 0) return false;

    const mType = monthlyType || 'day_of_month';
    if (mType === 'nth_workday') {
      const nth = monthlyNth !== undefined ? parseInt(monthlyNth, 10) : 1;
      const targetWorkday = _getNthWorkdayOfMonth(tDate.getFullYear(), tDate.getMonth(), nth);
      return targetWorkday !== null && tDate.getDate() === targetWorkday;
    }

    if (mType === 'nth_weekday') {
      const nth = monthlyNth !== undefined ? parseInt(monthlyNth, 10) : 1;
      const wday = monthlyWeekday !== undefined ? parseInt(monthlyWeekday, 10) : pDate.getDay();
      const targetDay = _getNthWeekdayOfMonth(tDate.getFullYear(), tDate.getMonth(), nth, wday);
      return targetDay !== null && tDate.getDate() === targetDay;
    }

    // Default: day_of_month
    const targetDay = monthlyDay !== undefined ? parseInt(monthlyDay, 10) : pDate.getDate();
    const daysInMonth = new Date(tDate.getFullYear(), tDate.getMonth() + 1, 0).getDate();
    const effectiveDay = Math.min(targetDay, daysInMonth);
    return tDate.getDate() === effectiveDay;
  }

  if (unit === 'year') {
    if (pDate.getDate() !== tDate.getDate() || pDate.getMonth() !== tDate.getMonth()) return false;
    const yearsDiff = tDate.getFullYear() - pDate.getFullYear();
    return yearsDiff >= 0 && yearsDiff % intVal === 0;
  }

  return false;
}

function precreateRecurringEventsForWeek(days) {
  let changed = false;
  const parents = plannerEvents.filter(e => e.recurrenceRule);

  for (const parent of parents) {
    if (!parent.recurrenceId) {
      parent.recurrenceId = 'rec-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      changed = true;
    }
    const exceptions = new Set(Array.isArray(parent.recurrenceExceptions) ? parent.recurrenceExceptions : []);
    for (const dayStr of days) {
      if (dayStr === parent.date) continue;
      if (exceptions.has(dayStr)) continue; // skip explicitly deleted occurrences

      if (shouldEventOccurOnDate(parent, dayStr)) {
        const exists = plannerEvents.some(e => e.recurrenceId === parent.recurrenceId && e.date === dayStr && e.type === parent.type);
        if (!exists) {
          const occEvent = {
            id: 'evt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6) + '-occ',
            type: parent.type,
            title: parent.title,
            date: dayStr,
            startTime: parent.startTime,
            endTime: parent.endTime,
            todoId: parent.todoId || '',
            prepForEventId: '',
            noteId: '',
            recurrenceId: parent.recurrenceId,
            collaborators: [...(parent.collaborators || [])],
            group_tags: [...(parent.group_tags || [])],
            major_topic_tags: [...(parent.major_topic_tags || [])],
            topic_tags: [...(parent.topic_tags || [])]
          };
          plannerEvents.push(occEvent);
          changed = true;

          const parentPrep = plannerEvents.find(pe => pe.type === 'prep' && pe.prepForEventId === parent.id);
          if (parentPrep) {
            const prepSlot = _findSmartPrepSlot(dayStr, parent.startTime, 30);
            const prepEvent = {
              id: 'evt-' + Date.now() + '-prep-' + Math.random().toString(36).slice(2, 6),
              type: 'prep',
              title: `Prep: ${parent.title}`,
              date: prepSlot.date,
              startTime: prepSlot.startTime,
              endTime: prepSlot.endTime,
              prepForEventId: occEvent.id,
              recurrenceId: parent.recurrenceId,
              noteId: '',
              autoPlaced: true
            };
            plannerEvents.push(prepEvent);
          }
        }
      }
    }
  }

  if (changed) {
    savePlanner();
  }
}

// ── Edit/Delete Series Scope Selection Dialog ──
function showScopePromptDialog(title, message, isDelete = false) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.style.zIndex = '99999';

    const box = document.createElement('div');
    box.className = 'dialog-box';
    box.style.width = '450px';

    const titleEl = document.createElement('h3');
    titleEl.textContent = title;
    titleEl.style.margin = '0 0 10px 0';
    titleEl.style.color = 'var(--accent)';
    box.appendChild(titleEl);

    const msg = document.createElement('div');
    msg.className = 'dialog-message';
    msg.textContent = message;
    box.appendChild(msg);

    const actions = document.createElement('div');
    actions.className = 'dialog-actions';
    actions.style.flexDirection = 'column';
    actions.style.gap = '8px';

    const btnOnly = document.createElement('button');
    btnOnly.className = isDelete ? 'btn btn-danger' : 'btn btn-save';
    btnOnly.style.width = '100%';
    btnOnly.textContent = isDelete ? t('planner.deleteOnlyThis') : t('planner.editOnlyThis');
    btnOnly.onclick = () => { cleanup(); resolve('only'); };
    actions.appendChild(btnOnly);

    const btnFollowing = document.createElement('button');
    btnFollowing.className = isDelete ? 'btn btn-danger' : 'btn btn-save';
    btnFollowing.style.width = '100%';
    btnFollowing.textContent = isDelete ? t('planner.deleteThisAndFollowing') : t('planner.editThisAndFollowing');
    btnFollowing.onclick = () => { cleanup(); resolve('following'); };
    actions.appendChild(btnFollowing);

    const btnAll = document.createElement('button');
    btnAll.className = isDelete ? 'btn btn-danger' : 'btn btn-save';
    btnAll.style.width = '100%';
    btnAll.textContent = isDelete ? t('planner.deleteAllInSeries') : t('planner.editAllInSeries');
    btnAll.onclick = () => { cleanup(); resolve('all'); };
    actions.appendChild(btnAll);

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn';
    cancelBtn.style.width = '100%';
    cancelBtn.textContent = t('editor.cancel') || 'Cancel';
    cancelBtn.onclick = () => { cleanup(); resolve(null); };
    actions.appendChild(cancelBtn);

    box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    btnOnly.focus();

    const cleanup = () => {
      document.removeEventListener('keydown', keyHandler);
      overlay.remove();
    };

    const keyHandler = e => {
      if (e.key === 'Escape') {
        cleanup();
        resolve(null);
      }
    };
    document.addEventListener('keydown', keyHandler);

    overlay.addEventListener('click', e => {
      if (e.target === overlay) {
        cleanup();
        resolve(null);
      }
    });
  });
}

// ── Continue Work Feature ──
function openContinueWorkModal(sourceEventId) {
  const sourceEvent = plannerEvents.find(e => e.id === sourceEventId);
  if (!sourceEvent) return;

  const srcDate = parseLocalDateValue(sourceEvent.date) || new Date();
  const nextDay = new Date(srcDate);
  nextDay.setDate(srcDate.getDate() + 1);
  const dateStr = formatLocalDateValue(nextDay);

  const modalHtml = `
    <div class="form-field">
      <label>${t('planner.title')}</label>
      <input type="text" id="cw-title" value="${escA(sourceEvent.title)}">
    </div>
    <div class="form-field">
      <label>${t('planner.date')}</label>
      <input type="date" id="cw-date" value="${dateStr}">
    </div>
    <div style="display:flex;gap:0.75rem;flex-wrap:wrap;">
      <div class="form-field" style="flex:1;min-width:90px">
        <label>${t('planner.startTime')}</label>
        <input type="time" id="cw-start-time" value="${sourceEvent.startTime}" oninput="_cwSyncDuration()">
      </div>
      <div class="form-field" style="flex:1;min-width:80px">
        <label>Duration</label>
        <select id="cw-duration" oninput="_cwSyncEndFromDuration()">
          <option value="15" ${_calcDurationMins(sourceEvent.startTime, sourceEvent.endTime) === 15 ? 'selected' : ''}>15 min</option>
          <option value="30" ${_calcDurationMins(sourceEvent.startTime, sourceEvent.endTime) === 30 ? 'selected' : ''}>30 min</option>
          <option value="45" ${_calcDurationMins(sourceEvent.startTime, sourceEvent.endTime) === 45 ? 'selected' : ''}>45 min</option>
          <option value="60" ${_calcDurationMins(sourceEvent.startTime, sourceEvent.endTime) === 60 ? 'selected' : ''}>1 h</option>
          <option value="90" ${_calcDurationMins(sourceEvent.startTime, sourceEvent.endTime) === 90 ? 'selected' : ''}>1 h 30</option>
          <option value="120" ${_calcDurationMins(sourceEvent.startTime, sourceEvent.endTime) === 120 ? 'selected' : ''}>2 h</option>
          <option value="180" ${_calcDurationMins(sourceEvent.startTime, sourceEvent.endTime) === 180 ? 'selected' : ''}>3 h</option>
          <option value="custom" ${![15, 30, 45, 60, 90, 120, 180].includes(_calcDurationMins(sourceEvent.startTime, sourceEvent.endTime)) ? 'selected' : ''}>Custom end time</option>
        </select>
      </div>
      <div class="form-field" style="flex:1;min-width:90px;display:${![15, 30, 45, 60, 90, 120, 180].includes(_calcDurationMins(sourceEvent.startTime, sourceEvent.endTime)) ? '' : 'none'};" id="cw-end-time-field">
        <label>${t('planner.endTime')}</label>
        <input type="time" id="cw-end-time" value="${sourceEvent.endTime}" oninput="_cwSyncDurationFromEnd()">
      </div>
    </div>
    ${sourceEvent.noteId ? `
      <label style="display:flex;align-items:center;gap:0.5rem;font-size:0.8rem;cursor:pointer;margin-top:0.6rem;">
         <input type="checkbox" id="cw-link-note" checked>
         <span>${t('planner.linkSameNote') || 'Link to same note'}</span>
      </label>
    ` : ''}
  `;

  openPlannerModal(
    t('planner.continueWorkTitle') || 'Add follow-up session',
    modalHtml,
    async () => {
      const title = document.getElementById('cw-title')?.value?.trim() || sourceEvent.title;
      const date = document.getElementById('cw-date')?.value || '';
      const startTime = document.getElementById('cw-start-time')?.value || '';
      const endTime = document.getElementById('cw-end-time')?.value || '';

      if (!date || !startTime || !endTime) {
        throw new Error('Please fill in Date, Start Time and End Time.');
      }
      if (timeToMinutes(endTime) <= timeToMinutes(startTime)) {
        throw new Error('End Time must be after Start Time.');
      }

      let recurrenceId = sourceEvent.recurrenceId;
      if (!recurrenceId) {
        recurrenceId = 'rec-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
        sourceEvent.recurrenceId = recurrenceId;
      }

      const linkNote = document.getElementById('cw-link-note')?.checked;
      const noteId = linkNote ? sourceEvent.noteId : '';

      const newEvent = {
        id: 'evt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6) + '-cont',
        type: sourceEvent.type,
        title: title,
        date: date,
        startTime: startTime,
        endTime: endTime,
        noteId: noteId,
        todoId: sourceEvent.todoId || '',
        prepForEventId: sourceEvent.prepForEventId || '',
        group_tags: [...(sourceEvent.group_tags || [])],
        major_topic_tags: [...(sourceEvent.major_topic_tags || [])],
        topic_tags: [...(sourceEvent.topic_tags || [])],
        extra_tags: [...(sourceEvent.extra_tags || [])],
        recurrenceId: recurrenceId
      };

      plannerEvents.push(newEvent);
      await savePlanner();

      selectPlannerEventAndFocus(newEvent.id);

      toast('Follow-up session planned');
      return true;
    }
  );

  _cwSyncDuration();
}

function _cwSyncEndFromDuration() {
  const startEl = document.getElementById('cw-start-time');
  const durEl = document.getElementById('cw-duration');
  const endEl = document.getElementById('cw-end-time');
  const efEl = document.getElementById('cw-end-time-field');
  if (!startEl || !durEl || !endEl) return;
  if (durEl.value === 'custom') {
    if (efEl) efEl.style.display = '';
    return;
  }
  if (efEl) efEl.style.display = 'none';
  const startMin = timeToMinutes(startEl.value);
  if (isNaN(startMin)) return;
  const endMin = startMin + parseInt(durEl.value, 10);
  endEl.value = minutesToTime(endMin);
}

function _cwSyncDurationFromEnd() {
  const startEl = document.getElementById('cw-start-time');
  const durEl = document.getElementById('cw-duration');
  const endEl = document.getElementById('cw-end-time');
  const efEl = document.getElementById('cw-end-time-field');
  if (!startEl || !durEl || !endEl) return;
  const dur = _calcDurationMins(startEl.value, endEl.value);
  const opts = [15, 30, 45, 60, 90, 120, 180];
  const isCustom = !opts.includes(dur);
  durEl.value = isCustom ? 'custom' : String(dur);
  if (efEl) efEl.style.display = isCustom ? '' : 'none';
}

function _cwSyncDuration() {
  const durEl = document.getElementById('cw-duration');
  if (durEl && durEl.value !== 'custom') {
    _cwSyncEndFromDuration();
  } else {
    _cwSyncDurationFromEnd();
  }
}

function selectPlannerEventAndFocus(eventId) {
  const event = plannerEvents.find(e => e.id === eventId);
  if (!event) return;

  selectedPlannerEventId = eventId;

  const displayedDays = getPlannerDaysToDisplay().map(d => formatLocalDateValue(d));
  if (!displayedDays.includes(event.date)) {
    const eventDate = parseLocalDateValue(event.date);
    initPlannerWeek(eventDate);
  }

  renderPlanner();

  requestAnimationFrame(() => {
    const card = document.querySelector(`.planner-event-card[data-event-id="${CSS.escape(eventId)}"]`);
    if (card) card.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
}

function addPlannerCollaborator() {
  const input = document.getElementById('pe-new-collaborator');
  if (!input || !input.value.trim()) return;
  const cleanName = input.value.trim();
  const colleagueId = (typeof resolveColleagueId === 'function')
    ? (resolveColleagueId(cleanName, { allowCreate: true, allowMe: false }) || '')
    : cleanName;
  const displayName = (typeof getColleagueLabelById === 'function')
    ? getColleagueLabelById(colleagueId, cleanName)
    : cleanName;
  if (!colleagueId || !displayName) return;

  const listDiv = document.getElementById('pe-collaborators-list');
  if (listDiv) {
    // Check if already in the list
    const existingCheckbox = listDiv.querySelector(`input[value="${escA(colleagueId)}"]`);
    if (existingCheckbox) {
      existingCheckbox.checked = true;
    } else {
      // Remove placeholder text if present
      const placeholder = listDiv.querySelector('span:not(label span)');
      if (placeholder) listDiv.innerHTML = '';
      const label = document.createElement('label');
      label.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:pointer;font-size:0.8rem;background:var(--card-bg-alt);padding:2px 6px;border-radius:10px;border:1px solid var(--card-border);color:var(--text);margin-right:4px;margin-bottom:4px;';
      label.innerHTML = `<input type="checkbox" name="pe-collaborators" value="${escA(colleagueId)}" checked><span>${escH(displayName)}</span>`;
      listDiv.appendChild(label);
    }
  }
  input.value = '';
}

async function openNoteForEvent(event) {
  if (!event) return;

  if (event.type === 'custom' || event.type === 'personal') {
    if (event.noteId || (Array.isArray(event.linkedNoteIds) && event.linkedNoteIds.length > 0)) {
      event.noteId = '';
      event.linkedNoteIds = [];
      savePlanner();
      renderPlanner();
    }
    toast(t('planner.customNoNotes'));
    return;
  }

  if (event.type === 'prep') {
    const mainEv = event.prepForEventId ? plannerEvents.find(e => e.id === event.prepForEventId) : null;
    if (mainEv) {
      const prepNoteId = String(event.noteId || '').trim();
      const mainNoteId = String(mainEv.noteId || '').trim();
      const sharedNoteId = prepNoteId || mainNoteId;

      if (sharedNoteId && prepNoteId !== sharedNoteId) {
        event.noteId = sharedNoteId;
        event.linkedNoteIds = normalizePlannerLinkedNoteIds([sharedNoteId, ...(event.linkedNoteIds || [])], sharedNoteId);
      }
      if (sharedNoteId && mainNoteId !== sharedNoteId) {
        mainEv.noteId = sharedNoteId;
        mainEv.linkedNoteIds = normalizePlannerLinkedNoteIds([sharedNoteId, ...(mainEv.linkedNoteIds || [])], sharedNoteId);
      }

      if (sharedNoteId) {
        savePlanner();
        renderPlanner();
        const note = getNoteById(sharedNoteId);
        if (note) {
          if (typeof syncTagsBetweenBlocAndNote === 'function') {
            await syncTagsBetweenBlocAndNote(mainEv || event, note);
          }
          openNoteOverlay(note.path, null, null, false, null, { collapseMetadata: true, fromBloc: true, sourceEvent: mainEv || event });
          return;
        }
      } else {
        await openNoteForEvent(mainEv);
        return;
      }
    }
  }

  if (event.type === 'todo' && event.todoId) {
    const todo = getTodoById(event.todoId);
    if (todo) {
      // If this bloc already has its own primary note, just open it.
      if (event.noteId) {
        const note = getNoteById(event.noteId);
        if (note) {
          if (typeof syncTagsBetweenBlocAndNote === 'function') {
            await syncTagsBetweenBlocAndNote(event, note);
          }
          openNoteOverlay(note.path, null, null, false, null, { collapseMetadata: true, fromBloc: true, sourceEvent: event });
          return;
        }
      }

      // Otherwise generate a NEW note that becomes this bloc's primary note. The task's origin note
      // (todo.noteId), if any, is demoted to an associated note on both the bloc and the task.
      const closeProgress = showPlannerNoteGenerationProgress(
        t('planner.generatingTodoNoteMessage') || t('planner.generatingNoteMessage') || 'Please wait while the note is being generated...'
      );
      closeProgress.updateStage?.(t('planner.preparingTemplate') || 'Preparing template and formatting content...', '', 15);
      await new Promise(r => setTimeout(r, 20));
      try {
        const noteId = generateNoteId();
        const notePath = getCanonicalNotePath(noteId);
        const noteTitle = todo.title || 'Todo Note';
        const markdown = `# Todo Details\n\n- Todo ID: ${todo.id}\n- Priority: ${todo.priority}\n- Status: ${todo.status}\n\n# Tasks / Checklist\n\n- `;
        const mainHTML = mdToPreviewHTML(markdown);
        const note = {
          id: noteId,
          path: notePath,
          title: noteTitle,
          date: event.date || new Date().toISOString().slice(0, 10),
          group_tags: event.group_tags && event.group_tags.length ? [...event.group_tags] : ['Todos'],
          major_topic_tags: event.major_topic_tags ? [...event.major_topic_tags] : [],
          topic_tags: event.topic_tags ? [...event.topic_tags] : [],
          extra_tags: [],
          mainHTML
        };

        closeProgress.updateStage?.(t('planner.writingNoteContent') || 'Encrypting and saving note content...', '', 45);
        await new Promise(r => setTimeout(r, 16));

        await StorageAPI.writeNoteContent(notePath, buildNewNoteHTML(note));
        upsertManifest(note);

        closeProgress.updateStage?.(t('planner.linkingToPlanner') || 'Linking note to planner and updating indexes...', '', 75);
        await new Promise(r => setTimeout(r, 16));

        // Bloc: new note becomes primary; the origin note (if any) is kept as an associated note.
        const originNoteId = String(todo.noteId || '').trim();
        event.noteId = noteId;
        event.linkedNoteIds = normalizePlannerLinkedNoteIds(
          [noteId, ...(originNoteId ? [originNoteId] : []), ...(event.linkedNoteIds || [])],
          noteId
        );

        // Task: keep the origin note as its primary; add the new note as an associated note.
        // (If the task had no origin note, the new note becomes its primary — prior behaviour.)
        if (!originNoteId) {
          todo.noteId = noteId;
        } else {
          if (!Array.isArray(todo.linkedNoteIds)) todo.linkedNoteIds = [];
          if (!todo.linkedNoteIds.includes(noteId)) todo.linkedNoteIds.push(noteId);
        }
        await saveTodosManifest();

        await saveManifest({ force: true });
        await rebuildIndexHTML();
        savePlanner();
        renderPlanner();
        renderFilterChips();
        if (typeof renderPlannerInspector === 'function') renderPlannerInspector();
        if (typeof broadcastSync === 'function') {
          broadcastSync({ type: 'NOTE_SAVED', noteId, path: notePath, modified: new Date().toISOString() });
        }

        closeProgress.updateStage?.(t('planner.openingNoteEditor') || 'Opening note editor...', '', 95);
        await new Promise(r => setTimeout(r, 16));

        openNoteOverlay(notePath, null, null, false, null, { collapseMetadata: true, fromBloc: true, sourceEvent: event });
      } catch (e) {
        console.error('Failed to create new note for todo bloc:', e);
        toast(t('planner.createNoteFailed', { message: e.message }) || ('Failed to create note: ' + e.message), true);
      } finally {
        closeProgress();
      }
      return;
    }
  }

  const targetNoteId = getPlannerEventEffectiveNoteId(event);
  if (targetNoteId) {
    const note = getNoteById(targetNoteId);
    if (note) {
      if (!event.noteId && note.id) event.noteId = note.id;
      if (typeof syncTagsBetweenBlocAndNote === 'function') {
        await syncTagsBetweenBlocAndNote(event, note);
      }
      openNoteOverlay(note.path, null, null, false, null, { collapseMetadata: true, fromBloc: true, sourceEvent: event });
      return;
    }
  }

  if (event.type === 'ooo') {
    toast(t('planner.oooNoNotes'));
    return;
  }

  // Create Call/Sync/Work/Custom note on demand!
  const closeProgress = showPlannerNoteGenerationProgress(
    t('planner.generatingEventNoteMessage') || t('planner.generatingNoteMessage') || 'Please wait while the note is being generated...'
  );
  closeProgress.updateStage?.(t('planner.preparingTemplate') || 'Preparing template and formatting content...', '', 15);
  await new Promise(r => setTimeout(r, 20));
  const noteId = generateNoteId();
  const notePath = getCanonicalNotePath(noteId);
  const noteTitle = event.title || 'Untitled Session';

  const workingLang = typeof getWorkingLanguage === 'function' ? getWorkingLanguage() : (typeof getNoteLanguage === 'function' ? getNoteLanguage() : 'en');
  const effectiveTemplateId = event.noteTemplateId || (event.recurrenceId && (() => {
    const parent = (typeof plannerEvents !== 'undefined' ? plannerEvents : []).find(e => e.recurrenceId === event.recurrenceId && e.noteTemplateId);
    return parent ? parent.noteTemplateId : null;
  })()) || (event.type === 'sync' ? 'meeting_1on1' : null);

  let mainHTML = '';
  if (effectiveTemplateId && effectiveTemplateId !== 'standard' && typeof NoteTemplateManager !== 'undefined' && typeof NoteTemplateManager.getTemplateHTML === 'function') {
    const templateContent = NoteTemplateManager.getTemplateHTML(effectiveTemplateId, workingLang);
    if (templateContent) {
      mainHTML = templateContent;
    } else {
      const markdown = await generateEventNoteMarkdown(event, event.type, { lang: workingLang });
      mainHTML = mdToPreviewHTML(markdown);
    }
  } else {
    const markdown = await generateEventNoteMarkdown(event, event.type, { lang: workingLang });
    mainHTML = mdToPreviewHTML(markdown);
  }
  const note = {
    id: noteId,
    path: notePath,
    title: noteTitle,
    date: event.date,
    group_tags: event.group_tags || [],
    major_topic_tags: event.major_topic_tags || [],
    topic_tags: event.topic_tags || [],
    extra_tags: [],
    mainHTML
  };

  try {
    closeProgress.updateStage?.(t('planner.writingNoteContent') || 'Encrypting and saving note content...', '', 45);
    await new Promise(r => setTimeout(r, 16));

    await StorageAPI.writeNoteContent(notePath, buildNewNoteHTML(note));
    upsertManifest(note);

    closeProgress.updateStage?.(t('planner.linkingToPlanner') || 'Linking note to planner and updating indexes...', '', 75);
    await new Promise(r => setTimeout(r, 16));

    await saveManifest({ force: true });
    await rebuildIndexHTML();

    event.noteId = noteId;

    // Propagate noteId to linked prep events
    if (event.type === 'call' || event.type === 'sync') {
      plannerEvents.forEach(pe => {
        if (pe.type === 'prep' && pe.prepForEventId === event.id) {
          pe.noteId = noteId;
        }
      });
    }

    savePlanner();
    renderPlanner();
    renderFilterChips();

    closeProgress.updateStage?.(t('planner.openingNoteEditor') || 'Opening note editor...', '', 95);
    await new Promise(r => setTimeout(r, 16));

    openNoteOverlay(notePath, null, null, false, null, { collapseMetadata: true, fromBloc: true, sourceEvent: event });
  } catch (err) {
    console.error('Failed to create note on demand:', err);
    toast('Failed to create note: ' + err.message, true);
  } finally {
    closeProgress();
  }
}

// Clean up drag-drop highlights on dragend or drop
document.addEventListener('dragend', () => {
  document.querySelectorAll('.planner-drop-preview').forEach(el => el.remove());
  document.querySelectorAll('.planner-drag-row-highlight').forEach(el => el.remove());
  window._draggedEventState = null;
});

document.addEventListener('drop', () => {
  document.querySelectorAll('.planner-drop-preview').forEach(el => el.remove());
  document.querySelectorAll('.planner-drag-row-highlight').forEach(el => el.remove());
  window._draggedEventState = null;
});

// ── Series detection and past history extraction helper functions ──
async function getPreviousSessionInfo(currentEvent) {
  if (!currentEvent || !currentEvent.recurrenceId) return null;

  // Sort all events in the same series chronologically
  const sameSeries = (typeof plannerEvents !== 'undefined' ? plannerEvents : []).filter(e => e.recurrenceId === currentEvent.recurrenceId && e.id !== currentEvent.id);

  const getEventDateTime = (e) => {
    const d = e.date || '1970-01-01';
    const t = e.startTime || '00:00';
    return `${d}T${t}`;
  };

  const currentKey = getEventDateTime(currentEvent);
  const pastEvents = sameSeries.filter(e => getEventDateTime(e) < currentKey);
  if (pastEvents.length === 0) return null;

  // Sort descending (most recent first)
  pastEvents.sort((a, b) => getEventDateTime(b).localeCompare(getEventDateTime(a)));

  const lastEvent = pastEvents[0];

  // Find the most recent past event that has a note
  let prevNote = null;
  for (const pe of pastEvents) {
    const noteIds = (typeof getPlannerEventLinkedNoteIds === 'function')
      ? getPlannerEventLinkedNoteIds(pe)
      : (pe.noteId ? [pe.noteId] : []);
    for (const nid of noteIds) {
      if (nid) {
        const found = (typeof getNoteById === 'function') ? getNoteById(nid) : (typeof manifest !== 'undefined' ? manifest : []).find(n => n && n.id === nid);
        if (found) {
          prevNote = found;
          break;
        }
      }
    }
    if (prevNote) break;
  }

  return {
    lastEvent,
    prevNote
  };
}

function extractTodosFromMarkdown(md) {
  const todos = [];
  const lines = String(md || '').split('\n');
  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    // Check for tokenized todo first: {todo:Priority:ID:Status|Text}
    const todoTokenMatch = line.match(/\{todo:([^:]+):([^:]+)(?::([^|]+))?\|([^}]+)\}/i);
    if (todoTokenMatch) {
      const priority = todoTokenMatch[1];
      const id = todoTokenMatch[2];
      const status = todoTokenMatch[3] || '';
      const text = todoTokenMatch[4];
      todos.push({ text, priority, id, status, type: 'token' });
      continue;
    }
    // Check for standard markdown checkbox: - [ ] or - [x]
    const checkboxMatch = line.match(/^[\s*\-\+]*\[([ xX])\]\s*(.*)$/);
    if (checkboxMatch) {
      const isDone = checkboxMatch[1].toLowerCase() === 'x';
      const text = checkboxMatch[2].trim();
      todos.push({ text, priority: isDone ? 'Done' : 'Pending', type: 'markdown' });
    }
  }
  return todos;
}

async function generateEventNoteMarkdown(event, type, options = {}) {
  type = type || event?.type || '';
  const lang = options?.lang || (typeof getWorkingLanguage === 'function' ? getWorkingLanguage() : (typeof getNoteLanguage === 'function' ? getNoteLanguage() : 'en'));
  const strings = (typeof NOTE_TRANSLATIONS !== 'undefined' && NOTE_TRANSLATIONS[lang]) ? NOTE_TRANSLATIONS[lang] : (typeof NOTE_TRANSLATIONS !== 'undefined' ? NOTE_TRANSLATIONS.en : {
    goal: "Goal",
    syncGoal: "Sync Up Goal",
    callGoal: "Call Goal",
    meetingGoal: "Meeting Goal",
    notes: "Notes",
    meetingNotes: "Meeting Notes"
  });

  const sections = [];

  const goalTitle = type === 'sync'
    ? (strings.syncGoal || strings.goal || 'Goal')
    : (type === 'call' ? (strings.callGoal || strings.goal || 'Goal') : (type === 'meeting' ? (strings.meetingGoal || strings.goal || 'Goal') : (strings.goal || 'Goal')));

  const meetingContextText = (event?.context || options?.context || event?.description || '').trim();

  if (meetingContextText) {
    sections.push(`# ${goalTitle}\n\n${meetingContextText}`);
  } else {
    sections.push(`# ${goalTitle}\n`);
  }

  sections.push(`# ${strings.notes || strings.meetingNotes || 'Notes'}\n`);

  return sections.join('\n\n');
}

async function quickCreateCallAndOpenNote(customTitle = '') {
  try {
    const now = new Date();
    const dateStr = formatLocalDateValue(now);
    
    // Get current time formatted as HH:MM
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const startTime = `${hours}:${minutes}`;
    
    // Duration is 30 mins
    const startMin = now.getHours() * 60 + now.getMinutes();
    const endMin = startMin + 30;
    const endH = Math.floor(endMin / 60) % 24;
    const endM = endMin % 60;
    const endTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
    
    const eventId = 'evt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    const eventTitle = typeof customTitle === 'string' && customTitle.trim() ? customTitle.trim() : ('Call ' + startTime);
    const newEvent = {
      id: eventId,
      type: 'call',
      title: eventTitle,
      date: dateStr,
      startTime: startTime,
      endTime: endTime,
      noteId: ''
    };
    
    // Create the note
    const noteId = generateNoteId();
    const notePath = getCanonicalNotePath(noteId);
    
    // Generate templates or markdown
    const markdown = await generateEventNoteMarkdown(newEvent, 'call', { ignoreModal: true });
    const mainHTML = mdToPreviewHTML(markdown);
    
    const note = {
      id: noteId,
      path: notePath,
      title: eventTitle,
      date: dateStr,
      group_tags: [],
      major_topic_tags: [],
      topic_tags: [],
      extra_tags: [],
      mainHTML
    };
    
    await StorageAPI.writeNoteContent(notePath, buildNewNoteHTML(note));
    upsertManifest(note);
    await saveManifest({ force: true });
    await rebuildIndexHTML();
    
    newEvent.noteId = noteId;
    
    // Add to plannerEvents and save
    if (typeof plannerEvents === 'undefined' || !Array.isArray(plannerEvents)) {
      window.plannerEvents = [];
    }
    plannerEvents.push(newEvent);
    await savePlanner();
    
    if (typeof renderPlanner === 'function') renderPlanner();
    if (typeof renderFilterChips === 'function') renderFilterChips();
    
    openNoteOverlay(notePath);
  } catch (err) {
    console.error('Failed to quick-create call note:', err);
    toast('Error: ' + err.message, true);
  }
}

window.quickCreateCallAndOpenNote = quickCreateCallAndOpenNote;

let _lastPlannerFileCheckedAt = 0;
let _isPlannerRefreshing = false;
let _lastProposalsToastAt = 0;
let _plannerRenderDebounceTimer = null;

function _debouncedRenderPlanner() {
  if (_plannerRenderDebounceTimer) clearTimeout(_plannerRenderDebounceTimer);
  _plannerRenderDebounceTimer = setTimeout(() => {
    _plannerRenderDebounceTimer = null;
    if (typeof renderPlanner === 'function' && typeof activeTab !== 'undefined' && activeTab === 'planner') {
      renderPlanner();
    }
  }, 100);
}

async function checkPlannerRefresh() {
  const isStorageReady = Boolean((typeof rootHandle !== 'undefined' && rootHandle) || (typeof StorageAPI !== 'undefined' && typeof StorageAPI.getStorageEngine === 'function' && StorageAPI.getStorageEngine() === 'firebase'));
  if (!isStorageReady) return;

  const isPlannerActive = typeof activeTab !== 'undefined' && activeTab === 'planner';
  const now = Date.now();
  const minInterval = isPlannerActive ? 3000 : 15000;
  if (now - _lastPlannerFileCheckedAt < minInterval) return;
  if (_isPlannerRefreshing) return;
  _lastPlannerFileCheckedAt = now;
  _isPlannerRefreshing = true;

  try {
    if (isPlannerActive && typeof StorageAPI !== 'undefined' && typeof StorageAPI.hasPlanner === 'function' && await StorageAPI.hasPlanner()) {
      const data = await StorageAPI.readPlanner();
      const newEvents = (data && Array.isArray(data.events)) ? data.events : [];
      
      const currentEvents = plannerEvents || [];
      if (currentEvents.length !== newEvents.length || JSON.stringify(currentEvents) !== JSON.stringify(newEvents)) {
        console.log('Planner file change detected on disk. Reloading...');
        await loadPlanner();
        _debouncedRenderPlanner();
      }
    }

    if (typeof StorageAPI !== 'undefined' && typeof StorageAPI.hasPlannerProposals === 'function' && await StorageAPI.hasPlannerProposals()) {
      const propData = await StorageAPI.readPlannerProposals();
      const propJSON = JSON.stringify(propData || {});
      if (propJSON !== _lastProposalsJSON) {
        const prevPendingCount = (Array.isArray(plannerProposals) ? plannerProposals : []).filter(p => p && p.status === 'pending').length;
        _lastProposalsJSON = propJSON;
        await loadPlannerProposals();
        const nextPendingCount = (Array.isArray(plannerProposals) ? plannerProposals : []).filter(p => p && p.status === 'pending').length;
        
        // Anti-spam toast rate limiter (at most once every 5 seconds)
        if (nextPendingCount > prevPendingCount && (now - _lastProposalsToastAt >= 5000) && typeof toast === 'function') {
          _lastProposalsToastAt = now;
          toast(t('planner.proposalsDetected'));
        }
        if (isPlannerActive) {
          _debouncedRenderPlanner();
        }
      }
    }
  } catch (err) {
    console.warn('Failed to check planner updates from disk', err);
  } finally {
    _isPlannerRefreshing = false;
  }
}

window.addEventListener('focus', () => {
  if (typeof activeTab !== 'undefined' && activeTab === 'planner') {
    checkPlannerRefresh();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && typeof activeTab !== 'undefined' && activeTab === 'planner') {
    checkPlannerRefresh();
  }
});

setInterval(() => {
  if (typeof activeTab !== 'undefined' && activeTab === 'planner') {
    checkPlannerRefresh();
  }
}, 5000);

// Global Keyboard Shortcuts for Planner
document.addEventListener('keydown', (e) => {
  if (typeof activeTab === 'undefined' || activeTab !== 'planner') return;
  
  // Ignore if user is typing inside an input field
  const tag = (e.target.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;
  
  const isMeta = e.metaKey || e.ctrlKey;

  // Duplicate (Cmd+D)
  if (isMeta && e.key.toLowerCase() === 'd') {
    e.preventDefault();
    duplicatePlannerSelectedEvent();
    return;
  }

  // Time Nudge (Cmd+Up / Cmd+Down)
  if (isMeta && e.key === 'ArrowUp') {
    e.preventDefault();
    nudgePlannerSelectedEventTime(-15);
    return;
  }
  if (isMeta && e.key === 'ArrowDown') {
    e.preventDefault();
    nudgePlannerSelectedEventTime(15);
    return;
  }

  // Day Shift (Cmd+Left / Cmd+Right)
  if (isMeta && e.key === 'ArrowLeft') {
    e.preventDefault();
    shiftPlannerSelectedEventDay(-1);
    return;
  }
  if (isMeta && e.key === 'ArrowRight') {
    e.preventDefault();
    shiftPlannerSelectedEventDay(1);
    return;
  }

  // Delete event (Delete / Backspace)
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selectedPlannerEventId) {
      e.preventDefault();
      deletePlannerEventWithDissolve(selectedPlannerEventId);
      return;
    }
  }

  // Toggle Keyboard HUD Bar (?)
  if (e.key === '?' || e.key.toLowerCase() === 'h') {
    e.preventDefault();
    togglePlannerHudOverlay();
    return;
  }

  // Undo / Redo
  if (isMeta && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) {
      redoPlannerAction();
    } else {
      undoPlannerAction();
    }
    return;
  }
  
  if (isMeta && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    redoPlannerAction();
    return;
  }
  
  // Navigation & View switches
  if (e.key.toLowerCase() === 't') {
    e.preventDefault();
    navigatePlannerWeek(0);
  } else if (e.key.toLowerCase() === 'w') {
    e.preventDefault();
    setPlannerViewMode('week');
  } else if (e.key === '3') {
    e.preventDefault();
    setPlannerViewMode('3days');
  } else if (e.key === '5') {
    e.preventDefault();
    setPlannerViewMode('5days');
  } else if (e.key.toLowerCase() === 'n') {
    e.preventDefault();
    openPlanEventModal();
  }
});

window.removePlannerCreatePreview = removePlannerCreatePreview;
window.syncPlannerModalCreationPreview = syncPlannerModalCreationPreview;
window.updateOrCreatePlannerCreationPreview = updateOrCreatePlannerCreationPreview;
window.renderPlannerEventsForDayHTML = renderPlannerEventsForDayHTML;

// Proposals window exports
window.plannerProposals = plannerProposals;
window.showPlannerProposals = showPlannerProposals;
window.getPlannerProposals = getPlannerProposals;
window.setPlannerProposals = setPlannerProposals;
window.parsePlannerDuration = parsePlannerDuration;
window.normalizePlannerProposals = normalizePlannerProposals;
window.loadPlannerProposals = loadPlannerProposals;
window.persistPlannerProposals = persistPlannerProposals;
window.togglePlannerProposalsView = togglePlannerProposalsView;
window.openPlanEventModalFromProposal = openPlanEventModalFromProposal;
window.quickAcceptPlannerProposal = quickAcceptPlannerProposal;
window.dismissPlannerProposal = dismissPlannerProposal;
window.markPlannerProposalAccepted = markPlannerProposalAccepted;

// ═══ Upcoming Event Desktop Reminders ═══
const PlannerReminderEngine = {
  notifiedEventIds: new Set(),
  checkInterval: null,

  start() {
    if (this.checkInterval) return;
    this.checkUpcomingEvents();
    this.checkInterval = setInterval(() => this.checkUpcomingEvents(), 60000);
  },

  checkUpcomingEvents() {
    if (typeof plannerEvents === 'undefined' || !Array.isArray(plannerEvents)) return;
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const todayStr = `${y}-${m}-${d}`;
    const currentMins = now.getHours() * 60 + now.getMinutes();

    plannerEvents.forEach(evt => {
      if (!evt || evt.date !== todayStr || !evt.startTime || evt.allDay) return;
      if (this.notifiedEventIds.has(evt.id)) return;

      const [h, m] = evt.startTime.split(':').map(Number);
      if (isNaN(h) || isNaN(m)) return;
      const startMins = h * 60 + m;
      const diffMins = startMins - currentMins;

      if (diffMins > 0 && diffMins <= 10) {
        this.notifiedEventIds.add(evt.id);
        if (window.AppBridge?.notifications?.show) {
          const bodyText = `${evt.title || 'Event'} starts at ${evt.startTime} (${diffMins}m)`;
          window.AppBridge.notifications.show(typeof t === 'function' ? (t('planner.upcomingMeetingNotification') || 'Upcoming Event') : 'Upcoming Event', {
            body: bodyText
          });
        }
      }
    });
  }
};
window.PlannerReminderEngine = PlannerReminderEngine;

if (typeof window !== 'undefined') {
  setTimeout(() => {
    try { PlannerReminderEngine.start(); } catch (e) {}
  }, 3000);
}


