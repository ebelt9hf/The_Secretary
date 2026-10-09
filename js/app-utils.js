// ── Secretary: Utils ──
function cleanTaskTitleText(str = '') {
  if (typeof str !== 'string') return '';
  let clean = str;
  // Remove HTML tags
  clean = clean.replace(/<[^>]*>/g, '');
  // Remove leading markdown bullet point markers / checkbox markers (e.g. "- [ ] ", "* [x] ", "1. ")
  clean = clean.replace(/^[-*•\d+\.]+\s*/, '').replace(/^\[[ xX]?\]\s*/, '').trim();
  // Remove "todo urgency: High/Medium/Low" labels
  clean = clean.replace(/todo\s*urgency:\s*(?:High|Medium|Low|WIP|Done|Q[1-4])*/gi, '');
  clean = clean.replace(/^todo\s+urgency:\s*/gi, '');
  // Remove importance/urgency emoji badges (⚡ High, ⏳ Medium, ⚡ Q1, etc.)
  clean = clean.replace(/⚡\s*(?:High|Medium|Low|Q[1-4]|Done|WIP)?/gi, '');
  clean = clean.replace(/⏳\s*(?:High|Medium|Low|Q[1-4]|Done|WIP)?/gi, '');
  // Remove owner emoji badges (👤 @Sarah, 👤 Sarah, etc.)
  clean = clean.replace(/👤\s*@?[\p{L}\p{N}_\-]+/giu, '');
  // Remove key-value metadata prefixes (e.g. Importance: High, Assignee: @Alex, Owner: Sarah)
  clean = clean.replace(/\b(Importance|Urgency|Owner|Priority|Assignee):\s*@?\S+/gi, '');
  // Remove bracketed urgency tags like [Urgent], [High], [Medium]
  clean = clean.replace(/\[\s*(?:urgent|high|medium|low|critical|asap|\w+\s+urgency|\w+\s+priority)\s*\]/gi, '');
  // Remove repeated priority / urgency prefix tokens (e.g. "Medium Medium Etienne ...", "High High Sarah ...", "High Medium ...", "Medium Low ...")
  clean = clean.replace(/^(?:(?:High|Medium|Low|WIP|Done|Q[1-4])\s+){2,}(?:@?[\p{L}\p{N}_\-]+\s+)?/iu, '');
  // Remove single priority token followed by colleague name or @mention or username when followed by actual title
  clean = clean.replace(/^(?:(?:High|Medium|Low|WIP|Done|Q[1-4])\s+)(?:👤\s*|@)?([\p{L}\p{N}_\-]+)\s+(?=[A-Za-zÀ-ÖØ-öø-ÿ0-9])/iu, (match, possibleName) => {
    if (typeof isUserCollaborator === 'function' && isUserCollaborator(possibleName)) return '';
    if (typeof colleaguesManifest !== 'undefined' && Array.isArray(colleaguesManifest) && colleaguesManifest.some(c => c && (c.name?.toLowerCase() === possibleName.toLowerCase() || c.id?.toLowerCase() === possibleName.toLowerCase()))) return '';
    if (typeof manifest !== 'undefined' && Array.isArray(manifest) && manifest.some(n => (n.topic_tags || []).some(t => t && t.toLowerCase() === possibleName.toLowerCase()))) return '';
    if (/^[A-ZÀ-ÖØ-öø-ÿ]/.test(possibleName)) return '';
    return match;
  });
  // Remove leading @Colleague mentions
  clean = clean.replace(/^@[\p{L}\p{N}_\-]+\s*:?\s*/iu, '');
  // Remove any remaining inline @Colleague mentions
  clean = clean.replace(/@[\p{L}\p{N}_\-]+/gu, '').trim();
  // Remove remaining leading badge icons or colons
  clean = clean.replace(/^[⚡⏳👤\s:]+/, '');
  // Clean up duplicate spaces
  clean = clean.replace(/\s+/g, ' ').trim();
  return clean;
}
if (typeof globalThis !== 'undefined') globalThis.cleanTaskTitleText = cleanTaskTitleText;
if (typeof window !== 'undefined') window.cleanTaskTitleText = cleanTaskTitleText;

function isUserCollaborator(name) {
  if (!name) return true; // empty owner means "me"
  const cleanName = String(name || '').trim();
  if (!cleanName) return true;
  if (cleanName.toLowerCase() === 'me') return true;
  if (typeof getColleagueLabelById === 'function') {
    const meLabel = String(getColleagueLabelById('me', '') || '').trim().toLowerCase();
    if (meLabel && cleanName.toLowerCase() === meLabel) return true;
  }
  if (typeof settings !== 'undefined' && settings && settings.username) {
    const username = settings.username.trim().toLowerCase();
    if (username && cleanName.toLowerCase() === username) return true;
  }
  return false;
}

function getTodoOwnerId(todo) {
  if (!todo || typeof todo !== 'object') return 'me';
  const raw = String(todo.ownerId || todo.owner || 'me').trim() || 'me';
  if (typeof resolveColleagueId === 'function') {
    const resolved = resolveColleagueId(raw, { allowCreate: false, allowMe: true });
    if (resolved) return resolved;
  }
  return raw;
}

function getTodoOwnerLabel(todo) {
  const ownerId = getTodoOwnerId(todo);
  if (typeof getColleagueLabelById === 'function') {
    return getColleagueLabelById(ownerId, ownerId === 'me' ? ((settings && settings.username) || 'Me') : String(todo?.owner || '').trim());
  }
  return String(todo?.owner || '').trim() || (ownerId === 'me' ? ((settings && settings.username) || 'Me') : ownerId);
}

function getTodoAskedById(todo) {
  if (!todo || typeof todo !== 'object' || !todo.askedById) return '';
  if (typeof resolveColleagueId === 'function') {
    return resolveColleagueId(todo.askedById, { allowCreate: false, allowMe: true }) || '';
  }
  return String(todo.askedById).trim() || '';
}

function getTodoAskedByLabel(todo) {
  const askedById = getTodoAskedById(todo);
  if (!askedById) return '';
  if (typeof getColleagueLabelById === 'function') {
    return getColleagueLabelById(askedById, askedById === 'me' ? ((settings && settings.username) || 'Me') : askedById);
  }
  return askedById === 'me' ? ((settings && settings.username) || 'Me') : askedById;
}

function isUserTask(todo) {
  if (!todo) return false;
  return isUserCollaborator(getTodoOwnerId(todo));
}
function isSameCollaborator(nameA, nameB) {
  const cleanA = String(nameA || '').trim();
  const cleanB = String(nameB || '').trim();
  if (!cleanA && !cleanB) return true;
  if (typeof resolveColleagueId === 'function') {
    const idA = resolveColleagueId(cleanA, { allowCreate: false, allowMe: true }) || '';
    const idB = resolveColleagueId(cleanB, { allowCreate: false, allowMe: true }) || '';
    if (idA && idB) return idA === idB;
  }
  const lowA = cleanA.toLowerCase();
  const lowB = cleanB.toLowerCase();
  if (lowA === lowB) return true;
  if (isUserCollaborator(lowA) && isUserCollaborator(lowB)) return true;
  return false;
}

function getTodoById(id)        { return todosManifest.find(t => t.id === id); }
function getTodosByPriority(p)  { return todosManifest.filter(t => t.priority === p); }
function getTodosByStatus(status) { return todosManifest.filter(t => t.status === status); }
function isTodoWip(todo)       { return !!todo && (todo.status === 'WIP' || todo.priority === 'WIP'); }
function getTodoEffectivePriority(todo) {
  const priority = todo?.priority || 'Medium';
  if (priority === 'WIP') {
    const original = todo?.originalPriority;
    return original && original !== 'WIP' ? original : 'Medium';
  }
  return priority;
}

const EISENHOWER_QUADRANTS = {
  Q1: { id: 'Q1', key: 'q1', shortKey: 'q1Short', color: '#ef4444', bg: 'color-mix(in srgb, #ef4444 10%, var(--card-bg))', text: 'var(--color-high-text)', defaultX: 25, defaultY: 25, priority: 'High' },
  Q2: { id: 'Q2', key: 'q2', shortKey: 'q2Short', color: '#f59e0b', bg: 'color-mix(in srgb, #f59e0b 10%, var(--card-bg))', text: 'var(--color-medium-text)', defaultX: 75, defaultY: 25, priority: 'Medium' },
  Q3: { id: 'Q3', key: 'q3', shortKey: 'q3Short', color: '#6366f1', bg: 'color-mix(in srgb, #6366f1 10%, var(--card-bg))', text: 'var(--color-wip-text)', defaultX: 25, defaultY: 75, priority: 'Low' },
  Q4: { id: 'Q4', key: 'q4', shortKey: 'q4Short', color: '#14b8a6', bg: 'color-mix(in srgb, #14b8a6 10%, var(--card-bg))', text: 'var(--color-low-text)', defaultX: 75, defaultY: 75, priority: 'Low' },
};

const EisenhowerUtils = {
  QUADRANTS: EISENHOWER_QUADRANTS,
  MIN_SCATTER_PCT: 6,
  MAX_SCATTER_PCT: 94,
  QUADRANT_MIDPOINT: 50,
  
  getQuadrant(todo) {
    if (!todo) return 'Q2';
    if (['Q1', 'Q2', 'Q3', 'Q4'].includes(todo.eisenhowerQuadrant)) return todo.eisenhowerQuadrant;
    if (typeof isAskedByManagerChain === 'function' && isAskedByManagerChain(todo)) return 'Q2';
    const prio = (todo.priority === 'Done' && todo.originalPriority && todo.originalPriority !== 'Done' && todo.originalPriority !== 'WIP') ? todo.originalPriority : todo.priority;
    if (prio === 'High') return 'Q1';
    if (prio === 'Medium') return 'Q2';
    if (prio === 'Low') return 'Q3';
    return 'Q2';
  },

  getPriorityForQuadrant(quadrant) {
    if (quadrant === 'Q1') return 'High';
    if (quadrant === 'Q2') return 'Medium';
    return 'Low';
  },

  getQuadrantFromCoords(pctX, pctY) {
    const isUrgent = pctX < 50;
    const isImportant = pctY < 50;
    if (isUrgent && isImportant) return 'Q1';
    if (!isUrgent && isImportant) return 'Q2';
    if (isUrgent && !isImportant) return 'Q3';
    return 'Q4';
  },

  getDefaultCoordsForQuadrant(quadrant, todoId = '') {
    const meta = EISENHOWER_QUADRANTS[quadrant] || EISENHOWER_QUADRANTS.Q2;
    let base = { x: meta.defaultX, y: meta.defaultY };
    
    // Deterministic jitter based on todoId hash to prevent exact overlap
    if (todoId) {
      let hash = 0;
      for (let i = 0; i < todoId.length; i++) {
        hash = (hash << 5) - hash + todoId.charCodeAt(i);
        hash |= 0;
      }
      const dx = ((Math.abs(hash) % 17) - 8) * 1.2; // -9.6% to +9.6% jitter
      const dy = ((Math.abs(hash >> 3) % 17) - 8) * 1.2;
      base.x = Math.max(EisenhowerUtils.MIN_SCATTER_PCT + 8, Math.min(EisenhowerUtils.MAX_SCATTER_PCT - 8, base.x + dx));
      base.y = Math.max(EisenhowerUtils.MIN_SCATTER_PCT + 8, Math.min(EisenhowerUtils.MAX_SCATTER_PCT - 8, base.y + dy));
    }
    return base;
  },

  parseQuadrantTag(tag) {
    const q = String(tag || '').trim().toUpperCase();
    if (q === 'Q1' || q === 'HIGH') return { quadrant: 'Q1', priority: 'High' };
    if (q === 'Q2' || q === 'MEDIUM' || q === 'MED') return { quadrant: 'Q2', priority: 'Medium' };
    if (q === 'Q3' || q === 'LOW') return { quadrant: 'Q3', priority: 'Low' };
    if (q === 'Q4') return { quadrant: 'Q4', priority: 'Low' };
    return { quadrant: 'Q2', priority: 'Medium' };
  },

  cleanTaskTitle(todo) {
    if (!todo) return '';
    const raw = (typeof todo === 'string') ? todo : (todo.title || todo.id || '');
    return cleanTaskTitleText(raw) || (typeof todo === 'object' ? todo.id : raw);
  }
};
window.EisenhowerUtils = EisenhowerUtils;

function isAskedByManagerChain(todo) {
  if (!todo || !todo.askedBy) return false;
  if (typeof getColleagueManagerChain !== 'function') return false;
  const askedById = (typeof getTodoAskedById === 'function') ? getTodoAskedById(todo) : todo.askedBy;
  if (!askedById) return false;
  const chain = getColleagueManagerChain('me');
  return chain.includes(askedById);
}

function getTodoQuadrant(todo) {
  return EisenhowerUtils.getQuadrant(todo);
}

function getTodosByQuadrant(q) {
  if (typeof todosManifest === 'undefined' || !Array.isArray(todosManifest)) return [];
  return todosManifest.filter(t => t && t.priority !== 'Done' && getTodoQuadrant(t) === q);
}

function getTodoPlannerAssociations(todoId) {
  const result = { workSessions: [], meetings: [] };
  if (!todoId || typeof plannerEvents === 'undefined' || !Array.isArray(plannerEvents)) return result;
  const targetId = String(todoId).trim();
  for (const ev of plannerEvents) {
    if (!ev) continue;
    const isPrimary = String(ev.todoId || '').trim() === targetId;
    const isLinked = Array.isArray(ev.linkedTodoIds) && ev.linkedTodoIds.some(id => String(id).trim() === targetId);
    if (!isPrimary && !isLinked) continue;

    const titleLower = String(ev.title || '').toLowerCase();
    const isMeetingLike = ev.type === 'meeting' || ev.type === 'sync' || ev.type === 'call' || Boolean(ev.withWhom) || /sync|meeting|call|point|réunion/i.test(titleLower);
    if (isMeetingLike) {
      result.meetings.push(ev);
    } else {
      result.workSessions.push(ev);
    }
  }
  return result;
}

function getTodoDueDateInfo(todo) {
  const dueDate = formatLocalDateValue(todo?.dueDate || '');
  if (!dueDate) return null;

  const due = parseLocalDateValue(dueDate);
  const today = parseLocalDateValue(new Date());
  if (!due || !today) return null;

  const dayMs = 24 * 60 * 60 * 1000;
  const daysUntil = Math.round((due.getTime() - today.getTime()) / dayMs);
  const absDays = Math.abs(daysUntil);
  const useWeeks = absDays > 14;
  const qty = useWeeks ? Math.ceil(absDays / 7) : absDays;
  const unit = useWeeks ? 'w' : 'd';
  const bracket = daysUntil < 0 ? `[-${qty}${unit}]` : `[${qty}${unit}]`;

  let urgencyClass = 'due-normal';
  if (daysUntil < 0) urgencyClass = 'due-overdue';
  else if (daysUntil <= 2) urgencyClass = 'due-urgent';
  else if (daysUntil <= 7) urgencyClass = 'due-soon';

  return {
    date: dueDate,
    daysUntil,
    bracket,
    urgencyClass,
    sortValue: due.getTime(),
  };
}

function refreshTodoViews() {
  if (typeof renderBoard === 'function') renderBoard();
  if (activeTab === 'planner' && typeof renderPlanner === 'function') renderPlanner();
  if (activeTab === 'team' && typeof renderTeamPanel === 'function') renderTeamPanel();
  if (activeTab === 'retro' && typeof renderRetroPanel === 'function') renderRetroPanel();

  const overlay = document.getElementById('todo-edit-overlay');
  if (overlay && overlay.style.display !== 'none' && typeof _todoOverlayFile !== 'undefined' && _todoOverlayFile) {
    if (typeof openTodoOverlay === 'function') {
      openTodoOverlay(_todoOverlayFile);
    }
  }
}

function compareTodosByDueDate(a, b) {
  const ad = getTodoDueDateInfo(a);
  const bd = getTodoDueDateInfo(b);
  const av = ad ? ad.sortValue : Number.MAX_SAFE_INTEGER;
  const bv = bd ? bd.sortValue : Number.MAX_SAFE_INTEGER;
  if (av !== bv) return av - bv;

  const priorityRank = { High: 1, Medium: 2, Low: 3, Done: 4 };
  const ap = priorityRank[a?.priority] || 99;
  const bp = priorityRank[b?.priority] || 99;
  if (ap !== bp) return ap - bp;

  return String(a?.title || a?.id || '').localeCompare(String(b?.title || b?.id || ''));
}

function telemetryIncrement(scope, key, amount = 1) {
  if (!perfTelemetry || !perfTelemetry[scope]) return;
  perfTelemetry[scope][key] = Number(perfTelemetry[scope][key] || 0) + amount;
}

function lruGet(cacheMap, key, { hitScope = null, hitKey = null, missKey = null } = {}) {
  if (!(cacheMap instanceof Map)) return undefined;
  if (!cacheMap.has(key)) {
    if (hitScope && missKey) telemetryIncrement(hitScope, missKey, 1);
    return undefined;
  }
  const value = cacheMap.get(key);
  cacheMap.delete(key);
  cacheMap.set(key, value);
  if (hitScope && hitKey) telemetryIncrement(hitScope, hitKey, 1);
  return value;
}

function lruSet(cacheMap, key, value, limit) {
  if (!(cacheMap instanceof Map)) return;
  if (cacheMap.has(key)) cacheMap.delete(key);
  cacheMap.set(key, value);
  while (cacheMap.size > limit) {
    const oldestKey = cacheMap.keys().next().value;
    cacheMap.delete(oldestKey);

    // Keep legacy object caches aligned with LRU eviction bounds.
    if (cacheMap === htmlLRUCache && noteContentCache && Object.prototype.hasOwnProperty.call(noteContentCache, oldestKey)) {
      delete noteContentCache[oldestKey];
    }
    if (cacheMap === previewLRUCache && notePreviewCache && Object.prototype.hasOwnProperty.call(notePreviewCache, oldestKey)) {
      delete notePreviewCache[oldestKey];
    }
    if (cacheMap === collabLRUCache && collaborativeDataCache && Object.prototype.hasOwnProperty.call(collaborativeDataCache, oldestKey)) {
      delete collaborativeDataCache[oldestKey];
    }
  }
}
// ═══ Toast ═══
let _toastTimer;
function toast(msg, isError = false) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}
if (typeof window !== 'undefined') {
  if (!window.toast) {
    window.toast = toast;
  }
  window.showToast = function(msg, isError = false) {
    if (typeof window.toast === 'function') {
      window.toast(msg, isError);
    } else {
      toast(msg, isError);
    }
  };
}

function safeToast(msg, isError = false) {
  if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
    window.showToast(msg, isError);
  } else if (typeof showToast === 'function') {
    showToast(msg, isError);
  } else if (typeof toast === 'function') {
    toast(msg, isError);
  } else if (typeof window !== 'undefined' && typeof window.toast === 'function') {
    window.toast(msg, isError);
  } else {
    console.warn('[Toast]', msg);
  }
}
if (typeof globalThis !== 'undefined') globalThis.safeToast = safeToast;
if (typeof window !== 'undefined') window.safeToast = safeToast;

function setElementLoadingState(element, isLoading, loadingText = '') {
  if (!element) return;
  if (isLoading) {
    if (element._origHtml === undefined) element._origHtml = element.innerHTML;
    element.disabled = true;
    element.style.opacity = '0.7';
    element.style.pointerEvents = 'none';
    element.classList.add('loading');
    if (loadingText) element.textContent = loadingText;
  } else {
    element.disabled = false;
    element.style.opacity = '';
    element.style.pointerEvents = '';
    element.classList.remove('loading');
    if (element._origHtml !== undefined) {
      element.innerHTML = element._origHtml;
      delete element._origHtml;
    }
  }
}
if (typeof globalThis !== 'undefined') globalThis.setElementLoadingState = setElementLoadingState;
if (typeof window !== 'undefined') window.setElementLoadingState = setElementLoadingState;

function normalizeNoteId(input) {
  if (!input) return '';
  if (typeof input === 'object') {
    if (input.id) return normalizeNoteId(input.id);
    if (input.path) return normalizeNoteId(input.path);
    return '';
  }
  return String(input)
    .replace(/\\/g, '/')
    .trim()
    .replace(/^notes\//i, '')
    .replace(/\.html$/i, '');
}
if (typeof globalThis !== 'undefined') globalThis.normalizeNoteId = normalizeNoteId;
if (typeof window !== 'undefined') window.normalizeNoteId = normalizeNoteId;

function normalizeNotePath(input) {
  if (!input) return '';
  if (typeof input === 'object') {
    if (input.path) return normalizeNotePath(input.path);
    if (input.id) return normalizeNotePath(input.id);
    return '';
  }
  const clean = String(input).replace(/\\/g, '/').trim();
  if (!clean) return '';
  const cleanId = clean.replace(/^notes\//i, '').replace(/\.html$/i, '');
  return cleanId ? `notes/${cleanId}.html` : '';
}
if (typeof globalThis !== 'undefined') globalThis.normalizeNotePath = normalizeNotePath;
if (typeof window !== 'undefined') window.normalizeNotePath = normalizeNotePath;


// Show a toast with an action button (e.g., Undo). actionFn may be async. duration in ms (default 7000).
function toastAction(msg, actionLabel, actionFn, duration = 7000) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = msg;
  span.style.marginRight = '12px';
  const btn = document.createElement('button');
  btn.className = 'toast-action-btn';
  btn.textContent = actionLabel;
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    try { await actionFn(); } catch(err) { console.warn(err); }
    clearTimeout(_toastTimer);
    el.classList.remove('show');
  });
  el.appendChild(span);
  el.appendChild(btn);
  el.className = 'toast show';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}
// ═══ String helpers ═══
function escH(s)  { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escA(s)  { return escH(s).replace(/'/g,'&#39;'); }
// jq: JSON.stringify a value for safe use inside an HTML attribute (e.g. onclick="fn(jq(val))")
function jq(val)  { return JSON.stringify(val).replace(/"/g,'&quot;'); }

// Button label helpers: return HTML for vector icon + escaped label text
function btnLabel(icon, key, fallback) {
  const raw = (typeof t === 'function' && key) ? (t(key) || fallback || '') : (fallback || '');
  const iconText = String(icon || '').trim();
  let txt = String(raw || '').trim();

  // Strip leading emoji from translated string if present
  txt = txt.replace(/^[\u{10000}-\u{10ffff}\u2600-\u27ff\u2300-\u23ff\u2b50\u2b55\ufe0f\u200d✓✔✕✗★☆]+\s*/u, '').trim();

  let renderedIcon = iconText;
  if (typeof AppIcons !== 'undefined' && iconText) {
    if (AppIcons.has(iconText) || AppIcons.EMOJI_MAP[iconText] || AppIcons.ICONS[iconText]) {
      renderedIcon = `<span class="ui-icon-wrap">${AppIcons.get(iconText, { size: 15 })}</span>`;
    }
  }

  return `${renderedIcon} <span class="planner-ctx-text">${escH(txt)}</span>`;
}

function newBtnLabel(icon, key, fallback) {
  return btnLabel(icon, key, fallback);
}

function parseLocalDateValue(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (isNaN(value)) return null;
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const str = String(value).trim();
  if (!str) return null;
  const ymd = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) {
    const year = parseInt(ymd[1], 10);
    const month = parseInt(ymd[2], 10) - 1;
    const day = parseInt(ymd[3], 10);
    const localDate = new Date(year, month, day);
    if (isNaN(localDate) ||
        localDate.getFullYear() !== year ||
        localDate.getMonth() !== month ||
        localDate.getDate() !== day) {
      return null;
    }
    return localDate;
  }
  const parsed = new Date(str);
  if (isNaN(parsed)) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function formatLocalDateValue(value) {
  const d = parseLocalDateValue(value);
  if (!d) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getStartOfDay(date = new Date()) {
  const d = parseLocalDateValue(date) || (date instanceof Date ? date : new Date(date));
  if (!d || isNaN(d)) return new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isSameDay(d1, d2) {
  const f1 = formatLocalDateValue(d1);
  const f2 = formatLocalDateValue(d2);
  return !!f1 && f1 === f2;
}

function addDays(date, days) {
  const start = getStartOfDay(date);
  start.setDate(start.getDate() + days);
  return start;
}

function debounce(fn, wait = 250) {
  let timeout;
  return function (...args) {
    const context = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(context, args), wait);
  };
}

function throttle(fn, limit = 250) {
  let inThrottle = false;
  return function (...args) {
    const context = this;
    if (!inThrottle) {
      fn.apply(context, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

function el(tag, props = {}, children = []) {
  const element = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (key === 'className' || key === 'class') {
        element.className = value;
      } else if (key === 'style' && typeof value === 'object') {
        Object.assign(element.style, value);
      } else if (key === 'style' && typeof value === 'string') {
        element.style.cssText = value;
      } else if (key.startsWith('on') && typeof value === 'function') {
        const eventName = key.slice(2).toLowerCase();
        element.addEventListener(eventName, value);
      } else if (key === 'dataset' && typeof value === 'object') {
        Object.assign(element.dataset, value);
      } else if (key === 'textContent' || key === 'innerText') {
        element.textContent = value;
      } else if (key === 'innerHTML') {
        element.innerHTML = value;
      } else if (value !== false && value != null) {
        element.setAttribute(key, value === true ? '' : value);
      }
    }
  }
  const childArray = Array.isArray(children) ? children : [children];
  for (const child of childArray) {
    if (child == null || child === false) continue;
    if (typeof child === 'string' || typeof child === 'number') {
      element.appendChild(document.createTextNode(String(child)));
    } else if (child instanceof Node) {
      element.appendChild(child);
    }
  }
  return element;
}

function showCustomModal({ title, body, actions = [], zIndex = 3000, width = '360px', onClose = null }) {
  return new Promise(resolve => {
    const overlay = el('div', { className: 'dialog-overlay', style: { zIndex } });
    const box = el('div', { className: 'dialog-box', style: width ? { width, maxWidth: '95vw' } : {} });

    if (title) {
      box.appendChild(el('div', { className: 'dialog-message', style: { fontWeight: 'bold', marginBottom: '12px' } }, title));
    }

    if (body) {
      if (typeof body === 'string') {
        box.appendChild(el('div', { className: 'dialog-body', innerHTML: body }));
      } else if (body instanceof Node) {
        box.appendChild(body);
      }
    }

    const actionsContainer = el('div', { className: 'dialog-actions', style: { marginTop: '16px' } });

    const cleanup = (result) => {
      document.removeEventListener('keydown', keyHandler);
      overlay.remove();
      if (typeof onClose === 'function') onClose(result);
      resolve(result);
    };

    if (Array.isArray(actions) && actions.length > 0) {
      actions.forEach(action => {
        const btnTitle = action.title || (typeof t === 'function' ? (action.isPrimary ? t('common.saveTooltip') : (action.isDanger ? t('common.delete') : t('common.cancelTooltip'))) : (action.label || 'Action'));
        const btn = el('button', {
          className: action.className || (action.isPrimary ? 'btn btn-save' : action.isDanger ? 'btn btn-danger' : 'btn'),
          textContent: action.label || 'OK',
          title: btnTitle,
          onClick: async (e) => {
            e.stopPropagation();
            let res = action.value !== undefined ? action.value : action.label;
            if (typeof action.onClick === 'function') {
              const handlerRes = await action.onClick(e, box);
              if (handlerRes === false) return;
              if (handlerRes !== undefined) res = handlerRes;
            }
            cleanup(res);
          }
        });
        actionsContainer.appendChild(btn);
      });
    } else {
      const okBtn = el('button', {
        className: 'btn btn-save',
        textContent: typeof t === 'function' ? t('common.ok') : 'OK',
        title: typeof t === 'function' ? t('common.closeTooltip') : 'OK',
        onClick: () => cleanup(true)
      });
      actionsContainer.appendChild(okBtn);
    }

    box.appendChild(actionsContainer);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const firstInput = box.querySelector('input, select, textarea, button');
    if (firstInput) firstInput.focus();

    const keyHandler = e => {
      if (e.key === 'Escape') {
        cleanup(null);
      }
    };
    document.addEventListener('keydown', keyHandler);

    overlay.addEventListener('click', e => {
      if (e.target === overlay) {
        cleanup(null);
      }
    });
  });
}

function getReviewedDailyReviewDates() {
  const reviewedDates = settings?.ui?.reviewedDates;
  if (!Array.isArray(reviewedDates)) return new Set();
  return new Set(reviewedDates.map(dateStr => formatLocalDateValue(dateStr)).filter(Boolean));
}

function isDateCoveredByOoo(dateStr, events = null) {
  const normalizedDate = typeof formatLocalDateValue === 'function' ? formatLocalDateValue(dateStr) : String(dateStr || '').slice(0, 10);
  if (!normalizedDate) return false;
  const list = Array.isArray(events) ? events : (typeof plannerEvents !== 'undefined' && Array.isArray(plannerEvents) ? plannerEvents : []);
  return list.some(ev => {
    if (!ev || ev.type !== 'ooo') return false;
    const start = ev.date || '';
    const end = ev.endDate || ev.date || '';
    if (ev.allDay || (!ev.startTime && !ev.endTime)) {
      return normalizedDate >= start && normalizedDate <= end;
    }
    return false;
  });
}

function getCoveringOooEvent(dateStr, events = null) {
  const normalizedDate = typeof formatLocalDateValue === 'function' ? formatLocalDateValue(dateStr) : String(dateStr || '').slice(0, 10);
  if (!normalizedDate) return null;
  const list = Array.isArray(events) ? events : (typeof plannerEvents !== 'undefined' && Array.isArray(plannerEvents) ? plannerEvents : []);
  return list.find(ev => {
    if (!ev || ev.type !== 'ooo') return false;
    const start = ev.date || '';
    const end = ev.endDate || ev.date || '';
    if (ev.allDay || (!ev.startTime && !ev.endTime)) {
      return normalizedDate >= start && normalizedDate <= end;
    }
    return false;
  }) || null;
}

function isDailyReviewDateReviewed(dateStr) {
  const normalizedDate = formatLocalDateValue(dateStr);
  if (!normalizedDate) return false;

  // A day that is OOO is automatically reviewed
  if (isDateCoveredByOoo(normalizedDate)) return true;

  // Do not mark the day being reviewed as reviewed/passed while the daily review is active
  if (typeof DailyReviewController !== 'undefined' && DailyReviewController.currentStep > 0) {
    if (normalizedDate === DailyReviewController.getReviewDateValue()) {
      return false;
    }
  }

  if (getReviewedDailyReviewDates().has(normalizedDate)) return true;

  const notesForDate = (typeof manifest !== 'undefined' ? manifest : []).filter(note => {
    return note && note.date === normalizedDate && !String(note.id || '').startsWith('retro-');
  });

  if (notesForDate.length === 0) return false;
  return notesForDate.every(note => !!note.reviewed);
}


function markDailyReviewDateReviewed(dateStr) {
  const normalizedDate = formatLocalDateValue(dateStr);
  if (!normalizedDate) return false;

  if (!settings.ui) settings.ui = {};
  const reviewedDates = Array.isArray(settings.ui.reviewedDates) ? settings.ui.reviewedDates.slice() : [];
  if (!reviewedDates.includes(normalizedDate)) {
    reviewedDates.push(normalizedDate);
    reviewedDates.sort();
    settings.ui.reviewedDates = reviewedDates;
    saveLocalSettings();
    if (typeof saveFolderSettingsDebounced === 'function') {
      saveFolderSettingsDebounced();
    }
    if (typeof renderPlanner === 'function') {
      renderPlanner();
    }
    return true;
  }
  return false;
}

function sanitizeFilename(text, max = 80) {
  return text.replace(/[\\/:*?"<>|]/g,'-').replace(/\s+/g,' ').trim().replace(/^[\s.\-]+|[\s.\-]+$/g,'').slice(0, max);
}
function slugify(text) {
  return text.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const element = document.createElement('a');
  element.setAttribute('href', url);
  element.setAttribute('download', filename);
  element.style.display = 'none';
  document.body.appendChild(element);
  element.click();
  document.body.removeChild(element);
  
  // Defer revocation to let the browser download manager retrieve the blob successfully
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 3000);
}



function getTodoClassForTag(tag) {
  if (!tag) return null;
  const s = String(tag).toLowerCase();
  if (!s.includes('todo')) return null;
  if (s.includes('high')) return 'todo-high';
  if (s.includes('med') || s.includes('medium')) return 'todo-med';
  if (s.includes('low')) return 'todo-low';
  return null;
}

// Safe JSON — escapes < > so manifest data can be safely embedded in inline script tags
function safeJSON(data) {
  return JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}
function pathToId(path) {
  return 'fp-' + path.replace(/[^a-zA-Z0-9]/g, '-');
}
function generateNoteId() {
  return `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
function getLabelField(type) {
  if (type === 'group') return 'group_tags';
  if (type === 'major') return 'major_topic_tags';
  return 'topic_tags';
}
function getLabelTypeTitle(type) {
  if (type === 'group') return t('week.group');
  if (type === 'major') return t('week.major');
  return t('week.topic');
}
function getCanonicalNotePath(noteOrId) {
  const id = typeof noteOrId === 'string' ? noteOrId : noteOrId?.id;
  const stem = sanitizeFilename(String(id || '')).trim() || generateNoteId();
  return `notes/${stem}.html`;
}
function colorForGroup(name) {
  let h = 0;
  const str = String(name || '');
  for (let i = 0; i < str.length; i++) {
    h = str.charCodeAt(i) + ((h << 5) - h);
    h = h & h;
  }
  const hue = Math.abs(h) % 360;
  const isDark = document.body && document.body.getAttribute('data-theme') === 'dark';
  if (isDark) {
    return {
      bg: `hsl(${hue}, 40%, 18%)`,
      text: `hsl(${hue}, 85%, 75%)`
    };
  }
  return {
    bg: `hsl(${hue}, 72%, 92%)`,
    text: `hsl(${hue}, 68%, 24%)`
  };
}

function hslWithAlpha(hsl, alpha) {
  const match = String(hsl || '').match(/^hsl\(\s*([0-9.]+)\s*,\s*([0-9.]+)%\s*,\s*([0-9.]+)%\s*\)$/i);
  if (!match) return hsl;
  return `hsl(${match[1]} ${match[2]}% ${match[3]}% / ${alpha})`;
}
let _knownTagsCache = null;
let _knownTagsCacheMeta = { manifest: null, manifestLen: 0, planner: null, plannerLen: 0, todos: null, todosLen: 0, topicIndex: null };

function invalidateKnownTagsCache() {
  _knownTagsCache = null;
}

function knownTagsForType(type) {
  const noteList = (typeof manifest !== 'undefined' && Array.isArray(manifest))
    ? manifest
    : (typeof window !== 'undefined' && Array.isArray(window.manifest) ? window.manifest : []);
  const plannerList = (typeof plannerEvents !== 'undefined' && Array.isArray(plannerEvents))
    ? plannerEvents
    : (typeof window !== 'undefined' && Array.isArray(window.plannerEvents) ? window.plannerEvents : []);
  const todoList = (typeof todosManifest !== 'undefined' && Array.isArray(todosManifest))
    ? todosManifest
    : (typeof window !== 'undefined' && Array.isArray(window.todosManifest) ? window.todosManifest : []);
  const topicCache = (typeof _topicMemoriesIndexCache !== 'undefined' && _topicMemoriesIndexCache)
    ? _topicMemoriesIndexCache
    : null;

  const isCacheValid = _knownTagsCache &&
    _knownTagsCacheMeta.manifest === noteList &&
    _knownTagsCacheMeta.manifestLen === noteList.length &&
    _knownTagsCacheMeta.planner === plannerList &&
    _knownTagsCacheMeta.plannerLen === plannerList.length &&
    _knownTagsCacheMeta.todos === todoList &&
    _knownTagsCacheMeta.todosLen === todoList.length &&
    _knownTagsCacheMeta.topicIndex === topicCache;

  if (isCacheValid && _knownTagsCache[type]) {
    return _knownTagsCache[type];
  }

  // Single high-performance pass over all data sources to establish truth sets
  const groupSet = new Set();
  const majorSet = new Set();
  const topicSet = new Set();
  const extraSet = new Set();

  for (let i = 0; i < noteList.length; i++) {
    const n = noteList[i];
    if (!n) continue;
    if (n.group_tags) {
      for (let j = 0; j < n.group_tags.length; j++) {
        const v = String(n.group_tags[j] || '').trim();
        if (v) groupSet.add(v);
      }
    }
    if (n.major_topic_tags) {
      for (let j = 0; j < n.major_topic_tags.length; j++) {
        const v = String(n.major_topic_tags[j] || '').trim();
        if (v) majorSet.add(v);
      }
    }
    if (n.topic_tags) {
      for (let j = 0; j < n.topic_tags.length; j++) {
        const v = String(n.topic_tags[j] || '').trim();
        if (v) topicSet.add(v);
      }
    }
    if (n.extra_tags) {
      for (let j = 0; j < n.extra_tags.length; j++) {
        const v = String(n.extra_tags[j] || '').trim();
        if (v) extraSet.add(v);
      }
    }
  }

  for (let i = 0; i < plannerList.length; i++) {
    const e = plannerList[i];
    if (!e) continue;
    if (e.group_tags) {
      for (let j = 0; j < e.group_tags.length; j++) {
        const v = String(e.group_tags[j] || '').trim();
        if (v) groupSet.add(v);
      }
    }
    if (e.major_topic_tags) {
      for (let j = 0; j < e.major_topic_tags.length; j++) {
        const v = String(e.major_topic_tags[j] || '').trim();
        if (v) majorSet.add(v);
      }
    }
    if (e.topic_tags) {
      for (let j = 0; j < e.topic_tags.length; j++) {
        const v = String(e.topic_tags[j] || '').trim();
        if (v) topicSet.add(v);
      }
    }
  }

  for (let i = 0; i < todoList.length; i++) {
    const t = todoList[i];
    if (!t) continue;
    if (t.group_tags) {
      for (let j = 0; j < t.group_tags.length; j++) {
        const v = String(t.group_tags[j] || '').trim();
        if (v) groupSet.add(v);
      }
    }
    if (t.major_topic_tags) {
      for (let j = 0; j < t.major_topic_tags.length; j++) {
        const v = String(t.major_topic_tags[j] || '').trim();
        if (v) majorSet.add(v);
      }
    }
    if (t.major_topic) {
      const v = String(t.major_topic || '').trim();
      if (v) majorSet.add(v);
    }
    if (t.topic_tags) {
      for (let j = 0; j < t.topic_tags.length; j++) {
        const v = String(t.topic_tags[j] || '').trim();
        if (v) topicSet.add(v);
      }
    }
  }

  // Include truth set from topic memories / workstreams
  if (topicCache?.topics && Array.isArray(topicCache.topics)) {
    for (let i = 0; i < topicCache.topics.length; i++) {
      const tm = topicCache.topics[i];
      if (!tm || tm.status === 'archived') continue;
      const tagGroups = tm.mappedTags?.tagGroups || [];
      for (let j = 0; j < tagGroups.length; j++) {
        const tg = tagGroups[j];
        if (!tg) continue;
        if (tg.group && tg.group !== '*') groupSet.add(String(tg.group).trim());
        if (tg.major && tg.major !== '*') majorSet.add(String(tg.major).trim());
        if (tg.topic && tg.topic !== '*') topicSet.add(String(tg.topic).trim());
      }
      (tm.mappedTags?.group_tags || []).forEach(g => g && g !== '*' && groupSet.add(String(g).trim()));
      (tm.mappedTags?.major_topic_tags || []).forEach(m => m && m !== '*' && majorSet.add(String(m).trim()));
      (tm.mappedTags?.topic_tags || []).forEach(t => t && t !== '*' && topicSet.add(String(t).trim()));
    }
  }

  _knownTagsCache = {
    group: Array.from(groupSet).sort((a, b) => a.localeCompare(b)),
    major: Array.from(majorSet).sort((a, b) => a.localeCompare(b)),
    topic: Array.from(topicSet).sort((a, b) => a.localeCompare(b)),
    extra: Array.from(extraSet).sort((a, b) => a.localeCompare(b))
  };

  _knownTagsCacheMeta = {
    manifest: noteList,
    manifestLen: noteList.length,
    planner: plannerList,
    plannerLen: plannerList.length,
    todos: todoList,
    todosLen: todoList.length,
    topicIndex: topicCache
  };

  return _knownTagsCache[type] || [];
}

/**
 * Normalizes, trims, and deduplicates a list or comma-separated string of tags.
 * @param {Array|Set|string} tags
 * @param {Object} [options]
 * @param {boolean} [options.toLowerCase=false] - Whether to lowercase all tags
 * @param {boolean} [options.dedupe=true] - Whether to case-insensitively deduplicate
 * @returns {string[]}
 */
function cleanTagList(tags, options = {}) {
  if (!tags) return [];
  const toLower = !!options.toLowerCase;
  const dedupe = options.dedupe !== false;
  let list;
  if (Array.isArray(tags) || tags instanceof Set) {
    list = Array.from(tags);
  } else if (typeof tags === 'string') {
    list = tags.includes(',') ? tags.split(',') : [tags];
  } else {
    list = [tags];
  }
  const result = [];
  const seen = new Set();
  for (const raw of list) {
    if (raw === null || raw === undefined) continue;
    let s = String(raw).trim();
    if (!s) continue;
    if (toLower) s = s.toLowerCase();
    const key = s.toLowerCase();
    if (dedupe) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    result.push(s);
  }
  return result;
}

/**
 * Merges multiple tag arrays, sets, or comma-separated strings into a clean, deduplicated array.
 * @param {...(Array|Set|string)} lists
 * @returns {string[]}
 */
function mergeTagLists(...lists) {
  const combined = [];
  for (const l of lists) {
    if (l) combined.push(...cleanTagList(l));
  }
  return cleanTagList(combined);
}

/**
 * Canonical normalization for comparing and cataloging workstreams.
 * Strips accents, lowercases, and converts spaces/dashes/symbols to clean underscores.
 * @param {string} name
 * @returns {string}
 */
function normalizeWorkstreamKey(name) {
  if (!name || typeof name !== 'string') return '';
  const clean = name.trim();
  if (!clean) return '';
  if (typeof sanitizeTopicMemoryKey === 'function') {
    const s = sanitizeTopicMemoryKey(clean);
    if (s) return s;
  }
  return clean
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\s\-_]+/g, '_')
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Extracts and consolidates all tag fields from a note, todo, or planner event entity.
 * Supports group_tags, major_topic_tags, topic_tags, extra_tags, other_tags, tags, and workstreams.
 * @param {Object} entity
 * @param {Object} [options]
 * @param {boolean} [options.includeWorkstreams=true]
 * @returns {string[]}
 */
function getAllEntityTags(entity, options = {}) {
  if (!entity || typeof entity !== 'object') return [];
  const includeWorkstreams = options.includeWorkstreams !== false;
  const raw = [
    ...(Array.isArray(entity.group_tags) ? entity.group_tags : []),
    ...(Array.isArray(entity.major_topic_tags) ? entity.major_topic_tags : []),
    ...(Array.isArray(entity.topic_tags) ? entity.topic_tags : []),
    ...(Array.isArray(entity.extra_tags) ? entity.extra_tags : []),
    ...(Array.isArray(entity.other_tags) ? entity.other_tags : []),
    ...(Array.isArray(entity.tags) ? entity.tags : [])
  ];
  if (includeWorkstreams) {
    if (Array.isArray(entity.workstreams)) raw.push(...entity.workstreams);
    if (typeof entity.workstream === 'string' && entity.workstream) raw.push(...entity.workstream.split(','));
  }
  return cleanTagList(raw, options);
}
const getAllNoteTags = getAllEntityTags;

/**
 * Finds a workstream topic entry matching a given name or key.
 * @param {string} nameOrKey
 * @param {Array} [topicsList]
 * @returns {Object|null}
 */
function findWorkstreamByNameOrKey(nameOrKey, topicsList = null) {
  if (!nameOrKey || typeof nameOrKey !== 'string') return null;
  const clean = nameOrKey.trim().toLowerCase();
  if (!clean) return null;
  const norm = normalizeWorkstreamKey(clean);
  const list = Array.isArray(topicsList)
    ? topicsList
    : ((typeof _topicMemoriesIndexCache !== 'undefined' && Array.isArray(_topicMemoriesIndexCache?.topics)) ? _topicMemoriesIndexCache.topics : []);
  for (const t of list) {
    if (!t) continue;
    const tName = String(t.topicName || t.majorTopic || '').trim().toLowerCase();
    const tKey = String(t.key || '').trim().toLowerCase();
    const tNorm = normalizeWorkstreamKey(t.topicName || t.key || '');
    if (tName === clean || tKey === clean || (norm && tNorm === norm)) {
      return t;
    }
  }
  return null;
}

/**
 * Extracts a deduplicated array of workstreams from an entity (note, todo, event).
 * @param {Object} entity
 * @returns {string[]}
 */
function extractEntityWorkstreams(entity) {
  if (!entity || typeof entity !== 'object') return [];
  const results = [];
  if (Array.isArray(entity.workstreams)) {
    results.push(...cleanTagList(entity.workstreams));
  }
  if (typeof entity.workstream === 'string' && entity.workstream.trim()) {
    results.push(...cleanTagList(entity.workstream));
  }
  return cleanTagList(results);
}

/**
 * Normalizes an item or raw tag collection into separate group, major, and topic string arrays (lowercased & trimmed).
 * @param {Object|Array} itemOrTags
 * @returns {{ groups: string[], majors: string[], topics: string[] }}
 */
function normalizeItemTagSets(itemOrTags) {
  if (!itemOrTags) return { groups: [], majors: [], topics: [] };
  if (Array.isArray(itemOrTags)) {
    const list = cleanTagList(itemOrTags, { toLowerCase: true });
    return { groups: list, majors: list, topics: list };
  }

  const groups = cleanTagList(itemOrTags.group_tags || itemOrTags.group || [], { toLowerCase: true });
  let majors = cleanTagList(itemOrTags.major_topic_tags || itemOrTags.major_topic || itemOrTags.major || [], { toLowerCase: true });
  const topics = cleanTagList(itemOrTags.topic_tags || itemOrTags.topic || [], { toLowerCase: true });

  if (itemOrTags.tags && Array.isArray(itemOrTags.tags)) {
    const allTags = cleanTagList(itemOrTags.tags, { toLowerCase: true });
    allTags.forEach(t => {
      if (!groups.includes(t)) groups.push(t);
      if (!majors.includes(t)) majors.push(t);
      if (!topics.includes(t)) topics.push(t);
    });
  }

  return { groups, majors, topics };
}

/**
 * Checks if a set of tags satisfies a specific selection group rule.
 * @param {Object|Array} itemOrTags - Item with tag arrays or raw tag collection
 * @param {Object} rule - { group, major, topic }
 * @returns {boolean}
 */
function matchTagsToSelectionGroup(itemOrTags, rule) {
  if (!rule || typeof rule !== 'object') return false;
  const g = String(rule.group || '').trim().toLowerCase();
  const m = String(rule.major || '').trim().toLowerCase();
  const t = String(rule.topic || '').trim().toLowerCase();

  // If rule is completely blank with no criteria, it is not a valid match rule
  if (!g && !m && !t) return false;

  const isCatchAll = (!g || g === '*') && (!m || m === '*') && (!t || t === '*');
  if (isCatchAll && (g === '*' || m === '*' || t === '*')) return true;

  const normalizer = typeof normalizeItemTagSets === 'function'
    ? normalizeItemTagSets
    : (typeof globalThis !== 'undefined' && typeof globalThis.normalizeItemTagSets === 'function' ? globalThis.normalizeItemTagSets : null);

  const { groups, majors, topics } = normalizer
    ? normalizer(itemOrTags)
    : {
        groups: (itemOrTags?.group_tags || []).map(x => String(x || '').trim().toLowerCase()),
        majors: (itemOrTags?.major_topic_tags || []).map(x => String(x || '').trim().toLowerCase()),
        topics: (itemOrTags?.topic_tags || []).map(x => String(x || '').trim().toLowerCase())
      };

  const matchG = !g || g === '*' || groups.includes(g);
  const matchM = !m || m === '*' || majors.includes(m);
  const matchT = !t || t === '*' || topics.includes(t);

  return matchG && matchM && matchT;
}

/**
 * Matches tags against all selection groups of a workstream (or a raw list of tagGroups).
 * Returns match result with matchedGroup and matchedGroupIndex.
 * @param {Object|Array} itemOrTags
 * @param {string|Object|Array} workstreamOrMemoryOrTagGroups
 * @returns {{ matched: boolean, matchedGroup: Object|null, matchedGroupIndex: number }}
 */
function matchTagsToWorkstreamSelectionGroups(itemOrTags, workstreamOrMemoryOrTagGroups) {
  if (!itemOrTags || !workstreamOrMemoryOrTagGroups) {
    return { matched: false, matchedGroup: null, matchedGroupIndex: -1 };
  }

  let tagGroups = [];
  if (Array.isArray(workstreamOrMemoryOrTagGroups)) {
    tagGroups = workstreamOrMemoryOrTagGroups;
  } else if (typeof workstreamOrMemoryOrTagGroups === 'object') {
    tagGroups = workstreamOrMemoryOrTagGroups.mappedTags?.tagGroups || workstreamOrMemoryOrTagGroups.tagGroups || [];
  } else if (typeof workstreamOrMemoryOrTagGroups === 'string') {
    const wsName = workstreamOrMemoryOrTagGroups.trim();
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
    tagGroups = mem?.mappedTags?.tagGroups || [];
  }

  if (!Array.isArray(tagGroups) || tagGroups.length === 0) {
    return { matched: false, matchedGroup: null, matchedGroupIndex: -1 };
  }

  const matcher = typeof matchTagsToSelectionGroup === 'function'
    ? matchTagsToSelectionGroup
    : (typeof globalThis !== 'undefined' && typeof globalThis.matchTagsToSelectionGroup === 'function' ? globalThis.matchTagsToSelectionGroup : null);

  for (let i = 0; i < tagGroups.length; i++) {
    const tg = tagGroups[i];
    if (tg && matcher && matcher(itemOrTags, tg)) {
      return { matched: true, matchedGroup: tg, matchedGroupIndex: i };
    }
  }

  return { matched: false, matchedGroup: null, matchedGroupIndex: -1 };
}

if (typeof globalThis !== 'undefined') {
  globalThis.cleanTagList = cleanTagList;
  globalThis.mergeTagLists = mergeTagLists;
  globalThis.normalizeWorkstreamKey = normalizeWorkstreamKey;
  globalThis.getAllEntityTags = getAllEntityTags;
  globalThis.getAllNoteTags = getAllNoteTags;
  globalThis.findWorkstreamByNameOrKey = findWorkstreamByNameOrKey;
  globalThis.extractEntityWorkstreams = extractEntityWorkstreams;
  globalThis.normalizeItemTagSets = normalizeItemTagSets;
  globalThis.matchTagsToSelectionGroup = matchTagsToSelectionGroup;
  globalThis.matchTagsToWorkstreamSelectionGroups = matchTagsToWorkstreamSelectionGroups;
}

// ═══ Custom Dialog Modals (replacing native alert/confirm/prompt) ═══
function showConfirmDialog(message, options = {}) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    
    const box = document.createElement('div');
    box.className = 'dialog-box';
    
    const msg = document.createElement('div');
    msg.className = 'dialog-message';
    msg.textContent = message;
    box.appendChild(msg);
    
    const actions = document.createElement('div');
    actions.className = 'dialog-actions';
    
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn';
    cancelBtn.textContent = options.cancelLabel || (typeof t === 'function' ? t('editor.cancel') : 'Cancel');
    cancelBtn.title = options.cancelTooltip || options.cancelLabel || (typeof t === 'function' ? t('editor.cancelTooltip') || t('editor.cancel') : 'Cancel this dialog');
    cancelBtn.onclick = () => {
      cleanup();
      resolve(false);
    };
    actions.appendChild(cancelBtn);
    
    const confirmBtn = document.createElement('button');
    confirmBtn.className = options.isDanger ? 'btn btn-danger' : 'btn btn-save';
    confirmBtn.textContent = options.confirmLabel || (typeof t === 'function' ? t('common.ok') : 'OK');
    confirmBtn.title = options.confirmTooltip || options.confirmLabel || (typeof t === 'function' ? t('common.ok') : 'Confirm this action');
    confirmBtn.onclick = () => {
      cleanup();
      resolve(true);
    };
    actions.appendChild(confirmBtn);
    
    box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    
    confirmBtn.focus();
    
    const cleanup = () => {
      document.removeEventListener('keydown', keyHandler);
      overlay.remove();
    };
    
    const keyHandler = e => {
      if (e.key === 'Escape') {
        cleanup();
        resolve(false);
      } else if (e.key === 'Enter') {
        cleanup();
        resolve(true);
      }
    };
    document.addEventListener('keydown', keyHandler);
    
    overlay.addEventListener('click', e => {
      if (e.target === overlay) {
        cleanup();
        resolve(false);
      }
    });
  });
}

function showPromptDialog(message, defaultValue = '', options = {}) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    
    const box = document.createElement('div');
    box.className = 'dialog-box';
    
    const msg = document.createElement('div');
    msg.className = 'dialog-message';
    msg.textContent = message;
    box.appendChild(msg);
    
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'dialog-input';
    input.value = defaultValue;
    box.appendChild(input);
    
    const actions = document.createElement('div');
    actions.className = 'dialog-actions';
    
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn';
    cancelBtn.textContent = options.cancelLabel || (typeof t === 'function' ? t('editor.cancel') : 'Cancel');
    cancelBtn.title = options.cancelTooltip || (typeof t === 'function' ? t('common.cancelTooltip') : 'Cancel');
    cancelBtn.onclick = () => {
      cleanup();
      resolve(null);
    };
    actions.appendChild(cancelBtn);
    
    const okBtn = document.createElement('button');
    okBtn.className = 'btn btn-save';
    okBtn.textContent = options.okLabel || (typeof t === 'function' ? t('todo.save') : 'Save');
    okBtn.title = options.okTooltip || (typeof t === 'function' ? t('common.saveTooltip') : 'Save');
    okBtn.onclick = () => {
      const val = input.value;
      cleanup();
      resolve(val);
    };
    actions.appendChild(okBtn);
    
    box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    
    input.focus();
    input.select();
    
    const cleanup = () => {
      document.removeEventListener('keydown', keyHandler);
      overlay.remove();
    };
    
    const keyHandler = e => {
      if (e.key === 'Escape') {
        cleanup();
        resolve(null);
      } else if (e.key === 'Enter') {
        cleanup();
        resolve(input.value);
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

function showAlertDialog(message, options = {}) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    if (options.zIndex) overlay.style.zIndex = options.zIndex;
    
    const box = document.createElement('div');
    box.className = 'dialog-box';
    
    const msg = document.createElement('div');
    msg.className = 'dialog-message';
    msg.textContent = message;
    box.appendChild(msg);
    
    const actions = document.createElement('div');
    actions.className = 'dialog-actions';
    
    const okBtn = document.createElement('button');
    okBtn.className = 'btn btn-save';
    okBtn.textContent = options.okLabel || (typeof t === 'function' ? t('common.ok') : 'OK');
    okBtn.title = options.okTooltip || (typeof t === 'function' ? t('common.closeTooltip') : 'OK');
    okBtn.onclick = () => {
      cleanup();
      resolve();
    };
    actions.appendChild(okBtn);
    
    box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    
    okBtn.focus();
    
    const cleanup = () => {
      document.removeEventListener('keydown', keyHandler);
      overlay.remove();
    };
    
    const keyHandler = e => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        cleanup();
        resolve();
      }
    };
    document.addEventListener('keydown', keyHandler);
    
    overlay.addEventListener('click', e => {
      if (e.target === overlay) {
        cleanup();
        resolve();
      }
    });
  });
}

function _serializeDialogFieldValue(el) {
  if (!el) return '';
  if (el.tagName === 'SELECT') {
    if (el.multiple) return JSON.stringify(Array.from(el.selectedOptions).map(o => o.value));
    return String(el.value || '');
  }
  if (el.tagName === 'TEXTAREA') return String(el.value || '');
  if (el.tagName === 'INPUT') {
    const type = String(el.type || 'text').toLowerCase();
    if (type === 'checkbox' || type === 'radio') return el.checked ? '1' : '0';
    return String(el.value || '');
  }
  if (el.isContentEditable) return String(el.textContent || '');
  return String(el.value || el.textContent || '');
}

function _serializeDialogFormState(container) {
  if (!container) return '[]';
  const fields = Array.from(container.querySelectorAll('input, textarea, select, [contenteditable="true"]'));
  const parts = fields
    .filter(el => !el.disabled && el.type !== 'button' && el.type !== 'submit' && el.type !== 'reset')
    .map((el, idx) => {
      const key = el.id || el.name || `${el.tagName.toLowerCase()}-${idx}`;
      return `${key}:${_serializeDialogFieldValue(el)}`;
    });
  return JSON.stringify(parts);
}

function rememberDialogFormState(container) {
  if (!container) return;
  container.dataset.dialogBaselineState = _serializeDialogFormState(container);
}

function clearDialogFormState(container) {
  if (!container) return;
  delete container.dataset.dialogBaselineState;
}

function hasDialogUnsavedChanges(container) {
  if (!container) return false;
  const baseline = container.dataset.dialogBaselineState;
  if (baseline == null) return false;
  return _serializeDialogFormState(container) !== baseline;
}

function showUnsavedChangesDialog(options = {}) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';

    const box = document.createElement('div');
    box.className = 'dialog-box';

    const msg = document.createElement('div');
    msg.className = 'dialog-message';
    msg.textContent = options.message
      || (typeof t === 'function' ? t('confirm.unsavedChangesClose') : 'You have unsaved changes. Close this dialog?');
    box.appendChild(msg);

    const actions = document.createElement('div');
    actions.className = 'dialog-actions';

    const keepBtn = document.createElement('button');
    keepBtn.className = 'btn';
    keepBtn.textContent = options.cancelLabel
      || (typeof t === 'function' ? t('confirm.keepEditing') : 'No, keep editing');
    keepBtn.onclick = () => {
      cleanup();
      resolve('cancel');
    };
    actions.appendChild(keepBtn);

    const discardBtn = document.createElement('button');
    discardBtn.className = 'btn btn-danger';
    discardBtn.textContent = options.discardLabel
      || (typeof t === 'function' ? t('confirm.discardAndClose') : 'Yes, discard changes');
    discardBtn.onclick = () => {
      cleanup();
      resolve('discard');
    };
    actions.appendChild(discardBtn);

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-save';
    saveBtn.textContent = options.saveLabel
      || (typeof t === 'function' ? t('confirm.saveAndClose') : 'Yes, save and close');
    saveBtn.onclick = () => {
      cleanup();
      resolve('save');
    };
    actions.appendChild(saveBtn);

    box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    saveBtn.focus();

    const cleanup = () => {
      document.removeEventListener('keydown', keyHandler);
      overlay.remove();
    };

    const keyHandler = e => {
      if (e.key === 'Escape') {
        cleanup();
        resolve('cancel');
      } else if (e.key === 'Enter') {
        cleanup();
        resolve('save');
      }
    };
    document.addEventListener('keydown', keyHandler);

    overlay.addEventListener('click', e => {
      if (e.target === overlay) {
        cleanup();
        resolve('cancel');
      }
    });
  });
}

// ═══ Hash-based Routing (SPA State Sync) ═══
function updateUrlHash() {
  if (_isApplyingHash) return;
  if (_isFocusedMode && currentNote && currentNote.id) {
    const newHash = `#note=${encodeURIComponent(currentNote.id)}`;
    if (location.hash !== newHash) {
      _isApplyingHash = true;
      try {
        history.replaceState(null, '', newHash);
      } catch (e) {
        location.hash = newHash;
      }
      setTimeout(() => { _isApplyingHash = false; }, 50);
    }
    return;
  }
  const parts = [];
  const dailyReviewOverlay = document.getElementById('daily-review-overlay');
  const dailyReviewController = typeof DailyReviewController !== 'undefined' ? DailyReviewController : null;
  const dailyReviewVisible = !!(
    activeTab === 'daily-review' &&
    dailyReviewOverlay &&
    (dailyReviewOverlay.style.display === 'flex' || dailyReviewOverlay.style.display === 'block' || (window.getComputedStyle && getComputedStyle(dailyReviewOverlay).display !== 'none'))
  );

  if (dailyReviewVisible && dailyReviewController && typeof dailyReviewController.getReviewDateValue === 'function') {
    parts.push('tab=daily-review');
    const reviewDate = dailyReviewController.getReviewDateValue();
    if (reviewDate) parts.push(`dr=${encodeURIComponent(reviewDate)}`);
    const step = dailyReviewController.currentStep || 0;
    parts.push(`step=${step}`);
  } else {
    if (activeTab) parts.push(`tab=${activeTab}`);
    if (expandedLaneVal) parts.push(`focus=${encodeURIComponent(expandedLaneVal)}`);
    if (currentNote && currentNote.id) parts.push(`note=${encodeURIComponent(currentNote.id)}`);
  }

  const hash = parts.join('&');
  const newHash = hash ? '#' + hash : '';
  if (location.hash !== newHash) {
    _isApplyingHash = true;
    try {
      history.replaceState(null, '', newHash || '#');
    } catch (e) {
      location.hash = newHash || '#';
    }
    setTimeout(() => { _isApplyingHash = false; }, 50);
  }
}

async function applyHashState() {
  if (_isApplyingHash) return;
  _isApplyingHash = true;
  try {
    const hash = location.hash.replace(/^#/, '');
    if (!hash) {
      if (!_isFocusedMode) {
        if (activeTab !== 'notes') await switchTab('notes');
        if (expandedLaneVal) closeLaneFocus();
      }
      if (currentNote && !_isFocusedMode) await closeNoteOverlay();
      return;
    }
    const params = new URLSearchParams(hash);
    if (params.get('chat-window') === 'true' || hash.includes('chat-window=true')) {
      document.body.classList.add('chat-window-mode');
      const floating = document.getElementById('floating-secretary-chat');
      if (floating) floating.classList.add('is-open');
      return;
    }
    if (params.get('focus-pip') === 'true' || hash.includes('focus-pip=true')) {
      document.body.classList.add('focus-pip-mode');
      if (typeof renderFocusPipHud === 'function') renderFocusPipHud();
      return;
    }
    if (params.get('preloaded') === 'true' || hash.includes('preloaded=true')) {
      _isFocusedMode = true;
      document.body.classList.add('focused-note-mode');
      return;
    }

    const noteId = params.get('note');
    const notePathParam = params.get('path');
    if (noteId || notePathParam) {
      _isFocusedMode = true;
      document.body.classList.add('focused-note-mode');
      if (window.checkSavedFolderPromise) {
        try { await window.checkSavedFolderPromise; } catch (e) {}
      }
      if (!rootHandle && window.AppBridge?.fs) {
        try {
          const ws = await window.AppBridge.fs.getWorkspacePath();
          if (ws) await mountFolder(ws);
        } catch (e) {}
      }
      if ((!manifest || manifest.length === 0) && typeof metadataHydrationProgress !== 'undefined' && metadataHydrationProgress?.running) {
        let attempts = 0;
        while ((!manifest || manifest.length === 0) && metadataHydrationProgress.running && attempts < 20) {
          await new Promise(r => setTimeout(r, 50));
          attempts++;
        }
      }
      let targetNote = (noteId ? getNoteById(noteId) : null)
        || (notePathParam ? (typeof getNoteByPath === 'function' ? getNoteByPath(notePathParam) : null) : null)
        || (noteId ? (typeof getNoteByPath === 'function' ? getNoteByPath(noteId) : null) : null);

      if (!targetNote && (noteId || notePathParam)) {
        try {
          await loadManifest();
          targetNote = (noteId ? getNoteById(noteId) : null)
            || (notePathParam ? (typeof getNoteByPath === 'function' ? getNoteByPath(notePathParam) : null) : null)
            || (noteId ? (typeof getNoteByPath === 'function' ? getNoteByPath(noteId) : null) : null);
        } catch (e) {}
      }

      const resolvedPath = targetNote?.path || notePathParam || (noteId && noteId.includes('/') ? noteId : (noteId ? getCanonicalNotePath(noteId) : null));
      if (resolvedPath) {
        if (!currentNote || currentNote.path !== resolvedPath) {
          await openNoteOverlay(resolvedPath, null, null, false, null, { sameWindow: true });
        }
        if (currentNote && window.AppBridge?.noteWindow?.notifyActiveNote) {
          window.AppBridge.noteWindow.notifyActiveNote(currentNote.id, currentNote.path);
        }
      }
      return;
    }

    const tab = params.get('tab') || 'notes';
    const focus = params.get('focus');
    const dailyReviewDate = params.get('dr');
    let dailyReviewStep = parseInt(params.get('step') || '0', 10);
    if (isNaN(dailyReviewStep)) dailyReviewStep = 0;
    if (dailyReviewStep < 0) dailyReviewStep = 0;
    if (dailyReviewStep > 4) dailyReviewStep = 4;

    if (tab === 'daily-review') {
      const dailyReviewController = typeof DailyReviewController !== 'undefined' ? DailyReviewController : null;

      if (dailyReviewController && typeof dailyReviewController.start === 'function') {
        await dailyReviewController.start(dailyReviewDate || null, dailyReviewStep);

        if (dailyReviewStep === 0 && typeof dailyReviewController.resume === 'function') {
          dailyReviewController.currentStep = 0;
          await dailyReviewController.resume();
        } else if (dailyReviewStep > 0 && typeof dailyReviewController.loadStep === 'function' && dailyReviewController.currentStep !== dailyReviewStep) {
          await dailyReviewController.loadStep(dailyReviewStep);
        }
      } else if (typeof switchTab === 'function' && activeTab !== 'daily-review') {
        if (typeof notifyLoadingDependency === 'function') notifyLoadingDependency('Daily Review');
        await switchTab('daily-review');
        setTimeout(() => {
          if (location.hash.includes('tab=daily-review') && typeof applyHashState === 'function') {
            applyHashState().catch(() => {});
          }
        }, 120);
      }
    } else {
      // Ensure daily review is paused if we are on a normal tab
      const dailyReviewOverlay = document.getElementById('daily-review-overlay');
      const dailyReviewVisible = !!(dailyReviewOverlay && dailyReviewOverlay.style.display !== 'none');
      const dailyReviewController = typeof DailyReviewController !== 'undefined' ? DailyReviewController : null;
      if (dailyReviewVisible && dailyReviewController && typeof dailyReviewController.pause === 'function') {
        dailyReviewController.pause();
      }

      if (activeTab !== tab) {
        await switchTab(tab);
      }

      if (focus) {
        if (expandedLaneVal !== focus) {
          openLaneFocus(focus);
        }
      } else {
        if (expandedLaneVal) {
          closeLaneFocus();
        }
      }

      if (currentNote) {
        await closeNoteOverlay();
      }
    }
  } finally {
    _isApplyingHash = false;
  }
}

function showProgressDialog(title, steps) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    
    const box = document.createElement('div');
    box.className = 'dialog-box';
    box.style.textAlign = 'center';
    
    const titleEl = document.createElement('h3');
    titleEl.style.margin = '0 0 0.5rem 0';
    titleEl.style.color = 'var(--accent)';
    titleEl.textContent = title;
    box.appendChild(titleEl);
    
    const statusEl = document.createElement('div');
    statusEl.className = 'dialog-message';
    statusEl.style.fontSize = '0.85rem';
    statusEl.style.color = 'var(--text-muted)';
    statusEl.textContent = steps[0].label;
    box.appendChild(statusEl);
    
    // Progress Bar Container
    const progressContainer = document.createElement('div');
    progressContainer.style.width = '100%';
    progressContainer.style.height = '8px';
    progressContainer.style.background = 'var(--card-bg-alt)';
    progressContainer.style.border = '1px solid var(--card-border)';
    progressContainer.style.borderRadius = '4px';
    progressContainer.style.overflow = 'hidden';
    progressContainer.style.marginTop = '0.8rem';
    
    const progressFill = document.createElement('div');
    progressFill.style.width = '0%';
    progressFill.style.height = '100%';
    progressFill.style.background = 'var(--accent)';
    progressFill.style.transition = 'width 0.2s ease-out';
    progressContainer.appendChild(progressFill);
    box.appendChild(progressContainer);
    
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    
    const runSteps = async () => {
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        statusEl.textContent = step.label;
        progressFill.style.width = step.percentage + '%';
        if (step.action) {
          try {
            await step.action();
          } catch (err) {
            console.error('Error during progress dialog step action:', err);
          }
        }
        await new Promise(r => setTimeout(r, step.duration || 300));
      }
      overlay.remove();
      resolve();
    };
    
    runSteps();
  });
}

// ── Translation Utilities for Generated Notes ──
const NOTE_TRANSLATIONS = {
  en: {
    goal: "Goal",
    syncGoal: "Sync Up Goal",
    callGoal: "Call Goal",
    meetingGoal: "Meeting Goal",
    notes: "Notes",
    meetingNotes: "Meeting Notes",
    postCallNotes: "Next Steps & Action Items",
    tasksToDiscuss: "Tasks to Discuss",
    callPreparation: "Call Preparation",
    callPrepSuggestion: "Suggestion: Check status of delegated items:",
    discussPointsWith: "Discuss points with",
    discussTask: "Discuss task",
    askAboutStatusOf: "Ask @{collab} about status of: {title}",
    previousSession: "Previous Session",
    previousSessionNote: "Previous Session Note",
    sourceNote: "Reference Note",
    decisionsFromPreviousSession: "Decisions from Previous Session",
    todosFromPreviousSession: "Action Items from Previous Session",
    agendaPoints: "Agenda & Discussion Points",
    discuterPointsEnCours: "Discuss points in progress with",
    suiviTachesDeleguees: "Follow-up on Delegated Tasks (Waiting For)",
    suiviTask: "Follow-up on task",
    decisions: "Decisions",
    actions: "Next Steps & Action Items",
    informalDiscussion: "Informal Discussion",
    meetingContext: "Meeting Context"
  },
  fr: {
    goal: "Objectif",
    syncGoal: "Objectif de synchronisation",
    callGoal: "Objectif d'appel",
    meetingGoal: "Objectif de réunion",
    notes: "Notes",
    meetingNotes: "Notes de réunion",
    postCallNotes: "Prochaines étapes & Actions",
    tasksToDiscuss: "Tâches à aborder",
    callPreparation: "Préparation de l'appel",
    callPrepSuggestion: "Suggestion : Vérifier le statut des tâches déléguées :",
    discussPointsWith: "Discuter des points avec",
    discussTask: "Discuter de la tâche",
    askAboutStatusOf: "Demander à @{collab} le statut de : {title}",
    previousSession: "Session précédente",
    previousSessionNote: "Note de la session précédente",
    sourceNote: "Note de référence",
    decisionsFromPreviousSession: "Décisions de la session précédente",
    todosFromPreviousSession: "Actions de la session précédente",
    agendaPoints: "Ordre du jour & Points à aborder",
    discuterPointsEnCours: "Discuter des points en cours avec",
    suiviTachesDeleguees: "Suivi des tâches déléguées (Waiting For)",
    suiviTask: "Suivi de la tâche",
    decisions: "Décisions",
    actions: "Prochaines étapes & Actions",
    informalDiscussion: "Échanges informels",
    meetingContext: "Contexte de la réunion"
  },
  de: {
    goal: "Ziel",
    syncGoal: "Synchronisations-Ziel",
    callGoal: "Anruf-Ziel",
    meetingGoal: "Besprechungs-Ziel",
    notes: "Notizen",
    meetingNotes: "Besprechungsnotizen",
    postCallNotes: "Nächste Schritte & Aufgaben",
    tasksToDiscuss: "Zu besprechende Aufgaben",
    callPreparation: "Anruf-Vorbereitung",
    callPrepSuggestion: "Vorschlag: Status der delegierten Aufgaben prüfen:",
    discussPointsWith: "Punkte besprechen mit",
    discussTask: "Aufgabe besprechen",
    askAboutStatusOf: "Frage @{collab} nach dem Status von: {title}",
    previousSession: "Vorherige Sitzung",
    previousSessionNote: "Notiz der vorherigen Sitzung",
    sourceNote: "Referenz-Notiz",
    decisionsFromPreviousSession: "Entscheidungen der vorherigen Sitzung",
    todosFromPreviousSession: "Aufgaben der vorherigen Sitzung",
    agendaPoints: "Tagesordnung & Besprechungspunkte",
    discuterPointsEnCours: "Laufende Punkte besprechen mit",
    suiviTachesDeleguees: "Nachverfolgung delegierter Aufgaben (Waiting For)",
    suiviTask: "Nachverfolgung der Aufgabe",
    decisions: "Entscheidungen",
    actions: "Nächste Schritte & Aufgaben",
    informalDiscussion: "Informelle Gespräche",
    meetingContext: "Besprechungskontext"
  },
  cs: {
    goal: "Cíl",
    syncGoal: "Cíl synchronizace",
    callGoal: "Cíl hovoru",
    meetingGoal: "Cíl schůzky",
    notes: "Poznámky",
    meetingNotes: "Zápis ze schůzky",
    postCallNotes: "Další kroky a úkoly",
    tasksToDiscuss: "Úkoly k projednání",
    callPreparation: "Příprava na hovor",
    callPrepSuggestion: "Návrh: Zkontrolovat stav delegovaných úkolů:",
    discussPointsWith: "Probrat body s",
    discussTask: "Probrat úkol",
    askAboutStatusOf: "Zeptat se @{collab} na stav: {title}",
    previousSession: "Předchozí sezení",
    previousSessionNote: "Poznámka z předchozího sezení",
    sourceNote: "Referenční poznámka",
    decisionsFromPreviousSession: "Rozhodnutí z předchozího sezení",
    todosFromPreviousSession: "Úkoly z předchozího sezení",
    agendaPoints: "Program a body k diskuzi",
    discuterPointsEnCours: "Probrat probíhající body s",
    suiviTachesDeleguees: "Sledování delegovaných úkolů (Čeká se na)",
    suiviTask: "Sledování úkolu",
    decisions: "Rozhodnutí",
    actions: "Další kroky a úkoly",
    informalDiscussion: "Neformální diskuse",
    meetingContext: "Kontext schůzky"
  },
  es: {
    goal: "Objetivo",
    syncGoal: "Objetivo de sincronización",
    callGoal: "Objetivo de la llamada",
    meetingGoal: "Objetivo de la reunión",
    notes: "Notas",
    meetingNotes: "Notas de la reunión",
    postCallNotes: "Próximos pasos y acciones",
    tasksToDiscuss: "Tareas a discutir",
    callPreparation: "Preparación de la llamada",
    callPrepSuggestion: "Sugerencia: Verificar el estado de las tareas delegadas:",
    discussPointsWith: "Discutir puntos con",
    discussTask: "Discutir tarea",
    askAboutStatusOf: "Preguntar a @{collab} sobre el estado de: {title}",
    previousSession: "Sesión anterior",
    previousSessionNote: "Nota de la sesión anterior",
    sourceNote: "Nota de referencia",
    decisionsFromPreviousSession: "Decisiones de la sesión anterior",
    todosFromPreviousSession: "Tareas de la sesión anterior",
    agendaPoints: "Orden del día y temas a tratar",
    discuterPointsEnCours: "Discutir puntos en curso con",
    suiviTachesDeleguees: "Seguimiento de tareas delegadas (En espera)",
    suiviTask: "Seguimiento de tarea",
    decisions: "Decisiones",
    actions: "Próximos pasos y acciones",
    informalDiscussion: "Discusión informal",
    meetingContext: "Contexto de la reunión"
  },
  hu: {
    goal: "Cél",
    syncGoal: "Szinkronizálási cél",
    callGoal: "Hívási cél",
    meetingGoal: "Megbeszélési cél",
    notes: "Jegyzetek",
    meetingNotes: "Megbeszélési jegyzetek",
    postCallNotes: "Következő lépések és feladatok",
    tasksToDiscuss: "Megbeszélendő feladatok",
    callPreparation: "Hívás előkészítése",
    callPrepSuggestion: "Javaslat: Ellenőrizze a delegált feladatok állapotát:",
    discussPointsWith: "Pontok megbeszélése vele:",
    discussTask: "Feladat megbeszélése",
    askAboutStatusOf: "Kérdezze meg @{collab} kollégát erről: {title}",
    previousSession: "Előző munkamenet",
    previousSessionNote: "Előző munkamenet jegyzete",
    sourceNote: "Hivatkozási jegyzet",
    decisionsFromPreviousSession: "Előző munkamenet döntései",
    todosFromPreviousSession: "Előző munkamenet feladatai",
    agendaPoints: "Napirend és megvitatandó pontok",
    discuterPointsEnCours: "Folyamatban lévő pontok megbeszélése vele:",
    suiviTachesDeleguees: "Delegált feladatok nyomon követése (Függőben)",
    suiviTask: "Feladat nyomon követése",
    decisions: "Döntések",
    actions: "Következő lépések és feladatok",
    informalDiscussion: "Kötetlen beszélgetés",
    meetingContext: "Megbeszélés kontextusa"
  },
  it: {
    goal: "Obiettivo",
    syncGoal: "Obiettivo di sincronizzazione",
    callGoal: "Obiettivo della chiamata",
    meetingGoal: "Obiettivo della riunione",
    notes: "Note",
    meetingNotes: "Note della riunione",
    postCallNotes: "Prossimi passi e azioni",
    tasksToDiscuss: "Attività da discutere",
    callPreparation: "Preparazione della chiamata",
    callPrepSuggestion: "Suggerimento: Verificare lo stato delle attività delegate:",
    discussPointsWith: "Discutere i punti con",
    discussTask: "Discutere l'attività",
    askAboutStatusOf: "Chiedere a @{collab} lo stato di: {title}",
    previousSession: "Sessione precedente",
    previousSessionNote: "Nota della sessione precedente",
    sourceNote: "Nota di riferimento",
    decisionsFromPreviousSession: "Decisioni della sessione precedente",
    todosFromPreviousSession: "Attività della sessione precedente",
    agendaPoints: "Ordine del giorno e punti di discussione",
    discuterPointsEnCours: "Discutere i punti in corso con",
    suiviTachesDeleguees: "Monitoraggio attività delegate (In attesa)",
    suiviTask: "Monitoraggio attività",
    decisions: "Decisioni",
    actions: "Prossimi passi e azioni",
    informalDiscussion: "Discussione informale",
    meetingContext: "Contesto della riunione"
  },
  nl: {
    goal: "Doel",
    syncGoal: "Synchronisatiedoel",
    callGoal: "Doel van het gesprek",
    meetingGoal: "Doel van de vergadering",
    notes: "Notities",
    meetingNotes: "Vergadernotities",
    postCallNotes: "Volgende stappen en acties",
    tasksToDiscuss: "Te bespreken taken",
    callPreparation: "Gespreksvoorbereiding",
    callPrepSuggestion: "Suggestie: Controleer de status van gedelegeerde taken:",
    discussPointsWith: "Punten bespreken met",
    discussTask: "Taak bespreken",
    askAboutStatusOf: "Vraag @{collab} naar de status van: {title}",
    previousSession: "Vorige sessie",
    previousSessionNote: "Notitie van vorige sessie",
    sourceNote: "Referentienotitie",
    decisionsFromPreviousSession: "Beslissingen van vorige sessie",
    todosFromPreviousSession: "Taken van vorige sessie",
    agendaPoints: "Agenda & bespreekpunten",
    discuterPointsEnCours: "Lopende punten bespreken met",
    suiviTachesDeleguees: "Opvolging gedelegeerde taken (Wachten op)",
    suiviTask: "Opvolging van taak",
    decisions: "Beslissingen",
    actions: "Volgende stappen en acties",
    informalDiscussion: "Informele discussie",
    meetingContext: "Context van de vergadering"
  },
  pl: {
    goal: "Cel",
    syncGoal: "Cel synchronizacji",
    callGoal: "Cel rozmowy",
    meetingGoal: "Cel spotkania",
    notes: "Notatki",
    meetingNotes: "Notatki ze spotkania",
    postCallNotes: "Kolejne kroki i działania",
    tasksToDiscuss: "Zadania do omówienia",
    callPreparation: "Przygotowanie do rozmowy",
    callPrepSuggestion: "Sugestia: Sprawdź status delegowanych zadań:",
    discussPointsWith: "Omów kwestie z",
    discussTask: "Omów zadanie",
    askAboutStatusOf: "Zapytaj @{collab} o status: {title}",
    previousSession: "Poprzednia sesja",
    previousSessionNote: "Notatka z poprzedniej sesji",
    sourceNote: "Notatka źródłowa",
    decisionsFromPreviousSession: "Decyzje z poprzedniej sesji",
    todosFromPreviousSession: "Zadania z poprzedniej sesji",
    agendaPoints: "Porządek obrad i punkty do dyskusji",
    discuterPointsEnCours: "Omów bieżące kwestie z",
    suiviTachesDeleguees: "Śledzenie delegowanych zadań (Oczekujące)",
    suiviTask: "Śledzenie zadania",
    decisions: "Decyzje",
    actions: "Kolejne kroki i działania",
    informalDiscussion: "Dyskusja nieformalna",
    meetingContext: "Kontekst spotkania"
  },
  pt: {
    goal: "Objetivo",
    syncGoal: "Objetivo de sincronização",
    callGoal: "Objetivo da chamada",
    meetingGoal: "Objetivo da reunião",
    notes: "Notas",
    meetingNotes: "Notas da reunião",
    postCallNotes: "Próximos passos e ações",
    tasksToDiscuss: "Tarefas a discutir",
    callPreparation: "Preparação da chamada",
    callPrepSuggestion: "Sugestão: Verificar o estado das tarefas delegadas:",
    discussPointsWith: "Discutir pontos com",
    discussTask: "Discutir tarefa",
    askAboutStatusOf: "Perguntar a @{collab} sobre o estado de: {title}",
    previousSession: "Sessão anterior",
    previousSessionNote: "Nota da sessão anterior",
    sourceNote: "Nota de referência",
    decisionsFromPreviousSession: "Decisões da sessão anterior",
    todosFromPreviousSession: "Tarefas da sessão anterior",
    agendaPoints: "Ordem do dia e pontos a discutir",
    discuterPointsEnCours: "Discutir pontos em curso com",
    suiviTachesDeleguees: "Acompanhamento de tarefas delegadas (A aguardar)",
    suiviTask: "Acompanhamento de tarefa",
    decisions: "Decisões",
    actions: "Próximos passos e ações",
    informalDiscussion: "Discussão informal",
    meetingContext: "Contexto da reunião"
  },
  ro: {
    goal: "Obiectiv",
    syncGoal: "Obiectiv de sincronizare",
    callGoal: "Obiectivul apelului",
    meetingGoal: "Obiectivul ședinței",
    notes: "Note",
    meetingNotes: "Note de ședință",
    postCallNotes: "Următorii pași și acțiuni",
    tasksToDiscuss: "Sarcini de discutat",
    callPreparation: "Pregătirea apelului",
    callPrepSuggestion: "Sugestie: Verificați starea sarcinilor delegate:",
    discussPointsWith: "Discutați punctele cu",
    discussTask: "Discutați sarcina",
    askAboutStatusOf: "Întrebați @{collab} despre starea: {title}",
    previousSession: "Sesiunea anterioară",
    previousSessionNote: "Nota sesiunii anterioare",
    sourceNote: "Notă de referință",
    decisionsFromPreviousSession: "Decizii din sesiunea anterioară",
    todosFromPreviousSession: "Sarcini din sesiunea anterioară",
    agendaPoints: "Ordinea de zi și puncte de discuție",
    discuterPointsEnCours: "Discutați punctele în curs cu",
    suiviTachesDeleguees: "Urmărirea sarcinilor delegate (În așteptare)",
    suiviTask: "Urmărirea sarcinii",
    decisions: "Decizii",
    actions: "Următorii pași și acțiuni",
    informalDiscussion: "Discuție informală",
    meetingContext: "Contextul ședinței"
  },
  ru: {
    goal: "Цель",
    syncGoal: "Цель синхронизации",
    callGoal: "Цель звонка",
    meetingGoal: "Цель встречи",
    notes: "Заметки",
    meetingNotes: "Заметки со встречи",
    postCallNotes: "Следующие шаги и действия",
    tasksToDiscuss: "Задачи для обсуждения",
    callPreparation: "Подготовка к звонку",
    callPrepSuggestion: "Совет: Проверить статус делегированных задач:",
    discussPointsWith: "Обсудить пункты с",
    discussTask: "Обсудить задачу",
    askAboutStatusOf: "Узнать у @{collab} статус: {title}",
    previousSession: "Предыдущая сессия",
    previousSessionNote: "Заметка предыдущей сессии",
    sourceNote: "Справочная заметка",
    decisionsFromPreviousSession: "Решения предыдущей сессии",
    todosFromPreviousSession: "Задачи предыдущей сессии",
    agendaPoints: "Повестка и темы для обсуждения",
    discuterPointsEnCours: "Обсудить текущие вопросы с",
    suiviTachesDeleguees: "Отслеживание порученных задач (Ожидание)",
    suiviTask: "Отслеживание задачи",
    decisions: "Решения",
    actions: "Следующие шаги и действия",
    informalDiscussion: "Неформальное обсуждение",
    meetingContext: "Контекст встречи"
  },
  sv: {
    goal: "Mål",
    syncGoal: "Synkroniseringsmål",
    callGoal: "Samtalsmål",
    meetingGoal: "Mötesmål",
    notes: "Anteckningar",
    meetingNotes: "Mötesanteckningar",
    postCallNotes: "Nästa steg och åtgärder",
    tasksToDiscuss: "Uppgifter att diskutera",
    callPreparation: "Samtalsförberedelse",
    callPrepSuggestion: "Förslag: Kontrollera status för delegerade uppgifter:",
    discussPointsWith: "Diskutera punkter med",
    discussTask: "Diskutera uppgift",
    askAboutStatusOf: "Fråga @{collab} om status för: {title}",
    previousSession: "Föregående session",
    previousSessionNote: "Anteckning från föregående session",
    sourceNote: "Referensanteckning",
    decisionsFromPreviousSession: "Beslut från föregående session",
    todosFromPreviousSession: "Uppgifter från föregående session",
    agendaPoints: "Dagordning och diskussionspunkter",
    discuterPointsEnCours: "Diskutera pågående punkter med",
    suiviTachesDeleguees: "Uppföljning av delegerade uppgifter (Väntar på)",
    suiviTask: "Uppföljning av uppgift",
    decisions: "Beslut",
    actions: "Nästa steg och åtgärder",
    informalDiscussion: "Informell diskussion",
    meetingContext: "Möteskontext"
  },
  tr: {
    goal: "Hedef",
    syncGoal: "Senkronizasyon Hedefi",
    callGoal: "Arama Hedefi",
    meetingGoal: "Toplantı Hedefi",
    notes: "Notlar",
    meetingNotes: "Toplantı Notları",
    postCallNotes: "Sonraki Adımlar ve Eylemler",
    tasksToDiscuss: "Tartışılacak Görevler",
    callPreparation: "Arama Hazırlığı",
    callPrepSuggestion: "Öneri: Devredilen görevlerin durumunu kontrol edin:",
    discussPointsWith: "Konuları şununla tartışın:",
    discussTask: "Görevi tartış",
    askAboutStatusOf: "@{collab} kişisine şu görevin durumunu sorun: {title}",
    previousSession: "Önceki Oturum",
    previousSessionNote: "Önceki Oturum Notu",
    sourceNote: "Referans Not",
    decisionsFromPreviousSession: "Önceki Oturum Kararları",
    todosFromPreviousSession: "Önceki Oturum Görevleri",
    agendaPoints: "Gündem ve Tartışma Konuları",
    discuterPointsEnCours: "Devam eden konuları şununla tartışın:",
    suiviTachesDeleguees: "Devredilen Görevlerin Takibi (Beklemede)",
    suiviTask: "Görevin Takibi",
    decisions: "Kararlar",
    actions: "Sonraki Adımlar ve Eylemler",
    informalDiscussion: "Gayriresmi Tartışma",
    meetingContext: "Toplantı Bağlamı"
  },
  uk: {
    goal: "Мета",
    syncGoal: "Мета синхронізації",
    callGoal: "Мета дзвінка",
    meetingGoal: "Мета зустрічі",
    notes: "Нотатки",
    meetingNotes: "Нотатки зустрічі",
    postCallNotes: "Наступні кроки та дії",
    tasksToDiscuss: "Завдання для обговорення",
    callPreparation: "Підготовка до дзвінка",
    callPrepSuggestion: "Порада: Перевірити статус делегованих завдань:",
    discussPointsWith: "Обговорити пункти з",
    discussTask: "Обговорити завдання",
    askAboutStatusOf: "Запитати @{collab} про статус: {title}",
    previousSession: "Попередня сесія",
    previousSessionNote: "Нотатка попередньої сесії",
    sourceNote: "Довідкова нотатка",
    decisionsFromPreviousSession: "Рішення попередньої сесії",
    todosFromPreviousSession: "Завдання попередньої сесії",
    agendaPoints: "Порядок денний та теми для обговорення",
    discuterPointsEnCours: "Обговорити поточні питання з",
    suiviTachesDeleguees: "Відстеження делегованих завдань (Очікування)",
    suiviTask: "Відстеження завдання",
    decisions: "Рішення",
    actions: "Наступні кроки та дії",
    informalDiscussion: "Неформальне обговорення",
    meetingContext: "Контекст зустрічі"
  }
};

const SUPPORTED_APP_LANGUAGES = ['en', 'de', 'fr', 'cs', 'es', 'hu', 'it', 'nl', 'pl', 'pt', 'ro', 'ru', 'sv', 'tr', 'uk'];

function getAppLanguageDisplayName(langCode) {
  if (typeof APP_LANGUAGE_NAMES !== 'undefined' && APP_LANGUAGE_NAMES && APP_LANGUAGE_NAMES[langCode]) {
    return APP_LANGUAGE_NAMES[langCode];
  }
  const fallback = {
    en: 'English', de: 'Deutsch', fr: 'Français', cs: 'Čeština', es: 'Español',
    hu: 'Magyar', it: 'Italiano', nl: 'Nederlands', pl: 'Polski', pt: 'Português',
    ro: 'Română', ru: 'Русский', sv: 'Svenska', tr: 'Türkçe', uk: 'Українська'
  };
  return fallback[langCode] || 'English';
}

function detectTextLanguage(sampleText, fallbackLang = 'en') {
  if (!sampleText || typeof sampleText !== 'string' || !sampleText.trim()) {
    return fallbackLang;
  }
  const text = sampleText.toLowerCase();

  // Check Ukrainian specific characters first (і, ї, є, ґ) vs Russian (ы, э, ъ, ё)
  const ukCharCount = (text.match(/[іїєґ]/g) || []).length;
  const ruCharCount = (text.match(/[ыэъё]/g) || []).length;
  const cyrillicCount = (text.match(/[а-я]/g) || []).length;

  if (cyrillicCount > 5) {
    if (ukCharCount > ruCharCount) return 'uk';
    if (ruCharCount > ukCharCount) return 'ru';
    const ukWords = (text.match(/\b(і|та|що|як|для|про|це|було|буде|або|але|від|до|на|в|у)\b/g) || []).length;
    const ruWords = (text.match(/\b(и|что|как|для|это|было|будет|или|но|от|до|на|в|не)\b/g) || []).length;
    return ukWords > ruWords ? 'uk' : 'ru';
  }

  // Language profiles for all 13 Latin-alphabet European languages supported by Secretary
  const patterns = {
    fr: /\b(le|la|les|et|est|dans|pour|avec|une|des|sont|sur|qui|que|cette|ce|du|par)\b/g,
    de: /\b(der|die|das|und|ist|in|für|mit|eine|den|nicht|dem|ein|auf|von|zu|des|als)\b/g,
    es: /\b(el|la|los|las|en|por|para|con|una|del|que|como|este|esta|son|pero|sobre)\b/g,
    it: /\b(il|la|le|in|per|con|una|dei|del|della|che|sono|non|delle|questo|questa)\b/g,
    nl: /\b(de|het|een|en|van|in|is|op|te|met|voor|zijn|niet|aan|dat|om|maar|er)\b/g,
    pl: /\b(i|w|z|na|do|nie|że|się|to|jest|oraz|dla|przez|jako|jak|ale|od|po)\b/g,
    pt: /\b(o|a|os|as|em|para|com|uma|um|do|da|dos|das|por|que|não|são|mais)\b/g,
    sv: /\b(och|i|att|det|som|en|på|är|av|för|med|till|den|har|inte|ett|om|men)\b/g,
    cs: /\b(a|v|se|na|že|je|s|z|do|pro|ve|jak|jako|ale|k|od|po|o|nebo|byl)\b/g,
    hu: /\b(és|hogy|nem|egy|van|az|meg|mint|kell|csak|után|volt|vagy|is|ha)\b/g,
    ro: /\b(și|în|de|la|cu|pentru|o|un|pe|din|care|este|sunt|nu|sau|ce|mai)\b/g,
    tr: /\b(ve|bir|bu|ile|için|da|de|olan|olarak|var|ne|gibi|çok|daha|kadar)\b/g,
    en: /\b(the|and|is|in|for|with|that|this|from|have|are|not|which|will|all)\b/g
  };

  let maxCount = 0;
  let bestLang = fallbackLang;

  for (const [lang, regex] of Object.entries(patterns)) {
    const matches = (text.match(regex) || []).length;
    if (matches > maxCount) {
      maxCount = matches;
      bestLang = lang;
    }
  }

  return maxCount >= 2 ? bestLang : fallbackLang;
}

function getWorkingLanguage() {
  if (typeof settings !== 'undefined' && settings && settings.workingLanguage) {
    const lang = String(settings.workingLanguage).toLowerCase().split('-')[0];
    if (SUPPORTED_APP_LANGUAGES.includes(lang)) {
      return lang;
    }
  }
  return 'en';
}
window.getWorkingLanguage = getWorkingLanguage;

function getNoteLanguage(sampleText = '') {
  let lang = 'en'; // default fallback
  if (typeof settings !== 'undefined' && settings) {
    if (settings.workingLanguage) {
      lang = settings.workingLanguage;
    } else if (settings.ai && settings.ai.language && settings.ai.language !== 'auto') {
      lang = settings.ai.language;
    } else if (sampleText) {
      lang = detectTextLanguage(sampleText, settings.workingLanguage || settings.language || 'en');
    } else if (settings.language) {
      lang = settings.language;
    }
  }
  lang = String(lang).toLowerCase().split('-')[0];
  if (SUPPORTED_APP_LANGUAGES.includes(lang)) {
    return lang;
  }
  return 'en';
}
window.getNoteLanguage = getNoteLanguage;

function renderLatexToString(latex, isBlock = false) {
  if (!latex || typeof latex !== 'string') return '';
  const trimmed = latex.trim();
  if (!trimmed) return '';
  if (typeof katex !== 'undefined' && typeof katex.renderToString === 'function') {
    try {
      return katex.renderToString(trimmed, {
        displayMode: Boolean(isBlock),
        throwOnError: false,
        output: 'htmlAndMathml'
      });
    } catch (e) {
      console.warn('KaTeX render error:', e);
    }
  }
  return typeof escH === 'function' ? escH(trimmed) : trimmed;
}

function renderLatexInElement(element) {
  if (!element || !(element instanceof HTMLElement || element instanceof DocumentFragment)) return;

  // 1. Render all structured .note-math and .note-math-block nodes
  const mathNodes = element.querySelectorAll ? element.querySelectorAll('.note-math, .note-math-block') : [];
  mathNodes.forEach(node => {
    let latex = node.getAttribute('data-latex');
    const isBlock = node.classList.contains('note-math-block') || node.getAttribute('data-math-mode') === 'block';
    if (!latex) {
      latex = node.textContent.replace(/^\$\$?|\$\$?$/g, '').trim();
      node.setAttribute('data-latex', latex);
    }
    if (latex) {
      const rendered = renderLatexToString(latex, isBlock);
      if (rendered) {
        node.innerHTML = rendered;
        node.setAttribute('contenteditable', 'false');
        node.setAttribute('spellcheck', 'false');
        if (!node.hasAttribute('title')) {
          node.setAttribute('title', `LaTeX: ${latex} (${isBlock ? 'Block' : 'Inline'})`);
        }
      }
    }
  });

  // 2. If auto-render extension is available, run on container for standalone $...$ and $$...$$
  if (typeof renderMathInElement === 'function' && element.nodeType === 1) {
    try {
      renderMathInElement(element, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\(', right: '\\)', display: false },
          { left: '\\[', right: '\\]', display: true }
        ],
        ignoredClasses: ['note-editor-rich', 'tags-editor', 'todo-modal-title-input', 'note-summary-textarea', 'math-editor-textarea'],
        throwOnError: false
      });
    } catch (e) {
      console.warn('renderMathInElement error:', e);
    }
  }
}

function preprocessLatexMath(text) {
  if (typeof text !== 'string') return text;

  // 1. Replace display block math $$...$$
  let res = text.replace(/\$\$([\s\S]+?)\$\$/g, (match, latex) => {
    const trimmed = latex.trim();
    if (!trimmed) return match;
    const rendered = renderLatexToString(trimmed, true);
    const safeLatex = typeof escA === 'function' ? escA(trimmed) : trimmed.replace(/"/g, '&quot;');
    return `\n\n<div class="note-math-block" data-latex="${safeLatex}" contenteditable="false">${rendered}</div>\n\n`;
  });

  // 2. Replace inline math $...$ (avoid pure numbers / currency like $10 or $ 50)
  res = res.replace(/(^|[^\\])\$([^\$\n\r]+?)\$/g, (match, prefix, latex) => {
    const trimmed = latex.trim();
    if (!trimmed || /^\d+(\.\d+)?$/.test(trimmed)) return match;
    const rendered = renderLatexToString(trimmed, false);
    const safeLatex = typeof escA === 'function' ? escA(trimmed) : trimmed.replace(/"/g, '&quot;');
    return `${prefix}<span class="note-math" data-latex="${safeLatex}" contenteditable="false">${rendered}</span>`;
  });

  // 3. Normalize common arrow symbols
  return res
    .replace(/\$?\\rightarrow\$?/gi, '→')
    .replace(/\$?\\Rightarrow\$?/gi, '⇒')
    .replace(/\$?\\to\$?/gi, '→')
    .replace(/\$?\\implies\$?/gi, '⇒')
    .replace(/\$?\\leftarrow\$?/gi, '←')
    .replace(/\$?\\Leftarrow\$?/gi, '⇐')
    .replace(/\$?\\leftrightarrow\$?/gi, '↔')
    .replace(/\$?\\Leftrightarrow\$?/gi, '⇔');
}

/**
 * Sanitize generated note markdown before HTML conversion.
 * Normalizes headers, cleans non-usable placeholder links/brackets, and eliminates clutter.
 */
function sanitizeGeneratedNoteMarkdown(md) {
  if (!md || typeof md !== 'string') return '';
  let text = md;

  // 1. Normalize headings: convert # Header to ## Header so body sections do not duplicate H1
  text = text.replace(/^#\s+([^\n]+)/gm, '## $1');

  // 2. Remove broken/placeholder markdown links e.g. [text](http://...) or [text](#) or [text]()
  text = text.replace(/\[([^\]]+)\]\((?:https?:\/\/(?:example\.com[^\s)]*|localhost[^\s)]*|tbd|placeholder)|#|\s*)\)/gi, '$1');

  // 3. Remove non-usable raw bracket links in headers e.g. "## Header: [[Note Title]]" -> "## Header: Note Title"
  text = text.replace(/^(#{1,6}\s+.*?)\[\[(.*?)\]\]/gm, '$1$2');

  // 4. Clean up "(ref: [[...]])" patterns into clean "(from: ...)" or remove if empty
  text = text.replace(/\s*\(ref:\s*\[\[\s*\]\]\)/gi, '');
  text = text.replace(/\s*\(ref:\s*\[\[(.*?)\]\]\)/gi, ' (from: "$1")');
  text = text.replace(/\s*\(ref:\s*\)/gi, '');

  // 5. Clean up non-usable placeholder tokens like [TBD], [Insert text], [Link]
  text = text.replace(/\[(?:Insert [^\]]+|TBD|Placeholder|Link|URL)\]/gi, '');

  // 6. Clean up bullet points with newlines immediately after bullet marker e.g. "-\n  Item" -> "- Item"
  text = text.replace(/^(\s*[-*+]\s*)\r?\n+(\s*\S)/gm, '$1$2');

  return text;
}

/**
 * mdToPreviewHTML — minimal Markdown→HTML converter for LLM-generated and programmatic notes.
 * Converts markdown, cleans non-usable links, formats headers cleanly, and injects interactive pills.
 */
function mdToPreviewHTML(md) {
  if (!md) return '';
  try {
    let cleanMd = sanitizeGeneratedNoteMarkdown(md);
    if (typeof normalizeMarkdownIndentation === 'function') cleanMd = normalizeMarkdownIndentation(cleanMd);
    if (typeof marked !== 'undefined' && marked && typeof marked.parse === 'function') {
      const processed = typeof preprocessLatexMath === 'function' ? preprocessLatexMath(cleanMd) : cleanMd;
      let html = marked.parse(processed);

      // Convert [[Note Title]] wiki-links into interactive note links
      html = html.replace(/\[\[([^\]]+)\]\]/g, (_match, rawTitle) => {
        const title = rawTitle.trim();
        let targetNote = null;
        if (typeof manifest !== 'undefined' && Array.isArray(manifest)) {
          targetNote = manifest.find(n => (n.title || '').toLowerCase() === title.toLowerCase() || n.id === title || n.path === title);
        }
        const noteId = targetNote?.id || '';
        const notePath = targetNote?.path || '';
        const displayTitle = targetNote?.title || title;
        const tooltip = (typeof t === 'function' ? t('editor.openNoteLinkTooltip') || 'Open note' : 'Open note') + ': ' + displayTitle;
        const escAFn = typeof escA === 'function' ? escA : s => String(s).replace(/"/g, '&quot;');
        const escHFn = typeof escH === 'function' ? escH : s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<a href="#" class="note-link wiki-link" data-note-id="${escAFn(noteId)}" data-note-path="${escAFn(notePath)}" title="${escAFn(tooltip)}">📝 ${escHFn(displayTitle)}</a>&nbsp;`;
      });

      // Normalize markdown links pointing to notes files (e.g. [Title](notes/xxx.html))
      html = html.replace(/<a\b([^>]*\bhref=["'](notes\/[^"']+)["'][^>]*)>(.*?)<\/a>/gi, (_match, _attrs, href, label) => {
        let targetNote = null;
        if (typeof manifest !== 'undefined' && Array.isArray(manifest)) {
          targetNote = manifest.find(n => n.path === href);
        }
        const noteId = targetNote?.id || '';
        const displayTitle = targetNote?.title || label.replace(/^[📝\s]+/, '').trim();
        const tooltip = (typeof t === 'function' ? t('editor.openNoteLinkTooltip') || 'Open note' : 'Open note') + ': ' + displayTitle;
        const escAFn = typeof escA === 'function' ? escA : s => String(s).replace(/"/g, '&quot;');
        const escHFn = typeof escH === 'function' ? escH : s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<a href="#" class="note-link wiki-link" data-note-id="${escAFn(noteId)}" data-note-path="${escAFn(href)}" title="${escAFn(tooltip)}">📝 ${escHFn(displayTitle)}</a>`;
      });

      // Sanitize any remaining non-usable anchor tags from marked parsing (excluding interactive note links)
      html = html.replace(/<a\b(?![^>]*(?:note-link|wiki-link|data-note-id|data-note-path))[^>]*href=["'](?:#|javascript:[^"']*|https?:\/\/(?:example\.com|placeholder)[^"']*)["'][^>]*>(.*?)<\/a>/gi, '$1');

      // Unwrap <p> and <div> inside <li> to prevent two-line bullets with paragraph linebreaks
      html = html.replace(/<li(\b[^>]*)>([\s\S]*?)<\/li>/gi, (_match, attrs, content) => {
        let cleanContent = content
          .replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, '$1<br>')
          .replace(/<div\b[^>]*>([\s\S]*?)<\/div>/gi, '$1<br>')
          .replace(/^\s*(?:<br\s*\/?>\s*)+/gi, '')
          .replace(/(?:<br\s*\/?>\s*)+$/gi, '')
          .trim();
        return `<li${attrs}>${cleanContent}</li>`;
      });
      html = html.replace(/<li(\b[^>]*)>\s*(?:<br\s*\/?>\s*)+/gi, '<li$1>');
      html = html.replace(/(?:<br\s*\/?>\s*)+\s*<\/li>/gi, '</li>');
      html = html.replace(/<li(\b[^>]*)>\s*<\/li>/gi, '');

      // Convert mentions (@colleague) to pills if helper is available
      if (typeof convertMentionsToPills === 'function') {
        html = convertMentionsToPills(html);
      }

      return html;
    }
  } catch (e) {
    console.error('mdToPreviewHTML parsing error:', e);
  }
  // Fallback: plain text wrapped in a div
  return `<div>${(typeof escH === 'function' ? escH(md) : md).replace(/\n/g, '<br>')}</div>`;
}

function normalizeMarkdownIndentation(md) {
  if (!md) return '';
  return String(md)
    .replace(/\u00a0/g, ' ')
    .replace(/^\t+/gm, tabs => '    '.repeat(tabs.length));
}

/**
 * Synchronize tags bidirectionally between a planner block (event) and a note.
 * Merges group_tags, major_topic_tags, topic_tags so both have all tags.
 * Updates the note manifest & file on disk if modified, as well as the planner event.
 */
async function syncTagsBetweenBlocAndNote(event, noteOrIdOrPath) {
  if (!event) return false;

  let note = null;
  if (typeof noteOrIdOrPath === 'object' && noteOrIdOrPath !== null) {
    note = noteOrIdOrPath;
  } else if (typeof noteOrIdOrPath === 'string' && noteOrIdOrPath.trim()) {
    const s = noteOrIdOrPath.trim();
    note = (typeof manifest !== 'undefined' ? manifest : []).find(n => n.id === s || n.path === s) || null;
  }
  if (!note && event.noteId) {
    note = (typeof manifest !== 'undefined' ? manifest : []).find(n => n.id === event.noteId) || null;
  }
  if (!note && typeof currentNote !== 'undefined' && currentNote) {
    if (event.noteId && currentNote.id === event.noteId) {
      note = currentNote;
    }
  }
  if (!note) return false;

  const eventGroups = cleanTagList(event.group_tags);
  const eventMajors = cleanTagList(event.major_topic_tags);
  const eventTopics = cleanTagList(event.topic_tags);

  const noteGroups = cleanTagList(note.group_tags);
  const noteMajors = cleanTagList(note.major_topic_tags);
  const noteTopics = cleanTagList(note.topic_tags);

  const mergedGroups = mergeTagLists(noteGroups, eventGroups);
  const mergedMajors = mergeTagLists(noteMajors, eventMajors);
  const mergedTopics = mergeTagLists(noteTopics, eventTopics);

  let eventChanged = false;
  event.group_tags = [...mergedGroups];
  event.major_topic_tags = [...mergedMajors];
  event.topic_tags = [...mergedTopics];
  if (JSON.stringify(eventGroups) !== JSON.stringify(mergedGroups) ||
      JSON.stringify(eventMajors) !== JSON.stringify(mergedMajors) ||
      JSON.stringify(eventTopics) !== JSON.stringify(mergedTopics)) {
    eventChanged = true;
    event.tags = [...new Set([...mergedGroups, ...mergedMajors, ...mergedTopics])];
  }

  // Also sync to any other plannerEvents linked to this note
  const resolvedNoteId = note.id || (typeof currentNote !== 'undefined' && currentNote?.id) || '';
  if (Array.isArray(plannerEvents) && resolvedNoteId) {
    plannerEvents.forEach(pe => {
      if (pe && (String(pe.noteId || '').trim() === resolvedNoteId || (Array.isArray(pe.linkedNoteIds) && pe.linkedNoteIds.includes(resolvedNoteId)))) {
        const peG = cleanTagList(pe.group_tags);
        const peM = cleanTagList(pe.major_topic_tags);
        const peT = cleanTagList(pe.topic_tags);
        if (JSON.stringify(peG) !== JSON.stringify(mergedGroups) ||
            JSON.stringify(peM) !== JSON.stringify(mergedMajors) ||
            JSON.stringify(peT) !== JSON.stringify(mergedTopics)) {
          pe.group_tags = [...mergedGroups];
          pe.major_topic_tags = [...mergedMajors];
          pe.topic_tags = [...mergedTopics];
          pe.tags = [...new Set([...mergedGroups, ...mergedMajors, ...mergedTopics])];
          eventChanged = true;
        }
      }
    });
  }

  if (eventChanged) {
    if (typeof savePlanner === 'function') savePlanner();
    if (typeof renderPlanner === 'function') renderPlanner();
  }

  let noteChanged = false;
  if (JSON.stringify(noteGroups) !== JSON.stringify(mergedGroups)) {
    note.group_tags = [...mergedGroups];
    noteChanged = true;
  }
  if (JSON.stringify(noteMajors) !== JSON.stringify(mergedMajors)) {
    note.major_topic_tags = [...mergedMajors];
    noteChanged = true;
  }
  if (JSON.stringify(noteTopics) !== JSON.stringify(mergedTopics)) {
    note.topic_tags = [...mergedTopics];
    noteChanged = true;
  }

  // Update manifest entry if distinct
  if (typeof manifest !== 'undefined' && Array.isArray(manifest)) {
    const manifestItem = manifest.find(n => n.id === note.id || (note.path && n.path === note.path));
    if (manifestItem && manifestItem !== note) {
      manifestItem.group_tags = [...mergedGroups];
      manifestItem.major_topic_tags = [...mergedMajors];
      manifestItem.topic_tags = [...mergedTopics];
    }
  }

  // If currentNote in overlay is this note, update currentNote directly
  if (typeof currentNote !== 'undefined' && currentNote && (currentNote.id === note.id || (note.path && currentNote.path === note.path))) {
    currentNote.group_tags = [...mergedGroups];
    currentNote.major_topic_tags = [...mergedMajors];
    currentNote.topic_tags = [...mergedTopics];
  }

  if (noteChanged && note.path) {
    try {
      if (typeof StorageAPI !== 'undefined' && typeof applyNoteEdits === 'function') {
        const rawHTML = (StorageAPI.getNoteFromCache && StorageAPI.getNoteFromCache(note.path)) || await StorageAPI.readNoteContent(note.path);
        if (rawHTML) {
          const updatedHTML = applyNoteEdits(rawHTML, {
            group_tags: mergedGroups,
            major_topic_tags: mergedMajors,
            topic_tags: mergedTopics
          });
          await StorageAPI.writeNoteContent(note.path, updatedHTML);
          if (typeof currentNote !== 'undefined' && currentNote && currentNote.path === note.path) {
            currentNote.originalHTML = updatedHTML;
          }
        }
      }
      if (typeof upsertManifest === 'function') upsertManifest(note);
      if (typeof saveManifest === 'function') await saveManifest({ force: true });
    } catch (err) {
      console.warn('Failed to write updated tags to note file:', err);
    }
  }

  // Update tag editors in DOM if visible
  if (typeof populateTagEditor === 'function') {
    if (document.getElementById('editor-group')) populateTagEditor('editor-group', mergedGroups, 'group');
    if (document.getElementById('editor-major')) populateTagEditor('editor-major', mergedMajors, 'major');
    if (document.getElementById('editor-topic')) populateTagEditor('editor-topic', mergedTopics, 'topic');
  }
  if (typeof _updateMetaTitlePreview === 'function') {
    _updateMetaTitlePreview();
  }
  return eventChanged || noteChanged;
}

function isWorkstreamTag(tagName) {
  if (!tagName || typeof tagName !== 'string') return false;
  const clean = tagName.trim().toLowerCase();
  if (!clean) return false;
  const norm = typeof normalizeWorkstreamKey === 'function' ? normalizeWorkstreamKey(clean) : clean;
  if (typeof getKnownWorkstreamsList === 'function') {
    const list = getKnownWorkstreamsList();
    if (list && list.length > 0) {
      return list.some(w => {
        const itemClean = String(w || '').trim().toLowerCase();
        if (itemClean === clean) return true;
        if (norm && typeof normalizeWorkstreamKey === 'function' && normalizeWorkstreamKey(itemClean) === norm) return true;
        return false;
      });
    }
  }
  if (typeof _topicMemoriesIndexCache !== 'undefined' && _topicMemoriesIndexCache?.topics && Array.isArray(_topicMemoriesIndexCache.topics)) {
    return _topicMemoriesIndexCache.topics.some(t => {
      if (!t || t.status === 'archived') return false;
      const name = String(t.topicName || t.majorTopic || '').trim().toLowerCase();
      const key = String(t.key || (typeof sanitizeTopicMemoryKey === 'function' ? sanitizeTopicMemoryKey(t.topicName || '') : '')).trim().toLowerCase();
      const normKey = typeof normalizeWorkstreamKey === 'function' ? normalizeWorkstreamKey(t.topicName || t.key || '') : key;
      return name === clean || key === clean || (norm && normKey === norm);
    });
  }
  return false;
}

window.isWorkstreamTag = isWorkstreamTag;
window.syncTagsBetweenBlocAndNote = syncTagsBetweenBlocAndNote;
window.renderLatexToString = renderLatexToString;
window.renderLatexInElement = renderLatexInElement;
window.preprocessLatexMath = preprocessLatexMath;

// ── Secretary: Shared Consolidated Utilities & UI Helpers ──

function formatMinutesToHHMM(mins) {
  if (mins === null || mins === undefined || mins === '') return '';
  let num = Number(mins);
  if (isNaN(num)) return '';
  num = Math.floor(num);
  num = ((num % 1440) + 1440) % 1440;
  const h = Math.floor(num / 60);
  const m = num % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function compareTodoDates(a, b) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const dateA = String(a.modified || a.created || a.date || '').trim();
  const dateB = String(b.modified || b.created || b.date || '').trim();
  return dateB.localeCompare(dateA);
}

function tagArrayContains(tagList, targetTag) {
  if (!tagList || !targetTag) return false;
  const cleanTarget = String(targetTag).trim().toLowerCase();
  if (!cleanTarget) return false;
  if (Array.isArray(tagList)) {
    return tagList.some(t => String(t || '').trim().toLowerCase() === cleanTarget);
  }
  if (tagList instanceof Set) {
    for (const t of tagList) {
      if (String(t || '').trim().toLowerCase() === cleanTarget) return true;
    }
    return false;
  }
  if (typeof tagList === 'string') {
    return tagList.split(',').some(t => t.trim().toLowerCase() === cleanTarget);
  }
  return false;
}

function noteHasTag(note, tag) {
  if (!note || typeof note !== 'object' || !tag) return false;
  const cleanTag = String(tag).trim().toLowerCase();
  if (!cleanTag) return false;
  return tagArrayContains(note.group_tags, cleanTag) ||
         tagArrayContains(note.major_topic_tags, cleanTag) ||
         tagArrayContains(note.topic_tags, cleanTag) ||
         tagArrayContains(note.extra_tags, cleanTag) ||
         tagArrayContains(note.other_tags, cleanTag) ||
         tagArrayContains(note.tags, cleanTag) ||
         tagArrayContains(note.workstreams, cleanTag) ||
         tagArrayContains(note.workstream, cleanTag);
}

function noteHasAnyTag(note, tagList) {
  if (!note || !Array.isArray(tagList) || !tagList.length) return false;
  return tagList.some(t => noteHasTag(note, t));
}

function stripHtmlTags(html) {
  if (html === null || html === undefined) return '';
  const str = String(html);
  return str.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function truncateText(str, maxLen = 50, suffix = '...') {
  if (str === null || str === undefined) return '';
  const clean = String(str).trim();
  if (!clean) return '';
  const limit = Math.max(0, Number(maxLen) || 0);
  if (clean.length <= limit) return clean;
  return clean.slice(0, limit).trim() + suffix;
}

function generateUniqueId(prefix = 'id') {
  const safePrefix = String(prefix || 'id').trim();
  const rand = Math.random().toString(36).slice(2, 8);
  return `${safePrefix}-${Date.now()}-${rand}`;
}

function createTagPill(tag, options = {}) {
  const {
    type = 'extra',
    cssClass = '',
    icon = '',
    onRemove = null,
    title = ''
  } = options;

  const cleanTag = String(tag || '').trim();
  const pill = document.createElement('span');
  const tagTypeCss = type === 'group' ? 'group-tag' : type === 'major' ? 'major-tag' : type === 'topic' ? 'topic-tag' : 'extra-tag';
  pill.className = `tag-pill ${tagTypeCss} ${cssClass}`.trim();
  pill.dataset.tag = cleanTag;

  const displayIcon = icon ? `<span>${icon}</span> ` : '';
  const labelText = typeof escapeHtml === 'function' ? escapeHtml(cleanTag) : cleanTag.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  
  const removeTitle = title || (typeof t === 'function' ? t('common.clickToRemoveTag', { tag: cleanTag }) : 'Click to remove tag');
  pill.title = removeTitle;
  pill.innerHTML = `${displayIcon}<span>${labelText}</span><button type="button" class="rm" title="${removeTitle.replace(/"/g, '&quot;')}">✕</button>`;

  if (typeof onRemove === 'function') {
    pill.querySelector('.rm')?.addEventListener('click', (e) => {
      e.stopPropagation();
      onRemove(cleanTag, pill);
    });
  }

  return pill;
}

function makeTagChip(tag, options = {}) {
  const {
    isAssigned = false,
    extraClass = '',
    isMatch = false,
    isAssociated = false,
    isWorkstream = false,
    bg = '',
    fg = '',
    onSelect = null,
    onRemove = null
  } = options;

  const cleanTag = String(tag || '').trim();
  const chip = document.createElement('button');
  chip.type = 'button';

  let cls = 'tag-suggest-chip ' + (isAssigned ? 'assigned' : (extraClass || 'suggestion'));
  if (isMatch) cls += ' matching-highlight';
  if (isAssociated) cls += ' associated-highlight';
  if (isWorkstream) cls += ' workstream-tag';

  chip.className = cls;
  chip.textContent = (isAssigned ? '✓ ' : '') + cleanTag;
  if (bg) chip.style.background = bg;
  if (fg) chip.style.color = fg;

  const chipTitle = isAssigned
    ? (typeof t === 'function' ? t('common.clickToRemoveTag', { tag: cleanTag }) : `Remove tag ${cleanTag}`)
    : (typeof t === 'function' ? t('common.clickToAddTag', { tag: cleanTag }) : `Add tag ${cleanTag}`);
  chip.title = chipTitle;

  const handleTrigger = (e) => {
    e.preventDefault();
    if (isAssigned && typeof onRemove === 'function') {
      onRemove(cleanTag, chip);
    } else if (!isAssigned && typeof onSelect === 'function') {
      onSelect(cleanTag, chip);
    }
  };

  chip.addEventListener('pointerdown', handleTrigger);
  chip.addEventListener('mousedown', handleTrigger);

  return chip;
}

function positionTagDropdown(dropdown, containerEl) {
  if (!dropdown || !containerEl) return;
  const rect = containerEl.getBoundingClientRect();
  const dropdownHeight = dropdown.offsetHeight || 180;
  const spaceBelow = window.innerHeight - rect.bottom;

  if (spaceBelow < dropdownHeight && rect.top > dropdownHeight) {
    dropdown.style.top = (rect.top - dropdownHeight - 4) + 'px';
  } else {
    dropdown.style.top = (rect.bottom + 4) + 'px';
  }
  dropdown.style.left = rect.left + 'px';
}

function setupModalDismissHandlers(options = {}) {
  const {
    element = null,
    onClose = null,
    escKey = true,
    outsideClick = true
  } = options;

  if (typeof onClose !== 'function') return () => {};

  const handleKeyDown = (e) => {
    if (escKey && e.key === 'Escape') {
      onClose(e);
    }
  };

  const handleOutsideClick = (e) => {
    if (outsideClick && element && !element.contains(e.target)) {
      onClose(e);
    }
  };

  document.addEventListener('keydown', handleKeyDown);
  if (outsideClick) {
    setTimeout(() => {
      document.addEventListener('click', handleOutsideClick);
    }, 10);
  }

  return function cleanup() {
    document.removeEventListener('keydown', handleKeyDown);
    if (outsideClick) {
      document.removeEventListener('click', handleOutsideClick);
    }
  };
}

function normalizePlannerLinkedNoteIds(noteIds, primaryNoteId = '') {
  const primary = String(primaryNoteId || '').trim();
  const cleaned = Array.from(new Set((Array.isArray(noteIds) ? noteIds : [])
    .map(v => String(v || '').trim())
    .filter(Boolean)));
  if (primary && !cleaned.includes(primary)) cleaned.unshift(primary);
  return cleaned;
}

function normalizePlannerLinkedTodoIds(todoIds, primaryTodoId = '') {
  const primary = String(primaryTodoId || '').trim();
  const cleaned = Array.from(new Set((Array.isArray(todoIds) ? todoIds : [])
    .map(v => String(v || '').trim())
    .filter(Boolean)));
  if (primary && !cleaned.includes(primary)) cleaned.unshift(primary);
  return cleaned;
}

function getPlannerEventLinkedNoteIds(event, options = {}) {
  const includePrimary = options.includePrimary !== false;
  if (!event || typeof event !== 'object') return [];
  const primary = String(event.noteId || '').trim();
  const linked = Array.isArray(event.linkedNoteIds) ? event.linkedNoteIds : [];
  if (includePrimary) return normalizePlannerLinkedNoteIds([primary, ...linked], primary);
  return normalizePlannerLinkedNoteIds(linked).filter(id => id !== primary);
}

function getPlannerEventLinkedTodoIds(event, options = {}) {
  const includePrimary = options.includePrimary !== false;
  if (!event || typeof event !== 'object') return [];
  const primary = String(event.todoId || '').trim();
  const linked = Array.isArray(event.linkedTodoIds) ? event.linkedTodoIds : [];
  if (includePrimary) return normalizePlannerLinkedTodoIds([primary, ...linked], primary);
  return normalizePlannerLinkedTodoIds(linked).filter(id => id !== primary);
}

function formatNoteContextForAI(note, content = '') {
  if (!note && !content) return '';
  const title = typeof note === 'object' && note ? (note.title || note.path || 'Untitled Note') : String(note || 'Untitled Note');
  const path = typeof note === 'object' && note?.path ? ` [Path: ${note.path}]` : '';
  const text = String(content || '').trim();
  return `Note attachée: "${title}"${path}\nContenu:\n${text}\n\n`;
}

function formatTaskContextForAI(todo) {
  if (!todo || typeof todo !== 'object') return '';
  const prio = todo.priority || 'Medium';
  const status = todo.status || 'Todo';
  const title = todo.title || todo.id || 'Task';
  const owner = todo.owner || 'me';
  return `Tâche attachée: [${prio}] [Status: ${status}] "${title}" (Assigné: ${owner})\n\n`;
}

function formatPlannerEventContextForAI(event) {
  if (!event || typeof event !== 'object') return '';
  const date = event.date || '';
  const time = (event.startTime || event.endTime) ? `${event.startTime || ''}-${event.endTime || ''}` : '';
  const title = event.title || 'Event';
  const desc = event.description ? ` (Description: ${event.description})` : '';
  const type = event.type ? ` (Type: ${event.type})` : '';
  return `Événement planifié attaché: [${date}] ${time} "${title}"${type}${desc}\n\n`;
}

function sanitizeHtmlContent(htmlString, options = {}) {
  if (htmlString === null || htmlString === undefined || htmlString === '') return '';
  const rawStr = String(htmlString);
  if (!rawStr.trim()) return '';

  const parser = typeof DOMParser !== 'undefined' ? new DOMParser() : null;
  if (!parser) {
    return rawStr
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/ on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/href\s*=\s*["']?\s*javascript:[^"'>\s]+/gi, 'href="#"');
  }

  try {
    const doc = parser.parseFromString(`<div>${rawStr}</div>`, 'text/html');
    const container = doc.body.firstElementChild || doc.body;

    const forbiddenTags = new Set([
      'script', 'iframe', 'object', 'embed', 'applet', 'meta', 'base', 'form', 'frame', 'frameset'
    ]);

    const dangerousUriRegex = /^\s*(?:javascript|vbscript|data:\s*text\/html)/i;

    function sanitizeNode(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.cloneNode(true);
      }

      if (node.nodeType === Node.ELEMENT_NODE) {
        const tagName = node.tagName.toLowerCase();
        if (forbiddenTags.has(tagName)) {
          return null;
        }

        const cleanEl = document.createElement(tagName);

        for (const attr of Array.from(node.attributes)) {
          const attrName = attr.name.toLowerCase();
          const attrVal = attr.value;

          if (attrName.startsWith('on')) {
            continue;
          }

          if ((attrName === 'href' || attrName === 'src' || attrName === 'action' || attrName === 'formaction') && dangerousUriRegex.test(attrVal)) {
            continue;
          }

          cleanEl.setAttribute(attr.name, attrVal);
        }

        for (const child of Array.from(node.childNodes)) {
          const cleanChild = sanitizeNode(child);
          if (cleanChild) {
            cleanEl.appendChild(cleanChild);
          }
        }

        return cleanEl;
      }

      return null;
    }

    const fragment = document.createDocumentFragment();
    for (const child of Array.from(container.childNodes)) {
      const cleanChild = sanitizeNode(child);
      if (cleanChild) fragment.appendChild(cleanChild);
    }

    const tempDiv = document.createElement('div');
    tempDiv.appendChild(fragment);
    return tempDiv.innerHTML;
  } catch (err) {
    console.warn('sanitizeHtmlContent failed', err);
    return rawStr.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  }
}

/**
 * Tokenize a title string into meaningful lowercase words,
 * stripping common stopwords, diacritics, and punctuation.
 */
function tokenizeTitle(title) {
  if (!title || typeof title !== 'string') return [];
  const stopWords = new Set([
    'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'as', 'at',
    'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
    'can', 'did', 'do', 'does', 'doing', 'down', 'during', 'each', 'few', 'for', 'from', 'further',
    'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself', 'his', 'how',
    'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself', 'just', 'me', 'more', 'most', 'my', 'myself',
    'no', 'nor', 'not', 'now', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'our', 'ours', 'ourselves',
    'out', 'over', 'own', 'same', 'she', 'should', 'so', 'some', 'such', 'than', 'that', 'the', 'their',
    'theirs', 'them', 'themselves', 'then', 'there', 'these', 'they', 'this', 'those', 'through', 'to', 'too',
    'under', 'until', 'up', 'very', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who',
    'whom', 'why', 'will', 'with', 'you', 'your', 'yours', 'yourself', 'yourselves',
    // French
    'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'd', 'l', 'et', 'en', 'dans', 'sur', 'pour', 'avec',
    'par', 'qui', 'que', 'quoi', 'dont', 'ou', 'ce', 'cet', 'cette', 'ces', 'est', 'sont', 'au', 'aux', 'ses', 'son', 'sa',
    // German
    'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einer', 'eines', 'einem', 'einen', 'und', 'in', 'im',
    'von', 'vom', 'zu', 'zum', 'zur', 'mit', 'auf', 'für', 'fuer', 'ist', 'sind', 'war', 'waren',
    // Spanish
    'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'e', 'en', 'de', 'del', 'por', 'para', 'con', 'es', 'son'
  ]);

  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s_-]/g, ' ')
    .split(/[\s_-]+/)
    .map(w => w.trim())
    .filter(w => w.length >= 2 && !stopWords.has(w));
}

/**
 * Calculate similarity between two titles (0.0 to 1.0)
 * utilizing token overlap, prefix/stem matching, and substring detection.
 */
function calculateTitleSimilarity(titleA, titleB) {
  if (!titleA || !titleB) return 0;
  const cleanA = String(titleA).trim().toLowerCase();
  const cleanB = String(titleB).trim().toLowerCase();
  if (!cleanA || !cleanB) return 0;

  if (cleanA === cleanB) return 1.0;

  // Substring check (if long enough)
  if (cleanA.length >= 3 && cleanB.length >= 3) {
    if (cleanA.includes(cleanB) || cleanB.includes(cleanA)) {
      return 0.85;
    }
  }

  const tokensA = tokenizeTitle(titleA);
  const tokensB = tokenizeTitle(titleB);
  if (!tokensA.length || !tokensB.length) return 0;

  let matchedCount = 0;
  tokensA.forEach(tA => {
    const hasMatch = tokensB.some(tB => {
      if (tA === tB) return true;
      if (tA.length >= 4 && tB.length >= 4 && (tA.startsWith(tB) || tB.startsWith(tA))) {
        return true;
      }
      return false;
    });
    if (hasMatch) matchedCount++;
  });

  if (matchedCount === 0) return 0;

  const overlapRatio = (2 * matchedCount) / (tokensA.length + tokensB.length);
  const minRatio = matchedCount / Math.min(tokensA.length, tokensB.length);
  return Math.max(overlapRatio, minRatio * 0.8);
}

/**
 * Compute relevance scores for candidate tags based on:
 * - Title keyword match
 * - Title similarity with notes in manifest (notes with similar titles boost their tags)
 * - Co-occurrence with already selected tags in other fields
 * - Associated entities (linked todo, linked notes, collaborators)
 * - Workstream bonus
 */
function computeTagScores(options = {}) {
  const {
    type = 'major',
    candidates = [],
    title = '',
    selectedTags = [],
    associatedTags = new Set(),
    manifest = (typeof window !== 'undefined' && Array.isArray(window.manifest) ? window.manifest : []),
    todosManifest = (typeof window !== 'undefined' && Array.isArray(window.todosManifest) ? window.todosManifest : [])
  } = options;

  const scores = {};
  if (!Array.isArray(candidates) || !candidates.length) return scores;

  candidates.forEach(c => { scores[c] = 0; });

  const titleTokens = tokenizeTitle(title);
  const titleLower = String(title || '').trim().toLowerCase();
  const selectedTagSet = new Set(cleanTagList(selectedTags, { toLowerCase: true }));
  const associatedTagSet = new Set(cleanTagList(associatedTags, { toLowerCase: true }));

  const isWs = t => (typeof isWorkstreamTag === 'function' ? isWorkstreamTag(t) : false);

  // Precompute note title similarities and tag lookups
  const scoredNotes = [];
  if (Array.isArray(manifest) && (titleLower || selectedTagSet.size > 0)) {
    manifest.forEach(n => {
      if (!n) return;
      let sim = 0;
      if (titleLower && n.title) {
        sim = calculateTitleSimilarity(title, n.title);
      }

      let coOccurMatches = 0;
      if (selectedTagSet.size > 0) {
        selectedTagSet.forEach(sTag => {
          if (typeof window.noteHasTag === 'function' ? window.noteHasTag(n, sTag) : false) {
            coOccurMatches++;
          } else {
            const has = (arr) => (arr || []).some(x => String(x).trim().toLowerCase() === sTag);
            if (has(n.group_tags) || has(n.major_topic_tags) || has(n.topic_tags) || has(n.extra_tags)) {
              coOccurMatches++;
            }
          }
        });
      }

      if (sim > 0.2 || coOccurMatches > 0) {
        scoredNotes.push({
          note: n,
          similarity: sim,
          coOccurMatches
        });
      }
    });
  }

  candidates.forEach(tag => {
    let score = 0;
    const tagClean = String(tag || '').trim();
    const tagLower = tagClean.toLowerCase();
    const tagTokens = tokenizeTitle(tagClean);

    // 1. Direct title keyword match
    if (titleLower) {
      if (titleLower.includes(tagLower)) {
        score += 60;
      } else if (tagTokens.length && tagTokens.every(tk => titleTokens.includes(tk))) {
        score += 45;
      } else if (tagTokens.some(tk => titleTokens.includes(tk))) {
        score += 25;
      }
    }

    // 2. Title similarity with notes in manifest & co-occurrence
    scoredNotes.forEach(({ note, similarity, coOccurMatches }) => {
      const noteTags = type === 'group'
        ? (note.group_tags || [])
        : type === 'major'
          ? (note.major_topic_tags || [])
          : type === 'topic'
            ? (note.topic_tags || [])
            : (note.extra_tags || []);

      const hasThisTag = noteTags.some(t => String(t).trim().toLowerCase() === tagLower);
      if (hasThisTag) {
        if (similarity > 0.2) {
          score += Math.round(similarity * 50);
        }
        if (coOccurMatches > 0 && selectedTagSet.size > 0) {
          const ratio = coOccurMatches / selectedTagSet.size;
          score += Math.round(ratio * 35);
        }
      }
    });

    // 3. Associated entities (linked note / linked todo / collaborator attendees)
    if (associatedTagSet.has(tagLower)) {
      score += 45;
    }

    // 4. Active workstream bonus
    if (type === 'major' && isWs(tagClean)) {
      score += 15;
    }

    scores[tag] = score;
  });

  return scores;
}

window.tokenizeTitle = tokenizeTitle;
window.calculateTitleSimilarity = calculateTitleSimilarity;
window.computeTagScores = computeTagScores;

window.formatMinutesToHHMM = formatMinutesToHHMM;
window.formatTime = formatMinutesToHHMM;
window.compareTodoDates = compareTodoDates;
window.tagArrayContains = tagArrayContains;
window.noteHasTag = noteHasTag;
window.noteHasAnyTag = noteHasAnyTag;
window.stripHtmlTags = stripHtmlTags;
window.truncateText = truncateText;
window.generateUniqueId = generateUniqueId;
window.createTagPill = createTagPill;
window.makeTagChip = makeTagChip;
window.positionTagDropdown = positionTagDropdown;
window.knownTagsForType = knownTagsForType;
window.invalidateKnownTagsCache = invalidateKnownTagsCache;
window.cleanTagList = cleanTagList;
window.mergeTagLists = mergeTagLists;
window.normalizeWorkstreamKey = normalizeWorkstreamKey;
window.getAllEntityTags = getAllEntityTags;
window.getAllNoteTags = getAllNoteTags;
window.findWorkstreamByNameOrKey = findWorkstreamByNameOrKey;
window.extractEntityWorkstreams = extractEntityWorkstreams;
window.normalizeItemTagSets = normalizeItemTagSets;
window.matchTagsToSelectionGroup = matchTagsToSelectionGroup;
window.matchTagsToWorkstreamSelectionGroups = matchTagsToWorkstreamSelectionGroups;
window.setupModalDismissHandlers = setupModalDismissHandlers;

window.normalizePlannerLinkedNoteIds = normalizePlannerLinkedNoteIds;
window.normalizePlannerLinkedTodoIds = normalizePlannerLinkedTodoIds;
window.getPlannerEventLinkedNoteIds = getPlannerEventLinkedNoteIds;
window.getPlannerEventLinkedTodoIds = getPlannerEventLinkedTodoIds;
window.formatNoteContextForAI = formatNoteContextForAI;
window.formatTaskContextForAI = formatTaskContextForAI;
window.formatPlannerEventContextForAI = formatPlannerEventContextForAI;
window.sanitizeHtmlContent = sanitizeHtmlContent;
window.isDateCoveredByOoo = isDateCoveredByOoo;
window.getCoveringOooEvent = getCoveringOooEvent;


